//! Additive, bounded BWPR/BWPA operations beyond the legacy commit packet.
//!
//! These packets deliberately carry execution instructions, not policy. Rust
//! chooses the operation, cursor, bounds, expected head, and retry behavior;
//! the browser validates and executes the requested IndexedDB operation.

use crate::{
    Checkpoint, MAX_RECORD_BYTES_V1, MAX_RECORDS_PER_CHECKPOINT_V1, PERSISTENCE_BROWSER_HEADER_BYTES_V1,
    PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1, PERSISTENCE_BROWSER_PROTOCOL_V1, PersistenceError, PersistenceWireRecord,
    RecordAddress, RecordKind, decode_record, encode_checkpoint, payload_hash, validate_label,
};
use blockwild_types::{CanonicalHash, CanonicalHasher};

pub const PERSISTENCE_PLATFORM_CHUNK_BYTES_V1: usize = 4 * 1024 * 1024;
/// One recovery page must be able to carry every valid record plus its exact
/// checkpoint descriptor and page framing without widening ordinary import or
/// export chunks. The resulting BWPA remains below the 128 MiB dispatcher
/// packet ceiling.
pub const PERSISTENCE_PLATFORM_RECOVERY_PAGE_OVERHEAD_BYTES_V1: usize = 64 * 1024;
pub const PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1: usize =
    MAX_RECORD_BYTES_V1 + PERSISTENCE_PLATFORM_RECOVERY_PAGE_OVERHEAD_BYTES_V1;
pub const PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1: u32 = 4_096;
pub const HISTORICAL_FALLBACK_RECONCILIATION_SCHEMA_V2: u16 = 2;

const REQUEST_MAGIC: [u8; 4] = *b"BWPR";
const RESPONSE_MAGIC: [u8; 4] = *b"BWPA";
const RESPONSE_OPERATION: u16 = 110;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
#[repr(u16)]
pub enum PersistencePlatformOperationV1 {
    RecoverHead = 4,
    ReadRecoveryPage = 5,
    Estimate = 6,
    Compact = 7,
    DeleteWorld = 8,
    PreserveLegacyBackupChunk = 9,
    ExportPage = 10,
    ImportChunk = 11,
    FinalizeImport = 12,
    ReconcileHistoricalFallback = 13,
}

impl PersistencePlatformOperationV1 {
    fn from_tag(tag: u16) -> Result<Self, PersistenceError> {
        match tag {
            4 => Ok(Self::RecoverHead),
            5 => Ok(Self::ReadRecoveryPage),
            6 => Ok(Self::Estimate),
            7 => Ok(Self::Compact),
            8 => Ok(Self::DeleteWorld),
            9 => Ok(Self::PreserveLegacyBackupChunk),
            10 => Ok(Self::ExportPage),
            11 => Ok(Self::ImportChunk),
            12 => Ok(Self::FinalizeImport),
            13 => Ok(Self::ReconcileHistoricalFallback),
            _ => Err(PersistenceError::new(
                "platform-operation",
                "unknown persistence platform operation",
            )),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalFallbackActualRecordV2 {
    pub address: RecordAddress,
    pub revision: u64,
    pub byte_length: u32,
    pub stored_payload_hash: CanonicalHash,
    pub actual_payload_hash: CanonicalHash,
}

/// A browser observation is untrusted state, but it is complete and
/// deterministic: the latest/fallback checkpoint pair and every current
/// record fingerprint are captured in one read transaction. Rust validates
/// the fallback semantics and binds this exact snapshot into the repair plan;
/// IndexedDB compares it again inside the eventual write transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalFallbackObservationV2 {
    pub schema_version: u16,
    pub world_id: String,
    pub storage_revision: u64,
    pub latest_checkpoint: Checkpoint,
    pub fallback_checkpoint: Checkpoint,
    pub actual_records: Vec<HistoricalFallbackActualRecordV2>,
    pub actual_record_set_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalFallbackCopyRecordV2 {
    pub address: RecordAddress,
    pub source_revision: u64,
    pub target_revision: u64,
    pub byte_length: u32,
    pub payload_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalFallbackInlineRecordV2 {
    pub address: RecordAddress,
    pub target_revision: u64,
    pub payload: Vec<u8>,
}

/// Rust-authored exact repair. Large immutable document/native payloads are
/// copied from the verified retained fallback revisions; only the rebound
/// BWHE and canonical manifest travel inline. No browser policy can select a
/// different fallback or target checkpoint.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalFallbackReconciliationPlanV2 {
    pub schema_version: u16,
    pub created_at: u64,
    pub observation: HistoricalFallbackObservationV2,
    pub observation_hash: CanonicalHash,
    pub target_checkpoint: Checkpoint,
    pub copy_records: Vec<HistoricalFallbackCopyRecordV2>,
    pub inline_records: Vec<HistoricalFallbackInlineRecordV2>,
    pub delete_addresses: Vec<RecordAddress>,
    pub save_set_hash: CanonicalHash,
    pub manifest_hash: CanonicalHash,
    pub descriptor_hash: CanonicalHash,
    pub plan_hash: CanonicalHash,
}

fn write_address(writer: &mut Writer, address: &RecordAddress) -> Result<(), PersistenceError> {
    writer.string(&address.universe_id)?;
    writer.string(&address.location_id)?;
    writer.u8(address.kind as u8);
    writer.string(&address.record_id)
}

fn read_address(reader: &mut Reader<'_>) -> Result<RecordAddress, PersistenceError> {
    RecordAddress::new(
        reader.string()?,
        reader.string()?,
        RecordKind::from_tag(reader.u8()?)?,
        reader.string()?,
    )
}

fn historical_actual_record_set_hash_v2(records: &[HistoricalFallbackActualRecordV2]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-historical-fallback-actual-records-v2");
    hasher.write_u16(HISTORICAL_FALLBACK_RECONCILIATION_SCHEMA_V2);
    hasher.write_u32(records.len() as u32);
    for record in records {
        record.address.write_hash(&mut hasher);
        hasher.write_u64(record.revision);
        hasher.write_u32(record.byte_length);
        hasher.write_str(&record.stored_payload_hash.to_hex());
        hasher.write_str(&record.actual_payload_hash.to_hex());
    }
    hasher.finish()
}

fn observation_is_corrupt_v2(observation: &HistoricalFallbackObservationV2) -> bool {
    if observation.actual_records.len() != observation.latest_checkpoint.records.len() {
        return true;
    }
    observation
        .actual_records
        .iter()
        .zip(&observation.latest_checkpoint.records)
        .any(|(actual, expected)| {
            actual.address != expected.address
                || actual.revision != expected.revision
                || actual.byte_length != expected.byte_length
                || actual.stored_payload_hash != expected.payload_hash
                || actual.actual_payload_hash != expected.payload_hash
        })
}

impl HistoricalFallbackObservationV2 {
    pub fn verify(&self) -> Result<(), PersistenceError> {
        if self.schema_version != HISTORICAL_FALLBACK_RECONCILIATION_SCHEMA_V2 {
            return Err(PersistenceError::new(
                "historical-reconciliation-schema",
                "unsupported historical fallback observation schema",
            ));
        }
        validate_label(&self.world_id, 180, "historical observation world_id")?;
        self.latest_checkpoint.verify()?;
        self.fallback_checkpoint.verify()?;
        if self.latest_checkpoint.world_id != self.world_id
            || self.fallback_checkpoint.world_id != self.world_id
            || self.latest_checkpoint.generator_hash != self.fallback_checkpoint.generator_hash
            || self.latest_checkpoint.content_hash != self.fallback_checkpoint.content_hash
            || self.latest_checkpoint.parent_checkpoint_id.as_deref()
                != Some(self.fallback_checkpoint.checkpoint_id.as_str())
            || self.latest_checkpoint.journal_sequence != self.fallback_checkpoint.journal_sequence.saturating_add(1)
        {
            return Err(PersistenceError::new(
                "historical-reconciliation-lineage",
                "historical fallback must be the exact direct parent of the observed latest checkpoint",
            ));
        }
        if self.actual_records.len() > MAX_RECORDS_PER_CHECKPOINT_V1 {
            return Err(PersistenceError::new(
                "historical-reconciliation-records",
                "historical fallback observation exceeds the record budget",
            ));
        }
        let mut previous: Option<&RecordAddress> = None;
        for actual in &self.actual_records {
            if actual.revision == 0
                || actual.byte_length as usize > MAX_RECORD_BYTES_V1
                || previous.is_some_and(|address| address >= &actual.address)
            {
                return Err(PersistenceError::new(
                    "historical-reconciliation-records",
                    "observed current record fingerprints are invalid, duplicated, or unsorted",
                ));
            }
            previous = Some(&actual.address);
        }
        if historical_actual_record_set_hash_v2(&self.actual_records) != self.actual_record_set_hash {
            return Err(PersistenceError::new(
                "historical-reconciliation-observation",
                "observed current record-set hash does not match its fingerprints",
            ));
        }
        if !observation_is_corrupt_v2(self) {
            return Err(PersistenceError::new(
                "historical-reconciliation-not-needed",
                "observed latest checkpoint is already an exact current record set",
            ));
        }
        Ok(())
    }
}

pub fn encode_historical_fallback_observation_v2(
    value: &HistoricalFallbackObservationV2,
) -> Result<Vec<u8>, PersistenceError> {
    value.verify()?;
    let mut writer = Writer::default();
    writer.bytes.extend_from_slice(b"BWHO");
    writer.u16(value.schema_version);
    writer.string(&value.world_id)?;
    writer.u64(value.storage_revision);
    writer.bytes(&encode_checkpoint(&value.latest_checkpoint))?;
    writer.bytes(&encode_checkpoint(&value.fallback_checkpoint))?;
    writer.u32(value.actual_records.len() as u32);
    for actual in &value.actual_records {
        write_address(&mut writer, &actual.address)?;
        writer.u64(actual.revision);
        writer.u32(actual.byte_length);
        writer.hash(actual.stored_payload_hash);
        writer.hash(actual.actual_payload_hash);
    }
    writer.hash(value.actual_record_set_hash);
    Ok(writer.finish())
}

pub fn decode_historical_fallback_observation_v2(
    bytes: &[u8],
) -> Result<HistoricalFallbackObservationV2, PersistenceError> {
    let mut reader = Reader::new(bytes);
    if reader.take(4)? != b"BWHO" {
        return Err(PersistenceError::new(
            "historical-reconciliation-magic",
            "historical fallback observation magic mismatch",
        ));
    }
    let schema_version = reader.u16()?;
    let world_id = reader.string()?;
    let storage_revision = reader.u64()?;
    let latest_checkpoint = match decode_record(&reader.bytes(PERSISTENCE_PLATFORM_CHUNK_BYTES_V1)?)? {
        PersistenceWireRecord::Checkpoint(value) => value,
        _ => {
            return Err(PersistenceError::new(
                "historical-reconciliation-checkpoint",
                "historical observation latest value is not a checkpoint",
            ));
        }
    };
    let fallback_checkpoint = match decode_record(&reader.bytes(PERSISTENCE_PLATFORM_CHUNK_BYTES_V1)?)? {
        PersistenceWireRecord::Checkpoint(value) => value,
        _ => {
            return Err(PersistenceError::new(
                "historical-reconciliation-checkpoint",
                "historical observation fallback value is not a checkpoint",
            ));
        }
    };
    let count = reader.u32()? as usize;
    if count > MAX_RECORDS_PER_CHECKPOINT_V1 {
        return Err(PersistenceError::new(
            "historical-reconciliation-records",
            "historical fallback observation exceeds the record budget",
        ));
    }
    let mut actual_records = Vec::with_capacity(count);
    for _ in 0..count {
        actual_records.push(HistoricalFallbackActualRecordV2 {
            address: read_address(&mut reader)?,
            revision: reader.u64()?,
            byte_length: reader.u32()?,
            stored_payload_hash: reader.hash()?,
            actual_payload_hash: reader.hash()?,
        });
    }
    let value = HistoricalFallbackObservationV2 {
        schema_version,
        world_id,
        storage_revision,
        latest_checkpoint,
        fallback_checkpoint,
        actual_records,
        actual_record_set_hash: reader.hash()?,
    };
    reader.finish()?;
    value.verify()?;
    Ok(value)
}

#[must_use]
pub fn historical_fallback_observation_payload_hash_v2(bytes: &[u8]) -> CanonicalHash {
    payload_hash(bytes)
}

fn historical_fallback_plan_hash_v2(value: &HistoricalFallbackReconciliationPlanV2) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-historical-fallback-reconciliation-plan-v2");
    hasher.write_u16(value.schema_version);
    hasher.write_u64(value.created_at);
    hasher.write_str(&value.observation_hash.to_hex());
    hasher.write_str(&value.target_checkpoint.checkpoint_id);
    hasher.write_str(&value.target_checkpoint.checkpoint_hash.to_hex());
    hasher.write_u64(value.target_checkpoint.journal_sequence);
    hasher.write_u32(value.copy_records.len() as u32);
    for record in &value.copy_records {
        record.address.write_hash(&mut hasher);
        hasher.write_u64(record.source_revision);
        hasher.write_u64(record.target_revision);
        hasher.write_u32(record.byte_length);
        hasher.write_str(&record.payload_hash.to_hex());
    }
    hasher.write_u32(value.inline_records.len() as u32);
    for record in &value.inline_records {
        record.address.write_hash(&mut hasher);
        hasher.write_u64(record.target_revision);
        hasher.write_bytes(&record.payload);
    }
    hasher.write_u32(value.delete_addresses.len() as u32);
    for address in &value.delete_addresses {
        address.write_hash(&mut hasher);
    }
    hasher.write_str(&value.save_set_hash.to_hex());
    hasher.write_str(&value.manifest_hash.to_hex());
    hasher.write_str(&value.descriptor_hash.to_hex());
    hasher.finish()
}

impl HistoricalFallbackReconciliationPlanV2 {
    pub fn with_calculated_hash(mut self) -> Result<Self, PersistenceError> {
        self.plan_hash = historical_fallback_plan_hash_v2(&self);
        self.verify()?;
        Ok(self)
    }

    pub fn verify(&self) -> Result<(), PersistenceError> {
        if self.schema_version != HISTORICAL_FALLBACK_RECONCILIATION_SCHEMA_V2 {
            return Err(PersistenceError::new(
                "historical-reconciliation-schema",
                "unsupported historical fallback plan schema",
            ));
        }
        self.observation.verify()?;
        self.target_checkpoint.verify()?;
        let observation_bytes = encode_historical_fallback_observation_v2(&self.observation)?;
        if historical_fallback_observation_payload_hash_v2(&observation_bytes) != self.observation_hash {
            return Err(PersistenceError::new(
                "historical-reconciliation-observation",
                "historical fallback plan does not bind its exact observation bytes",
            ));
        }
        let latest = &self.observation.latest_checkpoint;
        if self.created_at != latest.created_at
            || self.target_checkpoint.world_id != self.observation.world_id
            || self.target_checkpoint.generator_hash != latest.generator_hash
            || self.target_checkpoint.content_hash != latest.content_hash
            || self.target_checkpoint.parent_checkpoint_id.as_deref() != Some(latest.checkpoint_id.as_str())
            || self.target_checkpoint.journal_sequence != latest.journal_sequence.saturating_add(1)
        {
            return Err(PersistenceError::new(
                "historical-reconciliation-target",
                "historical fallback target is not the exact next checkpoint after the observed latest head",
            ));
        }
        let total_records = self.copy_records.len().saturating_add(self.inline_records.len());
        if total_records == 0
            || total_records != self.target_checkpoint.records.len()
            || total_records > MAX_RECORDS_PER_CHECKPOINT_V1
        {
            return Err(PersistenceError::new(
                "historical-reconciliation-records",
                "historical fallback plan does not exactly cover its target checkpoint records",
            ));
        }
        let fallback_records = self
            .observation
            .fallback_checkpoint
            .records
            .iter()
            .map(|record| (&record.address, record))
            .collect::<std::collections::BTreeMap<_, _>>();
        let target_records = self
            .target_checkpoint
            .records
            .iter()
            .map(|record| (&record.address, record))
            .collect::<std::collections::BTreeMap<_, _>>();
        let mut planned_addresses = std::collections::BTreeSet::new();
        for record in &self.copy_records {
            let source = fallback_records.get(&record.address).ok_or_else(|| {
                PersistenceError::new(
                    "historical-reconciliation-source",
                    "copy record is absent from the verified fallback checkpoint",
                )
            })?;
            let target = target_records.get(&record.address).ok_or_else(|| {
                PersistenceError::new(
                    "historical-reconciliation-target",
                    "copy record is absent from the target checkpoint",
                )
            })?;
            if !planned_addresses.insert(record.address.clone())
                || record.source_revision != source.revision
                || record.byte_length != source.byte_length
                || record.payload_hash != source.payload_hash
                || record.target_revision != target.revision
                || record.byte_length != target.byte_length
                || record.payload_hash != target.payload_hash
            {
                return Err(PersistenceError::new(
                    "historical-reconciliation-source",
                    "copy record does not bind one exact fallback and target revision",
                ));
            }
        }
        for record in &self.inline_records {
            let target = target_records.get(&record.address).ok_or_else(|| {
                PersistenceError::new(
                    "historical-reconciliation-target",
                    "inline record is absent from the target checkpoint",
                )
            })?;
            if !planned_addresses.insert(record.address.clone())
                || record.target_revision != target.revision
                || record.payload.len() != target.byte_length as usize
                || payload_hash(&record.payload) != target.payload_hash
            {
                return Err(PersistenceError::new(
                    "historical-reconciliation-inline",
                    "inline repair record does not match its exact target descriptor",
                ));
            }
        }
        if planned_addresses.len() != target_records.len() {
            return Err(PersistenceError::new(
                "historical-reconciliation-target",
                "historical fallback plan omits a target record",
            ));
        }
        let actual_addresses = self
            .observation
            .actual_records
            .iter()
            .map(|record| record.address.clone())
            .collect::<std::collections::BTreeSet<_>>();
        let expected_deletes = actual_addresses
            .difference(&planned_addresses)
            .cloned()
            .collect::<Vec<_>>();
        if self.delete_addresses != expected_deletes {
            return Err(PersistenceError::new(
                "historical-reconciliation-delete",
                "historical fallback plan does not delete exactly the observed records outside its target",
            ));
        }
        if self.plan_hash != historical_fallback_plan_hash_v2(self) {
            return Err(PersistenceError::new(
                "historical-reconciliation-plan-hash",
                "historical fallback plan hash mismatch",
            ));
        }
        Ok(())
    }
}

pub fn encode_historical_fallback_reconciliation_plan_v2(
    value: &HistoricalFallbackReconciliationPlanV2,
) -> Result<Vec<u8>, PersistenceError> {
    value.verify()?;
    let mut writer = Writer::default();
    writer.bytes.extend_from_slice(b"BWFP");
    writer.u16(value.schema_version);
    writer.u64(value.created_at);
    writer.bytes(&encode_historical_fallback_observation_v2(&value.observation)?)?;
    writer.hash(value.observation_hash);
    writer.bytes(&encode_checkpoint(&value.target_checkpoint))?;
    writer.u32(value.copy_records.len() as u32);
    for record in &value.copy_records {
        write_address(&mut writer, &record.address)?;
        writer.u64(record.source_revision);
        writer.u64(record.target_revision);
        writer.u32(record.byte_length);
        writer.hash(record.payload_hash);
    }
    writer.u32(value.inline_records.len() as u32);
    for record in &value.inline_records {
        write_address(&mut writer, &record.address)?;
        writer.u64(record.target_revision);
        writer.bytes(&record.payload)?;
    }
    writer.u32(value.delete_addresses.len() as u32);
    for address in &value.delete_addresses {
        write_address(&mut writer, address)?;
    }
    writer.hash(value.save_set_hash);
    writer.hash(value.manifest_hash);
    writer.hash(value.descriptor_hash);
    writer.hash(value.plan_hash);
    let bytes = writer.finish();
    if bytes.len() > PERSISTENCE_PLATFORM_CHUNK_BYTES_V1 {
        return Err(PersistenceError::new(
            "historical-reconciliation-size",
            "historical fallback plan exceeds the bounded platform payload lane",
        ));
    }
    Ok(bytes)
}

pub fn decode_historical_fallback_reconciliation_plan_v2(
    bytes: &[u8],
) -> Result<HistoricalFallbackReconciliationPlanV2, PersistenceError> {
    if bytes.len() > PERSISTENCE_PLATFORM_CHUNK_BYTES_V1 {
        return Err(PersistenceError::new(
            "historical-reconciliation-size",
            "historical fallback plan exceeds the bounded platform payload lane",
        ));
    }
    let mut reader = Reader::new(bytes);
    if reader.take(4)? != b"BWFP" {
        return Err(PersistenceError::new(
            "historical-reconciliation-magic",
            "historical fallback plan magic mismatch",
        ));
    }
    let schema_version = reader.u16()?;
    let created_at = reader.u64()?;
    let observation_bytes = reader.bytes(PERSISTENCE_PLATFORM_CHUNK_BYTES_V1)?;
    let observation = decode_historical_fallback_observation_v2(&observation_bytes)?;
    let observation_hash = reader.hash()?;
    let target_checkpoint = match decode_record(&reader.bytes(PERSISTENCE_PLATFORM_CHUNK_BYTES_V1)?)? {
        PersistenceWireRecord::Checkpoint(value) => value,
        _ => {
            return Err(PersistenceError::new(
                "historical-reconciliation-checkpoint",
                "historical fallback plan target is not a checkpoint",
            ));
        }
    };
    let copy_count = reader.u32()? as usize;
    if copy_count > MAX_RECORDS_PER_CHECKPOINT_V1 {
        return Err(PersistenceError::new(
            "historical-reconciliation-records",
            "historical fallback copy set exceeds the record budget",
        ));
    }
    let mut copy_records = Vec::with_capacity(copy_count);
    for _ in 0..copy_count {
        copy_records.push(HistoricalFallbackCopyRecordV2 {
            address: read_address(&mut reader)?,
            source_revision: reader.u64()?,
            target_revision: reader.u64()?,
            byte_length: reader.u32()?,
            payload_hash: reader.hash()?,
        });
    }
    let inline_count = reader.u32()? as usize;
    if inline_count > MAX_RECORDS_PER_CHECKPOINT_V1.saturating_sub(copy_count) {
        return Err(PersistenceError::new(
            "historical-reconciliation-records",
            "historical fallback inline set exceeds the record budget",
        ));
    }
    let mut inline_records = Vec::with_capacity(inline_count);
    for _ in 0..inline_count {
        inline_records.push(HistoricalFallbackInlineRecordV2 {
            address: read_address(&mut reader)?,
            target_revision: reader.u64()?,
            payload: reader.bytes(MAX_RECORD_BYTES_V1)?,
        });
    }
    let delete_count = reader.u32()? as usize;
    if delete_count > MAX_RECORDS_PER_CHECKPOINT_V1 {
        return Err(PersistenceError::new(
            "historical-reconciliation-records",
            "historical fallback delete set exceeds the record budget",
        ));
    }
    let mut delete_addresses = Vec::with_capacity(delete_count);
    for _ in 0..delete_count {
        delete_addresses.push(read_address(&mut reader)?);
    }
    let value = HistoricalFallbackReconciliationPlanV2 {
        schema_version,
        created_at,
        observation,
        observation_hash,
        target_checkpoint,
        copy_records,
        inline_records,
        delete_addresses,
        save_set_hash: reader.hash()?,
        manifest_hash: reader.hash()?,
        descriptor_hash: reader.hash()?,
        plan_hash: reader.hash()?,
    };
    reader.finish()?;
    value.verify()?;
    Ok(value)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistencePlatformRequestV1 {
    pub request_id: u64,
    pub operation: PersistencePlatformOperationV1,
    pub world_id: String,
    pub object_id: String,
    pub expected_head_hash: Option<CanonicalHash>,
    pub cursor: u64,
    pub limit: u32,
    pub total_bytes: u64,
    pub payload_hash: CanonicalHash,
    pub payload: Vec<u8>,
}

impl PersistencePlatformRequestV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        request_id: u64,
        operation: PersistencePlatformOperationV1,
        world_id: impl Into<String>,
        object_id: impl Into<String>,
        expected_head_hash: Option<CanonicalHash>,
        cursor: u64,
        limit: u32,
        total_bytes: u64,
        payload: Vec<u8>,
    ) -> Result<Self, PersistenceError> {
        let world_id = world_id.into();
        let object_id = object_id.into();
        validate_label(&world_id, 180, "platform.world_id")?;
        if object_id.encode_utf16().count() > 256 {
            return Err(PersistenceError::new(
                "invalid-label",
                "platform.object_id exceeds 256 UTF-16 code units",
            ));
        }
        if payload.len() > PERSISTENCE_PLATFORM_CHUNK_BYTES_V1 {
            return Err(PersistenceError::new(
                "platform-size",
                "platform operation chunk exceeds 4 MiB",
            ));
        }
        if operation == PersistencePlatformOperationV1::ReadRecoveryPage
            && (limit == 0 || limit > PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1)
        {
            return Err(PersistenceError::new(
                "platform-page",
                "recovery page record limit is outside its V1 bounds",
            ));
        }
        let value = Self {
            request_id,
            operation,
            world_id,
            object_id,
            expected_head_hash,
            cursor,
            limit,
            total_bytes,
            payload_hash: platform_payload_hash(&payload),
            payload,
        };
        value.validate_shape()?;
        Ok(value)
    }

    pub fn recover_head(
        request_id: u64,
        world_id: &str,
        checkpoint_id: Option<&str>,
    ) -> Result<Self, PersistenceError> {
        Self::new(
            request_id,
            PersistencePlatformOperationV1::RecoverHead,
            world_id,
            checkpoint_id.unwrap_or_default(),
            None,
            0,
            0,
            0,
            Vec::new(),
        )
    }

    pub fn recovery_page(
        request_id: u64,
        world_id: &str,
        checkpoint_id: &str,
        start_record: u64,
        max_records: u32,
        max_bytes: u32,
    ) -> Result<Self, PersistenceError> {
        if max_bytes == 0 || max_bytes as usize > PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1 {
            return Err(PersistenceError::new(
                "platform-page",
                "recovery page byte limit is outside its V1 bounds",
            ));
        }
        Self::new(
            request_id,
            PersistencePlatformOperationV1::ReadRecoveryPage,
            world_id,
            checkpoint_id,
            None,
            start_record,
            max_records,
            u64::from(max_bytes),
            Vec::new(),
        )
    }

    pub fn estimate(request_id: u64, world_id: &str) -> Result<Self, PersistenceError> {
        Self::new(
            request_id,
            PersistencePlatformOperationV1::Estimate,
            world_id,
            "",
            None,
            0,
            0,
            0,
            Vec::new(),
        )
    }

    pub fn compact(
        request_id: u64,
        world_id: &str,
        checkpoint_id: &str,
        expected_head_hash: CanonicalHash,
        retain_parent_count: u16,
    ) -> Result<Self, PersistenceError> {
        Self::new(
            request_id,
            PersistencePlatformOperationV1::Compact,
            world_id,
            checkpoint_id,
            Some(expected_head_hash),
            0,
            u32::from(retain_parent_count),
            0,
            Vec::new(),
        )
    }

    pub fn delete_world(
        request_id: u64,
        world_id: &str,
        expected_head_hash: Option<CanonicalHash>,
        tombstone: CanonicalHash,
    ) -> Result<Self, PersistenceError> {
        Self::new(
            request_id,
            PersistencePlatformOperationV1::DeleteWorld,
            world_id,
            tombstone.to_hex(),
            expected_head_hash,
            0,
            0,
            0,
            Vec::new(),
        )
    }

    pub fn reconcile_historical_fallback(
        request_id: u64,
        plan: &HistoricalFallbackReconciliationPlanV2,
    ) -> Result<Self, PersistenceError> {
        let payload = encode_historical_fallback_reconciliation_plan_v2(plan)?;
        Self::new(
            request_id,
            PersistencePlatformOperationV1::ReconcileHistoricalFallback,
            plan.observation.world_id.clone(),
            plan.target_checkpoint.checkpoint_hash.to_hex(),
            Some(plan.observation.latest_checkpoint.checkpoint_hash),
            plan.observation.storage_revision,
            u32::try_from(plan.target_checkpoint.records.len()).map_err(|_| {
                PersistenceError::new(
                    "historical-reconciliation-records",
                    "historical fallback target record count exceeds u32",
                )
            })?,
            payload.len() as u64,
            payload,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn chunk(
        request_id: u64,
        operation: PersistencePlatformOperationV1,
        world_id: &str,
        object_id: &str,
        offset: u64,
        total_bytes: u64,
        payload: Vec<u8>,
    ) -> Result<Self, PersistenceError> {
        if !matches!(
            operation,
            PersistencePlatformOperationV1::PreserveLegacyBackupChunk | PersistencePlatformOperationV1::ImportChunk
        ) {
            return Err(PersistenceError::new(
                "platform-operation",
                "chunk constructor requires a chunked write operation",
            ));
        }
        Self::new(
            request_id,
            operation,
            world_id,
            object_id,
            None,
            offset,
            0,
            total_bytes,
            payload,
        )
    }

    fn validate_shape(&self) -> Result<(), PersistenceError> {
        let empty_payload = self.payload.is_empty();
        match self.operation {
            PersistencePlatformOperationV1::RecoverHead | PersistencePlatformOperationV1::Estimate => {
                if !empty_payload
                    || self.cursor != 0
                    || self.limit != 0
                    || self.total_bytes != 0
                    || self.expected_head_hash.is_some()
                {
                    return Err(PersistenceError::new(
                        "platform-shape",
                        "read operation contains forbidden mutation fields",
                    ));
                }
            }
            PersistencePlatformOperationV1::ReadRecoveryPage => {
                if self.object_id.is_empty() || !empty_payload || self.expected_head_hash.is_some() {
                    return Err(PersistenceError::new(
                        "platform-shape",
                        "recovery page request is malformed",
                    ));
                }
            }
            PersistencePlatformOperationV1::Compact => {
                if self.object_id.is_empty()
                    || !empty_payload
                    || self.expected_head_hash.is_none()
                    || self.limit > u32::from(u16::MAX)
                {
                    return Err(PersistenceError::new(
                        "platform-shape",
                        "compaction request is malformed",
                    ));
                }
            }
            PersistencePlatformOperationV1::DeleteWorld => {
                if self.object_id.len() != 32
                    || !empty_payload
                    || self.cursor != 0
                    || self.limit != 0
                    || self.total_bytes != 0
                {
                    return Err(PersistenceError::new(
                        "platform-shape",
                        "world-delete request is malformed",
                    ));
                }
            }
            PersistencePlatformOperationV1::PreserveLegacyBackupChunk | PersistencePlatformOperationV1::ImportChunk => {
                if self.object_id.is_empty()
                    || empty_payload
                    || self.cursor.saturating_add(self.payload.len() as u64) > self.total_bytes
                {
                    return Err(PersistenceError::new(
                        "platform-shape",
                        "chunked write request is malformed",
                    ));
                }
            }
            PersistencePlatformOperationV1::ExportPage => {
                if self.object_id.is_empty()
                    || !empty_payload
                    || self.total_bytes == 0
                    || self.total_bytes as usize > PERSISTENCE_PLATFORM_CHUNK_BYTES_V1
                {
                    return Err(PersistenceError::new(
                        "platform-shape",
                        "export page request is malformed",
                    ));
                }
            }
            PersistencePlatformOperationV1::FinalizeImport => {
                if self.object_id.is_empty() || !empty_payload || self.expected_head_hash.is_none() {
                    return Err(PersistenceError::new(
                        "platform-shape",
                        "finalize-import request is malformed",
                    ));
                }
            }
            PersistencePlatformOperationV1::ReconcileHistoricalFallback => {
                if self.object_id.len() != 32
                    || empty_payload
                    || self.expected_head_hash.is_none()
                    || self.limit == 0
                    || self.total_bytes != self.payload.len() as u64
                {
                    return Err(PersistenceError::new(
                        "platform-shape",
                        "historical fallback reconciliation request is malformed",
                    ));
                }
            }
        }
        if platform_payload_hash(&self.payload) != self.payload_hash {
            return Err(PersistenceError::new(
                "corrupt",
                "platform request payload hash mismatch",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum PersistencePlatformResultCodeV1 {
    Accepted = 1,
    Empty = 2,
    Conflict = 3,
    Quota = 4,
    Corrupt = 5,
    Unavailable = 6,
}

impl PersistencePlatformResultCodeV1 {
    fn from_tag(tag: u8) -> Result<Self, PersistenceError> {
        match tag {
            1 => Ok(Self::Accepted),
            2 => Ok(Self::Empty),
            3 => Ok(Self::Conflict),
            4 => Ok(Self::Quota),
            5 => Ok(Self::Corrupt),
            6 => Ok(Self::Unavailable),
            _ => Err(PersistenceError::new(
                "platform-status",
                "unknown persistence platform status",
            )),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistencePlatformResponseV1 {
    pub request_id: u64,
    pub operation: PersistencePlatformOperationV1,
    pub code: PersistencePlatformResultCodeV1,
    pub storage_revision: u64,
    pub durable_hash: CanonicalHash,
    pub next_cursor: Option<u64>,
    /// Operation-specific bytes. Ordinary pages remain bounded to 4 MiB;
    /// recovery alone admits one maximum record plus bounded framing.
    pub payload: Vec<u8>,
    pub message: String,
}

impl PersistencePlatformResponseV1 {
    pub fn validate_for(&self, request: &PersistencePlatformRequestV1) -> Result<(), PersistenceError> {
        if self.request_id != request.request_id || self.operation != request.operation {
            return Err(PersistenceError::new(
                "platform-response",
                "BWPA does not match its BWPR request identity",
            ));
        }
        validate_platform_response_payload_v1(self.operation, &self.payload)?;
        if self.code == PersistencePlatformResultCodeV1::Accepted
            && is_durable_mutation(request.operation)
            && self.durable_hash == CanonicalHash::default()
        {
            return Err(PersistenceError::new(
                "platform-response",
                "accepted durable mutation returned a zero durable hash",
            ));
        }
        if self.code == PersistencePlatformResultCodeV1::Accepted
            && request.operation == PersistencePlatformOperationV1::ReconcileHistoricalFallback
        {
            let expected_revision = request.cursor.checked_add(1).ok_or_else(|| {
                PersistenceError::new(
                    "platform-response",
                    "historical fallback reconciliation storage revision successor overflows",
                )
            })?;
            if self.storage_revision != expected_revision
                || self.durable_hash.to_hex() != request.object_id
                || !self.payload.is_empty()
                || self.next_cursor.is_some()
            {
                return Err(PersistenceError::new(
                    "platform-response",
                    "historical fallback reconciliation acknowledgement does not exactly bind the Rust-issued repair intent",
                ));
            }
        }
        if self.code != PersistencePlatformResultCodeV1::Accepted
            && (self.storage_revision != 0
                || self.durable_hash != CanonicalHash::default()
                || !self.payload.is_empty()
                || self.next_cursor.is_some())
        {
            return Err(PersistenceError::new(
                "platform-response",
                "rejected platform operation attempted to advance or attest durable state",
            ));
        }
        Ok(())
    }
}

pub fn encode_persistence_platform_request_v1(
    request: &PersistencePlatformRequestV1,
) -> Result<Vec<u8>, PersistenceError> {
    request.validate_shape()?;
    let mut writer = Writer::default();
    writer.string(&request.world_id)?;
    writer.string(&request.object_id)?;
    writer.u8(u8::from(request.expected_head_hash.is_some()));
    if let Some(hash) = request.expected_head_hash {
        writer.hash(hash);
    }
    writer.u64(request.cursor);
    writer.u32(request.limit);
    writer.u64(request.total_bytes);
    writer.hash(request.payload_hash);
    writer.bytes(&request.payload)?;
    wrap(
        REQUEST_MAGIC,
        request.operation as u16,
        request.request_id,
        writer.finish(),
    )
}

pub fn decode_persistence_platform_request_v1(bytes: &[u8]) -> Result<PersistencePlatformRequestV1, PersistenceError> {
    let (kind, request_id, payload) = unwrap(REQUEST_MAGIC, bytes)?;
    let operation = PersistencePlatformOperationV1::from_tag(kind)?;
    let mut reader = Reader::new(payload);
    let value = PersistencePlatformRequestV1 {
        request_id,
        operation,
        world_id: reader.string()?,
        object_id: reader.string()?,
        expected_head_hash: if reader.flag()? { Some(reader.hash()?) } else { None },
        cursor: reader.u64()?,
        limit: reader.u32()?,
        total_bytes: reader.u64()?,
        payload_hash: reader.hash()?,
        payload: reader.bytes(PERSISTENCE_PLATFORM_CHUNK_BYTES_V1)?,
    };
    reader.finish()?;
    value.validate_shape()?;
    Ok(value)
}

pub fn encode_persistence_platform_response_v1(
    response: &PersistencePlatformResponseV1,
) -> Result<Vec<u8>, PersistenceError> {
    validate_platform_response_payload_v1(response.operation, &response.payload)?;
    let mut writer = Writer::default();
    writer.u16(response.operation as u16);
    writer.u8(response.code as u8);
    writer.u64(response.storage_revision);
    writer.hash(response.durable_hash);
    writer.u8(u8::from(response.next_cursor.is_some()));
    if let Some(cursor) = response.next_cursor {
        writer.u64(cursor);
    }
    writer.bytes(&response.payload)?;
    writer.string(&response.message)?;
    wrap(RESPONSE_MAGIC, RESPONSE_OPERATION, response.request_id, writer.finish())
}

pub fn decode_persistence_platform_response_v1(
    bytes: &[u8],
) -> Result<PersistencePlatformResponseV1, PersistenceError> {
    let (kind, request_id, payload) = unwrap(RESPONSE_MAGIC, bytes)?;
    if kind != RESPONSE_OPERATION {
        return Err(PersistenceError::new(
            "platform-response",
            "BWPA is not a persistence platform operation response",
        ));
    }
    let mut reader = Reader::new(payload);
    let operation = PersistencePlatformOperationV1::from_tag(reader.u16()?)?;
    let value = PersistencePlatformResponseV1 {
        request_id,
        operation,
        code: PersistencePlatformResultCodeV1::from_tag(reader.u8()?)?,
        storage_revision: reader.u64()?,
        durable_hash: reader.hash()?,
        next_cursor: if reader.flag()? { Some(reader.u64()?) } else { None },
        payload: reader.bytes(platform_response_payload_limit_v1(operation))?,
        message: reader.string()?,
    };
    reader.finish()?;
    validate_platform_response_payload_v1(value.operation, &value.payload)?;
    Ok(value)
}

const fn platform_response_payload_limit_v1(operation: PersistencePlatformOperationV1) -> usize {
    if matches!(operation, PersistencePlatformOperationV1::ReadRecoveryPage) {
        PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1
    } else {
        PERSISTENCE_PLATFORM_CHUNK_BYTES_V1
    }
}

fn validate_platform_response_payload_v1(
    operation: PersistencePlatformOperationV1,
    payload: &[u8],
) -> Result<(), PersistenceError> {
    if payload.len() <= platform_response_payload_limit_v1(operation) {
        return Ok(());
    }
    let message = if operation == PersistencePlatformOperationV1::ReadRecoveryPage {
        "recovery page payload exceeds the 64 MiB record plus 64 KiB overhead budget"
    } else {
        "BWPA operation payload exceeds 4 MiB"
    };
    Err(PersistenceError::new("platform-size", message))
}

fn is_durable_mutation(operation: PersistencePlatformOperationV1) -> bool {
    matches!(
        operation,
        PersistencePlatformOperationV1::Compact
            | PersistencePlatformOperationV1::DeleteWorld
            | PersistencePlatformOperationV1::PreserveLegacyBackupChunk
            | PersistencePlatformOperationV1::ImportChunk
            | PersistencePlatformOperationV1::FinalizeImport
            | PersistencePlatformOperationV1::ReconcileHistoricalFallback
    )
}

fn platform_payload_hash(payload: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-persistence-platform-payload-v1");
    hasher.write_bytes(payload);
    hasher.finish()
}

fn wrap(magic: [u8; 4], kind: u16, request_id: u64, payload: Vec<u8>) -> Result<Vec<u8>, PersistenceError> {
    if payload.len() > PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1 - PERSISTENCE_BROWSER_HEADER_BYTES_V1 {
        return Err(PersistenceError::new(
            "platform-size",
            "persistence platform packet exceeds its V1 budget",
        ));
    }
    let mut output = Vec::with_capacity(PERSISTENCE_BROWSER_HEADER_BYTES_V1 + payload.len());
    output.extend_from_slice(&magic);
    output.extend_from_slice(&PERSISTENCE_BROWSER_PROTOCOL_V1.to_le_bytes());
    output.extend_from_slice(&kind.to_le_bytes());
    output.extend_from_slice(&request_id.to_le_bytes());
    output.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    output.extend_from_slice(browser_hash(&payload).as_bytes());
    output.extend_from_slice(&payload);
    Ok(output)
}

fn unwrap(magic: [u8; 4], bytes: &[u8]) -> Result<(u16, u64, &[u8]), PersistenceError> {
    if bytes.len() < PERSISTENCE_BROWSER_HEADER_BYTES_V1 || bytes.len() > PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1 {
        return Err(PersistenceError::new(
            "platform-size",
            "persistence platform packet is outside its V1 bounds",
        ));
    }
    if bytes[..4] != magic {
        return Err(PersistenceError::new(
            "platform-magic",
            "persistence platform packet magic mismatch",
        ));
    }
    if u16::from_le_bytes(bytes[4..6].try_into().expect("fixed slice")) != PERSISTENCE_BROWSER_PROTOCOL_V1 {
        return Err(PersistenceError::new(
            "platform-protocol",
            "unsupported persistence platform protocol",
        ));
    }
    let kind = u16::from_le_bytes(bytes[6..8].try_into().expect("fixed slice"));
    let request_id = u64::from_le_bytes(bytes[8..16].try_into().expect("fixed slice"));
    let length = u32::from_le_bytes(bytes[16..20].try_into().expect("fixed slice")) as usize;
    if length != bytes.len() - PERSISTENCE_BROWSER_HEADER_BYTES_V1 {
        return Err(PersistenceError::new(
            "platform-length",
            "persistence platform packet length mismatch",
        ));
    }
    let expected = CanonicalHash(bytes[20..36].try_into().expect("fixed slice"));
    let payload = &bytes[PERSISTENCE_BROWSER_HEADER_BYTES_V1..];
    if browser_hash(payload) != expected {
        return Err(PersistenceError::new(
            "platform-checksum",
            "persistence platform packet checksum mismatch",
        ));
    }
    Ok((kind, request_id, payload))
}

fn browser_hash(payload: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-persistence-browser-runtime-v1");
    hasher.write_bytes(payload);
    hasher.finish()
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}
impl Writer {
    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }
    fn u16(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn hash(&mut self, value: CanonicalHash) {
        self.bytes.extend_from_slice(value.as_bytes());
    }
    fn bytes(&mut self, value: &[u8]) -> Result<(), PersistenceError> {
        self.u32(
            u32::try_from(value.len())
                .map_err(|_| PersistenceError::new("platform-size", "platform field exceeds u32"))?,
        );
        self.bytes.extend_from_slice(value);
        Ok(())
    }
    fn string(&mut self, value: &str) -> Result<(), PersistenceError> {
        self.bytes(value.as_bytes())
    }
    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8], PersistenceError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| PersistenceError::new("platform-overflow", "platform offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| PersistenceError::new("platform-truncated", "platform packet is truncated"))?;
        self.offset = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, PersistenceError> {
        Ok(self.take(1)?[0])
    }
    fn flag(&mut self) -> Result<bool, PersistenceError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(PersistenceError::new("platform-flag", "platform flag is not 0 or 1")),
        }
    }
    fn u16(&mut self) -> Result<u16, PersistenceError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("fixed slice")))
    }
    fn u32(&mut self) -> Result<u32, PersistenceError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("fixed slice")))
    }
    fn u64(&mut self) -> Result<u64, PersistenceError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().expect("fixed slice")))
    }
    fn hash(&mut self) -> Result<CanonicalHash, PersistenceError> {
        Ok(CanonicalHash(self.take(16)?.try_into().expect("fixed slice")))
    }
    fn bytes(&mut self, maximum: usize) -> Result<Vec<u8>, PersistenceError> {
        let length = self.u32()? as usize;
        if length > maximum {
            return Err(PersistenceError::new(
                "platform-size",
                "platform field exceeds its budget",
            ));
        }
        Ok(self.take(length)?.to_vec())
    }
    fn string(&mut self) -> Result<String, PersistenceError> {
        String::from_utf8(self.bytes(4096)?)
            .map_err(|_| PersistenceError::new("platform-utf8", "platform string is not valid UTF-8"))
    }
    fn finish(&self) -> Result<(), PersistenceError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(PersistenceError::new(
                "platform-trailing",
                "platform packet contains trailing bytes",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn administrative_bwpr_bwpa_round_trip_and_bind_operation_identity() {
        let request = PersistencePlatformRequestV1::compact(7, "world", "cp", CanonicalHash([1; 16]), 2).unwrap();
        assert_eq!(
            decode_persistence_platform_request_v1(&encode_persistence_platform_request_v1(&request).unwrap()).unwrap(),
            request
        );
        let response = PersistencePlatformResponseV1 {
            request_id: 7,
            operation: PersistencePlatformOperationV1::Compact,
            code: PersistencePlatformResultCodeV1::Accepted,
            storage_revision: 4,
            durable_hash: CanonicalHash([2; 16]),
            next_cursor: None,
            payload: Vec::new(),
            message: "ok".into(),
        };
        let decoded =
            decode_persistence_platform_response_v1(&encode_persistence_platform_response_v1(&response).unwrap())
                .unwrap();
        decoded.validate_for(&request).unwrap();
        assert_eq!(decoded, response);
    }
    #[test]
    fn chunk_bounds_prevent_monolithic_backup_or_import_packets() {
        let oversized = vec![0; PERSISTENCE_PLATFORM_CHUNK_BYTES_V1 + 1];
        assert_eq!(
            PersistencePlatformRequestV1::chunk(
                1,
                PersistencePlatformOperationV1::ImportChunk,
                "w",
                "i",
                0,
                oversized.len() as u64,
                oversized
            )
            .unwrap_err()
            .code,
            "platform-size"
        );
    }
}
