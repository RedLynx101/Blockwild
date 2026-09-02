import {
  BLOCK_ITEM_ALIASES,
  BLOCKS,
  ITEMS,
  BlockId,
  Item,
  type GameMode,
  type InventorySlot,
  type ItemCode,
} from "./data";
import {
  BLOCK_FACING_NORTH,
  isDirectionallyPlacedBlock,
  type BlockFacing,
} from "./block-facing";
import {
  validateRustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2,
  validateRustIntegratedRuntimeNativeBlockEditReceiptV1,
  type RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2,
  type RustIntegratedRuntimeNativeBlockEditReceiptV1,
} from "./rust-integrated-runtime-native-block-edit";
import type { RustIntegratedRuntimeIdentityV1 } from "./rust-integrated-runtime-contract";
import {
  rustBasicDirtCompatibilityStackMatchesV1,
  rustBasicDirtCompatibilityStackV1,
} from "./rust-basic-dirt-browser-projection";
import type { RustIntegratedContainerKeyV1 } from "./rust-integrated-runtime-player-inventory";

const MICROTURN_SCALE = 1_000_000;
const FIXED_POSITION_SCALE = 1_000;

export type RustNativeBlockEditBrowserDropPlanV1 = Readonly<{
  rustEntityId: string;
  item: ItemCode;
  count: number;
  position: Readonly<{ x: number; y: number; z: number }>;
  velocity: Readonly<{ x: number; y: number; z: number }>;
  rotationY: number;
  pickupDelay: number;
}>;

export type RustNativeBlockEditBrowserProjectionPlanV1 = Readonly<{
  schema: 1;
  protocolVersion: 1 | 2;
  legacyFallback: "v1-capability" | "v2-pre-v14" | null;
  cursorBefore: number;
  cursorAfter: number;
  receiptHash: string;
  action: "mine" | "place";
  cell: Readonly<{
    x: number;
    y: number;
    z: number;
    previousBlockId: number;
    blockId: number;
    previousFacing: BlockFacing;
    facing: BlockFacing;
    mutated: boolean;
  }>;
  world: Readonly<{
    beforeRevision: Readonly<{ epoch: number; mutation: number; residency: number }>;
    afterRevision: Readonly<{ epoch: number; mutation: number; residency: number }>;
    beforeHash: string;
    afterHash: string;
  }>;
  inventory: Readonly<{
    slot: number;
    before: InventorySlot | null;
    after: InventorySlot | null;
    beforeRevision: bigint;
    afterRevision: bigint;
  }>;
  drops: readonly RustNativeBlockEditBrowserDropPlanV1[];
  dirty: RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2 | null;
}>;

export class RustNativeBlockEditBrowserProjectionErrorV1 extends Error {
  readonly name = "RustNativeBlockEditBrowserProjectionErrorV1";
}

function fail(message: string): never {
  throw new RustNativeBlockEditBrowserProjectionErrorV1(message);
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

function exactFacing(blockId: number, facing: number, label: string): BlockFacing {
  if (!Number.isSafeInteger(facing) || facing < 0 || facing > 3) {
    return fail(`${label} is outside the compatibility world's cardinal facing range`);
  }
  if (!isDirectionallyPlacedBlock(blockId) && facing !== BLOCK_FACING_NORTH) {
    return fail(`${label} assigns a facing to a non-directional compatibility block`);
  }
  return facing as BlockFacing;
}

const BROWSER_NATIVE_STATIC_SHAPED_BLOCKS_V1 = new Map<number, Readonly<{
  shape: "mooncap" | "shelf" | "barrel";
  directional: boolean;
  expectedItem: ItemCode;
}>>([
  [BlockId.MushroomCap, Object.freeze({ shape: "mooncap", directional: false, expectedItem: BlockId.MushroomCap })],
  [BlockId.WildwoodShelf, Object.freeze({ shape: "shelf", directional: true, expectedItem: Item.WildwoodShelfItem })],
  [BlockId.SealedBarrel, Object.freeze({ shape: "barrel", directional: false, expectedItem: Item.SealedBarrelItem })],
]);

function validateBrowserNativeBlockProfileV1(blockId: number) {
  const profile = BLOCKS[blockId];
  if (!profile) fail("native block-edit receipt references a block absent from the compatibility registry");
  const expectedStaticProfile = BROWSER_NATIVE_STATIC_SHAPED_BLOCKS_V1.get(blockId);
  const shape = profile.shape;
  const directional = isDirectionallyPlacedBlock(blockId);
  if ((expectedStaticProfile !== undefined
    && (shape !== expectedStaticProfile.shape
      || directional !== expectedStaticProfile.directional
      || profile.requiredTier !== 0
      || profile.preferredTool !== "axe"
      || profile.solid !== true
      || !Number.isFinite(profile.hardness)
      || profile.hardness <= 0
      || profile.replaceable !== undefined))
    || (expectedStaticProfile === undefined && shape !== undefined && shape !== "cube")
    || (directional && expectedStaticProfile === undefined)
    || profile.liquid !== undefined
    || profile.waterlogged === true
    || profile.connectGroup !== undefined
    || profile.verticalConnectGroup !== undefined
    || profile.collisionHeight !== undefined) {
    fail("native block-edit receipt requires shaped, dynamic, connected, or liquid compatibility behavior outside the bounded browser slice");
  }
  if (expectedStaticProfile !== undefined) {
    const item = ITEMS[expectedStaticProfile.expectedItem];
    const alias = BLOCK_ITEM_ALIASES[blockId as BlockId];
    if (item === undefined
      || item.placeBlock !== blockId
      || item.maxStack !== 64
      || (expectedStaticProfile.expectedItem === blockId
        ? alias !== undefined && alias !== expectedStaticProfile.expectedItem
        : alias !== expectedStaticProfile.expectedItem)
      || item.plantBlock !== undefined
      || item.useKind !== undefined
      || item.toolKind !== undefined
      || item.maxDurability !== undefined
      || itemHasActionSemanticsV1(item)) {
      fail("native static-shape registry does not preserve the exact inert placement-item binding");
    }
  }
}

function itemHasActionSemanticsV1(item: NonNullable<(typeof ITEMS)[number]>) {
  return item.tier !== undefined
    || item.miningSpeed !== undefined
    || item.damage !== undefined
    || item.infiniteDurability !== undefined
    || item.rarity !== undefined
    || item.legendaryEffect !== undefined
    || item.equipmentSlot !== undefined
    || item.armor !== undefined
    || item.food !== undefined
    || item.fuel !== undefined
    || item.captureLens !== undefined
    || item.shieldKind !== undefined
    || item.blueprintId !== undefined
    || item.potionId !== undefined
    || item.ammoItem !== undefined
    || item.magazineSize !== undefined
    || item.creatureKind !== undefined
    || item.spellId !== undefined
    || item.manaIncrease !== undefined
    || item.dragonType !== undefined
    || item.lairSurvey !== undefined
    || item.dragonModule !== undefined
    || item.bucketLiquid !== undefined;
}

function itemCanCreateExactBlockV1(item: ItemCode, blockId: number) {
  const definition = ITEMS[item];
  return definition !== undefined
    && (definition.placeBlock === blockId
      || definition.plantBlock === blockId
      || BLOCK_ITEM_ALIASES[blockId as BlockId] === item);
}

function sameNativeStackV1(
  left: RustIntegratedRuntimeNativeBlockEditReceiptV1["inventory"]["beforeStack"],
  right: RustIntegratedRuntimeNativeBlockEditReceiptV1["inventory"]["afterStack"],
) {
  return left === null ? right === null : right !== null
    && left.itemCode === right.itemCode
    && left.count === right.count
    && left.durabilityMillionths === right.durabilityMillionths
    && left.metadataHash === right.metadataHash;
}

function sameNativeStackIdentityV1(
  left: NonNullable<RustIntegratedRuntimeNativeBlockEditReceiptV1["inventory"]["beforeStack"]>,
  right: NonNullable<RustIntegratedRuntimeNativeBlockEditReceiptV1["inventory"]["afterStack"]>,
) {
  return left.itemCode === right.itemCode
    && left.durabilityMillionths === right.durabilityMillionths
    && left.metadataHash === right.metadataHash;
}

function validateBrowserNativeStaticShapeCustodyV1(
  receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1,
) {
  if (receipt.action === "place") {
    const before = receipt.inventory.beforeStack;
    if (!before || !itemCanCreateExactBlockV1(before.itemCode, receipt.replacementBlockId)) {
      fail("native block-edit placement item does not map to the exact compatibility block");
    }
    const staticProfile = BROWSER_NATIVE_STATIC_SHAPED_BLOCKS_V1.get(receipt.replacementBlockId);
    if (!staticProfile) return;
    const prior = BLOCKS[receipt.priorBlockId];
    if (receipt.priorFacing !== BLOCK_FACING_NORTH
      || (receipt.priorBlockId !== BlockId.Air
        && (prior === undefined
          || prior.replaceable !== true
          || prior.shape !== undefined
          || isDirectionallyPlacedBlock(receipt.priorBlockId)
          || prior.liquid !== undefined
          || prior.waterlogged === true
          || prior.connectGroup !== undefined
          || prior.verticalConnectGroup !== undefined
          || prior.collisionHeight !== undefined))) {
      fail("native static-shape placement does not replace Air or one exact unshaped static replaceable cell at facing zero");
    }
    if (before.itemCode !== staticProfile.expectedItem) {
      fail("native static-shape placement does not use the exact canonical mapped item");
    }
    if (receipt.creativeMode) {
      if (receipt.inventory.afterRevision !== receipt.inventory.beforeRevision
        || !sameNativeStackV1(before, receipt.inventory.afterStack)) {
        fail("native static-shape Builder placement is not an exact inventory no-op");
      }
      return;
    }
    const after = receipt.inventory.afterStack;
    const exactSuccessor = before.count === 1
      ? after === null
      : after !== null && after.count === before.count - 1 && sameNativeStackIdentityV1(before, after);
    if (receipt.inventory.afterRevision !== receipt.inventory.beforeRevision + BigInt(1)
      || !exactSuccessor) {
      fail("native static-shape Survival placement does not consume one exact mapped item successor");
    }
    return;
  }
  const staticProfile = BROWSER_NATIVE_STATIC_SHAPED_BLOCKS_V1.get(receipt.priorBlockId);
  if (!staticProfile) return;
  if (receipt.replacementBlockId !== BlockId.Air || receipt.replacementFacing !== BLOCK_FACING_NORTH
    || (receipt.priorBlockId === receipt.replacementBlockId && receipt.priorFacing === receipt.replacementFacing)) {
    fail("native static-shape mining is not one real mutation to Air facing zero");
  }
  if (receipt.inventory.afterRevision !== receipt.inventory.beforeRevision
    || !sameNativeStackV1(receipt.inventory.beforeStack, receipt.inventory.afterStack)) {
    fail("native static-shape mining does not preserve selected inventory custody as an exact no-op");
  }
  const expectedDropItem = staticProfile.expectedItem;
  if (receipt.creativeMode) {
    if (receipt.generatedDrops.length !== 0) {
      fail("native static-shape creative mining generated an inventory-bearing drop");
    }
    return;
  }
  if (receipt.generatedDrops.length !== 1
    || receipt.generatedDrops[0]!.stack.itemCode !== expectedDropItem
    || receipt.generatedDrops[0]!.stack.count !== 1) {
    fail("native static-shape mining does not preserve the exact mapped-item drop custody");
  }
}

export const rustNativeBlockEditCompatibilityStackV1 = rustBasicDirtCompatibilityStackV1;
export const rustNativeBlockEditCompatibilityStackMatchesV1 = rustBasicDirtCompatibilityStackMatchesV1;

/**
 * Converts one already-validated native edit receipt into a lossless browser
 * projection plan. The planner rejects every state the compatibility world,
 * inventory, or Three.js drop mirror cannot reconstruct exactly.
 */
export function planRustNativeBlockEditBrowserProjectionV1(input: Readonly<{
  protocolVersion: 1 | 2;
  legacyFallback: "v1-capability" | "v2-pre-v14" | null;
  queryIdentity: RustIntegratedRuntimeIdentityV1;
  receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1;
  dirty: RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2 | null;
  cursorBefore: number;
  expectedInventoryContainer: RustIntegratedContainerKeyV1;
  selectedSlot: number;
  mode: GameMode;
  selectedCompatibilityStack: InventorySlot | null;
}>): RustNativeBlockEditBrowserProjectionPlanV1 {
  const { receipt } = input;
  validateRustIntegratedRuntimeNativeBlockEditReceiptV1(receipt, input.queryIdentity);
  if (input.protocolVersion === 1) {
    if (input.legacyFallback !== "v1-capability" || input.dirty !== null) {
      fail("native block-edit V1 projection has contradictory dirty-evidence custody");
    }
  } else if (input.dirty === null) {
    if (input.legacyFallback !== "v2-pre-v14") {
      fail("native block-edit V2 projection omitted dirty evidence without explicit pre-V14 fallback");
    }
  } else {
    if (input.legacyFallback !== null) {
      fail("native block-edit V2 projection mislabeled Rust dirty evidence as legacy fallback");
    }
    validateRustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2(input.dirty, receipt, input.queryIdentity);
  }
  if (!Number.isSafeInteger(input.cursorBefore) || input.cursorBefore < 0
    || receipt.sequence !== input.cursorBefore + 1) {
    fail("native block-edit receipt is not the exact next browser projection cursor");
  }
  if (!sameContainer(receipt.inventory.container, input.expectedInventoryContainer)) {
    fail("native block-edit receipt belongs to a different player inventory container");
  }
  if (!Number.isSafeInteger(input.selectedSlot) || input.selectedSlot < 0 || input.selectedSlot > 8
    || receipt.inventory.selectedSlot !== input.selectedSlot) {
    fail("native block-edit receipt does not bind the selected compatibility hotbar slot");
  }
  if (receipt.creativeMode !== (input.mode === "builder")) {
    fail("native block-edit receipt creative mode contradicts the compatibility world mode");
  }
  if (!BLOCKS[receipt.priorBlockId] || !BLOCKS[receipt.replacementBlockId]
    || !BLOCKS[receipt.content.blockId]) {
    fail("native block-edit receipt references a block absent from the compatibility registry");
  }
  validateBrowserNativeBlockProfileV1(receipt.content.blockId);
  validateBrowserNativeStaticShapeCustodyV1(receipt);

  const previousFacing = exactFacing(receipt.priorBlockId, receipt.priorFacing, "native prior facing");
  const facing = exactFacing(receipt.replacementBlockId, receipt.replacementFacing, "native replacement facing");
  const mutated = receipt.priorBlockId !== receipt.replacementBlockId || previousFacing !== facing;
  const sameRevision = receipt.beforeWorldRevision.epoch === receipt.afterWorldRevision.epoch
    && receipt.beforeWorldRevision.mutation === receipt.afterWorldRevision.mutation
    && receipt.beforeWorldRevision.residency === receipt.afterWorldRevision.residency;
  const oneMutation = receipt.beforeWorldRevision.epoch === receipt.afterWorldRevision.epoch
    && receipt.beforeWorldRevision.mutation + 1 === receipt.afterWorldRevision.mutation
    && receipt.beforeWorldRevision.residency === receipt.afterWorldRevision.residency;
  if (mutated) {
    if (!oneMutation || receipt.beforeWorldHash === receipt.afterWorldHash) {
      fail("native block-edit mutation does not bind one exact changing R4 world transition");
    }
  } else if (!sameRevision || receipt.beforeWorldHash !== receipt.afterWorldHash) {
    fail("native block-edit no-op harvest changes its R4 world identity");
  }

  const before = rustNativeBlockEditCompatibilityStackV1(
    receipt.inventory.beforeStack,
    "native block-edit before stack",
  );
  const after = rustNativeBlockEditCompatibilityStackV1(
    receipt.inventory.afterStack,
    "native block-edit after stack",
  );
  if (!rustNativeBlockEditCompatibilityStackMatchesV1(input.selectedCompatibilityStack, before)) {
    fail("native block-edit receipt before stack contradicts the selected compatibility slot");
  }

  const drops = Object.freeze(receipt.generatedDrops.map((drop) => {
    const stack = rustNativeBlockEditCompatibilityStackV1(drop.stack, "native block-edit generated drop");
    if (!stack) return fail("native block-edit generated drop unexpectedly decoded as empty");
    const entityId = drop.entityId.toString(10);
    if (!/^[1-9][0-9]*$/u.test(entityId)) {
      return fail("native block-edit generated drop has no positive native entity id");
    }
    if (drop.rotation.pitch !== 0 || drop.rotation.roll !== 0) {
      return fail("native block-edit generated drop uses a rotation the compatibility drop cannot preserve");
    }
    return Object.freeze({
      rustEntityId: entityId,
      item: stack.item,
      count: stack.count,
      position: fixedVectorToBrowser(drop.position, "native block-edit drop position"),
      velocity: fixedVectorToBrowser(drop.velocityMilliPerSecond, "native block-edit drop velocity"),
      rotationY: drop.rotation.yaw / MICROTURN_SCALE * Math.PI * 2,
      // Pickup remains native-owned; this delay mirrors the native-generated
      // entity until its separate pickup receipt advances custody.
      pickupDelay: 0.35,
    });
  }));

  return Object.freeze({
    schema: 1,
    protocolVersion: input.protocolVersion,
    legacyFallback: input.legacyFallback,
    cursorBefore: input.cursorBefore,
    cursorAfter: receipt.sequence,
    receiptHash: receipt.receiptHash,
    action: receipt.action,
    cell: Object.freeze({
      ...receipt.position,
      previousBlockId: receipt.priorBlockId,
      blockId: receipt.replacementBlockId,
      previousFacing,
      facing,
      mutated,
    }),
    world: Object.freeze({
      beforeRevision: Object.freeze({ ...receipt.beforeWorldRevision }),
      afterRevision: Object.freeze({ ...receipt.afterWorldRevision }),
      beforeHash: receipt.beforeWorldHash,
      afterHash: receipt.afterWorldHash,
    }),
    inventory: Object.freeze({
      slot: receipt.inventory.selectedSlot,
      before,
      after,
      beforeRevision: receipt.inventory.beforeRevision,
      afterRevision: receipt.inventory.afterRevision,
    }),
    drops,
    dirty: input.dirty,
  });
}
