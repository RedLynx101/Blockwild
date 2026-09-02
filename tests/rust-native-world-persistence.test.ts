import assert from "node:assert/strict";
import test from "node:test";
import {
  createPersistenceCheckpointV1,
  persistencePayloadHashV1,
  persistenceRecordKeyV1,
  type PersistenceCheckpointV1,
  type PersistenceRecordAddressV1,
} from "../app/game/persistence-journal-contract.ts";
import {
  RustNativeWorldPersistenceSessionV1,
  RUST_NATIVE_WORLD_LEGACY_SOURCE_FORMAT_V1,
  type RustNativeWorldPersistenceSessionOptionsV1,
} from "../app/game/rust-native-world-persistence.ts";
import { RustIntegratedRuntimeServiceError } from "../app/game/rust-integrated-runtime-service.ts";
import type { RustIntegratedPersistenceStatusReceiptV1 } from "../app/game/rust-integrated-runtime-persistence.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";
import { planRustLegacyWorldMigrationV1 } from "../app/game/rust-legacy-world-migration.ts";
import {
  decodeCanonicalWorldSaveValueV1,
  encodeCanonicalWorldSaveValueV1,
} from "../app/game/world-save-sharding.ts";
import { RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1 } from "../app/game/rust-integrated-runtime-bulk-platform.ts";

const HASH_A = "0123456789abcdef0123456789abcdef";
const HASH_B = "fedcba9876543210fedcba9876543210";
const LEGACY_SOURCE_KEY = "blockwild-world-data-v1:fixture";
const LEGACY_SOURCE_IDENTITY = Object.freeze({
  sourceKey: LEGACY_SOURCE_KEY,
  sourceFormat: RUST_NATIVE_WORLD_LEGACY_SOURCE_FORMAT_V1,
});
const STATE = Object.freeze({
  revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation: 1 }),
  tick: 1,
  stateHash: "1".repeat(32),
});

function checkpoint(checkpointId: string, parentCheckpointId: string | null, sequence: number): PersistenceCheckpointV1 {
  const kinds = ["location-manifest", "chunk-edits", "entity", "actor-digest", "player", "settings-reference"] as const;
  return createPersistenceCheckpointV1({
    checkpointId,
    parentCheckpointId,
    worldId: "universe:fixture@overworld",
    journalSequence: sequence,
    generatorHash: HASH_A,
    contentHash: HASH_B,
    createdAt: sequence,
    records: kinds.map((kind, index) => ({
      address: { universeId: "universe:fixture", locationId: "overworld", kind, recordId: `native-world-state-${index}-v1` },
      revision: sequence,
      byteLength: 4,
      payloadHash: HASH_A,
    })),
  });
}

function saveProgress(stageId: string) {
  return Object.freeze({
    type: "runtime-bulk-save-progress-v1" as const,
    requestId: 1,
    clientEpoch: 1,
    workerEpoch: 1,
    current: STATE,
    stageId,
    state: "finalized" as const,
    receivedChunks: 0,
    chunkCount: 0,
    receivedBytes: 0,
    setHash: HASH_A,
    manifestHash: HASH_B,
    dispatcherRequestId: 1,
    remainingDirtyRecords: 0,
  });
}

function hydration(recoveryId: string, compatibility = false) {
  return Object.freeze({
    type: "runtime-bulk-hydration-v1" as const,
    requestId: 1,
    clientEpoch: 1,
    workerEpoch: 1,
    current: STATE,
    recoveryId,
    nativeDomains: 6,
    chunkCount: compatibility ? 1 : 0,
    totalBytes: compatibility ? 128 : 0,
    compatibilityHash: compatibility ? HASH_A : "0".repeat(32),
    legacyMigration: null,
  });
}

function receipt() {
  return Promise.resolve(Object.freeze({ requestId: 1, persistenceRevision: 1, pending: 1, queuedBytes: 1, stateHash: HASH_A, closed: false }));
}

function terminalStatus(head: PersistenceCheckpointV1 | null): RustIntegratedPersistenceStatusReceiptV1 {
  return Object.freeze({
    persistenceRevision: head?.journalSequence ?? 0,
    pending: 0,
    queuedBytes: 0,
    dispatcherStateHash: HASH_A,
    authorityStateHash: HASH_B,
    closed: false,
    terminal: head !== null,
    terminalCheckpoint: head ? Object.freeze({
      checkpointId: head.checkpointId,
      checkpointHash: head.checkpointHash,
      journalSequence: head.journalSequence,
      recordCount: head.records.length,
      saveSetHash: HASH_A,
      manifestHash: HASH_B,
    }) : null,
  });
}

function fixture(options: Readonly<{
  latest?: PersistenceCheckpointV1 | null;
  hydrate?(checkpointId: string): Promise<ReturnType<typeof hydration>>;
  initialize?(saveId: string, createdAt: number): Promise<ReturnType<typeof saveProgress>>;
  status?(head: PersistenceCheckpointV1 | null): Promise<RustIntegratedPersistenceStatusReceiptV1>;
}> = {}) {
  const checkpoints = new Map<string, PersistenceCheckpointV1>();
  let latest = options.latest ?? null;
  if (latest) {
    let cursor: PersistenceCheckpointV1 | null = latest;
    while (cursor) {
      checkpoints.set(cursor.checkpointId, cursor);
      cursor = null;
    }
  }
  const operations: string[] = [];
  let pumpClosed = false;
  let flushes = 0;
  const runtime = {
    async initializeNativeSave(saveId: string, createdAt: number) {
      operations.push(`initialize:${saveId}:${createdAt}`);
      if (options.initialize) return options.initialize(saveId, createdAt);
      latest = checkpoint(`checkpoint:${createdAt}`, latest?.checkpointId ?? null, (latest?.journalSequence ?? 0) + 1);
      checkpoints.set(latest.checkpointId, latest);
      return saveProgress(saveId);
    },
    async hydrateCompatibilityRecovery(checkpointId: string) {
      operations.push(`hydrate:${checkpointId}`);
      return options.hydrate ? options.hydrate(checkpointId) : hydration(checkpointId);
    },
  } as unknown as RustNativeWorldPersistenceSessionOptionsV1["runtime"];
  const port = {
    recover(_worldId: string, checkpointId?: string) { operations.push(`recover:${checkpointId ?? "latest"}`); return receipt(); },
    readRecoveryPage(_worldId: string, checkpointId: string, start: number) { operations.push(`page:${checkpointId}:${start}`); return receipt(); },
    status() { operations.push("status"); return options.status ? options.status(latest) : Promise.resolve(terminalStatus(latest)); },
    close() { operations.push("close"); return receipt(); },
  } as unknown as RustNativeWorldPersistenceSessionOptionsV1["port"];
  const pump = {
    async flush() { flushes += 1; operations.push("flush"); return Object.freeze({ operations: 1, requestBytes: 10, responseBytes: 11, idle: true }); },
    async shutdown() { operations.push("pump-shutdown"); pumpClosed = true; },
    isClosed() { return pumpClosed; },
  } as unknown as RustNativeWorldPersistenceSessionOptionsV1["pump"];
  const reader = {
    async readLatestCheckpoint() { return latest; },
    async readCheckpoint(_worldId: string, checkpointId: string) { return checkpoints.get(checkpointId) ?? null; },
    async readRecord() { return null; },
  };
  const session = new RustNativeWorldPersistenceSessionV1({
    worldId: "universe:fixture@overworld",
    runtime,
    port,
    pump,
    checkpoints: reader,
  });
  return { session, operations, checkpoints, setLatest(value: PersistenceCheckpointV1) { latest = value; checkpoints.set(value.checkpointId, value); }, get flushes() { return flushes; } };
}

function legacyProof(large = false) {
  const save = Object.freeze({
    version: 2,
    generatorVersion: 18,
    generatorProfile: "world-below-v15",
    seed: large ? "x".repeat(RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1 + 257) : "legacy-fixture",
    savedAt: 9,
    edits: Object.freeze({
      "0,0": Object.freeze([Object.freeze([0, 31])]),
    }),
    blockFacings: Object.freeze({ "0,-64,0": 1 }),
  });
  const canonicalSource = encodeCanonicalWorldSaveValueV1(save);
  const plan = planRustLegacyWorldMigrationV1({
    save,
    address: { universeId: "universe:fixture", locationId: "overworld" },
  });
  assert.equal(plan.status, "world-only");
  return Object.freeze({ save, plan, canonicalSource });
}

function splitCompatibilitySource(source: Uint8Array) {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < source.byteLength; offset += RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1) {
    chunks.push(source.slice(offset, Math.min(source.byteLength, offset + RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1)));
  }
  return chunks;
}

function compatibilityStreamHash(chunks: readonly Uint8Array[]) {
  const hasher = new TypeScriptCanonicalHasher("blockwild-persistence-compatibility-stream-v1");
  for (let index = 0; index < chunks.length; index += 1) hasher.writeU32(index).writeBytes(chunks[index]);
  return hasher.finishHex();
}

function concatenateChunks(chunks: readonly Uint8Array[]) {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function migrationPlanFromSource(source: Uint8Array) {
  return planRustLegacyWorldMigrationV1({
    save: decodeCanonicalWorldSaveValueV1(source) as Readonly<Record<string, unknown>>,
    address: { universeId: "universe:fixture", locationId: "overworld" },
  });
}

function migrationAttestation(
  source: Uint8Array,
  createdAt: number,
  sourceKey: string = LEGACY_SOURCE_KEY,
  sourceFormat: string = RUST_NATIVE_WORLD_LEGACY_SOURCE_FORMAT_V1,
) {
  const plan = migrationPlanFromSource(source);
  const chunks = splitCompatibilitySource(source);
  const migrationId = `legacy.world-only.v1.${plan.sourceSemanticHash}.${plan.projection.projectionHash}.${createdAt.toString(36)}`;
  return Object.freeze({
    migrationId,
    createdAt,
    sourceKey,
    sourceFormat,
    sourceByteLength: source.byteLength,
    sourceHash: plan.sourceSemanticHash,
    projectionHash: plan.projection.projectionHash,
    projectionEditCount: plan.projection.editCount,
    projectionFacingCount: plan.projection.facingCount,
    nativeWorldSemanticHash: plan.projection.projectionHash,
    nativeWorldEditCount: plan.projection.editCount,
    nativeWorldFacingCount: plan.projection.facingCount,
    worldId: "universe:fixture@overworld",
    universeId: "universe:fixture",
    locationId: "overworld",
    worldSeed: String((decodeCanonicalWorldSaveValueV1(source) as Readonly<Record<string, unknown>>).seed ?? ""),
    generatorHash: HASH_A,
    contentHash: HASH_B,
    terrainContentHash: "2".repeat(32),
    generationOptionsHash: "3".repeat(32),
    backupByteLength: source.byteLength,
    backupHash: compatibilityStreamHash(chunks),
    backupChunks: chunks.length,
    nativeRecordSetHash: "4".repeat(32),
    descriptorHash: "5".repeat(32),
    saveSetHash: HASH_A,
    manifestHash: HASH_B,
  });
}

function migrationFixture(options: Readonly<{
  initialSource?: Uint8Array;
  initialPartialSource?: Uint8Array;
  interruptFirstMigrationDrain?: boolean;
  corruptReadback?: boolean;
  corruptHydratedReadback?: boolean;
  terminalMismatch?: boolean;
  tamperedNativeSemantics?: boolean;
}> = {}) {
  const operations: string[] = [];
  const checkpoints = new Map<string, PersistenceCheckpointV1>();
  const records = new Map<string, Uint8Array>();
  const staged: Uint8Array[] = [];
  let stagedId: string | null = null;
  let stagedCount = 0;
  let stagedTotal = 0;
  let latest: PersistenceCheckpointV1 | null = null;
  let hydratedChunks: readonly Uint8Array[] = Object.freeze([]);
  let pumpClosed = false;
  let checkpointCounter = 0;
  let migrationDrainAttempts = 0;
  let durableMigration: ReturnType<typeof migrationAttestation> | null = null;
  let pendingMigration: Readonly<{
    chunks: readonly Uint8Array[];
    createdAt: number;
    attestation: ReturnType<typeof migrationAttestation>;
  }> | null = null;

  const recordKey = (address: PersistenceRecordAddressV1, revision: number) =>
    `${persistenceRecordKeyV1(address)}@${revision}`;
  const saveRecords = (chunks: readonly Uint8Array[]) => {
    const values: Array<Readonly<{ address: PersistenceRecordAddressV1; payload: Uint8Array }>> = [
      ["actor-digest", "rust-gameplay-r7-v1"],
      ["actor-digest", "legacy-migration-descriptor-v1"],
      ["chunk-edits", "rust-world-r4-v1"],
      ["entity", "rust-entity-r6-v2"],
      ["location-manifest", "manifest-v1"],
      ["map-knowledge", "rust-world-view-r7-v1"],
      ["player", "rust-runtime-core-v2"],
      ["settings-reference", "rust-content-registry-v1"],
    ].map(([kind, recordId], index) => Object.freeze({
      address: Object.freeze({
        universeId: "universe:fixture",
        locationId: "overworld",
        kind: kind as PersistenceRecordAddressV1["kind"],
        recordId,
      }),
      payload: Uint8Array.of(0x40 + index),
    }));
    for (let index = 0; index < chunks.length; index += 1) {
      values.push(Object.freeze({
        address: Object.freeze({
          universeId: "universe:fixture",
          locationId: "overworld",
          kind: "settings-reference",
          recordId: `compatibility-v1-${index.toString(16).padStart(8, "0")}`,
        }),
        payload: Uint8Array.from(chunks[index]),
      }));
    }
    values.sort((left, right) => {
      const leftKey = persistenceRecordKeyV1(left.address);
      const rightKey = persistenceRecordKeyV1(right.address);
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    });
    return values;
  };
  const partialRecordCount = (values: ReturnType<typeof saveRecords>, chunks: readonly Uint8Array[]) => {
    if (chunks.length > 1) {
      return values.findIndex((record) => record.address.recordId === "compatibility-v1-00000001");
    }
    return values.length - 1;
  };
  const install = (
    chunks: readonly Uint8Array[],
    createdAt: number,
    partial = false,
    attestation = migrationAttestation(concatenateChunks(chunks), createdAt),
  ) => {
    const values = saveRecords(chunks);
    const retained = partial ? values.slice(0, partialRecordCount(values, chunks)) : values;
    const descriptors = retained.map(({ address, payload }) => {
      records.set(recordKey(address, 1), Uint8Array.from(payload));
      return Object.freeze({
        address,
        revision: 1,
        byteLength: payload.byteLength,
        payloadHash: persistencePayloadHashV1(payload),
      });
    });
    checkpointCounter += 1;
    const parent = latest;
    latest = createPersistenceCheckpointV1({
      checkpointId: `checkpoint:legacy:${checkpointCounter}`,
      parentCheckpointId: parent?.checkpointId ?? null,
      worldId: "universe:fixture@overworld",
      journalSequence: (parent?.journalSequence ?? 0) + 1,
      generatorHash: HASH_A,
      contentHash: HASH_B,
      createdAt,
      records: descriptors,
    });
    checkpoints.set(latest.checkpointId, latest);
    hydratedChunks = Object.freeze(chunks.map((chunk) => Uint8Array.from(chunk)));
    durableMigration = attestation;
    return latest;
  };

  if (options.initialSource && options.initialPartialSource) throw new Error("migration fixture source mode is ambiguous");
  if (options.initialSource) install(splitCompatibilitySource(options.initialSource), 90);
  if (options.initialPartialSource) install(splitCompatibilitySource(options.initialPartialSource), 90, true);

  const runtime = {
    async initializeNativeSave() { throw new Error("native initialization is outside this migration fixture"); },
    async stageCompatibilitySaveChunk(
      stageId: string,
      chunkIndex: number,
      chunkCount: number,
      totalBytes: number,
      payload: Uint8Array,
    ) {
      operations.push(`stage:${chunkIndex}:${payload.byteLength}`);
      if (chunkIndex === 0) {
        stagedId = stageId;
        stagedCount = chunkCount;
        stagedTotal = totalBytes;
      }
      assert.equal(stageId, stagedId);
      assert.equal(chunkCount, stagedCount);
      assert.equal(totalBytes, stagedTotal);
      assert.equal(chunkIndex, staged.length);
      staged.push(Uint8Array.from(payload));
      const receivedBytes = staged.reduce((total, chunk) => total + chunk.byteLength, 0);
      return Object.freeze({
        type: "runtime-bulk-save-progress-v1" as const,
        requestId: chunkIndex + 1,
        clientEpoch: 1,
        workerEpoch: 1,
        current: STATE,
        stageId,
        state: "staged" as const,
        receivedChunks: staged.length,
        chunkCount,
        receivedBytes,
        setHash: "0".repeat(32),
        manifestHash: "0".repeat(32),
        dispatcherRequestId: 0,
        remainingDirtyRecords: 0,
      });
    },
    async migrateLegacyWorldOnly(
      stageId: string,
      createdAt: number,
      flags: number,
      sourceKey: string,
      sourceFormat: string,
      projection: Uint8Array,
    ) {
      operations.push(`migrate:${stageId}:${createdAt}:${flags}`);
      assert.equal(stageId, stagedId);
      assert.equal(flags, 0);
      assert.equal(new TextDecoder().decode(projection.subarray(0, 4)), "BWAS");
      assert.equal(staged.length, stagedCount);
      assert.equal(staged.reduce((total, chunk) => total + chunk.byteLength, 0), stagedTotal);
      const source = concatenateChunks(staged);
      const attestation = migrationAttestation(source, createdAt, sourceKey, sourceFormat);
      assert.equal(stageId, attestation.migrationId);
      assert.deepEqual(projection, migrationPlanFromSource(source).projection.bytes);
      pendingMigration = Object.freeze({
        chunks: Object.freeze(staged.map((chunk) => Uint8Array.from(chunk))),
        createdAt,
        attestation,
      });
      return Object.freeze({
        type: "runtime-bulk-save-progress-v1" as const,
        requestId: staged.length + 1,
        clientEpoch: 1,
        workerEpoch: 1,
        current: STATE,
        stageId,
        state: "finalized" as const,
        receivedChunks: staged.length,
        chunkCount: stagedCount,
        receivedBytes: stagedTotal,
        setHash: HASH_A,
        manifestHash: HASH_B,
        dispatcherRequestId: 1,
        remainingDirtyRecords: 0,
      });
    },
    async hydrateCompatibilityRecovery(recoveryId: string) {
      operations.push(`hydrate:${recoveryId}`);
      return Object.freeze({
        type: "runtime-bulk-hydration-v1" as const,
        requestId: 1,
        clientEpoch: 1,
        workerEpoch: 1,
        current: STATE,
        recoveryId,
        nativeDomains: 6,
        chunkCount: hydratedChunks.length,
        totalBytes: hydratedChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
        compatibilityHash: compatibilityStreamHash(hydratedChunks),
        legacyMigration: durableMigration ? Object.freeze({
          ...durableMigration,
          nativeWorldSemanticHash: options.tamperedNativeSemantics
            ? "9".repeat(32)
            : durableMigration.nativeWorldSemanticHash,
        }) : null,
      });
    },
    async readHydratedCompatibility(recoveryId: string, chunkIndex: number) {
      operations.push(`hydrated:${recoveryId}:${chunkIndex}`);
      const payload = Uint8Array.from(hydratedChunks[chunkIndex]);
      if (options.corruptHydratedReadback && payload.byteLength > 0) payload[0] ^= 0xff;
      return Object.freeze({
        type: "runtime-bulk-data-v1" as const,
        requestId: chunkIndex + 1,
        clientEpoch: 1,
        workerEpoch: 1,
        current: STATE,
        transferToken: chunkIndex + 1,
        typeId: "blockwild-persistence-compatibility-hydration-chunk-v1" as const,
        chunkIndex,
        chunkCount: hydratedChunks.length,
        payload,
      });
    },
  } as unknown as RustNativeWorldPersistenceSessionOptionsV1["runtime"];
  const port = {
    recover(_worldId: string, checkpointId?: string) { operations.push(`recover:${checkpointId ?? "latest"}`); return receipt(); },
    readRecoveryPage(_worldId: string, checkpointId: string, start: number) { operations.push(`page:${checkpointId}:${start}`); return receipt(); },
    status() {
      operations.push("status");
      const exact = terminalStatus(latest);
      if (!options.terminalMismatch || !exact.terminalCheckpoint) return Promise.resolve(exact);
      return Promise.resolve(Object.freeze({
        ...exact,
        terminalCheckpoint: Object.freeze({ ...exact.terminalCheckpoint, checkpointHash: "9".repeat(32) }),
      }));
    },
    close() { operations.push("close"); return receipt(); },
  } as unknown as RustNativeWorldPersistenceSessionOptionsV1["port"];
  const pump = {
    async flush() {
      operations.push("flush");
      if (pendingMigration) {
        migrationDrainAttempts += 1;
        if (options.interruptFirstMigrationDrain && migrationDrainAttempts === 1) {
          install(pendingMigration.chunks, pendingMigration.createdAt, true, pendingMigration.attestation);
          throw new Error("fixture crash after a durable migration prefix");
        }
        install(pendingMigration.chunks, pendingMigration.createdAt, false, pendingMigration.attestation);
        pendingMigration = null;
      }
      return Object.freeze({ operations: 1, requestBytes: 10, responseBytes: 11, idle: true });
    },
    async shutdown() { operations.push("pump-shutdown"); pumpClosed = true; },
    isClosed() { return pumpClosed; },
  } as unknown as RustNativeWorldPersistenceSessionOptionsV1["pump"];
  const reader = {
    async readLatestCheckpoint() { return latest; },
    async readCheckpoint(_worldId: string, checkpointId: string) { return checkpoints.get(checkpointId) ?? null; },
    async readRecord(address: PersistenceRecordAddressV1, revision?: number) {
      operations.push(`record:${address.recordId}:${revision ?? "latest"}`);
      if (revision === undefined) return null;
      const payload = records.get(recordKey(address, revision));
      if (!payload) return null;
      const copy = Uint8Array.from(payload);
      if (options.corruptReadback && address.recordId.startsWith("compatibility-v1-") && copy.byteLength > 0) copy[0] ^= 0xff;
      return copy;
    },
  };
  const session = new RustNativeWorldPersistenceSessionV1({
    worldId: "universe:fixture@overworld",
    runtime,
    port,
    pump,
    checkpoints: reader,
  });
  return Object.freeze({
    session,
    operations,
    checkpoints,
    records,
    staged,
    latest: () => latest,
  });
}

test("new native world initialization uses the durable bulk lane and proves a checkpoint head", async () => {
  const value = fixture();
  const saved = await value.session.initializeNewWorld(100);
  assert.equal(saved.worldId, "universe:fixture@overworld");
  assert.equal(saved.checkpointId, "checkpoint:100");
  assert.equal(saved.records, 6);
  assert.equal(saved.commits, 1);
  assert.deepEqual(value.operations.map((entry) => entry.split(":")[0]), ["initialize", "flush", "status"]);
  assert.equal(value.session.diagnostics().saves, 1);
  await assert.rejects(value.session.initializeNewWorld(101), /already-initialized/u);
});

test("paged recovery falls back from a corrupt head to the exact retained parent", async () => {
  const parent = checkpoint("checkpoint:parent", null, 1);
  const head = checkpoint("checkpoint:head", parent.checkpointId, 2);
  const value = fixture({
    latest: head,
    hydrate: async (checkpointId) => {
      if (checkpointId === head.checkpointId) throw new RustIntegratedRuntimeServiceError("bulk-platform", "recovery-native-world: head bytes are corrupt");
      return hydration(checkpointId);
    },
  });
  value.checkpoints.set(parent.checkpointId, parent);
  const recovered = await value.session.recoverAndHydrate();
  assert.equal(recovered.status, "hydrated");
  if (recovered.status !== "hydrated") return;
  assert.equal(recovered.checkpointId, parent.checkpointId);
  assert.equal(recovered.fallbackDepth, 1);
  assert.deepEqual(value.operations.filter((entry) => !entry.startsWith("flush")), [
    "recover:checkpoint:head",
    "page:checkpoint:head:0",
    "page:checkpoint:head:1",
    "page:checkpoint:head:2",
    "page:checkpoint:head:3",
    "page:checkpoint:head:4",
    "page:checkpoint:head:5",
    "hydrate:checkpoint:head",
    "recover:checkpoint:parent",
    "page:checkpoint:parent:0",
    "page:checkpoint:parent:1",
    "page:checkpoint:parent:2",
    "page:checkpoint:parent:3",
    "page:checkpoint:parent:4",
    "page:checkpoint:parent:5",
    "hydrate:checkpoint:parent",
  ]);
  assert.equal(value.session.diagnostics().parentFallbacks, 1);
});

test("paged recovery crosses one complete partial native generation to the preceding exact bundle", async () => {
  const stable = checkpoint("checkpoint:stable", null, 1);
  const chain = [stable];
  for (let index = 1; index <= 7; index += 1) {
    chain.push(checkpoint(`checkpoint:partial-${index}`, chain.at(-1)!.checkpointId, index + 1));
  }
  const head = chain.at(-1)!;
  const value = fixture({
    latest: head,
    hydrate: async (checkpointId) => {
      if (checkpointId !== stable.checkpointId) {
        throw new RustIntegratedRuntimeServiceError(
          "bulk-platform",
          "recovery-native-identity: partial native bundle",
        );
      }
      return hydration(checkpointId);
    },
  });
  for (const retained of chain) value.checkpoints.set(retained.checkpointId, retained);

  const recovered = await value.session.recoverAndHydrate();
  assert.equal(recovered.status, "hydrated");
  if (recovered.status !== "hydrated") return;
  assert.equal(recovered.checkpointId, stable.checkpointId);
  assert.equal(recovered.fallbackDepth, 7);
  assert.equal(value.session.diagnostics().parentFallbacks, 7);
});

test("compatibility-bearing hydration remains explicitly blocked without a lossless adapter", async () => {
  const head = checkpoint("checkpoint:legacy", null, 1);
  const value = fixture({ latest: head, hydrate: async (checkpointId) => hydration(checkpointId, true) });
  const recovered = await value.session.recoverAndHydrate();
  assert.equal(recovered.status, "blocked");
  if (recovered.status !== "blocked") return;
  assert.equal(recovered.code, "compatibility-adapter-required");
  assert.match(recovered.message, /protected compatibility bytes/u);
});

test("a Rust-attested migration descriptor reopens without process-local or browser-source provenance", async () => {
  const expected = legacyProof();
  const value = migrationFixture({ initialSource: expected.canonicalSource });

  const recovered = await value.session.recoverAndHydrate();

  assert.equal(recovered.status, "hydrated");
  if (recovered.status !== "hydrated") return;
  assert.equal(recovered.compatibility, null);
  assert.equal(recovered.migration?.sourceHash, expected.plan.sourceSemanticHash);
  assert.equal(recovered.migration?.projectionHash, expected.plan.projection.projectionHash);
  assert.equal(recovered.migration?.nativeWorldSemanticHash, expected.plan.projection.projectionHash);
});

test("quota rejection does not fabricate a durable head and shutdown drains before close", async () => {
  const rejected = fixture({
    initialize: async () => { throw new RustIntegratedRuntimeServiceError("bulk-platform", "quota: fixture rejected"); },
  });
  await assert.rejects(rejected.session.initializeNewWorld(1), /quota/u);
  assert.equal(rejected.session.diagnostics().saves, 0);

  const value = fixture();
  await value.session.initializeNewWorld(2);
  await value.session.shutdown();
  assert.deepEqual(value.operations.slice(-4), ["status", "flush", "close", "pump-shutdown"]);
  assert.equal(value.session.diagnostics().state, "closed");
  await assert.rejects(value.session.saveNative(3), /closed/u);
});

test("an advanced browser head cannot replace exact Rust terminal attestation", async () => {
  const nonterminal = fixture({
    status: async () => Object.freeze({
      ...terminalStatus(null),
      pending: 1,
    }),
  });
  await assert.rejects(nonterminal.session.initializeNewWorld(10), /Rust terminal checkpoint attestation/u);
  assert.equal(nonterminal.session.diagnostics().saves, 0);

  const mismatched = fixture({
    status: async (head) => {
      const exact = terminalStatus(head);
      assert.ok(exact.terminalCheckpoint);
      return Object.freeze({
        ...exact,
        terminalCheckpoint: Object.freeze({
          ...exact.terminalCheckpoint,
          checkpointHash: "9".repeat(32),
        }),
      });
    },
  });
  await assert.rejects(mismatched.session.initializeNewWorld(11), /does not match the exact Rust terminal attestation/u);
  assert.equal(mismatched.session.diagnostics().saves, 0);

  const wrongSave = fixture({
    status: async (head) => {
      const exact = terminalStatus(head);
      assert.ok(exact.terminalCheckpoint);
      return Object.freeze({
        ...exact,
        terminalCheckpoint: Object.freeze({
          ...exact.terminalCheckpoint,
          saveSetHash: "8".repeat(32),
        }),
      });
    },
  });
  await assert.rejects(wrongSave.session.initializeNewWorld(12), /does not match the exact Rust terminal attestation/u);
  assert.equal(wrongSave.session.diagnostics().saves, 0);
});

test("legacy world-only migration stages exact 4 MiB chunks and proves every durable source byte", async () => {
  const proof = legacyProof(true);
  assert.ok(proof.canonicalSource.byteLength > RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1);
  const value = migrationFixture();

  const migrated = await value.session.migrateLegacyWorldOnly(
    proof.plan,
    proof.canonicalSource,
    101,
    LEGACY_SOURCE_IDENTITY,
  );

  assert.equal(migrated.status, "migrated");
  assert.equal(migrated.worldId, "universe:fixture@overworld");
  assert.equal(migrated.createdAt, 101);
  assert.ok(migrated.migrationId.endsWith(".2t"));
  assert.equal(migrated.compatibilityRecords, 2);
  assert.equal(migrated.compatibilityBytes, proof.canonicalSource.byteLength);
  assert.equal(migrated.sourceSemanticHash, proof.plan.sourceSemanticHash);
  assert.equal(migrated.projectionHash, proof.plan.projection.projectionHash);
  assert.equal(migrated.saveSetHash, HASH_A);
  assert.equal(migrated.manifestHash, HASH_B);
  assert.equal(migrated.commits, 12, "migration completion includes Rust recovery/readback work");
  assert.equal(value.staged.length, 2);
  assert.equal(value.staged[0].byteLength, RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1);
  for (let index = 0, offset = 0; index < value.staged.length; index += 1) {
    const chunk = value.staged[index];
    assert.ok(chunk.byteLength > 0 && chunk.byteLength <= RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1);
    assert.deepEqual(chunk, proof.canonicalSource.subarray(offset, offset + chunk.byteLength));
    offset += chunk.byteLength;
  }
  assert.deepEqual(
    value.operations.filter((entry) => entry.startsWith("record:")),
    [
      "record:compatibility-v1-00000000:1",
      "record:compatibility-v1-00000001:1",
      "record:compatibility-v1-00000000:1",
      "record:compatibility-v1-00000001:1",
    ],
    "browser durable proof and Rust recovery each verify both exact backup chunks",
  );
  assert.equal(value.latest()?.createdAt, 101);
  assert.equal(value.session.diagnostics().legacyMigrations, 1);
});

test("mutated canonical source or BWAS plan is rejected before any persistence transport", async () => {
  const proof = legacyProof();
  const mutatedSourceText = new TextDecoder().decode(proof.canonicalSource).replace('"savedAt":9', '"savedAt":8');
  assert.notEqual(mutatedSourceText, new TextDecoder().decode(proof.canonicalSource));
  const mutatedSource = new TextEncoder().encode(mutatedSourceText);
  const sourceValue = migrationFixture();
  await assert.rejects(
    sourceValue.session.migrateLegacyWorldOnly(proof.plan, mutatedSource, 102, LEGACY_SOURCE_IDENTITY),
    /canonical legacy source does not match the migration plan provenance/u,
  );
  assert.deepEqual(sourceValue.operations, []);

  const projectionBytes = Uint8Array.from(proof.plan.projection.bytes);
  projectionBytes[projectionBytes.byteLength - 1] ^= 0xff;
  const mutatedPlan = Object.freeze({
    ...proof.plan,
    projection: Object.freeze({ ...proof.plan.projection, bytes: projectionBytes }),
  });
  const planValue = migrationFixture();
  await assert.rejects(
    planValue.session.migrateLegacyWorldOnly(mutatedPlan, proof.canonicalSource, 102, LEGACY_SOURCE_IDENTITY),
    /projection bytes no longer match their canonical provenance hash/u,
  );
  assert.deepEqual(planValue.operations, []);
});

test("legacy migration rejects a compatibility record whose exact revision reads back different bytes", async () => {
  const proof = legacyProof();
  const value = migrationFixture({ corruptReadback: true });
  await assert.rejects(
    value.session.migrateLegacyWorldOnly(proof.plan, proof.canonicalSource, 103, LEGACY_SOURCE_IDENTITY),
    /failed exact byte\/hash readback/u,
  );
  assert.equal(value.operations.filter((entry) => entry.startsWith("migrate:")).length, 1);
  assert.equal(value.session.diagnostics().legacyMigrations, 0);
});

test("legacy migration rejects a durable browser head that differs from Rust terminal attestation", async () => {
  const proof = legacyProof();
  const value = migrationFixture({ terminalMismatch: true });
  await assert.rejects(
    value.session.migrateLegacyWorldOnly(proof.plan, proof.canonicalSource, 104, LEGACY_SOURCE_IDENTITY),
    /does not match the exact Rust terminal attestation/u,
  );
  assert.deepEqual(value.operations.filter((entry) => entry.startsWith("record:")), []);
  assert.equal(value.session.diagnostics().legacyMigrations, 0);
});

test("matching legacy checkpoint retries recover idempotently while an unrelated native head blocks", async () => {
  const proof = legacyProof();
  const value = migrationFixture();
  const first = await value.session.migrateLegacyWorldOnly(proof.plan, proof.canonicalSource, 105, LEGACY_SOURCE_IDENTITY);
  const transportBeforeRetry = value.operations.filter((entry) => entry.startsWith("stage:") || entry.startsWith("migrate:")).length;

  const retry = await value.session.migrateLegacyWorldOnly(proof.plan, proof.canonicalSource, 105, LEGACY_SOURCE_IDENTITY);

  assert.equal(first.status, "migrated");
  assert.equal(retry.status, "already-migrated");
  assert.equal(retry.checkpointId, first.checkpointId);
  assert.equal(retry.checkpointHash, first.checkpointHash);
  assert.equal(retry.createdAt, 105);
  assert.equal(retry.migrationId, first.migrationId);
  assert.equal(
    value.operations.filter((entry) => entry.startsWith("stage:") || entry.startsWith("migrate:")).length,
    transportBeforeRetry,
  );
  assert.ok(value.operations.some((entry) => entry === `recover:${first.checkpointId}`));
  assert.ok(value.operations.some((entry) => entry === `hydrated:${first.checkpointId}:0`));
  assert.equal(value.session.diagnostics().legacyMigrationRetries, 1);

  const operationsBeforeWrongTimestamp = value.operations.length;
  await assert.rejects(
    value.session.migrateLegacyWorldOnly(proof.plan, proof.canonicalSource, 106, LEGACY_SOURCE_IDENTITY),
    /already completed a different legacy migration/u,
  );
  assert.equal(value.operations.length, operationsBeforeWrongTimestamp);

  const nativeHead = checkpoint("checkpoint:native", null, 1);
  const native = fixture({ latest: nativeHead });
  await assert.rejects(
    native.session.migrateLegacyWorldOnly(
      proof.plan,
      proof.canonicalSource,
      nativeHead.createdAt,
      LEGACY_SOURCE_IDENTITY,
    ),
    /canonical pristine migration prefix/u,
  );
  assert.deepEqual(native.operations, []);
});

test("an interrupted migration resumes idempotently from its exact in-process Rust continuation", async () => {
  const proof = legacyProof(true);
  const value = migrationFixture({ interruptFirstMigrationDrain: true });

  await assert.rejects(
    value.session.migrateLegacyWorldOnly(proof.plan, proof.canonicalSource, 107, LEGACY_SOURCE_IDENTITY),
    /fixture crash after a durable migration prefix/u,
  );
  const partial = value.latest();
  assert.ok(partial);
  assert.equal(partial.journalSequence, 1);
  assert.equal(partial.parentCheckpointId, null);
  assert.equal(partial.records.filter((record) => record.address.recordId.startsWith("compatibility-v1-")).length, 1);
  const transportBeforeRetry = value.operations.filter((entry) => entry.startsWith("stage:") || entry.startsWith("migrate:")).length;

  const resumed = await value.session.migrateLegacyWorldOnly(proof.plan, proof.canonicalSource, 107, LEGACY_SOURCE_IDENTITY);

  assert.equal(resumed.status, "migrated");
  assert.equal(resumed.createdAt, 107);
  assert.equal(resumed.compatibilityRecords, 2);
  assert.equal(value.latest()?.parentCheckpointId, partial.checkpointId);
  assert.equal(value.latest()?.journalSequence, 2);
  assert.equal(
    value.operations.filter((entry) => entry.startsWith("stage:") || entry.startsWith("migrate:")).length,
    transportBeforeRetry,
  );
  assert.equal(value.session.diagnostics().legacyMigrations, 1);
  assert.equal(value.session.diagnostics().legacyMigrationRetries, 1);
});

test("a restarted session resumes an exact descriptor-bearing prefix and accepts a complete durable proof", async () => {
  const expected = legacyProof();
  const partial = migrationFixture({ initialPartialSource: expected.canonicalSource });
  const resumed = await partial.session.migrateLegacyWorldOnly(
    expected.plan,
    expected.canonicalSource,
    90,
    LEGACY_SOURCE_IDENTITY,
  );
  assert.equal(resumed.status, "migrated");
  assert.ok(partial.operations.some((entry) => entry.startsWith("recover:")));
  assert.ok(partial.operations.some((entry) => entry.startsWith("migrate:")));

  const complete = migrationFixture({ initialSource: expected.canonicalSource });
  const reopened = await complete.session.migrateLegacyWorldOnly(
    expected.plan,
    expected.canonicalSource,
    90,
    LEGACY_SOURCE_IDENTITY,
  );
  assert.equal(reopened.status, "already-migrated");
  assert.ok(complete.operations.some((entry) => entry.startsWith("recover:")));
  assert.equal(complete.operations.filter((entry) => entry.startsWith("stage:") || entry.startsWith("migrate:")).length, 0);
});

test("restarted durable proof fails closed for a wrong source identity or native semantic readback", async () => {
  const expected = legacyProof();
  const wrongSource = migrationFixture({ initialSource: expected.canonicalSource });
  await assert.rejects(
    wrongSource.session.migrateLegacyWorldOnly(
      expected.plan,
      expected.canonicalSource,
      90,
      { ...LEGACY_SOURCE_IDENTITY, sourceKey: `${LEGACY_SOURCE_KEY}:wrong` },
    ),
    /descriptor does not match the exact source, projection, backup, or target/u,
  );

  const wrongSemantics = migrationFixture({
    initialSource: expected.canonicalSource,
    tamperedNativeSemantics: true,
  });
  await assert.rejects(
    wrongSemantics.session.migrateLegacyWorldOnly(
      expected.plan,
      expected.canonicalSource,
      90,
      LEGACY_SOURCE_IDENTITY,
    ),
    /semantic readback does not reproduce the exact projected edits/u,
  );
});

test("a partial head from a different legacy source never resumes or falls back", async () => {
  const expected = legacyProof();
  const differentSource = encodeCanonicalWorldSaveValueV1(Object.freeze({ ...expected.save, seed: "different-partial-source" }));
  const value = migrationFixture({ initialPartialSource: differentSource });

  await assert.rejects(
    value.session.migrateLegacyWorldOnly(expected.plan, expected.canonicalSource, 90, LEGACY_SOURCE_IDENTITY),
    /compatibility prefix belongs to a different source/u,
  );
  assert.deepEqual(
    value.operations.filter((entry) => entry.startsWith("stage:") || entry.startsWith("migrate:") || entry.startsWith("recover:")),
    [],
  );
});

test("compatibility recovery proof blocks a wrong durable source before Rust hydration transport", async () => {
  const expected = legacyProof();
  const otherSource = encodeCanonicalWorldSaveValueV1(Object.freeze({ ...expected.save, seed: "different-legacy-source" }));
  const value = migrationFixture({ initialSource: otherSource });

  const recovered = await value.session.recoverAndHydrate({
    plan: expected.plan,
    canonicalSource: expected.canonicalSource,
    ...LEGACY_SOURCE_IDENTITY,
    createdAt: 90,
  });

  assert.equal(recovered.status, "blocked");
  if (recovered.status !== "blocked") return;
  assert.equal(recovered.code, "compatibility-source-mismatch");
  assert.match(recovered.message, /expected source descriptor/u);
  assert.deepEqual(value.operations.filter((entry) => entry.startsWith("recover:") || entry.startsWith("hydrate:")), []);
});

test("compatibility recovery remains blocked when Rust exports different hydrated source bytes", async () => {
  const expected = legacyProof();
  const value = migrationFixture({
    initialSource: expected.canonicalSource,
    corruptHydratedReadback: true,
  });

  const recovered = await value.session.recoverAndHydrate({
    plan: expected.plan,
    canonicalSource: expected.canonicalSource,
    ...LEGACY_SOURCE_IDENTITY,
    createdAt: 90,
  });

  assert.equal(recovered.status, "blocked");
  if (recovered.status !== "blocked") return;
  assert.equal(recovered.code, "compatibility-source-mismatch");
  assert.match(recovered.message, /Rust hydration compatibility chunk 0 failed exact byte\/hash readback/u);
  assert.ok(value.operations.some((entry) => entry.startsWith("hydrate:")));
  assert.ok(value.operations.some((entry) => entry.startsWith("hydrated:")));
});
