import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import {
  PERSISTENCE_MAX_RECORD_BYTES_V1,
  PERSISTENCE_MAX_MUTATIONS_V1,
  PERSISTENCE_MAX_TRANSACTION_BYTES_V1,
  PERSISTENCE_RECORD_KIND_ORDER_V1,
  PERSISTENCE_SCHEMA_V1,
  createPersistenceCheckpointV1,
  createPersistenceTransactionV1,
  type PersistenceCheckpointV1,
  type PersistenceMutationV1,
  type PersistenceRecordAddressV1,
  type PersistenceTransactionV1,
} from "./persistence-journal-contract";

/** Rust-authoritative, browser-platform persistence boundary. */
export const RUST_PERSISTENCE_BROWSER_PROTOCOL_V1 = 1 as const;
export const RUST_PERSISTENCE_BROWSER_HEADER_BYTES_V1 = 36;
export const RUST_PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1 = 256 * 1024 * 1024;
export const RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1 = 4 * 1024 * 1024;
export const RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_OVERHEAD_BYTES_V1 = 64 * 1024;
export const RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1 =
  PERSISTENCE_MAX_RECORD_BYTES_V1 + RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_OVERHEAD_BYTES_V1;
export const RUST_PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1 = 4_096;

const REQUEST_MAGIC = "BWPR";
const RESPONSE_MAGIC = "BWPA";
const PERSISTENCE_WIRE_MAGIC = "BWPS";
const PERSISTENCE_WIRE_HEADER_BYTES = 28;
const PERSISTENCE_MAX_CHECKPOINT_RECORDS_V1 = 1_000_000;
const ZERO_HASH = "00000000000000000000000000000000";

export const RUST_PERSISTENCE_PLATFORM_OPERATIONS_V1 = Object.freeze({
  "recover-head": 4,
  "read-recovery-page": 5,
  estimate: 6,
  compact: 7,
  "delete-world": 8,
  "preserve-legacy-backup-chunk": 9,
  "export-page": 10,
  "import-chunk": 11,
  "finalize-import": 12,
} as const);

export type RustPersistencePlatformOperationV1 = keyof typeof RUST_PERSISTENCE_PLATFORM_OPERATIONS_V1;
export type RustPersistencePlatformCodeV1 = "accepted" | "empty" | "conflict" | "quota" | "corrupt" | "unavailable";

export type RustPersistencePlatformRequestV1 = Readonly<{
  kind: "platform";
  requestId: number;
  operation: RustPersistencePlatformOperationV1;
  worldId: string;
  objectId: string;
  expectedHeadHash: string | null;
  cursor: number;
  limit: number;
  totalBytes: number;
  payloadHash: string;
  payload: Uint8Array;
}>;

export type RustPersistenceRequestV1 =
  | Readonly<{ kind: "commit"; requestId: number; transaction: PersistenceTransactionV1; checkpoint: PersistenceCheckpointV1 }>
  | Readonly<{ kind: "recover-latest"; requestId: number; worldId: string }>
  | Readonly<{ kind: "read-checkpoint"; requestId: number; worldId: string; checkpointId: string }>
  | RustPersistencePlatformRequestV1;

export type RustPersistenceCommitCodeV1 = "committed" | "stale-sequence" | "record-conflict" | "quota" | "corrupt" | "unavailable";
export type RustPersistenceCommitResponseV1 = Readonly<{
  kind: "commit";
  requestId: number;
  code: RustPersistenceCommitCodeV1;
  transactionId: string;
  journalSequence: number;
  durableHash: string;
  checkpointHash: string;
  verifiedReadback: boolean;
  message: string;
}>;

export type RustPersistenceRecoveryCodeV1 = "ready" | "empty" | "corrupt";
export type RustPersistenceRecoveryResponseV1 = Readonly<{
  kind: "recovery";
  requestId: number;
  code: RustPersistenceRecoveryCodeV1;
  worldId: string;
  checkpoint: PersistenceCheckpointV1 | null;
  recordPayloads: readonly (Uint8Array | null)[];
  missingRecordKeys: readonly string[];
  corruptRecordKeys: readonly string[];
  message: string;
}>;

export type RustPersistenceResponseV1 = RustPersistenceCommitResponseV1 | RustPersistenceRecoveryResponseV1 | Readonly<{
  kind: "error";
  requestId: number;
  code: string;
  message: string;
}> | Readonly<{
  kind: "platform";
  requestId: number;
  operation: RustPersistencePlatformOperationV1;
  code: RustPersistencePlatformCodeV1;
  storageRevision: number;
  durableHash: string;
  nextCursor: number | null;
  payload: Uint8Array;
  message: string;
}>;

export class RustPersistenceRuntimeContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RustPersistenceRuntimeContractError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function bytesToAscii(bytes: Uint8Array) { return String.fromCharCode(...bytes); }
function bytesToHex(bytes: Uint8Array) { return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(hex: string) {
  if (!/^[0-9a-f]{32}$/u.test(hex)) throw new RustPersistenceRuntimeContractError("hash", "hash must be 128-bit lowercase hex");
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function canonicalWireHash(domain: string, payload: Uint8Array) {
  return new TypeScriptCanonicalHasher(domain).writeBytes(payload).finishHex();
}

const PLATFORM_OPERATION_BY_TAG = new Map<number, RustPersistencePlatformOperationV1>(
  Object.entries(RUST_PERSISTENCE_PLATFORM_OPERATIONS_V1).map(([operation, tag]) => [tag, operation as RustPersistencePlatformOperationV1]),
);
const PLATFORM_CODES: readonly RustPersistencePlatformCodeV1[] = Object.freeze([
  "accepted", "empty", "conflict", "quota", "corrupt", "unavailable",
]);

function platformOperation(tag: number) {
  const operation = PLATFORM_OPERATION_BY_TAG.get(tag);
  if (!operation) throw new RustPersistenceRuntimeContractError("platform-operation", "unknown persistence platform operation");
  return operation;
}

function validatePlatformRequestV1(request: RustPersistencePlatformRequestV1) {
  if (request.payload.byteLength > RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1) {
    throw new RustPersistenceRuntimeContractError("platform-size", "platform operation chunk exceeds 4 MiB");
  }
  if (canonicalWireHash("blockwild-persistence-platform-payload-v1", request.payload) !== request.payloadHash) {
    throw new RustPersistenceRuntimeContractError("corrupt", "platform request payload hash mismatch");
  }
  const empty = request.payload.byteLength === 0;
  switch (request.operation) {
    case "recover-head":
    case "estimate":
      if (!empty || request.cursor !== 0 || request.limit !== 0 || request.totalBytes !== 0 || request.expectedHeadHash !== null) {
        throw new RustPersistenceRuntimeContractError("platform-shape", "read operation contains forbidden mutation fields");
      }
      break;
    case "read-recovery-page":
      if (!request.objectId || !empty || request.expectedHeadHash !== null || request.limit < 1 || request.limit > RUST_PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1 || request.totalBytes < 1 || request.totalBytes > RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1) {
        throw new RustPersistenceRuntimeContractError("platform-shape", "recovery page request is malformed");
      }
      break;
    case "compact":
      if (!request.objectId || !empty || request.expectedHeadHash === null || request.limit > 0xffff) {
        throw new RustPersistenceRuntimeContractError("platform-shape", "compaction request is malformed");
      }
      break;
    case "delete-world":
      if (request.objectId.length !== 32 || !empty || request.cursor !== 0 || request.limit !== 0 || request.totalBytes !== 0) {
        throw new RustPersistenceRuntimeContractError("platform-shape", "world-delete request is malformed");
      }
      break;
    case "preserve-legacy-backup-chunk":
    case "import-chunk":
      if (!request.objectId || empty || request.cursor + request.payload.byteLength > request.totalBytes) {
        throw new RustPersistenceRuntimeContractError("platform-shape", "chunked write request is malformed");
      }
      break;
    case "export-page":
      if (!request.objectId || !empty || request.totalBytes < 1 || request.totalBytes > RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1) {
        throw new RustPersistenceRuntimeContractError("platform-shape", "export page request is malformed");
      }
      break;
    case "finalize-import":
      if (!request.objectId || !empty || request.expectedHeadHash === null) {
        throw new RustPersistenceRuntimeContractError("platform-shape", "finalize-import request is malformed");
      }
      break;
  }
}

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private append(bytes: Uint8Array) { this.parts.push(bytes); this.length += bytes.byteLength; }
  u8(value: number) { this.append(Uint8Array.of(value)); }
  u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); this.append(bytes); }
  u32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); this.append(bytes); }
  u64(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RustPersistenceRuntimeContractError("integer", "u64 value exceeds JavaScript's exact range");
    const bytes = new Uint8Array(8); const view = new DataView(bytes.buffer);
    view.setUint32(0, value >>> 0, true); view.setUint32(4, Math.floor(value / 0x1_0000_0000), true); this.append(bytes);
  }
  hash(value: string) { this.append(hexToBytes(value)); }
  raw(value: Uint8Array) { this.append(value); }
  bytes(value: Uint8Array) { this.u32(value.byteLength); this.append(value); }
  string(value: string) { this.bytes(encoder.encode(value)); }
  finish() { const result = new Uint8Array(this.length); let offset = 0; for (const part of this.parts) { result.set(part, offset); offset += part.byteLength; } return result; }
}

class Reader {
  private offset = 0;
  constructor(private readonly source: Uint8Array) {}
  take(length: number) {
    const end = this.offset + length;
    if (!Number.isSafeInteger(length) || length < 0 || end > this.source.byteLength) throw new RustPersistenceRuntimeContractError("truncated", "binary persistence message is truncated");
    const result = this.source.subarray(this.offset, end); this.offset = end; return result;
  }
  u8() { return this.take(1)[0]; }
  flag() { const value = this.u8(); if (value !== 0 && value !== 1) throw new RustPersistenceRuntimeContractError("flag", "persistence boolean flag is not 0 or 1"); return value === 1; }
  u16() { const bytes = this.take(2); return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, true); }
  u32() { const bytes = this.take(4); return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true); }
  u64() {
    const bytes = this.take(8); const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
    const result = view.getUint32(0, true) + view.getUint32(4, true) * 0x1_0000_0000;
    if (!Number.isSafeInteger(result)) throw new RustPersistenceRuntimeContractError("integer", "Rust u64 exceeds JavaScript's exact range");
    return result;
  }
  hash() { return bytesToHex(this.take(16)); }
  bytes(maximum = RUST_PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1) { const length = this.u32(); if (length > maximum) throw new RustPersistenceRuntimeContractError("size", "length-prefixed persistence field exceeds its budget"); return Uint8Array.from(this.take(length)); }
  string(maximum = 4096) { const bytes = this.bytes(maximum); try { return decoder.decode(bytes); } catch { throw new RustPersistenceRuntimeContractError("utf8", "persistence string is not valid UTF-8"); } }
  finish() { if (this.offset !== this.source.byteLength) throw new RustPersistenceRuntimeContractError("trailing", "binary persistence message contains trailing bytes"); }
}

function recordKind(tag: number) {
  const kind = PERSISTENCE_RECORD_KIND_ORDER_V1[tag];
  if (!kind) throw new RustPersistenceRuntimeContractError("record-kind", "unknown Rust persistence record kind");
  return kind;
}

function address(reader: Reader): PersistenceRecordAddressV1 {
  return Object.freeze({ universeId: reader.string(), locationId: reader.string(), kind: recordKind(reader.u8()), recordId: reader.string() });
}

function unwrap(message: Uint8Array, magic: string, domain: string, headerBytes: number) {
  if (!(message instanceof Uint8Array) || message.byteLength < headerBytes || message.byteLength > RUST_PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1) throw new RustPersistenceRuntimeContractError("size", "persistence message is outside its V1 bounds");
  const reader = new Reader(message);
  if (bytesToAscii(reader.take(4)) !== magic) throw new RustPersistenceRuntimeContractError("magic", "persistence message magic mismatch");
  const schema = reader.u16(); const kind = reader.u16();
  const requestId = headerBytes === RUST_PERSISTENCE_BROWSER_HEADER_BYTES_V1 ? reader.u64() : 0;
  const length = reader.u32(); const expectedHash = reader.hash();
  if (length !== message.byteLength - headerBytes) throw new RustPersistenceRuntimeContractError("length", "persistence payload length mismatch");
  const payload = reader.take(length); reader.finish();
  if (canonicalWireHash(domain, payload) !== expectedHash) throw new RustPersistenceRuntimeContractError("checksum", "persistence payload checksum mismatch");
  return Object.freeze({ schema, kind, requestId, payload });
}

function wrap(magic: string, kind: number, requestId: number, domain: string, payload: Uint8Array) {
  const writer = new Writer(); writer.raw(encoder.encode(magic)); writer.u16(RUST_PERSISTENCE_BROWSER_PROTOCOL_V1); writer.u16(kind); writer.u64(requestId); writer.u32(payload.byteLength); writer.hash(canonicalWireHash(domain, payload)); writer.raw(payload);
  const result = writer.finish();
  if (result.byteLength > RUST_PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1) throw new RustPersistenceRuntimeContractError("size", "persistence response exceeds its V1 budget");
  return result;
}

function decodeRustTransactionV1(wire: Uint8Array) {
  const outer = unwrap(wire, PERSISTENCE_WIRE_MAGIC, "blockwild-persistence-wire-v1", PERSISTENCE_WIRE_HEADER_BYTES);
  if (outer.schema !== PERSISTENCE_SCHEMA_V1 || outer.kind !== 1) throw new RustPersistenceRuntimeContractError("kind", "browser commit did not contain a Rust transaction");
  const reader = new Reader(outer.payload);
  const transactionId = reader.string(); const worldId = reader.string(); const checkpointId = reader.string();
  const expectedJournalSequence = reader.u64(); const nextJournalSequence = reader.u64(); const count = reader.u32();
  if (count < 1 || count > PERSISTENCE_MAX_MUTATIONS_V1) throw new RustPersistenceRuntimeContractError("mutation-count", "Rust transaction mutation count exceeds its V1 budget");
  const mutations: Array<Omit<Extract<PersistenceMutationV1, { operation: "put" }>, "payloadHash"> | Extract<PersistenceMutationV1, { operation: "delete" }>> = [];
  for (let index = 0; index < count; index += 1) {
    const tag = reader.u8(); const entryAddress = address(reader);
    if (tag === 1) {
      const hasExpected = reader.flag();
      const expectedRecordRevision = hasExpected ? reader.u64() : null;
      const nextRecordRevision = reader.u64();
      mutations.push({ operation: "put", address: entryAddress, expectedRecordRevision, nextRecordRevision, payload: reader.bytes(PERSISTENCE_MAX_RECORD_BYTES_V1) });
    } else if (tag === 2) {
      mutations.push({ operation: "delete", address: entryAddress, expectedRecordRevision: reader.u64(), nextRecordRevision: reader.u64() });
    } else throw new RustPersistenceRuntimeContractError("mutation", "unknown Rust journal mutation tag");
  }
  const expectedHash = reader.hash(); reader.finish();
  const transaction = createPersistenceTransactionV1({ transactionId, worldId, checkpointId, expectedJournalSequence, nextJournalSequence, mutations });
  if (transaction.transactionHash !== expectedHash) throw new RustPersistenceRuntimeContractError("hash", "Rust transaction canonical hash mismatch");
  return transaction;
}

function decodeRustCheckpointV1(wire: Uint8Array) {
  const outer = unwrap(wire, PERSISTENCE_WIRE_MAGIC, "blockwild-persistence-wire-v1", PERSISTENCE_WIRE_HEADER_BYTES);
  if (outer.schema !== PERSISTENCE_SCHEMA_V1 || outer.kind !== 2) throw new RustPersistenceRuntimeContractError("kind", "browser request did not contain a Rust checkpoint");
  const reader = new Reader(outer.payload);
  const checkpointId = reader.string(); const parentCheckpointId = reader.flag() ? reader.string() : null; const worldId = reader.string();
  const journalSequence = reader.u64(); const generatorHash = reader.hash(); const contentHash = reader.hash(); const createdAt = reader.u64(); const count = reader.u32();
  if (count > PERSISTENCE_MAX_CHECKPOINT_RECORDS_V1) throw new RustPersistenceRuntimeContractError("record-count", "Rust checkpoint record count exceeds its V1 budget");
  const records = Array.from({ length: count }, () => ({ address: address(reader), revision: reader.u64(), byteLength: reader.u32(), payloadHash: reader.hash() }));
  const expectedHash = reader.hash(); reader.finish();
  const checkpoint = createPersistenceCheckpointV1({ checkpointId, parentCheckpointId, worldId, journalSequence, generatorHash, contentHash, createdAt, records });
  if (checkpoint.checkpointHash !== expectedHash) throw new RustPersistenceRuntimeContractError("hash", "Rust checkpoint canonical hash mismatch");
  return checkpoint;
}

export function encodeRustPersistenceCheckpointWireV1(checkpoint: PersistenceCheckpointV1) {
  const payload = new Writer(); payload.string(checkpoint.checkpointId); payload.u8(checkpoint.parentCheckpointId === null ? 0 : 1); if (checkpoint.parentCheckpointId !== null) payload.string(checkpoint.parentCheckpointId);
  payload.string(checkpoint.worldId); payload.u64(checkpoint.journalSequence); payload.hash(checkpoint.generatorHash); payload.hash(checkpoint.contentHash); payload.u64(checkpoint.createdAt); payload.u32(checkpoint.records.length);
  for (const record of checkpoint.records) { payload.string(record.address.universeId); payload.string(record.address.locationId); payload.u8(PERSISTENCE_RECORD_KIND_ORDER_V1.indexOf(record.address.kind)); payload.string(record.address.recordId); payload.u64(record.revision); payload.u32(record.byteLength); payload.hash(record.payloadHash); }
  payload.hash(checkpoint.checkpointHash);
  const bytes = payload.finish(); const writer = new Writer(); writer.raw(encoder.encode(PERSISTENCE_WIRE_MAGIC)); writer.u16(PERSISTENCE_SCHEMA_V1); writer.u16(2); writer.u32(bytes.byteLength); writer.hash(canonicalWireHash("blockwild-persistence-wire-v1", bytes)); writer.raw(bytes); return writer.finish();
}

export function decodeRustPersistenceRequestV1(message: Uint8Array): RustPersistenceRequestV1 {
  const outer = unwrap(message, REQUEST_MAGIC, "blockwild-persistence-browser-runtime-v1", RUST_PERSISTENCE_BROWSER_HEADER_BYTES_V1);
  if (outer.schema !== RUST_PERSISTENCE_BROWSER_PROTOCOL_V1) throw new RustPersistenceRuntimeContractError("protocol", "unsupported Rust persistence browser protocol");
  const reader = new Reader(outer.payload);
  let result: RustPersistenceRequestV1;
  if (outer.kind === 1) {
    const transaction = decodeRustTransactionV1(reader.bytes(PERSISTENCE_MAX_TRANSACTION_BYTES_V1 + 1024 * 1024));
    const checkpoint = decodeRustCheckpointV1(reader.bytes(RUST_PERSISTENCE_BROWSER_MAX_WIRE_BYTES_V1));
    if (transaction.worldId !== checkpoint.worldId || transaction.nextJournalSequence !== checkpoint.journalSequence) throw new RustPersistenceRuntimeContractError("commit", "transaction and checkpoint do not share one durable head");
    result = Object.freeze({ kind: "commit", requestId: outer.requestId, transaction, checkpoint });
  } else if (outer.kind === 2) result = Object.freeze({ kind: "recover-latest", requestId: outer.requestId, worldId: reader.string() });
  else if (outer.kind === 3) result = Object.freeze({ kind: "read-checkpoint", requestId: outer.requestId, worldId: reader.string(), checkpointId: reader.string() });
  else if (outer.kind >= 4 && outer.kind <= 12) {
    const operation = platformOperation(outer.kind);
    const worldId = reader.string();
    const objectId = reader.string();
    const expectedHeadHash = reader.flag() ? reader.hash() : null;
    const cursor = reader.u64();
    const limit = reader.u32();
    const totalBytes = reader.u64();
    const payloadHash = reader.hash();
    const payload = reader.bytes(RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1);
    const platformRequest: RustPersistencePlatformRequestV1 = Object.freeze({
      kind: "platform", requestId: outer.requestId, operation, worldId, objectId,
      expectedHeadHash, cursor, limit, totalBytes, payloadHash, payload,
    });
    validatePlatformRequestV1(platformRequest);
    result = platformRequest;
  }
  else throw new RustPersistenceRuntimeContractError("kind", "unknown Rust persistence browser request");
  reader.finish(); return result;
}

export function encodeRustPersistenceRecoverLatestRequestV1(requestId: number, worldId: string) {
  const payload = new Writer(); payload.string(worldId);
  return wrap(REQUEST_MAGIC, 2, requestId, "blockwild-persistence-browser-runtime-v1", payload.finish());
}

export function encodeRustPersistenceReadCheckpointRequestV1(requestId: number, worldId: string, checkpointId: string) {
  const payload = new Writer(); payload.string(worldId); payload.string(checkpointId);
  return wrap(REQUEST_MAGIC, 3, requestId, "blockwild-persistence-browser-runtime-v1", payload.finish());
}

/** Exact test/tooling encoder for the Rust-selected additive BWPR operations. */
export function encodeRustPersistencePlatformRequestV1(request: RustPersistencePlatformRequestV1) {
  validatePlatformRequestV1(request);
  const payload = new Writer(); payload.string(request.worldId); payload.string(request.objectId);
  payload.u8(request.expectedHeadHash === null ? 0 : 1); if (request.expectedHeadHash !== null) payload.hash(request.expectedHeadHash);
  payload.u64(request.cursor); payload.u32(request.limit); payload.u64(request.totalBytes); payload.hash(request.payloadHash); payload.bytes(request.payload);
  return wrap(REQUEST_MAGIC, RUST_PERSISTENCE_PLATFORM_OPERATIONS_V1[request.operation], request.requestId, "blockwild-persistence-browser-runtime-v1", payload.finish());
}

const COMMIT_CODES: readonly RustPersistenceCommitCodeV1[] = Object.freeze(["committed", "stale-sequence", "record-conflict", "quota", "corrupt", "unavailable"]);
const RECOVERY_CODES: readonly RustPersistenceRecoveryCodeV1[] = Object.freeze(["ready", "empty", "corrupt"]);

function platformResponsePayloadLimitV1(operation: RustPersistencePlatformOperationV1) {
  return operation === "read-recovery-page"
    ? RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1
    : RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1;
}

function validatePlatformResponsePayloadV1(operation: RustPersistencePlatformOperationV1, payload: Uint8Array) {
  if (payload.byteLength <= platformResponsePayloadLimitV1(operation)) return;
  throw new RustPersistenceRuntimeContractError(
    "platform-size",
    operation === "read-recovery-page"
      ? "recovery page payload exceeds the 64 MiB record plus 64 KiB overhead budget"
      : "platform response payload exceeds 4 MiB",
  );
}

export function encodeRustPersistenceResponseV1(response: RustPersistenceResponseV1) {
  const payload = new Writer(); let kind: number;
  if (response.kind === "commit") {
    kind = 101; payload.u8(COMMIT_CODES.indexOf(response.code) + 1); payload.string(response.transactionId); payload.u64(response.journalSequence); payload.hash(response.durableHash); payload.hash(response.checkpointHash); payload.u8(response.verifiedReadback ? 1 : 0); payload.string(response.message);
  } else if (response.kind === "recovery") {
    if (response.recordPayloads.length > PERSISTENCE_MAX_CHECKPOINT_RECORDS_V1 || response.missingRecordKeys.length > PERSISTENCE_MAX_CHECKPOINT_RECORDS_V1 || response.corruptRecordKeys.length > PERSISTENCE_MAX_CHECKPOINT_RECORDS_V1) throw new RustPersistenceRuntimeContractError("record-count", "recovery response exceeds its V1 record budget");
    if (response.checkpoint && response.checkpoint.records.length !== response.recordPayloads.length) throw new RustPersistenceRuntimeContractError("recovery", "recovery checkpoint and record payload count disagree");
    if (!response.checkpoint && response.recordPayloads.length > 0) throw new RustPersistenceRuntimeContractError("recovery", "recovery payloads require a checkpoint");
    kind = 102; payload.u8(RECOVERY_CODES.indexOf(response.code) + 1); payload.string(response.worldId); payload.u8(response.checkpoint ? 1 : 0); if (response.checkpoint) payload.bytes(encodeRustPersistenceCheckpointWireV1(response.checkpoint));
    payload.u32(response.recordPayloads.length); for (const record of response.recordPayloads) { payload.u8(record ? 1 : 0); if (record) payload.bytes(record); }
    payload.u32(response.missingRecordKeys.length); for (const key of response.missingRecordKeys) payload.string(key);
    payload.u32(response.corruptRecordKeys.length); for (const key of response.corruptRecordKeys) payload.string(key);
    payload.string(response.message);
  } else if (response.kind === "platform") {
    validatePlatformResponsePayloadV1(response.operation, response.payload);
    if (response.code !== "accepted" && response.storageRevision !== 0) throw new RustPersistenceRuntimeContractError("platform-response", "rejected platform operation attempted to advance storage revision");
    if (response.code === "accepted" && ["compact", "delete-world", "preserve-legacy-backup-chunk", "import-chunk", "finalize-import"].includes(response.operation) && response.durableHash === ZERO_HASH) {
      throw new RustPersistenceRuntimeContractError("platform-response", "accepted durable mutation returned a zero durable hash");
    }
    kind = 110;
    payload.u16(RUST_PERSISTENCE_PLATFORM_OPERATIONS_V1[response.operation]);
    payload.u8(PLATFORM_CODES.indexOf(response.code) + 1);
    payload.u64(response.storageRevision);
    payload.hash(response.durableHash);
    payload.u8(response.nextCursor === null ? 0 : 1);
    if (response.nextCursor !== null) payload.u64(response.nextCursor);
    payload.bytes(response.payload);
    payload.string(response.message);
  } else { kind = 255; payload.string(response.code); payload.string(response.message); }
  return wrap(RESPONSE_MAGIC, kind, response.requestId, "blockwild-persistence-browser-runtime-v1", payload.finish());
}

export function decodeRustPersistenceResponseV1(message: Uint8Array): RustPersistenceResponseV1 {
  const outer = unwrap(message, RESPONSE_MAGIC, "blockwild-persistence-browser-runtime-v1", RUST_PERSISTENCE_BROWSER_HEADER_BYTES_V1);
  const reader = new Reader(outer.payload); let result: RustPersistenceResponseV1;
  if (outer.kind === 101) {
    const code = COMMIT_CODES[reader.u8() - 1]; if (!code) throw new RustPersistenceRuntimeContractError("status", "unknown commit result status");
    result = Object.freeze({ kind: "commit", requestId: outer.requestId, code, transactionId: reader.string(), journalSequence: reader.u64(), durableHash: reader.hash(), checkpointHash: reader.hash(), verifiedReadback: reader.flag(), message: reader.string() });
  } else if (outer.kind === 102) {
    const code = RECOVERY_CODES[reader.u8() - 1]; if (!code) throw new RustPersistenceRuntimeContractError("status", "unknown recovery result status");
    const worldId = reader.string(); const checkpoint = reader.flag() ? decodeRustCheckpointV1(reader.bytes()) : null; const count = reader.u32();
    if (count > PERSISTENCE_MAX_CHECKPOINT_RECORDS_V1) throw new RustPersistenceRuntimeContractError("record-count", "recovery payload count exceeds its V1 budget");
    const recordPayloads = Object.freeze(Array.from({ length: count }, () => reader.flag() ? reader.bytes(PERSISTENCE_MAX_RECORD_BYTES_V1) : null));
    const missingCount = reader.u32(); if (missingCount > PERSISTENCE_MAX_CHECKPOINT_RECORDS_V1) throw new RustPersistenceRuntimeContractError("record-count", "missing recovery key count exceeds its V1 budget"); const missingRecordKeys = Object.freeze(Array.from({ length: missingCount }, () => reader.string()));
    const corruptCount = reader.u32(); if (corruptCount > PERSISTENCE_MAX_CHECKPOINT_RECORDS_V1) throw new RustPersistenceRuntimeContractError("record-count", "corrupt recovery key count exceeds its V1 budget"); const corruptRecordKeys = Object.freeze(Array.from({ length: corruptCount }, () => reader.string()));
    if (checkpoint && (checkpoint.worldId !== worldId || checkpoint.records.length !== recordPayloads.length)) throw new RustPersistenceRuntimeContractError("recovery", "recovery checkpoint and payload list disagree");
    if (!checkpoint && recordPayloads.length > 0) throw new RustPersistenceRuntimeContractError("recovery", "recovery payloads require a checkpoint");
    result = Object.freeze({ kind: "recovery", requestId: outer.requestId, code, worldId, checkpoint, recordPayloads, missingRecordKeys, corruptRecordKeys, message: reader.string() });
  } else if (outer.kind === 110) {
    const operation = platformOperation(reader.u16());
    const code = PLATFORM_CODES[reader.u8() - 1];
    if (!code) throw new RustPersistenceRuntimeContractError("platform-status", "unknown persistence platform status");
    const storageRevision = reader.u64();
    const durableHash = reader.hash();
    const nextCursor = reader.flag() ? reader.u64() : null;
    const payload = reader.bytes(platformResponsePayloadLimitV1(operation));
    const message = reader.string();
    validatePlatformResponsePayloadV1(operation, payload);
    if (code !== "accepted" && storageRevision !== 0) throw new RustPersistenceRuntimeContractError("platform-response", "rejected platform operation attempted to advance storage revision");
    result = Object.freeze({ kind: "platform", requestId: outer.requestId, operation, code, storageRevision, durableHash, nextCursor, payload, message });
  } else if (outer.kind === 255) result = Object.freeze({ kind: "error", requestId: outer.requestId, code: reader.string(), message: reader.string() });
  else throw new RustPersistenceRuntimeContractError("kind", "unknown persistence browser response");
  reader.finish(); return result;
}

export function rustPersistenceZeroHashV1() { return ZERO_HASH; }
export function rustPersistencePlatformPayloadHashV1(payload: Uint8Array) {
  return canonicalWireHash("blockwild-persistence-platform-payload-v1", payload);
}
