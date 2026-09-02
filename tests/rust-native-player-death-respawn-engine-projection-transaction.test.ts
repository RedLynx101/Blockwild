import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BlockId, Item, type GameMode, type InventorySlot } from "../app/game/data.ts";
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
import type {
  RustIntegratedContainerKeyV1,
  RustIntegratedPlayerInventoryStackV1,
} from "../app/game/rust-integrated-runtime-player-inventory.ts";
import { rustIntegratedContainerViewKeyV1 } from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import type { RustLivePlayerRespawnPlanRecordV1 } from "../app/game/rust-integrated-runtime-player-respawn.ts";
import type { RustLiveCameraViewR10 } from "../app/game/rust-live-camera-view-r10.ts";
import type {
  RustLiveInputPumpDeathRespawnDeliveryV1,
} from "../app/game/rust-live-input-pump-r5.ts";
import type {
  RustLivePlayerDeathDropR10,
  RustLivePlayerDeathRespawnR10,
  RustLivePlayerViewR10,
} from "../app/game/rust-live-player-view-r10.ts";
import { planRustNativePlayerDeathRespawnBrowserProjectionV1 } from "../app/game/rust-native-player-death-respawn-projection.ts";

const GENERATION = 37;
const PLAYER_ID = BigInt(701);
const PLAYER_ENTITY_ID = BigInt(702);
const EXISTING_DROP_ENTITY_ID = BigInt(703);
const DEATH_SEQUENCE = BigInt(19);
const AUTHORITY_TICK = BigInt(110);
const WORLD_ID = "world-live-death-respawn";
const NATIVE_WORLD_ID = `world:${WORLD_ID}@surface`;

const INVENTORY_CONTAINER = Object.freeze({
  kind: "player" as const,
  id: "actor:noah",
  ownerId: "actor:noah",
}) satisfies RustIntegratedContainerKeyV1;
const EQUIPMENT_CONTAINER = Object.freeze({
  kind: "equipment" as const,
  id: "equipment:actor:noah",
  ownerId: "actor:noah",
}) satisfies RustIntegratedContainerKeyV1;
const INVENTORY_VIEW_KEY = rustIntegratedContainerViewKeyV1(INVENTORY_CONTAINER);
const EQUIPMENT_VIEW_KEY = rustIntegratedContainerViewKeyV1(EQUIPMENT_CONTAINER);

const hash = (digit: string) => digit.repeat(32);

function stack(itemCode: number, count: number): RustIntegratedPlayerInventoryStackV1 {
  return Object.freeze({
    itemCode,
    count,
    durabilityMillionths: null,
    metadataHash: "0".repeat(32),
  });
}

const DEATH_STACKS = Object.freeze([
  Object.freeze({ slot: 0, stack: stack(Item.Berry, 3) }),
  Object.freeze({ slot: 2, stack: stack(BlockId.Dirt, 2) }),
  Object.freeze({ slot: 8, stack: stack(BlockId.Stone, 1) }),
]);

function deathChild(
  index: number,
  source: (typeof DEATH_STACKS)[number],
  receiptHash: string,
): RustLivePlayerDeathDropR10 {
  const custodyContainer = rustIntegratedContainerViewKeyV1(Object.freeze({
    kind: "container" as const,
    id: `drop-custody:death:${index}`,
    ownerId: null,
  }));
  return Object.freeze({
    parentRespawnSequence: BigInt(1),
    parentReceiptHash: receiptHash,
    sourceLane: "inventory",
    sourceSlot: source.slot,
    stack: source.stack,
    dropId: `player-death-drop-v1:${PLAYER_ID}:${DEATH_SEQUENCE}:${index}`,
    entityId: BigInt(800 + index),
    custodyContainer,
    custodySlot: 0,
    custodyRevision: BigInt(0),
    spatialRevision: BigInt(1),
    position: Object.freeze({
      xMilli: 4_000 + index * 1_000,
      yMilli: 36_000,
      zMilli: -2_000 - index * 1_000,
    }),
    velocityMilliPerSecond: Object.freeze({
      xMilli: 100 + index * 100,
      yMilli: 900,
      zMilli: -200 - index * 100,
    }),
    rotation: Object.freeze({ yaw: 100_000 + index * 50_000, pitch: 0, roll: 0 }),
    createdTick: BigInt(107),
    expiresTick: null,
    pickupLockActorId: null,
    pickupUnlockTick: BigInt(117 + index),
    originHash: hash(String(index + 4)),
    content: Object.freeze({
      configuredManifestHash: hash("a"),
      installedManifestHash: hash("a"),
      installedRegistryHash: hash("b"),
      itemContentHash: hash("c"),
      itemContentVersion: 7,
    }),
    r6Linked: true,
  });
}

function hotTransformForChild(
  child: RustLivePlayerDeathDropR10,
  index: number,
): RustDroppedHotTransformR10 {
  const position = Object.freeze({
    x: child.position.xMilli / 1_000 + 0.125,
    y: child.position.yMilli / 1_000 + 0.25,
    z: child.position.zMilli / 1_000 - 0.125,
  });
  const velocity = Object.freeze({
    x: child.velocityMilliPerSecond.xMilli / 1_000 + 0.05,
    y: child.velocityMilliPerSecond.yMilli / 1_000 - 0.1,
    z: child.velocityMilliPerSecond.zMilli / 1_000 - 0.05,
  });
  const yaw = child.rotation.yaw + 25_000;
  return Object.freeze({
    schema: 1,
    dropId: child.dropId,
    entityId: child.entityId,
    entityRevision: BigInt(4 + index),
    rowRevision: BigInt(2),
    custodyContainer: child.custodyContainer,
    custodySlot: child.custodySlot,
    boundContainerRevision: child.custodyRevision,
    itemCode: child.stack.itemCode,
    count: child.stack.count,
    durabilityMillionths: child.stack.durabilityMillionths,
    metadataHash: Uint8Array.from({ length: 16 }, () => 0),
    position,
    velocity,
    rotationMicroturns: Object.freeze({ yaw, pitch: 0, roll: 0 }),
    yawRadians: yaw / 1_000_000 * Math.PI * 2,
    createdTick: child.createdTick,
    ageTicks: AUTHORITY_TICK - child.createdTick,
    expiresTick: child.expiresTick,
    pickupLockActorId: child.pickupLockActorId,
  });
}

function existingHotTransform(): RustDroppedHotTransformR10 {
  return Object.freeze({
    schema: 1,
    dropId: "existing-native-drop",
    entityId: EXISTING_DROP_ENTITY_ID,
    entityRevision: BigInt(9),
    rowRevision: BigInt(8),
    custodyContainer: rustIntegratedContainerViewKeyV1(Object.freeze({
      kind: "container" as const,
      id: "drop-custody:existing",
      ownerId: null,
    })),
    custodySlot: 0,
    boundContainerRevision: BigInt(0),
    itemCode: Item.Berry,
    count: 1,
    durabilityMillionths: null,
    metadataHash: Uint8Array.from({ length: 16 }, () => 0),
    position: Object.freeze({ x: 9, y: 35, z: 9 }),
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    rotationMicroturns: Object.freeze({ yaw: 0, pitch: 0, roll: 0 }),
    yawRadians: 0,
    createdTick: BigInt(90),
    ageTicks: AUTHORITY_TICK - BigInt(90),
    expiresTick: null,
    pickupLockActorId: null,
  });
}

function identity(stateHash = hash("f")): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe-death-respawn",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1,
      world: 5,
      entities: 12,
      gameplay: 13,
      persistence: 14,
      network: 15,
      simulation: 16,
    }),
    tick: Number(AUTHORITY_TICK),
    stateHash,
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

type ProjectionCursor = Readonly<{
  schema: 1;
  cursor: number;
  lastReceiptHash: string | null;
}>;

type HarnessHost = Readonly<{
  config: Readonly<{ universeId: string; locationId: string; sessionId: string }>;
  diagnostics(): Readonly<{ state: "ready" }>;
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
  state: "ready";
  diagnostics(): Readonly<{
    deathRespawnQueryConfigured: true;
    deathRespawnLegacySeedPending: false;
    deathRespawnCursor: number;
    lastAcknowledgedDeathRespawnSequence: number | null;
    lastAcknowledgedDeathRespawnReceiptHash: string | null;
    pendingDeathRespawnSequence: number;
    pendingDeathRespawnReceiptHash: string;
    pendingDeathRespawnIdentityHash: string;
  }>;
  checkpointNativePersistence(
    generation: number,
    save: () => Promise<unknown>,
  ): Promise<Readonly<{
    discarded: boolean;
    value: unknown;
    before: RustIntegratedRuntimeIdentityV1;
    after: RustIntegratedRuntimeIdentityV1;
  }>>;
  acknowledgeDeathRespawn(
    generation: number,
    delivery: RustLiveInputPumpDeathRespawnDeliveryV1,
  ): boolean;
}>;

type CommitInput = Readonly<{
  generation: number;
  host: HarnessHost;
  pump: HarnessPump;
  delivery: RustLiveInputPumpDeathRespawnDeliveryV1;
  extraction: RustIntegratedRuntimeExtractionV1;
  requestedView: RustIntegratedRuntimeExtractionViewV1;
  camera: RustLiveCameraViewR10;
}>;

type CommitAccess = Readonly<{
  commitRustNativePlayerDeathRespawnProjectionR5(input: CommitInput): Promise<void>;
}>;

type SavedDocument = Readonly<{
  save: Readonly<{
    rustNativePlayerDeathRespawnProjection: ProjectionCursor;
    rustNativePlayerRespawnPlan: RustLivePlayerRespawnPlanRecordV1 | null;
  }>;
  playTimeDeltaMs: number;
}>;

type UnsupportedCustody = "extended-inventory" | "equipment" | "offhand" | "cursor" | "trash" | "craft";

type HarnessOptions = Readonly<{
  activeWorld?: boolean;
  persistent?: boolean;
  mode?: GameMode;
  suppressNativeSave?: boolean;
  multiplayer?: boolean;
  nativePersistenceBound?: boolean;
  unsupportedCustody?: UnsupportedCustody;
  parentPatch?: Partial<RustLivePlayerDeathRespawnR10>;
  priorPlayerPatch?: Partial<RustLivePlayerViewR10>;
  stagedPlayerPatch?: Partial<RustLivePlayerViewR10>;
  hotTransform?: (
    transform: RustDroppedHotTransformR10,
    index: number,
  ) => RustDroppedHotTransformR10;
  compatibilityPatch?: Readonly<{ slot: number; value: InventorySlot | null }>;
  deliveryCursorBefore?: number;
  deliveryCursorAfter?: number;
  checkpointGate?: Promise<void>;
  checkpointError?: Error;
  checkpointBeforeStateHash?: string;
  nativeSaveDelta?: number;
  checkpointWorldId?: string;
  localSaveError?: Error;
}>;

function createHarness(options: HarnessOptions = {}) {
  const receiptHash = hash("1");
  const children = Object.freeze(DEATH_STACKS.map((source, index) => deathChild(index, source, receiptHash)));
  const baseParent = Object.freeze({
    respawnSequence: BigInt(1),
    receiptHash,
    generatedDropCount: children.length,
    playerId: PLAYER_ID,
    entityId: PLAYER_ENTITY_ID,
    deathSequence: DEATH_SEQUENCE,
    inventoryContainer: INVENTORY_VIEW_KEY,
    inventoryBeforeRevision: BigInt(4),
    inventoryAfterRevision: BigInt(5),
    equipmentContainer: EQUIPMENT_VIEW_KEY,
    equipmentBeforeRevision: BigInt(2),
    equipmentAfterRevision: BigInt(2),
    custodyAfterHash: hash("2"),
    drops: children,
  }) satisfies RustLivePlayerDeathRespawnR10;
  const parent = Object.freeze({ ...baseParent, ...options.parentPatch }) satisfies RustLivePlayerDeathRespawnR10;
  const queryIdentity = identity();
  const checkpointIdentity = Object.freeze({
    ...queryIdentity,
    revision: Object.freeze({
      ...queryIdentity.revision,
      persistence: queryIdentity.revision.persistence + 1,
    }),
    stateHash: hash("e"),
  }) satisfies RustIntegratedRuntimeIdentityV1;

  const baseTransforms = Object.freeze([
    existingHotTransform(),
    ...children.map((child, index) => hotTransformForChild(child, index)),
  ]);
  const stagedTransforms = Object.freeze(baseTransforms.map((transform, index) =>
    options.hotTransform?.(transform, index) ?? transform));
  const frameSource = Object.freeze({
    identity: queryIdentity,
    extractionRevision: BigInt(20),
    authorityTick: AUTHORITY_TICK,
    inventoryDomainRevision: baseParent.inventoryAfterRevision,
    extractionHash: hash("d"),
  });
  const baseHotFrame = Object.freeze({
    schema: 1 as const,
    source: frameSource,
    transforms: baseTransforms,
  }) satisfies RustDroppedHotTransformFrameR10;
  const stagedDrops = Object.freeze({
    schema: 1 as const,
    source: frameSource,
    transforms: stagedTransforms,
  }) satisfies RustDroppedHotTransformFrameR10;

  const validInventory = Array.from<InventorySlot | null>({ length: 36 }).fill(null);
  for (const source of DEATH_STACKS) {
    validInventory[source.slot] = { item: source.stack.itemCode, count: source.stack.count };
  }
  const expectedPlan = planRustNativePlayerDeathRespawnBrowserProjectionV1({
    receipt: baseParent,
    hotFrame: baseHotFrame,
    cursorBefore: 0,
    expectedPlayerId: PLAYER_ID,
    expectedEntityId: PLAYER_ENTITY_ID,
    expectedInventoryContainer: INVENTORY_VIEW_KEY,
    expectedEquipmentContainer: EQUIPMENT_VIEW_KEY,
    priorInventoryRevision: baseParent.inventoryBeforeRevision,
    priorEquipmentRevision: baseParent.equipmentBeforeRevision,
    successorInventoryRevision: baseParent.inventoryAfterRevision,
    successorEquipmentRevision: baseParent.equipmentAfterRevision,
    compatibilityInventory: Object.freeze(validInventory.slice(0, 9)),
    compatibilityEquipment: Object.freeze(Array.from<InventorySlot | null>({ length: 8 }).fill(null)),
    existingRustEntityIds: new Set([EXISTING_DROP_ENTITY_ID.toString(10)]),
    mode: "survival",
  });

  const rawInventory = validInventory.slice();
  if (options.compatibilityPatch) {
    rawInventory[options.compatibilityPatch.slot] = options.compatibilityPatch.value;
  }
  if (options.unsupportedCustody === "extended-inventory") {
    rawInventory[9] = { item: Item.Berry, count: 1 };
  }
  const calls: string[] = [];
  const counters = {
    inventoryClears: 0,
    dropSpawns: 0,
    nativeSaves: 0,
    localSaves: 0,
    authorityViewCommits: 0,
  };
  const clearedSlotSet = new Set(DEATH_STACKS.map((source) => String(source.slot)));
  const inventory = new Proxy(rawInventory, {
    set(target, property, value, receiver) {
      if (typeof property === "string" && clearedSlotSet.has(property) && value === null) {
        counters.inventoryClears += 1;
        calls.push(`inventory:clear:${property}`);
      }
      return Reflect.set(target, property, value, receiver);
    },
  });

  const equipment: Record<string, InventorySlot | null> = {
    head: null,
    chest: null,
    legs: null,
    feet: null,
    back: null,
    ring: null,
    amulet: null,
    trinket: null,
  };
  if (options.unsupportedCustody === "equipment") equipment.head = { item: Item.Berry, count: 1 };
  const unsupportedStack = { item: Item.Berry, count: 1 } satisfies InventorySlot;

  const priorPlayer = Object.freeze({
    extractionRevision: BigInt(19),
    inventoryContainer: INVENTORY_VIEW_KEY,
    equipmentContainer: EQUIPMENT_VIEW_KEY,
    inventoryContainerRevision: baseParent.inventoryBeforeRevision,
    equipmentContainerRevision: baseParent.equipmentBeforeRevision,
    deathSequence: DEATH_SEQUENCE,
    lastRespawnSequence: DEATH_SEQUENCE - BigInt(1),
    combat: Object.freeze({ alive: false }),
    ...options.priorPlayerPatch,
  }) as RustLivePlayerViewR10;
  const stagedPlayer = Object.freeze({
    extractionRevision: BigInt(20),
    inventoryContainer: INVENTORY_VIEW_KEY,
    equipmentContainer: EQUIPMENT_VIEW_KEY,
    inventoryContainerRevision: baseParent.inventoryAfterRevision,
    equipmentContainerRevision: baseParent.equipmentAfterRevision,
    deathSequence: DEATH_SEQUENCE,
    lastRespawnSequence: DEATH_SEQUENCE,
    combat: Object.freeze({ alive: true }),
    ...options.stagedPlayerPatch,
  }) as RustLivePlayerViewR10;
  const stagedCamera = Object.freeze({ staged: true }) as unknown as RustLiveCameraViewR10;
  const extraction = Object.freeze({ extraction: true }) as unknown as RustIntegratedRuntimeExtractionV1;
  const requestedView = Object.freeze({
    viewportWidth: 1280,
    viewportHeight: 720,
    viewRevision: 11,
  });
  const pumpCamera = Object.freeze({ pump: true }) as unknown as RustLiveCameraViewR10;
  const delivery = Object.freeze({
    worldGeneration: GENERATION,
    queryIdentity,
    cursorBefore: options.deliveryCursorBefore ?? 0,
    cursorAfter: options.deliveryCursorAfter ?? 1,
    parent,
  }) satisfies RustLiveInputPumpDeathRespawnDeliveryV1;
  const durableRespawnPlan = Object.freeze({
    schema: 1 as const,
    requestPayloadHex: "01".repeat(64),
    requestPayloadHash: hash("7"),
    commandHash: hash("8"),
  }) satisfies RustLivePlayerRespawnPlanRecordV1;

  let nativeSaveCount = 10;
  let nativePlatformOperations = 20;
  let nativeLastCheckpointId = "checkpoint-10";
  const nativeDiagnostics = () => Object.freeze({
    worldId: NATIVE_WORLD_ID,
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
  const checkpointStarted = deferred();
  const acknowledgements: RustLiveInputPumpDeathRespawnDeliveryV1[] = [];
  const savedDocuments: SavedDocument[] = [];
  const projectedDrops: Readonly<{
    rustEntityId: string;
    item: number;
    count: number;
  }>[] = [];

  const pump: HarnessPump = Object.freeze({
    state: "ready",
    diagnostics: () => Object.freeze({
      deathRespawnQueryConfigured: true,
      deathRespawnLegacySeedPending: false,
      deathRespawnCursor: 0,
      lastAcknowledgedDeathRespawnSequence: null,
      lastAcknowledgedDeathRespawnReceiptHash: null,
      pendingDeathRespawnSequence: 1,
      pendingDeathRespawnReceiptHash: parent.receiptHash,
      pendingDeathRespawnIdentityHash: queryIdentity.stateHash,
    }),
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
        before: options.checkpointBeforeStateHash
          ? Object.freeze({ ...queryIdentity, stateHash: options.checkpointBeforeStateHash })
          : queryIdentity,
        after: checkpointIdentity,
      });
    },
    acknowledgeDeathRespawn(generation, acknowledgedDelivery) {
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
    config: Object.freeze({
      universeId: queryIdentity.universeId,
      locationId: queryIdentity.locationId,
      sessionId: "session:death-respawn",
    }),
    diagnostics: () => Object.freeze({ state: "ready" }),
    nativePersistenceSession: () => Object.freeze({
      worldId: NATIVE_WORLD_ID,
      diagnostics: nativeDiagnostics,
    }),
    multiplayerAuthority: () => authority,
  });

  const browserDrops: Array<Readonly<{ rustEntityId?: string }>> = [
    Object.freeze({ rustEntityId: EXISTING_DROP_ENTITY_ID.toString(10) }),
  ];
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const privateEngine = engine as unknown as {
    rustNativePlayerDeathRespawnProjection: ProjectionCursor;
    rustNativePlayerDeathRespawnCheckpoint: unknown;
    rustNativePlayerRespawnPlan: RustLivePlayerRespawnPlanRecordV1 | null;
    rustLivePlayerRespawnPendingR5: RustLivePlayerViewR10 | null;
    rustNativePlayerDeathRespawnPendingFinalize: unknown;
    rustTerrainLocatorCommitLocked: boolean;
    rustLivePlayerPresentationViewR10: RustLivePlayerViewR10 | null;
    rustLiveCameraPresentationViewR10: RustLiveCameraViewR10 | null;
    rustDroppedHotTransformFrameR10: RustDroppedHotTransformFrameR10 | null;
  };
  Object.assign(engine, {
    rustTerrainLocatorCommitLocked: false,
    rustNativeSaveSuppressedForMultiplayerRuntime: options.suppressNativeSave ?? false,
    rustNativePlayerDeathRespawnProjection: Object.freeze({ schema: 1, cursor: 0, lastReceiptHash: null }),
    rustNativePlayerDeathRespawnCheckpoint: null,
    rustNativePlayerDeathRespawnPendingFinalize: null,
    rustNativePlayerRespawnPlan: durableRespawnPlan,
    rustLivePlayerRespawnPendingR5: priorPlayer,
    rustLivePlayerAttestationR10: Object.freeze({
      externalEntityId: "player:noah",
      actorId: "actor:noah",
      playerId: PLAYER_ID,
      entityId: PLAYER_ENTITY_ID,
      creativeMode: false,
      maximumOxygenSeconds: 15,
      maximumHealth: 20,
      inventoryContainer: INVENTORY_CONTAINER,
      equipmentContainer: EQUIPMENT_CONTAINER,
      radius: 0.35,
      standingHeight: 1.8,
      crouchingHeight: 1.2,
      mass: 80,
    }),
    rustLivePlayerPresentationViewR10: priorPlayer,
    rustLiveCameraPresentationViewR10: null,
    rustDroppedHotTransformFrameR10: null,
    rustRuntimeTransitionGeneration: GENERATION,
    rustLivePlayerAuthorityGeneration: GENERATION,
    rustRuntimeHost: host,
    rustLiveInputPump: pump,
    rustRenderExtractionPoll: null,
    rustLiveRendererExtractionQueue: [],
    disposed: false,
    multiplayer: options.multiplayer ? Object.freeze({ authorityMode: "rust-authoritative" }) : null,
    mode: options.mode ?? "survival",
    selected: 0,
    inventory,
    equipment,
    offhand: options.unsupportedCustody === "offhand" ? unsupportedStack : null,
    cursor: options.unsupportedCustody === "cursor" ? unsupportedStack : null,
    trash: options.unsupportedCustody === "trash" ? unsupportedStack : null,
    craftGrid: options.unsupportedCustody === "craft" ? [unsupportedStack, null, null, null] : [null, null, null, null],
    drops: browserDrops,
    persistent: options.persistent ?? true,
    activeWorldId: options.activeWorld === false ? null : WORLD_ID,
    rustNativePersistenceWorldId: options.nativePersistenceBound === false ? "different-world" : WORLD_ID,
    worldSessionStartedAt: Date.now(),
    spawnProtection: 0,
    hunger: 2,
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
      const expected = expectedPlan.drops[counters.dropSpawns];
      assert.ok(expected);
      assert.equal(item, expected.item);
      assert.equal(count, expected.count);
      assert.equal(durability, undefined);
      assert.equal(metadata, undefined);
      assert.deepEqual(position.toArray(), [expected.position.x, expected.position.y, expected.position.z]);
      assert.deepEqual(dropOptions, {
        allowMerge: false,
        exactPosition: true,
        rustEntityId: expected.rustEntityId,
        rotationY: expected.rotationY,
        velocity: expected.velocity,
        pickupDelay: expected.pickupDelay,
        exactIdempotentRecovery: true,
      });
      counters.dropSpawns += 1;
      calls.push(`drop:project:${expected.rustEntityId}`);
      const projected = Object.freeze({ rustEntityId: expected.rustEntityId, item, count });
      browserDrops.push(projected);
      projectedDrops.push(projected);
      return projected;
    },
    commitStagedRustLiveAuthorityViewsR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      checkedPlayer: RustLivePlayerViewR10,
      checkedCamera: RustLiveCameraViewR10,
      checkedDrops: RustDroppedHotTransformFrameR10,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.equal(checkedPlayer, stagedPlayer);
      assert.equal(checkedCamera, stagedCamera);
      assert.equal(checkedDrops, stagedDrops);
      counters.authorityViewCommits += 1;
      calls.push("player-camera-drops:commit");
      privateEngine.rustLivePlayerPresentationViewR10 = stagedPlayer;
      privateEngine.rustLiveCameraPresentationViewR10 = stagedCamera;
      privateEngine.rustDroppedHotTransformFrameR10 = stagedDrops;
      return Object.freeze({ player: stagedPlayer, camera: stagedCamera, dropped: stagedDrops });
    },
    serializeRustNativeBlockEditDropsV1: () => Object.freeze(browserDrops.map((drop) => Object.freeze({
      rustEntityId: drop.rustEntityId ?? null,
    }))),
    serialize: () => Object.freeze({
      rustNativePlayerDeathRespawnProjection: privateEngine.rustNativePlayerDeathRespawnProjection,
      rustNativePlayerRespawnPlan: privateEngine.rustNativePlayerRespawnPlan,
    }),
    worldStorage: {
      async saveNativeWorld(worldId: string) {
        assert.equal(worldId, WORLD_ID);
        counters.nativeSaves += 1;
        calls.push("native:save");
        const nativeSaveDelta = options.nativeSaveDelta ?? 1;
        nativeSaveCount += nativeSaveDelta;
        nativePlatformOperations += nativeSaveDelta;
        nativeLastCheckpointId = `checkpoint-${nativeSaveCount}`;
        return Object.freeze({
          ok: true as const,
          value: Object.freeze({
            worldId: options.checkpointWorldId ?? NATIVE_WORLD_ID,
            saveId: `native.save.${nativeSaveCount}`,
            checkpointId: nativeLastCheckpointId,
            checkpointHash: hash("9"),
            journalSequence: nativeSaveCount,
            records: 7,
            commits: nativeSaveDelta,
            requestBytes: 100,
            responseBytes: 10,
          }),
        });
      },
      saveWorldLocalOnly(worldId: string, document: SavedDocument) {
        assert.equal(worldId, WORLD_ID);
        counters.localSaves += 1;
        calls.push("local:save");
        savedDocuments.push(document);
        return options.localSaveError
          ? Object.freeze({ ok: false as const, error: options.localSaveError })
          : Object.freeze({ ok: true as const, value: Object.freeze({ worldId }) });
      },
    },
    events: {
      onToast(message: string) {
        assert.match(message, /dropped pack remains/u);
        calls.push("toast");
      },
    },
    emitHud: (force: boolean) => {
      assert.equal(force, true);
      calls.push("hud");
    },
  });

  const input = Object.freeze({
    generation: GENERATION,
    host,
    pump,
    delivery,
    extraction,
    requestedView,
    camera: pumpCamera,
  }) satisfies CommitInput;
  const commit = () => (engine as unknown as CommitAccess)
    .commitRustNativePlayerDeathRespawnProjectionR5(input);

  return {
    acknowledgements,
    calls,
    checkpointStarted: checkpointStarted.promise,
    checkpointWitness: () => privateEngine.rustNativePlayerDeathRespawnCheckpoint,
    children,
    commit,
    commitLocked: () => privateEngine.rustTerrainLocatorCommitLocked,
    counters,
    cursor: () => privateEngine.rustNativePlayerDeathRespawnProjection,
    delivery,
    durableRespawnPlan,
    expectedPlan,
    inventory,
    pendingDeadPlayer: () => privateEngine.rustLivePlayerRespawnPendingR5,
    pendingFinalize: () => privateEngine.rustNativePlayerDeathRespawnPendingFinalize,
    projectedDrops,
    respawnPlan: () => privateEngine.rustNativePlayerRespawnPlan,
    savedDocuments,
  };
}

function assertPreCheckpointBrowserState(harness: ReturnType<typeof createHarness>) {
  for (const source of DEATH_STACKS) {
    assert.deepEqual(harness.inventory[source.slot], {
      item: source.stack.itemCode,
      count: source.stack.count,
    });
  }
  assert.equal(harness.counters.inventoryClears, 0);
  assert.equal(harness.counters.dropSpawns, 0);
  assert.equal(harness.counters.authorityViewCommits, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.equal(harness.respawnPlan(), harness.durableRespawnPlan);
  assert.notEqual(harness.pendingDeadPlayer(), null);
  assert.equal(harness.pendingFinalize(), null);
}

test("false-policy death/respawn stages the full retained parent before checkpoint and acknowledges last", async () => {
  const checkpointGate = deferred();
  const harness = createHarness({ checkpointGate: checkpointGate.promise });
  const pending = harness.commit();
  await harness.checkpointStarted;

  assert.deepEqual(harness.calls, [
    "context:native death-respawn projection preflight",
    "stage:player",
    "stage:camera",
    "stage:drops",
    "authority:enter",
    "context:native death-respawn checkpoint",
    "checkpoint:start",
  ]);
  assertPreCheckpointBrowserState(harness);

  checkpointGate.resolve();
  await pending;

  assert.deepEqual(harness.calls, [
    "context:native death-respawn projection preflight",
    "stage:player",
    "stage:camera",
    "stage:drops",
    "authority:enter",
    "context:native death-respawn checkpoint",
    "checkpoint:start",
    "checkpoint:save",
    "native:save",
    "checkpoint:end",
    "context:native death-respawn compatibility commit",
    "inventory:clear:0",
    "inventory:clear:2",
    "inventory:clear:8",
    ...harness.children.map((child) => `drop:project:${child.entityId}`),
    "player-camera-drops:commit",
    "local:save",
    "pump:ack",
    "toast",
    "hud",
    "authority:exit",
  ]);
  for (const source of DEATH_STACKS) assert.equal(harness.inventory[source.slot], null);
  assert.equal(harness.counters.inventoryClears, DEATH_STACKS.length);
  assert.equal(harness.counters.dropSpawns, harness.children.length);
  assert.equal(harness.counters.authorityViewCommits, 1);
  assert.deepEqual(harness.projectedDrops.map((drop) => drop.rustEntityId),
    harness.children.map((child) => child.entityId.toString(10)));
  assert.deepEqual(harness.cursor(), {
    schema: 1,
    cursor: 1,
    lastReceiptHash: harness.delivery.parent.receiptHash,
  });
  assert.equal(harness.respawnPlan(), null);
  assert.equal(harness.pendingDeadPlayer(), null);
  assert.equal(harness.pendingFinalize(), null);
  assert.deepEqual(harness.savedDocuments[0]?.save, {
    rustNativePlayerDeathRespawnProjection: {
      schema: 1,
      cursor: 1,
      lastReceiptHash: harness.delivery.parent.receiptHash,
    },
    rustNativePlayerRespawnPlan: null,
  });
  const witness = harness.checkpointWitness() as Readonly<{
    cursorBefore: number;
    cursorAfter: number;
    receiptHash: string;
    queryIdentityHash: string;
    deathSequence: string;
    generatedDropCount: number;
    persistenceBefore: Readonly<{ saves: number }>;
    persistenceAfter: Readonly<{ saves: number }>;
    checkpoint: Readonly<{ checkpointId: string }>;
  }>;
  assert.equal(witness.cursorBefore, 0);
  assert.equal(witness.cursorAfter, 1);
  assert.equal(witness.receiptHash, harness.delivery.parent.receiptHash);
  assert.equal(witness.queryIdentityHash, harness.delivery.queryIdentity.stateHash);
  assert.equal(witness.deathSequence, DEATH_SEQUENCE.toString(10));
  assert.equal(witness.generatedDropCount, harness.children.length);
  assert.equal(witness.persistenceBefore.saves, 10);
  assert.equal(witness.persistenceAfter.saves, 11);
  assert.equal(witness.checkpoint.checkpointId, "checkpoint-11");
  assert.equal(harness.acknowledgements[0], harness.delivery);
  assert.ok(harness.calls.indexOf("pump:ack") > harness.calls.indexOf("local:save"));
  assert.equal(harness.commitLocked(), false);
});

const checkpointFailures = Object.freeze([
  Object.freeze({
    label: "native checkpoint rejection",
    options: Object.freeze({ checkpointError: new Error("checkpoint rejected") }),
    expected: /checkpoint rejected/u,
  }),
  Object.freeze({
    label: "duplicate native save",
    options: Object.freeze({ nativeSaveDelta: 2 }),
    expected: /one exact causally witnessed checkpoint/u,
  }),
  Object.freeze({
    label: "malformed checkpoint world binding",
    options: Object.freeze({ checkpointWorldId: "world:wrong@surface" }),
    expected: /one exact causally witnessed checkpoint/u,
  }),
  Object.freeze({
    label: "mismatched checkpoint query identity",
    options: Object.freeze({ checkpointBeforeStateHash: hash("6") }),
    expected: /does not continue the queried death-respawn identity/u,
  }),
]);

for (const failure of checkpointFailures) {
  test(`${failure.label} leaves browser custody, cursor, durable plan, and acknowledgement untouched`, async () => {
    const harness = createHarness(failure.options);
    await assert.rejects(harness.commit(), failure.expected);

    assertPreCheckpointBrowserState(harness);
    assert.equal(harness.checkpointWitness(), null);
    assert.equal(harness.commitLocked(), false);
  });
}

test("failed local save retains the exact false-policy delivery without acknowledgement", async () => {
  const harness = createHarness({ localSaveError: new Error("disk full") });
  await harness.commit().catch((error: unknown) => {
    assert.match(error instanceof Error ? error.message : String(error), /could not be stored.*disk full/u);
  });

  assert.equal(harness.counters.nativeSaves, 1);
  assert.equal(harness.counters.inventoryClears, DEATH_STACKS.length);
  assert.equal(harness.counters.dropSpawns, harness.children.length);
  assert.equal(harness.counters.authorityViewCommits, 1);
  assert.equal(harness.counters.localSaves, 1);
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.calls.includes("pump:ack"), false);
  assert.notEqual(harness.checkpointWitness(), null);
  for (const source of DEATH_STACKS) assert.equal(harness.inventory[source.slot], null);
  assert.deepEqual(harness.projectedDrops.map((drop) => drop.rustEntityId),
    harness.children.map((child) => child.entityId.toString(10)));
  assert.deepEqual(harness.cursor(), {
    schema: 1,
    cursor: 1,
    lastReceiptHash: harness.delivery.parent.receiptHash,
  });
  const pendingFinalize = harness.pendingFinalize() as Readonly<{
    state: string;
    attempts: number;
    lastError: string;
    delivery: RustLiveInputPumpDeathRespawnDeliveryV1;
  }>;
  assert.equal(pendingFinalize.state, "awaiting-local-save");
  assert.equal(pendingFinalize.attempts, 1);
  assert.equal(pendingFinalize.lastError, "disk full");
  assert.equal(pendingFinalize.delivery, harness.delivery);
  assert.equal(harness.commitLocked(), true,
    "the exact projected successor remains locked until its local save can be retried");
});

const preflightDrifts: readonly Readonly<{
  label: string;
  options: HarnessOptions;
  expected: RegExp;
}>[] = Object.freeze([
  Object.freeze({
    label: "retained parent count",
    options: Object.freeze({ parentPatch: Object.freeze({ generatedDropCount: 4 }) }),
    expected: /active player or custody revisions/u,
  }),
  Object.freeze({
    label: "previously presented player",
    options: Object.freeze({ priorPlayerPatch: Object.freeze({ combat: Object.freeze({ alive: true }) as RustLivePlayerViewR10["combat"] }) }),
    expected: /previously presented dead player/u,
  }),
  Object.freeze({
    label: "inventory container",
    options: Object.freeze({ parentPatch: Object.freeze({ inventoryContainer: "container-key-v1/ff" }) }),
    expected: /active player or custody revisions/u,
  }),
  Object.freeze({
    label: "projection cursor",
    options: Object.freeze({ deliveryCursorBefore: 1 }),
    expected: /does not continue/u,
  }),
  Object.freeze({
    label: "hot death-drop stack",
    options: Object.freeze({
      hotTransform: (transform: RustDroppedHotTransformR10, index: number) => index === 1
        ? Object.freeze({ ...transform, count: transform.count + 1 })
        : transform,
    }),
    expected: /hot transform/u,
  }),
  Object.freeze({
    label: "compatibility source stack",
    options: Object.freeze({ compatibilityPatch: Object.freeze({ slot: 0, value: { item: Item.Berry, count: 2 } }) }),
    expected: /compatibility source stack/u,
  }),
]);

for (const drift of preflightDrifts) {
  test(`death/respawn rejects ${drift.label} drift before checkpoint or browser mutation`, async () => {
    const harness = createHarness(drift.options);
    await assert.rejects(harness.commit(), drift.expected);

    assert.equal(harness.calls.includes("checkpoint:start"), false);
    assert.equal(harness.counters.inventoryClears, 0);
    assert.equal(harness.counters.dropSpawns, 0);
    assert.equal(harness.counters.nativeSaves, 0);
    assert.equal(harness.counters.authorityViewCommits, 0);
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);
    assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
    assert.equal(harness.respawnPlan(), harness.durableRespawnPlan);
    assert.equal(harness.commitLocked(), false);
  });
}

for (const custody of [
  "extended-inventory",
  "equipment",
  "offhand",
  "cursor",
  "trash",
  "craft",
] as const) {
  test(`unsupported ${custody} custody fails closed before death/respawn staging`, async () => {
    const harness = createHarness({ unsupportedCustody: custody });
    await assert.rejects(harness.commit(), /cannot cross unsupported compatibility custody/u);

    assert.deepEqual(harness.calls, []);
    assert.equal(harness.counters.inventoryClears, 0);
    assert.equal(harness.counters.dropSpawns, 0);
    assert.equal(harness.counters.nativeSaves, 0);
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);
    assert.equal(harness.respawnPlan(), harness.durableRespawnPlan);
  });
}

const closedWorldStates: readonly Readonly<{
  label: string;
  options: HarnessOptions;
  expected: RegExp;
}>[] = Object.freeze([
  Object.freeze({ label: "multiplayer", options: Object.freeze({ multiplayer: true }), expected: /persistent single-player Survival/u }),
  Object.freeze({ label: "suppressed native saves", options: Object.freeze({ suppressNativeSave: true }), expected: /persistent single-player Survival/u }),
  Object.freeze({ label: "nonpersistent world", options: Object.freeze({ persistent: false }), expected: /persistent single-player Survival/u }),
  Object.freeze({ label: "missing active world", options: Object.freeze({ activeWorld: false }), expected: /persistent single-player Survival/u }),
  Object.freeze({ label: "non-Survival mode", options: Object.freeze({ mode: "builder" }), expected: /persistent single-player Survival/u }),
  Object.freeze({ label: "mismatched native-save binding", options: Object.freeze({ nativePersistenceBound: false }), expected: /persistent single-player Survival/u }),
]);

for (const state of closedWorldStates) {
  test(`${state.label} fails closed without death/respawn browser mutation`, async () => {
    const harness = createHarness(state.options);
    await assert.rejects(harness.commit(), state.expected);

    assert.equal(harness.counters.inventoryClears, 0);
    assert.equal(harness.counters.dropSpawns, 0);
    assert.equal(harness.counters.nativeSaves, 0);
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);
    assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
    assert.equal(harness.respawnPlan(), harness.durableRespawnPlan);
    assert.equal(harness.commitLocked(), false);
  });
}
