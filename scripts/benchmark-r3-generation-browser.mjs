import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveWorldgenBuildProfile } from "../build/worldgen-build-profile.ts";
import {
  createRustEngineSourceSnapshot, isDirectInvocation, parseCommandLine, sha256,
  summarizeSamples, validatePublishedArtifacts,
} from "./rust-engine-common.mjs";
import { acquireManagedBrowserGateMutex } from "./verify-rust-r5-player-browser.mjs";
import {
  buildR3ProductionWorkerCorpus, resolveR3ProductionWorkerOutput, r3ProductionWorkerAsset,
  runR3WorkerSkillClient, selectR3ProductionWorkerArtifact,
} from "./verify-rust-generation-production-worker.mjs";
import {
  assertR3GenerationPerformanceEvidence, assertR3GenerationPerformanceSkillSummary,
  assertR3PerformanceStreamingClock,
} from "../tests/fixtures/r3-generation-performance-contract.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = "tests/fixtures/r3-generation-performance.html";
const PROFILES = ["typescript-rollback", "rust-primary"];
const OPTIONS = {
  "public-dir": { type: "string", default: "public/engine" },
  "expected-artifact-hash": { type: "string", default: null },
  output: { type: "string", default: "work/hybrid-rust-migration/r3-generation-performance" },
  pairs: { type: "integer", default: 5 },
  "skill-review": { type: "boolean", default: false },
};
const MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json"],
  [".wasm", "application/wasm"], [".png", "image/png"],
]);
const OWN_FILES = [
  "scripts/benchmark-r3-generation-browser.mjs", "scripts/verify-rust-generation-production-worker.mjs",
  "scripts/lib/rust-worldgen-promotion-corpus.ts", ENTRY,
  "tests/fixtures/r3-generation-performance.ts", "tests/fixtures/r3-generation-performance-contract.ts",
  "tests/fixtures/r3-production-worker-contract.ts", "tests/fixtures/rust-engine/r3/landscape-corpus.json",
  "tests/fixtures/rust-engine/r3/promotion-corpus.json", "tests/fixtures/rust-engine/r3/promotion-options-extension.json",
  "package.json", "package-lock.json",
];

/** Balanced ordering is frozen before either lane is observed. One pair is diagnostic only. */
export function r3PerformanceSchedule(pairs) {
  assert(pairs === 1 || pairs === 5, "--pairs must be exactly 1 (diagnostic) or 5 (acceptance candidate)");
  return Array.from({ length: pairs }, (_, pair) => (pair % 2 ? [...PROFILES].reverse() : PROFILES)
    .map((profile, order) => ({ pair, order, profile }))).flat();
}

export function parseR3PerformanceOptions(argv = process.argv) {
  const pairFlags = argv.slice(2).filter(value => value === "--pairs");
  assert(pairFlags.length <= 1, "--pairs may only be provided once");
  if (pairFlags.length) assert(["1", "5"].includes(argv[argv.indexOf("--pairs", 2) + 1]), "--pairs requires exactly the token 1 or 5");
  const options = parseCommandLine(argv, OPTIONS);
  r3PerformanceSchedule(options.pairs);
  return options;
}

/** No inherited test/experimental selector can enter either compiled default lane. */
export function r3PerformanceBuildDefinition(profile) {
  const resolved = resolveWorldgenBuildProfile(profile);
  const env = {
    NODE_ENV: "production", NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE: resolved,
  };
  // Vite supplies its own process.env={} replacement. Defining only `process`
  // loses to that more-specific prefix, silently erasing the build selector.
  return { process: JSON.stringify({ env }), "process.env": JSON.stringify(env),
    "process.env.NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE": JSON.stringify(resolved),
    "process.env.NODE_TEST_CONTEXT": "undefined" };
}

function filesBelow(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    assert(!entry.isSymbolicLink(), `source/build symlink rejected: ${entry.name}`);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function browserSourceSnapshot() {
  const files = [...filesBelow(path.join(ROOT, "app")), ...filesBelow(path.join(ROOT, "build")),
    ...OWN_FILES.filter(file => existsSync(path.join(ROOT, file))).map(file => path.join(ROOT, file))];
  const rows = [...new Set(files)].sort().map(file => {
    assert(!lstatSync(file).isSymbolicLink(), `source symlink rejected: ${file}`);
    return [path.relative(ROOT, file).replaceAll(path.sep, "/"), sha256(readFileSync(file))];
  });
  return { schema: 1, fileCount: rows.length, digest: sha256(Buffer.from(JSON.stringify(rows))), files: rows };
}

export async function buildR3PerformanceProfile(profile, directory) {
  const { build } = await import("vite");
  const inherited = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) {
      if (/^(?:NEXT_PUBLIC_BLOCKWILD_|BLOCKWILD_RUST_|BLOCKWILD_WORLDGEN_|NODE_TEST_CONTEXT$)/u.test(key)) delete process.env[key];
    }
    process.env.BLOCKWILD_WORLDGEN_BUILD_PROFILE = profile;
    const selected = resolveWorldgenBuildProfile();
    assert.equal(selected, profile);
    const envDir = path.join(directory, "empty-env");
    await mkdir(envDir, { recursive: true });
    await build({
      configFile: false, root: ROOT, publicDir: false, envDir, logLevel: "warn",
      resolve: { alias: { "@": ROOT } }, define: r3PerformanceBuildDefinition(selected),
      build: { outDir: path.join(directory, "dist"), emptyOutDir: false, target: "es2022", minify: true,
        rollupOptions: { input: path.join(ROOT, ENTRY) } },
      worker: { format: "es" },
    });
    const assets = new Map(filesBelow(path.join(directory, "dist")).map(file => [
      `/${path.relative(path.join(directory, "dist"), file).replaceAll(path.sep, "/")}`,
      { bytes: readFileSync(file), type: MIME.get(path.extname(file)) ?? "application/octet-stream" },
    ]));
    assert(assets.has(`/${ENTRY}`), "production fixture HTML was not built");
    return { profile, assets, files: [...assets].map(([url, asset]) => ({ url, bytes: asset.bytes.length, sha256: sha256(asset.bytes) })) };
  } finally {
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(inherited, key)) delete process.env[key];
    for (const [key, value] of Object.entries(inherited)) process.env[key] = value;
    assert.deepEqual({ ...process.env }, inherited, "profile build did not restore inherited environment");
  }
}

async function staticServer(assets, requests) {
  const server = createServer((request, response) => {
    const rawUrl = request.url ?? "/";
    const asset = request.method === "GET" ? r3ProductionWorkerAsset(rawUrl, assets) : null;
    requests.push({ url: rawUrl, status: asset ? 200 : 404, bytes: asset?.bytes.length ?? 0 });
    response.writeHead(asset ? 200 : 404, {
      "Content-Type": asset?.type ?? "text/plain", "Cache-Control": r3PerformanceCacheControl(rawUrl),
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin", "Content-Length": asset?.bytes.length ?? 0,
    });
    response.end(asset?.bytes);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/${ENTRY}` };
}

export function r3PerformanceCacheControl(rawUrl) {
  const pathname = rawUrl.split("?")[0];
  // Match the existing artifact-serving contract. A fresh browser is cold;
  // repeated worker resets retain normal content-addressed HTTP cache reuse.
  return /^\/engine\/[0-9a-f]{64}\//u.test(pathname) || /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/u.test(pathname)
    ? "public, max-age=31536000, immutable" : "no-store";
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

/** Continue cleanup after an individual close fails; never lose the failure evidence. */
export async function closeR3PerformanceResources({ context, browser, server }) {
  const result = {};
  for (const [name, resource, close, isClosed] of [
    ["context", context, () => context.close(), () => true],
    ["browser", browser, () => browser.close(), () => !browser.isConnected()],
    ["server", server, () => closeServer(server), () => !server.listening],
  ]) {
    const row = { created: Boolean(resource), closeAttempted: false, closed: null, error: null };
    result[name] = row;
    if (!resource) continue;
    row.closeAttempted = true;
    try { await close(); row.closed = isClosed(); }
    catch (error) { row.closed = false; row.error = error instanceof Error ? error.message : String(error); }
  }
  result.passed = Object.values(result).every(row => !row.created || row.closed === true);
  return result;
}

async function localPlaywright() {
  const location = path.join(os.homedir(), ".codex/skills/develop-web-game/scripts/node_modules/playwright/index.mjs");
  assert(existsSync(location), "installed local Playwright is required; no package/browser download is performed");
  return { module: await import(pathToFileURL(location).href), source: location };
}

function localBrowser() {
  const candidates = process.platform === "win32" ? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return candidates.find(file => existsSync(file));
}

function laneAssets(build, selection, corpus, landscapes) {
  return new Map([...build.assets, ...selection.assets, ...corpus.expectedBytes,
    ["/__r3-production-worker/manifest.json", { bytes: Buffer.from(JSON.stringify(corpus.manifest)), type: "application/json" }],
    ["/__r3-performance/config.json", { bytes: Buffer.from(JSON.stringify({ schema: 2, profile: build.profile, landscapes })), type: "application/json" }],
  ]);
}

async function runLane(lane, build, selection, corpus, landscapes, output, playwright) {
  const directory = path.join(output, `pair-${lane.pair + 1}-${lane.order + 1}-${lane.profile}`);
  await mkdir(directory, { recursive: true });
  const requests = []; const errors = []; const workerUrls = [];
  const hosted = await staticServer(laneAssets(build, selection, corpus, landscapes), requests);
  const args = ["--disable-dev-shm-usage", "--enable-precise-memory-info",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];
  let browser; let context; let page; let state; let hardware; let navigation; let resources; let failure = null;
  let cleanup = null;
  const result = () => ({ ...lane, state, hardware, navigation, resources, directory,
    deliveryBytes: { total: requests.reduce((sum, request) => sum + request.bytes, 0),
      engine: requests.filter(request => request.url.startsWith("/engine/")).reduce((sum, request) => sum + request.bytes, 0),
      independentOracle: requests.filter(request => request.url.startsWith("/__r3-production-worker/"))
        .reduce((sum, request) => sum + request.bytes, 0) } });
  try {
    browser = await playwright.module.chromium.launch({ headless: true, executablePath: localBrowser(), args });
    context = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    page = await context.newPage();
    page.on("console", message => {
      if (message.type() === "error") errors.push({ kind: "console", message: message.text() });
      if (message.type() === "info") process.stdout.write(`[${lane.profile}] ${message.text()}\n`);
    });
    page.on("pageerror", error => errors.push({ kind: "page", message: error.message }));
    page.on("requestfailed", request => errors.push({ kind: "request", url: request.url(), message: request.failure()?.errorText }));
    page.on("worker", worker => workerUrls.push(worker.url()));
    const cdp = await browser.newBrowserCDPSession();
    const system = await cdp.send("SystemInfo.getInfo");
    await cdp.detach();
    await page.goto(hosted.url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => typeof window.startR3Performance === "function", undefined, { timeout: 60_000 });
    const graphics = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); const gl = canvas.getContext("webgl2");
      if (!gl) return { available: false, renderer: null, vendor: null };
      const extension = gl.getExtension("WEBGL_debug_renderer_info");
      const result = { available: true,
        renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) };
      gl.getExtension("WEBGL_lose_context")?.loseContext(); return result;
    });
    const capabilities = await page.evaluate(() => ({ hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory ?? null, crossOriginIsolated,
      userAgent: navigator.userAgent }));
    hardware = { browserVersion: browser.version(), executable: localBrowser() ?? "playwright-managed",
      playwrightSource: playwright.source, launchArgs: args, gpu: system.gpu, graphics,
      capabilities,
      freshBrowserProcess: true, freshStorageContext: true, virtualTimeInjected: false, viewport: { width: 1100, height: 700, dpr: 1 } };
    assert(graphics.available && !/swiftshader|llvmpipe|software|basic render/iu.test(graphics.renderer),
      `representative browser benchmark requires accelerated graphics; observed ${graphics.renderer}`);
    await page.evaluate(() => { void window.startR3Performance(); });
    await page.waitForFunction(() => ["passed", "failed"].includes(window.__r3Performance?.status), undefined,
      { timeout: 900_000, polling: 1000 });
    state = await page.evaluate(() => window.__r3Performance);
    navigation = await page.evaluate(() => performance.getEntriesByType("navigation").map(entry => entry.toJSON()));
    resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.toJSON()));
    await page.screenshot({ path: path.join(directory, "screen.png"), fullPage: true });
    assertR3GenerationPerformanceEvidence(state, { profile: lane.profile, manifest: corpus.manifest, landscapes });
    assert.deepEqual(errors, [], "browser error streams are not empty");
    assert(!requests.some(request => request.status !== 200), "static requests escaped the immutable allowlist");
    const engineRequests = requests.filter(request => request.url.startsWith("/engine/"));
    if (lane.profile === "typescript-rollback") assert.equal(engineRequests.length, 0, "rollback lane loaded Rust engine assets");
    else {
      assert(engineRequests.some(request => request.url === `/engine/${selection.artifact.hash}/engine_bg.wasm`), "Rust lane did not use pinned production Wasm");
      assert(workerUrls.some(url => /terrain-generation-worker/u.test(url)), "Rust lane did not use real built generation workers");
    }
    return projectR3PerformanceRun({ ...result(), accepted: true });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    if (page && !page.isClosed()) {
      state ??= await page.evaluate(() => window.__r3Performance).catch(() => null);
      await page.screenshot({ path: path.join(directory, "failed-screen.png"), fullPage: true }).catch(() => {});
    }
    if (error instanceof Error && state && hardware && resources && navigation) {
      error.r3RejectedLane = projectR3PerformanceRun({ ...result(), accepted: false, rejection: failure });
    }
    throw error;
  } finally {
    cleanup = await closeR3PerformanceResources({ context, browser, server: hosted.server });
    // The full callback graph is intentionally compact JSON; summary.json remains
    // readable. Formatting hundreds of MB of repeated readiness data adds no proof.
    await writeFile(path.join(directory, "evidence.json"), `${JSON.stringify({ ...lane, state, hardware, navigation, resources, workerUrls, requests, errors, failure, cleanup })}\n`);
    assert(cleanup.passed, "owned browser/server did not close; retained evidence identifies the failed close");
    assert.deepEqual(errors, [], "browser error streams are not empty after owned cleanup");
  }
}

/** Median of run p95s; never manufacture a per-case p95 from five observations. */
export function compareR3PerformanceRuns(runs) {
  assert(Array.isArray(runs) && (runs.length === 2 || runs.length === 10), "comparison requires exactly one or five complete pairs");
  assert(runs.every(run => run.accepted === true && run.state.status === "passed"), "rejected diagnostic lanes are not performance samples");
  const schedule = r3PerformanceSchedule(runs.length / 2);
  assert.deepEqual(runs.map(({ pair, order, profile }) => ({ pair, order, profile })), schedule, "run order/profile differs from frozen balanced schedule");
  for (const run of runs) assert.deepEqual(run.state.rows.map(row => row.ordinal),
    Array.from({ length: 155 }, (_, index) => index + 1), "measured corpus ordinals are missing, duplicated or reordered");
  const metrics = ["initializedRuntimeAcceptedMilliseconds", "resetToAcceptedMilliseconds"];
  const result = {};
  const strata = [
    { id: "complete-corpus", first: 1, last: 155 },
    { id: "named-terrain-and-poi", first: 1, last: 67 },
    { id: "generic-coordinate-sweep", first: 68, last: 131 },
    { id: "normalized-option-extension", first: 132, last: 155 },
  ];
  const median = values => {
    assert(values.length > 0 && values.every(value => Number.isFinite(value) && value > 0), "invalid comparison timing");
    const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)];
  };
  for (const metric of metrics) {
    const byStratum = {};
    for (const stratum of strata) {
      const byProfile = Object.fromEntries(PROFILES.map(profile => [profile, runs.filter(run => run.profile === profile)
        .map(run => {
          const values = run.state.rows.filter(row => row.ordinal >= stratum.first && row.ordinal <= stratum.last).map(row => row[metric]);
          assert.equal(values.length, stratum.last - stratum.first + 1, "comparison may not omit measured cases");
          assert(values.every(value => Number.isFinite(value) && value > 0), "invalid comparison timing");
          return summarizeSamples(values).p95Milliseconds;
        })]));
      const typescript = median(byProfile["typescript-rollback"]); const rust = median(byProfile["rust-primary"]);
      byStratum[stratum.id] = { caseCount: stratum.last - stratum.first + 1,
        runP95s: byProfile, typescriptMedianP95: typescript, rustMedianP95: rust,
        rustOverTypescript: rust / typescript, noMoreThanFivePercentRegression: rust <= typescript * 1.05 };
    }
    result[metric] = { ...byStratum["complete-corpus"], strata: byStratum };
  }
  return result;
}

export function compareR3StreamingRuns(runs) {
  assert(runs.every(run => run.accepted === true && run.state.status === "passed"), "rejected diagnostic lanes are not performance samples");
  assert.deepEqual(runs.map(({ pair, order, profile }) => ({ pair, order, profile })), r3PerformanceSchedule(runs.length / 2));
  const landscapes = JSON.parse(readFileSync(path.join(ROOT, "tests/fixtures/rust-engine/r3/landscape-corpus.json"), "utf8")).cases;
  const metrics = {
    resetToInstalledMilliseconds: { statistic: "one initial readiness latency per run", sample: trace => trace.resetToInstalledMilliseconds },
    resetToDrawableMilliseconds: { statistic: "one initial readiness latency per run", sample: trace => trace.resetToDrawableMilliseconds },
    worldUpdateMilliseconds: { statistic: "p95 across every real-rAF world update for 420 production-paced movement ticks", sample: trace => summarizeSamples(trace.frames.map(frame => frame.updateMilliseconds)).p95Milliseconds },
    rafIntervalMilliseconds: { statistic: "p95 across every real-rAF interval for 420 production-paced movement ticks", sample: trace => summarizeSamples(trace.frames.map(frame => frame.rafIntervalMilliseconds)).p95Milliseconds },
  };
  for (const run of runs) {
    assert.deepEqual(run.state.traces.map(trace => trace.landscape.id), landscapes.map(entry => entry.id), "streaming comparison omitted/reordered landscapes");
    for (const trace of run.state.traces) {
      assertR3PerformanceStreamingClock(trace);
      assert.equal(trace.readinessFailures, 0, "readiness loss vetoes performance comparison");
      for (const frame of trace.frames) {
        assert(Number.isFinite(frame.updateMilliseconds) && frame.updateMilliseconds >= 0, "invalid update timing");
        assert(Number.isFinite(frame.rafIntervalMilliseconds) && frame.rafIntervalMilliseconds > 0, "invalid rAF timing");
      }
    }
  }
  return Object.fromEntries(landscapes.map((landscape, index) => [landscape.id,
    Object.fromEntries(Object.entries(metrics).map(([name, metric]) => {
      const runSamples = Object.fromEntries(PROFILES.map(profile => [profile, runs.filter(run => run.profile === profile)
        .map(run => metric.sample(run.state.traces[index]))]));
      for (const values of Object.values(runSamples)) assert(values.every(value => Number.isFinite(value) && value > 0), "invalid streaming comparison timing");
      const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const typescript = median(runSamples["typescript-rollback"]); const rust = median(runSamples["rust-primary"]);
      return [name, { statistic: metric.statistic, runSamples, typescriptMedian: typescript, rustMedian: rust,
        rustOverTypescript: rust / typescript, noMoreThanFivePercentRegression: rust <= typescript * 1.05 }];
    }))]));
}

function compactRunEvidence(run) {
  return { pair: run.pair, order: run.order, profile: run.profile, directory: run.directory,
    accepted: run.accepted, rejection: run.rejection ?? null,
    fullEvidence: path.join(run.directory, "evidence.json"), hardware: run.hardware,
    navigation: run.navigation, pageResourceEntries: run.resources.length, deliveryBytes: run.deliveryBytes, traceHash: run.state.traceHash,
    corpus: { cases: run.state.rows.length, warmupCases: run.state.warmup ? 1 : 0,
      constructionMilliseconds: run.state.constructionMilliseconds },
    traces: run.state.traces.map(trace => {
      if (trace.frames.length === 0) return { id: trace.landscape.id, frames: 0, readinessFailures: trace.readinessFailures };
      const start = trace.initialTelemetry; const end = trace.frames.at(-1).telemetry;
      const snapshots = [start, ...trace.frames.map(frame => frame.telemetry)];
      const heaps = snapshots.filter(value => value.heap.available).map(value => value.heap.usedBytes);
      return { id: trace.landscape.id, frames: trace.frames.length, readinessFailures: trace.readinessFailures,
        movementTicks: trace.frames.at(-1).simulationTickAfter,
        finalPositionUpdate: trace.frames.at(-1).finalPositionUpdate,
        simulationSeconds: trace.frames.at(-1).simulationTimeSecondsAfter,
        elapsedTraceMilliseconds: trace.frames.at(-1).rafTimestamp - trace.startupFrames.at(-1).rafTimestamp,
        resetToInstalledMilliseconds: trace.resetToInstalledMilliseconds,
        resetToDrawableMilliseconds: trace.resetToDrawableMilliseconds,
        startupRaf: trace.startupRafPulses.length ? summarizeSamples(trace.startupRafPulses.map(pulse => pulse.intervalMilliseconds)) : null,
        worldUpdate: summarizeSamples(trace.frames.map(frame => frame.updateMilliseconds)),
        rafInterval: summarizeSamples(trace.frames.map(frame => frame.rafIntervalMilliseconds)),
        observerOverhead: summarizeSamples(trace.frames.map(frame => frame.observerMilliseconds)),
        throughputDelta: Object.fromEntries(Object.keys(end.throughput).map(key => [key, end.throughput[key] - start.throughput[key]])),
        memoryCacheHitDelta: end.cache.memory.hits - start.cache.memory.hits,
        persistentCacheHitDelta: end.cache.persistentHits - start.cache.persistentHits,
        residentChunks: { initial: start.residentChunks, final: end.residentChunks, highWater: Math.max(...snapshots.map(value => value.residentChunks)) },
        residentPayloadHighWaterBytes: Math.max(...snapshots.map(value => value.residentPayloadBytes)),
        harnessInclusiveHeapHighWaterBytes: heaps.length ? Math.max(...heaps) : null,
        terminalBacklog: { generation: end.generationQueued, lighting: end.lightingQueued, meshing: end.meshSectionsQueued },
      };
    }),
  };
}

/**
 * Full evidence is validated above and written by runLane's finally before this
 * detached projection can escape. Keep every comparison callback, but do not hold
 * ten lanes of repeated chunk readiness/telemetry graphs in the Node process.
 */
export function projectR3PerformanceRun(run) {
  const compactSummary = structuredClone(compactRunEvidence(run));
  return {
    pair: run.pair, order: run.order, profile: run.profile, accepted: run.accepted,
    rejection: run.rejection ?? null, directory: run.directory,
    hardware: structuredClone(run.hardware), compactSummary,
    state: {
      schema: run.state.schema, status: run.state.status, traceHash: run.state.traceHash,
      artifactHash: run.state.artifactHash, corpusHash: run.state.corpusHash,
      rows: run.state.rows.map(row => ({ ordinal: row.ordinal,
        initializedRuntimeAcceptedMilliseconds: row.initializedRuntimeAcceptedMilliseconds,
        resetToAcceptedMilliseconds: row.resetToAcceptedMilliseconds })),
      traces: run.state.traces.map(trace => ({
        landscape: structuredClone(trace.landscape), readinessFailures: trace.readinessFailures,
        resetToInstalledMilliseconds: trace.resetToInstalledMilliseconds,
        resetToDrawableMilliseconds: trace.resetToDrawableMilliseconds,
        startupFrames: trace.startupFrames.map(frame => ({ rafTimestamp: frame.rafTimestamp })),
        frames: trace.frames.map(frame => ({
          point: structuredClone(frame.point), updates: frame.updates,
          rafTimestamp: frame.rafTimestamp, rafIntervalMilliseconds: frame.rafIntervalMilliseconds,
          updateMilliseconds: frame.updateMilliseconds,
          callbackOrdinal: frame.callbackOrdinal, physicsSteps: frame.physicsSteps,
          simulationTick: frame.simulationTick, simulationTimeSeconds: frame.simulationTimeSeconds,
          simulationTickAfter: frame.simulationTickAfter, simulationTimeSecondsAfter: frame.simulationTimeSecondsAfter,
          rawDeltaSeconds: frame.rawDeltaSeconds, clampedDeltaSeconds: frame.clampedDeltaSeconds,
          accumulatorSecondsBefore: frame.accumulatorSecondsBefore, accumulatorSecondsAfter: frame.accumulatorSecondsAfter,
          finalPositionUpdate: frame.finalPositionUpdate,
        })),
      })),
    },
  };
}

export async function benchmarkR3GenerationBrowser(argv = process.argv) {
  const options = parseR3PerformanceOptions(argv); const schedule = r3PerformanceSchedule(options.pairs);
  const selection = selectR3ProductionWorkerArtifact(options["public-dir"], options["expected-artifact-hash"]);
  const output = resolveR3ProductionWorkerOutput(options.output);
  assert(!existsSync(output) || readdirSync(output).length === 0, "use a fresh empty output directory; failed runs must be retained");
  const before = browserSourceSnapshot();
  const canonicalBefore = JSON.stringify(validatePublishedArtifacts(path.join(ROOT, "public/engine")));
  const selectedBefore = JSON.stringify(selection.validation);
  const mutex = await acquireManagedBrowserGateMutex(ROOT); const runs = []; const cleanup = {}; const builds = {};
  let failure = null; let comparison = null; let streamingComparison = null; let skill = null;
  try {
    await mkdir(output, { recursive: true });
    const landscapes = JSON.parse(readFileSync(path.join(ROOT, "tests/fixtures/rust-engine/r3/landscape-corpus.json"), "utf8")).cases;
    const playwright = await localPlaywright();
    process.stdout.write("Preparing complete independent 155-case oracle before any browser timing...\n");
    const corpus = await buildR3ProductionWorkerCorpus(selection.artifact.hash);
    await writeFile(path.join(output, "oracle-manifest.json"), `${JSON.stringify(corpus.manifest, null, 2)}\n`);
    for (const profile of PROFILES) {
      process.stdout.write(`Building isolated production fixture: ${profile}\n`);
      builds[profile] = await buildR3PerformanceProfile(profile, path.join(output, "builds", profile));
    }
    for (const lane of schedule) {
      process.stdout.write(`Running pair ${lane.pair + 1}, position ${lane.order + 1}: ${lane.profile}\n`);
      try { runs.push(await runLane(lane, builds[lane.profile], selection, corpus, landscapes, output, playwright)); }
      catch (error) {
        // A diagnostic pair may finish its counterpart to investigate a real
        // correctness/readiness failure. Rejected lanes NEVER become samples.
        if (options.pairs !== 1 || !error.r3RejectedLane) throw error;
        runs.push(error.r3RejectedLane);
        process.stdout.write(`Rejected ${lane.profile}: ${error.message}. Retaining the counterpart for diagnosis only.\n`);
      }
    }
    const hardwareIdentity = ({ browserVersion, executable, playwrightSource, launchArgs, graphics, capabilities, viewport }) =>
      ({ browserVersion, executable, playwrightSource, launchArgs, graphics, capabilities, viewport });
    assert.equal(new Set(runs.map(run => JSON.stringify(hardwareIdentity(run.hardware)))).size, 1, "hardware/browser configuration changed between lanes");
    if (runs.every(run => run.accepted)) {
      comparison = compareR3PerformanceRuns(runs);
      streamingComparison = compareR3StreamingRuns(runs);
    }
    if (options["skill-review"]) {
      const requests = []; const hosted = await staticServer(laneAssets(builds["rust-primary"], selection, corpus, landscapes), requests);
      const directory = path.join(output, "skill-correctness-only"); await mkdir(directory);
      skill = { scope: "Correctness and visual review only; excluded from all performance samples", process: {} };
      try {
        const client = path.join(os.homedir(), ".codex/skills/develop-web-game/scripts/web_game_playwright_client.js");
        const code = await runR3WorkerSkillClient(client, ["--url", hosted.url, "--click-selector", "#run", "--actions-json",
          JSON.stringify({ steps: [{ buttons: [], frames: 1 }] }), "--iterations", "1", "--screenshot-dir", directory], { evidence: skill.process });
        assert.equal(code, 0, "installed skill correctness client failed");
        const state = JSON.parse(readFileSync(path.join(directory, "state-0.json"), "utf8"));
        assertR3GenerationPerformanceSkillSummary(state, { profile: "rust-primary", manifest: corpus.manifest, landscapes });
        assert(!readdirSync(directory).some(name => name.startsWith("errors-")), "skill correctness client captured browser errors");
        skill.passed = true;
      } finally { await closeServer(hosted.server); }
    }
    assert(runs.every(run => run.accepted), "one or more diagnostic lanes were rejected; no performance comparison is accepted");
  } catch (error) { failure = error instanceof Error ? error.message : String(error); throw error; }
  finally {
    await mutex.release();
    cleanup.mutex = mutex.evidence;
    cleanup.browserSourceUnchanged = JSON.stringify(browserSourceSnapshot()) === JSON.stringify(before);
    cleanup.engineSourceUnchanged = createRustEngineSourceSnapshot(ROOT).digest === selection.sourceSnapshot.digest;
    cleanup.canonicalUnchanged = JSON.stringify(validatePublishedArtifacts(path.join(ROOT, "public/engine"))) === canonicalBefore;
    cleanup.selectedArtifactUnchanged = JSON.stringify(validatePublishedArtifacts(selection.directory)) === selectedBefore;
    const summary = { schema: 2, scope: "Real compiled-default browser generation and production-paced world-streaming subsystem; not full-game render/input/network acceptance",
      deliveryPolicy: "Fresh browser per lane. Content-addressed engine and bundled assets use immutable caching; unversioned manifest/config/oracle use no-store. Production loader fetch overrides remain intact. Repeated resets retain normal HTTP-cache reuse. Server deliveryBytes/request logs, not page-only ResourceTiming, count actual worker-internal deliveries. Loopback is not CDN performance.",
      performanceAcceptance: false, diagnosticOnly: options.pairs === 1, plannedPairs: options.pairs,
      rejectedLanes: runs.filter(run => !run.accepted).map(run => ({ profile: run.profile, reason: run.rejection, directory: run.directory })),
      artifactHash: selection.artifact.hash, engineSource: selection.sourceSnapshot, browserSource: before,
      schedule, builds: Object.fromEntries(Object.entries(builds).map(([profile, build]) => [profile, build.files])),
      comparison, streamingComparison, runs: runs.map(run => run.compactSummary), skill, failure, cleanup };
    await writeFile(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    assert(cleanup.browserSourceUnchanged && cleanup.engineSourceUnchanged && cleanup.canonicalUnchanged && cleanup.selectedArtifactUnchanged, "source/artifact changed during paired benchmark");
    process.stdout.write(`${JSON.stringify({ output, completedLanes: runs.length, acceptedLanes: runs.filter(run => run.accepted).length, comparison, streamingComparison, failure, cleanup }, null, 2)}\n`);
  }
}

if (isDirectInvocation(import.meta.url)) {
  try { await benchmarkR3GenerationBrowser(); }
  catch (error) { process.stderr.write(`R3 generation performance failed: ${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; }
}
