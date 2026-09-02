import assert from "node:assert/strict";
import test from "node:test";
import {
  BLOCK_ITEM_ALIASES,
  BLOCKS,
  ITEMS,
  BlockId,
  Item,
  type ItemCode,
} from "../app/game/data.ts";
import {
  rustIntegratedRuntimeBasicDirtExpectedDropTransformV1,
} from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2,
  rustIntegratedRuntimeNativeBlockEditContentSubsetHashV1,
  rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2,
  rustIntegratedRuntimeNativeBlockEditReceiptHashV1,
  type RustIntegratedRuntimeNativeBlockEditContentBindingV1,
  type RustIntegratedRuntimeNativeBlockEditReceiptV1,
} from "../app/game/rust-integrated-runtime-native-block-edit.ts";
import type { RustIntegratedRuntimeIdentityV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  planRustNativeBlockEditBrowserProjectionV1,
} from "../app/game/rust-native-block-edit-browser-projection.ts";

const hash = (digit: string) => digit.repeat(32);
const container = Object.freeze({ kind: "player" as const, id: "actor:noah", ownerId: "actor:noah" });
const queryIdentity: RustIntegratedRuntimeIdentityV1 = Object.freeze({
  universeId: "universe:noah",
  locationId: "surface",
  revision: Object.freeze({
    epoch: 1,
    world: 2,
    entities: 3,
    gameplay: 4,
    persistence: 5,
    network: 6,
    simulation: 7,
  }),
  tick: 100,
  stateHash: hash("a"),
});
const legacyProjection = Object.freeze({
  protocolVersion: 1 as const,
  legacyFallback: "v1-capability" as const,
  queryIdentity,
  dirty: null,
});
const plainStack = (itemCode: number, count: number) => Object.freeze({
  itemCode,
  count,
  durabilityMillionths: null,
  metadataHash: hash("0"),
});

function content(blockId: number): RustIntegratedRuntimeNativeBlockEditContentBindingV1 {
  const base = Object.freeze({
    blockId,
    manifestHash: hash("1"),
    installedRegistryHash: hash("2"),
    catalogSchemaVersion: 1,
    catalogContentVersion: 7,
    catalogBlobHash: hash("3"),
    actionReportHash: hash("4"),
    subsetHash: hash("f"),
  });
  return Object.freeze({
    ...base,
    subsetHash: rustIntegratedRuntimeNativeBlockEditContentSubsetHashV1(base),
  });
}

function seal(
  source: Omit<RustIntegratedRuntimeNativeBlockEditReceiptV1, "receiptHash">,
): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  const pending = Object.freeze({ ...source, receiptHash: hash("f") });
  return Object.freeze({
    ...pending,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(pending),
  });
}

function placeShelfReceipt(
  facing = 2,
  mode: "survival" | "builder" = "survival",
): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  const stack = plainStack(Item.WildwoodShelfItem, 2);
  return seal({
    schema: 1,
    sequence: 1,
    originInputSequence: 12,
    completionTick: 90,
    action: "place",
    position: Object.freeze({ x: 4, y: 40, z: -3 }),
    priorBlockId: BlockId.Air,
    priorFacing: 0,
    replacementBlockId: BlockId.WildwoodShelf,
    replacementFacing: facing,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 40, residency: 8 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
    beforeWorldHash: hash("7"),
    afterWorldHash: hash("8"),
    creativeMode: mode === "builder",
    inventory: Object.freeze({
      container,
      selectedSlot: 0,
      beforeRevision: BigInt(3),
      afterRevision: mode === "builder" ? BigInt(3) : BigInt(4),
      beforeStack: stack,
      afterStack: mode === "builder" ? stack : plainStack(Item.WildwoodShelfItem, 1),
    }),
    generatedDrops: Object.freeze([]),
    content: content(BlockId.WildwoodShelf),
  });
}

function placeBarrelReceipt(facing = 0): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  return seal({
    schema: 1,
    sequence: 1,
    originInputSequence: 15,
    completionTick: 90,
    action: "place",
    position: Object.freeze({ x: 5, y: 40, z: -3 }),
    priorBlockId: BlockId.Air,
    priorFacing: 0,
    replacementBlockId: BlockId.SealedBarrel,
    replacementFacing: facing,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 40, residency: 8 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
    beforeWorldHash: hash("7"),
    afterWorldHash: hash("8"),
    creativeMode: false,
    inventory: Object.freeze({
      container,
      selectedSlot: 0,
      beforeRevision: BigInt(3),
      afterRevision: BigInt(4),
      beforeStack: plainStack(Item.SealedBarrelItem, 2),
      afterStack: plainStack(Item.SealedBarrelItem, 1),
    }),
    generatedDrops: Object.freeze([]),
    content: content(BlockId.SealedBarrel),
  });
}

function placeAdditionalStaticShapeReceipt(
  blockId: BlockId.MushroomCap | BlockId.SeaDragonEggBlock | BlockId.HearthFireplace,
  itemCode: ItemCode,
  facing: number,
): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  const beforeCount = Math.min(2, ITEMS[itemCode]?.maxStack ?? 0);
  const afterCount = beforeCount - 1;
  return seal({
    schema: 1,
    sequence: 1,
    originInputSequence: 16,
    completionTick: 90,
    action: "place",
    position: Object.freeze({ x: 6, y: 40, z: -3 }),
    priorBlockId: BlockId.Air,
    priorFacing: 0,
    replacementBlockId: blockId,
    replacementFacing: facing,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 40, residency: 8 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
    beforeWorldHash: hash("7"),
    afterWorldHash: hash("8"),
    creativeMode: false,
    inventory: Object.freeze({
      container,
      selectedSlot: 0,
      beforeRevision: BigInt(3),
      afterRevision: BigInt(4),
      beforeStack: plainStack(itemCode, beforeCount),
      afterStack: afterCount > 0 ? plainStack(itemCode, afterCount) : null,
    }),
    generatedDrops: Object.freeze([]),
    content: content(blockId),
  });
}

function noOpStoneHarvestReceipt(): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  return seal({
    schema: 1,
    sequence: 2,
    originInputSequence: 13,
    completionTick: 91,
    action: "mine",
    position: Object.freeze({ x: 7, y: 39, z: 2 }),
    priorBlockId: BlockId.Stone,
    priorFacing: 0,
    replacementBlockId: BlockId.Stone,
    replacementFacing: 0,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
    beforeWorldHash: hash("8"),
    afterWorldHash: hash("8"),
    creativeMode: false,
    inventory: Object.freeze({
      container,
      selectedSlot: 0,
      beforeRevision: BigInt(4),
      afterRevision: BigInt(4),
      beforeStack: null,
      afterStack: null,
    }),
    generatedDrops: Object.freeze([]),
    content: content(BlockId.Stone),
  });
}

function mineDirtReceipt(): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  const binding = content(BlockId.Dirt);
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: binding.manifestHash,
    installedRegistryHash: binding.installedRegistryHash,
    catalogBlobHash: binding.catalogBlobHash,
    actionReportHash: binding.actionReportHash,
    rngSemanticsHash: hash("5"),
    blockActionSequence: BigInt(9),
    originInputSequence: 14,
    blockId: BlockId.Dirt,
    position: Object.freeze({ x: -2, y: 35, z: 6 }),
    lootPlanHash: hash("6"),
    groupOrdinal: 0,
  });
  const transform = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(provenance);
  return seal({
    schema: 1,
    sequence: 3,
    originInputSequence: 14,
    completionTick: 92,
    action: "mine",
    position: provenance.position,
    priorBlockId: BlockId.Dirt,
    priorFacing: 0,
    replacementBlockId: BlockId.Air,
    replacementFacing: 0,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 42, residency: 8 }),
    beforeWorldHash: hash("8"),
    afterWorldHash: hash("9"),
    creativeMode: false,
    inventory: Object.freeze({
      container,
      selectedSlot: 0,
      beforeRevision: BigInt(4),
      afterRevision: BigInt(4),
      beforeStack: null,
      afterStack: null,
    }),
    generatedDrops: Object.freeze([Object.freeze({
      provenance,
      entityId: BigInt("18446744069414584321"),
      stack: plainStack(BlockId.Dirt, 1),
      ...transform,
    })]),
    content: binding,
  });
}

function mineStaticShapeReceipt(
  blockId: BlockId,
  itemCode: ItemCode,
  facing: number,
  sequence: number,
): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  const binding = content(blockId);
  const position = Object.freeze({ x: 11 + sequence, y: 42, z: -8 });
  const originInputSequence = 20 + sequence;
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: binding.manifestHash,
    installedRegistryHash: binding.installedRegistryHash,
    catalogBlobHash: binding.catalogBlobHash,
    actionReportHash: binding.actionReportHash,
    rngSemanticsHash: hash("5"),
    blockActionSequence: BigInt(40 + sequence),
    originInputSequence,
    blockId,
    position,
    lootPlanHash: hash("6"),
    groupOrdinal: 0,
  });
  const transform = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(provenance);
  return seal({
    schema: 1,
    sequence,
    originInputSequence,
    completionTick: 90 + sequence,
    action: "mine",
    position,
    priorBlockId: blockId,
    priorFacing: facing,
    replacementBlockId: BlockId.Air,
    replacementFacing: 0,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 40 + sequence, residency: 8 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 41 + sequence, residency: 8 }),
    beforeWorldHash: hash("7"),
    afterWorldHash: hash("8"),
    creativeMode: false,
    inventory: Object.freeze({
      container,
      selectedSlot: 0,
      beforeRevision: BigInt(4),
      afterRevision: BigInt(4),
      beforeStack: null,
      afterStack: null,
    }),
    generatedDrops: Object.freeze([Object.freeze({
      provenance,
      entityId: BigInt(1000 + sequence),
      stack: plainStack(itemCode, 1),
      ...transform,
    })]),
    content: binding,
  });
}

function unsupportedProfileMineReceipt(blockId: BlockId): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  return seal({
    schema: 1,
    sequence: 1,
    originInputSequence: 30,
    completionTick: 99,
    action: "mine",
    position: Object.freeze({ x: 2, y: 41, z: 2 }),
    priorBlockId: blockId,
    priorFacing: 0,
    replacementBlockId: BlockId.Air,
    replacementFacing: 0,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 50, residency: 8 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 51, residency: 8 }),
    beforeWorldHash: hash("7"),
    afterWorldHash: hash("8"),
    creativeMode: false,
    inventory: Object.freeze({
      container,
      selectedSlot: 0,
      beforeRevision: BigInt(4),
      afterRevision: BigInt(4),
      beforeStack: null,
      afterStack: null,
    }),
    generatedDrops: Object.freeze([]),
    content: content(blockId),
  });
}

function dirtyEvidence(receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1) {
  const mutated = receipt.priorBlockId !== receipt.replacementBlockId
    || receipt.priorFacing !== receipt.replacementFacing;
  const base = Object.freeze({
    schema: 1 as const,
    sequence: receipt.sequence,
    receiptHash: receipt.receiptHash,
    sections: mutated ? Object.freeze([Object.freeze({
      universeId: queryIdentity.universeId,
      locationId: queryIdentity.locationId,
      chunkX: Math.floor(receipt.position.x / 16),
      chunkZ: Math.floor(receipt.position.z / 16),
      sectionY: Math.floor((receipt.position.y + 64) / 16),
    })]) : Object.freeze([]),
    columns: mutated
      ? Object.freeze([Object.freeze({ x: receipt.position.x, z: receipt.position.z })])
      : Object.freeze([]),
    subsystemSeeds: mutated
      ? Object.freeze(RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2
        .map((subsystem, index) => Object.freeze({ subsystem, seed: (index + 1).toString(16).repeat(32) })))
      : Object.freeze([]),
    evidenceHash: hash("f"),
  });
  return Object.freeze({
    ...base,
    evidenceHash: rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2(base),
  });
}

test("static shaped slice is bound to the exact compatibility registry identities", () => {
  assert.equal(BlockId.WildwoodShelf, 130);
  assert.equal(Item.WildwoodShelfItem, 270);
  assert.equal(BlockId.SealedBarrel, 131);
  assert.equal(Item.SealedBarrelItem, 271);
  assert.equal(BLOCK_ITEM_ALIASES[BlockId.WildwoodShelf], Item.WildwoodShelfItem);
  assert.equal(BLOCK_ITEM_ALIASES[BlockId.SealedBarrel], Item.SealedBarrelItem);
  assert.equal(ITEMS[Item.WildwoodShelfItem]?.placeBlock, BlockId.WildwoodShelf);
  assert.equal(ITEMS[Item.SealedBarrelItem]?.placeBlock, BlockId.SealedBarrel);
  assert.deepEqual({
    shape: BLOCKS[BlockId.WildwoodShelf]?.shape,
    liquid: BLOCKS[BlockId.WildwoodShelf]?.liquid,
    waterlogged: BLOCKS[BlockId.WildwoodShelf]?.waterlogged,
    connectGroup: BLOCKS[BlockId.WildwoodShelf]?.connectGroup,
    verticalConnectGroup: BLOCKS[BlockId.WildwoodShelf]?.verticalConnectGroup,
    collisionHeight: BLOCKS[BlockId.WildwoodShelf]?.collisionHeight,
  }, {
    shape: "shelf",
    liquid: undefined,
    waterlogged: undefined,
    connectGroup: undefined,
    verticalConnectGroup: undefined,
    collisionHeight: undefined,
  });
  assert.deepEqual({
    shape: BLOCKS[BlockId.SealedBarrel]?.shape,
    liquid: BLOCKS[BlockId.SealedBarrel]?.liquid,
    waterlogged: BLOCKS[BlockId.SealedBarrel]?.waterlogged,
    connectGroup: BLOCKS[BlockId.SealedBarrel]?.connectGroup,
    verticalConnectGroup: BLOCKS[BlockId.SealedBarrel]?.verticalConnectGroup,
    collisionHeight: BLOCKS[BlockId.SealedBarrel]?.collisionHeight,
  }, {
    shape: "barrel",
    liquid: undefined,
    waterlogged: undefined,
    connectGroup: undefined,
    verticalConnectGroup: undefined,
    collisionHeight: undefined,
  });
});

test("generic planner preserves a directional non-Dirt placement and exact selected-stack successor", () => {
  const receipt = placeShelfReceipt();
  const plan = planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
  });
  assert.equal(plan.cursorAfter, 1);
  assert.equal(plan.receiptHash, receipt.receiptHash);
  assert.deepEqual(plan.cell, {
    x: 4,
    y: 40,
    z: -3,
    previousBlockId: BlockId.Air,
    blockId: BlockId.WildwoodShelf,
    previousFacing: 0,
    facing: 2,
    mutated: true,
  });
  assert.deepEqual(plan.inventory.before, { item: Item.WildwoodShelfItem, count: 2 });
  assert.deepEqual(plan.inventory.after, { item: Item.WildwoodShelfItem, count: 1 });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.cell), true);
});

test("static shaped planner retains all Shelf facings and Barrel facing zero", () => {
  for (const facing of [0, 1, 2, 3] as const) {
    const receipt = placeShelfReceipt(facing);
    const plan = planRustNativeBlockEditBrowserProjectionV1({
      ...legacyProjection,
      receipt,
      cursorBefore: 0,
      expectedInventoryContainer: container,
      selectedSlot: 0,
      mode: "survival",
      selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
    });
    assert.equal(plan.cell.facing, facing);
    assert.equal(plan.inventory.before?.item, Item.WildwoodShelfItem);
    assert.equal(plan.inventory.after?.count, 1);
  }

  const barrel = placeBarrelReceipt();
  const barrelPlan = planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: barrel,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: Item.SealedBarrelItem, count: 2 },
  });
  assert.equal(barrelPlan.cell.blockId, BlockId.SealedBarrel);
  assert.equal(barrelPlan.cell.facing, 0);
  assert.deepEqual(barrelPlan.inventory.after, { item: Item.SealedBarrelItem, count: 1 });
});

test("browser defense admits inert Mooncap and rejects special-use Egg and tool-profile Fireplace", () => {
  const receipt = placeAdditionalStaticShapeReceipt(BlockId.MushroomCap, BlockId.MushroomCap, 0);
  const plan = planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: BlockId.MushroomCap, count: 2 },
  });
  assert.equal(plan.cell.blockId, BlockId.MushroomCap);
  assert.deepEqual(plan.inventory.after, { item: BlockId.MushroomCap, count: 1 });

  const mine = mineStaticShapeReceipt(BlockId.MushroomCap, BlockId.MushroomCap, 0, 2);
  const minePlan = planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: mine,
    cursorBefore: 1,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: null,
  });
  assert.deepEqual(minePlan.drops.map(({ item, count }) => ({ item, count })), [{ item: BlockId.MushroomCap, count: 1 }]);

  assert.equal(ITEMS[Item.SeaDragonEgg]?.useKind, "dragon-egg");
  assert.equal(BLOCKS[BlockId.HearthFireplace]?.preferredTool, "pickaxe");
  for (const fixture of [
    { block: BlockId.SeaDragonEggBlock, item: Item.SeaDragonEgg, facing: 0 },
    { block: BlockId.HearthFireplace, item: Item.HearthFireplaceItem, facing: 3 },
  ] as const) {
    assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
      ...legacyProjection,
      receipt: placeAdditionalStaticShapeReceipt(fixture.block, fixture.item, fixture.facing),
      cursorBefore: 0,
      expectedInventoryContainer: container,
      selectedSlot: 0,
      mode: "survival",
      selectedCompatibilityStack: { item: fixture.item, count: ITEMS[fixture.item]!.maxStack === 1 ? 1 : 2 },
    }), /outside the bounded browser slice/u);
  }
});

test("static shaped planner preserves Builder inventory no-op custody", () => {
  const receipt = placeShelfReceipt(3, "builder");
  const plan = planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "builder",
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
  });
  assert.equal(plan.cell.facing, 3);
  assert.equal(plan.inventory.beforeRevision, BigInt(3));
  assert.equal(plan.inventory.afterRevision, BigInt(3));
  assert.deepEqual(plan.inventory.after, plan.inventory.before);

  const survivalMine = mineStaticShapeReceipt(BlockId.WildwoodShelf, Item.WildwoodShelfItem, 3, 2);
  const builderMineSource = {
    ...survivalMine,
    creativeMode: true,
    generatedDrops: [],
    receiptHash: hash("f"),
  };
  const builderMine = {
    ...builderMineSource,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(builderMineSource),
  };
  const builderMinePlan = planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: builderMine,
    cursorBefore: 1,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "builder",
    selectedCompatibilityStack: null,
  });
  assert.equal(builderMinePlan.cell.previousFacing, 3);
  assert.deepEqual(builderMinePlan.drops, []);
  assert.equal(builderMinePlan.inventory.beforeRevision, builderMinePlan.inventory.afterRevision);
});

test("static shaped mining retains facing, mapped-item drop, content, and dirty custody", () => {
  const cases = [
    {
      receipt: mineStaticShapeReceipt(BlockId.WildwoodShelf, Item.WildwoodShelfItem, 3, 2),
      item: Item.WildwoodShelfItem,
      facing: 3,
    },
    {
      receipt: mineStaticShapeReceipt(BlockId.SealedBarrel, Item.SealedBarrelItem, 0, 3),
      item: Item.SealedBarrelItem,
      facing: 0,
    },
  ] as const;
  for (const fixture of cases) {
    const dirty = dirtyEvidence(fixture.receipt);
    const plan = planRustNativeBlockEditBrowserProjectionV1({
      protocolVersion: 2,
      legacyFallback: null,
      queryIdentity,
      receipt: fixture.receipt,
      dirty,
      cursorBefore: fixture.receipt.sequence - 1,
      expectedInventoryContainer: container,
      selectedSlot: 0,
      mode: "survival",
      selectedCompatibilityStack: null,
    });
    assert.equal(plan.cell.previousBlockId, fixture.receipt.content.blockId);
    assert.equal(plan.cell.previousFacing, fixture.facing);
    assert.equal(plan.cell.blockId, BlockId.Air);
    assert.equal(plan.drops.length, 1);
    assert.equal(plan.drops[0]?.item, fixture.item);
    assert.equal(plan.drops[0]?.count, 1);
    assert.equal(plan.dirty, dirty);
    assert.equal(plan.dirty?.receiptHash, fixture.receipt.receiptHash);
  }
});

test("generic planner retains exact V2 Rust dirty evidence for browser world consumption", () => {
  const receipt = placeShelfReceipt();
  const dirty = dirtyEvidence(receipt);
  const plan = planRustNativeBlockEditBrowserProjectionV1({
    protocolVersion: 2,
    legacyFallback: null,
    queryIdentity,
    receipt,
    dirty,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
  });
  assert.equal(plan.protocolVersion, 2);
  assert.equal(plan.legacyFallback, null);
  assert.equal(plan.dirty, dirty);
  assert.equal(plan.dirty?.receiptHash, plan.receiptHash);
  assert.deepEqual(plan.dirty?.columns, [{ x: 4, z: -3 }]);
});

test("generic planner permits null dirty evidence only for explicit V1 or pre-V14 fallback", () => {
  const receipt = placeShelfReceipt();
  const base = {
    queryIdentity,
    receipt,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival" as const,
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
  };
  const legacy = planRustNativeBlockEditBrowserProjectionV1({
    ...base,
    protocolVersion: 2,
    legacyFallback: "v2-pre-v14",
    dirty: null,
  });
  assert.equal(legacy.dirty, null);
  assert.equal(legacy.legacyFallback, "v2-pre-v14");

  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...base,
    protocolVersion: 2,
    legacyFallback: null,
    dirty: null,
  }), /explicit pre-V14/u);
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...base,
    protocolVersion: 1,
    legacyFallback: "v1-capability",
    dirty: dirtyEvidence(receipt),
  }), /contradictory/u);
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...base,
    protocolVersion: 2,
    legacyFallback: "v2-pre-v14",
    dirty: dirtyEvidence(receipt),
  }), /mislabeled/u);
});

test("generic planner represents a content-owned no-op harvest without inventing a world mutation", () => {
  const plan = planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: noOpStoneHarvestReceipt(),
    cursorBefore: 1,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: null,
  });
  assert.equal(plan.cell.mutated, false);
  assert.deepEqual(plan.world.beforeRevision, plan.world.afterRevision);
  assert.equal(plan.world.beforeHash, plan.world.afterHash);
});

test("generic planner converts a deterministic native generated drop without losing its identity", () => {
  const receipt = mineDirtReceipt();
  const plan = planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt,
    cursorBefore: 2,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: null,
  });
  assert.equal(plan.cell.mutated, true);
  assert.equal(plan.drops.length, 1);
  assert.equal(plan.drops[0]?.rustEntityId, "18446744069414584321");
  assert.equal(plan.drops[0]?.item, BlockId.Dirt);
  assert.equal(plan.drops[0]?.position.x, Number(receipt.generatedDrops[0]!.position.xMilli) / 1_000);
});

test("generic planner rejects cursor, player, mode, selected-stack, and compatibility-facing mismatches", () => {
  const receipt = placeShelfReceipt();
  const base = {
    ...legacyProjection,
    receipt,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival" as const,
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
  };
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({ ...base, cursorBefore: 1 }), /cursor/u);
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...base,
    expectedInventoryContainer: { ...container, id: "actor:other" },
  }), /different player/u);
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({ ...base, mode: "builder" }), /creative mode/u);
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...base,
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 1 },
  }), /before stack/u);

  const malformed = { ...receipt, priorFacing: 1, receiptHash: hash("f") };
  const sealed = { ...malformed, receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(malformed) };
  assert.throws(
    () => planRustNativeBlockEditBrowserProjectionV1({ ...base, receipt: sealed }),
    /canonical block catalog|non-directional/u,
  );
});

test("static shaped planner rejects wrong mapped items, drops, and content binding", () => {
  const shelf = placeShelfReceipt();
  const wrongPlacementItem = {
    ...shelf,
    inventory: {
      ...shelf.inventory,
      beforeStack: plainStack(Item.SealedBarrelItem, 2),
      afterStack: plainStack(Item.SealedBarrelItem, 1),
    },
    receiptHash: hash("f"),
  };
  const sealedWrongPlacementItem = {
    ...wrongPlacementItem,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(wrongPlacementItem),
  };
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: sealedWrongPlacementItem,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: Item.SealedBarrelItem, count: 2 },
  }), /item does not map/u);

  const shelfMine = mineStaticShapeReceipt(BlockId.WildwoodShelf, Item.WildwoodShelfItem, 2, 2);
  const wrongDrop = {
    ...shelfMine,
    generatedDrops: [Object.freeze({
      ...shelfMine.generatedDrops[0]!,
      stack: plainStack(Item.SealedBarrelItem, 1),
    })],
    receiptHash: hash("f"),
  };
  const sealedWrongDrop = {
    ...wrongDrop,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(wrongDrop),
  };
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: sealedWrongDrop,
    cursorBefore: 1,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: null,
  }), /mapped-item drop custody/u);

  const wrongContent = {
    ...shelf,
    content: content(BlockId.SealedBarrel),
    receiptHash: hash("f"),
  };
  const sealedWrongContent = {
    ...wrongContent,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(wrongContent),
  };
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: sealedWrongContent,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
  }), /bind|ambiguous|transition/u);
});

test("static shaped planner rejects placement and mining custody tampering", () => {
  const base = placeShelfReceipt(2);
  const projectPlace = (receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1) => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: receipt.inventory.beforeStack!.count },
  });
  const reseal = (receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1) => {
    const malformed = { ...receipt, receiptHash: hash("f") };
    return { ...malformed, receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(malformed) };
  };

  const staleRevision = reseal({
    ...base,
    inventory: { ...base.inventory, afterRevision: base.inventory.beforeRevision },
  });
  assert.throws(() => projectPlace(staleRevision), /Survival placement/u);

  const changedMetadata = reseal({
    ...base,
    inventory: {
      ...base.inventory,
      afterStack: { ...base.inventory.afterStack!, metadataHash: hash("a") },
    },
  });
  assert.throws(() => projectPlace(changedMetadata), /Survival placement/u);

  const countOne = reseal({
    ...base,
    inventory: {
      ...base.inventory,
      beforeStack: plainStack(Item.WildwoodShelfItem, 1),
      afterStack: plainStack(Item.WildwoodShelfItem, 1),
    },
  });
  assert.throws(() => projectPlace(countOne), /Survival placement/u);

  const builder = placeShelfReceipt(1, "builder");
  const builderDrift = reseal({
    ...builder,
    inventory: { ...builder.inventory, afterRevision: builder.inventory.beforeRevision + BigInt(1) },
  });
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: builderDrift,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "builder",
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
  }), /creative edit|Builder placement/u);

  const mine = mineStaticShapeReceipt(BlockId.WildwoodShelf, Item.WildwoodShelfItem, 2, 2);
  const facingOnlyMutation = reseal({
    ...mine,
    replacementBlockId: BlockId.WildwoodShelf,
    replacementFacing: 0,
  });
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: facingOnlyMutation,
    cursorBefore: 1,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: null,
  }), /real mutation to Air/u);

  const mineInventoryDrift = reseal({
    ...mine,
    inventory: { ...mine.inventory, afterRevision: mine.inventory.beforeRevision + BigInt(1) },
  });
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: mineInventoryDrift,
    cursorBefore: 1,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: null,
  }), /inventory custody/u);
});

test("static shaped planner rejects alternate place-capable items and inert-item registry drift", () => {
  const shelf = placeShelfReceipt();
  const alternate = ITEMS[Item.SealedBarrelItem]!;
  const canonical = ITEMS[Item.WildwoodShelfItem]!;
  try {
    ITEMS[Item.SealedBarrelItem] = { ...alternate, placeBlock: BlockId.WildwoodShelf };
    const receipt = {
      ...shelf,
      inventory: {
        ...shelf.inventory,
        beforeStack: plainStack(Item.SealedBarrelItem, 2),
        afterStack: plainStack(Item.SealedBarrelItem, 1),
      },
      receiptHash: hash("f"),
    };
    const sealed = { ...receipt, receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(receipt) };
    assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
      ...legacyProjection,
      receipt: sealed,
      cursorBefore: 0,
      expectedInventoryContainer: container,
      selectedSlot: 0,
      mode: "survival",
      selectedCompatibilityStack: { item: Item.SealedBarrelItem, count: 2 },
    }), /exact canonical mapped item/u);

    const itemDrifts = [
      { maxStack: 16 },
      { food: 1 },
      { fuel: 1 },
      { damage: 1 },
      { tier: 1 },
      { miningSpeed: 1 },
      { infiniteDurability: true },
      { bucketLiquid: "water" as const },
      { ammoItem: Item.SealedBarrelItem },
      { blueprintId: "drift" },
      { potionId: "drift" },
      { creatureKind: "drift" },
      { spellId: "drift" },
      { manaIncrease: 1 },
    ] as const;
    for (const drift of itemDrifts) {
      ITEMS[Item.WildwoodShelfItem] = { ...canonical, ...drift };
      assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
        ...legacyProjection,
        receipt: shelf,
        cursorBefore: 0,
        expectedInventoryContainer: container,
        selectedSlot: 0,
        mode: "survival",
        selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
      }), /exact inert placement-item binding/u, `item drift ${Object.keys(drift)[0]} must fail closed`);
    }
  } finally {
    ITEMS[Item.SealedBarrelItem] = alternate;
    ITEMS[Item.WildwoodShelfItem] = canonical;
  }
});

test("static shaped planner rejects block-profile, predecessor, and future-tick drift", () => {
  const shelf = placeShelfReceipt();
  const project = (receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1) => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
  });
  const canonical = BLOCKS[BlockId.WildwoodShelf]!;
  const blockDrifts = [
    { requiredTier: 1 },
    { preferredTool: "pickaxe" as const },
    { solid: false },
    { replaceable: true },
    { replaceable: false },
    { hardness: 0 },
    { hardness: Number.NaN },
  ] as const;
  try {
    for (const drift of blockDrifts) {
      BLOCKS[BlockId.WildwoodShelf] = { ...canonical, ...drift };
      assert.throws(() => project(shelf), /outside the bounded browser slice/u, `block drift ${Object.keys(drift)[0]} must fail closed`);
    }
  } finally {
    BLOCKS[BlockId.WildwoodShelf] = canonical;
  }

  for (const priorBlockId of [BlockId.Stone, BlockId.TallGrass] as const) {
    const malformed = { ...shelf, priorBlockId, receiptHash: hash("f") };
    const sealed = { ...malformed, receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(malformed) };
    assert.throws(() => project(sealed), /Air or one exact unshaped static replaceable cell/u);
  }

  const replaceable = { ...shelf, priorBlockId: BlockId.GrottoMoss, receiptHash: hash("f") };
  const sealedReplaceable = {
    ...replaceable,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(replaceable),
  };
  assert.equal(project(sealedReplaceable).cell.previousBlockId, BlockId.GrottoMoss);

  const grass = BLOCKS[BlockId.TallGrass]!;
  try {
    BLOCKS[BlockId.TallGrass] = { ...grass, shape: "cube" };
    const malformed = { ...shelf, priorBlockId: BlockId.TallGrass, receiptHash: hash("f") };
    const sealed = { ...malformed, receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(malformed) };
    assert.throws(() => project(sealed), /Air or one exact unshaped static replaceable cell/u);
  } finally {
    BLOCKS[BlockId.TallGrass] = grass;
  }

  const future = { ...shelf, completionTick: queryIdentity.tick + 1, receiptHash: hash("f") };
  const sealedFuture = { ...future, receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(future) };
  assert.throws(() => project(sealedFuture), /query identity's future/u);
});

test("static shaped planner rejects illegal direct-facing and registry-content drift", () => {
  const illegalBarrelFacing = placeBarrelReceipt(1);
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: illegalBarrelFacing,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: Item.SealedBarrelItem, count: 2 },
  }), /facing/u);

  const shelfMine = mineStaticShapeReceipt(BlockId.WildwoodShelf, Item.WildwoodShelfItem, 1, 2);
  const wrongRegistryDrop = {
    ...shelfMine.generatedDrops[0]!,
    provenance: {
      ...shelfMine.generatedDrops[0]!.provenance,
      installedRegistryHash: hash("9"),
    },
  };
  const wrongRegistry = {
    ...shelfMine,
    generatedDrops: [Object.freeze(wrongRegistryDrop)],
    receiptHash: hash("f"),
  };
  const sealedWrongRegistry = {
    ...wrongRegistry,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(wrongRegistry),
  };
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: sealedWrongRegistry,
    cursorBefore: 1,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: null,
  }), /same action and content/u);
});

test("browser defense rejects neighboring dynamic, connected, vertical, and liquid profiles", () => {
  const unsupported = [
    BlockId.Chest,
    BlockId.Furnace,
    BlockId.SeaDragonEggBlock,
    BlockId.HearthFireplace,
    BlockId.WildwoodFence,
    BlockId.DoubleTallGrassLower,
    BlockId.LumenKelp,
    BlockId.Water,
  ] as const;
  assert.equal(BLOCKS[BlockId.Chest]?.shape, "chest");
  assert.equal(BLOCKS[BlockId.WildwoodFence]?.connectGroup, "fence");
  assert.equal(BLOCKS[BlockId.DoubleTallGrassLower]?.verticalConnectGroup, "double-tall-grass");
  assert.equal(BLOCKS[BlockId.LumenKelp]?.waterlogged, true);
  assert.equal(BLOCKS[BlockId.Water]?.liquid, "water");
  for (const blockId of unsupported) {
    const receipt = unsupportedProfileMineReceipt(blockId);
    assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
      ...legacyProjection,
      receipt,
      cursorBefore: 0,
      expectedInventoryContainer: container,
      selectedSlot: 0,
      mode: "survival",
      selectedCompatibilityStack: null,
    }), /outside the bounded browser slice/u, `block ${blockId} must remain outside the bounded browser slice`);
  }
});

test("generic planner rejects a lossy browser inventory stack", () => {
  const receipt = placeShelfReceipt();
  const malformed = {
    ...receipt,
    inventory: {
      ...receipt.inventory,
      beforeStack: { ...receipt.inventory.beforeStack!, durabilityMillionths: 500_000 },
    },
    receiptHash: hash("f"),
  };
  const sealed = { ...malformed, receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(malformed) };
  assert.throws(() => planRustNativeBlockEditBrowserProjectionV1({
    ...legacyProjection,
    receipt: sealed,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: Item.WildwoodShelfItem, count: 2 },
  }), /durability|exact mapped item successor/u);
});
