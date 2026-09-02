import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { BlockId } from "../app/game/data.ts";
import {
  TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
  createGeneratedChunkV2,
  decodeTerrainGenerationMarkerTableV2,
  hashTerrainGenerationIdentityV2,
  stableTerrainGenerationJsonV2,
  type GeneratedChunkV2,
  type GenerateChunkRequestV2,
} from "../app/game/terrain-generation-contract.ts";
import { terrainGenerationChunksByteEqualV2 } from "../app/game/rust-terrain-generation-backend.ts";
import {
  decodeRustTerrainGenerationResultV2,
  encodeRustTerrainGenerationRequestV2,
  parseTerrainGenerationParityCertificateV2,
} from "../app/game/rust-terrain-generation-bridge.ts";
import { generateChunkWithLegacyOracleV2 } from "../app/game/rust-terrain-generation-legacy-oracle.ts";
import { MIN_Y } from "../app/game/world.ts";
import {
  COMPOSED_PROMOTION_CASES_V2,
  FROZEN_PROMOTION_CASES_V1,
  FROZEN_PROMOTION_CORPUS_HASH_V1,
  NORMALIZED_OPTION_EXTENSION_CASES_V1,
  assignStableCorpusOrdinals,
  expandFrozenPromotionCases,
  expandNormalizedOptionCases,
  loadFrozenPromotionCorpusV1,
  loadNormalizedOptionsExtensionV1,
  promotionCorpusHashV2,
  promotionExecutionSchedules,
  requestForPromotionCase,
  type PromotionCorpusCaseV2,
  type StablePromotionCorpusCaseV2,
} from "../scripts/lib/rust-worldgen-promotion-corpus.ts";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURE = join(
  ROOT,
  "engine",
  "target",
  "debug",
  `blockwild-generation-fixture${process.platform === "win32" ? ".exe" : ""}`,
);
const WORK = join(ROOT, "work", "r3-promotion-corpus");
const FROZEN_REQUEST_BYTES_SHA256_V1 = "c73d343c4f08e0660379f5206766fb2246b4166ae9c5baa18683f5f82453ae9c";
const ORE_OR_VEIN_BLOCKS = new Set<number>([
  BlockId.CoalOre,
  BlockId.IronOre,
  BlockId.CopperOre,
  BlockId.GoldOre,
  BlockId.CrystalOre,
  BlockId.LivingVein,
  BlockId.VeinmetalHeart,
]);
const FACTION_IDS = ["hobbits", "goblins", "atlantians", "sugarcourt", "wood-elves", "dwarves"] as const;
const SEMANTIC_ARRAY_FIELDS = [
  "blocks",
  "heightmap",
  "biomes",
  "sectionBlockCounts",
  "skyTops",
  "light",
  "lightIndices",
  "leafIndices",
] as const;

type PrimaryResult = Readonly<{
  entry: StablePromotionCorpusCaseV2;
  request: GenerateChunkRequestV2;
  requestBytes: Uint8Array;
  reference: GeneratedChunkV2;
  candidate: GeneratedChunkV2;
}>;

function buildNativeFixture() {
  const result = spawnSync(
    "cargo",
    ["build", "-p", "blockwild-generation", "--bin", "blockwild-generation-fixture"],
    { cwd: join(ROOT, "engine"), encoding: "utf8", timeout: 180_000 },
  );
  assert.equal(result.status, 0, `R3 native fixture build failed:\n${result.stderr || result.stdout}`);
  assert.equal(existsSync(FIXTURE), true, `R3 native fixture is absent after build: ${FIXTURE}`);
}

async function runNativeFixture(
  entry: StablePromotionCorpusCaseV2,
  request: GenerateChunkRequestV2,
  requestBytes: Uint8Array,
  label: string,
) {
  const basename = `${label}-${String(entry.ordinal).padStart(3, "0")}-${entry.id}`;
  const input = join(WORK, `${basename}.request.bin`);
  const output = join(WORK, `${basename}.result.bin`);
  await writeFile(input, requestBytes);
  try {
    const result = spawnSync(FIXTURE, ["--packet", input, output], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, `${entry.id}: native fixture failed: ${result.stderr || result.stdout}`);
    assert.equal(existsSync(output), true, `${entry.id}: native fixture omitted its result packet`);
    return decodeRustTerrainGenerationResultV2(await readFile(output), request);
  } finally {
    await Promise.all([
      rm(input, { force: true }),
      rm(output, { force: true }),
    ]);
  }
}

function mismatchCount(left: ArrayLike<number>, right: ArrayLike<number>) {
  let mismatches = Math.abs(left.length - right.length);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) mismatches += 1;
  }
  return mismatches;
}

function markerText(chunk: GeneratedChunkV2) {
  return stableTerrainGenerationJsonV2(decodeTerrainGenerationMarkerTableV2(chunk.markerTable));
}

function semanticPayloadDifferences(left: GeneratedChunkV2, right: GeneratedChunkV2) {
  const differences: string[] = [];
  for (const field of SEMANTIC_ARRAY_FIELDS) {
    if (mismatchCount(left[field], right[field]) > 0) differences.push(field);
  }
  if (markerText(left) !== markerText(right)) differences.push("markerTable");
  return differences;
}

function assertSemanticOutputDiffers(left: GeneratedChunkV2, right: GeneratedChunkV2, label: string) {
  const differences = semanticPayloadDifferences(left, right);
  assert.ok(differences.length > 0, `${label} is a vacuous option anchor with no semantic payload delta`);
  return differences;
}

function undergroundAirCells(chunk: GeneratedChunkV2) {
  let air = 0;
  for (let localZ = 0; localZ < 16; localZ += 1) for (let localX = 0; localX < 16; localX += 1) {
    const column = localX + localZ * 16;
    for (let y = MIN_Y + 5; y <= chunk.heightmap[column] - 4; y += 1) {
      const index = column + (y - MIN_Y) * 16 * 16;
      if (chunk.blocks[index] === BlockId.Air) air += 1;
    }
  }
  return air;
}

function countBlocks(chunk: GeneratedChunkV2, accepted: ReadonlySet<number>) {
  let count = 0;
  for (const block of chunk.blocks) if (accepted.has(block)) count += 1;
  return count;
}

function assertMarkerConstraints(entry: PromotionCorpusCaseV2, chunk: GeneratedChunkV2) {
  const rows = decodeTerrainGenerationMarkerTableV2(chunk.markerTable);
  const text = JSON.stringify(rows);
  const escaped = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (entry.markerToken) assert.match(text, escaped(entry.markerToken), `${entry.id}: named marker family disappeared`);
  if (entry.absentMarkerToken) {
    assert.doesNotMatch(text, escaped(entry.absentMarkerToken), `${entry.id}: disabled marker family was emitted`);
  }
  if (entry.minimumMarkers !== undefined) {
    assert.ok(rows.length >= entry.minimumMarkers, `${entry.id}: expected at least ${entry.minimumMarkers} markers, found ${rows.length}`);
  }
  if (entry.maximumMarkers !== undefined) {
    assert.ok(rows.length <= entry.maximumMarkers, `${entry.id}: expected at most ${entry.maximumMarkers} markers, found ${rows.length}`);
  }
}

function assertEditMetadata(chunk: GeneratedChunkV2, label: string) {
  assert.equal(chunk.blocks[0], BlockId.Water, `${label}: canonical edit 0 must remain water`);
  assert.equal(chunk.blocks[24_576], BlockId.Glowstone, `${label}: canonical edit 24576 must remain glowstone`);
  assert.equal(chunk.blocks[49_151], BlockId.Stone, `${label}: canonical edit 49151 must remain stone`);
  assert.equal(chunk.lightIndices.includes(24_576), true, `${label}: edited glowstone must be indexed as an emitter`);
  assert.notEqual(chunk.light[24_576], 0, `${label}: edited glowstone must contribute packed light metadata`);
  const sectionVolume = 16 * 16 * 16;
  for (const index of [0, 24_576, 49_151]) {
    const section = Math.floor(index / sectionVolume);
    let occupied = 0;
    for (let cursor = section * sectionVolume; cursor < (section + 1) * sectionVolume; cursor += 1) {
      if (chunk.blocks[cursor] !== BlockId.Air) occupied += 1;
    }
    assert.equal(chunk.sectionBlockCounts[section], occupied, `${label}: edited section ${section} occupancy metadata drifted`);
  }
}

test("R3 native generation is byte-equal across the frozen 131 plus 24 anti-vacuous option lanes", async () => {
  const [frozenManifest, extensionManifest] = await Promise.all([
    loadFrozenPromotionCorpusV1(),
    loadNormalizedOptionsExtensionV1(),
  ]);
  const frozenCases = expandFrozenPromotionCases(frozenManifest);
  const optionCases = expandNormalizedOptionCases(extensionManifest);
  const cases = assignStableCorpusOrdinals(frozenCases, optionCases);
  const stableOptionCases = cases.slice(FROZEN_PROMOTION_CASES_V1);
  assert.equal(frozenCases.length, FROZEN_PROMOTION_CASES_V1);
  assert.equal(optionCases.length, NORMALIZED_OPTION_EXTENSION_CASES_V1);
  assert.equal(cases.length, COMPOSED_PROMOTION_CASES_V2);

  const frozenRequestBytes = createHash("sha256");
  for (const [index, entry] of cases.slice(0, FROZEN_PROMOTION_CASES_V1).entries()) {
    assert.equal(entry.ordinal, index + 1, `${entry.id}: frozen corpus ordinal changed`);
    const request = requestForPromotionCase(entry);
    assert.equal(request.taskId, entry.ordinal, `${entry.id}: frozen task identity changed`);
    assert.equal(request.revision, entry.ordinal, `${entry.id}: frozen revision identity changed`);
    frozenRequestBytes.update(encodeRustTerrainGenerationRequestV2(request));
  }
  assert.equal(
    frozenRequestBytes.digest("hex"),
    FROZEN_REQUEST_BYTES_SHA256_V1,
    "the byte identity or ordinal order of the frozen 131 requests changed",
  );

  buildNativeFixture();
  await mkdir(WORK, { recursive: true });
  const parityRows: Array<{ id: string; referenceChunkHash: string; candidateChunkHash: string }> = [];
  const optionResults = new Map<string, PrimaryResult>();
  for (const entry of cases) {
    const request = requestForPromotionCase(entry);
    const requestBytes = encodeRustTerrainGenerationRequestV2(request);
    const reference = createGeneratedChunkV2(request, generateChunkWithLegacyOracleV2(request));
    const candidate = await runNativeFixture(entry, request, requestBytes, "primary");
    assert.equal(
      terrainGenerationChunksByteEqualV2(reference, candidate),
      true,
      `${entry.id}: Rust generator is not byte-equal to the TypeScript v18 oracle`,
    );
    assert.equal(candidate.chunkHash, reference.chunkHash, `${entry.id}: exact chunk hash differs after byte parity`);
    assertMarkerConstraints(entry, reference);
    parityRows.push({
      id: entry.id,
      referenceChunkHash: reference.chunkHash,
      candidateChunkHash: candidate.chunkHash,
    });
    if (entry.ordinal > FROZEN_PROMOTION_CASES_V1) {
      optionResults.set(entry.id, {
        entry,
        request,
        requestBytes: Uint8Array.from(requestBytes),
        reference,
        candidate,
      });
    }
  }
  assert.equal(parityRows.length, COMPOSED_PROMOTION_CASES_V2, "primary corpusCases must exclude all replays");

  const frozenHash = hashTerrainGenerationIdentityV2(
    "blockwild-r3-promotion-corpus-v1",
    stableTerrainGenerationJsonV2(frozenManifest),
    ...parityRows.slice(0, FROZEN_PROMOTION_CASES_V1).map((row) => (
      `${row.id}\0${row.referenceChunkHash}\0${row.candidateChunkHash}`
    )).sort(),
  );
  assert.equal(frozenHash, FROZEN_PROMOTION_CORPUS_HASH_V1, "the original 131-case output certificate changed");
  const corpusHash = promotionCorpusHashV2(frozenManifest, extensionManifest, parityRows);
  assert.equal(corpusHash, TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2);
  const certificateProcess = spawnSync(FIXTURE, ["--certificate"], { cwd: ROOT, encoding: "utf8", timeout: 10_000 });
  assert.equal(certificateProcess.status, 0, certificateProcess.stderr);
  const certificate = parseTerrainGenerationParityCertificateV2(
    new TextEncoder().encode(certificateProcess.stdout.trim()),
  );
  assert.equal(certificate.byteEqual, true);
  assert.equal(certificate.corpusCases, TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2);
  assert.equal(certificate.corpusHash, TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2);

  const result = (id: string) => {
    const found = optionResults.get(id);
    assert.ok(found, `${id}: option result is absent`);
    return found;
  };
  const optionBaseResults = new Map<string, GeneratedChunkV2>();
  const optionSemanticDifferences = new Map<string, readonly string[]>();
  for (const entry of stableOptionCases) {
    const primary = result(entry.id);
    const baseRequest = requestForPromotionCase({
      ...entry,
      id: `${entry.id}-exact-normalized-base-probe`,
      options: extensionManifest.normalizedOptionsBase,
    });
    assert.equal(baseRequest.seedText, primary.request.seedText, `${entry.id}: anti-vacuity probe changed the seed`);
    assert.equal(baseRequest.cx, primary.request.cx, `${entry.id}: anti-vacuity probe changed cx`);
    assert.equal(baseRequest.cz, primary.request.cz, `${entry.id}: anti-vacuity probe changed cz`);
    assert.deepEqual(
      Array.from(baseRequest.edits),
      Array.from(primary.request.edits),
      `${entry.id}: anti-vacuity probe changed the canonical edits`,
    );
    assert.equal(
      stableTerrainGenerationJsonV2(baseRequest.generationOptions),
      stableTerrainGenerationJsonV2(extensionManifest.normalizedOptionsBase),
      `${entry.id}: anti-vacuity probe did not use the exact normalized option base`,
    );
    const base = createGeneratedChunkV2(
      baseRequest,
      generateChunkWithLegacyOracleV2(baseRequest),
    );
    const differences = assertSemanticOutputDiffers(
      primary.reference,
      base,
      `${entry.id} vs exact normalized base at ${entry.chunk.join(",")}`,
    );
    optionBaseResults.set(entry.id, base);
    optionSemanticDifferences.set(entry.id, Object.freeze(differences));
  }
  assert.equal(
    optionSemanticDifferences.size,
    NORMALIZED_OPTION_EXTENSION_CASES_V1,
    "every option lane must prove a same-seed/chunk/edits semantic delta from the exact normalized base",
  );
  const exactBaseFor = (id: string) => {
    const found = optionBaseResults.get(id);
    assert.ok(found, `${id}: exact normalized base result is absent`);
    return found;
  };
  const semanticDifferencesFor = (id: string) => {
    const found = optionSemanticDifferences.get(id);
    assert.ok(found, `${id}: semantic anti-vacuity evidence is absent`);
    return found;
  };

  const caveMin = result("option-cave-frequency-min").reference;
  const caveMax = result("option-cave-frequency-max").reference;
  const caveMinAir = undergroundAirCells(caveMin);
  const caveMaxAir = undergroundAirCells(caveMax);
  assert.equal(caveMinAir, 0, "caveFrequency=0 must not carve underground air below the protected roof");
  assert.ok(caveMaxAir > caveMinAir, "caveFrequency=3 must carve a non-empty underground-air signal");
  assert.ok(
    semanticPayloadDifferences(caveMin, caveMax).includes("blocks"),
    "cave min/max must differ in generated blocks",
  );

  const biomeMin = result("option-biome-scale-min").reference;
  const biomeMax = result("option-biome-scale-max").reference;
  const biomeMismatches = mismatchCount(biomeMin.biomes, biomeMax.biomes);
  assert.ok(biomeMismatches > 0, "biomeScale min/max must change the biome stream");

  const resourceMin = result("option-resource-abundance-min").reference;
  const resourceMax = result("option-resource-abundance-max").reference;
  const resourceMinCells = countBlocks(resourceMin, ORE_OR_VEIN_BLOCKS);
  const resourceMaxCells = countBlocks(resourceMax, ORE_OR_VEIN_BLOCKS);
  assert.ok(
    resourceMaxCells > resourceMinCells,
    `resourceAbundance=4 must emit more ore/vein cells than 0.25 (${resourceMaxCells} <= ${resourceMinCells})`,
  );

  const emptyFactions = result("option-enabled-factions-empty").reference;
  const emptyFactionMarkers = markerText(emptyFactions);
  assert.doesNotMatch(emptyFactionMarkers, /(?:settlement|faction):/u, "empty enabledFactions must suppress the known settlement");
  for (const faction of FACTION_IDS) {
    const singletonMarkers = markerText(result(`option-enabled-factions-${faction}`).reference);
    assert.match(singletonMarkers, new RegExp(`(?:settlement|faction):${faction}(?::|")`, "u"), `${faction}: singleton lane lacks its settlement marker`);
    for (const other of FACTION_IDS) if (other !== faction) {
      assert.doesNotMatch(singletonMarkers, new RegExp(`(?:settlement|faction):${other}(?::|")`, "u"), `${faction}: singleton lane leaked ${other} markers`);
    }
  }
  assertSemanticOutputDiffers(
    emptyFactions,
    result("option-enabled-factions-hobbits").reference,
    "empty factions vs known hobbit settlement",
  );

  const densityMin = result("option-settlement-density-min").reference;
  const densityMax = result("option-settlement-density-max").reference;
  assert.doesNotMatch(markerText(densityMin), /settlement:/u, "settlementDensity=0 must suppress the known settlement");
  assert.match(markerText(densityMax), /settlement:hobbits:/u, "settlementDensity=2 must retain the known hobbit settlement");
  assertSemanticOutputDiffers(densityMin, densityMax, "settlement density min/max");

  const patternLegacy = result("option-settlement-pattern-legacy");
  const patternHeartlands = exactBaseFor(patternLegacy.entry.id);
  const patternDifferences = assertSemanticOutputDiffers(
    patternLegacy.reference,
    patternHeartlands,
    "legacy-scattered-v1 vs heartlands-v2",
  );
  assert.ok(patternDifferences.includes("blocks"), "settlement pattern anchor must change generated blocks");
  assert.ok(patternDifferences.includes("markerTable"), "settlement pattern anchor must change marker output");
  assert.ok(decodeTerrainGenerationMarkerTableV2(patternLegacy.reference.markerTable).length >= 2);
  assert.match(markerText(patternLegacy.reference), /settlement:hobbits:hamlet/u);
  assert.equal(decodeTerrainGenerationMarkerTableV2(patternHeartlands.markerTable).length, 0);

  for (const id of ["option-settlement-clustering-even", "option-settlement-clustering-strong"]) {
    assert.ok(semanticDifferencesFor(id).includes("markerTable"), `${id}: clustering option must alter markers at its own anchor`);
    assert.notEqual(markerText(result(id).reference), markerText(exactBaseFor(id)), `${id}: clustering markers match exact base`);
  }

  const roadNone = result("option-road-coverage-none").reference;
  const roadLocal = result("option-road-coverage-local").reference;
  const roadDense = result("option-road-coverage-dense").reference;
  assert.doesNotMatch(markerText(roadNone), /surface-road/u, "roadCoverage=none must suppress road markers");
  assert.match(markerText(roadDense), /surface-road/u, "dense road anchor must expose a road marker");
  // The generic exact-base loop above is the anti-vacuity authority for every road lane.
  // None and local may converge here when this chunk has no eligible local road.
  assertSemanticOutputDiffers(roadLocal, roadDense, "road coverage local/dense");

  for (const id of ["option-large-town-frequency-rare", "option-large-town-frequency-frequent"]) {
    assert.ok(semanticDifferencesFor(id).includes("markerTable"), `${id}: town-frequency option must alter markers at its own anchor`);
    assert.notEqual(markerText(result(id).reference), markerText(exactBaseFor(id)), `${id}: town-frequency markers match exact base`);
  }

  const edited = result("option-profile-legacy-v14");
  assert.deepEqual(edited.entry.edits, [[49_151, 3], [0, 7], [24_576, 13]], "fixture must retain unsorted legacy edits");
  assert.deepEqual(Array.from(edited.request.edits), [0, 7, 24_576, 13, 49_151, 3], "request must canonicalize edits exactly once");
  assertEditMetadata(edited.reference, "TypeScript oracle");
  assertEditMetadata(edited.candidate, "Rust native fixture");

  let replayExecutions = 0;
  for (const [scheduleName, schedule] of Object.entries(promotionExecutionSchedules(stableOptionCases))) {
    for (const entry of schedule) {
      const primary = result(entry.id);
      const replayRequest = requestForPromotionCase(entry);
      const replayRequestBytes = encodeRustTerrainGenerationRequestV2(replayRequest);
      assert.deepEqual(replayRequestBytes, primary.requestBytes, `${entry.id}: ${scheduleName} replay changed request bytes`);
      const replay = await runNativeFixture(entry, replayRequest, replayRequestBytes, `replay-${scheduleName}`);
      assert.equal(replay.chunkHash, primary.candidate.chunkHash, `${entry.id}: ${scheduleName} replay changed chunk hash`);
      assert.equal(
        terrainGenerationChunksByteEqualV2(replay, primary.candidate),
        true,
        `${entry.id}: ${scheduleName} replay changed native result bytes`,
      );
      replayExecutions += 1;
    }
  }
  assert.equal(replayExecutions, NORMALIZED_OPTION_EXTENSION_CASES_V1 * 3);
  assert.equal(parityRows.length, COMPOSED_PROMOTION_CASES_V2, "replays must not inflate corpusCases");

  assert.match(corpusHash, /^[0-9a-f]{32}$/u);
  console.log(`R3_PROMOTION_CORPUS_V2 ${JSON.stringify({
    corpusCases: parityRows.length,
    replayExecutions,
    corpusHash,
    antiVacuity: {
      optionCasesAgainstExactBase: optionSemanticDifferences.size,
      caveUndergroundAir: [caveMinAir, caveMaxAir],
      biomeMismatches,
      resourceCells: [resourceMinCells, resourceMaxCells],
      patternChunk: patternLegacy.entry.chunk,
      patternDifferences,
    },
  })}`);
});
