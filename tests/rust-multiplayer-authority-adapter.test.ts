import assert from "node:assert/strict";
import test from "node:test";
import { createNetworkAuthorityIdentityV1, createNetworkDeltaV1, createNetworkInterestSetV1 } from "../app/game/network-authority-contract.ts";
import { decodeNetworkCommandWireV1, decodeNetworkDeltaWireV1, encodeNetworkDeltaWireV1 } from "../app/game/rust-network-wire-v1.ts";
import { RustNetworkRuntimeServiceV1 } from "../app/game/rust-network-runtime-service.ts";
import type { RustIntegratedNetworkRuntimePortV1 } from "../app/game/rust-integrated-runtime-domain-adapters.ts";
import {
  IntegratedRustMultiplayerAuthorityV1,
  RUST_MULTIPLAYER_MAX_DURABLE_PEER_LIFECYCLES_V1,
  type RustMultiplayerInboundCommandV1,
} from "../app/game/rust-multiplayer-authority.ts";
import { RustNetworkRuntimeContractError } from "../app/game/rust-network-runtime-contract.ts";
import { decodeRustNetworkPlayerPoseV1, type RustNetworkPlayerPoseProjectionV1 } from "../app/game/rust-network-player-pose-v1.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";

const identity = createNetworkAuthorityIdentityV1(
  { universeId: "blockwild", locationId: "world-main" },
  { epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5 },
);
const interest = createNetworkInterestSetV1({
  sequence: 0,
  chunks: [{ universeId: "blockwild", locationId: "world-main", chunkX: -2, chunkZ: 3 }],
  entityIds: ["agent_drone_001"],
});
const ZERO_HASH = "0".repeat(32);

function hashBytes(value: string) {
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function acceptedNativePoseResponse(
  command: ReturnType<typeof decodeNetworkCommandWireV1>,
  receiptHash = "a".repeat(32),
  recordRevision = command.sequence + 1,
  previousRecordHash = ZERO_HASH,
) {
  const pose = decodeRustNetworkPlayerPoseV1(command.payload);
  const recordHash = new TypeScriptCanonicalHasher("blockwild-network-player-pose-record-v1")
    .writeString(command.sessionId).writeString(command.peerId).writeString(pose.playerId).writeU64(recordRevision)
    .writeBytes(hashBytes(previousRecordHash)).writeBytes(hashBytes(pose.poseHash)).finishHex();
  const projectionBase = {
    schema: 1 as const,
    sessionId: command.sessionId,
    peerId: command.peerId,
    connectionId: command.connectionId,
    playerId: pose.playerId,
    commandId: command.commandId,
    commandSequence: command.sequence,
    commandHash: command.commandHash,
    authorityReceiptHash: receiptHash,
    presentedDeltaSequence: 1,
    presentedIdentityHash: command.expected.stateHash,
    recordRevision,
    previousRecordHash,
    pose,
    recordHash,
  };
  const projectionHash = new TypeScriptCanonicalHasher("blockwild-network-player-pose-projection-v1")
    .writeString(projectionBase.sessionId).writeString(projectionBase.peerId).writeString(projectionBase.connectionId)
    .writeString(projectionBase.playerId).writeString(projectionBase.commandId).writeU64(projectionBase.commandSequence)
    .writeBytes(hashBytes(projectionBase.commandHash)).writeBytes(hashBytes(projectionBase.authorityReceiptHash))
    .writeU64(projectionBase.presentedDeltaSequence).writeBytes(hashBytes(projectionBase.presentedIdentityHash))
    .writeU64(projectionBase.recordRevision).writeBytes(hashBytes(projectionBase.recordHash)).finishHex();
  const projection = Object.freeze({ ...projectionBase, projectionHash }) satisfies RustNetworkPlayerPoseProjectionV1;
  return {
    kind: "guest-pose" as const,
    requestId: 1,
    receipt: {
      schemaVersion: 1 as const,
      status: "accepted" as const,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      peerId: command.peerId,
      identity,
      receiptHash,
    },
    projection,
    authorityFingerprint: "b".repeat(32),
  };
}

function rejectedNativePoseResponse(
  command: ReturnType<typeof decodeNetworkCommandWireV1>,
  code: "connection-mismatch" | "sequence" | "stale-revision" | "invalid",
  message: string,
  receiptHash = "c".repeat(32),
) {
  return {
    kind: "guest-pose" as const,
    requestId: 1,
    receipt: {
      schemaVersion: 1 as const,
      status: "rejected" as const,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      peerId: command.peerId,
      code,
      message,
      identity,
      receiptHash,
    },
    projection: null,
    authorityFingerprint: "d".repeat(32),
  };
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array) {
  outer: for (let offset = 0; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
    for (let index = 0; index < needle.byteLength; index += 1) if (haystack[offset + index] !== needle[index]) continue outer;
    return true;
  }
  return false;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("exclusive multiplayer mutation drains earlier work and blocks later inbound, lifecycle, and negotiation mutations", async () => {
  const events: string[] = [];
  const priorGate = deferred();
  const priorStarted = deferred();
  const exclusiveGate = deferred();
  const exclusiveStarted = deferred();
  const network = {
    async negotiate() {
      events.push("negotiate");
      return {
        kind: "handshake" as const,
        requestId: 1,
        compatible: true,
        code: "ok",
        capabilities: ["build"] as const,
        maxCommandBytes: 1_048_576,
        message: "ok",
        recordHash: "1".repeat(32),
      };
    },
    async authorize(_current: unknown, _now: unknown, packets: readonly Uint8Array[]) {
      events.push("inbound");
      const command = decodeNetworkCommandWireV1(packets[0]!);
      return {
        kind: "command-batch" as const,
        requestId: 2,
        receipts: [{
          schemaVersion: 1 as const,
          status: "accepted" as const,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          peerId: command.peerId,
          identity,
          receiptHash: "2".repeat(32),
        }],
        authorityFingerprint: "3".repeat(32),
      };
    },
    async authorizeAgent() { throw new Error("not used"); },
    async validateDelta() { throw new Error("not used"); },
  } as unknown as RustNetworkRuntimeServiceV1;
  const lifecycle = {
    async installPeerGrant() {
      events.push("prior:start");
      priorStarted.resolve();
      await priorGate.promise;
      events.push("prior:end");
    },
    async releaseCommand() { events.push("lifecycle"); },
  } as unknown as RustIntegratedNetworkRuntimePortV1;
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network,
    lifecycle,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "4".repeat(32),
    generatorHash: "5".repeat(32),
    now: () => 1_000,
  });
  const peer = {
    sessionId: "session_queue_001",
    peerId: "player_queue_001",
    connectionId: "invite_queue_001",
    actorId: "player_queue_001",
    peerKind: "human" as const,
    role: "guest" as const,
    capabilities: ["build"] as const,
    expiresAt: 60_000,
    nextSequence: 0,
    interest,
    connectionGeneration: 1,
  };
  const prior = authority.installPeer(peer);
  await priorStarted.promise;

  const exclusive = authority.runExclusiveMutation(async () => {
    events.push("exclusive:start");
    exclusiveStarted.resolve();
    await exclusiveGate.promise;
    events.push("exclusive:end");
    return "committed" as const;
  });
  const inbound = authority.authorizeInbound({
    sessionId: peer.sessionId,
    peerId: peer.peerId,
    connectionId: peer.connectionId,
    peerKind: peer.peerKind,
    actorId: peer.actorId,
    messageType: "block-action",
    sequence: 0,
    sentAt: 1_000,
    expected: identity,
    encodedEnvelope: JSON.stringify({ payload: { requestId: "request_queue_001", edits: [{ x: 1, y: 2, z: 3, type: 4 }] } }),
    payload: { requestId: "request_queue_001", actorId: peer.actorId, tick: 1, kind: "batch", edits: [{ x: 1, y: 2, z: 3, type: 4 }] },
  });
  const lifecycleMutation = authority.releaseCommand("request_queue_001");
  const negotiation = authority.negotiate(Uint8Array.of(1), Uint8Array.of(2));

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["prior:start"], "the queued barrier waits for already-running authority work");
  priorGate.resolve();
  await exclusiveStarted.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["prior:start", "prior:end", "exclusive:start"], "later authority mutations stay behind the exclusive operation");

  exclusiveGate.resolve();
  assert.equal(await exclusive, "committed");
  await Promise.all([prior, inbound, lifecycleMutation, negotiation]);
  assert.deepEqual(events, [
    "prior:start",
    "prior:end",
    "exclusive:start",
    "exclusive:end",
    "inbound",
    "lifecycle",
    "negotiate",
  ]);
});

test("exclusive multiplayer mutation releases later ordered work after an error", async () => {
  const events: string[] = [];
  const exclusiveGate = deferred();
  const exclusiveStarted = deferred();
  const network = {
    async negotiate() {
      events.push("negotiate");
      return {
        kind: "handshake" as const,
        requestId: 1,
        compatible: true,
        code: "ok",
        capabilities: ["interact"] as const,
        maxCommandBytes: 1_048_576,
        message: "ok",
        recordHash: "6".repeat(32),
      };
    },
  } as unknown as RustNetworkRuntimeServiceV1;
  const lifecycle = {
    async releaseCommand() { events.push("release-command"); },
  } as unknown as RustIntegratedNetworkRuntimePortV1;
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network,
    lifecycle,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "7".repeat(32),
    generatorHash: "8".repeat(32),
    now: () => 1_000,
  });
  const exclusive = authority.runExclusiveMutation(async () => {
    events.push("exclusive:start");
    exclusiveStarted.resolve();
    await exclusiveGate.promise;
    events.push("exclusive:error");
    throw new Error("exclusive mutation failed");
  });
  await exclusiveStarted.promise;
  const rejected = assert.rejects(exclusive, /exclusive mutation failed/u);
  const releaseCommand = authority.releaseCommand("command_queue_001");
  const negotiation = authority.negotiate(Uint8Array.of(1), Uint8Array.of(2));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["exclusive:start"]);

  exclusiveGate.resolve();
  await rejected;
  await Promise.all([releaseCommand, negotiation]);
  assert.deepEqual(events, ["exclusive:start", "exclusive:error", "release-command", "negotiate"]);
});

test("player-state alone uses presentation-state while pose and progress retain their native kinds", async () => {
  const kinds: string[] = [];
  const network = {
    async authorize(_current: unknown, _now: unknown, packets: readonly Uint8Array[]) {
      const decoded = decodeNetworkCommandWireV1(packets[0]!);
      kinds.push(decoded.kind);
      return {
        kind: "command-batch" as const,
        requestId: kinds.length,
        receipts: [{
          schemaVersion: 1 as const,
          status: "accepted" as const,
          commandId: decoded.commandId,
          idempotencyKey: decoded.idempotencyKey,
          peerId: decoded.peerId,
          identity,
          receiptHash: "a".repeat(32),
        }],
        authorityFingerprint: "b".repeat(32),
      };
    },
    async authorizeGuestPose(_current: unknown, _now: unknown, packet: Uint8Array) {
      const decoded = decodeNetworkCommandWireV1(packet);
      kinds.push(decoded.kind);
      return acceptedNativePoseResponse(decoded);
    },
    async negotiate() { throw new Error("not used"); },
    async authorizeAgent() { throw new Error("not used"); },
    async validateDelta() { throw new Error("not used"); },
  } as unknown as RustNetworkRuntimeServiceV1;
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network,
    lifecycle: { installPeerGrant: async () => undefined } as unknown as RustIntegratedNetworkRuntimePortV1,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "c".repeat(32),
    generatorHash: "d".repeat(32),
    now: () => 1_000,
  });
  const inbound = (messageType: "player-pose" | "player-state" | "player-progress", sequence: number): RustMultiplayerInboundCommandV1 => ({
    sessionId: "session_rust_001",
    peerId: "player_guest_01",
    connectionId: "invite_human_001",
    peerKind: "human",
    actorId: "player_guest_01",
    messageType,
    sequence,
    sentAt: 1_000,
    expected: identity,
    encodedEnvelope: JSON.stringify({ payload: { requestId: `${messageType}:${sequence}` } }),
    payload: messageType === "player-pose" ? {
      playerId: "player_guest_01", tick: sequence, x: 1, y: 42, z: -3,
      yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, grounded: true, action: "none",
    } : { requestId: `${messageType}:${sequence}` },
  });

  await authority.installPeer({
    sessionId: "session_rust_001", peerId: "player_guest_01", connectionId: "invite_human_001",
    actorId: "player_guest_01", peerKind: "human", role: "guest", capabilities: ["interact"],
    expiresAt: 60_000, nextSequence: 0, interest, connectionGeneration: 1,
  });
  await authority.authorizeInbound(inbound("player-pose", 0));
  await authority.authorizeInbound(inbound("player-state", 1));
  await authority.authorizeInbound(inbound("player-progress", 2));
  assert.deepEqual(kinds, ["pose", "presentation-state", "gameplay"]);
});

test("stale or far-future guest poses fail before native sequence consumption", async () => {
  let nativeCalls = 0;
  const network = {
    async authorizeGuestPose(_current: unknown, _now: unknown, packet: Uint8Array) {
      nativeCalls += 1;
      return acceptedNativePoseResponse(decodeNetworkCommandWireV1(packet));
    },
    async negotiate() { throw new Error("not used"); },
    async authorize() { throw new Error("not used"); },
    async authorizeAgent() { throw new Error("not used"); },
    async validateDelta() { throw new Error("not used"); },
  } as unknown as RustNetworkRuntimeServiceV1;
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network,
    lifecycle: { installPeerGrant: async () => undefined } as unknown as RustIntegratedNetworkRuntimePortV1,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "c".repeat(32),
    generatorHash: "d".repeat(32),
    now: () => 100_000,
  });
  const peerId = "player_freshness_01";
  const connectionId = "invite_freshness_01";
  await authority.installPeer({
    sessionId: "session_freshness_001", peerId, connectionId, actorId: peerId,
    peerKind: "human", role: "guest", capabilities: ["interact"], expiresAt: 200_000,
    nextSequence: 0, interest, connectionGeneration: 1,
  });
  const pose = (sentAt: number): RustMultiplayerInboundCommandV1 => ({
    sessionId: "session_freshness_001", peerId, connectionId, actorId: peerId,
    peerKind: "human", messageType: "player-pose", sequence: 0, sentAt, expected: identity,
    encodedEnvelope: JSON.stringify({ sentAt }),
    payload: {
      playerId: peerId, tick: 1, x: 1, y: 42, z: -3, yaw: 0, pitch: 0,
      vx: 0, vy: 0, vz: 0, grounded: true, action: "none",
    },
  });

  assert.equal((await authority.authorizeInbound(pose(69_999))).code, "command-expired");
  assert.equal((await authority.authorizeInbound(pose(220_001))).code, "command-expired");
  assert.equal(nativeCalls, 0);
  assert.equal((await authority.authorizeInbound(pose(70_000))).accepted, true,
    "the exact 30-second freshness boundary remains admissible");
  assert.equal(nativeCalls, 1);
});

test("stable command cursor survives fenced peer replacement and ignores a late old-token release", async () => {
  const commands: ReturnType<typeof decodeNetworkCommandWireV1>[] = [];
  const retainedReceipts = new Map<string, string>();
  const retainedPoseResponses = new Map<string, ReturnType<typeof acceptedNativePoseResponse>>();
  const lifecycleCalls: string[] = [];
  const installedSequences: number[] = [];
  const installedInterestHashes: string[] = [];
  let activeHostConnection: string | null = null;
  let hostNextSequence = 0;
  let poseRecordRevision = 0;
  let poseRecordHash = ZERO_HASH;
  const network = {
    async authorizeGuestPose(_current: unknown, _now: unknown, packet: Uint8Array) {
      const command = decodeNetworkCommandWireV1(packet);
      commands.push(command);
      const retainedHash = retainedReceipts.get(command.idempotencyKey);
      if (retainedHash && retainedHash !== command.commandHash) {
        return rejectedNativePoseResponse(command, "invalid", "idempotency key was reused for another command", "e".repeat(32));
      }
      if (retainedHash === command.commandHash) return retainedPoseResponses.get(command.idempotencyKey)!;
      if (command.connectionId !== activeHostConnection || command.sequence !== hostNextSequence) {
        return rejectedNativePoseResponse(
          command,
          command.connectionId !== activeHostConnection ? "connection-mismatch" : "sequence",
          "command does not match the active fake host grant",
        );
      }
      retainedReceipts.set(command.idempotencyKey, command.commandHash);
      if (command.sequence === 2) {
        return rejectedNativePoseResponse(command, "stale-revision", "fixture rejects the current authority revision", "9".repeat(32));
      }
      hostNextSequence = command.sequence + 1;
      const response = acceptedNativePoseResponse(command, "a".repeat(32), poseRecordRevision + 1, poseRecordHash);
      poseRecordRevision = response.projection.recordRevision;
      poseRecordHash = response.projection.recordHash;
      retainedPoseResponses.set(command.idempotencyKey, response);
      return response;
    },
    async negotiate() { throw new Error("not used"); },
    async authorizeAgent() { throw new Error("not used"); },
    async validateDelta() { throw new Error("not used"); },
  } as unknown as RustNetworkRuntimeServiceV1;
  const lifecycle = {
    async installPeerGrant(grant: { connectionId: string; nextSequence: number; interest: { interestHash: string } }) {
      lifecycleCalls.push(`install:${grant.connectionId}`);
      installedSequences.push(grant.nextSequence);
      installedInterestHashes.push(grant.interest.interestHash);
      activeHostConnection = grant.connectionId;
      hostNextSequence = grant.nextSequence;
    },
    async releasePeer(peerId: string) {
      lifecycleCalls.push(`release:${peerId}`);
      activeHostConnection = null;
    },
    async releaseCommand(commandId: string) {
      lifecycleCalls.push(`command-release:${commandId}`);
    },
    async buildDelta(value: Parameters<RustIntegratedNetworkRuntimePortV1["buildDelta"]>[0]) {
      lifecycleCalls.push(`delta:${value.acknowledgedCommandSequence}`);
      return {
        scopeProbes: 1,
        candidateRecords: 0,
        emittedRecords: 0,
        deltaPacket: encodeNetworkDeltaWireV1(createNetworkDeltaV1({
          ...value,
          interestHash: value.interest.interestHash,
          records: [],
        })),
      };
    },
  } as unknown as RustIntegratedNetworkRuntimePortV1;
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network,
    lifecycle,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "c".repeat(32),
    generatorHash: "d".repeat(32),
    now: () => 1_000,
  });
  const peerId = "player_guest_reconnect_01";
  const firstConnectionId = "invite_secret_first_connection";
  const secondConnectionId = "invite_secret_second_connection";
  const thirdConnectionId = "invite_secret_third_connection";
  const shiftedInterest = createNetworkInterestSetV1({
    sequence: interest.sequence + 1,
    chunks: [{ universeId: "blockwild", locationId: "world-main", chunkX: -1, chunkZ: 3 }],
    entityIds: ["agent_drone_001"],
  });
  const peer = (connectionId: string, connectionGeneration: number, peerInterest = interest) => ({
    sessionId: "session_reconnect_001",
    peerId,
    connectionId,
    actorId: peerId,
    peerKind: "human" as const,
    role: "guest" as const,
    capabilities: ["interact"] as const,
    expiresAt: 60_000,
    nextSequence: 0,
    interest: peerInterest,
    connectionGeneration,
  });
  const pose = (connectionId: string, sequence: number, x: number): RustMultiplayerInboundCommandV1 => {
    const payload = {
      playerId: peerId,
      tick: x,
      x,
      y: 42,
      z: -3,
      yaw: 0,
      pitch: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      action: "none",
    };
    return {
      sessionId: "session_reconnect_001",
      peerId,
      connectionId,
      peerKind: "human",
      actorId: peerId,
      messageType: "player-pose",
      sequence,
      sentAt: 1_000,
      expected: identity,
      encodedEnvelope: JSON.stringify({ payload }),
      payload,
    };
  };

  const firstInstall = await authority.installPeer(peer(firstConnectionId, 1));
  const first = await authority.authorizeInbound(pose(firstConnectionId, 0, 1));
  const firstReplay = await authority.authorizeInbound(pose(firstConnectionId, 0, 1));
  const firstRelease = await authority.releasePeer({ sessionId: "session_reconnect_001", peerId, connectionId: firstConnectionId, connectionGeneration: 1 });
  const secondInstall = await authority.installPeer(peer(secondConnectionId, 1));
  const second = await authority.authorizeInbound(pose(secondConnectionId, 1, 2));
  const refresh = await authority.installPeer(peer(secondConnectionId, secondInstall.connectionGeneration!, shiftedInterest));
  const rejected = await authority.authorizeInbound(pose(secondConnectionId, 2, 3));
  const secondRelease = await authority.releasePeer({ sessionId: "session_reconnect_001", peerId, connectionId: secondConnectionId, connectionGeneration: 1 });
  const thirdInstall = await authority.installPeer(peer(thirdConnectionId, 1));
  const commandsBeforeGap = commands.length;
  const gap = await authority.authorizeInbound(pose(thirdConnectionId, 100, 4));
  const thirdRefresh = await authority.installPeer(peer(thirdConnectionId, thirdInstall.connectionGeneration!));
  const staleFirstInstall = await authority.installPeer(peer(firstConnectionId, 1));
  const lateFirstRelease = await authority.releasePeer({ sessionId: "session_reconnect_001", peerId, connectionId: firstConnectionId, connectionGeneration: 1 });
  const lateSecondRelease = await authority.releasePeer({ sessionId: "session_reconnect_001", peerId, connectionId: secondConnectionId, connectionGeneration: 2 });
  const built = await authority.buildDelta({
    sessionId: "session_reconnect_001",
    deltaId: "delta_cursor_three_001",
    peerId,
    connectionId: thirdConnectionId,
    connectionGeneration: thirdInstall.connectionGeneration!,
    keyframe: true,
    sequence: 1,
    from: identity,
    to: identity,
    interest,
  });
  const delta = decodeNetworkDeltaWireV1(built.packet);

  assert.equal(firstInstall.status, "installed");
  assert.equal(firstInstall.connectionGeneration, 1);
  assert.equal(firstInstall.nextSequence, 0);
  assert.equal(first.accepted, true);
  assert.equal(firstReplay.accepted, true);
  assert.equal(firstRelease, "released");
  assert.equal(secondInstall.nextSequence, 1, "a replacement grant resumes after the stable peer's accepted command");
  assert.equal(secondInstall.connectionGeneration, 2, "a new token receives a durable generation even when a new session requests generation one");
  assert.equal(second.accepted, true);
  assert.equal(refresh.nextSequence, 2, "a same-token refresh cannot regress the native command cursor");
  assert.equal(refresh.connectionGeneration, secondInstall.connectionGeneration,
    "a same-token interest refresh cannot allocate a replacement connection generation");
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.code, "stale-revision");
  assert.equal(secondRelease, "released");
  assert.equal(thirdInstall.connectionGeneration, 3, "cancel-safe requested-generation cleanup does not regress the durable allocator");
  assert.equal(thirdInstall.nextSequence, 3, "a native rejection burns its stable sequence before reconnect");
  assert.equal(gap.accepted, false);
  assert.equal(gap.code, "sequence");
  assert.equal(commands.length, commandsBeforeGap, "an out-of-order suffix is rejected before native receipt state can be polluted");
  assert.equal(thirdRefresh.nextSequence, 3, "an out-of-order suffix cannot jump the stable cursor");
  assert.equal(staleFirstInstall.status, "superseded", "a closed older generation cannot reinstall after replacement");
  assert.equal(lateFirstRelease, "superseded", "late cleanup for the old token cannot release the replacement grant");
  assert.equal(lateSecondRelease, "superseded", "late cleanup for the rejected connection cannot release the third grant");
  assert.equal(delta.acknowledgedCommandSequence, 3, "the serialized adapter stamps the stable cursor into the native delta");
  assert.deepEqual(commands.map((command) => command.sequence), [0, 0, 1, 2]);
  assert.equal(commands[0]!.commandHash, commands[1]!.commandHash, "a retry on one connection reproduces its exact authority identity");
  assert.equal(commands[0]!.commandId, commands[1]!.commandId);
  assert.equal(commands[0]!.idempotencyKey, commands[1]!.idempotencyKey);
  assert.equal(commands[0]!.commandHash === commands[2]!.commandHash, false);
  assert.equal(commands[0]!.commandId, `player-pose:${peerId}:0`);
  assert.equal(commands[2]!.commandId, `player-pose:${peerId}:1`);
  assert.notEqual(commands[0]!.commandId, commands[2]!.commandId);
  assert.notEqual(commands[0]!.idempotencyKey, commands[2]!.idempotencyKey);
  assert.equal(commands.some((command) => command.commandId.includes(firstConnectionId) || command.commandId.includes(secondConnectionId)), false);
  assert.equal(commands[3]!.commandId, `player-pose:${peerId}:2`);
  assert.equal(retainedReceipts.size, 3);
  assert.deepEqual(installedSequences, [0, 1, 2, 3, 3]);
  assert.deepEqual(installedInterestHashes, [
    interest.interestHash,
    interest.interestHash,
    shiftedInterest.interestHash,
    interest.interestHash,
    interest.interestHash,
  ], "a same-token grant refresh updates only the active native interest while preserving later reconnect isolation");
  assert.deepEqual(lifecycleCalls, [
    `install:${firstConnectionId}`,
    `release:${peerId}`,
    `install:${secondConnectionId}`,
    `install:${secondConnectionId}`,
    `release:${peerId}`,
    `install:${thirdConnectionId}`,
    `install:${thirdConnectionId}`,
    "delta:3",
  ]);
});

test("replacement waits for an active command, drains its lease, and fences late old-owner cleanup", async () => {
  const events: string[] = [];
  const authorizationEntered = deferred();
  const authorizationGate = deferred();
  const network = {
    async authorizeGuestPose(_current: unknown, _now: unknown, packet: Uint8Array) {
      const command = decodeNetworkCommandWireV1(packet);
      events.push(`authorize:start:${command.sequence}`);
      authorizationEntered.resolve();
      await authorizationGate.promise;
      events.push(`authorize:accepted:${command.sequence}`);
      return acceptedNativePoseResponse(command, "7".repeat(32));
    },
  } as unknown as RustNetworkRuntimeServiceV1;
  const lifecycle = {
    async installPeerGrant(grant: { connectionId: string; nextSequence: number }) {
      events.push(`install:${grant.connectionId}:${grant.nextSequence}`);
    },
    async installAgentGrant() { events.push("agent-install"); },
    async releaseCommand(commandId: string) { events.push(`command-release:${commandId}`); },
    async releasePeer(peerId: string) { events.push(`peer-release:${peerId}`); },
  } as unknown as RustIntegratedNetworkRuntimePortV1;
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network,
    lifecycle,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "4".repeat(32),
    generatorHash: "5".repeat(32),
    now: () => 1_000,
  });
  const sessionId = "session_replacement_race_001";
  const peerId = "player_replacement_race_001";
  const connectionA = "invite_replacement_race_a";
  const connectionB = "invite_replacement_race_b";
  const peer = (connectionId: string, connectionGeneration: number) => ({
    sessionId,
    peerId,
    connectionId,
    actorId: peerId,
    peerKind: "human" as const,
    role: "guest" as const,
    capabilities: ["interact"] as const,
    expiresAt: 60_000,
    nextSequence: 0,
    interest,
    connectionGeneration,
  });
  const first = peer(connectionA, 1);
  const second = peer(connectionB, 2);
  await authority.installPeer(first);
  const payload = {
    playerId: peerId, tick: 1, x: 1, y: 42, z: -3, yaw: 0, pitch: 0,
    vx: 0, vy: 0, vz: 0, grounded: true, action: "none",
  };
  const authorization = authority.authorizeInbound({
    sessionId, peerId, connectionId: connectionA, peerKind: "human", actorId: peerId,
    messageType: "player-pose", sequence: 0, sentAt: 1_000, expected: identity,
    encodedEnvelope: JSON.stringify({ payload }), payload,
  });
  await authorizationEntered.promise;
  const replacement = authority.installPeer(second);
  const lateAgentCleanup = authority.installAgentGrant({
    schema: 1,
    agentId: peerId,
    connectionId: connectionA,
    status: "disconnected",
    requested: [],
    granted: [],
    updatedAt: 1_000,
  }, first);
  const latePeerCleanup = authority.releasePeer(first);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [`install:${connectionA}:0`, "authorize:start:0"]);

  authorizationGate.resolve();
  const [decision, installed, , released] = await Promise.all([
    authorization,
    replacement,
    lateAgentCleanup,
    latePeerCleanup,
  ]);
  assert.equal(decision.accepted, true);
  assert.equal(installed.status, "installed");
  assert.equal(installed.nextSequence, 1);
  assert.equal(released, "superseded");
  assert.deepEqual(events, [
    `install:${connectionA}:0`,
    "authorize:start:0",
    "authorize:accepted:0",
    `command-release:player-pose:${peerId}:0`,
    `install:${connectionB}:1`,
  ], "replacement retires A's accepted lease before B and later A cleanup cannot touch B");
  const staleInstall = await authority.installPeer(first);
  assert.equal(staleInstall.status, "superseded");
  assert.equal(staleInstall.nextSequence, 1);
  assert.equal(events.some((event) => event === "agent-install" || event.startsWith("peer-release:")), false);
});

test("integrated multiplayer adapter keeps high-byte agent work opaque and delegates lease lifecycle", async () => {
  const captured: { envelope?: Uint8Array; work?: Uint8Array } = {};
  const lifecycleCalls: string[] = [];
  const receipt = {
    schemaVersion: 1 as const,
    status: "accepted" as const,
    commandId: "command_agent_0001",
    idempotencyKey: "idem:agent",
    peerId: "agent_drone_001",
    identity,
    receiptHash: "1".repeat(32),
  };
  const network = {
    async negotiate() { return { kind: "handshake" as const, requestId: 1, compatible: true, code: "ok", capabilities: ["agent-work", "chat"] as const, maxCommandBytes: 1_048_576, message: "ok", recordHash: "2".repeat(32) }; },
    async authorizeAgent(_current: unknown, _now: unknown, envelope: Uint8Array, work: Uint8Array) {
      captured.envelope = envelope; captured.work = work;
      return { kind: "agent-command" as const, requestId: 2, code: "accepted" as const, receipt, authorityFingerprint: "3".repeat(32) };
    },
    async authorize() { throw new Error("not used"); },
    async validateDelta() { throw new Error("not used"); },
  } as unknown as RustNetworkRuntimeServiceV1;
  const lifecycle = {
    async installPeerGrant() { lifecycleCalls.push("peer-install"); },
    async installAgentGrant() { lifecycleCalls.push("agent-install"); },
    async releaseCommand(commandId: string) { lifecycleCalls.push(`command-release:${commandId}`); },
    async releasePeer(peerId: string) { lifecycleCalls.push(`peer-release:${peerId}`); },
  } as unknown as RustIntegratedNetworkRuntimePortV1;
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network, lifecycle, identity: () => identity, engineVersion: "1.12.0",
    contentHash: "4".repeat(32), generatorHash: "5".repeat(32), now: () => 1_000,
  });
  const peer = {
    sessionId: "session_rust_001", peerId: "agent_drone_001", connectionId: "invite_agent_001",
    actorId: "agent_drone_001", peerKind: "agent" as const, role: "guest" as const,
    capabilities: ["agent-work", "chat"] as const, expiresAt: 60_000, nextSequence: 0,
    interest, connectionGeneration: 1,
  };
  await authority.installPeer(peer);
  await authority.installAgentGrant({ schema: 1, agentId: peer.peerId, connectionId: peer.connectionId, status: "approved", requested: ["observe.world"], granted: ["observe.world"], updatedAt: 1_000 }, peer);
  const payload = {
    schema: 1 as const, commandId: "command_agent_0001", agentId: peer.peerId, kind: "observe" as const,
    expectedWorldRevision: 4, issuedAt: 1_000, expiresAt: 30_000,
    arguments: { note: "雪・水・🐉 and byte \u0080" }, clientIntent: "Inspect the luminous shore.",
  };
  const command: RustMultiplayerInboundCommandV1 = {
    sessionId: peer.sessionId, peerId: peer.peerId, connectionId: peer.connectionId,
    peerKind: "agent", actorId: peer.actorId, messageType: "agent-command", sequence: 0,
    sentAt: 1_000, expected: identity, encodedEnvelope: JSON.stringify({ payload }), payload,
  };
  const decision = await authority.authorizeInbound(command);
  assert.equal(decision.accepted, true);
  assert.ok(captured.envelope && captured.work);
  assert.deepEqual([...captured.work!.subarray(0, 4)], [...new TextEncoder().encode("BWA1")]);
  assert.equal(containsBytes(captured.work!, new TextEncoder().encode("雪・水・🐉 and byte \u0080")), true);
  const outer = decodeNetworkCommandWireV1(captured.envelope!);
  assert.deepEqual([...outer.payload], [...captured.work!], "the BWN command carries one complete BWA packet, not per-entity calls");
  await authority.releaseCommand(payload.commandId);
  await authority.releasePeer({
    sessionId: peer.sessionId,
    peerId: peer.peerId,
    connectionId: peer.connectionId,
    connectionGeneration: peer.connectionGeneration,
  });
  await authority.drain();
  assert.deepEqual(lifecycleCalls, ["peer-install", "agent-install", `command-release:${payload.commandId}`, `peer-release:${peer.peerId}`]);
});

test("integrated multiplayer adapter leases every cell in a maximum block batch", async () => {
  let leaseCount = 0;
  const network = {
    async authorize(_current: unknown, _now: unknown, packets: readonly Uint8Array[]) {
      const decoded = decodeNetworkCommandWireV1(packets[0]!);
      leaseCount = decoded.leaseKeys.length;
      return {
        kind: "command-batch" as const, requestId: 1,
        receipts: [{ schemaVersion: 1 as const, status: "accepted" as const, commandId: decoded.commandId, idempotencyKey: decoded.idempotencyKey, peerId: decoded.peerId, identity, receiptHash: "6".repeat(32) }],
        authorityFingerprint: "7".repeat(32),
      };
    },
    async negotiate() { throw new Error("not used"); },
    async authorizeAgent() { throw new Error("not used"); },
    async validateDelta() { throw new Error("not used"); },
  } as unknown as RustNetworkRuntimeServiceV1;
  const lifecycle = {
    async installPeerGrant() {}, async releasePeer() {},
  } as unknown as RustIntegratedNetworkRuntimePortV1;
  const authority = new IntegratedRustMultiplayerAuthorityV1({ network, lifecycle, identity: () => identity, engineVersion: "1.12.0", contentHash: "8".repeat(32), generatorHash: "9".repeat(32), now: () => 1_000 });
  const edits = Array.from({ length: 2_048 }, (_, index) => ({ x: index, y: 40, z: -3, type: 1 }));
  const payload = { requestId: "request_batch_001", actorId: "player_guest_01", tick: 1, kind: "batch", edits };
  await authority.installPeer({
    sessionId: "session_rust_001", peerId: payload.actorId, connectionId: "invite_human_001",
    actorId: payload.actorId, peerKind: "human", role: "guest", capabilities: ["build"],
    expiresAt: 60_000, nextSequence: 0, interest, connectionGeneration: 1,
  });
  const decision = await authority.authorizeInbound({
    sessionId: "session_rust_001", peerId: payload.actorId, connectionId: "invite_human_001", peerKind: "human",
    actorId: payload.actorId, messageType: "block-action", sequence: 0, sentAt: 1_000,
    expected: identity, encodedEnvelope: JSON.stringify({ payload }), payload,
  });
  assert.equal(decision.accepted, true);
  assert.equal(leaseCount, 2_048);
});

function durablePosePeer(
  sessionId: string,
  peerId: string,
  connectionId: string,
  connectionGeneration: number,
) {
  return {
    sessionId,
    peerId,
    connectionId,
    actorId: peerId,
    peerKind: "human" as const,
    role: "guest" as const,
    capabilities: ["interact"] as const,
    expiresAt: 60_000,
    nextSequence: 0,
    interest,
    connectionGeneration,
  };
}

function durablePoseCommand(
  sessionId: string,
  peerId: string,
  connectionId: string,
  sequence: number,
  x: number,
): RustMultiplayerInboundCommandV1 {
  const payload = {
    playerId: peerId,
    tick: sequence + 1,
    x,
    y: 42,
    z: -3,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    action: "none",
  };
  return {
    sessionId,
    peerId,
    connectionId,
    peerKind: "human",
    actorId: peerId,
    messageType: "player-pose",
    sequence,
    sentAt: 1_000,
    expected: identity,
    encodedEnvelope: JSON.stringify({ payload }),
    payload,
  };
}

test("adapter-owned native pose history accepts an exact old replay without regressing its latest chain tip", async () => {
  const sessionId = "session_pose_history_001";
  const peerId = "player_pose_history_001";
  const connectionId = "invite_pose_history_001";
  const retained = new Map<number, ReturnType<typeof acceptedNativePoseResponse>>();
  let latestRevision = 0;
  let latestRecordHash = ZERO_HASH;
  const network = {
    async authorizeGuestPose(_current: unknown, _now: unknown, packet: Uint8Array) {
      const command = decodeNetworkCommandWireV1(packet);
      const replay = retained.get(command.sequence);
      if (replay) return replay;
      const response = acceptedNativePoseResponse(
        command,
        (command.sequence + 1).toString(16).repeat(32),
        latestRevision + 1,
        latestRecordHash,
      );
      latestRevision = response.projection.recordRevision;
      latestRecordHash = response.projection.recordHash;
      retained.set(command.sequence, response);
      return response;
    },
  } as unknown as RustNetworkRuntimeServiceV1;
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network,
    lifecycle: { async installPeerGrant() {}, async releaseCommand() {} } as unknown as RustIntegratedNetworkRuntimePortV1,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "1".repeat(32),
    generatorHash: "2".repeat(32),
    now: () => 1_000,
  });
  await authority.installPeer(durablePosePeer(sessionId, peerId, connectionId, 1));

  const first = await authority.authorizeInbound(durablePoseCommand(sessionId, peerId, connectionId, 0, 1));
  const second = await authority.authorizeInbound(durablePoseCommand(sessionId, peerId, connectionId, 1, 2));
  const replay = await authority.authorizeInbound(durablePoseCommand(sessionId, peerId, connectionId, 0, 1));
  const third = await authority.authorizeInbound(durablePoseCommand(sessionId, peerId, connectionId, 2, 3));

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(replay.accepted, true);
  assert.equal(replay.nativePose?.receiptHash, first.nativePose?.receiptHash, "the old command reuses its exact cached native projection");
  assert.equal(third.accepted, true, "the exact historical replay must not roll the adapter chain tip back to revision one");
  assert.equal(third.nativePose?.recordRevision, 3);
  assert.equal(third.nativePose?.previousRecordHash, second.nativePose?.recordHash);
});

test("a changed same-revision native pose projection releases custody without poisoning the durable chain", async () => {
  const sessionId = "session_pose_poison_001";
  const peerId = "player_pose_poison_001";
  const firstConnectionId = "invite_pose_poison_a";
  const secondConnectionId = "invite_pose_poison_b";
  const releasedCommands: string[] = [];
  let firstRecordHash = ZERO_HASH;
  const network = {
    async authorizeGuestPose(_current: unknown, _now: unknown, packet: Uint8Array) {
      const command = decodeNetworkCommandWireV1(packet);
      if (command.sequence === 0) {
        const response = acceptedNativePoseResponse(command, "3".repeat(32), 1, ZERO_HASH);
        firstRecordHash = response.projection.recordHash;
        return response;
      }
      if (command.sequence === 1) {
        return acceptedNativePoseResponse(command, "4".repeat(32), 1, ZERO_HASH);
      }
      return acceptedNativePoseResponse(command, "5".repeat(32), 2, firstRecordHash);
    },
  } as unknown as RustNetworkRuntimeServiceV1;
  const lifecycle = {
    async installPeerGrant() {},
    async releaseCommand(commandId: string) { releasedCommands.push(commandId); },
    async releasePeer() {},
  } as unknown as RustIntegratedNetworkRuntimePortV1;
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network,
    lifecycle,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "6".repeat(32),
    generatorHash: "7".repeat(32),
    now: () => 1_000,
  });
  await authority.installPeer(durablePosePeer(sessionId, peerId, firstConnectionId, 1));
  const first = await authority.authorizeInbound(durablePoseCommand(sessionId, peerId, firstConnectionId, 0, 1));
  assert.equal(first.accepted, true);

  await assert.rejects(
    authority.authorizeInbound(durablePoseCommand(sessionId, peerId, firstConnectionId, 1, 2)),
    /record ancestry is not contiguous/u,
  );
  assert.deepEqual(releasedCommands, [`player-pose:${peerId}:1`], "an invalid accepted projection cannot retain command custody");

  assert.equal(await authority.releasePeer({ sessionId, peerId, connectionId: firstConnectionId, connectionGeneration: 1 }), "released");
  const replacement = await authority.installPeer(durablePosePeer(sessionId, peerId, secondConnectionId, 1));
  assert.equal(replacement.connectionGeneration, 2);
  assert.equal(replacement.nextSequence, 2, "the invalid native response still consumes its command sequence before fencing the token");
  const contiguous = await authority.authorizeInbound(durablePoseCommand(sessionId, peerId, secondConnectionId, 2, 3));
  assert.equal(contiguous.accepted, true, "the rejected projection must not replace the last valid record tip");
  assert.equal(contiguous.nativePose?.recordRevision, 2);
  assert.equal(contiguous.nativePose?.previousRecordHash, first.nativePose?.recordHash);
});

test("durable peer generations remap inactive tokens, serialize contenders, and fence stale cleanup", async () => {
  const sessionId = "session_generation_serial_001";
  const peerId = "player_generation_serial_001";
  const installedConnections: string[] = [];
  const releasedPeers: string[] = [];
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network: {} as RustNetworkRuntimeServiceV1,
    lifecycle: {
      async installPeerGrant(grant: { connectionId: string }) { installedConnections.push(grant.connectionId); },
      async releasePeer(releasedPeerId: string) { releasedPeers.push(releasedPeerId); },
    } as unknown as RustIntegratedNetworkRuntimePortV1,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "8".repeat(32),
    generatorHash: "9".repeat(32),
    now: () => 1_000,
  });
  const firstConnectionId = "invite_generation_serial_a";
  const secondConnectionId = "invite_generation_serial_b";
  const losingConnectionId = "invite_generation_serial_c";
  await authority.installPeer(durablePosePeer(sessionId, peerId, firstConnectionId, 1));
  assert.equal(await authority.releasePeer({ sessionId, peerId, connectionId: firstConnectionId, connectionGeneration: 1 }), "released");

  const [replacement, contender] = await Promise.all([
    authority.installPeer(durablePosePeer(sessionId, peerId, secondConnectionId, 1)),
    authority.installPeer(durablePosePeer(sessionId, peerId, losingConnectionId, 1)),
  ]);
  assert.equal(replacement.status, "installed");
  assert.equal(replacement.connectionGeneration, 2, "a new token after teardown receives the next durable generation");
  assert.equal(contender.status, "superseded", "the serialized loser cannot install a second token at the remapped generation");
  assert.equal(contender.connectionGeneration, 2);

  const refresh = await authority.installPeer(durablePosePeer(sessionId, peerId, secondConnectionId, replacement.connectionGeneration!));
  assert.equal(refresh.status, "installed");
  assert.equal(refresh.connectionGeneration, 2, "refreshing the surviving token does not allocate another generation");
  assert.equal(
    await authority.releasePeer({ sessionId, peerId, connectionId: firstConnectionId, connectionGeneration: 1 }),
    "superseded",
  );
  assert.equal(
    await authority.releasePeer({ sessionId, peerId, connectionId: secondConnectionId, connectionGeneration: 2 }),
    "released",
    "the stale cleanup did not deactivate the replacement",
  );
  assert.deepEqual(installedConnections, [firstConnectionId, secondConnectionId, secondConnectionId]);
  assert.deepEqual(releasedPeers, [peerId, peerId]);
});

test("durable peer generation allocation fails closed at Number.MAX_SAFE_INTEGER", async () => {
  const sessionId = "session_generation_exhausted_001";
  const peerId = "player_generation_exhausted_001";
  const installedConnections: string[] = [];
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network: {} as RustNetworkRuntimeServiceV1,
    lifecycle: {
      async installPeerGrant(grant: { connectionId: string }) { installedConnections.push(grant.connectionId); },
      async releasePeer() {},
    } as unknown as RustIntegratedNetworkRuntimePortV1,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "a".repeat(32),
    generatorHash: "b".repeat(32),
    now: () => 1_000,
  });
  const finalConnectionId = "invite_generation_exhausted_final";
  await authority.installPeer(durablePosePeer(sessionId, peerId, finalConnectionId, Number.MAX_SAFE_INTEGER));
  assert.equal(await authority.releasePeer({
    sessionId,
    peerId,
    connectionId: finalConnectionId,
    connectionGeneration: Number.MAX_SAFE_INTEGER,
  }), "released");
  await assert.rejects(
    authority.installPeer(durablePosePeer(sessionId, peerId, "invite_generation_exhausted_overflow", 1)),
    /generation space is exhausted/u,
  );
  assert.deepEqual(installedConnections, [finalConnectionId], "overflow is rejected before a native lifecycle grant is installed");
});

test("durable peer lifecycle history is bounded without blocking an existing peer refresh", async () => {
  let nativeInstalls = 0;
  const authority = new IntegratedRustMultiplayerAuthorityV1({
    network: {} as RustNetworkRuntimeServiceV1,
    lifecycle: {
      async installPeerGrant() { nativeInstalls += 1; },
    } as unknown as RustIntegratedNetworkRuntimePortV1,
    identity: () => identity,
    engineVersion: "1.12.0",
    contentHash: "c".repeat(32),
    generatorHash: "d".repeat(32),
    now: () => 1_000,
  });
  const sessionId = "session_peer_capacity_001";
  for (let index = 0; index < RUST_MULTIPLAYER_MAX_DURABLE_PEER_LIFECYCLES_V1; index += 1) {
    await authority.installPeer(durablePosePeer(
      sessionId,
      `player_peer_capacity_${index}`,
      `invite_peer_capacity_${index}`,
      1,
    ));
  }
  assert.equal(nativeInstalls, RUST_MULTIPLAYER_MAX_DURABLE_PEER_LIFECYCLES_V1);

  const firstPeer = durablePosePeer(
    sessionId,
    "player_peer_capacity_0",
    "invite_peer_capacity_0",
    1,
  );
  const refresh = await authority.installPeer(firstPeer);
  assert.equal(refresh.status, "installed", "the cap preserves lifecycle operations for an already-retained peer");
  assert.equal(nativeInstalls, RUST_MULTIPLAYER_MAX_DURABLE_PEER_LIFECYCLES_V1 + 1);

  await assert.rejects(
    authority.installPeer(durablePosePeer(
      sessionId,
      "player_peer_capacity_overflow",
      "invite_peer_capacity_overflow",
      1,
    )),
    (error: unknown) => error instanceof RustNetworkRuntimeContractError && error.code === "peer-capacity",
  );
  assert.equal(
    nativeInstalls,
    RUST_MULTIPLAYER_MAX_DURABLE_PEER_LIFECYCLES_V1 + 1,
    "a new unique peer is rejected before native lifecycle state can grow",
  );
});
