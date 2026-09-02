import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import {
  NETWORK_CAPABILITY_ORDER_V1,
  NETWORK_MAX_COMMAND_BYTES_V1,
  NETWORK_MAX_DELTA_BYTES_V1,
  NETWORK_MAX_INTEREST_CHUNKS_V1,
  NETWORK_MAX_INTEREST_ENTITIES_V1,
  createNetworkAuthorityIdentityV1,
  createNetworkInterestSetV1,
  type NetworkAuthorityIdentityV1,
  type NetworkCapabilityV1,
  type NetworkCommandReceiptV1,
  type NetworkInterestSetV1,
} from "./network-authority-contract";
import {
  decodeRustNetworkPlayerPoseProjectionV1,
  encodeRustNetworkPlayerPoseProjectionV1,
  RUST_NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1,
  type RustNetworkPlayerPoseProjectionV1,
} from "./rust-network-player-pose-v1";

/** Opaque WebRTC/browser transport boundary for the Rust R9 authority. */
export const RUST_NETWORK_BROWSER_PROTOCOL_V1 = 1 as const;
export const RUST_NETWORK_BROWSER_HEADER_BYTES_V1 = 36;
export const RUST_NETWORK_BROWSER_MAX_WIRE_BYTES_V1 = 64 * 1024 * 1024;
export const RUST_NETWORK_BROWSER_MAX_BATCH_PACKETS_V1 = 512;

const NETWORK_MAX_HANDSHAKE_WIRE_BYTES_V1 = 16 * 1024;
const NETWORK_MAX_COMMAND_WIRE_BYTES_V1 = NETWORK_MAX_COMMAND_BYTES_V1 + 1024 * 1024;
const NETWORK_MAX_DELTA_WIRE_BYTES_V1 = NETWORK_MAX_DELTA_BYTES_V1 + 8 * 1024 * 1024;
const NETWORK_MAX_CHECKPOINT_WIRE_BYTES_V1 = 16 * 1024;
const NETWORK_MAX_AGENT_WORK_WIRE_BYTES_V1 = 132 * 1024;

const REQUEST_MAGIC = "BWRN";
const RESPONSE_MAGIC = "BWNA";
const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const RECEIPT_CODES = ["unknown-peer", "connection-mismatch", "peer-kind-mismatch", "session-expired", "command-expired", "sequence", "stale-revision", "capability-denied", "lease-conflict", "interest-denied", "invalid"] as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type RustNetworkRequestV1 =
  | Readonly<{ kind: "handshake"; requestId: number; hostPacket: Uint8Array; peerPacket: Uint8Array }>
  | Readonly<{ kind: "command-batch"; requestId: number; current: NetworkAuthorityIdentityV1; now: number; commandPackets: readonly Uint8Array[] }>
  | Readonly<{ kind: "delta-delivery"; requestId: number; checkpointPacket: Uint8Array; interest: NetworkInterestSetV1; deltaPacket: Uint8Array }>
  | Readonly<{ kind: "agent-command"; requestId: number; current: NetworkAuthorityIdentityV1; now: number; envelopePacket: Uint8Array; workPacket: Uint8Array }>
  | Readonly<{ kind: "guest-pose"; requestId: number; current: NetworkAuthorityIdentityV1; now: number; commandPacket: Uint8Array }>;

export type RustNetworkResponseV1 =
  | Readonly<{ kind: "handshake"; requestId: number; compatible: boolean; code: string; capabilities: readonly NetworkCapabilityV1[]; maxCommandBytes: number; message: string; recordHash: string }>
  | Readonly<{ kind: "command-batch"; requestId: number; receipts: readonly NetworkCommandReceiptV1[]; authorityFingerprint: string }>
  | Readonly<{ kind: "delta-delivery"; requestId: number; code: "applied" | "duplicate" | "sequence-gap" | "session-mismatch" | "peer-mismatch" | "interest-mismatch" | "stale-from" | "command-ack-regressed"; sequence: number; stateHash: string; message: string }>
  | Readonly<{ kind: "agent-command"; requestId: number; code: "accepted" | "unknown-agent" | "connection-mismatch" | "pending" | "paused" | "revoked" | "expired" | "capability-denied" | "envelope-mismatch"; receipt: NetworkCommandReceiptV1 | null; authorityFingerprint: string }>
  | Readonly<{ kind: "guest-pose"; requestId: number; receipt: NetworkCommandReceiptV1; projection: RustNetworkPlayerPoseProjectionV1 | null; authorityFingerprint: string }>
  | Readonly<{ kind: "error"; requestId: number; code: string; message: string }>;

export class RustNetworkRuntimeContractError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "RustNetworkRuntimeContractError"; }
}

function ascii(bytes: Uint8Array) { return String.fromCharCode(...bytes); }
function hex(bytes: Uint8Array) { return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(""); }
function hashBytes(value: string) {
  if (!HASH_PATTERN.test(value)) throw new RustNetworkRuntimeContractError("hash", "network hash must be canonical 128-bit lowercase hex");
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}
function payloadHash(bytes: Uint8Array) { return new TypeScriptCanonicalHasher("blockwild-network-browser-runtime-v1").writeBytes(bytes).finishHex(); }
function receiptLabel(value: unknown, maximumUtf16: number, name: string): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumUtf16 || encoder.encode(value).byteLength > 4096) {
    throw new RustNetworkRuntimeContractError("receipt", `${name} is outside its native label bound`);
  }
}
function validateReceiptForWire(value: NetworkCommandReceiptV1) {
  receiptLabel(value.commandId, 180, "receipt command id");
  receiptLabel(value.idempotencyKey, 256, "receipt idempotency key");
  receiptLabel(value.peerId, 180, "receipt peer id");
  const identity = createNetworkAuthorityIdentityV1(value.identity.address, value.identity.revision);
  if (identity.stateHash !== value.identity.stateHash) throw new RustNetworkRuntimeContractError("receipt", "receipt authority identity hash mismatch");
  const raw = value as NetworkCommandReceiptV1 & { code?: unknown; message?: unknown };
  if (value.status === "accepted" && ((raw.code !== undefined && raw.code !== null && raw.code !== "")
    || (raw.message !== undefined && raw.message !== ""))) {
    throw new RustNetworkRuntimeContractError("receipt", "accepted Rust receipt carries rejection fields");
  }
  const code = value.status === "rejected" ? value.code : "";
  const message = value.status === "rejected" ? value.message : "";
  if (value.status === "rejected" && (!RECEIPT_CODES.includes(value.code) || typeof value.message !== "string")) throw new RustNetworkRuntimeContractError("receipt", "unknown Rust receipt rejection shape");
  if (encoder.encode(message).byteLength > 4096) throw new RustNetworkRuntimeContractError("receipt", "receipt message exceeds its wire bound");
  const hasher = new TypeScriptCanonicalHasher("blockwild-network-receipt-v1")
    .writeString(value.status).writeString(value.commandId).writeString(value.idempotencyKey)
    .writeString(value.peerId).writeString(value.identity.stateHash);
  if (value.status === "rejected") hasher.writeString(code).writeString(message);
  if (hasher.finishHex() !== value.receiptHash) throw new RustNetworkRuntimeContractError("receipt", "Rust authority receipt hash mismatch");
  return Object.freeze({ code, message });
}
function validateGuestPoseResponseBinding(receipt: NetworkCommandReceiptV1, projection: RustNetworkPlayerPoseProjectionV1 | null) {
  if ((receipt.status === "accepted") !== (projection !== null)) {
    throw new RustNetworkRuntimeContractError("pose", "native player pose response acceptance and projection disagree");
  }
  if (projection && (projection.commandId !== receipt.commandId
    || projection.peerId !== receipt.peerId
    || projection.authorityReceiptHash !== receipt.receiptHash)) {
    throw new RustNetworkRuntimeContractError("pose", "native player pose response receipt and projection disagree");
  }
}

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private append(value: Uint8Array) { this.parts.push(value); this.length += value.byteLength; }
  u8(value: number) { this.append(Uint8Array.of(value)); }
  u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); this.append(bytes); }
  u32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); this.append(bytes); }
  i32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setInt32(0, value, true); this.append(bytes); }
  u64(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw new RustNetworkRuntimeContractError("integer", "network u64 exceeds JavaScript's exact range"); const bytes = new Uint8Array(8); const view = new DataView(bytes.buffer); view.setUint32(0, value >>> 0, true); view.setUint32(4, Math.floor(value / 0x1_0000_0000), true); this.append(bytes); }
  hash(value: string) { this.append(hashBytes(value)); }
  raw(value: Uint8Array) { this.append(value); }
  bytes(value: Uint8Array) { this.u32(value.byteLength); this.append(value); }
  string(value: string) { this.bytes(encoder.encode(value)); }
  identity(value: NetworkAuthorityIdentityV1) { this.string(value.address.universeId); this.string(value.address.locationId); this.u64(value.revision.epoch); this.u64(value.revision.world); this.u64(value.revision.entities); this.u64(value.revision.gameplay); this.u64(value.revision.persistence); this.hash(value.stateHash); }
  interest(value: NetworkInterestSetV1) {
    const canonical = createNetworkInterestSetV1(value);
    if (canonical.interestHash !== value.interestHash) throw new RustNetworkRuntimeContractError("interest", "network interest hash mismatch");
    this.u64(canonical.sequence);
    this.u32(canonical.chunks.length);
    for (const chunk of canonical.chunks) {
      this.string(chunk.universeId); this.string(chunk.locationId); this.i32(chunk.chunkX); this.i32(chunk.chunkZ);
    }
    this.u32(canonical.entityIds.length);
    for (const entityId of canonical.entityIds) this.string(entityId);
    this.hash(canonical.interestHash);
  }
  receipt(value: NetworkCommandReceiptV1) { const { code, message } = validateReceiptForWire(value); this.u8(value.status === "accepted" ? 1 : 2); this.string(value.commandId); this.string(value.idempotencyKey); this.string(value.peerId); this.string(code); this.string(message); this.identity(value.identity); this.hash(value.receiptHash); }
  finish() { const result = new Uint8Array(this.length); let offset = 0; for (const part of this.parts) { result.set(part, offset); offset += part.byteLength; } return result; }
}

class Reader {
  private offset = 0;
  constructor(private readonly source: Uint8Array) {}
  take(length: number) { const end = this.offset + length; if (!Number.isSafeInteger(length) || length < 0 || end > this.source.byteLength) throw new RustNetworkRuntimeContractError("truncated", "network browser message is truncated"); const result = this.source.subarray(this.offset, end); this.offset = end; return result; }
  u8() { return this.take(1)[0]; }
  flag() { const value = this.u8(); if (value !== 0 && value !== 1) throw new RustNetworkRuntimeContractError("flag", "network browser boolean flag is not 0 or 1"); return value === 1; }
  u16() { const bytes = this.take(2); return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, true); }
  u32() { const bytes = this.take(4); return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true); }
  i32() { const bytes = this.take(4); return new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, true); }
  u64() { const bytes = this.take(8); const view = new DataView(bytes.buffer, bytes.byteOffset, 8); const value = view.getUint32(0, true) + view.getUint32(4, true) * 0x1_0000_0000; if (!Number.isSafeInteger(value)) throw new RustNetworkRuntimeContractError("integer", "Rust u64 exceeds JavaScript's exact range"); return value; }
  hash() { return hex(this.take(16)); }
  bytes(maximum = RUST_NETWORK_BROWSER_MAX_WIRE_BYTES_V1) { const length = this.u32(); if (length > maximum) throw new RustNetworkRuntimeContractError("size", "network browser field exceeds its budget"); return Uint8Array.from(this.take(length)); }
  string() { try { return decoder.decode(this.bytes(4096)); } catch { throw new RustNetworkRuntimeContractError("utf8", "network browser string is not valid UTF-8"); } }
  identity() { const address = Object.freeze({ universeId: this.string(), locationId: this.string() }); const revision = Object.freeze({ epoch: this.u64(), world: this.u64(), entities: this.u64(), gameplay: this.u64(), persistence: this.u64() }); const expected = this.hash(); const identity = createNetworkAuthorityIdentityV1(address, revision); if (identity.stateHash !== expected) throw new RustNetworkRuntimeContractError("identity", "network browser authority identity hash mismatch"); return identity; }
  interest() {
    const sequence = this.u64();
    const chunkCount = this.u32();
    if (chunkCount > NETWORK_MAX_INTEREST_CHUNKS_V1) throw new RustNetworkRuntimeContractError("interest", "network interest exceeds its chunk budget");
    const chunks = Array.from({ length: chunkCount }, () => Object.freeze({ universeId: this.string(), locationId: this.string(), chunkX: this.i32(), chunkZ: this.i32() }));
    const entityCount = this.u32();
    if (entityCount > NETWORK_MAX_INTEREST_ENTITIES_V1) throw new RustNetworkRuntimeContractError("interest", "network interest exceeds its entity budget");
    const entityIds = Array.from({ length: entityCount }, () => this.string());
    const expectedHash = this.hash();
    const interest = createNetworkInterestSetV1({ sequence, chunks, entityIds });
    if (interest.interestHash !== expectedHash) throw new RustNetworkRuntimeContractError("interest", "Rust network interest hash mismatch");
    return interest;
  }
  receipt(): NetworkCommandReceiptV1 {
    const status = this.u8(); const commandId = this.string(); const idempotencyKey = this.string(); const peerId = this.string(); const code = this.string(); const message = this.string(); const identity = this.identity(); const receiptHash = this.hash();
    if (status !== 1 && status !== 2) throw new RustNetworkRuntimeContractError("receipt", "unknown Rust receipt status");
    receiptLabel(commandId, 180, "receipt command id"); receiptLabel(idempotencyKey, 256, "receipt idempotency key"); receiptLabel(peerId, 180, "receipt peer id");
    if (status === 1 && (code !== "" || message !== "")) throw new RustNetworkRuntimeContractError("receipt", "accepted Rust receipt carries rejection fields");
    if (status === 2 && !RECEIPT_CODES.includes(code as typeof RECEIPT_CODES[number])) throw new RustNetworkRuntimeContractError("receipt", "unknown Rust receipt rejection code");
    const receipt = status === 1
      ? Object.freeze({ schemaVersion: 1 as const, status: "accepted" as const, commandId, idempotencyKey, peerId, identity, receiptHash })
      : Object.freeze({ schemaVersion: 1 as const, status: "rejected" as const, commandId, idempotencyKey, peerId, code: code as Extract<NetworkCommandReceiptV1, { status: "rejected" }>["code"], message, identity, receiptHash });
    validateReceiptForWire(receipt);
    return receipt;
  }
  finish() { if (this.offset !== this.source.byteLength) throw new RustNetworkRuntimeContractError("trailing", "network browser message contains trailing bytes"); }
}

function wrap(magic: string, kind: number, requestId: number, payload: Uint8Array) {
  const writer = new Writer(); writer.raw(encoder.encode(magic)); writer.u16(RUST_NETWORK_BROWSER_PROTOCOL_V1); writer.u16(kind); writer.u64(requestId); writer.u32(payload.byteLength); writer.hash(payloadHash(payload)); writer.raw(payload); const result = writer.finish();
  if (result.byteLength > RUST_NETWORK_BROWSER_MAX_WIRE_BYTES_V1) throw new RustNetworkRuntimeContractError("size", "network browser message exceeds its V1 budget"); return result;
}

function unwrap(message: Uint8Array, expectedMagic: string) {
  if (!(message instanceof Uint8Array) || message.byteLength < RUST_NETWORK_BROWSER_HEADER_BYTES_V1 || message.byteLength > RUST_NETWORK_BROWSER_MAX_WIRE_BYTES_V1) throw new RustNetworkRuntimeContractError("size", "network browser message is outside its V1 bounds");
  const reader = new Reader(message); if (ascii(reader.take(4)) !== expectedMagic) throw new RustNetworkRuntimeContractError("magic", "network browser magic mismatch"); const protocol = reader.u16(); const kind = reader.u16(); const requestId = reader.u64(); const length = reader.u32(); const expectedHash = reader.hash();
  if (protocol !== RUST_NETWORK_BROWSER_PROTOCOL_V1) throw new RustNetworkRuntimeContractError("protocol", "unsupported network browser protocol"); if (length !== message.byteLength - RUST_NETWORK_BROWSER_HEADER_BYTES_V1) throw new RustNetworkRuntimeContractError("length", "network browser payload length mismatch"); const payload = reader.take(length); reader.finish(); if (payloadHash(payload) !== expectedHash) throw new RustNetworkRuntimeContractError("checksum", "network browser payload checksum mismatch"); return Object.freeze({ kind, requestId, payload });
}

function boundedPackets(packets: readonly Uint8Array[], maximum: number) {
  if (packets.length < 1 || packets.length > RUST_NETWORK_BROWSER_MAX_BATCH_PACKETS_V1) throw new RustNetworkRuntimeContractError("batch", "network packet batch is outside its V1 bounds");
  return packets.map((packet) => { if (!(packet instanceof Uint8Array) || packet.byteLength > maximum) throw new RustNetworkRuntimeContractError("packet", "network packet exceeds its V1 budget"); return Uint8Array.from(packet); });
}

export function encodeRustNetworkCommandBatchRequestV1(requestId: number, current: NetworkAuthorityIdentityV1, now: number, commandPackets: readonly Uint8Array[]) {
  const packets = boundedPackets(commandPackets, NETWORK_MAX_COMMAND_WIRE_BYTES_V1); const payload = new Writer(); payload.identity(current); payload.u64(now); payload.u32(packets.length); for (const packet of packets) payload.bytes(packet); return wrap(REQUEST_MAGIC, 2, requestId, payload.finish());
}
export function encodeRustNetworkHandshakeRequestV1(requestId: number, hostPacket: Uint8Array, peerPacket: Uint8Array) { const packets = boundedPackets([hostPacket, peerPacket], NETWORK_MAX_HANDSHAKE_WIRE_BYTES_V1); const payload = new Writer(); payload.bytes(packets[0]); payload.bytes(packets[1]); return wrap(REQUEST_MAGIC, 1, requestId, payload.finish()); }
export function encodeRustNetworkDeltaDeliveryRequestV1(requestId: number, checkpointPacket: Uint8Array, interest: NetworkInterestSetV1, deltaPacket: Uint8Array) { if (checkpointPacket.byteLength > NETWORK_MAX_CHECKPOINT_WIRE_BYTES_V1) throw new RustNetworkRuntimeContractError("checkpoint", "checkpoint packet exceeds V1 budget"); if (deltaPacket.byteLength > NETWORK_MAX_DELTA_WIRE_BYTES_V1) throw new RustNetworkRuntimeContractError("delta", "delta packet exceeds V1 budget"); const payload = new Writer(); payload.bytes(checkpointPacket); payload.interest(interest); payload.bytes(deltaPacket); return wrap(REQUEST_MAGIC, 3, requestId, payload.finish()); }
export function encodeRustNetworkAgentRequestV1(requestId: number, current: NetworkAuthorityIdentityV1, now: number, envelopePacket: Uint8Array, workPacket: Uint8Array) { if (envelopePacket.byteLength > NETWORK_MAX_COMMAND_WIRE_BYTES_V1 || workPacket.byteLength > NETWORK_MAX_AGENT_WORK_WIRE_BYTES_V1) throw new RustNetworkRuntimeContractError("agent", "agent packet exceeds its V1 budget"); const payload = new Writer(); payload.identity(current); payload.u64(now); payload.bytes(envelopePacket); payload.bytes(workPacket); return wrap(REQUEST_MAGIC, 4, requestId, payload.finish()); }
export function encodeRustNetworkGuestPoseRequestV1(requestId: number, current: NetworkAuthorityIdentityV1, now: number, commandPacket: Uint8Array) { if (!(commandPacket instanceof Uint8Array) || commandPacket.byteLength > NETWORK_MAX_COMMAND_WIRE_BYTES_V1) throw new RustNetworkRuntimeContractError("pose", "guest pose command exceeds its V1 budget"); const payload = new Writer(); payload.identity(current); payload.u64(now); payload.bytes(commandPacket); return wrap(REQUEST_MAGIC, 5, requestId, payload.finish()); }

export function decodeRustNetworkRequestV1(message: Uint8Array): RustNetworkRequestV1 {
  const outer = unwrap(message, REQUEST_MAGIC); const reader = new Reader(outer.payload); let result: RustNetworkRequestV1;
  if (outer.kind === 1) result = Object.freeze({ kind: "handshake", requestId: outer.requestId, hostPacket: reader.bytes(NETWORK_MAX_HANDSHAKE_WIRE_BYTES_V1), peerPacket: reader.bytes(NETWORK_MAX_HANDSHAKE_WIRE_BYTES_V1) });
  else if (outer.kind === 2) { const current = reader.identity(); const now = reader.u64(); const count = reader.u32(); if (count < 1 || count > RUST_NETWORK_BROWSER_MAX_BATCH_PACKETS_V1) throw new RustNetworkRuntimeContractError("batch", "command batch is outside V1 bounds"); result = Object.freeze({ kind: "command-batch", requestId: outer.requestId, current, now, commandPackets: Object.freeze(Array.from({ length: count }, () => reader.bytes(NETWORK_MAX_COMMAND_WIRE_BYTES_V1))) }); }
  else if (outer.kind === 3) result = Object.freeze({ kind: "delta-delivery", requestId: outer.requestId, checkpointPacket: reader.bytes(NETWORK_MAX_CHECKPOINT_WIRE_BYTES_V1), interest: reader.interest(), deltaPacket: reader.bytes(NETWORK_MAX_DELTA_WIRE_BYTES_V1) });
  else if (outer.kind === 4) result = Object.freeze({ kind: "agent-command", requestId: outer.requestId, current: reader.identity(), now: reader.u64(), envelopePacket: reader.bytes(NETWORK_MAX_COMMAND_WIRE_BYTES_V1), workPacket: reader.bytes(NETWORK_MAX_AGENT_WORK_WIRE_BYTES_V1) });
  else if (outer.kind === 5) result = Object.freeze({ kind: "guest-pose", requestId: outer.requestId, current: reader.identity(), now: reader.u64(), commandPacket: reader.bytes(NETWORK_MAX_COMMAND_WIRE_BYTES_V1) });
  else throw new RustNetworkRuntimeContractError("kind", "unknown network browser request"); reader.finish(); return result;
}

const DELTA_CODES = ["applied", "duplicate", "sequence-gap", "session-mismatch", "peer-mismatch", "interest-mismatch", "stale-from", "command-ack-regressed"] as const;
const AGENT_CODES = ["accepted", "unknown-agent", "connection-mismatch", "pending", "paused", "revoked", "expired", "capability-denied", "envelope-mismatch"] as const;
const HANDSHAKE_CODES = ["ok", "schema-mismatch", "protocol-mismatch", "session-mismatch", "role-conflict", "engine-mismatch", "content-mismatch", "generator-mismatch", "command-budget"] as const;

export function encodeRustNetworkResponseV1(response: RustNetworkResponseV1) {
  const payload = new Writer(); let kind: number;
  if (response.kind === "handshake") { kind = 101; payload.u8(response.compatible ? 1 : 0); payload.string(response.code); payload.u32(response.capabilities.length); for (const capability of response.capabilities) { const tag = NETWORK_CAPABILITY_ORDER_V1.indexOf(capability); if (tag < 0) throw new RustNetworkRuntimeContractError("capability", "unknown network capability"); payload.u8(tag); } payload.u32(response.maxCommandBytes); payload.string(response.message); payload.hash(response.recordHash); }
  else if (response.kind === "command-batch") { kind = 102; payload.u32(response.receipts.length); for (const receipt of response.receipts) payload.receipt(receipt); payload.hash(response.authorityFingerprint); }
  else if (response.kind === "delta-delivery") { kind = 103; payload.string(response.code); payload.u64(response.sequence); payload.hash(response.stateHash); payload.string(response.message); }
  else if (response.kind === "agent-command") { kind = 104; payload.string(response.code); payload.u8(response.receipt ? 1 : 0); if (response.receipt) payload.receipt(response.receipt); payload.hash(response.authorityFingerprint); }
  else if (response.kind === "guest-pose") { kind = 105; validateGuestPoseResponseBinding(response.receipt, response.projection); payload.receipt(response.receipt); payload.u8(response.projection ? 1 : 0); if (response.projection) payload.bytes(encodeRustNetworkPlayerPoseProjectionV1(response.projection)); payload.hash(response.authorityFingerprint); }
  else { kind = 255; payload.string(response.code); payload.string(response.message); }
  return wrap(RESPONSE_MAGIC, kind, response.requestId, payload.finish());
}

export function decodeRustNetworkResponseV1(message: Uint8Array): RustNetworkResponseV1 {
  const outer = unwrap(message, RESPONSE_MAGIC); const reader = new Reader(outer.payload); let result: RustNetworkResponseV1;
  if (outer.kind === 101) { const compatible = reader.flag(); const code = reader.string(); if (!HANDSHAKE_CODES.includes(code as never)) throw new RustNetworkRuntimeContractError("handshake", "unknown Rust handshake result"); const count = reader.u32(); if (count > NETWORK_CAPABILITY_ORDER_V1.length) throw new RustNetworkRuntimeContractError("capability", "handshake capability response exceeds V1 bounds"); const capabilities = Object.freeze(Array.from({ length: count }, () => { const capability = NETWORK_CAPABILITY_ORDER_V1[reader.u8()]; if (!capability) throw new RustNetworkRuntimeContractError("capability", "unknown Rust network capability"); return capability; })); if (new Set(capabilities).size !== capabilities.length) throw new RustNetworkRuntimeContractError("capability", "Rust handshake response repeats a capability"); result = Object.freeze({ kind: "handshake", requestId: outer.requestId, compatible, code, capabilities, maxCommandBytes: reader.u32(), message: reader.string(), recordHash: reader.hash() }); }
  else if (outer.kind === 102) { const count = reader.u32(); if (count > RUST_NETWORK_BROWSER_MAX_BATCH_PACKETS_V1) throw new RustNetworkRuntimeContractError("batch", "receipt batch exceeds V1 bounds"); result = Object.freeze({ kind: "command-batch", requestId: outer.requestId, receipts: Object.freeze(Array.from({ length: count }, () => reader.receipt())), authorityFingerprint: reader.hash() }); }
  else if (outer.kind === 103) { const code = reader.string(); if (!DELTA_CODES.includes(code as never)) throw new RustNetworkRuntimeContractError("delta", "unknown delta delivery result"); result = Object.freeze({ kind: "delta-delivery", requestId: outer.requestId, code: code as Extract<RustNetworkResponseV1, { kind: "delta-delivery" }>["code"], sequence: reader.u64(), stateHash: reader.hash(), message: reader.string() }); }
  else if (outer.kind === 104) { const code = reader.string(); if (!AGENT_CODES.includes(code as never)) throw new RustNetworkRuntimeContractError("agent", "unknown agent authority result"); result = Object.freeze({ kind: "agent-command", requestId: outer.requestId, code: code as Extract<RustNetworkResponseV1, { kind: "agent-command" }>["code"], receipt: reader.flag() ? reader.receipt() : null, authorityFingerprint: reader.hash() }); }
  else if (outer.kind === 105) { const receipt = reader.receipt(); const projection = reader.flag() ? decodeRustNetworkPlayerPoseProjectionV1(reader.bytes(RUST_NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1)) : null; validateGuestPoseResponseBinding(receipt, projection); result = Object.freeze({ kind: "guest-pose", requestId: outer.requestId, receipt, projection, authorityFingerprint: reader.hash() }); }
  else if (outer.kind === 255) result = Object.freeze({ kind: "error", requestId: outer.requestId, code: reader.string(), message: reader.string() });
  else throw new RustNetworkRuntimeContractError("kind", "unknown network browser response"); reader.finish(); return result;
}

export function rustNetworkTransferListV1(request: RustNetworkRequestV1) {
  const buffers = request.kind === "handshake" ? [request.hostPacket.buffer, request.peerPacket.buffer]
    : request.kind === "command-batch" ? request.commandPackets.map((packet) => packet.buffer)
      : request.kind === "delta-delivery" ? [request.checkpointPacket.buffer, request.deltaPacket.buffer]
        : request.kind === "agent-command" ? [request.envelopePacket.buffer, request.workPacket.buffer]
          : [request.commandPacket.buffer];
  return [...new Set(buffers)].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
}
