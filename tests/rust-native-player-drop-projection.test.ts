import assert from "node:assert/strict";
import test from "node:test";
import { BlockId } from "../app/game/data.ts";
import {
  rustIntegratedRuntimeNativePlayerDropOriginHashV1,
  rustIntegratedRuntimeNativePlayerDropReceiptHashV1,
} from "../app/game/rust-integrated-runtime-player-drop.ts";
import { planRustNativePlayerDropBrowserProjectionV1 } from "../app/game/rust-native-player-drop-projection.ts";
import { plainNativePlayerDropProjection } from "./helpers/rust-native-player-drop-fixture.ts";

function input() {
  const nativeReceipt = plainNativePlayerDropProjection();
  const yawOnlyBase = Object.freeze({
    ...nativeReceipt,
    drop: Object.freeze({
      ...nativeReceipt.drop,
      rotation: Object.freeze({ ...nativeReceipt.drop.rotation, pitch: 0, roll: 0 }),
    }),
  });
  const originHash = rustIntegratedRuntimeNativePlayerDropOriginHashV1(yawOnlyBase);
  const originBound = Object.freeze({
    ...yawOnlyBase,
    drop: Object.freeze({ ...yawOnlyBase.drop, originHash }),
  });
  const receipt = Object.freeze({
    ...originBound,
    receiptHash: rustIntegratedRuntimeNativePlayerDropReceiptHashV1(originBound),
  });
  return {
    receipt,
    cursorBefore: 0,
    expectedUniverseId: receipt.world.universeId,
    expectedLocationId: receipt.world.locationId,
    expectedPlayerId: receipt.player.playerId,
    expectedPlayerEntityId: receipt.player.entityId,
    expectedInventoryContainer: receipt.inventory.container,
    selectedSlot: 0,
    mode: "survival" as const,
    selectedCompatibilityStack: Object.freeze({ item: BlockId.Dirt, count: 2 }),
  };
}

test("native player-drop planner stages one exact Survival inventory/spawn transaction", () => {
  const source = input();
  const plan = planRustNativePlayerDropBrowserProjectionV1(source);
  assert.deepEqual(plan.inventory, {
    slot: 0,
    before: { item: BlockId.Dirt, count: 2 },
    after: { item: BlockId.Dirt, count: 1 },
    beforeRevision: BigInt(12),
    afterRevision: BigInt(13),
  });
  assert.equal(plan.cursorBefore, 0);
  assert.equal(plan.cursorAfter, 1);
  assert.equal(plan.receiptHash, source.receipt.receiptHash);
  assert.equal(plan.drop.rustEntityId, "101");
  assert.equal(plan.drop.item, BlockId.Dirt);
  assert.equal(plan.drop.count, 1);
  assert.deepEqual(plan.drop.position, { x: -1.25, y: 65.75, z: 2.5 });
  assert.deepEqual(plan.drop.velocity, { x: -0.35, y: 1.25, z: 0.075 });
  assert.equal(plan.drop.rotationY, 875_000 / 1_000_000 * Math.PI * 2);
  assert.deepEqual(plan.drop.nativeRotation, { yaw: 875_000, pitch: 0, roll: 0 });
  assert.equal(plan.drop.pickupDelay, 0.35);
  assert.equal(plan.drop.originHash, source.receipt.drop.originHash);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.drop), true);
});

test("native player-drop planner rejects rotations outside the exact yaw-only renderer seam", () => {
  const source = input();
  assert.throws(
    () => planRustNativePlayerDropBrowserProjectionV1({
      ...source,
      receipt: plainNativePlayerDropProjection(),
    }),
    /yaw-only/u,
  );
});

test("native player-drop planner rejects cursor, world, player, container, slot, and mode drift", () => {
  const source = input();
  assert.throws(() => planRustNativePlayerDropBrowserProjectionV1({ ...source, cursorBefore: 1 }), /cursor/u);
  assert.throws(() => planRustNativePlayerDropBrowserProjectionV1({
    ...source,
    expectedUniverseId: "other",
  }), /different runtime world/u);
  assert.throws(() => planRustNativePlayerDropBrowserProjectionV1({
    ...source,
    expectedPlayerId: BigInt(999),
  }), /different player/u);
  assert.throws(() => planRustNativePlayerDropBrowserProjectionV1({
    ...source,
    expectedInventoryContainer: Object.freeze({ ...source.expectedInventoryContainer, id: "actor:other" }),
  }), /different player/u);
  assert.throws(() => planRustNativePlayerDropBrowserProjectionV1({ ...source, selectedSlot: 1 }), /selected/u);
  assert.throws(() => planRustNativePlayerDropBrowserProjectionV1({ ...source, mode: "builder" }), /Survival/u);
});

test("native player-drop planner rejects browser-before drift and lossy item stacks", () => {
  const source = input();
  assert.throws(() => planRustNativePlayerDropBrowserProjectionV1({
    ...source,
    selectedCompatibilityStack: Object.freeze({ item: BlockId.Dirt, count: 1 }),
  }), /before stack/u);

  const lossyBase = Object.freeze({
    ...source.receipt,
    inventory: Object.freeze({
      ...source.receipt.inventory,
      beforeStack: Object.freeze({ ...source.receipt.inventory.beforeStack, metadataHash: "f".repeat(32) }),
      afterStack: Object.freeze({ ...source.receipt.inventory.afterStack!, metadataHash: "f".repeat(32) }),
    }),
    drop: Object.freeze({
      ...source.receipt.drop,
      stack: Object.freeze({ ...source.receipt.drop.stack, metadataHash: "f".repeat(32) }),
    }),
  });
  const originHash = rustIntegratedRuntimeNativePlayerDropOriginHashV1(lossyBase);
  const withOrigin = Object.freeze({ ...lossyBase, drop: Object.freeze({ ...lossyBase.drop, originHash }) });
  const lossy = Object.freeze({
    ...withOrigin,
    receiptHash: rustIntegratedRuntimeNativePlayerDropReceiptHashV1(withOrigin),
  });
  assert.throws(() => planRustNativePlayerDropBrowserProjectionV1({ ...source, receipt: lossy }), /metadata/u);
});

test("native player-drop planner propagates canonical conservation failures", () => {
  const source = input();
  const invalidBase = Object.freeze({
    ...source.receipt,
    inventory: Object.freeze({
      ...source.receipt.inventory,
      afterStack: null,
    }),
  });
  const originHash = rustIntegratedRuntimeNativePlayerDropOriginHashV1(invalidBase);
  const withOrigin = Object.freeze({ ...invalidBase, drop: Object.freeze({ ...invalidBase.drop, originHash }) });
  const invalid = Object.freeze({
    ...withOrigin,
    receiptHash: rustIntegratedRuntimeNativePlayerDropReceiptHashV1(withOrigin),
  });
  assert.throws(
    () => planRustNativePlayerDropBrowserProjectionV1({ ...source, receipt: invalid }),
    /conserve/u,
  );
});
