/**
 * Read-only capture of browser data written before Blockwild editions received
 * separate storage namespaces. Values stay as the exact strings returned by
 * Storage.getItem: this module never parses, normalizes, writes, or removes
 * source data.
 */

export const PREVIOUS_EDITION_BACKUP_FORMAT = "blockwild-previous-edition-backup" as const;
export const PREVIOUS_EDITION_BACKUP_VERSION = 1 as const;
export const PREVIOUS_EDITION_WORLD_DATA_PREFIX = "blockwild-world-data-v1:";

/** Exact, source-backed generic keys used by the pre-split browser game. */
export const PREVIOUS_EDITION_LOCAL_STORAGE_KEYS = Object.freeze([
  "blockwild-agent-id",
  "blockwild-browser-player-id-v1",
  "blockwild-character-profiles-v1",
  "blockwild-multiplayer-player-id",
  "blockwild-player-variant",
  "blockwild-settings-v2",
  "blockwild-ui-preferences-v1",
  "blockwild-world-catalog-v1",
  "blockwild-world-v2",
] as const);

const EXACT_LOCAL_STORAGE_KEYS = new Set<string>(PREVIOUS_EDITION_LOCAL_STORAGE_KEYS);

export type PreviousEditionLocalStorageEntry = Readonly<{
  key: string;
  /** Exact source string; deliberately not parsed or reserialized. */
  value: string;
}>;

export type PreviousEditionBackupV1 = Readonly<{
  format: typeof PREVIOUS_EDITION_BACKUP_FORMAT;
  version: typeof PREVIOUS_EDITION_BACKUP_VERSION;
  localStorage: readonly PreviousEditionLocalStorageEntry[];
  indexedDb: Readonly<{
    status: "not-collected";
    authoritativeDatabase: Readonly<{
      name: "blockwild-rust-persistence-v1";
      version: 3;
      reason: "no-versioned-read-only-whole-database-export-contract";
    }>;
    excludedDisposableDatabases: readonly [Readonly<{
      name: "blockwild-terrain-cache-v2";
      reason: "deterministic-disposable-terrain-cache";
    }>];
  }>;
}>;

type ReadOnlyStorage = Pick<Storage, "length" | "key" | "getItem">;
type StorageIndex = Pick<Storage, "length" | "key">;

function isPreviousEditionLocalStorageKey(key: string) {
  return EXACT_LOCAL_STORAGE_KEYS.has(key)
    || (key.startsWith(PREVIOUS_EDITION_WORLD_DATA_PREFIX)
      && key.length > PREVIOUS_EDITION_WORLD_DATA_PREFIX.length);
}

/** Detect source records by key only; normal startup never reads their values. */
export function countPreviousEditionLocalStorageRecords(storage: StorageIndex) {
  const keys = new Set<string>();
  const sourceLength = storage.length;
  for (let index = 0; index < sourceLength; index += 1) {
    const key = storage.key(index);
    if (key !== null && isPreviousEditionLocalStorageKey(key)) keys.add(key);
  }
  return keys.size;
}

/**
 * Collect a JSON-serializable, deterministic backup of generic pre-split
 * localStorage data. The allowlist intentionally excludes unrelated Blockwild
 * lookalikes and every non-Blockwild origin key.
 *
 * IndexedDB is reported, not traversed. The TypeScript edition only owns the
 * disposable terrain cache. The Rust edition's authoritative version-3
 * database stores typed byte payloads across eight private stores and has no
 * versioned, read-only whole-database export API. Reimplementing that private
 * schema here could yield an incomplete backup, so this collector fails closed
 * instead of guessing.
 */
export function collectPreviousEditionBackup(storage: ReadOnlyStorage): PreviousEditionBackupV1 {
  const selectedKeys = new Set<string>(PREVIOUS_EDITION_LOCAL_STORAGE_KEYS);
  const sourceLength = storage.length;

  for (let index = 0; index < sourceLength; index += 1) {
    const key = storage.key(index);
    if (key !== null && isPreviousEditionLocalStorageKey(key)) selectedKeys.add(key);
  }

  const localStorage: PreviousEditionLocalStorageEntry[] = [];
  for (const key of [...selectedKeys].sort()) {
    const value = storage.getItem(key);
    if (value !== null) localStorage.push({ key, value });
  }

  return {
    format: PREVIOUS_EDITION_BACKUP_FORMAT,
    version: PREVIOUS_EDITION_BACKUP_VERSION,
    localStorage,
    indexedDb: {
      status: "not-collected",
      authoritativeDatabase: {
        name: "blockwild-rust-persistence-v1",
        version: 3,
        reason: "no-versioned-read-only-whole-database-export-contract",
      },
      excludedDisposableDatabases: [{
        name: "blockwild-terrain-cache-v2",
        reason: "deterministic-disposable-terrain-cache",
      }],
    },
  };
}
