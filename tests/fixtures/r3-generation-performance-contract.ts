import {
  createGenerateChunkRequestV2, hashTerrainGenerationIdentityV2, LEGACY_TERRAIN_CONTENT_HASH_V2, legacyTerrainGeneratorHashV2,
  stableTerrainGenerationJsonV2, TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2, TERRAIN_GENERATION_SECTION_COUNT_V2,
} from "../../app/game/terrain-generation-contract.ts";
import type { ChunkWorld, ChunkWorkFrameReport } from "../../app/game/world.ts";
import type { R3WorkerCase, R3WorkerManifest } from "./r3-production-worker-contract.ts";

export type R3PerformanceProfile = "rust-primary" | "typescript-rollback";
export type R3PerformanceLandscape = {
  id: string; seed: string; chunk: readonly [number, number]; focus: string;
  camera: { position: readonly [number, number, number]; lookAt: readonly [number, number, number]; fov: number };
};
export type R3PerformanceConfig = { schema: 2; profile: R3PerformanceProfile; landscapes: readonly R3PerformanceLandscape[] };

/** V1 was fixed-frame stress. V2 preserves its path on the production simulation clock. */
export const R3_PERFORMANCE_TRACE_V2 = {
  schema: 2, nominalHz: 60, totalMovementTicks: 420,
  phases: [
    { name: "walk", movementTicks: 120, velocityX: 4, velocityZ: 0 },
    { name: "sprint", movementTicks: 120, velocityX: 8, velocityZ: 0 },
    { name: "reverse", movementTicks: 180, velocityX: -8, velocityZ: 0 },
  ],
  maximumDeltaSeconds: 0.08, maximumAccumulatedTicks: 4,
  updateOrder: "world-update-before-fixed-step-movement", finalPositionUpdates: 1,
} as const;
export const R3_PERFORMANCE_POLICY_V2 = {
  schema: 2,
  constructor: "default-new-ChunkWorld", serviceBoundary: "awaitGenerationRing-radius-0-installed",
  warmupCases: 1, resetsPerCase: 1, renderDistance: 10,
  generationBudget: 1, meshSliceBudget: 2, frameBudgetMilliseconds: 5,
  traceClock: "real-requestAnimationFrame-production-fixed-step-accumulator", updatesPerFrame: 1,
  drawableScope: "local-height-opaque-cutout-with-verified-empty-sections",
  classification: "generation-and-streaming-subsystem-not-full-game-frame",
  memoryScope: "browser-harness-including-retained-independent-oracle-not-whole-game",
  reverseScope: "resident-chunk-backtracking-not-eviction-or-persistent-rehydration",
  runtimeReadyBoundary: "generation-and-terrain-workers-ready-plus-cold-cache-guard",
  traceStartup: "reset-initializeAround-awaitGenerationRing-real-raf-drawable",
  startupRafBaseline: "second-distinct-callback-before-reset",
} as const;

export function r3PerformanceRequest(entry: R3WorkerCase) {
  const [cx, cz] = entry.chunk; const options = entry.options ?? {};
  const namespace = `terrain-v5|g18|${entry.seed}|${stableTerrainGenerationJsonV2(options)}|${cx},${cz}|${entry.edits?.length ? 1 : 0}`;
  return createGenerateChunkRequestV2({ epoch: 1, taskId: entry.ordinal, revision: entry.ordinal, namespace,
    contentHash: LEGACY_TERRAIN_CONTENT_HASH_V2, generatorHash: legacyTerrainGeneratorHashV2(namespace),
    seedText: entry.seed, generationOptions: options, key: `${cx},${cz}`, cx, cz, edits: entry.edits ?? [] });
}

export function r3PerformanceTracePoints(landscape: R3PerformanceLandscape) {
  let x = landscape.chunk[0] * 16 + 8; let z = landscape.chunk[1] * 16 + 8; let ordinal = 0;
  return R3_PERFORMANCE_TRACE_V2.phases.flatMap(phase => Array.from({ length: phase.movementTicks }, () => {
    x += phase.velocityX / R3_PERFORMANCE_TRACE_V2.nominalHz;
    z += phase.velocityZ / R3_PERFORMANCE_TRACE_V2.nominalHz;
    return { ordinal: ++ordinal, phase: phase.name, x, z, y: landscape.camera.lookAt[1],
      velocityX: phase.velocityX, velocityZ: phase.velocityZ };
  }));
}
export type R3PerformancePoint = Omit<ReturnType<typeof r3PerformanceTracePoints>[number], "velocityX" | "velocityZ"> & {
  velocityX: number; velocityZ: number;
};
export function r3PerformanceStartPoint(landscape: R3PerformanceLandscape): R3PerformancePoint {
  return { ordinal: 0, phase: "walk", x: landscape.chunk[0] * 16 + 8, z: landscape.chunk[1] * 16 + 8,
    y: landscape.camera.lookAt[1], velocityX: 0, velocityZ: 0 };
}

export type R3PerformanceClock = {
  previousTimestamp: number; callbackOrdinal: number; simulationTick: number; accumulatorSeconds: number;
};
export type R3PerformanceClockSample = {
  callbackOrdinal: number;
  /** Fixed steps executed AFTER this callback's world.update. */
  physicsSteps: number;
  /** Tick/time and point describe the BEFORE-physics world.update boundary. */
  simulationTick: number; simulationTimeSeconds: number;
  simulationTickAfter: number; simulationTimeSecondsAfter: number;
  rawDeltaSeconds: number; clampedDeltaSeconds: number;
  accumulatorSecondsBefore: number; accumulatorSecondsAfter: number;
  /** One last update observes tick 420; no further movement is simulated. */
  finalPositionUpdate: boolean;
};
export function createR3PerformanceClock(previousTimestamp: number): R3PerformanceClock {
  duration(previousTimestamp, "clock baseline");
  return { previousTimestamp, callbackOrdinal: 0, simulationTick: 0, accumulatorSeconds: 0 };
}

/** A first callback may retain a timestamp from before the synchronous corpus.
 * Settle before reset, so pre-measurement work is excluded but all reset stalls
 * remain in the continuously requested startup observer pulses.
 */
export async function settleR3PerformanceStartupBaseline(nextFrame: () => Promise<number>) {
  const firstTimestamp = await nextFrame();
  duration(firstTimestamp, "startup settling callback");
  const baselineTimestamp = await nextFrame();
  duration(baselineTimestamp, "startup frame baseline");
  invariant(baselineTimestamp > firstTimestamp, "startup frame baseline did not advance");
  return baselineTimestamp;
}

/** Mirrors VoxelEngine.animate's dt clamp, accumulator cap and fixed-step loop. */
export function advanceR3PerformanceClock(clock: R3PerformanceClock, timestamp: number) {
  duration(timestamp, "clock callback");
  invariant(timestamp > clock.previousTimestamp, "clock callback did not advance");
  const step = 1 / R3_PERFORMANCE_TRACE_V2.nominalHz;
  const rawDeltaSeconds = (timestamp - clock.previousTimestamp) / 1000;
  const clampedDeltaSeconds = Math.min(R3_PERFORMANCE_TRACE_V2.maximumDeltaSeconds, Math.max(0, rawDeltaSeconds));
  const finalPositionUpdate = clock.simulationTick === R3_PERFORMANCE_TRACE_V2.totalMovementTicks;
  let accumulator = clock.accumulatorSeconds; let simulationTick = clock.simulationTick; let physicsSteps = 0;
  if (!finalPositionUpdate) {
    accumulator = Math.min(accumulator + clampedDeltaSeconds, step * R3_PERFORMANCE_TRACE_V2.maximumAccumulatedTicks);
    while (accumulator >= step && simulationTick < R3_PERFORMANCE_TRACE_V2.totalMovementTicks) {
      simulationTick += 1; physicsSteps += 1; accumulator -= step;
    }
  }
  const sample: R3PerformanceClockSample = {
    callbackOrdinal: clock.callbackOrdinal + 1, physicsSteps,
    simulationTick: clock.simulationTick, simulationTimeSeconds: clock.simulationTick * step,
    simulationTickAfter: simulationTick, simulationTimeSecondsAfter: simulationTick * step,
    rawDeltaSeconds, clampedDeltaSeconds,
    accumulatorSecondsBefore: clock.accumulatorSeconds, accumulatorSecondsAfter: accumulator, finalPositionUpdate,
  };
  return { sample, clock: { previousTimestamp: timestamp, callbackOrdinal: sample.callbackOrdinal,
    simulationTick, accumulatorSeconds: accumulator } };
}

/** Reconstruct every step from the raw rAF timestamps, not from claimed tick totals. */
export function assertR3PerformanceClockReplay(
  frames: readonly R3PerformanceStreamingFrame[], baseline: number, landscape: R3PerformanceLandscape,
) {
  invariant(Array.isArray(frames) && frames.length > 0, "streaming callback evidence missing");
  const points = r3PerformanceTracePoints(landscape); const start = r3PerformanceStartPoint(landscape);
  let clock = createR3PerformanceClock(baseline);
  frames.forEach((frame, index) => {
    invariant(frame.updates === 1 && Number.isFinite(frame.rafIntervalMilliseconds)
      && Math.abs(frame.rafTimestamp - clock.previousTimestamp - frame.rafIntervalMilliseconds) < 0.01,
    "streaming callback/update/interval evidence mismatch");
    const expected = advanceR3PerformanceClock(clock, frame.rafTimestamp);
    equal(Object.fromEntries(Object.keys(expected.sample).map(key => [key, frame[key as keyof R3PerformanceClockSample]])),
      expected.sample, "timestamp/accumulator/fixed-step accounting mismatch");
    equal(frame.point, clock.simulationTick === 0 ? start : points[clock.simulationTick - 1], "streaming pre-physics path identity changed");
    invariant(frame.finalPositionUpdate === (index === frames.length - 1), "terminal final-position update missing or followed by extra callbacks");
    clock = expected.clock;
  });
  invariant(clock.simulationTick === R3_PERFORMANCE_TRACE_V2.totalMovementTicks, "full movement tick progression missing");
}
export function assertR3PerformanceStreamingClock(trace: Pick<R3PerformanceTrace, "landscape" | "startupFrames" | "frames">) {
  const baseline = trace.startupFrames?.at(-1)?.rafTimestamp;
  duration(baseline, "streaming clock startup boundary");
  assertR3PerformanceClockReplay(trace.frames, baseline!, trace.landscape);
}
export function r3PerformanceTraceHash(landscapes: readonly R3PerformanceLandscape[]) {
  return hashTerrainGenerationIdentityV2("blockwild-r3-performance-trace-v2", stableTerrainGenerationJsonV2({
    trace: R3_PERFORMANCE_TRACE_V2, landscapes, points: landscapes.map(r3PerformanceTracePoints),
  }));
}
type Diagnostics = ReturnType<ChunkWorld["streamingDiagnostics"]>;
export type R3PerformanceTelemetry = Pick<Diagnostics,
  "generationWorker" | "terrainWorker" | "throughput" | "cache" | "generationQueued" | "lightingQueued" |
  "meshSectionsQueued" | "generationBudget" | "meshSliceBudget" | "frameBudgetMilliseconds"> & {
  renderDistance: number; residentChunks: number; residentPayloadBytes: number;
  heap: { available: false } | { available: true; usedBytes: number; totalBytes: number; limitBytes: number };
};
export type R3PerformanceReadiness = Pick<Diagnostics,
  "playerChunk" | "playerSection" | "playerChunkReady" | "playerChunkStage" | "immediateRing" | "playerTerrainPresentation"> & {
  /** Occupancy is read directly from installed chunks, including the zero-section case. */
  occupancy: { key: string; sections: { section: number; blockCount: number; built: boolean }[] }[];
};
export type R3PerformanceRow = {
  id: string; ordinal: number; profile: R3PerformanceProfile; resetCount: 1;
  resetMilliseconds: number; runtimeReadyMilliseconds: number;
  initializedRuntimeAcceptedMilliseconds: number; resetToAcceptedMilliseconds: number;
  accepted: boolean; exactBytes: boolean; chunkHash: string; streamBytes: number[];
  expectedBytesHash: string; generationDelta: number; memoryCacheHitDelta: number; persistentCacheHitDelta: number;
  coldWorldChunks: number; coldMemoryCacheEntries: number;
  telemetry: R3PerformanceTelemetry;
};
export type R3PerformanceFrame = {
  point: R3PerformancePoint; updates: 1; rafTimestamp: number; rafIntervalMilliseconds: number;
  updateMilliseconds: number; observerMilliseconds: number; work: ChunkWorkFrameReport;
  telemetry: R3PerformanceTelemetry; readiness: R3PerformanceReadiness;
};
export type R3PerformanceStreamingFrame = R3PerformanceFrame & R3PerformanceClockSample;
export type R3PerformanceTrace = {
  landscape: R3PerformanceLandscape; profile: R3PerformanceProfile; resetCount: 1;
  constructionMilliseconds: number; resetToInstalledMilliseconds: number; resetToDrawableMilliseconds: number;
  initialRafTimestamp: number; startupUpdateRafTimestamp: number;
  /** Continuously requested pulses span asynchronous admission AND synchronous blocking. */
  startupRafPulses: { timestamp: number; intervalMilliseconds: number }[];
  initialReadiness: R3PerformanceReadiness; initialTelemetry: R3PerformanceTelemetry;
  /** Update frames begin after installed admission, using their own genuine rAF baseline. */
  startupFrames: R3PerformanceFrame[]; frames: R3PerformanceStreamingFrame[];
  terminalReadiness: R3PerformanceReadiness; readinessFailures: number;
};
export type R3PerformanceState = {
  schema: 2; status: "idle" | "running" | "passed" | "failed"; phase: string;
  profile: R3PerformanceProfile | null; artifactHash: string | null; corpusHash: string | null;
  traceHash: string | null;
  policy: typeof R3_PERFORMANCE_POLICY_V2; trace: typeof R3_PERFORMANCE_TRACE_V2;
  constructionMilliseconds: number | null; warmup: R3PerformanceRow | null;
  rows: R3PerformanceRow[]; traces: R3PerformanceTrace[]; error: string | null;
  cleanup: { worldsCreated: number; worldsDisposed: number; workersDisposed: boolean };
};

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`R3 generation performance: ${message}`);
}
function equal(actual: unknown, expected: unknown, message: string) {
  invariant(JSON.stringify(actual) === JSON.stringify(expected), message);
}
function duration(value: unknown, message: string) {
  invariant(typeof value === "number" && Number.isFinite(value) && value >= 0, `${message}: invalid timing`);
}
function count(value: unknown, message: string) {
  invariant(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, `${message}: invalid count`);
}

export function assertR3PerformanceTelemetry(value: R3PerformanceTelemetry, profile: R3PerformanceProfile) {
  invariant(value && value.generationWorker && value.cache && value.throughput && value.terrainWorker, "missing telemetry");
  const worker = value.generationWorker; const rust = profile === "rust-primary";
  invariant(worker.mode === (rust ? "rust" : "typescript") && worker.selectionSource === `build-${profile}`,
    "compiled profile mismatch or constructor/test authority override");
  invariant(worker.state === (rust ? "ready" : "typescript-rollback"), "generation authority is not ready");
  invariant(worker.authorityRequired === rust && worker.supported === rust, "generation authority support mismatch");
  invariant(worker.lastError === null && worker.failed === 0 && worker.rejected === 0 && worker.restarts === 0,
    "worker failure, rejection, recovery, or fallback invalidates timing");
  invariant(value.terrainWorker.supported && value.terrainWorker.ready && value.terrainWorker.failed === 0
    && value.terrainWorker.restarts === 0 && value.terrainWorker.lastError === null, "terrain-buffer worker failure or fallback invalidates timing");
  count(worker.workers, "worker count"); count(worker.ready, "ready worker count");
  invariant(rust ? worker.workers > 0 && worker.ready === worker.workers : worker.workers === 0 && worker.ready === 0,
    "wrong worker population for compiled profile");
  for (const field of ["submitted", "completed", "stale", "canceled", "transferBytes", "epoch"] as const) count(worker[field], field);
  for (const field of ["generationBudget", "meshSliceBudget", "frameBudgetMilliseconds", "renderDistance"] as const) {
    invariant(value[field] === R3_PERFORMANCE_POLICY_V2[field], `production ${field} changed`);
  }
  for (const amount of [value.residentChunks, value.residentPayloadBytes, value.generationQueued, value.lightingQueued,
    value.meshSectionsQueued, ...Object.values(value.throughput), ...Object.values(value.cache.memory),
    value.cache.persistentHits, value.cache.persistentMisses, value.cache.pendingReads]) count(amount, "telemetry counter");
  invariant(value.heap && typeof value.heap.available === "boolean", "missing heap availability");
  if (value.heap.available) {
    for (const bytes of [value.heap.usedBytes, value.heap.totalBytes, value.heap.limitBytes]) count(bytes, "heap bytes");
    invariant(value.heap.usedBytes <= value.heap.totalBytes && value.heap.totalBytes <= value.heap.limitBytes, "invalid heap accounting");
  }
}

/** Do not trust the aggregate ready flags: validate every chunk, section, and visible layer. */
export function assertR3PerformanceReadiness(value: R3PerformanceReadiness) {
  invariant(value && value.playerChunkReady && value.playerChunkStage === "ready", "player chunk is not ready");
  invariant(value.immediateRing?.desired === 9 && value.immediateRing.ready === 9 && value.immediateRing.ratio === 1,
    "installed/light/mesh immediate ring is incomplete");
  const presentation = value.playerTerrainPresentation;
  invariant(presentation?.schema === 1 && presentation.centerKey === value.playerChunk && presentation.desired === 9,
    "drawable ring identity mismatch");
  invariant(presentation.chunks.length === 9 && value.occupancy?.length === 9, "drawable ring omitted chunks or occupancy");
  const center = value.playerChunk.split(",").map(Number);
  invariant(center.length === 2 && center.every(Number.isSafeInteger), "invalid player chunk key");
  invariant(Number.isInteger(value.playerSection) && value.playerSection >= 0 && value.playerSection < TERRAIN_GENERATION_SECTION_COUNT_V2, "invalid player section");
  const candidateSections = [value.playerSection, value.playerSection - 1].filter(section => section >= 0);
  const keys = new Set<string>();
  for (const chunk of presentation.chunks) {
    const { x, z } = chunk.offset;
    invariant([-1, 0, 1].includes(x) && [-1, 0, 1].includes(z), "invalid drawable chunk offset");
    invariant(chunk.key === `${center[0] + x},${center[1] + z}` && !keys.has(chunk.key), "duplicate/misplaced drawable chunk");
    keys.add(chunk.key);
    invariant(chunk.present && chunk.visible && chunk.lightReady, "drawable chunk is missing, invisible, or unlit");
    const matches = value.occupancy.filter(entry => entry.key === chunk.key);
    invariant(matches.length === 1, "missing/duplicate direct section occupancy");
    const occupied = matches[0].sections;
    equal(occupied.map(section => section.section), candidateSections, "section occupancy omitted a candidate section");
    occupied.forEach(section => count(section.blockCount, "section occupancy"));
    equal(chunk.requiredSections.map(section => section.section), occupied.filter(section => section.blockCount > 0).map(section => section.section),
      "required drawable sections disagree with installed occupancy");
    for (const section of chunk.requiredSections) {
      invariant(section.ready, "required section is not drawable");
      invariant(new Set(section.requiredLayers).size === section.requiredLayers.length, "duplicate required layer");
      for (const layer of section.requiredLayers) invariant(layer === "opaque" || layer === "cutout", "invalid drawable layer");
      for (const layer of ["opaque", "cutout"] as const) {
        const item = section.presentations[layer];
        invariant(item && item.required === section.requiredLayers.includes(layer), "required layer declaration mismatch");
        if (!item.required) continue;
        invariant((item.mode === "source" && item.source && item.sourceVisible)
          || (item.mode === "combined" && item.combined && item.combinedVisible), "required layer lacks visible presentation");
      }
    }
    invariant(chunk.ready === (chunk.requiredSections.length > 0), "drawable aggregate contradicts occupied sections");
  }
  invariant(presentation.ready === presentation.chunks.filter(chunk => chunk.ready).length, "drawable aggregate count mismatch");
}

function diagnosticText(value: unknown) { return typeof value === "string" ? value.slice(0, 128) : null; }
function diagnosticRing(value: R3PerformanceReadiness["immediateRing"] | undefined) {
  return { desired: value?.desired ?? null, ready: value?.ready ?? null, ratio: value?.ratio ?? null };
}
function diagnosticFrame(frame: R3PerformanceStreamingFrame) {
  const worker = frame.telemetry.generationWorker; const terrain = frame.telemetry.terrainWorker;
  return {
    callbackOrdinal: frame.callbackOrdinal, simulationTick: frame.simulationTick, simulationTickAfter: frame.simulationTickAfter,
    rafTimestamp: frame.rafTimestamp, rafIntervalMilliseconds: frame.rafIntervalMilliseconds,
    updateMilliseconds: frame.updateMilliseconds,
    point: { ordinal: frame.point.ordinal, phase: diagnosticText(frame.point.phase), x: frame.point.x, y: frame.point.y,
      z: frame.point.z, velocityX: frame.point.velocityX, velocityZ: frame.point.velocityZ },
    playerChunk: diagnosticText(frame.readiness?.playerChunk), playerSection: frame.readiness?.playerSection ?? null,
    playerChunkReady: frame.readiness?.playerChunkReady ?? null, playerChunkStage: diagnosticText(frame.readiness?.playerChunkStage),
    immediateRing: diagnosticRing(frame.readiness?.immediateRing),
    queues: { generation: frame.telemetry.generationQueued, lighting: frame.telemetry.lightingQueued,
      meshSections: frame.telemetry.meshSectionsQueued, residentChunks: frame.telemetry.residentChunks },
    throughput: { generation: frame.telemetry.throughput.generation, lighting: frame.telemetry.throughput.lighting,
      meshing: frame.telemetry.throughput.meshing },
    generationWorker: { mode: diagnosticText(worker.mode), state: diagnosticText(worker.state), epoch: worker.epoch,
      workers: worker.workers, ready: worker.ready, busy: worker.busy, submitted: worker.submitted, completed: worker.completed,
      failed: worker.failed, rejected: worker.rejected, stale: worker.stale, canceled: worker.canceled, restarts: worker.restarts,
      lastError: diagnosticText(worker.lastError?.message) },
    terrainWorker: { supported: terrain.supported, ready: terrain.ready, pending: terrain.pending,
      submitted: terrain.submitted, completed: terrain.completed, failed: terrain.failed, restarts: terrain.restarts,
      lastError: diagnosticText(terrain.lastError) },
  };
}
function diagnosticReadiness(value: R3PerformanceReadiness) {
  const presentation = value?.playerTerrainPresentation; const chunks = presentation?.chunks ?? [];
  const occupancy = value?.occupancy ?? [];
  const layer = (item: R3PerformanceReadiness["playerTerrainPresentation"]["chunks"][number]["requiredSections"][number]["presentations"]["opaque"] | undefined) => ({
    required: item?.required ?? null, mode: diagnosticText(item?.mode), source: item?.source ?? null,
    sourceVisible: item?.sourceVisible ?? null, combined: item?.combined ?? null, combinedVisible: item?.combinedVisible ?? null,
  });
  return {
    playerTerrainPresentation: { schema: presentation?.schema ?? null, epoch: presentation?.epoch ?? null,
      centerKey: diagnosticText(presentation?.centerKey), desired: presentation?.desired ?? null, ready: presentation?.ready ?? null,
      omittedChunks: Math.max(0, chunks.length - 9),
      chunks: chunks.slice(0, 9).map(chunk => ({ key: diagnosticText(chunk.key), offset: { x: chunk.offset.x, z: chunk.offset.z },
        present: chunk.present, visible: chunk.visible, lightReady: chunk.lightReady, ready: chunk.ready,
        omittedRequiredSections: Math.max(0, chunk.requiredSections.length - 2),
        requiredSections: chunk.requiredSections.slice(0, 2).map(section => ({ section: section.section, ready: section.ready,
          requiredLayers: section.requiredLayers.slice(0, 2).map(diagnosticText),
          omittedRequiredLayers: Math.max(0, section.requiredLayers.length - 2),
          presentations: { opaque: layer(section.presentations?.opaque), cutout: layer(section.presentations?.cutout) },
        })),
      })),
    },
    omittedOccupancy: Math.max(0, occupancy.length - 9),
    occupancy: occupancy.slice(0, 9).map(chunk => ({ key: diagnosticText(chunk.key), omittedSections: Math.max(0, chunk.sections.length - 2),
      sections: chunk.sections.slice(0, 2).map(section => ({ section: section.section, blockCount: section.blockCount, built: section.built })),
    })),
  };
}

/** Post-run projection only: use the unchanged predicate, not recorded aggregate failure counts. */
export function r3PerformanceFirstReadinessFailure(trace: Pick<R3PerformanceTrace, "frames">) {
  for (const [frameIndex, frame] of trace.frames.entries()) {
    let reason: string;
    try { assertR3PerformanceReadiness(frame.readiness); continue; }
    catch (error) { reason = error instanceof Error ? error.message : String(error); }
    return { schema: 1 as const, frameIndex, reason: reason.slice(0, 256), frame: diagnosticFrame(frame),
      readiness: diagnosticReadiness(frame.readiness), previousFrame: frameIndex > 0 ? diagnosticFrame(trace.frames[frameIndex - 1]) : null };
  }
  return null;
}

/** No buffers/full history escape; failure details are calculated once after all measured work. */
export function r3PerformanceSkillTraceSummary(trace: R3PerformanceTrace) {
  return { id: trace.landscape.id, frames: trace.frames.length,
    movementTicks: trace.frames.at(-1)?.simulationTickAfter ?? 0,
    finalPositionUpdate: trace.frames.at(-1)?.finalPositionUpdate ?? false,
    readinessFailures: trace.readinessFailures, firstReadinessFailure: r3PerformanceFirstReadinessFailure(trace) };
}

function assertRow(row: R3PerformanceRow, entry: R3WorkerCase, profile: R3PerformanceProfile) {
  invariant(row && row.id === entry.id && row.ordinal === entry.ordinal && row.profile === profile, "service case/profile mismatch");
  invariant(row.resetCount === 1 && row.accepted === true && row.exactBytes === true, "service reset, acceptance, or exact-byte proof missing");
  invariant(row.chunkHash === entry.expectedChunkHash && row.expectedBytesHash === entry.expectedBytesHash, "service oracle hashes differ");
  equal(row.streamBytes, entry.streamBytes, "service stream coverage mismatch");
  for (const field of ["resetMilliseconds", "runtimeReadyMilliseconds", "initializedRuntimeAcceptedMilliseconds", "resetToAcceptedMilliseconds"] as const) duration(row[field], field);
  invariant(row.initializedRuntimeAcceptedMilliseconds > 0 && row.resetToAcceptedMilliseconds > 0, "service acceptance duration is zero");
  invariant(Math.abs(row.resetToAcceptedMilliseconds - row.resetMilliseconds - row.runtimeReadyMilliseconds
    - row.initializedRuntimeAcceptedMilliseconds) < 0.01, "reset/initialization/accepted timing accounting mismatch");
  invariant(row.coldWorldChunks === 0 && row.coldMemoryCacheEntries === 0 && row.generationDelta === 1
    && row.memoryCacheHitDelta === 0 && row.persistentCacheHitDelta === 0 && row.telemetry?.residentChunks === 1,
  "service sample was not one cold-cache independently accepted chunk");
  assertR3PerformanceTelemetry(row.telemetry, profile);
}

function assertFrame(frame: R3PerformanceFrame, previousTimestamp: number, profile: R3PerformanceProfile) {
  invariant(frame && frame.updates === 1, "missing frame or multiple world updates per rAF");
  duration(frame.rafTimestamp, "rAF timestamp"); duration(frame.rafIntervalMilliseconds, "rAF interval");
  invariant(frame.rafTimestamp > previousTimestamp && Math.abs(frame.rafTimestamp - previousTimestamp - frame.rafIntervalMilliseconds) < 0.01,
    "rAF sample sequence/interval mismatch");
  duration(frame.updateMilliseconds, "world update"); duration(frame.observerMilliseconds, "observer");
  invariant(frame.work && Object.keys(frame.work).length === 9, "missing world update work accounting");
  for (const field of ["schedulingMilliseconds", "generationMilliseconds", "lightingMilliseconds", "meshingMilliseconds", "installationMilliseconds"] as const) duration(frame.work[field], field);
  for (const field of ["generationSlices", "lightingSlices", "meshSlices", "installationSlices"] as const) count(frame.work[field], field);
  assertR3PerformanceTelemetry(frame.telemetry, profile);
}

export function assertR3GenerationPerformanceEvidence(
  value: unknown,
  expected: { profile: R3PerformanceProfile; manifest: R3WorkerManifest; landscapes: readonly R3PerformanceLandscape[] },
): asserts value is R3PerformanceState {
  const state = value as R3PerformanceState; const { profile, manifest, landscapes } = expected;
  invariant(state?.schema === 2 && state.status === "passed" && state.error === null, "run did not pass");
  invariant(state.profile === profile && (profile === "rust-primary" || profile === "typescript-rollback"), "run profile mismatch");
  invariant(state.artifactHash === manifest.artifactHash && /^[0-9a-f]{64}$/.test(state.artifactHash), "artifact hash mismatch");
  invariant(state.corpusHash === manifest.corpusHash && state.corpusHash === TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
    "full composed corpus identity mismatch");
  invariant(manifest.schema === 1 && manifest.cases.length === TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2
    && new Set(manifest.cases.map(entry => entry.id)).size === manifest.cases.length, "expected full155 corpus is incomplete");
  equal(state.policy, R3_PERFORMANCE_POLICY_V2, "measurement/warmup policy changed");
  equal(state.trace, R3_PERFORMANCE_TRACE_V2, "fixed streaming trace changed");
  invariant(state.traceHash === r3PerformanceTraceHash(landscapes), "trace/config content hash mismatch");
  duration(state.constructionMilliseconds, "world construction");
  invariant(state.warmup, "equal-policy retained warmup missing");
  assertRow(state.warmup, manifest.cases[0], profile);
  invariant(Array.isArray(state.rows) && state.rows.length === manifest.cases.length, "service cases omitted or added");
  state.rows.forEach((row, index) => assertRow(row, manifest.cases[index], profile));
  invariant(landscapes.length === 5 && new Set(landscapes.map(entry => entry.id)).size === 5, "expected landscapes are incomplete");
  invariant(Array.isArray(state.traces) && state.traces.length === landscapes.length, "landscape traces omitted or added");
  state.traces.forEach((trace, index) => {
    equal(trace.landscape, landscapes[index], "landscape/camera identity changed");
    invariant(trace.profile === profile && trace.resetCount === 1, "trace profile/reset mismatch");
    for (const field of ["constructionMilliseconds", "resetToInstalledMilliseconds", "resetToDrawableMilliseconds", "initialRafTimestamp", "startupUpdateRafTimestamp"] as const) duration(trace[field], field);
    invariant(trace.resetToDrawableMilliseconds >= trace.resetToInstalledMilliseconds, "drawable readiness predates installation");
    assertR3PerformanceTelemetry(trace.initialTelemetry, profile);
    assertR3PerformanceReadiness(trace.initialReadiness);
    invariant(trace.startupRafPulses?.length > 0 && trace.startupUpdateRafTimestamp > trace.initialRafTimestamp,
      "continuous startup rAF pulse evidence missing");
    let pulseTimestamp = trace.initialRafTimestamp;
    for (const pulse of trace.startupRafPulses) {
      duration(pulse.timestamp, "startup pulse timestamp"); duration(pulse.intervalMilliseconds, "startup pulse interval");
      invariant(pulse.timestamp > pulseTimestamp && Math.abs(pulse.timestamp - pulseTimestamp - pulse.intervalMilliseconds) < 0.01,
        "continuous startup pulse accounting mismatch");
      pulseTimestamp = pulse.timestamp;
    }
    invariant(trace.startupFrames?.length > 0, "startup blocking/rAF samples missing");
    let previousTimestamp = trace.startupUpdateRafTimestamp;
    for (const frame of trace.startupFrames) {
      assertFrame(frame, previousTimestamp, profile); previousTimestamp = frame.rafTimestamp;
      equal(frame.point, r3PerformanceStartPoint(trace.landscape), "startup simulated movement before the streaming clock");
      invariant(!("simulationTick" in frame), "startup must not advance the streaming simulation");
      invariant(trace.startupRafPulses.some(pulse => pulse.timestamp === frame.rafTimestamp && pulse.intervalMilliseconds === frame.rafIntervalMilliseconds),
        "startup update interval is not an observed continuously requested frame");
    }
    equal(trace.startupFrames.at(-1)?.readiness, trace.initialReadiness, "initial drawable boundary differs from final startup frame");
    assertR3PerformanceStreamingClock(trace);
    trace.frames.forEach(frame => {
      assertFrame(frame, previousTimestamp, profile); previousTimestamp = frame.rafTimestamp;
      invariant(frame.readiness.playerChunk === `${Math.floor(frame.point.x / 16)},${Math.floor(frame.point.z / 16)}`,
        "readiness sampled at the wrong player position");
      assertR3PerformanceReadiness(frame.readiness);
    });
    invariant(trace.readinessFailures === 0, "streaming readiness failures veto timing");
    invariant(trace.frames.at(-1)!.telemetry.throughput.generation > trace.initialTelemetry.throughput.generation,
      "streaming trace did not perform new generation");
    assertR3PerformanceReadiness(trace.terminalReadiness);
    equal(trace.terminalReadiness, trace.frames.at(-1)?.readiness, "terminal readiness is not the final measured frame");
  });
  invariant(state.cleanup?.worldsCreated === 6 && state.cleanup.worldsDisposed === 6 && state.cleanup.workersDisposed === true,
    "world/worker cleanup incomplete");
}

/** Compact skill-client output: the browser has already run the full validator. */
export function assertR3GenerationPerformanceSkillSummary(value: unknown, expected: {
  profile: R3PerformanceProfile; manifest: R3WorkerManifest; landscapes: readonly R3PerformanceLandscape[];
}) {
  const state = value as Omit<R3PerformanceState, "rows" | "traces" | "warmup"> & {
    completedCases: number; warmup: boolean;
    traces: ReturnType<typeof r3PerformanceSkillTraceSummary>[];
  };
  invariant(state?.schema === 2 && state.status === "passed" && state.error === null, "skill correctness run did not pass");
  invariant(state.profile === expected.profile && state.artifactHash === expected.manifest.artifactHash
    && state.corpusHash === expected.manifest.corpusHash, "skill profile/artifact/corpus mismatch");
  invariant(state.completedCases === TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2 && state.warmup === true, "skill corpus/warmup incomplete");
  equal(state.policy, R3_PERFORMANCE_POLICY_V2, "skill policy mismatch");
  invariant(state.traceHash === r3PerformanceTraceHash(expected.landscapes), "skill trace hash mismatch");
  invariant(Array.isArray(state.traces) && state.traces.length === expected.landscapes.length, "skill landscape evidence incomplete");
  state.traces.forEach((trace, index) => {
    count(trace.frames, "skill callback count");
    invariant(trace.id === expected.landscapes[index].id && trace.frames >= 106
      && trace.movementTicks === R3_PERFORMANCE_TRACE_V2.totalMovementTicks && trace.finalPositionUpdate === true
      && trace.readinessFailures === 0, "skill landscape/tick/readiness evidence incomplete");
    invariant(trace.firstReadinessFailure === null, "skill first readiness failure must be explicitly absent in a passing run");
  });
  equal(state.cleanup, { worldsCreated: 6, worldsDisposed: 6, workersDisposed: true }, "skill cleanup incomplete");
}
