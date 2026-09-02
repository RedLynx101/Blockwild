import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { TerrainGenerationPipeline, type TerrainGenerationWorkerLike } from "../app/game/terrain-generation-pipeline.ts";
import { explicitTerrainGenerationAuthorityV2 } from "../app/game/terrain-generation-authority.ts";
import { rustEngineCodeIdentity, type PreparedRustEngineCode } from "../app/game/rust-engine-code-cache.ts";
import {
  TERRAIN_GENERATION_PROTOCOL_V2, GENERATE_CHUNK_REQUEST_SCHEMA_V2, GENERATED_CHUNK_SCHEMA_V2,
  LEGACY_TERRAIN_CONTENT_HASH_V2, legacyTerrainGeneratorHashV2, TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2, TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1, TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1, TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1,
  type TerrainGenerationWorkerRequestV2, type TerrainGenerationWorkerResponseV2,
} from "../app/game/terrain-generation-contract.ts";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function prepared(hash = "a".repeat(64)): Promise<PreparedRustEngineCode> {
  const root = "https://blockwild.test/engine/"; const glueBytes = new TextEncoder().encode("export default function init() {}");
  const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const artifact = { indexUrl: `${root}manifest.json`, selectorUrl: `${root}manifest.json`, manifestUrl: `${root}${hash}/manifest.json`, manifestSha256: "b".repeat(64),
    moduleUrl: `${root}${hash}/engine.js`, wasmUrl: `${root}${hash}/engine_bg.wasm`, buildHash: hash, buildKind: "compatibility" as const, variant: "compatibility",
    glue: { path: "engine.js", url: `${root}${hash}/engine.js`, bytes: glueBytes.length, sha256: digest(glueBytes) },
    wasm: { path: "engine_bg.wasm", url: `${root}${hash}/engine_bg.wasm`, bytes: wasmBytes.length, sha256: digest(wasmBytes) } };
  return { artifact, identity: await rustEngineCodeIdentity(artifact), glueBytes, wasmModule: await WebAssembly.compile(wasmBytes) };
}
class Worker implements TerrainGenerationWorkerLike {
  onmessage: TerrainGenerationWorkerLike["onmessage"] = null;
  onerror: TerrainGenerationWorkerLike["onerror"] = null;
  onmessageerror: TerrainGenerationWorkerLike["onmessageerror"] = null;
  messages: TerrainGenerationWorkerRequestV2[] = []; transfers: Transferable[][] = []; terminated = false;
  postMessage(message: TerrainGenerationWorkerRequestV2, transfer: Transferable[] = []) {
    this.transfers.push(transfer); this.messages.push(structuredClone(message, { transfer }));
  }
  terminate() { this.terminated = true; }
  ready(overrides: Record<string, unknown> = {}) {
    const boot = this.messages.find(message => message.type === "initialize-terrain-generation-v2");
    this.onmessage?.({ data: { type: "terrain-generation-ready-v2", protocolVersion: TERRAIN_GENERATION_PROTOCOL_V2,
      requestSchemaVersion: GENERATE_CHUNK_REQUEST_SCHEMA_V2, resultSchemaVersion: GENERATED_CHUNK_SCHEMA_V2, backend: "rust-wasm-authoritative",
      bootstrapId: boot?.bootstrapId, codeIdentity: boot?.code.identity,
      certificate: { generatorVersion: 18, generatorHash: legacyTerrainGeneratorHashV2("g18"), contentHash: LEGACY_TERRAIN_CONTENT_HASH_V2,
        corpusHash: TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2, corpusCases: TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2, byteEqual: true },
      locatorCertificate: { schemaVersion: 1, corpusHash: TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1,
        settlementCases: TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1, lairCases: TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1, byteEqual: true }, ...overrides,
    } } as MessageEvent<TerrainGenerationWorkerResponseV2>);
  }
}
class Cache {
  calls = 0; disposed = false;
  pending: { resolve: (code: PreparedRustEngineCode) => void; reject: (error: Error) => void }[] = [];
  prepare() { this.calls += 1; return new Promise<PreparedRustEngineCode>((resolve, reject) => { this.pending.push({ resolve, reject }); }); }
  dispose() { this.disposed = true; }
  diagnostics() { return { disposed: this.disposed, maximumEntries: 2, entries: 0, pending: this.pending.length, resolutions: this.calls,
    cacheHits: 0, assetFetches: 0, verifiedBytes: 0, compilations: 0, failures: 0 }; }
}
function setup(count = 1, restarts = 0) {
  const workers: Worker[] = []; const cache = new Cache();
  const pipeline = new TerrainGenerationPipeline(count, restarts, { codeCache: cache,
    authoritySelection: explicitTerrainGenerationAuthorityV2("rust", "constructor"),
    workerFactory: () => { const worker = new Worker(); workers.push(worker); return worker; } });
  return { pipeline, cache, workers };
}

test("one epoch acquisition bootstraps every fresh slot with cloned Module, never a transferable Module", async t => {
  const { pipeline, cache, workers } = setup(3); t.after(() => pipeline.dispose());
  assert.equal(cache.calls, 1); assert.equal(pipeline.availableSlots, 0);
  const code = await prepared(); cache.pending[0].resolve(code); await tick();
  for (const worker of workers) {
    const message = worker.messages[0]; assert.equal(message?.type, "initialize-terrain-generation-v2");
    assert(message.type === "initialize-terrain-generation-v2"); assert(message.code.wasmModule instanceof WebAssembly.Module);
    assert.notEqual(message.code.glueBytes.buffer, code.glueBytes.buffer); assert.equal(worker.transfers[0].length, 0);
    worker.ready();
  }
  assert.equal(pipeline.availableSlots, 3); assert.equal(code.glueBytes.byteLength > 0, true);
});

test("reset resolves a fresh selector and late old preparation cannot initialize retired slots", async t => {
  const { pipeline, cache, workers } = setup(); t.after(() => pipeline.dispose());
  assert.equal(cache.calls, 1); pipeline.resetAuthorityEpoch(); assert.equal(cache.calls, 2); assert(workers[0].terminated);
  cache.pending[0].resolve(await prepared()); await tick(); assert.equal(workers[0].messages.length, 0); assert.equal(workers[1].messages.length, 0);
  const next = await prepared("c".repeat(64)); cache.pending[1].resolve(next); await tick();
  assert.equal(workers[1].messages[0]?.type, "initialize-terrain-generation-v2"); workers[1].ready(); assert.equal(pipeline.availableSlots, 1);
});

test("disposal releases cache ownership and rejects late startup publication", async t => {
  const { pipeline, cache, workers } = setup(); t.after(() => pipeline.dispose()); assert.equal(cache.calls, 1); pipeline.dispose();
  assert(cache.disposed && workers[0].terminated); cache.pending[0].resolve(await prepared()); await tick();
  assert.equal(workers[0].messages.length, 0); assert.equal(pipeline.state, "disposed"); assert.equal(pipeline.availableSlots, 0);
});

for (const [label, overrides] of [
  ["missing identity", { codeIdentity: undefined }], ["wrong identity", { codeIdentity: "f".repeat(64) }],
  ["wrong slot generation", { bootstrapId: 999 }], ["missing slot generation", { bootstrapId: undefined }],
] as const) test(`ready certificate cannot bypass ${label} binding`, async t => {
  const { pipeline, cache, workers } = setup(); t.after(() => pipeline.dispose());
  cache.pending[0]?.resolve(await prepared()); await tick(); workers[0].ready(overrides);
  assert.equal(pipeline.availableSlots, 0); assert.equal(pipeline.state, "authority-unavailable");
});

test("ready before bootstrap is rejected and successful preparation cannot resurrect the failed slot", async t => {
  const { pipeline, cache, workers } = setup(); t.after(() => pipeline.dispose()); workers[0].ready();
  assert.equal(pipeline.state, "authority-unavailable"); cache.pending[0]?.resolve(await prepared()); await tick();
  assert.equal(workers[0].messages.length, 0);
});

test("failed preparation takes bounded recovery and retries acquisition without reusing a rejected promise", async t => {
  const { pipeline, cache, workers } = setup(1, 1); t.after(() => pipeline.dispose());
  assert.equal(cache.calls, 1); cache.pending[0].reject(new Error("SHA-256 mismatch")); await tick();
  assert.equal(cache.calls, 2); assert(workers[0].terminated); cache.pending[1].resolve(await prepared()); await tick();
  workers[1].ready(); assert.equal(pipeline.state, "ready"); assert.equal(pipeline.diagnostics().restarts, 1);
});

test("same immutable code across reset still uses fresh workers and bootstrap generations", async t => {
  const { pipeline, cache, workers } = setup(); t.after(() => pipeline.dispose());
  const code = await prepared(); assert.equal(cache.calls, 1); cache.pending[0].resolve(code); await tick(); workers[0].ready();
  pipeline.resetAuthorityEpoch(); cache.pending[1].resolve(code); await tick(); workers[1].ready();
  assert(workers[0].terminated); assert.notEqual(workers[0], workers[1]);
  const first = workers[0].messages[0]; const second = workers[1].messages[0];
  assert(first.type === "initialize-terrain-generation-v2" && second.type === "initialize-terrain-generation-v2");
  assert.notEqual(first.bootstrapId, second.bootstrapId); assert.equal(first.code.identity, second.code.identity);
  assert.equal(cache.calls, 2); assert.equal(pipeline.availableSlots, 1);
});

test("request authority changes cannot strand a live replacement's pending code bootstrap", async t => {
  const { pipeline, cache, workers } = setup(2, 1); t.after(() => pipeline.dispose());
  cache.pending[0].resolve(await prepared()); await tick(); workers[0].ready(); workers[1].ready();
  assert(pipeline.simulateWorkerCrashForDiagnostics());
  assert(pipeline.submit({ namespace: "new-authority", seedText: "new-seed", generationOptions: {}, key: "0,0", cx: 0, cz: 0, edits: [] },
    () => {}, () => {}));
  await tick();
  assert.equal(workers[2].messages[0]?.type, "initialize-terrain-generation-v2");
  workers[2].ready(); assert.equal(pipeline.diagnostics().ready, 2); assert.equal(cache.calls, 1);
});

test("test authority selection alone never opts a default worker out of verified code preparation", () => {
  const pipeline = new TerrainGenerationPipeline(0, 0, { authoritySelection: explicitTerrainGenerationAuthorityV2("rust", "test") });
  try { assert(pipeline.diagnostics().codeCache, "only an explicitly injected worker factory may omit bootstrap"); }
  finally { pipeline.dispose(); }
});
