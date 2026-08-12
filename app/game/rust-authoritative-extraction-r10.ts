/**
 * Strict browser decoder for the renderer-independent R10 authority views.
 *
 * The outer Worker envelope remains RuntimeExtractionV1. BWR6 schema 3 is
 * preserved verbatim for entity rendering; BWX0 carries immutable UI/domain
 * rows, BWAU carries bounded effect/audio cues, and BWRX carries diagnostics.
 * No decoder in this file reads Three.js, the DOM, or mutable game objects.
 */

import type { RustIntegratedRuntimeExtractionV1 } from "./rust-integrated-runtime-contract.ts";
import { decodeRustEntityExtractionR6V3 } from "./rust-entity-authority-codec-r6.ts";
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
  const promotionBlockers: string[] = [];
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
