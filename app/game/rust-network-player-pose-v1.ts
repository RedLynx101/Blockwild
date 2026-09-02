import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const POSE_MAGIC = encoder.encode("BWNP");
const PROJECTION_MAGIC = encoder.encode("BWPP");
const SCHEMA = 1;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const ZERO_HASH = "00000000000000000000000000000000";
const HASH_PATTERN = /^[0-9a-f]{32}$/u;

export const RUST_NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1 = 4 * 1024;
export const RUST_NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1 = 16 * 1024;

export class RustNetworkPlayerPoseV1Error extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RustNetworkPlayerPoseV1Error";
  }
}

export type RustNetworkPlayerPoseV1 = Readonly<{
  schema: 1;
  playerId: string;
  tick: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  selected?: number;
  shieldRaised: boolean;
  crouching: boolean;
  sprinting: boolean;
  action: "none" | "mine" | "use";
  swimming?: number;
  seated?: number;
  boatId?: string;
  boatSeat?: number;
  boatForward?: number;
  boatTurn?: number;
  mountedCreatureId?: number;
  mountedCreatureSeat?: number;
  poseHash: string;
}>;

export type RustNetworkPlayerPoseProjectionV1 = Readonly<{
  schema: 1;
  sessionId: string;
  peerId: string;
  connectionId: string;
  playerId: string;
  commandId: string;
  commandSequence: number;
  commandHash: string;
  authorityReceiptHash: string;
  presentedDeltaSequence: number;
  presentedIdentityHash: string;
  recordRevision: number;
  previousRecordHash: string;
  pose: RustNetworkPlayerPoseV1;
  recordHash: string;
  projectionHash: string;
}>;

type PoseInput = Readonly<Record<string, unknown>>;

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private append(value: Uint8Array) { this.parts.push(value); this.length += value.byteLength; }
  raw(value: Uint8Array) { this.append(value); return this; }
  u8(value: number) { this.append(Uint8Array.of(value)); return this; }
  u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); this.append(bytes); return this; }
  u32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); this.append(bytes); return this; }
  i32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setInt32(0, value, true); this.append(bytes); return this; }
  u64(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) fail("integer", "pose integer exceeds JavaScript's exact range");
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, value >>> 0, true);
    view.setUint32(4, Math.floor(value / 0x1_0000_0000), true);
    this.append(bytes);
    return this;
  }
  string(value: string) { const bytes = encoder.encode(value); this.u32(bytes.byteLength); this.append(bytes); return this; }
  hash(value: string) { this.append(hashBytes(value)); return this; }
  finish() { const result = new Uint8Array(this.length); let offset = 0; for (const part of this.parts) { result.set(part, offset); offset += part.byteLength; } return result; }
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  private take(length: number) { if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.byteLength) fail("truncated", "native pose wire is truncated"); const value = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return value; }
  raw(length: number) { return this.take(length); }
  u8() { return this.take(1)[0]!; }
  flag() { const value = this.u8(); if (value !== 0 && value !== 1) fail("flag", "native pose wire contains a non-canonical flag"); return value === 1; }
  u16() { const value = this.take(2); return new DataView(value.buffer, value.byteOffset, 2).getUint16(0, true); }
  u32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, true); }
  i32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getInt32(0, true); }
  u64() { const value = this.take(8); const view = new DataView(value.buffer, value.byteOffset, 8); const result = view.getUint32(0, true) + view.getUint32(4, true) * 0x1_0000_0000; if (!Number.isSafeInteger(result)) fail("integer", "native pose u64 exceeds JavaScript's exact range"); return result; }
  string(maximumUtf16 = 180) { const length = this.u32(); if (length > 4096) fail("label", "native pose label exceeds its byte budget"); let value: string; try { value = decoder.decode(this.take(length)); } catch { fail("utf8", "native pose label is not valid UTF-8"); } if (!value! || value!.length > maximumUtf16) fail("label", "native pose label is empty or too long"); return value!; }
  hash() { return hex(this.take(16)); }
  finish() { if (this.offset !== this.bytes.byteLength) fail("trailing", "native pose wire contains trailing bytes"); }
}

function fail(code: string, message: string): never { throw new RustNetworkPlayerPoseV1Error(code, message); }
function record(value: unknown): PoseInput | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as PoseInput : null; }
function hashBytes(value: string) { if (!HASH_PATTERN.test(value)) fail("hash", "native pose hash is not canonical"); return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)); }
function hex(value: Uint8Array) { return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function equalBytes(left: Uint8Array, right: Uint8Array) { return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]); }
function requireMagic(reader: Reader, expected: Uint8Array) { if (!equalBytes(reader.raw(expected.byteLength), expected)) fail("magic", "native pose wire magic mismatch"); }
function label(value: unknown, name: string) { if (typeof value !== "string" || value.length < 1 || value.length > 180) fail("label", `${name} is empty or exceeds its UTF-16 bound`); return value; }
function integer(value: unknown, minimum: number, maximum: number, name: string) { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail("integer", `${name} is outside its native bound`); return value as number; }
function finite(value: unknown, minimum: number, maximum: number, name: string) { if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail("number", `${name} is outside its native bound`); return value; }
function optionalInteger(value: unknown, minimum: number, maximum: number, name: string) { return value === undefined ? undefined : integer(value, minimum, maximum, name); }
function fixed(value: unknown, scale: number, minimum: number, maximum: number, name: string) { const normalized = Math.round(finite(value, minimum / scale, maximum / scale, name) * scale); return integer(normalized, minimum, maximum, name); }
function optionalFixed(value: unknown, scale: number, minimum: number, maximum: number, name: string) { return value === undefined ? undefined : fixed(value, scale, minimum, maximum, name); }
function boolean(value: unknown, name: string, fallback = false) { if (value === undefined) return fallback; if (typeof value !== "boolean") fail("boolean", `${name} is not boolean`); return value; }
function boundedWire(bytes: Uint8Array, maximum: number, name: string) { if (bytes.byteLength > maximum) fail("budget", `${name} exceeds its V1 wire budget`); return bytes; }

function validateProjectionShape(value: RustNetworkPlayerPoseProjectionV1, pose: RustNetworkPlayerPoseV1) {
  label(value.sessionId, "sessionId");
  label(value.peerId, "peerId");
  label(value.connectionId, "connectionId");
  label(value.playerId, "playerId");
  label(value.commandId, "commandId");
  integer(value.commandSequence, 0, MAX_SAFE_INTEGER, "commandSequence");
  integer(value.presentedDeltaSequence, 0, MAX_SAFE_INTEGER, "presentedDeltaSequence");
  integer(value.recordRevision, 1, MAX_SAFE_INTEGER, "recordRevision");
  if (value.playerId !== pose.playerId) fail("player", "native pose projection player does not match its pose");
  hashBytes(value.commandHash);
  hashBytes(value.authorityReceiptHash);
  hashBytes(value.presentedIdentityHash);
  hashBytes(value.previousRecordHash);
  hashBytes(value.recordHash);
  hashBytes(value.projectionHash);
  if ((value.recordRevision === 1) !== (value.previousRecordHash === ZERO_HASH)) {
    fail("record", "native pose projection predecessor does not match its revision");
  }
}

function option<T>(writer: Writer, value: T | undefined, write: (value: T) => void) {
  writer.u8(value === undefined ? 0 : 1);
  if (value !== undefined) write(value);
}

function readOption<T>(reader: Reader, read: () => T) { return reader.flag() ? read() : undefined; }

export function encodeRustNetworkPlayerPoseV1(value: unknown) {
  const source = record(value);
  if (!source) fail("shape", "player pose is not an object");
  const playerId = label(source.playerId, "playerId");
  const tick = integer(source.tick, 0, MAX_SAFE_INTEGER, "tick");
  const coordinates = [
    fixed(source.x, 1_000, -2_000_000_000, 2_000_000_000, "x"),
    fixed(source.y, 1_000, -4_096_000, 4_096_000, "y"),
    fixed(source.z, 1_000, -2_000_000_000, 2_000_000_000, "z"),
  ] as const;
  const yaw = fixed(source.yaw, 1_000, -100_000_000, 100_000_000, "yaw");
  const pitch = fixed(source.pitch, 1_000, -3_142, 3_142, "pitch");
  const velocity = [
    fixed(source.vx, 1_000, -256_000, 256_000, "vx"),
    fixed(source.vy, 1_000, -256_000, 256_000, "vy"),
    fixed(source.vz, 1_000, -256_000, 256_000, "vz"),
  ] as const;
  const selected = optionalInteger(source.selected, 0, 8, "selected");
  const action = source.action ?? "none";
  if (action !== "none" && action !== "mine" && action !== "use") fail("action", "player pose action is invalid");
  const swimming = optionalFixed(source.swimming, 1_000, 0, 1_000, "swimming");
  const seated = optionalFixed(source.seated, 1_000, 0, 1_000, "seated");
  const boatId = source.boatId === undefined ? undefined : label(source.boatId, "boatId");
  const boatSeat = optionalInteger(source.boatSeat, 0, 1, "boatSeat");
  const boatForward = optionalFixed(source.boatForward, 1_000, -1_000, 1_000, "boatForward");
  const boatTurn = optionalFixed(source.boatTurn, 1_000, -1_000, 1_000, "boatTurn");
  if (!boatId && (boatSeat !== undefined || boatForward !== undefined || boatTurn !== undefined)) fail("boat", "boat pose fields require boatId");
  const mountedCreatureId = optionalInteger(source.mountedCreatureId, 0, MAX_SAFE_INTEGER, "mountedCreatureId");
  const mountedCreatureSeat = optionalInteger(source.mountedCreatureSeat, 0, 3, "mountedCreatureSeat");
  if (mountedCreatureId === undefined && mountedCreatureSeat !== undefined) fail("mount", "mountedCreatureSeat requires mountedCreatureId");

  const writer = new Writer().raw(POSE_MAGIC).u16(SCHEMA).string(playerId).u64(tick)
    .i32(coordinates[0]).i32(coordinates[1]).i32(coordinates[2]).i32(yaw).i32(pitch)
    .i32(velocity[0]).i32(velocity[1]).i32(velocity[2])
    .u8(boolean(source.grounded, "grounded") ? 1 : 0);
  option(writer, selected, (entry) => writer.u8(entry));
  writer.u8(boolean(source.shieldRaised, "shieldRaised") ? 1 : 0)
    .u8(boolean(source.crouching, "crouching") ? 1 : 0)
    .u8(boolean(source.sprinting, "sprinting") ? 1 : 0)
    .u8(action === "none" ? 0 : action === "mine" ? 1 : 2);
  option(writer, swimming, (entry) => writer.u16(entry));
  option(writer, seated, (entry) => writer.u16(entry));
  option(writer, boatId, (entry) => writer.string(entry));
  option(writer, boatSeat, (entry) => writer.u8(entry));
  option(writer, boatForward, (entry) => writer.i32(entry));
  option(writer, boatTurn, (entry) => writer.i32(entry));
  option(writer, mountedCreatureId, (entry) => writer.u64(entry));
  option(writer, mountedCreatureSeat, (entry) => writer.u8(entry));
  const canonical = writer.finish();
  const poseHash = new TypeScriptCanonicalHasher("blockwild-network-player-pose-payload-v1").writeBytes(canonical).finishHex();
  return boundedWire(
    new Writer().raw(canonical).hash(poseHash).finish(),
    RUST_NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1,
    "native player pose",
  );
}

export function decodeRustNetworkPlayerPoseV1(bytes: Uint8Array): RustNetworkPlayerPoseV1 {
  if (!(bytes instanceof Uint8Array)) fail("shape", "native pose payload is not bytes");
  boundedWire(bytes, RUST_NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1, "native player pose");
  const reader = new Reader(bytes);
  requireMagic(reader, POSE_MAGIC);
  if (reader.u16() !== SCHEMA) fail("schema", "native pose schema mismatch");
  const playerId = reader.string();
  const tick = reader.u64();
  const x = reader.i32() / 1_000;
  const y = reader.i32() / 1_000;
  const z = reader.i32() / 1_000;
  const yaw = reader.i32() / 1_000;
  const pitch = reader.i32() / 1_000;
  const vx = reader.i32() / 1_000;
  const vy = reader.i32() / 1_000;
  const vz = reader.i32() / 1_000;
  const grounded = reader.flag();
  const selected = readOption(reader, () => reader.u8());
  const shieldRaised = reader.flag();
  const crouching = reader.flag();
  const sprinting = reader.flag();
  const actionTag = reader.u8();
  const action = actionTag === 0 ? "none" : actionTag === 1 ? "mine" : actionTag === 2 ? "use" : fail("action", "native pose action tag is invalid");
  const swimming = readOption(reader, () => reader.u16() / 1_000);
  const seated = readOption(reader, () => reader.u16() / 1_000);
  const boatId = readOption(reader, () => reader.string());
  const boatSeat = readOption(reader, () => reader.u8());
  const boatForward = readOption(reader, () => reader.i32() / 1_000);
  const boatTurn = readOption(reader, () => reader.i32() / 1_000);
  const mountedCreatureId = readOption(reader, () => reader.u64());
  const mountedCreatureSeat = readOption(reader, () => reader.u8());
  const poseHash = reader.hash();
  reader.finish();
  const expected = new TypeScriptCanonicalHasher("blockwild-network-player-pose-payload-v1")
    .writeBytes(bytes.subarray(0, bytes.byteLength - 16)).finishHex();
  if (poseHash !== expected) fail("hash", "native pose payload hash mismatch");
  const canonical = encodeRustNetworkPlayerPoseV1({
    playerId, tick, x, y, z, yaw, pitch, vx, vy, vz, grounded, selected,
    shieldRaised, crouching, sprinting, action, swimming, seated, boatId, boatSeat,
    boatForward, boatTurn, mountedCreatureId, mountedCreatureSeat,
  });
  if (!equalBytes(canonical, bytes)) fail("canonical", "native pose payload is not canonically normalized");
  return Object.freeze({
    schema: 1, playerId, tick, x, y, z, yaw, pitch, vx, vy, vz, grounded,
    ...(selected === undefined ? {} : { selected }), shieldRaised, crouching, sprinting, action,
    ...(swimming === undefined ? {} : { swimming }), ...(seated === undefined ? {} : { seated }),
    ...(boatId === undefined ? {} : { boatId }), ...(boatSeat === undefined ? {} : { boatSeat }),
    ...(boatForward === undefined ? {} : { boatForward }), ...(boatTurn === undefined ? {} : { boatTurn }),
    ...(mountedCreatureId === undefined ? {} : { mountedCreatureId }),
    ...(mountedCreatureSeat === undefined ? {} : { mountedCreatureSeat }), poseHash,
  });
}

export function decodeRustNetworkPlayerPoseProjectionV1(bytes: Uint8Array): RustNetworkPlayerPoseProjectionV1 {
  if (!(bytes instanceof Uint8Array)) fail("shape", "native pose projection is not bytes");
  boundedWire(bytes, RUST_NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1, "native player pose projection");
  const reader = new Reader(bytes);
  requireMagic(reader, PROJECTION_MAGIC);
  if (reader.u16() !== SCHEMA) fail("schema", "native pose projection schema mismatch");
  const sessionId = reader.string();
  const peerId = reader.string();
  const connectionId = reader.string();
  const playerId = reader.string();
  const commandId = reader.string();
  const commandSequence = reader.u64();
  const commandHash = reader.hash();
  const authorityReceiptHash = reader.hash();
  const presentedDeltaSequence = reader.u64();
  const presentedIdentityHash = reader.hash();
  const recordRevision = reader.u64();
  const previousRecordHash = reader.hash();
  const poseLength = reader.u32();
  if (poseLength > 4096) fail("budget", "native pose projection payload exceeds its bound");
  const pose = decodeRustNetworkPlayerPoseV1(Uint8Array.from(reader.raw(poseLength)));
  const recordHash = reader.hash();
  const projectionHash = reader.hash();
  reader.finish();
  const projection = {
    schema: 1 as const, sessionId, peerId, connectionId, playerId, commandId, commandSequence,
    commandHash, authorityReceiptHash, presentedDeltaSequence, presentedIdentityHash,
    recordRevision, previousRecordHash, pose, recordHash, projectionHash,
  };
  validateProjectionShape(projection, pose);
  const expectedRecordHash = new TypeScriptCanonicalHasher("blockwild-network-player-pose-record-v1")
    .writeString(sessionId).writeString(peerId).writeString(playerId).writeU64(recordRevision)
    .writeBytes(hashBytes(previousRecordHash)).writeBytes(hashBytes(pose.poseHash)).finishHex();
  if (recordHash !== expectedRecordHash) fail("hash", "native pose record hash mismatch");
  const expectedProjectionHash = new TypeScriptCanonicalHasher("blockwild-network-player-pose-projection-v1")
    .writeString(sessionId).writeString(peerId).writeString(connectionId).writeString(playerId).writeString(commandId)
    .writeU64(commandSequence).writeBytes(hashBytes(commandHash)).writeBytes(hashBytes(authorityReceiptHash))
    .writeU64(presentedDeltaSequence).writeBytes(hashBytes(presentedIdentityHash)).writeU64(recordRevision)
    .writeBytes(hashBytes(recordHash)).finishHex();
  if (projectionHash !== expectedProjectionHash) fail("hash", "native pose projection hash mismatch");
  return Object.freeze(projection);
}

export function encodeRustNetworkPlayerPoseProjectionV1(value: RustNetworkPlayerPoseProjectionV1) {
  if (value.schema !== 1) fail("schema", "native pose projection schema mismatch");
  const pose = encodeRustNetworkPlayerPoseV1(value.pose);
  const canonicalPose = decodeRustNetworkPlayerPoseV1(pose);
  if (canonicalPose.poseHash !== value.pose.poseHash) fail("hash", "native pose projection carries a stale pose hash");
  validateProjectionShape(value, canonicalPose);
  const expectedRecordHash = new TypeScriptCanonicalHasher("blockwild-network-player-pose-record-v1")
    .writeString(value.sessionId).writeString(value.peerId).writeString(value.playerId).writeU64(value.recordRevision)
    .writeBytes(hashBytes(value.previousRecordHash)).writeBytes(hashBytes(value.pose.poseHash)).finishHex();
  if (expectedRecordHash !== value.recordHash) fail("hash", "native pose record hash mismatch");
  const expectedProjectionHash = new TypeScriptCanonicalHasher("blockwild-network-player-pose-projection-v1")
    .writeString(value.sessionId).writeString(value.peerId).writeString(value.connectionId).writeString(value.playerId).writeString(value.commandId)
    .writeU64(value.commandSequence).writeBytes(hashBytes(value.commandHash)).writeBytes(hashBytes(value.authorityReceiptHash))
    .writeU64(value.presentedDeltaSequence).writeBytes(hashBytes(value.presentedIdentityHash)).writeU64(value.recordRevision)
    .writeBytes(hashBytes(value.recordHash)).finishHex();
  if (expectedProjectionHash !== value.projectionHash) fail("hash", "native pose projection hash mismatch");
  const writer = new Writer().raw(PROJECTION_MAGIC).u16(SCHEMA)
    .string(value.sessionId).string(value.peerId).string(value.connectionId).string(value.playerId).string(value.commandId)
    .u64(value.commandSequence).hash(value.commandHash).hash(value.authorityReceiptHash)
    .u64(value.presentedDeltaSequence).hash(value.presentedIdentityHash).u64(value.recordRevision)
    .hash(value.previousRecordHash).u32(pose.byteLength).raw(pose).hash(value.recordHash).hash(value.projectionHash);
  return boundedWire(
    writer.finish(),
    RUST_NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1,
    "native player pose projection",
  );
}
