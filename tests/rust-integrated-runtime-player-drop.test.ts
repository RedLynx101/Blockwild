import assert from "node:assert/strict";
import test from "node:test";
import type {
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeCommandReceiptV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1,
  decodeRustIntegratedRuntimeNativePlayerDropQueryV1,
  encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1,
  encodeRustIntegratedRuntimeNativePlayerDropQueryV1,
  queryRustIntegratedRuntimeNativePlayerDropReceiptV1,
  rustIntegratedRuntimeNativePlayerDropOriginHashV1,
  rustIntegratedRuntimeNativePlayerDropReceiptHashV1,
} from "../app/game/rust-integrated-runtime-player-drop.ts";
import {
  nativePlayerDropIdentity,
  nativePlayerDropProjectionFixture,
  nativePlayerDropRepeatedHash,
} from "./helpers/rust-native-player-drop-fixture.ts";
import {
  nativeDeathDropWireVector,
  resealNativeWirePacket,
} from "./helpers/rust-death-drop-wire-fixtures.ts";

function fixturePatternedHash(seed: number) {
  return Array.from(
    { length: 16 },
    (_, index) => ((seed + index * 17) & 0xff).toString(16).padStart(2, "0"),
  ).join("");
}

const NATIVE_CROSS_LANGUAGE_PLAYER_DROP_IDENTITY = Object.freeze({
  universeId: "universe:drop:玩家🌌",
  locationId: "surface:峡谷",
  revision: Object.freeze({
    epoch: 23,
    world: 701,
    entities: 702,
    gameplay: 703,
    persistence: 704,
    network: 705,
    simulation: 706,
  }),
  tick: 4_294_967_333,
  stateHash: fixturePatternedHash(0x51),
});

function outerReceiptHash(receipt: Omit<
  Extract<RustIntegratedRuntimeCommandReceiptV1, { status: "accepted" }>,
  "receiptHash"
>) {
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
    ...Buffer.from(receipt.commandHash, "hex"),
    ...Buffer.from(receipt.before.stateHash, "hex"),
    ...Buffer.from(receipt.after.stateHash, "hex"),
    ...receipt.domainReceipts.flatMap((operation) => [...Buffer.from(operation.payloadHash, "hex")]),
  ]));
}

test("Rust native player-drop fixture matches canonical TS hashes and BWQ9/BWS9", () => {
  const receipt = nativePlayerDropProjectionFixture();
  const identity = nativePlayerDropIdentity();
  assert.equal(rustIntegratedRuntimeNativePlayerDropOriginHashV1(receipt), "acc3c26bf14031c7c81abdd65b264746");
  assert.equal(receipt.drop.originHash, "acc3c26bf14031c7c81abdd65b264746");
  assert.equal(rustIntegratedRuntimeNativePlayerDropReceiptHashV1(receipt), "a1bce51366aeae3110dfa618354e3945");
  assert.equal(receipt.receiptHash, "a1bce51366aeae3110dfa618354e3945");

  const query = encodeRustIntegratedRuntimeNativePlayerDropQueryV1({ expected: identity, afterSequence: 5 });
  assert.equal(Buffer.from(query.subarray(0, 8)).toString("hex"), "4257513901000100");
  assert.deepEqual(decodeRustIntegratedRuntimeNativePlayerDropQueryV1(query), {
    expected: identity,
    afterSequence: 5,
  });
  const projection = Object.freeze({
    requestPayloadHash: nativePlayerDropRepeatedHash(0x51),
    identity,
    cursorAfter: 6,
    receipt,
  });
  const packet = encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(projection, 5);
  assert.equal(Buffer.from(packet.subarray(0, 8)).toString("hex"), "4257533901000100");
  assert.deepEqual(
    decodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(
      packet,
      projection.requestPayloadHash,
      5,
    ),
    projection,
  );
});

test("checked Rust BWQ9/BWS9 fixtures preserve Unicode, opaque u64s, hashes, and boundary fixed-point values", () => {
  const bwq9 = nativeDeathDropWireVector("bwq9-request");
  const query = Object.freeze({
    expected: NATIVE_CROSS_LANGUAGE_PLAYER_DROP_IDENTITY,
    afterSequence: 4_320,
  });
  assert.equal(bwq9.direction, "typescript-to-rust");
  assert.equal(Buffer.from(encodeRustIntegratedRuntimeNativePlayerDropQueryV1(query)).toString("hex"), bwq9.hex);
  assert.deepEqual(decodeRustIntegratedRuntimeNativePlayerDropQueryV1(bwq9.bytes), query);

  const bws9 = nativeDeathDropWireVector("bws9-receipt");
  assert.equal(bws9.direction, "rust-to-typescript");
  const projection = decodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(
    bws9.bytes,
    bwq9.wireChecksum,
    query.afterSequence,
  );
  const receipt = projection.receipt;
  assert.ok(receipt);
  assert.equal(receipt.world.universeId, "universe:drop:玩家🌌");
  assert.equal(receipt.player.playerId, BigInt("0xfdb9753113579bdf"));
  assert.equal(receipt.player.entityId, BigInt("0xeca864202468ace0"));
  assert.equal(receipt.drop.entityId, BigInt("0xcafebabedeadbeef"));
  assert.equal(receipt.inventory.beforeRevision, BigInt("0xf0000000000001c9"));
  assert.equal(receipt.drop.position.xMilli, BigInt(-33_554_431_991));
  assert.equal(receipt.drop.velocityMilliPerSecond.xMilli, BigInt(-4_095_999));
  assert.equal(receipt.drop.rotation.yaw, 999_983);
  assert.equal(receipt.drop.dropId, "drop:玩家:🧪:4321");
  assert.equal(receipt.drop.originHash, rustIntegratedRuntimeNativePlayerDropOriginHashV1(receipt));
  assert.equal(receipt.receiptHash, rustIntegratedRuntimeNativePlayerDropReceiptHashV1(receipt));
  assert.equal(
    Buffer.from(encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(
      projection,
      query.afterSequence,
    )).toString("hex"),
    bws9.hex,
  );
});

test("checked BWQ9/BWS9 fixtures reject checksum-valid unsafe cursors and corrupt native receipt hashes", () => {
  const bwq9 = nativeDeathDropWireVector("bwq9-request");
  const unsafeCursor = resealNativeWirePacket(bwq9.bytes, (bytes) => {
    bytes.fill(0xff, bytes.length - 8);
  });
  assert.throws(
    () => decodeRustIntegratedRuntimeNativePlayerDropQueryV1(unsafeCursor),
    /safe|cursor|integer/u,
  );

  const bws9 = nativeDeathDropWireVector("bws9-receipt");
  const invalidSeal = resealNativeWirePacket(bws9.bytes, (bytes) => {
    bytes.fill(0, bytes.length - 16);
  });
  assert.throws(
    () => decodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(
      invalidSeal,
      bwq9.wireChecksum,
      4_320,
    ),
    /receipt hash/u,
  );
  assert.throws(() => decodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(
    bws9.bytes.subarray(0, -1),
  ));
});

test("BWS9 rejects cursor gaps and every canonical binding layer", () => {
  const receipt = nativePlayerDropProjectionFixture();
  const identity = nativePlayerDropIdentity();
  assert.throws(() => encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
    requestPayloadHash: nativePlayerDropRepeatedHash(0x51),
    identity,
    cursorAfter: 6,
    receipt,
  }, 4), /gapped|out of order/u);

  const wrongOrigin = Object.freeze({
    ...receipt,
    drop: Object.freeze({ ...receipt.drop, originHash: nativePlayerDropRepeatedHash(0x01) }),
    receiptHash: receipt.receiptHash,
  });
  assert.throws(() => encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
    requestPayloadHash: nativePlayerDropRepeatedHash(0x51), identity, cursorAfter: 6, receipt: wrongOrigin,
  }, 5), /origin hash/u);

  const wrongContentBase = Object.freeze({
    ...receipt,
    content: Object.freeze({ ...receipt.content, installedManifestHash: nativePlayerDropRepeatedHash(0x75) }),
  });
  const wrongContentOrigin = rustIntegratedRuntimeNativePlayerDropOriginHashV1(wrongContentBase);
  const wrongContentWithOrigin = Object.freeze({
    ...wrongContentBase,
    drop: Object.freeze({ ...wrongContentBase.drop, originHash: wrongContentOrigin }),
  });
  const wrongContent = Object.freeze({
    ...wrongContentWithOrigin,
    receiptHash: rustIntegratedRuntimeNativePlayerDropReceiptHashV1(wrongContentWithOrigin),
  });
  assert.throws(() => encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
    requestPayloadHash: nativePlayerDropRepeatedHash(0x51), identity, cursorAfter: 6, receipt: wrongContent,
  }, 5), /configured manifest/u);

  const wrongReceipt = Object.freeze({ ...receipt, receiptHash: nativePlayerDropRepeatedHash(0x76) });
  assert.throws(() => encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
    requestPayloadHash: nativePlayerDropRepeatedHash(0x51), identity, cursorAfter: 6, receipt: wrongReceipt,
  }, 5), /receipt hash/u);
});

test("legacy max-safe BWQ9 seeds latest without replay", () => {
  const identity = nativePlayerDropIdentity();
  const seeded = Object.freeze({
    requestPayloadHash: nativePlayerDropRepeatedHash(0x51),
    identity,
    cursorAfter: 12,
    receipt: null,
  });
  const packet = encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(
    seeded,
    RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1,
  );
  assert.deepEqual(decodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(
    packet,
    seeded.requestPayloadHash,
    RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1,
  ), seeded);
  assert.throws(() => encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
    ...seeded,
    cursorAfter: 6,
    receipt: nativePlayerDropProjectionFixture(),
  }, RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1), /seed-only/u);
});

test("read-only player-drop BWRQ binds request, identity, cursor, type, and hashes", async () => {
  const expected = nativePlayerDropIdentity();
  let current = expected;
  let calls = 0;
  const service = {
    identity: () => current,
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      calls += 1;
      const operation = batch.operations[0]!;
      assert.equal(operation.domain, "gameplay");
      assert.equal(operation.typeId, RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1);
      assert.deepEqual(decodeRustIntegratedRuntimeNativePlayerDropQueryV1(operation.payload), {
        expected,
        afterSequence: 5,
      });
      const payload = encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
        requestPayloadHash: operation.payloadHash,
        identity: expected,
        cursorAfter: 6,
        receipt: nativePlayerDropProjectionFixture(),
      }, 5);
      const accepted = {
        status: "accepted" as const,
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        before: expected,
        after: expected,
        domainReceipts: Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
          domain: "gameplay",
          typeId: RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1,
          schema: 1,
          payload,
        })]),
      };
      return Object.freeze({ ...accepted, receiptHash: outerReceiptHash(accepted) });
    },
  };
  const observed = await queryRustIntegratedRuntimeNativePlayerDropReceiptV1(service, 5);
  assert.equal(calls, 1);
  assert.equal(observed.cursorAfter, 6);
  assert.equal(observed.receipt?.receiptHash, "a1bce51366aeae3110dfa618354e3945");
  assert.match(observed.projectionPayloadHash, /^[0-9a-f]{32}$/u);

  const driftingService = {
    identity: () => current,
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      const result = await service.command(batch);
      current = nativePlayerDropIdentity(9, nativePlayerDropRepeatedHash(0xaf));
      return result;
    },
  };
  await assert.rejects(queryRustIntegratedRuntimeNativePlayerDropReceiptV1(driftingService, 5), /identity|receipt/u);
});
