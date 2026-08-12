use std::collections::BTreeSet;

use crate::checksum::wire_checksum_v1;
use crate::model::{
    DEFAULT_GENERATION_OPTIONS_JSON_V1, DEFAULT_TERRAIN_CONTENT_HASH_V2, MAX_ACTION_RECEIPTS, MAX_DOMAIN_PAYLOAD_BYTES,
    MAX_EXTRACTION_BYTES, MAX_GENERATION_OPTIONS_JSON_BYTES, MAX_INPUT_FRAMES, MAX_OPERATIONS, MAX_SAFE_U64,
    MAX_VIEWPORT_DIMENSION_V1, MAX_WIRE_BYTES, RUNTIME_INPUT_FLAG_MASK_V1, RUNTIME_SCHEMA_V2, RUNTIME_SCHEMA_V3,
    RUNTIME_SCHEMA_V4, RUNTIME_SCHEMA_V5, RUNTIME_WIRE_V1, RuntimeCommandBatchV1, RuntimeCommandReceiptV1,
    RuntimeConfigV1, RuntimeDomainOperationV1, RuntimeDomainV1, RuntimeExtractionV1, RuntimeIdentityV1,
    RuntimeInputActionKindV1, RuntimeInputActionOutcomeV1, RuntimeInputActionReceiptV1, RuntimeInputFrameV1,
    RuntimeRequestV1, RuntimeResponseV1, RuntimeRevisionV1, WireError, WireHash,
};

const REQUEST_MAGIC: [u8; 4] = *b"BWRQ";
const RESPONSE_MAGIC: [u8; 4] = *b"BWRS";
const HEADER_BYTES: usize = 44;
const MAX_CAPABILITIES: usize = 64;
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn new() -> Self {
        Self { bytes: Vec::new() }
    }

    fn finish(self, maximum: usize) -> Result<Vec<u8>, WireError> {
        if self.bytes.len() > maximum {
            return Err(WireError::new(
                "wire-capacity",
                format!("encoded payload exceeds {maximum} bytes"),
            ));
        }
        Ok(self.bytes)
    }

    fn raw(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }

    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn u16(&mut self, value: u16) {
        self.raw(&value.to_le_bytes());
    }

    fn i16(&mut self, value: i16) {
        self.raw(&value.to_le_bytes());
    }

    fn u32(&mut self, value: u32) {
        self.raw(&value.to_le_bytes());
    }

    fn raw_u64(&mut self, value: u64) {
        self.raw(&value.to_le_bytes());
    }

    fn u64(&mut self, value: u64, name: &str) -> Result<(), WireError> {
        if value > MAX_SAFE_U64 {
            return Err(WireError::new(
                "unsafe-u64",
                format!("{name} exceeds JavaScript's safe integer range"),
            ));
        }
        self.raw_u64(value);
        Ok(())
    }

    fn string(&mut self, value: &str, name: &str, maximum: usize) -> Result<(), WireError> {
        let bytes = value.as_bytes();
        if bytes.is_empty() || bytes.len() > maximum || bytes.len() > usize::from(u16::MAX) {
            return Err(WireError::new(
                "invalid-label",
                format!("{name} must occupy 1..{maximum} UTF-8 bytes"),
            ));
        }
        self.u16(
            u16::try_from(bytes.len())
                .map_err(|_| WireError::new("string-capacity", "string exceeds u16 wire capacity"))?,
        );
        self.raw(bytes);
        Ok(())
    }

    fn variable_bytes(&mut self, value: &[u8], maximum: usize) -> Result<(), WireError> {
        if value.len() > maximum || value.len() > u32::MAX as usize {
            return Err(WireError::new(
                "invalid-bytes",
                format!("byte payload exceeds {maximum} bytes"),
            ));
        }
        self.u32(
            u32::try_from(value.len())
                .map_err(|_| WireError::new("bytes-capacity", "byte payload exceeds u32 wire capacity"))?,
        );
        self.raw(value);
        Ok(())
    }

    fn hash(&mut self, value: WireHash) {
        self.raw(&value.0);
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn finish(self) -> Result<(), WireError> {
        if self.offset != self.bytes.len() {
            return Err(WireError::new("trailing-bytes", "wire payload contains trailing bytes"));
        }
        Ok(())
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], WireError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| WireError::new("truncated", "wire read overflowed"))?;
        if length > MAX_WIRE_BYTES || end > self.bytes.len() {
            return Err(WireError::new("truncated", "wire payload is truncated"));
        }
        let result = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(result)
    }

    fn u8(&mut self) -> Result<u8, WireError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, WireError> {
        let bytes: [u8; 2] = self
            .take(2)?
            .try_into()
            .map_err(|_| WireError::new("truncated", "u16 is truncated"))?;
        Ok(u16::from_le_bytes(bytes))
    }

    fn i16(&mut self) -> Result<i16, WireError> {
        let bytes: [u8; 2] = self
            .take(2)?
            .try_into()
            .map_err(|_| WireError::new("truncated", "i16 is truncated"))?;
        Ok(i16::from_le_bytes(bytes))
    }

    fn u32(&mut self) -> Result<u32, WireError> {
        let bytes: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| WireError::new("truncated", "u32 is truncated"))?;
        Ok(u32::from_le_bytes(bytes))
    }

    fn raw_u64(&mut self) -> Result<u64, WireError> {
        let bytes: [u8; 8] = self
            .take(8)?
            .try_into()
            .map_err(|_| WireError::new("truncated", "u64 is truncated"))?;
        Ok(u64::from_le_bytes(bytes))
    }

    fn u64(&mut self) -> Result<u64, WireError> {
        let value = self.raw_u64()?;
        if value > MAX_SAFE_U64 {
            return Err(WireError::new(
                "unsafe-u64",
                "wire u64 exceeds JavaScript's safe integer range",
            ));
        }
        Ok(value)
    }

    fn string(&mut self, name: &str, maximum: usize) -> Result<String, WireError> {
        let length = usize::from(self.u16()?);
        if length > maximum {
            return Err(WireError::new(
                "string-capacity",
                format!("{name} exceeds {maximum} bytes"),
            ));
        }
        let value = std::str::from_utf8(self.take(length)?)
            .map_err(|_| WireError::new("invalid-unicode", format!("{name} is not valid UTF-8")))?;
        if value.is_empty() {
            return Err(WireError::new("invalid-label", format!("{name} cannot be empty")));
        }
        Ok(value.to_owned())
    }

    fn variable_bytes(&mut self, maximum: usize) -> Result<Vec<u8>, WireError> {
        let length = usize::try_from(self.u32()?)
            .map_err(|_| WireError::new("bytes-capacity", "byte length is not addressable"))?;
        if length > maximum {
            return Err(WireError::new(
                "bytes-capacity",
                format!("wire byte payload exceeds {maximum}"),
            ));
        }
        Ok(self.take(length)?.to_vec())
    }

    fn hash(&mut self) -> Result<WireHash, WireError> {
        let bytes: [u8; 16] = self
            .take(16)?
            .try_into()
            .map_err(|_| WireError::new("truncated", "hash is truncated"))?;
        Ok(WireHash(bytes))
    }
}

#[derive(Clone, Copy)]
struct EnvelopeHeader {
    schema: u16,
    operation: u8,
    status: u8,
    request_id: u32,
    client_epoch: u32,
    worker_epoch: u32,
}

fn encode_envelope(
    magic: [u8; 4],
    schema: u16,
    header: EnvelopeHeader,
    payload: Vec<u8>,
) -> Result<Vec<u8>, WireError> {
    if header.request_id == 0 || header.client_epoch == 0 {
        return Err(WireError::new(
            "request-header",
            "request id and client epoch must be non-zero",
        ));
    }
    if payload.len().saturating_add(HEADER_BYTES) > MAX_WIRE_BYTES {
        return Err(WireError::new(
            "wire-capacity",
            "integrated runtime envelope exceeds 8 MiB",
        ));
    }
    let payload_length =
        u32::try_from(payload.len()).map_err(|_| WireError::new("wire-capacity", "payload length exceeds u32"))?;
    let mut output = Vec::with_capacity(HEADER_BYTES + payload.len());
    output.extend_from_slice(&magic);
    output.extend_from_slice(&RUNTIME_WIRE_V1.to_le_bytes());
    if !matches!(
        schema,
        RUNTIME_SCHEMA_V2 | RUNTIME_SCHEMA_V3 | RUNTIME_SCHEMA_V4 | RUNTIME_SCHEMA_V5
    ) {
        return Err(WireError::new(
            "runtime-schema",
            "integrated runtime schema is unsupported",
        ));
    }
    output.extend_from_slice(&schema.to_le_bytes());
    output.push(header.operation);
    output.push(header.status);
    output.extend_from_slice(&0_u16.to_le_bytes());
    output.extend_from_slice(&header.request_id.to_le_bytes());
    output.extend_from_slice(&header.client_epoch.to_le_bytes());
    output.extend_from_slice(&header.worker_epoch.to_le_bytes());
    output.extend_from_slice(&payload_length.to_le_bytes());
    output.extend_from_slice(&wire_checksum_v1(&payload));
    output.extend_from_slice(&payload);
    Ok(output)
}

fn decode_envelope(value: &[u8], magic: [u8; 4]) -> Result<(EnvelopeHeader, &[u8]), WireError> {
    if value.len() < HEADER_BYTES || value.len() > MAX_WIRE_BYTES {
        return Err(WireError::new(
            "envelope-size",
            "integrated runtime envelope has an invalid size",
        ));
    }
    if value[..4] != magic {
        return Err(WireError::new("magic", "integrated runtime envelope has invalid magic"));
    }
    let mut reader = Reader::new(&value[4..HEADER_BYTES]);
    if reader.u16()? != RUNTIME_WIRE_V1 {
        return Err(WireError::new(
            "wire-version",
            "integrated runtime wire version is unsupported",
        ));
    }
    let schema = reader.u16()?;
    if !matches!(
        schema,
        RUNTIME_SCHEMA_V2 | RUNTIME_SCHEMA_V3 | RUNTIME_SCHEMA_V4 | RUNTIME_SCHEMA_V5
    ) {
        return Err(WireError::new(
            "runtime-schema",
            "integrated runtime schema is unsupported",
        ));
    }
    let operation = reader.u8()?;
    let status = reader.u8()?;
    if reader.u16()? != 0 {
        return Err(WireError::new(
            "reserved",
            "integrated runtime reserved header bits must be zero",
        ));
    }
    let request_id = reader.u32()?;
    let client_epoch = reader.u32()?;
    let worker_epoch = reader.u32()?;
    let payload_length =
        usize::try_from(reader.u32()?).map_err(|_| WireError::new("length", "payload length is not addressable"))?;
    let expected_checksum = reader.hash()?;
    reader.finish()?;
    if request_id == 0 || client_epoch == 0 {
        return Err(WireError::new(
            "request-header",
            "request id and client epoch must be non-zero",
        ));
    }
    if payload_length != value.len() - HEADER_BYTES {
        return Err(WireError::new(
            "length",
            "integrated runtime envelope length does not match its payload",
        ));
    }
    let payload = &value[HEADER_BYTES..];
    if WireHash(wire_checksum_v1(payload)) != expected_checksum {
        return Err(WireError::new(
            "checksum",
            "integrated runtime envelope checksum failed",
        ));
    }
    Ok((
        EnvelopeHeader {
            schema,
            operation,
            status,
            request_id,
            client_epoch,
            worker_epoch,
        },
        payload,
    ))
}

fn validate_operation_schema(operation: u8, schema: u16, response: bool) -> Result<(), WireError> {
    let valid = if response {
        match operation {
            3 => matches!(schema, RUNTIME_SCHEMA_V2 | RUNTIME_SCHEMA_V3),
            1 | 2 | 4 | 5 | 6 | 7 | 255 => schema == RUNTIME_SCHEMA_V2,
            _ => true,
        }
    } else {
        match operation {
            1 => matches!(schema, RUNTIME_SCHEMA_V2 | RUNTIME_SCHEMA_V4),
            4 => matches!(schema, RUNTIME_SCHEMA_V2 | RUNTIME_SCHEMA_V5),
            2 | 3 | 5..=8 => schema == RUNTIME_SCHEMA_V2,
            _ => true,
        }
    };
    if !valid {
        return Err(WireError::new(
            "runtime-schema",
            "integrated runtime schema is not valid for this operation",
        ));
    }
    Ok(())
}

fn write_identity(writer: &mut Writer, value: &RuntimeIdentityV1) -> Result<(), WireError> {
    writer.string(&value.universe_id, "identity.universeId", 64)?;
    writer.string(&value.location_id, "identity.locationId", 128)?;
    writer.u64(value.revision.epoch, "revision.epoch")?;
    writer.u64(value.revision.world, "revision.world")?;
    writer.u64(value.revision.entities, "revision.entities")?;
    writer.u64(value.revision.gameplay, "revision.gameplay")?;
    writer.u64(value.revision.persistence, "revision.persistence")?;
    writer.u64(value.revision.network, "revision.network")?;
    writer.u64(value.revision.simulation, "revision.simulation")?;
    writer.u64(value.tick, "identity.tick")?;
    writer.hash(value.state_hash);
    Ok(())
}

fn read_identity(reader: &mut Reader<'_>) -> Result<RuntimeIdentityV1, WireError> {
    Ok(RuntimeIdentityV1 {
        universe_id: reader.string("identity.universeId", 64)?,
        location_id: reader.string("identity.locationId", 128)?,
        revision: RuntimeRevisionV1 {
            epoch: reader.u64()?,
            world: reader.u64()?,
            entities: reader.u64()?,
            gameplay: reader.u64()?,
            persistence: reader.u64()?,
            network: reader.u64()?,
            simulation: reader.u64()?,
        },
        tick: reader.u64()?,
        state_hash: reader.hash()?,
    })
}

fn normalized_block_ids(values: &[u16]) -> Vec<u16> {
    values.iter().copied().collect::<BTreeSet<_>>().into_iter().collect()
}

fn write_config(writer: &mut Writer, value: &RuntimeConfigV1) -> Result<(), WireError> {
    writer.string(&value.world_seed, "config.worldSeed", 2_048)?;
    writer.string(&value.universe_id, "config.universeId", 64)?;
    writer.string(&value.location_id, "config.locationId", 128)?;
    writer.string(&value.session_id, "config.sessionId", 160)?;
    writer.hash(value.content_hash);
    writer.hash(value.generator_hash);
    writer.hash(value.terrain_content_hash);
    writer.string(
        &value.generation_options_json,
        "config.generationOptionsJson",
        MAX_GENERATION_OPTIONS_JSON_BYTES,
    )?;
    writer.u16(value.water_block_id);
    for values in [&value.directional_block_ids, &value.waterlogged_block_ids] {
        let normalized = normalized_block_ids(values);
        writer.u16(
            u16::try_from(normalized.len())
                .map_err(|_| WireError::new("block-id-capacity", "block id set exceeds u16"))?,
        );
        for block_id in normalized {
            writer.u16(block_id);
        }
    }
    Ok(())
}

fn read_block_ids(reader: &mut Reader<'_>) -> Result<Vec<u16>, WireError> {
    let count = usize::from(reader.u16()?);
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        let value = reader.u16()?;
        if values.last().is_some_and(|previous| *previous >= value) {
            return Err(WireError::new(
                "block-id-order",
                "block id sets must be strictly increasing",
            ));
        }
        values.push(value);
    }
    Ok(values)
}

fn read_config(reader: &mut Reader<'_>, schema: u16) -> Result<RuntimeConfigV1, WireError> {
    let world_seed = reader.string("config.worldSeed", 2_048)?;
    let universe_id = reader.string("config.universeId", 64)?;
    let location_id = reader.string("config.locationId", 128)?;
    let session_id = reader.string("config.sessionId", 160)?;
    let content_hash = reader.hash()?;
    let generator_hash = reader.hash()?;
    let (terrain_content_hash, generation_options_json) = if schema >= RUNTIME_SCHEMA_V4 {
        (
            reader.hash()?,
            reader.string("config.generationOptionsJson", MAX_GENERATION_OPTIONS_JSON_BYTES)?,
        )
    } else {
        (
            DEFAULT_TERRAIN_CONTENT_HASH_V2,
            DEFAULT_GENERATION_OPTIONS_JSON_V1.to_owned(),
        )
    };
    Ok(RuntimeConfigV1 {
        world_seed,
        universe_id,
        location_id,
        session_id,
        content_hash,
        generator_hash,
        terrain_content_hash,
        generation_options_json,
        water_block_id: reader.u16()?,
        directional_block_ids: read_block_ids(reader)?,
        waterlogged_block_ids: read_block_ids(reader)?,
    })
}

fn write_operation(writer: &mut Writer, value: &RuntimeDomainOperationV1) -> Result<(), WireError> {
    if value.schema == 0 {
        return Err(WireError::new("invalid-schema", "domain schema must be non-zero"));
    }
    if value.payload.len() > MAX_DOMAIN_PAYLOAD_BYTES {
        return Err(WireError::new(
            "domain-capacity",
            "domain operation exceeds its byte budget",
        ));
    }
    if WireHash(wire_checksum_v1(&value.payload)) != value.payload_hash {
        return Err(WireError::new(
            "payload-hash",
            "domain payload hash does not match its exact bytes",
        ));
    }
    writer.u8(value.domain as u8);
    writer.u16(value.schema);
    writer.string(&value.type_id, "operation.typeId", 160)?;
    writer.variable_bytes(&value.payload, MAX_DOMAIN_PAYLOAD_BYTES)?;
    writer.hash(value.payload_hash);
    Ok(())
}

fn read_operation(reader: &mut Reader<'_>) -> Result<RuntimeDomainOperationV1, WireError> {
    let domain = RuntimeDomainV1::from_code(reader.u8()?)?;
    let schema = reader.u16()?;
    if schema == 0 {
        return Err(WireError::new("invalid-schema", "domain schema must be non-zero"));
    }
    let type_id = reader.string("operation.typeId", 160)?;
    let payload = reader.variable_bytes(MAX_DOMAIN_PAYLOAD_BYTES)?;
    let payload_hash = reader.hash()?;
    if WireHash(wire_checksum_v1(&payload)) != payload_hash {
        return Err(WireError::new(
            "payload-hash",
            "domain payload hash does not match its exact bytes",
        ));
    }
    Ok(RuntimeDomainOperationV1 {
        domain,
        type_id,
        schema,
        payload,
        payload_hash,
    })
}

fn write_command_body(writer: &mut Writer, value: &RuntimeCommandBatchV1) -> Result<(), WireError> {
    writer.string(&value.command_id, "command.commandId", 160)?;
    writer.string(&value.idempotency_key, "command.idempotencyKey", 256)?;
    writer.string(&value.actor_id, "command.actorId", 160)?;
    write_identity(writer, &value.expected)?;
    if value.operations.is_empty() || value.operations.len() > MAX_OPERATIONS {
        return Err(WireError::new(
            "operation-count",
            format!("runtime command requires 1..{MAX_OPERATIONS} operations"),
        ));
    }
    writer.u16(
        u16::try_from(value.operations.len())
            .map_err(|_| WireError::new("operation-count", "operation count exceeds u16"))?,
    );
    for operation in &value.operations {
        write_operation(writer, operation)?;
    }
    Ok(())
}

fn command_body(value: &RuntimeCommandBatchV1) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::new();
    write_command_body(&mut writer, value)?;
    writer.finish(MAX_WIRE_BYTES)
}

/// Seals a newly constructed command with the checksum of its exact canonical
/// body. This is the native counterpart of
/// `createRustIntegratedRuntimeCommandBatchV1`; callers never hash a DTO or
/// JSON representation independently.
pub fn seal_runtime_command_batch_v1(mut value: RuntimeCommandBatchV1) -> Result<RuntimeCommandBatchV1, WireError> {
    value.command_hash = WireHash(wire_checksum_v1(&command_body(&value)?));
    Ok(value)
}

fn write_command(writer: &mut Writer, value: &RuntimeCommandBatchV1) -> Result<(), WireError> {
    let body = command_body(value)?;
    if WireHash(wire_checksum_v1(&body)) != value.command_hash {
        return Err(WireError::new(
            "command-hash",
            "runtime command hash does not match its exact bytes",
        ));
    }
    writer.raw(&body);
    writer.hash(value.command_hash);
    Ok(())
}

fn read_command(reader: &mut Reader<'_>) -> Result<RuntimeCommandBatchV1, WireError> {
    let command_id = reader.string("command.commandId", 160)?;
    let idempotency_key = reader.string("command.idempotencyKey", 256)?;
    let actor_id = reader.string("command.actorId", 160)?;
    let expected = read_identity(reader)?;
    let count = usize::from(reader.u16()?);
    if count == 0 || count > MAX_OPERATIONS {
        return Err(WireError::new(
            "operation-count",
            format!("runtime command requires 1..{MAX_OPERATIONS} operations"),
        ));
    }
    let mut operations = Vec::with_capacity(count);
    for _ in 0..count {
        operations.push(read_operation(reader)?);
    }
    let command_hash = reader.hash()?;
    let value = RuntimeCommandBatchV1 {
        command_id,
        idempotency_key,
        actor_id,
        expected,
        operations,
        command_hash,
    };
    if WireHash(wire_checksum_v1(&command_body(&value)?)) != command_hash {
        return Err(WireError::new(
            "command-hash",
            "decoded runtime command hash does not match its exact bytes",
        ));
    }
    Ok(value)
}

fn write_input(writer: &mut Writer, value: RuntimeInputFrameV1) -> Result<(), WireError> {
    writer.u64(value.sequence, "input.sequence")?;
    writer.u64(value.target_tick, "input.targetTick")?;
    writer.i16(value.move_x);
    writer.i16(value.move_z);
    writer.i16(value.look_yaw);
    writer.i16(value.look_pitch);
    writer.u32(value.buttons);
    writer.u8(value.selected_slot);
    writer.u8(value.flags);
    writer.u16(0);
    Ok(())
}

fn read_input(reader: &mut Reader<'_>) -> Result<RuntimeInputFrameV1, WireError> {
    let value = RuntimeInputFrameV1 {
        sequence: reader.u64()?,
        target_tick: reader.u64()?,
        move_x: reader.i16()?,
        move_z: reader.i16()?,
        look_yaw: reader.i16()?,
        look_pitch: reader.i16()?,
        buttons: reader.u32()?,
        selected_slot: reader.u8()?,
        flags: reader.u8()?,
    };
    if reader.u16()? != 0 {
        return Err(WireError::new("reserved", "input frame reserved bits must be zero"));
    }
    Ok(value)
}

fn write_action_receipt(writer: &mut Writer, value: RuntimeInputActionReceiptV1) -> Result<(), WireError> {
    if value.sequence == 0
        || value.input_sequence == 0
        || value.selected_slot > 8
        || value.authoritative_flags & !RUNTIME_INPUT_FLAG_MASK_V1 != 0
    {
        return Err(WireError::new(
            "input-action-receipt",
            "input action receipt has a reserved sequence or state flag",
        ));
    }
    writer.u64(value.sequence, "action.sequence")?;
    writer.u64(value.input_sequence, "action.inputSequence")?;
    writer.u64(value.tick, "action.tick")?;
    writer.u8(value.kind as u8);
    writer.u8(value.outcome as u8);
    writer.u8(value.selected_slot);
    writer.u8(value.authoritative_flags);
    // EntityId is a packed u32 index + u32 generation. Unlike clock and
    // revision counters, its complete bit pattern is an identity and must not
    // be constrained to JavaScript's Number-safe range.
    writer.raw_u64(value.target_entity_id);
    writer.hash(value.effect_hash);
    Ok(())
}

fn read_action_receipt(reader: &mut Reader<'_>) -> Result<RuntimeInputActionReceiptV1, WireError> {
    let value = RuntimeInputActionReceiptV1 {
        sequence: reader.u64()?,
        input_sequence: reader.u64()?,
        tick: reader.u64()?,
        kind: RuntimeInputActionKindV1::from_code(reader.u8()?)?,
        outcome: RuntimeInputActionOutcomeV1::from_code(reader.u8()?)?,
        selected_slot: reader.u8()?,
        authoritative_flags: reader.u8()?,
        target_entity_id: reader.raw_u64()?,
        effect_hash: reader.hash()?,
    };
    if value.sequence == 0
        || value.input_sequence == 0
        || value.selected_slot > 8
        || value.authoritative_flags & !RUNTIME_INPUT_FLAG_MASK_V1 != 0
    {
        return Err(WireError::new(
            "input-action-receipt",
            "input action receipt has a reserved sequence or state flag",
        ));
    }
    Ok(value)
}

fn write_receipt(writer: &mut Writer, value: &RuntimeCommandReceiptV1) -> Result<(), WireError> {
    match value {
        RuntimeCommandReceiptV1::Accepted {
            command_id,
            idempotency_key,
            command_hash,
            before,
            after,
            domain_receipts,
            receipt_hash,
        } => {
            if domain_receipts.len() > MAX_OPERATIONS {
                return Err(WireError::new(
                    "receipt-capacity",
                    "domain receipt count exceeds the operation budget",
                ));
            }
            writer.u8(0);
            writer.string(command_id, "receipt.commandId", 160)?;
            writer.string(idempotency_key, "receipt.idempotencyKey", 256)?;
            writer.hash(*command_hash);
            write_identity(writer, before)?;
            write_identity(writer, after)?;
            writer.u16(
                u16::try_from(domain_receipts.len())
                    .map_err(|_| WireError::new("receipt-capacity", "domain receipt count exceeds u16"))?,
            );
            for receipt in domain_receipts {
                write_operation(writer, receipt)?;
            }
            writer.hash(*receipt_hash);
        }
        RuntimeCommandReceiptV1::Rejected {
            command_id,
            idempotency_key,
            command_hash,
            code,
            message,
            current,
            receipt_hash,
        } => {
            writer.u8(1);
            writer.string(command_id, "receipt.commandId", 160)?;
            writer.string(idempotency_key, "receipt.idempotencyKey", 256)?;
            writer.hash(*command_hash);
            writer.string(code, "receipt.code", 96)?;
            writer.string(message, "receipt.message", 2_048)?;
            write_identity(writer, current)?;
            writer.hash(*receipt_hash);
        }
    }
    Ok(())
}

fn read_receipt(reader: &mut Reader<'_>) -> Result<RuntimeCommandReceiptV1, WireError> {
    let status = reader.u8()?;
    let command_id = reader.string("receipt.commandId", 160)?;
    let idempotency_key = reader.string("receipt.idempotencyKey", 256)?;
    let command_hash = reader.hash()?;
    if status == 0 {
        let before = read_identity(reader)?;
        let after = read_identity(reader)?;
        let count = usize::from(reader.u16()?);
        if count > MAX_OPERATIONS {
            return Err(WireError::new(
                "receipt-capacity",
                "domain receipt count exceeds the operation budget",
            ));
        }
        let mut domain_receipts = Vec::with_capacity(count);
        for _ in 0..count {
            domain_receipts.push(read_operation(reader)?);
        }
        return Ok(RuntimeCommandReceiptV1::Accepted {
            command_id,
            idempotency_key,
            command_hash,
            before,
            after,
            domain_receipts,
            receipt_hash: reader.hash()?,
        });
    }
    if status != 1 {
        return Err(WireError::new(
            "receipt-status",
            "runtime receipt has an unknown status",
        ));
    }
    Ok(RuntimeCommandReceiptV1::Rejected {
        command_id,
        idempotency_key,
        command_hash,
        code: reader.string("receipt.code", 96)?,
        message: reader.string("receipt.message", 2_048)?,
        current: read_identity(reader)?,
        receipt_hash: reader.hash()?,
    })
}

/// Encodes one exact command receipt without a request/response envelope.
///
/// This focused codec is used by checkpoint-owned reliability metadata. It
/// preserves the same bounded canonical receipt layout as BWRS while leaving
/// request and Worker-generation fields outside the durable value.
pub fn encode_command_receipt_v1(value: &RuntimeCommandReceiptV1) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::new();
    write_receipt(&mut writer, value)?;
    writer.finish(MAX_WIRE_BYTES)
}

/// Decodes one focused command receipt and rejects trailing bytes.
pub fn decode_command_receipt_v1(bytes: &[u8]) -> Result<RuntimeCommandReceiptV1, WireError> {
    if bytes.len() > MAX_WIRE_BYTES {
        return Err(WireError::new(
            "wire-capacity",
            "encoded command receipt exceeds the wire byte budget",
        ));
    }
    let mut reader = Reader::new(bytes);
    let value = read_receipt(&mut reader)?;
    reader.finish()?;
    Ok(value)
}

/// Recomputes the canonical reliability hash embedded by the integrated
/// runtime for either accepted or rejected command receipts.
#[must_use]
pub fn command_receipt_hash_v1(value: &RuntimeCommandReceiptV1) -> WireHash {
    let mut payload = Vec::new();
    match value {
        RuntimeCommandReceiptV1::Accepted {
            command_hash,
            before,
            after,
            domain_receipts,
            ..
        } => {
            payload.reserve(48 + domain_receipts.len() * 16);
            payload.extend_from_slice(&command_hash.0);
            payload.extend_from_slice(&before.state_hash.0);
            payload.extend_from_slice(&after.state_hash.0);
            for receipt in domain_receipts {
                payload.extend_from_slice(&receipt.payload_hash.0);
            }
        }
        RuntimeCommandReceiptV1::Rejected {
            command_hash,
            code,
            message,
            current,
            ..
        } => {
            payload.reserve(32 + code.len() + message.len());
            payload.extend_from_slice(&command_hash.0);
            payload.extend_from_slice(&current.state_hash.0);
            payload.extend_from_slice(code.as_bytes());
            payload.extend_from_slice(message.as_bytes());
        }
    }
    WireHash(wire_checksum_v1(&payload))
}

pub fn validate_command_receipt_hash_v1(value: &RuntimeCommandReceiptV1) -> Result<(), WireError> {
    let embedded = match value {
        RuntimeCommandReceiptV1::Accepted { receipt_hash, .. }
        | RuntimeCommandReceiptV1::Rejected { receipt_hash, .. } => *receipt_hash,
    };
    if embedded != command_receipt_hash_v1(value) {
        return Err(WireError::new(
            "receipt-hash",
            "runtime command receipt hash does not match its canonical authority fields",
        ));
    }
    Ok(())
}

fn extraction_total(value: &RuntimeExtractionV1) -> Result<usize, WireError> {
    [
        &value.render,
        &value.hud,
        &value.audio,
        &value.platform_requests,
        &value.diagnostics,
    ]
    .into_iter()
    .try_fold(0_usize, |total, bytes| {
        total
            .checked_add(bytes.len())
            .ok_or_else(|| WireError::new("extraction-capacity", "combined extraction size overflowed"))
    })
}

fn write_extraction(writer: &mut Writer, value: &RuntimeExtractionV1) -> Result<(), WireError> {
    if extraction_total(value)? > MAX_EXTRACTION_BYTES {
        return Err(WireError::new(
            "extraction-capacity",
            "combined extraction exceeds its byte budget",
        ));
    }
    write_identity(writer, &value.identity)?;
    writer.u64(value.extraction_revision, "extraction.revision")?;
    for bytes in [
        &value.render,
        &value.hud,
        &value.audio,
        &value.platform_requests,
        &value.diagnostics,
    ] {
        writer.variable_bytes(bytes, MAX_EXTRACTION_BYTES)?;
    }
    let expected_hash = extraction_checksum_v1(value)?;
    if value.extraction_hash != expected_hash {
        return Err(WireError::new(
            "extraction-hash",
            "extraction hash does not match its exact channel bytes",
        ));
    }
    writer.hash(expected_hash);
    Ok(())
}

fn read_extraction(reader: &mut Reader<'_>) -> Result<RuntimeExtractionV1, WireError> {
    let value = RuntimeExtractionV1 {
        identity: read_identity(reader)?,
        extraction_revision: reader.u64()?,
        render: reader.variable_bytes(MAX_EXTRACTION_BYTES)?,
        hud: reader.variable_bytes(MAX_EXTRACTION_BYTES)?,
        audio: reader.variable_bytes(MAX_EXTRACTION_BYTES)?,
        platform_requests: reader.variable_bytes(MAX_EXTRACTION_BYTES)?,
        diagnostics: reader.variable_bytes(MAX_EXTRACTION_BYTES)?,
        extraction_hash: reader.hash()?,
    };
    if extraction_total(&value)? > MAX_EXTRACTION_BYTES {
        return Err(WireError::new(
            "extraction-capacity",
            "combined extraction exceeds its byte budget",
        ));
    }
    if value.extraction_hash != extraction_checksum_v1(&value)? {
        return Err(WireError::new(
            "extraction-hash",
            "decoded extraction hash does not match its exact channel bytes",
        ));
    }
    Ok(value)
}

/// Checksums the exact five length-prefixed extraction channels. Identity and
/// revision are already bound by the enclosing response and state hash.
pub fn extraction_checksum_v1(value: &RuntimeExtractionV1) -> Result<WireHash, WireError> {
    if extraction_total(value)? > MAX_EXTRACTION_BYTES {
        return Err(WireError::new(
            "extraction-capacity",
            "combined extraction exceeds its byte budget",
        ));
    }
    let mut writer = Writer::new();
    for bytes in [
        &value.render,
        &value.hud,
        &value.audio,
        &value.platform_requests,
        &value.diagnostics,
    ] {
        writer.variable_bytes(bytes, MAX_EXTRACTION_BYTES)?;
    }
    Ok(WireHash(wire_checksum_v1(
        &writer.finish(MAX_EXTRACTION_BYTES + 5 * size_of::<u32>())?,
    )))
}

fn write_capabilities(writer: &mut Writer, capabilities: &[String], label: &str) -> Result<(), WireError> {
    let normalized: BTreeSet<&str> = capabilities.iter().map(String::as_str).collect();
    if normalized.len() > MAX_CAPABILITIES {
        return Err(WireError::new(
            "capability-count",
            "runtime capability count exceeds 64",
        ));
    }
    writer.u16(
        u16::try_from(normalized.len())
            .map_err(|_| WireError::new("capability-count", "capability count exceeds u16"))?,
    );
    for capability in normalized {
        writer.string(capability, label, 96)?;
    }
    Ok(())
}

fn read_capabilities(reader: &mut Reader<'_>, label: &str) -> Result<Vec<String>, WireError> {
    let count = usize::from(reader.u16()?);
    if count > MAX_CAPABILITIES {
        return Err(WireError::new(
            "capability-count",
            "runtime capability count exceeds 64",
        ));
    }
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        let value = reader.string(label, 96)?;
        if values.last().is_some_and(|previous| previous >= &value) {
            return Err(WireError::new(
                "capability-order",
                "runtime capabilities must be unique and sorted",
            ));
        }
        values.push(value);
    }
    Ok(values)
}

/// Encodes one complete coarse request; no domain object crosses the worker
/// boundary outside a checksummed, versioned operation payload.
pub fn encode_request_v1(request: &RuntimeRequestV1) -> Result<Vec<u8>, WireError> {
    let mut writer = Writer::new();
    let operation = match request {
        RuntimeRequestV1::Create { config, .. } => {
            write_config(&mut writer, config)?;
            1
        }
        RuntimeRequestV1::Command { batch, .. } => {
            write_command(&mut writer, batch)?;
            2
        }
        RuntimeRequestV1::RecoverCommand { batch, .. } => {
            write_command(&mut writer, batch)?;
            8
        }
        RuntimeRequestV1::Step {
            expected,
            monotonic_time_us,
            budget_us,
            inputs,
            ..
        } => {
            if *budget_us == 0 || *budget_us > 1_000_000 {
                return Err(WireError::new("invalid-integer", "step budget must be in 1..1000000"));
            }
            if inputs.len() > MAX_INPUT_FRAMES {
                return Err(WireError::new("input-capacity", "step input batch exceeds 128 frames"));
            }
            write_identity(&mut writer, expected)?;
            writer.u64(*monotonic_time_us, "step.monotonicTimeUs")?;
            writer.u32(*budget_us);
            writer.u16(
                u16::try_from(inputs.len())
                    .map_err(|_| WireError::new("input-capacity", "input frame count exceeds u16"))?,
            );
            for input in inputs {
                write_input(&mut writer, *input)?;
            }
            3
        }
        RuntimeRequestV1::Extract {
            expected,
            after_revision,
            max_bytes,
            ..
        } => {
            if *max_bytes == 0 || usize::try_from(*max_bytes).unwrap_or(usize::MAX) > MAX_EXTRACTION_BYTES {
                return Err(WireError::new(
                    "invalid-integer",
                    "extraction byte budget is out of range",
                ));
            }
            write_identity(&mut writer, expected)?;
            writer.u64(*after_revision, "extract.afterRevision")?;
            writer.u32(*max_bytes);
            4
        }
        RuntimeRequestV1::ExtractView {
            expected,
            after_revision,
            max_bytes,
            viewport_width,
            viewport_height,
            view_revision,
            ..
        } => {
            if *max_bytes == 0 || usize::try_from(*max_bytes).unwrap_or(usize::MAX) > MAX_EXTRACTION_BYTES {
                return Err(WireError::new(
                    "invalid-integer",
                    "extraction byte budget is out of range",
                ));
            }
            if *viewport_width == 0
                || *viewport_width > MAX_VIEWPORT_DIMENSION_V1
                || *viewport_height == 0
                || *viewport_height > MAX_VIEWPORT_DIMENSION_V1
            {
                return Err(WireError::new(
                    "invalid-viewport",
                    "extraction viewport dimensions are outside 1..16384",
                ));
            }
            write_identity(&mut writer, expected)?;
            writer.u64(*after_revision, "extract.afterRevision")?;
            writer.u32(*max_bytes);
            writer.u32(*viewport_width);
            writer.u32(*viewport_height);
            writer.u64(*view_revision, "extract.viewRevision")?;
            4
        }
        RuntimeRequestV1::Restore {
            expected_checkpoint_hash,
            checkpoint,
            ..
        } => {
            writer.hash(*expected_checkpoint_hash);
            writer.variable_bytes(checkpoint, MAX_WIRE_BYTES - HEADER_BYTES - 32)?;
            5
        }
        RuntimeRequestV1::Shutdown { expected, .. } => {
            writer.u8(u8::from(expected.is_some()));
            if let Some(identity) = expected {
                write_identity(&mut writer, identity)?;
            }
            6
        }
        RuntimeRequestV1::Checkpoint { expected, .. } => {
            write_identity(&mut writer, expected)?;
            7
        }
    };
    let schema = match request {
        RuntimeRequestV1::Create { .. } => RUNTIME_SCHEMA_V4,
        RuntimeRequestV1::ExtractView { .. } => RUNTIME_SCHEMA_V5,
        _ => RUNTIME_SCHEMA_V2,
    };
    encode_envelope(
        REQUEST_MAGIC,
        schema,
        EnvelopeHeader {
            schema,
            operation,
            status: 0,
            request_id: request.request_id(),
            client_epoch: request.client_epoch(),
            worker_epoch: 0,
        },
        writer.finish(MAX_WIRE_BYTES)?,
    )
}

/// Decodes and validates one complete BWRQ request.
pub fn decode_request_v1(value: &[u8]) -> Result<RuntimeRequestV1, WireError> {
    let (header, payload) = decode_envelope(value, REQUEST_MAGIC)?;
    if header.status != 0 || header.worker_epoch != 0 {
        return Err(WireError::new(
            "request-header",
            "runtime requests must have zero status and worker epoch",
        ));
    }
    validate_operation_schema(header.operation, header.schema, false)?;
    let mut reader = Reader::new(payload);
    let request = match header.operation {
        1 => RuntimeRequestV1::Create {
            request_id: header.request_id,
            client_epoch: header.client_epoch,
            config: read_config(&mut reader, header.schema)?,
        },
        2 => RuntimeRequestV1::Command {
            request_id: header.request_id,
            client_epoch: header.client_epoch,
            batch: read_command(&mut reader)?,
        },
        8 => RuntimeRequestV1::RecoverCommand {
            request_id: header.request_id,
            client_epoch: header.client_epoch,
            batch: read_command(&mut reader)?,
        },
        3 => {
            let expected = read_identity(&mut reader)?;
            let monotonic_time_us = reader.u64()?;
            let budget_us = reader.u32()?;
            if budget_us == 0 || budget_us > 1_000_000 {
                return Err(WireError::new("invalid-integer", "step budget must be in 1..1000000"));
            }
            let count = usize::from(reader.u16()?);
            if count > MAX_INPUT_FRAMES {
                return Err(WireError::new("input-capacity", "step input batch exceeds 128 frames"));
            }
            let mut inputs = Vec::with_capacity(count);
            for _ in 0..count {
                inputs.push(read_input(&mut reader)?);
            }
            RuntimeRequestV1::Step {
                request_id: header.request_id,
                client_epoch: header.client_epoch,
                expected,
                monotonic_time_us,
                budget_us,
                inputs,
            }
        }
        4 => {
            let expected = read_identity(&mut reader)?;
            let after_revision = reader.u64()?;
            let max_bytes = reader.u32()?;
            if max_bytes == 0 || usize::try_from(max_bytes).unwrap_or(usize::MAX) > MAX_EXTRACTION_BYTES {
                return Err(WireError::new(
                    "invalid-integer",
                    "extraction byte budget is out of range",
                ));
            }
            if header.schema == RUNTIME_SCHEMA_V5 {
                let viewport_width = reader.u32()?;
                let viewport_height = reader.u32()?;
                if viewport_width == 0
                    || viewport_width > MAX_VIEWPORT_DIMENSION_V1
                    || viewport_height == 0
                    || viewport_height > MAX_VIEWPORT_DIMENSION_V1
                {
                    return Err(WireError::new(
                        "invalid-viewport",
                        "extraction viewport dimensions are outside 1..16384",
                    ));
                }
                RuntimeRequestV1::ExtractView {
                    request_id: header.request_id,
                    client_epoch: header.client_epoch,
                    expected,
                    after_revision,
                    max_bytes,
                    viewport_width,
                    viewport_height,
                    view_revision: reader.u64()?,
                }
            } else {
                RuntimeRequestV1::Extract {
                    request_id: header.request_id,
                    client_epoch: header.client_epoch,
                    expected,
                    after_revision,
                    max_bytes,
                }
            }
        }
        5 => RuntimeRequestV1::Restore {
            request_id: header.request_id,
            client_epoch: header.client_epoch,
            expected_checkpoint_hash: reader.hash()?,
            checkpoint: reader.variable_bytes(MAX_WIRE_BYTES - HEADER_BYTES - 32)?,
        },
        6 => {
            let present = reader.u8()?;
            if present > 1 {
                return Err(WireError::new("optional-identity", "shutdown identity flag is invalid"));
            }
            RuntimeRequestV1::Shutdown {
                request_id: header.request_id,
                client_epoch: header.client_epoch,
                expected: if present == 1 {
                    Some(read_identity(&mut reader)?)
                } else {
                    None
                },
            }
        }
        7 => RuntimeRequestV1::Checkpoint {
            request_id: header.request_id,
            client_epoch: header.client_epoch,
            expected: read_identity(&mut reader)?,
        },
        _ => return Err(WireError::new("operation", "runtime request operation is unknown")),
    };
    reader.finish()?;
    Ok(request)
}

/// Encodes one awaited response. A worker epoch is required on every result,
/// including errors, so stale generations cannot be accepted accidentally.
pub fn encode_response_v1(response: &RuntimeResponseV1) -> Result<Vec<u8>, WireError> {
    if response.worker_epoch() == 0 {
        return Err(WireError::new(
            "worker-epoch",
            "runtime response is missing a worker epoch",
        ));
    }
    let mut writer = Writer::new();
    let (operation, status) = match response {
        RuntimeResponseV1::Ready {
            runtime_handle,
            identity,
            artifact_hash,
            instance_id,
            capabilities,
            ..
        } => {
            if *runtime_handle == 0 {
                return Err(WireError::new("runtime-handle", "runtime handle must be live"));
            }
            writer.u32(*runtime_handle);
            write_identity(&mut writer, identity)?;
            writer.string(artifact_hash, "ready.artifactHash", 128)?;
            writer.string(instance_id, "ready.instanceId", 160)?;
            write_capabilities(&mut writer, capabilities, "ready.capability")?;
            (1, 0)
        }
        RuntimeResponseV1::CommandReceipt { receipt, .. } => {
            write_receipt(&mut writer, receipt)?;
            (2, 0)
        }
        RuntimeResponseV1::StepResult {
            identity,
            fixed_steps,
            inputs_applied,
            commands_processed,
            commands_accepted,
            action_receipts,
            replay_hash,
            ..
        } => {
            write_identity(&mut writer, identity)?;
            writer.u16(*fixed_steps);
            writer.u16(*inputs_applied);
            writer.u16(*commands_processed);
            writer.u16(*commands_accepted);
            if action_receipts.len() > MAX_ACTION_RECEIPTS {
                return Err(WireError::new(
                    "input-action-capacity",
                    "step action receipts exceed their bound",
                ));
            }
            writer.u16(
                u16::try_from(action_receipts.len())
                    .map_err(|_| WireError::new("input-action-capacity", "step action receipt count exceeds u16"))?,
            );
            for receipt in action_receipts {
                write_action_receipt(&mut writer, *receipt)?;
            }
            writer.hash(*replay_hash);
            (3, 0)
        }
        RuntimeResponseV1::Extraction { extraction, .. } => {
            write_extraction(&mut writer, extraction)?;
            (4, 0)
        }
        RuntimeResponseV1::Restored {
            runtime_handle,
            identity,
            checkpoint_hash,
            artifact_hash,
            instance_id,
            capabilities,
            ..
        } => {
            if *runtime_handle == 0 {
                return Err(WireError::new("runtime-handle", "runtime handle must be live"));
            }
            writer.u32(*runtime_handle);
            write_identity(&mut writer, identity)?;
            writer.hash(*checkpoint_hash);
            writer.string(artifact_hash, "restore.artifactHash", 128)?;
            writer.string(instance_id, "restore.instanceId", 160)?;
            write_capabilities(&mut writer, capabilities, "restore.capability")?;
            (5, 0)
        }
        RuntimeResponseV1::Shutdown { .. } => (6, 0),
        RuntimeResponseV1::Checkpoint {
            identity,
            checkpoint,
            checkpoint_hash,
            ..
        } => {
            write_identity(&mut writer, identity)?;
            writer.variable_bytes(checkpoint, MAX_WIRE_BYTES - HEADER_BYTES - 32)?;
            writer.hash(*checkpoint_hash);
            (7, 0)
        }
        RuntimeResponseV1::Error {
            code, message, current, ..
        } => {
            writer.string(code, "error.code", 96)?;
            writer.string(message, "error.message", 2_048)?;
            writer.u8(u8::from(current.is_some()));
            if let Some(identity) = current {
                write_identity(&mut writer, identity)?;
            }
            (255, 1)
        }
    };
    let schema = if operation == 3 {
        RUNTIME_SCHEMA_V3
    } else {
        RUNTIME_SCHEMA_V2
    };
    encode_envelope(
        RESPONSE_MAGIC,
        schema,
        EnvelopeHeader {
            schema,
            operation,
            status,
            request_id: response.request_id(),
            client_epoch: response.client_epoch(),
            worker_epoch: response.worker_epoch(),
        },
        writer.finish(MAX_WIRE_BYTES)?,
    )
}

/// Decodes and validates one complete BWRS response.
pub fn decode_response_v1(value: &[u8]) -> Result<RuntimeResponseV1, WireError> {
    let (header, payload) = decode_envelope(value, RESPONSE_MAGIC)?;
    if header.worker_epoch == 0 {
        return Err(WireError::new(
            "worker-epoch",
            "runtime response is missing a worker epoch",
        ));
    }
    validate_operation_schema(header.operation, header.schema, true)?;
    let mut reader = Reader::new(payload);
    let response = match header.operation {
        1 => {
            let runtime_handle = reader.u32()?;
            if runtime_handle == 0 {
                return Err(WireError::new("runtime-handle", "runtime handle must be live"));
            }
            RuntimeResponseV1::Ready {
                request_id: header.request_id,
                client_epoch: header.client_epoch,
                worker_epoch: header.worker_epoch,
                runtime_handle,
                identity: read_identity(&mut reader)?,
                artifact_hash: reader.string("ready.artifactHash", 128)?,
                instance_id: reader.string("ready.instanceId", 160)?,
                capabilities: read_capabilities(&mut reader, "ready.capability")?,
            }
        }
        2 => RuntimeResponseV1::CommandReceipt {
            request_id: header.request_id,
            client_epoch: header.client_epoch,
            worker_epoch: header.worker_epoch,
            receipt: read_receipt(&mut reader)?,
        },
        3 => RuntimeResponseV1::StepResult {
            request_id: header.request_id,
            client_epoch: header.client_epoch,
            worker_epoch: header.worker_epoch,
            identity: read_identity(&mut reader)?,
            fixed_steps: reader.u16()?,
            inputs_applied: reader.u16()?,
            commands_processed: reader.u16()?,
            commands_accepted: reader.u16()?,
            action_receipts: if header.schema >= RUNTIME_SCHEMA_V3 {
                let count = usize::from(reader.u16()?);
                if count > MAX_ACTION_RECEIPTS {
                    return Err(WireError::new(
                        "input-action-capacity",
                        "step action receipts exceed their bound",
                    ));
                }
                let mut receipts = Vec::with_capacity(count);
                let mut previous = 0_u64;
                for _ in 0..count {
                    let receipt = read_action_receipt(&mut reader)?;
                    if receipt.sequence <= previous {
                        return Err(WireError::new(
                            "input-action-order",
                            "step action receipt sequences must be strictly increasing",
                        ));
                    }
                    previous = receipt.sequence;
                    receipts.push(receipt);
                }
                receipts
            } else {
                Vec::new()
            },
            replay_hash: reader.hash()?,
        },
        4 => RuntimeResponseV1::Extraction {
            request_id: header.request_id,
            client_epoch: header.client_epoch,
            worker_epoch: header.worker_epoch,
            extraction: read_extraction(&mut reader)?,
        },
        5 => {
            let runtime_handle = reader.u32()?;
            if runtime_handle == 0 {
                return Err(WireError::new("runtime-handle", "runtime handle must be live"));
            }
            RuntimeResponseV1::Restored {
                request_id: header.request_id,
                client_epoch: header.client_epoch,
                worker_epoch: header.worker_epoch,
                runtime_handle,
                identity: read_identity(&mut reader)?,
                checkpoint_hash: reader.hash()?,
                artifact_hash: reader.string("restore.artifactHash", 128)?,
                instance_id: reader.string("restore.instanceId", 160)?,
                capabilities: read_capabilities(&mut reader, "restore.capability")?,
            }
        }
        6 => RuntimeResponseV1::Shutdown {
            request_id: header.request_id,
            client_epoch: header.client_epoch,
            worker_epoch: header.worker_epoch,
        },
        7 => RuntimeResponseV1::Checkpoint {
            request_id: header.request_id,
            client_epoch: header.client_epoch,
            worker_epoch: header.worker_epoch,
            identity: read_identity(&mut reader)?,
            checkpoint: reader.variable_bytes(MAX_WIRE_BYTES - HEADER_BYTES - 32)?,
            checkpoint_hash: reader.hash()?,
        },
        255 => {
            let code = reader.string("error.code", 96)?;
            let message = reader.string("error.message", 2_048)?;
            let present = reader.u8()?;
            if present > 1 {
                return Err(WireError::new("optional-identity", "error identity flag is invalid"));
            }
            RuntimeResponseV1::Error {
                request_id: header.request_id,
                client_epoch: header.client_epoch,
                worker_epoch: header.worker_epoch,
                code,
                message,
                current: if present == 1 {
                    Some(read_identity(&mut reader)?)
                } else {
                    None
                },
            }
        }
        _ => return Err(WireError::new("operation", "runtime response operation is unknown")),
    };
    let is_error = matches!(response, RuntimeResponseV1::Error { .. });
    if is_error != (header.status == 1) {
        return Err(WireError::new(
            "response-status",
            "runtime response status disagrees with its operation",
        ));
    }
    reader.finish()?;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CROSS_LANGUAGE_FIXTURES: &str =
        include_str!("../../../../tests/fixtures/rust-engine/integrated-runtime-v1/wire-fixtures.json");

    fn hash(byte: u8) -> WireHash {
        WireHash([byte; 16])
    }

    fn identity() -> RuntimeIdentityV1 {
        RuntimeIdentityV1 {
            universe_id: "univérse-🌿".into(),
            location_id: "surface".into(),
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
            state_hash: hash(0xaa),
        }
    }

    fn fixture_string(name: &str, key: &str) -> String {
        let name_marker = format!("\"name\": \"{name}\"");
        let start = CROSS_LANGUAGE_FIXTURES
            .find(&name_marker)
            .unwrap_or_else(|| panic!("missing fixture {name}"));
        fixture_string_after(start, key)
    }

    fn fixture_global_string(key: &str) -> String {
        fixture_string_after(0, key)
    }

    fn fixture_string_after(start: usize, key: &str) -> String {
        let key_marker = format!("\"{key}\": \"");
        let value_start = CROSS_LANGUAGE_FIXTURES[start..]
            .find(&key_marker)
            .map(|offset| start + offset + key_marker.len())
            .unwrap_or_else(|| panic!("missing fixture value {key}"));
        let value_end = CROSS_LANGUAGE_FIXTURES[value_start..]
            .find('"')
            .map(|offset| value_start + offset)
            .unwrap_or_else(|| panic!("unterminated fixture value {key}"));
        CROSS_LANGUAGE_FIXTURES[value_start..value_end].to_owned()
    }

    fn from_hex(value: &str) -> Vec<u8> {
        assert_eq!(value.len() % 2, 0, "fixture hex must be byte aligned");
        (0..value.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&value[index..index + 2], 16).expect("fixture hex"))
            .collect()
    }

    #[test]
    fn request_round_trip_covers_non_ascii_and_binary() {
        let payload = vec![0, 0x7f, 0x80, 0xff, 0xf0, 0x9f, 0x8c, 0xbf];
        let operation = RuntimeDomainOperationV1 {
            domain: RuntimeDomainV1::World,
            type_id: "world.mutación.🌿".into(),
            schema: 1,
            payload_hash: WireHash(wire_checksum_v1(&payload)),
            payload,
        };
        let mut batch = RuntimeCommandBatchV1 {
            command_id: "commande-é".into(),
            idempotency_key: "clé-🌿".into(),
            actor_id: "acteur".into(),
            expected: identity(),
            operations: vec![operation],
            command_hash: WireHash::default(),
        };
        batch.command_hash = WireHash(wire_checksum_v1(&command_body(&batch).expect("command body")));
        let request = RuntimeRequestV1::Command {
            request_id: 9,
            client_epoch: 2,
            batch,
        };
        let bytes = encode_request_v1(&request).expect("encode request");
        assert_eq!(decode_request_v1(&bytes).expect("decode request"), request);
        let RuntimeRequestV1::Command { batch, .. } = request else {
            unreachable!()
        };
        let recovery = RuntimeRequestV1::RecoverCommand {
            request_id: 10,
            client_epoch: 3,
            batch,
        };
        let recovery_bytes = encode_request_v1(&recovery).expect("encode recovery request");
        assert_eq!(recovery_bytes[8], 8);
        assert_eq!(decode_request_v1(&recovery_bytes).unwrap(), recovery);
    }

    #[test]
    fn focused_command_receipt_codec_validates_canonical_hash_and_trailing_bytes() {
        let mut receipt = RuntimeCommandReceiptV1::Rejected {
            command_id: "command:one".into(),
            idempotency_key: "key:one".into(),
            command_hash: hash(0x11),
            code: "blocked".into(),
            message: "fixture rejection".into(),
            current: identity(),
            receipt_hash: WireHash::default(),
        };
        let hash = command_receipt_hash_v1(&receipt);
        let RuntimeCommandReceiptV1::Rejected { receipt_hash, .. } = &mut receipt else {
            unreachable!()
        };
        *receipt_hash = hash;
        validate_command_receipt_hash_v1(&receipt).unwrap();
        let encoded = encode_command_receipt_v1(&receipt).unwrap();
        assert_eq!(decode_command_receipt_v1(&encoded).unwrap(), receipt);
        let mut trailing = encoded;
        trailing.push(0xaa);
        assert_eq!(decode_command_receipt_v1(&trailing).unwrap_err().code, "trailing-bytes");
        let RuntimeCommandReceiptV1::Rejected { receipt_hash, .. } = &mut receipt else {
            unreachable!()
        };
        receipt_hash.0[0] ^= 0xff;
        assert_eq!(
            validate_command_receipt_hash_v1(&receipt).unwrap_err().code,
            "receipt-hash"
        );
    }

    #[test]
    fn invalid_utf8_fails_closed_even_with_valid_checksum() {
        let request = RuntimeRequestV1::Create {
            request_id: 1,
            client_epoch: 1,
            config: RuntimeConfigV1 {
                world_seed: "seed".into(),
                universe_id: "u".into(),
                location_id: "l".into(),
                session_id: "s".into(),
                content_hash: hash(0),
                generator_hash: hash(1),
                terrain_content_hash: DEFAULT_TERRAIN_CONTENT_HASH_V2,
                generation_options_json: DEFAULT_GENERATION_OPTIONS_JSON_V1.into(),
                water_block_id: 2,
                directional_block_ids: vec![],
                waterlogged_block_ids: vec![],
            },
        };
        let mut bytes = encode_request_v1(&request).expect("encode request");
        bytes[HEADER_BYTES + 2] = 0xff;
        let checksum = wire_checksum_v1(&bytes[HEADER_BYTES..]);
        bytes[28..HEADER_BYTES].copy_from_slice(&checksum);
        assert_eq!(
            decode_request_v1(&bytes).expect_err("invalid UTF-8 must reject").code,
            "invalid-unicode"
        );
    }

    #[test]
    fn schemas_are_valid_only_for_their_versioned_operations() {
        let payload = vec![0x80, 0xff];
        let operation = RuntimeDomainOperationV1 {
            domain: RuntimeDomainV1::World,
            type_id: "world.test".into(),
            schema: 1,
            payload_hash: WireHash(wire_checksum_v1(&payload)),
            payload,
        };
        let mut batch = RuntimeCommandBatchV1 {
            command_id: "command:schema".into(),
            idempotency_key: "key:schema".into(),
            actor_id: "actor:schema".into(),
            expected: identity(),
            operations: vec![operation],
            command_hash: WireHash::default(),
        };
        batch.command_hash = WireHash(wire_checksum_v1(&command_body(&batch).unwrap()));
        let mut command = encode_request_v1(&RuntimeRequestV1::Command {
            request_id: 11,
            client_epoch: 2,
            batch,
        })
        .unwrap();
        command[6..8].copy_from_slice(&RUNTIME_SCHEMA_V4.to_le_bytes());
        assert_eq!(decode_request_v1(&command).unwrap_err().code, "runtime-schema");

        let mut ready = encode_response_v1(&RuntimeResponseV1::Ready {
            request_id: 11,
            client_epoch: 2,
            worker_epoch: 3,
            runtime_handle: 1,
            identity: identity(),
            artifact_hash: "artifact".into(),
            instance_id: "instance:schema".into(),
            capabilities: vec!["integrated-runtime-v1".into()],
        })
        .unwrap();
        ready[6..8].copy_from_slice(&RUNTIME_SCHEMA_V4.to_le_bytes());
        assert_eq!(decode_response_v1(&ready).unwrap_err().code, "runtime-schema");
    }

    #[test]
    fn extract_view_v5_is_exact_bounded_and_request_only() {
        let request = RuntimeRequestV1::ExtractView {
            request_id: 41,
            client_epoch: 3,
            expected: identity(),
            after_revision: 9,
            max_bytes: MAX_EXTRACTION_BYTES as u32,
            viewport_width: 1_920,
            viewport_height: 1_080,
            view_revision: 11,
        };
        let encoded = encode_request_v1(&request).unwrap();
        assert_eq!(u16::from_le_bytes([encoded[6], encoded[7]]), RUNTIME_SCHEMA_V5);
        assert_eq!(decode_request_v1(&encoded).unwrap(), request);

        let legacy = RuntimeRequestV1::Extract {
            request_id: 41,
            client_epoch: 3,
            expected: identity(),
            after_revision: 9,
            max_bytes: MAX_EXTRACTION_BYTES as u32,
        };
        let legacy_encoded = encode_request_v1(&legacy).unwrap();
        assert_eq!(
            u16::from_le_bytes([legacy_encoded[6], legacy_encoded[7]]),
            RUNTIME_SCHEMA_V2
        );
        assert_eq!(
            &encoded[HEADER_BYTES..encoded.len() - 16],
            &legacy_encoded[HEADER_BYTES..]
        );

        let mut invalid_viewport = encoded.clone();
        let viewport_offset = invalid_viewport.len() - 16;
        invalid_viewport[viewport_offset..viewport_offset + 4].copy_from_slice(&0_u32.to_le_bytes());
        let checksum = wire_checksum_v1(&invalid_viewport[HEADER_BYTES..]);
        invalid_viewport[28..HEADER_BYTES].copy_from_slice(&checksum);
        assert_eq!(
            decode_request_v1(&invalid_viewport).unwrap_err().code,
            "invalid-viewport"
        );

        let mut unsafe_revision = encoded.clone();
        let revision_offset = unsafe_revision.len() - 8;
        unsafe_revision[revision_offset..].copy_from_slice(&(MAX_SAFE_U64 + 1).to_le_bytes());
        let checksum = wire_checksum_v1(&unsafe_revision[HEADER_BYTES..]);
        unsafe_revision[28..HEADER_BYTES].copy_from_slice(&checksum);
        assert_eq!(decode_request_v1(&unsafe_revision).unwrap_err().code, "unsafe-u64");

        let mut v5_as_v2 = encoded.clone();
        v5_as_v2[6..8].copy_from_slice(&RUNTIME_SCHEMA_V2.to_le_bytes());
        assert_eq!(decode_request_v1(&v5_as_v2).unwrap_err().code, "trailing-bytes");

        for invalid in [
            RuntimeRequestV1::ExtractView {
                request_id: 41,
                client_epoch: 3,
                expected: identity(),
                after_revision: 9,
                max_bytes: MAX_EXTRACTION_BYTES as u32,
                viewport_width: 0,
                viewport_height: 1_080,
                view_revision: 11,
            },
            RuntimeRequestV1::ExtractView {
                request_id: 41,
                client_epoch: 3,
                expected: identity(),
                after_revision: 9,
                max_bytes: MAX_EXTRACTION_BYTES as u32,
                viewport_width: 1_920,
                viewport_height: MAX_VIEWPORT_DIMENSION_V1 + 1,
                view_revision: 11,
            },
            RuntimeRequestV1::ExtractView {
                request_id: 41,
                client_epoch: 3,
                expected: identity(),
                after_revision: 9,
                max_bytes: MAX_EXTRACTION_BYTES as u32,
                viewport_width: 1_920,
                viewport_height: 1_080,
                view_revision: MAX_SAFE_U64 + 1,
            },
        ] {
            assert!(encode_request_v1(&invalid).is_err());
        }

        let mut shutdown = encode_request_v1(&RuntimeRequestV1::Shutdown {
            request_id: 42,
            client_epoch: 3,
            expected: None,
        })
        .unwrap();
        shutdown[6..8].copy_from_slice(&RUNTIME_SCHEMA_V5.to_le_bytes());
        assert_eq!(decode_request_v1(&shutdown).unwrap_err().code, "runtime-schema");
        let mut response = encode_response_v1(&RuntimeResponseV1::Shutdown {
            request_id: 42,
            client_epoch: 3,
            worker_epoch: 2,
        })
        .unwrap();
        response[6..8].copy_from_slice(&RUNTIME_SCHEMA_V5.to_le_bytes());
        assert_eq!(decode_response_v1(&response).unwrap_err().code, "runtime-schema");
    }

    #[test]
    fn restored_response_re_attests_new_worker_generation() {
        let response = RuntimeResponseV1::Restored {
            request_id: 7,
            client_epoch: 3,
            worker_epoch: 4,
            runtime_handle: 21,
            identity: identity(),
            checkpoint_hash: hash(0xbb),
            artifact_hash: "artifact-sha256".into(),
            instance_id: "runtime:21".into(),
            capabilities: vec![
                "fixed-step-input-v1".into(),
                "awaited-receipts-v1".into(),
                "fixed-step-input-v1".into(),
            ],
        };
        let decoded =
            decode_response_v1(&encode_response_v1(&response).expect("encode response")).expect("decode response");
        let RuntimeResponseV1::Restored { capabilities, .. } = decoded else {
            panic!("wrong response")
        };
        assert_eq!(capabilities, vec!["awaited-receipts-v1", "fixed-step-input-v1"]);
    }

    #[test]
    fn extraction_hash_covers_every_exact_channel_byte() {
        let mut extraction = RuntimeExtractionV1 {
            identity: identity(),
            extraction_revision: 9,
            render: vec![0x80, 0xff],
            hud: vec![1],
            audio: vec![2],
            platform_requests: vec![3],
            diagnostics: vec![4],
            extraction_hash: WireHash::default(),
        };
        extraction.extraction_hash = extraction_checksum_v1(&extraction).expect("extraction checksum");
        let response = RuntimeResponseV1::Extraction {
            request_id: 8,
            client_epoch: 2,
            worker_epoch: 3,
            extraction: extraction.clone(),
        };
        let encoded = encode_response_v1(&response).expect("encode extraction");
        assert_eq!(decode_response_v1(&encoded).expect("decode extraction"), response);

        extraction.render[0] ^= 0xff;
        let invalid = RuntimeResponseV1::Extraction {
            request_id: 9,
            client_epoch: 2,
            worker_epoch: 3,
            extraction,
        };
        assert_eq!(
            encode_response_v1(&invalid)
                .expect_err("tampered extraction must reject")
                .code,
            "extraction-hash"
        );
    }

    #[test]
    fn action_receipts_round_trip_v3_and_reject_unknown_trailing_or_invalid_slots() {
        let action = RuntimeInputActionReceiptV1 {
            sequence: 0x0102_0304,
            input_sequence: 9,
            tick: 1,
            kind: RuntimeInputActionKindV1::Interact,
            outcome: RuntimeInputActionOutcomeV1::Applied,
            selected_slot: 2,
            authoritative_flags: crate::RUNTIME_INPUT_FLAG_CREATIVE_V1,
            target_entity_id: 0xfedc_ba98_7654_3210,
            effect_hash: hash(0xcd),
        };
        let response = RuntimeResponseV1::StepResult {
            request_id: 31,
            client_epoch: 2,
            worker_epoch: 3,
            identity: identity(),
            fixed_steps: 1,
            inputs_applied: 1,
            commands_processed: 0,
            commands_accepted: 0,
            action_receipts: vec![action],
            replay_hash: WireHash::default(),
        };
        let encoded = encode_response_v1(&response).expect("encode action receipt");
        assert_eq!(u16::from_le_bytes([encoded[6], encoded[7]]), RUNTIME_SCHEMA_V3);
        assert_eq!(decode_response_v1(&encoded).expect("decode action receipt"), response);

        let sequence = action.sequence.to_le_bytes();
        let sequence_offset = encoded
            .windows(sequence.len())
            .position(|window| window == sequence)
            .expect("action receipt sequence exists in payload");
        assert!(sequence_offset >= HEADER_BYTES);
        let mut unknown = encoded.clone();
        unknown[sequence_offset + 24] = u8::MAX;
        let unknown_checksum = wire_checksum_v1(&unknown[HEADER_BYTES..]);
        unknown[28..HEADER_BYTES].copy_from_slice(&unknown_checksum);
        assert_eq!(
            decode_response_v1(&unknown)
                .expect_err("unknown action kind rejects")
                .code,
            "input-action-kind"
        );

        let mut trailing = encoded.clone();
        trailing.push(0xaa);
        let trailing_payload_length = u32::try_from(trailing.len() - HEADER_BYTES).unwrap();
        let trailing_checksum = wire_checksum_v1(&trailing[HEADER_BYTES..]);
        trailing[24..28].copy_from_slice(&trailing_payload_length.to_le_bytes());
        trailing[28..HEADER_BYTES].copy_from_slice(&trailing_checksum);
        assert_eq!(
            decode_response_v1(&trailing)
                .expect_err("trailing action bytes reject")
                .code,
            "trailing-bytes"
        );

        let invalid = RuntimeResponseV1::StepResult {
            request_id: 31,
            client_epoch: 2,
            worker_epoch: 3,
            identity: identity(),
            fixed_steps: 1,
            inputs_applied: 1,
            commands_processed: 0,
            commands_accepted: 0,
            action_receipts: vec![RuntimeInputActionReceiptV1 {
                selected_slot: 9,
                ..action
            }],
            replay_hash: WireHash::default(),
        };
        assert_eq!(
            encode_response_v1(&invalid)
                .expect_err("invalid selected slot rejects")
                .code,
            "input-action-receipt"
        );
    }

    #[test]
    fn legacy_v2_step_bytes_decode_with_an_intentionally_empty_action_receipt_list() {
        let response = RuntimeResponseV1::StepResult {
            request_id: 32,
            client_epoch: 2,
            worker_epoch: 3,
            identity: identity(),
            fixed_steps: 1,
            inputs_applied: 0,
            commands_processed: 0,
            commands_accepted: 0,
            action_receipts: Vec::new(),
            replay_hash: hash(0xee),
        };
        let encoded_v3 = encode_response_v1(&response).expect("encode v3 empty action list");
        let count_offset = encoded_v3.len() - 16 - 2;
        assert_eq!(&encoded_v3[count_offset..count_offset + 2], &[0, 0]);
        let mut encoded_v2 = encoded_v3;
        encoded_v2.drain(count_offset..count_offset + 2);
        encoded_v2[6..8].copy_from_slice(&RUNTIME_SCHEMA_V2.to_le_bytes());
        let payload_length = u32::try_from(encoded_v2.len() - HEADER_BYTES).unwrap();
        let payload_checksum = wire_checksum_v1(&encoded_v2[HEADER_BYTES..]);
        encoded_v2[24..28].copy_from_slice(&payload_length.to_le_bytes());
        encoded_v2[28..HEADER_BYTES].copy_from_slice(&payload_checksum);
        assert_eq!(
            decode_response_v1(&encoded_v2).expect("decode legacy v2 step"),
            response
        );
    }

    #[test]
    fn native_decoder_and_encoder_match_typescript_fixture_bytes_exactly() {
        for name in [
            "create-v4-unicode-sorted-block-sets",
            "command-high-binary-payload",
            "extract-view-v5-1920x1080",
        ] {
            let bytes = from_hex(&fixture_string(name, "hex"));
            let decoded = decode_request_v1(&bytes).expect("decode TypeScript request fixture");
            assert_eq!(encode_request_v1(&decoded).expect("re-encode native request"), bytes);
        }
        let legacy = from_hex(&fixture_string("create-unicode-sorted-block-sets", "hex"));
        let RuntimeRequestV1::Create { config, .. } = decode_request_v1(&legacy).expect("decode legacy create") else {
            panic!("legacy create fixture decoded to wrong request")
        };
        assert_eq!(config.terrain_content_hash, DEFAULT_TERRAIN_CONTENT_HASH_V2);
        assert_eq!(config.generation_options_json, DEFAULT_GENERATION_OPTIONS_JSON_V1);
        for name in [
            "ready-unicode-identity",
            "native-accepted-receipt-high-binary",
            "restored-re-attestation",
        ] {
            let bytes = from_hex(&fixture_string(name, "hex"));
            let decoded = decode_response_v1(&bytes).expect("decode TypeScript response fixture");
            assert_eq!(encode_response_v1(&decoded).expect("re-encode native response"), bytes);
        }
        assert_eq!(
            fixture_global_string("typescriptCanonicalHex"),
            fixture_global_string("rustCanonicalHex"),
            "actual Rust and TypeScript legacy canonical hashes agree"
        );
        assert_ne!(
            fixture_global_string("rustCanonicalHex"),
            fixture_global_string("buggyU8RotateHex"),
            "rotating an eight-bit value must not masquerade as Rust u64 semantics"
        );
    }
}
