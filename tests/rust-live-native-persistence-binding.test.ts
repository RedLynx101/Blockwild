import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  VoxelEngine,
  type RustLivePlayerEnvironmentalSurvivalDiagnosticsR10,
  type RustWorldHydrationHookV1,
  type WorldSave,
} from "../app/game/engine.ts";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1, type RustIntegratedRuntimeIdentityV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustContentInstallReceiptV1, RustProductionContentBundle } from "../app/game/rust-integrated-runtime-content.ts";
import type { RustMultiplayerAuthorityV1 } from "../app/game/rust-multiplayer-authority.ts";
import { createRustMultiplayerRuntimeDescriptorV2 } from "../app/game/rust-multiplayer-runtime-bootstrap.ts";
import type {
  RustNativeWorldPersistenceDiagnosticsV1,
  RustNativeWorldPersistenceSaveV1,
  RustNativeWorldPersistenceSessionV1,
} from "../app/game/rust-native-world-persistence.ts";
import { createRustWorldRuntimeLiveConfigV1 } from "../app/game/rust-world-runtime-live-config.ts";
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

function authority(
  events: string[],
  address?: Readonly<{ universeId: string; locationId: string }>,
): RustMultiplayerAuthorityV1 {
  return {
    backend: "rust-wasm-worker",
    currentIdentity: () => address
      ? ({ address: { ...address } }) as ReturnType<RustMultiplayerAuthorityV1["currentIdentity"]>
      : ({}) as ReturnType<RustMultiplayerAuthorityV1["currentIdentity"]>,
    createHandshake: () => new Uint8Array(),
    negotiate: async () => ({ capabilities: Object.freeze([]), maxCommandBytes: 1 }),
    installPeer: async () => ({ status: "installed", nextSequence: 0 }),
    authorizeInbound: async () => ({ accepted: true, commandId: "x", idempotencyKey: "x", code: "accepted", receiptHash: null }),
    installAgentGrant: async () => undefined,
    upsertReplicationRecord: async () => undefined,
    removeReplicationRecord: async () => undefined,
    buildDelta: async () => ({ scopeProbes: 0, candidateRecords: 0, emittedRecords: 0, packet: new Uint8Array() }),
    acceptDelta: async () => ({ code: "accepted", sequence: 0, stateHash: "0".repeat(32) }),
    reconnectCheckpoint: async () => null,
    releaseCommand: async () => undefined,
    releasePeer: async () => "released",
    runExclusiveMutation: operation => operation(),
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
  const session = fakeSession("world:catalog-one@overworld", events);
  let adapters = 0;
  let persistenceGraphs = 0;
  const host = new RustWorldRuntimeHostV1(config, {
    artifactHash: ARTIFACT,
    contentFactory: contentBundle,
    adapterFactory: () => { adapters += 1; return adapter; },
    authorityFactory: () => authority(events),
    persistenceFactory: ({ adapter: reused, catalogWorldId, persistenceWorldId }) => {
      persistenceGraphs += 1;
      assert.equal(reused, adapter);
      assert.equal(catalogWorldId, "catalog-one");
      assert.equal(persistenceWorldId, "world:catalog-one@overworld");
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
  legacyMigrationEligible?: boolean;
}>;

class FakeStorage {
  readonly events: string[] = [];
  readonly metadata: WorldMetadata;
  private bound: RustNativeWorldPersistenceSessionV1 | null = null;
  deleteCalls = 0;
  documentReads = 0;
  readonly hydrateOk: boolean;
  readonly legacyMigrationEligible: boolean;
  readonly bootstrapIdentity = deriveWorldGenerationIdentityV1({
    generatorVersion: 18,
    generatorProfile: "world-below-v15",
  } as WorldSave, {});

  constructor(worldId = "catalog-one", options: StorageFixtureOptions = {}) {
    this.hydrateOk = options.hydrateOk !== false;
    this.legacyMigrationEligible = options.legacyMigrationEligible === true;
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
  prepareNativeLegacyWorldMigration(worldId: string) {
    this.events.push(`migration-preflight:${worldId}`);
    return this.legacyMigrationEligible
      ? { ok: true as const, value: { seed: this.metadata.seed, generationIdentity: this.bootstrapIdentity, createdAt: this.metadata.createdAt } }
      : { ok: false as const, error: { code: "invalid" as const, message: "protected rich save is not eligible for world-only native migration" } };
  }
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
    multiplayerAuthority: () => authority([], config),
    authorityInterest: () => ({}) as ReturnType<RustWorldRuntimeManagedHostV1["authorityInterest"]>,
    runtimeAdapter: () => ({}) as ReturnType<RustWorldRuntimeManagedHostV1["runtimeAdapter"]>,
    runtimeService: () => ({}) as ReturnType<RustWorldRuntimeManagedHostV1["runtimeService"]>,
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
    this.host = managedHost(config, fakeSession(`${config.universeId}@${config.locationId}`, this.events));
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

function readyInputPumpFixture() {
  return Object.freeze({ diagnostics: () => Object.freeze({}) });
}

function saveAndQuitEnvironmentalFixture(): RustLivePlayerEnvironmentalSurvivalDiagnosticsR10 {
  return {
    schema: 1,
    producer: "rust-r5-r6-r7",
    typescriptDamageAuthoringCalls: 0,
    suppressedLegacyDamageCalls: 0,
    projectedDamageEvents: 1,
    projectedDeathEvents: 0,
    extractionRevision: "77",
    authorityTick: "840",
    effects: {
      schema: 1,
      producer: "rust-bwau-v2",
      playerExternalId: "player:local",
      authorityTick: "840",
      total: 3,
      selected: 3,
      omitted: 0,
      firstSequence: "4",
      lastSequence: "6",
      contiguous: true,
      cues: [
        { sequence: "4", tick: "826", entityExternalId: "player:local", kind: "shore-exit", amount: 0 },
        { sequence: "5", tick: "829", entityExternalId: "player:local", kind: "liquid-exit", amount: 0 },
        { sequence: "6", tick: "840", entityExternalId: "player:local", kind: "land", amount: 0 },
      ],
    },
    r6: {
      entityId: "41",
      entityRevision: "88",
      health: 9,
      maximumHealth: 10,
      oxygenSeconds: 12,
      maximumOxygenSeconds: 12,
      inLiquid: false,
      headSubmerged: false,
      contactFlags: 1,
      drowningAccumulator: 0,
      fallDistance: 0,
      lastDamageTick: "720",
    },
    r7: {
      entityId: "41",
      recordId: "rust-gameplay-r7-v1",
      rowRevision: "19",
      combatDomainRevision: "23",
      vitalUnits: "millihearts-v1",
      health: 9_000,
      maxHealth: 10_000,
      alive: true,
      crossDomainParity: true,
    },
  };
}

function nativeSaveDiagnosticsFixture(input: Readonly<{
  worldId: string;
  saves: number;
  platformOperations: number;
  requestBytes: number;
  responseBytes: number;
  lastCheckpointId: string | null;
}>): RustNativeWorldPersistenceDiagnosticsV1 {
  return {
    worldId: input.worldId,
    state: "open",
    saves: input.saves,
    recoveries: 1,
    legacyMigrations: 0,
    legacyMigrationRetries: 0,
    parentFallbacks: 0,
    platformOperations: input.platformOperations,
    requestBytes: input.requestBytes,
    responseBytes: input.responseBytes,
    lastCheckpointId: input.lastCheckpointId,
    lastError: null,
  };
}

test("new world binds and initializes native durability before controls open", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  (engine as unknown as { createWorld(): Pick<WorldMetadata, "id" | "generationIdentity"> }).createWorld = () => ({
    id: storage.metadata.id,
    generationIdentity: storage.metadata.generationIdentity,
  });
  (engine as unknown as { rustLastCompletedSaveAndQuitNativeCheckpoint: unknown })
    .rustLastCompletedSaveAndQuitNativeCheckpoint = Object.freeze({ schema: 1, stale: true });

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
  assert.equal(engine.getRustRuntimeDiagnostics().lastCompletedSaveAndQuitNativeCheckpoint, null);
  assert.equal(manager.configs[0]?.generationOptionsJson, storage.metadata.generationIdentity?.generationOptionsJson);
  assert.equal(manager.configs[0]?.terrainContentHash, storage.metadata.generationIdentity?.terrainContentHash);
});

test("multiplayer guest activation clears retained local Save & Quit evidence before new custody", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const template = createRustWorldRuntimeLiveConfigV1({
    worldId: "guest-bootstrap",
    worldSeed: storage.metadata.seed,
    sessionId: "runtime.guest-template",
  });
  const descriptor = createRustMultiplayerRuntimeDescriptorV2({
    worldSeed: "REMOTE-SEED",
    universeId: "world:remote-host",
    locationId: "overworld",
    runtimeSessionId: "runtime.remote-guest",
    generatorHash: template.generatorHash,
    contentHash: CONTENT,
    terrainContentHash: template.terrainContentHash,
    generationOptionsJson: template.generationOptionsJson,
  });
  (engine as unknown as { rustLastCompletedSaveAndQuitNativeCheckpoint: unknown })
    .rustLastCompletedSaveAndQuitNativeCheckpoint = Object.freeze({ schema: 1, stale: true });
  const inheritedPreflight = (engine as unknown as {
    prepareRustWorldTransition(reason: string, preserveMultiplayerSession: boolean): Promise<void>;
  }).prepareRustWorldTransition.bind(engine);
  let observedClearedBeforePreflight = false;
  (engine as unknown as {
    prepareRustWorldTransition(reason: string, preserveMultiplayerSession: boolean): Promise<void>;
  }).prepareRustWorldTransition = async (reason, preserveMultiplayerSession) => {
    observedClearedBeforePreflight = engine.getRustRuntimeDiagnostics()
      .lastCompletedSaveAndQuitNativeCheckpoint === null;
    await inheritedPreflight(reason, preserveMultiplayerSession);
  };

  const guestFactory = (engine as unknown as {
    guestRustAuthorityFactory(): (input: Readonly<{
      descriptor: typeof descriptor;
      signal: AbortSignal;
    }>) => Promise<unknown>;
  }).guestRustAuthorityFactory();
  await guestFactory({ descriptor, signal: new AbortController().signal });

  assert.equal(observedClearedBeforePreflight, true);
  assert.equal(engine.getRustRuntimeDiagnostics().lastCompletedSaveAndQuitNativeCheckpoint, null);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "guest-bootstrap");
  assert.equal(manager.configs.at(-1)?.universeId, descriptor.universeId);
  assert.equal(manager.configs.at(-1)?.sessionId, descriptor.runtimeSessionId);
});

test("multiplayer guest hydration detaches the prior catalog persistence owner", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const localSession = fakeSession("world:catalog-one@overworld", storage.events);
  assert.equal(storage.bindNativePersistence("catalog-one", localSession).ok, true);
  (engine as unknown as { rustNativePersistenceWorldId: string | null }).rustNativePersistenceWorldId = "catalog-one";
  const guestConfig: RustWorldRuntimeHostConfigV1 = {
    worldSeed: "REMOTE-SEED",
    universeId: "world:remote-host",
    locationId: "overworld",
    sessionId: "runtime.remote-guest",
    generatorHash: GENERATOR,
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
    waterBlockId: 7,
    directionalBlockIds: [],
    waterloggedBlockIds: [],
  };
  const guestHost = managedHost(
    guestConfig,
    fakeSession("world:remote-host@overworld", storage.events),
  );

  await (engine as unknown as {
    hydrateRustWorldPersistence(input: Parameters<RustWorldHydrationHookV1>[0]): Promise<void>;
  }).hydrateRustWorldPersistence({
    kind: "multiplayer-guest",
    worldId: guestConfig.universeId,
    save: null,
    host: guestHost,
  });

  assert.equal(engine.getRustRuntimeDiagnostics().nativePersistenceWorldId, null);
  assert.deepEqual(storage.events, ["bind:catalog-one", "session-drain"]);
});

test("multiplayer guest hydration fails closed when stale persistence detachment fails", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  (engine as unknown as { rustNativePersistenceWorldId: string | null }).rustNativePersistenceWorldId = "catalog-one";
  storage.shutdownNativePersistence = async () => {
    storage.events.push("session-drain-failed");
    throw new Error("stale persistence detachment failed");
  };
  const guestConfig: RustWorldRuntimeHostConfigV1 = {
    worldSeed: "REMOTE-SEED",
    universeId: "world:remote-host",
    locationId: "overworld",
    sessionId: "runtime.remote-guest",
    generatorHash: GENERATOR,
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
    waterBlockId: 7,
    directionalBlockIds: [],
    waterloggedBlockIds: [],
  };

  await assert.rejects(
    (engine as unknown as {
      hydrateRustWorldPersistence(input: Parameters<RustWorldHydrationHookV1>[0]): Promise<void>;
    }).hydrateRustWorldPersistence({
      kind: "multiplayer-guest",
      worldId: guestConfig.universeId,
      save: null,
      host: managedHost(guestConfig, fakeSession("world:remote-host@overworld", storage.events)),
    }),
    /stale persistence detachment failed/u,
  );
  assert.equal(engine.getRustRuntimeDiagnostics().nativePersistenceWorldId, null);
  assert.deepEqual(storage.events, ["session-drain-failed"]);
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
    /not eligible for world-only native migration/u,
  );
  assert.deepEqual(storage.events, ["catalog-read", `migration-preflight:${storage.metadata.id}`]);
  assert.equal(manager.configs.length, 0);
  assert.equal(storage.documentReads, 0);
  assert.equal(engine.running, false);
});

test("stored world with an eligible legacy-only source uses the guarded migration bootstrap", async () => {
  const storage = new FakeStorage("catalog-legacy", {
    generationIdentity: null,
    legacyMigrationEligible: true,
  });
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  (engine as unknown as { loadWorld(save: WorldSave, options: unknown, id: string): void }).loadWorld = (_save, _options, id) => {
    storage.events.push(`mirror-present:${id}`);
    engine.activeWorldId = id;
  };

  await engine.loadStoredWorldWithRustRuntime(storage.metadata.id);

  assert.deepEqual(storage.events.slice(0, 6), [
    "catalog-read",
    `migration-preflight:${storage.metadata.id}`,
    "session-drain",
    `activate:${storage.metadata.id}`,
    `bind:${storage.metadata.id}`,
    `hydrate:${storage.metadata.id}`,
  ]);
  assert.equal(manager.configs[0]?.generationOptionsJson, storage.bootstrapIdentity.generationOptionsJson);
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

test("engine shutdown drains authority work around autosave and multiplayer before destroying the worker", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  Object.assign(engine, {
    animationFrame: 0,
    clearInput: () => storage.events.push("input-blocked"),
    unbindEvents: () => storage.events.push("events-unbound"),
    saveNow: () => { storage.events.push("autosave-enqueued"); return true; },
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
    // Lifecycle settlement drains while mutation admission is still open;
    // shutdown blocks new work and drains once more before starting autosave.
    "authority-drained",
    "authority-drained",
    "autosave-enqueued",
    "authority-drained",
    "flush",
    "multiplayer-drained",
    "authority-drained",
    "session-drain",
    "manager-shutdown",
    "resources-released",
  ]);
});

test("Save & Quit retains one immutable native checkpoint and terminal survival attestation after teardown", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  const nativeWorldId = "world:catalog-one@overworld";
  const config: RustWorldRuntimeHostConfigV1 = {
    worldSeed: storage.metadata.seed,
    universeId: "world:catalog-one",
    locationId: "overworld",
    sessionId: "runtime.save-quit-fixture",
    catalogWorldId: "catalog-one",
    generatorHash: GENERATOR,
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
    waterBlockId: 7,
    directionalBlockIds: [],
    waterloggedBlockIds: [],
  };
  const before = nativeSaveDiagnosticsFixture({
    worldId: nativeWorldId,
    saves: 4,
    platformOperations: 10,
    requestBytes: 100,
    responseBytes: 200,
    lastCheckpointId: "checkpoint-before",
  });
  const after = nativeSaveDiagnosticsFixture({
    worldId: nativeWorldId,
    saves: 5,
    platformOperations: 13,
    requestBytes: 112,
    responseBytes: 207,
    lastCheckpointId: "checkpoint-save-quit",
  });
  let currentDiagnostics = before;
  const session = {
    worldId: nativeWorldId,
    async shutdown() { events.push("session-shutdown"); },
    diagnostics: () => currentDiagnostics,
  } as unknown as RustNativeWorldPersistenceSessionV1;
  const host = managedHost(config, session);
  manager.host = host;
  const checkpoint = {
    worldId: nativeWorldId,
    saveId: "native.save.quit.5",
    checkpointId: "checkpoint-save-quit",
    checkpointHash: "e".repeat(32),
    journalSequence: 12,
    records: 8,
    commits: 3,
    requestBytes: 12,
    responseBytes: 7,
  } satisfies RustNativeWorldPersistenceSaveV1;
  const terminalEnvironmentalSurvival = saveAndQuitEnvironmentalFixture();
  Object.assign(engine, {
    rustRuntimeHost: host,
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "restored",
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    titleMode: false,
    cancelRustOriginPreflight: () => undefined,
    cancelTerrainLocatorConsumerOperations: () => undefined,
    terrainGenerationReadinessAbort: null,
    clearInput: () => undefined,
    closeContainer: () => events.push("container-closed"),
    rustLiveEnvironmentalSurvivalDiagnosticsSnapshotR10: () => terminalEnvironmentalSurvival,
    saveNow: () => {
      events.push("save-enqueued");
      const operation = Promise.resolve().then(() => {
        currentDiagnostics = after;
        events.push("checkpoint-committed");
        return checkpoint;
      });
      (engine as unknown as { rustNativeSaveOperation: Promise<RustNativeWorldPersistenceSaveV1> | null })
        .rustNativeSaveOperation = operation;
      return true;
    },
    disconnectMultiplayer: async () => { events.push("multiplayer-disconnected"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => {
      events.push("persistence-stopped");
      (engine as unknown as { rustNativePersistenceWorldId: string | null }).rustNativePersistenceWorldId = null;
    },
  });
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { pointerLockElement: null } });
  try {
    await engine.quitToTitleAsync();
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else delete (globalThis as { document?: Document }).document;
  }

  const retained = engine.getRustRuntimeDiagnostics().lastCompletedSaveAndQuitNativeCheckpoint;
  assert.ok(retained);
  assert.deepEqual(retained.binding, {
    catalogWorldId: "catalog-one",
    nativeWorldId,
    universeId: "world:catalog-one",
    locationId: "overworld",
    runtimeSessionId: "runtime.save-quit-fixture",
  });
  assert.deepEqual(retained.checkpoint, checkpoint);
  assert.equal(retained.persistence.before.saves, 4);
  assert.equal(retained.persistence.after.saves, 5);
  assert.equal(retained.persistence.before.platformOperations, 10);
  assert.equal(retained.persistence.after.platformOperations, 13);
  assert.equal(retained.persistence.after.lastCheckpointId, checkpoint.checkpointId);
  assert.deepEqual(retained.terminalEnvironmentalSurvival, terminalEnvironmentalSurvival);
  assert.ok(events.indexOf("checkpoint-committed") < events.indexOf("player-stopped"));

  assert.equal(Object.isFrozen(retained), true);
  assert.equal(Object.isFrozen(retained.binding), true);
  assert.equal(Object.isFrozen(retained.checkpoint), true);
  assert.equal(Object.isFrozen(retained.persistence), true);
  assert.equal(Object.isFrozen(retained.persistence.before), true);
  assert.equal(Object.isFrozen(retained.persistence.after), true);
  assert.equal(Object.isFrozen(retained.terminalEnvironmentalSurvival), true);
  assert.equal(Object.isFrozen(retained.terminalEnvironmentalSurvival?.effects), true);
  assert.equal(Object.isFrozen(retained.terminalEnvironmentalSurvival?.effects.cues), true);
  assert.equal(Object.isFrozen(retained.terminalEnvironmentalSurvival?.effects.cues[0]), true);
  assert.equal(Object.isFrozen(retained.terminalEnvironmentalSurvival?.r6), true);
  assert.equal(Object.isFrozen(retained.terminalEnvironmentalSurvival?.r7), true);
  assert.equal(Reflect.set(retained.checkpoint, "checkpointId", "tampered"), false);
  checkpoint.checkpointId = "mutated-source";
  (terminalEnvironmentalSurvival.r6 as { health: number }).health = 1;
  assert.equal(retained.checkpoint.checkpointId, "checkpoint-save-quit");
  assert.equal(retained.terminalEnvironmentalSurvival?.r6.health, 9);
});

test("Save & Quit clears retained evidence before a failed replacement checkpoint", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const checkpointFailure = new Error("replacement native checkpoint rejected");
  (engine as unknown as { rustLastCompletedSaveAndQuitNativeCheckpoint: unknown })
    .rustLastCompletedSaveAndQuitNativeCheckpoint = Object.freeze({ schema: 1, stale: true });
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    titleMode: false,
    cancelRustOriginPreflight: () => undefined,
    cancelTerrainLocatorConsumerOperations: () => undefined,
    terrainGenerationReadinessAbort: null,
    clearInput: () => undefined,
    drainRustAuthorityOperations: async () => undefined,
    closeContainer: () => undefined,
    saveNow: () => {
      (engine as unknown as { rustNativeSaveOperation: Promise<unknown> | null })
        .rustNativeSaveOperation = Promise.reject(checkpointFailure);
      return true;
    },
  });
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { pointerLockElement: null } });
  try {
    await assert.rejects(engine.quitToTitleAsync(), /replacement native checkpoint rejected/u);
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else delete (globalThis as { document?: Document }).document;
  }
  assert.equal(engine.getRustRuntimeDiagnostics().lastCompletedSaveAndQuitNativeCheckpoint, null);
  assert.equal(engine.running, true);
  assert.equal(engine.paused, false);
  assert.equal((engine as unknown as { titleMode: boolean }).titleMode, false);
});

test("Save & Quit fails closed when post-commit persistence counters cannot attest the checkpoint", () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const nativeWorldId = "world:catalog-one@overworld";
  const diagnostics = nativeSaveDiagnosticsFixture({
    worldId: nativeWorldId,
    saves: 7,
    platformOperations: 20,
    requestBytes: 300,
    responseBytes: 400,
    lastCheckpointId: "checkpoint-before",
  });
  const config: RustWorldRuntimeHostConfigV1 = {
    worldSeed: storage.metadata.seed,
    universeId: "world:catalog-one",
    locationId: "overworld",
    sessionId: "runtime.counter-mismatch",
    catalogWorldId: "catalog-one",
    generatorHash: GENERATOR,
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
    waterBlockId: 7,
    directionalBlockIds: [],
    waterloggedBlockIds: [],
  };
  const session = {
    worldId: nativeWorldId,
    async shutdown() {},
    diagnostics: () => diagnostics,
  } as unknown as RustNativeWorldPersistenceSessionV1;
  const host = managedHost(config, session);
  Object.assign(engine, {
    rustRuntimeHost: host,
    rustRuntimeOperationsBlocked: true,
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
  });
  const methods = engine as unknown as {
    saveAndQuitNativeCheckpointContextV1(): unknown;
    retainCompletedSaveAndQuitNativeCheckpointV1(
      context: unknown,
      checkpoint: RustNativeWorldPersistenceSaveV1,
    ): void;
  };
  const context = methods.saveAndQuitNativeCheckpointContextV1();
  assert.ok(context);
  assert.throws(() => methods.retainCompletedSaveAndQuitNativeCheckpointV1(context, {
    worldId: nativeWorldId,
    saveId: "native.save.quit.8",
    checkpointId: "checkpoint-after",
    checkpointHash: "f".repeat(32),
    journalSequence: 13,
    records: 8,
    commits: 2,
    requestBytes: 16,
    responseBytes: 9,
  }), /did not prove one exact durable session commit/u);
  const retained = engine.getRustRuntimeDiagnostics();
  assert.equal(retained.lastCompletedSaveAndQuitNativeCheckpoint, null);
  assert.equal(retained.operationsBlocked, true);
  assert.equal(retained.playerAuthority.state, "blocked");
});

test("Save & Quit restores the live world when a checkpoint failure leaves native authority ready", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  const checkpointFailure = new Error("commit-record-capacity: native world checkpoint rejected");
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    titleMode: false,
    cancelRustOriginPreflight: () => { events.push("origin-cancelled"); },
    cancelTerrainLocatorConsumerOperations: () => { events.push("locator-cancelled"); },
    terrainGenerationReadinessAbort: null,
    clearInput: () => { events.push("input-cleared"); },
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    closeContainer: () => { events.push("container-closed"); },
    saveNow: () => {
      events.push("save-enqueued");
      (engine as unknown as { rustNativeSaveOperation: Promise<unknown> | null }).rustNativeSaveOperation = Promise.reject(checkpointFailure);
      return true;
    },
    disconnectMultiplayer: async () => { events.push("multiplayer-disconnected"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stopped"); },
  });
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { pointerLockElement: null },
  });
  try {
    await assert.rejects(engine.quitToTitleAsync(), /commit-record-capacity/u);
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else delete (globalThis as { document?: Document }).document;
  }
  assert.equal(engine.running, true);
  assert.equal(engine.paused, false);
  assert.equal((engine as unknown as { titleMode: boolean }).titleMode, false);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, false);
  assert.deepEqual(events, [
    "origin-cancelled",
    "locator-cancelled",
    "input-cleared",
    // Save & Quit first drains active work, then settlement performs its own
    // fail-closed drain before inspecting pending finalize/selection custody.
    "authority-drained",
    "authority-drained",
    "container-closed",
    "save-enqueued",
  ]);
});

test("Save & Quit never reopens gameplay after its native checkpoint quarantines authority", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  const checkpointFailure = new Error("native-checkpoint-indeterminate: terminal identity is unknown");
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    titleMode: false,
    cancelRustOriginPreflight: () => undefined,
    cancelTerrainLocatorConsumerOperations: () => undefined,
    terrainGenerationReadinessAbort: null,
    clearInput: () => { events.push("input-cleared"); },
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    closeContainer: () => { events.push("container-closed"); },
    saveNow: () => {
      const operation = Promise.reject(checkpointFailure);
      void operation.catch(() => {
        (engine as unknown as { rustRuntimeOperationsBlocked: boolean }).rustRuntimeOperationsBlocked = true;
        (engine as unknown as { rustLivePlayerAuthorityState: string }).rustLivePlayerAuthorityState = "blocked";
        engine.running = false;
        engine.paused = true;
        events.push("authority-quarantined");
      });
      (engine as unknown as { rustNativeSaveOperation: Promise<unknown> | null }).rustNativeSaveOperation = operation;
      return true;
    },
    disconnectMultiplayer: async () => { events.push("multiplayer-disconnected"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stopped"); },
  });
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { pointerLockElement: null } });
  try {
    await assert.rejects(engine.quitToTitleAsync(), /native-checkpoint-indeterminate/u);
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else delete (globalThis as { document?: Document }).document;
  }
  assert.equal(engine.running, false);
  assert.equal(engine.paused, true);
  assert.equal((engine as unknown as { titleMode: boolean }).titleMode, false);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, true);
  assert.deepEqual(events, [
    "input-cleared",
    "authority-drained",
    "authority-drained",
    "container-closed",
    "authority-quarantined",
  ]);
});

test("Save & Quit does not tear down native custody when the browser world document fails", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    titleMode: false,
    cancelRustOriginPreflight: () => undefined,
    cancelTerrainLocatorConsumerOperations: () => undefined,
    terrainGenerationReadinessAbort: null,
    clearInput: () => undefined,
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    closeContainer: () => { events.push("container-closed"); },
    saveNow: () => { events.push("browser-save-failed"); return false; },
    disconnectMultiplayer: async () => { events.push("multiplayer-disconnected"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stopped"); },
  });
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { pointerLockElement: null } });
  try {
    await assert.rejects(engine.quitToTitleAsync(), /browser-owned world document/u);
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else delete (globalThis as { document?: Document }).document;
  }
  assert.equal(engine.running, true);
  assert.equal(engine.paused, false);
  assert.equal((engine as unknown as { titleMode: boolean }).titleMode, false);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, false);
  assert.deepEqual(events, [
    "authority-drained",
    "authority-drained",
    "container-closed",
    "browser-save-failed",
  ]);
});

test("Save & Quit rejects a mismatched R5 native binding before save or teardown and restores gameplay", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "restored",
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-other",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    titleMode: false,
    cancelRustOriginPreflight: () => { events.push("origin-cancelled"); },
    cancelTerrainLocatorConsumerOperations: () => { events.push("locator-cancelled"); },
    terrainGenerationReadinessAbort: null,
    clearInput: () => { events.push("input-cleared"); },
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    closeContainer: () => { events.push("container-closed"); },
    saveNow: () => { events.push("save-enqueued"); return true; },
    disconnectMultiplayer: async () => { events.push("multiplayer-disconnected"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stopped"); },
  });
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { pointerLockElement: null } });
  try {
    await assert.rejects(engine.quitToTitleAsync(), /attest the active catalog world/u);
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else delete (globalThis as { document?: Document }).document;
  }
  assert.equal(engine.running, true);
  assert.equal(engine.paused, false);
  assert.equal((engine as unknown as { titleMode: boolean }).titleMode, false);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, false);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "restored");
  assert.deepEqual(events, [
    "origin-cancelled",
    "locator-cancelled",
    "input-cleared",
    "authority-drained",
    "authority-drained",
    "container-closed",
  ]);
});

test("world transition preflight restores the live session when its browser save fails", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  Reflect.deleteProperty(engine, "prepareRustWorldTransition");
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "restored",
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    clearInput: () => { events.push("input-cleared"); },
    cancelTerrainLocatorConsumerOperations: () => { events.push("locator-cancelled"); },
    terrainGenerationReadinessAbort: null,
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    saveNow: () => { events.push("browser-save-failed"); return false; },
    closeMultiplayerForRustTransition: async () => { events.push("multiplayer-closed"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stopped"); },
  });

  await assert.rejects(
    (engine as unknown as { prepareRustWorldTransition(reason: string): Promise<void> }).prepareRustWorldTransition("world-load"),
    /browser-owned world document/u,
  );
  assert.equal(engine.running, true);
  assert.equal(engine.paused, false);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, false);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "restored");
  assert.deepEqual(events, ["input-cleared", "locator-cancelled", "authority-drained", "browser-save-failed"]);
});

test("preserved guest transition requests its admitted native checkpoint before local authority teardown", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  Reflect.deleteProperty(engine, "prepareRustWorldTransition");
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "restored",
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    rustLiveSelectedSlotIntentPendingR5: true,
    rustLiveInputAdvance: null,
    clearInput: () => { events.push("input-cleared"); },
    cancelTerrainLocatorConsumerOperations: () => { events.push("locator-cancelled"); },
    terrainGenerationReadinessAbort: null,
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    scheduleRustLiveInputAdvanceR5: () => {
      events.push("slot-acknowledgement-started");
      assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, false,
        "the old native pump remains admitted only for its terminal selected-slot acknowledgement");
      const operation = Promise.resolve().then(() => {
        events.push("slot-acknowledged");
        (engine as unknown as { rustLiveSelectedSlotIntentPendingR5: boolean })
          .rustLiveSelectedSlotIntentPendingR5 = false;
      });
      (engine as unknown as { rustLiveInputAdvance: Promise<void> | null }).rustLiveInputAdvance = operation;
    },
    saveNow: (notify: boolean, allowPristineGuestTransitionCheckpoint: boolean) => {
      events.push(`browser-save:${notify}:${allowPristineGuestTransitionCheckpoint}`);
      const operation = Promise.resolve().then(() => {
        events.push("native-checkpoint");
        return Object.freeze({ checkpointId: "guest-transition-checkpoint" });
      });
      (engine as unknown as { rustNativeSaveOperation: Promise<unknown> | null }).rustNativeSaveOperation = operation;
      return true;
    },
    closeMultiplayerForRustTransition: async () => { events.push("multiplayer-closed"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stopped"); },
  });

  await (engine as unknown as {
    prepareRustWorldTransition(reason: string, preserveMultiplayerSession: boolean): Promise<void>;
  }).prepareRustWorldTransition("multiplayer-guest", true);

  assert.equal(engine.running, false);
  assert.equal(engine.paused, true);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, true);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "none");
  assert.deepEqual(storage.events, ["flush"]);
  assert.deepEqual(events, [
    "input-cleared",
    "locator-cancelled",
    "authority-drained",
    "slot-acknowledgement-started",
    "slot-acknowledged",
    "authority-drained",
    "browser-save:false:true",
    "native-checkpoint",
    "authority-drained",
    "player-stopped",
    "renderer-stopped",
    "persistence-stopped",
  ]);
});

test("world transition rejects a resolved native-save no-op without tearing down local authority", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  Reflect.deleteProperty(engine, "prepareRustWorldTransition");
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "restored",
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    clearInput: () => undefined,
    cancelTerrainLocatorConsumerOperations: () => undefined,
    terrainGenerationReadinessAbort: null,
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    saveNow: () => {
      events.push("browser-save");
      (engine as unknown as { rustNativeSaveOperation: Promise<null> | null }).rustNativeSaveOperation = Promise.resolve(null);
      return true;
    },
    closeMultiplayerForRustTransition: async () => { events.push("multiplayer-closed"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stopped"); },
  });

  await assert.rejects(
    (engine as unknown as { prepareRustWorldTransition(reason: string): Promise<void> })
      .prepareRustWorldTransition("world-load"),
    /could not attest the required authoritative Rust checkpoint/u,
  );

  assert.equal(engine.running, true);
  assert.equal(engine.paused, false);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, false);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "restored");
  assert.deepEqual(events, ["authority-drained", "browser-save"]);
  assert.deepEqual(storage.events, []);
});

test("world transition preflight preserves quarantine after an indeterminate native checkpoint", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  const checkpointFailure = new Error("native transition checkpoint became indeterminate");
  Reflect.deleteProperty(engine, "prepareRustWorldTransition");
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "restored",
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    clearInput: () => undefined,
    cancelTerrainLocatorConsumerOperations: () => undefined,
    terrainGenerationReadinessAbort: null,
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    saveNow: () => {
      const operation = Promise.reject(checkpointFailure);
      void operation.catch(() => {
        (engine as unknown as { rustRuntimeOperationsBlocked: boolean }).rustRuntimeOperationsBlocked = true;
        (engine as unknown as { rustLivePlayerAuthorityState: string }).rustLivePlayerAuthorityState = "blocked";
        engine.running = false;
        engine.paused = true;
        events.push("authority-quarantined");
      });
      (engine as unknown as { rustNativeSaveOperation: Promise<void> | null }).rustNativeSaveOperation = operation;
      return true;
    },
    closeMultiplayerForRustTransition: async () => { events.push("multiplayer-closed"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stopped"); },
  });

  await assert.rejects(
    (engine as unknown as { prepareRustWorldTransition(reason: string): Promise<void> }).prepareRustWorldTransition("world-load"),
    /became indeterminate/u,
  );
  assert.equal(engine.running, false);
  assert.equal(engine.paused, true);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, true);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "restored");
  assert.deepEqual(events, ["authority-drained", "authority-quarantined"]);
});

test("world transition rejects a mismatched R5 native binding before save or teardown and restores the live state", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  Reflect.deleteProperty(engine, "prepareRustWorldTransition");
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "restored",
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-other",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    clearInput: () => { events.push("input-cleared"); },
    cancelTerrainLocatorConsumerOperations: () => { events.push("locator-cancelled"); },
    terrainGenerationReadinessAbort: null,
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    saveNow: () => { events.push("save-enqueued"); return true; },
    closeMultiplayerForRustTransition: async () => { events.push("multiplayer-closed"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stopped"); },
  });

  await assert.rejects(
    (engine as unknown as { prepareRustWorldTransition(reason: string): Promise<void> }).prepareRustWorldTransition("world-load"),
    /attest the active catalog world/u,
  );
  assert.equal(engine.running, true);
  assert.equal(engine.paused, false);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, false);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "restored");
  assert.deepEqual(events, ["input-cleared", "locator-cancelled", "authority-drained"]);
});

test("post-save world transition attempts every teardown owner when multiplayer close fails", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  Reflect.deleteProperty(engine, "prepareRustWorldTransition");
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "restored",
    rustLivePlayerAuthorityRequestedR5: false,
    rustLivePlayerAuthorityState: "none",
    rustNativePersistenceWorldId: null,
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    clearInput: () => { events.push("input-cleared"); },
    cancelTerrainLocatorConsumerOperations: () => { events.push("locator-cancelled"); },
    terrainGenerationReadinessAbort: null,
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    saveNow: () => { events.push("browser-save-committed"); return true; },
    closeMultiplayerForRustTransition: async () => {
      events.push("multiplayer-close-attempted");
      throw new Error("network close failed");
    },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stop-attempted"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-dispose-attempted"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stop-attempted"); },
  });

  await assert.rejects(
    (engine as unknown as { prepareRustWorldTransition(reason: string): Promise<void> }).prepareRustWorldTransition("world-load"),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /did not release every prior authority owner/u);
      assert.deepEqual(error.errors.map((entry) => entry instanceof Error ? entry.message : String(entry)), ["network close failed"]);
      return true;
    },
  );
  assert.equal(engine.running, false);
  assert.equal(engine.paused, true);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, true);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "none");
  assert.deepEqual(storage.events, ["flush"]);
  assert.deepEqual(events, [
    "input-cleared",
    "locator-cancelled",
    "authority-drained",
    "browser-save-committed",
    "authority-drained",
    "multiplayer-close-attempted",
    "player-stop-attempted",
    "renderer-dispose-attempted",
    "persistence-stop-attempted",
  ]);
});

test("stored-world wrapper preserves the old live runtime when tagged transition preflight fails", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  let cleanups = 0;
  Reflect.deleteProperty(engine, "prepareRustWorldTransition");
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "restored",
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLiveInputPump: readyInputPumpFixture(),
    rustNativePersistenceWorldId: "catalog-one",
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    clearInput: () => { events.push("input-cleared"); },
    cancelTerrainLocatorConsumerOperations: () => { events.push("locator-cancelled"); },
    terrainGenerationReadinessAbort: null,
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    saveNow: () => { events.push("browser-save-failed"); return false; },
    cleanupFailedRustWorldRuntime: async () => { cleanups += 1; },
  });

  await assert.rejects(engine.loadStoredWorldWithRustRuntime("catalog-one"), /browser-owned world document/u);
  assert.equal(engine.running, true);
  assert.equal(engine.paused, false);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, false);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "restored");
  assert.equal(cleanups, 0, "a tagged preflight failure must not tear down the old live runtime");
  assert.equal(manager.configs.length, 0, "the replacement runtime must not activate after preflight failure");
  assert.equal(storage.documentReads, 0, "the replacement compatibility document must remain unopened");
  assert.deepEqual(storage.events, ["catalog-read"]);
  assert.deepEqual(events, ["input-cleared", "locator-cancelled", "authority-drained", "browser-save-failed"]);
});

test("post-save quit cleanup is best-effort and still reaches one coherent title state", async () => {
  const storage = new FakeStorage();
  const manager = new FakeManager(storage.events);
  const engine = engineHarness(storage, manager);
  const events: string[] = [];
  Object.assign(engine, {
    rustRuntimeOperationsBlocked: false,
    rustLivePlayerAuthorityRequestedR5: false,
    rustLivePlayerAuthorityState: "none",
    rustNativePersistenceWorldId: null,
    activeWorldId: "catalog-one",
    persistent: true,
    running: true,
    paused: false,
    titleMode: false,
    cancelRustOriginPreflight: () => undefined,
    cancelTerrainLocatorConsumerOperations: () => undefined,
    terrainGenerationReadinessAbort: null,
    clearInput: () => undefined,
    drainRustAuthorityOperations: async () => { events.push("authority-drained"); },
    closeContainer: () => undefined,
    saveNow: () => true,
    disconnectMultiplayer: async () => { events.push("multiplayer-disconnected"); throw new Error("network close failed"); },
    stopRustLivePlayerAuthorityR5: async () => { events.push("player-stopped"); },
    disposeRustLiveRendererR10: async () => { events.push("renderer-stopped"); },
    shutdownBoundNativePersistence: async () => { events.push("persistence-stopped"); },
    events: { onToast: (message: string) => { events.push(`toast:${message}`); }, onSave: () => undefined },
  });
  manager.shutdown = async () => { events.push("manager-stopped"); };
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { pointerLockElement: null } });
  try {
    await engine.quitToTitleAsync();
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else delete (globalThis as { document?: Document }).document;
  }
  assert.equal(engine.running, false);
  assert.equal(engine.paused, true);
  assert.equal((engine as unknown as { titleMode: boolean }).titleMode, true);
  assert.equal((engine as unknown as { persistent: boolean }).persistent, false);
  assert.equal(engine.getRustRuntimeDiagnostics().operationsBlocked, true);
  assert.equal(engine.getRustRuntimeDiagnostics().hydration, "blocked");
  assert.deepEqual(events, [
    // Initial drain, settlement drain, then the post-checkpoint drain that
    // closes the last authority tail before transport teardown.
    "authority-drained",
    "authority-drained",
    "authority-drained",
    "multiplayer-disconnected",
    "authority-drained",
    "player-stopped",
    "renderer-stopped",
    "persistence-stopped",
    "manager-stopped",
    "toast:World saved, but native shutdown needs recovery (multiplayer disconnect: network close failed)",
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
  assert.match(shell, /titleMenuView === "main"[\s\S]*worldNotice[\s\S]*role="alert"/u);
  assert.match(shell, /catch \(error\) \{\s*prepareFirstPersonHeldPresentation\(engine\);\s*showToast/u);
  const persistenceFactory = host.match(/function productionNativePersistence[\s\S]*?(?=\/\*\*\r?\n \* Owns exactly one integrated Rust worker)/u)?.[0] ?? "";
  assert.match(persistenceFactory, /productionRuntimeService\(input\.adapter\)/u);
  assert.doesNotMatch(persistenceFactory, /new RustIntegratedRuntimeBrowserAdapterV1/u);
});
