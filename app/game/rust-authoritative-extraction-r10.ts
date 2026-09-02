/**
 * Strict browser decoder for the renderer-independent R10 authority views.
 *
 * The outer Worker envelope remains RuntimeExtractionV1. BWR6 schema 3 is
 * preserved verbatim for entity rendering; BWX0 carries immutable UI/domain
 * rows, BWAU carries bounded effect/audio cues, and BWRX carries diagnostics.
 * No decoder in this file reads Three.js, the DOM, or mutable game objects.
 */

import type {
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract.ts";
import { decodeRustEntityExtractionR6V3 } from "./rust-entity-authority-codec-r6.ts";
import type { RustEntityExtractionR6V3 } from "./rust-entity-authority-contract-r6.ts";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow.ts";

export const RUST_DOMAIN_VIEW_SCHEMA_R10 = 1 as const;
export const RUST_DOMAIN_VIEW_COUNT_R10 = 8;
export const RUST_DOMAIN_VIEW_MAX_RECORDS_R10 = 2_048;
export const RUST_DOMAIN_VIEW_MAX_FIELDS_R10 = 2_048;
export const RUST_DOMAIN_VIEW_MAX_BLOCKERS_R10 = 32;
export const RUST_DOMAIN_VIEW_MAX_PAYLOAD_BYTES_R10 = 384 * 1_024;
export const RUST_DOMAIN_BUNDLE_MAX_BYTES_R10 = 8 * 1_048_576;
export const RUST_AUDIO_MAX_EVENTS_R10 = 256;

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const U64_MAX = BigInt("0xffffffffffffffff");

export type RustDomainIdR10 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type RustDomainStatusR10 = "complete" | "partial" | "absent";
export type RustDomainValueR10 = boolean | bigint | number | string | Uint8Array;
export type RustDomainValueTypeR10 = "bool" | "u64" | "i64" | "f64" | "string" | "hash" | "bytes";

export type RustDomainRowR10 = Readonly<{
  kind: number;
  key: string;
  revision: bigint;
  fields: readonly (readonly [string, RustDomainValueR10])[];
  /** Exact wire tags parallel to `fields`; present on decoded BWX0 rows. */
  fieldTypes?: readonly RustDomainValueTypeR10[];
}>;

export type RustDomainViewR10 = Readonly<{
  domain: RustDomainIdR10;
  schema: 1;
  status: RustDomainStatusR10;
  revision: bigint;
  total: number;
  selected: number;
  omitted: number;
  nextCursor: number;
  blockers: readonly string[];
  payloadHash: Uint8Array;
  rows: readonly RustDomainRowR10[];
}>;

export type RustDomainBundleR10 = Readonly<{
  schema: 1;
  extractionRevision: bigint;
  authorityTick: bigint;
  stateHash: Uint8Array;
  contentManifestHash: Uint8Array;
  contentReady: boolean;
  views: readonly RustDomainViewR10[];
  promotion: Readonly<{ ready: boolean; blockers: readonly string[] }>;
}>;

export type RustAudioCueR10 = Readonly<{
  sequence: bigint;
  tick: bigint;
  entityExternalId: string;
  kind: "jump" | "land" | "fall-damage" | "drown-damage" | "liquid-enter" | "liquid-exit" | "shore-exit";
  amount: number;
}>;

export type RustAudioExtractionR10 = Readonly<{
  schema: 2;
  authorityTick: bigint;
  total: number;
  selected: number;
  omitted: number;
  cues: readonly RustAudioCueR10[];
}>;

export type RustRuntimeDiagnosticsR10 = Readonly<{
  schema: 2;
  authorityTick: bigint;
  revisions: readonly bigint[];
  stateHash: Uint8Array;
  counters: readonly bigint[];
  flags: readonly boolean[];
  dispatcherHash: Uint8Array;
  persistenceHash: Uint8Array;
}>;

export type RustAuthoritativeExtractionR10 = Readonly<{
  extractionRevision: bigint;
  entities: ReturnType<typeof decodeRustEntityExtractionR6V3> | null;
  domains: RustDomainBundleR10 | null;
  audio: RustAudioExtractionR10 | null;
  diagnostics: RustRuntimeDiagnosticsR10 | null;
  platformRequests: Uint8Array;
}>;

export type RustDroppedHotTransformSourceR10 = Readonly<{
  identity: RustIntegratedRuntimeIdentityV1;
  extractionRevision: bigint;
  authorityTick: bigint;
  inventoryDomainRevision: bigint;
  extractionHash: string;
}>;

/**
 * Exact renderer-independent join of one authoritative BWX0 dropped-item row
 * and its same-envelope hot BWR6 entity. Fixed-point transform values are
 * converted only after proving that the browser can represent every integer
 * losslessly; the original semantic row revision remains attached.
 */
export type RustDroppedHotTransformR10 = Readonly<{
  schema: 1;
  dropId: string;
  entityId: bigint;
  entityRevision: bigint;
  rowRevision: bigint;
  custodyContainer: string;
  custodySlot: number;
  boundContainerRevision: bigint;
  itemCode: number;
  count: number;
  durabilityMillionths: number | null;
  metadataHash: Uint8Array;
  position: Readonly<{ x: number; y: number; z: number }>;
  velocity: Readonly<{ x: number; y: number; z: number }>;
  rotationMicroturns: Readonly<{ yaw: number; pitch: number; roll: number }>;
  yawRadians: number;
  createdTick: bigint;
  ageTicks: bigint;
  expiresTick: bigint | null;
  pickupLockActorId: string | null;
}>;

export type RustDroppedHotTransformFrameR10 = Readonly<{
  schema: 1;
  source: RustDroppedHotTransformSourceR10;
  transforms: readonly RustDroppedHotTransformR10[];
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function frozenBytes(value: Uint8Array) {
  // Typed arrays cannot be frozen in every supported browser; copy the bytes
  // and expose no writable backing buffer owned by the Worker transport.
  return Uint8Array.from(value);
}

/** Match Rust `str`/`String` ordering: lexicographic over canonical UTF-8. */
export function compareCanonicalUtf8R10(left: string, right: string) {
  if (left === right) return 0;
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const shared = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < shared; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] < rightBytes[index] ? -1 : 1;
  }
  return leftBytes.byteLength < rightBytes.byteLength ? -1 : 1;
}

class Reader {
  private offset = 0;

  constructor(private readonly source: Uint8Array) {}

  get remaining() { return this.source.byteLength - this.offset; }
  get position() { return this.offset; }

  span(start: number, end: number) {
    invariant(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && end <= this.source.byteLength,
      "R10 extraction span is outside its source");
    return this.source.subarray(start, end);
  }

  take(length: number) {
    invariant(Number.isSafeInteger(length) && length >= 0 && length <= this.remaining, "R10 extraction is truncated");
    const value = this.source.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  u8() { return this.take(1)[0]; }
  u16() { const value = new DataView(this.take(2).buffer, this.source.byteOffset + this.offset - 2, 2); return value.getUint16(0, true); }
  u32() { const value = new DataView(this.take(4).buffer, this.source.byteOffset + this.offset - 4, 4); return value.getUint32(0, true); }
  u64() { const value = new DataView(this.take(8).buffer, this.source.byteOffset + this.offset - 8, 8).getBigUint64(0, true); invariant(value <= U64_MAX, "R10 u64 overflow"); return value; }
  i64() { return new DataView(this.take(8).buffer, this.source.byteOffset + this.offset - 8, 8).getBigInt64(0, true); }
  // Preserve the exact IEEE-754 value, including negative zero. Domain row
  // revisions and native camera hashes attest the encoded f64 bits, so
  // normalizing `-0.0` here would make an otherwise valid authoritative row
  // impossible to hash or serialize exactly in the browser.
  f64() { const value = new DataView(this.take(8).buffer, this.source.byteOffset + this.offset - 8, 8).getFloat64(0, true); invariant(Number.isFinite(value), "R10 extraction contains a non-finite number"); return value; }
  bool() { const value = this.u8(); invariant(value <= 1, "R10 extraction contains an invalid boolean"); return value === 1; }
  string(maximum = 1_048_576) { const length = this.u32(); invariant(length <= maximum, "R10 extraction string exceeds its bound"); const value = decoder.decode(this.take(length)); invariant(!/\p{Cc}/u.test(value), "R10 extraction string contains a control character"); return value; }
  bytes(maximum = RUST_DOMAIN_VIEW_MAX_PAYLOAD_BYTES_R10) { const length = this.u32(); invariant(length <= maximum, "R10 byte field exceeds its bound"); return frozenBytes(this.take(length)); }
  hash() { return frozenBytes(this.take(16)); }
  finish() { invariant(this.remaining === 0, "R10 extraction has trailing bytes"); }
}

function expectMagic(reader: Reader, expected: string) {
  invariant(decoder.decode(reader.take(4)) === expected, `expected ${expected} extraction magic`);
}

function readDomainValue(reader: Reader): readonly [RustDomainValueTypeR10, RustDomainValueR10] {
  const tag = reader.u8();
  if (tag === 0) return ["bool", reader.bool()];
  if (tag === 1) return ["u64", reader.u64()];
  if (tag === 2) return ["i64", reader.i64()];
  if (tag === 3) return ["f64", reader.f64()];
  if (tag === 4) return ["string", reader.string()];
  if (tag === 5) return ["hash", reader.hash()];
  if (tag === 6) return ["bytes", reader.bytes()];
  throw new TypeError(`unknown R10 domain value tag ${tag}`);
}

function decodeDomainRows(payload: Uint8Array, selected: number) {
  const reader = new Reader(payload);
  const rows: RustDomainRowR10[] = [];
  let previous: readonly [number, string] | null = null;
  for (let index = 0; index < selected; index += 1) {
    const kind = reader.u16();
    const key = reader.string();
    invariant(key.length > 0, "R10 domain row key is empty");
    if (previous) invariant(kind > previous[0] || kind === previous[0] && compareCanonicalUtf8R10(key, previous[1]) > 0,
      "R10 domain rows are not canonical and unique");
    previous = [kind, key];
    const revision = reader.u64();
    const fieldCount = reader.u16();
    invariant(fieldCount <= RUST_DOMAIN_VIEW_MAX_FIELDS_R10, "R10 domain row field cap exceeded");
    const revisionHasher = new TypeScriptCanonicalHasher("blockwild.r10.domain-row-revision.v1")
      .writeU16(kind).writeString(key).writeU16(fieldCount);
    const fields: Array<readonly [string, RustDomainValueR10]> = [];
    const fieldTypes: RustDomainValueTypeR10[] = [];
    let previousField: string | null = null;
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      const field = reader.string();
      invariant(field.length > 0 && (previousField === null || compareCanonicalUtf8R10(field, previousField) > 0),
        "R10 row fields are not canonical and unique");
      previousField = field;
      const valueStart = reader.position;
      const [valueType, value] = readDomainValue(reader);
      revisionHasher.writeString(field).writeBytes(reader.span(valueStart, reader.position));
      fields.push(Object.freeze([field, value] as const));
      fieldTypes.push(valueType);
    }
    const revisionBytes = revisionHasher.finish();
    const expectedRevision = new DataView(revisionBytes.buffer, revisionBytes.byteOffset, 8).getBigUint64(0, true);
    invariant(revision === expectedRevision, "R10 domain row revision does not attest its complete payload");
    rows.push(Object.freeze({
      kind,
      key,
      revision,
      fields: Object.freeze(fields),
      fieldTypes: Object.freeze(fieldTypes),
    }));
  }
  reader.finish();
  return Object.freeze(rows);
}

export function decodeRustDomainBundleR10(value: Uint8Array | ArrayBuffer): RustDomainBundleR10 {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  invariant(bytes.byteLength <= RUST_DOMAIN_BUNDLE_MAX_BYTES_R10, "R10 domain bundle exceeds 8 MiB");
  const reader = new Reader(bytes);
  expectMagic(reader, "BWX0");
  invariant(reader.u16() === RUST_DOMAIN_VIEW_SCHEMA_R10, "unsupported R10 domain bundle schema");
  const extractionRevision = reader.u64();
  const authorityTick = reader.u64();
  const stateHash = reader.hash();
  const contentManifestHash = reader.hash();
  const contentReady = reader.bool();
  const domainCount = reader.u16();
  invariant(domainCount === RUST_DOMAIN_VIEW_COUNT_R10, "R10 domain bundle does not contain the canonical domain set");
  const views: RustDomainViewR10[] = [];
  const promotionBlockers: string[] = contentReady ? [] : ["content-not-ready"];
  for (let index = 0; index < domainCount; index += 1) {
    const domain = reader.u8();
    invariant(domain === index + 1, "R10 domain directory is not canonical");
    invariant(reader.u16() === RUST_DOMAIN_VIEW_SCHEMA_R10, "unsupported R10 domain view schema");
    const statusTag = reader.u8();
    const status: RustDomainStatusR10 = statusTag === 0 ? "complete" : statusTag === 1 ? "partial" : statusTag === 2 ? "absent" : (() => { throw new TypeError("invalid R10 domain status"); })();
    const revision = reader.u64();
    const total = reader.u32();
    const selected = reader.u32();
    const omitted = reader.u32();
    const nextCursor = reader.u32();
    invariant(selected <= RUST_DOMAIN_VIEW_MAX_RECORDS_R10 && selected + omitted === total, "R10 domain counts are inconsistent");
    invariant(nextCursor === selected, "R10 domain continuation cursor is inconsistent");
    const blockerCount = reader.u16();
    invariant(blockerCount <= RUST_DOMAIN_VIEW_MAX_BLOCKERS_R10, "R10 blocker count exceeds its bound");
    const blockers: string[] = [];
    for (let blockerIndex = 0; blockerIndex < blockerCount; blockerIndex += 1) {
      const blocker = reader.string(512);
      invariant(blocker.length > 0 && (blockers.length === 0 || compareCanonicalUtf8R10(blocker, blockers.at(-1)!) > 0),
        "R10 blockers are not canonical and unique");
      blockers.push(blocker);
      promotionBlockers.push(`domain-${domain}:${blocker}`);
    }
    invariant((status === "complete") === (blockers.length === 0 && omitted === 0), "R10 complete domain has blockers or omissions");
    invariant(status !== "absent" || blockers.length > 0, "R10 absent domain has no blocker");
    const payloadLength = reader.u32();
    invariant(payloadLength <= RUST_DOMAIN_VIEW_MAX_PAYLOAD_BYTES_R10, "R10 domain payload exceeds its bound");
    const payloadHash = reader.hash();
    const payload = frozenBytes(reader.take(payloadLength));
    const actualHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-view-payload.v1").writeBytes(payload).finish();
    invariant(equalBytes(payloadHash, actualHash), "R10 domain payload hash mismatch");
    views.push(Object.freeze({
      domain: domain as RustDomainIdR10,
      schema: 1,
      status,
      revision,
      total,
      selected,
      omitted,
      nextCursor,
      blockers: Object.freeze(blockers),
      payloadHash,
      rows: decodeDomainRows(payload, selected),
    }));
  }
  reader.finish();
  return Object.freeze({
    schema: 1,
    extractionRevision,
    authorityTick,
    stateHash,
    contentManifestHash,
    contentReady,
    views: Object.freeze(views),
    promotion: Object.freeze({
      ready: promotionBlockers.length === 0,
      blockers: Object.freeze(promotionBlockers.sort(compareCanonicalUtf8R10)),
    }),
  });
}

const AUDIO_KINDS = Object.freeze(["jump", "land", "fall-damage", "drown-damage", "liquid-enter", "liquid-exit", "shore-exit"] as const);

export function decodeRustAudioExtractionR10(value: Uint8Array | ArrayBuffer): RustAudioExtractionR10 {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const reader = new Reader(bytes);
  expectMagic(reader, "BWAU");
  invariant(reader.u16() === 2, "unsupported R10 audio schema");
  const authorityTick = reader.u64();
  const total = reader.u32();
  const selected = reader.u32();
  const omitted = reader.u32();
  invariant(selected <= RUST_AUDIO_MAX_EVENTS_R10 && selected + omitted === total, "R10 audio counts are inconsistent");
  const cues: RustAudioCueR10[] = [];
  let previousSequence = BigInt(0);
  for (let index = 0; index < selected; index += 1) {
    const sequence = reader.u64();
    invariant(sequence > previousSequence, "R10 audio sequences are not strictly increasing");
    previousSequence = sequence;
    const tick = reader.u64();
    const entityExternalId = reader.string(512);
    const kind = AUDIO_KINDS[reader.u8()];
    invariant(kind !== undefined, "R10 audio kind is invalid");
    const amount = reader.f64();
    cues.push(Object.freeze({ sequence, tick, entityExternalId, kind, amount }));
  }
  reader.finish();
  return Object.freeze({ schema: 2, authorityTick, total, selected, omitted, cues: Object.freeze(cues) });
}

export function decodeRustRuntimeDiagnosticsR10(value: Uint8Array | ArrayBuffer): RustRuntimeDiagnosticsR10 {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const reader = new Reader(bytes);
  expectMagic(reader, "BWRX");
  invariant(reader.u16() === 2, "unsupported R10 diagnostics schema");
  const authorityTick = reader.u64();
  const revisions = Object.freeze(Array.from({ length: 7 }, () => reader.u64()));
  const stateHash = reader.hash();
  const counters = Object.freeze(Array.from({ length: 29 }, () => reader.u64()));
  const flags = Object.freeze(Array.from({ length: 5 }, () => reader.bool()));
  const dispatcherHash = reader.hash();
  const persistenceHash = reader.hash();
  reader.finish();
  return Object.freeze({ schema: 2, authorityTick, revisions, stateHash, counters, flags, dispatcherHash, persistenceHash });
}

export function decodeRustAuthoritativeExtractionR10(extraction: RustIntegratedRuntimeExtractionV1): RustAuthoritativeExtractionR10 {
  const entities = extraction.render.byteLength === 0 ? null : decodeRustEntityExtractionR6V3(extraction.render);
  const domains = extraction.hud.byteLength === 0 ? null : decodeRustDomainBundleR10(extraction.hud);
  const audio = extraction.audio.byteLength === 0 ? null : decodeRustAudioExtractionR10(extraction.audio);
  const diagnostics = extraction.diagnostics.byteLength === 0 ? null : decodeRustRuntimeDiagnosticsR10(extraction.diagnostics);
  const revision = BigInt(extraction.extractionRevision);
  for (const value of [entities?.extractionRevision, domains?.extractionRevision]) {
    invariant(value === undefined || value === revision, "R10 inner extraction revision does not match Worker envelope");
  }
  for (const value of [entities?.authorityTick, domains?.authorityTick, audio?.authorityTick, diagnostics?.authorityTick]) {
    invariant(value === undefined || value === BigInt(extraction.identity.tick), "R10 inner authority tick does not match Worker identity");
  }
  if (entities && domains) invariant(equalBytes(entities.contentManifestHash, domains.contentManifestHash), "R10 content attestations disagree");
  return Object.freeze({
    extractionRevision: revision,
    entities,
    domains,
    audio,
    diagnostics,
    platformRequests: frozenBytes(extraction.platformRequests),
  });
}

const DROP_PRESENTATION_ONLY_BLOCKERS_R10 = new Set([
  "dropped-item-presentation-missing",
  "dropped-item-presentation-unmapped",
]);
const CONTAINER_VIEW_KEY_R10 = /^container-key-v1\/(?:[0-9a-f]{2})+$/u;
const CANONICAL_HASH_HEX_R10 = /^[0-9a-f]{32}$/u;
const RUNTIME_REVISION_FIELDS_R10 = Object.freeze([
  "epoch", "world", "entities", "gameplay", "persistence", "network", "simulation",
] as const);
const DROP_BASE_FIELD_TYPES_R10 = Object.freeze({
  boundContainerRevision: "u64",
  createdTick: "u64",
  custodyContainer: "string",
  custodySlot: "u64",
  dropId: "string",
  entityId: "u64",
  entityRevision: "u64",
  "expiresTick.present": "bool",
  "pickupLockActorId.present": "bool",
  "position.xMilli": "i64",
  "position.yMilli": "i64",
  "position.zMilli": "i64",
  "presentation.contentDomain": "string",
  "presentation.contentId": "string",
  "presentation.role": "string",
  "presentation.status": "string",
  "rotation.pitchMicroturns": "u64",
  "rotation.rollMicroturns": "u64",
  "rotation.yawMicroturns": "u64",
  "stack.count": "u64",
  "stack.durability.present": "bool",
  "stack.itemCode": "u64",
  "stack.metadataHash": "hash",
  "velocity.xMilliPerSecond": "i64",
  "velocity.yMilliPerSecond": "i64",
  "velocity.zMilliPerSecond": "i64",
} satisfies Readonly<Record<string, RustDomainValueTypeR10>>);

function droppedHotField(row: RustDomainRowR10, name: string, expectedType: RustDomainValueTypeR10) {
  const index = row.fields.findIndex(([field]) => field === name);
  invariant(index >= 0, `R10 dropped hot transform '${row.key}' has no ${name} field`);
  invariant(row.fieldTypes?.[index] === expectedType,
    `R10 dropped hot transform '${row.key}' ${name} has the wrong wire type`);
  const value = row.fields[index][1];
  const valid = expectedType === "bool" ? typeof value === "boolean"
    : expectedType === "u64" || expectedType === "i64" ? typeof value === "bigint"
      : expectedType === "f64" ? typeof value === "number" && Number.isFinite(value)
        : expectedType === "string" ? typeof value === "string"
          : expectedType === "hash" ? value instanceof Uint8Array && value.byteLength === 16
            : value instanceof Uint8Array;
  invariant(valid, `R10 dropped hot transform '${row.key}' ${name} does not match its wire type`);
  return value;
}

function droppedHotBool(row: RustDomainRowR10, name: string) {
  return droppedHotField(row, name, "bool") as boolean;
}

function droppedHotString(row: RustDomainRowR10, name: string) {
  const value = droppedHotField(row, name, "string") as string;
  invariant(value.length > 0, `R10 dropped hot transform '${row.key}' ${name} is empty`);
  return value;
}

function droppedHotU64(row: RustDomainRowR10, name: string) {
  const value = droppedHotField(row, name, "u64") as bigint;
  invariant(value >= BigInt(0) && value <= U64_MAX,
    `R10 dropped hot transform '${row.key}' ${name} is not u64`);
  return value;
}

function droppedHotU32(row: RustDomainRowR10, name: string, allowZero = true) {
  const value = droppedHotU64(row, name);
  invariant(value >= BigInt(allowZero ? 0 : 1) && value <= BigInt(0xffff_ffff),
    `R10 dropped hot transform '${row.key}' ${name} is not u32`);
  return Number(value);
}

function droppedHotI64(row: RustDomainRowR10, name: string) {
  return droppedHotField(row, name, "i64") as bigint;
}

function droppedHotOptionalU64(row: RustDomainRowR10, name: string) {
  const present = droppedHotBool(row, `${name}.present`);
  const hasValue = row.fields.some(([field]) => field === `${name}.value`);
  invariant(present === hasValue, `R10 dropped hot transform '${row.key}' ${name} optional fields disagree`);
  return present ? droppedHotU64(row, `${name}.value`) : null;
}

function droppedHotOptionalString(row: RustDomainRowR10, name: string) {
  const present = droppedHotBool(row, `${name}.present`);
  const hasValue = row.fields.some(([field]) => field === `${name}.value`);
  invariant(present === hasValue, `R10 dropped hot transform '${row.key}' ${name} optional fields disagree`);
  return present ? droppedHotString(row, `${name}.value`) : null;
}

function droppedHotExactNumber(value: bigint, label: string) {
  const number = Number(value);
  invariant(Number.isSafeInteger(number) && BigInt(number) === value,
    `R10 ${label} is not exactly representable by the browser`);
  return number;
}

function droppedHotVector(
  row: RustDomainRowR10,
  prefix: "position" | "velocity",
) {
  const suffix = prefix === "position" ? "Milli" : "MilliPerSecond";
  return Object.freeze({
    x: droppedHotExactNumber(droppedHotI64(row, `${prefix}.x${suffix}`), `${prefix} x`) / 1_000,
    y: droppedHotExactNumber(droppedHotI64(row, `${prefix}.y${suffix}`), `${prefix} y`) / 1_000,
    z: droppedHotExactNumber(droppedHotI64(row, `${prefix}.z${suffix}`), `${prefix} z`) / 1_000,
  });
}

function droppedHotRecordMilli(value: number, label: string) {
  invariant(Number.isFinite(value), `R10 dropped BWR6 ${label} is non-finite`);
  const scaled = value * 1_000;
  invariant(Number.isSafeInteger(Math.trunc(scaled)), `R10 dropped BWR6 ${label} exceeds the exact browser range`);
  const rounded = Math.trunc(scaled + (scaled < 0 ? -0.5 : 0.5));
  return BigInt(rounded);
}

function droppedHotExpectedYawF32(yawMicroturns: number) {
  return Math.fround(
    Math.fround(Math.fround(yawMicroturns) / Math.fround(1_000_000)) * Math.fround(Math.PI * 2),
  );
}

function validateDroppedHotFieldSet(row: RustDomainRowR10, status: string) {
  const expected = new Map<string, RustDomainValueTypeR10>(Object.entries(DROP_BASE_FIELD_TYPES_R10) as Array<[
    string,
    RustDomainValueTypeR10,
  ]>);
  if (droppedHotBool(row, "expiresTick.present")) expected.set("expiresTick.value", "u64");
  if (droppedHotBool(row, "pickupLockActorId.present")) expected.set("pickupLockActorId.value", "string");
  if (droppedHotBool(row, "stack.durability.present")) expected.set("stack.durability.value", "u64");
  if (status === "exact") {
    expected.set("presentation.contentHash", "hash");
    expected.set("presentation.contentVersion", "u64");
    expected.set("presentation.modelId", "string");
    expected.set("presentation.profileId", "string");
  } else if (status === "missing") {
    expected.set("presentation.blockerId", "string");
  } else {
    invariant(status === "unmapped", `R10 dropped hot transform '${row.key}' presentation status is invalid`);
  }
  const expectedFields = [...expected].sort(([left], [right]) => compareCanonicalUtf8R10(left, right));
  invariant(row.fields.length === expectedFields.length && row.fieldTypes?.length === expectedFields.length,
    `R10 dropped hot transform '${row.key}' does not contain the exact canonical field set`);
  for (let index = 0; index < expectedFields.length; index += 1) {
    invariant(row.fields[index][0] === expectedFields[index][0]
      && row.fieldTypes[index] === expectedFields[index][1],
    `R10 dropped hot transform '${row.key}' does not contain the exact canonical field types`);
  }
}

function cloneDroppedHotIdentity(identity: RustIntegratedRuntimeIdentityV1) {
  invariant(identity.universeId.length > 0 && identity.locationId.length > 0,
    "R10 dropped hot transform source identity is empty");
  invariant(CANONICAL_HASH_HEX_R10.test(identity.stateHash),
    "R10 dropped hot transform source state hash is invalid");
  for (const field of RUNTIME_REVISION_FIELDS_R10) {
    invariant(Number.isSafeInteger(identity.revision[field]) && identity.revision[field] >= 0,
      `R10 dropped hot transform source ${field} revision is invalid`);
  }
  invariant(Number.isSafeInteger(identity.tick) && identity.tick >= 0,
    "R10 dropped hot transform source tick is invalid");
  return Object.freeze({
    ...identity,
    revision: Object.freeze({ ...identity.revision }),
  });
}

function droppedHotHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameDroppedHotIdentity(left: RustIntegratedRuntimeIdentityV1, right: RustIntegratedRuntimeIdentityV1) {
  return left.universeId === right.universeId && left.locationId === right.locationId
    && left.tick === right.tick && left.stateHash === right.stateHash
    && RUNTIME_REVISION_FIELDS_R10.every((field) => left.revision[field] === right.revision[field]);
}

function sameDroppedHotTransform(left: RustDroppedHotTransformR10, right: RustDroppedHotTransformR10) {
  return left.dropId === right.dropId && left.entityId === right.entityId
    && left.entityRevision === right.entityRevision && left.rowRevision === right.rowRevision
    && left.custodyContainer === right.custodyContainer && left.custodySlot === right.custodySlot
    && left.boundContainerRevision === right.boundContainerRevision
    && left.itemCode === right.itemCode && left.count === right.count
    && left.durabilityMillionths === right.durabilityMillionths
    && equalBytes(left.metadataHash, right.metadataHash)
    && left.position.x === right.position.x && left.position.y === right.position.y && left.position.z === right.position.z
    && left.velocity.x === right.velocity.x && left.velocity.y === right.velocity.y && left.velocity.z === right.velocity.z
    && left.rotationMicroturns.yaw === right.rotationMicroturns.yaw
    && left.rotationMicroturns.pitch === right.rotationMicroturns.pitch
    && left.rotationMicroturns.roll === right.rotationMicroturns.roll
    && left.yawRadians === right.yawRadians && left.createdTick === right.createdTick
    && left.ageTicks === right.ageTicks && left.expiresTick === right.expiresTick
    && left.pickupLockActorId === right.pickupLockActorId;
}

function sameDroppedHotKinematics(left: RustDroppedHotTransformR10, right: RustDroppedHotTransformR10) {
  return left.dropId === right.dropId && left.entityId === right.entityId
    && left.entityRevision === right.entityRevision
    && left.position.x === right.position.x && left.position.y === right.position.y && left.position.z === right.position.z
    && left.velocity.x === right.velocity.x && left.velocity.y === right.velocity.y && left.velocity.z === right.velocity.z
    && left.rotationMicroturns.yaw === right.rotationMicroturns.yaw
    && left.rotationMicroturns.pitch === right.rotationMicroturns.pitch
    && left.rotationMicroturns.roll === right.rotationMicroturns.roll
    && left.yawRadians === right.yawRadians && left.createdTick === right.createdTick
    && left.ageTicks === right.ageTicks;
}

function validateDroppedHotMonotonicFrame(
  current: RustDroppedHotTransformFrameR10,
  previous: RustDroppedHotTransformFrameR10,
) {
  invariant(previous.schema === 1 && previous.source.identity.universeId === current.source.identity.universeId
    && previous.source.identity.locationId === current.source.identity.locationId
    && previous.source.identity.revision.epoch === current.source.identity.revision.epoch,
  "R10 dropped hot transform frame belongs to a different runtime source");
  invariant(current.source.extractionRevision >= previous.source.extractionRevision
    && current.source.authorityTick >= previous.source.authorityTick
    && current.source.inventoryDomainRevision >= previous.source.inventoryDomainRevision,
  "R10 dropped hot transform frame regressed its monotonic source revision");
  for (const field of RUNTIME_REVISION_FIELDS_R10) {
    invariant(current.source.identity.revision[field] >= previous.source.identity.revision[field],
      `R10 dropped hot transform frame regressed its ${field} authority revision`);
  }
  if (current.source.extractionRevision === previous.source.extractionRevision) {
    invariant(current.source.extractionHash === previous.source.extractionHash
      && current.source.inventoryDomainRevision === previous.source.inventoryDomainRevision
      && sameDroppedHotIdentity(current.source.identity, previous.source.identity)
      && current.transforms.length === previous.transforms.length
      && current.transforms.every((transform, index) => sameDroppedHotTransform(transform, previous.transforms[index])),
    "R10 dropped hot transform extraction revision was reused for different state");
  }
  const previousByDrop = new Map(previous.transforms.map((transform) => [transform.dropId, transform] as const));
  const previousByEntity = new Map(previous.transforms.map((transform) => [transform.entityId, transform] as const));
  for (const transform of current.transforms) {
    const priorDrop = previousByDrop.get(transform.dropId);
    const priorEntity = previousByEntity.get(transform.entityId);
    invariant(priorDrop === undefined || priorDrop.entityId === transform.entityId,
      `R10 dropped hot transform '${transform.dropId}' changed its native entity identity`);
    invariant(priorEntity === undefined || priorEntity.dropId === transform.dropId,
      `R10 dropped hot transform entity ${transform.entityId} changed its drop identity`);
    if (priorDrop === undefined) {
      invariant(transform.createdTick >= previous.source.authorityTick,
        `R10 dropped hot transform '${transform.dropId}' appeared with a stale creation tick`);
      continue;
    }
    invariant(transform.entityRevision >= priorDrop.entityRevision && transform.ageTicks >= priorDrop.ageTicks,
      `R10 dropped hot transform '${transform.dropId}' regressed its native entity revision or age`);
    invariant(transform.createdTick === priorDrop.createdTick,
      `R10 dropped hot transform '${transform.dropId}' changed its creation tick`);
    invariant(transform.custodyContainer === priorDrop.custodyContainer
      && transform.custodySlot === priorDrop.custodySlot
      && transform.boundContainerRevision >= priorDrop.boundContainerRevision
      && transform.itemCode === priorDrop.itemCode
      && transform.count <= priorDrop.count
      && transform.durabilityMillionths === priorDrop.durabilityMillionths
      && equalBytes(transform.metadataHash, priorDrop.metadataHash)
      && transform.expiresTick === priorDrop.expiresTick
      && transform.pickupLockActorId === priorDrop.pickupLockActorId,
    `R10 dropped hot transform '${transform.dropId}' changed its fixed custody identity`);
    if (transform.entityRevision === priorDrop.entityRevision) {
      invariant(sameDroppedHotKinematics(transform, priorDrop),
        `R10 dropped hot transform '${transform.dropId}' changed without an entity revision advance`);
    }
  }
}

/**
 * Plans the complete current native dropped-item mirror without consulting a
 * presentation profile or renderer. Passing the last accepted frame makes the
 * otherwise-pure join reject source swaps, revision reuse, and stale entities.
 */
export function planRustDroppedHotTransformsR10(
  extraction: RustIntegratedRuntimeExtractionV1,
  previous: RustDroppedHotTransformFrameR10 | null = null,
): RustDroppedHotTransformFrameR10 {
  invariant(Number.isSafeInteger(extraction.extractionRevision) && extraction.extractionRevision >= 0,
    "R10 dropped hot transform extraction revision is invalid");
  invariant(CANONICAL_HASH_HEX_R10.test(extraction.extractionHash),
    "R10 dropped hot transform extraction hash is invalid");
  const decoded = decodeRustAuthoritativeExtractionR10(extraction);
  invariant(decoded.entities !== null && decoded.domains !== null,
    "R10 dropped hot transforms require same-envelope BWR6 and BWX0 extraction");
  invariant(droppedHotHex(decoded.domains.stateHash) === extraction.identity.stateHash,
    "R10 dropped hot transform BWX0 state hash differs from its Worker source identity");
  invariant(decoded.entities.contentReady && decoded.domains.contentReady,
    "R10 dropped hot transforms require installed authoritative content");
  invariant(decoded.entities.omitted === 0,
    "R10 dropped hot transforms cannot join an omitted BWR6 extraction");
  const inventory = decoded.domains.views.find((view) => view.domain === 3);
  invariant(inventory !== undefined && inventory.status !== "absent" && inventory.omitted === 0
    && inventory.blockers.every((blocker) => DROP_PRESENTATION_ONLY_BLOCKERS_R10.has(blocker)),
  "R10 dropped hot transform inventory view is unavailable or truncated");

  const recordsByEntity = new Map<bigint, RustEntityExtractionR6V3["records"][number]>();
  for (const record of decoded.entities.records) {
    invariant(!recordsByEntity.has(record.entityId), "R10 dropped hot transform BWR6 entity id is duplicated");
    recordsByEntity.set(record.entityId, record);
  }
  const joinedEntities = new Set<bigint>();
  const joinedDropIds = new Set<string>();
  const transforms: RustDroppedHotTransformR10[] = [];
  for (const row of inventory.rows.filter((candidate) => candidate.kind === 6)) {
    const status = droppedHotString(row, "presentation.status");
    validateDroppedHotFieldSet(row, status);
    const dropId = droppedHotString(row, "dropId");
    invariant(dropId.length <= 160 && row.key === `drop:${dropId}` && !joinedDropIds.has(dropId),
      `R10 dropped hot transform '${row.key}' has a duplicate or mismatched drop identity`);
    joinedDropIds.add(dropId);
    const entityId = droppedHotU64(row, "entityId");
    invariant(entityId > BigInt(0) && !joinedEntities.has(entityId),
      `R10 dropped hot transform '${dropId}' has a duplicate or empty entity identity`);
    joinedEntities.add(entityId);
    const record = recordsByEntity.get(entityId);
    invariant(record !== undefined, `R10 dropped hot transform '${dropId}' has no same-envelope BWR6 entity`);
    invariant(record.residency === "hot" && record.class === "construct" && record.kindKey === "dropped-item"
      && record.externalEntityId === dropId && record.specimenId === dropId,
    `R10 dropped hot transform '${dropId}' references a mismatched BWR6 entity`);
    const entityRevision = droppedHotU64(row, "entityRevision");
    invariant(entityRevision === record.entityRevision,
      `R10 dropped hot transform '${dropId}' entity revision differs from BWR6`);

    const positionMilli = Object.freeze({
      x: droppedHotI64(row, "position.xMilli"),
      y: droppedHotI64(row, "position.yMilli"),
      z: droppedHotI64(row, "position.zMilli"),
    });
    const velocityMilli = Object.freeze({
      x: droppedHotI64(row, "velocity.xMilliPerSecond"),
      y: droppedHotI64(row, "velocity.yMilliPerSecond"),
      z: droppedHotI64(row, "velocity.zMilliPerSecond"),
    });
    invariant(droppedHotRecordMilli(record.position.x, "position x") === positionMilli.x
      && droppedHotRecordMilli(record.position.y, "position y") === positionMilli.y
      && droppedHotRecordMilli(record.position.z, "position z") === positionMilli.z,
    `R10 dropped hot transform '${dropId}' position differs from BWR6`);
    invariant(droppedHotRecordMilli(record.velocity.x, "velocity x") === velocityMilli.x
      && droppedHotRecordMilli(record.velocity.y, "velocity y") === velocityMilli.y
      && droppedHotRecordMilli(record.velocity.z, "velocity z") === velocityMilli.z,
    `R10 dropped hot transform '${dropId}' velocity differs from BWR6`);
    const rotationMicroturns = Object.freeze({
      yaw: droppedHotU32(row, "rotation.yawMicroturns"),
      pitch: droppedHotU32(row, "rotation.pitchMicroturns"),
      roll: droppedHotU32(row, "rotation.rollMicroturns"),
    });
    invariant(rotationMicroturns.yaw < 1_000_000 && rotationMicroturns.pitch < 1_000_000
      && rotationMicroturns.roll < 1_000_000,
    `R10 dropped hot transform '${dropId}' rotation is not canonical`);
    invariant(Math.abs(record.yaw - droppedHotExpectedYawF32(rotationMicroturns.yaw)) <= 1e-5,
      `R10 dropped hot transform '${dropId}' yaw differs from BWR6`);

    const itemCode = droppedHotU32(row, "stack.itemCode");
    const count = droppedHotU32(row, "stack.count", false);
    const durability = droppedHotOptionalU64(row, "stack.durability");
    invariant(durability === null || durability <= BigInt(1_000_000),
      `R10 dropped hot transform '${dropId}' durability is outside millionths`);
    invariant(droppedHotString(row, "presentation.role") === "dropped-item"
      && droppedHotString(row, "presentation.contentDomain") === "item"
      && droppedHotString(row, "presentation.contentId") === String(itemCode),
    `R10 dropped hot transform '${dropId}' presentation reference differs from custody`);
    if (status === "exact") {
      const modelId = droppedHotString(row, "presentation.modelId");
      const contentVersion = droppedHotU32(row, "presentation.contentVersion", false);
      const contentHash = droppedHotField(row, "presentation.contentHash", "hash") as Uint8Array;
      droppedHotString(row, "presentation.profileId");
      invariant(record.modelKey === modelId && record.modelRevision === contentVersion
        && equalBytes(record.modelHash, contentHash),
      `R10 dropped hot transform '${dropId}' exact model identity differs from BWR6`);
    } else {
      if (status === "missing") droppedHotString(row, "presentation.blockerId");
      invariant(record.modelKey === "unresolved:dropped-item" && record.modelRevision === 0
        && record.modelHash.every((value) => value === 0),
      `R10 dropped hot transform '${dropId}' fabricated an unresolved BWR6 model identity`);
    }
    const custodyContainer = droppedHotString(row, "custodyContainer");
    invariant(CONTAINER_VIEW_KEY_R10.test(custodyContainer),
      `R10 dropped hot transform '${dropId}' custody container key is invalid`);
    const createdTick = droppedHotU64(row, "createdTick");
    invariant(createdTick <= decoded.domains.authorityTick,
      `R10 dropped hot transform '${dropId}' creation tick is in the future`);
    const expiresTick = droppedHotOptionalU64(row, "expiresTick");
    invariant(expiresTick === null || expiresTick >= createdTick,
      `R10 dropped hot transform '${dropId}' expires before creation`);
    transforms.push(Object.freeze({
      schema: 1,
      dropId,
      entityId,
      entityRevision,
      rowRevision: row.revision,
      custodyContainer,
      custodySlot: (() => {
        const value = droppedHotU32(row, "custodySlot");
        invariant(value <= 0xffff, `R10 dropped hot transform '${dropId}' custody slot is not u16`);
        return value;
      })(),
      boundContainerRevision: droppedHotU64(row, "boundContainerRevision"),
      itemCode,
      count,
      durabilityMillionths: durability === null ? null : Number(durability),
      metadataHash: Uint8Array.from(droppedHotField(row, "stack.metadataHash", "hash") as Uint8Array),
      position: droppedHotVector(row, "position"),
      velocity: droppedHotVector(row, "velocity"),
      rotationMicroturns,
      yawRadians: rotationMicroturns.yaw / 1_000_000 * Math.PI * 2,
      createdTick,
      ageTicks: record.ageTicks,
      expiresTick,
      pickupLockActorId: droppedHotOptionalString(row, "pickupLockActorId"),
    }));
  }
  for (const record of decoded.entities.records) {
    if (record.kindKey === "dropped-item" || record.class === "construct" && record.modelKey === "unresolved:dropped-item") {
      invariant(joinedEntities.has(record.entityId),
        `R10 dropped hot BWR6 entity ${record.entityId} has no same-envelope BWX0 row`);
    }
  }
  transforms.sort((left, right) => compareCanonicalUtf8R10(left.dropId, right.dropId));
  const source: RustDroppedHotTransformSourceR10 = Object.freeze({
    identity: cloneDroppedHotIdentity(extraction.identity),
    extractionRevision: decoded.extractionRevision,
    authorityTick: decoded.domains.authorityTick,
    inventoryDomainRevision: inventory.revision,
    extractionHash: extraction.extractionHash,
  });
  const frame: RustDroppedHotTransformFrameR10 = Object.freeze({
    schema: 1,
    source,
    transforms: Object.freeze(transforms),
  });
  if (previous !== null) validateDroppedHotMonotonicFrame(frame, previous);
  return frame;
}
