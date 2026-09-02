//! Durable provenance for the narrow world-only legacy migration.
//!
//! The descriptor is deliberately a normal Rust-owned save record. Its
//! canonical address sorts before every other current save record, so every
//! non-empty cumulative migration checkpoint contains enough provenance for a
//! fresh runtime to validate and resume the exact intended save set.

use crate::{MAX_RECORDS_PER_CHECKPOINT_V1, PersistenceError, RecordAddress, RecordKind, validate_label};
use blockwild_types::{CanonicalHash, CanonicalHasher};

pub const LEGACY_MIGRATION_DESCRIPTOR_SCHEMA_V1: u16 = 1;
pub const LEGACY_MIGRATION_DESCRIPTOR_RECORD_ID_V1: &str = "legacy-migration-descriptor-v1";
const LEGACY_MIGRATION_DESCRIPTOR_MAGIC_V1: &[u8; 4] = b"BWLM";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyMigrationNativeRecordFingerprintV1 {
    pub address: RecordAddress,
    pub byte_length: u32,
    pub payload_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyMigrationDescriptorV1 {
    pub schema_version: u16,
    pub migration_id: String,
    pub created_at: u64,
    pub source_key: String,
    pub source_format: String,
    pub source_byte_length: u64,
    pub source_hash: CanonicalHash,
    pub projection_hash: CanonicalHash,
    pub projection_edit_count: u64,
    pub projection_facing_count: u64,
    pub native_world_semantic_hash: CanonicalHash,
    pub native_world_edit_count: u64,
    pub native_world_facing_count: u64,
    pub world_id: String,
    pub universe_id: String,
    pub location_id: String,
    /// Session encoded into the intended native bundle. It is provenance for
    /// byte-exact restart resume, not part of the immutable target identity.
    pub native_session_id: String,
    pub world_seed: String,
    pub generator_hash: CanonicalHash,
    pub content_hash: CanonicalHash,
    pub terrain_content_hash: CanonicalHash,
    pub generation_options_hash: CanonicalHash,
    pub backup_byte_length: u64,
    pub backup_hash: CanonicalHash,
    pub backup_chunks: u32,
    pub native_records: Vec<LegacyMigrationNativeRecordFingerprintV1>,
    pub native_record_set_hash: CanonicalHash,
    pub descriptor_hash: CanonicalHash,
}

impl LegacyMigrationDescriptorV1 {
    pub fn with_calculated_hash(mut self) -> Result<Self, PersistenceError> {
        self.native_record_set_hash = legacy_migration_native_record_set_hash_v1(&self.native_records)?;
        self.descriptor_hash = legacy_migration_descriptor_hash_v1(&self)?;
        self.verify()?;
        Ok(self)
    }

    pub fn verify(&self) -> Result<(), PersistenceError> {
        if self.schema_version != LEGACY_MIGRATION_DESCRIPTOR_SCHEMA_V1 {
            return Err(PersistenceError::new(
                "legacy-migration-descriptor-schema",
                "unsupported legacy migration descriptor schema",
            ));
        }
        validate_label(&self.migration_id, 180, "legacy migration id")?;
        validate_label(&self.source_key, 512, "legacy source key")?;
        validate_label(&self.source_format, 128, "legacy source format")?;
        validate_label(&self.world_id, 180, "legacy target world id")?;
        validate_label(&self.universe_id, 64, "legacy target universe id")?;
        validate_label(&self.location_id, 128, "legacy target location id")?;
        validate_label(&self.native_session_id, 256, "legacy native record session id")?;
        if self.world_seed.encode_utf16().count() > 512 {
            return Err(PersistenceError::new(
                "legacy-migration-descriptor-seed",
                "legacy target world seed exceeds 512 UTF-16 code units",
            ));
        }
        if self.source_byte_length == 0 || self.backup_byte_length != self.source_byte_length || self.backup_chunks == 0
        {
            return Err(PersistenceError::new(
                "legacy-migration-descriptor-backup",
                "legacy source and backup byte identities are incomplete",
            ));
        }
        if self.native_records.is_empty() || self.native_records.len() >= MAX_RECORDS_PER_CHECKPOINT_V1 {
            return Err(PersistenceError::new(
                "legacy-migration-descriptor-records",
                "legacy intended native record set is empty or exceeds its bound",
            ));
        }
        let descriptor_address = legacy_migration_descriptor_address_v1(&self.universe_id, &self.location_id)?;
        let mut previous: Option<&RecordAddress> = None;
        for record in &self.native_records {
            if record.byte_length == 0
                || record.address == descriptor_address
                || previous.is_some_and(|address| address >= &record.address)
            {
                return Err(PersistenceError::new(
                    "legacy-migration-descriptor-records",
                    "legacy intended native records are empty, duplicate, or not canonically sorted",
                ));
            }
            previous = Some(&record.address);
        }
        if legacy_migration_native_record_set_hash_v1(&self.native_records)? != self.native_record_set_hash {
            return Err(PersistenceError::new(
                "legacy-migration-descriptor-records",
                "legacy intended native record fingerprint is corrupt",
            ));
        }
        if legacy_migration_descriptor_hash_v1(self)? != self.descriptor_hash {
            return Err(PersistenceError::new(
                "legacy-migration-descriptor-hash",
                "legacy migration descriptor fingerprint is corrupt",
            ));
        }
        Ok(())
    }
}

pub fn legacy_migration_descriptor_address_v1(
    universe_id: &str,
    location_id: &str,
) -> Result<RecordAddress, PersistenceError> {
    RecordAddress::new(
        universe_id,
        location_id,
        RecordKind::ActorDigest,
        LEGACY_MIGRATION_DESCRIPTOR_RECORD_ID_V1,
    )
}

#[must_use]
pub fn persistence_payload_hash_v1(bytes: &[u8]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-persistence-record-v1");
    hasher.write_bytes(bytes);
    hasher.finish()
}

#[must_use]
pub fn legacy_generation_options_hash_v1(canonical_json: &str) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-legacy-migration-generation-options-v1");
    hasher.write_str(canonical_json);
    hasher.finish()
}

pub fn legacy_migration_native_record_set_hash_v1(
    records: &[LegacyMigrationNativeRecordFingerprintV1],
) -> Result<CanonicalHash, PersistenceError> {
    let mut previous: Option<&RecordAddress> = None;
    let mut hasher = CanonicalHasher::new("blockwild-legacy-migration-native-record-set-v1");
    hasher.write_u32(u32::try_from(records.len()).map_err(|_| {
        PersistenceError::new("legacy-migration-descriptor-records", "native record count exceeds u32")
    })?);
    for record in records {
        if record.byte_length == 0 || previous.is_some_and(|address| address >= &record.address) {
            return Err(PersistenceError::new(
                "legacy-migration-descriptor-records",
                "native record fingerprints are empty, duplicate, or not canonically sorted",
            ));
        }
        hasher.write_str(&record.address.universe_id);
        hasher.write_str(&record.address.location_id);
        hasher.write_str(record.address.kind.as_str());
        hasher.write_str(&record.address.record_id);
        hasher.write_u32(record.byte_length);
        hasher.write_bytes(record.payload_hash.as_bytes());
        previous = Some(&record.address);
    }
    Ok(hasher.finish())
}

pub fn legacy_migration_descriptor_hash_v1(
    value: &LegacyMigrationDescriptorV1,
) -> Result<CanonicalHash, PersistenceError> {
    let mut hasher = CanonicalHasher::new("blockwild-legacy-migration-descriptor-v1");
    hasher.write_u16(value.schema_version);
    hasher.write_str(&value.migration_id);
    hasher.write_u64(value.created_at);
    hasher.write_str(&value.source_key);
    hasher.write_str(&value.source_format);
    hasher.write_u64(value.source_byte_length);
    hasher.write_bytes(value.source_hash.as_bytes());
    hasher.write_bytes(value.projection_hash.as_bytes());
    hasher.write_u64(value.projection_edit_count);
    hasher.write_u64(value.projection_facing_count);
    hasher.write_bytes(value.native_world_semantic_hash.as_bytes());
    hasher.write_u64(value.native_world_edit_count);
    hasher.write_u64(value.native_world_facing_count);
    hasher.write_str(&value.world_id);
    hasher.write_str(&value.universe_id);
    hasher.write_str(&value.location_id);
    hasher.write_str(&value.native_session_id);
    hasher.write_str(&value.world_seed);
    hasher.write_bytes(value.generator_hash.as_bytes());
    hasher.write_bytes(value.content_hash.as_bytes());
    hasher.write_bytes(value.terrain_content_hash.as_bytes());
    hasher.write_bytes(value.generation_options_hash.as_bytes());
    hasher.write_u64(value.backup_byte_length);
    hasher.write_bytes(value.backup_hash.as_bytes());
    hasher.write_u32(value.backup_chunks);
    hasher.write_bytes(value.native_record_set_hash.as_bytes());
    Ok(hasher.finish())
}

pub fn encode_legacy_migration_descriptor_v1(value: &LegacyMigrationDescriptorV1) -> Result<Vec<u8>, PersistenceError> {
    value.verify()?;
    let mut writer = Writer::default();
    writer.raw(LEGACY_MIGRATION_DESCRIPTOR_MAGIC_V1);
    writer.u16(value.schema_version);
    writer.string(&value.migration_id)?;
    writer.u64(value.created_at);
    writer.string(&value.source_key)?;
    writer.string(&value.source_format)?;
    writer.u64(value.source_byte_length);
    writer.hash(value.source_hash);
    writer.hash(value.projection_hash);
    writer.u64(value.projection_edit_count);
    writer.u64(value.projection_facing_count);
    writer.hash(value.native_world_semantic_hash);
    writer.u64(value.native_world_edit_count);
    writer.u64(value.native_world_facing_count);
    writer.string(&value.world_id)?;
    writer.string(&value.universe_id)?;
    writer.string(&value.location_id)?;
    writer.string(&value.native_session_id)?;
    writer.string(&value.world_seed)?;
    writer.hash(value.generator_hash);
    writer.hash(value.content_hash);
    writer.hash(value.terrain_content_hash);
    writer.hash(value.generation_options_hash);
    writer.u64(value.backup_byte_length);
    writer.hash(value.backup_hash);
    writer.u32(value.backup_chunks);
    writer.u32(u32::try_from(value.native_records.len()).map_err(|_| {
        PersistenceError::new("legacy-migration-descriptor-records", "native record count exceeds u32")
    })?);
    for record in &value.native_records {
        writer.address(&record.address)?;
        writer.u32(record.byte_length);
        writer.hash(record.payload_hash);
    }
    writer.hash(value.native_record_set_hash);
    writer.hash(value.descriptor_hash);
    Ok(writer.finish())
}

pub fn decode_legacy_migration_descriptor_v1(bytes: &[u8]) -> Result<LegacyMigrationDescriptorV1, PersistenceError> {
    let mut reader = Reader::new(bytes);
    if reader.take(4)? != LEGACY_MIGRATION_DESCRIPTOR_MAGIC_V1 {
        return Err(PersistenceError::new(
            "legacy-migration-descriptor-magic",
            "legacy migration descriptor magic mismatch",
        ));
    }
    let schema_version = reader.u16()?;
    let migration_id = reader.string(180)?;
    let created_at = reader.u64()?;
    let source_key = reader.string(512)?;
    let source_format = reader.string(128)?;
    let source_byte_length = reader.u64()?;
    let source_hash = reader.hash()?;
    let projection_hash = reader.hash()?;
    let projection_edit_count = reader.u64()?;
    let projection_facing_count = reader.u64()?;
    let native_world_semantic_hash = reader.hash()?;
    let native_world_edit_count = reader.u64()?;
    let native_world_facing_count = reader.u64()?;
    let world_id = reader.string(180)?;
    let universe_id = reader.string(64)?;
    let location_id = reader.string(128)?;
    let native_session_id = reader.string(256)?;
    let world_seed = reader.string(512)?;
    let generator_hash = reader.hash()?;
    let content_hash = reader.hash()?;
    let terrain_content_hash = reader.hash()?;
    let generation_options_hash = reader.hash()?;
    let backup_byte_length = reader.u64()?;
    let backup_hash = reader.hash()?;
    let backup_chunks = reader.u32()?;
    let count = reader.u32()? as usize;
    if count == 0 || count >= MAX_RECORDS_PER_CHECKPOINT_V1 {
        return Err(PersistenceError::new(
            "legacy-migration-descriptor-records",
            "legacy intended native record count is outside its bound",
        ));
    }
    let mut native_records = Vec::with_capacity(count);
    for _ in 0..count {
        native_records.push(LegacyMigrationNativeRecordFingerprintV1 {
            address: reader.address()?,
            byte_length: reader.u32()?,
            payload_hash: reader.hash()?,
        });
    }
    let value = LegacyMigrationDescriptorV1 {
        schema_version,
        migration_id,
        created_at,
        source_key,
        source_format,
        source_byte_length,
        source_hash,
        projection_hash,
        projection_edit_count,
        projection_facing_count,
        native_world_semantic_hash,
        native_world_edit_count,
        native_world_facing_count,
        world_id,
        universe_id,
        location_id,
        native_session_id,
        world_seed,
        generator_hash,
        content_hash,
        terrain_content_hash,
        generation_options_hash,
        backup_byte_length,
        backup_hash,
        backup_chunks,
        native_records,
        native_record_set_hash: reader.hash()?,
        descriptor_hash: reader.hash()?,
    };
    reader.finish()?;
    value.verify()?;
    Ok(value)
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn raw(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }
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
        self.raw(value.as_bytes());
    }
    fn string(&mut self, value: &str) -> Result<(), PersistenceError> {
        let bytes = value.as_bytes();
        self.u32(
            u32::try_from(bytes.len()).map_err(|_| {
                PersistenceError::new("legacy-migration-descriptor-size", "descriptor string exceeds u32")
            })?,
        );
        self.raw(bytes);
        Ok(())
    }
    fn address(&mut self, value: &RecordAddress) -> Result<(), PersistenceError> {
        self.string(&value.universe_id)?;
        self.string(&value.location_id)?;
        self.u8(value.kind as u8);
        self.string(&value.record_id)
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
        let end = self.offset.checked_add(length).ok_or_else(|| {
            PersistenceError::new("legacy-migration-descriptor-overflow", "descriptor offset overflow")
        })?;
        let value = self.bytes.get(self.offset..end).ok_or_else(|| {
            PersistenceError::new(
                "legacy-migration-descriptor-truncated",
                "legacy migration descriptor is truncated",
            )
        })?;
        self.offset = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, PersistenceError> {
        Ok(self.take(1)?[0])
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
    fn string(&mut self, maximum_utf16: usize) -> Result<String, PersistenceError> {
        let length = self.u32()? as usize;
        let value = String::from_utf8(self.take(length)?.to_vec()).map_err(|_| {
            PersistenceError::new(
                "legacy-migration-descriptor-utf8",
                "descriptor string is not valid UTF-8",
            )
        })?;
        if value.encode_utf16().count() > maximum_utf16 {
            return Err(PersistenceError::new(
                "legacy-migration-descriptor-size",
                "descriptor string exceeds its bounded length",
            ));
        }
        Ok(value)
    }
    fn address(&mut self) -> Result<RecordAddress, PersistenceError> {
        RecordAddress::new(
            self.string(64)?,
            self.string(128)?,
            RecordKind::from_tag(self.u8()?)?,
            self.string(256)?,
        )
    }
    fn finish(&self) -> Result<(), PersistenceError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(PersistenceError::new(
                "legacy-migration-descriptor-trailing",
                "legacy migration descriptor contains trailing bytes",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash(byte: u8) -> CanonicalHash {
        CanonicalHash([byte; 16])
    }

    fn fixture() -> LegacyMigrationDescriptorV1 {
        LegacyMigrationDescriptorV1 {
            schema_version: LEGACY_MIGRATION_DESCRIPTOR_SCHEMA_V1,
            migration_id: "legacy.world-only.v1.source.projection.2t".into(),
            created_at: 101,
            source_key: "blockwild-world-data-v1:fixture".into(),
            source_format: "blockwild-world-save-canonical-v1".into(),
            source_byte_length: 12,
            source_hash: hash(1),
            projection_hash: hash(2),
            projection_edit_count: 3,
            projection_facing_count: 1,
            native_world_semantic_hash: hash(9),
            native_world_edit_count: 3,
            native_world_facing_count: 1,
            world_id: "world:fixture@overworld".into(),
            universe_id: "world:fixture".into(),
            location_id: "overworld".into(),
            native_session_id: "runtime.fixture".into(),
            world_seed: "water-🌿".into(),
            generator_hash: hash(3),
            content_hash: hash(4),
            terrain_content_hash: hash(5),
            generation_options_hash: hash(6),
            backup_byte_length: 12,
            backup_hash: hash(7),
            backup_chunks: 1,
            native_records: vec![LegacyMigrationNativeRecordFingerprintV1 {
                address: RecordAddress::new("world:fixture", "overworld", RecordKind::ChunkEdits, "rust-world-r4-v1")
                    .unwrap(),
                byte_length: 9,
                payload_hash: hash(8),
            }],
            native_record_set_hash: CanonicalHash::default(),
            descriptor_hash: CanonicalHash::default(),
        }
        .with_calculated_hash()
        .unwrap()
    }

    #[test]
    fn descriptor_round_trips_and_binds_every_provenance_lane() {
        let value = fixture();
        let encoded = encode_legacy_migration_descriptor_v1(&value).unwrap();
        assert_eq!(decode_legacy_migration_descriptor_v1(&encoded).unwrap(), value);

        let mut tampered = value;
        tampered.source_key.push_str(":other");
        assert_eq!(tampered.verify().unwrap_err().code, "legacy-migration-descriptor-hash");
    }

    #[test]
    fn descriptor_address_sorts_before_current_native_records() {
        let descriptor = legacy_migration_descriptor_address_v1("u", "overworld").unwrap();
        let gameplay = RecordAddress::new("u", "overworld", RecordKind::ActorDigest, "rust-gameplay-r7-v1").unwrap();
        let world = RecordAddress::new("u", "overworld", RecordKind::ChunkEdits, "rust-world-r4-v1").unwrap();
        assert!(descriptor < gameplay);
        assert!(descriptor < world);
    }
}
