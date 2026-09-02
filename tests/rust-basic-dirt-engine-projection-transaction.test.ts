import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BlockId, type InventorySlot } from "../app/game/data.ts";
import { type DropSpawnOptions, VoxelEngine } from "../app/game/engine.ts";
import {
  rustIntegratedRuntimeBasicDirtActionReceiptHashV1,
  rustIntegratedRuntimeBasicDirtContentSubsetHashV1,
  rustIntegratedRuntimeBasicDirtExpectedDropTransformV1,
  type RustIntegratedRuntimeBasicDirtActionContentBindingV1,
  type RustIntegratedRuntimeBasicDirtActionProjectionV1,
} from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";
import type {
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
  RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustIntegratedPlayerInventoryStackV1 } from "../app/game/rust-integrated-runtime-player-inventory.ts";
import type { RustLiveCameraViewR10 } from "../app/game/rust-live-camera-view-r10.ts";
import type { RustLiveInputPumpBasicDirtActionDeliveryV1 } from "../app/game/rust-live-input-pump-r5.ts";
import type { RustLivePlayerViewR10 } from "../app/game/rust-live-player-view-r10.ts";

const GENERATION = 19;
const CONTAINER = Object.freeze({
  kind: "player" as const,
  id: "actor:test",
  ownerId: "actor:test",
});

function hash(value: number) {
  return value.toString(16).padStart(32, "0").slice(-32);
}

function identity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe-live-dirt",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1,
      world: 1,
      entities: 1,
      gameplay: 1,
      persistence: 1,
      network: 1,
      simulation: 1,
    }),
    tick: 90,
    stateHash: hash(90),
  });
}

function content(): RustIntegratedRuntimeBasicDirtActionContentBindingV1 {
  const base = Object.freeze({
    manifestHash: hash(11),
    installedRegistryHash: hash(12),
    catalogSchemaVersion: 2,
    catalogContentVersion: 9,
    catalogBlobHash: hash(13),
    actionReportHash: hash(14),
    subsetHash: hash(15),
  });
  return Object.freeze({
    ...base,
    subsetHash: rustIntegratedRuntimeBasicDirtContentSubsetHashV1(base),
  });
}

function plainDirt(count: number): RustIntegratedPlayerInventoryStackV1 {
  return Object.freeze({
    itemCode: BlockId.Dirt,
    count,
    durabilityMillionths: null,
    metadataHash: hash(0),
  });
}

function actionReceipt(action: "mine" | "place"): RustIntegratedRuntimeBasicDirtActionProjectionV1 {
  const binding = content();
  const position = Object.freeze({ x: 4, y: 43, z: -3 });
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: binding.manifestHash,
    installedRegistryHash: binding.installedRegistryHash,
    catalogBlobHash: binding.catalogBlobHash,
    actionReportHash: binding.actionReportHash,
    rngSemanticsHash: hash(16),
    blockActionSequence: BigInt(31),
    originInputSequence: 12,
    blockId: BlockId.Dirt,
    position,
    lootPlanHash: hash(18),
    groupOrdinal: 0,
  });
  const transform = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(provenance);
  const source = Object.freeze({
    schema: 1 as const,
    sequence: 1,
    originInputSequence: 12,
    completionTick: 90,
    action,
    position,
    priorBlockId: action === "mine" ? BlockId.Dirt : BlockId.Air,
    replacementBlockId: action === "mine" ? BlockId.Air : BlockId.Dirt,
    beforeWorldRevision: Object.freeze({ epoch: 1, mutation: 1, residency: 3 }),
    afterWorldRevision: Object.freeze({ epoch: 1, mutation: 2, residency: 3 }),
    beforeWorldHash: hash(41),
    afterWorldHash: hash(51),
    creativeMode: false,
    inventory: Object.freeze({
      container: CONTAINER,
      slot: 0,
      beforeRevision: BigInt(5),
      afterRevision: BigInt(action === "place" ? 6 : 5),
      beforeStack: action === "place" ? plainDirt(2) : null,
      afterStack: action === "place" ? plainDirt(1) : null,
    }),
    generatedDrops: action === "mine" ? Object.freeze([Object.freeze({
      provenance,
      entityId: BigInt("4294967298"),
      stack: plainDirt(1),
      ...transform,
    })]) : Object.freeze([]),
    content: binding,
    receiptHash: hash(61),
  });
  return Object.freeze({
    ...source,
    receiptHash: rustIntegratedRuntimeBasicDirtActionReceiptHashV1(source),
  });
}

function delivery(receipt: RustIntegratedRuntimeBasicDirtActionProjectionV1) {
  return Object.freeze({
    worldGeneration: GENERATION,
    queryIdentity: identity(),
    cursorBefore: 0,
    cursorAfter: receipt.sequence,
    requestPayloadHash: hash(71),
    projectionPayloadHash: hash(72),
    receipt,
  }) satisfies RustLiveInputPumpBasicDirtActionDeliveryV1;
}

function compatibilitySlot(stack: RustIntegratedPlayerInventoryStackV1 | null): InventorySlot | null {
  return stack === null ? null : { item: stack.itemCode, count: stack.count };
}

function liveHeld(stack: RustIntegratedPlayerInventoryStackV1 | null): RustLivePlayerViewR10["held"] {
  return stack === null ? null : Object.freeze({
    itemCode: stack.itemCode,
    count: stack.count,
    durabilityMillionths: stack.durabilityMillionths,
    metadataHash: Uint8Array.from(Buffer.from(stack.metadataHash, "hex")),
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

type CommitInput = Readonly<{
  generation: number;
  host: HarnessHost;
  pump: HarnessPump;
  delivery: RustLiveInputPumpBasicDirtActionDeliveryV1;
  extraction: RustIntegratedRuntimeExtractionV1;
  requestedView: RustIntegratedRuntimeExtractionViewV1;
  camera: RustLiveCameraViewR10;
}>;

type CommitAccess = Readonly<{
  commitRustBasicDirtActionProjectionV1(input: CommitInput): Promise<void>;
}>;

type HarnessPump = Readonly<{
  checkpointNativePersistence(
    generation: number,
    save: () => Promise<unknown>,
  ): Promise<Readonly<{ discarded: boolean; value: unknown }>>;
  acknowledgeBasicDirtAction(
    generation: number,
    delivery: RustLiveInputPumpBasicDirtActionDeliveryV1,
  ): void;
}>;

type HarnessHost = Readonly<{
  multiplayerAuthority(): Readonly<{
    runExclusiveMutation<T>(operation: () => Promise<T>): Promise<T>;
  }>;
}>;

type HarnessOptions = Readonly<{
  action?: "mine" | "place";
  checkpointGate?: Promise<void>;
  checkpointError?: Error;
  currentBlock?: BlockId;
  localSaveError?: Error;
  multiplayerAuthorityMode?: "rust-authoritative";
  suppressNativeSave?: boolean;
}>;

type SavedDocument = Readonly<{
  save: Readonly<{
    rustBasicDirtActionProjection: Readonly<{
      schema: 1;
      cursor: number;
      lastReceiptHash: string | null;
    }>;
  }>;
  playTimeDeltaMs: number;
}>;

const prototypeStackMatches = (VoxelEngine.prototype as unknown as Readonly<{
  rustTerrainLocatorStackMatches(
    view: RustLivePlayerViewR10["held"],
    expected: RustIntegratedPlayerInventoryStackV1 | null,
  ): boolean;
}>).rustTerrainLocatorStackMatches;

function createHarness(options: HarnessOptions = {}) {
  const receipt = actionReceipt(options.action ?? "mine");
  const actionDelivery = delivery(receipt);
  const calls: string[] = [];
  const checkpointStarted = deferred();
  const savedDocuments: SavedDocument[] = [];
  const acknowledgements: Array<Readonly<{
    generation: number;
    delivery: RustLiveInputPumpBasicDirtActionDeliveryV1;
  }>> = [];
  const counters = {
    worldProjections: 0,
    inventorySuccessors: 0,
    drops: 0,
    nativeSaves: 0,
    localSaves: 0,
  };

  let cell = options.currentBlock ?? receipt.priorBlockId as BlockId;
  const slots = Array.from<InventorySlot | null>({ length: 9 }).fill(null);
  slots[0] = compatibilitySlot(receipt.inventory.beforeStack);
  const inventory = new Proxy(slots, {
    set(target, property, value, receiver) {
      if (property === "0") {
        counters.inventorySuccessors += 1;
        calls.push("inventory:successor");
      }
      return Reflect.set(target, property, value, receiver);
    },
  });

  let beforePlayerChecks = 0;
  const stagedPlayer = Object.freeze({
    selectedSlot: receipt.inventory.slot,
    inventoryContainerRevision: receipt.inventory.afterRevision,
    held: liveHeld(receipt.inventory.afterStack),
  }) as RustLivePlayerViewR10;
  const stagedCamera = Object.freeze({ staged: true }) as unknown as RustLiveCameraViewR10;
  const stagedDrops = Object.freeze({ staged: "drops" });
  const extraction = Object.freeze({ extraction: true }) as unknown as RustIntegratedRuntimeExtractionV1;
  const requestedView = Object.freeze({
    viewportWidth: 1280,
    viewportHeight: 720,
    viewRevision: 7,
  });
  const pumpCamera = Object.freeze({ pump: true }) as unknown as RustLiveCameraViewR10;

  const pump: HarnessPump = Object.freeze({
    async checkpointNativePersistence(generation: number, save: () => Promise<unknown>) {
      assert.equal(generation, GENERATION);
      calls.push("checkpoint:start");
      checkpointStarted.resolve();
      if (options.checkpointGate) await options.checkpointGate;
      if (options.checkpointError) throw options.checkpointError;
      calls.push("checkpoint:save");
      const value = await save();
      calls.push("checkpoint:end");
      return Object.freeze({ discarded: false, value });
    },
    acknowledgeBasicDirtAction(generation, acknowledgedDelivery) {
      assert.equal(generation, GENERATION);
      assert.equal(acknowledgedDelivery, actionDelivery);
      calls.push("pump:ack");
      acknowledgements.push(Object.freeze({ generation, delivery: acknowledgedDelivery }));
    },
  });
  const authority = Object.freeze({
    async runExclusiveMutation<T>(operation: () => Promise<T>) {
      calls.push("authority:enter");
      try {
        return await operation();
      } finally {
        calls.push("authority:exit");
      }
    },
  });
  const host: HarnessHost = Object.freeze({ multiplayerAuthority: () => authority });

  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const privateEngine = engine as unknown as {
    rustBasicDirtActionProjection: Readonly<{
      schema: 1;
      cursor: number;
      lastReceiptHash: string | null;
    }>;
    rustTerrainLocatorCommitLocked: boolean;
  };
  Object.assign(engine, {
    rustTerrainLocatorCommitLocked: false,
    rustNativeSaveSuppressedForMultiplayerRuntime: options.suppressNativeSave ?? false,
    rustBasicDirtActionProjection: Object.freeze({ schema: 1, cursor: 0, lastReceiptHash: null }),
    rustLivePlayerAttestationR10: Object.freeze({ inventoryContainer: CONTAINER }),
    rustLivePlayerPresentationViewR10: Object.freeze({
      selectedSlot: receipt.inventory.slot,
      inventoryContainerRevision: receipt.inventory.beforeRevision,
      held: liveHeld(receipt.inventory.beforeStack),
    }) as RustLivePlayerViewR10,
    rustLiveSelectedSlotIntentPendingR5: false,
    rustLiveSelectedSlotIntentR5: receipt.inventory.slot,
    disposed: false,
    multiplayer: options.multiplayerAuthorityMode
      ? Object.freeze({ authorityMode: options.multiplayerAuthorityMode })
      : null,
    selected: receipt.inventory.slot,
    mode: "survival",
    inventory,
    persistent: true,
    activeWorldId: "world-live-dirt",
    rustNativePersistenceWorldId: "world-live-dirt",
    worldSessionStartedAt: Date.now(),
    miningProgress: 0.5,
    target: Object.freeze({ x: 4, y: 43, z: -3 }),
    heldUse: 0,
    placeCooldown: 0,
    assertRustLivePlayerViewContextR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      purpose: string,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      calls.push(`context:${purpose}`);
    },
    stageRustLivePlayerExtractionR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      checkedExtraction: RustIntegratedRuntimeExtractionV1,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.equal(checkedExtraction, extraction);
      calls.push("stage:player");
      return stagedPlayer;
    },
    stageRustLiveCameraExtractionR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      checkedExtraction: RustIntegratedRuntimeExtractionV1,
      checkedView: RustIntegratedRuntimeExtractionViewV1,
      checkedCamera: RustLiveCameraViewR10,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.equal(checkedExtraction, extraction);
      assert.equal(checkedView, requestedView);
      assert.equal(checkedCamera, pumpCamera);
      calls.push("stage:camera");
      return stagedCamera;
    },
    stageRustDroppedHotTransformsR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      checkedExtraction: RustIntegratedRuntimeExtractionV1,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.equal(checkedExtraction, extraction);
      calls.push("stage:drops");
      return stagedDrops;
    },
    rustTerrainLocatorStackMatches: (
      view: RustLivePlayerViewR10["held"],
      expected: RustIntegratedPlayerInventoryStackV1 | null,
    ) => {
      calls.push(beforePlayerChecks++ === 0 ? "validate:player-before" : "validate:player-after");
      return prototypeStackMatches.call(engine, view, expected);
    },
    world: {
      getBlock(x: number, y: number, z: number) {
        assert.deepEqual({ x, y, z }, receipt.position);
        calls.push("world:preflight");
        return cell;
      },
      serializeEdits: () => ({}),
      applyValidatedRustCellProjectionV1(input: Readonly<{
        x: number;
        y: number;
        z: number;
        expectedBlockId: BlockId;
        replacementBlockId: BlockId;
        immediate: boolean;
        allowAlreadyApplied: boolean;
      }>) {
        assert.deepEqual(input, {
          ...receipt.position,
          expectedBlockId: receipt.priorBlockId,
          replacementBlockId: receipt.replacementBlockId,
          immediate: true,
          allowAlreadyApplied: true,
        });
        assert.equal(cell, receipt.priorBlockId);
        counters.worldProjections += 1;
        calls.push("world:project");
        cell = receipt.replacementBlockId as BlockId;
        return Object.freeze({
          ...receipt.position,
          expectedBlockId: receipt.priorBlockId,
          replacementBlockId: receipt.replacementBlockId,
          immediate: true,
          status: "applied" as const,
        });
      },
    },
    spawnDrop: (
      item: number,
      count: number,
      position: THREE.Vector3,
      _minimumCount?: number,
      _maximumCount?: number,
      dropOptions?: DropSpawnOptions,
    ) => {
      const drop = receipt.generatedDrops[0];
      assert.ok(drop);
      const transform = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(drop.provenance);
      assert.equal(item, drop.stack.itemCode);
      assert.equal(count, drop.stack.count);
      assert.deepEqual(position.toArray(), [
        Number(transform.position.xMilli) / 1_000,
        Number(transform.position.yMilli) / 1_000,
        Number(transform.position.zMilli) / 1_000,
      ]);
      assert.deepEqual(dropOptions, {
        allowMerge: false,
        exactPosition: true,
        rustEntityId: drop.entityId.toString(10),
        rotationY: transform.rotation.yaw / 1_000_000 * Math.PI * 2,
        velocity: {
          x: Number(transform.velocityMilliPerSecond.xMilli) / 1_000,
          y: Number(transform.velocityMilliPerSecond.yMilli) / 1_000,
          z: Number(transform.velocityMilliPerSecond.zMilli) / 1_000,
        },
        pickupDelay: 0.35,
        exactIdempotentRecovery: true,
      });
      counters.drops += 1;
      calls.push("drop:project");
      return Object.freeze({ rustEntityId: drop.entityId.toString(10) });
    },
    commitStagedRustLiveAuthorityViewsR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      checkedPlayer: RustLivePlayerViewR10,
      checkedCamera: RustLiveCameraViewR10,
      checkedDrops: unknown,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.equal(checkedPlayer, stagedPlayer);
      assert.equal(checkedCamera, stagedCamera);
      assert.equal(checkedDrops, stagedDrops);
      calls.push("player-camera:commit");
    },
    serialize: () => Object.freeze({
      rustBasicDirtActionProjection: privateEngine.rustBasicDirtActionProjection,
    }),
    worldStorage: {
      async saveNativeWorld(worldId: string) {
        assert.equal(worldId, "world-live-dirt");
        counters.nativeSaves += 1;
        calls.push("native:save");
        return Object.freeze({ ok: true as const, value: Object.freeze({ worldId }) });
      },
      saveWorldLocalOnly(worldId: string, document: SavedDocument) {
        assert.equal(worldId, "world-live-dirt");
        counters.localSaves += 1;
        calls.push("local:save");
        savedDocuments.push(document);
        return options.localSaveError
          ? Object.freeze({ ok: false as const, error: options.localSaveError })
          : Object.freeze({ ok: true as const, value: Object.freeze({ worldId }) });
      },
    },
    audio: { play: () => undefined },
    spawnParticles: () => undefined,
    emitHud: () => undefined,
  });

  const input: CommitInput = Object.freeze({
    generation: GENERATION,
    host,
    pump,
    delivery: actionDelivery,
    extraction,
    requestedView,
    camera: pumpCamera,
  });
  const commit = () => (engine as unknown as CommitAccess)
    .commitRustBasicDirtActionProjectionV1(input);

  return {
    engine,
    receipt,
    delivery: actionDelivery,
    calls,
    counters,
    inventory,
    savedDocuments,
    acknowledgements,
    checkpointStarted: checkpointStarted.promise,
    currentCell: () => cell,
    commitLocked: () => privateEngine.rustTerrainLocatorCommitLocked,
    commit,
  };
}

for (const action of ["mine", "place"] as const) {
  test(`native ${action} projection commits in custody order and acknowledges last`, async () => {
    const checkpointGate = deferred();
    const harness = createHarness({ action, checkpointGate: checkpointGate.promise });
    const pending = harness.commit();
    await harness.checkpointStarted;

    assert.deepEqual(harness.calls, [
      "context:basic Dirt projection preflight",
      "stage:player",
      "stage:camera",
      "stage:drops",
      "validate:player-before",
      "validate:player-after",
      "world:preflight",
      "authority:enter",
      "context:basic Dirt native checkpoint",
      "checkpoint:start",
    ]);
    assert.equal(harness.counters.worldProjections, 0, "the browser cell must wait for the checkpoint");
    assert.equal(harness.counters.inventorySuccessors, 0, "the selected slot must wait for the checkpoint");
    assert.equal(harness.counters.drops, 0, "drop presentation must wait for the checkpoint");
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);

    checkpointGate.resolve();
    await pending;

    const postInventoryAndDrop = action === "mine"
      ? ["inventory:successor", "drop:project"]
      : ["inventory:successor"];
    assert.deepEqual(harness.calls, [
      "context:basic Dirt projection preflight",
      "stage:player",
      "stage:camera",
      "stage:drops",
      "validate:player-before",
      "validate:player-after",
      "world:preflight",
      "authority:enter",
      "context:basic Dirt native checkpoint",
      "checkpoint:start",
      "checkpoint:save",
      "native:save",
      "checkpoint:end",
      "context:basic Dirt compatibility commit",
      "world:project",
      ...postInventoryAndDrop,
      "player-camera:commit",
      "local:save",
      "pump:ack",
      "authority:exit",
    ]);
    assert.equal(harness.counters.worldProjections, 1);
    assert.equal(harness.counters.inventorySuccessors, 1);
    assert.equal(harness.counters.drops, action === "mine" ? 1 : 0);
    assert.equal(harness.currentCell(), harness.receipt.replacementBlockId);
    assert.deepEqual(harness.inventory[0], compatibilitySlot(harness.receipt.inventory.afterStack));
    assert.deepEqual(harness.savedDocuments[0]?.save.rustBasicDirtActionProjection, {
      schema: 1,
      cursor: harness.receipt.sequence,
      lastReceiptHash: harness.receipt.receiptHash,
    });
    assert.equal(harness.acknowledgements.length, 1);
    assert.equal(harness.acknowledgements[0]?.delivery, harness.delivery);
    assert.equal(harness.calls.at(-2), "pump:ack", "ack must be the final custody action before authority release");
    assert.equal(harness.commitLocked(), false);
  });
}

test("native checkpoint failure leaves browser custody and acknowledgement untouched", async () => {
  const harness = createHarness({ checkpointError: new Error("checkpoint failed") });
  await assert.rejects(harness.commit(), /checkpoint failed/u);

  assert.equal(harness.counters.nativeSaves, 0);
  assert.equal(harness.counters.worldProjections, 0);
  assert.equal(harness.counters.inventorySuccessors, 0);
  assert.equal(harness.counters.drops, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.deepEqual(harness.inventory[0], null);
  assert.equal(harness.currentCell(), BlockId.Dirt);
  assert.equal(harness.commitLocked(), false);
});

test("world preflight mismatch rejects before exclusive authority or native checkpoint", async () => {
  const harness = createHarness({ currentBlock: BlockId.Stone });
  await assert.rejects(harness.commit(), /contradicts the compatibility world cell/u);

  assert.equal(harness.calls.includes("world:preflight"), true);
  assert.equal(harness.calls.includes("authority:enter"), false);
  assert.equal(harness.calls.includes("checkpoint:start"), false);
  assert.equal(harness.counters.worldProjections, 0);
  assert.equal(harness.counters.inventorySuccessors, 0);
  assert.equal(harness.counters.drops, 0);
  assert.equal(harness.counters.nativeSaves, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
});

test("failed local browser save never acknowledges the native delivery", async () => {
  const harness = createHarness({ localSaveError: new Error("disk full") });
  await assert.rejects(harness.commit(), /could not be stored.*disk full/u);

  assert.equal(harness.counters.nativeSaves, 1);
  assert.equal(harness.counters.worldProjections, 1);
  assert.equal(harness.counters.inventorySuccessors, 1);
  assert.equal(harness.counters.drops, 1);
  assert.equal(harness.counters.localSaves, 1);
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.calls.includes("pump:ack"), false);
  assert.equal(harness.commitLocked(), false);
});

for (const suppression of [
  { suppressNativeSave: true },
  { multiplayerAuthorityMode: "rust-authoritative" as const },
]) {
  test(`multiplayer suppression rejects before mutation (${Object.keys(suppression)[0]})`, async () => {
    const harness = createHarness(suppression);
    await assert.rejects(harness.commit(), /disabled after multiplayer authority/u);

    assert.deepEqual(harness.calls, []);
    assert.equal(harness.counters.worldProjections, 0);
    assert.equal(harness.counters.inventorySuccessors, 0);
    assert.equal(harness.counters.drops, 0);
    assert.equal(harness.counters.nativeSaves, 0);
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);
    assert.deepEqual(harness.inventory[0], null);
    assert.equal(harness.currentCell(), BlockId.Dirt);
    assert.equal(harness.commitLocked(), false);
  });
}
