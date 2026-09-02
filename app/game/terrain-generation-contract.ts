import type { StructureMarker } from "./structures";

/** Renderer-neutral, transfer-safe whole-chunk generation boundary for R3. */
export const TERRAIN_GENERATION_PROTOCOL_V2 = 2 as const;
export const GENERATE_CHUNK_REQUEST_SCHEMA_V2 = 2 as const;
export const GENERATED_CHUNK_SCHEMA_V2 = 2 as const;
export const TERRAIN_GENERATION_CHUNK_SIZE_V2 = 16 as const;
export const TERRAIN_GENERATION_WORLD_HEIGHT_V2 = 192 as const;
export const TERRAIN_GENERATION_SECTION_HEIGHT_V2 = 16 as const;
export const TERRAIN_GENERATION_CELL_COUNT_V2 = TERRAIN_GENERATION_CHUNK_SIZE_V2
  * TERRAIN_GENERATION_CHUNK_SIZE_V2 * TERRAIN_GENERATION_WORLD_HEIGHT_V2;
export const TERRAIN_GENERATION_COLUMN_COUNT_V2 = TERRAIN_GENERATION_CHUNK_SIZE_V2 ** 2;
export const TERRAIN_GENERATION_SECTION_COUNT_V2 = TERRAIN_GENERATION_WORLD_HEIGHT_V2
  / TERRAIN_GENERATION_SECTION_HEIGHT_V2;
export const TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2 = 155 as const;
export const TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2 = "5d4e6b1445b00f3430164d1a8093d8dc" as const;
export const TERRAIN_LOCATOR_SCHEMA_V1 = 1 as const;
export const TERRAIN_LOCATOR_MAX_EXCLUSIONS_V1 = 4_096 as const;
export const TERRAIN_LOCATOR_MAX_SETTLEMENT_RESULTS_V1 = 32 as const;
export const TERRAIN_LOCATOR_MAX_ORIGIN_MILLIS_V1 = BigInt("2147400000000");
export const TERRAIN_LOCATOR_MAX_SEED_BYTES_V1 = 2_048 as const;
export const TERRAIN_LOCATOR_MAX_OPTIONS_BYTES_V1 = 8_192 as const;
/** Immutable identity recomputed by the checked-in TypeScript/native locator corpus and candidate Wasm gate. */
export const TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1 = "85d6e080c27222b8d06d25812d7d5535" as const;
export const TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1 = 114 as const;
export const TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1 = 16 as const;
export const TERRAIN_LOCATOR_PROMOTION_MINIMUM_SETTLEMENT_CASES_V1 = 24 as const;
export const TERRAIN_LOCATOR_PROMOTION_MINIMUM_LAIR_CASES_V1 = 12 as const;

export type TerrainSettlementFactionV1 = "atlantians" | "dwarves" | "goblins" | "hobbits" | "sugarcourt" | "wood-elves";
export type TerrainSettlementSizeV1 = "hamlet" | "town" | "village";
export type TerrainSettlementEnvironmentV1 = "surface" | "underground" | "underwater";
export type TerrainSettlementBiomeV1 = "badlands" | "cloudreed-glen" | "deep-ocean" | "flower-meadow"
  | "forest" | "glimmerwood" | "highlands" | "lumen-trench" | "snowcap-range" | "sugarplum-vale" | "wildwood";
export type TerrainDragonSurveyTypeV1 = "fire" | "gold" | "ice" | "sea" | "silver" | "steel";

export type SettlementLocatorRequestV1 = Readonly<{
  schemaVersion: typeof TERRAIN_LOCATOR_SCHEMA_V1;
  epoch: number;
  taskId: number;
  seedText: string;
  optionsJson: string;
  originXMillis: bigint;
  originZMillis: bigint;
  factionIds?: readonly TerrainSettlementFactionV1[];
  sizes?: readonly TerrainSettlementSizeV1[];
  environments?: readonly TerrainSettlementEnvironmentV1[];
  excludeIds: readonly string[];
  maxRegionRadius: number;
  limit: number;
  breathesWater: boolean;
  requestHash: string;
}>;

export type SettlementLocatorResultV1 = Readonly<{
  schemaVersion: typeof TERRAIN_LOCATOR_SCHEMA_V1;
  epoch: number;
  taskId: number;
  requestHash: string;
  entries: readonly Readonly<{
    id: string;
    factionId: TerrainSettlementFactionV1;
    size: TerrainSettlementSizeV1;
    environment: TerrainSettlementEnvironmentV1;
    biome: TerrainSettlementBiomeV1;
    regionX: number;
    regionZ: number;
    x: number;
    z: number;
    floorY: number | null;
    distanceSquaredMillis: bigint;
    publicArrival: Readonly<{ x: number; yMillis: number; z: number; anchorKind: string }> | null;
  }>[];
  resultHash: string;
}>;

export type DragonLairLocatorRequestV1 = Readonly<{
  schemaVersion: typeof TERRAIN_LOCATOR_SCHEMA_V1;
  epoch: number;
  taskId: number;
  seedText: string;
  optionsJson: string;
  originXMillis: bigint;
  originZMillis: bigint;
  dragonType: TerrainDragonSurveyTypeV1;
  minimumStage: 3 | 4 | 5;
  excludeIds: readonly string[];
  maxRegionRadius: number;
  requestHash: string;
}>;

export type DragonLairLocatorResultV1 = Readonly<{
  schemaVersion: typeof TERRAIN_LOCATOR_SCHEMA_V1;
  epoch: number;
  taskId: number;
  requestHash: string;
  entry: Readonly<{
    id: string;
    dragonType: TerrainDragonSurveyTypeV1;
    stage: 3 | 4 | 5;
    sex: "female" | "male";
    x: number;
    y: number;
    z: number;
    distanceSquaredMillis: bigint;
  }> | null;
  resultHash: string;
}>;

export type TerrainLocatorParityCertificateV1 = Readonly<{
  schemaVersion: typeof TERRAIN_LOCATOR_SCHEMA_V1;
  corpusHash: string;
  settlementCases: number;
  lairCases: number;
  byteEqual: boolean;
}>;

export type TerrainGenerationEditPair = readonly [index: number, blockType: number];
export type TerrainGenerationMarkerEntry = readonly [key: string, marker: StructureMarker];

export type GenerateChunkRequestV2 = Readonly<{
  protocolVersion: typeof TERRAIN_GENERATION_PROTOCOL_V2;
  schemaVersion: typeof GENERATE_CHUNK_REQUEST_SCHEMA_V2;
  /** Worker generation. A restart or authority reset invalidates older epochs. */
  epoch: number;
  /** Pipeline-unique task identity within an epoch. */
  taskId: number;
  /** Authoritative chunk/edit revision. */
  revision: number;
  namespace: string;
  contentHash: string;
  generatorHash: string;
  seedText: string;
  generationOptions: Readonly<Record<string, unknown>>;
  key: string;
  cx: number;
  cz: number;
  /** Sorted unique [cell index, block ID] u32 pairs. */
  edits: Uint32Array;
  /** Canonical checksum over every preceding request field and edit byte. */
  requestHash: string;
}>;

export type GenerateChunkRequestV2Input = Omit<GenerateChunkRequestV2,
  "protocolVersion" | "schemaVersion" | "edits" | "requestHash"
> & Readonly<{ edits: Uint32Array | readonly TerrainGenerationEditPair[] }>;

/** UTF-8 rows containing canonical JSON [marker key, marker] tuples. */
export type TerrainGenerationMarkerTableV2 = Readonly<{
  offsets: Uint32Array;
  bytes: Uint8Array;
}>;

export type GeneratedChunkV2 = Readonly<{
  protocolVersion: typeof TERRAIN_GENERATION_PROTOCOL_V2;
  schemaVersion: typeof GENERATED_CHUNK_SCHEMA_V2;
  epoch: number;
  taskId: number;
  revision: number;
  namespace: string;
  contentHash: string;
  generatorHash: string;
  requestHash: string;
  key: string;
  cx: number;
  cz: number;
  blocks: Uint16Array;
  heightmap: Int16Array;
  biomes: Uint8Array;
  sectionBlockCounts: Uint16Array;
  skyTops: Int16Array;
  light: Uint16Array;
  /** Sorted unique cell indexes. */
  lightIndices: Uint32Array;
  /** Sorted unique cell indexes. */
  leafIndices: Uint32Array;
  markerTable: TerrainGenerationMarkerTableV2;
  /** Canonical checksum over metadata, typed-array bytes and the marker table. */
  chunkHash: string;
}>;

export type GeneratedChunkV2Payload = Readonly<{
  key: string;
  cx: number;
  cz: number;
  blocks: Uint16Array;
  heightmap: Int16Array;
  biomes: Uint8Array;
  sectionBlockCounts: Uint16Array;
  skyTops: Int16Array;
  light: Uint16Array;
  lightIndices: Uint32Array | readonly number[];
  leafIndices: Uint32Array | readonly number[];
  structureMarkers: readonly TerrainGenerationMarkerEntry[];
}>;

export type TerrainGenerationWorkerRequestV2 =
  | Readonly<{ type: "generate-chunk-v2"; request: GenerateChunkRequestV2 }>
  | Readonly<{ type: "query-settlements-v1"; request: SettlementLocatorRequestV1 }>
  | Readonly<{ type: "query-dragon-lair-v1"; request: DragonLairLocatorRequestV1 }>
  | Readonly<{ type: "cancel-generate-chunk-v2"; epoch: number; taskId: number }>;

export type TerrainGenerationWorkerResponseV2 =
  | Readonly<{
    type: "terrain-generation-ready-v2";
    protocolVersion: number;
    requestSchemaVersion: number;
    resultSchemaVersion: number;
    backend: "typescript-compatibility-oracle" | "rust-wasm-shadow" | "rust-wasm-authoritative";
    certificate?: Readonly<{
      generatorVersion: number;
      generatorHash: string;
      contentHash: string;
      corpusHash: string;
      corpusCases: number;
      byteEqual: boolean;
    }>;
    locatorCertificate?: TerrainLocatorParityCertificateV1;
  }>
  | Readonly<{ type: "terrain-generation-startup-error-v2"; message: string }>
  | Readonly<{ type: "generated-chunk-v2"; epoch: number; taskId: number; result: GeneratedChunkV2 }>
  | Readonly<{ type: "settlement-locator-result-v1"; epoch: number; taskId: number; result: SettlementLocatorResultV1 }>
  | Readonly<{ type: "dragon-lair-locator-result-v1"; epoch: number; taskId: number; result: DragonLairLocatorResultV1 }>
  | Readonly<{ type: "generate-chunk-error-v2"; epoch: number; taskId: number; message: string }>
  | Readonly<{ type: "generate-chunk-cancelled-v2"; epoch: number; taskId: number }>;

export class TerrainGenerationContractError extends Error {
  readonly name = "TerrainGenerationContractError";

  constructor(readonly issues: readonly string[]) {
    super(`Terrain generation contract rejected: ${issues.join("; ")}`);
  }
}

const HASH_PATTERN = /^[0-9a-f]{32}$/;
const FNV_64_OFFSET = BigInt("14695981039346656037");
const FNV_64_PRIME = BigInt("1099511628211");
const HIGH_LANE_SALT = BigInt("11562461410679940143");
const HIGH_LANE_PRIME = FNV_64_PRIME ^ BigInt("315");
const BYTE_MASK = BigInt("255");
const HASH_WORD_BASE = 0x1_0000_0000;
const HASH_WORD_MASK = BigInt("4294967295");
const LOW_WORD_MULTIPLIER = Number(FNV_64_PRIME & HASH_WORD_MASK);
const HIGH_WORD_MULTIPLIER = Number(HIGH_LANE_PRIME & HASH_WORD_MASK);

export class CanonicalGenerationHasher {
  private lowLo = Number(FNV_64_OFFSET & HASH_WORD_MASK);
  private lowHi = Number(FNV_64_OFFSET >> BigInt(32));
  private highLo = Number((FNV_64_OFFSET ^ HIGH_LANE_SALT) & HASH_WORD_MASK);
  private highHi = Number((FNV_64_OFFSET ^ HIGH_LANE_SALT) >> BigInt(32));

  constructor(domain: string) { this.writeString(domain); }

  private writeByte(byte: number, raw: boolean) {
    const low = (this.lowLo ^ byte) >>> 0;
    const high = (this.highLo ^ ((byte << 1) | (raw ? 1 : 0))) >>> 0;
    // Both primes are 2^40 + c (435/136). The low-word product is below
    // 2^41, so its carry is exact in a JS number. Only the low 32 bits of
    // hi*c and lo*2^8 survive in the high word modulo 2^64.
    const lowProduct = low * LOW_WORD_MULTIPLIER;
    const highProduct = high * HIGH_WORD_MULTIPLIER;
    this.lowHi = (Math.imul(this.lowHi, LOW_WORD_MULTIPLIER)
      + Math.floor(lowProduct / HASH_WORD_BASE) + (low << 8)) >>> 0;
    this.highHi = (Math.imul(this.highHi, HIGH_WORD_MULTIPLIER)
      + Math.floor(highProduct / HASH_WORD_BASE) + (high << 8)) >>> 0;
    this.lowLo = lowProduct >>> 0;
    this.highLo = highProduct >>> 0;
  }

  private writeRawByte(byte: number) {
    this.writeByte(byte, true);
  }

  writeU16(value: number) {
    for (let shift = 0; shift < 16; shift += 8) this.writeRawByte((value >>> shift) & 0xff);
  }

  writeU32(value: number) {
    const normalized = value >>> 0;
    for (let shift = 0; shift < 32; shift += 8) this.writeRawByte((normalized >>> shift) & 0xff);
  }

  writeI32(value: number) { this.writeU32(value); }

  writeI64(value: bigint) { this.writeU64(BigInt.asUintN(64, value)); }

  writeU8(value: number) { this.writeRawByte(value & 0xff); }

  writeU64(value: number | bigint) {
    let remaining = BigInt(value);
    for (let index = 0; index < 8; index += 1) {
      this.writeRawByte(Number(remaining & BYTE_MASK));
      remaining >>= BigInt(8);
    }
  }

  writeBytes(bytes: Uint8Array) {
    this.writeU64(bytes.byteLength);
    for (const byte of bytes) this.writeByte(byte, false);
  }

  writeString(value: string) { this.writeBytes(new TextEncoder().encode(value)); }

  finish() {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, this.lowLo, true);
    view.setUint32(4, this.lowHi, true);
    view.setUint32(8, this.highLo, true);
    view.setUint32(12, this.highHi, true);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

const SETTLEMENT_FACTIONS_V1 = ["atlantians", "dwarves", "goblins", "hobbits", "sugarcourt", "wood-elves"] as const;
const SETTLEMENT_SIZES_V1 = ["hamlet", "town", "village"] as const;
const SETTLEMENT_ENVIRONMENTS_V1 = ["surface", "underground", "underwater"] as const;
const DRAGON_SURVEY_TYPES_V1 = ["fire", "gold", "ice", "sea", "silver", "steel"] as const;

function canonicalLocatorStringList<T extends string>(
  values: readonly T[] | undefined,
  allowed: readonly T[],
  label: string,
  maximum = allowed.length,
) {
  if (values === undefined) return undefined;
  if (values.length > maximum) throw new TerrainGenerationContractError([`${label} exceeds ${maximum}`]);
  const result = [...values].sort(compareCanonicalText);
  for (let index = 0; index < result.length; index += 1) {
    if (!allowed.includes(result[index])) throw new TerrainGenerationContractError([`${label} contains an invalid value`]);
    if (index > 0 && result[index - 1] === result[index]) throw new TerrainGenerationContractError([`${label} must be unique`]);
  }
  return Object.freeze(result);
}

function canonicalLocatorExclusions(values: ReadonlySet<string> | readonly string[] | undefined, label: string) {
  const result = [...(values instanceof Set ? values : values ?? [])].sort(compareCanonicalText);
  if (result.length > TERRAIN_LOCATOR_MAX_EXCLUSIONS_V1) {
    throw new TerrainGenerationContractError([`${label} exceeds ${TERRAIN_LOCATOR_MAX_EXCLUSIONS_V1}`]);
  }
  for (let index = 0; index < result.length; index += 1) {
    if (!/^[a-z0-9:_-]+$/.test(result[index]) || result[index].length > 128) {
      throw new TerrainGenerationContractError([`${label} contains a non-canonical or oversized ID`]);
    }
    if (index > 0 && result[index - 1] === result[index]) throw new TerrainGenerationContractError([`${label} must be unique`]);
  }
  return Object.freeze(result);
}

function boundedLocatorInteger(value: unknown, fallback: number, minimum: number, maximum: number, label: string) {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new TerrainGenerationContractError([`${label} must be finite`]);
  }
  return Math.max(minimum, Math.min(maximum, Math.floor(candidate)));
}

function canonicalOriginMillis(value: number, label: string) {
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * 1_000))) {
    throw new TerrainGenerationContractError([`${label} must round to a bounded integer milliblock`]);
  }
  const result = BigInt(Math.round(value * 1_000));
  if (result < -TERRAIN_LOCATOR_MAX_ORIGIN_MILLIS_V1 || result > TERRAIN_LOCATOR_MAX_ORIGIN_MILLIS_V1) {
    throw new TerrainGenerationContractError([`${label} must round to a bounded integer milliblock`]);
  }
  return result;
}

function hashOptionalLocatorSet(hasher: CanonicalGenerationHasher, values: readonly string[] | undefined) {
  hasher.writeU16(values === undefined ? 0 : 1);
  if (values === undefined) return;
  hasher.writeU16(values.length);
  for (const value of values) hasher.writeString(value);
}

const TERRAIN_LOCATOR_TEXT_ENCODER_V1 = new TextEncoder();

/** Mirrors the native locator reader's UTF-8 limits before hashing or transport. */
export function assertTerrainLocatorTextBoundsV1(seedText: string, optionsJson: string) {
  const seedBytes = TERRAIN_LOCATOR_TEXT_ENCODER_V1.encode(seedText).byteLength;
  const optionsBytes = TERRAIN_LOCATOR_TEXT_ENCODER_V1.encode(optionsJson).byteLength;
  const issues: string[] = [];
  if (new TextDecoder().decode(TERRAIN_LOCATOR_TEXT_ENCODER_V1.encode(seedText)) !== seedText) {
    issues.push("locator seed must be well-formed Unicode");
  }
  if (seedBytes === 0 || seedBytes > TERRAIN_LOCATOR_MAX_SEED_BYTES_V1) {
    issues.push(`locator seed must contain 1-${TERRAIN_LOCATOR_MAX_SEED_BYTES_V1} UTF-8 bytes`);
  }
  if (optionsBytes === 0 || optionsBytes > TERRAIN_LOCATOR_MAX_OPTIONS_BYTES_V1) {
    issues.push(`locator options must contain 1-${TERRAIN_LOCATOR_MAX_OPTIONS_BYTES_V1} UTF-8 bytes`);
  }
  if (issues.length > 0) throw new TerrainGenerationContractError(issues);
}

export function hashSettlementLocatorRequestV1(request: Omit<SettlementLocatorRequestV1, "epoch" | "taskId" | "requestHash">) {
  assertTerrainLocatorTextBoundsV1(request.seedText, request.optionsJson);
  const hasher = new CanonicalGenerationHasher("blockwild-settlement-query-v1");
  hasher.writeString(request.seedText);
  hasher.writeString(request.optionsJson);
  hasher.writeI64(request.originXMillis);
  hasher.writeI64(request.originZMillis);
  hashOptionalLocatorSet(hasher, request.factionIds);
  hashOptionalLocatorSet(hasher, request.sizes);
  hashOptionalLocatorSet(hasher, request.environments);
  hasher.writeU16(request.excludeIds.length);
  for (const value of request.excludeIds) hasher.writeString(value);
  hasher.writeU16(request.maxRegionRadius);
  hasher.writeU16(request.limit);
  hasher.writeU16(request.breathesWater ? 1 : 0);
  return hasher.finish();
}

export function createSettlementLocatorRequestV1(input: Readonly<{
  epoch: number; taskId: number; seedText: string; generationOptions: Readonly<Record<string, unknown>>;
  origin: Readonly<{ x: number; z: number }>; factionIds?: readonly TerrainSettlementFactionV1[];
  sizes?: readonly TerrainSettlementSizeV1[]; environments?: readonly TerrainSettlementEnvironmentV1[];
  excludeIds?: ReadonlySet<string> | readonly string[]; maxRegionRadius?: number; limit?: number; breathesWater?: boolean;
}>) {
  if (!validU32(input.epoch) || !validU32(input.taskId) || !input.seedText) {
    throw new TerrainGenerationContractError(["settlement locator authority identity is invalid"]);
  }
  const withoutHash = {
    schemaVersion: TERRAIN_LOCATOR_SCHEMA_V1,
    epoch: input.epoch,
    taskId: input.taskId,
    seedText: input.seedText,
    optionsJson: stableTerrainGenerationJsonV2(input.generationOptions),
    originXMillis: canonicalOriginMillis(input.origin.x, "origin.x"),
    originZMillis: canonicalOriginMillis(input.origin.z, "origin.z"),
    factionIds: canonicalLocatorStringList(input.factionIds, SETTLEMENT_FACTIONS_V1, "factionIds"),
    sizes: canonicalLocatorStringList(input.sizes, SETTLEMENT_SIZES_V1, "sizes"),
    environments: canonicalLocatorStringList(input.environments, SETTLEMENT_ENVIRONMENTS_V1, "environments"),
    excludeIds: canonicalLocatorExclusions(input.excludeIds, "excludeIds"),
    maxRegionRadius: boundedLocatorInteger(input.maxRegionRadius, 24, 0, 96, "maxRegionRadius"),
    limit: boundedLocatorInteger(input.limit, 1, 1, TERRAIN_LOCATOR_MAX_SETTLEMENT_RESULTS_V1, "limit"),
    breathesWater: input.breathesWater === true,
  } as const;
  return Object.freeze({ ...withoutHash, requestHash: hashSettlementLocatorRequestV1(withoutHash) });
}

export function hashDragonLairLocatorRequestV1(request: Omit<DragonLairLocatorRequestV1, "epoch" | "taskId" | "requestHash">) {
  assertTerrainLocatorTextBoundsV1(request.seedText, request.optionsJson);
  const hasher = new CanonicalGenerationHasher("blockwild-lair-query-v1");
  hasher.writeString(request.seedText);
  hasher.writeString(request.optionsJson);
  hasher.writeI64(request.originXMillis);
  hasher.writeI64(request.originZMillis);
  hasher.writeString(request.dragonType);
  hasher.writeU16(request.minimumStage);
  hasher.writeU16(request.excludeIds.length);
  for (const value of request.excludeIds) hasher.writeString(value);
  hasher.writeU16(request.maxRegionRadius);
  return hasher.finish();
}

export function createDragonLairLocatorRequestV1(input: Readonly<{
  epoch: number; taskId: number; seedText: string; generationOptions: Readonly<Record<string, unknown>>;
  origin: Readonly<{ x: number; z: number }>; dragonType: TerrainDragonSurveyTypeV1; minimumStage: 3 | 4 | 5;
  excludeIds?: ReadonlySet<string> | readonly string[]; maxRegionRadius?: number;
}>) {
  if (!validU32(input.epoch) || !validU32(input.taskId) || !input.seedText || !DRAGON_SURVEY_TYPES_V1.includes(input.dragonType)
    || ![3, 4, 5].includes(input.minimumStage)) {
    throw new TerrainGenerationContractError(["dragon-lair locator authority identity or filters are invalid"]);
  }
  const withoutHash = {
    schemaVersion: TERRAIN_LOCATOR_SCHEMA_V1,
    epoch: input.epoch,
    taskId: input.taskId,
    seedText: input.seedText,
    optionsJson: stableTerrainGenerationJsonV2(input.generationOptions),
    originXMillis: canonicalOriginMillis(input.origin.x, "origin.x"),
    originZMillis: canonicalOriginMillis(input.origin.z, "origin.z"),
    dragonType: input.dragonType,
    minimumStage: input.minimumStage,
    excludeIds: canonicalLocatorExclusions(input.excludeIds, "excludeIds"),
    maxRegionRadius: boundedLocatorInteger(input.maxRegionRadius, 24, 1, 64, "maxRegionRadius"),
  } as const;
  return Object.freeze({ ...withoutHash, requestHash: hashDragonLairLocatorRequestV1(withoutHash) });
}

function bytesOf(view: ArrayBufferView) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TerrainGenerationContractError(["canonical JSON contains a non-finite number"]);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalJsonValue(entry));
  if (!isRecord(value)) throw new TerrainGenerationContractError(["canonical JSON contains an unsupported value"]);
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const entry = value[key];
    return entry === undefined ? [] : [[key, canonicalJsonValue(entry)]];
  }));
}

export function stableTerrainGenerationJsonV2(value: unknown) {
  return JSON.stringify(canonicalJsonValue(value));
}

export function hashTerrainGenerationIdentityV2(domain: string, ...values: readonly string[]) {
  const hasher = new CanonicalGenerationHasher(domain);
  for (const value of values) hasher.writeString(value);
  return hasher.finish();
}

export const LEGACY_TERRAIN_CONTENT_HASH_V2 = hashTerrainGenerationIdentityV2(
  "blockwild-terrain-content-v2",
  "typescript-block-registry-v1",
);

export function legacyTerrainGeneratorHashV2(namespace: string) {
  const match = /(?:^|\|)g(\d+)(?:\||$)/.exec(namespace);
  return hashTerrainGenerationIdentityV2("blockwild-terrain-generator-v2", `generator-${match?.[1] ?? "unknown"}`);
}

function canonicalEditArray(edits: Uint32Array | readonly TerrainGenerationEditPair[]) {
  const pairs: TerrainGenerationEditPair[] = edits instanceof Uint32Array
    ? Array.from({ length: Math.floor(edits.length / 2) }, (_, index) => [edits[index * 2], edits[index * 2 + 1]])
    : edits.map(([index, blockType]) => [index, blockType]);
  if (edits instanceof Uint32Array && edits.length % 2 !== 0) {
    throw new TerrainGenerationContractError(["edits must contain complete index/block pairs"]);
  }
  pairs.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const issues: string[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const [cellIndex, blockType] = pairs[index];
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= TERRAIN_GENERATION_CELL_COUNT_V2) {
      issues.push(`edits[${index}] cell index must be within the chunk`);
    }
    if (!Number.isInteger(blockType) || blockType < 0 || blockType > 0xffff) {
      issues.push(`edits[${index}] block type must be a u16`);
    }
    if (index > 0 && pairs[index - 1][0] === cellIndex) issues.push(`edits contains duplicate cell index ${cellIndex}`);
  }
  if (issues.length) throw new TerrainGenerationContractError(issues);
  return new Uint32Array(pairs.flatMap(([cellIndex, blockType]) => [cellIndex, blockType]));
}

function writeRequestFields(hasher: CanonicalGenerationHasher, request: Omit<GenerateChunkRequestV2, "requestHash">) {
  hasher.writeU16(request.protocolVersion);
  hasher.writeU16(request.schemaVersion);
  hasher.writeU32(request.epoch);
  hasher.writeU32(request.taskId);
  hasher.writeU32(request.revision);
  hasher.writeString(request.namespace);
  hasher.writeString(request.contentHash);
  hasher.writeString(request.generatorHash);
  hasher.writeString(request.seedText);
  hasher.writeString(stableTerrainGenerationJsonV2(request.generationOptions));
  hasher.writeString(request.key);
  hasher.writeI32(request.cx);
  hasher.writeI32(request.cz);
  hasher.writeBytes(bytesOf(request.edits));
}

export function hashGenerateChunkRequestV2(request: Omit<GenerateChunkRequestV2, "requestHash">) {
  const hasher = new CanonicalGenerationHasher("blockwild-generate-chunk-request-v2");
  writeRequestFields(hasher, request);
  return hasher.finish();
}

export function createGenerateChunkRequestV2(input: GenerateChunkRequestV2Input): GenerateChunkRequestV2 {
  const withoutHash: Omit<GenerateChunkRequestV2, "requestHash"> = {
    ...input,
    protocolVersion: TERRAIN_GENERATION_PROTOCOL_V2,
    schemaVersion: GENERATE_CHUNK_REQUEST_SCHEMA_V2,
    generationOptions: canonicalJsonValue(input.generationOptions) as Readonly<Record<string, unknown>>,
    edits: canonicalEditArray(input.edits),
  };
  const request = { ...withoutHash, requestHash: hashGenerateChunkRequestV2(withoutHash) } as const;
  assertGenerateChunkRequestV2(request);
  return request;
}

function recordIssue(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message);
}

function validU32(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function validI32(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}

function validHash(value: unknown) { return typeof value === "string" && HASH_PATTERN.test(value); }

export function generateChunkRequestV2Issues(value: unknown, verifyHash = true) {
  const issues: string[] = [];
  if (!isRecord(value)) return ["request must be an object"];
  recordIssue(issues, value.protocolVersion === TERRAIN_GENERATION_PROTOCOL_V2, `protocolVersion must be ${TERRAIN_GENERATION_PROTOCOL_V2}`);
  recordIssue(issues, value.schemaVersion === GENERATE_CHUNK_REQUEST_SCHEMA_V2, `schemaVersion must be ${GENERATE_CHUNK_REQUEST_SCHEMA_V2}`);
  for (const lane of ["epoch", "taskId", "revision"] as const) recordIssue(issues, validU32(value[lane]), `${lane} must be a u32`);
  recordIssue(issues, typeof value.namespace === "string" && value.namespace.length > 0, "namespace must be non-empty");
  recordIssue(issues, validHash(value.contentHash), "contentHash must be 32 lowercase hexadecimal characters");
  recordIssue(issues, validHash(value.generatorHash), "generatorHash must be 32 lowercase hexadecimal characters");
  recordIssue(issues, typeof value.seedText === "string", "seedText must be a string");
  recordIssue(issues, isRecord(value.generationOptions), "generationOptions must be an object");
  recordIssue(issues, validI32(value.cx), "cx must be an i32");
  recordIssue(issues, validI32(value.cz), "cz must be an i32");
  recordIssue(issues, typeof value.key === "string" && value.key === `${value.cx},${value.cz}`, "key must match cx,cz");
  recordIssue(issues, value.edits instanceof Uint32Array, "edits must be Uint32Array");
  if (value.edits instanceof Uint32Array) {
    recordIssue(issues, value.edits.buffer instanceof ArrayBuffer, "edits must own a transferable ArrayBuffer");
    recordIssue(issues, value.edits.byteOffset === 0 && value.edits.byteLength === value.edits.buffer.byteLength, "edits must exactly cover its buffer");
    recordIssue(issues, value.edits.length % 2 === 0, "edits must contain complete index/block pairs");
    let previous = -1;
    for (let index = 0; index + 1 < value.edits.length; index += 2) {
      const cellIndex = value.edits[index];
      recordIssue(issues, cellIndex < TERRAIN_GENERATION_CELL_COUNT_V2, `edits[${index / 2}] cell index must be within the chunk`);
      recordIssue(issues, value.edits[index + 1] <= 0xffff, `edits[${index / 2}] block type must be a u16`);
      recordIssue(issues, cellIndex > previous, "edits must be sorted with unique cell indexes");
      previous = cellIndex;
    }
  }
  recordIssue(issues, validHash(value.requestHash), "requestHash must be 32 lowercase hexadecimal characters");
  if (!issues.length && verifyHash) {
    const request = value as unknown as GenerateChunkRequestV2;
    recordIssue(issues, hashGenerateChunkRequestV2(request) === request.requestHash, "requestHash does not match request content");
  }
  return issues;
}

export function assertGenerateChunkRequestV2(value: unknown, verifyHash = true): asserts value is GenerateChunkRequestV2 {
  const issues = generateChunkRequestV2Issues(value, verifyHash);
  if (issues.length) throw new TerrainGenerationContractError(issues);
}

export function decodeTerrainGenerationEditsV2(edits: Uint32Array) {
  return Array.from({ length: edits.length / 2 }, (_, index) => (
    [edits[index * 2], edits[index * 2 + 1]] as TerrainGenerationEditPair
  ));
}

function compareCanonicalText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function encodeTerrainGenerationMarkerTableV2(entries: readonly TerrainGenerationMarkerEntry[]): TerrainGenerationMarkerTableV2 {
  const ordered = [...entries].sort(([left], [right]) => compareCanonicalText(left, right));
  for (let index = 0; index < ordered.length; index += 1) {
    const [key] = ordered[index];
    if (!key) throw new TerrainGenerationContractError([`structureMarkers[${index}] key must be non-empty`]);
    if (index > 0 && ordered[index - 1][0] === key) throw new TerrainGenerationContractError([`structureMarkers contains duplicate key ${key}`]);
  }
  const encoder = new TextEncoder();
  const rows = ordered.map((entry) => encoder.encode(stableTerrainGenerationJsonV2(entry)));
  const offsets = new Uint32Array(rows.length + 1);
  for (let index = 0; index < rows.length; index += 1) offsets[index + 1] = offsets[index] + rows[index].byteLength;
  const bytes = new Uint8Array(offsets[offsets.length - 1]);
  for (let index = 0; index < rows.length; index += 1) bytes.set(rows[index], offsets[index]);
  return { offsets, bytes };
}

export function decodeTerrainGenerationMarkerTableV2(table: TerrainGenerationMarkerTableV2) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: TerrainGenerationMarkerEntry[] = [];
  for (let index = 0; index + 1 < table.offsets.length; index += 1) {
    const row = JSON.parse(decoder.decode(table.bytes.subarray(table.offsets[index], table.offsets[index + 1]))) as TerrainGenerationMarkerEntry;
    entries.push(row);
  }
  return entries;
}

function canonicalIndexes(value: Uint32Array | readonly number[], label: string) {
  const indexes = [...value].sort((left, right) => left - right);
  for (let index = 0; index < indexes.length; index += 1) {
    if (!Number.isInteger(indexes[index]) || indexes[index] < 0 || indexes[index] >= TERRAIN_GENERATION_CELL_COUNT_V2) {
      throw new TerrainGenerationContractError([`${label}[${index}] must be a valid cell index`]);
    }
    if (index > 0 && indexes[index - 1] === indexes[index]) throw new TerrainGenerationContractError([`${label} must contain unique indexes`]);
  }
  return new Uint32Array(indexes);
}

function writeGeneratedChunkFields(hasher: CanonicalGenerationHasher, chunk: Omit<GeneratedChunkV2, "chunkHash">) {
  hasher.writeU16(chunk.protocolVersion);
  hasher.writeU16(chunk.schemaVersion);
  hasher.writeU32(chunk.epoch);
  hasher.writeU32(chunk.taskId);
  hasher.writeU32(chunk.revision);
  for (const value of [chunk.namespace, chunk.contentHash, chunk.generatorHash, chunk.requestHash, chunk.key]) hasher.writeString(value);
  hasher.writeI32(chunk.cx);
  hasher.writeI32(chunk.cz);
  for (const stream of [
    chunk.blocks,
    chunk.heightmap,
    chunk.biomes,
    chunk.sectionBlockCounts,
    chunk.skyTops,
    chunk.light,
    chunk.lightIndices,
    chunk.leafIndices,
    chunk.markerTable.offsets,
    chunk.markerTable.bytes,
  ]) hasher.writeBytes(bytesOf(stream));
}

export function hashGeneratedChunkV2(chunk: Omit<GeneratedChunkV2, "chunkHash">) {
  const hasher = new CanonicalGenerationHasher("blockwild-generated-chunk-v2");
  writeGeneratedChunkFields(hasher, chunk);
  return hasher.finish();
}

export function createGeneratedChunkV2(request: GenerateChunkRequestV2, payload: GeneratedChunkV2Payload): GeneratedChunkV2 {
  assertGenerateChunkRequestV2(request);
  const withoutHash: Omit<GeneratedChunkV2, "chunkHash"> = {
    protocolVersion: TERRAIN_GENERATION_PROTOCOL_V2,
    schemaVersion: GENERATED_CHUNK_SCHEMA_V2,
    epoch: request.epoch,
    taskId: request.taskId,
    revision: request.revision,
    namespace: request.namespace,
    contentHash: request.contentHash,
    generatorHash: request.generatorHash,
    requestHash: request.requestHash,
    key: payload.key,
    cx: payload.cx,
    cz: payload.cz,
    blocks: payload.blocks,
    heightmap: payload.heightmap,
    biomes: payload.biomes,
    sectionBlockCounts: payload.sectionBlockCounts,
    skyTops: payload.skyTops,
    light: payload.light,
    lightIndices: canonicalIndexes(payload.lightIndices, "lightIndices"),
    leafIndices: canonicalIndexes(payload.leafIndices, "leafIndices"),
    markerTable: encodeTerrainGenerationMarkerTableV2(payload.structureMarkers),
  };
  const chunk = { ...withoutHash, chunkHash: hashGeneratedChunkV2(withoutHash) } as const;
  assertGeneratedChunkMatchesRequestV2(chunk, request);
  return chunk;
}

function expectTypedArray(
  value: unknown,
  constructor: { new(length: number): ArrayBufferView; readonly name: string },
  length: number | null,
  issues: string[],
  path: string,
) {
  const validType = value instanceof constructor;
  recordIssue(issues, validType, `${path} must be ${constructor.name}`);
  if (validType && length !== null) {
    recordIssue(issues, (value as unknown as { length: number }).length === length, `${path} must contain ${length} elements`);
  }
  if (validType) {
    const view = value as ArrayBufferView;
    recordIssue(issues, view.buffer instanceof ArrayBuffer, `${path} must own a transferable ArrayBuffer`);
    recordIssue(issues, view.byteOffset === 0 && view.byteLength === view.buffer.byteLength, `${path} must exactly cover its buffer`);
  }
}

function markerTableIssues(value: unknown) {
  const issues: string[] = [];
  if (!isRecord(value)) return ["markerTable must be an object"];
  expectTypedArray(value.offsets, Uint32Array, null, issues, "markerTable.offsets");
  expectTypedArray(value.bytes, Uint8Array, null, issues, "markerTable.bytes");
  if (value.offsets instanceof Uint32Array && value.bytes instanceof Uint8Array) {
    const offsets = value.offsets;
    const bytes = value.bytes;
    recordIssue(issues, offsets.length >= 1, "markerTable.offsets must include the zero sentinel");
    if (offsets.length) {
      recordIssue(issues, offsets[0] === 0, "markerTable.offsets must begin at zero");
      recordIssue(issues, offsets[offsets.length - 1] === bytes.length, "markerTable final offset must equal byte length");
      for (let index = 1; index < offsets.length; index += 1) {
        recordIssue(issues, offsets[index] > offsets[index - 1], "markerTable rows must be non-empty and strictly ordered");
      }
    }
    if (!issues.length) {
      try {
        const entries = decodeTerrainGenerationMarkerTableV2({ offsets, bytes });
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index];
          recordIssue(issues, Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && isRecord(entry[1]), `markerTable row ${index} must be [key, marker]`);
          if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && isRecord(entry[1])) {
            const marker = entry[1];
            recordIssue(issues, entry[0].length > 0 && entry[0].length <= 1_024, `markerTable row ${index} key must be non-empty and bounded`);
            recordIssue(issues, marker.type === "chest" || marker.type === "spawn" || marker.type === "landmark", `markerTable row ${index} has an unknown marker type`);
            recordIssue(issues, typeof marker.id === "string" && marker.id.length > 0, `markerTable row ${index} marker id must be non-empty`);
            const position = isRecord(marker.position) ? marker.position : null;
            recordIssue(issues, Boolean(position) && validI32(position?.x) && validI32(position?.y) && validI32(position?.z), `markerTable row ${index} marker position must contain i32 coordinates`);
            if (marker.type === "chest") {
              recordIssue(issues, typeof marker.lootTable === "string" && Array.isArray(marker.loot), `markerTable row ${index} chest metadata is invalid`);
            } else if (marker.type === "spawn") {
              recordIssue(issues, typeof marker.mobKind === "string" && validU32(marker.count)
                && typeof marker.radius === "number" && Number.isFinite(marker.radius) && marker.radius >= 0 && marker.radius <= 65_535
                && typeof marker.persistent === "boolean", `markerTable row ${index} spawn metadata is invalid`);
            } else if (marker.type === "landmark") {
              recordIssue(issues, typeof marker.tag === "string", `markerTable row ${index} landmark tag is invalid`);
            }
          }
          if (index > 0) recordIssue(issues, compareCanonicalText(entries[index - 1][0], entry[0]) < 0, "markerTable keys must be sorted and unique");
        }
        const canonical = encodeTerrainGenerationMarkerTableV2(entries);
        recordIssue(issues, canonical.offsets.length === offsets.length
          && canonical.offsets.every((entry, index) => entry === offsets[index]), "markerTable offsets are not canonical");
        recordIssue(issues, canonical.bytes.length === bytes.length
          && canonical.bytes.every((entry, index) => entry === bytes[index]), "markerTable bytes are not canonical");
      } catch { issues.push("markerTable bytes must contain valid canonical UTF-8 JSON rows"); }
    }
  }
  return issues;
}

export function generatedChunkV2Issues(value: unknown, verifyHash = true) {
  const issues: string[] = [];
  if (!isRecord(value)) return ["generated chunk must be an object"];
  recordIssue(issues, value.protocolVersion === TERRAIN_GENERATION_PROTOCOL_V2, `protocolVersion must be ${TERRAIN_GENERATION_PROTOCOL_V2}`);
  recordIssue(issues, value.schemaVersion === GENERATED_CHUNK_SCHEMA_V2, `schemaVersion must be ${GENERATED_CHUNK_SCHEMA_V2}`);
  for (const lane of ["epoch", "taskId", "revision"] as const) recordIssue(issues, validU32(value[lane]), `${lane} must be a u32`);
  for (const field of ["contentHash", "generatorHash", "requestHash", "chunkHash"] as const) {
    recordIssue(issues, validHash(value[field]), `${field} must be 32 lowercase hexadecimal characters`);
  }
  recordIssue(issues, typeof value.namespace === "string" && value.namespace.length > 0, "namespace must be non-empty");
  recordIssue(issues, validI32(value.cx), "cx must be an i32");
  recordIssue(issues, validI32(value.cz), "cz must be an i32");
  recordIssue(issues, typeof value.key === "string" && value.key === `${value.cx},${value.cz}`, "key must match cx,cz");
  expectTypedArray(value.blocks, Uint16Array, TERRAIN_GENERATION_CELL_COUNT_V2, issues, "blocks");
  expectTypedArray(value.heightmap, Int16Array, TERRAIN_GENERATION_COLUMN_COUNT_V2, issues, "heightmap");
  expectTypedArray(value.biomes, Uint8Array, TERRAIN_GENERATION_COLUMN_COUNT_V2, issues, "biomes");
  expectTypedArray(value.sectionBlockCounts, Uint16Array, TERRAIN_GENERATION_SECTION_COUNT_V2, issues, "sectionBlockCounts");
  expectTypedArray(value.skyTops, Int16Array, TERRAIN_GENERATION_COLUMN_COUNT_V2, issues, "skyTops");
  expectTypedArray(value.light, Uint16Array, TERRAIN_GENERATION_CELL_COUNT_V2, issues, "light");
  for (const field of ["lightIndices", "leafIndices"] as const) {
    expectTypedArray(value[field], Uint32Array, null, issues, field);
    if (value[field] instanceof Uint32Array) {
      let previous = -1;
      for (const cellIndex of value[field]) {
        recordIssue(issues, cellIndex < TERRAIN_GENERATION_CELL_COUNT_V2, `${field} contains an out-of-range cell index`);
        recordIssue(issues, cellIndex > previous, `${field} must be sorted and unique`);
        previous = cellIndex;
      }
    }
  }
  issues.push(...markerTableIssues(value.markerTable));
  if (!issues.length && verifyHash) {
    const chunk = value as unknown as GeneratedChunkV2;
    recordIssue(issues, hashGeneratedChunkV2(chunk) === chunk.chunkHash, "chunkHash does not match generated content");
  }
  return issues;
}

export function assertGeneratedChunkV2(value: unknown, verifyHash = true): asserts value is GeneratedChunkV2 {
  const issues = generatedChunkV2Issues(value, verifyHash);
  if (issues.length) throw new TerrainGenerationContractError(issues);
}

export function assertGeneratedChunkMatchesRequestV2(value: unknown, request: GenerateChunkRequestV2): asserts value is GeneratedChunkV2 {
  assertGenerateChunkRequestV2(request);
  assertGeneratedChunkV2(value);
  const chunk = value as GeneratedChunkV2;
  const issues: string[] = [];
  for (const field of ["epoch", "taskId", "revision", "namespace", "contentHash", "generatorHash", "requestHash", "key", "cx", "cz"] as const) {
    recordIssue(issues, chunk[field] === request[field], `${field} does not match the request`);
  }
  if (issues.length) throw new TerrainGenerationContractError(issues);
}

function transferableBuffer(view: ArrayBufferView) {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new TerrainGenerationContractError(["terrain generation streams must own transferable ArrayBuffers"]);
  }
  return view.buffer;
}

export function generateChunkRequestTransferListV2(request: GenerateChunkRequestV2) {
  assertGenerateChunkRequestV2(request);
  return [transferableBuffer(request.edits)];
}

export function generatedChunkTransferListV2(chunk: GeneratedChunkV2) {
  assertGeneratedChunkV2(chunk);
  return [
    transferableBuffer(chunk.blocks),
    transferableBuffer(chunk.heightmap),
    transferableBuffer(chunk.biomes),
    transferableBuffer(chunk.sectionBlockCounts),
    transferableBuffer(chunk.skyTops),
    transferableBuffer(chunk.light),
    transferableBuffer(chunk.lightIndices),
    transferableBuffer(chunk.leafIndices),
    transferableBuffer(chunk.markerTable.offsets),
    transferableBuffer(chunk.markerTable.bytes),
  ];
}
