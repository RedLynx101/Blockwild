import assert from "node:assert/strict";
import test from "node:test";
import { RustIntegratedRuntimeBrowserKernelV1 } from "../app/game/rust-integrated-runtime-browser-worker.ts";
import {
  decodeRustIntegratedRuntimeBulkRequestV1,
  encodeRustIntegratedRuntimeBulkResponseV1,
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
  let ordinaryBulkCalls = 0;
  let recoveryCommandCalls = 0;
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
    blockwild_runtime_bulk_v2: () => { ordinaryBulkCalls += 1; return new Uint8Array(); },
    blockwild_runtime_bulk_take_attachment_v2: () => new Uint8Array(),
    blockwild_runtime_destroy_v2: () => new Uint8Array(),
  };
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
  assert.equal(ordinaryBulkCalls, 0, "native initialization never enters the compatibility finalize entrypoint");
});
