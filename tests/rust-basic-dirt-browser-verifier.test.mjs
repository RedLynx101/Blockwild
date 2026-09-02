import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertBasicDirtActionTransaction,
  assertBasicDirtBrowserErrorStreams,
  assertBasicDirtCleanupEvidence,
  assertBasicDirtFreshRestoration,
  assertCompleteTitleMenuRasterEvidence,
  assertCreativeCatalogNativeCustody,
  assertGenericNativeBlockEditFreshRestoration,
  assertGenericNativeBlockEditRecoveryTransaction,
  assertGenericNativeBlockEditTransaction,
  assertGenericShapedPropModeTransition,
  assertNativeBlockEditCheckpointWitness,
  assertNativeDropPickupCheckpointWitness,
  assertNativeDropHotTransformSample,
  assertNativeDirtPickupTransaction,
  assertNativePlayerDropCheckpointWitness,
  assertNativePlayerDropPickupTransaction,
  assertNativePlayerDropTransaction,
  assertRustAuthoredNativeBlockEditDirtySetV2,
  assertSavedNativeDropMatchesHotTransform,
  assertTrustedBasicDirtActionInputs,
  assertTrustedGenericMineInput,
  assertTrustedGenericShapedPropInputs,
  assertTrustedNativePlayerDropInput,
  basicDirtEditTransition,
  composeSplitEmptyCellSupportEvidence,
  expectedEmptyCellRayEvidence,
  expectedUntargetedEmptyCellRayEvidence,
  GENERIC_GRASS_ACTION_WORLD_FIXTURE,
  GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE,
  nativeBlockEditTransition,
  immutableBasicDirtTreeSnapshot,
  inspectSurvivalCreationEdits,
  isReadyR5AuthorityCheckpoint,
  nativeBlockEditDirtyEvidenceHashV2,
  NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2,
  parseBasicDirtBrowserOptions,
  safeRemoveBasicDirtOwnedDirectory,
  usage,
} from "../scripts/verify-rust-basic-dirt-action-browser.mjs";

const RECEIPT_ONE = "11".repeat(16);
const RECEIPT_TWO = "22".repeat(16);
const RECEIPT_THREE = "33".repeat(16);
const PICKUP_RECEIPT = "44".repeat(16);
const PICKUP_IDENTITY = "55".repeat(16);
const PLAYER_DROP_RECEIPT = "66".repeat(16);
const MEADOW_GRASS_BLOCK_ID = GENERIC_GRASS_ACTION_WORLD_FIXTURE.expectedBlockTransition.expectedPreviousBlockId;
const MEADOW_GRASS_ITEM_ID = GENERIC_GRASS_ACTION_WORLD_FIXTURE.generatedDrop.item;
const PLAYER_PICKUP_RECEIPT = "77".repeat(16);
const BASIC_ACTION_IDENTITY = "aa".repeat(16);
const EDIT_INDEX = 1 + 13 * 16 + (35 - (-64)) * 16 * 16;
const COORDINATE = Object.freeze([1, 35, -3]);
const GRASS_EDIT_INDEX = 1 + 13 * 16 + (36 - (-64)) * 16 * 16;
const GRASS_COORDINATE = Object.freeze([1, 36, -3]);
const SHELF_BLOCK_ID = GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.expectedBlockTransition.placedBlockId;
const SHELF_ITEM_ID = GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.selectedStack.item;
const SHELF_COORDINATE = GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.placementCoordinate;
const SHELF_EDIT_INDEX = 2 + 12 * 16 + (37 - (-64)) * 16 * 16;
const ACQUIRED_DROP_ID = "4294967297";
const FINAL_DROP_ID = "4294967298";
const PLAYER_DROP_ID = "4294967299";

function tempRepository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "blockwild-basic-dirt-verifier-"));
  mkdirSync(path.join(root, "docs"));
  mkdirSync(path.join(root, "work"));
  mkdirSync(path.join(root, "public", "engine-locator-candidate"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), "{}\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const starterStack = () => ({ item: 124, count: 3 });
const dirtStack = () => ({ item: 2, count: 1 });
const inventory = (slotOne = null, slotZero = starterStack()) => [slotZero, slotOne, ...Array.from({ length: 34 }, () => null)];

function checkpointIdentity(persistence, stateHash) {
  return {
    universeId: "world-basic-dirt",
    locationId: "overworld",
    revision: {
      epoch: 1, world: 2, entities: 3, gameplay: 4, persistence, network: 5, simulation: 6,
    },
    tick: 70,
    stateHash,
  };
}

function nativeBlockEditDirtyEvidence({
  sequence,
  receiptHash,
  coordinate = GRASS_COORDINATE,
  universeId = "world-basic-dirt",
  locationId = "overworld",
} = {}) {
  const [x, y, z] = coordinate;
  const value = {
    schema: 1,
    sequence,
    receiptHash,
    sections: [{
      universeId,
      locationId,
      chunkX: Math.floor(x / 16),
      chunkZ: Math.floor(z / 16),
      sectionY: Math.floor((y - (-64)) / 16),
    }],
    columns: [{ x, z }],
    subsystemSeeds: NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2.map((subsystem, index) => ({
      subsystem,
      seed: String(index + 1).padStart(2, "0").repeat(16),
    })),
    evidenceHash: "00".repeat(16),
  };
  value.evidenceHash = nativeBlockEditDirtyEvidenceHashV2(value);
  return value;
}

test("title screenshot raster evidence requires every expected label to be visibly painted", () => {
  const expectedLabels = ["New World", "Continue"];
  const complete = {
    schema: 1,
    imageWidth: 1280,
    imageHeight: 720,
    labels: expectedLabels.map((label) => ({ label, brightPixels: 32, totalPixels: 512 })),
  };
  assert.equal(assertCompleteTitleMenuRasterEvidence(complete, expectedLabels, 12), complete);
  const missingPaint = structuredClone(complete);
  missingPaint.labels[0].brightPixels = 0;
  assert.throws(
    () => assertCompleteTitleMenuRasterEvidence(missingPaint, expectedLabels, 12),
    /New World is not visibly painted/u,
  );
  const wrongLabel = structuredClone(complete);
  wrongLabel.labels[1].label = "Settings";
  assert.throws(
    () => assertCompleteTitleMenuRasterEvidence(wrongLabel, expectedLabels, 12),
    /does not match Continue/u,
  );
});

function playerDropCheckpointWitness(afterSaves, receiptHash = PLAYER_DROP_RECEIPT) {
  const beforeSaves = afterSaves - 1;
  const worldId = "world:world-basic-dirt@overworld";
  const identityBefore = checkpointIdentity(beforeSaves, "ab".repeat(16));
  return {
    schema: 1,
    cursorBefore: 0,
    cursorAfter: 1,
    receiptHash,
    queryIdentityHash: identityBefore.stateHash,
    identityBefore,
    identityAfter: checkpointIdentity(afterSaves + 1, "cd".repeat(16)),
    persistenceBefore: {
      worldId, state: "open", saves: beforeSaves, recoveries: 0,
      legacyMigrations: 0, legacyMigrationRetries: 0, parentFallbacks: 0,
      platformOperations: beforeSaves + 20, requestBytes: 100, responseBytes: 10,
      lastCheckpointId: `checkpoint-${beforeSaves}`, lastError: null,
    },
    persistenceAfter: {
      worldId, state: "open", saves: afterSaves, recoveries: 0,
      legacyMigrations: 0, legacyMigrationRetries: 0, parentFallbacks: 0,
      platformOperations: afterSaves + 20, requestBytes: 200, responseBytes: 20,
      lastCheckpointId: `checkpoint-${afterSaves}`, lastError: null,
    },
    checkpoint: {
      worldId, saveId: `native.save.${afterSaves}`, checkpointId: `checkpoint-${afterSaves}`,
      checkpointHash: "ef".repeat(16), journalSequence: afterSaves,
      records: 7, commits: 1, requestBytes: 100, responseBytes: 10,
    },
  };
}

function dropPickupCheckpointWitness(afterSaves, {
  cursorBefore = 0,
  cursorAfter = cursorBefore + 1,
  receiptHash = cursorAfter === 1 ? PICKUP_RECEIPT : PLAYER_PICKUP_RECEIPT,
  rustEntityId = cursorAfter === 1 ? ACQUIRED_DROP_ID : PLAYER_DROP_ID,
} = {}) {
  return {
    ...playerDropCheckpointWitness(afterSaves, receiptHash),
    cursorBefore,
    cursorAfter,
    receiptHash,
    rustEntityId,
  };
}

function blockEditCheckpointWitness(afterSaves, {
  cursorBefore,
  cursorAfter,
  receiptHash,
  action,
  coordinate = COORDINATE,
  previousBlockId = action === "mine" ? 2 : 0,
  blockId = action === "mine" ? 0 : 2,
  previousFacing = 0,
  facing = 0,
  protocolVersion = 1,
  legacyFallback = protocolVersion === 1 ? "v1-capability" : null,
  dirty = protocolVersion === 2
    ? nativeBlockEditDirtyEvidence({ sequence: cursorAfter, receiptHash, coordinate })
    : null,
}) {
  const base = playerDropCheckpointWitness(afterSaves, receiptHash);
  const identityBefore = checkpointIdentity(afterSaves - 1, BASIC_ACTION_IDENTITY);
  return {
    ...base,
    cursorBefore,
    cursorAfter,
    receiptHash,
    protocolVersion,
    legacyFallback,
    dirty,
    queryIdentityHash: identityBefore.stateHash,
    identityBefore,
    action,
    cell: {
      x: coordinate[0], y: coordinate[1], z: coordinate[2],
      previousBlockId,
      blockId,
      previousFacing,
      facing,
      mutated: true,
    },
  };
}

function nativeDrop(rustEntityId, age = 0) {
  return {
    item: 2, count: 1, x: 1.125, y: 35.75, z: -2.75, age, rustEntityId,
    rotationY: 1.25, vx: 0.125, vy: 1.75, vz: -0.25, pickupDelay: 0.35,
  };
}

function nativeBerryDrop(rustEntityId, age = 0) {
  return { ...nativeDrop(rustEntityId, age), item: 124 };
}

function nativeMeadowGrassDrop(rustEntityId, age = 0) {
  return { ...nativeDrop(rustEntityId, age), item: MEADOW_GRASS_ITEM_ID };
}

function nativeWildwoodShelfDrop(rustEntityId, age = 0) {
  return { ...nativeDrop(rustEntityId, age), item: SHELF_ITEM_ID };
}

function playerGameModeSetWitness({
  priorMode = "builder",
  resultingMode = "survival",
  priorFlags = 3,
  resultingFlags = 0,
  simulationRevisionBefore = 11,
  simulationRevisionAfter = simulationRevisionBefore + 1,
  stateHashBefore = "88".repeat(16),
  stateHashAfter = "99".repeat(16),
  savesBefore = 4,
  savesAfter = savesBefore + 1,
  commits = 1,
  platformOperationsBefore = 24,
  platformOperationsAfter = platformOperationsBefore + commits,
  persistenceRevisionBefore = 8,
  persistenceRevisionAfter = 10,
  checkpointId = `checkpoint-${savesAfter}`,
} = {}) {
  return {
    schema: 1,
    requestPayloadHash: "aa".repeat(16),
    receiptHash: "bb".repeat(16),
    priorMode,
    resultingMode,
    priorFlags,
    resultingFlags,
    identityBefore: { simulationRevision: simulationRevisionBefore, stateHash: stateHashBefore },
    identityAfter: { simulationRevision: simulationRevisionAfter, stateHash: stateHashAfter },
    checkpoint: {
      checkpointId,
      checkpointHash: "cc".repeat(16),
      commits,
      savesBefore,
      savesAfter,
      platformOperationsBefore,
      platformOperationsAfter,
      persistenceRevisionBefore,
      persistenceRevisionAfter,
    },
  };
}

function edits(type = null, index = EDIT_INDEX) {
  return type === null ? {} : { "0,-1": [[index, type]] };
}

function snapshot({
  cursor, hash, pickupCursor = 0, pickupHash = null,
  playerDropCursor = 0, playerDropHash = null, editType, saves, drops = [],
  selected = 0, slotOne = null, slotZero = starterStack(), hydration = "new-world", recoveries = 0,
  editIndex = EDIT_INDEX, coordinate = COORDINATE,
  previousBlockId = editType === 2 ? 0 : 2,
  action = editType === 0 ? "mine" : "place",
  previousFacing = 0,
  facing = 0,
  flying = false,
  mode = "survival",
  blockFacings = facing === 0 ? {} : { [coordinate.join(",")]: facing },
  inventoryDomainRevision = "7",
  blockEditProtocolVersion = 1,
  gameModeSetCalls = 0,
  lastGameModeSet = null,
}) {
  const slots = inventory(slotOne, slotZero);
  const authoritativeFlags = (mode === "builder" ? 1 : 0) | (flying ? 2 : 0);
  const held = slots[selected];
  return {
    state: {
      state: "playing",
      player: { position: [3, 34.51, -2], yaw: 0.75, pitch: -0.4, mode, flying },
      inventory: { selectedSlot: selected, held: slots[selected] },
      drops: drops.map((drop) => ({
        item: drop.item, count: drop.count, rustEntityId: drop.rustEntityId,
        position: [drop.x, drop.y, drop.z],
        velocity: [drop.vx, drop.vy, drop.vz],
        rotationY: drop.rotationY,
        age: drop.age,
        pickupDelay: drop.pickupDelay,
      })),
    },
    runtime: {
      ready: true,
      hydration,
      playerAuthority: {
        state: "ready",
        advanceInFlight: false,
        pendingRendererExtraction: false,
        gameModeSetCalls,
        lastGameModeSet,
        nativeBlockEditProjection: { schema: 1, cursor, lastReceiptHash: hash },
        nativeBlockEditCheckpoint: cursor > 0
          ? blockEditCheckpointWitness(saves, {
            cursorBefore: cursor - 1,
            cursorAfter: cursor,
            receiptHash: hash,
            action,
            coordinate,
            previousBlockId,
            blockId: editType,
            previousFacing,
            facing,
            protocolVersion: blockEditProtocolVersion,
          })
          : null,
        dropPickupProjection: { schema: 1, cursor: pickupCursor, lastReceiptHash: pickupHash },
        dropPickupCheckpoint: pickupCursor > 0
          ? dropPickupCheckpointWitness(saves, {
            cursorBefore: pickupCursor - 1,
            cursorAfter: pickupCursor,
            receiptHash: pickupHash,
          })
          : null,
        playerDropProjection: { schema: 1, cursor: playerDropCursor, lastReceiptHash: playerDropHash },
        playerDropCheckpoint: playerDropCursor > 0
          ? playerDropCheckpointWitness(saves, playerDropHash)
          : null,
        nativeDropTransforms: {
          extractionRevision: "10",
          authorityTick: "20",
          inventoryDomainRevision,
          transforms: drops.map((drop, index) => ({
            dropId: `fixture-drop:${drop.rustEntityId}`,
            entityId: drop.rustEntityId,
            entityRevision: String(index + 1),
            position: { x: drop.x, y: drop.y, z: drop.z },
            velocity: { x: drop.vx, y: drop.vy, z: drop.vz },
            yawRadians: drop.rotationY,
            ageTicks: String(Math.round(drop.age / 0.05)),
          })),
        },
        nativeInventory: {
          extractionRevision: "10",
          inventoryContainer: "container-key-v1/player:fixture",
          inventoryContainerRevision: inventoryDomainRevision,
          selectedSlot: selected,
          held: held === null ? null : {
            itemCode: held.item,
            count: held.count,
            durabilityMillionths: null,
            metadataHash: "0".repeat(32),
          },
        },
        pump: {
          state: "ready",
          queuedAdvances: 0,
          inFlight: false,
          nativeInputPending: false,
          queuedContextCommands: 0,
          nativeBlockEditQueryConfigured: true,
          nativeBlockEditCursor: cursor,
          nativeBlockEditLegacySeedPending: false,
          nativeBlockEditQueryCalls: 1,
          pendingNativeBlockEditSequence: null,
          pendingNativeBlockEditReceiptHash: null,
          pendingNativeBlockEditIdentityHash: null,
          lastAcknowledgedNativeBlockEditSequence: cursor === 0 ? null : cursor,
          lastAcknowledgedNativeBlockEditReceiptHash: cursor === 0 ? null : hash,
          basicDirtActionQueryConfigured: false,
          basicDirtActionQuerySuppressedByNativeBlockEdit: false,
          basicDirtActionCursor: null,
          basicDirtActionLegacySeedPending: false,
          basicDirtActionQueryCalls: 0,
          dropPickupQueryConfigured: true,
          dropPickupCursor: pickupCursor,
          dropPickupLegacySeedPending: false,
          pendingDropPickupSequence: null,
          pendingDropPickupReceiptHash: null,
          pendingDropPickupIdentityHash: null,
          lastAcknowledgedDropPickupSequence: pickupCursor === 0 ? null : pickupCursor,
          lastAcknowledgedDropPickupReceiptHash: pickupCursor === 0 ? null : pickupHash,
          playerDropQueryConfigured: true,
          playerDropCursor,
          playerDropLegacySeedPending: false,
          pendingPlayerDropSequence: null,
          pendingPlayerDropReceiptHash: null,
          pendingPlayerDropIdentityHash: null,
          lastAcknowledgedPlayerDropSequence: playerDropCursor === 0 ? null : playerDropCursor,
          lastAcknowledgedPlayerDropReceiptHash: playerDropCursor === 0 ? null : playerDropHash,
          selectedSlot: selected,
          authoritativeFlags,
        },
      },
      multiplayer: { presentation: { authorityOperations: 0 } },
      manager: { host: {
        adapter: { capabilities: ["native-block-edit-receipt-v1", "player-game-mode-set-v1"] },
        nativePersistence: {
          worldId: "world:world-basic-dirt@overworld", state: "open", saves, recoveries,
          legacyMigrations: 0, legacyMigrationRetries: 0, parentFallbacks: 0,
          platformOperations: saves + 20, requestBytes: 200, responseBytes: 20,
          lastCheckpointId: `checkpoint-${saves}`, lastError: null,
        },
      } },
    },
    storage: {
      activeWorldId: "world-basic-dirt",
      save: {
        seed: "PINE-HOLLOW-105", mode,
        player: { x: 3, y: 34.51, z: -2, yaw: 0.75, pitch: -0.4 },
        inventory: slots, selected, edits: edits(editType, editIndex), blockFacings, drops,
        rustNativeBlockEditProjection: { schema: 1, cursor, lastReceiptHash: hash },
        rustNativeDropPickupProjection: { schema: 1, cursor: pickupCursor, lastReceiptHash: pickupHash },
        rustNativePlayerDropProjection: {
          schema: 1, cursor: playerDropCursor, lastReceiptHash: playerDropHash,
        },
      },
    },
    audit: { nextWriteOrdinal: 0, worldDocumentWrites: [] },
  };
}

function pendingActionWrite({
  ordinal, cursorBefore, cursorAfter, hash, pickupCursor = 0, pickupHash = null,
  editType, saves, drops = [], selected, slotOne, slotZero = starterStack(), editIndex = EDIT_INDEX,
  coordinate = COORDINATE, previousBlockId = editType === 2 ? 0 : 2,
  action = editType === 0 ? "mine" : "place",
  previousFacing = 0,
  facing = 0,
  mode = "survival",
  blockFacings = facing === 0 ? {} : { [coordinate.join(",")]: facing },
  inventoryDomainRevision = String(ordinal + 1),
  blockEditProtocolVersion = 1,
}) {
  const slots = inventory(slotOne, slotZero);
  const checkpointWitness = blockEditCheckpointWitness(saves, {
    cursorBefore,
    cursorAfter,
    receiptHash: hash,
    action,
    coordinate,
    previousBlockId,
    blockId: editType,
    previousFacing,
    facing,
    protocolVersion: blockEditProtocolVersion,
  });
  return {
    ordinal, at: ordinal + 0.5,
    save: {
      seed: "PINE-HOLLOW-105",
      mode,
      player: { x: 3, y: 34.51, z: -2, yaw: 0.75, pitch: -0.4 },
      inventory: slots, selected, edits: edits(editType, editIndex), blockFacings, drops,
      rustNativeBlockEditProjection: { schema: 1, cursor: cursorAfter, lastReceiptHash: hash },
      rustNativeDropPickupProjection: { schema: 1, cursor: pickupCursor, lastReceiptHash: pickupHash },
      rustNativePlayerDropProjection: { schema: 1, cursor: 0, lastReceiptHash: null },
    },
    runtime: {
      playerAuthority: {
        nativeBlockEditProjection: { schema: 1, cursor: cursorAfter, lastReceiptHash: hash },
        nativeBlockEditCheckpoint: checkpointWitness,
        dropPickupProjection: { schema: 1, cursor: pickupCursor, lastReceiptHash: pickupHash },
        nativeDropTransforms: {
          extractionRevision: String(ordinal + 1),
          authorityTick: String(ordinal + 1),
          inventoryDomainRevision,
          transforms: drops
            .filter((drop) => typeof drop.rustEntityId === "string")
            .map((drop, index) => ({
              dropId: `fixture-drop:${drop.rustEntityId}`,
              entityId: drop.rustEntityId,
              entityRevision: String(index + 1),
              position: { x: drop.x, y: drop.y, z: drop.z },
              velocity: { x: drop.vx, y: drop.vy, z: drop.vz },
              yawRadians: drop.rotationY,
              ageTicks: String(Math.round(drop.age / 0.05)),
            })),
        },
        pump: {
          nativeBlockEditQueryConfigured: true,
          nativeBlockEditCursor: cursorBefore,
          nativeBlockEditLegacySeedPending: false,
          nativeBlockEditQueryCalls: 1,
          pendingNativeBlockEditSequence: cursorAfter,
          pendingNativeBlockEditReceiptHash: hash,
          pendingNativeBlockEditIdentityHash: BASIC_ACTION_IDENTITY,
          basicDirtActionQueryConfigured: false,
          basicDirtActionQuerySuppressedByNativeBlockEdit: false,
          basicDirtActionCursor: null,
          basicDirtActionLegacySeedPending: false,
          basicDirtActionQueryCalls: 0,
          dropPickupCursor: pickupCursor,
          pendingDropPickupSequence: null,
          pendingDropPickupReceiptHash: null,
          pendingDropPickupIdentityHash: null,
        },
      },
      manager: { host: { nativePersistence: checkpointWitness.persistenceAfter } },
    },
  };
}

function pendingActionPredecessorWrite({
  ordinal, saves, cursorBefore, cursorAfter, beforeHash, pendingHash,
  pickupCursor = 0, pickupHash = null, editType, drops = [], selected, slotOne,
}) {
  const write = pendingActionWrite({
    ordinal, saves, cursorBefore, cursorAfter, hash: pendingHash,
    pickupCursor, pickupHash, editType, drops, selected, slotOne,
  });
  write.save.rustNativeBlockEditProjection = {
    schema: 1, cursor: cursorBefore, lastReceiptHash: beforeHash,
  };
  write.runtime.playerAuthority.nativeBlockEditProjection = {
    schema: 1, cursor: cursorBefore, lastReceiptHash: beforeHash,
  };
  write.runtime.playerAuthority.nativeBlockEditCheckpoint = null;
  return write;
}

function pendingPickupWrite({ ordinal, saves, cursorAfter = 1 }) {
  const checkpointWitness = dropPickupCheckpointWitness(saves, {
    cursorBefore: 0,
    cursorAfter: 1,
    receiptHash: PICKUP_RECEIPT,
    rustEntityId: ACQUIRED_DROP_ID,
  });
  return {
    ordinal, at: ordinal + 0.5,
    save: {
      inventory: inventory(dirtStack()), selected: 0, edits: edits(0), drops: [],
      rustNativeBlockEditProjection: { schema: 1, cursor: 1, lastReceiptHash: RECEIPT_ONE },
      rustNativeDropPickupProjection: {
        schema: 1, cursor: cursorAfter, lastReceiptHash: cursorAfter === 1 ? PICKUP_RECEIPT : null,
      },
    },
    runtime: {
      playerAuthority: {
        nativeBlockEditProjection: { schema: 1, cursor: 1, lastReceiptHash: RECEIPT_ONE },
        dropPickupProjection: {
          schema: 1, cursor: cursorAfter, lastReceiptHash: cursorAfter === 1 ? PICKUP_RECEIPT : null,
        },
        dropPickupCheckpoint: checkpointWitness,
        pump: {
          nativeBlockEditCursor: 1,
          dropPickupCursor: 0,
          pendingDropPickupSequence: 1,
          pendingDropPickupReceiptHash: PICKUP_RECEIPT,
          pendingDropPickupIdentityHash: checkpointWitness.queryIdentityHash,
        },
      },
      manager: { host: { nativePersistence: checkpointWitness.persistenceAfter } },
    },
  };
}

function pendingPickupPredecessorWrite({ ordinal, saves, sourceDrop }) {
  return {
    ordinal, at: ordinal + 0.5,
    save: {
      inventory: inventory(), selected: 0, edits: edits(0), drops: [sourceDrop],
      rustNativeBlockEditProjection: { schema: 1, cursor: 1, lastReceiptHash: RECEIPT_ONE },
      rustNativeDropPickupProjection: { schema: 1, cursor: 0, lastReceiptHash: null },
    },
    runtime: {
      playerAuthority: {
        nativeBlockEditProjection: { schema: 1, cursor: 1, lastReceiptHash: RECEIPT_ONE },
        dropPickupProjection: { schema: 1, cursor: 0, lastReceiptHash: null },
        pump: {
          nativeBlockEditCursor: 1,
          dropPickupCursor: 0,
          pendingDropPickupSequence: 1,
          pendingDropPickupReceiptHash: PICKUP_RECEIPT,
          pendingDropPickupIdentityHash: PICKUP_IDENTITY,
        },
      },
      manager: { host: { nativePersistence: { saves } } },
    },
  };
}

function pendingPlayerDropWrite({ ordinal, saves, sourceDrop, retainedDrop = nativeDrop(FINAL_DROP_ID, 1) }) {
  const checkpointWitness = playerDropCheckpointWitness(saves);
  return {
    ordinal, at: ordinal + 0.5,
    save: {
      inventory: inventory(null, { item: 124, count: 2 }), selected: 0,
      edits: edits(0), drops: [retainedDrop, sourceDrop],
      rustNativeBlockEditProjection: { schema: 1, cursor: 3, lastReceiptHash: RECEIPT_THREE },
      rustNativeDropPickupProjection: { schema: 1, cursor: 1, lastReceiptHash: PICKUP_RECEIPT },
      rustNativePlayerDropProjection: { schema: 1, cursor: 1, lastReceiptHash: PLAYER_DROP_RECEIPT },
    },
    runtime: {
      playerAuthority: {
        nativeBlockEditProjection: { schema: 1, cursor: 3, lastReceiptHash: RECEIPT_THREE },
        dropPickupProjection: { schema: 1, cursor: 1, lastReceiptHash: PICKUP_RECEIPT },
        playerDropProjection: { schema: 1, cursor: 1, lastReceiptHash: PLAYER_DROP_RECEIPT },
        playerDropCheckpoint: checkpointWitness,
        pump: {
          nativeBlockEditCursor: 3,
          dropPickupCursor: 1,
          playerDropCursor: 0,
          pendingPlayerDropSequence: 1,
          pendingPlayerDropReceiptHash: PLAYER_DROP_RECEIPT,
          pendingPlayerDropIdentityHash: checkpointWitness.queryIdentityHash,
        },
      },
      manager: { host: { nativePersistence: checkpointWitness.persistenceAfter } },
    },
  };
}

function pendingPlayerDropPredecessorWrite({ ordinal, saves, retainedDrop = nativeDrop(FINAL_DROP_ID, 1) }) {
  return {
    ordinal, at: ordinal + 0.5,
    save: {
      inventory: inventory(), selected: 0, edits: edits(0), drops: [retainedDrop],
      rustNativeBlockEditProjection: { schema: 1, cursor: 3, lastReceiptHash: RECEIPT_THREE },
      rustNativeDropPickupProjection: { schema: 1, cursor: 1, lastReceiptHash: PICKUP_RECEIPT },
      rustNativePlayerDropProjection: { schema: 1, cursor: 0, lastReceiptHash: null },
    },
    runtime: {
      playerAuthority: {
        nativeBlockEditProjection: { schema: 1, cursor: 3, lastReceiptHash: RECEIPT_THREE },
        dropPickupProjection: { schema: 1, cursor: 1, lastReceiptHash: PICKUP_RECEIPT },
        playerDropProjection: { schema: 1, cursor: 0, lastReceiptHash: null },
        pump: {
          nativeBlockEditCursor: 3,
          dropPickupCursor: 1,
          playerDropCursor: 0,
          pendingPlayerDropSequence: 1,
          pendingPlayerDropReceiptHash: PLAYER_DROP_RECEIPT,
          pendingPlayerDropIdentityHash: "88".repeat(16),
        },
      },
      manager: { host: { nativePersistence: { saves, lastCheckpointId: `checkpoint-${saves}` } } },
    },
  };
}

function pendingPlayerPickupWrite({ ordinal, saves, retainedDrop }) {
  const checkpointWitness = dropPickupCheckpointWitness(saves, {
    cursorBefore: 1,
    cursorAfter: 2,
    receiptHash: PLAYER_PICKUP_RECEIPT,
    rustEntityId: PLAYER_DROP_ID,
  });
  return {
    ordinal, at: ordinal + 0.5,
    save: {
      inventory: inventory(), selected: 0, edits: edits(0), drops: [retainedDrop],
      rustNativeBlockEditProjection: { schema: 1, cursor: 3, lastReceiptHash: RECEIPT_THREE },
      rustNativeDropPickupProjection: { schema: 1, cursor: 2, lastReceiptHash: PLAYER_PICKUP_RECEIPT },
      rustNativePlayerDropProjection: { schema: 1, cursor: 1, lastReceiptHash: PLAYER_DROP_RECEIPT },
    },
    runtime: {
      playerAuthority: {
        nativeBlockEditProjection: { schema: 1, cursor: 3, lastReceiptHash: RECEIPT_THREE },
        dropPickupProjection: { schema: 1, cursor: 2, lastReceiptHash: PLAYER_PICKUP_RECEIPT },
        playerDropProjection: { schema: 1, cursor: 1, lastReceiptHash: PLAYER_DROP_RECEIPT },
        dropPickupCheckpoint: checkpointWitness,
        pump: {
          nativeBlockEditCursor: 3,
          dropPickupCursor: 1,
          playerDropCursor: 1,
          pendingDropPickupSequence: 2,
          pendingDropPickupReceiptHash: PLAYER_PICKUP_RECEIPT,
          pendingDropPickupIdentityHash: checkpointWitness.queryIdentityHash,
        },
      },
      manager: { host: { nativePersistence: checkpointWitness.persistenceAfter } },
    },
  };
}

function pendingPlayerPickupPredecessorWrite({ ordinal, saves, retainedDrop, sourceDrop }) {
  return {
    ordinal, at: ordinal + 0.5,
    save: {
      inventory: inventory(null, { item: 124, count: 2 }), selected: 0,
      edits: edits(0), drops: [retainedDrop, sourceDrop],
      rustNativeBlockEditProjection: { schema: 1, cursor: 3, lastReceiptHash: RECEIPT_THREE },
      rustNativeDropPickupProjection: { schema: 1, cursor: 1, lastReceiptHash: PICKUP_RECEIPT },
      rustNativePlayerDropProjection: { schema: 1, cursor: 1, lastReceiptHash: PLAYER_DROP_RECEIPT },
    },
    runtime: {
      playerAuthority: {
        nativeBlockEditProjection: { schema: 1, cursor: 3, lastReceiptHash: RECEIPT_THREE },
        dropPickupProjection: { schema: 1, cursor: 1, lastReceiptHash: PICKUP_RECEIPT },
        playerDropProjection: { schema: 1, cursor: 1, lastReceiptHash: PLAYER_DROP_RECEIPT },
        pump: {
          nativeBlockEditCursor: 3,
          dropPickupCursor: 1,
          playerDropCursor: 1,
          pendingDropPickupSequence: 2,
          pendingDropPickupReceiptHash: PLAYER_PICKUP_RECEIPT,
          pendingDropPickupIdentityHash: "99".repeat(16),
        },
      },
      manager: { host: { nativePersistence: { saves, lastCheckpointId: `checkpoint-${saves}` } } },
    },
  };
}

test("Basic Dirt verifier CLI accepts only exact candidate and bounded work output", (t) => {
  const root = tempRepository(t);
  const parsed = parseBasicDirtBrowserOptions([
    "node", "verifier", "--repo-root", root,
    "--expected-artifact-hash", "ab".repeat(32),
    "--output", "work/browser/basic-dirt",
    "--engine-dir", "public/engine-locator-candidate", "--timeout-ms", "60000",
  ]);
  assert.equal(parsed.repositoryRoot, path.resolve(root));
  assert.equal(parsed.engineDirectory, path.join(path.resolve(root), "public", "engine-locator-candidate"));
  assert.equal(parsed.outputDirectory, path.join(path.resolve(root), "work", "browser", "basic-dirt"));
  assert.equal(parsed.timeoutMilliseconds, 60_000);
  assert.equal(parsed.expectedArtifactHash, "ab".repeat(32));
  assert.equal(parsed.scenario, "dirt-cycle");
  const grass = parseBasicDirtBrowserOptions([
    "node", "verifier", "--repo-root", root,
    "--expected-artifact-hash", "ab".repeat(32),
    "--output", "work/browser/generic-grass",
    "--engine-dir", "public/engine-locator-candidate",
    "--scenario", "generic-grass",
  ]);
  assert.equal(grass.scenario, "generic-grass");
  const recovery = parseBasicDirtBrowserOptions([
    "node", "verifier", "--repo-root", root,
    "--expected-artifact-hash", "ab".repeat(32),
    "--output", "work/browser/generic-grass-recovery",
    "--engine-dir", "public/engine-locator-candidate",
    "--scenario", "generic-grass-recovery",
  ]);
  assert.equal(recovery.scenario, "generic-grass-recovery");
  const shaped = parseBasicDirtBrowserOptions([
    "node", "verifier", "--repo-root", root,
    "--expected-artifact-hash", "ab".repeat(32),
    "--output", "work/browser/generic-shaped-prop",
    "--engine-dir", "public/engine-locator-candidate",
    "--scenario", "generic-shaped-prop",
  ]);
  assert.equal(shaped.scenario, "generic-shaped-prop");
});

test("Basic Dirt verifier CLI rejects malformed hashes, duplicate options, and expansive paths", (t) => {
  const root = tempRepository(t);
  const base = ["node", "verifier", "--repo-root", root];
  assert.throws(() => parseBasicDirtBrowserOptions([
    ...base, "--expected-artifact-hash", "AB".repeat(32), "--output", "work/evidence",
    "--engine-dir", "public/engine-locator-candidate",
  ]), /64 lowercase hexadecimal/u);
  assert.throws(() => parseBasicDirtBrowserOptions([
    ...base, "--expected-artifact-hash", "ab".repeat(32), "--output", "work/evidence",
    "--output", "work/other", "--engine-dir", "public/engine-locator-candidate",
  ]), /may only be provided once/u);
  assert.throws(() => parseBasicDirtBrowserOptions([
    ...base, "--expected-artifact-hash", "ab".repeat(32), "--output", "outside",
    "--engine-dir", "public/engine-locator-candidate",
  ]), /strictly beneath/u);
  assert.throws(() => parseBasicDirtBrowserOptions([
    ...base, "--expected-artifact-hash", "ab".repeat(32), "--output", "work/evidence",
    "--engine-dir", "public/engine",
  ]), /resolve exactly/u);
  assert.throws(() => parseBasicDirtBrowserOptions([
    ...base, "--expected-artifact-hash", "ab".repeat(32), "--output", "work/evidence",
    "--engine-dir", "public/engine-locator-candidate", "--scenario", "grass",
  ]), /scenario must be dirt-cycle, generic-grass, generic-grass-recovery, or generic-shaped-prop/u);
});

test("canonical edit transition decodes one exact Dirt/Air address and fails closed on fanout", () => {
  const before = { save: { edits: edits() } };
  const placed = { save: { edits: edits(2) } };
  assert.deepEqual(basicDirtEditTransition(before, placed, 2).coordinate, COORDINATE);
  assert.deepEqual(basicDirtEditTransition(placed, { save: { edits: edits(0) } }, 0).coordinate, COORDINATE);
  assert.throws(() => basicDirtEditTransition(before, {
    save: { edits: { "0,-1": [[EDIT_INDEX, 2], [EDIT_INDEX + 1, 2]] } },
  }, 2), /changed 2 canonical edit addresses/u);
  assert.throws(() => basicDirtEditTransition(before, placed, 0), /instead of 0/u);
});

test("generic edit transition accepts the exact Meadow-Grass-to-Air address and rejects block drift", () => {
  const before = { save: { edits: {} } };
  const mined = { save: { edits: edits(0, GRASS_EDIT_INDEX) } };
  assert.deepEqual(nativeBlockEditTransition(before, mined, 0).coordinate, GRASS_COORDINATE);
  assert.throws(() => nativeBlockEditTransition(before, mined, 1), /instead of 1/u);
  assert.throws(() => nativeBlockEditTransition(before, mined, -1), /non-negative block id/u);
  assert.throws(() => nativeBlockEditTransition({
    save: { edits: { "0,-1": [[EDIT_INDEX, 0]] } },
  }, {
    save: { edits: edits(0, GRASS_EDIT_INDEX) },
  }, 0), /changed 2 canonical edit addresses/u);
  assert.throws(() => nativeBlockEditTransition({
    save: { edits: { "0,-1": [[EDIT_INDEX, 0]] } },
  }, { save: { edits: {} } }, 0), /deleted its only changed canonical edit address/u);
});

test("live empty-cell ray evidence requires the exact cell before a farther support block", () => {
  const rayCells = [[3, 36, -2], [2, 36, -2], [...GRASS_COORDINATE], [1, 35, -3]];
  const accepted = expectedEmptyCellRayEvidence({
    coordinate: GRASS_COORDINATE,
    rayCells,
    target: { type: "block", position: [1, 35, -3] },
    playerPosition: [3, 36.51, -2],
  });
  assert.equal(accepted.liveCellObservedEmpty, true);
  assert.equal(accepted.emptyRayOrdinal, 2);
  assert.equal(accepted.supportTargetRayOrdinal, 3);
  assert.deepEqual(accepted.supportDelta, [0, -1, 0]);
  assert.equal(accepted.supportImmediatelyAfterEmpty, true);
  assert.equal(expectedEmptyCellRayEvidence({
    coordinate: GRASS_COORDINATE,
    rayCells,
    target: { type: "block", position: [...GRASS_COORDINATE] },
    playerPosition: [3, 36.51, -2],
  }).liveCellObservedEmpty, false);
  assert.equal(expectedEmptyCellRayEvidence({
    coordinate: GRASS_COORDINATE,
    rayCells: rayCells.filter((cell) => cell !== rayCells[2]),
    target: { type: "block", position: [1, 35, -3] },
    playerPosition: [3, 36.51, -2],
  }).liveCellObservedEmpty, false);
  assert.equal(expectedEmptyCellRayEvidence({
    coordinate: GRASS_COORDINATE,
    rayCells: [[3, 36, -2], [2, 36, -2], [...GRASS_COORDINATE], [1, 36, -2], [1, 35, -2]],
    target: { type: "block", position: [1, 35, -2] },
    playerPosition: [3, 36.51, -2],
  }).liveCellObservedEmpty, false, "a farther non-adjacent support cannot prove the placement cell");
});

test("untargeted empty-cell ray evidence requires null target, exact traversal, and center reach", () => {
  const coordinate = [0, 0, 0];
  const rayCells = [[4, 0, 0], [...coordinate]];
  const accepted = expectedUntargetedEmptyCellRayEvidence({
    coordinate,
    rayCells,
    target: null,
    rayOrigin: [4.5, 0, 0],
  });
  assert.equal(accepted.mode, "untargeted-empty-ray");
  assert.equal(accepted.liveCellObservedEmpty, true);
  assert.equal(accepted.targetAbsent, true);
  assert.equal(accepted.emptyRayOrdinal, 1);
  assert.equal(accepted.coordinateDistance, 4.5);

  assert.equal(expectedUntargetedEmptyCellRayEvidence({
    coordinate,
    rayCells,
    target: { type: "block", name: "Meadow Grass", position: coordinate },
    rayOrigin: [4.5, 0, 0],
  }).liveCellObservedEmpty, false, "an occupied target cannot prove an empty cell");
  assert.equal(expectedUntargetedEmptyCellRayEvidence({
    coordinate,
    rayCells,
    target: undefined,
    rayOrigin: [4.5, 0, 0],
  }).liveCellObservedEmpty, false, "only an explicit null target proves no block was selected");
  assert.equal(expectedUntargetedEmptyCellRayEvidence({
    coordinate,
    rayCells: [[4, 0, 0], [1, 0, 0]],
    target: null,
    rayOrigin: [4.5, 0, 0],
  }).liveCellObservedEmpty, false, "the ray must traverse the exact empty coordinate");
  assert.equal(expectedUntargetedEmptyCellRayEvidence({
    coordinate,
    rayCells: [[...coordinate], [1, 0, 0]],
    target: null,
    rayOrigin: [4.5, 0, 0],
  }).liveCellObservedEmpty, false, "ordinal zero is the ray origin cell, not traversed evidence");
  assert.equal(expectedUntargetedEmptyCellRayEvidence({
    coordinate,
    rayCells,
    target: null,
    rayOrigin: [4.51, 0, 0],
  }).liveCellObservedEmpty, false, "the empty cell center must remain within 4.5 blocks");
});

test("split-ray evidence binds the exact below-cell support and unchanged authority custody", () => {
  const coordinate = [2, 37, -4];
  const supportCoordinate = [2, 36, -4];
  const supportName = "Meadow Grass";
  const emptyAim = expectedUntargetedEmptyCellRayEvidence({
    coordinate,
    rayCells: [[3, 37, -3], [...coordinate]],
    target: null,
    rayOrigin: [3.5, 37.5, -2.5],
  });
  const supportAim = {
    selection: {
      type: "block",
      name: supportName,
      position: [...supportCoordinate],
      rayOrdinal: 2,
      rayEntryDistance: 3.25,
    },
  };
  const validInput = {
    coordinate,
    supportCoordinate,
    supportName,
    emptyAim,
    supportAim,
    durableCustodyUnchanged: true,
    authorityCursorsUnchanged: true,
    interveningWritesPreservedCustody: true,
  };
  const accepted = composeSplitEmptyCellSupportEvidence(validInput);
  assert.equal(accepted.mode, "split-ray");
  assert.equal(accepted.splitProofValid, true);
  assert.equal(accepted.liveCellObservedEmpty, true);
  assert.equal(accepted.adjacentSupport, true);
  assert.equal(accepted.exactSupport, true);
  assert.deepEqual(accepted.supportDelta, [0, -1, 0]);
  assert.deepEqual(accepted.supportTarget, {
    type: "block",
    name: supportName,
    position: supportCoordinate,
  });

  assert.equal(composeSplitEmptyCellSupportEvidence({
    ...validInput,
    supportAim: {
      selection: { ...supportAim.selection, name: "Dirt" },
    },
  }).splitProofValid, false, "a different support name must fail closed");
  assert.equal(composeSplitEmptyCellSupportEvidence({
    ...validInput,
    supportAim: {
      selection: { ...supportAim.selection, position: [3, 36, -4] },
    },
  }).splitProofValid, false, "a support ray at a different coordinate must fail closed");
  assert.equal(composeSplitEmptyCellSupportEvidence({
    ...validInput,
    supportCoordinate: [2, 35, -4],
    supportAim: {
      selection: { ...supportAim.selection, position: [2, 35, -4] },
    },
  }).splitProofValid, false, "a nonadjacent support coordinate must fail closed");

  for (const invariant of [
    "durableCustodyUnchanged",
    "authorityCursorsUnchanged",
    "interveningWritesPreservedCustody",
  ]) {
    const rejected = composeSplitEmptyCellSupportEvidence({
      ...validInput,
      [invariant]: false,
    });
    assert.equal(rejected.splitProofValid, false, `${invariant} is required`);
    assert.equal(rejected[invariant], false);
  }
});

test("Survival creation accepts only bounded Air spawn-clearance edits away from acquisition", () => {
  const spawn = [0, 36.51, -4];
  const expected = inspectSurvivalCreationEdits({
    save: { edits: {
      "-1,-1": [[26079, 0]],
      "0,-1": [[26064, 0], [26033, 0], [26049, 0]],
    } },
  }, spawn, COORDINATE);
  assert.equal(expected.valid, true);
  assert.equal(expected.spawnClearanceOnly, true);
  assert.equal(expected.protectedCoordinateUntouched, true);
  assert.equal(expected.canonical.count, 4);
  assert.equal(expected.canonical.sha256, "f0bb2632d601e4507703003b33cb0f6b8e4fb4a2d0b17bde481eac6ba77e06ab");

  const outsideFootprint = inspectSurvivalCreationEdits({
    save: { edits: { "0,-1": [[26050, 0]] } },
  }, spawn, COORDINATE);
  assert.equal(outsideFootprint.valid, false);
  assert.equal(outsideFootprint.spawnClearanceOnly, false);

  const protectedEdit = inspectSurvivalCreationEdits({
    save: { edits: { "0,-1": [[EDIT_INDEX, 0]] } },
  }, spawn, COORDINATE);
  assert.equal(protectedEdit.valid, false);
  assert.equal(protectedEdit.protectedCoordinateUntouched, false);
});

test("shaped-prop placement uses natural Air beyond the saved spawn-clearance footprint", () => {
  const fixture = GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE;
  const spawn = fixture.expectedSpawn;
  assert.deepEqual(fixture.placementCoordinate, [2, 37, -4]);
  assert.deepEqual(fixture.placementSupportCoordinate, [2, 36, -4]);
  assert.deepEqual(fixture.placementVantage, [3, -4]);
  assert.equal(Math.abs(fixture.placementCoordinate[0] - spawn[0]), 2);
  assert.deepEqual(fixture.placementCoordinate.map((value, index) => (
    value - fixture.placementSupportCoordinate[index]
  )), [0, 1, 0]);
  assert.deepEqual([
    fixture.placementVantage[0] - fixture.placementCoordinate[0],
    fixture.placementVantage[1] - fixture.placementCoordinate[2],
  ], [1, 0]);

  const creation = inspectSurvivalCreationEdits({
    save: { edits: {
      "-1,-1": [[26079, 0]],
      "0,-1": [[26064, 0], [26033, 0], [26049, 0]],
    } },
  }, spawn, fixture.placementCoordinate);
  assert.equal(creation.valid, true);
  assert.equal(creation.spawnClearanceOnly, true);
  assert.equal(creation.protectedCoordinateUntouched, true,
    "the natural-Air shelf target must not depend on a saved spawn-clearance edit");
  assert.equal(creation.canonical.count, fixture.expectedCreationEdits.count);
  assert.equal(creation.canonical.sha256, fixture.expectedCreationEdits.sha256);
});

test("mine, place, and final mine require exact Survival stack transitions and ordering", () => {
  const beforeMine = snapshot({ cursor: 0, hash: null, editType: null, saves: 4 });
  const acquiredDrop = nativeDrop(ACQUIRED_DROP_ID, 0.1);
  const afterMine = snapshot({ cursor: 1, hash: RECEIPT_ONE, editType: 0, saves: 5, drops: [acquiredDrop] });
  const acquisition = assertBasicDirtActionTransaction({
    action: "mine", before: beforeMine, after: afterMine,
    auditWrites: [pendingActionWrite({
      ordinal: 3, cursorBefore: 0, cursorAfter: 1, hash: RECEIPT_ONE,
      editType: 0, saves: 5, drops: [acquiredDrop], selected: 0, slotOne: null,
    })],
    firstAuditOrdinal: 3, expectedCoordinate: COORDINATE, expectedSelectedSlot: 0,
    expectedSelectedStackBefore: starterStack(), expectedSelectedStackAfter: starterStack(),
  });
  assert.equal(acquisition.generatedDrop.rustEntityId, ACQUIRED_DROP_ID);
  assert.equal(acquisition.generatedHotTransform.ageTicks, "2");
  assert.equal(acquisition.checkpointWitness.action, "mine");
  assert.deepEqual([
    acquisition.checkpointWitness.cell.x,
    acquisition.checkpointWitness.cell.y,
    acquisition.checkpointWitness.cell.z,
  ], COORDINATE);

  const beforePlace = snapshot({
    cursor: 1, hash: RECEIPT_ONE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 0, saves: 6, selected: 0, slotOne: dirtStack(),
  });
  beforePlace.state.inventory = { selectedSlot: 1, held: dirtStack() };
  beforePlace.runtime.playerAuthority.pump.selectedSlot = 1;
  const afterPlace = snapshot({
    cursor: 2, hash: RECEIPT_TWO, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 2, saves: 7, selected: 1, slotOne: null,
  });
  assert.equal(assertBasicDirtActionTransaction({
    action: "place", before: beforePlace, after: afterPlace,
    auditWrites: [pendingActionWrite({
      ordinal: 4, cursorBefore: 1, cursorAfter: 2, hash: RECEIPT_TWO,
      pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
      editType: 2, saves: 7, selected: 1, slotOne: null,
    })],
    firstAuditOrdinal: 4, expectedCoordinate: COORDINATE, expectedSelectedSlot: 1,
    expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
    expectedSavedSelectedSlotBefore: 0, expectedSavedSelectedStackBefore: starterStack(),
  }).cursorAfter, 2);
  const caughtUpBeforePlace = structuredClone(beforePlace);
  caughtUpBeforePlace.storage.save.selected = 1;
  assert.equal(assertBasicDirtActionTransaction({
    action: "place", before: caughtUpBeforePlace, after: afterPlace,
    auditWrites: [pendingActionWrite({
      ordinal: 4, cursorBefore: 1, cursorAfter: 2, hash: RECEIPT_TWO,
      pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
      editType: 2, saves: 7, selected: 1, slotOne: null,
    })],
    firstAuditOrdinal: 4, expectedCoordinate: COORDINATE, expectedSelectedSlot: 1,
    expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
    expectedSavedSelectedSlotBefore: 1, expectedSavedSelectedStackBefore: dirtStack(),
  }).cursorAfter, 2);

  const finalDrop = nativeDrop(FINAL_DROP_ID);
  const afterFinalMine = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 0, saves: 8, drops: [finalDrop], selected: 1, slotOne: null,
  });
  const finalMine = assertBasicDirtActionTransaction({
    action: "mine", before: afterPlace, after: afterFinalMine,
    auditWrites: [pendingActionWrite({
      ordinal: 5, cursorBefore: 2, cursorAfter: 3, hash: RECEIPT_THREE,
      pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
      editType: 0, saves: 8, drops: [finalDrop], selected: 1, slotOne: null,
    })],
    firstAuditOrdinal: 5, expectedCoordinate: COORDINATE, expectedSelectedSlot: 1,
    expectedSelectedStackBefore: null, expectedSelectedStackAfter: null,
  });
  assert.equal(finalMine.generatedDrop.rustEntityId, FINAL_DROP_ID);
});

test("generic Meadow Grass mine proves exact Air, unchanged inventory, and generated self-drop custody", () => {
  const before = snapshot({
    cursor: 0,
    hash: null,
    editType: null,
    saves: 4,
    editIndex: GRASS_EDIT_INDEX,
    coordinate: GRASS_COORDINATE,
    previousBlockId: MEADOW_GRASS_BLOCK_ID,
    inventoryDomainRevision: "9",
    blockEditProtocolVersion: 2,
  });
  const grassDrop = nativeMeadowGrassDrop(ACQUIRED_DROP_ID, 0.1);
  const after = snapshot({
    cursor: 1,
    hash: RECEIPT_ONE,
    editType: 0,
    saves: 5,
    drops: [grassDrop],
    editIndex: GRASS_EDIT_INDEX,
    coordinate: GRASS_COORDINATE,
    previousBlockId: MEADOW_GRASS_BLOCK_ID,
    inventoryDomainRevision: "9",
    blockEditProtocolVersion: 2,
  });
  const ordered = pendingActionWrite({
    ordinal: 3,
    cursorBefore: 0,
    cursorAfter: 1,
    hash: RECEIPT_ONE,
    editType: 0,
    saves: 5,
    drops: [grassDrop],
    selected: 0,
    slotOne: null,
    editIndex: GRASS_EDIT_INDEX,
    coordinate: GRASS_COORDINATE,
    previousBlockId: MEADOW_GRASS_BLOCK_ID,
    inventoryDomainRevision: "9",
    blockEditProtocolVersion: 2,
  });
  const evidence = assertGenericNativeBlockEditTransaction({
    action: "mine",
    before,
    after,
    auditWrites: [ordered],
    firstAuditOrdinal: 3,
    expectedCoordinate: GRASS_COORDINATE,
    expectedSelectedSlot: 0,
    expectedSelectedStackBefore: starterStack(),
    expectedSelectedStackAfter: starterStack(),
    ...GENERIC_GRASS_ACTION_WORLD_FIXTURE.expectedBlockTransition,
    expectedGeneratedDrop: { item: MEADOW_GRASS_ITEM_ID, count: 1 },
    requireInventoryDocumentUnchanged: true,
    requireRustAuthoredDirtySet: true,
  });
  assert.equal(evidence.cursorAfter, 1);
  assert.equal(evidence.generatedDrop.rustEntityId, ACQUIRED_DROP_ID);
  assert.equal(evidence.checkpointWitness.cell.previousBlockId, MEADOW_GRASS_BLOCK_ID);

  const wrongPreviousBlock = structuredClone(after);
  wrongPreviousBlock.runtime.playerAuthority.nativeBlockEditCheckpoint.cell.previousBlockId = 2;
  assert.throws(() => assertGenericNativeBlockEditTransaction({
    action: "mine", before, after: wrongPreviousBlock, auditWrites: [ordered], firstAuditOrdinal: 3,
    expectedCoordinate: GRASS_COORDINATE, expectedSelectedSlot: 0,
    expectedSelectedStackBefore: starterStack(), expectedSelectedStackAfter: starterStack(),
    expectedPreviousBlockId: MEADOW_GRASS_BLOCK_ID, expectedBlockId: 0,
    expectedGeneratedDrop: { item: MEADOW_GRASS_ITEM_ID, count: 1 },
    requireInventoryDocumentUnchanged: true,
    requireRustAuthoredDirtySet: true,
  }), /receipt\/action\/cell-bound/u);

  const changedInventory = structuredClone(after);
  changedInventory.storage.save.inventory[5] = { item: 2, count: 1 };
  assert.throws(() => assertGenericNativeBlockEditTransaction({
    action: "mine", before, after: changedInventory, auditWrites: [ordered], firstAuditOrdinal: 3,
    expectedCoordinate: GRASS_COORDINATE, expectedSelectedSlot: 0,
    expectedSelectedStackBefore: starterStack(), expectedSelectedStackAfter: starterStack(),
    expectedPreviousBlockId: MEADOW_GRASS_BLOCK_ID, expectedBlockId: 0,
    expectedGeneratedDrop: { item: MEADOW_GRASS_ITEM_ID, count: 1 },
    requireInventoryDocumentUnchanged: true,
    requireRustAuthoredDirtySet: true,
  }), /inventory document/u);

  const wrongGeneratedItem = structuredClone(after);
  wrongGeneratedItem.storage.save.drops[0].item = 1;
  assert.throws(() => assertGenericNativeBlockEditTransaction({
    action: "mine", before, after: wrongGeneratedItem, auditWrites: [ordered], firstAuditOrdinal: 3,
    expectedCoordinate: GRASS_COORDINATE, expectedSelectedSlot: 0,
    expectedSelectedStackBefore: starterStack(), expectedSelectedStackAfter: starterStack(),
    expectedPreviousBlockId: MEADOW_GRASS_BLOCK_ID, expectedBlockId: 0,
    expectedGeneratedDrop: { item: MEADOW_GRASS_ITEM_ID, count: 1 },
    requireInventoryDocumentUnchanged: true,
    requireRustAuthoredDirtySet: true,
  }), /expected native-identity drop/u);
});

test("generic shaped prop proves Creative East-facing Shelf placement then Survival mine and native item-270 custody", () => {
  const shelfStack = { item: SHELF_ITEM_ID, count: 64 };
  const beforePlacement = snapshot({
    cursor: 0,
    hash: null,
    editType: 0,
    saves: 4,
    slotZero: shelfStack,
    editIndex: SHELF_EDIT_INDEX,
    coordinate: SHELF_COORDINATE,
    mode: "builder",
    blockEditProtocolVersion: 2,
  });
  const afterPlacement = snapshot({
    cursor: 1,
    hash: RECEIPT_ONE,
    editType: SHELF_BLOCK_ID,
    saves: 5,
    slotZero: shelfStack,
    editIndex: SHELF_EDIT_INDEX,
    coordinate: SHELF_COORDINATE,
    previousBlockId: 0,
    action: "place",
    previousFacing: 0,
    facing: 1,
    flying: true,
    mode: "builder",
    blockEditProtocolVersion: 2,
  });
  const placementWrite = pendingActionWrite({
    ordinal: 1,
    cursorBefore: 0,
    cursorAfter: 1,
    hash: RECEIPT_ONE,
    editType: SHELF_BLOCK_ID,
    saves: 5,
    selected: 0,
    slotOne: null,
    slotZero: shelfStack,
    editIndex: SHELF_EDIT_INDEX,
    coordinate: SHELF_COORDINATE,
    previousBlockId: 0,
    action: "place",
    previousFacing: 0,
    facing: 1,
    mode: "builder",
    blockEditProtocolVersion: 2,
  });
  const placement = assertGenericNativeBlockEditTransaction({
    action: "place",
    before: beforePlacement,
    after: afterPlacement,
    auditWrites: [placementWrite],
    firstAuditOrdinal: 1,
    expectedCoordinate: SHELF_COORDINATE,
    expectedSelectedSlot: 0,
    expectedSelectedStackBefore: shelfStack,
    expectedSelectedStackAfter: shelfStack,
    expectedPreviousBlockId: 0,
    expectedBlockId: SHELF_BLOCK_ID,
    expectedPreviousFacing: 0,
    expectedFacing: 1,
    expectedGeneratedDrop: null,
    requireInventoryDocumentUnchanged: true,
    requireRustAuthoredDirtySet: true,
  });
  assert.equal(placement.checkpointWitness.cell.facing, 1);
  assert.equal(afterPlacement.storage.save.blockFacings[SHELF_COORDINATE.join(",")], 1);

  const beforeMine = structuredClone(afterPlacement);
  beforeMine.storage.save.mode = "survival";
  beforeMine.state.player.mode = "survival";
  beforeMine.runtime.hydration = "restored";
  const shelfDrop = nativeWildwoodShelfDrop(ACQUIRED_DROP_ID, 0.1);
  const afterMine = snapshot({
    cursor: 2,
    hash: RECEIPT_TWO,
    editType: 0,
    saves: 6,
    drops: [shelfDrop],
    slotZero: shelfStack,
    editIndex: SHELF_EDIT_INDEX,
    coordinate: SHELF_COORDINATE,
    previousBlockId: SHELF_BLOCK_ID,
    action: "mine",
    previousFacing: 1,
    facing: 0,
    mode: "survival",
    inventoryDomainRevision: "9",
    blockEditProtocolVersion: 2,
  });
  const mineWrite = pendingActionWrite({
    ordinal: 2,
    cursorBefore: 1,
    cursorAfter: 2,
    hash: RECEIPT_TWO,
    editType: 0,
    saves: 6,
    drops: [shelfDrop],
    selected: 0,
    slotOne: null,
    slotZero: shelfStack,
    editIndex: SHELF_EDIT_INDEX,
    coordinate: SHELF_COORDINATE,
    previousBlockId: SHELF_BLOCK_ID,
    action: "mine",
    previousFacing: 1,
    facing: 0,
    mode: "survival",
    inventoryDomainRevision: "9",
    blockEditProtocolVersion: 2,
  });
  const mined = assertGenericNativeBlockEditTransaction({
    action: "mine",
    before: beforeMine,
    after: afterMine,
    auditWrites: [mineWrite],
    firstAuditOrdinal: 2,
    expectedCoordinate: SHELF_COORDINATE,
    expectedSelectedSlot: 0,
    expectedSelectedStackBefore: shelfStack,
    expectedSelectedStackAfter: shelfStack,
    expectedPreviousBlockId: SHELF_BLOCK_ID,
    expectedBlockId: 0,
    expectedPreviousFacing: 1,
    expectedFacing: 0,
    expectedGeneratedDrop: { item: SHELF_ITEM_ID, count: 1 },
    requireInventoryDocumentUnchanged: true,
    requireRustAuthoredDirtySet: true,
  });
  assert.equal(mined.generatedDrop.item, SHELF_ITEM_ID);
  assert.equal(mined.generatedDrop.rustEntityId, ACQUIRED_DROP_ID);
  assert.deepEqual(afterMine.storage.save.blockFacings, {});

  const facingDrift = structuredClone(afterPlacement);
  facingDrift.storage.save.blockFacings[SHELF_COORDINATE.join(",")] = 3;
  assert.throws(() => assertGenericNativeBlockEditTransaction({
    action: "place",
    before: beforePlacement,
    after: facingDrift,
    auditWrites: [placementWrite],
    firstAuditOrdinal: 1,
    expectedCoordinate: SHELF_COORDINATE,
    expectedSelectedSlot: 0,
    expectedSelectedStackBefore: shelfStack,
    expectedSelectedStackAfter: shelfStack,
    expectedPreviousBlockId: 0,
    expectedBlockId: SHELF_BLOCK_ID,
    expectedPreviousFacing: 0,
    expectedFacing: 1,
    expectedGeneratedDrop: null,
    requireRustAuthoredDirtySet: true,
  }), /cardinal-facing transition/u);
  const wrongDrop = structuredClone(afterMine);
  wrongDrop.storage.save.drops[0].item = 271;
  assert.throws(() => assertGenericNativeBlockEditTransaction({
    action: "mine",
    before: beforeMine,
    after: wrongDrop,
    auditWrites: [mineWrite],
    firstAuditOrdinal: 2,
    expectedCoordinate: SHELF_COORDINATE,
    expectedSelectedSlot: 0,
    expectedSelectedStackBefore: shelfStack,
    expectedSelectedStackAfter: shelfStack,
    expectedPreviousBlockId: SHELF_BLOCK_ID,
    expectedBlockId: 0,
    expectedPreviousFacing: 1,
    expectedFacing: 0,
    expectedGeneratedDrop: { item: SHELF_ITEM_ID, count: 1 },
    requireInventoryDocumentUnchanged: true,
    requireRustAuthoredDirtySet: true,
  }), /expected native-identity drop/u);
});

test("Creative catalog witness requires one exact native selected-slot CAS from an empty baseline", () => {
  const nativeStack = {
    itemCode: SHELF_ITEM_ID,
    count: GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.selectedStack.count,
    durabilityMillionths: null,
    metadataHash: "0".repeat(32),
  };
  const nativeSnapshot = ({
    inventoryRevision,
    extractionRevision,
    held,
    commandCalls,
    creativeSlotSetCalls,
    inventoryContainer = "container-key-v1/player:creative",
  }) => ({
    runtime: {
      playerAuthority: {
        nativeInventory: {
          extractionRevision: String(extractionRevision),
          inventoryContainer,
          inventoryContainerRevision: String(inventoryRevision),
          selectedSlot: 0,
          held,
        },
        pump: { commandCalls, creativeSlotSetCalls },
      },
    },
  });
  const before = nativeSnapshot({
    inventoryRevision: 7,
    extractionRevision: 19,
    held: null,
    commandCalls: 40,
    creativeSlotSetCalls: 0,
  });
  const after = nativeSnapshot({
    inventoryRevision: 8,
    extractionRevision: 21,
    held: nativeStack,
    commandCalls: 45,
    creativeSlotSetCalls: 1,
  });
  assert.deepEqual(assertCreativeCatalogNativeCustody(
    before,
    after,
    0,
    GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.selectedStack,
  ), {
    inventoryContainer: "container-key-v1/player:creative",
    selectedSlot: 0,
    inventoryRevisionBefore: "7",
    inventoryRevisionAfter: "8",
    extractionRevisionBefore: "19",
    extractionRevisionAfter: "21",
    commandCallsBefore: 40,
    commandCallsAfter: 45,
    creativeSlotSetCallsBefore: 0,
    creativeSlotSetCallsAfter: 1,
  });

  const invalidPairs = [
    [nativeSnapshot({ inventoryRevision: 7, extractionRevision: 19, held: nativeStack, commandCalls: 40, creativeSlotSetCalls: 0 }), after],
    [before, nativeSnapshot({ inventoryRevision: 7, extractionRevision: 21, held: nativeStack, commandCalls: 45, creativeSlotSetCalls: 1 })],
    [before, nativeSnapshot({ inventoryRevision: 8, extractionRevision: 19, held: nativeStack, commandCalls: 45, creativeSlotSetCalls: 1 })],
    [before, nativeSnapshot({ inventoryRevision: 8, extractionRevision: 21, held: nativeStack, commandCalls: 45, creativeSlotSetCalls: 0 })],
    [before, nativeSnapshot({ inventoryRevision: 8, extractionRevision: 21, held: nativeStack, commandCalls: 40, creativeSlotSetCalls: 1 })],
    [before, nativeSnapshot({ inventoryRevision: 8, extractionRevision: 21, held: nativeStack, commandCalls: 45, creativeSlotSetCalls: 1, inventoryContainer: "container-key-v1/other" })],
  ];
  for (const [invalidBefore, invalidAfter] of invalidPairs) {
    assert.throws(() => assertCreativeCatalogNativeCustody(
      invalidBefore,
      invalidAfter,
      0,
      GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.selectedStack,
    ), /exact BWF7 native selected-slot CAS/u);
  }
});

test("generic shaped prop Worlds editor preserves exact shelf custody across Creative to Survival", () => {
  const shelfStack = { item: SHELF_ITEM_ID, count: 64 };
  const placed = snapshot({
    cursor: 1,
    hash: RECEIPT_ONE,
    editType: SHELF_BLOCK_ID,
    saves: 5,
    slotZero: shelfStack,
    editIndex: SHELF_EDIT_INDEX,
    coordinate: SHELF_COORDINATE,
    previousBlockId: 0,
    action: "place",
    previousFacing: 0,
    facing: 1,
    mode: "builder",
    blockEditProtocolVersion: 2,
  });
  const titleAfterCreativeSave = structuredClone(placed);
  titleAfterCreativeSave.state.state = "title";
  const titleAfterModeChange = structuredClone(titleAfterCreativeSave);
  titleAfterModeChange.storage.save.mode = "survival";
  titleAfterModeChange.audit.nextWriteOrdinal = 7;
  const survivalLoaded = structuredClone(titleAfterModeChange);
  survivalLoaded.state.state = "playing";
  survivalLoaded.state.player.mode = "survival";
  survivalLoaded.state.player.flying = false;
  survivalLoaded.runtime.hydration = "restored";
  survivalLoaded.runtime.manager.host.nativePersistence.recoveries = 1;
  survivalLoaded.runtime.playerAuthority.gameModeSetCalls = 1;
  survivalLoaded.runtime.playerAuthority.lastGameModeSet = playerGameModeSetWitness();
  survivalLoaded.runtime.playerAuthority.pump.authoritativeFlags = 0;
  survivalLoaded.audit.worldDocumentWrites.push({
    ordinal: 7,
    key: "blockwild-world-data-v1:world-basic-dirt",
    save: { mode: "survival" },
  });
  const modeEditorEvidence = {
    schema: 1,
    worldName: GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.name,
    fromMode: "builder",
    toMode: "survival",
    dialogType: "confirm",
    dialogMessage: `Change “${GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.name}” to Survival before its next load? World edits and inventory are preserved.`,
    accepted: true,
    notice: `${GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.name} will load in Survival. Inventory and world progress were preserved.`,
  };
  const evidence = assertGenericShapedPropModeTransition({
    titleAfterCreativeSave,
    titleAfterModeChange,
    survivalLoaded,
    modeEditorEvidence,
  });
  assert.equal(evidence.facing, 1);
  assert.equal(evidence.flying, false);
  assert.equal(evidence.cursor.cursor, 1);
  assert.equal(evidence.nativeGameModeSet.schema, 1);

  const inventoryDrift = structuredClone(titleAfterModeChange);
  inventoryDrift.storage.save.inventory[0].count = 63;
  assert.throws(() => assertGenericShapedPropModeTransition({
    titleAfterCreativeSave,
    titleAfterModeChange: inventoryDrift,
    survivalLoaded,
    modeEditorEvidence,
  }), /outside the exact mode field/u);
  assert.throws(() => assertGenericShapedPropModeTransition({
    titleAfterCreativeSave,
    titleAfterModeChange,
    survivalLoaded,
    modeEditorEvidence: { ...modeEditorEvidence, accepted: false },
  }), /confirmation evidence/u);
  const flyingSurvival = structuredClone(survivalLoaded);
  flyingSurvival.state.player.flying = true;
  assert.throws(() => assertGenericShapedPropModeTransition({
    titleAfterCreativeSave,
    titleAfterModeChange,
    survivalLoaded: flyingSurvival,
    modeEditorEvidence,
  }), /Creative to Survival/u);

  const invalidModeWitnesses = [
    (value) => { value.runtime.playerAuthority.gameModeSetCalls = 0; },
    (value) => { value.runtime.playerAuthority.gameModeSetCalls = 2; },
    (value) => { value.runtime.playerAuthority.lastGameModeSet.resultingFlags = 1; },
    (value) => { value.runtime.playerAuthority.lastGameModeSet.identityAfter.simulationRevision += 1; },
    (value) => {
      value.runtime.playerAuthority.lastGameModeSet.identityAfter.stateHash
        = value.runtime.playerAuthority.lastGameModeSet.identityBefore.stateHash;
    },
    (value) => { value.runtime.playerAuthority.lastGameModeSet.checkpoint.savesAfter += 1; },
    (value) => { value.runtime.playerAuthority.lastGameModeSet.checkpoint.platformOperationsAfter += 1; },
    (value) => { value.runtime.manager.host.nativePersistence.saves = 4; },
    (value) => { value.runtime.playerAuthority.pump.authoritativeFlags = 1; },
  ];
  for (const mutate of invalidModeWitnesses) {
    const invalid = structuredClone(survivalLoaded);
    mutate(invalid);
    assert.throws(() => assertGenericShapedPropModeTransition({
      titleAfterCreativeSave,
      titleAfterModeChange,
      survivalLoaded: invalid,
      modeEditorEvidence,
    }), /native|Survival load/iu);
  }

  const transientBuilderWrite = structuredClone(survivalLoaded);
  transientBuilderWrite.audit.worldDocumentWrites.push({
    ordinal: 8,
    key: "blockwild-world-data-v1:world-basic-dirt",
    save: { mode: "builder" },
  });
  assert.throws(() => assertGenericShapedPropModeTransition({
    titleAfterCreativeSave,
    titleAfterModeChange,
    survivalLoaded: transientBuilderWrite,
    modeEditorEvidence,
  }), /transiently reverted/u);

  const laterAutosave = structuredClone(survivalLoaded);
  laterAutosave.runtime.manager.host.nativePersistence.saves = 6;
  laterAutosave.runtime.manager.host.nativePersistence.platformOperations = 26;
  laterAutosave.runtime.manager.host.nativePersistence.lastCheckpointId = "checkpoint-6";
  laterAutosave.audit.worldDocumentWrites.push({
    ordinal: 8,
    key: "blockwild-world-data-v1:world-basic-dirt",
    save: { mode: "survival" },
  });
  assert.doesNotThrow(() => assertGenericShapedPropModeTransition({
    titleAfterCreativeSave,
    titleAfterModeChange,
    survivalLoaded: laterAutosave,
    modeEditorEvidence,
  }));
});

test("generic Meadow Grass recovery proves one failed write, rollback, lifecycle retry, and settled ack", () => {
  const before = snapshot({
    cursor: 0, hash: null, editType: null, saves: 4,
    editIndex: GRASS_EDIT_INDEX, coordinate: GRASS_COORDINATE,
    previousBlockId: MEADOW_GRASS_BLOCK_ID, inventoryDomainRevision: "9",
    blockEditProtocolVersion: 2,
  });
  const grassDrop = nativeMeadowGrassDrop(ACQUIRED_DROP_ID, 0.1);
  const titleAfterSave = snapshot({
    cursor: 1, hash: RECEIPT_ONE, editType: 0, saves: 5, drops: [grassDrop],
    editIndex: GRASS_EDIT_INDEX, coordinate: GRASS_COORDINATE,
    previousBlockId: MEADOW_GRASS_BLOCK_ID, inventoryDomainRevision: "9",
    blockEditProtocolVersion: 2,
  });
  const pending = structuredClone(titleAfterSave);
  pending.storage = structuredClone(before.storage);
  Object.assign(pending.runtime.playerAuthority.pump, {
    nativeBlockEditCursor: 0,
    pendingNativeBlockEditSequence: 1,
    pendingNativeBlockEditReceiptHash: RECEIPT_ONE,
    pendingNativeBlockEditIdentityHash: BASIC_ACTION_IDENTITY,
    lastAcknowledgedNativeBlockEditSequence: null,
    lastAcknowledgedNativeBlockEditReceiptHash: null,
  });
  pending.runtime.playerAuthority.nativeBlockEditFinalize = {
    schema: 1, state: "awaiting-local-save", attempts: 1,
    lastError: "Storage quota was deliberately exhausted.",
    protocolVersion: 2, legacyFallback: null,
    cursorBefore: 0, cursorAfter: 1, receiptHash: RECEIPT_ONE,
    pendingSelectedSlot: null,
  };
  const failedRuntime = structuredClone(pending.runtime);
  failedRuntime.playerAuthority.nativeBlockEditFinalize.attempts = 0;
  failedRuntime.playerAuthority.nativeBlockEditFinalize.lastError = "";
  const injection = {
    schema: 1,
    key: "blockwild-world-data-v1:world-basic-dirt",
    message: "Injected one-shot active-world document failure",
    expectedCursorAfter: 1,
    initialDocumentBytes: 4096,
    initialCatalogBytes: 512,
    initialDocumentSha256: "ab".repeat(32),
    initialCatalogSha256: "bc".repeat(32),
    restoredDocumentSha256: "ab".repeat(32),
    restoredCatalogSha256: "bc".repeat(32),
    armed: false,
    restored: true,
    worldDocumentAttempts: 2,
    matchingAttempts: 1,
    failures: 1,
    passThroughs: 0,
    nonTargetPassThroughs: 1,
    events: [
      {
        worldAttempt: 1, targetAttempt: 1, at: 1,
        key: "blockwild-world-data-v1:world-basic-dirt",
        documentMatchesInitial: false, catalogMatchesInitial: true,
        outcome: "injected-failure", save: structuredClone(titleAfterSave.storage.save),
        runtime: failedRuntime,
      },
      {
        worldAttempt: 2, targetAttempt: null, at: 2,
        key: "blockwild-world-data-v1:world-basic-dirt",
        documentMatchesInitial: true, catalogMatchesInitial: true,
        outcome: "non-target-pass-through", save: structuredClone(before.storage.save),
        runtime: structuredClone(failedRuntime),
      },
    ],
  };
  const retryWrite = pendingActionWrite({
    ordinal: 4, cursorBefore: 0, cursorAfter: 1, hash: RECEIPT_ONE,
    editType: 0, saves: 5, drops: [grassDrop], selected: 0, slotOne: null,
    editIndex: GRASS_EDIT_INDEX, coordinate: GRASS_COORDINATE,
    previousBlockId: MEADOW_GRASS_BLOCK_ID, inventoryDomainRevision: "9",
    blockEditProtocolVersion: 2,
  });
  retryWrite.runtime.playerAuthority.nativeBlockEditFinalize = structuredClone(
    pending.runtime.playerAuthority.nativeBlockEditFinalize,
  );
  const settledWrite = structuredClone(retryWrite);
  settledWrite.ordinal = 5;
  settledWrite.at = 5.5;
  Object.assign(settledWrite.runtime.playerAuthority.pump, {
    nativeBlockEditCursor: 1,
    pendingNativeBlockEditSequence: null,
    pendingNativeBlockEditReceiptHash: null,
    pendingNativeBlockEditIdentityHash: null,
    lastAcknowledgedNativeBlockEditSequence: 1,
    lastAcknowledgedNativeBlockEditReceiptHash: RECEIPT_ONE,
  });
  settledWrite.runtime.playerAuthority.nativeBlockEditFinalize = null;
  const rollbackWrite = {
    ordinal: 3,
    at: 3.5,
    save: structuredClone(before.storage.save),
    runtime: structuredClone(failedRuntime),
  };
  const saveQuitMarker = {
    schema: 1,
    kind: "save-and-quit-click-boundary",
    at: 3.9,
    runtime: structuredClone(pending.runtime),
  };
  const input = {
    before,
    pending,
    titleAfterSave,
    failureInjection: injection,
    saveQuitMarker,
    auditWrites: [rollbackWrite, retryWrite, settledWrite],
    firstAuditOrdinal: 3,
    expectedCoordinate: GRASS_COORDINATE,
    expectedPreviousBlockId: MEADOW_GRASS_BLOCK_ID,
    expectedBlockId: 0,
    expectedSelectedSlot: 0,
    expectedSelectedStack: starterStack(),
    expectedGeneratedDrop: { item: MEADOW_GRASS_ITEM_ID, count: 1 },
    requireRustAuthoredDirtySet: true,
  };
  const evidence = assertGenericNativeBlockEditRecoveryTransaction(input);
  assert.equal(evidence.cursorAfter, 1);
  assert.equal(evidence.generatedDrop.rustEntityId, ACQUIRED_DROP_ID);
  assert.equal(evidence.retryWrite.ordinal, 4);
  assert.equal(evidence.settledWrite.ordinal, 5);

  assert.throws(() => assertGenericNativeBlockEditRecoveryTransaction({
    ...input, failureInjection: { ...injection, failures: 0 },
  }), /one exact restored active-world failure injection/u);
  const prematurelyDurable = structuredClone(pending);
  prematurelyDurable.storage = structuredClone(titleAfterSave.storage);
  assert.throws(() => assertGenericNativeBlockEditRecoveryTransaction({
    ...input, pending: prematurelyDurable,
  }), /changed the durable browser document/u);
  const unacknowledged = structuredClone(settledWrite);
  unacknowledged.runtime.playerAuthority.pump.nativeBlockEditCursor = 0;
  unacknowledged.runtime.playerAuthority.pump.pendingNativeBlockEditSequence = 1;
  assert.throws(() => assertGenericNativeBlockEditRecoveryTransaction({
    ...input, auditWrites: [rollbackWrite, retryWrite, unacknowledged],
  }), /settled-after-ack/u);
  const wrongAttempt = structuredClone(injection);
  wrongAttempt.events[0].save.rustNativeBlockEditProjection.cursor = 0;
  assert.throws(() => assertGenericNativeBlockEditRecoveryTransaction({
    ...input, failureInjection: wrongAttempt,
  }), /intercept the exact projected successor/u);
  const rawRollbackDrift = structuredClone(injection);
  rawRollbackDrift.restoredDocumentSha256 = "ff".repeat(32);
  assert.throws(() => assertGenericNativeBlockEditRecoveryTransaction({
    ...input, failureInjection: rawRollbackDrift,
  }), /one exact restored active-world failure injection/u);
  const divergent = structuredClone(retryWrite);
  divergent.ordinal = 6;
  divergent.save.inventory[0] = { item: 124, count: 2 };
  assert.throws(() => assertGenericNativeBlockEditRecoveryTransaction({
    ...input, auditWrites: [rollbackWrite, retryWrite, settledWrite, divergent],
  }), /divergent, missing, or duplicate successor/u);
  const duplicate = structuredClone(retryWrite);
  duplicate.ordinal = 6;
  duplicate.at = 6.5;
  assert.throws(() => assertGenericNativeBlockEditRecoveryTransaction({
    ...input, auditWrites: [rollbackWrite, retryWrite, settledWrite, duplicate],
  }), /divergent, missing, or duplicate successor/u);
  const earlyMarker = { ...saveQuitMarker, at: 4.6 };
  assert.throws(() => assertGenericNativeBlockEditRecoveryTransaction({
    ...input, saveQuitMarker: earlyMarker,
  }), /exactly ordered rollback/u);
});

test("generic Meadow Grass dirty evidence rejects structural, identity, ordering, ancestry, and hash tamper", () => {
  const after = snapshot({
    cursor: 1,
    hash: RECEIPT_ONE,
    editType: 0,
    saves: 5,
    drops: [nativeMeadowGrassDrop(ACQUIRED_DROP_ID, 0.1)],
    editIndex: GRASS_EDIT_INDEX,
    coordinate: GRASS_COORDINATE,
    previousBlockId: MEADOW_GRASS_BLOCK_ID,
    inventoryDomainRevision: "9",
    blockEditProtocolVersion: 2,
  });
  const expectations = {
    cursorBefore: 0,
    cursorAfter: 1,
    receiptHash: RECEIPT_ONE,
    action: "mine",
    coordinate: GRASS_COORDINATE,
    expectedPreviousBlockId: MEADOW_GRASS_BLOCK_ID,
    expectedBlockId: 0,
    requireRustAuthoredDirtySet: true,
  };
  const checkpoint = assertNativeBlockEditCheckpointWitness(after, expectations);
  assert.deepEqual(
    assertRustAuthoredNativeBlockEditDirtySetV2(checkpoint, GRASS_COORDINATE),
    checkpoint.dirty,
  );
  assert.deepEqual(checkpoint.dirty.sections, [{
    universeId: "world-basic-dirt",
    locationId: "overworld",
    chunkX: 0,
    chunkZ: -1,
    sectionY: 6,
  }]);
  assert.deepEqual(checkpoint.dirty.columns, [{ x: 1, z: -3 }]);

  const legacyProtocol = structuredClone(after);
  legacyProtocol.runtime.playerAuthority.nativeBlockEditCheckpoint.protocolVersion = 1;
  legacyProtocol.runtime.playerAuthority.nativeBlockEditCheckpoint.legacyFallback = "v1-capability";
  assert.throws(
    () => assertNativeBlockEditCheckpointWitness(legacyProtocol, expectations),
    /non-legacy V2 dirty-evidence protocol/u,
  );
  const legacyFallback = structuredClone(after);
  legacyFallback.runtime.playerAuthority.nativeBlockEditCheckpoint.legacyFallback = "v2-pre-v14";
  assert.throws(
    () => assertNativeBlockEditCheckpointWitness(legacyFallback, expectations),
    /non-legacy V2 dirty-evidence protocol/u,
  );
  const missingDirty = structuredClone(after);
  missingDirty.runtime.playerAuthority.nativeBlockEditCheckpoint.dirty = null;
  assert.throws(
    () => assertNativeBlockEditCheckpointWitness(missingDirty, expectations),
    /exact cursor and V1 receipt ancestry/u,
  );

  const rehash = (candidate) => {
    candidate.runtime.playerAuthority.nativeBlockEditCheckpoint.dirty.evidenceHash
      = nativeBlockEditDirtyEvidenceHashV2(
        candidate.runtime.playerAuthority.nativeBlockEditCheckpoint.dirty,
      );
    return candidate;
  };
  const extraSection = structuredClone(after);
  extraSection.runtime.playerAuthority.nativeBlockEditCheckpoint.dirty.sections.push({
    universeId: "world-basic-dirt", locationId: "overworld", chunkX: 1, chunkZ: -1, sectionY: 6,
  });
  assert.throws(
    () => assertNativeBlockEditCheckpointWitness(rehash(extraSection), expectations),
    /exactly one Rust-authored dirty section/u,
  );

  const missingSection = structuredClone(after);
  missingSection.runtime.playerAuthority.nativeBlockEditCheckpoint.dirty.sections = [];
  assert.throws(
    () => assertNativeBlockEditCheckpointWitness(rehash(missingSection), expectations),
    /exactly one Rust-authored dirty section/u,
  );

  const reorderedSubsystems = structuredClone(after);
  const reordered = reorderedSubsystems.runtime.playerAuthority.nativeBlockEditCheckpoint.dirty
    .subsystemSeeds;
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(
    () => assertNativeBlockEditCheckpointWitness(rehash(reorderedSubsystems), expectations),
    /seven ordered canonical subsystem seeds/u,
  );

  const crossWorld = structuredClone(after);
  crossWorld.runtime.playerAuthority.nativeBlockEditCheckpoint.dirty.sections[0].universeId
    = "world-other";
  assert.throws(
    () => assertNativeBlockEditCheckpointWitness(rehash(crossWorld), expectations),
    /active world identity/u,
  );

  const wrongAncestry = structuredClone(after);
  wrongAncestry.runtime.playerAuthority.nativeBlockEditCheckpoint.dirty.sequence = 2;
  assert.throws(
    () => assertNativeBlockEditCheckpointWitness(rehash(wrongAncestry), expectations),
    /exact cursor and V1 receipt ancestry/u,
  );

  const tamperedSeed = structuredClone(after);
  tamperedSeed.runtime.playerAuthority.nativeBlockEditCheckpoint.dirty.subsystemSeeds[0].seed
    = "fe".repeat(16);
  assert.throws(
    () => assertNativeBlockEditCheckpointWitness(tamperedSeed, expectations),
    /hash does not match its canonical fields/u,
  );
});

test("action evidence rejects old-cursor optimistic writes and selected-stack drift", () => {
  const before = snapshot({ cursor: 1, hash: RECEIPT_ONE, editType: 0, saves: 5, selected: 1, slotOne: dirtStack() });
  const after = snapshot({ cursor: 2, hash: RECEIPT_TWO, editType: 2, saves: 6, selected: 1, slotOne: null });
  const premature = pendingActionWrite({
    ordinal: 7, cursorBefore: 1, cursorAfter: 1, hash: RECEIPT_ONE,
    editType: 2, saves: 5, selected: 1, slotOne: null,
  });
  assert.throws(() => assertBasicDirtActionTransaction({
    action: "place", before, after, auditWrites: [premature], firstAuditOrdinal: 7,
    expectedSelectedSlot: 1, expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
  }), /before the native receipt cursor advanced/u);
  const drift = structuredClone(after);
  drift.storage.save.inventory[1] = dirtStack();
  assert.throws(() => assertBasicDirtActionTransaction({
    action: "place", before, after: drift, auditWrites: [], firstAuditOrdinal: 7,
    expectedSelectedSlot: 1, expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
  }), /wrong exact selected stack/u);

  const missingCheckpoint = structuredClone(after);
  missingCheckpoint.runtime.playerAuthority.nativeBlockEditCheckpoint = null;
  assert.throws(() => assertBasicDirtActionTransaction({
    action: "place", before, after: missingCheckpoint,
    auditWrites: [pendingActionWrite({
      ordinal: 8, cursorBefore: 1, cursorAfter: 2, hash: RECEIPT_TWO,
      editType: 2, saves: 6, selected: 1, slotOne: null,
    })],
    firstAuditOrdinal: 8,
    expectedSelectedSlot: 1,
    expectedSelectedStackBefore: dirtStack(),
    expectedSelectedStackAfter: null,
  }), /receipt\/action\/cell-bound checkpoint witness/u);

  const wrongCheckpointCell = structuredClone(after);
  wrongCheckpointCell.runtime.playerAuthority.nativeBlockEditCheckpoint.cell.x += 1;
  assert.throws(() => assertNativeBlockEditCheckpointWitness(wrongCheckpointCell, {
    cursorBefore: 1,
    cursorAfter: 2,
    receiptHash: RECEIPT_TWO,
    action: "place",
    coordinate: COORDINATE,
  }), /receipt\/action\/cell-bound checkpoint witness/u);

  const ordered = pendingActionWrite({
    ordinal: 9, cursorBefore: 1, cursorAfter: 2, hash: RECEIPT_TWO,
    editType: 2, saves: 6, selected: 1, slotOne: null,
  });
  const zeroQueries = structuredClone(after);
  zeroQueries.runtime.playerAuthority.pump.nativeBlockEditQueryCalls = 0;
  assert.throws(() => assertBasicDirtActionTransaction({
    action: "place", before, after: zeroQueries, auditWrites: [ordered], firstAuditOrdinal: 9,
    expectedSelectedSlot: 1, expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
  }), /configured, seeded, and observed/u);

  const dualQuery = structuredClone(after);
  dualQuery.runtime.playerAuthority.pump.basicDirtActionQueryConfigured = true;
  dualQuery.runtime.playerAuthority.pump.basicDirtActionQuerySuppressedByNativeBlockEdit = true;
  assert.throws(() => assertBasicDirtActionTransaction({
    action: "place", before, after: dualQuery, auditWrites: [ordered], firstAuditOrdinal: 9,
    expectedSelectedSlot: 1, expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
  }), /legacy Basic Dirt query path/u);

  const wrongPendingIdentity = structuredClone(ordered);
  wrongPendingIdentity.runtime.playerAuthority.pump.pendingNativeBlockEditIdentityHash = "bb".repeat(16);
  assert.throws(() => assertBasicDirtActionTransaction({
    action: "place", before, after, auditWrites: [wrongPendingIdentity], firstAuditOrdinal: 9,
    expectedSelectedSlot: 1, expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
  }), /no observed local document/u);

  const wrongPersistence = structuredClone(ordered);
  wrongPersistence.runtime.manager.host.nativePersistence.worldId = "world:wrong@overworld";
  assert.throws(() => assertBasicDirtActionTransaction({
    action: "place", before, after, auditWrites: [wrongPersistence], firstAuditOrdinal: 9,
    expectedSelectedSlot: 1, expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
  }), /no observed local document/u);
});

test("native drop hot transforms exactly drive compatibility roots and durable rows", () => {
  const transform = {
    dropId: "drop:4294967298",
    entityId: FINAL_DROP_ID,
    entityRevision: "17",
    position: { x: 1.23456, y: 35.75, z: -2.75321 },
    velocity: { x: 0.12551, y: 1.75449, z: -0.25551 },
    yawRadians: 1.23456789,
    ageTicks: "5",
  };
  const makeSample = ({
    extractionRevision = "10", authorityTick = "20", inventoryDomainRevision = "7",
    entityRevision = transform.entityRevision, ageTicks = transform.ageTicks,
  } = {}) => {
    const accepted = { ...transform, entityRevision, ageTicks };
    return {
      runtime: { playerAuthority: { nativeDropTransforms: {
        extractionRevision, authorityTick, inventoryDomainRevision, transforms: [accepted],
      } } },
      state: { drops: [{
        rustEntityId: FINAL_DROP_ID,
        position: [1.235, 35.75, -2.753],
        velocity: [0.126, 1.754, -0.256],
        rotationY: 1.234568,
        age: Number((Number(BigInt(ageTicks)) * 0.05).toFixed(3)),
      }] },
    };
  };
  const first = assertNativeDropHotTransformSample(makeSample(), FINAL_DROP_ID);
  const second = assertNativeDropHotTransformSample(makeSample({
    extractionRevision: "11", authorityTick: "21", entityRevision: "18", ageTicks: "6",
  }), FINAL_DROP_ID, first);
  assert.equal(second.ageTicks, "6");

  const savedDrop = {
    ...nativeDrop(FINAL_DROP_ID, 0.25),
    x: transform.position.x, y: transform.position.y, z: transform.position.z,
    vx: transform.velocity.x, vy: transform.velocity.y, vz: transform.velocity.z,
    rotationY: transform.yawRadians,
  };
  const write = {
    runtime: makeSample().runtime,
    save: { drops: [savedDrop] },
  };
  assert.equal(assertSavedNativeDropMatchesHotTransform(write, FINAL_DROP_ID).entityRevision, "17");

  const mirroredDrift = makeSample();
  mirroredDrift.state.drops[0].position[0] = 1.234;
  assert.throws(() => assertNativeDropHotTransformSample(mirroredDrift, FINAL_DROP_ID),
    /does not exactly mirror/u);
  assert.throws(() => assertNativeDropHotTransformSample(makeSample({
    extractionRevision: "10", authorityTick: "21", entityRevision: "18", ageTicks: "6",
  }), FINAL_DROP_ID, first), /regressed or reused/u);
  write.save.drops[0].age = 0.3;
  assert.throws(() => assertSavedNativeDropMatchesHotTransform(write, FINAL_DROP_ID),
    /does not preserve/u);
});

test("native pickup requires exact source removal, destination, checkpoint, document, and ack", () => {
  const sourceDrop = nativeDrop(ACQUIRED_DROP_ID, 0.5);
  const before = snapshot({ cursor: 1, hash: RECEIPT_ONE, editType: 0, saves: 4, drops: [sourceDrop] });
  const after = snapshot({
    cursor: 1, hash: RECEIPT_ONE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 0, saves: 6, slotOne: dirtStack(),
  });
  const evidence = assertNativeDirtPickupTransaction({
    before, after, auditWrites: [
      pendingPickupPredecessorWrite({ ordinal: 8, saves: 5, sourceDrop }),
      pendingPickupWrite({ ordinal: 9, saves: 6 }),
    ],
    firstAuditOrdinal: 8, expectedRustEntityId: ACQUIRED_DROP_ID,
  });
  assert.equal(evidence.cursorAfter, 1);
  assert.equal(evidence.destinationSlot, 1);
  assert.deepEqual(evidence.destinationStack, dirtStack());
  assert.equal(evidence.nativeCheckpointAnchor.saves, 5);
});

test("native pickup rejects optimistic old-cursor custody and mismatched native identity", () => {
  const sourceDrop = nativeDrop(ACQUIRED_DROP_ID, 0.5);
  const before = snapshot({ cursor: 1, hash: RECEIPT_ONE, editType: 0, saves: 5, drops: [sourceDrop] });
  const after = snapshot({
    cursor: 1, hash: RECEIPT_ONE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 0, saves: 6, slotOne: dirtStack(),
  });
  assert.throws(() => assertNativeDirtPickupTransaction({
    before, after, auditWrites: [pendingPickupWrite({ ordinal: 9, saves: 5, cursorAfter: 0 })],
    firstAuditOrdinal: 9, expectedRustEntityId: ACQUIRED_DROP_ID,
  }), /before the native receipt cursor advanced/u);
  assert.throws(() => assertNativeDirtPickupTransaction({
    before, after, auditWrites: [], expectedRustEntityId: FINAL_DROP_ID,
  }), /source is not one exact saved native Dirt drop/u);
});

test("native player drop and player-origin pickup preserve exact checkpoint/document/ack custody", () => {
  const retainedDrop = nativeDrop(FINAL_DROP_ID, 1);
  const playerDrop = nativeBerryDrop(PLAYER_DROP_ID, 0.1);
  const beforeDrop = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 0, saves: 10, drops: [retainedDrop], selected: 0,
  });
  const afterDrop = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    playerDropCursor: 1, playerDropHash: PLAYER_DROP_RECEIPT,
    editType: 0, saves: 11, drops: [retainedDrop, playerDrop], selected: 0,
    slotZero: { item: 124, count: 2 },
  });
  const dropEvidence = assertNativePlayerDropTransaction({
    before: beforeDrop,
    after: afterDrop,
    auditWrites: [pendingPlayerDropWrite({ ordinal: 20, saves: 11, sourceDrop: playerDrop, retainedDrop })],
    firstAuditOrdinal: 20,
  });
  assert.equal(dropEvidence.rustEntityId, PLAYER_DROP_ID);
  assert.equal(dropEvidence.checkpointWitness.checkpoint.checkpointId, "checkpoint-11");

  const afterPickup = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 2, pickupHash: PLAYER_PICKUP_RECEIPT,
    playerDropCursor: 1, playerDropHash: PLAYER_DROP_RECEIPT,
    editType: 0, saves: 12, drops: [retainedDrop], selected: 0,
  });
  const pickupEvidence = assertNativePlayerDropPickupTransaction({
    before: afterDrop,
    after: afterPickup,
    auditWrites: [pendingPlayerPickupWrite({ ordinal: 21, saves: 12, retainedDrop })],
    firstAuditOrdinal: 21,
    expectedRustEntityId: PLAYER_DROP_ID,
  });
  assert.equal(pickupEvidence.cursorAfter, 2);
  assert.deepEqual(pickupEvidence.restoredStack, starterStack());

  const prematureDrop = pendingPlayerDropWrite({
    ordinal: 22, saves: 10, sourceDrop: playerDrop, retainedDrop,
  });
  prematureDrop.save.rustNativePlayerDropProjection = { schema: 1, cursor: 0, lastReceiptHash: null };
  assert.throws(() => assertNativePlayerDropTransaction({
    before: beforeDrop, after: afterDrop, auditWrites: [prematureDrop], firstAuditOrdinal: 22,
  }), /before its native receipt cursor advanced/u);
  const wrongPickup = structuredClone(afterPickup);
  wrongPickup.storage.save.inventory[0].count = 2;
  assert.throws(() => assertNativePlayerDropPickupTransaction({
    before: afterDrop, after: wrongPickup, auditWrites: [], expectedRustEntityId: PLAYER_DROP_ID,
  }), /did not restore/u);
});

test("player-drop checkpoint witness is causal across autosave interleaving and rejects drift", () => {
  const retainedDrop = nativeDrop(FINAL_DROP_ID, 1);
  const playerDrop = nativeBerryDrop(PLAYER_DROP_ID, 0.1);
  const before = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 0, saves: 40, drops: [retainedDrop], selected: 0,
  });
  const after = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    playerDropCursor: 1, playerDropHash: PLAYER_DROP_RECEIPT,
    editType: 0, saves: 42, drops: [retainedDrop, playerDrop], selected: 0,
    slotZero: { item: 124, count: 2 },
  });
  // Save 41 belongs to an already-owned predecessor; the receipt-bound witness
  // proves that only save 42 belongs to the player-drop transaction.
  const write = pendingPlayerDropWrite({ ordinal: 42, saves: 42, sourceDrop: playerDrop, retainedDrop });
  const evidence = assertNativePlayerDropTransaction({
    before, after, auditWrites: [write], firstAuditOrdinal: 42,
  });
  assert.equal(evidence.nativePersistenceObservedBefore.saves, 40);
  assert.equal(evidence.nativeCheckpointBefore.saves, 41);
  assert.equal(evidence.nativeCheckpointAfter.saves, 42);

  const postWriteAutosave = structuredClone(after);
  postWriteAutosave.runtime.manager.host.nativePersistence.saves = 43;
  postWriteAutosave.runtime.manager.host.nativePersistence.platformOperations = 63;
  postWriteAutosave.runtime.manager.host.nativePersistence.lastCheckpointId = "checkpoint-43";
  assert.equal(assertNativePlayerDropTransaction({
    before, after: postWriteAutosave, auditWrites: [write], firstAuditOrdinal: 42,
  }).nativePersistenceObservedAfter.saves, 43);

  const duplicate = structuredClone(after);
  duplicate.runtime.playerAuthority.playerDropCheckpoint.persistenceAfter.saves = 43;
  assert.throws(() => assertNativePlayerDropCheckpointWitness(duplicate, {
    cursorBefore: 0, cursorAfter: 1, receiptHash: PLAYER_DROP_RECEIPT,
  }), /exactly one durable native save/u);
  const wrongReceipt = structuredClone(after);
  wrongReceipt.runtime.playerAuthority.playerDropCheckpoint.receiptHash = RECEIPT_TWO;
  assert.throws(() => assertNativePlayerDropTransaction({
    before, after: wrongReceipt, auditWrites: [write], firstAuditOrdinal: 42,
  }), /receipt-bound checkpoint witness/u);
  const wrongWrite = structuredClone(write);
  wrongWrite.runtime.playerAuthority.playerDropCheckpoint.checkpoint.checkpointId = "checkpoint-other";
  assert.throws(() => assertNativePlayerDropTransaction({
    before, after, auditWrites: [wrongWrite], firstAuditOrdinal: 42,
  }), /no observed local document/u);
});

test("transaction checkpoint anchors use the latest exact pending predecessor and reject a later duplicate", () => {
  const beforeAction = snapshot({
    cursor: 1, hash: RECEIPT_ONE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 0, saves: 30, selected: 1, slotOne: dirtStack(),
  });
  beforeAction.storage.save.selected = 0;
  const afterAction = snapshot({
    cursor: 2, hash: RECEIPT_TWO, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 2, saves: 32, selected: 1, slotOne: null,
  });
  const actionPredecessors = [30, 31].map((saves, index) => pendingActionPredecessorWrite({
    ordinal: 30 + index, saves, cursorBefore: 1, cursorAfter: 2,
    beforeHash: RECEIPT_ONE, pendingHash: RECEIPT_TWO,
    pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 0, selected: index, slotOne: dirtStack(),
  }));
  const orderedAction = pendingActionWrite({
    ordinal: 32, saves: 32, cursorBefore: 1, cursorAfter: 2, hash: RECEIPT_TWO,
    pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 2, selected: 1, slotOne: null,
  });
  const actionEvidence = assertBasicDirtActionTransaction({
    action: "place", before: beforeAction, after: afterAction,
    auditWrites: [...actionPredecessors, orderedAction], firstAuditOrdinal: 30,
    expectedCoordinate: COORDINATE, expectedSelectedSlot: 1,
    expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
    expectedSavedSelectedSlotBefore: 0, expectedSavedSelectedStackBefore: starterStack(),
  });
  assert.equal(actionEvidence.nativeCheckpointAnchor.saves, 31);
  const postActionAutosave = structuredClone(afterAction);
  Object.assign(postActionAutosave.runtime.manager.host.nativePersistence, {
    saves: 33,
    platformOperations: 53,
    lastCheckpointId: "checkpoint-33",
  });
  const postActionAutosaveWrite = structuredClone(orderedAction);
  postActionAutosaveWrite.ordinal = 33;
  postActionAutosaveWrite.runtime.manager.host.nativePersistence = structuredClone(
    postActionAutosave.runtime.manager.host.nativePersistence,
  );
  Object.assign(postActionAutosaveWrite.runtime.playerAuthority.pump, {
    pendingNativeBlockEditSequence: null,
    pendingNativeBlockEditReceiptHash: null,
    pendingNativeBlockEditIdentityHash: null,
    nativeBlockEditCursor: 2,
    lastAcknowledgedNativeBlockEditSequence: 2,
    lastAcknowledgedNativeBlockEditReceiptHash: RECEIPT_TWO,
  });
  const postAutosaveEvidence = assertBasicDirtActionTransaction({
    action: "place", before: beforeAction, after: postActionAutosave,
    auditWrites: [...actionPredecessors, orderedAction, postActionAutosaveWrite], firstAuditOrdinal: 30,
    expectedCoordinate: COORDINATE, expectedSelectedSlot: 1,
    expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
    expectedSavedSelectedSlotBefore: 0, expectedSavedSelectedStackBefore: starterStack(),
  });
  assert.equal(postAutosaveEvidence.nativeCheckpointAnchor.saves, 31);
  assert.equal(postAutosaveEvidence.nativePersistenceObservedAfter.saves, 33);
  const firstReceiptBoundAction = pendingActionWrite({
    ordinal: 31, saves: 31, cursorBefore: 1, cursorAfter: 2, hash: RECEIPT_ONE,
    pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 2, selected: 1, slotOne: null,
  });
  assert.throws(() => assertBasicDirtActionTransaction({
    action: "place", before: beforeAction, after: afterAction,
    auditWrites: [firstReceiptBoundAction, orderedAction], firstAuditOrdinal: 30,
    expectedCoordinate: COORDINATE, expectedSelectedSlot: 1,
    expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
    expectedSavedSelectedSlotBefore: 0, expectedSavedSelectedStackBefore: starterStack(),
  }), /multiple receipt or checkpoint identities/u);
  const reusedCheckpointId = structuredClone(afterAction);
  const reusedWitness = reusedCheckpointId.runtime.playerAuthority.nativeBlockEditCheckpoint;
  reusedWitness.checkpoint.checkpointId = reusedWitness.persistenceBefore.lastCheckpointId;
  reusedWitness.persistenceAfter.lastCheckpointId = reusedWitness.persistenceBefore.lastCheckpointId;
  assert.throws(() => assertNativeBlockEditCheckpointWitness(reusedCheckpointId, {
    cursorBefore: 1,
    cursorAfter: 2,
    receiptHash: RECEIPT_TWO,
    action: "place",
    coordinate: COORDINATE,
  }), /exactly one durable native save/u);
  const missingPriorCheckpointId = structuredClone(afterAction);
  delete missingPriorCheckpointId.runtime.playerAuthority
    .nativeBlockEditCheckpoint.persistenceBefore.lastCheckpointId;
  assert.throws(() => assertNativeBlockEditCheckpointWitness(missingPriorCheckpointId, {
    cursorBefore: 1,
    cursorAfter: 2,
    receiptHash: RECEIPT_TWO,
    action: "place",
    coordinate: COORDINATE,
  }), /exactly one durable native save/u);
  const emptyPriorCheckpointId = structuredClone(afterAction);
  emptyPriorCheckpointId.runtime.playerAuthority
    .nativeBlockEditCheckpoint.persistenceBefore.lastCheckpointId = "";
  assert.throws(() => assertNativeBlockEditCheckpointWitness(emptyPriorCheckpointId, {
    cursorBefore: 1,
    cursorAfter: 2,
    receiptHash: RECEIPT_TWO,
    action: "place",
    coordinate: COORDINATE,
  }), /exactly one durable native save/u);
  const duplicateActionAfter = snapshot({
    cursor: 2, hash: RECEIPT_TWO, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 2, saves: 33, selected: 1, slotOne: null,
  });
  const duplicateOrderedAction = pendingActionWrite({
    ordinal: 33, saves: 33, cursorBefore: 1, cursorAfter: 2, hash: RECEIPT_TWO,
    pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 2, selected: 1, slotOne: null,
  });
  assert.throws(() => assertBasicDirtActionTransaction({
    action: "place", before: beforeAction, after: duplicateActionAfter,
    auditWrites: [...actionPredecessors, duplicateOrderedAction], firstAuditOrdinal: 30,
    expectedCoordinate: COORDINATE, expectedSelectedSlot: 1,
    expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
    expectedSavedSelectedSlotBefore: 0, expectedSavedSelectedStackBefore: starterStack(),
  }), /latest evidenced pending predecessor/u);
  const missingActionIdentity = structuredClone(actionPredecessors[1]);
  delete missingActionIdentity.runtime.playerAuthority.pump.pendingNativeBlockEditIdentityHash;
  assert.throws(() => assertBasicDirtActionTransaction({
    action: "place", before: beforeAction, after: afterAction,
    auditWrites: [actionPredecessors[0], missingActionIdentity, orderedAction], firstAuditOrdinal: 30,
    expectedCoordinate: COORDINATE, expectedSelectedSlot: 1,
    expectedSelectedStackBefore: dirtStack(), expectedSelectedStackAfter: null,
    expectedSavedSelectedSlotBefore: 0, expectedSavedSelectedStackBefore: starterStack(),
  }), /latest evidenced pending predecessor/u);

  const retainedDrop = nativeDrop(FINAL_DROP_ID, 1);
  const playerDrop = nativeBerryDrop(PLAYER_DROP_ID, 0.1);
  const beforeDrop = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 0, saves: 40, drops: [retainedDrop], selected: 0,
  });
  const afterDrop = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    playerDropCursor: 1, playerDropHash: PLAYER_DROP_RECEIPT,
    editType: 0, saves: 42, drops: [retainedDrop, playerDrop], selected: 0,
    slotZero: { item: 124, count: 2 },
  });
  const dropPredecessors = [40, 41].map((saves, index) => pendingPlayerDropPredecessorWrite({
    ordinal: 40 + index,
    saves,
    retainedDrop: {
      ...retainedDrop,
      x: retainedDrop.x + (index + 1) * 0.125,
      rotationY: retainedDrop.rotationY + (index + 1) * 0.25,
      age: retainedDrop.age + index + 1,
    },
  }));
  const orderedDrop = pendingPlayerDropWrite({
    ordinal: 42, saves: 42, sourceDrop: playerDrop, retainedDrop,
  });
  const dropEvidence = assertNativePlayerDropTransaction({
    before: beforeDrop, after: afterDrop,
    auditWrites: [...dropPredecessors, orderedDrop], firstAuditOrdinal: 40,
  });
  assert.equal(dropEvidence.nativeCheckpointAnchor.saves, 41);

  const beforePickup = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    playerDropCursor: 1, playerDropHash: PLAYER_DROP_RECEIPT,
    editType: 0, saves: 50, drops: [retainedDrop, playerDrop], selected: 0,
    slotZero: { item: 124, count: 2 },
  });
  const afterPickup = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 2, pickupHash: PLAYER_PICKUP_RECEIPT,
    playerDropCursor: 1, playerDropHash: PLAYER_DROP_RECEIPT,
    editType: 0, saves: 52, drops: [retainedDrop], selected: 0,
  });
  const pickupPredecessors = [50, 51].map((saves, index) => pendingPlayerPickupPredecessorWrite({
    ordinal: 50 + index,
    saves,
    retainedDrop: {
      ...retainedDrop,
      z: retainedDrop.z - (index + 1) * 0.125,
      rotationY: retainedDrop.rotationY + (index + 1) * 0.25,
      age: retainedDrop.age + index + 1,
    },
    sourceDrop: {
      ...playerDrop,
      x: playerDrop.x + (index + 1) * 0.25,
      age: playerDrop.age + index + 1,
    },
  }));
  const orderedPickup = pendingPlayerPickupWrite({ ordinal: 52, saves: 52, retainedDrop });
  const pickupEvidence = assertNativePlayerDropPickupTransaction({
    before: beforePickup, after: afterPickup,
    auditWrites: [...pickupPredecessors, orderedPickup], firstAuditOrdinal: 50,
    expectedRustEntityId: PLAYER_DROP_ID,
  });
  assert.equal(pickupEvidence.nativeCheckpointAnchor.saves, 51);
  const wrongPickupReceipt = structuredClone(afterPickup);
  wrongPickupReceipt.runtime.playerAuthority.dropPickupCheckpoint.receiptHash = RECEIPT_TWO;
  assert.throws(() => assertNativePlayerDropPickupTransaction({
    before: beforePickup, after: wrongPickupReceipt,
    auditWrites: [...pickupPredecessors, orderedPickup], firstAuditOrdinal: 50,
    expectedRustEntityId: PLAYER_DROP_ID,
  }), /receipt\/entity-bound checkpoint witness/u);
  const duplicatePickup = structuredClone(afterPickup);
  duplicatePickup.runtime.playerAuthority.dropPickupCheckpoint.persistenceAfter.saves = 53;
  assert.throws(() => assertNativeDropPickupCheckpointWitness(duplicatePickup, {
    cursorBefore: 1,
    cursorAfter: 2,
    receiptHash: PLAYER_PICKUP_RECEIPT,
    rustEntityId: PLAYER_DROP_ID,
  }), /exactly one durable native save/u);
  const wrongPickupWrite = structuredClone(orderedPickup);
  wrongPickupWrite.runtime.playerAuthority.dropPickupCheckpoint.rustEntityId = FINAL_DROP_ID;
  assert.throws(() => assertNativePlayerDropPickupTransaction({
    before: beforePickup, after: afterPickup,
    auditWrites: [...pickupPredecessors, wrongPickupWrite], firstAuditOrdinal: 50,
    expectedRustEntityId: PLAYER_DROP_ID,
  }), /no browser document/u);
});

test("trusted touch proof requires look, two mines, movement, selection, and place", () => {
  const proof = {
    trustedTouchLookDown: [{ trusted: true, pointerId: 11 }],
    trustedTouchLookMoves: [{ trusted: true, pointerId: 11 }],
    trustedTouchPlaceDown: [{ trusted: true, pointerId: 23 }],
    trustedTouchPlaceUp: [{ trusted: true, pointerId: 23 }],
    trustedTouchMineDown: [{ trusted: true, pointerId: 22 }, { trusted: true, pointerId: 24 }],
    trustedTouchMineUp: [{ trusted: true, pointerId: 22 }, { trusted: true, pointerId: 24 }],
    trustedTouchMoveDown: [
      { trusted: true, pointerId: 31, label: "Move forward" },
      { trusted: true, pointerId: 33, label: "Move backward" },
    ],
    trustedTouchMoveUp: [
      { trusted: true, pointerId: 31, label: "Move forward" },
      { trusted: true, pointerId: 33, label: "Move backward" },
    ],
    trustedTouchHotbarDown: [{ trusted: true, pointerId: 41, label: "Slot 2: Dirt x1" }],
    trustedTouchHotbarUp: [{ trusted: true, pointerId: 41, label: "Slot 2: Dirt x1" }],
  };
  assert.equal(assertTrustedBasicDirtActionInputs(proof).mode, "public-touch-controls");
  assert.throws(() => assertTrustedBasicDirtActionInputs({
    ...proof,
    trustedTouchMineDown: [{ trusted: true, pointerId: 22 }],
    trustedTouchMineUp: [{ trusted: true, pointerId: 22 }],
  }), /Two distinct/u);
  assert.throws(() => assertTrustedBasicDirtActionInputs({ ...proof, trustedTouchHotbarUp: [] }),
    /hotbar slot/u);
});

test("generic Meadow Grass input proof accepts exactly one public mine and rejects out-of-scope actions", () => {
  const proof = {
    trustedTouchLookDown: [{ trusted: true, pointerId: 11 }],
    trustedTouchLookMoves: [{ trusted: true, pointerId: 11 }],
    trustedTouchMineDown: [{ trusted: true, pointerId: 22 }],
    trustedTouchMineUp: [{ trusted: true, pointerId: 22 }],
    trustedTouchMoveDown: [{ trusted: true, pointerId: 31, label: "Move forward" }],
    trustedTouchMoveUp: [{ trusted: true, pointerId: 31, label: "Move forward" }],
    trustedTouchPlaceDown: [],
    trustedTouchPlaceUp: [],
    trustedPlayerDropKeyDown: [],
    trustedPlayerDropKeyUp: [],
  };
  assert.equal(assertTrustedGenericMineInput(proof).mode, "public-touch-controls");
  assert.throws(() => assertTrustedGenericMineInput({
    ...proof,
    trustedTouchMineDown: [...proof.trustedTouchMineDown, { trusted: true, pointerId: 23 }],
    trustedTouchMineUp: [...proof.trustedTouchMineUp, { trusted: true, pointerId: 23 }],
  }), /Exactly one complete/u);
  assert.throws(() => assertTrustedGenericMineInput({
    ...proof,
    trustedTouchHotbarDown: [{ trusted: true, pointerId: 24, label: "Slot 2: Empty" }],
  }), /out-of-scope/u);
});

test("generic shaped prop input proof binds one visible item-270 selection, placement, and mine", () => {
  const audit = {
    trustedTouchLookDown: [
      { trusted: true, pointerId: 11 },
      { trusted: true, pointerId: 12 },
      { trusted: true, pointerId: 99 },
    ],
    trustedTouchLookMoves: [
      { trusted: true, pointerId: 11 },
      { trusted: true, pointerId: 12 },
    ],
    trustedTouchPlaceDown: [{ trusted: true, pointerId: 23 }],
    trustedTouchPlaceUp: [{ trusted: true, pointerId: 23 }],
    trustedTouchMineDown: [{ trusted: true, pointerId: 24 }],
    trustedTouchMineUp: [{ trusted: true, pointerId: 24 }],
    trustedTouchMoveDown: [{ trusted: true, pointerId: 31, label: "Move forward" }],
    trustedTouchMoveUp: [{ trusted: true, pointerId: 31, label: "Move forward" }],
    trustedTouchHotbarDown: [],
    trustedTouchHotbarUp: [],
    trustedPlayerDropKeyDown: [],
    trustedPlayerDropKeyUp: [],
  };
  const catalogSelection = {
    schema: 1,
    query: "Wildwood Shelf",
    visibleEntries: 1,
    item: 270,
    name: "Wildwood Shelf",
    title: "Place Wildwood Shelf in the selected hotbar slot",
    clicked: true,
  };
  assert.equal(
    assertTrustedGenericShapedPropInputs(audit, catalogSelection).mode,
    "public-ui-and-touch-controls",
  );
  assert.throws(() => assertTrustedGenericShapedPropInputs({
    ...audit,
    trustedTouchLookMoves: [{ trusted: true, pointerId: 11 }],
  }, catalogSelection), /two complete trusted public touch-look gestures/u);
  assert.throws(() => assertTrustedGenericShapedPropInputs({
    ...audit,
    trustedTouchMineDown: [],
    trustedTouchMineUp: [],
  }, catalogSelection), /exactly one complete/u);
  assert.throws(() => assertTrustedGenericShapedPropInputs(audit, {
    ...catalogSelection,
    visibleEntries: 2,
  }), /exact visible Creative catalog selection/u);
  assert.throws(() => assertTrustedGenericShapedPropInputs({
    ...audit,
    trustedPlayerDropKeyDown: [{ trusted: true, code: "KeyG" }],
  }, catalogSelection), /out-of-scope/u);
});

test("native player drop proof requires exactly one complete trusted G gesture", () => {
  assert.deepEqual(assertTrustedNativePlayerDropInput({
    trustedPlayerDropKeyDown: [{ at: 1, trusted: true, code: "KeyG" }],
    trustedPlayerDropKeyUp: [{ at: 2, trusted: true, code: "KeyG" }],
  }), {
    mode: "public-keyboard-control", code: "KeyG", trustedKeyDown: 1, trustedKeyUp: 1,
  });
  assert.throws(() => assertTrustedNativePlayerDropInput({
    trustedPlayerDropKeyDown: [{ at: 1, trusted: false, code: "KeyG" }],
    trustedPlayerDropKeyUp: [{ at: 2, trusted: true, code: "KeyG" }],
  }), /Exactly one complete/u);
});

test("fresh restoration requires exact three-action/one-pickup save and final native drop", () => {
  const finalDrop = nativeDrop(FINAL_DROP_ID, 1.25);
  const titleAfterSave = snapshot({
    cursor: 3, hash: RECEIPT_THREE, pickupCursor: 1, pickupHash: PICKUP_RECEIPT,
    editType: 0, saves: 9, drops: [finalDrop], selected: 1, slotOne: null,
    hydration: "restored", recoveries: 1,
  });
  const titleAfterReload = structuredClone(titleAfterSave);
  const continued = structuredClone(titleAfterSave);
  continued.runtime.playerAuthority.pump.lastAcknowledgedNativeBlockEditSequence = null;
  continued.runtime.playerAuthority.pump.lastAcknowledgedNativeBlockEditReceiptHash = null;
  continued.runtime.playerAuthority.pump.lastAcknowledgedDropPickupSequence = null;
  continued.runtime.playerAuthority.pump.lastAcknowledgedDropPickupReceiptHash = null;
  const liveEmptyCellEvidence = {
    liveCellObservedEmpty: true,
    emptyCoordinate: COORDINATE,
    emptyRayOrdinal: 2,
    supportTarget: { type: "block", position: [1, 34, -3] },
    supportTargetRayOrdinal: 3,
  };
  const restored = assertBasicDirtFreshRestoration({
    titleAfterSave, titleAfterReload, continued, coordinate: COORDINATE,
    acquiredDropId: ACQUIRED_DROP_ID, liveEmptyCellEvidence,
  });
  assert.equal(restored.cursor.cursor, 3);
  assert.equal(restored.pickupCursor.cursor, 1);
  assert.equal(restored.nativeDrop.rustEntityId, FINAL_DROP_ID);
  const continuedAfterDropMotion = structuredClone(continued);
  Object.assign(continuedAfterDropMotion.storage.save.drops[0], {
    x: 2.5, y: 34.25, z: -2.75, age: 6.25, rotationY: 17.5, vx: 0, vy: -0.1, vz: 0,
  });
  assert.doesNotThrow(() => assertBasicDirtFreshRestoration({
    titleAfterSave, titleAfterReload, continued: continuedAfterDropMotion, coordinate: COORDINATE,
    acquiredDropId: ACQUIRED_DROP_ID, liveEmptyCellEvidence,
  }));
  const custodyDrift = structuredClone(continued);
  custodyDrift.storage.save.drops[0].count = 2;
  assert.throws(() => assertBasicDirtFreshRestoration({
    titleAfterSave, titleAfterReload, continued: custodyDrift, coordinate: COORDINATE,
    acquiredDropId: ACQUIRED_DROP_ID, liveEmptyCellEvidence,
  }), /changed durable native block-edit custody/u);
  const drift = structuredClone(continued);
  drift.storage.save.inventory[0].count = 2;
  assert.throws(() => assertBasicDirtFreshRestoration({
    titleAfterSave, titleAfterReload, continued: drift, coordinate: COORDINATE,
    acquiredDropId: ACQUIRED_DROP_ID, liveEmptyCellEvidence,
  }), /changed durable native block-edit custody/u);

  const zeroQueries = structuredClone(continued);
  zeroQueries.runtime.playerAuthority.pump.nativeBlockEditQueryCalls = 0;
  assert.throws(() => assertBasicDirtFreshRestoration({
    titleAfterSave, titleAfterReload, continued: zeroQueries, coordinate: COORDINATE,
    acquiredDropId: ACQUIRED_DROP_ID, liveEmptyCellEvidence,
  }), /configured, seeded, and observed/u);
  const dualQuery = structuredClone(continued);
  dualQuery.runtime.playerAuthority.pump.basicDirtActionQueryConfigured = true;
  dualQuery.runtime.playerAuthority.pump.basicDirtActionQuerySuppressedByNativeBlockEdit = true;
  assert.throws(() => assertBasicDirtFreshRestoration({
    titleAfterSave, titleAfterReload, continued: dualQuery, coordinate: COORDINATE,
    acquiredDropId: ACQUIRED_DROP_ID, liveEmptyCellEvidence,
  }), /legacy Basic Dirt query path/u);
  const stalePendingIdentity = structuredClone(continued);
  stalePendingIdentity.runtime.playerAuthority.pump.pendingNativeBlockEditIdentityHash = BASIC_ACTION_IDENTITY;
  assert.throws(() => assertBasicDirtFreshRestoration({
    titleAfterSave, titleAfterReload, continued: stalePendingIdentity, coordinate: COORDINATE,
    acquiredDropId: ACQUIRED_DROP_ID, liveEmptyCellEvidence,
  }), /receipt is still pending/u);
});

test("generic Meadow Grass restoration requires exact Air and the same native self-drop id", () => {
  const grassDrop = nativeMeadowGrassDrop(ACQUIRED_DROP_ID, 1.25);
  const titleAfterSave = snapshot({
    cursor: 1,
    hash: RECEIPT_ONE,
    pickupCursor: 0,
    playerDropCursor: 0,
    editType: 0,
    saves: 6,
    drops: [grassDrop],
    selected: 0,
    editIndex: GRASS_EDIT_INDEX,
    coordinate: GRASS_COORDINATE,
    previousBlockId: MEADOW_GRASS_BLOCK_ID,
    hydration: "restored",
    recoveries: 1,
  });
  const titleAfterReload = structuredClone(titleAfterSave);
  const continued = structuredClone(titleAfterSave);
  continued.runtime.playerAuthority.pump.lastAcknowledgedNativeBlockEditSequence = null;
  continued.runtime.playerAuthority.pump.lastAcknowledgedNativeBlockEditReceiptHash = null;
  const liveEmptyCellEvidence = {
    liveCellObservedEmpty: true,
    emptyCoordinate: GRASS_COORDINATE,
    emptyRayOrdinal: 2,
    supportTarget: { type: "block", position: [1, 35, -3] },
    supportTargetRayOrdinal: 3,
  };
  const evidence = assertGenericNativeBlockEditFreshRestoration({
    titleAfterSave,
    titleAfterReload,
    continued,
    coordinate: GRASS_COORDINATE,
    expectedCursor: 1,
    expectedPickupCursor: 0,
    expectedPlayerDropCursor: 0,
    expectedSelectedSlot: 0,
    expectedSelectedStack: starterStack(),
    expectedDrop: { item: MEADOW_GRASS_ITEM_ID, count: 1 },
    expectedDropId: ACQUIRED_DROP_ID,
    liveEmptyCellEvidence,
  });
  assert.equal(evidence.cursor.cursor, 1);
  assert.equal(evidence.pickupCursor.cursor, 0);
  assert.equal(evidence.nativeDrop.rustEntityId, ACQUIRED_DROP_ID);
  assert.throws(() => assertGenericNativeBlockEditFreshRestoration({
    titleAfterSave, titleAfterReload, continued, coordinate: GRASS_COORDINATE,
    expectedCursor: 1, expectedPickupCursor: 0, expectedPlayerDropCursor: 0,
    expectedSelectedSlot: 0, expectedSelectedStack: starterStack(),
    expectedRestoredBlockId: 1,
    expectedDrop: { item: MEADOW_GRASS_ITEM_ID, count: 1 }, expectedDropId: ACQUIRED_DROP_ID,
    liveEmptyCellEvidence,
  }), /expected block/u);

  assert.throws(() => assertGenericNativeBlockEditFreshRestoration({
    titleAfterSave, titleAfterReload, continued, coordinate: GRASS_COORDINATE,
    expectedCursor: 1, expectedPickupCursor: 0, expectedPlayerDropCursor: 0,
    expectedSelectedSlot: 0, expectedSelectedStack: starterStack(),
    expectedDrop: { item: MEADOW_GRASS_ITEM_ID, count: 1 }, expectedDropId: ACQUIRED_DROP_ID,
  }), /live-terrain ray proof/u);

  const wrongId = structuredClone(continued);
  wrongId.storage.save.drops[0].rustEntityId = FINAL_DROP_ID;
  wrongId.state.drops[0].rustEntityId = FINAL_DROP_ID;
  assert.throws(() => assertGenericNativeBlockEditFreshRestoration({
    titleAfterSave, titleAfterReload, continued: wrongId, coordinate: GRASS_COORDINATE,
    expectedCursor: 1, expectedPickupCursor: 0, expectedPlayerDropCursor: 0,
    expectedSelectedSlot: 0, expectedSelectedStack: starterStack(),
    expectedDrop: { item: MEADOW_GRASS_ITEM_ID, count: 1 }, expectedDropId: ACQUIRED_DROP_ID,
    liveEmptyCellEvidence,
  }), /changed durable native block-edit custody|expected native drop/u);

  const pickupDrift = structuredClone(continued);
  pickupDrift.storage.save.rustNativeDropPickupProjection = {
    schema: 1, cursor: 1, lastReceiptHash: PICKUP_RECEIPT,
  };
  pickupDrift.runtime.playerAuthority.dropPickupProjection = {
    schema: 1, cursor: 1, lastReceiptHash: PICKUP_RECEIPT,
  };
  pickupDrift.runtime.playerAuthority.pump.dropPickupCursor = 1;
  assert.throws(() => assertGenericNativeBlockEditFreshRestoration({
    titleAfterSave, titleAfterReload, continued: pickupDrift, coordinate: GRASS_COORDINATE,
    expectedCursor: 1, expectedPickupCursor: 0, expectedPlayerDropCursor: 0,
    expectedSelectedSlot: 0, expectedSelectedStack: starterStack(),
    expectedDrop: { item: MEADOW_GRASS_ITEM_ID, count: 1 }, expectedDropId: ACQUIRED_DROP_ID,
    liveEmptyCellEvidence,
  }), /changed durable native block-edit custody|pickup browser cursor/u);
});

test("generic shaped prop restoration retains exact empty cell, cleared facing, and item-270 drop", () => {
  const shelfStack = { item: SHELF_ITEM_ID, count: 64 };
  const shelfDrop = nativeWildwoodShelfDrop(ACQUIRED_DROP_ID, 1.25);
  const final = snapshot({
    cursor: 2,
    hash: RECEIPT_TWO,
    pickupCursor: 0,
    playerDropCursor: 0,
    editType: 0,
    saves: 7,
    drops: [shelfDrop],
    selected: 0,
    slotZero: shelfStack,
    editIndex: SHELF_EDIT_INDEX,
    coordinate: SHELF_COORDINATE,
    previousBlockId: SHELF_BLOCK_ID,
    action: "mine",
    previousFacing: 1,
    facing: 0,
    mode: "survival",
    hydration: "restored",
    recoveries: 1,
    blockEditProtocolVersion: 2,
  });
  const titleAfterSave = structuredClone(final);
  titleAfterSave.state.state = "title";
  const titleAfterReload = structuredClone(titleAfterSave);
  const continued = structuredClone(final);
  const liveEmptyCellEvidence = {
    liveCellObservedEmpty: true,
    emptyCoordinate: SHELF_COORDINATE,
    emptyRayOrdinal: 2,
    supportTarget: {
      type: "block",
      position: [...GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.placementSupportCoordinate],
    },
    supportTargetRayOrdinal: 3,
  };
  const evidence = assertGenericNativeBlockEditFreshRestoration({
    titleAfterSave,
    titleAfterReload,
    continued,
    coordinate: SHELF_COORDINATE,
    expectedCursor: 2,
    expectedPickupCursor: 0,
    expectedPlayerDropCursor: 0,
    expectedSelectedSlot: 0,
    expectedSelectedStack: shelfStack,
    expectedRestoredBlockId: 0,
    expectedRestoredFacing: 0,
    expectedDrop: { item: SHELF_ITEM_ID, count: 1 },
    expectedDropId: ACQUIRED_DROP_ID,
    liveEmptyCellEvidence,
  });
  assert.equal(evidence.nativeDrop.item, SHELF_ITEM_ID);
  assert.deepEqual(continued.storage.save.blockFacings, {});

  const staleFacingSave = structuredClone(titleAfterSave);
  const staleFacingReload = structuredClone(titleAfterReload);
  const staleFacingContinued = structuredClone(continued);
  for (const value of [staleFacingSave, staleFacingReload, staleFacingContinued]) {
    value.storage.save.blockFacings[SHELF_COORDINATE.join(",")] = 1;
  }
  assert.throws(() => assertGenericNativeBlockEditFreshRestoration({
    titleAfterSave: staleFacingSave,
    titleAfterReload: staleFacingReload,
    continued: staleFacingContinued,
    coordinate: SHELF_COORDINATE,
    expectedCursor: 2,
    expectedPickupCursor: 0,
    expectedPlayerDropCursor: 0,
    expectedSelectedSlot: 0,
    expectedSelectedStack: shelfStack,
    expectedRestoredBlockId: 0,
    expectedRestoredFacing: 0,
    expectedDrop: { item: SHELF_ITEM_ID, count: 1 },
    expectedDropId: ACQUIRED_DROP_ID,
    liveEmptyCellEvidence,
  }), /expected cardinal facing/u);
});

test("R5 runtime polling starts the blocked-state checkpoint only after global readiness", () => {
  const snapshot = {
    state: { state: "playing" },
    runtime: {
      ready: false,
      operationsBlocked: true,
      playerAuthority: { state: "ready", pump: { state: "ready" } },
    },
  };
  assert.equal(isReadyR5AuthorityCheckpoint(snapshot), false);
  snapshot.runtime.ready = true;
  assert.equal(isReadyR5AuthorityCheckpoint(snapshot), true);
  snapshot.runtime.playerAuthority.pump.state = "stopped";
  assert.equal(isReadyR5AuthorityCheckpoint(snapshot), false);
});

test("error streams and cleanup are all-or-nothing", () => {
  const streams = {
    consoleErrors: [], pageErrors: [], runtimeErrors: [], routeErrors: [],
    httpErrors: [], requestFailures: [], externalRequests: [], webSockets: [],
  };
  assert.equal(assertBasicDirtBrowserErrorStreams(streams), true);
  assert.throws(() => assertBasicDirtBrowserErrorStreams({ ...streams, pageErrors: ["boom"] }),
    /pageErrors contains 1 error/u);
  const cleanup = {
    browserClosed: true, browserDisconnected: true, serverClosed: true,
    serverPortRefused: true, environmentRestored: true, profileRemoved: true,
    profileRootRemoved: true, viteRuntimeRemoved: true, candidateUnchanged: true,
    canonicalUnchanged: true, sourceUnchanged: true, cdpSessionDetached: true,
    browserMutexReleased: true, eventsDrained: true, aliveChildPidsAfterCleanup: [],
  };
  assert.equal(assertBasicDirtCleanupEvidence(cleanup), true);
  assert.throws(() => assertBasicDirtCleanupEvidence({ ...cleanup, canonicalUnchanged: false }),
    /canonicalUnchanged is not true/u);
});

test("tree snapshots detect drift and owned deletion refuses ambiguous targets", (t) => {
  const root = tempRepository(t);
  const owned = path.join(root, "work", ".basic-dirt-test");
  mkdirSync(owned);
  writeFileSync(path.join(owned, "one.txt"), "one\n");
  const first = immutableBasicDirtTreeSnapshot(owned);
  writeFileSync(path.join(owned, "one.txt"), "two\n");
  const second = immutableBasicDirtTreeSnapshot(owned);
  assert.notEqual(first.digest, second.digest);
  assert.throws(() => safeRemoveBasicDirtOwnedDirectory(path.join(root, "work"), root, ".basic-dirt-"),
    /non-direct owned child/u);
  assert.equal(safeRemoveBasicDirtOwnedDirectory(path.join(root, "work"), owned, ".basic-dirt-"), true);
  assert.equal(existsSync(owned), false);
});

test("usage names the exact isolated candidate and native Survival custody path", () => {
  assert.match(usage(), /public\/engine-locator-candidate/u);
  assert.match(usage(), /Survival world/u);
  assert.match(usage(), /walks into and receipts that exact native drop/u);
  assert.match(usage(), /native checkpoint \/ browser projection \/ receipt acknowledgment/u);
  assert.doesNotMatch(usage(), /--base-url/u);
});

test("browser snapshots retain every durable native receipt cursor", () => {
  const source = readFileSync(
    new URL("../scripts/verify-rust-basic-dirt-action-browser.mjs", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(
    /edits: save\.edits[\s\S]{0,180}blockFacings: save\.blockFacings[\s\S]{0,180}drops:/gu,
  ) ?? []).length, 2,
  "both the write audit and browser snapshot must retain directional block facings");
  assert.match(source,
    /rustNativeDropPickupProjection: save\.rustNativeDropPickupProjection[\s\S]{0,320}rustNativePlayerDropProjection: save\.rustNativePlayerDropProjection/u);
});
