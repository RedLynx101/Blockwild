import { ChunkWorld, CHUNK_SIZE, SECTION_COUNT } from "../../app/game/world.ts";
import type { CachedChunkData } from "../../app/game/chunk-cache.ts";
import { createGeneratedChunkV2, type GeneratedChunkV2 } from "../../app/game/terrain-generation-contract.ts";
import { decodeR3WorkerExpectedChunk } from "./r3-production-worker-contract.ts";
import { assertR3PerformanceReadiness, r3PerformanceRequest, type R3PerformanceReadiness } from "./r3-generation-performance-contract.ts";
import {
  assertR3CachePageEvidence, assertR3CacheImmutableOracle, assertR3EditHaloEvidence, r3CacheChunkProof, R3_CACHE_DATABASE, R3_CACHE_STORE,
  type R3CacheManifest, type R3CacheState, type R3CacheRead, type R3CacheWrite, type R3CacheHaloEvidence,
} from "./r3-persistent-cache-contract.ts";

const requestedPhase = new URL(location.href).searchParams.get("phase") ?? "cold";
if (requestedPhase !== "cold" && requestedPhase !== "restore" && requestedPhase !== "edit-halo") throw new Error("Unknown persistent-cache phase");
const state: R3CacheState = {
  schema: 1, phase: requestedPhase, status: "idle", label: "Awaiting explicit start", error: null,
  pageId: crypto.randomUUID(), origin: location.origin, artifactHash: "", corpusHash: "", caseId: "", cacheKey: "",
  fresh: null, initial: null, restored: null, reads: [], writes: [], idbErrors: [], targetGenerationRequests: [],
  travel: null, restore: null, runtime: null, readiness: null,
  cleanup: { worldDisposed: false, workersDisposed: false, prototypesRestored: false, transactionsDrained: false, connectionsClosed: false },
};
const canvas = document.querySelector<HTMLCanvasElement>("#evidence")!;
const context = canvas.getContext("2d")!;
let running: Promise<void> | null = null;
function invariant(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function draw() {
  context.fillStyle = "#f7faf3"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#183c31"; context.font = "bold 30px system-ui"; context.fillText("R3 · Real persistent terrain cache", 30, 50);
  context.font = "18px system-ui"; context.fillText(`${state.phase.toUpperCase()} · ${state.label}`, 30, 92);
  context.font = "13px monospace"; context.fillText(`Artifact ${state.artifactHash || "pending"}`, 30, 124);
  const rows = state.phase === "edit-halo" ? [
    ["Fresh page / empty memory", Boolean(state.fresh)],
    ["Old real record remains present", state.reads.filter(read => read.actor === "audit" && read.result === "hit").length >= 2],
    ["Ordinary east-neighbor edit", Boolean(state.editHalo?.editAccepted)],
    ["New halo namespace: real IDB miss", Boolean(state.editHalo?.miss)],
    ["Exact target / edited-neighbor bytes", Boolean(state.initial && state.editHalo?.neighborInitial)],
    ["Normal drawable ring / edit retained", Boolean(state.readiness && state.editHalo?.neighborDrawable)],
    ["Replacement namespace committed", state.writes.some(write => write.committed)],
  ] as const : [
    ["Fresh page / empty memory", Boolean(state.fresh)], ["Independent native generation", Boolean(state.initial)],
    ["Natural lease-expired eviction", Boolean(state.travel?.targetAbsent)],
    ["Target IndexedDB commit", state.writes.some(write => write.committed)],
    ["Target production IndexedDB hit", state.reads.some(read => read.actor === "production" && read.result === "hit")],
    ["Exact pre-seam restored snapshot", Boolean(state.restored)], ["Normal drawable ring", Boolean(state.readiness)],
  ] as const;
  rows.forEach(([label, ready], index) => {
    context.fillStyle = ready ? "#287655" : "#cfdbce"; context.fillRect(30, 156 + index * 40, 18, 18);
    context.fillStyle = "#183c31"; context.font = "17px system-ui"; context.fillText(label, 62, 172 + index * 40);
  });
  context.font = "bold 21px system-ui"; context.fillStyle = state.status === "failed" ? "#a42c2c" : "#183c31";
  context.fillText(`${state.status.toUpperCase()} · target generation requests ${state.targetGenerationRequests.length}`, 30, 488);
  context.font = "15px system-ui"; context.fillText(`POIs: ${state.restored?.markerCount ?? state.initial?.markerCount ?? 0} · real transactions / bytes only`, 30, 522);
  context.fillText(`Cleanup ${Object.values(state.cleanup).filter(Boolean).length}/5 · unmeasured correctness only`, 30, 552);
  if (state.error) context.fillText(state.error.slice(0, 132), 30, 586);
}
function phase(label: string) { state.label = label; draw(); }
const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
async function until(test: () => boolean, label: string, milliseconds = 60_000) {
  const deadline = performance.now() + milliseconds;
  while (!test()) { invariant(performance.now() < deadline, `${label} timed out`); await new Promise(resolve => setTimeout(resolve, 5)); }
}
function canonicalRecord(manifest: Pick<R3CacheManifest, "entry">, record: CachedChunkData) {
  return createGeneratedChunkV2(r3PerformanceRequest(manifest.entry), {
    key: record.key, cx: record.cx, cz: record.cz, blocks: record.blocks.slice(), heightmap: record.heightmap.slice(),
    biomes: record.biomes.slice(), sectionBlockCounts: record.sectionBlockCounts.slice(), skyTops: record.skyTops.slice(), light: record.light.slice(),
    lightIndices: [...record.lightIndices], leafIndices: [...record.leafIndices], structureMarkers: structuredClone(record.structureMarkers),
  });
}
function installedSnapshot(world: ChunkWorld, manifest: Pick<R3CacheManifest, "entry" | "cacheKey">) {
  const [cx, cz] = manifest.entry.chunk; const key = `${cx},${cz}`; const chunk = world.chunks.get(key);
  invariant(chunk, "Target chunk is not installed");
  return canonicalRecord(manifest, { ...chunk, cacheKey: manifest.cacheKey, lightIndices: [...chunk.lightIndices], leafIndices: [...chunk.leafIndices],
    structureMarkers: [...world.structureMarkers.entries()].filter(([, marker]) => Math.floor(marker.position.x / CHUNK_SIZE) === cx && Math.floor(marker.position.z / CHUNK_SIZE) === cz) });
}

/** Observe real calls/results only. Every native method receives its original arguments unchanged. */
function observe(manifest: R3CacheManifest) {
  const nativeGet = IDBObjectStore.prototype.get; const nativePut = IDBObjectStore.prototype.put;
  const nativeTransaction = IDBDatabase.prototype.transaction; const nativePost = Worker.prototype.postMessage;
  const nativeTerminate = Worker.prototype.terminate;
  const transactions = new Set<IDBTransaction>(); const databases = new Set<IDBDatabase>();
  const workers = new Set<Worker>(); const terminated = new Set<Worker>(); const proofs: Promise<unknown>[] = [];
  let auditRead = false;
  const targetKey = manifest.entry.chunk.join(",");
  const target = (key: unknown) => typeof key === "string" && (key === manifest.cacheKey || key.includes(`|${targetKey}|`));
  IDBDatabase.prototype.transaction = function(...args: Parameters<IDBDatabase["transaction"]>) {
    const transaction = Reflect.apply(nativeTransaction, this, args) as IDBTransaction;
    if (this.name === R3_CACHE_DATABASE) {
      databases.add(this); transactions.add(transaction);
      transaction.addEventListener("complete", () => transactions.delete(transaction));
      for (const event of ["error", "abort"]) transaction.addEventListener(event, () => {
        transactions.delete(transaction); state.idbErrors.push(`IndexedDB transaction ${event}`);
      });
    }
    return transaction;
  };
  IDBObjectStore.prototype.get = function(...args: Parameters<IDBObjectStore["get"]>) {
    const request = Reflect.apply(nativeGet, this, args) as IDBRequest;
    if (this.transaction.db.name === R3_CACHE_DATABASE && this.name === R3_CACHE_STORE && target(args[0])) {
      const row: R3CacheRead = { actor: auditRead ? "audit" : "production", database: this.transaction.db.name, store: this.name,
        key: String(args[0]), result: "pending", recordCacheKey: null, recordChunkKey: null, proof: null, lightInitialized: null };
      state.reads.push(row);
      request.addEventListener("error", () => { row.result = "error"; state.idbErrors.push("Target IndexedDB get failed"); });
      request.addEventListener("success", () => {
        // Clone in the success event before the application's promise continuation can install/relight the record.
        const record = structuredClone(request.result) as CachedChunkData | undefined;
        row.result = record ? "hit" : "miss";
        if (!record) return;
        row.recordCacheKey = record.cacheKey; row.recordChunkKey = record.key; row.lightInitialized = record.lightInitialized;
        proofs.push(r3CacheChunkProof(canonicalRecord(manifest, record)).then(proof => { row.proof = proof; })
          .catch(error => { state.idbErrors.push(String(error)); }));
      });
    }
    return request;
  };
  IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore["put"]>) {
    const request = Reflect.apply(nativePut, this, args) as IDBRequest<IDBValidKey>;
    const record = args[0] as CachedChunkData;
    if (this.transaction.db.name === R3_CACHE_DATABASE && this.name === R3_CACHE_STORE && record?.key === targetKey) {
      const stable = structuredClone(record);
      const row: R3CacheWrite = { database: this.transaction.db.name, store: this.name, key: record.cacheKey, recordChunkKey: record.key,
        committed: false, proof: null, lightInitialized: record.lightInitialized };
      state.writes.push(row);
      this.transaction.addEventListener("complete", () => { row.committed = true; });
      proofs.push(r3CacheChunkProof(canonicalRecord(manifest, stable)).then(proof => { row.proof = proof; })
        .catch(error => { state.idbErrors.push(String(error)); }));
    }
    return request;
  };
  Worker.prototype.postMessage = function(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
    workers.add(this);
    const value = message as { type?: string; request?: { key?: string; namespace?: string; edits?: Uint32Array } };
    if (value.type === "generate-chunk-v2" && value.request?.key === targetKey) {
      state.targetGenerationRequests.push({ key: value.request.key, namespace: value.request.namespace ?? "" });
    }
    if (value.type === "generate-chunk-v2" && value.request && typeof value.request.key === "string"
      && value.request.key === manifest.editHalo?.neighbor.chunk.join(",") && state.editHalo) {
      state.editHalo.neighborGenerationRequests.push({ key: value.request.key, namespace: value.request.namespace ?? "", edits: [...(value.request.edits ?? [])] });
    }
    Reflect.apply(nativePost, this, [message, options]);
  };
  Worker.prototype.terminate = function() { workers.add(this); terminated.add(this); return nativeTerminate.call(this); };
  return {
    async drain() {
      await until(() => transactions.size === 0, "real IndexedDB transaction drain");
      await new Promise(resolve => setTimeout(resolve, 25));
      await until(() => transactions.size === 0, "post-commit prune transaction drain"); await Promise.all(proofs);
    },
    async readback(cacheKey = manifest.cacheKey) {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(R3_CACHE_DATABASE, 1);
        request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error("Production cache database was not created")); };
      });
      try {
        await new Promise<void>((resolve, reject) => {
          auditRead = true;
          let request: IDBRequest;
          try { request = database.transaction(R3_CACHE_STORE, "readonly").objectStore(R3_CACHE_STORE).get(cacheKey); }
          finally { auditRead = false; }
          request.onerror = () => reject(request.error); request.onsuccess = () => resolve();
        });
      } finally { database.close(); }
      await this.drain();
    },
    close() {
      state.cleanup.transactionsDrained = transactions.size === 0;
      for (const database of databases) database.close(); state.cleanup.connectionsClosed = true;
      state.cleanup.workersDisposed = workers.size > 0 && workers.size === terminated.size;
      IDBObjectStore.prototype.get = nativeGet; IDBObjectStore.prototype.put = nativePut;
      IDBDatabase.prototype.transaction = nativeTransaction; Worker.prototype.postMessage = nativePost; Worker.prototype.terminate = nativeTerminate;
      state.cleanup.prototypesRestored = IDBObjectStore.prototype.get === nativeGet && IDBObjectStore.prototype.put === nativePut
        && IDBDatabase.prototype.transaction === nativeTransaction && Worker.prototype.postMessage === nativePost && Worker.prototype.terminate === nativeTerminate;
    },
  };
}

async function runEditHalo(world: ChunkWorld, manifest: R3CacheManifest, observer: ReturnType<typeof observe>, x: number, z: number, y: number) {
  const spec = manifest.editHalo; invariant(spec, "Missing independent edited-neighbor oracle");
  const response = await fetch("/__r3-persistent-cache/edited-neighbor.bin", { cache: "no-store" }); invariant(response.ok, "Missing edited-neighbor bytes");
  const expected = decodeR3WorkerExpectedChunk(new Uint8Array(await response.arrayBuffer()), spec.neighbor, r3PerformanceRequest(spec.neighbor));
  invariant(JSON.stringify(await r3CacheChunkProof(expected)) === JSON.stringify(spec.oracle), "Edited-neighbor oracle manifest/bytes mismatch");
  invariant(expected.blocks[spec.edit.index] === spec.edit.blockId, "Independent neighbor oracle does not preserve the edit");
  const key = manifest.entry.chunk.join(","); const neighborKey = spec.neighbor.chunk.join(","); const edit = spec.edit;
  const before = world.streamingDiagnostics();
  const halo: R3CacheHaloEvidence = { order: [], worldAuthorityMode: before.rustWorldAuthority.configuredMode,
    editAccepted: false, neighborAbsentBeforeEdit: !world.chunks.has(neighborKey), targetAbsentBeforeEdit: !world.chunks.has(key),
    recordedEdits: {}, miss: null, neighborGenerationRequests: [], neighborInitial: null, neighborDrawable: null,
    installedBlockId: null, drawableBlockId: null, targetOwnEdits: [] };
  state.editHalo = halo;
  invariant(halo.worldAuthorityMode === "off" && before.rustWorldAuthority.effectiveMode === "off"
    && before.rustWorldAuthority.failures === 0 && before.rustWorldAuthority.lastFallbackReason === null
    && halo.neighborAbsentBeforeEdit && halo.targetAbsentBeforeEdit, "Expected default R3 generation with ordinary compatibility edit recording, not R4 authority");
  phase("Edit-halo: read the real old target record before the neighbor edit");
  await observer.readback(); invariant(state.reads.at(-1)?.result === "hit", "No prior target record exists to reject");
  halo.order.push("old-record-observed");
  halo.editAccepted = world.setBlock(edit.x, edit.y, edit.z, edit.blockId);
  halo.recordedEdits = world.serializeEdits(); halo.targetOwnEdits = halo.recordedEdits[key] ?? [];
  invariant(halo.editAccepted && JSON.stringify(halo.recordedEdits) === JSON.stringify({ [neighborKey]: [[edit.index, edit.blockId]] }), "Ordinary neighbor edit did not record exactly one changed cell");
  halo.order.push("neighbor-edit-recorded"); state.cacheKey = spec.cacheKey;
  phase("Edit-halo: normal near schedule must miss the revised target namespace");
  world.scheduleAround(x, z, true, y);
  await until(() => state.reads.some(read => read.actor === "production" && read.key === spec.cacheKey && read.result !== "pending"), "target revised-key IndexedDB result");
  const read = state.reads.find(read => read.actor === "production" && read.key === spec.cacheKey);
  const afterMiss = world.streamingDiagnostics();
  halo.miss = { scheduleDistance: 0, updates: 0, generationAwaits: 0, targetAbsent: !world.chunks.has(key),
    targetGenerationRequests: state.targetGenerationRequests.length, memoryHitDelta: afterMiss.cache.memory.hits - before.cache.memory.hits,
    persistentHitDelta: afterMiss.cache.persistentHits - before.cache.persistentHits };
  invariant(read?.result === "miss" && halo.miss.targetAbsent && halo.miss.targetGenerationRequests === 0 && halo.miss.memoryHitDelta === 0, "Revised target namespace accepted stale bytes or raced generation");
  halo.order.push("new-key-miss-observed");
  await observer.readback(); invariant(state.reads.at(-1)?.result === "hit", "Old record was removed instead of excluded by namespace");
  halo.order.push("old-record-still-present");
  phase("Edit-halo: generate only after the real miss; snapshot before world.update");
  // Public residency requests run only AFTER the target IDB miss. Unlike a
  // restore race, this deliberately completes the normal queued replacement.
  const generationDeadline = performance.now() + 60_000;
  while (!world.chunks.has(key) || !world.chunks.has(neighborKey)) {
    for (const [cx, cz] of [manifest.entry.chunk, spec.neighbor.chunk]) world.requestChunkForResidency(cx, cz, 5_000);
    healthy(world); invariant(performance.now() < generationDeadline, "Edited-halo replacement did not install");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const targetSnapshot = installedSnapshot(world, manifest);
  const neighborSnapshot = installedSnapshot(world, { entry: spec.neighbor, cacheKey: spec.neighborCacheKey });
  halo.installedBlockId = neighborSnapshot.blocks[edit.index];
  // Copy both snapshots synchronously before hashing yields or any seam/light update.
  [state.initial, halo.neighborInitial] = await Promise.all([r3CacheChunkProof(targetSnapshot), r3CacheChunkProof(neighborSnapshot)]);
  invariant(JSON.stringify(state.initial) === JSON.stringify(manifest.oracle) && JSON.stringify(halo.neighborInitial) === JSON.stringify(spec.oracle), "Replacement target or edited-neighbor full bytes differ from independent oracle");
  halo.order.push("replacement-installed");
  const leaseExpiresAt = (world as unknown as { generationResidencyLeases: ReadonlyMap<string, number> }).generationResidencyLeases.get(key);
  invariant(typeof leaseExpiresAt === "number" && leaseExpiresAt > performance.now(), "Replacement normal lease is absent or already expired at capture");
  phase("Edit-halo: normal drawable readiness must preserve the neighbor edit");
  const deadline = performance.now() + 120_000;
  while (true) {
    await nextFrame(); world.update(x, z, y); healthy(world);
    const candidate = readiness(world);
    try { assertR3PerformanceReadiness(candidate); state.readiness = candidate; break; } catch { /* normal outstanding production work */ }
    invariant(performance.now() < deadline, "Edited-halo world did not reach normal drawable readiness");
  }
  const drawableNeighbor = installedSnapshot(world, { entry: spec.neighbor, cacheKey: spec.neighborCacheKey });
  halo.drawableBlockId = drawableNeighbor.blocks[edit.index]; halo.neighborDrawable = await r3CacheChunkProof(drawableNeighbor);
  assertR3CacheImmutableOracle(await r3CacheChunkProof(installedSnapshot(world, manifest)), manifest.oracle);
  invariant(halo.drawableBlockId === edit.blockId, "Neighbor edit was lost while becoming drawable"); halo.order.push("drawable");
  const offsetChunks = world.renderDistance + world.retentionPadding + 3;
  state.travel = { renderDistance: world.renderDistance, retentionPadding: world.retentionPadding, offsetChunks, leaseExpiresAt,
    unloadedAt: 0, updateFrames: 0, targetAbsent: false };
  phase("Edit-halo: naturally evict and commit the replacement under its new key");
  const evictionDeadline = performance.now() + 30_000;
  while (world.chunks.has(key)) {
    await nextFrame(); world.update(x + offsetChunks * CHUNK_SIZE, z, y); state.travel.updateFrames += 1; healthy(world);
    invariant(performance.now() < evictionDeadline, "Edited-halo replacement did not naturally unload");
  }
  state.travel.unloadedAt = performance.now(); state.travel.targetAbsent = !world.chunks.has(key);
  await until(() => state.writes.some(write => write.key === spec.cacheKey && write.committed), "replacement real IndexedDB commit");
  await observer.drain(); halo.order.push("replacement-evicted");
}

function healthy(world: ChunkWorld) {
  const diagnostic = world.streamingDiagnostics(); const worker = diagnostic.generationWorker; const terrain = diagnostic.terrainWorker;
  invariant(worker.mode === "rust" && worker.selectionSource === "build-rust-primary" && worker.lastError === null
    && worker.failed === 0 && worker.rejected === 0 && worker.restarts === 0 && worker.state !== "authority-unavailable", "Production Rust worker failed or fell back");
  invariant(terrain.lastError === null && terrain.failed === 0 && terrain.restarts === 0, "Terrain-buffer worker failed");
  state.runtime = { mode: worker.mode, selectionSource: worker.selectionSource, workers: worker.workers, failed: worker.failed,
    rejected: worker.rejected, restarts: worker.restarts, lastError: worker.lastError, terrainReady: terrain.supported && terrain.ready,
    terrainFailed: terrain.failed, terrainRestarts: terrain.restarts, terrainError: terrain.lastError };
  return worker.state === "ready" && worker.ready === worker.workers && terrain.ready && terrain.supported;
}
function readiness(world: ChunkWorld): R3PerformanceReadiness {
  const diagnostic = world.streamingDiagnostics();
  const candidates = [diagnostic.playerSection, diagnostic.playerSection - 1].filter(section => section >= 0 && section < SECTION_COUNT);
  return { playerChunk: diagnostic.playerChunk, playerSection: diagnostic.playerSection, playerChunkReady: diagnostic.playerChunkReady,
    playerChunkStage: diagnostic.playerChunkStage, immediateRing: diagnostic.immediateRing, playerTerrainPresentation: diagnostic.playerTerrainPresentation,
    occupancy: diagnostic.playerTerrainPresentation.chunks.map(chunk => ({ key: chunk.key, sections: candidates.map(section => ({ section,
      blockCount: world.chunks.get(chunk.key)?.sectionBlockCounts[section] ?? -1, built: world.chunks.get(chunk.key)?.sections.has(section) ?? false })) })) };
}

async function run() {
  state.status = "running"; phase("Loading the independently generated corpus reference");
  const response = await fetch("/__r3-persistent-cache/manifest.json", { cache: "no-store" }); invariant(response.ok, "Missing cache manifest");
  const manifest = await response.json() as R3CacheManifest;
  state.artifactHash = manifest.artifactHash; state.corpusHash = manifest.corpusHash; state.caseId = manifest.entry.id; state.cacheKey = manifest.cacheKey;
  const expectedResponse = await fetch(`/__r3-production-worker/expected/${manifest.entry.ordinal}.bin`, { cache: "no-store" }); invariant(expectedResponse.ok, "Missing oracle bytes");
  const expected = decodeR3WorkerExpectedChunk(new Uint8Array(await expectedResponse.arrayBuffer()), manifest.entry, r3PerformanceRequest(manifest.entry));
  invariant(JSON.stringify(await r3CacheChunkProof(expected)) === JSON.stringify(manifest.oracle), "Oracle manifest/bytes mismatch");
  const observer = observe(manifest);
  // Default constructor: no fake backend, injected authority, budget override or cache replacement.
  const world = new ChunkWorld(); let failure: unknown = null;
  try {
    world.reset(manifest.entry.seed, undefined, manifest.entry.options as Parameters<ChunkWorld["reset"]>[2]);
    const before = world.streamingDiagnostics();
    state.fresh = { chunks: world.chunks.size, markers: world.structureMarkers.size, memoryEntries: before.cache.memory.entries,
      memoryHits: before.cache.memory.hits, persistentHits: before.cache.persistentHits };
    await until(() => healthy(world), "production worker readiness");
    const [cx, cz] = manifest.entry.chunk; const key = `${cx},${cz}`; const x = cx * CHUNK_SIZE + 8; const z = cz * CHUNK_SIZE + 8;
    const y = expected.heightmap[8 * CHUNK_SIZE + 8] + 3;
    if (state.phase === "cold") {
      phase("Cold native generation: capture all streams before world.update");
      await world.awaitGenerationRing(x, z, 0, 5_000);
      state.initial = await r3CacheChunkProof(installedSnapshot(world, manifest));
      invariant(JSON.stringify(state.initial) === JSON.stringify(manifest.oracle), "Cold native pre-update bytes disagree with oracle");
      const leaseExpiresAt = (world as unknown as { generationResidencyLeases: ReadonlyMap<string, number> }).generationResidencyLeases.get(key);
      invariant(typeof leaseExpiresAt === "number" && leaseExpiresAt > performance.now(), "Missing normal residency lease");
      const offsetChunks = world.renderDistance + world.retentionPadding + 3;
      state.travel = { renderDistance: world.renderDistance, retentionPadding: world.retentionPadding, offsetChunks,
        leaseExpiresAt, unloadedAt: 0, updateFrames: 0, targetAbsent: false };
      phase("Travel beyond retention; allow the real lease to expire");
      const deadline = performance.now() + 30_000;
      while (world.chunks.has(key)) {
        await nextFrame(); world.update(x + offsetChunks * CHUNK_SIZE, z, y); state.travel.updateFrames += 1; healthy(world);
        invariant(performance.now() < deadline, "Target did not unload through normal scheduling after lease expiry");
      }
      state.travel.unloadedAt = performance.now(); state.travel.targetAbsent = !world.chunks.has(key);
      await until(() => state.writes.some(write => write.committed), "target real IndexedDB commit");
      await observer.drain();
    } else if (state.phase === "restore") {
      phase("Normal near-distance schedule; wait for IndexedDB without generation/update races");
      world.scheduleAround(x, z, true, y);
      await until(() => world.chunks.has(key), "target production persistent restore");
      // No world.update or awaitGenerationRing has run in this page. Capture
      // installed bytes synchronously before any seam reconciliation can start.
      const snapshot: GeneratedChunkV2 = installedSnapshot(world, manifest);
      const restoredChunk = world.chunks.get(key)!; const restoredCounters = world.streamingDiagnostics().cache;
      state.restore = { scheduleDistance: 0, updatesBeforeSnapshot: 0, awaitCallsBeforeSnapshot: 0,
        persistentHitDelta: restoredCounters.persistentHits - before.cache.persistentHits,
        memoryHitDelta: restoredCounters.memory.hits - before.cache.memory.hits,
        targetGenerationBeforeSnapshot: state.targetGenerationRequests.length, lightInitialized: restoredChunk.lightInitialized };
      state.restored = await r3CacheChunkProof(snapshot); await observer.drain(); assertR3CacheImmutableOracle(state.restored, manifest.oracle);
      invariant(state.targetGenerationRequests.length === 0 && state.restore.persistentHitDelta === 1, "Target restore used generation or no persistent hit");
      phase("Restored exact snapshot captured; now drive normal drawable readiness");
      const deadline = performance.now() + 120_000;
      while (true) {
        await nextFrame(); world.update(x, z, y); healthy(world);
        const candidate = readiness(world);
        try { assertR3PerformanceReadiness(candidate); state.readiness = candidate; break; } catch { /* normal outstanding production work */ }
        invariant(performance.now() < deadline, "Restored world did not reach normal drawable readiness");
      }
      invariant(state.targetGenerationRequests.length === 0, "Target regenerated while becoming drawable");
    } else {
      await runEditHalo(world, manifest, observer, x, z, y);
    }
    healthy(world);
  } catch (error) { failure = error; }
  finally {
    try {
      world.dispose();
      const disposed = world.streamingDiagnostics();
      state.cleanup.worldDisposed = disposed.generationWorker.state === "disposed" && disposed.generationWorker.workers === 0
        && !disposed.terrainWorker.supported && !disposed.terrainWorker.ready && disposed.terrainWorker.pending === 0;
      await observer.drain();
      // Read AFTER disposal/drain so normal writes/pruning cannot silently remove the target before page close.
      if (state.phase === "cold" && !failure) await observer.readback();
      if (state.phase === "edit-halo" && !failure) await observer.readback(manifest.editHalo!.cacheKey);
    } catch (error) { failure ??= error; }
    finally { observer.close(); }
  }
  if (failure) throw failure;
  state.status = "passed"; phase("Phase passed; exact evidence and cleanup retained");
  if (state.phase === "edit-halo") assertR3EditHaloEvidence(state, manifest); else assertR3CachePageEvidence(state, manifest);
}

const surface = window as unknown as { render_game_to_text: () => string; advanceTime: (ms: number) => Promise<void> };
surface.render_game_to_text = () => JSON.stringify(state);
surface.advanceTime = async () => { await running; draw(); };
document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", () => {
  if (running) return; document.querySelector<HTMLButtonElement>("#run")!.disabled = true;
  running = run().catch(error => { state.status = "failed"; state.error = String(error); phase("FAIL · evidence retained"); console.error(error); });
});
draw();
