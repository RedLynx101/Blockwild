import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec";
import {
  RUST_RUNTIME_INPUT_BUTTON_MASK_V1,
  RUST_RUNTIME_INPUT_FLAG_MASK_V1,
  rustIntegratedRuntimeIdentityEqualsV1,
  type RustIntegratedRuntimeCommandBatchV1,
  type RustIntegratedRuntimeCommandReceiptV1,
  type RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract";
import {
  encodeRustIntegratedEntityCompatibilityImportV1,
  RUST_INTEGRATED_ENTITY_COMPATIBILITY_IMPORT_TYPE_V1,
  type RustIntegratedEntityCompatibilityImportV1,
  validateRustIntegratedEntityCompatibilityImportReceiptV1,
} from "./rust-integrated-runtime-entities";
import {
  decodeRustIntegratedPlayerInventoryImportReceiptV1,
  encodeRustIntegratedPlayerInventoryImportV1,
  normalizeRustIntegratedPlayerInventoryIntentV1,
  rustIntegratedPlayerInventoryResultHashV1,
  validateRustIntegratedPlayerInventoryImportReceiptV1,
  RUST_INTEGRATED_PLAYER_EQUIPMENT_SLOT_COUNT_V1,
  RUST_INTEGRATED_PLAYER_INVENTORY_IMPORT_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_INVENTORY_IMPORT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1,
  type RustIntegratedContainerKeyV1,
  type RustIntegratedPlayerInventoryImportV1,
  type RustIntegratedPlayerInventoryIntentV1,
} from "./rust-integrated-runtime-player-inventory";
import {
  deriveRustIntegratedLocationIdV1,
  deriveRustIntegratedPlayerIdV1,
} from "./rust-integrated-runtime-identity";
import {
  encodeRustIntegratedPlayerBindingV1,
  type RustIntegratedPlayerBindingV1,
} from "./rust-integrated-runtime-player";
import {
  decodeRustIntegratedPlayerBootstrapStatusReceiptV1,
  encodeRustIntegratedPlayerBootstrapStatusQueryV1,
  RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
  type RustIntegratedPlayerBootstrapStatusReceiptV1,
  type RustIntegratedPlayerCustodyAttestationV1,
  type RustIntegratedPlayerInventoryBindingAttestationV1,
  type RustIntegratedPlayerRuntimeContinuityV1,
} from "./rust-integrated-runtime-player-status";
import {
  decodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1,
  encodeRustIntegratedPlayerCombatBootstrapStatusQueryV1,
  RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1,
  type RustIntegratedPlayerCombatBootstrapStatusReceiptV1,
} from "./rust-integrated-runtime-player-combat-status";
import type {
  RustEntityCompatibilityRecordR6,
  RustEntityResidencyR6,
} from "./rust-entity-authority-contract-r6";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated";
import { decodeRustIntegratedPlayerFinalBindReceiptV1 } from "./rust-integrated-runtime-player-final-bind";

export type {
  RustIntegratedContainerKeyV1,
  RustIntegratedPlayerInventoryIntentV1,
} from "./rust-integrated-runtime-player-inventory";
export type {
  RustIntegratedPlayerCustodyAttestationV1,
  RustIntegratedPlayerInventoryBindingAttestationV1,
  RustIntegratedPlayerRuntimeContinuityV1,
} from "./rust-integrated-runtime-player-status";

const FINAL_BIND_SCHEMA_V3 = rustIntegratedRuntimeDomainWireFamilyV1("simulation-player-bind-v3");
const FINAL_BIND_RECEIPT_SCHEMA_V3 = rustIntegratedRuntimeDomainWireFamilyV1(
  "simulation-player-bind-final-receipt-v3",
);
const COMBAT_BIND_SCHEMA_V4 = rustIntegratedRuntimeDomainWireFamilyV1("simulation-player-bind-v4");
const COMBAT_BIND_RECEIPT_SCHEMA_V4 = rustIntegratedRuntimeDomainWireFamilyV1(
  "simulation-player-bind-final-receipt-v4",
);
const BOOTSTRAP_STATUS_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("player-bootstrap-status-v1");
const BOOTSTRAP_STATUS_RECEIPT_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1(
  "player-bootstrap-status-receipt-v1",
);
const COMBAT_STATUS_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("player-combat-bootstrap-status-v1");
const COMBAT_STATUS_RECEIPT_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1(
  "player-combat-bootstrap-status-receipt-v1",
);
const ENTITY_COMPATIBILITY_IMPORT_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1(
  "entity-compatibility-import-v1",
);

export const RUST_INTEGRATED_PLAYER_FINAL_BIND_TYPE_V3 = FINAL_BIND_SCHEMA_V3.typeId;
export const RUST_INTEGRATED_PLAYER_FINAL_BIND_RECEIPT_TYPE_V3 = FINAL_BIND_RECEIPT_SCHEMA_V3.typeId;
export const RUST_INTEGRATED_PLAYER_COMBAT_BIND_TYPE_V4 = COMBAT_BIND_SCHEMA_V4.typeId;
export const RUST_INTEGRATED_PLAYER_COMBAT_BIND_RECEIPT_TYPE_V4 = COMBAT_BIND_RECEIPT_SCHEMA_V4.typeId;

const PLAYER_BACK_SLOT_V1 = 7;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const textEncoder = new TextEncoder();

export type RustIntegratedPlayerBootstrapObservationV1 = Readonly<{
  /** Exact identity that the extraction/status record was produced from. */
  identity: RustIntegratedRuntimeIdentityV1;
  worldAuthorityRevision: RustIntegratedPlayerBootstrapStatusReceiptV1["worldAuthorityRevision"];
  /** Exact R6 authority cursor; nextSequence must be supplied by Rust when a spawn is needed. */
  entityAuthority: Readonly<{
    revision: bigint;
    nextSequence: bigint | null;
    tick: bigint;
  }>;
  continuity: RustIntegratedPlayerRuntimeContinuityV1;
  entity: Readonly<{
    entityId: bigint;
    entityRevision: bigint;
    residency: RustEntityResidencyR6;
    record: RustEntityCompatibilityRecordR6;
  }> | null;
  runtimePlayer: Readonly<{
    entityId: bigint;
    binding: RustIntegratedPlayerBindingV1;
  }> | null;
  worldViewBinding: RustIntegratedPlayerInventoryBindingAttestationV1 | null;
  custody: RustIntegratedPlayerCustodyAttestationV1;
  combat: RustIntegratedPlayerCombatBootstrapStatusReceiptV1;
}>;

export type RustIntegratedPlayerBootstrapIntentV1 = Readonly<{
  universeKey: string;
  playerKey: string;
  locationKey: string;
  commandActorId: string;
  desiredEntityId: bigint | null;
  residency: RustEntityResidencyR6;
  entity: Omit<RustEntityCompatibilityRecordR6, "class" | "locationId">;
  binding: Omit<RustIntegratedPlayerBindingV1, "externalEntityId" | "playerId">;
  inventory: RustIntegratedPlayerInventoryIntentV1;
}>;

export type RustIntegratedPlayerBootstrapPlanV1 =
  | Readonly<{
    status: "already-matching";
    entityId: bigint;
    expected: RustIntegratedRuntimeIdentityV1;
    batch: null;
    entityImport: null;
    inventoryImport: null;
    combatBind: null;
  }>
  | Readonly<{
    status: "import-pristine" | "bind-and-import";
    entityId: bigint;
    expected: RustIntegratedRuntimeIdentityV1;
    batch: RustIntegratedRuntimeCommandBatchV1;
    entityImport: null;
    inventoryImport: RustIntegratedPlayerInventoryImportV1;
    combatBind: RustIntegratedRuntimeCommandBatchV1["operations"][number] | null;
  }>
  | Readonly<{
    status: "spawn-bind-and-import";
    entityId: bigint | null;
    expected: RustIntegratedRuntimeIdentityV1;
    batch: RustIntegratedRuntimeCommandBatchV1;
    entityImport: RustIntegratedEntityCompatibilityImportV1;
    inventoryImport: RustIntegratedPlayerInventoryImportV1;
    combatBind: RustIntegratedRuntimeCommandBatchV1["operations"][number];
  }>
  | Readonly<{
    status: "install-combat";
    entityId: bigint;
    expected: RustIntegratedRuntimeIdentityV1;
    batch: RustIntegratedRuntimeCommandBatchV1;
    entityImport: null;
    inventoryImport: null;
    combatBind: RustIntegratedRuntimeCommandBatchV1["operations"][number];
  }>;

export type RustIntegratedPlayerBootstrapResultV1 = Readonly<{
  status: "already-matching" | "combat-installed" | "inventory-imported" | "bound-and-imported" | "spawned-bound-and-imported";
  entityId: bigint;
  identity: RustIntegratedRuntimeIdentityV1;
  receipt: RustIntegratedRuntimeCommandReceiptV1 | null;
}>;

export interface RustIntegratedPlayerBootstrapServiceV1 {
  identity(): RustIntegratedRuntimeIdentityV1;
  command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1>;
}

export class RustIntegratedPlayerBootstrapErrorV1 extends Error {
  readonly name = "RustIntegratedPlayerBootstrapErrorV1";

  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedPlayerBootstrapErrorV1(code, message);
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function visibleId(value: string, label: string, maximumBytes = 160) {
  if (typeof value !== "string"
    || value.length === 0
    || textEncoder.encode(value).byteLength > maximumBytes
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || /[\ud800-\udfff]/u.test(value)) {
    fail("bootstrap-identity", `${label} is not a bounded, visible UTF-8 identity`);
  }
  return value;
}

function u64(value: bigint, label: string, allowZero = true) {
  if (typeof value !== "bigint" || value < BigInt(allowZero ? 0 : 1) || value > U64_MAX) {
    fail("bootstrap-u64", `${label} is outside its authoritative u64 range`);
  }
  return value;
}

function sameContainer(left: RustIntegratedContainerKeyV1, right: RustIntegratedContainerKeyV1) {
  return left.kind === right.kind && left.id === right.id && left.ownerId === right.ownerId;
}

function expectedContainers(actorId: string) {
  return Object.freeze({
    inventory: Object.freeze({ kind: "player" as const, id: actorId, ownerId: actorId }),
    equipment: Object.freeze({ kind: "equipment" as const, id: `${actorId}:equipment`, ownerId: actorId }),
  });
}

function samePlayerEntityIdentity(left: RustEntityCompatibilityRecordR6, right: RustEntityCompatibilityRecordR6) {
  // Position, vitals, age and other simulation fields legitimately evolve after
  // restore. These authored identity fields must not. Runtime BWB6 additionally
  // resolves the exact external id and requires the authoritative player class.
  return left.schema === right.schema
    && left.externalEntityId === right.externalEntityId
    && left.legacyNumericId === right.legacyNumericId
    && left.specimenId === right.specimenId
    && left.kindKey === right.kindKey
    && left.class === "player"
    && left.locationId === right.locationId;
}

function normalizedIntent(intent: RustIntegratedPlayerBootstrapIntentV1) {
  visibleId(intent.commandActorId, "bootstrap command actor");
  // Gameplay container ids are capped at 160 bytes and equipment appends ten.
  visibleId(intent.binding.actorId, "player actor", 150);
  if (intent.residency !== "hot") fail("bootstrap-residency", "the authoritative player entity must be resident and hot");
  if (intent.desiredEntityId !== null) u64(intent.desiredEntityId, "desired player entity id", false);
  const playerId = deriveRustIntegratedPlayerIdV1(intent.universeKey, intent.playerKey);
  const locationId = deriveRustIntegratedLocationIdV1(intent.universeKey, intent.locationKey);
  const record = Object.freeze({ ...intent.entity, class: "player" as const, locationId });
  const binding = Object.freeze({
    ...intent.binding,
    externalEntityId: record.externalEntityId,
    playerId,
  });
  // Existing native encoders are also the canonical shape validators.
  encodeRustIntegratedPlayerBindingV1(binding);
  encodeRustIntegratedEntityCompatibilityImportV1({
    sequence: BigInt(0), expectedRevision: BigInt(0), tick: BigInt(0), desiredEntityId: intent.desiredEntityId,
    residency: intent.residency, record,
  });
  const inventory = normalizeRustIntegratedPlayerInventoryIntentV1(
    expectedContainers(binding.actorId).inventory,
    intent.inventory,
  );
  return Object.freeze({ playerId, locationId, record, binding, inventory });
}

function requireCustody(
  value: RustIntegratedPlayerCustodyAttestationV1,
  actorId: string,
) {
  if (value.status !== "present") fail("bootstrap-partial", "authoritative player binding is missing its gameplay custody");
  const expected = expectedContainers(actorId);
  if (!sameContainer(value.inventoryContainer, expected.inventory)
    || !sameContainer(value.equipmentContainer, expected.equipment)
  ) {
    fail("bootstrap-mismatch", "player custody does not match the native BWB6/BWF6 inventory layout");
  }
  if (value.inventorySlots.length !== RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1
    || value.equipmentSlots.length !== RUST_INTEGRATED_PLAYER_EQUIPMENT_SLOT_COUNT_V1) {
    fail("bootstrap-mismatch", "player custody slot geometry is not the canonical nine-plus-eight layout");
  }
  u64(value.inventoryRevision, "player inventory container revision");
  u64(value.equipmentRevision, "player equipment container revision");
  return value;
}

function validateMatchingBindings(
  observation: RustIntegratedPlayerBootstrapObservationV1,
  recordEntityId: bigint,
  binding: RustIntegratedPlayerBindingV1,
) {
  const runtime = observation.runtimePlayer;
  const worldView = observation.worldViewBinding;
  if (!runtime || !worldView) fail("bootstrap-partial", "player binding attestations are only partially present");
  if (runtime.entityId !== recordEntityId
    || !bytesEqual(encodeRustIntegratedPlayerBindingV1(runtime.binding), encodeRustIntegratedPlayerBindingV1(binding))) {
    fail("bootstrap-mismatch", "restored runtime player binding contradicts the requested player");
  }
  const expected = expectedContainers(binding.actorId);
  if (worldView.playerId !== binding.playerId
    || worldView.actorId !== binding.actorId
    || worldView.entityId !== recordEntityId
    || !sameContainer(worldView.inventoryContainer, expected.inventory)
    || !sameContainer(worldView.equipmentContainer, expected.equipment)
    || !Number.isInteger(worldView.selectedSlot)
    || worldView.selectedSlot < 0
    || worldView.selectedSlot >= RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1
    || worldView.backSlot !== PLAYER_BACK_SLOT_V1) {
    fail("bootstrap-mismatch", "restored world-view inventory binding contradicts the requested player");
  }
  u64(worldView.revision, "world-view player binding revision");
  return Object.freeze({ worldView, custody: requireCustody(observation.custody, binding.actorId) });
}

function bindingOperation(binding: RustIntegratedPlayerBindingV1) {
  return createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: RUST_INTEGRATED_PLAYER_COMBAT_BIND_TYPE_V4,
    schema: COMBAT_BIND_SCHEMA_V4.operationSchema,
    payload: encodeRustIntegratedPlayerBindingV1(binding),
  });
}

function inventoryOperation(inventory: RustIntegratedPlayerInventoryImportV1) {
  return createRustIntegratedRuntimeDomainOperationV1({
    domain: "gameplay",
    typeId: RUST_INTEGRATED_PLAYER_INVENTORY_IMPORT_TYPE_V1,
    schema: 1,
    payload: encodeRustIntegratedPlayerInventoryImportV1(inventory),
  });
}

function batchFor(
  expected: RustIntegratedRuntimeIdentityV1,
  commandActorId: string,
  operations: RustIntegratedRuntimeCommandBatchV1["operations"],
) {
  const operationFingerprint = operations.map((operation) => operation.payloadHash).join("");
  const commandIdentity = [
    expected.universeId,
    expected.locationId,
    expected.stateHash,
    String(expected.tick),
    operationFingerprint,
  ].join("\u0000");
  const key = `player-bootstrap:${rustIntegratedRuntimeWireChecksumV1(textEncoder.encode(commandIdentity))}`;
  return createRustIntegratedRuntimeCommandBatchV1({
    commandId: key,
    idempotencyKey: key,
    actorId: commandActorId,
    expected,
    operations,
  });
}

function canonicalMillihearts(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || Object.is(value, -0) || value !== Math.fround(value)) {
    fail("bootstrap-combat-vitals", `${label} is not a finite nonnegative native f32`);
  }
  const rounded = Math.round(value * 1_000);
  if (!Number.isSafeInteger(rounded) || rounded < 0 || rounded > 0xffff_ffff) {
    fail("bootstrap-combat-vitals", `${label} exceeds the milliheart range`);
  }
  const roundtrip = Math.fround(Math.fround(rounded) / Math.fround(1_000));
  if (!Object.is(roundtrip, value)) {
    fail("bootstrap-combat-vitals", `${label} is not canonically representable in millihearts`);
  }
  return rounded;
}

export function validateRustIntegratedPlayerCombatBootstrapV1(
  observation: RustIntegratedPlayerBootstrapObservationV1,
  actorId: string,
) {
  const status = observation.combat;
  u64(status.entityAuthorityRevision, "combat status entity authority revision");
  u64(status.gameplaySequence, "combat status gameplay sequence");
  u64(status.gameplayCombatRevision, "combat status gameplay revision");
  if (!/^[0-9a-f]{32}$/u.test(status.gameplayStateHash)
    || status.entityAuthorityRevision !== observation.entityAuthority.revision
    || status.entityAuthorityRevision !== BigInt(observation.identity.revision.entities)) {
    fail("bootstrap-combat-status", "BWO7 authority cursors contradict BWO5");
  }
  if (status.status === "absent") return false;
  if (status.status === "legacy-unlinked" || status.status === "blocked") {
    fail(
      "bootstrap-combat-blocked",
      `native player combat bootstrap is blocked: ${status.blocker ?? "missing-blocker"}`,
    );
  }
  const entity = observation.entity;
  const combatant = status.combatant;
  if (status.status !== "exact-linked"
    || status.blocker !== null
    || entity === null
    || combatant === null
    || !combatant.crossDomainParity
    || combatant.recordId !== actorId
    || combatant.ownerId !== actorId
    || combatant.entityId !== entity.entityId
    || combatant.vitalUnits !== "millihearts-v1") {
    fail("bootstrap-combat-status", "BWO7 does not attest the exact linked player combat record");
  }
  const health = canonicalMillihearts(entity.record.health, "R6 player health");
  const maxHealth = canonicalMillihearts(entity.record.maximumHealth, "R6 player maximum health");
  if (maxHealth === 0
    || health > maxHealth
    || combatant.health !== health
    || combatant.maxHealth !== maxHealth
    || combatant.alive !== (health > 0)) {
    fail("bootstrap-combat-status", "BWO7 combat vitals do not match the exact R6 player record");
  }
  return true;
}

/**
 * Produces an atomic BWRQ bootstrap only from a complete authoritative status.
 * It never guesses an R6 command sequence and never emits a blind restored-state rebind.
 */
export function planRustIntegratedPlayerBootstrapV1(
  observation: RustIntegratedPlayerBootstrapObservationV1,
  intent: RustIntegratedPlayerBootstrapIntentV1,
): RustIntegratedPlayerBootstrapPlanV1 {
  const desired = normalizedIntent(intent);
  u64(observation.entityAuthority.revision, "entity authority revision");
  u64(observation.entityAuthority.tick, "entity authority tick");
  if (observation.entityAuthority.revision !== BigInt(observation.identity.revision.entities)
    || observation.entityAuthority.tick !== BigInt(observation.identity.tick)) {
    fail("bootstrap-status", "entity authority cursor contradicts the integrated runtime identity");
  }
  if (observation.entityAuthority.nextSequence !== null) {
    u64(observation.entityAuthority.nextSequence, "next entity command sequence");
  }
  if (!observation.continuity.queuedInputsEmpty) {
    fail("bootstrap-queued", "player bootstrap requires an empty native input queue");
  }
  if ((observation.continuity.lastAppliedInput?.sequence ?? null) !== observation.continuity.lastInputSequence) {
    if (observation.continuity.queuedInputsEmpty) {
      fail("bootstrap-status", "last applied input contradicts the authoritative continuation cursor");
    }
  }
  const lastInput = observation.continuity.lastAppliedInput;
  if (lastInput && (
    (lastInput.buttons & ~RUST_RUNTIME_INPUT_BUTTON_MASK_V1) !== 0
    || (lastInput.flags & ~RUST_RUNTIME_INPUT_FLAG_MASK_V1) !== 0
    || lastInput.selectedSlot < 0
    || lastInput.selectedSlot >= RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1
  )) {
    fail("bootstrap-status", "last applied input contains unregistered controls or flags");
  }
  const hasRuntimeBinding = observation.runtimePlayer !== null;
  const hasWorldViewBinding = observation.worldViewBinding !== null;
  if (hasRuntimeBinding !== hasWorldViewBinding) {
    fail("bootstrap-partial", "runtime and world-view player binding attestations disagree");
  }
  const hasCombat = validateRustIntegratedPlayerCombatBootstrapV1(observation, desired.binding.actorId);

  if (observation.entity === null) {
    if (hasRuntimeBinding || observation.custody.status !== "absent" || hasCombat) {
      fail("bootstrap-partial", "player binding, custody, or combat exists without its authoritative entity");
    }
    const sequence = observation.entityAuthority.nextSequence;
    if (sequence === null) fail("bootstrap-sequence", "spawn requires an explicit next R6 entity command sequence");
    const entityImport = Object.freeze({
      sequence,
      expectedRevision: observation.entityAuthority.revision,
      tick: observation.entityAuthority.tick,
      desiredEntityId: intent.desiredEntityId,
      residency: intent.residency,
      record: desired.record,
    });
    const operations = Object.freeze([
      createRustIntegratedRuntimeDomainOperationV1({
        domain: "entities",
        typeId: RUST_INTEGRATED_ENTITY_COMPATIBILITY_IMPORT_TYPE_V1,
        schema: ENTITY_COMPATIBILITY_IMPORT_SCHEMA_V1.operationSchema,
        payload: encodeRustIntegratedEntityCompatibilityImportV1(entityImport),
      }),
      bindingOperation(desired.binding),
      inventoryOperation(desired.inventory),
    ]);
    return Object.freeze({
      status: "spawn-bind-and-import",
      entityId: intent.desiredEntityId,
      expected: observation.identity,
      batch: batchFor(observation.identity, intent.commandActorId, operations),
      entityImport,
      inventoryImport: desired.inventory,
      combatBind: operations[1],
    });
  }

  const entity = observation.entity;
  u64(entity.entityId, "attested player entity id", false);
  u64(entity.entityRevision, "attested player entity revision");
  if (entity.residency !== "hot"
    || (intent.desiredEntityId !== null && entity.entityId !== intent.desiredEntityId)
    || !samePlayerEntityIdentity(entity.record, desired.record)) {
    fail("bootstrap-mismatch", "authoritative entity contradicts the requested player record");
  }

  if (!hasRuntimeBinding) {
    if (observation.custody.status !== "absent" || hasCombat) {
      fail("bootstrap-partial", "player custody or combat exists without a complete authoritative binding");
    }
    const operations = Object.freeze([bindingOperation(desired.binding), inventoryOperation(desired.inventory)]);
    return Object.freeze({
      status: "bind-and-import",
      entityId: entity.entityId,
      expected: observation.identity,
      batch: batchFor(observation.identity, intent.commandActorId, operations),
      entityImport: null,
      inventoryImport: desired.inventory,
      combatBind: operations[0],
    });
  }

  const { worldView, custody } = validateMatchingBindings(observation, entity.entityId, desired.binding);
  if (custody.inventoryRevision === intent.inventory.expectedPristineRevision) {
    if (custody.inventorySlots.some((slot) => slot !== null) || custody.metadata.length !== 0) {
      fail("bootstrap-mismatch", "revision-zero player custody is not pristine");
    }
    const combatBind = hasCombat ? null : bindingOperation(desired.binding);
    const operation = inventoryOperation(desired.inventory);
    const operations = Object.freeze(combatBind === null ? [operation] : [combatBind, operation]);
    return Object.freeze({
      status: "import-pristine",
      entityId: entity.entityId,
      expected: observation.identity,
      batch: batchFor(observation.identity, intent.commandActorId, operations),
      entityImport: null,
      inventoryImport: desired.inventory,
      combatBind,
    });
  }
  const restoredHash = rustIntegratedPlayerInventoryResultHashV1({
    inventoryContainer: custody.inventoryContainer,
    revision: custody.inventoryRevision,
    slots: custody.inventorySlots,
    metadata: custody.metadata,
  });
  if (custody.inventoryRevision !== intent.inventory.expectedRestoredRevision
    || worldView.selectedSlot !== intent.inventory.selectedSlot
    || restoredHash !== intent.inventory.restoredInventoryHash) {
    fail("bootstrap-mismatch", "restored player inventory or selected slot contradicts the durable import attestation");
  }
  if (!hasCombat) {
    const combatBind = bindingOperation(desired.binding);
    return Object.freeze({
      status: "install-combat",
      entityId: entity.entityId,
      expected: observation.identity,
      batch: batchFor(observation.identity, intent.commandActorId, Object.freeze([combatBind])),
      entityImport: null,
      inventoryImport: null,
      combatBind,
    });
  }
  return Object.freeze({
    status: "already-matching",
    entityId: entity.entityId,
    expected: observation.identity,
    batch: null,
    entityImport: null,
    inventoryImport: null,
    combatBind: null,
  });
}

function validateBindReceipt(
  receipt: Extract<RustIntegratedRuntimeCommandReceiptV1, { status: "accepted" }>,
  operationIndex: number,
  request: RustIntegratedRuntimeCommandBatchV1["operations"][number],
) {
  const operation = receipt.domainReceipts[operationIndex];
  if (!operation
    || operation.domain !== "simulation"
    || operation.typeId !== RUST_INTEGRATED_PLAYER_COMBAT_BIND_RECEIPT_TYPE_V4
    || operation.schema !== COMBAT_BIND_RECEIPT_SCHEMA_V4.operationSchema
    || operation.payloadHash !== rustIntegratedRuntimeWireChecksumV1(operation.payload)) {
    fail("bootstrap-receipt", "BWF7 returned the wrong ordered native receipt");
  }
  try {
    decodeRustIntegratedPlayerFinalBindReceiptV1(4, operation.payload, {
      requestPayloadHash: request.payloadHash,
      terminalStateHash: receipt.after.stateHash,
    });
  } catch {
    fail("bootstrap-receipt", "BWF7 acknowledgement does not attest the request and terminal runtime state");
  }
}

function validateInventoryReceipt(
  receipt: Extract<RustIntegratedRuntimeCommandReceiptV1, { status: "accepted" }>,
  operationIndex: number,
  request: RustIntegratedRuntimeCommandBatchV1["operations"][number],
  inventory: RustIntegratedPlayerInventoryImportV1,
) {
  const operation = receipt.domainReceipts[operationIndex];
  if (!operation || operation.domain !== "gameplay"
    || operation.typeId !== RUST_INTEGRATED_PLAYER_INVENTORY_IMPORT_RECEIPT_TYPE_V1
    || operation.schema !== 1
    || operation.payloadHash !== rustIntegratedRuntimeWireChecksumV1(operation.payload)) {
    fail("bootstrap-receipt", "BWI7 returned the wrong ordered native receipt");
  }
  validateRustIntegratedPlayerInventoryImportReceiptV1(
    decodeRustIntegratedPlayerInventoryImportReceiptV1(operation.payload),
    inventory,
    request.payloadHash,
  );
}

/** Executes one planned batch and requires exact ordered BWA6/BWF7/BWI7 receipts. */
export async function executeRustIntegratedPlayerBootstrapV1(
  service: RustIntegratedPlayerBootstrapServiceV1,
  observation: RustIntegratedPlayerBootstrapObservationV1,
  intent: RustIntegratedPlayerBootstrapIntentV1,
): Promise<RustIntegratedPlayerBootstrapResultV1> {
  const plan = planRustIntegratedPlayerBootstrapV1(observation, intent);
  if (!rustIntegratedRuntimeIdentityEqualsV1(service.identity(), observation.identity)) {
    fail("bootstrap-stale", "runtime identity moved after the bootstrap status was observed");
  }
  if (plan.status === "already-matching") {
    return Object.freeze({ status: "already-matching", entityId: plan.entityId, identity: observation.identity, receipt: null });
  }
  const receipt = await service.command(plan.batch);
  if (receipt.commandId !== plan.batch.commandId
    || receipt.idempotencyKey !== plan.batch.idempotencyKey
    || receipt.commandHash !== plan.batch.commandHash) {
    fail("bootstrap-receipt", "bootstrap receipt does not identify the exact BWRQ command");
  }
  if (receipt.status === "rejected") {
    if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.current, plan.expected)) {
      fail("bootstrap-receipt", "rejected bootstrap receipt moved the authoritative runtime identity");
    }
    if (!rustIntegratedRuntimeIdentityEqualsV1(service.identity(), receipt.current)) {
      fail("bootstrap-receipt", "runtime identity disagrees with the rejected bootstrap receipt");
    }
    fail(receipt.code, receipt.message);
  }
  if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.before, plan.expected)
    || receipt.domainReceipts.length !== plan.batch.operations.length) {
    fail("bootstrap-receipt", "accepted bootstrap receipt does not attest the expected atomic operation count");
  }
  if (!rustIntegratedRuntimeIdentityEqualsV1(service.identity(), receipt.after)) {
    fail("bootstrap-receipt", "runtime identity disagrees with the accepted bootstrap receipt");
  }
  if (plan.status === "spawn-bind-and-import") {
    const spawned = validateRustIntegratedEntityCompatibilityImportReceiptV1(
      receipt.domainReceipts[0],
      plan.entityImport,
    );
    validateBindReceipt(receipt, 1, plan.batch.operations[1]);
    validateInventoryReceipt(receipt, 2, plan.batch.operations[2], plan.inventoryImport);
    return Object.freeze({ status: "spawned-bound-and-imported", entityId: spawned.entityId, identity: receipt.after, receipt });
  }
  if (plan.status === "bind-and-import") {
    validateBindReceipt(receipt, 0, plan.batch.operations[0]);
    validateInventoryReceipt(receipt, 1, plan.batch.operations[1], plan.inventoryImport);
    return Object.freeze({ status: "bound-and-imported", entityId: plan.entityId, identity: receipt.after, receipt });
  }
  if (plan.status === "install-combat") {
    validateBindReceipt(receipt, 0, plan.batch.operations[0]);
    return Object.freeze({ status: "combat-installed", entityId: plan.entityId, identity: receipt.after, receipt });
  }
  const inventoryIndex = plan.combatBind === null ? 0 : 1;
  if (plan.combatBind !== null) validateBindReceipt(receipt, 0, plan.batch.operations[0]);
  validateInventoryReceipt(receipt, inventoryIndex, plan.batch.operations[inventoryIndex], plan.inventoryImport);
  return Object.freeze({ status: "inventory-imported", entityId: plan.entityId, identity: receipt.after, receipt });
}

function observationFromStatus(
  identity: RustIntegratedRuntimeIdentityV1,
  status: RustIntegratedPlayerBootstrapStatusReceiptV1,
  combat: RustIntegratedPlayerCombatBootstrapStatusReceiptV1,
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
    combat,
  });
}

/** Reads one exact BWO5 status without changing integrated runtime identity. */
export async function queryRustIntegratedPlayerBootstrapObservationV1(
  service: RustIntegratedPlayerBootstrapServiceV1,
  intent: RustIntegratedPlayerBootstrapIntentV1,
) {
  const desired = normalizedIntent(intent);
  const expected = service.identity();
  const payload = encodeRustIntegratedPlayerBootstrapStatusQueryV1({
    externalEntityId: desired.binding.externalEntityId,
    actorId: desired.binding.actorId,
    playerId: desired.playerId,
  });
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
    schema: BOOTSTRAP_STATUS_SCHEMA_V1.operationSchema,
    payload,
  });
  const combatPayload = encodeRustIntegratedPlayerCombatBootstrapStatusQueryV1({
    externalEntityId: desired.binding.externalEntityId,
    actorId: desired.binding.actorId,
    playerId: desired.playerId,
  });
  const combatOperation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1,
    schema: COMBAT_STATUS_SCHEMA_V1.operationSchema,
    payload: combatPayload,
  });
  const batch = batchFor(expected, intent.commandActorId, Object.freeze([operation, combatOperation]));
  const receipt = await service.command(batch);
  if (receipt.commandId !== batch.commandId || receipt.idempotencyKey !== batch.idempotencyKey || receipt.commandHash !== batch.commandHash) {
    fail("bootstrap-status-receipt", "status receipt does not identify the exact BWS5 command");
  }
  if (receipt.status === "rejected") {
    if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.current, expected)) fail("bootstrap-status-receipt", "rejected status query moved runtime identity");
    fail(receipt.code, receipt.message);
  }
  const response = receipt.domainReceipts[0];
  const combatResponse = receipt.domainReceipts[1];
  if (receipt.domainReceipts.length !== 2 || !rustIntegratedRuntimeIdentityEqualsV1(receipt.before, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(receipt.after, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)
    || !response || response.domain !== "simulation"
    || response.typeId !== RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1
    || response.schema !== BOOTSTRAP_STATUS_RECEIPT_SCHEMA_V1.operationSchema
    || response.payloadHash !== rustIntegratedRuntimeWireChecksumV1(response.payload)
    || !combatResponse || combatResponse.domain !== "simulation"
    || combatResponse.typeId !== RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1
    || combatResponse.schema !== COMBAT_STATUS_RECEIPT_SCHEMA_V1.operationSchema
    || combatResponse.payloadHash !== rustIntegratedRuntimeWireChecksumV1(combatResponse.payload)) {
    fail("bootstrap-status-receipt", "BWS5/BWS7 returned a mutating or incorrectly typed receipt");
  }
  return observationFromStatus(
    expected,
    decodeRustIntegratedPlayerBootstrapStatusReceiptV1(response.payload, operation.payloadHash),
    decodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(combatResponse.payload, combatOperation.payloadHash),
  );
}

/** Status-query plus one atomic bootstrap transaction. */
export async function bootstrapRustIntegratedPlayerV1(
  service: RustIntegratedPlayerBootstrapServiceV1,
  intent: RustIntegratedPlayerBootstrapIntentV1,
) {
  const observation = await queryRustIntegratedPlayerBootstrapObservationV1(service, intent);
  return executeRustIntegratedPlayerBootstrapV1(service, observation, intent);
}
