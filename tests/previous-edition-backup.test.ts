import assert from "node:assert/strict";
import test from "node:test";
import {
  PREVIOUS_EDITION_BACKUP_FORMAT,
  PREVIOUS_EDITION_BACKUP_VERSION,
  collectPreviousEditionBackup,
  countPreviousEditionLocalStorageRecords,
} from "../app/game/previous-edition-backup.ts";

class ReadTrackingStorage implements Storage {
  readonly values: Map<string, string>;
  clearCalls = 0;
  getCalls = 0;
  removeCalls = 0;
  setCalls = 0;

  constructor(entries: readonly (readonly [string, string])[]) {
    this.values = new Map(entries);
  }

  get length() { return this.values.size; }
  clear() { this.clearCalls += 1; this.values.clear(); }
  getItem(key: string) { this.getCalls += 1; return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.removeCalls += 1; this.values.delete(key); }
  setItem(key: string, value: string) { this.setCalls += 1; this.values.set(key, String(value)); }
}

test("previous-edition backup preserves exact source strings without mutating storage", () => {
  const rawWorld = "{\n  \"seed\": \"A\\u0000B 🌊\",\n  \"inventory\": [ 1,  2 ]\n}\n";
  const rawSettings = " { \"volume\" : 0.1000, \"muted\" : false } ";
  const storage = new ReadTrackingStorage([
    ["blockwild-world-data-v1:world-a", rawWorld],
    ["blockwild-settings-v2", rawSettings],
    ["unrelated-origin-key", "leave me alone"],
  ]);
  const before = [...storage.values.entries()];

  const backup = collectPreviousEditionBackup(storage);

  assert.deepEqual([...storage.values.entries()], before);
  assert.equal(storage.setCalls, 0);
  assert.equal(storage.removeCalls, 0);
  assert.equal(storage.clearCalls, 0);
  assert.deepEqual(backup.localStorage, [
    { key: "blockwild-settings-v2", value: rawSettings },
    { key: "blockwild-world-data-v1:world-a", value: rawWorld },
  ]);
  assert.deepEqual(
    [...new TextEncoder().encode(backup.localStorage[1]!.value)],
    [...new TextEncoder().encode(rawWorld)],
  );
  assert.equal(backup.format, PREVIOUS_EDITION_BACKUP_FORMAT);
  assert.equal(backup.version, PREVIOUS_EDITION_BACKUP_VERSION);
  assert.doesNotThrow(() => JSON.stringify(backup));
});

test("previous-edition backup selection is restricted to exact keys and world documents", () => {
  const storage = new ReadTrackingStorage([
    ["blockwild-agent-id", "agent"],
    ["blockwild-browser-player-id-v1", "browser"],
    ["blockwild-character-profiles-v1", "profiles"],
    ["blockwild-multiplayer-player-id", "legacy-player"],
    ["blockwild-player-variant", "female"],
    ["blockwild-settings-v2", "settings"],
    ["blockwild-ui-preferences-v1", "ui"],
    ["blockwild-world-catalog-v1", "catalog"],
    ["blockwild-world-v2", "legacy-world"],
    ["blockwild-world-data-v1:world-b", "world-b"],
    ["blockwild-world-data-v1:world-a", "world-a"],
    ["blockwild-world-data-v1:", "empty-world-id"],
    ["blockwild-world-data-v1", "missing-colon"],
    ["blockwild-world-data-v10:world", "wrong-version"],
    ["prefix-blockwild-world-data-v1:world", "wrong-prefix"],
    ["blockwild-unknown-v1", "unknown"],
    ["unrelated", "unrelated"],
  ]);

  const backup = collectPreviousEditionBackup(storage);
  const keys = backup.localStorage.map((entry) => entry.key);

  assert.deepEqual(keys, [
    "blockwild-agent-id",
    "blockwild-browser-player-id-v1",
    "blockwild-character-profiles-v1",
    "blockwild-multiplayer-player-id",
    "blockwild-player-variant",
    "blockwild-settings-v2",
    "blockwild-ui-preferences-v1",
    "blockwild-world-catalog-v1",
    "blockwild-world-data-v1:world-a",
    "blockwild-world-data-v1:world-b",
    "blockwild-world-v2",
  ]);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(backup.indexedDb.status, "not-collected");
  assert.equal(backup.indexedDb.authoritativeDatabase.name, "blockwild-rust-persistence-v1");
  assert.equal(backup.indexedDb.excludedDisposableDatabases[0].name, "blockwild-terrain-cache-v2");
});

test("startup detection inspects only key names, not previous-edition values", () => {
  const storage = new ReadTrackingStorage([
    ["blockwild-world-catalog-v1", "sensitive-catalog"],
    ["blockwild-world-data-v1:world-a", "sensitive-world"],
    ["unrelated", "not-blockwild"],
  ]);

  assert.equal(countPreviousEditionLocalStorageRecords(storage), 2);
  assert.equal(storage.getCalls, 0);
  assert.equal(storage.setCalls, 0);
  assert.equal(storage.removeCalls, 0);
  assert.equal(storage.clearCalls, 0);
});
