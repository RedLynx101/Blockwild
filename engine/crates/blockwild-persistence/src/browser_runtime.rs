//! Coarse binary boundary between Rust persistence authority and browser-owned IndexedDB.
//!
//! The browser is deliberately a transaction executor. It receives already
//! validated Rust journal/checkpoint records, performs one strict transaction,
//! and returns exact readback bytes. It never repairs revisions or decides
//! which checkpoint is authoritative.

use blockwild_types::{CanonicalHash, CanonicalHasher};
use std::collections::BTreeMap;

use crate::{
    Checkpoint, Mutation, PersistenceError, PersistenceWireRecord, Transaction, decode_record, encode_checkpoint,
    encode_transaction,
};

pub const PERSISTENCE_BROWSER_PROTOCOL_V1: u16 = 1;
pub const PERSISTENCE_BROWSER_HEADER_BYTES_V1: usize = 36;
pub const PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1: usize = 256 * 1024 * 1024;

const REQUEST_MAGIC: [u8; 4] = *b"BWPR";
const RESPONSE_MAGIC: [u8; 4] = *b"BWPA";
const REQUEST_COMMIT: u16 = 1;
const REQUEST_RECOVER_LATEST: u16 = 2;
const REQUEST_READ_CHECKPOINT: u16 = 3;
const RESPONSE_COMMIT: u16 = 101;
const RESPONSE_RECOVERY: u16 = 102;
const RESPONSE_ERROR: u16 = 255;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PersistenceBrowserRequestV1 {
    Commit {
        request_id: u64,
        transaction: Box<Transaction>,
        checkpoint: Box<Checkpoint>,
    },
    RecoverLatest {
        request_id: u64,
        world_id: String,
    },
    ReadCheckpoint {
        request_id: u64,
        world_id: String,
        checkpoint_id: String,
    },
}

impl PersistenceBrowserRequestV1 {
    #[must_use]
    pub const fn request_id(&self) -> u64 {
        match self {
            Self::Commit { request_id, .. }
            | Self::RecoverLatest { request_id, .. }
            | Self::ReadCheckpoint { request_id, .. } => *request_id,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum PersistenceBrowserCommitCodeV1 {
    Committed = 1,
    StaleSequence = 2,
    RecordConflict = 3,
    Quota = 4,
    Corrupt = 5,
    Unavailable = 6,
}

impl PersistenceBrowserCommitCodeV1 {
    fn from_tag(tag: u8) -> Result<Self, PersistenceError> {
        match tag {
            1 => Ok(Self::Committed),
            2 => Ok(Self::StaleSequence),
            3 => Ok(Self::RecordConflict),
            4 => Ok(Self::Quota),
            5 => Ok(Self::Corrupt),
            6 => Ok(Self::Unavailable),
            _ => Err(PersistenceError::new("browser-status", "unknown browser commit status")),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistenceBrowserCommitResultV1 {
    pub request_id: u64,
    pub code: PersistenceBrowserCommitCodeV1,
    pub transaction_id: String,
    pub journal_sequence: u64,
    pub durable_hash: CanonicalHash,
    pub checkpoint_hash: CanonicalHash,
    pub verified_readback: bool,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum PersistenceBrowserRecoveryCodeV1 {
    Ready = 1,
    Empty = 2,
    Corrupt = 3,
}

impl PersistenceBrowserRecoveryCodeV1 {
    fn from_tag(tag: u8) -> Result<Self, PersistenceError> {
        match tag {
            1 => Ok(Self::Ready),
            2 => Ok(Self::Empty),
            3 => Ok(Self::Corrupt),
            _ => Err(PersistenceError::new(
                "browser-status",
                "unknown browser recovery status",
            )),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistenceBrowserRecoveryResultV1 {
    pub request_id: u64,
    pub code: PersistenceBrowserRecoveryCodeV1,
    pub world_id: String,
    pub checkpoint: Option<Checkpoint>,
    /// Payloads are in checkpoint descriptor order. `None` is explicit missing data.
    pub record_payloads: Vec<Option<Vec<u8>>>,
    pub missing_record_keys: Vec<String>,
    pub corrupt_record_keys: Vec<String>,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistenceBrowserErrorV1 {
    pub request_id: u64,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PersistenceBrowserResponseV1 {
    Commit(PersistenceBrowserCommitResultV1),
    Recovery(PersistenceBrowserRecoveryResultV1),
    Error(PersistenceBrowserErrorV1),
}

pub fn prepare_persistence_commit_request_v1(
    request_id: u64,
    transaction: &Transaction,
    checkpoint: &Checkpoint,
) -> Result<Vec<u8>, PersistenceError> {
    let preflight_revisions = transaction
        .mutations
        .iter()
        .filter_map(|mutation| {
            mutation
                .expected_record_revision()
                .map(|revision| (mutation.address().clone(), revision))
        })
        .collect::<BTreeMap<_, _>>();
    transaction.validate_against(transaction.expected_journal_sequence, &preflight_revisions)?;
    checkpoint.verify()?;
    if checkpoint.world_id != transaction.world_id || checkpoint.journal_sequence != transaction.next_journal_sequence {
        return Err(PersistenceError::new(
            "browser-commit",
            "checkpoint does not describe the transaction's next durable head",
        ));
    }
    let checkpoint_records = checkpoint
        .records
        .iter()
        .map(|record| (&record.address, record))
        .collect::<BTreeMap<_, _>>();
    for mutation in &transaction.mutations {
        match mutation {
            Mutation::Put {
                address,
                next_record_revision,
                payload,
                payload_hash,
                ..
            } => {
                let descriptor = checkpoint_records
                    .get(address)
                    .ok_or_else(|| PersistenceError::new("browser-commit", "checkpoint omits a committed record"))?;
                if descriptor.revision != *next_record_revision
                    || descriptor.byte_length as usize != payload.len()
                    || descriptor.payload_hash != *payload_hash
                {
                    return Err(PersistenceError::new(
                        "browser-commit",
                        "checkpoint record does not match its committed mutation",
                    ));
                }
            }
            Mutation::Delete { address, .. } if checkpoint_records.contains_key(address) => {
                return Err(PersistenceError::new(
                    "browser-commit",
                    "checkpoint retains a deleted record",
                ));
            }
            Mutation::Delete { .. } => {}
        }
    }
    let mut payload = Writer::default();
    payload.bytes(&encode_transaction(transaction))?;
    payload.bytes(&encode_checkpoint(checkpoint))?;
    wrap_request(REQUEST_COMMIT, request_id, payload.finish())
}

pub fn prepare_persistence_recover_latest_request_v1(
    request_id: u64,
    world_id: &str,
) -> Result<Vec<u8>, PersistenceError> {
    let mut payload = Writer::default();
    payload.string(world_id)?;
    wrap_request(REQUEST_RECOVER_LATEST, request_id, payload.finish())
}

pub fn prepare_persistence_read_checkpoint_request_v1(
    request_id: u64,
    world_id: &str,
    checkpoint_id: &str,
) -> Result<Vec<u8>, PersistenceError> {
    let mut payload = Writer::default();
    payload.string(world_id)?;
    payload.string(checkpoint_id)?;
    wrap_request(REQUEST_READ_CHECKPOINT, request_id, payload.finish())
}

/// Keeps checkpoint fallback policy on the Rust side. A corrupt latest
/// candidate exposes its validated parent ID, and the browser only performs
/// the requested exact read; it never chooses or silently repairs a head.
pub fn prepare_persistence_recovery_fallback_request_v1(
    request_id: u64,
    recovery: &PersistenceBrowserRecoveryResultV1,
) -> Result<Option<Vec<u8>>, PersistenceError> {
    if recovery.code != PersistenceBrowserRecoveryCodeV1::Corrupt {
        return Ok(None);
    }
    let Some(checkpoint) = &recovery.checkpoint else {
        return Ok(None);
    };
    checkpoint.verify()?;
    checkpoint
        .parent_checkpoint_id
        .as_deref()
        .map(|parent| prepare_persistence_read_checkpoint_request_v1(request_id, &recovery.world_id, parent))
        .transpose()
}

pub fn decode_persistence_browser_request_v1(bytes: &[u8]) -> Result<PersistenceBrowserRequestV1, PersistenceError> {
    let (kind, request_id, payload) = unwrap(REQUEST_MAGIC, bytes)?;
    let mut reader = Reader::new(payload);
    let request = match kind {
        REQUEST_COMMIT => {
            let transaction = match decode_record(&reader.bytes(PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1)?)? {
                PersistenceWireRecord::Transaction(value) => value,
                _ => {
                    return Err(PersistenceError::new(
                        "browser-kind",
                        "commit request did not contain a transaction",
                    ));
                }
            };
            let checkpoint = match decode_record(&reader.bytes(PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1)?)? {
                PersistenceWireRecord::Checkpoint(value) => value,
                _ => {
                    return Err(PersistenceError::new(
                        "browser-kind",
                        "commit request did not contain a checkpoint",
                    ));
                }
            };
            if checkpoint.world_id != transaction.world_id
                || checkpoint.journal_sequence != transaction.next_journal_sequence
            {
                return Err(PersistenceError::new(
                    "browser-commit",
                    "transaction and checkpoint do not share a durable head",
                ));
            }
            PersistenceBrowserRequestV1::Commit {
                request_id,
                transaction: Box::new(transaction),
                checkpoint: Box::new(checkpoint),
            }
        }
        REQUEST_RECOVER_LATEST => PersistenceBrowserRequestV1::RecoverLatest {
            request_id,
            world_id: reader.string()?,
        },
        REQUEST_READ_CHECKPOINT => PersistenceBrowserRequestV1::ReadCheckpoint {
            request_id,
            world_id: reader.string()?,
            checkpoint_id: reader.string()?,
        },
        _ => {
            return Err(PersistenceError::new(
                "browser-kind",
                "unknown persistence browser request",
            ));
        }
    };
    reader.finish()?;
    Ok(request)
}

pub fn encode_persistence_browser_response_v1(
    response: &PersistenceBrowserResponseV1,
) -> Result<Vec<u8>, PersistenceError> {
    let mut payload = Writer::default();
    let (kind, request_id) = match response {
        PersistenceBrowserResponseV1::Commit(value) => {
            payload.u8(value.code as u8);
            payload.string(&value.transaction_id)?;
            payload.u64(value.journal_sequence);
            payload.hash(value.durable_hash);
            payload.hash(value.checkpoint_hash);
            payload.u8(u8::from(value.verified_readback));
            payload.string(&value.message)?;
            (RESPONSE_COMMIT, value.request_id)
        }
        PersistenceBrowserResponseV1::Recovery(value) => {
            payload.u8(value.code as u8);
            payload.string(&value.world_id)?;
            payload.u8(u8::from(value.checkpoint.is_some()));
            if let Some(checkpoint) = &value.checkpoint {
                payload.bytes(&encode_checkpoint(checkpoint))?;
            }
            payload.u32(value.record_payloads.len() as u32);
            for record in &value.record_payloads {
                payload.u8(u8::from(record.is_some()));
                if let Some(bytes) = record {
                    payload.bytes(bytes)?;
                }
            }
            payload.strings(&value.missing_record_keys)?;
            payload.strings(&value.corrupt_record_keys)?;
            payload.string(&value.message)?;
            (RESPONSE_RECOVERY, value.request_id)
        }
        PersistenceBrowserResponseV1::Error(value) => {
            payload.string(&value.code)?;
            payload.string(&value.message)?;
            (RESPONSE_ERROR, value.request_id)
        }
    };
    wrap(RESPONSE_MAGIC, kind, request_id, payload.finish())
}

pub fn decode_persistence_browser_response_v1(bytes: &[u8]) -> Result<PersistenceBrowserResponseV1, PersistenceError> {
    let (kind, request_id, payload) = unwrap(RESPONSE_MAGIC, bytes)?;
    let mut reader = Reader::new(payload);
    let response = match kind {
        RESPONSE_COMMIT => PersistenceBrowserResponseV1::Commit(PersistenceBrowserCommitResultV1 {
            request_id,
            code: PersistenceBrowserCommitCodeV1::from_tag(reader.u8()?)?,
            transaction_id: reader.string()?,
            journal_sequence: reader.u64()?,
            durable_hash: reader.hash()?,
            checkpoint_hash: reader.hash()?,
            verified_readback: reader.flag()?,
            message: reader.string()?,
        }),
        RESPONSE_RECOVERY => {
            let code = PersistenceBrowserRecoveryCodeV1::from_tag(reader.u8()?)?;
            let world_id = reader.string()?;
            let checkpoint = if !reader.flag()? {
                None
            } else {
                match decode_record(&reader.bytes(PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1)?)? {
                    PersistenceWireRecord::Checkpoint(value) => Some(value),
                    _ => {
                        return Err(PersistenceError::new(
                            "browser-kind",
                            "recovery response did not contain a checkpoint",
                        ));
                    }
                }
            };
            let count = reader.u32()? as usize;
            if count > crate::MAX_RECORDS_PER_CHECKPOINT_V1 {
                return Err(PersistenceError::new(
                    "browser-size",
                    "recovery response exceeds record budget",
                ));
            }
            let mut record_payloads = Vec::with_capacity(count);
            for _ in 0..count {
                record_payloads.push(if !reader.flag()? {
                    None
                } else {
                    Some(reader.bytes(crate::MAX_RECORD_BYTES_V1)?)
                });
            }
            let missing_record_keys = reader.strings(crate::MAX_RECORDS_PER_CHECKPOINT_V1)?;
            let corrupt_record_keys = reader.strings(crate::MAX_RECORDS_PER_CHECKPOINT_V1)?;
            let message = reader.string()?;
            if let Some(checkpoint) = &checkpoint {
                if checkpoint.world_id != world_id || checkpoint.records.len() != record_payloads.len() {
                    return Err(PersistenceError::new(
                        "browser-recovery",
                        "recovery checkpoint and payload list disagree",
                    ));
                }
            } else if !record_payloads.is_empty() {
                return Err(PersistenceError::new(
                    "browser-recovery",
                    "recovery payloads require a checkpoint",
                ));
            }
            PersistenceBrowserResponseV1::Recovery(PersistenceBrowserRecoveryResultV1 {
                request_id,
                code,
                world_id,
                checkpoint,
                record_payloads,
                missing_record_keys,
                corrupt_record_keys,
                message,
            })
        }
        RESPONSE_ERROR => PersistenceBrowserResponseV1::Error(PersistenceBrowserErrorV1 {
            request_id,
            code: reader.string()?,
            message: reader.string()?,
        }),
        _ => {
            return Err(PersistenceError::new(
                "browser-kind",
                "unknown persistence browser response",
            ));
        }
    };
    reader.finish()?;
    Ok(response)
}

pub fn verify_persistence_recovery_v1(value: &PersistenceBrowserRecoveryResultV1) -> Result<(), PersistenceError> {
    if value.code != PersistenceBrowserRecoveryCodeV1::Ready {
        return Err(PersistenceError::new(
            "browser-recovery",
            "browser recovery is not ready",
        ));
    }
    let checkpoint = value
        .checkpoint
        .as_ref()
        .ok_or_else(|| PersistenceError::new("browser-recovery", "ready recovery has no checkpoint"))?;
    checkpoint.verify()?;
    if checkpoint.records.len() != value.record_payloads.len() {
        return Err(PersistenceError::new(
            "browser-recovery",
            "recovery payload count does not match checkpoint",
        ));
    }
    for (descriptor, payload) in checkpoint.records.iter().zip(&value.record_payloads) {
        let payload = payload
            .as_ref()
            .ok_or_else(|| PersistenceError::new("browser-recovery", "ready recovery contains a missing record"))?;
        if payload.len() != descriptor.byte_length as usize || crate::payload_hash(payload) != descriptor.payload_hash {
            return Err(PersistenceError::new(
                "browser-recovery",
                "recovery record failed exact Rust readback validation",
            ));
        }
    }
    Ok(())
}

fn wrap_request(kind: u16, request_id: u64, payload: Vec<u8>) -> Result<Vec<u8>, PersistenceError> {
    wrap(REQUEST_MAGIC, kind, request_id, payload)
}

fn wrap(magic: [u8; 4], kind: u16, request_id: u64, payload: Vec<u8>) -> Result<Vec<u8>, PersistenceError> {
    if payload.len() > PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1 - PERSISTENCE_BROWSER_HEADER_BYTES_V1 {
        return Err(PersistenceError::new(
            "browser-size",
            "persistence browser payload exceeds its V1 budget",
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
            "browser-size",
            "persistence browser message is outside its V1 bounds",
        ));
    }
    if bytes[..4] != magic {
        return Err(PersistenceError::new(
            "browser-magic",
            "persistence browser message magic mismatch",
        ));
    }
    let protocol = u16::from_le_bytes(bytes[4..6].try_into().expect("fixed slice"));
    if protocol != PERSISTENCE_BROWSER_PROTOCOL_V1 {
        return Err(PersistenceError::new(
            "browser-protocol",
            "unsupported persistence browser protocol",
        ));
    }
    let kind = u16::from_le_bytes(bytes[6..8].try_into().expect("fixed slice"));
    let request_id = u64::from_le_bytes(bytes[8..16].try_into().expect("fixed slice"));
    let length = u32::from_le_bytes(bytes[16..20].try_into().expect("fixed slice")) as usize;
    if length != bytes.len() - PERSISTENCE_BROWSER_HEADER_BYTES_V1 {
        return Err(PersistenceError::new(
            "browser-length",
            "persistence browser payload length mismatch",
        ));
    }
    let expected_hash = CanonicalHash(bytes[20..36].try_into().expect("fixed slice"));
    let payload = &bytes[PERSISTENCE_BROWSER_HEADER_BYTES_V1..];
    if browser_hash(payload) != expected_hash {
        return Err(PersistenceError::new(
            "browser-checksum",
            "persistence browser payload checksum mismatch",
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
        let length = u32::try_from(value.len())
            .map_err(|_| PersistenceError::new("browser-size", "browser byte field exceeds u32"))?;
        self.u32(length);
        self.bytes.extend_from_slice(value);
        Ok(())
    }
    fn string(&mut self, value: &str) -> Result<(), PersistenceError> {
        self.bytes(value.as_bytes())
    }
    fn strings(&mut self, values: &[String]) -> Result<(), PersistenceError> {
        self.u32(values.len() as u32);
        for value in values {
            self.string(value)?;
        }
        Ok(())
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
            .ok_or_else(|| PersistenceError::new("browser-overflow", "browser offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| PersistenceError::new("browser-truncated", "persistence browser message is truncated"))?;
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
            _ => Err(PersistenceError::new(
                "browser-flag",
                "browser boolean flag is not 0 or 1",
            )),
        }
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
                "browser-size",
                "browser byte field exceeds its budget",
            ));
        }
        Ok(self.take(length)?.to_vec())
    }
    fn string(&mut self) -> Result<String, PersistenceError> {
        String::from_utf8(self.bytes(4096)?)
            .map_err(|_| PersistenceError::new("browser-utf8", "browser string is not valid UTF-8"))
    }
    fn strings(&mut self, maximum: usize) -> Result<Vec<String>, PersistenceError> {
        let count = self.u32()? as usize;
        if count > maximum {
            return Err(PersistenceError::new(
                "browser-size",
                "browser string list exceeds its budget",
            ));
        }
        (0..count).map(|_| self.string()).collect()
    }
    fn finish(&self) -> Result<(), PersistenceError> {
        if self.offset != self.bytes.len() {
            return Err(PersistenceError::new(
                "browser-trailing",
                "persistence browser message contains trailing bytes",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MutationInput, RecordAddress, RecordDescriptor, RecordKind};

    fn fixture() -> (Transaction, Checkpoint) {
        let address = RecordAddress::new("world:browser", "overworld", RecordKind::Entity, "creature:Ã±").unwrap();
        let transaction = Transaction::new(
            "transaction:browser",
            "world:browser",
            "checkpoint:base",
            0,
            1,
            vec![MutationInput::Put {
                address: address.clone(),
                expected_record_revision: None,
                next_record_revision: 1,
                payload: vec![0x00, 0x7f, 0x80, 0xff, 0xc3, 0xb1],
            }],
        )
        .unwrap();
        let mutation = &transaction.mutations[0];
        let checkpoint = Checkpoint::new(
            "checkpoint:one",
            None,
            "world:browser",
            1,
            CanonicalHash([0x11; 16]),
            CanonicalHash([0x22; 16]),
            7,
            vec![RecordDescriptor {
                address,
                revision: 1,
                byte_length: 6,
                payload_hash: match mutation {
                    crate::Mutation::Put { payload_hash, .. } => *payload_hash,
                    _ => unreachable!(),
                },
            }],
        )
        .unwrap();
        (transaction, checkpoint)
    }

    #[test]
    fn commit_request_round_trips_non_ascii_bytes() {
        let (transaction, checkpoint) = fixture();
        let encoded = prepare_persistence_commit_request_v1(0x0012_0304_0506_0708, &transaction, &checkpoint).unwrap();
        let decoded = decode_persistence_browser_request_v1(&encoded).unwrap();
        assert_eq!(
            decoded,
            PersistenceBrowserRequestV1::Commit {
                request_id: 0x0012_0304_0506_0708,
                transaction: Box::new(transaction),
                checkpoint: Box::new(checkpoint)
            }
        );
        let expected =
            include_str!("../../../../tests/fixtures/rust-engine/r8-r9/persistence-browser-runtime-v1.hex").trim();
        if expected.is_empty() {
            panic!("PERSISTENCE_FIXTURE={}", hex(&encoded));
        }
        assert_eq!(hex(&encoded), expected);
    }

    #[test]
    fn recovery_response_requires_exact_record_hashes() {
        let (_, checkpoint) = fixture();
        let value = PersistenceBrowserRecoveryResultV1 {
            request_id: 9,
            code: PersistenceBrowserRecoveryCodeV1::Ready,
            world_id: "world:browser".to_owned(),
            checkpoint: Some(checkpoint),
            record_payloads: vec![Some(vec![0x00, 0x7f, 0x80, 0xff, 0xc3, 0xb1])],
            missing_record_keys: vec![],
            corrupt_record_keys: vec![],
            message: "ready".to_owned(),
        };
        verify_persistence_recovery_v1(&value).unwrap();
        let bytes =
            encode_persistence_browser_response_v1(&PersistenceBrowserResponseV1::Recovery(value.clone())).unwrap();
        let expected =
            include_str!("../../../../tests/fixtures/rust-engine/r8-r9/persistence-browser-recovery-response-v1.hex")
                .trim();
        assert_eq!(hex(&bytes), expected);
        assert_eq!(
            decode_persistence_browser_response_v1(&bytes).unwrap(),
            PersistenceBrowserResponseV1::Recovery(value)
        );
    }

    #[test]
    fn malformed_outer_messages_fail_closed() {
        let (transaction, checkpoint) = fixture();
        let mut encoded = prepare_persistence_commit_request_v1(1, &transaction, &checkpoint).unwrap();
        *encoded.last_mut().unwrap() ^= 0x80;
        assert_eq!(
            decode_persistence_browser_request_v1(&encoded).unwrap_err().code,
            "browser-checksum"
        );
    }

    #[test]
    fn corrupt_recovery_fallback_is_an_explicit_rust_parent_read() {
        let (_, base) = fixture();
        let checkpoint = Checkpoint::new(
            base.checkpoint_id,
            Some("checkpoint:parent".into()),
            base.world_id,
            base.journal_sequence,
            base.generator_hash,
            base.content_hash,
            base.created_at,
            base.records,
        )
        .unwrap();
        let corrupt = PersistenceBrowserRecoveryResultV1 {
            request_id: 20,
            code: PersistenceBrowserRecoveryCodeV1::Corrupt,
            world_id: checkpoint.world_id.clone(),
            checkpoint: Some(checkpoint),
            record_payloads: vec![None],
            missing_record_keys: vec!["missing".into()],
            corrupt_record_keys: vec![],
            message: "corrupt".into(),
        };
        let request = prepare_persistence_recovery_fallback_request_v1(21, &corrupt)
            .unwrap()
            .expect("parent read request");
        assert_eq!(
            decode_persistence_browser_request_v1(&request).unwrap(),
            PersistenceBrowserRequestV1::ReadCheckpoint {
                request_id: 21,
                world_id: "world:browser".into(),
                checkpoint_id: "checkpoint:parent".into(),
            }
        );
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
