import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { rustIntegratedRuntimeBasicDirtExpectedDropTransformV1 } from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V2,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1,
  decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2,
  decodeRustIntegratedRuntimeNativeBlockEditQueryV1,
  decodeRustIntegratedRuntimeNativeBlockEditQueryV2,
  encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1,
  encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2,
  encodeRustIntegratedRuntimeNativeBlockEditQueryV1,
  encodeRustIntegratedRuntimeNativeBlockEditQueryV2,
  queryRustIntegratedRuntimeNativeBlockEditReceiptV1,
  queryRustIntegratedRuntimeNativeBlockEditReceiptV2,
  rustIntegratedRuntimeNativeBlockEditContentSubsetHashV1,
  rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2,
  rustIntegratedRuntimeNativeBlockEditReceiptHashV1,
  type RustIntegratedRuntimeNativeBlockEditContentBindingV1,
  type RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2,
  type RustIntegratedRuntimeNativeBlockEditReceiptV1,
} from "../app/game/rust-integrated-runtime-native-block-edit.ts";

function repeatedHash(byte: number) {
  return byte.toString(16).padStart(2, "0").repeat(16);
}

function identity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe:native-block-edit",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1,
      world: 9,
      entities: 10,
      gameplay: 11,
      persistence: 12,
      network: 13,
      simulation: 14,
    }),
    tick: 81,
    stateHash: repeatedHash(0x61),
  });
}

function content(blockId = 1): RustIntegratedRuntimeNativeBlockEditContentBindingV1 {
  const base = Object.freeze({
    blockId,
    manifestHash: repeatedHash(0x21),
    installedRegistryHash: repeatedHash(0x22),
    catalogSchemaVersion: 2,
    catalogContentVersion: 9,
    catalogBlobHash: repeatedHash(0x23),
    actionReportHash: repeatedHash(0x24),
    subsetHash: repeatedHash(0),
  });
  return Object.freeze({
    ...base,
    subsetHash: rustIntegratedRuntimeNativeBlockEditContentSubsetHashV1(base),
  });
}

function receipt(): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  const binding = content();
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: binding.manifestHash,
    installedRegistryHash: binding.installedRegistryHash,
    catalogBlobHash: binding.catalogBlobHash,
    actionReportHash: binding.actionReportHash,
    rngSemanticsHash: repeatedHash(0x25),
    blockActionSequence: (BigInt(1) << BigInt(64)) - BigInt(4),
    originInputSequence: 41,
    blockId: 1,
    position: Object.freeze({ x: -4, y: 50, z: 7 }),
    lootPlanHash: repeatedHash(0x26),
    groupOrdinal: 2,
  });
  const transform = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(provenance);
  const base = Object.freeze({
    schema: 1 as const,
    sequence: 5,
    originInputSequence: 41,
    completionTick: 81,
    action: "mine" as const,
    position: provenance.position,
    priorBlockId: 1,
    priorFacing: 0,
    replacementBlockId: 1,
    replacementFacing: 0,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 17, residency: 4 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 17, residency: 4 }),
    beforeWorldHash: repeatedHash(0x31),
    afterWorldHash: repeatedHash(0x31),
    creativeMode: false,
    inventory: Object.freeze({
      container: Object.freeze({
        kind: "player" as const,
        id: "actor:native-block-edit",
        ownerId: "actor:native-block-edit",
      }),
      selectedSlot: 2,
      beforeRevision: BigInt(4),
      afterRevision: BigInt(5),
      beforeStack: Object.freeze({
        itemCode: 91,
        count: 1,
        durabilityMillionths: 750_000,
        metadataHash: repeatedHash(0x41),
      }),
      afterStack: Object.freeze({
        itemCode: 91,
        count: 1,
        durabilityMillionths: 650_000,
        metadataHash: repeatedHash(0x41),
      }),
    }),
    generatedDrops: Object.freeze([Object.freeze({
      provenance,
      entityId: (BigInt(3) << BigInt(32)) | BigInt(7),
      stack: Object.freeze({
        itemCode: 1,
        count: 3,
        durabilityMillionths: null,
        metadataHash: repeatedHash(0x52),
      }),
      ...transform,
    })]),
    content: binding,
    receiptHash: repeatedHash(0),
  });
  return Object.freeze({
    ...base,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(base),
  });
}

function rehash(value: RustIntegratedRuntimeNativeBlockEditReceiptV1) {
  return Object.freeze({
    ...value,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(value),
  });
}

function mutatingReceipt(): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  const base = Object.freeze({
    schema: 1 as const,
    sequence: 5,
    originInputSequence: 41,
    completionTick: 81,
    action: "place" as const,
    position: Object.freeze({ x: 0, y: -64, z: 0 }),
    priorBlockId: 0,
    priorFacing: 0,
    replacementBlockId: 2,
    replacementFacing: 0,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 17, residency: 4 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 18, residency: 4 }),
    beforeWorldHash: repeatedHash(0x31),
    afterWorldHash: repeatedHash(0x32),
    creativeMode: false,
    inventory: Object.freeze({
      container: Object.freeze({
        kind: "player" as const,
        id: "actor:native-block-edit",
        ownerId: "actor:native-block-edit",
      }),
      selectedSlot: 2,
      beforeRevision: BigInt(4),
      afterRevision: BigInt(5),
      beforeStack: Object.freeze({
        itemCode: 2,
        count: 2,
        durabilityMillionths: null,
        metadataHash: repeatedHash(0x41),
      }),
      afterStack: Object.freeze({
        itemCode: 2,
        count: 1,
        durabilityMillionths: null,
        metadataHash: repeatedHash(0x41),
      }),
    }),
    generatedDrops: Object.freeze([]),
    content: content(2),
    receiptHash: repeatedHash(0),
  });
  return Object.freeze({
    ...base,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(base),
  });
}

function sealDirtyEvidence(
  value: Omit<RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2, "evidenceHash">,
) {
  const pending = Object.freeze({ ...value, evidenceHash: repeatedHash(0xff) });
  return Object.freeze({
    ...pending,
    evidenceHash: rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2(pending),
  });
}

function mutatingDirtyEvidence(
  native = mutatingReceipt(),
): RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2 {
  return sealDirtyEvidence({
    schema: 1,
    sequence: native.sequence,
    receiptHash: native.receiptHash,
    sections: Object.freeze([
      Object.freeze({
        universeId: identity().universeId,
        locationId: identity().locationId,
        chunkX: -1,
        chunkZ: 0,
        sectionY: 0,
      }),
      Object.freeze({
        universeId: identity().universeId,
        locationId: identity().locationId,
        chunkX: 0,
        chunkZ: -1,
        sectionY: 0,
      }),
      Object.freeze({
        universeId: identity().universeId,
        locationId: identity().locationId,
        chunkX: 0,
        chunkZ: 0,
        sectionY: 0,
      }),
    ]),
    columns: Object.freeze([Object.freeze({ x: 0, z: 0 })]),
    subsystemSeeds: Object.freeze(RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2
      .map((subsystem, index) => Object.freeze({ subsystem, seed: repeatedHash(0x61 + index) }))),
  });
}

function noOpDirtyEvidence(native = receipt()): RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2 {
  return sealDirtyEvidence({
    schema: 1,
    sequence: native.sequence,
    receiptHash: native.receiptHash,
    sections: Object.freeze([]),
    columns: Object.freeze([]),
    subsystemSeeds: Object.freeze([]),
  });
}

function outerReceiptHash(
  value: Omit<Extract<RustIntegratedRuntimeCommandReceiptV1, { status: "accepted" }>, "receiptHash">,
) {
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
    ...Buffer.from(value.commandHash, "hex"),
    ...Buffer.from(value.before.stateHash, "hex"),
    ...Buffer.from(value.after.stateHash, "hex"),
    ...value.domainReceipts.flatMap((operation) => [...Buffer.from(operation.payloadHash, "hex")]),
  ]));
}

const RUST_BWY7_FIXTURE = "4257593701000100e30200009d1edbac88f31924c80110481d3eebdd5151515151515151515151515151515102001a000000756e6976657273653a6e61746976652d626c6f636b2d656469740700000073757266616365010000000000000009000000000000000a000000000000000b000000000000000c000000000000000d000000000000000e00000000000000510000000000000061616161616161616161616161616161050000000000000001010005000000000000002900000000000000510000000000000000fcffffff320000000700000001000001000002000000000000001100000000000000040000000000000002000000000000001100000000000000040000000000000031313131313131313131313131313131313131313131313131313131313131310000170000006163746f723a6e61746976652d626c6f636b2d6564697401170000006163746f723a6e61746976652d626c6f636b2d65646974020004000000000000000500000000000000015b0000000100000001b0710b0041414141414141414141414141414141015b000000010000000110eb0900414141414141414141414141414141410100000001002121212121212121212121212121212122222222222222222222222222222222232323232323232323232323232323232424242424242424242424242424242425252525252525252525252525252525fcffffffffffffff29000000000000000100fcffffff3200000007000000262626262626262626262626262626260200070000000300000001000000030000000052525252525252525252525252525252f2efffffffffffffaec4000000000000b51a0000000000002601000000000000a5050000000000008e0100000000000058da0300000000000000000001002121212121212121212121212121212122222222222222222222222222222222020009000000232323232323232323232323232323232424242424242424242424242424242434801cfb2c1dab8b4024eb5c798854bd77d4ba00a5971d9cd0de7d2da36349b8";
const RUST_BWY8_EMPTY_DIRTY_EVIDENCE_HASH = "5ae8a3383df4d3fcc83a571e907d2503";
const RUST_BWY8_EMPTY_DIRTY_FIXTURE_BYTES = 822;
const RUST_BWY8_EMPTY_DIRTY_FIXTURE_SHA256 = "2fa298da45d68c11bba615fb479990925fd58ddb9b70bec93cd491defe68af7a";

test("BWZ7/BWY7 exactly match Rust bytes and preserve full generated evidence", () => {
  const expected = identity();
  const query = encodeRustIntegratedRuntimeNativeBlockEditQueryV1({ expected, afterSequence: 4 });
  assert.equal(Buffer.from(query.subarray(0, 4)).toString("ascii"), "BWZ7");
  assert.deepEqual(decodeRustIntegratedRuntimeNativeBlockEditQueryV1(query), {
    expected,
    afterSequence: 4,
  });

  const native = receipt();
  assert.equal(native.receiptHash, "77d4ba00a5971d9cd0de7d2da36349b8");
  const projection = Object.freeze({
    requestPayloadHash: repeatedHash(0x51),
    identity: expected,
    cursorAfter: 5,
    receipt: native,
  });
  const packet = encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(projection, 4);
  assert.equal(Buffer.from(packet).toString("hex"), RUST_BWY7_FIXTURE);
  assert.deepEqual(
    decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(
      Uint8Array.from(Buffer.from(RUST_BWY7_FIXTURE, "hex")),
      projection.requestPayloadHash,
      4,
    ),
    projection,
  );
});

test("BWZ8/BWY8 preserve the complete V1 receipt and exact Rust dirty evidence", () => {
  const expected = identity();
  const query = encodeRustIntegratedRuntimeNativeBlockEditQueryV2({ expected, afterSequence: 4 });
  assert.equal(Buffer.from(query.subarray(0, 4)).toString("ascii"), "BWZ8");
  assert.deepEqual(decodeRustIntegratedRuntimeNativeBlockEditQueryV2(query), {
    expected,
    afterSequence: 4,
  });

  const native = mutatingReceipt();
  const dirtyEvidence = mutatingDirtyEvidence(native);
  const projection = Object.freeze({
    requestPayloadHash: repeatedHash(0x51),
    identity: expected,
    cursorAfter: 5,
    receipt: native,
    dirtyEvidence,
  });
  const packet = encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(projection, 4);
  assert.equal(Buffer.from(packet.subarray(0, 4)).toString("ascii"), "BWY8");
  assert.deepEqual(
    decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(
      packet,
      projection.requestPayloadHash,
      4,
    ),
    projection,
  );
  assert.equal(dirtyEvidence.sequence, native.sequence);
  assert.equal(dirtyEvidence.receiptHash, native.receiptHash);
  assert.deepEqual(dirtyEvidence.subsystemSeeds.map((entry) => entry.subsystem), [
    "lighting", "liquids", "topology", "meshing", "navigation", "maps", "persistence",
  ]);

  const noOp = receipt();
  const noOpProjection = Object.freeze({ ...projection, receipt: noOp, dirtyEvidence: noOpDirtyEvidence(noOp) });
  const noOpPacket = encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(noOpProjection, 4);
  assert.equal(noOpProjection.dirtyEvidence.evidenceHash, RUST_BWY8_EMPTY_DIRTY_EVIDENCE_HASH);
  assert.equal(noOpPacket.byteLength, RUST_BWY8_EMPTY_DIRTY_FIXTURE_BYTES);
  assert.equal(
    createHash("sha256").update(noOpPacket).digest("hex"),
    RUST_BWY8_EMPTY_DIRTY_FIXTURE_SHA256,
  );
  assert.deepEqual(
    decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(
      noOpPacket,
      projection.requestPayloadHash,
      4,
    ),
    noOpProjection,
  );
});

test("BWY8 dirty evidence fails closed on ancestry, order, duplicates, address, subsystem, and hash tamper", () => {
  const native = mutatingReceipt();
  const dirty = mutatingDirtyEvidence(native);
  const projection = {
    requestPayloadHash: repeatedHash(0x51),
    identity: identity(),
    cursorAfter: native.sequence,
    receipt: native,
    dirtyEvidence: dirty,
  } as const;
  const encodeDirty = (next: RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2) =>
    encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2({ ...projection, dirtyEvidence: next }, 4);

  assert.throws(() => encodeDirty(sealDirtyEvidence({
    ...dirty,
    sequence: dirty.sequence + 1,
  })), /ancestry/u);
  assert.throws(() => encodeDirty(sealDirtyEvidence({
    ...dirty,
    sections: Object.freeze([...dirty.sections].reverse()),
  })), /sections|address/u);
  assert.throws(() => encodeDirty(sealDirtyEvidence({
    ...dirty,
    sections: Object.freeze([dirty.sections[0]!, dirty.sections[0]!, dirty.sections[2]!]),
  })), /address|sections/u);
  assert.throws(() => encodeDirty(sealDirtyEvidence({
    ...dirty,
    sections: Object.freeze([
      Object.freeze({ ...dirty.sections[0]!, universeId: "other" }),
      ...dirty.sections.slice(1),
    ]),
  })), /address/u);
  assert.throws(() => encodeDirty(sealDirtyEvidence({
    ...dirty,
    columns: Object.freeze([Object.freeze({ x: 1, z: 0 })]),
  })), /column/u);
  assert.throws(() => encodeDirty(sealDirtyEvidence({
    ...dirty,
    subsystemSeeds: Object.freeze([
      dirty.subsystemSeeds[0]!, dirty.subsystemSeeds[0]!, ...dirty.subsystemSeeds.slice(2),
    ]),
  })), /subsystem/u);
  assert.throws(() => encodeDirty(Object.freeze({
    ...dirty,
    evidenceHash: repeatedHash(0xee),
  })), /canonical fields/u);

  const noOp = receipt();
  assert.throws(() => encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2({
    ...projection,
    receipt: noOp,
    dirtyEvidence: sealDirtyEvidence({
      schema: 1,
      sequence: noOp.sequence,
      receiptHash: noOp.receiptHash,
      sections: dirty.sections,
      columns: dirty.columns,
      subsystemSeeds: dirty.subsystemSeeds,
    }),
  }, 4), /no-op/u);

  const packet = encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(projection, 4);
  const tampered = Uint8Array.from(packet);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(
    () => decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(tampered),
    /checksum/u,
  );
});

test("BWY7 fails closed on gaps, facing, world aliases, creative mutation, and tamper", () => {
  const native = receipt();
  const projection = {
    requestPayloadHash: repeatedHash(0x51),
    identity: identity(),
    cursorAfter: 5,
    receipt: native,
  } as const;
  assert.throws(
    () => encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(projection, 3),
    /gapped|out of order/u,
  );
  assert.throws(() => encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1({
    ...projection,
    receipt: Object.freeze({ ...native, receiptHash: repeatedHash(0xee) }),
  }, 4), /canonical fields/u);

  const badFacing = rehash(Object.freeze({ ...native, priorFacing: 4 }));
  assert.throws(() => encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1({
    ...projection,
    receipt: badFacing,
  }, 4), /facing/u);
  const nonDirectionalFacing = rehash(Object.freeze({ ...native, replacementFacing: 1 }));
  assert.throws(() => encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1({
    ...projection,
    receipt: nonDirectionalFacing,
  }, 4), /canonical block catalog/u);

  const aliasedMutation = rehash(Object.freeze({
    ...native,
    afterWorldRevision: Object.freeze({ ...native.afterWorldRevision, mutation: 18 }),
  }));
  assert.throws(() => encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1({
    ...projection,
    receipt: aliasedMutation,
  }, 4), /mutation|harvest/u);

  const creativeMutation = rehash(Object.freeze({ ...native, creativeMode: true }));
  assert.throws(() => encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1({
    ...projection,
    receipt: creativeMutation,
  }, 4), /creative edit/u);

  const tampered = Uint8Array.from(Buffer.from(RUST_BWY7_FIXTURE, "hex"));
  tampered[tampered.length - 1] ^= 1;
  assert.throws(
    () => decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(tampered),
    /checksum/u,
  );
  assert.throws(
    () => decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(
      Uint8Array.from(Buffer.from(RUST_BWY7_FIXTURE, "hex")),
      repeatedHash(0x99),
      4,
    ),
    /exact BWZ7 payload/u,
  );
});

test("max-safe native block edit seed returns only the durable latest cursor", () => {
  const seeded = Object.freeze({
    requestPayloadHash: repeatedHash(0x71),
    identity: identity(),
    cursorAfter: 12,
    receipt: null,
  });
  const packet = encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(
    seeded,
    RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1,
  );
  assert.deepEqual(
    decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(
      packet,
      seeded.requestPayloadHash,
      RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1,
    ),
    seeded,
  );
});

test("BWY8 distinguishes an explicit pre-V14 receipt fallback and writes an empty sentinel with two flags", () => {
  const legacy = Object.freeze({
    requestPayloadHash: repeatedHash(0x71),
    identity: identity(),
    cursorAfter: 5,
    receipt: receipt(),
    dirtyEvidence: null,
  });
  assert.deepEqual(
    decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(
      encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(legacy, 4),
      legacy.requestPayloadHash,
      4,
    ),
    legacy,
  );

  const seeded = Object.freeze({
    requestPayloadHash: repeatedHash(0x72),
    identity: identity(),
    cursorAfter: 12,
    receipt: null,
    dirtyEvidence: null,
  });
  const packet = encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(
    seeded,
    RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1,
  );
  assert.deepEqual([...packet.slice(-2)], [0, 0]);
  assert.deepEqual(
    decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(
      packet,
      seeded.requestPayloadHash,
      RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1,
    ),
    seeded,
  );
});

test("native block edit BWRQ query is read-only and binds every outer and inner hash", async () => {
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
      assert.equal(operation.typeId, RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1);
      assert.deepEqual(decodeRustIntegratedRuntimeNativeBlockEditQueryV1(operation.payload), {
        expected,
        afterSequence: 4,
      });
      const payload = encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1({
        requestPayloadHash: operation.payloadHash,
        identity: expected,
        cursorAfter: 5,
        receipt: receipt(),
      }, 4);
      const accepted = {
        status: "accepted" as const,
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        before: expected,
        after: expected,
        domainReceipts: Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
          domain: "gameplay",
          typeId: RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1,
          schema: 1,
          payload,
        })]),
      };
      return Object.freeze({ ...accepted, receiptHash: outerReceiptHash(accepted) });
    },
  };
  const observed = await queryRustIntegratedRuntimeNativeBlockEditReceiptV1(service, 4);
  assert.equal(calls, 1);
  assert.equal(observed.cursorAfter, 5);
  assert.equal(observed.receipt?.receiptHash, receipt().receiptHash);
  assert.deepEqual(current, expected);

  const drifting = {
    identity: () => current,
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      const result = await service.command(batch);
      current = Object.freeze({ ...expected, stateHash: repeatedHash(0x99) });
      return result;
    },
  };
  await assert.rejects(queryRustIntegratedRuntimeNativeBlockEditReceiptV1(drifting, 4), /mutating|authority/u);
});

test("native block edit V2 query uses one schema-2 operation and returns bound dirty evidence", async () => {
  const expected = identity();
  const native = mutatingReceipt();
  const dirtyEvidence = mutatingDirtyEvidence(native);
  let calls = 0;
  const service = {
    identity: () => expected,
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      calls += 1;
      const operation = batch.operations[0]!;
      assert.equal(operation.typeId, RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2);
      assert.equal(operation.schema, 2);
      assert.deepEqual(decodeRustIntegratedRuntimeNativeBlockEditQueryV2(operation.payload), {
        expected,
        afterSequence: 4,
      });
      const payload = encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2({
        requestPayloadHash: operation.payloadHash,
        identity: expected,
        cursorAfter: 5,
        receipt: native,
        dirtyEvidence,
      }, 4);
      const accepted = {
        status: "accepted" as const,
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        before: expected,
        after: expected,
        domainReceipts: Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
          domain: "gameplay",
          typeId: RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V2,
          schema: 2,
          payload,
        })]),
      };
      return Object.freeze({ ...accepted, receiptHash: outerReceiptHash(accepted) });
    },
  };
  const observed = await queryRustIntegratedRuntimeNativeBlockEditReceiptV2(service, 4);
  assert.equal(calls, 1);
  assert.equal(observed.receipt?.receiptHash, native.receiptHash);
  assert.equal(observed.dirtyEvidence?.evidenceHash, dirtyEvidence.evidenceHash);
});
