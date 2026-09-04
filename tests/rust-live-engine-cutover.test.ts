import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  VoxelEngine,
  type RustWorldHydrationHookV1,
  type WorldSave,
} from "../app/game/engine.ts";
import type { RustWorldRuntimeHostConfigV1 } from "../app/game/rust-world-runtime-host.ts";
import type { RustWorldRuntimeManagedHostV1 } from "../app/game/rust-world-runtime-manager.ts";
import type { RustNativeWorldPersistenceSessionV1 } from "../app/game/rust-native-world-persistence.ts";
import { WorldStorage, deriveWorldGenerationIdentityV1 } from "../app/game/world-storage.ts";
import { BlockId } from "../app/game/data.ts";
import { BiomeId, CHUNK_SIZE, ChunkWorld, MIN_Y } from "../app/game/world.ts";

const GENERATION_IDENTITY = deriveWorldGenerationIdentityV1({
  generatorVersion: 18,
  generatorProfile: "world-below-v15",
} as WorldSave, {});

type Deferred = Readonly<{ promise: Promise<void>; resolve: () => void }>;
function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

class TrackingWorldStorage extends WorldStorage {
  constructor(storage: Storage, private readonly operations: string[], idFactory: () => string) {
    let now = 1_000;
    super(storage, { now: () => ++now, idFactory, persistenceCoordinator: null, storageEventTarget: null });
  }

  override setActiveWorld(id: string | null) {
    this.operations.push(`catalog-active:${id ?? "none"}`);
    return super.setActiveWorld(id);
  }

  override deleteWorld(id: string) {
    this.operations.push(`catalog-delete:${id}`);
    return super.deleteWorld(id);
  }

  override async shutdownNativePersistence() {
    this.operations.push("native-shutdown-start");
    await super.shutdownNativePersistence();
    this.operations.push("native-shutdown-complete");
  }
}

function storedWorldSave(seed: string, mode: "survival" | "builder" = "survival"): WorldSave {
  return {
    version: 2,
    generatorVersion: 18,
    generatorProfile: "world-below-v15",
    seed,
    mode,
    edits: {},
    player: { x: 0, y: 40.51, z: 0, yaw: 0, pitch: 0 },
    spawn: { x: 0, y: 40.51, z: 0 },
    inventory: [],
    selected: 0,
    health: 10,
    hunger: 10,
    xp: 0,
    level: 0,
    time: 0.32,
    day: 1,
    weather: "clear",
    furnaces: {},
    chests: {},
    savedAt: 1_000,
  };
}

function readyHost(config: RustWorldRuntimeHostConfigV1): RustWorldRuntimeManagedHostV1 {
  return {
    config,
    async start() {},
    async shutdown() {},
    multiplayerAuthority() { return {} as ReturnType<RustWorldRuntimeManagedHostV1["multiplayerAuthority"]>; },
    authorityInterest() { return {} as ReturnType<RustWorldRuntimeManagedHostV1["authorityInterest"]>; },
    runtimeAdapter() { return {} as ReturnType<RustWorldRuntimeManagedHostV1["runtimeAdapter"]>; },
    runtimeService() { return {} as ReturnType<RustWorldRuntimeManagedHostV1["runtimeService"]>; },
    nativePersistenceSession() { return null; },
    diagnostics() {
      return {
        state: "ready" as const,
        artifactHash: "a".repeat(64),
        contentHash: "b".repeat(32),
        generatorHash: config.generatorHash,
        identity: null,
        adapter: { authoritative: true, contentReady: true, contentManifestHash: "b".repeat(32) },
        lastError: null,
      };
    },
  };
}

class FakeManager {
  readonly configs: RustWorldRuntimeHostConfigV1[] = [];
  shutdowns = 0;
  gate: Deferred | null = null;
  failure: Error | null = null;
  host: RustWorldRuntimeManagedHostV1 | null = null;

  constructor(private readonly operations: string[] | null = null) {}

  async activate(config: RustWorldRuntimeHostConfigV1) {
    this.configs.push(config);
    await this.gate?.promise;
    if (this.failure) throw this.failure;
    this.host = readyHost(config);
    return this.host;
  }

  requireReady() {
    if (!this.host) throw new Error("not ready");
    return this.host;
  }

  async shutdown() {
    this.operations?.push("manager-shutdown");
    this.shutdowns += 1;
    this.host = null;
  }

  diagnostics() {
    return {
      state: this.host ? "ready" as const : "idle" as const,
      requestedGeneration: this.configs.length,
      activeGeneration: this.host ? this.configs.length : null,
      activeFingerprint: this.host ? "fixture" : null,
      host: this.host?.diagnostics() ?? null,
      lastError: this.failure?.message ?? null,
    };
  }
}

function harness(manager: FakeManager, hydrate: RustWorldHydrationHookV1 = async () => undefined) {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    rustRuntimeManager: manager,
    rustWorldHydration: hydrate,
    rustRuntimeHost: null,
    rustRuntimeOperationsBlocked: true,
    rustRuntimeTransitionGeneration: 0,
    rustOriginPreflightGeneration: 0,
    rustOriginPreflightAbort: null,
    rustRuntimeHydrationState: "none",
    rustRuntimeShutdown: null,
    rustPeerDeltaSequences: new Map(),
    rustPeerPresentationRecordRevisions: new Map(),
    rustAuthorityDeltaApplied: 0,
    rustAuthorityResyncs: 0,
    rustAuthorityRejections: 0,
    rustAuthorityLastStateHash: null,
    rustAuthorityLastError: null,
    disposed: false,
    running: false,
    paused: true,
    titleMode: true,
    persistent: false,
    activeWorldId: null,
    world: { seedText: "CUTOVER-SEED" },
    worldStorage: {
      activeWorldId: null,
      setActiveWorld: () => ({ ok: true as const, value: null }),
      deleteWorld: (id: string) => ({ ok: true as const, value: { id } }),
      loadWorld: (id: string) => ({ ok: false as const, error: {
        code: "not-found" as const,
        message: "That world does not exist on this device.",
        key: id,
      } }),
    },
    events: { onSave: () => undefined, onToast: () => undefined },
  });
  (engine as unknown as { prepareRustWorldTransition: () => Promise<void> }).prepareRustWorldTransition = async () => {
    engine.running = false;
    engine.paused = true;
    (engine as unknown as { rustRuntimeOperationsBlocked: boolean }).rustRuntimeOperationsBlocked = true;
  };
  return engine;
}

function primeRealWorldCreateState(engine: VoxelEngine & Record<string, unknown>) {
  const vector = () => ({
    x: 0,
    y: 0,
    z: 0,
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    },
    copy(other: Readonly<{ x: number; y: number; z: number }>) {
      return this.set(other.x, other.y, other.z);
    },
  });
  const world = {
    seedText: "TITLE-PREVIEW",
    terrainGenerationAuthority: { mode: "rust" as const },
    setRenderDistance() {},
    reset(seed: string) { this.seedText = seed; },
    resolveSettlementOrigin() { return null; },
    initializeAround() {},
    surfaceAt() { return 40; },
    setBlock() {},
  };
  const clearedCollections = [
    "tidemendSites", "legendaryEncounters", "primeEncounters", "legendaryResolutionConfirm",
    "multiplayerPlayerStates", "creatureTransferOffers", "multiplayerPlayerProgressions",
    "multiplayerProgressTransfers", "multiplayerPlayerWallets", "multiplayerPeerActiveMerchants",
    "rangedLoaded", "saplings", "veinRegrowth", "furnaces", "wheatMills", "chests",
    "acquiredLootUniqueIds", "contextualLootContainers", "roadEvents", "apiaries", "morphLooms",
    "orbRacks", "healingStations", "aquariums", "fieldPerches", "golemForges", "alchemyStands",
    "distilleries", "sugarworks", "archiveShelves", "tomeDisplays", "settlements", "merchants",
    "persistentMachineLastStep", "apiaryFlowerCache", "sleepVotes", "activatedStructureMarkers",
    "liquidCells", "mapSurfaceSurveyedThisSession", "cardforgeLastPackReveals",
  ] as const;
  const mutable = engine as unknown as Record<string, unknown>;
  for (const key of clearedCollections) mutable[key] = new Map();
  Object.assign(engine, {
    world,
    settings: { renderDistance: 6 },
    touchMode: false,
    localPlayerModel: { setVariant: () => undefined },
    playerVariant: "male",
    activeCharacterProfile: null,
    preparedRustNewWorld: null,
    terrainGenerationReadinessAbort: null,
    terrainLocatorConsumerAbort: new AbortController(),
    rustLivePlayerAuthorityRequestedR5: false,
    rustLivePlayerAuthorityProductionGate: false,
    rustLivePlayerAuthorityState: "none",
    rustTerrainLocatorEffectJournal: null,
    rustTerrainLocatorAppliedEffectIds: Object.freeze([]),
    multiplayerProgressOutgoing: [],
    weather: "clear",
    spawn: vector(),
    position: vector(),
    clearTemporaryMagicState: () => undefined,
    clearEntities: () => undefined,
    resetDynamicWeather: () => undefined,
    reconcileSystemQuests: () => undefined,
    emitHud: () => undefined,
    findSpawn: () => ({ x: 0, z: 0 }),
    localPlayerId: () => "local",
    serialize: () => storedWorldSave(world.seedText, engine.mode === "builder" ? "builder" : "survival"),
    prepareRustNewWorldTerrain: async (
      _generation: number,
      _controller: AbortController,
      seedText: string,
      options: unknown,
    ) => {
      world.seedText = seedText;
      mutable.preparedRustNewWorld = {
        seedText,
        optionsSignature: JSON.stringify(options),
        spawn: { x: 0, z: 0 },
        settlementOrigin: null,
      };
    },
  });
}

test("production creation stays blocked until its sole Rust host is ready", async () => {
  const manager = new FakeManager();
  manager.gate = deferred();
  const hydration: string[] = [];
  const engine = harness(manager, async ({ kind, worldId }) => { hydration.push(`${kind}:${worldId}`); });
  (engine as unknown as { createWorld: () => { id: string; generationIdentity: typeof GENERATION_IDENTITY } }).createWorld = () => ({ id: "world-cutover-a", generationIdentity: GENERATION_IDENTITY });

  const pending = engine.createWorldWithRustRuntime("CUTOVER-SEED", "survival");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(engine.running, false);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, true);
  manager.gate.resolve();

  const created = await pending;
  assert.equal(created.id, "world-cutover-a");
  assert.equal(engine.running, true);
  assert.equal(engine.getRustRuntimeDiagnostics().ready, true);
  assert.deepEqual(hydration, ["create:world-cutover-a"]);
  assert.equal(manager.configs[0].universeId, "world:world-cutover-a");
});

test("activation and hydration failures leave gameplay closed and stop the candidate", async () => {
  const manager = new FakeManager();
  manager.failure = new Error("artifact attestation failed");
  const engine = harness(manager);
  (engine as unknown as { createWorld: () => { id: string; generationIdentity: typeof GENERATION_IDENTITY } }).createWorld = () => ({ id: "world-cutover-b", generationIdentity: GENERATION_IDENTITY });
  await assert.rejects(engine.createWorldWithRustRuntime("CUTOVER-SEED", "builder"), /attestation failed/u);
  assert.equal(engine.running, false);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "blocked");
  assert.equal(manager.shutdowns, 1);

  manager.failure = null;
  (engine as unknown as { rustWorldHydration: RustWorldHydrationHookV1 }).rustWorldHydration = async () => { throw new Error("rich save unsupported"); };
  await assert.rejects(engine.loadWorldWithRustRuntime({ seed: "CUTOVER-SEED" } as WorldSave, {}, "world-cutover-b"), /rich save unsupported/u);
  assert.equal(manager.shutdowns, 2);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, true);
});

test("failed native new-world hydration drains the candidate before restoring the exact browser selection", async () => {
  const operations: string[] = [];
  const ids = ["prior-world", "newer-world", "provisional-world"];
  const storage = new TrackingWorldStorage(new MemoryStorage(), operations, () => ids.shift() ?? "unexpected-world");
  const prior = storage.createWorld({ name: "Prior World", save: storedWorldSave("PRIOR-SEED") });
  assert.equal(prior.ok, true);
  if (!prior.ok) return;
  const newer = storage.createWorld({ name: "Newer World", save: storedWorldSave("NEWER-SEED") });
  assert.equal(newer.ok, true);
  if (!newer.ok) return;
  assert.equal(storage.setActiveWorld(prior.value.id).ok, true);
  operations.length = 0;

  const manager = new FakeManager(operations);
  const nativeWorldId = "world:provisional-world@overworld";
  const nativeSession = {
    worldId: nativeWorldId,
    async initializeNewWorld() {
      operations.push("native-initialize");
      return {
        worldId: nativeWorldId,
        saveId: "native-save",
        checkpointId: "native-checkpoint",
        checkpointHash: "1".repeat(32),
        journalSequence: 1,
        records: 1,
        commits: 1,
        requestBytes: 1,
        responseBytes: 1,
      };
    },
    async recoverAndHydrate() { return { status: "empty" as const, worldId: nativeWorldId }; },
    async saveNative() { throw new Error("not used"); },
    async flush() {},
    async shutdown() { operations.push("native-session-shutdown"); },
  } as unknown as RustNativeWorldPersistenceSessionV1;
  const engine = harness(manager, async ({ worldId }) => {
    assert.equal(storage.bindNativePersistence(worldId, nativeSession).ok, true);
    (engine as unknown as { rustNativePersistenceWorldId: string }).rustNativePersistenceWorldId = worldId;
    assert.equal((await storage.initializeNativeWorld(worldId)).ok, true);
    throw new Error("native hydration rejected");
  });
  primeRealWorldCreateState(engine);
  assert.equal(Object.hasOwn(engine, "createWorld"), false, "the regression must exercise the inherited production allocator");
  Object.assign(engine, {
    worldStorage: storage,
    activeWorldId: prior.value.id,
    persistent: false,
    titleMode: true,
    events: {
      onSave: () => operations.push(`save-event:${engine.activeWorldId ?? "none"}`),
      onToast: () => undefined,
    },
  });

  await assert.rejects(
    engine.createWorldWithRustRuntime("PROVISIONAL-SEED", "survival", {}, "Provisional World"),
    /native hydration rejected/u,
  );

  assert.equal(storage.activeWorldId, prior.value.id);
  assert.deepEqual(storage.listWorlds().map((world) => world.id).sort(), [newer.value.id, prior.value.id].sort());
  assert.equal(storage.loadWorld("provisional-world", false).ok, false);
  assert.equal(engine.activeWorldId, prior.value.id);
  assert.equal((engine as unknown as { persistent: boolean }).persistent, false);
  assert.equal((engine as unknown as { titleMode: boolean }).titleMode, true);
  assert.equal(engine.running, false);
  assert.equal(engine.paused, true);
  assert.equal(engine.getRustRuntimeDiagnostics().nativePersistenceWorldId, null);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, true);
  assert.equal(manager.shutdowns, 1);
  assert.deepEqual(operations, [
    "catalog-active:provisional-world",
    "save-event:provisional-world",
    "native-initialize",
    "native-shutdown-start",
    "native-session-shutdown",
    "native-shutdown-complete",
    "manager-shutdown",
    "catalog-active:prior-world",
    "catalog-delete:provisional-world",
    "save-event:prior-world",
  ]);
  assert.equal(storage.bindNativePersistence(prior.value.id, nativeSession).ok, true, "candidate shutdown must release the native binding");
  await storage.shutdownNativePersistence();
});

test("switching worlds derives distinct durable universes and sessions before opening the mirror", async () => {
  const manager = new FakeManager();
  const hydrated: string[] = [];
  const engine = harness(manager, async ({ kind, worldId }) => { hydrated.push(`${kind}:${worldId}`); });
  (engine as unknown as { createWorld: () => { id: string; generationIdentity: typeof GENERATION_IDENTITY } }).createWorld = () => ({ id: "world-first", generationIdentity: GENERATION_IDENTITY });
  (engine as unknown as { loadWorld: (save: WorldSave, options: unknown, id: string) => void }).loadWorld = (_save, _options, id) => {
    engine.activeWorldId = id;
    engine.running = true;
    engine.paused = false;
  };

  await engine.createWorldWithRustRuntime("SAME-SEED", "survival");
  await engine.loadWorldWithRustRuntime({ seed: "SAME-SEED" } as WorldSave, {}, "world-second");
  assert.deepEqual(manager.configs.map((entry) => entry.universeId), ["world:world-first", "world:world-second"]);
  assert.notEqual(manager.configs[0].sessionId, manager.configs[1].sessionId);
  assert.deepEqual(hydrated, ["create:world-first", "load:world-second"]);
  assert.equal(engine.activeWorldId, "world-second");
});

test("Rust settlement-origin miss preserves the active generation, transition, and storage", async () => {
  const manager = new FakeManager();
  const engine = harness(manager);
  let transitioned = 0;
  let stored = 0;
  Object.assign(engine.world, {
    terrainGenerationAuthority: { mode: "rust" },
    async queryNearestSettlementsForGenerationAuthoritative() { return { entries: [] }; },
  });
  (engine as unknown as { prepareRustWorldTransition(): Promise<void> }).prepareRustWorldTransition = async () => { transitioned += 1; };
  (engine as unknown as { createWorld(): unknown }).createWorld = () => { stored += 1; return null; };
  await assert.rejects(engine.createWorldWithRustRuntime("STRICT-ORIGIN", "survival", {
    origin: { mode: "near-any-settlement" },
  }), /found no materializable starting settlement/u);
  assert.equal(transitioned, 0);
  assert.equal(stored, 0);
  assert.equal(manager.configs.length, 0);
  assert.equal((engine as unknown as { rustRuntimeTransitionGeneration: number }).rustRuntimeTransitionGeneration, 0);
});

test("Rust settlement-origin preparation requires the exact marker key and authoritative center Y", async () => {
  const entry = Object.freeze({
    id: "freehold-origin", factionId: "hobbits" as const, size: "village" as const,
    environment: "surface" as const, biome: "flower-meadow" as const,
    regionX: 0, regionZ: 0, x: 16, z: 32, floorY: null,
    distanceSquaredMillis: BigInt(1),
    publicArrival: Object.freeze({ x: 20, yMillis: 42_510, z: 34, anchorKind: "public-approach" }),
  });
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const marker = { type: "landmark" as const, id: entry.id, position: { x: 16, y: 42, z: 32 }, tag: "settlement:hobbits:village", mapLayer: "surface" as const };
  Object.assign(engine, {
    rustRuntimeTransitionGeneration: 4,
    disposed: false,
    settings: { renderDistance: 3 },
    world: {
      setRenderDistance() {}, reset() {}, initializeAround() {},
      async awaitGenerationRing() { return { mode: "rust", keys: ["1,2"] }; },
      settlementLandmarkMarker() { return marker; },
      installedColumn() { return { height: 40, biome: BiomeId.Meadow, waterline: 32 }; },
    },
  });
  const prepare = (engine as unknown as {
    prepareRustNewWorldTerrain(g: number, c: AbortController, s: string, o: unknown, origin: typeof entry): Promise<void>;
  }).prepareRustNewWorldTerrain.bind(engine);
  await prepare(4, new AbortController(), "ATTESTED-ORIGIN", {}, entry);
  assert.equal((engine as unknown as { preparedRustNewWorld: { settlementOrigin: { markerY: number } } }).preparedRustNewWorld.settlementOrigin.markerY, 42);
  marker.position.y = 41;
  await assert.rejects(prepare(4, new AbortController(), "ATTESTED-ORIGIN", {}, entry), /marker mismatch/u);
});

test("safe Rust spawn requires installed solid ground and two-cell headroom", () => {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  world.reset("SAFE-SPAWN-BYTES", undefined, { structures: false });
  const chunk = world.generateChunk(0, 0);
  chunk.blocks.fill(BlockId.Air);
  chunk.heightmap.fill(40);
  chunk.biomes.fill(BiomeId.Meadow);
  for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) {
    chunk.blocks[x + z * CHUNK_SIZE + (40 - MIN_Y) * CHUNK_SIZE * CHUNK_SIZE] = BlockId.Stone;
    chunk.blocks[x + z * CHUNK_SIZE + (41 - MIN_Y) * CHUNK_SIZE * CHUNK_SIZE] = BlockId.Stone;
  }
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  Object.assign(engine, { world });
  const select = (engine as unknown as { findSpawnInLoadedTerrain(keys: readonly string[]): Readonly<{ x: number; z: number }> | null })
    .findSpawnInLoadedTerrain.bind(engine);
  assert.equal(select(["0,0"]), null, "blocked headroom must never be accepted as a high-terrain fallback");
  const safeColumn = 2 + 2 * CHUNK_SIZE;
  chunk.blocks[safeColumn + (41 - MIN_Y) * CHUNK_SIZE * CHUNK_SIZE] = BlockId.Air;
  chunk.blocks[safeColumn + (42 - MIN_Y) * CHUNK_SIZE * CHUNK_SIZE] = BlockId.Air;
  assert.deepEqual(select(["0,0"]), { x: 2, z: 2 });
  world.dispose();
});

test("new-world Rust spawn expansion is deterministic, bounded, and terminal when no safe site exists", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const radii: number[] = [];
  Object.assign(engine, {
    rustRuntimeTransitionGeneration: 7,
    disposed: false,
    settings: { renderDistance: 3 },
    world: {
      setRenderDistance() {},
      reset() {},
      initializeAround() {},
      async awaitGenerationRing(_x: number, _z: number, radius: number) {
        radii.push(radius);
        return { mode: "rust", keys: [`radius-${radius}`] };
      },
    },
  });
  let attempts = 0;
  (engine as unknown as { findSpawnInLoadedTerrain(keys: readonly string[]): Readonly<{ x: number; z: number }> | null }).findSpawnInLoadedTerrain = () => (
    ++attempts === 2 ? { x: 32, z: -16 } : null
  );
  await (engine as unknown as { prepareRustNewWorldTerrain(g: number, c: AbortController, s: string, o: unknown): Promise<void> })
    .prepareRustNewWorldTerrain(7, new AbortController(), "BOUND-SPAWN", {});
  assert.deepEqual(radii, [1, 2, 1], "the selected spawn receives its own exact 3x3 readiness ring");

  radii.length = 0;
  (engine as unknown as { findSpawnInLoadedTerrain(keys: readonly string[]): null }).findSpawnInLoadedTerrain = () => null;
  await assert.rejects(
    (engine as unknown as { prepareRustNewWorldTerrain(g: number, c: AbortController, s: string, o: unknown): Promise<void> })
      .prepareRustNewWorldTerrain(7, new AbortController(), "NO-SPAWN", {}),
    /within 6 chunk rings/u,
  );
  assert.deepEqual(radii, [1, 2, 3, 4, 5, 6]);
});

test("saved load orders native hydrate, certified ring, mirror, then player/composer and blocks failure", async () => {
  const calls: string[] = [];
  const manager = new FakeManager();
  const ringGate = deferred();
  const engine = harness(manager, async () => { calls.push("native-hydrate"); });
  Object.assign(engine.world, { terrainGenerationAuthority: { mode: "rust" } });
  (engine as unknown as { prepareRustLoadedWorldTerrain(): Promise<void> }).prepareRustLoadedWorldTerrain = async () => {
    calls.push("ring-start");
    await ringGate.promise;
    calls.push("ring-installed");
  };
  (engine as unknown as { loadWorld(): void }).loadWorld = () => { calls.push("mirror-finalized"); };
  (engine as unknown as { finalizeRustWorldRuntime(): Promise<void> }).finalizeRustWorldRuntime = async () => { calls.push("player-composer"); };
  const pending = engine.loadWorldWithRustRuntime({ seed: "ORDERED-LOAD", player: { x: 0, y: 48, z: 0 } } as WorldSave, {}, "ordered-world");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["native-hydrate", "ring-start"]);
  assert.equal(engine.running, false);
  assert.equal(engine.paused, true);
  ringGate.resolve();
  await pending;
  assert.deepEqual(calls, ["native-hydrate", "ring-start", "ring-installed", "mirror-finalized", "player-composer"]);

  calls.length = 0;
  (engine as unknown as { prepareRustLoadedWorldTerrain(): Promise<void> }).prepareRustLoadedWorldTerrain = async () => { throw new Error("ring unavailable"); };
  await assert.rejects(engine.loadWorldWithRustRuntime({ seed: "FAILED-RING", player: { x: 0, y: 48, z: 0 } } as WorldSave, {}, "failed-world"), /ring unavailable/u);
  assert.equal(calls.includes("player-composer"), false);
  assert.equal(engine.running, false);
  assert.equal(engine.paused, true);
});

test("default mixed mode skips experimental player/composer while explicit R5 remains strict", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const host = { diagnostics: () => ({ state: "ready" as const }) } as RustWorldRuntimeManagedHostV1;
  const calls: string[] = [];
  Object.assign(engine, {
    rustRuntimeTransitionGeneration: 4,
    rustRuntimeHost: host,
    disposed: false,
    rustLivePlayerAuthorityRequestedR5: false,
    rustLivePlayerAuthorityProductionGate: false,
    rustLivePlayerAuthorityState: "none",
    rustTerrainLocatorEffectJournal: null,
    rustLivePlayerAuthorityActivation: async () => { calls.push("player"); },
    activateRustLiveRendererR10: async () => { calls.push("composer"); },
    rustLiveInputPump: {},
    checkpointRustLivePlayerNative: async () => { calls.push("checkpoint"); },
    trackRustAuthorityOperation: async <T>(operation: Promise<T>) => operation,
  });
  await (engine as unknown as {
    finalizeRustWorldRuntime(generation: number, kind: "create", save: null, host: RustWorldRuntimeManagedHostV1): Promise<void>;
  }).finalizeRustWorldRuntime(4, "create", null, host);
  assert.equal(calls.length, 0);
  assert.equal((engine as unknown as { rustLivePlayerAuthorityState: string }).rustLivePlayerAuthorityState, "none");

  Object.assign(engine, {
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityActivation: async () => {
      calls.push("player");
      (engine as unknown as { rustLivePlayerAuthorityState: string }).rustLivePlayerAuthorityState = "ready";
    },
  });
  await (engine as unknown as {
    finalizeRustWorldRuntime(generation: number, kind: "create", save: null, host: RustWorldRuntimeManagedHostV1): Promise<void>;
  }).finalizeRustWorldRuntime(4, "create", null, host);
  assert.deepEqual(calls, ["player", "checkpoint", "composer"]);

  calls.length = 0;
  Object.assign(engine, {
    rustLivePlayerAuthorityState: "none",
    rustLivePlayerAuthorityActivation: async () => { calls.push("player"); throw new Error("capability unavailable"); },
  });
  await assert.rejects((engine as unknown as {
    finalizeRustWorldRuntime(generation: number, kind: "create", save: null, host: RustWorldRuntimeManagedHostV1): Promise<void>;
  }).finalizeRustWorldRuntime(4, "create", null, host), /capability unavailable/u);
  assert.deepEqual(calls, ["player"]);
});

test("default mixed mode refuses a native locator journal instead of reinterpreting custody", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const host = { diagnostics: () => ({ state: "ready" as const }) } as RustWorldRuntimeManagedHostV1;
  Object.assign(engine, {
    rustRuntimeTransitionGeneration: 2,
    rustRuntimeHost: host,
    disposed: false,
    rustLivePlayerAuthorityRequestedR5: false,
    rustLivePlayerAuthorityProductionGate: false,
    rustLivePlayerAuthorityState: "none",
    rustTerrainLocatorEffectJournal: { phase: "prepared" },
  });
  await assert.rejects((engine as unknown as {
    finalizeRustWorldRuntime(generation: number, kind: "load", save: null, host: RustWorldRuntimeManagedHostV1): Promise<void>;
  }).finalizeRustWorldRuntime(2, "load", null, host), /Re-enable experimental Rust player authority/u);
});

test("bound native custody saves the browser document locally and schedules an explicit checkpoint in both modes", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout: () => undefined,
      localStorage: { removeItem: () => undefined, setItem: () => undefined },
    },
    writable: true,
  });
  try {
    const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
    let scheduled = 0;
    let localOnly = 0;
    let pumpCheckpoints = 0;
    Object.assign(engine, {
      persistent: true,
      activeWorldId: "world:mixed-save",
      rustNativePersistenceWorldId: "world:mixed-save",
      rustTerrainLocatorEffectJournal: null,
      rustLivePlayerAuthorityRequestedR5: false,
      rustLivePlayerAuthorityState: "ready",
      rustLiveInputPump: { diagnostics: () => Object.freeze({}) },
      saveTimer: 0,
      autoSaveIdleHandle: 0,
      autoSaveUsesIdleCallback: false,
      fallingTrees: [],
      worldSessionStartedAt: Date.now(),
      serialize: () => ({ seed: "MIXED-SAVE" }),
      scheduleRustNativeSaveCheckpoint: () => { pumpCheckpoints += 1; },
      worldStorage: {
        saveWorld: () => {
          scheduled += 1;
          return { ok: true as const, value: { id: "world:mixed-save" } };
        },
        saveWorldLocalOnly: () => {
          localOnly += 1;
          return { ok: true as const, value: { id: "world:mixed-save" } };
        },
      },
      events: { onSave: () => undefined, onToast: () => undefined },
    });
    engine.saveNow(false);
    assert.deepEqual({ scheduled, localOnly, pumpCheckpoints }, { scheduled: 0, localOnly: 1, pumpCheckpoints: 1 });

    (engine as unknown as { rustLivePlayerAuthorityRequestedR5: boolean }).rustLivePlayerAuthorityRequestedR5 = true;
    engine.saveNow(false);
    assert.deepEqual({ scheduled, localOnly, pumpCheckpoints }, { scheduled: 0, localOnly: 2, pumpCheckpoints: 2 });
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow, writable: true });
  }
});

test("failed active-world catalog commits remain failures even when a legacy backup can be written", () => {
  const previousWindow = globalThis.window;
  let legacyBackups = 0;
  let saveEvents = 0;
  const toasts: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout: () => undefined,
      localStorage: {
        removeItem: () => undefined,
        setItem: () => { legacyBackups += 1; },
      },
    },
    writable: true,
  });
  try {
    const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
    Object.assign(engine, {
      persistent: true,
      activeWorldId: "world:catalog-save-failure",
      rustNativePersistenceWorldId: null,
      rustTerrainLocatorEffectJournal: null,
      rustLivePlayerAuthorityRequestedR5: false,
      saveTimer: 0,
      autoSaveIdleHandle: 0,
      autoSaveUsesIdleCallback: false,
      fallingTrees: [],
      worldSessionStartedAt: Date.now(),
      serialize: () => ({ seed: "CATALOG-SAVE-FAILURE" }),
      worldStorage: {
        saveWorld: () => ({ ok: false as const, error: { message: "catalog transaction rejected" } }),
      },
      events: {
        onSave: () => { saveEvents += 1; },
        onToast: (message: string) => { toasts.push(message); },
      },
    });

    assert.equal(engine.saveNow(true), false);
    assert.equal(legacyBackups, 1, "the legacy key remains a manual recovery copy only");
    assert.equal(saveEvents, 0, "a failed catalog commit must never emit an authoritative save event");
    assert.deepEqual(toasts, ["catalog transaction rejected"]);
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow, writable: true });
  }
});

test("prepared locator recovery runs inside player activation before residency or the first fixed step", () => {
  const source = readFileSync(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  const activation = source.match(/private async activateRustLivePlayerAuthorityR5\([\s\S]*?private async stopRustLivePlayerAuthorityR5/u)?.[0] ?? "";
  const recovery = activation.indexOf("recoverRustTerrainLocatorBeforeResidencyR5");
  const residency = activation.indexOf("terrain.reconcile");
  const initialFixedStep = activation.indexOf("pump.syncInitial");
  assert.ok(recovery >= 0 && residency > recovery && initialFixedStep > residency);

  const finalizer = source.match(/private async finalizeRustWorldRuntime\([\s\S]*?private async cleanupFailedRustWorldRuntime/u)?.[0] ?? "";
  const player = finalizer.indexOf("rustLivePlayerAuthorityActivation");
  const journalGuard = finalizer.indexOf("if (this.rustTerrainLocatorEffectJournal)");
  const renderer = finalizer.indexOf("activateRustLiveRendererR10");
  assert.ok(player >= 0 && journalGuard > player && renderer > journalGuard);
  assert.doesNotMatch(finalizer, /recoverPreparedRustTerrainLocatorEffect/u);
  assert.match(finalizer, /if \(this\.rustTerrainLocatorEffectJournal\) \{[\s\S]*throw new Error\(recovery\);/u);

  const transition = source.match(/private async prepareRustWorldTransition\([\s\S]*?private async activateRustWorldRuntime/u)?.[0] ?? "";
  assert.ok(transition.indexOf("drainRustAuthorityOperations") < transition.indexOf("stopRustLivePlayerAuthorityR5"));
  assert.match(transition, /if \(!this\.saveNow\(false, preserveMultiplayerSession\)\)/u);
  assert.match(transition, /const checkpointAttestation = nativeCheckpoint \? await nativeCheckpoint : null/u);
  assert.equal(
    source.match(/if \(error instanceof RustWorldTransitionPreflightError\) throw error\.failure/gu)?.length,
    3,
    "create and both load wrappers must preserve the old live runtime on a failed transition preflight",
  );
  assert.match(source, /await this\.prepareRustWorldTransition\("world-create"\);\s*const generation = \+\+this\.rustRuntimeTransitionGeneration/u);
  assert.match(source, /await this\.prepareRustWorldTransition\("world-load"\);\s*const generation = \+\+this\.rustRuntimeTransitionGeneration/u);
});

test("browser entry points bind host and guest Rust authority and never call synchronous world paths", () => {
  const engineSource = readFileSync(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../app/game/VoxelGame.tsx", import.meta.url), "utf8");
  assert.match(engineSource, /bindReadyRustMultiplayerRuntimeV2\([\s\S]*sessionId: binding\.descriptor\.runtimeSessionId/u);
  assert.match(engineSource, /guestAuthorityFactory: this\.guestRustAuthorityFactory\(\)/u);
  assert.match(engineSource, /createRustMultiplayerGuestAuthorityFactoryV2\(\{/u);
  assert.match(engineSource, /async submitAgentCommand\([\s\S]*pendingAgentCommandReceipts/u);
  assert.match(shellSource, /await engine\.createWorldWithRustRuntime/u);
  assert.match(shellSource, /await engine\.loadStoredWorldWithRustRuntime\(worldId\)/u);
  assert.doesNotMatch(shellSource, /const created = engine\.createWorld\(/u);
  assert.doesNotMatch(shellSource, /engine\.loadWorld\(loaded\.value/u);
  assert.doesNotMatch(shellSource, /storage\.loadWorldAsync\(worldId\)/u);
  assert.doesNotMatch(shellSource, /engine\.worldStorage\.dispose\(\)/u);
  assert.doesNotMatch(shellSource, /engine\.worldStorage\s*=\s*storage/u);
});

test("shutdown drains authority before save and generation teardown, then closes native and browser resources", async () => {
  const calls: string[] = [];
  const manager = new FakeManager();
  const engine = harness(manager);
  Object.assign(engine, {
    animationFrame: 0,
    clearInput: () => calls.push("block"),
    unbindEvents: () => calls.push("unbind"),
    saveNow: () => { calls.push("save"); return true; },
    worldStorage: {
      flushPersistence: async () => { calls.push("flush"); },
      shutdownNativePersistence: async () => { calls.push("native"); },
    },
    disconnectMultiplayer: async () => { calls.push("multiplayer"); },
    drainRustAuthorityOperations: async () => { calls.push("authority"); },
    disposeBrowserResources: () => { calls.push("resources"); },
  });
  manager.shutdown = async () => { calls.push("manager"); };
  const priorCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => undefined;
  try { await engine.shutdown(); }
  finally { globalThis.cancelAnimationFrame = priorCancel; }
  assert.deepEqual(calls, [
    "block", "unbind",
    // Settlement drains before admission is blocked; shutdown then drains the
    // post-block tail before beginning the browser/native save sequence.
    "authority", "authority", "save", "authority", "flush", "multiplayer", "authority",
    "native", "manager", "resources",
  ]);
});
