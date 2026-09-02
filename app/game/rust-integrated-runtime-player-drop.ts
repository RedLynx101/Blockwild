import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow.ts";
import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec.ts";
import {
  rustIntegratedRuntimeIdentityEqualsV1,
  type RustIntegratedRuntimeCommandBatchV1,
  type RustIntegratedRuntimeCommandReceiptV1,
  type RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract.ts";
import {
  createRustIntegratedDomainWireDescriptorV1,
  unwrapRustIntegratedDomainPacketV1,
  wrapRustIntegratedDomainPacketV1,
  type RustIntegratedDomainWireFailureV1,
} from "./rust-integrated-runtime-domain-wire.ts";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated.ts";
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
import type {
  RustIntegratedRuntimeBasicDirtFixedVectorV1,
  RustIntegratedRuntimeBasicDirtRotationV1,
  RustIntegratedRuntimeBasicDirtWorldRevisionV1,
} from "./rust-integrated-runtime-basic-dirt-action.ts";
import type {
  RustIntegratedRuntimeDropPickupEntityIdentityV1,
  RustIntegratedRuntimeDropPickupGameplayIdentityV1,
  RustIntegratedRuntimeDropPickupGameplayRevisionV1,
  RustIntegratedRuntimeDropPickupWorldViewIdentityV1,
  RustIntegratedRuntimeDropPickupWorldViewRevisionV1,
} from "./rust-integrated-runtime-drop-pickup.ts";

const QUERY_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("native-player-drop-receipt-v1");
const RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("native-player-drop-projection-receipt-v1");

export const RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1 = QUERY_SCHEMA.typeId;
export const RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1 = RECEIPT_SCHEMA.typeId;
export const RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1 = Number.MAX_SAFE_INTEGER;
export const RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PICKUP_DELAY_TICKS_V1 = BigInt(7);

const QUERY_WIRE = createRustIntegratedDomainWireDescriptorV1({
  magic: QUERY_SCHEMA.magic,
  schema: QUERY_SCHEMA.innerSchema,
  label: "native player drop query",
});
const RECEIPT_WIRE = createRustIntegratedDomainWireDescriptorV1({
  magic: RECEIPT_SCHEMA.magic,
  schema: RECEIPT_SCHEMA.innerSchema,
  label: "native player drop projection receipt",
});
const MAX_SAFE_U64 = Number.MAX_SAFE_INTEGER;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const I64_MIN = -(BigInt(1) << BigInt(63));
const I64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);
const MAX_ITEM_STACK = 0x7fff_ffff;
const WORLD_VIEW_COORDINATE_LIMIT_MILLI = BigInt(33_554_432_000);
const WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND = BigInt(4_096_000);
const WORLD_VIEW_FRACTION_SCALE = 1_000_000;
const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const ZERO_HASH = "0".repeat(32);
const encoder = new TextEncoder();

export type RustIntegratedRuntimeNativePlayerDropContentBindingV1 = Readonly<{
  configuredManifestHash: string;
  installedManifestHash: string;
  installedRegistryHash: string;
  itemContentHash: string;
  itemContentVersion: number;
}>;

export type RustIntegratedRuntimeNativePlayerDropInventoryDeltaV1 = Readonly<{
  container: RustIntegratedContainerKeyV1;
  selectedSlot: number;
  beforeRevision: bigint;
  afterRevision: bigint;
  beforeStack: RustIntegratedPlayerInventoryStackV1;
  afterStack: RustIntegratedPlayerInventoryStackV1 | null;
}>;

export type RustIntegratedRuntimeNativePlayerDropSpawnV1 = Readonly<{
  dropId: string;
  entityId: bigint;
  stack: RustIntegratedPlayerInventoryStackV1;
  custodyContainer: RustIntegratedContainerKeyV1;
  custodySlot: number;
  custodyRevision: bigint;
  spatialRevision: bigint;
  position: RustIntegratedRuntimeBasicDirtFixedVectorV1;
  velocityMilliPerSecond: RustIntegratedRuntimeBasicDirtFixedVectorV1;
  rotation: RustIntegratedRuntimeBasicDirtRotationV1;
  createdTick: bigint;
  expiresTick: bigint | null;
  pickupLockActorId: string | null;
  pickupUnlockTick: bigint;
  originHash: string;
}>;

export type RustIntegratedRuntimeNativePlayerDropAuthorityEvidenceV1 = Readonly<{
  gameplay: Readonly<{
    before: RustIntegratedRuntimeDropPickupGameplayIdentityV1;
    after: RustIntegratedRuntimeDropPickupGameplayIdentityV1;
  }>;
  entity: Readonly<{
    before: RustIntegratedRuntimeDropPickupEntityIdentityV1;
    after: RustIntegratedRuntimeDropPickupEntityIdentityV1;
  }>;
  worldView: Readonly<{
    before: RustIntegratedRuntimeDropPickupWorldViewIdentityV1;
    after: RustIntegratedRuntimeDropPickupWorldViewIdentityV1;
  }>;
}>;

export type RustIntegratedRuntimeNativePlayerDropProjectionV1 = Readonly<{
  schema: 1;
  sequence: number;
  originInputSequence: number;
  completionTick: number;
  world: Readonly<{
    universeId: string;
    locationId: string;
    revision: RustIntegratedRuntimeBasicDirtWorldRevisionV1;
    canonicalStateHash: string;
  }>;
  player: Readonly<{
    playerId: bigint;
    entityId: bigint;
  }>;
  inventory: RustIntegratedRuntimeNativePlayerDropInventoryDeltaV1;
  drop: RustIntegratedRuntimeNativePlayerDropSpawnV1;
  authority: RustIntegratedRuntimeNativePlayerDropAuthorityEvidenceV1;
  content: RustIntegratedRuntimeNativePlayerDropContentBindingV1;
  receiptHash: string;
}>;

export type RustIntegratedRuntimeNativePlayerDropQueryV1 = Readonly<{
  expected: RustIntegratedRuntimeIdentityV1;
  afterSequence: number;
}>;

export type RustIntegratedRuntimeNativePlayerDropProjectionReceiptV1 = Readonly<{
  requestPayloadHash: string;
  identity: RustIntegratedRuntimeIdentityV1;
  cursorAfter: number;
  receipt: RustIntegratedRuntimeNativePlayerDropProjectionV1 | null;
}>;

export type RustIntegratedRuntimeNativePlayerDropObservedReceiptV1 =
  RustIntegratedRuntimeNativePlayerDropProjectionReceiptV1 & Readonly<{
    /** Exact BWRQ domain-operation payload hash over the complete BWS9 packet. */
    projectionPayloadHash: string;
  }>;

export interface RustIntegratedRuntimeNativePlayerDropServiceV1 {
  identity(): RustIntegratedRuntimeIdentityV1;
  command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1>;
}

export class RustIntegratedRuntimeNativePlayerDropErrorV1 extends Error {
  readonly name = "RustIntegratedRuntimeNativePlayerDropErrorV1";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedRuntimeNativePlayerDropErrorV1(code, message);
}

const failDomainWire: RustIntegratedDomainWireFailureV1 = (code, message) =>
  fail(`native-player-drop-projection-${code}`, message);

function checkedInteger(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("native-player-drop-projection-integer", `${label} is outside its exact integer range`);
  }
  return value;
}

function checkedU64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0) || value > U64_MAX) {
    fail("native-player-drop-projection-u64", `${label} is outside the u64 range`);
  }
  return value;
}

function checkedI64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < I64_MIN || value > I64_MAX) {
    fail("native-player-drop-projection-i64", `${label} is outside the i64 range`);
  }
  return value;
}

function safeNumber(value: bigint, label: string, minimum = 0) {
  if (value > BigInt(MAX_SAFE_U64)) {
    fail("native-player-drop-projection-u64", `${label} exceeds JavaScript's exact integer range`);
  }
  return checkedInteger(Number(value), minimum, MAX_SAFE_U64, label);
}

function checkedHash(value: string, label: string, allowZero = true) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value) || !allowZero && value === ZERO_HASH) {
    fail(
      "native-player-drop-projection-hash",
      `${label} is not a canonical${allowZero ? "" : " non-zero"} hash`,
    );
  }
  return value;
}

function hashBytes(value: string, label: string, allowZero = true) {
  checkedHash(value, label, allowZero);
  return Uint8Array.from(
    { length: 16 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function bytesHash(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function visibleString(value: string, label: string, maximumBytes = 160) {
  if (typeof value !== "string" || value.length === 0
    || encoder.encode(value).byteLength > maximumBytes
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || /[\ud800-\udfff]/u.test(value)) {
    fail("native-player-drop-projection-string", `${label} is not bounded visible UTF-8`);
  }
  return value;
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
  writer.string(value.universeId, "native player drop universe id");
  writer.string(value.locationId, "native player drop location id");
  for (const revision of [
    value.revision.epoch, value.revision.world, value.revision.entities, value.revision.gameplay,
    value.revision.persistence, value.revision.network, value.revision.simulation,
  ]) writer.u64(BigInt(checkedInteger(revision, 0, MAX_SAFE_U64, "runtime identity revision")));
  writer.u64(BigInt(checkedInteger(value.tick, 0, MAX_SAFE_U64, "runtime identity tick")));
  writer.raw(hashBytes(value.stateHash, "runtime identity state hash"));
}

function readIdentity(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedRuntimeIdentityV1 {
  if (reader.u16() !== 2) {
    fail("native-player-drop-projection-identity", "runtime identity schema is not V2");
  }
  return Object.freeze({
    universeId: reader.string("native player drop universe id"),
    locationId: reader.string("native player drop location id"),
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

function checkedStack(value: RustIntegratedPlayerInventoryStackV1, label: string) {
  if (value.itemCode < 1 || value.count < 1 || value.count > MAX_ITEM_STACK
    || value.durabilityMillionths !== null
      && (!Number.isInteger(value.durabilityMillionths) || value.durabilityMillionths < 0
        || value.durabilityMillionths > 1_000_000)) {
    fail("native-player-drop-projection-stack", `${label} is not an exact bounded item stack`);
  }
  checkedInteger(value.itemCode, 1, 0xffff_ffff, `${label} item code`);
  checkedInteger(value.count, 1, MAX_ITEM_STACK, `${label} count`);
  checkedHash(value.metadataHash, `${label} metadata hash`);
  return value;
}

function stackDescriptorEquals(
  left: RustIntegratedPlayerInventoryStackV1,
  right: RustIntegratedPlayerInventoryStackV1,
) {
  return left.itemCode === right.itemCode
    && left.durabilityMillionths === right.durabilityMillionths
    && left.metadataHash === right.metadataHash;
}

function writeStackHash(
  hasher: TypeScriptCanonicalHasher,
  value: RustIntegratedPlayerInventoryStackV1,
) {
  hasher.writeU32(value.itemCode).writeU32(value.count);
  if (value.durabilityMillionths === null) hasher.writeU16(0);
  else hasher.writeU16(1).writeU32(value.durabilityMillionths);
  return hasher.writeBytes(hashBytes(value.metadataHash, "item stack metadata hash"));
}

function writeOptionalStackHash(
  hasher: TypeScriptCanonicalHasher,
  value: RustIntegratedPlayerInventoryStackV1 | null,
) {
  if (value === null) return hasher.writeU16(0);
  hasher.writeU16(1);
  return writeStackHash(hasher, value);
}

function writeContainerHash(hasher: TypeScriptCanonicalHasher, value: RustIntegratedContainerKeyV1) {
  const kinds = ["player", "equipment", "container", "machine", "waygrid", "cardforge-case"] as const;
  const kind = kinds.indexOf(value.kind);
  if (kind < 0) fail("native-player-drop-projection-container", "inventory container kind is unknown");
  hasher.writeU16(kind).writeString(value.id).writeU16(value.ownerId === null ? 0 : 1);
  if (value.ownerId !== null) hasher.writeString(value.ownerId);
  return hasher;
}

function writeWorldRevisionHash(
  hasher: TypeScriptCanonicalHasher,
  value: RustIntegratedRuntimeBasicDirtWorldRevisionV1,
) {
  return hasher.writeU64(value.epoch).writeU64(value.mutation).writeU64(value.residency);
}

function writeGameplayRevisionHash(
  hasher: TypeScriptCanonicalHasher,
  value: RustIntegratedRuntimeDropPickupGameplayRevisionV1,
) {
  return hasher.writeU32(value.epoch).writeU64(value.sequence).writeU64(value.inventory)
    .writeU64(value.machines).writeU64(value.combat).writeU64(value.progression).writeU64(value.cardforge);
}

function writeWorldViewRevisionHash(
  hasher: TypeScriptCanonicalHasher,
  value: RustIntegratedRuntimeDropPickupWorldViewRevisionV1,
) {
  return hasher.writeU32(value.epoch).writeU64(value.sequence).writeU64(value.clock)
    .writeU64(value.machineAnchors).writeU64(value.droppedItems).writeU64(value.playerBindings)
    .writeU64(value.environment).writeU64(value.atmosphereGravity).writeU64(value.celestial);
}

function writeFixedVectorHash(
  hasher: TypeScriptCanonicalHasher,
  value: RustIntegratedRuntimeBasicDirtFixedVectorV1,
) {
  return hasher.writeU64(BigInt.asUintN(64, value.xMilli))
    .writeU64(BigInt.asUintN(64, value.yMilli))
    .writeU64(BigInt.asUintN(64, value.zMilli));
}

export function rustIntegratedRuntimeNativePlayerDropOriginHashV1(
  value: RustIntegratedRuntimeNativePlayerDropProjectionV1,
) {
  const hasher = new TypeScriptCanonicalHasher("blockwild.integrated.native-player-drop-origin.v1")
    .writeU16(value.schema)
    .writeU64(value.sequence)
    .writeU64(value.originInputSequence)
    .writeU64(value.completionTick)
    .writeString(value.world.universeId)
    .writeString(value.world.locationId);
  writeWorldRevisionHash(hasher, value.world.revision)
    .writeBytes(hashBytes(value.world.canonicalStateHash, "world canonical state hash", false))
    .writeU64(value.player.playerId)
    .writeU64(value.player.entityId);
  writeContainerHash(hasher, value.inventory.container)
    .writeU16(value.inventory.selectedSlot)
    .writeU64(value.inventory.beforeRevision)
    .writeU64(value.inventory.afterRevision);
  writeOptionalStackHash(hasher, value.inventory.beforeStack);
  writeOptionalStackHash(hasher, value.inventory.afterStack);
  hasher.writeString(value.drop.dropId);
  writeStackHash(hasher, value.drop.stack);
  writeContainerHash(hasher, value.drop.custodyContainer)
    .writeU16(value.drop.custodySlot)
    .writeU64(value.drop.custodyRevision)
    .writeU64(value.drop.spatialRevision);
  writeFixedVectorHash(hasher, value.drop.position);
  writeFixedVectorHash(hasher, value.drop.velocityMilliPerSecond);
  hasher.writeU32(value.drop.rotation.yaw)
    .writeU32(value.drop.rotation.pitch)
    .writeU32(value.drop.rotation.roll)
    .writeU64(value.drop.createdTick);
  if (value.drop.expiresTick === null) hasher.writeU16(0);
  else hasher.writeU16(1).writeU64(value.drop.expiresTick);
  if (value.drop.pickupLockActorId === null) hasher.writeU16(0);
  else hasher.writeU16(1).writeString(value.drop.pickupLockActorId);
  return hasher
    .writeU64(value.drop.pickupUnlockTick)
    .writeBytes(hashBytes(value.content.configuredManifestHash, "configured manifest hash", false))
    .writeBytes(hashBytes(value.content.installedManifestHash, "installed manifest hash", false))
    .writeBytes(hashBytes(value.content.installedRegistryHash, "installed registry hash", false))
    .writeBytes(hashBytes(value.content.itemContentHash, "item content hash", false))
    .writeU32(value.content.itemContentVersion)
    .finishHex();
}

export function rustIntegratedRuntimeNativePlayerDropReceiptHashV1(
  value: RustIntegratedRuntimeNativePlayerDropProjectionV1,
) {
  const authority = value.authority;
  const hasher = new TypeScriptCanonicalHasher("blockwild.integrated.native-player-drop-receipt.v1")
    .writeBytes(hashBytes(rustIntegratedRuntimeNativePlayerDropOriginHashV1(value), "player drop origin hash", false))
    .writeU64(value.drop.entityId)
    .writeBytes(hashBytes(value.drop.originHash, "drop origin hash", false));
  writeGameplayRevisionHash(hasher, authority.gameplay.before.revision)
    .writeBytes(hashBytes(authority.gameplay.before.canonicalStateHash, "before gameplay state hash", false));
  writeGameplayRevisionHash(hasher, authority.gameplay.after.revision)
    .writeBytes(hashBytes(authority.gameplay.after.canonicalStateHash, "after gameplay state hash", false));
  hasher.writeU64(authority.entity.before.revision)
    .writeBytes(hashBytes(authority.entity.before.canonicalStateHash, "before entity state hash", false))
    .writeU64(authority.entity.after.revision)
    .writeBytes(hashBytes(authority.entity.after.canonicalStateHash, "after entity state hash", false));
  writeWorldViewRevisionHash(hasher, authority.worldView.before.revision)
    .writeBytes(hashBytes(authority.worldView.before.canonicalStateHash, "before world-view state hash", false));
  writeWorldViewRevisionHash(hasher, authority.worldView.after.revision)
    .writeBytes(hashBytes(authority.worldView.after.canonicalStateHash, "after world-view state hash", false));
  return hasher.finishHex();
}

function validateWorldRevision(value: RustIntegratedRuntimeBasicDirtWorldRevisionV1) {
  checkedInteger(value.epoch, 0, MAX_SAFE_U64, "world epoch");
  checkedInteger(value.mutation, 0, MAX_SAFE_U64, "world mutation revision");
  checkedInteger(value.residency, 0, MAX_SAFE_U64, "world residency revision");
}

function validateGameplayRevision(value: RustIntegratedRuntimeDropPickupGameplayRevisionV1, label: string) {
  checkedInteger(value.epoch, 0, 0xffff_ffff, `${label} gameplay epoch`);
  for (const [key, revision] of Object.entries(value).filter(([key]) => key !== "epoch")) {
    checkedU64(revision as bigint, `${label} gameplay ${key} revision`);
  }
}

function validateWorldViewRevision(value: RustIntegratedRuntimeDropPickupWorldViewRevisionV1, label: string) {
  checkedInteger(value.epoch, 0, 0xffff_ffff, `${label} world-view epoch`);
  for (const [key, revision] of Object.entries(value).filter(([key]) => key !== "epoch")) {
    checkedU64(revision as bigint, `${label} world-view ${key} revision`);
  }
}

function validateVector(
  value: RustIntegratedRuntimeBasicDirtFixedVectorV1,
  limit: bigint,
  label: string,
) {
  for (const [axis, component] of Object.entries(value)) {
    checkedI64(component, `${label} ${axis}`);
    if (component < -limit || component > limit) {
      fail("native-player-drop-projection-spatial", `${label} ${axis} exceeds its native fixed-point bound`);
    }
  }
}

function validateGameplayTransition(
  before: RustIntegratedRuntimeDropPickupGameplayIdentityV1,
  after: RustIntegratedRuntimeDropPickupGameplayIdentityV1,
) {
  validateGameplayRevision(before.revision, "before");
  validateGameplayRevision(after.revision, "after");
  checkedHash(before.canonicalStateHash, "before gameplay state hash", false);
  checkedHash(after.canonicalStateHash, "after gameplay state hash", false);
  const b = before.revision;
  const a = after.revision;
  if (a.epoch !== b.epoch || a.sequence !== b.sequence + BigInt(1)
    || a.inventory !== b.inventory + BigInt(1)
    || a.machines !== b.machines || a.combat !== b.combat
    || a.progression !== b.progression || a.cardforge !== b.cardforge
    || before.canonicalStateHash === after.canonicalStateHash) {
    fail("native-player-drop-projection-gameplay", "player drop does not attest one exact inventory transition");
  }
}

function validateWorldViewTransition(
  before: RustIntegratedRuntimeDropPickupWorldViewIdentityV1,
  after: RustIntegratedRuntimeDropPickupWorldViewIdentityV1,
) {
  validateWorldViewRevision(before.revision, "before");
  validateWorldViewRevision(after.revision, "after");
  checkedHash(before.canonicalStateHash, "before world-view state hash", false);
  checkedHash(after.canonicalStateHash, "after world-view state hash", false);
  const b = before.revision;
  const a = after.revision;
  if (a.epoch !== b.epoch || a.sequence !== b.sequence + BigInt(1)
    || a.droppedItems !== b.droppedItems + BigInt(1)
    || a.clock !== b.clock || a.machineAnchors !== b.machineAnchors
    || a.playerBindings !== b.playerBindings || a.environment !== b.environment
    || a.atmosphereGravity !== b.atmosphereGravity || a.celestial !== b.celestial
    || before.canonicalStateHash === after.canonicalStateHash) {
    fail("native-player-drop-projection-world-view", "player drop does not attest one exact world-view creation");
  }
}

export function validateRustIntegratedRuntimeNativePlayerDropProjectionV1(
  value: RustIntegratedRuntimeNativePlayerDropProjectionV1,
  identity?: RustIntegratedRuntimeIdentityV1,
) {
  if (value.schema !== 1) {
    fail("native-player-drop-projection-schema", "native player drop projection schema is not V1");
  }
  checkedInteger(value.sequence, 1, MAX_SAFE_U64, "native player drop receipt sequence");
  checkedInteger(value.originInputSequence, 1, MAX_SAFE_U64, "native player drop origin input sequence");
  checkedInteger(value.completionTick, 0, MAX_SAFE_U64, "native player drop completion tick");
  if (identity && value.completionTick > identity.tick) {
    fail("native-player-drop-projection-tick", "native player drop completion tick is in the query identity's future");
  }
  visibleString(value.world.universeId, "native player drop universe id");
  visibleString(value.world.locationId, "native player drop location id");
  if (identity && (value.world.universeId !== identity.universeId || value.world.locationId !== identity.locationId)) {
    fail("native-player-drop-projection-world", "native player drop world does not match the queried runtime");
  }
  validateWorldRevision(value.world.revision);
  checkedHash(value.world.canonicalStateHash, "world canonical state hash", false);
  checkedU64(value.player.playerId, "player id");
  checkedU64(value.player.entityId, "player entity id");
  if (value.player.playerId === BigInt(0) || value.player.entityId === BigInt(0)) {
    fail("native-player-drop-projection-player", "native player drop identities must be non-zero");
  }

  const inventory = value.inventory;
  if (inventory.container.kind !== "player" || inventory.container.id.length === 0
    || inventory.container.ownerId === null || inventory.container.ownerId.length === 0) {
    fail("native-player-drop-projection-inventory", "native player drop source is not an owned player inventory");
  }
  visibleString(inventory.container.id, "player inventory id");
  visibleString(inventory.container.ownerId, "player inventory owner");
  checkedInteger(inventory.selectedSlot, 0, 8, "native player drop selected slot");
  checkedU64(inventory.beforeRevision, "inventory before revision");
  checkedU64(inventory.afterRevision, "inventory after revision");
  checkedStack(inventory.beforeStack, "native player drop before stack");
  if (inventory.afterStack !== null) checkedStack(inventory.afterStack, "native player drop after stack");
  checkedStack(value.drop.stack, "native player drop spawned stack");
  const expectedAfterCount = inventory.beforeStack.count - 1;
  if (inventory.afterRevision !== inventory.beforeRevision + BigInt(1)
    || !stackDescriptorEquals(inventory.beforeStack, value.drop.stack)
    || value.drop.stack.count !== 1
    || expectedAfterCount === 0 && inventory.afterStack !== null
    || expectedAfterCount > 0 && (inventory.afterStack === null
      || !stackDescriptorEquals(inventory.beforeStack, inventory.afterStack)
      || inventory.afterStack.count !== expectedAfterCount)) {
    fail(
      "native-player-drop-projection-inventory-transition",
      "native player drop does not conserve exactly one selected-stack unit",
    );
  }

  const drop = value.drop;
  visibleString(drop.dropId, "native player drop id");
  checkedU64(drop.entityId, "native player drop entity id");
  if (drop.entityId === BigInt(0) || drop.custodyContainer.kind !== "container"
    || drop.custodyContainer.id.length === 0 || drop.custodyContainer.ownerId !== null
    || drop.custodySlot !== 0 || drop.custodyRevision !== BigInt(0) || drop.spatialRevision !== BigInt(0)) {
    fail("native-player-drop-projection-spawn", "native player drop custody or entity evidence is invalid");
  }
  visibleString(drop.custodyContainer.id, "native player drop custody id");
  checkedU64(drop.custodyRevision, "native player drop custody revision");
  checkedU64(drop.spatialRevision, "native player drop spatial revision");
  validateVector(drop.position, WORLD_VIEW_COORDINATE_LIMIT_MILLI, "native player drop position");
  validateVector(
    drop.velocityMilliPerSecond,
    WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND,
    "native player drop velocity",
  );
  for (const [axis, rotation] of Object.entries(drop.rotation)) {
    checkedInteger(rotation, 0, WORLD_VIEW_FRACTION_SCALE - 1, `native player drop ${axis} rotation`);
  }
  checkedU64(drop.createdTick, "native player drop created tick");
  if (drop.createdTick > BigInt(value.completionTick)
    || BigInt(value.completionTick) - drop.createdTick > BigInt(1)) {
    fail("native-player-drop-projection-spawn", "native player drop creation tick is outside its completion window");
  }
  if (drop.expiresTick !== null) {
    checkedU64(drop.expiresTick, "native player drop expiry tick");
    if (drop.expiresTick <= drop.createdTick || drop.expiresTick < drop.pickupUnlockTick) {
      fail("native-player-drop-projection-spawn", "native player drop expiry precedes its pickup window");
    }
  }
  if (drop.pickupLockActorId !== null) {
    visibleString(drop.pickupLockActorId, "native player drop pickup lock actor");
  }
  checkedU64(drop.pickupUnlockTick, "native player drop pickup unlock tick");
  if (drop.pickupLockActorId !== null
    || drop.pickupUnlockTick !== drop.createdTick + RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PICKUP_DELAY_TICKS_V1) {
    fail("native-player-drop-projection-spawn", "native player drop pickup lock evidence is invalid");
  }

  const content = value.content;
  checkedHash(content.configuredManifestHash, "configured manifest hash", false);
  checkedHash(content.installedManifestHash, "installed manifest hash", false);
  checkedHash(content.installedRegistryHash, "installed registry hash", false);
  checkedHash(content.itemContentHash, "item content hash", false);
  checkedInteger(content.itemContentVersion, 1, 0xffff_ffff, "item content version");
  if (content.configuredManifestHash !== content.installedManifestHash) {
    fail("native-player-drop-projection-content", "native player drop does not bind the configured manifest");
  }
  checkedHash(drop.originHash, "native player drop origin hash", false);
  if (drop.originHash !== rustIntegratedRuntimeNativePlayerDropOriginHashV1(value)) {
    fail("native-player-drop-projection-origin-hash", "native player drop origin hash is not canonical");
  }

  validateGameplayTransition(value.authority.gameplay.before, value.authority.gameplay.after);
  checkedU64(value.authority.entity.before.revision, "before entity revision");
  checkedU64(value.authority.entity.after.revision, "after entity revision");
  checkedHash(value.authority.entity.before.canonicalStateHash, "before entity state hash", false);
  checkedHash(value.authority.entity.after.canonicalStateHash, "after entity state hash", false);
  if (value.authority.entity.after.revision !== value.authority.entity.before.revision + BigInt(1)
    || value.authority.entity.before.canonicalStateHash === value.authority.entity.after.canonicalStateHash) {
    fail("native-player-drop-projection-entity", "native player drop does not attest one exact entity creation");
  }
  validateWorldViewTransition(value.authority.worldView.before, value.authority.worldView.after);
  checkedHash(value.receiptHash, "native player drop receipt hash", false);
  if (value.receiptHash !== rustIntegratedRuntimeNativePlayerDropReceiptHashV1(value)) {
    fail("native-player-drop-projection-receipt-hash", "native player drop receipt hash is not canonical");
  }
  return value;
}

function writeWorldRevision(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeBasicDirtWorldRevisionV1,
) {
  writer.u64(BigInt(value.epoch));
  writer.u64(BigInt(value.mutation));
  writer.u64(BigInt(value.residency));
}

function readWorldRevision(reader: RustIntegratedPlayerInventoryReaderV1) {
  return Object.freeze({
    epoch: safeNumber(reader.u64(), "world epoch"),
    mutation: safeNumber(reader.u64(), "world mutation revision"),
    residency: safeNumber(reader.u64(), "world residency revision"),
  });
}

function writeGameplayRevision(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeDropPickupGameplayRevisionV1,
) {
  writer.u32(value.epoch);
  writer.u64(value.sequence);
  writer.u64(value.inventory);
  writer.u64(value.machines);
  writer.u64(value.combat);
  writer.u64(value.progression);
  writer.u64(value.cardforge);
}

function readGameplayRevision(reader: RustIntegratedPlayerInventoryReaderV1) {
  return Object.freeze({
    epoch: reader.u32(),
    sequence: reader.u64(),
    inventory: reader.u64(),
    machines: reader.u64(),
    combat: reader.u64(),
    progression: reader.u64(),
    cardforge: reader.u64(),
  });
}

function writeWorldViewRevision(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeDropPickupWorldViewRevisionV1,
) {
  writer.u32(value.epoch);
  writer.u64(value.sequence);
  writer.u64(value.clock);
  writer.u64(value.machineAnchors);
  writer.u64(value.droppedItems);
  writer.u64(value.playerBindings);
  writer.u64(value.environment);
  writer.u64(value.atmosphereGravity);
  writer.u64(value.celestial);
}

function readWorldViewRevision(reader: RustIntegratedPlayerInventoryReaderV1) {
  return Object.freeze({
    epoch: reader.u32(),
    sequence: reader.u64(),
    clock: reader.u64(),
    machineAnchors: reader.u64(),
    droppedItems: reader.u64(),
    playerBindings: reader.u64(),
    environment: reader.u64(),
    atmosphereGravity: reader.u64(),
    celestial: reader.u64(),
  });
}

function writeProjection(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeNativePlayerDropProjectionV1,
) {
  writer.u16(value.schema);
  writer.u64(BigInt(value.sequence));
  writer.u64(BigInt(value.originInputSequence));
  writer.u64(BigInt(value.completionTick));
  writer.string(value.world.universeId, "native player drop universe id");
  writer.string(value.world.locationId, "native player drop location id");
  writeWorldRevision(writer, value.world.revision);
  writer.raw(hashBytes(value.world.canonicalStateHash, "world canonical state hash", false));
  writer.u64(value.player.playerId);
  writer.u64(value.player.entityId);
  writeRustIntegratedContainerKeyV1(writer, value.inventory.container);
  writer.u16(value.inventory.selectedSlot);
  writer.u64(value.inventory.beforeRevision);
  writer.u64(value.inventory.afterRevision);
  writer.option(value.inventory.beforeStack, (stack) => writeRustIntegratedPlayerInventoryStackV1(writer, stack));
  writer.option(value.inventory.afterStack, (stack) => writeRustIntegratedPlayerInventoryStackV1(writer, stack));
  writer.string(value.drop.dropId, "native player drop id");
  writer.u64(value.drop.entityId);
  writeRustIntegratedPlayerInventoryStackV1(writer, value.drop.stack);
  writeRustIntegratedContainerKeyV1(writer, value.drop.custodyContainer);
  writer.u16(value.drop.custodySlot);
  writer.u64(value.drop.custodyRevision);
  writer.u64(value.drop.spatialRevision);
  for (const [label, vector] of [
    ["native player drop position", value.drop.position],
    ["native player drop velocity", value.drop.velocityMilliPerSecond],
  ] as const) {
    writeI64(writer, vector.xMilli, `${label} x`);
    writeI64(writer, vector.yMilli, `${label} y`);
    writeI64(writer, vector.zMilli, `${label} z`);
  }
  writer.u32(value.drop.rotation.yaw);
  writer.u32(value.drop.rotation.pitch);
  writer.u32(value.drop.rotation.roll);
  writer.u64(value.drop.createdTick);
  writer.option(value.drop.expiresTick, (tick) => writer.u64(tick));
  writer.option(value.drop.pickupLockActorId, (actorId) => writer.string(actorId, "pickup lock actor"));
  writer.u64(value.drop.pickupUnlockTick);
  writer.raw(hashBytes(value.drop.originHash, "native player drop origin hash", false));
  writeGameplayRevision(writer, value.authority.gameplay.before.revision);
  writer.raw(hashBytes(value.authority.gameplay.before.canonicalStateHash, "before gameplay state hash", false));
  writeGameplayRevision(writer, value.authority.gameplay.after.revision);
  writer.raw(hashBytes(value.authority.gameplay.after.canonicalStateHash, "after gameplay state hash", false));
  writer.u64(value.authority.entity.before.revision);
  writer.raw(hashBytes(value.authority.entity.before.canonicalStateHash, "before entity state hash", false));
  writer.u64(value.authority.entity.after.revision);
  writer.raw(hashBytes(value.authority.entity.after.canonicalStateHash, "after entity state hash", false));
  writeWorldViewRevision(writer, value.authority.worldView.before.revision);
  writer.raw(hashBytes(value.authority.worldView.before.canonicalStateHash, "before world-view state hash", false));
  writeWorldViewRevision(writer, value.authority.worldView.after.revision);
  writer.raw(hashBytes(value.authority.worldView.after.canonicalStateHash, "after world-view state hash", false));
  writer.raw(hashBytes(value.content.configuredManifestHash, "configured manifest hash", false));
  writer.raw(hashBytes(value.content.installedManifestHash, "installed manifest hash", false));
  writer.raw(hashBytes(value.content.installedRegistryHash, "installed registry hash", false));
  writer.raw(hashBytes(value.content.itemContentHash, "item content hash", false));
  writer.u32(value.content.itemContentVersion);
  writer.raw(hashBytes(value.receiptHash, "native player drop receipt hash", false));
}

function readProjection(reader: RustIntegratedPlayerInventoryReaderV1) {
  const schema = reader.u16() as 1;
  const sequence = safeNumber(reader.u64(), "native player drop receipt sequence", 1);
  const originInputSequence = safeNumber(reader.u64(), "native player drop origin input sequence", 1);
  const completionTick = safeNumber(reader.u64(), "native player drop completion tick");
  const world = Object.freeze({
    universeId: reader.string("native player drop universe id"),
    locationId: reader.string("native player drop location id"),
    revision: readWorldRevision(reader),
    canonicalStateHash: bytesHash(reader.take(16)),
  });
  const player = Object.freeze({ playerId: reader.u64(), entityId: reader.u64() });
  const inventoryContainer = readRustIntegratedContainerKeyV1(reader);
  const selectedSlot = reader.u16();
  const inventoryBeforeRevision = reader.u64();
  const inventoryAfterRevision = reader.u64();
  const beforeStack = reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader));
  const afterStack = reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader));
  if (beforeStack === null) {
    fail("native-player-drop-projection-inventory", "native player drop omitted its exact before stack");
  }
  const inventory = Object.freeze({
    container: inventoryContainer,
    selectedSlot,
    beforeRevision: inventoryBeforeRevision,
    afterRevision: inventoryAfterRevision,
    beforeStack,
    afterStack,
  });
  const dropId = reader.string("native player drop id");
  const entityId = reader.u64();
  const stack = readRustIntegratedPlayerInventoryStackV1(reader);
  const custodyContainer = readRustIntegratedContainerKeyV1(reader);
  const custodySlot = reader.u16();
  const custodyRevision = reader.u64();
  const spatialRevision = reader.u64();
  const position = Object.freeze({ xMilli: readI64(reader), yMilli: readI64(reader), zMilli: readI64(reader) });
  const velocityMilliPerSecond = Object.freeze({
    xMilli: readI64(reader), yMilli: readI64(reader), zMilli: readI64(reader),
  });
  const rotation = Object.freeze({ yaw: reader.u32(), pitch: reader.u32(), roll: reader.u32() });
  const createdTick = reader.u64();
  const expiresTick = reader.option(() => reader.u64());
  const pickupLockActorId = reader.option(() => reader.string("pickup lock actor"));
  const pickupUnlockTick = reader.u64();
  const originHash = bytesHash(reader.take(16));
  const drop = Object.freeze({
    dropId,
    entityId,
    stack,
    custodyContainer,
    custodySlot,
    custodyRevision,
    spatialRevision,
    position,
    velocityMilliPerSecond,
    rotation,
    createdTick,
    expiresTick,
    pickupLockActorId,
    pickupUnlockTick,
    originHash,
  });
  const gameplayBefore = Object.freeze({
    revision: readGameplayRevision(reader), canonicalStateHash: bytesHash(reader.take(16)),
  });
  const gameplayAfter = Object.freeze({
    revision: readGameplayRevision(reader), canonicalStateHash: bytesHash(reader.take(16)),
  });
  const entityBefore = Object.freeze({ revision: reader.u64(), canonicalStateHash: bytesHash(reader.take(16)) });
  const entityAfter = Object.freeze({ revision: reader.u64(), canonicalStateHash: bytesHash(reader.take(16)) });
  const worldViewBefore = Object.freeze({
    revision: readWorldViewRevision(reader), canonicalStateHash: bytesHash(reader.take(16)),
  });
  const worldViewAfter = Object.freeze({
    revision: readWorldViewRevision(reader), canonicalStateHash: bytesHash(reader.take(16)),
  });
  const authority = Object.freeze({
    gameplay: Object.freeze({ before: gameplayBefore, after: gameplayAfter }),
    entity: Object.freeze({ before: entityBefore, after: entityAfter }),
    worldView: Object.freeze({ before: worldViewBefore, after: worldViewAfter }),
  });
  const content = Object.freeze({
    configuredManifestHash: bytesHash(reader.take(16)),
    installedManifestHash: bytesHash(reader.take(16)),
    installedRegistryHash: bytesHash(reader.take(16)),
    itemContentHash: bytesHash(reader.take(16)),
    itemContentVersion: reader.u32(),
  });
  return Object.freeze({
    schema,
    sequence,
    originInputSequence,
    completionTick,
    world,
    player,
    inventory,
    drop,
    authority,
    content,
    receiptHash: bytesHash(reader.take(16)),
  });
}

export function encodeRustIntegratedRuntimeNativePlayerDropQueryV1(
  value: RustIntegratedRuntimeNativePlayerDropQueryV1,
) {
  checkedInteger(value.afterSequence, 0, MAX_SAFE_U64, "native player drop query cursor");
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeIdentity(writer, value.expected);
  writer.u64(BigInt(value.afterSequence));
  return wrapRustIntegratedDomainPacketV1(QUERY_WIRE, writer.finish(), failDomainWire);
}

export function decodeRustIntegratedRuntimeNativePlayerDropQueryV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(
    unwrapRustIntegratedDomainPacketV1(QUERY_WIRE, packet, failDomainWire),
  );
  const value = Object.freeze({
    expected: readIdentity(reader),
    afterSequence: safeNumber(reader.u64(), "native player drop query cursor"),
  });
  reader.finish();
  return value;
}

function validateCursor(
  value: RustIntegratedRuntimeNativePlayerDropProjectionReceiptV1,
  expectedAfterSequence?: number,
) {
  checkedInteger(value.cursorAfter, 0, MAX_SAFE_U64, "native player drop response cursor");
  if (expectedAfterSequence === undefined) {
    if (value.receipt !== null && value.receipt.sequence !== value.cursorAfter) {
      fail("native-player-drop-projection-cursor", "native player drop cursor does not identify its receipt");
    }
    return;
  }
  checkedInteger(expectedAfterSequence, 0, MAX_SAFE_U64, "native player drop query cursor");
  if (expectedAfterSequence === RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1) {
    if (value.receipt !== null) {
      fail("native-player-drop-projection-cursor", "legacy seed-only query attempted to replay a player-drop receipt");
    }
    return;
  }
  if (value.receipt === null) {
    if (value.cursorAfter !== expectedAfterSequence) {
      fail("native-player-drop-projection-cursor", "empty player-drop tail changed its contiguous cursor");
    }
    return;
  }
  if (expectedAfterSequence === MAX_SAFE_U64
    || value.receipt.sequence !== expectedAfterSequence + 1
    || value.cursorAfter !== value.receipt.sequence) {
    fail("native-player-drop-projection-cursor", "player-drop receipt tail is gapped, stale, or out of order");
  }
}

export function encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(
  value: RustIntegratedRuntimeNativePlayerDropProjectionReceiptV1,
  expectedAfterSequence?: number,
) {
  checkedHash(value.requestPayloadHash, "native player drop request payload hash", false);
  if (value.receipt !== null) validateRustIntegratedRuntimeNativePlayerDropProjectionV1(value.receipt, value.identity);
  validateCursor(value, expectedAfterSequence);
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writer.raw(hashBytes(value.requestPayloadHash, "native player drop request payload hash", false));
  writeIdentity(writer, value.identity);
  writer.u64(BigInt(value.cursorAfter));
  writer.option(value.receipt, (receipt) => writeProjection(writer, receipt));
  return wrapRustIntegratedDomainPacketV1(RECEIPT_WIRE, writer.finish(), failDomainWire);
}

export function decodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(
  packet: Uint8Array,
  expectedRequestPayloadHash?: string,
  expectedAfterSequence?: number,
) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(
    unwrapRustIntegratedDomainPacketV1(RECEIPT_WIRE, packet, failDomainWire),
  );
  const requestPayloadHash = bytesHash(reader.take(16));
  const identity = readIdentity(reader);
  const cursorAfter = safeNumber(reader.u64(), "native player drop response cursor");
  const receipt = reader.option(() => readProjection(reader));
  reader.finish();
  if (expectedRequestPayloadHash !== undefined && requestPayloadHash !== expectedRequestPayloadHash) {
    fail("native-player-drop-projection-request", "BWS9 does not attest the exact BWQ9 request payload");
  }
  const value = Object.freeze({ requestPayloadHash, identity, cursorAfter, receipt });
  if (receipt !== null) validateRustIntegratedRuntimeNativePlayerDropProjectionV1(receipt, identity);
  validateCursor(value, expectedAfterSequence);
  return value;
}

function validateOuterReceiptHash(receipt: RustIntegratedRuntimeCommandReceiptV1) {
  const bytes: number[] = [...hashBytes(receipt.commandHash, "native player drop command hash")];
  if (receipt.status === "accepted") {
    bytes.push(...hashBytes(receipt.before.stateHash, "native player drop before state hash"));
    bytes.push(...hashBytes(receipt.after.stateHash, "native player drop after state hash"));
    for (const operation of receipt.domainReceipts) {
      bytes.push(...hashBytes(operation.payloadHash, "native player drop domain receipt hash"));
    }
  } else {
    bytes.push(...hashBytes(receipt.current.stateHash, "native player drop current state hash"));
    bytes.push(...encoder.encode(receipt.code), ...encoder.encode(receipt.message));
  }
  if (receipt.receiptHash !== rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes))) {
    fail("native-player-drop-projection-command-receipt", "native player drop BWRQ receipt hash is invalid");
  }
}

export async function queryRustIntegratedRuntimeNativePlayerDropReceiptV1(
  service: RustIntegratedRuntimeNativePlayerDropServiceV1,
  afterSequence: number,
) {
  checkedInteger(afterSequence, 0, MAX_SAFE_U64, "native player drop query cursor");
  const expected = service.identity();
  const payload = encodeRustIntegratedRuntimeNativePlayerDropQueryV1({ expected, afterSequence });
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "gameplay",
    typeId: RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1,
    schema: QUERY_SCHEMA.operationSchema,
    payload,
  });
  const id = `native-player-drop-receipt:${expected.stateHash}:${afterSequence}`;
  const batch = createRustIntegratedRuntimeCommandBatchV1({
    commandId: id,
    idempotencyKey: id,
    actorId: "runtime:native-player-drop-receipt",
    expected,
    operations: Object.freeze([operation]),
  });
  const outer = await service.command(batch);
  if (outer.commandId !== batch.commandId || outer.idempotencyKey !== batch.idempotencyKey
    || outer.commandHash !== batch.commandHash) {
    fail("native-player-drop-projection-command-receipt", "BWRQ receipt does not identify the player-drop query batch");
  }
  validateOuterReceiptHash(outer);
  if (outer.status === "rejected") {
    if (!rustIntegratedRuntimeIdentityEqualsV1(outer.current, expected)
      || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) {
      fail("native-player-drop-projection-command-receipt", "rejected player-drop query moved runtime identity");
    }
    fail(outer.code, outer.message);
  }
  const response = outer.domainReceipts[0];
  if (outer.domainReceipts.length !== 1 || !response || response.domain !== "gameplay"
    || response.typeId !== RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1
    || response.schema !== RECEIPT_SCHEMA.operationSchema
    || response.payloadHash !== rustIntegratedRuntimeWireChecksumV1(response.payload)
    || !rustIntegratedRuntimeIdentityEqualsV1(outer.before, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(outer.after, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) {
    fail(
      "native-player-drop-projection-command-receipt",
      "player-drop query returned a mutating or incorrectly typed receipt",
    );
  }
  const result = decodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(
    response.payload,
    operation.payloadHash,
    afterSequence,
  );
  if (!rustIntegratedRuntimeIdentityEqualsV1(result.identity, expected)) {
    fail("native-player-drop-projection-identity", "BWS9 identity does not match the exact observed authority");
  }
  return Object.freeze({ ...result, projectionPayloadHash: response.payloadHash });
}
