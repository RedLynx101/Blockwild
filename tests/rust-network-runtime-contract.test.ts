import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createNetworkAuthorityIdentityV1, createNetworkCommandV1 } from "../app/game/network-authority-contract.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";
import {
  decodeRustNetworkRequestV1,
  decodeRustNetworkResponseV1,
  encodeRustNetworkCommandBatchRequestV1,
  encodeRustNetworkDeltaDeliveryRequestV1,
  encodeRustNetworkGuestPoseRequestV1,
  encodeRustNetworkResponseV1,
} from "../app/game/rust-network-runtime-contract.ts";
import { RustNetworkRuntimeServiceV1 } from "../app/game/rust-network-runtime-service.ts";
import { encodeNetworkCommandWireV1 } from "../app/game/rust-network-wire-v1.ts";
import { decodeRustNetworkPlayerPoseV1, encodeRustNetworkPlayerPoseV1 } from "../app/game/rust-network-player-pose-v1.ts";

function hashBytes(value: string) {
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function fixtureBytes(name = "network-browser-runtime-v1.hex") {
  const path = fileURLToPath(new URL(`./fixtures/rust-engine/r8-r9/${name}`, import.meta.url));
  const value = readFileSync(path, "utf8").trim();
  return Uint8Array.from({ length: value.length / 2 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

test("native Rust network request is exact in TypeScript and preserves >=0x80 bytes", () => {
  const bytes = fixtureBytes(); const request = decodeRustNetworkRequestV1(bytes);
  assert.equal(request.kind, "command-batch");
  if (request.kind !== "command-batch") return;
  assert.equal(request.requestId, 0x0012_0304_0506_0708);
  assert.equal(request.current.revision.world, 41);
  assert.equal(request.commandPackets.length, 1);
  assert.ok(request.commandPackets[0].includes(0x80));
  assert.ok(request.commandPackets[0].includes(0xff));
  assert.deepEqual(encodeRustNetworkCommandBatchRequestV1(request.requestId, request.current, request.now, request.commandPackets), bytes);
});

test("native Rust delta request preserves canonical interest and high-byte keyframe data", () => {
  const bytes = fixtureBytes("network-delta-browser-runtime-v1.hex");
  const request = decodeRustNetworkRequestV1(bytes);
  assert.equal(request.kind, "delta-delivery");
  if (request.kind !== "delta-delivery") return;
  assert.equal(request.interest.sequence, 9);
  assert.deepEqual(request.interest.chunks.map(({ chunkX, chunkZ }) => [chunkX, chunkZ]), [[0, -2], [1, -2]]);
  assert.equal(request.interest.entityIds.length, 2);
  assert.ok(request.deltaPacket.includes(0x80));
  assert.ok(request.deltaPacket.includes(0xff));
  assert.deepEqual(
    encodeRustNetworkDeltaDeliveryRequestV1(
      request.requestId,
      request.checkpointPacket,
      request.interest,
      request.deltaPacket,
    ),
    bytes,
  );
});

test("response codec validates Rust receipt hashes and authority fingerprints", () => {
  const identity = createNetworkAuthorityIdentityV1({ universeId: "blockwild", locationId: "overworld" }, { epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5 });
  const base = { commandId: "command:one", idempotencyKey: "idem:one", peerId: "peer:one", identity } as const;
  const receiptHash = new TypeScriptCanonicalHasher("blockwild-network-receipt-v1")
    .writeString("accepted")
    .writeString(base.commandId)
    .writeString(base.idempotencyKey)
    .writeString(base.peerId)
    .writeString(identity.stateHash)
    .finishHex();
  const response = { kind: "command-batch" as const, requestId: 7, receipts: [Object.freeze({ schemaVersion: 1 as const, status: "accepted" as const, ...base, receiptHash })], authorityFingerprint: "11111111111111111111111111111111" };
  assert.deepEqual(decodeRustNetworkResponseV1(encodeRustNetworkResponseV1(response)), response);
});

test("native guest-pose opcode round-trips one typed command and command-bound projection", () => {
  const identity = createNetworkAuthorityIdentityV1({ universeId: "blockwild", locationId: "overworld" }, { epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5 });
  const posePacket = encodeRustNetworkPlayerPoseV1({
    playerId: "peer:pose", tick: 7, x: 1.25, y: 64.5, z: -3.75,
    yaw: 0.5, pitch: -0.25, vx: 1, vy: 0, vz: -0.5, grounded: true,
    selected: 2, sprinting: true, action: "none",
  });
  const command = createNetworkCommandV1({
    sessionId: "session:pose", commandId: "pose:7", idempotencyKey: "idem:pose:7",
    peerId: "peer:pose", connectionId: "connection:pose", actorId: "peer:pose", peerKind: "human",
    kind: "pose", requiredCapability: "interact", sequence: 7, expected: identity,
    expiresAt: 10_000, leaseKeys: [], payload: posePacket,
  });
  const commandPacket = encodeNetworkCommandWireV1(command);
  const requestBytes = encodeRustNetworkGuestPoseRequestV1(77, identity, 1_000, commandPacket);
  const request = decodeRustNetworkRequestV1(requestBytes);
  assert.equal(request.kind, "guest-pose");
  if (request.kind !== "guest-pose") return;
  assert.equal(request.requestId, 77);
  assert.deepEqual(request.commandPacket, commandPacket);
  assert.deepEqual(encodeRustNetworkGuestPoseRequestV1(request.requestId, request.current, request.now, request.commandPacket), requestBytes);

  const receiptBase = { commandId: command.commandId, idempotencyKey: command.idempotencyKey, peerId: command.peerId, identity } as const;
  const authorityReceiptHash = new TypeScriptCanonicalHasher("blockwild-network-receipt-v1")
    .writeString("accepted").writeString(receiptBase.commandId).writeString(receiptBase.idempotencyKey)
    .writeString(receiptBase.peerId).writeString(identity.stateHash).finishHex();
  const pose = decodeRustNetworkPlayerPoseV1(posePacket);
  const previousRecordHash = "0".repeat(32);
  const recordHash = new TypeScriptCanonicalHasher("blockwild-network-player-pose-record-v1")
    .writeString(command.sessionId).writeString(command.peerId).writeString(pose.playerId).writeU64(1)
    .writeBytes(hashBytes(previousRecordHash)).writeBytes(hashBytes(pose.poseHash)).finishHex();
  const projectionBase = {
    schema: 1 as const, sessionId: command.sessionId, peerId: command.peerId,
    connectionId: command.connectionId, playerId: pose.playerId, commandId: command.commandId,
    commandSequence: command.sequence, commandHash: command.commandHash, authorityReceiptHash,
    presentedDeltaSequence: 3, presentedIdentityHash: command.expected.stateHash,
    recordRevision: 1, previousRecordHash, pose, recordHash,
  };
  const projectionHash = new TypeScriptCanonicalHasher("blockwild-network-player-pose-projection-v1")
    .writeString(projectionBase.sessionId).writeString(projectionBase.peerId).writeString(projectionBase.connectionId)
    .writeString(projectionBase.playerId).writeString(projectionBase.commandId).writeU64(projectionBase.commandSequence)
    .writeBytes(hashBytes(projectionBase.commandHash)).writeBytes(hashBytes(projectionBase.authorityReceiptHash))
    .writeU64(projectionBase.presentedDeltaSequence).writeBytes(hashBytes(projectionBase.presentedIdentityHash))
    .writeU64(projectionBase.recordRevision).writeBytes(hashBytes(projectionBase.recordHash)).finishHex();
  const response = {
    kind: "guest-pose" as const,
    requestId: 77,
    receipt: Object.freeze({ schemaVersion: 1 as const, status: "accepted" as const, ...receiptBase, receiptHash: authorityReceiptHash }),
    projection: Object.freeze({ ...projectionBase, projectionHash }),
    authorityFingerprint: "f".repeat(32),
  };
  assert.deepEqual(decodeRustNetworkResponseV1(encodeRustNetworkResponseV1(response)), response);
  assert.throws(
    () => encodeRustNetworkResponseV1({ ...response, projection: null }),
    /acceptance and projection disagree/u,
  );
  assert.throws(
    () => encodeRustNetworkResponseV1({
      ...response,
      projection: Object.freeze({ ...response.projection, commandId: "pose:other" }),
    }),
    /receipt and projection disagree/u,
  );
  assert.throws(
    () => encodeRustNetworkResponseV1({
      ...response,
      receipt: Object.freeze({ ...response.receipt, code: "invalid", message: "forged rejection" }) as unknown as typeof response.receipt,
    }),
    /carries rejection fields/u,
  );
});

test("runtime service rejects a stale response id and drains pending work", async () => {
  const port = {
    backend: "rust-wasm-worker" as const,
    async request(message: Uint8Array) {
      const request = decodeRustNetworkRequestV1(message);
      return encodeRustNetworkResponseV1({ kind: "handshake", requestId: request.requestId + 1, compatible: true, code: "ok", capabilities: ["observe"], maxCommandBytes: 1024, message: "ok", recordHash: "11111111111111111111111111111111" });
    },
  };
  const service = new RustNetworkRuntimeServiceV1(port);
  await assert.rejects(() => service.negotiate(Uint8Array.of(1), Uint8Array.of(2)), /does not match request/u);
  assert.equal(service.pendingCount, 0);
});

test("runtime service rejects a response from the wrong Rust operation", async () => {
  const port = {
    backend: "rust-wasm-worker" as const,
    async request(message: Uint8Array) {
      const request = decodeRustNetworkRequestV1(message);
      return encodeRustNetworkResponseV1({
        kind: "delta-delivery",
        requestId: request.requestId,
        code: "duplicate",
        sequence: 0,
        stateHash: "11111111111111111111111111111111",
        message: "wrong operation",
      });
    },
  };
  const service = new RustNetworkRuntimeServiceV1(port);
  await assert.rejects(() => service.negotiate(Uint8Array.of(1), Uint8Array.of(2)), /Expected Rust handshake response/u);
  assert.equal(service.pendingCount, 0);
});

test("outer checksum corruption fails before a runtime packet can be trusted", () => {
  const bytes = fixtureBytes(); bytes[bytes.length - 1] ^= 0x80;
  assert.throws(() => decodeRustNetworkRequestV1(bytes), /checksum/u);
});
