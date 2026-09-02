import assert from "node:assert/strict";

import {
  VoxelEngine,
  type WorldSave,
} from "../../app/game/engine.ts";
import {
  COMPILED_WORLDGEN_BUILD_PROFILE,
  worldgenBuildUsesRustRuntime,
} from "../../app/game/build-info.ts";
import {
  DEFAULT_WORLD_OPTIONS,
  type StoredWorld,
  type WorldMetadata,
  type WorldStorageResult,
} from "../../app/game/world-storage.ts";

type EngineHarness = VoxelEngine & Record<string, unknown>;

const forbiddenRustCalls: string[] = [];

function forbiddenRustHook(name: string) {
  return () => {
    forbiddenRustCalls.push(name);
    throw new Error(`rollback invoked forbidden Rust hook: ${name}`);
  };
}

function installForbiddenRustLifecycle(engine: EngineHarness) {
  Object.assign(engine, {
    prepareRustWorldTransition: forbiddenRustHook("prepare-transition"),
    resolveRustSettlementOrigin: forbiddenRustHook("origin-preflight"),
    replaceTerrainGenerationReadiness: forbiddenRustHook("terrain-readiness"),
    prepareRustNewWorldTerrain: forbiddenRustHook("new-world-terrain"),
    prepareRustLoadedWorldTerrain: forbiddenRustHook("loaded-world-terrain"),
    activateRustWorldRuntime: forbiddenRustHook("runtime-activation"),
    rustWorldHydration: forbiddenRustHook("runtime-hydration-hook"),
    hydrateRustWorldPersistence: forbiddenRustHook("native-hydration"),
    finalizeRustWorldRuntime: forbiddenRustHook("runtime-finalization"),
    activateRustLivePlayerAuthorityR5: forbiddenRustHook("player-authority-activation"),
    cleanupFailedRustWorldRuntime: forbiddenRustHook("failed-transition-cleanup"),
    shutdownBoundNativePersistence: forbiddenRustHook("native-persistence-shutdown"),
    rustRuntimeManager: {
      activate: forbiddenRustHook("runtime-manager-activation"),
      shutdown: forbiddenRustHook("runtime-manager-shutdown"),
      requireReady: forbiddenRustHook("runtime-manager-require-ready"),
    },
  });
  return engine;
}

function rollbackEngine() {
  return installForbiddenRustLifecycle(Object.create(VoxelEngine.prototype) as EngineHarness);
}

assert.equal(COMPILED_WORLDGEN_BUILD_PROFILE, "typescript-rollback");
assert.equal(worldgenBuildUsesRustRuntime(), false);

const metadata: WorldMetadata = Object.freeze({
  id: "rollback-world",
  ownership: "host-device",
  name: "Rollback Fixture",
  seed: "ROLLBACK-SEED",
  mode: "survival",
  createdAt: 10,
  updatedAt: 20,
  lastPlayedAt: null,
  playTimeMs: 30,
  lastSavedGameVersion: "1.12.0",
  generationIdentity: null,
});

const createEvents: string[] = [];
const createEngine = rollbackEngine();
const createOptions = Object.freeze({ difficulty: "hard" as const, weather: false });
Object.assign(createEngine, {
  createWorld: (
    seed: string,
    mode: string,
    options: unknown,
    name: string,
    radius: number,
    agentTestWorld: boolean,
  ) => {
    createEvents.push("compatibility-create");
    assert.equal(seed, "ROLLBACK-SEED");
    assert.equal(mode, "survival");
    assert.equal(options, createOptions);
    assert.equal(name, "Rollback Fixture");
    assert.equal(radius, 23);
    assert.equal(agentTestWorld, true);
    return metadata;
  },
});
const created = await createEngine.createWorldWithRustRuntime(
  "ROLLBACK-SEED",
  "survival",
  createOptions,
  "Rollback Fixture",
  23,
  true,
);
assert.equal(created, metadata, "the compatibility wrapper must retain the metadata object and shape");

const storedSave = Object.freeze({
  version: 2,
  seed: metadata.seed,
  mode: metadata.mode,
  generatorVersion: 18,
  generatorProfile: "world-below-v15",
  options: DEFAULT_WORLD_OPTIONS,
}) as unknown as WorldSave;
const storedWorld: StoredWorld = Object.freeze({
  version: 1,
  metadata,
  options: DEFAULT_WORLD_OPTIONS,
  save: storedSave,
});
const storedLoadResult: WorldStorageResult<StoredWorld> = {
  ok: true,
  value: storedWorld,
  warnings: [{
    code: "corrupt" as const,
    message: "Recovered the compatibility mirror after a stale optional snapshot.",
    key: metadata.id,
  }],
};
const loadEvents: string[] = [];
const loadEngine = rollbackEngine();
Object.assign(loadEngine, {
  worldStorage: {
    listWorlds: () => {
      loadEvents.push("catalog-lookup");
      return [metadata];
    },
    loadWorld: (id: string, touch = true) => {
      loadEvents.push(`touched-load:${id}:${String(touch)}`);
      assert.equal(id, metadata.id);
      assert.equal(touch, true);
      return storedLoadResult;
    },
  },
  loadWorld: (save: WorldSave, options: unknown, id: string) => {
    loadEvents.push(`engine-load:${id}`);
    assert.equal(save, storedSave);
    assert.equal(options, DEFAULT_WORLD_OPTIONS);
    assert.equal(id, metadata.id);
  },
});
const loaded = await loadEngine.loadStoredWorldWithRustRuntime(metadata.id);
assert.equal(loaded, storedLoadResult, "rollback load must retain the exact storage result object");
assert.deepEqual(loaded, {
  ok: true,
  value: storedWorld,
  warnings: [{
    code: "corrupt",
    message: "Recovered the compatibility mirror after a stale optional snapshot.",
    key: metadata.id,
  }],
});
assert.deepEqual(loadEvents, [
  "catalog-lookup",
  "touched-load:rollback-world:true",
  "engine-load:rollback-world",
]);

function installDocumentFixture() {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { pointerLockElement: null },
  });
  return () => {
    if (prior) Object.defineProperty(globalThis, "document", prior);
    else Reflect.deleteProperty(globalThis, "document");
  };
}

const quitEvents: string[] = [];
const quitWarnings: string[] = [];
const quitEngine = rollbackEngine();
Object.assign(quitEngine, {
  rustRuntimeOperationsBlocked: false,
  rustRuntimeTransitionGeneration: 4,
  rustRuntimeHost: Object.freeze({ fixture: true }),
  rustRuntimeHydrationState: "restored",
  rustLivePlayerAuthorityRequestedR5: false,
  rustLivePlayerAuthorityState: "none",
  rustNativeSaveOperation: null,
  activeWorldId: metadata.id,
  persistent: true,
  running: true,
  paused: false,
  titleMode: false,
  cancelRustOriginPreflight: () => { quitEvents.push("origin-preflight-cancel"); },
  cancelTerrainLocatorConsumerOperations: () => { quitEvents.push("locator-consumers-cancel"); },
  terrainGenerationReadinessAbort: { abort: () => { quitEvents.push("terrain-readiness-abort"); } },
  clearInput: () => { quitEvents.push("input-clear"); },
  drainRustAuthorityOperations: async () => { quitEvents.push("authority-drain"); },
  closeContainer: () => { quitEvents.push("container-close"); },
  requireRustNativePlayerSaveBinding: (reason: string) => {
    quitEvents.push(`native-binding-check:${reason}`);
    return false;
  },
  saveNow: () => { quitEvents.push("save"); return true; },
  worldStorage: {
    flushPersistence: async () => { quitEvents.push("persistence-flush"); },
  },
  disconnectMultiplayer: async (reason: string) => {
    quitEvents.push(`multiplayer-disconnect:${reason}`);
    throw new Error("rollback network close failed");
  },
  stopRustLivePlayerAuthorityR5: async () => { quitEvents.push("player-authority-dispose"); },
  disposeRustLiveRendererR10: async () => { quitEvents.push("renderer-dispose"); },
  events: {
    onSave: () => undefined,
    onToast: (warning: string) => { quitWarnings.push(warning); },
  },
});
const restoreDocument = installDocumentFixture();
let quitResult: void;
try {
  quitResult = await quitEngine.quitToTitleAsync();
} finally {
  restoreDocument();
}
assert.equal(quitResult, undefined);
assert.deepEqual(quitEvents, [
  "origin-preflight-cancel",
  "locator-consumers-cancel",
  "terrain-readiness-abort",
  "input-clear",
  "authority-drain",
  // The shared lifecycle settlement drains once more before checking pending
  // finalizers. In a rollback build this must not activate native ownership.
  "authority-drain",
  "container-close",
  "native-binding-check:Save & Quit",
  "save",
  "authority-drain",
  "persistence-flush",
  "multiplayer-disconnect:quit-to-title",
  "authority-drain",
  "player-authority-dispose",
  "renderer-dispose",
]);
assert.deepEqual(quitWarnings, [
  "World saved, but native shutdown needs recovery (multiplayer disconnect: rollback network close failed)",
]);
assert.equal(quitEngine.running, false);
assert.equal(quitEngine.paused, true);
assert.equal(quitEngine.titleMode, true);
assert.equal(quitEngine.persistent, false);
assert.equal(quitEngine["rustRuntimeTransitionGeneration"], 5);
assert.equal(quitEngine["rustRuntimeHost"], null);
assert.equal(quitEngine["rustRuntimeHydrationState"], "blocked");

const shutdownEvents: string[] = [];
const shutdownEngine = rollbackEngine();
Object.assign(shutdownEngine, {
  rustRuntimeShutdown: null,
  rustRuntimeOperationsBlocked: false,
  rustRuntimeTransitionGeneration: 9,
  rustRuntimeHost: Object.freeze({ fixture: true }),
  rustRuntimeHydrationState: "restored",
  rustNativeSaveOperation: null,
  animationFrame: 41,
  running: true,
  paused: false,
  cancelRustOriginPreflight: () => { shutdownEvents.push("origin-preflight-cancel"); },
  cancelTerrainLocatorConsumerOperations: () => { shutdownEvents.push("locator-consumers-cancel"); },
  terrainGenerationReadinessAbort: { abort: () => { shutdownEvents.push("terrain-readiness-abort"); } },
  clearInput: () => { shutdownEvents.push("input-clear"); },
  unbindEvents: () => { shutdownEvents.push("events-unbind"); },
  drainRustAuthorityOperations: async () => { shutdownEvents.push("authority-drain"); },
  requireRustNativePlayerSaveBinding: (reason: string) => {
    shutdownEvents.push(`native-binding-check:${reason}`);
    return false;
  },
  saveNow: (notify: boolean) => { shutdownEvents.push(`save:${String(notify)}`); return true; },
  worldStorage: {
    flushPersistence: async () => { shutdownEvents.push("persistence-flush"); },
  },
  disconnectMultiplayer: async (reason: string) => { shutdownEvents.push(`multiplayer-disconnect:${reason}`); },
  stopRustLivePlayerAuthorityR5: async () => { shutdownEvents.push("player-authority-dispose"); },
  disposeRustLiveRendererR10: async () => { shutdownEvents.push("renderer-dispose"); },
  disposeBrowserResources: () => { shutdownEvents.push("browser-resources-dispose"); },
});
const priorCancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
Object.defineProperty(globalThis, "cancelAnimationFrame", {
  configurable: true,
  value: (handle: number) => { shutdownEvents.push(`animation-cancel:${String(handle)}`); },
});
let shutdownResult: void;
try {
  shutdownResult = await shutdownEngine.shutdown();
} finally {
  if (priorCancelAnimationFrame) Object.defineProperty(globalThis, "cancelAnimationFrame", priorCancelAnimationFrame);
  else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
}
assert.equal(shutdownResult, undefined);
assert.deepEqual(shutdownEvents, [
  "origin-preflight-cancel",
  "locator-consumers-cancel",
  "terrain-readiness-abort",
  "input-clear",
  "animation-cancel:41",
  "events-unbind",
  // Settlement precedes the separate operations-blocked shutdown drain.
  "authority-drain",
  "authority-drain",
  "native-binding-check:Engine shutdown",
  "save:false",
  "authority-drain",
  "persistence-flush",
  "multiplayer-disconnect:engine-shutdown",
  "authority-drain",
  "player-authority-dispose",
  "renderer-dispose",
  "browser-resources-dispose",
]);
assert.equal(shutdownEngine.running, false);
assert.equal(shutdownEngine.paused, true);
assert.equal(shutdownEngine["rustRuntimeTransitionGeneration"], 10);
assert.equal(shutdownEngine["rustRuntimeHost"], null);
assert.equal(shutdownEngine["rustRuntimeHydrationState"], "none");
assert.deepEqual(forbiddenRustCalls, []);

process.stdout.write(JSON.stringify({
  profile: COMPILED_WORLDGEN_BUILD_PROFILE,
  create: {
    sameMetadata: created === metadata,
    events: createEvents,
    generationIdentity: created.generationIdentity,
  },
  load: {
    sameResult: loaded === storedLoadResult,
    events: loadEvents,
    resultKeys: Object.keys(loaded),
    warnings: loaded.ok ? loaded.warnings : undefined,
    generationIdentity: loaded.ok ? loaded.value.metadata.generationIdentity : "failed",
  },
  quit: {
    events: quitEvents,
    warnings: quitWarnings,
    hydration: quitEngine["rustRuntimeHydrationState"],
  },
  shutdown: {
    events: shutdownEvents,
    hydration: shutdownEngine["rustRuntimeHydrationState"],
  },
  forbiddenRustCalls,
}));
