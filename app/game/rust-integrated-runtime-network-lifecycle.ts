import {
  NETWORK_CAPABILITY_ORDER_V1,
  createNetworkInterestSetV1,
  type NetworkAuthorityIdentityV1,
  type NetworkDeltaRecordV1,
  type NetworkInterestSetV1,
  type NetworkPeerGrantV1,
} from "./network-authority-contract";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated";
import {
  createRustIntegratedDomainWireDescriptorV1,
  unwrapRustIntegratedDomainPacketV1,
  wrapRustIntegratedDomainPacketV1,
  type RustIntegratedDomainWireDescriptorV1,
  type RustIntegratedDomainWireFailureV1,
} from "./rust-integrated-runtime-domain-wire";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const HASH = /^[0-9a-f]{32}$/u;

const PEER_GRANT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-peer-grant-v1");
const AGENT_GRANT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-agent-grant-v1");
const REPLICATION_UPSERT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-replication-upsert-v1");
const REPLICATION_REMOVE_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-replication-remove-v1");
const DELTA_BUILD_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-delta-build-v1");
const DELTA_BUILD_RESPONSE_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-delta-build-response-v1");
const RECONNECT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-reconnect-v1");
const RECONNECT_RESPONSE_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-reconnect-response-v1");
const PEER_RELEASE_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-peer-release-v1");
const COMMAND_RELEASE_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-command-release-v1");
const PEER_GRANT_RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-peer-grant-receipt-v1");
const AGENT_GRANT_RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-agent-grant-receipt-v1");
const REPLICATION_UPSERT_RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-replication-upsert-receipt-v1");
const REPLICATION_REMOVE_RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-replication-remove-receipt-v1");
const PEER_RELEASE_RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-peer-release-receipt-v1");
const COMMAND_RELEASE_RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("network-command-release-receipt-v1");

export const RUST_INTEGRATED_NETWORK_PEER_GRANT_TYPE_V1 = PEER_GRANT_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_AGENT_GRANT_TYPE_V1 = AGENT_GRANT_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_REPLICATION_UPSERT_TYPE_V1 = REPLICATION_UPSERT_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_REPLICATION_REMOVE_TYPE_V1 = REPLICATION_REMOVE_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_DELTA_BUILD_TYPE_V1 = DELTA_BUILD_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_DELTA_BUILD_RESPONSE_TYPE_V1 = DELTA_BUILD_RESPONSE_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_RECONNECT_TYPE_V1 = RECONNECT_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_RECONNECT_RESPONSE_TYPE_V1 = RECONNECT_RESPONSE_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_PEER_RELEASE_TYPE_V1 = PEER_RELEASE_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_COMMAND_RELEASE_TYPE_V1 = COMMAND_RELEASE_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_GRANT_RECEIPT_TYPE_V1 = PEER_GRANT_RECEIPT_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_REPLICATION_RECEIPT_TYPE_V1 = REPLICATION_UPSERT_RECEIPT_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_PEER_RELEASE_RECEIPT_TYPE_V1 = PEER_RELEASE_RECEIPT_SCHEMA.typeId;
export const RUST_INTEGRATED_NETWORK_COMMAND_RELEASE_RECEIPT_TYPE_V1 = COMMAND_RELEASE_RECEIPT_SCHEMA.typeId;

function descriptor(
  schema: Readonly<{ magic: string; innerSchema: number }>,
  label: string,
): RustIntegratedDomainWireDescriptorV1 {
  return createRustIntegratedDomainWireDescriptorV1({
    magic: schema.magic,
    schema: schema.innerSchema,
    label,
  });
}

const PEER_GRANT_WIRE = descriptor(PEER_GRANT_SCHEMA, "integrated network peer grant");
const AGENT_GRANT_WIRE = descriptor(AGENT_GRANT_SCHEMA, "integrated network agent grant");
const REPLICATION_UPSERT_WIRE = descriptor(REPLICATION_UPSERT_SCHEMA, "integrated network replication record");
const DELTA_BUILD_WIRE = descriptor(DELTA_BUILD_SCHEMA, "integrated network delta build");
const RECONNECT_WIRE = descriptor(RECONNECT_SCHEMA, "integrated network reconnect");
const PEER_RELEASE_WIRE = descriptor(PEER_RELEASE_SCHEMA, "integrated network peer release");
const COMMAND_RELEASE_WIRE = descriptor(COMMAND_RELEASE_SCHEMA, "integrated network command release");

const AGENT_CAPABILITIES = [
  "observe.world", "move.self", "interact.basic", "inventory.self.read", "inventory.self.write",
  "container.read", "container.write", "player.location.read", "player.inventory.read", "build",
  "harvest", "chat.send", "voice.send", "diagnostics", "world.admin",
] as const;
const AGENT_STATUSES = ["pending", "approved", "paused", "revoked", "disconnected"] as const;
const RECORD_KINDS = ["world", "entity", "gameplay", "player", "agent", "tombstone"] as const;

export type RustIntegratedNetworkAgentGrantV1 = Readonly<{
  agentId: string;
  peerId: string;
  connectionId: string;
  status: typeof AGENT_STATUSES[number];
  requested: readonly typeof AGENT_CAPABILITIES[number][];
  granted: readonly typeof AGENT_CAPABILITIES[number][];
  expiresAt: number;
}>;

export type RustIntegratedReplicationScopeV1 =
  | Readonly<{ kind: "global" }>
  | Readonly<{ kind: "location"; universeId: string; locationId: string }>
  | Readonly<{ kind: "chunk"; universeId: string; locationId: string; chunkX: number; chunkZ: number }>
  | Readonly<{ kind: "entity"; entityId: string }>;

export type RustIntegratedScopedDeltaRecordV1 = Readonly<{
  scope: RustIntegratedReplicationScopeV1;
  record: NetworkDeltaRecordV1;
}>;

export type RustIntegratedNetworkDeltaBuildRequestV1 = Readonly<{
  sessionId: string;
  deltaId: string;
  peerId: string;
  keyframe: boolean;
  sequence: number;
  acknowledgedCommandSequence: number;
  from: NetworkAuthorityIdentityV1;
  to: NetworkAuthorityIdentityV1;
  interest: NetworkInterestSetV1;
}>;

export type RustIntegratedNetworkDeltaBuildResponseV1 = Readonly<{
  scopeProbes: number;
  candidateRecords: number;
  emittedRecords: number;
  deltaPacket: Uint8Array;
}>;

const ACKNOWLEDGEMENT_SCHEMAS = Object.freeze({
  "peer-grant": PEER_GRANT_RECEIPT_SCHEMA,
  "agent-grant": AGENT_GRANT_RECEIPT_SCHEMA,
  "replication-upsert": REPLICATION_UPSERT_RECEIPT_SCHEMA,
  "replication-remove": REPLICATION_REMOVE_RECEIPT_SCHEMA,
  "peer-release": PEER_RELEASE_RECEIPT_SCHEMA,
  "command-release": COMMAND_RELEASE_RECEIPT_SCHEMA,
} as const);

export type RustIntegratedNetworkAcknowledgementFamilyV1 = keyof typeof ACKNOWLEDGEMENT_SCHEMAS;

export type RustIntegratedNetworkAcknowledgementV1 = Readonly<{
  family: RustIntegratedNetworkAcknowledgementFamilyV1;
  requestPayloadHash: string;
  resultingRuntimeStateHash: string;
}>;

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private append(value: Uint8Array) { this.parts.push(value); this.length += value.byteLength; }
  u8(value: number) { this.append(Uint8Array.of(value)); }
  flag(value: boolean) { this.u8(value ? 1 : 0); }
  u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); this.append(bytes); }
  u32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); this.append(bytes); }
  i32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setInt32(0, value, true); this.append(bytes); }
  u64(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("integrated network u64 is outside JavaScript's exact range");
    const bytes = new Uint8Array(8); const view = new DataView(bytes.buffer);
    view.setUint32(0, value >>> 0, true); view.setUint32(4, Math.floor(value / 0x1_0000_0000), true); this.append(bytes);
  }
  bytes(value: Uint8Array) { this.u32(value.byteLength); this.append(value); }
  string(value: string) { this.bytes(encoder.encode(value)); }
  hash(value: string) {
    if (!HASH.test(value)) throw new Error("integrated network hash is not canonical hex");
    this.append(Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)));
  }
  raw(value: Uint8Array) { this.append(value); }
  finish() { const output = new Uint8Array(this.length); let offset = 0; for (const part of this.parts) { output.set(part, offset); offset += part.byteLength; } return output; }
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  take(length: number) { const end = this.offset + length; if (end > this.bytes.byteLength) throw new Error("integrated network packet is truncated"); const value = this.bytes.subarray(this.offset, end); this.offset = end; return value; }
  u8() { return this.take(1)[0]; }
  u16() { const value = this.take(2); return new DataView(value.buffer, value.byteOffset, 2).getUint16(0, true); }
  u32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, true); }
  bytesValue() { return Uint8Array.from(this.take(this.u32())); }
  stringValue() { return decoder.decode(this.bytesValue()); }
  finish() { if (this.offset !== this.bytes.byteLength) throw new Error("integrated network packet has trailing bytes"); }
}

function hashHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function decodeRustIntegratedNetworkAcknowledgementV1(
  family: RustIntegratedNetworkAcknowledgementFamilyV1,
  packet: Uint8Array,
): RustIntegratedNetworkAcknowledgementV1 {
  const schema = ACKNOWLEDGEMENT_SCHEMAS[family];
  const reader = new Reader(packet);
  if (decoder.decode(reader.take(4)) !== schema.magic || reader.u16() !== schema.innerSchema) {
    throw new Error(`integrated network ${family} acknowledgement header mismatch`);
  }
  const requestPayloadHash = hashHex(reader.take(16));
  const resultingRuntimeStateHash = hashHex(reader.take(16));
  reader.finish();
  return Object.freeze({ family, requestPayloadHash, resultingRuntimeStateHash });
}

const failDomainWire: RustIntegratedDomainWireFailureV1 = (code, message) => {
  if (code === "checksum") throw new Error("integrated network packet checksum mismatch");
  if (code === "header" && message.includes("length")) {
    throw new Error("integrated network packet has trailing bytes or an invalid declared length");
  }
  if (code === "header") throw new Error("integrated network packet header mismatch");
  throw new Error(message);
};

function wrap(descriptor: RustIntegratedDomainWireDescriptorV1, body: Uint8Array) {
  return wrapRustIntegratedDomainPacketV1(descriptor, body, failDomainWire);
}

function unwrap(descriptor: RustIntegratedDomainWireDescriptorV1, packet: Uint8Array) {
  return unwrapRustIntegratedDomainPacketV1(descriptor, packet, failDomainWire);
}

function writeIdentity(writer: Writer, value: NetworkAuthorityIdentityV1) {
  writer.string(value.address.universeId); writer.string(value.address.locationId);
  writer.u64(value.revision.epoch); writer.u64(value.revision.world); writer.u64(value.revision.entities);
  writer.u64(value.revision.gameplay); writer.u64(value.revision.persistence); writer.hash(value.stateHash);
}

function writeInterest(writer: Writer, value: NetworkInterestSetV1) {
  const interest = createNetworkInterestSetV1(value);
  if (interest.interestHash !== value.interestHash) throw new Error("integrated network interest is not canonical");
  writer.u64(interest.sequence); writer.u32(interest.chunks.length);
  for (const chunk of interest.chunks) { writer.string(chunk.universeId); writer.string(chunk.locationId); writer.i32(chunk.chunkX); writer.i32(chunk.chunkZ); }
  writer.u32(interest.entityIds.length); for (const entityId of interest.entityIds) writer.string(entityId); writer.hash(interest.interestHash);
}

function writeRecord(writer: Writer, value: NetworkDeltaRecordV1) {
  const tag = RECORD_KINDS.indexOf(value.kind); if (tag < 0) throw new Error("unknown integrated network record kind");
  writer.u8(tag); writer.string(value.recordId); writer.u64(value.revision); writer.bytes(value.payload); writer.hash(value.payloadHash);
}

export function encodeRustIntegratedNetworkPeerGrantV1(value: NetworkPeerGrantV1) {
  const writer = new Writer(); writer.string(value.sessionId); writer.string(value.peerId); writer.string(value.connectionId); writer.string(value.actorId);
  writer.u8(value.peerKind === "human" ? 0 : 1); writer.u8(value.role === "host" ? 0 : 1);
  writer.u8(value.capabilities.length);
  for (const capability of value.capabilities) { const tag = NETWORK_CAPABILITY_ORDER_V1.indexOf(capability); if (tag < 0) throw new Error("unknown network capability"); writer.u8(tag); }
  writer.u64(value.expiresAt); writer.u64(value.nextSequence); writeInterest(writer, value.interest); return wrap(PEER_GRANT_WIRE, writer.finish());
}

export function encodeRustIntegratedNetworkAgentGrantV1(value: RustIntegratedNetworkAgentGrantV1) {
  const writer = new Writer(); writer.string(value.agentId); writer.string(value.peerId); writer.string(value.connectionId);
  writer.u8(AGENT_STATUSES.indexOf(value.status));
  for (const capabilities of [value.requested, value.granted]) {
    writer.u8(capabilities.length);
    for (const capability of capabilities) { const tag = AGENT_CAPABILITIES.indexOf(capability); if (tag < 0) throw new Error("unknown agent capability"); writer.u8(tag); }
  }
  writer.u64(value.expiresAt); return wrap(AGENT_GRANT_WIRE, writer.finish());
}

export function encodeRustIntegratedNetworkReplicationRecordV1(value: RustIntegratedScopedDeltaRecordV1) {
  const writer = new Writer();
  if (value.scope.kind === "global") writer.u8(0);
  else if (value.scope.kind === "location") { writer.u8(1); writer.string(value.scope.universeId); writer.string(value.scope.locationId); }
  else if (value.scope.kind === "chunk") { writer.u8(2); writer.string(value.scope.universeId); writer.string(value.scope.locationId); writer.i32(value.scope.chunkX); writer.i32(value.scope.chunkZ); }
  else { writer.u8(3); writer.string(value.scope.entityId); }
  writeRecord(writer, value.record); return wrap(REPLICATION_UPSERT_WIRE, writer.finish());
}

export function encodeRustIntegratedNetworkDeltaBuildV1(value: RustIntegratedNetworkDeltaBuildRequestV1) {
  const writer = new Writer(); writer.string(value.sessionId); writer.string(value.deltaId); writer.string(value.peerId); writer.flag(value.keyframe);
  writer.u64(value.sequence); writer.u64(value.acknowledgedCommandSequence); writeIdentity(writer, value.from); writeIdentity(writer, value.to);
  writeInterest(writer, value.interest); return wrap(DELTA_BUILD_WIRE, writer.finish());
}

export function decodeRustIntegratedNetworkDeltaBuildResponseV1(packet: Uint8Array): RustIntegratedNetworkDeltaBuildResponseV1 {
  const reader = new Reader(packet); if (decoder.decode(reader.take(4)) !== DELTA_BUILD_RESPONSE_SCHEMA.magic || reader.u16() !== DELTA_BUILD_RESPONSE_SCHEMA.innerSchema) throw new Error("integrated delta response header mismatch");
  const result = Object.freeze({ scopeProbes: reader.u32(), candidateRecords: reader.u32(), emittedRecords: reader.u32(), deltaPacket: reader.bytesValue() }); reader.finish(); return result;
}

export function encodeRustIntegratedNetworkReconnectV1(sessionId: string, peerId: string, connectionGeneration: number) {
  const writer = new Writer(); writer.string(sessionId); writer.string(peerId); writer.u64(connectionGeneration); return wrap(RECONNECT_WIRE, writer.finish());
}

export function decodeRustIntegratedNetworkReconnectResponseV1(packet: Uint8Array) {
  const reader = new Reader(packet); if (decoder.decode(reader.take(4)) !== RECONNECT_RESPONSE_SCHEMA.magic || reader.u16() !== RECONNECT_RESPONSE_SCHEMA.innerSchema) throw new Error("integrated reconnect response header mismatch");
  const present = reader.u8(); if (present > 1) throw new Error("integrated reconnect response flag is invalid"); const result = present === 1 ? reader.bytesValue() : null; reader.finish(); return result;
}

export function encodeRustIntegratedNetworkPeerReleaseV1(peerId: string) { const writer = new Writer(); writer.string(peerId); return wrap(PEER_RELEASE_WIRE, writer.finish()); }

export function encodeRustIntegratedNetworkCommandReleaseV1(commandId: string) { const writer = new Writer(); writer.string(commandId); return wrap(COMMAND_RELEASE_WIRE, writer.finish()); }

export function decodeRustIntegratedNetworkCommandReleaseV1(packet: Uint8Array) {
  const reader = new Reader(unwrap(COMMAND_RELEASE_WIRE, packet));
  const commandId = reader.stringValue();
  reader.finish();
  return commandId;
}
