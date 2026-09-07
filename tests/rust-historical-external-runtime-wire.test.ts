import assert from "node:assert/strict";
import test from "node:test";
import {
  RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
  RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2,
  RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_TYPE_V2,
  RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
  decodeRustIntegratedRuntimeBulkRequestV1,
  decodeRustIntegratedRuntimeBulkResponseV1,
  decodeRustIntegratedRuntimeHistoricalExternalReceiptV2,
  encodeRustIntegratedRuntimeBulkRequestV1,
  encodeRustIntegratedRuntimeBulkResponseV1,
  encodeRustIntegratedRuntimeHistoricalExternalReceiptV2,
  type RustIntegratedRuntimeBulkRequestV1,
  type RustIntegratedRuntimeBulkStateV1,
  type RustIntegratedRuntimeHistoricalExternalReceiptV2,
} from "../app/game/rust-integrated-runtime-bulk-platform.ts";
import { createPersistenceCheckpointV1 } from "../app/game/persistence-journal-contract.ts";
import { encodeRustPersistenceCheckpointWireV1 } from "../app/game/rust-persistence-runtime-contract.ts";

const HASHES = Object.freeze(Array.from({ length: 12 }, (_, index) => index.toString(16).repeat(32)));

function state(): RustIntegratedRuntimeBulkStateV1 {
  return Object.freeze({
    revision: Object.freeze({
      epoch: 1,
      world: 2,
      entities: 3,
      gameplay: 4,
      persistence: 5,
      network: 6,
      simulation: 7,
    }),
    tick: 8,
    stateHash: HASHES[1],
  });
}

function canonicalPriorCheckpointProof() {
  return encodeRustPersistenceCheckpointWireV1(createPersistenceCheckpointV1({
    checkpointId: "historical-prior-checkpoint",
    parentCheckpointId: null,
    worldId: "universe:historical@surface",
    journalSequence: 41,
    generatorHash: HASHES[2],
    contentHash: HASHES[3],
    createdAt: 123,
    records: [],
  }));
}

function receipt(
  operation: RustIntegratedRuntimeHistoricalExternalReceiptV2["operation"] = "initial-migration",
): RustIntegratedRuntimeHistoricalExternalReceiptV2 {
  const recoveryOperation = operation === "recovery" || operation === "reconciliation";
  return Object.freeze({
    operation,
    stageId: recoveryOperation ? null : "historical-stage",
    recoveryId: recoveryOperation ? "historical-recovery" : null,
    createdAt: 123,
    authorityProfile: "typescript-historical-save-compatibility-v1",
    nativePlayer: "off",
    nativeRichState: "not-adopted",
    externalStateFlags: 0x7f,
    descriptorHash: HASHES[2],
    externalDocumentHash: HASHES[3],
    externalDocumentByteLength: 9,
    externalDocumentRevision: operation === "initial-migration" ? 1 : 2,
    externalChunkCount: 2,
    externalChunkSetHash: HASHES[4],
    projectionHash: HASHES[5],
    projectionByteLength: 7,
    nativeWorldSemanticHash: HASHES[5],
    nativeWorldEditCount: 11,
    nativeWorldFacingCount: 3,
    saveSetHash: HASHES[6],
    manifestHash: HASHES[7],
    dispatcherRequestId: operation === "recovery" ? 0 : 19,
    remainingDirtyRecords: recoveryOperation ? 0 : 8,
    reconciliation: operation === "reconciliation" ? Object.freeze({
      observationHash: HASHES[8],
      expectedStorageRevision: 12,
      observedLatestCheckpointId: "corrupt-latest",
      observedLatestCheckpointHash: HASHES[9],
      observedLatestJournalSequence: 41,
      fallbackCheckpointId: "verified-fallback",
      fallbackCheckpointHash: HASHES[10],
      fallbackJournalSequence: 40,
      targetCheckpointId: "reconciled-target",
      targetCheckpointHash: HASHES[11],
      targetJournalSequence: 42,
      planHash: HASHES[0],
    }) : null,
  });
}

test("op 11 and op 12 keep BWHP separate from op 10 and preserve exact attachment boundaries", () => {
  const proposal = Uint8Array.of(0x42, 0x57, 0x48, 0x50, 0x80, 0xff);
  const projection = Uint8Array.of(0x42, 0x57, 0x41, 0x53, 0x00, 0x7f, 0x81);
  const migration = {
    type: "runtime-bulk-migrate-historical-external-v2" as const,
    requestId: 21,
    clientEpoch: 2,
    expected: state(),
    stageId: "historical-stage",
    createdAt: 123,
    proposalTypeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
    proposal,
    worldProjectionTypeId: RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
    worldProjection: projection,
  } satisfies RustIntegratedRuntimeBulkRequestV1;
  const encodedMigration = encodeRustIntegratedRuntimeBulkRequestV1(migration);
  assert.equal(encodedMigration.control[8], 11);
  assert.equal(encodedMigration.copiedInputBytes, proposal.byteLength + projection.byteLength);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkRequestV1(
    encodedMigration.control,
    encodedMigration.attachment,
  ), migration);

  const save = {
    type: "runtime-bulk-finalize-historical-external-save-v2" as const,
    requestId: 22,
    clientEpoch: 2,
    expected: state(),
    stageId: "historical-stage-2",
    createdAt: 124,
    proposalTypeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
    proposal: Uint8Array.from(proposal),
    expectedPriorCheckpointBytes: canonicalPriorCheckpointProof(),
  } satisfies RustIntegratedRuntimeBulkRequestV1;
  const encodedSave = encodeRustIntegratedRuntimeBulkRequestV1(save);
  assert.equal(encodedSave.control[8], 12);
  assert.equal(encodedSave.copiedInputBytes, save.proposal.byteLength + save.expectedPriorCheckpointBytes.byteLength);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkRequestV1(encodedSave.control, encodedSave.attachment), save);
  assert.throws(
    () => encodeRustIntegratedRuntimeBulkRequestV1({
      ...save,
      expectedPriorCheckpointBytes: new Uint8Array(),
    }),
    /prior checkpoint|checkpoint proof|outside/u,
    "op 12 must not serialize a successor request without an exact prior checkpoint proof",
  );
});

test("op 13 is a detached-attachment-free historical recovery request", () => {
  const request = {
    type: "runtime-bulk-hydrate-historical-external-v2" as const,
    requestId: 23,
    clientEpoch: 2,
    expected: state(),
    recoveryId: "historical-recovery",
  };
  const encoded = encodeRustIntegratedRuntimeBulkRequestV1(request);
  assert.equal(encoded.control[8], 13);
  assert.equal(encoded.attachment.byteLength, 0);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkRequestV1(encoded.control, encoded.attachment), request);
  assert.throws(
    () => decodeRustIntegratedRuntimeBulkRequestV1(encoded.control, Uint8Array.of(1)),
    /checksum|length|cannot carry an attachment/u,
  );
});

test("op 14 carries one exact BWHO observation without entering op 10-13", () => {
  const observation = Uint8Array.of(0x42, 0x57, 0x48, 0x4f, 0x00, 0x80, 0xff);
  const request = {
    type: "runtime-bulk-reconcile-historical-external-fallback-v2" as const,
    requestId: 24,
    clientEpoch: 2,
    expected: state(),
    fallbackRecoveryId: "historical-recovery",
    createdAt: 123,
    observationTypeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_TYPE_V2,
    observation,
  } satisfies RustIntegratedRuntimeBulkRequestV1;
  const encoded = encodeRustIntegratedRuntimeBulkRequestV1(request);
  assert.equal(encoded.control[8], 14);
  assert.equal(encoded.copiedInputBytes, 0);
  assert.strictEqual(encoded.attachment, observation);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkRequestV1(encoded.control, encoded.attachment), request);
  assert.throws(
    () => decodeRustIntegratedRuntimeBulkRequestV1(encoded.control, new Uint8Array()),
    /checksum|length|outside/u,
  );
});

test("BWHR V2 exposes exact external/native pairing while rejecting authority drift", () => {
  for (const operation of ["initial-migration", "external-save", "recovery", "reconciliation"] as const) {
    const expected = receipt(operation);
    const encoded = encodeRustIntegratedRuntimeHistoricalExternalReceiptV2(expected);
    assert.equal(new TextDecoder().decode(encoded.subarray(0, 4)), "BWHR");
    assert.deepEqual(decodeRustIntegratedRuntimeHistoricalExternalReceiptV2(encoded), expected);
  }

  const adoptionDrift = encodeRustIntegratedRuntimeHistoricalExternalReceiptV2(receipt());
  adoptionDrift[8] = 1;
  assert.throws(
    () => decodeRustIntegratedRuntimeHistoricalExternalReceiptV2(adoptionDrift),
    /unsupported profile or native authority/u,
  );
  assert.throws(
    () => encodeRustIntegratedRuntimeHistoricalExternalReceiptV2({
      ...receipt(),
      nativePlayer: "on" as "off",
    }),
    /unsupported native authority/u,
  );
});

test("historical attestation uses the existing detached data response without masquerading as hydration bytes", () => {
  const payload = encodeRustIntegratedRuntimeHistoricalExternalReceiptV2(receipt("external-save"));
  const response = Object.freeze({
    type: "runtime-bulk-data-v1" as const,
    requestId: 24,
    clientEpoch: 2,
    workerEpoch: 1,
    current: state(),
    transferToken: 9,
    typeId: RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2,
    chunkIndex: 0,
    chunkCount: 1,
    payload,
  });
  const encoded = encodeRustIntegratedRuntimeBulkResponseV1(response);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkResponseV1(encoded.control, encoded.attachment), response);

  const malformed = Uint8Array.from(payload);
  malformed[0] ^= 0xff;
  assert.throws(() => encodeRustIntegratedRuntimeBulkResponseV1({ ...response, payload: malformed }), /magic/u);
});
