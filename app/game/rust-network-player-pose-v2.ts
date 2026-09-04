/**
 * BWPE schema2: exact native runtime pose projection, separate from quantized
 * BWNP/BWPP V1. NOT a native-origin proof, input admission path, migration
 * executor or consent/ownership capability. stateHash is an opaque integrated
 * runtime binding (blockwild-integrated-authority-v2); it is not reconstructed
 * from this pose. Both wire hashes are noncryptographic, not authentication.
 *
 * Header: magic[4], schema:u16(2), flags:u16(0), bodyLength:u32. Body: five
 * u16-length UTF-8 labels; packed player/entity u64; tick/inputSequence u64;
 * seven revision u64; stateHash[16]; position/velocity/yaw/pitch as8f64;
 * grounded:u8(0|1). Trailer: exact poseHash[16], bound projectionHash[16].
 * All numeric fields are little-endian. No rounding, clamping, angle wrapping,
 * zero normalization, ID derivation or browser-origin authority is performed.
 */
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

export const RUST_NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V2 = 4096;
export const RUST_NETWORK_PLAYER_POSE_SCHEMA_V2 = 2;
// Native simulation/collision.rs:26-27 and PhysicsJobV1::validate.
export const RUST_NETWORK_PLAYER_POSE_MAX_ABS_POSITION_V2 = 33_554_432;
export const RUST_NETWORK_PLAYER_POSE_MAX_ABS_VELOCITY_V2 = 4096;
export type RustNetworkPlayerPoseRevisionV2 = Readonly<{
  epoch: bigint; world: bigint; entities: bigint; gameplay: bigint; persistence: bigint; network: bigint; simulation: bigint;
}>;
export type RustNetworkPlayerPoseV2 = Readonly<{
  schemaVersion: 2; universeId: string; locationId: string; sessionId: string; actorId: string; externalEntityId: string;
  playerId: bigint; entityId: bigint; tick: bigint; inputSequence: bigint; revision: RustNetworkPlayerPoseRevisionV2;
  stateHash: string; position: readonly [number, number, number]; velocity: readonly [number, number, number];
  yaw: number; pitch: number; grounded: boolean; poseHash: string; projectionHash: string;
}>;
const KEYS = ["schemaVersion", "universeId", "locationId", "sessionId", "actorId", "externalEntityId", "playerId", "entityId", "tick", "inputSequence", "revision", "stateHash", "position", "velocity", "yaw", "pitch", "grounded", "poseHash", "projectionHash"] as const;
const REVISION_KEYS = ["epoch", "world", "entities", "gameplay", "persistence", "network", "simulation"] as const;
const LABEL_KEYS = ["universeId", "locationId", "sessionId", "actorId", "externalEntityId"] as const;
const LABEL_BYTE_CAPS = [64 * 3, 128 * 3, 180 * 3, 512, 512] as const;
const LABEL_UNIT_CAPS = [64, 128, 180] as const;
const POSE_DOMAIN = "blockwild-network-player-exact-pose-v2";
const PROJECTION_DOMAIN = "blockwild-network-player-exact-projection-v2";
const MAGIC = [66, 87, 80, 69] as const;
const HEADER = 12; const TRAILER = 32;
const ZERO_U64 = BigInt(0); const U64_GENERATION_SHIFT = BigInt(32); const MAX_U64 = BigInt("18446744073709551615");
const utf8 = new TextEncoder(); const decodeUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const byteOffsetGetter = Object.getOwnPropertyDescriptor(typedPrototype, "byteOffset")!.get!;
const bufferGetter = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
const resizableGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const setBytes = Uint8Array.prototype.set;
function fail(message: string): never { throw new Error(`BWPE v2: ${message}`); }

/** Only ordinary own-data records are admitted; caller getters are never read. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("record shape");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) fail("unknown or missing field");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d?.enumerable || !("value" in d)) fail("own data fields required"); result[key] = d.value; }
  return result;
}
function u64(value: unknown): bigint { if (typeof value !== "bigint" || value < ZERO_U64 || value > MAX_U64) fail("exact u64 required"); return value; }
function number(value: unknown, bound: number): number { if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > bound) fail("native f64 domain"); return value; }
function vector(value: unknown, bound: number): readonly [number, number, number] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 3 || Reflect.ownKeys(value).length !== 4) fail("vec3 shape");
  const out: number[] = [];
  for (let i = 0; i < 3; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d?.enumerable || !("value" in d)) fail("vec3 data required"); out.push(number(d.value, bound)); }
  return Object.freeze(out) as unknown as readonly [number, number, number];
}
function label(value: unknown, index: number): string {
  const unitCap = index < 3 ? LABEL_UNIT_CAPS[index] : 512;
  // Bound before encoding. Native runtime actor/external labels use512UTF-8
  // bytes with no controls; config/network labels use their UTF-16 unit caps.
  if (typeof value !== "string" || value.length === 0 || value.length > unitCap || /[\ud800-\udfff]/u.test(value)) fail("label bound or Unicode");
  if (index < 2 && /[\u0000-\u001f\u007f]/u.test(value)) fail("world address label");
  if (index >= 3 && (utf8.encode(value).length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(value))) fail("runtime binding label");
  return value;
}
function hashHex(value: unknown): string { if (typeof value !== "string" || !/^[0-9a-f]{32}$/u.test(value)) fail("canonical hash must be16bytes lowercase hex"); return value; }
function hashBytes(value: string) { const bytes = new Uint8Array(16); for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16); return bytes; }
function hex(bytes: Uint8Array) { let result = ""; for (const byte of bytes) result += byte.toString(16).padStart(2, "0"); return result; }
function digest(domain: string, bytes: Uint8Array) { return new TypeScriptCanonicalHasher(domain).writeBytes(bytes).finishHex(); }
function snapshot(value: unknown): RustNetworkPlayerPoseV2 {
  const s = record(value, KEYS); if (s.schemaVersion !== 2) fail("schema mismatch");
  const revision = record(s.revision, REVISION_KEYS); for (const key of REVISION_KEYS) revision[key] = u64(revision[key]);
  const labels: Record<string, string> = {}; LABEL_KEYS.forEach((key, i) => { labels[key] = label(s[key], i); });
  const playerId = u64(s.playerId); const entityId = u64(s.entityId);
  if (playerId === ZERO_U64 || (entityId >> U64_GENERATION_SHIFT) === ZERO_U64) fail("packed player/entity identity");
  if (typeof s.grounded !== "boolean") fail("boolean required");
  return Object.freeze({ schemaVersion: 2, ...labels, playerId, entityId, tick: u64(s.tick), inputSequence: u64(s.inputSequence),
    revision: Object.freeze(revision), stateHash: hashHex(s.stateHash), position: vector(s.position, RUST_NETWORK_PLAYER_POSE_MAX_ABS_POSITION_V2),
    velocity: vector(s.velocity, RUST_NETWORK_PLAYER_POSE_MAX_ABS_VELOCITY_V2), yaw: number(s.yaw, Math.PI), pitch: number(s.pitch, Math.PI / 2),
    grounded: s.grounded, poseHash: hashHex(s.poseHash), projectionHash: hashHex(s.projectionHash) }) as RustNetworkPlayerPoseV2;
}
function bytesSnapshot(value: Uint8Array) {
  if (!value || Object.getPrototypeOf(value) !== Uint8Array.prototype) fail("ordinary Uint8Array required");
  const length: number = byteLengthGetter.call(value); if (length < HEADER + TRAILER || length > RUST_NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V2) fail("wire budget");
  const own = Reflect.ownKeys(value); if (own.length !== length) fail("byte hooks forbidden");
  for (const key of own) if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length) fail("byte hooks forbidden");
  const buffer: ArrayBuffer = bufferGetter.call(value);
  if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || resizableGetter?.call(buffer)) fail("fixed nonshared buffer required");
  const out = new Uint8Array(length); setBytes.call(out, new Uint8Array(buffer, byteOffsetGetter.call(value), length)); return out;
}
class Writer {
  readonly bytes = new Uint8Array(RUST_NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V2); readonly view = new DataView(this.bytes.buffer); offset = 0;
  raw(value: Uint8Array) { if (this.offset + value.length > this.bytes.length) fail("wire budget"); this.bytes.set(value, this.offset); this.offset += value.length; }
  u16(value: number) { this.view.setUint16(this.offset, value, true); this.offset += 2; }
  u64(value: bigint) { this.view.setBigUint64(this.offset, value, true); this.offset += 8; }
  f64(value: number) { this.view.setFloat64(this.offset, value, true); this.offset += 8; }
  string(value: string) { const bytes = utf8.encode(value); this.u16(bytes.length); this.raw(bytes); }
  finish() { return this.bytes.slice(0, this.offset); }
}
function writePose(w: Writer, s: RustNetworkPlayerPoseV2) { for (const value of s.position) w.f64(value); for (const value of s.velocity) w.f64(value); w.f64(s.yaw); w.f64(s.pitch); w.raw(Uint8Array.of(Number(s.grounded))); }
function encodeSnapshot(s: RustNetworkPlayerPoseV2) {
  const pose = new Writer(); pose.u16(2); writePose(pose, s);
  const poseHash = digest(POSE_DOMAIN, pose.finish()); if (poseHash !== s.poseHash) fail("exact pose hash mismatch");
  const body = new Writer(); for (const key of LABEL_KEYS) body.string(s[key]);
  for (const key of ["playerId", "entityId", "tick", "inputSequence"] as const) body.u64(s[key]);
  for (const key of REVISION_KEYS) body.u64(s.revision[key]); body.raw(hashBytes(s.stateHash)); writePose(body, s);
  const prefix = new Writer(); prefix.raw(Uint8Array.from(MAGIC)); prefix.u16(2); prefix.u16(0);
  prefix.view.setUint32(prefix.offset, body.offset, true); prefix.offset += 4; prefix.raw(body.finish()); prefix.raw(hashBytes(poseHash));
  const projectionHash = digest(PROJECTION_DOMAIN, prefix.finish()); if (projectionHash !== s.projectionHash) fail("bound projection hash mismatch");
  prefix.raw(hashBytes(projectionHash)); return prefix.finish();
}
/** Re-encode an already hashed projection; never derive authority from caller fields. */
export function encodeRustNetworkPlayerPoseV2(value: unknown): Uint8Array { return encodeSnapshot(snapshot(value)); }
class Reader {
  offset = 0; readonly view: DataView;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  raw(count: number) { if (count < 0 || this.offset + count > this.bytes.length) fail("truncated packet"); const result = this.bytes.subarray(this.offset, this.offset + count); this.offset += count; return result; }
  u16() { const offset = this.offset; this.raw(2); return this.view.getUint16(offset, true); }
  u32() { const offset = this.offset; this.raw(4); return this.view.getUint32(offset, true); }
  u64() { const offset = this.offset; this.raw(8); return this.view.getBigUint64(offset, true); }
  f64() { const offset = this.offset; this.raw(8); return this.view.getFloat64(offset, true); }
  string(index: number) { const length = this.u16(); if (length === 0 || length > LABEL_BYTE_CAPS[index]) fail("string byte budget"); return label(decodeUtf8.decode(this.raw(length)), index); }
}
export function decodeRustNetworkPlayerPoseV2(value: Uint8Array): RustNetworkPlayerPoseV2 {
  const bytes = bytesSnapshot(value); const r = new Reader(bytes);
  if (!r.raw(4).every((byte, i) => byte === MAGIC[i])) fail("magic mismatch");
  if (r.u16() !== 2) fail("schema mismatch"); if (r.u16() !== 0) fail("reserved flags");
  const bodyLength = r.u32(); if (bodyLength + HEADER + TRAILER !== bytes.length) fail("body length or trailing bytes");
  const s: Record<string, unknown> = { schemaVersion: 2 };
  LABEL_KEYS.forEach((key, i) => { s[key] = r.string(i); });
  for (const key of ["playerId", "entityId", "tick", "inputSequence"] as const) s[key] = r.u64();
  const revision: Record<string, bigint> = {}; for (const key of REVISION_KEYS) revision[key] = r.u64(); s.revision = revision;
  s.stateHash = hex(r.raw(16)); s.position = [r.f64(), r.f64(), r.f64()]; s.velocity = [r.f64(), r.f64(), r.f64()];
  s.yaw = r.f64(); s.pitch = r.f64(); const flag = r.raw(1)[0]; if (flag > 1) fail("boolean tag"); s.grounded = flag === 1;
  if (r.offset !== HEADER + bodyLength) fail("body is not canonical");
  s.poseHash = hex(r.raw(16)); s.projectionHash = hex(r.raw(16)); const result = snapshot(s);
  const canonical = encodeSnapshot(result); if (!canonical.every((byte, i) => byte === bytes[i])) fail("noncanonical packet"); return result;
}
