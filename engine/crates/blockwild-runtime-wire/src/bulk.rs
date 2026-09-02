//! Detached, priority-lower bulk platform lane for complete BWPR/BWPA packets.
//!
//! Normal BWRQ gameplay/input envelopes keep their 8 MiB/1 MiB limits. This
//! protocol transfers a checksummed control envelope and an independently
//! checksummed attachment, avoiding an additional browser structured-clone
//! copy and making ownership/backpressure explicit.

use crate::{
    PERSISTENCE_STATUS_RECEIPT_TYPE_V1, PERSISTENCE_STATUS_TYPE_V1, RuntimeIdentityV1, RuntimeRevisionV1, WireError,
    WireHash, wire_checksum_v1,
};

pub const RUNTIME_BULK_WIRE_V1: u16 = 1;
pub const RUNTIME_BULK_SCHEMA_V2: u16 = 2;
pub const RUNTIME_BULK_HEADER_BYTES_V1: usize = 64;
pub const RUNTIME_BULK_MAX_CONTROL_BYTES_V1: usize = 16 * 1024;
pub const RUNTIME_BULK_ROUTINE_BYTES_V1: usize = 1024 * 1024;
pub const RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1: usize = 256 * 1024 * 1024;
pub const RUNTIME_BULK_MAX_PENDING_V1: usize = 2;
pub const RUNTIME_BULK_MAX_QUEUED_BYTES_V1: usize = 256 * 1024 * 1024;
pub const PERSISTENCE_REQUEST_TYPE_V1: &str = "blockwild.persistence.browser-request.r8.v1";
pub const PERSISTENCE_RESPONSE_TYPE_V1: &str = "blockwild.persistence.browser-response.r8.v1";
pub const PERSISTENCE_COMPATIBILITY_STAGE_CHUNK_TYPE_V1: &str = "blockwild.persistence.compatibility-stage-chunk.r8.v1";
pub const PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1: &str =
    "blockwild.persistence.compatibility-hydration-chunk.r8.v1";
pub const RUNTIME_BULK_SAVE_CHUNK_BYTES_V1: usize = 4 * 1024 * 1024;
pub const RUNTIME_BULK_MAX_SAVE_CHUNKS_V1: u32 = 64;
pub const RUNTIME_BULK_PERSISTENCE_STATUS_BYTES_V1: usize = 4 * 1024;

const REQUEST_MAGIC: [u8; 4] = *b"BWRB";
const RESPONSE_MAGIC: [u8; 4] = *b"BWRC";
const MAX_SAFE_U64: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeBulkStateV1 {
    pub revision: RuntimeRevisionV1,
    pub tick: u64,
    pub state_hash: WireHash,
}

impl From<&RuntimeIdentityV1> for RuntimeBulkStateV1 {
    fn from(value: &RuntimeIdentityV1) -> Self {
        Self {
            revision: value.revision,
            tick: value.tick,
            state_hash: value.state_hash,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimeBulkRequestV1 {
    Poll {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeBulkStateV1,
        max_bytes: u32,
    },
    Complete {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeBulkStateV1,
        transfer_token: u64,
        type_id: String,
        payload: Vec<u8>,
    },
    StageSaveChunk {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeBulkStateV1,
        stage_id: String,
        chunk_index: u32,
        chunk_count: u32,
        total_bytes: u64,
        payload: Vec<u8>,
    },
    FinalizeSave {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeBulkStateV1,
        stage_id: String,
        created_at: u64,
    },
    HydrateRecovery {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeBulkStateV1,
        recovery_id: String,
    },
    ReadHydratedCompatibility {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeBulkStateV1,
        recovery_id: String,
        chunk_index: u32,
    },
    CancelSaveStage {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeBulkStateV1,
        stage_id: String,
    },
    PersistenceStatus {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeBulkStateV1,
        type_id: String,
        payload: Vec<u8>,
    },
}

impl RuntimeBulkRequestV1 {
    #[must_use]
    pub const fn request_id(&self) -> u32 {
        match self {
            Self::Poll { request_id, .. }
            | Self::Complete { request_id, .. }
            | Self::StageSaveChunk { request_id, .. }
            | Self::FinalizeSave { request_id, .. }
            | Self::HydrateRecovery { request_id, .. }
            | Self::ReadHydratedCompatibility { request_id, .. }
            | Self::CancelSaveStage { request_id, .. }
            | Self::PersistenceStatus { request_id, .. } => *request_id,
        }
    }

    #[must_use]
    pub const fn client_epoch(&self) -> u32 {
        match self {
            Self::Poll { client_epoch, .. }
            | Self::Complete { client_epoch, .. }
            | Self::StageSaveChunk { client_epoch, .. }
            | Self::FinalizeSave { client_epoch, .. }
            | Self::HydrateRecovery { client_epoch, .. }
            | Self::ReadHydratedCompatibility { client_epoch, .. }
            | Self::CancelSaveStage { client_epoch, .. }
            | Self::PersistenceStatus { client_epoch, .. } => *client_epoch,
        }
    }

    #[must_use]
    pub const fn expected(&self) -> &RuntimeBulkStateV1 {
        match self {
            Self::Poll { expected, .. }
            | Self::Complete { expected, .. }
            | Self::StageSaveChunk { expected, .. }
            | Self::FinalizeSave { expected, .. }
            | Self::HydrateRecovery { expected, .. }
            | Self::ReadHydratedCompatibility { expected, .. }
            | Self::CancelSaveStage { expected, .. }
            | Self::PersistenceStatus { expected, .. } => expected,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum RuntimeBulkSaveStageStateV1 {
    Staged = 1,
    Finalized = 2,
    Cancelled = 3,
}

#[derive(Clone, Debug, Eq, PartialEq)]
// This is a short-lived decoded wire value. Keeping every response payload
// inline avoids a heap-shape distinction in the canonical codec and the
// migration attestation never enters a retained hot-path queue.
#[allow(clippy::large_enum_variant)]
pub enum RuntimeBulkResponseV1 {
    Empty {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        current: RuntimeBulkStateV1,
    },
    PlatformRequest {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        current: RuntimeBulkStateV1,
        transfer_token: u64,
        type_id: String,
        payload: Vec<u8>,
    },
    Completed {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        current: RuntimeBulkStateV1,
        transfer_token: u64,
        result_hash: WireHash,
    },
    SaveProgress {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        current: RuntimeBulkStateV1,
        stage_id: String,
        state: RuntimeBulkSaveStageStateV1,
        received_chunks: u32,
        chunk_count: u32,
        received_bytes: u64,
        set_hash: WireHash,
        manifest_hash: WireHash,
        dispatcher_request_id: u64,
        remaining_dirty_records: u32,
    },
    Hydration {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        current: RuntimeBulkStateV1,
        recovery_id: String,
        native_domains: u16,
        chunk_count: u32,
        total_bytes: u64,
        compatibility_hash: WireHash,
        legacy_migration: Option<RuntimeLegacyMigrationAttestationWireV1>,
    },
    Data {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        current: RuntimeBulkStateV1,
        transfer_token: u64,
        type_id: String,
        chunk_index: u32,
        chunk_count: u32,
        payload: Vec<u8>,
    },
    PersistenceStatus {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        current: RuntimeBulkStateV1,
        type_id: String,
        payload: Vec<u8>,
    },
    Error {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        code: String,
        message: String,
        current: Option<RuntimeBulkStateV1>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeLegacyMigrationAttestationWireV1 {
    pub migration_id: String,
    pub created_at: u64,
    pub source_key: String,
    pub source_format: String,
    pub source_byte_length: u64,
    pub source_hash: WireHash,
    pub projection_hash: WireHash,
    pub projection_edit_count: u64,
    pub projection_facing_count: u64,
    pub native_world_semantic_hash: WireHash,
    pub native_world_edit_count: u64,
    pub native_world_facing_count: u64,
    pub world_id: String,
    pub universe_id: String,
    pub location_id: String,
    pub world_seed: String,
    pub generator_hash: WireHash,
    pub content_hash: WireHash,
    pub terrain_content_hash: WireHash,
    pub generation_options_hash: WireHash,
    pub backup_byte_length: u64,
    pub backup_hash: WireHash,
    pub backup_chunks: u32,
    pub native_record_set_hash: WireHash,
    pub descriptor_hash: WireHash,
    pub save_set_hash: WireHash,
    pub manifest_hash: WireHash,
}

impl RuntimeBulkResponseV1 {
    #[must_use]
    pub const fn request_id(&self) -> u32 {
        match self {
            Self::Empty { request_id, .. }
            | Self::PlatformRequest { request_id, .. }
            | Self::Completed { request_id, .. }
            | Self::SaveProgress { request_id, .. }
            | Self::Hydration { request_id, .. }
            | Self::Data { request_id, .. }
            | Self::PersistenceStatus { request_id, .. }
            | Self::Error { request_id, .. } => *request_id,
        }
    }

    #[must_use]
    pub const fn client_epoch(&self) -> u32 {
        match self {
            Self::Empty { client_epoch, .. }
            | Self::PlatformRequest { client_epoch, .. }
            | Self::Completed { client_epoch, .. }
            | Self::SaveProgress { client_epoch, .. }
            | Self::Hydration { client_epoch, .. }
            | Self::Data { client_epoch, .. }
            | Self::PersistenceStatus { client_epoch, .. }
            | Self::Error { client_epoch, .. } => *client_epoch,
        }
    }

    #[must_use]
    pub const fn worker_epoch(&self) -> u32 {
        match self {
            Self::Empty { worker_epoch, .. }
            | Self::PlatformRequest { worker_epoch, .. }
            | Self::Completed { worker_epoch, .. }
            | Self::SaveProgress { worker_epoch, .. }
            | Self::Hydration { worker_epoch, .. }
            | Self::Data { worker_epoch, .. }
            | Self::PersistenceStatus { worker_epoch, .. }
            | Self::Error { worker_epoch, .. } => *worker_epoch,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeBulkEncodedV1 {
    pub control: Vec<u8>,
    pub attachment: Vec<u8>,
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

    fn u64(&mut self, value: u64) -> Result<(), WireError> {
        if value > MAX_SAFE_U64 {
            return Err(WireError::new("integer", "bulk u64 exceeds JavaScript's exact range"));
        }
        self.bytes.extend_from_slice(&value.to_le_bytes());
        Ok(())
    }

    fn hash(&mut self, value: WireHash) {
        self.bytes.extend_from_slice(&value.0);
    }

    fn string(&mut self, value: &str, expected: Option<&str>, maximum: usize) -> Result<(), WireError> {
        if let Some(expected) = expected
            && value != expected
        {
            return Err(WireError::new("type-id", format!("bulk type must be {expected}")));
        }
        if value.is_empty() || value.len() > maximum || value.len() > u16::MAX as usize {
            return Err(WireError::new("string", "bulk string exceeds its byte budget"));
        }
        self.u16(value.len() as u16);
        self.bytes.extend_from_slice(value.as_bytes());
        Ok(())
    }

    fn bytes(&mut self, value: &[u8], maximum: usize) -> Result<(), WireError> {
        if value.is_empty() || value.len() > maximum || value.len() > u16::MAX as usize {
            return Err(WireError::new("bytes", "bulk inline payload exceeds its byte budget"));
        }
        self.u16(value.len() as u16);
        self.bytes.extend_from_slice(value);
        Ok(())
    }

    fn state(&mut self, value: &RuntimeBulkStateV1) -> Result<(), WireError> {
        for revision in [
            value.revision.epoch,
            value.revision.world,
            value.revision.entities,
            value.revision.gameplay,
            value.revision.persistence,
            value.revision.network,
            value.revision.simulation,
        ] {
            self.u64(revision)?;
        }
        self.u64(value.tick)?;
        self.hash(value.state_hash);
        Ok(())
    }

    fn finish(self) -> Result<Vec<u8>, WireError> {
        if self.bytes.len() > RUNTIME_BULK_MAX_CONTROL_BYTES_V1 - RUNTIME_BULK_HEADER_BYTES_V1 {
            return Err(WireError::new(
                "control-capacity",
                "bulk control body exceeds its byte budget",
            ));
        }
        Ok(self.bytes)
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

    fn take(&mut self, length: usize) -> Result<&'a [u8], WireError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| WireError::new("truncated", "bulk control length overflow"))?;
        if end > self.bytes.len() {
            return Err(WireError::new("truncated", "bulk control body is truncated"));
        }
        let result = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(result)
    }

    fn u8(&mut self) -> Result<u8, WireError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, WireError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("two-byte slice")))
    }

    fn u32(&mut self) -> Result<u32, WireError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("four-byte slice")))
    }

    fn u64(&mut self) -> Result<u64, WireError> {
        let value = u64::from_le_bytes(self.take(8)?.try_into().expect("eight-byte slice"));
        if value > MAX_SAFE_U64 {
            return Err(WireError::new("integer", "bulk u64 exceeds JavaScript's exact range"));
        }
        Ok(value)
    }

    fn hash(&mut self) -> Result<WireHash, WireError> {
        Ok(WireHash(self.take(16)?.try_into().expect("sixteen-byte slice")))
    }

    fn string(&mut self, expected: Option<&str>, maximum: usize) -> Result<String, WireError> {
        let length = usize::from(self.u16()?);
        if length == 0 || length > maximum {
            return Err(WireError::new("string", "bulk string exceeds its byte budget"));
        }
        let value = std::str::from_utf8(self.take(length)?)
            .map_err(|_| WireError::new("unicode", "bulk string is not valid UTF-8"))?;
        if let Some(expected) = expected
            && value != expected
        {
            return Err(WireError::new("type-id", format!("bulk type must be {expected}")));
        }
        Ok(value.to_owned())
    }

    fn bytes(&mut self, maximum: usize) -> Result<Vec<u8>, WireError> {
        let length = usize::from(self.u16()?);
        if length == 0 || length > maximum {
            return Err(WireError::new("bytes", "bulk inline payload exceeds its byte budget"));
        }
        Ok(self.take(length)?.to_vec())
    }

    fn state(&mut self) -> Result<RuntimeBulkStateV1, WireError> {
        Ok(RuntimeBulkStateV1 {
            revision: RuntimeRevisionV1 {
                epoch: self.u64()?,
                world: self.u64()?,
                entities: self.u64()?,
                gameplay: self.u64()?,
                persistence: self.u64()?,
                network: self.u64()?,
                simulation: self.u64()?,
            },
            tick: self.u64()?,
            state_hash: self.hash()?,
        })
    }

    fn finish(&self) -> Result<(), WireError> {
        if self.offset != self.bytes.len() {
            return Err(WireError::new("trailing", "bulk control body contains trailing bytes"));
        }
        Ok(())
    }
}

struct Envelope<'a> {
    operation: u8,
    status: u8,
    request_id: u32,
    client_epoch: u32,
    worker_epoch: u32,
    body: &'a [u8],
    attachment: &'a [u8],
}

#[allow(clippy::too_many_arguments)]
fn encode_control(
    magic: [u8; 4],
    operation: u8,
    status: u8,
    request_id: u32,
    client_epoch: u32,
    worker_epoch: u32,
    body: Vec<u8>,
    attachment: Vec<u8>,
) -> Result<RuntimeBulkEncodedV1, WireError> {
    if request_id == 0 || client_epoch == 0 {
        return Err(WireError::new(
            "integer",
            "bulk request and client epochs must be non-zero",
        ));
    }
    if attachment.len() > RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1 {
        return Err(WireError::new("attachment-capacity", "bulk attachment exceeds 256 MiB"));
    }
    let body_len =
        u32::try_from(body.len()).map_err(|_| WireError::new("control-capacity", "bulk control is too large"))?;
    let attachment_len = u32::try_from(attachment.len())
        .map_err(|_| WireError::new("attachment-capacity", "bulk attachment is too large"))?;
    let mut control = Vec::with_capacity(RUNTIME_BULK_HEADER_BYTES_V1 + body.len());
    control.extend_from_slice(&magic);
    control.extend_from_slice(&RUNTIME_BULK_WIRE_V1.to_le_bytes());
    control.extend_from_slice(&RUNTIME_BULK_SCHEMA_V2.to_le_bytes());
    control.extend_from_slice(&[operation, status, 4, 0]);
    control.extend_from_slice(&request_id.to_le_bytes());
    control.extend_from_slice(&client_epoch.to_le_bytes());
    control.extend_from_slice(&worker_epoch.to_le_bytes());
    control.extend_from_slice(&body_len.to_le_bytes());
    control.extend_from_slice(&attachment_len.to_le_bytes());
    control.extend_from_slice(&wire_checksum_v1(&body));
    control.extend_from_slice(&wire_checksum_v1(&attachment));
    control.extend_from_slice(&body);
    Ok(RuntimeBulkEncodedV1 { control, attachment })
}

fn decode_control<'a>(control: &'a [u8], attachment: &'a [u8], magic: [u8; 4]) -> Result<Envelope<'a>, WireError> {
    if control.len() < RUNTIME_BULK_HEADER_BYTES_V1 || control.len() > RUNTIME_BULK_MAX_CONTROL_BYTES_V1 {
        return Err(WireError::new(
            "control-capacity",
            "bulk control envelope is outside its byte budget",
        ));
    }
    if control[..4] != magic {
        return Err(WireError::new("magic", "bulk control magic is invalid"));
    }
    if u16::from_le_bytes(control[4..6].try_into().expect("version")) != RUNTIME_BULK_WIRE_V1
        || u16::from_le_bytes(control[6..8].try_into().expect("schema")) != RUNTIME_BULK_SCHEMA_V2
    {
        return Err(WireError::new("version", "bulk wire or runtime schema is unsupported"));
    }
    if control[10] != 4 || control[11] != 0 {
        return Err(WireError::new("domain", "bulk domain or reserved bits are invalid"));
    }
    let body_len = u32::from_le_bytes(control[24..28].try_into().expect("body length")) as usize;
    let attachment_len = u32::from_le_bytes(control[28..32].try_into().expect("attachment length")) as usize;
    if body_len != control.len() - RUNTIME_BULK_HEADER_BYTES_V1 || attachment_len != attachment.len() {
        return Err(WireError::new("length", "bulk control or attachment length is invalid"));
    }
    let body = &control[RUNTIME_BULK_HEADER_BYTES_V1..];
    if control[32..48] != wire_checksum_v1(body) || control[48..64] != wire_checksum_v1(attachment) {
        return Err(WireError::new("checksum", "bulk control or attachment checksum failed"));
    }
    Ok(Envelope {
        operation: control[8],
        status: control[9],
        request_id: u32::from_le_bytes(control[12..16].try_into().expect("request id")),
        client_epoch: u32::from_le_bytes(control[16..20].try_into().expect("client epoch")),
        worker_epoch: u32::from_le_bytes(control[20..24].try_into().expect("worker epoch")),
        body,
        attachment,
    })
}

pub fn encode_bulk_request_v1(value: &RuntimeBulkRequestV1) -> Result<RuntimeBulkEncodedV1, WireError> {
    let mut writer = Writer::default();
    let (operation, attachment) = match value {
        RuntimeBulkRequestV1::Poll {
            expected, max_bytes, ..
        } => {
            writer.state(expected)?;
            if *max_bytes == 0 || *max_bytes as usize > RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1 {
                return Err(WireError::new("attachment-capacity", "bulk poll max bytes is invalid"));
            }
            writer.u32(*max_bytes);
            (1, Vec::new())
        }
        RuntimeBulkRequestV1::Complete {
            expected,
            transfer_token,
            type_id,
            payload,
            ..
        } => {
            writer.state(expected)?;
            if *transfer_token == 0 {
                return Err(WireError::new("integer", "bulk transfer token must be non-zero"));
            }
            writer.u64(*transfer_token)?;
            writer.string(type_id, Some(PERSISTENCE_RESPONSE_TYPE_V1), 160)?;
            (2, payload.clone())
        }
        RuntimeBulkRequestV1::StageSaveChunk {
            expected,
            stage_id,
            chunk_index,
            chunk_count,
            total_bytes,
            payload,
            ..
        } => {
            writer.state(expected)?;
            writer.string(stage_id, None, 180)?;
            if *chunk_count == 0
                || *chunk_count > RUNTIME_BULK_MAX_SAVE_CHUNKS_V1
                || *chunk_index >= *chunk_count
                || payload.is_empty()
                || payload.len() > RUNTIME_BULK_SAVE_CHUNK_BYTES_V1
                || *total_bytes == 0
                || *total_bytes > RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1 as u64
            {
                return Err(WireError::new(
                    "save-stage",
                    "bulk save chunk metadata exceeds its bounds",
                ));
            }
            writer.u32(*chunk_index);
            writer.u32(*chunk_count);
            writer.u64(*total_bytes)?;
            writer.string(
                PERSISTENCE_COMPATIBILITY_STAGE_CHUNK_TYPE_V1,
                Some(PERSISTENCE_COMPATIBILITY_STAGE_CHUNK_TYPE_V1),
                160,
            )?;
            (3, payload.clone())
        }
        RuntimeBulkRequestV1::FinalizeSave {
            expected,
            stage_id,
            created_at,
            ..
        } => {
            writer.state(expected)?;
            writer.string(stage_id, None, 180)?;
            writer.u64(*created_at)?;
            (4, Vec::new())
        }
        RuntimeBulkRequestV1::HydrateRecovery {
            expected, recovery_id, ..
        } => {
            writer.state(expected)?;
            writer.string(recovery_id, None, 256)?;
            (5, Vec::new())
        }
        RuntimeBulkRequestV1::ReadHydratedCompatibility {
            expected,
            recovery_id,
            chunk_index,
            ..
        } => {
            writer.state(expected)?;
            writer.string(recovery_id, None, 256)?;
            writer.u32(*chunk_index);
            (6, Vec::new())
        }
        RuntimeBulkRequestV1::CancelSaveStage { expected, stage_id, .. } => {
            writer.state(expected)?;
            writer.string(stage_id, None, 180)?;
            (7, Vec::new())
        }
        RuntimeBulkRequestV1::PersistenceStatus {
            expected,
            type_id,
            payload,
            ..
        } => {
            writer.state(expected)?;
            writer.string(type_id, Some(PERSISTENCE_STATUS_TYPE_V1), 160)?;
            writer.bytes(payload, RUNTIME_BULK_PERSISTENCE_STATUS_BYTES_V1)?;
            (9, Vec::new())
        }
    };
    encode_control(
        REQUEST_MAGIC,
        operation,
        0,
        value.request_id(),
        value.client_epoch(),
        0,
        writer.finish()?,
        attachment,
    )
}

pub fn decode_bulk_request_v1(control: &[u8], attachment: &[u8]) -> Result<RuntimeBulkRequestV1, WireError> {
    let envelope = decode_control(control, attachment, REQUEST_MAGIC)?;
    if envelope.status != 0 || envelope.worker_epoch != 0 || envelope.request_id == 0 || envelope.client_epoch == 0 {
        return Err(WireError::new("request-header", "bulk request header is invalid"));
    }
    let mut reader = Reader::new(envelope.body);
    let expected = reader.state()?;
    let value = match envelope.operation {
        1 => {
            if !attachment.is_empty() {
                return Err(WireError::new("attachment", "bulk poll cannot carry an attachment"));
            }
            let max_bytes = reader.u32()?;
            if max_bytes == 0 || max_bytes as usize > RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1 {
                return Err(WireError::new("attachment-capacity", "bulk poll max bytes is invalid"));
            }
            RuntimeBulkRequestV1::Poll {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                expected,
                max_bytes,
            }
        }
        2 => RuntimeBulkRequestV1::Complete {
            request_id: envelope.request_id,
            client_epoch: envelope.client_epoch,
            expected,
            transfer_token: reader.u64()?,
            type_id: reader.string(Some(PERSISTENCE_RESPONSE_TYPE_V1), 160)?,
            payload: envelope.attachment.to_vec(),
        },
        3 => {
            let stage_id = reader.string(None, 180)?;
            let chunk_index = reader.u32()?;
            let chunk_count = reader.u32()?;
            let total_bytes = reader.u64()?;
            reader.string(Some(PERSISTENCE_COMPATIBILITY_STAGE_CHUNK_TYPE_V1), 160)?;
            if chunk_count == 0
                || chunk_count > RUNTIME_BULK_MAX_SAVE_CHUNKS_V1
                || chunk_index >= chunk_count
                || envelope.attachment.is_empty()
                || envelope.attachment.len() > RUNTIME_BULK_SAVE_CHUNK_BYTES_V1
                || total_bytes == 0
                || total_bytes > RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1 as u64
            {
                return Err(WireError::new(
                    "save-stage",
                    "bulk save chunk metadata exceeds its bounds",
                ));
            }
            RuntimeBulkRequestV1::StageSaveChunk {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                expected,
                stage_id,
                chunk_index,
                chunk_count,
                total_bytes,
                payload: envelope.attachment.to_vec(),
            }
        }
        4 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk save finalize cannot carry an attachment",
                ));
            }
            RuntimeBulkRequestV1::FinalizeSave {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                expected,
                stage_id: reader.string(None, 180)?,
                created_at: reader.u64()?,
            }
        }
        5 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk recovery hydration cannot carry an attachment",
                ));
            }
            RuntimeBulkRequestV1::HydrateRecovery {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                expected,
                recovery_id: reader.string(None, 256)?,
            }
        }
        6 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk compatibility read cannot carry an attachment",
                ));
            }
            RuntimeBulkRequestV1::ReadHydratedCompatibility {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                expected,
                recovery_id: reader.string(None, 256)?,
                chunk_index: reader.u32()?,
            }
        }
        7 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk save cancel cannot carry an attachment",
                ));
            }
            RuntimeBulkRequestV1::CancelSaveStage {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                expected,
                stage_id: reader.string(None, 180)?,
            }
        }
        9 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk persistence status cannot carry an attachment",
                ));
            }
            RuntimeBulkRequestV1::PersistenceStatus {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                expected,
                type_id: reader.string(Some(PERSISTENCE_STATUS_TYPE_V1), 160)?,
                payload: reader.bytes(RUNTIME_BULK_PERSISTENCE_STATUS_BYTES_V1)?,
            }
        }
        _ => return Err(WireError::new("operation", "bulk request operation is unknown")),
    };
    reader.finish()?;
    Ok(value)
}

pub fn encode_bulk_response_v1(value: &RuntimeBulkResponseV1) -> Result<RuntimeBulkEncodedV1, WireError> {
    if value.worker_epoch() == 0 {
        return Err(WireError::new(
            "worker-epoch",
            "bulk response is missing its worker generation",
        ));
    }
    let mut writer = Writer::default();
    let (operation, status, attachment) = match value {
        RuntimeBulkResponseV1::Empty { current, .. } => {
            writer.state(current)?;
            (1, 0, Vec::new())
        }
        RuntimeBulkResponseV1::PlatformRequest {
            current,
            transfer_token,
            type_id,
            payload,
            ..
        } => {
            writer.state(current)?;
            if *transfer_token == 0 {
                return Err(WireError::new("integer", "bulk transfer token must be non-zero"));
            }
            writer.u64(*transfer_token)?;
            writer.string(type_id, Some(PERSISTENCE_REQUEST_TYPE_V1), 160)?;
            (2, 0, payload.clone())
        }
        RuntimeBulkResponseV1::Completed {
            current,
            transfer_token,
            result_hash,
            ..
        } => {
            writer.state(current)?;
            writer.u64(*transfer_token)?;
            writer.hash(*result_hash);
            (3, 0, Vec::new())
        }
        RuntimeBulkResponseV1::SaveProgress {
            current,
            stage_id,
            state,
            received_chunks,
            chunk_count,
            received_bytes,
            set_hash,
            manifest_hash,
            dispatcher_request_id,
            remaining_dirty_records,
            ..
        } => {
            writer.state(current)?;
            writer.string(stage_id, None, 180)?;
            writer.u8(*state as u8);
            writer.u32(*received_chunks);
            writer.u32(*chunk_count);
            writer.u64(*received_bytes)?;
            writer.hash(*set_hash);
            writer.hash(*manifest_hash);
            writer.u64(*dispatcher_request_id)?;
            writer.u32(*remaining_dirty_records);
            (4, 0, Vec::new())
        }
        RuntimeBulkResponseV1::Hydration {
            current,
            recovery_id,
            native_domains,
            chunk_count,
            total_bytes,
            compatibility_hash,
            legacy_migration,
            ..
        } => {
            writer.state(current)?;
            writer.string(recovery_id, None, 256)?;
            writer.u16(*native_domains);
            writer.u32(*chunk_count);
            writer.u64(*total_bytes)?;
            writer.hash(*compatibility_hash);
            writer.u8(u8::from(legacy_migration.is_some()));
            if let Some(value) = legacy_migration {
                writer.string(&value.migration_id, None, 180)?;
                writer.u64(value.created_at)?;
                writer.string(&value.source_key, None, 512)?;
                writer.string(&value.source_format, None, 128)?;
                writer.u64(value.source_byte_length)?;
                writer.hash(value.source_hash);
                writer.hash(value.projection_hash);
                writer.u64(value.projection_edit_count)?;
                writer.u64(value.projection_facing_count)?;
                writer.hash(value.native_world_semantic_hash);
                writer.u64(value.native_world_edit_count)?;
                writer.u64(value.native_world_facing_count)?;
                writer.string(&value.world_id, None, 180)?;
                writer.string(&value.universe_id, None, 64)?;
                writer.string(&value.location_id, None, 128)?;
                writer.string(&value.world_seed, None, 512)?;
                writer.hash(value.generator_hash);
                writer.hash(value.content_hash);
                writer.hash(value.terrain_content_hash);
                writer.hash(value.generation_options_hash);
                writer.u64(value.backup_byte_length)?;
                writer.hash(value.backup_hash);
                writer.u32(value.backup_chunks);
                writer.hash(value.native_record_set_hash);
                writer.hash(value.descriptor_hash);
                writer.hash(value.save_set_hash);
                writer.hash(value.manifest_hash);
            }
            (5, 0, Vec::new())
        }
        RuntimeBulkResponseV1::Data {
            current,
            transfer_token,
            type_id,
            chunk_index,
            chunk_count,
            payload,
            ..
        } => {
            writer.state(current)?;
            if *transfer_token == 0 {
                return Err(WireError::new("integer", "bulk data transfer token must be non-zero"));
            }
            writer.u64(*transfer_token)?;
            writer.string(type_id, Some(PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1), 160)?;
            if *chunk_count == 0 || *chunk_index >= *chunk_count || payload.len() > RUNTIME_BULK_SAVE_CHUNK_BYTES_V1 {
                return Err(WireError::new(
                    "hydration-data",
                    "bulk hydration chunk metadata is invalid",
                ));
            }
            writer.u32(*chunk_index);
            writer.u32(*chunk_count);
            (6, 0, payload.clone())
        }
        RuntimeBulkResponseV1::PersistenceStatus {
            current,
            type_id,
            payload,
            ..
        } => {
            writer.state(current)?;
            writer.string(type_id, Some(PERSISTENCE_STATUS_RECEIPT_TYPE_V1), 160)?;
            writer.bytes(payload, RUNTIME_BULK_PERSISTENCE_STATUS_BYTES_V1)?;
            (7, 0, Vec::new())
        }
        RuntimeBulkResponseV1::Error {
            code, message, current, ..
        } => {
            writer.u8(u8::from(current.is_some()));
            if let Some(current) = current {
                writer.state(current)?;
            }
            writer.string(code, None, 96)?;
            writer.string(message, None, 2_048)?;
            (255, 1, Vec::new())
        }
    };
    encode_control(
        RESPONSE_MAGIC,
        operation,
        status,
        value.request_id(),
        value.client_epoch(),
        value.worker_epoch(),
        writer.finish()?,
        attachment,
    )
}

pub fn decode_bulk_response_v1(control: &[u8], attachment: &[u8]) -> Result<RuntimeBulkResponseV1, WireError> {
    let envelope = decode_control(control, attachment, RESPONSE_MAGIC)?;
    if envelope.worker_epoch == 0 || envelope.request_id == 0 || envelope.client_epoch == 0 {
        return Err(WireError::new("response-header", "bulk response header is invalid"));
    }
    let mut reader = Reader::new(envelope.body);
    let value = match envelope.operation {
        1 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk empty response cannot carry an attachment",
                ));
            }
            RuntimeBulkResponseV1::Empty {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                worker_epoch: envelope.worker_epoch,
                current: reader.state()?,
            }
        }
        2 => RuntimeBulkResponseV1::PlatformRequest {
            request_id: envelope.request_id,
            client_epoch: envelope.client_epoch,
            worker_epoch: envelope.worker_epoch,
            current: reader.state()?,
            transfer_token: reader.u64()?,
            type_id: reader.string(Some(PERSISTENCE_REQUEST_TYPE_V1), 160)?,
            payload: envelope.attachment.to_vec(),
        },
        3 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk completed response cannot carry an attachment",
                ));
            }
            RuntimeBulkResponseV1::Completed {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                worker_epoch: envelope.worker_epoch,
                current: reader.state()?,
                transfer_token: reader.u64()?,
                result_hash: reader.hash()?,
            }
        }
        4 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk save progress cannot carry an attachment",
                ));
            }
            let current = reader.state()?;
            let stage_id = reader.string(None, 180)?;
            let state = match reader.u8()? {
                1 => RuntimeBulkSaveStageStateV1::Staged,
                2 => RuntimeBulkSaveStageStateV1::Finalized,
                3 => RuntimeBulkSaveStageStateV1::Cancelled,
                _ => return Err(WireError::new("save-stage", "unknown bulk save stage state")),
            };
            RuntimeBulkResponseV1::SaveProgress {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                worker_epoch: envelope.worker_epoch,
                current,
                stage_id,
                state,
                received_chunks: reader.u32()?,
                chunk_count: reader.u32()?,
                received_bytes: reader.u64()?,
                set_hash: reader.hash()?,
                manifest_hash: reader.hash()?,
                dispatcher_request_id: reader.u64()?,
                remaining_dirty_records: reader.u32()?,
            }
        }
        5 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk hydration receipt cannot carry an attachment",
                ));
            }
            let current = reader.state()?;
            let recovery_id = reader.string(None, 256)?;
            let native_domains = reader.u16()?;
            let chunk_count = reader.u32()?;
            let total_bytes = reader.u64()?;
            let compatibility_hash = reader.hash()?;
            let legacy_migration = match reader.u8()? {
                0 => None,
                1 => Some(RuntimeLegacyMigrationAttestationWireV1 {
                    migration_id: reader.string(None, 180)?,
                    created_at: reader.u64()?,
                    source_key: reader.string(None, 512)?,
                    source_format: reader.string(None, 128)?,
                    source_byte_length: reader.u64()?,
                    source_hash: reader.hash()?,
                    projection_hash: reader.hash()?,
                    projection_edit_count: reader.u64()?,
                    projection_facing_count: reader.u64()?,
                    native_world_semantic_hash: reader.hash()?,
                    native_world_edit_count: reader.u64()?,
                    native_world_facing_count: reader.u64()?,
                    world_id: reader.string(None, 180)?,
                    universe_id: reader.string(None, 64)?,
                    location_id: reader.string(None, 128)?,
                    world_seed: reader.string(None, 512)?,
                    generator_hash: reader.hash()?,
                    content_hash: reader.hash()?,
                    terrain_content_hash: reader.hash()?,
                    generation_options_hash: reader.hash()?,
                    backup_byte_length: reader.u64()?,
                    backup_hash: reader.hash()?,
                    backup_chunks: reader.u32()?,
                    native_record_set_hash: reader.hash()?,
                    descriptor_hash: reader.hash()?,
                    save_set_hash: reader.hash()?,
                    manifest_hash: reader.hash()?,
                }),
                _ => {
                    return Err(WireError::new(
                        "hydration-migration",
                        "bulk hydration migration flag is invalid",
                    ));
                }
            };
            RuntimeBulkResponseV1::Hydration {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                worker_epoch: envelope.worker_epoch,
                current,
                recovery_id,
                native_domains,
                chunk_count,
                total_bytes,
                compatibility_hash,
                legacy_migration,
            }
        }
        6 => {
            let current = reader.state()?;
            let transfer_token = reader.u64()?;
            let type_id = reader.string(Some(PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1), 160)?;
            let chunk_index = reader.u32()?;
            let chunk_count = reader.u32()?;
            if transfer_token == 0
                || chunk_count == 0
                || chunk_index >= chunk_count
                || attachment.len() > RUNTIME_BULK_SAVE_CHUNK_BYTES_V1
            {
                return Err(WireError::new(
                    "hydration-data",
                    "bulk hydration chunk metadata is invalid",
                ));
            }
            RuntimeBulkResponseV1::Data {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                worker_epoch: envelope.worker_epoch,
                current,
                transfer_token,
                type_id,
                chunk_index,
                chunk_count,
                payload: envelope.attachment.to_vec(),
            }
        }
        7 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk persistence status response cannot carry an attachment",
                ));
            }
            RuntimeBulkResponseV1::PersistenceStatus {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                worker_epoch: envelope.worker_epoch,
                current: reader.state()?,
                type_id: reader.string(Some(PERSISTENCE_STATUS_RECEIPT_TYPE_V1), 160)?,
                payload: reader.bytes(RUNTIME_BULK_PERSISTENCE_STATUS_BYTES_V1)?,
            }
        }
        255 => {
            if !attachment.is_empty() {
                return Err(WireError::new(
                    "attachment",
                    "bulk error response cannot carry an attachment",
                ));
            }
            let present = reader.u8()?;
            if present > 1 {
                return Err(WireError::new("optional-state", "bulk optional state flag is invalid"));
            }
            RuntimeBulkResponseV1::Error {
                request_id: envelope.request_id,
                client_epoch: envelope.client_epoch,
                worker_epoch: envelope.worker_epoch,
                current: if present == 1 { Some(reader.state()?) } else { None },
                code: reader.string(None, 96)?,
                message: reader.string(None, 2_048)?,
            }
        }
        _ => return Err(WireError::new("operation", "bulk response operation is unknown")),
    };
    if matches!(value, RuntimeBulkResponseV1::Error { .. }) != (envelope.status == 1) {
        return Err(WireError::new(
            "status",
            "bulk response status disagrees with its operation",
        ));
    }
    reader.finish()?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CROSS_LANGUAGE_FIXTURES: &str =
        include_str!("../../../../tests/fixtures/rust-engine/integrated-runtime-v1/wire-fixtures.json");

    fn fixture_string(name: &str, key: &str) -> String {
        let name_marker = format!("\"name\": \"{name}\"");
        let start = CROSS_LANGUAGE_FIXTURES
            .find(&name_marker)
            .unwrap_or_else(|| panic!("missing bulk fixture {name}"));
        let key_marker = format!("\"{key}\": \"");
        let value_start = CROSS_LANGUAGE_FIXTURES[start..]
            .find(&key_marker)
            .map(|offset| start + offset + key_marker.len())
            .unwrap_or_else(|| panic!("missing bulk fixture field {key}"));
        let value_end = CROSS_LANGUAGE_FIXTURES[value_start..]
            .find('"')
            .map(|offset| value_start + offset)
            .expect("unterminated bulk fixture field");
        CROSS_LANGUAGE_FIXTURES[value_start..value_end].to_owned()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn state() -> RuntimeBulkStateV1 {
        RuntimeBulkStateV1 {
            revision: RuntimeRevisionV1 {
                epoch: 1,
                world: 2,
                entities: 3,
                gameplay: 4,
                persistence: 5,
                network: 6,
                simulation: 7,
            },
            tick: 8,
            state_hash: WireHash([0x11; 16]),
        }
    }

    #[test]
    fn detached_request_and_response_round_trip_high_bytes() {
        let request = RuntimeBulkRequestV1::Complete {
            request_id: 7,
            client_epoch: 2,
            expected: state(),
            transfer_token: 91,
            type_id: PERSISTENCE_RESPONSE_TYPE_V1.into(),
            payload: vec![0, 0x7f, 0x80, 0xff],
        };
        let encoded = encode_bulk_request_v1(&request).expect("encode request");
        assert_eq!(
            hex(&encoded.control),
            fixture_string("complete-bwpa-high-binary", "controlHex")
        );
        assert_eq!(
            hex(&encoded.attachment),
            fixture_string("complete-bwpa-high-binary", "attachmentHex")
        );
        assert_eq!(
            decode_bulk_request_v1(&encoded.control, &encoded.attachment).expect("decode request"),
            request
        );

        let response = RuntimeBulkResponseV1::PlatformRequest {
            request_id: 8,
            client_epoch: 2,
            worker_epoch: 3,
            current: state(),
            transfer_token: 92,
            type_id: PERSISTENCE_REQUEST_TYPE_V1.into(),
            payload: vec![0x80, 0xff],
        };
        let encoded = encode_bulk_response_v1(&response).expect("encode response");
        assert_eq!(
            hex(&encoded.control),
            fixture_string("platform-bwpr-high-binary", "controlHex")
        );
        assert_eq!(
            hex(&encoded.attachment),
            fixture_string("platform-bwpr-high-binary", "attachmentHex")
        );
        assert_eq!(
            decode_bulk_response_v1(&encoded.control, &encoded.attachment).expect("decode response"),
            response
        );
    }

    #[test]
    fn attachment_tamper_fails_closed() {
        let request = RuntimeBulkRequestV1::Complete {
            request_id: 1,
            client_epoch: 2,
            expected: state(),
            transfer_token: 9,
            type_id: PERSISTENCE_RESPONSE_TYPE_V1.into(),
            payload: vec![0x80, 0xff],
        };
        let encoded = encode_bulk_request_v1(&request).expect("encode request");
        let mut damaged = encoded.attachment;
        damaged[0] ^= 0xff;
        assert_eq!(
            decode_bulk_request_v1(&encoded.control, &damaged)
                .expect_err("tamper must reject")
                .code,
            "checksum"
        );
    }

    #[test]
    fn persistence_status_is_an_inline_append_only_identity_neutral_bulk_operation() {
        let request = RuntimeBulkRequestV1::PersistenceStatus {
            request_id: 41,
            client_epoch: 2,
            expected: state(),
            type_id: PERSISTENCE_STATUS_TYPE_V1.into(),
            payload: b"BWS8\x01\0\x01\0".to_vec(),
        };
        let encoded = encode_bulk_request_v1(&request).unwrap();
        assert!(encoded.attachment.is_empty());
        assert_eq!(decode_bulk_request_v1(&encoded.control, &[]).unwrap(), request);

        let response = RuntimeBulkResponseV1::PersistenceStatus {
            request_id: 41,
            client_epoch: 2,
            worker_epoch: 3,
            current: state(),
            type_id: PERSISTENCE_STATUS_RECEIPT_TYPE_V1.into(),
            payload: b"BWT8\x01\0\x01\0".to_vec(),
        };
        let encoded = encode_bulk_response_v1(&response).unwrap();
        assert!(encoded.attachment.is_empty());
        assert_eq!(decode_bulk_response_v1(&encoded.control, &[]).unwrap(), response);
    }

    #[test]
    fn compatibility_stage_and_hydration_data_match_cross_language_vectors() {
        let request = RuntimeBulkRequestV1::StageSaveChunk {
            request_id: 9,
            client_epoch: 2,
            expected: state(),
            stage_id: "sävë-一-🌿".into(),
            chunk_index: 0,
            chunk_count: 1,
            total_bytes: 4,
            payload: vec![0, 0x80, 0xff, 0x7f],
        };
        let encoded = encode_bulk_request_v1(&request).expect("encode save stage");
        assert_eq!(
            hex(&encoded.control),
            fixture_string("stage-save-unicode-high-binary", "controlHex")
        );
        assert_eq!(
            hex(&encoded.attachment),
            fixture_string("stage-save-unicode-high-binary", "attachmentHex")
        );
        assert_eq!(
            decode_bulk_request_v1(&encoded.control, &encoded.attachment).expect("decode save stage"),
            request
        );

        let response = RuntimeBulkResponseV1::Data {
            request_id: 10,
            client_epoch: 2,
            worker_epoch: 3,
            current: state(),
            transfer_token: 93,
            type_id: PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1.into(),
            chunk_index: 0,
            chunk_count: 1,
            payload: vec![0x80, 0xff, 0xf0, 0x9f],
        };
        let encoded = encode_bulk_response_v1(&response).expect("encode hydration data");
        assert_eq!(
            hex(&encoded.control),
            fixture_string("hydrated-data-high-binary", "controlHex")
        );
        assert_eq!(
            hex(&encoded.attachment),
            fixture_string("hydrated-data-high-binary", "attachmentHex")
        );
        assert_eq!(
            decode_bulk_response_v1(&encoded.control, &encoded.attachment).expect("decode hydration data"),
            response
        );
    }

    #[test]
    fn compatibility_stage_rejects_tamper_and_invalid_unicode_boundary() {
        let request = RuntimeBulkRequestV1::StageSaveChunk {
            request_id: 9,
            client_epoch: 2,
            expected: state(),
            stage_id: "sävë-一-🌿".into(),
            chunk_index: 0,
            chunk_count: 1,
            total_bytes: 2,
            payload: vec![0x80, 0xff],
        };
        let encoded = encode_bulk_request_v1(&request).expect("encode save stage");
        let mut damaged = encoded.attachment;
        damaged[1] ^= 0x01;
        assert_eq!(
            decode_bulk_request_v1(&encoded.control, &damaged)
                .expect_err("damaged save chunk must reject")
                .code,
            "checksum"
        );

        let mut malformed_control = encode_bulk_request_v1(&request).expect("encode save stage").control;
        let stage_offset = RUNTIME_BULK_HEADER_BYTES_V1 + 80;
        malformed_control[stage_offset + 2] = 0xff;
        let checksum = wire_checksum_v1(&malformed_control[RUNTIME_BULK_HEADER_BYTES_V1..]);
        malformed_control[32..48].copy_from_slice(&checksum);
        assert_eq!(
            decode_bulk_request_v1(&malformed_control, &request_payload(&request))
                .expect_err("malformed UTF-8 stage id must reject")
                .code,
            "unicode"
        );
    }

    fn request_payload(request: &RuntimeBulkRequestV1) -> Vec<u8> {
        match request {
            RuntimeBulkRequestV1::StageSaveChunk { payload, .. } => payload.clone(),
            _ => Vec::new(),
        }
    }
}
