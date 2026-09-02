import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
  stableTerrainGenerationJsonV2,
} from "../app/game/terrain-generation-contract.ts";
import {
  COMPOSED_PROMOTION_CASES_V2,
  COMPOSED_PROMOTION_COVERAGE_V2,
  FROZEN_PROMOTION_CASES_V1,
  FROZEN_PROMOTION_CORPUS_HASH_V1,
  FROZEN_PROMOTION_COVERAGE_V1,
  NORMALIZED_OPTION_EXTENSION_CASES_V1,
  NORMALIZED_OPTION_EXTENSION_PATH_V1,
  assignStableCorpusOrdinals,
  expandFrozenPromotionCases,
  expandNormalizedOptionCases,
  loadFrozenPromotionCorpusV1,
  loadNormalizedOptionsExtensionV1,
  promotionCorpusHashV2,
  promotionExecutionSchedules,
  requestForPromotionCase,
} from "../scripts/lib/rust-worldgen-promotion-corpus.ts";

const BASE_OPTION_KEYS = [
  "biomeScale",
  "caveFrequency",
  "enabledFactions",
  "largeTownFrequency",
  "profile",
  "resourceAbundance",
  "roadCoverage",
  "settlementClustering",
  "settlementDensity",
  "settlementPattern",
  "structures",
] as const;

test("the frozen 131-case corpus composes with exactly 24 normalized option cases", async () => {
  const [frozen, extension] = await Promise.all([
    loadFrozenPromotionCorpusV1(),
    loadNormalizedOptionsExtensionV1(),
  ]);
  const frozenCases = expandFrozenPromotionCases(frozen);
  const optionCases = expandNormalizedOptionCases(extension);
  const composed = assignStableCorpusOrdinals(frozenCases, optionCases);

  assert.equal(TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2, COMPOSED_PROMOTION_CASES_V2);
  assert.equal(TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2, "5d4e6b1445b00f3430164d1a8093d8dc");
  assert.equal(extension.baseCorpusCases, FROZEN_PROMOTION_CASES_V1);
  assert.equal(extension.baseCorpusHash, FROZEN_PROMOTION_CORPUS_HASH_V1);
  assert.equal(frozenCases.length, 131);
  assert.equal(optionCases.length, NORMALIZED_OPTION_EXTENSION_CASES_V1);
  assert.equal(composed.length, COMPOSED_PROMOTION_CASES_V2);
  assert.equal("corpusHash" in extension, false, "the extension must not invent a pre-parity corpus hash");

  const frozenCoverage = new Set([
    ...frozen.genericSweep.coverage,
    ...frozen.cases.flatMap(({ coverage }) => coverage),
  ]);
  const composedCoverage = new Set([
    ...frozenCoverage,
    ...extension.requiredCoverage,
  ]);
  assert.equal(frozenCoverage.size, FROZEN_PROMOTION_COVERAGE_V1);
  assert.equal(extension.requiredCoverage.length, 24);
  assert.equal(composedCoverage.size, COMPOSED_PROMOTION_COVERAGE_V2);
  assert.equal(extension.composedCoverage, COMPOSED_PROMOTION_COVERAGE_V2);

  assert.deepEqual(composed.slice(0, 5).map(({ ordinal, id }) => [ordinal, id]), [
    [1, "surface-poi-negative"],
    [2, "connected-ocean-datum"],
    [3, "deep-ocean-flora"],
    [4, "negative-biome-transition"],
    [5, "cave-aquifer-markers"],
  ]);
  assert.deepEqual(composed.slice(66, 69).map(({ ordinal, id }) => [ordinal, id]), [
    [67, "road-end-marker-owned-by-neighbor"],
    [68, "generic-063"],
    [69, "generic-061"],
  ]);
  assert.deepEqual(composed.slice(97, 101).map(({ ordinal, id }) => [ordinal, id]), [
    [98, "generic-003"],
    [99, "generic-001"],
    [100, "generic-062"],
    [101, "generic-060"],
  ]);
  assert.deepEqual(composed.slice(-2).map(({ ordinal, id }) => [ordinal, id]), [
    [154, "option-large-town-frequency-rare"],
    [155, "option-large-town-frequency-frequent"],
  ]);

  const ids = composed.map(({ id }) => id);
  assert.equal(new Set(ids).size, 155);
  const requestHashes = composed.map((entry) => requestForPromotionCase(entry).requestHash);
  assert.equal(new Set(requestHashes).size, 155, "every stable corpus request identity must be unique");
});

test("the 11-field base and every one-factor option lane are production-normalization fixed points", async () => {
  const extension = await loadNormalizedOptionsExtensionV1();
  const optionCases = expandNormalizedOptionCases(extension);
  assert.deepEqual(Object.keys(extension.normalizedOptionsBase).sort(), [...BASE_OPTION_KEYS].sort());
  assert.equal(stableTerrainGenerationJsonV2(extension.normalizedOptionsBase), [
    "{\"biomeScale\":1.35,\"caveFrequency\":1,\"enabledFactions\":[\"hobbits\",\"goblins\",\"atlantians\",\"sugarcourt\",\"wood-elves\",\"dwarves\"],",
    "\"largeTownFrequency\":\"balanced\",\"profile\":\"world-below-v15\",\"resourceAbundance\":1,\"roadCoverage\":\"regional\",",
    "\"settlementClustering\":\"regional\",\"settlementDensity\":1,\"settlementPattern\":\"heartlands-v2\",\"structures\":true}",
  ].join(""));

  const byId = new Map(optionCases.map((entry) => [entry.id, entry]));
  const options = (id: string) => {
    const value = byId.get(id)?.options;
    assert.ok(value, `${id} is absent`);
    return value;
  };
  assert.deepEqual(options("option-profile-legacy-v14"), {
    ...extension.normalizedOptionsBase,
    profile: "legacy-v14",
  });
  assert.equal(options("option-profile-legacy-v14").settlementPattern, "heartlands-v2",
    "legacy profile dispatch must remain isolated from the independent pattern lane");
  assert.deepEqual(options("option-enabled-factions-empty").enabledFactions, []);
  assert.deepEqual([
    "hobbits",
    "goblins",
    "atlantians",
    "sugarcourt",
    "wood-elves",
    "dwarves",
  ].map((faction) => options(`option-enabled-factions-${faction}`).enabledFactions), [
    ["hobbits"],
    ["goblins"],
    ["atlantians"],
    ["sugarcourt"],
    ["wood-elves"],
    ["dwarves"],
  ]);
  assert.deepEqual([
    options("option-cave-frequency-min").caveFrequency,
    options("option-cave-frequency-max").caveFrequency,
    options("option-biome-scale-min").biomeScale,
    options("option-biome-scale-max").biomeScale,
    options("option-resource-abundance-min").resourceAbundance,
    options("option-resource-abundance-max").resourceAbundance,
    options("option-settlement-density-min").settlementDensity,
    options("option-settlement-density-max").settlementDensity,
  ], [0, 3, 0.25, 4, 0.25, 4, 0, 2]);
  assert.deepEqual([
    options("option-settlement-clustering-even").settlementClustering,
    options("option-settlement-clustering-strong").settlementClustering,
    options("option-road-coverage-none").roadCoverage,
    options("option-road-coverage-local").roadCoverage,
    options("option-road-coverage-dense").roadCoverage,
    options("option-large-town-frequency-rare").largeTownFrequency,
    options("option-large-town-frequency-frequent").largeTownFrequency,
  ], ["even", "strong", "none", "local", "dense", "rare", "frequent"]);

  const changedKeys = optionCases.map((entry) => Object.keys(extension.normalizedOptionsBase).filter((key) => (
    stableTerrainGenerationJsonV2(entry.options?.[key])
      !== stableTerrainGenerationJsonV2(extension.normalizedOptionsBase[key])
  )));
  assert.ok(changedKeys.every((keys) => keys.length === 1), "every extension request must isolate one normalized option");
});

test("legacy edits canonicalize once and replay schedules cannot alter stable request identity", async () => {
  const [frozen, extension] = await Promise.all([
    loadFrozenPromotionCorpusV1(),
    loadNormalizedOptionsExtensionV1(),
  ]);
  const composed = assignStableCorpusOrdinals(
    expandFrozenPromotionCases(frozen),
    expandNormalizedOptionCases(extension),
  );
  const optionCases = composed.slice(FROZEN_PROMOTION_CASES_V1);
  const legacy = optionCases[0];
  assert.deepEqual(legacy.edits, [[49151, 3], [0, 7], [24576, 13]], "fixture must retain deliberately unsorted edits");
  const canonicalRequest = requestForPromotionCase(legacy);
  assert.deepEqual(Array.from(canonicalRequest.edits), [0, 7, 24576, 13, 49151, 3]);
  assert.equal(canonicalRequest.taskId, 132);
  assert.equal(canonicalRequest.revision, 132);

  const identity = new Map(optionCases.map((entry) => {
    const request = requestForPromotionCase(entry);
    return [entry.id, stableTerrainGenerationJsonV2({
      ordinal: entry.ordinal,
      requestHash: request.requestHash,
      taskId: request.taskId,
      revision: request.revision,
      edits: Array.from(request.edits),
    })];
  }));
  const schedules = promotionExecutionSchedules(optionCases);
  assert.deepEqual(schedules.forward.map(({ id }) => id), optionCases.map(({ id }) => id));
  assert.deepEqual(schedules.reverse.map(({ id }) => id), [...optionCases].reverse().map(({ id }) => id));
  assert.deepEqual(schedules.zipper.slice(0, 6).map(({ id }) => id), [
    "option-profile-legacy-v14",
    "option-large-town-frequency-frequent",
    "option-cave-frequency-min",
    "option-large-town-frequency-rare",
    "option-cave-frequency-max",
    "option-road-coverage-dense",
  ]);
  for (const schedule of Object.values(schedules)) {
    for (const entry of schedule) {
      const request = requestForPromotionCase(entry);
      assert.equal(stableTerrainGenerationJsonV2({
        ordinal: entry.ordinal,
        requestHash: request.requestHash,
        taskId: request.taskId,
        revision: request.revision,
        edits: Array.from(request.edits),
      }), identity.get(entry.id), `${entry.id} request identity changed with execution schedule`);
    }
  }
});

test("manifest-only evidence cannot produce a composed promotion hash", async () => {
  const [frozen, extension] = await Promise.all([
    loadFrozenPromotionCorpusV1(),
    loadNormalizedOptionsExtensionV1(),
  ]);
  assert.throws(() => promotionCorpusHashV2(frozen, extension, []), /requires all 155 parity rows/u);
  const extensionSource = JSON.parse(await readFile(NORMALIZED_OPTION_EXTENSION_PATH_V1, "utf8")) as Record<string, unknown>;
  assert.equal(extensionSource.corpusHash, undefined);
});
