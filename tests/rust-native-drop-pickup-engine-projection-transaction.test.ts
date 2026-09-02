import assert from "node:assert/strict";
import test from "node:test";
import { BlockId, type InventorySlot } from "../app/game/data.ts";
import { VoxelEngine } from "../app/game/engine.ts";
import {
  rustIntegratedRuntimeDropPickupReceiptHashV1,
  type RustIntegratedRuntimeDropPickupProjectionV1,
} from "../app/game/rust-integrated-runtime-drop-pickup.ts";
import type {
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
  RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustIntegratedPlayerInventoryStackV1 } from "../app/game/rust-integrated-runtime-player-inventory.ts";
import { rustIntegratedContainerViewKeyV1 } from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import type { RustLiveCameraViewR10 } from "../app/game/rust-live-camera-view-r10.ts";
import type { RustLiveInputPumpDropPickupDeliveryV1 } from "../app/game/rust-live-input-pump-r5.ts";
import type {
  RustLivePlayerDeathDropR10,
  RustLivePlayerDeathRespawnR10,
  RustLivePlayerViewR10,
} from "../app/game/rust-live-player-view-r10.ts";

const GENERATION = 23;
const PLAYER_ID = BigInt(101);
const PLAYER_ENTITY_ID = BigInt(102);
const DROP_ENTITY_ID = BigInt(103);
const CONTAINER = Object.freeze({
  kind: "player" as const,
  id: "actor:noah",
  ownerId: "actor:noah",
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

function pickupReceipt(): RustIntegratedRuntimeDropPickupProjectionV1 {
  const beforeGameplay = Object.freeze({
    epoch: 1,
    sequence: BigInt(30),
    inventory: BigInt(31),
    machines: BigInt(32),
    combat: BigInt(33),
    progression: BigInt(34),
    cardforge: BigInt(35),
  });
  const beforeWorldView = Object.freeze({
    epoch: 1,
    sequence: BigInt(40),
    clock: BigInt(41),
    machineAnchors: BigInt(42),
    droppedItems: BigInt(43),
    playerBindings: BigInt(44),
    environment: BigInt(45),
    atmosphereGravity: BigInt(46),
    celestial: BigInt(47),
  });
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: hash("1"),
    installedRegistryHash: hash("2"),
    catalogBlobHash: hash("3"),
    actionReportHash: hash("4"),
    rngSemanticsHash: hash("5"),
    blockActionSequence: BigInt(8),
    originInputSequence: 7,
    blockId: BlockId.Dirt,
    position: Object.freeze({ x: 1, y: 35, z: -3 }),
    lootPlanHash: hash("6"),
    groupOrdinal: 0,
  });
  const base = Object.freeze({
    schema: 1 as const,
    sequence: 1,
    completionTick: 20,
    world: Object.freeze({
      universeId: "universe-drop-pickup",
      locationId: "surface",
      revision: Object.freeze({ epoch: 1, mutation: 9, residency: 3 }),
      canonicalStateHash: hash("7"),
    }),
    player: Object.freeze({
      playerId: PLAYER_ID,
      entityId: PLAYER_ENTITY_ID,
      inventoryContainer: CONTAINER,
      beforeRevision: BigInt(10),
      afterRevision: BigInt(11),
      affectedSlots: Object.freeze([
        Object.freeze({ slot: 0, beforeStack: null, afterStack: dirtStack(1) }),
      ]),
    }),
    generatedDrop: Object.freeze({
      dropId: "block-loot-v1:8:0",
      entityId: DROP_ENTITY_ID,
      provenance,
      stack: dirtStack(1),
      custodyContainer: Object.freeze({
        kind: "container" as const,
        id: "block-loot-custody-v1:8:0",
        ownerId: null,
      }),
      custodySlot: 0,
      custodyBeforeRevision: BigInt(20),
      custodyEmptiedRevision: BigInt(21),
      spatialRevision: BigInt(22),
      position: Object.freeze({ xMilli: BigInt(1_100), yMilli: BigInt(35_350), zMilli: BigInt(-2_900) }),
      velocityMilliPerSecond: Object.freeze({ xMilli: BigInt(0), yMilli: BigInt(1_250), zMilli: BigInt(0) }),
      rotation: Object.freeze({ yaw: 10, pitch: 20, roll: 30 }),
    }),
    removal: Object.freeze({
      gameplay: Object.freeze({
        before: Object.freeze({ revision: beforeGameplay, canonicalStateHash: hash("8") }),
        after: Object.freeze({
          revision: Object.freeze({
            ...beforeGameplay,
            sequence: beforeGameplay.sequence + BigInt(1),
            inventory: beforeGameplay.inventory + BigInt(1),
          }),
          canonicalStateHash: hash("9"),
        }),
      }),
      entity: Object.freeze({
        before: Object.freeze({ revision: BigInt(50), canonicalStateHash: hash("a") }),
        after: Object.freeze({ revision: BigInt(51), canonicalStateHash: hash("b") }),
      }),
      worldView: Object.freeze({
        before: Object.freeze({ revision: beforeWorldView, canonicalStateHash: hash("c") }),
        after: Object.freeze({
          revision: Object.freeze({
            ...beforeWorldView,
            sequence: beforeWorldView.sequence + BigInt(1),
            droppedItems: beforeWorldView.droppedItems + BigInt(1),
          }),
          canonicalStateHash: hash("d"),
        }),
      }),
    }),
    receiptHash: hash("e"),
  });
  return Object.freeze({ ...base, receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(base) });
}

function deathPickupFixture(): Readonly<{
  pickup: RustIntegratedRuntimeDropPickupProjectionV1;
  parent: RustLivePlayerDeathRespawnR10;
}> {
  const generated = pickupReceipt();
  const respawnSequence = BigInt(7);
  const respawnReceiptHash = hash("f");
  const playerId = BigInt(201);
  const deathSequence = BigInt(3);
  const sourceLane = "inventory" as const;
  const sourceSlot = 0;
  const custodyContainer = Object.freeze({
    kind: "container" as const,
    id: `player-death-custody-v1:${playerId}:${deathSequence}:${sourceLane}:${sourceSlot}`,
    ownerId: null,
  });
  const child: RustLivePlayerDeathDropR10 = Object.freeze({
    parentRespawnSequence: respawnSequence,
    parentReceiptHash: respawnReceiptHash,
    sourceLane,
    sourceSlot,
    stack: dirtStack(1),
    dropId: `player-death-drop-v1:${playerId}:${deathSequence}:0:${sourceSlot}`,
    entityId: DROP_ENTITY_ID,
    custodyContainer: rustIntegratedContainerViewKeyV1(custodyContainer),
    custodySlot: 0,
    custodyRevision: BigInt(0),
    spatialRevision: BigInt(0),
    position: Object.freeze({ xMilli: 1_100, yMilli: 35_350, zMilli: -2_900 }),
    velocityMilliPerSecond: Object.freeze({ xMilli: 0, yMilli: 1_250, zMilli: 0 }),
    rotation: Object.freeze({ yaw: 10, pitch: 20, roll: 30 }),
    createdTick: BigInt(18),
    expiresTick: null,
    pickupLockActorId: null,
    pickupUnlockTick: BigInt(38),
    originHash: hash("1"),
    content: Object.freeze({
      configuredManifestHash: hash("2"),
      installedManifestHash: hash("2"),
      installedRegistryHash: hash("3"),
      itemContentHash: hash("4"),
      itemContentVersion: 1,
    }),
    r6Linked: false,
  });
  const parent: RustLivePlayerDeathRespawnR10 = Object.freeze({
    respawnSequence,
    receiptHash: respawnReceiptHash,
    generatedDropCount: 1,
    playerId,
    entityId: BigInt(202),
    deathSequence,
    inventoryContainer: "container-key-v1/01",
    inventoryBeforeRevision: BigInt(10),
    inventoryAfterRevision: BigInt(11),
    equipmentContainer: "container-key-v1/02",
    equipmentBeforeRevision: BigInt(20),
    equipmentAfterRevision: BigInt(20),
    custodyAfterHash: hash("5"),
    drops: Object.freeze([child]),
  });
  const { provenance: generatedProvenance, ...generatedDropWithoutProvenance } = generated.generatedDrop;
  void generatedProvenance;
  const base = Object.freeze({
    ...generated,
    generatedDrop: Object.freeze({
      ...generatedDropWithoutProvenance,
      dropId: child.dropId,
      origin: Object.freeze({
        kind: "player-death-drop" as const,
        respawnSequence: Number(respawnSequence),
        respawnReceiptHash,
        sourceLane,
        sourceSlot,
      }),
      custodyContainer,
      custodyBeforeRevision: BigInt(0),
      custodyEmptiedRevision: BigInt(1),
      spatialRevision: BigInt(0),
    }),
  });
  const pickup = Object.freeze({
    ...base,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(base),
  });
  return Object.freeze({ pickup, parent });
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

async function waitFor(predicate: () => boolean, timeoutMilliseconds = 3_500) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for drop-pickup retry state");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

type HarnessHost = Readonly<{
  config: Readonly<{ universeId: string; locationId: string; sessionId: string }>;
  diagnostics(): Readonly<{ state: "ready" }>;
  nativePersistenceSession(): Readonly<{
    diagnostics(): Readonly<Record<string, unknown>>;
  }>;
  multiplayerAuthority(): Readonly<{
    runExclusiveMutation<T>(operation: () => Promise<T>): Promise<T>;
  }>;
}>;

type HarnessPump = Readonly<{
  state: "ready";
  diagnostics(): Readonly<{
    dropPickupQueryConfigured: true;
    dropPickupLegacySeedPending: false;
    dropPickupCursor: number;
    pendingDropPickupSequence: number | null;
    pendingDropPickupReceiptHash: string | null;
    pendingDropPickupIdentityHash: string | null;
    lastAcknowledgedDropPickupSequence: number | null;
    lastAcknowledgedDropPickupReceiptHash: string | null;
  }>;
  adoptExternalNetworkSuccessor(generation: number): Promise<void>;
  acknowledgeDropPickup(
    generation: number,
    delivery: RustLiveInputPumpDropPickupDeliveryV1,
  ): boolean;
}>;

type CommitInput = Readonly<{
  generation: number;
  host: HarnessHost;
  pump: HarnessPump;
  delivery: RustLiveInputPumpDropPickupDeliveryV1;
  extraction: RustIntegratedRuntimeExtractionV1;
  requestedView: RustIntegratedRuntimeExtractionViewV1;
  camera: RustLiveCameraViewR10;
}>;

type CommitAccess = Readonly<{
  commitRustNativeDropPickupProjectionV1(input: CommitInput): Promise<void>;
  retryRustNativeDropPickupFinalizeV1(): Promise<unknown>;
  scheduleRustLiveInputAdvanceR5(): void;
}>;

type HarnessOptions = Readonly<{
  checkpointGate?: Promise<void>;
  checkpointError?: Error;
  checkpointBeforeStateHash?: string;
  deathPickup?: boolean;
  localSaveError?: Error;
  localSaveFailures?: number;
  localSaveThrows?: boolean;
  missingDrop?: boolean;
  multiplayerAuthorityMode?: "rust-authoritative";
  renderRuntime?: boolean;
  suppressNativeSave?: boolean;
}>;

type ProjectionCursor = Readonly<{
  schema: 1;
  cursor: number;
  lastReceiptHash: string | null;
}>;

const prototypeStackMatches = (VoxelEngine.prototype as unknown as Readonly<{
  rustTerrainLocatorStackMatches(
    view: RustLivePlayerViewR10["held"],
    expected: RustIntegratedPlayerInventoryStackV1 | null,
  ): boolean;
}>).rustTerrainLocatorStackMatches;

function createHarness(options: HarnessOptions = {}) {
  const deathFixture = options.deathPickup ? deathPickupFixture() : null;
  const receipt = deathFixture?.pickup ?? pickupReceipt();
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
    tick: receipt.completionTick,
    stateHash: hash("1"),
  }) satisfies RustIntegratedRuntimeIdentityV1;
  const checkpointIdentity = Object.freeze({
    ...queryIdentity,
    revision: Object.freeze({ ...queryIdentity.revision, persistence: 6 }),
    stateHash: hash("2"),
  }) satisfies RustIntegratedRuntimeIdentityV1;
  const persistenceBefore = Object.freeze({
    worldId: "world:world-drop-pickup@surface",
    state: "open" as const,
    saves: 10,
    recoveries: 0,
    legacyMigrations: 0,
    legacyMigrationRetries: 0,
    parentFallbacks: 0,
    platformOperations: 20,
    requestBytes: 100,
    responseBytes: 10,
    lastCheckpointId: "checkpoint-10",
    lastError: null,
  });
  const persistenceAfter = Object.freeze({
    worldId: "world:world-drop-pickup@surface",
    state: "open" as const,
    saves: 11,
    recoveries: 0,
    legacyMigrations: 0,
    legacyMigrationRetries: 0,
    parentFallbacks: 0,
    platformOperations: 21,
    requestBytes: 200,
    responseBytes: 20,
    lastCheckpointId: "checkpoint-11",
    lastError: null,
  });
  const actionDelivery = Object.freeze({
    worldGeneration: GENERATION,
    queryIdentity,
    cursorBefore: 0,
    cursorAfter: receipt.sequence,
    requestPayloadHash: hash("e"),
    projectionPayloadHash: hash("f"),
    receipt,
  }) satisfies RustLiveInputPumpDropPickupDeliveryV1;
  const calls: string[] = [];
  const checkpointStarted = deferred();
  const acknowledgements: RustLiveInputPumpDropPickupDeliveryV1[] = [];
  const savedCursors: ProjectionCursor[] = [];
  const counters = {
    inventoryMutations: 0,
    dropRemovals: 0,
    playerCameraCommits: 0,
    localSaves: 0,
  };

  const rawInventory = Array.from<InventorySlot | null>({ length: 9 }).fill(null);
  const inventory = new Proxy(rawInventory, {
    set(target, property, value, receiver) {
      if (property === "0") {
        counters.inventoryMutations += 1;
        calls.push("inventory:project");
      }
      return Reflect.set(target, property, value, receiver);
    },
  });
  const drops = options.missingDrop ? [] : [{
    rustEntityId: DROP_ENTITY_ID.toString(10),
    item: BlockId.Dirt,
    count: 1,
    durability: undefined,
    metadata: undefined,
  }];

  const containerViewKey = rustIntegratedContainerViewKeyV1(CONTAINER);
  const priorPlayer = Object.freeze({
    selectedSlot: 0,
    inventoryContainer: containerViewKey,
    inventoryContainerRevision: receipt.player.beforeRevision,
    held: null,
  }) as RustLivePlayerViewR10;
  const stagedPlayer = Object.freeze({
    selectedSlot: 0,
    inventoryContainer: containerViewKey,
    inventoryContainerRevision: receipt.player.afterRevision,
    authorityTick: BigInt(receipt.completionTick),
    held: liveHeld(receipt.player.affectedSlots[0]!.afterStack),
    latestDeathRespawn: deathFixture?.parent ?? null,
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

  let acknowledged = false;
  const pump: HarnessPump = Object.freeze({
    state: "ready",
    diagnostics: () => Object.freeze({
      dropPickupQueryConfigured: true,
      dropPickupLegacySeedPending: false,
      dropPickupCursor: acknowledged ? actionDelivery.cursorAfter : actionDelivery.cursorBefore,
      pendingDropPickupSequence: acknowledged ? null : actionDelivery.cursorAfter,
      pendingDropPickupReceiptHash: acknowledged ? null : actionDelivery.receipt.receiptHash,
      pendingDropPickupIdentityHash: acknowledged ? null : actionDelivery.queryIdentity.stateHash,
      lastAcknowledgedDropPickupSequence: acknowledged ? actionDelivery.cursorAfter : null,
      lastAcknowledgedDropPickupReceiptHash: acknowledged ? actionDelivery.receipt.receiptHash : null,
    }),
    async adoptExternalNetworkSuccessor(generation) {
      assert.equal(generation, GENERATION);
      calls.push("network:adopt");
    },
    acknowledgeDropPickup(generation, acknowledgedDelivery) {
      assert.equal(generation, GENERATION);
      assert.equal(acknowledgedDelivery, actionDelivery);
      calls.push("pump:ack");
      acknowledgements.push(acknowledgedDelivery);
      acknowledged = true;
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
    config: Object.freeze({
      universeId: receipt.world.universeId,
      locationId: receipt.world.locationId,
      sessionId: "session:drop-pickup",
    }),
    diagnostics: () => Object.freeze({ state: "ready" as const }),
    nativePersistenceSession: () => Object.freeze({
      diagnostics: () => persistenceAfter,
    }),
    multiplayerAuthority: () => authority,
  });

  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const privateEngine = engine as unknown as {
    rustTerrainLocatorCommitLocked: boolean;
    rustNativeDropPickupProjection: ProjectionCursor;
    rustNativeDropPickupCheckpoint: unknown;
    rustNativeDropPickupPendingFinalize: Readonly<Record<string, unknown>> | null;
    rustNativeDropPickupFinalizeRetryTimer: ReturnType<typeof setTimeout> | null;
    rustLiveInputAdvance: Promise<unknown> | null;
    rustLivePlayerPresentationViewR10: RustLivePlayerViewR10 | null;
    rustLiveCameraPresentationViewR10: RustLiveCameraViewR10 | null;
    rustDroppedHotTransformFrameR10: unknown;
    rustLiveRenderViewR10: RustIntegratedRuntimeExtractionViewV1;
    rustLiveSelectedSlotIntentR5: number | null;
    rustLiveSelectedSlotIntentPendingR5: boolean;
    selected: number;
  };
  Object.assign(engine, {
    rustTerrainLocatorCommitLocked: false,
    rustNativeSaveSuppressedForMultiplayerRuntime: options.suppressNativeSave ?? false,
    rustNativeDropPickupProjection: Object.freeze({ schema: 1, cursor: 0, lastReceiptHash: null }),
    rustNativeDropPickupCheckpoint: null,
    rustNativeDropPickupPendingFinalize: null,
    rustNativeDropPickupFinalizeRetryTimer: null,
    rustLivePlayerAttestationR10: Object.freeze({
      playerId: PLAYER_ID,
      entityId: PLAYER_ENTITY_ID,
      inventoryContainer: CONTAINER,
    }),
    rustLivePlayerPresentationViewR10: priorPlayer,
    rustLiveCameraPresentationViewR10: null,
    rustDroppedHotTransformFrameR10: null,
    rustRuntimeTransitionGeneration: GENERATION,
    rustLivePlayerAuthorityGeneration: GENERATION,
    rustRuntimeHost: host,
    rustLiveInputPump: pump,
    rustLiveInputAdvance: null,
    rustRenderExtractionPoll: null,
    rustLiveRendererExtractionQueue: [],
    rustLiveRenderRuntime: options.renderRuntime ? Object.freeze({ state: "ready" }) : null,
    rustLiveRenderViewR10: requestedView,
    rustLiveSelectedSlotIntentR5: 0,
    rustLiveSelectedSlotIntentPendingR5: false,
    rustNativePersistenceWorldId: "world-drop-pickup",
    activeWorldId: "world-drop-pickup",
    persistent: true,
    mode: "survival",
    selected: 0,
    disposed: false,
    multiplayer: options.multiplayerAuthorityMode
      ? Object.freeze({ authorityMode: options.multiplayerAuthorityMode })
      : null,
    inventory,
    drops,
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
    ) => prototypeStackMatches.call(engine, view, expected),
    checkpointRustLivePlayerNativeWitness: async (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      calls.push("checkpoint:start");
      checkpointStarted.resolve();
      if (options.checkpointGate) await options.checkpointGate;
      if (options.checkpointError) throw options.checkpointError;
      calls.push("checkpoint:end");
      return Object.freeze({
        identityBefore: options.checkpointBeforeStateHash
          ? Object.freeze({ ...queryIdentity, stateHash: options.checkpointBeforeStateHash })
          : queryIdentity,
        identityAfter: checkpointIdentity,
        persistenceBefore,
        persistenceAfter,
        checkpoint: Object.freeze({
          worldId: "world:world-drop-pickup@surface",
          saveId: "native.save.11",
          checkpointId: "checkpoint-11",
          checkpointHash: hash("3"),
          journalSequence: 11,
          records: 7,
          commits: 1,
          requestBytes: 100,
          responseBytes: 10,
        }),
      });
    },
    removeDrop: (index: number) => {
      assert.equal(index, 0);
      counters.dropRemovals += 1;
      calls.push("drop:remove");
      drops.splice(index, 1);
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
      counters.playerCameraCommits += 1;
      calls.push("player-camera:commit");
      privateEngine.rustLivePlayerPresentationViewR10 = stagedPlayer;
      privateEngine.rustLiveCameraPresentationViewR10 = stagedCamera;
      privateEngine.rustDroppedHotTransformFrameR10 = stagedDrops;
      return Object.freeze({ player: stagedPlayer, camera: stagedCamera, dropped: stagedDrops });
    },
    trackRustAuthorityOperation: <T>(operation: Promise<T>) => operation,
    quarantineRustLivePlayerAuthorityR5: (error: unknown) => {
      calls.push(`quarantine:${error instanceof Error ? error.message : String(error)}`);
    },
    enqueueRustLiveRendererExtractionR10: () => {
      calls.push("renderer:enqueue");
    },
    scheduleRustLiveViewRefreshR10: (view: RustIntegratedRuntimeExtractionViewV1) => {
      assert.equal(privateEngine.rustLiveInputAdvance, null);
      assert.equal(privateEngine.rustTerrainLocatorCommitLocked, false);
      calls.push(`renderer:refresh:${view.viewRevision}`);
    },
    saveRustCompatibilityDocumentLocalOnly: (requirement: string) => {
      assert.equal(requirement, "a native drop-pickup projection");
      counters.localSaves += 1;
      calls.push("local:save");
      savedCursors.push(privateEngine.rustNativeDropPickupProjection);
      const failureLimit = options.localSaveFailures ?? (options.localSaveError ? 1 : 0);
      if (counters.localSaves <= failureLimit) {
        const error = options.localSaveError ?? new Error("local save failed");
        if (options.localSaveThrows) throw error;
        return Object.freeze({ ok: false as const, error });
      }
      return Object.freeze({ ok: true as const, value: Object.freeze({ worldId: "world-drop-pickup" }) });
    },
    audio: { play: (name: string) => { calls.push(`audio:${name}`); } },
    emitHud: () => { calls.push("hud:emit"); },
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
    .commitRustNativeDropPickupProjectionV1(input);
  const retry = () => (engine as unknown as CommitAccess).retryRustNativeDropPickupFinalizeV1();
  const schedule = () => (engine as unknown as CommitAccess).scheduleRustLiveInputAdvanceR5();

  return {
    calls,
    counters,
    inventory,
    drops,
    receipt,
    delivery: actionDelivery,
    acknowledgements,
    savedCursors,
    checkpointStarted: checkpointStarted.promise,
    commitLocked: () => privateEngine.rustTerrainLocatorCommitLocked,
    cursor: () => privateEngine.rustNativeDropPickupProjection,
    checkpointWitness: () => privateEngine.rustNativeDropPickupCheckpoint,
    pendingFinalize: () => privateEngine.rustNativeDropPickupPendingFinalize,
    inputAdvance: () => privateEngine.rustLiveInputAdvance,
    retryTimer: () => privateEngine.rustNativeDropPickupFinalizeRetryTimer,
    cancelRetryTimer: () => {
      const timer = privateEngine.rustNativeDropPickupFinalizeRetryTimer;
      if (timer !== null) clearTimeout(timer);
      privateEngine.rustNativeDropPickupFinalizeRetryTimer = null;
    },
    selectPhysical: (slot: number) => engine.selectSlotFromPlayerInput(slot),
    selection: () => Object.freeze({
      selected: privateEngine.selected,
      intent: privateEngine.rustLiveSelectedSlotIntentR5,
      pending: privateEngine.rustLiveSelectedSlotIntentPendingR5,
    }),
    mutateSelection: (selected: number, intent: number | null, pending: boolean) => {
      privateEngine.selected = selected;
      privateEngine.rustLiveSelectedSlotIntentR5 = intent;
      privateEngine.rustLiveSelectedSlotIntentPendingR5 = pending;
    },
    setViewRevision: (viewRevision: number) => {
      privateEngine.rustLiveRenderViewR10 = Object.freeze({ ...requestedView, viewRevision });
    },
    armRetryNow: () => {
      const pending = privateEngine.rustNativeDropPickupPendingFinalize;
      assert.ok(pending);
      privateEngine.rustNativeDropPickupPendingFinalize = Object.freeze({ ...pending, retryNotBefore: 0 });
    },
    commit,
    retry,
    schedule,
  };
}

test("native drop pickup checkpoints before exact browser projection, save, and acknowledgement", async () => {
  const checkpointGate = deferred();
  const harness = createHarness({ checkpointGate: checkpointGate.promise });
  const pending = harness.commit();
  await harness.checkpointStarted;

  assert.deepEqual(harness.calls, [
    "context:native drop-pickup projection preflight",
    "stage:player",
    "stage:camera",
    "stage:drops",
    "authority:enter",
    "context:native drop-pickup checkpoint",
    "checkpoint:start",
  ]);
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.dropRemovals, 0);
  assert.equal(harness.counters.playerCameraCommits, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.deepEqual(harness.inventory[0], null);
  assert.equal(harness.drops.length, 1);

  checkpointGate.resolve();
  await pending;

  assert.deepEqual(harness.calls, [
    "context:native drop-pickup projection preflight",
    "stage:player",
    "stage:camera",
    "stage:drops",
    "authority:enter",
    "context:native drop-pickup checkpoint",
    "checkpoint:start",
    "checkpoint:end",
    "context:native drop-pickup compatibility commit",
    "inventory:project",
    "drop:remove",
    "player-camera:commit",
    "local:save",
    "pump:ack",
    "audio:pickup",
    "hud:emit",
    "authority:exit",
  ]);
  assert.deepEqual(harness.inventory[0], { item: BlockId.Dirt, count: 1 });
  assert.equal(harness.drops.length, 0);
  assert.deepEqual(harness.savedCursors, [{
    schema: 1,
    cursor: harness.receipt.sequence,
    lastReceiptHash: harness.receipt.receiptHash,
  }]);
  assert.equal(harness.acknowledgements.length, 1);
  assert.equal(harness.acknowledgements[0], harness.delivery);
  assert.deepEqual(harness.checkpointWitness(), {
    schema: 1,
    cursorBefore: 0,
    cursorAfter: harness.receipt.sequence,
    receiptHash: harness.receipt.receiptHash,
    queryIdentityHash: harness.delivery.queryIdentity.stateHash,
    rustEntityId: DROP_ENTITY_ID.toString(10),
    identityBefore: harness.delivery.queryIdentity,
    identityAfter: {
      ...harness.delivery.queryIdentity,
      revision: { ...harness.delivery.queryIdentity.revision, persistence: 6 },
      stateHash: hash("2"),
    },
    persistenceBefore: {
      worldId: "world:world-drop-pickup@surface", state: "open", saves: 10,
      recoveries: 0, legacyMigrations: 0, legacyMigrationRetries: 0, parentFallbacks: 0,
      platformOperations: 20, requestBytes: 100, responseBytes: 10,
      lastCheckpointId: "checkpoint-10", lastError: null,
    },
    persistenceAfter: {
      worldId: "world:world-drop-pickup@surface", state: "open", saves: 11,
      recoveries: 0, legacyMigrations: 0, legacyMigrationRetries: 0, parentFallbacks: 0,
      platformOperations: 21, requestBytes: 200, responseBytes: 20,
      lastCheckpointId: "checkpoint-11", lastError: null,
    },
    checkpoint: {
      worldId: "world:world-drop-pickup@surface", saveId: "native.save.11",
      checkpointId: "checkpoint-11", checkpointHash: hash("3"), journalSequence: 11,
      records: 7, commits: 1, requestBytes: 100, responseBytes: 10,
    },
  });
  assert.ok(harness.calls.indexOf("local:save") < harness.calls.indexOf("pump:ack"));
  assert.equal(harness.commitLocked(), false);
});

test("drop validation failure causes no checkpoint, browser mutation, or acknowledgement", async () => {
  const harness = createHarness({ missingDrop: true });
  await assert.rejects(harness.commit(), /does not remove exactly one matching compatibility drop/u);

  assert.equal(harness.calls.includes("authority:enter"), false);
  assert.equal(harness.calls.includes("checkpoint:start"), false);
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.dropRemovals, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.deepEqual(harness.inventory[0], null);
  assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
});

test("native checkpoint failure leaves the compatibility inventory and drop untouched", async () => {
  const harness = createHarness({ checkpointError: new Error("checkpoint failed") });
  await assert.rejects(harness.commit(), /checkpoint failed/u);

  assert.equal(harness.calls.includes("checkpoint:start"), true);
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.dropRemovals, 0);
  assert.equal(harness.counters.playerCameraCommits, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.deepEqual(harness.inventory[0], null);
  assert.equal(harness.drops.length, 1);
  assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.equal(harness.checkpointWitness(), null);
  assert.equal(harness.commitLocked(), false);
});

test("inventory drift during the checkpoint window cannot be overwritten", async () => {
  const checkpointGate = deferred();
  const harness = createHarness({ checkpointGate: checkpointGate.promise });
  const committing = harness.commit();
  await harness.checkpointStarted;
  harness.inventory[1] = { item: BlockId.Dirt, count: 2 };
  checkpointGate.resolve();

  await assert.rejects(committing, /compatibility predecessor changed during its checkpoint/u);
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.dropRemovals, 0);
  assert.equal(harness.counters.playerCameraCommits, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.deepEqual(harness.inventory[0], null);
  assert.deepEqual(harness.inventory[1], { item: BlockId.Dirt, count: 2 });
  assert.equal(harness.drops.length, 1);
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.checkpointWitness(), null);
  assert.equal(harness.pendingFinalize(), null);
  assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.equal(harness.commitLocked(), false);
});

test("selection drift during checkpoint fails closed and physical hotbar input is held", async () => {
  const checkpointGate = deferred();
  const harness = createHarness({ checkpointGate: checkpointGate.promise });
  const committing = harness.commit();
  await harness.checkpointStarted;

  harness.selectPhysical(4);
  assert.deepEqual(harness.selection(), { selected: 0, intent: 0, pending: false });
  harness.mutateSelection(1, 1, true);
  checkpointGate.resolve();

  await assert.rejects(committing, /compatibility predecessor changed during its checkpoint/u);
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.dropRemovals, 0);
  assert.equal(harness.counters.playerCameraCommits, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.deepEqual(harness.inventory[0], null);
  assert.equal(harness.drops.length, 1);
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.checkpointWitness(), null);
  assert.equal(harness.pendingFinalize(), null);
  assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.equal(harness.commitLocked(), false);
});

test("checkpoint identity mismatch fails before browser mutation", async () => {
  const harness = createHarness({ checkpointBeforeStateHash: hash("f") });
  await assert.rejects(
    harness.commit(),
    /does not continue the queried drop-pickup identity/u,
  );

  assert.equal(harness.calls.filter((call) => call === "checkpoint:start").length, 1);
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.dropRemovals, 0);
  assert.equal(harness.counters.playerCameraCommits, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.deepEqual(harness.inventory[0], null);
  assert.equal(harness.drops.length, 1);
  assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.equal(harness.checkpointWitness(), null);
  assert.equal(harness.pendingFinalize(), null);
  assert.equal(harness.commitLocked(), false);
  assert.equal(harness.calls.some((call) => call.startsWith("audio:")), false);
});

test("failed local save retains the exact projected successor and native receipt", async () => {
  const harness = createHarness({ localSaveError: new Error("disk full") });
  const before = Date.now();
  await harness.commit();

  assert.equal(harness.counters.inventoryMutations, 1);
  assert.equal(harness.counters.dropRemovals, 1);
  assert.equal(harness.counters.playerCameraCommits, 1);
  assert.equal(harness.counters.localSaves, 1);
  assert.deepEqual(harness.inventory[0], { item: BlockId.Dirt, count: 1 });
  assert.equal(harness.drops.length, 0);
  assert.deepEqual(harness.cursor(), {
    schema: 1,
    cursor: harness.receipt.sequence,
    lastReceiptHash: harness.receipt.receiptHash,
  });
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.calls.includes("pump:ack"), false);
  assert.notEqual(harness.checkpointWitness(), null);
  const pending = harness.pendingFinalize() as Readonly<{
    schema: number;
    state: string;
    attempts: number;
    lastError: string;
    cursorBefore: number;
    cursorAfter: number;
    receiptHash: string;
    rustEntityId: string;
    retryNotBefore: number;
    delivery: RustLiveInputPumpDropPickupDeliveryV1;
    checkpoint: unknown;
  }>;
  assert.deepEqual({
    schema: pending.schema,
    state: pending.state,
    attempts: pending.attempts,
    lastError: pending.lastError,
    cursorBefore: pending.cursorBefore,
    cursorAfter: pending.cursorAfter,
    receiptHash: pending.receiptHash,
    rustEntityId: pending.rustEntityId,
  }, {
    schema: 1,
    state: "awaiting-local-save",
    attempts: 1,
    lastError: "disk full",
    cursorBefore: 0,
    cursorAfter: harness.receipt.sequence,
    receiptHash: harness.receipt.receiptHash,
    rustEntityId: DROP_ENTITY_ID.toString(10),
  });
  assert.ok(pending.retryNotBefore >= before + 1_000);
  assert.equal(pending.delivery, harness.delivery);
  assert.equal(pending.delivery.queryIdentity, harness.delivery.queryIdentity);
  assert.equal(pending.checkpoint, harness.checkpointWitness());
  assert.equal(harness.commitLocked(), true);
  assert.equal(harness.calls.some((call) => call.startsWith("audio:")), false);
  assert.equal(harness.calls.includes("hud:emit"), false);
  assert.notEqual(harness.retryTimer(), null);
  harness.cancelRetryTimer();
});

test("scheduler retries only the exact local save and acknowledges last", async () => {
  const harness = createHarness({ localSaveError: new Error("disk full"), renderRuntime: true });
  await harness.commit();

  harness.schedule();
  assert.equal(harness.inputAdvance(), null);
  harness.armRetryNow();
  harness.schedule();
  const retry = harness.inputAdvance();
  assert.notEqual(retry, null);
  await retry;
  await Promise.resolve();

  assert.equal(harness.calls.filter((call) => call === "checkpoint:start").length, 1);
  assert.equal(harness.counters.inventoryMutations, 1);
  assert.equal(harness.counters.dropRemovals, 1);
  assert.equal(harness.counters.playerCameraCommits, 1);
  assert.equal(harness.counters.localSaves, 2);
  assert.equal(harness.calls.filter((call) => call === "network:adopt").length, 1);
  assert.equal(harness.acknowledgements.length, 1);
  assert.equal(harness.acknowledgements[0], harness.delivery);
  assert.equal(harness.calls.filter((call) => call === "pump:ack").length, 1);
  assert.equal(harness.calls.filter((call) => call === "audio:pickup").length, 1);
  assert.equal(harness.calls.filter((call) => call === "hud:emit").length, 1);
  assert.equal(harness.calls.filter((call) => call === "renderer:enqueue").length, 1);
  assert.equal(harness.pendingFinalize(), null);
  assert.equal(harness.commitLocked(), false);
  assert.ok(harness.calls.lastIndexOf("local:save") < harness.calls.indexOf("pump:ack"));
  assert.ok(harness.calls.indexOf("pump:ack") < harness.calls.indexOf("audio:pickup"));
});

test("owned timer autonomously retries repeated throwing saves without duplicate projection", async () => {
  const harness = createHarness({
    localSaveError: new Error("storage threw"),
    localSaveFailures: 2,
    localSaveThrows: true,
  });
  await harness.commit();
  const firstTimer = harness.retryTimer();
  assert.notEqual(firstTimer, null);

  harness.schedule();
  harness.schedule();
  assert.equal(harness.retryTimer(), firstTimer);
  assert.equal(harness.inputAdvance(), null);

  await waitFor(() => harness.counters.localSaves >= 2);
  assert.notEqual(harness.pendingFinalize(), null);
  assert.notEqual(harness.retryTimer(), null);
  await waitFor(() => harness.pendingFinalize() === null);
  await Promise.resolve();

  assert.equal(harness.counters.localSaves, 3);
  assert.equal(harness.calls.filter((call) => call === "checkpoint:start").length, 1);
  assert.equal(harness.counters.inventoryMutations, 1);
  assert.equal(harness.counters.dropRemovals, 1);
  assert.equal(harness.counters.playerCameraCommits, 1);
  assert.equal(harness.calls.filter((call) => call === "network:adopt").length, 2);
  assert.equal(harness.acknowledgements.length, 1);
  assert.equal(harness.calls.filter((call) => call === "audio:pickup").length, 1);
  assert.equal(harness.calls.filter((call) => call === "hud:emit").length, 1);
  assert.equal(harness.retryTimer(), null);
  assert.equal(harness.commitLocked(), false);
});

test("retry refreshes a newer renderer view only after releasing the operation and commit lock", async () => {
  const harness = createHarness({ localSaveError: new Error("disk full"), renderRuntime: true });
  await harness.commit();
  harness.setViewRevision(8);
  harness.armRetryNow();
  harness.schedule();
  const retry = harness.inputAdvance();
  assert.notEqual(retry, null);
  await retry;
  await Promise.resolve();

  assert.equal(harness.calls.filter((call) => call === "renderer:enqueue").length, 0);
  assert.equal(harness.calls.filter((call) => call === "renderer:refresh:8").length, 1);
  assert.ok(harness.calls.indexOf("pump:ack") < harness.calls.indexOf("renderer:refresh:8"));
  assert.equal(harness.pendingFinalize(), null);
  assert.equal(harness.retryTimer(), null);
  assert.equal(harness.commitLocked(), false);
});

test("engine commits a tag-2 death-drop pickup through its retained parent", async () => {
  const harness = createHarness({ deathPickup: true });
  await harness.commit();

  assert.equal(harness.counters.inventoryMutations, 1);
  assert.equal(harness.counters.dropRemovals, 1);
  assert.equal(harness.counters.localSaves, 1);
  assert.equal(harness.acknowledgements.length, 1);
  assert.deepEqual(harness.inventory[0], { item: BlockId.Dirt, count: 1 });
  assert.equal(harness.drops.length, 0);
  assert.equal(harness.commitLocked(), false);
});

test("pending finalize drift fails closed without duplicate credit, removal, or acknowledgement", async () => {
  const harness = createHarness({ localSaveError: new Error("disk full") });
  await harness.commit();
  const mutationsBeforeDrift = harness.counters.inventoryMutations;
  harness.inventory[0] = { item: BlockId.Dirt, count: 2 };

  await assert.rejects(
    harness.retry(),
    /pending finalize no longer matches its exact projected successor/u,
  );

  assert.equal(harness.calls.filter((call) => call === "checkpoint:start").length, 1);
  assert.equal(harness.counters.inventoryMutations, mutationsBeforeDrift + 1);
  assert.equal(harness.counters.dropRemovals, 1);
  assert.equal(harness.counters.playerCameraCommits, 1);
  assert.equal(harness.counters.localSaves, 1);
  assert.equal(harness.calls.includes("network:adopt"), false);
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.calls.some((call) => call.startsWith("audio:")), false);
  assert.notEqual(harness.pendingFinalize(), null);
  assert.equal(harness.commitLocked(), true);
  harness.cancelRetryTimer();
});

for (const suppression of [
  { suppressNativeSave: true },
  { multiplayerAuthorityMode: "rust-authoritative" as const },
]) {
  test(`multiplayer authority suppression rejects before checkpoint (${Object.keys(suppression)[0]})`, async () => {
    const harness = createHarness(suppression);
    await assert.rejects(harness.commit(), /disabled after multiplayer authority/u);

    assert.deepEqual(harness.calls, []);
    assert.equal(harness.counters.inventoryMutations, 0);
    assert.equal(harness.counters.dropRemovals, 0);
    assert.equal(harness.counters.playerCameraCommits, 0);
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);
    assert.deepEqual(harness.inventory[0], null);
    assert.equal(harness.drops.length, 1);
    assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
    assert.equal(harness.commitLocked(), false);
  });
}
