import {
  CanonicalGenerationHasher,
  TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
  TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1,
  TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1,
  TERRAIN_LOCATOR_PROMOTION_MINIMUM_LAIR_CASES_V1,
  TERRAIN_LOCATOR_PROMOTION_MINIMUM_SETTLEMENT_CASES_V1,
  TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1,
  assertTerrainLocatorTextBoundsV1,
  assertGeneratedChunkMatchesRequestV2,
  createGeneratedChunkV2,
  decodeTerrainGenerationMarkerTableV2,
  stableTerrainGenerationJsonV2,
  type GeneratedChunkV2,
  type DragonLairLocatorRequestV1,
  type DragonLairLocatorResultV1,
  type GenerateChunkRequestV2,
  type SettlementLocatorRequestV1,
  type SettlementLocatorResultV1,
  type TerrainLocatorParityCertificateV1,
  type TerrainGenerationMarkerEntry,
  type TerrainDragonSurveyTypeV1,
  type TerrainSettlementBiomeV1,
} from "./terrain-generation-contract";
import {
  RustEngineLoader,
  type RustEngineBytes,
  type RustEngineLoaderOptions,
  type RustEngineWasmExports,
} from "./rust-engine-loader";

const REQUEST_MAGIC = [0x42, 0x57, 0x47, 0x32] as const;
const RESULT_MAGIC = [0x42, 0x57, 0x52, 0x32] as const;
const SETTLEMENT_REQUEST_MAGIC = [0x42, 0x57, 0x53, 0x51] as const;
const SETTLEMENT_RESULT_MAGIC = [0x42, 0x57, 0x53, 0x52] as const;
const LAIR_REQUEST_MAGIC = [0x42, 0x57, 0x4c, 0x51] as const;
const LAIR_RESULT_MAGIC = [0x42, 0x57, 0x4c, 0x52] as const;

export type TerrainGenerationParityCertificateV2 = Readonly<{
  generatorVersion: 18;
  generatorHash: string;
  contentHash: string;
  corpusHash: string;
  corpusCases: number;
  byteEqual: boolean;
}>;

type RustGenerationWasmExports = RustEngineWasmExports & Readonly<{
  blockwild_generate_chunk_v2(request: Uint8Array): RustEngineBytes;
  blockwild_query_settlements_v1(request: Uint8Array): RustEngineBytes;
  blockwild_query_dragon_lair_v1(request: Uint8Array): RustEngineBytes;
  blockwild_generation_parity_certificate_v2(): RustEngineBytes;
  blockwild_locator_parity_certificate_v1(): RustEngineBytes;
}>;

function bytes(value: RustEngineBytes) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function hasGenerationExports(exports: RustEngineWasmExports): exports is RustGenerationWasmExports {
  const candidate = exports as Partial<RustGenerationWasmExports>;
  return typeof candidate.blockwild_generate_chunk_v2 === "function"
    && typeof candidate.blockwild_query_settlements_v1 === "function"
    && typeof candidate.blockwild_query_dragon_lair_v1 === "function"
    && typeof candidate.blockwild_generation_parity_certificate_v2 === "function"
    && typeof candidate.blockwild_locator_parity_certificate_v1 === "function";
}

function validHash(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

export function parseTerrainGenerationParityCertificateV2(value: RustEngineBytes): TerrainGenerationParityCertificateV2 {
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes(value))) as Partial<TerrainGenerationParityCertificateV2>;
  if (parsed.generatorVersion !== 18
    || !validHash(parsed.generatorHash)
    || !validHash(parsed.contentHash)
    || !validHash(parsed.corpusHash)
    || !Number.isInteger(parsed.corpusCases)
    || Number(parsed.corpusCases) < 0
    || typeof parsed.byteEqual !== "boolean") {
    throw new Error("Rust terrain parity certificate is malformed");
  }
  return parsed as TerrainGenerationParityCertificateV2;
}

export function terrainGenerationCertificatePromotesV2(
  certificate: TerrainGenerationParityCertificateV2,
  request: GenerateChunkRequestV2,
) {
  return terrainGenerationCertificateMatchesPromotionCorpusV2(certificate)
    && certificate.generatorHash === request.generatorHash
    && certificate.contentHash === request.contentHash;
}

export function terrainGenerationCertificateMatchesPromotionCorpusV2(
  certificate: TerrainGenerationParityCertificateV2,
) {
  return certificate.generatorVersion === 18
    && certificate.byteEqual
    && certificate.corpusCases === TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2
    && certificate.corpusHash === TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2;
}

export function parseTerrainLocatorParityCertificateV1(value: RustEngineBytes): TerrainLocatorParityCertificateV1 {
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes(value))) as Partial<TerrainLocatorParityCertificateV1>;
  if (parsed.schemaVersion !== 1 || !validHash(parsed.corpusHash)
    || !Number.isInteger(parsed.settlementCases) || Number(parsed.settlementCases) < 0
    || !Number.isInteger(parsed.lairCases) || Number(parsed.lairCases) < 0
    || typeof parsed.byteEqual !== "boolean") {
    throw new Error("Rust terrain locator parity certificate is malformed");
  }
  return parsed as TerrainLocatorParityCertificateV1;
}

export function terrainLocatorCertificatePromotesV1(certificate: TerrainLocatorParityCertificateV1) {
  return certificate.byteEqual
    && certificate.corpusHash !== "0".repeat(32)
    && certificate.settlementCases >= TERRAIN_LOCATOR_PROMOTION_MINIMUM_SETTLEMENT_CASES_V1
    && certificate.lairCases >= TERRAIN_LOCATOR_PROMOTION_MINIMUM_LAIR_CASES_V1
    && certificate.corpusHash === TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1
    && certificate.settlementCases === TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1
    && certificate.lairCases === TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1;
}

class WireWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  constructor(magic: readonly number[]) { this.raw(new Uint8Array(magic)); }

  private raw(value: Uint8Array) { this.chunks.push(value); this.length += value.byteLength; }
  u8(value: number) { this.raw(Uint8Array.of(value & 0xff)); }
  u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); this.raw(bytes); }
  u32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value >>> 0, true); this.raw(bytes); }
  i32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setInt32(0, value, true); this.raw(bytes); }
  i64(value: bigint) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigInt64(0, value, true); this.raw(bytes); }
  u64(value: bigint) {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(0, BigInt.asUintN(64, value), true);
    this.raw(bytes);
  }
  string(value: string) { const encoded = new TextEncoder().encode(value); this.u32(encoded.byteLength); this.raw(encoded); }
  finish() { const result = new Uint8Array(this.length); let offset = 0; for (const chunk of this.chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result; }
}

class WireReader {
  private readonly view: DataView;
  private offset = 4;

  constructor(private readonly value: Uint8Array, magic: readonly number[]) {
    this.view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    if (value.byteLength < 4 || magic.some((byte, index) => value[index] !== byte)) throw new Error("Rust terrain packet has invalid magic");
  }

  private take(length: number) {
    const end = this.offset + length;
    if (!Number.isSafeInteger(end) || end > this.value.byteLength) throw new Error("Rust terrain packet is truncated");
    const result = this.value.subarray(this.offset, end);
    this.offset = end;
    return result;
  }

  u16() { const offset = this.offset; this.take(2); return this.view.getUint16(offset, true); }
  u8() { return this.take(1)[0]; }
  i16() { const offset = this.offset; this.take(2); return this.view.getInt16(offset, true); }
  u32() { const offset = this.offset; this.take(4); return this.view.getUint32(offset, true); }
  i32() { const offset = this.offset; this.take(4); return this.view.getInt32(offset, true); }
  u64() { const offset = this.offset; this.take(8); return this.view.getBigUint64(offset, true); }
  count(maximum: number) { const value = this.u32(); if (value > maximum) throw new Error("Rust terrain collection exceeds wire bound"); return value; }
  string() { return new TextDecoder("utf-8", { fatal: true }).decode(this.take(this.count(1 << 20))); }
  u8Array(maximum: number) { return Uint8Array.from(this.take(this.count(maximum))); }
  u16Array(maximum: number) { const result = new Uint16Array(this.count(maximum)); for (let index = 0; index < result.length; index += 1) result[index] = this.u16(); return result; }
  i16Array(maximum: number) { const result = new Int16Array(this.count(maximum)); for (let index = 0; index < result.length; index += 1) result[index] = this.i16(); return result; }
  u32Array(maximum: number) { const result = new Uint32Array(this.count(maximum)); for (let index = 0; index < result.length; index += 1) result[index] = this.u32(); return result; }
  done() { if (this.offset !== this.value.byteLength) throw new Error("Rust terrain packet contains trailing bytes"); }
}

function writeOptionalLocatorList(writer: WireWriter, values: readonly string[] | undefined) {
  writer.u8(values === undefined ? 0 : 1);
  if (values === undefined) return;
  writer.u8(values.length);
  for (const value of values) writer.string(value);
}

export function encodeRustSettlementLocatorRequestV1(request: SettlementLocatorRequestV1) {
  assertTerrainLocatorTextBoundsV1(request.seedText, request.optionsJson);
  const writer = new WireWriter(SETTLEMENT_REQUEST_MAGIC);
  writer.u16(request.schemaVersion);
  writer.string(request.seedText);
  writer.string(request.optionsJson);
  writer.i64(request.originXMillis);
  writer.i64(request.originZMillis);
  writeOptionalLocatorList(writer, request.factionIds);
  writeOptionalLocatorList(writer, request.sizes);
  writeOptionalLocatorList(writer, request.environments);
  writer.u16(request.excludeIds.length);
  for (const value of request.excludeIds) writer.string(value);
  writer.u16(request.maxRegionRadius);
  writer.u8(request.limit);
  writer.u8(request.breathesWater ? 1 : 0);
  writer.string(request.requestHash);
  return writer.finish();
}

function hashSettlementLocatorResultV1(requestHash: string, entries: SettlementLocatorResultV1["entries"]) {
  const hasher = new CanonicalGenerationHasher("blockwild-settlement-query-result-v1");
  hasher.writeString(requestHash);
  hasher.writeU16(entries.length);
  for (const entry of entries) {
    hasher.writeString(entry.id);
    hasher.writeString(entry.factionId);
    hasher.writeString(entry.size);
    hasher.writeString(entry.environment);
    hasher.writeString(entry.biome);
    hasher.writeI32(entry.regionX);
    hasher.writeI32(entry.regionZ);
    hasher.writeI32(entry.x);
    hasher.writeI32(entry.z);
    hasher.writeU16(entry.floorY === null ? 0 : 1);
    if (entry.floorY !== null) hasher.writeI32(entry.floorY);
    hasher.writeU64(entry.distanceSquaredMillis);
    hasher.writeI32(entry.publicArrival!.x);
    hasher.writeI32(entry.publicArrival!.yMillis);
    hasher.writeI32(entry.publicArrival!.z);
    hasher.writeString(entry.publicArrival!.anchorKind);
  }
  return hasher.finish();
}

const SETTLEMENT_FACTIONS = new Set(["atlantians", "dwarves", "goblins", "hobbits", "sugarcourt", "wood-elves"]);
const SETTLEMENT_SIZES = new Set(["hamlet", "town", "village"]);
const SETTLEMENT_ENVIRONMENTS = new Set(["surface", "underground", "underwater"]);
const SETTLEMENT_BIOMES = new Set(["badlands", "cloudreed-glen", "deep-ocean", "flower-meadow", "forest",
  "glimmerwood", "highlands", "lumen-trench", "snowcap-range", "sugarplum-vale", "wildwood"]);
const ARRIVAL_KINDS = new Set(["public-approach", "reef-air-arrival", "surface-entry"]);
const canonicalLocatorId = (value: string) => /^[a-z0-9:_-]+$/.test(value) && value.length <= 128;
const LOCATOR_MILLIS_PER_BLOCK = BigInt(1_000);
const LOCATOR_ZERO = BigInt(0);
const PLANNER_HASH_DENOMINATOR = 4_294_967_296;
const SETTLEMENT_REGION_BLOCKS = 512;
const SETTLEMENT_MAX_ARRIVAL_OFFSET = 59;
const SETTLEMENT_SITE_WINDOWS = Object.freeze([[57, 102], [169, 214], [281, 326], [393, 438]] as const);
const TERRESTRIAL_LAIR_REGION_BLOCKS = 704;
const SEA_LAIR_REGION_BLOCKS = 768;

type SettlementLocatorEntryV1 = SettlementLocatorResultV1["entries"][number];
type DragonLairLocatorEntryV1 = NonNullable<DragonLairLocatorResultV1["entry"]>;

const SETTLEMENT_RULES = Object.freeze({
  atlantians: Object.freeze({ prefix: "tidehold", environment: "underwater", biomes: new Set(["deep-ocean", "lumen-trench"]) }),
  dwarves: Object.freeze({ prefix: "deepgear-hold", environment: "underground",
    biomes: new Set(["badlands", "cloudreed-glen", "highlands", "snowcap-range"]) }),
  goblins: Object.freeze({ prefix: "clanhold", environment: "surface",
    biomes: new Set(["badlands", "cloudreed-glen", "highlands"]) }),
  hobbits: Object.freeze({ prefix: "freehold", environment: "surface",
    biomes: new Set(["flower-meadow", "forest", "wildwood"]) }),
  sugarcourt: Object.freeze({ prefix: "bonbon-borough", environment: "surface", biomes: new Set(["sugarplum-vale"]) }),
  "wood-elves": Object.freeze({ prefix: "moonbough-enclave", environment: "surface", biomes: new Set(["glimmerwood"]) }),
} as const);

function plannerHash32(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function plannerUnit(seed: string, salt: string) {
  return plannerHash32(`${seed}|${salt}`) / PLANNER_HASH_DENOMINATOR;
}

function dragonPlannerUnit(seed: string, salt: string) {
  let value = plannerHash32(`${seed}|${salt}`);
  value = Math.imul(value ^ (value >>> 15), 2_246_822_519);
  value = Math.imul(value ^ (value >>> 13), 3_266_489_917);
  return ((value ^ (value >>> 16)) >>> 0) / PLANNER_HASH_DENOMINATOR;
}

function floorDivBigInt(value: bigint, divisor: bigint) {
  const quotient = value / divisor;
  return value % divisor < LOCATOR_ZERO ? quotient - BigInt(1) : quotient;
}

function originRegion(originMillis: bigint, regionBlocks: number) {
  return Number(floorDivBigInt(originMillis, BigInt(regionBlocks) * LOCATOR_MILLIS_PER_BLOCK));
}

function withinRequestedRegion(
  regionX: number,
  regionZ: number,
  request: Pick<SettlementLocatorRequestV1 | DragonLairLocatorRequestV1,
  "originXMillis" | "originZMillis" | "maxRegionRadius">,
  regionBlocks: number,
) {
  const originX = originRegion(request.originXMillis, regionBlocks);
  const originZ = originRegion(request.originZMillis, regionBlocks);
  return Number.isSafeInteger(originX) && Number.isSafeInteger(originZ)
    && Math.max(Math.abs(regionX - originX), Math.abs(regionZ - originZ)) <= request.maxRegionRadius;
}

function expectedSettlementId(entry: SettlementLocatorEntryV1, seed: string) {
  const rule = SETTLEMENT_RULES[entry.factionId];
  const suffix = plannerHash32(`${seed}|${entry.regionX}|${entry.regionZ}|${entry.factionId}`).toString(36);
  return `${rule.prefix}-${entry.regionX.toString(36)}-${entry.regionZ.toString(36)}-${suffix}`;
}

function legalSettlementSiteCoordinate(value: number, region: number) {
  const local = value - region * SETTLEMENT_REGION_BLOCKS;
  return SETTLEMENT_SITE_WINDOWS.some(([minimum, maximum]) => local >= minimum && local <= maximum);
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function settlementPlannerSemanticsMatch(entry: SettlementLocatorEntryV1, request: SettlementLocatorRequestV1) {
  const rule = SETTLEMENT_RULES[entry.factionId];
  if (!rule || entry.environment !== rule.environment || !rule.biomes.has(entry.biome as never)
    || entry.id !== expectedSettlementId(entry, request.seedText)
    || !withinRequestedRegion(entry.regionX, entry.regionZ, request, SETTLEMENT_REGION_BLOCKS)
    || !legalSettlementSiteCoordinate(entry.x, entry.regionX)
    || !legalSettlementSiteCoordinate(entry.z, entry.regionZ)) return false;

  if (entry.environment === "surface") {
    if (entry.floorY !== null) return false;
  } else if (entry.environment === "underwater") {
    if (entry.floorY === null || entry.floorY < -57 || entry.floorY > 26) return false;
  } else if (entry.floorY === null || entry.floorY < -54 || entry.floorY > 101) return false;

  const arrival = entry.publicArrival;
  if (!arrival || Math.abs(arrival.x - entry.x) > SETTLEMENT_MAX_ARRIVAL_OFFSET
    || Math.abs(arrival.z - entry.z) > SETTLEMENT_MAX_ARRIVAL_OFFSET) return false;
  const underwaterBreather = entry.environment === "underwater" && request.breathesWater;
  const expectedAnchor = entry.environment === "underground" ? "surface-entry"
    : entry.environment === "underwater" && !request.breathesWater ? "reef-air-arrival"
      : "public-approach";
  const expectedYRemainder = underwaterBreather ? 0 : 510;
  const yWithinWorldEnvelope = underwaterBreather
    ? arrival.yMillis >= -55_000 && arrival.yMillis <= 32_000
    : arrival.yMillis >= -55_490 && arrival.yMillis <= 120_510;
  return arrival.anchorKind === expectedAnchor
    && positiveModulo(arrival.yMillis, 1_000) === expectedYRemainder
    && (entry.environment !== "underwater" || request.breathesWater || arrival.yMillis === 33_510)
    && yWithinWorldEnvelope;
}

function terrestrialDragonType(seed: string, regionX: number, regionZ: number) {
  const roll = dragonPlannerUnit(seed, `dragon-type:${regionX},${regionZ}`);
  return roll < 0.31 ? "fire" : roll < 0.62 ? "ice" : roll < 0.93 ? "steel" : roll < 0.965 ? "gold" : "silver";
}

function terrestrialLairSemanticsMatch(entry: DragonLairLocatorEntryV1, request: DragonLairLocatorRequestV1) {
  const regionX = Math.floor(entry.x / TERRESTRIAL_LAIR_REGION_BLOCKS);
  const regionZ = Math.floor(entry.z / TERRESTRIAL_LAIR_REGION_BLOCKS);
  const expectedX = regionX * TERRESTRIAL_LAIR_REGION_BLOCKS + 112
    + Math.floor(dragonPlannerUnit(request.seedText, `dragon-lair-x:${regionX},${regionZ}`) * 480);
  const expectedZ = regionZ * TERRESTRIAL_LAIR_REGION_BLOCKS + 112
    + Math.floor(dragonPlannerUnit(request.seedText, `dragon-lair-z:${regionX},${regionZ}`) * 480);
  const expectedStage = dragonPlannerUnit(request.seedText, `dragon-lair-stage:${regionX},${regionZ}`) < 0.22 ? 5 : 4;
  const expectedSex = dragonPlannerUnit(request.seedText, `dragon-lair-sex:${regionX},${regionZ}`) < 0.5 ? "female" : "male";
  const expectedType = terrestrialDragonType(request.seedText, regionX, regionZ);
  return dragonPlannerUnit(request.seedText, `dragon-lair-present:${regionX},${regionZ}`) >= 0.29
    && withinRequestedRegion(regionX, regionZ, request, TERRESTRIAL_LAIR_REGION_BLOCKS)
    && entry.id === `dragon-lair:${expectedType}:${regionX}:${regionZ}`
    && entry.dragonType === expectedType
    && entry.stage === expectedStage
    && entry.sex === expectedSex
    && entry.x === expectedX && entry.z === expectedZ
    && entry.y >= -46 && entry.y <= -16;
}

function seaPlannerUnit(salt: string, field: string) {
  return plannerUnit(salt, field);
}

function seaLairSemanticsMatch(entry: DragonLairLocatorEntryV1, request: DragonLairLocatorRequestV1) {
  const regionX = Math.floor(entry.x / SEA_LAIR_REGION_BLOCKS);
  const regionZ = Math.floor(entry.z / SEA_LAIR_REGION_BLOCKS);
  const salt = `${request.seedText}|sea-dragon-nest|${regionX}|${regionZ}`;
  const expectedStage = seaPlannerUnit(salt, "stage") < 0.54 ? 3 : seaPlannerUnit(salt, "stage") < 0.9 ? 4 : 5;
  const expectedSex = seaPlannerUnit(salt, "sex") < 0.56 ? "female" : "male";
  const expectedX = regionX * SEA_LAIR_REGION_BLOCKS + 128 + Math.floor(seaPlannerUnit(salt, "x") * 512);
  const expectedZ = regionZ * SEA_LAIR_REGION_BLOCKS + 128 + Math.floor(seaPlannerUnit(salt, "z") * 512);
  const expectedId = `sea-nest-${regionX.toString(36)}-${regionZ.toString(36)}-${plannerHash32(salt).toString(36)}`;
  return seaPlannerUnit(salt, "rarity") < 0.115
    && withinRequestedRegion(regionX, regionZ, request, SEA_LAIR_REGION_BLOCKS)
    && entry.id === expectedId && entry.dragonType === "sea"
    && entry.stage === expectedStage && entry.sex === expectedSex
    && entry.x === expectedX && entry.z === expectedZ
    && entry.y >= -58 && entry.y <= 10;
}

function dragonLairPlannerSemanticsMatch(entry: DragonLairLocatorEntryV1, request: DragonLairLocatorRequestV1) {
  return request.dragonType === "sea"
    ? seaLairSemanticsMatch(entry, request)
    : terrestrialLairSemanticsMatch(entry, request);
}

export function decodeRustSettlementLocatorResultV1(
  value: RustEngineBytes,
  request: SettlementLocatorRequestV1,
): SettlementLocatorResultV1 {
  const reader = new WireReader(bytes(value), SETTLEMENT_RESULT_MAGIC);
  const schemaVersion = reader.u16();
  const requestHash = reader.string();
  const count = reader.u8();
  if (count > 32) throw new Error("Rust settlement locator result exceeds wire bound");
  const entries: SettlementLocatorResultV1["entries"][number][] = [];
  for (let index = 0; index < count; index += 1) {
    const id = reader.string();
    const factionId = reader.string() as SettlementLocatorResultV1["entries"][number]["factionId"];
    const size = reader.string() as SettlementLocatorResultV1["entries"][number]["size"];
    const environment = reader.string() as SettlementLocatorResultV1["entries"][number]["environment"];
    const biome = reader.string() as TerrainSettlementBiomeV1;
    const regionX = reader.i32();
    const regionZ = reader.i32();
    const x = reader.i32();
    const z = reader.i32();
    const floorPresent = reader.u8();
    if (floorPresent > 1) throw new Error("Rust settlement locator floor flag is invalid");
    const floorY = floorPresent ? reader.i32() : null;
    const distanceSquaredMillis = reader.u64();
    const publicArrival = {
      x: reader.i32(), yMillis: reader.i32(), z: reader.i32(), anchorKind: reader.string(),
    };
    entries.push(Object.freeze({ id, factionId, size, environment, biome, regionX, regionZ, x, z,
      floorY, distanceSquaredMillis, publicArrival: Object.freeze(publicArrival) }));
  }
  const resultHash = reader.string();
  reader.done();
  if (schemaVersion !== request.schemaVersion || requestHash !== request.requestHash) {
    throw new Error("Rust settlement locator result authority identity mismatch");
  }
  if (entries.length > request.limit) throw new Error("Rust settlement locator returned too many entries");
  const excluded = new Set(request.excludeIds);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!canonicalLocatorId(entry.id) || excluded.has(entry.id)
      || !SETTLEMENT_FACTIONS.has(entry.factionId) || !SETTLEMENT_SIZES.has(entry.size)
      || !SETTLEMENT_ENVIRONMENTS.has(entry.environment)
      || !SETTLEMENT_BIOMES.has(entry.biome)
      || request.factionIds && !request.factionIds.includes(entry.factionId)
      || request.sizes && !request.sizes.includes(entry.size)
      || request.environments && !request.environments.includes(entry.environment)
      || !Number.isSafeInteger(entry.regionX) || !Number.isSafeInteger(entry.regionZ)
      || !Number.isSafeInteger(entry.x) || !Number.isSafeInteger(entry.z)
      || entry.floorY !== null && (!Number.isSafeInteger(entry.floorY) || entry.floorY < -64 || entry.floorY > 127)
      || !entry.publicArrival || !ARRIVAL_KINDS.has(entry.publicArrival.anchorKind)
        || !Number.isSafeInteger(entry.publicArrival.x) || !Number.isSafeInteger(entry.publicArrival.yMillis)
        || !Number.isSafeInteger(entry.publicArrival.z)) {
      throw new Error("Rust settlement locator returned a semantically invalid entry");
    }
    if (!settlementPlannerSemanticsMatch(entry, request)) {
      throw new Error("Rust settlement locator returned planner-inconsistent geometry");
    }
    const deltaX = BigInt(entry.x) * BigInt(1_000) - request.originXMillis;
    const deltaZ = BigInt(entry.z) * BigInt(1_000) - request.originZMillis;
    if (entry.distanceSquaredMillis !== deltaX * deltaX + deltaZ * deltaZ) {
      throw new Error("Rust settlement locator distance is inconsistent with its coordinates");
    }
    if (index > 0) {
      const previous = entries[index - 1];
      if (entry.distanceSquaredMillis < previous.distanceSquaredMillis
        || entry.distanceSquaredMillis === previous.distanceSquaredMillis && entry.id <= previous.id) {
        throw new Error("Rust settlement locator entries are not canonically ordered and unique");
      }
    }
  }
  if (hashSettlementLocatorResultV1(requestHash, entries) !== resultHash) {
    throw new Error("Rust settlement locator result hash mismatch");
  }
  return Object.freeze({ schemaVersion: request.schemaVersion, epoch: request.epoch, taskId: request.taskId,
    requestHash, entries: Object.freeze(entries), resultHash });
}

export function encodeRustDragonLairLocatorRequestV1(request: DragonLairLocatorRequestV1) {
  assertTerrainLocatorTextBoundsV1(request.seedText, request.optionsJson);
  const writer = new WireWriter(LAIR_REQUEST_MAGIC);
  writer.u16(request.schemaVersion);
  writer.string(request.seedText);
  writer.string(request.optionsJson);
  writer.i64(request.originXMillis);
  writer.i64(request.originZMillis);
  writer.string(request.dragonType);
  writer.u8(request.minimumStage);
  writer.u16(request.excludeIds.length);
  for (const value of request.excludeIds) writer.string(value);
  writer.u16(request.maxRegionRadius);
  writer.string(request.requestHash);
  return writer.finish();
}

function hashDragonLairLocatorResultV1(requestHash: string, entry: DragonLairLocatorResultV1["entry"]) {
  const hasher = new CanonicalGenerationHasher("blockwild-lair-query-result-v1");
  hasher.writeString(requestHash);
  hasher.writeU16(entry ? 1 : 0);
  if (entry) {
    hasher.writeString(entry.id);
    hasher.writeString(entry.dragonType);
    hasher.writeU16(entry.stage);
    hasher.writeString(entry.sex);
    hasher.writeI32(entry.x);
    hasher.writeI32(entry.y);
    hasher.writeI32(entry.z);
    hasher.writeU64(entry.distanceSquaredMillis);
  }
  return hasher.finish();
}

export function decodeRustDragonLairLocatorResultV1(
  value: RustEngineBytes,
  request: DragonLairLocatorRequestV1,
): DragonLairLocatorResultV1 {
  const reader = new WireReader(bytes(value), LAIR_RESULT_MAGIC);
  const schemaVersion = reader.u16();
  const requestHash = reader.string();
  const present = reader.u8();
  if (present > 1) throw new Error("Rust dragon-lair locator result flag is invalid");
  const entry = present ? Object.freeze({
    id: reader.string(),
    dragonType: reader.string() as TerrainDragonSurveyTypeV1,
    stage: reader.u8() as 3 | 4 | 5,
    sex: reader.string() as "female" | "male",
    x: reader.i32(), y: reader.i32(), z: reader.i32(),
    distanceSquaredMillis: reader.u64(),
  }) : null;
  const resultHash = reader.string();
  reader.done();
  if (schemaVersion !== request.schemaVersion || requestHash !== request.requestHash) {
    throw new Error("Rust dragon-lair locator result authority identity mismatch");
  }
  if (entry && (!canonicalLocatorId(entry.id) || request.excludeIds.includes(entry.id)
    || entry.dragonType !== request.dragonType || entry.stage < request.minimumStage || entry.stage > 5
    || !["female", "male"].includes(entry.sex)
    || !Number.isSafeInteger(entry.x) || !Number.isSafeInteger(entry.y) || !Number.isSafeInteger(entry.z))) {
    throw new Error("Rust dragon-lair locator returned a semantically invalid entry");
  }
  if (entry) {
    if (!dragonLairPlannerSemanticsMatch(entry, request)) {
      throw new Error("Rust dragon-lair locator returned planner-inconsistent geometry");
    }
    const deltaX = BigInt(entry.x) * BigInt(1_000) - request.originXMillis;
    const deltaZ = BigInt(entry.z) * BigInt(1_000) - request.originZMillis;
    if (entry.distanceSquaredMillis !== deltaX * deltaX + deltaZ * deltaZ) {
      throw new Error("Rust dragon-lair locator distance is inconsistent with its coordinates");
    }
  }
  if (hashDragonLairLocatorResultV1(requestHash, entry) !== resultHash) {
    throw new Error("Rust dragon-lair locator result hash mismatch");
  }
  return Object.freeze({ schemaVersion: request.schemaVersion, epoch: request.epoch, taskId: request.taskId,
    requestHash, entry, resultHash });
}

export function encodeRustTerrainGenerationRequestV2(request: GenerateChunkRequestV2) {
  const writer = new WireWriter(REQUEST_MAGIC);
  writer.u16(request.protocolVersion);
  writer.u16(request.schemaVersion);
  writer.u32(request.epoch);
  writer.u32(request.taskId);
  writer.u32(request.revision);
  for (const value of [
    request.namespace,
    request.contentHash,
    request.generatorHash,
    request.seedText,
    stableTerrainGenerationJsonV2(request.generationOptions),
    request.key,
  ]) writer.string(value);
  writer.i32(request.cx);
  writer.i32(request.cz);
  writer.u32(request.edits.length / 2);
  for (let index = 0; index < request.edits.length; index += 2) {
    writer.u32(request.edits[index]);
    writer.u16(request.edits[index + 1]);
  }
  writer.string(request.requestHash);
  return writer.finish();
}

export function decodeRustTerrainGenerationResultV2(value: RustEngineBytes, request: GenerateChunkRequestV2) {
  const reader = new WireReader(bytes(value), RESULT_MAGIC);
  const protocolVersion = reader.u16();
  const schemaVersion = reader.u16();
  const epoch = reader.u32();
  const taskId = reader.u32();
  const revision = reader.u32();
  const namespace = reader.string();
  const contentHash = reader.string();
  const generatorHash = reader.string();
  const requestHash = reader.string();
  const key = reader.string();
  const cx = reader.i32();
  const cz = reader.i32();
  const blocks = reader.u16Array(49_152);
  const heightmap = reader.i16Array(256);
  const biomes = reader.u8Array(256);
  const sectionBlockCounts = reader.u16Array(12);
  const skyTops = reader.i16Array(256);
  const light = reader.u16Array(49_152);
  const lightIndices = reader.u32Array(49_152);
  const leafIndices = reader.u32Array(49_152);
  const markerCount = reader.count(16_384);
  const structureMarkers: TerrainGenerationMarkerEntry[] = [];
  for (let index = 0; index < markerCount; index += 1) {
    const markerKey = reader.string();
    const row = JSON.parse(reader.string()) as TerrainGenerationMarkerEntry;
    if (row[0] !== markerKey) throw new Error("Rust terrain marker key disagrees with canonical row");
    structureMarkers.push(row);
  }
  const rustChunkHash = reader.string();
  reader.done();
  for (const [field, actual, expected] of [
    ["protocolVersion", protocolVersion, request.protocolVersion],
    ["schemaVersion", schemaVersion, request.schemaVersion],
    ["epoch", epoch, request.epoch], ["taskId", taskId, request.taskId], ["revision", revision, request.revision],
    ["namespace", namespace, request.namespace], ["contentHash", contentHash, request.contentHash],
    ["generatorHash", generatorHash, request.generatorHash], ["requestHash", requestHash, request.requestHash],
    ["key", key, request.key], ["cx", cx, request.cx], ["cz", cz, request.cz],
  ] as const) if (actual !== expected) throw new Error(`Rust terrain ${field} mismatch`);
  const chunk = createGeneratedChunkV2(request, {
    key, cx, cz, blocks, heightmap, biomes, sectionBlockCounts, skyTops, light, lightIndices, leafIndices, structureMarkers,
  });
  if (chunk.chunkHash !== rustChunkHash) throw new Error("Rust terrain chunk hash does not match browser canonical hash");
  assertGeneratedChunkMatchesRequestV2(chunk, request);
  return chunk;
}

export class RustTerrainGenerationBridgeV2 {
  private readonly loader: RustEngineLoader;
  private exports: RustGenerationWasmExports | null = null;
  private certificate: TerrainGenerationParityCertificateV2 | null = null;
  private locatorCertificate: TerrainLocatorParityCertificateV1 | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(options: RustEngineLoaderOptions = {}) { this.loader = new RustEngineLoader(options); }

  initialize() {
    this.loadPromise ??= this.loader.load().then((loaded) => {
      if (!hasGenerationExports(loaded.exports)) throw new Error("Rust engine artifact does not contain terrain generation exports");
      this.exports = loaded.exports;
      this.certificate = parseTerrainGenerationParityCertificateV2(loaded.exports.blockwild_generation_parity_certificate_v2());
      this.locatorCertificate = parseTerrainLocatorParityCertificateV1(loaded.exports.blockwild_locator_parity_certificate_v1());
      if (!terrainGenerationCertificateMatchesPromotionCorpusV2(this.certificate)) {
        throw new Error("Rust terrain generation parity certificate does not match the exact promotion corpus");
      }
      if (!terrainLocatorCertificatePromotesV1(this.locatorCertificate)) {
        throw new Error("Rust terrain locator parity certificate does not match the exact promotion corpus");
      }
    });
    return this.loadPromise;
  }

  async querySettlements(request: SettlementLocatorRequestV1) {
    await this.initialize();
    if (!this.exports || !this.locatorCertificate || !terrainLocatorCertificatePromotesV1(this.locatorCertificate)) {
      throw new Error("Rust settlement locator authority is unavailable");
    }
    return decodeRustSettlementLocatorResultV1(
      this.exports.blockwild_query_settlements_v1(encodeRustSettlementLocatorRequestV1(request)), request,
    );
  }

  async queryDragonLair(request: DragonLairLocatorRequestV1) {
    await this.initialize();
    if (!this.exports || !this.locatorCertificate || !terrainLocatorCertificatePromotesV1(this.locatorCertificate)) {
      throw new Error("Rust dragon-lair locator authority is unavailable");
    }
    return decodeRustDragonLairLocatorResultV1(
      this.exports.blockwild_query_dragon_lair_v1(encodeRustDragonLairLocatorRequestV1(request)), request,
    );
  }

  async generate(request: GenerateChunkRequestV2): Promise<GeneratedChunkV2> {
    await this.initialize();
    if (!this.exports || !this.certificate) throw new Error("Rust terrain generation bridge is not initialized");
    if (!terrainGenerationCertificatePromotesV2(this.certificate, request)) {
      throw new Error("Rust terrain generation is shadow-only until generator v18 byte parity is certified");
    }
    return decodeRustTerrainGenerationResultV2(this.exports.blockwild_generate_chunk_v2(encodeRustTerrainGenerationRequestV2(request)), request);
  }

  diagnostics() {
    return { loader: this.loader.diagnostics(), certificate: this.certificate, locatorCertificate: this.locatorCertificate,
      authoritative: Boolean(this.certificate && this.locatorCertificate
        && terrainGenerationCertificateMatchesPromotionCorpusV2(this.certificate)
        && terrainLocatorCertificatePromotesV1(this.locatorCertificate)) } as const;
  }
}

/** Test/debug helper: canonical marker rows without importing `world.ts`. */
export function markerRowsV2(chunk: GeneratedChunkV2) {
  return decodeTerrainGenerationMarkerTableV2(chunk.markerTable);
}
