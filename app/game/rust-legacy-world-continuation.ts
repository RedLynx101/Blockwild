/**
 * Standalone BWLC review-terms codec. NOT stored or consumed by the native
 * runtime; NOT a migration executor, capability, consent validator or ownership
 * attestation. Bindings reference the separately validated complete review and
 * exact archived source. Omitted/raw option fields stay in that source; options
 * below are the complete storage-normalized target, never invented raw defaults.
 *
 * Source, storage-normalized and actual legacy-load time are separate stages:
 * legacy load turns numeric midnight zero into 0.32. This codec preserves each
 * supplied finite f64 bit pattern and does not choose native behavior.
 *
 * BWLC v1: magic[4], version:u16, flags:u16(0), bodyLength:u32, typed body,
 * semanticHash[16], transportHash[16], all integers/f64 little-endian. Strings
 * are u16 UTF-8 byte length + bytes; enums are closed u8 tags in the tables below.
 * Both digests are noncryptographic canonical hashes, NOT authentication. The
 * semantic digest hashes version + the independently reconstructed canonical
 * body, never the incoming checksum/hash. Schema changes require a new version.
 */
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

export const LEGACY_WORLD_CONTINUATION_BOUNDARY_V1 = Object.freeze({
  schemaVersion: 1, nativeExecutionAllowed: false, storedByNativeRuntime: false, consumedByNativeRuntime: false,
} as const);
export const LEGACY_WORLD_CONTINUATION_MAX_BYTES_V1 = 8192;
export const LEGACY_WORLD_CONTINUATION_POLICY_ID_V1 = "blockwild-fresh-runtime-review-g16-g17-builder-v1";
declare const sha256Brand: unique symbol;
declare const canonicalBrand: unique symbol;
export type LegacyContinuationSha256V1 = string & { readonly [sha256Brand]: true };
export type LegacyContinuationCanonicalHashV1 = string & { readonly [canonicalBrand]: true };
export type LegacyContinuationVec3V1 = { x: number; y: number; z: number };
export type LegacyContinuationPoseV1 = LegacyContinuationVec3V1 & { yaw: number; pitch: number };
export type LegacyContinuationStateV1 = {
  day: number; time: number; weather: "clear" | "rain"; spawn: LegacyContinuationVec3V1; pose: LegacyContinuationPoseV1;
};
export type LegacyContinuationFactionV1 = "hobbits" | "goblins" | "atlantians" | "sugarcourt" | "wood-elves" | "dwarves";
export type LegacyContinuationOriginV1 = { mode: "wilderness" } | { mode: "near-any-settlement" }
  | { mode: "culture-settlement"; factionId: LegacyContinuationFactionV1; minimumSize: "hamlet" | "village" | "town" };
export type LegacyContinuationWorldOptionsV1 = {
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  dayLengthMinutes: number; mobDensity: number; butterflyDensity: number; caveFrequency: number;
  biomeScale: number; resourceAbundance: number; structures: boolean; weather: boolean;
  keepInventory: boolean; friendlyFire: boolean; sleepRule: "any-player" | "percentage" | "all-players";
  sleepPercentage: number; enabledFactions: LegacyContinuationFactionV1[];
  settlementPattern: "legacy-scattered-v1" | "heartlands-v2"; settlementDensity: number;
  settlementClustering: "even" | "regional" | "strong"; roadCoverage: "none" | "local" | "regional" | "dense";
  largeTownFrequency: "rare" | "balanced" | "frequent"; origin: LegacyContinuationOriginV1;
};
export type LegacyWorldContinuationV1 = {
  schemaVersion: 1;
  source: { generatorVersion: 16 | 17; rawSha256: LegacyContinuationSha256V1; byteLength: number;
    semanticHash: LegacyContinuationCanonicalHashV1; worldSeed: string; state: LegacyContinuationStateV1 };
  target: { catalogWorldId: string; universeId: string; locationId: string;
    generatorHash: LegacyContinuationCanonicalHashV1; contentHash: LegacyContinuationCanonicalHashV1;
    normalizedSemanticHash: LegacyContinuationCanonicalHashV1; generatorVersion: 18;
    generatorProfile: "world-below-v15"; mode: "builder"; state: LegacyContinuationStateV1; options: LegacyContinuationWorldOptionsV1 };
  actor: { profileId: string; actorId: string; commandActorId: string; profileCanonicalHash: LegacyContinuationSha256V1 };
  policy: { version: 1; id: typeof LEGACY_WORLD_CONTINUATION_POLICY_ID_V1; proposalHash: LegacyContinuationSha256V1; decision: "affirm-review-only" };
  actualLegacyLoadWorldTime: number;
  decisions: { owner: "adopt-selected-not-historical"; velocity: "fresh-rest-not-restored";
    grounded: "recompute-no-historical-assertion"; sessionAge: "fresh-zero-not-historical" };
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MAGIC = Uint8Array.of(66, 87, 76, 67);
const HEADER = 12;
const TRAILER = 32;
const SEMANTIC_DOMAIN = "blockwild-legacy-world-continuation-semantic-v1";
const TRANSPORT_DOMAIN = "blockwild-legacy-world-continuation-transport-v1";
const ENUM = {
  weather: ["clear", "rain"], difficulty: ["peaceful", "easy", "normal", "hard"],
  sleepRule: ["any-player", "percentage", "all-players"],
  faction: ["hobbits", "goblins", "atlantians", "sugarcourt", "wood-elves", "dwarves"],
  settlementPattern: ["legacy-scattered-v1", "heartlands-v2"], settlementClustering: ["even", "regional", "strong"],
  roadCoverage: ["none", "local", "regional", "dense"], largeTownFrequency: ["rare", "balanced", "frequent"],
  origin: ["wilderness", "near-any-settlement", "culture-settlement"], minimumSize: ["hamlet", "village", "town"],
  generatorProfile: ["world-below-v15"], mode: ["builder"], decision: ["affirm-review-only"],
  owner: ["adopt-selected-not-historical"], velocity: ["fresh-rest-not-restored"],
  grounded: ["recompute-no-historical-assertion"], sessionAge: ["fresh-zero-not-historical"],
} as const;
type EnumName = keyof typeof ENUM;
const OPTION_NUMBERS = ["dayLengthMinutes", "mobDensity", "butterflyDensity", "caveFrequency", "biomeScale", "resourceAbundance"] as const;
const OPTION_BOOLEANS = ["structures", "weather", "keepInventory", "friendlyFire"] as const;
const OPTION_KEYS = ["difficulty", ...OPTION_NUMBERS, ...OPTION_BOOLEANS, "sleepRule", "sleepPercentage", "enabledFactions",
  "settlementPattern", "settlementDensity", "settlementClustering", "roadCoverage", "largeTownFrequency", "origin"] as const;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const byteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const copyBytes = Uint8Array.prototype.set;

function fail(reason: string): never { throw new Error(`BWLC v1: ${reason}`); }
function shape(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("record shape");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) fail("unknown or missing field");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail("field must be enumerable data");
  }
}
function range(value: unknown, minimum: number, maximum: number, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum
    || (integer && !Number.isSafeInteger(value))) fail("numeric bound");
}
function finite(value: unknown) { range(value, -Number.MAX_VALUE, Number.MAX_VALUE); }
function text(value: unknown, maximum: number, visible = true) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || encoder.encode(value).length > maximum
    || /[\ud800-\udfff]/u.test(value) || (visible && /[\u0000-\u001f\u007f-\u009f]/u.test(value))) fail("string bound or Unicode");
}
function tag(name: EnumName, value: unknown) {
  const index = (ENUM[name] as readonly unknown[]).indexOf(value);
  if (index < 0) fail(`unknown ${name} enum`);
  return index;
}
function hex(value: unknown, length: 16 | 32) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length * 2}}$`, "u").test(value)) fail("hash width or encoding");
  return Uint8Array.from(value.match(/../gu)!.map(byte => Number.parseInt(byte, 16)));
}
function hexString(bytes: Uint8Array) { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
function equal(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((byte, index) => byte === b[index]); }

/** Parse a lower-case SHA-256 identity, distinctly typed from canonical hashes. */
export function legacyContinuationSha256V1(value: string): LegacyContinuationSha256V1 {
  hex(value, 32); return value as LegacyContinuationSha256V1;
}
export function legacyContinuationCanonicalHashV1(value: string): LegacyContinuationCanonicalHashV1 {
  hex(value, 16); return value as LegacyContinuationCanonicalHashV1;
}

function validateState(value: LegacyContinuationStateV1) {
  shape(value, ["day", "time", "weather", "spawn", "pose"]);
  range(value.day, 1, Number.MAX_SAFE_INTEGER, true); finite(value.time); tag("weather", value.weather);
  shape(value.spawn, ["x", "y", "z"]); shape(value.pose, ["x", "y", "z", "yaw", "pitch"]);
  for (const number of [...Object.values(value.spawn), ...Object.values(value.pose)]) finite(number);
}
function validateOptions(value: LegacyContinuationWorldOptionsV1) {
  shape(value, OPTION_KEYS);
  tag("difficulty", value.difficulty); tag("sleepRule", value.sleepRule); tag("settlementPattern", value.settlementPattern);
  tag("settlementClustering", value.settlementClustering); tag("roadCoverage", value.roadCoverage); tag("largeTownFrequency", value.largeTownFrequency);
  range(value.dayLengthMinutes, 5, 120); range(value.mobDensity, 0, 3); range(value.butterflyDensity, 0, 4);
  range(value.caveFrequency, 0, 3); range(value.biomeScale, 0.25, 4); range(value.resourceAbundance, 0.25, 4);
  range(value.sleepPercentage, 1, 100); range(value.settlementDensity, 0, 2);
  for (const key of OPTION_BOOLEANS) if (typeof value[key] !== "boolean") fail("boolean field");
  const factions = value.enabledFactions;
  if (!Array.isArray(factions) || Object.getPrototypeOf(factions) !== Array.prototype
    || factions.length > 6 || Reflect.ownKeys(factions).length !== factions.length + 1) fail("faction array shape");
  let previous = -1;
  for (let index = 0; index < factions.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(factions, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) fail("faction array data field");
    const current = tag("faction", descriptor.value);
    if (current <= previous) fail("factions must be unique in canonical order");
    previous = current;
  }
  // Select the union branch without evaluating an accessor.
  if (!value.origin || typeof value.origin !== "object") fail("origin shape");
  const mode = Object.getOwnPropertyDescriptor(value.origin, "mode");
  if (!mode || !("value" in mode)) fail("origin field");
  shape(value.origin, mode.value === "culture-settlement" ? ["mode", "factionId", "minimumSize"] : ["mode"]);
  tag("origin", value.origin.mode);
  if (value.origin.mode === "culture-settlement") {
    tag("faction", value.origin.factionId); tag("minimumSize", value.origin.minimumSize);
    let enabled = false;
    for (let index = 0; index < factions.length; index += 1) if (factions[index] === value.origin.factionId) enabled = true;
    if (!enabled) fail("origin faction is disabled");
  }
  if (value.origin.mode !== "wilderness" && (!value.structures || value.settlementDensity === 0)) fail("origin lacks settlements");
}
function validate(value: LegacyWorldContinuationV1) {
  shape(value, ["schemaVersion", "source", "target", "actor", "policy", "actualLegacyLoadWorldTime", "decisions"]);
  if (value.schemaVersion !== 1) fail("schema version");
  shape(value.source, ["generatorVersion", "rawSha256", "byteLength", "semanticHash", "worldSeed", "state"]);
  if (value.source.generatorVersion !== 16 && value.source.generatorVersion !== 17) fail("source generator version");
  hex(value.source.rawSha256, 32); hex(value.source.semanticHash, 16); range(value.source.byteLength, 1, 64 * 1024 * 1024, true);
  text(value.source.worldSeed, 2048, false); if (value.source.worldSeed.length > 512) fail("seed bound"); validateState(value.source.state);
  shape(value.target, ["catalogWorldId", "universeId", "locationId", "generatorHash", "contentHash", "normalizedSemanticHash",
    "generatorVersion", "generatorProfile", "mode", "state", "options"]);
  text(value.target.catalogWorldId, 48); text(value.target.universeId, 64); text(value.target.locationId, 128);
  for (const key of ["generatorHash", "contentHash", "normalizedSemanticHash"] as const) hex(value.target[key], 16);
  if (value.target.generatorVersion !== 18) fail("target generator version");
  tag("generatorProfile", value.target.generatorProfile); tag("mode", value.target.mode);
  validateState(value.target.state); validateOptions(value.target.options);
  shape(value.actor, ["profileId", "actorId", "commandActorId", "profileCanonicalHash"]);
  text(value.actor.profileId, 72); text(value.actor.actorId, 150); text(value.actor.commandActorId, 160); hex(value.actor.profileCanonicalHash, 32);
  shape(value.policy, ["version", "id", "proposalHash", "decision"]);
  if (value.policy.version !== 1 || value.policy.id !== LEGACY_WORLD_CONTINUATION_POLICY_ID_V1) fail("policy version or identity");
  hex(value.policy.proposalHash, 32); tag("decision", value.policy.decision);
  finite(value.actualLegacyLoadWorldTime);
  if (value.actualLegacyLoadWorldTime < 0 || value.actualLegacyLoadWorldTime >= 1) fail("actual legacy-load clock bound");
  shape(value.decisions, ["owner", "velocity", "grounded", "sessionAge"]);
  for (const key of ["owner", "velocity", "grounded", "sessionAge"] as const) tag(key, value.decisions[key]);
}

class Writer {
  readonly bytes: number[] = [];
  raw(bytes: Uint8Array) { this.bytes.push(...bytes); }
  u8(value: number) { this.bytes.push(value); }
  u16(value: number) { this.bytes.push(value & 255, value >>> 8); }
  u32(value: number) { this.bytes.push(value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24); }
  u64(value: number) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true); this.raw(bytes); }
  f64(value: number) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); this.raw(bytes); }
  string(value: string) { const bytes = encoder.encode(value); this.u16(bytes.length); this.raw(bytes); }
  enum(name: EnumName, value: unknown) { this.u8(tag(name, value)); }
  hash(value: string, length: 16 | 32) { this.raw(hex(value, length)); }
  finish() { return Uint8Array.from(this.bytes); }
}
class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  raw(length: number) { if (length > this.bytes.length - this.offset) fail("truncated payload"); const result = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return result; }
  view(length: number) { const bytes = this.raw(length); return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  u8() { return this.raw(1)[0]; }
  u16() { return this.view(2).getUint16(0, true); }
  u32() { return this.view(4).getUint32(0, true); }
  u64() { const value = this.view(8).getBigUint64(0, true); if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("unsafe integer"); return Number(value); }
  f64() { const value = this.view(8).getFloat64(0, true); finite(value); return value; }
  string() { return decoder.decode(this.raw(this.u16())); }
  enum<N extends EnumName>(name: N): typeof ENUM[N][number] {
    const value = ENUM[name][this.u8()]; if (value === undefined) fail(`unknown ${name} tag`); return value;
  }
  bool() { const value = this.u8(); if (value > 1) fail("boolean tag"); return value === 1; }
  hash() { return hexString(this.raw(16)) as LegacyContinuationCanonicalHashV1; }
  sha() { return hexString(this.raw(32)) as LegacyContinuationSha256V1; }
}
function writeState(writer: Writer, value: LegacyContinuationStateV1) {
  writer.f64(value.day); writer.f64(value.time); writer.enum("weather", value.weather);
  for (const key of ["x", "y", "z"] as const) writer.f64(value.spawn[key]);
  for (const key of ["x", "y", "z", "yaw", "pitch"] as const) writer.f64(value.pose[key]);
}
function readState(reader: Reader): LegacyContinuationStateV1 {
  return { day: reader.f64(), time: reader.f64(), weather: reader.enum("weather"),
    spawn: { x: reader.f64(), y: reader.f64(), z: reader.f64() },
    pose: { x: reader.f64(), y: reader.f64(), z: reader.f64(), yaw: reader.f64(), pitch: reader.f64() } };
}
function writeOptions(writer: Writer, value: LegacyContinuationWorldOptionsV1) {
  writer.enum("difficulty", value.difficulty);
  for (const key of OPTION_NUMBERS) writer.f64(value[key]);
  for (const key of OPTION_BOOLEANS) writer.u8(Number(value[key]));
  writer.enum("sleepRule", value.sleepRule); writer.f64(value.sleepPercentage); writer.u8(value.enabledFactions.length);
  for (let index = 0; index < value.enabledFactions.length; index += 1) writer.enum("faction", value.enabledFactions[index]);
  writer.enum("settlementPattern", value.settlementPattern); writer.f64(value.settlementDensity);
  writer.enum("settlementClustering", value.settlementClustering); writer.enum("roadCoverage", value.roadCoverage);
  writer.enum("largeTownFrequency", value.largeTownFrequency); writer.enum("origin", value.origin.mode);
  if (value.origin.mode === "culture-settlement") { writer.enum("faction", value.origin.factionId); writer.enum("minimumSize", value.origin.minimumSize); }
}
function readOptions(reader: Reader): LegacyContinuationWorldOptionsV1 {
  const common = { difficulty: reader.enum("difficulty"), dayLengthMinutes: reader.f64(), mobDensity: reader.f64(),
    butterflyDensity: reader.f64(), caveFrequency: reader.f64(), biomeScale: reader.f64(), resourceAbundance: reader.f64(),
    structures: reader.bool(), weather: reader.bool(), keepInventory: reader.bool(), friendlyFire: reader.bool(),
    sleepRule: reader.enum("sleepRule"), sleepPercentage: reader.f64() };
  const count = reader.u8(); if (count > 6) fail("faction count");
  const enabledFactions = Array.from({ length: count }, () => reader.enum("faction"));
  const settlementPattern = reader.enum("settlementPattern"), settlementDensity = reader.f64();
  const settlementClustering = reader.enum("settlementClustering"), roadCoverage = reader.enum("roadCoverage");
  const largeTownFrequency = reader.enum("largeTownFrequency"), mode = reader.enum("origin");
  const origin: LegacyContinuationOriginV1 = mode === "culture-settlement"
    ? { mode, factionId: reader.enum("faction"), minimumSize: reader.enum("minimumSize") } : { mode };
  return { ...common, enabledFactions, settlementPattern, settlementDensity, settlementClustering, roadCoverage, largeTownFrequency, origin };
}
function body(value: LegacyWorldContinuationV1) {
  validate(value);
  const writer = new Writer(), source = value.source, target = value.target;
  writer.u16(source.generatorVersion); writer.hash(source.rawSha256, 32); writer.u64(source.byteLength);
  writer.hash(source.semanticHash, 16); writer.string(source.worldSeed); writeState(writer, source.state);
  writer.string(target.catalogWorldId); writer.string(target.universeId); writer.string(target.locationId);
  writer.hash(target.generatorHash, 16); writer.hash(target.contentHash, 16); writer.hash(target.normalizedSemanticHash, 16);
  writer.u16(target.generatorVersion); writer.enum("generatorProfile", target.generatorProfile); writer.enum("mode", target.mode);
  writeState(writer, target.state); writeOptions(writer, target.options);
  writer.string(value.actor.profileId); writer.string(value.actor.actorId); writer.string(value.actor.commandActorId); writer.hash(value.actor.profileCanonicalHash, 32);
  writer.u16(value.policy.version); writer.string(value.policy.id); writer.hash(value.policy.proposalHash, 32); writer.enum("decision", value.policy.decision);
  writer.f64(value.actualLegacyLoadWorldTime);
  for (const key of ["owner", "velocity", "grounded", "sessionAge"] as const) writer.enum(key, value.decisions[key]);
  const bytes = writer.finish(); if (bytes.length + HEADER + TRAILER > LEGACY_WORLD_CONTINUATION_MAX_BYTES_V1) fail("packet bound");
  return bytes;
}
function semantic(bytes: Uint8Array) { return new TypeScriptCanonicalHasher(SEMANTIC_DOMAIN).writeU16(1).writeBytes(bytes).finish(); }
function transport(bytes: Uint8Array) { return new TypeScriptCanonicalHasher(TRANSPORT_DOMAIN).writeBytes(bytes).finish(); }

/** Only ordinary, non-shared byte views: no caller iterator, species or getters. */
function packetSnapshot(bytes: Uint8Array) {
  if (!ArrayBuffer.isView(bytes) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype) fail("byte view shape or prototype");
  const length = byteLengthGetter.call(bytes) as number;
  if (length < HEADER + TRAILER || length > LEGACY_WORLD_CONTINUATION_MAX_BYTES_V1) fail("packet bound");
  // Ordinary typed-array indices are fixed data; any extra own property is a
  // caller hook, not a byte in the reviewed packet.
  if (Reflect.ownKeys(bytes).length !== length) fail("byte view field shape");
  const buffer = bufferGetter.call(bytes) as ArrayBuffer;
  if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype) fail("nonordinary or shared buffer");
  const offset = byteOffsetGetter.call(bytes) as number;
  const result = new Uint8Array(length);
  copyBytes.call(result, new Uint8Array(buffer, offset, length));
  return result;
}

export function encodeLegacyWorldContinuationV1(value: LegacyWorldContinuationV1): Uint8Array {
  const payload = body(value), writer = new Writer();
  writer.raw(MAGIC); writer.u16(1); writer.u16(0); writer.u32(payload.length); writer.raw(payload); writer.raw(semantic(payload));
  writer.raw(transport(writer.finish())); return writer.finish();
}
export function decodeLegacyWorldContinuationV1(bytes: Uint8Array, expectedSemanticHash?: string): LegacyWorldContinuationV1 {
  const packet = packetSnapshot(bytes), header = new Reader(packet);
  if (!equal(header.raw(4), MAGIC) || header.u16() !== 1 || header.u16() !== 0) fail("magic, schema or flags");
  const length = header.u32(); if (length !== packet.length - HEADER - TRAILER) fail("payload length");
  if (!equal(transport(packet.subarray(0, packet.length - 16)), packet.subarray(packet.length - 16))) fail("transport checksum");
  const incomingBody = header.raw(length), reader = new Reader(incomingBody);
  const source = { generatorVersion: reader.u16() as 16 | 17, rawSha256: reader.sha(), byteLength: reader.u64(),
    semanticHash: reader.hash(), worldSeed: reader.string(), state: readState(reader) };
  const target = { catalogWorldId: reader.string(), universeId: reader.string(), locationId: reader.string(),
    generatorHash: reader.hash(), contentHash: reader.hash(), normalizedSemanticHash: reader.hash(),
    generatorVersion: reader.u16() as 18, generatorProfile: reader.enum("generatorProfile"), mode: reader.enum("mode"),
    state: readState(reader), options: readOptions(reader) };
  const actor = { profileId: reader.string(), actorId: reader.string(), commandActorId: reader.string(), profileCanonicalHash: reader.sha() };
  const policy = { version: reader.u16() as 1, id: reader.string() as typeof LEGACY_WORLD_CONTINUATION_POLICY_ID_V1,
    proposalHash: reader.sha(), decision: reader.enum("decision") };
  const actualLegacyLoadWorldTime = reader.f64();
  const decisions = { owner: reader.enum("owner"), velocity: reader.enum("velocity"), grounded: reader.enum("grounded"), sessionAge: reader.enum("sessionAge") };
  if (reader.offset !== length) fail("trailing body");
  const value: LegacyWorldContinuationV1 = { schemaVersion: 1, source, target, actor, policy, actualLegacyLoadWorldTime, decisions };
  const canonicalBody = body(value), digest = semantic(canonicalBody);
  if (!equal(canonicalBody, incomingBody) || !equal(digest, header.raw(16))) fail("semantic hash or canonical body");
  if (expectedSemanticHash !== undefined && !equal(digest, hex(expectedSemanticHash, 16))) fail("expected semantic hash");
  return value;
}
/** Recomputes all typed terms; independent of any envelope or embedded digest. */
export function legacyWorldContinuationSemanticHashV1(value: LegacyWorldContinuationV1): LegacyContinuationCanonicalHashV1 {
  return hexString(semantic(body(value))) as LegacyContinuationCanonicalHashV1;
}
