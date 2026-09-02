import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createNetworkAuthorityIdentityV1,
  createNetworkDeltaV1,
  createNetworkInterestSetV1,
  type NetworkPeerGrantV1,
} from "../app/game/network-authority-contract.ts";
import {
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import {
  decodeRustIntegratedNetworkAcknowledgementV1,
  decodeRustIntegratedNetworkCommandReleaseV1,
  decodeRustIntegratedNetworkDeltaBuildResponseV1,
  decodeRustIntegratedNetworkReconnectResponseV1,
  encodeRustIntegratedNetworkAgentGrantV1,
  encodeRustIntegratedNetworkCommandReleaseV1,
  encodeRustIntegratedNetworkDeltaBuildV1,
  encodeRustIntegratedNetworkPeerGrantV1,
  encodeRustIntegratedNetworkPeerReleaseV1,
  encodeRustIntegratedNetworkReconnectV1,
  encodeRustIntegratedNetworkReplicationRecordV1,
  type RustIntegratedNetworkAgentGrantV1,
  type RustIntegratedNetworkDeltaBuildRequestV1,
  type RustIntegratedScopedDeltaRecordV1,
} from "../app/game/rust-integrated-runtime-network-lifecycle.ts";
import {
  decodeRustNetworkRequestV1,
  decodeRustNetworkResponseV1,
  encodeRustNetworkAgentRequestV1,
  encodeRustNetworkCommandBatchRequestV1,
  encodeRustNetworkDeltaDeliveryRequestV1,
  encodeRustNetworkGuestPoseRequestV1,
  encodeRustNetworkHandshakeRequestV1,
  encodeRustNetworkResponseV1,
} from "../app/game/rust-network-runtime-contract.ts";
import {
  decodeNetworkCommandWireV1,
  decodeNetworkDeltaWireV1,
  decodeNetworkReconnectCheckpointWireV1,
  encodeNetworkCommandWireV1,
  encodeNetworkDeltaWireV1,
  encodeNetworkReconnectCheckpointWireV1,
} from "../app/game/rust-network-wire-v1.ts";
import {
  decodeRustNetworkPlayerPoseV1,
  encodeRustNetworkPlayerPoseV1,
} from "../app/game/rust-network-player-pose-v1.ts";
import {
  decodeRustNetworkAgentWorkCommandV1,
  encodeRustNetworkAgentWorkCommandV1,
} from "../app/game/rust-network-agent-work-v1.ts";

type NativeResponseFixture = Readonly<{
  hex: string;
  scopeProbes?: number;
  candidateRecords?: number;
  emittedRecords?: number;
  deltaPacketHex?: string;
  checkpointPacketHex?: string;
}>;

type R9Fixture = Readonly<{
  schema: string;
  producer: string;
  wasmDispatchExercised: boolean;
  wasmDispatchFamilies: readonly string[];
  wasmDispatchEvidence: string;
  browserRequestKindsCovered: readonly string[];
  uncoveredBrowserRequestKinds: readonly string[];
  browserCoverageBoundary: string;
  publicTypeScriptNestedCodecGaps: readonly string[];
  requests: Readonly<Record<
    "peerGrant" | "agentGrant" | "replicationRecord" | "deltaBuild" | "reconnect" | "peerRelease" | "commandRelease",
    string
  >>;
  nativeResponses: Readonly<{
    deltaBuild: NativeResponseFixture;
    reconnectPresent: NativeResponseFixture;
    reconnectAbsent: NativeResponseFixture;
  }>;
  browserHandshake: Readonly<{
    outerRequestHex: string;
    nestedHostBwn1Hex: string;
    nestedPeerBwn1Hex: string;
  }>;
  browserCommandBatch: Readonly<{
    outerRequestHex: string;
    nestedCommandBwn1Hex: string;
  }>;
  browserDeltaDelivery: Readonly<{
    outerRequestHex: string;
    nestedCheckpointBwn1Hex: string;
    nestedDeltaBwn1Hex: string;
  }>;
  browserAgentCommand: Readonly<{
    outerRequestHex: string;
    nestedEnvelopeBwn1Hex: string;
    nestedWorkBwa1Hex: string;
  }>;
  browserGuestPose: Readonly<{
    outerRequestHex: string;
    nestedCommandBwn1Hex: string;
    nestedPoseBwnpHex: string;
  }>;
  wasmDispatchReceipts: Readonly<Record<
    | "peerGrant"
    | "agentGrant"
    | "replicationRecord"
    | "deltaBuild"
    | "reconnect"
    | "replicationRemove"
    | "commandRelease"
    | "peerRelease"
    | "browserHandshake"
    | "browserCommandBatch"
    | "browserDeltaDelivery"
    | "browserAgentCommand"
    | "browserGuestPose",
    string
  >>;
}>;

const WASM_DISPATCH_FAMILIES = [
  "peerGrant",
  "agentGrant",
  "replicationRecord",
  "deltaBuild",
  "reconnect",
  "replicationRemove",
  "commandRelease",
  "peerRelease",
  "browserRequest",
] as const;

const BROWSER_REQUEST_KINDS = [
  "handshake",
  "command-batch",
  "delta-delivery",
  "agent-command",
  "guest-pose",
] as const;

const FIXTURE = JSON.parse(readFileSync(
  new URL("./fixtures/rust-engine/integrated-runtime-v1/r9-network-wire-fixture.json", import.meta.url),
  "utf8",
)) as R9Fixture;
const encoder = new TextEncoder();

function fromHex(value: string) {
  assert.match(value, /^(?:[0-9a-f]{2})+$/u);
  return Uint8Array.from({ length: value.length / 2 }, (_, index) => (
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  ));
}

function toHex(value: Uint8Array) {
  return Buffer.from(value).toString("hex");
}

function concat(...parts: readonly Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function encodeDecodedDeltaResponse(value: ReturnType<typeof decodeRustIntegratedNetworkDeltaBuildResponseV1>) {
  return concat(
    encoder.encode("BWH9"),
    u16(1),
    u32(value.scopeProbes),
    u32(value.candidateRecords),
    u32(value.emittedRecords),
    u32(value.deltaPacket.byteLength),
    value.deltaPacket,
  );
}

function encodeDecodedReconnectResponse(packet: Uint8Array | null) {
  return packet === null
    ? concat(encoder.encode("BWC9"), u16(1), Uint8Array.of(0))
    : concat(encoder.encode("BWC9"), u16(1), Uint8Array.of(1), u32(packet.byteLength), packet);
}

function authoredValues() {
  const address = Object.freeze({ universeId: "universe:雪:🦀", locationId: "cavern:Ω:🌿" });
  const interest = createNetworkInterestSetV1({
    sequence: Number.MAX_SAFE_INTEGER,
    chunks: [
      { ...address, chunkX: -2_147_483_648, chunkZ: 2_147_483_647 },
      { ...address, chunkX: -1, chunkZ: 1 },
    ],
    entityIds: ["entity:雪:🦀", "entity:𐀀:Ω"],
  });
  const peerGrant: NetworkPeerGrantV1 = Object.freeze({
    sessionId: "session:雪:🦀",
    peerId: "peer:é:🧭",
    connectionId: "connection:Ω:🌿",
    actorId: "actor:龍:🤖",
    peerKind: "agent",
    role: "guest",
    capabilities: Object.freeze([
      "observe", "chat", "interact", "inventory", "build", "combat", "creature-care", "trade", "travel", "agent-work",
    ] as const),
    expiresAt: Number.MAX_SAFE_INTEGER,
    nextSequence: Number.MAX_SAFE_INTEGER - 1,
    interest,
  });
  const agentGrant: RustIntegratedNetworkAgentGrantV1 = Object.freeze({
    agentId: "agent:雪:🤖",
    peerId: peerGrant.peerId,
    connectionId: peerGrant.connectionId,
    status: "paused",
    requested: Object.freeze([
      "observe.world", "move.self", "interact.basic", "inventory.self.read", "inventory.self.write",
      "container.read", "container.write", "player.location.read", "player.inventory.read", "build",
      "harvest", "chat.send", "voice.send", "diagnostics", "world.admin",
    ] as const),
    granted: Object.freeze(["observe.world", "inventory.self.read", "build", "diagnostics"] as const),
    expiresAt: Number.MAX_SAFE_INTEGER,
  });
  const from = createNetworkAuthorityIdentityV1(address, {
    epoch: Number.MAX_SAFE_INTEGER - 10,
    world: Number.MAX_SAFE_INTEGER - 9,
    entities: Number.MAX_SAFE_INTEGER - 8,
    gameplay: Number.MAX_SAFE_INTEGER - 7,
    persistence: Number.MAX_SAFE_INTEGER - 6,
  });
  const to = createNetworkAuthorityIdentityV1(address, {
    epoch: Number.MAX_SAFE_INTEGER - 10,
    world: Number.MAX_SAFE_INTEGER - 8,
    entities: Number.MAX_SAFE_INTEGER - 7,
    gameplay: Number.MAX_SAFE_INTEGER - 6,
    persistence: Number.MAX_SAFE_INTEGER - 5,
  });
  const payload = concat(Uint8Array.of(0, 0x7f, 0x80, 0xff), encoder.encode("payload:雪:🦀"));
  const delta = createNetworkDeltaV1({
    sessionId: peerGrant.sessionId,
    deltaId: "delta:雪:🦀",
    peerId: peerGrant.peerId,
    keyframe: true,
    sequence: Number.MAX_SAFE_INTEGER - 2,
    acknowledgedCommandSequence: Number.MAX_SAFE_INTEGER - 3,
    from,
    to,
    interestHash: interest.interestHash,
    records: [{ kind: "agent", recordId: "record:雪:🦀", revision: Number.MAX_SAFE_INTEGER, payload }],
  });
  const replicationRecord = Object.freeze({
    scope: Object.freeze({
      kind: "chunk" as const,
      ...address,
      chunkX: -2_147_483_648,
      chunkZ: 2_147_483_647,
    }),
    record: delta.records[0],
  }) satisfies RustIntegratedScopedDeltaRecordV1;
  const deltaBuild = Object.freeze({
    sessionId: peerGrant.sessionId,
    deltaId: delta.deltaId,
    peerId: peerGrant.peerId,
    keyframe: true,
    sequence: delta.sequence,
    acknowledgedCommandSequence: delta.acknowledgedCommandSequence,
    from,
    to,
    interest,
  }) satisfies RustIntegratedNetworkDeltaBuildRequestV1;
  return { peerGrant, agentGrant, replicationRecord, deltaBuild };
}

test("Rust-authored R9 lifecycle request fixtures exactly match every normal-path TypeScript encoder", () => {
  assert.equal(FIXTURE.schema, "blockwild.integrated-network-r9-wire-fixture.v1");
  assert.equal(FIXTURE.producer, "blockwild-engine");
  assert.equal(FIXTURE.wasmDispatchExercised, true);
  assert.deepEqual(FIXTURE.wasmDispatchFamilies, WASM_DISPATCH_FAMILIES);
  assert.equal(
    FIXTURE.wasmDispatchEvidence,
    "blockwild-wasm::integrated_runtime::tests::checked_r9_network_requests_cross_real_bwrq_bwrs_dispatch",
  );
  assert.deepEqual(FIXTURE.browserRequestKindsCovered, BROWSER_REQUEST_KINDS);
  assert.deepEqual(FIXTURE.uncoveredBrowserRequestKinds, []);
  assert.match(FIXTURE.browserCoverageBoundary, /outcome matrix.*formal migration authority/u);
  assert.deepEqual(FIXTURE.publicTypeScriptNestedCodecGaps, []);

  const { peerGrant, agentGrant, replicationRecord, deltaBuild } = authoredValues();
  const actual = {
    peerGrant: encodeRustIntegratedNetworkPeerGrantV1(peerGrant),
    agentGrant: encodeRustIntegratedNetworkAgentGrantV1(agentGrant),
    replicationRecord: encodeRustIntegratedNetworkReplicationRecordV1(replicationRecord),
    deltaBuild: encodeRustIntegratedNetworkDeltaBuildV1(deltaBuild),
    reconnect: encodeRustIntegratedNetworkReconnectV1(
      peerGrant.sessionId,
      peerGrant.peerId,
      Number.MAX_SAFE_INTEGER,
    ),
    peerRelease: encodeRustIntegratedNetworkPeerReleaseV1(peerGrant.peerId),
    commandRelease: encodeRustIntegratedNetworkCommandReleaseV1("command:雪:🦀"),
  };
  for (const [name, packet] of Object.entries(actual)) {
    assert.equal(toHex(packet), FIXTURE.requests[name as keyof typeof FIXTURE.requests], `${name} native bytes`);
  }
  assert.equal(decodeRustIntegratedNetworkCommandReleaseV1(actual.commandRelease), "command:雪:🦀");
});

test("native BWH9 and BWC9 responses decode and independently re-encode exactly in TypeScript", () => {
  const deltaFixture = FIXTURE.nativeResponses.deltaBuild;
  const decodedDelta = decodeRustIntegratedNetworkDeltaBuildResponseV1(fromHex(deltaFixture.hex));
  assert.deepEqual(
    {
      scopeProbes: decodedDelta.scopeProbes,
      candidateRecords: decodedDelta.candidateRecords,
      emittedRecords: decodedDelta.emittedRecords,
      deltaPacketHex: toHex(decodedDelta.deltaPacket),
    },
    {
      scopeProbes: deltaFixture.scopeProbes,
      candidateRecords: deltaFixture.candidateRecords,
      emittedRecords: deltaFixture.emittedRecords,
      deltaPacketHex: deltaFixture.deltaPacketHex,
    },
  );
  assert.equal(toHex(encodeDecodedDeltaResponse(decodedDelta)), deltaFixture.hex);

  const presentFixture = FIXTURE.nativeResponses.reconnectPresent;
  const present = decodeRustIntegratedNetworkReconnectResponseV1(fromHex(presentFixture.hex));
  assert.ok(present);
  assert.equal(toHex(present), presentFixture.checkpointPacketHex);
  assert.equal(toHex(encodeDecodedReconnectResponse(present)), presentFixture.hex);

  const absentFixture = FIXTURE.nativeResponses.reconnectAbsent;
  const absent = decodeRustIntegratedNetworkReconnectResponseV1(fromHex(absentFixture.hex));
  assert.equal(absent, null);
  assert.equal(toHex(encodeDecodedReconnectResponse(absent)), absentFixture.hex);
});

test("checked Wasm lifecycle dispatch receipts retain exact generated-schema acknowledgements and responses", () => {
  const acknowledgements = [
    { receipt: "peerGrant", family: "peer-grant", request: "peerGrant", magic: "BWP9" },
    { receipt: "agentGrant", family: "agent-grant", request: "agentGrant", magic: "BWJ9" },
    { receipt: "replicationRecord", family: "replication-upsert", request: "replicationRecord", magic: "BWI9" },
    { receipt: "replicationRemove", family: "replication-remove", request: "replicationRecord", magic: "BWR9" },
    { receipt: "commandRelease", family: "command-release", request: "commandRelease", magic: "BWM9" },
    { receipt: "peerRelease", family: "peer-release", request: "peerRelease", magic: "BWL9" },
  ] as const;
  for (const vector of acknowledgements) {
    const receipt = fromHex(FIXTURE.wasmDispatchReceipts[vector.receipt]);
    assert.equal(receipt.byteLength, 38, `${vector.family} acknowledgement length`);
    assert.equal(new TextDecoder().decode(receipt.subarray(0, 4)), vector.magic);
    assert.equal(new DataView(receipt.buffer, receipt.byteOffset, receipt.byteLength).getUint16(4, true), 1);
    const decoded = decodeRustIntegratedNetworkAcknowledgementV1(vector.family, receipt);
    assert.equal(
      decoded.requestPayloadHash,
      rustIntegratedRuntimeWireChecksumV1(fromHex(FIXTURE.requests[vector.request])),
      `${vector.family} request correlation hash`,
    );
    assert.equal(decoded.resultingRuntimeStateHash, toHex(receipt.subarray(22)));
  }

  const dispatchedDelta = decodeRustIntegratedNetworkDeltaBuildResponseV1(
    fromHex(FIXTURE.wasmDispatchReceipts.deltaBuild),
  );
  assert.deepEqual(
    {
      scopeProbes: dispatchedDelta.scopeProbes,
      candidateRecords: dispatchedDelta.candidateRecords,
      emittedRecords: dispatchedDelta.emittedRecords,
    },
    { scopeProbes: 6, candidateRecords: 1, emittedRecords: 1 },
  );
  assert.equal(toHex(dispatchedDelta.deltaPacket), FIXTURE.nativeResponses.deltaBuild.deltaPacketHex);
  assert.equal(
    toHex(encodeDecodedDeltaResponse(dispatchedDelta)),
    FIXTURE.wasmDispatchReceipts.deltaBuild,
  );

  const dispatchedReconnect = decodeRustIntegratedNetworkReconnectResponseV1(
    fromHex(FIXTURE.wasmDispatchReceipts.reconnect),
  );
  assert.equal(dispatchedReconnect, null);
  assert.equal(FIXTURE.wasmDispatchReceipts.reconnect, FIXTURE.nativeResponses.reconnectAbsent.hex);
  assert.equal(
    toHex(encodeDecodedReconnectResponse(dispatchedReconnect)),
    FIXTURE.wasmDispatchReceipts.reconnect,
  );
});

test("complete outer BWRN handshake crosses Wasm while nested BWN1 packets remain distinct", () => {
  const outerRequest = fromHex(FIXTURE.browserHandshake.outerRequestHex);
  const nestedHost = fromHex(FIXTURE.browserHandshake.nestedHostBwn1Hex);
  const nestedPeer = fromHex(FIXTURE.browserHandshake.nestedPeerBwn1Hex);
  assert.equal(new TextDecoder().decode(outerRequest.subarray(0, 4)), "BWRN");
  assert.equal(new TextDecoder().decode(nestedHost.subarray(0, 4)), "BWN1");
  assert.equal(new TextDecoder().decode(nestedPeer.subarray(0, 4)), "BWN1");

  const decodedRequest = decodeRustNetworkRequestV1(outerRequest);
  assert.equal(decodedRequest.kind, "handshake");
  if (decodedRequest.kind !== "handshake") return;
  assert.equal(decodedRequest.requestId, Number.MAX_SAFE_INTEGER - 4);
  assert.equal(toHex(decodedRequest.hostPacket), FIXTURE.browserHandshake.nestedHostBwn1Hex);
  assert.equal(toHex(decodedRequest.peerPacket), FIXTURE.browserHandshake.nestedPeerBwn1Hex);
  assert.equal(
    toHex(encodeRustNetworkHandshakeRequestV1(
      decodedRequest.requestId,
      decodedRequest.hostPacket,
      decodedRequest.peerPacket,
    )),
    FIXTURE.browserHandshake.outerRequestHex,
  );

  const responseBytes = fromHex(FIXTURE.wasmDispatchReceipts.browserHandshake);
  assert.equal(new TextDecoder().decode(responseBytes.subarray(0, 4)), "BWNA");
  const response = decodeRustNetworkResponseV1(responseBytes);
  assert.deepEqual(response, {
    kind: "handshake",
    requestId: Number.MAX_SAFE_INTEGER - 4,
    compatible: true,
    code: "ok",
    capabilities: ["observe", "chat", "interact"],
    maxCommandBytes: 131_072,
    message: "Peer may join through host Rust authority.",
    recordHash: "be615ac1c091c295c036d7f154fe7abc",
  });
  assert.equal(toHex(encodeRustNetworkResponseV1(response)), FIXTURE.wasmDispatchReceipts.browserHandshake);

  const checksumTamper = Uint8Array.from(outerRequest);
  checksumTamper[checksumTamper.length - 1] ^= 1;
  assert.throws(() => decodeRustNetworkRequestV1(checksumTamper), /checksum/u);
});

test("every remaining nested browser kind crosses real Wasm dispatch with exact BWRN and BWNA bytes", () => {
  const commandBatchBytes = fromHex(FIXTURE.browserCommandBatch.outerRequestHex);
  const commandBatch = decodeRustNetworkRequestV1(commandBatchBytes);
  assert.equal(commandBatch.kind, "command-batch");
  if (commandBatch.kind !== "command-batch") return;
  assert.equal(commandBatch.requestId, Number.MAX_SAFE_INTEGER - 5);
  assert.equal(commandBatch.now, 100);
  assert.equal(commandBatch.commandPackets.length, 1);
  assert.equal(toHex(commandBatch.commandPackets[0]), FIXTURE.browserCommandBatch.nestedCommandBwn1Hex);
  const command = decodeNetworkCommandWireV1(commandBatch.commandPackets[0]);
  assert.equal(command.commandId, "cmd-human-1");
  assert.equal(toHex(encodeNetworkCommandWireV1(command)), FIXTURE.browserCommandBatch.nestedCommandBwn1Hex);
  assert.equal(
    toHex(encodeRustNetworkCommandBatchRequestV1(
      commandBatch.requestId,
      commandBatch.current,
      commandBatch.now,
      commandBatch.commandPackets,
    )),
    FIXTURE.browserCommandBatch.outerRequestHex,
  );

  const deltaDeliveryBytes = fromHex(FIXTURE.browserDeltaDelivery.outerRequestHex);
  const deltaDelivery = decodeRustNetworkRequestV1(deltaDeliveryBytes);
  assert.equal(deltaDelivery.kind, "delta-delivery");
  if (deltaDelivery.kind !== "delta-delivery") return;
  assert.equal(deltaDelivery.requestId, Number.MAX_SAFE_INTEGER - 6);
  assert.equal(toHex(deltaDelivery.checkpointPacket), FIXTURE.browserDeltaDelivery.nestedCheckpointBwn1Hex);
  assert.equal(toHex(deltaDelivery.deltaPacket), FIXTURE.browserDeltaDelivery.nestedDeltaBwn1Hex);
  const checkpoint = decodeNetworkReconnectCheckpointWireV1(deltaDelivery.checkpointPacket);
  const delta = decodeNetworkDeltaWireV1(deltaDelivery.deltaPacket);
  assert.equal(checkpoint.connectionGeneration, 7);
  assert.equal(delta.keyframe, true);
  assert.equal(delta.sequence, 1);
  assert.equal(
    toHex(encodeNetworkReconnectCheckpointWireV1(checkpoint)),
    FIXTURE.browserDeltaDelivery.nestedCheckpointBwn1Hex,
  );
  assert.equal(toHex(encodeNetworkDeltaWireV1(delta)), FIXTURE.browserDeltaDelivery.nestedDeltaBwn1Hex);
  assert.equal(
    toHex(encodeRustNetworkDeltaDeliveryRequestV1(
      deltaDelivery.requestId,
      deltaDelivery.checkpointPacket,
      deltaDelivery.interest,
      deltaDelivery.deltaPacket,
    )),
    FIXTURE.browserDeltaDelivery.outerRequestHex,
  );

  const agentCommandBytes = fromHex(FIXTURE.browserAgentCommand.outerRequestHex);
  const agentCommand = decodeRustNetworkRequestV1(agentCommandBytes);
  assert.equal(agentCommand.kind, "agent-command");
  if (agentCommand.kind !== "agent-command") return;
  assert.equal(agentCommand.requestId, Number.MAX_SAFE_INTEGER - 7);
  assert.equal(agentCommand.now, 1_100);
  assert.equal(toHex(agentCommand.envelopePacket), FIXTURE.browserAgentCommand.nestedEnvelopeBwn1Hex);
  assert.equal(toHex(agentCommand.workPacket), FIXTURE.browserAgentCommand.nestedWorkBwa1Hex);
  assert.equal(new TextDecoder().decode(agentCommand.workPacket.subarray(0, 4)), "BWA1");
  const agentWork = decodeRustNetworkAgentWorkCommandV1(agentCommand.workPacket);
  assert.deepEqual(
    {
      commandId: agentWork.commandId,
      agentId: agentWork.agentId,
      kind: agentWork.kind,
      expectedWorldRevision: agentWork.expectedWorldRevision,
      issuedAt: agentWork.issuedAt,
      expiresAt: agentWork.expiresAt,
      workUnits: agentWork.workUnits,
      taskId: agentWork.taskId,
      arguments: new TextDecoder().decode(agentWork.arguments),
    },
    {
      commandId: "cmd-agent-1",
      agentId: "agent:field-drone-1",
      kind: "harvest_area",
      expectedWorldRevision: 41,
      issuedAt: 1_100,
      expiresAt: 10_100,
      workUnits: 12,
      taskId: "task:harvest-1",
      arguments: "radius=8;resource=frostpine",
    },
  );
  assert.equal(
    toHex(encodeRustNetworkAgentWorkCommandV1(agentWork)),
    FIXTURE.browserAgentCommand.nestedWorkBwa1Hex,
  );
  const agentEnvelope = decodeNetworkCommandWireV1(agentCommand.envelopePacket);
  assert.equal(agentEnvelope.commandId, "cmd-agent-1");
  assert.equal(
    toHex(encodeNetworkCommandWireV1(agentEnvelope)),
    FIXTURE.browserAgentCommand.nestedEnvelopeBwn1Hex,
  );
  assert.equal(
    toHex(encodeRustNetworkAgentRequestV1(
      agentCommand.requestId,
      agentCommand.current,
      agentCommand.now,
      agentCommand.envelopePacket,
      agentCommand.workPacket,
    )),
    FIXTURE.browserAgentCommand.outerRequestHex,
  );

  const guestPoseBytes = fromHex(FIXTURE.browserGuestPose.outerRequestHex);
  const guestPose = decodeRustNetworkRequestV1(guestPoseBytes);
  assert.equal(guestPose.kind, "guest-pose");
  if (guestPose.kind !== "guest-pose") return;
  assert.equal(guestPose.requestId, Number.MAX_SAFE_INTEGER - 8);
  assert.equal(guestPose.now, 1_000);
  assert.equal(toHex(guestPose.commandPacket), FIXTURE.browserGuestPose.nestedCommandBwn1Hex);
  const poseCommand = decodeNetworkCommandWireV1(guestPose.commandPacket);
  assert.equal(poseCommand.kind, "pose");
  assert.equal(toHex(poseCommand.payload), FIXTURE.browserGuestPose.nestedPoseBwnpHex);
  const pose = decodeRustNetworkPlayerPoseV1(poseCommand.payload);
  assert.deepEqual(
    { playerId: pose.playerId, tick: pose.tick, x: pose.x, action: pose.action, mountedCreatureId: pose.mountedCreatureId },
    { playerId: "peer-1", tick: 42, x: 12.387, action: "mine", mountedCreatureId: 42 },
  );
  assert.equal(toHex(encodeRustNetworkPlayerPoseV1(pose)), FIXTURE.browserGuestPose.nestedPoseBwnpHex);
  assert.equal(toHex(encodeNetworkCommandWireV1(poseCommand)), FIXTURE.browserGuestPose.nestedCommandBwn1Hex);
  assert.equal(
    toHex(encodeRustNetworkGuestPoseRequestV1(
      guestPose.requestId,
      guestPose.current,
      guestPose.now,
      guestPose.commandPacket,
    )),
    FIXTURE.browserGuestPose.outerRequestHex,
  );

  const responseVectors = [
    ["browserCommandBatch", Number.MAX_SAFE_INTEGER - 5],
    ["browserDeltaDelivery", Number.MAX_SAFE_INTEGER - 6],
    ["browserAgentCommand", Number.MAX_SAFE_INTEGER - 7],
    ["browserGuestPose", Number.MAX_SAFE_INTEGER - 8],
  ] as const;
  for (const [field, requestId] of responseVectors) {
    const responseBytes = fromHex(FIXTURE.wasmDispatchReceipts[field]);
    assert.equal(new TextDecoder().decode(responseBytes.subarray(0, 4)), "BWNA");
    const response = decodeRustNetworkResponseV1(responseBytes);
    assert.equal(response.requestId, requestId);
    assert.equal(toHex(encodeRustNetworkResponseV1(response)), FIXTURE.wasmDispatchReceipts[field]);
  }

  const commandResponse = decodeRustNetworkResponseV1(
    fromHex(FIXTURE.wasmDispatchReceipts.browserCommandBatch),
  );
  assert.equal(commandResponse.kind, "command-batch");
  if (commandResponse.kind !== "command-batch") return;
  assert.equal(commandResponse.receipts.length, 1);
  assert.equal(commandResponse.receipts[0].status, "accepted");

  const deltaResponse = decodeRustNetworkResponseV1(
    fromHex(FIXTURE.wasmDispatchReceipts.browserDeltaDelivery),
  );
  assert.equal(deltaResponse.kind, "delta-delivery");
  if (deltaResponse.kind !== "delta-delivery") return;
  assert.deepEqual(
    { code: deltaResponse.code, sequence: deltaResponse.sequence, message: deltaResponse.message },
    { code: "applied", sequence: 1, message: "Delta applied atomically by the Rust receiver." },
  );

  const agentResponse = decodeRustNetworkResponseV1(
    fromHex(FIXTURE.wasmDispatchReceipts.browserAgentCommand),
  );
  assert.equal(agentResponse.kind, "agent-command");
  if (agentResponse.kind !== "agent-command") return;
  assert.equal(agentResponse.code, "accepted");
  assert.equal(agentResponse.receipt?.status, "accepted");

  const poseResponse = decodeRustNetworkResponseV1(
    fromHex(FIXTURE.wasmDispatchReceipts.browserGuestPose),
  );
  assert.equal(poseResponse.kind, "guest-pose");
  if (poseResponse.kind !== "guest-pose") return;
  assert.equal(poseResponse.receipt.status, "accepted");
  assert.ok(poseResponse.projection);
  assert.deepEqual(
    {
      peerId: poseResponse.projection.peerId,
      playerId: poseResponse.projection.playerId,
      commandId: poseResponse.projection.commandId,
      presentedDeltaSequence: poseResponse.projection.presentedDeltaSequence,
      recordRevision: poseResponse.projection.recordRevision,
      previousRecordHash: poseResponse.projection.previousRecordHash,
      tick: poseResponse.projection.pose.tick,
    },
    {
      peerId: "peer-1",
      playerId: "peer-1",
      commandId: "pose:fixture:42",
      presentedDeltaSequence: 0,
      recordRevision: 1,
      previousRecordHash: "00000000000000000000000000000000",
      tick: 42,
    },
  );

  for (const bytes of [commandBatchBytes, deltaDeliveryBytes, agentCommandBytes, guestPoseBytes]) {
    const checksumTamper = Uint8Array.from(bytes);
    checksumTamper[checksumTamper.length - 1] ^= 1;
    assert.throws(() => decodeRustNetworkRequestV1(checksumTamper), /checksum/u);
  }
});

test("R9 lifecycle packets fail closed on checksum, trailing bytes, unknown tags, and unsafe u64 values", () => {
  const commandRelease = fromHex(FIXTURE.requests.commandRelease);
  const checksumTamper = Uint8Array.from(commandRelease);
  checksumTamper[checksumTamper.length - 1] ^= 1;
  assert.throws(
    () => decodeRustIntegratedNetworkCommandReleaseV1(checksumTamper),
    /checksum mismatch/u,
  );
  assert.throws(
    () => decodeRustIntegratedNetworkCommandReleaseV1(concat(commandRelease, Uint8Array.of(0))),
    /trailing bytes/u,
  );

  const { peerGrant, agentGrant, replicationRecord } = authoredValues();
  assert.throws(
    () => encodeRustIntegratedNetworkPeerGrantV1({
      ...peerGrant,
      capabilities: ["unknown-network-capability"],
    } as unknown as NetworkPeerGrantV1),
    /unknown network capability/u,
  );
  assert.throws(
    () => encodeRustIntegratedNetworkAgentGrantV1({
      ...agentGrant,
      requested: ["unknown-agent-capability"],
    } as unknown as RustIntegratedNetworkAgentGrantV1),
    /unknown agent capability/u,
  );
  assert.throws(
    () => encodeRustIntegratedNetworkReplicationRecordV1({
      ...replicationRecord,
      record: { ...replicationRecord.record, kind: "unknown-record-kind" },
    } as unknown as RustIntegratedScopedDeltaRecordV1),
    /unknown integrated network record kind/u,
  );
  assert.throws(
    () => encodeRustIntegratedNetworkReconnectV1("session", "peer", Number.MAX_SAFE_INTEGER + 1),
    /outside JavaScript's exact range/u,
  );

  const invalidReconnectFlag = fromHex(FIXTURE.nativeResponses.reconnectAbsent.hex);
  invalidReconnectFlag[6] = 2;
  assert.throws(
    () => decodeRustIntegratedNetworkReconnectResponseV1(invalidReconnectFlag),
    /flag is invalid/u,
  );
  assert.throws(
    () => decodeRustIntegratedNetworkDeltaBuildResponseV1(concat(
      fromHex(FIXTURE.nativeResponses.deltaBuild.hex),
      Uint8Array.of(0),
    )),
    /trailing bytes/u,
  );
});

test("fixture covers all nine outer R9 branches and one accepted vector for every nested browser kind", () => {
  assert.equal(FIXTURE.wasmDispatchExercised, true);
  assert.deepEqual(FIXTURE.wasmDispatchFamilies, WASM_DISPATCH_FAMILIES);
  assert.deepEqual(FIXTURE.browserRequestKindsCovered, BROWSER_REQUEST_KINDS);
  assert.deepEqual(FIXTURE.uncoveredBrowserRequestKinds, []);
  assert.match(FIXTURE.browserCoverageBoundary, /broader outcome matrix/u);
  assert.deepEqual(FIXTURE.publicTypeScriptNestedCodecGaps, []);
});
