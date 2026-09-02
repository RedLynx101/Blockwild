import { decodeTerrainGenerationMarkerTableV2, type GeneratedChunkV2 } from "../../app/game/terrain-generation-contract.ts";
import { encodeR3WorkerExpectedBytes, R3_WORKER_STREAM_NAMES, r3WorkerStreams, type R3WorkerCase } from "./r3-production-worker-contract.ts";
import { assertR3PerformanceReadiness, type R3PerformanceReadiness } from "./r3-generation-performance-contract.ts";

export const R3_PERSISTENT_CACHE_ARTIFACT = "c7bfb66cb842b08ea722f3be306d85cbf2d018794a86944b153b9764d4d1e20b";
export const R3_PERSISTENT_CACHE_CASE = "surface-poi-negative";
export const R3_CACHE_DATABASE = "blockwild-terrain-cache-v2";
export const R3_CACHE_STORE = "chunks";
export type R3CacheChunkProof = {
  chunkHash: string; bytesHash: string; markerCount: number;
  streams: { name: string; bytes: number; sha256: string }[];
};
export type R3CacheManifest = {
  schema: 1; artifactHash: string; corpusHash: string; entry: R3WorkerCase;
  cacheKey: string; oracle: R3CacheChunkProof;
};
export type R3CacheRead = {
  actor: "production" | "audit"; database: string; store: string; key: string;
  result: "pending" | "hit" | "miss" | "error"; recordCacheKey: string | null; recordChunkKey: string | null;
  proof: R3CacheChunkProof | null; lightInitialized: boolean | null;
};
export type R3CacheWrite = {
  database: string; store: string; key: string; recordChunkKey: string;
  committed: boolean; proof: R3CacheChunkProof | null; lightInitialized: boolean;
};
export type R3CacheState = {
  schema: 1; phase: "cold" | "restore"; status: "idle" | "running" | "passed" | "failed";
  label: string; error: string | null; pageId: string; origin: string; artifactHash: string; corpusHash: string; caseId: string; cacheKey: string;
  fresh: { chunks: number; markers: number; memoryEntries: number; memoryHits: number; persistentHits: number } | null;
  initial: R3CacheChunkProof | null; restored: R3CacheChunkProof | null;
  reads: R3CacheRead[]; writes: R3CacheWrite[]; idbErrors: string[];
  targetGenerationRequests: { key: string; namespace: string }[];
  travel: { renderDistance: number; retentionPadding: number; offsetChunks: number; leaseExpiresAt: number; unloadedAt: number; updateFrames: number; targetAbsent: boolean } | null;
  restore: { scheduleDistance: number; updatesBeforeSnapshot: number; awaitCallsBeforeSnapshot: number;
    persistentHitDelta: number; memoryHitDelta: number; targetGenerationBeforeSnapshot: number; lightInitialized: boolean } | null;
  runtime: { mode: string; selectionSource: string; workers: number; failed: number; rejected: number; restarts: number; lastError: unknown;
    terrainReady: boolean; terrainFailed: number; terrainRestarts: number; terrainError: unknown } | null;
  readiness: R3PerformanceReadiness | null;
  cleanup: { worldDisposed: boolean; workersDisposed: boolean; prototypesRestored: boolean; transactionsDrained: boolean; connectionsClosed: boolean };
};

function invariant(value: unknown, message: string): asserts value { if (!value) throw new Error(`R3 persistent cache: ${message}`); }
function equal(left: unknown, right: unknown, message: string) { invariant(JSON.stringify(left) === JSON.stringify(right), message); }
const hashPattern = /^[a-f0-9]{64}$/u;

export async function r3CacheChunkProof(chunk: GeneratedChunkV2): Promise<R3CacheChunkProof> {
  const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return {
    chunkHash: chunk.chunkHash, bytesHash: await digest(encodeR3WorkerExpectedBytes(chunk)),
    markerCount: decodeTerrainGenerationMarkerTableV2(chunk.markerTable).length,
    streams: await Promise.all(r3WorkerStreams(chunk).map(async (stream, index) => ({ name: R3_WORKER_STREAM_NAMES[index],
      bytes: stream.byteLength, sha256: await digest(new Uint8Array(stream.buffer, stream.byteOffset, stream.byteLength)) }))),
  };
}

export function assertR3CacheProof(proof: R3CacheChunkProof | null): asserts proof is R3CacheChunkProof {
  invariant(proof && /^[a-f0-9]{32}$/u.test(proof.chunkHash) && hashPattern.test(proof.bytesHash), "invalid full snapshot proof");
  invariant(Number.isSafeInteger(proof.markerCount) && proof.markerCount > 0, "empty/vacuous POI snapshot");
  equal(proof.streams.map(stream => stream.name), [...R3_WORKER_STREAM_NAMES], "snapshot omitted or reordered streams");
  for (const stream of proof.streams) invariant(Number.isSafeInteger(stream.bytes) && stream.bytes >= 0 && hashPattern.test(stream.sha256), "invalid stream proof");
}

/** Light may legitimately reconcile during travel. All other arrays and POIs must retain oracle bytes. */
export function assertR3CacheImmutableOracle(proof: R3CacheChunkProof, oracle: R3CacheChunkProof) {
  assertR3CacheProof(proof); assertR3CacheProof(oracle);
  equal(proof.streams.filter(stream => stream.name !== "light"), oracle.streams.filter(stream => stream.name !== "light"), "immutable arrays or POI bytes differ from the independent oracle");
  invariant(proof.markerCount === oracle.markerCount, "POI count differs from the independent oracle");
}

export function assertR3CachePageEvidence(state: R3CacheState, manifest: R3CacheManifest) {
  invariant(state.schema === 1 && state.status === "passed" && state.error === null, `page did not pass: ${state.error ?? state.label}`);
  invariant(state.phase === "cold" || state.phase === "restore", "unknown phase");
  invariant(manifest.schema === 1 && manifest.entry.id === R3_PERSISTENT_CACHE_CASE && !manifest.entry.edits?.length, "wrong/edited corpus case");
  invariant(state.artifactHash === manifest.artifactHash && state.corpusHash === manifest.corpusHash && state.caseId === manifest.entry.id, "artifact/corpus/case identity drift");
  invariant(state.cacheKey === manifest.cacheKey && manifest.cacheKey.startsWith(`terrain-v5|g18|${manifest.entry.seed}|`)
    && manifest.cacheKey.endsWith(`|${manifest.entry.chunk.join(",")}|0.0.0.0.0.0.0.0.0`), "wrong persistent namespace or chunk key");
  invariant(typeof state.pageId === "string" && state.pageId.length > 10 && /^http:\/\/127\.0\.0\.1:\d+$/u.test(state.origin), "missing owned page identity/origin");
  equal(state.fresh, { chunks: 0, markers: 0, memoryEntries: 0, memoryHits: 0, persistentHits: 0 }, "page/world was not fresh");
  invariant(state.idbErrors.length === 0, "IndexedDB error/fallback was observed");
  const runtime = state.runtime;
  invariant(runtime && runtime.mode === "rust" && runtime.selectionSource === "build-rust-primary" && runtime.workers > 0,
    "not the compiled default production Rust worker");
  invariant(runtime.failed === 0 && runtime.rejected === 0 && runtime.restarts === 0 && runtime.lastError === null
    && runtime.terrainReady && runtime.terrainFailed === 0 && runtime.terrainRestarts === 0 && runtime.terrainError === null, "worker fallback, failure, or recovery");
  equal(state.cleanup, { worldDisposed: true, workersDisposed: true, prototypesRestored: true, transactionsDrained: true, connectionsClosed: true },
    "world/worker/observer/IndexedDB cleanup incomplete");
  assertR3CacheProof(manifest.oracle);
  invariant(manifest.oracle.chunkHash === manifest.entry.expectedChunkHash && manifest.oracle.bytesHash === manifest.entry.expectedBytesHash, "oracle manifest hash disagreement");
  equal(manifest.oracle.streams.map(stream => stream.bytes), manifest.entry.streamBytes, "oracle stream lengths disagree");
  for (const read of state.reads) {
    invariant(read.database === R3_CACHE_DATABASE && read.store === R3_CACHE_STORE && read.key === manifest.cacheKey, "wrong-key/namespace IndexedDB read");
    invariant(read.result === "hit", "target IndexedDB read missed or failed");
    invariant(read.recordCacheKey === manifest.cacheKey && read.recordChunkKey === manifest.entry.chunk.join(","), "target record identity differs");
    assertR3CacheProof(read.proof); assertR3CacheImmutableOracle(read.proof, manifest.oracle);
  }
  for (const write of state.writes) {
    invariant(write.database === R3_CACHE_DATABASE && write.store === R3_CACHE_STORE && write.key === manifest.cacheKey
      && write.recordChunkKey === manifest.entry.chunk.join(",") && write.committed, "target write is wrong-key or not transaction-committed");
    assertR3CacheProof(write.proof); assertR3CacheImmutableOracle(write.proof, manifest.oracle);
  }
  if (state.phase === "cold") {
    assertR3CacheProof(state.initial); equal(state.initial, manifest.oracle, "initial pre-update generation differs from the full independent oracle");
    invariant(state.targetGenerationRequests.length === 1 && state.targetGenerationRequests[0].key === manifest.entry.chunk.join(",")
      && state.targetGenerationRequests[0].namespace === manifest.cacheKey, "cold target did not generate exactly once in the exact namespace");
    invariant(state.writes.length === 1, "target was not naturally cached exactly once");
    const readbacks = state.reads.filter(read => read.actor === "audit");
    invariant(readbacks.length === 1 && state.reads.length === 1, "missing exact post-disposal readback or unexpected target restore");
    equal(readbacks[0].proof, state.writes[0].proof, "committed target record differs from observed put bytes");
    invariant(readbacks[0].lightInitialized === state.writes[0].lightInitialized, "cached lighting lifecycle flag changed");
    const travel = state.travel;
    invariant(travel && travel.renderDistance === 10 && travel.retentionPadding === 2
      && Number.isSafeInteger(travel.offsetChunks) && travel.offsetChunks > travel.renderDistance + travel.retentionPadding
      && Number.isSafeInteger(travel.updateFrames) && travel.updateFrames > 0
      && Number.isFinite(travel.leaseExpiresAt) && travel.leaseExpiresAt > 0 && Number.isFinite(travel.unloadedAt) && travel.unloadedAt >= travel.leaseExpiresAt
      && travel.targetAbsent === true, "natural travel, lease expiry, or resident eviction was not proven");
  } else {
    invariant(state.targetGenerationRequests.length === 0, "persistent target regenerated");
    const reads = state.reads.filter(read => read.actor === "production");
    invariant(reads.length === 1 && state.reads.length === 1, "target-specific production IndexedDB hit is missing or duplicated");
    assertR3CacheProof(state.restored); equal(state.restored, reads[0].proof, "restored pre-seam bytes differ from the actual cached snapshot");
    assertR3CacheImmutableOracle(state.restored, manifest.oracle);
    const restore = state.restore;
    invariant(restore && restore.scheduleDistance === 0 && restore.updatesBeforeSnapshot === 0 && restore.awaitCallsBeforeSnapshot === 0
      && restore.persistentHitDelta === 1 && restore.memoryHitDelta === 0 && restore.targetGenerationBeforeSnapshot === 0,
    "restore bypassed the normal near-distance schedule or raced generation/update/memory cache");
    invariant(restore.lightInitialized === reads[0].lightInitialized, "restored lighting lifecycle flag differs from cached snapshot");
    invariant(state.readiness, "normal drawable readiness is missing"); assertR3PerformanceReadiness(state.readiness);
  }
  return true;
}

export function assertR3PersistentCacheEvidence(cold: R3CacheState, restore: R3CacheState, manifest: R3CacheManifest) {
  assertR3CachePageEvidence(cold, manifest); assertR3CachePageEvidence(restore, manifest);
  invariant(cold.phase === "cold" && restore.phase === "restore" && cold.pageId !== restore.pageId && cold.origin === restore.origin,
    "restore did not use a fresh same-origin page");
  equal(restore.restored, cold.writes[0].proof, "fresh-page cached bytes differ from the committed source-page snapshot");
  return true;
}
