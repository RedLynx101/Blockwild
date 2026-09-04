import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryPersistenceAdapterV1 } from "../app/game/indexeddb-persistence-adapter.ts";
import {
  planRustHistoricalSaveCompatibilityV1,
} from "../app/game/rust-historical-save-compatibility.ts";
import {
  RustHistoricalSaveStoragePlanError,
  createRustHistoricalSaveStoragePlanInputV1,
} from "../app/game/rust-historical-save-storage-plan.ts";
import { WorldStorage, type StoredWorld } from "../app/game/world-storage.ts";

const CONTENT_HASH = "ab".repeat(16);
const FIXTURES = [
  "g16-omitted-settlement-pattern.blockwild.json",
  "g17-modern-control.blockwild.json",
] as const;

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

async function importedFixture(filename: typeof FIXTURES[number]) {
  const bytes = new Uint8Array(readFileSync(new URL(
    `./fixtures/rust-engine/r3/historical-saves/${filename}`,
    import.meta.url,
  )));
  const storage = new MemoryStorage();
  const worlds = new WorldStorage(storage, {
    now: () => 7_000,
    persistenceCoordinator: null,
    importSourceAdapter: new MemoryPersistenceAdapterV1(),
  });
  const imported = await worlds.importWorldBytes(bytes);
  assert(imported.ok);
  const loaded = worlds.loadWorld(imported.value.id, false);
  assert(loaded.ok && loaded.value.importSource);
  const archived = await worlds.readOriginalImportedWorldSource(imported.value.id);
  assert(archived.ok);
  return { worlds, id: imported.value.id, document: loaded.value, bytes: archived.value };
}

function inputFor(fixture: Awaited<ReturnType<typeof importedFixture>>, document = fixture.document) {
  assert(document.importSource);
  return createRustHistoricalSaveStoragePlanInputV1({
    catalogWorldId: fixture.id,
    nativeWorldId: `world:${fixture.id}@overworld`,
    contentHash: CONTENT_HASH,
    sourceReference: document.importSource,
    sourceBytes: fixture.bytes,
    document,
  });
}

for (const filename of FIXTURES) test(`${filename} reconstructs its immutable post-import plan input`, async () => {
  const fixture = await importedFixture(filename);
  try {
    const input = inputFor(fixture);
    const plan = await planRustHistoricalSaveCompatibilityV1(input);
    assert.equal(input.normalizedSource.save.generatorVersion, 18);
    assert.equal(plan.source.raw.generatorVersion, filename.startsWith("g16-") ? 16 : 17);
    assert.equal(plan.target.catalogWorldId, fixture.id);
    assert.equal(plan.externalStateFlags, 30);
    assert.equal(plan.authority.nativePlayer, "off");
    assert.equal(plan.authority.nativeRichState, "not-adopted");
  } finally {
    fixture.worlds.dispose();
  }
});

test("evolving external gameplay does not redefine the immutable import plan", async () => {
  const fixture = await importedFixture(FIXTURES[0]);
  try {
    const evolved = structuredClone(fixture.document) as StoredWorld;
    evolved.save.health = 4;
    evolved.save.hunger = 3;
    evolved.save.time += 0.25;
    evolved.save.savedAt += 5_000;
    const first = await planRustHistoricalSaveCompatibilityV1(inputFor(fixture));
    const restarted = await planRustHistoricalSaveCompatibilityV1(inputFor(fixture, evolved));
    assert.equal(restarted.planHash, first.planHash);
    assert.equal(restarted.source.normalized.semanticHash, first.source.normalized.semanticHash);
    assert.equal(restarted.source.normalized.canonicalBytes.byteLength, first.source.normalized.canonicalBytes.byteLength);
  } finally {
    fixture.worlds.dispose();
  }
});

test("catalog, native, content, source, fingerprint, options, and identity drift fail closed", async () => {
  const fixture = await importedFixture(FIXTURES[1]);
  try {
    const base = {
      catalogWorldId: fixture.id,
      nativeWorldId: `world:${fixture.id}@overworld`,
      contentHash: CONTENT_HASH,
      sourceReference: fixture.document.importSource!,
      sourceBytes: fixture.bytes,
      document: fixture.document,
    };
    const cases: Array<Readonly<{ label: string; value: typeof base }>> = [
      { label: "catalog", value: { ...base, catalogWorldId: "other" } },
      { label: "native", value: { ...base, nativeWorldId: "world:other@overworld" } },
      { label: "content", value: { ...base, contentHash: "not-a-hash" } },
      { label: "source", value: { ...base, sourceBytes: base.sourceBytes.slice(1) } },
      { label: "fingerprint", value: { ...base, document: { ...base.document, save: { ...base.document.save, agentWorldFingerprint: "worldfp_import_other_abc" } } } },
      { label: "options", value: { ...base, document: { ...base.document, options: { ...base.document.options, caveFrequency: 2 } } } },
      { label: "identity", value: { ...base, document: { ...base.document, metadata: { ...base.document.metadata, generationIdentity: null } } } },
    ];
    for (const candidate of cases) {
      assert.throws(
        () => createRustHistoricalSaveStoragePlanInputV1(candidate.value),
        (error: unknown) => error instanceof RustHistoricalSaveStoragePlanError,
        candidate.label,
      );
    }
  } finally {
    fixture.worlds.dispose();
  }
});

test("raw duplicate keys remain visible to the authoritative async planner", async () => {
  const fixture = await importedFixture(FIXTURES[0]);
  try {
    const source = new TextDecoder().decode(fixture.bytes);
    const duplicate = new TextEncoder().encode(source.replace(
      '"generatorVersion": 16,',
      '"generatorVersion": 17, "generatorVersion": 16,',
    ));
    const reference = {
      ...fixture.document.importSource!,
      byteLength: duplicate.byteLength,
    };
    const input = createRustHistoricalSaveStoragePlanInputV1({
      catalogWorldId: fixture.id,
      nativeWorldId: `world:${fixture.id}@overworld`,
      contentHash: CONTENT_HASH,
      sourceReference: reference,
      sourceBytes: duplicate,
      document: { ...fixture.document, importSource: reference },
    });
    await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(input), /SHA-256|duplicate/u);
  } finally {
    fixture.worlds.dispose();
  }
});
