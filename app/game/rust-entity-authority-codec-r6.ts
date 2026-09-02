import {
  RUST_ENTITY_MAX_COUNT_R6,
  RUST_ENTITY_MAX_EXTRACTION_BYTES_R6,
  RUST_ENTITY_MAX_EXTRACTION_RECORDS_R6,
  RUST_ENTITY_MAX_SNAPSHOT_BYTES_R6,
  RUST_ENTITY_SNAPSHOT_SCHEMA_R6_V2,
  type RustEntityAuthoritySnapshotR6V2,
  type RustEntityBlackboardValueR6,
  type RustEntityColdRecordR6,
  type RustEntityCompatibilityRecordR6,
  type RustEntityComponentsR6,
  type RustEntityDormantSummaryR6,
  type RustEntityExtractionPromotionR6V3,
  type RustEntityExtractionR6V3,
  type RustEntityExtractionRecordR6V3,
  type RustEntityHotRecordR6,
  type RustEntityIdR6,
  type RustEntityMapR6,
  type RustEntityResidencyR6,
  type RustEntityVec3R6,
} from "./rust-entity-authority-contract-r6";

const BWEA_MAGIC = Uint8Array.of(0x42, 0x57, 0x45, 0x41);
const BWEC_MAGIC = Uint8Array.of(0x42, 0x57, 0x45, 0x43);
const BWR6_MAGIC = Uint8Array.of(0x42, 0x57, 0x52, 0x36);
const MAX_COMPATIBILITY_STRING_BYTES = 4_096;
const MAX_COMPATIBILITY_MAP_ENTRIES = 256;
const MAX_COMPONENT_KEY_BYTES = 128;
const MAX_COMPONENT_TEXT_BYTES = 4_096;
const MAX_COMPONENT_MAP_ENTRIES = 128;
const MAX_ROUTE_POINTS = 256;
const MAX_THREATS = 64;
const MAX_MOUNT_SEATS = 8;
const MAX_UNKNOWN_EXTENSION_BYTES = 1_048_576;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const I64_MIN = -(BigInt(1) << BigInt(63));
const I64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const ENTITY_CLASSES = ["creature", "player", "sentient", "construct", "projectile", "vehicle"] as const;
const BODY_SHAPES = ["capsule", "box", "sphere", "serpentine", "flying", "aquatic"] as const;
const MOVEMENT_MODES = ["ground", "swim", "fly", "burrow", "climb", "mounted", "knocked-back", "disabled"] as const;
const AI_INTENTS = ["idle", "wander", "graze", "flee", "pursue", "attack", "follow", "work", "return-home", "scripted"] as const;
const TIERS = ["hero", "nearby", "coarse", "dormant"] as const;

function fail(message: string): never {
  throw new TypeError(`invalid R6 entity payload: ${message}`);
}

function integer(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} is outside ${minimum}..${maximum}`);
  return value;
}

function unsigned64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0) || value > U64_MAX) fail(`${label} is outside u64`);
  return value;
}

function signed64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < I64_MIN || value > I64_MAX) fail(`${label} is outside i64`);
  return value;
}

function finite(value: number, label: string) {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) fail(`${label} must fit finite f32`);
  return value;
}

function textBytes(value: string, maximum: number, label: string) {
  if (typeof value !== "string") fail(`${label} is not text`);
  const bytes = encoder.encode(value);
  if (bytes.byteLength > maximum) fail(`${label} exceeds ${maximum} UTF-8 bytes`);
  if (decoder.decode(bytes) !== value) fail(`${label} contains an unpaired UTF-16 surrogate`);
  return bytes;
}

function keyBytes(value: string, label: string) {
  const bytes = textBytes(value, MAX_COMPONENT_KEY_BYTES, label);
  if (bytes.byteLength === 0) fail(`${label} is empty`);
  return bytes;
}

function compareBytes(left: Uint8Array, right: Uint8Array) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function canonicalMap<T>(value: RustEntityMapR6<T>, maximum: number, keyMaximum: number, label: string) {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} exceeds its entry bound`);
  const seen = new Set<string>();
  const result = value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) fail(`${label}[${index}] is not a key/value pair`);
    const [key, item] = entry;
    const encoded = textBytes(key, keyMaximum, `${label} key`);
    if (encoded.byteLength === 0 || seen.has(key)) fail(`${label} contains an empty or duplicate key`);
    seen.add(key);
    return { key, item, encoded };
  });
  result.sort((left, right) => compareBytes(left.encoded, right.encoded));
  return result;
}

function mapEquals<T>(left: RustEntityMapR6<T>, right: RustEntityMapR6<T>, equal: (a: T, b: T) => boolean) {
  const a = canonicalMap(left, Number.MAX_SAFE_INTEGER, MAX_COMPATIBILITY_STRING_BYTES, "map");
  const b = canonicalMap(right, Number.MAX_SAFE_INTEGER, MAX_COMPATIBILITY_STRING_BYTES, "map");
  return a.length === b.length && a.every((entry, index) => entry.key === b[index].key && equal(entry.item, b[index].item));
}

function f32Bits(value: number) {
  const bytes = new ArrayBuffer(4);
  new DataView(bytes).setFloat32(0, value, true);
  return new DataView(bytes).getUint32(0, true);
}

function sameVec3(left: RustEntityVec3R6, right: RustEntityVec3R6) {
  // Native Vec3 equality is numeric, so +0 and -0 are equal even though the
  // canonical serializer correctly preserves their distinct wire bits.
  return Math.fround(left.x) === Math.fround(right.x)
    && Math.fround(left.y) === Math.fround(right.y)
    && Math.fround(left.z) === Math.fround(right.z);
}

function packedIndex(value: bigint) { return Number(value & BigInt(0xffff_ffff)); }
function packedGeneration(value: bigint) { return Number((value >> BigInt(32)) & BigInt(0xffff_ffff)); }

function validatePackedId(value: RustEntityIdR6, label: string) {
  unsigned64(value, label);
  if (packedIndex(value) === 0 || packedGeneration(value) === 0) fail(`${label} contains a reserved component`);
}

class Writer {
  private buffer = new ArrayBuffer(1_024);
  private view = new DataView(this.buffer);
  private length = 0;

  constructor(private readonly maximum = RUST_ENTITY_MAX_SNAPSHOT_BYTES_R6) {}

  private reserve(length: number) {
    const required = this.length + length;
    if (!Number.isSafeInteger(required) || required > this.maximum) fail(`payload exceeds ${this.maximum} bytes`);
    if (required <= this.buffer.byteLength) return;
    let capacity = this.buffer.byteLength;
    while (capacity < required) capacity = Math.min(this.maximum, capacity * 2);
    const next = new ArrayBuffer(capacity);
    new Uint8Array(next).set(new Uint8Array(this.buffer, 0, this.length));
    this.buffer = next;
    this.view = new DataView(next);
  }

  finish() { return new Uint8Array(this.buffer.slice(0, this.length)); }
  raw(value: Uint8Array) { this.reserve(value.byteLength); new Uint8Array(this.buffer, this.length, value.byteLength).set(value); this.length += value.byteLength; }
  u8(value: number) { this.reserve(1); this.view.setUint8(this.length, integer(value, 0, 0xff, "u8")); this.length += 1; }
  u16(value: number) { this.reserve(2); this.view.setUint16(this.length, integer(value, 0, 0xffff, "u16"), true); this.length += 2; }
  i16(value: number) { this.reserve(2); this.view.setInt16(this.length, integer(value, -0x8000, 0x7fff, "i16"), true); this.length += 2; }
  u32(value: number) { this.reserve(4); this.view.setUint32(this.length, integer(value, 0, 0xffff_ffff, "u32"), true); this.length += 4; }
  i32(value: number) { this.reserve(4); this.view.setInt32(this.length, integer(value, -0x8000_0000, 0x7fff_ffff, "i32"), true); this.length += 4; }
  u64(value: bigint) { this.reserve(8); this.view.setBigUint64(this.length, unsigned64(value, "u64"), true); this.length += 8; }
  i64(value: bigint) { this.reserve(8); this.view.setBigInt64(this.length, signed64(value, "i64"), true); this.length += 8; }
  f32(value: number) { this.reserve(4); this.view.setFloat32(this.length, finite(value, "f32"), true); this.length += 4; }
  bool(value: boolean) { if (typeof value !== "boolean") fail("boolean has an invalid value"); this.u8(value ? 1 : 0); }
  string(value: string, maximum = MAX_COMPONENT_TEXT_BYTES) { const bytes = textBytes(value, maximum, "string"); this.u32(bytes.byteLength); this.raw(bytes); }
  blob(value: Uint8Array, maximum: number) { if (!(value instanceof Uint8Array) || value.byteLength > maximum) fail("blob exceeds its bound"); this.u32(value.byteLength); this.raw(value); }
  vec3(value: RustEntityVec3R6) { this.f32(value.x); this.f32(value.y); this.f32(value.z); }
  optString(value: string | null, maximum: number) { this.bool(value !== null); if (value !== null) this.string(value, maximum); }
  optU64(value: bigint | null) { this.bool(value !== null); if (value !== null) this.u64(value); }
  optId(value: RustEntityIdR6 | null) { this.bool(value !== null); if (value !== null) { validatePackedId(value, "entity id"); this.u64(value); } }
}

class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.byteLength > RUST_ENTITY_MAX_SNAPSHOT_BYTES_R6) fail("payload exceeds 64 MiB");
  }

  take(length: number) {
    const end = this.offset + length;
    if (!Number.isSafeInteger(end) || length < 0 || end > this.bytes.byteLength) fail("payload is truncated");
    const value = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return value;
  }
  finish() { if (this.offset !== this.bytes.byteLength) fail("payload contains trailing bytes"); }
  u8() { return this.take(1)[0]; }
  u16() { const value = this.take(2); return new DataView(value.buffer, value.byteOffset, 2).getUint16(0, true); }
  i16() { const value = this.take(2); return new DataView(value.buffer, value.byteOffset, 2).getInt16(0, true); }
  u32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, true); }
  i32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getInt32(0, true); }
  u64() { const value = this.take(8); return new DataView(value.buffer, value.byteOffset, 8).getBigUint64(0, true); }
  i64() { const value = this.take(8); return new DataView(value.buffer, value.byteOffset, 8).getBigInt64(0, true); }
  f32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getFloat32(0, true); }
  bool() { const tag = this.u8(); if (tag > 1) fail(`invalid boolean tag ${tag}`); return tag === 1; }
  length(maximum: number, label: string) { const length = this.u32(); if (length > maximum) fail(`${label} exceeds its bound`); return length; }
  string(maximum = MAX_COMPONENT_TEXT_BYTES) { const bytes = this.take(this.length(maximum, "string")); try { return decoder.decode(bytes); } catch { return fail("payload contains invalid UTF-8"); } }
  blob(maximum: number) { return Uint8Array.from(this.take(this.length(maximum, "blob"))); }
  vec3(): RustEntityVec3R6 { return Object.freeze({ x: this.f32(), y: this.f32(), z: this.f32() }); }
  optString(maximum: number) { return this.bool() ? this.string(maximum) : null; }
  optU64() { return this.bool() ? this.u64() : null; }
  id() { const value = this.u64(); validatePackedId(value, "entity id"); return value; }
  optId() { return this.bool() ? this.id() : null; }
}

function expectMagic(reader: Reader, magic: Uint8Array) {
  const value = reader.take(magic.byteLength);
  if (!value.every((byte, index) => byte === magic[index])) fail("payload has invalid magic");
}

function readTag<T extends string>(reader: Reader, values: readonly T[], label: string): T {
  const tag = reader.u8();
  return values[tag] ?? fail(`invalid ${label} tag ${tag}`);
}

function writeTag<T extends string>(writer: Writer, value: T, values: readonly T[], label: string) {
  const tag = values.indexOf(value);
  if (tag < 0) fail(`invalid ${label}`);
  writer.u8(tag);
}

function readMap<T>(reader: Reader, maximum: number, keyMaximum: number, label: string, read: () => T): RustEntityMapR6<T> {
  const count = reader.length(maximum, label);
  const seen = new Set<string>();
  const result: (readonly [string, T])[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = reader.string(keyMaximum);
    if (key.length === 0 || seen.has(key)) fail(`${label} contains an empty or duplicate key`);
    seen.add(key);
    result.push(Object.freeze([key, read()] as const));
  }
  result.sort((left, right) => compareBytes(encoder.encode(left[0]), encoder.encode(right[0])));
  return Object.freeze(result);
}

function writeMap<T>(writer: Writer, value: RustEntityMapR6<T>, maximum: number, keyMaximum: number, label: string, write: (item: T) => void) {
  const entries = canonicalMap(value, maximum, keyMaximum, label);
  writer.u32(entries.length);
  for (const entry of entries) { writer.string(entry.key, keyMaximum); write(entry.item); }
}

function validateCompatibility(value: RustEntityCompatibilityRecordR6) {
  if (value.schema !== 1) fail("compatibility schema is unsupported");
  for (const [label, text] of [["external entity id", value.externalEntityId], ["specimen id", value.specimenId], ["kind key", value.kindKey]] as const) {
    if (textBytes(text, MAX_COMPATIBILITY_STRING_BYTES, label).byteLength === 0) fail(`${label} is empty`);
  }
  textBytes(value.bondTier, MAX_COMPATIBILITY_STRING_BYTES, "bond tier");
  for (const optional of [value.variantKey, value.name, value.ownerId, value.socialGroupId, value.factionId, value.settlementId]) {
    if (optional !== null) textBytes(optional, MAX_COMPATIBILITY_STRING_BYTES, "compatibility text");
  }
  if (!ENTITY_CLASSES.includes(value.class)) fail("entity class is invalid");
  validatePackedId(value.locationId, "location id");
  [value.position.x, value.position.y, value.position.z, value.yaw, value.velocity.x, value.velocity.y, value.velocity.z].forEach((item) => finite(item, "transform"));
  if (!Number.isFinite(value.health) || !Number.isFinite(value.maximumHealth) || value.maximumHealth <= 0 || value.health < 0 || value.health > value.maximumHealth) fail("health is outside its valid range");
  unsigned64(value.ageTicks, "age ticks");
  if (value.legacyNumericId !== null) unsigned64(value.legacyNumericId, "legacy numeric id");
  integer(value.bondPoints, 0, 0xffff_ffff, "bond points");
  canonicalMap(value.equipment, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "compatibility equipment").forEach(({ item }) => textBytes(item, MAX_COMPATIBILITY_STRING_BYTES, "equipment item"));
  canonicalMap(value.research, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "compatibility research").forEach(({ item }) => integer(item, 0, 0xffff_ffff, "research value"));
  canonicalMap(value.custom, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "compatibility custom").forEach(({ item }) => textBytes(item, MAX_COMPATIBILITY_STRING_BYTES, "custom value"));
}

export function validateRustEntityCompatibilityRecordR6V1(value: RustEntityCompatibilityRecordR6) {
  validateCompatibility(value);
  return value;
}

function writeCompatibility(writer: Writer, value: RustEntityCompatibilityRecordR6) {
  validateCompatibility(value);
  writer.u16(value.schema);
  writer.string(value.externalEntityId, MAX_COMPATIBILITY_STRING_BYTES);
  writer.optU64(value.legacyNumericId);
  writer.string(value.specimenId, MAX_COMPATIBILITY_STRING_BYTES);
  writer.string(value.kindKey, MAX_COMPATIBILITY_STRING_BYTES);
  writeTag(writer, value.class, ENTITY_CLASSES, "entity class");
  writer.optString(value.variantKey, MAX_COMPATIBILITY_STRING_BYTES);
  writer.optString(value.name, MAX_COMPATIBILITY_STRING_BYTES);
  writer.u64(value.locationId);
  writer.vec3(value.position);
  writer.f32(value.yaw);
  writer.vec3(value.velocity);
  writer.f32(value.health);
  writer.f32(value.maximumHealth);
  writer.u64(value.ageTicks);
  writer.bool(value.naturalSpawned);
  writer.bool(value.everLed);
  writer.optString(value.ownerId, MAX_COMPATIBILITY_STRING_BYTES);
  writer.bool(value.tamed);
  writer.u32(value.bondPoints);
  writer.string(value.bondTier, MAX_COMPATIBILITY_STRING_BYTES);
  writer.optString(value.socialGroupId, MAX_COMPATIBILITY_STRING_BYTES);
  writer.optString(value.factionId, MAX_COMPATIBILITY_STRING_BYTES);
  writer.optString(value.settlementId, MAX_COMPATIBILITY_STRING_BYTES);
  writeMap(writer, value.equipment, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "compatibility equipment", (item) => writer.string(item, MAX_COMPATIBILITY_STRING_BYTES));
  writeMap(writer, value.research, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "compatibility research", (item) => writer.u32(item));
  writeMap(writer, value.custom, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "compatibility custom", (item) => writer.string(item, MAX_COMPATIBILITY_STRING_BYTES));
}

function readCompatibility(reader: Reader): RustEntityCompatibilityRecordR6 {
  const value: RustEntityCompatibilityRecordR6 = Object.freeze({
    schema: reader.u16() as 1,
    externalEntityId: reader.string(MAX_COMPATIBILITY_STRING_BYTES),
    legacyNumericId: reader.optU64(),
    specimenId: reader.string(MAX_COMPATIBILITY_STRING_BYTES),
    kindKey: reader.string(MAX_COMPATIBILITY_STRING_BYTES),
    class: readTag(reader, ENTITY_CLASSES, "entity class"),
    variantKey: reader.optString(MAX_COMPATIBILITY_STRING_BYTES),
    name: reader.optString(MAX_COMPATIBILITY_STRING_BYTES),
    locationId: reader.u64(),
    position: reader.vec3(),
    yaw: reader.f32(),
    velocity: reader.vec3(),
    health: reader.f32(),
    maximumHealth: reader.f32(),
    ageTicks: reader.u64(),
    naturalSpawned: reader.bool(),
    everLed: reader.bool(),
    ownerId: reader.optString(MAX_COMPATIBILITY_STRING_BYTES),
    tamed: reader.bool(),
    bondPoints: reader.u32(),
    bondTier: reader.string(MAX_COMPATIBILITY_STRING_BYTES),
    socialGroupId: reader.optString(MAX_COMPATIBILITY_STRING_BYTES),
    factionId: reader.optString(MAX_COMPATIBILITY_STRING_BYTES),
    settlementId: reader.optString(MAX_COMPATIBILITY_STRING_BYTES),
    equipment: readMap(reader, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "compatibility equipment", () => reader.string(MAX_COMPATIBILITY_STRING_BYTES)),
    research: readMap(reader, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "compatibility research", () => reader.u32()),
    custom: readMap(reader, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "compatibility custom", () => reader.string(MAX_COMPATIBILITY_STRING_BYTES)),
  });
  validateCompatibility(value);
  return value;
}

function writeOption<T>(writer: Writer, value: T | null, write: (item: T) => void) { writer.bool(value !== null); if (value !== null) write(value); }

function readComponents(reader: Reader): RustEntityComponentsR6 {
  const vitals = Object.freeze({
    health: reader.f32(), maximumHealth: reader.f32(), hungerMilli: reader.u16(), saturationMilli: reader.u16(), oxygenMilli: reader.u16(),
    temperatureMilli: reader.i16(), wetnessMilli: reader.u16(), environmentFlags: reader.u32(), lastDamageTick: reader.u64(), lastBreathTick: reader.u64(),
  });
  const locomotion = Object.freeze({
    shape: readTag(reader, BODY_SHAPES, "body shape"), radius: reader.f32(), halfHeight: reader.f32(), mass: reader.f32(), stepHeight: reader.f32(),
    velocity: reader.vec3(), desiredVelocity: reader.vec3(), grounded: reader.bool(), submerged: reader.bool(),
    movementMode: readTag(reader, MOVEMENT_MODES, "movement mode"),
    action: Object.freeze({ key: reader.string(), phase: reader.u16(), startedTick: reader.u64(), endsTick: reader.u64(), target: reader.optId() }),
    cooldowns: readMap(reader, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "cooldowns", () => reader.u64()),
  });
  const intent = readTag(reader, AI_INTENTS, "AI intent");
  const intentKey = reader.string();
  const target = reader.optId();
  const home = reader.vec3();
  const blackboard = readMap<RustEntityBlackboardValueR6>(reader, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "blackboard", () => {
    const tag = reader.u8();
    if (tag === 0) return Object.freeze({ type: "bool", value: reader.bool() });
    if (tag === 1) return Object.freeze({ type: "signed", value: reader.i64() });
    if (tag === 2) return Object.freeze({ type: "unsigned", value: reader.u64() });
    if (tag === 3) return Object.freeze({ type: "fixed-milli", value: reader.i64() });
    if (tag === 4) return Object.freeze({ type: "text", value: reader.string() });
    if (tag === 5) return Object.freeze({ type: "entity", value: reader.id() });
    if (tag === 6) return Object.freeze({ type: "bytes", value: reader.blob(MAX_COMPONENT_TEXT_BYTES) });
    return fail(`invalid blackboard tag ${tag}`);
  });
  const routeEpoch = reader.u64();
  const routeCursor = reader.u16();
  const route = Object.freeze(Array.from({ length: reader.length(MAX_ROUTE_POINTS, "AI route") }, () => reader.vec3()));
  const threats = Object.freeze(Array.from({ length: reader.length(MAX_THREATS, "AI threats") }, () => Object.freeze({
    entity: reader.id(), scoreMilli: reader.u32(), lastSeenTick: reader.u64(), lastKnownCell: Object.freeze([reader.i32(), reader.i32(), reader.i32()] as const),
  })));
  const ai = Object.freeze({
    intent, intentKey, target, home, blackboard,
    routeEpoch, routeCursor, route, threats, decisionDueTick: reader.u64(),
  });
  const social = Object.freeze({
    groupId: reader.optString(MAX_COMPONENT_TEXT_BYTES), leader: reader.optId(), following: reader.optId(), herdRank: reader.i16(),
    dispositionMilli: reader.i16(), preferredSeparation: reader.f32(), lastSocialTick: reader.u64(),
  });
  const parentMount = reader.optId();
  const occupiedSeat = reader.bool() ? reader.u8() : null;
  const seats = Object.freeze(Array.from({ length: reader.length(MAX_MOUNT_SEATS, "mount seats") }, () => Object.freeze({
    index: reader.u8(), role: reader.string(), offset: reader.vec3(), occupant: reader.optId(), controlWeightMilli: reader.u16(),
  })));
  const mount = Object.freeze({ parentMount, occupiedSeat, seats, saddleKey: reader.optString(MAX_COMPONENT_TEXT_BYTES), acceptsRiders: reader.bool() });
  const protection = Object.freeze({
    flags: reader.u64(), firstOwnedTick: reader.optU64(), firstLedTick: reader.optU64(), enclosureVerifiedTick: reader.optU64(), namedTick: reader.optU64(),
    provenanceKey: reader.optString(MAX_COMPONENT_TEXT_BYTES),
  });
  const network = Object.freeze({
    ownerPeerId: reader.optString(MAX_COMPONENT_TEXT_BYTES), lastCommandSequence: reader.u64(), lastCommandTick: reader.u64(),
    leaseEpoch: reader.u64(), leaseExpiresTick: reader.u64(),
  });
  const care = reader.bool() ? Object.freeze({ stabilized: reader.bool(), nourishmentMilli: reader.u16(), trustMilli: reader.u16(), careStage: reader.u16(), lastCareTick: reader.u64() }) : null;
  const husbandry = reader.bool() ? Object.freeze({
    sex: reader.u8(), maturityMilli: reader.u16(), breedCooldownUntilTick: reader.u64(), gestationUntilTick: reader.u64(),
    parentSpecimenIds: Object.freeze(Array.from({ length: reader.length(2, "husbandry parents") }, () => reader.string())),
  }) : null;
  const work = reader.bool() ? Object.freeze({
    taskKey: reader.string(), progressMilli: reader.u16(), targetEntity: reader.optId(),
    targetCell: reader.bool() ? Object.freeze([reader.i32(), reader.i32(), reader.i32()] as const) : null,
    carryingItemKey: reader.optString(MAX_COMPONENT_TEXT_BYTES), dueTick: reader.u64(),
  }) : null;
  const equipment = readMap(reader, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "equipment", () => Object.freeze({
    itemKey: reader.string(), count: reader.u16(), durability: reader.u32(),
    custom: readMap(reader, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "equipment custom", () => reader.blob(MAX_COMPONENT_TEXT_BYTES)),
  }));
  const dragon = reader.bool() ? Object.freeze({
    lineageKey: reader.string(), elementKey: reader.string(), lifeStage: reader.u16(), flightStaminaMilli: reader.u16(), breathChargeMilli: reader.u16(), eggOrHatchling: reader.bool(),
  }) : null;
  const legendary = reader.bool() ? Object.freeze({
    encounterKey: reader.string(), phase: reader.u16(), defeated: reader.bool(), captureLockUntilTick: reader.u64(),
    worldFlags: readMap(reader, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "legendary flags", () => reader.u64()),
  }) : null;
  const summon = reader.bool() ? Object.freeze({
    originRealmKey: reader.string(), summonerId: reader.optString(MAX_COMPONENT_TEXT_BYTES), expiresTick: reader.u64(), grounded: reader.bool(), groundingItemKey: reader.optString(MAX_COMPONENT_TEXT_BYTES),
  }) : null;
  const sentient = reader.bool() ? Object.freeze({
    factionId: reader.optString(MAX_COMPONENT_TEXT_BYTES), settlementId: reader.optString(MAX_COMPONENT_TEXT_BYTES), occupationKey: reader.string(),
    dialogueState: readMap(reader, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "dialogue state", () => reader.u32()), reputationMilli: reader.i32(),
  }) : null;
  const unknownExtensions = readMap(reader, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "unknown extensions", () => reader.blob(MAX_UNKNOWN_EXTENSION_BYTES));
  const value = Object.freeze({ vitals, locomotion, ai, social, mount, protection, network, care, husbandry, work, equipment, dragon, legendary, summon, sentient, unknownExtensions });
  validateComponents(value);
  return value;
}

function writeComponents(writer: Writer, value: RustEntityComponentsR6) {
  validateComponents(value);
  const v = value.vitals;
  writer.f32(v.health); writer.f32(v.maximumHealth); writer.u16(v.hungerMilli); writer.u16(v.saturationMilli); writer.u16(v.oxygenMilli); writer.i16(v.temperatureMilli);
  writer.u16(v.wetnessMilli); writer.u32(v.environmentFlags); writer.u64(v.lastDamageTick); writer.u64(v.lastBreathTick);
  const l = value.locomotion;
  writeTag(writer, l.shape, BODY_SHAPES, "body shape"); writer.f32(l.radius); writer.f32(l.halfHeight); writer.f32(l.mass); writer.f32(l.stepHeight); writer.vec3(l.velocity); writer.vec3(l.desiredVelocity);
  writer.bool(l.grounded); writer.bool(l.submerged); writeTag(writer, l.movementMode, MOVEMENT_MODES, "movement mode");
  writer.string(l.action.key); writer.u16(l.action.phase); writer.u64(l.action.startedTick); writer.u64(l.action.endsTick); writer.optId(l.action.target);
  writeMap(writer, l.cooldowns, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "cooldowns", (item) => writer.u64(item));
  const ai = value.ai;
  writeTag(writer, ai.intent, AI_INTENTS, "AI intent"); writer.string(ai.intentKey); writer.optId(ai.target); writer.vec3(ai.home);
  writeMap(writer, ai.blackboard, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "blackboard", (item) => {
    const tags = { bool: 0, signed: 1, unsigned: 2, "fixed-milli": 3, text: 4, entity: 5, bytes: 6 } as const;
    writer.u8(tags[item.type]);
    if (item.type === "bool") writer.bool(item.value);
    else if (item.type === "signed" || item.type === "fixed-milli") writer.i64(item.value);
    else if (item.type === "unsigned") writer.u64(item.value);
    else if (item.type === "text") writer.string(item.value);
    else if (item.type === "entity") { validatePackedId(item.value, "blackboard entity"); writer.u64(item.value); }
    else writer.blob(item.value, MAX_COMPONENT_TEXT_BYTES);
  });
  writer.u64(ai.routeEpoch); writer.u16(ai.routeCursor); writer.u32(ai.route.length); ai.route.forEach((point) => writer.vec3(point));
  writer.u32(ai.threats.length); ai.threats.forEach((threat) => { writer.u64(threat.entity); writer.u32(threat.scoreMilli); writer.u64(threat.lastSeenTick); threat.lastKnownCell.forEach((item) => writer.i32(item)); });
  writer.u64(ai.decisionDueTick);
  const s = value.social;
  writer.optString(s.groupId, MAX_COMPONENT_TEXT_BYTES); writer.optId(s.leader); writer.optId(s.following); writer.i16(s.herdRank); writer.i16(s.dispositionMilli); writer.f32(s.preferredSeparation); writer.u64(s.lastSocialTick);
  const m = value.mount;
  writer.optId(m.parentMount); writer.bool(m.occupiedSeat !== null); if (m.occupiedSeat !== null) writer.u8(m.occupiedSeat); writer.u32(m.seats.length);
  m.seats.forEach((seat) => { writer.u8(seat.index); writer.string(seat.role); writer.vec3(seat.offset); writer.optId(seat.occupant); writer.u16(seat.controlWeightMilli); });
  writer.optString(m.saddleKey, MAX_COMPONENT_TEXT_BYTES); writer.bool(m.acceptsRiders);
  const p = value.protection;
  writer.u64(p.flags); writer.optU64(p.firstOwnedTick); writer.optU64(p.firstLedTick); writer.optU64(p.enclosureVerifiedTick); writer.optU64(p.namedTick); writer.optString(p.provenanceKey, MAX_COMPONENT_TEXT_BYTES);
  const n = value.network;
  writer.optString(n.ownerPeerId, MAX_COMPONENT_TEXT_BYTES); writer.u64(n.lastCommandSequence); writer.u64(n.lastCommandTick); writer.u64(n.leaseEpoch); writer.u64(n.leaseExpiresTick);
  writeOption(writer, value.care, (state) => { writer.bool(state.stabilized); writer.u16(state.nourishmentMilli); writer.u16(state.trustMilli); writer.u16(state.careStage); writer.u64(state.lastCareTick); });
  writeOption(writer, value.husbandry, (state) => { writer.u8(state.sex); writer.u16(state.maturityMilli); writer.u64(state.breedCooldownUntilTick); writer.u64(state.gestationUntilTick); writer.u32(state.parentSpecimenIds.length); state.parentSpecimenIds.forEach((item) => writer.string(item)); });
  writeOption(writer, value.work, (state) => { writer.string(state.taskKey); writer.u16(state.progressMilli); writer.optId(state.targetEntity); writer.bool(state.targetCell !== null); state.targetCell?.forEach((item) => writer.i32(item)); writer.optString(state.carryingItemKey, MAX_COMPONENT_TEXT_BYTES); writer.u64(state.dueTick); });
  writeMap(writer, value.equipment, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "equipment", (state) => {
    writer.string(state.itemKey); writer.u16(state.count); writer.u32(state.durability);
    writeMap(writer, state.custom, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "equipment custom", (item) => writer.blob(item, MAX_COMPONENT_TEXT_BYTES));
  });
  writeOption(writer, value.dragon, (state) => { writer.string(state.lineageKey); writer.string(state.elementKey); writer.u16(state.lifeStage); writer.u16(state.flightStaminaMilli); writer.u16(state.breathChargeMilli); writer.bool(state.eggOrHatchling); });
  writeOption(writer, value.legendary, (state) => { writer.string(state.encounterKey); writer.u16(state.phase); writer.bool(state.defeated); writer.u64(state.captureLockUntilTick); writeMap(writer, state.worldFlags, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "legendary flags", (item) => writer.u64(item)); });
  writeOption(writer, value.summon, (state) => { writer.string(state.originRealmKey); writer.optString(state.summonerId, MAX_COMPONENT_TEXT_BYTES); writer.u64(state.expiresTick); writer.bool(state.grounded); writer.optString(state.groundingItemKey, MAX_COMPONENT_TEXT_BYTES); });
  writeOption(writer, value.sentient, (state) => { writer.optString(state.factionId, MAX_COMPONENT_TEXT_BYTES); writer.optString(state.settlementId, MAX_COMPONENT_TEXT_BYTES); writer.string(state.occupationKey); writeMap(writer, state.dialogueState, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "dialogue state", (item) => writer.u32(item)); writer.i32(state.reputationMilli); });
  writeMap(writer, value.unknownExtensions, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "unknown extensions", (item) => writer.blob(item, MAX_UNKNOWN_EXTENSION_BYTES));
}

function validateComponents(value: RustEntityComponentsR6) {
  const v = value.vitals;
  if (!Number.isFinite(v.health) || !Number.isFinite(v.maximumHealth) || v.maximumHealth <= 0 || v.health < 0 || v.health > v.maximumHealth) fail("component health is outside its valid range");
  [v.hungerMilli, v.saturationMilli, v.oxygenMilli, v.wetnessMilli].forEach((item) => { if (integer(item, 0, 0xffff, "environment meter") > 10_000) fail("environment meter exceeds 10000"); });
  integer(v.temperatureMilli, -0x8000, 0x7fff, "temperature"); integer(v.environmentFlags, 0, 0xffff_ffff, "environment flags"); unsigned64(v.lastDamageTick, "last damage tick"); unsigned64(v.lastBreathTick, "last breath tick");
  const l = value.locomotion;
  [l.radius, l.halfHeight, l.mass, l.stepHeight, ...Object.values(l.velocity), ...Object.values(l.desiredVelocity)].forEach((item) => finite(item, "locomotion"));
  if (l.radius <= 0 || l.halfHeight <= 0 || l.mass <= 0 || l.stepHeight < 0) fail("locomotion dimensions are invalid");
  keyBytes(l.action.key, "action key");
  if (l.action.target !== null) validatePackedId(l.action.target, "action target");
  canonicalMap(l.cooldowns, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "cooldowns").forEach(({ key, item }) => { keyBytes(key, "cooldown key"); unsigned64(item, "cooldown tick"); });
  const ai = value.ai;
  keyBytes(ai.intentKey, "AI intent key"); [ai.home.x, ai.home.y, ai.home.z].forEach((item) => finite(item, "AI home"));
  if (ai.target !== null) validatePackedId(ai.target, "AI target");
  if (ai.route.length > MAX_ROUTE_POINTS || ai.routeCursor > ai.route.length) fail("AI route exceeds bounds");
  ai.route.forEach((point) => Object.values(point).forEach((item) => finite(item, "AI route point")));
  if (ai.threats.length > MAX_THREATS) fail("AI threats exceed bounds");
  ai.threats.forEach((threat, index) => { validatePackedId(threat.entity, "threat entity"); if (index > 0 && ai.threats[index - 1].entity >= threat.entity) fail("threats are not strictly ordered"); });
  canonicalMap(ai.blackboard, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "blackboard").forEach(({ key, item }) => {
    keyBytes(key, "blackboard key");
    if (item.type === "text") textBytes(item.value, MAX_COMPONENT_TEXT_BYTES, "blackboard text");
    else if (item.type === "bytes" && item.value.byteLength > MAX_COMPONENT_TEXT_BYTES) fail("blackboard bytes exceed bound");
    else if (item.type === "entity") validatePackedId(item.value, "blackboard entity");
    else if (item.type === "unsigned") unsigned64(item.value, "blackboard unsigned");
    else if (item.type === "signed" || item.type === "fixed-milli") signed64(item.value, "blackboard signed");
  });
  if (!Number.isFinite(value.social.preferredSeparation) || value.social.preferredSeparation < 0) fail("preferred separation is invalid");
  [value.social.leader, value.social.following, value.mount.parentMount].forEach((id) => { if (id !== null) validatePackedId(id, "entity reference"); });
  if (value.mount.seats.length > MAX_MOUNT_SEATS) fail("mount seats exceed bound");
  value.mount.seats.forEach((seat, index) => { keyBytes(seat.role, "mount role"); Object.values(seat.offset).forEach((item) => finite(item, "mount seat offset")); if (index > 0 && value.mount.seats[index - 1].index >= seat.index) fail("mount seats are not strictly ordered"); if (seat.occupant !== null) validatePackedId(seat.occupant, "seat occupant"); });
  if (value.mount.occupiedSeat !== null && !value.mount.seats.some((seat) => seat.index === value.mount.occupiedSeat)) fail("occupied mount seat does not exist");
  for (const text of [value.social.groupId, value.mount.saddleKey, value.protection.provenanceKey, value.network.ownerPeerId]) {
    if (text !== null) textBytes(text, MAX_COMPONENT_TEXT_BYTES, "component text");
  }
  if (value.care && (value.care.nourishmentMilli > 10_000 || value.care.trustMilli > 10_000)) fail("care meter exceeds 10000");
  if (value.husbandry) {
    if (value.husbandry.sex > 2 || value.husbandry.maturityMilli > 10_000 || value.husbandry.parentSpecimenIds.length > 2) fail("husbandry state exceeds bounds");
    value.husbandry.parentSpecimenIds.forEach((item) => textBytes(item, MAX_COMPONENT_TEXT_BYTES, "husbandry parent"));
  }
  if (value.work) { keyBytes(value.work.taskKey, "work key"); if (value.work.progressMilli > 10_000) fail("work progress exceeds 10000"); if (value.work.targetEntity !== null) validatePackedId(value.work.targetEntity, "work target"); if (value.work.carryingItemKey !== null) textBytes(value.work.carryingItemKey, MAX_COMPONENT_TEXT_BYTES, "carrying item"); }
  canonicalMap(value.equipment, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "equipment").forEach(({ key, item }) => { keyBytes(key, "equipment slot"); keyBytes(item.itemKey, "equipment item"); if (item.count === 0) fail("equipment count is zero"); canonicalMap(item.custom, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "equipment custom").forEach(({ key: customKey, item: bytes }) => { keyBytes(customKey, "equipment custom key"); if (bytes.byteLength > MAX_COMPONENT_TEXT_BYTES) fail("equipment custom bytes exceed bound"); }); });
  if (value.dragon) { keyBytes(value.dragon.lineageKey, "dragon lineage"); keyBytes(value.dragon.elementKey, "dragon element"); if (value.dragon.flightStaminaMilli > 10_000 || value.dragon.breathChargeMilli > 10_000) fail("dragon meter exceeds 10000"); }
  if (value.legendary) { keyBytes(value.legendary.encounterKey, "legendary encounter"); canonicalMap(value.legendary.worldFlags, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "legendary flags").forEach(({ key }) => keyBytes(key, "legendary flag")); }
  if (value.summon) { keyBytes(value.summon.originRealmKey, "summon realm"); for (const text of [value.summon.summonerId, value.summon.groundingItemKey]) if (text !== null) textBytes(text, MAX_COMPONENT_TEXT_BYTES, "summon text"); }
  if (value.sentient) { keyBytes(value.sentient.occupationKey, "occupation key"); for (const text of [value.sentient.factionId, value.sentient.settlementId]) if (text !== null) textBytes(text, MAX_COMPONENT_TEXT_BYTES, "sentient text"); canonicalMap(value.sentient.dialogueState, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "dialogue state").forEach(({ key }) => keyBytes(key, "dialogue key")); }
  let unknownBytes = 0;
  canonicalMap(value.unknownExtensions, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "unknown extensions").forEach(({ key, item }) => { keyBytes(key, "extension key"); unknownBytes += item.byteLength; });
  if (unknownBytes > MAX_UNKNOWN_EXTENSION_BYTES) fail("unknown extensions exceed one MiB");
}

export function validateRustEntityComponentsR6(value: RustEntityComponentsR6) {
  validateComponents(value);
  return value;
}

function readDormantSummary(reader: Reader): RustEntityDormantSummaryR6 {
  return Object.freeze({
    sleptAtTick: reader.u64(), lastAdvancedTick: reader.u64(), careCycles: reader.u32(), breedingCycles: reader.u32(), workCycles: reader.u32(),
    nextCareTick: reader.u64(), nextBreedingTick: reader.u64(), nextWorkTick: reader.u64(), nextEcologyTick: reader.u64(), routeEpoch: reader.u64(), populationCostQuarters: reader.u32(),
  });
}

function writeDormantSummary(writer: Writer, value: RustEntityDormantSummaryR6) {
  writer.u64(value.sleptAtTick); writer.u64(value.lastAdvancedTick); writer.u32(value.careCycles); writer.u32(value.breedingCycles); writer.u32(value.workCycles);
  writer.u64(value.nextCareTick); writer.u64(value.nextBreedingTick); writer.u64(value.nextWorkTick); writer.u64(value.nextEcologyTick); writer.u64(value.routeEpoch); writer.u32(value.populationCostQuarters);
}

function validateEntityMirror(record: RustEntityCompatibilityRecordR6, components: RustEntityComponentsR6, entityRevision: bigint, protection: bigint) {
  validateCompatibility(record); validateComponents(components);
  if (entityRevision === BigInt(0)) fail("live entity has zero revision");
  if (protection !== components.protection.flags) fail("protection mirror diverged from typed provenance");
  if (f32Bits(record.health) !== f32Bits(components.vitals.health) || f32Bits(record.maximumHealth) !== f32Bits(components.vitals.maximumHealth) || !sameVec3(record.velocity, components.locomotion.velocity) || record.socialGroupId !== components.social.groupId) fail("compatibility shell diverged from typed components");
  const equipment = components.equipment.map(([key, item]) => [key, item.itemKey] as const);
  if (!mapEquals(record.equipment, equipment, (left, right) => left === right)) fail("compatibility equipment diverged from typed components");
}

export function validateRustEntityAuthoritySnapshotR6V2(value: RustEntityAuthoritySnapshotR6V2) {
  if (value.schema !== RUST_ENTITY_SNAPSHOT_SCHEMA_R6_V2) fail("authority schema is unsupported");
  unsigned64(value.revision, "authority revision"); if (value.lastSequence !== null) unsigned64(value.lastSequence, "last sequence");
  if (!Array.isArray(value.slots) || value.slots.length === 0 || value.slots.length > RUST_ENTITY_MAX_COUNT_R6 + 1) fail("slot count exceeds bound");
  if (value.slots[0].generation !== 0 || value.slots[0].residency !== null) fail("reserved slot is not canonical");
  const expectedFree: number[] = [];
  value.slots.forEach((slot, index) => { integer(slot.generation, 0, 0xffff_ffff, "slot generation"); if (index > 0 && slot.generation === 0) fail("non-reserved slot has zero generation"); if (slot.residency !== null && slot.residency !== "hot" && slot.residency !== "cold") fail("slot residency is invalid"); if (index > 0 && slot.residency === null) expectedFree.push(index); });
  if (value.free.length !== expectedFree.length || value.free.some((item, index) => item !== expectedFree[index])) fail("free set does not match empty slots");
  if (value.hot.length + value.cold.length > RUST_ENTITY_MAX_COUNT_R6) fail("entity count exceeds bound");
  const ids = new Set<bigint>(); const externalIds = new Set<string>();
  const validateResident = (entity: RustEntityHotRecordR6 | RustEntityColdRecordR6, residency: RustEntityResidencyR6) => {
    validatePackedId(entity.id, "resident entity id"); const index = packedIndex(entity.id); const generation = packedGeneration(entity.id);
    if (index >= value.slots.length || value.slots[index].generation !== generation || value.slots[index].residency !== residency) fail("entity id does not match its slot");
    if (ids.has(entity.id)) fail("duplicate resident entity id"); ids.add(entity.id);
    if (externalIds.has(entity.record.externalEntityId)) fail("duplicate external entity id"); externalIds.add(entity.record.externalEntityId);
    validateEntityMirror(entity.record, entity.components, entity.entityRevision, entity.protection);
  };
  let previous = BigInt(-1);
  value.hot.forEach((entity) => { if (entity.id <= previous) fail("hot entity ids are not canonical"); previous = entity.id; validateResident(entity, "hot"); if (!Number.isFinite(entity.outOfRangeSeconds) || entity.outOfRangeSeconds < 0) fail("hot range timer is invalid"); });
  previous = BigInt(-1);
  value.cold.forEach((entity) => { if (entity.id <= previous) fail("cold entity ids are not canonical"); previous = entity.id; validateResident(entity, "cold"); if (entity.summary.routeEpoch !== entity.components.ai.routeEpoch) fail("dormant route epoch diverged from AI state"); });
  value.slots.forEach((slot, index) => { if (index > 0 && slot.residency !== null) { const id = (BigInt(slot.generation) << BigInt(32)) | BigInt(index); if (!ids.has(id)) fail("occupied slot has no matching entity"); } });
  return value;
}

export function encodeRustEntityCompatibilityRecordR6V1(value: RustEntityCompatibilityRecordR6) {
  const writer = new Writer(); writer.raw(BWEC_MAGIC); writeCompatibility(writer, value); return writer.finish();
}

export function decodeRustEntityCompatibilityRecordR6V1(value: Uint8Array | ArrayBuffer) {
  const reader = new Reader(value instanceof Uint8Array ? value : new Uint8Array(value)); expectMagic(reader, BWEC_MAGIC); const result = readCompatibility(reader); reader.finish(); return result;
}

export function encodeRustEntityAuthoritySnapshotR6V2(value: RustEntityAuthoritySnapshotR6V2) {
  validateRustEntityAuthoritySnapshotR6V2(value);
  const writer = new Writer(); writer.raw(BWEA_MAGIC); writer.u16(value.schema); writer.u64(value.revision); writer.optU64(value.lastSequence);
  writer.u32(value.slots.length); value.slots.forEach((slot) => { writer.u32(slot.generation); writer.u8(slot.residency === null ? 0 : slot.residency === "hot" ? 1 : 2); });
  writer.u32(value.free.length); value.free.forEach((index) => writer.u32(index));
  writer.u32(value.hot.length); value.hot.forEach((entity) => { writer.u64(entity.id); writeCompatibility(writer, entity.record); writeComponents(writer, entity.components); writer.u64(entity.entityRevision); const tier = TIERS.indexOf(entity.tier); if (tier < 0) fail("invalid simulation tier"); writer.u16(tier); writer.u64(entity.protection); writer.f32(entity.outOfRangeSeconds); writer.u64(entity.lastSimulatedTick); });
  writer.u32(value.cold.length); value.cold.forEach((entity) => { writer.u64(entity.id); writeCompatibility(writer, entity.record); writeComponents(writer, entity.components); writer.u64(entity.entityRevision); writer.u64(entity.protection); writeDormantSummary(writer, entity.summary); });
  return writer.finish();
}

export function decodeRustEntityAuthoritySnapshotR6V2(value: Uint8Array | ArrayBuffer) {
  const reader = new Reader(value instanceof Uint8Array ? value : new Uint8Array(value)); expectMagic(reader, BWEA_MAGIC);
  const schema = reader.u16(); if (schema !== RUST_ENTITY_SNAPSHOT_SCHEMA_R6_V2) fail(`unsupported authority schema ${schema}`);
  const revision = reader.u64(); const lastSequence = reader.optU64();
  const slots = Object.freeze(Array.from({ length: reader.length(RUST_ENTITY_MAX_COUNT_R6 + 1, "slot count") }, () => {
    const generation = reader.u32(); const tag = reader.u8(); const residency: RustEntityResidencyR6 | null = tag === 0 ? null : tag === 1 ? "hot" : tag === 2 ? "cold" : fail(`invalid residency tag ${tag}`);
    return Object.freeze({ generation, residency });
  }));
  const freeWire = Array.from({ length: reader.length(RUST_ENTITY_MAX_COUNT_R6, "free set") }, () => reader.u32());
  if (new Set(freeWire).size !== freeWire.length) fail("free set contains a duplicate index");
  const free = Object.freeze(freeWire.sort((left, right) => left - right));
  const hot: RustEntityHotRecordR6[] = Array.from({ length: reader.length(RUST_ENTITY_MAX_COUNT_R6, "hot entities") }, () => {
    const id = reader.id(); const record = readCompatibility(reader); const components = readComponents(reader); const entityRevision = reader.u64();
    const tier = TIERS[reader.u16()] ?? fail("invalid simulation tier"); if (tier === "dormant") fail("hot entity uses dormant tier");
    return Object.freeze({ id, record, components, entityRevision, tier, protection: reader.u64(), outOfRangeSeconds: reader.f32(), lastSimulatedTick: reader.u64() });
  });
  const cold: RustEntityColdRecordR6[] = Array.from({ length: reader.length(RUST_ENTITY_MAX_COUNT_R6, "cold entities") }, () => Object.freeze({
    id: reader.id(), record: readCompatibility(reader), components: readComponents(reader), entityRevision: reader.u64(), protection: reader.u64(), summary: readDormantSummary(reader),
  }));
  reader.finish();
  hot.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  cold.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const result: RustEntityAuthoritySnapshotR6V2 = Object.freeze({ schema: 2, revision, lastSequence, slots, free, hot: Object.freeze(hot), cold: Object.freeze(cold) });
  return validateRustEntityAuthoritySnapshotR6V2(result);
}

export function createEmptyRustEntityAuthoritySnapshotR6V2(): RustEntityAuthoritySnapshotR6V2 {
  return Object.freeze({ schema: 2, revision: BigInt(0), lastSequence: null, slots: Object.freeze([Object.freeze({ generation: 0, residency: null })]), free: Object.freeze([]), hot: Object.freeze([]), cold: Object.freeze([]) });
}

function validateHash16(value: Uint8Array, label: string) {
  if (!(value instanceof Uint8Array) || value.byteLength !== 16) fail(`${label} must contain exactly 16 bytes`);
}

function isZeroHash16(value: Uint8Array) {
  return value.every((byte) => byte === 0);
}

function validateExtractionEquipment(value: RustEntityComponentsR6["equipment"]) {
  canonicalMap(value, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "extraction equipment").forEach(({ key, item }) => {
    keyBytes(key, "equipment slot");
    keyBytes(item.itemKey, "equipment item");
    integer(item.count, 1, 0xffff, "equipment count");
    integer(item.durability, 0, 0xffff_ffff, "equipment durability");
    canonicalMap(item.custom, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "equipment custom").forEach(({ key: customKey, item: bytes }) => {
      keyBytes(customKey, "equipment custom key");
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_COMPONENT_TEXT_BYTES) fail("equipment custom bytes exceed bound");
    });
  });
}

function validateExtractionMount(value: RustEntityComponentsR6["mount"]) {
  if (value.parentMount !== null) validatePackedId(value.parentMount, "parent mount");
  if (value.occupiedSeat !== null) integer(value.occupiedSeat, 0, 0xff, "occupied seat");
  if (value.saddleKey !== null) textBytes(value.saddleKey, MAX_COMPONENT_TEXT_BYTES, "saddle key");
  if (value.seats.length > MAX_MOUNT_SEATS) fail("mount seats exceed bound");
  value.seats.forEach((seat, index) => {
    integer(seat.index, 0, 0xff, "mount seat index");
    if (index > 0 && value.seats[index - 1].index >= seat.index) fail("mount seats are not strictly ordered");
    keyBytes(seat.role, "mount seat role");
    Object.values(seat.offset).forEach((item) => finite(item, "mount seat offset"));
    if (seat.occupant !== null) validatePackedId(seat.occupant, "mount occupant");
    integer(seat.controlWeightMilli, 0, 0xffff, "mount control weight");
  });
  if (value.occupiedSeat !== null && !value.seats.some((seat) => seat.index === value.occupiedSeat)) fail("occupied mount seat does not exist");
}

function validateExtractionRecord(value: RustEntityExtractionRecordR6V3) {
  validatePackedId(value.entityId, "extraction entity id");
  if (value.residency !== "hot" && value.residency !== "cold") fail("extraction residency is invalid");
  if (!ENTITY_CLASSES.includes(value.class)) fail("extraction class is invalid");
  if (!TIERS.includes(value.simulationTier)) fail("extraction tier is invalid");
  unsigned64(value.protection, "extraction protection");
  unsigned64(value.entityRevision, "extraction entity revision");
  for (const [label, text] of [["external entity id", value.externalEntityId], ["specimen id", value.specimenId], ["kind key", value.kindKey], ["model key", value.modelKey]] as const) {
    if (textBytes(text, MAX_COMPONENT_TEXT_BYTES, label).byteLength === 0) fail(`${label} is empty`);
  }
  if (value.variantKey !== null) textBytes(value.variantKey, MAX_COMPONENT_TEXT_BYTES, "variant key");
  if (value.name !== null) textBytes(value.name, MAX_COMPONENT_TEXT_BYTES, "entity name");
  integer(value.modelRevision, 0, 0xffff_ffff, "model revision");
  validateHash16(value.modelHash, "model hash");
  [value.position.x, value.position.y, value.position.z, value.yaw, value.velocity.x, value.velocity.y, value.velocity.z].forEach((item) => finite(item, "extraction transform"));
  if (!Number.isFinite(value.health) || !Number.isFinite(value.maximumHealth) || value.maximumHealth <= 0 || value.health < 0 || value.health > value.maximumHealth) fail("extraction health is invalid");
  unsigned64(value.ageTicks, "extraction age");
  if (!MOVEMENT_MODES.includes(value.movementMode)) fail("extraction movement mode is invalid");
  unsigned64(value.lastDamageTick, "last damage tick");
  keyBytes(value.action.key, "action key");
  integer(value.action.phase, 0, 0xffff, "action phase");
  unsigned64(value.action.startedTick, "action started tick");
  unsigned64(value.action.endsTick, "action end tick");
  if (value.action.target !== null) validatePackedId(value.action.target, "action target");
  validateExtractionEquipment(value.equipment);
  validateExtractionMount(value.mount);
  canonicalMap(value.research, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "extraction research").forEach(({ item }) => integer(item, 0, 0xffff_ffff, "research value"));
}

function writeExtractionEquipment(writer: Writer, value: RustEntityComponentsR6["equipment"]) {
  writeMap(writer, value, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "extraction equipment", (slot) => {
    writer.string(slot.itemKey);
    writer.u16(slot.count);
    writer.u32(slot.durability);
    writeMap(writer, slot.custom, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "equipment custom", (bytes) => writer.blob(bytes, MAX_COMPONENT_TEXT_BYTES));
  });
}

function readExtractionEquipment(reader: Reader): RustEntityComponentsR6["equipment"] {
  return readMap(reader, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "extraction equipment", () => Object.freeze({
    itemKey: reader.string(),
    count: reader.u16(),
    durability: reader.u32(),
    custom: readMap(reader, MAX_COMPONENT_MAP_ENTRIES, MAX_COMPONENT_TEXT_BYTES, "equipment custom", () => reader.blob(MAX_COMPONENT_TEXT_BYTES)),
  }));
}

function writeExtractionMount(writer: Writer, value: RustEntityComponentsR6["mount"]) {
  writer.optId(value.parentMount);
  writer.bool(value.occupiedSeat !== null);
  if (value.occupiedSeat !== null) writer.u8(value.occupiedSeat);
  writer.bool(value.acceptsRiders);
  writer.optString(value.saddleKey, MAX_COMPONENT_TEXT_BYTES);
  writer.u32(value.seats.length);
  for (const seat of value.seats) {
    writer.u8(seat.index);
    writer.string(seat.role);
    writer.vec3(seat.offset);
    writer.optId(seat.occupant);
    writer.u16(seat.controlWeightMilli);
  }
}

function readExtractionMount(reader: Reader): RustEntityComponentsR6["mount"] {
  const parentMount = reader.optId();
  const occupiedSeat = reader.bool() ? reader.u8() : null;
  const acceptsRiders = reader.bool();
  const saddleKey = reader.optString(MAX_COMPONENT_TEXT_BYTES);
  const seats = Object.freeze(Array.from({ length: reader.length(MAX_MOUNT_SEATS, "mount seats") }, () => Object.freeze({
    index: reader.u8(), role: reader.string(), offset: reader.vec3(), occupant: reader.optId(), controlWeightMilli: reader.u16(),
  })));
  return Object.freeze({ parentMount, occupiedSeat, acceptsRiders, saddleKey, seats });
}

export function encodeRustEntityExtractionR6V3(value: RustEntityExtractionR6V3) {
  if (value.schema !== 3 || value.selected !== value.records.length || value.selected > RUST_ENTITY_MAX_EXTRACTION_RECORDS_R6 || value.selected + value.omitted !== value.total) fail("extraction counts are inconsistent");
  unsigned64(value.extractionRevision, "extraction revision");
  unsigned64(value.authorityTick, "authority tick");
  validateHash16(value.contentManifestHash, "content manifest hash");
  const writer = new Writer(RUST_ENTITY_MAX_EXTRACTION_BYTES_R6);
  writer.raw(BWR6_MAGIC); writer.u16(3); writer.u64(value.extractionRevision); writer.u64(value.authorityTick); writer.raw(value.contentManifestHash); writer.bool(value.contentReady); writer.u32(value.total); writer.u32(value.selected); writer.u32(value.omitted);
  let previousHot = BigInt(-1);
  let previousCold = BigInt(-1);
  let coldStarted = false;
  for (const record of value.records) {
    validateExtractionRecord(record);
    if (record.residency === "hot") {
      if (coldStarted || record.entityId <= previousHot) fail("extraction hot records are not canonical");
      previousHot = record.entityId;
    } else {
      coldStarted = true;
      if (record.entityId <= previousCold) fail("extraction cold records are not canonical");
      previousCold = record.entityId;
    }
    writer.u64(record.entityId); writer.u8(record.residency === "hot" ? 0 : 1); writeTag(writer, record.class, ENTITY_CLASSES, "entity class");
    const tier = TIERS.indexOf(record.simulationTier); writer.u16(tier); writer.u64(record.protection); writer.u64(record.entityRevision);
    writer.string(record.externalEntityId); writer.string(record.specimenId); writer.string(record.kindKey); writer.optString(record.variantKey, MAX_COMPONENT_TEXT_BYTES); writer.optString(record.name, MAX_COMPONENT_TEXT_BYTES); writer.string(record.modelKey); writer.u32(record.modelRevision); writer.raw(record.modelHash);
    writer.vec3(record.position); writer.f32(record.yaw); writer.vec3(record.velocity); writer.f32(record.health); writer.f32(record.maximumHealth); writer.bool(record.tamed);
    writer.u64(record.ageTicks); writeTag(writer, record.movementMode, MOVEMENT_MODES, "movement mode"); writer.bool(record.grounded); writer.bool(record.submerged); writer.u64(record.lastDamageTick);
    writer.string(record.action.key); writer.u16(record.action.phase); writer.u64(record.action.startedTick); writer.u64(record.action.endsTick); writer.optId(record.action.target);
    writeExtractionEquipment(writer, record.equipment);
    writeExtractionMount(writer, record.mount);
    writeMap(writer, record.research, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "extraction research", (item) => writer.u32(item));
  }
  const bytes = writer.finish();
  if (bytes.byteLength > RUST_ENTITY_MAX_EXTRACTION_BYTES_R6) fail("extraction payload exceeds 4 MiB");
  return bytes;
}

export function decodeRustEntityExtractionR6V3(value: Uint8Array | ArrayBuffer) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.byteLength > RUST_ENTITY_MAX_EXTRACTION_BYTES_R6) fail("extraction payload exceeds 4 MiB");
  const reader = new Reader(bytes); expectMagic(reader, BWR6_MAGIC); const schema = reader.u16(); if (schema !== 3) fail(`unsupported extraction schema ${schema}`);
  const extractionRevision = reader.u64();
  const authorityTick = reader.u64();
  const contentManifestHash = Uint8Array.from(reader.take(16));
  const contentReady = reader.bool();
  const total = reader.u32(); const selected = reader.u32(); const omitted = reader.u32();
  if (selected > RUST_ENTITY_MAX_EXTRACTION_RECORDS_R6 || selected + omitted !== total) fail("extraction counts are inconsistent");
  const records: RustEntityExtractionRecordR6V3[] = Array.from({ length: selected }, () => {
    const entityId = reader.id(); const residencyTag = reader.u8(); const residency: RustEntityResidencyR6 = residencyTag === 0 ? "hot" : residencyTag === 1 ? "cold" : fail(`invalid extraction residency tag ${residencyTag}`);
    const record = Object.freeze({
      entityId, residency, class: readTag(reader, ENTITY_CLASSES, "entity class"), simulationTier: TIERS[reader.u16()] ?? fail("invalid extraction tier"), protection: reader.u64(), entityRevision: reader.u64(),
      externalEntityId: reader.string(), specimenId: reader.string(), kindKey: reader.string(), variantKey: reader.optString(MAX_COMPONENT_TEXT_BYTES), name: reader.optString(MAX_COMPONENT_TEXT_BYTES), modelKey: reader.string(), modelRevision: reader.u32(), modelHash: Uint8Array.from(reader.take(16)),
      position: reader.vec3(), yaw: reader.f32(), velocity: reader.vec3(), health: reader.f32(), maximumHealth: reader.f32(), tamed: reader.bool(),
      ageTicks: reader.u64(), movementMode: readTag(reader, MOVEMENT_MODES, "movement mode"), grounded: reader.bool(), submerged: reader.bool(), lastDamageTick: reader.u64(),
      action: Object.freeze({ key: reader.string(), phase: reader.u16(), startedTick: reader.u64(), endsTick: reader.u64(), target: reader.optId() }),
      equipment: readExtractionEquipment(reader),
      mount: readExtractionMount(reader),
      research: readMap(reader, MAX_COMPATIBILITY_MAP_ENTRIES, MAX_COMPATIBILITY_STRING_BYTES, "extraction research", () => reader.u32()),
    });
    validateExtractionRecord(record);
    return record;
  });
  reader.finish();
  let previousHot = BigInt(-1); let previousCold = BigInt(-1); let coldStarted = false;
  for (const record of records) {
    if (record.residency === "hot") { if (coldStarted || record.entityId <= previousHot) fail("extraction hot records are not canonical"); previousHot = record.entityId; }
    else { coldStarted = true; if (record.entityId <= previousCold) fail("extraction cold records are not canonical"); previousCold = record.entityId; }
  }
  return Object.freeze({ schema: 3 as const, extractionRevision, authorityTick, contentManifestHash, contentReady, total, selected, omitted, records: Object.freeze(records) });
}

export function rustEntityExtractionPromotionStateR6V3(value: RustEntityExtractionR6V3): RustEntityExtractionPromotionR6V3 {
  const blockers = new Set<RustEntityExtractionPromotionR6V3["blockers"][number]>();
  if (!value.contentReady) blockers.add("content-not-ready");
  validateHash16(value.contentManifestHash, "content manifest hash");
  if (isZeroHash16(value.contentManifestHash)) blockers.add("content-manifest-zero");
  for (const record of value.records) {
    validateHash16(record.modelHash, "model hash");
    if (record.modelRevision === 0) blockers.add("model-revision-zero");
    if (isZeroHash16(record.modelHash)) blockers.add("model-hash-zero");
  }
  const ordered = ["content-not-ready", "content-manifest-zero", "model-revision-zero", "model-hash-zero"] as const;
  const result = ordered.filter((blocker) => blockers.has(blocker));
  return Object.freeze({ ready: result.length === 0, blockers: Object.freeze(result) });
}
