//! Canonical, complete world-save sharding owned by Rust.

use crate::{
    Checkpoint, MAX_RECORD_BYTES_V1, MAX_RECORDS_PER_CHECKPOINT_V1, PERSISTENCE_SCHEMA_V1, PersistenceError,
    RecordAddress, RecordDescriptor, RecordKind, StoredRecord, payload_hash, validate_label,
};
use blockwild_types::{CanonicalHash, CanonicalHasher};
use std::collections::{BTreeMap, BTreeSet};

pub const WORLD_SAVE_MANIFEST_SCHEMA_V1: u16 = 1;
pub const COMPATIBILITY_CHUNK_BYTES_V1: usize = 4 * 1024 * 1024;
pub const WORLD_SAVE_MANIFEST_RECORD_ID_V1: &str = "manifest-v1";
pub const COMPATIBILITY_RECORD_PREFIX_V1: &str = "compatibility-v1-";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NormalizedStateRecordV1 {
    pub address: RecordAddress,
    pub payload: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldSaveManifestEntryV1 {
    pub address: RecordAddress,
    pub byte_length: u32,
    pub payload_hash: CanonicalHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldSaveManifestV1 {
    pub schema_version: u16,
    pub world_id: String,
    pub universe_id: String,
    pub location_id: String,
    pub generator_hash: CanonicalHash,
    pub content_hash: CanonicalHash,
    pub compatibility_byte_length: u64,
    pub compatibility_hash: CanonicalHash,
    pub compatibility_chunks: u32,
    pub records: Vec<WorldSaveManifestEntryV1>,
    pub manifest_hash: CanonicalHash,
}

impl WorldSaveManifestV1 {
    pub fn verify(&self) -> Result<(), PersistenceError> {
        if self.schema_version != WORLD_SAVE_MANIFEST_SCHEMA_V1 {
            return Err(PersistenceError::new(
                "save-manifest-schema",
                "unsupported world-save manifest schema",
            ));
        }
        validate_label(&self.world_id, 180, "manifest.world_id")?;
        validate_label(&self.universe_id, 64, "manifest.universe_id")?;
        validate_label(&self.location_id, 128, "manifest.location_id")?;
        if self.records.len() > MAX_RECORDS_PER_CHECKPOINT_V1 {
            return Err(PersistenceError::new(
                "save-manifest-size",
                "world-save manifest exceeds its record budget",
            ));
        }
        let mut previous: Option<&RecordAddress> = None;
        let mut compatibility_chunks = 0_u32;
        let mut compatibility_bytes = 0_u64;
        for record in &self.records {
            if record.byte_length as usize > MAX_RECORD_BYTES_V1 {
                return Err(PersistenceError::new(
                    "record-size",
                    "world-save record exceeds its byte budget",
                ));
            }
            if previous.is_some_and(|value| value >= &record.address) {
                return Err(PersistenceError::new(
                    "save-manifest-order",
                    "world-save records are not uniquely sorted",
                ));
            }
            if is_compatibility_address(&record.address, &self.universe_id, &self.location_id) {
                compatibility_chunks = compatibility_chunks.saturating_add(1);
                compatibility_bytes = compatibility_bytes.saturating_add(u64::from(record.byte_length));
            }
            previous = Some(&record.address);
        }
        if compatibility_chunks != self.compatibility_chunks || compatibility_bytes != self.compatibility_byte_length {
            return Err(PersistenceError::new(
                "compatibility-manifest",
                "compatibility byte and chunk totals do not match the world-save records",
            ));
        }
        if manifest_hash(self) != self.manifest_hash {
            return Err(PersistenceError::new("corrupt", "world-save manifest hash mismatch"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CanonicalWorldSaveSetV1 {
    pub manifest: WorldSaveManifestV1,
    /// Includes the encoded manifest itself and every referenced payload.
    pub records: BTreeMap<RecordAddress, Vec<u8>>,
    pub set_hash: CanonicalHash,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WorldSaveSetAttestationV1 {
    pub set_hash: CanonicalHash,
    pub manifest_hash: CanonicalHash,
}

/// Reconstructs the exact canonical save identity from the terminal journal
/// without copying record payloads. Extra, missing, or descriptor-mismatched
/// records fail closed rather than attesting a partial or mixed save set.
pub fn attest_world_save_set_records_v1(
    records: &BTreeMap<RecordAddress, StoredRecord>,
) -> Result<WorldSaveSetAttestationV1, PersistenceError> {
    let manifests = records
        .iter()
        .filter(|(address, _)| {
            address.kind == RecordKind::LocationManifest && address.record_id == WORLD_SAVE_MANIFEST_RECORD_ID_V1
        })
        .collect::<Vec<_>>();
    if manifests.len() != 1 {
        return Err(PersistenceError::new(
            "save-set-completeness",
            "terminal journal must contain exactly one canonical save manifest",
        ));
    }
    let (stored_address, stored_manifest) = manifests[0];
    let manifest = decode_world_save_manifest_v1(&stored_manifest.payload)?;
    let expected_manifest_address = manifest_address(&manifest.universe_id, &manifest.location_id)?;
    if stored_address != &expected_manifest_address || records.len() != manifest.records.len().saturating_add(1) {
        return Err(PersistenceError::new(
            "save-set-completeness",
            "terminal journal does not exactly match its canonical save manifest",
        ));
    }
    for entry in &manifest.records {
        let stored = records
            .get(&entry.address)
            .ok_or_else(|| PersistenceError::new("save-set-completeness", "manifest record payload is missing"))?;
        if stored.payload.len() != entry.byte_length as usize
            || stored.payload_hash != entry.payload_hash
            || payload_hash(&stored.payload) != entry.payload_hash
        {
            return Err(PersistenceError::new(
                "corrupt",
                "terminal journal record does not match its save manifest descriptor",
            ));
        }
    }
    let set_hash = save_set_hash_entries(
        &manifest,
        records.len(),
        records
            .iter()
            .map(|(address, stored)| (address, stored.payload.as_slice())),
    );
    Ok(WorldSaveSetAttestationV1 {
        set_hash,
        manifest_hash: manifest.manifest_hash,
    })
}

impl CanonicalWorldSaveSetV1 {
    pub fn build(
        world_id: impl Into<String>,
        universe_id: impl Into<String>,
        location_id: impl Into<String>,
        generator_hash: CanonicalHash,
        content_hash: CanonicalHash,
        normalized_compatibility_chunks: impl IntoIterator<Item = Vec<u8>>,
        state_records: impl IntoIterator<Item = NormalizedStateRecordV1>,
    ) -> Result<Self, PersistenceError> {
        let world_id = world_id.into();
        let universe_id = universe_id.into();
        let location_id = location_id.into();
        validate_label(&world_id, 180, "world_id")?;
        validate_label(&universe_id, 64, "universe_id")?;
        validate_label(&location_id, 128, "location_id")?;

        let manifest_address = manifest_address(&universe_id, &location_id)?;
        let mut records = BTreeMap::new();
        let mut compatibility_byte_length = 0_u64;
        let mut compatibility_hasher = CanonicalHasher::new("blockwild-persistence-compatibility-stream-v1");
        let mut compatibility_chunks = 0_u32;
        for (index, chunk) in normalized_compatibility_chunks.into_iter().enumerate() {
            if chunk.is_empty() || chunk.len() > COMPATIBILITY_CHUNK_BYTES_V1 {
                return Err(PersistenceError::new(
                    "compatibility-chunk",
                    "compatibility chunks must contain 1..=4 MiB bytes",
                ));
            }
            let index = u32::try_from(index)
                .map_err(|_| PersistenceError::new("compatibility-chunk", "too many compatibility chunks"))?;
            compatibility_byte_length = compatibility_byte_length
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| PersistenceError::new("compatibility-size", "compatibility byte length overflow"))?;
            compatibility_hasher.write_u32(index);
            compatibility_hasher.write_bytes(&chunk);
            compatibility_chunks = index.saturating_add(1);
            let address = compatibility_address(&universe_id, &location_id, index)?;
            records.insert(address, chunk);
        }

        for record in state_records {
            if record.payload.len() > MAX_RECORD_BYTES_V1 {
                return Err(PersistenceError::new(
                    "record-size",
                    "normalized state record exceeds its byte budget",
                ));
            }
            if record.address == manifest_address
                || is_compatibility_address(&record.address, &universe_id, &location_id)
            {
                return Err(PersistenceError::new(
                    "reserved-record",
                    "normalized state record uses a reserved save address",
                ));
            }
            if records.insert(record.address, record.payload).is_some() {
                return Err(PersistenceError::new(
                    "duplicate-record",
                    "normalized save contains a duplicate record address",
                ));
            }
        }
        if records.len().saturating_add(1) > MAX_RECORDS_PER_CHECKPOINT_V1 {
            return Err(PersistenceError::new(
                "save-manifest-size",
                "world save exceeds its record budget",
            ));
        }

        let entries = records
            .iter()
            .map(|(address, payload)| WorldSaveManifestEntryV1 {
                address: address.clone(),
                byte_length: payload.len() as u32,
                payload_hash: payload_hash(payload),
            })
            .collect::<Vec<_>>();
        let mut manifest = WorldSaveManifestV1 {
            schema_version: WORLD_SAVE_MANIFEST_SCHEMA_V1,
            world_id,
            universe_id,
            location_id,
            generator_hash,
            content_hash,
            compatibility_byte_length,
            compatibility_hash: compatibility_hasher.finish(),
            compatibility_chunks,
            records: entries,
            manifest_hash: CanonicalHash::default(),
        };
        manifest.manifest_hash = manifest_hash(&manifest);
        let manifest_payload = encode_world_save_manifest_v1(&manifest)?;
        records.insert(manifest_address, manifest_payload);
        let set_hash = save_set_hash(&manifest, &records);
        let value = Self {
            manifest,
            records,
            set_hash,
        };
        value.verify()?;
        Ok(value)
    }

    pub fn verify(&self) -> Result<(), PersistenceError> {
        self.manifest.verify()?;
        let expected_addresses = self
            .manifest
            .records
            .iter()
            .map(|entry| entry.address.clone())
            .collect::<BTreeSet<_>>();
        let manifest_address = manifest_address(&self.manifest.universe_id, &self.manifest.location_id)?;
        if self.records.len() != expected_addresses.len().saturating_add(1)
            || !self.records.contains_key(&manifest_address)
        {
            return Err(PersistenceError::new(
                "save-set-completeness",
                "world-save set does not exactly match its manifest",
            ));
        }
        for entry in &self.manifest.records {
            let payload = self
                .records
                .get(&entry.address)
                .ok_or_else(|| PersistenceError::new("save-set-completeness", "manifest record payload is missing"))?;
            if payload.len() != entry.byte_length as usize || payload_hash(payload) != entry.payload_hash {
                return Err(PersistenceError::new(
                    "corrupt",
                    "world-save record does not match its manifest descriptor",
                ));
            }
        }
        let encoded_manifest = self
            .records
            .get(&manifest_address)
            .ok_or_else(|| PersistenceError::new("save-set-completeness", "encoded manifest record is missing"))?;
        if decode_world_save_manifest_v1(encoded_manifest)? != self.manifest {
            return Err(PersistenceError::new(
                "corrupt",
                "encoded world-save manifest disagrees with the save set",
            ));
        }
        if save_set_hash(&self.manifest, &self.records) != self.set_hash {
            return Err(PersistenceError::new("corrupt", "world-save set hash mismatch"));
        }
        Ok(())
    }

    pub fn checkpoint(
        &self,
        checkpoint_id: impl Into<String>,
        parent_checkpoint_id: Option<String>,
        journal_sequence: u64,
        created_at: u64,
    ) -> Result<Checkpoint, PersistenceError> {
        self.verify()?;
        Checkpoint::new(
            checkpoint_id,
            parent_checkpoint_id,
            self.manifest.world_id.clone(),
            journal_sequence,
            self.manifest.generator_hash,
            self.manifest.content_hash,
            created_at,
            self.records
                .iter()
                .map(|(address, payload)| RecordDescriptor {
                    address: address.clone(),
                    revision: 1,
                    byte_length: payload.len() as u32,
                    payload_hash: payload_hash(payload),
                })
                .collect(),
        )
    }

    pub fn compatibility_chunks(&self) -> Result<Vec<&[u8]>, PersistenceError> {
        self.verify()?;
        (0..self.manifest.compatibility_chunks)
            .map(|index| {
                let address = compatibility_address(&self.manifest.universe_id, &self.manifest.location_id, index)?;
                self.records
                    .get(&address)
                    .map(Vec::as_slice)
                    .ok_or_else(|| PersistenceError::new("save-set-completeness", "compatibility chunk is missing"))
            })
            .collect()
    }
}

pub fn encode_world_save_manifest_v1(value: &WorldSaveManifestV1) -> Result<Vec<u8>, PersistenceError> {
    value.verify()?;
    let mut writer = Writer::default();
    writer.raw(b"BWSM");
    writer.u16(PERSISTENCE_SCHEMA_V1);
    writer.string(&value.world_id)?;
    writer.string(&value.universe_id)?;
    writer.string(&value.location_id)?;
    writer.hash(value.generator_hash);
    writer.hash(value.content_hash);
    writer.u64(value.compatibility_byte_length);
    writer.hash(value.compatibility_hash);
    writer.u32(value.compatibility_chunks);
    writer.u32(value.records.len() as u32);
    for entry in &value.records {
        writer.address(&entry.address)?;
        writer.u32(entry.byte_length);
        writer.hash(entry.payload_hash);
    }
    writer.hash(value.manifest_hash);
    Ok(writer.finish())
}

pub fn decode_world_save_manifest_v1(bytes: &[u8]) -> Result<WorldSaveManifestV1, PersistenceError> {
    let mut reader = Reader::new(bytes);
    if reader.take(4)? != b"BWSM" {
        return Err(PersistenceError::new(
            "save-manifest-magic",
            "world-save manifest magic mismatch",
        ));
    }
    if reader.u16()? != PERSISTENCE_SCHEMA_V1 {
        return Err(PersistenceError::new(
            "save-manifest-schema",
            "unsupported world-save manifest schema",
        ));
    }
    let world_id = reader.string()?;
    let universe_id = reader.string()?;
    let location_id = reader.string()?;
    let generator_hash = reader.hash()?;
    let content_hash = reader.hash()?;
    let compatibility_byte_length = reader.u64()?;
    let compatibility_hash = reader.hash()?;
    let compatibility_chunks = reader.u32()?;
    let count = reader.u32()? as usize;
    if count > MAX_RECORDS_PER_CHECKPOINT_V1 {
        return Err(PersistenceError::new(
            "save-manifest-size",
            "world-save manifest exceeds its record budget",
        ));
    }
    let mut records = Vec::with_capacity(count);
    for _ in 0..count {
        records.push(WorldSaveManifestEntryV1 {
            address: reader.address()?,
            byte_length: reader.u32()?,
            payload_hash: reader.hash()?,
        });
    }
    let value = WorldSaveManifestV1 {
        schema_version: WORLD_SAVE_MANIFEST_SCHEMA_V1,
        world_id,
        universe_id,
        location_id,
        generator_hash,
        content_hash,
        compatibility_byte_length,
        compatibility_hash,
        compatibility_chunks,
        records,
        manifest_hash: reader.hash()?,
    };
    reader.finish()?;
    value.verify()?;
    Ok(value)
}

fn manifest_address(universe_id: &str, location_id: &str) -> Result<RecordAddress, PersistenceError> {
    RecordAddress::new(
        universe_id,
        location_id,
        RecordKind::LocationManifest,
        WORLD_SAVE_MANIFEST_RECORD_ID_V1,
    )
}

fn compatibility_address(universe_id: &str, location_id: &str, index: u32) -> Result<RecordAddress, PersistenceError> {
    RecordAddress::new(
        universe_id,
        location_id,
        RecordKind::SettingsReference,
        format!("{COMPATIBILITY_RECORD_PREFIX_V1}{index:08x}"),
    )
}

fn is_compatibility_address(address: &RecordAddress, universe_id: &str, location_id: &str) -> bool {
    address.universe_id == universe_id
        && address.location_id == location_id
        && address.kind == RecordKind::SettingsReference
        && address.record_id.starts_with(COMPATIBILITY_RECORD_PREFIX_V1)
}

fn manifest_hash(value: &WorldSaveManifestV1) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-world-save-manifest-v1");
    hasher.write_u16(value.schema_version);
    hasher.write_str(&value.world_id);
    hasher.write_str(&value.universe_id);
    hasher.write_str(&value.location_id);
    hasher.write_str(&value.generator_hash.to_hex());
    hasher.write_str(&value.content_hash.to_hex());
    hasher.write_u64(value.compatibility_byte_length);
    hasher.write_str(&value.compatibility_hash.to_hex());
    hasher.write_u32(value.compatibility_chunks);
    hasher.write_u32(value.records.len() as u32);
    for entry in &value.records {
        entry.address.write_hash(&mut hasher);
        hasher.write_u32(entry.byte_length);
        hasher.write_str(&entry.payload_hash.to_hex());
    }
    hasher.finish()
}

fn save_set_hash(manifest: &WorldSaveManifestV1, records: &BTreeMap<RecordAddress, Vec<u8>>) -> CanonicalHash {
    save_set_hash_entries(
        manifest,
        records.len(),
        records.iter().map(|(address, payload)| (address, payload.as_slice())),
    )
}

fn save_set_hash_entries<'a>(
    manifest: &WorldSaveManifestV1,
    record_count: usize,
    records: impl IntoIterator<Item = (&'a RecordAddress, &'a [u8])>,
) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-world-save-set-v1");
    hasher.write_str(&manifest.manifest_hash.to_hex());
    hasher.write_u32(record_count as u32);
    for (address, payload) in records {
        address.write_hash(&mut hasher);
        hasher.write_str(&payload_hash(payload).to_hex());
        hasher.write_u64(payload.len() as u64);
    }
    hasher.finish()
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn raw(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
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
        self.bytes.extend_from_slice(value.as_bytes());
    }
    fn string(&mut self, value: &str) -> Result<(), PersistenceError> {
        let length = u32::try_from(value.len())
            .map_err(|_| PersistenceError::new("save-manifest-size", "manifest string exceeds u32"))?;
        self.u32(length);
        self.raw(value.as_bytes());
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
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| PersistenceError::new("save-manifest-overflow", "manifest offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| PersistenceError::new("save-manifest-truncated", "world-save manifest is truncated"))?;
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
    fn string(&mut self) -> Result<String, PersistenceError> {
        let length = self.u32()? as usize;
        if length > 4096 {
            return Err(PersistenceError::new(
                "save-manifest-size",
                "manifest string exceeds its budget",
            ));
        }
        String::from_utf8(self.take(length)?.to_vec())
            .map_err(|_| PersistenceError::new("save-manifest-utf8", "manifest string is not valid UTF-8"))
    }
    fn address(&mut self) -> Result<RecordAddress, PersistenceError> {
        RecordAddress::new(
            self.string()?,
            self.string()?,
            RecordKind::from_tag(self.u8()?)?,
            self.string()?,
        )
    }
    fn finish(&self) -> Result<(), PersistenceError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(PersistenceError::new(
                "save-manifest-trailing",
                "world-save manifest contains trailing bytes",
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

    #[test]
    fn complete_save_set_is_deterministic_and_preserves_chunked_compatibility_bytes() {
        let entity = NormalizedStateRecordV1 {
            address: RecordAddress::new("u", "surface", RecordKind::Entity, "e:1").unwrap(),
            payload: vec![7, 8, 9],
        };
        let set = CanonicalWorldSaveSetV1::build(
            "world",
            "u",
            "surface",
            hash(1),
            hash(2),
            vec![vec![1, 2], vec![3, 4]],
            vec![entity],
        )
        .unwrap();
        set.verify().unwrap();
        assert_eq!(set.manifest.compatibility_byte_length, 4);
        assert_eq!(set.compatibility_chunks().unwrap(), vec![&[1, 2][..], &[3, 4][..]]);
        assert_eq!(
            decode_world_save_manifest_v1(&encode_world_save_manifest_v1(&set.manifest).unwrap()).unwrap(),
            set.manifest
        );
        assert_eq!(set.checkpoint("cp", None, 0, 10).unwrap().records.len(), 4);
    }

    #[test]
    fn missing_or_corrupt_shard_never_verifies_as_complete() {
        let mut set = CanonicalWorldSaveSetV1::build(
            "world",
            "u",
            "surface",
            hash(1),
            hash(2),
            vec![vec![1]],
            Vec::<NormalizedStateRecordV1>::new(),
        )
        .unwrap();
        let compatibility = compatibility_address("u", "surface", 0).unwrap();
        set.records.get_mut(&compatibility).unwrap()[0] ^= 1;
        assert_eq!(set.verify().unwrap_err().code, "corrupt");
    }

    #[test]
    fn terminal_journal_attestation_reconstructs_the_exact_save_hashes_without_payload_copies() {
        let set = CanonicalWorldSaveSetV1::build(
            "world",
            "u",
            "surface",
            hash(1),
            hash(2),
            vec![vec![1, 2]],
            vec![NormalizedStateRecordV1 {
                address: RecordAddress::new("u", "surface", RecordKind::Entity, "e:1").unwrap(),
                payload: vec![7, 8, 9],
            }],
        )
        .unwrap();
        let mut records = set
            .records
            .iter()
            .map(|(address, payload)| {
                (
                    address.clone(),
                    StoredRecord {
                        revision: 9,
                        payload: payload.clone(),
                        payload_hash: payload_hash(payload),
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            attest_world_save_set_records_v1(&records).unwrap(),
            WorldSaveSetAttestationV1 {
                set_hash: set.set_hash,
                manifest_hash: set.manifest.manifest_hash,
            }
        );
        records.insert(
            RecordAddress::new("u", "surface", RecordKind::Entity, "extra").unwrap(),
            StoredRecord {
                revision: 1,
                payload: vec![1],
                payload_hash: payload_hash(&[1]),
            },
        );
        assert_eq!(
            attest_world_save_set_records_v1(&records).unwrap_err().code,
            "save-set-completeness"
        );
    }
}
