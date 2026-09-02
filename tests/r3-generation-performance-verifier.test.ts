import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertR3GenerationPerformanceEvidence, assertR3GenerationPerformanceSkillSummary, assertR3PerformanceReadiness,
  advanceR3PerformanceClock, createR3PerformanceClock, r3PerformanceStartPoint,
  r3PerformanceFirstReadinessFailure, r3PerformanceSkillTraceSummary,
  r3PerformanceRequest, r3PerformanceTraceHash, r3PerformanceTracePoints, R3_PERFORMANCE_POLICY_V2, R3_PERFORMANCE_TRACE_V2,
  type R3PerformanceFrame, type R3PerformanceLandscape, type R3PerformancePoint, type R3PerformanceProfile,
  type R3PerformanceReadiness, type R3PerformanceRow, type R3PerformanceState, type R3PerformanceStreamingFrame, type R3PerformanceTelemetry,
} from "./fixtures/r3-generation-performance-contract.ts";
import { TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2 } from "../app/game/terrain-generation-contract.ts";
import type { R3WorkerCase, R3WorkerManifest } from "./fixtures/r3-production-worker-contract.ts";

const landscapes = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/r3/landscape-corpus.json", import.meta.url), "utf8")).cases as R3PerformanceLandscape[];
const cases: R3WorkerCase[] = Array.from({ length: 155 }, (_, index) => ({
  id: `synthetic-validator-case-${index + 1}`, ordinal: index + 1, seed: `validator-${index}`, chunk: [index, -index],
  coverage: ["synthetic-contract-only"], streamBytes: Array(10).fill(2),
  expectedChunkHash: "a".repeat(32), expectedBytesHash: "b".repeat(64),
}));
const manifest: R3WorkerManifest = { schema: 1, artifactHash: "c".repeat(64), corpusHash: TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
  coverageCount: 89, cases, schedules: { forward: cases.map(entry => entry.id), reverse: cases.map(entry => entry.id).reverse(), zipper: cases.map(entry => entry.id) } };

/** Synthetic evidence exercises the verifier, and is never browser/performance proof. */
function telemetry(profile: R3PerformanceProfile, generation = 1, residentChunks = 1): R3PerformanceTelemetry {
  const rust = profile === "rust-primary";
  return {
    generationWorker: { mode: rust ? "rust" : "typescript", selectionSource: `build-${profile}`,
      state: rust ? "ready" : "typescript-rollback", authorityRequired: rust, acceptingRequests: rust,
      rollbackRequiresWorldReload: true, supported: rust, workers: rust ? 2 : 0, ready: rust ? 2 : 0,
      busy: 0, submitted: generation, completed: generation, failed: 0, stale: 0, canceled: 0, rejected: 0,
      transferBytes: 32, restarts: 0, epoch: 2, lastError: null, staleResults: 0 },
    terrainWorker: { supported: true, submitted: 0, completed: 0, failed: 0, pending: 0, transferBytes: 0,
      ready: true, restarts: 0, lastError: null, staleResults: 0, coalescedRequests: 0 },
    throughput: { generation, lighting: 0, meshing: 0 },
    cache: { memory: { entries: 0, bytes: 0, hits: 0, misses: 0, evictions: 0 }, persistentSupported: true,
      persistentHits: 0, persistentMisses: 0, pendingReads: 0 },
    generationQueued: 0, lightingQueued: 0, meshSectionsQueued: 0, generationBudget: 1, meshSliceBudget: 2,
    frameBudgetMilliseconds: 5, renderDistance: 10, residentChunks, residentPayloadBytes: 200 * residentChunks, heap: { available: false },
  } as R3PerformanceTelemetry;
}
function readyAt(point: Pick<R3PerformancePoint, "x" | "y" | "z">): R3PerformanceReadiness {
  const cx = Math.floor(point.x / 16); const cz = Math.floor(point.z / 16); const playerSection = Math.floor((point.y + 64) / 16);
  const occupied = [playerSection, playerSection - 1].filter(section => section >= 0).map(section => ({ section, blockCount: 2, built: true }));
  const chunks = [-1, 0, 1].flatMap(x => [-1, 0, 1].map(z => ({ key: `${cx + x},${cz + z}`, offset: { x, z },
    present: true, visible: true, lightReady: true, ready: true,
    requiredSections: occupied.map(({ section }) => ({ section, requiredLayers: ["opaque"], ready: true,
      presentations: { opaque: { required: true, source: true, sourceVisible: true, combined: false, combinedVisible: false, mode: "source" },
        cutout: { required: false, source: false, sourceVisible: false, combined: false, combinedVisible: false, mode: null } } })),
  })));
  return { playerChunk: `${cx},${cz}`, playerSection, playerChunkReady: true, playerChunkStage: "ready",
    immediateRing: { desired: 9, ready: 9, ratio: 1 },
    playerTerrainPresentation: { schema: 1, epoch: 2, centerKey: `${cx},${cz}`, desired: 9, ready: 9, chunks },
    occupancy: chunks.map(chunk => ({ key: chunk.key, sections: structuredClone(occupied) })),
  } as R3PerformanceReadiness;
}
function row(entry: R3WorkerCase, profile: R3PerformanceProfile): R3PerformanceRow {
  return { id: entry.id, ordinal: entry.ordinal, profile, resetCount: 1,
    resetMilliseconds: 2, runtimeReadyMilliseconds: 3, initializedRuntimeAcceptedMilliseconds: 5, resetToAcceptedMilliseconds: 10,
    accepted: true, exactBytes: true, chunkHash: entry.expectedChunkHash, streamBytes: [...entry.streamBytes],
    expectedBytesHash: entry.expectedBytesHash, generationDelta: 1, memoryCacheHitDelta: 0, persistentCacheHitDelta: 0,
    coldWorldChunks: 0, coldMemoryCacheEntries: 0, telemetry: telemetry(profile) };
}
function frame(point: R3PerformancePoint, timestamp: number, profile: R3PerformanceProfile): R3PerformanceFrame {
  return { point, updates: 1, rafTimestamp: timestamp, rafIntervalMilliseconds: 10, updateMilliseconds: 1, observerMilliseconds: 0.1,
    work: { schedulingMilliseconds: 0.1, generationMilliseconds: 0.1, lightingMilliseconds: 0.1, meshingMilliseconds: 0.1,
      installationMilliseconds: 0.1, generationSlices: 1, lightingSlices: 1, meshSlices: 1, installationSlices: 1 },
    telemetry: telemetry(profile, 9 + Math.floor(point.ordinal / 10), 9), readiness: readyAt(point) };
}
function evidence(profile: R3PerformanceProfile = "rust-primary"): R3PerformanceState {
  return { schema: 2, status: "passed", phase: "Synthetic validator fixture", profile, artifactHash: manifest.artifactHash,
    corpusHash: manifest.corpusHash, traceHash: r3PerformanceTraceHash(landscapes), policy: R3_PERFORMANCE_POLICY_V2,
    trace: R3_PERFORMANCE_TRACE_V2, constructionMilliseconds: 2, warmup: row(cases[0], profile), rows: cases.map(entry => row(entry, profile)),
    traces: landscapes.map(landscape => {
      const startPoint = r3PerformanceStartPoint(landscape);
      const startup = frame(startPoint, 1030, profile);
      const points = r3PerformanceTracePoints(landscape); const frames: R3PerformanceStreamingFrame[] = [];
      let clock = createR3PerformanceClock(startup.rafTimestamp);
      while (true) {
        const point = clock.simulationTick === 0 ? startPoint : points[clock.simulationTick - 1];
        const timestamp = clock.previousTimestamp + 10;
        const advanced = advanceR3PerformanceClock(clock, timestamp);
        frames.push({ ...frame(point, timestamp, profile), ...advanced.sample }); clock = advanced.clock;
        if (advanced.sample.finalPositionUpdate) break;
      }
      return { landscape: structuredClone(landscape), profile, resetCount: 1, constructionMilliseconds: 2,
        resetToInstalledMilliseconds: 15, resetToDrawableMilliseconds: 25, initialRafTimestamp: 1000, startupUpdateRafTimestamp: 1020,
        startupRafPulses: [1010, 1020, 1030].map(timestamp => ({ timestamp, intervalMilliseconds: 10 })),
        initialReadiness: startup.readiness, initialTelemetry: startup.telemetry, startupFrames: [startup], frames,
        terminalReadiness: frames.at(-1)!.readiness, readinessFailures: 0 };
    }), error: null, cleanup: { worldsCreated: 6, worldsDisposed: 6, workersDisposed: true } };
}
const expectation = (profile: R3PerformanceProfile = "rust-primary") => ({ profile, manifest, landscapes });

test("fair evidence validator accepts both complete synthetic compiled-profile lanes", () => {
  for (const profile of ["rust-primary", "typescript-rollback"] as const) {
    assert.doesNotThrow(() => assertR3GenerationPerformanceEvidence(evidence(profile), expectation(profile)));
  }
});

test("fixed trace binds five landscapes, exact movement ticks, speeds, cameras, and V2 content identity", () => {
  for (const landscape of landscapes) {
    const points = r3PerformanceTracePoints(landscape);
    assert.equal(points.length, 420); assert.equal(points[0].phase, "walk"); assert.equal(points[120].phase, "sprint");
    assert.equal(points[240].phase, "reverse");
    assert(Math.abs(points.at(-1)!.x - (landscape.chunk[0] * 16 + 8)) < 1e-8);
  }
  const changed = structuredClone(landscapes); changed[0].camera.lookAt = [1, 2, 3];
  assert.notEqual(r3PerformanceTraceHash(changed), r3PerformanceTraceHash(landscapes));
  const request = r3PerformanceRequest({ ...cases[0], options: { structures: false }, edits: [[4, 7]] });
  assert.equal(request.seedText, cases[0].seed); assert.equal(request.taskId, 1); assert.equal(request.revision, 1);
  assert.match(request.namespace, /\|1$/); assert.deepEqual([...request.edits], [4, 7]);
});

const mutations: [string, (state: R3PerformanceState) => void][] = [
  ["missing corpus case", state => { state.rows.pop(); }],
  ["duplicate/reordered corpus case", state => { state.rows[1] = state.rows[0]; }],
  ["missing stream", state => { state.rows[0].streamBytes.pop(); }],
  ["wrong oracle hash", state => { state.rows[0].expectedBytesHash = "f".repeat(64); }],
  ["no exact-byte proof", state => { state.rows[0].exactBytes = false; }],
  ["unaccepted chunk", state => { state.rows[0].accepted = false; }],
  ["not cold world", state => { state.rows[0].coldWorldChunks = 1; }],
  ["hidden cache hit", state => { state.rows[0].memoryCacheHitDelta = 1; }],
  ["missing warmup", state => { state.warmup = null; }],
  ["different warmup case", state => { state.warmup = row(cases[1], "rust-primary"); }],
  ["zero warmup reset policy", state => { state.warmup!.resetCount = 0 as 1; }],
  ["wrong profile", state => { state.profile = "typescript-rollback"; }],
  ["constructor override", state => { state.rows[0].telemetry.generationWorker = { ...state.rows[0].telemetry.generationWorker, selectionSource: "constructor" }; }],
  ["generation failure", state => { state.rows[0].telemetry.generationWorker = { ...state.rows[0].telemetry.generationWorker, failed: 1 }; }],
  ["terrain-buffer fallback", state => { state.rows[0].telemetry.terrainWorker = { ...state.rows[0].telemetry.terrainWorker, supported: false }; }],
  ["terrain-buffer recovery", state => { state.rows[0].telemetry.terrainWorker = { ...state.rows[0].telemetry.terrainWorker, restarts: 1 }; }],
  ["budget drift", state => { state.rows[0].telemetry.frameBudgetMilliseconds = 10; }],
  ["NaN timing", state => { state.rows[0].initializedRuntimeAcceptedMilliseconds = NaN; }],
  ["negative timing", state => { state.rows[0].resetMilliseconds = -1; }],
  ["zero accepted timing", state => { state.rows[0].initializedRuntimeAcceptedMilliseconds = 0; }],
  ["lost cold initialization cost", state => { state.rows[0].resetToAcceptedMilliseconds = 5; }],
  ["trace omitted", state => { state.traces.pop(); }],
  ["slow frame dropped", state => { state.traces[0].frames.splice(100, 1); }],
  ["forged callback ordinal", state => { state.traces[0].frames[0].callbackOrdinal = 2; }],
  ["forged physics steps", state => { state.traces[0].frames[0].physicsSteps = 1; }],
  ["forged simulation time", state => { state.traces[0].frames[0].simulationTimeSeconds = 1; }],
  ["forged post-physics tick", state => { state.traces[0].frames[0].simulationTickAfter = 4; }],
  ["forged accumulator", state => { state.traces[0].frames[0].accumulatorSecondsAfter = 0; }],
  ["missing final-position update", state => { state.traces[0].frames.pop(); }],
  ["extra final-position update", state => { state.traces[0].frames.push(structuredClone(state.traces[0].frames.at(-1)!)); }],
  ["startup movement", state => { state.traces[0].startupFrames[0].point = r3PerformanceTracePoints(landscapes[0])[0]; }],
  ["virtual/duplicate timestamp", state => { state.traces[0].frames[0].rafTimestamp = state.traces[0].startupUpdateRafTimestamp; }],
  ["unrequested startup gap", state => { state.traces[0].startupRafPulses = []; }],
  ["fake startup interval", state => { state.traces[0].startupFrames[0].rafIntervalMilliseconds = 30; }],
  ["changed trace hash", state => { state.traceHash = "f".repeat(32); }],
  ["changed path", state => { state.traces[0].frames[0].point.x += 1; }],
  ["double update", state => { state.traces[0].frames[0].updates = 2 as 1; }],
  ["not ready", state => { state.traces[0].frames[0].readiness.playerChunkReady = false; }],
  ["readiness failure hidden from frames", state => { state.traces[0].readinessFailures = 1; }],
  ["no actual streamed generation", state => {
    for (const frame of state.traces[0].frames) frame.telemetry.throughput = { ...frame.telemetry.throughput, generation: 9 };
  }],
  ["missing memory availability", state => { state.rows[0].telemetry.heap = undefined as unknown as R3PerformanceTelemetry["heap"]; }],
  ["workers not cleaned up", state => { state.cleanup.workersDisposed = false; }],
];
for (const [name, mutate] of mutations) test(`fair evidence rejects ${name}`, () => {
  const state = evidence(); mutate(state);
  assert.throws(() => assertR3GenerationPerformanceEvidence(state, expectation()), /R3 generation performance/);
});

test("drawable readiness verifies zero occupancy rather than requiring geometry in empty sections", () => {
  const ready = readyAt({ x: 8, y: 90, z: 8 });
  const chunk = ready.playerTerrainPresentation.chunks[0];
  // Readonly production snapshots are intentionally cloned/mutated for verifier negatives.
  const mutable = chunk as unknown as { requiredSections: unknown[]; ready: boolean };
  mutable.requiredSections = []; mutable.ready = false;
  ready.occupancy[0].sections.forEach(section => { section.blockCount = 0; });
  (ready.playerTerrainPresentation as unknown as { ready: number }).ready = 8;
  assert.doesNotThrow(() => assertR3PerformanceReadiness(ready));
  ready.occupancy[0].sections[0].blockCount = 1;
  assert.throws(() => assertR3PerformanceReadiness(ready), /occupancy/);
});

test("drawable verifier rejects forged aggregates, missing required layer, and duplicate occupancy", () => {
  for (const mutate of [
    (ready: R3PerformanceReadiness) => { (ready.playerTerrainPresentation.chunks[0] as { visible: boolean }).visible = false; },
    (ready: R3PerformanceReadiness) => { (ready.playerTerrainPresentation.chunks[0].requiredSections[0].presentations.opaque as { sourceVisible: boolean }).sourceVisible = false; },
    (ready: R3PerformanceReadiness) => { ready.occupancy[0].sections.pop(); },
    (ready: R3PerformanceReadiness) => { ready.occupancy[1].key = ready.occupancy[0].key; },
  ]) {
    const ready = readyAt({ x: 8, y: 40, z: 8 }); mutate(ready);
    assert.throws(() => assertR3PerformanceReadiness(ready), /R3 generation performance/);
  }
});

test("compact skill summary retains provenance, complete correctness coverage, and cleanup", () => {
  const state = evidence();
  const summary = { schema: 2, status: "passed", error: null, profile: state.profile, artifactHash: state.artifactHash,
    corpusHash: state.corpusHash, traceHash: state.traceHash, policy: state.policy, completedCases: 155, warmup: true,
    traces: state.traces.map(r3PerformanceSkillTraceSummary), cleanup: state.cleanup };
  assert.doesNotThrow(() => assertR3GenerationPerformanceSkillSummary(summary, expectation()));
  assert.throws(() => assertR3GenerationPerformanceSkillSummary({ ...summary, warmup: false }, expectation()), /warmup/);
  assert.throws(() => assertR3GenerationPerformanceSkillSummary({ ...summary, completedCases: 154 }, expectation()), /corpus/);
  assert.throws(() => assertR3GenerationPerformanceSkillSummary({ ...summary, profile: "typescript-rollback" }, expectation()), /profile/);
  summary.traces[0].readinessFailures = 1;
  assert.throws(() => assertR3GenerationPerformanceSkillSummary(summary, expectation()), /readiness/);
});

test("first readiness failure comes from the strict predicate and actual retained callback, not the claimed count", () => {
  const trace = evidence().traces[0];
  const first = trace.frames[7]; const later = trace.frames[19];
  (first.readiness.playerTerrainPresentation.chunks[0].requiredSections[0].presentations.opaque as { sourceVisible: boolean }).sourceVisible = false;
  later.readiness.playerChunkReady = false;
  assert.equal(trace.readinessFailures, 0, "synthetic stale counter must not hide failed retained evidence");
  const failure = r3PerformanceFirstReadinessFailure(trace)!;
  assert.equal(failure.frameIndex, 7);
  assert.equal(failure.frame.callbackOrdinal, first.callbackOrdinal);
  assert.equal(failure.frame.simulationTick, first.simulationTick);
  assert.equal(failure.frame.simulationTickAfter, first.simulationTickAfter);
  assert.equal(failure.frame.rafTimestamp, first.rafTimestamp);
  assert.deepEqual(failure.frame.point, first.point);
  assert.match(failure.reason, /visible presentation/);
  assert.equal(failure.previousFrame?.callbackOrdinal, trace.frames[6].callbackOrdinal);
  assert.equal(failure.readiness.playerTerrainPresentation.chunks[0].requiredSections[0].presentations.opaque.sourceVisible, false);
});

test("first readiness failure is null for all-ready traces and has no invented preceding frame", () => {
  const trace = evidence().traces[0];
  assert.equal(r3PerformanceFirstReadinessFailure(trace), null);
  assert.equal(r3PerformanceSkillTraceSummary(trace).firstReadinessFailure, null);
  trace.frames[0].readiness.playerChunkReady = false;
  assert.equal(r3PerformanceFirstReadinessFailure(trace)!.previousFrame, null);
});

test("first readiness diagnostic is bounded, detached, and preserves direct built-section evidence without mutation", () => {
  const trace = evidence().traces[0]; const sample = trace.frames[2];
  sample.readiness.immediateRing = { desired: 9, ready: 8, ratio: 8 / 9 };
  sample.readiness.occupancy[0].sections[0].built = false;
  const chunks = sample.readiness.playerTerrainPresentation.chunks as unknown as Array<{ key: string; requiredSections: unknown[] }>;
  chunks[0].key = "x".repeat(10_000);
  chunks[0].requiredSections.push(...Array(30).fill(chunks[0].requiredSections[0]));
  chunks.push(...Array(30).fill(chunks[0]));
  Object.assign(sample, { unrelatedLargePayload: new Uint8Array(100_000) });
  Object.assign(sample.telemetry, { unrelatedLargePayload: new Uint8Array(100_000) });
  const before = structuredClone(trace);
  const failure = r3PerformanceFirstReadinessFailure(trace)!;
  assert.equal(failure.readiness.playerTerrainPresentation.chunks.length, 9);
  assert.equal(failure.readiness.playerTerrainPresentation.omittedChunks, 30);
  assert.equal(failure.readiness.playerTerrainPresentation.chunks[0].key?.length, 128);
  assert.equal(failure.readiness.playerTerrainPresentation.chunks[0].requiredSections.length, 2);
  assert.equal(failure.readiness.playerTerrainPresentation.chunks[0].omittedRequiredSections, 30);
  assert.equal(failure.readiness.occupancy[0].sections[0].built, false);
  assert.equal(failure.frame.queues.meshSections, sample.telemetry.meshSectionsQueued);
  assert.equal(failure.frame.generationWorker.epoch, sample.telemetry.generationWorker.epoch);
  assert(JSON.stringify(failure).length < 20_000, "one bounded diagnostic must not embed a full trace or terrain buffers");
  assert(!JSON.stringify(failure).includes("unrelatedLargePayload"));
  assert.deepEqual(trace, before);
  failure.frame.point.x += 100;
  failure.readiness.occupancy[0].sections[0].built = true;
  assert.deepEqual(trace, before, "mutating a projected diagnostic must not mutate retained source evidence");
});

test("skill failure diagnostics cannot turn failed readiness into passing evidence", () => {
  const state = evidence(); state.traces[0].frames[7].readiness.playerChunkReady = false;
  const summary = { schema: 2, status: "passed", error: null, profile: state.profile, artifactHash: state.artifactHash,
    corpusHash: state.corpusHash, traceHash: state.traceHash, policy: state.policy, completedCases: 155, warmup: true,
    traces: state.traces.map(r3PerformanceSkillTraceSummary), cleanup: state.cleanup };
  assert.equal(summary.traces[0].readinessFailures, 0, "the diagnostic must not rewrite the recorded failure count");
  assert(summary.traces[0].firstReadinessFailure);
  assert.throws(() => assertR3GenerationPerformanceSkillSummary(summary, expectation()), /first readiness failure/);
  assert.throws(() => assertR3GenerationPerformanceEvidence(state, expectation()), /not ready/);
  assert.throws(() => assertR3GenerationPerformanceSkillSummary({ ...summary, status: "failed" }, expectation()), /did not pass/);
  summary.traces[0].firstReadinessFailure = null;
  summary.traces[0].readinessFailures = 1;
  assert.throws(() => assertR3GenerationPerformanceSkillSummary(summary, expectation()), /readiness/);
  summary.traces[0].readinessFailures = 0;
  delete (summary.traces[0] as Partial<typeof summary.traces[0]>).firstReadinessFailure;
  assert.throws(() => assertR3GenerationPerformanceSkillSummary(summary, expectation()), /first readiness failure/);
});

test("browser fixture uses default authority, real frame API, explicit start, and copied pre-seam light", () => {
  const source = readFileSync(new URL("./fixtures/r3-generation-performance.ts", import.meta.url), "utf8");
  assert.match(source, /new ChunkWorld\(\)/); assert.doesNotMatch(source, /workerFactory|new ChunkWorld\(\{/);
  assert.match(source, /world\.initializeAround\(x, z\)/); assert.match(source, /requestAnimationFrame\(pulse\)/);
  assert(source.indexOf("const update = frameSample(world, point") < source.indexOf("const advanced = advanceR3PerformanceClock(clock, timestamp)"),
    "every streaming callback must update the world before advancing physics");
  assert.match(source, /light: chunk\.light\.slice\(\)/); assert.match(source, /terrainGenerationChunksByteEqualV2\(actual, expected\)/);
  assert.match(source, /startR3Performance = \(\) => running \?\?= run\(\)/);
  assert.match(source, /setResourceTimingBufferSize\(10_000\)/);
  const measuredFrames = source.slice(source.indexOf("function frameSample("), source.indexOf("async function run()"));
  assert.doesNotMatch(measuredFrames, /r3PerformanceSkillTraceSummary|r3PerformanceFirstReadinessFailure/,
    "failure diagnostics must not add observer work to measured callbacks");
  const summaryProjection = source.indexOf("finishedSkillTraces = state.traces.map(r3PerformanceSkillTraceSummary)");
  assert(summaryProjection > source.indexOf("for (const world of [...liveWorlds]) disposeWorld(world)"),
    "bounded failure projection must follow the run's final world cleanup");
  assert.match(source, /traces: finishedSkillTraces \?\? state\.traces\.map/,
    "the skill hook must reuse completed diagnostics instead of rescanning frames");
  const html = readFileSync(new URL("./fixtures/r3-generation-performance.html", import.meta.url), "utf8");
  assert.match(html, /id="run"/); assert.match(html, /href="data:,"/);
});
