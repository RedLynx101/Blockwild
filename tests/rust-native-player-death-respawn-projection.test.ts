import assert from "node:assert/strict";
import test from "node:test";
import { Item, type InventorySlot } from "../app/game/data.ts";
import {
  planRustNativePlayerDeathRespawnBrowserProjectionV1,
  RustNativePlayerDeathRespawnBrowserProjectionErrorV1,
} from "../app/game/rust-native-player-death-respawn-projection.ts";
import type {
  RustDroppedHotTransformFrameR10,
  RustDroppedHotTransformR10,
} from "../app/game/rust-authoritative-extraction-r10.ts";
import type {
  RustLivePlayerDeathDropR10,
  RustLivePlayerDeathRespawnR10,
} from "../app/game/rust-live-player-view-r10.ts";

const HASH_A = "11".repeat(16);
const HASH_B = "22".repeat(16);
const HASH_C = "33".repeat(16);
const INVENTORY_CONTAINER = "container-key-v1/aa";
const EQUIPMENT_CONTAINER = "container-key-v1/bb";

function transform(overrides: Partial<RustDroppedHotTransformR10> = {}): RustDroppedHotTransformR10 {
  return Object.freeze({
    schema: 1,
    dropId: "existing-drop",
    entityId: BigInt(100),
    entityRevision: BigInt(1),
    rowRevision: BigInt(1),
    custodyContainer: "container-key-v1/cc",
    custodySlot: 0,
    boundContainerRevision: BigInt(0),
    itemCode: Item.Berry,
    count: 1,
    durabilityMillionths: null,
    metadataHash: Uint8Array.from({ length: 16 }, () => 0),
    position: Object.freeze({ x: 1, y: 2, z: 3 }),
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    rotationMicroturns: Object.freeze({ yaw: 0, pitch: 0, roll: 0 }),
    yawRadians: 0,
    createdTick: BigInt(1),
    ageTicks: BigInt(9),
    expiresTick: null,
    pickupLockActorId: null,
    ...overrides,
  });
}

function child(overrides: Partial<RustLivePlayerDeathDropR10> = {}): RustLivePlayerDeathDropR10 {
  return Object.freeze({
    parentRespawnSequence: BigInt(1),
    parentReceiptHash: HASH_A,
    sourceLane: "inventory",
    sourceSlot: 0,
    stack: Object.freeze({
      itemCode: Item.Berry,
      count: 3,
      durabilityMillionths: null,
      metadataHash: "0".repeat(32),
    }),
    dropId: "player-death-drop-v1:7:3:0:0",
    entityId: BigInt(200),
    custodyContainer: "container-key-v1/dd",
    custodySlot: 0,
    custodyRevision: BigInt(0),
    spatialRevision: BigInt(1),
    position: Object.freeze({ xMilli: 4_000, yMilli: 5_000, zMilli: 6_000 }),
    velocityMilliPerSecond: Object.freeze({ xMilli: 0, yMilli: 0, zMilli: 0 }),
    rotation: Object.freeze({ yaw: 0, pitch: 0, roll: 0 }),
    createdTick: BigInt(9),
    expiresTick: null,
    pickupLockActorId: null,
    pickupUnlockTick: BigInt(29),
    originHash: HASH_B,
    content: Object.freeze({
      configuredManifestHash: HASH_A,
      installedManifestHash: HASH_A,
      installedRegistryHash: HASH_B,
      itemContentHash: HASH_C,
      itemContentVersion: 1,
    }),
    r6Linked: true,
    ...overrides,
  });
}

function receipt(overrides: Partial<RustLivePlayerDeathRespawnR10> = {}): RustLivePlayerDeathRespawnR10 {
  const drops = overrides.drops ?? Object.freeze([child()]);
  return Object.freeze({
    respawnSequence: BigInt(1),
    receiptHash: HASH_A,
    generatedDropCount: drops.length,
    playerId: BigInt(7),
    entityId: BigInt(9),
    deathSequence: BigInt(3),
    inventoryContainer: INVENTORY_CONTAINER,
    inventoryBeforeRevision: BigInt(4),
    inventoryAfterRevision: BigInt(5),
    equipmentContainer: EQUIPMENT_CONTAINER,
    equipmentBeforeRevision: BigInt(2),
    equipmentAfterRevision: BigInt(2),
    custodyAfterHash: HASH_C,
    drops,
    ...overrides,
  });
}

function frame(
  transforms: readonly RustDroppedHotTransformR10[],
  authorityTick = BigInt(10),
): RustDroppedHotTransformFrameR10 {
  return Object.freeze({
    schema: 1,
    source: Object.freeze({
      identity: Object.freeze({
        universeId: "universe:test",
        locationId: "surface",
        revision: Object.freeze({ epoch: 0, world: 0, entities: 2, gameplay: 2, persistence: 0, network: 0, simulation: 1 }),
        tick: Number(authorityTick),
        stateHash: HASH_A,
      }),
      extractionRevision: BigInt(2),
      authorityTick,
      inventoryDomainRevision: BigInt(2),
      extractionHash: HASH_B,
    }),
    transforms: Object.freeze([...transforms]),
  });
}

function deathTransform(overrides: Partial<RustDroppedHotTransformR10> = {}) {
  return transform({
    dropId: child().dropId,
    entityId: child().entityId,
    entityRevision: BigInt(2),
    rowRevision: BigInt(2),
    custodyContainer: child().custodyContainer,
    itemCode: Item.Berry,
    count: 3,
    position: Object.freeze({ x: 4.1, y: 5, z: 6 }),
    velocity: Object.freeze({ x: 0.1, y: 0, z: 0 }),
    createdTick: BigInt(9),
    ageTicks: BigInt(1),
    ...overrides,
  });
}

function invoke(overrides: Partial<Parameters<typeof planRustNativePlayerDeathRespawnBrowserProjectionV1>[0]> = {}) {
  const inventory = Array.from({ length: 9 }, (_, index): InventorySlot | null =>
    index === 0 ? { item: Item.Berry, count: 3 } : null);
  return planRustNativePlayerDeathRespawnBrowserProjectionV1({
    receipt: receipt(),
    hotFrame: frame([transform(), deathTransform()]),
    cursorBefore: 0,
    expectedPlayerId: BigInt(7),
    expectedEntityId: BigInt(9),
    expectedInventoryContainer: INVENTORY_CONTAINER,
    expectedEquipmentContainer: EQUIPMENT_CONTAINER,
    priorInventoryRevision: BigInt(4),
    priorEquipmentRevision: BigInt(2),
    successorInventoryRevision: BigInt(5),
    successorEquipmentRevision: BigInt(2),
    compatibilityInventory: Object.freeze(inventory),
    compatibilityEquipment: Object.freeze(Array.from({ length: 8 }, () => null)),
    existingRustEntityIds: new Set(["100"]),
    mode: "survival",
    ...overrides,
  });
}

test("death-respawn projection binds exact cursor, source custody, and descendant hot drops", () => {
  const plan = invoke();
  assert.equal(plan.cursorBefore, 0);
  assert.equal(plan.cursorAfter, 1);
  assert.equal(plan.inventory.cleared.length, 1);
  assert.equal(plan.equipment.cleared.length, 0);
  assert.deepEqual(plan.drops[0], {
    sourceLane: "inventory",
    sourceSlot: 0,
    dropId: child().dropId,
    rustEntityId: "200",
    item: Item.Berry,
    count: 3,
    position: { x: 4.1, y: 5, z: 6 },
    velocity: { x: 0.1, y: 0, z: 0 },
    rotationY: 0,
    pickupDelay: 0.95,
    createdTick: BigInt(9),
    pickupUnlockTick: BigInt(29),
    expiresTick: null,
    originHash: HASH_B,
  });
});

test("empty false-policy parent advances its durable cursor without inventing custody changes", () => {
  const empty = receipt({
    respawnSequence: BigInt(2),
    receiptHash: HASH_B,
    generatedDropCount: 0,
    drops: Object.freeze([]),
    inventoryBeforeRevision: BigInt(5),
    inventoryAfterRevision: BigInt(5),
  });
  const plan = invoke({
    receipt: empty,
    cursorBefore: 1,
    hotFrame: frame([transform()]),
    priorInventoryRevision: BigInt(5),
    successorInventoryRevision: BigInt(5),
    compatibilityInventory: Object.freeze(Array.from({ length: 9 }, () => null)),
  });
  assert.equal(plan.cursorAfter, 2);
  assert.deepEqual(plan.inventory.cleared, []);
  assert.deepEqual(plan.drops, []);
});

test("age-zero creation requires the immutable fixed-point child transform, later rows may move natively", () => {
  const creation = deathTransform({
    rowRevision: BigInt(9_999),
    position: Object.freeze({ x: 4, y: 5, z: 6 }),
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    ageTicks: BigInt(0),
  });
  assert.throws(
    () => invoke({
      hotFrame: frame([transform(), Object.freeze({
        ...creation,
        position: Object.freeze({ x: 4.001, y: 5, z: 6 }),
      })], BigInt(9)),
    }),
    /creation transform differs/u,
  );
  assert.equal(invoke({ hotFrame: frame([transform(), creation], BigInt(9)) }).drops.length, 1);
  assert.equal(invoke({
    hotFrame: frame([transform(), deathTransform({ rowRevision: child().spatialRevision })]),
  }).drops.length, 1, "a semantic row hash does not turn a positive-age descendant back into creation");

  const fractionalChild = child({
    position: Object.freeze({ xMilli: 4_100, yMilli: 5_200, zMilli: 6_300 }),
    velocityMilliPerSecond: Object.freeze({ xMilli: 100, yMilli: -200, zMilli: 300 }),
  });
  const fractionalTransform = deathTransform({
    rowRevision: BigInt(9_999),
    position: Object.freeze({
      x: 4.1,
      y: 5.2,
      z: 6.3,
    }),
    velocity: Object.freeze({
      x: 0.1,
      y: -0.2,
      z: 0.3,
    }),
    ageTicks: BigInt(0),
  });
  assert.equal(invoke({
    receipt: receipt({ drops: Object.freeze([fractionalChild]) }),
    hotFrame: frame([transform(), fractionalTransform], BigInt(9)),
  }).drops.length, 1, "creation joins compare the canonical fixed-point values carried by BWX0");
  assert.throws(() => invoke({
    receipt: receipt({ drops: Object.freeze([fractionalChild]) }),
    hotFrame: frame([transform(), Object.freeze({
      ...fractionalTransform,
      position: Object.freeze({
        x: Math.fround(4.1),
        y: Math.fround(5.2),
        z: Math.fround(6.3),
      }),
    })], BigInt(9)),
  }), /creation transform differs/u, "a lossy f32 reconstruction is not the canonical BWX0 creation transform");
});

test("death-respawn projection rejects stale cursors, custody drift, and unsupported source stacks", () => {
  const invalid: Array<readonly [Partial<Parameters<typeof planRustNativePlayerDeathRespawnBrowserProjectionV1>[0]>, RegExp]> = [
    [{ cursorBefore: 1 }, /exact next/u],
    [{ mode: "builder" }, /Survival-only/u],
    [{ expectedPlayerId: BigInt(8) }, /active player/u],
    [{ expectedInventoryContainer: "container-key-v1/cc" }, /active player/u],
    [{ expectedEquipmentContainer: "container-key-v1/dd" }, /active player/u],
    [{ priorInventoryRevision: BigInt(3) }, /custody revisions/u],
    [{ compatibilityInventory: Object.freeze(Array.from({ length: 9 }, () => null)) }, /no compatibility source/u],
    [{ hotFrame: frame([transform()]) }, /no same-envelope/u],
    [{ hotFrame: frame([transform(), deathTransform(), transform({ entityId: BigInt(300), dropId: "unexpected" })]) }, /unaccounted/u],
    [{ existingRustEntityIds: new Set(["100", "200"]) }, /reuses a browser/u],
    [{ receipt: receipt({ drops: Object.freeze([child({ r6Linked: false })]) }) }, /live R6/u],
    [{ receipt: receipt({ drops: Object.freeze([child({ stack: Object.freeze({ ...child().stack, metadataHash: HASH_A }) })]) }) }, /metadata/u],
    [{
      receipt: receipt({
        drops: Object.freeze([
          child(),
          child({
            dropId: `${child().dropId}:duplicate-slot`,
            entityId: BigInt(201),
            custodyContainer: `${child().custodyContainer}:duplicate-slot`,
          }),
        ]),
      }),
      hotFrame: frame([
        transform(),
        deathTransform(),
        deathTransform({
          dropId: `${child().dropId}:duplicate-slot`,
          entityId: BigInt(201),
          custodyContainer: `${child().custodyContainer}:duplicate-slot`,
        }),
      ]),
    }, /reuse a source slot/u],
  ];
  for (const [overrides, expected] of invalid) {
    assert.throws(
      () => invoke(overrides),
      (error: unknown) => error instanceof RustNativePlayerDeathRespawnBrowserProjectionErrorV1
        && expected.test(error.message),
    );
  }
});

test("equipment releases use the independent eight-slot lane and revision", () => {
  const equipmentChild = child({
    sourceLane: "equipment",
    sourceSlot: 7,
    stack: Object.freeze({ ...child().stack, count: 1 }),
  });
  const equipmentReceipt = receipt({
    drops: Object.freeze([equipmentChild]),
    inventoryAfterRevision: BigInt(4),
    equipmentAfterRevision: BigInt(3),
  });
  const equipment = Array.from({ length: 8 }, (_, index): InventorySlot | null =>
    index === 7 ? { item: Item.Berry, count: 1 } : null);
  const plan = invoke({
    receipt: equipmentReceipt,
    hotFrame: frame([transform(), deathTransform({
      dropId: equipmentChild.dropId,
      entityId: equipmentChild.entityId,
      itemCode: Item.Berry,
      count: 1,
    })]),
    successorInventoryRevision: BigInt(4),
    successorEquipmentRevision: BigInt(3),
    compatibilityInventory: Object.freeze(Array.from({ length: 9 }, () => null)),
    compatibilityEquipment: Object.freeze(equipment),
  });
  assert.equal(plan.inventory.cleared.length, 0);
  assert.deepEqual(plan.equipment.cleared.map((entry) => entry.slot), [7]);
});
