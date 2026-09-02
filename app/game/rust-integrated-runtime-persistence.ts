import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec";
import { RustIntegratedRuntimeServiceError, RustIntegratedRuntimeServiceV1 } from "./rust-integrated-runtime-service";
import {
  RUST_INTEGRATED_PERSISTENCE_STATUS_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PERSISTENCE_STATUS_TYPE_V1,
} from "./rust-integrated-runtime-bulk-platform";
import { RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1 } from "./rust-persistence-runtime-contract";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated.ts";
import {
  createRustIntegratedDomainWireDescriptorV1,
  RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1,
  unwrapRustIntegratedDomainPacketV1,
  wrapRustIntegratedDomainPacketV1,
} from "./rust-integrated-runtime-domain-wire";
import { RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES } from "./rust-integrated-runtime-contract";

const DISPATCH_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("persistence-dispatch-v1");
const DISPATCH_RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("persistence-dispatch-receipt-v1");

export const RUST_INTEGRATED_PERSISTENCE_DISPATCH_TYPE_V1 = DISPATCH_SCHEMA.typeId;
export const RUST_INTEGRATED_PERSISTENCE_DISPATCH_RECEIPT_TYPE_V1 = DISPATCH_RECEIPT_SCHEMA.typeId;
export {
  RUST_INTEGRATED_PERSISTENCE_STATUS_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PERSISTENCE_STATUS_TYPE_V1,
};
/** Conservative caller chunk target; the codec also validates the complete packet. */
export const RUST_INTEGRATED_PERSISTENCE_CONTROL_MAX_BYTES_V1 = 1024 * 1024 - 64;
export const RUST_PERSISTENCE_PLATFORM_PAGE_BYTES_V1 = 4 * 1024 * 1024;

const encoder = new TextEncoder();
// A BOM is valid identifier data here, not an encoding signature. Native UTF-8
// strings retain it, so browser decoding must not silently drop it.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const HASH = /^[0-9a-f]{32}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_BINARY_BYTES = RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES - RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1;

export type RustIntegratedPersistenceDispatchV1 =
  | Readonly<{ kind: "commit"; browserRequest: Uint8Array }>
  | Readonly<{ kind: "recover"; worldId: string; checkpointId?: string }>
  | Readonly<{ kind: "read-recovery-page"; worldId: string; checkpointId: string; startRecord: number; maxRecords: number; maxBytes: number }>
  | Readonly<{ kind: "estimate"; worldId: string }>
  | Readonly<{ kind: "compact"; worldId: string; checkpointId: string; expectedHeadHash: string; retainParentCount: number }>
  | Readonly<{ kind: "delete"; worldId: string; expectedHeadHash?: string; tombstone: string }>
  | Readonly<{ kind: "preserve-legacy-backup-chunk"; worldId: string; backupId: string; offset: number; totalBytes: number; bytes: Uint8Array }>
  | Readonly<{ kind: "export-page"; worldId: string; checkpointId: string; cursor: number; maxBytes: number }>
  | Readonly<{ kind: "import-chunk"; worldId: string; importId: string; offset: number; totalBytes: number; bytes: Uint8Array }>
  | Readonly<{ kind: "finalize-import"; worldId: string; importId: string; archiveHash: string; totalBytes: number }>
  | Readonly<{ kind: "retry"; previousRequestId: number }>
  | Readonly<{ kind: "close" }>;

export type RustIntegratedPersistenceDispatchReceiptV1 = Readonly<{
  requestId: number | null;
  persistenceRevision: number;
  pending: number;
  queuedBytes: number;
  stateHash: string;
  closed: boolean;
}>;

export type RustIntegratedPersistenceStatusReceiptV1 = Readonly<{
  persistenceRevision: number;
  pending: number;
  queuedBytes: number;
  dispatcherStateHash: string;
  authorityStateHash: string;
  closed: boolean;
  terminal: boolean;
  terminalCheckpoint: Readonly<{
    checkpointId: string;
    checkpointHash: string;
    journalSequence: number;
    recordCount: number;
    saveSetHash: string;
    manifestHash: string;
  }> | null;
}>;

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private append(value: Uint8Array) { this.parts.push(value); this.length += value.byteLength; }
  u8(value: number) { this.append(Uint8Array.of(value)); }
  flag(value: boolean) { if (typeof value !== "boolean") throw new TypeError("persistence flag must be boolean"); this.u8(value ? 1 : 0); }
  u16(value: number) { integer(value, 0xffff, "u16"); const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); this.append(bytes); }
  u32(value: number) { integer(value, 0xffff_ffff, "u32"); const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); this.append(bytes); }
  u64(value: number) {
    integer(value, Number.MAX_SAFE_INTEGER, "u64");
    const bytes = new Uint8Array(8); const view = new DataView(bytes.buffer);
    view.setUint32(0, value >>> 0, true); view.setUint32(4, Math.floor(value / 0x1_0000_0000), true); this.append(bytes);
  }
  raw(value: Uint8Array) { this.append(value); }
  hash(value: string) {
    if (!HASH.test(value)) throw new Error("persistence hash must be 32 lowercase hexadecimal characters");
    this.append(Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)));
  }
  bytes(value: Uint8Array, maximum = MAX_BINARY_BYTES) {
    if (!(value instanceof Uint8Array)) throw new TypeError("persistence payload must be Uint8Array");
    if (value.byteLength > maximum) throw new Error("persistence control payload exceeds the normal BWRQ byte ceiling");
    this.u32(value.byteLength); this.append(value);
  }
  string(value: string) {
    if (typeof value !== "string" || !value || CONTROL_CHARACTER.test(value) || decoder.decode(encoder.encode(value)) !== value) {
      throw new Error("persistence identifier is empty, contains controls, or has an unpaired surrogate");
    }
    const bytes = encoder.encode(value);
    if (bytes.byteLength > 16 * 1024) throw new Error("persistence identifier exceeds its UTF-8 byte budget");
    this.bytes(bytes, 16 * 1024);
  }
  finish() { const output = new Uint8Array(this.length); let offset = 0; for (const part of this.parts) { output.set(part, offset); offset += part.byteLength; } return output; }
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  take(length: number) { const end = this.offset + length; if (end > this.bytes.byteLength) throw new Error("persistence receipt is truncated"); const value = this.bytes.subarray(this.offset, end); this.offset = end; return value; }
  u8() { return this.take(1)[0]; }
  flag() { const value = this.u8(); if (value > 1) throw new Error("persistence receipt boolean is invalid"); return value === 1; }
  u16() { const bytes = this.take(2); return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, true); }
  u32() { const bytes = this.take(4); return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true); }
  u64() { const bytes = this.take(8); const view = new DataView(bytes.buffer, bytes.byteOffset, 8); const value = view.getUint32(0, true) + view.getUint32(4, true) * 0x1_0000_0000; if (!Number.isSafeInteger(value)) throw new Error("persistence receipt u64 exceeds JavaScript exact range"); return value; }
  hash() { return [...this.take(16)].map((value) => value.toString(16).padStart(2, "0")).join(""); }
  binary() {
    const length = this.u32();
    if (length > MAX_BINARY_BYTES) throw new Error("persistence control payload exceeds the normal BWRQ byte ceiling");
    return this.take(length).slice();
  }
  string() {
    const length = this.u32();
    if (length < 1 || length > 16 * 1024) throw new Error("persistence receipt identifier exceeds its byte budget");
    const value = decoder.decode(this.take(length));
    if (CONTROL_CHARACTER.test(value) || decoder.decode(encoder.encode(value)) !== value) {
      throw new Error("persistence receipt identifier contains controls or invalid Unicode");
    }
    return value;
  }
  finish() { if (this.offset !== this.bytes.byteLength) throw new Error("persistence receipt contains trailing bytes"); }
}

function integer(value: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`persistence ${label} is outside its wire range`);
}

function wrap(magic: string, body: Uint8Array, schema = 1) {
  return wrapRustIntegratedDomainPacketV1(
    createRustIntegratedDomainWireDescriptorV1({ magic, schema, label: "persistence normal BWRQ byte ceiling" }),
    body,
    (_code, message) => { throw new Error(message); },
  );
}

function unwrap(magic: string, schema: number, packet: Uint8Array) {
  return unwrapRustIntegratedDomainPacketV1(
    createRustIntegratedDomainWireDescriptorV1({ magic, schema, label: "persistence" }),
    packet,
    (_code, message) => { throw new Error(message); },
  );
}

function writeChunk(writer: Writer, worldId: string, objectId: string, offset: number, totalBytes: number, bytes: Uint8Array) {
  if (bytes.byteLength > RUST_PERSISTENCE_PLATFORM_PAGE_BYTES_V1) throw new Error("persistence platform chunk exceeds 4 MiB");
  writer.string(worldId); writer.string(objectId); writer.u64(offset); writer.u64(totalBytes); writer.bytes(bytes);
}

export function encodeRustIntegratedPersistenceDispatchV1(value: RustIntegratedPersistenceDispatchV1) {
  const writer = new Writer();
  switch (value.kind) {
    case "commit": writer.u8(1); writer.bytes(value.browserRequest); break;
    case "recover": writer.u8(4); writer.string(value.worldId); writer.flag(value.checkpointId !== undefined); if (value.checkpointId !== undefined) writer.string(value.checkpointId); break;
    case "read-recovery-page": writer.u8(5); writer.string(value.worldId); writer.string(value.checkpointId); writer.u64(value.startRecord); writer.u32(value.maxRecords); writer.u32(value.maxBytes); break;
    case "estimate": writer.u8(6); writer.string(value.worldId); break;
    case "compact": writer.u8(7); writer.string(value.worldId); writer.string(value.checkpointId); writer.hash(value.expectedHeadHash); writer.u16(value.retainParentCount); break;
    case "delete": writer.u8(8); writer.string(value.worldId); writer.flag(value.expectedHeadHash !== undefined); if (value.expectedHeadHash !== undefined) writer.hash(value.expectedHeadHash); writer.hash(value.tombstone); break;
    case "preserve-legacy-backup-chunk": writer.u8(9); writeChunk(writer, value.worldId, value.backupId, value.offset, value.totalBytes, value.bytes); break;
    case "export-page": writer.u8(10); writer.string(value.worldId); writer.string(value.checkpointId); writer.u64(value.cursor); writer.u32(value.maxBytes); break;
    case "import-chunk": writer.u8(11); writeChunk(writer, value.worldId, value.importId, value.offset, value.totalBytes, value.bytes); break;
    case "finalize-import": writer.u8(12); writer.string(value.worldId); writer.string(value.importId); writer.hash(value.archiveHash); writer.u64(value.totalBytes); break;
    case "retry": writer.u8(13); writer.u64(value.previousRequestId); break;
    case "close": writer.u8(14); break;
    default: throw new Error("unknown persistence dispatcher operation");
  }
  return wrap(DISPATCH_SCHEMA.magic, writer.finish(), DISPATCH_SCHEMA.innerSchema);
}

/** Decode only the normal BWRQ control lane; bulk BWPR/BWPA attachments are separate. */
export function decodeRustIntegratedPersistenceDispatchV1(packet: Uint8Array): RustIntegratedPersistenceDispatchV1 {
  const reader = new Reader(unwrap(DISPATCH_SCHEMA.magic, DISPATCH_SCHEMA.innerSchema, packet));
  let value: RustIntegratedPersistenceDispatchV1;
  switch (reader.u8()) {
    case 1: value = { kind: "commit", browserRequest: reader.binary() }; break;
    case 4: {
      const worldId = reader.string();
      value = { kind: "recover", worldId, ...(reader.flag() ? { checkpointId: reader.string() } : {}) };
      break;
    }
    case 5: value = { kind: "read-recovery-page", worldId: reader.string(), checkpointId: reader.string(), startRecord: reader.u64(), maxRecords: reader.u32(), maxBytes: reader.u32() }; break;
    case 6: value = { kind: "estimate", worldId: reader.string() }; break;
    case 7: value = { kind: "compact", worldId: reader.string(), checkpointId: reader.string(), expectedHeadHash: reader.hash(), retainParentCount: reader.u16() }; break;
    case 8: {
      const worldId = reader.string();
      const expectedHeadHash = reader.flag() ? reader.hash() : undefined;
      value = { kind: "delete", worldId, ...(expectedHeadHash !== undefined ? { expectedHeadHash } : {}), tombstone: reader.hash() };
      break;
    }
    case 9: value = { kind: "preserve-legacy-backup-chunk", worldId: reader.string(), backupId: reader.string(), offset: reader.u64(), totalBytes: reader.u64(), bytes: reader.binary() }; break;
    case 10: value = { kind: "export-page", worldId: reader.string(), checkpointId: reader.string(), cursor: reader.u64(), maxBytes: reader.u32() }; break;
    case 11: value = { kind: "import-chunk", worldId: reader.string(), importId: reader.string(), offset: reader.u64(), totalBytes: reader.u64(), bytes: reader.binary() }; break;
    case 12: value = { kind: "finalize-import", worldId: reader.string(), importId: reader.string(), archiveHash: reader.hash(), totalBytes: reader.u64() }; break;
    case 13: value = { kind: "retry", previousRequestId: reader.u64() }; break;
    case 14: value = { kind: "close" }; break;
    default: throw new Error("unknown persistence dispatcher operation");
  }
  reader.finish();
  return Object.freeze(value);
}

export function encodeRustIntegratedPersistenceDispatchReceiptV1(value: RustIntegratedPersistenceDispatchReceiptV1) {
  const writer = new Writer();
  writer.flag(value.requestId !== null);
  if (value.requestId !== null) writer.u64(value.requestId);
  writer.u64(value.persistenceRevision);
  writer.u32(value.pending);
  writer.u64(value.queuedBytes);
  writer.hash(value.stateHash);
  writer.flag(value.closed);
  return wrap(DISPATCH_RECEIPT_SCHEMA.magic, writer.finish(), DISPATCH_RECEIPT_SCHEMA.innerSchema);
}

export function decodeRustIntegratedPersistenceDispatchReceiptV1(packet: Uint8Array): RustIntegratedPersistenceDispatchReceiptV1 {
  const bodyReader = new Reader(unwrap(DISPATCH_RECEIPT_SCHEMA.magic, DISPATCH_RECEIPT_SCHEMA.innerSchema, packet));
  const hasRequestId = bodyReader.flag();
  const receipt = Object.freeze({
    requestId: hasRequestId ? bodyReader.u64() : null,
    persistenceRevision: bodyReader.u64(),
    pending: bodyReader.u32(),
    queuedBytes: bodyReader.u64(),
    stateHash: bodyReader.hash(),
    closed: bodyReader.flag(),
  });
  bodyReader.finish(); return receipt;
}

export function encodeRustIntegratedPersistenceStatusQueryV1() {
  return wrap("BWS8", new Uint8Array());
}

export function decodeRustIntegratedPersistenceStatusReceiptV1(packet: Uint8Array): RustIntegratedPersistenceStatusReceiptV1 {
  const reader = new Reader(packet);
  if (decoder.decode(reader.take(4)) !== "BWT8" || reader.u16() !== 1 || reader.u16() !== 1) throw new Error("persistence status receipt header mismatch");
  const bodyLength = reader.u32(); const checksum = reader.hash(); const body = reader.take(bodyLength); reader.finish();
  if (rustIntegratedRuntimeWireChecksumV1(body) !== checksum) throw new Error("persistence status receipt checksum mismatch");
  const bodyReader = new Reader(body);
  const persistenceRevision = bodyReader.u64();
  const pending = bodyReader.u32();
  const queuedBytes = bodyReader.u64();
  const dispatcherStateHash = bodyReader.hash();
  const authorityStateHash = bodyReader.hash();
  const closed = bodyReader.flag();
  const terminalCheckpoint = bodyReader.flag() ? Object.freeze({
    checkpointId: bodyReader.string(),
    checkpointHash: bodyReader.hash(),
    journalSequence: bodyReader.u64(),
    recordCount: bodyReader.u32(),
    saveSetHash: bodyReader.hash(),
    manifestHash: bodyReader.hash(),
  }) : null;
  bodyReader.finish();
  return Object.freeze({
    persistenceRevision,
    pending,
    queuedBytes,
    dispatcherStateHash,
    authorityStateHash,
    closed,
    terminal: terminalCheckpoint !== null,
    terminalCheckpoint,
  });
}

/** Coarse awaited control port; actual BWPR/BWPA bytes use the bulk pump. */
export class RustIntegratedPersistenceRuntimePortV1 {
  private serial = Promise.resolve<unknown>(undefined);
  private nextCommand = 1;
  constructor(private readonly runtime: RustIntegratedRuntimeServiceV1, private readonly actorId = "platform:persistence") {}

  dispatch(value: RustIntegratedPersistenceDispatchV1, idempotencyKey?: string) {
    const payload = encodeRustIntegratedPersistenceDispatchV1(value);
    const sequence = this.nextCommand++;
    const key = idempotencyKey ?? `persistence:${sequence}:${rustIntegratedRuntimeWireChecksumV1(payload)}`;
    return this.enqueue(async () => {
      const operation = createRustIntegratedRuntimeDomainOperationV1({ domain: "persistence", typeId: RUST_INTEGRATED_PERSISTENCE_DISPATCH_TYPE_V1, schema: DISPATCH_SCHEMA.operationSchema, payload });
      const batch = createRustIntegratedRuntimeCommandBatchV1({ commandId: key, idempotencyKey: key, actorId: this.actorId, expected: this.runtime.identity(), operations: [operation] });
      const receipt = await this.runtime.command(batch);
      if (receipt.status === "rejected") throw new RustIntegratedRuntimeServiceError("invalid-response", `${receipt.code}: ${receipt.message}`);
      const response = receipt.domainReceipts[0];
      if (receipt.domainReceipts.length !== 1 || response.domain !== "persistence"
        || response.typeId !== RUST_INTEGRATED_PERSISTENCE_DISPATCH_RECEIPT_TYPE_V1
        || response.schema !== DISPATCH_RECEIPT_SCHEMA.operationSchema) {
        throw new Error("integrated persistence dispatch returned the wrong native receipt");
      }
      return decodeRustIntegratedPersistenceDispatchReceiptV1(response.payload);
    });
  }

  status() {
    const payload = encodeRustIntegratedPersistenceStatusQueryV1();
    return this.enqueue(async () => {
      const receipt = await this.runtime.persistenceStatus(payload);
      return decodeRustIntegratedPersistenceStatusReceiptV1(receipt);
    });
  }

  commit(browserRequest: Uint8Array, key?: string) { return this.dispatch({ kind: "commit", browserRequest }, key); }
  recover(worldId: string, checkpointId?: string) { return this.dispatch({ kind: "recover", worldId, checkpointId }); }
  readRecoveryPage(worldId: string, checkpointId: string, startRecord: number, maxRecords: number, maxBytes = RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1) { return this.dispatch({ kind: "read-recovery-page", worldId, checkpointId, startRecord, maxRecords, maxBytes }); }
  estimate(worldId: string) { return this.dispatch({ kind: "estimate", worldId }); }
  compact(worldId: string, checkpointId: string, expectedHeadHash: string, retainParentCount: number, key?: string) { return this.dispatch({ kind: "compact", worldId, checkpointId, expectedHeadHash, retainParentCount }, key); }
  delete(worldId: string, tombstone: string, expectedHeadHash?: string, key?: string) { return this.dispatch({ kind: "delete", worldId, expectedHeadHash, tombstone }, key); }
  preserveLegacyBackupChunk(worldId: string, backupId: string, offset: number, totalBytes: number, bytes: Uint8Array, key?: string) { return this.dispatch({ kind: "preserve-legacy-backup-chunk", worldId, backupId, offset, totalBytes, bytes }, key); }
  exportPage(worldId: string, checkpointId: string, cursor: number, maxBytes = RUST_PERSISTENCE_PLATFORM_PAGE_BYTES_V1) { return this.dispatch({ kind: "export-page", worldId, checkpointId, cursor, maxBytes }); }
  importChunk(worldId: string, importId: string, offset: number, totalBytes: number, bytes: Uint8Array, key?: string) { return this.dispatch({ kind: "import-chunk", worldId, importId, offset, totalBytes, bytes }, key); }
  finalizeImport(worldId: string, importId: string, archiveHash: string, totalBytes: number, key?: string) { return this.dispatch({ kind: "finalize-import", worldId, importId, archiveHash, totalBytes }, key); }
  retry(previousRequestId: number) { return this.dispatch({ kind: "retry", previousRequestId }); }
  close() { return this.dispatch({ kind: "close" }); }

  private enqueue<T>(work: () => Promise<T>) { const next = this.serial.then(work, work); this.serial = next.then(() => undefined, () => undefined); return next; }
}
