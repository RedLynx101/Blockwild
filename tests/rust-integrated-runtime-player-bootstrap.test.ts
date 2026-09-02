import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "../app/game/rust-integrated-runtime-domain-schema.generated.ts";
import {
  decodeRustIntegratedEntityCompatibilityImportV1,
  encodeRustIntegratedEntityCompatibilityImportV1,
  encodeRustIntegratedEntityEventBatchReceiptV1,
  RUST_INTEGRATED_ENTITY_EVENT_RECEIPT_TYPE_V1,
} from "../app/game/rust-integrated-runtime-entities.ts";
import {
  deriveRustIntegratedLocationIdV1,
  deriveRustIntegratedPlayerIdV1,
} from "../app/game/rust-integrated-runtime-identity.ts";
import {
  decodeRustIntegratedPlayerInventoryImportReceiptV1,
  decodeRustIntegratedPlayerInventoryImportV1,
  encodeRustIntegratedPlayerInventoryImportReceiptV1,
  encodeRustIntegratedPlayerInventoryImportV1,
  rustIntegratedPlayerInventoryMetadataHashV1,
  rustIntegratedPlayerInventoryResultHashV1,
  RUST_INTEGRATED_PLAYER_INVENTORY_IMPORT_RECEIPT_TYPE_V1,
  type RustIntegratedPlayerInventoryImportV1,
  type RustIntegratedPlayerInventoryIntentV1,
} from "../app/game/rust-integrated-runtime-player-inventory.ts";
import {
  decodeRustIntegratedPlayerBootstrapStatusQueryV1,
  decodeRustIntegratedPlayerBootstrapStatusReceiptV1,
  encodeRustIntegratedPlayerBootstrapStatusQueryV1,
  encodeRustIntegratedPlayerBootstrapStatusReceiptV1,
  RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
} from "../app/game/rust-integrated-runtime-player-status.ts";
import {
  decodeRustIntegratedPlayerCombatBootstrapStatusQueryV1,
  encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1,
  RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
} from "../app/game/rust-integrated-runtime-player-combat-status.ts";
import {
  executeRustIntegratedPlayerBootstrapV1,
  planRustIntegratedPlayerBootstrapV1,
  queryRustIntegratedPlayerBootstrapObservationV1,
  RustIntegratedPlayerBootstrapErrorV1,
  validateRustIntegratedPlayerCombatBootstrapV1,
  type RustIntegratedPlayerBootstrapIntentV1,
  type RustIntegratedPlayerBootstrapObservationV1,
  type RustIntegratedPlayerBootstrapServiceV1,
} from "../app/game/rust-integrated-runtime-player-bootstrap.ts";
import {
  RUST_INTEGRATED_PLAYER_COMBAT_BIND_RECEIPT_TYPE_V4,
} from "../app/game/rust-integrated-runtime-player-bootstrap.ts";
import type { RustEntityCompatibilityRecordR6 } from "../app/game/rust-entity-authority-contract-r6.ts";

const ZERO_HASH = "00000000000000000000000000000000";
const ENTITY_ID = BigInt("18446744069414584321");
const ENTITY_EVENT_RECEIPT_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("entity-receipt-v1");
const FIXTURE = JSON.parse(readFileSync(
  new URL("./fixtures/rust-engine/integrated-runtime-v1/player-bootstrap-v1.json", import.meta.url),
  "utf8",
)) as Readonly<{
  bwi5Hex: string;
}>;
const NATIVE_BOOTSTRAP_FIXTURE = JSON.parse(readFileSync(
  new URL("./fixtures/rust-engine/integrated-runtime-v1/player-bootstrap-native-v1.json", import.meta.url),
  "utf8",
)) as Readonly<{ bws5Hex: string; bwo5Hex: string; bwp7Hex: string; bwi7Hex: string }>;
const IDENTITY_VECTORS = readFileSync(
  new URL("../engine/crates/blockwild-types/fixtures/id-derivation-v1.txt", import.meta.url),
  "utf8",
).split(/\r?\n/gu).filter((line) => line.length > 0 && !line.startsWith("#")).map((line) => {
  const [universeKey, playerKey, locationKey, playerId, locationId, ...trailing] = line.split("|");
  assert.equal(trailing.length, 0);
  assert.ok(universeKey && playerKey && locationKey && playerId && locationId);
  return Object.freeze({ universeKey, playerKey, locationKey, playerId, locationId });
});

function identity(hash = "1".repeat(32), entities = 5): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "blockwild:primary",
    locationId: "surface:spawn",
    revision: Object.freeze({ epoch: 1, world: 2, entities, gameplay: 4, persistence: 5, network: 6, simulation: 7 }),
    tick: 8,
    stateHash: hash,
  });
}

function playerRecord(): RustEntityCompatibilityRecordR6 {
  return Object.freeze({
    schema: 1,
    externalEntityId: "player:primary",
    legacyNumericId: null,
    specimenId: "player:primary",
    kindKey: "player",
    class: "player",
    variantKey: null,
    name: "Noah",
    locationId: deriveRustIntegratedLocationIdV1("blockwild:primary", "surface:spawn"),
    position: Object.freeze({ x: 0, y: 72, z: 0 }),
    yaw: 0,
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    health: 20,
    maximumHealth: 20,
    ageTicks: BigInt(0),
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
    custom: Object.freeze([]),
  });
}

function playerInventory(selectedSlot = 4, restoredRevision = BigInt(1)): RustIntegratedPlayerInventoryIntentV1 {
  const inventoryContainer = Object.freeze({ kind: "player" as const, id: "player:noah", ownerId: "player:noah" });
  const slots = Object.freeze([
    Object.freeze({ itemCode: 1, count: 2, durabilityMillionths: null, metadata: null }),
    ...Array.from({ length: 8 }, () => null),
  ]);
  const importShape: RustIntegratedPlayerInventoryImportV1 = Object.freeze({
    inventoryContainer,
    expectedRevision: BigInt(0),
    selectedSlot,
    slots: Object.freeze(slots.map((slot) => slot && Object.freeze({
      itemCode: slot.itemCode,
      count: slot.count,
      durabilityMillionths: slot.durabilityMillionths,
      metadataHash: ZERO_HASH,
    }))),
    metadata: Object.freeze([]),
  });
  return Object.freeze({
    selectedSlot,
    slots,
    expectedPristineRevision: BigInt(0),
    bootstrapImportHash: rustIntegratedPlayerInventoryResultHashV1({
      inventoryContainer,
      revision: BigInt(1),
      slots: importShape.slots,
      metadata: importShape.metadata,
    }),
    expectedRestoredRevision: restoredRevision,
    restoredInventoryHash: rustIntegratedPlayerInventoryResultHashV1({
      inventoryContainer,
      revision: restoredRevision,
      slots: importShape.slots,
      metadata: importShape.metadata,
    }),
  });
}

function continuity() {
  return Object.freeze({
    lastMonotonicTimeUs: BigInt(0),
    lastInputSequence: null,
    nextInputSequence: BigInt(1),
    lastActionSequence: null,
    nextActionSequence: BigInt(1),
    authoritativeFlags: 0,
    lastAppliedInput: null,
    queuedInputsEmpty: true,
  });
}

function absentCombat(entityRevision: bigint) {
  return Object.freeze({
    requestPayloadHash: ZERO_HASH,
    entityAuthorityRevision: entityRevision,
    gameplaySequence: BigInt(0),
    gameplayCombatRevision: BigInt(0),
    gameplayStateHash: ZERO_HASH,
    status: "absent" as const,
    blocker: null,
    combatant: null,
  });
}

function intent(): RustIntegratedPlayerBootstrapIntentV1 {
  const { class: _class, locationId: _locationId, ...entity } = playerRecord();
  assert.equal(_class, "player");
  assert(_locationId > BigInt(0));
  return Object.freeze({
    universeKey: "blockwild:primary",
    playerKey: "player:noah",
    locationKey: "surface:spawn",
    commandActorId: "runtime:bootstrap",
    desiredEntityId: null,
    residency: "hot",
    entity,
    binding: Object.freeze({
      actorId: "player:noah",
      creativeMode: false,
      radius: 0.3,
      standingHeight: 1.8,
      crouchingHeight: 1.45,
      mass: 80,
      walkSpeed: 4.3,
      sprintSpeed: 6.1,
      creativeFlightSpeed: 10,
      maximumOxygenSeconds: 15,
    }),
    inventory: playerInventory(),
  });
}

function absentObservation(): RustIntegratedPlayerBootstrapObservationV1 {
  return Object.freeze({
    identity: identity("1".repeat(32), 5),
    worldAuthorityRevision: Object.freeze({ epoch: BigInt(1), mutation: BigInt(2), residency: BigInt(3) }),
    entityAuthority: Object.freeze({ revision: BigInt(5), nextSequence: BigInt(91), tick: BigInt(8) }),
    continuity: continuity(),
    entity: null,
    runtimePlayer: null,
    worldViewBinding: null,
    custody: Object.freeze({ status: "absent" }),
    combat: absentCombat(BigInt(5)),
  });
}

function matchingObservation(): RustIntegratedPlayerBootstrapObservationV1 {
  const desired = intent();
  const playerId = deriveRustIntegratedPlayerIdV1(desired.universeKey, desired.playerKey);
  const record = Object.freeze({ ...playerRecord(), position: Object.freeze({ x: 19, y: 70, z: -4 }), health: 13 });
  const binding = Object.freeze({ ...desired.binding, externalEntityId: record.externalEntityId, playerId });
  const inventory = Object.freeze({ kind: "player" as const, id: binding.actorId, ownerId: binding.actorId });
  const equipment = Object.freeze({ kind: "equipment" as const, id: `${binding.actorId}:equipment`, ownerId: binding.actorId });
  return Object.freeze({
    identity: identity("1".repeat(32), 6),
    worldAuthorityRevision: Object.freeze({ epoch: BigInt(1), mutation: BigInt(2), residency: BigInt(3) }),
    entityAuthority: Object.freeze({ revision: BigInt(6), nextSequence: BigInt(92), tick: BigInt(8) }),
    continuity: continuity(),
    entity: Object.freeze({ entityId: ENTITY_ID, entityRevision: BigInt(4), residency: "hot" as const, record }),
    runtimePlayer: Object.freeze({ entityId: ENTITY_ID, binding }),
    worldViewBinding: Object.freeze({
      playerId,
      revision: BigInt(3),
      actorId: binding.actorId,
      entityId: ENTITY_ID,
      inventoryContainer: inventory,
      equipmentContainer: equipment,
      selectedSlot: 4,
      backSlot: 7,
    }),
    custody: Object.freeze({
      status: "present" as const,
      inventoryContainer: inventory,
      inventoryRevision: BigInt(1),
      inventorySlots: Object.freeze([
        Object.freeze({ itemCode: 1, count: 2, durabilityMillionths: null, metadataHash: ZERO_HASH }),
        ...Array.from({ length: 8 }, () => null),
      ]),
      equipmentContainer: equipment,
      equipmentRevision: BigInt(2),
      equipmentSlots: Object.freeze(Array.from({ length: 8 }, () => null)),
      metadata: Object.freeze([]),
    }),
    combat: Object.freeze({
      requestPayloadHash: ZERO_HASH,
      entityAuthorityRevision: BigInt(6),
      gameplaySequence: BigInt(1),
      gameplayCombatRevision: BigInt(1),
      gameplayStateHash: "7".repeat(32),
      status: "exact-linked" as const,
      blocker: null,
      combatant: Object.freeze({
        recordId: binding.actorId,
        ownerId: binding.actorId,
        revision: BigInt(0),
        entityId: ENTITY_ID,
        vitalUnits: "millihearts-v1" as const,
        health: 13_000,
        maxHealth: 20_000,
        alive: true,
        crossDomainParity: true,
      }),
    }),
  });
}

function bytes(hex: string) {
  return Uint8Array.from(hex.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

function bindAck(requestHash: string, terminalHash: string) {
  return Uint8Array.of(
    0x42, 0x57, 0x46, 0x37, 1, 0,
    ...bytes(requestHash),
    ...bytes(terminalHash),
  );
}

function gameplayIdentity(sequence: bigint, inventoryRevision: bigint, stateHash: string) {
  return Object.freeze({
    universe: "blockwild:primary",
    location: "surface:spawn",
    revision: Object.freeze({ epoch: 1, sequence, inventory: inventoryRevision, machines: BigInt(0), combat: BigInt(0), progression: BigInt(0), cardforge: BigInt(0) }),
    stateHash,
  });
}

class FakeBootstrapService implements RustIntegratedPlayerBootstrapServiceV1 {
  readonly batches: RustIntegratedRuntimeCommandBatchV1[] = [];
  mode: "accept" | "reject" | "reverse" = "accept";
  current: RustIntegratedRuntimeIdentityV1;

  constructor(current = identity()) {
    this.current = current;
  }

  identity() {
    return this.current;
  }

  async command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1> {
    this.batches.push(batch);
    if (this.mode === "reject") {
      return Object.freeze({
        status: "rejected" as const,
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        code: "fixture-rejected",
        message: "fixture rollback",
        current: this.current,
        receiptHash: ZERO_HASH,
      });
    }
    const after = identity("2".repeat(32), this.current.revision.entities + (batch.operations.some((value) => value.domain === "entities") ? 1 : 0));
    const receipts = batch.operations.map((operation) => {
      if (operation.domain === "entities") {
        const request = decodeRustIntegratedEntityCompatibilityImportV1(operation.payload);
        return createRustIntegratedRuntimeDomainOperationV1({
          domain: "entities",
          typeId: RUST_INTEGRATED_ENTITY_EVENT_RECEIPT_TYPE_V1,
          schema: ENTITY_EVENT_RECEIPT_SCHEMA_V1.operationSchema,
          payload: encodeRustIntegratedEntityEventBatchReceiptV1({
            schema: 1,
            sequence: request.sequence,
            previousRevision: request.expectedRevision,
            revision: request.expectedRevision + BigInt(1),
            events: Object.freeze([Object.freeze({
              commandIndex: 0,
              entityId: request.desiredEntityId ?? ENTITY_ID,
              previousEntityRevision: BigInt(0),
              entityRevision: BigInt(1),
              kind: Object.freeze({ type: "spawned" as const, residency: request.residency }),
            })]),
          }),
        });
      }
      if (operation.domain === "simulation") {
        return createRustIntegratedRuntimeDomainOperationV1({
          domain: "simulation",
          typeId: RUST_INTEGRATED_PLAYER_COMBAT_BIND_RECEIPT_TYPE_V4,
          schema: 4,
          payload: bindAck(operation.payloadHash, after.stateHash),
        });
      }
      const request = decodeRustIntegratedPlayerInventoryImportV1(operation.payload);
      const beforeGameplay = gameplayIdentity(BigInt(9), BigInt(0), "4".repeat(32));
      const afterGameplay = gameplayIdentity(BigInt(10), BigInt(1), "5".repeat(32));
      return createRustIntegratedRuntimeDomainOperationV1({
        domain: "gameplay",
        typeId: RUST_INTEGRATED_PLAYER_INVENTORY_IMPORT_RECEIPT_TYPE_V1,
        schema: 1,
        payload: encodeRustIntegratedPlayerInventoryImportReceiptV1({
          requestPayloadHash: operation.payloadHash,
          before: beforeGameplay,
          after: afterGameplay,
          acceptedReceiptHash: "6".repeat(32),
          resultingInventoryRevision: BigInt(1),
          selectedSlot: request.selectedSlot,
          inventoryResultHash: rustIntegratedPlayerInventoryResultHashV1({
            inventoryContainer: request.inventoryContainer,
            revision: BigInt(1),
            slots: request.slots,
            metadata: request.metadata,
          }),
        }),
      });
    });
    const ordered = this.mode === "reverse" ? receipts.reverse() : receipts;
    const receipt: RustIntegratedRuntimeAcceptedReceiptV1 = Object.freeze({
      status: "accepted",
      commandId: batch.commandId,
      idempotencyKey: batch.idempotencyKey,
      commandHash: batch.commandHash,
      before: this.current,
      after,
      domainReceipts: Object.freeze(ordered),
      receiptHash: rustIntegratedRuntimeWireChecksumV1(new Uint8Array()),
    });
    this.current = after;
    return receipt;
  }
}

test("stable player and location derivation preserves full u64 cross-language vectors", () => {
  for (const vector of IDENTITY_VECTORS) {
    assert.equal(deriveRustIntegratedPlayerIdV1(vector.universeKey, vector.playerKey), BigInt(vector.playerId));
    assert.equal(deriveRustIntegratedLocationIdV1(vector.universeKey, vector.locationKey), BigInt(vector.locationId));
  }
  assert(deriveRustIntegratedPlayerIdV1("blockwild:primary", "player:noah") > BigInt(Number.MAX_SAFE_INTEGER));
});

test("BWI5 freezes the exact envelope, round-trips, and rejects corruption", () => {
  const request = Object.freeze({
    sequence: BigInt(91),
    expectedRevision: BigInt(5),
    tick: BigInt(8),
    desiredEntityId: null,
    residency: "hot" as const,
    record: playerRecord(),
  });
  const encoded = encodeRustIntegratedEntityCompatibilityImportV1(request);
  assert.equal(Buffer.from(encoded).toString("hex"), FIXTURE.bwi5Hex);
  assert.deepEqual(decodeRustIntegratedEntityCompatibilityImportV1(encoded), request);
  const high = Object.freeze({
    ...request,
    sequence: (BigInt(1) << BigInt(64)) - BigInt(1),
    expectedRevision: (BigInt(1) << BigInt(64)) - BigInt(2),
    tick: (BigInt(1) << BigInt(64)) - BigInt(3),
    desiredEntityId: ENTITY_ID,
  });
  assert.deepEqual(decodeRustIntegratedEntityCompatibilityImportV1(
    encodeRustIntegratedEntityCompatibilityImportV1(high),
  ), high);
  const corrupt = Uint8Array.from(encoded);
  corrupt[12] ^= 0xff;
  assert.throws(() => decodeRustIntegratedEntityCompatibilityImportV1(corrupt), /checksum/u);
  assert.throws(() => decodeRustIntegratedEntityCompatibilityImportV1(Uint8Array.of(...encoded, 0)), /length/u);
});

test("BWS5/BWO5 status codecs preserve exact cursors and fail closed", () => {
  const query = Object.freeze({ externalEntityId: "player:primary", actorId: "player:noah", playerId: deriveRustIntegratedPlayerIdV1("blockwild:primary", "player:noah") });
  const request = encodeRustIntegratedPlayerBootstrapStatusQueryV1(query);
  assert.deepEqual(decodeRustIntegratedPlayerBootstrapStatusQueryV1(request), query);
  const status = Object.freeze({
    requestPayloadHash: rustIntegratedRuntimeWireChecksumV1(request),
    worldAuthorityRevision: Object.freeze({ epoch: BigInt(1), mutation: BigInt(2), residency: BigInt(3) }),
    entityAuthority: Object.freeze({ revision: BigInt(5), nextSequence: BigInt(91), tick: BigInt(8) }),
    continuity: continuity(),
    entity: null,
    runtimePlayer: null,
    worldViewBinding: null,
    custody: Object.freeze({ status: "absent" as const }),
  });
  const encoded = encodeRustIntegratedPlayerBootstrapStatusReceiptV1(status);
  assert.deepEqual(decodeRustIntegratedPlayerBootstrapStatusReceiptV1(encoded, status.requestPayloadHash), status);
  const corrupt = Uint8Array.from(encoded); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => decodeRustIntegratedPlayerBootstrapStatusReceiptV1(corrupt), /checksum/u);
  const discontinuous = Object.freeze({ ...status, continuity: Object.freeze({ ...continuity(), nextInputSequence: BigInt(2) }) });
  assert.throws(() => encodeRustIntegratedPlayerBootstrapStatusReceiptV1(discontinuous), /discontinuous/u);
  const queued = Object.freeze({
    ...status,
    continuity: Object.freeze({
      ...continuity(),
      lastInputSequence: BigInt(2),
      nextInputSequence: BigInt(3),
      lastAppliedInput: Object.freeze({ sequence: BigInt(1), targetTick: BigInt(8), moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0, buttons: 0, selectedSlot: 0, flags: 0 }),
      queuedInputsEmpty: false,
    }),
  });
  assert.equal(decodeRustIntegratedPlayerBootstrapStatusReceiptV1(
    encodeRustIntegratedPlayerBootstrapStatusReceiptV1(queued),
  ).continuity.queuedInputsEmpty, false);
});

test("BWO5 round-trips full binding, nine/eight-slot custody, and referenced metadata", () => {
  const source = matchingObservation();
  const metadataSource = Object.freeze({
    typeId: "legacy-instance",
    schemaId: "legacy-instance-v1",
    schemaVersion: 1,
    contentVersion: 2,
    canonicalJsonBytes: new TextEncoder().encode("{\"quality\":\"kept\"}"),
    unknownExtensionBytes: Uint8Array.of(4, 2),
  });
  const metadata = Object.freeze({ hash: rustIntegratedPlayerInventoryMetadataHashV1(metadataSource), ...metadataSource });
  const custody = source.custody as Extract<typeof source.custody, { status: "present" }>;
  const complete = Object.freeze({
    requestPayloadHash: "a".repeat(32),
    worldAuthorityRevision: source.worldAuthorityRevision,
    entityAuthority: source.entityAuthority,
    continuity: source.continuity,
    entity: source.entity,
    runtimePlayer: source.runtimePlayer,
    worldViewBinding: source.worldViewBinding,
    custody: Object.freeze({
      ...custody,
      inventorySlots: Object.freeze([
        Object.freeze({ itemCode: 17, count: 1, durabilityMillionths: 500_000, metadataHash: metadata.hash }),
        ...Array.from({ length: 8 }, () => null),
      ]),
      equipmentSlots: Object.freeze([
        Object.freeze({ itemCode: 18, count: 1, durabilityMillionths: null, metadataHash: ZERO_HASH }),
        ...Array.from({ length: 7 }, () => null),
      ]),
      metadata: Object.freeze([metadata]),
    }),
  });
  const encoded = encodeRustIntegratedPlayerBootstrapStatusReceiptV1(complete);
  assert.deepEqual(decodeRustIntegratedPlayerBootstrapStatusReceiptV1(encoded), complete);
  const missingMetadata = Object.freeze({
    ...complete,
    custody: Object.freeze({ ...complete.custody, metadata: Object.freeze([]) }),
  });
  assert.throws(() => encodeRustIntegratedPlayerBootstrapStatusReceiptV1(missingMetadata), /exactly cover/u);
});

test("BWP7/BWI7 codecs attest exact nine-slot import and result hash", () => {
  const desired = intent();
  const inventoryContainer = Object.freeze({ kind: "player" as const, id: desired.binding.actorId, ownerId: desired.binding.actorId });
  const slots = Object.freeze(desired.inventory.slots.map((slot) => slot && Object.freeze({ itemCode: slot.itemCode, count: slot.count, durabilityMillionths: slot.durabilityMillionths, metadataHash: ZERO_HASH })));
  const request = Object.freeze({ inventoryContainer, expectedRevision: BigInt(0), selectedSlot: desired.inventory.selectedSlot, slots, metadata: Object.freeze([]) });
  const encoded = encodeRustIntegratedPlayerInventoryImportV1(request);
  assert.deepEqual(decodeRustIntegratedPlayerInventoryImportV1(encoded), request);
  const receipt = Object.freeze({
    requestPayloadHash: rustIntegratedRuntimeWireChecksumV1(encoded),
    before: gameplayIdentity(BigInt(1), BigInt(0), "7".repeat(32)),
    after: gameplayIdentity(BigInt(2), BigInt(1), "8".repeat(32)),
    acceptedReceiptHash: "9".repeat(32),
    resultingInventoryRevision: BigInt(1),
    selectedSlot: request.selectedSlot,
    inventoryResultHash: rustIntegratedPlayerInventoryResultHashV1({ inventoryContainer, revision: BigInt(1), slots, metadata: [] }),
  });
  assert.deepEqual(decodeRustIntegratedPlayerInventoryImportReceiptV1(encodeRustIntegratedPlayerInventoryImportReceiptV1(receipt)), receipt);
  assert.throws(() => encodeRustIntegratedPlayerInventoryImportV1(Object.freeze({ ...request, slots: request.slots.slice(0, 8) })), /nine/u);
});

test("BWS5/BWO5/BWP7/BWI7 match frozen native high-byte vectors", () => {
  const max = (BigInt(1) << BigInt(64)) - BigInt(1);
  const query = Object.freeze({
    externalEntityId: "player:水",
    actorId: "actor:水",
    playerId: BigInt("0xfedcba9889abcdef"),
  });
  const queryBytes = encodeRustIntegratedPlayerBootstrapStatusQueryV1(query);
  assert.equal(Buffer.from(queryBytes).toString("hex"), NATIVE_BOOTSTRAP_FIXTURE.bws5Hex);
  const status = Object.freeze({
    requestPayloadHash: "80".repeat(16),
    worldAuthorityRevision: Object.freeze({ epoch: max, mutation: max, residency: max }),
    entityAuthority: Object.freeze({ revision: max, nextSequence: null, tick: max }),
    continuity: Object.freeze({
      lastMonotonicTimeUs: max,
      lastInputSequence: max,
      nextInputSequence: null,
      lastActionSequence: max - BigInt(1),
      nextActionSequence: max,
      authoritativeFlags: 7,
      lastAppliedInput: Object.freeze({
        sequence: max,
        targetTick: max,
        moveX: -0x8000,
        moveZ: 0x7fff,
        lookYaw: -1,
        lookPitch: 1,
        buttons: 0xffff_ffff,
        selectedSlot: 8,
        flags: 7,
      }),
      queuedInputsEmpty: true,
    }),
    entity: null,
    runtimePlayer: null,
    worldViewBinding: null,
    custody: Object.freeze({ status: "absent" as const }),
  });
  const statusBytes = encodeRustIntegratedPlayerBootstrapStatusReceiptV1(status);
  assert.equal(Buffer.from(statusBytes).toString("hex"), NATIVE_BOOTSTRAP_FIXTURE.bwo5Hex);
  assert.deepEqual(decodeRustIntegratedPlayerBootstrapStatusReceiptV1(statusBytes), status);

  const canonicalJsonBytes = new TextEncoder().encode("{\"name\":\"水\"}");
  const metadataSource = Object.freeze({
    typeId: "legacy:水",
    schemaId: "legacy-player-item-v1",
    schemaVersion: 1,
    contentVersion: 0xffff_ffff,
    canonicalJsonBytes,
    unknownExtensionBytes: Uint8Array.of(0, 0x80, 0xff),
  });
  const metadata = Object.freeze({
    hash: rustIntegratedPlayerInventoryMetadataHashV1(metadataSource),
    ...metadataSource,
  });
  assert.equal(metadata.hash, "882e9e6aeccf42c3f0de791eecf30a2e");
  const inventoryContainer = Object.freeze({ kind: "player" as const, id: "actor:水", ownerId: "actor:水" });
  const slots = Object.freeze([
    ...Array.from({ length: 8 }, () => null),
    Object.freeze({ itemCode: 0xffff_ffff, count: 0xffff_ffff, durabilityMillionths: 1_000_000, metadataHash: metadata.hash }),
  ]);
  const inventoryRequest = Object.freeze({ inventoryContainer, expectedRevision: BigInt(0), selectedSlot: 8, slots, metadata: Object.freeze([metadata]) });
  const inventoryBytes = encodeRustIntegratedPlayerInventoryImportV1(inventoryRequest);
  assert.equal(Buffer.from(inventoryBytes).toString("hex"), NATIVE_BOOTSTRAP_FIXTURE.bwp7Hex);
  assert.deepEqual(decodeRustIntegratedPlayerInventoryImportV1(inventoryBytes), inventoryRequest);

  const before = Object.freeze({
    universe: "universe:水",
    location: "surface",
    revision: Object.freeze({ epoch: 1, sequence: BigInt(0), inventory: BigInt(0), machines: BigInt(0), combat: BigInt(0), progression: BigInt(0), cardforge: BigInt(0) }),
    stateHash: "f79d45c28f5c7ef3c83a571e907d2503",
  });
  const after = Object.freeze({
    universe: "universe:水",
    location: "surface",
    revision: Object.freeze({ epoch: 1, sequence: max, inventory: max, machines: BigInt(0), combat: BigInt(0), progression: BigInt(0), cardforge: BigInt(0) }),
    stateHash: "ff".repeat(16),
  });
  const inventoryResultHash = rustIntegratedPlayerInventoryResultHashV1({ inventoryContainer, revision: BigInt(1), slots, metadata: [metadata] });
  assert.equal(inventoryResultHash, "213d5b06a014aa2038b55f7d5a206b52");
  const inventoryReceipt = Object.freeze({
    requestPayloadHash: "a82a5446608b477238b55f7d5a206b52",
    before,
    after,
    acceptedReceiptHash: "81".repeat(16),
    resultingInventoryRevision: BigInt(1),
    selectedSlot: 8,
    inventoryResultHash,
  });
  const receiptBytes = encodeRustIntegratedPlayerInventoryImportReceiptV1(inventoryReceipt);
  assert.equal(Buffer.from(receiptBytes).toString("hex"), NATIVE_BOOTSTRAP_FIXTURE.bwi7Hex);
  assert.deepEqual(decodeRustIntegratedPlayerInventoryImportReceiptV1(receiptBytes), inventoryReceipt);
});

test("bootstrap status query is an exact nonmutating BWS5 plus BWS7 command", async () => {
  const expected = absentObservation();
  let commands = 0;
  const service: RustIntegratedPlayerBootstrapServiceV1 = {
    identity: () => expected.identity,
    command: async (batch) => {
      commands += 1;
      assert.equal(batch.operations.length, 2);
      const request = batch.operations[0];
      const combatRequest = batch.operations[1];
      assert.equal(request.domain, "simulation");
      assert.equal(request.typeId, RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1);
      assert.equal(request.schema, 1);
      assert.deepEqual(decodeRustIntegratedPlayerBootstrapStatusQueryV1(request.payload), {
        externalEntityId: "player:primary",
        actorId: "player:noah",
        playerId: deriveRustIntegratedPlayerIdV1("blockwild:primary", "player:noah"),
      });
      assert.deepEqual(decodeRustIntegratedPlayerCombatBootstrapStatusQueryV1(combatRequest.payload), {
        externalEntityId: "player:primary",
        actorId: "player:noah",
        playerId: deriveRustIntegratedPlayerIdV1("blockwild:primary", "player:noah"),
      });
      const payload = encodeRustIntegratedPlayerBootstrapStatusReceiptV1({
        requestPayloadHash: request.payloadHash,
        worldAuthorityRevision: expected.worldAuthorityRevision,
        entityAuthority: expected.entityAuthority,
        continuity: expected.continuity,
        entity: expected.entity,
        runtimePlayer: expected.runtimePlayer,
        worldViewBinding: expected.worldViewBinding,
        custody: expected.custody,
      });
      const combatPayload = encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1({
        ...expected.combat,
        requestPayloadHash: combatRequest.payloadHash,
      });
      return Object.freeze({
        status: "accepted" as const,
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        before: expected.identity,
        after: expected.identity,
        domainReceipts: Object.freeze([
          createRustIntegratedRuntimeDomainOperationV1({
            domain: "simulation",
            typeId: RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
            schema: 1,
            payload,
          }),
          createRustIntegratedRuntimeDomainOperationV1({
            domain: "simulation",
            typeId: RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
            schema: 1,
            payload: combatPayload,
          }),
        ]),
        receiptHash: ZERO_HASH,
      });
    },
  };
  const result = await queryRustIntegratedPlayerBootstrapObservationV1(service, intent());
  assert.deepEqual(result, Object.freeze({
    ...expected,
    combat: Object.freeze({ ...expected.combat, requestPayloadHash: result.combat.requestPayloadHash }),
  }));
  assert.equal(commands, 1);
});

test("absent bootstrap atomically orders BWI5, deferred BWF7, then BWP7", async () => {
  const observation = absentObservation();
  const service = new FakeBootstrapService(observation.identity);
  const result = await executeRustIntegratedPlayerBootstrapV1(service, observation, intent());
  assert.equal(result.status, "spawned-bound-and-imported");
  assert.equal(result.entityId, ENTITY_ID);
  assert.equal(service.batches.length, 1);
  assert.deepEqual(service.batches[0].operations.map((operation) => operation.domain), ["entities", "simulation", "gameplay"]);
  assert.equal(decodeRustIntegratedEntityCompatibilityImportV1(service.batches[0].operations[0].payload).sequence, BigInt(91));
});

test("matching restored state is a no-op even when simulation fields evolved", async () => {
  const observation = matchingObservation();
  const service = new FakeBootstrapService(observation.identity);
  const result = await executeRustIntegratedPlayerBootstrapV1(service, observation, intent());
  assert.equal(result.status, "already-matching");
  assert.equal(result.entityId, ENTITY_ID);
  assert.equal(service.batches.length, 0);
});

test("live readiness requires exact linked combat and rejects legacy, blocked, or vital drift", () => {
  const matching = matchingObservation();
  assert.equal(validateRustIntegratedPlayerCombatBootstrapV1(matching, "player:noah"), true);
  assert.equal(
    validateRustIntegratedPlayerCombatBootstrapV1(
      Object.freeze({ ...matching, combat: absentCombat(matching.entityAuthority.revision) }),
      "player:noah",
    ),
    false,
  );
  const legacy = Object.freeze({
    ...matching,
    combat: Object.freeze({
      ...matching.combat,
      status: "legacy-unlinked" as const,
      blocker: "legacy-unlinked-requires-explicit-migration" as const,
      combatant: Object.freeze({
        ...matching.combat.combatant!,
        entityId: null,
        vitalUnits: "legacy-whole-hearts-v1" as const,
        health: 13,
        maxHealth: 20,
        crossDomainParity: false,
      }),
    }),
  });
  assert.throws(
    () => validateRustIntegratedPlayerCombatBootstrapV1(legacy, "player:noah"),
    /explicit-migration/u,
  );
  const blocked = Object.freeze({
    ...matching,
    combat: Object.freeze({
      ...matching.combat,
      status: "blocked" as const,
      blocker: "vital-parity-conflict" as const,
      combatant: Object.freeze({ ...matching.combat.combatant!, crossDomainParity: false }),
    }),
  });
  assert.throws(
    () => validateRustIntegratedPlayerCombatBootstrapV1(blocked, "player:noah"),
    /vital-parity-conflict/u,
  );
  const drift = Object.freeze({
    ...matching,
    combat: Object.freeze({
      ...matching.combat,
      combatant: Object.freeze({ ...matching.combat.combatant!, health: 12_999 }),
    }),
  });
  assert.throws(
    () => validateRustIntegratedPlayerCombatBootstrapV1(drift, "player:noah"),
    /do not match/u,
  );
  const cursorDrift = Object.freeze({
    ...matching,
    combat: Object.freeze({
      ...matching.combat,
      entityAuthorityRevision: matching.combat.entityAuthorityRevision + BigInt(1),
    }),
  });
  assert.throws(
    () => validateRustIntegratedPlayerCombatBootstrapV1(cursorDrift, "player:noah"),
    /authority cursors/u,
  );
});

test("matching evolved native inventory is a no-op at its exact durable revision", async () => {
  const source = matchingObservation();
  const observation = Object.freeze({
    ...source,
    custody: Object.freeze({
      ...source.custody as Extract<typeof source.custody, { status: "present" }>,
      inventoryRevision: BigInt(12),
    }),
  });
  const desired = Object.freeze({ ...intent(), inventory: playerInventory(4, BigInt(12)) });
  const service = new FakeBootstrapService(observation.identity);
  const result = await executeRustIntegratedPlayerBootstrapV1(service, observation, desired);
  assert.equal(result.status, "already-matching");
  assert.equal(service.batches.length, 0);
});

test("an exact unbound entity emits deferred BWF7 then BWP7", async () => {
  const source = matchingObservation();
  const observation = Object.freeze({
    ...source,
    runtimePlayer: null,
    worldViewBinding: null,
    custody: Object.freeze({ status: "absent" as const }),
    combat: absentCombat(source.entityAuthority.revision),
  });
  const service = new FakeBootstrapService(observation.identity);
  const result = await executeRustIntegratedPlayerBootstrapV1(service, observation, intent());
  assert.equal(result.status, "bound-and-imported");
  assert.equal(result.entityId, ENTITY_ID);
  assert.deepEqual(service.batches[0].operations.map((operation) => operation.domain), ["simulation", "gameplay"]);
});

test("bound pristine custody emits only BWP7", async () => {
  const source = matchingObservation();
  const observation = Object.freeze({
    ...source,
    worldViewBinding: Object.freeze({ ...source.worldViewBinding!, selectedSlot: 0 }),
    custody: Object.freeze({
      ...source.custody as Extract<typeof source.custody, { status: "present" }>,
      inventoryRevision: BigInt(0),
      inventorySlots: Object.freeze(Array.from({ length: 9 }, () => null)),
      metadata: Object.freeze([]),
    }),
  });
  const desired = Object.freeze({ ...intent(), inventory: playerInventory(4) });
  const service = new FakeBootstrapService(observation.identity);
  const result = await executeRustIntegratedPlayerBootstrapV1(service, observation, desired);
  assert.equal(result.status, "inventory-imported");
  assert.deepEqual(service.batches[0].operations.map((operation) => operation.domain), ["gameplay"]);
  assert.equal(decodeRustIntegratedPlayerInventoryImportV1(service.batches[0].operations[0].payload).selectedSlot, 4);
});

test("missing sequence, partial state, and contradictory restored identities fail before dispatch", async () => {
  const missingSequence = Object.freeze({
    ...absentObservation(),
    entityAuthority: Object.freeze({ revision: BigInt(5), nextSequence: null, tick: BigInt(8) }),
  });
  assert.throws(() => planRustIntegratedPlayerBootstrapV1(missingSequence, intent()), /explicit next R6/u);
  const contradictoryCursor = Object.freeze({
    ...absentObservation(),
    entityAuthority: Object.freeze({ revision: BigInt(4), nextSequence: BigInt(91), tick: BigInt(8) }),
  });
  assert.throws(() => planRustIntegratedPlayerBootstrapV1(contradictoryCursor, intent()), /contradicts/u);
  const queuedInputs = Object.freeze({
    ...absentObservation(),
    continuity: Object.freeze({
      ...continuity(),
      lastInputSequence: BigInt(1),
      nextInputSequence: BigInt(2),
      queuedInputsEmpty: false,
    }),
  });
  assert.throws(() => planRustIntegratedPlayerBootstrapV1(queuedInputs, intent()), /empty native input queue/u);

  const matching = matchingObservation();
  const partial = Object.freeze({ ...matching, runtimePlayer: null });
  assert.throws(() => planRustIntegratedPlayerBootstrapV1(partial, intent()), /disagree/u);

  const changedActor = Object.freeze({
    ...matching,
    runtimePlayer: Object.freeze({
      ...matching.runtimePlayer!,
      binding: Object.freeze({ ...matching.runtimePlayer!.binding, actorId: "player:intruder" }),
    }),
  });
  const service = new FakeBootstrapService(changedActor.identity);
  await assert.rejects(
    executeRustIntegratedPlayerBootstrapV1(service, changedActor, intent()),
    RustIntegratedPlayerBootstrapErrorV1,
  );
  assert.equal(service.batches.length, 0);

  const slotDrift = Object.freeze({
    ...matching,
    custody: Object.freeze({
      ...matching.custody as Extract<typeof matching.custody, { status: "present" }>,
      inventorySlots: Object.freeze([
        Object.freeze({ itemCode: 1, count: 3, durabilityMillionths: null, metadataHash: ZERO_HASH }),
        ...Array.from({ length: 8 }, () => null),
      ]),
    }),
  });
  assert.throws(() => planRustIntegratedPlayerBootstrapV1(slotDrift, intent()), /durable import attestation/u);

  const selectedSlotDrift = Object.freeze({
    ...matching,
    worldViewBinding: Object.freeze({ ...matching.worldViewBinding!, selectedSlot: 5 }),
  });
  assert.throws(() => planRustIntegratedPlayerBootstrapV1(selectedSlotDrift, intent()), /durable import attestation/u);

  const stale = new FakeBootstrapService(identity("3".repeat(32), 5));
  await assert.rejects(executeRustIntegratedPlayerBootstrapV1(stale, absentObservation(), intent()), /identity moved/u);
  assert.equal(stale.batches.length, 0);
});

test("rejection is rollback-shaped and receipt reordering fails closed", async () => {
  const observation = absentObservation();
  const before = structuredClone(observation);
  const rejected = new FakeBootstrapService(observation.identity);
  rejected.mode = "reject";
  await assert.rejects(executeRustIntegratedPlayerBootstrapV1(rejected, observation, intent()), /fixture rollback/u);
  assert.deepEqual(observation, before);
  assert.equal(rejected.current.stateHash, observation.identity.stateHash);

  const reordered = new FakeBootstrapService(observation.identity);
  reordered.mode = "reverse";
  await assert.rejects(executeRustIntegratedPlayerBootstrapV1(reordered, observation, intent()), /receipt/u);
});
