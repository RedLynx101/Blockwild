import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BlockId, type InventorySlot } from "../app/game/data.ts";
import { VoxelEngine } from "../app/game/engine.ts";
import type {
  RustDroppedHotTransformFrameR10,
  RustDroppedHotTransformR10,
} from "../app/game/rust-authoritative-extraction-r10.ts";
import type {
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
  RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustIntegratedPlayerInventoryStackV1 } from "../app/game/rust-integrated-runtime-player-inventory.ts";
import { rustIntegratedContainerViewKeyV1 } from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import {
  rustIntegratedRuntimeNativePlayerDropOriginHashV1,
  rustIntegratedRuntimeNativePlayerDropReceiptHashV1,
  type RustIntegratedRuntimeNativePlayerDropProjectionV1,
} from "../app/game/rust-integrated-runtime-player-drop.ts";
import type { RustLiveCameraViewR10 } from "../app/game/rust-live-camera-view-r10.ts";
import type { RustLiveInputPumpPlayerDropDeliveryV1 } from "../app/game/rust-live-input-pump-r5.ts";
import type { RustLivePlayerViewR10 } from "../app/game/rust-live-player-view-r10.ts";

const GENERATION = 29;
const PLAYER_ID = BigInt(301);
const PLAYER_ENTITY_ID = BigInt(302);
const DROP_ENTITY_ID = BigInt(303);
const CONTAINER = Object.freeze({
  kind: "player" as const,
  id: "actor:noah",
  ownerId: "actor:noah",
});
const DROP_CONTAINER = Object.freeze({
  kind: "container" as const,
  id: "drop-custody:player-drop-1",
  ownerId: null,
});
const OTHER_DROP_CONTAINER = Object.freeze({
  kind: "container" as const,
  id: "drop-custody:other",
  ownerId: null,
});

const hash = (digit: string) => digit.repeat(32);

function dirtStack(count: number): RustIntegratedPlayerInventoryStackV1 {
  return Object.freeze({
    itemCode: BlockId.Dirt,
    count,
    durabilityMillionths: null,
    metadataHash: hash("0"),
  });
}

function gameplayRevision(sequence: number, inventory: number) {
  return Object.freeze({
    epoch: 1,
    sequence: BigInt(sequence),
    inventory: BigInt(inventory),
    machines: BigInt(32),
    combat: BigInt(33),
    progression: BigInt(34),
    cardforge: BigInt(35),
  });
}

function worldViewRevision(sequence: number, droppedItems: number) {
  return Object.freeze({
    epoch: 1,
    sequence: BigInt(sequence),
    clock: BigInt(41),
    machineAnchors: BigInt(42),
    droppedItems: BigInt(droppedItems),
    playerBindings: BigInt(44),
    environment: BigInt(45),
    atmosphereGravity: BigInt(46),
    celestial: BigInt(47),
  });
}

function playerDropReceipt(): RustIntegratedRuntimeNativePlayerDropProjectionV1 {
  const source = {
    schema: 1 as const,
    sequence: 1,
    originInputSequence: 7,
    completionTick: 20,
    world: Object.freeze({
      universeId: "universe-player-drop",
      locationId: "surface",
      revision: Object.freeze({ epoch: 1, mutation: 9, residency: 3 }),
      canonicalStateHash: hash("1"),
    }),
    player: Object.freeze({ playerId: PLAYER_ID, entityId: PLAYER_ENTITY_ID }),
    inventory: Object.freeze({
      container: CONTAINER,
      selectedSlot: 0,
      beforeRevision: BigInt(10),
      afterRevision: BigInt(11),
      beforeStack: dirtStack(3),
      afterStack: dirtStack(2),
    }),
    drop: Object.freeze({
      dropId: "drop:7:1",
      entityId: DROP_ENTITY_ID,
      stack: dirtStack(1),
      custodyContainer: DROP_CONTAINER,
      custodySlot: 0,
      custodyRevision: BigInt(0),
      spatialRevision: BigInt(0),
      position: Object.freeze({ xMilli: BigInt(1_250), yMilli: BigInt(36_500), zMilli: BigInt(-2_750) }),
      velocityMilliPerSecond: Object.freeze({ xMilli: BigInt(500), yMilli: BigInt(1_250), zMilli: BigInt(-3_000) }),
      rotation: Object.freeze({ yaw: 250_000, pitch: 0, roll: 0 }),
      createdTick: BigInt(19),
      expiresTick: null,
      pickupLockActorId: null,
      pickupUnlockTick: BigInt(26),
      originHash: hash("2"),
    }),
    authority: Object.freeze({
      gameplay: Object.freeze({
        before: Object.freeze({ revision: gameplayRevision(30, 31), canonicalStateHash: hash("3") }),
        after: Object.freeze({ revision: gameplayRevision(31, 32), canonicalStateHash: hash("4") }),
      }),
      entity: Object.freeze({
        before: Object.freeze({ revision: BigInt(50), canonicalStateHash: hash("5") }),
        after: Object.freeze({ revision: BigInt(51), canonicalStateHash: hash("6") }),
      }),
      worldView: Object.freeze({
        before: Object.freeze({ revision: worldViewRevision(40, 43), canonicalStateHash: hash("7") }),
        after: Object.freeze({ revision: worldViewRevision(41, 44), canonicalStateHash: hash("8") }),
      }),
    }),
    content: Object.freeze({
      configuredManifestHash: hash("9"),
      installedManifestHash: hash("9"),
      installedRegistryHash: hash("a"),
      itemContentHash: hash("b"),
      itemContentVersion: 7,
    }),
    receiptHash: hash("c"),
  } satisfies RustIntegratedRuntimeNativePlayerDropProjectionV1;
  const originBound = Object.freeze({
    ...source,
    drop: Object.freeze({
      ...source.drop,
      originHash: rustIntegratedRuntimeNativePlayerDropOriginHashV1(source),
    }),
  });
  return Object.freeze({
    ...originBound,
    receiptHash: rustIntegratedRuntimeNativePlayerDropReceiptHashV1(originBound),
  });
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

function withHotTransformPatch(
  current: RustDroppedHotTransformR10,
  patch: Partial<RustDroppedHotTransformR10>,
) {
  return Object.freeze({ ...current, ...patch }) as RustDroppedHotTransformR10;
}

type HarnessHost = Readonly<{
  config: Readonly<{ universeId: string; locationId: string }>;
  nativePersistenceSession(): Readonly<{
    worldId: string;
    diagnostics(): Readonly<{
      worldId: string;
      state: "open";
      saves: number;
      recoveries: number;
      legacyMigrations: number;
      legacyMigrationRetries: number;
      parentFallbacks: number;
      platformOperations: number;
      requestBytes: number;
      responseBytes: number;
      lastCheckpointId: string;
      lastError: null;
    }>;
  }>;
  multiplayerAuthority(): Readonly<{
    runExclusiveMutation<T>(operation: () => Promise<T>): Promise<T>;
  }>;
}>;

type HarnessPump = Readonly<{
  checkpointNativePersistence(
    generation: number,
    save: () => Promise<unknown>,
  ): Promise<Readonly<{
    discarded: boolean;
    value: unknown;
    before: RustIntegratedRuntimeIdentityV1;
    after: RustIntegratedRuntimeIdentityV1;
  }>>;
  acknowledgePlayerDrop(
    generation: number,
    delivery: RustLiveInputPumpPlayerDropDeliveryV1,
  ): boolean;
}>;

type CommitInput = Readonly<{
  generation: number;
  host: HarnessHost;
  pump: HarnessPump;
  delivery: RustLiveInputPumpPlayerDropDeliveryV1;
  extraction: RustIntegratedRuntimeExtractionV1;
  requestedView: RustIntegratedRuntimeExtractionViewV1;
  camera: RustLiveCameraViewR10;
}>;

type CommitAccess = Readonly<{
  commitRustNativePlayerDropProjectionV1(input: CommitInput): Promise<void>;
}>;

type HarnessOptions = Readonly<{
  checkpointGate?: Promise<void>;
  checkpointError?: Error;
  hotTransform?: (current: RustDroppedHotTransformR10) => RustDroppedHotTransformR10;
  localSaveError?: Error;
  multiplayerAuthorityMode?: "rust-authoritative";
  selectedSlot?: number;
  suppressNativeSave?: boolean;
  nativeSaveDelta?: number;
}>;

type ProjectionCursor = Readonly<{
  schema: 1;
  cursor: number;
  lastReceiptHash: string | null;
}>;

type SavedDocument = Readonly<{
  save: Readonly<{ rustNativePlayerDropProjection: ProjectionCursor }>;
  playTimeDeltaMs: number;
}>;

const prototypeStackMatches = (VoxelEngine.prototype as unknown as Readonly<{
  rustTerrainLocatorStackMatches(
    view: RustLivePlayerViewR10["held"],
    expected: RustIntegratedPlayerInventoryStackV1 | null,
  ): boolean;
}>).rustTerrainLocatorStackMatches;

function createHarness(options: HarnessOptions = {}) {
  const receipt = playerDropReceipt();
  const queryIdentity = Object.freeze({
    universeId: receipt.world.universeId,
    locationId: receipt.world.locationId,
    revision: Object.freeze({
      epoch: 1,
      world: 2,
      entities: 3,
      gameplay: 4,
      persistence: 5,
      network: 6,
      simulation: 7,
    }),
    tick: receipt.completionTick + 3,
    stateHash: hash("f"),
  }) satisfies RustIntegratedRuntimeIdentityV1;
  const checkpointIdentity = Object.freeze({
    ...queryIdentity,
    revision: Object.freeze({
      ...queryIdentity.revision,
      persistence: queryIdentity.revision.persistence + 1,
    }),
    stateHash: hash("a"),
  }) satisfies RustIntegratedRuntimeIdentityV1;
  const nativeWorldId = "world:world-live-player-drop@surface";
  let nativeSaveCount = 10;
  let nativePlatformOperations = 20;
  let nativeLastCheckpointId = "checkpoint-10";
  const nativeDiagnostics = () => Object.freeze({
    worldId: nativeWorldId,
    state: "open" as const,
    saves: nativeSaveCount,
    recoveries: 0,
    legacyMigrations: 0,
    legacyMigrationRetries: 0,
    parentFallbacks: 0,
    platformOperations: nativePlatformOperations,
    requestBytes: nativeSaveCount * 100,
    responseBytes: nativeSaveCount * 10,
    lastCheckpointId: nativeLastCheckpointId,
    lastError: null,
  });
  const delivery = Object.freeze({
    worldGeneration: GENERATION,
    queryIdentity,
    cursorBefore: 0,
    cursorAfter: receipt.sequence,
    requestPayloadHash: hash("d"),
    projectionPayloadHash: hash("e"),
    receipt,
  }) satisfies RustLiveInputPumpPlayerDropDeliveryV1;
  const calls: string[] = [];
  const checkpointStarted = deferred();
  const acknowledgements: RustLiveInputPumpPlayerDropDeliveryV1[] = [];
  const savedDocuments: SavedDocument[] = [];
  const counters = {
    inventoryMutations: 0,
    dropSpawns: 0,
    nativeSaves: 0,
    localSaves: 0,
    authorityViewCommits: 0,
  };

  const rawInventory = Array.from<InventorySlot | null>({ length: 9 }).fill(null);
  rawInventory[0] = { item: BlockId.Dirt, count: 3 };
  const inventory = new Proxy(rawInventory, {
    set(target, property, value, receiver) {
      if (property === "0") {
        counters.inventoryMutations += 1;
        calls.push("inventory:project");
      }
      return Reflect.set(target, property, value, receiver);
    },
  });

  const containerViewKey = rustIntegratedContainerViewKeyV1(CONTAINER);
  const priorPlayer = Object.freeze({
    selectedSlot: 0,
    inventoryContainer: containerViewKey,
    inventoryContainerRevision: receipt.inventory.beforeRevision,
    held: liveHeld(receipt.inventory.beforeStack),
  }) as RustLivePlayerViewR10;
  const stagedPlayer = Object.freeze({
    selectedSlot: 0,
    inventoryContainer: containerViewKey,
    inventoryContainerRevision: receipt.inventory.afterRevision,
    authorityTick: BigInt(receipt.completionTick + 3),
    held: liveHeld(receipt.inventory.afterStack),
  }) as RustLivePlayerViewR10;
  const stagedCamera = Object.freeze({ staged: true }) as unknown as RustLiveCameraViewR10;
  const currentHotTransform = Object.freeze({
    schema: 1 as const,
    dropId: receipt.drop.dropId,
    entityId: receipt.drop.entityId,
    entityRevision: BigInt(5),
    rowRevision: BigInt(4),
    custodyContainer: rustIntegratedContainerViewKeyV1(receipt.drop.custodyContainer),
    custodySlot: receipt.drop.custodySlot,
    boundContainerRevision: receipt.drop.custodyRevision,
    itemCode: receipt.drop.stack.itemCode,
    count: receipt.drop.stack.count,
    durabilityMillionths: receipt.drop.stack.durabilityMillionths,
    metadataHash: Uint8Array.from(Buffer.from(receipt.drop.stack.metadataHash, "hex")),
    position: Object.freeze({ x: 1.31, y: 36.54, z: -2.91 }),
    velocity: Object.freeze({ x: 0.46, y: 0.93, z: -2.82 }),
    rotationMicroturns: Object.freeze({ yaw: 300_000, pitch: 0, roll: 0 }),
    yawRadians: 300_000 / 1_000_000 * Math.PI * 2,
    createdTick: receipt.drop.createdTick,
    ageTicks: BigInt(receipt.completionTick + 3) - receipt.drop.createdTick,
    expiresTick: receipt.drop.expiresTick,
    pickupLockActorId: receipt.drop.pickupLockActorId,
  }) satisfies RustDroppedHotTransformR10;
  const stagedHotTransform = options.hotTransform?.(currentHotTransform) ?? currentHotTransform;
  const stagedDrops = Object.freeze({
    schema: 1 as const,
    source: Object.freeze({
      identity: queryIdentity,
      extractionRevision: BigInt(12),
      authorityTick: BigInt(receipt.completionTick + 3),
      inventoryDomainRevision: receipt.inventory.afterRevision + BigInt(1),
      extractionHash: hash("1"),
    }),
    transforms: Object.freeze([stagedHotTransform]),
  }) satisfies RustDroppedHotTransformFrameR10;
  const extraction = Object.freeze({ extraction: true }) as unknown as RustIntegratedRuntimeExtractionV1;
  const requestedView = Object.freeze({
    viewportWidth: 1280,
    viewportHeight: 720,
    viewRevision: 7,
  });
  const pumpCamera = Object.freeze({ pump: true }) as unknown as RustLiveCameraViewR10;

  const pump: HarnessPump = Object.freeze({
    async checkpointNativePersistence(generation, save) {
      assert.equal(generation, GENERATION);
      calls.push("checkpoint:start");
      checkpointStarted.resolve();
      if (options.checkpointGate) await options.checkpointGate;
      if (options.checkpointError) throw options.checkpointError;
      calls.push("checkpoint:save");
      const value = await save();
      calls.push("checkpoint:end");
      return Object.freeze({
        discarded: false,
        value,
        before: queryIdentity,
        after: checkpointIdentity,
      });
    },
    acknowledgePlayerDrop(generation, acknowledgedDelivery) {
      assert.equal(generation, GENERATION);
      assert.equal(acknowledgedDelivery, delivery);
      calls.push("pump:ack");
      acknowledgements.push(acknowledgedDelivery);
      return true;
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
  const host: HarnessHost = Object.freeze({
    config: Object.freeze({ universeId: receipt.world.universeId, locationId: receipt.world.locationId }),
    nativePersistenceSession: () => Object.freeze({
      worldId: nativeWorldId,
      diagnostics: nativeDiagnostics,
    }),
    multiplayerAuthority: () => authority,
  });

  let stackMatchCalls = 0;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const privateEngine = engine as unknown as {
    rustNativePlayerDropProjection: ProjectionCursor;
    rustNativePlayerDropCheckpoint: unknown;
    rustTerrainLocatorCommitLocked: boolean;
  };
  Object.assign(engine, {
    rustTerrainLocatorCommitLocked: false,
    rustNativeSaveSuppressedForMultiplayerRuntime: options.suppressNativeSave ?? false,
    rustNativePlayerDropProjection: Object.freeze({ schema: 1, cursor: 0, lastReceiptHash: null }),
    rustLivePlayerAttestationR10: Object.freeze({
      playerId: PLAYER_ID,
      entityId: PLAYER_ENTITY_ID,
      inventoryContainer: CONTAINER,
    }),
    rustLivePlayerPresentationViewR10: priorPlayer,
    disposed: false,
    multiplayer: options.multiplayerAuthorityMode
      ? Object.freeze({ authorityMode: options.multiplayerAuthorityMode })
      : null,
    selected: options.selectedSlot ?? 0,
    mode: "survival",
    inventory,
    drops: [],
    persistent: true,
    activeWorldId: "world-live-player-drop",
    rustNativePersistenceWorldId: "world-live-player-drop",
    worldSessionStartedAt: Date.now(),
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
      calls.push(stackMatchCalls++ === 0 ? "validate:player-before" : "validate:player-after");
      return prototypeStackMatches.call(engine, view, expected);
    },
    spawnDrop: (
      item: number,
      count: number,
      position: THREE.Vector3,
      durability?: number,
      metadata?: Record<string, unknown>,
      dropOptions?: Readonly<{
        allowMerge?: boolean;
        exactPosition?: boolean;
        rustEntityId?: string;
        rotationY?: number;
        velocity?: Readonly<{ x: number; y: number; z: number }>;
        pickupDelay?: number;
        exactIdempotentRecovery?: boolean;
      }>,
    ) => {
      assert.equal(item, BlockId.Dirt);
      assert.equal(count, 1);
      assert.equal(durability, undefined);
      assert.equal(metadata, undefined);
      assert.deepEqual(position.toArray(), [1.25, 36.5, -2.75]);
      assert.deepEqual(dropOptions, {
        allowMerge: false,
        exactPosition: true,
        rustEntityId: DROP_ENTITY_ID.toString(10),
        rotationY: Math.PI / 2,
        velocity: { x: 0.5, y: 1.25, z: -3 },
        pickupDelay: 0.35,
        exactIdempotentRecovery: true,
      });
      counters.dropSpawns += 1;
      calls.push("drop:project");
      return Object.freeze({ rustEntityId: DROP_ENTITY_ID.toString(10) });
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
      counters.authorityViewCommits += 1;
      calls.push("player-camera-drops:commit");
    },
    serialize: () => Object.freeze({
      rustNativePlayerDropProjection: privateEngine.rustNativePlayerDropProjection,
    }),
    worldStorage: {
      async saveNativeWorld(worldId: string) {
        assert.equal(worldId, "world-live-player-drop");
        counters.nativeSaves += 1;
        calls.push("native:save");
        const nativeSaveDelta = options.nativeSaveDelta ?? 1;
        nativeSaveCount += nativeSaveDelta;
        nativePlatformOperations += nativeSaveDelta;
        nativeLastCheckpointId = `checkpoint-${nativeSaveCount}`;
        return Object.freeze({
          ok: true as const,
          value: Object.freeze({
            worldId: nativeWorldId,
            saveId: `native.save.${nativeSaveCount}`,
            checkpointId: nativeLastCheckpointId,
            checkpointHash: hash("b"),
            journalSequence: nativeSaveCount,
            records: 7,
            commits: nativeSaveDelta,
            requestBytes: 100,
            responseBytes: 10,
          }),
        });
      },
      saveWorldLocalOnly(worldId: string, document: SavedDocument) {
        assert.equal(worldId, "world-live-player-drop");
        counters.localSaves += 1;
        calls.push("local:save");
        savedDocuments.push(document);
        return options.localSaveError
          ? Object.freeze({ ok: false as const, error: options.localSaveError })
          : Object.freeze({ ok: true as const, value: Object.freeze({ worldId }) });
      },
    },
    audio: { play: () => undefined },
    emitHud: () => undefined,
  });

  const input: CommitInput = Object.freeze({
    generation: GENERATION,
    host,
    pump,
    delivery,
    extraction,
    requestedView,
    camera: pumpCamera,
  });
  const commit = () => (engine as unknown as CommitAccess)
    .commitRustNativePlayerDropProjectionV1(input);

  return {
    calls,
    counters,
    inventory,
    savedDocuments,
    acknowledgements,
    receipt,
    delivery,
    stagedDrops,
    checkpointStarted: checkpointStarted.promise,
    checkpointWitness: () => privateEngine.rustNativePlayerDropCheckpoint,
    commitLocked: () => privateEngine.rustTerrainLocatorCommitLocked,
    commit,
  };
}

test("native player drop accepts a later hot-transform descendant while spawning from its creation receipt", async () => {
  const checkpointGate = deferred();
  const harness = createHarness({ checkpointGate: checkpointGate.promise });
  const currentHot = harness.stagedDrops.transforms[0];
  assert.equal(harness.stagedDrops.source.authorityTick, BigInt(harness.receipt.completionTick + 3));
  assert.equal(harness.stagedDrops.source.extractionRevision, BigInt(12));
  assert.equal(currentHot.entityRevision, BigInt(5));
  assert.equal(currentHot.rowRevision, BigInt(4));
  assert.equal(currentHot.ageTicks, BigInt(4));
  assert.deepEqual(currentHot.position, { x: 1.31, y: 36.54, z: -2.91 });
  assert.deepEqual(currentHot.velocity, { x: 0.46, y: 0.93, z: -2.82 });
  assert.equal(currentHot.rotationMicroturns.yaw, 300_000);
  assert.equal(currentHot.yawRadians, 300_000 / 1_000_000 * Math.PI * 2);
  const pending = harness.commit();
  await harness.checkpointStarted;

  assert.deepEqual(harness.calls, [
    "context:native player-drop projection preflight",
    "stage:player",
    "stage:camera",
    "stage:drops",
    "validate:player-before",
    "validate:player-after",
    "authority:enter",
    "context:native player-drop checkpoint",
    "checkpoint:start",
  ]);
  assert.equal(harness.counters.inventoryMutations, 0, "the browser stack must wait for the native checkpoint");
  assert.equal(harness.counters.dropSpawns, 0, "the browser drop must wait for the native checkpoint");
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);

  checkpointGate.resolve();
  await pending;

  assert.deepEqual(harness.calls, [
    "context:native player-drop projection preflight",
    "stage:player",
    "stage:camera",
    "stage:drops",
    "validate:player-before",
    "validate:player-after",
    "authority:enter",
    "context:native player-drop checkpoint",
    "checkpoint:start",
    "checkpoint:save",
    "native:save",
    "checkpoint:end",
    "context:native player-drop compatibility commit",
    "inventory:project",
    "drop:project",
    "player-camera-drops:commit",
    "local:save",
    "pump:ack",
    "authority:exit",
  ]);
  assert.deepEqual(harness.inventory[0], { item: BlockId.Dirt, count: 2 });
  assert.equal(harness.counters.inventoryMutations, 1);
  assert.equal(harness.counters.dropSpawns, 1);
  assert.equal(harness.counters.authorityViewCommits, 1);
  assert.deepEqual(harness.savedDocuments[0]?.save.rustNativePlayerDropProjection, {
    schema: 1,
    cursor: harness.receipt.sequence,
    lastReceiptHash: harness.receipt.receiptHash,
  });
  const witness = harness.checkpointWitness() as Readonly<{
    cursorBefore: number;
    cursorAfter: number;
    receiptHash: string;
    queryIdentityHash: string;
    persistenceBefore: Readonly<{ saves: number; lastCheckpointId: string }>;
    persistenceAfter: Readonly<{ saves: number; lastCheckpointId: string }>;
    checkpoint: Readonly<{ checkpointId: string }>;
  }>;
  assert.equal(witness.cursorBefore, 0);
  assert.equal(witness.cursorAfter, 1);
  assert.equal(witness.receiptHash, harness.receipt.receiptHash);
  assert.equal(witness.queryIdentityHash, harness.delivery.queryIdentity.stateHash);
  assert.equal(witness.persistenceBefore.saves, 10);
  assert.equal(witness.persistenceAfter.saves, 11);
  assert.equal(witness.checkpoint.checkpointId, witness.persistenceAfter.lastCheckpointId);
  assert.equal(harness.acknowledgements[0], harness.delivery);
  assert.equal(harness.calls.at(-2), "pump:ack", "ack must be the final custody action before authority release");
  assert.equal(harness.commitLocked(), false);
});

test("player-drop checkpoint witness rejects a duplicate native save before browser mutation", async () => {
  const harness = createHarness({ nativeSaveDelta: 2 });
  await assert.rejects(harness.commit(), /one exact causally witnessed checkpoint/u);

  assert.deepEqual(harness.inventory[0], { item: BlockId.Dirt, count: 3 });
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.dropSpawns, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.checkpointWitness(), undefined);
  assert.equal(harness.commitLocked(), false);
});

test("native checkpoint failure leaves the player stack, drop, cursor, and acknowledgement untouched", async () => {
  const harness = createHarness({ checkpointError: new Error("checkpoint failed") });
  await assert.rejects(harness.commit(), /checkpoint failed/u);

  assert.deepEqual(harness.inventory[0], { item: BlockId.Dirt, count: 3 });
  assert.equal(harness.counters.nativeSaves, 0);
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.dropSpawns, 0);
  assert.equal(harness.counters.authorityViewCommits, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.commitLocked(), false);
});

test("selected-slot preflight drift rejects before exclusive authority or native checkpoint", async () => {
  const harness = createHarness({ selectedSlot: 1 });
  await assert.rejects(harness.commit(), /selected compatibility hotbar slot/u);

  assert.equal(harness.calls.includes("authority:enter"), false);
  assert.equal(harness.calls.includes("checkpoint:start"), false);
  assert.deepEqual(harness.inventory[0], { item: BlockId.Dirt, count: 3 });
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.dropSpawns, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
});

const immutableHotTransformMismatchCases = Object.freeze([
  Object.freeze({
    label: "native entity identity",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      entityId: current.entityId + BigInt(1),
    }),
  }),
  Object.freeze({
    label: "drop identity",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      dropId: `${current.dropId}:different`,
    }),
  }),
  Object.freeze({
    label: "stack item",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      itemCode: BlockId.Stone,
    }),
  }),
  Object.freeze({
    label: "stack count",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      count: current.count + 1,
    }),
  }),
  Object.freeze({
    label: "stack durability",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      durabilityMillionths: 1,
    }),
  }),
  Object.freeze({
    label: "stack metadata hash",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      metadataHash: Uint8Array.from(Buffer.from(hash("f"), "hex")),
    }),
  }),
  Object.freeze({
    label: "custody container",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      custodyContainer: rustIntegratedContainerViewKeyV1(OTHER_DROP_CONTAINER),
    }),
  }),
  Object.freeze({
    label: "custody slot",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      custodySlot: current.custodySlot + 1,
    }),
  }),
  Object.freeze({
    label: "custody revision",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      boundContainerRevision: current.boundContainerRevision + BigInt(1),
    }),
  }),
  Object.freeze({
    label: "creation tick",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      createdTick: current.createdTick + BigInt(1),
    }),
  }),
  Object.freeze({
    label: "expiry",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      expiresTick: BigInt(999),
    }),
  }),
  Object.freeze({
    label: "pickup lock",
    mutate: (current: RustDroppedHotTransformR10) => withHotTransformPatch(current, {
      pickupLockActorId: "actor:other",
    }),
  }),
]);

for (const mismatch of immutableHotTransformMismatchCases) {
  test(`native player drop rejects ${mismatch.label} drift before checkpoint or browser mutation`, async () => {
    const harness = createHarness({ hotTransform: mismatch.mutate });
    await assert.rejects(harness.commit(), /hot (?:identity|transform)/u);

    assert.equal(harness.calls.includes("authority:enter"), false);
    assert.equal(harness.calls.includes("checkpoint:start"), false);
    assert.deepEqual(harness.inventory[0], { item: BlockId.Dirt, count: 3 });
    assert.equal(harness.counters.inventoryMutations, 0);
    assert.equal(harness.counters.dropSpawns, 0);
    assert.equal(harness.counters.nativeSaves, 0);
    assert.equal(harness.counters.authorityViewCommits, 0);
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);
    assert.equal(harness.commitLocked(), false);
  });
}

test("failed local browser save retains the exact native player-drop delivery for replay", async () => {
  const harness = createHarness({ localSaveError: new Error("disk full") });
  await assert.rejects(harness.commit(), /could not be stored.*disk full/u);

  assert.equal(harness.counters.nativeSaves, 1);
  assert.equal(harness.counters.inventoryMutations, 1);
  assert.equal(harness.counters.dropSpawns, 1);
  assert.equal(harness.counters.authorityViewCommits, 1);
  assert.equal(harness.counters.localSaves, 1);
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.calls.includes("pump:ack"), false);
  assert.notEqual(harness.checkpointWitness(), null);
  assert.equal(harness.commitLocked(), false);
});

for (const suppression of [
  { suppressNativeSave: true },
  { multiplayerAuthorityMode: "rust-authoritative" as const },
]) {
  test(`multiplayer suppression rejects player-drop projection before mutation (${Object.keys(suppression)[0]})`, async () => {
    const harness = createHarness(suppression);
    await assert.rejects(harness.commit(), /restricted to single-runtime Survival authority/u);

    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.inventory[0], { item: BlockId.Dirt, count: 3 });
    assert.equal(harness.counters.inventoryMutations, 0);
    assert.equal(harness.counters.dropSpawns, 0);
    assert.equal(harness.counters.nativeSaves, 0);
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);
    assert.equal(harness.commitLocked(), false);
  });
}
