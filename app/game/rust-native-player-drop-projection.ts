import type { GameMode, InventorySlot, ItemCode } from "./data";
import {
  rustBasicDirtCompatibilityStackMatchesV1,
  rustBasicDirtCompatibilityStackV1,
} from "./rust-basic-dirt-browser-projection";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PICKUP_DELAY_TICKS_V1,
  validateRustIntegratedRuntimeNativePlayerDropProjectionV1,
  type RustIntegratedRuntimeNativePlayerDropProjectionV1,
} from "./rust-integrated-runtime-player-drop";
import type { RustIntegratedContainerKeyV1 } from "./rust-integrated-runtime-player-inventory";

const FIXED_POSITION_SCALE = 1_000;
const MICROTURN_SCALE = 1_000_000;
const NATIVE_TICKS_PER_SECOND = 20;

export type RustNativePlayerDropBrowserSpawnPlanV1 = Readonly<{
  dropId: string;
  rustEntityId: string;
  item: ItemCode;
  count: 1;
  position: Readonly<{ x: number; y: number; z: number }>;
  velocity: Readonly<{ x: number; y: number; z: number }>;
  rotationY: number;
  nativeRotation: Readonly<{ yaw: number; pitch: number; roll: number }>;
  pickupDelay: number;
  createdTick: bigint;
  pickupUnlockTick: bigint;
  expiresTick: bigint | null;
  originHash: string;
}>;

export type RustNativePlayerDropBrowserProjectionPlanV1 = Readonly<{
  schema: 1;
  cursorBefore: number;
  cursorAfter: number;
  receiptHash: string;
  originInputSequence: number;
  completionTick: number;
  inventory: Readonly<{
    slot: number;
    before: InventorySlot;
    after: InventorySlot | null;
    beforeRevision: bigint;
    afterRevision: bigint;
  }>;
  drop: RustNativePlayerDropBrowserSpawnPlanV1;
}>;

export class RustNativePlayerDropBrowserProjectionErrorV1 extends Error {
  readonly name = "RustNativePlayerDropBrowserProjectionErrorV1";
}

function fail(message: string): never {
  throw new RustNativePlayerDropBrowserProjectionErrorV1(message);
}

function sameContainer(left: RustIntegratedContainerKeyV1, right: RustIntegratedContainerKeyV1) {
  return left.kind === right.kind && left.id === right.id && left.ownerId === right.ownerId;
}

function exactPositiveEntityId(value: bigint) {
  const text = value.toString(10);
  if (!/^[1-9][0-9]*$/u.test(text)) fail("native player drop has no positive native entity id");
  return text;
}

function exactNumber(value: bigint, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || BigInt(number) !== value) {
    fail(`${label} is not exactly representable by the browser projection`);
  }
  return number;
}

function fixedVectorToBrowser(
  value: Readonly<{ xMilli: bigint; yMilli: bigint; zMilli: bigint }>,
  label: string,
) {
  return Object.freeze({
    x: exactNumber(value.xMilli, `${label} x`) / FIXED_POSITION_SCALE,
    y: exactNumber(value.yMilli, `${label} y`) / FIXED_POSITION_SCALE,
    z: exactNumber(value.zMilli, `${label} z`) / FIXED_POSITION_SCALE,
  });
}

/**
 * Converts one already-authoritative native Q-drop into a fail-closed browser
 * transaction plan. This first compatibility seam deliberately accepts only a
 * plain Survival stack: metadata and durability remain native-only until the
 * browser can reconstruct their exact item artifacts.
 */
export function planRustNativePlayerDropBrowserProjectionV1(input: Readonly<{
  receipt: RustIntegratedRuntimeNativePlayerDropProjectionV1;
  cursorBefore: number;
  expectedUniverseId: string;
  expectedLocationId: string;
  expectedPlayerId: bigint;
  expectedPlayerEntityId: bigint;
  expectedInventoryContainer: RustIntegratedContainerKeyV1;
  selectedSlot: number;
  mode: GameMode;
  selectedCompatibilityStack: InventorySlot | null;
}>): RustNativePlayerDropBrowserProjectionPlanV1 {
  const { receipt } = input;
  validateRustIntegratedRuntimeNativePlayerDropProjectionV1(receipt);
  if (!Number.isSafeInteger(input.cursorBefore) || input.cursorBefore < 0
    || receipt.sequence !== input.cursorBefore + 1) {
    fail("native player drop receipt is not the exact next browser projection cursor");
  }
  if (input.mode !== "survival") {
    fail("native player drop compatibility projection is restricted to Survival mode");
  }
  if (receipt.world.universeId !== input.expectedUniverseId
    || receipt.world.locationId !== input.expectedLocationId) {
    fail("native player drop receipt belongs to a different runtime world");
  }
  if (receipt.player.playerId !== input.expectedPlayerId
    || receipt.player.entityId !== input.expectedPlayerEntityId
    || !sameContainer(receipt.inventory.container, input.expectedInventoryContainer)) {
    fail("native player drop receipt belongs to a different player or inventory container");
  }
  if (receipt.inventory.selectedSlot !== input.selectedSlot
    || input.selectedSlot < 0 || input.selectedSlot > 8) {
    fail("native player drop receipt does not bind the selected compatibility hotbar slot");
  }

  const before = rustBasicDirtCompatibilityStackV1(
    receipt.inventory.beforeStack,
    "native player drop before stack",
  );
  if (before === null) fail("native player drop unexpectedly decoded without a source stack");
  const after = rustBasicDirtCompatibilityStackV1(
    receipt.inventory.afterStack,
    "native player drop after stack",
  );
  const dropped = rustBasicDirtCompatibilityStackV1(receipt.drop.stack, "native player drop spawned stack");
  if (dropped === null || dropped.count !== 1) {
    fail("native player drop does not spawn one exact compatibility item");
  }
  if (!rustBasicDirtCompatibilityStackMatchesV1(input.selectedCompatibilityStack, before)) {
    fail("native player drop before stack contradicts the selected compatibility slot");
  }
  const expectedAfter = before.count === 1
    ? null
    : Object.freeze({ item: before.item, count: before.count - 1 });
  if (!rustBasicDirtCompatibilityStackMatchesV1(after, expectedAfter)
    || dropped.item !== before.item) {
    fail("native player drop compatibility stacks do not conserve one selected item");
  }
  if (receipt.inventory.afterRevision !== receipt.inventory.beforeRevision + BigInt(1)) {
    fail("native player drop inventory revision does not attest one exact mutation");
  }

  const pickupDelayTicks = receipt.drop.pickupUnlockTick - receipt.drop.createdTick;
  if (pickupDelayTicks !== RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PICKUP_DELAY_TICKS_V1) {
    fail("native player drop pickup delay does not match the compatibility spawn contract");
  }
  if (receipt.drop.rotation.pitch !== 0 || receipt.drop.rotation.roll !== 0) {
    fail("native player drop rotation exceeds the compatibility renderer's yaw-only contract");
  }
  const nativeRotation = Object.freeze({ ...receipt.drop.rotation });
  const drop = Object.freeze({
    dropId: receipt.drop.dropId,
    rustEntityId: exactPositiveEntityId(receipt.drop.entityId),
    item: dropped.item,
    count: 1 as const,
    position: fixedVectorToBrowser(receipt.drop.position, "native player drop position"),
    velocity: fixedVectorToBrowser(receipt.drop.velocityMilliPerSecond, "native player drop velocity"),
    rotationY: receipt.drop.rotation.yaw / MICROTURN_SCALE * Math.PI * 2,
    nativeRotation,
    pickupDelay: Number(pickupDelayTicks) / NATIVE_TICKS_PER_SECOND,
    createdTick: receipt.drop.createdTick,
    pickupUnlockTick: receipt.drop.pickupUnlockTick,
    expiresTick: receipt.drop.expiresTick,
    originHash: receipt.drop.originHash,
  });

  return Object.freeze({
    schema: 1,
    cursorBefore: input.cursorBefore,
    cursorAfter: receipt.sequence,
    receiptHash: receipt.receiptHash,
    originInputSequence: receipt.originInputSequence,
    completionTick: receipt.completionTick,
    inventory: Object.freeze({
      slot: receipt.inventory.selectedSlot,
      before,
      after,
      beforeRevision: receipt.inventory.beforeRevision,
      afterRevision: receipt.inventory.afterRevision,
    }),
    drop,
  });
}
