import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  CanonicalGenerationHasher,
  createDragonLairLocatorRequestV1,
  createSettlementLocatorRequestV1,
  hashTerrainGenerationIdentityV2,
  stableTerrainGenerationJsonV2,
  type DragonLairLocatorRequestV1,
  type DragonLairLocatorResultV1,
  type SettlementLocatorRequestV1,
  type SettlementLocatorResultV1,
  type TerrainDragonSurveyTypeV1,
  type TerrainSettlementBiomeV1,
  type TerrainSettlementEnvironmentV1,
  type TerrainSettlementFactionV1,
  type TerrainSettlementSizeV1,
} from "../app/game/terrain-generation-contract.ts";
import {
  decodeRustDragonLairLocatorResultV1,
  decodeRustSettlementLocatorResultV1,
  encodeRustDragonLairLocatorRequestV1,
  encodeRustSettlementLocatorRequestV1,
  parseTerrainLocatorParityCertificateV1,
} from "../app/game/rust-terrain-generation-bridge.ts";
import { ChunkWorld, DEFAULT_WORLD_GENERATION_OPTIONS, BiomeId } from "../app/game/world.ts";
import { dragonLairCandidateForRegion, surveyNearestUndiscoveredDragonLair } from "../app/game/dragon-world.ts";
import { planSeaDragonNest } from "../app/game/v1-cultures.ts";
import { resolveRustEngineTestIndexRoot } from "./helpers/rust-engine-test-artifact.ts";

type SettlementCase = Readonly<{
  id: string; seed: string; origin: readonly [number, number]; options?: Readonly<Record<string, unknown>>;
  factionIds?: readonly TerrainSettlementFactionV1[]; sizes?: readonly TerrainSettlementSizeV1[];
  environments?: readonly TerrainSettlementEnvironmentV1[]; excludeIds?: readonly string[];
  generatedExclusionCount?: number;
  maxRegionRadius: number; limit: number; breathesWater?: boolean; expectNoResult?: boolean;
  expectedRejectedIds?: readonly string[]; expectedTieIds?: readonly [string, string]; expectedFirstId?: string;
  expectedGuildHallId?: string; allowNoResult?: boolean; coverage: readonly string[];
}>;
type LairCase = Readonly<{
  id: string; seed: string; origin: readonly [number, number]; options?: Readonly<Record<string, unknown>>;
  dragonType: TerrainDragonSurveyTypeV1; minimumStage: 3 | 4 | 5; excludeIds?: readonly string[];
  generatedExclusionCount?: number; allowNoResult?: boolean;
  maxRegionRadius: number; expectNoResult?: boolean; expectedStage?: 3 | 4 | 5;
  expectedSex?: "female" | "male"; expectedRejectedSeaCandidate?: Readonly<{ id: string; x: number; z: number }>;
  coverage: readonly string[];
}>;
type Corpus = Readonly<{
  schema: 1; requiredSettlementCoverage: readonly string[]; requiredLairCoverage: readonly string[];
  settlementOptionSweeps: readonly Readonly<{ field: "caveFrequency" | "biomeScale" | "resourceAbundance" | "settlementDensity"; values: readonly number[] }>[];
  settlements: readonly SettlementCase[]; lairs: readonly LairCase[];
}>;
type LocatorWasm = Readonly<{
  default(input: { module_or_path: Uint8Array }): Promise<unknown>;
  blockwild_query_settlements_v1?(request: Uint8Array): Uint8Array;
  blockwild_query_dragon_lair_v1?(request: Uint8Array): Uint8Array;
  blockwild_locator_parity_certificate_v1?(): Uint8Array;
}>;
type PublishedLocatorWasm = Readonly<{
  hash: string;
  wasmModule: LocatorWasm;
  available: boolean;
  overridden: boolean;
}>;

const ROOT = resolve(import.meta.dirname, "..");
const CORPUS_PATH = join(ROOT, "tests", "fixtures", "rust-engine", "locator", "corpus.json");
const VECTORS_PATH = join(ROOT, "tests", "fixtures", "rust-engine", "locator", "native-vectors.json");
const EVIDENCE_PATH = join(ROOT, "tests", "fixtures", "rust-engine", "locator", "evidence.json");
const FIXTURE = join(ROOT, "engine", "target", "debug", `blockwild-generation-fixture${process.platform === "win32" ? ".exe" : ""}`);
const WORK = join(ROOT, "work", "locator-parity");

function isStrictSubdirectory(parent: string, candidate: string) {
  const relation = relative(parent, candidate);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

async function resolvePublishedEngineIndexRoot(override: string | null | undefined = process.env.BLOCKWILD_LOCATOR_ENGINE_DIR) {
  return resolveRustEngineTestIndexRoot(ROOT, override);
}

function generationOptions(overrides: Readonly<Record<string, unknown>> = {}) {
  const input = { ...DEFAULT_WORLD_GENERATION_OPTIONS, ...overrides } as typeof DEFAULT_WORLD_GENERATION_OPTIONS;
  return {
    profile: input.profile,
    caveFrequency: input.caveFrequency,
    biomeScale: input.biomeScale,
    resourceAbundance: input.resourceAbundance,
    structures: input.structures,
    enabledFactions: input.enabledFactions,
    settlementPattern: input.settlementPattern,
    settlementDensity: input.settlementDensity,
    settlementClustering: input.settlementClustering,
    roadCoverage: input.roadCoverage,
    largeTownFrequency: input.largeTownFrequency,
    origin: input.origin,
  };
}

function expandedSettlementCases(manifest: Corpus): SettlementCase[] {
  const sweeps = manifest.settlementOptionSweeps.flatMap(({ field, values }) => values.map((value): SettlementCase => ({
    id: `option-sweep-${field}-${String(value).replace(".", "p")}`,
    seed: `LOCATOR-OPTION-SWEEP-${field}-${value}`,
    origin: [-0.499, 0.501], options: { [field]: value }, maxRegionRadius: 0, limit: 1,
    allowNoResult: true, coverage: [],
  })));
  return [...manifest.settlements, ...sweeps];
}

function exclusionIds(entry: Readonly<{ excludeIds?: readonly string[]; generatedExclusionCount?: number }>) {
  const generated = Array.from({ length: entry.generatedExclusionCount ?? 0 }, (_, index) =>
    `fixture-exclusion-${index.toString(36).padStart(4, "0")}`);
  return [...(entry.excludeIds ?? []), ...generated];
}

function buildNativeFixture() {
  const result = spawnSync("cargo", ["build", "-p", "blockwild-generation", "--bin", "blockwild-generation-fixture"], {
    cwd: join(ROOT, "engine"), encoding: "utf8", timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(FIXTURE), true);
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function nativePacket(kind: "settlement" | "lair", id: string, request: Uint8Array) {
  const input = join(WORK, `${kind}-${id}.request.bin`);
  const first = join(WORK, `${kind}-${id}.result-a.bin`);
  const second = join(WORK, `${kind}-${id}.result-b.bin`);
  return writeFile(input, request).then(async () => {
    const flag = kind === "settlement" ? "--settlement-query" : "--dragon-lair-query";
    for (const output of [first, second]) {
      const result = spawnSync(FIXTURE, [flag, input, output], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
      assert.equal(result.status, 0, `${kind}/${id}: ${result.stderr || result.stdout}`);
    }
    const [a, b] = await Promise.all([readFile(first), readFile(second)]);
    assert.equal(bytesEqual(a, b), true, `${kind}/${id}: native packet output changed between identical runs`);
    return new Uint8Array(a);
  });
}

async function assertNativePacketRejected(kind: "settlement" | "lair", id: string, request: Uint8Array) {
  const input = join(WORK, `${kind}-malformed-${id}.request.bin`);
  const output = join(WORK, `${kind}-malformed-${id}.result.bin`);
  await writeFile(input, request);
  const flag = kind === "settlement" ? "--settlement-query" : "--dragon-lair-query";
  const result = spawnSync(FIXTURE, [flag, input, output], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  assert.notEqual(result.status, 0, `${kind}/${id}: native fixture accepted a malformed locator packet`);
}

function appendByte(value: Uint8Array, byte = 0) {
  const result = new Uint8Array(value.byteLength + 1);
  result.set(value);
  result[value.byteLength] = byte;
  return result;
}

function skipWireString(value: Uint8Array, offset: number) {
  const length = new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(offset, true);
  return offset + 4 + length;
}

function settlementWireOffsets(value: Uint8Array) {
  let offset = skipWireString(value, 6);
  offset = skipWireString(value, offset);
  offset += 16;
  const firstPresence = offset;
  for (let list = 0; list < 3; list += 1) {
    const present = value[offset++];
    if (present === 0) continue;
    const count = value[offset++];
    for (let index = 0; index < count; index += 1) offset = skipWireString(value, offset);
  }
  const exclusionCount = offset;
  const count = new DataView(value.buffer, value.byteOffset, value.byteLength).getUint16(offset, true);
  offset += 2;
  for (let index = 0; index < count; index += 1) offset = skipWireString(value, offset);
  offset += 2;
  offset += 1;
  return { firstPresence, exclusionCount, waterFlag: offset };
}

function lairWireOffsets(value: Uint8Array) {
  let offset = skipWireString(value, 6);
  offset = skipWireString(value, offset);
  offset += 16;
  offset = skipWireString(value, offset);
  const minimumStage = offset++;
  return { minimumStage, exclusionCount: offset };
}

async function verifyNativeRequestRejection() {
  const settlement = createSettlementLocatorRequestV1({ epoch: 1, taskId: 1, seedText: "LOCATOR-MALFORMED",
    generationOptions: generationOptions(), origin: { x: -0.125, z: 0.125 }, maxRegionRadius: 18, limit: 1 });
  const settlementBytes = encodeRustSettlementLocatorRequestV1(settlement);
  const settlementOffsets = settlementWireOffsets(settlementBytes);
  const invalidPresence = settlementBytes.slice(); invalidPresence[settlementOffsets.firstPresence] = 2;
  const invalidWater = settlementBytes.slice(); invalidWater[settlementOffsets.waterFlag] = 2;
  const invalidExclusionCount = settlementBytes.slice();
  new DataView(invalidExclusionCount.buffer).setUint16(settlementOffsets.exclusionCount, 4_097, true);
  const staleSettlementHash = settlementBytes.slice(); staleSettlementHash[staleSettlementHash.length - 1] ^= 1;
  await assertNativePacketRejected("settlement", "presence", invalidPresence);
  await assertNativePacketRejected("settlement", "exclusion-count", invalidExclusionCount);
  await assertNativePacketRejected("settlement", "water-flag", invalidWater);
  await assertNativePacketRejected("settlement", "hash", staleSettlementHash);
  await assertNativePacketRejected("settlement", "trailing", appendByte(settlementBytes));

  const presentSettlement = createSettlementLocatorRequestV1({ epoch: 1, taskId: 2, seedText: "LOCATOR-MALFORMED",
    generationOptions: generationOptions(), origin: { x: 0, z: 0 }, factionIds: ["hobbits"], maxRegionRadius: 1, limit: 1 });
  const invalidOptionalCount = encodeRustSettlementLocatorRequestV1(presentSettlement);
  invalidOptionalCount[settlementWireOffsets(invalidOptionalCount).firstPresence + 1] = 7;
  await assertNativePacketRejected("settlement", "optional-count", invalidOptionalCount);

  const lair = createDragonLairLocatorRequestV1({ epoch: 1, taskId: 3, seedText: "LOCATOR-MALFORMED",
    generationOptions: generationOptions(), origin: { x: -0.125, z: 0.125 }, dragonType: "fire", minimumStage: 3,
    maxRegionRadius: 18 });
  const lairBytes = encodeRustDragonLairLocatorRequestV1(lair);
  const lairOffsets = lairWireOffsets(lairBytes);
  const invalidStage = lairBytes.slice(); invalidStage[lairOffsets.minimumStage] = 2;
  const invalidLairCount = lairBytes.slice(); new DataView(invalidLairCount.buffer).setUint16(lairOffsets.exclusionCount, 4_097, true);
  const staleLairHash = lairBytes.slice(); staleLairHash[staleLairHash.length - 1] ^= 1;
  await assertNativePacketRejected("lair", "stage", invalidStage);
  await assertNativePacketRejected("lair", "exclusion-count", invalidLairCount);
  await assertNativePacketRejected("lair", "hash", staleLairHash);
  await assertNativePacketRejected("lair", "trailing", appendByte(lairBytes));

  const tooMany = Array.from({ length: 4_097 }, (_, index) => `too-many-${index.toString(36).padStart(4, "0")}`);
  assert.throws(() => createSettlementLocatorRequestV1({ epoch: 1, taskId: 4, seedText: "LOCATOR-MALFORMED",
    generationOptions: generationOptions(), origin: { x: 0, z: 0 }, excludeIds: tooMany }));
  assert.throws(() => createDragonLairLocatorRequestV1({ epoch: 1, taskId: 5, seedText: "LOCATOR-MALFORMED",
    generationOptions: generationOptions(), origin: { x: 0, z: 0 }, dragonType: "fire", minimumStage: 3,
    excludeIds: tooMany }));
}

function toHex(value: Uint8Array) { return Buffer.from(value).toString("hex"); }

class LocatorResultWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;
  constructor(magic: string) { this.raw(new TextEncoder().encode(magic)); }
  private raw(value: Uint8Array) { this.chunks.push(value); this.length += value.byteLength; }
  u8(value: number) { this.raw(Uint8Array.of(value & 0xff)); }
  u16(value: number) { const data = new Uint8Array(2); new DataView(data.buffer).setUint16(0, value, true); this.raw(data); }
  i32(value: number) { const data = new Uint8Array(4); new DataView(data.buffer).setInt32(0, value, true); this.raw(data); }
  u64(value: bigint) { const data = new Uint8Array(8); new DataView(data.buffer).setBigUint64(0, value, true); this.raw(data); }
  string(value: string) { const data = new TextEncoder().encode(value); const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, data.byteLength, true); this.raw(length); this.raw(data); }
  finish() { const output = new Uint8Array(this.length); let offset = 0; for (const chunk of this.chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output; }
}

function encodeSettlementOracleResult(request: SettlementLocatorRequestV1, entries: SettlementLocatorResultV1["entries"]) {
  const hash = new CanonicalGenerationHasher("blockwild-settlement-query-result-v1");
  hash.writeString(request.requestHash); hash.writeU16(entries.length);
  const writer = new LocatorResultWriter("BWSR");
  writer.u16(1); writer.string(request.requestHash); writer.u8(entries.length);
  for (const entry of entries) {
    writer.string(entry.id); writer.string(entry.factionId); writer.string(entry.size); writer.string(entry.environment); writer.string(entry.biome);
    writer.i32(entry.regionX); writer.i32(entry.regionZ); writer.i32(entry.x); writer.i32(entry.z);
    writer.u8(entry.floorY === null ? 0 : 1); if (entry.floorY !== null) writer.i32(entry.floorY);
    writer.u64(entry.distanceSquaredMillis); writer.i32(entry.publicArrival!.x); writer.i32(entry.publicArrival!.yMillis);
    writer.i32(entry.publicArrival!.z); writer.string(entry.publicArrival!.anchorKind);
    hash.writeString(entry.id); hash.writeString(entry.factionId); hash.writeString(entry.size); hash.writeString(entry.environment); hash.writeString(entry.biome);
    hash.writeI32(entry.regionX); hash.writeI32(entry.regionZ); hash.writeI32(entry.x); hash.writeI32(entry.z);
    hash.writeU16(entry.floorY === null ? 0 : 1); if (entry.floorY !== null) hash.writeI32(entry.floorY);
    hash.writeU64(entry.distanceSquaredMillis); hash.writeI32(entry.publicArrival!.x); hash.writeI32(entry.publicArrival!.yMillis);
    hash.writeI32(entry.publicArrival!.z); hash.writeString(entry.publicArrival!.anchorKind);
  }
  writer.string(hash.finish()); return writer.finish();
}

function encodeLairOracleResult(request: DragonLairLocatorRequestV1, entry: DragonLairLocatorResultV1["entry"]) {
  const hash = new CanonicalGenerationHasher("blockwild-lair-query-result-v1");
  hash.writeString(request.requestHash); hash.writeU16(entry ? 1 : 0);
  const writer = new LocatorResultWriter("BWLR"); writer.u16(1); writer.string(request.requestHash); writer.u8(entry ? 1 : 0);
  if (entry) {
    writer.string(entry.id); writer.string(entry.dragonType); writer.u8(entry.stage); writer.string(entry.sex);
    writer.i32(entry.x); writer.i32(entry.y); writer.i32(entry.z); writer.u64(entry.distanceSquaredMillis);
    hash.writeString(entry.id); hash.writeString(entry.dragonType); hash.writeU16(entry.stage); hash.writeString(entry.sex);
    hash.writeI32(entry.x); hash.writeI32(entry.y); hash.writeI32(entry.z); hash.writeU64(entry.distanceSquaredMillis);
  }
  writer.string(hash.finish()); return writer.finish();
}

function corpusHash(manifest: Corpus, rows: readonly Readonly<{ kind: string; id: string; requestHex: string; resultHex: string }>[] ) {
  const hasher = new CanonicalGenerationHasher("blockwild-locator-promotion-corpus-v1");
  hasher.writeString(stableTerrainGenerationJsonV2(manifest));
  for (const row of [...rows].sort((a, b) => {
    const left = `${a.kind}:${a.id}`, right = `${b.kind}:${b.id}`;
    return left < right ? -1 : left > right ? 1 : 0;
  })) {
    hasher.writeString(row.kind); hasher.writeString(row.id);
    hasher.writeBytes(Buffer.from(row.requestHex, "hex"));
    hasher.writeBytes(Buffer.from(row.resultHex, "hex"));
  }
  return hasher.finish();
}

function createWorld(seed: string, options: Readonly<Record<string, unknown>>) {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript", rustTerrainMode: "off", rustWorldAuthorityMode: "off" });
  world.reset(seed, undefined, options as never);
  return world;
}

function wireSettlementBiome(value: string): TerrainSettlementBiomeV1 {
  switch (value) {
    case "meadow":
    case "flower-meadow": return "flower-meadow";
    case "forest": return "forest";
    case "wildwood": return "wildwood";
    case "highlands": return "highlands";
    case "badlands": return "badlands";
    case "cloudreed-glen": return "cloudreed-glen";
    case "deep-ocean": return "deep-ocean";
    case "lumen-trench": return "lumen-trench";
    case "sugarplum-vale": return "sugarplum-vale";
    case "glimmerwood": return "glimmerwood";
    case "snowcap-range": return "snowcap-range";
    default: throw new Error(`TypeScript settlement oracle emitted unsupported Rust biome ${value}`);
  }
}

function expectedSettlement(entry: SettlementCase): SettlementLocatorResultV1["entries"] {
  const options = generationOptions(entry.options);
  const world = createWorld(entry.seed, options);
  const result = world.queryNearestMaterializableSettlementsCompatibility({
    origin: { x: entry.origin[0], z: entry.origin[1] }, factionIds: entry.factionIds,
    sizes: entry.sizes, environments: entry.environments, excludeIds: exclusionIds(entry),
    maxRegionRadius: entry.maxRegionRadius, limit: entry.limit,
  }, entry.breathesWater === true);
  return Object.freeze(result.map(({ candidate, position, anchorKind }) => {
    const environment = candidate.environment ?? "surface";
    const dx = BigInt(candidate.center.x) * BigInt(1_000) - BigInt(Math.round(entry.origin[0] * 1_000));
    const dz = BigInt(candidate.center.z) * BigInt(1_000) - BigInt(Math.round(entry.origin[1] * 1_000));
    return {
      id: candidate.id, factionId: candidate.factionId, size: candidate.size, environment, biome: wireSettlementBiome(candidate.biome),
      regionX: candidate.regionX, regionZ: candidate.regionZ, x: candidate.center.x, z: candidate.center.z,
      floorY: candidate.floorY ?? null, distanceSquaredMillis: dx * dx + dz * dz,
      publicArrival: { x: position.x, yMillis: Math.round(position.y * 1_000), z: position.z, anchorKind },
    };
  }));
}

function expectedLair(entry: LairCase): DragonLairLocatorResultV1["entry"] {
  const options = generationOptions(entry.options);
  const world = createWorld(entry.seed, options);
  const survey = surveyNearestUndiscoveredDragonLair({
    seed: entry.seed, origin: { x: entry.origin[0], z: entry.origin[1] }, dragonType: entry.dragonType,
    minimumStage: entry.minimumStage, discoveredLairIds: exclusionIds(entry), maxRegionRadius: entry.maxRegionRadius,
    surfaceYAt: (x, z) => world.sampleColumn(x, z).height,
    isSeaDragonNestBiome: (x, z) => [BiomeId.DeepOcean, BiomeId.LumenTrench].includes(world.sampleColumn(x, z).biome),
  });
  if (!survey) return null;
  let sex: "female" | "male";
  if (entry.dragonType === "sea") {
    const match = /^sea-nest-(-?[0-9a-z]+)-(-?[0-9a-z]+)-/u.exec(survey.lairId);
    assert.ok(match, `${entry.id}: malformed TS sea nest id`);
    const regionX = Number.parseInt(match[1], 36), regionZ = Number.parseInt(match[2], 36);
    const floor = world.sampleColumn(survey.position.x, survey.position.z).height;
    const nest = planSeaDragonNest({ seed: entry.seed, regionX, regionZ, oceanFloorY: floor, biome: "lumen-trench" });
    assert.ok(nest); sex = nest.guardianSex;
  } else {
    const match = /^dragon-lair:[^:]+:(-?\d+):(-?\d+)$/u.exec(survey.lairId);
    assert.ok(match, `${entry.id}: malformed TS terrestrial lair id`);
    const candidate = dragonLairCandidateForRegion({ seed: entry.seed, regionX: Number(match[1]), regionZ: Number(match[2]), surfaceYAt: (x, z) => world.sampleColumn(x, z).height });
    assert.ok(candidate); sex = candidate.sex;
  }
  const dx = BigInt(survey.position.x) * BigInt(1_000) - BigInt(Math.round(entry.origin[0] * 1_000));
  const dz = BigInt(survey.position.z) * BigInt(1_000) - BigInt(Math.round(entry.origin[1] * 1_000));
  return { id: survey.lairId, dragonType: survey.dragonType, stage: survey.actualStage, sex,
    x: survey.position.x, y: survey.position.y, z: survey.position.z, distanceSquaredMillis: dx * dx + dz * dz };
}

async function loadPublishedWasm(): Promise<PublishedLocatorWasm> {
  const selected = await resolvePublishedEngineIndexRoot();
  const index = JSON.parse(await readFile(join(selected.directory, "manifest.json"), "utf8")) as {
    defaultVariant?: unknown;
    artifacts?: Record<string, { hash?: unknown; directory?: unknown }>;
  };
  assert.equal(typeof index.defaultVariant, "string", "locator engine index has no default variant");
  const defaultVariant = index.defaultVariant as string;
  const defaultArtifact = index.artifacts?.[defaultVariant];
  assert.ok(defaultArtifact && typeof defaultArtifact.hash === "string" && /^[0-9a-f]{64}$/u.test(defaultArtifact.hash),
    "locator engine default artifact has no canonical hash");
  assert.equal(typeof defaultArtifact.directory, "string", "locator engine default artifact has no directory");
  const hash = defaultArtifact.hash as string;
  const artifactDirectory = defaultArtifact.directory as string;
  let directory: string;
  try {
    directory = await realpath(join(selected.directory, artifactDirectory));
  } catch {
    throw new Error("locator engine default artifact directory does not exist");
  }
  if (!isStrictSubdirectory(selected.directory, directory)) {
    throw new Error("locator engine default artifact must resolve below its index directory");
  }
  const wasmBytes = new Uint8Array(await readFile(join(directory, "engine_bg.wasm")));
  const artifactManifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  const expectedWasmSha256 = Array.isArray(artifactManifest.files)
    ? artifactManifest.files.find((entry: { path?: unknown }) => entry.path === "engine_bg.wasm")?.sha256
    : artifactManifest.files?.["engine_bg.wasm"]?.sha256;
  if (expectedWasmSha256) assert.equal(createHash("sha256").update(wasmBytes).digest("hex"), expectedWasmSha256,
    "checked-in locator Wasm bytes do not match the artifact manifest hash");
  const wasmModule = await import(`${pathToFileURL(join(directory, "engine.js")).href}?locator=${Date.now()}`) as LocatorWasm;
  const available = typeof wasmModule.blockwild_query_settlements_v1 === "function"
    && typeof wasmModule.blockwild_query_dragon_lair_v1 === "function"
    && typeof wasmModule.blockwild_locator_parity_certificate_v1 === "function";
  if (available) await wasmModule.default({ module_or_path: wasmBytes });
  return { hash, wasmModule, available, overridden: selected.overridden };
}

test("locator promotion corpus derives exact TypeScript/native evidence and fails closed without Wasm exports", async () => {
  const manifest = JSON.parse(await readFile(CORPUS_PATH, "utf8")) as Corpus;
  assert.equal(manifest.schema, 1);
  for (const { field, values } of manifest.settlementOptionSweeps) {
    const expected = field === "settlementDensity"
      ? Array.from({ length: 41 }, (_, index) => Math.round(index * 5) / 100)
      : field === "caveFrequency"
        ? Array.from({ length: 13 }, (_, index) => index / 4)
        : Array.from({ length: 16 }, (_, index) => (index + 1) / 4);
    assert.deepEqual(values, expected, `${field}: corpus must enumerate every public slider value`);
  }
  assert.deepEqual([...new Set(manifest.settlements.flatMap(({ coverage }) => coverage))].sort(), [...manifest.requiredSettlementCoverage].sort());
  assert.deepEqual([...new Set(manifest.lairs.flatMap(({ coverage }) => coverage))].sort(), [...manifest.requiredLairCoverage].sort());
  const settlementCases = expandedSettlementCases(manifest);
  assert.ok(settlementCases.length >= 24);
  assert.ok(manifest.lairs.length >= 12);
  buildNativeFixture();
  await mkdir(WORK, { recursive: true });
  await verifyNativeRequestRejection();
  const published = await loadPublishedWasm();
  if (published.overridden) {
    assert.equal(process.env.BLOCKWILD_UPDATE_LOCATOR_CORPUS, undefined,
      "candidate locator artifact verification must not run in corpus update mode");
    assert.equal(published.available, true,
      "candidate locator artifact must expose settlement, lair, and certificate functions");
  }
  const rows: Array<{ kind: string; id: string; requestHex: string; resultHex: string }> = [];
  let taskId = 1;

  for (const entry of settlementCases) {
    const request = createSettlementLocatorRequestV1({
      epoch: 1, taskId: taskId++, seedText: entry.seed, generationOptions: generationOptions(entry.options),
      origin: { x: entry.origin[0], z: entry.origin[1] }, factionIds: entry.factionIds, sizes: entry.sizes,
      environments: entry.environments, excludeIds: exclusionIds(entry), maxRegionRadius: entry.maxRegionRadius,
      limit: entry.limit, breathesWater: entry.breathesWater,
    });
    const requestBytes = encodeRustSettlementLocatorRequestV1(request);
    const nativeBytes = await nativePacket("settlement", entry.id, requestBytes);
    const native = decodeRustSettlementLocatorResultV1(nativeBytes, request);
    const expected = expectedSettlement(entry);
    assert.deepEqual(native.entries, expected, `${entry.id}: native Rust and TypeScript settlement semantics differ`);
    assert.equal(bytesEqual(nativeBytes, encodeSettlementOracleResult(request, expected)), true,
      `${entry.id}: native Rust and TypeScript settlement result packet bytes differ`);
    if (entry.expectedFirstId) assert.equal(native.entries[0]?.id, entry.expectedFirstId,
      `${entry.id}: declared first materializable settlement changed`);
    if (entry.expectedGuildHallId) {
      const world = createWorld(entry.seed, generationOptions(entry.options));
      const materialized = world.queryNearestMaterializableSettlementsCompatibility({
        origin: { x: entry.origin[0], z: entry.origin[1] }, factionIds: entry.factionIds,
        sizes: entry.sizes, environments: entry.environments, excludeIds: exclusionIds(entry),
        maxRegionRadius: entry.maxRegionRadius, limit: entry.limit,
      }, entry.breathesWater === true);
      assert.equal(materialized[0]?.guildHall?.id, entry.expectedGuildHallId,
        `${entry.id}: declared guild-hall-expanded settlement no longer materializes with the canonical hall`);
    }
    if (entry.expectedTieIds) {
      const [leftId, rightId] = entry.expectedTieIds;
      const leftIndex = native.entries.findIndex(({ id }) => id === leftId);
      const rightIndex = native.entries.findIndex(({ id }) => id === rightId);
      assert.ok(leftIndex >= 0 && rightIndex >= 0, `${entry.id}: exact-distance tie members disappeared`);
      assert.equal(native.entries[leftIndex].distanceSquaredMillis, native.entries[rightIndex].distanceSquaredMillis,
        `${entry.id}: declared exact-distance pair no longer ties`);
      assert.ok(leftIndex < rightIndex && leftId < rightId, `${entry.id}: exact-distance tie is not resolved by canonical id`);
    }
    for (const rejectedId of entry.expectedRejectedIds ?? []) {
      const world = createWorld(entry.seed, generationOptions(entry.options));
      const raw = world.queryNearestSettlements({ origin: { x: entry.origin[0], z: entry.origin[1] },
        factionIds: entry.factionIds, sizes: entry.sizes, environments: entry.environments,
        maxRegionRadius: entry.maxRegionRadius, limit: 32 });
      const rejected = raw.find(({ candidate }) => candidate.id === rejectedId)?.candidate;
      assert.ok(rejected, `${entry.id}: declared rejected candidate no longer occurs in the TS locator scan`);
      const materialized = world.queryNearestMaterializableSettlementsCompatibility({
        origin: { x: entry.origin[0], z: entry.origin[1] }, factionIds: entry.factionIds,
        sizes: entry.sizes, environments: entry.environments, excludeIds: exclusionIds(entry),
        maxRegionRadius: entry.maxRegionRadius, limit: 32,
      }, entry.breathesWater === true);
      assert.equal(materialized.some(({ candidate }) => candidate.id === rejectedId), false,
        `${entry.id}: production materialization admitted a declared rejected candidate`);
      assert.equal(native.entries.some(({ id }) => id === rejectedId), false,
        `${entry.id}: Rust returned a settlement whose authoritative layout cannot materialize`);
      assert.equal(native.entries.length, entry.limit, `${entry.id}: Rust failed to continue after rejected layout`);
    }
    if (!entry.allowNoResult) assert.equal(native.entries.length === 0, entry.expectNoResult === true,
      `${entry.id}: no-result expectation differs`);
    if (published.available) {
      const wasmBytes = published.wasmModule.blockwild_query_settlements_v1!(requestBytes);
      assert.equal(bytesEqual(wasmBytes, nativeBytes), true, `${entry.id}: checked-in Wasm and native settlement packet bytes differ`);
    }
    rows.push({ kind: "settlement", id: entry.id, requestHex: toHex(requestBytes), resultHex: toHex(nativeBytes) });
  }

  for (const entry of manifest.lairs) {
    const request = createDragonLairLocatorRequestV1({
      epoch: 1, taskId: taskId++, seedText: entry.seed, generationOptions: generationOptions(entry.options),
      origin: { x: entry.origin[0], z: entry.origin[1] }, dragonType: entry.dragonType,
      minimumStage: entry.minimumStage, excludeIds: exclusionIds(entry), maxRegionRadius: entry.maxRegionRadius,
    });
    const requestBytes = encodeRustDragonLairLocatorRequestV1(request);
    const nativeBytes = await nativePacket("lair", entry.id, requestBytes);
    const native = decodeRustDragonLairLocatorResultV1(nativeBytes, request);
    const expected = expectedLair(entry);
    assert.deepEqual(native.entry, expected, `${entry.id}: native Rust and TypeScript lair semantics differ`);
    assert.equal(bytesEqual(nativeBytes, encodeLairOracleResult(request, expected)), true,
      `${entry.id}: native Rust and TypeScript lair result packet bytes differ`);
    if (entry.expectedStage !== undefined) assert.equal(native.entry?.stage, entry.expectedStage,
      `${entry.id}: declared stage coverage changed`);
    if (entry.expectedSex !== undefined) assert.equal(native.entry?.sex, entry.expectedSex,
      `${entry.id}: declared sex coverage changed`);
    if (entry.expectedRejectedSeaCandidate) {
      const rejected = entry.expectedRejectedSeaCandidate;
      const world = createWorld(entry.seed, generationOptions(entry.options));
      const column = world.sampleColumn(rejected.x, rejected.z);
      assert.equal([BiomeId.DeepOcean, BiomeId.LumenTrench].includes(column.biome) && column.height <= 22, false,
        `${entry.id}: declared theoretical sea nest became an admissible abyssal site`);
      assert.notEqual(native.entry?.id, rejected.id, `${entry.id}: Rust admitted a non-abyssal sea nest`);
    }
    if (!entry.allowNoResult) assert.equal(native.entry === null, entry.expectNoResult === true,
      `${entry.id}: no-result expectation differs`);
    if (published.available) {
      const wasmBytes = published.wasmModule.blockwild_query_dragon_lair_v1!(requestBytes);
      assert.equal(bytesEqual(wasmBytes, nativeBytes), true, `${entry.id}: checked-in Wasm and native lair packet bytes differ`);
    }
    rows.push({ kind: "lair", id: entry.id, requestHex: toHex(requestBytes), resultHex: toHex(nativeBytes) });
  }

  const hash = corpusHash(manifest, rows);
  const vectorDocument = { schema: 1, corpusHash: hash, rows };
  const serializedVectors = `${JSON.stringify(vectorDocument, null, 2)}\n`;
  const checkedVectors = existsSync(VECTORS_PATH) ? await readFile(VECTORS_PATH, "utf8") : null;
  if (process.env.BLOCKWILD_UPDATE_LOCATOR_CORPUS === "1" && !published.overridden) await writeFile(VECTORS_PATH, serializedVectors);
  else assert.equal(checkedVectors, serializedVectors, "locator native vectors are stale; regenerate explicitly after reviewing semantic parity");

  const evidence = {
    schema: 1, corpusHash: hash, settlementCases: settlementCases.length, lairCases: manifest.lairs.length,
    nativeByteEqualTwice: true, typescriptSemanticEqual: true, typescriptPacketByteEqual: true,
    checkedInWasmHash: published.hash,
    checkedInWasmExportsAvailable: published.available, byteEqual: published.available,
  };
  const serializedEvidence = `${JSON.stringify(evidence, null, 2)}\n`;
  if (published.overridden) {
    const canonicalEvidence = JSON.parse(await readFile(EVIDENCE_PATH, "utf8")) as {
      corpusHash?: unknown; settlementCases?: unknown; lairCases?: unknown;
    };
    assert.deepEqual(canonicalEvidence, {
      ...canonicalEvidence,
      corpusHash: hash,
      settlementCases: settlementCases.length,
      lairCases: manifest.lairs.length,
    }, "candidate verification requires canonical evidence for the same native corpus");
  } else if (process.env.BLOCKWILD_UPDATE_LOCATOR_CORPUS === "1") await writeFile(EVIDENCE_PATH, serializedEvidence);
  else assert.equal(await readFile(EVIDENCE_PATH, "utf8"), serializedEvidence, "locator evidence is stale");

  if (published.available) {
    const certificate = parseTerrainLocatorParityCertificateV1(published.wasmModule.blockwild_locator_parity_certificate_v1!());
    assert.deepEqual(certificate, { schemaVersion: 1, corpusHash: hash,
      settlementCases: settlementCases.length, lairCases: manifest.lairs.length, byteEqual: true });
  } else {
    assert.equal(evidence.byteEqual, false, "a checked-in artifact without locator exports must never mint parity");
  }
  assert.match(hash, /^[0-9a-f]{32}$/);
  assert.equal(hashTerrainGenerationIdentityV2("locator-vectors-byte-stability", serializedVectors),
    hashTerrainGenerationIdentityV2("locator-vectors-byte-stability", `${JSON.stringify(vectorDocument, null, 2)}\n`));
  console.log(`LOCATOR_PARITY_CORPUS ${JSON.stringify(evidence)}`);
});

test("locator decoders fail closed on corruption, stale authority, trailing bytes, and semantic tampering", async () => {
  if (!existsSync(VECTORS_PATH)) return;
  const vectors = JSON.parse(await readFile(VECTORS_PATH, "utf8")) as { rows: Array<{ kind: string; id: string; requestHex: string; resultHex: string }> };
  const settlement = vectors.rows.find(({ kind }) => kind === "settlement")!;
  const request = createSettlementLocatorRequestV1({ epoch: 1, taskId: 1, seedText: "LOCATOR-ANY-MULTI",
    generationOptions: generationOptions(), origin: { x: -513.25, z: 777.75 }, maxRegionRadius: 18, limit: 6 });
  const bytes = Uint8Array.from(Buffer.from(settlement.resultHex, "hex"));
  const trailing = new Uint8Array(bytes.length + 1); trailing.set(bytes);
  assert.throws(() => decodeRustSettlementLocatorResultV1(trailing, request), /trailing bytes/);
  const tampered = bytes.slice(); tampered[Math.floor(tampered.length / 2)] ^= 1;
  assert.throws(() => decodeRustSettlementLocatorResultV1(tampered, request), /mismatch|invalid|inconsistent|ordered/);
  const stale = { ...request, requestHash: "0".repeat(32) } as SettlementLocatorRequestV1;
  assert.throws(() => decodeRustSettlementLocatorResultV1(bytes, stale), /authority identity mismatch/);
});

test("locator candidate artifact override rejects canonical, missing, root, and outside-public paths", async () => {
  await assert.rejects(() => resolvePublishedEngineIndexRoot("public/engine"), /public\/engine-locator-candidate/);
  await assert.rejects(() => resolvePublishedEngineIndexRoot("public"), /public\/engine-locator-candidate/);
  await assert.rejects(() => resolvePublishedEngineIndexRoot("tests"), /public\/engine-locator-candidate/);
  await assert.rejects(() => resolvePublishedEngineIndexRoot(""), /non-empty directory/);
  for (const rejected of ["public/engine-schema-candidate/../engine", "public/engine-schema-candidate/nested", "public/engine-unlisted-candidate"]) {
    await assert.rejects(() => resolvePublishedEngineIndexRoot(rejected), /public\/engine-schema-candidate/);
  }
  for (const name of ["engine-locator-candidate", "engine-schema-candidate"]) {
    if (existsSync(join(ROOT, "public", name))) {
      assert.deepEqual(await resolvePublishedEngineIndexRoot(`public/${name}`), {
        directory: await realpath(join(ROOT, "public", name)), overridden: true,
      });
    } else {
      await assert.rejects(() => resolvePublishedEngineIndexRoot(`public/${name}`), /existing directory/);
    }
  }
  assert.deepEqual(await resolvePublishedEngineIndexRoot(null), {
    directory: await realpath(join(ROOT, "public", "engine")),
    overridden: false,
  });
});
