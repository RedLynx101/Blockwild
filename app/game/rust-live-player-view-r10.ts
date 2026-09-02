import {
  decodeRustAuthoritativeExtractionR10,
  RUST_AUDIO_MAX_EVENTS_R10,
  type RustAudioCueR10,
  type RustAuthoritativeExtractionR10,
  type RustDomainRowR10,
  type RustDomainValueR10,
} from "./rust-authoritative-extraction-r10.ts";
import type { RustIntegratedRuntimeExtractionV1 } from "./rust-integrated-runtime-contract.ts";
import { rustIntegratedContainerViewKeyV1 } from "./rust-integrated-runtime-player-locator-consume.ts";
import { RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PICKUP_DELAY_TICKS_V1 } from "./rust-integrated-runtime-player-drop.ts";

const I16_MIN = -32_768;
const I16_MAX = 32_767;
const U8_MAX = 0xff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffff_ffff;
const MAX_ITEM_STACK = 0x7fff_ffff;
const U64_SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const U64_MAX = BigInt("18446744073709551615");
const MAX_DEATH_RESPAWN_DROPS = 17;
const WORLD_VIEW_COORDINATE_LIMIT_MILLI = BigInt(33_554_432_000);
const WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND = BigInt(4_096_000);
const WORLD_VIEW_FRACTION_SCALE = 1_000_000;
const PHYSICS_CONTACT_MASK_R10 = 0x03ff;
const PHYSICS_CONTACT_IN_LIQUID_R10 = 1 << 6;
const PHYSICS_CONTACT_HEAD_SUBMERGED_R10 = 1 << 7;
const CONTAINER_KEY = /^container-key-v1\/(?:[0-9a-f]{2})+$/u;

export type RustLivePlayerHeldStackR10 = Readonly<{
  itemCode: number;
  count: number;
  durabilityMillionths: number | null;
  metadataHash: Uint8Array;
}>;

export type RustLivePlayerCombatParityR10 = Readonly<{
  domainRevision: bigint;
  rowRevision: bigint;
  /** Explicit native R7 CAS counter; rowRevision is a semantic wire hash. */
  combatantRevision?: bigint | null;
  recordId: string;
  ownerId: string;
  entityId: bigint;
  vitalUnits: "millihearts-v1";
  health: number;
  maxHealth: number;
  alive: boolean;
  crossDomainParity: true;
}>;

export type RustLivePlayerDeathDropR10 = Readonly<{
  parentRespawnSequence: bigint;
  parentReceiptHash: string;
  sourceLane: "inventory" | "equipment";
  sourceSlot: number;
  stack: Readonly<{
    itemCode: number;
    count: number;
    durabilityMillionths: number | null;
    metadataHash: string;
  }>;
  dropId: string;
  entityId: bigint;
  custodyContainer: string;
  custodySlot: 0;
  custodyRevision: bigint;
  spatialRevision: bigint;
  position: Readonly<{ xMilli: number; yMilli: number; zMilli: number }>;
  velocityMilliPerSecond: Readonly<{ xMilli: number; yMilli: number; zMilli: number }>;
  rotation: Readonly<{ yaw: number; pitch: number; roll: number }>;
  createdTick: bigint;
  expiresTick: bigint | null;
  pickupLockActorId: string | null;
  pickupUnlockTick: bigint;
  originHash: string;
  content: Readonly<{
    configuredManifestHash: string;
    installedManifestHash: string;
    installedRegistryHash: string;
    itemContentHash: string;
    itemContentVersion: number;
  }>;
  /** True only when the same BWR6 extraction still contains the exact live child entity. */
  r6Linked: boolean;
}>;

/**
 * Full bounded native false-policy parent. Keeping every child and the parent
 * cursor/hash intact lets a later persisted receipt-cursor lane replay an
 * unprojected parent after reload without reconstructing authority in JS.
 */
export type RustLivePlayerDeathRespawnR10 = Readonly<{
  respawnSequence: bigint;
  receiptHash: string;
  generatedDropCount: number;
  playerId: bigint;
  entityId: bigint;
  deathSequence: bigint;
  inventoryContainer: string;
  inventoryBeforeRevision: bigint;
  inventoryAfterRevision: bigint;
  equipmentContainer: string;
  equipmentBeforeRevision: bigint;
  equipmentAfterRevision: bigint;
  custodyAfterHash: string;
  drops: readonly RustLivePlayerDeathDropR10[];
}>;

export function rustLivePlayerDeathRespawnLifecycleValidR10(
  alive: boolean,
  deathSequence: bigint | null,
  lastRespawnSequence: bigint | null,
) {
  if (lastRespawnSequence !== null && deathSequence === null) return false;
  return alive
    ? deathSequence === null ? lastRespawnSequence === null : lastRespawnSequence === deathSequence
    : deathSequence !== null && deathSequence > (lastRespawnSequence ?? BigInt(0));
}

/**
 * Read-only projection of the native BWAU effect ring carried by the same
 * extraction as the player body and combat rows. `firstSequence` may be
 * greater than one after the bounded native ring rolls over; continuity
 * between accepted player views is checked by the engine before commit.
 */
export type RustLivePlayerEffectJournalR10 = Readonly<{
  schema: 1;
  producer: "rust-bwau-v2";
  playerExternalId: string;
  authorityTick: bigint;
  total: number;
  selected: number;
  omitted: number;
  firstSequence: bigint | null;
  lastSequence: bigint | null;
  contiguous: boolean;
  cues: readonly RustAudioCueR10[];
}>;

function sameRustAudioCueR10(left: RustAudioCueR10, right: RustAudioCueR10) {
  return left.sequence === right.sequence
    && left.tick === right.tick
    && left.entityExternalId === right.entityExternalId
    && left.kind === right.kind
    && Object.is(left.amount, right.amount);
}

/**
 * Proves cross-extraction continuity for the bounded native effect ring.
 * A successor normally overlaps the prior cursor. The sole honest no-overlap
 * case is an exact full-capacity ring beginning at the immediate successor.
 */
export function rustLivePlayerEffectJournalContinuesR10(
  previous: RustLivePlayerEffectJournalR10,
  next: RustLivePlayerEffectJournalR10,
) {
  const previousLast = previous.lastSequence;
  const previousFirst = previous.firstSequence;
  const nextFirst = next.firstSequence;
  const nextLast = next.lastSequence;
  if (previousLast === null) {
    return previousFirst === null
      && (nextFirst === BigInt(1)
        || (nextFirst === null && nextLast === null && next.cues.length === 0));
  }
  if (previousFirst === null || nextFirst === null || nextLast === null
    || nextFirst < previousFirst || nextLast < previousLast
    || next.cues.at(0)?.sequence !== nextFirst
    || next.cues.at(-1)?.sequence !== nextLast
    || next.contiguous !== true) return false;
  const exactFullNextRing = next.total === RUST_AUDIO_MAX_EVENTS_R10
    && next.selected === RUST_AUDIO_MAX_EVENTS_R10
    && next.omitted === 0
    && next.cues.length === RUST_AUDIO_MAX_EVENTS_R10;
  if (nextFirst > previousFirst && !exactFullNextRing) return false;
  if (nextFirst <= previousLast) {
    const previousBySequence = new Map(previous.cues.map((cue) => [cue.sequence, cue]));
    for (const cue of next.cues) {
      if (cue.sequence > previousLast) break;
      const priorCue = previousBySequence.get(cue.sequence);
      if (!priorCue || !sameRustAudioCueR10(priorCue, cue)) return false;
    }
    return true;
  }
  return nextFirst === previousLast + BigInt(1)
    && exactFullNextRing
    && next.cues.at(0)?.sequence === nextFirst
    && next.cues.at(-1)?.sequence === nextLast;
}

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
  /** Zero is accepted only for legacy BWX0 fixtures predating the respawn row. */
  respawnAuthoritySchema?: 0 | 1;
  gameplaySequence?: bigint | null;
  gameplayCombatRevision?: bigint | null;
  deathSequence?: bigint | null;
  lastRespawnSequence?: bigint | null;
  queuedInputsEmpty?: boolean | null;
  pendingContextCommandsEmpty?: boolean | null;
  pendingMovementResultEmpty?: boolean | null;
  miningStateEmpty?: boolean | null;
  latestDeathRespawn?: RustLivePlayerDeathRespawnR10 | null;
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
  contactFlags: number;
  inLiquid: boolean;
  headSubmerged: boolean;
  drowningAccumulator: number;
  fallDistance: number;
  oxygenSeconds: number;
  maximumOxygenSeconds: number;
  health: number;
  maximumHealth: number;
  lastDamageTick: bigint;
  combat: RustLivePlayerCombatParityR10;
  effects: RustLivePlayerEffectJournalR10;
  held: RustLivePlayerHeldStackR10 | null;
}>;

export type RustLivePlayerRespawnDiagnosticsR10 = Readonly<{
  schema: 1;
  gameplaySequence: string;
  gameplayCombatRevision: string;
  combatantRevision: string;
  deathSequence: string | null;
  lastRespawnSequence: string | null;
  queuedInputsEmpty: boolean;
  pendingContextCommandsEmpty: boolean;
  pendingMovementResultEmpty: boolean;
  miningStateEmpty: boolean;
  latestDeathRespawn: Readonly<{
    respawnSequence: string;
    receiptHash: string;
    generatedDropCount: number;
    playerId: string;
    entityId: string;
    deathSequence: string;
    inventoryContainer: string;
    inventoryBeforeRevision: string;
    inventoryAfterRevision: string;
    equipmentContainer: string;
    equipmentBeforeRevision: string;
    equipmentAfterRevision: string;
    custodyAfterHash: string;
    drops: readonly Readonly<{
      parentRespawnSequence: string;
      parentReceiptHash: string;
      sourceLane: "inventory" | "equipment";
      sourceSlot: number;
      stack: Readonly<{
        itemCode: number;
        count: number;
        durabilityMillionths: number | null;
        metadataHash: string;
      }>;
      dropId: string;
      entityId: string;
      custodyContainer: string;
      custodySlot: 0;
      custodyRevision: string;
      spatialRevision: string;
      position: Readonly<{ xMilli: number; yMilli: number; zMilli: number }>;
      velocityMilliPerSecond: Readonly<{ xMilli: number; yMilli: number; zMilli: number }>;
      rotation: Readonly<{ yaw: number; pitch: number; roll: number }>;
      createdTick: string;
      expiresTick: string | null;
      pickupLockActorId: string | null;
      pickupUnlockTick: string;
      originHash: string;
      content: Readonly<{
        configuredManifestHash: string;
        installedManifestHash: string;
        installedRegistryHash: string;
        itemContentHash: string;
        itemContentVersion: number;
      }>;
      r6Linked: boolean;
    }>[];
  }> | null;
}>;

/**
 * JSON-safe read-only evidence for browser acceptance. This is intentionally
 * derived only from one already-validated BWX0 player view; it cannot create
 * respawn state or bridge a partial historical row.
 */
export function rustLivePlayerRespawnDiagnosticsR10(
  view: RustLivePlayerViewR10 | null | undefined,
): RustLivePlayerRespawnDiagnosticsR10 | null {
  if (!view || view.respawnAuthoritySchema !== 1
    || typeof view.gameplaySequence !== "bigint"
    || typeof view.gameplayCombatRevision !== "bigint"
    || typeof view.combat.combatantRevision !== "bigint"
    || (view.deathSequence !== null && typeof view.deathSequence !== "bigint")
    || (view.lastRespawnSequence !== null && typeof view.lastRespawnSequence !== "bigint")
    || typeof view.queuedInputsEmpty !== "boolean"
    || typeof view.pendingContextCommandsEmpty !== "boolean"
    || typeof view.pendingMovementResultEmpty !== "boolean"
    || typeof view.miningStateEmpty !== "boolean"
    || view.latestDeathRespawn === undefined) return null;
  const latest = view.latestDeathRespawn;
  return Object.freeze({
    schema: 1,
    gameplaySequence: view.gameplaySequence.toString(10),
    gameplayCombatRevision: view.gameplayCombatRevision.toString(10),
    combatantRevision: view.combat.combatantRevision.toString(10),
    deathSequence: view.deathSequence?.toString(10) ?? null,
    lastRespawnSequence: view.lastRespawnSequence?.toString(10) ?? null,
    queuedInputsEmpty: view.queuedInputsEmpty,
    pendingContextCommandsEmpty: view.pendingContextCommandsEmpty,
    pendingMovementResultEmpty: view.pendingMovementResultEmpty,
    miningStateEmpty: view.miningStateEmpty,
    latestDeathRespawn: latest ? Object.freeze({
      respawnSequence: latest.respawnSequence.toString(10),
      receiptHash: latest.receiptHash,
      generatedDropCount: latest.generatedDropCount,
      playerId: latest.playerId.toString(10),
      entityId: latest.entityId.toString(10),
      deathSequence: latest.deathSequence.toString(10),
      inventoryContainer: latest.inventoryContainer,
      inventoryBeforeRevision: latest.inventoryBeforeRevision.toString(10),
      inventoryAfterRevision: latest.inventoryAfterRevision.toString(10),
      equipmentContainer: latest.equipmentContainer,
      equipmentBeforeRevision: latest.equipmentBeforeRevision.toString(10),
      equipmentAfterRevision: latest.equipmentAfterRevision.toString(10),
      custodyAfterHash: latest.custodyAfterHash,
      drops: Object.freeze(latest.drops.map((drop) => Object.freeze({
        parentRespawnSequence: drop.parentRespawnSequence.toString(10),
        parentReceiptHash: drop.parentReceiptHash,
        sourceLane: drop.sourceLane,
        sourceSlot: drop.sourceSlot,
        stack: Object.freeze({ ...drop.stack }),
        dropId: drop.dropId,
        entityId: drop.entityId.toString(10),
        custodyContainer: drop.custodyContainer,
        custodySlot: drop.custodySlot,
        custodyRevision: drop.custodyRevision.toString(10),
        spatialRevision: drop.spatialRevision.toString(10),
        position: Object.freeze({ ...drop.position }),
        velocityMilliPerSecond: Object.freeze({ ...drop.velocityMilliPerSecond }),
        rotation: Object.freeze({ ...drop.rotation }),
        createdTick: drop.createdTick.toString(10),
        expiresTick: drop.expiresTick?.toString(10) ?? null,
        pickupLockActorId: drop.pickupLockActorId,
        pickupUnlockTick: drop.pickupUnlockTick.toString(10),
        originHash: drop.originHash,
        content: Object.freeze({ ...drop.content }),
        r6Linked: drop.r6Linked,
      }))),
    }) : null,
  });
}

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

function typedField<T extends RustDomainValueR10>(
  row: RustDomainRowR10,
  key: string,
  wireType: "bool" | "hash" | "i64" | "u64" | "string",
  guard: (value: RustDomainValueR10) => value is T,
) {
  const index = row.fields.findIndex(([name]) => name === key);
  invariant(index >= 0 && row.fieldTypes?.[index] === wireType,
    `live player combat field '${key}' is absent or has the wrong wire type`);
  const value = row.fields[index]![1];
  invariant(guard(value), `live player combat field '${key}' has the wrong value type`);
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

function typedOptionalU64(row: RustDomainRowR10, key: string, allowZero = false) {
  const present = typedField(row, `${key}.present`, "bool", isBoolean);
  const valueIndex = row.fields.findIndex(([name]) => name === `${key}.value`);
  invariant(present === (valueIndex >= 0), `${key} optional fields disagree`);
  if (!present) return null;
  invariant(row.fieldTypes?.[valueIndex] === "u64", `${key} optional value has the wrong wire type`);
  const value = row.fields[valueIndex]![1];
  invariant(isBigint(value), `${key} optional value is not u64`);
  invariant(value >= BigInt(allowZero ? 0 : 1) && value <= U64_SAFE_MAX,
    `${key} optional value exceeds its canonical browser authority range`);
  return value;
}

function typedOptionalString(row: RustDomainRowR10, key: string) {
  const present = typedField(row, `${key}.present`, "bool", isBoolean);
  const valueIndex = row.fields.findIndex(([name]) => name === `${key}.value`);
  invariant(present === (valueIndex >= 0), `${key} optional fields disagree`);
  if (!present) return null;
  invariant(row.fieldTypes?.[valueIndex] === "string", `${key} optional value has the wrong wire type`);
  const value = row.fields[valueIndex]![1];
  invariant(isString(value) && value.length > 0, `${key} optional value is not a nonempty string`);
  return value;
}

function safeAuthorityU64(row: RustDomainRowR10, key: string, allowZero = true) {
  const value = typedField(row, key, "u64", isBigint);
  invariant(value >= BigInt(allowZero ? 0 : 1) && value <= U64_SAFE_MAX,
    `${key} exceeds its canonical browser authority range`);
  return value;
}

function authorityIdentifierU64(row: RustDomainRowR10, key: string) {
  const value = typedField(row, key, "u64", isBigint);
  invariant(value > BigInt(0) && value <= U64_MAX,
    `${key} is not a canonical nonzero u64 authority identifier`);
  return value;
}

function hashHex(row: RustDomainRowR10, key: string, allowZero = false) {
  const value = typedField(row, key, "hash", isBytes);
  invariant(value.byteLength === 16 && (allowZero || value.some((byte) => byte !== 0)),
    `${key} is not a canonical${allowZero ? "" : " nonzero"} hash`);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeSigned(row: RustDomainRowR10, key: string, maximum: bigint) {
  const value = typedField(row, key, "i64", isBigint);
  invariant(value >= -maximum && value <= maximum && value >= -U64_SAFE_MAX && value <= U64_SAFE_MAX,
    `${key} exceeds its canonical browser fixed-point range`);
  return Number(value);
}

function hasField(row: RustDomainRowR10, key: string) {
  return row.fields.some(([name]) => name === key);
}

function exactRow(rows: readonly RustDomainRowR10[], kind: number, predicate: (row: RustDomainRowR10) => boolean, label: string) {
  const matches = rows.filter((row) => row.kind === kind && predicate(row));
  invariant(matches.length === 1, `live player ${label} must resolve exactly one authoritative row`);
  return matches[0];
}

function decodePlayerRespawnAuthorityR10(
  row: RustDomainRowR10,
  decoded: RustAuthoritativeExtractionR10,
  playerId: bigint,
  entityId: bigint,
  alive: boolean,
  inventoryContainer: string,
  inventoryRevision: bigint,
  equipmentContainer: string,
  equipmentRevision: bigint,
) {
  const required = [
    "gameplaySequence",
    "gameplayCombatRevision",
    "queuedInputsEmpty",
    "pendingContextCommandsEmpty",
    "pendingMovementResultEmpty",
    "miningStateEmpty",
    "deathSequence.present",
    "lastRespawnSequence.present",
    "latestDeathRespawn.present",
  ] as const;
  const updated = required.some((key) => hasField(row, key));
  if (!updated) {
    invariant(!row.fields.some(([key]) => key.startsWith("latestDeathRespawn.")
      || key.startsWith("deathSequence.") || key.startsWith("lastRespawnSequence.")),
    "legacy live player row contains a partial respawn authority schema");
    return Object.freeze({
      respawnAuthoritySchema: 0 as const,
      gameplaySequence: null,
      gameplayCombatRevision: null,
      deathSequence: null,
      lastRespawnSequence: null,
      queuedInputsEmpty: null,
      pendingContextCommandsEmpty: null,
      pendingMovementResultEmpty: null,
      miningStateEmpty: null,
      latestDeathRespawn: null,
    });
  }

  const gameplaySequence = safeAuthorityU64(row, "gameplaySequence");
  const gameplayCombatRevision = safeAuthorityU64(row, "gameplayCombatRevision");
  const queuedInputsEmpty = typedField(row, "queuedInputsEmpty", "bool", isBoolean);
  const pendingContextCommandsEmpty = typedField(row, "pendingContextCommandsEmpty", "bool", isBoolean);
  const pendingMovementResultEmpty = typedField(row, "pendingMovementResultEmpty", "bool", isBoolean);
  const miningStateEmpty = typedField(row, "miningStateEmpty", "bool", isBoolean);
  const deathSequence = typedOptionalU64(row, "deathSequence");
  const lastRespawnSequence = typedOptionalU64(row, "lastRespawnSequence");
  invariant(rustLivePlayerDeathRespawnLifecycleValidR10(alive, deathSequence, lastRespawnSequence),
  "live player death/respawn sequence lifecycle contradicts its combat state");

  const latestPresent = typedField(row, "latestDeathRespawn.present", "bool", isBoolean);
  if (!latestPresent) {
    invariant(!row.fields.some(([key]) => key.startsWith("latestDeathRespawn.")
      && key !== "latestDeathRespawn.present"),
    "absent latest death-respawn parent retains child fields");
    return Object.freeze({
      respawnAuthoritySchema: 1 as const,
      gameplaySequence,
      gameplayCombatRevision,
      deathSequence,
      lastRespawnSequence,
      queuedInputsEmpty,
      pendingContextCommandsEmpty,
      pendingMovementResultEmpty,
      miningStateEmpty,
      latestDeathRespawn: null,
    });
  }

  const used = new Set<string>([
    "latestDeathRespawn.present",
    "latestDeathRespawn.respawnSequence",
    "latestDeathRespawn.receiptHash",
    "latestDeathRespawn.generatedDropCount",
    "latestDeathRespawn.playerId",
    "latestDeathRespawn.entityId",
    "latestDeathRespawn.deathSequence",
    "latestDeathRespawn.inventoryContainer",
    "latestDeathRespawn.inventoryBeforeRevision",
    "latestDeathRespawn.inventoryAfterRevision",
    "latestDeathRespawn.equipmentContainer",
    "latestDeathRespawn.equipmentBeforeRevision",
    "latestDeathRespawn.equipmentAfterRevision",
    "latestDeathRespawn.custodyAfterHash",
  ]);
  const respawnSequence = safeAuthorityU64(row, "latestDeathRespawn.respawnSequence", false);
  const receiptHash = hashHex(row, "latestDeathRespawn.receiptHash");
  const generatedDropCount = Number(safeAuthorityU64(row, "latestDeathRespawn.generatedDropCount"));
  invariant(generatedDropCount <= MAX_DEATH_RESPAWN_DROPS,
    "latest death-respawn parent exceeds its bounded child count");
  const parentPlayerId = authorityIdentifierU64(row, "latestDeathRespawn.playerId");
  const parentEntityId = authorityIdentifierU64(row, "latestDeathRespawn.entityId");
  const parentDeathSequence = safeAuthorityU64(row, "latestDeathRespawn.deathSequence", false);
  const parentInventoryContainer = typedField(
    row,
    "latestDeathRespawn.inventoryContainer",
    "string",
    isString,
  );
  const inventoryBeforeRevision = safeAuthorityU64(row, "latestDeathRespawn.inventoryBeforeRevision");
  const inventoryAfterRevision = safeAuthorityU64(row, "latestDeathRespawn.inventoryAfterRevision");
  const parentEquipmentContainer = typedField(
    row,
    "latestDeathRespawn.equipmentContainer",
    "string",
    isString,
  );
  const equipmentBeforeRevision = safeAuthorityU64(row, "latestDeathRespawn.equipmentBeforeRevision");
  const equipmentAfterRevision = safeAuthorityU64(row, "latestDeathRespawn.equipmentAfterRevision");
  const custodyAfterHash = hashHex(row, "latestDeathRespawn.custodyAfterHash");
  invariant(parentPlayerId === playerId && parentEntityId === entityId
    && deathSequence !== null && parentDeathSequence <= deathSequence,
  "latest death-respawn parent does not belong to the current player lifecycle");
  invariant(parentInventoryContainer === inventoryContainer
    && parentEquipmentContainer === equipmentContainer,
  "latest death-respawn parent does not bind the active player custody keys");
  invariant(inventoryAfterRevision <= inventoryRevision && equipmentAfterRevision <= equipmentRevision,
    "latest death-respawn custody revision is newer than the live player binding");

  const drops: RustLivePlayerDeathDropR10[] = [];
  const dropIds = new Set<string>();
  const entityIds = new Set<bigint>();
  const custodyIds = new Set<string>();
  let previousOrder = -1;
  for (let index = 0; index < generatedDropCount; index += 1) {
    const prefix = `latestDeathRespawn.drop.${index.toString().padStart(4, "0")}`;
    const key = (suffix: string) => {
      const value = `${prefix}.${suffix}`;
      used.add(value);
      return value;
    };
    const sourceLaneValue = Number(safeAuthorityU64(row, key("sourceLane")));
    invariant(sourceLaneValue === 0 || sourceLaneValue === 1,
      "latest death-respawn child has an unknown custody lane");
    const sourceLane = sourceLaneValue === 0 ? "inventory" as const : "equipment" as const;
    const sourceSlot = Number(safeAuthorityU64(row, key("sourceSlot")));
    invariant(sourceSlot <= (sourceLane === "inventory" ? 8 : 7),
      "latest death-respawn child source slot exceeds its lane");
    const order = sourceLaneValue * 9 + sourceSlot;
    invariant(order > previousOrder, "latest death-respawn children are not in canonical lane/slot order");
    previousOrder = order;

    const itemCode = Number(safeAuthorityU64(row, key("stack.itemCode"), false));
    invariant(itemCode <= U32_MAX, "latest death-respawn child item code exceeds u32");
    const count = Number(safeAuthorityU64(row, key("stack.count"), false));
    invariant(count <= MAX_ITEM_STACK, "latest death-respawn child item count exceeds the native stack bound");
    const durabilityKey = `${prefix}.stack.durability`;
    used.add(`${durabilityKey}.present`);
    if (hasField(row, `${durabilityKey}.value`)) used.add(`${durabilityKey}.value`);
    const durabilityValue = typedOptionalU64(row, durabilityKey, true);
    const durabilityMillionths = durabilityValue === null ? null : Number(durabilityValue);
    invariant(durabilityMillionths === null || durabilityMillionths <= 1_000_000,
      "latest death-respawn child durability exceeds one millionth scale");
    const metadataHash = hashHex(row, key("stack.metadataHash"), true);
    const dropId = typedField(row, key("dropId"), "string", isString);
    const dropEntityId = authorityIdentifierU64(row, key("entityId"));
    const custodyContainer = typedField(row, key("custodyContainer"), "string", isString);
    const expectedDropId = `player-death-drop-v1:${parentPlayerId}:${parentDeathSequence}:${sourceLaneValue}:${sourceSlot}`;
    const expectedCustodyContainer = rustIntegratedContainerViewKeyV1(Object.freeze({
      kind: "container" as const,
      id: `player-death-custody-v1:${parentPlayerId}:${parentDeathSequence}:${sourceLane}:${sourceSlot}`,
      ownerId: null,
    }));
    invariant(dropId === expectedDropId && CONTAINER_KEY.test(custodyContainer)
      && custodyContainer === expectedCustodyContainer,
      "latest death-respawn child identity or custody container is invalid");
    const custodySlot = Number(safeAuthorityU64(row, key("custodySlot")));
    const custodyRevision = safeAuthorityU64(row, key("custodyRevision"));
    const spatialRevision = safeAuthorityU64(row, key("spatialRevision"));
    invariant(custodySlot === 0 && custodyRevision === BigInt(0) && spatialRevision === BigInt(0),
      "latest death-respawn child custody/spatial genesis is not exact");
    invariant(dropIds.add(dropId) && entityIds.add(dropEntityId) && custodyIds.add(custodyContainer)
      && dropEntityId !== entityId,
    "latest death-respawn child identities are duplicated or alias the player");

    const position = Object.freeze({
      xMilli: safeSigned(row, key("position.xMilli"), WORLD_VIEW_COORDINATE_LIMIT_MILLI),
      yMilli: safeSigned(row, key("position.yMilli"), WORLD_VIEW_COORDINATE_LIMIT_MILLI),
      zMilli: safeSigned(row, key("position.zMilli"), WORLD_VIEW_COORDINATE_LIMIT_MILLI),
    });
    const velocityMilliPerSecond = Object.freeze({
      xMilli: safeSigned(row, key("velocity.xMilliPerSecond"), WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND),
      yMilli: safeSigned(row, key("velocity.yMilliPerSecond"), WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND),
      zMilli: safeSigned(row, key("velocity.zMilliPerSecond"), WORLD_VIEW_VELOCITY_LIMIT_MILLI_PER_SECOND),
    });
    const rotation = Object.freeze({
      yaw: Number(safeAuthorityU64(row, key("rotation.yaw"))),
      pitch: Number(safeAuthorityU64(row, key("rotation.pitch"))),
      roll: Number(safeAuthorityU64(row, key("rotation.roll"))),
    });
    invariant(Object.values(rotation).every((value) => value < WORLD_VIEW_FRACTION_SCALE),
      "latest death-respawn child rotation exceeds microturn scale");
    const createdTick = safeAuthorityU64(row, key("createdTick"));
    const expiresKey = `${prefix}.expiresTick`;
    used.add(`${expiresKey}.present`);
    if (hasField(row, `${expiresKey}.value`)) used.add(`${expiresKey}.value`);
    const expiresTick = typedOptionalU64(row, expiresKey);
    const lockKey = `${prefix}.pickupLockActorId`;
    used.add(`${lockKey}.present`);
    if (hasField(row, `${lockKey}.value`)) used.add(`${lockKey}.value`);
    const pickupLockActorId = typedOptionalString(row, lockKey);
    const pickupUnlockTick = safeAuthorityU64(row, key("pickupUnlockTick"));
    invariant(createdTick <= decoded.domains!.authorityTick
      && pickupLockActorId === null
      && pickupUnlockTick === createdTick + RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PICKUP_DELAY_TICKS_V1
      && (expiresTick === null || expiresTick >= pickupUnlockTick),
    "latest death-respawn child lifetime or pickup lock is invalid");
    const originHash = hashHex(row, key("originHash"));
    const configuredManifestHash = hashHex(row, key("content.configuredManifestHash"));
    const installedManifestHash = hashHex(row, key("content.installedManifestHash"));
    const installedRegistryHash = hashHex(row, key("content.installedRegistryHash"));
    const itemContentHash = hashHex(row, key("content.itemContentHash"));
    const itemContentVersion = Number(safeAuthorityU64(row, key("content.itemContentVersion"), false));
    invariant(itemContentVersion <= U32_MAX && configuredManifestHash === installedManifestHash,
      "latest death-respawn child content binding is not the exact installed manifest");

    const r6Candidates = decoded.entities!.records.filter((record) =>
      record.entityId === dropEntityId || record.externalEntityId === dropId);
    invariant(r6Candidates.length <= 1,
      "latest death-respawn child aliases multiple BWR6 entity records");
    const linked = r6Candidates[0] ?? null;
    if (linked) {
      // The retained R7/WorldView receipt describes immutable spawn provenance.
      // The live R6 entity owns a separate revision domain and may move after
      // spawning, so only its stable cross-domain identity is comparable here.
      invariant(linked.entityId === dropEntityId && linked.externalEntityId === dropId
        && linked.specimenId === dropId
        && linked.residency === "hot"
        && linked.class === "construct" && linked.kindKey === "dropped-item"
        && linked.entityRevision > spatialRevision,
      "latest death-respawn child disagrees with its exact BWR6 entity");
    }

    drops.push(Object.freeze({
      parentRespawnSequence: respawnSequence,
      parentReceiptHash: receiptHash,
      sourceLane,
      sourceSlot,
      stack: Object.freeze({ itemCode, count, durabilityMillionths, metadataHash }),
      dropId,
      entityId: dropEntityId,
      custodyContainer,
      custodySlot: 0 as const,
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
      content: Object.freeze({
        configuredManifestHash,
        installedManifestHash,
        installedRegistryHash,
        itemContentHash,
        itemContentVersion,
      }),
      r6Linked: linked !== null,
    }));
  }
  invariant(!row.fields.some(([name]) => name.startsWith("latestDeathRespawn.") && !used.has(name)),
    "latest death-respawn parent contains unknown, out-of-range, or trailing child fields");
  const inventoryChanged = drops.some((drop) => drop.sourceLane === "inventory");
  const equipmentChanged = drops.some((drop) => drop.sourceLane === "equipment");
  invariant(inventoryAfterRevision === inventoryBeforeRevision + BigInt(Number(inventoryChanged))
    && equipmentAfterRevision === equipmentBeforeRevision + BigInt(Number(equipmentChanged)),
  "latest death-respawn parent custody revisions do not match its child lanes");

  const latestDeathRespawn = Object.freeze({
    respawnSequence,
    receiptHash,
    generatedDropCount,
    playerId: parentPlayerId,
    entityId: parentEntityId,
    deathSequence: parentDeathSequence,
    inventoryContainer: parentInventoryContainer,
    inventoryBeforeRevision,
    inventoryAfterRevision,
    equipmentContainer: parentEquipmentContainer,
    equipmentBeforeRevision,
    equipmentAfterRevision,
    custodyAfterHash,
    drops: Object.freeze(drops),
  });
  return Object.freeze({
    respawnAuthoritySchema: 1 as const,
    gameplaySequence,
    gameplayCombatRevision,
    deathSequence,
    lastRespawnSequence,
    queuedInputsEmpty,
    pendingContextCommandsEmpty,
    pendingMovementResultEmpty,
    miningStateEmpty,
    latestDeathRespawn,
  });
}

function livePlayerFromDecoded(decoded: RustAuthoritativeExtractionR10, externalEntityId: string): RustLivePlayerViewR10 {
  invariant(decoded.entities !== null && decoded.domains !== null, "live player view requires both BWR6 and BWX0 extraction");
  invariant(decoded.audio !== null, "live player view requires the same-envelope BWAU effect journal");
  invariant(decoded.entities.omitted === 0, "live player view cannot infer identity from an omitted entity extraction");
  const playerView = decoded.domains.views.find((view) => view.domain === 2);
  invariant(playerView !== undefined && playerView.omitted === 0,
    "live player BWX0 view is missing or truncated");

  const runtimeRow = exactRow(playerView.rows, 1, (row) => row.key === externalEntityId, "runtime row");
  const runtime = fields(runtimeRow);
  const entityId = field(runtime, "entityId", isBigint);
  const entityMatches = decoded.entities.records.filter((record) =>
    record.entityId === entityId && record.externalEntityId === externalEntityId && record.class === "player");
  invariant(entityMatches.length === 1, "live player runtime row does not match exactly one BWR6 player entity");
  const playerEntity = entityMatches[0];

  const combatView = decoded.domains.views.find((view) => view.domain === 5);
  invariant(combatView !== undefined && combatView.status !== "absent" && combatView.omitted === 0,
    "live player BWX0 combat view is missing or truncated");
  const combatRows = combatView.rows.filter((row) => row.kind === 1
    && fields(row).get("entityId") === entityId);
  invariant(combatRows.length === 1,
    "live player combat view must resolve exactly one R7 row linked to its R6 entity");
  const combatRow = combatRows[0]!;
  invariant(combatRow.key.startsWith("combatant:") && combatRow.key.length > "combatant:".length,
    "live player combat row has no canonical record identity");
  const combatOwnerPresent = typedField(combatRow, "ownerId.present", "bool", isBoolean);
  invariant(combatOwnerPresent, "live player combat row has no authoritative owner");
  const combatOwnerId = typedField(combatRow, "ownerId.value", "string", isString);
  const combatEntityId = typedField(combatRow, "entityId", "u64", isBigint);
  const combatVitalUnits = typedField(combatRow, "vitalUnits", "string", isString);
  const combatHealth = integer(typedField(combatRow, "health", "u64", isBigint), U32_MAX, "combat health");
  const combatMaxHealth = integer(typedField(combatRow, "maxHealth", "u64", isBigint), U32_MAX, "combat maximum health");
  const combatAlive = typedField(combatRow, "alive", "bool", isBoolean);
  const combatCrossDomainParity = typedField(combatRow, "crossDomainParity", "bool", isBoolean);
  const combatantRevision = hasField(combatRow, "combatantRevision")
    ? safeAuthorityU64(combatRow, "combatantRevision")
    : null;
  invariant(combatOwnerId.length > 0, "live player R7 combat owner is empty");
  invariant(combatEntityId === entityId && combatVitalUnits === "millihearts-v1" && combatCrossDomainParity,
    "live player R7 combat row is not an exact-linked milliheart authority record");
  invariant(combatMaxHealth > 0 && combatHealth <= combatMaxHealth
    && combatAlive === (combatHealth > 0)
    && playerEntity.maximumHealth === Math.fround(combatMaxHealth / 1_000)
    && playerEntity.health === Math.fround(combatHealth / 1_000),
  "live player R6 and R7 health or alive parity disagrees");
  const combat = Object.freeze({
    domainRevision: combatView.revision,
    rowRevision: combatRow.revision,
    ...(combatantRevision === null ? {} : { combatantRevision }),
    recordId: combatRow.key.slice("combatant:".length),
    ownerId: combatOwnerId,
    entityId: combatEntityId,
    vitalUnits: "millihearts-v1" as const,
    health: combatHealth,
    maxHealth: combatMaxHealth,
    alive: combatAlive,
    crossDomainParity: true as const,
  });

  const bindingRow = exactRow(playerView.rows, 2, (row) => fields(row).get("entityId") === entityId, "world-view binding row");
  const binding = fields(bindingRow);
  const actorId = field(binding, "actorId", isString);
  const playerId = field(binding, "playerId", isBigint);
  invariant(playerId > BigInt(0) && actorId.length > 0, "live player binding identity is empty");
  invariant(combat.recordId === actorId && combat.ownerId === actorId,
    "live player R7 combat record or owner does not match its world-view actor identity");
  invariant(field(binding, "entityRevision", isBigint) === playerEntity.entityRevision,
    "live player world-view and entity revisions disagree");

  const selectedSlot = integer(field(binding, "selectedSlot", isBigint), 8, "selected slot");
  invariant(integer(field(runtime, "selectedSlot", isBigint), 8, "runtime selected slot") === selectedSlot,
    "live player runtime and world-view selected slots disagree");
  const inventoryContainer = field(binding, "inventoryContainer", isString);
  const equipmentContainer = field(binding, "equipmentContainer", isString);
  invariant(CONTAINER_KEY.test(inventoryContainer) && CONTAINER_KEY.test(equipmentContainer)
    && inventoryContainer !== equipmentContainer, "live player container keys are invalid or aliased");
  const inventoryContainerRevision = field(binding, "inventoryContainerRevision", isBigint);
  const equipmentContainerRevision = field(binding, "equipmentContainerRevision", isBigint);
  const respawnAuthority = decodePlayerRespawnAuthorityR10(
    runtimeRow,
    decoded,
    playerId,
    entityId,
    combatAlive,
    inventoryContainer,
    inventoryContainerRevision,
    equipmentContainer,
    equipmentContainerRevision,
  );
  invariant(respawnAuthority.respawnAuthoritySchema === 0
    || combat.combatantRevision !== null && combat.combatantRevision !== undefined,
    "updated live player respawn schema omits the explicit native combatant revision");

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
  const contactFlags = integer(field(runtime, "contactFlags", isBigint), PHYSICS_CONTACT_MASK_R10, "contact flags");
  const inLiquid = (contactFlags & PHYSICS_CONTACT_IN_LIQUID_R10) !== 0;
  const headSubmerged = (contactFlags & PHYSICS_CONTACT_HEAD_SUBMERGED_R10) !== 0;
  invariant(playerEntity.submerged === inLiquid && (!headSubmerged || inLiquid),
    "live player runtime contacts and BWR6 submerged state disagree");
  const drowningAccumulator = readNumber("drowningAccumulator");
  const fallDistance = readNumber("fallDistance");
  invariant(drowningAccumulator >= 0 && fallDistance >= 0,
    "live player environmental accumulators are negative");

  const lastInputSequence = field(runtime, "lastInputSequence", isBigint);
  const lookYawValue = runtime.get("input.lookYaw");
  const lookYaw = lookYawValue === undefined ? null : signedInput(field(runtime, "input.lookYaw", isBigint), "live player yaw");
  const audio = decoded.audio;
  const firstSequence = audio.cues.at(0)?.sequence ?? null;
  const lastSequence = audio.cues.at(-1)?.sequence ?? null;
  const contiguous = audio.cues.every((cue, index) => {
    const prior = audio.cues[index - 1];
    return cue.tick <= audio.authorityTick
      && cue.entityExternalId.length > 0
      && Number.isFinite(cue.amount)
      && (!prior || cue.sequence === prior.sequence + BigInt(1));
  });
  const effects = Object.freeze({
    schema: 1 as const,
    producer: "rust-bwau-v2" as const,
    playerExternalId: externalEntityId,
    authorityTick: audio.authorityTick,
    total: audio.total,
    selected: audio.selected,
    omitted: audio.omitted,
    firstSequence,
    lastSequence,
    contiguous,
    cues: audio.cues,
  });
  return Object.freeze({
    extractionRevision: decoded.extractionRevision,
    authorityTick: decoded.domains.authorityTick,
    externalEntityId,
    actorId,
    playerId,
    entityId,
    entityRevision: playerEntity.entityRevision,
    inventoryContainer,
    inventoryContainerRevision,
    equipmentContainer,
    equipmentContainerRevision,
    selectedSlot,
    backSlot: (() => { const value = optionalU64(binding, "backSlot"); return value === null ? null : integer(value, U16_MAX, "back slot"); })(),
    ...respawnAuthority,
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
    contactFlags,
    inLiquid,
    headSubmerged,
    drowningAccumulator,
    fallDistance,
    oxygenSeconds: readNumber("oxygenSeconds"),
    maximumOxygenSeconds: readNumber("maximumOxygenSeconds"),
    health: playerEntity.health,
    maximumHealth: playerEntity.maximumHealth,
    lastDamageTick: playerEntity.lastDamageTick,
    combat,
    effects,
    held,
  });
}

/** Strict read-only player mirror; no missing field is synthesized. */
export function decodeRustLivePlayerViewR10(extraction: RustIntegratedRuntimeExtractionV1, externalEntityId: string) {
  invariant(typeof externalEntityId === "string" && externalEntityId.length > 0, "live player external identity is empty");
  return livePlayerFromDecoded(decodeRustAuthoritativeExtractionR10(extraction), externalEntityId);
}
