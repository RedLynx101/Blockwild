import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createPersistenceCheckpointV1,
  persistencePayloadHashV1,
  persistenceRecordKeyV1,
  type PersistenceCheckpointV1,
  type PersistenceRecordAddressV1,
  type PersistenceRecordDescriptorV1,
} from "../app/game/persistence-journal-contract.ts";
import { encodeRustPersistenceCheckpointWireV1 } from "../app/game/rust-persistence-runtime-contract.ts";
import {
  RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1,
  planRustHistoricalSaveCompatibilityV1,
  type RustHistoricalSaveCompatibilityInputV1,
  type RustHistoricalSaveCompatibilityPlanV1,
} from "../app/game/rust-historical-save-compatibility.ts";
import {
  bindRustHistoricalExternalDescriptorProposalV2,
  createRustHistoricalExternalDescriptorProposalV2,
  createRustHistoricalStoredWorldEnvelopeV2,
  decodeRustHistoricalExternalDescriptorV2,
  decodeRustHistoricalExternalDescriptorProposalV2,
  encodeRustHistoricalExternalDescriptorV2,
  rustHistoricalExternalDescriptorAddressV2,
  rustHistoricalExternalDocumentChunkAddressV2,
  RUST_HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2,
  type RustHistoricalExternalDescriptorProposalV2,
  type RustHistoricalExternalDescriptorV2,
  type RustHistoricalStoredWorldEnvelopeV2,
  type RustHistoricalStoredWorldPreviousV2,
} from "../app/game/rust-historical-save-persistence.ts";
import {
  RustNativeWorldPersistenceSessionV1,
  type RustNativeWorldPersistenceSessionOptionsV1,
} from "../app/game/rust-native-world-persistence.ts";
import type { RustIntegratedRuntimeHistoricalExternalReceiptV2 } from "../app/game/rust-integrated-runtime-bulk-platform.ts";
import type { RustIntegratedPersistenceStatusReceiptV1 } from "../app/game/rust-integrated-runtime-persistence.ts";
import {
  deriveWorldGenerationIdentityV1,
  migrateLegacyWorldSave,
  normalizeWorldOptions,
  type StoredWorld,
  type WorldOptions,
} from "../app/game/world-storage.ts";

const CONTENT_HASH = "ab".repeat(16);
const HASH_A = "12".repeat(16);
const HASH_B = "34".repeat(16);
const FIXTURE = new URL("fixtures/rust-engine/r3/historical-saves/", import.meta.url);
const encoder = new TextEncoder();

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type HistoricalFixtureDocument = {
  world: {
    metadata: Record<string, unknown>;
    options: Record<string, unknown>;
    save: Record<string, unknown> & { generatorVersion: number; seed: string };
  };
};

function sourceInput(version: 16 | 17 = 16): RustHistoricalSaveCompatibilityInputV1 {
  const bytes = Uint8Array.from(readFileSync(new URL(
    `g${version}-${version === 16 ? "omitted-settlement-pattern" : "modern-control"}.blockwild.json`,
    FIXTURE,
  )));
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as HistoricalFixtureDocument;
  const normalized = migrateLegacyWorldSave(raw.world.save)!;
  const save = { ...normalized, agentWorldFingerprint: `worldfp_import_historical-g${version}_fixture` };
  const options = normalizeWorldOptions(version === 16
    ? { ...raw.world.options, settlementPattern: "legacy-scattered-v1" }
    : raw.world.options) as WorldOptions;
  const generationIdentity = deriveWorldGenerationIdentityV1(save, options);
  const catalogWorldId = `historical-g${version}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    schemaVersion: 1,
    authority: {
      claim: RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1,
      nativePlayer: "off",
      nativeRichState: "not-adopted",
    },
    originalSource: {
      schemaVersion: 1,
      provenance: "uploaded-file-bytes",
      sourceFormat: "blockwild-world-export-v1",
      encoding: "utf-8",
      archiveWorldId: "blockwild-original-import-sources-v1",
      objectId: `sha256-${sha256}`,
      rawSha256: sha256,
      byteLength: bytes.byteLength,
    },
    sourceBytes: bytes,
    normalizedSource: { save, options },
    target: {
      catalogWorldId,
      universeId: `world:${catalogWorldId}`,
      locationId: "overworld",
      worldSeed: save.seed,
      contentHash: CONTENT_HASH,
      generationIdentity,
    },
  };
}

function storedWorld(input: RustHistoricalSaveCompatibilityInputV1): StoredWorld {
  const save = structuredClone(input.normalizedSource.save);
  return {
    version: 1,
    metadata: {
      id: input.target.catalogWorldId,
      ownership: "host-device",
      name: "Historical fixture",
      seed: input.target.worldSeed,
      mode: save.mode,
      createdAt: 10,
      updatedAt: 10,
      lastPlayedAt: null,
      playTimeMs: 0,
      lastSavedGameVersion: typeof save.lastSavedGameVersion === "string" ? save.lastSavedGameVersion : "1.0.0",
      generationIdentity: structuredClone(input.target.generationIdentity),
    },
    options: structuredClone(input.normalizedSource.options),
    save,
    importSource: { ...input.originalSource },
  };
}

async function envelopeFor(
  document: StoredWorld,
  input: RustHistoricalSaveCompatibilityInputV1,
  previous: RustHistoricalStoredWorldPreviousV2 | null,
) {
  return createRustHistoricalStoredWorldEnvelopeV2({
    document,
    source: input.originalSource,
    previous,
  });
}

function previousFrom(envelope: RustHistoricalStoredWorldEnvelopeV2): RustHistoricalStoredWorldPreviousV2 {
  return Object.freeze({
    source: envelope.source,
    initialDocument: envelope.initialDocument,
    currentDocument: envelope.currentDocument,
  });
}

type FixtureOptions = Readonly<{
  mutateRecoveryReceipt?: (
    receipt: RustIntegratedRuntimeHistoricalExternalReceiptV2,
  ) => RustIntegratedRuntimeHistoricalExternalReceiptV2;
  interruptOnce?: Readonly<{
    operation: "initial-migration" | "external-save";
    afterRecords: number;
  }>;
  changeNativeOnExternalSave?: number;
}>;

function historicalFixture(plan: RustHistoricalSaveCompatibilityPlanV1, options: FixtureOptions = {}) {
  const worldId = `${plan.target.universeId}@${plan.target.locationId}`;
  const operations: string[] = [];
  const checkpoints = new Map<string, PersistenceCheckpointV1>();
  const recordBytes = new Map<string, Uint8Array>();
  const terminalHashes = new Map<string, Readonly<{ saveSetHash: string; manifestHash: string }>>();
  let latest: PersistenceCheckpointV1 | null = null;
  let activeRecovery: PersistenceCheckpointV1 | null = null;
  let stagedId: string | null = null;
  let stagedChunks: Uint8Array[] = [];
  let stagedCount = 0;
  let stagedBytes = 0;
  let pumpClosed = false;
  let interruptionArmed = options.interruptOnce !== undefined;
  let failNextFlush = false;
  let reconciliationObservation: Readonly<{
    fallback: PersistenceCheckpointV1;
    observedLatest: PersistenceCheckpointV1;
    bytes: Uint8Array;
  }> | null = null;
  let sequence = 0;

  const recordStorageKey = (address: PersistenceRecordAddressV1, revision: number) =>
    `${persistenceRecordKeyV1(address)}@${revision}`;

  const put = (address: PersistenceRecordAddressV1, revision: number, bytes: Uint8Array) => {
    const payload = Uint8Array.from(bytes);
    recordBytes.set(recordStorageKey(address, revision), payload);
    return Object.freeze({
      address: Object.freeze({ ...address }),
      revision,
      byteLength: payload.byteLength,
      payloadHash: persistencePayloadHashV1(payload),
    }) satisfies PersistenceRecordDescriptorV1;
  };

  const receiptFor = (
    operation: RustIntegratedRuntimeHistoricalExternalReceiptV2["operation"],
    operationId: string,
    createdAt: number,
    descriptor: RustHistoricalExternalDescriptorV2,
    saveSetHash: string,
    manifestHash: string,
  ): RustIntegratedRuntimeHistoricalExternalReceiptV2 => Object.freeze({
    operation,
    stageId: operation === "recovery" ? null : operationId,
    recoveryId: operation === "recovery" ? operationId : null,
    createdAt,
    authorityProfile: "typescript-historical-save-compatibility-v1",
    nativePlayer: "off",
    nativeRichState: "not-adopted",
    externalStateFlags: descriptor.immutable.externalStateFlags,
    descriptorHash: descriptor.descriptorHash,
    externalDocumentHash: descriptor.mutable.currentDocument.hash,
    externalDocumentByteLength: descriptor.mutable.currentDocument.byteLength,
    externalDocumentRevision: descriptor.mutable.currentDocument.revision,
    externalChunkCount: descriptor.mutable.chunks.length,
    externalChunkSetHash: descriptor.mutable.chunkSetHash,
    projectionHash: descriptor.immutable.bwas.projectionHash,
    projectionByteLength: descriptor.immutable.bwas.projectionByteLength,
    nativeWorldSemanticHash: descriptor.immutable.bwas.projectionHash,
    nativeWorldEditCount: descriptor.immutable.bwas.editCount,
    nativeWorldFacingCount: descriptor.immutable.bwas.facingCount,
    saveSetHash,
    manifestHash,
    dispatcherRequestId: operation === "recovery" ? 0 : sequence + 1,
    remainingDirtyRecords: operation === "recovery" ? 0 : 1,
    reconciliation: null,
  });

  const install = (
    proposal: RustHistoricalExternalDescriptorProposalV2,
    createdAt: number,
    operation: "initial-migration" | "external-save" | "reconciliation",
  ) => {
    sequence += 1;
    const parent = latest;
    const parentByKey = new Map(
      (parent?.records ?? []).map(record => [persistenceRecordKeyV1(record.address), record]),
    );
    const putNext = (address: PersistenceRecordAddressV1, bytes: Uint8Array) => {
      const prior = parentByKey.get(persistenceRecordKeyV1(address));
      const unchanged = prior
        && prior.byteLength === bytes.byteLength
        && prior.payloadHash === persistencePayloadHashV1(bytes);
      return put(address, unchanged ? prior.revision : (prior?.revision ?? 0) + 1, bytes);
    };
    const nativeRecords = RUST_HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2.map((template, index) => {
      const changed = operation === "external-save" && options.changeNativeOnExternalSave === index;
      return putNext({
        universeId: plan.target.universeId,
        locationId: plan.target.locationId,
        kind: template.kind,
        recordId: template.recordId,
      }, changed ? Uint8Array.of(0x40 + index, 0x7f) : Uint8Array.of(0x40 + index));
    });
    const descriptor = bindRustHistoricalExternalDescriptorProposalV2(proposal, nativeRecords);
    const records: PersistenceRecordDescriptorV1[] = [...nativeRecords];
    records.push(putNext(
      rustHistoricalExternalDescriptorAddressV2(plan.target.universeId, plan.target.locationId),
      encodeRustHistoricalExternalDescriptorV2(descriptor),
    ));
    for (let index = 0; index < stagedChunks.length; index += 1) {
      records.push(putNext(
        rustHistoricalExternalDocumentChunkAddressV2(plan.target.universeId, plan.target.locationId, index),
        stagedChunks[index],
      ));
    }
    records.push(putNext({
      universeId: plan.target.universeId,
      locationId: plan.target.locationId,
      kind: "location-manifest",
      recordId: "manifest-v1",
    }, encoder.encode(`manifest:${descriptor.descriptorHash}`)));
    records.sort((left, right) => {
      const leftKey = persistenceRecordKeyV1(left.address);
      const rightKey = persistenceRecordKeyV1(right.address);
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    });
    latest = createPersistenceCheckpointV1({
      checkpointId: `historical-checkpoint:${sequence}`,
      parentCheckpointId: parent?.checkpointId ?? null,
      worldId,
      journalSequence: (parent?.journalSequence ?? 0) + 1,
      generatorHash: plan.target.generationIdentity.generatorHash,
      contentHash: plan.target.contentHash,
      createdAt,
      records,
    });
    checkpoints.set(latest.checkpointId, latest);
    const hashes = Object.freeze({
      saveSetHash: descriptor.mutable.currentDocument.revision % 2 ? HASH_A : HASH_B,
      manifestHash: descriptor.mutable.currentDocument.revision % 2 ? HASH_B : HASH_A,
    });
    terminalHashes.set(latest.checkpointId, hashes);
    activeRecovery = null;
    return { checkpoint: latest, descriptor, hashes, parent };
  };

  const interruptInstalledCheckpoint = (
    operation: "initial-migration" | "external-save",
    installed: ReturnType<typeof install>,
  ) => {
    if (!interruptionArmed || options.interruptOnce?.operation !== operation) return;
    interruptionArmed = false;
    const count = options.interruptOnce.afterRecords;
    let records: PersistenceRecordDescriptorV1[];
    if (operation === "initial-migration") {
      assert.equal(installed.parent, null);
      assert.ok(count > 0 && count < installed.checkpoint.records.length);
      records = installed.checkpoint.records.slice(0, count);
    } else {
      const parent = installed.parent;
      assert.ok(parent);
      const priorByKey = new Map(parent.records.map(record => [persistenceRecordKeyV1(record.address), record]));
      const finalByKey = new Map(installed.checkpoint.records.map(record => [persistenceRecordKeyV1(record.address), record]));
      const dirtyKeys = [...new Set([...priorByKey.keys(), ...finalByKey.keys()])].sort().filter((key) => {
        const prior = priorByKey.get(key);
        const final = finalByKey.get(key);
        return !prior || !final
          || prior.revision !== final.revision
          || prior.byteLength !== final.byteLength
          || prior.payloadHash !== final.payloadHash;
      });
      assert.ok(count > 0 && count < dirtyKeys.length);
      const mixed = new Map(priorByKey);
      for (const key of dirtyKeys.slice(0, count)) {
        const final = finalByKey.get(key);
        if (final) mixed.set(key, final);
        else mixed.delete(key);
      }
      records = [...mixed.values()].sort((left, right) => {
        const leftKey = persistenceRecordKeyV1(left.address);
        const rightKey = persistenceRecordKeyV1(right.address);
        return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
      });
    }
    checkpoints.delete(installed.checkpoint.checkpointId);
    terminalHashes.delete(installed.checkpoint.checkpointId);
    latest = createPersistenceCheckpointV1({
      checkpointId: `historical-partial:${sequence}`,
      parentCheckpointId: installed.parent?.checkpointId ?? null,
      worldId,
      journalSequence: installed.checkpoint.journalSequence,
      generatorHash: plan.target.generationIdentity.generatorHash,
      contentHash: plan.target.contentHash,
      createdAt: installed.checkpoint.createdAt,
      records,
    });
    checkpoints.set(latest.checkpointId, latest);
    terminalHashes.set(latest.checkpointId, installed.hashes);
    activeRecovery = null;
    failNextFlush = true;
  };

  const stageCompatibilitySaveChunk = async (
    stageId: string,
    chunkIndex: number,
    chunkCount: number,
    totalBytes: number,
    payload: Uint8Array,
  ) => {
    operations.push(`stage:${chunkIndex}`);
    if (chunkIndex === 0) {
      stagedId = stageId;
      stagedChunks = [];
      stagedCount = chunkCount;
      stagedBytes = totalBytes;
    }
    assert.equal(stageId, stagedId);
    assert.equal(chunkIndex, stagedChunks.length);
    assert.equal(chunkCount, stagedCount);
    assert.equal(totalBytes, stagedBytes);
    stagedChunks.push(Uint8Array.from(payload));
    return Object.freeze({
      type: "runtime-bulk-save-progress-v1" as const,
      requestId: chunkIndex + 1,
      clientEpoch: 1,
      workerEpoch: 1,
      current: Object.freeze({ revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation: 1 }), tick: 1, stateHash: HASH_A }),
      stageId,
      state: "staged" as const,
      receivedChunks: stagedChunks.length,
      chunkCount,
      receivedBytes: stagedChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
      setHash: "0".repeat(32),
      manifestHash: "0".repeat(32),
      dispatcherRequestId: 0,
      remainingDirtyRecords: 0,
    });
  };

  const runtime = {
    stageCompatibilitySaveChunk,
    async migrateHistoricalExternalV2(
      stageId: string,
      createdAt: number,
      proposalBytes: Uint8Array,
      projection: Uint8Array,
    ) {
      operations.push("migrate");
      assert.equal(stageId, stagedId);
      assert.deepEqual(projection, plan.nativeWorld.projectionBytes);
      const proposal = decodeRustHistoricalExternalDescriptorProposalV2(proposalBytes);
      assert.equal(proposal.external.chunks.length, stagedChunks.length);
      assert.equal(stagedChunks.reduce((total, chunk) => total + chunk.byteLength, 0), stagedBytes);
      const installed = install(proposal, createdAt, "initial-migration");
      interruptInstalledCheckpoint("initial-migration", installed);
      return Object.freeze({
        response: Object.freeze({ type: "runtime-bulk-data-v1" as const }),
        receipt: receiptFor("initial-migration", stageId, createdAt, installed.descriptor, installed.hashes.saveSetHash, installed.hashes.manifestHash),
      });
    },
    async finalizeHistoricalExternalSaveV2(
      stageId: string,
      createdAt: number,
      proposalBytes: Uint8Array,
      expectedPriorCheckpointBytes: Uint8Array,
    ) {
      operations.push("save");
      assert.equal(stageId, stagedId);
      const expectedPrior = latest?.checkpointId.startsWith("historical-partial:")
        ? checkpoints.get(latest.parentCheckpointId ?? "") ?? null
        : latest;
      assert.ok(expectedPrior, "an external successor must name one exact durable prior checkpoint");
      assert.deepEqual(
        expectedPriorCheckpointBytes,
        encodeRustPersistenceCheckpointWireV1(expectedPrior),
        "op12 must carry the exact canonical prior checkpoint, not merely a matching sequence or identifier",
      );
      const proposal = decodeRustHistoricalExternalDescriptorProposalV2(proposalBytes);
      const installed = install(proposal, createdAt, "external-save");
      interruptInstalledCheckpoint("external-save", installed);
      return Object.freeze({
        response: Object.freeze({ type: "runtime-bulk-data-v1" as const }),
        receipt: receiptFor("external-save", stageId, createdAt, installed.descriptor, installed.hashes.saveSetHash, installed.hashes.manifestHash),
      });
    },
    async hydrateHistoricalExternalRecoveryV2(recoveryId: string) {
      operations.push(`hydrate:${recoveryId}`);
      const checkpoint = activeRecovery;
      assert.ok(checkpoint);
      assert.equal(checkpoint.checkpointId, recoveryId);
      const descriptorRecord = checkpoint.records.find(record =>
        record.address.recordId === "historical-external-descriptor-v2")!;
      const descriptor = decodeRustHistoricalExternalDescriptorV2(recordBytes.get(recordStorageKey(
          descriptorRecord.address,
          descriptorRecord.revision,
        ))!);
      const hashes = terminalHashes.get(checkpoint.checkpointId)!;
      const receipt = receiptFor("recovery", recoveryId, checkpoint.createdAt, descriptor, hashes.saveSetHash, hashes.manifestHash);
      return Object.freeze({
        response: Object.freeze({ type: "runtime-bulk-data-v1" as const }),
        receipt: options.mutateRecoveryReceipt ? options.mutateRecoveryReceipt(receipt) : receipt,
      });
    },
    async reconcileHistoricalExternalFallbackV2(
      fallbackRecoveryId: string,
      createdAt: number,
      observation: Uint8Array,
    ) {
      operations.push("reconcile");
      const captured = reconciliationObservation;
      assert.ok(captured);
      assert.equal(fallbackRecoveryId, captured.fallback.checkpointId);
      assert.equal(createdAt, captured.observedLatest.createdAt);
      assert.deepEqual(observation, captured.bytes);
      assert.equal(latest?.checkpointId, captured.observedLatest.checkpointId);

      const descriptorRecord = captured.fallback.records.find(record =>
        record.address.recordId === "historical-external-descriptor-v2")!;
      const fallbackDescriptor = decodeRustHistoricalExternalDescriptorV2(recordBytes.get(recordStorageKey(
        descriptorRecord.address,
        descriptorRecord.revision,
      ))!);
      stagedChunks = fallbackDescriptor.mutable.chunks.map((chunk) => {
        const address = rustHistoricalExternalDocumentChunkAddressV2(
          plan.target.universeId,
          plan.target.locationId,
          chunk.index,
        );
        const record = captured.fallback.records.find(candidate =>
          persistenceRecordKeyV1(candidate.address) === persistenceRecordKeyV1(address));
        assert.ok(record);
        return Uint8Array.from(recordBytes.get(recordStorageKey(record.address, record.revision))!);
      });
      const proposal = createRustHistoricalExternalDescriptorProposalV2({
        immutable: fallbackDescriptor.immutable,
        currentDocument: fallbackDescriptor.mutable.currentDocument,
        expectedPreviousDocument: fallbackDescriptor.mutable.expectedPreviousDocument,
        chunks: fallbackDescriptor.mutable.chunks,
      });
      const installed = install(proposal, createdAt, "reconciliation");
      const base = receiptFor(
        "recovery",
        fallbackRecoveryId,
        createdAt,
        installed.descriptor,
        installed.hashes.saveSetHash,
        installed.hashes.manifestHash,
      );
      const receipt = Object.freeze({
        ...base,
        operation: "reconciliation" as const,
        stageId: null,
        recoveryId: fallbackRecoveryId,
        dispatcherRequestId: sequence + 1,
        remainingDirtyRecords: 0,
        reconciliation: Object.freeze({
          observationHash: persistencePayloadHashV1(observation),
          expectedStorageRevision: captured.observedLatest.journalSequence,
          observedLatestCheckpointId: captured.observedLatest.checkpointId,
          observedLatestCheckpointHash: captured.observedLatest.checkpointHash,
          observedLatestJournalSequence: captured.observedLatest.journalSequence,
          fallbackCheckpointId: captured.fallback.checkpointId,
          fallbackCheckpointHash: captured.fallback.checkpointHash,
          fallbackJournalSequence: captured.fallback.journalSequence,
          targetCheckpointId: installed.checkpoint.checkpointId,
          targetCheckpointHash: installed.checkpoint.checkpointHash,
          targetJournalSequence: installed.checkpoint.journalSequence,
          planHash: HASH_A,
        }),
      });
      reconciliationObservation = null;
      return Object.freeze({
        response: Object.freeze({ type: "runtime-bulk-data-v1" as const }),
        receipt,
      });
    },
  } as unknown as RustNativeWorldPersistenceSessionOptionsV1["runtime"];

  const terminalStatus = (checkpoint: PersistenceCheckpointV1 | null): RustIntegratedPersistenceStatusReceiptV1 => {
    const hashes = checkpoint ? terminalHashes.get(checkpoint.checkpointId)! : null;
    return Object.freeze({
      persistenceRevision: checkpoint?.journalSequence ?? 0,
      pending: 0,
      queuedBytes: 0,
      dispatcherStateHash: HASH_A,
      authorityStateHash: HASH_B,
      closed: false,
      terminal: checkpoint !== null,
      terminalCheckpoint: checkpoint && hashes ? Object.freeze({
        checkpointId: checkpoint.checkpointId,
        checkpointHash: checkpoint.checkpointHash,
        journalSequence: checkpoint.journalSequence,
        recordCount: checkpoint.records.length,
        saveSetHash: hashes.saveSetHash,
        manifestHash: hashes.manifestHash,
      }) : null,
    });
  };
  const port = {
    async recover(_worldId: string, checkpointId: string) {
      operations.push(`recover:${checkpointId}`);
      activeRecovery = checkpoints.get(checkpointId) ?? null;
      if (!activeRecovery) throw new Error("missing recovery checkpoint");
      return Object.freeze({ requestId: 1, persistenceRevision: 1, pending: 1, queuedBytes: 1, stateHash: HASH_A, closed: false });
    },
    async readRecoveryPage(_worldId: string, checkpointId: string, start: number) {
      operations.push(`page:${checkpointId}:${start}`);
      return Object.freeze({ requestId: 1, persistenceRevision: 1, pending: 1, queuedBytes: 1, stateHash: HASH_A, closed: false });
    },
    async status() { return terminalStatus(activeRecovery ?? latest); },
    async close() { return Object.freeze({ requestId: 1, persistenceRevision: 1, pending: 0, queuedBytes: 0, stateHash: HASH_A, closed: true }); },
  } as unknown as RustNativeWorldPersistenceSessionOptionsV1["port"];
  const pump = {
    async flush() {
      operations.push("flush");
      if (failNextFlush) {
        failNextFlush = false;
        throw new Error("injected historical commit interruption");
      }
      return Object.freeze({ operations: 1, requestBytes: 10, responseBytes: 11, idle: true });
    },
    async shutdown() { pumpClosed = true; },
    isClosed() { return pumpClosed; },
  } as unknown as RustNativeWorldPersistenceSessionOptionsV1["pump"];
  const reader = {
    async readLatestCheckpoint() { return latest; },
    async readCheckpoint(_worldId: string, checkpointId: string) { return checkpoints.get(checkpointId) ?? null; },
    async readRecord(address: PersistenceRecordAddressV1, revision?: number) {
      if (revision === undefined) return null;
      const value = recordBytes.get(recordStorageKey(address, revision));
      return value ? Uint8Array.from(value) : null;
    },
    async captureHistoricalExternalReconciliationObservationV2(
      requestedWorldId: string,
      fallbackCheckpointId: string,
    ) {
      assert.equal(requestedWorldId, worldId);
      assert.ok(latest);
      const fallback = checkpoints.get(fallbackCheckpointId);
      assert.ok(fallback);
      assert.equal(latest.parentCheckpointId, fallback.checkpointId);
      const bytes = encoder.encode(JSON.stringify({
        worldId,
        latest: [latest.checkpointId, latest.checkpointHash, latest.journalSequence],
        fallback: [fallback.checkpointId, fallback.checkpointHash, fallback.journalSequence],
      }));
      reconciliationObservation = Object.freeze({ fallback, observedLatest: latest, bytes });
      operations.push(`observe:${latest.checkpointId}:${fallback.checkpointId}`);
      return Uint8Array.from(bytes);
    },
  };

  const makeSession = (maxParentFallbacks?: number) => new RustNativeWorldPersistenceSessionV1({
    worldId,
    runtime,
    port,
    pump,
    checkpoints: reader,
    maxParentFallbacks,
  });
  return {
    operations,
    makeSession,
    latest: () => latest,
    checkpoint: (checkpointId: string) => checkpoints.get(checkpointId) ?? null,
    appendLatestRecord(address: PersistenceRecordAddressV1, bytes: Uint8Array) {
      assert.ok(latest);
      const records = [...latest.records, put(address, 1, bytes)].sort((left, right) => {
        const leftKey = persistenceRecordKeyV1(left.address);
        const rightKey = persistenceRecordKeyV1(right.address);
        return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
      });
      latest = createPersistenceCheckpointV1({
        checkpointId: latest.checkpointId,
        parentCheckpointId: latest.parentCheckpointId,
        worldId: latest.worldId,
        journalSequence: latest.journalSequence,
        generatorHash: latest.generatorHash,
        contentHash: latest.contentHash,
        createdAt: latest.createdAt,
        records,
      });
      checkpoints.set(latest.checkpointId, latest);
    },
    replaceLatestRecord(address: PersistenceRecordAddressV1, revision: number, bytes: Uint8Array) {
      assert.ok(latest);
      const records = [
        ...latest.records.filter(record => persistenceRecordKeyV1(record.address) !== persistenceRecordKeyV1(address)),
        put(address, revision, bytes),
      ].sort((left, right) => {
        const leftKey = persistenceRecordKeyV1(left.address);
        const rightKey = persistenceRecordKeyV1(right.address);
        return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
      });
      latest = createPersistenceCheckpointV1({
        checkpointId: latest.checkpointId,
        parentCheckpointId: latest.parentCheckpointId,
        worldId: latest.worldId,
        journalSequence: latest.journalSequence,
        generatorHash: latest.generatorHash,
        contentHash: latest.contentHash,
        createdAt: latest.createdAt,
        records,
      });
      checkpoints.set(latest.checkpointId, latest);
    },
    reparentLatest(parentCheckpointId: string) {
      assert.ok(latest);
      latest = createPersistenceCheckpointV1({
        checkpointId: latest.checkpointId,
        parentCheckpointId,
        worldId: latest.worldId,
        journalSequence: latest.journalSequence,
        generatorHash: latest.generatorHash,
        contentHash: latest.contentHash,
        createdAt: latest.createdAt,
        records: latest.records,
      });
      checkpoints.set(latest.checkpointId, latest);
    },
    corruptRecord(recordId: string) {
      assert.ok(latest);
      const descriptor = latest.records.find(record => record.address.recordId === recordId);
      assert.ok(descriptor);
      const key = recordStorageKey(descriptor.address, descriptor.revision);
      const bytes = Uint8Array.from(recordBytes.get(key)!);
      bytes[0] ^= 0xff;
      recordBytes.set(key, bytes);
    },
    corruptCheckpointRecord(checkpointId: string, recordId: string) {
      const checkpoint = checkpoints.get(checkpointId);
      assert.ok(checkpoint);
      const descriptor = checkpoint.records.find(record => record.address.recordId === recordId);
      assert.ok(descriptor);
      const key = recordStorageKey(descriptor.address, descriptor.revision);
      const bytes = Uint8Array.from(recordBytes.get(key)!);
      bytes[0] ^= 0xff;
      recordBytes.set(key, bytes);
    },
  };
}

async function preparedHistoricalWorld() {
  const input = sourceInput();
  const plan = await planRustHistoricalSaveCompatibilityV1(input);
  const document = storedWorld(input);
  const envelope = await envelopeFor(document, input, null);
  return { input, plan, document, envelope };
}

test("initial historical migration stages the exact opaque document and exposes only Rust-rebound BWHE", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan);
  const session = fixture.makeSession();

  const result = await session.migrateHistoricalExternal(
    prepared.plan,
    prepared.input,
    prepared.envelope,
    100,
  );

  assert.equal(result.status, "migrated");
  assert.equal(result.envelope.currentDocument.revision, 1);
  assert.deepEqual(plain(result.document), plain(prepared.document));
  assert.equal(result.descriptor.mutable.nativeRecords.length, 6);
  assert.equal(result.receipt.nativeWorldSemanticHash, prepared.plan.nativeWorld.projectionHash);
  assert.equal(result.receipt.nativeWorldEditCount, prepared.plan.nativeWorld.editCount);
  assert.ok(fixture.operations.indexOf("stage:0") < fixture.operations.indexOf("migrate"));
  const diagnostics = session.diagnostics();
  assert.equal(diagnostics.historicalMigrations, 1);
  assert.equal(diagnostics.historicalHead?.descriptorHash, result.descriptor.descriptorHash);
  assert.equal(diagnostics.historicalHead?.authorityClaim, RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1);
  assert.equal(diagnostics.historicalHead?.documentRevision, 1);
  assert.equal(diagnostics.historicalHead?.documentSha256, result.envelope.currentDocument.sha256);
  assert.equal(diagnostics.historicalHead?.sourceSha256, prepared.input.originalSource.rawSha256);
  assert.equal(diagnostics.historicalHead?.sourceByteLength, prepared.input.originalSource.byteLength);
  assert.equal(diagnostics.historicalHead?.nativePlayer, "off");
  assert.equal(diagnostics.historicalHead?.nativeRichState, "not-adopted");
  assert.equal(diagnostics.historicalHead?.checkpointHash, result.checkpointHash);
  assert.equal(fixture.latest()?.records.some(record => record.address.recordId.startsWith("compatibility-v1-")), false);
});

test("restarted initial migration resumes only an identical strict Rust-authored prefix", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan, {
    interruptOnce: { operation: "initial-migration", afterRecords: 3 },
  });
  await assert.rejects(
    fixture.makeSession().migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 105),
    /injected historical commit interruption/,
  );
  const partialId = fixture.latest()?.checkpointId;
  assert.match(partialId ?? "", /^historical-partial:/u);
  const transportsBefore = fixture.operations.filter(entry => entry === "migrate").length;

  await assert.rejects(
    fixture.makeSession().migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 106),
    /timestamp|prefix/i,
  );
  const changedDocument = structuredClone(prepared.document);
  changedDocument.metadata.playTimeMs += 1;
  const changedEnvelope = await envelopeFor(changedDocument, prepared.input, null);
  await assert.rejects(
    fixture.makeSession().migrateHistoricalExternal(prepared.plan, prepared.input, changedEnvelope, 105),
    /identical BWHP|descriptor|prefix/i,
  );
  assert.equal(fixture.operations.filter(entry => entry === "migrate").length, transportsBefore);

  const resumed = await fixture.makeSession().migrateHistoricalExternal(
    prepared.plan,
    prepared.input,
    prepared.envelope,
    105,
  );
  assert.equal(resumed.status, "migrated");
  assert.equal(resumed.envelope.currentDocument.revision, 1);
  assert.ok(fixture.operations.includes(`recover:${partialId}`));
  assert.equal(fixture.operations.filter(entry => entry === "migrate").length, 2);

  const restarted = await fixture.makeSession().recoverHistoricalExternal(prepared.plan, prepared.input);
  assert.equal(restarted.status, "hydrated");
  if (restarted.status === "hydrated") assert.deepEqual(restarted.document, resumed.document);
});

test("historical migration revalidates the exact raw source and rejects richer authority before transport", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan);
  const session = fixture.makeSession();
  const staleInput = structuredClone(prepared.input);
  staleInput.sourceBytes[0] ^= 0xff;
  await assert.rejects(
    session.migrateHistoricalExternal(prepared.plan, staleInput, prepared.envelope, 101),
    /source bytes|source/i,
  );
  assert.deepEqual(fixture.operations, []);

  const richerPlan = structuredClone(prepared.plan) as unknown as {
    authority: { nativePlayer: string };
  };
  richerPlan.authority.nativePlayer = "r5";
  await assert.rejects(
    session.migrateHistoricalExternal(
      richerPlan as unknown as RustHistoricalSaveCompatibilityPlanV1,
      prepared.input,
      prepared.envelope,
      102,
    ),
    /nativePlayer|stale|authority|shape|projection/i,
  );
  assert.deepEqual(fixture.operations, []);
});

test("external saves CAS the exact recovered descriptor and advance one document revision", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan);
  const session = fixture.makeSession();
  const first = await session.migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 110);
  const nextDocument = structuredClone(first.document);
  nextDocument.metadata.playTimeMs += 25;
  nextDocument.metadata.updatedAt += 1;
  const nextEnvelope = await envelopeFor(nextDocument, prepared.input, previousFrom(first.envelope));

  const saved = await session.saveHistoricalExternal(first.descriptor, nextEnvelope, 111);

  assert.equal(saved.status, "saved");
  assert.equal(saved.envelope.currentDocument.revision, 2);
  assert.deepEqual(saved.envelope.expectedPreviousDocument, first.envelope.currentDocument);
  assert.deepEqual(plain(saved.document), plain(nextDocument));
  assert.equal(session.diagnostics().historicalSaves, 1);
  assert.equal(session.diagnostics().historicalHead?.documentRevision, 2);

  await assert.rejects(
    session.saveHistoricalExternal(first.descriptor, nextEnvelope, 112),
    /exact session descriptor head/u,
  );
  assert.equal(fixture.operations.filter(entry => entry === "save").length, 1);
});

test("external save rejects an envelope that does not CAS the exact document head", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan);
  const session = fixture.makeSession();
  const first = await session.migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 115);
  const unrelated = await envelopeFor(structuredClone(first.document), prepared.input, null);
  const transportBefore = fixture.operations.length;

  await assert.rejects(
    session.saveHistoricalExternal(first.descriptor, unrelated, 116),
    /CAS|successor|revision|head/i,
  );

  assert.equal(fixture.operations.length, transportBefore);
  assert.equal(session.diagnostics().historicalHead?.documentRevision, 1);
});

test("a matching checkpoint sequence with a different prior hash cannot stage or finalize an external successor", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan);
  const session = fixture.makeSession();
  const first = await session.migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 116);
  const nextDocument = structuredClone(first.document);
  nextDocument.metadata.updatedAt += 1;
  const nextEnvelope = await envelopeFor(nextDocument, prepared.input, previousFrom(first.envelope));
  const manifest = fixture.latest()?.records.find(record => record.address.recordId === "manifest-v1");
  assert.ok(manifest);

  // Preserve the checkpoint identifier and journal sequence while changing its
  // canonical hash. A sequence-only CAS would accept this forged parent.
  fixture.replaceLatestRecord(manifest.address, manifest.revision + 1, encoder.encode("foreign-manifest"));
  const forgedPrior = structuredClone(fixture.latest());
  assert.ok(forgedPrior);
  assert.equal(forgedPrior.checkpointId, first.checkpointId);
  assert.equal(forgedPrior.journalSequence, first.journalSequence);
  assert.notEqual(forgedPrior.checkpointHash, first.checkpointHash);
  const operationsBefore = [...fixture.operations];

  await assert.rejects(
    session.saveHistoricalExternal(first.descriptor, nextEnvelope, 117),
    /prefix|BWHE|descriptor|historical/i,
  );

  assert.deepEqual(fixture.latest(), forgedPrior, "rejected wrong-hash parent must not be rewritten");
  assert.deepEqual(fixture.operations, operationsBefore, "wrong-hash parent must fail before browser staging or op12");
  assert.equal(session.diagnostics().historicalHead?.checkpointHash, first.checkpointHash);
});

test("recovery fails closed for a contiguous reserved chunk and a foreign revisioned native payload", async () => {
  for (const tamper of ["contiguous-reserved-chunk", "foreign-native-revision"] as const) {
    const prepared = await preparedHistoricalWorld();
    const fixture = historicalFixture(prepared.plan);
    const committed = await fixture.makeSession().migrateHistoricalExternal(
      prepared.plan,
      prepared.input,
      prepared.envelope,
      tamper === "contiguous-reserved-chunk" ? 118 : 119,
    );

    if (tamper === "contiguous-reserved-chunk") {
      fixture.appendLatestRecord(
        rustHistoricalExternalDocumentChunkAddressV2(
          prepared.plan.target.universeId,
          prepared.plan.target.locationId,
          committed.envelope.chunks.length,
        ),
        encoder.encode("contiguous-but-reserved-external-chunk"),
      );
    } else {
      const expected = committed.descriptor.mutable.nativeRecords[0];
      fixture.replaceLatestRecord(
        expected.address,
        expected.revision + 1,
        Uint8Array.of(0xfa, 0xce),
      );
    }
    const tamperedCheckpoint = structuredClone(fixture.latest());
    const operationsBefore = [...fixture.operations];

    const recovered = await fixture.makeSession().recoverHistoricalExternal(prepared.plan, prepared.input);

    assert.equal(recovered.status, "blocked", tamper);
    if (recovered.status === "blocked") {
      assert.match(recovered.message, /exact|chunk|native record|pair|BWHE/i, tamper);
      assert.deepEqual(recovered.attemptedCheckpointIds, [tamperedCheckpoint!.checkpointId], tamper);
    }
    assert.deepEqual(fixture.latest(), tamperedCheckpoint, `${tamper} must not rewrite the durable checkpoint`);
    assert.deepEqual(fixture.operations, operationsBefore, `${tamper} must fail before recovery hydration or reconciliation`);
  }
});

test("restarted successor save resumes only after the new BWHE native set is exact", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan, {
    interruptOnce: { operation: "external-save", afterRecords: 1 },
  });
  const writer = fixture.makeSession();
  const first = await writer.migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 117);
  const nextDocument = structuredClone(first.document);
  nextDocument.metadata.playTimeMs += 2;
  nextDocument.metadata.updatedAt += 1;
  const nextEnvelope = await envelopeFor(nextDocument, prepared.input, previousFrom(first.envelope));
  await assert.rejects(
    writer.saveHistoricalExternal(first.descriptor, nextEnvelope, 118),
    /injected historical commit interruption/,
  );
  const partialId = fixture.latest()?.checkpointId;
  assert.match(partialId ?? "", /^historical-partial:/u);

  const restarted = fixture.makeSession();
  const parent = await restarted.recoverHistoricalExternal(prepared.plan, prepared.input);
  assert.equal(parent.status, "hydrated");
  if (parent.status !== "hydrated") return;
  assert.equal(parent.checkpointId, first.checkpointId);
  assert.equal(parent.fallbackDepth, 1);
  assert.equal(restarted.diagnostics().historicalHead, null);

  const saved = await restarted.saveHistoricalExternal(parent.descriptor, nextEnvelope, 118);
  assert.equal(saved.status, "saved");
  assert.equal(saved.envelope.currentDocument.revision, 2);
  assert.deepEqual(plain(saved.document), plain(nextDocument));
  assert.ok(fixture.operations.includes(`recover:${partialId}`));

  const readback = await fixture.makeSession().recoverHistoricalExternal(prepared.plan, prepared.input);
  assert.equal(readback.status, "hydrated");
  if (readback.status !== "hydrated") return;
  assert.equal(readback.checkpointId, saved.checkpointId);
  assert.equal(readback.envelope.currentDocument.revision, 2);
  assert.deepEqual(readback.document, saved.document);
});

test("successor prefix recovery rejects an uncommitted descriptor-bound native record", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan, {
    interruptOnce: { operation: "external-save", afterRecords: 1 },
    changeNativeOnExternalSave: 1,
  });
  const writer = fixture.makeSession();
  const first = await writer.migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 119);
  const nextDocument = structuredClone(first.document);
  nextDocument.metadata.updatedAt += 1;
  const nextEnvelope = await envelopeFor(nextDocument, prepared.input, previousFrom(first.envelope));
  await assert.rejects(
    writer.saveHistoricalExternal(first.descriptor, nextEnvelope, 120),
    /injected historical commit interruption/,
  );

  const restarted = fixture.makeSession();
  const parent = await restarted.recoverHistoricalExternal(prepared.plan, prepared.input);
  assert.equal(parent.status, "hydrated");
  if (parent.status !== "hydrated") return;
  const saveTransports = fixture.operations.filter(entry => entry === "save").length;
  await assert.rejects(
    restarted.saveHistoricalExternal(parent.descriptor, nextEnvelope, 120),
    /native record|canonical dirty-record prefix|historical-prefix/i,
  );
  assert.equal(fixture.operations.filter(entry => entry === "save").length, saveTransports);
});

test("successor prefix rejects unknown and gapped records without changing its prior head", async () => {
  for (const tamper of ["unknown", "gapped"] as const) {
    const prepared = await preparedHistoricalWorld();
    const fixture = historicalFixture(prepared.plan, {
      interruptOnce: { operation: "external-save", afterRecords: 1 },
    });
    const writer = fixture.makeSession();
    const first = await writer.migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 121);
    const nextDocument = structuredClone(first.document);
    nextDocument.metadata.updatedAt += 1;
    const nextEnvelope = await envelopeFor(nextDocument, prepared.input, previousFrom(first.envelope));
    await assert.rejects(
      writer.saveHistoricalExternal(first.descriptor, nextEnvelope, 122),
      /injected historical commit interruption/,
    );
    const restarted = fixture.makeSession();
    const parent = await restarted.recoverHistoricalExternal(prepared.plan, prepared.input);
    assert.equal(parent.status, "hydrated");
    assert.equal(parent.status === "hydrated" ? parent.checkpointId : null, first.checkpointId);
    const priorBefore = structuredClone(fixture.checkpoint(first.checkpointId));
    if (tamper === "unknown") {
      fixture.appendLatestRecord({
        universeId: prepared.plan.target.universeId,
        locationId: prepared.plan.target.locationId,
        kind: "settings-reference",
        recordId: "foreign-successor-record",
      }, encoder.encode("validly-hashed-but-unknown"));
    } else {
      fixture.appendLatestRecord(
        rustHistoricalExternalDocumentChunkAddressV2(
          prepared.plan.target.universeId,
          prepared.plan.target.locationId,
          2,
        ),
        encoder.encode("gapped-old-document-chunk"),
      );
    }
    const latestBefore = structuredClone(fixture.latest());
    const operationsBefore = [...fixture.operations];
    await assert.rejects(
      restarted.saveHistoricalExternal(parent.status === "hydrated" ? parent.descriptor : first.descriptor, nextEnvelope, 122),
      /prefix|record|canonical/i,
    );
    assert.deepEqual(fixture.latest(), latestBefore);
    assert.deepEqual(fixture.checkpoint(first.checkpointId), priorBefore);
    assert.deepEqual(fixture.operations, operationsBefore);
    assert.equal(restarted.diagnostics().historicalHead, null);
  }
});

test("successor prefix rejects a resealed non-direct parent without writable promotion", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan, {
    interruptOnce: { operation: "external-save", afterRecords: 1 },
  });
  const writer = fixture.makeSession();
  const first = await writer.migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 123);
  const nextDocument = structuredClone(first.document);
  nextDocument.metadata.updatedAt += 1;
  const nextEnvelope = await envelopeFor(nextDocument, prepared.input, previousFrom(first.envelope));
  await assert.rejects(
    writer.saveHistoricalExternal(first.descriptor, nextEnvelope, 124),
    /injected historical commit interruption/,
  );
  const restarted = fixture.makeSession();
  const parent = await restarted.recoverHistoricalExternal(prepared.plan, prepared.input);
  assert.equal(parent.status, "hydrated");
  const priorBefore = structuredClone(fixture.checkpoint(first.checkpointId));
  fixture.reparentLatest("forged-non-direct-parent");
  const latestBefore = structuredClone(fixture.latest());
  const operationsBefore = [...fixture.operations];
  await assert.rejects(
    restarted.saveHistoricalExternal(parent.status === "hydrated" ? parent.descriptor : first.descriptor, nextEnvelope, 124),
    /prefix|parent|lineage|storage/i,
  );
  assert.deepEqual(fixture.latest(), latestBefore);
  assert.deepEqual(fixture.checkpoint(first.checkpointId), priorBefore);
  assert.deepEqual(fixture.operations, operationsBefore);
  assert.equal(restarted.diagnostics().historicalHead, null);
});

test("a fresh session recovers the exact external document only after Rust-derived native readback", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan);
  const writer = fixture.makeSession();
  const committed = await writer.migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 120);
  const reader = fixture.makeSession();

  const recovered = await reader.recoverHistoricalExternal(prepared.plan, prepared.input);

  assert.equal(recovered.status, "hydrated");
  if (recovered.status !== "hydrated") return;
  assert.equal(recovered.checkpointId, committed.checkpointId);
  assert.deepEqual(recovered.document, committed.document);
  assert.deepEqual(recovered.envelope, committed.envelope);
  assert.equal(recovered.receipt.operation, "recovery");
  assert.equal(recovered.receipt.dispatcherRequestId, 0);
  assert.ok(fixture.operations.includes(`hydrate:${committed.checkpointId}`));
  assert.equal(reader.diagnostics().historicalRecoveries, 1);
  assert.equal(reader.diagnostics().historicalHead?.nativeWorldSemanticHash, prepared.plan.nativeWorld.projectionHash);
});

test("torn external bytes and mismatched Rust R4 attestation block without exposing StoredWorld", async () => {
  const prepared = await preparedHistoricalWorld();
  const torn = historicalFixture(prepared.plan);
  const committed = await torn.makeSession().migrateHistoricalExternal(
    prepared.plan,
    prepared.input,
    prepared.envelope,
    130,
  );
  torn.corruptRecord("historical-external-document-v2-00000000");
  const blocked = await torn.makeSession(0).recoverHistoricalExternal(prepared.plan, prepared.input);
  assert.equal(blocked.status, "blocked");
  if (blocked.status === "blocked") {
    assert.match(blocked.message, /byte\/hash readback|pair/i);
    assert.deepEqual(blocked.attemptedCheckpointIds, [committed.checkpointId]);
  }
  assert.equal(torn.operations.some(entry => entry.startsWith("hydrate:")), false);

  const wrongNative = historicalFixture(prepared.plan, {
    mutateRecoveryReceipt(receipt) {
      return Object.freeze({ ...receipt, nativeWorldSemanticHash: "ff".repeat(16) });
    },
  });
  await wrongNative.makeSession().migrateHistoricalExternal(
    prepared.plan,
    prepared.input,
    prepared.envelope,
    131,
  );
  const nativeBlocked = await wrongNative.makeSession(0).recoverHistoricalExternal(prepared.plan, prepared.input);
  assert.equal(nativeBlocked.status, "blocked");
  if (nativeBlocked.status === "blocked") assert.match(nativeBlocked.message, /receipt|R4|pair/i);
});

test("native record corruption and a freshly revalidated content target mismatch both block", async () => {
  const prepared = await preparedHistoricalWorld();
  const nativeCorrupt = historicalFixture(prepared.plan);
  await nativeCorrupt.makeSession().migrateHistoricalExternal(
    prepared.plan,
    prepared.input,
    prepared.envelope,
    135,
  );
  nativeCorrupt.corruptRecord("rust-world-r4-v1");
  const corruptResult = await nativeCorrupt.makeSession(0)
    .recoverHistoricalExternal(prepared.plan, prepared.input);
  assert.equal(corruptResult.status, "blocked");
  if (corruptResult.status === "blocked") assert.match(corruptResult.message, /native record|byte\/hash|pair/i);

  const targetDrift = historicalFixture(prepared.plan);
  await targetDrift.makeSession().migrateHistoricalExternal(
    prepared.plan,
    prepared.input,
    prepared.envelope,
    136,
  );
  const changedInput = {
    ...structuredClone(prepared.input),
    target: {
      ...structuredClone(prepared.input.target),
      contentHash: "cd".repeat(16),
    },
  };
  const changedPlan = await planRustHistoricalSaveCompatibilityV1(changedInput);
  const driftResult = await targetDrift.makeSession(0)
    .recoverHistoricalExternal(changedPlan, changedInput);
  assert.equal(driftResult.status, "blocked");
  if (driftResult.status === "blocked") assert.match(driftResult.message, /content|BWHE|custody|pair/i);
});

test("a corrupt newest pair is atomically reconciled before its fallback becomes writable", async () => {
  const prepared = await preparedHistoricalWorld();
  const fixture = historicalFixture(prepared.plan);
  const writer = fixture.makeSession();
  const first = await writer.migrateHistoricalExternal(prepared.plan, prepared.input, prepared.envelope, 140);
  const nextDocument = structuredClone(first.document);
  nextDocument.metadata.updatedAt += 1;
  const nextEnvelope = await envelopeFor(nextDocument, prepared.input, previousFrom(first.envelope));
  const corruptHead = await writer.saveHistoricalExternal(first.descriptor, nextEnvelope, 141);
  fixture.corruptRecord("historical-external-document-v2-00000000");

  const repairedSession = fixture.makeSession();
  const recovered = await repairedSession.recoverHistoricalExternal(prepared.plan, prepared.input);

  assert.equal(recovered.status, "hydrated");
  if (recovered.status !== "hydrated") return;
  assert.equal(recovered.fallbackDepth, 1);
  assert.notEqual(recovered.checkpointId, first.checkpointId);
  assert.notEqual(recovered.checkpointId, corruptHead.checkpointId);
  assert.equal(recovered.journalSequence, corruptHead.journalSequence + 1);
  assert.equal(recovered.envelope.currentDocument.revision, 1);
  assert.deepEqual(recovered.document, first.document);
  assert.equal(repairedSession.diagnostics().historicalHead?.checkpointId, recovered.checkpointId);
  assert.ok(fixture.operations.includes(`observe:${corruptHead.checkpointId}:${first.checkpointId}`));
  assert.ok(fixture.operations.includes("reconcile"));

  const postRepairDocument = structuredClone(recovered.document);
  postRepairDocument.metadata.updatedAt += 2;
  postRepairDocument.metadata.playTimeMs += 3;
  const postRepairEnvelope = await envelopeFor(
    postRepairDocument,
    prepared.input,
    previousFrom(recovered.envelope),
  );
  const saved = await repairedSession.saveHistoricalExternal(
    recovered.descriptor,
    postRepairEnvelope,
    142,
  );
  assert.equal(saved.status, "saved");
  assert.equal(saved.envelope.currentDocument.revision, 2);

  const restarted = await fixture.makeSession().recoverHistoricalExternal(prepared.plan, prepared.input);
  assert.equal(restarted.status, "hydrated");
  if (restarted.status !== "hydrated") return;
  assert.equal(restarted.checkpointId, saved.checkpointId);
  assert.equal(restarted.fallbackDepth, 0);
  assert.deepEqual(restarted.document, saved.document);
});
