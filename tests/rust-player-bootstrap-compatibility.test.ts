import assert from "node:assert/strict";
import test from "node:test";
import {
  createCharacterProfile,
  characterNetworkId,
  type CharacterProfile,
} from "../app/game/character-profiles.ts";
import { Item } from "../app/game/data.ts";
import {
  canonicalRustPlayerCompatibilityMetadataJsonBytesV1,
  createRustPlayerBootstrapNewWorldCompatibilityV1,
  deriveRustPlayerBootstrapCompatibilityIdentityV1,
  migrateRustPlayerBootstrapRichSaveCompatibilityV1,
  queryRustPlayerBootstrapIdentityStatusV1,
  RUST_NEW_WORLD_PLAYER_ENTITY_DEFAULTS_V1,
  RUST_PLAYER_BOOTSTRAP_NATIVE_BACK_SLOT_V1,
  RustPlayerBootstrapCompatibilityErrorV1,
  type RustPlayerCompatibilityInventorySlotV1,
  type RustPlayerCompatibilityInventoryV1,
  type RustPlayerNewWorldCompatibilityV1,
  type RustPlayerRichSaveCompatibilityV1,
} from "../app/game/rust-player-bootstrap-compatibility.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import type {
  RustIntegratedRuntimeAcceptedReceiptV1,
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeCommandReceiptV1,
  RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustIntegratedPlayerBootstrapServiceV1 } from "../app/game/rust-integrated-runtime-player-bootstrap.ts";
import {
  normalizeRustIntegratedPlayerInventoryIntentV1,
  rustIntegratedPlayerInventoryMetadataHashV1,
} from "../app/game/rust-integrated-runtime-player-inventory.ts";
import {
  encodeRustIntegratedPlayerBootstrapStatusReceiptV1,
  RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
} from "../app/game/rust-integrated-runtime-player-status.ts";
import { PLAYER_RENDER_MODEL_ID_V1 } from "../app/game/rust-player-render-profile.ts";

const ZERO_HASH = "00000000000000000000000000000000";

function profile(overrides: Partial<CharacterProfile> = {}) {
  const original = createCharacterProfile("browser-fixture", {
    id: "character-fixture",
    name: "Noah",
    createdAt: 1,
    updatedAt: 1,
  }, 1);
  return Object.freeze({ ...original, ...overrides }) as CharacterProfile;
}

function inventory(
  slots: readonly (RustPlayerCompatibilityInventorySlotV1 | null)[] = [
    Object.freeze({ item: Item.Berry, count: 3 }),
    ...Array.from({ length: 35 }, () => null),
  ],
  overrides: Partial<RustPlayerCompatibilityInventoryV1> = {},
): RustPlayerCompatibilityInventoryV1 {
  return Object.freeze({
    slots: Object.freeze([...slots]),
    selectedSlot: 0,
    equipment: Object.freeze({ head: null, chest: null, legs: null, feet: null }),
    offhand: null,
    cursor: null,
    trash: null,
    craftGrid: Object.freeze(Array.from({ length: 9 }, () => null)),
    ...overrides,
  });
}

function newWorld(overrides: Partial<RustPlayerNewWorldCompatibilityV1> = {}): RustPlayerNewWorldCompatibilityV1 {
  return Object.freeze({
    schema: 1,
    kind: "new-world",
    universeKey: "world:fixture-world",
    locationKey: "overworld",
    commandActorId: "reviewed:bootstrap-caller",
    mode: "survival",
    position: Object.freeze({ x: 12, y: 72.51, z: -8 }),
    yaw: 0,
    inventory: inventory(),
    ...overrides,
  });
}

function metadataSlot(withSource = true): RustPlayerCompatibilityInventorySlotV1 {
  return Object.freeze({
    item: Item.Berry,
    count: 3,
    metadata: Object.freeze({ z: 1, a: Object.freeze({ b: true }) }),
    ...(withSource ? {
      nativeMetadataSource: Object.freeze({
        typeId: "blockwild.compatibility.fixture",
        schemaId: "fixture-item-metadata",
        schemaVersion: 1,
        contentVersion: 7,
        unknownExtensionBytes: Uint8Array.of(3, 1, 4),
      }),
    } : {}),
  });
}

function richSave(
  activeProfile = profile(),
  overrides: Partial<RustPlayerRichSaveCompatibilityV1> = {},
): RustPlayerRichSaveCompatibilityV1 {
  const slots = [metadataSlot(), ...Array.from({ length: 35 }, () => null)];
  return Object.freeze({
    schema: 1,
    kind: "rich-save",
    universeKey: "world:fixture-world",
    locationKey: "overworld",
    commandActorId: "reviewed:bootstrap-caller",
    mode: "survival",
    position: Object.freeze({ x: 16, y: 70.5, z: -4 }),
    yaw: 0.5,
    inventory: inventory(slots),
    ownerActorId: characterNetworkId(activeProfile),
    explorationLevel: 2,
    hasTimedMovementModifiers: false,
    continuity: Object.freeze({
      velocity: Object.freeze({ x: 0.25, y: 0, z: -0.5 }),
      health: Object.freeze({ current: 13, maximum: 20 }),
      ageTicks: BigInt(55),
      grounded: true,
    }),
    ...overrides,
  });
}

function assertCompatibilityCode(run: () => unknown, code: string) {
  assert.throws(run, (error) => error instanceof RustPlayerBootstrapCompatibilityErrorV1 && error.code === code);
}

test("new-world player compatibility produces one canonical hot player and revision-one inventory attestation", () => {
  const activeProfile = profile();
  const source = newWorld();
  const plan = createRustPlayerBootstrapNewWorldCompatibilityV1(activeProfile, source);
  const actorId = characterNetworkId(activeProfile);

  assert.equal(plan.identity.actorId, actorId);
  assert.equal(plan.identity.externalEntityId, `player:${actorId}`);
  assert.equal(plan.intent.playerKey, actorId);
  assert.equal(plan.intent.commandActorId, source.commandActorId, "the adapter must preserve, not choose, the caller audit actor");
  assert.equal(plan.intent.desiredEntityId, null);
  assert.equal(plan.intent.residency, "hot");
  assert.equal(plan.intent.entity.externalEntityId, `player:${actorId}`);
  assert.equal(plan.intent.entity.specimenId, `player:${actorId}`);
  assert.equal(plan.intent.entity.kindKey, "player");
  assert.equal(plan.intent.entity.legacyNumericId, null);
  assert.equal(plan.intent.entity.variantKey, null);
  assert.deepEqual(plan.intent.entity.velocity, RUST_NEW_WORLD_PLAYER_ENTITY_DEFAULTS_V1.velocity);
  assert.equal(plan.intent.entity.health, 10);
  assert.equal(plan.intent.entity.maximumHealth, 10);
  assert.equal(plan.intent.entity.ageTicks, BigInt(0));
  assert.equal(plan.intent.entity.position.y, Math.fround(source.position.y), "new authority starts at its canonical R6 f32 position");
  assert.deepEqual(plan.intent.entity.custom, [
    ["modelKey", PLAYER_RENDER_MODEL_ID_V1],
    ["physics.grounded", "false"],
  ]);
  assert.equal(plan.intent.binding.actorId, actorId);
  assert.equal(plan.intent.binding.radius, 0.3);
  assert.equal(plan.intent.binding.standingHeight, 1.8);
  assert.equal(plan.intent.binding.crouchingHeight, 1.48);
  assert.equal(plan.intent.binding.mass, 1.15);
  assert.equal(plan.intent.binding.walkSpeed, 4.35 * 1.02);
  assert.equal(plan.intent.binding.sprintSpeed, 6.35 * 1.02);
  assert.equal(plan.intent.binding.creativeFlightSpeed, 9.5 * 1.02);
  assert.equal(plan.intent.binding.maximumOxygenSeconds, 12);
  assert.equal(plan.intent.inventory.slots.length, 9);
  assert.deepEqual(plan.intent.inventory.slots[0], {
    itemCode: Item.Berry,
    count: 3,
    durabilityMillionths: null,
    metadata: null,
  });
  assert(plan.intent.inventory.slots.slice(1).every((slot) => slot === null));
  assert.equal(plan.intent.inventory.expectedPristineRevision, BigInt(0));
  assert.equal(plan.intent.inventory.expectedRestoredRevision, BigInt(1));
  assert.equal(plan.intent.inventory.bootstrapImportHash, plan.intent.inventory.restoredInventoryHash);
  assert.equal(RUST_PLAYER_BOOTSTRAP_NATIVE_BACK_SLOT_V1, 7);
  normalizeRustIntegratedPlayerInventoryIntentV1(
    Object.freeze({ kind: "player", id: actorId, ownerId: actorId }),
    plan.intent.inventory,
  );
});

test("new builder world maps explicit creative permission and empty custody", () => {
  const activeProfile = profile();
  const empty = inventory(Array.from({ length: 36 }, () => null));
  const plan = createRustPlayerBootstrapNewWorldCompatibilityV1(activeProfile, newWorld({
    mode: "builder",
    inventory: empty,
  }));
  assert.equal(plan.intent.binding.creativeMode, true);
  assert(plan.intent.inventory.slots.every((slot) => slot === null));
  assert.equal(plan.intent.inventory.selectedSlot, 0);
});

test("rich-save player metadata uses exact canonical JSON, explicit source fields, opaque bytes, and native hash", () => {
  const activeProfile = profile();
  const plan = migrateRustPlayerBootstrapRichSaveCompatibilityV1(activeProfile, richSave(activeProfile));
  const metadata = plan.intent.inventory.slots[0]?.metadata;
  assert(metadata);
  assert.equal(new TextDecoder().decode(metadata.canonicalJsonBytes), "{\"a\":{\"b\":true},\"z\":1}");
  assert.deepEqual(metadata.canonicalJsonBytes, canonicalRustPlayerCompatibilityMetadataJsonBytesV1({ z: 1, a: { b: true } }));
  assert.deepEqual(metadata.unknownExtensionBytes, Uint8Array.of(3, 1, 4));
  assert.equal(metadata.typeId, "blockwild.compatibility.fixture");
  assert.equal(metadata.schemaId, "fixture-item-metadata");
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.contentVersion, 7);
  assert.equal(metadata.hash, rustIntegratedPlayerInventoryMetadataHashV1({
    typeId: metadata.typeId,
    schemaId: metadata.schemaId,
    schemaVersion: metadata.schemaVersion,
    contentVersion: metadata.contentVersion,
    canonicalJsonBytes: metadata.canonicalJsonBytes,
    unknownExtensionBytes: metadata.unknownExtensionBytes,
  }));
});

test("rich-save player migration rejects every custody shape that the nine-slot bootstrap cannot carry", () => {
  const activeProfile = profile();
  const base = richSave(activeProfile);
  const occupied = Object.freeze({ item: Item.Berry, count: 1 });
  const cases: readonly [string, RustPlayerCompatibilityInventoryV1][] = [
    ["compatibility-inventory-overflow", inventory([
      metadataSlot(), ...Array.from({ length: 8 }, () => null), occupied, ...Array.from({ length: 26 }, () => null),
    ])],
    ["compatibility-equipment", inventory(base.inventory.slots, { equipment: Object.freeze({ head: occupied }) })],
    ["compatibility-offhand", inventory(base.inventory.slots, { offhand: occupied })],
    ["compatibility-cursor", inventory(base.inventory.slots, { cursor: occupied })],
    ["compatibility-trash", inventory(base.inventory.slots, { trash: occupied })],
    ["compatibility-crafting", inventory(base.inventory.slots, {
      craftGrid: Object.freeze([occupied, ...Array.from({ length: 8 }, () => null)]),
    })],
  ];
  for (const [code, compatibilityInventory] of cases) {
    assertCompatibilityCode(
      () => migrateRustPlayerBootstrapRichSaveCompatibilityV1(activeProfile, { ...base, inventory: compatibilityInventory }),
      code,
    );
  }
});

test("rich-save player migration rejects metadata without a native descriptor and all unsealed durability", () => {
  const activeProfile = profile();
  const base = richSave(activeProfile);
  assertCompatibilityCode(() => migrateRustPlayerBootstrapRichSaveCompatibilityV1(activeProfile, {
    ...base,
    inventory: inventory([metadataSlot(false), ...Array.from({ length: 35 }, () => null)]),
  }), "compatibility-metadata-source");
  assertCompatibilityCode(() => migrateRustPlayerBootstrapRichSaveCompatibilityV1(activeProfile, {
    ...base,
    inventory: inventory([
      Object.freeze({ item: Item.WoodPickaxe, count: 1, durability: 64 }),
      ...Array.from({ length: 35 }, () => null),
    ]),
  }), "compatibility-durability-unsealed");
});

test("rich-save player migration rejects unknown owner, motion, health, age, grounded state, and temporary speed", () => {
  const activeProfile = profile();
  const base = richSave(activeProfile);
  const cases: readonly [string, RustPlayerRichSaveCompatibilityV1][] = [
    ["compatibility-owner-unknown", { ...base, ownerActorId: null }],
    ["compatibility-owner-mismatch", { ...base, ownerActorId: "another.actor" }],
    ["compatibility-exploration-unknown", { ...base, explorationLevel: null }],
    ["compatibility-movement-unknown", { ...base, hasTimedMovementModifiers: null }],
    ["compatibility-movement-transient", { ...base, hasTimedMovementModifiers: true }],
    ["compatibility-velocity-unknown", { ...base, continuity: { ...base.continuity, velocity: null } }],
    ["compatibility-health-unknown", { ...base, continuity: { ...base.continuity, health: null } }],
    ["compatibility-age-unknown", { ...base, continuity: { ...base.continuity, ageTicks: null } }],
    ["compatibility-grounded-unknown", { ...base, continuity: { ...base.continuity, grounded: null } }],
  ];
  for (const [code, source] of cases) {
    assertCompatibilityCode(() => migrateRustPlayerBootstrapRichSaveCompatibilityV1(activeProfile, source), code);
  }
});

test("rich-save migration rejects unsupported race physics and non-lossless R6 f32 values", () => {
  const activeProfile = profile();
  const goblin = profile({ appearance: Object.freeze({ ...activeProfile.appearance, race: "goblin" }) });
  assertCompatibilityCode(
    () => migrateRustPlayerBootstrapRichSaveCompatibilityV1(goblin, richSave(goblin)),
    "compatibility-race-movement",
  );
  const source = richSave(activeProfile);
  assertCompatibilityCode(
    () => migrateRustPlayerBootstrapRichSaveCompatibilityV1(activeProfile, {
      ...source,
      position: Object.freeze({ ...source.position, y: 70.1 }),
    }),
    "compatibility-f32-loss",
  );
});

function runtimeIdentity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "world:fixture-world",
    locationId: "overworld",
    revision: Object.freeze({ epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5, network: 6, simulation: 7 }),
    tick: 8,
    stateHash: "1".repeat(32),
  });
}

class IdentityStatusService implements RustIntegratedPlayerBootstrapServiceV1 {
  readonly batches: RustIntegratedRuntimeCommandBatchV1[] = [];
  readonly current = runtimeIdentity();

  identity() { return this.current; }

  async command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1> {
    this.batches.push(batch);
    const request = batch.operations[0];
    assert.equal(request.typeId, RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1);
    const payload = encodeRustIntegratedPlayerBootstrapStatusReceiptV1({
      requestPayloadHash: request.payloadHash,
      worldAuthorityRevision: Object.freeze({ epoch: BigInt(1), mutation: BigInt(2), residency: BigInt(3) }),
      entityAuthority: Object.freeze({ revision: BigInt(3), nextSequence: BigInt(4), tick: BigInt(8) }),
      continuity: Object.freeze({
        lastMonotonicTimeUs: BigInt(0),
        lastInputSequence: null,
        nextInputSequence: BigInt(1),
        lastActionSequence: null,
        nextActionSequence: BigInt(1),
        authoritativeFlags: 0,
        lastAppliedInput: null,
        queuedInputsEmpty: true,
      }),
      entity: null,
      runtimePlayer: null,
      worldViewBinding: null,
      custody: Object.freeze({ status: "absent" }),
    });
    const response = createRustIntegratedRuntimeDomainOperationV1({
      domain: "simulation",
      typeId: RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
      schema: 1,
      payload,
    });
    const receipt: RustIntegratedRuntimeAcceptedReceiptV1 = Object.freeze({
      status: "accepted",
      commandId: batch.commandId,
      idempotencyKey: batch.idempotencyKey,
      commandHash: batch.commandHash,
      before: this.current,
      after: this.current,
      domainReceipts: Object.freeze([response]),
      receiptHash: rustIntegratedRuntimeWireChecksumV1(new Uint8Array()),
    });
    return receipt;
  }
}

test("identity-only BWS5 status query is two-phase, audit-actor explicit, and identity neutral", async () => {
  const activeProfile = profile();
  const identity = deriveRustPlayerBootstrapCompatibilityIdentityV1(activeProfile, {
    universeKey: "world:fixture-world",
    locationKey: "overworld",
    commandActorId: "reviewed:bootstrap-caller",
  });
  const service = new IdentityStatusService();
  const before = service.identity();
  const observation = await queryRustPlayerBootstrapIdentityStatusV1(service, {
    commandActorId: "reviewed:status-reader",
    externalEntityId: identity.externalEntityId,
    actorId: identity.actorId,
    playerId: identity.playerId,
  });
  assert.equal(service.batches.length, 1);
  assert.equal(service.batches[0].actorId, "reviewed:status-reader");
  assert.equal(service.batches[0].operations.length, 1);
  assert.equal(service.batches[0].operations[0].typeId, RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1);
  assert.equal(service.identity(), before);
  assert.equal(observation.identity, before);
  assert.equal(observation.custody.status, "absent");
  assert.equal(observation.entityAuthority.nextSequence, BigInt(4));
  assert.equal(observation.continuity.nextInputSequence, BigInt(1));
  assert.equal(observation.worldAuthorityRevision.mutation, BigInt(2));
  assert.equal(ZERO_HASH.length, 32);
});
