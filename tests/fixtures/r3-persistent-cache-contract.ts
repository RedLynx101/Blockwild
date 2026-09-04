import { decodeTerrainGenerationMarkerTableV2, type GeneratedChunkV2 } from "../../app/game/terrain-generation-contract.ts";
import { encodeR3WorkerExpectedBytes, R3_WORKER_STREAM_NAMES, r3WorkerStreams, type R3WorkerCase } from "./r3-production-worker-contract.ts";
import { assertR3PerformanceReadiness, type R3PerformanceReadiness } from "./r3-generation-performance-contract.ts";

export const R3_PERSISTENT_CACHE_ARTIFACT = "6a70291bc1655b6a01436b25590d646f064212d20e807dbbfe409b88e8f2322f";
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
  editHalo?: R3CacheHaloManifest;
};
export type R3CacheHaloManifest = {
  scope: "east-neighbor-edit-namespace-rejection";
  cacheKey: string; neighborCacheKey: string; neighbor: R3WorkerCase;
  baseline: R3CacheChunkProof; oracle: R3CacheChunkProof;
  edit: { x: number; y: number; z: number; index: number; previousBlockId: number; blockId: number };
};
export type R3CacheHaloEvidence = {
  order: string[]; worldAuthorityMode: string;
  editAccepted: boolean; neighborAbsentBeforeEdit: boolean; targetAbsentBeforeEdit: boolean;
  recordedEdits: Record<string, [number, number][]>;
  miss: { scheduleDistance: number; updates: number; generationAwaits: number; targetAbsent: boolean;
    targetGenerationRequests: number; memoryHitDelta: number; persistentHitDelta: number } | null;
  neighborGenerationRequests: { key: string; namespace: string; edits: number[] }[];
  neighborInitial: R3CacheChunkProof | null; neighborDrawable: R3CacheChunkProof | null;
  installedBlockId: number | null; drawableBlockId: number | null;
  targetOwnEdits: [number, number][];
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
  schema: 1; phase: "cold" | "restore" | "edit-halo"; status: "idle" | "running" | "passed" | "failed";
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
  editHalo?: R3CacheHaloEvidence;
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

/** Independent cache-key expectation. No application cache/private method is called. */
export function r3CacheHaloKeys(manifest: Pick<R3CacheManifest, "cacheKey" | "entry">, index: number, blockId: number) {
  invariant(Number.isSafeInteger(index) && index >= 0 && index < 16 * 16 * 192 && Number.isSafeInteger(blockId) && blockId > 0, "invalid halo edit");
  const signature = (Math.imul(Math.imul(0x811c9dc5 ^ index, 0x01000193) ^ blockId, 0x01000193) >>> 0).toString(36);
  const [cx, cz] = manifest.entry.chunk;
  const suffix = `|${cx},${cz}|0.0.0.0.0.0.0.0.0`;
  invariant(manifest.cacheKey.endsWith(suffix), "halo source key is not the pristine target namespace");
  const prefix = manifest.cacheKey.slice(0, -suffix.length);
  return { cacheKey: `${prefix}|${cx},${cz}|0.0.0.0.0.${signature}.0.0.0`,
    neighborCacheKey: `${prefix}|${cx + 1},${cz}|0.0.0.0.${signature}.0.0.0.0` };
}

function assertHaloNeighbor(proof: R3CacheChunkProof | null, oracle: R3CacheChunkProof, immutable = false) {
  invariant(proof && /^[a-f0-9]{32}$/u.test(proof.chunkHash) && hashPattern.test(proof.bytesHash)
    && Number.isSafeInteger(proof.markerCount) && proof.markerCount >= 0, "invalid edited-neighbor proof");
  equal(proof.streams.map(stream => stream.name), [...R3_WORKER_STREAM_NAMES], "edited-neighbor omitted streams");
  for (const stream of proof.streams) invariant(Number.isSafeInteger(stream.bytes) && stream.bytes >= 0 && hashPattern.test(stream.sha256), "invalid edited-neighbor stream");
  if (immutable) {
    equal(proof.streams.filter(stream => stream.name !== "light"), oracle.streams.filter(stream => stream.name !== "light"), "edited-neighbor immutable arrays or POIs changed");
    invariant(proof.markerCount === oracle.markerCount, "edited-neighbor POI count changed");
  } else equal(proof, oracle, "edited-neighbor full generated bytes differ from independent oracle");
}

/** Separate gate: an existing record is excluded by the live neighbor-edit namespace, not by fabricated byte inequality. */
export function assertR3EditHaloEvidence(state: R3CacheState, manifest: R3CacheManifest) {
  const spec = manifest.editHalo; const halo = state.editHalo;
  invariant(spec && halo && spec.scope === "east-neighbor-edit-namespace-rejection", "missing explicit edit-halo scenario");
  invariant(state.schema === 1 && state.phase === "edit-halo" && state.status === "passed" && state.error === null, "edit-halo page did not pass");
  invariant(manifest.schema === 1 && manifest.entry.id === R3_PERSISTENT_CACHE_CASE && !manifest.entry.edits?.length, "halo target is not the unedited corpus POI case");
  invariant(state.artifactHash === manifest.artifactHash && state.corpusHash === manifest.corpusHash && state.caseId === manifest.entry.id
    && state.cacheKey === spec.cacheKey && state.cacheKey !== manifest.cacheKey, "edit-halo identity/namespace drift");
  invariant(state.pageId.length > 10 && /^http:\/\/127\.0\.0\.1:\d+$/u.test(state.origin), "missing edit-halo page identity");
  equal(state.fresh, { chunks: 0, markers: 0, memoryEntries: 0, memoryHits: 0, persistentHits: 0 }, "edit-halo world was not fresh");
  const runtime = state.runtime;
  invariant(runtime && runtime.mode === "rust" && runtime.selectionSource === "build-rust-primary" && runtime.workers > 0
    && runtime.failed === 0 && runtime.rejected === 0 && runtime.restarts === 0 && runtime.lastError === null && runtime.terrainReady
    && runtime.terrainFailed === 0 && runtime.terrainRestarts === 0 && runtime.terrainError === null, "edit-halo worker fallback or failure");
  invariant(state.idbErrors.length === 0, "edit-halo IndexedDB error");
  equal(state.cleanup, { worldDisposed: true, workersDisposed: true, prototypesRestored: true, transactionsDrained: true, connectionsClosed: true }, "edit-halo cleanup incomplete");
  const [cx, cz] = manifest.entry.chunk; const edit = spec.edit; const neighborKey = `${cx + 1},${cz}`;
  invariant(edit.x === (cx + 1) * 16 && edit.z === cz * 16 + 8 && edit.y === 127
    && edit.index === 8 * 16 + (127 + 64) * 256 && edit.previousBlockId === 0 && edit.blockId === 3, "halo edit is not the non-noop east-edge air-to-stone cell");
  equal({ cacheKey: spec.cacheKey, neighborCacheKey: spec.neighborCacheKey }, r3CacheHaloKeys(manifest, edit.index, edit.blockId), "halo signature or neighbor position is wrong");
  equal(spec.neighbor.chunk, [cx + 1, cz], "oracle is not the edited east neighbor");
  invariant(spec.neighbor.seed === manifest.entry.seed, "edited-neighbor seed drift");
  equal(spec.neighbor.options, manifest.entry.options, "edited-neighbor options drift");
  equal(spec.neighbor.edits, [[edit.index, edit.blockId]], "neighbor oracle does not carry the exact edit");
  assertHaloNeighbor(spec.oracle, spec.oracle); assertHaloNeighbor(spec.baseline, spec.baseline);
  invariant(spec.oracle.chunkHash === spec.neighbor.expectedChunkHash && spec.oracle.bytesHash === spec.neighbor.expectedBytesHash, "neighbor oracle hash disagreement");
  equal(spec.oracle.streams.map(stream => stream.bytes), spec.neighbor.streamBytes, "neighbor oracle stream lengths disagree");
  invariant(spec.baseline.streams[0].sha256 !== spec.oracle.streams[0].sha256, "neighbor edit oracle is vacuous");
  assertR3CacheProof(manifest.oracle);
  invariant(manifest.oracle.chunkHash === manifest.entry.expectedChunkHash && manifest.oracle.bytesHash === manifest.entry.expectedBytesHash, "target oracle hash disagreement");
  equal(manifest.oracle.streams.map(stream => stream.bytes), manifest.entry.streamBytes, "target oracle stream lengths disagree");
  equal(halo.order, ["old-record-observed", "neighbor-edit-recorded", "new-key-miss-observed", "old-record-still-present", "replacement-installed", "drawable", "replacement-evicted"], "edit-halo event ordering changed");
  invariant(halo.worldAuthorityMode === "off" && halo.editAccepted && halo.neighborAbsentBeforeEdit && halo.targetAbsentBeforeEdit, "ordinary unloaded-neighbor edit was not proven");
  equal(halo.recordedEdits, { [neighborKey]: [[edit.index, edit.blockId]] }, "public edit log does not contain exactly the neighbor edit");
  equal(halo.targetOwnEdits, [], "target itself was edited instead of its halo");
  const miss = halo.miss;
  invariant(miss && miss.scheduleDistance === 0 && miss.updates === 0 && miss.generationAwaits === 0 && miss.targetAbsent
    && miss.targetGenerationRequests === 0 && miss.memoryHitDelta === 0 && Number.isSafeInteger(miss.persistentHitDelta) && miss.persistentHitDelta >= 0,
  "new-key miss raced installation/generation or used memory");
  // Global persistent counters may include other near-ring chunks. Target-specific native get evidence is authoritative here.
  invariant(state.reads.length === 4, "missing or extra target-specific halo reads");
  const [old, missRead, stillOld, replacement] = state.reads;
  equal(state.reads.map(read => [read.actor, read.key, read.result]), [["audit", manifest.cacheKey, "hit"], ["production", spec.cacheKey, "miss"],
    ["audit", manifest.cacheKey, "hit"], ["audit", spec.cacheKey, "hit"]], "production reused old namespace or new-key miss was not observed");
  for (const read of state.reads) invariant(read.database === R3_CACHE_DATABASE && read.store === R3_CACHE_STORE, "halo read used wrong database/store");
  equal([missRead.recordCacheKey, missRead.recordChunkKey, missRead.proof, missRead.lightInitialized], [null, null, null, null], "miss contained a stale cache payload");
  for (const read of [old, stillOld, replacement]) {
    invariant(read.recordCacheKey === read.key && read.recordChunkKey === manifest.entry.chunk.join(","), "halo record identity differs");
    assertR3CacheProof(read.proof); assertR3CacheImmutableOracle(read.proof, manifest.oracle);
  }
  equal(old, stillOld, "old persisted record disappeared or changed before rejection proof");
  equal(state.targetGenerationRequests, [{ key: manifest.entry.chunk.join(","), namespace: spec.cacheKey }], "replacement did not generate exactly once in the edited halo namespace");
  equal(halo.neighborGenerationRequests, [{ key: neighborKey, namespace: spec.neighborCacheKey, edits: [edit.index, edit.blockId] }], "neighbor worker did not receive the exact recorded edit");
  equal(state.initial, manifest.oracle, "replacement target pre-update bytes differ from independent oracle");
  invariant(state.restored === null && state.restore === null, "edit-halo miss was mislabeled as a persistent restore");
  assertHaloNeighbor(halo.neighborInitial, spec.oracle); assertHaloNeighbor(halo.neighborDrawable, spec.oracle, true);
  invariant(halo.installedBlockId === edit.blockId && halo.drawableBlockId === edit.blockId, "neighbor edit was lost at install or drawable readiness");
  invariant(state.readiness, "edit-halo drawable readiness is missing"); assertR3PerformanceReadiness(state.readiness);
  invariant(state.writes.length === 1, "replacement target was not cached exactly once");
  const write = state.writes[0];
  invariant(write.database === R3_CACHE_DATABASE && write.store === R3_CACHE_STORE && write.key === spec.cacheKey
    && write.recordChunkKey === manifest.entry.chunk.join(",") && write.committed, "replacement cache record was not committed under the new halo key");
  assertR3CacheProof(write.proof); assertR3CacheImmutableOracle(write.proof, manifest.oracle);
  equal(replacement.proof, write.proof, "replacement cache bytes differ from real committed put");
  invariant(replacement.lightInitialized === write.lightInitialized, "replacement lighting flag changed");
  const travel = state.travel;
  invariant(travel && travel.renderDistance === 10 && travel.retentionPadding === 2 && Number.isSafeInteger(travel.offsetChunks)
    && travel.offsetChunks > 12 && Number.isSafeInteger(travel.updateFrames) && travel.updateFrames > 0
    && Number.isFinite(travel.leaseExpiresAt) && travel.leaseExpiresAt > 0 && Number.isFinite(travel.unloadedAt)
    && travel.unloadedAt >= travel.leaseExpiresAt && travel.targetAbsent, "replacement natural eviction was not proven");
  return true;
}

export function assertR3CompletePersistentCacheEvidence(cold: R3CacheState, restore: R3CacheState, halo: R3CacheState, manifest: R3CacheManifest) {
  assertR3PersistentCacheEvidence(cold, restore, manifest); assertR3EditHaloEvidence(halo, manifest);
  invariant(new Set([cold.pageId, restore.pageId, halo.pageId]).size === 3 && halo.origin === cold.origin, "edit-halo did not use a third fresh same-origin page");
  const sourceWrite = restore.writes.at(-1);
  invariant(sourceWrite && sourceWrite.committed && sourceWrite.key === manifest.cacheKey, "previous phase did not leave the persisted old source record");
  equal(halo.reads[0].proof, sourceWrite.proof, "edit-halo old record is not the preceding phase's actual committed bytes");
  invariant(halo.reads[0].lightInitialized === sourceWrite.lightInitialized, "old source lighting flag drift");
  return true;
}
