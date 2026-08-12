import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  VoxelEngine,
  type RustWorldHydrationHookV1,
  type WorldSave,
} from "../app/game/engine.ts";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1, type RustIntegratedRuntimeIdentityV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustContentInstallReceiptV1, RustProductionContentBundle } from "../app/game/rust-integrated-runtime-content.ts";
import type { RustMultiplayerAuthorityV1 } from "../app/game/rust-multiplayer-authority.ts";
import type { RustNativeWorldPersistenceSessionV1 } from "../app/game/rust-native-world-persistence.ts";
import {
  RustWorldRuntimeHostV1,
  type RustWorldRuntimeAdapterV1,
  type RustWorldRuntimeHostConfigV1,
} from "../app/game/rust-world-runtime-host.ts";
import type { RustWorldRuntimeManagedHostV1 } from "../app/game/rust-world-runtime-manager.ts";
import { deriveWorldGenerationIdentityV1, type WorldMetadata, type WorldStorage } from "../app/game/world-storage.ts";

const ARTIFACT = "a".repeat(64);
const CONTENT = "b".repeat(32);
const GENERATOR = "c".repeat(32);

function runtimeIdentity(config: RustWorldRuntimeHostConfigV1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: config.universeId,
    locationId: config.locationId,
    revision: Object.freeze({ epoch: 1, world: 0, entities: 0, gameplay: 0, persistence: 0, network: 0, simulation: 0 }),
    tick: 0,
    stateHash: "d".repeat(32),
  });
}

function contentBundle(): RustProductionContentBundle {
  return Object.freeze({
    manifest: Object.freeze({ schemaVersion: 1, sourceRevision: "fixture", domains: Object.freeze({}), entries: Object.freeze([]), manifestHash: CONTENT }),
    artifacts: Object.freeze([]),
    blockers: Object.freeze([]),
  }) as unknown as RustProductionContentBundle;
}

function authority(events: string[]): RustMultiplayerAuthorityV1 {
  return {
    backend: "rust-wasm-worker",
    currentIdentity: () => ({}) as ReturnType<RustMultiplayerAuthorityV1["currentIdentity"]>,
    createHandshake: () => new Uint8Array(),
    negotiate: async () => ({ capabilities: Object.freeze([]), maxCommandBytes: 1 }),
    installPeer: async () => undefined,
    authorizeInbound: async () => ({ accepted: true, commandId: "x", idempotencyKey: "x", code: "accepted", receiptHash: null }),
    installAgentGrant: async () => undefined,
    upsertReplicationRecord: async () => undefined,
    removeReplicationRecord: async () => undefined,
    buildDelta: async () => ({ scopeProbes: 0, candidateRecords: 0, emittedRecords: 0, packet: new Uint8Array() }),
    acceptDelta: async () => ({ code: "accepted", sequence: 0, stateHash: "0".repeat(32) }),
    reconnectCheckpoint: async () => null,
    releaseCommand: async () => undefined,
    releasePeer: async () => undefined,
    drain: async () => { events.push("authority-drain"); },
  };
}

class FakeAdapter implements RustWorldRuntimeAdapterV1 {
  readonly events: string[];
  readonly current: RustIntegratedRuntimeIdentityV1;

  constructor(config: RustWorldRuntimeHostConfigV1, events: string[]) {
    this.current = runtimeIdentity(config);
    this.events = events;
  }

  async start() { this.events.push("adapter-start"); return this.current; }
  async installContent() {
    this.events.push("content-install");
    return Object.freeze({ status: "installed", manifestHash: CONTENT }) as RustContentInstallReceiptV1;
  }
  async shutdown() { this.events.push("adapter-shutdown"); }
  identity() { return this.current; }
  diagnostics() { return Object.freeze({ authoritative: true, contentReady: true, contentManifestHash: CONTENT }); }
}

function fakeSession(worldId: string, events: string[]) {
  return {
    worldId,
    async shutdown() { events.push("session-shutdown"); },
    diagnostics() {
      return Object.freeze({
        worldId,
        state: "open" as const,
        saves: 0,
        recoveries: 0,
        parentFallbacks: 0,
        platformOperations: 0,
        requestBytes: 0,
        responseBytes: 0,
        lastCheckpointId: null,
        lastError: null,
      });
    },
  } as unknown as RustNativeWorldPersistenceSessionV1;
}

test("local host creates one persistence graph around the already-started adapter and drains it before worker shutdown", async () => {
  const events: string[] = [];
  const config: RustWorldRuntimeHostConfigV1 = {
    worldSeed: "seed",
    universeId: "world:catalog-one",
    locationId: "overworld",
    sessionId: "runtime.fixture-one",
    catalogWorldId: "catalog-one",
    generatorHash: GENERATOR,
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
    waterBlockId: 7,
    directionalBlockIds: [],
    waterloggedBlockIds: [],
  };
  const adapter = new FakeAdapter(config, events);
  const session = fakeSession("catalog-one", events);
  let adapters = 0;
  let persistenceGraphs = 0;
  const host = new RustWorldRuntimeHostV1(config, {
    artifactHash: ARTIFACT,
    contentFactory: contentBundle,
    adapterFactory: () => { adapters += 1; return adapter; },
    authorityFactory: () => authority(events),
    persistenceFactory: ({ adapter: reused, worldId }) => {
      persistenceGraphs += 1;
      assert.equal(reused, adapter);
      assert.equal(worldId, "catalog-one");
      return Object.freeze({ session, closePlatform: async () => { events.push("platform-close"); } });
    },
  });

  await host.start();
  assert.equal(host.nativePersistenceSession(), session);
  assert.equal(adapters, 1);
  assert.equal(persistenceGraphs, 1);
  await host.shutdown();
  assert.deepEqual(events, [
    "adapter-start",
    "content-install",
    "authority-drain",
    "session-shutdown",
    "platform-close",
    "adapter-shutdown",
  ]);
});

type StorageFixtureOptions = Readonly<{
  hydrateOk?: boolean;
  generationIdentity?: WorldMetadata["generationIdentity"];
}>;

class FakeStorage {
  readonly events: string[] = [];
  readonly metadata: WorldMetadata;
  private bound: RustNativeWorldPersistenceSessionV1 | null = null;
  deleteCalls = 0;
  documentReads = 0;
  readonly hydrateOk: boolean;

  constructor(worldId = "catalog-one", options: StorageFixtureOptions = {}) {
    this.hydrateOk = options.hydrateOk !== false;
    this.metadata = {
      id: worldId,
      ownership: "host-device",
      name: "Fixture",
      seed: "NATIVE-SEED",
      mode: "survival",
      createdAt: 1,
      updatedAt: 1,
      lastPlayedAt: null,
      playTimeMs: 0,
      lastSavedGameVersion: "1.12.0",
      generationIdentity: options.generationIdentity === undefined
        ? deriveWorldGenerationIdentityV1({
          generatorVersion: 18,
          generatorProfile: "world-below-v15",
        } as WorldSave, {})
        : options.generationIdentity,
    };
  }

  get activeWorldId() { return this.metadata.id; }
  listWorlds() { this.events.push("catalog-read"); return [{ ...this.metadata }]; }
  bindNativePersistence(worldId: string, session: RustNativeWorldPersistenceSessionV1) {
    this.events.push(`bind:${worldId}`);
    if (this.bound) return { ok: false as const, error: { code: "invalid" as const, message: "already bound" } };
    this.bound = session;
    return { ok: true as const, value: true };
  }
  async initializeNativeWorld(worldId: string) {
    this.events.push(`initialize:${worldId}`);
    return { ok: true as const, value: { worldId } };
  }
  async hydrateNativeWorld(worldId: string) {
    this.events.push(`hydrate:${worldId}`);
    return this.hydrateOk
      ? { ok: true as const, value: { status: "hydrated" as const, worldId } }
      : { ok: false as const, error: { code: "corrupt" as const, message: "protected legacy save needs a lossless adapter" } };
  }
  async flushPersistence() { this.events.push("flush"); }
  async shutdownNativePersistence() { this.events.push("session-drain"); this.bound = null; }
  loadWorld(id: string) {
    this.documentReads += 1;
    this.events.push(`mirror-read:${id}`);
    return { ok: true as const, value: {
      version: 2 as const,
      metadata: { ...this.metadata },
      options: {},
      save: { seed: this.metadata.seed, mode: "survival" } as WorldSave,
    } };
  }
  deleteWorld(id: string) { this.deleteCalls += 1; return { ok: true as const, value: { ...this.metadata, id } }; }
}

function managedHost(config: RustWorldRuntimeHostConfigV1, session: RustNativeWorldPersistenceSessionV1): RustWorldRuntimeManagedHostV1 {
  return {
    config,
    async start() {},
    async shutdown() {},
    multiplayerAuthority: () => authority([]),
    authorityInterest: () => ({}) as ReturnType<RustWorldRuntimeManagedHostV1["authorityInterest"]>,
    runtimeAdapter: () => ({}) as ReturnType<RustWorldRuntimeManagedHostV1["runtimeAdapter"]>,
    nativePersistenceSession: () => session,
    diagnostics: () => ({
      state: "ready" as const,
      artifactHash: ARTIFACT,
      contentHash: CONTENT,
      generatorHash: config.generatorHash,
      identity: runtimeIdentity(config),
      adapter: { authoritative: true, contentReady: true, contentManifestHash: CONTENT },
      nativePersistence: session.diagnostics(),
      lastError: null,
    }),
  };
}

class FakeManager {
  readonly events: string[];
  readonly configs: RustWorldRuntimeHostConfigV1[] = [];
  shutdowns = 0;
  host: RustWorldRuntimeManagedHostV1 | null = null;

  constructor(events: string[]) { this.events = events; }
  async activate(config: RustWorldRuntimeHostConfigV1) {
    this.configs.push(config);
    this.events.push(`activate:${config.catalogWorldId}`);
    this.host = managedHost(config, fakeSession(config.catalogWorldId ?? "guest", this.events));
    return this.host;
  }
  async shutdown() { this.shutdowns += 1; this.events.push("manager-shutdown"); this.host = null; }
  requireReady() { if (!this.host) throw new Error("not ready"); return this.host; }
  diagnostics() {
    return {
      state: this.host ? "ready" as const : "idle" as const,
      requestedGeneration: 1,
      activeGeneration: this.host ? 1 : null,
      activeFingerprint: this.host ? "fixture" : null,
      host: this.host?.diagnostics() ?? null,
      lastError: null,
    };
  }
}

function engineHarness(storage: FakeStorage, manager: FakeManager) {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    rustRuntimeManager: manager,
    rustRuntimeHost: null,
    rustRuntimeOperationsBlocked: true,
    rustRuntimeTransitionGeneration: 0,
    rustRuntimeHydrationState: "none",
    rustNativePersistenceWorldId: null,
    rustRuntimeShutdown: null,
    rustPeerDeltaSequences: new Map(),
    rustAuthorityDeltaApplied: 0,
    rustAuthorityResyncs: 0,
    rustAuthorityRejections: 0,
    rustAuthorityLastStateHash: null,
    rustAuthorityLastError: null,
    disposed: false,
    running: false,
    paused: true,
    titleMode: true,
    activeWorldId: null,
    persistent: false,
    world: { seedText: storage.metadata.seed },
    worldStorage: storage as unknown as WorldStorage,
  });
  const hydrate: RustWorldHydrationHookV1 = (input) => (
    engine as unknown as { hydrateRustWorldPersistence(value: Parameters<RustWorldHydrationHookV1>[0]): Promise<void> }
  ).hydrateRustWorldPersistence(input);
  (engine as unknown as { rustWorldHydration: RustWorldHydrationHookV1 }).rustWorldHydration = hydrate;
  (engine as unknown as { prepareRustWorldTransition: () => Promise<void> }).prepareRustWorldTransition = async () => {
    engine.running = false;
    engine.paused = true;
    (engine as unknown as { rustRuntimeOperationsBlocked: boolean }).rustRuntimeOperationsBlocked = true;
    await (engine as unknown as { shutdownBoundNativePersistence(): Promise<void> }).shutdownBoundNativePersistence();
  };
  return engine;
}

test("new world binds and initializes native durability before controls open", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  (engine as unknown as { createWorld(): Pick<WorldMetadata, "id" | "generationIdentity"> }).createWorld = () => ({
    id: storage.metadata.id,
    generationIdentity: storage.metadata.generationIdentity,
  });

  const created = await engine.createWorldWithRustRuntime(storage.metadata.seed, "survival");
  assert.equal(created.id, storage.metadata.id);
  assert.deepEqual(storage.events, [
    "session-drain",
    "activate:catalog-one",
    "bind:catalog-one",
    "initialize:catalog-one",
  ]);
  assert.equal(engine.running, true);
  assert.equal(engine.getRustRuntimeDiagnostics().nativePersistenceWorldId, "catalog-one");
  assert.equal(manager.configs[0]?.generationOptionsJson, storage.metadata.generationIdentity?.generationOptionsJson);
  assert.equal(manager.configs[0]?.terrainContentHash, storage.metadata.generationIdentity?.terrainContentHash);
});

test("stored world recovers before the compatibility document is read or presented", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  (engine as unknown as { loadWorld(save: WorldSave, options: unknown, id: string): void }).loadWorld = (_save, _options, id) => {
    storage.events.push(`mirror-present:${id}`);
    engine.activeWorldId = id;
  };

  await engine.loadStoredWorldWithRustRuntime("catalog-one");
  assert.deepEqual(storage.events, [
    "catalog-read",
    "session-drain",
    "activate:catalog-one",
    "bind:catalog-one",
    "hydrate:catalog-one",
    "mirror-read:catalog-one",
    "mirror-present:catalog-one",
  ]);
  assert.equal(manager.configs[0]?.generationOptionsJson, storage.metadata.generationIdentity?.generationOptionsJson);
  assert.equal(manager.configs[0]?.generatorHash, storage.metadata.generationIdentity?.generatorHash);
});

test("stored world without an exact catalog terrain identity stays protected before activation or document read", async () => {
  const storage = new FakeStorage("catalog-legacy", { generationIdentity: null });
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);

  await assert.rejects(
    engine.loadStoredWorldWithRustRuntime(storage.metadata.id),
    /lacks an exact native terrain identity/u,
  );
  assert.deepEqual(storage.events, ["catalog-read"]);
  assert.equal(manager.configs.length, 0);
  assert.equal(storage.documentReads, 0);
  assert.equal(engine.running, false);
});

test("switching worlds drains the first native session before the second worker activation", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  (engine as unknown as { createWorld(): Pick<WorldMetadata, "id" | "generationIdentity"> }).createWorld = () => ({
    id: "catalog-one",
    generationIdentity: storage.metadata.generationIdentity,
  });
  (engine as unknown as { loadWorld(save: WorldSave, options: unknown, id: string): void }).loadWorld = (_save, _options, id) => {
    engine.activeWorldId = id;
  };
  await engine.createWorldWithRustRuntime("NATIVE-SEED", "survival");
  storage.events.length = 0;

  await engine.loadWorldWithRustRuntime({ seed: "SECOND-SEED", mode: "survival" } as WorldSave, {}, "catalog-two");
  assert.deepEqual(storage.events.slice(0, 4), [
    "session-drain",
    "activate:catalog-two",
    "bind:catalog-two",
    "hydrate:catalog-two",
  ]);
  assert.equal(engine.getRustRuntimeDiagnostics().nativePersistenceWorldId, "catalog-two");
});

test("failed native hydration leaves a rich compatibility save unopened and protected", async () => {
  const storage = new FakeStorage("catalog-one", { hydrateOk: false });
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  await assert.rejects(engine.loadStoredWorldWithRustRuntime("catalog-one"), /lossless adapter/u);
  assert.equal(storage.documentReads, 0);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, true);
  assert.equal(manager.shutdowns, 1);
  assert.deepEqual(storage.events.slice(-2), ["session-drain", "manager-shutdown"]);
});

test("bound native world deletion is blocked until a future awaited tombstone flow releases it", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  (engine as unknown as { createWorld(): Pick<WorldMetadata, "id" | "generationIdentity"> }).createWorld = () => ({
    id: "catalog-one",
    generationIdentity: storage.metadata.generationIdentity,
  });
  await engine.createWorldWithRustRuntime("NATIVE-SEED", "survival");

  const blocked = await engine.deleteStoredWorldWithRustRuntime("catalog-one");
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? "" : blocked.error.message, /awaited Rust tombstone/u);
  assert.equal(storage.deleteCalls, 0);
  await (engine as unknown as { shutdownBoundNativePersistence(): Promise<void> }).shutdownBoundNativePersistence();
  const deleted = await engine.deleteStoredWorldWithRustRuntime("catalog-one");
  assert.equal(deleted.ok, true);
  assert.equal(storage.deleteCalls, 1);
});

test("engine shutdown drains queued storage/native work before manager destroys the worker", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  Object.assign(engine, {
    animationFrame: 0,
    clearInput: () => storage.events.push("input-blocked"),
    unbindEvents: () => storage.events.push("events-unbound"),
    saveNow: () => storage.events.push("autosave-enqueued"),
    disconnectMultiplayer: async () => { storage.events.push("multiplayer-drained"); },
    drainRustAuthorityOperations: async () => { storage.events.push("authority-drained"); },
    disposeBrowserResources: () => { storage.events.push("resources-released"); },
  });
  const priorCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => undefined;
  try { await engine.shutdown(); }
  finally { globalThis.cancelAnimationFrame = priorCancel; }
  assert.deepEqual(storage.events, [
    "input-blocked",
    "events-unbound",
    "autosave-enqueued",
    "flush",
    "multiplayer-drained",
    "authority-drained",
    "session-drain",
    "manager-shutdown",
    "resources-released",
  ]);
});

test("live shell transfers one WorldStorage into the engine and never swaps a second owner", () => {
  const shell = readFileSync(new URL("../app/game/VoxelGame.tsx", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  const host = readFileSync(new URL("../app/game/rust-world-runtime-host.ts", import.meta.url), "utf8");
  assert.equal(shell.match(/new WorldStorage\(/gu)?.length, 1);
  assert.match(shell, /new WorldStorage\(browserStorage, \{ persistenceCoordinator: null \}\)/u);
  assert.match(shell, /worldStorage: storage/u);
  assert.doesNotMatch(shell, /engine\.worldStorage\.(?:dispose|flushPersistence)\(/u);
  assert.doesNotMatch(shell, /engine\.worldStorage\s*=\s*storage/u);
  assert.doesNotMatch(engine, /worldStorage\s*=\s*new WorldStorage/u);
  assert.match(shell, /await engine\.loadStoredWorldWithRustRuntime\(worldId\)/u);
  const persistenceFactory = host.match(/function productionNativePersistence[\s\S]*?(?=\/\*\*\r?\n \* Owns exactly one integrated Rust worker)/u)?.[0] ?? "";
  assert.match(persistenceFactory, /productionRuntimeService\(input\.adapter\)/u);
  assert.doesNotMatch(persistenceFactory, /new RustIntegratedRuntimeBrowserAdapterV1/u);
});
