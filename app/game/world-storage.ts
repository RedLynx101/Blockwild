import type { GameMode } from "./data";
import type { WorldSave } from "./engine";
import {
  WORLD_GENERATION_IDENTITY_SCHEMA_V1,
  canonicalWorldGenerationOptionsJsonV1,
  deriveWorldGenerationIdentityV1,
  migrateLegacyWorldSave,
  normalizeWorldOptions,
  type WorldGenerationIdentityV1,
  type WorldOptions,
} from "./world-save-normalization";
import { LEGACY_GAME_VERSION, normalizeGameVersion } from "./version";
import { IndexedDbPersistenceAdapterV1 } from "./indexeddb-persistence-adapter";
import {
  persistencePayloadHashV1,
} from "./persistence-journal-contract";
import {
  RUST_NATIVE_WORLD_LEGACY_SOURCE_FORMAT_V1,
  type RustNativeHistoricalExternalCommitV2,
  type RustNativeHistoricalExternalRecoveryV2,
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
import {
  planRustHistoricalSaveCompatibilityV1,
  type RustHistoricalSaveCompatibilityInputV1,
  type RustHistoricalSaveCompatibilityPlanV1,
} from "./rust-historical-save-compatibility";
import {
  createRustHistoricalStoredWorldEnvelopeV2,
  type RustHistoricalDocumentRevisionIdentityV2,
  type RustHistoricalExternalDescriptorV2,
  type RustHistoricalStoredWorldEnvelopeV2,
} from "./rust-historical-save-persistence";
import { createRustHistoricalSaveStoragePlanInputV1 } from "./rust-historical-save-storage-plan";
import { WorldPersistenceCoordinatorV1 } from "./world-persistence-coordinator";
import {
  WorldImportSourceError,
  assertWorldImportSourceReferenceV1,
  preserveWorldImportSourceV1,
  readWorldImportSourceV1,
  type WorldImportSourceAdapterV1,
  type WorldImportSourceReferenceV1,
} from "./world-import-source";
import { legacyTerrainGeneratorHashV2, stableTerrainGenerationJsonV2 } from "./terrain-generation-contract";

export const WORLD_CATALOG_VERSION = 1;
export const WORLD_EXPORT_VERSION = 1;
export const WORLD_CATALOG_KEY = "blockwild-world-catalog-v1";
export const WORLD_DATA_PREFIX = "blockwild-world-data-v1:";
export const WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1 = "blockwild-native-historical-custody-v1:";
export const LEGACY_WORLD_KEY = "blockwild-world-v2";
export const WORLD_OWNERSHIP = "host-device" as const;
export const WORLD_OWNERSHIP_NOTICE = "Worlds are stored only in this browser on this host device. Export a world to move or back it up.";
const MAX_NAME_LENGTH = 64;
const MAX_SEED_LENGTH = 160;
const MAX_NATIVE_HISTORICAL_PENDING_INTERMEDIATE_DOCUMENTS_V1 = 256;
const HASH_128_PATTERN = /^[0-9a-f]{32}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;

export {
  DEFAULT_WORLD_OPTIONS,
  WORLD_GENERATION_IDENTITY_SCHEMA_V1,
  canonicalWorldGenerationOptionsJsonV1,
  deriveWorldGenerationIdentityV1,
  generationOptionsFromWorldOptions,
  migrateLegacyWorldSave,
  normalizeWorldOptions,
  type SleepRule,
  type WorldDifficulty,
  type WorldGenerationIdentityV1,
  type WorldOptions,
} from "./world-save-normalization";

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

export type RustNativeWorldHydrationV1 = RustNativeWorldPersistenceRecoveryV1
  | RustNativeHistoricalExternalRecoveryV2
  | RustNativeHistoricalExternalCommitV2;

export type RustNativeWorldHydrationOptionsV1 = Readonly<{
  /** Installed native content-manifest identity. Required for g16/g17 external custody. */
  contentHash?: string;
  /** Historical external custody never coexists with R5/native-rich authority. */
  nativePlayerAuthorityRequested?: boolean;
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
type NativeHistoricalHeadV2 = Readonly<{
  catalogWorldId: string;
  session: RustNativeWorldPersistenceSessionV1;
  plan: RustHistoricalSaveCompatibilityPlanV1;
  descriptor: RustHistoricalExternalDescriptorV2;
  envelope: RustHistoricalStoredWorldEnvelopeV2;
}>;
type PreparedNativeHistoricalSourceV1 = Readonly<{
  input: RustHistoricalSaveCompatibilityInputV1;
  plan: RustHistoricalSaveCompatibilityPlanV1;
  document: StoredWorld;
}>;
type NativeHistoricalCustodyAnchorV1 = Readonly<{
  catalogWorldId: string;
  nativeWorldId: string;
  descriptorHash: string;
  currentDocument: RustHistoricalDocumentRevisionIdentityV2;
  planHash: string;
  source: WorldImportSourceReferenceV1;
  contentHash: string;
  worldSeed: string;
  generationIdentity: WorldGenerationIdentityV1;
}>;
type NativeHistoricalPendingDocumentIdentityV1 = Readonly<{
  hash: string;
  byteLength: number;
}>;
type NativeHistoricalPendingMutationV1 = Readonly<{
  baseDescriptorHash: string;
  baseDocument: RustHistoricalDocumentRevisionIdentityV2;
  /** Exact ordered successors after base and before the final document. */
  intermediateDocuments: readonly NativeHistoricalPendingDocumentIdentityV1[];
  predecessorDocument: NativeHistoricalPendingDocumentIdentityV1;
  successorDocument: NativeHistoricalPendingDocumentIdentityV1;
  document: StoredWorld;
  createdAt: number;
  intentHash: string;
}>;
type NativeHistoricalCustodyStateV1 = Readonly<{
  schemaVersion: 1;
  anchor: NativeHistoricalCustodyAnchorV1;
  pending: NativeHistoricalPendingMutationV1 | null;
  stateHash: string;
}>;

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

function normalizeNumber(value: unknown, fallback: number, min: number, max: number, precision = 2) {
  const resolved = clamp(finite(value, fallback), min, max);
  const factor = 10 ** precision;
  return Math.round(resolved * factor) / factor;
}

export function requiredSleepers(options: Pick<WorldOptions, "sleepRule" | "sleepPercentage">, onlinePlayers: number) {
  const players = Math.max(1, Math.floor(Number.isFinite(onlinePlayers) ? onlinePlayers : 1));
  if (options.sleepRule === "any-player") return 1;
  if (options.sleepRule === "all-players") return players;
  return Math.max(1, Math.min(players, Math.ceil(players * Math.max(1, Math.min(100, options.sleepPercentage)) / 100)));
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

function worldGenerationProfileFromSave(save: Pick<WorldSave, "generatorProfile">) {
  return save.generatorProfile === "legacy-v14" ? "legacy-v14" : "world-below-v15";
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

/** Resolve envelope options before save migration erases the source generator version. */
function migrateStoredWorldOptions(options: unknown, sourceSave: unknown): WorldOptions {
  const sourceVersion = isRecord(sourceSave) ? Math.trunc(finite(sourceSave.generatorVersion, -1)) : -1;
  const input = isRecord(options) ? options : {};
  return normalizeWorldOptions(sourceVersion > 0 && sourceVersion < 17
    ? { ...input, settlementPattern: "legacy-scattered-v1" }
    : input);
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
  private nativeHistoricalHead: NativeHistoricalHeadV2 | null = null;
  private nativeHistoricalSerial: Promise<void> = Promise.resolve();
  private nativeHistoricalPendingOperations = 0;
  private readonly nativeHistoricalTransitions = new Set<string>();
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
    await this.nativeHistoricalSerial;
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
    if (this.nativePersistence?.session !== session && this.nativeHistoricalPendingOperations > 0) {
      return fail<true>(
        "unavailable",
        "The current historical native session still has pending saves and cannot be replaced.",
        this.dataKey(this.nativePersistence?.catalogWorldId ?? catalogWorldId),
      );
    }
    if (this.nativePersistence?.session !== session) {
      this.nativeHistoricalHead = null;
      this.nativeHistoricalSerial = Promise.resolve();
    }
    this.nativePersistence = Object.freeze({ catalogWorldId, session });
    return ok(true);
  }

  unbindNativePersistence(session: RustNativeWorldPersistenceSessionV1) {
    if (this.nativePersistence?.session !== session) return ok(true);
    if (this.nativeHistoricalPendingOperations > 0
      || this.nativeHistoricalTransitions.has(this.nativePersistence.catalogWorldId)) {
      return fail<true>(
        "unavailable",
        "Historical native custody is still draining; the persistence session remains bound.",
        this.dataKey(this.nativePersistence.catalogWorldId),
      );
    }
    this.nativePersistence = null;
    this.nativeHistoricalHead = null;
    this.nativeHistoricalSerial = Promise.resolve();
    return ok(true);
  }

  async initializeNativeWorld(catalogWorldId: string, createdAt = this.now()): Promise<WorldStorageResult<RustNativeWorldPersistenceSaveV1>> {
    const binding = this.requireNativeBinding(catalogWorldId);
    if (!binding.ok) return binding;
    try {
      const initialized = await binding.value.initializeNewWorld(createdAt);
      this.nativeHistoricalHead = null;
      return ok(initialized);
    }
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

  async hydrateNativeWorld(
    catalogWorldId: string,
    options: RustNativeWorldHydrationOptionsV1 = {},
  ): Promise<WorldStorageResult<RustNativeWorldHydrationV1>> {
    const binding = this.requireNativeBinding(catalogWorldId);
    if (!binding.ok) return binding;
    try {
      const historical = await this.prepareNativeHistoricalMigrationSource(
        catalogWorldId,
        binding.value.worldId,
        options,
      );
      if (!historical.ok) return historical;
      if (historical.value) {
        const prepared = historical.value;
        if (this.nativeHistoricalTransitions.has(catalogWorldId)) {
          return fail("unavailable", "Historical native custody is already reconciling this world.", this.dataKey(catalogWorldId));
        }
        this.nativeHistoricalTransitions.add(catalogWorldId);
        try {
          const recovered = await binding.value.recoverHistoricalExternal(prepared.plan, prepared.input);
          if (recovered.status === "blocked") {
            return fail("corrupt", `Native Rust historical recovery was blocked: ${recovered.message}`, this.dataKey(catalogWorldId));
          }
          if (recovered.status === "hydrated") {
            return await this.reconcileRecoveredNativeHistoricalHead(
              catalogWorldId,
              binding.value,
              prepared.plan,
              recovered,
            );
          }

          const existingCustody = this.readNativeHistoricalCustodyState(catalogWorldId);
          if (!existingCustody.ok) return existingCustody;
          if (existingCustody.value) {
            return fail(
              "corrupt",
              "Native historical storage is empty but this browser retains an exact custody anchor; neither side was changed.",
              this.dataKey(catalogWorldId),
            );
          }
          const envelope = await createRustHistoricalStoredWorldEnvelopeV2({
            document: prepared.document,
            source: prepared.input.originalSource,
            previous: null,
          });
          const current = this.readDocument(catalogWorldId);
          if (!current.ok) return current;
          if (!this.exactStoredWorld(current.value, prepared.document)) {
            return fail(
              "invalid",
              "The historical browser mirror changed while its initial native custody was being prepared.",
              this.dataKey(catalogWorldId),
            );
          }
          const migrated = await binding.value.migrateHistoricalExternal(
            prepared.plan,
            prepared.input,
            envelope,
            prepared.document.metadata.createdAt,
          );
          const mirrored = this.installNativeHistoricalHeadAndMirror(
            catalogWorldId,
            binding.value,
            prepared.plan,
            migrated,
          );
          return mirrored.ok ? ok(migrated) : mirrored;
        } finally {
          this.nativeHistoricalTransitions.delete(catalogWorldId);
        }
      }

      this.nativeHistoricalHead = null;
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
    try {
      let historicalHead = this.nativeHistoricalHead;
      if (historicalHead
        && historicalHead.catalogWorldId === catalogWorldId
        && historicalHead.session === binding.value) {
        await this.nativeHistoricalSerial;
        historicalHead = this.nativeHistoricalHead;
        if (!historicalHead || historicalHead.catalogWorldId !== catalogWorldId
          || historicalHead.session !== binding.value) {
          return fail("unavailable", "Historical native custody changed before the save could begin.", this.dataKey(catalogWorldId));
        }
        const document = this.readDocument(catalogWorldId);
        if (!document.ok) return document;
        const pending = this.prepareNativeHistoricalPendingSave(
          historicalHead,
          document.value,
          createdAt,
        );
        if (!pending.ok) return pending;
        return ok(await this.enqueueNativeHistoricalSave(
          catalogWorldId,
          binding.value,
          pending.value,
        ));
      }
      return ok(await binding.value.saveNative(createdAt));
    }
    catch (error) { return this.nativePersistenceFailure(catalogWorldId, "save", error); }
  }

  async shutdownNativePersistence() {
    const binding = this.nativePersistence;
    try { await this.nativeHistoricalSerial; }
    finally {
      if (this.nativePersistence === binding) this.nativePersistence = null;
      this.nativeHistoricalHead = null;
      this.nativeHistoricalSerial = Promise.resolve();
      await binding?.session.shutdown();
    }
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
    const committed = this.commitHistoricalAwareDocument(loaded.value, document, nextCatalog);
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
    const committed = this.commitHistoricalAwareDocument(legacy.value, document, nextCatalog);
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
    const committed = this.commitHistoricalAwareDocument(loaded.value, document, nextCatalog, persistencePolicy);
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
    const committed = this.commitHistoricalAwareDocument(loaded.value, document, nextCatalog);
    return committed.ok ? ok({ ...metadata }) : committed;
  }

  renameWorld(id: string, name: string): WorldStorageResult<WorldMetadata> {
    const loaded = this.readDocument(id);
    if (!loaded.ok) return loaded;
    const metadata = { ...loaded.value.metadata, name: normalizeName(name), updatedAt: this.now() };
    const document = { ...loaded.value, metadata };
    const nextCatalog = this.copyCatalog({ worlds: this.catalog.worlds.map((entry) => entry.id === id ? metadata : entry) });
    const committed = this.commitHistoricalAwareDocument(loaded.value, document, nextCatalog);
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
    const committed = this.commitHistoricalAwareDocument(loaded.value, document, nextCatalog);
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
    const committed = this.commitHistoricalAwareDocument(loaded.value, document, nextCatalog);
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
    const historicalCustody = this.readNativeHistoricalCustodyState(id);
    if (!historicalCustody.ok) return historicalCustody;
    if (historicalCustody.value || this.nativeHistoricalHead?.catalogWorldId === id
      || this.nativeHistoricalTransitions.has(id)) {
      return fail(
        "unavailable",
        "Historical native worlds require an exact awaited native-world tombstone before their catalog mirror can be deleted.",
        this.dataKey(id),
      );
    }
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
      this.storage?.removeItem(this.nativeHistoricalCustodyKey(id));
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
    const sourceGeneratorVersion = isRecord(value.world.save)
      && (value.world.save.generatorVersion === 16 || value.world.save.generatorVersion === 17)
      ? `g${value.world.save.generatorVersion}`
      : "";
    const save: WorldSave = {
      ...sourceSave,
      agentWorldFingerprint: `worldfp_import_${id}_${sourceGeneratorVersion}${now.toString(36)}`,
    };
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

  private exactStoredWorld(left: StoredWorld, right: StoredWorld) {
    try { return stableTerrainGenerationJsonV2(left) === stableTerrainGenerationJsonV2(right); }
    catch { return false; }
  }

  private nativeHistoricalCustodyKey(catalogWorldId: string) {
    return `${WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1}${catalogWorldId}`;
  }

  private nativeHistoricalDocumentIdentity(document: StoredWorld): NativeHistoricalPendingDocumentIdentityV1 {
    const bytes = encodeCanonicalWorldSaveValueV1(document);
    return Object.freeze({
      hash: persistencePayloadHashV1(bytes),
      byteLength: bytes.byteLength,
    });
  }

  private sameNativeHistoricalDocumentIdentity(
    left: NativeHistoricalPendingDocumentIdentityV1,
    right: NativeHistoricalPendingDocumentIdentityV1,
  ) {
    return left.hash === right.hash && left.byteLength === right.byteLength;
  }

  private sameNativeHistoricalRevisionIdentity(
    left: RustHistoricalDocumentRevisionIdentityV2,
    right: RustHistoricalDocumentRevisionIdentityV2,
  ) {
    return this.sameNativeHistoricalDocumentIdentity(left, right)
      && left.sha256 === right.sha256
      && left.revision === right.revision;
  }

  private nativeHistoricalStateHash(
    schemaVersion: 1,
    anchor: NativeHistoricalCustodyAnchorV1,
    pending: NativeHistoricalPendingMutationV1 | null,
  ) {
    return persistencePayloadHashV1(encodeCanonicalWorldSaveValueV1({ schemaVersion, anchor, pending }));
  }

  private nativeHistoricalIntentHash(
    value: Omit<NativeHistoricalPendingMutationV1, "intentHash">,
  ) {
    return persistencePayloadHashV1(encodeCanonicalWorldSaveValueV1(value));
  }

  private makeNativeHistoricalState(
    anchor: NativeHistoricalCustodyAnchorV1,
    pending: NativeHistoricalPendingMutationV1 | null,
  ): NativeHistoricalCustodyStateV1 {
    const schemaVersion = 1 as const;
    return Object.freeze({
      schemaVersion,
      anchor,
      pending,
      stateHash: this.nativeHistoricalStateHash(schemaVersion, anchor, pending),
    });
  }

  private parseNativeHistoricalRevisionIdentity(
    value: unknown,
  ): RustHistoricalDocumentRevisionIdentityV2 | null {
    if (!isRecord(value) || !HASH_128_PATTERN.test(String(value.hash))
      || !SHA_256_PATTERN.test(String(value.sha256))
      || !Number.isSafeInteger(value.byteLength) || Number(value.byteLength) < 1
      || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) return null;
    return Object.freeze({
      hash: String(value.hash),
      sha256: String(value.sha256),
      byteLength: Number(value.byteLength),
      revision: Number(value.revision),
    });
  }

  private parseNativeHistoricalDocumentIdentity(
    value: unknown,
  ): NativeHistoricalPendingDocumentIdentityV1 | null {
    if (!isRecord(value) || !HASH_128_PATTERN.test(String(value.hash))
      || !Number.isSafeInteger(value.byteLength) || Number(value.byteLength) < 1) return null;
    return Object.freeze({ hash: String(value.hash), byteLength: Number(value.byteLength) });
  }

  private readNativeHistoricalCustodyState(
    catalogWorldId: string,
  ): WorldStorageResult<NativeHistoricalCustodyStateV1 | null> {
    if (!this.storage) {
      return fail("unavailable", "Historical native custody is unavailable in this browser session.", this.nativeHistoricalCustodyKey(catalogWorldId));
    }
    const key = this.nativeHistoricalCustodyKey(catalogWorldId);
    let raw: string | null;
    try { raw = this.storage.getItem(key); }
    catch (error) { return { ok: false, error: classifyStorageError(error, key) }; }
    if (raw === null) return ok(null);
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.anchor)
        || parsed.pending !== null && !isRecord(parsed.pending)
        || typeof parsed.stateHash !== "string" || !HASH_128_PATTERN.test(parsed.stateHash)) throw new Error("shape");
      const anchorValue = parsed.anchor;
      const currentDocument = this.parseNativeHistoricalRevisionIdentity(anchorValue.currentDocument);
      const generationIdentity = normalizeWorldGenerationIdentityV1(anchorValue.generationIdentity);
      if (!currentDocument || !generationIdentity
        || typeof anchorValue.catalogWorldId !== "string" || anchorValue.catalogWorldId !== catalogWorldId
        || typeof anchorValue.nativeWorldId !== "string"
        || typeof anchorValue.descriptorHash !== "string" || !HASH_128_PATTERN.test(anchorValue.descriptorHash)
        || typeof anchorValue.planHash !== "string" || !HASH_128_PATTERN.test(anchorValue.planHash)
        || typeof anchorValue.contentHash !== "string" || !HASH_128_PATTERN.test(anchorValue.contentHash)
        || typeof anchorValue.worldSeed !== "string" || !anchorValue.worldSeed) throw new Error("anchor");
      assertWorldImportSourceReferenceV1(anchorValue.source);
      const anchor: NativeHistoricalCustodyAnchorV1 = Object.freeze({
        catalogWorldId,
        nativeWorldId: anchorValue.nativeWorldId,
        descriptorHash: anchorValue.descriptorHash,
        currentDocument,
        planHash: anchorValue.planHash,
        source: Object.freeze({ ...anchorValue.source }),
        contentHash: anchorValue.contentHash,
        worldSeed: anchorValue.worldSeed,
        generationIdentity,
      });
      let pending: NativeHistoricalPendingMutationV1 | null = null;
      if (parsed.pending !== null) {
        const pendingValue = parsed.pending as Record<string, unknown>;
        const baseDocument = this.parseNativeHistoricalRevisionIdentity(pendingValue.baseDocument);
        const predecessorDocument = this.parseNativeHistoricalDocumentIdentity(pendingValue.predecessorDocument);
        const successorDocument = this.parseNativeHistoricalDocumentIdentity(pendingValue.successorDocument);
        const intermediateValues = pendingValue.intermediateDocuments;
        if (!Array.isArray(intermediateValues)
          || intermediateValues.length > MAX_NATIVE_HISTORICAL_PENDING_INTERMEDIATE_DOCUMENTS_V1) {
          throw new Error("pending-intermediate-bound");
        }
        const parsedIntermediateDocuments = intermediateValues.map((value) =>
          this.parseNativeHistoricalDocumentIdentity(value));
        if (!baseDocument || !predecessorDocument || !successorDocument
          || parsedIntermediateDocuments.some((value) => value === null)
          || typeof pendingValue.baseDescriptorHash !== "string" || !HASH_128_PATTERN.test(pendingValue.baseDescriptorHash)
          || !Number.isSafeInteger(pendingValue.createdAt) || Number(pendingValue.createdAt) < 0
          || typeof pendingValue.intentHash !== "string" || !HASH_128_PATTERN.test(pendingValue.intentHash)
          || !isRecord(pendingValue.document)) throw new Error("pending");
        const intermediateDocuments = Object.freeze(
          parsedIntermediateDocuments as NativeHistoricalPendingDocumentIdentityV1[],
        );
        const normalized = this.normalizeRecoveredHistoricalDocument(catalogWorldId, pendingValue.document as StoredWorld);
        if (!normalized.ok) throw new Error("pending-document");
        const body = Object.freeze({
          baseDescriptorHash: pendingValue.baseDescriptorHash,
          baseDocument,
          intermediateDocuments,
          predecessorDocument,
          successorDocument,
          document: normalized.value,
          createdAt: Number(pendingValue.createdAt),
        });
        if (pendingValue.baseDescriptorHash !== anchor.descriptorHash
          || !this.sameNativeHistoricalRevisionIdentity(baseDocument, anchor.currentDocument)
          || !this.sameNativeHistoricalDocumentIdentity(
            predecessorDocument,
            intermediateDocuments.at(-1) ?? baseDocument,
          )
          || !this.sameNativeHistoricalDocumentIdentity(
            successorDocument,
            this.nativeHistoricalDocumentIdentity(normalized.value),
          )
          || this.nativeHistoricalIntentHash(body) !== pendingValue.intentHash) throw new Error("pending-binding");
        pending = Object.freeze({ ...body, intentHash: pendingValue.intentHash });
      }
      const state = this.makeNativeHistoricalState(anchor, pending);
      if (state.stateHash !== parsed.stateHash) throw new Error("state-hash");
      return ok(state);
    } catch {
      return fail(
        "corrupt",
        "Historical native custody metadata is corrupt; the browser mirror and native checkpoint were left untouched.",
        key,
      );
    }
  }

  private writeNativeHistoricalCustodyState(
    catalogWorldId: string,
    state: NativeHistoricalCustodyStateV1,
  ): WorldStorageResult<true> {
    if (!this.storage) {
      return fail("unavailable", "Historical native custody is unavailable in this browser session.", this.nativeHistoricalCustodyKey(catalogWorldId));
    }
    try {
      this.storage.setItem(this.nativeHistoricalCustodyKey(catalogWorldId), JSON.stringify(state));
      return ok(true);
    } catch (error) {
      return { ok: false, error: classifyStorageError(error, this.nativeHistoricalCustodyKey(catalogWorldId)) };
    }
  }

  private anchorNativeHistoricalHead(
    catalogWorldId: string,
    nativeWorldId: string,
    plan: RustHistoricalSaveCompatibilityPlanV1,
    descriptor: RustHistoricalExternalDescriptorV2,
    envelope: RustHistoricalStoredWorldEnvelopeV2,
  ): WorldStorageResult<NativeHistoricalCustodyAnchorV1> {
    const currentDocument = this.parseNativeHistoricalRevisionIdentity(envelope.currentDocument);
    if (!currentDocument || !HASH_128_PATTERN.test(descriptor.descriptorHash)
      || !this.sameNativeHistoricalRevisionIdentity(descriptor.mutable.currentDocument, currentDocument)) {
      return fail("corrupt", "Native historical custody returned an invalid descriptor head.", this.dataKey(catalogWorldId));
    }
    return ok(Object.freeze({
      catalogWorldId,
      nativeWorldId,
      descriptorHash: descriptor.descriptorHash,
      currentDocument,
      planHash: plan.planHash,
      source: Object.freeze({ ...envelope.source }),
      contentHash: plan.target.contentHash,
      worldSeed: plan.target.worldSeed,
      generationIdentity: Object.freeze({ ...plan.target.generationIdentity }),
    }));
  }

  private nativeHistoricalAnchorMatchesPlan(
    anchor: NativeHistoricalCustodyAnchorV1,
    plan: RustHistoricalSaveCompatibilityPlanV1,
    nativeWorldId: string,
  ) {
    return anchor.nativeWorldId === nativeWorldId
      && anchor.planHash === plan.planHash
      && anchor.contentHash === plan.target.contentHash
      && anchor.worldSeed === plan.target.worldSeed
      && stableTerrainGenerationJsonV2(anchor.source) === stableTerrainGenerationJsonV2({
        schemaVersion: plan.source.raw.schemaVersion,
        provenance: plan.source.raw.provenance,
        sourceFormat: plan.source.raw.sourceFormat,
        encoding: plan.source.raw.encoding,
        archiveWorldId: plan.source.raw.archiveWorldId,
        objectId: plan.source.raw.objectId,
        rawSha256: plan.source.raw.rawSha256,
        byteLength: plan.source.raw.byteLength,
      })
      && stableTerrainGenerationJsonV2(anchor.generationIdentity)
        === stableTerrainGenerationJsonV2(plan.target.generationIdentity);
  }

  private validateNativeHistoricalDocumentTarget(
    document: StoredWorld,
    anchor: NativeHistoricalCustodyAnchorV1,
  ): WorldStorageResult<true> {
    if (document.metadata.id !== anchor.catalogWorldId
      || document.metadata.seed !== anchor.worldSeed
      || document.save.seed !== anchor.worldSeed
      || !document.importSource
      || stableTerrainGenerationJsonV2(document.importSource) !== stableTerrainGenerationJsonV2(anchor.source)) {
      return fail(
        "invalid",
        "Historical custody cannot move a save across its immutable source, catalog target, or world seed.",
        this.dataKey(anchor.catalogWorldId),
      );
    }
    const generationIdentity = deriveWorldGenerationIdentityV1(document.save, document.options);
    if (stableTerrainGenerationJsonV2(generationIdentity)
      !== stableTerrainGenerationJsonV2(anchor.generationIdentity)
      || stableTerrainGenerationJsonV2(document.metadata.generationIdentity)
        !== stableTerrainGenerationJsonV2(anchor.generationIdentity)) {
      return fail(
        "invalid",
        "Generation-affecting changes are unavailable after historical native custody begins.",
        this.dataKey(anchor.catalogWorldId),
      );
    }
    return ok(true);
  }

  private createNativeHistoricalPendingMutation(
    state: NativeHistoricalCustodyStateV1,
    previousDocument: StoredWorld,
    document: StoredWorld,
    createdAt: number,
  ): WorldStorageResult<NativeHistoricalPendingMutationV1> {
    const target = this.validateNativeHistoricalDocumentTarget(document, state.anchor);
    if (!target.ok) return target;
    const previousIdentity = this.nativeHistoricalDocumentIdentity(previousDocument);
    const expectedPrevious = state.pending?.successorDocument ?? state.anchor.currentDocument;
    if (!this.sameNativeHistoricalDocumentIdentity(previousIdentity, expectedPrevious)) {
      return fail(
        "corrupt",
        "The historical browser mirror no longer matches its exact native head or pending successor.",
        this.dataKey(state.anchor.catalogWorldId),
      );
    }
    const intermediateDocuments = state.pending
      ? Object.freeze([...state.pending.intermediateDocuments, state.pending.successorDocument])
      : Object.freeze([] as NativeHistoricalPendingDocumentIdentityV1[]);
    if (intermediateDocuments.length > MAX_NATIVE_HISTORICAL_PENDING_INTERMEDIATE_DOCUMENTS_V1) {
      return fail(
        "unavailable",
        "The historical successor queue reached its bounded durable ancestry limit; drain native custody before saving again.",
        this.dataKey(state.anchor.catalogWorldId),
      );
    }
    const body = Object.freeze({
      baseDescriptorHash: state.anchor.descriptorHash,
      baseDocument: state.anchor.currentDocument,
      intermediateDocuments,
      predecessorDocument: previousIdentity,
      successorDocument: this.nativeHistoricalDocumentIdentity(document),
      document: cloneJson(document),
      createdAt,
    });
    return ok(Object.freeze({ ...body, intentHash: this.nativeHistoricalIntentHash(body) }));
  }

  private nativeHistoricalPendingRevisionDelta(
    pending: NativeHistoricalPendingMutationV1,
    current: RustHistoricalDocumentRevisionIdentityV2,
  ) {
    const delta = current.revision - pending.baseDocument.revision;
    return Number.isSafeInteger(delta) && delta >= 1
      && delta <= pending.intermediateDocuments.length + 1
      ? delta
      : null;
  }

  private nativeHistoricalPendingMatchesSuccessor(
    pending: NativeHistoricalPendingMutationV1,
    current: RustHistoricalDocumentRevisionIdentityV2,
  ) {
    return this.nativeHistoricalPendingRevisionDelta(pending, current) !== null
      && this.sameNativeHistoricalDocumentIdentity(current, pending.successorDocument);
  }

  private nativeHistoricalPendingIntermediateIndex(
    pending: NativeHistoricalPendingMutationV1,
    current: RustHistoricalDocumentRevisionIdentityV2,
  ) {
    const delta = this.nativeHistoricalPendingRevisionDelta(pending, current);
    if (delta === null) return -1;
    for (let index = pending.intermediateDocuments.length - 1; index >= 0; index -= 1) {
      if (delta <= index + 1
        && this.sameNativeHistoricalDocumentIdentity(current, pending.intermediateDocuments[index]!)) {
        return index;
      }
    }
    return -1;
  }

  private isPreCustodyHistoricalImport(document: StoredWorld) {
    const fingerprint = document.save.agentWorldFingerprint;
    const prefix = `worldfp_import_${document.metadata.id}_g`;
    return document.importSource !== undefined
      && typeof fingerprint === "string"
      && fingerprint.startsWith(prefix)
      && /^(?:16|17)[0-9a-z]+$/u.test(fingerprint.slice(prefix.length));
  }

  private validatePreCustodyHistoricalMutation(
    previous: StoredWorld,
    document: StoredWorld,
  ): WorldStorageResult<true> {
    if (!document.importSource
      || stableTerrainGenerationJsonV2(document.importSource)
        !== stableTerrainGenerationJsonV2(previous.importSource)
      || document.metadata.id !== previous.metadata.id
      || document.metadata.seed !== previous.metadata.seed
      || document.save.seed !== previous.save.seed
      || document.save.generatorVersion !== previous.save.generatorVersion
      || document.save.generatorProfile !== previous.save.generatorProfile
      || document.save.agentWorldFingerprint !== previous.save.agentWorldFingerprint) {
      return fail(
        "invalid",
        "Historical imports cannot change their source, catalog target, seed, generator, profile, or import fingerprint before native custody.",
        this.dataKey(previous.metadata.id),
      );
    }
    if (stableTerrainGenerationJsonV2(document.save.edits)
        !== stableTerrainGenerationJsonV2(previous.save.edits)
      || stableTerrainGenerationJsonV2(document.save.blockFacings ?? {})
        !== stableTerrainGenerationJsonV2(previous.save.blockFacings ?? {})) {
      return fail(
        "invalid",
        "Historical imports cannot change their R4 edits or facings before native custody.",
        this.dataKey(previous.metadata.id),
      );
    }
    if (terrainGenerationInputsChanged(previous.save, previous.options, document.save, document.options)
      || stableTerrainGenerationJsonV2(document.metadata.generationIdentity)
        !== stableTerrainGenerationJsonV2(previous.metadata.generationIdentity)) {
      return fail(
        "invalid",
        "Generation-affecting changes are unavailable before historical native custody begins.",
        this.dataKey(previous.metadata.id),
      );
    }
    return ok(true);
  }

  private validateInitialNativeHistoricalDocument(
    document: StoredWorld,
    input: RustHistoricalSaveCompatibilityInputV1,
  ): WorldStorageResult<true> {
    const baseline = input.normalizedSource.save;
    if (!document.importSource
      || stableTerrainGenerationJsonV2(document.importSource)
        !== stableTerrainGenerationJsonV2(input.originalSource)
      || document.metadata.id !== input.target.catalogWorldId
      || document.metadata.seed !== input.target.worldSeed
      || document.save.seed !== input.target.worldSeed
      || document.save.generatorVersion !== baseline.generatorVersion
      || document.save.generatorProfile !== baseline.generatorProfile
      || document.save.agentWorldFingerprint !== baseline.agentWorldFingerprint) {
      return fail(
        "invalid",
        "The current historical document changed its immutable source, target, seed, generator, profile, or import fingerprint.",
        this.dataKey(document.metadata.id),
      );
    }
    if (stableTerrainGenerationJsonV2(document.save.edits)
        !== stableTerrainGenerationJsonV2(baseline.edits)
      || stableTerrainGenerationJsonV2(document.save.blockFacings ?? {})
        !== stableTerrainGenerationJsonV2(baseline.blockFacings ?? {})) {
      return fail(
        "invalid",
        "The current historical document changed its exact R4 edits or facings before native custody.",
        this.dataKey(document.metadata.id),
      );
    }
    const derived = deriveWorldGenerationIdentityV1(document.save, document.options);
    if (stableTerrainGenerationJsonV2(derived)
        !== stableTerrainGenerationJsonV2(input.target.generationIdentity)
      || stableTerrainGenerationJsonV2(document.metadata.generationIdentity)
        !== stableTerrainGenerationJsonV2(input.target.generationIdentity)) {
      return fail(
        "invalid",
        "The current historical document changed its immutable generation target.",
        this.dataKey(document.metadata.id),
      );
    }
    return ok(true);
  }

  private commitHistoricalAwareDocument(
    previousDocument: StoredWorld | StoredWorldShell,
    document: StoredWorld,
    nextCatalog: WorldCatalog,
    persistencePolicy: DocumentPersistencePolicy = "schedule",
  ): WorldStorageResult<true> {
    const catalogWorldId = document.metadata.id;
    const custody = this.readNativeHistoricalCustodyState(catalogWorldId);
    if (!custody.ok) return custody;
    const activeHead = this.nativeHistoricalHead?.catalogWorldId === catalogWorldId
      ? this.nativeHistoricalHead
      : null;
    if (!custody.value && !activeHead) {
      if (!previousDocument.importSource) {
        return this.commitDocument(document, nextCatalog, persistencePolicy);
      }
      const durablePrevious = this.readDocument(catalogWorldId);
      if (!durablePrevious.ok) return durablePrevious;
      if (!this.isPreCustodyHistoricalImport(durablePrevious.value)) {
        return this.commitDocument(document, nextCatalog, persistencePolicy);
      }
      const guarded = this.validatePreCustodyHistoricalMutation(durablePrevious.value, document);
      if (!guarded.ok) return guarded;
      // Until BWHE exists, the complete browser document is the durable opaque
      // successor. Never misroute a historical import through generic native save.
      return this.commitDocument(document, nextCatalog, "local-only");
    }
    if (this.nativeHistoricalTransitions.has(catalogWorldId)) {
      return fail(
        "unavailable",
        "Historical native custody is reconciling; this mutation was not applied.",
        this.dataKey(catalogWorldId),
      );
    }
    if (!custody.value) {
      return fail(
        "unavailable",
        "Historical native custody has no durable browser anchor; this mutation was not applied.",
        this.dataKey(catalogWorldId),
      );
    }
    const durablePrevious = this.readDocument(catalogWorldId);
    if (!durablePrevious.ok) return durablePrevious;
    if (stableTerrainGenerationJsonV2(previousDocument.metadata)
      !== stableTerrainGenerationJsonV2(durablePrevious.value.metadata)
      || stableTerrainGenerationJsonV2(previousDocument.options)
        !== stableTerrainGenerationJsonV2(durablePrevious.value.options)) {
      return fail(
        "unavailable",
        "The historical browser mirror changed before its pending successor could be staged.",
        this.dataKey(catalogWorldId),
      );
    }
    if (activeHead && !custody.value.pending
      && (activeHead.session.worldId !== custody.value.anchor.nativeWorldId
        || activeHead.descriptor.descriptorHash !== custody.value.anchor.descriptorHash)) {
      return fail(
        "corrupt",
        "Historical native custody and its browser anchor disagree; this mutation was not applied.",
        this.dataKey(catalogWorldId),
      );
    }
    const pending = this.createNativeHistoricalPendingMutation(
      custody.value,
      durablePrevious.value,
      document,
      this.now(),
    );
    if (!pending.ok) return pending;
    const previousState = custody.value;
    const staged = this.writeNativeHistoricalCustodyState(
      catalogWorldId,
      this.makeNativeHistoricalState(previousState.anchor, pending.value),
    );
    if (!staged.ok) return staged;
    const committed = this.commitDocument(document, nextCatalog, "local-only");
    if (!committed.ok) {
      const rolledBack = this.writeNativeHistoricalCustodyState(catalogWorldId, previousState);
      if (!rolledBack.ok) this.diagnostics.push(rolledBack.error);
      return committed;
    }
    if (persistencePolicy === "schedule" && activeHead) {
      this.scheduleNativeHistoricalPendingSave(activeHead, pending.value);
    }
    return committed;
  }

  private historicalSourceGeneratorVersion(bytes: Uint8Array): 16 | 17 | null {
    try {
      const root = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      if (!isRecord(root) || root.format !== "blockwild-world" || root.version !== WORLD_EXPORT_VERSION
        || !isRecord(root.world) || root.world.version !== WORLD_CATALOG_VERSION
        || !isRecord(root.world.save)) return null;
      return root.world.save.generatorVersion === 16 || root.world.save.generatorVersion === 17
        ? root.world.save.generatorVersion
        : null;
    } catch { return null; }
  }

  private historicalPlanningDocument(bytes: Uint8Array, document: StoredWorld): StoredWorld | null {
    try {
      const root = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      if (!isRecord(root) || !isRecord(root.world) || !isRecord(root.world.save)
        || !isRecord(root.world.options)
        || root.world.save.generatorVersion !== 16 && root.world.save.generatorVersion !== 17) return null;
      // The immutable compatibility plan is reconstructed from archived source
      // options. Mutable runtime options in the browser mirror must not redefine
      // that plan, while metadata.generationIdentity below still rejects any
      // actual generation-target drift.
      return Object.freeze({
        ...document,
        options: migrateStoredWorldOptions(root.world.options, root.world.save),
      });
    } catch { return null; }
  }

  private async prepareNativeHistoricalMigrationSource(
    catalogWorldId: string,
    nativeWorldId: string,
    options: RustNativeWorldHydrationOptionsV1,
  ): Promise<WorldStorageResult<PreparedNativeHistoricalSourceV1 | null>> {
    const sourceReference = this.readImportSourceReference(catalogWorldId);
    if (!sourceReference.ok) return sourceReference;
    if (!sourceReference.value) return ok(null);

    const archived = await this.readOriginalImportedWorldSource(catalogWorldId);
    if (!archived.ok) return archived;
    if (this.historicalSourceGeneratorVersion(archived.value) === null) return ok(null);
    if (options.nativePlayerAuthorityRequested) {
      return fail(
        "invalid",
        "Historical rich-save custody cannot start while R5 player or native-rich authority is requested.",
        this.dataKey(catalogWorldId),
      );
    }
    if (!options.contentHash) {
      return fail(
        "invalid",
        "Historical rich-save custody requires the installed native content-manifest identity.",
        this.dataKey(catalogWorldId),
      );
    }

    // Re-read after the asynchronous archive fetch. The exact source
    // reference, target identity, and current browser mirror must all belong
    // to the same post-fetch catalog view.
    const current = this.readDocument(catalogWorldId);
    if (!current.ok) return current;
    if (!current.value.importSource) {
      return fail("invalid", "Historical import provenance changed during native preflight.", this.dataKey(catalogWorldId));
    }
    try {
      const planningDocument = this.historicalPlanningDocument(archived.value, current.value);
      if (!planningDocument) {
        return fail("invalid", "Historical source could not reconstruct its immutable option target.", this.dataKey(catalogWorldId));
      }
      const input = createRustHistoricalSaveStoragePlanInputV1({
        catalogWorldId,
        nativeWorldId,
        contentHash: options.contentHash,
        sourceReference: current.value.importSource,
        sourceBytes: archived.value,
        document: planningDocument,
      });
      const currentDocument = this.validateInitialNativeHistoricalDocument(current.value, input);
      if (!currentDocument.ok) return currentDocument;
      const plan = await planRustHistoricalSaveCompatibilityV1(input);
      return ok(Object.freeze({ input, plan, document: cloneJson(current.value) }));
    } catch (error) {
      return fail(
        "invalid",
        `Historical rich-save preflight was rejected: ${error instanceof Error ? error.message : "compatibility planning failed"}`,
        this.dataKey(catalogWorldId),
      );
    }
  }

  private readImportSourceReference(
    catalogWorldId: string,
  ): WorldStorageResult<WorldImportSourceReferenceV1 | null> {
    this.ensureCatalogCurrent();
    const key = this.dataKey(catalogWorldId);
    if (!this.catalog.worlds.some((entry) => entry.id === catalogWorldId)) {
      return fail("not-found", "That world does not exist on this device.", key);
    }
    if (!this.storage) return fail("unavailable", "World storage is unavailable in this browser session.", key);
    let raw: string | null;
    try { raw = this.storage.getItem(key); }
    catch (error) { return { ok: false, error: classifyStorageError(error, key) }; }
    if (!raw) return fail("corrupt", "This world's local data is missing. Other worlds were left untouched.", key);
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { return fail("corrupt", "This world's local data is corrupt. Other worlds were left untouched.", key); }
    if (!isRecord(value) || value.version !== WORLD_CATALOG_VERSION) {
      return fail("unsupported-version", "This world uses an unsupported storage version.", key);
    }
    if (value.importSource === undefined) return ok(null);
    try {
      assertWorldImportSourceReferenceV1(value.importSource);
      return ok(Object.freeze({ ...value.importSource }));
    } catch {
      return fail("corrupt", "This world's original-file source reference is corrupt.", key);
    }
  }

  private normalizeRecoveredHistoricalDocument(
    catalogWorldId: string,
    value: StoredWorld,
  ): WorldStorageResult<StoredWorld> {
    if (!value || value.version !== WORLD_CATALOG_VERSION || !value.importSource) {
      return fail("corrupt", "Native historical recovery returned no complete external StoredWorld mirror.", this.dataKey(catalogWorldId));
    }
    const save = migrateLegacyWorldSave(value.save);
    if (!save) {
      return fail("corrupt", "Native historical recovery returned an invalid external save payload.", this.dataKey(catalogWorldId));
    }
    const metadata = normalizeMetadata(value.metadata, {
      id: catalogWorldId,
      save,
      now: value.metadata.createdAt,
    });
    if (!metadata || metadata.id !== catalogWorldId || metadata.ownership !== WORLD_OWNERSHIP
      || metadata.seed !== save.seed || metadata.generationIdentity === null) {
      return fail("corrupt", "Native historical recovery crossed its exact catalog or generation target.", this.dataKey(catalogWorldId));
    }
    let importSource: WorldImportSourceReferenceV1;
    try {
      assertWorldImportSourceReferenceV1(value.importSource);
      importSource = Object.freeze({ ...value.importSource });
    } catch {
      return fail("corrupt", "Native historical recovery returned invalid original-file provenance.", this.dataKey(catalogWorldId));
    }
    const normalized: StoredWorld = {
      version: WORLD_CATALOG_VERSION,
      metadata,
      options: migrateStoredWorldOptions(value.options, value.save),
      save,
      importSource,
    };
    if (!this.exactStoredWorld(normalized, value)) {
      return fail("corrupt", "Native historical recovery returned a non-canonical external StoredWorld mirror.", this.dataKey(catalogWorldId));
    }
    return ok(normalized);
  }

  private async reconcileRecoveredNativeHistoricalHead(
    catalogWorldId: string,
    session: RustNativeWorldPersistenceSessionV1,
    plan: RustHistoricalSaveCompatibilityPlanV1,
    recovered: Extract<RustNativeHistoricalExternalRecoveryV2, { status: "hydrated" }>,
  ): Promise<WorldStorageResult<RustNativeWorldHydrationV1>> {
    const recoveredAnchor = this.anchorNativeHistoricalHead(
      catalogWorldId,
      session.worldId,
      plan,
      recovered.descriptor,
      recovered.envelope,
    );
    if (!recoveredAnchor.ok) return recoveredAnchor;
    const state = this.readNativeHistoricalCustodyState(catalogWorldId);
    if (!state.ok) return state;
    if (!state.value) {
      const installed = this.installNativeHistoricalHeadAndMirror(
        catalogWorldId,
        session,
        plan,
        recovered,
      );
      return installed.ok ? ok(recovered) : installed;
    }
    if (!this.nativeHistoricalAnchorMatchesPlan(state.value.anchor, plan, session.worldId)) {
      return fail(
        "corrupt",
        "The durable browser custody anchor differs from the immutable historical source or target.",
        this.dataKey(catalogWorldId),
      );
    }
    const pending = state.value.pending;
    if (!pending) {
      if (state.value.anchor.descriptorHash !== recoveredAnchor.value.descriptorHash
        || !this.sameNativeHistoricalRevisionIdentity(
          state.value.anchor.currentDocument,
          recoveredAnchor.value.currentDocument,
        )) {
        return fail(
          "corrupt",
          "The recovered native historical head differs from its durable browser anchor.",
          this.dataKey(catalogWorldId),
        );
      }
      const installed = this.installNativeHistoricalHeadAndMirror(
        catalogWorldId,
        session,
        plan,
        recovered,
      );
      return installed.ok ? ok(recovered) : installed;
    }

    const target = this.validateNativeHistoricalDocumentTarget(pending.document, state.value.anchor);
    if (!target.ok) return target;
    const recoveredDocumentIdentity = this.nativeHistoricalDocumentIdentity(recovered.document);
    const recoveredDocumentMatchesEnvelope = this.sameNativeHistoricalDocumentIdentity(
      recoveredAnchor.value.currentDocument,
      recoveredDocumentIdentity,
    );
    const recoveredIsCommittedIntent = recoveredDocumentMatchesEnvelope
      && this.nativeHistoricalPendingMatchesSuccessor(pending, recoveredAnchor.value.currentDocument)
      && this.exactStoredWorld(recovered.document, pending.document);
    if (recoveredIsCommittedIntent) {
      const installed = this.installNativeHistoricalHeadAndMirror(
        catalogWorldId,
        session,
        plan,
        recovered,
      );
      return installed.ok ? ok(recovered) : installed;
    }

    const recoveredIsBase = recoveredAnchor.value.descriptorHash === pending.baseDescriptorHash
      && this.sameNativeHistoricalRevisionIdentity(
        recoveredAnchor.value.currentDocument,
        pending.baseDocument,
      );
    const recoveredIntermediateIndex = recoveredDocumentMatchesEnvelope
      ? this.nativeHistoricalPendingIntermediateIndex(pending, recoveredAnchor.value.currentDocument)
      : -1;
    if (!recoveredIsBase && recoveredIntermediateIndex < 0) {
      return fail(
        "corrupt",
        "The recovered native head conflicts with the durable browser successor intent; neither side was changed.",
        this.dataKey(catalogWorldId),
      );
    }
    const envelope = await createRustHistoricalStoredWorldEnvelopeV2({
      document: pending.document,
      source: recovered.envelope.source,
      previous: Object.freeze({
        source: recovered.envelope.source,
        initialDocument: recovered.envelope.initialDocument,
        currentDocument: recovered.envelope.currentDocument,
      }),
    });
    if (!this.sameNativeHistoricalDocumentIdentity(envelope.currentDocument, pending.successorDocument)) {
      return fail("corrupt", "The durable historical successor bytes changed before recovery CAS.", this.dataKey(catalogWorldId));
    }
    const committed = await session.saveHistoricalExternal(
      recovered.descriptor,
      envelope,
      pending.createdAt,
    );
    if (committed.status !== "saved" || committed.worldId !== session.worldId
      || !this.exactStoredWorld(committed.document, pending.document)) {
      return fail("corrupt", "Historical recovery CAS did not attest the pending browser successor.", this.dataKey(catalogWorldId));
    }
    const installed = this.installNativeHistoricalHeadAndMirror(
      catalogWorldId,
      session,
      plan,
      committed,
    );
    return installed.ok ? ok(committed) : installed;
  }

  private installNativeHistoricalHeadAndMirror(
    catalogWorldId: string,
    session: RustNativeWorldPersistenceSessionV1,
    plan: RustHistoricalSaveCompatibilityPlanV1,
    value: RustNativeHistoricalExternalCommitV2 | Extract<RustNativeHistoricalExternalRecoveryV2, { status: "hydrated" }>,
  ): WorldStorageResult<true> {
    if (value.worldId !== session.worldId) {
      return fail("corrupt", "Native historical recovery belongs to another persistence world.", this.dataKey(catalogWorldId));
    }
    if (this.nativePersistence?.catalogWorldId !== catalogWorldId
      || this.nativePersistence.session !== session) {
      return fail("unavailable", "Native historical recovery was superseded before mirror installation.", this.dataKey(catalogWorldId));
    }
    const normalized = this.normalizeRecoveredHistoricalDocument(catalogWorldId, value.document);
    if (!normalized.ok) return normalized;
    const anchor = this.anchorNativeHistoricalHead(
      catalogWorldId,
      session.worldId,
      plan,
      value.descriptor,
      value.envelope,
    );
    if (!anchor.ok) return anchor;
    if (!this.nativeHistoricalAnchorMatchesPlan(anchor.value, plan, session.worldId)) {
      return fail("corrupt", "Native historical custody crossed its immutable plan target.", this.dataKey(catalogWorldId));
    }
    const target = this.validateNativeHistoricalDocumentTarget(normalized.value, anchor.value);
    if (!target.ok) return target;
    const previousState = this.readNativeHistoricalCustodyState(catalogWorldId);
    if (!previousState.ok) return previousState;
    if (previousState.value?.pending) {
      const pending = previousState.value.pending;
      const current = value.envelope.currentDocument;
      if (!this.sameNativeHistoricalDocumentIdentity(current, pending.successorDocument)
        || !this.exactStoredWorld(value.document, pending.document)) {
        return fail(
          "corrupt",
          "Native historical recovery conflicts with a durable browser successor intent.",
          this.dataKey(catalogWorldId),
        );
      }
    }
    this.ensureCatalogCurrent();
    if (!this.catalog.worlds.some((entry) => entry.id === catalogWorldId)) {
      return fail("not-found", "That world does not exist on this device.", this.dataKey(catalogWorldId));
    }
    const mirrored = this.commitDocument(normalized.value, this.copyCatalog({
      worlds: this.catalog.worlds.map((entry) => entry.id === catalogWorldId
        ? { ...normalized.value.metadata }
        : entry),
    }), "local-only");
    if (!mirrored.ok) return mirrored;
    if (this.nativePersistence?.catalogWorldId !== catalogWorldId
      || this.nativePersistence.session !== session) {
      return fail("unavailable", "Native historical recovery was superseded before mirror installation.", this.dataKey(catalogWorldId));
    }
    this.nativeHistoricalHead = Object.freeze({
      catalogWorldId,
      session,
      plan,
      descriptor: value.descriptor,
      envelope: value.envelope,
    });
    const anchored = this.writeNativeHistoricalCustodyState(
      catalogWorldId,
      this.makeNativeHistoricalState(anchor.value, null),
    );
    if (!anchored.ok) return anchored;
    return ok(true);
  }

  private enqueueNativeHistoricalSave(
    catalogWorldId: string,
    session: RustNativeWorldPersistenceSessionV1,
    pending: NativeHistoricalPendingMutationV1,
  ): Promise<RustNativeWorldPersistenceSaveV1> {
    this.nativeHistoricalPendingOperations += 1;
    const operation = this.nativeHistoricalSerial.then(async () => {
      const head = this.nativeHistoricalHead;
      if (!head || head.catalogWorldId !== catalogWorldId || head.session !== session
        || this.nativePersistence?.catalogWorldId !== catalogWorldId
        || this.nativePersistence.session !== session) {
        throw new Error("Historical native save lost its exact recovered custody head");
      }
      const headDocument = head.envelope.currentDocument;
      const matchesBase = head.descriptor.descriptorHash === pending.baseDescriptorHash
        && this.sameNativeHistoricalRevisionIdentity(headDocument, pending.baseDocument);
      const matchesPredecessor = this.sameNativeHistoricalDocumentIdentity(
        headDocument,
        pending.predecessorDocument,
      );
      if (!matchesBase && !matchesPredecessor) {
        throw new Error("Historical native save no longer descends from its exact durable base");
      }
      const currentAnchor = this.anchorNativeHistoricalHead(
        catalogWorldId,
        session.worldId,
        head.plan,
        head.descriptor,
        head.envelope,
      );
      if (!currentAnchor.ok) throw new Error(currentAnchor.error.message);
      const target = this.validateNativeHistoricalDocumentTarget(pending.document, currentAnchor.value);
      if (!target.ok) throw new Error(target.error.message);
      const envelope = await createRustHistoricalStoredWorldEnvelopeV2({
        document: pending.document,
        source: head.envelope.source,
        previous: Object.freeze({
          source: head.envelope.source,
          initialDocument: head.envelope.initialDocument,
          currentDocument: head.envelope.currentDocument,
        }),
      });
      if (!this.sameNativeHistoricalDocumentIdentity(envelope.currentDocument, pending.successorDocument)) {
        throw new Error("Historical pending successor bytes changed before native CAS");
      }
      const committed = await session.saveHistoricalExternal(head.descriptor, envelope, pending.createdAt);
      if (committed.status !== "saved" || committed.worldId !== session.worldId
        || !this.exactStoredWorld(committed.document, pending.document)) {
        throw new Error("Historical native save did not attest the exact external StoredWorld successor");
      }
      this.nativeHistoricalHead = Object.freeze({
        catalogWorldId,
        session,
        plan: head.plan,
        descriptor: committed.descriptor,
        envelope: committed.envelope,
      });
      const advancedAnchor = this.anchorNativeHistoricalHead(
        catalogWorldId,
        session.worldId,
        head.plan,
        committed.descriptor,
        committed.envelope,
      );
      if (!advancedAnchor.ok) throw new Error(advancedAnchor.error.message);
      const state = this.readNativeHistoricalCustodyState(catalogWorldId);
      if (!state.ok || !state.value?.pending) {
        throw new Error(state.ok ? "Historical successor intent disappeared after native CAS" : state.error.message);
      }
      const latest = state.value.pending;
      if (this.sameNativeHistoricalDocumentIdentity(
        committed.envelope.currentDocument,
        latest.successorDocument,
      ) && this.exactStoredWorld(committed.document, latest.document)) {
        const anchored = this.writeNativeHistoricalCustodyState(
          catalogWorldId,
          this.makeNativeHistoricalState(advancedAnchor.value, null),
        );
        if (!anchored.ok) throw new Error(anchored.error.message);
      } else {
        const intermediateIndex = this.nativeHistoricalPendingIntermediateIndex(
          latest,
          committed.envelope.currentDocument,
        );
        if (intermediateIndex < 0) {
          throw new Error("The native historical successor is not in the durable pending ancestry");
        }
        const body = Object.freeze({
          baseDescriptorHash: advancedAnchor.value.descriptorHash,
          baseDocument: advancedAnchor.value.currentDocument,
          intermediateDocuments: Object.freeze(latest.intermediateDocuments.slice(intermediateIndex + 1)),
          predecessorDocument: latest.predecessorDocument,
          successorDocument: latest.successorDocument,
          document: latest.document,
          createdAt: latest.createdAt,
        });
        const rebased = Object.freeze({ ...body, intentHash: this.nativeHistoricalIntentHash(body) });
        const anchored = this.writeNativeHistoricalCustodyState(
          catalogWorldId,
          this.makeNativeHistoricalState(advancedAnchor.value, rebased),
        );
        if (!anchored.ok) throw new Error(anchored.error.message);
      }
      return Object.freeze({
        worldId: committed.worldId,
        saveId: `historical.external.v2.${committed.envelope.currentDocument.revision}`,
        checkpointId: committed.checkpointId,
        checkpointHash: committed.checkpointHash,
        journalSequence: committed.journalSequence,
        records: committed.records,
        commits: committed.commits,
        requestBytes: committed.requestBytes,
        responseBytes: committed.responseBytes,
      });
    });
    const tracked = operation.finally(() => {
      this.nativeHistoricalPendingOperations -= 1;
    });
    this.nativeHistoricalSerial = tracked.then(() => undefined, () => undefined);
    return tracked;
  }

  private prepareNativeHistoricalPendingSave(
    head: NativeHistoricalHeadV2,
    document: StoredWorld,
    createdAt: number,
  ): WorldStorageResult<NativeHistoricalPendingMutationV1> {
    const state = this.readNativeHistoricalCustodyState(head.catalogWorldId);
    if (!state.ok) return state;
    if (!state.value || state.value.anchor.descriptorHash !== head.descriptor.descriptorHash
      || !this.sameNativeHistoricalRevisionIdentity(
        state.value.anchor.currentDocument,
        head.envelope.currentDocument,
      )) {
      return fail(
        "corrupt",
        "Historical native custody has no exact durable browser anchor for this save.",
        this.dataKey(head.catalogWorldId),
      );
    }
    if (state.value.pending) {
      if (!this.sameNativeHistoricalDocumentIdentity(
        state.value.pending.successorDocument,
        this.nativeHistoricalDocumentIdentity(document),
      ) || !this.exactStoredWorld(state.value.pending.document, document)) {
        return fail(
          "corrupt",
          "The historical browser mirror differs from its durable pending successor.",
          this.dataKey(head.catalogWorldId),
        );
      }
      return ok(state.value.pending);
    }
    const pending = this.createNativeHistoricalPendingMutation(state.value, document, document, createdAt);
    if (!pending.ok) return pending;
    const staged = this.writeNativeHistoricalCustodyState(
      head.catalogWorldId,
      this.makeNativeHistoricalState(state.value.anchor, pending.value),
    );
    return staged.ok ? pending : staged;
  }

  private scheduleNativeHistoricalPendingSave(
    head: NativeHistoricalHeadV2,
    pending: NativeHistoricalPendingMutationV1,
  ) {
    void this.enqueueNativeHistoricalSave(head.catalogWorldId, head.session, pending).catch((error) => {
      this.diagnostics.push({
        code: "unavailable",
        message: `The historical native successor remains durably pending. ${error instanceof Error ? error.message : "Persistence unavailable."}`,
        key: this.dataKey(head.catalogWorldId),
      });
    });
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
      try {
        dataCollision = this.storage?.getItem(this.dataKey(candidate)) !== null
          || this.storage?.getItem(this.nativeHistoricalCustodyKey(candidate)) !== null;
      } catch { dataCollision = false; }
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
      const session = this.nativePersistence.session;
      const historical = this.nativeHistoricalHead?.catalogWorldId === document.metadata.id
        && this.nativeHistoricalHead.session === session
        ? this.nativeHistoricalHead
        : null;
      if (historical) {
        const state = this.readNativeHistoricalCustodyState(document.metadata.id);
        if (state.ok && state.value?.pending) {
          this.scheduleNativeHistoricalPendingSave(historical, state.value.pending);
        } else {
          this.diagnostics.push(state.ok
            ? {
                code: "unavailable",
                message: "The historical native save has no durable pending successor intent.",
                key: this.dataKey(document.metadata.id),
              }
            : state.error);
        }
        return;
      }
      const operation = session.saveNative(this.now());
      void operation.catch((error) => {
        this.diagnostics.push({
          code: "unavailable",
          message: `The native Rust save could not commit; the local browser document remains available for recovery. ${error instanceof Error ? error.message : "Persistence unavailable."}`,
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
