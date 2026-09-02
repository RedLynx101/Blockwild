import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  closeR3PerformanceResources, compareR3PerformanceRuns, compareR3StreamingRuns,
  parseR3PerformanceOptions, projectR3PerformanceRun, r3PerformanceBuildDefinition, r3PerformanceCacheControl, r3PerformanceSchedule,
} from "../scripts/benchmark-r3-generation-browser.mjs";
import {
  advanceR3PerformanceClock, createR3PerformanceClock, r3PerformanceStartPoint, r3PerformanceTracePoints,
} from "./fixtures/r3-generation-performance-contract.ts";

function validRuns(pairs = 1) {
  return r3PerformanceSchedule(pairs).map(lane => ({ ...lane, accepted: true, state: { status: "passed",
    rows: Array.from({ length: 155 }, (_, index) => ({ ordinal: index + 1,
      initializedRuntimeAcceptedMilliseconds: lane.profile === "rust-primary" ? 8 : 10,
      resetToAcceptedMilliseconds: lane.profile === "rust-primary" ? 15 : 12,
    })),
  } }));
}

test("the browser fixture settles its startup pulse baseline before measured reset", () => {
  const source = readFileSync(new URL("./fixtures/r3-generation-performance.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function streamingTrace(");
  const end = source.indexOf("async function run()", start);
  assert(start >= 0 && end > start);
  const trace = source.slice(start, end);
  const settled = trace.indexOf("await settleR3PerformanceStartupBaseline(nextFrame)");
  const observer = trace.indexOf("pulseRequest = requestAnimationFrame(pulse)");
  const reset = trace.indexOf("const resetStart = performance.now(); world.reset(");
  assert(settled >= 0 && observer > settled && reset > observer,
    "settling must precede the continuous observer and every measured reset operation");
});

test("R3 performance preserves balanced complete pairs and labels short runs diagnostic", () => {
  assert.deepEqual(r3PerformanceSchedule(1).map(lane => lane.profile), ["typescript-rollback", "rust-primary"]);
  const schedule = r3PerformanceSchedule(5);
  assert.equal(schedule.length, 10);
  assert.equal(schedule.filter(lane => lane.profile === "rust-primary").length, 5);
  assert.deepEqual(schedule.slice(2, 4).map(lane => lane.profile), ["rust-primary", "typescript-rollback"]);
  for (const invalid of [0, 2, 4, 6, NaN, 1.2, "5"]) assert.throws(() => r3PerformanceSchedule(invalid));
});

test("both production bundles use the real selector without inherited overrides", () => {
  for (const profile of ["rust-primary", "typescript-rollback"]) {
    const definition = r3PerformanceBuildDefinition(profile);
    assert.deepEqual(JSON.parse(definition.process), { env: {
      NODE_ENV: "production", NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE: profile,
    } });
    assert.equal(definition["process.env.NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE"], JSON.stringify(profile));
    assert.equal(definition["process.env.NODE_TEST_CONTEXT"], "undefined");
  }
  assert.throws(() => r3PerformanceBuildDefinition("typescript"));
});

test("actual Vite production compilation preserves both default backend selectors", async () => {
  const { build } = await import("vite");
  const root = path.resolve(import.meta.dirname, "..");
  for (const profile of ["rust-primary", "typescript-rollback"]) {
    const result = await build({ configFile: false, root, publicDir: false, envDir: false, logLevel: "silent",
      define: r3PerformanceBuildDefinition(profile),
      plugins: [{ name: "r3-profile-compilation-test",
        resolveId(id) { if (id === "r3-profile-probe") return "\0r3-profile-probe"; },
        load(id) { if (id === "\0r3-profile-probe") return `import { configuredTerrainGenerationAuthorityV2 } from ${JSON.stringify(path.join(root, "app/game/terrain-generation-authority.ts").replaceAll(path.sep, "/"))}; export default configuredTerrainGenerationAuthorityV2();`; },
      }],
      build: { write: false, minify: true, rollupOptions: { input: "r3-profile-probe", preserveEntrySignatures: "strict" } },
    });
    const chunk = result.output.find(item => item.type === "chunk" && item.isEntry);
    assert(chunk, "compiled selector entry missing");
    const loaded = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`);
    assert.deepEqual(loaded.default, { mode: profile === "rust-primary" ? "rust" : "typescript",
      source: `build-${profile}`, rollbackRequiresWorldReload: true });
  }
});

test("CLI does not coerce fractional/junk pair counts into acceptance candidates", () => {
  const argv = ["node", "script"];
  assert.equal(parseR3PerformanceOptions(argv).pairs, 5);
  assert.equal(parseR3PerformanceOptions([...argv, "--pairs", "1"]).pairs, 1);
  for (const value of ["5.9", "5junk", "01", "2", "0", "NaN"]) {
    assert.throws(() => parseR3PerformanceOptions([...argv, "--pairs", value]));
  }
  assert.throws(() => parseR3PerformanceOptions([...argv, "--pairs", "1", "--pairs", "5"]));
});

test("content-addressed artifacts retain real warm HTTP cache behavior inside fresh browser lanes", () => {
  const hash = "a".repeat(64);
  for (const url of [`/engine/${hash}/engine_bg.wasm`, `/engine/${hash}/manifest.json`, "/assets/terrain-generation-worker-abcdefgh.js"]) {
    assert.equal(r3PerformanceCacheControl(url), "public, max-age=31536000, immutable");
  }
  for (const url of ["/engine/manifest.json", "/__r3-performance/config.json", "/__r3-production-worker/expected/1.bin", "/tests/fixtures/r3-generation-performance.html"]) {
    assert.equal(r3PerformanceCacheControl(url), "no-store");
  }
});

test("cleanup retains errors, continues closing owned resources, and distinguishes absent resources", async () => {
  const absent = await closeR3PerformanceResources({});
  assert.equal(absent.passed, true);
  assert.deepEqual(absent.browser, { created: false, closeAttempted: false, closed: null, error: null });
  let connected = true;
  const result = await closeR3PerformanceResources({
    context: { close: async () => { throw new Error("context close failed"); } },
    browser: { close: async () => { connected = false; }, isConnected: () => connected },
    server: { listening: false },
  });
  assert.equal(result.context.error, "context close failed");
  assert.equal(result.browser.closed, true);
  assert.equal(result.server.closed, true);
  assert.equal(result.passed, false);
});

test("comparison retains a reset-cost regression even if initialized generation improves", () => {
  const comparison = compareR3PerformanceRuns(validRuns(5));
  assert.equal(comparison.initializedRuntimeAcceptedMilliseconds.rustOverTypescript, 0.8);
  assert.equal(comparison.initializedRuntimeAcceptedMilliseconds.noMoreThanFivePercentRegression, true);
  assert.equal(comparison.resetToAcceptedMilliseconds.rustOverTypescript, 1.25);
  assert.equal(comparison.resetToAcceptedMilliseconds.noMoreThanFivePercentRegression, false);
  assert.equal(comparison.resetToAcceptedMilliseconds.runP95s["rust-primary"].length, 5);
  assert.equal(comparison.resetToAcceptedMilliseconds.strata["named-terrain-and-poi"].caseCount, 67);
  assert.equal(comparison.resetToAcceptedMilliseconds.strata["generic-coordinate-sweep"].caseCount, 64);
  assert.equal(comparison.resetToAcceptedMilliseconds.strata["normalized-option-extension"].caseCount, 24);
});

test("comparison rejects omitted runs/cases, reordered lanes, and non-finite timings", () => {
  assert.throws(() => compareR3PerformanceRuns(validRuns().slice(0, 1)));
  assert.throws(() => compareR3PerformanceRuns(validRuns().reverse()));
  for (const invalid of [0, -1, NaN, Infinity, "10"]) {
    const runs = validRuns(); runs[0].state.rows[3].resetToAcceptedMilliseconds = invalid;
    assert.throws(() => compareR3PerformanceRuns(runs));
  }
  const omitted = validRuns(); omitted[0].state.rows.pop();
  assert.throws(() => compareR3PerformanceRuns(omitted));
  const duplicate = validRuns(); duplicate[0].state.rows[1].ordinal = 1;
  assert.throws(() => compareR3PerformanceRuns(duplicate));
  const rejected = validRuns(); rejected[0].accepted = false;
  assert.throws(() => compareR3PerformanceRuns(rejected), /rejected diagnostic lanes/u);
  assert.throws(() => compareR3StreamingRuns(rejected), /rejected diagnostic lanes/u);
});

test("measured browser lane does not inject virtual time or force software graphics", () => {
  const source = readFileSync(new URL("../scripts/benchmark-r3-generation-browser.mjs", import.meta.url), "utf8");
  const measured = source.slice(source.indexOf("async function runLane("), source.indexOf("/** Median of run p95s"));
  assert.doesNotMatch(measured, /addInitScript|use-angle=swiftshader|advanceTime\(/u);
  assert.match(measured, /freshBrowserProcess: true/u);
  assert.match(measured, /virtualTimeInjected: false/u);
  assert.match(source, /performanceAcceptance: false/u);
});

function validStreamingRuns() {
  const landscapes = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/r3/landscape-corpus.json", import.meta.url), "utf8")).cases;
  const runs = validRuns();
  for (const run of runs) run.state.traces = landscapes.map(landscape => {
    const frames = []; const points = r3PerformanceTracePoints(landscape);
    let clock = createR3PerformanceClock(1000);
    // Different refresh rates change callback counts, never path speed/tick count.
    const interval = 1000 / (run.profile === "rust-primary" ? 240 : 120);
    while (true) {
      const timestamp = clock.previousTimestamp + interval;
      const point = clock.simulationTick === 0 ? r3PerformanceStartPoint(landscape) : points[clock.simulationTick - 1];
      const next = advanceR3PerformanceClock(clock, timestamp);
      frames.push({ point, updates: 1, rafTimestamp: timestamp, rafIntervalMilliseconds: interval,
        ...next.sample, updateMilliseconds: run.profile === "rust-primary" ? 12 : 10 });
      clock = next.clock;
      if (next.sample.finalPositionUpdate) break;
    }
    return { landscape, readinessFailures: 0, resetToInstalledMilliseconds: 100, resetToDrawableMilliseconds: 200,
      startupFrames: [{ rafTimestamp: 1000 }], frames };
  });
  return runs;
}

test("streaming scenario floors cannot hide behind corpus gains or dropped frames", () => {
  const runs = validStreamingRuns();
  const landscapes = runs[0].state.traces.map(trace => trace.landscape);
  assert.notEqual(runs[0].state.traces[0].frames.length, runs[1].state.traces[0].frames.length);
  const result = compareR3StreamingRuns(runs);
  assert.equal(result[landscapes[0].id].worldUpdateMilliseconds.noMoreThanFivePercentRegression, false);
  assert.equal(result[landscapes[0].id].rafIntervalMilliseconds.noMoreThanFivePercentRegression, true);
  runs[1].state.traces[0].readinessFailures = 1;
  assert.throws(() => compareR3StreamingRuns(runs));
  runs[1].state.traces[0].readinessFailures = 0;
  const missingCallback = structuredClone(runs);
  missingCallback[1].state.traces[0].frames.splice(100, 1);
  assert.throws(() => compareR3StreamingRuns(missingCallback));
  const forgedClock = structuredClone(runs);
  forgedClock[1].state.traces[0].frames[100].simulationTickAfter += 1;
  assert.throws(() => compareR3StreamingRuns(forgedClock));
  runs[1].state.traces[0].frames.pop();
  assert.throws(() => compareR3StreamingRuns(runs));
});

test("post-validation projection detaches verbose evidence while preserving exact comparison inputs", () => {
  const raw = validStreamingRuns();
  for (const run of raw) {
    Object.assign(run, { directory: `/synthetic/${run.profile}`, hardware: { graphics: { renderer: "synthetic-test-only" } },
      resources: [{ name: "synthetic-resource" }], navigation: [], deliveryBytes: { total: 100 } });
    Object.assign(run.state, { schema: 2, traceHash: "a".repeat(32), warmup: {}, constructionMilliseconds: 1 });
    const telemetry = { throughput: { generation: 10, lighting: 10, meshing: 10 },
      cache: { memory: { hits: 0 }, persistentHits: 0 }, heap: { available: false },
      residentChunks: 9, residentPayloadBytes: 200, generationQueued: 0, lightingQueued: 0, meshSectionsQueued: 0 };
    for (const trace of run.state.traces) {
      trace.initialTelemetry = structuredClone(telemetry);
      trace.startupRafPulses = [{ intervalMilliseconds: 10 }];
      for (const frame of trace.frames) Object.assign(frame, { observerMilliseconds: 0.1,
        telemetry: structuredClone(telemetry), readiness: { verboseSyntheticChunkData: [1, 2, 3] }, work: { synthetic: true } });
    }
  }
  const expectedService = compareR3PerformanceRuns(raw);
  const expectedStreaming = compareR3StreamingRuns(raw);
  const projected = raw.map(projectR3PerformanceRun);
  assert.deepEqual(compareR3PerformanceRuns(projected), expectedService);
  assert.deepEqual(compareR3StreamingRuns(projected), expectedStreaming);
  for (const run of projected) {
    assert.equal(run.resources, undefined);
    assert.equal(run.state.traces[0].initialTelemetry, undefined);
    for (const frame of run.state.traces[0].frames) {
      assert.equal(frame.telemetry, undefined); assert.equal(frame.readiness, undefined); assert.equal(frame.work, undefined);
    }
    assert.equal(run.compactSummary.fullEvidence, path.join(run.directory, "evidence.json"));
    assert.equal(run.compactSummary.traces[0].movementTicks, 420);
  }
  assert.notEqual(projected[0].state.traces[0].frames[0].point, raw[0].state.traces[0].frames[0].point);
  raw[0].state.traces[0].frames[0].point.x += 99;
  raw[0].hardware.graphics.renderer = "mutated";
  raw[0].state.rows[0].resetToAcceptedMilliseconds = 999;
  assert.deepEqual(compareR3PerformanceRuns(projected), expectedService);
  assert.deepEqual(compareR3StreamingRuns(projected), expectedStreaming);
  assert.equal(projected[0].hardware.graphics.renderer, "synthetic-test-only");
  assert.equal(projected[0].compactSummary.hardware.graphics.renderer, "synthetic-test-only");

  const missing = structuredClone(projected); missing[0].state.traces[0].frames.splice(20, 1);
  assert.throws(() => compareR3StreamingRuns(missing));
  const forged = structuredClone(projected); forged[0].state.traces[0].frames[20].physicsSteps += 1;
  assert.throws(() => compareR3StreamingRuns(forged));
  const unready = structuredClone(projected); unready[0].state.traces[0].readinessFailures = 1;
  assert.throws(() => compareR3StreamingRuns(unready));
  const rejected = projectR3PerformanceRun({ ...raw[1], accepted: false, rejection: "synthetic readiness rejection" });
  assert.equal(rejected.compactSummary.accepted, false);
  assert.throws(() => compareR3PerformanceRuns([projected[0], rejected]), /rejected diagnostic lanes/);
  assert.throws(() => compareR3StreamingRuns([projected[0], rejected]), /rejected diagnostic lanes/);
});
