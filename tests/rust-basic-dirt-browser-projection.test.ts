import assert from "node:assert/strict";
import test from "node:test";
import { BlockId } from "../app/game/data.ts";
import {
  rustIntegratedRuntimeBasicDirtActionReceiptHashV1,
  rustIntegratedRuntimeBasicDirtContentSubsetHashV1,
  rustIntegratedRuntimeBasicDirtExpectedDropTransformV1,
  type RustIntegratedRuntimeBasicDirtActionProjectionV1,
} from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";
import {
  planRustBasicDirtBrowserProjectionV1,
  rustBasicDirtCompatibilityStackMatchesV1,
  rustBasicDirtCompatibilityStackV1,
} from "../app/game/rust-basic-dirt-browser-projection.ts";

const hash = (digit: string) => digit.repeat(32);
const container = Object.freeze({ kind: "player" as const, id: "actor:noah", ownerId: "actor:noah" });
const plainDirt = (count: number) => Object.freeze({
  itemCode: BlockId.Dirt,
  count,
  durabilityMillionths: null,
  metadataHash: hash("0"),
});

function mineReceipt(): RustIntegratedRuntimeBasicDirtActionProjectionV1 {
  const contentBase = Object.freeze({
    manifestHash: hash("1"),
    installedRegistryHash: hash("2"),
    catalogSchemaVersion: 1,
    catalogContentVersion: 7,
    catalogBlobHash: hash("3"),
    actionReportHash: hash("4"),
    subsetHash: hash("f"),
  });
  const content = Object.freeze({
    ...contentBase,
    subsetHash: rustIntegratedRuntimeBasicDirtContentSubsetHashV1(contentBase),
  });
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: content.manifestHash,
    installedRegistryHash: content.installedRegistryHash,
    catalogBlobHash: content.catalogBlobHash,
    actionReportHash: content.actionReportHash,
    rngSemanticsHash: hash("5"),
    blockActionSequence: BigInt(9),
    originInputSequence: 12,
    blockId: BlockId.Dirt,
    position: Object.freeze({ x: 4, y: 40, z: -3 }),
    lootPlanHash: hash("6"),
    groupOrdinal: 0,
  });
  const transform = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(provenance);
  const source = Object.freeze({
    schema: 1 as const,
    sequence: 1,
    originInputSequence: 12,
    completionTick: 90,
    action: "mine" as const,
    position: provenance.position,
    priorBlockId: BlockId.Dirt,
    replacementBlockId: BlockId.Air,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 40, residency: 8 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
    beforeWorldHash: hash("7"),
    afterWorldHash: hash("8"),
    creativeMode: false,
    inventory: Object.freeze({
      container,
      slot: 0,
      beforeRevision: BigInt(3),
      afterRevision: BigInt(3),
      beforeStack: null,
      afterStack: null,
    }),
    generatedDrops: Object.freeze([Object.freeze({
      provenance,
      entityId: BigInt("18446744069414584321"),
      stack: plainDirt(1),
      ...transform,
    })]),
    content,
    receiptHash: hash("f"),
  });
  return Object.freeze({
    ...source,
    receiptHash: rustIntegratedRuntimeBasicDirtActionReceiptHashV1(source),
  });
}

function placeReceipt() {
  const mined = mineReceipt();
  const source = Object.freeze({
    ...mined,
    sequence: 2,
    originInputSequence: 13,
    completionTick: 91,
    action: "place" as const,
    priorBlockId: BlockId.Air,
    replacementBlockId: BlockId.Dirt,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 42, residency: 8 }),
    beforeWorldHash: mined.afterWorldHash,
    afterWorldHash: hash("9"),
    inventory: Object.freeze({
      container,
      slot: 0,
      beforeRevision: BigInt(3),
      afterRevision: BigInt(4),
      beforeStack: plainDirt(3),
      afterStack: plainDirt(2),
    }),
    generatedDrops: Object.freeze([]),
    receiptHash: hash("f"),
  });
  return Object.freeze({
    ...source,
    receiptHash: rustIntegratedRuntimeBasicDirtActionReceiptHashV1(source),
  });
}

test("browser projection plans exact cell, slot, cursor, and deterministic native drop", () => {
  const receipt = mineReceipt();
  const plan = planRustBasicDirtBrowserProjectionV1({
    receipt,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: null,
  });
  assert.equal(plan.cursorAfter, 1);
  assert.equal(plan.receiptHash, receipt.receiptHash);
  assert.deepEqual(plan.cell, {
    x: 4, y: 40, z: -3,
    expectedBlockId: BlockId.Dirt,
    replacementBlockId: BlockId.Air,
  });
  assert.deepEqual(plan.inventory, {
    slot: 0,
    before: null,
    after: null,
    beforeRevision: BigInt(3),
    afterRevision: BigInt(3),
  });
  assert.equal(plan.drops.length, 1);
  assert.equal(plan.drops[0]?.rustEntityId, "18446744069414584321");
  assert.equal(plan.drops[0]?.item, BlockId.Dirt);
  assert.equal(plan.drops[0]?.position.x, Number(receipt.generatedDrops[0]!.position.xMilli) / 1_000);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.drops), true);
});

test("placement plans one exact selected-slot successor without a drop", () => {
  const plan = planRustBasicDirtBrowserProjectionV1({
    receipt: placeReceipt(),
    cursorBefore: 1,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival",
    selectedCompatibilityStack: { item: BlockId.Dirt, count: 3 },
  });
  assert.deepEqual(plan.inventory.before, { item: BlockId.Dirt, count: 3 });
  assert.deepEqual(plan.inventory.after, { item: BlockId.Dirt, count: 2 });
  assert.equal(plan.drops.length, 0);
});

test("planner rejects cursor, player, mode, slot, and local before-state mismatches", () => {
  const receipt = mineReceipt();
  const base = {
    receipt,
    cursorBefore: 0,
    expectedInventoryContainer: container,
    selectedSlot: 0,
    mode: "survival" as const,
    selectedCompatibilityStack: null,
  };
  assert.throws(() => planRustBasicDirtBrowserProjectionV1({ ...base, cursorBefore: 1 }), /cursor/u);
  assert.throws(() => planRustBasicDirtBrowserProjectionV1({
    ...base,
    expectedInventoryContainer: { ...container, id: "actor:other" },
  }), /different player/u);
  assert.throws(() => planRustBasicDirtBrowserProjectionV1({ ...base, mode: "builder" }), /creative mode/u);
  assert.throws(() => planRustBasicDirtBrowserProjectionV1({ ...base, selectedSlot: 1 }), /selected/u);
  assert.throws(() => planRustBasicDirtBrowserProjectionV1({
    ...base,
    selectedCompatibilityStack: { item: BlockId.Dirt, count: 1 },
  }), /before stack/u);
});

test("compatibility stack conversion refuses lossy durability, metadata, and oversized stacks", () => {
  assert.deepEqual(rustBasicDirtCompatibilityStackV1(plainDirt(1)), { item: BlockId.Dirt, count: 1 });
  assert.equal(rustBasicDirtCompatibilityStackMatchesV1({ item: BlockId.Dirt, count: 1 }, { item: BlockId.Dirt, count: 1 }), true);
  assert.equal(rustBasicDirtCompatibilityStackMatchesV1({ item: BlockId.Dirt, count: 1, durability: 1 }, { item: BlockId.Dirt, count: 1 }), false);
  assert.throws(() => rustBasicDirtCompatibilityStackV1({ ...plainDirt(1), durabilityMillionths: 1 }), /durability/u);
  assert.throws(() => rustBasicDirtCompatibilityStackV1({ ...plainDirt(1), metadataHash: hash("a") }), /metadata/u);
  assert.throws(() => rustBasicDirtCompatibilityStackV1(plainDirt(65)), /exact browser/u);
});
