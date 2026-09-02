import assert from "node:assert/strict";
import test from "node:test";
import type { WorldSave } from "../app/game/engine.ts";
import { DEFAULT_WORLD_GENERATION_OPTIONS, GENERATOR_VERSION } from "../app/game/world.ts";
import { MemoryPersistenceAdapterV1 } from "../app/game/indexeddb-persistence-adapter.ts";
import { WorldPersistenceCoordinatorV1 } from "../app/game/world-persistence-coordinator.ts";
import type { RustNativeWorldPersistenceSessionV1 } from "../app/game/rust-native-world-persistence.ts";
import {
  LEGACY_TERRAIN_CONTENT_HASH_V2,
  legacyTerrainGeneratorHashV2,
} from "../app/game/terrain-generation-contract.ts";
import {
  DEFAULT_WORLD_OPTIONS,
  LEGACY_WORLD_KEY,
  WORLD_CATALOG_KEY,
  WORLD_DATA_PREFIX,
  WORLD_GENERATION_IDENTITY_SCHEMA_V1,
  WORLD_OWNERSHIP,
  WorldStorage,
  canonicalWorldGenerationOptionsJsonV1,
  deriveWorldGenerationIdentityV1,
  generationOptionsFromWorldOptions,
  migrateLegacyWorldSave,
  normalizeWorldOptions,
  requiredSleepers,
} from "../app/game/world-storage.ts";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly failingKeys = new Set<string>();
  readonly getItemCalls = new Map<string, number>();
  failAllWrites = false;

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) {
    this.getItemCalls.set(key, (this.getItemCalls.get(key) ?? 0) + 1);
    return this.values.get(key) ?? null;
  }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    if (this.failAllWrites || this.failingKeys.has(key)) throw new DOMException("Storage quota reached", "QuotaExceededError");
    this.values.set(key, String(value));
  }
}

class MemoryStorageEvents {
  private readonly listeners = new Set<(event: StorageEvent) => void>();

  addEventListener(_type: "storage", listener: (event: StorageEvent) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "storage", listener: (event: StorageEvent) => void) {
    this.listeners.delete(listener);
  }

  dispatch(storage: Storage, key: string | null) {
    const event = { key, storageArea: storage } as StorageEvent;
    for (const listener of this.listeners) listener(event);
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

class TrackingWorldPersistenceCoordinatorV1 extends WorldPersistenceCoordinatorV1 {
  readonly persistedSeeds: string[] = [];

  constructor() {
    super(new MemoryPersistenceAdapterV1(), () => 1_000);
  }

  override persistWorld(worldId: string, worldSave: WorldSave) {
    this.persistedSeeds.push(worldSave.seed);
    return super.persistWorld(worldId, worldSave);
  }
}

function nativePersistenceFixture(worldId: string, recovery: "hydrated" | "empty" | "migrated" = "hydrated") {
  const operations: string[] = [];
  let migrated = recovery === "migrated";
  const saved = Object.freeze({
    worldId: `universe:${worldId}@overworld`, saveId: "native.save.fixture", checkpointId: "checkpoint:fixture",
    checkpointHash: "1".repeat(32), journalSequence: 1, records: 5, commits: 5, requestBytes: 50, responseBytes: 60,
  });
  const session = {
    worldId: saved.worldId,
    async initializeNewWorld(createdAt: number) { operations.push(`initialize:${createdAt}`); return saved; },
    async recoverAndHydrate(proof?: Readonly<{
      plan: Readonly<{ sourceSemanticHash: string; projection: Readonly<{ projectionHash: string }> }>;
      canonicalSource: Uint8Array;
    }>) {
      operations.push(proof ? "hydrate:proof" : "hydrate");
      if (recovery === "empty" && !migrated) {
        return Object.freeze({ status: "empty" as const, worldId: saved.worldId });
      }
      if (migrated && !proof) return Object.freeze({
        status: "hydrated" as const,
        worldId: saved.worldId,
        checkpointId: saved.checkpointId,
        fallbackDepth: 0,
        nativeDomains: 6,
        checkpointRecords: 9,
        compatibility: null,
        migration: Object.freeze({ descriptorHash: "2".repeat(32) }),
      });
      return proof
        ? Object.freeze({
          status: "hydrated" as const,
          worldId: saved.worldId,
          checkpointId: saved.checkpointId,
          fallbackDepth: 0,
          nativeDomains: 6,
          checkpointRecords: 9,
          compatibility: Object.freeze({
            sourceSemanticHash: proof.plan.sourceSemanticHash,
            chunks: 1,
            bytes: proof.canonicalSource.byteLength,
          }),
          migration: Object.freeze({ descriptorHash: "2".repeat(32) }),
        })
        : Object.freeze({ status: "hydrated" as const, worldId: saved.worldId, checkpointId: saved.checkpointId, fallbackDepth: 0, nativeDomains: 5, checkpointRecords: 5 });
    },
    async migrateLegacyWorldOnly(
      _plan: unknown,
      source: Uint8Array,
      createdAt: number,
      identity: Readonly<{ sourceKey: string; sourceFormat: string }>,
    ) {
      operations.push(`migrate:${createdAt}:${identity.sourceKey}:${identity.sourceFormat}:${source.byteLength}`);
      migrated = true;
      return Object.freeze({ status: "migrated" as const });
    },
    async saveNative(createdAt: number) { operations.push(`save:${createdAt}`); return saved; },
    async flush() { operations.push("flush"); },
    async shutdown() { operations.push("shutdown"); },
  } as unknown as RustNativeWorldPersistenceSessionV1;
  return { session, operations };
}

test("WorldStorage binds native create/load/save execution and keeps compatibility-only loads fail-closed", async () => {
  const storage = new MemoryStorage();
  let now = 7_000;
  const worlds = new WorldStorage(storage, { now: () => now, idFactory: () => "native-world", persistenceCoordinator: null });
  const created = worlds.createWorld({ name: "Native World", save: save("NATIVE") });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const native = nativePersistenceFixture(created.value.id);
  assert.equal(worlds.bindNativePersistence(created.value.id, native.session).ok, true);
  assert.equal((await worlds.initializeNativeWorld(created.value.id, now)).ok, true);
  assert.equal((await worlds.hydrateNativeWorld(created.value.id)).ok, true);
  assert.equal((await worlds.saveNativeWorld(created.value.id, now + 1)).ok, true);

  now += 2;
  assert.equal(worlds.saveWorld(created.value.id, { save: save("NATIVE-AUTOSAVE") }).ok, true);
  await worlds.flushPersistence();
  assert.deepEqual(native.operations, ["initialize:7000", "hydrate", "save:7001", "save:7002", "flush"]);
  await worlds.shutdownNativePersistence();
  assert.equal(native.operations.at(-1), "shutdown");
  assert.equal((await worlds.saveNativeWorld(created.value.id)).ok, false, "shutdown unbinds the sole native authority session");

  const compatibilityOnly = nativePersistenceFixture(created.value.id, "empty");
  assert.equal(worlds.bindNativePersistence(created.value.id, compatibilityOnly.session).ok, true);
  const blocked = await worlds.hydrateNativeWorld(created.value.id);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error.message, /not eligible for world-only native migration/u);
  await worlds.shutdownNativePersistence();
});

test("WorldStorage migrates an eligible world-only source and a fresh session reopens its durable proof", async () => {
  const storage = new MemoryStorage();
  const creator = new WorldStorage(storage, {
    now: () => 99_999,
    idFactory: () => "legacy-world-only",
    persistenceCoordinator: null,
  });
  const created = creator.createWorld({ save: save("WORLD-ONLY") });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const key = `${WORLD_DATA_PREFIX}${created.value.id}`;
  const stored = JSON.parse(storage.getItem(key)!);
  stored.save = {
    version: 2,
    generatorVersion: GENERATOR_VERSION,
    generatorProfile: "world-below-v15",
    lastSavedGameVersion: "1.12.0",
    seed: "WORLD-ONLY",
    savedAt: 900,
    edits: { "0,0": [[17, 3]] },
    blockFacings: { "1,-64,1": 2 },
  };
  const protectedDocument = JSON.stringify(stored);
  storage.setItem(key, protectedDocument);
  const catalog = JSON.parse(storage.getItem(WORLD_CATALOG_KEY)!);
  catalog.worlds[0].generationIdentity = null;
  storage.setItem(WORLD_CATALOG_KEY, JSON.stringify(catalog));
  creator.dispose();
  const worlds = new WorldStorage(storage, {
    now: () => 99_999,
    idFactory: () => "unused",
    persistenceCoordinator: null,
  });
  const preflight = worlds.prepareNativeLegacyWorldMigration(created.value.id);
  assert.equal(preflight.ok, true);
  assert.equal(storage.getItem(key), protectedDocument, "read-only preflight must not rewrite the protected source");
  assert.equal(worlds.listWorlds()[0]?.generationIdentity, null, "read-only preflight must not promote the catalog");

  const first = nativePersistenceFixture(created.value.id, "empty");
  assert.equal(worlds.bindNativePersistence(created.value.id, first.session).ok, true);
  const migrated = await worlds.hydrateNativeWorld(created.value.id);
  assert.equal(migrated.ok, true);
  if (!migrated.ok) return;
  assert.equal(migrated.value.status, "hydrated");
  assert.equal(first.operations[0], "hydrate");
  assert.match(first.operations[1], new RegExp(`^migrate:900:${key}:blockwild-world-save-canonical-v1:`));
  assert.equal(first.operations[2], "hydrate:proof");
  assert.equal(storage.getItem(key), protectedDocument, "successful promotion must keep protected document bytes exact");
  assert.deepEqual(
    worlds.listWorlds()[0]?.generationIdentity,
    preflight.ok ? preflight.value.generationIdentity : null,
    "catalog identity is promoted only after fresh native semantic attestation",
  );
  worlds.unbindNativePersistence(first.session);

  const restarted = nativePersistenceFixture(created.value.id, "migrated");
  assert.equal(worlds.bindNativePersistence(created.value.id, restarted.session).ok, true);
  const reopened = await worlds.hydrateNativeWorld(created.value.id);
  assert.equal(reopened.ok, true);
  assert.deepEqual(
    restarted.operations,
    ["hydrate"],
    "a new session trusts the Rust-owned descriptor after catalog promotion and never dispatches a second migration",
  );
});

test("legacy migration catalog promotion is atomic and retry-safe after native attestation", async () => {
  const storage = new MemoryStorage();
  const creator = new WorldStorage(storage, {
    now: () => 44_000,
    idFactory: () => "legacy-promotion-retry",
    persistenceCoordinator: null,
  });
  const created = creator.createWorld({ save: save("PROMOTION-RETRY") });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const key = `${WORLD_DATA_PREFIX}${created.value.id}`;
  const stored = JSON.parse(storage.getItem(key)!);
  stored.save = {
    version: 2,
    generatorVersion: GENERATOR_VERSION,
    generatorProfile: "world-below-v15",
    lastSavedGameVersion: "1.12.0",
    seed: "PROMOTION-RETRY",
    savedAt: 901,
    edits: { "0,0": [[17, 3]] },
    blockFacings: { "1,-64,1": 2 },
  };
  const protectedDocument = JSON.stringify(stored);
  storage.setItem(key, protectedDocument);
  const catalog = JSON.parse(storage.getItem(WORLD_CATALOG_KEY)!);
  catalog.worlds[0].generationIdentity = null;
  const nullCatalog = JSON.stringify(catalog);
  storage.setItem(WORLD_CATALOG_KEY, nullCatalog);
  creator.dispose();

  const worlds = new WorldStorage(storage, { now: () => 99_999, persistenceCoordinator: null });
  const native = nativePersistenceFixture(created.value.id, "empty");
  assert.equal(worlds.bindNativePersistence(created.value.id, native.session).ok, true);
  storage.failingKeys.add(WORLD_CATALOG_KEY);
  const failed = await worlds.hydrateNativeWorld(created.value.id);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error.code, "quota");
  assert.equal(storage.getItem(key), protectedDocument, "promotion failure cannot rewrite the protected source");
  assert.equal(storage.getItem(WORLD_CATALOG_KEY), nullCatalog, "promotion failure leaves the null catalog exact");
  assert.equal(worlds.listWorlds()[0]?.generationIdentity, null);

  storage.failingKeys.delete(WORLD_CATALOG_KEY);
  const retried = await worlds.hydrateNativeWorld(created.value.id);
  assert.equal(retried.ok, true);
  assert.equal(native.operations.filter((entry) => entry.startsWith("migrate:")).length, 1);
  assert.equal(storage.getItem(key), protectedDocument);
  assert.notEqual(worlds.listWorlds()[0]?.generationIdentity, null);
});

test("local-only world saves commit atomically without scheduling generic or native persistence", async () => {
  const storage = new MemoryStorage();
  const persistence = new TrackingWorldPersistenceCoordinatorV1();
  let now = 8_000;
  const worlds = new WorldStorage(storage, {
    now: () => now,
    idFactory: () => "local-only-world",
    persistenceCoordinator: persistence,
  });
  const created = worlds.createWorld({ name: "Local Journal", save: save("LOCAL-INITIAL") });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await worlds.flushPersistence();
  persistence.persistedSeeds.length = 0;

  now += 1;
  assert.equal(worlds.saveWorld(created.value.id, { save: save("GENERIC-NORMAL") }).ok, true);
  assert.deepEqual(persistence.persistedSeeds, ["GENERIC-NORMAL"], "ordinary unbound saves must keep scheduling the generic journal");
  await worlds.flushPersistence();

  now += 1;
  const genericLocalOnly = worlds.saveWorldLocalOnly(created.value.id, { save: save("GENERIC-LOCAL-ONLY") });
  assert.equal(genericLocalOnly.ok, true);
  assert.deepEqual(persistence.persistedSeeds, ["GENERIC-NORMAL"], "local-only commits must not schedule the generic journal");
  const locallyLoaded = worlds.loadWorld(created.value.id, false);
  assert.equal(locallyLoaded.ok && locallyLoaded.value.save.seed, "GENERIC-LOCAL-ONLY", "the local document must still commit synchronously");

  const native = nativePersistenceFixture(created.value.id);
  assert.equal(worlds.bindNativePersistence(created.value.id, native.session).ok, true);
  now += 1;
  assert.equal(worlds.saveWorld(created.value.id, { save: save("NATIVE-NORMAL") }).ok, true);
  assert.deepEqual(native.operations, ["save:8003"], "ordinary bound saves must keep scheduling the native checkpoint");

  now += 1;
  const nativeLocalOnly = worlds.saveWorldLocalOnly(created.value.id, { save: save("NATIVE-LOCAL-ONLY") });
  assert.equal(nativeLocalOnly.ok, true);
  assert.deepEqual(native.operations, ["save:8003"], "local-only commits must not schedule the bound native session");
  assert.deepEqual(persistence.persistedSeeds, ["GENERIC-NORMAL"], "local-only native commits must not fall through to generic persistence");

  storage.failingKeys.add(WORLD_CATALOG_KEY);
  const failed = worlds.saveWorldLocalOnly(created.value.id, { save: save("LOCAL-FAILED") });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error.code, "quota");
  storage.failingKeys.clear();
  const afterFailure = worlds.loadWorld(created.value.id, false);
  assert.equal(afterFailure.ok && afterFailure.value.save.seed, "NATIVE-LOCAL-ONLY", "failed local-only commits must restore the prior document");
  assert.deepEqual(native.operations, ["save:8003"]);
  assert.deepEqual(persistence.persistedSeeds, ["GENERIC-NORMAL"]);

  now += 1;
  const explicitNative = await worlds.saveNativeWorld(created.value.id, now);
  assert.equal(explicitNative.ok, true, "local-only commits must leave explicit native saves available");
  assert.deepEqual(native.operations, ["save:8003", "save:8005"]);
});

test("browser-primary loads hydrate the Rust journal while preserving the compatibility document", async () => {
  const storage = new MemoryStorage();
  const adapter = new MemoryPersistenceAdapterV1();
  const persistence = new WorldPersistenceCoordinatorV1(adapter, () => 1_500);
  const worlds = new WorldStorage(storage, { now: () => 1_500, idFactory: () => "journal-world", persistenceCoordinator: persistence });
  const created = worlds.createWorld({ name: "Journal World", save: save("JOURNAL") });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await worlds.flushPersistence();

  const key = `${WORLD_DATA_PREFIX}${created.value.id}`;
  const compatibility = JSON.parse(storage.getItem(key)!) as { save: WorldSave };
  compatibility.save.health = 1;
  storage.setItem(key, JSON.stringify(compatibility));
  const loaded = await worlds.loadWorldAsync(created.value.id, false);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.ok && loaded.value.save.health, 10, "the committed journal is the browser-primary save authority");
  assert.equal(JSON.parse(storage.getItem(key)!).save.health, 1, "read-only hydration must leave the protected compatibility source untouched");
});

test("runtime autosaves reuse trusted document metadata instead of reparsing the previous save", () => {
  const storage = new MemoryStorage();
  const worlds = new WorldStorage(storage, { now: () => 2_000, idFactory: () => "autosave-cache" });
  const created = worlds.createWorld({ name: "Autosave Cache", save: save("CACHE-A") });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const dataKey = `${WORLD_DATA_PREFIX}${created.value.id}`;
  storage.getItemCalls.clear();
  assert.equal(worlds.saveWorld(created.value.id, { save: save("CACHE-B"), playTimeDeltaMs: 50 }).ok, true);
  assert.equal(storage.getItemCalls.get(dataKey), 1, "the only data read should be the rollback snapshot in the atomic commit");

  const reopened = new WorldStorage(storage, { now: () => 3_000, idFactory: () => "unused" });
  storage.getItemCalls.clear();
  assert.equal(reopened.saveWorld(created.value.id, { save: save("CACHE-C") }).ok, true);
  assert.equal(storage.getItemCalls.get(dataKey), 2, "the first save in a new runtime validates storage before caching its shell");
  storage.getItemCalls.clear();
  assert.equal(reopened.saveWorld(created.value.id, { save: save("CACHE-D") }).ok, true);
  assert.equal(storage.getItemCalls.get(dataKey), 1, "subsequent saves should use the validated shell cache");
});

test("public agent tasks and test-world provenance round-trip with the owning world", () => {
  const storage = new MemoryStorage();
  const worlds = new WorldStorage(storage, { now: () => 2_500, idFactory: () => "agent-ledger" });
  const worldSave: WorldSave = {
    ...save("AGENT-LEDGER"),
    agentTestWorld: true,
    agentPlatform: {
      schema: 1,
      enabled: true,
      tasks: [{ id: "task_1", agentId: "agent_1", title: "Tend west field", status: "active", owner: "agent_1", note: "Mature only", createdAt: 1, updatedAt: 2, waypointIds: ["way_1"], previewIds: [] }],
      waypoints: [{ id: "way_1", agentId: "agent_1", name: "West field", position: { x: 4, y: 30, z: -2 }, createdAt: 1, source: "agent" }],
    },
  };
  const created = worlds.createWorld({ name: "Agent Ledger", save: worldSave });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const loaded = worlds.loadWorld(created.value.id, false);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.value.save.agentTestWorld, true);
  assert.equal(loaded.value.save.agentPlatform?.tasks[0]?.title, "Tend west field");
  assert.deepEqual(loaded.value.save.agentPlatform?.waypoints[0]?.position, { x: 4, y: 30, z: -2 });
});

test("world rules can switch between Survival and Creative before loading without losing the save", () => {
  const storage = new MemoryStorage();
  const worlds = new WorldStorage(storage, { now: () => 2_750, idFactory: () => "mode-switch" });
  const original = { ...save("RULES-A"), health: 2, hunger: 3, inventory: [{ item: 1, count: 7 }] } as WorldSave;
  const created = worlds.createWorld({ name: "Rules Test", save: original, options: { weather: false } });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const creative = worlds.updateWorldMode(created.value.id, "builder");
  assert.equal(creative.ok, true);
  assert.equal(creative.ok && creative.value.mode, "builder");
  const creativeLoad = worlds.loadWorld(created.value.id, false);
  assert.equal(creativeLoad.ok, true);
  if (!creativeLoad.ok) return;
  assert.equal(creativeLoad.value.metadata.mode, "builder");
  assert.equal(creativeLoad.value.save.mode, "builder");
  assert.equal(creativeLoad.value.save.health, 10);
  assert.equal(creativeLoad.value.save.hunger, 10);
  assert.deepEqual(creativeLoad.value.save.inventory, original.inventory);
  assert.equal(creativeLoad.value.options.weather, false);

  const survival = worlds.updateWorldMode(created.value.id, "survival");
  assert.equal(survival.ok, true);
  const survivalLoad = worlds.loadWorld(created.value.id, false);
  assert.equal(survivalLoad.ok && survivalLoad.value.save.mode, "survival");
  assert.deepEqual(survivalLoad.ok && survivalLoad.value.save.inventory, original.inventory);
});

test("autosaves refresh stale shells changed by another WorldStorage instance", () => {
  const storage = new MemoryStorage();
  let firstNow = 1_000;
  let secondNow = 2_000;
  const first = new WorldStorage(storage, { now: () => firstNow, idFactory: () => "shared-cache" });
  const created = first.createWorld({ name: "Original Name", save: save("SHARED-A") });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const second = new WorldStorage(storage, { now: () => secondNow, idFactory: () => "other-world" });
  assert.equal(second.renameWorld(created.value.id, "Second Runtime Name").ok, true);
  secondNow += 1;
  assert.equal(second.updateWorldOptions(created.value.id, { difficulty: "hard", keepInventory: true }).ok, true);
  const otherWorld = second.createWorld({ name: "Second Runtime World", save: save("SHARED-EXTRA") });
  assert.equal(otherWorld.ok, true);

  firstNow = 3_000;
  assert.equal(first.saveWorld(created.value.id, { save: save("SHARED-B") }).ok, true);

  const reopened = new WorldStorage(storage, { now: () => 4_000, idFactory: () => "unused" });
  assert.equal(reopened.listWorlds().length, 2, "refreshing a stale catalog must preserve worlds created by another runtime");
  const loaded = reopened.loadWorld(created.value.id, false);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.value.metadata.name, "Second Runtime Name", "an autosave must preserve another runtime's rename");
  assert.equal(loaded.value.options.difficulty, "hard", "an autosave must preserve another runtime's options");
  assert.equal(loaded.value.options.keepInventory, true);
  assert.equal(loaded.value.save.seed, "SHARED-B");
});

test("storage events invalidate cross-tab document shells and unregister on dispose", () => {
  const storage = new MemoryStorage();
  const events = new MemoryStorageEvents();
  const worlds = new WorldStorage(storage, {
    now: () => 5_000,
    idFactory: () => "cross-tab-cache",
    storageEventTarget: events,
  });
  const created = worlds.createWorld({ name: "Before Tab Edit", save: save("TAB-A") });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(events.listenerCount, 1);

  const dataKey = `${WORLD_DATA_PREFIX}${created.value.id}`;
  const document = JSON.parse(storage.values.get(dataKey)!);
  document.metadata.name = "Edited In Another Tab";
  document.options.difficulty = "hard";
  storage.values.set(dataKey, JSON.stringify(document));

  const catalog = JSON.parse(storage.values.get(WORLD_CATALOG_KEY)!);
  const catalogEntry = catalog.worlds.find((entry: { id: string }) => entry.id === created.value.id);
  catalogEntry.name = "Edited In Another Tab";
  storage.values.set(WORLD_CATALOG_KEY, JSON.stringify(catalog));

  events.dispatch(storage, dataKey);
  events.dispatch(storage, WORLD_CATALOG_KEY);
  assert.equal(worlds.saveWorld(created.value.id, { save: save("TAB-B") }).ok, true);

  const reopened = new WorldStorage(storage, { now: () => 6_000, idFactory: () => "unused" });
  const loaded = reopened.loadWorld(created.value.id, false);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.value.metadata.name, "Edited In Another Tab");
  assert.equal(loaded.value.options.difficulty, "hard");
  assert.equal(loaded.value.save.seed, "TAB-B");

  worlds.dispose();
  assert.equal(events.listenerCount, 0);
});

function save(seed: string, mode: "survival" | "builder" = "survival", generatorVersion = GENERATOR_VERSION): WorldSave {
  return {
    version: 2,
    generatorVersion,
    seed,
    mode,
    edits: { "0,0": [[17, 3]] },
    player: { x: 1, y: 50, z: -2, yaw: 0.3, pitch: -0.1 },
    spawn: { x: 0, y: 48, z: 0 },
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
    savedAt: 900,
  };
}

test("advanced world options use safe defaults and bounded numeric controls", () => {
  assert.deepEqual(normalizeWorldOptions(), DEFAULT_WORLD_OPTIONS);
  assert.deepEqual(normalizeWorldOptions({
    difficulty: "hard",
    dayLengthMinutes: 999,
    mobDensity: -2,
    butterflyDensity: 99,
    caveFrequency: Number.NaN,
    biomeScale: 0.01,
    resourceAbundance: 20,
    structures: false,
    weather: false,
    keepInventory: true,
    friendlyFire: true,
    sleepRule: "percentage",
    sleepPercentage: 50,
  }), {
    ...DEFAULT_WORLD_OPTIONS,
    difficulty: "hard",
    dayLengthMinutes: 120,
    mobDensity: 0,
    butterflyDensity: 4,
    caveFrequency: 1,
    biomeScale: 0.25,
    resourceAbundance: 4,
    structures: false,
    weather: false,
    keepInventory: true,
    friendlyFire: true,
    sleepRule: "percentage",
    sleepPercentage: 50,
  });
  assert.deepEqual(generationOptionsFromWorldOptions({ caveFrequency: 2, biomeScale: 3, resourceAbundance: 4, structures: false }), {
    ...DEFAULT_WORLD_GENERATION_OPTIONS,
    caveFrequency: 2,
    biomeScale: 3,
    resourceAbundance: 4,
    structures: false,
  });
  assert.equal(requiredSleepers({ sleepRule: "any-player", sleepPercentage: 50 }, 8), 1);
  assert.equal(requiredSleepers({ sleepRule: "percentage", sleepPercentage: 50 }, 5), 3);
  assert.equal(requiredSleepers({ sleepRule: "all-players", sleepPercentage: 50 }, 4), 4);
});

test("world metadata freezes an exact origin-free terrain generation identity", () => {
  const storage = new MemoryStorage();
  const worlds = new WorldStorage(storage, { now: () => 900, idFactory: () => "terrain-identity" });
  const options = {
    caveFrequency: 2.25,
    biomeScale: 3,
    resourceAbundance: 0.5,
    structures: true,
    enabledFactions: ["dwarves", "goblins"] as const,
    settlementPattern: "legacy-scattered-v1" as const,
    settlementDensity: 1.7,
    settlementClustering: "strong" as const,
    roadCoverage: "dense" as const,
    largeTownFrequency: "frequent" as const,
    origin: { mode: "near-any-settlement" as const },
  };
  const created = worlds.createWorld({
    save: { ...save("IDENTITY"), generatorProfile: "legacy-v14" },
    options,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const identity = created.value.generationIdentity;
  assert.ok(identity);
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(identity.schemaVersion, WORLD_GENERATION_IDENTITY_SCHEMA_V1);
  assert.equal(identity.terrainContentHash, LEGACY_TERRAIN_CONTENT_HASH_V2);
  assert.equal(identity.generatorHash, legacyTerrainGeneratorHashV2(`g${GENERATOR_VERSION}`));
  assert.equal(identity.generationOptionsJson, canonicalWorldGenerationOptionsJsonV1(options, "legacy-v14"));
  const parsed = JSON.parse(identity.generationOptionsJson) as Record<string, unknown>;
  assert.equal(Object.keys(parsed).length, 11);
  assert.equal("origin" in parsed, false);
  assert.equal(parsed.profile, "legacy-v14");
  assert.deepEqual(parsed.enabledFactions, ["goblins", "dwarves"]);
});

test("the build-only worldgen profile never enters exact generator-v18 save or world identity", () => {
  assert.equal(GENERATOR_VERSION, 18);
  const storage = new MemoryStorage();
  const worlds = new WorldStorage(storage, { now: () => 1_800, idFactory: () => "profile-neutral-v18" });
  const original = save("PROFILE-NEUTRAL-V18");
  const created = worlds.createWorld({ save: original, options: { biomeScale: 1.75 } });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const persisted = storage.getItem(`${WORLD_DATA_PREFIX}${created.value.id}`) ?? "";
  const catalog = storage.getItem(WORLD_CATALOG_KEY) ?? "";
  const exported = worlds.exportWorld(created.value.id);
  assert.equal(exported.ok, true);
  if (!exported.ok) return;
  for (const serialized of [persisted, catalog, exported.value]) {
    assert.doesNotMatch(serialized, /worldgenBuildProfile|rust-primary|typescript-rollback|BLOCKWILD_WORLDGEN_BUILD_PROFILE/u);
  }

  const reopened = new WorldStorage(storage, { now: () => 1_801, idFactory: () => "unused" });
  const loaded = reopened.loadWorld(created.value.id, false);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.value.save.generatorVersion, 18);
  assert.deepEqual(loaded.value.save.edits, original.edits);
  assert.deepEqual(
    loaded.value.metadata.generationIdentity,
    deriveWorldGenerationIdentityV1(loaded.value.save, loaded.value.options),
  );
});

test("device-local catalog supports synchronous CRUD, active selection, metadata, and sorting", () => {
  const storage = new MemoryStorage();
  let now = 1_000;
  const worlds = new WorldStorage(storage, { now: () => now, idFactory: () => "fixed-id" });

  const created = worlds.createWorld({ name: "  Alpha   Ridge  ", save: save("ALPHA") });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.id, "fixed-id");
  assert.equal(created.value.name, "Alpha Ridge");
  assert.equal(created.value.ownership, WORLD_OWNERSHIP);
  assert.equal(worlds.activeWorldId, created.value.id);

  now = 2_000;
  const loaded = worlds.loadWorld(created.value.id);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.value.metadata.lastPlayedAt, 2_000);
  loaded.value.save.seed = "MUTATED-ONLY-IN-CALLER";
  const detached = worlds.loadWorld(created.value.id, false);
  assert.equal(detached.ok && detached.value.save.seed, "ALPHA", "loads must be detached JSON values");

  now = 3_000;
  const saved = worlds.saveWorld(created.value.id, { save: save("ALPHA-2", "builder"), playTimeDeltaMs: 4_500 });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.seed, "ALPHA-2");
  assert.equal(saved.value.mode, "builder");
  assert.equal(saved.value.playTimeMs, 4_500);

  now = 4_000;
  const duplicate = worlds.duplicateWorld(created.value.id);
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.value.id, "fixed-id-2", "ID factories and imports must never overwrite an existing payload");
  assert.equal(duplicate.value.name, "Alpha Ridge Copy");
  assert.equal(duplicate.value.playTimeMs, 0);
  assert.deepEqual(duplicate.value.generationIdentity, saved.value.generationIdentity);
  assert.equal(worlds.activeWorldId, duplicate.value.id);

  const renamed = worlds.renameWorld(duplicate.value.id, "Beta Vale");
  assert.equal(renamed.ok && renamed.value.name, "Beta Vale");
  const identityBeforeOptions = duplicate.value.generationIdentity;
  const options = worlds.updateWorldOptions(duplicate.value.id, { difficulty: "peaceful", structures: false });
  assert.equal(options.ok && options.value.difficulty, "peaceful");
  assert.equal(options.ok && options.value.structures, false);
  const identityAfterOptions = worlds.listWorlds().find((world) => world.id === duplicate.value.id)?.generationIdentity;
  assert.notDeepEqual(identityAfterOptions, identityBeforeOptions, "a terrain behavior update must replace the bootstrap identity");
  assert.equal(JSON.parse(identityAfterOptions!.generationOptionsJson).structures, false);
  assert.deepEqual(worlds.listWorlds({ sortBy: "name", direction: "asc" }).map((world) => world.name), ["Alpha Ridge", "Beta Vale"]);
  assert.deepEqual(worlds.listWorlds({ sortBy: "playTimeMs", direction: "desc" }).map((world) => world.id), [created.value.id, duplicate.value.id]);

  assert.equal(worlds.setActiveWorld(created.value.id).ok, true);
  const removed = worlds.deleteWorld(created.value.id);
  assert.equal(removed.ok, true);
  assert.equal(worlds.activeWorldId, duplicate.value.id, "deleting the active world should select the best remaining local world");
  assert.equal(storage.getItem(`${WORLD_DATA_PREFIX}${created.value.id}`), null);

  const reopened = new WorldStorage(storage, { now: () => now, idFactory: () => "unused" });
  assert.deepEqual(reopened.listWorlds().map((world) => world.id), [duplicate.value.id]);
  assert.equal(reopened.activeWorldId, duplicate.value.id);
});

test("catalog identity survives refresh and unrelated world-rule changes", () => {
  const storage = new MemoryStorage();
  const first = new WorldStorage(storage, { now: () => 1_000, idFactory: () => "identity-refresh" });
  const created = first.createWorld({ save: save("REFRESH"), options: { biomeScale: 2 } });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const expected = {
    ...created.value.generationIdentity!,
    terrainContentHash: "b".repeat(32),
    generatorHash: "c".repeat(32),
  };
  const catalog = JSON.parse(storage.getItem(WORLD_CATALOG_KEY)!) as { worlds: Array<Record<string, unknown>> };
  catalog.worlds[0].generationIdentity = expected;
  storage.setItem(WORLD_CATALOG_KEY, JSON.stringify(catalog));

  const refreshed = new WorldStorage(storage, { now: () => 2_000, idFactory: () => "unused" });
  assert.deepEqual(refreshed.listWorlds()[0]?.generationIdentity, expected);
  assert.equal(refreshed.updateWorldOptions(created.value.id, {
    difficulty: "hard",
    weather: false,
    keepInventory: true,
    origin: { mode: "near-any-settlement" },
  }).ok, true);
  assert.deepEqual(
    refreshed.listWorlds()[0]?.generationIdentity,
    expected,
    "non-terrain rules and the deliberately excluded origin must retain the frozen identity",
  );
});

test("missing or malformed catalog identities remain explicit null without reading world bytes", () => {
  const storage = new MemoryStorage();
  const worlds = new WorldStorage(storage, { now: () => 1_000, idFactory: () => "legacy-catalog" });
  const first = worlds.createWorld({ save: save("MISSING-IDENTITY") });
  const second = worlds.createWorld({ save: save("INVALID-IDENTITY") });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;

  const catalog = JSON.parse(storage.getItem(WORLD_CATALOG_KEY)!) as { worlds: Array<Record<string, unknown>> };
  delete catalog.worlds.find((entry) => entry.id === first.value.id)!.generationIdentity;
  catalog.worlds.find((entry) => entry.id === second.value.id)!.generationIdentity = {
    ...second.value.generationIdentity,
    generationOptionsJson: '{"profile":"world-below-v15"}',
  };
  storage.setItem(WORLD_CATALOG_KEY, JSON.stringify(catalog));
  storage.getItemCalls.clear();

  const reopened = new WorldStorage(storage, { now: () => 2_000, idFactory: () => "unused" });
  const listed = reopened.listWorlds();
  assert.equal(listed.find((entry) => entry.id === first.value.id)?.generationIdentity, null);
  assert.equal(listed.find((entry) => entry.id === second.value.id)?.generationIdentity, null);
  assert.equal(
    [...storage.getItemCalls.keys()].some((key) => key.startsWith(WORLD_DATA_PREFIX)),
    false,
    "catalog bootstrap must not parse rich compatibility documents to infer missing identity",
  );
});

test("a legacy single-world save migrates once into the versioned catalog without moving its blocks", () => {
  const storage = new MemoryStorage();
  const legacy = save("OLD-WILD", "survival", 2);
  legacy.edits = { "0,0": [[8_192, 13]] };
  storage.setItem(LEGACY_WORLD_KEY, JSON.stringify(legacy));

  const worlds = new WorldStorage(storage, { now: () => 2_000, idFactory: () => "legacy-world" });
  const listed = worlds.listWorlds();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "legacy-world");
  assert.equal(listed[0].generationIdentity, null, "legacy catalogs must require an explicit compatibility migration before native bootstrap");
  assert.equal(worlds.activeWorldId, "legacy-world");
  const loaded = worlds.loadWorld("legacy-world", false);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.value.save.generatorVersion, GENERATOR_VERSION);
  assert.deepEqual(loaded.value.save.edits["0,0"], [[16_384, 13]], "legacy y coordinates should retain their deeper-world position");
  assert.deepEqual(loaded.value.options, { ...DEFAULT_WORLD_OPTIONS, settlementPattern: "legacy-scattered-v1" });
  assert.equal(storage.getItem(LEGACY_WORLD_KEY), null, "legacy data is removed only after catalog and payload writes succeed");

  const reopened = new WorldStorage(storage, { now: () => 3_000, idFactory: () => "another" });
  assert.equal(reopened.listWorlds().length, 1, "migration must be idempotent");
});

test("generator v9 saves migrate to v10 without moving or dropping player edits", () => {
  const previous = save("DRAGONWAKE-PREVIEW", "survival", 9);
  previous.edits = {
    "0,0": [[17, 3], [16_384, 13]],
    "-2,7": [[41_219, 221]],
  };

  const migrated = migrateLegacyWorldSave(previous);
  assert.ok(migrated);
  assert.equal(migrated.generatorVersion, GENERATOR_VERSION);
  assert.deepEqual(migrated.edits, previous.edits, "v9 and v10 share the deep-world index, so authored edits must remain exact");
});

test("generator v11 saves migrate to the current generator without moving or dropping authored edits", () => {
  const previous = save("V11-HOMESTEAD-MIGRATION", "survival", 11);
  previous.edits = {
    "0,0": [[17, 3], [16_384, 13], [41_219, 190]],
    "-9,4": [[3_077, 142], [47_004, 175]],
  };
  const migrated = migrateLegacyWorldSave(previous);
  assert.ok(migrated);
  assert.equal(migrated.generatorVersion, GENERATOR_VERSION);
  assert.deepEqual(migrated.edits, previous.edits, "legacy saves share the same deep-world byte layout");
});

test("generator v12 saves migrate to the current generator without moving or dropping authored edits", () => {
  const previous = save("V12-ECHOES-AND-RUINS-MIGRATION", "survival", 12);
  previous.edits = {
    "0,0": [[17, 3], [16_384, 13], [41_219, 190]],
    "-9,4": [[3_077, 142], [47_004, 175]],
  };
  const migrated = migrateLegacyWorldSave(previous);
  assert.ok(migrated);
  assert.equal(migrated.generatorVersion, GENERATOR_VERSION);
  assert.deepEqual(migrated.edits, previous.edits, "v12 authored edits must survive later content upgrades exactly");
});

test("world exports validate on import and use collision-safe local IDs", () => {
  const storage = new MemoryStorage();
  const worlds = new WorldStorage(storage, { now: () => 5_000, idFactory: () => "same-id" });
  const created = worlds.createWorld({
    name: "Export Me",
    save: { ...save("PORTABLE"), agentWorldFingerprint: "worldfp_original_portable" },
    options: { difficulty: "hard", keepInventory: true, biomeScale: 2.5 },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const exported = worlds.exportWorld(created.value.id);
  assert.equal(exported.ok, true);
  if (!exported.ok) return;
  const parsed = JSON.parse(exported.value);
  assert.equal(parsed.ownershipNotice.includes("host device"), true);
  assert.deepEqual(parsed.world.metadata.generationIdentity, created.value.generationIdentity);
  parsed.world.metadata.generationIdentity = {
    ...parsed.world.metadata.generationIdentity,
    terrainContentHash: "a".repeat(32),
  };

  const imported = worlds.importWorld(JSON.stringify(parsed));
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.equal(imported.value.id, "same-id-2");
  const copy = worlds.loadWorld(imported.value.id, false);
  assert.equal(copy.ok, true);
  if (!copy.ok) return;
  assert.equal(copy.value.save.seed, "PORTABLE");
  assert.match(copy.value.save.agentWorldFingerprint ?? "", /^worldfp_import_same-id-2_/u);
  assert.notEqual(copy.value.save.agentWorldFingerprint, "worldfp_original_portable");
  assert.equal(copy.value.options.difficulty, "hard");
  assert.equal(copy.value.options.keepInventory, true);
  assert.equal(copy.value.options.biomeScale, 2.5);
  assert.deepEqual(
    imported.value.generationIdentity,
    deriveWorldGenerationIdentityV1(copy.value.save, copy.value.options),
    "imports must derive identity from their normalized save profile and options instead of trusting exported metadata",
  );
  assert.equal(imported.value.generationIdentity?.terrainContentHash, LEGACY_TERRAIN_CONTENT_HASH_V2);

  assert.deepEqual(worlds.importWorld("not json"), { ok: false, error: { code: "invalid", message: "That file is not valid JSON." } });
  const unsupported = JSON.stringify({ ...parsed, version: 999 });
  assert.equal(worlds.importWorld(unsupported).ok, false);
});

for (const [sourceVersion, sourcePattern] of [
  [2, undefined], [14, undefined], [15, undefined], [16, undefined], [17, undefined], [GENERATOR_VERSION, undefined],
  [16, "heartlands-v2"],
] as const) {
  test(`importing generator v${sourceVersion} (${sourcePattern ?? "missing pattern"}) preserves its settlement mode and edited terrain identity`, context => {
    const storage = new MemoryStorage();
    const worlds = new WorldStorage(storage, { now: () => 5_000, idFactory: () => "import-origin" });
    context.after(() => worlds.dispose());
    const created = worlds.createWorld({ save: save("IMPORT-LEGACY-TERRAIN") });
    assert(created.ok);
    const exported = worlds.exportWorld(created.value.id);
    assert(exported.ok);
    // Synthetic historical-shape input tests the public import boundary; this is
    // not a claim of real-browser old-save migration acceptance.
    const source = JSON.parse(exported.value);
    source.world.save = save("IMPORT-LEGACY-TERRAIN", "survival", sourceVersion);
    source.world.save.edits = { "-8,3": [[17, 0], [8_192, 13]] };
    source.world.options = { biomeScale: 2.5, structures: false, keepInventory: true,
      ...(sourcePattern ? { settlementPattern: sourcePattern } : {}) };
    delete source.world.metadata.generationIdentity;
    const input = JSON.stringify(source);
    const expectedPattern = sourceVersion < 17 ? "legacy-scattered-v1" : "heartlands-v2";
    const expectedProfile = sourceVersion < 15 ? "legacy-v14" : "world-below-v15";
    const imported = worlds.importWorld(input);
    assert(imported.ok);
    const loaded = worlds.loadWorld(imported.value.id, false);
    assert(loaded.ok);
    assert.equal(loaded.value.options.settlementPattern, expectedPattern);
    assert.equal(loaded.value.options.biomeScale, 2.5);
    assert.equal(loaded.value.options.structures, false);
    assert.equal(loaded.value.options.keepInventory, true);
    assert.equal(loaded.value.save.generatorProfile, expectedProfile);
    assert.equal(loaded.value.save.generatorVersion, GENERATOR_VERSION);
    assert.deepEqual(loaded.value.save.edits["-8,3"], sourceVersion === 2 ? [[8_209, 0], [16_384, 13]] : [[17, 0], [8_192, 13]]);
    assert.equal(imported.value.generationIdentity?.generationOptionsJson,
      canonicalWorldGenerationOptionsJsonV1({ biomeScale: 2.5, structures: false, keepInventory: true,
        settlementPattern: expectedPattern }, expectedProfile));
    const reexported = worlds.exportWorld(imported.value.id);
    assert(reexported.ok);
    const reimported = worlds.importWorld(reexported.value);
    assert(reimported.ok);
    const restored = worlds.loadWorld(reimported.value.id, false);
    assert(restored.ok);
    assert.equal(restored.value.options.settlementPattern, expectedPattern);
    assert.deepEqual(restored.value.save.edits, loaded.value.save.edits, "the v2 coordinate migration must not run twice");
    assert.deepEqual(reimported.value.generationIdentity, imported.value.generationIdentity);
  });
}

test("corrupt data is isolated and quota failures roll back without losing the previous world", () => {
  const corruptCatalog = new MemoryStorage();
  corruptCatalog.setItem(WORLD_CATALOG_KEY, "{bad json");
  const recovered = new WorldStorage(corruptCatalog, { now: () => 1_000, idFactory: () => "recovered" });
  assert.deepEqual(recovered.listWorlds(), []);
  assert.equal(recovered.issues.some((issue) => issue.code === "corrupt"), true);
  assert.equal(recovered.createWorld({ save: save("RECOVERED") }).ok, true, "a damaged catalog should not crash future local saves");

  corruptCatalog.setItem(`${WORLD_DATA_PREFIX}recovered`, "{broken");
  const broken = recovered.loadWorld("recovered", false);
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.error.code, "corrupt");

  const storage = new MemoryStorage();
  const worlds = new WorldStorage(storage, { now: () => 1_000, idFactory: () => "quota-world" });
  const created = worlds.createWorld({ save: save("BEFORE") });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  storage.failingKeys.add(WORLD_CATALOG_KEY);
  const failed = worlds.saveWorld(created.value.id, { save: save("AFTER") });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error.code, "quota");
  storage.failingKeys.clear();
  const reopened = new WorldStorage(storage, { now: () => 2_000, idFactory: () => "other" });
  const original = reopened.loadWorld(created.value.id, false);
  assert.equal(original.ok && original.value.save.seed, "BEFORE", "a failed two-key commit must restore the prior payload");

  const full = new MemoryStorage();
  full.failAllWrites = true;
  const quota = new WorldStorage(full, { idFactory: () => "never-written" });
  const rejected = quota.createWorld({ save: save("NO-SPACE") });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, "quota");
  assert.equal(full.getItem(`${WORLD_DATA_PREFIX}never-written`), null);

  const unavailable = new WorldStorage(null);
  const noStorage = unavailable.createWorld({ save: save("SERVER") });
  assert.equal(noStorage.ok, false);
  if (!noStorage.ok) assert.equal(noStorage.error.code, "unavailable");
});
