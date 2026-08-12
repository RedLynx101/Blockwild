import {
  RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES,
  RUST_INTEGRATED_RUNTIME_MAX_ACTION_RECEIPTS,
  RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES,
  RUST_INTEGRATED_RUNTIME_MAX_INPUT_FRAMES,
  RUST_INTEGRATED_RUNTIME_MAX_OPERATIONS,
  RUST_INTEGRATED_RUNTIME_MAX_REQUEST_BYTES,
  RUST_INTEGRATED_RUNTIME_SCHEMA_V2,
  RUST_INTEGRATED_RUNTIME_SCHEMA_V3,
  RUST_INTEGRATED_RUNTIME_SCHEMA_V4,
  RUST_INTEGRATED_RUNTIME_SCHEMA_V5,
  RUST_INTEGRATED_RUNTIME_DEFAULT_GENERATION_OPTIONS_JSON_V1,
  RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONTENT_HASH_V2,
  RUST_INTEGRATED_RUNTIME_MAX_GENERATION_OPTIONS_JSON_BYTES,
  RUST_INTEGRATED_RUNTIME_MAX_VIEWPORT_DIMENSION_V1,
  RUST_INTEGRATED_RUNTIME_WIRE_V1,
  RUST_RUNTIME_INPUT_BUTTON_MASK_V1,
  RUST_RUNTIME_INPUT_FLAG_MASK_V1,
  type RustIntegratedRuntimeCommandBatchV1,
  type RustIntegratedRuntimeCommandReceiptV1,
  type RustIntegratedRuntimeConfigV1,
  type RustIntegratedRuntimeDomainOperationV1,
  type RustIntegratedRuntimeDomainV1,
  type RustIntegratedRuntimeExtractionV1,
  type RustIntegratedRuntimeIdentityV1,
  type RustIntegratedRuntimeInputFrameV1,
  type RustIntegratedRuntimeInputActionReceiptV1,
  type RustIntegratedRuntimeRequestV1,
  type RustIntegratedRuntimeResponseV1,
  type RustIntegratedRuntimeRevisionV1,
} from "./rust-integrated-runtime-contract";

const REQUEST_MAGIC = Uint8Array.from([0x42, 0x57, 0x52, 0x51]); // BWRQ
const RESPONSE_MAGIC = Uint8Array.from([0x42, 0x57, 0x52, 0x53]); // BWRS
const HEADER_BYTES = 44;
const HASH_BYTES = 16;
const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const MAX_LABEL_BYTES = 512;
const MAX_CAPABILITIES = 64;
const U64_MAX_SAFE = Number.MAX_SAFE_INTEGER;
const U64_MAX = BigInt("0xffffffffffffffff");
const U64_MASK = BigInt("0xffffffffffffffff");
const FNV64_OFFSET = BigInt("14695981039346656037");
const FNV64_PRIME = BigInt("1099511628211");
const FNV64_HIGH_PRIME = FNV64_PRIME ^ BigInt(0x13b);
const WIRE_HASH_DOMAIN = new TextEncoder().encode("blockwild.integrated.wire.checksum.v1");
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const requestOperations = Object.freeze({
  "runtime-create-v1": 1,
  "runtime-command-v1": 2,
  "runtime-recover-command-v1": 8,
  "runtime-step-v1": 3,
  "runtime-extract-v1": 4,
  "runtime-restore-v1": 5,
  "runtime-shutdown-v1": 6,
  "runtime-checkpoint-v1": 7,
} as const);

const responseOperations = Object.freeze({
  "runtime-ready-v1": 1,
  "runtime-command-receipt-v1": 2,
  "runtime-step-result-v1": 3,
  "runtime-extraction-v1": 4,
  "runtime-restored-v1": 5,
  "runtime-shutdown-v1": 6,
  "runtime-checkpoint-v1": 7,
  "runtime-error-v1": 255,
} as const);

const domains = Object.freeze([
  "world",
  "simulation",
  "entities",
  "gameplay",
  "persistence",
  "network",
] as const satisfies readonly RustIntegratedRuntimeDomainV1[]);

export class RustIntegratedRuntimeCodecError extends Error {
  readonly name = "RustIntegratedRuntimeCodecError";

  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function integer(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RustIntegratedRuntimeCodecError("invalid-integer", `${label} must be an integer in ${minimum}..${maximum}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function wellFormed(value: string, label: string) {
  if (typeof value !== "string") throw new RustIntegratedRuntimeCodecError("invalid-string", `${label} must be a string`);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) {
        throw new RustIntegratedRuntimeCodecError("invalid-unicode", `${label} contains an unpaired high surrogate`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new RustIntegratedRuntimeCodecError("invalid-unicode", `${label} contains an unpaired low surrogate`);
    }
  }
  return value;
}

function label(value: string, name: string, maximumBytes = MAX_LABEL_BYTES) {
  const normalized = wellFormed(value, name);
  const byteLength = textEncoder.encode(normalized).byteLength;
  if (byteLength < 1 || byteLength > maximumBytes) {
    throw new RustIntegratedRuntimeCodecError("invalid-label", `${name} must occupy 1..${maximumBytes} UTF-8 bytes`);
  }
  return normalized;
}

function hash(value: string, name: string) {
  if (!HASH_PATTERN.test(value)) {
    throw new RustIntegratedRuntimeCodecError("invalid-hash", `${name} must be a lowercase 128-bit hash`);
  }
  return value;
}

function hexToBytes(value: string, name: string) {
  hash(value, name);
  const output = new Uint8Array(HASH_BYTES);
  for (let index = 0; index < output.length; index += 1) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return output;
}

function bytesToHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function updateWireHash(lanes: readonly [bigint, bigint], byte: number): readonly [bigint, bigint] {
  const value = BigInt(byte);
  return [
    (lanes[0] ^ value) * FNV64_PRIME & U64_MASK,
    (lanes[1] ^ (value << BigInt(1) | BigInt(1))) * FNV64_HIGH_PRIME & U64_MASK,
  ];
}

/** Exact protocol-owned checksum, independent from canonical state hashes. */
export function rustIntegratedRuntimeWireChecksumV1(value: Uint8Array) {
  let lanes: readonly [bigint, bigint] = [FNV64_OFFSET, FNV64_OFFSET ^ BigInt("0xa0761d6478bd642f")];
  for (const byte of WIRE_HASH_DOMAIN) lanes = updateWireHash(lanes, byte);
  lanes = updateWireHash(lanes, 0);
  let length = BigInt(value.byteLength);
  for (let index = 0; index < 8; index += 1) {
    lanes = updateWireHash(lanes, Number(length & BigInt(0xff)));
    length >>= BigInt(8);
  }
  for (const byte of value) lanes = updateWireHash(lanes, byte);
  const output = new Uint8Array(HASH_BYTES);
  const view = new DataView(output.buffer);
  view.setBigUint64(0, lanes[0], true);
  view.setBigUint64(8, lanes[1], true);
  return bytesToHex(output);
}

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  private append(value: Uint8Array) {
    this.parts.push(value);
    this.length += value.byteLength;
  }

  finish(maximum = RUST_INTEGRATED_RUNTIME_MAX_REQUEST_BYTES) {
    if (this.length > maximum) {
      throw new RustIntegratedRuntimeCodecError("wire-capacity", `encoded payload exceeds ${maximum} bytes`);
    }
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    return output;
  }

  raw(bytes: Uint8Array) { this.append(bytes); }
  u8(value: number) { this.append(Uint8Array.of(integer(value, 0, 0xff, "u8"))); }
  u16(value: number) {
    const normalized = integer(value, 0, 0xffff, "u16");
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, normalized, true);
    this.append(bytes);
  }
  i16(value: number) { this.u16(integer(value, -0x8000, 0x7fff, "i16") & 0xffff); }
  u32(value: number) {
    const normalized = integer(value, 0, 0xffff_ffff, "u32");
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, normalized, true);
    this.append(bytes);
  }
  rawU64(value: bigint) {
    if (typeof value !== "bigint" || value < BigInt(0) || value > U64_MAX) {
      throw new RustIntegratedRuntimeCodecError("invalid-u64", "raw u64 must be an unsigned 64-bit bigint");
    }
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    this.append(bytes);
  }
  u64(value: number) {
    this.rawU64(BigInt(integer(value, 0, U64_MAX_SAFE, "u64")));
  }
  string(value: string, name = "string", maximumBytes = MAX_LABEL_BYTES) {
    const encoded = textEncoder.encode(label(value, name, maximumBytes));
    this.u16(encoded.byteLength);
    this.raw(encoded);
  }
  bytes(value: Uint8Array, maximum = RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES) {
    if (!(value instanceof Uint8Array) || value.byteLength > maximum) {
      throw new RustIntegratedRuntimeCodecError("invalid-bytes", `byte payload must be a Uint8Array no larger than ${maximum}`);
    }
    this.u32(value.byteLength);
    this.raw(value);
  }
  hash(value: string, name = "hash") { this.raw(hexToBytes(value, name)); }
}

class Reader {
  private offset = 0;

  constructor(private readonly value: Uint8Array) {}

  finish() {
    if (this.offset !== this.value.byteLength) {
      throw new RustIntegratedRuntimeCodecError("trailing-bytes", "wire payload has trailing bytes");
    }
  }

  take(length: number) {
    const normalized = integer(length, 0, RUST_INTEGRATED_RUNTIME_MAX_REQUEST_BYTES, "read length");
    const end = this.offset + normalized;
    if (!Number.isSafeInteger(end) || end > this.value.byteLength) {
      throw new RustIntegratedRuntimeCodecError("truncated", "wire payload is truncated");
    }
    const output = this.value.subarray(this.offset, end);
    this.offset = end;
    return output;
  }
  u8() { return this.take(1)[0]; }
  u16() { const bytes = this.take(2); return bytes[0] | bytes[1] << 8; }
  i16() { const value = this.u16(); return value & 0x8000 ? value - 0x1_0000 : value; }
  u32() { const bytes = this.take(4); return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true); }
  rawU64() {
    const bytes = this.take(8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
  }
  u64() {
    const value = this.rawU64();
    if (value > BigInt(U64_MAX_SAFE)) throw new RustIntegratedRuntimeCodecError("unsafe-u64", "wire u64 exceeds JavaScript safe range");
    return Number(value);
  }
  string(name = "string", maximumBytes = MAX_LABEL_BYTES) {
    const length = this.u16();
    if (length > maximumBytes) throw new RustIntegratedRuntimeCodecError("string-capacity", `${name} exceeds ${maximumBytes} bytes`);
    return label(textDecoder.decode(this.take(length)), name, maximumBytes);
  }
  bytes(maximum = RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES) {
    const length = this.u32();
    if (length > maximum) throw new RustIntegratedRuntimeCodecError("bytes-capacity", `wire byte payload exceeds ${maximum}`);
    return Uint8Array.from(this.take(length));
  }
  hash() { return bytesToHex(this.take(HASH_BYTES)); }
}

function normalizeRevision(value: RustIntegratedRuntimeRevisionV1): RustIntegratedRuntimeRevisionV1 {
  return Object.freeze({
    epoch: integer(value.epoch, 0, U64_MAX_SAFE, "revision.epoch"),
    world: integer(value.world, 0, U64_MAX_SAFE, "revision.world"),
    entities: integer(value.entities, 0, U64_MAX_SAFE, "revision.entities"),
    gameplay: integer(value.gameplay, 0, U64_MAX_SAFE, "revision.gameplay"),
    persistence: integer(value.persistence, 0, U64_MAX_SAFE, "revision.persistence"),
    network: integer(value.network, 0, U64_MAX_SAFE, "revision.network"),
    simulation: integer(value.simulation, 0, U64_MAX_SAFE, "revision.simulation"),
  });
}

function writeIdentity(writer: Writer, value: RustIntegratedRuntimeIdentityV1) {
  writer.string(value.universeId, "identity.universeId", 64);
  writer.string(value.locationId, "identity.locationId", 128);
  const revision = normalizeRevision(value.revision);
  writer.u64(revision.epoch);
  writer.u64(revision.world);
  writer.u64(revision.entities);
  writer.u64(revision.gameplay);
  writer.u64(revision.persistence);
  writer.u64(revision.network);
  writer.u64(revision.simulation);
  writer.u64(integer(value.tick, 0, U64_MAX_SAFE, "identity.tick"));
  writer.hash(value.stateHash, "identity.stateHash");
}

function readIdentity(reader: Reader): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: reader.string("identity.universeId", 64),
    locationId: reader.string("identity.locationId", 128),
    revision: Object.freeze({
      epoch: reader.u64(), world: reader.u64(), entities: reader.u64(), gameplay: reader.u64(),
      persistence: reader.u64(), network: reader.u64(), simulation: reader.u64(),
    }),
    tick: reader.u64(),
    stateHash: reader.hash(),
  });
}

function sortedUniqueBlockIds(values: readonly number[], name: string) {
  return Object.freeze([...new Set(values.map((value) => integer(value, 0, 0xffff, name)))].sort((left, right) => left - right));
}

function writeConfig(writer: Writer, value: RustIntegratedRuntimeConfigV1) {
  writer.string(value.worldSeed, "config.worldSeed", 2_048);
  writer.string(value.universeId, "config.universeId", 64);
  writer.string(value.locationId, "config.locationId", 128);
  writer.string(value.sessionId, "config.sessionId", 160);
  writer.hash(value.contentHash, "config.contentHash");
  writer.hash(value.generatorHash, "config.generatorHash");
  writer.hash(value.terrainContentHash, "config.terrainContentHash");
  writer.string(
    value.generationOptionsJson,
    "config.generationOptionsJson",
    RUST_INTEGRATED_RUNTIME_MAX_GENERATION_OPTIONS_JSON_BYTES,
  );
  writer.u16(value.waterBlockId);
  for (const values of [
    sortedUniqueBlockIds(value.directionalBlockIds, "config.directionalBlockIds"),
    sortedUniqueBlockIds(value.waterloggedBlockIds, "config.waterloggedBlockIds"),
  ]) {
    writer.u16(values.length);
    for (const blockId of values) writer.u16(blockId);
  }
}

function readConfig(reader: Reader, schema: number): RustIntegratedRuntimeConfigV1 {
  const worldSeed = reader.string("config.worldSeed", 2_048);
  const universeId = reader.string("config.universeId", 64);
  const locationId = reader.string("config.locationId", 128);
  const sessionId = reader.string("config.sessionId", 160);
  const contentHash = reader.hash();
  const generatorHash = reader.hash();
  const terrainContentHash = schema >= RUST_INTEGRATED_RUNTIME_SCHEMA_V4
    ? reader.hash()
    : RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONTENT_HASH_V2;
  const generationOptionsJson = schema >= RUST_INTEGRATED_RUNTIME_SCHEMA_V4
    ? reader.string("config.generationOptionsJson", RUST_INTEGRATED_RUNTIME_MAX_GENERATION_OPTIONS_JSON_BYTES)
    : RUST_INTEGRATED_RUNTIME_DEFAULT_GENERATION_OPTIONS_JSON_V1;
  const waterBlockId = reader.u16();
  const sets = Array.from({ length: 2 }, () => Object.freeze(Array.from({ length: reader.u16() }, () => reader.u16())));
  for (const values of sets) {
    for (let index = 1; index < values.length; index += 1) {
      if (values[index - 1] >= values[index]) throw new RustIntegratedRuntimeCodecError("block-id-order", "block id sets must be strictly increasing");
    }
  }
  return Object.freeze({
    worldSeed, universeId, locationId, sessionId, contentHash, generatorHash, terrainContentHash, generationOptionsJson, waterBlockId,
    directionalBlockIds: sets[0], waterloggedBlockIds: sets[1],
  });
}

function normalizeOperation(value: RustIntegratedRuntimeDomainOperationV1): RustIntegratedRuntimeDomainOperationV1 {
  if (!domains.includes(value.domain)) throw new RustIntegratedRuntimeCodecError("invalid-domain", `unknown runtime domain ${String(value.domain)}`);
  const payload = Uint8Array.from(value.payload);
  if (payload.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES) {
    throw new RustIntegratedRuntimeCodecError("domain-capacity", "domain operation exceeds its byte budget");
  }
  const payloadHash = rustIntegratedRuntimeWireChecksumV1(payload);
  if (value.payloadHash !== payloadHash) throw new RustIntegratedRuntimeCodecError("payload-hash", "domain payload hash does not match its exact bytes");
  return Object.freeze({
    domain: value.domain,
    typeId: label(value.typeId, "operation.typeId", 160),
    schema: integer(value.schema, 1, 0xffff, "operation.schema"),
    payload,
    payloadHash,
  });
}

function writeOperation(writer: Writer, value: RustIntegratedRuntimeDomainOperationV1) {
  const operation = normalizeOperation(value);
  writer.u8(domains.indexOf(operation.domain));
  writer.u16(operation.schema);
  writer.string(operation.typeId, "operation.typeId", 160);
  writer.bytes(operation.payload);
  writer.hash(operation.payloadHash, "operation.payloadHash");
}

function readOperation(reader: Reader): RustIntegratedRuntimeDomainOperationV1 {
  const domain = domains[reader.u8()];
  if (!domain) throw new RustIntegratedRuntimeCodecError("invalid-domain", "wire operation uses an unknown domain code");
  const schema = reader.u16();
  if (schema === 0) throw new RustIntegratedRuntimeCodecError("invalid-schema", "domain schema must be non-zero");
  const typeId = reader.string("operation.typeId", 160);
  const payload = reader.bytes();
  const payloadHash = reader.hash();
  return normalizeOperation({ domain, typeId, schema, payload, payloadHash });
}

function commandBody(value: Omit<RustIntegratedRuntimeCommandBatchV1, "commandHash"> | RustIntegratedRuntimeCommandBatchV1) {
  const writer = new Writer();
  writer.string(value.commandId, "command.commandId", 160);
  writer.string(value.idempotencyKey, "command.idempotencyKey", 256);
  writer.string(value.actorId, "command.actorId", 160);
  writeIdentity(writer, value.expected);
  if (value.operations.length < 1 || value.operations.length > RUST_INTEGRATED_RUNTIME_MAX_OPERATIONS) {
    throw new RustIntegratedRuntimeCodecError("operation-count", `runtime command requires 1..${RUST_INTEGRATED_RUNTIME_MAX_OPERATIONS} operations`);
  }
  writer.u16(value.operations.length);
  for (const operation of value.operations) writeOperation(writer, operation);
  return writer.finish();
}

export function createRustIntegratedRuntimeDomainOperationV1(
  value: Omit<RustIntegratedRuntimeDomainOperationV1, "payloadHash">,
): RustIntegratedRuntimeDomainOperationV1 {
  const payload = Uint8Array.from(value.payload);
  return normalizeOperation({ ...value, payload, payloadHash: rustIntegratedRuntimeWireChecksumV1(payload) });
}

export function createRustIntegratedRuntimeCommandBatchV1(
  value: Omit<RustIntegratedRuntimeCommandBatchV1, "commandHash">,
): RustIntegratedRuntimeCommandBatchV1 {
  const operations = Object.freeze(value.operations.map((operation) => normalizeOperation(operation)));
  const normalized = Object.freeze({ ...value, operations });
  return Object.freeze({ ...normalized, commandHash: rustIntegratedRuntimeWireChecksumV1(commandBody(normalized)) });
}

function writeCommand(writer: Writer, value: RustIntegratedRuntimeCommandBatchV1) {
  const expectedHash = rustIntegratedRuntimeWireChecksumV1(commandBody(value));
  if (value.commandHash !== expectedHash) throw new RustIntegratedRuntimeCodecError("command-hash", "runtime command hash does not match its exact bytes");
  writer.raw(commandBody(value));
  writer.hash(value.commandHash, "command.commandHash");
}

function readCommand(reader: Reader): RustIntegratedRuntimeCommandBatchV1 {
  const commandId = reader.string("command.commandId", 160);
  const idempotencyKey = reader.string("command.idempotencyKey", 256);
  const actorId = reader.string("command.actorId", 160);
  const expected = readIdentity(reader);
  const operationCount = reader.u16();
  if (operationCount < 1 || operationCount > RUST_INTEGRATED_RUNTIME_MAX_OPERATIONS) {
    throw new RustIntegratedRuntimeCodecError("operation-count", `runtime command requires 1..${RUST_INTEGRATED_RUNTIME_MAX_OPERATIONS} operations`);
  }
  const source = {
    commandId,
    idempotencyKey,
    actorId,
    expected,
    operations: Object.freeze(Array.from({ length: operationCount }, () => readOperation(reader))),
  };
  const commandHash = reader.hash();
  const normalized = createRustIntegratedRuntimeCommandBatchV1(source);
  if (commandHash !== normalized.commandHash) throw new RustIntegratedRuntimeCodecError("command-hash", "decoded runtime command hash does not match its exact bytes");
  return normalized;
}

function normalizeInput(value: RustIntegratedRuntimeInputFrameV1): RustIntegratedRuntimeInputFrameV1 {
  return Object.freeze({
    sequence: integer(value.sequence, 0, U64_MAX_SAFE, "input.sequence"),
    targetTick: integer(value.targetTick, 0, U64_MAX_SAFE, "input.targetTick"),
    moveX: integer(value.moveX, -0x8000, 0x7fff, "input.moveX"),
    moveZ: integer(value.moveZ, -0x8000, 0x7fff, "input.moveZ"),
    lookYaw: integer(value.lookYaw, -0x8000, 0x7fff, "input.lookYaw"),
    lookPitch: integer(value.lookPitch, -0x8000, 0x7fff, "input.lookPitch"),
    buttons: integer(value.buttons, 0, RUST_RUNTIME_INPUT_BUTTON_MASK_V1, "input.buttons"),
    selectedSlot: integer(value.selectedSlot, 0, 8, "input.selectedSlot"),
    flags: integer(value.flags, 0, RUST_RUNTIME_INPUT_FLAG_MASK_V1, "input.flags"),
  });
}

function writeInput(writer: Writer, value: RustIntegratedRuntimeInputFrameV1) {
  const input = normalizeInput(value);
  writer.u64(input.sequence); writer.u64(input.targetTick);
  writer.i16(input.moveX); writer.i16(input.moveZ); writer.i16(input.lookYaw); writer.i16(input.lookPitch);
  writer.u32(input.buttons); writer.u8(input.selectedSlot); writer.u8(input.flags); writer.u16(0);
}

function readInput(reader: Reader) {
  const input = normalizeInput({
    sequence: reader.u64(), targetTick: reader.u64(), moveX: reader.i16(), moveZ: reader.i16(),
    lookYaw: reader.i16(), lookPitch: reader.i16(), buttons: reader.u32(), selectedSlot: reader.u8(), flags: reader.u8(),
  });
  if (reader.u16() !== 0) throw new RustIntegratedRuntimeCodecError("reserved", "input frame reserved bits must be zero");
  return input;
}

const inputActionKinds = Object.freeze([
  "primary-attack",
  "secondary-use",
  "interact",
  "mount-toggle",
  "creative-flight-toggle",
  "drop",
] as const);

const inputActionOutcomes = Object.freeze([
  "applied",
  "no-target",
  "ineligible",
  "empty-slot",
  "blocked",
] as const);

function writeInputActionReceipt(writer: Writer, value: RustIntegratedRuntimeInputActionReceiptV1) {
  const kind = inputActionKinds.indexOf(value.kind);
  const outcome = inputActionOutcomes.indexOf(value.outcome);
  if (kind < 0 || outcome < 0) {
    throw new RustIntegratedRuntimeCodecError("input-action-receipt", "input action receipt kind or outcome is unknown");
  }
  writer.u64(integer(value.sequence, 1, U64_MAX_SAFE, "action.sequence"));
  writer.u64(integer(value.inputSequence, 1, U64_MAX_SAFE, "action.inputSequence"));
  writer.u64(integer(value.tick, 0, U64_MAX_SAFE, "action.tick"));
  writer.u8(kind);
  writer.u8(outcome);
  writer.u8(integer(value.selectedSlot, 0, 8, "action.selectedSlot"));
  writer.u8(integer(value.authoritativeFlags, 0, RUST_RUNTIME_INPUT_FLAG_MASK_V1, "action.authoritativeFlags"));
  writer.rawU64(value.targetEntityId);
  writer.hash(value.effectHash, "action.effectHash");
}

function readInputActionReceipt(reader: Reader): RustIntegratedRuntimeInputActionReceiptV1 {
  const sequence = reader.u64();
  const inputSequence = reader.u64();
  const tick = reader.u64();
  const kindTag = reader.u8();
  const outcomeTag = reader.u8();
  const kind = inputActionKinds[kindTag];
  const outcome = inputActionOutcomes[outcomeTag];
  const selectedSlot = reader.u8();
  const authoritativeFlags = reader.u8();
  const targetEntityId = reader.rawU64();
  const effectHash = reader.hash();
  if (kind === undefined) {
    throw new RustIntegratedRuntimeCodecError("input-action-kind", `input action receipt kind ${kindTag} is unknown`);
  }
  if (outcome === undefined) {
    throw new RustIntegratedRuntimeCodecError("input-action-outcome", `input action receipt outcome ${outcomeTag} is unknown`);
  }
  if (sequence < 1 || inputSequence < 1
    || selectedSlot > 8 || authoritativeFlags > RUST_RUNTIME_INPUT_FLAG_MASK_V1) {
    throw new RustIntegratedRuntimeCodecError("input-action-receipt", "input action receipt is malformed");
  }
  return Object.freeze({
    sequence,
    inputSequence,
    tick,
    kind,
    outcome,
    selectedSlot,
    authoritativeFlags,
    targetEntityId,
    effectHash,
  });
}

function writeReceipt(writer: Writer, value: RustIntegratedRuntimeCommandReceiptV1) {
  writer.u8(value.status === "accepted" ? 0 : 1);
  writer.string(value.commandId, "receipt.commandId", 160);
  writer.string(value.idempotencyKey, "receipt.idempotencyKey", 256);
  writer.hash(value.commandHash, "receipt.commandHash");
  if (value.status === "accepted") {
    writeIdentity(writer, value.before); writeIdentity(writer, value.after);
    if (value.domainReceipts.length > RUST_INTEGRATED_RUNTIME_MAX_OPERATIONS) {
      throw new RustIntegratedRuntimeCodecError("receipt-capacity", "domain receipt count exceeds the operation budget");
    }
    writer.u16(value.domainReceipts.length);
    for (const receipt of value.domainReceipts) writeOperation(writer, receipt);
  } else {
    writer.string(value.code, "receipt.code", 96);
    writer.string(value.message, "receipt.message", 2_048);
    writeIdentity(writer, value.current);
  }
  writer.hash(value.receiptHash, "receipt.receiptHash");
}

function readReceipt(reader: Reader): RustIntegratedRuntimeCommandReceiptV1 {
  const status = reader.u8();
  const commandId = reader.string("receipt.commandId", 160);
  const idempotencyKey = reader.string("receipt.idempotencyKey", 256);
  const commandHash = reader.hash();
  if (status === 0) {
    const before = readIdentity(reader);
    const after = readIdentity(reader);
    const receiptCount = reader.u16();
    if (receiptCount > RUST_INTEGRATED_RUNTIME_MAX_OPERATIONS) {
      throw new RustIntegratedRuntimeCodecError("receipt-capacity", "domain receipt count exceeds the operation budget");
    }
    const domainReceipts = Object.freeze(Array.from({ length: receiptCount }, () => readOperation(reader)));
    const receiptHash = reader.hash();
    return Object.freeze({ status: "accepted", commandId, idempotencyKey, commandHash, before, after, domainReceipts, receiptHash });
  }
  if (status !== 1) throw new RustIntegratedRuntimeCodecError("receipt-status", "runtime receipt has an unknown status");
  const code = reader.string("receipt.code", 96);
  const message = reader.string("receipt.message", 2_048);
  const current = readIdentity(reader);
  const receiptHash = reader.hash();
  return Object.freeze({ status: "rejected", commandId, idempotencyKey, commandHash, code, message, current, receiptHash });
}

function writeExtraction(writer: Writer, value: RustIntegratedRuntimeExtractionV1) {
  writeIdentity(writer, value.identity);
  writer.u64(value.extractionRevision);
  writer.bytes(value.render, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  writer.bytes(value.hud, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  writer.bytes(value.audio, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  writer.bytes(value.platformRequests, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  writer.bytes(value.diagnostics, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  const total = value.render.byteLength + value.hud.byteLength + value.audio.byteLength
    + value.platformRequests.byteLength + value.diagnostics.byteLength;
  if (total > RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES) {
    throw new RustIntegratedRuntimeCodecError("extraction-capacity", "combined extraction exceeds its byte budget");
  }
  const expectedHash = rustIntegratedRuntimeExtractionChecksumV1(value);
  if (value.extractionHash !== expectedHash) {
    throw new RustIntegratedRuntimeCodecError("extraction-hash", "extraction hash does not match its exact channel bytes");
  }
  writer.hash(expectedHash, "extraction.extractionHash");
}

function readExtraction(reader: Reader): RustIntegratedRuntimeExtractionV1 {
  const identity = readIdentity(reader);
  const extractionRevision = reader.u64();
  const render = reader.bytes(RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  const hud = reader.bytes(RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  const audio = reader.bytes(RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  const platformRequests = reader.bytes(RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  const diagnostics = reader.bytes(RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  const total = render.byteLength + hud.byteLength + audio.byteLength + platformRequests.byteLength + diagnostics.byteLength;
  if (total > RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES) {
    throw new RustIntegratedRuntimeCodecError("extraction-capacity", "combined extraction exceeds its byte budget");
  }
  const extractionHash = reader.hash();
  const extraction = Object.freeze({ identity, extractionRevision, render, hud, audio, platformRequests, diagnostics, extractionHash });
  if (extractionHash !== rustIntegratedRuntimeExtractionChecksumV1(extraction)) {
    throw new RustIntegratedRuntimeCodecError("extraction-hash", "decoded extraction hash does not match its exact channel bytes");
  }
  return extraction;
}

export function rustIntegratedRuntimeExtractionChecksumV1(
  value: Pick<RustIntegratedRuntimeExtractionV1, "render" | "hud" | "audio" | "platformRequests" | "diagnostics">,
) {
  const writer = new Writer();
  writer.bytes(value.render, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  writer.bytes(value.hud, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  writer.bytes(value.audio, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  writer.bytes(value.platformRequests, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  writer.bytes(value.diagnostics, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES);
  return rustIntegratedRuntimeWireChecksumV1(writer.finish(RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES + 20));
}

type Header = Readonly<{ schema: number; operation: number; status: number; requestId: number; clientEpoch: number; workerEpoch: number; payload: Uint8Array }>;

function encodeEnvelope(
  magic: Uint8Array,
  operation: number,
  status: number,
  requestId: number,
  clientEpoch: number,
  workerEpoch: number,
  payload: Uint8Array,
  schema: number = RUST_INTEGRATED_RUNTIME_SCHEMA_V2,
) {
  if (payload.byteLength + HEADER_BYTES > RUST_INTEGRATED_RUNTIME_MAX_REQUEST_BYTES) {
    throw new RustIntegratedRuntimeCodecError("wire-capacity", "integrated runtime envelope exceeds 8 MiB");
  }
  const output = new Uint8Array(HEADER_BYTES + payload.byteLength);
  output.set(magic, 0);
  const view = new DataView(output.buffer);
  view.setUint16(4, RUST_INTEGRATED_RUNTIME_WIRE_V1, true);
  if (schema !== RUST_INTEGRATED_RUNTIME_SCHEMA_V2 && schema !== RUST_INTEGRATED_RUNTIME_SCHEMA_V3 && schema !== RUST_INTEGRATED_RUNTIME_SCHEMA_V4 && schema !== RUST_INTEGRATED_RUNTIME_SCHEMA_V5) {
    throw new RustIntegratedRuntimeCodecError("runtime-schema", "integrated runtime schema is unsupported");
  }
  view.setUint16(6, schema, true);
  view.setUint8(8, integer(operation, 0, 0xff, "operation"));
  view.setUint8(9, integer(status, 0, 0xff, "status"));
  view.setUint16(10, 0, true);
  view.setUint32(12, integer(requestId, 1, 0xffff_ffff, "requestId"), true);
  view.setUint32(16, integer(clientEpoch, 1, 0xffff_ffff, "clientEpoch"), true);
  view.setUint32(20, integer(workerEpoch, 0, 0xffff_ffff, "workerEpoch"), true);
  view.setUint32(24, payload.byteLength, true);
  output.set(hexToBytes(rustIntegratedRuntimeWireChecksumV1(payload), "payload checksum"), 28);
  output.set(payload, HEADER_BYTES);
  return output;
}

function decodeEnvelope(value: Uint8Array | ArrayBuffer, magic: Uint8Array): Header {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.byteLength < HEADER_BYTES || bytes.byteLength > RUST_INTEGRATED_RUNTIME_MAX_REQUEST_BYTES) {
    throw new RustIntegratedRuntimeCodecError("envelope-size", "integrated runtime envelope has an invalid size");
  }
  for (let index = 0; index < magic.length; index += 1) {
    if (bytes[index] !== magic[index]) throw new RustIntegratedRuntimeCodecError("magic", "integrated runtime envelope has invalid magic");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== RUST_INTEGRATED_RUNTIME_WIRE_V1) throw new RustIntegratedRuntimeCodecError("wire-version", "integrated runtime wire version is unsupported");
  const schema = view.getUint16(6, true);
  if (schema !== RUST_INTEGRATED_RUNTIME_SCHEMA_V2 && schema !== RUST_INTEGRATED_RUNTIME_SCHEMA_V3 && schema !== RUST_INTEGRATED_RUNTIME_SCHEMA_V4 && schema !== RUST_INTEGRATED_RUNTIME_SCHEMA_V5) throw new RustIntegratedRuntimeCodecError("runtime-schema", "integrated runtime schema is unsupported");
  if (view.getUint16(10, true) !== 0) throw new RustIntegratedRuntimeCodecError("reserved", "integrated runtime reserved header bits must be zero");
  const payloadLength = view.getUint32(24, true);
  if (payloadLength !== bytes.byteLength - HEADER_BYTES) throw new RustIntegratedRuntimeCodecError("length", "integrated runtime envelope length does not match its payload");
  const payload = bytes.subarray(HEADER_BYTES);
  const expectedHash = bytesToHex(bytes.subarray(28, HEADER_BYTES));
  if (rustIntegratedRuntimeWireChecksumV1(payload) !== expectedHash) throw new RustIntegratedRuntimeCodecError("checksum", "integrated runtime envelope checksum failed");
  return Object.freeze({
    schema, operation: view.getUint8(8), status: view.getUint8(9), requestId: view.getUint32(12, true),
    clientEpoch: view.getUint32(16, true), workerEpoch: view.getUint32(20, true), payload,
  });
}

function validateOperationSchema(operation: number, schema: number, response: boolean) {
  const valid = response
    ? operation === 3
      ? schema === RUST_INTEGRATED_RUNTIME_SCHEMA_V2 || schema === RUST_INTEGRATED_RUNTIME_SCHEMA_V3
      : [1, 2, 4, 5, 6, 7, 255].includes(operation)
        ? schema === RUST_INTEGRATED_RUNTIME_SCHEMA_V2
        : true
    : operation === 1
      ? schema === RUST_INTEGRATED_RUNTIME_SCHEMA_V2 || schema === RUST_INTEGRATED_RUNTIME_SCHEMA_V4
      : operation === 4
        ? schema === RUST_INTEGRATED_RUNTIME_SCHEMA_V2 || schema === RUST_INTEGRATED_RUNTIME_SCHEMA_V5
        : [2, 3, 5, 6, 7, 8].includes(operation)
          ? schema === RUST_INTEGRATED_RUNTIME_SCHEMA_V2
          : true;
  if (!valid) {
    throw new RustIntegratedRuntimeCodecError("runtime-schema", "integrated runtime schema is not valid for this operation");
  }
}

export function encodeRustIntegratedRuntimeRequestV1(request: RustIntegratedRuntimeRequestV1) {
  const writer = new Writer();
  switch (request.type) {
    case "runtime-create-v1": writeConfig(writer, request.config); break;
    case "runtime-command-v1":
    case "runtime-recover-command-v1": writeCommand(writer, request.batch); break;
    case "runtime-step-v1":
      writeIdentity(writer, request.expected);
      writer.u64(request.monotonicTimeUs);
      writer.u32(integer(request.budgetUs, 1, 1_000_000, "step.budgetUs"));
      if (request.inputs.length > RUST_INTEGRATED_RUNTIME_MAX_INPUT_FRAMES) throw new RustIntegratedRuntimeCodecError("input-capacity", "step input batch exceeds 128 frames");
      writer.u16(request.inputs.length);
      for (const input of request.inputs) writeInput(writer, input);
      break;
    case "runtime-extract-v1":
      writeIdentity(writer, request.expected);
      writer.u64(request.afterRevision);
      writer.u32(integer(request.maxBytes, 1, RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES, "extract.maxBytes"));
      if (request.view) {
        writer.u32(integer(request.view.viewportWidth, 1, RUST_INTEGRATED_RUNTIME_MAX_VIEWPORT_DIMENSION_V1, "extract.viewportWidth"));
        writer.u32(integer(request.view.viewportHeight, 1, RUST_INTEGRATED_RUNTIME_MAX_VIEWPORT_DIMENSION_V1, "extract.viewportHeight"));
        writer.u64(request.view.viewRevision);
      }
      break;
    case "runtime-restore-v1":
      writer.hash(request.expectedCheckpointHash, "restore.expectedCheckpointHash");
      writer.bytes(request.checkpoint, RUST_INTEGRATED_RUNTIME_MAX_REQUEST_BYTES - HEADER_BYTES - 32);
      break;
    case "runtime-checkpoint-v1": writeIdentity(writer, request.expected); break;
    case "runtime-shutdown-v1":
      writer.u8(request.expected ? 1 : 0);
      if (request.expected) writeIdentity(writer, request.expected);
      break;
  }
  return encodeEnvelope(
    REQUEST_MAGIC,
    requestOperations[request.type],
    0,
    request.requestId,
    request.clientEpoch,
    0,
    writer.finish(),
    request.type === "runtime-create-v1"
      ? RUST_INTEGRATED_RUNTIME_SCHEMA_V4
      : request.type === "runtime-extract-v1" && request.view
        ? RUST_INTEGRATED_RUNTIME_SCHEMA_V5
        : RUST_INTEGRATED_RUNTIME_SCHEMA_V2,
  );
}

export function decodeRustIntegratedRuntimeRequestV1(value: Uint8Array | ArrayBuffer): RustIntegratedRuntimeRequestV1 {
  const header = decodeEnvelope(value, REQUEST_MAGIC);
  if (header.status !== 0 || header.workerEpoch !== 0) throw new RustIntegratedRuntimeCodecError("request-header", "runtime requests must have zero status and worker epoch");
  validateOperationSchema(header.operation, header.schema, false);
  const base = { requestId: header.requestId, clientEpoch: header.clientEpoch } as const;
  const reader = new Reader(header.payload);
  let request: RustIntegratedRuntimeRequestV1;
  switch (header.operation) {
    case 1: request = Object.freeze({ ...base, type: "runtime-create-v1", config: readConfig(reader, header.schema) }); break;
    case 2: request = Object.freeze({ ...base, type: "runtime-command-v1", batch: readCommand(reader) }); break;
    case 8: request = Object.freeze({ ...base, type: "runtime-recover-command-v1", batch: readCommand(reader) }); break;
    case 3: {
      const expected = readIdentity(reader);
      const monotonicTimeUs = reader.u64();
      const budgetUs = reader.u32();
      const count = reader.u16();
      if (count > RUST_INTEGRATED_RUNTIME_MAX_INPUT_FRAMES) throw new RustIntegratedRuntimeCodecError("input-capacity", "step input batch exceeds 128 frames");
      request = Object.freeze({ ...base, type: "runtime-step-v1", expected, monotonicTimeUs, budgetUs, inputs: Object.freeze(Array.from({ length: count }, () => readInput(reader))) });
      break;
    }
    case 4: {
      const expected = readIdentity(reader);
      const afterRevision = reader.u64();
      const maxBytes = reader.u32();
      if (maxBytes < 1 || maxBytes > RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES) {
        throw new RustIntegratedRuntimeCodecError("invalid-integer", "extraction byte budget is out of range");
      }
      request = header.schema === RUST_INTEGRATED_RUNTIME_SCHEMA_V5
        ? Object.freeze({
          ...base,
          type: "runtime-extract-v1",
          expected,
          afterRevision,
          maxBytes,
          view: Object.freeze({
            viewportWidth: integer(reader.u32(), 1, RUST_INTEGRATED_RUNTIME_MAX_VIEWPORT_DIMENSION_V1, "extract.viewportWidth"),
            viewportHeight: integer(reader.u32(), 1, RUST_INTEGRATED_RUNTIME_MAX_VIEWPORT_DIMENSION_V1, "extract.viewportHeight"),
            viewRevision: reader.u64(),
          }),
        })
        : Object.freeze({ ...base, type: "runtime-extract-v1", expected, afterRevision, maxBytes });
      break;
    }
    case 5: request = Object.freeze({ ...base, type: "runtime-restore-v1", expectedCheckpointHash: reader.hash(), checkpoint: reader.bytes(RUST_INTEGRATED_RUNTIME_MAX_REQUEST_BYTES - HEADER_BYTES - 32) }); break;
    case 6: {
      const present = reader.u8();
      if (present > 1) throw new RustIntegratedRuntimeCodecError("optional-identity", "shutdown identity flag is invalid");
      request = Object.freeze({ ...base, type: "runtime-shutdown-v1", expected: present ? readIdentity(reader) : null });
      break;
    }
    case 7: request = Object.freeze({ ...base, type: "runtime-checkpoint-v1", expected: readIdentity(reader) }); break;
    default: throw new RustIntegratedRuntimeCodecError("operation", "runtime request operation is unknown");
  }
  reader.finish();
  return request;
}

export function encodeRustIntegratedRuntimeResponseV1(response: RustIntegratedRuntimeResponseV1) {
  const writer = new Writer();
  switch (response.type) {
    case "runtime-ready-v1": {
      const capabilities = [...new Set(response.capabilities)].sort();
      if (capabilities.length > MAX_CAPABILITIES) throw new RustIntegratedRuntimeCodecError("capability-count", "runtime capability count exceeds 64");
      writer.u32(response.runtimeHandle);
      writeIdentity(writer, response.identity);
      writer.string(response.artifactHash, "ready.artifactHash", 128);
      writer.string(response.instanceId, "ready.instanceId", 160);
      writer.u16(capabilities.length);
      for (const capability of capabilities) writer.string(capability, "ready.capability", 96);
      break;
    }
    case "runtime-command-receipt-v1": writeReceipt(writer, response.receipt); break;
    case "runtime-step-result-v1":
      writeIdentity(writer, response.identity);
      writer.u16(response.fixedSteps); writer.u16(response.inputsApplied);
      writer.u16(response.commandsProcessed); writer.u16(response.commandsAccepted);
      if (response.actionReceipts.length > RUST_INTEGRATED_RUNTIME_MAX_ACTION_RECEIPTS) {
        throw new RustIntegratedRuntimeCodecError("input-action-capacity", "step action receipts exceed their bound");
      }
      writer.u16(response.actionReceipts.length);
      for (const receipt of response.actionReceipts) writeInputActionReceipt(writer, receipt);
      writer.hash(response.replayHash, "step.replayHash");
      break;
    case "runtime-extraction-v1": writeExtraction(writer, response.extraction); break;
    case "runtime-restored-v1": {
      const capabilities = [...new Set(response.capabilities)].sort();
      if (capabilities.length > MAX_CAPABILITIES) throw new RustIntegratedRuntimeCodecError("capability-count", "runtime capability count exceeds 64");
      writer.u32(response.runtimeHandle);
      writeIdentity(writer, response.identity);
      writer.hash(response.checkpointHash, "restore.checkpointHash");
      writer.string(response.artifactHash, "restore.artifactHash", 128);
      writer.string(response.instanceId, "restore.instanceId", 160);
      writer.u16(capabilities.length);
      for (const capability of capabilities) writer.string(capability, "restore.capability", 96);
      break;
    }
    case "runtime-checkpoint-v1":
      writeIdentity(writer, response.identity);
      writer.bytes(response.checkpoint, RUST_INTEGRATED_RUNTIME_MAX_REQUEST_BYTES - HEADER_BYTES - 32);
      writer.hash(response.checkpointHash, "checkpoint.checkpointHash");
      break;
    case "runtime-shutdown-v1": break;
    case "runtime-error-v1":
      writer.string(response.code, "error.code", 96);
      writer.string(response.message, "error.message", 2_048);
      writer.u8(response.current ? 1 : 0);
      if (response.current) writeIdentity(writer, response.current);
      break;
  }
  return encodeEnvelope(
    RESPONSE_MAGIC,
    responseOperations[response.type],
    response.type === "runtime-error-v1" ? 1 : 0,
    response.requestId,
    response.clientEpoch,
    response.workerEpoch,
    writer.finish(),
    response.type === "runtime-step-result-v1" ? RUST_INTEGRATED_RUNTIME_SCHEMA_V3 : RUST_INTEGRATED_RUNTIME_SCHEMA_V2,
  );
}

export function decodeRustIntegratedRuntimeResponseV1(value: Uint8Array | ArrayBuffer): RustIntegratedRuntimeResponseV1 {
  const header = decodeEnvelope(value, RESPONSE_MAGIC);
  if (header.workerEpoch < 1) throw new RustIntegratedRuntimeCodecError("worker-epoch", "runtime response is missing a worker epoch");
  validateOperationSchema(header.operation, header.schema, true);
  const base = { requestId: header.requestId, clientEpoch: header.clientEpoch, workerEpoch: header.workerEpoch } as const;
  const reader = new Reader(header.payload);
  let response: RustIntegratedRuntimeResponseV1;
  switch (header.operation) {
    case 1: {
      const runtimeHandle = reader.u32();
      if (runtimeHandle < 1) throw new RustIntegratedRuntimeCodecError("runtime-handle", "runtime handle must be a live generational handle");
      const identity = readIdentity(reader);
      const artifactHash = reader.string("ready.artifactHash", 128);
      const instanceId = reader.string("ready.instanceId", 160);
      const capabilityCount = reader.u16();
      if (capabilityCount > MAX_CAPABILITIES) throw new RustIntegratedRuntimeCodecError("capability-count", "runtime capability count exceeds 64");
      const capabilities = Object.freeze(Array.from({ length: capabilityCount }, () => reader.string("ready.capability", 96)));
      for (let index = 1; index < capabilities.length; index += 1) if (capabilities[index - 1] >= capabilities[index]) throw new RustIntegratedRuntimeCodecError("capability-order", "runtime capabilities must be unique and sorted");
      response = Object.freeze({ ...base, type: "runtime-ready-v1", runtimeHandle, identity, artifactHash, instanceId, capabilities });
      break;
    }
    case 2: response = Object.freeze({ ...base, type: "runtime-command-receipt-v1", receipt: readReceipt(reader) }); break;
    case 3: {
      const identity = readIdentity(reader);
      const fixedSteps = reader.u16();
      const inputsApplied = reader.u16();
      const commandsProcessed = reader.u16();
      const commandsAccepted = reader.u16();
      const actionCount = header.schema >= RUST_INTEGRATED_RUNTIME_SCHEMA_V3 ? reader.u16() : 0;
      if (actionCount > RUST_INTEGRATED_RUNTIME_MAX_ACTION_RECEIPTS) throw new RustIntegratedRuntimeCodecError("input-action-capacity", "step action receipts exceed their bound");
      const actionReceipts = Object.freeze(Array.from({ length: actionCount }, () => readInputActionReceipt(reader)));
      for (let index = 1; index < actionReceipts.length; index += 1) {
        if (actionReceipts[index - 1].sequence >= actionReceipts[index].sequence) {
          throw new RustIntegratedRuntimeCodecError("input-action-order", "step action receipt sequences must be strictly increasing");
        }
      }
      response = Object.freeze({
        ...base,
        type: "runtime-step-result-v1",
        identity,
        fixedSteps,
        inputsApplied,
        commandsProcessed,
        commandsAccepted,
        actionReceipts,
        replayHash: reader.hash(),
      });
      break;
    }
    case 4: response = Object.freeze({ ...base, type: "runtime-extraction-v1", extraction: readExtraction(reader) }); break;
    case 5: {
      const runtimeHandle = reader.u32();
      if (runtimeHandle < 1) throw new RustIntegratedRuntimeCodecError("runtime-handle", "runtime handle must be a live generational handle");
      const identity = readIdentity(reader);
      const checkpointHash = reader.hash();
      const artifactHash = reader.string("restore.artifactHash", 128);
      const instanceId = reader.string("restore.instanceId", 160);
      const capabilityCount = reader.u16();
      if (capabilityCount > MAX_CAPABILITIES) throw new RustIntegratedRuntimeCodecError("capability-count", "runtime capability count exceeds 64");
      const capabilities = Object.freeze(Array.from({ length: capabilityCount }, () => reader.string("restore.capability", 96)));
      for (let index = 1; index < capabilities.length; index += 1) if (capabilities[index - 1] >= capabilities[index]) throw new RustIntegratedRuntimeCodecError("capability-order", "runtime capabilities must be unique and sorted");
      response = Object.freeze({ ...base, type: "runtime-restored-v1", runtimeHandle, identity, checkpointHash, artifactHash, instanceId, capabilities });
      break;
    }
    case 6: response = Object.freeze({ ...base, type: "runtime-shutdown-v1" }); break;
    case 7: response = Object.freeze({ ...base, type: "runtime-checkpoint-v1", identity: readIdentity(reader), checkpoint: reader.bytes(RUST_INTEGRATED_RUNTIME_MAX_REQUEST_BYTES - HEADER_BYTES - 32), checkpointHash: reader.hash() }); break;
    case 255: {
      const code = reader.string("error.code", 96);
      const message = reader.string("error.message", 2_048);
      const present = reader.u8();
      if (present > 1) throw new RustIntegratedRuntimeCodecError("optional-identity", "error identity flag is invalid");
      response = Object.freeze({ ...base, type: "runtime-error-v1", code, message, current: present ? readIdentity(reader) : null });
      break;
    }
    default: throw new RustIntegratedRuntimeCodecError("operation", "runtime response operation is unknown");
  }
  if ((response.type === "runtime-error-v1") !== (header.status === 1)) {
    throw new RustIntegratedRuntimeCodecError("response-status", "runtime response status disagrees with its operation");
  }
  reader.finish();
  return response;
}

export function rustIntegratedRuntimeRequestTransferListV1(request: RustIntegratedRuntimeRequestV1) {
  const buffers = new Set<ArrayBuffer>();
  const add = (bytes: Uint8Array) => {
    if (!(bytes.buffer instanceof ArrayBuffer)) throw new RustIntegratedRuntimeCodecError("shared-buffer", "integrated runtime V1 requires transferable ArrayBuffers");
    buffers.add(bytes.buffer);
  };
  if (request.type === "runtime-command-v1" || request.type === "runtime-recover-command-v1") {
    for (const operation of request.batch.operations) add(operation.payload);
  }
  if (request.type === "runtime-restore-v1") add(request.checkpoint);
  return [...buffers];
}

export function rustIntegratedRuntimeResponseTransferListV1(response: RustIntegratedRuntimeResponseV1) {
  const buffers = new Set<ArrayBuffer>();
  const add = (bytes: Uint8Array) => { if (bytes.buffer instanceof ArrayBuffer) buffers.add(bytes.buffer); };
  if (response.type === "runtime-command-receipt-v1" && response.receipt.status === "accepted") {
    for (const operation of response.receipt.domainReceipts) add(operation.payload);
  }
  if (response.type === "runtime-extraction-v1") {
    add(response.extraction.render); add(response.extraction.hud); add(response.extraction.audio);
    add(response.extraction.platformRequests); add(response.extraction.diagnostics);
  }
  if (response.type === "runtime-checkpoint-v1") add(response.checkpoint);
  return [...buffers];
}
