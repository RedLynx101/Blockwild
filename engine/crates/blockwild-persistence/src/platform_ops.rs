//! Additive, bounded BWPR/BWPA operations beyond the legacy commit packet.
//!
//! These packets deliberately carry execution instructions, not policy. Rust
//! chooses the operation, cursor, bounds, expected head, and retry behavior;
//! the browser validates and executes the requested IndexedDB operation.

use crate::{
    MAX_RECORD_BYTES_V1, PERSISTENCE_BROWSER_HEADER_BYTES_V1, PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1,
    PERSISTENCE_BROWSER_PROTOCOL_V1, PersistenceError, validate_label,
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
            _ => Err(PersistenceError::new(
                "platform-operation",
                "unknown persistence platform operation",
            )),
        }
    }
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
        if self.code != PersistencePlatformResultCodeV1::Accepted && self.storage_revision != 0 {
            return Err(PersistenceError::new(
                "platform-response",
                "rejected platform operation attempted to advance storage revision",
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
