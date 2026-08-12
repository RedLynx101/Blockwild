import assert from "node:assert/strict";
import test from "node:test";
import type {
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import { createRustIntegratedRuntimeDomainOperationV1 } from "../app/game/rust-integrated-runtime-codec.ts";
import {
  RUST_CONTEXT_COMMAND_CONTINUITY_RECEIPT_TYPE_V2,
  RUST_CONTEXT_COMMAND_CONTINUITY_TYPE_V2,
  decodeRustIntegratedRuntimeContextContinuityQueryV2,
  decodeRustIntegratedRuntimeContextContinuityReceiptV2,
  encodeRustIntegratedRuntimeContextContinuityQueryV2,
  encodeRustIntegratedRuntimeContextContinuityReceiptV2,
  queryRustIntegratedRuntimeContextContinuityV2,
} from "../app/game/rust-integrated-runtime-context-continuity-v2.ts";

const MAX = Number.MAX_SAFE_INTEGER;
const ZERO_HASH = "0".repeat(32);
const BWS6_VECTOR = "42575336010002006d000000a7ca767bd713f3caf8045bb005c23c8502000c000000756e6976657273653ae6b0b40700000073757266616365ffffffffffff1f00feffffffffff1f0003000000000000000400000000000000050000000000000006000000000000000700000000000000fdffffffffff1f00abababababababababababababababab";
const BWO6_VECTOR = "42574f360100020088000000e97f975e578f8aa4d81b3bf9853fa17ecdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd02000c000000756e6976657273653ae6b0b40700000073757266616365ffffffffffff1f00feffffffffff1f0003000000000000000400000000000000050000000000000006000000000000000700000000000000fdffffffffff1f00abababababababababababababababab01ffffffffffff1f000001";

function identity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe:\u6c34",
    locationId: "surface",
    revision: Object.freeze({
      epoch: MAX, world: MAX - 1, entities: 3, gameplay: 4,
      persistence: 5, network: 6, simulation: 7,
    }),
    tick: MAX - 2,
    stateHash: "ab".repeat(16),
  });
}

test("BWS6/BWO6 codecs preserve exact identity and terminal continuity without changing BWO5", () => {
  const expected = identity();
  const query = encodeRustIntegratedRuntimeContextContinuityQueryV2(expected);
  assert.equal(Buffer.from(query).toString("hex"), BWS6_VECTOR);
  assert.equal(Buffer.from(query.subarray(0, 4)).toString("ascii"), "BWS6");
  assert.deepEqual(decodeRustIntegratedRuntimeContextContinuityQueryV2(query), { expected });

  const receipt = Object.freeze({
    requestPayloadHash: "cd".repeat(16),
    identity: expected,
    lastSequence: MAX,
    nextSequence: null,
    queuedCommandsEmpty: true,
  });
  const encoded = encodeRustIntegratedRuntimeContextContinuityReceiptV2(receipt);
  assert.equal(Buffer.from(encoded).toString("hex"), BWO6_VECTOR);
  assert.equal(Buffer.from(encoded.subarray(0, 4)).toString("ascii"), "BWO6");
  assert.deepEqual(decodeRustIntegratedRuntimeContextContinuityReceiptV2(encoded, receipt.requestPayloadHash), receipt);
  assert.throws(
    () => encodeRustIntegratedRuntimeContextContinuityReceiptV2({ ...receipt, lastSequence: MAX - 1 }),
    /discontinuous/u,
  );
  assert.throws(
    () => encodeRustIntegratedRuntimeContextContinuityQueryV2({ ...expected, tick: MAX + 1 }),
    /safe range/u,
  );
});

test("BWS6 query composes one exact identity-neutral command receipt", async () => {
  const expected = identity();
  let calls = 0;
  const service = {
    identity: () => expected,
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      calls += 1;
      assert.deepEqual(batch.expected, expected);
      assert.equal(batch.operations.length, 1);
      const operation = batch.operations[0];
      assert.equal(operation.domain, "simulation");
      assert.equal(operation.typeId, RUST_CONTEXT_COMMAND_CONTINUITY_TYPE_V2);
      assert.equal(operation.schema, 2);
      assert.deepEqual(decodeRustIntegratedRuntimeContextContinuityQueryV2(operation.payload), { expected });
      const payload = encodeRustIntegratedRuntimeContextContinuityReceiptV2({
        requestPayloadHash: operation.payloadHash,
        identity: expected,
        lastSequence: null,
        nextSequence: 1,
        queuedCommandsEmpty: true,
      });
      return Object.freeze({
        status: "accepted" as const,
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        before: expected,
        after: expected,
        domainReceipts: Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
          domain: "simulation",
          typeId: RUST_CONTEXT_COMMAND_CONTINUITY_RECEIPT_TYPE_V2,
          schema: 2,
          payload,
        })]),
        receiptHash: ZERO_HASH,
      });
    },
  };
  const observed = await queryRustIntegratedRuntimeContextContinuityV2(service);
  assert.equal(calls, 1);
  assert.deepEqual(observed.identity, expected);
  assert.equal(observed.lastSequence, null);
  assert.equal(observed.nextSequence, 1);
  assert.equal(observed.queuedCommandsEmpty, true);
  assert.deepEqual(service.identity(), expected);
});
