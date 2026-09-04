import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";
import { decodeRustNetworkPlayerPoseV2, encodeRustNetworkPlayerPoseV2, RUST_NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V2 } from "../app/game/rust-network-player-pose-v2.ts";
import { decodeRustNetworkPlayerPoseV1, encodeRustNetworkPlayerPoseV1 } from "../app/game/rust-network-player-pose-v1.ts";

const POSE_DOMAIN = "blockwild-network-player-exact-pose-v2";
const PROJECTION_DOMAIN = "blockwild-network-player-exact-projection-v2";
const utf8 = new TextEncoder();
const b = (value: string | number) => BigInt(value);
const ZERO = b(0); const ONE = b(1); const MAX_U64 = b("18446744073709551615");
const PLAYER_ID = b("10424652189165442680"); const ENTITY_ID = b("4294967296");
const INPUT_SEQUENCE = b("9007199254740993");
function hash(domain: string, bytes: Uint8Array) { return Uint8Array.from(new TypeScriptCanonicalHasher(domain).writeBytes(bytes).finishHex().match(/../gu)!, byte => Number.parseInt(byte, 16)); }
function packet(values = [12.387123456789, -0, -9.876543210123, -0, Number.MIN_VALUE, -256.123456789, -0, 0.3141592653589793],
  labels = ["universe-r9", "surface", "native-session", "actor-🌿", "player:exact"]) {
  const bytes: number[] = []; const raw = (a: Uint8Array) => bytes.push(...a);
  const u16 = (n: number) => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n, true); raw(a); };
  const u64 = (n: bigint) => { const a = new Uint8Array(8); new DataView(a.buffer).setBigUint64(0, n, true); raw(a); };
  for (const s of labels) { const a = utf8.encode(s); u16(a.length); raw(a); }
  for (const n of [PLAYER_ID, ENTITY_ID, MAX_U64, INPUT_SEQUENCE, b(1), b(2), b(3), b(4), b(5), b(6), MAX_U64]) u64(n);
  raw(new Uint8Array(16).fill(0x42)); const poseOffset = bytes.length;
  for (const n of values) { const a = new Uint8Array(8); new DataView(a.buffer).setFloat64(0, n, true); raw(a); } bytes.push(1);
  const body = Uint8Array.from(bytes); const header = new Uint8Array(12); header.set([66, 87, 80, 69]);
  new DataView(header.buffer).setUint16(4, 2, true); new DataView(header.buffer).setUint32(8, body.length, true);
  const poseCanonical = new Uint8Array(2 + 65); new DataView(poseCanonical.buffer).setUint16(0, 2, true); poseCanonical.set(body.subarray(poseOffset), 2);
  const poseHash = hash(POSE_DOMAIN, poseCanonical);
  const projected = new Uint8Array(header.length + body.length + 16); projected.set(header); projected.set(body, 12); projected.set(poseHash, 12 + body.length);
  const result = new Uint8Array(projected.length + 16); result.set(projected); result.set(hash(PROJECTION_DOMAIN, projected), projected.length);
  return result;
}

test("BWPE V2 preserves exact native f64 and packed bigint identity", () => {
  const bytes = packet(); const decoded = decodeRustNetworkPlayerPoseV2(bytes);
  assert.deepEqual(encodeRustNetworkPlayerPoseV2(decoded), bytes);
  assert.equal(decoded.playerId, PLAYER_ID); assert.equal(decoded.entityId, ENTITY_ID);
  assert.equal(decoded.tick, MAX_U64); assert.equal(decoded.inputSequence, INPUT_SEQUENCE);
  assert.equal(decoded.revision.simulation, MAX_U64);
  assert(Object.is(decoded.position[1], -0)); assert(Object.is(decoded.yaw, -0));
  assert.equal(decoded.velocity[1], Number.MIN_VALUE);
});
test("BWPE V2 preserves each signed zero and independently binds all pose bits", () => {
  const positive = decodeRustNetworkPlayerPoseV2(packet(new Array<number>(8).fill(0)));
  for (let i = 0; i < 8; i++) { const values = new Array<number>(8).fill(0); values[i] = -0; const bytes = packet(values);
    const negative = decodeRustNetworkPlayerPoseV2(bytes); assert.notEqual(negative.poseHash, positive.poseHash);
    assert.notEqual(negative.projectionHash, positive.projectionHash); assert.deepEqual(encodeRustNetworkPlayerPoseV2(negative), bytes);
  }
});
test("BWPE V2 enforces native physics and exact-look domains even with resealed hashes", () => {
  // simulation/collision.rs PHYSICS_MAX_ABS_POSITION_V1 / PHYSICS_MAX_ABS_VELOCITY_V1.
  const edges = [-33554432, 33554432, 0, -4096, 4096, 0, -Math.PI, Math.PI / 2];
  assert.deepEqual(encodeRustNetworkPlayerPoseV2(decodeRustNetworkPlayerPoseV2(packet(edges))), packet(edges));
  for (let i = 0; i < 8; i++) for (const bad of [NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
    const values = new Array<number>(8).fill(0); values[i] = bad; assert.throws(() => decodeRustNetworkPlayerPoseV2(packet(values)));
  }
});
test("BWPE V2 rejects truncation, trailing data, every-byte tamper and V1 decoding", () => {
  const bytes = packet(); for (let i = 0; i < bytes.length; i++) {
    assert.throws(() => decodeRustNetworkPlayerPoseV2(bytes.subarray(0, i)));
    const bad = bytes.slice(); bad[i] ^= 1; assert.throws(() => decodeRustNetworkPlayerPoseV2(bad));
  }
  assert.throws(() => decodeRustNetworkPlayerPoseV2(new Uint8Array([...bytes, 0])));
  assert.throws(() => decodeRustNetworkPlayerPoseV2(new Uint8Array(RUST_NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V2 + 1)));
  assert.throws(() => decodeRustNetworkPlayerPoseV1(bytes));
});
test("BWPE V2 rejects changed bindings, exact float substitution and unknown authority claims", () => {
  const decoded = decodeRustNetworkPlayerPoseV2(packet());
  for (const change of [{ actorId: "other" }, { yaw: 0 }, { hostAuthority: true }, { consent: "yes" }, { tick: 42 }])
    assert.throws(() => encodeRustNetworkPlayerPoseV2({ ...decoded, ...change }));
});

test("BWPE V2 matches Rust-authored vectors including exact bits, BOM, and maximum native labels", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/r9-network-wire/native-pose-v2-vectors.json", import.meta.url), "utf8")) as {
    schema: number; vectors: { id: string; wireHex: string; poseHash: string; projectionHash: string; playerId: string; entityId: string; tick: string; inputSequence: string; f64Bits: string[] }[];
  };
  assert.equal(fixture.schema, 2); assert.equal(fixture.vectors.length, 3);
  for (const v of fixture.vectors) {
    const bytes = Uint8Array.from(Buffer.from(v.wireHex, "hex")); const decoded = decodeRustNetworkPlayerPoseV2(bytes);
    assert.deepEqual(encodeRustNetworkPlayerPoseV2(decoded), bytes, v.id);
    assert.equal(decoded.poseHash, v.poseHash); assert.equal(decoded.projectionHash, v.projectionHash);
    for (const key of ["playerId", "entityId", "tick", "inputSequence"] as const) assert.equal(decoded[key], BigInt(v[key]));
    const bits = [...decoded.position, ...decoded.velocity, decoded.yaw, decoded.pitch].map(n => {
      const bytes = new ArrayBuffer(8); const view = new DataView(bytes); view.setFloat64(0, n, true); return view.getBigUint64(0, true).toString(16).padStart(16, "0");
    });
    assert.deepEqual(bits, v.f64Bits);
    assert(Object.isFrozen(decoded) && Object.isFrozen(decoded.revision) && Object.isFrozen(decoded.position) && Object.isFrozen(decoded.velocity));
    if (v.id === "native-domain-edges-bom") assert.equal(decoded.universeId[0], "\ufeff");
    if (v.id === "maximum-native-labels") { assert.equal(utf8.encode(decoded.actorId).length, 512); assert.equal(decoded.externalEntityId.length, 512); }
  }
  assert.equal(Buffer.from(packet()).toString("hex"), fixture.vectors[0].wireHex);
});

test("BWPE V2 rejects inherited/index/record hooks without invoking caller code", () => {
  const decoded = decodeRustNetworkPlayerPoseV2(packet()); let calls = 0;
  const hooked = { ...decoded }; Object.defineProperty(hooked, "actorId", { enumerable: true, get() { calls++; return "other"; } });
  assert.throws(() => encodeRustNetworkPlayerPoseV2(hooked));
  const position = [...decoded.position]; Object.defineProperty(position, "0", { enumerable: true, get() { calls++; return 0; } });
  assert.throws(() => encodeRustNetworkPlayerPoseV2({ ...decoded, position }));
  const inherited = [...decoded.position]; Object.setPrototypeOf(inherited, Object.create(Array.prototype, { [Symbol.iterator]: { get() { calls++; return null; } } }));
  assert.throws(() => encodeRustNetworkPlayerPoseV2({ ...decoded, position: inherited }));
  const revision = { ...decoded.revision }; Object.defineProperty(revision, "simulation", { enumerable: true, get() { calls++; return ZERO; } });
  assert.throws(() => encodeRustNetworkPlayerPoseV2({ ...decoded, revision }));
  assert.equal(calls, 0);
});

test("BWPE V2 byte snapshots reject hooks/subclasses/shared backing and retain offset views", () => {
  const bytes = packet(); let calls = 0;
  for (const key of ["byteLength", Symbol.iterator]) {
    const bad = bytes.slice(); Object.defineProperty(bad, key, { get() { calls++; return null; } });
    assert.throws(() => decodeRustNetworkPlayerPoseV2(bad));
  }
  class Subclass extends Uint8Array { get byteLength() { calls++; return super.byteLength; } }
  assert.throws(() => decodeRustNetworkPlayerPoseV2(new Subclass(bytes)));
  assert.throws(() => decodeRustNetworkPlayerPoseV2(new Uint8Array(new SharedArrayBuffer(bytes.length))));
  const offset = new Uint8Array(bytes.length + 12); offset.set(bytes, 7);
  assert.deepEqual(encodeRustNetworkPlayerPoseV2(decodeRustNetworkPlayerPoseV2(offset.subarray(7, 7 + bytes.length))), bytes);
  assert.equal(calls, 0);
});

function reseal(bytes: Uint8Array) {
  const poseOffset = bytes.length - 32 - 65; const canonical = new Uint8Array(67);
  new DataView(canonical.buffer).setUint16(0, 2, true); canonical.set(bytes.subarray(poseOffset, bytes.length - 32), 2);
  bytes.set(hash(POSE_DOMAIN, canonical), bytes.length - 32);
  bytes.set(hash(PROJECTION_DOMAIN, bytes.subarray(0, bytes.length - 16)), bytes.length - 16); return bytes;
}
test("BWPE V2 rejects resealed reserved flags, boolean tags, invalid UTF8 and zero-generation IDs", () => {
  const bytes = packet(); const poseOffset = bytes.length - 32 - 65;
  for (const [offset, byte] of [[4, 1], [6, 1], [14, 0xff], [poseOffset + 64, 2]]) {
    const bad = bytes.slice(); bad[offset] = byte; assert.throws(() => decodeRustNetworkPlayerPoseV2(reseal(bad)));
  }
  const playerOffset = poseOffset - 16 - 11 * 8;
  for (const [offset, id] of [[playerOffset, ZERO], [playerOffset + 8, ZERO], [playerOffset + 8, b(42)]] as const) {
    const bad = bytes.slice(); new DataView(bad.buffer).setBigUint64(offset, id, true); assert.throws(() => decodeRustNetworkPlayerPoseV2(reseal(bad)));
  }
});
test("BWPE V2 label policies preserve native-valid lengths and reject overbounds or controls", () => {
  const valid = ["ࠀ".repeat(64), "ࠀ".repeat(128), "ࠀ".repeat(180), "é".repeat(256), "x".repeat(512)];
  assert.deepEqual(encodeRustNetworkPlayerPoseV2(decodeRustNetworkPlayerPoseV2(packet(undefined, valid))), packet(undefined, valid));
  for (const i of [0, 1, 2, 3, 4]) { const labels = valid.slice(); labels[i] += "x"; assert.throws(() => decodeRustNetworkPlayerPoseV2(packet(undefined, labels))); }
  for (const i of [3, 4]) { const labels = valid.slice(); labels[i] = "bad\n"; assert.throws(() => decodeRustNetworkPlayerPoseV2(packet(undefined, labels))); }
  const decoded = decodeRustNetworkPlayerPoseV2(packet());
  assert.throws(() => encodeRustNetworkPlayerPoseV2({ ...decoded, actorId: "\ud800" }));
});

test("BWPE V2 binds each integrated revision, identity, and hash independently", () => {
  const decoded = decodeRustNetworkPlayerPoseV2(packet());
  for (const key of ["epoch", "world", "entities", "gameplay", "persistence", "network", "simulation"] as const)
    assert.throws(() => encodeRustNetworkPlayerPoseV2({ ...decoded, revision: { ...decoded.revision, [key]: decoded.revision[key] ^ ONE } }));
  for (const key of ["universeId", "locationId", "sessionId", "actorId", "externalEntityId"] as const)
    assert.throws(() => encodeRustNetworkPlayerPoseV2({ ...decoded, [key]: decoded[key] + "x" }));
  for (const key of ["stateHash", "poseHash", "projectionHash"] as const) for (const bad of ["a".repeat(64), "A".repeat(32), "0".repeat(32)])
    assert.throws(() => encodeRustNetworkPlayerPoseV2({ ...decoded, [key]: bad }));
  for (const key of ["playerId", "entityId", "tick", "inputSequence"] as const) for (const bad of [b(-1), b("18446744073709551616"), 42])
    assert.throws(() => encodeRustNetworkPlayerPoseV2({ ...decoded, [key]: bad }));
});

test("BWPE V2 rejects one ULP outside every native f64 bound", () => {
  const bounds = [33554432, 33554432, 33554432, 4096, 4096, 4096, Math.PI, Math.PI / 2];
  for (let i = 0; i < bounds.length; i++) for (const sign of [-1, 1]) {
    const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, bounds[i], true);
    bits.setBigUint64(0, bits.getBigUint64(0, true) + ONE, true);
    const values = new Array<number>(8).fill(0); values[i] = sign * bits.getFloat64(0, true);
    assert.throws(() => decodeRustNetworkPlayerPoseV2(packet(values)), `outside field${i}, sign${sign}`);
    values[i] = sign * bounds[i]; assert.deepEqual(encodeRustNetworkPlayerPoseV2(decodeRustNetworkPlayerPoseV2(packet(values))), packet(values));
  }
});

test("BWPE V2 mirrors native world-address controls without narrowing session labels", () => {
  const base = ["universe", "surface", "session", "actor", "external"];
  for (const i of [0, 1]) for (const bad of ["\u0000", "\n", "\u007f"]) {
    const labels = base.slice(); labels[i] += bad; assert.throws(() => decodeRustNetworkPlayerPoseV2(packet(undefined, labels)));
  }
  // The existing network session label contract only bounds UTF-16 length.
  const labels = base.slice(); labels[2] += "\n";
  assert.equal(decodeRustNetworkPlayerPoseV2(packet(undefined, labels)).sessionId, labels[2]);
});

test("BWPE V2 stays distinct from explicitly quantized V1 compatibility", () => {
  const exact = decodeRustNetworkPlayerPoseV2(packet());
  const legacy = encodeRustNetworkPlayerPoseV1({ playerId: "peer", tick: 42, x: exact.position[0], y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 });
  assert.equal(decodeRustNetworkPlayerPoseV1(legacy).x, 12.387);
  assert.equal(exact.position[0], 12.387123456789);
  assert.throws(() => decodeRustNetworkPlayerPoseV2(legacy));
});
