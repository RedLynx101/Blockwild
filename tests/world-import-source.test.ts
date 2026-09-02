import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryPersistenceAdapterV1 } from "../app/game/indexeddb-persistence-adapter.ts";
import {
  WORLD_IMPORT_SOURCE_ARCHIVE_V1,
  WORLD_IMPORT_SOURCE_MAX_BYTES_V1,
  assertWorldImportSourceReferenceV1,
  preserveWorldImportSourceV1,
  readWorldImportSourceV1,
} from "../app/game/world-import-source.ts";
import { RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1, rustPersistencePlatformPayloadHashV1 } from "../app/game/rust-persistence-runtime-contract.ts";
import { WorldStorage, WORLD_CATALOG_KEY, WORLD_DATA_PREFIX } from "../app/game/world-storage.ts";
import { WorldPersistenceCoordinatorV1 } from "../app/game/world-persistence-coordinator.ts";

const fixture = readFileSync(new URL("./fixtures/rust-engine/r3/historical-saves/g16-omitted-settlement-pattern.blockwild.json", import.meta.url), "utf8");
const encode = (value: string) => new TextEncoder().encode(value);
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly failingKeys = new Set<string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    if (this.failingKeys.has(key)) throw new DOMException("fixture quota", "QuotaExceededError");
    this.values.set(key, String(value));
  }
}
type ArchivedChunk = {
  key: string; operation: string; worldId: string; objectId: string;
  offset: number; totalBytes: number; payload: Uint8Array; payloadHash: string;
};
function storedChunks(adapter: MemoryPersistenceAdapterV1) {
  return (adapter as unknown as { platformChunks: Map<string, ArchivedChunk> }).platformChunks;
}
function worlds(storage = new MemoryStorage(), adapter = new MemoryPersistenceAdapterV1()) {
  return { storage, adapter, world: new WorldStorage(storage, {
    now: () => 7_000, idFactory: () => "source-test", persistenceCoordinator: null, importSourceAdapter: adapter,
  }) };
}

test("original bytes retain whitespace, CRLF, Unicode, BOM and unknown envelope/save/player properties", async () => {
  const input = JSON.parse(fixture);
  input.unknownEnvelope = { text: "café 🦊 中文", retained: null };
  input.world.save.futureDomain = { nested: [1, false, "\u0000"] };
  input.world.save.player.futureNativeField = "must survive the source archive";
  const source = encode(`\ufeff  ${JSON.stringify(input, null, 2).replaceAll("\n", "\r\n")} \r\n`);
  const { world, adapter } = worlds();
  try {
    const imported = await world.importWorldBytes(source);
    assert(imported.ok);
    const loaded = world.loadWorld(imported.value.id, false);
    assert(loaded.ok && loaded.value.importSource);
    assert.equal(loaded.value.importSource.rawSha256, sha(source));
    assert.equal(loaded.value.importSource.byteLength, source.byteLength);
    assert.equal(loaded.value.importSource.archiveWorldId, WORLD_IMPORT_SOURCE_ARCHIVE_V1);
    assert.equal(loaded.value.importSource.rawSha256.length, 64, "raw SHA is not a 128-bit semantic hash");
    const archived = await world.readOriginalImportedWorldSource(imported.value.id);
    assert(archived.ok);
    assert.deepEqual(archived.value, source);
    assert.equal(loaded.value.save.generatorVersion, 18);
    assert.equal(loaded.value.options.settlementPattern, "legacy-scattered-v1");
    assert.equal("futureNativeField" in loaded.value.save.player, false, "normalization remains separate from original bytes");
    assert.equal((await adapter.readLatestCheckpoint(imported.value.id)), null);
    assert.equal((await adapter.readLatestCheckpoint(`world:${imported.value.id}@overworld`)), null);
    assert.equal((await adapter.readLatestCheckpoint(WORLD_IMPORT_SOURCE_ARCHIVE_V1)), null, "archiving does not create a checkpoint");
    const rejected = world.prepareNativeLegacyWorldMigration(imported.value.id);
    assert.equal(rejected.ok, false, "original-file provenance does not make rich native migration eligible");
  } finally { world.dispose(); }
});

test("byte-distinct but semantically equal exports have separate raw identities and identical normalized import behavior", async () => {
  const parsed = JSON.parse(fixture);
  const compact = JSON.stringify(parsed);
  const spaced = JSON.stringify(parsed, null, 2).replaceAll("\n", "\r\n");
  const adapter = new MemoryPersistenceAdapterV1();
  const first = await preserveWorldImportSourceV1(adapter, encode(compact));
  const second = await preserveWorldImportSourceV1(adapter, encode(spaced));
  assert.notEqual(first.reference.rawSha256, second.reference.rawSha256);
  assert.notEqual(first.reference.objectId, second.reference.objectId);
  assert.deepEqual(JSON.parse(first.json), JSON.parse(second.json));
  const byteWorld = worlds(); const textWorld = worlds();
  try {
    const bytes = await byteWorld.world.importWorldBytes(encode(compact));
    const text = textWorld.world.importWorld(compact);
    assert(bytes.ok && text.ok);
    const byteLoaded = byteWorld.world.loadWorld(bytes.value.id, false);
    const textLoaded = textWorld.world.loadWorld(text.value.id, false);
    assert(byteLoaded.ok && textLoaded.ok);
    const { importSource, ...normalized } = byteLoaded.value;
    assert(importSource);
    assert.deepEqual(normalized, textLoaded.value);
    assert.equal(textLoaded.value.importSource, undefined);
  } finally { byteWorld.world.dispose(); textWorld.world.dispose(); }
});

test("fatal UTF-8 and 64 MiB source cap are deliberate file-only boundaries", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  for (const bytes of [new Uint8Array(), new Uint8Array(WORLD_IMPORT_SOURCE_MAX_BYTES_V1 + 1), Uint8Array.of(0xc0, 0xaf), encode("not JSON")]) {
    await assert.rejects(preserveWorldImportSourceV1(adapter, bytes));
  }
  assert.equal(storedChunks(adapter).size, 0);
  for (const patch of [{ format: "other" }, { version: 2 }, { world: null }]) {
    await assert.rejects(preserveWorldImportSourceV1(adapter, encode(JSON.stringify({ ...JSON.parse(fixture), ...patch }))));
  }
});

test("caller mutation after the first await cannot change the original source snapshot", async () => {
  const source = encode(fixture); const original = source.slice();
  const adapter = new MemoryPersistenceAdapterV1();
  const preserving = preserveWorldImportSourceV1(adapter, source);
  source.fill(0);
  const preserved = await preserving;
  assert.equal(preserved.reference.rawSha256, sha(original));
  assert.deepEqual(await readWorldImportSourceV1(adapter, preserved.reference), original);
});

test("multi-chunk source archives read back exactly and identical retries do not add or overwrite chunks", async () => {
  const parsed = JSON.parse(fixture);
  parsed.largeUnknownSource = "x".repeat(RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1);
  const bytes = encode(JSON.stringify(parsed));
  const adapter = new MemoryPersistenceAdapterV1();
  const first = await preserveWorldImportSourceV1(adapter, bytes);
  const chunks = [...storedChunks(adapter).values()];
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map(value => value.offset), [0, RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1]);
  const retry = await preserveWorldImportSourceV1(adapter, bytes);
  assert.deepEqual(retry.reference, first.reference);
  assert.equal(storedChunks(adapter).size, 2);
  assert.deepEqual(await readWorldImportSourceV1(adapter, first.reference), bytes);
  assert.deepEqual([...storedChunks(adapter).values()], chunks);
});

test("strict source readback rejects missing, corrupted, shifted, oversized, foreign and noncanonical chunks", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const source = await preserveWorldImportSourceV1(adapter, encode(fixture));
  const map = storedChunks(adapter);
  const [key, original] = [...map.entries()][0];
  const mutations = [
    { ...original, offset: 1 }, { ...original, totalBytes: original.totalBytes + 1 },
    { ...original, worldId: "foreign" }, { ...original, objectId: "foreign" },
    { ...original, key: `${key}x` }, { ...original, operation: "import-chunk" },
    { ...original, payload: original.payload.subarray(1) },
    { ...original, payloadHash: "0".repeat(32) },
    { ...original, payload: new Uint8Array(RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1 + 1) },
  ];
  for (const mutated of mutations) {
    map.set(key, mutated);
    await assert.rejects(readWorldImportSourceV1(adapter, source.reference));
  }
  map.delete(key);
  await assert.rejects(readWorldImportSourceV1(adapter, source.reference));
  map.set(key, original);
  map.set(`${key}x`, original);
  await assert.rejects(readWorldImportSourceV1(adapter, source.reference), /corrupt|incomplete/u);
  map.delete(`${key}x`);
  assert.deepEqual(await readWorldImportSourceV1(adapter, source.reference), encode(fixture));
});

test("a self-rehashed reordered payload cannot pass the independent original-file SHA readback", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const source = await preserveWorldImportSourceV1(adapter, encode(fixture));
  const map = storedChunks(adapter);
  const [key, original] = [...map.entries()][0];
  const payload = original.payload.slice().reverse();
  map.set(key, { ...original, payload, payloadHash: rustPersistencePlatformPayloadHashV1(payload) });
  await assert.rejects(readWorldImportSourceV1(adapter, source.reference), /SHA-256/u);
  await assert.rejects(preserveWorldImportSourceV1(adapter, encode(fixture)), /archive/u);
  assert.deepEqual(map.get(key)?.payload, payload, "conflicting retry must not overwrite retained bytes");
});

test("quota/conflict/wrong receipts and failed readback cannot publish a catalog world or discard retained source", async () => {
  for (const mode of ["quota", "conflict", "receipt", "readback"] as const) {
    class FailingArchive extends MemoryPersistenceAdapterV1 {
      override async executePlatform(request: Parameters<MemoryPersistenceAdapterV1["executePlatform"]>[0]) {
        const accepted = await super.executePlatform(request);
        return mode === "readback" ? accepted : mode === "receipt"
          ? { ...accepted, requestId: accepted.requestId + 1 }
          : { ...accepted, code: mode, message: `injected ${mode}` };
      }
      override async readPreservedLegacyBackup(input: Parameters<MemoryPersistenceAdapterV1["readPreservedLegacyBackup"]>[0]) {
        const bytes = await super.readPreservedLegacyBackup(input);
        if (mode === "readback") bytes[0] ^= 1;
        return bytes;
      }
    }
    const state = worlds(new MemoryStorage(), new FailingArchive());
    try {
      const result = await state.world.importWorldBytes(encode(fixture));
      assert.equal(result.ok, false, mode);
      assert.equal(state.world.listWorlds().length, 0, mode);
      assert.equal(state.storage.getItem(WORLD_CATALOG_KEY), null);
      assert.equal(storedChunks(state.adapter).size, 1, "failed attempt retains its source");
    } finally { state.world.dispose(); }
  }
});

test("catalog quota failure leaves the verified archive intact and retry publishes only after exact readback", async () => {
  const { world, storage, adapter } = worlds();
  try {
    storage.failingKeys.add(WORLD_CATALOG_KEY);
    const failed = await world.importWorldBytes(encode(fixture));
    assert(!failed.ok && failed.error.code === "quota");
    assert.equal(world.listWorlds().length, 0);
    assert.equal([...storage.values.keys()].some(key => key.startsWith(WORLD_DATA_PREFIX)), false);
    assert.equal(storedChunks(adapter).size, 1);
    storage.failingKeys.clear();
    const retry = await world.importWorldBytes(encode(fixture));
    assert(retry.ok);
    assert.equal(world.listWorlds().length, 1);
    assert.equal(storedChunks(adapter).size, 1);
    const original = await world.readOriginalImportedWorldSource(retry.value.id);
    assert(original.ok);
    assert.deepEqual(original.value, encode(fixture));
  } finally { world.dispose(); }
});

test("reference survives warm-shell saves, metadata edits, export and new-storage reload without rewriting the archive", async () => {
  const { world, storage, adapter } = worlds();
  const imported = await world.importWorldBytes(encode(fixture));
  assert(imported.ok);
  const loaded = world.loadWorld(imported.value.id, false);
  assert(loaded.ok && loaded.value.importSource);
  const reference = loaded.value.importSource;
  const chunks = [...storedChunks(adapter).values()];
  assert(world.saveWorld(imported.value.id, { save: { ...loaded.value.save, time: 0.77 } }).ok);
  assert(world.saveWorldLocalOnly(imported.value.id, { save: { ...loaded.value.save, day: 77 } }).ok);
  assert(world.renameWorld(imported.value.id, "Preserved source").ok);
  assert(world.updateWorldOptions(imported.value.id, { difficulty: "hard" }).ok);
  const exported = world.exportWorld(imported.value.id);
  assert(exported.ok);
  assert.deepEqual(JSON.parse(exported.value).world.importSource, reference);
  const textImported = world.importWorld(exported.value);
  assert(textImported.ok);
  const textLoaded = world.loadWorld(textImported.value.id, false);
  assert(textLoaded.ok);
  assert.equal(textLoaded.value.importSource, undefined, "a supplied local archive reference is not imported as provenance");
  const absent = await world.readOriginalImportedWorldSource(textImported.value.id);
  assert(!absent.ok && absent.error.code === "not-found");
  world.dispose();
  const reopened = worlds(storage, adapter).world;
  try {
    const restored = reopened.loadWorld(imported.value.id, false);
    assert(restored.ok);
    assert.deepEqual(restored.value.importSource, reference);
    const original = await reopened.readOriginalImportedWorldSource(imported.value.id);
    assert(original.ok);
    assert.deepEqual(original.value, encode(fixture));
    assert.deepEqual([...storedChunks(adapter).values()], chunks);
    assert.throws(() => assertWorldImportSourceReferenceV1({ ...reference, rawSha256: "0".repeat(32) }));
  } finally { reopened.dispose(); }
});

test("closing storage during source preservation prevents publication but keeps the exact archive", async () => {
  const { world, adapter, storage } = worlds();
  const pending = world.importWorldBytes(encode(fixture));
  world.dispose();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(storage.getItem(WORLD_CATALOG_KEY), null);
  assert.equal(storedChunks(adapter).size, 1);
  const preserved = await preserveWorldImportSourceV1(adapter, encode(fixture));
  assert.deepEqual(await readWorldImportSourceV1(adapter, preserved.reference), encode(fixture));
});

test("byte import preserves every previously supported generator's normalized acceptance semantics", async () => {
  for (let version = 2; version <= 18; version += 1) {
    const input = JSON.parse(fixture);
    input.world.save.generatorVersion = version;
    input.world.metadata = {}; // Existing API allows fallback metadata.
    input.world.options = {};
    const text = JSON.stringify(input);
    const left = worlds(); const right = worlds();
    try {
      const original = left.world.importWorld(text);
      const bytes = await right.world.importWorldBytes(encode(text));
      assert(original.ok && bytes.ok, `generator ${version}`);
      const first = left.world.loadWorld(original.value.id, false);
      const second = right.world.loadWorld(bytes.value.id, false);
      assert(first.ok && second.ok);
      const { importSource, ...normalized } = second.value;
      assert(importSource);
      assert.deepEqual(normalized, first.value, `generator ${version}`);
    } finally { left.world.dispose(); right.world.dispose(); }
  }
});

test("source preservation does not grant semantic eligibility and old imports cannot gain retroactive provenance", async () => {
  const input = JSON.parse(fixture);
  input.world.save.generatorVersion = 999;
  const { world, adapter, storage } = worlds();
  try {
    const rejected = await world.importWorldBytes(encode(JSON.stringify(input)));
    assert(!rejected.ok);
    assert.equal(storedChunks(adapter).size, 1, "well-formed export source is protected even when save migration refuses it");
    assert.equal(storage.getItem(WORLD_CATALOG_KEY), null);
    const old = world.importWorld(fixture);
    assert(old.ok);
    const original = await world.readOriginalImportedWorldSource(old.value.id);
    assert(!original.ok && original.error.code === "not-found");
  } finally { world.dispose(); }
});

test("public file handler bounds file allocation and sends arrayBuffer bytes, not decoded text", () => {
  const source = readFileSync(new URL("../app/game/VoxelGame.tsx", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("const importWorld = async (event:"), source.indexOf("const stopTelemetry =", source.indexOf("const importWorld = async (event:")));
  assert.match(handler, /file\.size > WORLD_IMPORT_SOURCE_MAX_BYTES_V1/u);
  assert.match(handler, /await storage\.importWorldBytes\(new Uint8Array\(await file\.arrayBuffer\(\)\)\)/u);
  assert.doesNotMatch(handler, /file\.text\(/u);
  assert(handler.indexOf("file.size") < handler.indexOf("file.arrayBuffer()"));
  assert.match(source, /new WorldStorage\(browserStorage, \{ persistenceCoordinator: null \}\)/u,
    "the existing public UI does not prepopulate a generic journal before native bootstrap");
});

test("byte import retains explicitly configured generic persistence behavior outside the native-only public UI", async () => {
  const generic = new MemoryPersistenceAdapterV1();
  const coordinator = new WorldPersistenceCoordinatorV1(generic, () => 7_000);
  const archive = new MemoryPersistenceAdapterV1();
  const world = new WorldStorage(new MemoryStorage(), { now: () => 7_000,
    persistenceCoordinator: coordinator, importSourceAdapter: archive });
  try {
    const imported = await world.importWorldBytes(encode(fixture));
    assert(imported.ok);
    await world.flushPersistence();
    assert(await generic.readLatestCheckpoint(imported.value.id), "configured compatibility persistence was not silently disabled");
    assert.equal(await archive.readLatestCheckpoint(imported.value.id), null);
    assert.equal(await archive.readLatestCheckpoint(WORLD_IMPORT_SOURCE_ARCHIVE_V1), null);
  } finally { world.dispose(); }
});

test("original source remains recoverable when the normalized save later becomes semantically unloadable", async () => {
  const { world, storage } = worlds();
  try {
    const imported = await world.importWorldBytes(encode(fixture));
    assert(imported.ok);
    const key = `${WORLD_DATA_PREFIX}${imported.value.id}`;
    const document = JSON.parse(storage.getItem(key)!);
    document.save.generatorVersion = 999;
    storage.setItem(key, JSON.stringify(document));
    assert.equal(world.loadWorld(imported.value.id, false).ok, false);
    const recovered = await world.readOriginalImportedWorldSource(imported.value.id);
    assert(recovered.ok);
    assert.deepEqual(recovered.value, encode(fixture));
  } finally { world.dispose(); }
});

test("mutable source reference cannot switch identity while archive readback is pending", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const original = await preserveWorldImportSourceV1(adapter, encode(fixture));
  const reference = { ...original.reference };
  const alternate = encode(`${fixture} `);
  let release!: (bytes: Uint8Array) => void;
  const pending = new Promise<Uint8Array>(resolve => { release = resolve; });
  const readback = readWorldImportSourceV1({
    executePlatform: request => adapter.executePlatform(request),
    readPreservedLegacyBackup: () => pending,
  }, reference);
  Object.assign(reference, { byteLength: alternate.byteLength, rawSha256: sha(alternate), objectId: `sha256-${sha(alternate)}` });
  release(alternate);
  await assert.rejects(readback, /SHA-256/u);
});

test("adapter-owned bytes cannot mutate the verified return value during asynchronous SHA-256", async context => {
  const adapter = new MemoryPersistenceAdapterV1();
  const original = await preserveWorldImportSourceV1(adapter, encode(fixture));
  const exposed = encode(fixture);
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  context.mock.method(crypto.subtle, "digest", async (...args: Parameters<SubtleCrypto["digest"]>) => {
    const result = await digest(...args);
    exposed[0] ^= 1;
    return result;
  });
  const restored = await readWorldImportSourceV1({
    executePlatform: request => adapter.executePlatform(request),
    readPreservedLegacyBackup: async () => exposed,
  }, original.reference);
  assert.deepEqual(restored, encode(fixture));
  assert.notDeepEqual(exposed, encode(fixture), "the fixture must mutate the adapter's shared buffer");
});

test("the real IDB successful archive phase precedes the deliberate origin-quota restriction", () => {
  const source = readFileSync(new URL("./rust-indexeddb-browser.test.mjs", import.meta.url), "utf8");
  const archive = source.indexOf("const originalSource = await page.evaluate");
  const asserted = source.indexOf("assert.deepEqual(originalSource");
  const quota = source.indexOf('await devtools.send("Storage.overrideQuotaForOrigin"');
  assert(archive > 0 && asserted > archive && quota > asserted);
});
