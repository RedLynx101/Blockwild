import {
  Item,
  ITEMS,
  type EquipmentSlot,
  type GameMode,
  type ItemCode,
} from "./data";
import {
  characterNetworkId,
  characterRaceTraits,
  type CharacterProfile,
} from "./character-profiles";
import { playerModelHeightScale } from "./player-model";
import { MAX_SKILL_LEVEL, skillMultiplier } from "./skills";
import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec";
import {
  rustIntegratedRuntimeIdentityEqualsV1,
  type RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract";
import {
  type RustIntegratedPlayerBootstrapIntentV1,
  type RustIntegratedPlayerBootstrapObservationV1,
  type RustIntegratedPlayerBootstrapServiceV1,
} from "./rust-integrated-runtime-player-bootstrap";
import {
  rustIntegratedPlayerInventoryMetadataHashV1,
  rustIntegratedPlayerInventoryResultHashV1,
  normalizeRustIntegratedPlayerInventoryIntentV1,
  type RustIntegratedContainerKeyV1,
  type RustIntegratedPlayerInventoryIntentStackV1,
  type RustIntegratedPlayerInventoryMetadataV1,
  type RustIntegratedPlayerInventoryStackV1,
} from "./rust-integrated-runtime-player-inventory";
import {
  decodeRustIntegratedPlayerBootstrapStatusReceiptV1,
  encodeRustIntegratedPlayerBootstrapStatusQueryV1,
  RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
} from "./rust-integrated-runtime-player-status";
import {
  deriveRustIntegratedLocationIdV1,
  deriveRustIntegratedPlayerIdV1,
} from "./rust-integrated-runtime-identity";
import { encodeRustIntegratedPlayerBindingV1 } from "./rust-integrated-runtime-player";
import { encodeRustIntegratedEntityCompatibilityImportV1 } from "./rust-integrated-runtime-entities";
import { PLAYER_RENDER_MODEL_ID_V1 } from "./rust-player-render-profile";

const COMPATIBILITY_INVENTORY_SLOTS_V1 = 36;
const PLAYER_HOTBAR_SLOTS_V1 = 9;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const MAX_NATIVE_STACK_V1 = 0x7fff_ffff;
const textEncoder = new TextEncoder();

/**
 * Stable native defaults for a newly-created player. They describe a new Rust
 * authority record; they are deliberately not a conversion table for legacy
 * saves whose health, velocity, or age units were never persisted.
 */
export const RUST_NEW_WORLD_PLAYER_ENTITY_DEFAULTS_V1 = Object.freeze({
  health: Object.freeze({ current: 20, maximum: 20 }),
  ageTicks: BigInt(0),
  velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
  grounded: false,
});

/** Static profile values represented exactly by the R5 player binding. */
export const RUST_PLAYER_COMPATIBILITY_BINDING_BASE_V1 = Object.freeze({
  radius: 0.3,
  standingHeight: 1.8,
  crouchingHeight: 1.48,
  mass: 1.15,
  walkSpeed: 4.35,
  sprintSpeed: 6.35,
  creativeFlightSpeed: 9.5,
  maximumOxygenSeconds: 12,
});

/** BWF6 creates eight native equipment slots and reserves this fixed back slot. */
export const RUST_PLAYER_BOOTSTRAP_NATIVE_BACK_SLOT_V1 = 7;

export type RustPlayerCompatibilityVec3V1 = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type RustPlayerCompatibilityMetadataSourceV1 = Readonly<{
  typeId: string;
  schemaId: string;
  schemaVersion: number;
  contentVersion: number;
  /** Exact opaque bytes from a source that actually retained them. */
  unknownExtensionBytes: Uint8Array;
}>;

export type RustPlayerCompatibilityInventorySlotV1 = Readonly<{
  item: ItemCode;
  count: number;
  durability?: number;
  metadata?: Readonly<Record<string, unknown>>;
  /** Required whenever metadata is present; legacy raw JSON cannot imply it. */
  nativeMetadataSource?: RustPlayerCompatibilityMetadataSourceV1;
}>;

export type RustPlayerCompatibilityInventoryV1 = Readonly<{
  /** The normalized compatibility mirror has exactly 36 pack slots. */
  slots: readonly (RustPlayerCompatibilityInventorySlotV1 | null)[];
  selectedSlot: number;
  equipment: Readonly<Partial<Record<EquipmentSlot, RustPlayerCompatibilityInventorySlotV1 | null>>>;
  offhand: RustPlayerCompatibilityInventorySlotV1 | null;
  cursor: RustPlayerCompatibilityInventorySlotV1 | null;
  trash: RustPlayerCompatibilityInventorySlotV1 | null;
  craftGrid: readonly (RustPlayerCompatibilityInventorySlotV1 | null)[];
}>;

type RustPlayerCompatibilityWorldBaseV1 = Readonly<{
  schema: 1;
  universeKey: string;
  locationKey: string;
  /** Explicit caller-owned audit identity. This adapter does not guess it. */
  commandActorId: string;
  mode: GameMode;
  position: RustPlayerCompatibilityVec3V1;
  yaw: number;
  inventory: RustPlayerCompatibilityInventoryV1;
}>;

export type RustPlayerNewWorldCompatibilityV1 = RustPlayerCompatibilityWorldBaseV1 & Readonly<{
  kind: "new-world";
}>;

export type RustPlayerRichSaveCompatibilityV1 = RustPlayerCompatibilityWorldBaseV1 & Readonly<{
  kind: "rich-save";
  /** Current WorldSave lacks this field, so legacy rich saves fail closed. */
  ownerActorId: string | null;
  /** Exact current level, not the profile's original allocation. */
  explorationLevel: number | null;
  /** Binding cannot freeze a temporary movement multiplier into durable state. */
  hasTimedMovementModifiers: boolean | null;
  continuity: Readonly<{
    /** Values are already in native R6 units; this adapter performs no guessed conversion. */
    velocity: RustPlayerCompatibilityVec3V1 | null;
    health: Readonly<{ current: number; maximum: number }> | null;
    ageTicks: bigint | null;
    grounded: boolean | null;
  }>;
}>;

export type RustPlayerBootstrapCompatibilityIdentityV1 = Readonly<{
  actorId: string;
  externalEntityId: string;
  playerId: bigint;
  locationId: bigint;
  commandActorId: string;
}>;

export type RustPlayerBootstrapCompatibilityIdentitySourceV1 = Readonly<{
  universeKey: string;
  locationKey: string;
  commandActorId: string;
}>;

export type RustPlayerBootstrapCompatibilityPlanV1 = Readonly<{
  identity: RustPlayerBootstrapCompatibilityIdentityV1;
  intent: RustIntegratedPlayerBootstrapIntentV1;
}>;

export class RustPlayerBootstrapCompatibilityErrorV1 extends Error {
  readonly name = "RustPlayerBootstrapCompatibilityErrorV1";

  constructor(readonly code: string, message: string, readonly cause?: unknown) {
    super(message);
  }
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new RustPlayerBootstrapCompatibilityErrorV1(code, message, cause);
}

function visibleId(value: string, label: string, maximumBytes = 1_024) {
  if (typeof value !== "string"
    || value.length === 0
    || textEncoder.encode(value).byteLength > maximumBytes
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || /[\ud800-\udfff]/u.test(value)) {
    fail("compatibility-identity", `${label} is not a bounded, visible UTF-8 identity`);
  }
  return value;
}

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) fail("compatibility-number", `${label} is not finite`);
  return value;
}

function f32(value: number, label: string, exact: boolean) {
  const rounded = Math.fround(finite(value, label));
  if (!Number.isFinite(rounded)) fail("compatibility-number", `${label} is outside finite f32`);
  if (exact && !Object.is(value, rounded)) {
    fail("compatibility-f32-loss", `${label} is not exactly representable by the R6 f32 record`);
  }
  return rounded;
}

function f32Vec(value: RustPlayerCompatibilityVec3V1, label: string, exact: boolean) {
  return Object.freeze({
    x: f32(value.x, `${label}.x`, exact),
    y: f32(value.y, `${label}.y`, exact),
    z: f32(value.z, `${label}.z`, exact),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("compatibility-metadata-json", "metadata JSON contains a non-finite number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("compatibility-metadata-json", "metadata JSON contains an unsupported value");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** Exact canonical JSON V1 byte source used by native item-instance metadata. */
export function canonicalRustPlayerCompatibilityMetadataJsonBytesV1(value: unknown) {
  return textEncoder.encode(canonicalJson(value));
}

function metadataForSlot(slot: RustPlayerCompatibilityInventorySlotV1, slotIndex: number) {
  if (slot.metadata === undefined) {
    if (slot.nativeMetadataSource !== undefined) {
      fail("compatibility-metadata-orphan", `slot ${slotIndex} supplies a native metadata source without metadata`);
    }
    return null;
  }
  const source = slot.nativeMetadataSource;
  if (!source) {
    fail("compatibility-metadata-source", `slot ${slotIndex} metadata has no exact native descriptor or extension-byte source`);
  }
  try {
    const descriptor = Object.freeze({
      typeId: source.typeId,
      schemaId: source.schemaId,
      schemaVersion: source.schemaVersion,
      contentVersion: source.contentVersion,
      canonicalJsonBytes: canonicalRustPlayerCompatibilityMetadataJsonBytesV1(slot.metadata),
      unknownExtensionBytes: Uint8Array.from(source.unknownExtensionBytes),
    });
    return Object.freeze({
      hash: rustIntegratedPlayerInventoryMetadataHashV1(descriptor),
      ...descriptor,
    });
  } catch (error) {
    return fail("compatibility-metadata-descriptor", `slot ${slotIndex} metadata descriptor is not native-canonical`, error);
  }
}

function intentSlot(slot: RustPlayerCompatibilityInventorySlotV1 | null, slotIndex: number): RustIntegratedPlayerInventoryIntentStackV1 {
  if (!slot) return null;
  if (!Number.isInteger(slot.item) || slot.item <= 0 || slot.item > 0xffff_ffff || !ITEMS[slot.item]) {
    fail("compatibility-item", `slot ${slotIndex} references an unknown native item code`);
  }
  const definition = ITEMS[slot.item];
  if (!Number.isInteger(slot.count) || slot.count <= 0
    || slot.count > MAX_NATIVE_STACK_V1 || slot.count > definition.maxStack) {
    fail("compatibility-stack", `slot ${slotIndex} count is outside the installed item definition`);
  }
  if (slot.durability !== undefined || definition.maxDurability !== undefined || definition.infiniteDurability === true) {
    fail("compatibility-durability-unsealed", `slot ${slotIndex} uses durability without a reviewed integer-to-millionths contract`);
  }
  return Object.freeze({
    itemCode: slot.item,
    count: slot.count,
    durabilityMillionths: null,
    metadata: metadataForSlot(slot, slotIndex),
  });
}

function hasStack(value: RustPlayerCompatibilityInventorySlotV1 | null | undefined) {
  return value !== null && value !== undefined;
}

function validateInventoryEnvelope(value: RustPlayerCompatibilityInventoryV1) {
  if (!Array.isArray(value.slots) || value.slots.length !== COMPATIBILITY_INVENTORY_SLOTS_V1) {
    fail("compatibility-inventory-geometry", "compatibility inventory must contain exactly 36 normalized slots");
  }
  if (!Number.isInteger(value.selectedSlot) || value.selectedSlot < 0 || value.selectedSlot >= PLAYER_HOTBAR_SLOTS_V1) {
    fail("compatibility-selected-slot", "selected compatibility slot is outside the nine-slot hotbar");
  }
  if (value.slots.slice(PLAYER_HOTBAR_SLOTS_V1).some(hasStack)) {
    fail("compatibility-inventory-overflow", "slots 9..35 cannot be represented by the native nine-slot player custody");
  }
  if (Object.values(value.equipment).some(hasStack)) {
    fail("compatibility-equipment", "legacy equipment cannot be imported by the player bootstrap inventory operation");
  }
  if (hasStack(value.offhand)) fail("compatibility-offhand", "legacy offhand custody has no player bootstrap import field");
  if (hasStack(value.cursor)) fail("compatibility-cursor", "legacy cursor custody must be empty before player migration");
  if (hasStack(value.trash)) fail("compatibility-trash", "legacy trash custody has no player bootstrap import field");
  if (!Array.isArray(value.craftGrid) || value.craftGrid.length !== PLAYER_HOTBAR_SLOTS_V1) {
    fail("compatibility-crafting-geometry", "legacy crafting custody must contain exactly nine normalized slots");
  }
  if (value.craftGrid.some(hasStack)) {
    fail("compatibility-crafting", "legacy crafting custody must be empty before player migration");
  }
}

function validateNewWorldInventory(mode: GameMode, inventory: RustPlayerCompatibilityInventoryV1) {
  if (inventory.selectedSlot !== 0) fail("new-world-selected-slot", "a new compatibility world must begin at hotbar slot zero");
  const occupied = inventory.slots.flatMap((slot, index) => slot ? [{ slot, index }] : []);
  if (mode === "builder") {
    if (occupied.length !== 0) fail("new-world-inventory", "a new builder world must begin with an empty compatibility pack");
    return;
  }
  const initial = occupied[0];
  if (occupied.length !== 1 || initial.index !== 0 || initial.slot.item !== Item.Berry || initial.slot.count !== 3
    || initial.slot.durability !== undefined || initial.slot.metadata !== undefined
    || initial.slot.nativeMetadataSource !== undefined) {
    fail("new-world-inventory", "a new survival world must begin with exactly three metadata-free berries in slot zero");
  }
}

function inventoryIntent(actorId: string, value: RustPlayerCompatibilityInventoryV1) {
  validateInventoryEnvelope(value);
  const inventoryContainer: RustIntegratedContainerKeyV1 = Object.freeze({
    kind: "player",
    id: actorId,
    ownerId: actorId,
  });
  const slots = Object.freeze(value.slots.slice(0, PLAYER_HOTBAR_SLOTS_V1).map(intentSlot));
  const normalizedSlots: readonly (RustIntegratedPlayerInventoryStackV1 | null)[] = Object.freeze(slots.map((slot) => slot && Object.freeze({
    itemCode: slot.itemCode,
    count: slot.count,
    durabilityMillionths: slot.durabilityMillionths,
    metadataHash: slot.metadata?.hash ?? "00000000000000000000000000000000",
  })));
  const metadata: readonly RustIntegratedPlayerInventoryMetadataV1[] = Object.freeze(slots
    .flatMap((slot) => slot?.metadata ? [slot.metadata] : [])
    .filter((record, index, records) => records.findIndex((candidate) => candidate.hash === record.hash) === index)
    .sort((left, right) => left.hash.localeCompare(right.hash)));
  const resultHash = rustIntegratedPlayerInventoryResultHashV1({
    inventoryContainer,
    revision: BigInt(1),
    slots: normalizedSlots,
    metadata,
  });
  const intent = Object.freeze({
    selectedSlot: value.selectedSlot,
    slots,
    expectedPristineRevision: BigInt(0),
    bootstrapImportHash: resultHash,
    expectedRestoredRevision: BigInt(1),
    restoredInventoryHash: resultHash,
  });
  // Reuse the production normalizer as the final shape/hash attestation.
  normalizeRustIntegratedPlayerInventoryIntentV1(inventoryContainer, intent);
  return intent;
}

function bindingFor(profile: CharacterProfile, mode: GameMode, explorationLevel: number) {
  const traits = characterRaceTraits(profile.appearance.race);
  if (traits.landSpeedMultiplier !== 1 || traits.waterSpeedMultiplier !== 1 || traits.waterBreathing) {
    fail("compatibility-race-movement", `race '${traits.id}' has movement or breathing parameters absent from the R5 binding`);
  }
  if (!Number.isInteger(explorationLevel) || explorationLevel < 0 || explorationLevel > MAX_SKILL_LEVEL) {
    fail("compatibility-exploration-level", "exploration level is unknown or outside the reviewed skill range");
  }
  const heightScale = playerModelHeightScale(profile.appearance.sex, profile.appearance.race);
  const movementScale = skillMultiplier(explorationLevel);
  return Object.freeze({
    actorId: characterNetworkId(profile),
    creativeMode: mode === "builder",
    radius: RUST_PLAYER_COMPATIBILITY_BINDING_BASE_V1.radius,
    standingHeight: RUST_PLAYER_COMPATIBILITY_BINDING_BASE_V1.standingHeight * heightScale,
    crouchingHeight: RUST_PLAYER_COMPATIBILITY_BINDING_BASE_V1.crouchingHeight * heightScale,
    mass: RUST_PLAYER_COMPATIBILITY_BINDING_BASE_V1.mass,
    walkSpeed: RUST_PLAYER_COMPATIBILITY_BINDING_BASE_V1.walkSpeed * movementScale,
    sprintSpeed: RUST_PLAYER_COMPATIBILITY_BINDING_BASE_V1.sprintSpeed * movementScale,
    creativeFlightSpeed: RUST_PLAYER_COMPATIBILITY_BINDING_BASE_V1.creativeFlightSpeed * movementScale,
    maximumOxygenSeconds: RUST_PLAYER_COMPATIBILITY_BINDING_BASE_V1.maximumOxygenSeconds,
  });
}

/** Identity derivation needed before any compatibility inventory is inspected. */
export function deriveRustPlayerBootstrapCompatibilityIdentityV1(
  profile: CharacterProfile,
  source: RustPlayerBootstrapCompatibilityIdentitySourceV1,
): RustPlayerBootstrapCompatibilityIdentityV1 {
  const actorId = characterNetworkId(profile);
  visibleId(actorId, "player actor", 150);
  visibleId(source.commandActorId, "bootstrap command actor", 160);
  const externalEntityId = `player:${actorId}`;
  return Object.freeze({
    actorId,
    externalEntityId,
    playerId: deriveRustIntegratedPlayerIdV1(source.universeKey, actorId),
    locationId: deriveRustIntegratedLocationIdV1(source.universeKey, source.locationKey),
    commandActorId: source.commandActorId,
  });
}

type ExactEntityContinuityV1 = Readonly<{
  velocity: RustPlayerCompatibilityVec3V1;
  health: Readonly<{ current: number; maximum: number }>;
  ageTicks: bigint;
  grounded: boolean;
}>;

function buildPlan(
  profile: CharacterProfile,
  source: RustPlayerCompatibilityWorldBaseV1,
  continuity: ExactEntityContinuityV1,
  explorationLevel: number,
  exactF32: boolean,
): RustPlayerBootstrapCompatibilityPlanV1 {
  if (source.mode !== "builder" && source.mode !== "survival") {
    fail("compatibility-mode", "compatibility player mode is neither survival nor builder");
  }
  const identity = deriveRustPlayerBootstrapCompatibilityIdentityV1(profile, source);
  const { actorId, externalEntityId, playerId, locationId } = identity;
  const position = f32Vec(source.position, "player position", exactF32);
  const velocity = f32Vec(continuity.velocity, "player velocity", exactF32);
  const health = f32(continuity.health.current, "player health", exactF32);
  const maximumHealth = f32(continuity.health.maximum, "player maximum health", exactF32);
  if (health < 0 || maximumHealth <= 0 || health > maximumHealth) {
    fail("compatibility-health", "native player health is outside its exact maximum");
  }
  if (typeof continuity.ageTicks !== "bigint" || continuity.ageTicks < BigInt(0) || continuity.ageTicks > U64_MAX) {
    fail("compatibility-age", "native player age is outside its exact u64 range");
  }
  const yaw = f32(source.yaw, "player yaw", exactF32);
  const binding = bindingFor(profile, source.mode, explorationLevel);
  const inventory = inventoryIntent(actorId, source.inventory);
  const entity = Object.freeze({
    schema: 1 as const,
    externalEntityId,
    legacyNumericId: null,
    specimenId: externalEntityId,
    kindKey: "player",
    variantKey: null,
    name: profile.name,
    position,
    yaw,
    velocity,
    health,
    maximumHealth,
    ageTicks: continuity.ageTicks,
    naturalSpawned: false,
    everLed: false,
    ownerId: null,
    tamed: false,
    bondPoints: 0,
    bondTier: "unbound",
    socialGroupId: null,
    factionId: null,
    settlementId: null,
    equipment: Object.freeze([]),
    research: Object.freeze([]),
    custom: Object.freeze([
      Object.freeze(["modelKey", PLAYER_RENDER_MODEL_ID_V1] as const),
      Object.freeze(["physics.grounded", continuity.grounded ? "true" : "false"] as const),
    ]),
  });
  try {
    encodeRustIntegratedPlayerBindingV1({ ...binding, externalEntityId, playerId });
    encodeRustIntegratedEntityCompatibilityImportV1({
      sequence: BigInt(0),
      expectedRevision: BigInt(0),
      tick: BigInt(0),
      desiredEntityId: null,
      residency: "hot",
      record: Object.freeze({ ...entity, class: "player" as const, locationId }),
    });
  } catch (error) {
    return fail("compatibility-native-shape", "compatibility player could not be represented by the native bootstrap codecs", error);
  }
  const intent: RustIntegratedPlayerBootstrapIntentV1 = Object.freeze({
    universeKey: source.universeKey,
    playerKey: actorId,
    locationKey: source.locationKey,
    commandActorId: source.commandActorId,
    desiredEntityId: null,
    residency: "hot",
    entity,
    binding,
    inventory,
  });
  return Object.freeze({
    identity,
    intent,
  });
}

/**
 * Creates the canonical first player for a new world. There is no legacy
 * continuity to convert: R6-native health, age, velocity, and grounded state
 * are initialized from the reviewed new-world defaults above.
 */
export function createRustPlayerBootstrapNewWorldCompatibilityV1(
  profile: CharacterProfile,
  source: RustPlayerNewWorldCompatibilityV1,
) {
  if (source.kind !== "new-world" || source.schema !== 1) fail("new-world-shape", "new-world compatibility source is not schema one");
  validateInventoryEnvelope(source.inventory);
  validateNewWorldInventory(source.mode, source.inventory);
  return buildPlan(
    profile,
    source,
    RUST_NEW_WORLD_PLAYER_ENTITY_DEFAULTS_V1,
    profile.startingSkills.exploration,
    false,
  );
}

/**
 * Converts only a rich save that already retained every native continuity
 * field. Current legacy WorldSave documents intentionally fail this adapter.
 */
export function migrateRustPlayerBootstrapRichSaveCompatibilityV1(
  profile: CharacterProfile,
  source: RustPlayerRichSaveCompatibilityV1,
) {
  if (source.kind !== "rich-save" || source.schema !== 1) fail("rich-save-shape", "rich-save compatibility source is not schema one");
  const actorId = characterNetworkId(profile);
  if (source.ownerActorId === null) fail("compatibility-owner-unknown", "rich save does not attest the stable character actor that owns it");
  if (source.ownerActorId !== actorId) fail("compatibility-owner-mismatch", "rich save belongs to a different stable character actor");
  if (source.explorationLevel === null) fail("compatibility-exploration-unknown", "rich save does not attest its current exploration level");
  if (source.hasTimedMovementModifiers === null) fail("compatibility-movement-unknown", "rich save does not attest temporary movement modifiers");
  if (source.hasTimedMovementModifiers) fail("compatibility-movement-transient", "temporary movement modifiers cannot be frozen into the R5 binding");
  if (source.continuity.velocity === null) fail("compatibility-velocity-unknown", "rich save did not persist native player velocity");
  if (source.continuity.health === null) fail("compatibility-health-unknown", "rich save did not persist health in native R6 units");
  if (source.continuity.ageTicks === null) fail("compatibility-age-unknown", "rich save did not persist native player age ticks");
  if (source.continuity.grounded === null) fail("compatibility-grounded-unknown", "rich save did not persist authoritative grounded state");
  return buildPlan(profile, source, {
    velocity: source.continuity.velocity,
    health: source.continuity.health,
    ageTicks: source.continuity.ageTicks,
    grounded: source.continuity.grounded,
  }, source.explorationLevel, true);
}

export type RustPlayerBootstrapIdentityStatusQueryV1 = Readonly<{
  commandActorId: string;
  externalEntityId: string;
  actorId: string;
  playerId: bigint;
}>;

function observationFromStatus(
  identity: RustIntegratedRuntimeIdentityV1,
  status: ReturnType<typeof decodeRustIntegratedPlayerBootstrapStatusReceiptV1>,
): RustIntegratedPlayerBootstrapObservationV1 {
  return Object.freeze({
    identity,
    worldAuthorityRevision: status.worldAuthorityRevision,
    entityAuthority: status.entityAuthority,
    continuity: status.continuity,
    entity: status.entity,
    runtimePlayer: status.runtimePlayer,
    worldViewBinding: status.worldViewBinding,
    custody: status.custody,
  });
}

/**
 * Two-phase, identity-only BWS5 read. Unlike the convenience bootstrap query,
 * this does not require guessing a restored custody revision/hash before BWO5
 * has returned them. `commandActorId` remains explicit and grants no gameplay
 * authority; the sole operation is the identity-neutral status read.
 */
export async function queryRustPlayerBootstrapIdentityStatusV1(
  service: RustIntegratedPlayerBootstrapServiceV1,
  query: RustPlayerBootstrapIdentityStatusQueryV1,
) {
  visibleId(query.commandActorId, "status command actor", 160);
  visibleId(query.actorId, "status player actor", 150);
  visibleId(query.externalEntityId, "status external entity", 512);
  const expected = service.identity();
  const payload = encodeRustIntegratedPlayerBootstrapStatusQueryV1({
    externalEntityId: query.externalEntityId,
    actorId: query.actorId,
    playerId: query.playerId,
  });
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
    schema: 1,
    payload,
  });
  const keySource = [
    expected.universeId,
    expected.locationId,
    expected.stateHash,
    String(expected.tick),
    query.commandActorId,
    operation.payloadHash,
  ].join("\u0000");
  const key = `player-bootstrap-status:${rustIntegratedRuntimeWireChecksumV1(textEncoder.encode(keySource))}`;
  const batch = createRustIntegratedRuntimeCommandBatchV1({
    commandId: key,
    idempotencyKey: key,
    actorId: query.commandActorId,
    expected,
    operations: Object.freeze([operation]),
  });
  const receipt = await service.command(batch);
  if (receipt.commandId !== batch.commandId || receipt.idempotencyKey !== batch.idempotencyKey
    || receipt.commandHash !== batch.commandHash) {
    fail("identity-status-receipt", "BWS5 receipt does not identify the exact status command");
  }
  if (receipt.status === "rejected") {
    if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.current, expected)) {
      fail("identity-status-mutated", "rejected BWS5 status read moved runtime identity");
    }
    return fail("identity-status-rejected", `${receipt.code}: ${receipt.message}`);
  }
  const response = receipt.domainReceipts[0];
  if (receipt.domainReceipts.length !== 1
    || !rustIntegratedRuntimeIdentityEqualsV1(receipt.before, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(receipt.after, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)
    || !response
    || response.domain !== "simulation"
    || response.typeId !== RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1
    || response.schema !== 1
    || response.payloadHash !== rustIntegratedRuntimeWireChecksumV1(response.payload)) {
    fail("identity-status-mutated", "BWS5 status read mutated identity or returned an invalid BWO5 receipt");
  }
  return observationFromStatus(
    expected,
    decodeRustIntegratedPlayerBootstrapStatusReceiptV1(response.payload, operation.payloadHash),
  );
}
