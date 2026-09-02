import assert from "node:assert/strict";
import test from "node:test";
import type {
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeCommandReceiptV1,
  RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import {
  RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1,
  decodeRustIntegratedRuntimeBasicDirtActionQueryV1,
  encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1,
  encodeRustIntegratedRuntimeBasicDirtActionQueryV1,
  queryRustIntegratedRuntimeBasicDirtActionReceiptV1,
  rustIntegratedRuntimeBasicDirtActionReceiptHashV1,
  rustIntegratedRuntimeBasicDirtContentSubsetHashV1,
  rustIntegratedRuntimeBasicDirtExpectedDropTransformV1,
  type RustIntegratedRuntimeBasicDirtActionContentBindingV1,
  type RustIntegratedRuntimeBasicDirtActionProjectionV1,
} from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";

function hash(value: number) { return value.toString(16).padStart(32, "0").slice(-32); }

function identity(tick = 8, state = 1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe-dirt-receipt",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1, world: 3, entities: 4, gameplay: 5, persistence: 6, network: 7, simulation: tick,
    }),
    tick,
    stateHash: hash(state),
  });
}

function content(): RustIntegratedRuntimeBasicDirtActionContentBindingV1 {
  const base = Object.freeze({
    manifestHash: hash(11),
    installedRegistryHash: hash(12),
    catalogSchemaVersion: 2,
    catalogContentVersion: 9,
    catalogBlobHash: hash(13),
    actionReportHash: hash(14),
    subsetHash: hash(15),
  });
  return Object.freeze({ ...base, subsetHash: rustIntegratedRuntimeBasicDirtContentSubsetHashV1(base) });
}

function projection(sequence = 1): RustIntegratedRuntimeBasicDirtActionProjectionV1 {
  const binding = content();
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: binding.manifestHash,
    installedRegistryHash: binding.installedRegistryHash,
    catalogBlobHash: binding.catalogBlobHash,
    actionReportHash: binding.actionReportHash,
    rngSemanticsHash: hash(16),
    blockActionSequence: (BigInt(1) << BigInt(63)) + BigInt(4),
    originInputSequence: 7,
    blockId: 2,
    position: Object.freeze({ x: 4, y: 43, z: -3 }),
    lootPlanHash: hash(17),
    groupOrdinal: 0,
  });
  const transform = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(provenance);
  const base = Object.freeze({
    schema: 1 as const,
    sequence,
    originInputSequence: 7,
    completionTick: 8,
    action: "mine" as const,
    position: provenance.position,
    priorBlockId: 2,
    replacementBlockId: 0,
    beforeWorldRevision: Object.freeze({ epoch: 1, mutation: 2, residency: 3 }),
    afterWorldRevision: Object.freeze({ epoch: 1, mutation: 3, residency: 3 }),
    beforeWorldHash: hash(18),
    afterWorldHash: hash(19),
    creativeMode: false,
    inventory: Object.freeze({
      container: Object.freeze({ kind: "player" as const, id: "actor:test", ownerId: "actor:test" }),
      slot: 0,
      beforeRevision: BigInt(4),
      afterRevision: BigInt(4),
      beforeStack: null,
      afterStack: null,
    }),
    generatedDrops: Object.freeze([Object.freeze({
      provenance,
      entityId: BigInt("4294967297"),
      stack: Object.freeze({ itemCode: 2, count: 1, durabilityMillionths: null, metadataHash: hash(0) }),
      ...transform,
    })]),
    content: binding,
    receiptHash: hash(20),
  });
  return Object.freeze({ ...base, receiptHash: rustIntegratedRuntimeBasicDirtActionReceiptHashV1(base) });
}

function outerReceiptHash(receipt: Omit<Extract<RustIntegratedRuntimeCommandReceiptV1, { status: "accepted" }>, "receiptHash">) {
  const bytes = [
    ...Buffer.from(receipt.commandHash, "hex"),
    ...Buffer.from(receipt.before.stateHash, "hex"),
    ...Buffer.from(receipt.after.stateHash, "hex"),
    ...receipt.domainReceipts.flatMap((operation) => [...Buffer.from(operation.payloadHash, "hex")]),
  ];
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes));
}

test("BWQ7/BWR7 round-trip every rich generated-drop field and canonical hash", () => {
  const expected = identity();
  const query = encodeRustIntegratedRuntimeBasicDirtActionQueryV1({ expected, afterSequence: 0 });
  assert.equal(Buffer.from(query.subarray(0, 4)).toString("ascii"), "BWQ7");
  assert.deepEqual(decodeRustIntegratedRuntimeBasicDirtActionQueryV1(query), { expected, afterSequence: 0 });

  const receipt = Object.freeze({
    requestPayloadHash: hash(31),
    identity: expected,
    cursorAfter: 1,
    receipt: projection(),
  });
  const packet = encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1(receipt, 0);
  assert.equal(Buffer.from(packet.subarray(0, 4)).toString("ascii"), "BWR7");
  assert.deepEqual(
    decodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1(packet, receipt.requestPayloadHash, 0),
    receipt,
  );
});

test("BWR7 rejects gaps, canonical receipt corruption, and out-of-bounds drop transforms", () => {
  const expected = identity();
  assert.throws(() => encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1({
    requestPayloadHash: hash(31), identity: expected, cursorAfter: 2, receipt: projection(2),
  }, 0), /gapped|out of order/u);

  const valid = projection();
  assert.throws(() => encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1({
    requestPayloadHash: hash(31), identity: expected, cursorAfter: 1,
    receipt: Object.freeze({ ...valid, receiptHash: hash(99) }),
  }, 0), /canonical fields/u);

  const drop = valid.generatedDrops[0]!;
  assert.throws(() => encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1({
    requestPayloadHash: hash(31), identity: expected, cursorAfter: 1,
    receipt: Object.freeze({
      ...valid,
      generatedDrops: Object.freeze([Object.freeze({
        ...drop,
        position: Object.freeze({ ...drop.position, xMilli: BigInt(33_554_432_001) }),
      })]),
    }),
  }, 0), /fixed-point bound/u);
});

test("legacy max-safe BWQ7 seeds only the latest cursor and can never replay", () => {
  const expected = identity();
  const seeded = Object.freeze({
    requestPayloadHash: hash(31), identity: expected, cursorAfter: 12, receipt: null,
  });
  const packet = encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1(
    seeded,
    RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1,
  );
  assert.deepEqual(decodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1(
    packet,
    seeded.requestPayloadHash,
    RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1,
  ), seeded);
  assert.throws(() => encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1({
    ...seeded, cursorAfter: 1, receipt: projection(),
  }, RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1), /seed-only/u);
});

test("read-only gameplay BWRQ binds request, identity, cursor, and all wire hashes", async () => {
  const expected = identity();
  let current = expected;
  let calls = 0;
  const service = {
    identity: () => current,
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      calls += 1;
      assert.deepEqual(batch.expected, expected);
      const operation = batch.operations[0]!;
      assert.equal(operation.domain, "gameplay");
      assert.equal(operation.typeId, RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1);
      assert.deepEqual(decodeRustIntegratedRuntimeBasicDirtActionQueryV1(operation.payload), {
        expected, afterSequence: 0,
      });
      const payload = encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1({
        requestPayloadHash: operation.payloadHash,
        identity: expected,
        cursorAfter: 1,
        receipt: projection(),
      }, 0);
      const accepted = {
        status: "accepted" as const,
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        before: expected,
        after: expected,
        domainReceipts: Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
          domain: "gameplay",
          typeId: RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1,
          schema: 1,
          payload,
        })]),
      };
      return Object.freeze({ ...accepted, receiptHash: outerReceiptHash(accepted) });
    },
  };
  const observed = await queryRustIntegratedRuntimeBasicDirtActionReceiptV1(service, 0);
  assert.equal(calls, 1);
  assert.deepEqual(current, expected);
  assert.equal(observed.receipt?.receiptHash, projection().receiptHash);
  assert.equal(observed.cursorAfter, 1);
  assert.match(observed.projectionPayloadHash, /^[0-9a-f]{32}$/u);

  current = expected;
  const driftingService = {
    identity: () => current,
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      const receipt = await service.command(batch);
      current = identity(8, 2);
      return receipt;
    },
  };
  await assert.rejects(
    queryRustIntegratedRuntimeBasicDirtActionReceiptV1(driftingService, 0),
    /identity|receipt/u,
  );
});
