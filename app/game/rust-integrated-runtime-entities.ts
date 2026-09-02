import {
  RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES,
  type RustIntegratedRuntimeDomainOperationV1,
} from "./rust-integrated-runtime-contract";
import { rustIntegratedRuntimeWireChecksumV1 } from "./rust-integrated-runtime-codec";
import {
  type RustEntityCompatibilityRecordR6,
  type RustEntityEventBatchR6,
  type RustEntityEventKindR6,
  type RustEntityResidencyR6,
  type RustEntitySimulationTierR6,
  type RustEntityDespawnReasonR6,
  type RustEntityVec3R6,
} from "./rust-entity-authority-contract-r6";
import {
  decodeRustEntityAuthoritySnapshotR6V2,
  decodeRustEntityCompatibilityRecordR6V1,
  encodeRustEntityCompatibilityRecordR6V1,
} from "./rust-entity-authority-codec-r6";
import { assertRustEntityAuthorityHashR6V2 } from "./rust-entity-authority-hash-r6";
import {
  RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1,
  rustIntegratedRuntimeDomainWireFamilyV1,
} from "./rust-integrated-runtime-domain-schema.generated";

const ENTITY_COMPATIBILITY_IMPORT_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1(
  "entity-compatibility-import-v1",
);
const ENTITY_EVENT_RECEIPT_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("entity-receipt-v1");
const ENTITY_AUTHORITY_EXPORT_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("entity-authority-export-v1");
const ENTITY_AUTHORITY_IMPORT_SCHEMA_V2 = rustIntegratedRuntimeDomainWireFamilyV1("entity-authority-import-v2");
const ENTITY_AUTHORITY_IMPORT_RECEIPT_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("entity-authority-import-receipt-v1");
const ENTITY_COMPATIBILITY_EXPORT_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("entity-compatibility-export-v1");
const ENTITY_COMMAND_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("entity-command-v1");
const ENTITY_COMPATIBILITY_RECORD_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("entity-compatibility-record-v1");

export const RUST_INTEGRATED_ENTITY_COMPATIBILITY_IMPORT_TYPE_V1 = ENTITY_COMPATIBILITY_IMPORT_SCHEMA_V1.typeId;
export const RUST_INTEGRATED_ENTITY_EVENT_RECEIPT_TYPE_V1 = ENTITY_EVENT_RECEIPT_SCHEMA_V1.typeId;
export const RUST_INTEGRATED_ENTITY_AUTHORITY_EXPORT_TYPE_V1 = ENTITY_AUTHORITY_EXPORT_SCHEMA_V1.typeId;
export const RUST_INTEGRATED_ENTITY_AUTHORITY_IMPORT_TYPE_V2 = ENTITY_AUTHORITY_IMPORT_SCHEMA_V2.typeId;
export const RUST_INTEGRATED_ENTITY_AUTHORITY_IMPORT_RECEIPT_TYPE_V1 = ENTITY_AUTHORITY_IMPORT_RECEIPT_SCHEMA_V1.typeId;
export const RUST_INTEGRATED_ENTITY_COMPATIBILITY_EXPORT_TYPE_V1 = ENTITY_COMPATIBILITY_EXPORT_SCHEMA_V1.typeId;
export const RUST_INTEGRATED_ENTITY_COMMAND_TYPE_V1 = ENTITY_COMMAND_SCHEMA_V1.typeId;

const DOMAIN_HEADER_BYTES_V1 = 28;
const MAX_ENTITY_EVENTS_V1 = 256;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const U32_MAX = 0xffff_ffff;

export type RustIntegratedEntityCompatibilityImportV1 = Readonly<{
  sequence: bigint;
  expectedRevision: bigint;
  tick: bigint;
  desiredEntityId: bigint | null;
  residency: RustEntityResidencyR6;
  record: RustEntityCompatibilityRecordR6;
}>;

export class RustIntegratedEntityWireErrorV1 extends Error {
  readonly name = "RustIntegratedEntityWireErrorV1";

  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedEntityWireErrorV1(code, message);
}

function unsigned64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0) || value > U64_MAX) {
    fail("entity-u64", `${label} is outside the u64 range`);
  }
  return value;
}

function entityId(value: bigint, label: string) {
  const checked = unsigned64(value, label);
  if (checked === BigInt(0)) fail("entity-id", `${label} uses the reserved zero identity`);
  return checked;
}

function checksumBytes(value: Uint8Array) {
  const checksum = rustIntegratedRuntimeWireChecksumV1(value);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(checksum.slice(index * 2, index * 2 + 2), 16));
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

type DomainPacketSchemaV1 = Readonly<{
  magic: string;
  innerSchema: number;
}>;

function domainMagicBytes(schema: DomainPacketSchemaV1) {
  return new TextEncoder().encode(schema.magic);
}

function wrapDomainPacket(schema: DomainPacketSchemaV1, body: Uint8Array) {
  if (body.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES - DOMAIN_HEADER_BYTES_V1) {
    fail("domain-size", "native domain body exceeds its byte budget");
  }
  const packet = new Uint8Array(DOMAIN_HEADER_BYTES_V1 + body.byteLength);
  const view = new DataView(packet.buffer);
  packet.set(domainMagicBytes(schema), 0);
  view.setUint16(4, RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1, true);
  view.setUint16(6, schema.innerSchema, true);
  view.setUint32(8, body.byteLength, true);
  packet.set(checksumBytes(body), 12);
  packet.set(body, DOMAIN_HEADER_BYTES_V1);
  return packet;
}

function unwrapDomainPacket(packet: Uint8Array, schema: DomainPacketSchemaV1) {
  if (!(packet instanceof Uint8Array)
    || packet.byteLength < DOMAIN_HEADER_BYTES_V1
    || packet.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES) {
    fail("domain-size", "native domain packet is outside its byte budget");
  }
  const magic = domainMagicBytes(schema);
  if (!magic.every((byte, index) => packet[index] === byte)) fail("domain-magic", "native domain packet magic mismatch");
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint16(4, true) !== RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1
    || view.getUint16(6, true) !== schema.innerSchema) {
    fail("domain-version", "native domain packet version is unsupported");
  }
  const length = view.getUint32(8, true);
  if (length !== packet.byteLength - DOMAIN_HEADER_BYTES_V1) fail("domain-length", "native domain packet length mismatch");
  const body = packet.subarray(DOMAIN_HEADER_BYTES_V1);
  if (!bytesEqual(packet.subarray(12, 28), checksumBytes(body))) fail("domain-checksum", "native domain packet checksum mismatch");
  return body;
}

class Writer {
  private readonly bytes: number[] = [];

  u8(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) fail("entity-integer", "u8 is outside its range");
    this.bytes.push(value);
  }

  u32(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > U32_MAX) fail("entity-integer", "u32 is outside its range");
    this.bytes.push(value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff);
  }

  u64(value: bigint) {
    let remaining = unsigned64(value, "u64");
    for (let index = 0; index < 8; index += 1) {
      this.bytes.push(Number(remaining & BigInt(0xff)));
      remaining >>= BigInt(8);
    }
  }

  raw(value: Uint8Array) {
    if (this.bytes.length + value.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES - DOMAIN_HEADER_BYTES_V1) {
      fail("domain-size", "native entity body exceeds its byte budget");
    }
    for (const byte of value) this.bytes.push(byte);
  }

  f32(value: number) {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) fail("entity-float", "f32 must be finite");
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    this.raw(bytes);
  }

  vec3(value: RustEntityVec3R6) {
    this.f32(value.x); this.f32(value.y); this.f32(value.z);
  }

  finish() {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  take(length: number) {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.bytes.byteLength) {
      fail("entity-truncated", "native entity payload is truncated");
    }
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  u8() {
    return this.take(1)[0];
  }

  u32() {
    const bytes = this.take(4);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  }

  u64() {
    const bytes = this.take(8);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, true);
  }

  f32() {
    const bytes = this.take(4);
    const value = new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0, true);
    if (!Number.isFinite(value)) fail("entity-float", "f32 must be finite");
    return value;
  }

  vec3(): RustEntityVec3R6 {
    return Object.freeze({ x: this.f32(), y: this.f32(), z: this.f32() });
  }

  blob() {
    const length = this.u32();
    if (length > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES) fail("domain-size", "entity blob exceeds byte budget");
    return Uint8Array.from(this.take(length));
  }

  /** BWE6 embeds the BWEC body without its six-byte magic/schema prefix. */
  compatibilityRecord() {
    const start = this.offset;
    const string = () => { const length = this.u32(); if (length > 4096) fail("entity-string", "entity string exceeds bound"); this.take(length); };
    const optional = (read: () => void) => { const tag = this.u8(); if (tag > 1) fail("entity-option", "entity option is not boolean"); if (tag === 1) read(); };
    string(); optional(() => { this.take(8); }); string(); string(); this.take(1);
    optional(string); optional(string); this.take(8 + 36 + 8 + 2); optional(string);
    this.take(1 + 4); string(); optional(string); optional(string); optional(string);
    for (let map = 0; map < 3; map += 1) {
      const count = this.u32();
      if (count > 256) fail("entity-map", "entity map exceeds bound");
      for (let index = 0; index < count; index += 1) { string(); if (map === 1) this.take(4); else string(); }
    }
    const body = this.bytes.subarray(start, this.offset);
    const packet = new Uint8Array(6 + body.byteLength);
    packet.set(domainMagicBytes(ENTITY_COMPATIBILITY_RECORD_SCHEMA_V1));
    new DataView(packet.buffer).setUint16(4, ENTITY_COMPATIBILITY_RECORD_SCHEMA_V1.innerSchema, true);
    packet.set(body, 6);
    const record = decodeRustEntityCompatibilityRecordR6V1(packet);
    validateInlineRecord(record);
    return record;
  }

  finish() {
    if (this.offset !== this.bytes.byteLength) fail("entity-trailing", "native entity payload has trailing bytes");
  }
}

function residencyTag(value: RustEntityResidencyR6) {
  if (value === "hot") return 0;
  if (value === "cold") return 1;
  return fail("entity-residency", "entity residency is unknown");
}

function residencyFromTag(value: number): RustEntityResidencyR6 {
  if (value === 0) return "hot";
  if (value === 1) return "cold";
  return fail("entity-residency", "entity residency tag is unknown");
}

export type RustIntegratedEntityAuthorityExportV1 = Readonly<{ expectedRevision: bigint }>;
export type RustIntegratedEntityAuthorityImportV2 = Readonly<{ expectedRevision: bigint; snapshot: Uint8Array }>;
export type RustIntegratedEntityAuthorityImportReceiptV1 = Readonly<{
  previousRevision: bigint; revision: bigint; entityCount: number; stateHash: string;
}>;
export type RustIntegratedEntityCompatibilityExportV1 = Readonly<{
  entityId: bigint; expectedEntityRevision: bigint;
}>;

export function encodeRustIntegratedEntityAuthorityExportV1(value: RustIntegratedEntityAuthorityExportV1) {
  const writer = new Writer(); writer.u64(value.expectedRevision);
  return wrapDomainPacket(ENTITY_AUTHORITY_EXPORT_SCHEMA_V1, writer.finish());
}

export function decodeRustIntegratedEntityAuthorityExportV1(packet: Uint8Array): RustIntegratedEntityAuthorityExportV1 {
  const reader = new Reader(unwrapDomainPacket(packet, ENTITY_AUTHORITY_EXPORT_SCHEMA_V1));
  const value = Object.freeze({ expectedRevision: reader.u64() }); reader.finish(); return value;
}

export function encodeRustIntegratedEntityAuthorityImportV2(value: RustIntegratedEntityAuthorityImportV2) {
  decodeRustEntityAuthoritySnapshotR6V2(value.snapshot);
  const writer = new Writer(); writer.u64(value.expectedRevision); writer.u32(value.snapshot.byteLength); writer.raw(value.snapshot);
  return wrapDomainPacket(ENTITY_AUTHORITY_IMPORT_SCHEMA_V2, writer.finish());
}

export function decodeRustIntegratedEntityAuthorityImportV2(packet: Uint8Array): RustIntegratedEntityAuthorityImportV2 {
  const reader = new Reader(unwrapDomainPacket(packet, ENTITY_AUTHORITY_IMPORT_SCHEMA_V2));
  const expectedRevision = reader.u64(); const snapshot = reader.blob(); reader.finish();
  decodeRustEntityAuthoritySnapshotR6V2(snapshot);
  return Object.freeze({ expectedRevision, snapshot });
}

/** Encoding preserves the native hash; use the attested decoder to verify its semantic value. */
export function encodeRustIntegratedEntityAuthorityImportReceiptV1(value: RustIntegratedEntityAuthorityImportReceiptV1) {
  if (!/^[0-9a-f]{32}$/u.test(value.stateHash)) fail("entity-hash", "authority hash is not canonical hexadecimal");
  const writer = new Writer(); writer.u64(value.previousRevision); writer.u64(value.revision); writer.u32(value.entityCount);
  writer.raw(Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.stateHash.slice(index * 2, index * 2 + 2), 16)));
  return wrapDomainPacket(ENTITY_AUTHORITY_IMPORT_RECEIPT_SCHEMA_V1, writer.finish());
}

export function decodeRustIntegratedEntityAuthorityImportReceiptV1(
  packet: Uint8Array,
  expectedImport?: RustIntegratedEntityAuthorityImportV2,
): RustIntegratedEntityAuthorityImportReceiptV1 {
  const reader = new Reader(unwrapDomainPacket(packet, ENTITY_AUTHORITY_IMPORT_RECEIPT_SCHEMA_V1));
  const previousRevision = reader.u64(); const revision = reader.u64(); const entityCount = reader.u32();
  const stateHash = [...reader.take(16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  reader.finish();
  if (expectedImport) {
    const snapshot = decodeRustEntityAuthoritySnapshotR6V2(expectedImport.snapshot);
    if (previousRevision !== expectedImport.expectedRevision || revision !== snapshot.revision
      || entityCount !== snapshot.hot.length + snapshot.cold.length) {
      fail("entity-receipt", "entity import receipt does not attest the requested revision and count");
    }
    assertRustEntityAuthorityHashR6V2(snapshot, stateHash);
  }
  return Object.freeze({ previousRevision, revision, entityCount, stateHash });
}

/** Attest the ordered BWU6 operation and independently recompute its claimed resulting state hash. */
export function validateRustIntegratedEntityAuthorityImportReceiptV1(
  operation: RustIntegratedRuntimeDomainOperationV1,
  request: RustIntegratedEntityAuthorityImportV2,
) {
  if (operation.domain !== "entities" || operation.typeId !== ENTITY_AUTHORITY_IMPORT_RECEIPT_SCHEMA_V1.typeId
    || operation.schema !== ENTITY_AUTHORITY_IMPORT_RECEIPT_SCHEMA_V1.operationSchema
    || operation.payloadHash !== rustIntegratedRuntimeWireChecksumV1(operation.payload)) {
    fail("entity-receipt", "entity import returned the wrong receipt type or payload hash");
  }
  return decodeRustIntegratedEntityAuthorityImportReceiptV1(operation.payload, request);
}

export function encodeRustIntegratedEntityCompatibilityExportV1(value: RustIntegratedEntityCompatibilityExportV1) {
  const writer = new Writer(); writer.u64(entityId(value.entityId, "entity id")); writer.u64(value.expectedEntityRevision);
  return wrapDomainPacket(ENTITY_COMPATIBILITY_EXPORT_SCHEMA_V1, writer.finish());
}

export function decodeRustIntegratedEntityCompatibilityExportV1(packet: Uint8Array): RustIntegratedEntityCompatibilityExportV1 {
  const reader = new Reader(unwrapDomainPacket(packet, ENTITY_COMPATIBILITY_EXPORT_SCHEMA_V1));
  const value = Object.freeze({ entityId: entityId(reader.u64(), "entity id"), expectedEntityRevision: reader.u64() });
  reader.finish(); return value;
}

const COMPONENT_COMMANDS = [
  "set-vitals-environment", "set-locomotion-body", "set-ai-state", "set-social-state", "set-mount-state",
  "set-protection-provenance", "set-network-authority", "set-care-state", "set-husbandry-state", "set-work-state",
  "set-equipment", "set-dragon-state", "set-legendary-state", "set-summon-state", "set-sentient-state", "replace-components",
] as const;

/** Typed commands retain their validated native BWEA projection. This avoids re-authoring
 * Rust's projection shell or treating a wire decode as an authority-state transition. */
export type RustIntegratedEntityCommandWireV1 =
  | Readonly<{ type: "spawn"; record: RustEntityCompatibilityRecordR6; residency: RustEntityResidencyR6 }>
  | Readonly<{ type: "spawn-at"; entityId: bigint; record: RustEntityCompatibilityRecordR6; residency: RustEntityResidencyR6 }>
  | Readonly<{ type: "despawn"; entityId: bigint; reason: RustEntityDespawnReasonR6 }>
  | Readonly<{ type: "hibernate"; entityId: bigint }>
  | Readonly<{ type: "wake" | "set-simulation-tier"; entityId: bigint; tier: RustEntitySimulationTierR6 }>
  | Readonly<{ type: "update-motion"; entityId: bigint; position: RustEntityVec3R6; yaw: number; velocity: RustEntityVec3R6 }>
  | Readonly<{ type: "set-protection"; entityId: bigint; protection: bigint }>
  | Readonly<{ type: "spawn-typed"; record: RustEntityCompatibilityRecordR6; componentsSnapshot: Uint8Array; residency: RustEntityResidencyR6 }>
  | Readonly<{ type: "spawn-typed-at"; entityId: bigint; record: RustEntityCompatibilityRecordR6; componentsSnapshot: Uint8Array; residency: RustEntityResidencyR6 }>
  | Readonly<{ type: typeof COMPONENT_COMMANDS[number]; entityId: bigint; componentsSnapshot: Uint8Array }>
  | Readonly<{ type: "replace-compatibility-record"; entityId: bigint; record: RustEntityCompatibilityRecordR6 }>
  | Readonly<{ type: "set-range-state"; entityId: bigint; outOfRangeSeconds: number; lastSimulatedTick: bigint }>
  | Readonly<{ type: "set-dormant-summary"; entityId: bigint; dormantSnapshot: Uint8Array }>;

export type RustIntegratedEntityCommandBatchWireV1 = Readonly<{
  schema: 1; sequence: bigint; expectedRevision: bigint; tick: bigint; commands: readonly RustIntegratedEntityCommandWireV1[];
}>;

function projection(bytes: Uint8Array, cold: boolean) {
  const snapshot = decodeRustEntityAuthoritySnapshotR6V2(bytes);
  if (cold ? snapshot.cold.length !== 1 || snapshot.hot.length !== 0 : snapshot.hot.length !== 1 || snapshot.cold.length !== 0) {
    fail("entity-projection", `entity projection must contain exactly one ${cold ? "cold" : "hot"} resident`);
  }
  return bytes;
}

function writeProjection(writer: Writer, bytes: Uint8Array, cold = false) {
  projection(bytes, cold); writer.u32(bytes.byteLength); writer.raw(bytes);
}

function writeInlineRecord(writer: Writer, value: RustEntityCompatibilityRecordR6) {
  validateInlineRecord(value);
  writer.raw(encodeRustEntityCompatibilityRecordR6V1(value).subarray(6));
}

function validateInlineRecord(value: RustEntityCompatibilityRecordR6) {
  // The integrated BWE6 string contract is stricter than the raw BWEC save codec.
  const strings = [value.externalEntityId, value.specimenId, value.kindKey, value.bondTier,
    value.variantKey, value.name, value.ownerId, value.socialGroupId, value.factionId, value.settlementId,
    ...value.equipment.flatMap(([key, item]) => [key, item]),
    ...value.research.map(([key]) => key), ...value.custom.flatMap(([key, item]) => [key, item])];
  if (strings.some((text) => text !== null && (text.length === 0 || /\p{Cc}/u.test(text)))) {
    fail("entity-string", "integrated entity strings must be nonempty and contain no controls");
  }
  const floats = [value.position.x, value.position.y, value.position.z, value.yaw,
    value.velocity.x, value.velocity.y, value.velocity.z, value.health, value.maximumHealth];
  if (floats.some((number) => !Number.isFinite(Math.fround(number)))) fail("entity-float", "entity transform and vitals must fit finite f32");
}

function writeCommand(writer: Writer, value: RustIntegratedEntityCommandWireV1) {
  const componentTag = COMPONENT_COMMANDS.indexOf(value.type as typeof COMPONENT_COMMANDS[number]);
  if (componentTag >= 0 && "componentsSnapshot" in value && "entityId" in value) {
    writer.u8(componentTag + 10); writer.u64(entityId(value.entityId, "command entity id")); writeProjection(writer, value.componentsSnapshot); return;
  }
  switch (value.type) {
    case "spawn": writer.u8(0); writeInlineRecord(writer, value.record); writer.u8(residencyTag(value.residency)); return;
    case "spawn-at": writer.u8(1); writer.u64(entityId(value.entityId, "command entity id")); writeInlineRecord(writer, value.record); writer.u8(residencyTag(value.residency)); return;
    case "despawn": {
      const tag = DESPAWN_REASONS.indexOf(value.reason); if (tag < 0) fail("entity-command", "unknown despawn reason");
      writer.u8(2); writer.u64(entityId(value.entityId, "command entity id")); writer.u8(tag); return;
    }
    case "hibernate": writer.u8(3); writer.u64(entityId(value.entityId, "command entity id")); return;
    case "wake": case "set-simulation-tier": {
      const tag = SIMULATION_TIERS.indexOf(value.tier); if (tag < 0) fail("entity-command", "unknown simulation tier");
      writer.u8(value.type === "wake" ? 4 : 6); writer.u64(entityId(value.entityId, "command entity id")); writer.u8(tag); return;
    }
    case "update-motion": writer.u8(5); writer.u64(entityId(value.entityId, "command entity id")); writer.vec3(value.position); writer.f32(value.yaw); writer.vec3(value.velocity); return;
    case "set-protection": writer.u8(7); writer.u64(entityId(value.entityId, "command entity id")); writer.u64(value.protection); return;
    case "spawn-typed": writer.u8(8); writeInlineRecord(writer, value.record); writeProjection(writer, value.componentsSnapshot); writer.u8(residencyTag(value.residency)); return;
    case "spawn-typed-at": writer.u8(9); writer.u64(entityId(value.entityId, "command entity id")); writeInlineRecord(writer, value.record); writeProjection(writer, value.componentsSnapshot); writer.u8(residencyTag(value.residency)); return;
    case "replace-compatibility-record": writer.u8(26); writer.u64(entityId(value.entityId, "command entity id")); writeInlineRecord(writer, value.record); return;
    case "set-range-state": writer.u8(27); writer.u64(entityId(value.entityId, "command entity id")); writer.f32(value.outOfRangeSeconds); writer.u64(value.lastSimulatedTick); return;
    case "set-dormant-summary": writer.u8(28); writer.u64(entityId(value.entityId, "command entity id")); writeProjection(writer, value.dormantSnapshot, true); return;
    default: fail("entity-command", "unknown entity command");
  }
}

function readCommand(reader: Reader): RustIntegratedEntityCommandWireV1 {
  const tag = reader.u8();
  if (tag > 28) fail("entity-command", "unknown entity command tag");
  if (tag === 0) return Object.freeze({ type: "spawn", record: reader.compatibilityRecord(), residency: residencyFromTag(reader.u8()) });
  if (tag === 8) return Object.freeze({ type: "spawn-typed", record: reader.compatibilityRecord(), componentsSnapshot: projection(reader.blob(), false), residency: residencyFromTag(reader.u8()) });
  const id = entityId(reader.u64(), "command entity id");
  if (tag >= 10 && tag <= 25) return Object.freeze({ type: COMPONENT_COMMANDS[tag - 10], entityId: id, componentsSnapshot: projection(reader.blob(), false) });
  switch (tag) {
    case 1: return Object.freeze({ type: "spawn-at", entityId: id, record: reader.compatibilityRecord(), residency: residencyFromTag(reader.u8()) });
    case 2: { const reason = DESPAWN_REASONS[reader.u8()]; if (!reason) fail("entity-command", "unknown despawn reason"); return Object.freeze({ type: "despawn", entityId: id, reason }); }
    case 3: return Object.freeze({ type: "hibernate", entityId: id });
    case 4: case 6: { const tier = SIMULATION_TIERS[reader.u8()]; if (!tier) fail("entity-command", "unknown simulation tier"); return Object.freeze({ type: tag === 4 ? "wake" : "set-simulation-tier", entityId: id, tier }); }
    case 5: return Object.freeze({ type: "update-motion", entityId: id, position: reader.vec3(), yaw: reader.f32(), velocity: reader.vec3() });
    case 7: return Object.freeze({ type: "set-protection", entityId: id, protection: reader.u64() });
    case 9: return Object.freeze({ type: "spawn-typed-at", entityId: id, record: reader.compatibilityRecord(), componentsSnapshot: projection(reader.blob(), false), residency: residencyFromTag(reader.u8()) });
    case 26: return Object.freeze({ type: "replace-compatibility-record", entityId: id, record: reader.compatibilityRecord() });
    case 27: return Object.freeze({ type: "set-range-state", entityId: id, outOfRangeSeconds: reader.f32(), lastSimulatedTick: reader.u64() });
    case 28: return Object.freeze({ type: "set-dormant-summary", entityId: id, dormantSnapshot: projection(reader.blob(), true) });
    default: return fail("entity-command", "unknown entity command tag");
  }
}

export function encodeRustIntegratedEntityCommandBatchV1(value: RustIntegratedEntityCommandBatchWireV1) {
  if (value.schema !== ENTITY_COMMAND_SCHEMA_V1.innerSchema || value.commands.length > 256) fail("entity-command", "entity command batch exceeds schema or count bounds");
  const writer = new Writer(); writer.u64(value.sequence); writer.u64(value.expectedRevision); writer.u64(value.tick); writer.u32(value.commands.length);
  for (const command of value.commands) writeCommand(writer, command);
  return wrapDomainPacket(ENTITY_COMMAND_SCHEMA_V1, writer.finish());
}

export function decodeRustIntegratedEntityCommandBatchV1(packet: Uint8Array): RustIntegratedEntityCommandBatchWireV1 {
  const reader = new Reader(unwrapDomainPacket(packet, ENTITY_COMMAND_SCHEMA_V1));
  const sequence = reader.u64(); const expectedRevision = reader.u64(); const tick = reader.u64(); const count = reader.u32();
  if (count > 256) fail("entity-command", "entity command count exceeds bound");
  const commands = Object.freeze(Array.from({ length: count }, () => readCommand(reader))); reader.finish();
  return Object.freeze({ schema: 1, sequence, expectedRevision, tick, commands });
}

/** Exact TypeScript mirror of the native BWI5 compatibility-import codec. */
export function encodeRustIntegratedEntityCompatibilityImportV1(value: RustIntegratedEntityCompatibilityImportV1) {
  unsigned64(value.sequence, "entity sequence");
  unsigned64(value.expectedRevision, "entity revision");
  unsigned64(value.tick, "entity tick");
  if (value.desiredEntityId !== null) entityId(value.desiredEntityId, "desired entity id");
  const record = encodeRustEntityCompatibilityRecordR6V1(value.record);
  const writer = new Writer();
  writer.u64(value.sequence);
  writer.u64(value.expectedRevision);
  writer.u64(value.tick);
  writer.u8(value.desiredEntityId === null ? 0 : 1);
  if (value.desiredEntityId !== null) writer.u64(value.desiredEntityId);
  writer.u8(residencyTag(value.residency));
  writer.u32(record.byteLength);
  writer.raw(record);
  return wrapDomainPacket(ENTITY_COMPATIBILITY_IMPORT_SCHEMA_V1, writer.finish());
}

export function decodeRustIntegratedEntityCompatibilityImportV1(packet: Uint8Array): RustIntegratedEntityCompatibilityImportV1 {
  const reader = new Reader(unwrapDomainPacket(packet, ENTITY_COMPATIBILITY_IMPORT_SCHEMA_V1));
  const sequence = reader.u64();
  const expectedRevision = reader.u64();
  const tick = reader.u64();
  const desiredTag = reader.u8();
  if (desiredTag > 1) fail("entity-id", "desired entity id option tag is not boolean");
  const desiredEntityId = desiredTag === 1 ? entityId(reader.u64(), "desired entity id") : null;
  const residency = residencyFromTag(reader.u8());
  const recordLength = reader.u32();
  const record = decodeRustEntityCompatibilityRecordR6V1(reader.take(recordLength));
  reader.finish();
  return Object.freeze({ sequence, expectedRevision, tick, desiredEntityId, residency, record });
}

const SIMPLE_EVENT_TAGS = Object.freeze([
  "motion-updated",
  "protection-changed",
  "vitals-environment-changed",
  "locomotion-changed",
  "ai-changed",
  "social-changed",
  "mount-changed",
  "network-authority-changed",
  "care-changed",
  "husbandry-changed",
  "work-changed",
  "equipment-changed",
  "dragon-changed",
  "legendary-changed",
  "summon-changed",
  "sentient-changed",
  "components-replaced",
  "compatibility-record-changed",
  "range-state-changed",
  "dormant-summary-changed",
] as const);

const SIMPLE_EVENT_WIRE_TAG = Object.freeze(new Map<string, number>([
  ["motion-updated", 3],
  ["protection-changed", 5],
  ["vitals-environment-changed", 6],
  ["locomotion-changed", 7],
  ["ai-changed", 8],
  ["social-changed", 9],
  ["mount-changed", 10],
  ["network-authority-changed", 11],
  ["care-changed", 12],
  ["husbandry-changed", 13],
  ["work-changed", 14],
  ["equipment-changed", 15],
  ["dragon-changed", 16],
  ["legendary-changed", 17],
  ["summon-changed", 18],
  ["sentient-changed", 19],
  ["components-replaced", 20],
  ["compatibility-record-changed", 21],
  ["range-state-changed", 22],
  ["dormant-summary-changed", 23],
]));

const DESPAWN_REASONS = ["natural-range", "defeated", "captured", "released", "admin"] as const;
const SIMULATION_TIERS = ["hero", "nearby", "coarse", "dormant"] as const;

function writeEventKind(writer: Writer, kind: RustEntityEventKindR6) {
  if (kind.type === "spawned") {
    writer.u8(0);
    writer.u8(residencyTag(kind.residency));
  } else if (kind.type === "despawned") {
    const reason = DESPAWN_REASONS.indexOf(kind.reason);
    if (reason < 0) fail("entity-event", "entity despawn reason is unknown");
    writer.u8(1);
    writer.u8(reason);
  } else if (kind.type === "residency-changed") {
    writer.u8(2);
    writer.u8(residencyTag(kind.residency));
  } else if (kind.type === "tier-changed") {
    const tier = SIMULATION_TIERS.indexOf(kind.tier);
    if (tier < 0) fail("entity-event", "entity simulation tier is unknown");
    writer.u8(4);
    writer.u8(tier);
  } else {
    const tag = SIMPLE_EVENT_WIRE_TAG.get(kind.type);
    if (tag === undefined) fail("entity-event", "entity event kind is unknown");
    writer.u8(tag);
  }
}

function readEventKind(reader: Reader): RustEntityEventKindR6 {
  const tag = reader.u8();
  if (tag === 0) return Object.freeze({ type: "spawned", residency: residencyFromTag(reader.u8()) });
  if (tag === 1) {
    const reason = DESPAWN_REASONS[reader.u8()];
    if (!reason) fail("entity-event", "entity despawn reason tag is unknown");
    return Object.freeze({ type: "despawned", reason });
  }
  if (tag === 2) return Object.freeze({ type: "residency-changed", residency: residencyFromTag(reader.u8()) });
  if (tag === 4) {
    const tier = SIMULATION_TIERS[reader.u8()];
    if (!tier) fail("entity-event", "entity simulation tier tag is unknown");
    return Object.freeze({ type: "tier-changed", tier });
  }
  const type = SIMPLE_EVENT_TAGS.find((candidate) => SIMPLE_EVENT_WIRE_TAG.get(candidate) === tag);
  if (!type) fail("entity-event", "entity event tag is unknown");
  return Object.freeze({ type });
}

export function encodeRustIntegratedEntityEventBatchReceiptV1(value: RustEntityEventBatchR6) {
  if (value.schema !== 1 || value.events.length > MAX_ENTITY_EVENTS_V1) fail("entity-event", "entity event batch is invalid");
  unsigned64(value.sequence, "event sequence");
  unsigned64(value.previousRevision, "previous entity revision");
  unsigned64(value.revision, "entity revision");
  if (value.revision !== ((value.previousRevision + BigInt(1)) & U64_MAX)) {
    fail("entity-event", "entity event authority revision is discontinuous");
  }
  const writer = new Writer();
  writer.u64(value.sequence);
  writer.u64(value.previousRevision);
  writer.u64(value.revision);
  writer.u32(value.events.length);
  for (const event of value.events) {
    writer.u32(event.commandIndex);
    writer.u64(entityId(event.entityId, "event entity id"));
    writer.u64(event.previousEntityRevision);
    writer.u64(event.entityRevision);
    writeEventKind(writer, event.kind);
  }
  return wrapDomainPacket(ENTITY_EVENT_RECEIPT_SCHEMA_V1, writer.finish());
}

export function decodeRustIntegratedEntityEventBatchReceiptV1(packet: Uint8Array): RustEntityEventBatchR6 {
  const reader = new Reader(unwrapDomainPacket(packet, ENTITY_EVENT_RECEIPT_SCHEMA_V1));
  const sequence = reader.u64();
  const previousRevision = reader.u64();
  const revision = reader.u64();
  if (revision !== ((previousRevision + BigInt(1)) & U64_MAX)) fail("entity-event", "entity event authority revision is discontinuous");
  const count = reader.u32();
  if (count > MAX_ENTITY_EVENTS_V1) fail("entity-event", "entity event count exceeds its bound");
  const events = Object.freeze(Array.from({ length: count }, () => Object.freeze({
    commandIndex: reader.u32(),
    entityId: entityId(reader.u64(), "event entity id"),
    previousEntityRevision: reader.u64(),
    entityRevision: reader.u64(),
    kind: readEventKind(reader),
  })));
  reader.finish();
  return Object.freeze({ schema: 1 as const, sequence, previousRevision, revision, events });
}

/** Validates the exact BWA6 spawn receipt returned for one BWI5 operation. */
export function validateRustIntegratedEntityCompatibilityImportReceiptV1(
  operation: RustIntegratedRuntimeDomainOperationV1,
  request: RustIntegratedEntityCompatibilityImportV1,
) {
  if (operation.domain !== "entities"
    || operation.typeId !== RUST_INTEGRATED_ENTITY_EVENT_RECEIPT_TYPE_V1
    || operation.schema !== ENTITY_EVENT_RECEIPT_SCHEMA_V1.operationSchema
    || operation.payloadHash !== rustIntegratedRuntimeWireChecksumV1(operation.payload)) {
    fail("entity-receipt", "BWI5 returned the wrong ordered native receipt type or payload hash");
  }
  const receipt = decodeRustIntegratedEntityEventBatchReceiptV1(operation.payload);
  const event = receipt.events[0];
  if (receipt.sequence !== request.sequence
    || receipt.previousRevision !== request.expectedRevision
    || receipt.events.length !== 1
    || !event
    || event.commandIndex !== 0
    || event.previousEntityRevision !== BigInt(0)
    || event.entityRevision !== BigInt(1)
    || event.kind.type !== "spawned"
    || event.kind.residency !== request.residency
    || (request.desiredEntityId !== null && event.entityId !== request.desiredEntityId)) {
    fail("entity-receipt", "BWI5 spawn receipt does not attest the requested entity transaction");
  }
  return Object.freeze({ receipt, entityId: event.entityId });
}
