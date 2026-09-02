import { ITEMS, type InventorySlot } from "./data.ts";
import { rustIntegratedRuntimeWireChecksumV1 } from "./rust-integrated-runtime-codec.ts";
import {
  rehydrateRustLiveLocatorItemConsumePlanV1,
  rustLiveLocatorItemConsumePlanRecordV1,
  type RustLiveLocatorItemConsumePlanRecordV1,
  type RustLiveLocatorItemConsumePlanV1,
} from "./rust-integrated-runtime-player-locator-consume.ts";
import {
  CanonicalGenerationHasher,
  type DragonLairLocatorResultV1,
  type SettlementLocatorResultV1,
  type TerrainDragonSurveyTypeV1,
  type TerrainSettlementBiomeV1,
  type TerrainSettlementEnvironmentV1,
  type TerrainSettlementFactionV1,
  type TerrainSettlementSizeV1,
} from "./terrain-generation-contract.ts";

export const RUST_TERRAIN_LOCATOR_EFFECT_JOURNAL_SCHEMA_V1 = 1 as const;
export const RUST_TERRAIN_LOCATOR_EFFECT_JOURNAL_MAX_JSON_BYTES_V1 = 128 * 1_024;
export const RUST_TERRAIN_LOCATOR_APPLIED_EFFECT_IDS_MAX_V1 = 128;

const HASH = /^[0-9a-f]{32}$/u;
const ZERO_HASH = "0".repeat(32);
const DECIMAL_U64 = /^(?:0|[1-9][0-9]*)$/u;
const LOCATOR_ID = /^[a-z0-9:_-]+$/u;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const I32_MIN = -0x8000_0000;
const I32_MAX = 0x7fff_ffff;
const U32_MAX = 0xffff_ffff;
const MAX_LOCATOR_RESULTS = 4;
const MAX_ID_BYTES = 512;
const MAX_NAMESPACE_BYTES = 16 * 1_024;
const encoder = new TextEncoder();

const SETTLEMENT_FACTIONS = new Set<TerrainSettlementFactionV1>([
  "atlantians", "dwarves", "goblins", "hobbits", "sugarcourt", "wood-elves",
]);
const SETTLEMENT_SIZES = new Set<TerrainSettlementSizeV1>(["hamlet", "town", "village"]);
const SETTLEMENT_ENVIRONMENTS = new Set<TerrainSettlementEnvironmentV1>([
  "surface", "underground", "underwater",
]);
const SETTLEMENT_BIOMES = new Set<TerrainSettlementBiomeV1>([
  "badlands", "cloudreed-glen", "deep-ocean", "flower-meadow", "forest", "glimmerwood",
  "highlands", "lumen-trench", "snowcap-range", "sugarplum-vale", "wildwood",
]);
const ARRIVAL_KINDS = new Set(["public-approach", "reef-air-arrival", "surface-entry"]);
const DRAGON_TYPES = new Set<TerrainDragonSurveyTypeV1>(["fire", "gold", "ice", "sea", "silver", "steel"]);

export type RustTerrainLocatorWorldIdentityV1 = Readonly<{
  saveId: string;
  terrainNamespace: string;
  runtimeUniverseId: string;
  runtimeLocationId: string;
}>;

export type RustTerrainLocatorPositionV1 = Readonly<{ x: number; y: number; z: number }>;

/**
 * Locator items are plain stackable documents. Durability and opaque item metadata are deliberately
 * unsupported until a reviewed compatibility-to-native encoding can bind those fields byte-for-byte.
 */
export type RustTerrainLocatorCompatibilityStackV1 = Readonly<Pick<InventorySlot, "item" | "count">>;

export type RustTerrainSettlementLocatorEntryRecordV1 = Readonly<{
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
  distanceSquaredMillis: string;
  publicArrival: Readonly<{ x: number; yMillis: number; z: number; anchorKind: string }>;
}>;

export type RustTerrainSettlementLocatorResultRecordV1 = Readonly<{
  schemaVersion: 1;
  epoch: number;
  taskId: number;
  requestHash: string;
  entries: readonly RustTerrainSettlementLocatorEntryRecordV1[];
  resultHash: string;
}>;

export type RustTerrainDragonLairLocatorEntryRecordV1 = Readonly<{
  id: string;
  dragonType: TerrainDragonSurveyTypeV1;
  stage: 3 | 4 | 5;
  sex: "female" | "male";
  x: number;
  y: number;
  z: number;
  distanceSquaredMillis: string;
}>;

export type RustTerrainDragonLairLocatorResultRecordV1 = Readonly<{
  schemaVersion: 1;
  epoch: number;
  taskId: number;
  requestHash: string;
  entry: RustTerrainDragonLairLocatorEntryRecordV1;
  resultHash: string;
}>;

export type RustTerrainSettlementChartEffectV1 = Readonly<{
  kind: "chart";
  discoveredAt: number;
  result: RustTerrainSettlementLocatorResultRecordV1;
  /** Canonically ordered, non-empty subset of result entries that were still unknown at prepare time. */
  applyEntryIds: readonly string[];
}>;

export type RustTerrainDragonLairEffectV1 = Readonly<{
  kind: "lair";
  discoveredAt: number;
  result: RustTerrainDragonLairLocatorResultRecordV1;
}>;

export type RustTerrainLocatorEffectV1 =
  | RustTerrainSettlementChartEffectV1
  | RustTerrainDragonLairEffectV1;

export type RustTerrainLocatorEffectJournalV1 = Readonly<{
  schema: typeof RUST_TERRAIN_LOCATOR_EFFECT_JOURNAL_SCHEMA_V1;
  phase: "prepared";
  world: RustTerrainLocatorWorldIdentityV1;
  actorId: string;
  position: RustTerrainLocatorPositionV1;
  selectedSlot: number;
  compatibilityStack: RustTerrainLocatorCompatibilityStackV1;
  plan: RustLiveLocatorItemConsumePlanRecordV1;
  effect: RustTerrainLocatorEffectV1;
  effectHash: string;
}>;

export type CreateRustTerrainLocatorEffectJournalV1 = Readonly<{
  world: RustTerrainLocatorWorldIdentityV1;
  actorId: string;
  position: RustTerrainLocatorPositionV1;
  selectedSlot: number;
  compatibilityStack: RustTerrainLocatorCompatibilityStackV1;
  plan: RustLiveLocatorItemConsumePlanV1 | RustLiveLocatorItemConsumePlanRecordV1;
  effect: RustTerrainLocatorEffectV1;
}>;

export class RustTerrainLocatorEffectJournalErrorV1 extends Error {
  readonly name = "RustTerrainLocatorEffectJournalErrorV1";
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new RustTerrainLocatorEffectJournalErrorV1(code, message, cause === undefined ? undefined : { cause });
}

function record(value: unknown, keys: readonly string[], label: string) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return fail("locator-journal-shape", `${label} is not a plain record`);
  }
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return fail("locator-journal-shape", `${label} fields are not exact`);
  }
  return source;
}

function bytesLength(value: string) { return encoder.encode(value).byteLength; }

function text(value: unknown, label: string, maximumBytes = MAX_ID_BYTES) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value
    || value.includes("\0") || bytesLength(value) > maximumBytes) {
    return fail("locator-journal-text", `${label} is empty, non-canonical, or oversized`);
  }
  return value;
}

function hash(value: unknown, label: string, nonzero = true) {
  if (typeof value !== "string" || !HASH.test(value) || nonzero && value === ZERO_HASH) {
    return fail("locator-journal-hash", `${label} is not a canonical${nonzero ? " non-zero" : ""} hash`);
  }
  return value;
}

function safeInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return fail("locator-journal-integer", `${label} is outside its integer bounds`);
  }
  return value;
}

function i32(value: unknown, label: string) { return safeInteger(value, label, I32_MIN, I32_MAX); }
function u32(value: unknown, label: string) { return safeInteger(value, label, 0, U32_MAX); }

function finitePosition(value: unknown) {
  const source = record(value, ["x", "y", "z"], "locator journal position");
  const coordinate = (axis: "x" | "y" | "z") => {
    const candidate = source[axis];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || Math.abs(candidate) > I32_MAX) {
      return fail("locator-journal-position", `locator journal ${axis} position is non-finite or out of bounds`);
    }
    return Object.is(candidate, -0) ? 0 : candidate;
  };
  return Object.freeze({ x: coordinate("x"), y: coordinate("y"), z: coordinate("z") });
}

function decimalU64(value: unknown, label: string) {
  if (typeof value !== "string" || !DECIMAL_U64.test(value)) {
    return fail("locator-journal-u64", `${label} is not canonical unsigned decimal`);
  }
  const parsed = BigInt(value);
  if (parsed > U64_MAX) fail("locator-journal-u64", `${label} exceeds u64`);
  return Object.freeze({ decimal: value, value: parsed });
}

function locatorId(value: unknown, label: string) {
  const id = text(value, label, 128);
  if (!LOCATOR_ID.test(id)) fail("locator-journal-id", `${label} is not a canonical locator ID`);
  return id;
}

function member<T extends string>(value: unknown, allowed: ReadonlySet<T>, label: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    return fail("locator-journal-enum", `${label} is unknown`);
  }
  return value as T;
}

function checkedWorld(value: unknown): RustTerrainLocatorWorldIdentityV1 {
  const source = record(value,
    ["saveId", "terrainNamespace", "runtimeUniverseId", "runtimeLocationId"],
    "locator journal world identity");
  return Object.freeze({
    saveId: text(source.saveId, "world save ID"),
    terrainNamespace: text(source.terrainNamespace, "terrain authority namespace", MAX_NAMESPACE_BYTES),
    runtimeUniverseId: text(source.runtimeUniverseId, "runtime universe ID"),
    runtimeLocationId: text(source.runtimeLocationId, "runtime location ID"),
  });
}

function checkedCompatibilityStack(value: unknown): RustTerrainLocatorCompatibilityStackV1 {
  const source = record(value, ["item", "count"], "locator compatibility stack");
  return Object.freeze({
    item: safeInteger(source.item, "locator compatibility item code", 1, U32_MAX) as InventorySlot["item"],
    count: safeInteger(source.count, "locator compatibility stack count", 1, 0x7fff_ffff),
  });
}

function checkedSettlementEntry(value: unknown, index: number): RustTerrainSettlementLocatorEntryRecordV1 {
  const label = `settlement result entry ${index}`;
  const source = record(value, [
    "id", "factionId", "size", "environment", "biome", "regionX", "regionZ", "x", "z",
    "floorY", "distanceSquaredMillis", "publicArrival",
  ], label);
  const arrivalSource = record(source.publicArrival, ["x", "yMillis", "z", "anchorKind"], `${label} public arrival`);
  const anchorKind = member(arrivalSource.anchorKind, ARRIVAL_KINDS, `${label} public arrival kind`);
  const floorY = source.floorY === null ? null : safeInteger(source.floorY, `${label} floor`, -64, 127);
  return Object.freeze({
    id: locatorId(source.id, `${label} ID`),
    factionId: member(source.factionId, SETTLEMENT_FACTIONS, `${label} faction`),
    size: member(source.size, SETTLEMENT_SIZES, `${label} size`),
    environment: member(source.environment, SETTLEMENT_ENVIRONMENTS, `${label} environment`),
    biome: member(source.biome, SETTLEMENT_BIOMES, `${label} biome`),
    regionX: i32(source.regionX, `${label} region X`),
    regionZ: i32(source.regionZ, `${label} region Z`),
    x: i32(source.x, `${label} X`),
    z: i32(source.z, `${label} Z`),
    floorY,
    distanceSquaredMillis: decimalU64(source.distanceSquaredMillis, `${label} distance`).decimal,
    publicArrival: Object.freeze({
      x: i32(arrivalSource.x, `${label} public arrival X`),
      yMillis: i32(arrivalSource.yMillis, `${label} public arrival Y`),
      z: i32(arrivalSource.z, `${label} public arrival Z`),
      anchorKind,
    }),
  });
}

function hashSettlementResult(result: RustTerrainSettlementLocatorResultRecordV1) {
  const hasher = new CanonicalGenerationHasher("blockwild-settlement-query-result-v1");
  hasher.writeString(result.requestHash);
  hasher.writeU16(result.entries.length);
  for (const entry of result.entries) {
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
    hasher.writeU64(BigInt(entry.distanceSquaredMillis));
    hasher.writeI32(entry.publicArrival.x);
    hasher.writeI32(entry.publicArrival.yMillis);
    hasher.writeI32(entry.publicArrival.z);
    hasher.writeString(entry.publicArrival.anchorKind);
  }
  return hasher.finish();
}

function checkedSettlementResult(value: unknown): RustTerrainSettlementLocatorResultRecordV1 {
  const source = record(value,
    ["schemaVersion", "epoch", "taskId", "requestHash", "entries", "resultHash"],
    "settlement locator result");
  if (source.schemaVersion !== 1 || !Array.isArray(source.entries)
    || source.entries.length === 0 || source.entries.length > MAX_LOCATOR_RESULTS) {
    return fail("locator-journal-settlement-result", "settlement locator result schema or entry bound is invalid");
  }
  const entries = Object.freeze(source.entries.map(checkedSettlementEntry));
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    const previousDistance = BigInt(previous.distanceSquaredMillis);
    const currentDistance = BigInt(current.distanceSquaredMillis);
    if (currentDistance < previousDistance
      || currentDistance === previousDistance && current.id <= previous.id) {
      fail("locator-journal-order", "settlement locator entries are not canonically ordered and unique");
    }
  }
  const result: RustTerrainSettlementLocatorResultRecordV1 = Object.freeze({
    schemaVersion: 1,
    epoch: u32(source.epoch, "settlement locator epoch"),
    taskId: u32(source.taskId, "settlement locator task ID"),
    requestHash: hash(source.requestHash, "settlement locator request hash"),
    entries,
    resultHash: hash(source.resultHash, "settlement locator result hash"),
  });
  if (hashSettlementResult(result) !== result.resultHash) {
    fail("locator-journal-result-hash", "settlement locator result content does not match its result hash");
  }
  return result;
}

function checkedLairEntry(value: unknown): RustTerrainDragonLairLocatorEntryRecordV1 {
  const source = record(value,
    ["id", "dragonType", "stage", "sex", "x", "y", "z", "distanceSquaredMillis"],
    "dragon lair result entry");
  const stage = safeInteger(source.stage, "dragon lair stage", 3, 5);
  if (stage !== 3 && stage !== 4 && stage !== 5) fail("locator-journal-lair", "dragon lair stage is invalid");
  if (source.sex !== "female" && source.sex !== "male") fail("locator-journal-lair", "dragon lair sex is invalid");
  return Object.freeze({
    id: locatorId(source.id, "dragon lair ID"),
    dragonType: member(source.dragonType, DRAGON_TYPES, "dragon lair type"),
    stage,
    sex: source.sex,
    x: i32(source.x, "dragon lair X"),
    y: i32(source.y, "dragon lair Y"),
    z: i32(source.z, "dragon lair Z"),
    distanceSquaredMillis: decimalU64(source.distanceSquaredMillis, "dragon lair distance").decimal,
  });
}

function hashLairResult(result: RustTerrainDragonLairLocatorResultRecordV1) {
  const hasher = new CanonicalGenerationHasher("blockwild-lair-query-result-v1");
  hasher.writeString(result.requestHash);
  hasher.writeU16(1);
  hasher.writeString(result.entry.id);
  hasher.writeString(result.entry.dragonType);
  hasher.writeU16(result.entry.stage);
  hasher.writeString(result.entry.sex);
  hasher.writeI32(result.entry.x);
  hasher.writeI32(result.entry.y);
  hasher.writeI32(result.entry.z);
  hasher.writeU64(BigInt(result.entry.distanceSquaredMillis));
  return hasher.finish();
}

function checkedLairResult(value: unknown): RustTerrainDragonLairLocatorResultRecordV1 {
  const source = record(value,
    ["schemaVersion", "epoch", "taskId", "requestHash", "entry", "resultHash"],
    "dragon lair locator result");
  if (source.schemaVersion !== 1) fail("locator-journal-lair-result", "dragon lair locator result schema is invalid");
  const result: RustTerrainDragonLairLocatorResultRecordV1 = Object.freeze({
    schemaVersion: 1,
    epoch: u32(source.epoch, "dragon lair locator epoch"),
    taskId: u32(source.taskId, "dragon lair locator task ID"),
    requestHash: hash(source.requestHash, "dragon lair locator request hash"),
    entry: checkedLairEntry(source.entry),
    resultHash: hash(source.resultHash, "dragon lair locator result hash"),
  });
  if (hashLairResult(result) !== result.resultHash) {
    fail("locator-journal-result-hash", "dragon lair locator result content does not match its result hash");
  }
  return result;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("locator-journal-json", "journal JSON contains a non-finite number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return fail("locator-journal-json", "journal JSON contains an unsupported value");
  }
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
}

function checkedEffect(value: unknown): RustTerrainLocatorEffectV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("locator-journal-effect", "locator effect is malformed");
  }
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "chart") {
    const source = record(value, ["kind", "discoveredAt", "result", "applyEntryIds"], "settlement chart effect");
    if (!Array.isArray(source.applyEntryIds) || source.applyEntryIds.length === 0
      || source.applyEntryIds.length > MAX_LOCATOR_RESULTS) {
      return fail("locator-journal-chart-effect", "settlement chart apply list is empty or oversized");
    }
    const result = checkedSettlementResult(source.result);
    const requested = source.applyEntryIds.map((id, index) => locatorId(id, `settlement chart apply ID ${index}`));
    if (new Set(requested).size !== requested.length) {
      fail("locator-journal-duplicate", "settlement chart apply IDs are not unique");
    }
    const requestedSet = new Set(requested);
    const canonical = result.entries.filter((entry) => requestedSet.has(entry.id)).map((entry) => entry.id);
    if (canonical.length !== requested.length || canonical.some((id, index) => id !== requested[index])) {
      fail("locator-journal-chart-effect", "settlement chart apply IDs are not a canonical result subset");
    }
    return Object.freeze({
      kind: "chart",
      discoveredAt: safeInteger(source.discoveredAt, "settlement chart discovery time", 0, Number.MAX_SAFE_INTEGER),
      result,
      applyEntryIds: Object.freeze(requested),
    });
  }
  if (kind === "lair") {
    const source = record(value, ["kind", "discoveredAt", "result"], "dragon lair effect");
    return Object.freeze({
      kind: "lair",
      discoveredAt: safeInteger(source.discoveredAt, "dragon lair discovery time", 0, Number.MAX_SAFE_INTEGER),
      result: checkedLairResult(source.result),
    });
  }
  return fail("locator-journal-effect", "locator effect purpose is unknown");
}

function effectHash(effect: RustTerrainLocatorEffectV1) {
  return rustIntegratedRuntimeWireChecksumV1(encoder.encode(canonicalJson(effect)));
}

function canonicalPlan(
  value: RustLiveLocatorItemConsumePlanV1 | RustLiveLocatorItemConsumePlanRecordV1 | unknown,
) {
  try {
    const plan = value !== null && typeof value === "object" && "batch" in value
      ? value as RustLiveLocatorItemConsumePlanV1
      : rehydrateRustLiveLocatorItemConsumePlanV1(value as RustLiveLocatorItemConsumePlanRecordV1);
    const planRecord = rustLiveLocatorItemConsumePlanRecordV1(plan);
    // A second exact rehydration makes object creation obey the same fail-closed gate as loading.
    return Object.freeze({
      plan: rehydrateRustLiveLocatorItemConsumePlanV1(planRecord),
      record: planRecord,
    });
  } catch (error) {
    return fail("locator-journal-plan", "embedded locator consume plan failed exact rehydration", error);
  }
}

function checkedJournal(value: unknown): RustTerrainLocatorEffectJournalV1 {
  const source = record(value, [
    "schema", "phase", "world", "actorId", "position", "selectedSlot", "compatibilityStack",
    "plan", "effect", "effectHash",
  ], "locator effect journal");
  if (source.schema !== RUST_TERRAIN_LOCATOR_EFFECT_JOURNAL_SCHEMA_V1 || source.phase !== "prepared") {
    fail("locator-journal-version", "locator effect journal version or phase is unsupported");
  }
  const world = checkedWorld(source.world);
  const actorId = text(source.actorId, "locator journal actor ID");
  const position = finitePosition(source.position);
  const selectedSlot = safeInteger(source.selectedSlot, "locator journal selected slot", 0, 8);
  const compatibilityStack = checkedCompatibilityStack(source.compatibilityStack);
  const canonical = canonicalPlan(source.plan);
  const effect = checkedEffect(source.effect);
  const suppliedEffectHash = hash(source.effectHash, "locator effect hash");
  const computedEffectHash = effectHash(effect);
  if (suppliedEffectHash !== computedEffectHash) {
    fail("locator-journal-effect-hash", "locator effect content does not match its effect hash");
  }
  if (canonical.plan.batch.actorId !== actorId || canonical.plan.request.inventory.ownerId !== actorId) {
    fail("locator-journal-actor", "journal actor does not own the embedded locator command");
  }
  if (world.runtimeUniverseId !== canonical.plan.batch.expected.universeId
    || world.runtimeLocationId !== canonical.plan.batch.expected.locationId) {
    fail("locator-journal-world", "journal runtime world identity does not match the embedded locator command");
  }
  if (selectedSlot !== canonical.plan.request.selectedSlot) {
    fail("locator-journal-slot", "journal selected slot does not match the embedded locator command");
  }
  const expectedStack = canonical.plan.request.expectedStack;
  if (compatibilityStack.item !== expectedStack.itemCode || compatibilityStack.count !== expectedStack.count
    || expectedStack.durabilityMillionths !== null || expectedStack.metadataHash !== ZERO_HASH) {
    fail("locator-journal-stack", "compatibility stack does not exactly match a plain native locator stack");
  }
  if (canonical.plan.request.purpose !== effect.kind
    || canonical.plan.request.locatorResultHash !== effect.result.resultHash) {
    fail("locator-journal-purpose", "locator effect purpose or authoritative result hash does not match its command");
  }
  const definition = ITEMS[compatibilityStack.item];
  if (effect.kind === "chart") {
    if (definition?.useKind !== "settlement-chart") {
      fail("locator-journal-item-purpose", "chart effect is not bound to a settlement-chart item");
    }
  } else if (definition?.useKind !== "lair-survey" || !definition.lairSurvey
    || definition.lairSurvey.dragonType !== effect.result.entry.dragonType
    || effect.result.entry.stage < definition.lairSurvey.minimumStage) {
    fail("locator-journal-item-purpose", "lair effect does not satisfy its exact survey item contract");
  }
  const result: RustTerrainLocatorEffectJournalV1 = Object.freeze({
    schema: RUST_TERRAIN_LOCATOR_EFFECT_JOURNAL_SCHEMA_V1,
    phase: "prepared",
    world,
    actorId,
    position,
    selectedSlot,
    compatibilityStack,
    plan: canonical.record,
    effect,
    effectHash: computedEffectHash,
  });
  let json: string;
  try { json = JSON.stringify(result); }
  catch (error) { return fail("locator-journal-json", "locator effect journal is not JSON-safe", error); }
  if (bytesLength(json) > RUST_TERRAIN_LOCATOR_EFFECT_JOURNAL_MAX_JSON_BYTES_V1) {
    fail("locator-journal-size", "locator effect journal exceeds its durable JSON byte budget");
  }
  return result;
}

function settlementResultRecord(result: SettlementLocatorResultV1): RustTerrainSettlementLocatorResultRecordV1 {
  return checkedSettlementResult({
    schemaVersion: result.schemaVersion,
    epoch: result.epoch,
    taskId: result.taskId,
    requestHash: result.requestHash,
    entries: result.entries.map((entry) => ({
      ...entry,
      distanceSquaredMillis: entry.distanceSquaredMillis.toString(10),
      publicArrival: entry.publicArrival,
    })),
    resultHash: result.resultHash,
  });
}

function lairResultRecord(result: DragonLairLocatorResultV1): RustTerrainDragonLairLocatorResultRecordV1 {
  if (result.entry === null) {
    return fail("locator-journal-lair-result", "an empty dragon lair result cannot prepare an item transaction");
  }
  return checkedLairResult({
    schemaVersion: result.schemaVersion,
    epoch: result.epoch,
    taskId: result.taskId,
    requestHash: result.requestHash,
    entry: { ...result.entry, distanceSquaredMillis: result.entry.distanceSquaredMillis.toString(10) },
    resultHash: result.resultHash,
  });
}

export function createRustTerrainSettlementChartEffectV1(
  result: SettlementLocatorResultV1,
  applyEntryIds: readonly string[],
  discoveredAt: number,
): RustTerrainSettlementChartEffectV1 {
  return checkedEffect({ kind: "chart", discoveredAt, result: settlementResultRecord(result), applyEntryIds }) as RustTerrainSettlementChartEffectV1;
}

export function createRustTerrainDragonLairEffectV1(
  result: DragonLairLocatorResultV1,
  discoveredAt: number,
): RustTerrainDragonLairEffectV1 {
  return checkedEffect({ kind: "lair", discoveredAt, result: lairResultRecord(result) }) as RustTerrainDragonLairEffectV1;
}

export function createRustTerrainLocatorEffectJournalV1(
  input: CreateRustTerrainLocatorEffectJournalV1,
): RustTerrainLocatorEffectJournalV1 {
  const canonical = canonicalPlan(input.plan);
  const effect = checkedEffect(input.effect);
  return checkedJournal({
    schema: RUST_TERRAIN_LOCATOR_EFFECT_JOURNAL_SCHEMA_V1,
    phase: "prepared",
    world: input.world,
    actorId: input.actorId,
    position: input.position,
    selectedSlot: input.selectedSlot,
    compatibilityStack: input.compatibilityStack,
    plan: canonical.record,
    effect,
    effectHash: effectHash(effect),
  });
}

export function rehydrateRustTerrainLocatorEffectJournalV1(
  recordOrJson: RustTerrainLocatorEffectJournalV1 | string | unknown,
): RustTerrainLocatorEffectJournalV1 {
  let parsed: unknown = recordOrJson;
  if (typeof recordOrJson === "string") {
    if (bytesLength(recordOrJson) > RUST_TERRAIN_LOCATOR_EFFECT_JOURNAL_MAX_JSON_BYTES_V1) {
      return fail("locator-journal-size", "locator effect journal JSON exceeds its byte budget");
    }
    try { parsed = JSON.parse(recordOrJson); }
    catch (error) { return fail("locator-journal-json", "locator effect journal is not valid JSON", error); }
  }
  return checkedJournal(parsed);
}

export function serializeRustTerrainLocatorEffectJournalV1(
  journal: RustTerrainLocatorEffectJournalV1,
) {
  return JSON.stringify(rehydrateRustTerrainLocatorEffectJournalV1(journal));
}

export function rustTerrainLocatorEffectIdV1(journal: RustTerrainLocatorEffectJournalV1) {
  return rehydrateRustTerrainLocatorEffectJournalV1(journal).plan.commandHash;
}

export function normalizeRustTerrainLocatorAppliedEffectIdsV1(value: unknown) {
  if (!Array.isArray(value) || value.length > RUST_TERRAIN_LOCATOR_APPLIED_EFFECT_IDS_MAX_V1) {
    return fail("locator-journal-ledger", "applied locator effect ledger is malformed or oversized");
  }
  const result = value.map((entry, index) => hash(entry, `applied locator effect ID ${index}`));
  if (new Set(result).size !== result.length) {
    fail("locator-journal-duplicate", "applied locator effect ledger contains duplicate IDs");
  }
  return Object.freeze(result);
}

export function appendRustTerrainLocatorAppliedEffectIdV1(
  value: unknown,
  effectId: string,
) {
  const ledger = normalizeRustTerrainLocatorAppliedEffectIdsV1(value);
  const id = hash(effectId, "applied locator effect ID");
  if (ledger.includes(id)) return ledger;
  return Object.freeze([...ledger, id].slice(-RUST_TERRAIN_LOCATOR_APPLIED_EFFECT_IDS_MAX_V1));
}

export function rustTerrainLocatorEffectWasAppliedV1(value: unknown, effectId: string) {
  return normalizeRustTerrainLocatorAppliedEffectIdsV1(value)
    .includes(hash(effectId, "applied locator effect ID"));
}
