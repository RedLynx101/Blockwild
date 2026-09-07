import {
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec";
import type {
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeRevisionV1,
} from "./rust-integrated-runtime-contract";

/**
 * Detached bulk-platform lane for R8 browser persistence.
 *
 * BWRQ/BWRS stays capped at 8 MiB/1 MiB per domain operation. A complete
 * BWPR/BWPA message instead travels as one transferred attachment beside this
 * small, checksummed control envelope. The lane never decodes persistence
 * records and cannot make a journal, recovery, or gameplay decision.
 */
export const RUST_INTEGRATED_RUNTIME_BULK_WIRE_V1 = 1 as const;
export const RUST_INTEGRATED_RUNTIME_BULK_SCHEMA_V2 = 2 as const;
export const RUST_INTEGRATED_RUNTIME_BULK_HEADER_BYTES_V1 = 64;
export const RUST_INTEGRATED_RUNTIME_BULK_MAX_CONTROL_BYTES_V1 = 16 * 1024;
export const RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1 = 1024 * 1024;
export const RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1 = 256 * 1024 * 1024;
export const RUST_INTEGRATED_RUNTIME_BULK_PERSISTENCE_MAX_PACKET_BYTES_V1 = 128 * 1024 * 1024;
export const RUST_INTEGRATED_RUNTIME_BULK_MAX_PENDING_V1 = 2;
export const RUST_INTEGRATED_RUNTIME_BULK_MAX_QUEUED_BYTES_V1 = 256 * 1024 * 1024;
export const RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1 = 4 * 1024 * 1024;
export const RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1 = 64;
export const RUST_INTEGRATED_RUNTIME_BULK_PERSISTENCE_STATUS_BYTES_V1 = 4 * 1024;
export const RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_MAX_BYTES_V1 = 32 * 1024 * 1024;
export const RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_MAX_BYTES_V2 = 1024 * 1024;
export const RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PRIOR_CHECKPOINT_MAX_BYTES_V2 = 1024 * 1024;
export const RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_MAX_BYTES_V2 = 64 * 1024;
export const RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_MAX_BYTES_V2 = 4 * 1024 * 1024;

export const RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1 = "blockwild.persistence.browser-request.r8.v1";
export const RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1 = "blockwild.persistence.browser-response.r8.v1";
export const RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_STAGE_CHUNK_TYPE_V1 = "blockwild.persistence.compatibility-stage-chunk.r8.v1";
export const RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1 = "blockwild.persistence.compatibility-hydration-chunk.r8.v1";
export const RUST_INTEGRATED_PERSISTENCE_STATUS_TYPE_V1 = "blockwild.persistence.status.r8.v1";
export const RUST_INTEGRATED_PERSISTENCE_STATUS_RECEIPT_TYPE_V1 = "blockwild.persistence.status-receipt.r8.v1";
export const RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1 = "blockwild.runtime.legacy-world-projection.r8.v1";
export const RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2 =
  "blockwild.persistence.historical-external-proposal.r8.v2";
export const RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2 =
  "blockwild.persistence.historical-external-receipt.r8.v2";
export const RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_TYPE_V2 =
  "blockwild.persistence.historical-fallback-observation.r8.v2";

const REQUEST_MAGIC = Uint8Array.of(0x42, 0x57, 0x52, 0x42); // BWRB
const RESPONSE_MAGIC = Uint8Array.of(0x42, 0x57, 0x52, 0x43); // BWRC
const HISTORICAL_EXTERNAL_RECEIPT_MAGIC_V2 = Uint8Array.of(0x42, 0x57, 0x48, 0x52); // BWHR
const HISTORICAL_EXTERNAL_RECEIPT_SCHEMA_V2 = 2;
const HISTORICAL_EXTERNAL_PROFILE_TAG_V2 = 1;
const HISTORICAL_EXTERNAL_NATIVE_ADOPTION_FLAGS_V2 = 0;
const HISTORICAL_EXTERNAL_KNOWN_STATE_FLAGS_V2 = 0x007f;
const EMPTY_HASH = rustIntegratedRuntimeWireChecksumV1(new Uint8Array());
const TYPE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,159}$/u;
const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const U64_MAX_SAFE = Number.MAX_SAFE_INTEGER;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type RustIntegratedRuntimeBulkStateV1 = Readonly<{
  revision: RustIntegratedRuntimeRevisionV1;
  tick: number;
  stateHash: string;
}>;

export type RustIntegratedRuntimeBulkRequestV1 =
  | Readonly<{
    type: "runtime-bulk-poll-v1";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    maxBytes: number;
  }>
  | Readonly<{
    type: "runtime-bulk-complete-v1";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    transferToken: number;
    typeId: typeof RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1;
    payload: Uint8Array;
  }>
  | Readonly<{
    type: "runtime-bulk-stage-save-chunk-v1";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    stageId: string;
    chunkIndex: number;
    chunkCount: number;
    totalBytes: number;
    payload: Uint8Array;
  }>
  | Readonly<{
    type: "runtime-bulk-finalize-save-v1";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    stageId: string;
    createdAt: number;
  }>
  | Readonly<{
    type: "runtime-bulk-hydrate-recovery-v1";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    recoveryId: string;
  }>
  | Readonly<{
    type: "runtime-bulk-read-hydrated-compatibility-v1";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    recoveryId: string;
    chunkIndex: number;
  }>
  | Readonly<{
    type: "runtime-bulk-cancel-save-stage-v1";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    stageId: string;
  }>
  | Readonly<{
    /** Routes the normal FinalizeSave control shape to the native-only Wasm entrypoint. */
    type: "runtime-bulk-initialize-native-save-v1";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    saveId: string;
    createdAt: number;
  }>
  | Readonly<{
    type: "runtime-bulk-persistence-status-v1";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    typeId: typeof RUST_INTEGRATED_PERSISTENCE_STATUS_TYPE_V1;
    payload: Uint8Array;
  }>
  | Readonly<{
    /** Dedicated world-only migration; rich legacy flags are rejected by Rust without consuming the staged source. */
    type: "runtime-bulk-migrate-legacy-world-v1";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    stageId: string;
    createdAt: number;
    legacyNonWorldStateFlags: number;
    sourceKey: string;
    sourceFormat: string;
    typeId: typeof RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1;
    worldProjection: Uint8Array;
  }>
  | Readonly<{
    /** Op 11: adopts BWAS into R4 while every richer property remains in the staged opaque document. */
    type: "runtime-bulk-migrate-historical-external-v2";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    stageId: string;
    createdAt: number;
    proposalTypeId: typeof RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2;
    proposal: Uint8Array;
    worldProjectionTypeId: typeof RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1;
    worldProjection: Uint8Array;
  }>
  | Readonly<{
    /** Op 12: CAS-advances an existing external document and its descriptor beside current R4. */
    type: "runtime-bulk-finalize-historical-external-save-v2";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    stageId: string;
    createdAt: number;
    proposalTypeId: typeof RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2;
    proposal: Uint8Array;
    expectedPriorCheckpointBytes: Uint8Array;
  }>
  | Readonly<{
    /** Op 13: hydrates and attests an exact native-R4/external-document recovery pair. */
    type: "runtime-bulk-hydrate-historical-external-v2";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    recoveryId: string;
  }>
  | Readonly<{
    /** Op 14: atomically reconciles a physically corrupt latest head from its verified direct parent. */
    type: "runtime-bulk-reconcile-historical-external-fallback-v2";
    requestId: number;
    clientEpoch: number;
    expected: RustIntegratedRuntimeBulkStateV1;
    fallbackRecoveryId: string;
    createdAt: number;
    observationTypeId: typeof RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_TYPE_V2;
    observation: Uint8Array;
  }>;

export type RustIntegratedRuntimeBulkSaveStageStateV1 = "staged" | "finalized" | "cancelled";

export type RustIntegratedRuntimeLegacyMigrationAttestationV1 = Readonly<{
  migrationId: string;
  createdAt: number;
  sourceKey: string;
  sourceFormat: string;
  sourceByteLength: number;
  sourceHash: string;
  projectionHash: string;
  projectionEditCount: number;
  projectionFacingCount: number;
  nativeWorldSemanticHash: string;
  nativeWorldEditCount: number;
  nativeWorldFacingCount: number;
  worldId: string;
  universeId: string;
  locationId: string;
  worldSeed: string;
  generatorHash: string;
  contentHash: string;
  terrainContentHash: string;
  generationOptionsHash: string;
  backupByteLength: number;
  backupHash: string;
  backupChunks: number;
  nativeRecordSetHash: string;
  descriptorHash: string;
  saveSetHash: string;
  manifestHash: string;
}>;

export type RustIntegratedRuntimeHistoricalExternalReconciliationV2 = Readonly<{
  observationHash: string;
  expectedStorageRevision: number;
  observedLatestCheckpointId: string;
  observedLatestCheckpointHash: string;
  observedLatestJournalSequence: number;
  fallbackCheckpointId: string;
  fallbackCheckpointHash: string;
  fallbackJournalSequence: number;
  targetCheckpointId: string;
  targetCheckpointHash: string;
  targetJournalSequence: number;
  planHash: string;
}>;

export type RustIntegratedRuntimeHistoricalExternalReceiptV2 = Readonly<{
  operation: "initial-migration" | "external-save" | "recovery" | "reconciliation";
  stageId: string | null;
  recoveryId: string | null;
  createdAt: number;
  authorityProfile: "typescript-historical-save-compatibility-v1";
  nativePlayer: "off";
  nativeRichState: "not-adopted";
  externalStateFlags: number;
  descriptorHash: string;
  externalDocumentHash: string;
  externalDocumentByteLength: number;
  externalDocumentRevision: number;
  externalChunkCount: number;
  externalChunkSetHash: string;
  projectionHash: string;
  projectionByteLength: number;
  nativeWorldSemanticHash: string;
  nativeWorldEditCount: number;
  nativeWorldFacingCount: number;
  saveSetHash: string;
  manifestHash: string;
  dispatcherRequestId: number;
  remainingDirtyRecords: number;
  reconciliation: RustIntegratedRuntimeHistoricalExternalReconciliationV2 | null;
}>;

export type RustIntegratedRuntimeBulkResponseV1 =
  | Readonly<{
    type: "runtime-bulk-empty-v1";
    requestId: number;
    clientEpoch: number;
    workerEpoch: number;
    current: RustIntegratedRuntimeBulkStateV1;
  }>
  | Readonly<{
    type: "runtime-bulk-platform-request-v1";
    requestId: number;
    clientEpoch: number;
    workerEpoch: number;
    current: RustIntegratedRuntimeBulkStateV1;
    transferToken: number;
    typeId: typeof RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1;
    payload: Uint8Array;
  }>
  | Readonly<{
    type: "runtime-bulk-completed-v1";
    requestId: number;
    clientEpoch: number;
    workerEpoch: number;
    current: RustIntegratedRuntimeBulkStateV1;
    transferToken: number;
    resultHash: string;
  }>
  | Readonly<{
    type: "runtime-bulk-save-progress-v1";
    requestId: number;
    clientEpoch: number;
    workerEpoch: number;
    current: RustIntegratedRuntimeBulkStateV1;
    stageId: string;
    state: RustIntegratedRuntimeBulkSaveStageStateV1;
    receivedChunks: number;
    chunkCount: number;
    receivedBytes: number;
    setHash: string;
    manifestHash: string;
    dispatcherRequestId: number;
    remainingDirtyRecords: number;
  }>
  | Readonly<{
    type: "runtime-bulk-hydration-v1";
    requestId: number;
    clientEpoch: number;
    workerEpoch: number;
    current: RustIntegratedRuntimeBulkStateV1;
    recoveryId: string;
    nativeDomains: number;
    chunkCount: number;
    totalBytes: number;
    compatibilityHash: string;
    legacyMigration: RustIntegratedRuntimeLegacyMigrationAttestationV1 | null;
  }>
  | Readonly<{
    type: "runtime-bulk-data-v1";
    requestId: number;
    clientEpoch: number;
    workerEpoch: number;
    current: RustIntegratedRuntimeBulkStateV1;
    transferToken: number;
    typeId:
      | typeof RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1
      | typeof RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2;
    chunkIndex: number;
    chunkCount: number;
    payload: Uint8Array;
  }>
  | Readonly<{
    type: "runtime-bulk-persistence-status-v1";
    requestId: number;
    clientEpoch: number;
    workerEpoch: number;
    current: RustIntegratedRuntimeBulkStateV1;
    typeId: typeof RUST_INTEGRATED_PERSISTENCE_STATUS_RECEIPT_TYPE_V1;
    payload: Uint8Array;
  }>
  | Readonly<{
    type: "runtime-bulk-error-v1";
    requestId: number;
    clientEpoch: number;
    workerEpoch: number;
    code: string;
    message: string;
    current: RustIntegratedRuntimeBulkStateV1 | null;
  }>;

export type RustIntegratedRuntimeBulkEncodedV1 = Readonly<{
  control: Uint8Array;
  attachment: Uint8Array;
  transfer: readonly ArrayBuffer[];
  copiedInputBytes: number;
}>;

export type RustIntegratedRuntimeBulkTransportDiagnosticsV1 = Readonly<{
  pending: number;
  queuedBytes: number;
  peakQueuedBytes: number;
  requests: number;
  routineRequests: number;
  recoveryScaleRequests: number;
  backpressureRejects: number;
  copiedInputBytes: number;
  transferredInputBytes: number;
  transferredOutputBytes: number;
}>;

export interface RustIntegratedRuntimeBulkTransportV1 {
  requestBulk(request: RustIntegratedRuntimeBulkRequestV1): Promise<RustIntegratedRuntimeBulkResponseV1>;
  bulkDiagnostics(): RustIntegratedRuntimeBulkTransportDiagnosticsV1;
}

export class RustIntegratedRuntimeBulkCodecError extends Error {
  readonly name = "RustIntegratedRuntimeBulkCodecError";

  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function integer(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RustIntegratedRuntimeBulkCodecError("integer", `${label} is outside ${minimum}..${maximum}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function hash(value: string, label: string) {
  if (!HASH_PATTERN.test(value)) throw new RustIntegratedRuntimeBulkCodecError("hash", `${label} must be lowercase 128-bit hex`);
  return value;
}

function toHashBytes(value: string, label: string) {
  hash(value, label);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function fromHashBytes(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function wellFormed(value: string, label: string) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) throw new RustIntegratedRuntimeBulkCodecError("unicode", `${label} contains an unpaired surrogate`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new RustIntegratedRuntimeBulkCodecError("unicode", `${label} contains an unpaired surrogate`);
    }
  }
  return value;
}

function typeId(value: string, expected: string) {
  if (value !== expected || !TYPE_ID_PATTERN.test(value)) {
    throw new RustIntegratedRuntimeBulkCodecError("type-id", `bulk platform type must be ${expected}`);
  }
  return value;
}

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private add(bytes: Uint8Array) { this.parts.push(bytes); this.length += bytes.byteLength; }
  raw(bytes: Uint8Array) { this.add(bytes); }
  u8(value: number) { this.add(Uint8Array.of(integer(value, 0, 0xff, "u8"))); }
  u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, integer(value, 0, 0xffff, "u16"), true); this.add(bytes); }
  u32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, integer(value, 0, 0xffff_ffff, "u32"), true); this.add(bytes); }
  u64(value: number) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, BigInt(integer(value, 0, U64_MAX_SAFE, "u64")), true); this.add(bytes); }
  hash(value: string, label: string) { this.add(toHashBytes(value, label)); }
  string(value: string, label: string, maximum: number) {
    const bytes = encoder.encode(wellFormed(value, label));
    if (bytes.byteLength < 1 || bytes.byteLength > maximum) throw new RustIntegratedRuntimeBulkCodecError("string", `${label} exceeds its byte budget`);
    this.u16(bytes.byteLength); this.add(bytes);
  }
  bytes(value: Uint8Array, label: string, maximum: number) {
    if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > maximum) {
      throw new RustIntegratedRuntimeBulkCodecError("bytes", `${label} exceeds its byte budget`);
    }
    this.u16(value.byteLength); this.add(value);
  }
  state(value: RustIntegratedRuntimeBulkStateV1) {
    for (const revision of [
      value.revision.epoch, value.revision.world, value.revision.entities, value.revision.gameplay,
      value.revision.persistence, value.revision.network, value.revision.simulation,
    ]) this.u64(revision);
    this.u64(value.tick);
    this.hash(value.stateHash, "bulk state hash");
  }
  finish() {
    if (this.length > RUST_INTEGRATED_RUNTIME_BULK_MAX_CONTROL_BYTES_V1 - RUST_INTEGRATED_RUNTIME_BULK_HEADER_BYTES_V1) {
      throw new RustIntegratedRuntimeBulkCodecError("control-capacity", "bulk control body exceeds its byte budget");
    }
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) { output.set(part, offset); offset += part.byteLength; }
    return output;
  }
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  take(length: number) {
    const end = this.offset + integer(length, 0, RUST_INTEGRATED_RUNTIME_BULK_MAX_CONTROL_BYTES_V1, "read length");
    if (end > this.bytes.byteLength) throw new RustIntegratedRuntimeBulkCodecError("truncated", "bulk control body is truncated");
    const value = this.bytes.subarray(this.offset, end); this.offset = end; return value;
  }
  u8() { return this.take(1)[0]; }
  u16() { const value = this.take(2); return new DataView(value.buffer, value.byteOffset, 2).getUint16(0, true); }
  u32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, true); }
  u64() {
    const bytes = this.take(8);
    const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
    if (value > BigInt(U64_MAX_SAFE)) throw new RustIntegratedRuntimeBulkCodecError("integer", "bulk u64 exceeds JavaScript's exact range");
    return Number(value);
  }
  hash() { return fromHashBytes(this.take(16)); }
  string(label: string, maximum: number) {
    const length = this.u16();
    if (length < 1 || length > maximum) throw new RustIntegratedRuntimeBulkCodecError("string", `${label} exceeds its byte budget`);
    try { return wellFormed(decoder.decode(this.take(length)), label); }
    catch (error) { if (error instanceof RustIntegratedRuntimeBulkCodecError) throw error; throw new RustIntegratedRuntimeBulkCodecError("unicode", `${label} is not valid UTF-8`); }
  }
  inlineBytes(label: string, maximum: number) {
    const length = this.u16();
    if (length < 1 || length > maximum) throw new RustIntegratedRuntimeBulkCodecError("bytes", `${label} exceeds its byte budget`);
    return Uint8Array.from(this.take(length));
  }
  state(): RustIntegratedRuntimeBulkStateV1 {
    return Object.freeze({
      revision: Object.freeze({ epoch: this.u64(), world: this.u64(), entities: this.u64(), gameplay: this.u64(), persistence: this.u64(), network: this.u64(), simulation: this.u64() }),
      tick: this.u64(),
      stateHash: this.hash(),
    });
  }
  finish() { if (this.offset !== this.bytes.byteLength) throw new RustIntegratedRuntimeBulkCodecError("trailing", "bulk control body contains trailing bytes"); }
}

export function encodeRustIntegratedRuntimeHistoricalExternalReceiptV2(
  receipt: RustIntegratedRuntimeHistoricalExternalReceiptV2,
) {
  const body = new Writer();
  body.raw(HISTORICAL_EXTERNAL_RECEIPT_MAGIC_V2);
  body.u16(HISTORICAL_EXTERNAL_RECEIPT_SCHEMA_V2);
  const operationTag = receipt.operation === "initial-migration"
    ? 1
    : receipt.operation === "external-save"
      ? 2
      : receipt.operation === "recovery" ? 3 : 4;
  body.u8(operationTag);
  body.u8(HISTORICAL_EXTERNAL_PROFILE_TAG_V2);
  body.u8(HISTORICAL_EXTERNAL_NATIVE_ADOPTION_FLAGS_V2);
  body.u8(0);
  body.u16(integer(
    receipt.externalStateFlags,
    1,
    HISTORICAL_EXTERNAL_KNOWN_STATE_FLAGS_V2,
    "historical external state flags",
  ));
  const recoveryOperation = operationTag === 3 || operationTag === 4;
  const operationId = recoveryOperation ? receipt.recoveryId : receipt.stageId;
  if (!operationId
    || (recoveryOperation ? receipt.stageId !== null : receipt.recoveryId !== null)) {
    throw new RustIntegratedRuntimeBulkCodecError(
      "historical-external-operation-id",
      "historical external receipt operation identity is missing or ambiguous",
    );
  }
  body.string(operationId, "historical external operation id", recoveryOperation ? 256 : 180);
  body.u64(receipt.createdAt);
  body.hash(receipt.descriptorHash, "historical external descriptor hash");
  body.hash(receipt.externalDocumentHash, "historical external document hash");
  body.u64(receipt.externalDocumentByteLength);
  body.u64(receipt.externalDocumentRevision);
  body.u32(receipt.externalChunkCount);
  body.hash(receipt.externalChunkSetHash, "historical external chunk set hash");
  body.hash(receipt.projectionHash, "historical external projection hash");
  body.u32(receipt.projectionByteLength);
  body.hash(receipt.nativeWorldSemanticHash, "historical external native world semantic hash");
  body.u64(receipt.nativeWorldEditCount);
  body.u64(receipt.nativeWorldFacingCount);
  body.hash(receipt.saveSetHash, "historical external save set hash");
  body.hash(receipt.manifestHash, "historical external manifest hash");
  body.u64(receipt.dispatcherRequestId);
  body.u32(receipt.remainingDirtyRecords);
  const reconciliation = receipt.reconciliation;
  body.u8(reconciliation === null ? 0 : 1);
  if (reconciliation !== null) {
    body.hash(reconciliation.observationHash, "historical reconciliation observation hash");
    body.u64(reconciliation.expectedStorageRevision);
    body.string(reconciliation.observedLatestCheckpointId, "historical observed latest checkpoint id", 180);
    body.hash(reconciliation.observedLatestCheckpointHash, "historical observed latest checkpoint hash");
    body.u64(reconciliation.observedLatestJournalSequence);
    body.string(reconciliation.fallbackCheckpointId, "historical fallback checkpoint id", 180);
    body.hash(reconciliation.fallbackCheckpointHash, "historical fallback checkpoint hash");
    body.u64(reconciliation.fallbackJournalSequence);
    body.string(reconciliation.targetCheckpointId, "historical reconciliation target checkpoint id", 180);
    body.hash(reconciliation.targetCheckpointHash, "historical reconciliation target checkpoint hash");
    body.u64(reconciliation.targetJournalSequence);
    body.hash(reconciliation.planHash, "historical reconciliation plan hash");
  }
  if (receipt.authorityProfile !== "typescript-historical-save-compatibility-v1"
    || receipt.nativePlayer !== "off"
    || receipt.nativeRichState !== "not-adopted"
    || (receipt.externalStateFlags & ~HISTORICAL_EXTERNAL_KNOWN_STATE_FLAGS_V2) !== 0
    || (receipt.operation === "reconciliation") !== (reconciliation !== null)
    || reconciliation !== null && (
      reconciliation.observedLatestJournalSequence !== reconciliation.fallbackJournalSequence + 1
      || reconciliation.targetJournalSequence !== reconciliation.observedLatestJournalSequence + 1
    )) {
    throw new RustIntegratedRuntimeBulkCodecError(
      "historical-external-authority",
      "historical external receipt attempted to claim unsupported native authority",
    );
  }
  return body.finish();
}

export function decodeRustIntegratedRuntimeHistoricalExternalReceiptV2(
  value: Uint8Array | ArrayBuffer,
): RustIntegratedRuntimeHistoricalExternalReceiptV2 {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const body = new Reader(bytes);
  const magic = body.take(4);
  if (!HISTORICAL_EXTERNAL_RECEIPT_MAGIC_V2.every((byte, index) => magic[index] === byte)) {
    throw new RustIntegratedRuntimeBulkCodecError("magic", "historical external receipt magic is invalid");
  }
  if (body.u16() !== HISTORICAL_EXTERNAL_RECEIPT_SCHEMA_V2) {
    throw new RustIntegratedRuntimeBulkCodecError("version", "historical external receipt schema is unsupported");
  }
  const operationTag = body.u8();
  const operation = operationTag === 1
    ? "initial-migration" as const
    : operationTag === 2
      ? "external-save" as const
      : operationTag === 3
        ? "recovery" as const
        : operationTag === 4
          ? "reconciliation" as const
        : (() => { throw new RustIntegratedRuntimeBulkCodecError("operation", "historical external receipt operation is unknown"); })();
  const profileTag = body.u8();
  const nativeAdoptionFlags = body.u8();
  if (profileTag !== HISTORICAL_EXTERNAL_PROFILE_TAG_V2
    || nativeAdoptionFlags !== HISTORICAL_EXTERNAL_NATIVE_ADOPTION_FLAGS_V2
    || body.u8() !== 0) {
    throw new RustIntegratedRuntimeBulkCodecError(
      "historical-external-authority",
      "historical external receipt claimed an unsupported profile or native authority",
    );
  }
  const externalStateFlags = body.u16();
  if (externalStateFlags === 0 || (externalStateFlags & ~HISTORICAL_EXTERNAL_KNOWN_STATE_FLAGS_V2) !== 0) {
    throw new RustIntegratedRuntimeBulkCodecError(
      "historical-external-flags",
      "historical external receipt state flags are empty or unknown",
    );
  }
  const recoveryOperation = operation === "recovery" || operation === "reconciliation";
  const operationId = body.string("historical external operation id", recoveryOperation ? 256 : 180);
  const partial = {
    operation,
    stageId: recoveryOperation ? null : operationId,
    recoveryId: recoveryOperation ? operationId : null,
    createdAt: body.u64(),
    authorityProfile: "typescript-historical-save-compatibility-v1" as const,
    nativePlayer: "off" as const,
    nativeRichState: "not-adopted" as const,
    externalStateFlags,
    descriptorHash: body.hash(),
    externalDocumentHash: body.hash(),
    externalDocumentByteLength: body.u64(),
    externalDocumentRevision: body.u64(),
    externalChunkCount: body.u32(),
    externalChunkSetHash: body.hash(),
    projectionHash: body.hash(),
    projectionByteLength: body.u32(),
    nativeWorldSemanticHash: body.hash(),
    nativeWorldEditCount: body.u64(),
    nativeWorldFacingCount: body.u64(),
    saveSetHash: body.hash(),
    manifestHash: body.hash(),
    dispatcherRequestId: body.u64(),
    remainingDirtyRecords: body.u32(),
  };
  const reconciliationFlag = body.u8();
  if (reconciliationFlag !== 0 && reconciliationFlag !== 1) {
    throw new RustIntegratedRuntimeBulkCodecError("historical-external-reconciliation", "historical reconciliation flag is invalid");
  }
  const reconciliation = reconciliationFlag === 0 ? null : Object.freeze({
    observationHash: body.hash(),
    expectedStorageRevision: body.u64(),
    observedLatestCheckpointId: body.string("historical observed latest checkpoint id", 180),
    observedLatestCheckpointHash: body.hash(),
    observedLatestJournalSequence: body.u64(),
    fallbackCheckpointId: body.string("historical fallback checkpoint id", 180),
    fallbackCheckpointHash: body.hash(),
    fallbackJournalSequence: body.u64(),
    targetCheckpointId: body.string("historical reconciliation target checkpoint id", 180),
    targetCheckpointHash: body.hash(),
    targetJournalSequence: body.u64(),
    planHash: body.hash(),
  });
  const receipt = Object.freeze({ ...partial, reconciliation });
  body.finish();
  if (receipt.externalDocumentByteLength < 1
    || receipt.externalDocumentRevision < 1
    || receipt.externalChunkCount < 1
    || receipt.externalChunkCount > RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1
    || receipt.projectionByteLength < 1
    || receipt.projectionByteLength > RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_MAX_BYTES_V1) {
    throw new RustIntegratedRuntimeBulkCodecError(
      "historical-external-receipt",
      "historical external receipt dimensions are outside their bounds",
    );
  }
  if (receipt.operation === "recovery"
    ? receipt.dispatcherRequestId !== 0 || receipt.remainingDirtyRecords !== 0
      : receipt.operation === "reconciliation"
        ? receipt.dispatcherRequestId < 1 || receipt.remainingDirtyRecords !== 0
        : receipt.dispatcherRequestId < 1 || receipt.remainingDirtyRecords < 1) {
    throw new RustIntegratedRuntimeBulkCodecError(
      "historical-external-persistence",
      "historical external receipt has invalid pending-commit custody for its operation",
    );
  }
  if ((receipt.operation === "reconciliation") !== (receipt.reconciliation !== null)
    || receipt.reconciliation !== null && (
      receipt.reconciliation.observedLatestJournalSequence !== receipt.reconciliation.fallbackJournalSequence + 1
      || receipt.reconciliation.targetJournalSequence !== receipt.reconciliation.observedLatestJournalSequence + 1
    )) {
    throw new RustIntegratedRuntimeBulkCodecError(
      "historical-external-reconciliation",
      "historical external reconciliation attestation has invalid checkpoint lineage",
    );
  }
  return receipt;
}

function ownedAttachment(payload?: Uint8Array) {
  if (!payload || payload.byteLength === 0) return Object.freeze({ bytes: new Uint8Array(), copied: 0 });
  if (!(payload.buffer instanceof ArrayBuffer)) throw new RustIntegratedRuntimeBulkCodecError("shared-buffer", "bulk attachments require a transferable ArrayBuffer");
  if (payload.byteLength > RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1) throw new RustIntegratedRuntimeBulkCodecError("attachment-capacity", "bulk attachment exceeds 256 MiB");
  if (payload.byteOffset === 0 && payload.byteLength === payload.buffer.byteLength) return Object.freeze({ bytes: payload, copied: 0 });
  return Object.freeze({ bytes: Uint8Array.from(payload), copied: payload.byteLength });
}

function encodeControl(
  magic: Uint8Array,
  operation: number,
  status: number,
  requestId: number,
  clientEpoch: number,
  workerEpoch: number,
  body: Uint8Array,
  payload?: Uint8Array,
): RustIntegratedRuntimeBulkEncodedV1 {
  const attachment = ownedAttachment(payload);
  const output = new Uint8Array(RUST_INTEGRATED_RUNTIME_BULK_HEADER_BYTES_V1 + body.byteLength);
  output.set(magic, 0);
  const view = new DataView(output.buffer);
  view.setUint16(4, RUST_INTEGRATED_RUNTIME_BULK_WIRE_V1, true);
  view.setUint16(6, RUST_INTEGRATED_RUNTIME_BULK_SCHEMA_V2, true);
  view.setUint8(8, integer(operation, 0, 0xff, "bulk operation"));
  view.setUint8(9, integer(status, 0, 1, "bulk status"));
  view.setUint8(10, 4); // persistence; complete BWPR/BWPA bytes stay opaque
  view.setUint8(11, 0);
  view.setUint32(12, integer(requestId, 1, 0xffff_ffff, "bulk request id"), true);
  view.setUint32(16, integer(clientEpoch, 1, 0xffff_ffff, "bulk client epoch"), true);
  view.setUint32(20, integer(workerEpoch, 0, 0xffff_ffff, "bulk worker epoch"), true);
  view.setUint32(24, body.byteLength, true);
  view.setUint32(28, attachment.bytes.byteLength, true);
  output.set(toHashBytes(rustIntegratedRuntimeWireChecksumV1(body), "bulk control checksum"), 32);
  output.set(toHashBytes(rustIntegratedRuntimeWireChecksumV1(attachment.bytes), "bulk attachment checksum"), 48);
  output.set(body, RUST_INTEGRATED_RUNTIME_BULK_HEADER_BYTES_V1);
  const transfer = attachment.bytes.byteLength > 0
    ? Object.freeze([output.buffer, attachment.bytes.buffer as ArrayBuffer])
    : Object.freeze([output.buffer]);
  return Object.freeze({ control: output, attachment: attachment.bytes, transfer, copiedInputBytes: attachment.copied });
}

type DecodedEnvelope = Readonly<{
  operation: number;
  status: number;
  requestId: number;
  clientEpoch: number;
  workerEpoch: number;
  body: Uint8Array;
  attachment: Uint8Array;
}>;

function decodeControl(controlValue: Uint8Array | ArrayBuffer, attachmentValue: Uint8Array | ArrayBuffer | undefined, magic: Uint8Array): DecodedEnvelope {
  const control = controlValue instanceof Uint8Array ? controlValue : new Uint8Array(controlValue);
  const attachment = attachmentValue instanceof Uint8Array ? attachmentValue : attachmentValue ? new Uint8Array(attachmentValue) : new Uint8Array();
  if (control.byteLength < RUST_INTEGRATED_RUNTIME_BULK_HEADER_BYTES_V1 || control.byteLength > RUST_INTEGRATED_RUNTIME_BULK_MAX_CONTROL_BYTES_V1) throw new RustIntegratedRuntimeBulkCodecError("control-capacity", "bulk control envelope is outside its byte budget");
  for (let index = 0; index < magic.length; index += 1) if (control[index] !== magic[index]) throw new RustIntegratedRuntimeBulkCodecError("magic", "bulk control magic is invalid");
  const view = new DataView(control.buffer, control.byteOffset, control.byteLength);
  if (view.getUint16(4, true) !== RUST_INTEGRATED_RUNTIME_BULK_WIRE_V1 || view.getUint16(6, true) !== RUST_INTEGRATED_RUNTIME_BULK_SCHEMA_V2) throw new RustIntegratedRuntimeBulkCodecError("version", "bulk wire or runtime schema is unsupported");
  if (view.getUint8(10) !== 4) throw new RustIntegratedRuntimeBulkCodecError("domain", "bulk lane currently accepts only persistence-domain transfers");
  if (view.getUint8(11) !== 0) throw new RustIntegratedRuntimeBulkCodecError("reserved", "bulk reserved header bits must be zero");
  const bodyLength = view.getUint32(24, true);
  const attachmentLength = view.getUint32(28, true);
  if (bodyLength !== control.byteLength - RUST_INTEGRATED_RUNTIME_BULK_HEADER_BYTES_V1) throw new RustIntegratedRuntimeBulkCodecError("length", "bulk control length is invalid");
  if (attachmentLength !== attachment.byteLength || attachmentLength > RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1) throw new RustIntegratedRuntimeBulkCodecError("length", "bulk attachment length is invalid");
  const body = control.subarray(RUST_INTEGRATED_RUNTIME_BULK_HEADER_BYTES_V1);
  if (fromHashBytes(control.subarray(32, 48)) !== rustIntegratedRuntimeWireChecksumV1(body)) throw new RustIntegratedRuntimeBulkCodecError("checksum", "bulk control checksum failed");
  if (fromHashBytes(control.subarray(48, 64)) !== rustIntegratedRuntimeWireChecksumV1(attachment)) throw new RustIntegratedRuntimeBulkCodecError("checksum", "bulk attachment checksum failed");
  return Object.freeze({ operation: view.getUint8(8), status: view.getUint8(9), requestId: view.getUint32(12, true), clientEpoch: view.getUint32(16, true), workerEpoch: view.getUint32(20, true), body, attachment });
}

export function rustIntegratedRuntimeBulkStateV1(identity: RustIntegratedRuntimeIdentityV1): RustIntegratedRuntimeBulkStateV1 {
  return Object.freeze({ revision: identity.revision, tick: identity.tick, stateHash: identity.stateHash });
}

export function encodeRustIntegratedRuntimeBulkRequestV1(request: RustIntegratedRuntimeBulkRequestV1) {
  const body = new Writer();
  body.state(request.expected);
  let operation: number;
  let payload: Uint8Array | undefined;
  let copiedAttachmentInputBytes = 0;
  switch (request.type) {
    case "runtime-bulk-poll-v1":
      operation = 1;
      body.u32(integer(request.maxBytes, 1, RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1, "bulk maxBytes"));
      break;
    case "runtime-bulk-complete-v1":
      operation = 2;
      body.u64(integer(request.transferToken, 1, U64_MAX_SAFE, "bulk transfer token"));
      body.string(typeId(request.typeId, RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1), "bulk response type", 160);
      payload = request.payload;
      break;
    case "runtime-bulk-stage-save-chunk-v1":
      operation = 3;
      body.string(request.stageId, "bulk save stage id", 180);
      body.u32(integer(request.chunkIndex, 0, RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1 - 1, "bulk save chunk index"));
      body.u32(integer(request.chunkCount, 1, RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1, "bulk save chunk count"));
      if (request.chunkIndex >= request.chunkCount) throw new RustIntegratedRuntimeBulkCodecError("save-stage", "bulk save chunk index exceeds its chunk count");
      body.u64(integer(request.totalBytes, 1, RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1, "bulk save total bytes"));
      body.string(
        typeId(RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_STAGE_CHUNK_TYPE_V1, RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_STAGE_CHUNK_TYPE_V1),
        "bulk save chunk type",
        160,
      );
      if (!(request.payload instanceof Uint8Array) || request.payload.byteLength < 1 || request.payload.byteLength > RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1) {
        throw new RustIntegratedRuntimeBulkCodecError("save-stage", "bulk save chunk exceeds its 4 MiB byte budget");
      }
      payload = request.payload;
      break;
    case "runtime-bulk-finalize-save-v1":
      operation = 4;
      body.string(request.stageId, "bulk save stage id", 180);
      body.u64(integer(request.createdAt, 0, U64_MAX_SAFE, "bulk save creation time"));
      break;
    case "runtime-bulk-hydrate-recovery-v1":
      operation = 5;
      body.string(request.recoveryId, "bulk recovery id", 256);
      break;
    case "runtime-bulk-read-hydrated-compatibility-v1":
      operation = 6;
      body.string(request.recoveryId, "bulk recovery id", 256);
      body.u32(integer(request.chunkIndex, 0, RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1 - 1, "bulk hydration chunk index"));
      break;
    case "runtime-bulk-cancel-save-stage-v1":
      operation = 7;
      body.string(request.stageId, "bulk save stage id", 180);
      break;
    case "runtime-bulk-initialize-native-save-v1":
      operation = 8;
      body.string(request.saveId, "bulk native save id", 180);
      body.u64(integer(request.createdAt, 0, U64_MAX_SAFE, "bulk native save creation time"));
      break;
    case "runtime-bulk-persistence-status-v1":
      operation = 9;
      body.string(typeId(request.typeId, RUST_INTEGRATED_PERSISTENCE_STATUS_TYPE_V1), "bulk persistence status type", 160);
      body.bytes(request.payload, "bulk persistence status payload", RUST_INTEGRATED_RUNTIME_BULK_PERSISTENCE_STATUS_BYTES_V1);
      break;
    case "runtime-bulk-migrate-legacy-world-v1":
      operation = 10;
      body.string(request.stageId, "bulk legacy migration stage id", 180);
      body.u64(integer(request.createdAt, 0, U64_MAX_SAFE, "bulk legacy migration creation time"));
      body.u16(integer(request.legacyNonWorldStateFlags, 0, 0xffff, "bulk legacy non-world state flags"));
      body.string(request.sourceKey, "bulk legacy source key", 512);
      body.string(request.sourceFormat, "bulk legacy source format", 128);
      body.string(
        typeId(request.typeId, RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1),
        "bulk legacy world projection type",
        160,
      );
      if (!(request.worldProjection instanceof Uint8Array)
        || request.worldProjection.byteLength < 1
        || request.worldProjection.byteLength > RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_MAX_BYTES_V1) {
        throw new RustIntegratedRuntimeBulkCodecError(
          "legacy-world-projection",
          "bulk legacy world projection is outside its 32 MiB byte budget",
        );
      }
      payload = request.worldProjection;
      break;
    case "runtime-bulk-migrate-historical-external-v2": {
      operation = 11;
      body.string(request.stageId, "bulk historical external migration stage id", 180);
      body.u64(integer(request.createdAt, 0, U64_MAX_SAFE, "bulk historical external migration creation time"));
      body.string(
        typeId(
          request.proposalTypeId,
          RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
        ),
        "bulk historical external proposal type",
        160,
      );
      body.string(
        typeId(
          request.worldProjectionTypeId,
          RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
        ),
        "bulk historical external world projection type",
        160,
      );
      if (!(request.proposal instanceof Uint8Array)
        || request.proposal.byteLength < 1
        || request.proposal.byteLength > RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_MAX_BYTES_V2) {
        throw new RustIntegratedRuntimeBulkCodecError(
          "historical-external-proposal",
          "bulk historical external proposal is outside its 1 MiB byte budget",
        );
      }
      if (!(request.worldProjection instanceof Uint8Array)
        || request.worldProjection.byteLength < 1
        || request.worldProjection.byteLength > RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_MAX_BYTES_V1) {
        throw new RustIntegratedRuntimeBulkCodecError(
          "legacy-world-projection",
          "bulk historical external world projection is outside its 32 MiB byte budget",
        );
      }
      body.u32(request.proposal.byteLength);
      const joined = new Uint8Array(request.proposal.byteLength + request.worldProjection.byteLength);
      joined.set(request.proposal);
      joined.set(request.worldProjection, request.proposal.byteLength);
      payload = joined;
      copiedAttachmentInputBytes = joined.byteLength;
      break;
    }
    case "runtime-bulk-finalize-historical-external-save-v2": {
      operation = 12;
      body.string(request.stageId, "bulk historical external save stage id", 180);
      body.u64(integer(request.createdAt, 0, U64_MAX_SAFE, "bulk historical external save creation time"));
      body.string(
        typeId(
          request.proposalTypeId,
          RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
        ),
        "bulk historical external proposal type",
        160,
      );
      if (!(request.proposal instanceof Uint8Array)
        || request.proposal.byteLength < 1
        || request.proposal.byteLength > RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_MAX_BYTES_V2) {
        throw new RustIntegratedRuntimeBulkCodecError(
          "historical-external-proposal",
          "bulk historical external proposal is outside its 1 MiB byte budget",
        );
      }
      if (!(request.expectedPriorCheckpointBytes instanceof Uint8Array)
        || request.expectedPriorCheckpointBytes.byteLength < 1
        || request.expectedPriorCheckpointBytes.byteLength > RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PRIOR_CHECKPOINT_MAX_BYTES_V2) {
        throw new RustIntegratedRuntimeBulkCodecError(
          "historical-external-prior-checkpoint",
          "bulk historical external prior checkpoint proof is outside its 1 MiB byte budget",
        );
      }
      const attachmentLength = request.proposal.byteLength + request.expectedPriorCheckpointBytes.byteLength;
      if (attachmentLength > RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1) {
        throw new RustIntegratedRuntimeBulkCodecError("attachment-capacity", "bulk historical external save attachment exceeds 256 MiB");
      }
      body.u32(request.proposal.byteLength);
      const joined = new Uint8Array(attachmentLength);
      joined.set(request.proposal);
      joined.set(request.expectedPriorCheckpointBytes, request.proposal.byteLength);
      payload = joined;
      copiedAttachmentInputBytes = joined.byteLength;
      break;
    }
    case "runtime-bulk-hydrate-historical-external-v2":
      operation = 13;
      body.string(request.recoveryId, "bulk historical external recovery id", 256);
      break;
    case "runtime-bulk-reconcile-historical-external-fallback-v2":
      operation = 14;
      body.string(request.fallbackRecoveryId, "bulk historical fallback recovery id", 256);
      body.u64(integer(request.createdAt, 0, U64_MAX_SAFE, "bulk historical reconciliation creation time"));
      body.string(
        typeId(
          request.observationTypeId,
          RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_TYPE_V2,
        ),
        "bulk historical fallback observation type",
        160,
      );
      if (!(request.observation instanceof Uint8Array)
        || request.observation.byteLength < 1
        || request.observation.byteLength > RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_MAX_BYTES_V2) {
        throw new RustIntegratedRuntimeBulkCodecError(
          "historical-fallback-observation",
          "bulk historical fallback observation is outside its 4 MiB byte budget",
        );
      }
      payload = request.observation;
      break;
  }
  const encoded = encodeControl(REQUEST_MAGIC, operation, 0, request.requestId, request.clientEpoch, 0, body.finish(), payload);
  return copiedAttachmentInputBytes === 0
    ? encoded
    : Object.freeze({ ...encoded, copiedInputBytes: encoded.copiedInputBytes + copiedAttachmentInputBytes });
}

export function decodeRustIntegratedRuntimeBulkRequestV1(control: Uint8Array | ArrayBuffer, attachment?: Uint8Array | ArrayBuffer): RustIntegratedRuntimeBulkRequestV1 {
  const envelope = decodeControl(control, attachment, REQUEST_MAGIC);
  if (envelope.status !== 0 || envelope.workerEpoch !== 0) throw new RustIntegratedRuntimeBulkCodecError("request-header", "bulk request status and worker epoch must be zero");
  const body = new Reader(envelope.body);
  const expected = body.state();
  let request: RustIntegratedRuntimeBulkRequestV1;
  if (envelope.operation === 1) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk poll cannot carry an attachment");
    request = Object.freeze({ type: "runtime-bulk-poll-v1", requestId: envelope.requestId, clientEpoch: envelope.clientEpoch, expected, maxBytes: body.u32() });
  } else if (envelope.operation === 2) {
    const transferToken = body.u64();
    const decodedType = typeId(body.string("bulk response type", 160), RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1);
    request = Object.freeze({ type: "runtime-bulk-complete-v1", requestId: envelope.requestId, clientEpoch: envelope.clientEpoch, expected, transferToken, typeId: decodedType as typeof RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1, payload: envelope.attachment });
  } else if (envelope.operation === 3) {
    const stageId = body.string("bulk save stage id", 180);
    const chunkIndex = body.u32();
    const chunkCount = body.u32();
    const totalBytes = body.u64();
    typeId(body.string("bulk save chunk type", 160), RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_STAGE_CHUNK_TYPE_V1);
    if (chunkCount < 1 || chunkCount > RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1
      || chunkIndex >= chunkCount || totalBytes < 1 || totalBytes > RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1
      || envelope.attachment.byteLength < 1 || envelope.attachment.byteLength > RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1) {
      throw new RustIntegratedRuntimeBulkCodecError("save-stage", "bulk save chunk metadata exceeds its bounds");
    }
    request = Object.freeze({ type: "runtime-bulk-stage-save-chunk-v1", requestId: envelope.requestId, clientEpoch: envelope.clientEpoch, expected, stageId, chunkIndex, chunkCount, totalBytes, payload: envelope.attachment });
  } else if (envelope.operation === 4) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk save finalize cannot carry an attachment");
    request = Object.freeze({ type: "runtime-bulk-finalize-save-v1", requestId: envelope.requestId, clientEpoch: envelope.clientEpoch, expected, stageId: body.string("bulk save stage id", 180), createdAt: body.u64() });
  } else if (envelope.operation === 5) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk recovery hydration cannot carry an attachment");
    request = Object.freeze({ type: "runtime-bulk-hydrate-recovery-v1", requestId: envelope.requestId, clientEpoch: envelope.clientEpoch, expected, recoveryId: body.string("bulk recovery id", 256) });
  } else if (envelope.operation === 6) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk compatibility read cannot carry an attachment");
    request = Object.freeze({ type: "runtime-bulk-read-hydrated-compatibility-v1", requestId: envelope.requestId, clientEpoch: envelope.clientEpoch, expected, recoveryId: body.string("bulk recovery id", 256), chunkIndex: body.u32() });
  } else if (envelope.operation === 7) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk save cancel cannot carry an attachment");
    request = Object.freeze({ type: "runtime-bulk-cancel-save-stage-v1", requestId: envelope.requestId, clientEpoch: envelope.clientEpoch, expected, stageId: body.string("bulk save stage id", 180) });
  } else if (envelope.operation === 8) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk native save initialization cannot carry an attachment");
    request = Object.freeze({ type: "runtime-bulk-initialize-native-save-v1", requestId: envelope.requestId, clientEpoch: envelope.clientEpoch, expected, saveId: body.string("bulk native save id", 180), createdAt: body.u64() });
  } else if (envelope.operation === 9) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk persistence status cannot carry an attachment");
    const decodedType = typeId(body.string("bulk persistence status type", 160), RUST_INTEGRATED_PERSISTENCE_STATUS_TYPE_V1);
    request = Object.freeze({
      type: "runtime-bulk-persistence-status-v1",
      requestId: envelope.requestId,
      clientEpoch: envelope.clientEpoch,
      expected,
      typeId: decodedType as typeof RUST_INTEGRATED_PERSISTENCE_STATUS_TYPE_V1,
      payload: body.inlineBytes("bulk persistence status payload", RUST_INTEGRATED_RUNTIME_BULK_PERSISTENCE_STATUS_BYTES_V1),
    });
  } else if (envelope.operation === 10) {
    const stageId = body.string("bulk legacy migration stage id", 180);
    const createdAt = body.u64();
    const legacyNonWorldStateFlags = body.u16();
    const sourceKey = body.string("bulk legacy source key", 512);
    const sourceFormat = body.string("bulk legacy source format", 128);
    const decodedType = typeId(
      body.string("bulk legacy world projection type", 160),
      RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
    );
    if (envelope.attachment.byteLength < 1
      || envelope.attachment.byteLength > RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_MAX_BYTES_V1) {
      throw new RustIntegratedRuntimeBulkCodecError(
        "legacy-world-projection",
        "bulk legacy world projection is outside its 32 MiB byte budget",
      );
    }
    request = Object.freeze({
      type: "runtime-bulk-migrate-legacy-world-v1",
      requestId: envelope.requestId,
      clientEpoch: envelope.clientEpoch,
      expected,
      stageId,
      createdAt,
      legacyNonWorldStateFlags,
      sourceKey,
      sourceFormat,
      typeId: decodedType as typeof RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
      worldProjection: envelope.attachment,
    });
  } else if (envelope.operation === 11) {
    const stageId = body.string("bulk historical external migration stage id", 180);
    const createdAt = body.u64();
    const proposalTypeId = typeId(
      body.string("bulk historical external proposal type", 160),
      RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
    );
    const worldProjectionTypeId = typeId(
      body.string("bulk historical external world projection type", 160),
      RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
    );
    const proposalLength = body.u32();
    const projectionLength = envelope.attachment.byteLength - proposalLength;
    if (proposalLength < 1
      || proposalLength > RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_MAX_BYTES_V2
      || projectionLength < 1
      || projectionLength > RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_MAX_BYTES_V1) {
      throw new RustIntegratedRuntimeBulkCodecError(
        "historical-external-attachment",
        "bulk historical external migration attachment dimensions are invalid",
      );
    }
    request = Object.freeze({
      type: "runtime-bulk-migrate-historical-external-v2",
      requestId: envelope.requestId,
      clientEpoch: envelope.clientEpoch,
      expected,
      stageId,
      createdAt,
      proposalTypeId: proposalTypeId as typeof RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
      proposal: envelope.attachment.subarray(0, proposalLength),
      worldProjectionTypeId: worldProjectionTypeId as typeof RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
      worldProjection: envelope.attachment.subarray(proposalLength),
    });
  } else if (envelope.operation === 12) {
    const stageId = body.string("bulk historical external save stage id", 180);
    const createdAt = body.u64();
    const proposalTypeId = typeId(
      body.string("bulk historical external proposal type", 160),
      RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
    );
    const proposalLength = body.u32();
    const priorCheckpointLength = envelope.attachment.byteLength - proposalLength;
    if (proposalLength < 1
      || proposalLength > RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_MAX_BYTES_V2
      || priorCheckpointLength < 1
      || priorCheckpointLength > RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PRIOR_CHECKPOINT_MAX_BYTES_V2
      || envelope.attachment.byteLength !== proposalLength + priorCheckpointLength) {
      throw new RustIntegratedRuntimeBulkCodecError(
        "historical-external-proposal",
        "bulk historical external proposal/prior-checkpoint attachment is malformed",
      );
    }
    request = Object.freeze({
      type: "runtime-bulk-finalize-historical-external-save-v2",
      requestId: envelope.requestId,
      clientEpoch: envelope.clientEpoch,
      expected,
      stageId,
      createdAt,
      proposalTypeId: proposalTypeId as typeof RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_PROPOSAL_TYPE_V2,
      proposal: envelope.attachment.subarray(0, proposalLength),
      expectedPriorCheckpointBytes: envelope.attachment.subarray(proposalLength),
    });
  } else if (envelope.operation === 13) {
    if (envelope.attachment.byteLength !== 0) {
      throw new RustIntegratedRuntimeBulkCodecError(
        "attachment",
        "bulk historical external recovery cannot carry an attachment",
      );
    }
    request = Object.freeze({
      type: "runtime-bulk-hydrate-historical-external-v2",
      requestId: envelope.requestId,
      clientEpoch: envelope.clientEpoch,
      expected,
      recoveryId: body.string("bulk historical external recovery id", 256),
    });
  } else if (envelope.operation === 14) {
    const fallbackRecoveryId = body.string("bulk historical fallback recovery id", 256);
    const createdAt = body.u64();
    const observationTypeId = typeId(
      body.string("bulk historical fallback observation type", 160),
      RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_TYPE_V2,
    );
    if (envelope.attachment.byteLength < 1
      || envelope.attachment.byteLength > RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_MAX_BYTES_V2) {
      throw new RustIntegratedRuntimeBulkCodecError(
        "historical-fallback-observation",
        "bulk historical fallback observation is outside its 4 MiB byte budget",
      );
    }
    request = Object.freeze({
      type: "runtime-bulk-reconcile-historical-external-fallback-v2",
      requestId: envelope.requestId,
      clientEpoch: envelope.clientEpoch,
      expected,
      fallbackRecoveryId,
      createdAt,
      observationTypeId: observationTypeId as typeof RUST_INTEGRATED_RUNTIME_HISTORICAL_FALLBACK_OBSERVATION_TYPE_V2,
      observation: envelope.attachment,
    });
  } else throw new RustIntegratedRuntimeBulkCodecError("operation", "bulk request operation is unknown");
  body.finish();
  return request;
}

export function encodeRustIntegratedRuntimeBulkResponseV1(response: RustIntegratedRuntimeBulkResponseV1) {
  const body = new Writer();
  let operation: number;
  let status = 0;
  let payload: Uint8Array | undefined;
  if (response.type === "runtime-bulk-empty-v1") { operation = 1; body.state(response.current); }
  else if (response.type === "runtime-bulk-platform-request-v1") {
    operation = 2; body.state(response.current); body.u64(response.transferToken);
    body.string(typeId(response.typeId, RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1), "bulk request type", 160);
    payload = response.payload;
  } else if (response.type === "runtime-bulk-completed-v1") {
    operation = 3; body.state(response.current); body.u64(response.transferToken); body.hash(response.resultHash, "bulk result hash");
  } else if (response.type === "runtime-bulk-save-progress-v1") {
    operation = 4;
    body.state(response.current);
    body.string(response.stageId, "bulk save stage id", 180);
    body.u8(response.state === "staged" ? 1 : response.state === "finalized" ? 2 : 3);
    body.u32(response.receivedChunks);
    body.u32(response.chunkCount);
    body.u64(response.receivedBytes);
    body.hash(response.setHash, "bulk save set hash");
    body.hash(response.manifestHash, "bulk save manifest hash");
    body.u64(response.dispatcherRequestId);
    body.u32(response.remainingDirtyRecords);
  } else if (response.type === "runtime-bulk-hydration-v1") {
    operation = 5;
    body.state(response.current);
    body.string(response.recoveryId, "bulk recovery id", 256);
    body.u16(response.nativeDomains);
    body.u32(response.chunkCount);
    body.u64(response.totalBytes);
    body.hash(response.compatibilityHash, "bulk compatibility hash");
    body.u8(response.legacyMigration ? 1 : 0);
    if (response.legacyMigration) {
      const value = response.legacyMigration;
      body.string(value.migrationId, "bulk migration id", 180);
      body.u64(value.createdAt);
      body.string(value.sourceKey, "bulk migration source key", 512);
      body.string(value.sourceFormat, "bulk migration source format", 128);
      body.u64(value.sourceByteLength);
      body.hash(value.sourceHash, "bulk migration source hash");
      body.hash(value.projectionHash, "bulk migration projection hash");
      body.u64(value.projectionEditCount);
      body.u64(value.projectionFacingCount);
      body.hash(value.nativeWorldSemanticHash, "bulk migration native world semantic hash");
      body.u64(value.nativeWorldEditCount);
      body.u64(value.nativeWorldFacingCount);
      body.string(value.worldId, "bulk migration world id", 180);
      body.string(value.universeId, "bulk migration universe id", 64);
      body.string(value.locationId, "bulk migration location id", 128);
      body.string(value.worldSeed, "bulk migration world seed", 512);
      body.hash(value.generatorHash, "bulk migration generator hash");
      body.hash(value.contentHash, "bulk migration content hash");
      body.hash(value.terrainContentHash, "bulk migration terrain content hash");
      body.hash(value.generationOptionsHash, "bulk migration generation options hash");
      body.u64(value.backupByteLength);
      body.hash(value.backupHash, "bulk migration backup hash");
      body.u32(value.backupChunks);
      body.hash(value.nativeRecordSetHash, "bulk migration native record set hash");
      body.hash(value.descriptorHash, "bulk migration descriptor hash");
      body.hash(value.saveSetHash, "bulk migration save set hash");
      body.hash(value.manifestHash, "bulk migration manifest hash");
    }
  } else if (response.type === "runtime-bulk-data-v1") {
    operation = 6;
    body.state(response.current);
    body.u64(integer(response.transferToken, 1, U64_MAX_SAFE, "bulk data transfer token"));
    const expectedType = response.typeId === RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2
      ? RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2
      : RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1;
    body.string(typeId(response.typeId, expectedType), "bulk data type", 160);
    body.u32(integer(response.chunkIndex, 0, RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1 - 1, "bulk hydration chunk index"));
    body.u32(integer(response.chunkCount, 1, RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1, "bulk hydration chunk count"));
    const maximumPayloadBytes = expectedType === RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2
      ? RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_MAX_BYTES_V2
      : RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1;
    if (response.chunkIndex >= response.chunkCount
      || response.payload.byteLength > maximumPayloadBytes
      || (expectedType === RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2
        && (response.chunkIndex !== 0 || response.chunkCount !== 1 || response.payload.byteLength === 0))) {
      throw new RustIntegratedRuntimeBulkCodecError("hydration-data", "bulk hydration chunk metadata is invalid");
    }
    if (expectedType === RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2) {
      decodeRustIntegratedRuntimeHistoricalExternalReceiptV2(response.payload);
    }
    payload = response.payload;
  } else if (response.type === "runtime-bulk-persistence-status-v1") {
    operation = 7;
    body.state(response.current);
    body.string(typeId(response.typeId, RUST_INTEGRATED_PERSISTENCE_STATUS_RECEIPT_TYPE_V1), "bulk persistence status receipt type", 160);
    body.bytes(response.payload, "bulk persistence status receipt payload", RUST_INTEGRATED_RUNTIME_BULK_PERSISTENCE_STATUS_BYTES_V1);
  } else {
    operation = 255; status = 1; body.u8(response.current ? 1 : 0); if (response.current) body.state(response.current);
    body.string(response.code, "bulk error code", 96); body.string(response.message, "bulk error message", 2_048);
  }
  return encodeControl(RESPONSE_MAGIC, operation, status, response.requestId, response.clientEpoch, response.workerEpoch, body.finish(), payload);
}

export function decodeRustIntegratedRuntimeBulkResponseV1(control: Uint8Array | ArrayBuffer, attachment?: Uint8Array | ArrayBuffer): RustIntegratedRuntimeBulkResponseV1 {
  const envelope = decodeControl(control, attachment, RESPONSE_MAGIC);
  if (envelope.workerEpoch < 1) throw new RustIntegratedRuntimeBulkCodecError("worker-epoch", "bulk response is missing its worker generation");
  const body = new Reader(envelope.body);
  const base = { requestId: envelope.requestId, clientEpoch: envelope.clientEpoch, workerEpoch: envelope.workerEpoch } as const;
  let response: RustIntegratedRuntimeBulkResponseV1;
  if (envelope.operation === 1) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk empty response cannot carry an attachment");
    response = Object.freeze({ ...base, type: "runtime-bulk-empty-v1", current: body.state() });
  } else if (envelope.operation === 2) {
    const current = body.state(); const transferToken = body.u64();
    const decodedType = typeId(body.string("bulk request type", 160), RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1);
    response = Object.freeze({ ...base, type: "runtime-bulk-platform-request-v1", current, transferToken, typeId: decodedType as typeof RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1, payload: envelope.attachment });
  } else if (envelope.operation === 3) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk completion response cannot carry an attachment");
    response = Object.freeze({ ...base, type: "runtime-bulk-completed-v1", current: body.state(), transferToken: body.u64(), resultHash: body.hash() });
  } else if (envelope.operation === 4) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk save progress cannot carry an attachment");
    const current = body.state();
    const stageId = body.string("bulk save stage id", 180);
    const rawState = body.u8();
    const state: RustIntegratedRuntimeBulkSaveStageStateV1 = rawState === 1 ? "staged" : rawState === 2 ? "finalized" : rawState === 3 ? "cancelled" : (() => { throw new RustIntegratedRuntimeBulkCodecError("save-stage", "unknown bulk save stage state"); })();
    response = Object.freeze({
      ...base,
      type: "runtime-bulk-save-progress-v1",
      current,
      stageId,
      state,
      receivedChunks: body.u32(),
      chunkCount: body.u32(),
      receivedBytes: body.u64(),
      setHash: body.hash(),
      manifestHash: body.hash(),
      dispatcherRequestId: body.u64(),
      remainingDirtyRecords: body.u32(),
    });
  } else if (envelope.operation === 5) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk hydration receipt cannot carry an attachment");
    const current = body.state();
    const recoveryId = body.string("bulk recovery id", 256);
    const nativeDomains = body.u16();
    const chunkCount = body.u32();
    const totalBytes = body.u64();
    const compatibilityHash = body.hash();
    const migrationFlag = body.u8();
    if (migrationFlag > 1) throw new RustIntegratedRuntimeBulkCodecError("hydration-migration", "bulk hydration migration flag is invalid");
    const legacyMigration = migrationFlag === 0 ? null : Object.freeze({
      migrationId: body.string("bulk migration id", 180),
      createdAt: body.u64(),
      sourceKey: body.string("bulk migration source key", 512),
      sourceFormat: body.string("bulk migration source format", 128),
      sourceByteLength: body.u64(),
      sourceHash: body.hash(),
      projectionHash: body.hash(),
      projectionEditCount: body.u64(),
      projectionFacingCount: body.u64(),
      nativeWorldSemanticHash: body.hash(),
      nativeWorldEditCount: body.u64(),
      nativeWorldFacingCount: body.u64(),
      worldId: body.string("bulk migration world id", 180),
      universeId: body.string("bulk migration universe id", 64),
      locationId: body.string("bulk migration location id", 128),
      worldSeed: body.string("bulk migration world seed", 512),
      generatorHash: body.hash(),
      contentHash: body.hash(),
      terrainContentHash: body.hash(),
      generationOptionsHash: body.hash(),
      backupByteLength: body.u64(),
      backupHash: body.hash(),
      backupChunks: body.u32(),
      nativeRecordSetHash: body.hash(),
      descriptorHash: body.hash(),
      saveSetHash: body.hash(),
      manifestHash: body.hash(),
    });
    response = Object.freeze({
      ...base,
      type: "runtime-bulk-hydration-v1",
      current,
      recoveryId,
      nativeDomains,
      chunkCount,
      totalBytes,
      compatibilityHash,
      legacyMigration,
    });
  } else if (envelope.operation === 6) {
    const current = body.state();
    const transferToken = body.u64();
    const rawType = body.string("bulk data type", 160);
    const expectedType = rawType === RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2
      ? RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2
      : RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1;
    const decodedType = typeId(rawType, expectedType);
    const chunkIndex = body.u32();
    const chunkCount = body.u32();
    const maximumPayloadBytes = expectedType === RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2
      ? RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_MAX_BYTES_V2
      : RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1;
    if (transferToken < 1 || chunkCount < 1 || chunkCount > RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1
      || chunkIndex >= chunkCount || envelope.attachment.byteLength > maximumPayloadBytes
      || (expectedType === RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2
        && (chunkIndex !== 0 || chunkCount !== 1 || envelope.attachment.byteLength === 0))) {
      throw new RustIntegratedRuntimeBulkCodecError("hydration-data", "bulk hydration chunk metadata is invalid");
    }
    if (expectedType === RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2) {
      decodeRustIntegratedRuntimeHistoricalExternalReceiptV2(envelope.attachment);
    }
    response = Object.freeze({
      ...base,
      type: "runtime-bulk-data-v1",
      current,
      transferToken,
      typeId: decodedType as
        | typeof RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1
        | typeof RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2,
      chunkIndex,
      chunkCount,
      payload: envelope.attachment,
    });
  } else if (envelope.operation === 7) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk persistence status response cannot carry an attachment");
    const current = body.state();
    const decodedType = typeId(body.string("bulk persistence status receipt type", 160), RUST_INTEGRATED_PERSISTENCE_STATUS_RECEIPT_TYPE_V1);
    response = Object.freeze({
      ...base,
      type: "runtime-bulk-persistence-status-v1",
      current,
      typeId: decodedType as typeof RUST_INTEGRATED_PERSISTENCE_STATUS_RECEIPT_TYPE_V1,
      payload: body.inlineBytes("bulk persistence status receipt payload", RUST_INTEGRATED_RUNTIME_BULK_PERSISTENCE_STATUS_BYTES_V1),
    });
  } else if (envelope.operation === 255) {
    if (envelope.attachment.byteLength !== 0) throw new RustIntegratedRuntimeBulkCodecError("attachment", "bulk error response cannot carry an attachment");
    const present = body.u8(); if (present > 1) throw new RustIntegratedRuntimeBulkCodecError("optional-state", "bulk optional state flag is invalid");
    response = Object.freeze({ ...base, type: "runtime-bulk-error-v1", current: present ? body.state() : null, code: body.string("bulk error code", 96), message: body.string("bulk error message", 2_048) });
  } else throw new RustIntegratedRuntimeBulkCodecError("operation", "bulk response operation is unknown");
  if ((response.type === "runtime-bulk-error-v1") !== (envelope.status === 1)) throw new RustIntegratedRuntimeBulkCodecError("status", "bulk response status disagrees with its operation");
  body.finish();
  return response;
}

/**
 * Reads only enough attested Wasm response control to fetch its detached
 * attachment. The complete decoder must still run afterward and verify the
 * attachment length and checksum before any bytes are exposed to the browser.
 */
export function inspectRustIntegratedRuntimeBulkResponseAttachmentV1(controlValue: Uint8Array | ArrayBuffer) {
  const control = controlValue instanceof Uint8Array ? controlValue : new Uint8Array(controlValue);
  if (control.byteLength < RUST_INTEGRATED_RUNTIME_BULK_HEADER_BYTES_V1 || control.byteLength > RUST_INTEGRATED_RUNTIME_BULK_MAX_CONTROL_BYTES_V1) throw new RustIntegratedRuntimeBulkCodecError("control-capacity", "bulk response control is outside its byte budget");
  for (let index = 0; index < RESPONSE_MAGIC.length; index += 1) if (control[index] !== RESPONSE_MAGIC[index]) throw new RustIntegratedRuntimeBulkCodecError("magic", "bulk response control magic is invalid");
  const view = new DataView(control.buffer, control.byteOffset, control.byteLength);
  if (view.getUint16(4, true) !== RUST_INTEGRATED_RUNTIME_BULK_WIRE_V1 || view.getUint16(6, true) !== RUST_INTEGRATED_RUNTIME_BULK_SCHEMA_V2) throw new RustIntegratedRuntimeBulkCodecError("version", "bulk response wire or runtime schema is unsupported");
  if (view.getUint8(10) !== 4 || view.getUint8(11) !== 0) throw new RustIntegratedRuntimeBulkCodecError("domain", "bulk response control has invalid domain or reserved bits");
  const bodyLength = view.getUint32(24, true);
  const attachmentLength = view.getUint32(28, true);
  if (bodyLength !== control.byteLength - RUST_INTEGRATED_RUNTIME_BULK_HEADER_BYTES_V1 || attachmentLength > RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1) throw new RustIntegratedRuntimeBulkCodecError("length", "bulk response control length is invalid");
  const bodyBytes = control.subarray(RUST_INTEGRATED_RUNTIME_BULK_HEADER_BYTES_V1);
  if (fromHashBytes(control.subarray(32, 48)) !== rustIntegratedRuntimeWireChecksumV1(bodyBytes)) throw new RustIntegratedRuntimeBulkCodecError("checksum", "bulk response control checksum failed");
  if (attachmentLength === 0) return Object.freeze({ attachmentLength: 0, transferToken: 0 });
  const operation = view.getUint8(8);
  if ((operation !== 2 && operation !== 6) || view.getUint8(9) !== 0) {
    throw new RustIntegratedRuntimeBulkCodecError("attachment", "only a platform-request or hydration-data response may own a bulk attachment");
  }
  const body = new Reader(bodyBytes);
  body.state();
  const transferToken = body.u64();
  if (operation === 2) {
    typeId(body.string("bulk request type", 160), RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1);
  } else {
    const decodedType = body.string("bulk data type", 160);
    if (decodedType !== RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1
      && decodedType !== RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2) {
      throw new RustIntegratedRuntimeBulkCodecError("type-id", "bulk data response has an unsupported detached attachment type");
    }
    const chunkIndex = body.u32();
    const chunkCount = body.u32();
    if (chunkCount < 1 || chunkCount > RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1 || chunkIndex >= chunkCount) {
      throw new RustIntegratedRuntimeBulkCodecError("hydration-data", "bulk hydration chunk metadata is invalid");
    }
    if (decodedType === RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_TYPE_V2
      && (chunkIndex !== 0 || chunkCount !== 1
        || attachmentLength > RUST_INTEGRATED_RUNTIME_HISTORICAL_EXTERNAL_RECEIPT_MAX_BYTES_V2)) {
      throw new RustIntegratedRuntimeBulkCodecError(
        "historical-external-receipt",
        "historical external receipt attachment metadata is invalid",
      );
    }
  }
  body.finish();
  return Object.freeze({ attachmentLength, transferToken });
}

export function rustIntegratedRuntimeBulkAttachmentHashV1(payload: Uint8Array) {
  return payload.byteLength === 0 ? EMPTY_HASH : rustIntegratedRuntimeWireChecksumV1(payload);
}
