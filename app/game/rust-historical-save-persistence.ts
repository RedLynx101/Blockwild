import {
  PERSISTENCE_MAX_RECORD_BYTES_V1,
  PERSISTENCE_RECORD_KIND_ORDER_V1,
  persistencePayloadHashV1,
  persistenceRecordKeyV1,
  type PersistenceRecordAddressV1,
  type PersistenceRecordDescriptorV1,
} from "./persistence-journal-contract";
import { RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1 } from "./rust-persistence-runtime-contract";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import type { RustHistoricalSaveCompatibilityPlanV1 } from "./rust-historical-save-compatibility";
import { deriveWorldGenerationIdentityV1 } from "./world-save-normalization";
import {
  assertWorldImportSourceReferenceV1,
  type WorldImportSourceReferenceV1,
} from "./world-import-source";
import type { StoredWorld } from "./world-storage";

/**
 * Durable external custody for historical rich saves.
 *
 * Rust attests the bytes and their CAS lineage but never interprets the rich
 * StoredWorld document. Native authority remains limited to the exact R4 BWAS
 * projection admitted by the compatibility plan.
 */
export const RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2 = 2 as const;
export const RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_RECORD_ID_V2 = "historical-external-descriptor-v2" as const;
export const RUST_HISTORICAL_EXTERNAL_DOCUMENT_RECORD_PREFIX_V2 = "historical-external-document-v2-" as const;
export const RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_MAGIC_V2 = "BWHE" as const;
export const RUST_HISTORICAL_EXTERNAL_PROPOSAL_MAGIC_V2 = "BWHP" as const;
export const RUST_HISTORICAL_STORED_WORLD_FORMAT_V2 = "blockwild-stored-world-canonical-json-v2" as const;
export const RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2 = RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1;
export const RUST_HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2 = 64 * 1024 * 1024;
export const RUST_HISTORICAL_EXTERNAL_MAX_NATIVE_RECORDS_V2 = 4_096;

/**
 * The only records fingerprinted as native authority. The descriptor itself,
 * its opaque external chunks, compatibility chunks, and save manifest are
 * deliberately excluded so descriptor construction has no circular input.
 */
export const RUST_HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2 = Object.freeze([
  Object.freeze({ kind: "actor-digest" as const, recordId: "rust-gameplay-r7-v1" as const }),
  Object.freeze({ kind: "chunk-edits" as const, recordId: "rust-world-r4-v1" as const }),
  Object.freeze({ kind: "entity" as const, recordId: "rust-entity-r6-v2" as const }),
  Object.freeze({ kind: "map-knowledge" as const, recordId: "rust-world-view-r7-v1" as const }),
  Object.freeze({ kind: "player" as const, recordId: "rust-runtime-core-v2" as const }),
  Object.freeze({ kind: "settings-reference" as const, recordId: "rust-content-registry-v1" as const }),
]);

export const RUST_HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2 =
  "rust-terrain-generation-plus-typescript-historical-save-compatibility-only" as const;
export const RUST_HISTORICAL_EXTERNAL_PROFILE_V2 = "typescript-historical-save-compatibility-v1" as const;
export const RUST_HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2 = "world-r4-projection-only" as const;

const HASH_128 = /^[0-9a-f]{32}$/u;
const SHA_256 = /^[0-9a-f]{64}$/u;
const CATALOG_WORLD_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
const MAX_JSON_DEPTH = 128;
const MAX_JSON_NODES = 250_000;
const MAX_SAFE_U64 = Number.MAX_SAFE_INTEGER;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const byteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const resizableBufferGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const setBytes = Uint8Array.prototype.set;

export type RustHistoricalDocumentIdentityV2 = Readonly<{
  hash: string;
  sha256: string;
  byteLength: number;
}>;

export type RustHistoricalDocumentRevisionIdentityV2 = RustHistoricalDocumentIdentityV2 & Readonly<{
  revision: number;
}>;

export type RustHistoricalExternalDocumentChunkV2 = Readonly<{
  index: number;
  byteOffset: number;
  byteLength: number;
  payloadHash: string;
  bytes: Uint8Array;
}>;

export type RustHistoricalExternalDocumentChunkFingerprintV2 = Omit<RustHistoricalExternalDocumentChunkV2, "bytes">;

export type RustHistoricalStoredWorldPreviousV2 = Readonly<{
  source: WorldImportSourceReferenceV1;
  initialDocument: RustHistoricalDocumentIdentityV2;
  currentDocument: RustHistoricalDocumentRevisionIdentityV2;
}>;

export type RustHistoricalStoredWorldEnvelopeV2 = RustHistoricalStoredWorldPreviousV2 & Readonly<{
  schemaVersion: typeof RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2;
  format: typeof RUST_HISTORICAL_STORED_WORLD_FORMAT_V2;
  expectedPreviousDocument: RustHistoricalDocumentRevisionIdentityV2 | null;
  chunks: readonly RustHistoricalExternalDocumentChunkV2[];
  chunkSetHash: string;
}>;

export type RustHistoricalExternalAuthorityV2 = Readonly<{
  claim: typeof RUST_HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2;
  nativePlayer: "off";
  nativeRichState: "not-adopted";
}>;

export type RustHistoricalExternalTargetV2 = Readonly<{
  catalogWorldId: string;
  universeId: string;
  locationId: string;
  worldSeed: string;
  contentHash: string;
  generationIdentity: Readonly<{
    schemaVersion: 1;
    generatorHash: string;
    terrainContentHash: string;
    generationOptionsJson: string;
    generationOptionsHash: string;
    generationOptionsByteLength: number;
  }>;
  optionsSemanticHash: string;
  optionsByteLength: number;
}>;

export type RustHistoricalExternalBwasV2 = Readonly<{
  projectionHash: string;
  projectionByteLength: number;
  compatibilityChecksum: string;
  extensionChecksum: string;
  editCount: number;
  facingCount: number;
}>;

export type RustHistoricalExternalImmutableV2 = Readonly<{
  authority: RustHistoricalExternalAuthorityV2;
  profile: typeof RUST_HISTORICAL_EXTERNAL_PROFILE_V2;
  nativeExecutionScope: typeof RUST_HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2;
  source: Readonly<WorldImportSourceReferenceV1 & { generatorVersion: 16 | 17 }>;
  initialDocument: RustHistoricalDocumentIdentityV2;
  planHash: string;
  custodyRoot: string;
  externalStateFlags: number;
  target: RustHistoricalExternalTargetV2;
  bwas: RustHistoricalExternalBwasV2;
}>;

export type RustHistoricalExternalMutableV2 = Readonly<{
  currentDocument: RustHistoricalDocumentRevisionIdentityV2;
  expectedPreviousDocument: RustHistoricalDocumentRevisionIdentityV2 | null;
  chunks: readonly RustHistoricalExternalDocumentChunkFingerprintV2[];
  chunkSetHash: string;
  nativeRecords: readonly PersistenceRecordDescriptorV1[];
  nativeRecordSetHash: string;
}>;

export type RustHistoricalExternalDescriptorV2 = Readonly<{
  schemaVersion: typeof RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2;
  immutable: RustHistoricalExternalImmutableV2;
  mutable: RustHistoricalExternalMutableV2;
  descriptorHash: string;
}>;

export type RustHistoricalExternalDescriptorProposalV2 = Readonly<{
  schemaVersion: typeof RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2;
  immutable: RustHistoricalExternalImmutableV2;
  external: Readonly<{
    currentDocument: RustHistoricalDocumentRevisionIdentityV2;
    expectedPreviousDocument: RustHistoricalDocumentRevisionIdentityV2 | null;
    chunks: readonly RustHistoricalExternalDocumentChunkFingerprintV2[];
    chunkSetHash: string;
  }>;
  proposalHash: string;
}>;

export class RustHistoricalSavePersistenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RustHistoricalSavePersistenceError";
  }
}

function fail(code: string, message: string): never {
  throw new RustHistoricalSavePersistenceError(code, message);
}

function compareOrdinal(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function exactInteger(value: unknown, label: string, minimum = 0, maximum = MAX_SAFE_U64) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("integer", `${label} must be an exact integer in ${minimum}..${maximum}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function hash128(value: unknown, label: string) {
  if (typeof value !== "string" || !HASH_128.test(value)) fail("hash", `${label} must be a lowercase 128-bit hash`);
  return value;
}

function sha256(value: unknown, label: string) {
  if (typeof value !== "string" || !SHA_256.test(value)) fail("sha256", `${label} must be a lowercase SHA-256 hash`);
  return value;
}

function visible(value: unknown, label: string, maximumUtf16: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumUtf16) {
    fail("identity", `${label} must contain 1..${maximumUtf16} UTF-16 code units`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x1f || unit === 0x7f) fail("identity", `${label} contains a control character`);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail("identity", `${label} contains an unpaired surrogate`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("identity", `${label} contains an unpaired surrogate`);
    }
  }
  return value;
}

function ordinaryRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail("shape", `${label} must be an ordinary record`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor)) {
      fail("shape", `${label} must contain only enumerable string data fields`);
    }
  }
  return value as Record<string, unknown>;
}

function exactRecord(value: unknown, keys: readonly string[], label: string) {
  const result = ordinaryRecord(value, label);
  const actual = Object.keys(result).sort(compareOrdinal);
  const expected = [...keys].sort(compareOrdinal);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("shape", `${label} has missing or unsupported fields`);
  }
  return result;
}

function defineData(output: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(output, key, { configurable: false, enumerable: true, value, writable: false });
}

/** Own and freeze strict JSON without executing accessors or losing __proto__. */
function snapshotStrictJson(input: unknown): unknown {
  let nodes = 0;
  const ancestors = new Set<object>();
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) fail("json-bound", "StoredWorld JSON exceeds its node/depth bound");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      // Visible identities receive tighter rules; general JSON still rejects
      // lone surrogates so UTF-8 canonicalization has one meaning.
      for (let index = 0; index < value.length; index += 1) {
        const unit = value.charCodeAt(index);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = value.charCodeAt(index + 1);
          if (next < 0xdc00 || next > 0xdfff) fail("json-string", "StoredWorld JSON contains an unpaired surrogate");
          index += 1;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) fail("json-string", "StoredWorld JSON contains an unpaired surrogate");
      }
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("json-number", "StoredWorld JSON numbers must be finite");
      return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value !== "object") fail("json-shape", "StoredWorld custody accepts strict JSON data only");
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== (isArray ? Array.prototype : Object.prototype) && !(prototype === null && !isArray)) {
      fail("json-shape", "StoredWorld JSON containers must have ordinary prototypes");
    }
    if (ancestors.has(value)) fail("json-cycle", "StoredWorld JSON must not contain cycles");
    ancestors.add(value);
    if (isArray) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const ownKeys = Reflect.ownKeys(descriptors).filter(key => key !== "length");
      if (ownKeys.length !== value.length) fail("json-array", "StoredWorld arrays must be dense data arrays");
      const output = new Array<unknown>(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) fail("json-array", "StoredWorld arrays must contain data entries only");
        output[index] = copy(descriptor.value, depth + 1);
      }
      ancestors.delete(value);
      return Object.freeze(output);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) fail("json-key", "StoredWorld JSON keys must be strings");
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of (keys as string[]).sort(compareOrdinal)) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) fail("json-field", "StoredWorld records must contain enumerable data fields only");
      defineData(output, key, copy(descriptor.value, depth + 1));
    }
    ancestors.delete(value);
    return Object.freeze(output);
  }
  return copy(input, 0);
}

function canonicalJsonBytes(value: unknown) {
  return textEncoder.encode(JSON.stringify(snapshotStrictJson(value)));
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function equalJson(left: unknown, right: unknown) {
  return equalBytes(canonicalJsonBytes(left), canonicalJsonBytes(right));
}

function copyBytes(value: unknown, label: string, maximum = RUST_HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2) {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
    fail("bytes", `${label} must be a non-empty Uint8Array within its byte bound`);
  }
  let buffer: ArrayBuffer;
  let byteOffset: number;
  let byteLength: number;
  try {
    buffer = byteBufferGetter.call(value) as ArrayBuffer;
    byteOffset = byteOffsetGetter.call(value) as number;
    byteLength = byteLengthGetter.call(value) as number;
  } catch {
    return fail("bytes", `${label} must be an ordinary Uint8Array`);
  }
  if (byteLength < 1 || byteLength > maximum || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype
    || resizableBufferGetter?.call(buffer)) {
    fail("bytes", `${label} must use a fixed ordinary ArrayBuffer within its byte bound`);
  }
  const output = new Uint8Array(byteLength);
  setBytes.call(output, new Uint8Array(buffer, byteOffset, byteLength));
  return output;
}

async function digestSha256(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) fail("crypto", "Historical external custody requires Web Crypto SHA-256");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** JSON.parse validates syntax; this pass rejects last-property-wins ambiguity. */
function assertUniqueJsonKeys(json: string) {
  const stack: Array<{ keys: Set<string> | null; expectKey: boolean }> = [];
  const tokens = /"(?:\\.|[^"\\])*"|\{|\}|\[|\]|,|:/gu;
  for (const match of json.matchAll(tokens)) {
    const token = match[0];
    if (token === "{" || token === "[") stack.push({ keys: token === "{" ? new Set() : null, expectKey: true });
    else if (token === "}" || token === "]") stack.pop();
    else {
      const context = stack.at(-1);
      if (!context?.keys) continue;
      if (token === ",") context.expectKey = true;
      else if (token.startsWith('"') && context.expectKey) {
        const key = JSON.parse(token) as string;
        if (context.keys.has(key)) fail("duplicate-json-key", "StoredWorld JSON contains a duplicate property name");
        context.keys.add(key);
        context.expectKey = false;
      }
    }
  }
}

function normalizeSource(value: unknown): WorldImportSourceReferenceV1 {
  const source = snapshotStrictJson(value);
  try { assertWorldImportSourceReferenceV1(source); }
  catch (error) { fail("import-source", error instanceof Error ? error.message : "Historical import source is invalid"); }
  return Object.freeze({ ...source });
}

function normalizeDocumentIdentity(value: unknown, label: string): RustHistoricalDocumentIdentityV2 {
  const identity = exactRecord(value, ["byteLength", "hash", "sha256"], label);
  return Object.freeze({
    hash: hash128(identity.hash, `${label}.hash`),
    sha256: sha256(identity.sha256, `${label}.sha256`),
    byteLength: exactInteger(identity.byteLength, `${label}.byteLength`, 1, RUST_HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2),
  });
}

function normalizeDocumentRevisionIdentity(value: unknown, label: string): RustHistoricalDocumentRevisionIdentityV2 {
  const identity = exactRecord(value, ["byteLength", "hash", "revision", "sha256"], label);
  return Object.freeze({
    hash: hash128(identity.hash, `${label}.hash`),
    sha256: sha256(identity.sha256, `${label}.sha256`),
    byteLength: exactInteger(identity.byteLength, `${label}.byteLength`, 1, RUST_HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2),
    revision: exactInteger(identity.revision, `${label}.revision`, 1),
  });
}

function validateHistoricalStoredWorldRoot(value: unknown, source: WorldImportSourceReferenceV1) {
  const document = exactRecord(value, ["importSource", "metadata", "options", "save", "version"], "historical StoredWorld");
  if (document.version !== 1) fail("document-version", "Historical external custody requires StoredWorld version one");
  const metadata = ordinaryRecord(document.metadata, "historical StoredWorld.metadata");
  ordinaryRecord(document.options, "historical StoredWorld.options");
  ordinaryRecord(document.save, "historical StoredWorld.save");
  visible(metadata.id, "historical StoredWorld.metadata.id", 48);
  visible(metadata.seed, "historical StoredWorld.metadata.seed", 160);
  const embeddedSource = normalizeSource(document.importSource);
  if (!equalJson(embeddedSource, source)) fail("import-source", "StoredWorld importSource differs from its immutable archive binding");
  return document as unknown as StoredWorld;
}

export function rustHistoricalExternalDescriptorAddressV2(universeId: string, locationId: string): PersistenceRecordAddressV1 {
  return Object.freeze({
    universeId: visible(universeId, "descriptor universeId", 64),
    locationId: visible(locationId, "descriptor locationId", 128),
    kind: "actor-digest",
    recordId: RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_RECORD_ID_V2,
  });
}

export function rustHistoricalExternalDocumentChunkRecordIdV2(index: number) {
  const normalized = exactInteger(index, "external document chunk index", 0, 0xffff_ffff);
  return `${RUST_HISTORICAL_EXTERNAL_DOCUMENT_RECORD_PREFIX_V2}${normalized.toString(16).padStart(8, "0")}`;
}

export function rustHistoricalExternalDocumentChunkAddressV2(
  universeId: string,
  locationId: string,
  index: number,
): PersistenceRecordAddressV1 {
  return Object.freeze({
    universeId: visible(universeId, "external document universeId", 64),
    locationId: visible(locationId, "external document locationId", 128),
    kind: "settings-reference",
    recordId: rustHistoricalExternalDocumentChunkRecordIdV2(index),
  });
}

export function rustHistoricalExternalChunkSetHashV2(
  document: RustHistoricalDocumentRevisionIdentityV2,
  expectedPrevious: RustHistoricalDocumentRevisionIdentityV2 | null,
  chunks: readonly RustHistoricalExternalDocumentChunkFingerprintV2[],
) {
  const hasher = new TypeScriptCanonicalHasher("blockwild-historical-external-chunk-set-v2");
  hasher.writeString(document.hash).writeString(document.sha256).writeU64(document.byteLength).writeU64(document.revision);
  hasher.writeU16(expectedPrevious === null ? 0 : 1);
  if (expectedPrevious) {
    hasher.writeString(expectedPrevious.hash).writeString(expectedPrevious.sha256)
      .writeU64(expectedPrevious.byteLength).writeU64(expectedPrevious.revision);
  }
  hasher.writeU32(chunks.length);
  for (const chunk of chunks) {
    hasher.writeU32(chunk.index).writeU64(chunk.byteOffset).writeU32(chunk.byteLength).writeString(chunk.payloadHash);
  }
  return hasher.finishHex();
}

export async function decodeRustHistoricalStoredWorldCanonicalBytesV2(
  input: Uint8Array,
  sourceInput: WorldImportSourceReferenceV1,
): Promise<StoredWorld> {
  const bytes = copyBytes(input, "canonical StoredWorld bytes");
  const source = normalizeSource(sourceInput);
  let json: string;
  let parsed: unknown;
  try {
    json = textDecoder.decode(bytes);
    parsed = JSON.parse(json);
  } catch {
    fail("document-json", "Historical StoredWorld bytes must be valid UTF-8 JSON");
  }
  assertUniqueJsonKeys(json);
  const snapshot = snapshotStrictJson(parsed);
  if (!equalBytes(canonicalJsonBytes(snapshot), bytes)) fail("document-canonical", "Historical StoredWorld bytes are not canonical JSON");
  return validateHistoricalStoredWorldRoot(snapshot, source);
}

export async function createRustHistoricalStoredWorldEnvelopeV2(input: Readonly<{
  document: StoredWorld;
  source: WorldImportSourceReferenceV1;
  previous: RustHistoricalStoredWorldPreviousV2 | null;
}>): Promise<RustHistoricalStoredWorldEnvelopeV2> {
  const source = normalizeSource(input.source);
  const snapshot = snapshotStrictJson(input.document);
  validateHistoricalStoredWorldRoot(snapshot, source);
  const bytes = canonicalJsonBytes(snapshot);
  if (bytes.byteLength < 1 || bytes.byteLength > RUST_HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2) {
    fail("document-size", "Canonical StoredWorld exceeds the historical external-custody byte bound");
  }
  const identity: RustHistoricalDocumentIdentityV2 = Object.freeze({
    hash: persistencePayloadHashV1(bytes),
    sha256: await digestSha256(bytes),
    byteLength: bytes.byteLength,
  });
  let initialDocument: RustHistoricalDocumentIdentityV2;
  let currentDocument: RustHistoricalDocumentRevisionIdentityV2;
  let expectedPreviousDocument: RustHistoricalDocumentRevisionIdentityV2 | null;
  if (input.previous === null) {
    initialDocument = identity;
    currentDocument = Object.freeze({ ...identity, revision: 1 });
    expectedPreviousDocument = null;
  } else {
    const previous = normalizePrevious(input.previous);
    if (!equalJson(previous.source, source)) fail("cas-source", "Historical StoredWorld CAS cannot cross import-source identity");
    if (previous.currentDocument.revision >= MAX_SAFE_U64) fail("cas-revision", "Historical StoredWorld revision is exhausted");
    initialDocument = previous.initialDocument;
    expectedPreviousDocument = previous.currentDocument;
    currentDocument = Object.freeze({ ...identity, revision: previous.currentDocument.revision + 1 });
  }
  const chunks: RustHistoricalExternalDocumentChunkV2[] = [];
  for (let offset = 0, index = 0; offset < bytes.byteLength; offset += RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2, index += 1) {
    const chunkBytes = bytes.slice(offset, Math.min(bytes.byteLength, offset + RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2));
    chunks.push(Object.freeze({
      index,
      byteOffset: offset,
      byteLength: chunkBytes.byteLength,
      payloadHash: persistencePayloadHashV1(chunkBytes),
      bytes: chunkBytes,
    }));
  }
  const fingerprints = chunks.map(chunkFingerprint);
  return Object.freeze({
    schemaVersion: RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2,
    format: RUST_HISTORICAL_STORED_WORLD_FORMAT_V2,
    source,
    initialDocument,
    currentDocument,
    expectedPreviousDocument,
    chunks: Object.freeze(chunks),
    chunkSetHash: rustHistoricalExternalChunkSetHashV2(currentDocument, expectedPreviousDocument, fingerprints),
  });
}

function normalizePrevious(value: unknown): RustHistoricalStoredWorldPreviousV2 {
  const previous = exactRecord(value, ["currentDocument", "initialDocument", "source"], "previous StoredWorld custody");
  return Object.freeze({
    source: normalizeSource(previous.source),
    initialDocument: normalizeDocumentIdentity(previous.initialDocument, "previous.initialDocument"),
    currentDocument: normalizeDocumentRevisionIdentity(previous.currentDocument, "previous.currentDocument"),
  });
}

function normalizeChunks(value: unknown, document: RustHistoricalDocumentRevisionIdentityV2) {
  if (!Array.isArray(value) || value.length < 1
    || value.length > Math.ceil(RUST_HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2 / RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2)) {
    fail("chunk-count", "Historical StoredWorld chunk count is outside its bound");
  }
  const chunks: RustHistoricalExternalDocumentChunkV2[] = [];
  let offset = 0;
  for (let index = 0; index < value.length; index += 1) {
    const row = exactRecord(value[index], ["byteLength", "byteOffset", "bytes", "index", "payloadHash"], `chunks[${index}]`);
    const bytes = copyBytes(row.bytes, `chunks[${index}].bytes`, RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2);
    const chunk: RustHistoricalExternalDocumentChunkV2 = Object.freeze({
      index: exactInteger(row.index, `chunks[${index}].index`, 0, 0xffff_ffff),
      byteOffset: exactInteger(row.byteOffset, `chunks[${index}].byteOffset`),
      byteLength: exactInteger(row.byteLength, `chunks[${index}].byteLength`, 1, RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2),
      payloadHash: hash128(row.payloadHash, `chunks[${index}].payloadHash`),
      bytes,
    });
    const expectedLength = Math.min(RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2, document.byteLength - offset);
    if (chunk.index !== index || chunk.byteOffset !== offset || chunk.byteLength !== expectedLength
      || chunk.bytes.byteLength !== chunk.byteLength || persistencePayloadHashV1(chunk.bytes) !== chunk.payloadHash) {
      fail("chunk-custody", `Historical StoredWorld chunk ${index} is not the exact deterministic slice`);
    }
    chunks.push(chunk);
    offset += chunk.byteLength;
  }
  if (offset !== document.byteLength) fail("chunk-length", "Historical StoredWorld chunks do not cover the exact document length");
  return Object.freeze(chunks);
}

export async function decodeRustHistoricalStoredWorldEnvelopeV2(value: unknown) {
  const root = exactRecord(value, [
    "chunkSetHash", "chunks", "currentDocument", "expectedPreviousDocument", "format",
    "initialDocument", "schemaVersion", "source",
  ], "historical StoredWorld envelope");
  if (root.schemaVersion !== RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2
    || root.format !== RUST_HISTORICAL_STORED_WORLD_FORMAT_V2) {
    fail("envelope-schema", "Historical StoredWorld envelope schema/format is unsupported");
  }
  const source = normalizeSource(root.source);
  const initialDocument = normalizeDocumentIdentity(root.initialDocument, "envelope.initialDocument");
  const currentDocument = normalizeDocumentRevisionIdentity(root.currentDocument, "envelope.currentDocument");
  const expectedPreviousDocument = root.expectedPreviousDocument === null
    ? null
    : normalizeDocumentRevisionIdentity(root.expectedPreviousDocument, "envelope.expectedPreviousDocument");
  if (currentDocument.revision === 1) {
    if (expectedPreviousDocument !== null || !equalJson(initialDocument, {
      hash: currentDocument.hash, sha256: currentDocument.sha256, byteLength: currentDocument.byteLength,
    })) fail("cas-initial", "Initial historical StoredWorld custody must be self-identical and have no previous document");
  } else if (expectedPreviousDocument === null || expectedPreviousDocument.revision + 1 !== currentDocument.revision) {
    fail("cas-revision", "Historical StoredWorld custody must advance exactly one external revision");
  }
  const chunks = normalizeChunks(root.chunks, currentDocument);
  const fingerprints = chunks.map(chunkFingerprint);
  const chunkSetHash = hash128(root.chunkSetHash, "envelope.chunkSetHash");
  if (rustHistoricalExternalChunkSetHashV2(currentDocument, expectedPreviousDocument, fingerprints) !== chunkSetHash) {
    fail("chunk-set-hash", "Historical StoredWorld chunk-set identity is corrupt");
  }
  const bytes = new Uint8Array(currentDocument.byteLength);
  for (const chunk of chunks) bytes.set(chunk.bytes, chunk.byteOffset);
  if (persistencePayloadHashV1(bytes) !== currentDocument.hash || await digestSha256(bytes) !== currentDocument.sha256) {
    fail("document-hash", "Historical StoredWorld chunks do not reproduce the exact document identity");
  }
  const document = await decodeRustHistoricalStoredWorldCanonicalBytesV2(bytes, source);
  const envelope: RustHistoricalStoredWorldEnvelopeV2 = Object.freeze({
    schemaVersion: RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2,
    format: RUST_HISTORICAL_STORED_WORLD_FORMAT_V2,
    source,
    initialDocument,
    currentDocument,
    expectedPreviousDocument,
    chunks,
    chunkSetHash,
  });
  return Object.freeze({ envelope, document, canonicalBytes: bytes });
}

export async function assertRustHistoricalStoredWorldEnvelopeCasV2(
  nextValue: unknown,
  previousValue: unknown,
) {
  const next = await decodeRustHistoricalStoredWorldEnvelopeV2(nextValue);
  const previous = await decodeRustHistoricalStoredWorldEnvelopeV2(previousValue);
  if (!equalJson(next.envelope.source, previous.envelope.source)
    || !equalJson(next.envelope.initialDocument, previous.envelope.initialDocument)
    || !equalJson(next.envelope.expectedPreviousDocument, previous.envelope.currentDocument)
    || next.envelope.currentDocument.revision !== previous.envelope.currentDocument.revision + 1) {
    fail("cas-conflict", "Historical StoredWorld envelope does not compare-and-swap the exact previous custody head");
  }
  return next;
}

function normalizeAuthority(value: unknown): RustHistoricalExternalAuthorityV2 {
  const authority = exactRecord(value, ["claim", "nativePlayer", "nativeRichState"], "descriptor authority");
  if (authority.claim !== RUST_HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2
    || authority.nativePlayer !== "off" || authority.nativeRichState !== "not-adopted") {
    fail("authority", "Historical external custody cannot grant R5 player or native-rich authority");
  }
  return Object.freeze({
    claim: RUST_HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2,
    nativePlayer: "off",
    nativeRichState: "not-adopted",
  });
}

function normalizeSourceWithGenerator(value: unknown): RustHistoricalExternalImmutableV2["source"] {
  const root = exactRecord(value, [
    "archiveWorldId", "byteLength", "encoding", "generatorVersion", "objectId", "provenance",
    "rawSha256", "schemaVersion", "sourceFormat",
  ], "descriptor source");
  const source = normalizeSource({
    schemaVersion: root.schemaVersion,
    provenance: root.provenance,
    sourceFormat: root.sourceFormat,
    encoding: root.encoding,
    archiveWorldId: root.archiveWorldId,
    objectId: root.objectId,
    rawSha256: root.rawSha256,
    byteLength: root.byteLength,
  });
  if (root.generatorVersion !== 16 && root.generatorVersion !== 17) {
    fail("source-version", "Historical external custody supports only exact g16/g17 sources");
  }
  return Object.freeze({ ...source, generatorVersion: root.generatorVersion });
}

function sourceReferenceFromDescriptor(
  source: RustHistoricalExternalImmutableV2["source"],
): WorldImportSourceReferenceV1 {
  return Object.freeze({
    schemaVersion: source.schemaVersion,
    provenance: source.provenance,
    sourceFormat: source.sourceFormat,
    encoding: source.encoding,
    archiveWorldId: source.archiveWorldId,
    objectId: source.objectId,
    rawSha256: source.rawSha256,
    byteLength: source.byteLength,
  });
}

function chunkFingerprint(
  chunk: RustHistoricalExternalDocumentChunkV2,
): RustHistoricalExternalDocumentChunkFingerprintV2 {
  return Object.freeze({
    index: chunk.index,
    byteOffset: chunk.byteOffset,
    byteLength: chunk.byteLength,
    payloadHash: chunk.payloadHash,
  });
}

function normalizeTarget(value: unknown): RustHistoricalExternalTargetV2 {
  const target = exactRecord(value, [
    "catalogWorldId", "contentHash", "generationIdentity", "locationId", "optionsByteLength",
    "optionsSemanticHash", "universeId", "worldSeed",
  ], "descriptor target");
  if (typeof target.catalogWorldId !== "string" || !CATALOG_WORLD_ID.test(target.catalogWorldId)) {
    fail("target", "Historical target catalog world ID is not canonical");
  }
  const universeId = visible(target.universeId, "target.universeId", 64);
  if (universeId !== `world:${target.catalogWorldId}`) fail("target", "Historical target universe differs from catalog world ID");
  const generation = exactRecord(target.generationIdentity, [
    "generationOptionsByteLength", "generationOptionsHash", "generationOptionsJson", "generatorHash",
    "schemaVersion", "terrainContentHash",
  ], "target.generationIdentity");
  if (generation.schemaVersion !== 1 || typeof generation.generationOptionsJson !== "string") {
    fail("target", "Historical target generation identity is unsupported");
  }
  const generationOptions = textEncoder.encode(generation.generationOptionsJson);
  const generationOptionsByteLength = exactInteger(
    generation.generationOptionsByteLength,
    "target.generationOptionsByteLength",
    1,
    PERSISTENCE_MAX_RECORD_BYTES_V1,
  );
  const generationOptionsHash = hash128(generation.generationOptionsHash, "target.generationOptionsHash");
  if (generationOptions.byteLength !== generationOptionsByteLength
    || persistencePayloadHashV1(generationOptions) !== generationOptionsHash) {
    fail("target", "Historical generation-options JSON differs from its exact hash/length binding");
  }
  return Object.freeze({
    catalogWorldId: target.catalogWorldId,
    universeId,
    locationId: visible(target.locationId, "target.locationId", 128),
    worldSeed: visible(target.worldSeed, "target.worldSeed", 512),
    contentHash: hash128(target.contentHash, "target.contentHash"),
    generationIdentity: Object.freeze({
      schemaVersion: 1,
      generatorHash: hash128(generation.generatorHash, "target.generatorHash"),
      terrainContentHash: hash128(generation.terrainContentHash, "target.terrainContentHash"),
      generationOptionsJson: generation.generationOptionsJson,
      generationOptionsHash,
      generationOptionsByteLength,
    }),
    optionsSemanticHash: hash128(target.optionsSemanticHash, "target.optionsSemanticHash"),
    optionsByteLength: exactInteger(target.optionsByteLength, "target.optionsByteLength", 1, PERSISTENCE_MAX_RECORD_BYTES_V1),
  });
}

function normalizeBwas(value: unknown): RustHistoricalExternalBwasV2 {
  const bwas = exactRecord(value, [
    "compatibilityChecksum", "editCount", "extensionChecksum", "facingCount", "projectionByteLength", "projectionHash",
  ], "descriptor BWAS");
  return Object.freeze({
    projectionHash: hash128(bwas.projectionHash, "bwas.projectionHash"),
    projectionByteLength: exactInteger(bwas.projectionByteLength, "bwas.projectionByteLength", 1, PERSISTENCE_MAX_RECORD_BYTES_V1),
    compatibilityChecksum: hash128(bwas.compatibilityChecksum, "bwas.compatibilityChecksum"),
    extensionChecksum: hash128(bwas.extensionChecksum, "bwas.extensionChecksum"),
    editCount: exactInteger(bwas.editCount, "bwas.editCount"),
    facingCount: exactInteger(bwas.facingCount, "bwas.facingCount"),
  });
}

function normalizeImmutable(value: unknown): RustHistoricalExternalImmutableV2 {
  const immutable = exactRecord(value, [
    "authority", "bwas", "custodyRoot", "externalStateFlags", "initialDocument", "nativeExecutionScope",
    "planHash", "profile", "source", "target",
  ], "descriptor immutable fields");
  if (immutable.profile !== RUST_HISTORICAL_EXTERNAL_PROFILE_V2
    || immutable.nativeExecutionScope !== RUST_HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2) {
    fail("profile", "Historical external descriptor requests an unsupported compatibility profile or execution scope");
  }
  return Object.freeze({
    authority: normalizeAuthority(immutable.authority),
    profile: RUST_HISTORICAL_EXTERNAL_PROFILE_V2,
    nativeExecutionScope: RUST_HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2,
    source: normalizeSourceWithGenerator(immutable.source),
    initialDocument: normalizeDocumentIdentity(immutable.initialDocument, "immutable.initialDocument"),
    planHash: hash128(immutable.planHash, "immutable.planHash"),
    custodyRoot: hash128(immutable.custodyRoot, "immutable.custodyRoot"),
    externalStateFlags: exactInteger(immutable.externalStateFlags, "immutable.externalStateFlags", 1, 0xffff),
    target: normalizeTarget(immutable.target),
    bwas: normalizeBwas(immutable.bwas),
  });
}

function normalizeChunkFingerprints(
  value: unknown,
  document: RustHistoricalDocumentRevisionIdentityV2,
): readonly RustHistoricalExternalDocumentChunkFingerprintV2[] {
  if (!Array.isArray(value) || value.length < 1
    || value.length > Math.ceil(RUST_HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2 / RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2)) {
    fail("chunk-count", "Historical descriptor chunk fingerprints are outside their bound");
  }
  let offset = 0;
  const chunks = value.map((entry, index) => {
    const row = exactRecord(entry, ["byteLength", "byteOffset", "index", "payloadHash"], `descriptor chunks[${index}]`);
    const chunk = Object.freeze({
      index: exactInteger(row.index, `descriptor chunks[${index}].index`, 0, 0xffff_ffff),
      byteOffset: exactInteger(row.byteOffset, `descriptor chunks[${index}].byteOffset`),
      byteLength: exactInteger(row.byteLength, `descriptor chunks[${index}].byteLength`, 1, RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2),
      payloadHash: hash128(row.payloadHash, `descriptor chunks[${index}].payloadHash`),
    });
    const expectedLength = Math.min(RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2, document.byteLength - offset);
    if (chunk.index !== index || chunk.byteOffset !== offset || chunk.byteLength !== expectedLength) {
      fail("chunk-custody", "Historical descriptor chunks are not exact contiguous deterministic slices");
    }
    offset += chunk.byteLength;
    return chunk;
  });
  if (offset !== document.byteLength) fail("chunk-length", "Historical descriptor chunks do not cover the exact document length");
  return Object.freeze(chunks);
}

function expectedNativeAddress(
  template: typeof RUST_HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2[number],
  universeId: string,
  locationId: string,
): PersistenceRecordAddressV1 {
  return { universeId, locationId, kind: template.kind, recordId: template.recordId };
}

function normalizeNativeRecords(
  value: unknown,
  universeId: string,
  locationId: string,
): readonly PersistenceRecordDescriptorV1[] {
  if (!Array.isArray(value) || value.length !== RUST_HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2.length) {
    fail("native-record-count", "Historical descriptor requires exactly the six primary native authority records");
  }
  const records = value.map((entry, index) => {
    const row = exactRecord(entry, ["address", "byteLength", "payloadHash", "revision"], `nativeRecords[${index}]`);
    const addressRow = exactRecord(row.address, ["kind", "locationId", "recordId", "universeId"], `nativeRecords[${index}].address`);
    if (typeof addressRow.kind !== "string"
      || !PERSISTENCE_RECORD_KIND_ORDER_V1.includes(addressRow.kind as typeof PERSISTENCE_RECORD_KIND_ORDER_V1[number])) {
      fail("native-record-kind", `nativeRecords[${index}] has an unknown record kind`);
    }
    const address: PersistenceRecordAddressV1 = Object.freeze({
      universeId: visible(addressRow.universeId, `nativeRecords[${index}].universeId`, 64),
      locationId: visible(addressRow.locationId, `nativeRecords[${index}].locationId`, 128),
      kind: addressRow.kind as typeof PERSISTENCE_RECORD_KIND_ORDER_V1[number],
      recordId: visible(addressRow.recordId, `nativeRecords[${index}].recordId`, 256),
    });
    const expected = expectedNativeAddress(RUST_HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2[index], universeId, locationId);
    if (persistenceRecordKeyV1(address) !== persistenceRecordKeyV1(expected)) {
      fail("native-record-set", "Historical descriptor native fingerprints differ from the exact primary record set/order");
    }
    return Object.freeze({
      address,
      revision: exactInteger(row.revision, `nativeRecords[${index}].revision`, 1),
      byteLength: exactInteger(row.byteLength, `nativeRecords[${index}].byteLength`, 1, PERSISTENCE_MAX_RECORD_BYTES_V1),
      payloadHash: hash128(row.payloadHash, `nativeRecords[${index}].payloadHash`),
    });
  });
  return Object.freeze(records);
}

export function rustHistoricalExternalNativeRecordSetHashV2(records: readonly PersistenceRecordDescriptorV1[]) {
  const hasher = new TypeScriptCanonicalHasher("blockwild-historical-external-native-record-set-v2").writeU32(records.length);
  for (const record of records) {
    hasher.writeString(record.address.universeId).writeString(record.address.locationId)
      .writeString(record.address.kind).writeString(record.address.recordId)
      .writeU64(record.revision).writeU32(record.byteLength).writeString(record.payloadHash);
  }
  return hasher.finishHex();
}

function normalizeMutable(value: unknown, immutable: RustHistoricalExternalImmutableV2): RustHistoricalExternalMutableV2 {
  const mutable = exactRecord(value, [
    "chunkSetHash", "chunks", "currentDocument", "expectedPreviousDocument", "nativeRecordSetHash", "nativeRecords",
  ], "descriptor mutable fields");
  const currentDocument = normalizeDocumentRevisionIdentity(mutable.currentDocument, "mutable.currentDocument");
  const expectedPreviousDocument = mutable.expectedPreviousDocument === null
    ? null
    : normalizeDocumentRevisionIdentity(mutable.expectedPreviousDocument, "mutable.expectedPreviousDocument");
  if (currentDocument.revision === 1) {
    if (expectedPreviousDocument !== null || !equalJson(immutable.initialDocument, {
      hash: currentDocument.hash, sha256: currentDocument.sha256, byteLength: currentDocument.byteLength,
    })) fail("cas-initial", "Initial descriptor document must match immutable initial custody with no previous head");
  } else if (expectedPreviousDocument === null || expectedPreviousDocument.revision + 1 !== currentDocument.revision) {
    fail("cas-revision", "Descriptor external document revision must advance exactly once from its expected head");
  }
  const chunks = normalizeChunkFingerprints(mutable.chunks, currentDocument);
  const chunkSetHash = hash128(mutable.chunkSetHash, "mutable.chunkSetHash");
  if (rustHistoricalExternalChunkSetHashV2(currentDocument, expectedPreviousDocument, chunks) !== chunkSetHash) {
    fail("chunk-set-hash", "Descriptor chunk-set fingerprint is corrupt");
  }
  const nativeRecords = normalizeNativeRecords(
    mutable.nativeRecords,
    immutable.target.universeId,
    immutable.target.locationId,
  );
  const nativeRecordSetHash = hash128(mutable.nativeRecordSetHash, "mutable.nativeRecordSetHash");
  if (rustHistoricalExternalNativeRecordSetHashV2(nativeRecords) !== nativeRecordSetHash) {
    fail("native-record-set-hash", "Descriptor native-record fingerprint is corrupt");
  }
  return Object.freeze({
    currentDocument,
    expectedPreviousDocument,
    chunks,
    chunkSetHash,
    nativeRecords,
    nativeRecordSetHash,
  });
}

type RustHistoricalExternalDescriptorSourceV2 = Readonly<{
  immutable: RustHistoricalExternalImmutableV2;
  currentDocument: RustHistoricalDocumentRevisionIdentityV2;
  expectedPreviousDocument: RustHistoricalDocumentRevisionIdentityV2 | null;
  chunks: readonly RustHistoricalExternalDocumentChunkFingerprintV2[];
  nativeRecords: readonly PersistenceRecordDescriptorV1[];
}>;

export function createRustHistoricalExternalDescriptorV2(
  source: RustHistoricalExternalDescriptorSourceV2,
): RustHistoricalExternalDescriptorV2 {
  const immutable = normalizeImmutable(source.immutable);
  const mutable = normalizeMutable({
    currentDocument: source.currentDocument,
    expectedPreviousDocument: source.expectedPreviousDocument,
    chunks: source.chunks,
    chunkSetHash: rustHistoricalExternalChunkSetHashV2(
      source.currentDocument,
      source.expectedPreviousDocument,
      source.chunks,
    ),
    nativeRecords: source.nativeRecords,
    nativeRecordSetHash: rustHistoricalExternalNativeRecordSetHashV2(source.nativeRecords),
  }, immutable);
  const withoutHash = Object.freeze({
    schemaVersion: RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2,
    immutable,
    mutable,
  });
  const descriptorHash = rustHistoricalExternalDescriptorHashV2(withoutHash);
  return Object.freeze({ ...withoutHash, descriptorHash });
}

export function withRustHistoricalExternalDescriptorNativeRecordsV2(
  value: RustHistoricalExternalDescriptorV2,
  nativeRecords: readonly PersistenceRecordDescriptorV1[],
) {
  const descriptor = assertRustHistoricalExternalDescriptorV2(value);
  return createRustHistoricalExternalDescriptorV2({
    immutable: descriptor.immutable,
    currentDocument: descriptor.mutable.currentDocument,
    expectedPreviousDocument: descriptor.mutable.expectedPreviousDocument,
    chunks: descriptor.mutable.chunks,
    nativeRecords,
  });
}

function envelopeFingerprints(envelope: RustHistoricalStoredWorldEnvelopeV2) {
  return Object.freeze(envelope.chunks.map(chunkFingerprint));
}

function hexBytes(value: string, length: 16 | 32, label: string) {
  const pattern = length === 16 ? HASH_128 : SHA_256;
  if (!pattern.test(value)) fail("hash", `${label} has an invalid hexadecimal width`);
  const output = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return output;
}

function bytesHex(value: Uint8Array) {
  return Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
}

class Writer {
  readonly bytes: number[] = [];
  raw(value: Uint8Array) { this.bytes.push(...value); return this; }
  u8(value: number) { this.bytes.push(exactInteger(value, "u8", 0, 0xff)); return this; }
  u16(value: number) {
    const checked = exactInteger(value, "u16", 0, 0xffff);
    this.bytes.push(checked & 0xff, checked >>> 8 & 0xff);
    return this;
  }
  u32(value: number) {
    const checked = exactInteger(value, "u32", 0, 0xffff_ffff);
    this.bytes.push(checked & 0xff, checked >>> 8 & 0xff, checked >>> 16 & 0xff, checked >>> 24 & 0xff);
    return this;
  }
  u64(value: number) {
    const checked = BigInt(exactInteger(value, "u64"));
    for (let shift = BigInt(0); shift < BigInt(64); shift += BigInt(8)) {
      this.bytes.push(Number(checked >> shift & BigInt(0xff)));
    }
    return this;
  }
  string(value: string) {
    const bytes = textEncoder.encode(value);
    this.u32(bytes.byteLength).raw(bytes);
    return this;
  }
  hash(value: string) { return this.raw(hexBytes(value, 16, "canonical hash")); }
  sha256(value: string) { return this.raw(hexBytes(value, 32, "SHA-256")); }
  address(value: PersistenceRecordAddressV1) {
    const kind = PERSISTENCE_RECORD_KIND_ORDER_V1.indexOf(value.kind);
    if (kind < 0) fail("record-kind", "Cannot encode unknown persistence record kind");
    return this.string(value.universeId).string(value.locationId).u8(kind).string(value.recordId);
  }
  finish() { return Uint8Array.from(this.bytes); }
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  take(length: number) {
    const end = this.offset + length;
    if (!Number.isSafeInteger(end) || end > this.bytes.byteLength) fail("descriptor-truncated", "Historical external descriptor is truncated");
    const result = this.bytes.slice(this.offset, end);
    this.offset = end;
    return result;
  }
  u8() { return this.take(1)[0]; }
  u16() { const value = this.take(2); return value[0] | value[1] << 8; }
  u32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, true); }
  u64() {
    const value = this.take(8);
    let result = BigInt(0);
    for (let index = 0; index < 8; index += 1) result |= BigInt(value[index]) << BigInt(index * 8);
    if (result > BigInt(MAX_SAFE_U64)) fail("descriptor-integer", "Historical external descriptor u64 exceeds JavaScript's exact range");
    return Number(result);
  }
  string(maximumUtf16: number) {
    const length = this.u32();
    let value: string;
    try { value = textDecoder.decode(this.take(length)); }
    catch { return fail("descriptor-utf8", "Historical external descriptor contains invalid UTF-8"); }
    if (value.length > maximumUtf16) fail("descriptor-string", "Historical external descriptor string exceeds its UTF-16 bound");
    return value;
  }
  hash() { return bytesHex(this.take(16)); }
  sha256() { return bytesHex(this.take(32)); }
  address(): PersistenceRecordAddressV1 {
    const universeId = this.string(64);
    const locationId = this.string(128);
    const kind = PERSISTENCE_RECORD_KIND_ORDER_V1[this.u8()];
    if (!kind) fail("record-kind", "Historical descriptor contains an unknown record kind");
    return { universeId, locationId, kind, recordId: this.string(256) };
  }
  finish() {
    if (this.offset !== this.bytes.byteLength) fail("descriptor-trailing", "Historical external descriptor contains trailing bytes");
  }
}

function writeDocumentIdentity(writer: Writer, identity: RustHistoricalDocumentIdentityV2) {
  writer.hash(identity.hash).sha256(identity.sha256).u64(identity.byteLength);
}

function writeDocumentRevisionIdentity(writer: Writer, identity: RustHistoricalDocumentRevisionIdentityV2) {
  writeDocumentIdentity(writer, identity);
  writer.u64(identity.revision);
}

function readDocumentIdentity(reader: Reader): RustHistoricalDocumentIdentityV2 {
  return { hash: reader.hash(), sha256: reader.sha256(), byteLength: reader.u64() };
}

function readDocumentRevisionIdentity(reader: Reader): RustHistoricalDocumentRevisionIdentityV2 {
  return { ...readDocumentIdentity(reader), revision: reader.u64() };
}

function writeDescriptorCommon(
  writer: Writer,
  schemaVersion: number,
  immutable: RustHistoricalExternalImmutableV2,
  external: Pick<RustHistoricalExternalMutableV2,
    "currentDocument" | "expectedPreviousDocument" | "chunks" | "chunkSetHash">,
) {
  writer.u16(schemaVersion)
    .string(immutable.authority.claim).string(immutable.authority.nativePlayer).string(immutable.authority.nativeRichState)
    .string(immutable.profile).string(immutable.nativeExecutionScope)
    .u16(immutable.source.schemaVersion).string(immutable.source.provenance).string(immutable.source.sourceFormat)
    .string(immutable.source.encoding).string(immutable.source.archiveWorldId).string(immutable.source.objectId)
    .sha256(immutable.source.rawSha256).u64(immutable.source.byteLength).u16(immutable.source.generatorVersion);
  writeDocumentIdentity(writer, immutable.initialDocument);
  writer.hash(immutable.planHash).hash(immutable.custodyRoot).u16(immutable.externalStateFlags)
    .string(immutable.target.catalogWorldId).string(immutable.target.universeId).string(immutable.target.locationId)
    .string(immutable.target.worldSeed).hash(immutable.target.contentHash)
    .u16(immutable.target.generationIdentity.schemaVersion)
    .hash(immutable.target.generationIdentity.generatorHash)
    .hash(immutable.target.generationIdentity.terrainContentHash)
    .string(immutable.target.generationIdentity.generationOptionsJson)
    .hash(immutable.target.generationIdentity.generationOptionsHash)
    .u64(immutable.target.generationIdentity.generationOptionsByteLength)
    .hash(immutable.target.optionsSemanticHash).u64(immutable.target.optionsByteLength)
    .hash(immutable.bwas.projectionHash).u64(immutable.bwas.projectionByteLength)
    .hash(immutable.bwas.compatibilityChecksum).hash(immutable.bwas.extensionChecksum)
    .u64(immutable.bwas.editCount).u64(immutable.bwas.facingCount);
  writeDocumentRevisionIdentity(writer, external.currentDocument);
  writer.u8(external.expectedPreviousDocument === null ? 0 : 1);
  if (external.expectedPreviousDocument) writeDocumentRevisionIdentity(writer, external.expectedPreviousDocument);
  writer.u32(external.chunks.length);
  for (const chunk of external.chunks) {
    writer.u32(chunk.index).u64(chunk.byteOffset).u32(chunk.byteLength).hash(chunk.payloadHash);
  }
  writer.hash(external.chunkSetHash);
  return writer;
}

function descriptorBodyBytes(value: Omit<RustHistoricalExternalDescriptorV2, "descriptorHash">) {
  const { immutable, mutable } = value;
  const writer = writeDescriptorCommon(
    new Writer().raw(textEncoder.encode(RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_MAGIC_V2)),
    value.schemaVersion,
    immutable,
    mutable,
  ).u32(mutable.nativeRecords.length);
  for (const record of mutable.nativeRecords) {
    writer.address(record.address).u64(record.revision).u32(record.byteLength).hash(record.payloadHash);
  }
  writer.hash(mutable.nativeRecordSetHash);
  return writer.finish();
}

function proposalBodyBytes(value: Omit<RustHistoricalExternalDescriptorProposalV2, "proposalHash">) {
  return writeDescriptorCommon(
    new Writer().raw(textEncoder.encode(RUST_HISTORICAL_EXTERNAL_PROPOSAL_MAGIC_V2)),
    value.schemaVersion,
    value.immutable,
    value.external,
  ).finish();
}

function readDescriptorCommon(reader: Reader) {
  const schemaVersion = reader.u16();
  const authority = {
    claim: reader.string(180),
    nativePlayer: reader.string(32),
    nativeRichState: reader.string(32),
  };
  const profile = reader.string(128);
  const nativeExecutionScope = reader.string(128);
  const source = {
    schemaVersion: reader.u16(),
    provenance: reader.string(64),
    sourceFormat: reader.string(128),
    encoding: reader.string(32),
    archiveWorldId: reader.string(180),
    objectId: reader.string(96),
    rawSha256: reader.sha256(),
    byteLength: reader.u64(),
    generatorVersion: reader.u16(),
  };
  const initialDocument = readDocumentIdentity(reader);
  const planHash = reader.hash();
  const custodyRoot = reader.hash();
  const externalStateFlags = reader.u16();
  const target = {
    catalogWorldId: reader.string(48),
    universeId: reader.string(64),
    locationId: reader.string(128),
    worldSeed: reader.string(512),
    contentHash: reader.hash(),
    generationIdentity: {
      schemaVersion: reader.u16(),
      generatorHash: reader.hash(),
      terrainContentHash: reader.hash(),
      generationOptionsJson: reader.string(65_536),
      generationOptionsHash: reader.hash(),
      generationOptionsByteLength: reader.u64(),
    },
    optionsSemanticHash: reader.hash(),
    optionsByteLength: reader.u64(),
  };
  const bwas = {
    projectionHash: reader.hash(),
    projectionByteLength: reader.u64(),
    compatibilityChecksum: reader.hash(),
    extensionChecksum: reader.hash(),
    editCount: reader.u64(),
    facingCount: reader.u64(),
  };
  const currentDocument = readDocumentRevisionIdentity(reader);
  const expectedTag = reader.u8();
  if (expectedTag > 1) fail("descriptor-option", "Historical descriptor expected-previous tag is invalid");
  const expectedPreviousDocument = expectedTag === 0 ? null : readDocumentRevisionIdentity(reader);
  const chunkCount = reader.u32();
  const maximumChunks = Math.ceil(
    RUST_HISTORICAL_EXTERNAL_MAX_DOCUMENT_BYTES_V2 / RUST_HISTORICAL_EXTERNAL_DOCUMENT_CHUNK_BYTES_V2,
  );
  if (chunkCount < 1 || chunkCount > maximumChunks) {
    fail("chunk-count", "Historical descriptor chunk fingerprints are outside their bound");
  }
  const chunks = Array.from({ length: chunkCount }, () => ({
    index: reader.u32(),
    byteOffset: reader.u64(),
    byteLength: reader.u32(),
    payloadHash: reader.hash(),
  }));
  const chunkSetHash = reader.hash();
  return {
    schemaVersion,
    immutable: {
      authority,
      profile,
      nativeExecutionScope,
      source,
      initialDocument,
      planHash,
      custodyRoot,
      externalStateFlags,
      target,
      bwas,
    },
    external: { currentDocument, expectedPreviousDocument, chunks, chunkSetHash },
  };
}

type RustHistoricalExternalProposalSourceV2 = Readonly<{
  immutable: RustHistoricalExternalImmutableV2;
  currentDocument: RustHistoricalDocumentRevisionIdentityV2;
  expectedPreviousDocument: RustHistoricalDocumentRevisionIdentityV2 | null;
  chunks: readonly RustHistoricalExternalDocumentChunkFingerprintV2[];
}>;

export function createRustHistoricalExternalDescriptorProposalV2(
  source: RustHistoricalExternalProposalSourceV2,
): RustHistoricalExternalDescriptorProposalV2 {
  const immutable = normalizeImmutable(source.immutable);
  const currentDocument = normalizeDocumentRevisionIdentity(source.currentDocument, "proposal.currentDocument");
  const expectedPreviousDocument = source.expectedPreviousDocument === null
    ? null
    : normalizeDocumentRevisionIdentity(source.expectedPreviousDocument, "proposal.expectedPreviousDocument");
  const chunks = normalizeChunkFingerprints(source.chunks, currentDocument);
  const chunkSetHash = rustHistoricalExternalChunkSetHashV2(currentDocument, expectedPreviousDocument, chunks);
  // Reuse the durable mutable validator with exact inert test records only for
  // CAS/chunk validation would turn sentinels into authority. Validate those
  // lanes directly instead: proposals intentionally contain no native set.
  if (currentDocument.revision === 1) {
    if (expectedPreviousDocument !== null || !equalJson(immutable.initialDocument, {
      hash: currentDocument.hash, sha256: currentDocument.sha256, byteLength: currentDocument.byteLength,
    })) fail("cas-initial", "Initial proposal document differs from immutable initial custody");
  } else if (expectedPreviousDocument === null || expectedPreviousDocument.revision + 1 !== currentDocument.revision) {
    fail("cas-revision", "Proposal external document revision must advance exactly once from its expected head");
  }
  const external = Object.freeze({ currentDocument, expectedPreviousDocument, chunks, chunkSetHash });
  const withoutHash = Object.freeze({
    schemaVersion: RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2,
    immutable,
    external,
  });
  const proposalHash = rustHistoricalExternalDescriptorProposalHashV2(withoutHash);
  return Object.freeze({ ...withoutHash, proposalHash });
}

export function rustHistoricalExternalDescriptorProposalHashV2(
  value: Omit<RustHistoricalExternalDescriptorProposalV2, "proposalHash">,
) {
  return new TypeScriptCanonicalHasher("blockwild-historical-external-descriptor-proposal-v2")
    .writeBytes(proposalBodyBytes(value)).finishHex();
}

export function assertRustHistoricalExternalDescriptorProposalV2(value: unknown) {
  const root = exactRecord(value, ["external", "immutable", "proposalHash", "schemaVersion"], "historical descriptor proposal");
  if (root.schemaVersion !== RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2) {
    fail("proposal-schema", "Historical descriptor proposal schema is unsupported");
  }
  const immutable = normalizeImmutable(root.immutable);
  const externalRoot = exactRecord(root.external, [
    "chunkSetHash", "chunks", "currentDocument", "expectedPreviousDocument",
  ], "proposal external fields");
  const proposal = createRustHistoricalExternalDescriptorProposalV2({
    immutable,
    currentDocument: externalRoot.currentDocument as RustHistoricalDocumentRevisionIdentityV2,
    expectedPreviousDocument: externalRoot.expectedPreviousDocument as RustHistoricalDocumentRevisionIdentityV2 | null,
    chunks: externalRoot.chunks as readonly RustHistoricalExternalDocumentChunkFingerprintV2[],
  });
  if (externalRoot.chunkSetHash !== proposal.external.chunkSetHash
    || root.proposalHash !== proposal.proposalHash) {
    fail("proposal-hash", "Historical descriptor proposal fingerprint is corrupt");
  }
  return proposal;
}

export function encodeRustHistoricalExternalDescriptorProposalV2(value: RustHistoricalExternalDescriptorProposalV2) {
  const proposal = assertRustHistoricalExternalDescriptorProposalV2(value);
  const body = proposalBodyBytes({
    schemaVersion: proposal.schemaVersion,
    immutable: proposal.immutable,
    external: proposal.external,
  });
  const output = new Uint8Array(body.byteLength + 16);
  output.set(body);
  output.set(hexBytes(proposal.proposalHash, 16, "proposalHash"), body.byteLength);
  return output;
}

export function decodeRustHistoricalExternalDescriptorProposalV2(input: Uint8Array) {
  const bytes = copyBytes(input, "historical descriptor proposal bytes", PERSISTENCE_MAX_RECORD_BYTES_V1);
  const reader = new Reader(bytes);
  if (textDecoder.decode(reader.take(4)) !== RUST_HISTORICAL_EXTERNAL_PROPOSAL_MAGIC_V2) {
    fail("proposal-magic", "Historical external descriptor proposal magic mismatch");
  }
  const common = readDescriptorCommon(reader);
  const proposalHash = reader.hash();
  reader.finish();
  return assertRustHistoricalExternalDescriptorProposalV2({
    schemaVersion: common.schemaVersion,
    immutable: common.immutable,
    external: common.external,
    proposalHash,
  });
}

export function bindRustHistoricalExternalDescriptorProposalV2(
  proposalValue: RustHistoricalExternalDescriptorProposalV2,
  nativeRecords: readonly PersistenceRecordDescriptorV1[],
) {
  const proposal = assertRustHistoricalExternalDescriptorProposalV2(proposalValue);
  return createRustHistoricalExternalDescriptorV2({
    immutable: proposal.immutable,
    currentDocument: proposal.external.currentDocument,
    expectedPreviousDocument: proposal.external.expectedPreviousDocument,
    chunks: proposal.external.chunks,
    nativeRecords,
  });
}

export function rustHistoricalExternalDescriptorHashV2(
  value: Omit<RustHistoricalExternalDescriptorV2, "descriptorHash">,
) {
  return new TypeScriptCanonicalHasher("blockwild-historical-external-descriptor-v2")
    .writeBytes(descriptorBodyBytes(value)).finishHex();
}

export function assertRustHistoricalExternalDescriptorV2(value: unknown): RustHistoricalExternalDescriptorV2 {
  const root = exactRecord(value, ["descriptorHash", "immutable", "mutable", "schemaVersion"], "historical external descriptor");
  if (root.schemaVersion !== RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2) {
    fail("descriptor-schema", "Historical external descriptor schema is unsupported");
  }
  const immutable = normalizeImmutable(root.immutable);
  const mutable = normalizeMutable(root.mutable, immutable);
  const descriptorHash = hash128(root.descriptorHash, "descriptorHash");
  const expected = rustHistoricalExternalDescriptorHashV2({
    schemaVersion: RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2,
    immutable,
    mutable,
  });
  if (descriptorHash !== expected) fail("descriptor-hash", "Historical external descriptor fingerprint is corrupt");
  return Object.freeze({
    schemaVersion: RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_SCHEMA_V2,
    immutable,
    mutable,
    descriptorHash,
  });
}

export function encodeRustHistoricalExternalDescriptorV2(value: RustHistoricalExternalDescriptorV2) {
  const descriptor = assertRustHistoricalExternalDescriptorV2(value);
  const body = descriptorBodyBytes({
    schemaVersion: descriptor.schemaVersion,
    immutable: descriptor.immutable,
    mutable: descriptor.mutable,
  });
  const output = new Uint8Array(body.byteLength + 16);
  output.set(body);
  output.set(hexBytes(descriptor.descriptorHash, 16, "descriptorHash"), body.byteLength);
  return output;
}

export function decodeRustHistoricalExternalDescriptorV2(input: Uint8Array) {
  const bytes = copyBytes(input, "historical external descriptor bytes", PERSISTENCE_MAX_RECORD_BYTES_V1);
  const reader = new Reader(bytes);
  if (textDecoder.decode(reader.take(4)) !== RUST_HISTORICAL_EXTERNAL_DESCRIPTOR_MAGIC_V2) {
    fail("descriptor-magic", "Historical external descriptor magic mismatch");
  }
  const common = readDescriptorCommon(reader);
  const nativeRecordCount = reader.u32();
  if (nativeRecordCount !== RUST_HISTORICAL_EXTERNAL_NATIVE_RECORD_TEMPLATES_V2.length) {
    fail("native-record-count", "Durable historical descriptor must contain exactly six primary native records");
  }
  const nativeRecords = Array.from({ length: nativeRecordCount }, () => ({
    address: reader.address(),
    revision: reader.u64(),
    byteLength: reader.u32(),
    payloadHash: reader.hash(),
  }));
  const nativeRecordSetHash = reader.hash();
  const descriptorHash = reader.hash();
  reader.finish();
  return assertRustHistoricalExternalDescriptorV2({
    schemaVersion: common.schemaVersion,
    immutable: common.immutable,
    mutable: {
      ...common.external,
      nativeRecords,
      nativeRecordSetHash,
    },
    descriptorHash,
  });
}

function immutableFromPlan(
  planValue: RustHistoricalSaveCompatibilityPlanV1,
  initialDocument: RustHistoricalDocumentIdentityV2,
) {
  const plan = exactRecord(planValue, [
    "authority", "custodyRoot", "domains", "externalStateFlags", "nativeExecutionScope",
    "nativeWorld", "planHash", "profile", "schemaVersion", "source", "sourceProperties", "status", "target",
  ], "historical compatibility plan");
  if (plan.schemaVersion !== 1 || plan.status !== "external-custody-planned") {
    fail("plan", "Historical external custody requires a revalidated external-custody plan");
  }
  const source = exactRecord(plan.source, ["normalized", "raw"], "plan.source");
  const raw = normalizeSourceWithGenerator(source.raw);
  const normalized = exactRecord(source.normalized, ["byteLength", "canonicalBytes", "semanticHash"], "plan.source.normalized");
  const normalizedBytes = copyBytes(normalized.canonicalBytes, "plan normalized canonical bytes");
  if (normalizedBytes.byteLength !== normalized.byteLength
    || persistencePayloadHashV1(normalizedBytes) !== normalized.semanticHash) {
    fail("plan-source", "Historical plan normalized bytes differ from their hash/length identity");
  }
  const target = exactRecord(plan.target, [
    "catalogWorldId", "contentHash", "generationIdentity", "locationId", "options", "optionsByteLength",
    "optionsSemanticHash", "universeId", "worldSeed",
  ], "plan.target");
  const generation = exactRecord(target.generationIdentity, [
    "generationOptionsJson", "generatorHash", "schemaVersion", "terrainContentHash",
  ], "plan.target.generationIdentity");
  if (typeof generation.generationOptionsJson !== "string") fail("plan-target", "Plan generation options identity is not JSON text");
  const generationOptionsBytes = textEncoder.encode(generation.generationOptionsJson);
  const nativeWorld = exactRecord(plan.nativeWorld, [
    "address", "compatibilityChecksum", "editCount", "expectedReadback", "extensionChecksum", "facingCount",
    "projectionByteLength", "projectionBytes", "projectionHash",
  ], "plan.nativeWorld");
  const projectionBytes = copyBytes(nativeWorld.projectionBytes, "plan BWAS projection bytes", PERSISTENCE_MAX_RECORD_BYTES_V1);
  if (projectionBytes.byteLength !== nativeWorld.projectionByteLength
    || persistencePayloadHashV1(projectionBytes) !== nativeWorld.projectionHash) {
    fail("plan-bwas", "Historical plan BWAS bytes differ from their hash/length identity");
  }
  return normalizeImmutable({
    authority: plan.authority,
    profile: plan.profile,
    nativeExecutionScope: plan.nativeExecutionScope,
    source: raw,
    initialDocument,
    planHash: plan.planHash,
    custodyRoot: plan.custodyRoot,
    externalStateFlags: plan.externalStateFlags,
    target: {
      catalogWorldId: target.catalogWorldId,
      universeId: target.universeId,
      locationId: target.locationId,
      worldSeed: target.worldSeed,
      contentHash: target.contentHash,
      generationIdentity: {
        schemaVersion: generation.schemaVersion,
        generatorHash: generation.generatorHash,
        terrainContentHash: generation.terrainContentHash,
        generationOptionsJson: generation.generationOptionsJson,
        generationOptionsHash: persistencePayloadHashV1(generationOptionsBytes),
        generationOptionsByteLength: generationOptionsBytes.byteLength,
      },
      optionsSemanticHash: target.optionsSemanticHash,
      optionsByteLength: target.optionsByteLength,
    },
    bwas: {
      projectionHash: nativeWorld.projectionHash,
      projectionByteLength: nativeWorld.projectionByteLength,
      compatibilityChecksum: nativeWorld.compatibilityChecksum,
      extensionChecksum: nativeWorld.extensionChecksum,
      editCount: nativeWorld.editCount,
      facingCount: nativeWorld.facingCount,
    },
  });
}

function assertInitialDocumentMatchesPlan(
  documentValue: StoredWorld,
  planValue: RustHistoricalSaveCompatibilityPlanV1,
) {
  const document = ordinaryRecord(documentValue, "initial historical StoredWorld");
  const metadata = ordinaryRecord(document.metadata, "initial historical StoredWorld.metadata");
  const save = ordinaryRecord(document.save, "initial historical StoredWorld.save");
  const plan = planValue;
  const normalizedBytes = copyBytes(plan.source.normalized.canonicalBytes, "plan normalized canonical bytes");
  if (normalizedBytes.byteLength !== plan.source.normalized.byteLength
    || persistencePayloadHashV1(normalizedBytes) !== plan.source.normalized.semanticHash) {
    fail("plan-source", "Historical plan normalized bytes differ from their hash/length identity");
  }
  let normalizedValue: unknown;
  try { normalizedValue = JSON.parse(textDecoder.decode(normalizedBytes)); }
  catch { return fail("plan-source", "Historical plan normalized bytes are not canonical JSON"); }
  if (!equalBytes(canonicalJsonBytes(normalizedValue), normalizedBytes)) {
    fail("plan-source", "Historical plan normalized bytes are not canonical JSON");
  }
  const normalizedSave = ordinaryRecord(normalizedValue, "plan normalized source save");
  const sourceReference = sourceReferenceFromDescriptor(normalizeSourceWithGenerator(plan.source.raw));
  const generationIdentity = deriveWorldGenerationIdentityV1(documentValue.save, documentValue.options);
  const sourceBoundSaveProperties = Object.freeze([
    "generatorVersion", "generatorProfile", "agentWorldFingerprint", "edits", "blockFacings",
  ]);
  let sourceBoundSaveDrift = false;
  for (const property of sourceBoundSaveProperties) {
    const currentHasProperty = Object.hasOwn(save, property);
    const sourceHasProperty = Object.hasOwn(normalizedSave, property);
    if (currentHasProperty !== sourceHasProperty
      || currentHasProperty && !equalJson(save[property], normalizedSave[property])) {
      sourceBoundSaveDrift = true;
      break;
    }
  }
  if (metadata.id !== plan.target.catalogWorldId || metadata.seed !== plan.target.worldSeed
    || save.seed !== plan.target.worldSeed
    || !equalJson(document.importSource, sourceReference)
    || sourceBoundSaveDrift
    || !equalJson(metadata.generationIdentity, plan.target.generationIdentity)
    || !equalJson(generationIdentity, plan.target.generationIdentity)) {
    fail("plan-document", "Initial StoredWorld document crossed its archived R4 projection or immutable generation target");
  }
}

function assertCurrentDocumentTarget(documentValue: StoredWorld, immutable: RustHistoricalExternalImmutableV2) {
  const document = ordinaryRecord(documentValue, "current historical StoredWorld");
  const metadata = ordinaryRecord(document.metadata, "current historical StoredWorld.metadata");
  const save = ordinaryRecord(document.save, "current historical StoredWorld.save");
  const generationIdentity = {
    schemaVersion: immutable.target.generationIdentity.schemaVersion,
    generatorHash: immutable.target.generationIdentity.generatorHash,
    terrainContentHash: immutable.target.generationIdentity.terrainContentHash,
    generationOptionsJson: immutable.target.generationIdentity.generationOptionsJson,
  };
  const derivedGenerationIdentity = deriveWorldGenerationIdentityV1(
    documentValue.save,
    documentValue.options,
  );
  if (metadata.id !== immutable.target.catalogWorldId || metadata.seed !== immutable.target.worldSeed
    || save.seed !== immutable.target.worldSeed
    || !equalJson(metadata.generationIdentity, generationIdentity)
    || !equalJson(derivedGenerationIdentity, generationIdentity)) {
    fail("document-target", "Current external StoredWorld crossed its immutable world, seed, or generation target");
  }
}

export async function createInitialRustHistoricalExternalDescriptorProposalV2(
  plan: RustHistoricalSaveCompatibilityPlanV1,
  envelopeValue: RustHistoricalStoredWorldEnvelopeV2,
) {
  const decoded = await decodeRustHistoricalStoredWorldEnvelopeV2(envelopeValue);
  if (decoded.envelope.currentDocument.revision !== 1 || decoded.envelope.expectedPreviousDocument !== null) {
    fail("initial-envelope", "Initial historical descriptor proposal requires external document revision one");
  }
  assertInitialDocumentMatchesPlan(decoded.document, plan);
  const immutable = immutableFromPlan(plan, decoded.envelope.initialDocument);
  if (!equalJson(decoded.envelope.source, sourceReferenceFromDescriptor(immutable.source))) {
    fail("plan-source", "Initial StoredWorld archive source differs from its compatibility plan");
  }
  return createRustHistoricalExternalDescriptorProposalV2({
    immutable,
    currentDocument: decoded.envelope.currentDocument,
    expectedPreviousDocument: decoded.envelope.expectedPreviousDocument,
    chunks: envelopeFingerprints(decoded.envelope),
  });
}

export async function advanceRustHistoricalExternalDescriptorProposalV2(
  previousValue: RustHistoricalExternalDescriptorV2,
  envelopeValue: RustHistoricalStoredWorldEnvelopeV2,
) {
  const previous = assertRustHistoricalExternalDescriptorV2(previousValue);
  const decoded = await decodeRustHistoricalStoredWorldEnvelopeV2(envelopeValue);
  const expectedSource = sourceReferenceFromDescriptor(previous.immutable.source);
  if (!equalJson(decoded.envelope.source, expectedSource)
    || !equalJson(decoded.envelope.initialDocument, previous.immutable.initialDocument)
    || !equalJson(decoded.envelope.expectedPreviousDocument, previous.mutable.currentDocument)
    || decoded.envelope.currentDocument.revision !== previous.mutable.currentDocument.revision + 1) {
    fail("cas-conflict", "Successor historical descriptor proposal does not bind the exact durable external head");
  }
  assertCurrentDocumentTarget(decoded.document, previous.immutable);
  return createRustHistoricalExternalDescriptorProposalV2({
    immutable: previous.immutable,
    currentDocument: decoded.envelope.currentDocument,
    expectedPreviousDocument: decoded.envelope.expectedPreviousDocument,
    chunks: envelopeFingerprints(decoded.envelope),
  });
}

export async function assertRustHistoricalExternalDescriptorEnvelopeV2(
  descriptorValue: RustHistoricalExternalDescriptorV2,
  envelopeValue: RustHistoricalStoredWorldEnvelopeV2,
) {
  const descriptor = assertRustHistoricalExternalDescriptorV2(descriptorValue);
  const decoded = await decodeRustHistoricalStoredWorldEnvelopeV2(envelopeValue);
  const source = sourceReferenceFromDescriptor(descriptor.immutable.source);
  if (!equalJson(source, decoded.envelope.source)
    || !equalJson(descriptor.immutable.initialDocument, decoded.envelope.initialDocument)
    || !equalJson(descriptor.mutable.currentDocument, decoded.envelope.currentDocument)
    || !equalJson(descriptor.mutable.expectedPreviousDocument, decoded.envelope.expectedPreviousDocument)
    || !equalJson(descriptor.mutable.chunks, envelopeFingerprints(decoded.envelope))
    || descriptor.mutable.chunkSetHash !== decoded.envelope.chunkSetHash) {
    fail("descriptor-envelope", "Persisted historical descriptor differs from exact external StoredWorld custody");
  }
  assertCurrentDocumentTarget(decoded.document, descriptor.immutable);
  return decoded;
}

/** Recovery guard: compare BWHE immutable custody to a freshly revalidated plan. */
export async function assertRustHistoricalExternalDescriptorPlanV2(
  descriptorValue: RustHistoricalExternalDescriptorV2,
  plan: RustHistoricalSaveCompatibilityPlanV1,
  envelopeValue: RustHistoricalStoredWorldEnvelopeV2,
) {
  const descriptor = assertRustHistoricalExternalDescriptorV2(descriptorValue);
  const decoded = await assertRustHistoricalExternalDescriptorEnvelopeV2(descriptor, envelopeValue);
  const expected = immutableFromPlan(plan, decoded.envelope.initialDocument);
  if (!equalJson(descriptor.immutable, expected)) {
    fail("descriptor-plan", "Persisted historical descriptor differs from the freshly revalidated source, target, plan, or custody root");
  }
  if (descriptor.mutable.currentDocument.revision === 1) assertInitialDocumentMatchesPlan(decoded.document, plan);
  return Object.freeze({ descriptor, ...decoded });
}
