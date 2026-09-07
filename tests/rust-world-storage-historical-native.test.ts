import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryPersistenceAdapterV1 } from "../app/game/indexeddb-persistence-adapter.ts";
import {
  createRustHistoricalStoredWorldEnvelopeV2,
  decodeRustHistoricalStoredWorldEnvelopeV2,
  type RustHistoricalExternalDescriptorV2,
  type RustHistoricalStoredWorldEnvelopeV2,
} from "../app/game/rust-historical-save-persistence.ts";
import type {
  RustNativeHistoricalExternalCommitV2,
  RustNativeHistoricalExternalRecoveryV2,
  RustNativeWorldPersistenceSessionV1,
} from "../app/game/rust-native-world-persistence.ts";
import type {
  RustHistoricalSaveCompatibilityInputV1,
  RustHistoricalSaveCompatibilityPlanV1,
} from "../app/game/rust-historical-save-compatibility.ts";
import {
  WORLD_DATA_PREFIX,
  WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1,
  WorldStorage,
  type StoredWorld,
} from "../app/game/world-storage.ts";

const CONTENT_HASH = "ac".repeat(16);
const fixtureUrl = (filename: string) => new URL(
  `./fixtures/rust-engine/r3/historical-saves/${filename}`,
  import.meta.url,
);

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  clone() {
    const copy = new MemoryStorage();
    for (const [key, value] of this.values) copy.values.set(key, value);
    return copy;
  }
}

type HistoricalHead = Readonly<{
  descriptor: RustHistoricalExternalDescriptorV2;
  envelope: RustHistoricalStoredWorldEnvelopeV2;
  document: StoredWorld;
  checkpointId: string;
  checkpointHash: string;
  journalSequence: number;
}>;

class HistoricalSessionFixture {
  readonly operations: string[] = [];
  head: HistoricalHead | null;
  private commits: number;
  private nextSaveGate: Readonly<{
    reached: () => void;
    released: Promise<void>;
  }> | null = null;

  constructor(readonly worldId: string, head: HistoricalHead | null = null) {
    this.head = head;
    this.commits = head?.envelope.currentDocument.revision ?? 0;
  }

  pauseNextSaveAfterNativeCommit() {
    let reached!: () => void;
    let release!: () => void;
    const committed = new Promise<void>((resolve) => { reached = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    this.nextSaveGate = Object.freeze({ reached, released });
    return Object.freeze({ committed, release });
  }

  private async commit(
    status: "migrated" | "saved",
    envelope: RustHistoricalStoredWorldEnvelopeV2,
  ): Promise<RustNativeHistoricalExternalCommitV2> {
    const decoded = await decodeRustHistoricalStoredWorldEnvelopeV2(envelope);
    this.commits += 1;
    const descriptor = Object.freeze({
      descriptorHash: (this.commits + 1_000).toString(16).padStart(32, "0"),
      mutable: Object.freeze({ currentDocument: decoded.envelope.currentDocument }),
    }) as unknown as RustHistoricalExternalDescriptorV2;
    const checkpointId = `checkpoint-${decoded.envelope.currentDocument.revision}`;
    const checkpointHash = this.commits.toString(16).padStart(32, "0");
    const head = Object.freeze({
      descriptor,
      envelope: decoded.envelope,
      document: decoded.document,
      checkpointId,
      checkpointHash,
      journalSequence: decoded.envelope.currentDocument.revision,
    });
    this.head = head;
    return Object.freeze({
      status,
      worldId: this.worldId,
      checkpointId,
      checkpointHash,
      journalSequence: head.journalSequence,
      descriptor,
      envelope: decoded.envelope,
      document: decoded.document,
      receipt: Object.freeze({}) as RustNativeHistoricalExternalCommitV2["receipt"],
      records: decoded.envelope.chunks.length + 8,
      commits: decoded.envelope.chunks.length + 8,
      requestBytes: 100,
      responseBytes: 200,
    });
  }

  async recoverHistoricalExternal(
    _plan: RustHistoricalSaveCompatibilityPlanV1,
    _input: RustHistoricalSaveCompatibilityInputV1,
  ): Promise<RustNativeHistoricalExternalRecoveryV2> {
    void _plan;
    void _input;
    this.operations.push("recover-historical");
    if (!this.head) return Object.freeze({ status: "empty" as const, worldId: this.worldId });
    return Object.freeze({
      status: "hydrated" as const,
      worldId: this.worldId,
      checkpointId: this.head.checkpointId,
      checkpointHash: this.head.checkpointHash,
      journalSequence: this.head.journalSequence,
      fallbackDepth: 0,
      descriptor: this.head.descriptor,
      envelope: this.head.envelope,
      document: this.head.document,
      receipt: Object.freeze({}) as Extract<RustNativeHistoricalExternalRecoveryV2, { status: "hydrated" }>["receipt"],
    });
  }

  async migrateHistoricalExternal(
    plan: RustHistoricalSaveCompatibilityPlanV1,
    input: RustHistoricalSaveCompatibilityInputV1,
    envelope: RustHistoricalStoredWorldEnvelopeV2,
    createdAt: number,
  ) {
    this.operations.push(`migrate-historical:${createdAt}`);
    assert.equal(plan.authority.nativePlayer, "off");
    assert.equal(plan.authority.nativeRichState, "not-adopted");
    assert.equal(plan.target.contentHash, CONTENT_HASH);
    assert.equal(input.originalSource.rawSha256, envelope.source.rawSha256);
    return this.commit("migrated", envelope);
  }

  async saveHistoricalExternal(
    previous: RustHistoricalExternalDescriptorV2,
    envelope: RustHistoricalStoredWorldEnvelopeV2,
    createdAt: number,
  ) {
    this.operations.push(`save-historical:${createdAt}`);
    assert.equal(previous, this.head?.descriptor, "save must compare-and-swap the exact recovered descriptor head");
    const committed = await this.commit("saved", envelope);
    const gate = this.nextSaveGate;
    if (gate) {
      this.nextSaveGate = null;
      gate.reached();
      await gate.released;
    }
    return committed;
  }

  async recoverAndHydrate(): Promise<never> {
    this.operations.push("recover-generic");
    throw new Error("historical world reached the generic recovery lane");
  }

  async saveNative(): Promise<never> {
    this.operations.push("save-generic");
    throw new Error("historical world reached the generic save lane");
  }

  async flush() { this.operations.push("flush"); }
  async shutdown() { this.operations.push("shutdown"); }
}

async function importedWorld(
  storage: MemoryStorage,
  archive: MemoryPersistenceAdapterV1,
  now: () => number,
  filename = "g16-omitted-settlement-pattern.blockwild.json",
) {
  const worlds = new WorldStorage(storage, {
    now,
    persistenceCoordinator: null,
    importSourceAdapter: archive,
  });
  const imported = await worlds.importWorldBytes(new Uint8Array(readFileSync(fixtureUrl(filename))));
  assert(imported.ok);
  return { worlds, worldId: imported.value.id };
}

test("g16 external custody migrates, advances, and repairs a torn local mirror from native recovery", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  let now = 70_000;
  const imported = await importedWorld(storage, archive, () => now);
  const nativeWorldId = `world:${imported.worldId}@overworld`;
  const first = new HistoricalSessionFixture(nativeWorldId);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    first as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  const initial = imported.worlds.loadWorld(imported.worldId, false);
  assert(initial.ok);

  const migrated = await imported.worlds.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH });
  assert(migrated.ok, JSON.stringify(migrated));
  assert.deepEqual(first.operations, ["recover-historical", `migrate-historical:${initial.value.metadata.createdAt}`]);
  assert(first.head);
  assert.equal(first.head.envelope.currentDocument.revision, 1);

  const loaded = imported.worlds.loadWorld(imported.worldId, false);
  assert(loaded.ok);
  now += 1;
  const evolvedSave = { ...loaded.value.save, health: 4, hunger: 3, savedAt: now };
  assert(imported.worlds.saveWorldLocalOnly(imported.worldId, { save: evolvedSave }).ok);
  const saved = await imported.worlds.saveNativeWorld(imported.worldId, now);
  assert(saved.ok, JSON.stringify(saved));
  assert.equal(saved.value.saveId, "historical.external.v2.2");
  assert.equal(first.head.envelope.currentDocument.revision, 2);
  assert.equal(first.head.document.save.health, 4);

  // Normal WorldStorage scheduling must serialize rapid local commits so each
  // successor CAS observes the descriptor produced by the previous save.
  now += 1;
  assert(imported.worlds.saveWorld(imported.worldId, {
    save: { ...evolvedSave, health: 5, savedAt: now },
  }).ok);
  now += 1;
  assert(imported.worlds.saveWorld(imported.worldId, {
    save: { ...evolvedSave, health: 6, savedAt: now },
  }).ok);
  await imported.worlds.flushPersistence();
  assert.equal(first.head.envelope.currentDocument.revision, 4);
  assert.equal(first.head.document.save.health, 6);
  const durableHead = first.head;

  // Simulate corruption/torn local state outside the mutation API. No durable
  // successor intent exists, so exact native custody must repair this mirror.
  now += 1;
  const documentKey = `${WORLD_DATA_PREFIX}${imported.worldId}`;
  const torn = JSON.parse(storage.getItem(documentKey)!) as StoredWorld;
  torn.save = { ...torn.save, health: 1, savedAt: now };
  storage.setItem(documentKey, JSON.stringify(torn));
  imported.worlds.unbindNativePersistence(first as unknown as RustNativeWorldPersistenceSessionV1);
  imported.worlds.dispose();

  const restarted = new WorldStorage(storage, {
    now: () => now,
    persistenceCoordinator: null,
    importSourceAdapter: archive,
  });
  const second = new HistoricalSessionFixture(nativeWorldId, durableHead);
  assert(restarted.bindNativePersistence(
    imported.worldId,
    second as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  const recovered = await restarted.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH });
  assert(recovered.ok, JSON.stringify(recovered));
  assert.deepEqual(second.operations, ["recover-historical"]);
  const repaired = restarted.loadWorld(imported.worldId, false);
  assert(repaired.ok);
  assert.equal(repaired.value.save.health, 6, "the Rust checkpoint must replace the torn local mirror before presentation");
  assert.equal(repaired.value.save.savedAt, 70_003);
  assert.equal(repaired.value.importSource?.rawSha256, durableHead.envelope.source.rawSha256);
  restarted.dispose();
});

test("historical custody rejects R5 authority and missing native content identity before mutation", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  const imported = await importedWorld(storage, archive, () => 8_000);
  const session = new HistoricalSessionFixture(`world:${imported.worldId}@overworld`);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    session as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);

  const r5 = await imported.worlds.hydrateNativeWorld(imported.worldId, {
    contentHash: CONTENT_HASH,
    nativePlayerAuthorityRequested: true,
  });
  assert.equal(r5.ok, false);
  if (!r5.ok) assert.match(r5.error.message, /cannot start while R5 player/u);
  assert.deepEqual(session.operations, []);

  const missingContent = await imported.worlds.hydrateNativeWorld(imported.worldId);
  assert.equal(missingContent.ok, false);
  if (!missingContent.ok) assert.match(missingContent.error.message, /content-manifest identity/u);
  assert.deepEqual(session.operations, []);
  imported.worlds.dispose();
});

test("g17 imports select the same bounded external-custody runtime lane", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  const imported = await importedWorld(
    storage,
    archive,
    () => 80_000,
    "g17-modern-control.blockwild.json",
  );
  const session = new HistoricalSessionFixture(`world:${imported.worldId}@overworld`);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    session as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  const initial = imported.worlds.loadWorld(imported.worldId, false);
  assert(initial.ok);
  const migrated = await imported.worlds.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH });
  assert(migrated.ok, JSON.stringify(migrated));
  assert.deepEqual(session.operations.slice(0, 2), [
    "recover-historical",
    `migrate-historical:${initial.value.metadata.createdAt}`,
  ]);
  assert.equal(session.head?.envelope.currentDocument.revision, 1);
  assert.equal(session.head?.document.options.settlementPattern, "heartlands-v2");
  imported.worlds.dispose();
});

test("first historical hydrate preserves allowed pre-custody opaque and title mutations", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  let now = 85_000;
  const imported = await importedWorld(storage, archive, () => ++now);
  const session = new HistoricalSessionFixture(`world:${imported.worldId}@overworld`);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    session as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  const original = imported.worlds.loadWorld(imported.worldId, false);
  assert(original.ok);
  assert.equal(original.value.save.mode, "builder");

  assert(imported.worlds.renameWorld(imported.worldId, "Prepared Before Custody").ok);
  assert(imported.worlds.updateWorldMode(imported.worldId, "survival").ok);
  assert(imported.worlds.updateWorldOptions(imported.worldId, { difficulty: "hard" }).ok);
  const mutable = imported.worlds.loadWorld(imported.worldId, false);
  assert(mutable.ok);
  assert(imported.worlds.saveWorld(imported.worldId, {
    save: { ...mutable.value.save, health: 3, hunger: 2, savedAt: ++now },
  }).ok);
  assert.deepEqual(session.operations, [], "pre-custody historical edits must not enter generic native save");

  const migrated = await imported.worlds.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH });
  assert(migrated.ok, JSON.stringify(migrated));
  assert(session.head);
  assert.equal(session.head.envelope.currentDocument.revision, 1);
  assert.equal(session.head.document.metadata.name, "Prepared Before Custody");
  assert.equal(session.head.document.save.mode, "survival");
  assert.equal(session.head.document.options.difficulty, "hard");
  assert.equal(session.head.document.save.health, 3);
  assert.equal(session.head.document.save.hunger, 2);
  assert.equal(JSON.stringify(session.head.document.save.edits), JSON.stringify(original.value.save.edits));
  assert.equal(
    JSON.stringify(session.head.document.save.blockFacings ?? {}),
    JSON.stringify(original.value.save.blockFacings ?? {}),
  );
  assert.deepEqual(session.operations.slice(0, 2), [
    "recover-historical",
    `migrate-historical:${session.head.document.metadata.createdAt}`,
  ]);
  imported.worlds.dispose();
});

test("pre-custody historical mutations reject R4 and generation drift before any commit", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  const imported = await importedWorld(storage, archive, () => 87_000);
  const session = new HistoricalSessionFixture(`world:${imported.worldId}@overworld`);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    session as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  const initial = imported.worlds.loadWorld(imported.worldId, false);
  assert(initial.ok);
  const documentKey = `${WORLD_DATA_PREFIX}${imported.worldId}`;
  const documentBefore = storage.getItem(documentKey);

  const edited = imported.worlds.saveWorld(imported.worldId, {
    save: { ...initial.value.save, edits: { ...initial.value.save.edits, "0,0": [[0, 1]] } },
  });
  assert.equal(edited.ok, false);
  if (!edited.ok) assert.match(edited.error.message, /R4 edits or facings/u);
  assert.equal(storage.getItem(documentKey), documentBefore);

  const faced = imported.worlds.saveWorld(imported.worldId, {
    save: { ...initial.value.save, blockFacings: { ...(initial.value.save.blockFacings ?? {}), "1,-64,1": 2 } },
  });
  assert.equal(faced.ok, false);
  if (!faced.ok) assert.match(faced.error.message, /R4 edits or facings/u);
  assert.equal(storage.getItem(documentKey), documentBefore);

  const generated = imported.worlds.updateWorldOptions(imported.worldId, { structures: false });
  assert.equal(generated.ok, false);
  if (!generated.ok) assert.match(generated.error.message, /Generation-affecting changes/u);
  assert.equal(storage.getItem(documentKey), documentBefore);
  assert.equal(storage.getItem(`${WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1}${imported.worldId}`), null);
  assert.deepEqual(session.operations, []);
  imported.worlds.dispose();
});

test("offline title mutations remain pending until exact native CAS and survive another restart", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  let now = 90_000;
  const imported = await importedWorld(storage, archive, () => now);
  const nativeWorldId = `world:${imported.worldId}@overworld`;
  const first = new HistoricalSessionFixture(nativeWorldId);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    first as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  assert((await imported.worlds.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH })).ok);
  assert(first.head);
  const base = first.head;
  assert.equal(base.document.save.mode, "builder");
  imported.worlds.unbindNativePersistence(first as unknown as RustNativeWorldPersistenceSessionV1);
  imported.worlds.dispose();

  const offline = new WorldStorage(storage, {
    now: () => ++now,
    persistenceCoordinator: null,
    importSourceAdapter: archive,
  });
  assert(offline.renameWorld(imported.worldId, "Durable Archive Name").ok);
  assert(offline.updateWorldMode(imported.worldId, "survival").ok);
  const mutableOptions = offline.updateWorldOptions(imported.worldId, { difficulty: "hard" });
  assert(mutableOptions.ok);
  const pendingRaw = storage.getItem(`${WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1}${imported.worldId}`);
  assert(pendingRaw);
  const pending = JSON.parse(pendingRaw) as { pending: { document: StoredWorld } | null };
  assert(pending.pending, "the acknowledged offline mutation must have a durable full-document intent");
  assert.equal(pending.pending.document.metadata.name, "Durable Archive Name");
  assert.equal(pending.pending.document.save.mode, "survival");
  assert.equal(pending.pending.document.options.difficulty, "hard");
  offline.dispose();

  const second = new WorldStorage(storage, {
    now: () => now,
    persistenceCoordinator: null,
    importSourceAdapter: archive,
  });
  const resumed = new HistoricalSessionFixture(nativeWorldId, base);
  assert(second.bindNativePersistence(
    imported.worldId,
    resumed as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  const reconciled = await second.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH });
  assert(reconciled.ok, JSON.stringify(reconciled));
  assert.deepEqual(resumed.operations, ["recover-historical", `save-historical:${now}`]);
  assert(resumed.head);
  assert.equal(resumed.head.document.metadata.name, "Durable Archive Name");
  assert.equal(resumed.head.document.save.mode, "survival");
  assert.equal(resumed.head.document.options.difficulty, "hard");
  const reconciledState = JSON.parse(
    storage.getItem(`${WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1}${imported.worldId}`)!,
  ) as { pending: unknown };
  assert.equal(reconciledState.pending, null);
  const durable = resumed.head;
  second.dispose();

  const third = new WorldStorage(storage, {
    now: () => now,
    persistenceCoordinator: null,
    importSourceAdapter: archive,
  });
  const reopened = new HistoricalSessionFixture(nativeWorldId, durable);
  assert(third.bindNativePersistence(
    imported.worldId,
    reopened as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  const recovered = await third.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH });
  assert(recovered.ok, JSON.stringify(recovered));
  assert.deepEqual(reopened.operations, ["recover-historical"]);
  const loaded = third.loadWorld(imported.worldId, false);
  assert(loaded.ok);
  assert.equal(loaded.value.metadata.name, "Durable Archive Name");
  assert.equal(loaded.value.save.mode, "survival");
  assert.equal(loaded.value.options.difficulty, "hard");
  third.dispose();
});

test("generation-affecting historical option drift fails before mirror, outbox, or native mutation", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  const imported = await importedWorld(storage, archive, () => 100_000);
  const session = new HistoricalSessionFixture(`world:${imported.worldId}@overworld`);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    session as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  assert((await imported.worlds.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH })).ok);
  await imported.worlds.flushPersistence();
  const documentKey = `${WORLD_DATA_PREFIX}${imported.worldId}`;
  const custodyKey = `${WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1}${imported.worldId}`;
  const documentBefore = storage.getItem(documentKey);
  const custodyBefore = storage.getItem(custodyKey);
  const operationsBefore = [...session.operations];

  const rejected = imported.worlds.updateWorldOptions(imported.worldId, { structures: false });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error.message, /Generation-affecting changes are unavailable/u);
  assert.equal(storage.getItem(documentKey), documentBefore);
  assert.equal(storage.getItem(custodyKey), custodyBefore);
  await imported.worlds.flushPersistence();
  assert.deepEqual(session.operations, operationsBefore.concat("flush"));
  imported.worlds.dispose();
});

test("recovery clears a crash-left outbox when native already equals its exact successor", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  let now = 110_000;
  const imported = await importedWorld(storage, archive, () => now);
  const nativeWorldId = `world:${imported.worldId}@overworld`;
  const first = new HistoricalSessionFixture(nativeWorldId);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    first as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  assert((await imported.worlds.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH })).ok);
  assert(first.head);
  const base = first.head;
  imported.worlds.unbindNativePersistence(first as unknown as RustNativeWorldPersistenceSessionV1);
  imported.worlds.dispose();

  const offline = new WorldStorage(storage, {
    now: () => ++now,
    persistenceCoordinator: null,
    importSourceAdapter: archive,
  });
  assert(offline.renameWorld(imported.worldId, "Committed Before Crash").ok);
  offline.dispose();
  const custodyKey = `${WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1}${imported.worldId}`;
  const pendingState = JSON.parse(storage.getItem(custodyKey)!) as {
    pending: { document: StoredWorld; createdAt: number };
  };
  const envelope = await createRustHistoricalStoredWorldEnvelopeV2({
    document: pendingState.pending.document,
    source: base.envelope.source,
    previous: Object.freeze({
      source: base.envelope.source,
      initialDocument: base.envelope.initialDocument,
      currentDocument: base.envelope.currentDocument,
    }),
  });
  const committed = await first.saveHistoricalExternal(
    base.descriptor,
    envelope,
    pendingState.pending.createdAt,
  );
  assert(first.head);
  assert.notEqual((JSON.parse(storage.getItem(custodyKey)!) as { pending: unknown }).pending, null);

  const restarted = new WorldStorage(storage, {
    now: () => now,
    persistenceCoordinator: null,
    importSourceAdapter: archive,
  });
  const second = new HistoricalSessionFixture(nativeWorldId, first.head);
  assert(restarted.bindNativePersistence(
    imported.worldId,
    second as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  const recovered = await restarted.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH });
  assert(recovered.ok, JSON.stringify(recovered));
  assert.deepEqual(second.operations, ["recover-historical"]);
  assert.equal((JSON.parse(storage.getItem(custodyKey)!) as { pending: unknown }).pending, null);
  const loaded = restarted.loadWorld(imported.worldId, false);
  assert(loaded.ok);
  assert.equal(loaded.value.metadata.name, "Committed Before Crash");
  assert.equal(committed.document.metadata.name, loaded.value.metadata.name);
  restarted.dispose();
});

test("restart proves three rapid successor ancestry when native A committed before local rebase", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  let now = 115_000;
  const imported = await importedWorld(storage, archive, () => ++now);
  const nativeWorldId = `world:${imported.worldId}@overworld`;
  const first = new HistoricalSessionFixture(nativeWorldId);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    first as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  assert((await imported.worlds.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH })).ok);
  assert(first.head);
  const gate = first.pauseNextSaveAfterNativeCommit();

  assert(imported.worlds.renameWorld(imported.worldId, "Rapid A").ok);
  assert(imported.worlds.updateWorldMode(imported.worldId, "survival").ok);
  assert(imported.worlds.updateWorldOptions(imported.worldId, { difficulty: "hard" }).ok);
  await gate.committed;
  assert(first.head);
  assert.equal(first.head.document.metadata.name, "Rapid A");
  assert.equal(first.head.document.save.mode, "builder", "only A reached native before the crash snapshot");
  const nativeAfterA = first.head;
  const crashStorage = storage.clone();
  const crashState = JSON.parse(
    crashStorage.getItem(`${WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1}${imported.worldId}`)!,
  ) as { pending: { intermediateDocuments: unknown[]; document: StoredWorld } | null };
  assert(crashState.pending);
  assert.equal(crashState.pending.intermediateDocuments.length, 2, "C must retain exact A/B ancestry");
  assert.equal(crashState.pending.document.metadata.name, "Rapid A");
  assert.equal(crashState.pending.document.save.mode, "survival");
  assert.equal(crashState.pending.document.options.difficulty, "hard");

  // Let the abandoned process drain against its own storage after capturing the
  // exact crash image. The restarted instance below sees only native A + local C.
  gate.release();
  await imported.worlds.flushPersistence();
  imported.worlds.dispose();

  const restarted = new WorldStorage(crashStorage, {
    now: () => now,
    persistenceCoordinator: null,
    importSourceAdapter: archive,
  });
  const second = new HistoricalSessionFixture(nativeWorldId, nativeAfterA);
  assert(restarted.bindNativePersistence(
    imported.worldId,
    second as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  const recovered = await restarted.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH });
  assert(recovered.ok, JSON.stringify(recovered));
  assert.deepEqual(second.operations.map((entry) => entry.split(":")[0]), ["recover-historical", "save-historical"]);
  assert(second.head);
  assert.equal(second.head.envelope.currentDocument.revision, nativeAfterA.envelope.currentDocument.revision + 1);
  assert.equal(second.head.document.metadata.name, "Rapid A");
  assert.equal(second.head.document.save.mode, "survival");
  assert.equal(second.head.document.options.difficulty, "hard");
  const finalState = JSON.parse(
    crashStorage.getItem(`${WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1}${imported.worldId}`)!,
  ) as { pending: unknown };
  assert.equal(finalState.pending, null);
  restarted.dispose();
});

test("a divergent native successor conflicts without discarding browser or native state", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  let now = 120_000;
  const imported = await importedWorld(storage, archive, () => now);
  const nativeWorldId = `world:${imported.worldId}@overworld`;
  const first = new HistoricalSessionFixture(nativeWorldId);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    first as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  assert((await imported.worlds.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH })).ok);
  assert(first.head);
  const base = first.head;
  imported.worlds.unbindNativePersistence(first as unknown as RustNativeWorldPersistenceSessionV1);
  imported.worlds.dispose();

  const offline = new WorldStorage(storage, {
    now: () => ++now,
    persistenceCoordinator: null,
    importSourceAdapter: archive,
  });
  assert(offline.renameWorld(imported.worldId, "Browser Pending Name").ok);
  assert(offline.updateWorldMode(imported.worldId, "survival").ok);
  assert(offline.updateWorldOptions(imported.worldId, { difficulty: "hard" }).ok);
  offline.dispose();
  const custodyKey = `${WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1}${imported.worldId}`;
  const pendingBefore = storage.getItem(custodyKey);
  assert.equal(
    (JSON.parse(pendingBefore!) as { pending: { intermediateDocuments: unknown[] } }).pending.intermediateDocuments.length,
    2,
  );
  const browserBefore = storage.getItem(`${WORLD_DATA_PREFIX}${imported.worldId}`);

  const divergentDocument = JSON.parse(JSON.stringify(base.document)) as StoredWorld;
  divergentDocument.save = { ...divergentDocument.save, health: 2, savedAt: ++now };
  const divergentEnvelope = await createRustHistoricalStoredWorldEnvelopeV2({
    document: divergentDocument,
    source: base.envelope.source,
    previous: Object.freeze({
      source: base.envelope.source,
      initialDocument: base.envelope.initialDocument,
      currentDocument: base.envelope.currentDocument,
    }),
  });
  await first.saveHistoricalExternal(base.descriptor, divergentEnvelope, now);
  assert(first.head);
  const divergentHead = first.head;

  const restarted = new WorldStorage(storage, {
    now: () => now,
    persistenceCoordinator: null,
    importSourceAdapter: archive,
  });
  const second = new HistoricalSessionFixture(nativeWorldId, divergentHead);
  assert(restarted.bindNativePersistence(
    imported.worldId,
    second as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  const blocked = await restarted.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error.message, /conflicts with the durable browser successor intent/u);
  assert.deepEqual(second.operations, ["recover-historical"]);
  assert.equal(storage.getItem(custodyKey), pendingBefore);
  assert.equal(storage.getItem(`${WORLD_DATA_PREFIX}${imported.worldId}`), browserBefore);
  const local = restarted.loadWorld(imported.worldId, false);
  assert(local.ok);
  assert.equal(local.value.metadata.name, "Browser Pending Name");
  assert.equal(local.value.save.mode, "survival");
  assert.equal(local.value.options.difficulty, "hard");
  assert.equal(second.head?.document.save.health, 2);
  restarted.dispose();
});

test("historical deletion fails closed until an awaited native tombstone prevents orphan reuse", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  let now = 130_000;
  const imported = await importedWorld(storage, archive, () => ++now);
  const nativeWorldId = `world:${imported.worldId}@overworld`;
  const session = new HistoricalSessionFixture(nativeWorldId);
  assert(imported.worlds.bindNativePersistence(
    imported.worldId,
    session as unknown as RustNativeWorldPersistenceSessionV1,
  ).ok);
  assert((await imported.worlds.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH })).ok);
  assert(session.head);
  const nativeBefore = session.head;
  const documentKey = `${WORLD_DATA_PREFIX}${imported.worldId}`;
  const custodyKey = `${WORLD_NATIVE_HISTORICAL_CUSTODY_PREFIX_V1}${imported.worldId}`;
  const documentBefore = storage.getItem(documentKey);
  const custodyBefore = storage.getItem(custodyKey);

  const deleted = imported.worlds.deleteWorld(imported.worldId);
  assert.equal(deleted.ok, false);
  if (!deleted.ok) assert.match(deleted.error.message, /awaited native-world tombstone/u);
  assert.equal(storage.getItem(documentKey), documentBefore);
  assert.equal(storage.getItem(custodyKey), custodyBefore);
  assert(imported.worlds.listWorlds().some((world) => world.id === imported.worldId));
  assert.equal(session.head, nativeBefore);

  const reimported = await imported.worlds.importWorldBytes(
    new Uint8Array(readFileSync(fixtureUrl("g16-omitted-settlement-pattern.blockwild.json"))),
  );
  assert(reimported.ok);
  assert.notEqual(reimported.value.id, imported.worldId, "a retained native world must never be rebound by catalog-id reuse");
  assert(imported.worlds.listWorlds().some((world) => world.id === imported.worldId));
  assert(imported.worlds.listWorlds().some((world) => world.id === reimported.value.id));
  assert.equal(session.head, nativeBefore);
  imported.worlds.dispose();
});

test("unbind refuses to stop tracking a historical save until its operation drains", async () => {
  const storage = new MemoryStorage();
  const archive = new MemoryPersistenceAdapterV1();
  let now = 140_000;
  const imported = await importedWorld(storage, archive, () => ++now);
  const session = new HistoricalSessionFixture(`world:${imported.worldId}@overworld`);
  const nativeSession = session as unknown as RustNativeWorldPersistenceSessionV1;
  assert(imported.worlds.bindNativePersistence(imported.worldId, nativeSession).ok);
  assert((await imported.worlds.hydrateNativeWorld(imported.worldId, { contentHash: CONTENT_HASH })).ok);
  const current = imported.worlds.loadWorld(imported.worldId, false);
  assert(current.ok);
  const gate = session.pauseNextSaveAfterNativeCommit();
  assert(imported.worlds.saveWorld(imported.worldId, {
    save: { ...current.value.save, health: 7, savedAt: ++now },
  }).ok);
  await gate.committed;

  const refused = imported.worlds.unbindNativePersistence(nativeSession);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.error.message, /still draining/u);
  gate.release();
  await imported.worlds.flushPersistence();
  assert.equal(session.head?.document.save.health, 7);

  const unbound = imported.worlds.unbindNativePersistence(nativeSession);
  assert(unbound.ok);
  const noBinding = await imported.worlds.saveNativeWorld(imported.worldId, now);
  assert.equal(noBinding.ok, false);
  if (!noBinding.ok) assert.match(noBinding.error.message, /no live Rust persistence/u);
  imported.worlds.dispose();
});
