import type { InventorySlot, ItemCode } from "./data";
import {
  rustBasicDirtCompatibilityStackMatchesV1,
  rustBasicDirtCompatibilityStackV1,
} from "./rust-basic-dirt-browser-projection";
import {
  rustIntegratedRuntimeDropPickupSourceOriginV1,
  validateRustIntegratedRuntimeDropPickupProjectionV1,
  type RustIntegratedRuntimeDropPickupOriginV1,
  type RustIntegratedRuntimeDropPickupProjectionV1,
} from "./rust-integrated-runtime-drop-pickup";
import type { RustIntegratedContainerKeyV1 } from "./rust-integrated-runtime-player-inventory";
import { rustIntegratedContainerViewKeyV1 } from "./rust-integrated-runtime-player-locator-consume";
import type {
  RustLivePlayerDeathDropR10,
  RustLivePlayerDeathRespawnR10,
} from "./rust-live-player-view-r10";

const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const ZERO_HASH = "0".repeat(32);
const U32_MAX = 0xffff_ffff;
const U64_SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_DEATH_RESPAWN_DROPS = 17;

export type RustNativeDropPickupCompatibilityDropV1 = Readonly<{
  rustEntityId?: string;
  item: ItemCode;
  count: number;
  durability?: number;
  metadata?: Record<string, unknown>;
}>;

export type RustNativeDropPickupBrowserProjectionPlanV1 = Readonly<{
  schema: 1;
  cursorBefore: number;
  cursorAfter: number;
  receiptHash: string;
  completionTick: number;
  rustEntityId: string;
  sourceOrigin: RustIntegratedRuntimeDropPickupOriginV1;
  sourceStack: InventorySlot;
  inventoryBeforeRevision: bigint;
  inventoryAfterRevision: bigint;
  affectedSlots: readonly Readonly<{
    slot: number;
    before: InventorySlot | null;
    after: InventorySlot | null;
  }>[];
}>;

export class RustNativeDropPickupBrowserProjectionErrorV1 extends Error {
  readonly name = "RustNativeDropPickupBrowserProjectionErrorV1";
}

function fail(message: string): never {
  throw new RustNativeDropPickupBrowserProjectionErrorV1(message);
}

function sameContainer(left: RustIntegratedContainerKeyV1, right: RustIntegratedContainerKeyV1) {
  return left.kind === right.kind && left.id === right.id && left.ownerId === right.ownerId;
}

function exactPositiveEntityId(value: bigint, label: string) {
  const text = value.toString(10);
  if (!/^[1-9][0-9]*$/u.test(text)) fail(`${label} is not one positive native entity id`);
  return text;
}

function exactCompatibilityDropMatches(
  actual: RustNativeDropPickupCompatibilityDropV1,
  expectedEntityId: string,
  expectedStack: InventorySlot,
) {
  return actual.rustEntityId === expectedEntityId
    && rustBasicDirtCompatibilityStackMatchesV1(actual, expectedStack);
}

function canonicalNonZeroHash(value: string) {
  return HASH_PATTERN.test(value) && value !== ZERO_HASH;
}

function sameNativeStack(
  left: RustIntegratedRuntimeDropPickupProjectionV1["generatedDrop"]["stack"],
  right: RustLivePlayerDeathDropR10["stack"],
) {
  return left.itemCode === right.itemCode
    && left.count === right.count
    && left.durabilityMillionths === right.durabilityMillionths
    && left.metadataHash === right.metadataHash;
}

function sameFixedVector(
  left: RustIntegratedRuntimeDropPickupProjectionV1["generatedDrop"]["position"],
  right: RustLivePlayerDeathDropR10["position"],
) {
  return Number.isSafeInteger(right.xMilli)
    && Number.isSafeInteger(right.yMilli)
    && Number.isSafeInteger(right.zMilli)
    && left.xMilli === BigInt(right.xMilli)
    && left.yMilli === BigInt(right.yMilli)
    && left.zMilli === BigInt(right.zMilli);
}

function sameRotation(
  left: RustIntegratedRuntimeDropPickupProjectionV1["generatedDrop"]["rotation"],
  right: RustLivePlayerDeathDropR10["rotation"],
) {
  return left.yaw === right.yaw && left.pitch === right.pitch && left.roll === right.roll;
}

function validateRetainedDeathDropContent(child: RustLivePlayerDeathDropR10) {
  const content = child.content;
  if (!canonicalNonZeroHash(child.originHash)
    || !canonicalNonZeroHash(content.configuredManifestHash)
    || !canonicalNonZeroHash(content.installedManifestHash)
    || !canonicalNonZeroHash(content.installedRegistryHash)
    || !canonicalNonZeroHash(content.itemContentHash)
    || content.configuredManifestHash !== content.installedManifestHash
    || !Number.isSafeInteger(content.itemContentVersion)
    || content.itemContentVersion < 1
    || content.itemContentVersion > U32_MAX) {
    fail("retained native death-drop child has invalid content or origin provenance");
  }
}

function joinRetainedDeathDropOrigin(
  receipt: RustIntegratedRuntimeDropPickupProjectionV1,
  origin: Extract<RustIntegratedRuntimeDropPickupOriginV1, { kind: "player-death-drop" }>,
  parent: RustLivePlayerDeathRespawnR10 | null | undefined,
) {
  if (!parent) fail("native death-drop pickup has no explicitly retained death-respawn parent");
  if (parent.respawnSequence < BigInt(1) || parent.respawnSequence > U64_SAFE_MAX
    || parent.respawnSequence !== BigInt(origin.respawnSequence)
    || !canonicalNonZeroHash(parent.receiptHash)
    || parent.receiptHash !== origin.respawnReceiptHash) {
    fail("native death-drop pickup origin differs from its retained death-respawn parent");
  }
  if (!Number.isSafeInteger(parent.generatedDropCount)
    || parent.generatedDropCount < 1
    || parent.generatedDropCount > MAX_DEATH_RESPAWN_DROPS
    || parent.generatedDropCount !== parent.drops.length
    || parent.playerId <= BigInt(0)
    || parent.entityId <= BigInt(0)
    || parent.deathSequence <= BigInt(0)
    || !canonicalNonZeroHash(parent.custodyAfterHash)) {
    fail("retained native death-respawn parent shape has drifted");
  }
  const inventoryChanged = parent.drops.some((child) => child.sourceLane === "inventory");
  const equipmentChanged = parent.drops.some((child) => child.sourceLane === "equipment");
  if (parent.inventoryAfterRevision !== parent.inventoryBeforeRevision + BigInt(Number(inventoryChanged))
    || parent.equipmentAfterRevision !== parent.equipmentBeforeRevision + BigInt(Number(equipmentChanged))) {
    fail("retained native death-respawn parent custody revisions have drifted");
  }

  const matches = parent.drops.filter((child) =>
    child.sourceLane === origin.sourceLane && child.sourceSlot === origin.sourceSlot);
  const child = matches[0];
  if (matches.length !== 1 || !child) {
    fail("native death-drop pickup does not identify exactly one retained parent child");
  }
  validateRetainedDeathDropContent(child);
  if (child.parentRespawnSequence !== parent.respawnSequence
    || child.parentReceiptHash !== parent.receiptHash) {
    fail("retained native death-drop child has drifted from its parent provenance");
  }

  const source = receipt.generatedDrop;
  const laneTag = origin.sourceLane === "inventory" ? 0 : 1;
  const expectedDropId = `player-death-drop-v1:${parent.playerId}:${parent.deathSequence}:${laneTag}:${origin.sourceSlot}`;
  const expectedCustodyId = `player-death-custody-v1:${parent.playerId}:${parent.deathSequence}:${origin.sourceLane}:${origin.sourceSlot}`;
  const expectedCustodyContainer = Object.freeze({
    kind: "container" as const,
    id: expectedCustodyId,
    ownerId: null,
  });
  if (child.dropId !== expectedDropId
    || source.dropId !== child.dropId
    || source.entityId !== child.entityId
    || source.custodyContainer.kind !== expectedCustodyContainer.kind
    || source.custodyContainer.id !== expectedCustodyContainer.id
    || source.custodyContainer.ownerId !== null
    || rustIntegratedContainerViewKeyV1(source.custodyContainer) !== child.custodyContainer
    || source.custodySlot !== child.custodySlot
    || source.custodyBeforeRevision !== child.custodyRevision
    || !sameNativeStack(source.stack, child.stack)) {
    fail("native death-drop pickup source differs from its exact retained child custody");
  }
  if (source.spatialRevision < child.spatialRevision
    || source.spatialRevision === child.spatialRevision
      && (!sameFixedVector(source.position, child.position)
        || !sameFixedVector(source.velocityMilliPerSecond, child.velocityMilliPerSecond)
        || !sameRotation(source.rotation, child.rotation))) {
    fail("native death-drop pickup source does not descend from its retained child transform");
  }
}

function freezeSourceOrigin(origin: RustIntegratedRuntimeDropPickupOriginV1) {
  if (origin.kind === "generated-block-action") {
    return Object.freeze({ kind: origin.kind, provenance: origin.provenance });
  }
  if (origin.kind === "player-drop") {
    return Object.freeze({
      kind: origin.kind,
      playerDropSequence: origin.playerDropSequence,
      playerDropReceiptHash: origin.playerDropReceiptHash,
    });
  }
  return Object.freeze({
    kind: origin.kind,
    respawnSequence: origin.respawnSequence,
    respawnReceiptHash: origin.respawnReceiptHash,
    sourceLane: origin.sourceLane,
    sourceSlot: origin.sourceSlot,
  });
}

/**
 * Converts one already-authoritative native pickup into a fail-closed browser
 * projection plan. Native custody, removal, and capacity decisions remain in
 * Rust; this adapter only accepts exact inventory stacks the compatibility UI
 * can preserve losslessly and one exact previously projected native drop.
 */
export function planRustNativeDropPickupBrowserProjectionV1(input: Readonly<{
  receipt: RustIntegratedRuntimeDropPickupProjectionV1;
  cursorBefore: number;
  expectedUniverseId: string;
  expectedLocationId: string;
  expectedPlayerId: bigint;
  expectedPlayerEntityId: bigint;
  expectedInventoryContainer: RustIntegratedContainerKeyV1;
  compatibilityInventory: readonly (InventorySlot | null)[];
  compatibilityDrops: readonly RustNativeDropPickupCompatibilityDropV1[];
  /** Required only for a `player-death-drop` origin; ignored by legacy origins. */
  retainedDeathRespawn?: RustLivePlayerDeathRespawnR10 | null;
}>): RustNativeDropPickupBrowserProjectionPlanV1 {
  const { receipt } = input;
  validateRustIntegratedRuntimeDropPickupProjectionV1(receipt);
  const sourceOrigin = rustIntegratedRuntimeDropPickupSourceOriginV1(receipt.generatedDrop);
  if (sourceOrigin.kind === "player-death-drop") {
    joinRetainedDeathDropOrigin(receipt, sourceOrigin, input.retainedDeathRespawn);
  }
  if (!Number.isSafeInteger(input.cursorBefore) || input.cursorBefore < 0
    || receipt.sequence !== input.cursorBefore + 1) {
    fail("native pickup receipt is not the exact next browser projection cursor");
  }
  if (receipt.world.universeId !== input.expectedUniverseId
    || receipt.world.locationId !== input.expectedLocationId) {
    fail("native pickup receipt belongs to a different runtime world");
  }
  if (receipt.player.playerId !== input.expectedPlayerId
    || receipt.player.entityId !== input.expectedPlayerEntityId
    || !sameContainer(receipt.player.inventoryContainer, input.expectedInventoryContainer)) {
    fail("native pickup receipt belongs to a different player or inventory container");
  }
  if (receipt.player.afterRevision
    !== receipt.player.beforeRevision + BigInt(receipt.player.affectedSlots.length)) {
    fail("native pickup receipt revisions do not match its exact affected-slot count");
  }

  const seenSlots = new Set<number>();
  const affectedSlots = Object.freeze(receipt.player.affectedSlots.map((affected) => {
    if (!Number.isSafeInteger(affected.slot) || affected.slot < 0
      || affected.slot >= input.compatibilityInventory.length || affected.slot > 8
      || seenSlots.has(affected.slot)) {
      return fail("native pickup receipt contains an invalid or duplicate compatibility slot");
    }
    seenSlots.add(affected.slot);
    const before = rustBasicDirtCompatibilityStackV1(
      affected.beforeStack,
      `native pickup slot ${affected.slot} before stack`,
    );
    const after = rustBasicDirtCompatibilityStackV1(
      affected.afterStack,
      `native pickup slot ${affected.slot} after stack`,
    );
    if (!rustBasicDirtCompatibilityStackMatchesV1(input.compatibilityInventory[affected.slot] ?? null, before)) {
      return fail("native pickup receipt contradicts the compatibility inventory before state");
    }
    return Object.freeze({ slot: affected.slot, before, after });
  }));
  if (affectedSlots.length === 0) fail("native pickup receipt contains no affected player inventory slots");

  const sourceStack = rustBasicDirtCompatibilityStackV1(
    receipt.generatedDrop.stack,
    "native pickup source stack",
  );
  if (!sourceStack) fail("native pickup source unexpectedly decoded as an empty stack");
  const rustEntityId = exactPositiveEntityId(receipt.generatedDrop.entityId, "native pickup source entity");
  const identityMatches = input.compatibilityDrops.filter((drop) => drop.rustEntityId === rustEntityId);
  if (identityMatches.length !== 1
    || !exactCompatibilityDropMatches(identityMatches[0]!, rustEntityId, sourceStack)) {
    fail("native pickup receipt does not remove exactly one matching compatibility drop");
  }

  let acquired = 0;
  for (const affected of affectedSlots) {
    const beforeCount = affected.before?.item === sourceStack.item ? affected.before.count : 0;
    const afterCount = affected.after?.item === sourceStack.item ? affected.after.count : 0;
    if (afterCount < beforeCount
      || affected.before !== null && affected.before.item !== sourceStack.item
      || affected.after !== null && affected.after.item !== sourceStack.item) {
      fail("native pickup receipt changes compatibility inventory outside its exact source stack");
    }
    acquired += afterCount - beforeCount;
  }
  if (acquired !== sourceStack.count) {
    fail("native pickup receipt does not transfer the complete source stack into compatibility inventory");
  }

  return Object.freeze({
    schema: 1,
    cursorBefore: input.cursorBefore,
    cursorAfter: receipt.sequence,
    receiptHash: receipt.receiptHash,
    completionTick: receipt.completionTick,
    rustEntityId,
    sourceOrigin: freezeSourceOrigin(sourceOrigin),
    sourceStack,
    inventoryBeforeRevision: receipt.player.beforeRevision,
    inventoryAfterRevision: receipt.player.afterRevision,
    affectedSlots,
  });
}
