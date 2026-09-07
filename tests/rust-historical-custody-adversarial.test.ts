import assert from "node:assert/strict";
import test from "node:test";
import {
  RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PRIOR_CHECKPOINT_MAX_BYTES_V2,
  RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_MAX_BYTES_V2,
  RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
  RustIntegratedRuntimeBulkCodecError,
  decodeRustIntegratedRuntimeBulkRequestV1,
  encodeRustIntegratedRuntimeBulkRequestV1,
  type RustIntegratedRuntimeBulkRequestV1,
  type RustIntegratedRuntimeBulkStateV1,
} from "../app/game/rust-integrated-runtime-bulk-platform.ts";
import {
  RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
  type RustIntegratedRuntimeConfigV1,
  type RustIntegratedRuntimeIdentityV1,
  type RustIntegratedRuntimeRequestV1,
  type RustIntegratedRuntimeResponseV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RustIntegratedRuntimeServiceError,
  RustIntegratedRuntimeServiceV1,
} from "../app/game/rust-integrated-runtime-service.ts";

const HASH = "a".repeat(32);

function identity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "1",
    locationId: "surface",
    revision: Object.freeze({ epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5, network: 6, simulation: 7 }),
    tick: 8,
    stateHash: HASH,
  });
}

function state(): RustIntegratedRuntimeBulkStateV1 {
  return Object.freeze({ revision: identity().revision, tick: 8, stateHash: HASH });
}

function config(): RustIntegratedRuntimeConfigV1 {
  return Object.freeze({
    worldSeed: "historical-custody",
    universeId: "1",
    locationId: "surface",
    sessionId: "custody-test",
    contentHash: HASH,
    generatorHash: HASH,
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
    waterBlockId: 7,
    directionalBlockIds: Object.freeze([]),
    waterloggedBlockIds: Object.freeze([]),
  });
}

function saveRequest(proposal: Uint8Array, expectedPriorCheckpointBytes: Uint8Array): RustIntegratedRuntimeBulkRequestV1 {
  return Object.freeze({
    type: "runtime-bulk-finalize-historical-external-save-v2",
    requestId: 7,
    clientEpoch: 2,
    expected: state(),
    stageId: "historical-stage",
    createdAt: 9,
    proposalTypeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
    proposal,
    expectedPriorCheckpointBytes,
  });
}

test("op12 joins two exact bounded inputs and rejects an attachment truncated after control authentication", () => {
  const proposal = new Uint8Array(RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_MAX_BYTES_V2);
  const prior = new Uint8Array(RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PRIOR_CHECKPOINT_MAX_BYTES_V2);
  proposal[0] = 0x42;
  prior[prior.length - 1] = 0xff;
  const request = saveRequest(proposal, prior);
  const encoded = encodeRustIntegratedRuntimeBulkRequestV1(request);

  assert.equal(encoded.control[8], 12);
  assert.equal(encoded.attachment.byteLength, proposal.byteLength + prior.byteLength);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkRequestV1(encoded.control, encoded.attachment), request);
  assert.throws(
    () => decodeRustIntegratedRuntimeBulkRequestV1(encoded.control, encoded.attachment.subarray(0, -1)),
    RustIntegratedRuntimeBulkCodecError,
    "the attachment checksum must reject a proof truncated after the control envelope was emitted",
  );
});

test("op12 missing, empty, or over-budget prior proofs stop at the service boundary before Wasm", async () => {
  const normalRequests: RustIntegratedRuntimeRequestV1[] = [];
  const bulkRequests: RustIntegratedRuntimeBulkRequestV1[] = [];
  const service = new RustIntegratedRuntimeServiceV1({
    mode: "protocol-test",
    transportFactory: () => ({
      async request(request: RustIntegratedRuntimeRequestV1): Promise<RustIntegratedRuntimeResponseV1> {
        normalRequests.push(request);
        return Object.freeze({
          type: "runtime-ready-v1",
          requestId: request.requestId,
          clientEpoch: request.clientEpoch,
          workerEpoch: 3,
          runtimeHandle: 1,
          identity: identity(),
          artifactHash: "custody",
          instanceId: "custody",
          capabilities: ["awaited-receipts-v1", "bulk-platform-v1", "historical-external-save-v2", "integrated-runtime-v1", "native-save-hydration-v1"],
        });
      },
      async requestBulk(request: RustIntegratedRuntimeBulkRequestV1): Promise<never> {
        bulkRequests.push(request);
        throw new Error("invalid op12 proof must not reach Wasm");
      },
      bulkDiagnostics: () => Object.freeze({ pending: 0, queuedBytes: 0, peakQueuedBytes: 0, requests: 0, routineRequests: 0, recoveryScaleRequests: 0, backpressureRejects: 0, copiedInputBytes: 0, transferredInputBytes: 0, transferredOutputBytes: 0 }),
      dispose() {},
    }),
  });
  await service.start(config());
  const proposal = Uint8Array.of(0x42);
  const invalidProofs = [
    undefined as unknown as Uint8Array,
    new Uint8Array(),
    new Uint8Array(RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PRIOR_CHECKPOINT_MAX_BYTES_V2 + 1),
  ];

  for (const proof of invalidProofs) {
    await assert.rejects(
      service.finalizeHistoricalExternalSaveV2("historical-stage", 9, proposal, proof),
      (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "historical-checkpoint-proof",
    );
  }
  assert.equal(normalRequests.length, 1, "only startup may enter the transport");
  assert.equal(bulkRequests.length, 0, "missing, empty, and oversize proofs must fail before Wasm");
});
