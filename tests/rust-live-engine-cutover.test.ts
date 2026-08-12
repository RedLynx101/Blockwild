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
import { deriveWorldGenerationIdentityV1 } from "../app/game/world-storage.ts";

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

function readyHost(config: RustWorldRuntimeHostConfigV1): RustWorldRuntimeManagedHostV1 {
  return {
    config,
    async start() {},
    async shutdown() {},
    multiplayerAuthority() { return {} as ReturnType<RustWorldRuntimeManagedHostV1["multiplayerAuthority"]>; },
    authorityInterest() { return {} as ReturnType<RustWorldRuntimeManagedHostV1["authorityInterest"]>; },
    runtimeAdapter() { return {} as ReturnType<RustWorldRuntimeManagedHostV1["runtimeAdapter"]>; },
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

  async shutdown() { this.shutdowns += 1; this.host = null; }

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
    rustRuntimeHydrationState: "none",
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
    world: { seedText: "CUTOVER-SEED" },
    worldStorage: { activeWorldId: null },
  });
  (engine as unknown as { prepareRustWorldTransition: () => Promise<void> }).prepareRustWorldTransition = async () => {
    engine.running = false;
    engine.paused = true;
    (engine as unknown as { rustRuntimeOperationsBlocked: boolean }).rustRuntimeOperationsBlocked = true;
  };
  return engine;
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

test("shutdown orders save, persistence, multiplayer drain, manager stop, then browser resources", async () => {
  const calls: string[] = [];
  const manager = new FakeManager();
  const engine = harness(manager);
  Object.assign(engine, {
    animationFrame: 0,
    clearInput: () => calls.push("block"),
    unbindEvents: () => calls.push("unbind"),
    saveNow: () => calls.push("save"),
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
  assert.deepEqual(calls, ["block", "unbind", "save", "flush", "multiplayer", "authority", "native", "manager", "resources"]);
});
