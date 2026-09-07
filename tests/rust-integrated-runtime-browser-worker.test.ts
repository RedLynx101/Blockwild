import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRustIntegratedRuntimeWasmExportsV2,
  RustIntegratedRuntimeBrowserKernelV1,
} from "../app/game/rust-integrated-runtime-browser-worker.ts";
import {
  RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
  RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2,
  RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_TYPE_V2,
  RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
  decodeRustIntegratedRuntimeBulkRequestV1,
  encodeRustIntegratedRuntimeBulkResponseV1,
  encodeRustIntegratedRuntimeHistoricalExternalReceiptV2,
  rustIntegratedRuntimeBulkStateV1,
  type RustIntegratedRuntimeBulkRequestV1,
} from "../app/game/rust-integrated-runtime-bulk-platform.ts";
import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  decodeRustIntegratedRuntimeRequestV1,
  decodeRustIntegratedRuntimeStepRequestV2,
  encodeRustIntegratedRuntimeResponseV1,
  encodeRustIntegratedRuntimeStepResultV2,
} from "../app/game/rust-integrated-runtime-codec.ts";
import type { RustIntegratedRuntimeIdentityV1, RustIntegratedRuntimeResponseV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1 } from "../app/game/rust-integrated-runtime-contract.ts";
import { RustEngineLoader, type RustEngineWasmExports } from "../app/game/rust-engine-loader.ts";
import { RUST_ENGINE_PROTOCOL_VERSION, RUST_ENGINE_SCHEMA_VERSION } from "../app/game/rust-engine-protocol.ts";

const ARTIFACT_HASH = "a".repeat(64);
const ZERO_HASH = "0".repeat(32);

function identity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "1",
    locationId: "surface",
    revision: Object.freeze({ epoch: 1, world: 0, entities: 0, gameplay: 0, persistence: 0, network: 0, simulation: 0 }),
    tick: 0,
    stateHash: ZERO_HASH,
  });
}

function encoded(response: RustIntegratedRuntimeResponseV1) {
  return encodeRustIntegratedRuntimeResponseV1(response);
}

test("browser kernel attests the manifest-selected artifact instead of trusting Wasm self-reporting", async () => {
  const nativeSaveRequests: RustIntegratedRuntimeBulkRequestV1[] = [];
  const legacyMigrationRequests: Array<Readonly<{
    request: Extract<RustIntegratedRuntimeBulkRequestV1, { type: "runtime-bulk-finalize-save-v1" }>;
    legacyNonWorldStateFlags: number;
    sourceKey: string;
    sourceFormat: string;
    worldProjection: Uint8Array;
  }>> = [];
  let ordinaryBulkCalls = 0;
  let recoveryCommandCalls = 0;
  let historicalAttachment = new Uint8Array();
  let historicalSaveMode: "success" | "error" | "missing-attestation" = "success";
  const historicalSaveRequests: Array<Readonly<{
    request: Extract<RustIntegratedRuntimeBulkRequestV1, { type: "runtime-bulk-finalize-save-v1" }>;
    proposal: Uint8Array;
    expectedPriorCheckpointBytes: Uint8Array;
  }>> = [];
  const reconciliationRequests: Array<Readonly<{
    request: Extract<RustIntegratedRuntimeBulkRequestV1, { type: "runtime-bulk-finalize-save-v1" }>;
    observation: Uint8Array;
  }>> = [];
  let stepMode: "v2" | "error" | "legacy-success" = "v2";
  const base: RustEngineWasmExports = {
    blockwild_protocol_version: () => RUST_ENGINE_PROTOCOL_VERSION,
    blockwild_schema_version: () => RUST_ENGINE_SCHEMA_VERSION,
    blockwild_engine_create: () => new Uint8Array(),
    blockwild_engine_ingest: () => new Uint8Array(),
    blockwild_engine_step: () => new Uint8Array(),
    blockwild_engine_take_events: () => new Uint8Array(),
    blockwild_engine_state_hash: () => new Uint8Array(),
    blockwild_engine_destroy: () => new Uint8Array(),
  };
  const namespace = {
    ...base,
    blockwild_runtime_create_v2: () => encoded({
      type: "runtime-ready-v1",
      requestId: 1,
      clientEpoch: 1,
      workerEpoch: 1,
      runtimeHandle: 9,
      identity: identity(),
      artifactHash: "wasm-self-report-is-not-authority",
      instanceId: "native:9",
      capabilities: ["integrated-runtime-v1"],
    }),
    blockwild_runtime_command_v2: (_handle: number, bytes: Uint8Array) => {
      const request = decodeRustIntegratedRuntimeRequestV1(bytes);
      assert.equal(request.type, "runtime-recover-command-v1");
      recoveryCommandCalls += 1;
      return encoded({
        type: "runtime-error-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 1,
        code: "idempotency-recovery-miss",
        message: "fixture miss",
        current: identity(),
      });
    },
    blockwild_runtime_step_v2: (_handle: number, bytes: Uint8Array) => {
      const request = decodeRustIntegratedRuntimeStepRequestV2(bytes);
      if (stepMode === "error") return encoded({
        type: "runtime-error-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 1,
        code: "fixture-step",
        message: "fixture rejection",
        current: identity(),
      });
      if (stepMode === "legacy-success") return encoded({
        type: "runtime-step-result-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 1,
        identity: identity(),
        fixedSteps: 0,
        inputsApplied: 0,
        commandsProcessed: 0,
        commandsAccepted: 0,
        actionReceipts: [],
        replayHash: ZERO_HASH,
      });
      return encodeRustIntegratedRuntimeStepResultV2({
        type: "runtime-step-result-v2",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 1,
        identity: identity(),
        fixedSteps: 0,
        inputsApplied: 0,
        commandsProcessed: 0,
        commandsAccepted: 0,
        actionReceipts: [],
        replayHash: ZERO_HASH,
        semanticReceipts: [],
      });
    },
    blockwild_runtime_extract_v2: () => new Uint8Array(),
    blockwild_runtime_export_save_v2: () => new Uint8Array(),
    blockwild_runtime_initialize_native_save_v2: (_handle: number, control: Uint8Array) => {
      const request = decodeRustIntegratedRuntimeBulkRequestV1(control);
      nativeSaveRequests.push(request);
      if (request.type !== "runtime-bulk-finalize-save-v1") throw new Error("expected translated FinalizeSave control");
      return encodeRustIntegratedRuntimeBulkResponseV1({
        type: "runtime-bulk-save-progress-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 1,
        current: rustIntegratedRuntimeBulkStateV1(identity()),
        stageId: request.stageId,
        state: "finalized",
        receivedChunks: 0,
        chunkCount: 0,
        receivedBytes: 0,
        setHash: "1".repeat(32),
        manifestHash: "2".repeat(32),
        dispatcherRequestId: 1,
        remainingDirtyRecords: 5,
      }).control;
    },
    blockwild_runtime_migrate_legacy_v2: (
      _handle: number,
      control: Uint8Array,
      legacyNonWorldStateFlags: number,
      sourceKey: string,
      sourceFormat: string,
      worldProjection: Uint8Array,
    ) => {
      const request = decodeRustIntegratedRuntimeBulkRequestV1(control);
      if (request.type !== "runtime-bulk-finalize-save-v1") throw new Error("expected translated legacy FinalizeSave control");
      legacyMigrationRequests.push({
        request,
        legacyNonWorldStateFlags,
        sourceKey,
        sourceFormat,
        worldProjection: Uint8Array.from(worldProjection),
      });
      return encodeRustIntegratedRuntimeBulkResponseV1({
        type: "runtime-bulk-save-progress-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 1,
        current: rustIntegratedRuntimeBulkStateV1(identity()),
        stageId: request.stageId,
        state: "finalized",
        receivedChunks: 1,
        chunkCount: 1,
        receivedBytes: 3,
        setHash: "3".repeat(32),
        manifestHash: "4".repeat(32),
        dispatcherRequestId: 2,
        remainingDirtyRecords: 5,
      }).control;
    },
    blockwild_runtime_migrate_historical_external_v2: () => new Uint8Array(),
    blockwild_runtime_finalize_historical_external_save_v2: (
      _handle: number,
      control: Uint8Array,
      proposal: Uint8Array,
      expectedPriorCheckpointBytes: Uint8Array,
    ) => {
      const request = decodeRustIntegratedRuntimeBulkRequestV1(control);
      if (request.type !== "runtime-bulk-finalize-save-v1") throw new Error("expected translated historical external FinalizeSave control");
      historicalSaveRequests.push({
        request,
        proposal: Uint8Array.from(proposal),
        expectedPriorCheckpointBytes: Uint8Array.from(expectedPriorCheckpointBytes),
      });
      historicalAttachment = new Uint8Array();
      if (historicalSaveMode === "error") {
        return encodeRustIntegratedRuntimeBulkResponseV1({
          type: "runtime-bulk-error-v1",
          requestId: request.requestId,
          clientEpoch: request.clientEpoch,
          workerEpoch: 1,
          current: rustIntegratedRuntimeBulkStateV1(identity()),
          code: "fixture-historical-rejection",
          message: "fixture exact rejection",
        }).control;
      }
      if (historicalSaveMode === "missing-attestation") {
        return encodeRustIntegratedRuntimeBulkResponseV1({
          type: "runtime-bulk-save-progress-v1",
          requestId: request.requestId,
          clientEpoch: request.clientEpoch,
          workerEpoch: 1,
          current: rustIntegratedRuntimeBulkStateV1(identity()),
          stageId: request.stageId,
          state: "finalized",
          receivedChunks: 1,
          chunkCount: 1,
          receivedBytes: 3,
          setHash: "3".repeat(32),
          manifestHash: "4".repeat(32),
          dispatcherRequestId: 2,
          remainingDirtyRecords: 5,
        }).control;
      }
      const payload = encodeRustIntegratedRuntimeHistoricalExternalReceiptV2({
        operation: "external-save",
        stageId: request.stageId,
        recoveryId: null,
        createdAt: request.createdAt,
        authorityProfile: "typescript-historical-save-compatibility-v1",
        nativePlayer: "off",
        nativeRichState: "not-adopted",
        externalStateFlags: 0x7f,
        descriptorHash: "1".repeat(32),
        externalDocumentHash: "2".repeat(32),
        externalDocumentByteLength: 100,
        externalDocumentRevision: 2,
        externalChunkCount: 1,
        externalChunkSetHash: "3".repeat(32),
        projectionHash: "4".repeat(32),
        projectionByteLength: 20,
        nativeWorldSemanticHash: "4".repeat(32),
        nativeWorldEditCount: 2,
        nativeWorldFacingCount: 1,
        saveSetHash: "5".repeat(32),
        manifestHash: "6".repeat(32),
        dispatcherRequestId: 3,
        remainingDirtyRecords: 1,
        reconciliation: null,
      });
      const encodedResponse = encodeRustIntegratedRuntimeBulkResponseV1({
        type: "runtime-bulk-data-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 1,
        current: rustIntegratedRuntimeBulkStateV1(identity()),
        transferToken: 70,
        typeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2,
        chunkIndex: 0,
        chunkCount: 1,
        payload,
      });
      historicalAttachment = Uint8Array.from(encodedResponse.attachment);
      return encodedResponse.control;
    },
    blockwild_runtime_hydrate_historical_external_v2: () => new Uint8Array(),
    blockwild_runtime_reconcile_historical_external_fallback_v2: (
      _handle: number,
      control: Uint8Array,
      observation: Uint8Array,
    ) => {
      const request = decodeRustIntegratedRuntimeBulkRequestV1(control);
      if (request.type !== "runtime-bulk-finalize-save-v1") throw new Error("expected translated historical reconciliation FinalizeSave control");
      reconciliationRequests.push({ request, observation: Uint8Array.from(observation) });
      const payload = encodeRustIntegratedRuntimeHistoricalExternalReceiptV2({
        operation: "reconciliation",
        stageId: null,
        recoveryId: request.stageId,
        createdAt: request.createdAt,
        authorityProfile: "typescript-historical-save-compatibility-v1",
        nativePlayer: "off",
        nativeRichState: "not-adopted",
        externalStateFlags: 0x7f,
        descriptorHash: "5".repeat(32),
        externalDocumentHash: "6".repeat(32),
        externalDocumentByteLength: 100,
        externalDocumentRevision: 2,
        externalChunkCount: 1,
        externalChunkSetHash: "7".repeat(32),
        projectionHash: "8".repeat(32),
        projectionByteLength: 20,
        nativeWorldSemanticHash: "8".repeat(32),
        nativeWorldEditCount: 2,
        nativeWorldFacingCount: 1,
        saveSetHash: "9".repeat(32),
        manifestHash: "a".repeat(32),
        dispatcherRequestId: 3,
        remainingDirtyRecords: 0,
        reconciliation: Object.freeze({
          observationHash: "b".repeat(32),
          expectedStorageRevision: 6,
          observedLatestCheckpointId: "corrupt-latest",
          observedLatestCheckpointHash: "c".repeat(32),
          observedLatestJournalSequence: 8,
          fallbackCheckpointId: "verified-fallback",
          fallbackCheckpointHash: "d".repeat(32),
          fallbackJournalSequence: 7,
          targetCheckpointId: "reconciled-target",
          targetCheckpointHash: "e".repeat(32),
          targetJournalSequence: 9,
          planHash: "f".repeat(32),
        }),
      });
      const encodedResponse = encodeRustIntegratedRuntimeBulkResponseV1({
        type: "runtime-bulk-data-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 1,
        current: rustIntegratedRuntimeBulkStateV1(identity()),
        transferToken: 71,
        typeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2,
        chunkIndex: 0,
        chunkCount: 1,
        payload,
      });
      historicalAttachment = Uint8Array.from(encodedResponse.attachment);
      return encodedResponse.control;
    },
    blockwild_runtime_bulk_v2: () => { ordinaryBulkCalls += 1; return new Uint8Array(); },
    blockwild_runtime_bulk_take_attachment_v2: () => historicalAttachment,
    blockwild_runtime_destroy_v2: () => new Uint8Array(),
  };
  assert.throws(
    () => assertRustIntegratedRuntimeWasmExportsV2({
      ...namespace,
      blockwild_runtime_migrate_legacy_v2: undefined,
    } as unknown as RustEngineWasmExports),
    /missing export blockwild_runtime_migrate_legacy_v2/u,
    "the browser kernel must never emulate migration through ordinary finalize",
  );
  const loader = new RustEngineLoader({
    artifact: {
      moduleUrl: "https://fixture.invalid/blockwild.js",
      wasmUrl: "https://fixture.invalid/blockwild_bg.wasm",
      buildKind: "compatibility",
      buildHash: ARTIFACT_HASH,
    },
    importer: async () => namespace,
  });
  const kernel = new RustIntegratedRuntimeBrowserKernelV1(loader);
  const response = await kernel.handle({
    type: "runtime-create-v1",
    requestId: 1,
    clientEpoch: 1,
    config: {
      worldSeed: "fixture",
      universeId: "1",
      locationId: "surface",
      sessionId: "fixture",
      contentHash: ZERO_HASH,
      generatorHash: ZERO_HASH,
      ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
      waterBlockId: 7,
      directionalBlockIds: [],
      waterloggedBlockIds: [],
    },
  });
  assert.equal(response.type, "runtime-ready-v1");
  assert.equal(response.type === "runtime-ready-v1" ? response.artifactHash : null, ARTIFACT_HASH);
  assert.equal(response.type === "runtime-ready-v1" ? response.instanceId : null, "native:9");

  const stepRequest = Object.freeze({
    type: "runtime-step-v2" as const,
    requestId: 8,
    clientEpoch: 1,
    expected: identity(),
    monotonicTimeUs: 1,
    budgetUs: 8_000,
    inputs: Object.freeze([]),
    contextCommands: Object.freeze([]),
  });
  assert.equal((await kernel.handleStepV2(stepRequest)).type, "runtime-step-result-v2");
  stepMode = "error";
  assert.equal((await kernel.handleStepV2({ ...stepRequest, requestId: 9 })).type, "runtime-error-v1");
  stepMode = "legacy-success";
  await assert.rejects(kernel.handleStepV2({ ...stepRequest, requestId: 10 }), /invalid legacy response/u);

  const recovery = await kernel.handle({
    type: "runtime-recover-command-v1",
    requestId: 9,
    clientEpoch: 1,
    batch: createRustIntegratedRuntimeCommandBatchV1({
      commandId: "recover:1",
      idempotencyKey: "recover:1",
      actorId: "fixture",
      expected: identity(),
      operations: [createRustIntegratedRuntimeDomainOperationV1({
        domain: "world",
        typeId: "fixture.operation",
        schema: 1,
        payload: Uint8Array.of(1),
      })],
    }),
  });
  assert.equal(recovery.type, "runtime-error-v1");
  assert.equal(recoveryCommandCalls, 1, "operation 8 routes through the existing command Wasm export");

  const initialized = await kernel.handleBulk({
    type: "runtime-bulk-initialize-native-save-v1",
    requestId: 2,
    clientEpoch: 1,
    expected: rustIntegratedRuntimeBulkStateV1(identity()),
    saveId: "native.new.1",
    createdAt: 10,
  });
  assert.equal(initialized.type, "runtime-bulk-save-progress-v1");
  assert.equal(initialized.type === "runtime-bulk-save-progress-v1" ? initialized.stageId : null, "native.new.1");
  assert.equal(nativeSaveRequests.length, 1);
  assert.equal(nativeSaveRequests[0].type, "runtime-bulk-finalize-save-v1");

  const projection = Uint8Array.of(0x42, 0x57, 0x41, 0x53, 0x80, 0xff);
  const migrated = await kernel.handleBulk({
    type: "runtime-bulk-migrate-legacy-world-v1",
    requestId: 3,
    clientEpoch: 1,
    expected: rustIntegratedRuntimeBulkStateV1(identity()),
    stageId: "legacy.world-only.1",
    createdAt: 11,
    sourceKey: "blockwild-world-data-v1:fixture",
    sourceFormat: "blockwild-world-save-canonical-v1",
    legacyNonWorldStateFlags: 0,
    typeId: RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
    worldProjection: projection,
  });
  assert.equal(migrated.type, "runtime-bulk-save-progress-v1");
  assert.equal(migrated.type === "runtime-bulk-save-progress-v1" ? migrated.stageId : null, "legacy.world-only.1");
  assert.equal(legacyMigrationRequests.length, 1);
  assert.equal(legacyMigrationRequests[0].request.type, "runtime-bulk-finalize-save-v1");
  assert.equal(legacyMigrationRequests[0].request.stageId, "legacy.world-only.1");
  assert.equal(legacyMigrationRequests[0].request.createdAt, 11);
  assert.equal(legacyMigrationRequests[0].legacyNonWorldStateFlags, 0);
  assert.equal(legacyMigrationRequests[0].sourceKey, "blockwild-world-data-v1:fixture");
  assert.equal(legacyMigrationRequests[0].sourceFormat, "blockwild-world-save-canonical-v1");
  assert.deepEqual(legacyMigrationRequests[0].worldProjection, projection);

  const historicalProposal = Uint8Array.of(0x42, 0x57, 0x48, 0x50, 0x80, 0xff);
  const priorCheckpoint = Uint8Array.of(0x42, 0x57, 0x50, 0x53, 0x01, 0x02, 0x80, 0xff);
  const finalizedHistorical = await kernel.handleBulk({
    type: "runtime-bulk-finalize-historical-external-save-v2",
    requestId: 4,
    clientEpoch: 1,
    expected: rustIntegratedRuntimeBulkStateV1(identity()),
    stageId: "historical.external.1",
    createdAt: 12,
    proposalTypeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
    proposal: historicalProposal,
    expectedPriorCheckpointBytes: priorCheckpoint,
  });
  assert.equal(finalizedHistorical.type, "runtime-bulk-data-v1");
  assert.equal(historicalSaveRequests.length, 1);
  assert.equal(historicalSaveRequests[0].request.stageId, "historical.external.1");
  assert.equal(historicalSaveRequests[0].request.createdAt, 12);
  assert.deepEqual(historicalSaveRequests[0].proposal, historicalProposal);
  assert.deepEqual(
    historicalSaveRequests[0].expectedPriorCheckpointBytes,
    priorCheckpoint,
    "the browser worker must pass the canonical checkpoint proof byte-for-byte to Wasm",
  );

  historicalSaveMode = "error";
  const historicalError = await kernel.handleBulk({
    type: "runtime-bulk-finalize-historical-external-save-v2",
    requestId: 6,
    clientEpoch: 1,
    expected: rustIntegratedRuntimeBulkStateV1(identity()),
    stageId: "historical.external.error",
    createdAt: 13,
    proposalTypeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
    proposal: historicalProposal,
    expectedPriorCheckpointBytes: priorCheckpoint,
  });
  assert.equal(historicalError.type, "runtime-bulk-error-v1");
  assert.equal(historicalError.type === "runtime-bulk-error-v1" ? historicalError.code : null, "fixture-historical-rejection");
  assert.equal(historicalError.type === "runtime-bulk-error-v1" ? historicalError.message : null, "fixture exact rejection");

  historicalSaveMode = "missing-attestation";
  await assert.rejects(kernel.handleBulk({
    type: "runtime-bulk-finalize-historical-external-save-v2",
    requestId: 7,
    clientEpoch: 1,
    expected: rustIntegratedRuntimeBulkStateV1(identity()),
    stageId: "historical.external.missing-attestation",
    createdAt: 14,
    proposalTypeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
    proposal: historicalProposal,
    expectedPriorCheckpointBytes: priorCheckpoint,
  }), /historical external runtime operation omitted its attestation attachment/u);
  historicalSaveMode = "success";

  const observation = Uint8Array.of(0x42, 0x57, 0x48, 0x4f, 0x80, 0xff);
  const reconciled = await kernel.handleBulk({
    type: "runtime-bulk-reconcile-historical-external-fallback-v2",
    requestId: 5,
    clientEpoch: 1,
    expected: rustIntegratedRuntimeBulkStateV1(identity()),
    fallbackRecoveryId: "historical-fallback-recovery",
    createdAt: 12,
    observationTypeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_TYPE_V2,
    observation,
  });
  assert.equal(reconciled.type, "runtime-bulk-data-v1");
  assert.equal(reconciliationRequests.length, 1);
  assert.equal(reconciliationRequests[0].request.stageId, "historical-fallback-recovery");
  assert.equal(reconciliationRequests[0].request.createdAt, 12);
  assert.deepEqual(reconciliationRequests[0].observation, observation);
  assert.equal(ordinaryBulkCalls, 0, "native initialization and legacy migration never enter ordinary compatibility finalize");
});
