import {
  rustBasicDirtCompatibilityStackMatchesV1,
  rustBasicDirtCompatibilityStackV1,
} from "./rust-basic-dirt-browser-projection";
import type { GameMode, InventorySlot, ItemCode } from "./data";
import type {
  RustDroppedHotTransformFrameR10,
  RustDroppedHotTransformR10,
} from "./rust-authoritative-extraction-r10";
import type {
  RustLivePlayerDeathDropR10,
  RustLivePlayerDeathRespawnR10,
} from "./rust-live-player-view-r10";

const NATIVE_TICKS_PER_SECOND = 20;
const MICROTURN_SCALE = 1_000_000;
const ZERO_HASH = "0".repeat(32);
const HASH = /^[0-9a-f]{32}$/u;
const POSITIVE_U64_DECIMAL = /^[1-9][0-9]*$/u;

export type RustNativePlayerDeathRespawnBrowserDropPlanV1 = Readonly<{
  sourceLane: "inventory" | "equipment";
  sourceSlot: number;
  dropId: string;
  rustEntityId: string;
  item: ItemCode;
  count: number;
  position: Readonly<{ x: number; y: number; z: number }>;
  velocity: Readonly<{ x: number; y: number; z: number }>;
  rotationY: number;
  pickupDelay: number;
  createdTick: bigint;
  pickupUnlockTick: bigint;
  expiresTick: bigint | null;
  originHash: string;
}>;

export type RustNativePlayerDeathRespawnBrowserProjectionPlanV1 = Readonly<{
  schema: 1;
  cursorBefore: number;
  cursorAfter: number;
  receiptHash: string;
  deathSequence: bigint;
  inventory: Readonly<{
    beforeRevision: bigint;
    afterRevision: bigint;
    cleared: readonly Readonly<{ slot: number; before: InventorySlot }>[];
  }>;
  equipment: Readonly<{
    beforeRevision: bigint;
    afterRevision: bigint;
    cleared: readonly Readonly<{ slot: number; before: InventorySlot }>[];
  }>;
  drops: readonly RustNativePlayerDeathRespawnBrowserDropPlanV1[];
}>;

export class RustNativePlayerDeathRespawnBrowserProjectionErrorV1 extends Error {
  readonly name = "RustNativePlayerDeathRespawnBrowserProjectionErrorV1";
}

function fail(message: string): never {
  throw new RustNativePlayerDeathRespawnBrowserProjectionErrorV1(message);
}

function safeCursor(value: bigint, label: string) {
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 1 || BigInt(cursor) !== value) {
    fail(`${label} is not exactly representable by the browser projection`);
  }
  return cursor;
}

function hash(value: string, label: string) {
  if (!HASH.test(value) || value === ZERO_HASH) fail(`${label} is not a canonical nonzero hash`);
  return value;
}

function metadataHash(value: Uint8Array) {
  if (value.byteLength !== 16) fail("native death-drop hot metadata hash is not 128 bits");
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function compatibilityStack(child: RustLivePlayerDeathDropR10, label: string) {
  try {
    return rustBasicDirtCompatibilityStackV1(child.stack, label);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(detail);
  }
}

function sameFixedPosition(
  left: Readonly<{ x: number; y: number; z: number }>,
  right: Readonly<{ xMilli: number; yMilli: number; zMilli: number }>,
) {
  return Object.is(left.x, right.xMilli / 1_000)
    && Object.is(left.y, right.yMilli / 1_000)
    && Object.is(left.z, right.zMilli / 1_000);
}

function sameFixedVelocity(
  left: Readonly<{ x: number; y: number; z: number }>,
  right: Readonly<{ xMilli: number; yMilli: number; zMilli: number }>,
) {
  return Object.is(left.x, right.xMilli / 1_000)
    && Object.is(left.y, right.yMilli / 1_000)
    && Object.is(left.z, right.zMilli / 1_000);
}

function exactChildTransform(
  child: RustLivePlayerDeathDropR10,
  transform: RustDroppedHotTransformR10,
  authorityTick: bigint,
) {
  if (transform.dropId !== child.dropId
    || transform.entityId !== child.entityId
    || transform.entityRevision <= child.spatialRevision
    || transform.custodyContainer !== child.custodyContainer
    || transform.custodySlot !== child.custodySlot
    || transform.boundContainerRevision !== child.custodyRevision
    || transform.itemCode !== child.stack.itemCode
    || transform.count !== child.stack.count
    || transform.durabilityMillionths !== child.stack.durabilityMillionths
    || metadataHash(transform.metadataHash) !== child.stack.metadataHash
    || transform.createdTick !== child.createdTick
    || transform.expiresTick !== child.expiresTick
    || transform.pickupLockActorId !== child.pickupLockActorId
    || transform.ageTicks !== authorityTick - child.createdTick) {
    fail(`native death drop '${child.dropId}' hot transform is not a descendant of its retained child receipt`);
  }
  // The outer row revision is a semantic hash of the encoded BWX0 row; it is
  // not the WorldView spatial counter and cannot identify the creation row.
  // Age zero is the exact, cross-domain creation boundary. BWX0 carries the
  // canonical fixed-point millimetres directly, while BWR6 is independently
  // checked to round back to those same millimetres during extraction.
  if (transform.ageTicks === BigInt(0)
    && (!sameFixedPosition(transform.position, child.position)
      || !sameFixedVelocity(transform.velocity, child.velocityMilliPerSecond)
      || transform.rotationMicroturns.yaw !== child.rotation.yaw
      || transform.rotationMicroturns.pitch !== child.rotation.pitch
      || transform.rotationMicroturns.roll !== child.rotation.roll)) {
    fail(`native death drop '${child.dropId}' creation transform differs from its retained child receipt`);
  }
  if (transform.rotationMicroturns.pitch !== 0 || transform.rotationMicroturns.roll !== 0) {
    fail(`native death drop '${child.dropId}' exceeds the browser mirror's yaw-only rotation contract`);
  }
  return transform;
}

function planLane(
  lane: "inventory" | "equipment",
  slots: readonly (InventorySlot | null)[],
  children: readonly RustLivePlayerDeathDropR10[],
) {
  const expectedLength = lane === "inventory" ? 9 : 8;
  if (slots.length !== expectedLength) {
    fail(`native death-respawn ${lane} mirror must contain exactly ${expectedLength} slots`);
  }
  const laneChildren = children.filter((child) => child.sourceLane === lane);
  const bySlot = new Map(laneChildren
    .map((child) => [child.sourceSlot, child] as const));
  if (bySlot.size !== laneChildren.length) {
    fail(`native death-respawn ${lane} children reuse a source slot`);
  }
  const cleared: Readonly<{ slot: number; before: InventorySlot }>[] = [];
  for (let slot = 0; slot < slots.length; slot += 1) {
    const actual = slots[slot] ?? null;
    const child = bySlot.get(slot);
    if (actual === null && child !== undefined) {
      fail(`native death-respawn ${lane} child ${slot} has no compatibility source stack`);
    }
    if (actual !== null && child === undefined) {
      fail(`native death-respawn omitted occupied compatibility ${lane} slot ${slot}`);
    }
    if (!child) continue;
    const expected = compatibilityStack(child, `native death ${lane} slot ${slot}`);
    if (!expected || !rustBasicDirtCompatibilityStackMatchesV1(actual, expected)) {
      fail(`native death-respawn ${lane} slot ${slot} contradicts its compatibility source stack`);
    }
    cleared.push(Object.freeze({ slot, before: Object.freeze({ ...expected }) }));
  }
  if (bySlot.size !== cleared.length) {
    fail(`native death-respawn ${lane} children contain an out-of-range source slot`);
  }
  return Object.freeze(cleared);
}

/**
 * Plans the browser half of one already-authoritative false-policy respawn.
 * The full retained parent, same-envelope hot drop frame, prior compatibility
 * custody, and persisted cursor must agree before any caller mutates UI state.
 */
export function planRustNativePlayerDeathRespawnBrowserProjectionV1(input: Readonly<{
  receipt: RustLivePlayerDeathRespawnR10;
  hotFrame: RustDroppedHotTransformFrameR10;
  cursorBefore: number;
  expectedPlayerId: bigint;
  expectedEntityId: bigint;
  expectedInventoryContainer: string;
  expectedEquipmentContainer: string;
  priorInventoryRevision: bigint;
  priorEquipmentRevision: bigint;
  successorInventoryRevision: bigint;
  successorEquipmentRevision: bigint;
  compatibilityInventory: readonly (InventorySlot | null)[];
  compatibilityEquipment: readonly (InventorySlot | null)[];
  existingRustEntityIds: ReadonlySet<string>;
  mode: GameMode;
}>): RustNativePlayerDeathRespawnBrowserProjectionPlanV1 {
  const { receipt, hotFrame } = input;
  if (input.mode !== "survival") fail("native death-respawn browser projection is Survival-only");
  if (!Number.isSafeInteger(input.cursorBefore) || input.cursorBefore < 0) {
    fail("native death-respawn browser cursor is malformed");
  }
  const cursorAfter = safeCursor(receipt.respawnSequence, "native death-respawn receipt sequence");
  if (cursorAfter !== input.cursorBefore + 1) {
    fail("native death-respawn receipt is not the exact next browser projection cursor");
  }
  hash(receipt.receiptHash, "native death-respawn receipt hash");
  hash(receipt.custodyAfterHash, "native death-respawn custody hash");
  if (receipt.playerId !== input.expectedPlayerId
    || receipt.entityId !== input.expectedEntityId
    || receipt.inventoryContainer !== input.expectedInventoryContainer
    || receipt.equipmentContainer !== input.expectedEquipmentContainer
    || receipt.generatedDropCount !== receipt.drops.length
    || receipt.inventoryBeforeRevision !== input.priorInventoryRevision
    || receipt.equipmentBeforeRevision !== input.priorEquipmentRevision
    || receipt.inventoryAfterRevision !== input.successorInventoryRevision
    || receipt.equipmentAfterRevision !== input.successorEquipmentRevision) {
    fail("native death-respawn parent contradicts the active player or custody revisions");
  }

  const inventory = planLane("inventory", input.compatibilityInventory, receipt.drops);
  const equipment = planLane("equipment", input.compatibilityEquipment, receipt.drops);
  const inventoryDelta = inventory.length > 0 ? BigInt(1) : BigInt(0);
  const equipmentDelta = equipment.length > 0 ? BigInt(1) : BigInt(0);
  if (receipt.inventoryAfterRevision !== receipt.inventoryBeforeRevision + inventoryDelta
    || receipt.equipmentAfterRevision !== receipt.equipmentBeforeRevision + equipmentDelta) {
    fail("native death-respawn parent does not describe one exact custody release");
  }

  const hotByEntity = new Map(hotFrame.transforms.map((transform) => [transform.entityId.toString(10), transform]));
  if (hotByEntity.size !== hotFrame.transforms.length) fail("native hot drop frame contains duplicate entity identities");
  const childEntityIds = new Set<string>();
  const drops = Object.freeze(receipt.drops.map((child) => {
    if (child.parentRespawnSequence !== receipt.respawnSequence
      || child.parentReceiptHash !== receipt.receiptHash
      || !child.r6Linked
      || child.entityId <= BigInt(0)
      || child.pickupUnlockTick < child.createdTick
      || !hash(child.originHash, "native death-drop origin hash")) {
      return fail("native death-respawn child is not bound to its retained parent and live R6 entity");
    }
    const rustEntityId = child.entityId.toString(10);
    if (!POSITIVE_U64_DECIMAL.test(rustEntityId)
      || input.existingRustEntityIds.has(rustEntityId)
      || !childEntityIds.add(rustEntityId)) {
      return fail("native death-respawn child reuses a browser or sibling entity identity");
    }
    const transform = hotByEntity.get(rustEntityId);
    if (!transform) return fail(`native death drop '${child.dropId}' has no same-envelope hot transform`);
    exactChildTransform(child, transform, hotFrame.source.authorityTick);
    const stack = compatibilityStack(child, `native death drop '${child.dropId}'`);
    if (!stack) return fail(`native death drop '${child.dropId}' has no compatibility stack`);
    const remainingPickupTicks = child.pickupUnlockTick > hotFrame.source.authorityTick
      ? child.pickupUnlockTick - hotFrame.source.authorityTick
      : BigInt(0);
    const pickupDelay = Number(remainingPickupTicks) / NATIVE_TICKS_PER_SECOND;
    if (!Number.isFinite(pickupDelay) || pickupDelay < 0) {
      return fail(`native death drop '${child.dropId}' pickup delay is not browser-representable`);
    }
    return Object.freeze({
      sourceLane: child.sourceLane,
      sourceSlot: child.sourceSlot,
      dropId: child.dropId,
      rustEntityId,
      item: stack.item,
      count: stack.count,
      position: Object.freeze({ ...transform.position }),
      velocity: Object.freeze({ ...transform.velocity }),
      rotationY: transform.rotationMicroturns.yaw / MICROTURN_SCALE * Math.PI * 2,
      pickupDelay,
      createdTick: child.createdTick,
      pickupUnlockTick: child.pickupUnlockTick,
      expiresTick: child.expiresTick,
      originHash: child.originHash,
    });
  }));

  const represented = new Set([...input.existingRustEntityIds, ...childEntityIds]);
  if (hotFrame.transforms.some((transform) => !represented.has(transform.entityId.toString(10)))
    || [...input.existingRustEntityIds].some((entityId) => !hotByEntity.has(entityId))) {
    fail("native death-respawn hot frame contains an unaccounted added or missing browser drop");
  }

  return Object.freeze({
    schema: 1,
    cursorBefore: input.cursorBefore,
    cursorAfter,
    receiptHash: receipt.receiptHash,
    deathSequence: receipt.deathSequence,
    inventory: Object.freeze({
      beforeRevision: receipt.inventoryBeforeRevision,
      afterRevision: receipt.inventoryAfterRevision,
      cleared: inventory,
    }),
    equipment: Object.freeze({
      beforeRevision: receipt.equipmentBeforeRevision,
      afterRevision: receipt.equipmentAfterRevision,
      cleared: equipment,
    }),
    drops,
  });
}
