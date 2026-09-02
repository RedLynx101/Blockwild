import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  RUST_WORLDGEN_PROMOTION_FIXTURE_BUILD_COMMAND,
  RUST_WORLDGEN_PROMOTION_FIXTURE_PROFILE,
  loadBenchmarkPromotionCorpus,
  resolveRustWorldgenPromotionFixturePath,
  timingSummary,
} from "../scripts/benchmark-rust-worldgen-promotion.ts";
import {
  COMPOSED_PROMOTION_CASES_V2,
  COMPOSED_PROMOTION_COVERAGE_V2,
  requestForPromotionCase,
} from "../scripts/lib/rust-worldgen-promotion-corpus.ts";

test("worldgen promotion benchmarks consume the complete stable v2 corpus", async () => {
  const { frozenManifest, extensionManifest, orderedCases } = await loadBenchmarkPromotionCorpus();
  const coverage = new Set([
    ...frozenManifest.requiredCoverage,
    ...extensionManifest.requiredCoverage,
  ]);
  const requests = orderedCases.map(({ entry }) => requestForPromotionCase(entry));

  assert.equal(orderedCases.length, COMPOSED_PROMOTION_CASES_V2);
  assert.equal(orderedCases.filter(({ source }) => source === "named").length, 67);
  assert.equal(orderedCases.filter(({ source }) => source === "generic").length, 64);
  assert.equal(orderedCases.filter(({ source }) => source === "options").length, 24);
  assert.equal(coverage.size, COMPOSED_PROMOTION_COVERAGE_V2);
  assert.deepEqual(orderedCases.slice(130, 133).map(({ entry, source }) => [entry.ordinal, entry.id, source]), [
    [131, "generic-000", "generic"],
    [132, "option-profile-legacy-v14", "options"],
    [133, "option-cave-frequency-min", "options"],
  ]);
  assert.equal(orderedCases.at(-1)?.entry.ordinal, 155);
  assert.equal(orderedCases.at(-1)?.entry.id, "option-large-town-frequency-frequent");
  assert.ok(requests.every((request, index) => request.taskId === index + 1 && request.revision === index + 1));
  assert.equal(new Set(requests.map(({ requestHash }) => requestHash)).size, COMPOSED_PROMOTION_CASES_V2);
});

test("worldgen promotion benchmarks use the optimized release fixture", () => {
  assert.equal(RUST_WORLDGEN_PROMOTION_FIXTURE_PROFILE, "release");
  assert.equal(
    RUST_WORLDGEN_PROMOTION_FIXTURE_BUILD_COMMAND,
    "cargo build --release -p blockwild-generation --bin blockwild-generation-fixture",
  );
  assert.equal(
    resolveRustWorldgenPromotionFixturePath("fixture-root", "linux"),
    join("fixture-root", "engine", "target", "release", "blockwild-generation-fixture"),
  );
  assert.equal(
    resolveRustWorldgenPromotionFixturePath("fixture-root", "win32"),
    join("fixture-root", "engine", "target", "release", "blockwild-generation-fixture.exe"),
  );
});

test("worldgen promotion timing summaries include nearest-rank p99", () => {
  const summary = timingSummary(Array.from({ length: 100 }, (_, index) => index + 1));

  assert.equal(summary.p50Milliseconds, 50);
  assert.equal(summary.p95Milliseconds, 95);
  assert.equal(summary.p99Milliseconds, 99);
});
