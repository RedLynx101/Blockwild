import { ChunkWorld, CHUNK_SIZE, SECTION_COUNT } from "../../app/game/world.ts";
import { createGeneratedChunkV2, type GeneratedChunkV2 } from "../../app/game/terrain-generation-contract.ts";
import { terrainGenerationChunksByteEqualV2 } from "../../app/game/rust-terrain-generation-backend.ts";
import {
  decodeR3WorkerExpectedChunk, r3WorkerStreams, type R3WorkerCase, type R3WorkerManifest,
} from "./r3-production-worker-contract.ts";
import {
  assertR3GenerationPerformanceEvidence, assertR3PerformanceReadiness, assertR3PerformanceTelemetry,
  advanceR3PerformanceClock, createR3PerformanceClock, r3PerformanceStartPoint,
  settleR3PerformanceStartupBaseline, r3PerformanceSkillTraceSummary,
  r3PerformanceRequest, r3PerformanceTraceHash, r3PerformanceTracePoints, R3_PERFORMANCE_POLICY_V2, R3_PERFORMANCE_TRACE_V2,
  type R3PerformanceConfig, type R3PerformanceFrame, type R3PerformanceLandscape, type R3PerformancePoint,
  type R3PerformanceProfile, type R3PerformanceReadiness, type R3PerformanceRow, type R3PerformanceState,
  type R3PerformanceTelemetry, type R3PerformanceTrace,
} from "./r3-generation-performance-contract.ts";

performance.setResourceTimingBufferSize(10_000);
const state: R3PerformanceState = {
  schema: 2, status: "idle", phase: "Awaiting explicit start", profile: null, artifactHash: null, corpusHash: null, traceHash: null,
  policy: R3_PERFORMANCE_POLICY_V2, trace: R3_PERFORMANCE_TRACE_V2, constructionMilliseconds: null,
  warmup: null, rows: [], traces: [], error: null,
  cleanup: { worldsCreated: 0, worldsDisposed: 0, workersDisposed: false },
};
const canvas = document.querySelector<HTMLCanvasElement>("#evidence")!;
const context = canvas.getContext("2d")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;
let running: Promise<void> | null = null;
let finishedSkillTraces: ReturnType<typeof r3PerformanceSkillTraceSummary>[] | null = null;
const disposalChecks: boolean[] = [];
const liveWorlds = new Set<ChunkWorld>();
// Keep the same independent oracle payloads resident throughout every streaming trace.
// Their storage is fixture overhead, explicitly included in the reported heap scope.
const retainedExpected = new Map<number, GeneratedChunkV2>();

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function draw() {
  context.fillStyle = "#f5f7f2"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#173d36"; context.font = "bold 30px system-ui";
  context.fillText("R3 · Fair generation & streaming comparison", 30, 48);
  context.font = "18px system-ui"; context.fillText(`${state.profile ?? "Compiled profile pending"} · ${state.phase}`, 30, 85);
  context.font = "13px monospace"; context.fillText(`Artifact ${state.artifactHash ?? "awaiting provenance"}`, 30, 114);
  context.font = "bold 18px system-ui"; context.fillText(`Exact accepted chunks: ${state.rows.length} / 155 · retained warmup: ${state.warmup ? "1" : "0"}`, 30, 153);
  for (let index = 0; index < 155; index += 1) {
    context.fillStyle = index < state.rows.length ? "#28775b" : "#d9e2d8";
    context.fillRect(30 + index % 31 * 33, 173 + Math.floor(index / 31) * 13, 28, 9);
  }
  const names = ["POI / negative chunk", "Ocean horizon", "Ocean flora", "Cave / aquifer", "Biome transition"];
  names.forEach((name, index) => {
    const trace = state.traces[index]; const y = 282 + index * 39;
    context.fillStyle = "#173d36"; context.font = "16px system-ui"; context.fillText(name, 30, y);
    context.fillStyle = "#d9e2d8"; context.fillRect(260, y - 14, 540, 17);
    context.fillStyle = trace?.readinessFailures ? "#b7682d" : "#28775b";
    const ticks = trace?.frames.at(-1)?.simulationTickAfter ?? 0;
    context.fillRect(260, y - 14, 540 * ticks / R3_PERFORMANCE_TRACE_V2.totalMovementTicks, 17);
    context.fillStyle = "#173d36"; context.fillText(`${ticks}/420 ticks · ${trace?.frames.length ?? 0} rAF`, 818, y);
  });
  context.font = "bold 20px system-ui"; context.fillStyle = state.status === "failed" ? "#a12b2b" : "#173d36";
  context.fillText(`${state.status.toUpperCase()} · worlds disposed ${state.cleanup.worldsDisposed}/${state.cleanup.worldsCreated}`, 30, 508);
  context.font = "15px system-ui"; context.fillStyle = "#52665e";
  context.fillText("V2 real rAF / production fixed-step clock · default budgets · all 10 streams · strict drawable readiness", 30, 543);
  context.fillText("Subsystem diagnostics only: not a full-game frame or performance-acceptance claim.", 30, 569);
  if (state.error) { context.fillStyle = "#a12b2b"; context.fillText(state.error.slice(0, 132), 30, 602); }
}
function phase(label: string) {
  if (state.phase === label) return;
  state.phase = label; console.info(`[r3-performance] ${state.profile ?? "loading"}: ${label}`); draw();
}
function newWorld() {
  const start = performance.now();
  // Deliberately no authority, renderer, worker, budget, or cache overrides.
  const world = new ChunkWorld();
  const milliseconds = performance.now() - start;
  liveWorlds.add(world); state.cleanup.worldsCreated += 1; state.cleanup.workersDisposed = false;
  return { world, milliseconds };
}
function disposeWorld(world: ChunkWorld) {
  if (!liveWorlds.delete(world)) return;
  world.dispose(); state.cleanup.worldsDisposed += 1;
  const diagnostic = world.streamingDiagnostics();
  disposalChecks.push(diagnostic.generationWorker.state === "disposed" && diagnostic.generationWorker.workers === 0
    && !diagnostic.terrainWorker.supported && !diagnostic.terrainWorker.ready && diagnostic.terrainWorker.pending === 0);
  state.cleanup.workersDisposed = disposalChecks.every(Boolean) && liveWorlds.size === 0;
}
type Diagnostics = ReturnType<ChunkWorld["streamingDiagnostics"]>;
function telemetry(world: ChunkWorld, diagnostic: Diagnostics = world.streamingDiagnostics()): R3PerformanceTelemetry {
  let residentPayloadBytes = 0;
  for (const chunk of world.chunks.values()) {
    for (const stream of [chunk.blocks, chunk.heightmap, chunk.biomes, chunk.sectionBlockCounts, chunk.skyTops, chunk.light]) residentPayloadBytes += stream.byteLength;
    residentPayloadBytes += (chunk.lightIndices.size + chunk.leafIndices.size) * Uint32Array.BYTES_PER_ELEMENT;
  }
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return {
    generationWorker: diagnostic.generationWorker, terrainWorker: diagnostic.terrainWorker,
    throughput: diagnostic.throughput, cache: diagnostic.cache,
    generationQueued: diagnostic.generationQueued, lightingQueued: diagnostic.lightingQueued, meshSectionsQueued: diagnostic.meshSectionsQueued,
    generationBudget: diagnostic.generationBudget, meshSliceBudget: diagnostic.meshSliceBudget,
    frameBudgetMilliseconds: diagnostic.frameBudgetMilliseconds, renderDistance: world.renderDistance,
    residentChunks: world.chunks.size, residentPayloadBytes,
    heap: memory ? { available: true, usedBytes: memory.usedJSHeapSize, totalBytes: memory.totalJSHeapSize, limitBytes: memory.jsHeapSizeLimit }
      : { available: false },
  };
}
function readiness(world: ChunkWorld, diagnostic: Diagnostics): R3PerformanceReadiness {
  const candidateSections = [diagnostic.playerSection, diagnostic.playerSection - 1].filter(section => section >= 0 && section < SECTION_COUNT);
  return {
    playerChunk: diagnostic.playerChunk, playerSection: diagnostic.playerSection,
    playerChunkReady: diagnostic.playerChunkReady, playerChunkStage: diagnostic.playerChunkStage,
    immediateRing: diagnostic.immediateRing, playerTerrainPresentation: diagnostic.playerTerrainPresentation,
    occupancy: diagnostic.playerTerrainPresentation.chunks.map(chunk => ({ key: chunk.key,
      sections: candidateSections.map(section => ({ section, blockCount: world.chunks.get(chunk.key)?.sectionBlockCounts[section] ?? -1,
        built: world.chunks.get(chunk.key)?.sections.has(section) ?? false })) })),
  };
}
async function runtimeReady(world: ChunkWorld, profile: R3PerformanceProfile) {
  const deadline = performance.now() + 60_000;
  while (true) {
    const diagnostic = world.streamingDiagnostics(); const worker = diagnostic.generationWorker;
    invariant(worker.mode === (profile === "rust-primary" ? "rust" : "typescript") && worker.selectionSource === `build-${profile}`,
      "The compiled profile did not select the required default generation authority");
    invariant(worker.state !== "authority-unavailable" && worker.lastError === null, `Generation startup failed: ${JSON.stringify(worker.lastError)}`);
    invariant(diagnostic.terrainWorker.lastError === null && diagnostic.terrainWorker.failed === 0 && diagnostic.terrainWorker.restarts === 0,
      "Terrain-buffer worker initialization failed");
    if (diagnostic.terrainWorker.ready && diagnostic.terrainWorker.supported
      && (worker.state === "typescript-rollback" || (worker.state === "ready" && worker.ready === worker.workers))) return;
    invariant(performance.now() < deadline, "Generation workers did not initialize in 60 seconds");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  invariant(response.ok, `${url}: HTTP ${response.status}`); return response.json();
}
async function expectedChunk(entry: R3WorkerCase) {
  const response = await fetch(`/__r3-production-worker/expected/${entry.ordinal}.bin`, { cache: "no-store" });
  invariant(response.ok, `${entry.id}: missing independent oracle bytes`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  invariant(hash === entry.expectedBytesHash, `${entry.id}: independent oracle SHA-256 mismatch`);
  return decodeR3WorkerExpectedChunk(bytes, entry, r3PerformanceRequest(entry));
}

async function serviceCase(world: ChunkWorld, entry: R3WorkerCase, expected: GeneratedChunkV2, profile: R3PerformanceProfile): Promise<R3PerformanceRow> {
  const [cx, cz] = entry.chunk; const key = `${cx},${cz}`;
  const edits = entry.edits?.length ? { [key]: entry.edits.map(([index, block]): [number, number] => [index, block]) } : undefined;
  const resetStart = performance.now();
  world.reset(entry.seed, edits, entry.options as Parameters<ChunkWorld["reset"]>[2]);
  const resetEnd = performance.now();
  await runtimeReady(world, profile);
  const before = telemetry(world);
  invariant(before.residentChunks === 0 && before.cache.memory.entries === 0, `${entry.id}: service cache was not cold`);
  assertR3PerformanceTelemetry(before, profile);
  const readyTime = performance.now();
  const accepted = await world.awaitGenerationRing(cx * CHUNK_SIZE + 0.5, cz * CHUNK_SIZE + 0.5, 0, 60_000);
  const acceptedTime = performance.now();
  // Nothing after acceptedTime contributes to the accepted-service timers. In particular,
  // copying/hash/byte comparison must precede world.update (which can relight the payload).
  invariant(accepted.mode === (profile === "rust-primary" ? "rust" : "typescript") && accepted.keys.length === 1 && accepted.keys[0] === key,
    `${entry.id}: acceptance returned the wrong authority/key`);
  const chunk = world.chunks.get(key);
  invariant(chunk && world.chunks.size === 1, `${entry.id}: accepted boundary did not install exactly one chunk`);
  const actual = createGeneratedChunkV2(r3PerformanceRequest(entry), {
    key, cx, cz, blocks: chunk.blocks.slice(), heightmap: chunk.heightmap.slice(), biomes: chunk.biomes.slice(),
    sectionBlockCounts: chunk.sectionBlockCounts.slice(), skyTops: chunk.skyTops.slice(), light: chunk.light.slice(),
    lightIndices: [...chunk.lightIndices], leafIndices: [...chunk.leafIndices],
    structureMarkers: structuredClone([...world.structureMarkers.entries()].filter(([, marker]) =>
      Math.floor(marker.position.x / CHUNK_SIZE) === cx && Math.floor(marker.position.z / CHUNK_SIZE) === cz)),
  });
  invariant(terrainGenerationChunksByteEqualV2(actual, expected) && actual.chunkHash === entry.expectedChunkHash,
    `${entry.id}: installed pre-seam payload differs from independent full-stream oracle`);
  const after = telemetry(world);
  const row: R3PerformanceRow = {
    id: entry.id, ordinal: entry.ordinal, profile, resetCount: 1,
    resetMilliseconds: resetEnd - resetStart, runtimeReadyMilliseconds: readyTime - resetEnd,
    initializedRuntimeAcceptedMilliseconds: acceptedTime - readyTime, resetToAcceptedMilliseconds: acceptedTime - resetStart,
    accepted: true, exactBytes: true, chunkHash: actual.chunkHash, streamBytes: r3WorkerStreams(actual).map(stream => stream.byteLength),
    expectedBytesHash: entry.expectedBytesHash, generationDelta: after.throughput.generation - before.throughput.generation,
    memoryCacheHitDelta: after.cache.memory.hits - before.cache.memory.hits,
    persistentCacheHitDelta: after.cache.persistentHits - before.cache.persistentHits,
    coldWorldChunks: before.residentChunks, coldMemoryCacheEntries: before.cache.memory.entries, telemetry: after,
  };
  invariant(row.generationDelta === 1 && row.memoryCacheHitDelta === 0 && row.persistentCacheHitDelta === 0,
    `${entry.id}: service sample used cache or extra generation`);
  return row;
}

const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
function frameSample(world: ChunkWorld, point: R3PerformancePoint, timestamp: number, previousTimestamp: number): R3PerformanceFrame {
  const start = performance.now();
  const work = world.update(point.x, point.z, point.y, point.velocityX, point.velocityZ);
  const end = performance.now();
  const diagnostic = world.streamingDiagnostics();
  const sample: R3PerformanceFrame = { point, updates: 1, rafTimestamp: timestamp, rafIntervalMilliseconds: timestamp - previousTimestamp,
    updateMilliseconds: end - start, observerMilliseconds: 0, work, telemetry: telemetry(world, diagnostic), readiness: readiness(world, diagnostic) };
  sample.observerMilliseconds = performance.now() - end;
  return sample;
}
function isReady(value: R3PerformanceReadiness) {
  try { assertR3PerformanceReadiness(value); return true; } catch { return false; }
}
async function streamingTrace(landscape: R3PerformanceLandscape, profile: R3PerformanceProfile) {
  phase(`Streaming ${landscape.id}: initial installed + drawable ring`);
  const { world, milliseconds } = newWorld();
  let pulseRequest: number | null = null;
  try {
    const x = landscape.chunk[0] * CHUNK_SIZE + 8; const z = landscape.chunk[1] * CHUNK_SIZE + 8;
    const startPoint = r3PerformanceStartPoint(landscape);
    // Continuously requested observer pulses distinguish asynchronous admission latency
    // from actual main-thread stalls; waiting to request the next frame would not.
    let previousTimestamp = await settleR3PerformanceStartupBaseline(nextFrame);
    const initialRafTimestamp = previousTimestamp;
    const startupRafPulses: R3PerformanceTrace["startupRafPulses"] = [];
    let pulsePrevious = initialRafTimestamp;
    const pulse = (timestamp: number) => {
      startupRafPulses.push({ timestamp, intervalMilliseconds: timestamp - pulsePrevious }); pulsePrevious = timestamp;
      pulseRequest = requestAnimationFrame(pulse);
    };
    pulseRequest = requestAnimationFrame(pulse);
    const resetStart = performance.now(); world.reset(landscape.seed);
    world.initializeAround(x, z);
    await runtimeReady(world, profile);
    await world.awaitGenerationRing(x, z, 1, 60_000);
    const installedTime = performance.now();
    const diagnostic = world.streamingDiagnostics();
    const trace: R3PerformanceTrace = {
      landscape, profile, resetCount: 1, constructionMilliseconds: milliseconds,
      resetToInstalledMilliseconds: installedTime - resetStart, resetToDrawableMilliseconds: 0,
      initialRafTimestamp, startupUpdateRafTimestamp: 0, startupRafPulses,
      initialReadiness: readiness(world, diagnostic), initialTelemetry: telemetry(world, diagnostic),
      startupFrames: [], frames: [], terminalReadiness: readiness(world, diagnostic), readinessFailures: 0,
    };
    state.traces.push(trace);
    // Begin update-frame intervals from an actually requested post-install baseline.
    // All earlier intervals, including synchronous TS stalls, remain in startupRafPulses.
    previousTimestamp = await nextFrame(); trace.startupUpdateRafTimestamp = previousTimestamp;
    const deadline = performance.now() + 120_000;
    while (true) {
      const timestamp = await nextFrame();
      const sample = frameSample(world, startPoint, timestamp, previousTimestamp); previousTimestamp = timestamp;
      trace.startupFrames.push(sample);
      if (isReady(sample.readiness)) {
        trace.initialReadiness = sample.readiness; trace.initialTelemetry = sample.telemetry;
        trace.resetToDrawableMilliseconds = performance.now() - resetStart; break;
      }
      invariant(performance.now() < deadline, `${landscape.id}: initial drawable ring timed out`);
    }
    if (pulseRequest !== null) { cancelAnimationFrame(pulseRequest); pulseRequest = null; }
    const points = r3PerformanceTracePoints(landscape);
    let clock = createR3PerformanceClock(previousTimestamp);
    const streamingDeadline = performance.now() + 120_000;
    while (true) {
      const timestamp = await nextFrame();
      const point = clock.simulationTick === 0 ? startPoint : points[clock.simulationTick - 1];
      const label = `Streaming ${landscape.id}: ${point.phase}`; if (state.phase !== label) phase(label);
      // Production schedules streaming BEFORE its fixed-step player loop. Even a
      // high-refresh callback with zero movement ticks still performs one update.
      const update = frameSample(world, point, timestamp, previousTimestamp); previousTimestamp = timestamp;
      const advanced = advanceR3PerformanceClock(clock, timestamp);
      const sample = { ...update, ...advanced.sample }; clock = advanced.clock;
      trace.frames.push(sample); trace.terminalReadiness = sample.readiness;
      if (!isReady(sample.readiness)) trace.readinessFailures += 1;
      if (sample.finalPositionUpdate) break;
      invariant(performance.now() < streamingDeadline, `${landscape.id}: production-clock streaming timed out`);
    }
    draw();
  } finally {
    if (pulseRequest !== null) cancelAnimationFrame(pulseRequest);
    disposeWorld(world);
  }
}

async function run() {
  state.status = "running"; runButton.disabled = true; phase("Loading independent oracle outside timing");
  try {
    const [manifest, config] = await Promise.all([
      json<R3WorkerManifest>("/__r3-production-worker/manifest.json"), json<R3PerformanceConfig>("/__r3-performance/config.json"),
    ]);
    invariant(config.schema === 2 && ["rust-primary", "typescript-rollback"].includes(config.profile), "Invalid benchmark config profile");
    invariant(manifest.schema === 1 && manifest.cases.length === 155 && config.landscapes.length === 5, "Incomplete corpus/landscape inputs");
    state.profile = config.profile; state.artifactHash = manifest.artifactHash; state.corpusHash = manifest.corpusHash;
    state.traceHash = r3PerformanceTraceHash(config.landscapes);
    // Retained oracle storage intentionally remains identical across profiles; heap metrics
    // include this fixture overhead and are not represented as whole-game memory usage.
    const expected = retainedExpected;
    for (const entry of manifest.cases) expected.set(entry.ordinal, await expectedChunk(entry));
    const { world, milliseconds } = newWorld(); state.constructionMilliseconds = milliseconds;
    try {
      phase("Retained equal-policy warmup: first corpus case");
      const first = manifest.cases[0]; state.warmup = await serviceCase(world, first, expected.get(first.ordinal)!, config.profile);
      for (const [index, entry] of manifest.cases.entries()) {
        if (index % 20 === 0) phase(`Exact accepted-service corpus: ${index + 1}–${Math.min(index + 20, manifest.cases.length)} / 155`);
        state.rows.push(await serviceCase(world, entry, expected.get(entry.ordinal)!, config.profile));
      }
    } finally { disposeWorld(world); }
    for (const landscape of config.landscapes) await streamingTrace(landscape, config.profile);
    state.status = "passed";
    assertR3GenerationPerformanceEvidence(state, { profile: config.profile, manifest, landscapes: config.landscapes });
    phase("Complete · exact service + streaming readiness verified");
  } catch (error) {
    state.status = "failed"; state.error = error instanceof Error ? error.message : String(error);
    phase(`Failed · ${state.error}`);
  } finally {
    for (const world of [...liveWorlds]) disposeWorld(world);
    // Diagnostics only: derive from retained samples after every timed operation.
    finishedSkillTraces = state.traces.map(r3PerformanceSkillTraceSummary);
    draw();
  }
}
const target = window as Window & {
  __r3Performance?: R3PerformanceState; startR3Performance?: () => Promise<void>;
  render_game_to_text?: () => string; advanceTime?: (milliseconds: number) => Promise<void>;
};
target.__r3Performance = state;
target.startR3Performance = () => running ??= run();
target.render_game_to_text = () => JSON.stringify({ schema: state.schema, status: state.status, phase: state.phase,
  profile: state.profile, artifactHash: state.artifactHash, corpusHash: state.corpusHash,
  policy: state.policy, traceHash: state.traceHash,
  completedCases: state.rows.length, warmup: Boolean(state.warmup),
  traces: finishedSkillTraces ?? state.traces.map(trace => ({ id: trace.landscape.id, frames: trace.frames.length,
    movementTicks: trace.frames.at(-1)?.simulationTickAfter ?? 0, finalPositionUpdate: trace.frames.at(-1)?.finalPositionUpdate ?? false,
    readinessFailures: trace.readinessFailures })),
  coordinates: "x/z world blocks; y vertical; 420 fixed movement ticks accumulated from real rAF time; updates precede physics",
  timingScope: R3_PERFORMANCE_POLICY_V2.classification, error: state.error, cleanup: state.cleanup });
// Only the separate skill correctness client uses this hook. Hardware-timed runs do not
// inject the client's virtual timers or call advanceTime. This hook never simulates updates.
target.advanceTime = async () => { if (running) await running; draw(); };
runButton.addEventListener("click", () => { void target.startR3Performance!(); });
document.addEventListener("keydown", event => {
  if (event.key.toLowerCase() === "f") {
    if (document.fullscreenElement) void document.exitFullscreen(); else void canvas.requestFullscreen();
  }
});
draw();
