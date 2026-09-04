//! Opaque TypeScript `StoredWorld` custody for historical rich saves.
//!
//! `BWHP` is an unbound browser proposal: it contains the immutable migration
//! proof plus the exact external-document CAS head, but no claim about records
//! Rust has not built yet. Rust binds the exact six primary native records and
//! only then emits the durable `BWHE` descriptor. Neither form interprets rich
//! state or grants authority beyond the admitted R4 BWAS projection.

use crate::{
    MAX_RECORD_BYTES_V1, PersistenceError, RecordAddress, RecordKind, persistence_payload_hash_v1, validate_label,
};
use blockwild_types::{CanonicalHash, CanonicalHasher};

pub const HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2: u16 = 2;
pub const HISTORICAL_EXTERNAL_DESCRIPTOR_RECORD_ID_V2: &str = "historical-external-descriptor-v2";
pub const HISTORICAL_EXTERNAL_DOCUMENT_RECORD_PREFIX_V2: &str = "historical-external-document-v2-";
pub const HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2: u32 = 4 * 1024 * 1024;
pub const HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2: u64 = 64 * 1024 * 1024;
pub const HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2: &str =
    "rust-terrain-generation-plus-typescript-historical-save-compatibility-only";
pub const HISTORICAL_EXTERNAL_PROFILE_V2: &str = "typescript-historical-save-compatibility-v1";
pub const HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2: &str = "world-r4-projection-only";
pub const HISTORICAL_EXTERNAL_DESCRIPTOR_MAGIC_V2: &[u8; 4] = b"BWHE";
pub const HISTORICAL_EXTERNAL_PROPOSAL_MAGIC_V2: &[u8; 4] = b"BWHP";

pub const HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2: [(RecordKind, &str); 6] = [
    (RecordKind::ActorDigest, "rust-gameplay-r7-v1"),
    (RecordKind::ChunkEdits, "rust-world-r4-v1"),
    (RecordKind::Entity, "rust-entity-r6-v2"),
    (RecordKind::MapKnowledge, "rust-world-view-r7-v1"),
    (RecordKind::Player, "rust-runtime-core-v2"),
    (RecordKind::SettingsReference, "rust-content-registry-v1"),
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalDocumentIdentityV2 {
    pub hash: CanonicalHash,
    pub sha256: [u8; 32],
    pub byte_length: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalDocumentRevisionIdentityV2 {
    pub identity: HistoricalDocumentIdentityV2,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalImportSourceV2 {
    pub schema_version: u16,
    pub provenance: String,
    pub source_format: String,
    pub encoding: String,
    pub archive_world_id: String,
    pub object_id: String,
    pub raw_sha256: [u8; 32],
    pub byte_length: u64,
    pub generator_version: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalAuthorityV2 {
    pub claim: String,
    pub native_player: String,
    pub native_rich_state: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalGenerationIdentityV2 {
    pub schema_version: u16,
    pub generator_hash: CanonicalHash,
    pub terrain_content_hash: CanonicalHash,
    pub generation_options_json: String,
    pub generation_options_hash: CanonicalHash,
    pub generation_options_byte_length: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalTargetV2 {
    pub catalog_world_id: String,
    pub universe_id: String,
    pub location_id: String,
    pub world_seed: String,
    pub content_hash: CanonicalHash,
    pub generation_identity: HistoricalExternalGenerationIdentityV2,
    pub options_semantic_hash: CanonicalHash,
    pub options_byte_length: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalBwasV2 {
    pub projection_hash: CanonicalHash,
    pub projection_byte_length: u64,
    pub compatibility_checksum: CanonicalHash,
    pub extension_checksum: CanonicalHash,
    pub edit_count: u64,
    pub facing_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalImmutableV2 {
    pub authority: HistoricalExternalAuthorityV2,
    pub profile: String,
    pub native_execution_scope: String,
    pub source: HistoricalExternalImportSourceV2,
    pub initial_document: HistoricalDocumentIdentityV2,
    pub plan_hash: CanonicalHash,
    pub custody_root: CanonicalHash,
    pub external_state_flags: u16,
    pub target: HistoricalExternalTargetV2,
    pub bwas: HistoricalExternalBwasV2,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalDocumentChunkFingerprintV2 {
    pub index: u32,
    pub byte_offset: u64,
    pub byte_length: u32,
    pub payload_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalFieldsV2 {
    pub current_document: HistoricalDocumentRevisionIdentityV2,
    pub expected_previous_document: Option<HistoricalDocumentRevisionIdentityV2>,
    pub chunks: Vec<HistoricalExternalDocumentChunkFingerprintV2>,
    pub chunk_set_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalNativeRecordFingerprintV2 {
    pub address: RecordAddress,
    pub revision: u64,
    pub byte_length: u32,
    pub payload_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalDescriptorProposalV2 {
    pub schema_version: u16,
    pub immutable: HistoricalExternalImmutableV2,
    pub external: HistoricalExternalFieldsV2,
    pub proposal_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalMutableV2 {
    pub external: HistoricalExternalFieldsV2,
    pub native_records: Vec<HistoricalExternalNativeRecordFingerprintV2>,
    pub native_record_set_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalExternalDescriptorV2 {
    pub schema_version: u16,
    pub immutable: HistoricalExternalImmutableV2,
    pub mutable: HistoricalExternalMutableV2,
    pub descriptor_hash: CanonicalHash,
}

impl HistoricalExternalDescriptorProposalV2 {
    pub fn with_calculated_hash(mut self) -> Result<Self, PersistenceError> {
        self.external.chunk_set_hash = historical_external_chunk_set_hash_v2(&self.external)?;
        self.proposal_hash = historical_external_descriptor_proposal_hash_v2(&self)?;
        self.verify()?;
        Ok(self)
    }

    pub fn verify(&self) -> Result<(), PersistenceError> {
        verify_common(self.schema_version, &self.immutable, &self.external)?;
        if historical_external_descriptor_proposal_hash_v2(self)? != self.proposal_hash {
            return Err(PersistenceError::new(
                "historical-external-proposal-hash",
                "historical external descriptor proposal fingerprint is corrupt",
            ));
        }
        Ok(())
    }

    /// Validate the actual CAS parent before building any successor records.
    pub fn verify_successor_of(&self, previous: &HistoricalExternalDescriptorV2) -> Result<(), PersistenceError> {
        self.verify()?;
        previous.verify()?;
        if self.immutable != previous.immutable
            || self.external.expected_previous_document.as_ref() != Some(&previous.mutable.external.current_document)
            || self.external.current_document.revision
                != previous
                    .mutable
                    .external
                    .current_document
                    .revision
                    .checked_add(1)
                    .ok_or_else(|| {
                        PersistenceError::new(
                            "historical-external-cas",
                            "historical external document revision is exhausted",
                        )
                    })?
        {
            return Err(PersistenceError::new(
                "historical-external-cas",
                "historical external proposal does not compare-and-swap the exact durable descriptor head",
            ));
        }
        Ok(())
    }

    /// The only path from an unbound browser proposal to a durable BWHE.
    pub fn bind_native_records(
        self,
        native_records: Vec<HistoricalExternalNativeRecordFingerprintV2>,
    ) -> Result<HistoricalExternalDescriptorV2, PersistenceError> {
        self.verify()?;
        HistoricalExternalDescriptorV2 {
            schema_version: self.schema_version,
            immutable: self.immutable,
            mutable: HistoricalExternalMutableV2 {
                external: self.external,
                native_records,
                native_record_set_hash: CanonicalHash::default(),
            },
            descriptor_hash: CanonicalHash::default(),
        }
        .with_calculated_hashes()
    }
}

impl HistoricalExternalDescriptorV2 {
    pub fn with_calculated_hashes(mut self) -> Result<Self, PersistenceError> {
        self.mutable.external.chunk_set_hash = historical_external_chunk_set_hash_v2(&self.mutable.external)?;
        self.mutable.native_record_set_hash =
            historical_external_native_record_set_hash_v2(&self.mutable.native_records, &self.immutable.target)?;
        self.descriptor_hash = historical_external_descriptor_hash_v2(&self)?;
        self.verify()?;
        Ok(self)
    }

    /// Rebind a proposal/descriptor to records Rust actually serialized. No
    /// sentinel or browser-supplied fingerprint can become authoritative.
    pub fn with_native_records(
        mut self,
        native_records: Vec<HistoricalExternalNativeRecordFingerprintV2>,
    ) -> Result<Self, PersistenceError> {
        self.mutable.native_records = native_records;
        self.with_calculated_hashes()
    }

    pub fn verify(&self) -> Result<(), PersistenceError> {
        verify_common(self.schema_version, &self.immutable, &self.mutable.external)?;
        let expected_records =
            historical_external_native_record_set_hash_v2(&self.mutable.native_records, &self.immutable.target)?;
        if expected_records != self.mutable.native_record_set_hash {
            return Err(PersistenceError::new(
                "historical-external-native-record-hash",
                "historical external native-record fingerprint is corrupt",
            ));
        }
        if historical_external_descriptor_hash_v2(self)? != self.descriptor_hash {
            return Err(PersistenceError::new(
                "historical-external-descriptor-hash",
                "historical external descriptor fingerprint is corrupt",
            ));
        }
        Ok(())
    }
}

pub fn historical_external_descriptor_address_v2(
    universe_id: &str,
    location_id: &str,
) -> Result<RecordAddress, PersistenceError> {
    RecordAddress::new(
        universe_id,
        location_id,
        RecordKind::ActorDigest,
        HISTORICAL_EXTERNAL_DESCRIPTOR_RECORD_ID_V2,
    )
}

#[must_use]
pub fn historical_external_document_chunk_record_id_v2(index: u32) -> String {
    format!("{HISTORICAL_EXTERNAL_DOCUMENT_RECORD_PREFIX_V2}{index:08x}")
}

pub fn historical_external_document_chunk_address_v2(
    universe_id: &str,
    location_id: &str,
    index: u32,
) -> Result<RecordAddress, PersistenceError> {
    RecordAddress::new(
        universe_id,
        location_id,
        RecordKind::SettingsReference,
        historical_external_document_chunk_record_id_v2(index),
    )
}

fn verify_identity(value: &HistoricalDocumentIdentityV2, label: &str) -> Result<(), PersistenceError> {
    if value.byte_length == 0 || value.byte_length > HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2 {
        return Err(PersistenceError::new(
            "historical-external-document-identity",
            format!("{label} byte length is outside the external-document bound"),
        ));
    }
    Ok(())
}

fn verify_source(value: &HistoricalExternalImportSourceV2) -> Result<(), PersistenceError> {
    if value.schema_version != 1
        || value.provenance != "uploaded-file-bytes"
        || value.source_format != "blockwild-world-export-v1"
        || value.encoding != "utf-8"
        || value.archive_world_id != "blockwild-original-import-sources-v1"
        || value.byte_length == 0
        || value.byte_length > HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2
        || !matches!(value.generator_version, 16 | 17)
    {
        return Err(PersistenceError::new(
            "historical-external-source",
            "historical external import-source identity is unsupported",
        ));
    }
    validate_label(&value.object_id, 96, "historical source object id")?;
    if value.object_id != format!("sha256-{}", hex(&value.raw_sha256)) {
        return Err(PersistenceError::new(
            "historical-external-source",
            "historical external object ID differs from its raw SHA-256",
        ));
    }
    Ok(())
}

fn valid_catalog_world_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 48
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-'))
}

fn verify_immutable(value: &HistoricalExternalImmutableV2) -> Result<(), PersistenceError> {
    if value.authority.claim != HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2
        || value.authority.native_player != "off"
        || value.authority.native_rich_state != "not-adopted"
        || value.profile != HISTORICAL_EXTERNAL_PROFILE_V2
        || value.native_execution_scope != HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2
        || value.external_state_flags == 0
    {
        return Err(PersistenceError::new(
            "historical-external-authority",
            "historical external descriptor requests unsupported native authority",
        ));
    }
    verify_source(&value.source)?;
    verify_identity(&value.initial_document, "initial document")?;
    let target = &value.target;
    if !valid_catalog_world_id(&target.catalog_world_id)
        || target.universe_id != format!("world:{}", target.catalog_world_id)
        || target.generation_identity.schema_version != 1
        || target.generation_identity.generation_options_json.is_empty()
        || target.generation_identity.generation_options_json.len() as u64
            != target.generation_identity.generation_options_byte_length
        || persistence_payload_hash_v1(target.generation_identity.generation_options_json.as_bytes())
            != target.generation_identity.generation_options_hash
        || target.options_byte_length == 0
        || target.options_byte_length > MAX_RECORD_BYTES_V1 as u64
        || value.bwas.projection_byte_length == 0
        || value.bwas.projection_byte_length > MAX_RECORD_BYTES_V1 as u64
    {
        return Err(PersistenceError::new(
            "historical-external-target",
            "historical external target, options, or BWAS identity is invalid",
        ));
    }
    validate_label(&target.universe_id, 64, "historical target universe")?;
    validate_label(&target.location_id, 128, "historical target location")?;
    validate_label(&target.world_seed, 512, "historical target seed")?;
    if target
        .generation_identity
        .generation_options_json
        .encode_utf16()
        .count()
        > 65_536
    {
        return Err(PersistenceError::new(
            "historical-external-target",
            "historical generation-options identity exceeds its bound",
        ));
    }
    Ok(())
}

fn verify_external(value: &HistoricalExternalFieldsV2) -> Result<(), PersistenceError> {
    verify_identity(&value.current_document.identity, "current document")?;
    if value.current_document.revision == 0 {
        return Err(PersistenceError::new(
            "historical-external-revision",
            "historical external document revision must be positive",
        ));
    }
    if let Some(previous) = &value.expected_previous_document {
        verify_identity(&previous.identity, "expected previous document")?;
        if previous.revision.checked_add(1) != Some(value.current_document.revision) {
            return Err(PersistenceError::new(
                "historical-external-revision",
                "historical external document revision does not advance its expected head",
            ));
        }
    } else if value.current_document.revision != 1 {
        return Err(PersistenceError::new(
            "historical-external-revision",
            "only external document revision one may omit an expected previous head",
        ));
    }
    let maximum_chunks =
        HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2.div_ceil(u64::from(HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2));
    if value.chunks.is_empty() || value.chunks.len() as u64 > maximum_chunks {
        return Err(PersistenceError::new(
            "historical-external-chunks",
            "historical external chunk count is outside its bound",
        ));
    }
    let mut offset = 0_u64;
    for (index, chunk) in value.chunks.iter().enumerate() {
        let remaining = value.current_document.identity.byte_length.saturating_sub(offset);
        let expected_length = remaining.min(u64::from(HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2));
        if chunk.index as usize != index
            || chunk.byte_offset != offset
            || u64::from(chunk.byte_length) != expected_length
            || chunk.byte_length == 0
        {
            return Err(PersistenceError::new(
                "historical-external-chunks",
                "historical external chunks are not exact contiguous deterministic slices",
            ));
        }
        offset = offset.checked_add(u64::from(chunk.byte_length)).ok_or_else(|| {
            PersistenceError::new(
                "historical-external-chunks",
                "historical external chunk offset overflow",
            )
        })?;
    }
    if offset != value.current_document.identity.byte_length
        || historical_external_chunk_set_hash_v2(value)? != value.chunk_set_hash
    {
        return Err(PersistenceError::new(
            "historical-external-chunk-hash",
            "historical external chunk-set fingerprint is corrupt",
        ));
    }
    Ok(())
}

fn verify_common(
    schema_version: u16,
    immutable: &HistoricalExternalImmutableV2,
    external: &HistoricalExternalFieldsV2,
) -> Result<(), PersistenceError> {
    if schema_version != HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2 {
        return Err(PersistenceError::new(
            "historical-external-schema",
            "unsupported historical external descriptor schema",
        ));
    }
    verify_immutable(immutable)?;
    verify_external(external)?;
    if external.current_document.revision == 1
        && (external.expected_previous_document.is_some()
            || external.current_document.identity != immutable.initial_document)
    {
        return Err(PersistenceError::new(
            "historical-external-initial",
            "initial external document differs from immutable initial custody",
        ));
    }
    Ok(())
}

pub fn historical_external_chunk_set_hash_v2(
    value: &HistoricalExternalFieldsV2,
) -> Result<CanonicalHash, PersistenceError> {
    if value.chunks.len() > u32::MAX as usize {
        return Err(PersistenceError::new(
            "historical-external-chunks",
            "external chunk count exceeds u32",
        ));
    }
    let mut hasher = CanonicalHasher::new("blockwild-historical-external-chunk-set-v2");
    write_document_revision_hash(&mut hasher, &value.current_document);
    hasher.write_u16(u16::from(value.expected_previous_document.is_some()));
    if let Some(previous) = &value.expected_previous_document {
        write_document_revision_hash(&mut hasher, previous);
    }
    hasher.write_u32(value.chunks.len() as u32);
    for chunk in &value.chunks {
        hasher.write_u32(chunk.index);
        hasher.write_u64(chunk.byte_offset);
        hasher.write_u32(chunk.byte_length);
        hasher.write_str(&chunk.payload_hash.to_hex());
    }
    Ok(hasher.finish())
}

fn write_document_revision_hash(hasher: &mut CanonicalHasher, value: &HistoricalDocumentRevisionIdentityV2) {
    hasher.write_str(&value.identity.hash.to_hex());
    hasher.write_str(&hex(&value.identity.sha256));
    hasher.write_u64(value.identity.byte_length);
    hasher.write_u64(value.revision);
}

pub fn historical_external_native_record_set_hash_v2(
    records: &[HistoricalExternalNativeRecordFingerprintV2],
    target: &HistoricalExternalTargetV2,
) -> Result<CanonicalHash, PersistenceError> {
    if records.len() != HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2.len() {
        return Err(PersistenceError::new(
            "historical-external-native-records",
            "historical external descriptor requires exactly six primary native records",
        ));
    }
    let mut hasher = CanonicalHasher::new("blockwild-historical-external-native-record-set-v2");
    hasher.write_u32(records.len() as u32);
    for (index, record) in records.iter().enumerate() {
        let (kind, record_id) = HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2[index];
        if record.address.universe_id != target.universe_id
            || record.address.location_id != target.location_id
            || record.address.kind != kind
            || record.address.record_id != record_id
            || record.revision == 0
            || record.byte_length == 0
            || record.byte_length as usize > MAX_RECORD_BYTES_V1
        {
            return Err(PersistenceError::new(
                "historical-external-native-records",
                "historical external fingerprints differ from the exact primary native record set/order",
            ));
        }
        hasher.write_str(&record.address.universe_id);
        hasher.write_str(&record.address.location_id);
        hasher.write_str(record.address.kind.as_str());
        hasher.write_str(&record.address.record_id);
        hasher.write_u64(record.revision);
        hasher.write_u32(record.byte_length);
        hasher.write_str(&record.payload_hash.to_hex());
    }
    Ok(hasher.finish())
}

fn hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use core::fmt::Write as _;
        write!(&mut output, "{byte:02x}").expect("writing to String cannot fail");
    }
    output
}

pub fn historical_external_descriptor_proposal_hash_v2(
    value: &HistoricalExternalDescriptorProposalV2,
) -> Result<CanonicalHash, PersistenceError> {
    let body = encode_proposal_body(value)?;
    let mut hasher = CanonicalHasher::new("blockwild-historical-external-descriptor-proposal-v2");
    hasher.write_bytes(&body);
    Ok(hasher.finish())
}

pub fn historical_external_descriptor_hash_v2(
    value: &HistoricalExternalDescriptorV2,
) -> Result<CanonicalHash, PersistenceError> {
    let body = encode_descriptor_body(value)?;
    let mut hasher = CanonicalHasher::new("blockwild-historical-external-descriptor-v2");
    hasher.write_bytes(&body);
    Ok(hasher.finish())
}

pub fn encode_historical_external_descriptor_proposal_v2(
    value: &HistoricalExternalDescriptorProposalV2,
) -> Result<Vec<u8>, PersistenceError> {
    value.verify()?;
    let mut bytes = encode_proposal_body(value)?;
    bytes.extend_from_slice(value.proposal_hash.as_bytes());
    Ok(bytes)
}

pub fn decode_historical_external_descriptor_proposal_v2(
    bytes: &[u8],
) -> Result<HistoricalExternalDescriptorProposalV2, PersistenceError> {
    if bytes.is_empty() || bytes.len() > MAX_RECORD_BYTES_V1 {
        return Err(PersistenceError::new(
            "historical-external-proposal-size",
            "historical external descriptor proposal exceeds its record bound",
        ));
    }
    let mut reader = Reader::new(bytes);
    if reader.take(4)? != HISTORICAL_EXTERNAL_PROPOSAL_MAGIC_V2 {
        return Err(PersistenceError::new(
            "historical-external-proposal-magic",
            "historical external descriptor proposal magic mismatch",
        ));
    }
    let (schema_version, immutable, external) = read_common(&mut reader)?;
    let proposal = HistoricalExternalDescriptorProposalV2 {
        schema_version,
        immutable,
        external,
        proposal_hash: reader.hash()?,
    };
    reader.finish()?;
    proposal.verify()?;
    Ok(proposal)
}

pub fn encode_historical_external_descriptor_v2(
    value: &HistoricalExternalDescriptorV2,
) -> Result<Vec<u8>, PersistenceError> {
    value.verify()?;
    let mut bytes = encode_descriptor_body(value)?;
    bytes.extend_from_slice(value.descriptor_hash.as_bytes());
    Ok(bytes)
}

pub fn decode_historical_external_descriptor_v2(
    bytes: &[u8],
) -> Result<HistoricalExternalDescriptorV2, PersistenceError> {
    if bytes.is_empty() || bytes.len() > MAX_RECORD_BYTES_V1 {
        return Err(PersistenceError::new(
            "historical-external-descriptor-size",
            "historical external descriptor exceeds its record bound",
        ));
    }
    let mut reader = Reader::new(bytes);
    if reader.take(4)? != HISTORICAL_EXTERNAL_DESCRIPTOR_MAGIC_V2 {
        return Err(PersistenceError::new(
            "historical-external-descriptor-magic",
            "historical external descriptor magic mismatch",
        ));
    }
    let (schema_version, immutable, external) = read_common(&mut reader)?;
    let count = reader.u32()? as usize;
    if count != HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2.len() {
        return Err(PersistenceError::new(
            "historical-external-native-records",
            "durable historical descriptor must contain exactly six primary native records",
        ));
    }
    let mut native_records = Vec::with_capacity(count);
    for _ in 0..count {
        native_records.push(HistoricalExternalNativeRecordFingerprintV2 {
            address: reader.address()?,
            revision: reader.u64()?,
            byte_length: reader.u32()?,
            payload_hash: reader.hash()?,
        });
    }
    let descriptor = HistoricalExternalDescriptorV2 {
        schema_version,
        immutable,
        mutable: HistoricalExternalMutableV2 {
            external,
            native_records,
            native_record_set_hash: reader.hash()?,
        },
        descriptor_hash: reader.hash()?,
    };
    reader.finish()?;
    descriptor.verify()?;
    Ok(descriptor)
}

fn encode_proposal_body(value: &HistoricalExternalDescriptorProposalV2) -> Result<Vec<u8>, PersistenceError> {
    let mut writer = Writer::default();
    writer.raw(HISTORICAL_EXTERNAL_PROPOSAL_MAGIC_V2);
    write_common(&mut writer, value.schema_version, &value.immutable, &value.external)?;
    Ok(writer.finish())
}

fn encode_descriptor_body(value: &HistoricalExternalDescriptorV2) -> Result<Vec<u8>, PersistenceError> {
    let mut writer = Writer::default();
    writer.raw(HISTORICAL_EXTERNAL_DESCRIPTOR_MAGIC_V2);
    write_common(
        &mut writer,
        value.schema_version,
        &value.immutable,
        &value.mutable.external,
    )?;
    writer.u32(
        u32::try_from(value.mutable.native_records.len()).map_err(|_| {
            PersistenceError::new("historical-external-native-records", "native record count exceeds u32")
        })?,
    );
    for record in &value.mutable.native_records {
        writer.address(&record.address)?;
        writer.u64(record.revision);
        writer.u32(record.byte_length);
        writer.hash(record.payload_hash);
    }
    writer.hash(value.mutable.native_record_set_hash);
    Ok(writer.finish())
}

fn write_common(
    writer: &mut Writer,
    schema_version: u16,
    immutable: &HistoricalExternalImmutableV2,
    external: &HistoricalExternalFieldsV2,
) -> Result<(), PersistenceError> {
    writer.u16(schema_version);
    writer.string(&immutable.authority.claim)?;
    writer.string(&immutable.authority.native_player)?;
    writer.string(&immutable.authority.native_rich_state)?;
    writer.string(&immutable.profile)?;
    writer.string(&immutable.native_execution_scope)?;
    writer.u16(immutable.source.schema_version);
    writer.string(&immutable.source.provenance)?;
    writer.string(&immutable.source.source_format)?;
    writer.string(&immutable.source.encoding)?;
    writer.string(&immutable.source.archive_world_id)?;
    writer.string(&immutable.source.object_id)?;
    writer.raw(&immutable.source.raw_sha256);
    writer.u64(immutable.source.byte_length);
    writer.u16(immutable.source.generator_version);
    writer.document_identity(&immutable.initial_document);
    writer.hash(immutable.plan_hash);
    writer.hash(immutable.custody_root);
    writer.u16(immutable.external_state_flags);
    writer.string(&immutable.target.catalog_world_id)?;
    writer.string(&immutable.target.universe_id)?;
    writer.string(&immutable.target.location_id)?;
    writer.string(&immutable.target.world_seed)?;
    writer.hash(immutable.target.content_hash);
    writer.u16(immutable.target.generation_identity.schema_version);
    writer.hash(immutable.target.generation_identity.generator_hash);
    writer.hash(immutable.target.generation_identity.terrain_content_hash);
    writer.string(&immutable.target.generation_identity.generation_options_json)?;
    writer.hash(immutable.target.generation_identity.generation_options_hash);
    writer.u64(immutable.target.generation_identity.generation_options_byte_length);
    writer.hash(immutable.target.options_semantic_hash);
    writer.u64(immutable.target.options_byte_length);
    writer.hash(immutable.bwas.projection_hash);
    writer.u64(immutable.bwas.projection_byte_length);
    writer.hash(immutable.bwas.compatibility_checksum);
    writer.hash(immutable.bwas.extension_checksum);
    writer.u64(immutable.bwas.edit_count);
    writer.u64(immutable.bwas.facing_count);
    writer.document_revision_identity(&external.current_document);
    writer.u8(u8::from(external.expected_previous_document.is_some()));
    if let Some(previous) = &external.expected_previous_document {
        writer.document_revision_identity(previous);
    }
    writer.u32(
        u32::try_from(external.chunks.len())
            .map_err(|_| PersistenceError::new("historical-external-chunks", "external chunk count exceeds u32"))?,
    );
    for chunk in &external.chunks {
        writer.u32(chunk.index);
        writer.u64(chunk.byte_offset);
        writer.u32(chunk.byte_length);
        writer.hash(chunk.payload_hash);
    }
    writer.hash(external.chunk_set_hash);
    Ok(())
}

fn read_common(
    reader: &mut Reader<'_>,
) -> Result<(u16, HistoricalExternalImmutableV2, HistoricalExternalFieldsV2), PersistenceError> {
    let schema_version = reader.u16()?;
    let authority = HistoricalExternalAuthorityV2 {
        claim: reader.string(180)?,
        native_player: reader.string(32)?,
        native_rich_state: reader.string(32)?,
    };
    let profile = reader.string(128)?;
    let native_execution_scope = reader.string(128)?;
    let source = HistoricalExternalImportSourceV2 {
        schema_version: reader.u16()?,
        provenance: reader.string(64)?,
        source_format: reader.string(128)?,
        encoding: reader.string(32)?,
        archive_world_id: reader.string(180)?,
        object_id: reader.string(96)?,
        raw_sha256: reader.array_32()?,
        byte_length: reader.u64()?,
        generator_version: reader.u16()?,
    };
    let initial_document = reader.document_identity()?;
    let plan_hash = reader.hash()?;
    let custody_root = reader.hash()?;
    let external_state_flags = reader.u16()?;
    let target = HistoricalExternalTargetV2 {
        catalog_world_id: reader.string(48)?,
        universe_id: reader.string(64)?,
        location_id: reader.string(128)?,
        world_seed: reader.string(512)?,
        content_hash: reader.hash()?,
        generation_identity: HistoricalExternalGenerationIdentityV2 {
            schema_version: reader.u16()?,
            generator_hash: reader.hash()?,
            terrain_content_hash: reader.hash()?,
            generation_options_json: reader.string(65_536)?,
            generation_options_hash: reader.hash()?,
            generation_options_byte_length: reader.u64()?,
        },
        options_semantic_hash: reader.hash()?,
        options_byte_length: reader.u64()?,
    };
    let bwas = HistoricalExternalBwasV2 {
        projection_hash: reader.hash()?,
        projection_byte_length: reader.u64()?,
        compatibility_checksum: reader.hash()?,
        extension_checksum: reader.hash()?,
        edit_count: reader.u64()?,
        facing_count: reader.u64()?,
    };
    let current_document = reader.document_revision_identity()?;
    let expected_previous_document = match reader.u8()? {
        0 => None,
        1 => Some(reader.document_revision_identity()?),
        _ => {
            return Err(PersistenceError::new(
                "historical-external-option",
                "historical external expected-previous tag is invalid",
            ));
        }
    };
    let count = reader.u32()? as usize;
    let maximum_chunks = HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2
        .div_ceil(u64::from(HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2)) as usize;
    if count == 0 || count > maximum_chunks {
        return Err(PersistenceError::new(
            "historical-external-chunks",
            "historical external chunk count is outside its bound",
        ));
    }
    let mut chunks = Vec::with_capacity(count);
    for _ in 0..count {
        chunks.push(HistoricalExternalDocumentChunkFingerprintV2 {
            index: reader.u32()?,
            byte_offset: reader.u64()?,
            byte_length: reader.u32()?,
            payload_hash: reader.hash()?,
        });
    }
    let chunk_set_hash = reader.hash()?;
    Ok((
        schema_version,
        HistoricalExternalImmutableV2 {
            authority,
            profile,
            native_execution_scope,
            source,
            initial_document,
            plan_hash,
            custody_root,
            external_state_flags,
            target,
            bwas,
        },
        HistoricalExternalFieldsV2 {
            current_document,
            expected_previous_document,
            chunks,
            chunk_set_hash,
        },
    ))
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
        self.raw(&value.to_le_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.raw(&value.to_le_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.raw(&value.to_le_bytes());
    }
    fn hash(&mut self, value: CanonicalHash) {
        self.raw(value.as_bytes());
    }
    fn string(&mut self, value: &str) -> Result<(), PersistenceError> {
        let bytes = value.as_bytes();
        self.u32(u32::try_from(bytes.len()).map_err(|_| {
            PersistenceError::new("historical-external-size", "historical descriptor string exceeds u32")
        })?);
        self.raw(bytes);
        Ok(())
    }
    fn address(&mut self, value: &RecordAddress) -> Result<(), PersistenceError> {
        self.string(&value.universe_id)?;
        self.string(&value.location_id)?;
        self.u8(value.kind as u8);
        self.string(&value.record_id)
    }
    fn document_identity(&mut self, value: &HistoricalDocumentIdentityV2) {
        self.hash(value.hash);
        self.raw(&value.sha256);
        self.u64(value.byte_length);
    }
    fn document_revision_identity(&mut self, value: &HistoricalDocumentRevisionIdentityV2) {
        self.document_identity(&value.identity);
        self.u64(value.revision);
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
            PersistenceError::new("historical-external-overflow", "historical descriptor offset overflow")
        })?;
        let value = self.bytes.get(self.offset..end).ok_or_else(|| {
            PersistenceError::new(
                "historical-external-truncated",
                "historical external descriptor is truncated",
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
        let value = u64::from_le_bytes(self.take(8)?.try_into().expect("fixed slice"));
        if value > 9_007_199_254_740_991 {
            return Err(PersistenceError::new(
                "historical-external-integer",
                "historical descriptor u64 exceeds JavaScript's exact range",
            ));
        }
        Ok(value)
    }
    fn hash(&mut self) -> Result<CanonicalHash, PersistenceError> {
        Ok(CanonicalHash(self.take(16)?.try_into().expect("fixed slice")))
    }
    fn array_32(&mut self) -> Result<[u8; 32], PersistenceError> {
        Ok(self.take(32)?.try_into().expect("fixed slice"))
    }
    fn string(&mut self, maximum_utf16: usize) -> Result<String, PersistenceError> {
        let length = self.u32()? as usize;
        let value = String::from_utf8(self.take(length)?.to_vec()).map_err(|_| {
            PersistenceError::new(
                "historical-external-utf8",
                "historical descriptor string is not valid UTF-8",
            )
        })?;
        if value.encode_utf16().count() > maximum_utf16 {
            return Err(PersistenceError::new(
                "historical-external-string",
                "historical descriptor string exceeds its UTF-16 bound",
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
    fn document_identity(&mut self) -> Result<HistoricalDocumentIdentityV2, PersistenceError> {
        Ok(HistoricalDocumentIdentityV2 {
            hash: self.hash()?,
            sha256: self.array_32()?,
            byte_length: self.u64()?,
        })
    }
    fn document_revision_identity(&mut self) -> Result<HistoricalDocumentRevisionIdentityV2, PersistenceError> {
        Ok(HistoricalDocumentRevisionIdentityV2 {
            identity: self.document_identity()?,
            revision: self.u64()?,
        })
    }
    fn finish(&self) -> Result<(), PersistenceError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(PersistenceError::new(
                "historical-external-trailing",
                "historical external descriptor contains trailing bytes",
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

    fn document(byte: u8, byte_length: u64) -> HistoricalDocumentIdentityV2 {
        HistoricalDocumentIdentityV2 {
            hash: hash(byte),
            sha256: [byte.wrapping_add(1); 32],
            byte_length,
        }
    }

    fn immutable() -> HistoricalExternalImmutableV2 {
        let raw_sha256 = [0x11; 32];
        let generation_options_json = "{\"biomeScale\":1.35}".to_owned();
        HistoricalExternalImmutableV2 {
            authority: HistoricalExternalAuthorityV2 {
                claim: HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2.into(),
                native_player: "off".into(),
                native_rich_state: "not-adopted".into(),
            },
            profile: HISTORICAL_EXTERNAL_PROFILE_V2.into(),
            native_execution_scope: HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2.into(),
            source: HistoricalExternalImportSourceV2 {
                schema_version: 1,
                provenance: "uploaded-file-bytes".into(),
                source_format: "blockwild-world-export-v1".into(),
                encoding: "utf-8".into(),
                archive_world_id: "blockwild-original-import-sources-v1".into(),
                object_id: format!("sha256-{}", hex(&raw_sha256)),
                raw_sha256,
                byte_length: 8_192,
                generator_version: 16,
            },
            initial_document: document(0x21, 21),
            plan_hash: hash(0x23),
            custody_root: hash(0x24),
            external_state_flags: 0x7f,
            target: HistoricalExternalTargetV2 {
                catalog_world_id: "historical-g16".into(),
                universe_id: "world:historical-g16".into(),
                location_id: "overworld".into(),
                world_seed: "water-🌿".into(),
                content_hash: hash(0x25),
                generation_identity: HistoricalExternalGenerationIdentityV2 {
                    schema_version: 1,
                    generator_hash: hash(0x26),
                    terrain_content_hash: hash(0x27),
                    generation_options_hash: persistence_payload_hash_v1(generation_options_json.as_bytes()),
                    generation_options_byte_length: generation_options_json.len() as u64,
                    generation_options_json,
                },
                options_semantic_hash: hash(0x28),
                options_byte_length: 127,
            },
            bwas: HistoricalExternalBwasV2 {
                projection_hash: hash(0x29),
                projection_byte_length: 1_024,
                compatibility_checksum: hash(0x2a),
                extension_checksum: hash(0x2b),
                edit_count: 39,
                facing_count: 2,
            },
        }
    }

    fn proposal() -> HistoricalExternalDescriptorProposalV2 {
        let initial = immutable();
        let current_document = HistoricalDocumentRevisionIdentityV2 {
            identity: initial.initial_document.clone(),
            revision: 1,
        };
        HistoricalExternalDescriptorProposalV2 {
            schema_version: HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2,
            immutable: initial,
            external: HistoricalExternalFieldsV2 {
                current_document,
                expected_previous_document: None,
                chunks: vec![HistoricalExternalDocumentChunkFingerprintV2 {
                    index: 0,
                    byte_offset: 0,
                    byte_length: 21,
                    payload_hash: hash(0x2c),
                }],
                chunk_set_hash: CanonicalHash::default(),
            },
            proposal_hash: CanonicalHash::default(),
        }
        .with_calculated_hash()
        .unwrap()
    }

    fn native_records() -> Vec<HistoricalExternalNativeRecordFingerprintV2> {
        HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2
            .iter()
            .enumerate()
            .map(
                |(index, (kind, record_id))| HistoricalExternalNativeRecordFingerprintV2 {
                    address: RecordAddress::new("world:historical-g16", "overworld", *kind, *record_id).unwrap(),
                    revision: 1,
                    byte_length: 100 + index as u32,
                    payload_hash: hash(0x40 + index as u8),
                },
            )
            .collect()
    }

    #[test]
    fn proposal_and_durable_descriptor_round_trip_with_distinct_magic() {
        let proposal = proposal();
        let proposal_bytes = encode_historical_external_descriptor_proposal_v2(&proposal).unwrap();
        assert_eq!(&proposal_bytes[..4], b"BWHP");
        assert_eq!(proposal.proposal_hash.to_hex(), "cf812587143c5b28e021e8c411f64c02");
        assert_eq!(
            proposal.external.chunk_set_hash.to_hex(),
            "b3515e57dc7adc6e30168d11f4a7df86"
        );
        assert_eq!(proposal_bytes.len(), 886);
        assert_eq!(
            persistence_payload_hash_v1(&proposal_bytes).to_hex(),
            "64d5e9f644e5a5dd2020f5cfb9356bd3"
        );
        assert_eq!(
            decode_historical_external_descriptor_proposal_v2(&proposal_bytes).unwrap(),
            proposal
        );
        assert!(decode_historical_external_descriptor_v2(&proposal_bytes).is_err());

        let descriptor = proposal.bind_native_records(native_records()).unwrap();
        let descriptor_bytes = encode_historical_external_descriptor_v2(&descriptor).unwrap();
        assert_eq!(&descriptor_bytes[..4], b"BWHE");
        assert_eq!(
            descriptor.mutable.native_record_set_hash.to_hex(),
            "ba45d7135649d2f15042b03ef13f27da"
        );
        assert_eq!(descriptor.descriptor_hash.to_hex(), "15be5f3cae66dc51202cd2c715134b01");
        assert_eq!(descriptor_bytes.len(), 1_443);
        assert_eq!(
            persistence_payload_hash_v1(&descriptor_bytes).to_hex(),
            "8bdef884ff36b971903a79ec1e08154d"
        );
        assert_eq!(
            decode_historical_external_descriptor_v2(&descriptor_bytes).unwrap(),
            descriptor
        );
        assert!(decode_historical_external_descriptor_proposal_v2(&descriptor_bytes).is_err());
    }

    #[test]
    fn browser_proposal_cannot_invent_or_reorder_native_authority() {
        let proposal = proposal();
        assert_eq!(
            proposal.clone().bind_native_records(Vec::new()).unwrap_err().code,
            "historical-external-native-records"
        );
        let mut records = native_records();
        records.swap(0, 1);
        assert_eq!(
            proposal.clone().bind_native_records(records).unwrap_err().code,
            "historical-external-native-records"
        );
        let mut records = native_records();
        records[0].revision = 0;
        assert_eq!(
            proposal.bind_native_records(records).unwrap_err().code,
            "historical-external-native-records"
        );
    }

    #[test]
    fn successor_proposal_binds_exact_previous_external_head() {
        let first = proposal().bind_native_records(native_records()).unwrap();
        let previous = first.mutable.external.current_document.clone();
        let current = HistoricalDocumentRevisionIdentityV2 {
            identity: document(0x31, 23),
            revision: 2,
        };
        let successor = HistoricalExternalDescriptorProposalV2 {
            schema_version: HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2,
            immutable: first.immutable.clone(),
            external: HistoricalExternalFieldsV2 {
                current_document: current,
                expected_previous_document: Some(previous),
                chunks: vec![HistoricalExternalDocumentChunkFingerprintV2 {
                    index: 0,
                    byte_offset: 0,
                    byte_length: 23,
                    payload_hash: hash(0x32),
                }],
                chunk_set_hash: CanonicalHash::default(),
            },
            proposal_hash: CanonicalHash::default(),
        }
        .with_calculated_hash()
        .unwrap();
        assert_eq!(successor.external.current_document.revision, 2);
        successor.verify_successor_of(&first).unwrap();
        let mut stale = successor;
        stale.external.expected_previous_document.as_mut().unwrap().revision = 0;
        assert_eq!(stale.verify().unwrap_err().code, "historical-external-revision");
    }

    #[test]
    fn immutable_and_mutable_tampering_breaks_final_fingerprint() {
        let descriptor = proposal().bind_native_records(native_records()).unwrap();
        let mut target_tamper = descriptor.clone();
        target_tamper.immutable.target.world_seed.push_str("-other");
        assert_eq!(
            target_tamper.verify().unwrap_err().code,
            "historical-external-descriptor-hash"
        );
        let mut current_tamper = descriptor;
        current_tamper.mutable.external.current_document.identity.sha256[0] ^= 1;
        assert_eq!(
            current_tamper.verify().unwrap_err().code,
            "historical-external-chunk-hash"
        );
    }

    #[test]
    fn descriptor_and_chunk_addresses_are_disjoint_from_primary_records() {
        let descriptor = historical_external_descriptor_address_v2("world:historical-g16", "overworld").unwrap();
        let chunk = historical_external_document_chunk_address_v2("world:historical-g16", "overworld", 7).unwrap();
        assert_eq!(descriptor.kind, RecordKind::ActorDigest);
        assert_eq!(descriptor.record_id, HISTORICAL_EXTERNAL_DESCRIPTOR_RECORD_ID_V2);
        assert_eq!(chunk.kind, RecordKind::SettingsReference);
        assert_eq!(chunk.record_id, "historical-external-document-v2-00000007");
        assert!(
            native_records()
                .iter()
                .all(|record| record.address != descriptor && record.address != chunk)
        );
    }
}
