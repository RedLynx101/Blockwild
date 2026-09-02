import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SCENARIO_LABELS = Object.freeze([
  "stationary-settled",
  "continuous-walk",
  "continuous-sprint",
  "dense-360-turn-streaming-proxy",
  "frozen-lake-water-boundary-edit",
  "one-hundred-creature-lod-and-broadphase",
  "one-hundred-creature-admission-and-articulation",
  "settlement-traversal",
  "large-cavern-traversal",
  "player-edit-burst",
]);
export const SCENARIO_ITERATIONS = Object.freeze([180, 240, 240, 180, 24, 240, 240, 240, 240, 40]);

export const PERFORMANCE_BACKEND_IDENTITY = Object.freeze({
  schema: 1,
  runtime: "node",
  terrainGenerationAuthorityMode: "typescript",
  selectionSource: "constructor",
  comparisonClass: "legacy-typescript-cpu-baseline",
});
export const STREAMING_CHECKPOINTS = Object.freeze([
  "main-warmup", "frozen-edit-before", "frozen-edit-after", "settlement-traversal-after",
  "player-edit-before", "main-final", "settlement-final",
]);

function matchingBackend(value) {
  return value && Object.keys(value).length === Object.keys(PERFORMANCE_BACKEND_IDENTITY).length
    && Object.entries(PERFORMANCE_BACKEND_IDENTITY).every(([key, expected]) => value[key] === expected);
}
function selectedTypeScript(streaming) {
  return streaming?.generationWorker?.mode === "typescript"
    && streaming.generationWorker.selectionSource === "constructor"
    && streaming.generationWorker.state === "typescript-rollback";
}
function generatedTerrain(streaming) {
  return Number.isSafeInteger(streaming?.throughput?.generation) && streaming.throughput.generation > 0;
}

/** Used outside timed benchmark sections; failed generation must never produce a timing result. */
export function assertBenchmarkStreamingReady(streaming, checkpoint) {
  if (!selectedTypeScript(streaming)) throw new Error(`${checkpoint}: explicit TypeScript terrain authority is missing or mismatched`);
  if (!generatedTerrain(streaming)) throw new Error(`${checkpoint}: no terrain generation completed`);
  if (streaming.playerChunkReady !== true) throw new Error(`${checkpoint}: player chunk is not ready`);
  return streaming;
}

function parseArgs(argv) {
  const options = { runs: 3, output: null, artifacts: null, baseline: null, label: "candidate" };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--runs" && value) options.runs = Math.max(1, Math.min(9, Number.parseInt(value, 10) || 3));
    else if (key === "--output" && value) options.output = value;
    else if (key === "--artifacts" && value) options.artifacts = value;
    else if (key === "--baseline" && value) options.baseline = value;
    else if (key === "--label" && value) options.label = value;
    else continue;
    index += 1;
  }
  if (!options.output) throw new Error("--output is required");
  return options;
}

function percentileMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function parseBenchmark(stdout) {
  const marker = '{\n  "benchmark"';
  const start = stdout.indexOf(marker);
  if (start < 0) throw new Error(`Benchmark JSON marker missing. Tail: ${stdout.slice(-500)}`);
  return JSON.parse(stdout.slice(start));
}

function runBenchmark() {
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd", "run", "benchmark:performance-scenarios"]
    : ["run", "benchmark:performance-scenarios"];
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Benchmark failed (${result.status}): ${result.stderr || result.stdout}`);
  return parseBenchmark(result.stdout);
}

function scenarioMap(run) {
  return new Map(run.scenarios.map((scenario) => [scenario.label, scenario]));
}

function geometricMean(values) {
  return Math.exp(values.reduce((total, value) => total + Math.log(Math.max(1e-9, value)), 0) / values.length);
}

function validTiming(scenario) {
  return ["averageMilliseconds", "p95Milliseconds", "p99Milliseconds", "maximumMilliseconds"]
    .every((key) => Number.isFinite(scenario?.[key]) && scenario[key] >= 0)
    && scenario.p95Milliseconds > 0;
}

export function summarizeRuns(runs, baseline = null) {
  if (!Array.isArray(runs) || runs.length === 0) throw new Error("At least one benchmark run is required");
  for (const run of runs) {
    if (!Array.isArray(run.scenarios) || run.scenarios.length !== SCENARIO_LABELS.length
      || !SCENARIO_LABELS.every((label, index) => run.scenarios[index]?.label === label
        && run.scenarios[index].iterations === SCENARIO_ITERATIONS[index])) {
      throw new Error("Benchmark scenario contract mismatch: exact ordered scenarios and iteration counts are required");
    }
  }
  const mapped = runs.map(scenarioMap);
  const scenarioMedians = Object.fromEntries(SCENARIO_LABELS.map((label) => {
    const scenarios = mapped.map((entries) => entries.get(label));
    if (scenarios.some((scenario) => !scenario)) throw new Error(`Missing scenario ${label}`);
    return [label, {
      averageMilliseconds: percentileMedian(scenarios.map((scenario) => scenario.averageMilliseconds)),
      p95Milliseconds: percentileMedian(scenarios.map((scenario) => scenario.p95Milliseconds)),
      p99Milliseconds: percentileMedian(scenarios.map((scenario) => scenario.p99Milliseconds)),
      maximumMilliseconds: percentileMedian(scenarios.map((scenario) => scenario.maximumMilliseconds)),
    }];
  }));
  const finalRuns = runs.map((run) => run.finalStreaming);
  const checkpoints = runs.flatMap((run) => STREAMING_CHECKPOINTS.map((name) => run.streamingCheckpoints?.[name]));
  const allStreaming = [...finalRuns, ...runs.map((run) => run.settlementFinalStreaming), ...checkpoints];
  const guardrails = {
    scenarioCompleteness: Object.keys(scenarioMedians).length === SCENARIO_LABELS.length,
    timingValidity: runs.every((run) => run.scenarios.every(validTiming)),
    backendIdentity: runs.every((run) => matchingBackend(run.backendIdentity)) && allStreaming.every(selectedTypeScript),
    nonVacuousGeneration: allStreaming.every(generatedTerrain),
    playerChunkReady: allStreaming.every((streaming) => streaming?.playerChunkReady === true),
    boundedGenerationQueue: finalRuns.every((streaming) => Number.isInteger(streaming?.generationQueued) && streaming.generationQueued >= 0 && streaming.generationQueued <= 120),
    boundedFalseCacheMisses: finalRuns.every((streaming) => (streaming?.cache?.memory?.misses ?? 0) <= 5),
    admissionCoverage: runs.every((run) => run.creatureAdmission?.tiers?.hero >= run.creatureAdmission?.criticalHeroes
      && run.creatureAdmission?.tiers?.articulated > 0
      && run.creatureAdmission?.tiers?.silhouette > 0),
    creatureBatchesPresent: runs.every((run) => run.creatureLod?.activeBatches === 1 && run.creatureArticulation?.activeBatches === 1),
  };
  const rawP95GeometricMeanMilliseconds = guardrails.timingValidity
    ? geometricMean(SCENARIO_LABELS.map((label) => scenarioMedians[label].p95Milliseconds)) : null;
  let normalizedScore = null;
  let worstScenarioRatio = null;
  if (baseline) {
    if (!matchingBackend(baseline.backendIdentity) || !guardrails.backendIdentity) throw new Error("Normalized comparison requires matching explicit backend identity; legacy/missing identities cannot be compared");
    if (!Object.values(guardrails).every(Boolean) || !Object.keys(guardrails).every((key) => baseline.guardrails?.[key] === true)) throw new Error("Normalized comparison requires valid non-vacuous ready baseline and candidate runs");
    if (Object.keys(baseline.scenarioMedians ?? {}).length !== SCENARIO_LABELS.length) throw new Error("Baseline scenario contract mismatch");
    for (const label of SCENARIO_LABELS) if (!validTiming(baseline.scenarioMedians?.[label])) throw new Error(`Invalid baseline timing for ${label}`);
    const ratios = SCENARIO_LABELS.map((label) => scenarioMedians[label].p95Milliseconds / baseline.scenarioMedians[label].p95Milliseconds);
    normalizedScore = geometricMean(ratios);
    worstScenarioRatio = Math.max(...ratios);
  }
  return { backendIdentity: guardrails.backendIdentity ? { ...PERFORMANCE_BACKEND_IDENTITY } : null, scenarioMedians, rawP95GeometricMeanMilliseconds, normalizedScore, worstScenarioRatio, guardrails };
}

function main() {
  const options = parseArgs(process.argv);
  const artifactDirectory = path.resolve(options.artifacts ?? path.dirname(options.output));
  mkdirSync(artifactDirectory, { recursive: true });
  const runs = [];
  for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
    const run = runBenchmark();
    runs.push(run);
    writeFileSync(path.join(artifactDirectory, `${options.label}-run-${runIndex + 1}.json`), `${JSON.stringify(run, null, 2)}\n`);
  }
  const baseline = options.baseline ? JSON.parse(readFileSync(options.baseline, "utf8")) : null;
  const summary = summarizeRuns(runs, baseline);
  const result = {
    schema: 1,
    label: options.label,
    repetitions: options.runs,
    createdAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpu: os.cpus()[0]?.model ?? "unknown",
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    ...summary,
  };
  const output = path.resolve(options.output);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!Object.values(summary.guardrails).every(Boolean)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1)))) main();
