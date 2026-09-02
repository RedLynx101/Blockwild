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
import { LEGACY_GAME_VERSION, normalizeGameVersion } from "./version";
import { IndexedDbPersistenceAdapterV1 } from "./indexeddb-persistence-adapter";
import {
  RUST_NATIVE_WORLD_LEGACY_SOURCE_FORMAT_V1,
  type RustNativeWorldCompatibilityProofV1,
  type RustNativeWorldPersistenceRecoveryV1,
  type RustNativeWorldPersistenceSaveV1,
  type RustNativeWorldPersistenceSessionV1,
} from "./rust-native-world-persistence";
import {
  planRustLegacyWorldMigrationV1,
  requireRustLegacyWorldOnlyMigrationV1,
} from "./rust-legacy-world-migration";
import { encodeCanonicalWorldSaveValueV1 } from "./world-save-sharding";
import { WorldPersistenceCoordinatorV1 } from "./world-persistence-coordinator";
import {
  WorldImportSourceError,
  assertWorldImportSourceReferenceV1,
  preserveWorldImportSourceV1,
  readWorldImportSourceV1,
  type WorldImportSourceAdapterV1,
  type WorldImportSourceReferenceV1,
} from "./world-import-source";
import {
  LEGACY_TERRAIN_CONTENT_HASH_V2,
  legacyTerrainGeneratorHashV2,
  stableTerrainGenerationJsonV2,
} from "./terrain-generation-contract";

export const WORLD_CATALOG_VERSION = 1;
export const WORLD_EXPORT_VERSION = 1;
export const WORLD_CATALOG_KEY = "blockwild-world-catalog-v1";
export const WORLD_DATA_PREFIX = "blockwild-world-data-v1:";
export const LEGACY_WORLD_KEY = "blockwild-world-v2";
export const WORLD_OWNERSHIP = "host-device" as const;
export const WORLD_OWNERSHIP_NOTICE = "Worlds are stored only in this browser on this host device. Export a world to move or back it up.";
export const WORLD_GENERATION_IDENTITY_SCHEMA_V1 = 1 as const;

const LEGACY_GENERATOR_MIN_Y = -32;
const MAX_NAME_LENGTH = 64;
const MAX_SEED_LENGTH = 160;

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

export type WorldMetadata = {
  id: string;
  ownership: typeof WORLD_OWNERSHIP;
  name: string;
  seed: string;
  mode: GameMode;
  createdAt: number;
  updatedAt: number;
  lastPlayedAt: number | null;
  playTimeMs: number;
  lastSavedGameVersion: string;
  /** Small fail-closed bootstrap identity. Legacy catalogs intentionally retain null. */
  generationIdentity: WorldGenerationIdentityV1 | null;
};

export type WorldGenerationIdentityV1 = Readonly<{
  schemaVersion: typeof WORLD_GENERATION_IDENTITY_SCHEMA_V1;
  terrainContentHash: string;
  generatorHash: string;
  /** Canonical JSON containing exactly the 11 terrain behavior keys; origin is excluded. */
  generationOptionsJson: string;
}>;

export type StoredWorld = {
  version: typeof WORLD_CATALOG_VERSION;
  metadata: WorldMetadata;
  options: WorldOptions;
  save: WorldSave;
  /** Exact uploaded-file provenance, separate from normalized/native save state. */
  importSource?: WorldImportSourceReferenceV1;
};

export type WorldCatalog = {
  version: typeof WORLD_CATALOG_VERSION;
  ownership: typeof WORLD_OWNERSHIP;
  activeWorldId: string | null;
  legacyMigrated: boolean;
  worlds: WorldMetadata[];
};

export type WorldSortField = "name" | "seed" | "mode" | "createdAt" | "updatedAt" | "lastPlayedAt" | "playTimeMs";
export type WorldSortDirection = "asc" | "desc";
export type WorldListOptions = { sortBy?: WorldSortField; direction?: WorldSortDirection };

export type WorldStorageErrorCode = "unavailable" | "quota" | "corrupt" | "not-found" | "invalid" | "unsupported-version";
export type WorldStorageIssue = {
  code: WorldStorageErrorCode;
  message: string;
  key?: string;
};

export type WorldStorageResult<T> =
  | { ok: true; value: T; warnings?: WorldStorageIssue[] }
  | { ok: false; error: WorldStorageIssue };

export type RustNativeLegacyWorldMigrationBootstrapV1 = Readonly<{
  seed: string;
  generationIdentity: WorldGenerationIdentityV1;
  createdAt: number;
}>;

export type CreateWorldInput = {
  name?: string;
  save: WorldSave;
  options?: Partial<WorldOptions>;
};

export type SaveWorldInput = {
  save: WorldSave;
  playTimeDeltaMs?: number;
  markPlayed?: boolean;
  options?: Partial<WorldOptions>;
};

export type WorldExport = {
  format: "blockwild-world";
  version: typeof WORLD_EXPORT_VERSION;
  exportedAt: number;
  ownershipNotice: string;
  world: StoredWorld;
};

export type WorldStorageDependencies = {
  now?: () => number;
  idFactory?: () => string;
  /** Injectable for storage-event regression tests; defaults to the browser window. */
  storageEventTarget?: StorageEventTarget | null;
  /** Injectable journal coordinator; null keeps the synchronous compatibility path. */
  persistenceCoordinator?: WorldPersistenceCoordinatorV1 | null;
  /** Optional post-runtime Rust authority binding. Compatibility bytes stay protected, never relabeled. */
  nativePersistence?: Readonly<{ catalogWorldId: string; session: RustNativeWorldPersistenceSessionV1 }> | null;
  /** Original-file archive only; independent of the native/generic world journal. */
  importSourceAdapter?: WorldImportSourceAdapterV1 | null;
};

type StorageEventTarget = {
  addEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
};

type StoredWorldShell = Pick<StoredWorld, "version" | "metadata" | "options" | "importSource">
  & Readonly<{ save: Pick<WorldSave, "generatorProfile" | "generatorVersion"> }>;
type CachedWorldShell = { revision: number; shell: StoredWorldShell };
type StorageRevisionState = { catalog: number; documents: Map<string, number> };
type DocumentPersistencePolicy = "schedule" | "local-only";

/**
 * Storage events are not fired in the tab which performed a localStorage
 * write. Keep a tiny same-realm revision ledger as the complementary signal
 * for multiple WorldStorage instances sharing one Storage object.
 */
const STORAGE_REVISIONS = new WeakMap<Storage, StorageRevisionState>();
let DEFAULT_PERSISTENCE_COORDINATOR: WorldPersistenceCoordinatorV1 | null | undefined;

function defaultPersistenceCoordinator() {
  if (DEFAULT_PERSISTENCE_COORDINATOR !== undefined) return DEFAULT_PERSISTENCE_COORDINATOR;
  DEFAULT_PERSISTENCE_COORDINATOR = typeof indexedDB === "undefined"
    ? null
    : new WorldPersistenceCoordinatorV1(new IndexedDbPersistenceAdapterV1(indexedDB));
  return DEFAULT_PERSISTENCE_COORDINATOR;
}

function revisionsFor(storage: Storage | null) {
  if (!storage) return null;
  let revisions = STORAGE_REVISIONS.get(storage);
  if (!revisions) {
    revisions = { catalog: 0, documents: new Map() };
    STORAGE_REVISIONS.set(storage, revisions);
  }
  return revisions;
}

function documentRevision(storage: Storage | null, id: string) {
  return revisionsFor(storage)?.documents.get(id) ?? 0;
}

function bumpDocumentRevision(storage: Storage, id: string) {
  const revisions = revisionsFor(storage)!;
  revisions.documents.set(id, (revisions.documents.get(id) ?? 0) + 1);
  revisions.catalog += 1;
  return revisions;
}

function bumpCatalogRevision(storage: Storage) {
  const revisions = revisionsFor(storage)!;
  revisions.catalog += 1;
  return revisions.catalog;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const finiteTimestamp = (value: unknown, fallback: number) => clamp(Math.trunc(finite(value, fallback)), 0, Number.MAX_SAFE_INTEGER);
const ok = <T>(value: T, warnings?: WorldStorageIssue[]): WorldStorageResult<T> => warnings?.length ? { ok: true, value, warnings } : { ok: true, value };
const fail = <T>(code: WorldStorageErrorCode, message: string, key?: string): WorldStorageResult<T> => ({ ok: false, error: { code, message, ...(key ? { key } : {}) } });

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

export function requiredSleepers(options: Pick<WorldOptions, "sleepRule" | "sleepPercentage">, onlinePlayers: number) {
  const players = Math.max(1, Math.floor(Number.isFinite(onlinePlayers) ? onlinePlayers : 1));
  if (options.sleepRule === "any-player") return 1;
  if (options.sleepRule === "all-players") return players;
  return Math.max(1, Math.min(players, Math.ceil(players * Math.max(1, Math.min(100, options.sleepPercentage)) / 100)));
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

const WORLD_GENERATION_OPTION_KEYS_V1 = Object.freeze([
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
] as const);
const WORLD_GENERATION_IDENTITY_KEYS_V1 = Object.freeze([
  "generationOptionsJson",
  "generatorHash",
  "schemaVersion",
  "terrainContentHash",
] as const);
const WORLD_GENERATION_IDENTITY_HASH_PATTERN_V1 = /^[0-9a-f]{32}$/u;
const MAX_WORLD_GENERATION_OPTIONS_JSON_LENGTH_V1 = 4_096;

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

function normalizeWorldGenerationIdentityV1(value: unknown): WorldGenerationIdentityV1 | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== WORLD_GENERATION_IDENTITY_KEYS_V1.length
    || keys.some((key, index) => key !== WORLD_GENERATION_IDENTITY_KEYS_V1[index])) return null;
  if (value.schemaVersion !== WORLD_GENERATION_IDENTITY_SCHEMA_V1
    || typeof value.terrainContentHash !== "string"
    || !WORLD_GENERATION_IDENTITY_HASH_PATTERN_V1.test(value.terrainContentHash)
    || typeof value.generatorHash !== "string"
    || !WORLD_GENERATION_IDENTITY_HASH_PATTERN_V1.test(value.generatorHash)
    || typeof value.generationOptionsJson !== "string"
    || value.generationOptionsJson.length > MAX_WORLD_GENERATION_OPTIONS_JSON_LENGTH_V1) return null;

  let generationOptions: unknown;
  try {
    generationOptions = JSON.parse(value.generationOptionsJson);
  } catch {
    return null;
  }
  if (!isRecord(generationOptions)) return null;
  const optionKeys = Object.keys(generationOptions).sort();
  if (optionKeys.length !== WORLD_GENERATION_OPTION_KEYS_V1.length
    || optionKeys.some((key, index) => key !== WORLD_GENERATION_OPTION_KEYS_V1[index])) return null;
  const profile = generationOptions.profile;
  if (profile !== "legacy-v14" && profile !== "world-below-v15") return null;
  const canonical = canonicalWorldGenerationOptionsJsonV1(
    generationOptions as Partial<WorldOptions>,
    profile,
  );
  if (canonical !== value.generationOptionsJson) return null;
  return Object.freeze({
    schemaVersion: WORLD_GENERATION_IDENTITY_SCHEMA_V1,
    terrainContentHash: value.terrainContentHash,
    generatorHash: value.generatorHash,
    generationOptionsJson: value.generationOptionsJson,
  });
}

function terrainGenerationInputsChanged(
  previousSave: Pick<WorldSave, "generatorProfile" | "generatorVersion">,
  previousOptions: Partial<WorldOptions> | null,
  nextSave: Pick<WorldSave, "generatorProfile" | "generatorVersion">,
  nextOptions: Partial<WorldOptions> | null,
) {
  return legacyTerrainGeneratorHashV2(`g${previousSave.generatorVersion}`)
      !== legacyTerrainGeneratorHashV2(`g${nextSave.generatorVersion}`)
    || canonicalWorldGenerationOptionsJsonV1(previousOptions, worldGenerationProfileFromSave(previousSave))
      !== canonicalWorldGenerationOptionsJsonV1(nextOptions, worldGenerationProfileFromSave(nextSave));
}

function normalizeName(value: unknown, fallback = "New World") {
  const name = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ") : "";
  return (name || fallback).slice(0, MAX_NAME_LENGTH);
}

function normalizeSeed(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, MAX_SEED_LENGTH) : "";
}

function normalizeMode(value: unknown): GameMode | null {
  return value === "survival" || value === "builder" ? value : null;
}

function normalizeId(value: unknown) {
  if (typeof value !== "string") return "world";
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "world";
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

/** Resolve envelope options before save migration erases the source generator version. */
function migrateStoredWorldOptions(options: unknown, sourceSave: unknown): WorldOptions {
  const sourceVersion = isRecord(sourceSave) ? Math.trunc(finite(sourceSave.generatorVersion, -1)) : -1;
  const input = isRecord(options) ? options : {};
  return normalizeWorldOptions(sourceVersion > 0 && sourceVersion < 17
    ? { ...input, settlementPattern: "legacy-scattered-v1" }
    : input);
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

function normalizeMetadata(value: unknown, fallback: { id: string; save: WorldSave; now: number }): WorldMetadata | null {
  const input = isRecord(value) ? value : {};
  const mode = normalizeMode(input.mode) ?? fallback.save.mode;
  const seed = normalizeSeed(input.seed) || fallback.save.seed;
  if (!mode || !seed) return null;
  const createdAt = finiteTimestamp(input.createdAt, fallback.now);
  return {
    id: normalizeId(input.id ?? fallback.id),
    ownership: WORLD_OWNERSHIP,
    name: normalizeName(input.name, seed),
    seed,
    mode,
    createdAt,
    updatedAt: Math.max(createdAt, finiteTimestamp(input.updatedAt, createdAt)),
    lastPlayedAt: input.lastPlayedAt === null || input.lastPlayedAt === undefined ? null : finiteTimestamp(input.lastPlayedAt, createdAt),
    playTimeMs: clamp(Math.trunc(finite(input.playTimeMs, 0)), 0, Number.MAX_SAFE_INTEGER),
    lastSavedGameVersion: normalizeGameVersion(input.lastSavedGameVersion, normalizeGameVersion(fallback.save.lastSavedGameVersion)),
    generationIdentity: normalizeWorldGenerationIdentityV1(input.generationIdentity),
  };
}

function classifyStorageError(error: unknown, key?: string): WorldStorageIssue {
  const candidate = error as { name?: string; code?: number; message?: string } | null;
  const quota = candidate?.name === "QuotaExceededError" || candidate?.name === "NS_ERROR_DOM_QUOTA_REACHED" || candidate?.code === 22 || candidate?.code === 1014;
  return {
    code: quota ? "quota" : "unavailable",
    message: quota
      ? "This device has no remaining browser storage for that world. Export or delete another world and try again."
      : "World storage is unavailable in this browser session.",
    ...(key ? { key } : {}),
  };
}

function defaultId() {
  const cryptoApi = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  return `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyCatalog(): WorldCatalog {
  return { version: WORLD_CATALOG_VERSION, ownership: WORLD_OWNERSHIP, activeWorldId: null, legacyMigrated: false, worlds: [] };
}

function metadataFromCatalog(value: unknown, now: number): WorldMetadata | null {
  if (!isRecord(value)) return null;
  const seed = normalizeSeed(value.seed);
  const mode = normalizeMode(value.mode);
  const id = normalizeId(value.id);
  if (!seed || !mode || id !== value.id) return null;
  const createdAt = finiteTimestamp(value.createdAt, now);
  return {
    id,
    ownership: WORLD_OWNERSHIP,
    name: normalizeName(value.name, seed),
    seed,
    mode,
    createdAt,
    updatedAt: Math.max(createdAt, finiteTimestamp(value.updatedAt, createdAt)),
    lastPlayedAt: value.lastPlayedAt === null || value.lastPlayedAt === undefined ? null : finiteTimestamp(value.lastPlayedAt, createdAt),
    playTimeMs: clamp(Math.trunc(finite(value.playTimeMs, 0)), 0, Number.MAX_SAFE_INTEGER),
    lastSavedGameVersion: normalizeGameVersion(value.lastSavedGameVersion, LEGACY_GAME_VERSION),
    generationIdentity: normalizeWorldGenerationIdentityV1(value.generationIdentity),
  };
}

export class WorldStorage {
  readonly diagnostics: WorldStorageIssue[] = [];
  private readonly storage: Storage | null;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly storageEventTarget: StorageEventTarget | null;
  private readonly persistence: WorldPersistenceCoordinatorV1 | null;
  private readonly importSourceAdapter: WorldImportSourceAdapterV1 | null;
  private readonly ownedImportSourceAdapter: IndexedDbPersistenceAdapterV1 | null;
  private importSourceOperations = 0;
  private disposed = false;
  private nativePersistence: Readonly<{ catalogWorldId: string; session: RustNativeWorldPersistenceSessionV1 }> | null;
  private catalog: WorldCatalog = emptyCatalog();
  private catalogStored = false;
  private observedCatalogRevision = 0;
  private catalogDirty = false;
  /**
   * Small, trusted metadata/options snapshots for worlds this runtime has
   * already loaded or written. Autosaves only need this shell plus the new
   * save payload; retaining it avoids synchronously reading, parsing, and
   * migrating the previous (potentially very large) save on every autosave.
   * Full loads and exports still read and validate browser storage normally.
   */
  private readonly trustedDocumentShells = new Map<string, CachedWorldShell>();

  private readonly handleStorageEvent = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== this.storage) return;
    if (event.key === null) {
      this.trustedDocumentShells.clear();
      this.catalogDirty = true;
      return;
    }
    if (event.key === WORLD_CATALOG_KEY) {
      // Metadata lives in both records. Treat a catalog notification as a
      // broad invalidation so a cross-tab rename can never be autosaved away.
      this.trustedDocumentShells.clear();
      this.catalogDirty = true;
      return;
    }
    if (event.key.startsWith(WORLD_DATA_PREFIX)) {
      this.trustedDocumentShells.delete(event.key.slice(WORLD_DATA_PREFIX.length));
      this.catalogDirty = true;
    }
  };

  constructor(storage?: Storage | null, dependencies: WorldStorageDependencies = {}) {
    this.storage = storage === undefined
      ? (typeof window !== "undefined" ? window.localStorage : null)
      : storage;
    this.now = dependencies.now ?? Date.now;
    this.idFactory = dependencies.idFactory ?? defaultId;
    this.storageEventTarget = dependencies.storageEventTarget === undefined
      ? this.defaultStorageEventTarget()
      : dependencies.storageEventTarget;
    this.persistence = dependencies.persistenceCoordinator === undefined ? defaultPersistenceCoordinator() : dependencies.persistenceCoordinator;
    this.ownedImportSourceAdapter = dependencies.importSourceAdapter === undefined ? new IndexedDbPersistenceAdapterV1() : null;
    this.importSourceAdapter = dependencies.importSourceAdapter === undefined ? this.ownedImportSourceAdapter : dependencies.importSourceAdapter;
    this.nativePersistence = dependencies.nativePersistence ?? null;
    this.readCatalog();
    this.observedCatalogRevision = revisionsFor(this.storage)?.catalog ?? 0;
    this.migrateLegacySave();
    this.storageEventTarget?.addEventListener("storage", this.handleStorageEvent);
  }

  dispose() {
    this.disposed = true;
    this.storageEventTarget?.removeEventListener("storage", this.handleStorageEvent);
    this.trustedDocumentShells.clear();
    this.closeIdleImportSourceAdapter();
  }

  async flushPersistence() {
    await this.persistence?.flush();
    await this.nativePersistence?.session.flush();
  }

  /** Bind the already-created Rust runtime for explicit native save/hydration. */
  bindNativePersistence(catalogWorldId: string, session: RustNativeWorldPersistenceSessionV1) {
    this.ensureCatalogCurrent();
    if (!this.catalog.worlds.some((world) => world.id === catalogWorldId)) {
      return fail<true>("not-found", "That world does not exist on this device.", this.dataKey(catalogWorldId));
    }
    if (this.nativePersistence && this.nativePersistence.catalogWorldId !== catalogWorldId) {
      return fail<true>("invalid", "Another world still owns the live Rust persistence session.", this.dataKey(this.nativePersistence.catalogWorldId));
    }
    this.nativePersistence = Object.freeze({ catalogWorldId, session });
    return ok(true);
  }

  unbindNativePersistence(session: RustNativeWorldPersistenceSessionV1) {
    if (this.nativePersistence?.session === session) this.nativePersistence = null;
  }

  async initializeNativeWorld(catalogWorldId: string, createdAt = this.now()): Promise<WorldStorageResult<RustNativeWorldPersistenceSaveV1>> {
    const binding = this.requireNativeBinding(catalogWorldId);
    if (!binding.ok) return binding;
    try { return ok(await binding.value.initializeNewWorld(createdAt)); }
    catch (error) { return this.nativePersistenceFailure(catalogWorldId, "initialize", error); }
  }

  /**
   * Read-only preflight for a catalog entry whose legacy source has no rich
   * browser-owned state. This is the only path allowed to synthesize a missing
   * catalog generation identity before the native worker exists.
   */
  prepareNativeLegacyWorldMigration(
    catalogWorldId: string,
  ): WorldStorageResult<RustNativeLegacyWorldMigrationBootstrapV1> {
    const prepared = this.prepareNativeLegacyMigrationSource(
      catalogWorldId,
      `world:${catalogWorldId}@overworld`,
    );
    if (!prepared.ok) return prepared;
    return ok(Object.freeze({
      seed: prepared.value.seed,
      generationIdentity: prepared.value.generationIdentity,
      createdAt: prepared.value.proof.createdAt,
    }));
  }

  async hydrateNativeWorld(catalogWorldId: string): Promise<WorldStorageResult<RustNativeWorldPersistenceRecoveryV1>> {
    const binding = this.requireNativeBinding(catalogWorldId);
    if (!binding.ok) return binding;
    try {
      const initial = await binding.value.recoverAndHydrate();
      const catalogIdentity = this.catalog.worlds.find((entry) => entry.id === catalogWorldId)?.generationIdentity ?? null;
      if (initial.status === "hydrated" && catalogIdentity) return ok(initial);
      if (initial.status === "blocked" && initial.code !== "compatibility-adapter-required") {
        return fail("corrupt", `Native Rust recovery was blocked: ${initial.message}`, this.dataKey(catalogWorldId));
      }

      // Re-read and re-plan the protected source for every attempt. The stable
      // source/metadata timestamp reproduces the same migration ID after a
      // page, worker, or browser restart; Date.now() is deliberately excluded.
      const prepared = this.prepareNativeLegacyMigrationSource(catalogWorldId, binding.value.worldId);
      if (!prepared.ok) return prepared;
      const { proof } = prepared.value;
      if (initial.status === "empty") {
        await binding.value.migrateLegacyWorldOnly(
          proof.plan,
          proof.canonicalSource,
          proof.createdAt,
          { sourceKey: proof.sourceKey, sourceFormat: proof.sourceFormat },
        );
      }
      const reopened = await binding.value.recoverAndHydrate(proof);
      if (reopened.status !== "hydrated" || !reopened.compatibility || !reopened.migration) {
        const message = reopened.status === "blocked"
          ? reopened.message
          : "Native Rust migration did not reopen with its durable source and semantic attestation.";
        return fail("corrupt", `Native Rust recovery was blocked: ${message}`, this.dataKey(catalogWorldId));
      }
      const promoted = this.promoteNativeLegacyMigrationTarget(
        catalogWorldId,
        binding.value.worldId,
        prepared.value,
      );
      if (!promoted.ok) return promoted;
      return ok(reopened);
    } catch (error) { return this.nativePersistenceFailure(catalogWorldId, "hydrate", error); }
  }

  async saveNativeWorld(catalogWorldId: string, createdAt = this.now()): Promise<WorldStorageResult<RustNativeWorldPersistenceSaveV1>> {
    const binding = this.requireNativeBinding(catalogWorldId);
    if (!binding.ok) return binding;
    try { return ok(await binding.value.saveNative(createdAt)); }
    catch (error) { return this.nativePersistenceFailure(catalogWorldId, "save", error); }
  }

  async shutdownNativePersistence() {
    const binding = this.nativePersistence;
    this.nativePersistence = null;
    await binding?.session.shutdown();
  }

  get ownershipNotice() {
    return WORLD_OWNERSHIP_NOTICE;
  }

  get issues() {
    return this.diagnostics.map((issue) => ({ ...issue }));
  }

  get activeWorldId() {
    this.ensureCatalogCurrent();
    return this.catalog.activeWorldId;
  }

  listWorlds(options: WorldListOptions = {}) {
    this.ensureCatalogCurrent();
    const sortBy = options.sortBy ?? "lastPlayedAt";
    const direction = options.direction ?? "desc";
    const factor = direction === "asc" ? 1 : -1;
    const worlds = this.catalog.worlds.map((metadata) => ({ ...metadata }));
    worlds.sort((left, right) => {
      const a = left[sortBy];
      const b = right[sortBy];
      if (typeof a === "string" && typeof b === "string") return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) * factor;
      const numberA = a === null ? -1 : Number(a);
      const numberB = b === null ? -1 : Number(b);
      const order = numberA === numberB ? left.name.localeCompare(right.name) : numberA - numberB;
      return order * factor;
    });
    return worlds;
  }

  createWorld(input: CreateWorldInput): WorldStorageResult<WorldMetadata> {
    this.ensureCatalogCurrent();
    const save = migrateLegacyWorldSave(input.save);
    if (!save) return fail("invalid", "The new world save is incomplete or invalid.");
    const id = this.uniqueId();
    const now = this.now();
    const options = normalizeWorldOptions(input.options);
    const metadata: WorldMetadata = {
      id,
      ownership: WORLD_OWNERSHIP,
      name: normalizeName(input.name, save.seed),
      seed: save.seed,
      mode: save.mode,
      createdAt: now,
      updatedAt: now,
      lastPlayedAt: null,
      playTimeMs: 0,
      lastSavedGameVersion: normalizeGameVersion(save.lastSavedGameVersion),
      generationIdentity: deriveWorldGenerationIdentityV1(save, options),
    };
    const document: StoredWorld = { version: WORLD_CATALOG_VERSION, metadata, options, save };
    const nextCatalog = this.copyCatalog({ activeWorldId: id, worlds: [...this.catalog.worlds, metadata] });
    const committed = this.commitDocument(document, nextCatalog);
    return committed.ok ? ok({ ...metadata }) : committed;
  }

  loadWorld(id: string, touch = true): WorldStorageResult<StoredWorld> {
    const loaded = this.readDocument(id);
    if (!loaded.ok || !touch) return loaded;
    const now = this.now();
    const metadata = { ...loaded.value.metadata, lastPlayedAt: now };
    const document = { ...loaded.value, metadata };
    const nextCatalog = this.copyCatalog({
      activeWorldId: id,
      worlds: this.catalog.worlds.map((entry) => entry.id === id ? metadata : entry),
    });
    const committed = this.commitDocument(document, nextCatalog);
    if (!committed.ok) return ok(loaded.value, [committed.error]);
    return ok(cloneJson(document));
  }

  /** Hydrate the Rust journal before falling back to the protected browser source. */
  async loadWorldAsync(id: string, touch = true): Promise<WorldStorageResult<StoredWorld>> {
    const legacy = this.readDocument(id);
    if (!legacy.ok || !this.persistence) return touch && legacy.ok ? this.loadWorld(id, true) : legacy;
    let save = legacy.value.save;
    const warnings: WorldStorageIssue[] = [];
    try {
      const journal = await this.persistence.readWorld(id);
      if (journal) save = journal;
      else {
        const raw = this.storage?.getItem(this.dataKey(id));
        if (!raw) throw new Error("legacy world source is unavailable");
        await this.persistence.migrateLegacyWorld({
          worldId: id,
          sourceKey: this.dataKey(id),
          sourcePayload: new TextEncoder().encode(raw),
          sourceFormat: "blockwild-world-v2",
          save,
        });
      }
    } catch (error) {
      const issue: WorldStorageIssue = {
        code: "unavailable",
        message: `The Rust journal could not be hydrated; the protected browser backup was used. ${error instanceof Error ? error.message : "Persistence unavailable."}`,
        key: this.dataKey(id),
      };
      this.diagnostics.push(issue);
      warnings.push(issue);
    }
    if (!touch) return ok({ ...legacy.value, save }, warnings.length ? warnings : undefined);
    const now = this.now();
    const metadata = { ...legacy.value.metadata, seed: save.seed, mode: save.mode, lastPlayedAt: now };
    const document: StoredWorld = { ...legacy.value, metadata, save };
    const nextCatalog = this.copyCatalog({
      activeWorldId: id,
      worlds: this.catalog.worlds.map((entry) => entry.id === id ? metadata : entry),
    });
    const committed = this.commitDocument(document, nextCatalog);
    if (!committed.ok) warnings.push(committed.error);
    return ok(cloneJson(document), warnings.length ? warnings : undefined);
  }

  saveWorld(id: string, input: SaveWorldInput): WorldStorageResult<WorldMetadata> {
    return this.saveWorldWithPersistencePolicy(id, input, "schedule");
  }

  /**
   * Atomically commits the validated compatibility document and catalog only.
   *
   * This is the narrow durability seam used to prepare browser-side recovery
   * state before a native command. It deliberately does not enqueue either
   * generic journal persistence or a native runtime checkpoint; callers must
   * request any later native save explicitly once their command phase allows it.
   */
  saveWorldLocalOnly(id: string, input: SaveWorldInput): WorldStorageResult<WorldMetadata> {
    return this.saveWorldWithPersistencePolicy(id, input, "local-only");
  }

  private saveWorldWithPersistencePolicy(
    id: string,
    input: SaveWorldInput,
    persistencePolicy: DocumentPersistencePolicy,
  ): WorldStorageResult<WorldMetadata> {
    this.ensureCatalogCurrent();
    const cached = this.trustedDocumentShells.get(id);
    const shell = cached?.revision === documentRevision(this.storage, id) ? cached.shell : null;
    if (cached && !shell) this.trustedDocumentShells.delete(id);
    const loaded = shell ? ok(shell) : this.readDocument(id);
    if (!loaded.ok) return loaded;
    const save = migrateLegacyWorldSave(input.save);
    if (!save) return fail("invalid", "The world save is incomplete or invalid.", this.dataKey(id));
    const now = this.now();
    const options = input.options ? normalizeWorldOptions({ ...loaded.value.options, ...input.options }) : loaded.value.options;
    const generationIdentity = terrainGenerationInputsChanged(loaded.value.save, loaded.value.options, save, options)
      ? deriveWorldGenerationIdentityV1(save, options)
      : loaded.value.metadata.generationIdentity;
    const metadata: WorldMetadata = {
      ...loaded.value.metadata,
      seed: save.seed,
      mode: save.mode,
      updatedAt: now,
      lastPlayedAt: input.markPlayed === false ? loaded.value.metadata.lastPlayedAt : now,
      playTimeMs: clamp(Math.trunc(loaded.value.metadata.playTimeMs + normalizeNumber(input.playTimeDeltaMs, 0, 0, Number.MAX_SAFE_INTEGER, 0)), 0, Number.MAX_SAFE_INTEGER),
      lastSavedGameVersion: normalizeGameVersion(save.lastSavedGameVersion),
      generationIdentity,
    };
    const document: StoredWorld = {
      version: loaded.value.version,
      metadata,
      options,
      save,
      ...(loaded.value.importSource ? { importSource: loaded.value.importSource } : {}),
    };
    const nextCatalog = this.copyCatalog({ worlds: this.catalog.worlds.map((entry) => entry.id === id ? metadata : entry) });
    const committed = this.commitDocument(document, nextCatalog, persistencePolicy);
    return committed.ok ? ok({ ...metadata }) : committed;
  }

  addPlayTime(id: string, milliseconds: number): WorldStorageResult<WorldMetadata> {
    const loaded = this.readDocument(id);
    if (!loaded.ok) return loaded;
    const now = this.now();
    const metadata: WorldMetadata = {
      ...loaded.value.metadata,
      updatedAt: now,
      lastPlayedAt: now,
      playTimeMs: clamp(Math.trunc(loaded.value.metadata.playTimeMs + normalizeNumber(milliseconds, 0, 0, Number.MAX_SAFE_INTEGER, 0)), 0, Number.MAX_SAFE_INTEGER),
    };
    const document = { ...loaded.value, metadata };
    const nextCatalog = this.copyCatalog({ worlds: this.catalog.worlds.map((entry) => entry.id === id ? metadata : entry) });
    const committed = this.commitDocument(document, nextCatalog);
    return committed.ok ? ok({ ...metadata }) : committed;
  }

  renameWorld(id: string, name: string): WorldStorageResult<WorldMetadata> {
    const loaded = this.readDocument(id);
    if (!loaded.ok) return loaded;
    const metadata = { ...loaded.value.metadata, name: normalizeName(name), updatedAt: this.now() };
    const document = { ...loaded.value, metadata };
    const nextCatalog = this.copyCatalog({ worlds: this.catalog.worlds.map((entry) => entry.id === id ? metadata : entry) });
    const committed = this.commitDocument(document, nextCatalog);
    return committed.ok ? ok({ ...metadata }) : committed;
  }

  updateWorldOptions(id: string, patch: Partial<WorldOptions>): WorldStorageResult<WorldOptions> {
    const loaded = this.readDocument(id);
    if (!loaded.ok) return loaded;
    const options = normalizeWorldOptions({ ...loaded.value.options, ...patch });
    const metadata: WorldMetadata = {
      ...loaded.value.metadata,
      updatedAt: this.now(),
      generationIdentity: terrainGenerationInputsChanged(loaded.value.save, loaded.value.options, loaded.value.save, options)
        ? deriveWorldGenerationIdentityV1(loaded.value.save, options)
        : loaded.value.metadata.generationIdentity,
    };
    const document: StoredWorld = { ...loaded.value, metadata, options };
    const nextCatalog = this.copyCatalog({ worlds: this.catalog.worlds.map((entry) => entry.id === id ? metadata : entry) });
    const committed = this.commitDocument(document, nextCatalog);
    return committed.ok ? ok({ ...options }) : committed;
  }

  /** Change the rules used on the next load without replacing world contents. */
  updateWorldMode(id: string, mode: GameMode): WorldStorageResult<WorldMetadata> {
    const loaded = this.readDocument(id);
    if (!loaded.ok) return loaded;
    const nextMode: GameMode = mode === "builder" ? "builder" : "survival";
    const metadata: WorldMetadata = { ...loaded.value.metadata, mode: nextMode, updatedAt: this.now() };
    const save: WorldSave = {
      ...loaded.value.save,
      mode: nextMode,
      ...(nextMode === "builder" ? { health: 10, hunger: 10 } : {}),
    };
    const document: StoredWorld = { ...loaded.value, metadata, save };
    const nextCatalog = this.copyCatalog({ worlds: this.catalog.worlds.map((entry) => entry.id === id ? metadata : entry) });
    const committed = this.commitDocument(document, nextCatalog);
    return committed.ok ? ok({ ...metadata }) : committed;
  }

  duplicateWorld(id: string, name?: string): WorldStorageResult<WorldMetadata> {
    const loaded = this.readDocument(id);
    if (!loaded.ok) return loaded;
    return this.createWorld({
      name: name ?? `${loaded.value.metadata.name} Copy`,
      options: loaded.value.options,
      save: loaded.value.save,
    });
  }

  deleteWorld(id: string): WorldStorageResult<WorldMetadata> {
    this.ensureCatalogCurrent();
    const metadata = this.catalog.worlds.find((entry) => entry.id === id);
    if (!metadata) return fail("not-found", "That world does not exist on this device.", this.dataKey(id));
    const remaining = this.catalog.worlds.filter((entry) => entry.id !== id);
    const fallbackActive = [...remaining].sort((a, b) => (b.lastPlayedAt ?? b.updatedAt) - (a.lastPlayedAt ?? a.updatedAt))[0]?.id ?? null;
    const nextCatalog = this.copyCatalog({
      activeWorldId: this.catalog.activeWorldId === id ? fallbackActive : this.catalog.activeWorldId,
      worlds: remaining,
    });
    const committed = this.commitCatalog(nextCatalog);
    if (!committed.ok) return committed;
    this.trustedDocumentShells.delete(id);
    if (this.storage) {
      const revisions = bumpDocumentRevision(this.storage, id);
      this.observedCatalogRevision = revisions.catalog;
    }
    try {
      this.storage?.removeItem(this.dataKey(id));
      void this.persistence?.deleteWorld(id).catch((error) => {
        this.diagnostics.push({ code: "unavailable", message: `The world catalog entry was removed, but its Rust journal cleanup is pending. ${error instanceof Error ? error.message : "Persistence unavailable."}`, key: this.dataKey(id) });
      });
      return ok({ ...metadata });
    } catch (error) {
      return ok({ ...metadata }, [classifyStorageError(error, this.dataKey(id))]);
    }
  }

  setActiveWorld(id: string | null): WorldStorageResult<string | null> {
    this.ensureCatalogCurrent();
    if (id !== null && !this.catalog.worlds.some((entry) => entry.id === id)) {
      return fail("not-found", "That world does not exist on this device.", this.dataKey(id));
    }
    const committed = this.commitCatalog(this.copyCatalog({ activeWorldId: id }));
    return committed.ok ? ok(id) : committed;
  }

  exportWorld(id: string): WorldStorageResult<string> {
    const loaded = this.readDocument(id);
    if (!loaded.ok) return loaded;
    const exported: WorldExport = {
      format: "blockwild-world",
      version: WORLD_EXPORT_VERSION,
      exportedAt: this.now(),
      ownershipNotice: WORLD_OWNERSHIP_NOTICE,
      world: loaded.value,
    };
    try {
      return ok(JSON.stringify(exported, null, 2));
    } catch {
      return fail("invalid", "This world could not be converted to an export file.", this.dataKey(id));
    }
  }

  /** Decoded-text compatibility API. It does not claim original-file provenance. */
  importWorld(json: string): WorldStorageResult<WorldMetadata> {
    return this.publishImportedWorld(json);
  }

  /** Preserve and verify original bytes before any migration/normalization or catalog publication. */
  async importWorldBytes(bytes: Uint8Array): Promise<WorldStorageResult<WorldMetadata>> {
    if (this.disposed || !this.storage || !this.importSourceAdapter) {
      return fail("unavailable", "Original-file import storage is unavailable.");
    }
    this.importSourceOperations += 1;
    try {
      const preserved = await preserveWorldImportSourceV1(this.importSourceAdapter, bytes);
      if (this.disposed) return fail("unavailable", "World storage closed before the preserved import could be published.");
      // Publication retains the established import semantics. The public UI
      // already disables generic persistence; the archive itself never creates
      // a checkpoint in this new world's native or compatibility namespace.
      return this.publishImportedWorld(preserved.json, preserved.reference);
    } catch (error) { return this.importSourceFailure(error); }
    finally { this.importSourceOperations -= 1; this.closeIdleImportSourceAdapter(); }
  }

  async readOriginalImportedWorldSource(id: string): Promise<WorldStorageResult<Uint8Array>> {
    if (this.disposed || !this.storage || !this.importSourceAdapter) return fail("unavailable", "Original-file archive is unavailable.");
    this.ensureCatalogCurrent();
    if (!this.catalog.worlds.some(world => world.id === id)) return fail("not-found", "That world does not exist on this device.", this.dataKey(id));
    let reference: WorldImportSourceReferenceV1;
    try {
      // Recovering an original file must not depend on the current normalized
      // save still being loadable, nor run save migration as a side effect.
      const raw = this.storage.getItem(this.dataKey(id));
      const document: unknown = raw === null ? null : JSON.parse(raw);
      if (!isRecord(document) || document.version !== WORLD_CATALOG_VERSION) return fail("corrupt", "This world's local document is invalid.", this.dataKey(id));
      if (document.importSource === undefined) return fail("not-found", "This world has no original uploaded-file provenance.", this.dataKey(id));
      assertWorldImportSourceReferenceV1(document.importSource);
      reference = Object.freeze({ ...document.importSource });
    } catch (error) { return this.importSourceFailure(error); }
    this.importSourceOperations += 1;
    try { return ok(await readWorldImportSourceV1(this.importSourceAdapter, reference)); }
    catch (error) { return this.importSourceFailure(error); }
    finally { this.importSourceOperations -= 1; this.closeIdleImportSourceAdapter(); }
  }

  private importSourceFailure<T>(error: unknown): WorldStorageResult<T> {
    return error instanceof WorldImportSourceError
      ? fail(error.code, error.message)
      : { ok: false, error: classifyStorageError(error) };
  }

  private closeIdleImportSourceAdapter() {
    if (!this.disposed || this.importSourceOperations !== 0) return;
    void this.ownedImportSourceAdapter?.close().catch(error => {
      this.diagnostics.push(classifyStorageError(error));
    });
  }

  private publishImportedWorld(json: string, importSource?: WorldImportSourceReferenceV1): WorldStorageResult<WorldMetadata> {
    this.ensureCatalogCurrent();
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      return fail("invalid", "That file is not valid JSON.");
    }
    if (!isRecord(value) || value.format !== "blockwild-world") return fail("invalid", "That file is not a Blockwild world export.");
    if (value.version !== WORLD_EXPORT_VERSION) return fail("unsupported-version", "That Blockwild world export uses an unsupported version.");
    if (!isRecord(value.world) || value.world.version !== WORLD_CATALOG_VERSION) return fail("invalid", "The exported world record is incomplete.");
    if (!isRecord(value.world.metadata) || !isRecord(value.world.options)) return fail("invalid", "The exported world metadata or options are incomplete.");
    const sourceSave = migrateLegacyWorldSave(value.world.save);
    if (!sourceSave) return fail("invalid", "The exported world save is corrupt or incomplete.");
    const now = this.now();
    const sourceMetadata = normalizeMetadata(value.world.metadata, { id: "world", save: sourceSave, now });
    if (!sourceMetadata) return fail("invalid", "The exported world metadata is corrupt or incomplete.");
    const id = this.uniqueId(sourceMetadata.id);
    // Imports are distinct world instances. Private runner notebooks must be
    // explicitly relinked instead of silently merging on seed equality.
    const save: WorldSave = { ...sourceSave, agentWorldFingerprint: `worldfp_import_${id}_${now.toString(36)}` };
    const options = migrateStoredWorldOptions(value.world.options, value.world.save);
    const metadata: WorldMetadata = {
      ...sourceMetadata,
      id,
      ownership: WORLD_OWNERSHIP,
      seed: save.seed,
      mode: save.mode,
      updatedAt: Math.max(sourceMetadata.updatedAt, now),
      generationIdentity: deriveWorldGenerationIdentityV1(save, options),
    };
    const document: StoredWorld = { version: WORLD_CATALOG_VERSION, metadata, options, save,
      ...(importSource ? { importSource } : {}) };
    const nextCatalog = this.copyCatalog({
      activeWorldId: this.catalog.activeWorldId ?? id,
      worlds: [...this.catalog.worlds, metadata],
    });
    const committed = this.commitDocument(document, nextCatalog);
    return committed.ok ? ok({ ...metadata }) : committed;
  }

  private readCatalog() {
    if (!this.storage) {
      this.diagnostics.push({ code: "unavailable", message: "World storage is unavailable outside a browser on this host device.", key: WORLD_CATALOG_KEY });
      return;
    }
    let raw: string | null;
    try {
      raw = this.storage.getItem(WORLD_CATALOG_KEY);
    } catch (error) {
      this.diagnostics.push(classifyStorageError(error, WORLD_CATALOG_KEY));
      return;
    }
    if (!raw) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      this.diagnostics.push({ code: "corrupt", message: "The local world catalog is corrupt. Its world data was left untouched.", key: WORLD_CATALOG_KEY });
      return;
    }
    if (!isRecord(value) || value.version !== WORLD_CATALOG_VERSION) {
      this.diagnostics.push({ code: "unsupported-version", message: "The local world catalog uses an unsupported version.", key: WORLD_CATALOG_KEY });
      return;
    }
    const now = this.now();
    const worlds: WorldMetadata[] = [];
    const seen = new Set<string>();
    for (const entry of Array.isArray(value.worlds) ? value.worlds : []) {
      const metadata = metadataFromCatalog(entry, now);
      if (!metadata || seen.has(metadata.id)) {
        this.diagnostics.push({ code: "corrupt", message: "An invalid world catalog entry was ignored.", key: WORLD_CATALOG_KEY });
        continue;
      }
      seen.add(metadata.id);
      worlds.push(metadata);
    }
    const activeWorldId = typeof value.activeWorldId === "string" && seen.has(value.activeWorldId) ? value.activeWorldId : null;
    this.catalog = {
      version: WORLD_CATALOG_VERSION,
      ownership: WORLD_OWNERSHIP,
      activeWorldId,
      legacyMigrated: value.legacyMigrated === true,
      worlds,
    };
    this.catalogStored = true;
  }

  private migrateLegacySave() {
    if (!this.storage || this.catalog.legacyMigrated) return;
    let raw: string | null;
    try {
      raw = this.storage.getItem(LEGACY_WORLD_KEY);
    } catch (error) {
      this.diagnostics.push(classifyStorageError(error, LEGACY_WORLD_KEY));
      return;
    }
    if (!raw) {
      this.catalog.legacyMigrated = true;
      if (this.catalogStored) {
        const committed = this.commitCatalog(this.copyCatalog({ legacyMigrated: true }));
        if (!committed.ok) this.diagnostics.push(committed.error);
      }
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      this.catalog.legacyMigrated = true;
      this.diagnostics.push({ code: "corrupt", message: "The legacy world save is corrupt and was left untouched.", key: LEGACY_WORLD_KEY });
      return;
    }
    const save = migrateLegacyWorldSave(value);
    if (!save) {
      this.catalog.legacyMigrated = true;
      this.diagnostics.push({ code: "corrupt", message: "The legacy world save is incomplete and was left untouched.", key: LEGACY_WORLD_KEY });
      return;
    }
    const now = this.now();
    const id = this.uniqueId("legacy-world");
    const metadata: WorldMetadata = {
      id,
      ownership: WORLD_OWNERSHIP,
      name: normalizeName(`Legacy ${save.seed}`, "Legacy World"),
      seed: save.seed,
      mode: save.mode,
      createdAt: finiteTimestamp(save.savedAt, now),
      updatedAt: finiteTimestamp(save.savedAt, now),
      lastPlayedAt: finiteTimestamp(save.savedAt, now),
      playTimeMs: 0,
      lastSavedGameVersion: normalizeGameVersion(save.lastSavedGameVersion),
      generationIdentity: null,
    };
    const document: StoredWorld = { version: WORLD_CATALOG_VERSION, metadata, options: normalizeWorldOptions({ settlementPattern: "legacy-scattered-v1" }), save };
    const nextCatalog = this.copyCatalog({ activeWorldId: id, legacyMigrated: true, worlds: [...this.catalog.worlds, metadata] });
    const committed = this.commitDocument(document, nextCatalog);
    if (!committed.ok) {
      this.diagnostics.push(committed.error);
      return;
    }
    try {
      this.storage.removeItem(LEGACY_WORLD_KEY);
    } catch (error) {
      this.diagnostics.push(classifyStorageError(error, LEGACY_WORLD_KEY));
    }
  }

  private prepareNativeLegacyMigrationSource(
    catalogWorldId: string,
    nativeWorldId: string,
  ): WorldStorageResult<Readonly<{
    seed: string;
    generationIdentity: WorldGenerationIdentityV1;
    proof: RustNativeWorldCompatibilityProofV1;
  }>> {
    this.ensureCatalogCurrent();
    const metadata = this.catalog.worlds.find((entry) => entry.id === catalogWorldId);
    const key = this.dataKey(catalogWorldId);
    if (!metadata) return fail("not-found", "That world does not exist on this device.", key);
    if (!this.storage) return fail("unavailable", "World storage is unavailable in this browser session.", key);

    let raw: string | null;
    try { raw = this.storage.getItem(key); }
    catch (error) { return { ok: false, error: classifyStorageError(error, key) }; }
    if (!raw) return fail("corrupt", "This world's protected legacy source is missing.", key);

    let stored: unknown;
    try { stored = JSON.parse(raw); }
    catch { return fail("corrupt", "This world's protected legacy source is corrupt.", key); }
    if (!isRecord(stored) || stored.version !== WORLD_CATALOG_VERSION || !isRecord(stored.save)) {
      return fail("unsupported-version", "This world does not contain a supported protected legacy source.", key);
    }
    const source = stored.save;
    if (typeof source.seed !== "string" || source.seed !== metadata.seed) {
      return fail("invalid", "The protected legacy source seed does not match its catalog target.", key);
    }
    if (!Number.isSafeInteger(source.generatorVersion)
      || source.generatorVersion as number < 1
      || source.generatorProfile !== "legacy-v14" && source.generatorProfile !== "world-below-v15") {
      return fail("invalid", "The protected legacy source has no exact supported generator identity.", key);
    }
    const options = normalizeWorldOptions(isRecord(stored.options) ? stored.options : undefined);
    const generationIdentity = deriveWorldGenerationIdentityV1(
      source as Pick<WorldSave, "generatorProfile" | "generatorVersion">,
      options,
    );
    if (metadata.generationIdentity
      && (metadata.generationIdentity.generatorHash !== generationIdentity.generatorHash
        || metadata.generationIdentity.terrainContentHash !== generationIdentity.terrainContentHash
        || metadata.generationIdentity.generationOptionsJson !== generationIdentity.generationOptionsJson)) {
      return fail("invalid", "The protected legacy source does not match its catalog generation target.", key);
    }

    const separator = nativeWorldId.lastIndexOf("@");
    if (separator < 1 || separator === nativeWorldId.length - 1) {
      return fail("invalid", "The native Rust persistence session has an invalid target identity.", key);
    }
    const createdAt = Number.isSafeInteger(source.savedAt) && (source.savedAt as number) >= 0
      ? source.savedAt as number
      : metadata.createdAt;
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      return fail("invalid", "The protected legacy source has no stable migration timestamp.", key);
    }
    try {
      const plan = planRustLegacyWorldMigrationV1({
        save: source,
        address: {
          universeId: nativeWorldId.slice(0, separator),
          locationId: nativeWorldId.slice(separator + 1),
        },
      });
      // This guard is intentionally present at the production call site: rich
      // player/gameplay/entity saves remain byte-for-byte protected until a
      // lossless adapter for those domains exists.
      requireRustLegacyWorldOnlyMigrationV1(plan);
      const canonicalSource = encodeCanonicalWorldSaveValueV1(source);
      return ok(Object.freeze({
        seed: source.seed,
        generationIdentity,
        proof: Object.freeze({
          plan,
          canonicalSource,
          sourceKey: key,
          sourceFormat: RUST_NATIVE_WORLD_LEGACY_SOURCE_FORMAT_V1,
          createdAt,
        }),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "legacy migration planning failed";
      return fail(
        "invalid",
        `This protected compatibility save is not eligible for world-only native migration: ${message}`,
        key,
      );
    }
  }

  /**
   * Promotes only the small catalog bootstrap identity after a fresh Rust
   * semantic attestation. The protected compatibility document remains
   * byte-for-byte untouched. Replanning synchronously closes the cross-tab
   * window between the async native proof and this single-key catalog write.
   */
  private promoteNativeLegacyMigrationTarget(
    catalogWorldId: string,
    nativeWorldId: string,
    expected: Readonly<{
      seed: string;
      generationIdentity: WorldGenerationIdentityV1;
      proof: RustNativeWorldCompatibilityProofV1;
    }>,
  ): WorldStorageResult<true> {
    const verified = this.prepareNativeLegacyMigrationSource(catalogWorldId, nativeWorldId);
    if (!verified.ok) return verified;
    const actual = verified.value;
    const exactIdentity = (left: WorldGenerationIdentityV1, right: WorldGenerationIdentityV1) =>
      left.schemaVersion === right.schemaVersion
      && left.terrainContentHash === right.terrainContentHash
      && left.generatorHash === right.generatorHash
      && left.generationOptionsJson === right.generationOptionsJson;
    const exactBytes = (left: Uint8Array, right: Uint8Array) =>
      left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
    if (actual.seed !== expected.seed
      || !exactIdentity(actual.generationIdentity, expected.generationIdentity)
      || actual.proof.sourceKey !== expected.proof.sourceKey
      || actual.proof.sourceFormat !== expected.proof.sourceFormat
      || actual.proof.createdAt !== expected.proof.createdAt
      || actual.proof.plan.sourceSemanticHash !== expected.proof.plan.sourceSemanticHash
      || actual.proof.plan.projection.projectionHash !== expected.proof.plan.projection.projectionHash
      || !exactBytes(actual.proof.canonicalSource, expected.proof.canonicalSource)) {
      return fail(
        "invalid",
        "The protected legacy source changed while its native migration was being attested.",
        this.dataKey(catalogWorldId),
      );
    }
    this.ensureCatalogCurrent();
    const metadata = this.catalog.worlds.find((entry) => entry.id === catalogWorldId);
    if (!metadata) return fail("not-found", "That world does not exist on this device.", this.dataKey(catalogWorldId));
    if (metadata.generationIdentity) {
      return exactIdentity(metadata.generationIdentity, expected.generationIdentity)
        ? ok(true)
        : fail("invalid", "The catalog generation target changed during native migration.", this.dataKey(catalogWorldId));
    }
    const promoted: WorldMetadata = { ...metadata, generationIdentity: expected.generationIdentity };
    return this.commitCatalog(this.copyCatalog({
      worlds: this.catalog.worlds.map((entry) => entry.id === catalogWorldId ? promoted : entry),
    }));
  }

  private readDocument(id: string): WorldStorageResult<StoredWorld> {
    this.ensureCatalogCurrent();
    const catalogMetadata = this.catalog.worlds.find((entry) => entry.id === id);
    if (!catalogMetadata) return fail("not-found", "That world does not exist on this device.", this.dataKey(id));
    if (!this.storage) return fail("unavailable", "World storage is unavailable in this browser session.", this.dataKey(id));
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.dataKey(id));
    } catch (error) {
      const issue = classifyStorageError(error, this.dataKey(id));
      return { ok: false, error: issue };
    }
    if (!raw) return fail("corrupt", "This world's local data is missing. Other worlds were left untouched.", this.dataKey(id));
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return fail("corrupt", "This world's local data is corrupt. Other worlds were left untouched.", this.dataKey(id));
    }
    if (!isRecord(value) || value.version !== WORLD_CATALOG_VERSION) return fail("unsupported-version", "This world uses an unsupported storage version.", this.dataKey(id));
    const save = migrateLegacyWorldSave(value.save);
    if (!save) return fail("corrupt", "This world's save payload is corrupt or incomplete.", this.dataKey(id));
    let importSource: WorldImportSourceReferenceV1 | undefined;
    if (value.importSource !== undefined) {
      try { assertWorldImportSourceReferenceV1(value.importSource); importSource = Object.freeze({ ...value.importSource }); }
      catch { return fail("corrupt", "This world's original-file source reference is corrupt.", this.dataKey(id)); }
    }
    const document: StoredWorld = {
      version: WORLD_CATALOG_VERSION,
      metadata: { ...catalogMetadata, seed: save.seed, mode: save.mode },
      options: migrateStoredWorldOptions(value.options, value.save),
      save,
      ...(importSource ? { importSource } : {}),
    };
    this.rememberDocumentShell(document);
    return ok(document);
  }

  private uniqueId(preferred?: string) {
    const base = normalizeId(preferred ?? this.idFactory());
    let candidate = base;
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const catalogCollision = this.catalog.worlds.some((entry) => entry.id === candidate);
      let dataCollision = false;
      try { dataCollision = this.storage?.getItem(this.dataKey(candidate)) !== null; } catch { dataCollision = false; }
      if (!catalogCollision && !dataCollision) return candidate;
      candidate = `${base.slice(0, 43)}-${suffix}`;
    }
    return `${base.slice(0, 35)}-${this.now().toString(36)}`;
  }

  private dataKey(id: string) {
    return `${WORLD_DATA_PREFIX}${id}`;
  }

  private copyCatalog(patch: Partial<WorldCatalog>): WorldCatalog {
    return {
      ...this.catalog,
      ...patch,
      version: WORLD_CATALOG_VERSION,
      ownership: WORLD_OWNERSHIP,
      worlds: (patch.worlds ?? this.catalog.worlds).map((metadata) => ({ ...metadata, ownership: WORLD_OWNERSHIP })),
    };
  }

  private commitCatalog(nextCatalog: WorldCatalog): WorldStorageResult<true> {
    if (!this.storage) return fail("unavailable", "World storage is unavailable in this browser session.", WORLD_CATALOG_KEY);
    try {
      this.storage.setItem(WORLD_CATALOG_KEY, JSON.stringify(nextCatalog));
      this.catalog = nextCatalog;
      this.catalogStored = true;
      this.observedCatalogRevision = bumpCatalogRevision(this.storage);
      this.catalogDirty = false;
      return ok(true);
    } catch (error) {
      return { ok: false, error: classifyStorageError(error, WORLD_CATALOG_KEY) };
    }
  }

  private commitDocument(
    document: StoredWorld,
    nextCatalog: WorldCatalog,
    persistencePolicy: DocumentPersistencePolicy = "schedule",
  ): WorldStorageResult<true> {
    if (!this.storage) return fail("unavailable", "World storage is unavailable in this browser session.", this.dataKey(document.metadata.id));
    const key = this.dataKey(document.metadata.id);
    let previousDocument: string | null = null;
    let previousCatalog: string | null = null;
    try {
      previousDocument = this.storage.getItem(key);
      previousCatalog = this.storage.getItem(WORLD_CATALOG_KEY);
      const serializedDocument = JSON.stringify(document);
      const serializedCatalog = JSON.stringify(nextCatalog);
      this.storage.setItem(key, serializedDocument);
      this.storage.setItem(WORLD_CATALOG_KEY, serializedCatalog);
      this.catalog = nextCatalog;
      this.catalogStored = true;
      const revisions = bumpDocumentRevision(this.storage, document.metadata.id);
      this.observedCatalogRevision = revisions.catalog;
      this.catalogDirty = false;
      this.rememberDocumentShell(document, revisions.documents.get(document.metadata.id) ?? 0);
      if (persistencePolicy === "schedule") this.schedulePersistence(document);
      return ok(true);
    } catch (error) {
      try {
        if (previousDocument === null) this.storage.removeItem(key);
        else this.storage.setItem(key, previousDocument);
        if (previousCatalog === null) this.storage.removeItem(WORLD_CATALOG_KEY);
        else this.storage.setItem(WORLD_CATALOG_KEY, previousCatalog);
      } catch {
        // The original payload remains authoritative in memory even if a broken
        // storage implementation also rejects the best-effort rollback.
      }
      return { ok: false, error: classifyStorageError(error, key) };
    }
  }

  private schedulePersistence(document: StoredWorld) {
    if (this.nativePersistence?.catalogWorldId === document.metadata.id) {
      void this.nativePersistence.session.saveNative(this.now()).catch((error) => {
        this.diagnostics.push({
          code: "unavailable",
          message: `The native Rust save could not commit; the protected local compatibility document remains untouched. ${error instanceof Error ? error.message : "Persistence unavailable."}`,
          key: this.dataKey(document.metadata.id),
        });
      });
      return;
    }
    if (!this.persistence) return;
    void this.persistence.persistWorld(document.metadata.id, document.save).catch((error) => {
      this.diagnostics.push({
        code: "unavailable",
        message: `The Rust world journal could not commit; the local compatibility backup remains intact. ${error instanceof Error ? error.message : "Persistence unavailable."}`,
        key: this.dataKey(document.metadata.id),
      });
    });
  }

  private rememberDocumentShell(document: StoredWorld, revision = documentRevision(this.storage, document.metadata.id)) {
    this.trustedDocumentShells.set(document.metadata.id, {
      revision,
      shell: {
        version: document.version,
        metadata: { ...document.metadata },
        options: { ...document.options, enabledFactions: [...document.options.enabledFactions] },
        ...(document.importSource ? { importSource: document.importSource } : {}),
        save: {
          generatorProfile: document.save.generatorProfile,
          generatorVersion: document.save.generatorVersion,
        },
      },
    });
  }

  private requireNativeBinding(catalogWorldId: string): WorldStorageResult<RustNativeWorldPersistenceSessionV1> {
    this.ensureCatalogCurrent();
    if (!this.catalog.worlds.some((world) => world.id === catalogWorldId)) {
      return fail("not-found", "That world does not exist on this device.", this.dataKey(catalogWorldId));
    }
    if (!this.nativePersistence || this.nativePersistence.catalogWorldId !== catalogWorldId) {
      return fail("unavailable", "This world has no live Rust persistence authority binding.", this.dataKey(catalogWorldId));
    }
    return ok(this.nativePersistence.session);
  }

  private nativePersistenceFailure<T>(catalogWorldId: string, operation: string, error: unknown): WorldStorageResult<T> {
    const issue: WorldStorageIssue = {
      code: "unavailable",
      message: `Native Rust persistence could not ${operation} this world. ${error instanceof Error ? error.message : "Persistence unavailable."}`,
      key: this.dataKey(catalogWorldId),
    };
    this.diagnostics.push(issue);
    return { ok: false, error: issue };
  }

  private defaultStorageEventTarget(): StorageEventTarget | null {
    if (typeof window === "undefined" || !this.storage) return null;
    try {
      return this.storage === window.localStorage ? window : null;
    } catch {
      return null;
    }
  }

  private ensureCatalogCurrent() {
    const revision = revisionsFor(this.storage)?.catalog ?? 0;
    if (!this.catalogDirty && revision === this.observedCatalogRevision) return;
    this.catalog = emptyCatalog();
    this.catalogStored = false;
    this.readCatalog();
    this.observedCatalogRevision = revision;
    this.catalogDirty = false;
  }
}
