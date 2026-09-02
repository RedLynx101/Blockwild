import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NETWORK_MAX_COMMAND_BYTES_V1,
  createNetworkAuthorityIdentityV1,
  createNetworkCommandV1,
  createNetworkDeltaV1,
  createNetworkHandshakeV1,
  createNetworkInterestSetV1,
  createNetworkReconnectCheckpointV1,
} from "../app/game/network-authority-contract.ts";
import {
  NETWORK_WIRE_HEADER_BYTES_V1,
  NetworkWireV1Error,
  decodeNetworkCommandWireV1,
  decodeNetworkDeltaWireV1,
  decodeNetworkHandshakeWireV1,
  decodeNetworkReconnectCheckpointWireV1,
  decodeNetworkUtf8PayloadV1,
  encodeNetworkCommandSourceWireV1,
  encodeNetworkCommandWireV1,
  encodeNetworkDeltaWireV1,
  encodeNetworkHandshakeWireV1,
  encodeNetworkReconnectCheckpointWireV1,
  encodeNetworkUtf8PayloadV1,
} from "../app/game/rust-network-wire-v1.ts";

type FixtureSet = Readonly<{ handshake: string; command: string; delta?: string; keyframe?: string; checkpoint: string }>;
type NativeFixture = Readonly<{ rustCrate: string; wire: string; canonical: FixtureSet; highBytesNegativeCoordinates: FixtureSet }>;

const fixture = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/r9-network-wire/native-bwn1-vectors.json", import.meta.url), "utf8")) as NativeFixture;
const HASH_11 = "11".repeat(16);
const HASH_22 = "22".repeat(16);
const HASH_A5 = "a5".repeat(16);

function fromHex(value: string) {
  assert.equal(value.length % 2, 0);
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return output;
}

function toHex(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function i32le(...values: number[]) {
  const output = new Uint8Array(values.length * 4);
  const view = new DataView(output.buffer);
  values.forEach((value, index) => view.setInt32(index * 4, value, true));
  return output;
}

function skipString(view: DataView, cursor: number) {
  return cursor + 2 + view.getUint16(cursor, true);
}

function skipIdentity(view: DataView, cursor: number) {
  cursor = skipString(view, cursor);
  cursor = skipString(view, cursor);
  return cursor + 5 * 8 + 16;
}

function canonicalValues() {
  const address = { universeId: "blockwild", locationId: "overworld" };
  const startingIdentity = createNetworkAuthorityIdentityV1(address, { epoch: 7, world: 41, entities: 12, gameplay: 5, persistence: 3 });
  const nextIdentity = createNetworkAuthorityIdentityV1(address, { ...startingIdentity.revision, gameplay: 6 });
  const interest = createNetworkInterestSetV1({
    sequence: 9,
    chunks: [
      { ...address, chunkX: 1, chunkZ: -2 },
      { ...address, chunkX: 0, chunkZ: -2 },
    ],
    entityIds: ["mob:emberjay:2", "player:peer-1", "mob:emberjay:2"],
  });
  return {
    handshake: createNetworkHandshakeV1({
      sessionId: "session-r9",
      peerId: "host-1",
      peerKind: "human",
      role: "host",
      engineVersion: "1.13.0-rust-r9",
      contentHash: HASH_11,
      generatorHash: HASH_22,
      capabilities: ["chat", "observe", "interact", "agent-work"],
      maxCommandBytes: NETWORK_MAX_COMMAND_BYTES_V1,
    }),
    command: createNetworkCommandV1({
      sessionId: "session-r9",
      commandId: "cmd-human-1",
      idempotencyKey: "idem-human-1",
      peerId: "peer-1",
      connectionId: "conn-human-1",
      actorId: "player:peer-1",
      peerKind: "human",
      kind: "gameplay",
      requiredCapability: "interact",
      sequence: 0,
      expected: startingIdentity,
      expiresAt: 10_000,
      leaseKeys: ["block:blockwild@overworld/1,64,-2"],
      payload: Uint8Array.from([1, 2, 3, 5, 8]),
    }),
    delta: createNetworkDeltaV1({
      sessionId: "session-r9",
      deltaId: "delta-1",
      peerId: "peer-1",
      keyframe: false,
      sequence: 0,
      acknowledgedCommandSequence: 0,
      from: startingIdentity,
      to: nextIdentity,
      interestHash: interest.interestHash,
      records: [{ kind: "player", recordId: "player:peer-1", revision: 6, payload: Uint8Array.from([20, 19, 18]) }],
    }),
    checkpoint: createNetworkReconnectCheckpointV1({
      sessionId: "session-r9",
      peerId: "peer-1",
      connectionGeneration: 2,
      acknowledgedCommandSequence: 0,
      acknowledgedDeltaSequence: 0,
      identity: nextIdentity,
      interestHash: interest.interestHash,
    }),
  };
}

function highByteValues() {
  const address = { universeId: "blockwild-雪", locationId: "cavern-Δ" };
  const identity = createNetworkAuthorityIdentityV1(address, {
    epoch: 9_007_199_254_740_990,
    world: 4_294_967_297,
    entities: 333,
    gameplay: 444,
    persistence: 555,
  });
  const nextIdentity = createNetworkAuthorityIdentityV1(address, { ...identity.revision, entities: 334 });
  const prefix = Uint8Array.from([0x00, 0x80, 0xff]);
  const suffix = new TextEncoder().encode("terrain-雪");
  const payload = new Uint8Array(prefix.length + 12 + suffix.length);
  payload.set(prefix);
  payload.set(i32le(-4096, -73, 8192), prefix.length);
  payload.set(suffix, prefix.length + 12);
  return {
    handshake: createNetworkHandshakeV1({
      sessionId: "session-雪-🧭",
      peerId: "peer-é",
      peerKind: "agent",
      role: "guest",
      engineVersion: "1.13.0-rust-r9-β",
      contentHash: "80".repeat(16),
      generatorHash: "ff".repeat(16),
      capabilities: ["agent-work", "observe", "build"],
      maxCommandBytes: NETWORK_MAX_COMMAND_BYTES_V1,
    }),
    command: createNetworkCommandV1({
      sessionId: "session-雪-🧭",
      commandId: "cmd-负-1",
      idempotencyKey: "idem-🧭-1",
      peerId: "peer-é",
      connectionId: "conn-雪",
      actorId: "agent:探検",
      peerKind: "agent",
      kind: "world",
      requiredCapability: "build",
      sequence: 9_007_199_254_740_989,
      expected: identity,
      expiresAt: 9_007_199_254_740_990,
      leaseKeys: ["chunk:雪/-256,-1024", "chunk:雪/-1,-2"],
      payload,
    }),
    keyframe: createNetworkDeltaV1({
      sessionId: "session-雪-🧭",
      deltaId: "keyframe-雪",
      peerId: "peer-é",
      keyframe: true,
      sequence: 9_007_199_254_740_988,
      acknowledgedCommandSequence: 9_007_199_254_740_987,
      from: identity,
      to: nextIdentity,
      interestHash: HASH_A5,
      records: [
        { kind: "world", recordId: "chunk:-256,-1024", revision: 4_294_967_299, payload },
        { kind: "entity", recordId: "mob:雪豹", revision: 12, payload: Uint8Array.from([0xfe, 0xed, 0x80, 0x00]) },
      ],
    }),
    checkpoint: createNetworkReconnectCheckpointV1({
      sessionId: "session-雪-🧭",
      peerId: "peer-é",
      connectionGeneration: 77,
      acknowledgedCommandSequence: 9_007_199_254_740_987,
      acknowledgedDeltaSequence: 9_007_199_254_740_988,
      identity: nextIdentity,
      interestHash: HASH_A5,
    }),
  };
}

test("BWN1 TypeScript encoders exactly match canonical native Rust frames", () => {
  assert.equal(fixture.rustCrate, "blockwild-network");
  assert.equal(fixture.wire, "BWN1");
  const values = canonicalValues();
  assert.equal(toHex(encodeNetworkHandshakeWireV1(values.handshake)), fixture.canonical.handshake);
  assert.equal(toHex(encodeNetworkCommandWireV1(values.command)), fixture.canonical.command);
  assert.equal(toHex(encodeNetworkDeltaWireV1(values.delta)), fixture.canonical.delta);
  assert.equal(toHex(encodeNetworkReconnectCheckpointWireV1(values.checkpoint)), fixture.canonical.checkpoint);
});

test("native differential includes high-byte UTF-8, safe u64 limits, keyframes, and negative-coordinate payloads", () => {
  const values = highByteValues();
  assert.equal(toHex(encodeNetworkHandshakeWireV1(values.handshake)), fixture.highBytesNegativeCoordinates.handshake);
  assert.equal(toHex(encodeNetworkCommandWireV1(values.command)), fixture.highBytesNegativeCoordinates.command);
  assert.equal(toHex(encodeNetworkDeltaWireV1(values.keyframe)), fixture.highBytesNegativeCoordinates.keyframe);
  assert.equal(toHex(encodeNetworkReconnectCheckpointWireV1(values.checkpoint)), fixture.highBytesNegativeCoordinates.checkpoint);

  const decoded = decodeNetworkCommandWireV1(fromHex(fixture.highBytesNegativeCoordinates.command));
  assert.equal(decoded.sequence, 9_007_199_254_740_989);
  assert.equal(new DataView(decoded.payload.buffer, decoded.payload.byteOffset + 3, 12).getInt32(0, true), -4096);
  assert.equal(new DataView(decoded.payload.buffer, decoded.payload.byteOffset + 3, 12).getInt32(4, true), -73);
  assert.deepEqual(decoded.leaseKeys, ["chunk:雪/-1,-2", "chunk:雪/-256,-1024"]);
});

test("all BWN1 decoders round-trip native Rust frames and preserve opaque buffers", () => {
  const handshake = decodeNetworkHandshakeWireV1(fromHex(fixture.canonical.handshake));
  const command = decodeNetworkCommandWireV1(fromHex(fixture.canonical.command));
  const delta = decodeNetworkDeltaWireV1(fromHex(fixture.canonical.delta!));
  const keyframe = decodeNetworkDeltaWireV1(fromHex(fixture.highBytesNegativeCoordinates.keyframe!));
  const checkpoint = decodeNetworkReconnectCheckpointWireV1(fromHex(fixture.canonical.checkpoint));
  assert.deepEqual(handshake.capabilities, ["observe", "chat", "interact", "agent-work"]);
  assert.deepEqual([...command.payload], [1, 2, 3, 5, 8]);
  assert.equal(delta.keyframe, false);
  assert.equal(keyframe.keyframe, true);
  assert.deepEqual(keyframe.records.map((record) => record.kind), ["entity", "world"]);
  assert.equal(checkpoint.identity.revision.gameplay, 6);
  assert.equal(toHex(encodeNetworkCommandWireV1(command)), fixture.canonical.command);
});

test("source and UTF-8 helpers form a narrow multiplayer-envelope boundary", () => {
  const values = canonicalValues();
  const envelope = JSON.stringify({ t: "block-edit", x: -72, z: -4096, label: "雪" });
  assert.equal(decodeNetworkUtf8PayloadV1(encodeNetworkUtf8PayloadV1(envelope)), envelope);
  const encoded = encodeNetworkCommandSourceWireV1({ ...values.command, commandId: "cmd-wrapper", idempotencyKey: "idem-wrapper", payload: encodeNetworkUtf8PayloadV1(envelope) });
  assert.equal(decodeNetworkCommandWireV1(encoded).commandId, "cmd-wrapper");
});

test("presentation-state appends command-kind tag 7 without renumbering existing kinds", () => {
  const canonical = canonicalValues().command;
  const command = createNetworkCommandV1({
    ...canonical,
    commandId: "cmd-player-state",
    idempotencyKey: "idem-player-state",
    kind: "presentation-state",
    leaseKeys: [],
  });
  const encoded = encodeNetworkCommandWireV1(command);
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  let cursor = NETWORK_WIRE_HEADER_BYTES_V1;
  for (let index = 0; index < 6; index += 1) cursor = skipString(view, cursor);
  assert.equal(encoded[cursor], 0, "the canonical human peer tag remains zero");
  assert.equal(encoded[cursor + 1], 7, "presentation-state is the additive command-kind tag");
  assert.equal(decodeNetworkCommandWireV1(encoded).kind, "presentation-state");
  assert.equal(decodeNetworkCommandWireV1(fromHex(fixture.canonical.command)).kind, "gameplay", "the canonical gameplay tag remains unchanged");
});

test("BWN1 parsing fails closed on framing, tags, UTF-8, u64, hashes, and trailing data", () => {
  const base = fromHex(fixture.canonical.handshake);
  assert.throws(() => decodeNetworkHandshakeWireV1(base.subarray(0, 15)), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "truncated");

  const badMagic = base.slice(); badMagic[0] = 0;
  assert.throws(() => decodeNetworkHandshakeWireV1(badMagic), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "wire-magic");
  const badSchema = base.slice(); new DataView(badSchema.buffer).setUint16(4, 2, true);
  assert.throws(() => decodeNetworkHandshakeWireV1(badSchema), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "schema-mismatch");
  const badType = base.slice(); new DataView(badType.buffer).setUint16(8, 99, true);
  assert.throws(() => decodeNetworkHandshakeWireV1(badType), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "wire-type");
  const flags = base.slice(); new DataView(flags.buffer).setUint16(10, 1, true);
  assert.throws(() => decodeNetworkHandshakeWireV1(flags), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "protocol-mismatch");
  const badLength = base.slice(); new DataView(badLength.buffer).setUint32(12, 1, true);
  assert.throws(() => decodeNetworkHandshakeWireV1(badLength), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "truncated");
  const invalidUtf8 = base.slice(); invalidUtf8[NETWORK_WIRE_HEADER_BYTES_V1 + 2] = 0xff;
  assert.throws(() => decodeNetworkHandshakeWireV1(invalidUtf8), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "invalid-label");
  const invalidPeerKind = base.slice();
  const invalidPeerView = new DataView(invalidPeerKind.buffer);
  let peerKindCursor = skipString(invalidPeerView, NETWORK_WIRE_HEADER_BYTES_V1);
  peerKindCursor = skipString(invalidPeerView, peerKindCursor);
  invalidPeerKind[peerKindCursor] = 17;
  assert.throws(() => decodeNetworkHandshakeWireV1(invalidPeerKind), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "invalid-enum");
  const badHash = base.slice(); badHash[badHash.length - 1] ^= 0xff;
  assert.throws(() => decodeNetworkHandshakeWireV1(badHash), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "hash-mismatch");

  const trailing = new Uint8Array(base.length + 1); trailing.set(base); new DataView(trailing.buffer).setUint32(12, trailing.length - NETWORK_WIRE_HEADER_BYTES_V1, true);
  assert.throws(() => decodeNetworkHandshakeWireV1(trailing), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "trailing-bytes");

  const command = fromHex(fixture.canonical.command);
  let cursor = NETWORK_WIRE_HEADER_BYTES_V1;
  const view = new DataView(command.buffer);
  for (let index = 0; index < 6; index += 1) { const length = view.getUint16(cursor, true); cursor += 2 + length; }
  cursor += 3;
  view.setBigUint64(cursor, BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), true);
  assert.throws(() => decodeNetworkCommandWireV1(command), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "invalid-integer");
});

test("BWN1 field budgets fail before untrusted counts or blobs are allocated", () => {
  const handshake = fromHex(fixture.canonical.handshake);
  const handshakeView = new DataView(handshake.buffer);
  let capabilityCursor = skipString(handshakeView, NETWORK_WIRE_HEADER_BYTES_V1);
  capabilityCursor = skipString(handshakeView, capabilityCursor) + 2;
  capabilityCursor = skipString(handshakeView, capabilityCursor) + 32;
  handshake[capabilityCursor] = 11;
  assert.throws(() => decodeNetworkHandshakeWireV1(handshake), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "budget");

  const command = fromHex(fixture.canonical.command);
  const commandView = new DataView(command.buffer);
  let commandCursor = NETWORK_WIRE_HEADER_BYTES_V1;
  for (let index = 0; index < 6; index += 1) commandCursor = skipString(commandView, commandCursor);
  commandCursor += 3 + 8;
  commandCursor = skipIdentity(commandView, commandCursor) + 8;
  commandView.setUint16(commandCursor, 2_049, true);
  assert.throws(() => decodeNetworkCommandWireV1(command), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "lease-size");

  const delta = fromHex(fixture.canonical.delta!);
  const deltaView = new DataView(delta.buffer);
  let deltaCursor = NETWORK_WIRE_HEADER_BYTES_V1;
  for (let index = 0; index < 3; index += 1) deltaCursor = skipString(deltaView, deltaCursor);
  deltaCursor += 16;
  deltaCursor = skipIdentity(deltaView, deltaCursor);
  deltaCursor = skipIdentity(deltaView, deltaCursor) + 16;
  deltaView.setUint32(deltaCursor, 16_385, true);
  assert.throws(() => decodeNetworkDeltaWireV1(delta), (error: unknown) => error instanceof NetworkWireV1Error && error.code === "delta-record-count");

  assert.throws(
    () => encodeNetworkUtf8PayloadV1("x".repeat(NETWORK_MAX_COMMAND_BYTES_V1 + 1)),
    (error: unknown) => error instanceof NetworkWireV1Error && error.code === "budget",
  );
});
