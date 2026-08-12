import assert from "node:assert/strict";
import test from "node:test";

import type { RustContentInstallReceiptV1, RustProductionContentBundle } from "../app/game/rust-integrated-runtime-content";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1, type RustIntegratedRuntimeConfigV1, type RustIntegratedRuntimeIdentityV1 } from "../app/game/rust-integrated-runtime-contract";
import type { RustIntegratedRuntimeServiceV1 } from "../app/game/rust-integrated-runtime-service";
import type { RustMultiplayerAuthorityV1 } from "../app/game/rust-multiplayer-authority";
import {
  RustWorldRuntimeHostV1,
  resolveRustEngineArtifactHashV1,
  type RustWorldRuntimeAdapterV1,
} from "../app/game/rust-world-runtime-host";

const ARTIFACT = "a".repeat(64);
const CONTENT = "b".repeat(32);
const GENERATOR = "c".repeat(32);

const identity = (world = 0): RustIntegratedRuntimeIdentityV1 => Object.freeze({
  universeId: "world:test",
  locationId: "surface",
  revision: Object.freeze({ epoch: 1, world, entities: 0, gameplay: 0, persistence: 0, network: 0, simulation: 0 }),
  tick: 0,
  stateHash: "d".repeat(32),
});

const bundle = (): RustProductionContentBundle => Object.freeze({
  manifest: Object.freeze({
    schemaVersion: 1,
    sourceRevision: "fixture",
    domains: Object.freeze({}),
    entries: Object.freeze([]),
    manifestHash: CONTENT,
  }),
  artifacts: Object.freeze([{ domain: "item", id: "item:test", schemaId: "item-definition", schemaVersion: 1, contentVersion: 1, aliases: Object.freeze([]), canonicalBytes: Uint8Array.of(0x80), unknownExtensionBytes: new Uint8Array(), blobHash: "e".repeat(32) }]),
  blockers: Object.freeze([]),
}) as unknown as RustProductionContentBundle;

class FakeAdapter implements RustWorldRuntimeAdapterV1 {
  readonly service = Object.freeze({ fixture: "sole-runtime-service" }) as unknown as RustIntegratedRuntimeServiceV1;
  current = identity();
  calls: string[] = [];
  authoritative = true;
  contentReady = true;

  async start(config: RustIntegratedRuntimeConfigV1) {
    this.calls.push(`start:${config.contentHash}:${config.generatorHash}`);
    return this.current;
  }

  async installContent(value: RustProductionContentBundle) {
    this.calls.push(`content:${value.manifest?.manifestHash}`);
    return Object.freeze({
      status: "installed",
      installId: `install:${CONTENT}`,
      sourceRevision: "fixture",
      manifestHash: CONTENT,
      domains: Object.freeze({}),
      acceptedPages: 1,
      pageCount: 1,
      acceptedEntries: 1,
      installedEntries: 1,
      registryHash: "f".repeat(32),
    }) as unknown as RustContentInstallReceiptV1;
  }

  async shutdown() { this.calls.push("shutdown"); }
  identity() { return this.current; }
  diagnostics() { return Object.freeze({ authoritative: this.authoritative, contentReady: this.contentReady, contentManifestHash: CONTENT }); }
}

function fakeAuthority(calls: string[], drainError: Error | null = null): RustMultiplayerAuthorityV1 {
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
    drain: async () => { calls.push("drain"); if (drainError) throw drainError; },
  };
}

test("engine index resolves one exact content-addressed compatibility artifact", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    schema: 1,
    defaultVariant: "compatibility",
    artifacts: { compatibility: { hash: ARTIFACT, directory: ARTIFACT, manifest: `${ARTIFACT}/manifest.json` } },
  }), { status: 200, headers: { "content-type": "application/json" } });
  assert.equal(await resolveRustEngineArtifactHashV1(fetchImpl), ARTIFACT);
  await assert.rejects(() => resolveRustEngineArtifactHashV1(async () => new Response(JSON.stringify({
    schema: 1,
    defaultVariant: "compatibility",
    artifacts: { compatibility: { hash: ARTIFACT, directory: "mutable", manifest: `${ARTIFACT}/manifest.json` } },
  }), { status: 200 })), /content-addressed/u);
});

test("one world host installs content before exposing its multiplayer authority", async () => {
  const adapter = new FakeAdapter();
  const host = new RustWorldRuntimeHostV1({
    worldSeed: "seed", universeId: "world:test", locationId: "surface", sessionId: "session",
    generatorHash: GENERATOR, ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1, waterBlockId: 7, directionalBlockIds: [9, 2], waterloggedBlockIds: [18],
  }, {
    artifactHash: ARTIFACT,
    contentFactory: bundle,
    adapterFactory: () => adapter,
    authorityFactory: (_adapter, identityFactory) => {
      assert.equal(identityFactory().address.universeId, "world:test");
      return fakeAuthority(adapter.calls);
    },
  });
  assert.throws(() => host.runtimeService(), /not ready/u);
  await host.start();
  assert.deepEqual(adapter.calls.slice(0, 2), [`start:${CONTENT}:${GENERATOR}`, `content:${CONTENT}`]);
  assert.equal(host.diagnostics().state, "ready");
  assert.equal(host.multiplayerAuthority().backend, "rust-wasm-worker");
  assert.equal(host.runtimeService(), adapter.service, "host exposes the exact service owned by its adapter");
  await host.shutdown();
  assert.deepEqual(adapter.calls.slice(-2), ["drain", "shutdown"]);
  assert.throws(() => host.runtimeService(), /not ready/u);
});

test("failed content attestation shuts down the sole worker and exposes no authority", async () => {
  const adapter = new FakeAdapter();
  adapter.contentReady = false;
  const host = new RustWorldRuntimeHostV1({
    worldSeed: "seed", universeId: "world:test", locationId: "surface", sessionId: "session",
    generatorHash: GENERATOR, ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1, waterBlockId: 7, directionalBlockIds: [], waterloggedBlockIds: [],
  }, { artifactHash: ARTIFACT, contentFactory: bundle, adapterFactory: () => adapter, authorityFactory: () => fakeAuthority(adapter.calls) });
  await assert.rejects(() => host.start(), /non-authoritative/u);
  assert.equal(host.diagnostics().state, "failed");
  assert.deepEqual(adapter.calls.slice(-1), ["shutdown"]);
  assert.throws(() => host.multiplayerAuthority(), /not ready/u);
});

test("worker shutdown is attempted even when authority draining fails", async () => {
  const adapter = new FakeAdapter();
  const host = new RustWorldRuntimeHostV1({
    worldSeed: "seed", universeId: "world:test", locationId: "surface", sessionId: "session",
    generatorHash: GENERATOR, ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1, waterBlockId: 7, directionalBlockIds: [], waterloggedBlockIds: [],
  }, {
    artifactHash: ARTIFACT,
    contentFactory: bundle,
    adapterFactory: () => adapter,
    authorityFactory: () => fakeAuthority(adapter.calls, new Error("drain failed")),
  });
  await host.start();
  await assert.rejects(() => host.shutdown(), /drain failed/u);
  assert.deepEqual(adapter.calls.slice(-2), ["drain", "shutdown"]);
  assert.equal(host.diagnostics().state, "failed");
});
