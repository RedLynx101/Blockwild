import {
  NETWORK_AUTHORITY_PROTOCOL_V1,
  NETWORK_AUTHORITY_SCHEMA_V1,
  NETWORK_CAPABILITY_ORDER_V1,
  NETWORK_MAX_COMMAND_BYTES_V1,
  NETWORK_MAX_DELTA_BYTES_V1,
  NETWORK_MAX_DELTA_RECORDS_V1,
  NETWORK_MAX_LEASE_KEYS_V1,
  createNetworkAuthorityIdentityV1,
  createNetworkCommandV1,
  createNetworkDeltaV1,
  createNetworkHandshakeV1,
  createNetworkReconnectCheckpointV1,
  type NetworkAuthorityIdentityV1,
  type NetworkCapabilityV1,
  type NetworkCommandKindV1,
  type NetworkCommandSourceV1,
  type NetworkCommandV1,
  type NetworkDeltaInputV1,
  type NetworkDeltaRecordKindV1,
  type NetworkDeltaV1,
  type NetworkHandshakeSourceV1,
  type NetworkHandshakeV1,
  type NetworkPeerKindV1,
  type NetworkPeerRoleV1,
  type NetworkReconnectCheckpointV1,
} from "./network-authority-contract";

/** Byte-exact TypeScript companion to blockwild-network/src/wire.rs. */
export const NETWORK_WIRE_MAGIC_V1 = "BWN1" as const;
export const NETWORK_WIRE_HEADER_BYTES_V1 = 16;
export const NETWORK_MAX_HANDSHAKE_WIRE_BYTES_V1 = 16 * 1024;
export const NETWORK_MAX_COMMAND_WIRE_BYTES_V1 = NETWORK_MAX_COMMAND_BYTES_V1 + 1024 * 1024;
export const NETWORK_MAX_DELTA_WIRE_BYTES_V1 = NETWORK_MAX_DELTA_BYTES_V1 + 8 * 1024 * 1024;
export const NETWORK_MAX_CHECKPOINT_WIRE_BYTES_V1 = 16 * 1024;

export type NetworkWireKindV1 = "handshake" | "command" | "delta" | "keyframe" | "reconnect-checkpoint";
export type NetworkWireErrorCodeV1 =
  | "budget"
  | "delta-record-count"
  | "delta-size"
  | "hash-mismatch"
  | "identity-hash"
  | "invalid-enum"
  | "invalid-integer"
  | "invalid-label"
  | "lease-size"
  | "protocol-mismatch"
  | "schema-mismatch"
  | "truncated"
  | "trailing-bytes"
  | "wire-magic"
  | "wire-type";

export class NetworkWireV1Error extends Error {
  constructor(readonly code: NetworkWireErrorCodeV1, message: string) {
    super(message);
    this.name = "NetworkWireV1Error";
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const MAX_SAFE_U64 = BigInt(Number.MAX_SAFE_INTEGER);
const HASH_PATTERN = /^[0-9a-f]{32}$/u;

const WIRE_KIND_TAG: Readonly<Record<NetworkWireKindV1, number>> = Object.freeze({
  handshake: 1,
  command: 2,
  delta: 3,
  keyframe: 4,
  "reconnect-checkpoint": 5,
});

const PEER_KIND_TAG: Readonly<Record<NetworkPeerKindV1, number>> = Object.freeze({ human: 0, agent: 1 });
const PEER_ROLE_TAG: Readonly<Record<NetworkPeerRoleV1, number>> = Object.freeze({ host: 0, guest: 1 });
const COMMAND_KIND_TAG: Readonly<Record<NetworkCommandKindV1, number>> = Object.freeze({
  world: 0,
  gameplay: 1,
  agent: 2,
  chat: 3,
  interest: 4,
  reconnect: 5,
  pose: 6,
  "presentation-state": 7,
});
const DELTA_KIND_TAG: Readonly<Record<NetworkDeltaRecordKindV1, number>> = Object.freeze({
  world: 0,
  entity: 1,
  gameplay: 2,
  player: 3,
  agent: 4,
  tombstone: 5,
});

function maximumWireBytes(kind: NetworkWireKindV1) {
  switch (kind) {
    case "handshake": return NETWORK_MAX_HANDSHAKE_WIRE_BYTES_V1;
    case "command": return NETWORK_MAX_COMMAND_WIRE_BYTES_V1;
    case "delta":
    case "keyframe": return NETWORK_MAX_DELTA_WIRE_BYTES_V1;
    case "reconnect-checkpoint": return NETWORK_MAX_CHECKPOINT_WIRE_BYTES_V1;
  }
}

function enumKey<T extends string>(table: Readonly<Record<T, number>>, tag: number, label: string): T {
  const found = (Object.entries(table) as [T, number][]).find(([, value]) => value === tag)?.[0];
  if (found === undefined) throw new NetworkWireV1Error("invalid-enum", `invalid ${label}`);
  return found;
}

function capabilityFromTag(tag: number): NetworkCapabilityV1 {
  const capability = NETWORK_CAPABILITY_ORDER_V1[tag];
  if (capability === undefined) throw new NetworkWireV1Error("invalid-enum", "invalid network capability");
  return capability;
}

function hashBytes(hex: string) {
  if (!HASH_PATTERN.test(hex)) throw new NetworkWireV1Error("hash-mismatch", "hash must be 16 lowercase hexadecimal bytes");
  const output = new Uint8Array(16);
  for (let index = 0; index < output.length; index += 1) output[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return output;
}

function hashHex(bytes: Uint8Array) {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function stringsEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

class Writer {
  private readonly chunks: Uint8Array[] = [];
  private byteLength = 0;

  private append(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.byteLength += bytes.byteLength;
  }

  u8(value: number) { this.append(Uint8Array.of(value)); }
  u16(value: number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    this.append(bytes);
  }
  u32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.append(bytes);
  }
  u64(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new NetworkWireV1Error("invalid-integer", "u64 exceeds JavaScript safe range");
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
    this.append(bytes);
  }
  hash(value: string) { this.append(hashBytes(value)); }
  string(value: string) {
    const bytes = textEncoder.encode(value);
    if (bytes.byteLength > 0xffff) throw new NetworkWireV1Error("invalid-label", "wire string exceeds u16 byte length");
    this.u16(bytes.byteLength);
    this.append(bytes);
  }
  blob(value: Uint8Array) {
    this.u32(value.byteLength);
    this.append(value.slice());
  }
  finish() {
    const output = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

class Reader {
  private cursor = 0;
  constructor(private readonly bytes: Uint8Array) {}

  take(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || this.cursor + length > this.bytes.byteLength) {
      throw new NetworkWireV1Error("truncated", "network payload is truncated");
    }
    const value = this.bytes.subarray(this.cursor, this.cursor + length);
    this.cursor += length;
    return value;
  }
  u8() { return this.take(1)[0]!; }
  u16() {
    const bytes = this.take(2);
    return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, true);
  }
  u32() {
    const bytes = this.take(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }
  u64() {
    const bytes = this.take(8);
    const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
    if (value > MAX_SAFE_U64) throw new NetworkWireV1Error("invalid-integer", "integer exceeds JavaScript safe range");
    return Number(value);
  }
  hash() { return hashHex(this.take(16)); }
  string(maximumBytes: number) {
    const length = this.u16();
    if (length > maximumBytes) throw new NetworkWireV1Error("invalid-label", "wire label exceeds field budget");
    try {
      return textDecoder.decode(this.take(length));
    } catch {
      throw new NetworkWireV1Error("invalid-label", "wire label is not UTF-8");
    }
  }
  blob(maximumBytes: number) {
    const length = this.u32();
    if (length > maximumBytes) throw new NetworkWireV1Error("budget", "wire blob exceeds field budget");
    return this.take(length).slice();
  }
  finish() {
    if (this.cursor !== this.bytes.byteLength) throw new NetworkWireV1Error("trailing-bytes", "network payload contains trailing bytes");
  }
}

function frame(kind: NetworkWireKindV1, payload: Uint8Array) {
  const total = NETWORK_WIRE_HEADER_BYTES_V1 + payload.byteLength;
  if (total > maximumWireBytes(kind)) throw new NetworkWireV1Error("budget", "wire frame exceeds message budget");
  const output = new Uint8Array(total);
  output.set(textEncoder.encode(NETWORK_WIRE_MAGIC_V1), 0);
  const view = new DataView(output.buffer);
  view.setUint16(4, NETWORK_AUTHORITY_SCHEMA_V1, true);
  view.setUint16(6, NETWORK_AUTHORITY_PROTOCOL_V1, true);
  view.setUint16(8, WIRE_KIND_TAG[kind], true);
  view.setUint16(10, 0, true);
  view.setUint32(12, payload.byteLength, true);
  output.set(payload, NETWORK_WIRE_HEADER_BYTES_V1);
  return output;
}

function parseFrame(bytes: Uint8Array, expectedKinds: readonly NetworkWireKindV1[]) {
  if (bytes.byteLength < NETWORK_WIRE_HEADER_BYTES_V1) throw new NetworkWireV1Error("truncated", "network wire header is truncated");
  if (textDecoder.decode(bytes.subarray(0, 4)) !== NETWORK_WIRE_MAGIC_V1) throw new NetworkWireV1Error("wire-magic", "network wire magic is not BWN1");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== NETWORK_AUTHORITY_SCHEMA_V1) throw new NetworkWireV1Error("schema-mismatch", "network wire schema is unsupported");
  if (view.getUint16(6, true) !== NETWORK_AUTHORITY_PROTOCOL_V1) throw new NetworkWireV1Error("protocol-mismatch", "network wire protocol is unsupported");
  const kindTag = view.getUint16(8, true);
  const kind = (Object.entries(WIRE_KIND_TAG) as [NetworkWireKindV1, number][]).find(([, value]) => value === kindTag)?.[0];
  if (kind === undefined) throw new NetworkWireV1Error("wire-type", "unknown R9 network wire type");
  if (!expectedKinds.includes(kind)) throw new NetworkWireV1Error("wire-type", "network wire message type mismatch");
  if (view.getUint16(10, true) !== 0) throw new NetworkWireV1Error("protocol-mismatch", "network wire flags are unsupported");
  if (bytes.byteLength > maximumWireBytes(kind)) throw new NetworkWireV1Error("budget", "network wire frame exceeds message budget");
  const payloadLength = view.getUint32(12, true);
  if (NETWORK_WIRE_HEADER_BYTES_V1 + payloadLength !== bytes.byteLength) throw new NetworkWireV1Error("truncated", "network wire payload length mismatch");
  return { kind, payload: bytes.subarray(NETWORK_WIRE_HEADER_BYTES_V1) } as const;
}

function writeIdentity(writer: Writer, identity: NetworkAuthorityIdentityV1) {
  writer.string(identity.address.universeId);
  writer.string(identity.address.locationId);
  writer.u64(identity.revision.epoch);
  writer.u64(identity.revision.world);
  writer.u64(identity.revision.entities);
  writer.u64(identity.revision.gameplay);
  writer.u64(identity.revision.persistence);
  writer.hash(identity.stateHash);
}

function readIdentity(reader: Reader) {
  const address = { universeId: reader.string(64 * 4), locationId: reader.string(128 * 4) };
  const revision = {
    epoch: reader.u64(),
    world: reader.u64(),
    entities: reader.u64(),
    gameplay: reader.u64(),
    persistence: reader.u64(),
  };
  const suppliedHash = reader.hash();
  const identity = createNetworkAuthorityIdentityV1(address, revision);
  if (identity.stateHash !== suppliedHash) throw new NetworkWireV1Error("identity-hash", "wire identity hash mismatch");
  return identity;
}

function canonicalHandshake(value: NetworkHandshakeV1) {
  const rebuilt = createNetworkHandshakeV1(value);
  if (rebuilt.schemaVersion !== value.schemaVersion || rebuilt.protocolVersion !== value.protocolVersion
    || rebuilt.handshakeHash !== value.handshakeHash || !stringsEqual(rebuilt.capabilities, value.capabilities)) {
    throw new NetworkWireV1Error("hash-mismatch", "handshake hash or normalization mismatch");
  }
  return rebuilt;
}

function canonicalCommand(value: NetworkCommandV1) {
  const rebuilt = createNetworkCommandV1(value);
  if (rebuilt.schemaVersion !== value.schemaVersion || rebuilt.protocolVersion !== value.protocolVersion
    || rebuilt.commandHash !== value.commandHash || rebuilt.expected.stateHash !== value.expected.stateHash
    || !stringsEqual(rebuilt.leaseKeys, value.leaseKeys) || !bytesEqual(rebuilt.payload, value.payload)) {
    throw new NetworkWireV1Error("hash-mismatch", "command hash or normalization mismatch");
  }
  return rebuilt;
}

function canonicalDelta(value: NetworkDeltaV1) {
  const rebuilt = createNetworkDeltaV1(value);
  const recordsMatch = rebuilt.records.length === value.records.length && rebuilt.records.every((record, index) => {
    const supplied = value.records[index];
    return supplied !== undefined && record.kind === supplied.kind && record.recordId === supplied.recordId
      && record.revision === supplied.revision && record.payloadHash === supplied.payloadHash && bytesEqual(record.payload, supplied.payload);
  });
  if (rebuilt.schemaVersion !== value.schemaVersion || rebuilt.protocolVersion !== value.protocolVersion
    || rebuilt.deltaHash !== value.deltaHash || rebuilt.byteLength !== value.byteLength
    || rebuilt.from.stateHash !== value.from.stateHash || rebuilt.to.stateHash !== value.to.stateHash || !recordsMatch) {
    throw new NetworkWireV1Error("hash-mismatch", "delta hash, size, or normalization mismatch");
  }
  return rebuilt;
}

function canonicalCheckpoint(value: NetworkReconnectCheckpointV1) {
  const rebuilt = createNetworkReconnectCheckpointV1(value);
  if (rebuilt.schemaVersion !== value.schemaVersion || rebuilt.checkpointHash !== value.checkpointHash
    || rebuilt.identity.stateHash !== value.identity.stateHash) {
    throw new NetworkWireV1Error("hash-mismatch", "checkpoint hash mismatch");
  }
  return rebuilt;
}

export function encodeNetworkHandshakeWireV1(value: NetworkHandshakeV1) {
  const canonical = canonicalHandshake(value);
  const writer = new Writer();
  writer.string(canonical.sessionId);
  writer.string(canonical.peerId);
  writer.u8(PEER_KIND_TAG[canonical.peerKind]);
  writer.u8(PEER_ROLE_TAG[canonical.role]);
  writer.string(canonical.engineVersion);
  writer.hash(canonical.contentHash);
  writer.hash(canonical.generatorHash);
  writer.u8(canonical.capabilities.length);
  for (const capability of canonical.capabilities) writer.u8(NETWORK_CAPABILITY_ORDER_V1.indexOf(capability));
  writer.u32(canonical.maxCommandBytes);
  writer.hash(canonical.handshakeHash);
  return frame("handshake", writer.finish());
}

export function decodeNetworkHandshakeWireV1(bytes: Uint8Array) {
  const { payload } = parseFrame(bytes, ["handshake"]);
  const reader = new Reader(payload);
  const sessionId = reader.string(720);
  const peerId = reader.string(720);
  const peerKind = enumKey(PEER_KIND_TAG, reader.u8(), "peer kind");
  const role = enumKey(PEER_ROLE_TAG, reader.u8(), "peer role");
  const engineVersion = reader.string(256);
  const contentHash = reader.hash();
  const generatorHash = reader.hash();
  const capabilityCount = reader.u8();
  if (capabilityCount > NETWORK_CAPABILITY_ORDER_V1.length) throw new NetworkWireV1Error("budget", "too many handshake capabilities");
  const capabilities: NetworkCapabilityV1[] = [];
  for (let index = 0; index < capabilityCount; index += 1) capabilities.push(capabilityFromTag(reader.u8()));
  const maxCommandBytes = reader.u32();
  const suppliedHash = reader.hash();
  reader.finish();
  const value = createNetworkHandshakeV1({ sessionId, peerId, peerKind, role, engineVersion, contentHash, generatorHash, capabilities, maxCommandBytes });
  if (value.handshakeHash !== suppliedHash) throw new NetworkWireV1Error("hash-mismatch", "wire handshake hash mismatch");
  return value;
}

export function encodeNetworkCommandWireV1(value: NetworkCommandV1) {
  const canonical = canonicalCommand(value);
  const writer = new Writer();
  writer.string(canonical.sessionId);
  writer.string(canonical.commandId);
  writer.string(canonical.idempotencyKey);
  writer.string(canonical.peerId);
  writer.string(canonical.connectionId);
  writer.string(canonical.actorId);
  writer.u8(PEER_KIND_TAG[canonical.peerKind]);
  writer.u8(COMMAND_KIND_TAG[canonical.kind]);
  writer.u8(NETWORK_CAPABILITY_ORDER_V1.indexOf(canonical.requiredCapability));
  writer.u64(canonical.sequence);
  writeIdentity(writer, canonical.expected);
  writer.u64(canonical.expiresAt);
  writer.u16(canonical.leaseKeys.length);
  for (const key of canonical.leaseKeys) writer.string(key);
  writer.blob(canonical.payload);
  writer.hash(canonical.commandHash);
  return frame("command", writer.finish());
}

export function decodeNetworkCommandWireV1(bytes: Uint8Array) {
  const { payload } = parseFrame(bytes, ["command"]);
  const reader = new Reader(payload);
  const sessionId = reader.string(720);
  const commandId = reader.string(720);
  const idempotencyKey = reader.string(1024);
  const peerId = reader.string(720);
  const connectionId = reader.string(720);
  const actorId = reader.string(720);
  const peerKind = enumKey(PEER_KIND_TAG, reader.u8(), "peer kind");
  const kind = enumKey(COMMAND_KIND_TAG, reader.u8(), "command kind");
  const requiredCapability = capabilityFromTag(reader.u8());
  const sequence = reader.u64();
  const expected = readIdentity(reader);
  const expiresAt = reader.u64();
  const leaseCount = reader.u16();
  if (leaseCount > NETWORK_MAX_LEASE_KEYS_V1) throw new NetworkWireV1Error("lease-size", "wire command has too many lease keys");
  const leaseKeys: string[] = [];
  for (let index = 0; index < leaseCount; index += 1) leaseKeys.push(reader.string(1024));
  const commandPayload = reader.blob(NETWORK_MAX_COMMAND_BYTES_V1);
  const suppliedHash = reader.hash();
  reader.finish();
  const value = createNetworkCommandV1({ sessionId, commandId, idempotencyKey, peerId, connectionId, actorId, peerKind, kind, requiredCapability, sequence, expected, expiresAt, leaseKeys, payload: commandPayload });
  if (value.commandHash !== suppliedHash) throw new NetworkWireV1Error("hash-mismatch", "wire command hash mismatch");
  return value;
}

export function encodeNetworkDeltaWireV1(value: NetworkDeltaV1) {
  const canonical = canonicalDelta(value);
  const writer = new Writer();
  writer.string(canonical.sessionId);
  writer.string(canonical.deltaId);
  writer.string(canonical.peerId);
  writer.u64(canonical.sequence);
  writer.u64(canonical.acknowledgedCommandSequence);
  writeIdentity(writer, canonical.from);
  writeIdentity(writer, canonical.to);
  writer.hash(canonical.interestHash);
  writer.u32(canonical.records.length);
  for (const record of canonical.records) {
    writer.u8(DELTA_KIND_TAG[record.kind]);
    writer.string(record.recordId);
    writer.u64(record.revision);
    writer.blob(record.payload);
    writer.hash(record.payloadHash);
  }
  writer.u32(canonical.byteLength);
  writer.hash(canonical.deltaHash);
  return frame(canonical.keyframe ? "keyframe" : "delta", writer.finish());
}

export function decodeNetworkDeltaWireV1(bytes: Uint8Array) {
  if (bytes.byteLength < 10) throw new NetworkWireV1Error("truncated", "network delta frame is truncated");
  const { kind, payload } = parseFrame(bytes, ["delta", "keyframe"]);
  const reader = new Reader(payload);
  const sessionId = reader.string(720);
  const deltaId = reader.string(720);
  const peerId = reader.string(720);
  const sequence = reader.u64();
  const acknowledgedCommandSequence = reader.u64();
  const from = readIdentity(reader);
  const to = readIdentity(reader);
  const interestHash = reader.hash();
  const recordCount = reader.u32();
  if (recordCount > NETWORK_MAX_DELTA_RECORDS_V1) throw new NetworkWireV1Error("delta-record-count", "wire delta record budget exceeded");
  const records: NetworkDeltaInputV1["records"][number][] = [];
  let runningBytes = 0;
  const suppliedRecordHashes: string[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    const recordKind = enumKey(DELTA_KIND_TAG, reader.u8(), "delta record kind");
    const recordId = reader.string(1024);
    const revision = reader.u64();
    const recordPayload = reader.blob(NETWORK_MAX_DELTA_BYTES_V1);
    runningBytes += recordPayload.byteLength;
    if (runningBytes > NETWORK_MAX_DELTA_BYTES_V1) throw new NetworkWireV1Error("delta-size", "wire delta byte budget exceeded");
    records.push({ kind: recordKind, recordId, revision, payload: recordPayload });
    suppliedRecordHashes.push(reader.hash());
  }
  const suppliedByteLength = reader.u32();
  const suppliedDeltaHash = reader.hash();
  reader.finish();
  const value = createNetworkDeltaV1({ sessionId, deltaId, peerId, keyframe: kind === "keyframe", sequence, acknowledgedCommandSequence, from, to, interestHash, records });
  const suppliedHashByKey = new Map(records.map((record, index) => [`${record.kind}/${encodeURIComponent(record.recordId)}`, suppliedRecordHashes[index]!]));
  if (value.records.some((record) => suppliedHashByKey.get(`${record.kind}/${encodeURIComponent(record.recordId)}`) !== record.payloadHash)) {
    throw new NetworkWireV1Error("hash-mismatch", "wire delta record hash mismatch");
  }
  if (value.byteLength !== suppliedByteLength || value.deltaHash !== suppliedDeltaHash) throw new NetworkWireV1Error("hash-mismatch", "wire delta size or hash mismatch");
  return value;
}

export function encodeNetworkReconnectCheckpointWireV1(value: NetworkReconnectCheckpointV1) {
  const canonical = canonicalCheckpoint(value);
  const writer = new Writer();
  writer.string(canonical.sessionId);
  writer.string(canonical.peerId);
  writer.u64(canonical.connectionGeneration);
  writer.u64(canonical.acknowledgedCommandSequence);
  writer.u64(canonical.acknowledgedDeltaSequence);
  writeIdentity(writer, canonical.identity);
  writer.hash(canonical.interestHash);
  writer.hash(canonical.checkpointHash);
  return frame("reconnect-checkpoint", writer.finish());
}

export function decodeNetworkReconnectCheckpointWireV1(bytes: Uint8Array) {
  const { payload } = parseFrame(bytes, ["reconnect-checkpoint"]);
  const reader = new Reader(payload);
  const sessionId = reader.string(720);
  const peerId = reader.string(720);
  const connectionGeneration = reader.u64();
  const acknowledgedCommandSequence = reader.u64();
  const acknowledgedDeltaSequence = reader.u64();
  const identity = readIdentity(reader);
  const interestHash = reader.hash();
  const suppliedHash = reader.hash();
  reader.finish();
  const value = createNetworkReconnectCheckpointV1({ sessionId, peerId, connectionGeneration, acknowledgedCommandSequence, acknowledgedDeltaSequence, identity, interestHash });
  if (value.checkpointHash !== suppliedHash) throw new NetworkWireV1Error("hash-mismatch", "wire checkpoint hash mismatch");
  return value;
}

/** Coarse UTF-8 payload helper for wrapping an existing multiplayer JSON envelope. */
export function encodeNetworkUtf8PayloadV1(value: string) {
  const payload = textEncoder.encode(value);
  if (payload.byteLength > NETWORK_MAX_COMMAND_BYTES_V1) throw new NetworkWireV1Error("budget", "network command payload exceeds V1 budget");
  return payload;
}

export function decodeNetworkUtf8PayloadV1(value: Uint8Array) {
  if (value.byteLength > NETWORK_MAX_COMMAND_BYTES_V1) throw new NetworkWireV1Error("budget", "network command payload exceeds V1 budget");
  try { return textDecoder.decode(value); }
  catch { throw new NetworkWireV1Error("invalid-label", "network command payload is not UTF-8"); }
}

/** Build and encode a normalized host-authoritative command in one boundary call. */
export function encodeNetworkCommandSourceWireV1(source: NetworkCommandSourceV1) {
  return encodeNetworkCommandWireV1(createNetworkCommandV1(source));
}

/** Build and encode a normalized handshake in one boundary call. */
export function encodeNetworkHandshakeSourceWireV1(source: NetworkHandshakeSourceV1) {
  return encodeNetworkHandshakeWireV1(createNetworkHandshakeV1(source));
}
