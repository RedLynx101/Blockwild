import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  assertR3CacheImmutableOracle, assertR3CachePageEvidence, assertR3PersistentCacheEvidence,
  R3_CACHE_DATABASE, R3_CACHE_STORE, R3_PERSISTENT_CACHE_ARTIFACT, R3_PERSISTENT_CACHE_CASE,
  type R3CacheChunkProof, type R3CacheManifest, type R3CacheState,
} from "./fixtures/r3-persistent-cache-contract.ts";
import { R3_WORKER_STREAM_NAMES } from "./fixtures/r3-production-worker-contract.ts";
import type { R3PerformanceReadiness } from "./fixtures/r3-generation-performance-contract.ts";
import { assertR3PersistentCacheBrowserErrors, auditR3PersistentCacheFixture, r3PersistentCacheKey } from "../scripts/verify-rust-r3-persistent-cache-browser.mjs";

/** Synthetic validator data only. It is never served to a browser or used as cache acceptance. */
function evidence() {
  const oracle: R3CacheChunkProof = { chunkHash: "a".repeat(32), bytesHash: "b".repeat(64), markerCount: 2,
    streams: R3_WORKER_STREAM_NAMES.map((name, index) => ({ name, bytes: 2, sha256: (index + 1).toString(16).repeat(64) })) };
  const entry = { id: R3_PERSISTENT_CACHE_CASE, ordinal: 1, seed: "WILDERNESS", chunk: [-8, -1] as const,
    coverage: ["synthetic-validator-only"], minimumMarkers: 1, streamBytes: Array(10).fill(2), expectedChunkHash: oracle.chunkHash, expectedBytesHash: oracle.bytesHash };
  const manifest: R3CacheManifest = { schema: 1, artifactHash: R3_PERSISTENT_CACHE_ARTIFACT, corpusHash: "d".repeat(32), entry,
    cacheKey: r3PersistentCacheKey(entry), oracle };
  const write = { database: R3_CACHE_DATABASE, store: R3_CACHE_STORE, key: manifest.cacheKey, recordChunkKey: "-8,-1",
    committed: true, proof: structuredClone(oracle), lightInitialized: true };
  const read = { actor: "audit" as const, database: R3_CACHE_DATABASE, store: R3_CACHE_STORE, key: manifest.cacheKey,
    result: "hit" as const, recordCacheKey: manifest.cacheKey, recordChunkKey: "-8,-1", proof: structuredClone(oracle), lightInitialized: true };
  const cold: R3CacheState = { schema: 1, phase: "cold", status: "passed", label: "Synthetic validator only", error: null,
    pageId: "synthetic-cold-page-identity", origin: "http://127.0.0.1:8765", artifactHash: manifest.artifactHash,
    corpusHash: manifest.corpusHash, caseId: entry.id, cacheKey: manifest.cacheKey,
    fresh: { chunks: 0, markers: 0, memoryEntries: 0, memoryHits: 0, persistentHits: 0 }, initial: structuredClone(oracle), restored: null,
    reads: [read], writes: [write], idbErrors: [], targetGenerationRequests: [{ key: "-8,-1", namespace: manifest.cacheKey }],
    travel: { renderDistance: 10, retentionPadding: 2, offsetChunks: 15, leaseExpiresAt: 1000, unloadedAt: 1010, updateFrames: 10, targetAbsent: true },
    restore: null, runtime: { mode: "rust", selectionSource: "build-rust-primary", workers: 2, failed: 0, rejected: 0, restarts: 0,
      lastError: null, terrainReady: true, terrainFailed: 0, terrainRestarts: 0, terrainError: null }, readiness: null,
    cleanup: { worldDisposed: true, workersDisposed: true, prototypesRestored: true, transactionsDrained: true, connectionsClosed: true } };
  const occupied = [4, 3].map(section => ({ section, blockCount: 2, built: true }));
  const chunks = [-1, 0, 1].flatMap(x => [-1, 0, 1].map(z => ({ key: `${-8 + x},${-1 + z}`, offset: { x, z },
    present: true, visible: true, lightReady: true, ready: true, requiredSections: occupied.map(({ section }) => ({ section,
      requiredLayers: ["opaque"], ready: true, presentations: {
        opaque: { required: true, source: true, sourceVisible: true, combined: false, combinedVisible: false, mode: "source" },
        cutout: { required: false, source: false, sourceVisible: false, combined: false, combinedVisible: false, mode: null },
      } })) })));
  const readiness = { playerChunk: "-8,-1", playerSection: 4, playerChunkReady: true, playerChunkStage: "ready",
    immediateRing: { desired: 9, ready: 9, ratio: 1 }, playerTerrainPresentation: { schema: 1, epoch: 2, centerKey: "-8,-1", desired: 9, ready: 9, chunks },
    occupancy: chunks.map(chunk => ({ key: chunk.key, sections: structuredClone(occupied) })) } as R3PerformanceReadiness;
  const restore: R3CacheState = { ...structuredClone(cold), phase: "restore", pageId: "synthetic-restore-page-identity", initial: null,
    restored: structuredClone(oracle), reads: [{ ...structuredClone(read), actor: "production" }], targetGenerationRequests: [], travel: null,
    restore: { scheduleDistance: 0, updatesBeforeSnapshot: 0, awaitCallsBeforeSnapshot: 0, persistentHitDelta: 1, memoryHitDelta: 0,
      targetGenerationBeforeSnapshot: 0, lightInitialized: true }, readiness };
  return { cold, restore, manifest };
}

test("complete synthetic contract requires independent generation, committed disk bytes and a fresh persistent restore", () => {
  const { cold, restore, manifest } = evidence(); assert.equal(assertR3PersistentCacheEvidence(cold, restore, manifest), true);
});

for (const [label, mutate] of [
  ["memory hit", (value: R3CacheState) => { value.restore!.memoryHitDelta = 1; }],
  ["no persistent hit", (value: R3CacheState) => { value.restore!.persistentHitDelta = 0; }],
  ["target generation", (value: R3CacheState) => { value.targetGenerationRequests.push({ key: "-8,-1", namespace: value.cacheKey }); }],
  ["generation before snapshot", (value: R3CacheState) => { value.restore!.targetGenerationBeforeSnapshot = 1; }],
  ["update race", (value: R3CacheState) => { value.restore!.updatesBeforeSnapshot = 1; }],
  ["awaitGenerationRing race", (value: R3CacheState) => { value.restore!.awaitCallsBeforeSnapshot = 1; }],
  ["outside normal near schedule", (value: R3CacheState) => { value.restore!.scheduleDistance = 3; }],
  ["IndexedDB miss", (value: R3CacheState) => { value.reads[0].result = "miss"; }],
  ["wrong key", (value: R3CacheState) => { value.reads[0].key += "-wrong"; }],
  ["wrong record namespace", (value: R3CacheState) => { value.reads[0].recordCacheKey = value.cacheKey.replace("terrain-v5", "terrain-v4"); }],
  ["wrong record chunk", (value: R3CacheState) => { value.reads[0].recordChunkKey = "1,1"; }],
  ["audit read pretending to restore", (value: R3CacheState) => { value.reads[0].actor = "audit"; }],
  ["missing target-specific request", (value: R3CacheState) => { value.reads = []; }],
  ["decoded POIs omitted", (value: R3CacheState) => { value.restored!.markerCount = 0; }],
  ["hidden fallback", (value: R3CacheState) => { value.runtime!.mode = "typescript"; }],
  ["test authority", (value: R3CacheState) => { value.runtime!.selectionSource = "test"; }],
  ["worker restart", (value: R3CacheState) => { value.runtime!.restarts = 1; }],
  ["IndexedDB error", (value: R3CacheState) => { value.idbErrors.push("transaction abort"); }],
  ["retained markers", (value: R3CacheState) => { value.fresh!.markers = 1; }],
  ["retained memory entries", (value: R3CacheState) => { value.fresh!.memoryEntries = 1; }],
  ["uncommitted write", (value: R3CacheState) => { value.writes[0].committed = false; }],
  ["missing drawable ring", (value: R3CacheState) => { value.readiness = null; }],
  ["invisible terrain", (value: R3CacheState) => { (value.readiness!.playerTerrainPresentation.chunks[0] as { visible: boolean }).visible = false; }],
  ["worker cleanup", (value: R3CacheState) => { value.cleanup.workersDisposed = false; }],
  ["observer cleanup", (value: R3CacheState) => { value.cleanup.prototypesRestored = false; }],
  ["pending transactions", (value: R3CacheState) => { value.cleanup.transactionsDrained = false; }],
] as const) {
  test(`persistent-cache verifier rejects ${label}`, () => {
    const { cold, restore, manifest } = evidence(); mutate(restore);
    assert.throws(() => assertR3PersistentCacheEvidence(cold, restore, manifest));
  });
}

test("cached light may reconcile, but full restored bytes must equal the source-page committed snapshot", () => {
  const { cold, restore, manifest } = evidence();
  const reconciled = structuredClone(manifest.oracle); reconciled.bytesHash = "c".repeat(64); reconciled.chunkHash = "c".repeat(32);
  reconciled.streams[5].sha256 = "c".repeat(64);
  cold.writes[0].proof = structuredClone(reconciled); cold.reads[0].proof = structuredClone(reconciled);
  restore.restored = structuredClone(reconciled); restore.reads[0].proof = structuredClone(reconciled); restore.writes[0].proof = structuredClone(reconciled);
  assert.doesNotThrow(() => assertR3PersistentCacheEvidence(cold, restore, manifest));
  restore.restored.streams[5].sha256 = "d".repeat(64);
  assert.throws(() => assertR3PersistentCacheEvidence(cold, restore, manifest), /pre-seam bytes/u);
});

test("every immutable stream and POI byte proof is independent of a resealed full snapshot hash", () => {
  const { manifest } = evidence();
  for (const [index, stream] of manifest.oracle.streams.entries()) {
    if (stream.name === "light") continue;
    const altered = structuredClone(manifest.oracle); altered.streams[index].sha256 = "f".repeat(64); altered.bytesHash = "e".repeat(64);
    assert.throws(() => assertR3CacheImmutableOracle(altered, manifest.oracle), /immutable arrays or POI/u, stream.name);
  }
});

test("cold phase requires actual lease expiry, resident absence, transaction commit and readback", () => {
  for (const mutate of [
    (value: R3CacheState) => { value.travel!.offsetChunks = 12; },
    (value: R3CacheState) => { value.travel!.unloadedAt = 999; },
    (value: R3CacheState) => { value.travel!.targetAbsent = false; },
    (value: R3CacheState) => { value.travel!.updateFrames = 0; },
    (value: R3CacheState) => { value.writes = []; },
    (value: R3CacheState) => { value.reads = []; },
    (value: R3CacheState) => { value.targetGenerationRequests[0].namespace = "wrong"; },
  ]) {
    const { cold, manifest } = evidence(); mutate(cold); assert.throws(() => assertR3CachePageEvidence(cold, manifest));
  }
});

test("pair verifier refuses same-page replay, different origin and different committed cache snapshot", () => {
  const first = evidence(); first.restore.pageId = first.cold.pageId;
  assert.throws(() => assertR3PersistentCacheEvidence(first.cold, first.restore, first.manifest), /fresh same-origin/u);
  const second = evidence(); second.restore.origin = "http://127.0.0.1:9999";
  assert.throws(() => assertR3PersistentCacheEvidence(second.cold, second.restore, second.manifest), /fresh same-origin/u);
  const third = evidence(); const changed = structuredClone(third.manifest.oracle); changed.streams[5].sha256 = "e".repeat(64); changed.bytesHash = "e".repeat(64);
  third.restore.restored = structuredClone(changed); third.restore.reads[0].proof = structuredClone(changed);
  assert.throws(() => assertR3PersistentCacheEvidence(third.cold, third.restore, third.manifest), /committed source-page snapshot/u);
});

test("real fixture is default-authority, observation-only, and does not inject cache data/markers", () => {
  assert.equal(auditR3PersistentCacheFixture().defaultWorld, true);
  const source = readFileSync(new URL("./fixtures/r3-persistent-cache.ts", import.meta.url), "utf8");
  assert.equal((source.match(/world\.awaitGenerationRing\(/gu) ?? []).length, 1, "only the cold phase may await a generation ring");
  assert.match(source, /world\.scheduleAround\(x, z, true, y\);\s*await until\(\(\) => world\.chunks\.has\(key\)/u);
  assert.match(source, /world\.dispose\(\);[\s\S]*disposed\.generationWorker\.state === "disposed"[\s\S]*observer\.drain\(\)/u);
});

test("runner error guard rejects late cleanup errors and malformed error evidence", () => {
  const errors: { phase: string; type: string; message: string }[] = [];
  assert.doesNotThrow(() => assertR3PersistentCacheBrowserErrors(errors));
  errors.push({ phase: "restore", type: "pageerror", message: "late cleanup failure" });
  assert.throws(() => assertR3PersistentCacheBrowserErrors(errors), /including during owned cleanup/u);
  assert.throws(() => assertR3PersistentCacheBrowserErrors(null), /must be an array/u);
});

test("runner freezes Vite watching and rechecks errors after owned cleanup before summary", () => {
  const source = readFileSync(new URL("../scripts/verify-rust-r3-persistent-cache-browser.mjs", import.meta.url), "utf8");
  assert.match(source, /hmr: false, watch: \{ ignored: \["\*\*\/\*"\] \}/u);
  const closed = source.indexOf("cleanup.resources = await closeR3PerformanceResources");
  const checked = source.lastIndexOf("assertR3PersistentCacheBrowserErrors(errors)");
  const summary = source.indexOf('path.join(output, "summary.json")');
  assert(closed >= 0 && checked > closed && summary > checked, "late error guard must precede final summary status");
  assert.match(source, /cleanup\.canonicalUnchanged && cleanup\.browserErrorsClear/u);
  assert.match(source, /liveEditHaloNamespaceRejection: "Not exercised/u);
});
