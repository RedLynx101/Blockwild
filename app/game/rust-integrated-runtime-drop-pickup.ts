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
import {
  rustIntegratedRuntimeBasicDirtGeneratedDropProvenanceHashV1,
  type RustIntegratedRuntimeBasicDirtFixedVectorV1,
  type RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1,
  type RustIntegratedRuntimeBasicDirtRotationV1,
  type RustIntegratedRuntimeBasicDirtWorldRevisionV1,
} from "./rust-integrated-runtime-basic-dirt-action.ts";

const QUERY_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("native-drop-pickup-receipt-v1");
const RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("native-drop-pickup-projection-receipt-v1");

export const RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1 = QUERY_SCHEMA.typeId;
export const RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1 = RECEIPT_SCHEMA.typeId;
export const RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1 = Number.MAX_SAFE_INTEGER;

const QUERY_WIRE = createRustIntegratedDomainWireDescriptorV1({
  magic: QUERY_SCHEMA.magic,
  schema: QUERY_SCHEMA.innerSchema,
  label: "native drop pickup query",
});
const RECEIPT_WIRE = createRustIntegratedDomainWireDescriptorV1({
  magic: RECEIPT_SCHEMA.magic,
  schema: RECEIPT_SCHEMA.innerSchema,
  label: "native drop pickup projection receipt",
});
const MAX_SAFE_U64 = Number.MAX_SAFE_INTEGER;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const I64_MIN = -(BigInt(1) << BigInt(63));
const I64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);
const MAX_ITEM_STACK = 0x7fff_ffff;
const MAX_AFFECTED_SLOTS = 9;
const WORLD_VIEW_COORDINATE_LIMIT_MILLI = BigInt(33_554_432_000);
const WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND = BigInt(4_096_000);
const WORLD_VIEW_FRACTION_SCALE = 1_000_000;
const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const ZERO_HASH = "0".repeat(32);
const encoder = new TextEncoder();

export type RustIntegratedRuntimeDropPickupGameplayRevisionV1 = Readonly<{
  epoch: number;
  sequence: bigint;
  inventory: bigint;
  machines: bigint;
  combat: bigint;
  progression: bigint;
  cardforge: bigint;
}>;

export type RustIntegratedRuntimeDropPickupWorldViewRevisionV1 = Readonly<{
  epoch: number;
  sequence: bigint;
  clock: bigint;
  machineAnchors: bigint;
  droppedItems: bigint;
  playerBindings: bigint;
  environment: bigint;
  atmosphereGravity: bigint;
  celestial: bigint;
}>;

export type RustIntegratedRuntimeDropPickupGameplayIdentityV1 = Readonly<{
  revision: RustIntegratedRuntimeDropPickupGameplayRevisionV1;
  canonicalStateHash: string;
}>;

export type RustIntegratedRuntimeDropPickupEntityIdentityV1 = Readonly<{
  revision: bigint;
  canonicalStateHash: string;
}>;

export type RustIntegratedRuntimeDropPickupWorldViewIdentityV1 = Readonly<{
  revision: RustIntegratedRuntimeDropPickupWorldViewRevisionV1;
  canonicalStateHash: string;
}>;

export type RustIntegratedRuntimeDropPickupAffectedSlotV1 = Readonly<{
  slot: number;
  beforeStack: RustIntegratedPlayerInventoryStackV1 | null;
  afterStack: RustIntegratedPlayerInventoryStackV1 | null;
}>;

export type RustIntegratedRuntimeDropPickupOriginV1 =
  | Readonly<{
    kind: "generated-block-action";
    provenance: RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1;
  }>
  | Readonly<{
    kind: "player-drop";
    playerDropSequence: number;
    playerDropReceiptHash: string;
  }>
  | Readonly<{
    kind: "player-death-drop";
    respawnSequence: number;
    respawnReceiptHash: string;
    sourceLane: "inventory" | "equipment";
    sourceSlot: number;
  }>;

export type RustIntegratedRuntimeDropPickupProjectionV1 = Readonly<{
  schema: 1;
  sequence: number;
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
    inventoryContainer: RustIntegratedContainerKeyV1;
    beforeRevision: bigint;
    afterRevision: bigint;
    affectedSlots: readonly RustIntegratedRuntimeDropPickupAffectedSlotV1[];
  }>;
  generatedDrop: Readonly<{
    dropId: string;
    entityId: bigint;
    /** Explicit BWR8 source union. Legacy generated-only callers may provide provenance instead. */
    origin?: RustIntegratedRuntimeDropPickupOriginV1;
    /** @deprecated Generated-source construction compatibility; BWR8 decode always returns origin. */
    provenance?: RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1;
    stack: RustIntegratedPlayerInventoryStackV1;
    custodyContainer: RustIntegratedContainerKeyV1;
    custodySlot: number;
    custodyBeforeRevision: bigint;
    custodyEmptiedRevision: bigint;
    spatialRevision: bigint;
    position: RustIntegratedRuntimeBasicDirtFixedVectorV1;
    velocityMilliPerSecond: RustIntegratedRuntimeBasicDirtFixedVectorV1;
    rotation: RustIntegratedRuntimeBasicDirtRotationV1;
  }>;
  removal: Readonly<{
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
  receiptHash: string;
}>;

export type RustIntegratedRuntimeDropPickupQueryV1 = Readonly<{
  expected: RustIntegratedRuntimeIdentityV1;
  afterSequence: number;
}>;

export type RustIntegratedRuntimeDropPickupProjectionReceiptV1 = Readonly<{
  requestPayloadHash: string;
  identity: RustIntegratedRuntimeIdentityV1;
  cursorAfter: number;
  receipt: RustIntegratedRuntimeDropPickupProjectionV1 | null;
}>;

export type RustIntegratedRuntimeDropPickupObservedReceiptV1 =
  RustIntegratedRuntimeDropPickupProjectionReceiptV1 & Readonly<{
    /** Exact BWRQ domain-operation payload hash over the complete BWR8 packet. */
    projectionPayloadHash: string;
  }>;

export interface RustIntegratedRuntimeDropPickupServiceV1 {
  identity(): RustIntegratedRuntimeIdentityV1;
  command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1>;
}

export class RustIntegratedRuntimeDropPickupErrorV1 extends Error {
  readonly name = "RustIntegratedRuntimeDropPickupErrorV1";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedRuntimeDropPickupErrorV1(code, message);
}

const failDomainWire: RustIntegratedDomainWireFailureV1 = (code, message) =>
  fail(`drop-pickup-projection-${code}`, message);

function checkedInteger(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("drop-pickup-projection-integer", `${label} is outside its exact integer range`);
  }
  return value;
}

function checkedU64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0) || value > U64_MAX) {
    fail("drop-pickup-projection-u64", `${label} is outside the u64 range`);
  }
  return value;
}

function checkedI64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < I64_MIN || value > I64_MAX) {
    fail("drop-pickup-projection-i64", `${label} is outside the i64 range`);
  }
  return value;
}

function safeNumber(value: bigint, label: string, minimum = 0) {
  if (value > BigInt(MAX_SAFE_U64)) {
    fail("drop-pickup-projection-u64", `${label} exceeds JavaScript's exact integer range`);
  }
  return checkedInteger(Number(value), minimum, MAX_SAFE_U64, label);
}

function checkedHash(value: string, label: string, allowZero = true) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value) || !allowZero && value === ZERO_HASH) {
    fail("drop-pickup-projection-hash", `${label} is not a canonical${allowZero ? "" : " non-zero"} hash`);
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

function visibleString(value: string, label: string, maximumBytes = 160) {
  if (typeof value !== "string" || value.length === 0
    || encoder.encode(value).byteLength > maximumBytes
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || /[\ud800-\udfff]/u.test(value)) {
    fail("drop-pickup-projection-string", `${label} is not bounded visible UTF-8`);
  }
  return value;
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
  writer.string(value.universeId, "drop-pickup universe id");
  writer.string(value.locationId, "drop-pickup location id");
  for (const revision of [
    value.revision.epoch, value.revision.world, value.revision.entities, value.revision.gameplay,
    value.revision.persistence, value.revision.network, value.revision.simulation,
  ]) writer.u64(BigInt(checkedInteger(revision, 0, MAX_SAFE_U64, "runtime identity revision")));
  writer.u64(BigInt(checkedInteger(value.tick, 0, MAX_SAFE_U64, "runtime identity tick")));
  writer.raw(hashBytes(value.stateHash, "runtime identity state hash"));
}

function readIdentity(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedRuntimeIdentityV1 {
  if (reader.u16() !== 2) fail("drop-pickup-projection-identity", "runtime identity schema is not V2");
  return Object.freeze({
    universeId: reader.string("drop-pickup universe id"),
    locationId: reader.string("drop-pickup location id"),
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
    fail("drop-pickup-projection-stack", `${label} is not an exact bounded item stack`);
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

function writeOptionalStackHash(
  hasher: TypeScriptCanonicalHasher,
  value: RustIntegratedPlayerInventoryStackV1 | null,
) {
  if (value === null) return hasher.writeU16(0);
  hasher.writeU16(1).writeU32(value.itemCode).writeU32(value.count);
  if (value.durabilityMillionths === null) hasher.writeU16(0);
  else hasher.writeU16(1).writeU32(value.durabilityMillionths);
  return hasher.writeBytes(hashBytes(value.metadataHash, "inventory metadata hash"));
}

function writeContainerHash(hasher: TypeScriptCanonicalHasher, value: RustIntegratedContainerKeyV1) {
  const kinds = ["player", "equipment", "container", "machine", "waygrid", "cardforge-case"] as const;
  const kind = kinds.indexOf(value.kind);
  if (kind < 0) fail("drop-pickup-projection-container", "inventory container kind is unknown");
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

export function rustIntegratedRuntimeDropPickupSourceOriginV1(
  value: RustIntegratedRuntimeDropPickupProjectionV1["generatedDrop"],
): RustIntegratedRuntimeDropPickupOriginV1 {
  const explicit = value.origin;
  const legacy = value.provenance;
  if (explicit?.kind === "player-drop" || explicit?.kind === "player-death-drop") {
    if (legacy !== undefined) {
      fail("drop-pickup-projection-origin", `${explicit.kind} origin also supplied generated provenance`);
    }
    return explicit;
  }
  const provenance = explicit?.kind === "generated-block-action" ? explicit.provenance : legacy;
  if (provenance === undefined) {
    fail("drop-pickup-projection-origin", "native pickup source omitted its exact origin");
  }
  if (explicit?.kind === "generated-block-action" && legacy !== undefined
    && rustIntegratedRuntimeBasicDirtGeneratedDropProvenanceHashV1(explicit.provenance)
      !== rustIntegratedRuntimeBasicDirtGeneratedDropProvenanceHashV1(legacy)) {
    fail("drop-pickup-projection-origin", "generated pickup origin contradicts its compatibility provenance");
  }
  return Object.freeze({ kind: "generated-block-action", provenance });
}

export function rustIntegratedRuntimeDropPickupReceiptHashV1(
  value: RustIntegratedRuntimeDropPickupProjectionV1,
) {
  const hasher = new TypeScriptCanonicalHasher("blockwild.integrated.native-drop-pickup-receipt.v1")
    .writeU16(value.schema)
    .writeU64(value.sequence)
    .writeU64(value.completionTick)
    .writeString(value.world.universeId)
    .writeString(value.world.locationId);
  writeWorldRevisionHash(hasher, value.world.revision)
    .writeBytes(hashBytes(value.world.canonicalStateHash, "world canonical state hash", false))
    .writeU64(value.player.playerId)
    .writeU64(value.player.entityId);
  writeContainerHash(hasher, value.player.inventoryContainer)
    .writeU64(value.player.beforeRevision)
    .writeU64(value.player.afterRevision)
    .writeU64(value.player.affectedSlots.length);
  for (const affected of value.player.affectedSlots) {
    hasher.writeU16(affected.slot);
    writeOptionalStackHash(hasher, affected.beforeStack);
    writeOptionalStackHash(hasher, affected.afterStack);
  }
  const drop = value.generatedDrop;
  const origin = rustIntegratedRuntimeDropPickupSourceOriginV1(drop);
  hasher.writeString(drop.dropId)
    .writeU64(drop.entityId);
  if (origin.kind === "generated-block-action") {
    hasher.writeBytes(hashBytes(
      rustIntegratedRuntimeBasicDirtGeneratedDropProvenanceHashV1(origin.provenance),
      "generated-drop provenance hash",
      false,
    ));
  } else if (origin.kind === "player-drop") {
    hasher.writeU16(1)
      .writeU64(origin.playerDropSequence)
      .writeBytes(hashBytes(origin.playerDropReceiptHash, "player-drop receipt hash", false));
  } else if (origin.kind === "player-death-drop") {
    hasher.writeU16(2)
      .writeU64(origin.respawnSequence)
      .writeBytes(hashBytes(origin.respawnReceiptHash, "player death-respawn receipt hash", false))
      .writeU16(origin.sourceLane === "inventory" ? 0 : 1)
      .writeU16(origin.sourceSlot);
  } else {
    fail("drop-pickup-projection-origin", "native pickup source origin is unknown");
  }
  hasher.writeU32(drop.stack.itemCode)
    .writeU32(drop.stack.count);
  if (drop.stack.durabilityMillionths === null) hasher.writeU16(0);
  else hasher.writeU16(1).writeU32(drop.stack.durabilityMillionths);
  hasher.writeBytes(hashBytes(drop.stack.metadataHash, "generated-drop metadata hash"));
  writeContainerHash(hasher, drop.custodyContainer)
    .writeU16(drop.custodySlot)
    .writeU64(drop.custodyBeforeRevision)
    .writeU64(drop.custodyEmptiedRevision)
    .writeU64(drop.spatialRevision);
  writeFixedVectorHash(hasher, drop.position);
  writeFixedVectorHash(hasher, drop.velocityMilliPerSecond);
  hasher.writeU32(drop.rotation.yaw).writeU32(drop.rotation.pitch).writeU32(drop.rotation.roll);
  const removal = value.removal;
  writeGameplayRevisionHash(hasher, removal.gameplay.before.revision)
    .writeBytes(hashBytes(removal.gameplay.before.canonicalStateHash, "before gameplay state hash", false));
  writeGameplayRevisionHash(hasher, removal.gameplay.after.revision)
    .writeBytes(hashBytes(removal.gameplay.after.canonicalStateHash, "after gameplay state hash", false));
  hasher.writeU64(removal.entity.before.revision)
    .writeBytes(hashBytes(removal.entity.before.canonicalStateHash, "before entity state hash", false))
    .writeU64(removal.entity.after.revision)
    .writeBytes(hashBytes(removal.entity.after.canonicalStateHash, "after entity state hash", false));
  writeWorldViewRevisionHash(hasher, removal.worldView.before.revision)
    .writeBytes(hashBytes(removal.worldView.before.canonicalStateHash, "before world-view state hash", false));
  writeWorldViewRevisionHash(hasher, removal.worldView.after.revision)
    .writeBytes(hashBytes(removal.worldView.after.canonicalStateHash, "after world-view state hash", false));
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
      fail("drop-pickup-projection-spatial", `${label} ${axis} exceeds its native fixed-point bound`);
    }
  }
}

function validateProvenance(value: RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1) {
  if (value.schema !== 1) fail("drop-pickup-projection-provenance", "generated-drop provenance schema is not V1");
  for (const [hash, label] of [
    [value.manifestHash, "manifest"],
    [value.installedRegistryHash, "installed registry"],
    [value.catalogBlobHash, "catalog blob"],
    [value.actionReportHash, "action report"],
    [value.rngSemanticsHash, "RNG semantics"],
    [value.lootPlanHash, "loot plan"],
  ] as const) checkedHash(hash, `generated-drop ${label} hash`, false);
  checkedU64(value.blockActionSequence, "generated-drop block-action sequence");
  if (value.blockActionSequence === BigInt(0)) {
    fail("drop-pickup-projection-provenance", "generated-drop block-action sequence is zero");
  }
  checkedInteger(value.originInputSequence, 1, MAX_SAFE_U64, "generated-drop origin input sequence");
  checkedInteger(value.blockId, 1, 0xffff, "generated-drop block id");
  writeI32(new RustIntegratedPlayerInventoryWriterV1(), value.position.x, "generated-drop provenance x");
  writeI32(new RustIntegratedPlayerInventoryWriterV1(), value.position.y, "generated-drop provenance y");
  writeI32(new RustIntegratedPlayerInventoryWriterV1(), value.position.z, "generated-drop provenance z");
  checkedInteger(value.groupOrdinal, 0, 31, "generated-drop group ordinal");
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
    fail("drop-pickup-projection-gameplay", "pickup does not attest one exact gameplay inventory transition");
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
    fail("drop-pickup-projection-world-view", "pickup does not attest one exact world-view drop removal");
  }
}

export function validateRustIntegratedRuntimeDropPickupProjectionV1(
  value: RustIntegratedRuntimeDropPickupProjectionV1,
  identity?: RustIntegratedRuntimeIdentityV1,
) {
  if (value.schema !== 1) fail("drop-pickup-projection-schema", "drop-pickup projection schema is not V1");
  checkedInteger(value.sequence, 1, MAX_SAFE_U64, "drop-pickup receipt sequence");
  checkedInteger(value.completionTick, 0, MAX_SAFE_U64, "drop-pickup completion tick");
  if (identity && value.completionTick > identity.tick) {
    fail("drop-pickup-projection-tick", "drop-pickup completion tick is in the query identity's future");
  }
  visibleString(value.world.universeId, "drop-pickup universe id");
  visibleString(value.world.locationId, "drop-pickup location id");
  if (identity && (value.world.universeId !== identity.universeId || value.world.locationId !== identity.locationId)) {
    fail("drop-pickup-projection-world", "drop-pickup world does not match the queried integrated runtime");
  }
  validateWorldRevision(value.world.revision);
  checkedHash(value.world.canonicalStateHash, "world canonical state hash", false);

  const player = value.player;
  checkedU64(player.playerId, "pickup player id");
  checkedU64(player.entityId, "pickup player entity id");
  if (player.playerId === BigInt(0) || player.entityId === BigInt(0)) {
    fail("drop-pickup-projection-player", "pickup player identities must be non-zero");
  }
  if (player.inventoryContainer.kind !== "player" || player.inventoryContainer.id.length === 0
    || player.inventoryContainer.ownerId === null || player.inventoryContainer.ownerId.length === 0) {
    fail("drop-pickup-projection-player", "pickup destination is not an owned player inventory");
  }
  visibleString(player.inventoryContainer.id, "player inventory id");
  visibleString(player.inventoryContainer.ownerId, "player inventory owner");
  checkedU64(player.beforeRevision, "player inventory before revision");
  checkedU64(player.afterRevision, "player inventory after revision");
  if (!Array.isArray(player.affectedSlots) || player.affectedSlots.length < 1
    || player.affectedSlots.length > MAX_AFFECTED_SLOTS
    || player.afterRevision !== player.beforeRevision + BigInt(player.affectedSlots.length)) {
    fail("drop-pickup-projection-inventory", "pickup player revision does not match its bounded affected slots");
  }
  let previousSlot = -1;
  let pickedCount = 0;
  for (const affected of player.affectedSlots) {
    checkedInteger(affected.slot, 0, 8, "pickup affected slot");
    if (affected.slot <= previousSlot || affected.afterStack === null) {
      fail("drop-pickup-projection-inventory", "pickup affected slots are not unique canonical destination changes");
    }
    previousSlot = affected.slot;
    checkedStack(affected.afterStack, "pickup after stack");
    if (affected.beforeStack === null) {
      pickedCount += affected.afterStack.count;
    } else {
      checkedStack(affected.beforeStack, "pickup before stack");
      if (!stackDescriptorEquals(affected.beforeStack, affected.afterStack)
        || affected.afterStack.count <= affected.beforeStack.count) {
        fail("drop-pickup-projection-inventory", "pickup affected slot is not an exact compatible stack increase");
      }
      pickedCount += affected.afterStack.count - affected.beforeStack.count;
    }
  }

  const drop = value.generatedDrop;
  visibleString(drop.dropId, "generated-drop id");
  checkedU64(drop.entityId, "generated-drop entity id");
  if (drop.entityId === BigInt(0)) fail("drop-pickup-projection-drop", "generated-drop entity id is zero");
  const origin = rustIntegratedRuntimeDropPickupSourceOriginV1(drop);
  if (origin.kind === "generated-block-action") {
    validateProvenance(origin.provenance);
  } else if (origin.kind === "player-drop") {
    checkedInteger(origin.playerDropSequence, 1, MAX_SAFE_U64, "source player-drop sequence");
    checkedHash(origin.playerDropReceiptHash, "source player-drop receipt hash", false);
  } else if (origin.kind === "player-death-drop") {
    checkedInteger(origin.respawnSequence, 1, MAX_SAFE_U64, "source player death-respawn sequence");
    checkedHash(origin.respawnReceiptHash, "source player death-respawn receipt hash", false);
    if (origin.sourceLane !== "inventory" && origin.sourceLane !== "equipment") {
      fail("drop-pickup-projection-origin", "source player death-drop custody lane is unknown");
    }
    checkedInteger(
      origin.sourceSlot,
      0,
      origin.sourceLane === "inventory" ? 8 : 7,
      "source player death-drop custody slot",
    );
  } else {
    fail("drop-pickup-projection-origin", "native pickup source origin is unknown");
  }
  checkedStack(drop.stack, "generated-drop stack");
  if (player.affectedSlots.some((affected) => affected.afterStack === null
      || !stackDescriptorEquals(affected.afterStack, drop.stack))
    || pickedCount !== drop.stack.count) {
    fail("drop-pickup-projection-inventory", "pickup destination deltas do not conserve the generated-drop stack");
  }
  const generatedIdentityMismatch = origin.kind === "generated-block-action"
    && (drop.dropId !== `block-loot-v1:${origin.provenance.blockActionSequence}:${origin.provenance.groupOrdinal}`
      || drop.custodyContainer.id
        !== `block-loot-custody-v1:${origin.provenance.blockActionSequence}:${origin.provenance.groupOrdinal}`);
  if (generatedIdentityMismatch || drop.custodyContainer.kind !== "container"
    || drop.custodyContainer.ownerId !== null || drop.custodySlot !== 0) {
    fail("drop-pickup-projection-custody", "pickup source is not exact unowned slot-zero generated-drop custody");
  }
  visibleString(drop.custodyContainer.id, "drop custody id");
  checkedU64(drop.custodyBeforeRevision, "drop custody before revision");
  checkedU64(drop.custodyEmptiedRevision, "drop custody emptied revision");
  checkedU64(drop.spatialRevision, "drop spatial revision");
  if (drop.custodyEmptiedRevision !== drop.custodyBeforeRevision + BigInt(player.affectedSlots.length)) {
    fail("drop-pickup-projection-custody", "drop custody or spatial revision does not bind the complete pickup");
  }
  validateVector(drop.position, WORLD_VIEW_COORDINATE_LIMIT_MILLI, "drop position");
  validateVector(drop.velocityMilliPerSecond, WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND, "drop velocity");
  for (const [axis, rotation] of Object.entries(drop.rotation)) {
    checkedInteger(rotation, 0, WORLD_VIEW_FRACTION_SCALE - 1, `drop ${axis} rotation`);
  }

  validateGameplayTransition(value.removal.gameplay.before, value.removal.gameplay.after);
  checkedU64(value.removal.entity.before.revision, "before entity revision");
  checkedU64(value.removal.entity.after.revision, "after entity revision");
  checkedHash(value.removal.entity.before.canonicalStateHash, "before entity state hash", false);
  checkedHash(value.removal.entity.after.canonicalStateHash, "after entity state hash", false);
  if (value.removal.entity.after.revision !== value.removal.entity.before.revision + BigInt(1)
    || value.removal.entity.before.canonicalStateHash === value.removal.entity.after.canonicalStateHash) {
    fail("drop-pickup-projection-entity", "pickup does not attest one exact entity removal");
  }
  validateWorldViewTransition(value.removal.worldView.before, value.removal.worldView.after);
  checkedHash(value.receiptHash, "native drop-pickup receipt hash", false);
  if (value.receiptHash !== rustIntegratedRuntimeDropPickupReceiptHashV1(value)) {
    fail("drop-pickup-projection-receipt-hash", "native drop-pickup receipt hash does not match its canonical fields");
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

function writeProvenance(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeBasicDirtGeneratedDropProvenanceV1,
) {
  writer.u16(value.schema);
  writer.raw(hashBytes(value.manifestHash, "drop manifest hash", false));
  writer.raw(hashBytes(value.installedRegistryHash, "drop registry hash", false));
  writer.raw(hashBytes(value.catalogBlobHash, "drop catalog hash", false));
  writer.raw(hashBytes(value.actionReportHash, "drop action report hash", false));
  writer.raw(hashBytes(value.rngSemanticsHash, "drop RNG semantics hash", false));
  writer.u64(value.blockActionSequence);
  writer.u64(BigInt(value.originInputSequence));
  writer.u16(value.blockId);
  writeI32(writer, value.position.x, "drop provenance x");
  writeI32(writer, value.position.y, "drop provenance y");
  writeI32(writer, value.position.z, "drop provenance z");
  writer.raw(hashBytes(value.lootPlanHash, "drop loot-plan hash", false));
  writer.u16(value.groupOrdinal);
}

function readProvenance(reader: RustIntegratedPlayerInventoryReaderV1) {
  return Object.freeze({
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
}

function writeProjection(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeDropPickupProjectionV1,
) {
  writer.u16(value.schema);
  writer.u64(BigInt(value.sequence));
  writer.u64(BigInt(value.completionTick));
  writer.string(value.world.universeId, "drop-pickup universe id");
  writer.string(value.world.locationId, "drop-pickup location id");
  writeWorldRevision(writer, value.world.revision);
  writer.raw(hashBytes(value.world.canonicalStateHash, "world canonical state hash", false));
  writer.u64(value.player.playerId);
  writer.u64(value.player.entityId);
  writeRustIntegratedContainerKeyV1(writer, value.player.inventoryContainer);
  writer.u64(value.player.beforeRevision);
  writer.u64(value.player.afterRevision);
  writer.u32(value.player.affectedSlots.length);
  for (const affected of value.player.affectedSlots) {
    writer.u16(affected.slot);
    writer.option(affected.beforeStack, (stack) => writeRustIntegratedPlayerInventoryStackV1(writer, stack));
    writer.option(affected.afterStack, (stack) => writeRustIntegratedPlayerInventoryStackV1(writer, stack));
  }
  const drop = value.generatedDrop;
  const origin = rustIntegratedRuntimeDropPickupSourceOriginV1(drop);
  writer.string(drop.dropId, "generated-drop id");
  writer.u64(drop.entityId);
  if (origin.kind === "generated-block-action") {
    writer.u8(0);
    writeProvenance(writer, origin.provenance);
  } else if (origin.kind === "player-drop") {
    writer.u8(1);
    writer.u64(BigInt(origin.playerDropSequence));
    writer.raw(hashBytes(origin.playerDropReceiptHash, "player-drop receipt hash", false));
  } else {
    writer.u8(2);
    writer.u64(BigInt(origin.respawnSequence));
    writer.raw(hashBytes(origin.respawnReceiptHash, "player death-respawn receipt hash", false));
    writer.u16(origin.sourceLane === "inventory" ? 0 : 1);
    writer.u16(origin.sourceSlot);
  }
  writeRustIntegratedPlayerInventoryStackV1(writer, drop.stack);
  writeRustIntegratedContainerKeyV1(writer, drop.custodyContainer);
  writer.u16(drop.custodySlot);
  writer.u64(drop.custodyBeforeRevision);
  writer.u64(drop.custodyEmptiedRevision);
  writer.u64(drop.spatialRevision);
  for (const [label, vector] of [
    ["drop position", drop.position],
    ["drop velocity", drop.velocityMilliPerSecond],
  ] as const) {
    writeI64(writer, vector.xMilli, `${label} x`);
    writeI64(writer, vector.yMilli, `${label} y`);
    writeI64(writer, vector.zMilli, `${label} z`);
  }
  writer.u32(drop.rotation.yaw);
  writer.u32(drop.rotation.pitch);
  writer.u32(drop.rotation.roll);
  writeGameplayRevision(writer, value.removal.gameplay.before.revision);
  writer.raw(hashBytes(value.removal.gameplay.before.canonicalStateHash, "before gameplay state hash", false));
  writeGameplayRevision(writer, value.removal.gameplay.after.revision);
  writer.raw(hashBytes(value.removal.gameplay.after.canonicalStateHash, "after gameplay state hash", false));
  writer.u64(value.removal.entity.before.revision);
  writer.raw(hashBytes(value.removal.entity.before.canonicalStateHash, "before entity state hash", false));
  writer.u64(value.removal.entity.after.revision);
  writer.raw(hashBytes(value.removal.entity.after.canonicalStateHash, "after entity state hash", false));
  writeWorldViewRevision(writer, value.removal.worldView.before.revision);
  writer.raw(hashBytes(value.removal.worldView.before.canonicalStateHash, "before world-view state hash", false));
  writeWorldViewRevision(writer, value.removal.worldView.after.revision);
  writer.raw(hashBytes(value.removal.worldView.after.canonicalStateHash, "after world-view state hash", false));
  writer.raw(hashBytes(value.receiptHash, "native drop-pickup receipt hash", false));
}

function readProjection(reader: RustIntegratedPlayerInventoryReaderV1) {
  const schema = reader.u16() as 1;
  const sequence = safeNumber(reader.u64(), "drop-pickup receipt sequence", 1);
  const completionTick = safeNumber(reader.u64(), "drop-pickup completion tick");
  const world = Object.freeze({
    universeId: reader.string("drop-pickup universe id"),
    locationId: reader.string("drop-pickup location id"),
    revision: readWorldRevision(reader),
    canonicalStateHash: bytesHash(reader.take(16)),
  });
  const playerId = reader.u64();
  const entityId = reader.u64();
  const inventoryContainer = readRustIntegratedContainerKeyV1(reader);
  const beforeRevision = reader.u64();
  const afterRevision = reader.u64();
  const affectedCount = reader.u32();
  if (affectedCount > MAX_AFFECTED_SLOTS) {
    fail("drop-pickup-projection-capacity", "native pickup projection exceeds nine affected player slots");
  }
  const affectedSlots = Object.freeze(Array.from({ length: affectedCount }, () => Object.freeze({
    slot: reader.u16(),
    beforeStack: reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader)),
    afterStack: reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader)),
  })));
  const player = Object.freeze({
    playerId, entityId, inventoryContainer, beforeRevision, afterRevision, affectedSlots,
  });
  const dropId = reader.string("generated-drop id");
  const dropEntityId = reader.u64();
  const originTag = reader.u8();
  let origin: RustIntegratedRuntimeDropPickupOriginV1;
  if (originTag === 0) {
    origin = Object.freeze({ kind: "generated-block-action", provenance: readProvenance(reader) });
  } else if (originTag === 1) {
    origin = Object.freeze({
      kind: "player-drop",
      playerDropSequence: safeNumber(reader.u64(), "source player-drop sequence", 1),
      playerDropReceiptHash: bytesHash(reader.take(16)),
    });
  } else if (originTag === 2) {
    const respawnSequence = safeNumber(reader.u64(), "source player death-respawn sequence", 1);
    const respawnReceiptHash = bytesHash(reader.take(16));
    const sourceLaneTag = reader.u16();
    if (sourceLaneTag !== 0 && sourceLaneTag !== 1) {
      fail("drop-pickup-projection-origin", "native death-drop pickup source uses an unknown custody-lane tag");
    }
    origin = Object.freeze({
      kind: "player-death-drop",
      respawnSequence,
      respawnReceiptHash,
      sourceLane: sourceLaneTag === 0 ? "inventory" : "equipment",
      sourceSlot: reader.u16(),
    });
  } else {
    fail("drop-pickup-projection-origin", "native pickup source uses an unknown origin tag");
  }
  const stack = readRustIntegratedPlayerInventoryStackV1(reader);
  const custodyContainer = readRustIntegratedContainerKeyV1(reader);
  const custodySlot = reader.u16();
  const custodyBeforeRevision = reader.u64();
  const custodyEmptiedRevision = reader.u64();
  const spatialRevision = reader.u64();
  const position = Object.freeze({ xMilli: readI64(reader), yMilli: readI64(reader), zMilli: readI64(reader) });
  const velocityMilliPerSecond = Object.freeze({
    xMilli: readI64(reader), yMilli: readI64(reader), zMilli: readI64(reader),
  });
  const rotation = Object.freeze({ yaw: reader.u32(), pitch: reader.u32(), roll: reader.u32() });
  const generatedDrop = Object.freeze({
    dropId,
    entityId: dropEntityId,
    origin,
    stack,
    custodyContainer,
    custodySlot,
    custodyBeforeRevision,
    custodyEmptiedRevision,
    spatialRevision,
    position,
    velocityMilliPerSecond,
    rotation,
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
  return Object.freeze({
    schema,
    sequence,
    completionTick,
    world,
    player,
    generatedDrop,
    removal: Object.freeze({
      gameplay: Object.freeze({ before: gameplayBefore, after: gameplayAfter }),
      entity: Object.freeze({ before: entityBefore, after: entityAfter }),
      worldView: Object.freeze({ before: worldViewBefore, after: worldViewAfter }),
    }),
    receiptHash: bytesHash(reader.take(16)),
  });
}

export function encodeRustIntegratedRuntimeDropPickupQueryV1(value: RustIntegratedRuntimeDropPickupQueryV1) {
  checkedInteger(value.afterSequence, 0, MAX_SAFE_U64, "drop-pickup query cursor");
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeIdentity(writer, value.expected);
  writer.u64(BigInt(value.afterSequence));
  return wrapRustIntegratedDomainPacketV1(QUERY_WIRE, writer.finish(), failDomainWire);
}

export function decodeRustIntegratedRuntimeDropPickupQueryV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(
    unwrapRustIntegratedDomainPacketV1(QUERY_WIRE, packet, failDomainWire),
  );
  const value = Object.freeze({
    expected: readIdentity(reader),
    afterSequence: safeNumber(reader.u64(), "drop-pickup query cursor"),
  });
  reader.finish();
  return value;
}

function validateCursor(
  value: RustIntegratedRuntimeDropPickupProjectionReceiptV1,
  expectedAfterSequence?: number,
) {
  checkedInteger(value.cursorAfter, 0, MAX_SAFE_U64, "drop-pickup response cursor");
  if (expectedAfterSequence === undefined) {
    if (value.receipt !== null && value.receipt.sequence !== value.cursorAfter) {
      fail("drop-pickup-projection-cursor", "drop-pickup response cursor does not identify its receipt");
    }
    return;
  }
  checkedInteger(expectedAfterSequence, 0, MAX_SAFE_U64, "drop-pickup query cursor");
  if (expectedAfterSequence === RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1) {
    if (value.receipt !== null) {
      fail("drop-pickup-projection-cursor", "legacy seed-only query attempted to replay a drop-pickup receipt");
    }
    return;
  }
  if (value.receipt === null) {
    if (value.cursorAfter !== expectedAfterSequence) {
      fail("drop-pickup-projection-cursor", "empty drop-pickup tail changed its contiguous cursor");
    }
    return;
  }
  if (expectedAfterSequence === MAX_SAFE_U64
    || value.receipt.sequence !== expectedAfterSequence + 1
    || value.cursorAfter !== value.receipt.sequence) {
    fail("drop-pickup-projection-cursor", "drop-pickup receipt tail is gapped, stale, or out of order");
  }
}

export function encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
  value: RustIntegratedRuntimeDropPickupProjectionReceiptV1,
  expectedAfterSequence?: number,
) {
  checkedHash(value.requestPayloadHash, "drop-pickup request payload hash", false);
  if (value.receipt !== null) validateRustIntegratedRuntimeDropPickupProjectionV1(value.receipt, value.identity);
  validateCursor(value, expectedAfterSequence);
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writer.raw(hashBytes(value.requestPayloadHash, "drop-pickup request payload hash", false));
  writeIdentity(writer, value.identity);
  writer.u64(BigInt(value.cursorAfter));
  writer.option(value.receipt, (receipt) => writeProjection(writer, receipt));
  return wrapRustIntegratedDomainPacketV1(RECEIPT_WIRE, writer.finish(), failDomainWire);
}

export function decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
  packet: Uint8Array,
  expectedRequestPayloadHash?: string,
  expectedAfterSequence?: number,
) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(
    unwrapRustIntegratedDomainPacketV1(RECEIPT_WIRE, packet, failDomainWire),
  );
  const requestPayloadHash = bytesHash(reader.take(16));
  const identity = readIdentity(reader);
  const cursorAfter = safeNumber(reader.u64(), "drop-pickup response cursor");
  const receipt = reader.option(() => readProjection(reader));
  reader.finish();
  if (expectedRequestPayloadHash !== undefined && requestPayloadHash !== expectedRequestPayloadHash) {
    fail("drop-pickup-projection-request", "BWR8 does not attest the exact BWQ8 request payload");
  }
  const value = Object.freeze({ requestPayloadHash, identity, cursorAfter, receipt });
  if (receipt !== null) validateRustIntegratedRuntimeDropPickupProjectionV1(receipt, identity);
  validateCursor(value, expectedAfterSequence);
  return value;
}

function validateOuterReceiptHash(receipt: RustIntegratedRuntimeCommandReceiptV1) {
  const bytes: number[] = [...hashBytes(receipt.commandHash, "drop-pickup command hash")];
  if (receipt.status === "accepted") {
    bytes.push(...hashBytes(receipt.before.stateHash, "drop-pickup before state hash"));
    bytes.push(...hashBytes(receipt.after.stateHash, "drop-pickup after state hash"));
    for (const operation of receipt.domainReceipts) {
      bytes.push(...hashBytes(operation.payloadHash, "drop-pickup domain receipt hash"));
    }
  } else {
    bytes.push(...hashBytes(receipt.current.stateHash, "drop-pickup current state hash"));
    bytes.push(...encoder.encode(receipt.code), ...encoder.encode(receipt.message));
  }
  if (receipt.receiptHash !== rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes))) {
    fail("drop-pickup-projection-command-receipt", "drop-pickup BWRQ receipt hash is invalid");
  }
}

export async function queryRustIntegratedRuntimeDropPickupReceiptV1(
  service: RustIntegratedRuntimeDropPickupServiceV1,
  afterSequence: number,
) {
  checkedInteger(afterSequence, 0, MAX_SAFE_U64, "drop-pickup query cursor");
  const expected = service.identity();
  const payload = encodeRustIntegratedRuntimeDropPickupQueryV1({ expected, afterSequence });
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "gameplay",
    typeId: RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1,
    schema: QUERY_SCHEMA.operationSchema,
    payload,
  });
  const id = `native-drop-pickup-receipt:${expected.stateHash}:${afterSequence}`;
  const batch = createRustIntegratedRuntimeCommandBatchV1({
    commandId: id,
    idempotencyKey: id,
    actorId: "runtime:native-drop-pickup-receipt",
    expected,
    operations: Object.freeze([operation]),
  });
  const outer = await service.command(batch);
  if (outer.commandId !== batch.commandId || outer.idempotencyKey !== batch.idempotencyKey
    || outer.commandHash !== batch.commandHash) {
    fail("drop-pickup-projection-command-receipt", "BWRQ receipt does not identify the drop-pickup query batch");
  }
  validateOuterReceiptHash(outer);
  if (outer.status === "rejected") {
    if (!rustIntegratedRuntimeIdentityEqualsV1(outer.current, expected)
      || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) {
      fail("drop-pickup-projection-command-receipt", "rejected drop-pickup query moved the runtime identity");
    }
    fail(outer.code, outer.message);
  }
  const response = outer.domainReceipts[0];
  if (outer.domainReceipts.length !== 1 || !response || response.domain !== "gameplay"
    || response.typeId !== RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1
    || response.schema !== RECEIPT_SCHEMA.operationSchema
    || response.payloadHash !== rustIntegratedRuntimeWireChecksumV1(response.payload)
    || !rustIntegratedRuntimeIdentityEqualsV1(outer.before, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(outer.after, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) {
    fail("drop-pickup-projection-command-receipt", "drop-pickup query returned a mutating or incorrectly typed receipt");
  }
  const result = decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
    response.payload,
    operation.payloadHash,
    afterSequence,
  );
  if (!rustIntegratedRuntimeIdentityEqualsV1(result.identity, expected)) {
    fail("drop-pickup-projection-identity", "BWR8 identity does not match the exact observed authority");
  }
  return Object.freeze({ ...result, projectionPayloadHash: response.payloadHash });
}
