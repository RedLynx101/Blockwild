import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryPersistenceAdapterV1,
  decodeRustHistoricalFallbackObservationV2,
  encodeRustHistoricalFallbackReconciliationPlanV2,
  persistenceAdapterSchemaV1,
} from "../app/game/indexeddb-persistence-adapter.ts";
import {
  PERSISTENCE_SCHEMA_V1,
  createLegacyMigrationBundleV1,
  createPersistenceCheckpointV1,
  createPersistenceTransactionV1,
  persistencePayloadHashV1,
  persistenceRecordKeyV1,
} from "../app/game/persistence-journal-contract.ts";
import {
  rustPersistencePlatformPayloadHashV1,
  type RustPersistencePlatformRequestV1,
} from "../app/game/rust-persistence-runtime-contract.ts";

const HASH_A = "0123456789abcdef0123456789abcdef";
const HASH_B = "fedcba9876543210fedcba9876543210";
const address = (recordId: string) => ({ universeId: "world:fixture", locationId: "overworld", kind: "entity" as const, recordId });

async function historicalFallbackFixture(label: string) {
  const adapter = new MemoryPersistenceAdapterV1();
  const worldId = `world:historical-reconciliation:${label}`;
  const recordAddress = Object.freeze({
    universeId: worldId,
    locationId: "overworld",
    kind: "entity" as const,
    recordId: "historical-state",
  });
  const recordKey = persistenceRecordKeyV1(recordAddress);
  const fallbackPayload = Uint8Array.of(1, 2, 3);
  const corruptLatestPayload = Uint8Array.of(9, 8, 7);
  const fallbackCheckpoint = createPersistenceCheckpointV1({
    checkpointId: `checkpoint:fallback:${label}`,
    parentCheckpointId: null,
    worldId,
    journalSequence: 1,
    generatorHash: HASH_A,
    contentHash: HASH_B,
    createdAt: 10,
    records: [{
      address: recordAddress,
      revision: 1,
      byteLength: fallbackPayload.byteLength,
      payloadHash: persistencePayloadHashV1(fallbackPayload),
    }],
  });
  const latestCheckpoint = createPersistenceCheckpointV1({
    checkpointId: `checkpoint:corrupt-latest:${label}`,
    parentCheckpointId: fallbackCheckpoint.checkpointId,
    worldId,
    journalSequence: 2,
    generatorHash: HASH_A,
    contentHash: HASH_B,
    createdAt: 20,
    records: [{
      address: recordAddress,
      revision: 2,
      byteLength: corruptLatestPayload.byteLength,
      payloadHash: persistencePayloadHashV1(corruptLatestPayload),
    }],
  });
  const checkpointStorageKey = (checkpointId: string) => `${encodeURIComponent(worldId)}|${encodeURIComponent(checkpointId)}`;
  const versionKey = (revision: number) => `${recordKey}|revision:${String(revision).padStart(20, "0")}`;
  const storedFallback = Object.freeze({
    key: recordKey,
    address: recordAddress,
    revision: 1,
    payload: Uint8Array.from(fallbackPayload),
    payloadHash: persistencePayloadHashV1(fallbackPayload),
  });
  const internal = adapter as unknown as {
    sequences: Map<string, number>;
    records: Map<string, typeof storedFallback>;
    recordVersions: Map<string, typeof storedFallback>;
    checkpoints: Map<string, ReturnType<typeof createPersistenceCheckpointV1>>;
    latestCheckpoints: Map<string, string>;
    storageRevisions: Map<string, number>;
  };
  internal.sequences.set(worldId, latestCheckpoint.journalSequence);
  internal.records.set(recordKey, storedFallback);
  internal.recordVersions.set(versionKey(1), Object.freeze({ ...storedFallback, key: versionKey(1) }));
  internal.checkpoints.set(checkpointStorageKey(fallbackCheckpoint.checkpointId), fallbackCheckpoint);
  internal.checkpoints.set(checkpointStorageKey(latestCheckpoint.checkpointId), latestCheckpoint);
  internal.latestCheckpoints.set(worldId, latestCheckpoint.checkpointId);
  internal.storageRevisions.set(worldId, 5);

  const observationBytes = await adapter.captureHistoricalExternalReconciliationObservationV2(
    worldId,
    fallbackCheckpoint.checkpointId,
  );
  const targetCheckpoint = createPersistenceCheckpointV1({
    checkpointId: `checkpoint:reconciled:${label}`,
    parentCheckpointId: latestCheckpoint.checkpointId,
    worldId,
    journalSequence: 3,
    generatorHash: HASH_A,
    contentHash: HASH_B,
    createdAt: 20,
    records: [{
      address: recordAddress,
      revision: 2,
      byteLength: fallbackPayload.byteLength,
      payloadHash: persistencePayloadHashV1(fallbackPayload),
    }],
  });
  const payload = encodeRustHistoricalFallbackReconciliationPlanV2({
    schemaVersion: 2,
    createdAt: 20,
    observation: decodeRustHistoricalFallbackObservationV2(observationBytes),
    observationBytes,
    observationHash: persistencePayloadHashV1(observationBytes),
    targetCheckpoint,
    copyRecords: Object.freeze([Object.freeze({
      address: recordAddress,
      sourceRevision: 1,
      targetRevision: 2,
      byteLength: fallbackPayload.byteLength,
      payloadHash: persistencePayloadHashV1(fallbackPayload),
    })]),
    inlineRecords: Object.freeze([]),
    deleteAddresses: Object.freeze([]),
    saveSetHash: "1".repeat(32),
    manifestHash: "2".repeat(32),
    descriptorHash: "3".repeat(32),
  });
  const request = Object.freeze({
    kind: "platform" as const,
    operation: "reconcile-historical-fallback" as const,
    requestId: 90,
    worldId,
    objectId: targetCheckpoint.checkpointHash,
    expectedHeadHash: latestCheckpoint.checkpointHash,
    cursor: 5,
    limit: targetCheckpoint.records.length,
    totalBytes: payload.byteLength,
    payloadHash: rustPersistencePlatformPayloadHashV1(payload),
    payload,
  }) satisfies RustPersistencePlatformRequestV1;
  return Object.freeze({
    adapter,
    internal,
    worldId,
    recordAddress,
    recordKey,
    fallbackPayload,
    fallbackCheckpoint,
    latestCheckpoint,
    targetCheckpoint,
    checkpointStorageKey,
    versionKey,
    request,
  });
}

function migrationFixture(worldId: string, label: string, seed: number) {
  const sourcePayload = Uint8Array.of(seed, seed + 1, seed + 2);
  const bundle = createLegacyMigrationBundleV1({
    sourceKey: `legacy:${label}`,
    sourceFormat: "blockwild-world-v2",
    worldId,
    sourcePayload,
    normalizedPayload: Uint8Array.of(seed + 3, seed + 4),
  });
  const entries = [
    { address: { universeId: worldId, locationId: "overworld", kind: "entity" as const, recordId: `${label}:alpha` }, payload: Uint8Array.of(seed, 1) },
    { address: { universeId: worldId, locationId: "overworld", kind: "entity" as const, recordId: `${label}:omega` }, payload: Uint8Array.of(seed, 9) },
  ];
  const checkpoint = createPersistenceCheckpointV1({
    checkpointId: `checkpoint:migration:${label}`,
    parentCheckpointId: null,
    worldId,
    journalSequence: 0,
    generatorHash: HASH_A,
    contentHash: HASH_B,
    createdAt: seed,
    records: entries.map((entry) => ({ address: entry.address, revision: 1, byteLength: entry.payload.byteLength, payloadHash: persistencePayloadHashV1(entry.payload) })),
  });
  return Object.freeze({
    bundle,
    sourcePayload,
    checkpoint,
    recordPayloads: new Map(entries.map((entry) => [persistenceRecordKeyV1(entry.address), entry.payload])),
    entries,
  });
}

test("memory platform adapter preflights revisions and commits multi-record work atomically", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const first = createPersistenceTransactionV1({
    transactionId: "transaction:1", worldId: "world:fixture", checkpointId: "checkpoint:base", expectedJournalSequence: 0, nextJournalSequence: 1,
    mutations: [
      { operation: "put", address: address("alpha"), expectedRecordRevision: null, nextRecordRevision: 1, payload: Uint8Array.from([1, 2]) },
      { operation: "put", address: address("zeta"), expectedRecordRevision: null, nextRecordRevision: 1, payload: Uint8Array.from([9, 8]) },
    ],
  });
  assert.equal((await adapter.commit(first)).status, "committed");
  const alphaBefore = await adapter.readRecord(address("alpha"));
  const conflicting = createPersistenceTransactionV1({
    transactionId: "transaction:2", worldId: "world:fixture", checkpointId: "checkpoint:base", expectedJournalSequence: 1, nextJournalSequence: 2,
    mutations: [
      { operation: "put", address: address("alpha"), expectedRecordRevision: 1, nextRecordRevision: 2, payload: Uint8Array.from([3]) },
      { operation: "put", address: address("zeta"), expectedRecordRevision: 9, nextRecordRevision: 10, payload: Uint8Array.from([7]) },
    ],
  });
  const rejected = await adapter.commit(conflicting);
  assert.equal(rejected.status, "rejected");
  if (rejected.status === "rejected") assert.equal(rejected.code, "record-conflict");
  assert.deepEqual(await adapter.readRecord(address("alpha")), alphaBefore, "a failed second record preflight leaves the first untouched");
  assert.equal((await adapter.estimate()).usage, 4);
});

test("checkpoint adapter copies records and resolves exact revisions", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const transaction = createPersistenceTransactionV1({
    transactionId: "transaction:1", worldId: "world:fixture", checkpointId: "checkpoint:base", expectedJournalSequence: 0, nextJournalSequence: 1,
    mutations: [{ operation: "put", address: address("alpha"), expectedRecordRevision: null, nextRecordRevision: 1, payload: Uint8Array.from([1, 2]) }],
  });
  await adapter.commit(transaction);
  const mutation = transaction.mutations[0];
  assert.equal(mutation.operation, "put");
  if (mutation.operation !== "put") return;
  const checkpoint = createPersistenceCheckpointV1({
    checkpointId: "checkpoint:one", parentCheckpointId: null, worldId: "world:fixture", journalSequence: 1,
    generatorHash: HASH_A, contentHash: HASH_B, createdAt: 10,
    records: [{ address: mutation.address, revision: mutation.nextRecordRevision, byteLength: mutation.payload.byteLength, payloadHash: mutation.payloadHash }],
  });
  await adapter.putCheckpoint(checkpoint);
  const loaded = await adapter.readCheckpoint(checkpoint.worldId, checkpoint.checkpointId);
  assert.deepEqual(loaded, checkpoint);
  assert.notEqual(loaded, checkpoint);
  assert.deepEqual(await adapter.readRecord(address("alpha"), 1), Uint8Array.from([1, 2]));
  assert.equal(await adapter.readRecord(address("alpha"), 2), null);
  assert.match(persistenceRecordKeyV1(address("alpha")), /alpha$/u);
  assert.equal(persistenceAdapterSchemaV1(), PERSISTENCE_SCHEMA_V1);
});

test("immutable record versions keep exact parent checkpoints recoverable until Rust compacts them", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const first = createPersistenceTransactionV1({
    transactionId: "transaction:version-1", worldId: "world:fixture", checkpointId: "checkpoint:one", expectedJournalSequence: 0, nextJournalSequence: 1,
    mutations: [{ operation: "put", address: address("alpha"), expectedRecordRevision: null, nextRecordRevision: 1, payload: Uint8Array.from([1, 2, 3]) }],
  });
  const firstMutation = first.mutations[0];
  assert.equal(firstMutation.operation, "put");
  if (firstMutation.operation !== "put") return;
  const firstCheckpoint = createPersistenceCheckpointV1({
    checkpointId: "checkpoint:one", parentCheckpointId: null, worldId: first.worldId, journalSequence: 1,
    generatorHash: HASH_A, contentHash: HASH_B, createdAt: 1,
    records: [{ address: firstMutation.address, revision: 1, byteLength: firstMutation.payload.byteLength, payloadHash: firstMutation.payloadHash }],
  });
  assert.equal((await adapter.commit(first, firstCheckpoint)).status, "committed");

  const second = createPersistenceTransactionV1({
    transactionId: "transaction:version-2", worldId: "world:fixture", checkpointId: "checkpoint:two", expectedJournalSequence: 1, nextJournalSequence: 2,
    mutations: [{ operation: "put", address: address("alpha"), expectedRecordRevision: 1, nextRecordRevision: 2, payload: Uint8Array.from([9, 8, 7]) }],
  });
  const secondMutation = second.mutations[0];
  assert.equal(secondMutation.operation, "put");
  if (secondMutation.operation !== "put") return;
  const secondCheckpoint = createPersistenceCheckpointV1({
    checkpointId: "checkpoint:two", parentCheckpointId: firstCheckpoint.checkpointId, worldId: second.worldId, journalSequence: 2,
    generatorHash: HASH_A, contentHash: HASH_B, createdAt: 2,
    records: [{ address: secondMutation.address, revision: 2, byteLength: secondMutation.payload.byteLength, payloadHash: secondMutation.payloadHash }],
  });
  assert.equal((await adapter.commit(second, secondCheckpoint)).status, "committed");
  assert.deepEqual(await adapter.readRecord(address("alpha"), 1), Uint8Array.from([1, 2, 3]));
  assert.deepEqual(await adapter.readRecord(address("alpha"), 2), Uint8Array.from([9, 8, 7]));

  const compact = (limit: number, requestId: number): RustPersistencePlatformRequestV1 => {
    const payload = new Uint8Array();
    return Object.freeze({
      kind: "platform", operation: "compact", requestId, worldId: second.worldId,
      objectId: secondCheckpoint.checkpointId, expectedHeadHash: secondCheckpoint.checkpointHash,
      cursor: 0, limit, totalBytes: 0, payloadHash: rustPersistencePlatformPayloadHashV1(payload), payload,
    });
  };
  assert.equal((await adapter.executePlatform(compact(1, 1))).code, "accepted");
  assert.ok(await adapter.readCheckpoint(firstCheckpoint.worldId, firstCheckpoint.checkpointId));
  assert.deepEqual(await adapter.readRecord(address("alpha"), 1), Uint8Array.from([1, 2, 3]));
  assert.equal((await adapter.executePlatform(compact(0, 2))).code, "accepted");
  assert.equal(await adapter.readCheckpoint(firstCheckpoint.worldId, firstCheckpoint.checkpointId), null);
  assert.equal(await adapter.readRecord(address("alpha"), 1), null);
  assert.deepEqual(await adapter.readRecord(address("alpha"), 2), Uint8Array.from([9, 8, 7]));
});

test("legacy catalog and native location world ids both delete their immutable record history", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const legacyAddress = { universeId: "world:catalog-fixture", locationId: "overworld", kind: "entity" as const, recordId: "legacy" };
  const transaction = createPersistenceTransactionV1({
    transactionId: "transaction:legacy-delete", worldId: "catalog-fixture", checkpointId: "checkpoint:legacy",
    expectedJournalSequence: 0, nextJournalSequence: 1,
    mutations: [{ operation: "put", address: legacyAddress, expectedRecordRevision: null, nextRecordRevision: 1, payload: Uint8Array.of(4, 2) }],
  });
  assert.equal((await adapter.commit(transaction)).status, "committed");
  await adapter.deleteWorld("catalog-fixture");
  assert.equal(await adapter.readRecord(legacyAddress), null);
  assert.equal(await adapter.readRecord(legacyAddress, 1), null);
});

test("memory migrations are first-writer-wins, atomically complete, and exactly idempotent", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const worldId = "world:migration-race";
  const first = migrationFixture(worldId, "first", 10);
  const second = migrationFixture(worldId, "second", 20);
  const results = await Promise.allSettled([adapter.commitMigration(first), adapter.commitMigration(second)]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  if (results[1].status === "rejected") assert.match(String(results[1].reason), /migration conflict/u);

  const firstReadback = await adapter.verifyMigrationReadback(first);
  assert.deepEqual(firstReadback, {
    ready: true,
    checkpointHash: first.checkpoint.checkpointHash,
    missingRecords: [],
    corruptRecords: [],
    backupPreserved: true,
  });
  assert.equal((await adapter.verifyMigrationReadback(second)).ready, false);
  for (const entry of first.entries) {
    assert.deepEqual(await adapter.readRecord(entry.address), entry.payload);
    assert.deepEqual(await adapter.readRecord(entry.address, 1), entry.payload);
  }
  for (const entry of second.entries) assert.equal(await adapter.readRecord(entry.address), null, "losing migration writes no records");

  const recoverRequest = (requestId: number): RustPersistencePlatformRequestV1 => {
    const payload = new Uint8Array();
    return Object.freeze({
      kind: "platform", operation: "recover-head", requestId, worldId, objectId: "", expectedHeadHash: null,
      cursor: 0, limit: 1, totalBytes: 4_096, payloadHash: rustPersistencePlatformPayloadHashV1(payload), payload,
    });
  };
  const beforeRetry = await adapter.executePlatform(recoverRequest(10));
  await adapter.commitMigration(first);
  const afterRetry = await adapter.executePlatform(recoverRequest(11));
  assert.equal(afterRetry.storageRevision, beforeRetry.storageRevision, "an exact verified retry is a no-write success");
});

test("memory migration conflicts and corrupt exact retries leave all durable state untouched", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const worldId = "world:migration-preflight";
  const existingAddress = { universeId: worldId, locationId: "overworld", kind: "entity" as const, recordId: "existing" };
  const existing = createPersistenceTransactionV1({
    transactionId: "transaction:existing", worldId, checkpointId: "checkpoint:existing", expectedJournalSequence: 0, nextJournalSequence: 1,
    mutations: [{ operation: "put", address: existingAddress, expectedRecordRevision: null, nextRecordRevision: 1, payload: Uint8Array.of(4, 2) }],
  });
  assert.equal((await adapter.commit(existing)).status, "committed");
  const blocked = migrationFixture(worldId, "blocked", 30);
  await assert.rejects(adapter.commitMigration(blocked), /durable world state already exists/u);
  assert.deepEqual(await adapter.readRecord(existingAddress), Uint8Array.of(4, 2));
  for (const entry of blocked.entries) assert.equal(await adapter.readRecord(entry.address), null);

  const exactAdapter = new MemoryPersistenceAdapterV1();
  const exact = migrationFixture("world:migration-corrupt", "exact", 40);
  await exactAdapter.commitMigration(exact);
  const firstDescriptor = exact.checkpoint.records[0];
  const versionKey = `${persistenceRecordKeyV1(firstDescriptor.address)}|revision:${String(firstDescriptor.revision).padStart(20, "0")}`;
  const internal = exactAdapter as unknown as { recordVersions: Map<string, unknown> };
  internal.recordVersions.delete(versionKey);
  await assert.rejects(exactAdapter.commitMigration(exact), /incomplete, different, or corrupt/u);
  const corruptReadback = await exactAdapter.verifyMigrationReadback(exact);
  assert.equal(corruptReadback.ready, false);
  assert.ok(corruptReadback.missingRecords.includes(`version:${versionKey}`));
  assert.deepEqual(await exactAdapter.readRecord(firstDescriptor.address), exact.recordPayloads.get(persistenceRecordKeyV1(firstDescriptor.address)), "retry does not rewrite the remaining current record");
  assert.equal(internal.recordVersions.has(versionKey), false, "retry does not heal a corrupt immutable version");
});

test("historical fallback reconciliation atomically promotes one verified direct parent", async () => {
  const fixture = await historicalFallbackFixture("success");
  const result = await fixture.adapter.executePlatform(fixture.request);
  assert.equal(result.code, "accepted");
  assert.equal(result.storageRevision, 6);
  assert.equal(result.durableHash, fixture.targetCheckpoint.checkpointHash);
  assert.deepEqual(await fixture.adapter.readLatestCheckpoint(fixture.worldId), fixture.targetCheckpoint);
  assert.deepEqual(await fixture.adapter.readRecord(fixture.recordAddress), fixture.fallbackPayload);
  assert.deepEqual(await fixture.adapter.readRecord(fixture.recordAddress, 1), fixture.fallbackPayload);
  assert.deepEqual(await fixture.adapter.readRecord(fixture.recordAddress, 2), fixture.fallbackPayload);
  assert.deepEqual(
    await fixture.adapter.readCheckpoint(fixture.worldId, fixture.latestCheckpoint.checkpointId),
    fixture.latestCheckpoint,
    "the corrupt checkpoint is retained as immutable lineage evidence",
  );
  assert.deepEqual(
    await fixture.adapter.readCheckpoint(fixture.worldId, fixture.fallbackCheckpoint.checkpointId),
    fixture.fallbackCheckpoint,
    "the verified fallback remains recoverable",
  );
});

test("historical fallback reconciliation rejects stale, byte-drifted, and partial durable state without writes", async () => {
  const stale = await historicalFallbackFixture("stale");
  stale.internal.storageRevisions.set(stale.worldId, 6);
  const staleResult = await stale.adapter.executePlatform(stale.request);
  assert.equal(staleResult.code, "conflict");
  assert.deepEqual(await stale.adapter.readLatestCheckpoint(stale.worldId), stale.latestCheckpoint);
  assert.equal(await stale.adapter.readCheckpoint(stale.worldId, stale.targetCheckpoint.checkpointId), null);
  assert.deepEqual(await stale.adapter.readRecord(stale.recordAddress), stale.fallbackPayload);

  const changed = await historicalFallbackFixture("changed");
  const original = changed.internal.records.get(changed.recordKey)!;
  changed.internal.records.set(changed.recordKey, Object.freeze({
    ...original,
    payload: Uint8Array.of(4, 5, 6),
  }));
  const changedResult = await changed.adapter.executePlatform(changed.request);
  assert.equal(changedResult.code, "conflict");
  assert.deepEqual(await changed.adapter.readLatestCheckpoint(changed.worldId), changed.latestCheckpoint);
  assert.equal(await changed.adapter.readCheckpoint(changed.worldId, changed.targetCheckpoint.checkpointId), null);
  assert.deepEqual(await changed.adapter.readRecord(changed.recordAddress), Uint8Array.of(4, 5, 6));

  const partial = await historicalFallbackFixture("partial");
  await partial.adapter.putCheckpoint(partial.targetCheckpoint, false);
  const partialResult = await partial.adapter.executePlatform(partial.request);
  assert.equal(partialResult.code, "corrupt");
  assert.deepEqual(await partial.adapter.readLatestCheckpoint(partial.worldId), partial.latestCheckpoint);
  assert.deepEqual(await partial.adapter.readRecord(partial.recordAddress), partial.fallbackPayload);
  assert.equal(partial.internal.storageRevisions.get(partial.worldId), 5);
});

test("historical fallback reconciliation rejects altered Rust intent fields before any durable write", async () => {
  const fixture = await historicalFallbackFixture("request-binding");
  const invalid = [
    { cursor: fixture.request.cursor + 1 },
    { limit: fixture.request.limit + 1 },
    { totalBytes: fixture.request.totalBytes + 1 },
    { expectedHeadHash: HASH_A },
    { objectId: HASH_B },
    { payloadHash: HASH_A },
  ] as const;
  for (const changes of invalid) {
    const result = await fixture.adapter.executePlatform(Object.freeze({ ...fixture.request, ...changes }));
    assert.equal(result.code, "corrupt");
    assert.deepEqual(await fixture.adapter.readLatestCheckpoint(fixture.worldId), fixture.latestCheckpoint);
    assert.equal(await fixture.adapter.readCheckpoint(fixture.worldId, fixture.targetCheckpoint.checkpointId), null);
    assert.deepEqual(await fixture.adapter.readRecord(fixture.recordAddress), fixture.fallbackPayload);
    assert.equal(fixture.internal.storageRevisions.get(fixture.worldId), 5);
  }
});
