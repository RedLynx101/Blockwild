import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { cpSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertR3ProductionWorkerEvidence, auditR3ProductionWorkerSources, r3ProductionWorkerAsset,
  resolveR3ProductionWorkerDirectory, resolveR3ProductionWorkerOutput, runR3WorkerSkillClient,
  selectR3ProductionWorkerArtifact,
} from "../scripts/verify-rust-generation-production-worker.mjs";
import { createRustEngineCandidateFixture } from "./helpers/rust-engine-candidate-fixture.mjs";
import { sha256 } from "../scripts/rust-engine-common.mjs";
import {
  createGeneratedChunkV2, createGenerateChunkRequestV2, decodeTerrainGenerationMarkerTableV2,
  LEGACY_TERRAIN_CONTENT_HASH_V2, legacyTerrainGeneratorHashV2,
  TERRAIN_GENERATION_CELL_COUNT_V2, TERRAIN_GENERATION_COLUMN_COUNT_V2, TERRAIN_GENERATION_SECTION_COUNT_V2,
  type GeneratedChunkV2,
} from "../app/game/terrain-generation-contract.ts";
import {
  assertR3ProductionWorkerResult, decodeR3WorkerExpectedChunk, encodeR3WorkerExpectedBytes, r3WorkerStreams,
  type R3WorkerCase, type R3WorkerManifest,
} from "./fixtures/r3-production-worker-contract.ts";

function fixtureChunk() {
  const request = createGenerateChunkRequestV2({ epoch: 1, taskId: 1, revision: 1, namespace: "terrain-v5|g18|fixture|{}|0,0|0",
    contentHash: LEGACY_TERRAIN_CONTENT_HASH_V2, generatorHash: legacyTerrainGeneratorHashV2("g18"),
    seedText: "fixture", generationOptions: {}, key: "0,0", cx: 0, cz: 0, edits: [[1, 7]] });
  const chunk = createGeneratedChunkV2(request, {
    key: "0,0", cx: 0, cz: 0, blocks: new Uint16Array(TERRAIN_GENERATION_CELL_COUNT_V2),
    heightmap: new Int16Array(TERRAIN_GENERATION_COLUMN_COUNT_V2), biomes: new Uint8Array(TERRAIN_GENERATION_COLUMN_COUNT_V2),
    sectionBlockCounts: new Uint16Array(TERRAIN_GENERATION_SECTION_COUNT_V2), skyTops: new Int16Array(TERRAIN_GENERATION_COLUMN_COUNT_V2),
    light: new Uint16Array(TERRAIN_GENERATION_CELL_COUNT_V2), lightIndices: [1, 9], leafIndices: [3, 8],
    structureMarkers: [["fixture:雪", { type: "landmark", id: "fixture:雪", position: { x: 1, y: 2, z: 3 }, tag: "oracle:🌿" }]],
  });
  const bytes = encodeR3WorkerExpectedBytes(chunk);
  const entry: R3WorkerCase = { id: "fixture", ordinal: 1, seed: "fixture", chunk: [0, 0], coverage: ["fixture"],
    streamBytes: r3WorkerStreams(chunk).map(stream => stream.byteLength), expectedChunkHash: chunk.chunkHash, expectedBytesHash: sha256(bytes) };
  return { request, chunk, bytes, entry };
}
const presented = (chunk: GeneratedChunkV2) => ({ ...chunk, structureMarkers: decodeTerrainGenerationMarkerTableV2(chunk.markerTable) });

test("production-worker oracle transport round-trips all ten typed streams and POI metadata", () => {
  const { request, chunk, bytes, entry } = fixtureChunk();
  const decoded = decodeR3WorkerExpectedChunk(bytes, entry, request);
  assert.deepEqual(encodeR3WorkerExpectedBytes(decoded), bytes);
  assert.equal(assertR3ProductionWorkerResult(presented(decoded), chunk, request).markerCount, 1);
  const actualRequest = createGenerateChunkRequestV2({ ...request, epoch: 42, taskId: 999 });
  const actual = createGeneratedChunkV2(actualRequest, { ...chunk, structureMarkers: decodeTerrainGenerationMarkerTableV2(chunk.markerTable) });
  assert.doesNotThrow(() => assertR3ProductionWorkerResult(presented(actual), chunk, actualRequest), "pipeline identity rebinding preserves exact independent payload bytes");
});

test("every returned stream is compared byte-for-byte even when its forged hash is resealed", () => {
  const { request, chunk } = fixtureChunk();
  for (let index = 0; index < 10; index += 1) {
    const changed = structuredClone(chunk); const stream = r3WorkerStreams(changed)[index];
    new Uint8Array(stream.buffer, stream.byteOffset, stream.byteLength)[0] ^= 1;
    const candidate = { ...changed, chunkHash: chunk.chunkHash, structureMarkers: decodeTerrainGenerationMarkerTableV2(chunk.markerTable) };
    assert.throws(() => assertR3ProductionWorkerResult(candidate, chunk, request), /stream|identity/u, `stream ${index}`);
  }
});

test("oracle bytes reject corruption, truncation, count drift, wrong typed alignment and hash drift", () => {
  const { request, bytes, entry } = fixtureChunk();
  for (const offset of [0, bytes.length - 1]) {
    const changed = bytes.slice(); changed[offset] ^= 1;
    assert.throws(() => decodeR3WorkerExpectedChunk(changed, entry, request));
  }
  assert.throws(() => decodeR3WorkerExpectedChunk(bytes.subarray(1), entry, request), /truncated/u);
  assert.throws(() => decodeR3WorkerExpectedChunk(bytes, { ...entry, streamBytes: entry.streamBytes.slice(1) }, request), /count/u);
  const misaligned = [...entry.streamBytes]; misaligned[0] -= 1; misaligned[1] += 1;
  assert.throws(() => decodeR3WorkerExpectedChunk(bytes, { ...entry, streamBytes: misaligned }, request));
  assert.throws(() => decodeR3WorkerExpectedChunk(bytes, { ...entry, expectedChunkHash: "0".repeat(32) }, request), /hash disagree/u);
});

test("returned metadata, chunk hash, decoded POIs and transfer-buffer ownership cannot drift", () => {
  const { request, chunk } = fixtureChunk();
  const candidate = presented(chunk);
  for (const field of ["epoch", "taskId", "revision", "namespace", "contentHash", "generatorHash", "requestHash", "key", "cx", "cz"] as const) {
    const original = candidate[field];
    assert.throws(() => assertR3ProductionWorkerResult({ ...candidate, [field]: typeof original === "number" ? original + 1 : `${original}x` }, chunk, request), /identity/u, field);
  }
  assert.throws(() => assertR3ProductionWorkerResult({ ...candidate, chunkHash: "0".repeat(32) }, chunk, request), /chunk hash/u);
  assert.throws(() => assertR3ProductionWorkerResult({ ...candidate, structureMarkers: [] }, chunk, request), /POI/u);
  assert.throws(() => assertR3ProductionWorkerResult({ ...candidate, light: candidate.blocks }, chunk, request), /alias/u);
  const oversized = new Uint16Array(chunk.blocks.length + 1); oversized.set(chunk.blocks, 1);
  assert.throws(() => assertR3ProductionWorkerResult({ ...candidate, blocks: oversized.subarray(1) }, chunk, request), /exact owned/u);
});

test("production-worker artifact selection allows exactly canonical and schema-candidate roots", t => {
  const fixture = createRustEngineCandidateFixture(t);
  const candidate = path.join(fixture.root, "public/engine-schema-candidate"); renameSync(fixture.candidateRoot, candidate);
  const canonical = path.join(fixture.root, "public/engine"); cpSync(candidate, canonical, { recursive: true });
  for (const relative of ["public/engine", "public/engine-schema-candidate"]) {
    const selected = selectR3ProductionWorkerArtifact(relative, fixture.hash, fixture.root);
    assert.equal(selected.artifact.hash, fixture.hash); assert.equal(selected.sourceSnapshot.digest, fixture.sourceSnapshot.digest);
    assert(r3ProductionWorkerAsset(`/engine/${fixture.hash}/engine_bg.wasm`, selected.assets));
  }
  for (const bad of ["public", "public/engine-locator-candidate", "public/engine-schema-candidate/subdirectory", "../engine", fixture.root]) {
    assert.throws(() => resolveR3ProductionWorkerDirectory(bad, fixture.root), /exactly/u);
  }
  for (const hash of ["", fixture.hash.toUpperCase(), "0".repeat(64)]) {
    assert.throws(() => selectR3ProductionWorkerArtifact(candidate, hash, fixture.root), /SHA-256|hash mismatch/u);
  }
});

test("artifact bytes, source provenance, metadata and symlink drift fail before any browser starts", t => {
  const fixture = createRustEngineCandidateFixture(t);
  const candidate = path.join(fixture.root, "public/engine-schema-candidate"); renameSync(fixture.candidateRoot, candidate);
  const wasm = path.join(candidate, fixture.hash, "engine_bg.wasm"); const original = readFileSync(wasm);
  writeFileSync(wasm, Buffer.concat([original, Buffer.from([0])]));
  assert.throws(() => selectR3ProductionWorkerArtifact(candidate, fixture.hash, fixture.root), /checksum|size/u); writeFileSync(wasm, original);
  writeFileSync(fixture.sourcePath, "changed source");
  assert.throws(() => selectR3ProductionWorkerArtifact(candidate, fixture.hash, fixture.root), /current-source/u);
  const link = path.join(fixture.root, "public/engine"); symlinkSync(candidate, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => resolveR3ProductionWorkerDirectory(link, fixture.root), /symbolic link/u);
});

test("immutable HTTP asset lookup refuses path traversal, alternate roots, encodings and unknown files", () => {
  const asset = { bytes: Buffer.from("immutable"), type: "application/wasm" };
  const assets = new Map([["/engine/manifest.json", asset]]);
  assert.equal(r3ProductionWorkerAsset("/engine/manifest.json?fresh=1", assets), asset);
  for (const url of ["/engine/../engine/manifest.json", "/engine/%2e%2e/manifest.json", "/engine\\manifest.json", "/engine-schema-candidate/manifest.json", "/engine/unknown", "file:///engine/manifest.json"]) {
    assert.equal(r3ProductionWorkerAsset(url, assets), null, url);
  }
});

test("output confinement rejects workspace roots, escapes, regular files and linked parents", t => {
  const fixture = createRustEngineCandidateFixture(t); mkdirSync(path.join(fixture.root, "work"));
  assert.equal(resolveR3ProductionWorkerOutput("work/r3/fresh", fixture.root), path.join(fixture.root, "work/r3/fresh"));
  for (const bad of [fixture.root, "work", "work/../public/output", "../output"]) assert.throws(() => resolveR3ProductionWorkerOutput(bad, fixture.root), /strictly inside/u);
  writeFileSync(path.join(fixture.root, "work/file"), "file");
  assert.throws(() => resolveR3ProductionWorkerOutput("work/file", fixture.root), /directory/u);
  symlinkSync(path.join(fixture.root, "public"), path.join(fixture.root, "work/link"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => resolveR3ProductionWorkerOutput("work/link/output", fixture.root), /symbolic link/u);
});

function syntheticEvidence() {
  const cases = Array.from({ length: 155 }, (_, index) => ({ id: `case-${index}`, ordinal: index + 1, seed: "synthetic", chunk: [0, 0] as const,
    coverage: [], streamBytes: [8, 16], expectedChunkHash: "a".repeat(32), expectedBytesHash: "b".repeat(64) }));
  const forward = cases.map(entry => entry.id); const reverse = [...forward].reverse(); const zipper = [...forward.slice(1), forward[0]];
  const manifest: R3WorkerManifest = { schema: 1, artifactHash: "c".repeat(64), corpusHash: "d".repeat(32), coverageCount: 89, cases, schedules: { forward, reverse, zipper } };
  const rows = Object.entries(manifest.schedules).flatMap(([order, ids]) => ids.map(id => ({ id, order, canonicalHash: "a".repeat(32), milliseconds: 1, bytes: 24, markers: 1 })));
  const state = { schema: 1, status: "passed", artifactHash: manifest.artifactHash, corpusHash: manifest.corpusHash, caseCount: 155, coverageCount: 89,
    compared: 465, transferredStreams: 4650, rows, checks: ["1", "2", "3", "4", "5", "6"], schedules: { forward, reverse, zipper }, markerRows: 465,
    diagnostics: { mode: "rust", selectionSource: "default-rust", state: "disposed", workers: 0, busy: 0, ready: 0, failed: 0, rejected: 0,
      restarts: 1, submitted: 473, completed: 469, canceled: 1, stale: 2, lastError: null, acceptingRequests: false },
    transfers: { requests: 473, sourceInputsUnchanged: 473, nonemptyInputs: 20, detachedNonemptyInputs: 20 },
    cleanup: { pipelineDisposed: true, postDisposeRejected: true, prototypesRestored: true, observedWorkers: 5, terminatedWorkers: 5 } };
  return { manifest, state };
}

test("evidence validator rejects missing cases, hash/order drift, hidden recovery, detachment and cleanup gaps", () => {
  const { manifest, state } = syntheticEvidence(); assert.equal(assertR3ProductionWorkerEvidence(state, manifest), true);
  const mutate = [
    (value: typeof state) => { value.rows.pop(); }, (value: typeof state) => { value.rows[0].canonicalHash = "0".repeat(32); },
    (value: typeof state) => { value.rows[0].bytes += 1; }, (value: typeof state) => { value.rows[0] = value.rows[1]; },
    (value: typeof state) => { value.schedules.forward = [...value.schedules.forward].reverse(); }, (value: typeof state) => { value.diagnostics.restarts = 2; },
    (value: typeof state) => { value.diagnostics.stale = 0; }, (value: typeof state) => { value.diagnostics.canceled = 0; },
    (value: typeof state) => { value.diagnostics.failed = 1; }, (value: typeof state) => { value.diagnostics.selectionSource = "test"; },
    (value: typeof state) => { value.transfers.detachedNonemptyInputs -= 1; },
    (value: typeof state) => { value.cleanup.terminatedWorkers = 4; }, (value: typeof state) => { value.cleanup.prototypesRestored = false; },
  ];
  for (const change of mutate) { const changed = structuredClone(state); change(changed); assert.throws(() => assertR3ProductionWorkerEvidence(changed, manifest)); }
});

test("production source audit pins the actual module factory and transferred-result source without claiming sender observation", () => {
  const audit = auditR3ProductionWorkerSources();
  assert.equal(audit.workerPath, "app/game/terrain-generation-worker.ts");
  assert.equal(audit.defaultWorkerFactory, true); assert.equal(audit.outputTransferListInProductionSource, true);
  assert.equal(audit.outputSenderDetachmentObserved, false);
});

test("bounded skill client stops only the exact owned child on timeout and also accounts normal exit", async () => {
  for (const timeout of [false, true]) {
    const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null as number | null, signalCode: null });
    let stopped = 0; const evidence: Record<string, unknown> = {};
    const promise = runR3WorkerSkillClient("synthetic-client.js", [], {
      evidence, timeoutMilliseconds: timeout ? 5 : 100,
      spawnProcess: () => { if (!timeout) setTimeout(() => { child.exitCode = 0; child.emit("exit", 0, null); }, 1); return child; },
      stopProcess: async (owned: unknown) => { assert.equal(owned, child); stopped += 1; return true; },
    });
    if (timeout) await assert.rejects(promise, /bounded timeout/u); else assert.equal(await promise, 0);
    assert.equal(stopped, 1); assert.equal(evidence.timedOut, timeout); assert.equal(evidence.stopped, true);
  }
});
