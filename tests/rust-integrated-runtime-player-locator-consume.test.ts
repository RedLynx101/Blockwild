import assert from "node:assert/strict";
import test from "node:test";

import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import type {
  RustIntegratedRuntimeAcceptedReceiptV1,
  RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RUST_INTEGRATED_PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_LOCATOR_ITEM_CONSUME_TYPE_V1,
  decodeRustIntegratedPlayerLocatorItemConsumeReceiptV1,
  decodeRustIntegratedPlayerLocatorItemConsumeV1,
  encodeRustIntegratedPlayerLocatorItemConsumeReceiptV1,
  encodeRustIntegratedPlayerLocatorItemConsumeV1,
  planRustLiveLocatorItemConsumeV1,
  rehydrateRustLiveLocatorItemConsumePlanV1,
  rustIntegratedContainerViewKeyV1,
  serializeRustLiveLocatorItemConsumePlanV1,
  validateRustLiveLocatorItemConsumeAfterCommandV1,
  validateRustLiveLocatorItemConsumeReceiptV1,
  type RustIntegratedPlayerLocatorItemConsumeReceiptV1,
  type RustIntegratedPlayerLocatorItemConsumeV1,
} from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import type { RustIntegratedGameplayAuthorityIdentityV1 } from "../app/game/rust-integrated-runtime-player-inventory.ts";
import type { RustLivePlayerViewR10 } from "../app/game/rust-live-player-view-r10.ts";

const inventory = Object.freeze({
  kind: "player" as const,
  id: "player:locator",
  ownerId: "player:locator",
});
const expectedStack = Object.freeze({
  itemCode: 701,
  count: 2,
  durabilityMillionths: null,
  metadataHash: "12".repeat(16),
});
const request: RustIntegratedPlayerLocatorItemConsumeV1 = Object.freeze({
  inventory,
  selectedSlot: 3,
  expectedInventoryRevision: BigInt(9),
  expectedStack,
  purpose: "chart",
  locatorResultHash: "34".repeat(16),
});

function integratedIdentity(gameplay = 7, tick = 41, state = "56".repeat(16)): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "world:locator",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1,
      world: 3,
      entities: 5,
      gameplay,
      persistence: 2,
      network: 4,
      simulation: 6,
    }),
    tick,
    stateHash: state,
  });
}

function gameplayIdentity(sequence: bigint, inventoryRevision: bigint, stateHash: string): RustIntegratedGameplayAuthorityIdentityV1 {
  return Object.freeze({
    universe: "world:locator",
    location: "surface",
    revision: Object.freeze({
      epoch: 1,
      sequence,
      inventory: inventoryRevision,
      machines: BigInt(3),
      combat: BigInt(4),
      progression: BigInt(5),
      cardforge: BigInt(6),
    }),
    stateHash,
  });
}

function hashBytes(value: string) {
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function outerReceiptHash(value: Omit<RustIntegratedRuntimeAcceptedReceiptV1, "receiptHash">) {
  const bytes = [
    ...hashBytes(value.commandHash),
    ...hashBytes(value.before.stateHash),
    ...hashBytes(value.after.stateHash),
    ...value.domainReceipts.flatMap((operation) => [...hashBytes(operation.payloadHash)]),
  ];
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes));
}

function acceptedReceipt(
  plan = planRustLiveLocatorItemConsumeV1(integratedIdentity(), "player:locator", request),
  overrides: Partial<RustIntegratedPlayerLocatorItemConsumeReceiptV1> = {},
) {
  const locator = Object.freeze({
    requestPayloadHash: plan.requestPayloadHash,
    purpose: "chart" as const,
    locatorResultHash: request.locatorResultHash,
    before: gameplayIdentity(BigInt(11), BigInt(20), "67".repeat(16)),
    after: gameplayIdentity(BigInt(12), BigInt(21), "78".repeat(16)),
    acceptedReceiptHash: "89".repeat(16),
    inventory,
    selectedSlot: 3,
    previousInventoryRevision: BigInt(9),
    resultingInventoryRevision: BigInt(10),
    consumedStack: Object.freeze({ ...expectedStack, count: 1 }),
    remainingStack: Object.freeze({ ...expectedStack, count: 1 }),
    inventoryResultHash: "9a".repeat(16),
    ...overrides,
  });
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "gameplay",
    typeId: RUST_INTEGRATED_PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_TYPE_V1,
    schema: 1,
    payload: encodeRustIntegratedPlayerLocatorItemConsumeReceiptV1(locator),
  });
  const source = Object.freeze({
    status: "accepted" as const,
    commandId: plan.batch.commandId,
    idempotencyKey: plan.batch.idempotencyKey,
    commandHash: plan.batch.commandHash,
    before: plan.batch.expected,
    after: integratedIdentity(8, 41, "ab".repeat(16)),
    domainReceipts: Object.freeze([operation]),
  });
  return Object.freeze({ plan, locator, receipt: Object.freeze({ ...source, receiptHash: outerReceiptHash(source) }) });
}

function playerView(remaining = true): RustLivePlayerViewR10 {
  return Object.freeze({
    extractionRevision: BigInt(3),
    authorityTick: BigInt(41),
    externalEntityId: "player:locator",
    actorId: "player:locator",
    playerId: BigInt(1),
    entityId: BigInt(2),
    entityRevision: BigInt(4),
    inventoryContainer: rustIntegratedContainerViewKeyV1(inventory),
    inventoryContainerRevision: BigInt(10),
    equipmentContainer: "container-key-v1/00",
    equipmentContainerRevision: BigInt(1),
    selectedSlot: 3,
    backSlot: null,
    lastInputSequence: BigInt(0),
    buttons: 0,
    authoritativeFlags: 0,
    lookYaw: null,
    lookPitch: 0,
    position: Object.freeze({ x: 0, y: 64, z: 0 }),
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    radius: 0.3,
    height: 1.8,
    mass: 1,
    grounded: true,
    crouching: false,
    contactFlags: 0,
    inLiquid: false,
    headSubmerged: false,
    drowningAccumulator: 0,
    fallDistance: 0,
    oxygenSeconds: 10,
    maximumOxygenSeconds: 10,
    health: 20,
    maximumHealth: 20,
    lastDamageTick: BigInt(0),
    combat: Object.freeze({
      domainRevision: BigInt(1), rowRevision: BigInt(1), recordId: "player:locator", ownerId: "player:locator", entityId: BigInt(2),
      vitalUnits: "millihearts-v1" as const, health: 20_000, maxHealth: 20_000, alive: true, crossDomainParity: true as const,
    }),
    effects: Object.freeze({
      schema: 1 as const, producer: "rust-bwau-v2" as const, playerExternalId: "player:locator", authorityTick: BigInt(41),
      total: 0, selected: 0, omitted: 0, firstSequence: null, lastSequence: null, contiguous: true, cues: Object.freeze([]),
    }),
    held: remaining ? Object.freeze({
      itemCode: expectedStack.itemCode,
      count: 1,
      durabilityMillionths: null,
      metadataHash: hashBytes(expectedStack.metadataHash),
    }) : null,
  });
}

test("BWV7/BWX7 round-trip exact locator evidence and one-unit custody", () => {
  const requestPacket = encodeRustIntegratedPlayerLocatorItemConsumeV1(request);
  assert.equal(Buffer.from(requestPacket.subarray(0, 4)).toString("ascii"), "BWV7");
  assert.deepEqual(decodeRustIntegratedPlayerLocatorItemConsumeV1(requestPacket), request);

  const { locator } = acceptedReceipt();
  const receiptPacket = encodeRustIntegratedPlayerLocatorItemConsumeReceiptV1(locator);
  assert.equal(Buffer.from(receiptPacket.subarray(0, 4)).toString("ascii"), "BWX7");
  assert.deepEqual(decodeRustIntegratedPlayerLocatorItemConsumeReceiptV1(receiptPacket), locator);

  for (const packet of [requestPacket, receiptPacket]) {
    assert.equal(new DataView(packet.buffer, packet.byteOffset).getUint16(4, true), 1);
    assert.equal(new DataView(packet.buffer, packet.byteOffset).getUint16(6, true), 1);
    const corrupted = Uint8Array.from(packet);
    corrupted[corrupted.length - 1] ^= 1;
    assert.throws(
      () => packet === requestPacket
        ? decodeRustIntegratedPlayerLocatorItemConsumeV1(corrupted)
        : decodeRustIntegratedPlayerLocatorItemConsumeReceiptV1(corrupted),
      /checksum/u,
    );
  }
});

test("locator plan freezes the gameplay command ABI and validates receipt plus immediate readback", () => {
  const { plan, receipt } = acceptedReceipt();
  assert.equal(plan.batch.actorId, "player:locator");
  assert.equal(plan.batch.operations.length, 1);
  assert.equal(plan.batch.operations[0].domain, "gameplay");
  assert.equal(plan.batch.operations[0].typeId, RUST_INTEGRATED_PLAYER_LOCATOR_ITEM_CONSUME_TYPE_V1);
  assert.equal(plan.batch.operations[0].schema, 1);
  assert.equal(plan.batch.commandId, `player-locator-item-consume:${plan.requestPayloadHash}`);
  assert.equal(plan.batch.idempotencyKey, plan.batch.commandId);
  assert.equal(plan.inventoryViewKey, rustIntegratedContainerViewKeyV1(inventory));
  const durable = serializeRustLiveLocatorItemConsumePlanV1(plan);
  const recoveredPlan = rehydrateRustLiveLocatorItemConsumePlanV1(durable);
  assert.deepEqual(recoveredPlan, plan);
  assert.equal(serializeRustLiveLocatorItemConsumePlanV1(recoveredPlan), durable);
  const tampered = JSON.parse(durable) as Record<string, unknown>;
  tampered.commandHash = "ff".repeat(16);
  assert.throws(
    () => rehydrateRustLiveLocatorItemConsumePlanV1(JSON.stringify(tampered)),
    /exact hashes/u,
  );
  const validated = validateRustLiveLocatorItemConsumeReceiptV1(plan, receipt);
  assert.equal(validated.outer.after.tick, validated.outer.before.tick, "locator debit is intentionally same-tick");
  assert.equal(validated.locator.consumedStack.count, 1);
  assert.equal(validated.remainingStack?.count, 1);
  const player = playerView();
  assert.equal(validateRustLiveLocatorItemConsumeAfterCommandV1(plan, validated, player), player);
});

test("locator validation rejects evidence drift, debit drift, outer drift, and stale player rows", () => {
  const baseline = acceptedReceipt();
  for (const overrides of [
    { locatorResultHash: "ff".repeat(16) },
    { consumedStack: Object.freeze({ ...expectedStack, count: 2 }) },
    { remainingStack: null },
    { resultingInventoryRevision: BigInt(11) },
  ] satisfies Array<Partial<RustIntegratedPlayerLocatorItemConsumeReceiptV1>>) {
    const forged = acceptedReceipt(baseline.plan, overrides);
    assert.throws(
      () => validateRustLiveLocatorItemConsumeReceiptV1(forged.plan, forged.receipt),
      /exact locator-bound one-unit debit/u,
    );
  }

  const moved = acceptedReceipt();
  const source = Object.freeze({
    ...moved.receipt,
    after: integratedIdentity(8, 42, "bc".repeat(16)),
  });
  const movedReceipt = Object.freeze({ ...source, receiptHash: outerReceiptHash(source) });
  assert.throws(
    () => validateRustLiveLocatorItemConsumeReceiptV1(moved.plan, movedReceipt),
    /same-tick gameplay mutation/u,
  );

  const validated = validateRustLiveLocatorItemConsumeReceiptV1(baseline.plan, baseline.receipt);
  assert.throws(
    () => validateRustLiveLocatorItemConsumeAfterCommandV1(
      baseline.plan,
      validated,
      Object.freeze({ ...playerView(), inventoryContainerRevision: BigInt(9) }),
    ),
    /post-command player row/u,
  );
  assert.throws(
    () => validateRustLiveLocatorItemConsumeAfterCommandV1(baseline.plan, validated, playerView(false)),
    /post-command player row/u,
  );
});

test("locator request rejects unowned containers, invalid purpose, and nonpositive stacks", () => {
  assert.throws(
    () => encodeRustIntegratedPlayerLocatorItemConsumeV1({ ...request, inventory: { ...inventory, ownerId: null } }),
    /owned player inventory/u,
  );
  assert.throws(
    () => encodeRustIntegratedPlayerLocatorItemConsumeV1({ ...request, purpose: "wrong" as "chart" }),
    /purpose/u,
  );
  assert.throws(
    () => encodeRustIntegratedPlayerLocatorItemConsumeV1({ ...request, expectedStack: { ...expectedStack, count: 0 } }),
    /consumable/u,
  );
  assert.throws(
    () => planRustLiveLocatorItemConsumeV1(integratedIdentity(), "player:other", request),
    /owner does not match/u,
  );
});
