import {
  ITEMS,
  maxStack,
  type GameMode,
  type InventorySlot,
  type ItemCode,
} from "./data";
import {
  validateRustIntegratedRuntimeBasicDirtActionProjectionV1,
  type RustIntegratedRuntimeBasicDirtActionProjectionV1,
} from "./rust-integrated-runtime-basic-dirt-action";
import type {
  RustIntegratedContainerKeyV1,
  RustIntegratedPlayerInventoryStackV1,
} from "./rust-integrated-runtime-player-inventory";

const ZERO_METADATA_HASH = "0".repeat(32);
const MICROTURN_SCALE = 1_000_000;
const FIXED_POSITION_SCALE = 1_000;

export type RustBasicDirtBrowserDropPlanV1 = Readonly<{
  rustEntityId: string;
  item: ItemCode;
  count: number;
  position: Readonly<{ x: number; y: number; z: number }>;
  velocity: Readonly<{ x: number; y: number; z: number }>;
  rotationY: number;
  pickupDelay: number;
}>;

export type RustBasicDirtBrowserProjectionPlanV1 = Readonly<{
  schema: 1;
  cursorBefore: number;
  cursorAfter: number;
  receiptHash: string;
  action: "mine" | "place";
  cell: Readonly<{
    x: number;
    y: number;
    z: number;
    expectedBlockId: number;
    replacementBlockId: number;
  }>;
  inventory: Readonly<{
    slot: number;
    before: InventorySlot | null;
    after: InventorySlot | null;
    beforeRevision: bigint;
    afterRevision: bigint;
  }>;
  drops: readonly RustBasicDirtBrowserDropPlanV1[];
}>;

export class RustBasicDirtBrowserProjectionErrorV1 extends Error {
  readonly name = "RustBasicDirtBrowserProjectionErrorV1";
}

function fail(message: string): never {
  throw new RustBasicDirtBrowserProjectionErrorV1(message);
}

function sameContainer(left: RustIntegratedContainerKeyV1, right: RustIntegratedContainerKeyV1) {
  return left.kind === right.kind && left.id === right.id && left.ownerId === right.ownerId;
}

function exactNumber(value: bigint, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || BigInt(number) !== value) {
    fail(`${label} is not exactly representable by the browser projection`);
  }
  return number;
}

export function rustBasicDirtCompatibilityStackV1(
  stack: RustIntegratedPlayerInventoryStackV1 | null,
  label = "basic Dirt stack",
): InventorySlot | null {
  if (stack === null) return null;
  if (stack.durabilityMillionths !== null || stack.metadataHash !== ZERO_METADATA_HASH) {
    fail(`${label} uses durability or metadata that the compatibility inventory cannot reconstruct exactly`);
  }
  if (!Number.isSafeInteger(stack.itemCode) || !ITEMS[stack.itemCode]
    || !Number.isSafeInteger(stack.count) || stack.count < 1 || stack.count > maxStack(stack.itemCode)) {
    fail(`${label} is not one exact browser inventory stack`);
  }
  return Object.freeze({ item: stack.itemCode, count: stack.count });
}

export function rustBasicDirtCompatibilityStackMatchesV1(
  actual: InventorySlot | null,
  expected: InventorySlot | null,
) {
  if (actual === null || expected === null) return actual === expected;
  return actual.item === expected.item && actual.count === expected.count
    && actual.durability === undefined && actual.metadata === undefined;
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

export function planRustBasicDirtBrowserProjectionV1(input: Readonly<{
  receipt: RustIntegratedRuntimeBasicDirtActionProjectionV1;
  cursorBefore: number;
  expectedInventoryContainer: RustIntegratedContainerKeyV1;
  selectedSlot: number;
  mode: GameMode;
  selectedCompatibilityStack: InventorySlot | null;
}>): RustBasicDirtBrowserProjectionPlanV1 {
  const { receipt } = input;
  validateRustIntegratedRuntimeBasicDirtActionProjectionV1(receipt);
  if (!Number.isSafeInteger(input.cursorBefore) || input.cursorBefore < 0
    || receipt.sequence !== input.cursorBefore + 1) {
    fail("basic Dirt receipt is not the exact next browser projection cursor");
  }
  if (!sameContainer(receipt.inventory.container, input.expectedInventoryContainer)) {
    fail("basic Dirt receipt belongs to a different player inventory container");
  }
  if (receipt.inventory.slot !== input.selectedSlot || receipt.inventory.slot < 0
    || receipt.inventory.slot > 8) {
    fail("basic Dirt receipt does not bind the selected compatibility hotbar slot");
  }
  if (receipt.creativeMode !== (input.mode === "builder")) {
    fail("basic Dirt receipt creative mode contradicts the compatibility world mode");
  }
  const before = rustBasicDirtCompatibilityStackV1(receipt.inventory.beforeStack, "basic Dirt before stack");
  const after = rustBasicDirtCompatibilityStackV1(receipt.inventory.afterStack, "basic Dirt after stack");
  if (!rustBasicDirtCompatibilityStackMatchesV1(input.selectedCompatibilityStack, before)) {
    fail("basic Dirt receipt before stack contradicts the selected compatibility slot");
  }
  if (receipt.inventory.afterRevision < receipt.inventory.beforeRevision
    || receipt.inventory.afterRevision > receipt.inventory.beforeRevision + BigInt(1)) {
    fail("basic Dirt inventory revision does not describe zero or one exact mutation");
  }

  const drops = Object.freeze(receipt.generatedDrops.map((drop) => {
    const stack = rustBasicDirtCompatibilityStackV1(drop.stack, "basic Dirt generated drop");
    if (!stack) return fail("basic Dirt generated drop unexpectedly decoded as empty");
    const entityId = drop.entityId.toString(10);
    if (!/^[1-9][0-9]*$/u.test(entityId)) return fail("basic Dirt generated drop has no positive native entity id");
    if (drop.rotation.pitch !== 0 || drop.rotation.roll !== 0) {
      return fail("basic Dirt generated drop uses a rotation the compatibility drop cannot preserve");
    }
    return Object.freeze({
      rustEntityId: entityId,
      item: stack.item,
      count: stack.count,
      position: fixedVectorToBrowser(drop.position, "basic Dirt drop position"),
      velocity: fixedVectorToBrowser(drop.velocityMilliPerSecond, "basic Dirt drop velocity"),
      rotationY: drop.rotation.yaw / MICROTURN_SCALE * Math.PI * 2,
      // Pickup remains native-owned until a native pickup/despawn receipt seam exists.
      pickupDelay: 0.35,
    });
  }));

  return Object.freeze({
    schema: 1,
    cursorBefore: input.cursorBefore,
    cursorAfter: receipt.sequence,
    receiptHash: receipt.receiptHash,
    action: receipt.action,
    cell: Object.freeze({
      ...receipt.position,
      expectedBlockId: receipt.priorBlockId,
      replacementBlockId: receipt.replacementBlockId,
    }),
    inventory: Object.freeze({
      slot: receipt.inventory.slot,
      before,
      after,
      beforeRevision: receipt.inventory.beforeRevision,
      afterRevision: receipt.inventory.afterRevision,
    }),
    drops,
  });
}
