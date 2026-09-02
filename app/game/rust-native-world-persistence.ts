import {
  persistencePayloadHashV1,
  persistenceRecordKeyV1,
  type PersistenceCheckpointV1,
  type PersistenceRecordAddressV1,
  type PersistenceRecordDescriptorV1,
} from "./persistence-journal-contract";
import type { RustIntegratedPersistenceRuntimePortV1 } from "./rust-integrated-runtime-persistence";
import type { RustIntegratedPersistencePumpV1 } from "./rust-integrated-persistence-pump";
import {
  RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1,
  RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1,
  type RustIntegratedRuntimeLegacyMigrationAttestationV1,
} from "./rust-integrated-runtime-bulk-platform";
import {
  RustIntegratedRuntimeServiceError,
  type RustIntegratedRuntimeServiceV1,
} from "./rust-integrated-runtime-service";
import { RUST_PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1 } from "./rust-persistence-runtime-contract";
import {
  RUST_LEGACY_WORLD_MIGRATION_SCHEMA_V1,
  planRustLegacyWorldMigrationV1,
  requireRustLegacyWorldOnlyMigrationV1,
  type RustLegacyWorldMigrationPlanV1,
} from "./rust-legacy-world-migration";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import {
  decodeCanonicalWorldSaveValueV1,
  encodeCanonicalWorldSaveValueV1,
} from "./world-save-sharding";

// One native save may advance the manifest plus each of the six authority
// records in separate bounded commits. Retain enough parent depth to cross a
// fully partial generation and recover the preceding exact six-record bundle.
export const RUST_NATIVE_WORLD_PERSISTENCE_MAX_PARENT_FALLBACKS_V1 = 8;
const RUST_NATIVE_WORLD_PERSISTENCE_RECOVERY_RECORDS_PER_PAGE_V1 = 1;
const RUST_NATIVE_WORLD_COMPATIBILITY_RECORD_PREFIX_V1 = "compatibility-v1-";
const RUST_NATIVE_WORLD_MANIFEST_RECORD_ID_V1 = "manifest-v1";
const RUST_NATIVE_WORLD_MIGRATION_DESCRIPTOR_RECORD_ID_V1 = "legacy-migration-descriptor-v1";
export const RUST_NATIVE_WORLD_LEGACY_SOURCE_FORMAT_V1 = "blockwild-world-save-canonical-v1" as const;
// Mirrors IntegratedRuntimeNativeRecordKindV1::address plus the canonical
// BWSM record. It is used only to recognize a pristine cumulative commit
// prefix after interruption; schema drift blocks recovery instead of writing.
const RUST_NATIVE_WORLD_RECORD_ADDRESSES_V1 = Object.freeze([
  Object.freeze({ kind: "actor-digest" as const, recordId: "rust-gameplay-r7-v1" }),
  Object.freeze({ kind: "actor-digest" as const, recordId: RUST_NATIVE_WORLD_MIGRATION_DESCRIPTOR_RECORD_ID_V1 }),
  Object.freeze({ kind: "chunk-edits" as const, recordId: "rust-world-r4-v1" }),
  Object.freeze({ kind: "entity" as const, recordId: "rust-entity-r6-v2" }),
  Object.freeze({ kind: "location-manifest" as const, recordId: RUST_NATIVE_WORLD_MANIFEST_RECORD_ID_V1 }),
  Object.freeze({ kind: "map-knowledge" as const, recordId: "rust-world-view-r7-v1" }),
  Object.freeze({ kind: "player" as const, recordId: "rust-runtime-core-v2" }),
  Object.freeze({ kind: "settings-reference" as const, recordId: "rust-content-registry-v1" }),
]);

export type RustNativeWorldPersistenceRecoveryV1 =
  | Readonly<{ status: "empty"; worldId: string }>
  | Readonly<{
    status: "hydrated";
    worldId: string;
    checkpointId: string;
    fallbackDepth: number;
    nativeDomains: number;
    checkpointRecords: number;
    compatibility: Readonly<{
      sourceSemanticHash: string;
      chunks: number;
      bytes: number;
    }> | null;
    migration: RustIntegratedRuntimeLegacyMigrationAttestationV1 | null;
  }>
  | Readonly<{
    status: "blocked";
    worldId: string;
    code: "compatibility-adapter-required" | "compatibility-source-mismatch" | "recovery-exhausted" | "storage-corrupt";
    message: string;
    attemptedCheckpointIds: readonly string[];
  }>;

export type RustNativeWorldCompatibilityProofV1 = Readonly<{
  plan: RustLegacyWorldMigrationPlanV1;
  canonicalSource: Uint8Array;
  sourceKey: string;
  sourceFormat: string;
  createdAt: number;
}>;

export type RustNativeWorldLegacySourceIdentityV1 = Readonly<{
  sourceKey: string;
  sourceFormat: string;
}>;

export type RustNativeWorldLegacyMigrationV1 = Readonly<{
  status: "migrated" | "already-migrated";
  worldId: string;
  migrationId: string;
  checkpointId: string;
  checkpointHash: string;
  journalSequence: number;
  createdAt: number;
  compatibilityRecords: number;
  compatibilityBytes: number;
  sourceSemanticHash: string;
  projectionHash: string;
  saveSetHash: string;
  manifestHash: string;
  descriptorHash: string;
  commits: number;
  requestBytes: number;
  responseBytes: number;
}>;

export type RustNativeWorldPersistenceSaveV1 = Readonly<{
  worldId: string;
  saveId: string;
  checkpointId: string;
  checkpointHash: string;
  journalSequence: number;
  records: number;
  commits: number;
  requestBytes: number;
  responseBytes: number;
}>;

export type RustNativeWorldPersistenceDiagnosticsV1 = Readonly<{
  worldId: string;
  state: "open" | "closing" | "closed";
  saves: number;
  recoveries: number;
  legacyMigrations: number;
  legacyMigrationRetries: number;
  parentFallbacks: number;
  platformOperations: number;
  requestBytes: number;
  responseBytes: number;
  lastCheckpointId: string | null;
  lastError: Readonly<{ code: string; message: string }> | null;
}>;

export interface RustNativeWorldCheckpointReaderV1 {
  readLatestCheckpoint(worldId: string): Promise<PersistenceCheckpointV1 | null>;
  readCheckpoint(worldId: string, checkpointId: string): Promise<PersistenceCheckpointV1 | null>;
  readRecord(address: PersistenceRecordDescriptorV1["address"], revision?: number): Promise<Uint8Array | null>;
}

type NativeRuntimeControl = Pick<
  RustIntegratedRuntimeServiceV1,
  "initializeNativeSave"
  | "stageCompatibilitySaveChunk"
  | "migrateLegacyWorldOnly"
  | "hydrateCompatibilityRecovery"
  | "readHydratedCompatibility"
>;

type NativePersistencePort = Pick<
  RustIntegratedPersistenceRuntimePortV1,
  "recover" | "readRecoveryPage" | "status" | "close"
>;

type NativePersistencePump = Pick<
  RustIntegratedPersistencePumpV1,
  "flush" | "shutdown" | "isClosed"
>;

export type RustNativeWorldPersistenceSessionOptionsV1 = Readonly<{
  worldId: string;
  runtime: NativeRuntimeControl;
  port: NativePersistencePort;
  pump: NativePersistencePump;
  checkpoints: RustNativeWorldCheckpointReaderV1;
  maxParentFallbacks?: number;
}>;

type PreparedCompatibilityProofV1 = Readonly<{
  address: Readonly<{ universeId: string; locationId: string }>;
  source: Uint8Array;
  sourceKey: string;
  sourceFormat: string;
  sourceSemanticHash: string;
  projection: Uint8Array;
  projectionHash: string;
  projectionEditCount: number;
  projectionFacingCount: number;
  chunks: readonly Uint8Array[];
  chunkHashes: readonly string[];
  compatibilityStreamHash: string;
  migrationId: string;
  createdAt: number;
}>;

type CompatibilityCheckpointProofV1 = Readonly<{
  descriptors: readonly PersistenceRecordDescriptorV1[];
  bytes: number;
}>;

type CompatibilityCheckpointVerificationV1 =
  | Readonly<{ status: "exact"; proof: CompatibilityCheckpointProofV1 }>
  | Readonly<{ status: "mismatch" | "storage-error"; message: string }>;

type PartialLegacyCheckpointVerificationV1 =
  | Readonly<{ status: "strict-prefix"; records: number; compatibilityRecords: number }>
  | Readonly<{ status: "mismatch" | "storage-error"; message: string }>;

type PendingLegacyMigrationV1 = Readonly<{
  migrationId: string;
  createdAt: number;
  sourceKey: string;
  sourceFormat: string;
  sourceSemanticHash: string;
  projectionHash: string;
  saveSetHash: string;
  manifestHash: string;
}>;

type CompletedLegacyMigrationV1 = PendingLegacyMigrationV1 & Readonly<{
  checkpointId: string;
  checkpointHash: string;
}>;

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function compatibilityRecordDescriptors(checkpoint: PersistenceCheckpointV1) {
  return checkpoint.records.filter((descriptor) =>
    descriptor.address.recordId.startsWith(RUST_NATIVE_WORLD_COMPATIBILITY_RECORD_PREFIX_V1));
}

function hasCanonicalMigrationDescriptor(checkpoint: PersistenceCheckpointV1) {
  const manifests = checkpoint.records.filter((descriptor) =>
    descriptor.address.kind === "location-manifest"
    && descriptor.address.recordId === RUST_NATIVE_WORLD_MANIFEST_RECORD_ID_V1);
  const descriptors = checkpoint.records.filter((descriptor) =>
    descriptor.address.kind === "actor-digest"
    && descriptor.address.recordId === RUST_NATIVE_WORLD_MIGRATION_DESCRIPTOR_RECORD_ID_V1);
  return manifests.length === 1
    && descriptors.length === 1
    && manifests[0].address.universeId === descriptors[0].address.universeId
    && manifests[0].address.locationId === descriptors[0].address.locationId;
}

function sameRecordAddress(left: PersistenceRecordAddressV1, right: PersistenceRecordAddressV1) {
  return left.universeId === right.universeId
    && left.locationId === right.locationId
    && left.kind === right.kind
    && left.recordId === right.recordId;
}

function sameLegacyMigration(
  marker: PendingLegacyMigrationV1 | null,
  expected: PreparedCompatibilityProofV1,
  migrationId: string,
  createdAt: number,
) {
  return marker !== null
    && marker.migrationId === migrationId
    && marker.createdAt === createdAt
    && marker.sourceKey === expected.sourceKey
    && marker.sourceFormat === expected.sourceFormat
    && marker.sourceSemanticHash === expected.sourceSemanticHash
    && marker.projectionHash === expected.projectionHash;
}

function failureMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function equalStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function equalLegacyStateClassification(
  left: RustLegacyWorldMigrationPlanV1["state"],
  right: RustLegacyWorldMigrationPlanV1["state"],
) {
  const leftKeys = Object.keys(left.properties).sort();
  const rightKeys = Object.keys(right.properties).sort();
  return left.flags === right.flags
    && equalStrings(left.domains, right.domains)
    && equalStrings(leftKeys, rightKeys)
    && leftKeys.every((key) => equalStrings(
      left.properties[key as keyof typeof left.properties] ?? [],
      right.properties[key as keyof typeof right.properties] ?? [],
    ));
}

/**
 * Browser executor for the canonical R8 save lifecycle.
 *
 * This class never serializes a world domain, creates a transaction, selects a
 * retry policy, or decodes a BWPR/BWPA payload. Rust owns those decisions. The
 * browser only invokes coarse native controls, executes the resulting bounded
 * platform queue, and follows immutable checkpoint parent pointers when a
 * newer exact save fails native hydration.
 */
export class RustNativeWorldPersistenceSessionV1 {
  readonly worldId: string;
  private readonly runtime: NativeRuntimeControl;
  private readonly port: NativePersistencePort;
  private readonly pump: NativePersistencePump;
  private readonly checkpoints: RustNativeWorldCheckpointReaderV1;
  private readonly maxParentFallbacks: number;
  private serial = Promise.resolve<unknown>(undefined);
  private state: "open" | "closing" | "closed" = "open";
  private nextSaveId = 1;
  private saves = 0;
  private recoveries = 0;
  private legacyMigrations = 0;
  private legacyMigrationRetries = 0;
  private parentFallbacks = 0;
  private platformOperations = 0;
  private requestBytes = 0;
  private responseBytes = 0;
  private lastCheckpointId: string | null = null;
  private lastError: RustNativeWorldPersistenceDiagnosticsV1["lastError"] = null;
  // Process-local markers are only a fast path. The Rust-owned migration
  // descriptor is recovered and re-attested for every restarted session.
  private pendingLegacyMigration: PendingLegacyMigrationV1 | null = null;
  private completedLegacyMigration: CompletedLegacyMigrationV1 | null = null;

  constructor(options: RustNativeWorldPersistenceSessionOptionsV1) {
    if (!options.worldId || [...options.worldId].some((character) => character < " ")) {
      throw new Error("native persistence world id is empty or contains controls");
    }
    const fallbacks = options.maxParentFallbacks ?? RUST_NATIVE_WORLD_PERSISTENCE_MAX_PARENT_FALLBACKS_V1;
    if (!Number.isSafeInteger(fallbacks) || fallbacks < 0 || fallbacks > RUST_NATIVE_WORLD_PERSISTENCE_MAX_PARENT_FALLBACKS_V1) {
      throw new RangeError(`native persistence parent fallback count must be 0..${RUST_NATIVE_WORLD_PERSISTENCE_MAX_PARENT_FALLBACKS_V1}`);
    }
    this.worldId = options.worldId;
    this.runtime = options.runtime;
    this.port = options.port;
    this.pump = options.pump;
    this.checkpoints = options.checkpoints;
    this.maxParentFallbacks = fallbacks;
  }

  initializeNewWorld(createdAt: number) {
    return this.enqueue(async () => {
      const existing = await this.checkpoints.readLatestCheckpoint(this.worldId);
      if (existing) throw this.error("already-initialized", "native world already has a durable checkpoint head");
      return this.performNativeSave(createdAt, "new");
    });
  }

  saveNative(createdAt: number) {
    return this.enqueue(() => this.performNativeSave(createdAt, "save"));
  }

  migrateLegacyWorldOnly(
    plan: RustLegacyWorldMigrationPlanV1,
    canonicalSource: Uint8Array,
    createdAt: number,
    sourceIdentity: RustNativeWorldLegacySourceIdentityV1,
  ): Promise<RustNativeWorldLegacyMigrationV1> {
    let prepared: PreparedCompatibilityProofV1;
    try {
      prepared = this.prepareCompatibilityProof(plan, canonicalSource, { ...sourceIdentity, createdAt });
      this.validateCreatedAt(createdAt, "legacy migration");
    } catch (error) { return Promise.reject(error); }
    return this.enqueue(() => this.performLegacyWorldOnlyMigration(prepared, createdAt));
  }

  recoverAndHydrate(proof?: RustNativeWorldCompatibilityProofV1): Promise<RustNativeWorldPersistenceRecoveryV1> {
    let prepared: PreparedCompatibilityProofV1 | null = null;
    try { prepared = proof ? this.prepareCompatibilityProof(proof.plan, proof.canonicalSource, proof) : null; }
    catch (error) { return Promise.reject(error); }
    return this.enqueue(() => this.performRecovery(prepared));
  }

  flush() {
    return this.enqueue(async () => { await this.drain(); });
  }

  async shutdown() {
    if (this.state === "closed") return;
    if (this.state === "closing") { await this.serial; return; }
    this.state = "closing";
    const work = this.serial.then(async () => {
      let failure: unknown = null;
      try {
        await this.drain(true);
        await this.port.close();
      } catch (error) { failure = error; }
      try { await this.pump.shutdown(); }
      catch (error) { failure ??= error; }
      this.state = "closed";
      if (failure) throw failure;
    });
    this.serial = work.then(() => undefined, () => undefined);
    try { await work; }
    catch (error) { this.state = "closed"; throw error; }
  }

  diagnostics(): RustNativeWorldPersistenceDiagnosticsV1 {
    return Object.freeze({
      worldId: this.worldId,
      state: this.state,
      saves: this.saves,
      recoveries: this.recoveries,
      legacyMigrations: this.legacyMigrations,
      legacyMigrationRetries: this.legacyMigrationRetries,
      parentFallbacks: this.parentFallbacks,
      platformOperations: this.platformOperations,
      requestBytes: this.requestBytes,
      responseBytes: this.responseBytes,
      lastCheckpointId: this.lastCheckpointId,
      lastError: this.lastError,
    });
  }

  private prepareCompatibilityProof(
    plan: RustLegacyWorldMigrationPlanV1,
    canonicalSource: Uint8Array,
    sourceIdentity: RustNativeWorldLegacySourceIdentityV1 & Readonly<{ createdAt: number }>,
  ): PreparedCompatibilityProofV1 {
    if (!(canonicalSource instanceof Uint8Array)
      || canonicalSource.byteLength < 1
      || canonicalSource.byteLength > RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1) {
      throw this.error("legacy-source", "canonical legacy source is outside the bounded compatibility lane");
    }
    if (!sourceIdentity
      || typeof sourceIdentity.sourceKey !== "string"
      || typeof sourceIdentity.sourceFormat !== "string"
      || sourceIdentity.sourceKey.length < 1
      || [...sourceIdentity.sourceKey].some((character) => character < " ")
      || [...sourceIdentity.sourceKey].length > 512
      || sourceIdentity.sourceFormat.length < 1
      || [...sourceIdentity.sourceFormat].some((character) => character < " ")
      || [...sourceIdentity.sourceFormat].length > 128) {
      throw this.error("legacy-source-identity", "legacy source key or format is empty, contains controls, or exceeds its bound");
    }
    this.validateCreatedAt(sourceIdentity.createdAt, "legacy migration proof");
    const source = Uint8Array.from(canonicalSource);
    let rebuilt: RustLegacyWorldMigrationPlanV1;
    try {
      requireRustLegacyWorldOnlyMigrationV1(plan);
      if (plan.schemaVersion !== RUST_LEGACY_WORLD_MIGRATION_SCHEMA_V1
        || plan.projection.schemaVersion !== RUST_LEGACY_WORLD_MIGRATION_SCHEMA_V1) {
        throw new Error("legacy migration plan schema is unsupported");
      }
      const decoded = decodeCanonicalWorldSaveValueV1(source);
      const canonical = encodeCanonicalWorldSaveValueV1(decoded);
      if (!equalBytes(canonical, source)) throw new Error("legacy source bytes are not canonical WorldSave JSON");
      rebuilt = planRustLegacyWorldMigrationV1({
        save: decoded as Readonly<Record<string, unknown>>,
        address: plan.projection.address,
        revision: plan.projection.revision,
      });
      requireRustLegacyWorldOnlyMigrationV1(rebuilt);
    } catch (error) {
      throw this.error("legacy-plan", failureMessage(error, "legacy migration plan could not be revalidated"));
    }
    if (plan.status !== rebuilt.status
      || !equalLegacyStateClassification(plan.state, rebuilt.state)
      || plan.sourceSemanticBytes !== source.byteLength
      || plan.sourceSemanticHash !== persistencePayloadHashV1(source)
      || rebuilt.sourceSemanticBytes !== source.byteLength
      || rebuilt.sourceSemanticHash !== plan.sourceSemanticHash) {
      throw this.error("legacy-source", "canonical legacy source does not match the migration plan provenance");
    }
    if (plan.projection.address.universeId !== rebuilt.projection.address.universeId
      || plan.projection.address.locationId !== rebuilt.projection.address.locationId
      || plan.projection.revision.epoch !== rebuilt.projection.revision.epoch
      || plan.projection.revision.mutation !== rebuilt.projection.revision.mutation
      || plan.projection.revision.residency !== rebuilt.projection.revision.residency
      || plan.projection.projectionHash !== rebuilt.projection.projectionHash
      || plan.projection.compatibilityChecksum !== rebuilt.projection.compatibilityChecksum
      || plan.projection.extensionChecksum !== rebuilt.projection.extensionChecksum
      || plan.projection.chunkCount !== rebuilt.projection.chunkCount
      || plan.projection.editCount !== rebuilt.projection.editCount
      || plan.projection.facingCount !== rebuilt.projection.facingCount
      || plan.projection.collapsedDuplicateEdits !== rebuilt.projection.collapsedDuplicateEdits
      || plan.projection.ignoredOrphanFacings !== rebuilt.projection.ignoredOrphanFacings
      || !equalBytes(plan.projection.bytes, rebuilt.projection.bytes)) {
      throw this.error("legacy-plan", "legacy BWAS projection does not match the canonical source plan");
    }
    const address = Object.freeze({ ...rebuilt.projection.address });
    if (`${address.universeId}@${address.locationId}` !== this.worldId) {
      throw this.error("legacy-address", "legacy migration plan belongs to another native persistence world");
    }
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < source.byteLength; offset += RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1) {
      chunks.push(source.slice(offset, Math.min(source.byteLength, offset + RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1)));
    }
    if (chunks.length < 1 || chunks.length > RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1) {
      throw this.error("legacy-source", "canonical legacy source exceeds the bounded compatibility chunk count");
    }
    const compatibilityHasher = new TypeScriptCanonicalHasher("blockwild-persistence-compatibility-stream-v1");
    const chunkHashes: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      compatibilityHasher.writeU32(index).writeBytes(chunks[index]);
      chunkHashes.push(persistencePayloadHashV1(chunks[index]));
    }
    const projection = Uint8Array.from(rebuilt.projection.bytes);
    return Object.freeze({
      address,
      source,
      sourceKey: sourceIdentity.sourceKey,
      sourceFormat: sourceIdentity.sourceFormat,
      createdAt: sourceIdentity.createdAt,
      sourceSemanticHash: rebuilt.sourceSemanticHash,
      projection,
      projectionHash: rebuilt.projection.projectionHash,
      projectionEditCount: rebuilt.projection.editCount,
      projectionFacingCount: rebuilt.projection.facingCount,
      chunks: Object.freeze(chunks),
      chunkHashes: Object.freeze(chunkHashes),
      compatibilityStreamHash: compatibilityHasher.finishHex(),
      migrationId: `legacy.world-only.v1.${rebuilt.sourceSemanticHash}.${rebuilt.projection.projectionHash}`,
    });
  }

  private validateCreatedAt(createdAt: number, purpose: string) {
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw this.error("created-at", `${purpose} timestamp is outside JavaScript's exact unsigned range`);
    }
  }

  private async verifyCheckpointCompatibility(
    checkpoint: PersistenceCheckpointV1,
    expected: PreparedCompatibilityProofV1,
  ): Promise<CompatibilityCheckpointVerificationV1> {
    if (checkpoint.worldId !== this.worldId) {
      return Object.freeze({ status: "mismatch", message: "compatibility checkpoint belongs to another persistence world" });
    }
    const descriptors = compatibilityRecordDescriptors(checkpoint);
    if (descriptors.length !== expected.chunks.length) {
      return Object.freeze({ status: "mismatch", message: "compatibility checkpoint has the wrong source chunk count" });
    }
    let bytes = 0;
    for (let index = 0; index < expected.chunks.length; index += 1) {
      const recordId = `${RUST_NATIVE_WORLD_COMPATIBILITY_RECORD_PREFIX_V1}${index.toString(16).padStart(8, "0")}`;
      const descriptor = descriptors.find((candidate) => candidate.address.recordId === recordId);
      if (!descriptor
        || descriptor.address.universeId !== expected.address.universeId
        || descriptor.address.locationId !== expected.address.locationId
        || descriptor.address.kind !== "settings-reference"
        || descriptor.byteLength !== expected.chunks[index].byteLength
        || descriptor.payloadHash !== expected.chunkHashes[index]) {
        return Object.freeze({ status: "mismatch", message: `compatibility checkpoint record ${recordId} does not match the expected source descriptor` });
      }
      let payload: Uint8Array | null;
      try { payload = await this.checkpoints.readRecord(descriptor.address, descriptor.revision); }
      catch (error) {
        return Object.freeze({ status: "storage-error", message: failureMessage(error, `compatibility checkpoint record ${recordId} could not be read`) });
      }
      if (!payload
        || payload.byteLength !== descriptor.byteLength
        || persistencePayloadHashV1(payload) !== descriptor.payloadHash
        || !equalBytes(payload, expected.chunks[index])) {
        return Object.freeze({ status: "mismatch", message: `compatibility checkpoint record ${recordId} failed exact byte/hash readback` });
      }
      bytes += payload.byteLength;
    }
    if (bytes !== expected.source.byteLength) {
      return Object.freeze({ status: "mismatch", message: "compatibility checkpoint source byte total does not match the expected source" });
    }
    return Object.freeze({ status: "exact", proof: Object.freeze({ descriptors: Object.freeze([...descriptors]), bytes }) });
  }

  private expectedLegacySaveAddresses(expected: PreparedCompatibilityProofV1) {
    const addresses: PersistenceRecordAddressV1[] = RUST_NATIVE_WORLD_RECORD_ADDRESSES_V1.map((record) => ({
      universeId: expected.address.universeId,
      locationId: expected.address.locationId,
      kind: record.kind,
      recordId: record.recordId,
    }));
    for (let index = 0; index < expected.chunks.length; index += 1) {
      addresses.push({
        universeId: expected.address.universeId,
        locationId: expected.address.locationId,
        kind: "settings-reference",
        recordId: `${RUST_NATIVE_WORLD_COMPATIBILITY_RECORD_PREFIX_V1}${index.toString(16).padStart(8, "0")}`,
      });
    }
    addresses.sort((left, right) => {
      const leftKey = persistenceRecordKeyV1(left);
      const rightKey = persistenceRecordKeyV1(right);
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    });
    return addresses;
  }

  private async verifyPartialLegacyCheckpoint(
    checkpoint: PersistenceCheckpointV1,
    expected: PreparedCompatibilityProofV1,
  ): Promise<PartialLegacyCheckpointVerificationV1> {
    if (checkpoint.worldId !== this.worldId) {
      return Object.freeze({ status: "mismatch", message: "partial migration checkpoint belongs to another persistence world" });
    }
    const expectedAddresses = this.expectedLegacySaveAddresses(expected);
    if (checkpoint.records.length < 1 || checkpoint.records.length >= expectedAddresses.length) {
      return Object.freeze({ status: "mismatch", message: "checkpoint is not a strict record-address prefix of the expected native migration" });
    }
    if (checkpoint.parentCheckpointId === null
      ? checkpoint.journalSequence !== 1
      : checkpoint.journalSequence <= 1) {
      return Object.freeze({ status: "mismatch", message: "partial migration checkpoint does not have a pristine migration journal position" });
    }
    let compatibilityRecords = 0;
    for (let index = 0; index < checkpoint.records.length; index += 1) {
      const descriptor = checkpoint.records[index];
      if (!sameRecordAddress(descriptor.address, expectedAddresses[index])
        || descriptor.revision !== 1
        || descriptor.byteLength < 1) {
        return Object.freeze({ status: "mismatch", message: "checkpoint records are not the canonical pristine migration prefix" });
      }
      const compatibility = /^compatibility-v1-([0-9a-f]{8})$/u.exec(descriptor.address.recordId);
      const chunkIndex = compatibility ? Number.parseInt(compatibility[1], 16) : null;
      if (chunkIndex !== null) {
        if (chunkIndex >= expected.chunks.length
          || descriptor.byteLength !== expected.chunks[chunkIndex].byteLength
          || descriptor.payloadHash !== expected.chunkHashes[chunkIndex]) {
          return Object.freeze({ status: "mismatch", message: "partial migration compatibility prefix belongs to a different source" });
        }
        compatibilityRecords += 1;
      }
      let payload: Uint8Array | null;
      try { payload = await this.checkpoints.readRecord(descriptor.address, descriptor.revision); }
      catch (error) {
        return Object.freeze({ status: "storage-error", message: failureMessage(error, "partial migration record could not be read") });
      }
      if (!(payload instanceof Uint8Array)
        || payload.byteLength !== descriptor.byteLength
        || persistencePayloadHashV1(payload) !== descriptor.payloadHash
        || chunkIndex !== null && !equalBytes(payload, expected.chunks[chunkIndex])) {
        return Object.freeze({ status: "mismatch", message: "partial migration record failed exact revision readback" });
      }
    }
    return Object.freeze({ status: "strict-prefix", records: checkpoint.records.length, compatibilityRecords });
  }

  private async verifyHydratedCompatibility(
    recoveryId: string,
    hydration: Awaited<ReturnType<NativeRuntimeControl["hydrateCompatibilityRecovery"]>>,
    expected: PreparedCompatibilityProofV1,
  ) {
    if (hydration.chunkCount !== expected.chunks.length
      || hydration.totalBytes !== expected.source.byteLength
      || hydration.compatibilityHash !== expected.compatibilityStreamHash) {
      return "Rust hydration compatibility attestation does not match the expected source";
    }
    const migration = hydration.legacyMigration;
    const expectedMigrationId = `${expected.migrationId}.${expected.createdAt.toString(36)}`;
    if (!migration
      || migration.migrationId !== expectedMigrationId
      || migration.createdAt !== expected.createdAt
      || migration.sourceKey !== expected.sourceKey
      || migration.sourceFormat !== expected.sourceFormat
      || migration.sourceByteLength !== expected.source.byteLength
      || migration.sourceHash !== expected.sourceSemanticHash
      || migration.projectionHash !== expected.projectionHash
      || migration.projectionEditCount !== expected.projectionEditCount
      || migration.projectionFacingCount !== expected.projectionFacingCount
      || migration.worldId !== this.worldId
      || migration.universeId !== expected.address.universeId
      || migration.locationId !== expected.address.locationId
      || migration.backupByteLength !== expected.source.byteLength
      || migration.backupHash !== expected.compatibilityStreamHash
      || migration.backupChunks !== expected.chunks.length) {
      return "Rust hydration migration descriptor does not match the exact source, projection, backup, or target";
    }
    if (migration.nativeWorldSemanticHash !== expected.projectionHash
      || migration.nativeWorldEditCount !== expected.projectionEditCount
      || migration.nativeWorldFacingCount !== expected.projectionFacingCount) {
      return "Rust semantic readback does not reproduce the exact projected edits and facings";
    }
    let bytes = 0;
    for (let index = 0; index < expected.chunks.length; index += 1) {
      let response: Awaited<ReturnType<NativeRuntimeControl["readHydratedCompatibility"]>>;
      try { response = await this.runtime.readHydratedCompatibility(recoveryId, index); }
      catch (error) { return failureMessage(error, `Rust hydration compatibility chunk ${index} could not be read`); }
      if (response.chunkIndex !== index
        || response.chunkCount !== expected.chunks.length
        || !(response.payload instanceof Uint8Array)
        || persistencePayloadHashV1(response.payload) !== expected.chunkHashes[index]
        || !equalBytes(response.payload, expected.chunks[index])) {
        return `Rust hydration compatibility chunk ${index} failed exact byte/hash readback`;
      }
      bytes += response.payload.byteLength;
    }
    return bytes === expected.source.byteLength ? null : "Rust hydration compatibility byte total is incomplete";
  }

  private async performRecovery(
    expected: PreparedCompatibilityProofV1 | null,
  ): Promise<RustNativeWorldPersistenceRecoveryV1> {
    let latest: PersistenceCheckpointV1 | null;
    try { latest = await this.checkpoints.readLatestCheckpoint(this.worldId); }
    catch (error) {
      const message = failureMessage(error, "checkpoint head could not be read");
      this.rememberError("storage-corrupt", message);
      return Object.freeze({ status: "blocked", worldId: this.worldId, code: "storage-corrupt", message, attemptedCheckpointIds: Object.freeze([]) });
    }
    if (!latest) return Object.freeze({ status: "empty", worldId: this.worldId });

    const candidates: PersistenceCheckpointV1[] = [];
    const seen = new Set<string>();
    let cursor: PersistenceCheckpointV1 | null = latest;
    while (cursor && candidates.length <= this.maxParentFallbacks) {
      if (cursor.worldId !== this.worldId || seen.has(cursor.checkpointId)) {
        const message = "checkpoint parent chain is cyclic or belongs to another world";
        this.rememberError("storage-corrupt", message);
        return Object.freeze({ status: "blocked", worldId: this.worldId, code: "storage-corrupt", message, attemptedCheckpointIds: Object.freeze(candidates.map((candidate) => candidate.checkpointId)) });
      }
      candidates.push(cursor);
      seen.add(cursor.checkpointId);
      if (!cursor.parentCheckpointId) {
        cursor = null;
        continue;
      }
      try { cursor = await this.checkpoints.readCheckpoint(this.worldId, cursor.parentCheckpointId); }
      catch (error) {
        const message = failureMessage(error, "checkpoint parent could not be read");
        this.rememberError("storage-corrupt", message);
        return Object.freeze({
          status: "blocked",
          worldId: this.worldId,
          code: "storage-corrupt",
          message,
          attemptedCheckpointIds: Object.freeze(candidates.map((candidate) => candidate.checkpointId)),
        });
      }
    }

    const attempted: string[] = [];
    for (let depth = 0; depth < candidates.length; depth += 1) {
      const checkpoint = candidates[depth];
      attempted.push(checkpoint.checkpointId);
      let checkpointProof: CompatibilityCheckpointProofV1 | null = null;
      if (expected) {
        const verification = await this.verifyCheckpointCompatibility(checkpoint, expected);
        if (verification.status !== "exact") {
          const code = verification.status === "storage-error" ? "storage-corrupt" : "compatibility-source-mismatch";
          this.rememberError(code, verification.message);
          return Object.freeze({ status: "blocked", worldId: this.worldId, code, message: verification.message, attemptedCheckpointIds: Object.freeze([...attempted]) });
        }
        checkpointProof = verification.proof;
      } else if (compatibilityRecordDescriptors(checkpoint).length > 0
        && !hasCanonicalMigrationDescriptor(checkpoint)) {
        const message = "durable save contains protected compatibility bytes but no exact compatibility proof was supplied";
        this.rememberError("compatibility-adapter-required", message);
        return Object.freeze({ status: "blocked", worldId: this.worldId, code: "compatibility-adapter-required", message, attemptedCheckpointIds: Object.freeze([...attempted]) });
      }
      try {
        await this.port.recover(this.worldId, checkpoint.checkpointId);
        await this.drain();
        // Request one immutable record at a time. The recovery-only page
        // budget admits one maximum-size record plus bounded framing, while
        // a unit stride cannot skip the Rust-reported next cursor.
        for (let start = 0; start < checkpoint.records.length; start += RUST_NATIVE_WORLD_PERSISTENCE_RECOVERY_RECORDS_PER_PAGE_V1) {
          await this.port.readRecoveryPage(
            this.worldId,
            checkpoint.checkpointId,
            start,
            Math.min(
              RUST_PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1,
              RUST_NATIVE_WORLD_PERSISTENCE_RECOVERY_RECORDS_PER_PAGE_V1,
              checkpoint.records.length - start,
            ),
          );
          await this.drain();
        }
        const hydration = await this.runtime.hydrateCompatibilityRecovery(checkpoint.checkpointId);
        this.recoveries += 1;
        this.parentFallbacks += depth;
        this.lastCheckpointId = checkpoint.checkpointId;
        if (expected) {
          const mismatch = await this.verifyHydratedCompatibility(checkpoint.checkpointId, hydration, expected);
          if (mismatch || !checkpointProof) {
            const message = mismatch ?? "browser compatibility checkpoint proof was lost before hydration";
            this.rememberError("compatibility-source-mismatch", message);
            return Object.freeze({ status: "blocked", worldId: this.worldId, code: "compatibility-source-mismatch", message, attemptedCheckpointIds: Object.freeze([...attempted]) });
          }
        } else if ((hydration.chunkCount > 0 || hydration.totalBytes > 0) && !hydration.legacyMigration) {
          const message = "durable save contains protected compatibility bytes but no lossless WorldSave adapter is installed";
          this.rememberError("compatibility-adapter-required", message);
          return Object.freeze({ status: "blocked", worldId: this.worldId, code: "compatibility-adapter-required", message, attemptedCheckpointIds: Object.freeze([...attempted]) });
        }
        this.lastError = null;
        return Object.freeze({
          status: "hydrated",
          worldId: this.worldId,
          checkpointId: checkpoint.checkpointId,
          fallbackDepth: depth,
          nativeDomains: hydration.nativeDomains,
          checkpointRecords: checkpoint.records.length,
          compatibility: expected && checkpointProof ? Object.freeze({
            sourceSemanticHash: expected.sourceSemanticHash,
            chunks: checkpointProof.descriptors.length,
            bytes: checkpointProof.bytes,
          }) : null,
          migration: hydration.legacyMigration,
        });
      } catch (error) {
        if (!(error instanceof RustIntegratedRuntimeServiceError) || error.code !== "bulk-platform") throw error;
        this.rememberError(error.code, error.message);
      }
    }
    const message = this.lastError?.message ?? "no retained checkpoint passed native hydration";
    return Object.freeze({ status: "blocked", worldId: this.worldId, code: "recovery-exhausted", message, attemptedCheckpointIds: Object.freeze([...attempted]) });
  }

  private async completePendingLegacyMigration(
    expected: PreparedCompatibilityProofV1,
    marker: PendingLegacyMigrationV1,
    operationsBefore: number,
    requestBytesBefore: number,
    responseBytesBefore: number,
    drainMode: "required" | "optional",
  ): Promise<RustNativeWorldLegacyMigrationV1> {
    const drained = await this.drain();
    if (drainMode === "required" && drained.operations < 1) {
      throw this.error("durability", "pending legacy migration did not advance any durable platform work");
    }
    const attestation = await this.port.status();
    const terminal = attestation.terminalCheckpoint;
    if (!attestation.terminal || !terminal || attestation.closed || attestation.pending !== 0 || attestation.queuedBytes !== 0) {
      throw this.error("durability", "legacy migration drained without a Rust terminal checkpoint attestation");
    }
    const head = await this.checkpoints.readLatestCheckpoint(this.worldId);
    if (!head || head.worldId !== this.worldId || head.createdAt !== marker.createdAt || head.journalSequence < 1) {
      throw this.error("durability", "legacy migration did not create the exact durable checkpoint head");
    }
    if (head.checkpointId !== terminal.checkpointId
      || head.checkpointHash !== terminal.checkpointHash
      || head.journalSequence !== terminal.journalSequence
      || head.records.length !== terminal.recordCount
      || marker.saveSetHash !== terminal.saveSetHash
      || marker.manifestHash !== terminal.manifestHash) {
      throw this.error("durability", "legacy migration checkpoint head does not match the exact Rust terminal attestation");
    }
    const compatibility = await this.verifyCheckpointCompatibility(head, expected);
    if (compatibility.status !== "exact") {
      throw this.error(
        compatibility.status === "storage-error" ? "storage-corrupt" : "durability",
        compatibility.message,
      );
    }
    const recovered = await this.performRecovery(expected);
    if (recovered.status !== "hydrated" || !recovered.compatibility || !recovered.migration) {
      const message = recovered.status === "blocked"
        ? recovered.message
        : "legacy migration completed without Rust-derived migration readback";
      throw this.error("legacy-migration-readback", message);
    }
    const migration = recovered.migration;
    if (migration.nativeWorldSemanticHash !== expected.projectionHash
      || migration.nativeWorldEditCount !== expected.projectionEditCount
      || migration.nativeWorldFacingCount !== expected.projectionFacingCount
      || migration.saveSetHash !== marker.saveSetHash
      || migration.manifestHash !== marker.manifestHash) {
      throw this.error(
        "legacy-migration-readback",
        "Rust semantic readback does not reproduce the exact projected edits, facings, and migration save set",
      );
    }
    this.pendingLegacyMigration = null;
    this.completedLegacyMigration = Object.freeze({
      ...marker,
      checkpointId: head.checkpointId,
      checkpointHash: head.checkpointHash,
    });
    this.saves += 1;
    this.legacyMigrations += 1;
    this.lastCheckpointId = head.checkpointId;
    this.lastError = null;
    return Object.freeze({
      status: "migrated",
      worldId: this.worldId,
      migrationId: marker.migrationId,
      checkpointId: head.checkpointId,
      checkpointHash: head.checkpointHash,
      journalSequence: head.journalSequence,
      createdAt: marker.createdAt,
      compatibilityRecords: compatibility.proof.descriptors.length,
      compatibilityBytes: compatibility.proof.bytes,
      sourceSemanticHash: marker.sourceSemanticHash,
      projectionHash: marker.projectionHash,
      saveSetHash: marker.saveSetHash,
      manifestHash: marker.manifestHash,
      descriptorHash: migration.descriptorHash,
      commits: this.platformOperations - operationsBefore,
      requestBytes: this.requestBytes - requestBytesBefore,
      responseBytes: this.responseBytes - responseBytesBefore,
    });
  }

  private async assembleCheckpointRecovery(checkpoint: PersistenceCheckpointV1) {
    await this.port.recover(this.worldId, checkpoint.checkpointId);
    await this.drain();
    for (let start = 0; start < checkpoint.records.length; start += RUST_NATIVE_WORLD_PERSISTENCE_RECOVERY_RECORDS_PER_PAGE_V1) {
      await this.port.readRecoveryPage(
        this.worldId,
        checkpoint.checkpointId,
        start,
        Math.min(
          RUST_PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1,
          RUST_NATIVE_WORLD_PERSISTENCE_RECOVERY_RECORDS_PER_PAGE_V1,
          checkpoint.records.length - start,
        ),
      );
      await this.drain();
    }
  }

  private async dispatchLegacyMigration(
    expected: PreparedCompatibilityProofV1,
    createdAt: number,
    operationsBefore: number,
    requestBytesBefore: number,
    responseBytesBefore: number,
  ) {
    const migrationId = `${expected.migrationId}.${createdAt.toString(36)}`;
    let receivedBytes = 0;
    for (let index = 0; index < expected.chunks.length; index += 1) {
      const receipt = await this.runtime.stageCompatibilitySaveChunk(
        migrationId,
        index,
        expected.chunks.length,
        expected.source.byteLength,
        Uint8Array.from(expected.chunks[index]),
      );
      receivedBytes += expected.chunks[index].byteLength;
      if (receipt.stageId !== migrationId
        || receipt.state !== "staged"
        || receipt.receivedChunks !== index + 1
        || receipt.chunkCount !== expected.chunks.length
        || receipt.receivedBytes !== receivedBytes
        || receipt.dispatcherRequestId !== 0
        || receipt.remainingDirtyRecords !== 0
        || receipt.setHash !== "0".repeat(32)
        || receipt.manifestHash !== "0".repeat(32)) {
        throw this.error("legacy-stage", "Rust compatibility stage receipt did not attest the exact ordered source prefix");
      }
    }
    const progress = await this.runtime.migrateLegacyWorldOnly(
      migrationId,
      createdAt,
      0,
      expected.sourceKey,
      expected.sourceFormat,
      Uint8Array.from(expected.projection),
    );
    if (progress.stageId !== migrationId
      || progress.state !== "finalized"
      || progress.receivedChunks !== expected.chunks.length
      || progress.chunkCount !== expected.chunks.length
      || progress.receivedBytes !== expected.source.byteLength
      || progress.dispatcherRequestId < 1) {
      throw this.error("legacy-migration", "Rust legacy migration gate did not finalize the exact staged source");
    }
    const marker = Object.freeze({
      migrationId,
      createdAt,
      sourceKey: expected.sourceKey,
      sourceFormat: expected.sourceFormat,
      sourceSemanticHash: expected.sourceSemanticHash,
      projectionHash: expected.projectionHash,
      saveSetHash: progress.setHash,
      manifestHash: progress.manifestHash,
    });
    this.pendingLegacyMigration = marker;
    return this.completePendingLegacyMigration(
      expected,
      marker,
      operationsBefore,
      requestBytesBefore,
      responseBytesBefore,
      "required",
    );
  }

  private async performLegacyWorldOnlyMigration(
    expected: PreparedCompatibilityProofV1,
    createdAt: number,
  ): Promise<RustNativeWorldLegacyMigrationV1> {
    let previousHead: PersistenceCheckpointV1 | null;
    try { previousHead = await this.checkpoints.readLatestCheckpoint(this.worldId); }
    catch (error) { throw this.error("storage-corrupt", failureMessage(error, "checkpoint head could not be read")); }
    const operationsBefore = this.platformOperations;
    const requestBytesBefore = this.requestBytes;
    const responseBytesBefore = this.responseBytes;
    const migrationId = `${expected.migrationId}.${createdAt.toString(36)}`;
    const pendingMatches = sameLegacyMigration(this.pendingLegacyMigration, expected, migrationId, createdAt);
    const completedMatches = sameLegacyMigration(this.completedLegacyMigration, expected, migrationId, createdAt);
    if (this.pendingLegacyMigration && !pendingMatches) {
      throw this.error("legacy-migration-pending", "another legacy migration remains in progress in this native session");
    }
    if (this.completedLegacyMigration && !completedMatches) {
      throw this.error("legacy-migration-existing", "this native session already completed a different legacy migration");
    }
    if (!previousHead && pendingMatches) {
      this.legacyMigrationRetries += 1;
      return this.completePendingLegacyMigration(
        expected,
        this.pendingLegacyMigration!,
        operationsBefore,
        requestBytesBefore,
        responseBytesBefore,
        "required",
      );
    }
    if (!previousHead && completedMatches) {
      throw this.error("storage-corrupt", "completed legacy migration attestation lost its durable checkpoint head");
    }
    if (previousHead) {
      const expectedRecordCount = this.expectedLegacySaveAddresses(expected).length;
      if (previousHead.records.length < expectedRecordCount) {
        if (previousHead.createdAt !== createdAt) {
          throw this.error("legacy-migration-existing", "partial migration checkpoint creation time does not match the requested migration");
        }
        const partial = await this.verifyPartialLegacyCheckpoint(previousHead, expected);
        if (partial.status !== "strict-prefix") {
          throw this.error(
            partial.status === "storage-error" ? "storage-corrupt" : "legacy-migration-existing",
            partial.message,
          );
        }
        this.legacyMigrationRetries += 1;
        if (pendingMatches) {
          return this.completePendingLegacyMigration(
            expected,
            this.pendingLegacyMigration!,
            operationsBefore,
            requestBytesBefore,
            responseBytesBefore,
            "required",
          );
        }
        if (completedMatches) {
          throw this.error("storage-corrupt", "completed legacy migration checkpoint regressed to an incomplete retained prefix");
        }
        await this.assembleCheckpointRecovery(previousHead);
        return this.dispatchLegacyMigration(
          expected,
          createdAt,
          operationsBefore,
          requestBytesBefore,
          responseBytesBefore,
        );
      }
      if (previousHead.records.length !== expectedRecordCount) {
        throw this.error("legacy-migration-existing", "existing checkpoint is not the exact native migration record set");
      }
      const browserCompatibility = await this.verifyCheckpointCompatibility(previousHead, expected);
      if (browserCompatibility.status !== "exact") {
        throw this.error(
          browserCompatibility.status === "storage-error" ? "storage-corrupt" : "legacy-migration-existing",
          browserCompatibility.message,
        );
      }
      if (pendingMatches) {
        this.legacyMigrationRetries += 1;
        return this.completePendingLegacyMigration(
          expected,
          this.pendingLegacyMigration!,
          operationsBefore,
          requestBytesBefore,
          responseBytesBefore,
          "optional",
        );
      }
      const recovered = await this.performRecovery(expected);
      if (recovered.status !== "hydrated" || !recovered.compatibility
        || !recovered.migration
        || recovered.compatibility.sourceSemanticHash !== expected.sourceSemanticHash) {
        const message = recovered.status === "blocked" ? recovered.message : "existing durable checkpoint did not prove the exact legacy source";
        throw this.error("legacy-migration-existing", message);
      }
      const checkpoint = await this.checkpoints.readCheckpoint(this.worldId, recovered.checkpointId);
      if (!checkpoint) throw this.error("storage-corrupt", "recovered migration checkpoint could not be read back");
      if (checkpoint.checkpointId !== previousHead.checkpointId
        || checkpoint.checkpointHash !== previousHead.checkpointHash) {
        throw this.error("legacy-migration-existing", "durable checkpoint head changed while proving the existing legacy migration");
      }
      const migration = recovered.migration;
      const attestation = await this.port.status();
      const terminal = attestation.terminalCheckpoint;
      if (!attestation.terminal || !terminal || attestation.closed || attestation.pending !== 0 || attestation.queuedBytes !== 0
        || terminal.checkpointId !== checkpoint.checkpointId
        || terminal.checkpointHash !== checkpoint.checkpointHash
        || terminal.journalSequence !== checkpoint.journalSequence
        || terminal.recordCount !== checkpoint.records.length
        || terminal.saveSetHash !== migration.saveSetHash
        || terminal.manifestHash !== migration.manifestHash) {
        throw this.error("legacy-migration-existing", "recovered migration does not reproduce its exact Rust terminal attestation");
      }
      this.legacyMigrationRetries += 1;
      this.pendingLegacyMigration = null;
      this.completedLegacyMigration = Object.freeze({
        migrationId: migration.migrationId,
        createdAt: migration.createdAt,
        sourceKey: migration.sourceKey,
        sourceFormat: migration.sourceFormat,
        sourceSemanticHash: migration.sourceHash,
        projectionHash: migration.projectionHash,
        saveSetHash: migration.saveSetHash,
        manifestHash: migration.manifestHash,
        checkpointId: checkpoint.checkpointId,
        checkpointHash: checkpoint.checkpointHash,
      });
      this.lastCheckpointId = checkpoint.checkpointId;
      this.lastError = null;
      return Object.freeze({
        status: "already-migrated",
        worldId: this.worldId,
        migrationId: migration.migrationId,
        checkpointId: checkpoint.checkpointId,
        checkpointHash: checkpoint.checkpointHash,
        journalSequence: checkpoint.journalSequence,
        createdAt: migration.createdAt,
        compatibilityRecords: recovered.compatibility.chunks,
        compatibilityBytes: recovered.compatibility.bytes,
        sourceSemanticHash: expected.sourceSemanticHash,
        projectionHash: expected.projectionHash,
        saveSetHash: migration.saveSetHash,
        manifestHash: migration.manifestHash,
        descriptorHash: migration.descriptorHash,
        commits: this.platformOperations - operationsBefore,
        requestBytes: this.requestBytes - requestBytesBefore,
        responseBytes: this.responseBytes - responseBytesBefore,
      });
    }
    return this.dispatchLegacyMigration(
      expected,
      createdAt,
      operationsBefore,
      requestBytesBefore,
      responseBytesBefore,
    );
  }

  private async performNativeSave(createdAt: number, purpose: "new" | "save"): Promise<RustNativeWorldPersistenceSaveV1> {
    this.validateCreatedAt(createdAt, "native save");
    const previousHead = await this.checkpoints.readLatestCheckpoint(this.worldId);
    if (purpose === "new" && previousHead) throw this.error("already-initialized", "native world already has a durable checkpoint head");
    const saveId = `native.${purpose}.${createdAt.toString(36)}.${this.nextSaveId++}`;
    const progress = await this.runtime.initializeNativeSave(saveId, createdAt);
    if (progress.dispatcherRequestId < 1) throw this.error("durability", "native save did not issue a Rust persistence transaction");
    const drained = await this.drain();
    const attestation = await this.port.status();
    const terminal = attestation.terminalCheckpoint;
    if (!attestation.terminal || !terminal || attestation.closed || attestation.pending !== 0 || attestation.queuedBytes !== 0) {
      throw this.error("durability", "native save drained without a Rust terminal checkpoint attestation");
    }
    const head = await this.checkpoints.readLatestCheckpoint(this.worldId);
    if (!head || head.worldId !== this.worldId) throw this.error("durability", "native save drained without an exact durable checkpoint head");
    if (drained.operations < 1 || head.journalSequence <= (previousHead?.journalSequence ?? 0)) {
      throw this.error("durability", "native save did not advance the exact durable checkpoint head");
    }
    if (head.checkpointId !== terminal.checkpointId
      || head.checkpointHash !== terminal.checkpointHash
      || head.journalSequence !== terminal.journalSequence
      || head.records.length !== terminal.recordCount
      || progress.setHash !== terminal.saveSetHash
      || progress.manifestHash !== terminal.manifestHash) {
      throw this.error("durability", "browser checkpoint head does not match the exact Rust terminal attestation");
    }
    this.saves += 1;
    this.lastCheckpointId = head.checkpointId;
    this.lastError = null;
    return Object.freeze({
      worldId: this.worldId,
      saveId,
      checkpointId: head.checkpointId,
      checkpointHash: head.checkpointHash,
      journalSequence: head.journalSequence,
      records: head.records.length,
      commits: drained.operations,
      requestBytes: drained.requestBytes,
      responseBytes: drained.responseBytes,
    });
  }

  private async drain(allowClosing = false) {
    if (this.pump.isClosed()) throw this.error("closed", "native persistence pump is already closed");
    if (!allowClosing && this.state !== "open") throw this.error("closed", `native persistence session is ${this.state}`);
    const result = await this.pump.flush();
    this.platformOperations += result.operations;
    this.requestBytes += result.requestBytes;
    this.responseBytes += result.responseBytes;
    if (!result.idle) throw this.error("drain", "native persistence pump stopped before Rust became idle");
    return result;
  }

  private enqueue<T>(work: () => Promise<T>) {
    if (this.state !== "open") return Promise.reject(this.error("closed", `native persistence session is ${this.state}`));
    const next = this.serial.then(work, work);
    this.serial = next.then(() => undefined, () => undefined);
    return next;
  }

  private error(code: string, message: string) {
    this.rememberError(code, message);
    return new Error(`${code}: ${message}`);
  }

  private rememberError(code: string, message: string) {
    this.lastError = Object.freeze({ code, message });
  }
}
