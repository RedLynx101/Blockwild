import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LEGACY_WORLD_CONTINUATION_BOUNDARY_V1,
  decodeLegacyWorldContinuationV1,
  encodeLegacyWorldContinuationV1,
  legacyWorldContinuationSemanticHashV1,
  type LegacyWorldContinuationV1,
} from "../app/game/rust-legacy-world-continuation.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";

export function fixture(version: 16 | 17 = 16): LegacyWorldContinuationV1 {
  const value = {
    schemaVersion: 1,
    source: {
      generatorVersion: version, rawSha256: "11".repeat(32), byteLength: 4096,
      semanticHash: "22".repeat(16), worldSeed: "\ufeffSource 🌿",
      state: { day: 41, time: 0, weather: "clear", spawn: { x: -13.125, y: 40.51, z: -0 },
        pose: { x: 16_777_217.12345679, y: 40.51, z: -8.123456789, yaw: 0.123456789123, pitch: 1.7 } },
    },
    target: {
      catalogWorldId: "catalog-🌿", universeId: "universe", locationId: "overworld",
      generatorHash: "33".repeat(16), contentHash: "44".repeat(16), normalizedSemanticHash: "55".repeat(16),
      generatorVersion: 18, generatorProfile: "world-below-v15", mode: "builder",
      state: { day: 41, time: 0, weather: "clear", spawn: { x: -13.125, y: 40.51, z: 0 },
        pose: { x: 16_777_217.12345679, y: 40.51, z: -8.123456789, yaw: 0.123456789123, pitch: 1.4 } },
      options: { difficulty: "peaceful", dayLengthMinutes: 35, mobDensity: 0, butterflyDensity: 0,
        caveFrequency: 1, biomeScale: 1.35, resourceAbundance: 1, structures: true, weather: false,
        keepInventory: true, friendlyFire: false, sleepRule: "percentage", sleepPercentage: 50,
        enabledFactions: ["hobbits", "dwarves"], settlementPattern: version === 16 ? "legacy-scattered-v1" : "heartlands-v2",
        settlementDensity: 1, settlementClustering: "regional", roadCoverage: "regional", largeTownFrequency: "balanced",
        origin: { mode: "wilderness" } },
    },
    actor: { profileId: "profile", actorId: "actor", commandActorId: "reviewer", profileCanonicalHash: "66".repeat(32) },
    policy: { version: 1, id: "blockwild-fresh-runtime-review-g16-g17-builder-v1", proposalHash: "77".repeat(32), decision: "affirm-review-only" },
    // This third stage is recorded, not chosen as the native clock value.
    actualLegacyLoadWorldTime: ((0.32 % 1) + 1) % 1,
    decisions: { owner: "adopt-selected-not-historical", velocity: "fresh-rest-not-restored",
      grounded: "recompute-no-historical-assertion", sessionAge: "fresh-zero-not-historical" },
  } as LegacyWorldContinuationV1;
  if (version === 17) Object.assign(value.target.options, {
    difficulty: "hard", dayLengthMinutes: 120, mobDensity: 3, butterflyDensity: 4, caveFrequency: 3,
    biomeScale: 4, resourceAbundance: 0.25, weather: true, keepInventory: false, friendlyFire: true,
    sleepRule: "all-players", sleepPercentage: 100,
    enabledFactions: ["hobbits", "goblins", "atlantians", "sugarcourt", "wood-elves", "dwarves"],
    settlementDensity: 2, settlementClustering: "strong", roadCoverage: "dense", largeTownFrequency: "frequent",
    origin: { mode: "culture-settlement", factionId: "dwarves", minimumSize: "town" },
  });
  return value;
}

function roundTrip(value: LegacyWorldContinuationV1) {
  const bytes = encodeLegacyWorldContinuationV1(value);
  const restored = decodeLegacyWorldContinuationV1(bytes);
  assert.deepEqual(restored, value);
  assert.deepEqual(encodeLegacyWorldContinuationV1(restored), bytes);
  assert.equal(legacyWorldContinuationSemanticHashV1(restored), legacyWorldContinuationSemanticHashV1(value));
  return { bytes, restored };
}

test("standalone continuation is neither a native adoption API nor persisted runtime state", () => {
  assert.deepEqual(LEGACY_WORLD_CONTINUATION_BOUNDARY_V1, {
    schemaVersion: 1, nativeExecutionAllowed: false, storedByNativeRuntime: false, consumedByNativeRuntime: false,
  });
  assert(!("fresh" in fixture()));
});

test("source, normalized and actual legacy-load midnight remain distinct without f64 quantization", () => {
  for (const version of [16, 17] as const) {
    const { restored } = roundTrip(fixture(version));
    assert(Object.is(restored.source.state.spawn.z, -0));
    assert(Object.is(restored.target.state.spawn.z, 0));
    assert.equal(restored.source.state.time, 0);
    assert.equal(restored.target.state.time, 0);
    assert.equal(restored.actualLegacyLoadWorldTime, ((0.32 % 1) + 1) % 1);
    assert.notEqual(restored.source.state.pose.pitch, restored.target.state.pose.pitch);
    assert.notEqual(Math.fround(restored.target.state.pose.y), restored.target.state.pose.y);
    assert.equal(restored.source.worldSeed, "\ufeffSource 🌿");
  }
});

test("all typed world option enums and tagged origins are losslessly encoded", () => {
  const base = fixture();
  const choices = {
    difficulty: ["peaceful", "easy", "normal", "hard"], sleepRule: ["any-player", "percentage", "all-players"],
    settlementPattern: ["legacy-scattered-v1", "heartlands-v2"], settlementClustering: ["even", "regional", "strong"],
    roadCoverage: ["none", "local", "regional", "dense"], largeTownFrequency: ["rare", "balanced", "frequent"],
    origin: [{ mode: "wilderness" }, { mode: "near-any-settlement" },
      ...["hamlet", "village", "town"].map(minimumSize => ({ mode: "culture-settlement", factionId: "dwarves", minimumSize }))],
  };
  for (const [key, values] of Object.entries(choices)) for (const value of values) {
    roundTrip({ ...base, target: { ...base.target, options: { ...base.target.options, [key]: value } } } as LegacyWorldContinuationV1);
  }
});

test("all finite f64 edge bits survive and signed zero changes the semantic digest", () => {
  const bits = ["0", "1", "8000000000000000", "8000000000000001", "7fefffffffffffff", "ffefffffffffffff", "3fd5555555555555"].map(value => BigInt(`0x${value}`));
  for (const pattern of bits) {
    const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, pattern, true);
    const number = view.getFloat64(0, true), value = fixture();
    value.source.state.pose.x = number; value.target.state.pose.yaw = number; value.target.state.spawn.z = number;
    const { restored } = roundTrip(value);
    for (const actual of [restored.source.state.pose.x, restored.target.state.pose.yaw, restored.target.state.spawn.z]) {
      view.setFloat64(0, actual, true); assert.equal(view.getBigUint64(0, true), pattern);
    }
  }
  const negative = fixture(), positive = fixture(); positive.source.state.spawn.z = 0;
  assert.notEqual(legacyWorldContinuationSemanticHashV1(positive), legacyWorldContinuationSemanticHashV1(negative));
});

test("semantic hash covers every leaf independently from any embedded transport hash", () => {
  const base = fixture(); const expected = legacyWorldContinuationSemanticHashV1(base);
  const changed = structuredClone(base);
  changed.source.state.pose.y += 0.000000001;
  assert.notEqual(legacyWorldContinuationSemanticHashV1(changed), expected);
  const packet = encodeLegacyWorldContinuationV1(changed);
  assert.throws(() => decodeLegacyWorldContinuationV1(packet, expected), /semantic/i);
  const leaves: string[][] = [];
  function visit(value: unknown, path: string[] = []) {
    if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) visit(entry, [...path, key]);
    else leaves.push(path);
  }
  visit(base);
  let changedHashes = 0;
  for (const path of leaves) {
    const candidate = structuredClone(base) as unknown as Record<string, unknown>;
    let owner = candidate;
    for (const key of path.slice(0, -1)) owner = owner[key] as Record<string, unknown>;
    const key = path.at(-1)!; const value = owner[key];
    owner[key] = typeof value === "number" ? value + 1 : typeof value === "boolean" ? !value : `${String(value)}x`;
    try {
      assert.notEqual(legacyWorldContinuationSemanticHashV1(candidate as unknown as LegacyWorldContinuationV1), expected, path.join("."));
      changedHashes += 1;
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      // Fixed policy/version/enum/hash fields reject instead of accepting drift.
    }
  }
  assert(changedHashes >= 35);
});

test("strict structural validation rejects unknown nested fields, accessors and sparse arrays", () => {
  const base = fixture();
  const records = [base, base.source, base.target, base.actor, base.policy, base.decisions,
    base.source.state, base.target.state, base.source.state.pose, base.target.state.spawn, base.target.options, base.target.options.origin];
  for (const record of records) {
    Object.defineProperty(record, "unreviewed", { value: true, enumerable: true, configurable: true });
    assert.throws(() => encodeLegacyWorldContinuationV1(base), /field|shape/i);
    delete (record as unknown as Record<string, unknown>).unreviewed;
  }
  const getter = fixture(); let calls = 0;
  Object.defineProperty(getter.actor, "actorId", { get: () => { calls += 1; return "actor"; }, enumerable: true });
  assert.throws(() => encodeLegacyWorldContinuationV1(getter)); assert.equal(calls, 0);
  const sparse = fixture(); sparse.target.options.enabledFactions = new Array(2);
  assert.throws(() => encodeLegacyWorldContinuationV1(sparse));
});

test("numeric, hash, identity and normalized-option bounds reject without changing source", () => {
  const mutations: ((value: LegacyWorldContinuationV1) => void)[] = [
    value => { value.source.rawSha256 = "aa".repeat(16) as never; },
    value => { value.source.semanticHash = "aa".repeat(32) as never; },
    value => { value.actor.profileCanonicalHash = "AA".repeat(32) as never; },
    value => { value.source.byteLength = 0; }, value => { value.source.byteLength = 64 * 1024 * 1024 + 1; },
    value => { value.source.state.pose.x = Infinity; }, value => { value.target.state.spawn.y = NaN; },
    value => { value.source.state.day = 1.5; }, value => { value.target.state.day = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.target.options.dayLengthMinutes = 121; }, value => { value.target.options.mobDensity = -1; },
    value => { value.target.options.enabledFactions = ["dwarves", "hobbits"]; },
    value => { value.target.options.enabledFactions = ["hobbits", "hobbits"]; },
    value => { value.actor.actorId = "bad\0actor"; }, value => { value.source.worldSeed = "\ud800"; },
  ];
  for (const mutate of mutations) {
    const value = fixture(); mutate(value); const before = structuredClone(value);
    assert.throws(() => encodeLegacyWorldContinuationV1(value)); assert.deepEqual(value, before);
  }
});

test("oversize strings are rejected before allocating their UTF-8 representation", context => {
  const value = fixture(), oversized = "a".repeat(100_000); value.source.worldSeed = oversized;
  const encode = TextEncoder.prototype.encode; let calls = 0;
  context.mock.method(TextEncoder.prototype, "encode", function (this: TextEncoder, input?: string) {
    if (input === oversized) calls += 1;
    return encode.call(this, input);
  });
  assert.throws(() => encodeLegacyWorldContinuationV1(value), /bound/);
  assert.equal(calls, 0);
});

test("inherited array hooks cannot replace validated faction data or run during encoding", () => {
  const value = fixture(); let calls = 0;
  class HostileFactions extends Array<"hobbits" | "dwarves"> {
    override includes() { calls += 1; return true; }
    override *[Symbol.iterator](): ArrayIterator<"hobbits" | "dwarves"> { calls += 1; yield "dwarves"; yield "hobbits"; }
  }
  value.target.options.enabledFactions = new HostileFactions("hobbits", "dwarves");
  value.target.options.origin = { mode: "culture-settlement", factionId: "dwarves", minimumSize: "town" };
  assert.throws(() => encodeLegacyWorldContinuationV1(value), /shape|prototype/i);
  assert.equal(calls, 0);
});

test("decode copies only a bounded intrinsic byte span and never invokes caller hooks", () => {
  const packet = encodeLegacyWorldContinuationV1(fixture());
  for (const key of ["length", "byteLength", "buffer", Symbol.iterator]) {
    let calls = 0; const hostile = packet.slice();
    Object.defineProperty(hostile, key, { get() { calls += 1; throw new Error("caller hook executed"); } });
    assert.throws(() => decodeLegacyWorldContinuationV1(hostile), /shape|field/i);
    assert.equal(calls, 0);
  }
  let calls = 0;
  class HostileBytes extends Uint8Array {
    override *[Symbol.iterator](): ArrayIterator<number> { calls += 1; yield* packet; }
  }
  assert.throws(() => decodeLegacyWorldContinuationV1(new HostileBytes(packet)), /shape|prototype/i);
  assert.equal(calls, 0);
  const backing = new Uint8Array(packet.length + 20); backing.set(packet, 10);
  assert.deepEqual(decodeLegacyWorldContinuationV1(backing.subarray(10, 10 + packet.length)), fixture());
  assert.throws(() => decodeLegacyWorldContinuationV1(new Uint8Array(new SharedArrayBuffer(packet.length))), /buffer|shape/i);
});

test("every truncation, trailing byte and transport mutation fails closed", () => {
  const packet = encodeLegacyWorldContinuationV1(fixture());
  for (let length = 0; length < packet.length; length += 1) assert.throws(() => decodeLegacyWorldContinuationV1(packet.subarray(0, length)));
  assert.throws(() => decodeLegacyWorldContinuationV1(Uint8Array.from([...packet, 0])));
  for (let index = 0; index < packet.length; index += 1) {
    const changed = packet.slice(); changed[index] ^= 1;
    assert.throws(() => decodeLegacyWorldContinuationV1(changed), `byte ${index}`);
  }
});

test("resealed invalid tags, UTF-8 and nonfinite values still fail typed validation", () => {
  const original = encodeLegacyWorldContinuationV1(fixture());
  const stateStart = 12 + 2 + 32 + 8 + 16 + 2 + new TextEncoder().encode("\ufeffSource 🌿").length;
  function f64(value: number) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); return bytes; }
  function reseal(packet: Uint8Array, semantic: boolean) {
    if (semantic) packet.set(new TypeScriptCanonicalHasher("blockwild-legacy-world-continuation-semantic-v1")
      .writeU16(1).writeBytes(packet.subarray(12, -32)).finish(), packet.length - 32);
    packet.set(new TypeScriptCanonicalHasher("blockwild-legacy-world-continuation-transport-v1")
      .writeBytes(packet.subarray(0, -16)).finish(), packet.length - 16);
  }
  const oldSemantic = original.slice(); oldSemantic[14] ^= 1; reseal(oldSemantic, false);
  assert.throws(() => decodeLegacyWorldContinuationV1(oldSemantic), /semantic/i);
  const mutations: [number, Uint8Array][] = [[12, Uint8Array.of(18, 0)], [stateStart + 16, Uint8Array.of(255)],
    [stateStart + 8, f64(Infinity)], [stateStart, f64(1.5)], [72, Uint8Array.of(255)], [original.length - 33, Uint8Array.of(1)]];
  for (const [offset, bytes] of mutations) {
    const changed = original.slice(); changed.set(bytes, offset); reseal(changed, true);
    assert.throws(() => decodeLegacyWorldContinuationV1(changed), /version|tag|numeric|encoded data/i);
  }
});

test("Rust-authored checked vectors decode and re-encode independently in TypeScript", () => {
  const vectors = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/legacy-world-continuation-v1.json", import.meta.url), "utf8"));
  assert.equal(vectors.schemaVersion, 1); assert.equal(vectors.producer, "blockwild-engine Rust standalone codec");
  assert.equal(vectors.vectors.length, 2);
  for (const vector of vectors.vectors) {
    const expected = fixture(vector.sourceGeneratorVersion);
    const bytes = Uint8Array.from(Buffer.from(vector.hex, "hex"));
    const decoded = decodeLegacyWorldContinuationV1(bytes, vector.semanticHash);
    assert.deepEqual(decoded, expected);
    assert.deepEqual(encodeLegacyWorldContinuationV1(decoded), bytes);
    assert.equal(legacyWorldContinuationSemanticHashV1(expected), vector.semanticHash);
  }
});
