import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow.ts";
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
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated.ts";

const QUERY_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("basic-dirt-action-receipt-v1");
const RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("basic-dirt-action-projection-receipt-v1");

export const RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1 = QUERY_SCHEMA.typeId;
export const RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1 = RECEIPT_SCHEMA.typeId;
export const RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1 = Number.MAX_SAFE_INTEGER;

const QUERY_MAGIC = new TextEncoder().encode(QUERY_SCHEMA.magic);
const RECEIPT_MAGIC = new TextEncoder().encode(RECEIPT_SCHEMA.magic);
const HEADER_BYTES = 28;
const MAX_SAFE_U64 = Number.MAX_SAFE_INTEGER;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const I64_MIN = -(BigInt(1) << BigInt(63));
const I64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);
const MAX_ITEM_STACK = 0x7fff_ffff;
const MAX_GENERATED_DROPS = 32;
const WORLD_MIN_Y = -64;
const WORLD_MAX_Y = 127;
const WORLD_VIEW_COORDINATE_LIMIT_MILLI = BigInt(33_554_432_000);
const WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND = BigInt(4_096_000);
const WORLD_VIEW_FRACTION_SCALE = 1_000_000;
const AIR_BLOCK_ID = 0;
const BASIC_DIRT_BLOCK_ID = 2;
const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const ZERO_HASH = "0".repeat(32);
const encoder = new TextEncoder();

export type RustIntegratedRuntimeBasicDirtActionKindV1 = "mine" | "place";

export type RustIntegratedRuntimeBasicDirtWorldRevisionV1 = Readonly<{
  epoch: number;
  mutation: number;
  residency: number;
}>;

export type RustIntegratedRuntimeBasicDirtCellV1 = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type RustIntegratedRuntimeBasicDirtFixedVectorV1 = Readonly<{
  xMilli: bigint;
  yMilli: bigint;
  zMilli: bigint;
}>;

export type RustIntegratedRuntimeBasicDirtRotationV1 = Readonly<{
  yaw: number;
  pitch: number;
  roll: number;
}>;

export type RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1 = Readonly<{
  schema: 1;
  manifestHash: string;
  installedRegistryHash: string;
  catalogBlobHash: string;
  actionReportHash: string;
  rngSemanticsHash: string;
  /** Native loot-plan sequence is a full u64 and must remain lossless in JavaScript. */
  blockActionSequence: bigint;
  originInputSequence: number;
  blockId: number;
  position: RustIntegratedRuntimeBasicDirtCellV1;
  lootPlanHash: string;
  groupOrdinal: number;
}>;

export type RustIntegratedRuntimeBasicDirtGeneratedDropProjectionV1 = Readonly<{
  provenance: RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1;
  entityId: bigint;
  stack: RustIntegratedPlayerInventoryStackV1;
  position: RustIntegratedRuntimeBasicDirtFixedVectorV1;
  velocityMilliPerSecond: RustIntegratedRuntimeBasicDirtFixedVectorV1;
  rotation: RustIntegratedRuntimeBasicDirtRotationV1;
}>;

export type RustIntegratedRuntimeBasicDirtActionContentBindingV1 = Readonly<{
  manifestHash: string;
  installedRegistryHash: string;
  catalogSchemaVersion: number;
  catalogContentVersion: number;
  catalogBlobHash: string;
  actionReportHash: string;
  subsetHash: string;
}>;

export type RustIntegratedRuntimeBasicDirtInventoryDeltaV1 = Readonly<{
  container: RustIntegratedContainerKeyV1;
  slot: number;
  beforeRevision: bigint;
  afterRevision: bigint;
  beforeStack: RustIntegratedPlayerInventoryStackV1 | null;
  afterStack: RustIntegratedPlayerInventoryStackV1 | null;
}>;

export type RustIntegratedRuntimeBasicDirtActionProjectionV1 = Readonly<{
  schema: 1;
  sequence: number;
  originInputSequence: number;
  completionTick: number;
  action: RustIntegratedRuntimeBasicDirtActionKindV1;
  position: RustIntegratedRuntimeBasicDirtCellV1;
  priorBlockId: number;
  replacementBlockId: number;
  beforeWorldRevision: RustIntegratedRuntimeBasicDirtWorldRevisionV1;
  afterWorldRevision: RustIntegratedRuntimeBasicDirtWorldRevisionV1;
  beforeWorldHash: string;
  afterWorldHash: string;
  creativeMode: boolean;
  inventory: RustIntegratedRuntimeBasicDirtInventoryDeltaV1;
  generatedDrops: readonly RustIntegratedRuntimeBasicDirtGeneratedDropProjectionV1[];
  content: RustIntegratedRuntimeBasicDirtActionContentBindingV1;
  receiptHash: string;
}>;

export type RustIntegratedRuntimeBasicDirtActionQueryV1 = Readonly<{
  expected: RustIntegratedRuntimeIdentityV1;
  afterSequence: number;
}>;

export type RustIntegratedRuntimeBasicDirtActionProjectionReceiptV1 = Readonly<{
  requestPayloadHash: string;
  identity: RustIntegratedRuntimeIdentityV1;
  cursorAfter: number;
  receipt: RustIntegratedRuntimeBasicDirtActionProjectionV1 | null;
}>;

export type RustIntegratedRuntimeBasicDirtActionObservedReceiptV1 =
  RustIntegratedRuntimeBasicDirtActionProjectionReceiptV1 & Readonly<{
    /** Exact BWRQ domain-operation payload hash over the complete BWR7 packet. */
    projectionPayloadHash: string;
  }>;

export interface RustIntegratedRuntimeBasicDirtActionServiceV1 {
  identity(): RustIntegratedRuntimeIdentityV1;
  command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1>;
}

export class RustIntegratedRuntimeBasicDirtActionErrorV1 extends Error {
  readonly name = "RustIntegratedRuntimeBasicDirtActionErrorV1";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedRuntimeBasicDirtActionErrorV1(code, message);
}

function checkedInteger(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("basic-dirt-action-projection-integer", `${label} is outside its exact integer range`);
  }
  return value;
}

function checkedU64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0) || value > U64_MAX) {
    fail("basic-dirt-action-projection-u64", `${label} is outside the u64 range`);
  }
  return value;
}

function checkedI64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < I64_MIN || value > I64_MAX) {
    fail("basic-dirt-action-projection-i64", `${label} is outside the i64 range`);
  }
  return value;
}

function safeNumber(value: bigint, label: string, minimum = 0) {
  if (value > BigInt(MAX_SAFE_U64)) {
    fail("basic-dirt-action-projection-u64", `${label} exceeds JavaScript's exact integer range`);
  }
  return checkedInteger(Number(value), minimum, MAX_SAFE_U64, label);
}

function checkedHash(value: string, label: string, allowZero = true) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value) || !allowZero && value === ZERO_HASH) {
    fail("basic-dirt-action-projection-hash", `${label} is not a canonical${allowZero ? "" : " non-zero"} hash`);
  }
  return value;
}

function hashBytes(value: string, label: string, allowZero = true) {
  checkedHash(value, label, allowZero);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function bytesHash(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function writeI32(writer: RustIntegratedPlayerInventoryWriterV1, value: number, label: string) {
  checkedInteger(value, -0x8000_0000, 0x7fff_ffff, label);
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  writer.raw(bytes);
}

function readI32(reader: RustIntegratedPlayerInventoryReaderV1) {
  const bytes = reader.take(4);
  return new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, true);
}

function writeI64(writer: RustIntegratedPlayerInventoryWriterV1, value: bigint, label: string) {
  checkedI64(value, label);
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  writer.raw(bytes);
}

function readI64(reader: RustIntegratedPlayerInventoryReaderV1) {
  const bytes = reader.take(8);
  return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true);
}

function writeIdentity(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedRuntimeIdentityV1) {
  writer.u16(2);
  writer.string(value.universeId, "basic Dirt universe id");
  writer.string(value.locationId, "basic Dirt location id");
  for (const revision of [
    value.revision.epoch, value.revision.world, value.revision.entities, value.revision.gameplay,
    value.revision.persistence, value.revision.network, value.revision.simulation,
  ]) writer.u64(BigInt(checkedInteger(revision, 0, MAX_SAFE_U64, "runtime identity revision")));
  writer.u64(BigInt(checkedInteger(value.tick, 0, MAX_SAFE_U64, "runtime identity tick")));
  writer.raw(hashBytes(value.stateHash, "runtime identity state hash"));
}

function readIdentity(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedRuntimeIdentityV1 {
  if (reader.u16() !== 2) fail("basic-dirt-action-projection-identity", "runtime identity schema is not V2");
  return Object.freeze({
    universeId: reader.string("basic Dirt universe id"),
    locationId: reader.string("basic Dirt location id"),
    revision: Object.freeze({
      epoch: safeNumber(reader.u64(), "identity epoch"),
      world: safeNumber(reader.u64(), "world revision"),
      entities: safeNumber(reader.u64(), "entities revision"),
      gameplay: safeNumber(reader.u64(), "gameplay revision"),
      persistence: safeNumber(reader.u64(), "persistence revision"),
      network: safeNumber(reader.u64(), "network revision"),
      simulation: safeNumber(reader.u64(), "simulation revision"),
    }),
    tick: safeNumber(reader.u64(), "runtime identity tick"),
    stateHash: bytesHash(reader.take(16)),
  });
}

function wrap(magic: Uint8Array, schema: number, body: Uint8Array) {
  if (body.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES - HEADER_BYTES) {
    fail("basic-dirt-action-projection-size", "basic Dirt packet exceeds the gameplay domain byte ceiling");
  }
  const output = new Uint8Array(HEADER_BYTES + body.byteLength);
  const view = new DataView(output.buffer);
  output.set(magic);
  view.setUint16(4, 1, true);
  view.setUint16(6, schema, true);
  view.setUint32(8, body.byteLength, true);
  output.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(body), "basic Dirt wire checksum"), 12);
  output.set(body, HEADER_BYTES);
  return output;
}

function unwrap(packet: Uint8Array, magic: Uint8Array, schema: number) {
  if (!(packet instanceof Uint8Array) || packet.byteLength < HEADER_BYTES
    || packet.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES
    || !magic.every((byte, index) => packet[index] === byte)) {
    fail("basic-dirt-action-projection-header", "basic Dirt packet header is malformed");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== schema
    || view.getUint32(8, true) !== packet.byteLength - HEADER_BYTES) {
    fail("basic-dirt-action-projection-header", "basic Dirt packet version or length is invalid");
  }
  const body = packet.subarray(HEADER_BYTES);
  if (bytesHash(packet.subarray(12, HEADER_BYTES)) !== rustIntegratedRuntimeWireChecksumV1(body)) {
    fail("basic-dirt-action-projection-checksum", "basic Dirt packet checksum is invalid");
  }
  return body;
}

function actionTag(value: RustIntegratedRuntimeBasicDirtActionKindV1) {
  if (value === "mine") return 0;
  if (value === "place") return 1;
  return fail("basic-dirt-action-projection-action", "basic Dirt action kind is unknown");
}

function readAction(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedRuntimeBasicDirtActionKindV1 {
  const tag = reader.u8();
  if (tag === 0) return "mine";
  if (tag === 1) return "place";
  return fail("basic-dirt-action-projection-action", "native basic Dirt action kind is unknown");
}

function writeWorldRevision(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeBasicDirtWorldRevisionV1,
) {
  writer.u64(BigInt(checkedInteger(value.epoch, 0, MAX_SAFE_U64, "world epoch")));
  writer.u64(BigInt(checkedInteger(value.mutation, 0, MAX_SAFE_U64, "world mutation revision")));
  writer.u64(BigInt(checkedInteger(value.residency, 0, MAX_SAFE_U64, "world residency revision")));
}

function readWorldRevision(reader: RustIntegratedPlayerInventoryReaderV1) {
  return Object.freeze({
    epoch: safeNumber(reader.u64(), "world epoch"),
    mutation: safeNumber(reader.u64(), "world mutation revision"),
    residency: safeNumber(reader.u64(), "world residency revision"),
  });
}

function checkedStack(value: RustIntegratedPlayerInventoryStackV1, label: string) {
  if (value.itemCode < 1 || value.count < 1 || value.count > MAX_ITEM_STACK
    || value.durabilityMillionths !== null
      && (!Number.isInteger(value.durabilityMillionths) || value.durabilityMillionths < 0
        || value.durabilityMillionths > 1_000_000)) {
    fail("basic-dirt-action-projection-stack", `${label} is not an exact bounded item stack`);
  }
  checkedInteger(value.itemCode, 1, 0xffff_ffff, `${label} item code`);
  checkedInteger(value.count, 1, MAX_ITEM_STACK, `${label} count`);
  checkedHash(value.metadataHash, `${label} metadata hash`);
  return value;
}

export function rustIntegratedRuntimeBasicDirtGeneratedDropProvenanceHashV1(
  value: RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1,
) {
  return new TypeScriptCanonicalHasher("blockwild.gameplay.generated-drop-provenance.v1")
    .writeU16(value.schema)
    .writeBytes(hashBytes(value.manifestHash, "drop manifest hash", false))
    .writeBytes(hashBytes(value.installedRegistryHash, "drop registry hash", false))
    .writeBytes(hashBytes(value.catalogBlobHash, "drop catalog hash", false))
    .writeBytes(hashBytes(value.actionReportHash, "drop action report hash", false))
    .writeBytes(hashBytes(value.rngSemanticsHash, "drop RNG semantics hash", false))
    .writeU64(value.blockActionSequence)
    .writeU64(value.originInputSequence)
    .writeU16(value.blockId)
    .writeI32(value.position.x)
    .writeI32(value.position.y)
    .writeI32(value.position.z)
    .writeBytes(hashBytes(value.lootPlanHash, "drop loot plan hash", false))
    .writeU16(value.groupOrdinal)
    .finishHex();
}

export function rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(
  value: RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1,
) {
  const bytes = hashBytes(
    rustIntegratedRuntimeBasicDirtGeneratedDropProvenanceHashV1(value),
    "generated-drop provenance hash",
    false,
  );
  const unsigned16 = (offset: number) => bytes[offset]! | bytes[offset + 1]! << 8;
  const signedOffset = (offset: number) => BigInt(unsigned16(offset) % 401 - 200);
  const yaw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(10, true) % 1_000_000;
  return Object.freeze({
    position: Object.freeze({
      xMilli: BigInt(value.position.x) * BigInt(1_000) + signedOffset(0),
      yMilli: BigInt(value.position.y) * BigInt(1_000) + BigInt(350),
      zMilli: BigInt(value.position.z) * BigInt(1_000) + signedOffset(2),
    }),
    velocityMilliPerSecond: Object.freeze({
      xMilli: signedOffset(4) * BigInt(2),
      yMilli: BigInt(1_200 + unsigned16(6) % 401),
      zMilli: signedOffset(8) * BigInt(2),
    }),
    rotation: Object.freeze({ yaw, pitch: 0, roll: 0 }),
  });
}

function writeOptionalStackHash(
  hasher: TypeScriptCanonicalHasher,
  value: RustIntegratedPlayerInventoryStackV1 | null,
) {
  if (value === null) return hasher.writeU16(0);
  hasher.writeU16(1)
    .writeU32(value.itemCode)
    .writeU32(value.count);
  if (value.durabilityMillionths === null) hasher.writeU16(0);
  else hasher.writeU16(1).writeU32(value.durabilityMillionths);
  return hasher.writeBytes(hashBytes(value.metadataHash, "inventory metadata hash"));
}

export function rustIntegratedRuntimeBasicDirtContentSubsetHashV1(
  value: RustIntegratedRuntimeBasicDirtActionContentBindingV1,
) {
  return new TypeScriptCanonicalHasher("blockwild.integrated.basic-dirt-action-subset.v1")
    .writeString("basic-dirt-action-v1")
    .writeU16(BASIC_DIRT_BLOCK_ID)
    .writeU16(AIR_BLOCK_ID)
    .writeBytes(hashBytes(value.manifestHash, "content manifest hash", false))
    .writeBytes(hashBytes(value.installedRegistryHash, "content registry hash", false))
    .writeU16(value.catalogSchemaVersion)
    .writeU32(value.catalogContentVersion)
    .writeBytes(hashBytes(value.catalogBlobHash, "content catalog hash", false))
    .writeBytes(hashBytes(value.actionReportHash, "content action report hash", false))
    .finishHex();
}

export function rustIntegratedRuntimeBasicDirtActionReceiptHashV1(
  value: RustIntegratedRuntimeBasicDirtActionProjectionV1,
) {
  const containerKinds = ["player", "equipment", "container", "machine", "waygrid", "cardforge-case"] as const;
  const containerKind = containerKinds.indexOf(value.inventory.container.kind);
  if (containerKind < 0) fail("basic-dirt-action-projection-container", "inventory container kind is unknown");
  const hasher = new TypeScriptCanonicalHasher("blockwild.integrated.basic-dirt-action-receipt.v1")
    .writeU16(value.schema)
    .writeU64(value.sequence)
    .writeU64(value.originInputSequence)
    .writeU64(value.completionTick)
    .writeU16(actionTag(value.action))
    .writeI32(value.position.x)
    .writeI32(value.position.y)
    .writeI32(value.position.z)
    .writeU16(value.priorBlockId)
    .writeU16(value.replacementBlockId)
    .writeU64(value.beforeWorldRevision.epoch)
    .writeU64(value.beforeWorldRevision.mutation)
    .writeU64(value.beforeWorldRevision.residency)
    .writeU64(value.afterWorldRevision.epoch)
    .writeU64(value.afterWorldRevision.mutation)
    .writeU64(value.afterWorldRevision.residency)
    .writeBytes(hashBytes(value.beforeWorldHash, "before world hash", false))
    .writeBytes(hashBytes(value.afterWorldHash, "after world hash", false))
    .writeU16(value.creativeMode ? 1 : 0)
    .writeU16(containerKind)
    .writeString(value.inventory.container.id)
    .writeU16(value.inventory.container.ownerId === null ? 0 : 1);
  if (value.inventory.container.ownerId !== null) hasher.writeString(value.inventory.container.ownerId);
  hasher.writeU16(value.inventory.slot)
    .writeU64(value.inventory.beforeRevision)
    .writeU64(value.inventory.afterRevision);
  writeOptionalStackHash(hasher, value.inventory.beforeStack);
  writeOptionalStackHash(hasher, value.inventory.afterStack);
  hasher.writeU64(value.generatedDrops.length);
  for (const drop of value.generatedDrops) {
    hasher.writeBytes(hashBytes(
      rustIntegratedRuntimeBasicDirtGeneratedDropProvenanceHashV1(drop.provenance),
      "drop provenance hash",
      false,
    ));
    hasher.writeU64(drop.entityId);
  }
  return hasher
    .writeBytes(hashBytes(value.content.manifestHash, "content manifest hash", false))
    .writeBytes(hashBytes(value.content.installedRegistryHash, "content registry hash", false))
    .writeU16(value.content.catalogSchemaVersion)
    .writeU32(value.content.catalogContentVersion)
    .writeBytes(hashBytes(value.content.catalogBlobHash, "content catalog hash", false))
    .writeBytes(hashBytes(value.content.actionReportHash, "content action report hash", false))
    .writeBytes(hashBytes(value.content.subsetHash, "content subset hash", false))
    .finishHex();
}

function validateDrop(
  value: RustIntegratedRuntimeBasicDirtGeneratedDropProjectionV1,
  receipt: RustIntegratedRuntimeBasicDirtActionProjectionV1,
) {
  const provenance = value.provenance;
  if (provenance.schema !== 1 || provenance.blockId !== BASIC_DIRT_BLOCK_ID
    || provenance.originInputSequence !== receipt.originInputSequence
    || provenance.position.x !== receipt.position.x || provenance.position.y !== receipt.position.y
    || provenance.position.z !== receipt.position.z
    || provenance.manifestHash !== receipt.content.manifestHash
    || provenance.installedRegistryHash !== receipt.content.installedRegistryHash
    || provenance.catalogBlobHash !== receipt.content.catalogBlobHash
    || provenance.actionReportHash !== receipt.content.actionReportHash) {
    fail("basic-dirt-action-projection-provenance", "generated Dirt drop does not bind the exact action and content identity");
  }
  checkedU64(provenance.blockActionSequence, "drop block-action sequence");
  if (provenance.blockActionSequence === BigInt(0)) {
    fail("basic-dirt-action-projection-provenance", "drop block-action sequence is zero");
  }
  checkedInteger(provenance.originInputSequence, 1, MAX_SAFE_U64, "drop origin input sequence");
  checkedInteger(provenance.groupOrdinal, 0, MAX_GENERATED_DROPS - 1, "drop group ordinal");
  checkedHash(provenance.rngSemanticsHash, "drop RNG semantics hash", false);
  checkedHash(provenance.lootPlanHash, "drop loot-plan hash", false);
  checkedU64(value.entityId, "generated drop entity id");
  if (value.entityId === BigInt(0)) fail("basic-dirt-action-projection-drop", "generated Dirt drop entity id is zero");
  checkedStack(value.stack, "generated Dirt drop stack");
  for (const [label, vector, limit] of [
    ["generated drop position", value.position, WORLD_VIEW_COORDINATE_LIMIT_MILLI],
    ["generated drop velocity", value.velocityMilliPerSecond, WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND],
  ] as const) {
    checkedI64(vector.xMilli, `${label} x`);
    checkedI64(vector.yMilli, `${label} y`);
    checkedI64(vector.zMilli, `${label} z`);
    if ([vector.xMilli, vector.yMilli, vector.zMilli].some((component) =>
      (component < BigInt(0) ? -component : component) > limit)) {
      fail("basic-dirt-action-projection-spatial", `${label} exceeds its native fixed-point bound`);
    }
  }
  checkedInteger(value.rotation.yaw, 0, WORLD_VIEW_FRACTION_SCALE - 1, "generated drop yaw");
  checkedInteger(value.rotation.pitch, 0, WORLD_VIEW_FRACTION_SCALE - 1, "generated drop pitch");
  checkedInteger(value.rotation.roll, 0, WORLD_VIEW_FRACTION_SCALE - 1, "generated drop roll");
  if (value.rotation.yaw >= WORLD_VIEW_FRACTION_SCALE
    || value.rotation.pitch >= WORLD_VIEW_FRACTION_SCALE
    || value.rotation.roll >= WORLD_VIEW_FRACTION_SCALE) {
    fail("basic-dirt-action-projection-spatial", "generated Dirt drop rotation exceeds native fixed-point bounds");
  }
}

export function validateRustIntegratedRuntimeBasicDirtActionProjectionV1(
  value: RustIntegratedRuntimeBasicDirtActionProjectionV1,
  identity?: RustIntegratedRuntimeIdentityV1,
) {
  if (value.schema !== 1) fail("basic-dirt-action-projection-schema", "basic Dirt projection schema is not V1");
  checkedInteger(value.sequence, 1, MAX_SAFE_U64, "basic Dirt receipt sequence");
  checkedInteger(value.originInputSequence, 1, MAX_SAFE_U64, "basic Dirt origin input sequence");
  checkedInteger(value.completionTick, 0, MAX_SAFE_U64, "basic Dirt completion tick");
  if (identity && value.completionTick > identity.tick) {
    fail("basic-dirt-action-projection-tick", "basic Dirt completion tick is in the query identity's future");
  }
  for (const [label, coordinate] of Object.entries(value.position)) {
    checkedInteger(coordinate, -0x8000_0000, 0x7fff_ffff, `basic Dirt ${label} coordinate`);
  }
  if (value.position.y < WORLD_MIN_Y || value.position.y > WORLD_MAX_Y) {
    fail("basic-dirt-action-projection-position", "basic Dirt action lies outside the world height");
  }
  checkedInteger(value.priorBlockId, 0, 0xffff, "prior block id");
  checkedInteger(value.replacementBlockId, 0, 0xffff, "replacement block id");
  if (value.action === "mine") {
    if (value.priorBlockId !== BASIC_DIRT_BLOCK_ID || value.replacementBlockId !== AIR_BLOCK_ID) {
      fail("basic-dirt-action-projection-transition", "mining receipt is not an exact Dirt-to-Air transition");
    }
  } else if (value.action === "place") {
    if (value.priorBlockId === BASIC_DIRT_BLOCK_ID || value.replacementBlockId !== BASIC_DIRT_BLOCK_ID
      || value.generatedDrops.length !== 0 || value.inventory.beforeStack === null) {
      fail("basic-dirt-action-projection-transition", "placement receipt is not an exact non-Dirt-to-Dirt transition");
    }
  } else actionTag(value.action);
  const beforeWorld = value.beforeWorldRevision;
  const afterWorld = value.afterWorldRevision;
  for (const [label, revision] of [["before", beforeWorld], ["after", afterWorld]] as const) {
    checkedInteger(revision.epoch, 0, MAX_SAFE_U64, `${label} world epoch`);
    checkedInteger(revision.mutation, 0, MAX_SAFE_U64, `${label} world mutation`);
    checkedInteger(revision.residency, 0, MAX_SAFE_U64, `${label} world residency`);
  }
  checkedHash(value.beforeWorldHash, "before world hash", false);
  checkedHash(value.afterWorldHash, "after world hash", false);
  if (beforeWorld.epoch !== afterWorld.epoch || beforeWorld.residency !== afterWorld.residency
    || beforeWorld.mutation === MAX_SAFE_U64 || afterWorld.mutation !== beforeWorld.mutation + 1
    || value.beforeWorldHash === value.afterWorldHash) {
    fail("basic-dirt-action-projection-world", "basic Dirt receipt does not bind one exact world mutation");
  }
  if (typeof value.creativeMode !== "boolean") {
    fail("basic-dirt-action-projection-flag", "creative-mode flag is not boolean");
  }
  if (value.inventory.container.kind !== "player" || value.inventory.container.id.length === 0
    || value.inventory.container.ownerId === null || value.inventory.container.ownerId.length === 0) {
    fail("basic-dirt-action-projection-container", "basic Dirt inventory delta is not bound to an owned player container");
  }
  checkedInteger(value.inventory.slot, 0, 0xff, "basic Dirt inventory slot");
  checkedU64(value.inventory.beforeRevision, "before inventory revision");
  checkedU64(value.inventory.afterRevision, "after inventory revision");
  if (value.inventory.afterRevision < value.inventory.beforeRevision
    || value.inventory.afterRevision > value.inventory.beforeRevision + BigInt(1)) {
    fail("basic-dirt-action-projection-inventory", "basic Dirt inventory revision delta exceeds one mutation");
  }
  if (value.inventory.beforeStack !== null) checkedStack(value.inventory.beforeStack, "before inventory stack");
  if (value.inventory.afterStack !== null) checkedStack(value.inventory.afterStack, "after inventory stack");
  if (!Array.isArray(value.generatedDrops) || value.generatedDrops.length > MAX_GENERATED_DROPS) {
    fail("basic-dirt-action-projection-capacity", "basic Dirt generated-drop projection exceeds 32 entries");
  }
  const entityIds = new Set<bigint>();
  const ordinals = new Set<number>();
  for (const drop of value.generatedDrops) {
    validateDrop(drop, value);
    if (entityIds.has(drop.entityId) || ordinals.has(drop.provenance.groupOrdinal)) {
      fail("basic-dirt-action-projection-drop", "generated Dirt drop identity or group ordinal is duplicated");
    }
    entityIds.add(drop.entityId);
    ordinals.add(drop.provenance.groupOrdinal);
  }
  const content = value.content;
  checkedHash(content.manifestHash, "content manifest hash", false);
  checkedHash(content.installedRegistryHash, "content registry hash", false);
  checkedInteger(content.catalogSchemaVersion, 1, 0xffff, "content catalog schema version");
  checkedInteger(content.catalogContentVersion, 1, 0xffff_ffff, "content catalog version");
  checkedHash(content.catalogBlobHash, "content catalog hash", false);
  checkedHash(content.actionReportHash, "content action report hash", false);
  checkedHash(content.subsetHash, "content subset hash", false);
  if (content.subsetHash !== rustIntegratedRuntimeBasicDirtContentSubsetHashV1(content)) {
    fail("basic-dirt-action-projection-content", "basic Dirt content subset hash is not canonical");
  }
  checkedHash(value.receiptHash, "native basic Dirt receipt hash", false);
  if (value.receiptHash !== rustIntegratedRuntimeBasicDirtActionReceiptHashV1(value)) {
    fail("basic-dirt-action-projection-receipt-hash", "native basic Dirt receipt hash does not match its canonical fields");
  }
  return value;
}

function writeDrop(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeBasicDirtGeneratedDropProjectionV1,
) {
  const provenance = value.provenance;
  writer.u16(provenance.schema);
  for (const [hash, label] of [
    [provenance.manifestHash, "drop manifest hash"],
    [provenance.installedRegistryHash, "drop registry hash"],
    [provenance.catalogBlobHash, "drop catalog hash"],
    [provenance.actionReportHash, "drop action report hash"],
    [provenance.rngSemanticsHash, "drop RNG semantics hash"],
  ] as const) writer.raw(hashBytes(hash, label, false));
  writer.u64(provenance.blockActionSequence);
  writer.u64(BigInt(provenance.originInputSequence));
  writer.u16(provenance.blockId);
  writeI32(writer, provenance.position.x, "drop x");
  writeI32(writer, provenance.position.y, "drop y");
  writeI32(writer, provenance.position.z, "drop z");
  writer.raw(hashBytes(provenance.lootPlanHash, "drop loot-plan hash", false));
  writer.u16(provenance.groupOrdinal);
  writer.u64(value.entityId);
  writeRustIntegratedPlayerInventoryStackV1(writer, value.stack);
  for (const [label, vector] of [
    ["drop position", value.position],
    ["drop velocity", value.velocityMilliPerSecond],
  ] as const) {
    writeI64(writer, vector.xMilli, `${label} x`);
    writeI64(writer, vector.yMilli, `${label} y`);
    writeI64(writer, vector.zMilli, `${label} z`);
  }
  writer.u32(value.rotation.yaw);
  writer.u32(value.rotation.pitch);
  writer.u32(value.rotation.roll);
}

function readDrop(reader: RustIntegratedPlayerInventoryReaderV1) {
  const provenance = Object.freeze({
    schema: reader.u16() as 1,
    manifestHash: bytesHash(reader.take(16)),
    installedRegistryHash: bytesHash(reader.take(16)),
    catalogBlobHash: bytesHash(reader.take(16)),
    actionReportHash: bytesHash(reader.take(16)),
    rngSemanticsHash: bytesHash(reader.take(16)),
    blockActionSequence: reader.u64(),
    originInputSequence: safeNumber(reader.u64(), "drop origin input sequence", 1),
    blockId: reader.u16(),
    position: Object.freeze({ x: readI32(reader), y: readI32(reader), z: readI32(reader) }),
    lootPlanHash: bytesHash(reader.take(16)),
    groupOrdinal: reader.u16(),
  });
  return Object.freeze({
    provenance,
    entityId: reader.u64(),
    stack: readRustIntegratedPlayerInventoryStackV1(reader),
    position: Object.freeze({ xMilli: readI64(reader), yMilli: readI64(reader), zMilli: readI64(reader) }),
    velocityMilliPerSecond: Object.freeze({
      xMilli: readI64(reader), yMilli: readI64(reader), zMilli: readI64(reader),
    }),
    rotation: Object.freeze({ yaw: reader.u32(), pitch: reader.u32(), roll: reader.u32() }),
  });
}

function writeProjection(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeBasicDirtActionProjectionV1,
) {
  writer.u16(value.schema);
  writer.u64(BigInt(value.sequence));
  writer.u64(BigInt(value.originInputSequence));
  writer.u64(BigInt(value.completionTick));
  writer.u8(actionTag(value.action));
  writeI32(writer, value.position.x, "action x");
  writeI32(writer, value.position.y, "action y");
  writeI32(writer, value.position.z, "action z");
  writer.u16(value.priorBlockId);
  writer.u16(value.replacementBlockId);
  writeWorldRevision(writer, value.beforeWorldRevision);
  writeWorldRevision(writer, value.afterWorldRevision);
  writer.raw(hashBytes(value.beforeWorldHash, "before world hash", false));
  writer.raw(hashBytes(value.afterWorldHash, "after world hash", false));
  writer.u8(value.creativeMode ? 1 : 0);
  writeRustIntegratedContainerKeyV1(writer, value.inventory.container);
  writer.u16(value.inventory.slot);
  writer.u64(value.inventory.beforeRevision);
  writer.u64(value.inventory.afterRevision);
  writer.option(value.inventory.beforeStack, (stack) => writeRustIntegratedPlayerInventoryStackV1(writer, stack));
  writer.option(value.inventory.afterStack, (stack) => writeRustIntegratedPlayerInventoryStackV1(writer, stack));
  writer.u32(value.generatedDrops.length);
  for (const drop of value.generatedDrops) writeDrop(writer, drop);
  writer.raw(hashBytes(value.content.manifestHash, "content manifest hash", false));
  writer.raw(hashBytes(value.content.installedRegistryHash, "content registry hash", false));
  writer.u16(value.content.catalogSchemaVersion);
  writer.u32(value.content.catalogContentVersion);
  writer.raw(hashBytes(value.content.catalogBlobHash, "content catalog hash", false));
  writer.raw(hashBytes(value.content.actionReportHash, "content action report hash", false));
  writer.raw(hashBytes(value.content.subsetHash, "content subset hash", false));
  writer.raw(hashBytes(value.receiptHash, "native basic Dirt receipt hash", false));
}

function readProjection(reader: RustIntegratedPlayerInventoryReaderV1) {
  const schema = reader.u16() as 1;
  const sequence = safeNumber(reader.u64(), "basic Dirt receipt sequence", 1);
  const originInputSequence = safeNumber(reader.u64(), "basic Dirt origin input sequence", 1);
  const completionTick = safeNumber(reader.u64(), "basic Dirt completion tick");
  const action = readAction(reader);
  const position = Object.freeze({ x: readI32(reader), y: readI32(reader), z: readI32(reader) });
  const priorBlockId = reader.u16();
  const replacementBlockId = reader.u16();
  const beforeWorldRevision = readWorldRevision(reader);
  const afterWorldRevision = readWorldRevision(reader);
  const beforeWorldHash = bytesHash(reader.take(16));
  const afterWorldHash = bytesHash(reader.take(16));
  const creative = reader.u8();
  if (creative > 1) fail("basic-dirt-action-projection-flag", "native creative-mode flag is not boolean");
  const inventory = Object.freeze({
    container: readRustIntegratedContainerKeyV1(reader),
    slot: reader.u16(),
    beforeRevision: reader.u64(),
    afterRevision: reader.u64(),
    beforeStack: reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader)),
    afterStack: reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader)),
  });
  const dropCount = reader.u32();
  if (dropCount > MAX_GENERATED_DROPS) {
    fail("basic-dirt-action-projection-capacity", "native basic Dirt projection exceeds 32 generated drops");
  }
  const generatedDrops = Object.freeze(Array.from({ length: dropCount }, () => readDrop(reader)));
  return Object.freeze({
    schema,
    sequence,
    originInputSequence,
    completionTick,
    action,
    position,
    priorBlockId,
    replacementBlockId,
    beforeWorldRevision,
    afterWorldRevision,
    beforeWorldHash,
    afterWorldHash,
    creativeMode: creative === 1,
    inventory,
    generatedDrops,
    content: Object.freeze({
      manifestHash: bytesHash(reader.take(16)),
      installedRegistryHash: bytesHash(reader.take(16)),
      catalogSchemaVersion: reader.u16(),
      catalogContentVersion: reader.u32(),
      catalogBlobHash: bytesHash(reader.take(16)),
      actionReportHash: bytesHash(reader.take(16)),
      subsetHash: bytesHash(reader.take(16)),
    }),
    receiptHash: bytesHash(reader.take(16)),
  });
}

export function encodeRustIntegratedRuntimeBasicDirtActionQueryV1(
  value: RustIntegratedRuntimeBasicDirtActionQueryV1,
) {
  checkedInteger(value.afterSequence, 0, MAX_SAFE_U64, "basic Dirt query cursor");
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeIdentity(writer, value.expected);
  writer.u64(BigInt(value.afterSequence));
  return wrap(QUERY_MAGIC, QUERY_SCHEMA.innerSchema, writer.finish());
}

export function decodeRustIntegratedRuntimeBasicDirtActionQueryV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, QUERY_MAGIC, QUERY_SCHEMA.innerSchema));
  const value = Object.freeze({
    expected: readIdentity(reader),
    afterSequence: safeNumber(reader.u64(), "basic Dirt query cursor"),
  });
  reader.finish();
  return value;
}

function validateCursor(
  value: RustIntegratedRuntimeBasicDirtActionProjectionReceiptV1,
  expectedAfterSequence?: number,
) {
  checkedInteger(value.cursorAfter, 0, MAX_SAFE_U64, "basic Dirt response cursor");
  if (expectedAfterSequence === undefined) {
    if (value.receipt !== null && value.receipt.sequence !== value.cursorAfter) {
      fail("basic-dirt-action-projection-cursor", "basic Dirt response cursor does not identify its receipt");
    }
    return;
  }
  checkedInteger(expectedAfterSequence, 0, MAX_SAFE_U64, "basic Dirt query cursor");
  if (expectedAfterSequence === RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1) {
    if (value.receipt !== null) {
      fail("basic-dirt-action-projection-cursor", "legacy seed-only query attempted to replay a basic Dirt receipt");
    }
    return;
  }
  if (value.receipt === null) {
    if (value.cursorAfter !== expectedAfterSequence) {
      fail("basic-dirt-action-projection-cursor", "empty basic Dirt tail changed its contiguous cursor");
    }
    return;
  }
  if (expectedAfterSequence === MAX_SAFE_U64
    || value.receipt.sequence !== expectedAfterSequence + 1
    || value.cursorAfter !== value.receipt.sequence) {
    fail("basic-dirt-action-projection-cursor", "basic Dirt receipt tail is gapped, stale, or out of order");
  }
}

export function encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1(
  value: RustIntegratedRuntimeBasicDirtActionProjectionReceiptV1,
  expectedAfterSequence?: number,
) {
  checkedHash(value.requestPayloadHash, "basic Dirt request payload hash", false);
  if (value.receipt !== null) validateRustIntegratedRuntimeBasicDirtActionProjectionV1(value.receipt, value.identity);
  validateCursor(value, expectedAfterSequence);
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writer.raw(hashBytes(value.requestPayloadHash, "basic Dirt request payload hash", false));
  writeIdentity(writer, value.identity);
  writer.u64(BigInt(value.cursorAfter));
  writer.option(value.receipt, (receipt) => writeProjection(writer, receipt));
  return wrap(RECEIPT_MAGIC, RECEIPT_SCHEMA.innerSchema, writer.finish());
}

export function decodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1(
  packet: Uint8Array,
  expectedRequestPayloadHash?: string,
  expectedAfterSequence?: number,
) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, RECEIPT_MAGIC, RECEIPT_SCHEMA.innerSchema));
  const requestPayloadHash = bytesHash(reader.take(16));
  const identity = readIdentity(reader);
  const cursorAfter = safeNumber(reader.u64(), "basic Dirt response cursor");
  const receipt = reader.option(() => readProjection(reader));
  reader.finish();
  if (expectedRequestPayloadHash !== undefined && requestPayloadHash !== expectedRequestPayloadHash) {
    fail("basic-dirt-action-projection-request", "BWR7 does not attest the exact BWQ7 request payload");
  }
  const value = Object.freeze({ requestPayloadHash, identity, cursorAfter, receipt });
  if (receipt !== null) validateRustIntegratedRuntimeBasicDirtActionProjectionV1(receipt, identity);
  validateCursor(value, expectedAfterSequence);
  return value;
}

function validateOuterReceiptHash(receipt: RustIntegratedRuntimeCommandReceiptV1) {
  const bytes: number[] = [...hashBytes(receipt.commandHash, "basic Dirt command hash")];
  if (receipt.status === "accepted") {
    bytes.push(...hashBytes(receipt.before.stateHash, "basic Dirt before state hash"));
    bytes.push(...hashBytes(receipt.after.stateHash, "basic Dirt after state hash"));
    for (const operation of receipt.domainReceipts) {
      bytes.push(...hashBytes(operation.payloadHash, "basic Dirt domain receipt hash"));
    }
  } else {
    bytes.push(...hashBytes(receipt.current.stateHash, "basic Dirt current state hash"));
    bytes.push(...encoder.encode(receipt.code), ...encoder.encode(receipt.message));
  }
  if (receipt.receiptHash !== rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes))) {
    fail("basic-dirt-action-projection-command-receipt", "basic Dirt BWRQ receipt hash is invalid");
  }
}

export async function queryRustIntegratedRuntimeBasicDirtActionReceiptV1(
  service: RustIntegratedRuntimeBasicDirtActionServiceV1,
  afterSequence: number,
) {
  checkedInteger(afterSequence, 0, MAX_SAFE_U64, "basic Dirt query cursor");
  const expected = service.identity();
  const payload = encodeRustIntegratedRuntimeBasicDirtActionQueryV1({ expected, afterSequence });
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "gameplay",
    typeId: RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1,
    schema: QUERY_SCHEMA.operationSchema,
    payload,
  });
  const id = `basic-dirt-action-receipt:${expected.stateHash}:${afterSequence}`;
  const batch = createRustIntegratedRuntimeCommandBatchV1({
    commandId: id,
    idempotencyKey: id,
    actorId: "runtime:basic-dirt-action-receipt",
    expected,
    operations: Object.freeze([operation]),
  });
  const outer = await service.command(batch);
  if (outer.commandId !== batch.commandId || outer.idempotencyKey !== batch.idempotencyKey
    || outer.commandHash !== batch.commandHash) {
    fail("basic-dirt-action-projection-command-receipt", "BWRQ receipt does not identify the basic Dirt query batch");
  }
  validateOuterReceiptHash(outer);
  if (outer.status === "rejected") {
    if (!rustIntegratedRuntimeIdentityEqualsV1(outer.current, expected)
      || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) {
      fail("basic-dirt-action-projection-command-receipt", "rejected basic Dirt query moved the runtime identity");
    }
    fail(outer.code, outer.message);
  }
  const response = outer.domainReceipts[0];
  if (outer.domainReceipts.length !== 1 || !response || response.domain !== "gameplay"
    || response.typeId !== RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1
    || response.schema !== RECEIPT_SCHEMA.operationSchema
    || response.payloadHash !== rustIntegratedRuntimeWireChecksumV1(response.payload)
    || !rustIntegratedRuntimeIdentityEqualsV1(outer.before, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(outer.after, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) {
    fail("basic-dirt-action-projection-command-receipt", "basic Dirt query returned a mutating or incorrectly typed receipt");
  }
  const result = decodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1(
    response.payload,
    operation.payloadHash,
    afterSequence,
  );
  if (!rustIntegratedRuntimeIdentityEqualsV1(result.identity, expected)) {
    fail("basic-dirt-action-projection-identity", "BWR7 identity does not match the exact observed authority");
  }
  return Object.freeze({ ...result, projectionPayloadHash: response.payloadHash });
}
