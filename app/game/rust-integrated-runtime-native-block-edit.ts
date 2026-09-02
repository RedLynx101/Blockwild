import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow.ts";
import { isDirectionallyPlacedBlock } from "./block-facing.ts";
import type { BlockId } from "./data.ts";
import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec.ts";
import {
  RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES,
  rustIntegratedRuntimeIdentityEqualsV1,
  type RustIntegratedRuntimeCommandBatchV1,
  type RustIntegratedRuntimeCommandReceiptV1,
  type RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract.ts";
import {
  RustIntegratedPlayerInventoryReaderV1,
  RustIntegratedPlayerInventoryWriterV1,
  readRustIntegratedContainerKeyV1,
  readRustIntegratedPlayerInventoryStackV1,
  writeRustIntegratedContainerKeyV1,
  writeRustIntegratedPlayerInventoryStackV1,
  type RustIntegratedContainerKeyV1,
  type RustIntegratedPlayerInventoryStackV1,
} from "./rust-integrated-runtime-player-inventory.ts";
import {
  rustIntegratedRuntimeBasicDirtExpectedDropTransformV1,
  rustIntegratedRuntimeBasicDirtGeneratedDropProvenanceHashV1,
  type RustIntegratedRuntimeBasicDirtCellV1,
  type RustIntegratedRuntimeBasicDirtFixedVectorV1,
  type RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1,
  type RustIntegratedRuntimeBasicDirtRotationV1,
  type RustIntegratedRuntimeBasicDirtWorldRevisionV1,
} from "./rust-integrated-runtime-basic-dirt-action.ts";
import {
  WORLD_CHUNK_SIZE_V1,
  WORLD_MIN_Y_V1,
  WORLD_SECTION_COUNT_V1,
  WORLD_SECTION_HEIGHT_V1,
  worldSectionAddressKeyV1,
  type WorldSectionAddressV1,
} from "./world-authority-contract.ts";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated.ts";

export const RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_V1 = "native-block-edit-receipt-v1";
export const RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_V2 = "native-block-edit-receipt-v2";
const QUERY_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("native-block-edit-receipt-v1");
const RECEIPT_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("native-block-edit-projection-receipt-v1");
const QUERY_SCHEMA_V2 = rustIntegratedRuntimeDomainWireFamilyV1("native-block-edit-receipt-v2");
const RECEIPT_SCHEMA_V2 = rustIntegratedRuntimeDomainWireFamilyV1("native-block-edit-projection-receipt-v2");

export const RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1 = QUERY_SCHEMA_V1.typeId;
export const RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1 = RECEIPT_SCHEMA_V1.typeId;
export const RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2 = QUERY_SCHEMA_V2.typeId;
export const RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V2 = RECEIPT_SCHEMA_V2.typeId;
export const RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1 = Number.MAX_SAFE_INTEGER;

const QUERY_MAGIC = new TextEncoder().encode(QUERY_SCHEMA_V1.magic);
const RECEIPT_MAGIC = new TextEncoder().encode(RECEIPT_SCHEMA_V1.magic);
const QUERY_MAGIC_V2 = new TextEncoder().encode(QUERY_SCHEMA_V2.magic);
const RECEIPT_MAGIC_V2 = new TextEncoder().encode(RECEIPT_SCHEMA_V2.magic);
const HEADER_BYTES = 28;
const MAX_SAFE_U64 = Number.MAX_SAFE_INTEGER;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const I64_MIN = -(BigInt(1) << BigInt(63));
const I64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);
const MAX_ITEM_STACK = 0x7fff_ffff;
const MAX_GENERATED_DROPS = 32;
const WORLD_MIN_Y = -64;
const WORLD_MAX_Y = 127;
const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const ZERO_HASH = "0".repeat(32);
const encoder = new TextEncoder();

export const RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2 = Object.freeze([
  "lighting",
  "liquids",
  "topology",
  "meshing",
  "navigation",
  "maps",
  "persistence",
] as const);
export type RustIntegratedRuntimeNativeBlockEditDirtySubsystemV2 =
  typeof RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2[number];

export type RustIntegratedRuntimeNativeBlockEditActionKindV1 = "mine" | "place";
export type RustIntegratedRuntimeNativeBlockEditContentBindingV1 = Readonly<{
  blockId: number;
  manifestHash: string;
  installedRegistryHash: string;
  catalogSchemaVersion: number;
  catalogContentVersion: number;
  catalogBlobHash: string;
  actionReportHash: string;
  subsetHash: string;
}>;
export type RustIntegratedRuntimeNativeBlockEditInventoryDeltaV1 = Readonly<{
  container: RustIntegratedContainerKeyV1;
  selectedSlot: number;
  beforeRevision: bigint;
  afterRevision: bigint;
  beforeStack: RustIntegratedPlayerInventoryStackV1 | null;
  afterStack: RustIntegratedPlayerInventoryStackV1 | null;
}>;
export type RustIntegratedRuntimeNativeBlockEditGeneratedDropV1 = Readonly<{
  provenance: RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1;
  entityId: bigint;
  stack: RustIntegratedPlayerInventoryStackV1;
  position: RustIntegratedRuntimeBasicDirtFixedVectorV1;
  velocityMilliPerSecond: RustIntegratedRuntimeBasicDirtFixedVectorV1;
  rotation: RustIntegratedRuntimeBasicDirtRotationV1;
}>;
export type RustIntegratedRuntimeNativeBlockEditReceiptV1 = Readonly<{
  schema: 1;
  sequence: number;
  originInputSequence: number;
  completionTick: number;
  action: RustIntegratedRuntimeNativeBlockEditActionKindV1;
  position: RustIntegratedRuntimeBasicDirtCellV1;
  priorBlockId: number;
  priorFacing: number;
  replacementBlockId: number;
  replacementFacing: number;
  beforeWorldRevision: RustIntegratedRuntimeBasicDirtWorldRevisionV1;
  afterWorldRevision: RustIntegratedRuntimeBasicDirtWorldRevisionV1;
  beforeWorldHash: string;
  afterWorldHash: string;
  creativeMode: boolean;
  inventory: RustIntegratedRuntimeNativeBlockEditInventoryDeltaV1;
  generatedDrops: readonly RustIntegratedRuntimeNativeBlockEditGeneratedDropV1[];
  content: RustIntegratedRuntimeNativeBlockEditContentBindingV1;
  receiptHash: string;
}>;
export type RustIntegratedRuntimeNativeBlockEditQueryV1 = Readonly<{
  expected: RustIntegratedRuntimeIdentityV1;
  afterSequence: number;
}>;
export type RustIntegratedRuntimeNativeBlockEditProjectionReceiptV1 = Readonly<{
  requestPayloadHash: string;
  identity: RustIntegratedRuntimeIdentityV1;
  cursorAfter: number;
  receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1 | null;
}>;
export type RustIntegratedRuntimeNativeBlockEditObservedReceiptV1 =
  RustIntegratedRuntimeNativeBlockEditProjectionReceiptV1 & Readonly<{ projectionPayloadHash: string }>;
export type RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2 = Readonly<{
  schema: 1;
  sequence: number;
  receiptHash: string;
  sections: readonly WorldSectionAddressV1[];
  columns: readonly Readonly<{ x: number; z: number }>[];
  subsystemSeeds: readonly Readonly<{
    subsystem: RustIntegratedRuntimeNativeBlockEditDirtySubsystemV2;
    seed: string;
  }>[];
  evidenceHash: string;
}>;
export type RustIntegratedRuntimeNativeBlockEditProjectionReceiptV2 = Readonly<{
  requestPayloadHash: string;
  identity: RustIntegratedRuntimeIdentityV1;
  cursorAfter: number;
  receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1 | null;
  dirtyEvidence: RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2 | null;
}>;
export type RustIntegratedRuntimeNativeBlockEditObservedReceiptV2 =
  RustIntegratedRuntimeNativeBlockEditProjectionReceiptV2 & Readonly<{ projectionPayloadHash: string }>;

export interface RustIntegratedRuntimeNativeBlockEditServiceV1 {
  identity(): RustIntegratedRuntimeIdentityV1;
  command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1>;
}

export class RustIntegratedRuntimeNativeBlockEditErrorV1 extends Error {
  readonly name = "RustIntegratedRuntimeNativeBlockEditErrorV1";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedRuntimeNativeBlockEditErrorV1(code, message);
}
function integer(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("native-block-edit-integer", `${label} is outside its exact integer range`);
  }
  return value;
}
function u64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0) || value > U64_MAX) {
    fail("native-block-edit-u64", `${label} is outside the u64 range`);
  }
  return value;
}
function i64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < I64_MIN || value > I64_MAX) {
    fail("native-block-edit-i64", `${label} is outside the i64 range`);
  }
  return value;
}
function safeNumber(value: bigint, label: string, minimum = 0) {
  if (value > BigInt(MAX_SAFE_U64)) fail("native-block-edit-u64", `${label} exceeds JavaScript's exact range`);
  return integer(Number(value), minimum, MAX_SAFE_U64, label);
}
function hash(value: string, label: string, allowZero = true) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value) || !allowZero && value === ZERO_HASH) {
    fail("native-block-edit-hash", `${label} is not a canonical${allowZero ? "" : " non-zero"} hash`);
  }
  return value;
}
function hashBytes(value: string, label: string, allowZero = true) {
  hash(value, label, allowZero);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}
function bytesHash(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function sameStack(
  left: RustIntegratedPlayerInventoryStackV1 | null,
  right: RustIntegratedPlayerInventoryStackV1 | null,
) {
  return left === null || right === null
    ? left === right
    : left.itemCode === right.itemCode && left.count === right.count
      && left.durabilityMillionths === right.durabilityMillionths && left.metadataHash === right.metadataHash;
}
function stack(value: RustIntegratedPlayerInventoryStackV1, label: string) {
  integer(value.itemCode, 1, 0xffff_ffff, `${label} item`);
  integer(value.count, 1, MAX_ITEM_STACK, `${label} count`);
  if (value.durabilityMillionths !== null) integer(value.durabilityMillionths, 0, 1_000_000, `${label} durability`);
  hash(value.metadataHash, `${label} metadata`);
}
function writeI32(writer: RustIntegratedPlayerInventoryWriterV1, value: number) {
  integer(value, -0x8000_0000, 0x7fff_ffff, "cell coordinate");
  const bytes = new Uint8Array(4); new DataView(bytes.buffer).setInt32(0, value, true); writer.raw(bytes);
}
function readI32(reader: RustIntegratedPlayerInventoryReaderV1) {
  const bytes = reader.take(4); return new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, true);
}
function writeI16(writer: RustIntegratedPlayerInventoryWriterV1, value: number) {
  integer(value, -0x8000, 0x7fff, "signed 16-bit value");
  const bytes = new Uint8Array(2); new DataView(bytes.buffer).setInt16(0, value, true); writer.raw(bytes);
}
function readI16(reader: RustIntegratedPlayerInventoryReaderV1) {
  const bytes = reader.take(2); return new DataView(bytes.buffer, bytes.byteOffset, 2).getInt16(0, true);
}
function writeI64(writer: RustIntegratedPlayerInventoryWriterV1, value: bigint) {
  i64(value, "fixed-point component"); const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true); writer.raw(bytes);
}
function readI64(reader: RustIntegratedPlayerInventoryReaderV1) {
  const bytes = reader.take(8); return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true);
}
function writeIdentity(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedRuntimeIdentityV1) {
  writer.u16(2); writer.string(value.universeId, "native block edit universe");
  writer.string(value.locationId, "native block edit location");
  for (const revision of [
    value.revision.epoch, value.revision.world, value.revision.entities, value.revision.gameplay,
    value.revision.persistence, value.revision.network, value.revision.simulation,
  ]) writer.u64(BigInt(integer(revision, 0, MAX_SAFE_U64, "runtime revision")));
  writer.u64(BigInt(integer(value.tick, 0, MAX_SAFE_U64, "runtime tick")));
  writer.raw(hashBytes(value.stateHash, "runtime state hash"));
}
function readIdentity(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedRuntimeIdentityV1 {
  if (reader.u16() !== 2) fail("native-block-edit-identity", "runtime identity schema is not V2");
  return Object.freeze({
    universeId: reader.string("native block edit universe"), locationId: reader.string("native block edit location"),
    revision: Object.freeze({
      epoch: safeNumber(reader.u64(), "epoch"), world: safeNumber(reader.u64(), "world revision"),
      entities: safeNumber(reader.u64(), "entity revision"), gameplay: safeNumber(reader.u64(), "gameplay revision"),
      persistence: safeNumber(reader.u64(), "persistence revision"), network: safeNumber(reader.u64(), "network revision"),
      simulation: safeNumber(reader.u64(), "simulation revision"),
    }), tick: safeNumber(reader.u64(), "runtime tick"), stateHash: bytesHash(reader.take(16)),
  });
}
function wrap(magic: Uint8Array, schema: number, body: Uint8Array) {
  if (body.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES - HEADER_BYTES) {
    fail("native-block-edit-size", "native block edit packet exceeds the gameplay domain ceiling");
  }
  const output = new Uint8Array(HEADER_BYTES + body.byteLength); const view = new DataView(output.buffer);
  output.set(magic); view.setUint16(4, 1, true); view.setUint16(6, schema, true);
  view.setUint32(8, body.byteLength, true); output.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(body), "checksum"), 12);
  output.set(body, HEADER_BYTES); return output;
}
function unwrap(packet: Uint8Array, magic: Uint8Array, schema: number) {
  if (!(packet instanceof Uint8Array) || packet.byteLength < HEADER_BYTES
    || packet.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES
    || !magic.every((byte, index) => packet[index] === byte)) {
    fail("native-block-edit-header", "native block edit packet header is malformed");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== schema
    || view.getUint32(8, true) !== packet.byteLength - HEADER_BYTES) {
    fail("native-block-edit-header", "native block edit packet version or length is invalid");
  }
  const body = packet.subarray(HEADER_BYTES);
  if (bytesHash(packet.subarray(12, HEADER_BYTES)) !== rustIntegratedRuntimeWireChecksumV1(body)) {
    fail("native-block-edit-checksum", "native block edit packet checksum is invalid");
  }
  return body;
}
function actionTag(value: RustIntegratedRuntimeNativeBlockEditActionKindV1) {
  if (value === "mine") return 0; if (value === "place") return 1;
  return fail("native-block-edit-action", "native block edit action is unknown");
}
function readAction(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedRuntimeNativeBlockEditActionKindV1 {
  const tag = reader.u8(); if (tag === 0) return "mine"; if (tag === 1) return "place";
  return fail("native-block-edit-action", "native block edit action tag is unknown");
}
function readFlag(reader: RustIntegratedPlayerInventoryReaderV1, label: string) {
  const tag = reader.u8();
  if (tag > 1) fail("native-block-edit-flag", `${label} boolean tag is invalid`);
  return tag === 1;
}
function validateFacing(blockId: number, facing: number, label: string) {
  integer(facing, 0, 3, `${label} facing`);
  if ((blockId === 0 || !isDirectionallyPlacedBlock(blockId as BlockId)) && facing !== 0) {
    fail("native-block-edit-facing", `${label} facing contradicts the canonical block catalog`);
  }
}
function writeWorldRevision(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedRuntimeBasicDirtWorldRevisionV1) {
  writer.u64(BigInt(integer(value.epoch, 0, MAX_SAFE_U64, "world epoch")));
  writer.u64(BigInt(integer(value.mutation, 0, MAX_SAFE_U64, "world mutation")));
  writer.u64(BigInt(integer(value.residency, 0, MAX_SAFE_U64, "world residency")));
}
function readWorldRevision(reader: RustIntegratedPlayerInventoryReaderV1) {
  return Object.freeze({ epoch: safeNumber(reader.u64(), "world epoch"), mutation: safeNumber(reader.u64(), "world mutation"), residency: safeNumber(reader.u64(), "world residency") });
}
function writeOptionalStackHash(hasher: TypeScriptCanonicalHasher, value: RustIntegratedPlayerInventoryStackV1 | null) {
  if (value === null) return hasher.writeU16(0);
  hasher.writeU16(1).writeU32(value.itemCode).writeU32(value.count);
  if (value.durabilityMillionths === null) hasher.writeU16(0); else hasher.writeU16(1).writeU32(value.durabilityMillionths);
  return hasher.writeBytes(hashBytes(value.metadataHash, "stack metadata"));
}
function writeStackHash(hasher: TypeScriptCanonicalHasher, value: RustIntegratedPlayerInventoryStackV1) {
  hasher.writeU32(value.itemCode).writeU32(value.count);
  if (value.durabilityMillionths === null) hasher.writeU16(0); else hasher.writeU16(1).writeU32(value.durabilityMillionths);
  return hasher.writeBytes(hashBytes(value.metadataHash, "stack metadata"));
}

function nativeBlockEditMutated(value: RustIntegratedRuntimeNativeBlockEditReceiptV1) {
  return value.priorBlockId !== value.replacementBlockId || value.priorFacing !== value.replacementFacing;
}

function expectedDirtySectionsV2(
  identity: RustIntegratedRuntimeIdentityV1,
  receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1,
) {
  const chunkX = Math.floor(receipt.position.x / WORLD_CHUNK_SIZE_V1);
  const chunkZ = Math.floor(receipt.position.z / WORLD_CHUNK_SIZE_V1);
  const sectionY = Math.floor((receipt.position.y - WORLD_MIN_Y_V1) / WORLD_SECTION_HEIGHT_V1);
  const localX = receipt.position.x - chunkX * WORLD_CHUNK_SIZE_V1;
  const localZ = receipt.position.z - chunkZ * WORLD_CHUNK_SIZE_V1;
  const localY = receipt.position.y - (WORLD_MIN_Y_V1 + sectionY * WORLD_SECTION_HEIGHT_V1);
  const sections = new Map<string, WorldSectionAddressV1>();
  const add = (nextChunkX: number, nextChunkZ: number, nextSectionY: number) => {
    if (nextSectionY < 0 || nextSectionY >= WORLD_SECTION_COUNT_V1) return;
    const section = Object.freeze({
      universeId: identity.universeId,
      locationId: identity.locationId,
      chunkX: nextChunkX,
      chunkZ: nextChunkZ,
      sectionY: nextSectionY,
    });
    sections.set(worldSectionAddressKeyV1(section), section);
  };
  add(chunkX, chunkZ, sectionY);
  if (localY === 0) add(chunkX, chunkZ, sectionY - 1);
  if (localY === WORLD_SECTION_HEIGHT_V1 - 1) add(chunkX, chunkZ, sectionY + 1);
  if (localX === 0) add(chunkX - 1, chunkZ, sectionY);
  if (localX === WORLD_CHUNK_SIZE_V1 - 1) add(chunkX + 1, chunkZ, sectionY);
  if (localZ === 0) add(chunkX, chunkZ - 1, sectionY);
  if (localZ === WORLD_CHUNK_SIZE_V1 - 1) add(chunkX, chunkZ + 1, sectionY);
  return Object.freeze([...sections.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, section]) => section));
}

export function rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2(
  value: RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2,
) {
  const hasher = new TypeScriptCanonicalHasher("blockwild.integrated.native-block-edit-dirty-evidence.v1")
    .writeU16(value.schema)
    .writeU64(value.sequence)
    .writeBytes(hashBytes(value.receiptHash, "dirty evidence receipt", false))
    .writeU64(value.sections.length);
  for (const section of value.sections) {
    hasher.writeString(section.universeId).writeString(section.locationId)
      .writeI32(section.chunkX).writeI32(section.chunkZ).writeI32(section.sectionY);
  }
  hasher.writeU64(value.columns.length);
  for (const column of value.columns) hasher.writeI32(column.x).writeI32(column.z);
  hasher.writeU64(value.subsystemSeeds.length);
  for (const entry of value.subsystemSeeds) {
    const tag = RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2.indexOf(entry.subsystem);
    if (tag < 0) fail("native-block-edit-dirty-subsystem", "dirty evidence subsystem is unknown");
    hasher.writeU16(tag).writeString(entry.seed);
  }
  return hasher.finishHex();
}

export function validateRustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2(
  value: RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2,
  receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1,
  identity: RustIntegratedRuntimeIdentityV1,
) {
  if (value.schema !== 1) fail("native-block-edit-dirty-schema", "native block-edit dirty evidence schema is not V1");
  integer(value.sequence, 1, MAX_SAFE_U64, "dirty evidence sequence");
  hash(value.receiptHash, "dirty evidence receipt hash", false);
  hash(value.evidenceHash, "dirty evidence hash", false);
  if (value.sequence !== receipt.sequence || value.receiptHash !== receipt.receiptHash) {
    fail("native-block-edit-dirty-ancestry", "dirty evidence does not bind the exact V1 receipt ancestry");
  }

  const mutated = nativeBlockEditMutated(receipt);
  if (!mutated) {
    if (value.sections.length !== 0 || value.columns.length !== 0 || value.subsystemSeeds.length !== 0) {
      fail("native-block-edit-dirty-noop", "native no-op block edit carries non-empty dirty evidence");
    }
  } else {
    const expectedSections = expectedDirtySectionsV2(identity, receipt);
    if (value.sections.length !== expectedSections.length) {
      fail("native-block-edit-dirty-sections", "dirty evidence does not contain the exact mutation halo sections");
    }
    for (let index = 0; index < expectedSections.length; index += 1) {
      const actual = value.sections[index]!;
      const expected = expectedSections[index]!;
      integer(actual.chunkX, -0x8000_0000, 0x7fff_ffff, "dirty section chunk x");
      integer(actual.chunkZ, -0x8000_0000, 0x7fff_ffff, "dirty section chunk z");
      integer(actual.sectionY, 0, WORLD_SECTION_COUNT_V1 - 1, "dirty section y");
      if (actual.universeId !== identity.universeId || actual.locationId !== identity.locationId
        || worldSectionAddressKeyV1(actual) !== worldSectionAddressKeyV1(expected)) {
        fail("native-block-edit-dirty-address", "dirty section address does not match the queried world and exact mutation halo");
      }
    }
    if (value.columns.length !== 1
      || value.columns[0]!.x !== receipt.position.x
      || value.columns[0]!.z !== receipt.position.z) {
      fail("native-block-edit-dirty-columns", "dirty evidence does not contain the exact direct mutation column");
    }
    if (value.subsystemSeeds.length !== RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2.length) {
      fail("native-block-edit-dirty-subsystems", "mutating dirty evidence does not contain all seven subsystem seeds");
    }
    for (let index = 0; index < RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2.length; index += 1) {
      const entry = value.subsystemSeeds[index]!;
      if (entry.subsystem !== RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2[index]) {
        fail("native-block-edit-dirty-subsystems", "dirty subsystem seeds are duplicated, missing, or out of order");
      }
      hash(entry.seed, `dirty ${entry.subsystem} seed`, false);
    }
  }
  if (rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2(value) !== value.evidenceHash) {
    fail("native-block-edit-dirty-hash", "dirty evidence hash does not match its canonical fields");
  }
  return value;
}

export function rustIntegratedRuntimeNativeBlockEditContentSubsetHashV1(
  value: RustIntegratedRuntimeNativeBlockEditContentBindingV1,
) {
  return new TypeScriptCanonicalHasher("blockwild.integrated.native-block-edit-subset.v1")
    .writeString(RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_V1).writeU16(value.blockId)
    .writeBytes(hashBytes(value.manifestHash, "manifest", false))
    .writeBytes(hashBytes(value.installedRegistryHash, "registry", false))
    .writeU16(value.catalogSchemaVersion).writeU32(value.catalogContentVersion)
    .writeBytes(hashBytes(value.catalogBlobHash, "catalog", false))
    .writeBytes(hashBytes(value.actionReportHash, "action report", false)).finishHex();
}

export function rustIntegratedRuntimeNativeBlockEditReceiptHashV1(
  value: RustIntegratedRuntimeNativeBlockEditReceiptV1,
) {
  const kinds = ["player", "equipment", "container", "machine", "waygrid", "cardforge-case"] as const;
  const kind = kinds.indexOf(value.inventory.container.kind);
  if (kind < 0) fail("native-block-edit-container", "inventory container kind is unknown");
  const hasher = new TypeScriptCanonicalHasher("blockwild.integrated.native-block-edit-receipt.v1")
    .writeU16(value.schema).writeU64(value.sequence).writeU64(value.originInputSequence).writeU64(value.completionTick)
    .writeU16(actionTag(value.action)).writeI32(value.position.x).writeI32(value.position.y).writeI32(value.position.z)
    .writeU16(value.priorBlockId).writeU16(value.priorFacing)
    .writeU16(value.replacementBlockId).writeU16(value.replacementFacing)
    .writeU64(value.beforeWorldRevision.epoch).writeU64(value.beforeWorldRevision.mutation).writeU64(value.beforeWorldRevision.residency)
    .writeU64(value.afterWorldRevision.epoch).writeU64(value.afterWorldRevision.mutation).writeU64(value.afterWorldRevision.residency)
    .writeBytes(hashBytes(value.beforeWorldHash, "before world", false))
    .writeBytes(hashBytes(value.afterWorldHash, "after world", false)).writeU16(value.creativeMode ? 1 : 0)
    .writeU16(kind).writeString(value.inventory.container.id).writeU16(value.inventory.container.ownerId === null ? 0 : 1);
  if (value.inventory.container.ownerId !== null) hasher.writeString(value.inventory.container.ownerId);
  hasher.writeU16(value.inventory.selectedSlot).writeU64(value.inventory.beforeRevision).writeU64(value.inventory.afterRevision);
  writeOptionalStackHash(hasher, value.inventory.beforeStack); writeOptionalStackHash(hasher, value.inventory.afterStack);
  hasher.writeU64(value.generatedDrops.length);
  for (const drop of value.generatedDrops) {
    hasher.writeBytes(hashBytes(rustIntegratedRuntimeBasicDirtGeneratedDropProvenanceHashV1(drop.provenance), "provenance", false))
      .writeU64(drop.entityId);
    writeStackHash(hasher, drop.stack);
    for (const component of [
      drop.position.xMilli, drop.position.yMilli, drop.position.zMilli,
      drop.velocityMilliPerSecond.xMilli, drop.velocityMilliPerSecond.yMilli, drop.velocityMilliPerSecond.zMilli,
    ]) hasher.writeU64(BigInt.asUintN(64, component));
    hasher.writeU32(drop.rotation.yaw).writeU32(drop.rotation.pitch).writeU32(drop.rotation.roll);
  }
  return hasher.writeU16(value.content.blockId)
    .writeBytes(hashBytes(value.content.manifestHash, "manifest", false))
    .writeBytes(hashBytes(value.content.installedRegistryHash, "registry", false))
    .writeU16(value.content.catalogSchemaVersion).writeU32(value.content.catalogContentVersion)
    .writeBytes(hashBytes(value.content.catalogBlobHash, "catalog", false))
    .writeBytes(hashBytes(value.content.actionReportHash, "action report", false))
    .writeBytes(hashBytes(value.content.subsetHash, "subset", false)).finishHex();
}

export function validateRustIntegratedRuntimeNativeBlockEditReceiptV1(
  value: RustIntegratedRuntimeNativeBlockEditReceiptV1,
  identity?: RustIntegratedRuntimeIdentityV1,
) {
  if (value.schema !== 1) fail("native-block-edit-schema", "native block edit receipt schema is not V1");
  integer(value.sequence, 1, MAX_SAFE_U64, "receipt sequence");
  integer(value.originInputSequence, 1, MAX_SAFE_U64, "origin input sequence");
  integer(value.completionTick, 0, MAX_SAFE_U64, "completion tick");
  if (identity && value.completionTick > identity.tick) fail("native-block-edit-tick", "receipt completion is in the query identity's future");
  integer(value.position.x, -0x8000_0000, 0x7fff_ffff, "x"); integer(value.position.y, WORLD_MIN_Y, WORLD_MAX_Y, "y"); integer(value.position.z, -0x8000_0000, 0x7fff_ffff, "z");
  integer(value.priorBlockId, 0, 0xffff, "prior block"); integer(value.replacementBlockId, 0, 0xffff, "replacement block");
  validateFacing(value.priorBlockId, value.priorFacing, "prior"); validateFacing(value.replacementBlockId, value.replacementFacing, "replacement");
  const before = value.beforeWorldRevision; const after = value.afterWorldRevision;
  for (const entry of [before.epoch, before.mutation, before.residency, after.epoch, after.mutation, after.residency]) integer(entry, 0, MAX_SAFE_U64, "world revision");
  const cellChanged = value.priorBlockId !== value.replacementBlockId || value.priorFacing !== value.replacementFacing;
  const noop = value.action === "mine" && !cellChanged
    && before.epoch === after.epoch && before.mutation === after.mutation && before.residency === after.residency
    && value.beforeWorldHash === value.afterWorldHash;
  const mutation = before.epoch === after.epoch && before.residency === after.residency
    && before.mutation + 1 === after.mutation && value.beforeWorldHash !== value.afterWorldHash && cellChanged;
  hash(value.beforeWorldHash, "before world", false); hash(value.afterWorldHash, "after world", false);
  if (!noop && !mutation) fail("native-block-edit-world-transition", "receipt is not one exact R4 mutation or content-owned no-op harvest");
  if (value.action === "mine") {
    if (value.priorBlockId === 0 || value.content.blockId !== value.priorBlockId) fail("native-block-edit-transition", "mine receipt does not bind its prior profile");
  } else if (value.action === "place") {
    if (value.replacementBlockId === 0 || value.content.blockId !== value.replacementBlockId
      || value.generatedDrops.length !== 0 || value.inventory.beforeStack === null) fail("native-block-edit-transition", "place receipt is ambiguous");
  } else actionTag(value.action);
  if (value.inventory.container.kind !== "player" || value.inventory.container.ownerId === null) fail("native-block-edit-inventory", "receipt inventory is not owned player custody");
  integer(value.inventory.selectedSlot, 0, 8, "selected slot"); u64(value.inventory.beforeRevision, "before inventory revision"); u64(value.inventory.afterRevision, "after inventory revision");
  if (value.inventory.afterRevision < value.inventory.beforeRevision || value.inventory.afterRevision > value.inventory.beforeRevision + BigInt(1)) fail("native-block-edit-inventory", "inventory revision is not an exact no-op or one-step transition");
  if (value.inventory.beforeStack) stack(value.inventory.beforeStack, "before stack"); if (value.inventory.afterStack) stack(value.inventory.afterStack, "after stack");
  if (value.creativeMode && (value.inventory.beforeRevision !== value.inventory.afterRevision || !sameStack(value.inventory.beforeStack, value.inventory.afterStack))) fail("native-block-edit-creative-inventory", "creative edit is not an inventory no-op");
  if (value.generatedDrops.length > MAX_GENERATED_DROPS) fail("native-block-edit-capacity", "generated drop count exceeds 32");
  const entities = new Set<string>(); const ordinals = new Set<number>();
  for (const drop of value.generatedDrops) {
    const provenance = drop.provenance; u64(drop.entityId, "generated entity"); if (drop.entityId === BigInt(0)) fail("native-block-edit-generated", "generated entity is zero");
    if (entities.has(drop.entityId.toString()) || ordinals.has(provenance.groupOrdinal)) fail("native-block-edit-generated", "generated evidence is duplicated");
    entities.add(drop.entityId.toString()); ordinals.add(provenance.groupOrdinal); stack(drop.stack, "generated stack");
    if (drop.stack.durabilityMillionths !== null) fail("native-block-edit-generated", "generated stack carries durability");
    if (value.action !== "mine" || provenance.schema !== 1 || provenance.blockId !== value.priorBlockId
      || provenance.originInputSequence !== value.originInputSequence || provenance.position.x !== value.position.x
      || provenance.position.y !== value.position.y || provenance.position.z !== value.position.z
      || provenance.manifestHash !== value.content.manifestHash || provenance.installedRegistryHash !== value.content.installedRegistryHash
      || provenance.catalogBlobHash !== value.content.catalogBlobHash || provenance.actionReportHash !== value.content.actionReportHash) fail("native-block-edit-generated", "generated evidence does not bind the same action and content");
    u64(provenance.blockActionSequence, "block action sequence"); integer(provenance.groupOrdinal, 0, 0xffff, "group ordinal");
    hash(provenance.rngSemanticsHash, "RNG semantics", false); hash(provenance.lootPlanHash, "loot plan", false);
    const expected = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(provenance);
    if (drop.position.xMilli !== expected.position.xMilli || drop.position.yMilli !== expected.position.yMilli || drop.position.zMilli !== expected.position.zMilli
      || drop.velocityMilliPerSecond.xMilli !== expected.velocityMilliPerSecond.xMilli || drop.velocityMilliPerSecond.yMilli !== expected.velocityMilliPerSecond.yMilli || drop.velocityMilliPerSecond.zMilli !== expected.velocityMilliPerSecond.zMilli
      || drop.rotation.yaw !== expected.rotation.yaw || drop.rotation.pitch !== expected.rotation.pitch || drop.rotation.roll !== expected.rotation.roll) fail("native-block-edit-generated", "generated fixed-point transform is not deterministic");
  }
  integer(value.content.blockId, 1, 0xffff, "content block"); integer(value.content.catalogSchemaVersion, 1, 0xffff, "catalog schema"); integer(value.content.catalogContentVersion, 1, 0xffff_ffff, "catalog version");
  if (rustIntegratedRuntimeNativeBlockEditContentSubsetHashV1(value.content) !== value.content.subsetHash) fail("native-block-edit-content", "installed content subset hash is invalid");
  if (rustIntegratedRuntimeNativeBlockEditReceiptHashV1(value) !== value.receiptHash) fail("native-block-edit-receipt-hash", "receipt hash does not match its canonical fields");
  return value;
}

function writeProvenance(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1) {
  writer.u16(value.schema); for (const field of [value.manifestHash, value.installedRegistryHash, value.catalogBlobHash, value.actionReportHash, value.rngSemanticsHash]) writer.raw(hashBytes(field, "provenance hash", false));
  writer.u64(value.blockActionSequence); writer.u64(BigInt(value.originInputSequence)); writer.u16(value.blockId);
  writeI32(writer, value.position.x); writeI32(writer, value.position.y); writeI32(writer, value.position.z);
  writer.raw(hashBytes(value.lootPlanHash, "loot plan", false)); writer.u16(value.groupOrdinal);
}
function readProvenance(reader: RustIntegratedPlayerInventoryReaderV1) {
  return Object.freeze({
    schema: reader.u16() as 1, manifestHash: bytesHash(reader.take(16)), installedRegistryHash: bytesHash(reader.take(16)),
    catalogBlobHash: bytesHash(reader.take(16)), actionReportHash: bytesHash(reader.take(16)), rngSemanticsHash: bytesHash(reader.take(16)),
    blockActionSequence: reader.u64(), originInputSequence: safeNumber(reader.u64(), "origin input", 1), blockId: reader.u16(),
    position: Object.freeze({ x: readI32(reader), y: readI32(reader), z: readI32(reader) }), lootPlanHash: bytesHash(reader.take(16)), groupOrdinal: reader.u16(),
  });
}
function writeReceipt(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedRuntimeNativeBlockEditReceiptV1) {
  validateRustIntegratedRuntimeNativeBlockEditReceiptV1(value); writer.u16(value.schema); writer.u64(BigInt(value.sequence)); writer.u64(BigInt(value.originInputSequence)); writer.u64(BigInt(value.completionTick)); writer.u8(actionTag(value.action));
  writeI32(writer, value.position.x); writeI32(writer, value.position.y); writeI32(writer, value.position.z); writer.u16(value.priorBlockId); writer.u8(value.priorFacing); writer.u16(value.replacementBlockId); writer.u8(value.replacementFacing);
  writeWorldRevision(writer, value.beforeWorldRevision); writeWorldRevision(writer, value.afterWorldRevision); writer.raw(hashBytes(value.beforeWorldHash, "before world", false)); writer.raw(hashBytes(value.afterWorldHash, "after world", false)); writer.u8(value.creativeMode ? 1 : 0);
  writeRustIntegratedContainerKeyV1(writer, value.inventory.container); writer.u16(value.inventory.selectedSlot); writer.u64(value.inventory.beforeRevision); writer.u64(value.inventory.afterRevision); writer.option(value.inventory.beforeStack, (entry) => writeRustIntegratedPlayerInventoryStackV1(writer, entry)); writer.option(value.inventory.afterStack, (entry) => writeRustIntegratedPlayerInventoryStackV1(writer, entry));
  writer.u32(value.generatedDrops.length); for (const drop of value.generatedDrops) { writeProvenance(writer, drop.provenance); writer.u64(drop.entityId); writeRustIntegratedPlayerInventoryStackV1(writer, drop.stack); for (const component of [drop.position.xMilli, drop.position.yMilli, drop.position.zMilli, drop.velocityMilliPerSecond.xMilli, drop.velocityMilliPerSecond.yMilli, drop.velocityMilliPerSecond.zMilli]) writeI64(writer, component); writer.u32(drop.rotation.yaw); writer.u32(drop.rotation.pitch); writer.u32(drop.rotation.roll); }
  writer.u16(value.content.blockId); for (const field of [value.content.manifestHash, value.content.installedRegistryHash]) writer.raw(hashBytes(field, "content hash", false)); writer.u16(value.content.catalogSchemaVersion); writer.u32(value.content.catalogContentVersion); for (const field of [value.content.catalogBlobHash, value.content.actionReportHash, value.content.subsetHash, value.receiptHash]) writer.raw(hashBytes(field, "content or receipt hash", false));
}
function readReceipt(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  const schema = reader.u16() as 1;
  const sequence = safeNumber(reader.u64(), "sequence", 1);
  const originInputSequence = safeNumber(reader.u64(), "origin", 1);
  const completionTick = safeNumber(reader.u64(), "completion");
  const action = readAction(reader);
  const position = Object.freeze({ x: readI32(reader), y: readI32(reader), z: readI32(reader) });
  const priorBlockId = reader.u16(); const priorFacing = reader.u8();
  const replacementBlockId = reader.u16(); const replacementFacing = reader.u8();
  const beforeWorldRevision = readWorldRevision(reader); const afterWorldRevision = readWorldRevision(reader);
  const beforeWorldHash = bytesHash(reader.take(16)); const afterWorldHash = bytesHash(reader.take(16));
  const creativeMode = readFlag(reader, "creative mode");
  const inventory = Object.freeze({ container: readRustIntegratedContainerKeyV1(reader), selectedSlot: reader.u16(), beforeRevision: reader.u64(), afterRevision: reader.u64(), beforeStack: reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader)), afterStack: reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader)) });
  const dropCount = reader.u32();
  if (dropCount > MAX_GENERATED_DROPS) fail("native-block-edit-capacity", "generated drop count exceeds 32");
  const generatedDrops = Object.freeze(Array.from({ length: dropCount }, () => Object.freeze({ provenance: readProvenance(reader), entityId: reader.u64(), stack: readRustIntegratedPlayerInventoryStackV1(reader), position: Object.freeze({ xMilli: readI64(reader), yMilli: readI64(reader), zMilli: readI64(reader) }), velocityMilliPerSecond: Object.freeze({ xMilli: readI64(reader), yMilli: readI64(reader), zMilli: readI64(reader) }), rotation: Object.freeze({ yaw: reader.u32(), pitch: reader.u32(), roll: reader.u32() }) })));
  const value = Object.freeze({
    schema, sequence, originInputSequence, completionTick, action, position, priorBlockId, priorFacing,
    replacementBlockId, replacementFacing, beforeWorldRevision, afterWorldRevision, beforeWorldHash,
    afterWorldHash, creativeMode, inventory, generatedDrops,
    content: Object.freeze({ blockId: reader.u16(), manifestHash: bytesHash(reader.take(16)), installedRegistryHash: bytesHash(reader.take(16)), catalogSchemaVersion: reader.u16(), catalogContentVersion: reader.u32(), catalogBlobHash: bytesHash(reader.take(16)), actionReportHash: bytesHash(reader.take(16)), subsetHash: bytesHash(reader.take(16)) }), receiptHash: bytesHash(reader.take(16)),
  });
  return validateRustIntegratedRuntimeNativeBlockEditReceiptV1(value);
}

function writeDirtyEvidenceV2(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2,
) {
  writer.u16(value.schema); writer.u64(BigInt(value.sequence));
  writer.raw(hashBytes(value.receiptHash, "dirty evidence receipt", false));
  writer.u32(value.sections.length);
  for (const section of value.sections) {
    writer.string(section.universeId, "dirty section universe");
    writer.string(section.locationId, "dirty section location");
    writeI32(writer, section.chunkX); writeI32(writer, section.chunkZ); writeI16(writer, section.sectionY);
  }
  writer.u32(value.columns.length);
  for (const column of value.columns) { writeI32(writer, column.x); writeI32(writer, column.z); }
  writer.u32(value.subsystemSeeds.length);
  for (const entry of value.subsystemSeeds) {
    const tag = RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2.indexOf(entry.subsystem);
    if (tag < 0) fail("native-block-edit-dirty-subsystem", "dirty evidence subsystem is unknown");
    writer.u8(tag); writer.string(entry.seed, "dirty subsystem seed");
  }
  writer.raw(hashBytes(value.evidenceHash, "dirty evidence hash", false));
}

function readDirtyEvidenceV2(reader: RustIntegratedPlayerInventoryReaderV1) {
  const schema = reader.u16() as 1;
  const sequence = safeNumber(reader.u64(), "dirty evidence sequence", 1);
  const receiptHash = bytesHash(reader.take(16));
  const sectionCount = reader.u32();
  if (sectionCount > 4) fail("native-block-edit-dirty-capacity", "dirty evidence section count exceeds the exact single-cell halo");
  const sections = Object.freeze(Array.from({ length: sectionCount }, () => Object.freeze({
    universeId: reader.string("dirty section universe"),
    locationId: reader.string("dirty section location"),
    chunkX: readI32(reader),
    chunkZ: readI32(reader),
    sectionY: readI16(reader),
  })));
  const columnCount = reader.u32();
  if (columnCount > 1) fail("native-block-edit-dirty-capacity", "dirty evidence contains more than one direct column");
  const columns = Object.freeze(Array.from({ length: columnCount }, () => Object.freeze({
    x: readI32(reader), z: readI32(reader),
  })));
  const seedCount = reader.u32();
  if (seedCount > RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2.length) {
    fail("native-block-edit-dirty-capacity", "dirty evidence contains more than seven subsystem seeds");
  }
  const subsystemSeeds = Object.freeze(Array.from({ length: seedCount }, () => {
    const tag = reader.u8();
    const subsystem = RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2[tag];
    if (subsystem === undefined) fail("native-block-edit-dirty-subsystem", "dirty evidence subsystem tag is unknown");
    return Object.freeze({ subsystem, seed: reader.string("dirty subsystem seed") });
  }));
  return Object.freeze({
    schema, sequence, receiptHash, sections, columns, subsystemSeeds,
    evidenceHash: bytesHash(reader.take(16)),
  });
}

export function encodeRustIntegratedRuntimeNativeBlockEditQueryV1(value: RustIntegratedRuntimeNativeBlockEditQueryV1) {
  integer(value.afterSequence, 0, MAX_SAFE_U64, "query cursor"); const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeIdentity(writer, value.expected); writer.u64(BigInt(value.afterSequence)); return wrap(QUERY_MAGIC, QUERY_SCHEMA_V1.innerSchema, writer.finish());
}
export function decodeRustIntegratedRuntimeNativeBlockEditQueryV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, QUERY_MAGIC, QUERY_SCHEMA_V1.innerSchema));
  const value = Object.freeze({ expected: readIdentity(reader), afterSequence: safeNumber(reader.u64(), "query cursor") }); reader.finish(); return value;
}
export function encodeRustIntegratedRuntimeNativeBlockEditQueryV2(value: RustIntegratedRuntimeNativeBlockEditQueryV1) {
  integer(value.afterSequence, 0, MAX_SAFE_U64, "query cursor");
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeIdentity(writer, value.expected); writer.u64(BigInt(value.afterSequence));
  return wrap(QUERY_MAGIC_V2, QUERY_SCHEMA_V2.innerSchema, writer.finish());
}
export function decodeRustIntegratedRuntimeNativeBlockEditQueryV2(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, QUERY_MAGIC_V2, QUERY_SCHEMA_V2.innerSchema));
  const value = Object.freeze({
    expected: readIdentity(reader),
    afterSequence: safeNumber(reader.u64(), "query cursor"),
  });
  reader.finish(); return value;
}
function validateCursor(value: RustIntegratedRuntimeNativeBlockEditProjectionReceiptV1, expected?: number) {
  integer(value.cursorAfter, 0, MAX_SAFE_U64, "response cursor");
  if (expected === undefined) { if (value.receipt && value.receipt.sequence !== value.cursorAfter) fail("native-block-edit-cursor", "response cursor does not identify its receipt"); return; }
  if (expected === RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1) { if (value.receipt) fail("native-block-edit-cursor", "seed-only query attempted to replay a receipt"); return; }
  if (!value.receipt) { if (value.cursorAfter !== expected) fail("native-block-edit-cursor", "empty tail changed its cursor"); return; }
  if (value.receipt.sequence !== expected + 1 || value.cursorAfter !== value.receipt.sequence) fail("native-block-edit-cursor", "receipt tail is gapped, stale, or out of order");
}
export function encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(value: RustIntegratedRuntimeNativeBlockEditProjectionReceiptV1, expected?: number) {
  hash(value.requestPayloadHash, "request payload", false); if (value.receipt) validateRustIntegratedRuntimeNativeBlockEditReceiptV1(value.receipt, value.identity); validateCursor(value, expected);
  const writer = new RustIntegratedPlayerInventoryWriterV1(); writer.raw(hashBytes(value.requestPayloadHash, "request payload", false)); writeIdentity(writer, value.identity); writer.u64(BigInt(value.cursorAfter)); writer.option(value.receipt, (receipt) => writeReceipt(writer, receipt)); return wrap(RECEIPT_MAGIC, RECEIPT_SCHEMA_V1.innerSchema, writer.finish());
}
export function decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(packet: Uint8Array, expectedRequestHash?: string, expected?: number) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, RECEIPT_MAGIC, RECEIPT_SCHEMA_V1.innerSchema)); const requestPayloadHash = bytesHash(reader.take(16)); const identity = readIdentity(reader); const cursorAfter = safeNumber(reader.u64(), "response cursor"); const receipt = reader.option(() => readReceipt(reader)); reader.finish();
  if (expectedRequestHash !== undefined && requestPayloadHash !== expectedRequestHash) fail("native-block-edit-request", "BWY7 does not attest the exact BWZ7 payload"); const value = Object.freeze({ requestPayloadHash, identity, cursorAfter, receipt }); if (receipt) validateRustIntegratedRuntimeNativeBlockEditReceiptV1(receipt, identity); validateCursor(value, expected); return value;
}
export function encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(
  value: RustIntegratedRuntimeNativeBlockEditProjectionReceiptV2,
  expected?: number,
) {
  hash(value.requestPayloadHash, "request payload", false);
  if (value.receipt) validateRustIntegratedRuntimeNativeBlockEditReceiptV1(value.receipt, value.identity);
  if (value.dirtyEvidence !== null) {
    if (value.receipt === null) fail("native-block-edit-dirty-ancestry", "dirty evidence exists without a V1 receipt");
    validateRustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2(value.dirtyEvidence, value.receipt, value.identity);
  }
  validateCursor(value, expected);
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writer.raw(hashBytes(value.requestPayloadHash, "request payload", false));
  writeIdentity(writer, value.identity); writer.u64(BigInt(value.cursorAfter));
  writer.option(value.receipt, (receipt) => writeReceipt(writer, receipt));
  writer.option(value.dirtyEvidence, (evidence) => writeDirtyEvidenceV2(writer, evidence));
  return wrap(RECEIPT_MAGIC_V2, RECEIPT_SCHEMA_V2.innerSchema, writer.finish());
}
export function decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(
  packet: Uint8Array,
  expectedRequestHash?: string,
  expected?: number,
) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, RECEIPT_MAGIC_V2, RECEIPT_SCHEMA_V2.innerSchema));
  const requestPayloadHash = bytesHash(reader.take(16));
  const identity = readIdentity(reader);
  const cursorAfter = safeNumber(reader.u64(), "response cursor");
  const receipt = reader.option(() => readReceipt(reader));
  const dirtyEvidence = reader.option(() => readDirtyEvidenceV2(reader));
  reader.finish();
  if (expectedRequestHash !== undefined && requestPayloadHash !== expectedRequestHash) {
    fail("native-block-edit-request", "BWY8 does not attest the exact BWZ8 payload");
  }
  if (dirtyEvidence !== null) {
    if (receipt === null) fail("native-block-edit-dirty-ancestry", "BWY8 dirty evidence exists without a V1 receipt");
    validateRustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2(dirtyEvidence, receipt, identity);
  }
  const value = Object.freeze({ requestPayloadHash, identity, cursorAfter, receipt, dirtyEvidence });
  if (receipt) validateRustIntegratedRuntimeNativeBlockEditReceiptV1(receipt, identity);
  validateCursor(value, expected);
  return value;
}
function validateOuter(receipt: RustIntegratedRuntimeCommandReceiptV1) {
  const bytes: number[] = [...hashBytes(receipt.commandHash, "command hash")];
  if (receipt.status === "accepted") { bytes.push(...hashBytes(receipt.before.stateHash, "before state"), ...hashBytes(receipt.after.stateHash, "after state")); for (const operation of receipt.domainReceipts) bytes.push(...hashBytes(operation.payloadHash, "domain hash")); }
  else bytes.push(...hashBytes(receipt.current.stateHash, "current state"), ...encoder.encode(receipt.code), ...encoder.encode(receipt.message));
  if (receipt.receiptHash !== rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes))) fail("native-block-edit-command", "BWRQ receipt hash is invalid");
}
export async function queryRustIntegratedRuntimeNativeBlockEditReceiptV1(service: RustIntegratedRuntimeNativeBlockEditServiceV1, afterSequence: number): Promise<RustIntegratedRuntimeNativeBlockEditObservedReceiptV1> {
  integer(afterSequence, 0, MAX_SAFE_U64, "query cursor"); const expected = service.identity(); const payload = encodeRustIntegratedRuntimeNativeBlockEditQueryV1({ expected, afterSequence }); const operation = createRustIntegratedRuntimeDomainOperationV1({ domain: "gameplay", typeId: RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1, schema: QUERY_SCHEMA_V1.operationSchema, payload }); const id = `native-block-edit-receipt:${expected.stateHash}:${afterSequence}`; const batch = createRustIntegratedRuntimeCommandBatchV1({ commandId: id, idempotencyKey: id, actorId: "runtime:native-block-edit-receipt", expected, operations: Object.freeze([operation]) }); const outer = await service.command(batch);
  if (outer.commandId !== batch.commandId || outer.idempotencyKey !== batch.idempotencyKey || outer.commandHash !== batch.commandHash) fail("native-block-edit-command", "BWRQ receipt does not identify the query batch"); validateOuter(outer);
  if (outer.status === "rejected") { if (!rustIntegratedRuntimeIdentityEqualsV1(outer.current, expected) || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) fail("native-block-edit-command", "rejected query moved authority"); fail(outer.code, outer.message); }
  const response = outer.domainReceipts[0]; if (outer.domainReceipts.length !== 1 || !response || response.domain !== "gameplay" || response.typeId !== RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1 || response.schema !== RECEIPT_SCHEMA_V1.operationSchema || response.payloadHash !== rustIntegratedRuntimeWireChecksumV1(response.payload) || !rustIntegratedRuntimeIdentityEqualsV1(outer.before, expected) || !rustIntegratedRuntimeIdentityEqualsV1(outer.after, expected) || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) fail("native-block-edit-command", "query returned a mutating or incorrectly typed receipt");
  const result = decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(response.payload, operation.payloadHash, afterSequence); if (!rustIntegratedRuntimeIdentityEqualsV1(result.identity, expected)) fail("native-block-edit-identity", "BWY7 identity does not match observed authority"); return Object.freeze({ ...result, projectionPayloadHash: response.payloadHash });
}

export async function queryRustIntegratedRuntimeNativeBlockEditReceiptV2(
  service: RustIntegratedRuntimeNativeBlockEditServiceV1,
  afterSequence: number,
): Promise<RustIntegratedRuntimeNativeBlockEditObservedReceiptV2> {
  integer(afterSequence, 0, MAX_SAFE_U64, "query cursor");
  const expected = service.identity();
  const payload = encodeRustIntegratedRuntimeNativeBlockEditQueryV2({ expected, afterSequence });
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "gameplay",
    typeId: RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2,
    schema: QUERY_SCHEMA_V2.operationSchema,
    payload,
  });
  const id = `native-block-edit-receipt-v2:${expected.stateHash}:${afterSequence}`;
  const batch = createRustIntegratedRuntimeCommandBatchV1({
    commandId: id,
    idempotencyKey: id,
    actorId: "runtime:native-block-edit-receipt-v2",
    expected,
    operations: Object.freeze([operation]),
  });
  const outer = await service.command(batch);
  if (outer.commandId !== batch.commandId || outer.idempotencyKey !== batch.idempotencyKey
    || outer.commandHash !== batch.commandHash) {
    fail("native-block-edit-command", "BWRQ receipt does not identify the V2 query batch");
  }
  validateOuter(outer);
  if (outer.status === "rejected") {
    if (!rustIntegratedRuntimeIdentityEqualsV1(outer.current, expected)
      || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) {
      fail("native-block-edit-command", "rejected V2 query moved authority");
    }
    fail(outer.code, outer.message);
  }
  const response = outer.domainReceipts[0];
  if (outer.domainReceipts.length !== 1 || !response || response.domain !== "gameplay"
    || response.typeId !== RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V2
    || response.schema !== RECEIPT_SCHEMA_V2.operationSchema || response.payloadHash !== rustIntegratedRuntimeWireChecksumV1(response.payload)
    || !rustIntegratedRuntimeIdentityEqualsV1(outer.before, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(outer.after, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) {
    fail("native-block-edit-command", "V2 query returned a mutating or incorrectly typed receipt");
  }
  const result = decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(
    response.payload,
    operation.payloadHash,
    afterSequence,
  );
  if (!rustIntegratedRuntimeIdentityEqualsV1(result.identity, expected)) {
    fail("native-block-edit-identity", "BWY8 identity does not match observed authority");
  }
  return Object.freeze({ ...result, projectionPayloadHash: response.payloadHash });
}
