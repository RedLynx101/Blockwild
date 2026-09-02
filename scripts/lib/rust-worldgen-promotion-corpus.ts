import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  LEGACY_TERRAIN_CONTENT_HASH_V2,
  createGenerateChunkRequestV2,
  hashTerrainGenerationIdentityV2,
  legacyTerrainGeneratorHashV2,
  stableTerrainGenerationJsonV2,
  type GenerateChunkRequestV2,
  type TerrainGenerationEditPair,
} from "../../app/game/terrain-generation-contract.ts";
import {
  canonicalWorldGenerationOptionsJsonV1,
  type WorldOptions,
} from "../../app/game/world-storage.ts";

export const FROZEN_PROMOTION_CASES_V1 = 131 as const;
export const FROZEN_PROMOTION_COVERAGE_V1 = 65 as const;
export const NORMALIZED_OPTION_EXTENSION_CASES_V1 = 24 as const;
export const COMPOSED_PROMOTION_CASES_V2 = 155 as const;
export const COMPOSED_PROMOTION_COVERAGE_V2 = 89 as const;
export const FROZEN_PROMOTION_CORPUS_HASH_V1 = "11604d437bd0c32d30164d1a8093d8dc" as const;
export const PROMOTION_CORPUS_HASH_DOMAIN_V2 = "blockwild-r3-promotion-corpus-v2" as const;

const ROOT = resolve(import.meta.dirname, "..", "..");
export const FROZEN_PROMOTION_MANIFEST_PATH_V1 = join(
  ROOT,
  "tests",
  "fixtures",
  "rust-engine",
  "r3",
  "promotion-corpus.json",
);
export const NORMALIZED_OPTION_EXTENSION_PATH_V1 = join(
  ROOT,
  "tests",
  "fixtures",
  "rust-engine",
  "r3",
  "promotion-options-extension.json",
);

const GENERATOR_VERSION = 18;
const FROZEN_NAMED_CASES = 67;
const FROZEN_GENERIC_CASES = 64;
const FROZEN_EXPANDED_CASES_SHA256 = "fdddcf94d9cb4e69da68a261876f75aa8b248913f7481049bae4dd7ff825bbd0";
const HASH_PATTERN = /^[0-9a-f]{32}$/u;

const NORMALIZED_OPTIONS_BASE = Object.freeze({
  biomeScale: 1.35,
  caveFrequency: 1,
  enabledFactions: Object.freeze([
    "hobbits",
    "goblins",
    "atlantians",
    "sugarcourt",
    "wood-elves",
    "dwarves",
  ]),
  largeTownFrequency: "balanced",
  profile: "world-below-v15",
  resourceAbundance: 1,
  roadCoverage: "regional",
  settlementClustering: "regional",
  settlementDensity: 1,
  settlementPattern: "heartlands-v2",
  structures: true,
});

type JsonRecord = Readonly<Record<string, unknown>>;

export type PromotionCorpusCaseV2 = Readonly<{
  id: string;
  seed: string;
  chunk: readonly [number, number];
  options?: JsonRecord;
  edits?: readonly TerrainGenerationEditPair[];
  coverage: readonly string[];
  markerToken?: string;
  absentMarkerToken?: string;
  minimumMarkers?: number;
  maximumMarkers?: number;
}>;

export type StablePromotionCorpusCaseV2 = PromotionCorpusCaseV2 & Readonly<{
  ordinal: number;
}>;

export type FrozenPromotionCorpusV1 = Readonly<{
  schema: number;
  generatorVersion: number;
  description: string;
  genericSweep: Readonly<{
    cases: number;
    seedModulo: number;
    xMultiplier: number;
    zMultiplier: number;
    coordinateModulus: number;
    coordinateOffset: number;
    coverage: readonly string[];
  }>;
  requiredCoverage: readonly string[];
  cases: readonly PromotionCorpusCaseV2[];
}>;

export type NormalizedOptionsExtensionV1 = Readonly<{
  schema: number;
  description: string;
  baseCorpusCases: number;
  baseCorpusHash: string;
  extensionCases: number;
  composedCorpusCases: number;
  composedCoverage: number;
  normalizedOptionsBase: JsonRecord;
  requiredCoverage: readonly string[];
  cases: readonly PromotionCorpusCaseV2[];
}>;

export type PromotionParityHashRowV2 = Readonly<{
  id: string;
  referenceChunkHash: string;
  candidateChunkHash: string;
}>;

type ExpectedExtensionCase = Readonly<{
  id: string;
  seed: string;
  chunk: readonly [number, number];
  changedOption: keyof typeof NORMALIZED_OPTIONS_BASE;
  options: JsonRecord;
  edits?: readonly TerrainGenerationEditPair[];
}>;

const EXPECTED_EXTENSION_CASES: readonly ExpectedExtensionCase[] = Object.freeze([
  { id: "option-profile-legacy-v14", seed: "HEARTHROADS", chunk: [-130, -191], changedOption: "profile", options: { profile: "legacy-v14", settlementPattern: "heartlands-v2" }, edits: [[49151, 3], [0, 7], [24576, 13]] },
  { id: "option-cave-frequency-min", seed: "CAVE-OPTIONS", chunk: [0, 0], changedOption: "caveFrequency", options: { caveFrequency: 0 } },
  { id: "option-cave-frequency-max", seed: "CAVE-OPTIONS", chunk: [0, 0], changedOption: "caveFrequency", options: { caveFrequency: 3 } },
  { id: "option-biome-scale-min", seed: "BIOME-OPTIONS", chunk: [7, -9], changedOption: "biomeScale", options: { biomeScale: 0.25 } },
  { id: "option-biome-scale-max", seed: "BIOME-OPTIONS", chunk: [7, -9], changedOption: "biomeScale", options: { biomeScale: 4 } },
  { id: "option-resource-abundance-min", seed: "RESOURCE-OPTIONS", chunk: [-1, -1], changedOption: "resourceAbundance", options: { resourceAbundance: 0.25 } },
  { id: "option-resource-abundance-max", seed: "RESOURCE-OPTIONS", chunk: [-1, -1], changedOption: "resourceAbundance", options: { resourceAbundance: 4 } },
  { id: "option-enabled-factions-empty", seed: "r3-settlement-breadth-0", chunk: [-70, 51], changedOption: "enabledFactions", options: { enabledFactions: [] } },
  { id: "option-enabled-factions-hobbits", seed: "r3-settlement-breadth-0", chunk: [-70, 51], changedOption: "enabledFactions", options: { enabledFactions: ["hobbits"] } },
  { id: "option-enabled-factions-goblins", seed: "r3-settlement-breadth-0", chunk: [-92, 154], changedOption: "enabledFactions", options: { enabledFactions: ["goblins"] } },
  { id: "option-enabled-factions-atlantians", seed: "r3-settlement-breadth-0", chunk: [-252, -28], changedOption: "enabledFactions", options: { enabledFactions: ["atlantians"] } },
  { id: "option-enabled-factions-sugarcourt", seed: "r3-settlement-breadth-0", chunk: [-91, 171], changedOption: "enabledFactions", options: { enabledFactions: ["sugarcourt"] } },
  { id: "option-enabled-factions-wood-elves", seed: "r3-settlement-breadth-0", chunk: [-558, 133], changedOption: "enabledFactions", options: { enabledFactions: ["wood-elves"] } },
  { id: "option-enabled-factions-dwarves", seed: "r3-settlement-breadth-0", chunk: [-84, 171], changedOption: "enabledFactions", options: { enabledFactions: ["dwarves"] } },
  { id: "option-settlement-pattern-legacy", seed: "LOCATOR-LEGACY", chunk: [-250, 147], changedOption: "settlementPattern", options: { settlementPattern: "legacy-scattered-v1" } },
  { id: "option-settlement-density-min", seed: "r3-settlement-breadth-0", chunk: [-70, 51], changedOption: "settlementDensity", options: { settlementDensity: 0 } },
  { id: "option-settlement-density-max", seed: "r3-settlement-breadth-0", chunk: [-70, 51], changedOption: "settlementDensity", options: { settlementDensity: 2 } },
  { id: "option-settlement-clustering-even", seed: "r3-settlement-breadth-0", chunk: [-199, 410], changedOption: "settlementClustering", options: { settlementClustering: "even" } },
  { id: "option-settlement-clustering-strong", seed: "r3-settlement-breadth-0", chunk: [-70, 51], changedOption: "settlementClustering", options: { settlementClustering: "strong" } },
  { id: "option-road-coverage-none", seed: "r3-road-breadth-0", chunk: [-136, -45], changedOption: "roadCoverage", options: { roadCoverage: "none" } },
  { id: "option-road-coverage-local", seed: "r3-road-breadth-0", chunk: [-136, -45], changedOption: "roadCoverage", options: { roadCoverage: "local" } },
  { id: "option-road-coverage-dense", seed: "r3-road-breadth-0", chunk: [-136, -45], changedOption: "roadCoverage", options: { roadCoverage: "dense" } },
  { id: "option-large-town-frequency-rare", seed: "r3-settlement-breadth-0", chunk: [-966, -1350], changedOption: "largeTownFrequency", options: { largeTownFrequency: "rare" } },
  { id: "option-large-town-frequency-frequent", seed: "r3-settlement-breadth-0", chunk: [-70, 51], changedOption: "largeTownFrequency", options: { largeTownFrequency: "frequent" } },
]);

function fail(message: string): never {
  throw new Error(`Rust worldgen promotion corpus rejected: ${message}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactJson(actual: unknown, expected: unknown, label: string) {
  invariant(
    stableTerrainGenerationJsonV2(actual) === stableTerrainGenerationJsonV2(expected),
    `${label} is not the exact frozen value`,
  );
}

function validateStringList(value: unknown, label: string): asserts value is string[] {
  invariant(Array.isArray(value), `${label} must be an array`);
  for (const entry of value) invariant(typeof entry === "string" && entry.length > 0, `${label} contains an invalid string`);
  invariant(new Set(value).size === value.length, `${label} must be unique`);
}

function validateCase(value: unknown, label: string): asserts value is PromotionCorpusCaseV2 {
  invariant(isRecord(value), `${label} must be an object`);
  invariant(typeof value.id === "string" && /^[a-z0-9-]+$/u.test(value.id), `${label}.id is invalid`);
  invariant(typeof value.seed === "string" && value.seed.length > 0, `${label}.seed is invalid`);
  invariant(Array.isArray(value.chunk) && value.chunk.length === 2, `${label}.chunk must contain two coordinates`);
  for (const coordinate of value.chunk) {
    invariant(Number.isInteger(coordinate) && Number.isSafeInteger(coordinate), `${label}.chunk contains an invalid coordinate`);
  }
  if (value.options !== undefined) invariant(isRecord(value.options), `${label}.options must be an object`);
  if (value.edits !== undefined) {
    invariant(Array.isArray(value.edits), `${label}.edits must be an array`);
    for (const [index, edit] of value.edits.entries()) {
      invariant(Array.isArray(edit) && edit.length === 2, `${label}.edits[${index}] must be an index/block pair`);
      invariant(Number.isInteger(edit[0]) && edit[0] >= 0 && edit[0] < 49_152, `${label}.edits[${index}] index is invalid`);
      invariant(Number.isInteger(edit[1]) && edit[1] >= 0 && edit[1] <= 0xffff, `${label}.edits[${index}] block is invalid`);
    }
  }
  validateStringList(value.coverage, `${label}.coverage`);
  for (const optional of ["markerToken", "absentMarkerToken"] as const) {
    invariant(value[optional] === undefined || typeof value[optional] === "string", `${label}.${optional} is invalid`);
  }
  for (const optional of ["minimumMarkers", "maximumMarkers"] as const) {
    invariant(value[optional] === undefined || (Number.isInteger(value[optional]) && Number(value[optional]) >= 0), `${label}.${optional} is invalid`);
  }
}

function validateFrozenManifest(value: unknown): asserts value is FrozenPromotionCorpusV1 {
  invariant(isRecord(value), "frozen manifest must be an object");
  invariant(value.schema === 1, "frozen manifest schema must remain 1");
  invariant(value.generatorVersion === GENERATOR_VERSION, "frozen manifest generator version must remain 18");
  invariant(typeof value.description === "string", "frozen manifest description is absent");
  invariant(isRecord(value.genericSweep), "frozen manifest generic sweep is absent");
  exactJson(value.genericSweep, {
    cases: FROZEN_GENERIC_CASES,
    seedModulo: 17,
    xMultiplier: 7919,
    zMultiplier: 3571,
    coordinateModulus: 4093,
    coordinateOffset: 2046,
    coverage: ["generic-positive-negative-order"],
  }, "frozen generic sweep");
  validateStringList(value.requiredCoverage, "frozen manifest requiredCoverage");
  invariant(value.requiredCoverage.length === FROZEN_PROMOTION_COVERAGE_V1, "frozen manifest must retain 65 coverage labels");
  invariant(Array.isArray(value.cases), "frozen manifest cases must be an array");
  invariant(value.cases.length === FROZEN_NAMED_CASES, "frozen manifest must retain 67 named cases");
  value.cases.forEach((entry, index) => validateCase(entry, `frozen cases[${index}]`));
}

function productionNormalizedOptions(value: JsonRecord) {
  const profile = value.profile === "legacy-v14" ? "legacy-v14" : "world-below-v15";
  const worldOptions = { ...value };
  delete worldOptions.profile;
  const canonical = canonicalWorldGenerationOptionsJsonV1(
    worldOptions as Partial<WorldOptions>,
    profile,
  );
  const parsed: unknown = JSON.parse(canonical);
  invariant(isRecord(parsed), "production option normalization did not return an object");
  return parsed;
}

function validateExtensionManifest(value: unknown): asserts value is NormalizedOptionsExtensionV1 {
  invariant(isRecord(value), "normalized option extension must be an object");
  invariant(value.schema === 1, "normalized option extension schema must remain 1");
  invariant(typeof value.description === "string", "normalized option extension description is absent");
  invariant(value.baseCorpusCases === FROZEN_PROMOTION_CASES_V1, "extension base count must remain 131");
  invariant(value.baseCorpusHash === FROZEN_PROMOTION_CORPUS_HASH_V1, "extension base hash does not identify the frozen corpus");
  invariant(value.extensionCases === NORMALIZED_OPTION_EXTENSION_CASES_V1, "extension count must remain 24");
  invariant(value.composedCorpusCases === COMPOSED_PROMOTION_CASES_V2, "composed count must remain 155");
  invariant(value.composedCoverage === COMPOSED_PROMOTION_COVERAGE_V2, "composed coverage count must remain 89");
  invariant(value.corpusHash === undefined && value.certificate === undefined, "extension must not predeclare an unproved composed certificate hash");
  exactJson(value.normalizedOptionsBase, NORMALIZED_OPTIONS_BASE, "normalized option base");
  invariant(isRecord(value.normalizedOptionsBase), "normalized option base must be an object");
  exactJson(productionNormalizedOptions(value.normalizedOptionsBase), NORMALIZED_OPTIONS_BASE, "production-normalized option base");
  validateStringList(value.requiredCoverage, "option extension requiredCoverage");
  invariant(value.requiredCoverage.length === NORMALIZED_OPTION_EXTENSION_CASES_V1, "option extension must contain 24 coverage labels");
  invariant(Array.isArray(value.cases), "option extension cases must be an array");
  invariant(value.cases.length === NORMALIZED_OPTION_EXTENSION_CASES_V1, "option extension must contain exactly 24 cases");
  value.cases.forEach((entry, index) => validateCase(entry, `option cases[${index}]`));

  for (const [index, expected] of EXPECTED_EXTENSION_CASES.entries()) {
    const actual = value.cases[index];
    exactJson(actual, {
      id: expected.id,
      seed: expected.seed,
      chunk: expected.chunk,
      options: expected.options,
      ...(expected.edits ? { edits: expected.edits } : {}),
      coverage: [expected.id],
    }, `option cases[${index}]`);
  }
  exactJson(value.requiredCoverage, EXPECTED_EXTENSION_CASES.map(({ id }) => id), "option extension requiredCoverage");
}

function frozenGenericCases(manifest: FrozenPromotionCorpusV1) {
  const sweep = manifest.genericSweep;
  const natural = Array.from({ length: sweep.cases }, (_, index): PromotionCorpusCaseV2 => ({
    id: `generic-${index.toString().padStart(3, "0")}`,
    seed: `r3-v18-corpus-${index % sweep.seedModulo}`,
    chunk: [
      (Math.imul(index, sweep.xMultiplier) % sweep.coordinateModulus) - sweep.coordinateOffset,
      sweep.coordinateOffset - (Math.imul(index, sweep.zMultiplier) % sweep.coordinateModulus),
    ],
    coverage: sweep.coverage,
  }));
  return natural
    .map((entry, offset) => ({ entry, offset }))
    .sort((left, right) => {
      const leftIndex = manifest.cases.length + left.offset;
      const rightIndex = manifest.cases.length + right.offset;
      return (leftIndex % 2) - (rightIndex % 2) || rightIndex - leftIndex;
    })
    .map(({ entry }) => entry);
}

function semanticRequestTuple(entry: PromotionCorpusCaseV2) {
  return stableTerrainGenerationJsonV2([
    entry.seed,
    entry.chunk,
    entry.options ?? {},
    entry.edits ?? [],
  ]);
}

function validateComposedCases(cases: readonly StablePromotionCorpusCaseV2[]) {
  invariant(cases.length === COMPOSED_PROMOTION_CASES_V2, "composed corpus must contain 155 cases");
  const ids = cases.map(({ id }) => id);
  invariant(new Set(ids).size === cases.length, "composed corpus case IDs must be unique");
  const tuples = cases.map(semanticRequestTuple);
  invariant(new Set(tuples).size === cases.length, "composed corpus semantic request tuples must be unique");
  cases.forEach((entry, index) => invariant(entry.ordinal === index + 1, `${entry.id} has an unstable corpus ordinal`));
}

export async function loadFrozenPromotionCorpusV1(
  path = FROZEN_PROMOTION_MANIFEST_PATH_V1,
): Promise<FrozenPromotionCorpusV1> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  validateFrozenManifest(parsed);
  const expanded = expandFrozenPromotionCases(parsed);
  const identity = createHash("sha256")
    .update(stableTerrainGenerationJsonV2(expanded))
    .digest("hex");
  invariant(identity === FROZEN_EXPANDED_CASES_SHA256, "frozen 131-case semantic order or request inputs changed");
  return parsed;
}

export async function loadNormalizedOptionsExtensionV1(
  path = NORMALIZED_OPTION_EXTENSION_PATH_V1,
): Promise<NormalizedOptionsExtensionV1> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  validateExtensionManifest(parsed);
  return parsed;
}

/** Expands the frozen named cases and its generic sweep in the original parity execution order. */
export function expandFrozenPromotionCases(
  manifest: FrozenPromotionCorpusV1,
): readonly PromotionCorpusCaseV2[] {
  validateFrozenManifest(manifest);
  const cases = [...manifest.cases, ...frozenGenericCases(manifest)];
  invariant(cases.length === FROZEN_PROMOTION_CASES_V1, "frozen corpus must expand to 131 cases");
  return Object.freeze(cases);
}

/** Merges each one-factor patch onto the exact 11-field production-normalized base. */
export function expandNormalizedOptionCases(
  manifest: NormalizedOptionsExtensionV1,
): readonly PromotionCorpusCaseV2[] {
  validateExtensionManifest(manifest);
  const cases = manifest.cases.map((entry, index): PromotionCorpusCaseV2 => {
    const merged = { ...manifest.normalizedOptionsBase, ...entry.options };
    const normalized = productionNormalizedOptions(merged);
    exactJson(normalized, merged, `${entry.id} production normalization fixed point`);
    const changed = Object.keys(NORMALIZED_OPTIONS_BASE).filter((key) => (
      stableTerrainGenerationJsonV2(normalized[key]) !== stableTerrainGenerationJsonV2(NORMALIZED_OPTIONS_BASE[key as keyof typeof NORMALIZED_OPTIONS_BASE])
    ));
    invariant(changed.length === 1, `${entry.id} must change exactly one normalized option`);
    invariant(changed[0] === EXPECTED_EXTENSION_CASES[index].changedOption, `${entry.id} changes the wrong normalized option`);
    return Object.freeze({ ...entry, options: Object.freeze(normalized) });
  });
  invariant(new Set(cases.map(semanticRequestTuple)).size === cases.length, "normalized option request tuples must be unique");
  return Object.freeze(cases);
}

export function assignStableCorpusOrdinals(
  frozenCases: readonly PromotionCorpusCaseV2[],
  optionCases: readonly PromotionCorpusCaseV2[],
): readonly StablePromotionCorpusCaseV2[] {
  invariant(frozenCases.length === FROZEN_PROMOTION_CASES_V1, "stable ordinal assignment requires the frozen 131 cases first");
  invariant(optionCases.length === NORMALIZED_OPTION_EXTENSION_CASES_V1, "stable ordinal assignment requires the 24 option cases last");
  const cases = [...frozenCases, ...optionCases].map((entry, index) => Object.freeze({
    ...entry,
    ordinal: index + 1,
  }));
  invariant(cases[0].id === "surface-poi-negative", "frozen ordinal 1 changed");
  invariant(cases[66].id === "road-end-marker-owned-by-neighbor", "frozen ordinal 67 changed");
  invariant(cases[67].id === "generic-063", "frozen ordinal 68 changed");
  invariant(cases[98].id === "generic-001", "frozen ordinal 99 changed");
  invariant(cases[99].id === "generic-062", "frozen ordinal 100 changed");
  invariant(cases[130].id === "generic-000", "frozen ordinal 131 changed");
  invariant(cases[131].id === "option-profile-legacy-v14", "extension ordinal 132 changed");
  invariant(cases[154].id === "option-large-town-frequency-frequent", "extension ordinal 155 changed");
  validateComposedCases(cases);
  return Object.freeze(cases);
}

/** Builds a request whose task and revision identity come from the stable corpus ordinal. */
export function requestForPromotionCase(entry: StablePromotionCorpusCaseV2): GenerateChunkRequestV2 {
  invariant(Number.isInteger(entry.ordinal) && entry.ordinal >= 1 && entry.ordinal <= COMPOSED_PROMOTION_CASES_V2, `${entry.id} has an invalid ordinal`);
  const [cx, cz] = entry.chunk;
  const generationOptions = entry.options ?? {};
  const optionsJson = stableTerrainGenerationJsonV2(generationOptions);
  const editHalo = entry.edits?.length ? 1 : 0;
  const namespace = `terrain-v5|g18|${entry.seed}|${optionsJson}|${cx},${cz}|${editHalo}`;
  return createGenerateChunkRequestV2({
    epoch: 1,
    taskId: entry.ordinal,
    revision: entry.ordinal,
    namespace,
    contentHash: LEGACY_TERRAIN_CONTENT_HASH_V2,
    generatorHash: legacyTerrainGeneratorHashV2(namespace),
    seedText: entry.seed,
    generationOptions,
    key: `${cx},${cz}`,
    cx,
    cz,
    edits: entry.edits ?? [],
  });
}

/** Deterministic replay orders. Executing a different schedule never changes request identity. */
export function promotionExecutionSchedules<T extends StablePromotionCorpusCaseV2>(
  cases: readonly T[],
): Readonly<{ forward: readonly T[]; reverse: readonly T[]; zipper: readonly T[] }> {
  const forward = [...cases];
  const reverse = [...cases].reverse();
  const zipper: T[] = [];
  for (let left = 0, right = cases.length - 1; left <= right; left += 1, right -= 1) {
    zipper.push(cases[left]);
    if (left !== right) zipper.push(cases[right]);
  }
  const expected = [...cases].map(({ id }) => id).sort();
  for (const [name, schedule] of Object.entries({ forward, reverse, zipper })) {
    invariant(schedule.length === cases.length, `${name} schedule changed the case count`);
    invariant(new Set(schedule.map(({ id }) => id)).size === cases.length, `${name} schedule repeats a case`);
    invariant(stableTerrainGenerationJsonV2(schedule.map(({ id }) => id).sort()) === stableTerrainGenerationJsonV2(expected), `${name} schedule changed case membership`);
  }
  return Object.freeze({
    forward: Object.freeze(forward),
    reverse: Object.freeze(reverse),
    zipper: Object.freeze(zipper),
  });
}

/**
 * Computes the v2 corpus identity only from a complete byte-equal 155-case result set.
 * This helper intentionally exports no precomputed hash or promotion certificate.
 */
export function promotionCorpusHashV2(
  frozenManifest: FrozenPromotionCorpusV1,
  extensionManifest: NormalizedOptionsExtensionV1,
  rows: readonly PromotionParityHashRowV2[],
) {
  const cases = assignStableCorpusOrdinals(
    expandFrozenPromotionCases(frozenManifest),
    expandNormalizedOptionCases(extensionManifest),
  );
  invariant(rows.length === cases.length, "v2 corpus hash requires all 155 parity rows");
  const expectedIds = [...cases.map(({ id }) => id)].sort();
  const actualIds = rows.map(({ id }) => id).sort();
  invariant(stableTerrainGenerationJsonV2(actualIds) === stableTerrainGenerationJsonV2(expectedIds), "v2 parity rows do not identify the exact corpus");
  invariant(new Set(actualIds).size === rows.length, "v2 parity rows repeat a case ID");
  for (const row of rows) {
    invariant(HASH_PATTERN.test(row.referenceChunkHash), `${row.id} reference chunk hash is invalid`);
    invariant(HASH_PATTERN.test(row.candidateChunkHash), `${row.id} candidate chunk hash is invalid`);
    invariant(row.referenceChunkHash === row.candidateChunkHash, `${row.id} is not byte-equal`);
  }
  const identity = stableTerrainGenerationJsonV2({
    frozenManifest,
    normalizedOptionsExtension: extensionManifest,
  });
  return hashTerrainGenerationIdentityV2(
    PROMOTION_CORPUS_HASH_DOMAIN_V2,
    identity,
    ...rows.map(({ id, referenceChunkHash, candidateChunkHash }) => (
      `${id}\0${referenceChunkHash}\0${candidateChunkHash}`
    )).sort(),
  );
}
