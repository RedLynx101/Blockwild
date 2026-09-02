import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SCENARIO_LABELS, SCENARIO_ITERATIONS, STREAMING_CHECKPOINTS, PERFORMANCE_BACKEND_IDENTITY, assertBenchmarkStreamingReady, summarizeRuns } from "../scripts/autoresearch/blockwild-performance-evaluator.mjs";

function fixture(multiplier = 1) {
  const streaming = () => ({ playerChunkReady: true, generationQueued: 24, cache: { memory: { misses: 0 } },
    throughput: { generation: 12 }, generationWorker: { mode: "typescript", selectionSource: "constructor", state: "typescript-rollback", completed: 0 } });
  return {
    backendIdentity: { ...PERFORMANCE_BACKEND_IDENTITY },
    scenarios: SCENARIO_LABELS.map((label, index) => ({
      label,
      iterations: SCENARIO_ITERATIONS[index],
      averageMilliseconds: (index + 1) * multiplier,
      p95Milliseconds: (index + 2) * multiplier,
      p99Milliseconds: (index + 3) * multiplier,
      maximumMilliseconds: (index + 4) * multiplier,
    })),
    finalStreaming: streaming(),
    settlementFinalStreaming: streaming(),
    streamingCheckpoints: Object.fromEntries(STREAMING_CHECKPOINTS.map((name) => [name, streaming()])),
    creatureAdmission: { criticalHeroes: 2, tiers: { hero: 9, articulated: 41, silhouette: 32, hidden: 18 } },
    creatureLod: { activeBatches: 1 },
    creatureArticulation: { activeBatches: 1 },
  };
}

test("autoresearch evaluator keeps its scenario contract and geometric score fixed", () => {
  const baseline = summarizeRuns([fixture(), fixture(), fixture()]);
  const candidate = summarizeRuns([fixture(0.9), fixture(0.9), fixture(0.9)], baseline);
  assert.deepEqual(Object.keys(candidate.scenarioMedians), SCENARIO_LABELS);
  assert.ok(Math.abs(candidate.normalizedScore - 0.9) < 1e-12);
  assert.ok(Math.abs(candidate.worstScenarioRatio - 0.9) < 1e-12);
  assert.ok(Object.values(candidate.guardrails).every(Boolean));
});

test("autoresearch guardrails veto missing readiness and batches", () => {
  const broken = fixture();
  broken.finalStreaming.playerChunkReady = false;
  broken.creatureArticulation.activeBatches = 0;
  const summary = summarizeRuns([broken]);
  assert.equal(summary.guardrails.playerChunkReady, false);
  assert.equal(summary.guardrails.creatureBatchesPresent, false);
});

test("autoresearch rejects absent and mismatched authority metadata", () => {
  for (const change of [
    (run) => { delete run.backendIdentity; },
    (run) => { run.backendIdentity.terrainGenerationAuthorityMode = "rust"; },
    (run) => { delete run.finalStreaming.generationWorker; },
    (run) => { run.settlementFinalStreaming.generationWorker.mode = "rust"; },
    (run) => { run.streamingCheckpoints["main-warmup"].generationWorker.selectionSource = "test"; },
    (run) => { run.finalStreaming.generationWorker.state = "authority-unavailable"; },
  ]) {
    const run = fixture(); change(run); const result = summarizeRuns([run]);
    assert.equal(result.guardrails.backendIdentity, false);
    assert.equal(result.backendIdentity, null);
    assert.equal(result.normalizedScore, null);
    assert.throws(() => summarizeRuns([run], summarizeRuns([fixture()])), /backend identity/u);
  }
});

test("autoresearch requires completed terrain and readiness at every boundary and in both worlds", () => {
  for (const key of ["finalStreaming", "settlementFinalStreaming", ...STREAMING_CHECKPOINTS]) {
    const run = fixture(); const value = run[key] ?? run.streamingCheckpoints[key];
    value.throughput.generation = 0;
    assert.equal(summarizeRuns([run]).guardrails.nonVacuousGeneration, false, key);
    value.throughput.generation = 12; value.playerChunkReady = false;
    assert.equal(summarizeRuns([run]).guardrails.playerChunkReady, false, key);
  }
  const run = fixture(); delete run.streamingCheckpoints["player-edit-before"];
  assert.equal(summarizeRuns([run]).guardrails.nonVacuousGeneration, false);
  assert.equal(summarizeRuns([run]).guardrails.playerChunkReady, false);
  const valid = fixture(); assert.equal(summarizeRuns([valid]).guardrails.nonVacuousGeneration, true,
    "legacy TS completes terrain without completing any Rust worker tasks");
});

test("normalized comparisons refuse historical identity-free and invalid baselines", () => {
  const baseline = summarizeRuns([fixture()]);
  const missing = structuredClone(baseline); delete missing.backendIdentity;
  assert.throws(() => summarizeRuns([fixture(0.1)], missing), /backend identity/u);
  const mismatched = structuredClone(baseline); mismatched.backendIdentity.comparisonClass = "rust-wasm";
  assert.throws(() => summarizeRuns([fixture(0.1)], mismatched), /backend identity/u);
  const invalid = structuredClone(baseline); invalid.guardrails.nonVacuousGeneration = false;
  assert.throws(() => summarizeRuns([fixture(0.1)], invalid), /non-vacuous/u);
  const candidate = fixture(0.1); candidate.finalStreaming.playerChunkReady = false;
  assert.throws(() => summarizeRuns([candidate], baseline), /non-vacuous/u);
  assert.throws(() => summarizeRuns([]), /At least one/u);
});

test("benchmark checkpoint assertions reject vacuous measurements before reporting timings", () => {
  const streaming = fixture().finalStreaming;
  assert.equal(assertBenchmarkStreamingReady(streaming, "warmup"), streaming);
  assert.throws(() => assertBenchmarkStreamingReady({ ...streaming, generationWorker: undefined }, "warmup"), /warmup:.*authority/u);
  assert.throws(() => assertBenchmarkStreamingReady({ ...streaming, throughput: { generation: 0 } }, "warmup"), /no terrain generation/u);
  assert.throws(() => assertBenchmarkStreamingReady({ ...streaming, playerChunkReady: false }, "edit"), /edit:.*not ready/u);
});

test("benchmark keeps all ten workloads and explicit constructors with finally cleanup", () => {
  const source = readFileSync(new URL("../scripts/benchmark-performance-scenarios.ts", import.meta.url), "utf8");
  const scenarios = [...source.matchAll(/measure\("([^"]+)",\s*(\d+)/gu)];
  assert.deepEqual(scenarios.map((match) => match[1]), SCENARIO_LABELS);
  assert.deepEqual(scenarios.map((match) => Number(match[2])), [180, 240, 240, 180, 24, 240, 240, 240, 240, 40]);
  assert.equal((source.match(/new ChunkWorld\(\{ terrainGenerationAuthorityMode: "typescript" \}\)/gu) ?? []).length, 2);
  assert.match(source, /finally\s*\{/u);
  assert.equal((source.match(/cleanup\.push\(/gu) ?? []).length, 3);
  assert.match(source, /for \(const dispose of cleanup\.reverse\(\)\)/u);
});

test("autoresearch rejects missing, duplicate, extra, reordered, or resized workloads", () => {
  for (const change of [
    (run) => { run.scenarios.pop(); },
    (run) => { run.scenarios[1] = { ...run.scenarios[0] }; },
    (run) => { run.scenarios.push({ ...run.scenarios[0], label: "extra" }); },
    (run) => { run.scenarios.reverse(); },
    (run) => { run.scenarios[0].iterations -= 1; },
    (run) => { delete run.scenarios[0].iterations; },
  ]) {
    const run = fixture(); change(run);
    assert.throws(() => summarizeRuns([run]), /scenario contract mismatch/u);
  }
});

test("autoresearch invalid timings cannot yield raw or normalized gains", () => {
  const baseline = summarizeRuns([fixture()]);
  for (const key of ["averageMilliseconds", "p95Milliseconds", "p99Milliseconds", "maximumMilliseconds"]) {
    for (const value of [Number.NaN, Infinity, -Infinity, -1, undefined, ...(key === "p95Milliseconds" ? [0] : [])]) {
      const run = fixture(); run.scenarios[0][key] = value;
      const summary = summarizeRuns([run]);
      assert.equal(summary.guardrails.timingValidity, false, `${key}=${value}`);
      assert.equal(summary.rawP95GeometricMeanMilliseconds, null);
      assert.equal(summary.normalizedScore, null);
      assert.throws(() => summarizeRuns([run], baseline), /valid non-vacuous/u);
      const brokenBaseline = structuredClone(baseline);
      brokenBaseline.scenarioMedians[SCENARIO_LABELS[0]][key] = value;
      assert.throws(() => summarizeRuns([fixture()], brokenBaseline), /Invalid baseline timing/u);
    }
  }
});
