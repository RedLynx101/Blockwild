import {
  PERSISTENCE_RECORD_KIND_ORDER_V1,
  PERSISTENCE_SCHEMA_V1,
  createLegacyMigrationBundleV1,
  createPersistenceCheckpointV1,
  persistencePayloadMatchesV1,
  persistenceRecordKeyV1,
  type PersistenceCheckpointV1,
  type PersistenceCommitResultV1,
  type PersistenceLegacyMigrationBundleV1,
  type PersistencePlatformAdapterV1,
  type PersistenceRecordAddressV1,
  type PersistenceTransactionV1,
} from "./persistence-journal-contract";
import {
  RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1,
  RUST_PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1,
  rustPersistencePlatformPayloadHashV1,
  rustPersistenceZeroHashV1,
  type RustPersistencePlatformCodeV1,
  type RustPersistencePlatformRequestV1,
  type RustPersistenceResponseV1,
} from "./rust-persistence-runtime-contract";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

export const RUST_PERSISTENCE_DATABASE_V1 = "blockwild-rust-persistence-v1";
export const RUST_PERSISTENCE_DATABASE_VERSION_V1 = 3;

const STORE_META = "meta";
const STORE_JOURNAL = "journal";
const STORE_RECORDS = "records";
const STORE_RECORD_VERSIONS = "record-versions";
const STORE_CHECKPOINTS = "checkpoints";
const STORE_LEGACY_BACKUPS = "legacy-backups";
const STORE_PLATFORM_CHUNKS = "platform-chunks";
const STORE_TOMBSTONES = "tombstones";

type StoredMeta = Readonly<{ key: string; value: number | string | boolean }>;
type StoredRecord = Readonly<{
  key: string;
  address: PersistenceRecordAddressV1;
  revision: number;
  payload: Uint8Array;
  payloadHash: string;
}>;
type StoredCheckpoint = Readonly<{ key: string; checkpoint: PersistenceCheckpointV1 }>;
type StoredJournal = Readonly<{ key: string; worldId: string; sequence: number; transaction: PersistenceTransactionV1 }>;
type StoredLegacyBackup = Readonly<{
  key: string;
  worldId: string;
  sourceKey: string;
  bundle: PersistenceLegacyMigrationBundleV1;
  sourcePayload: Uint8Array;
}>;
type StoredPlatformChunk = Readonly<{
  key: string;
  operation: "preserve-legacy-backup-chunk" | "import-chunk";
  worldId: string;
  objectId: string;
  offset: number;
  totalBytes: number;
  payload: Uint8Array;
  payloadHash: string;
}>;
type StoredTombstone = Readonly<{
  key: string;
  worldId: string;
  tombstoneHash: string;
  storageRevision: number;
}>;

type MigrationStateSnapshotV1 = Readonly<{
  marker: StoredMeta | undefined;
  head: StoredMeta | undefined;
  sequence: StoredMeta | undefined;
  storageRevision: StoredMeta | undefined;
  tombstone: StoredTombstone | undefined;
  journal: readonly StoredJournal[];
  records: readonly StoredRecord[];
  recordVersions: readonly StoredRecord[];
  checkpoints: readonly StoredCheckpoint[];
  backups: readonly StoredLegacyBackup[];
}>;

type PreparedMigrationWriteV1 = Readonly<{
  bundle: PersistenceLegacyMigrationBundleV1;
  sourcePayload: Uint8Array;
  checkpoint: PersistenceCheckpointV1;
  records: readonly StoredRecord[];
  backup: StoredLegacyBackup;
  markerValue: string;
}>;

type MigrationInspectionV1 = Readonly<{
  readback: PersistenceMigrationReadbackV1;
  pristine: boolean;
}>;

export type PersistenceMigrationWriteV1 = Readonly<{
  bundle: PersistenceLegacyMigrationBundleV1;
  sourcePayload: Uint8Array;
  checkpoint: PersistenceCheckpointV1;
  recordPayloads: ReadonlyMap<string, Uint8Array>;
}>;

export type PersistenceMigrationReadbackV1 = Readonly<{
  ready: boolean;
  checkpointHash: string | null;
  missingRecords: readonly string[];
  corruptRecords: readonly string[];
  backupPreserved: boolean;
}>;

function checkpointKey(worldId: string, checkpointId: string) { return `${encodeURIComponent(worldId)}|${encodeURIComponent(checkpointId)}`; }
function journalKey(worldId: string, sequence: number) { return `${encodeURIComponent(worldId)}|${sequence.toString().padStart(16, "0")}`; }
function recordVersionKey(address: PersistenceRecordAddressV1, revision: number) {
  return `${persistenceRecordKeyV1(address)}|revision:${revision.toString().padStart(20, "0")}`;
}
function sequenceKey(worldId: string) { return `journal-sequence|${encodeURIComponent(worldId)}`; }
function latestCheckpointKey(worldId: string) { return `latest-checkpoint|${encodeURIComponent(worldId)}`; }
function migrationKey(worldId: string) { return `migration-complete|${encodeURIComponent(worldId)}`; }
function backupKey(bundle: PersistenceLegacyMigrationBundleV1) { return `${encodeURIComponent(bundle.worldId)}|${encodeURIComponent(bundle.sourceKey)}`; }
function storageRevisionKey(worldId: string) { return `storage-revision|${encodeURIComponent(worldId)}`; }
function tombstoneKey(worldId: string) { return `tombstone|${encodeURIComponent(worldId)}`; }
function platformChunkPrefix(operation: StoredPlatformChunk["operation"], worldId: string, objectId: string) {
  return `${operation}|${encodeURIComponent(worldId)}|${encodeURIComponent(objectId)}|`;
}
function platformChunkKey(operation: StoredPlatformChunk["operation"], worldId: string, objectId: string, offset: number) {
  return `${platformChunkPrefix(operation, worldId, objectId)}${offset.toString().padStart(20, "0")}`;
}

function recordBelongsToWorld(record: StoredRecord | undefined, worldId: string) {
  if (!record) return false;
  const address = record.address;
  if (!address || typeof address.universeId !== "string" || typeof address.locationId !== "string") return false;
  return address.universeId === worldId
    || address.universeId === `world:${worldId}`
    || `${address.universeId}@${address.locationId}` === worldId
    || `world:${address.universeId}` === worldId;
}

function recordStorageKeyBelongsToWorld(key: unknown, worldId: string) {
  if (typeof key !== "string") return false;
  const currentKey = key.split("|revision:", 1)[0];
  const separator = currentKey.indexOf("@");
  const kind = currentKey.indexOf("/", separator + 1);
  if (separator < 1 || kind < 0) return false;
  try {
    const universeId = decodeURIComponent(currentKey.slice(0, separator));
    const locationId = decodeURIComponent(currentKey.slice(separator + 1, kind));
    return universeId === worldId || universeId === `world:${worldId}`
      || `${universeId}@${locationId}` === worldId || `world:${universeId}` === worldId;
  } catch { return false; }
}

function sameStoredRecord(left: StoredRecord, right: StoredRecord) {
  try {
    return left.revision === right.revision
      && persistenceRecordKeyV1(left.address) === persistenceRecordKeyV1(right.address)
      && left.payloadHash === right.payloadHash
      && left.payload instanceof Uint8Array
      && right.payload instanceof Uint8Array
      && left.payload.byteLength === right.payload.byteLength
      && left.payload.every((value, index) => value === right.payload[index]);
  } catch { return false; }
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function cloneMigrationBundle(bundle: PersistenceLegacyMigrationBundleV1): PersistenceLegacyMigrationBundleV1 {
  return Object.freeze({ ...bundle, normalizedPayload: Uint8Array.from(bundle.normalizedPayload) });
}

function sameMigrationBundle(left: PersistenceLegacyMigrationBundleV1, right: PersistenceLegacyMigrationBundleV1) {
  try {
    return left.schemaVersion === right.schemaVersion
      && left.sourceKey === right.sourceKey
      && left.sourceFormat === right.sourceFormat
      && left.worldId === right.worldId
      && left.sourceHash === right.sourceHash
      && left.normalizedHash === right.normalizedHash
      && left.migrationHash === right.migrationHash
      && left.normalizedPayload instanceof Uint8Array
      && right.normalizedPayload instanceof Uint8Array
      && sameBytes(left.normalizedPayload, right.normalizedPayload);
  } catch { return false; }
}

function sameCheckpoint(left: PersistenceCheckpointV1, right: PersistenceCheckpointV1) {
  try {
    if (left.schemaVersion !== right.schemaVersion || left.checkpointId !== right.checkpointId
      || left.parentCheckpointId !== right.parentCheckpointId || left.worldId !== right.worldId
      || left.journalSequence !== right.journalSequence || left.generatorHash !== right.generatorHash
      || left.contentHash !== right.contentHash || left.createdAt !== right.createdAt
      || left.checkpointHash !== right.checkpointHash || left.records.length !== right.records.length) return false;
    return left.records.every((record, index) => {
      const expected = right.records[index];
      return persistenceRecordKeyV1(record.address) === persistenceRecordKeyV1(expected.address)
        && record.revision === expected.revision && record.byteLength === expected.byteLength
        && record.payloadHash === expected.payloadHash;
    });
  } catch { return false; }
}

function migrationMarkerValue(bundle: PersistenceLegacyMigrationBundleV1, checkpoint: PersistenceCheckpointV1) {
  return `migration-v1|${bundle.migrationHash}|${checkpoint.checkpointHash}`;
}

function canonicalMigrationIdentity(input: Pick<PersistenceMigrationWriteV1, "bundle" | "checkpoint">) {
  const bundle = createLegacyMigrationBundleV1({
    sourceKey: input.bundle.sourceKey,
    sourceFormat: input.bundle.sourceFormat,
    worldId: input.bundle.worldId,
    sourcePayload: new Uint8Array(),
    normalizedPayload: input.bundle.normalizedPayload,
  });
  // The source bytes are intentionally unavailable during standalone readback;
  // retain the supplied source hash while independently canonicalizing every
  // other field and the migration-domain hash below.
  const canonicalBundle = Object.freeze({ ...bundle, sourceHash: input.bundle.sourceHash });
  const migrationHasher = new TypeScriptCanonicalHasher("blockwild-persistence-migration-v1");
  migrationHasher.writeU16(PERSISTENCE_SCHEMA_V1).writeString(input.bundle.sourceKey).writeString(input.bundle.sourceFormat)
    .writeString(input.bundle.worldId).writeString(input.bundle.sourceHash).writeString(bundle.normalizedHash);
  const expectedBundle = Object.freeze({ ...canonicalBundle, migrationHash: migrationHasher.finishHex() });
  if (!sameMigrationBundle(input.bundle, expectedBundle)) throw new Error("legacy migration bundle is not canonical");
  const canonicalCheckpoint = createPersistenceCheckpointV1({
    checkpointId: input.checkpoint.checkpointId,
    parentCheckpointId: input.checkpoint.parentCheckpointId,
    worldId: input.checkpoint.worldId,
    journalSequence: input.checkpoint.journalSequence,
    generatorHash: input.checkpoint.generatorHash,
    contentHash: input.checkpoint.contentHash,
    createdAt: input.checkpoint.createdAt,
    records: input.checkpoint.records,
  });
  if (!sameCheckpoint(input.checkpoint, canonicalCheckpoint)) throw new Error("migration checkpoint is not canonical");
  if (input.checkpoint.worldId !== input.bundle.worldId) throw new Error("migration checkpoint belongs to another world");
  if (input.checkpoint.parentCheckpointId !== null || input.checkpoint.journalSequence !== 0) throw new Error("legacy migration must create a root checkpoint at journal sequence zero");
  return Object.freeze({ bundle: cloneMigrationBundle(input.bundle), checkpoint: cloneCheckpoint(input.checkpoint) });
}

function prepareMigrationWrite(input: PersistenceMigrationWriteV1): PreparedMigrationWriteV1 {
  const identity = canonicalMigrationIdentity(input);
  if (!persistencePayloadMatchesV1(input.sourcePayload, identity.bundle.sourceHash)) throw new Error("legacy source payload does not match migration fingerprint");
  if (input.recordPayloads.size !== identity.checkpoint.records.length) throw new Error("migration payload map does not exactly match its checkpoint record table");
  const records = identity.checkpoint.records.map((descriptor) => {
    const key = persistenceRecordKeyV1(descriptor.address);
    const payload = input.recordPayloads.get(key);
    if (!payload) throw new Error(`migration record ${key} is missing`);
    if (payload.byteLength !== descriptor.byteLength || !persistencePayloadMatchesV1(payload, descriptor.payloadHash)) throw new Error(`migration record ${key} failed semantic readback hashing`);
    const stored = Object.freeze({ key, address: Object.freeze({ ...descriptor.address }), revision: descriptor.revision, payload: Uint8Array.from(payload), payloadHash: descriptor.payloadHash }) satisfies StoredRecord;
    if (!recordBelongsToWorld(stored, identity.bundle.worldId)) throw new Error(`migration record ${key} belongs to another world`);
    return stored;
  });
  const backup = Object.freeze({
    key: backupKey(identity.bundle), worldId: identity.bundle.worldId, sourceKey: identity.bundle.sourceKey,
    bundle: identity.bundle, sourcePayload: Uint8Array.from(input.sourcePayload),
  }) satisfies StoredLegacyBackup;
  return Object.freeze({ ...identity, sourcePayload: Uint8Array.from(input.sourcePayload), records: Object.freeze(records), backup, markerValue: migrationMarkerValue(identity.bundle, identity.checkpoint) });
}

function storedRecordMatchesDescriptor(record: StoredRecord, key: string, descriptor: PersistenceCheckpointV1["records"][number], versioned: boolean) {
  const expectedKey = versioned ? recordVersionKey(descriptor.address, descriptor.revision) : key;
  try {
    return record.key === expectedKey && persistenceRecordKeyV1(record.address) === key
      && record.revision === descriptor.revision && record.payloadHash === descriptor.payloadHash
      && record.payload instanceof Uint8Array && record.payload.byteLength === descriptor.byteLength
      && persistencePayloadMatchesV1(record.payload, descriptor.payloadHash);
  } catch { return false; }
}

function inspectMigrationState(input: Pick<PersistenceMigrationWriteV1, "bundle" | "checkpoint">, state: MigrationStateSnapshotV1): MigrationInspectionV1 {
  const identity = canonicalMigrationIdentity(input);
  const expectedCurrentKeys = new Set(identity.checkpoint.records.map((descriptor) => persistenceRecordKeyV1(descriptor.address)));
  const expectedVersionKeys = new Set(identity.checkpoint.records.map((descriptor) => recordVersionKey(descriptor.address, descriptor.revision)));
  const relevantRecords = state.records.filter((record) => expectedCurrentKeys.has(record?.key) || recordStorageKeyBelongsToWorld(record?.key, identity.bundle.worldId) || recordBelongsToWorld(record, identity.bundle.worldId));
  const relevantVersions = state.recordVersions.filter((record) => expectedVersionKeys.has(record?.key) || recordStorageKeyBelongsToWorld(record?.key, identity.bundle.worldId) || recordBelongsToWorld(record, identity.bundle.worldId));
  const relevantCheckpoints = state.checkpoints.filter((stored) => stored?.key === checkpointKey(identity.bundle.worldId, identity.checkpoint.checkpointId) || stored?.checkpoint?.worldId === identity.bundle.worldId);
  const relevantBackups = state.backups.filter((stored) => stored?.key === backupKey(identity.bundle) || stored?.worldId === identity.bundle.worldId);
  const relevantJournal = state.journal.filter((stored) => stored?.worldId === identity.bundle.worldId || stored?.key?.startsWith(`${encodeURIComponent(identity.bundle.worldId)}|`));
  const missingRecords: string[] = [];
  const corruptRecords: string[] = [];
  for (const descriptor of identity.checkpoint.records) {
    const key = persistenceRecordKeyV1(descriptor.address);
    const current = relevantRecords.find((record) => record?.key === key);
    const versionKey = recordVersionKey(descriptor.address, descriptor.revision);
    const version = relevantVersions.find((record) => record?.key === versionKey);
    if (!current) missingRecords.push(`current:${key}`);
    else if (!storedRecordMatchesDescriptor(current, key, descriptor, false)) corruptRecords.push(`current:${key}`);
    if (!version) missingRecords.push(`version:${versionKey}`);
    else if (!storedRecordMatchesDescriptor(version, key, descriptor, true)) corruptRecords.push(`version:${versionKey}`);
  }
  for (const record of relevantRecords) if (!expectedCurrentKeys.has(record.key)) corruptRecords.push(`unexpected-current:${record.key}`);
  for (const record of relevantVersions) if (!expectedVersionKeys.has(record.key)) corruptRecords.push(`unexpected-version:${record.key}`);
  const storedCheckpoint = relevantCheckpoints.find((stored) => stored.key === checkpointKey(identity.bundle.worldId, identity.checkpoint.checkpointId));
  const checkpointExact = Boolean(storedCheckpoint && sameCheckpoint(storedCheckpoint.checkpoint, identity.checkpoint) && relevantCheckpoints.length === 1);
  if (!checkpointExact) corruptRecords.push(storedCheckpoint ? "checkpoint:mismatch" : "checkpoint:missing");
  const storedBackup = relevantBackups.find((stored) => stored.key === backupKey(identity.bundle));
  const backupPreserved = Boolean(storedBackup && storedBackup.worldId === identity.bundle.worldId && storedBackup.sourceKey === identity.bundle.sourceKey
    && sameMigrationBundle(storedBackup.bundle, identity.bundle) && storedBackup.sourcePayload instanceof Uint8Array
    && persistencePayloadMatchesV1(storedBackup.sourcePayload, identity.bundle.sourceHash) && relevantBackups.length === 1);
  if (!backupPreserved) corruptRecords.push(storedBackup ? "legacy-backup:mismatch" : "legacy-backup:missing");
  const markerExact = state.marker?.value === migrationMarkerValue(identity.bundle, identity.checkpoint);
  const headExact = state.head?.value === identity.checkpoint.checkpointId;
  const sequenceExact = state.sequence?.value === 0;
  const revisionExact = typeof state.storageRevision?.value === "number" && Number.isSafeInteger(state.storageRevision.value) && state.storageRevision.value >= 1;
  if (!markerExact) corruptRecords.push(state.marker ? "migration-marker:mismatch" : "migration-marker:missing");
  if (!headExact) corruptRecords.push(state.head ? "latest-checkpoint:mismatch" : "latest-checkpoint:missing");
  if (!sequenceExact) corruptRecords.push(state.sequence ? "journal-sequence:mismatch" : "journal-sequence:missing");
  if (!revisionExact) corruptRecords.push(state.storageRevision ? "storage-revision:mismatch" : "storage-revision:missing");
  if (state.tombstone) corruptRecords.push("tombstone:present");
  if (relevantJournal.length > 0) corruptRecords.push("journal:unexpected-entry");
  const checkpointHash = storedCheckpoint?.checkpoint?.checkpointHash ?? null;
  const ready = markerExact && headExact && sequenceExact && revisionExact && !state.tombstone && relevantJournal.length === 0
    && checkpointExact && backupPreserved && missingRecords.length === 0 && corruptRecords.length === 0;
  const readback = Object.freeze({ ready, checkpointHash, missingRecords: Object.freeze(missingRecords), corruptRecords: Object.freeze(corruptRecords), backupPreserved });
  const storageRevisionPristine = state.storageRevision === undefined
    || typeof state.storageRevision.value === "number" && Number.isSafeInteger(state.storageRevision.value) && state.storageRevision.value >= 0;
  const pristine = state.marker === undefined && state.head === undefined && state.sequence === undefined && state.tombstone === undefined
    && relevantJournal.length === 0 && relevantRecords.length === 0 && relevantVersions.length === 0
    && relevantCheckpoints.length === 0 && relevantBackups.length === 0 && storageRevisionPristine;
  return Object.freeze({ readback, pristine });
}

class PlatformWriter {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private append(bytes: Uint8Array) { this.parts.push(bytes); this.length += bytes.byteLength; }
  raw(bytes: Uint8Array) { this.append(bytes); }
  ascii(value: string) { this.append(Uint8Array.from(value, (character) => character.charCodeAt(0))); }
  u8(value: number) { this.append(Uint8Array.of(value)); }
  u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); this.append(bytes); }
  u32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); this.append(bytes); }
  u64(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("platform u64 exceeds JavaScript's exact range");
    const bytes = new Uint8Array(8); const view = new DataView(bytes.buffer);
    view.setUint32(0, value >>> 0, true); view.setUint32(4, Math.floor(value / 0x1_0000_0000), true); this.append(bytes);
  }
  hash(value: string) {
    if (!/^[0-9a-f]{32}$/u.test(value)) throw new Error("platform hash must be lowercase 128-bit hex");
    this.append(Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)));
  }
  bytes(value: Uint8Array) { this.u32(value.byteLength); this.append(value); }
  string(value: string) { this.bytes(new TextEncoder().encode(value)); }
  finish() { const result = new Uint8Array(this.length); let offset = 0; for (const part of this.parts) { result.set(part, offset); offset += part.byteLength; } return result; }
}

class PlatformReader {
  private offset = 0;
  constructor(private readonly source: Uint8Array) {}
  take(length: number) { const end = this.offset + length; if (!Number.isSafeInteger(length) || length < 0 || end > this.source.byteLength) throw new Error("portable archive is truncated"); const value = this.source.subarray(this.offset, end); this.offset = end; return value; }
  u8() { return this.take(1)[0]; }
  u16() { const bytes = this.take(2); return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, true); }
  u32() { const bytes = this.take(4); return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true); }
  skipU64() { this.take(8); }
  hash() { return [...this.take(16)].map((value) => value.toString(16).padStart(2, "0")).join(""); }
  bytes(maximum = RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1) { const length = this.u32(); if (length > maximum) throw new Error("portable field exceeds its bound"); return this.take(length); }
  string() { return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes(16 * 1024)); }
  finish() { if (this.offset !== this.source.byteLength) throw new Error("portable archive contains trailing bytes"); }
}

function platformReceiptHash(request: RustPersistencePlatformRequestV1, storageRevision: number, payload = new Uint8Array()) {
  const writer = new PlatformWriter();
  writer.string(request.operation); writer.string(request.worldId); writer.string(request.objectId);
  writer.u64(request.cursor); writer.u64(request.totalBytes); writer.u64(storageRevision);
  writer.hash(request.payloadHash); writer.hash(rustPersistencePlatformPayloadHashV1(payload));
  return rustPersistencePlatformPayloadHashV1(writer.finish());
}

function platformResponse(
  request: RustPersistencePlatformRequestV1,
  code: RustPersistencePlatformCodeV1,
  options: Readonly<{ storageRevision?: number; durableHash?: string; nextCursor?: number | null; payload?: Uint8Array; message?: string }> = {},
): Extract<RustPersistenceResponseV1, { kind: "platform" }> {
  return Object.freeze({
    kind: "platform", requestId: request.requestId, operation: request.operation, code,
    storageRevision: code === "accepted" ? options.storageRevision ?? 0 : 0,
    durableHash: options.durableHash ?? rustPersistenceZeroHashV1(),
    nextCursor: options.nextCursor ?? null,
    payload: Uint8Array.from(options.payload ?? []),
    message: options.message ?? code,
  });
}

function encodePagedRecoveryHead(checkpoint: PersistenceCheckpointV1) {
  const writer = new PlatformWriter();
  writer.ascii("BWRH"); writer.u16(PERSISTENCE_SCHEMA_V1); writer.string(checkpoint.checkpointId);
  writer.u8(checkpoint.parentCheckpointId === null ? 0 : 1);
  if (checkpoint.parentCheckpointId !== null) writer.string(checkpoint.parentCheckpointId);
  writer.string(checkpoint.worldId); writer.u64(checkpoint.journalSequence); writer.hash(checkpoint.generatorHash);
  writer.hash(checkpoint.contentHash); writer.u64(checkpoint.createdAt); writer.u32(checkpoint.records.length); writer.hash(checkpoint.checkpointHash);
  return writer.finish();
}

type RecoveryPageEntry = Readonly<{ descriptor: PersistenceCheckpointV1["records"][number]; payload: Uint8Array | null }>;

function encodePagedRecoveryPage(checkpointId: string, startRecord: number, entries: readonly RecoveryPageEntry[], nextRecord: number | null) {
  const writer = new PlatformWriter();
  writer.ascii("BWRP"); writer.u16(PERSISTENCE_SCHEMA_V1); writer.string(checkpointId); writer.u32(startRecord); writer.u32(entries.length);
  for (const entry of entries) {
    const { descriptor, payload } = entry;
    writer.string(descriptor.address.universeId); writer.string(descriptor.address.locationId);
    const kind = PERSISTENCE_RECORD_KIND_ORDER_V1.indexOf(descriptor.address.kind);
    if (kind < 0) throw new Error("recovery descriptor has an unknown record kind");
    writer.u8(kind); writer.string(descriptor.address.recordId); writer.u64(descriptor.revision);
    writer.u32(descriptor.byteLength); writer.hash(descriptor.payloadHash); writer.u8(payload === null ? 0 : 1);
    if (payload !== null) writer.bytes(payload);
  }
  writer.u8(nextRecord === null ? 0 : 1); if (nextRecord !== null) writer.u32(nextRecord);
  const result = writer.finish();
  if (result.byteLength > RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1) throw new Error("encoded recovery page exceeds 4 MiB");
  return result;
}

function encodeStorageEstimate(usage: number, quota: number | null) {
  const writer = new PlatformWriter(); writer.ascii("BWPE"); writer.u16(1); writer.u64(Math.floor(usage));
  writer.u8(quota === null ? 0 : 1); if (quota !== null) writer.u64(Math.floor(quota)); return writer.finish();
}

function portableArchiveHash(checkpoint: PersistenceCheckpointV1) {
  const hasher = new TypeScriptCanonicalHasher("blockwild-portable-archive-v1");
  hasher.writeString(checkpoint.worldId); hasher.writeString(checkpoint.checkpointId); hasher.writeString(checkpoint.checkpointHash);
  hasher.writeU32(checkpoint.records.length);
  for (const record of checkpoint.records) {
    hasher.writeString(record.address.universeId); hasher.writeString(record.address.locationId);
    hasher.writeString(record.address.kind); hasher.writeString(record.address.recordId);
    hasher.writeU64(record.revision); hasher.writeU32(record.byteLength); hasher.writeString(record.payloadHash);
  }
  return hasher.finishHex();
}

function encodePortableFrame(tag: 1 | 2 | 3, payload: Uint8Array) {
  const frameHash = new TypeScriptCanonicalHasher("blockwild-portable-frame-v1").writeBytes(payload).finishHex();
  const writer = new PlatformWriter(); writer.ascii("BWEX"); writer.u16(1); writer.u16(tag); writer.u32(payload.byteLength); writer.hash(frameHash); writer.raw(payload);
  return writer.finish();
}

function encodePortableBegin(checkpoint: PersistenceCheckpointV1) {
  const payload = new PlatformWriter(); payload.string(checkpoint.worldId); payload.string(checkpoint.checkpointId); payload.hash(checkpoint.checkpointHash);
  payload.hash(checkpoint.generatorHash); payload.hash(checkpoint.contentHash); payload.u64(checkpoint.journalSequence); payload.u32(checkpoint.records.length);
  payload.hash(portableArchiveHash(checkpoint)); return encodePortableFrame(1, payload.finish());
}

function encodePortableRecord(index: number, descriptor: PersistenceCheckpointV1["records"][number], offset: number, bytes: Uint8Array, finalChunk: boolean) {
  const payload = new PlatformWriter(); payload.u32(index); payload.string(descriptor.address.universeId); payload.string(descriptor.address.locationId);
  const kind = PERSISTENCE_RECORD_KIND_ORDER_V1.indexOf(descriptor.address.kind); if (kind < 0) throw new Error("portable descriptor has an unknown record kind");
  payload.u8(kind); payload.string(descriptor.address.recordId); payload.u64(descriptor.revision); payload.u32(descriptor.byteLength); payload.hash(descriptor.payloadHash);
  payload.u64(offset); payload.u8(finalChunk ? 1 : 0); payload.bytes(bytes); return encodePortableFrame(2, payload.finish());
}

function encodePortableEnd(checkpoint: PersistenceCheckpointV1) {
  const payload = new PlatformWriter(); payload.hash(portableArchiveHash(checkpoint)); return encodePortableFrame(3, payload.finish());
}

function validatePortableArchive(archive: Uint8Array, expectedArchiveHash: string) {
  let offset = 0; let frameIndex = 0; let beginHash: string | null = null; let endHash: string | null = null;
  while (offset < archive.byteLength) {
    if (archive.byteLength - offset < 28) throw new Error("portable frame header is truncated");
    const header = archive.subarray(offset, offset + 28); const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (new TextDecoder().decode(header.subarray(0, 4)) !== "BWEX" || view.getUint16(4, true) !== 1) throw new Error("portable frame magic or schema mismatch");
    const tag = view.getUint16(6, true); const length = view.getUint32(8, true); const end = offset + 28 + length;
    if (end > archive.byteLength) throw new Error("portable frame payload is truncated");
    const expectedFrameHash = [...header.subarray(12, 28)].map((value) => value.toString(16).padStart(2, "0")).join("");
    const payload = archive.subarray(offset + 28, end);
    const actualFrameHash = new TypeScriptCanonicalHasher("blockwild-portable-frame-v1").writeBytes(payload).finishHex();
    if (actualFrameHash !== expectedFrameHash) throw new Error("portable frame checksum mismatch");
    if (tag === 1) {
      if (frameIndex !== 0 || beginHash !== null) throw new Error("portable begin frame is duplicated or reordered");
      const reader = new PlatformReader(payload); reader.string(); reader.string(); reader.take(16); reader.take(16); reader.take(16); reader.skipU64(); reader.u32(); beginHash = reader.hash(); reader.finish();
    } else if (tag === 3) {
      if (end !== archive.byteLength || endHash !== null) throw new Error("portable end frame is duplicated or not final");
      const reader = new PlatformReader(payload); endHash = reader.hash(); reader.finish();
    } else if (tag !== 2 || beginHash === null || endHash !== null) throw new Error("portable record frame is outside begin/end bounds");
    frameIndex += 1; offset = end;
  }
  if (frameIndex < 2 || beginHash !== expectedArchiveHash || endHash !== expectedArchiveHash) throw new Error("portable archive hash does not match Rust finalization request");
}

function cloneCheckpoint(checkpoint: PersistenceCheckpointV1): PersistenceCheckpointV1 {
  return Object.freeze({
    ...checkpoint,
    records: Object.freeze(checkpoint.records.map((record) => Object.freeze({ address: Object.freeze({ ...record.address }), revision: record.revision, byteLength: record.byteLength, payloadHash: record.payloadHash }))),
  });
}

function cloneTransaction(transaction: PersistenceTransactionV1): PersistenceTransactionV1 {
  return Object.freeze({
    ...transaction,
    mutations: Object.freeze(transaction.mutations.map((mutation) => mutation.operation === "put"
      ? Object.freeze({ ...mutation, address: Object.freeze({ ...mutation.address }), payload: Uint8Array.from(mutation.payload) })
      : Object.freeze({ ...mutation, address: Object.freeze({ ...mutation.address }) }))),
  });
}

function reject(transaction: PersistenceTransactionV1, code: Extract<PersistenceCommitResultV1, { status: "rejected" }>["code"], message: string): PersistenceCommitResultV1 {
  return Object.freeze({ status: "rejected", transactionId: transaction.transactionId, code, message });
}

function classifyCommitError(transaction: PersistenceTransactionV1, error: unknown): PersistenceCommitResultV1 {
  const candidate = error as { name?: string; message?: string } | null;
  const quota = candidate?.name === "QuotaExceededError" || candidate?.name === "NS_ERROR_DOM_QUOTA_REACHED";
  return reject(transaction, quota ? "quota" : "unavailable", quota ? "Browser storage quota rejected the Rust journal transaction." : `IndexedDB transaction failed: ${candidate?.message ?? "unavailable"}`);
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, rejectRequest) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => rejectRequest(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, rejectTransaction) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => rejectTransaction(transaction.error ?? new DOMException("IndexedDB transaction aborted", "AbortError"));
    transaction.onerror = () => rejectTransaction(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function deleteMatching(store: IDBObjectStore, predicate: (value: unknown, key: IDBValidKey) => boolean) {
  return new Promise<void>((resolve, rejectCursor) => {
    const request = store.openCursor();
    request.onerror = () => rejectCursor(request.error ?? new Error("IndexedDB cursor failed"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(); return; }
      if (predicate(cursor.value, cursor.primaryKey)) cursor.delete();
      cursor.continue();
    };
  });
}

async function abortTransaction(transaction: IDBTransaction) {
  try { transaction.abort(); } catch { /* transaction already settled */ }
  try { await transactionDone(transaction); } catch { /* expected abort */ }
}

async function readMigrationState(transaction: IDBTransaction, worldId: string): Promise<MigrationStateSnapshotV1> {
  const meta = transaction.objectStore(STORE_META);
  const [marker, head, sequence, storageRevision, tombstone, journal, records, recordVersions, checkpoints, backups] = await Promise.all([
    requestValue(meta.get(migrationKey(worldId))) as Promise<StoredMeta | undefined>,
    requestValue(meta.get(latestCheckpointKey(worldId))) as Promise<StoredMeta | undefined>,
    requestValue(meta.get(sequenceKey(worldId))) as Promise<StoredMeta | undefined>,
    requestValue(meta.get(storageRevisionKey(worldId))) as Promise<StoredMeta | undefined>,
    requestValue(transaction.objectStore(STORE_TOMBSTONES).get(tombstoneKey(worldId))) as Promise<StoredTombstone | undefined>,
    requestValue(transaction.objectStore(STORE_JOURNAL).getAll()) as Promise<StoredJournal[]>,
    requestValue(transaction.objectStore(STORE_RECORDS).getAll()) as Promise<StoredRecord[]>,
    requestValue(transaction.objectStore(STORE_RECORD_VERSIONS).getAll()) as Promise<StoredRecord[]>,
    requestValue(transaction.objectStore(STORE_CHECKPOINTS).getAll()) as Promise<StoredCheckpoint[]>,
    requestValue(transaction.objectStore(STORE_LEGACY_BACKUPS).getAll()) as Promise<StoredLegacyBackup[]>,
  ]);
  return Object.freeze({ marker, head, sequence, storageRevision, tombstone, journal, records, recordVersions, checkpoints, backups });
}

export class IndexedDbPersistenceAdapterV1 implements PersistencePlatformAdapterV1 {
  private databasePromise: Promise<IDBDatabase> | null = null;
  readonly supported: boolean;

  constructor(
    private readonly factory: IDBFactory | null = typeof indexedDB === "undefined" ? null : indexedDB,
    private readonly databaseName = RUST_PERSISTENCE_DATABASE_V1,
  ) {
    this.supported = factory !== null;
  }

  private open() {
    if (!this.factory) return Promise.reject(new Error("IndexedDB is unavailable"));
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, rejectOpen) => {
      const request = this.factory!.open(this.databaseName, RUST_PERSISTENCE_DATABASE_VERSION_V1);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of [STORE_META, STORE_JOURNAL, STORE_RECORDS, STORE_RECORD_VERSIONS, STORE_CHECKPOINTS, STORE_LEGACY_BACKUPS, STORE_PLATFORM_CHUNKS, STORE_TOMBSTONES]) {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); this.databasePromise = null; };
        resolve(database);
      };
      request.onerror = () => { this.databasePromise = null; rejectOpen(request.error ?? new Error("IndexedDB open failed")); };
      request.onblocked = () => { this.databasePromise = null; rejectOpen(new Error("IndexedDB upgrade is blocked by another Blockwild tab")); };
    });
    return this.databasePromise;
  }

  async commit(transaction: PersistenceTransactionV1, checkpoint?: PersistenceCheckpointV1): Promise<PersistenceCommitResultV1> {
    let database: IDBDatabase;
    try { database = await this.open(); } catch (error) { return classifyCommitError(transaction, error); }
    if (checkpoint && (checkpoint.worldId !== transaction.worldId || checkpoint.journalSequence !== transaction.nextJournalSequence)) {
      return reject(transaction, "corrupt", "Checkpoint does not describe the transaction's committed world revision.");
    }
    const idb = database.transaction(checkpoint
      ? [STORE_META, STORE_JOURNAL, STORE_RECORDS, STORE_RECORD_VERSIONS, STORE_CHECKPOINTS, STORE_TOMBSTONES]
      : [STORE_META, STORE_JOURNAL, STORE_RECORDS, STORE_RECORD_VERSIONS, STORE_TOMBSTONES], "readwrite", { durability: "strict" });
    const done = transactionDone(idb);
    try {
      const metaStore = idb.objectStore(STORE_META);
      const recordStore = idb.objectStore(STORE_RECORDS);
      const versionStore = idb.objectStore(STORE_RECORD_VERSIONS);
      const journalStore = idb.objectStore(STORE_JOURNAL);
      const tombstone = await requestValue(idb.objectStore(STORE_TOMBSTONES).get(tombstoneKey(transaction.worldId))) as StoredTombstone | undefined;
      if (tombstone) {
        await abortTransaction(idb);
        return reject(transaction, "record-conflict", "World has a Rust delete tombstone and cannot be resurrected by a stale save.");
      }
      const sequenceRecord = await requestValue(metaStore.get(sequenceKey(transaction.worldId))) as StoredMeta | undefined;
      const currentSequence = typeof sequenceRecord?.value === "number" ? sequenceRecord.value : 0;
      if (currentSequence !== transaction.expectedJournalSequence || transaction.nextJournalSequence !== currentSequence + 1) {
        await abortTransaction(idb);
        return reject(transaction, "stale-sequence", `Expected durable journal sequence ${currentSequence}.`);
      }
      for (const mutation of transaction.mutations) {
        const key = persistenceRecordKeyV1(mutation.address);
        const current = await requestValue(recordStore.get(key)) as StoredRecord | undefined;
        const currentRevision = current?.revision ?? null;
        if (currentRevision !== mutation.expectedRecordRevision) {
          await abortTransaction(idb);
          return reject(transaction, "record-conflict", `Record ${key} changed before the transaction committed.`);
        }
        if (current) {
          if (!persistencePayloadMatchesV1(current.payload, current.payloadHash)) {
            await abortTransaction(idb);
            return reject(transaction, "corrupt", `Record ${key} failed its durable payload hash.`);
          }
          const versionKey = recordVersionKey(current.address, current.revision);
          const historical = await requestValue(versionStore.get(versionKey)) as StoredRecord | undefined;
          if (historical && !sameStoredRecord(current, historical)) {
            await abortTransaction(idb);
            return reject(transaction, "corrupt", `Immutable record version ${versionKey} disagrees with the current durable record.`);
          }
          // V2 databases have only the mutable current record. Materialize
          // that exact parent revision in this same strict V3 transaction
          // before an overwrite or delete can make it unreachable.
          if (!historical) versionStore.put(Object.freeze({ ...current, key: versionKey }) satisfies StoredRecord);
        }
      }
      for (const mutation of transaction.mutations) {
        const key = persistenceRecordKeyV1(mutation.address);
        if (mutation.operation === "delete") recordStore.delete(key);
        else {
          const stored = Object.freeze({ key, address: mutation.address, revision: mutation.nextRecordRevision, payload: Uint8Array.from(mutation.payload), payloadHash: mutation.payloadHash }) satisfies StoredRecord;
          recordStore.put(stored);
          versionStore.put(Object.freeze({ ...stored, key: recordVersionKey(mutation.address, mutation.nextRecordRevision) }) satisfies StoredRecord);
        }
      }
      journalStore.put(Object.freeze({ key: journalKey(transaction.worldId, transaction.nextJournalSequence), worldId: transaction.worldId, sequence: transaction.nextJournalSequence, transaction: cloneTransaction(transaction) }) satisfies StoredJournal);
      metaStore.put(Object.freeze({ key: sequenceKey(transaction.worldId), value: transaction.nextJournalSequence }) satisfies StoredMeta);
      const storageRevisionRecord = await requestValue(metaStore.get(storageRevisionKey(transaction.worldId))) as StoredMeta | undefined;
      const storageRevision = typeof storageRevisionRecord?.value === "number" ? storageRevisionRecord.value : 0;
      metaStore.put(Object.freeze({ key: storageRevisionKey(transaction.worldId), value: storageRevision + 1 }) satisfies StoredMeta);
      if (checkpoint) {
        idb.objectStore(STORE_CHECKPOINTS).put(Object.freeze({ key: checkpointKey(checkpoint.worldId, checkpoint.checkpointId), checkpoint: cloneCheckpoint(checkpoint) }) satisfies StoredCheckpoint);
        metaStore.put(Object.freeze({ key: latestCheckpointKey(checkpoint.worldId), value: checkpoint.checkpointId }) satisfies StoredMeta);
      }
      await done;
      return Object.freeze({ status: "committed", transactionId: transaction.transactionId, journalSequence: transaction.nextJournalSequence, durableHash: transaction.transactionHash });
    } catch (error) {
      try { idb.abort(); } catch { /* already settled */ }
      try { await done; } catch { /* error classified below */ }
      return classifyCommitError(transaction, error);
    }
  }

  async putCheckpoint(checkpoint: PersistenceCheckpointV1, markLatest = true) {
    const database = await this.open();
    const idb = database.transaction(markLatest ? [STORE_CHECKPOINTS, STORE_META] : [STORE_CHECKPOINTS], "readwrite", { durability: "strict" });
    idb.objectStore(STORE_CHECKPOINTS).put(Object.freeze({ key: checkpointKey(checkpoint.worldId, checkpoint.checkpointId), checkpoint: cloneCheckpoint(checkpoint) }) satisfies StoredCheckpoint);
    if (markLatest) idb.objectStore(STORE_META).put(Object.freeze({ key: latestCheckpointKey(checkpoint.worldId), value: checkpoint.checkpointId }) satisfies StoredMeta);
    await transactionDone(idb);
  }

  async readLatestCheckpoint(worldId: string) {
    const database = await this.open();
    const meta = database.transaction(STORE_META, "readonly");
    const head = await requestValue(meta.objectStore(STORE_META).get(latestCheckpointKey(worldId))) as StoredMeta | undefined;
    await transactionDone(meta);
    return typeof head?.value === "string" ? this.readCheckpoint(worldId, head.value) : null;
  }

  async readCheckpoint(worldId: string, checkpointId: string) {
    const database = await this.open();
    const idb = database.transaction(STORE_CHECKPOINTS, "readonly");
    const result = await requestValue(idb.objectStore(STORE_CHECKPOINTS).get(checkpointKey(worldId, checkpointId))) as StoredCheckpoint | undefined;
    await transactionDone(idb);
    return result ? cloneCheckpoint(result.checkpoint) : null;
  }

  async readRecord(address: PersistenceRecordAddressV1, revision?: number) {
    const database = await this.open();
    const idb = database.transaction([STORE_RECORDS, STORE_RECORD_VERSIONS], "readonly");
    const key = revision === undefined ? persistenceRecordKeyV1(address) : recordVersionKey(address, revision);
    let result = await requestValue(idb.objectStore(revision === undefined ? STORE_RECORDS : STORE_RECORD_VERSIONS).get(key)) as StoredRecord | undefined;
    // Databases upgraded from V2 have only the current record. It is a valid
    // exact-version source until the first V3 commit materializes history.
    if (!result && revision !== undefined) {
      const current = await requestValue(idb.objectStore(STORE_RECORDS).get(persistenceRecordKeyV1(address))) as StoredRecord | undefined;
      if (current?.revision === revision) result = current;
    }
    await transactionDone(idb);
    if (!result || revision !== undefined && result.revision !== revision) return null;
    return Uint8Array.from(result.payload);
  }

  async estimate() {
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage?.estimate) return Object.freeze({ usage: 0, quota: null });
    const estimate = await storage.estimate();
    return Object.freeze({ usage: Math.max(0, estimate.usage ?? 0), quota: estimate.quota === undefined ? null : Math.max(0, estimate.quota) });
  }

  async executePlatform(request: RustPersistencePlatformRequestV1): Promise<Extract<RustPersistenceResponseV1, { kind: "platform" }>> {
    try {
      switch (request.operation) {
        case "recover-head": return this.recoverHeadPlatform(request);
        case "read-recovery-page": return this.readRecoveryPagePlatform(request);
        case "estimate": return this.estimatePlatform(request);
        case "compact": return this.compactPlatform(request);
        case "delete-world": return this.deleteWorldPlatform(request);
        case "preserve-legacy-backup-chunk": return this.writePlatformChunk(request, "preserve-legacy-backup-chunk");
        case "export-page": return this.exportPagePlatform(request);
        case "import-chunk": return this.writePlatformChunk(request, "import-chunk");
        case "finalize-import": return this.finalizeImportPlatform(request);
      }
    } catch (error) {
      const candidate = error as { name?: string; message?: string } | null;
      const code: RustPersistencePlatformCodeV1 = candidate?.name === "QuotaExceededError" || candidate?.name === "NS_ERROR_DOM_QUOTA_REACHED" ? "quota" : "unavailable";
      return platformResponse(request, code, { message: candidate?.message ?? "IndexedDB platform operation failed." });
    }
  }

  private async storageRevision(worldId: string) {
    const database = await this.open();
    const idb = database.transaction(STORE_META, "readonly");
    const value = await requestValue(idb.objectStore(STORE_META).get(storageRevisionKey(worldId))) as StoredMeta | undefined;
    await transactionDone(idb);
    return typeof value?.value === "number" ? value.value : 0;
  }

  private async recoverHeadPlatform(request: RustPersistencePlatformRequestV1) {
    const checkpoint = request.objectId ? await this.readCheckpoint(request.worldId, request.objectId) : await this.readLatestCheckpoint(request.worldId);
    if (!checkpoint) return platformResponse(request, "empty", { message: "No durable Rust checkpoint exists for this world." });
    const storageRevision = await this.storageRevision(request.worldId);
    return platformResponse(request, "accepted", {
      storageRevision, durableHash: checkpoint.checkpointHash, payload: encodePagedRecoveryHead(checkpoint),
      message: "Exact paged-recovery head is ready.",
    });
  }

  private async readRecoveryPagePlatform(request: RustPersistencePlatformRequestV1) {
    const checkpoint = await this.readCheckpoint(request.worldId, request.objectId);
    if (!checkpoint) return platformResponse(request, "empty", { message: "Requested recovery checkpoint does not exist." });
    if (request.cursor > checkpoint.records.length) return platformResponse(request, "conflict", { message: "Recovery cursor is beyond the checkpoint record table." });
    const start = request.cursor;
    const entries: RecoveryPageEntry[] = [];
    const maximumRecords = Math.min(request.limit, RUST_PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1, checkpoint.records.length - start);
    for (let index = 0; index < maximumRecords; index += 1) {
      const descriptor = checkpoint.records[start + index];
      const payload = await this.readRecord(descriptor.address, descriptor.revision);
      const candidate = [...entries, Object.freeze({ descriptor, payload })];
      const next = start + candidate.length < checkpoint.records.length ? start + candidate.length : null;
      try { encodePagedRecoveryPage(checkpoint.checkpointId, start, candidate, next); }
      catch {
        if (entries.length === 0) return platformResponse(request, "corrupt", { message: "A recovery record exceeds the requested 4 MiB page budget." });
        break;
      }
      entries.push(Object.freeze({ descriptor, payload }));
    }
    if (checkpoint.records.length > 0 && entries.length === 0) return platformResponse(request, "corrupt", { message: "Recovery page could not make progress." });
    const nextCursor = start + entries.length < checkpoint.records.length ? start + entries.length : null;
    const payload = encodePagedRecoveryPage(checkpoint.checkpointId, start, entries, nextCursor);
    if (payload.byteLength > request.totalBytes) return platformResponse(request, "conflict", { message: "Recovery page requires a larger Rust-selected byte budget." });
    return platformResponse(request, "accepted", {
      storageRevision: await this.storageRevision(request.worldId), durableHash: checkpoint.checkpointHash,
      nextCursor, payload, message: "Exact recovery descriptor/payload page is ready.",
    });
  }

  private async estimatePlatform(request: RustPersistencePlatformRequestV1) {
    const estimate = await this.estimate();
    const payload = encodeStorageEstimate(estimate.usage, estimate.quota);
    return platformResponse(request, "accepted", {
      storageRevision: await this.storageRevision(request.worldId), durableHash: rustPersistencePlatformPayloadHashV1(payload), payload,
      message: "Browser storage estimate observed.",
    });
  }

  private async compactPlatform(request: RustPersistencePlatformRequestV1) {
    const database = await this.open();
    const idb = database.transaction([STORE_META, STORE_JOURNAL, STORE_RECORD_VERSIONS, STORE_CHECKPOINTS], "readwrite", { durability: "strict" });
    const done = transactionDone(idb); const meta = idb.objectStore(STORE_META); const checkpoints = idb.objectStore(STORE_CHECKPOINTS);
    try {
      const latest = await requestValue(meta.get(latestCheckpointKey(request.worldId))) as StoredMeta | undefined;
      const head = await requestValue(checkpoints.get(checkpointKey(request.worldId, request.objectId))) as StoredCheckpoint | undefined;
      if (!head || latest?.value !== request.objectId || head.checkpoint.checkpointHash !== request.expectedHeadHash) {
        await abortTransaction(idb); return platformResponse(request, "conflict", { message: "Compaction head changed before the browser transaction began." });
      }
      const keep = new Set<string>();
      const keepRecordVersions = new Set<string>();
      let cursor: PersistenceCheckpointV1 | null = head.checkpoint;
      for (let depth = 0; cursor && depth <= request.limit; depth += 1) {
        keep.add(checkpointKey(cursor.worldId, cursor.checkpointId));
        for (const descriptor of cursor.records) keepRecordVersions.add(recordVersionKey(descriptor.address, descriptor.revision));
        if (!cursor.parentCheckpointId) break;
        const parentRecord = await requestValue(checkpoints.get(checkpointKey(cursor.worldId, cursor.parentCheckpointId))) as StoredCheckpoint | undefined;
        cursor = parentRecord?.checkpoint ?? null;
      }
      await deleteMatching(checkpoints, (value, key) => (value as StoredCheckpoint | undefined)?.checkpoint?.worldId === request.worldId && !keep.has(String(key)));
      await deleteMatching(idb.objectStore(STORE_JOURNAL), (value) => {
        const journal = value as StoredJournal | undefined;
        return journal?.worldId === request.worldId && journal.sequence <= head.checkpoint.journalSequence;
      });
      await deleteMatching(idb.objectStore(STORE_RECORD_VERSIONS), (value, key) => {
        const record = value as StoredRecord | undefined;
        return recordBelongsToWorld(record, request.worldId) && !keepRecordVersions.has(String(key));
      });
      const previous = await requestValue(meta.get(storageRevisionKey(request.worldId))) as StoredMeta | undefined;
      const storageRevision = (typeof previous?.value === "number" ? previous.value : 0) + 1;
      meta.put(Object.freeze({ key: storageRevisionKey(request.worldId), value: storageRevision }) satisfies StoredMeta);
      await done;
      return platformResponse(request, "accepted", {
        storageRevision, durableHash: platformReceiptHash(request, storageRevision),
        message: `Compacted durable history while retaining ${keep.size} checkpoint(s).`,
      });
    } catch (error) {
      try { idb.abort(); } catch { /* already settled */ } try { await done; } catch { /* classified by caller */ } throw error;
    }
  }

  private async deleteWorldPlatform(request: RustPersistencePlatformRequestV1) {
    const database = await this.open();
    const stores = [STORE_META, STORE_JOURNAL, STORE_RECORDS, STORE_RECORD_VERSIONS, STORE_CHECKPOINTS, STORE_LEGACY_BACKUPS, STORE_PLATFORM_CHUNKS, STORE_TOMBSTONES];
    const idb = database.transaction(stores, "readwrite", { durability: "strict" }); const done = transactionDone(idb); const meta = idb.objectStore(STORE_META);
    try {
      const latest = await requestValue(meta.get(latestCheckpointKey(request.worldId))) as StoredMeta | undefined;
      const latestCheckpoint = typeof latest?.value === "string"
        ? await requestValue(idb.objectStore(STORE_CHECKPOINTS).get(checkpointKey(request.worldId, latest.value))) as StoredCheckpoint | undefined
        : undefined;
      if (request.expectedHeadHash !== null && latestCheckpoint?.checkpoint.checkpointHash !== request.expectedHeadHash) {
        await abortTransaction(idb); return platformResponse(request, "conflict", { message: "Delete expected head does not match durable storage." });
      }
      const previous = await requestValue(meta.get(storageRevisionKey(request.worldId))) as StoredMeta | undefined;
      const storageRevision = (typeof previous?.value === "number" ? previous.value : 0) + 1;
      const encodedWorldId = encodeURIComponent(request.worldId);
      await Promise.all([
        deleteMatching(meta, (_value, key) => typeof key === "string" && (key.endsWith(`|${encodedWorldId}`) || key.includes(`|${encodedWorldId}|`))),
        deleteMatching(idb.objectStore(STORE_JOURNAL), (value) => (value as StoredJournal | undefined)?.worldId === request.worldId),
        deleteMatching(idb.objectStore(STORE_RECORDS), (value) => recordBelongsToWorld(value as StoredRecord | undefined, request.worldId)),
        deleteMatching(idb.objectStore(STORE_RECORD_VERSIONS), (value) => recordBelongsToWorld(value as StoredRecord | undefined, request.worldId)),
        deleteMatching(idb.objectStore(STORE_CHECKPOINTS), (value) => (value as StoredCheckpoint | undefined)?.checkpoint?.worldId === request.worldId),
        deleteMatching(idb.objectStore(STORE_LEGACY_BACKUPS), (value) => (value as StoredLegacyBackup | undefined)?.worldId === request.worldId),
        deleteMatching(idb.objectStore(STORE_PLATFORM_CHUNKS), (value) => (value as StoredPlatformChunk | undefined)?.worldId === request.worldId),
      ]);
      meta.put(Object.freeze({ key: storageRevisionKey(request.worldId), value: storageRevision }) satisfies StoredMeta);
      idb.objectStore(STORE_TOMBSTONES).put(Object.freeze({ key: tombstoneKey(request.worldId), worldId: request.worldId, tombstoneHash: request.objectId, storageRevision }) satisfies StoredTombstone);
      await done;
      return platformResponse(request, "accepted", { storageRevision, durableHash: request.objectId, message: "World data deleted and Rust tombstone committed." });
    } catch (error) {
      try { idb.abort(); } catch { /* already settled */ } try { await done; } catch { /* classified by caller */ } throw error;
    }
  }

  private async writePlatformChunk(request: RustPersistencePlatformRequestV1, operation: StoredPlatformChunk["operation"]) {
    const database = await this.open(); const idb = database.transaction([STORE_META, STORE_PLATFORM_CHUNKS], "readwrite", { durability: "strict" });
    const done = transactionDone(idb); const meta = idb.objectStore(STORE_META); const chunks = idb.objectStore(STORE_PLATFORM_CHUNKS);
    try {
      const key = platformChunkKey(operation, request.worldId, request.objectId, request.cursor);
      const existing = await requestValue(chunks.get(key)) as StoredPlatformChunk | undefined;
      if (existing) {
        const identical = existing.totalBytes === request.totalBytes && existing.payloadHash === request.payloadHash && existing.payload.byteLength === request.payload.byteLength && existing.payload.every((value, index) => value === request.payload[index]);
        await abortTransaction(idb);
        if (!identical) return platformResponse(request, "conflict", { message: "Chunk offset already contains different bytes." });
        const storageRevision = await this.storageRevision(request.worldId);
        return platformResponse(request, "accepted", { storageRevision, durableHash: platformReceiptHash(request, storageRevision), nextCursor: request.cursor + request.payload.byteLength, message: "Identical durable chunk already exists." });
      }
      const all = await requestValue(chunks.getAll()) as StoredPlatformChunk[];
      const assembly = all.filter((entry) => entry.operation === operation && entry.worldId === request.worldId && entry.objectId === request.objectId);
      for (const entry of assembly) {
        if (entry.totalBytes !== request.totalBytes || request.cursor < entry.offset + entry.payload.byteLength && entry.offset < request.cursor + request.payload.byteLength) {
          await abortTransaction(idb); return platformResponse(request, "conflict", { message: "Chunk overlaps or disagrees with its staged assembly." });
        }
      }
      chunks.put(Object.freeze({ key, operation, worldId: request.worldId, objectId: request.objectId, offset: request.cursor, totalBytes: request.totalBytes, payload: Uint8Array.from(request.payload), payloadHash: request.payloadHash }) satisfies StoredPlatformChunk);
      const previous = await requestValue(meta.get(storageRevisionKey(request.worldId))) as StoredMeta | undefined;
      const storageRevision = (typeof previous?.value === "number" ? previous.value : 0) + 1;
      meta.put(Object.freeze({ key: storageRevisionKey(request.worldId), value: storageRevision }) satisfies StoredMeta);
      await done;
      return platformResponse(request, "accepted", { storageRevision, durableHash: platformReceiptHash(request, storageRevision), nextCursor: request.cursor + request.payload.byteLength, message: "Bounded platform chunk committed." });
    } catch (error) {
      try { idb.abort(); } catch { /* already settled */ } try { await done; } catch { /* classified by caller */ } throw error;
    }
  }

  private async exportPagePlatform(request: RustPersistencePlatformRequestV1) {
    const checkpoint = await this.readCheckpoint(request.worldId, request.objectId);
    if (!checkpoint) return platformResponse(request, "empty", { message: "Export checkpoint does not exist." });
    const maxChunkBytes = Math.max(1, request.totalBytes - 1_024);
    let logicalCursor = 0;
    let frame: Uint8Array | null = null;
    if (request.cursor === logicalCursor) frame = encodePortableBegin(checkpoint);
    logicalCursor += 1;
    for (let recordIndex = 0; frame === null && recordIndex < checkpoint.records.length; recordIndex += 1) {
      const descriptor = checkpoint.records[recordIndex]; const chunkCount = Math.max(1, Math.ceil(descriptor.byteLength / maxChunkBytes));
      if (request.cursor >= logicalCursor && request.cursor < logicalCursor + chunkCount) {
        const payload = await this.readRecord(descriptor.address, descriptor.revision);
        if (!payload || payload.byteLength !== descriptor.byteLength || !persistencePayloadMatchesV1(payload, descriptor.payloadHash)) return platformResponse(request, "corrupt", { message: "Export record is missing or corrupt." });
        const chunkIndex = request.cursor - logicalCursor; const offset = chunkIndex * maxChunkBytes;
        const bytes = payload.subarray(offset, Math.min(payload.byteLength, offset + maxChunkBytes));
        frame = encodePortableRecord(recordIndex, descriptor, offset, bytes, offset + bytes.byteLength === payload.byteLength);
      }
      logicalCursor += chunkCount;
    }
    const endCursor = logicalCursor;
    if (frame === null && request.cursor === endCursor) frame = encodePortableEnd(checkpoint);
    if (!frame) return platformResponse(request, "empty", { message: "Export cursor is past the archive end." });
    if (frame.byteLength > request.totalBytes) return platformResponse(request, "conflict", { message: "Portable frame requires a larger Rust-selected page budget." });
    const nextCursor = request.cursor === endCursor ? null : request.cursor + 1;
    return platformResponse(request, "accepted", { storageRevision: await this.storageRevision(request.worldId), durableHash: portableArchiveHash(checkpoint), nextCursor, payload: frame, message: "Portable archive frame is ready." });
  }

  private async finalizeImportPlatform(request: RustPersistencePlatformRequestV1) {
    const database = await this.open(); const idb = database.transaction([STORE_META, STORE_PLATFORM_CHUNKS], "readwrite", { durability: "strict" });
    const done = transactionDone(idb); const chunks = idb.objectStore(STORE_PLATFORM_CHUNKS); const meta = idb.objectStore(STORE_META);
    try {
      const all = await requestValue(chunks.getAll()) as StoredPlatformChunk[];
      const assembly = all.filter((entry) => entry.operation === "import-chunk" && entry.worldId === request.worldId && entry.objectId === request.objectId).sort((left, right) => left.offset - right.offset);
      let cursor = 0; const parts: Uint8Array[] = [];
      for (const entry of assembly) { if (entry.offset !== cursor || entry.totalBytes !== request.totalBytes || entry.payloadHash !== rustPersistencePlatformPayloadHashV1(entry.payload)) { await abortTransaction(idb); return platformResponse(request, "corrupt", { message: "Staged import chunks are incomplete or corrupt." }); } parts.push(entry.payload); cursor += entry.payload.byteLength; }
      if (cursor !== request.totalBytes) { await abortTransaction(idb); return platformResponse(request, "conflict", { message: "Staged import is not complete." }); }
      const archive = new Uint8Array(cursor); let writeOffset = 0; for (const part of parts) { archive.set(part, writeOffset); writeOffset += part.byteLength; }
      const archiveBytesHash = rustPersistencePlatformPayloadHashV1(archive);
      try { validatePortableArchive(archive, request.expectedHeadHash!); }
      catch (error) { await abortTransaction(idb); return platformResponse(request, "corrupt", { message: error instanceof Error ? error.message : "Portable archive validation failed." }); }
      const previous = await requestValue(meta.get(storageRevisionKey(request.worldId))) as StoredMeta | undefined;
      const storageRevision = (typeof previous?.value === "number" ? previous.value : 0) + 1;
      meta.put(Object.freeze({ key: storageRevisionKey(request.worldId), value: storageRevision }) satisfies StoredMeta);
      meta.put(Object.freeze({ key: `import-ready|${encodeURIComponent(request.worldId)}|${encodeURIComponent(request.objectId)}`, value: `${request.expectedHeadHash}|${archiveBytesHash}|${request.totalBytes}` }) satisfies StoredMeta);
      await done;
      return platformResponse(request, "accepted", { storageRevision, durableHash: request.expectedHeadHash!, payload: new Uint8Array(), message: "Complete staged import validated and durably sealed for Rust hydration." });
    } catch (error) {
      try { idb.abort(); } catch { /* already settled */ } try { await done; } catch { /* classified by caller */ } throw error;
    }
  }

  /** Separate-namespace migration: source bytes and new records commit together; no legacy key is deleted. */
  async commitMigration(input: PersistenceMigrationWriteV1) {
    const prepared = prepareMigrationWrite(input);
    const database = await this.open();
    const stores = [STORE_META, STORE_JOURNAL, STORE_RECORDS, STORE_RECORD_VERSIONS, STORE_CHECKPOINTS, STORE_LEGACY_BACKUPS, STORE_TOMBSTONES];
    const idb = database.transaction(stores, "readwrite", { durability: "strict" });
    const done = transactionDone(idb);
    try {
      // This is deliberately one serialized readwrite transaction. A second
      // tab cannot pass these reads until the first writer commits or aborts.
      const state = await readMigrationState(idb, prepared.bundle.worldId);
      const inspection = inspectMigrationState(prepared, state);
      if (state.marker !== undefined) {
        if (!inspection.readback.ready) throw new Error("legacy migration conflict: the durable migration marker is incomplete, different, or corrupt");
        await done;
        return;
      }
      if (!inspection.pristine) throw new Error("legacy migration conflict: durable world state already exists without an exact committed migration marker");

      const meta = idb.objectStore(STORE_META);
      const records = idb.objectStore(STORE_RECORDS);
      const versions = idb.objectStore(STORE_RECORD_VERSIONS);
      for (const stored of prepared.records) {
        records.put(stored);
        versions.put(Object.freeze({ ...stored, key: recordVersionKey(stored.address, stored.revision) }) satisfies StoredRecord);
      }
      idb.objectStore(STORE_CHECKPOINTS).put(Object.freeze({ key: checkpointKey(prepared.checkpoint.worldId, prepared.checkpoint.checkpointId), checkpoint: prepared.checkpoint }) satisfies StoredCheckpoint);
      idb.objectStore(STORE_LEGACY_BACKUPS).put(prepared.backup);
      meta.put(Object.freeze({ key: migrationKey(prepared.bundle.worldId), value: prepared.markerValue }) satisfies StoredMeta);
      meta.put(Object.freeze({ key: latestCheckpointKey(prepared.bundle.worldId), value: prepared.checkpoint.checkpointId }) satisfies StoredMeta);
      meta.put(Object.freeze({ key: sequenceKey(prepared.bundle.worldId), value: 0 }) satisfies StoredMeta);
      const previousRevision = typeof state.storageRevision?.value === "number" ? state.storageRevision.value : 0;
      meta.put(Object.freeze({ key: storageRevisionKey(prepared.bundle.worldId), value: previousRevision + 1 }) satisfies StoredMeta);
      await done;
    } catch (error) {
      try { idb.abort(); } catch { /* transaction already settled */ }
      try { await done; } catch { /* preserve the preflight/write failure */ }
      throw error;
    }
  }

  async verifyMigrationReadback(input: Pick<PersistenceMigrationWriteV1, "bundle" | "checkpoint">): Promise<PersistenceMigrationReadbackV1> {
    const identity = canonicalMigrationIdentity(input);
    const database = await this.open();
    const idb = database.transaction([STORE_META, STORE_JOURNAL, STORE_RECORDS, STORE_RECORD_VERSIONS, STORE_CHECKPOINTS, STORE_LEGACY_BACKUPS, STORE_TOMBSTONES], "readonly");
    const done = transactionDone(idb);
    const state = await readMigrationState(idb, identity.bundle.worldId);
    await done;
    return inspectMigrationState(identity, state).readback;
  }

  async deleteWorld(worldId: string) {
    const database = await this.open();
    const idb = database.transaction([STORE_META, STORE_JOURNAL, STORE_RECORDS, STORE_RECORD_VERSIONS, STORE_CHECKPOINTS, STORE_LEGACY_BACKUPS], "readwrite", { durability: "strict" });
    const encodedWorldId = encodeURIComponent(worldId);
    await Promise.all([
      deleteMatching(idb.objectStore(STORE_META), (_value, key) => typeof key === "string" && (key.endsWith(`|${encodedWorldId}`) || key.includes(`|${encodedWorldId}|`))),
      deleteMatching(idb.objectStore(STORE_JOURNAL), (value) => (value as StoredJournal | undefined)?.worldId === worldId),
      deleteMatching(idb.objectStore(STORE_RECORDS), (value) => recordBelongsToWorld(value as StoredRecord | undefined, worldId)),
      deleteMatching(idb.objectStore(STORE_RECORD_VERSIONS), (value) => recordBelongsToWorld(value as StoredRecord | undefined, worldId)),
      deleteMatching(idb.objectStore(STORE_CHECKPOINTS), (value) => (value as StoredCheckpoint | undefined)?.checkpoint?.worldId === worldId),
      deleteMatching(idb.objectStore(STORE_LEGACY_BACKUPS), (value) => (value as StoredLegacyBackup | undefined)?.worldId === worldId),
    ]);
    await transactionDone(idb);
  }

  async close() {
    const pending = this.databasePromise;
    this.databasePromise = null;
    if (pending) (await pending).close();
  }

  async destroyForDiagnostics() {
    await this.close();
    if (!this.factory) return;
    await new Promise<void>((resolve, rejectDelete) => {
      const request = this.factory!.deleteDatabase(this.databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => rejectDelete(request.error ?? new Error("IndexedDB diagnostic cleanup failed"));
      request.onblocked = () => rejectDelete(new Error("IndexedDB diagnostic cleanup was blocked"));
    });
  }
}

/** Deterministic test/headless adapter with the same atomic preflight semantics. */
export class MemoryPersistenceAdapterV1 implements PersistencePlatformAdapterV1 {
  private readonly sequences = new Map<string, number>();
  private readonly journals = new Map<string, StoredJournal>();
  private readonly records = new Map<string, StoredRecord>();
  private readonly recordVersions = new Map<string, StoredRecord>();
  private readonly checkpoints = new Map<string, PersistenceCheckpointV1>();
  private readonly latestCheckpoints = new Map<string, string>();
  private readonly migrationMarkers = new Map<string, string>();
  private readonly legacyBackups = new Map<string, StoredLegacyBackup>();
  private readonly storageRevisions = new Map<string, number>();
  private readonly platformChunks = new Map<string, StoredPlatformChunk>();
  private readonly tombstones = new Map<string, StoredTombstone>();

  async commit(transaction: PersistenceTransactionV1, checkpoint?: PersistenceCheckpointV1): Promise<PersistenceCommitResultV1> {
    if (this.tombstones.has(transaction.worldId)) return reject(transaction, "record-conflict", "World has a Rust delete tombstone.");
    const sequence = this.sequences.get(transaction.worldId) ?? 0;
    if (sequence !== transaction.expectedJournalSequence || transaction.nextJournalSequence !== sequence + 1) return reject(transaction, "stale-sequence", `Expected durable journal sequence ${sequence}.`);
    if (checkpoint && (checkpoint.worldId !== transaction.worldId || checkpoint.journalSequence !== transaction.nextJournalSequence)) return reject(transaction, "corrupt", "Checkpoint does not describe the transaction.");
    for (const mutation of transaction.mutations) {
      const key = persistenceRecordKeyV1(mutation.address);
      if ((this.records.get(key)?.revision ?? null) !== mutation.expectedRecordRevision) return reject(transaction, "record-conflict", `Record ${key} changed.`);
    }
    const next = new Map(this.records);
    for (const mutation of transaction.mutations) {
      const key = persistenceRecordKeyV1(mutation.address);
      if (mutation.operation === "delete") next.delete(key);
      else {
        const stored = Object.freeze({ key, address: mutation.address, revision: mutation.nextRecordRevision, payload: Uint8Array.from(mutation.payload), payloadHash: mutation.payloadHash });
        next.set(key, stored);
        this.recordVersions.set(recordVersionKey(mutation.address, mutation.nextRecordRevision), Object.freeze({ ...stored, key: recordVersionKey(mutation.address, mutation.nextRecordRevision) }));
      }
    }
    this.records.clear(); for (const [key, value] of next) this.records.set(key, value);
    this.sequences.set(transaction.worldId, transaction.nextJournalSequence);
    this.journals.set(journalKey(transaction.worldId, transaction.nextJournalSequence), Object.freeze({ key: journalKey(transaction.worldId, transaction.nextJournalSequence), worldId: transaction.worldId, sequence: transaction.nextJournalSequence, transaction: cloneTransaction(transaction) }));
    this.storageRevisions.set(transaction.worldId, (this.storageRevisions.get(transaction.worldId) ?? 0) + 1);
    if (checkpoint) await this.putCheckpoint(checkpoint);
    return Object.freeze({ status: "committed", transactionId: transaction.transactionId, journalSequence: transaction.nextJournalSequence, durableHash: transaction.transactionHash });
  }
  async putCheckpoint(checkpoint: PersistenceCheckpointV1, markLatest = true) {
    this.checkpoints.set(checkpointKey(checkpoint.worldId, checkpoint.checkpointId), cloneCheckpoint(checkpoint));
    if (markLatest) this.latestCheckpoints.set(checkpoint.worldId, checkpoint.checkpointId);
  }
  async readLatestCheckpoint(worldId: string) {
    const checkpointId = this.latestCheckpoints.get(worldId);
    return checkpointId ? this.readCheckpoint(worldId, checkpointId) : null;
  }
  async readCheckpoint(worldId: string, checkpointId: string) { const value = this.checkpoints.get(checkpointKey(worldId, checkpointId)); return value ? cloneCheckpoint(value) : null; }
  async readRecord(address: PersistenceRecordAddressV1, revision?: number) {
    const value = revision === undefined
      ? this.records.get(persistenceRecordKeyV1(address))
      : this.recordVersions.get(recordVersionKey(address, revision)) ?? this.records.get(persistenceRecordKeyV1(address));
    return !value || revision !== undefined && value.revision !== revision ? null : Uint8Array.from(value.payload);
  }
  private migrationState(worldId: string): MigrationStateSnapshotV1 {
    const marker = this.migrationMarkers.has(worldId) ? Object.freeze({ key: migrationKey(worldId), value: this.migrationMarkers.get(worldId)! }) : undefined;
    const head = this.latestCheckpoints.has(worldId) ? Object.freeze({ key: latestCheckpointKey(worldId), value: this.latestCheckpoints.get(worldId)! }) : undefined;
    const sequence = this.sequences.has(worldId) ? Object.freeze({ key: sequenceKey(worldId), value: this.sequences.get(worldId)! }) : undefined;
    const storageRevision = this.storageRevisions.has(worldId) ? Object.freeze({ key: storageRevisionKey(worldId), value: this.storageRevisions.get(worldId)! }) : undefined;
    return Object.freeze({
      marker, head, sequence, storageRevision, tombstone: this.tombstones.get(worldId),
      journal: Object.freeze([...this.journals.values()]), records: Object.freeze([...this.records.values()]),
      recordVersions: Object.freeze([...this.recordVersions.values()]),
      checkpoints: Object.freeze([...this.checkpoints].map(([key, checkpoint]) => Object.freeze({ key, checkpoint }))),
      backups: Object.freeze([...this.legacyBackups.values()]),
    });
  }
  async commitMigration(input: PersistenceMigrationWriteV1) {
    const prepared = prepareMigrationWrite(input);
    const state = this.migrationState(prepared.bundle.worldId);
    const inspection = inspectMigrationState(prepared, state);
    if (state.marker !== undefined) {
      if (!inspection.readback.ready) throw new Error("legacy migration conflict: the durable migration marker is incomplete, different, or corrupt");
      return;
    }
    if (!inspection.pristine) throw new Error("legacy migration conflict: durable world state already exists without an exact committed migration marker");
    // All validation precedes these infallible Map mutations, mirroring the
    // browser transaction's no-partial-write preflight contract.
    for (const stored of prepared.records) {
      this.records.set(stored.key, stored);
      this.recordVersions.set(recordVersionKey(stored.address, stored.revision), Object.freeze({ ...stored, key: recordVersionKey(stored.address, stored.revision) }));
    }
    this.checkpoints.set(checkpointKey(prepared.checkpoint.worldId, prepared.checkpoint.checkpointId), prepared.checkpoint);
    this.legacyBackups.set(prepared.backup.key, prepared.backup);
    this.migrationMarkers.set(prepared.bundle.worldId, prepared.markerValue);
    this.latestCheckpoints.set(prepared.bundle.worldId, prepared.checkpoint.checkpointId);
    this.sequences.set(prepared.bundle.worldId, 0);
    this.storageRevisions.set(prepared.bundle.worldId, (this.storageRevisions.get(prepared.bundle.worldId) ?? 0) + 1);
  }
  async verifyMigrationReadback(input: Pick<PersistenceMigrationWriteV1, "bundle" | "checkpoint">): Promise<PersistenceMigrationReadbackV1> {
    const identity = canonicalMigrationIdentity(input);
    return inspectMigrationState(identity, this.migrationState(identity.bundle.worldId)).readback;
  }
  async estimate() { return Object.freeze({ usage: [...this.records.values()].reduce((total, record) => total + record.payload.byteLength, 0), quota: null }); }
  async executePlatform(request: RustPersistencePlatformRequestV1): Promise<Extract<RustPersistenceResponseV1, { kind: "platform" }>> {
    const revision = () => this.storageRevisions.get(request.worldId) ?? 0;
    if (request.operation === "recover-head") {
      const checkpoint = request.objectId ? await this.readCheckpoint(request.worldId, request.objectId) : await this.readLatestCheckpoint(request.worldId);
      return checkpoint ? platformResponse(request, "accepted", { storageRevision: revision(), durableHash: checkpoint.checkpointHash, payload: encodePagedRecoveryHead(checkpoint) }) : platformResponse(request, "empty");
    }
    if (request.operation === "read-recovery-page") {
      const checkpoint = await this.readCheckpoint(request.worldId, request.objectId); if (!checkpoint) return platformResponse(request, "empty");
      const start = request.cursor; const descriptors = checkpoint.records.slice(start, start + request.limit); const entries: RecoveryPageEntry[] = descriptors.map((descriptor) => {
        const record = this.recordVersions.get(recordVersionKey(descriptor.address, descriptor.revision))
          ?? this.records.get(persistenceRecordKeyV1(descriptor.address));
        return Object.freeze({ descriptor, payload: record?.revision === descriptor.revision ? Uint8Array.from(record.payload) : null });
      });
      const nextCursor = start + entries.length < checkpoint.records.length ? start + entries.length : null;
      const payload = encodePagedRecoveryPage(checkpoint.checkpointId, start, entries, nextCursor);
      return payload.byteLength <= request.totalBytes ? platformResponse(request, "accepted", { storageRevision: revision(), durableHash: checkpoint.checkpointHash, nextCursor, payload }) : platformResponse(request, "conflict");
    }
    if (request.operation === "estimate") {
      const estimate = await this.estimate(); const payload = encodeStorageEstimate(estimate.usage, estimate.quota);
      return platformResponse(request, "accepted", { storageRevision: revision(), durableHash: rustPersistencePlatformPayloadHashV1(payload), payload });
    }
    if (request.operation === "delete-world") {
      const latest = await this.readLatestCheckpoint(request.worldId);
      if (request.expectedHeadHash !== null && latest?.checkpointHash !== request.expectedHeadHash) return platformResponse(request, "conflict");
      await this.deleteWorld(request.worldId); const next = revision() + 1; this.storageRevisions.set(request.worldId, next);
      this.tombstones.set(request.worldId, Object.freeze({ key: tombstoneKey(request.worldId), worldId: request.worldId, tombstoneHash: request.objectId, storageRevision: next }));
      return platformResponse(request, "accepted", { storageRevision: next, durableHash: request.objectId });
    }
    if (request.operation === "preserve-legacy-backup-chunk" || request.operation === "import-chunk") {
      const key = platformChunkKey(request.operation, request.worldId, request.objectId, request.cursor);
      const existing = this.platformChunks.get(key); if (existing && existing.payloadHash !== request.payloadHash) return platformResponse(request, "conflict");
      if (!existing) this.platformChunks.set(key, Object.freeze({ key, operation: request.operation, worldId: request.worldId, objectId: request.objectId, offset: request.cursor, totalBytes: request.totalBytes, payload: Uint8Array.from(request.payload), payloadHash: request.payloadHash }));
      const next = existing ? revision() : revision() + 1; this.storageRevisions.set(request.worldId, next);
      return platformResponse(request, "accepted", { storageRevision: next, durableHash: platformReceiptHash(request, next), nextCursor: request.cursor + request.payload.byteLength });
    }
    if (request.operation === "compact") {
      const checkpoint = await this.readCheckpoint(request.worldId, request.objectId);
      if (!checkpoint || this.latestCheckpoints.get(request.worldId) !== request.objectId || checkpoint.checkpointHash !== request.expectedHeadHash) return platformResponse(request, "conflict");
      const keepCheckpoints = new Set<string>();
      const keepVersions = new Set<string>();
      let cursor: PersistenceCheckpointV1 | null = checkpoint;
      for (let depth = 0; cursor && depth <= request.limit; depth += 1) {
        keepCheckpoints.add(checkpointKey(cursor.worldId, cursor.checkpointId));
        for (const descriptor of cursor.records) keepVersions.add(recordVersionKey(descriptor.address, descriptor.revision));
        cursor = cursor.parentCheckpointId ? this.checkpoints.get(checkpointKey(cursor.worldId, cursor.parentCheckpointId)) ?? null : null;
      }
      for (const [key, candidate] of this.checkpoints) if (candidate.worldId === request.worldId && !keepCheckpoints.has(key)) this.checkpoints.delete(key);
      for (const [key, journal] of this.journals) if (journal.worldId === request.worldId && journal.sequence <= checkpoint.journalSequence) this.journals.delete(key);
      for (const [key, record] of this.recordVersions) if (recordBelongsToWorld(record, request.worldId) && !keepVersions.has(key)) this.recordVersions.delete(key);
      const next = revision() + 1; this.storageRevisions.set(request.worldId, next); return platformResponse(request, "accepted", { storageRevision: next, durableHash: platformReceiptHash(request, next) });
    }
    if (request.operation === "export-page") {
      const checkpoint = await this.readCheckpoint(request.worldId, request.objectId); if (!checkpoint) return platformResponse(request, "empty");
      if (request.cursor === 0) return platformResponse(request, "accepted", { storageRevision: revision(), durableHash: portableArchiveHash(checkpoint), nextCursor: 1, payload: encodePortableBegin(checkpoint) });
      const endCursor = checkpoint.records.length + 1;
      if (request.cursor === endCursor) return platformResponse(request, "accepted", { storageRevision: revision(), durableHash: portableArchiveHash(checkpoint), payload: encodePortableEnd(checkpoint) });
      const descriptor = checkpoint.records[request.cursor - 1]; if (!descriptor) return platformResponse(request, "empty");
      const record = this.recordVersions.get(recordVersionKey(descriptor.address, descriptor.revision))
        ?? this.records.get(persistenceRecordKeyV1(descriptor.address));
      if (!record || record.revision !== descriptor.revision) return platformResponse(request, "corrupt");
      const payload = encodePortableRecord(request.cursor - 1, descriptor, 0, record.payload, true);
      return platformResponse(request, "accepted", { storageRevision: revision(), durableHash: portableArchiveHash(checkpoint), nextCursor: request.cursor + 1, payload });
    }
    if (request.operation === "finalize-import") {
      const chunks = [...this.platformChunks.values()].filter((entry) => entry.operation === "import-chunk" && entry.worldId === request.worldId && entry.objectId === request.objectId).sort((left, right) => left.offset - right.offset);
      let offset = 0; for (const chunk of chunks) { if (chunk.offset !== offset) return platformResponse(request, "conflict"); offset += chunk.payload.byteLength; }
      if (offset !== request.totalBytes) return platformResponse(request, "conflict");
      const next = revision() + 1; this.storageRevisions.set(request.worldId, next); return platformResponse(request, "accepted", { storageRevision: next, durableHash: request.expectedHeadHash! });
    }
    return platformResponse(request, "unavailable");
  }
  async deleteWorld(worldId: string) {
    this.sequences.delete(worldId);
    this.migrationMarkers.delete(worldId);
    this.latestCheckpoints.delete(worldId);
    for (const [key, journal] of this.journals) if (journal.worldId === worldId) this.journals.delete(key);
    for (const [key, record] of this.records) if (recordBelongsToWorld(record, worldId)) this.records.delete(key);
    for (const [key, record] of this.recordVersions) if (recordBelongsToWorld(record, worldId)) this.recordVersions.delete(key);
    for (const [key, checkpoint] of this.checkpoints) if (checkpoint.worldId === worldId) this.checkpoints.delete(key);
    for (const [key, backup] of this.legacyBackups) if (backup.worldId === worldId) this.legacyBackups.delete(key);
    for (const [key, chunk] of this.platformChunks) if (chunk.worldId === worldId) this.platformChunks.delete(key);
  }
}

export function persistenceAdapterSchemaV1() { return PERSISTENCE_SCHEMA_V1; }
