import {
  decodeRustAuthoritativeExtractionR10,
  type RustAuthoritativeExtractionR10,
  type RustDomainRowR10,
  type RustDomainValueR10,
} from "./rust-authoritative-extraction-r10.ts";
import type { RustIntegratedRuntimeExtractionV1 } from "./rust-integrated-runtime-contract.ts";

const I16_MIN = -32_768;
const I16_MAX = 32_767;
const U8_MAX = 0xff;
const U16_MAX = 0xffff;
const CONTAINER_KEY = /^container-key-v1\/[0-9a-f]+$/u;

export type RustLivePlayerHeldStackR10 = Readonly<{
  itemCode: number;
  count: number;
  durabilityMillionths: number | null;
  metadataHash: Uint8Array;
}>;

export type RustLivePlayerViewR10 = Readonly<{
  extractionRevision: bigint;
  authorityTick: bigint;
  externalEntityId: string;
  actorId: string;
  playerId: bigint;
  entityId: bigint;
  entityRevision: bigint;
  inventoryContainer: string;
  inventoryContainerRevision: bigint;
  equipmentContainer: string;
  equipmentContainerRevision: bigint;
  selectedSlot: number;
  backSlot: number | null;
  lastInputSequence: bigint;
  buttons: number;
  authoritativeFlags: number;
  lookYaw: number | null;
  lookPitch: number;
  position: Readonly<{ x: number; y: number; z: number }>;
  velocity: Readonly<{ x: number; y: number; z: number }>;
  radius: number;
  height: number;
  mass: number;
  grounded: boolean;
  crouching: boolean;
  oxygenSeconds: number;
  maximumOxygenSeconds: number;
  health: number;
  maximumHealth: number;
  held: RustLivePlayerHeldStackR10 | null;
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function fields(row: RustDomainRowR10) {
  return new Map<string, RustDomainValueR10>(row.fields);
}

function field<T extends RustDomainValueR10>(values: ReadonlyMap<string, RustDomainValueR10>, key: string, guard: (value: RustDomainValueR10) => value is T) {
  const value = values.get(key);
  invariant(value !== undefined && guard(value), `live player field '${key}' is absent or has the wrong type`);
  return value;
}

const isBigint = (value: RustDomainValueR10): value is bigint => typeof value === "bigint";
const isNumber = (value: RustDomainValueR10): value is number => typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: RustDomainValueR10): value is boolean => typeof value === "boolean";
const isString = (value: RustDomainValueR10): value is string => typeof value === "string";
const isBytes = (value: RustDomainValueR10): value is Uint8Array => value instanceof Uint8Array;

function integer(value: bigint, maximum: number, label: string) {
  invariant(value >= BigInt(0) && value <= BigInt(maximum), `${label} exceeds its browser presentation bound`);
  return Number(value);
}

function signedInput(value: bigint, label: string) {
  invariant(value >= BigInt(I16_MIN) && value <= BigInt(I16_MAX), `${label} is not i16`);
  return Number(value);
}

function optionalU64(values: ReadonlyMap<string, RustDomainValueR10>, key: string) {
  const present = field(values, `${key}.present`, isBoolean);
  const value = values.get(`${key}.value`);
  invariant(present === (value !== undefined), `${key} optional fields disagree`);
  if (!present) return null;
  invariant(isBigint(value!), `${key} optional value is not u64`);
  return value!;
}

function exactRow(rows: readonly RustDomainRowR10[], kind: number, predicate: (row: RustDomainRowR10) => boolean, label: string) {
  const matches = rows.filter((row) => row.kind === kind && predicate(row));
  invariant(matches.length === 1, `live player ${label} must resolve exactly one authoritative row`);
  return matches[0];
}

function livePlayerFromDecoded(decoded: RustAuthoritativeExtractionR10, externalEntityId: string): RustLivePlayerViewR10 {
  invariant(decoded.entities !== null && decoded.domains !== null, "live player view requires both BWR6 and BWX0 extraction");
  invariant(decoded.entities.omitted === 0, "live player view cannot infer identity from an omitted entity extraction");
  const playerView = decoded.domains.views.find((view) => view.domain === 2);
  invariant(playerView !== undefined && playerView.omitted === 0, "live player BWX0 view is missing or truncated");

  const runtimeRow = exactRow(playerView.rows, 1, (row) => row.key === externalEntityId, "runtime row");
  const runtime = fields(runtimeRow);
  const entityId = field(runtime, "entityId", isBigint);
  const entityMatches = decoded.entities.records.filter((record) =>
    record.entityId === entityId && record.externalEntityId === externalEntityId && record.class === "player");
  invariant(entityMatches.length === 1, "live player runtime row does not match exactly one BWR6 player entity");
  const playerEntity = entityMatches[0];

  const bindingRow = exactRow(playerView.rows, 2, (row) => fields(row).get("entityId") === entityId, "world-view binding row");
  const binding = fields(bindingRow);
  const actorId = field(binding, "actorId", isString);
  const playerId = field(binding, "playerId", isBigint);
  invariant(playerId > BigInt(0) && actorId.length > 0, "live player binding identity is empty");
  invariant(field(binding, "entityRevision", isBigint) === playerEntity.entityRevision,
    "live player world-view and entity revisions disagree");

  const selectedSlot = integer(field(binding, "selectedSlot", isBigint), 8, "selected slot");
  invariant(integer(field(runtime, "selectedSlot", isBigint), 8, "runtime selected slot") === selectedSlot,
    "live player runtime and world-view selected slots disagree");
  const inventoryContainer = field(binding, "inventoryContainer", isString);
  const equipmentContainer = field(binding, "equipmentContainer", isString);
  invariant(CONTAINER_KEY.test(inventoryContainer) && CONTAINER_KEY.test(equipmentContainer)
    && inventoryContainer !== equipmentContainer, "live player container keys are invalid or aliased");

  const heldPresent = field(binding, "held.present", isBoolean);
  const heldItem = binding.get("held.itemCode");
  const heldCount = binding.get("held.count");
  const heldHash = binding.get("held.metadataHash");
  invariant(heldPresent === (heldItem !== undefined && heldCount !== undefined && heldHash !== undefined),
    "live player held-stack fields disagree");
  const held = heldPresent ? Object.freeze({
    itemCode: integer(field(binding, "held.itemCode", isBigint), 0xffff_ffff, "held item code"),
    count: integer(field(binding, "held.count", isBigint), 0xffff_ffff, "held item count"),
    durabilityMillionths: (() => {
      const value = optionalU64(binding, "held.durability");
      return value === null ? null : integer(value, 1_000_000, "held durability");
    })(),
    metadataHash: Uint8Array.from(field(binding, "held.metadataHash", isBytes)),
  }) : null;
  invariant(held === null || held.count > 0 && held.metadataHash.byteLength === 16, "live player held stack is invalid");

  const readNumber = (key: string) => field(runtime, key, isNumber);
  const position = Object.freeze({ x: readNumber("position.x"), y: readNumber("position.y"), z: readNumber("position.z") });
  const velocity = Object.freeze({ x: readNumber("velocity.x"), y: readNumber("velocity.y"), z: readNumber("velocity.z") });
  invariant(playerEntity.position.x === Math.fround(position.x)
    && playerEntity.position.y === Math.fround(position.y)
    && playerEntity.position.z === Math.fround(position.z),
    "live player runtime and BWR6 positions disagree");
  invariant(playerEntity.velocity.x === Math.fround(velocity.x)
    && playerEntity.velocity.y === Math.fround(velocity.y)
    && playerEntity.velocity.z === Math.fround(velocity.z),
    "live player runtime and BWR6 velocities disagree");
  invariant(field(runtime, "grounded", isBoolean) === playerEntity.grounded,
    "live player runtime and BWR6 grounded states disagree");

  const lastInputSequence = field(runtime, "lastInputSequence", isBigint);
  const lookYawValue = runtime.get("input.lookYaw");
  const lookYaw = lookYawValue === undefined ? null : signedInput(field(runtime, "input.lookYaw", isBigint), "live player yaw");
  return Object.freeze({
    extractionRevision: decoded.extractionRevision,
    authorityTick: decoded.domains.authorityTick,
    externalEntityId,
    actorId,
    playerId,
    entityId,
    entityRevision: playerEntity.entityRevision,
    inventoryContainer,
    inventoryContainerRevision: field(binding, "inventoryContainerRevision", isBigint),
    equipmentContainer,
    equipmentContainerRevision: field(binding, "equipmentContainerRevision", isBigint),
    selectedSlot,
    backSlot: (() => { const value = optionalU64(binding, "backSlot"); return value === null ? null : integer(value, U16_MAX, "back slot"); })(),
    lastInputSequence,
    buttons: integer(field(runtime, "buttons", isBigint), 0xffff_ffff, "input buttons"),
    authoritativeFlags: integer(field(runtime, "flags", isBigint), U8_MAX, "authoritative flags"),
    lookYaw,
    lookPitch: signedInput(field(runtime, "lookPitch", isBigint), "live player pitch"),
    position,
    velocity,
    radius: readNumber("radius"),
    height: readNumber("height"),
    mass: readNumber("mass"),
    grounded: field(runtime, "grounded", isBoolean),
    crouching: field(runtime, "crouching", isBoolean),
    oxygenSeconds: readNumber("oxygenSeconds"),
    maximumOxygenSeconds: readNumber("maximumOxygenSeconds"),
    health: playerEntity.health,
    maximumHealth: playerEntity.maximumHealth,
    held,
  });
}

/** Strict read-only player mirror; no missing field is synthesized. */
export function decodeRustLivePlayerViewR10(extraction: RustIntegratedRuntimeExtractionV1, externalEntityId: string) {
  invariant(typeof externalEntityId === "string" && externalEntityId.length > 0, "live player external identity is empty");
  return livePlayerFromDecoded(decodeRustAuthoritativeExtractionR10(extraction), externalEntityId);
}
