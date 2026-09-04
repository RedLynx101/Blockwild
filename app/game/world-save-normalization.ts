import type { GameMode } from "./data";
import type { WorldSave } from "./engine";
import { NPC_FACTION_IDS, normalizeEnabledFactions, type NpcFactionId } from "./factions";
import { GENERATOR_VERSION, MIN_Y, WORLD_HEIGHT, type WorldGenerationOptions } from "./world";
import {
  normalizeWorldOriginPreference,
  type LargeTownFrequency,
  type RoadCoverage,
  type SettlementClustering,
  type SettlementPattern,
  type WorldOriginPreference,
} from "./settlement-index";
import { normalizeGameVersion } from "./version";
import {
  LEGACY_TERRAIN_CONTENT_HASH_V2,
  legacyTerrainGeneratorHashV2,
  stableTerrainGenerationJsonV2,
} from "./terrain-generation-contract";

export const WORLD_GENERATION_IDENTITY_SCHEMA_V1 = 1 as const;

const LEGACY_GENERATOR_MIN_Y = -32;

export type WorldDifficulty = "peaceful" | "easy" | "normal" | "hard";
export type SleepRule = "any-player" | "percentage" | "all-players";

export type WorldOptions = {
  difficulty: WorldDifficulty;
  dayLengthMinutes: number;
  mobDensity: number;
  butterflyDensity: number;
  caveFrequency: number;
  biomeScale: number;
  resourceAbundance: number;
  structures: boolean;
  weather: boolean;
  keepInventory: boolean;
  friendlyFire: boolean;
  sleepRule: SleepRule;
  sleepPercentage: number;
  /** Cultures allowed to generate settlements and their aligned residents. */
  enabledFactions: readonly NpcFactionId[];
  settlementPattern: SettlementPattern;
  settlementDensity: number;
  settlementClustering: SettlementClustering;
  roadCoverage: RoadCoverage;
  largeTownFrequency: LargeTownFrequency;
  origin: WorldOriginPreference;
};

export const DEFAULT_WORLD_OPTIONS: Readonly<WorldOptions> = Object.freeze({
  difficulty: "normal",
  dayLengthMinutes: 20,
  mobDensity: 1,
  butterflyDensity: 1,
  caveFrequency: 1,
  biomeScale: 1.35,
  resourceAbundance: 1,
  structures: true,
  weather: true,
  keepInventory: false,
  friendlyFire: false,
  sleepRule: "percentage",
  sleepPercentage: 50,
  enabledFactions: Object.freeze([...NPC_FACTION_IDS]),
  settlementPattern: "heartlands-v2",
  settlementDensity: 1,
  settlementClustering: "regional",
  roadCoverage: "regional",
  largeTownFrequency: "balanced",
  origin: Object.freeze({ mode: "wilderness" }),
});

export type WorldGenerationIdentityV1 = Readonly<{
  schemaVersion: typeof WORLD_GENERATION_IDENTITY_SCHEMA_V1;
  terrainContentHash: string;
  generatorHash: string;
  /** Canonical JSON containing exactly the 11 terrain behavior keys; origin is excluded. */
  generationOptionsJson: string;
}>;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const finiteTimestamp = (value: unknown, fallback: number) => clamp(Math.trunc(finite(value, fallback)), 0, Number.MAX_SAFE_INTEGER);

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number, precision = 2) {
  const resolved = clamp(finite(value, fallback), min, max);
  const factor = 10 ** precision;
  return Math.round(resolved * factor) / factor;
}

export function normalizeWorldOptions(value?: Partial<WorldOptions> | null): WorldOptions {
  const input = isRecord(value) ? value : {};
  const difficulty = ["peaceful", "easy", "normal", "hard"].includes(String(input.difficulty))
    ? input.difficulty as WorldDifficulty
    : DEFAULT_WORLD_OPTIONS.difficulty;
  const sleepRule = ["any-player", "percentage", "all-players"].includes(String(input.sleepRule))
    ? input.sleepRule as SleepRule
    : DEFAULT_WORLD_OPTIONS.sleepRule;
  const enabledFactions = normalizeEnabledFactions(input.enabledFactions);
  const structures = normalizeBoolean(input.structures, DEFAULT_WORLD_OPTIONS.structures);
  const settlementPattern: SettlementPattern = input.settlementPattern === "legacy-scattered-v1" ? "legacy-scattered-v1" : "heartlands-v2";
  const settlementDensity = normalizeNumber(input.settlementDensity, DEFAULT_WORLD_OPTIONS.settlementDensity, 0, 2);
  return {
    difficulty,
    dayLengthMinutes: normalizeNumber(input.dayLengthMinutes, DEFAULT_WORLD_OPTIONS.dayLengthMinutes, 5, 120, 1),
    mobDensity: normalizeNumber(input.mobDensity, DEFAULT_WORLD_OPTIONS.mobDensity, 0, 3),
    butterflyDensity: normalizeNumber(input.butterflyDensity, DEFAULT_WORLD_OPTIONS.butterflyDensity, 0, 4),
    caveFrequency: normalizeNumber(input.caveFrequency, DEFAULT_WORLD_OPTIONS.caveFrequency, 0, 3),
    biomeScale: normalizeNumber(input.biomeScale, DEFAULT_WORLD_OPTIONS.biomeScale, 0.25, 4),
    resourceAbundance: normalizeNumber(input.resourceAbundance, DEFAULT_WORLD_OPTIONS.resourceAbundance, 0.25, 4),
    structures,
    weather: normalizeBoolean(input.weather, DEFAULT_WORLD_OPTIONS.weather),
    keepInventory: normalizeBoolean(input.keepInventory, DEFAULT_WORLD_OPTIONS.keepInventory),
    friendlyFire: normalizeBoolean(input.friendlyFire, DEFAULT_WORLD_OPTIONS.friendlyFire),
    sleepRule,
    sleepPercentage: normalizeNumber(input.sleepPercentage, DEFAULT_WORLD_OPTIONS.sleepPercentage, 1, 100, 0),
    enabledFactions,
    settlementPattern,
    settlementDensity,
    settlementClustering: input.settlementClustering === "even" || input.settlementClustering === "strong" ? input.settlementClustering : "regional",
    roadCoverage: input.roadCoverage === "none" || input.roadCoverage === "local" || input.roadCoverage === "dense" ? input.roadCoverage : "regional",
    largeTownFrequency: input.largeTownFrequency === "rare" || input.largeTownFrequency === "frequent" ? input.largeTownFrequency : "balanced",
    origin: structures && settlementDensity > 0 ? normalizeWorldOriginPreference(input.origin, enabledFactions) : Object.freeze({ mode: "wilderness" }),
  };
}

export function generationOptionsFromWorldOptions(
  value?: Partial<WorldOptions> | null,
  profile: WorldGenerationOptions["profile"] = "world-below-v15",
): WorldGenerationOptions {
  const options = normalizeWorldOptions(value);
  return {
    profile,
    caveFrequency: options.caveFrequency,
    biomeScale: options.biomeScale,
    resourceAbundance: options.resourceAbundance,
    structures: options.structures,
    enabledFactions: options.enabledFactions,
    settlementPattern: options.settlementPattern,
    settlementDensity: options.settlementDensity,
    settlementClustering: options.settlementClustering,
    roadCoverage: options.roadCoverage,
    largeTownFrequency: options.largeTownFrequency,
    origin: options.origin,
  };
}

function worldGenerationProfileFromSave(save: Pick<WorldSave, "generatorProfile">): WorldGenerationOptions["profile"] {
  return save.generatorProfile === "legacy-v14" ? "legacy-v14" : "world-below-v15";
}

/** Canonical terrain behavior JSON used by both the catalog and native runtime bootstrap. */
export function canonicalWorldGenerationOptionsJsonV1(
  value?: Partial<WorldOptions> | null,
  profile: WorldGenerationOptions["profile"] = "world-below-v15",
) {
  const options = generationOptionsFromWorldOptions(value, profile);
  return stableTerrainGenerationJsonV2({
    profile: options.profile,
    caveFrequency: options.caveFrequency,
    biomeScale: options.biomeScale,
    resourceAbundance: options.resourceAbundance,
    structures: options.structures,
    enabledFactions: options.enabledFactions,
    settlementPattern: options.settlementPattern,
    settlementDensity: options.settlementDensity,
    settlementClustering: options.settlementClustering,
    roadCoverage: options.roadCoverage,
    largeTownFrequency: options.largeTownFrequency,
  });
}

/** Derive a fresh identity only when exact save/options bytes are already trusted. */
export function deriveWorldGenerationIdentityV1(
  save: Pick<WorldSave, "generatorProfile" | "generatorVersion">,
  options?: Partial<WorldOptions> | null,
): WorldGenerationIdentityV1 {
  return Object.freeze({
    schemaVersion: WORLD_GENERATION_IDENTITY_SCHEMA_V1,
    terrainContentHash: LEGACY_TERRAIN_CONTENT_HASH_V2,
    generatorHash: legacyTerrainGeneratorHashV2(`g${save.generatorVersion}`),
    generationOptionsJson: canonicalWorldGenerationOptionsJsonV1(options, worldGenerationProfileFromSave(save)),
  });
}

function normalizeSeed(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function normalizeMode(value: unknown): GameMode | null {
  return value === "survival" || value === "builder" ? value : null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeEdits(value: unknown, offset = 0) {
  const edits: Record<string, Array<[number, number]>> = Object.create(null) as Record<string, Array<[number, number]>>;
  if (!isRecord(value)) return edits;
  for (const [key, entries] of Object.entries(value)) {
    if (!/^-?\d+,-?\d+$/.test(key) || !Array.isArray(entries)) continue;
    const safeEntries: Array<[number, number]> = [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || !Number.isFinite(entry[0]) || !Number.isFinite(entry[1])) continue;
      const index = Math.trunc(entry[0] as number) + offset;
      const type = Math.trunc(entry[1] as number);
      // The World Below moved chunk storage to Uint16 so authored blocks can
      // safely use ids above the old byte ceiling. Keep the import boundary
      // bounded to the same representation instead of silently dropping new
      // underground blocks from exported worlds.
      if (index < 0 || index >= 16 * 16 * WORLD_HEIGHT || type < 0 || type > 65_535) continue;
      safeEntries.push([index, type]);
    }
    edits[key] = safeEntries;
  }
  return edits;
}

export function migrateLegacyWorldSave(value: unknown): WorldSave | null {
  if (!isRecord(value) || value.version !== 2) return null;
  const seed = normalizeSeed(value.seed);
  const mode = normalizeMode(value.mode);
  if (!seed || !mode || !isRecord(value.player)) return null;
  const generatorVersion = Math.trunc(finite(value.generatorVersion, -1));
  if (![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, GENERATOR_VERSION].includes(generatorVersion)) return null;
  const offset = generatorVersion === 2 ? (LEGACY_GENERATOR_MIN_Y - MIN_Y) * 16 * 16 : 0;
  const player = value.player;
  if (![player.x, player.y, player.z].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) return null;
  const spawn = isRecord(value.spawn) ? value.spawn : player;
  const weather = value.weather === "rain" ? "rain" : "clear";
  const normalized = {
    ...value,
    version: 2,
    generatorVersion: GENERATOR_VERSION,
    generatorProfile: value.generatorProfile === "legacy-v14" || generatorVersion < 15
      ? "legacy-v14"
      : "world-below-v15",
    lastSavedGameVersion: normalizeGameVersion(value.lastSavedGameVersion),
    options: generatorVersion < 17
      ? { ...(isRecord(value.options) ? value.options : {}), settlementPattern: "legacy-scattered-v1" }
      : value.options,
    seed,
    mode,
    playerVariant: value.playerVariant === "female" ? "female" : "male",
    edits: sanitizeEdits(value.edits, offset),
    player: {
      x: finite(player.x, 0),
      y: finite(player.y, 64),
      z: finite(player.z, 0),
      yaw: finite(player.yaw, 0),
      pitch: clamp(finite(player.pitch, 0), -1.4, 1.4),
    },
    spawn: {
      x: finite(spawn.x, finite(player.x, 0)),
      y: finite(spawn.y, finite(player.y, 64)),
      z: finite(spawn.z, finite(player.z, 0)),
    },
    inventory: Array.isArray(value.inventory) ? value.inventory : [],
    selected: Math.trunc(clamp(finite(value.selected, 0), 0, 8)),
    health: clamp(finite(value.health, 10), 1, 10),
    hunger: clamp(finite(value.hunger, 10), 0, 10),
    xp: Math.max(0, finite(value.xp, 0)),
    level: Math.max(0, Math.trunc(finite(value.level, 0))),
    time: finite(value.time, 0.32),
    day: Math.max(1, Math.trunc(finite(value.day, 1))),
    weather,
    furnaces: isRecord(value.furnaces) ? value.furnaces : {},
    chests: isRecord(value.chests) ? value.chests : {},
    savedAt: finiteTimestamp(value.savedAt, Date.now()),
  } as unknown as WorldSave;
  try {
    return cloneJson(normalized);
  } catch {
    return null;
  }
}
