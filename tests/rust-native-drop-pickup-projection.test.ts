import assert from "node:assert/strict";
import test from "node:test";
import { BlockId } from "../app/game/data.ts";
import {
  rustIntegratedRuntimeDropPickupReceiptHashV1,
  type RustIntegratedRuntimeDropPickupProjectionV1,
} from "../app/game/rust-integrated-runtime-drop-pickup.ts";
import {
  planRustNativeDropPickupBrowserProjectionV1,
} from "../app/game/rust-native-drop-pickup-projection.ts";
import { rustIntegratedContainerViewKeyV1 } from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import type {
  RustLivePlayerDeathDropR10,
  RustLivePlayerDeathRespawnR10,
} from "../app/game/rust-live-player-view-r10.ts";

const hash = (digit: string) => digit.repeat(32);
const inventoryContainer = Object.freeze({
  kind: "player" as const,
  id: "actor:noah",
  ownerId: "actor:noah",
});
const plainDirt = (count: number) => Object.freeze({
  itemCode: BlockId.Dirt,
  count,
  durabilityMillionths: null,
  metadataHash: hash("0"),
});

function receipt(overrides: Readonly<{
  sequence?: number;
  sourceCount?: number;
  split?: boolean;
}> = {}): RustIntegratedRuntimeDropPickupProjectionV1 {
  const sourceCount = overrides.sourceCount ?? 1;
  const split = overrides.split ?? false;
  const beforeGameplay = Object.freeze({
    epoch: 1,
    sequence: BigInt(30),
    inventory: BigInt(31),
    machines: BigInt(32),
    combat: BigInt(33),
    progression: BigInt(34),
    cardforge: BigInt(35),
  });
  const beforeWorldView = Object.freeze({
    epoch: 1,
    sequence: BigInt(40),
    clock: BigInt(41),
    machineAnchors: BigInt(42),
    droppedItems: BigInt(43),
    playerBindings: BigInt(44),
    environment: BigInt(45),
    atmosphereGravity: BigInt(46),
    celestial: BigInt(47),
  });
  const affectedSlots = split
    ? Object.freeze([
      Object.freeze({ slot: 0, beforeStack: plainDirt(60), afterStack: plainDirt(64) }),
      Object.freeze({ slot: 1, beforeStack: null, afterStack: plainDirt(sourceCount - 4) }),
    ])
    : Object.freeze([
      Object.freeze({ slot: 0, beforeStack: null, afterStack: plainDirt(sourceCount) }),
    ]);
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: hash("1"),
    installedRegistryHash: hash("2"),
    catalogBlobHash: hash("3"),
    actionReportHash: hash("4"),
    rngSemanticsHash: hash("5"),
    blockActionSequence: BigInt(8),
    originInputSequence: 7,
    blockId: BlockId.Dirt,
    position: Object.freeze({ x: 1, y: 35, z: -3 }),
    lootPlanHash: hash("6"),
    groupOrdinal: 0,
  });
  const base = Object.freeze({
    schema: 1 as const,
    sequence: overrides.sequence ?? 1,
    completionTick: 20,
    world: Object.freeze({
      universeId: "universe-drop-pickup",
      locationId: "surface",
      revision: Object.freeze({ epoch: 1, mutation: 9, residency: 3 }),
      canonicalStateHash: hash("7"),
    }),
    player: Object.freeze({
      playerId: BigInt(101),
      entityId: BigInt(102),
      inventoryContainer,
      beforeRevision: BigInt(10),
      afterRevision: BigInt(10 + affectedSlots.length),
      affectedSlots,
    }),
    generatedDrop: Object.freeze({
      dropId: "block-loot-v1:8:0",
      entityId: BigInt(103),
      origin: Object.freeze({ kind: "generated-block-action" as const, provenance }),
      stack: plainDirt(sourceCount),
      custodyContainer: Object.freeze({
        kind: "container" as const,
        id: "block-loot-custody-v1:8:0",
        ownerId: null,
      }),
      custodySlot: 0,
      custodyBeforeRevision: BigInt(20),
      custodyEmptiedRevision: BigInt(20 + affectedSlots.length),
      spatialRevision: BigInt(22),
      position: Object.freeze({ xMilli: BigInt(1_100), yMilli: BigInt(35_350), zMilli: BigInt(-2_900) }),
      velocityMilliPerSecond: Object.freeze({ xMilli: BigInt(0), yMilli: BigInt(1_250), zMilli: BigInt(0) }),
      rotation: Object.freeze({ yaw: 10, pitch: 20, roll: 30 }),
    }),
    removal: Object.freeze({
      gameplay: Object.freeze({
        before: Object.freeze({ revision: beforeGameplay, canonicalStateHash: hash("8") }),
        after: Object.freeze({
          revision: Object.freeze({
            ...beforeGameplay,
            sequence: beforeGameplay.sequence + BigInt(1),
            inventory: beforeGameplay.inventory + BigInt(1),
          }),
          canonicalStateHash: hash("9"),
        }),
      }),
      entity: Object.freeze({
        before: Object.freeze({ revision: BigInt(50), canonicalStateHash: hash("a") }),
        after: Object.freeze({ revision: BigInt(51), canonicalStateHash: hash("b") }),
      }),
      worldView: Object.freeze({
        before: Object.freeze({ revision: beforeWorldView, canonicalStateHash: hash("c") }),
        after: Object.freeze({
          revision: Object.freeze({
            ...beforeWorldView,
            sequence: beforeWorldView.sequence + BigInt(1),
            droppedItems: beforeWorldView.droppedItems + BigInt(1),
          }),
          canonicalStateHash: hash("d"),
        }),
      }),
    }),
    receiptHash: hash("e"),
  });
  return Object.freeze({ ...base, receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(base) });
}

function planInput(pickup = receipt()) {
  return {
    receipt: pickup,
    cursorBefore: pickup.sequence - 1,
    expectedUniverseId: "universe-drop-pickup",
    expectedLocationId: "surface",
    expectedPlayerId: BigInt(101),
    expectedPlayerEntityId: BigInt(102),
    expectedInventoryContainer: inventoryContainer,
    compatibilityInventory: Object.freeze([
      null, null, null, null, null, null, null, null, null,
    ]),
    compatibilityDrops: Object.freeze([
      Object.freeze({ rustEntityId: "103", item: BlockId.Dirt, count: pickup.generatedDrop.stack.count }),
    ]),
  } as const;
}

function deathPickupFixture(): Readonly<{
  pickup: RustIntegratedRuntimeDropPickupProjectionV1;
  parent: RustLivePlayerDeathRespawnR10;
}> {
  const generated = receipt();
  const respawnSequence = BigInt(7);
  const respawnReceiptHash = hash("f");
  const playerId = BigInt(201);
  const deathSequence = BigInt(3);
  const sourceLane = "inventory" as const;
  const sourceSlot = 0;
  const laneTag = 0;
  const custodyContainer = Object.freeze({
    kind: "container" as const,
    id: `player-death-custody-v1:${playerId}:${deathSequence}:${sourceLane}:${sourceSlot}`,
    ownerId: null,
  });
  const child: RustLivePlayerDeathDropR10 = Object.freeze({
    parentRespawnSequence: respawnSequence,
    parentReceiptHash: respawnReceiptHash,
    sourceLane,
    sourceSlot,
    stack: plainDirt(1),
    dropId: `player-death-drop-v1:${playerId}:${deathSequence}:${laneTag}:${sourceSlot}`,
    entityId: BigInt(103),
    custodyContainer: rustIntegratedContainerViewKeyV1(custodyContainer),
    custodySlot: 0,
    custodyRevision: BigInt(0),
    spatialRevision: BigInt(0),
    position: Object.freeze({ xMilli: 1_100, yMilli: 35_350, zMilli: -2_900 }),
    velocityMilliPerSecond: Object.freeze({ xMilli: 0, yMilli: 1_250, zMilli: 0 }),
    rotation: Object.freeze({ yaw: 10, pitch: 20, roll: 30 }),
    createdTick: BigInt(18),
    expiresTick: null,
    pickupLockActorId: null,
    pickupUnlockTick: BigInt(38),
    originHash: hash("1"),
    content: Object.freeze({
      configuredManifestHash: hash("2"),
      installedManifestHash: hash("2"),
      installedRegistryHash: hash("3"),
      itemContentHash: hash("4"),
      itemContentVersion: 1,
    }),
    r6Linked: false,
  });
  const parent: RustLivePlayerDeathRespawnR10 = Object.freeze({
    respawnSequence,
    receiptHash: respawnReceiptHash,
    generatedDropCount: 1,
    playerId,
    entityId: BigInt(202),
    deathSequence,
    inventoryContainer: "container-key-v1/01",
    inventoryBeforeRevision: BigInt(10),
    inventoryAfterRevision: BigInt(11),
    equipmentContainer: "container-key-v1/02",
    equipmentBeforeRevision: BigInt(20),
    equipmentAfterRevision: BigInt(20),
    custodyAfterHash: hash("5"),
    drops: Object.freeze([child]),
  });
  const base = Object.freeze({
    ...generated,
    generatedDrop: Object.freeze({
      ...generated.generatedDrop,
      dropId: child.dropId,
      origin: Object.freeze({
        kind: "player-death-drop" as const,
        respawnSequence: Number(respawnSequence),
        respawnReceiptHash,
        sourceLane,
        sourceSlot,
      }),
      custodyContainer,
      custodyBeforeRevision: BigInt(0),
      custodyEmptiedRevision: BigInt(1),
      spatialRevision: BigInt(0),
    }),
  });
  const pickup = Object.freeze({
    ...base,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(base),
  });
  return Object.freeze({ pickup, parent });
}

function parentWithChild(
  parent: RustLivePlayerDeathRespawnR10,
  patch: Partial<RustLivePlayerDeathDropR10>,
) {
  return Object.freeze({
    ...parent,
    drops: Object.freeze([Object.freeze({ ...parent.drops[0]!, ...patch })]),
  });
}

test("native pickup planner binds one exact drop, inventory delta, and receipt cursor", () => {
  const pickup = receipt();
  const plan = planRustNativeDropPickupBrowserProjectionV1(planInput(pickup));
  assert.deepEqual(plan.affectedSlots, [{
    slot: 0,
    before: null,
    after: { item: BlockId.Dirt, count: 1 },
  }]);
  assert.equal(plan.cursorBefore, 0);
  assert.equal(plan.cursorAfter, 1);
  assert.equal(plan.rustEntityId, "103");
  assert.deepEqual(plan.sourceStack, { item: BlockId.Dirt, count: 1 });
  assert.equal(plan.inventoryBeforeRevision, BigInt(10));
  assert.equal(plan.inventoryAfterRevision, BigInt(11));
  assert.equal(plan.receiptHash, pickup.receiptHash);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.affectedSlots), true);
});

test("native pickup planner preserves an exact multi-slot stack split", () => {
  const pickup = receipt({ sourceCount: 6, split: true });
  const input = planInput(pickup);
  const plan = planRustNativeDropPickupBrowserProjectionV1({
    ...input,
    compatibilityInventory: Object.freeze([
      Object.freeze({ item: BlockId.Dirt, count: 60 }),
      null, null, null, null, null, null, null, null,
    ]),
  });
  assert.deepEqual(plan.affectedSlots, [
    { slot: 0, before: { item: BlockId.Dirt, count: 60 }, after: { item: BlockId.Dirt, count: 64 } },
    { slot: 1, before: null, after: { item: BlockId.Dirt, count: 2 } },
  ]);
  assert.equal(plan.inventoryAfterRevision, BigInt(12));
});

test("native pickup planner accepts an exactly validated player-drop origin", () => {
  const generated = receipt();
  const playerOriginBase = Object.freeze({
    ...generated,
    generatedDrop: Object.freeze({
      ...generated.generatedDrop,
      origin: Object.freeze({
        kind: "player-drop" as const,
        playerDropSequence: 7,
        playerDropReceiptHash: hash("f"),
      }),
    }),
  });
  const playerOrigin = Object.freeze({
    ...playerOriginBase,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(playerOriginBase),
  });
  const plan = planRustNativeDropPickupBrowserProjectionV1(planInput(playerOrigin));
  assert.deepEqual(plan.sourceOrigin, {
    kind: "player-drop",
    playerDropSequence: 7,
    playerDropReceiptHash: hash("f"),
  });
});

test("native pickup planner joins tag-2 origin to one exact retained death-drop child", () => {
  const { pickup, parent } = deathPickupFixture();
  const plan = planRustNativeDropPickupBrowserProjectionV1({
    ...planInput(pickup),
    retainedDeathRespawn: parent,
  });
  assert.deepEqual(plan.sourceOrigin, {
    kind: "player-death-drop",
    respawnSequence: 7,
    respawnReceiptHash: hash("f"),
    sourceLane: "inventory",
    sourceSlot: 0,
  });
  assert.equal(plan.rustEntityId, "103");
  assert.deepEqual(plan.sourceStack, { item: BlockId.Dirt, count: 1 });
});

test("native pickup planner rejects orphan, lane, slot, and parent-hash death origins", () => {
  const { pickup, parent } = deathPickupFixture();
  const input = planInput(pickup);
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1(input), /no explicitly retained/u);
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...input,
    retainedDeathRespawn: null,
  }), /no explicitly retained/u);

  for (const originPatch of [
    { sourceLane: "equipment" as const },
    { sourceSlot: 1 },
  ]) {
    const driftBase = Object.freeze({
      ...pickup,
      generatedDrop: Object.freeze({
        ...pickup.generatedDrop,
        origin: Object.freeze({ ...pickup.generatedDrop.origin!, ...originPatch }),
      }),
    });
    const drift = Object.freeze({
      ...driftBase,
      receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(driftBase),
    });
    assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
      ...planInput(drift),
      retainedDeathRespawn: parent,
    }), /exactly one retained parent child/u);
  }

  const hashDriftBase = Object.freeze({
    ...pickup,
    generatedDrop: Object.freeze({
      ...pickup.generatedDrop,
      origin: Object.freeze({ ...pickup.generatedDrop.origin!, respawnReceiptHash: hash("e") }),
    }),
  });
  const hashDrift = Object.freeze({
    ...hashDriftBase,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(hashDriftBase),
  });
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...planInput(hashDrift),
    retainedDeathRespawn: parent,
  }), /differs from its retained death-respawn parent/u);
});

test("native pickup planner rejects exact retained death-drop child drift", () => {
  const { pickup, parent } = deathPickupFixture();
  const child = parent.drops[0]!;
  const drifts: readonly Partial<RustLivePlayerDeathDropR10>[] = [
    { parentReceiptHash: hash("e") },
    { entityId: BigInt(999) },
    { dropId: `${child.dropId}:drift` },
    { stack: Object.freeze({ ...child.stack, count: 2 }) },
    { custodyContainer: "container-key-v1/deadbeef" },
    { custodyRevision: BigInt(1) },
    { originHash: hash("0") },
    { content: Object.freeze({ ...child.content, installedManifestHash: hash("6") }) },
  ];
  for (const patch of drifts) {
    assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
      ...planInput(pickup),
      retainedDeathRespawn: parentWithChild(parent, patch),
    }), /child|custody|content|origin|provenance/u);
  }
});

test("native pickup planner rejects retained death-respawn parent drift", () => {
  const { pickup, parent } = deathPickupFixture();
  const drifts: readonly Partial<RustLivePlayerDeathRespawnR10>[] = [
    { respawnSequence: BigInt(8) },
    { receiptHash: hash("e") },
    { generatedDropCount: 2 },
    { inventoryAfterRevision: BigInt(10) },
    { custodyAfterHash: hash("0") },
  ];
  for (const patch of drifts) {
    assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
      ...planInput(pickup),
      retainedDeathRespawn: Object.freeze({ ...parent, ...patch }),
    }), /parent|custody|shape|differs/u);
  }
});

test("native pickup planner rejects cursor, world, player, container, and browser-before drift", () => {
  const input = planInput();
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({ ...input, cursorBefore: 1 }), /cursor/u);
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...input,
    expectedUniverseId: "other",
  }), /different runtime world/u);
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...input,
    expectedPlayerId: BigInt(999),
  }), /different player/u);
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...input,
    expectedInventoryContainer: Object.freeze({ ...inventoryContainer, id: "actor:other" }),
  }), /different player/u);
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...input,
    compatibilityInventory: Object.freeze([
      Object.freeze({ item: BlockId.Dirt, count: 1 }),
      null, null, null, null, null, null, null, null,
    ]),
  }), /before state/u);
});

test("native pickup planner rejects missing, duplicate, mismatched, or lossy compatibility drops", () => {
  const input = planInput();
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...input,
    compatibilityDrops: Object.freeze([]),
  }), /exactly one matching/u);
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...input,
    compatibilityDrops: Object.freeze([
      input.compatibilityDrops[0]!,
      input.compatibilityDrops[0]!,
    ]),
  }), /exactly one matching/u);
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...input,
    compatibilityDrops: Object.freeze([
      Object.freeze({ rustEntityId: "103", item: BlockId.Dirt, count: 2 }),
    ]),
  }), /exactly one matching/u);
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...input,
    compatibilityDrops: Object.freeze([
      Object.freeze({ rustEntityId: "103", item: BlockId.Dirt, count: 1, metadata: { synthetic: true } }),
    ]),
  }), /exactly one matching/u);
});

test("native pickup planner propagates protocol conservation and representation failures", () => {
  const pickup = receipt();
  const nonconservingBase = Object.freeze({
    ...pickup,
    player: Object.freeze({
      ...pickup.player,
      affectedSlots: Object.freeze([
        Object.freeze({ slot: 0, beforeStack: null, afterStack: plainDirt(2) }),
      ]),
    }),
    receiptHash: hash("e"),
  });
  const nonconserving = Object.freeze({
    ...nonconservingBase,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(nonconservingBase),
  });
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...planInput(pickup),
    receipt: nonconserving,
  }), /conserve/u);

  const lossyStack = Object.freeze({ ...pickup.generatedDrop.stack, metadataHash: hash("f") });
  const lossyBase = Object.freeze({
    ...pickup,
    player: Object.freeze({
      ...pickup.player,
      affectedSlots: Object.freeze([
        Object.freeze({ slot: 0, beforeStack: null, afterStack: lossyStack }),
      ]),
    }),
    generatedDrop: Object.freeze({ ...pickup.generatedDrop, stack: lossyStack }),
    receiptHash: hash("e"),
  });
  const lossy = Object.freeze({
    ...lossyBase,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(lossyBase),
  });
  assert.throws(() => planRustNativeDropPickupBrowserProjectionV1({
    ...planInput(pickup),
    receipt: lossy,
  }), /metadata/u);
});
