import {
  persistencePayloadHashV1,
  persistenceRecordKeyV1,
  type PersistenceCheckpointV1,
  type PersistenceRecordAddressV1,
  type PersistenceRecordDescriptorV1,
} from "./persistence-journal-contract";
import type {
  RustIntegratedPersistenceRuntimePortV1,
  RustIntegratedPersistenceStatusReceiptV1,
} from "./rust-integrated-runtime-persistence";
import type { RustIntegratedPersistencePumpV1 } from "./rust-integrated-persistence-pump";
import {
  RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_BULK_MAX_SAVE_CHUNKS_V1,
  RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1,
  type RustIntegratedRuntimeHistoricalExternalReceiptV2,
  type RustIntegratedRuntimeLegacyMigrationAttestationV1,
} from "./rust-integrated-runtime-bulk-platform";
import {
  RustIntegratedRuntimeServiceError,
  type RustIntegratedRuntimeServiceV1,
} from "./rust-integrated-runtime-service";
import {
  encodeRustPersistenceCheckpointWireV1,
  RUST_PERSISTENCE_PLATFORM_MAX_PAGE_RECORDS_V1,
} from "./rust-persistence-runtime-contract";
import {
  RUST_LEGACY_WORLD_MIGRATION_SCHEMA_V1,
  planRustLegacyWorldMigrationV1,
  requireRustLegacyWorldOnlyMigrationV1,
  type RustLegacyWorldMigrationPlanV1,
} from "./rust-legacy-world-migration";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import {
  assertRustHistoricalSaveCompatibilityPlanV1,
  type RustHistoricalSaveCompatibilityInputV1,
  type RustHistoricalSaveCompatibilityPlanV1,
} from "./rust-historical-save-compatibility";
import {
  advanceRustHistoricalExternalDescriptorProposalV2,
  assertRustHistoricalExternalDescriptorEnvelopeV2,
  assertRustHistoricalExternalDescriptorPlanV2,
  bindRustHistoricalExternalDescriptorProposalV2,
  createInitialRustHistoricalExternalDescriptorProposalV2,
  decodeRustHistoricalExternalDescriptorV2,
  decodeRustHistoricalStoredWorldEnvelopeV2,
  encodeRustHistoricalExternalDescriptorProposalV2,
  encodeRustHistoricalExternalDescriptorV2,
  rustHistoricalExternalDescriptorAddressV2,
  rustHistoricalExternalDocumentChunkAddressV2,
  RUST_HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2,
  RUST_HISTORICAL_EXTERNAL_DOCUMENT_RECORD_PREFIX_V2,
  RUST_HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2,
  RUST_HISTORICAL_EXTERNAL_PROFILE_V2,
  type RustHistoricalExternalDescriptorProposalV2,
  type RustHistoricalExternalDescriptorV2,
  type RustHistoricalStoredWorldEnvelopeV2,
} from "./rust-historical-save-persistence";
import {
  decodeCanonicalWorldSaveValueV1,
  encodeCanonicalWorldSaveValueV1,
} from "./world-save-sharding";
import type { StoredWorld } from "./world-storage";

type RustHistoricalExternalAnyReceiptV2 = RustIntegratedRuntimeHistoricalExternalReceiptV2;

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
  historicalMigrations?: number;
  historicalSaves?: number;
  historicalRecoveries?: number;
  historicalHead?: Readonly<{
    descriptorHash: string;
    documentHash: string;
    documentSha256: string;
    documentByteLength: number;
    documentRevision: number;
    sourceSha256: string;
    sourceByteLength: number;
    chunks: number;
    chunkSetHash: string;
    projectionHash: string;
    projectionEditCount: number;
    projectionFacingCount: number;
    nativeWorldSemanticHash: string;
    authorityClaim: typeof RUST_HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2;
    authorityProfile: typeof RUST_HISTORICAL_EXTERNAL_PROFILE_V2;
    nativePlayer: "off";
    nativeRichState: "not-adopted";
    checkpointId: string;
    checkpointHash: string;
    journalSequence: number;
  }> | null;
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
  captureHistoricalExternalReconciliationObservationV2?(
    worldId: string,
    fallbackCheckpointId: string,
  ): Promise<Uint8Array>;
}

type NativeRuntimeControl = Pick<
  RustIntegratedRuntimeServiceV1,
  "initializeNativeSave"
  | "stageCompatibilitySaveChunk"
  | "migrateLegacyWorldOnly"
  | "migrateHistoricalExternalV2"
  | "finalizeHistoricalExternalSaveV2"
  | "hydrateHistoricalExternalRecoveryV2"
  | "reconcileHistoricalExternalFallbackV2"
  | "hydrateCompatibilityRecovery"
  | "readHydratedCompatibility"
>;

export type RustNativeHistoricalExternalCommitV2 = Readonly<{
  status: "migrated" | "saved";
  worldId: string;
  checkpointId: string;
  checkpointHash: string;
  journalSequence: number;
  descriptor: RustHistoricalExternalDescriptorV2;
  envelope: RustHistoricalStoredWorldEnvelopeV2;
  document: StoredWorld;
  receipt: RustIntegratedRuntimeHistoricalExternalReceiptV2;
  records: number;
  commits: number;
  requestBytes: number;
  responseBytes: number;
}>;

export type RustNativeHistoricalExternalRecoveryV2 =
  | Readonly<{ status: "empty"; worldId: string }>
  | Readonly<{
    status: "hydrated";
    worldId: string;
    checkpointId: string;
    checkpointHash: string;
    journalSequence: number;
    fallbackDepth: number;
    descriptor: RustHistoricalExternalDescriptorV2;
    envelope: RustHistoricalStoredWorldEnvelopeV2;
    document: StoredWorld;
    receipt: RustIntegratedRuntimeHistoricalExternalReceiptV2;
  }>
  | Readonly<{
    status: "blocked";
    worldId: string;
    code: "historical-pair-mismatch" | "recovery-exhausted" | "storage-corrupt";
    message: string;
    attemptedCheckpointIds: readonly string[];
  }>;

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

type HistoricalExternalDecodedV2 = Awaited<ReturnType<typeof decodeRustHistoricalStoredWorldEnvelopeV2>>;

type HistoricalExternalCheckpointProofV2 = Readonly<{
  checkpoint: PersistenceCheckpointV1;
  descriptor: RustHistoricalExternalDescriptorV2;
  descriptorBytes: Uint8Array;
  decoded: HistoricalExternalDecodedV2;
}>;

type HistoricalExternalHeadV2 = HistoricalExternalCheckpointProofV2 & Readonly<{
  plan: RustHistoricalSaveCompatibilityPlanV1;
  receipt: RustIntegratedRuntimeHistoricalExternalReceiptV2;
  durability: "exact" | "prefix-continuation";
}>;

type HistoricalExpectedRecordV2 = Readonly<{
  address: PersistenceRecordAddressV1;
  revision: number;
  byteLength: number | null;
  payloadHash: string | null;
  bytes: Uint8Array | null;
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
  private historicalMigrations = 0;
  private historicalSaves = 0;
  private historicalRecoveries = 0;
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
  private historicalHead: HistoricalExternalHeadV2 | null = null;

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

  migrateHistoricalExternal(
    plan: RustHistoricalSaveCompatibilityPlanV1,
    currentInput: RustHistoricalSaveCompatibilityInputV1,
    initialEnvelope: RustHistoricalStoredWorldEnvelopeV2,
    createdAt: number,
  ): Promise<RustNativeHistoricalExternalCommitV2> {
    const decodedPromise = decodeRustHistoricalStoredWorldEnvelopeV2(initialEnvelope);
    // Start the exact archive/plan assertion immediately so its implementation
    // snapshots caller-owned bytes before this operation can wait in the queue.
    const assertedPlanPromise = (async () =>
      await assertRustHistoricalSaveCompatibilityPlanV1(plan, currentInput))();
    void decodedPromise.catch(() => undefined);
    void assertedPlanPromise.catch(() => undefined);
    return this.enqueue(async () => {
      const decoded = await decodedPromise;
      const assertedPlan = await assertedPlanPromise;
      const proposal = await createInitialRustHistoricalExternalDescriptorProposalV2(
        assertedPlan,
        decoded.envelope,
      );
      return this.performHistoricalExternalCommit(
        "initial-migration",
        proposal,
        decoded,
        assertedPlan,
        createdAt,
      );
    });
  }

  saveHistoricalExternal(
    previousDescriptor: RustHistoricalExternalDescriptorV2,
    nextEnvelope: RustHistoricalStoredWorldEnvelopeV2,
    createdAt: number,
  ): Promise<RustNativeHistoricalExternalCommitV2> {
    let suppliedBytes: Uint8Array;
    try { suppliedBytes = Uint8Array.from(encodeRustHistoricalExternalDescriptorV2(previousDescriptor)); }
    catch (error) { return Promise.reject(error); }
    const decodedPromise = decodeRustHistoricalStoredWorldEnvelopeV2(nextEnvelope);
    void decodedPromise.catch(() => undefined);
    return this.enqueue(async () => {
      const head = this.historicalHead;
      if (!head) {
        throw this.error(
          "historical-head-required",
          "historical external save requires an exact migrated or recovered session head",
        );
      }
      if (!equalBytes(suppliedBytes, head.descriptorBytes)) {
        throw this.error("historical-cas", "historical external save does not name the exact session descriptor head");
      }
      const decoded = await decodedPromise;
      const proposal = await advanceRustHistoricalExternalDescriptorProposalV2(head.descriptor, decoded.envelope);
      return this.performHistoricalExternalCommit(
        "external-save",
        proposal,
        decoded,
        head.plan,
        createdAt,
      );
    });
  }

  recoverHistoricalExternal(
    plan: RustHistoricalSaveCompatibilityPlanV1,
    currentInput: RustHistoricalSaveCompatibilityInputV1,
  ): Promise<RustNativeHistoricalExternalRecoveryV2> {
    const assertedPlanPromise = (async () =>
      await assertRustHistoricalSaveCompatibilityPlanV1(plan, currentInput))();
    void assertedPlanPromise.catch(() => undefined);
    return this.enqueue(async () => {
      const assertedPlan = await assertedPlanPromise;
      return this.performHistoricalExternalRecovery(assertedPlan);
    });
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
      historicalMigrations: this.historicalMigrations,
      historicalSaves: this.historicalSaves,
      historicalRecoveries: this.historicalRecoveries,
      historicalHead: this.historicalHead?.durability === "exact" ? Object.freeze({
        descriptorHash: this.historicalHead.descriptor.descriptorHash,
        documentHash: this.historicalHead.descriptor.mutable.currentDocument.hash,
        documentSha256: this.historicalHead.descriptor.mutable.currentDocument.sha256,
        documentByteLength: this.historicalHead.descriptor.mutable.currentDocument.byteLength,
        documentRevision: this.historicalHead.descriptor.mutable.currentDocument.revision,
        sourceSha256: this.historicalHead.descriptor.immutable.source.rawSha256,
        sourceByteLength: this.historicalHead.descriptor.immutable.source.byteLength,
        chunks: this.historicalHead.descriptor.mutable.chunks.length,
        chunkSetHash: this.historicalHead.descriptor.mutable.chunkSetHash,
        projectionHash: this.historicalHead.descriptor.immutable.bwas.projectionHash,
        projectionEditCount: this.historicalHead.descriptor.immutable.bwas.editCount,
        projectionFacingCount: this.historicalHead.descriptor.immutable.bwas.facingCount,
        nativeWorldSemanticHash: this.historicalHead.receipt.nativeWorldSemanticHash,
        authorityClaim: this.historicalHead.descriptor.immutable.authority.claim,
        authorityProfile: this.historicalHead.receipt.authorityProfile,
        nativePlayer: this.historicalHead.receipt.nativePlayer,
        nativeRichState: this.historicalHead.receipt.nativeRichState,
        checkpointId: this.historicalHead.checkpoint.checkpointId,
        checkpointHash: this.historicalHead.checkpoint.checkpointHash,
        journalSequence: this.historicalHead.checkpoint.journalSequence,
      }) : null,
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

  private async stageHistoricalExternalDocument(
    stageId: string,
    envelope: RustHistoricalStoredWorldEnvelopeV2,
  ) {
    let receivedBytes = 0;
    for (let index = 0; index < envelope.chunks.length; index += 1) {
      const chunk = envelope.chunks[index];
      if (chunk.index !== index
        || chunk.byteOffset !== receivedBytes
        || chunk.byteLength !== chunk.bytes.byteLength
        || chunk.payloadHash !== persistencePayloadHashV1(chunk.bytes)) {
        throw this.error("historical-stage", `historical external chunk ${index} lost its exact envelope binding`);
      }
      const progress = await this.runtime.stageCompatibilitySaveChunk(
        stageId,
        index,
        envelope.chunks.length,
        envelope.currentDocument.byteLength,
        Uint8Array.from(chunk.bytes),
      );
      receivedBytes += chunk.byteLength;
      if (progress.stageId !== stageId
        || progress.state !== "staged"
        || progress.receivedChunks !== index + 1
        || progress.chunkCount !== envelope.chunks.length
        || progress.receivedBytes !== receivedBytes
        || progress.dispatcherRequestId !== 0
        || progress.remainingDirtyRecords !== 0
        || progress.setHash !== "0".repeat(32)
        || progress.manifestHash !== "0".repeat(32)) {
        throw this.error(
          "historical-stage",
          "Rust historical external stage receipt did not attest the exact ordered document prefix",
        );
      }
    }
    if (receivedBytes !== envelope.currentDocument.byteLength) {
      throw this.error("historical-stage", "historical external staging did not consume the exact document length");
    }
  }

  private historicalManifestAddress(
    descriptor: RustHistoricalExternalDescriptorV2,
  ): PersistenceRecordAddressV1 {
    return Object.freeze({
      universeId: descriptor.immutable.target.universeId,
      locationId: descriptor.immutable.target.locationId,
      kind: "location-manifest",
      recordId: RUST_NATIVE_WORLD_MANIFEST_RECORD_ID_V1,
    });
  }

  private historicalExpectedRecords(
    descriptor: RustHistoricalExternalDescriptorV2,
    descriptorBytes: Uint8Array,
    envelope: RustHistoricalStoredWorldEnvelopeV2,
    previous: PersistenceCheckpointV1 | null,
  ) {
    const previousByKey = new Map(
      (previous?.records ?? []).map(record => [persistenceRecordKeyV1(record.address), record]),
    );
    const expected = new Map<string, HistoricalExpectedRecordV2>();
    const add = (record: HistoricalExpectedRecordV2, label: string) => {
      const key = persistenceRecordKeyV1(record.address);
      if (expected.has(key)) throw this.error("historical-prefix", `${label} collides with another historical record`);
      expected.set(key, record);
    };
    const revisionFor = (address: PersistenceRecordAddressV1, byteLength: number, payloadHash: string) => {
      const prior = previousByKey.get(persistenceRecordKeyV1(address));
      if (!prior) return 1;
      if (prior.byteLength === byteLength && prior.payloadHash === payloadHash) return prior.revision;
      if (prior.revision >= Number.MAX_SAFE_INTEGER) {
        throw this.error("historical-prefix", `historical record ${address.recordId} exhausted its CAS revision`);
      }
      return prior.revision + 1;
    };

    const descriptorAddress = rustHistoricalExternalDescriptorAddressV2(
      descriptor.immutable.target.universeId,
      descriptor.immutable.target.locationId,
    );
    const descriptorHash = persistencePayloadHashV1(descriptorBytes);
    add(Object.freeze({
      address: descriptorAddress,
      revision: revisionFor(descriptorAddress, descriptorBytes.byteLength, descriptorHash),
      byteLength: descriptorBytes.byteLength,
      payloadHash: descriptorHash,
      bytes: descriptorBytes,
    }), "historical descriptor");

    for (const record of descriptor.mutable.nativeRecords) {
      const revision = revisionFor(record.address, record.byteLength, record.payloadHash);
      if (record.revision !== revision) {
        throw this.error(
          "historical-prefix",
          `historical native record ${record.address.recordId} has a non-CAS revision`,
        );
      }
      add(Object.freeze({
        address: record.address,
        revision,
        byteLength: record.byteLength,
        payloadHash: record.payloadHash,
        bytes: null,
      }), `historical native record ${record.address.recordId}`);
    }

    for (const fingerprint of descriptor.mutable.chunks) {
      const address = rustHistoricalExternalDocumentChunkAddressV2(
        descriptor.immutable.target.universeId,
        descriptor.immutable.target.locationId,
        fingerprint.index,
      );
      const chunk = envelope.chunks[fingerprint.index];
      if (!chunk
        || chunk.byteLength !== fingerprint.byteLength
        || chunk.payloadHash !== fingerprint.payloadHash) {
        throw this.error("historical-prefix", `historical external chunk ${fingerprint.index} lost its BWHE binding`);
      }
      add(Object.freeze({
        address,
        revision: revisionFor(address, fingerprint.byteLength, fingerprint.payloadHash),
        byteLength: fingerprint.byteLength,
        payloadHash: fingerprint.payloadHash,
        bytes: chunk.bytes,
      }), `historical external chunk ${fingerprint.index}`);
    }

    const manifestAddress = this.historicalManifestAddress(descriptor);
    const previousManifest = previousByKey.get(persistenceRecordKeyV1(manifestAddress));
    if (previousManifest && previousManifest.revision >= Number.MAX_SAFE_INTEGER) {
      throw this.error("historical-prefix", "historical native manifest exhausted its CAS revision");
    }
    add(Object.freeze({
      address: manifestAddress,
      revision: previousManifest ? previousManifest.revision + 1 : 1,
      // BWHE binds the manifest through the Rust receipt and terminal
      // attestation, not circularly through its own payload.
      byteLength: null,
      payloadHash: null,
      bytes: null,
    }), "historical native manifest");
    return [...expected.values()].sort((left, right) => {
      const leftKey = persistenceRecordKeyV1(left.address);
      const rightKey = persistenceRecordKeyV1(right.address);
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    });
  }

  private historicalExpectedRecordMatches(
    actual: PersistenceRecordDescriptorV1 | null,
    expected: HistoricalExpectedRecordV2 | null,
  ) {
    if (!actual || !expected) return actual === null && expected === null;
    return sameRecordAddress(actual.address, expected.address)
      && actual.revision === expected.revision
      && (expected.byteLength === null || actual.byteLength === expected.byteLength)
      && (expected.payloadHash === null || actual.payloadHash === expected.payloadHash);
  }

  private async readHistoricalProposalDescriptor(
    checkpoint: PersistenceCheckpointV1,
    proposal: RustHistoricalExternalDescriptorProposalV2,
    decoded: HistoricalExternalDecodedV2,
    plan: RustHistoricalSaveCompatibilityPlanV1,
    createdAt: number,
  ) {
    if (checkpoint.worldId !== this.worldId
      || checkpoint.createdAt !== createdAt
      || checkpoint.generatorHash !== plan.target.generationIdentity.generatorHash
      || checkpoint.contentHash !== plan.target.contentHash) {
      throw this.error(
        "historical-prefix",
        "historical prefix has a changed world, timestamp, generator, or content identity",
      );
    }
    const address = rustHistoricalExternalDescriptorAddressV2(
      plan.target.universeId,
      plan.target.locationId,
    );
    const records = checkpoint.records.filter(record => sameRecordAddress(record.address, address));
    if (records.length !== 1) {
      throw this.error("historical-prefix", "historical prefix has no unique Rust-authored BWHE descriptor");
    }
    const descriptorBytes = await this.readExactCheckpointRecord(
      checkpoint,
      records[0],
      "historical prefix BWHE descriptor",
    );
    let descriptor: RustHistoricalExternalDescriptorV2;
    try { descriptor = decodeRustHistoricalExternalDescriptorV2(descriptorBytes); }
    catch (error) {
      throw this.error("historical-prefix", failureMessage(error, "historical prefix BWHE is invalid"));
    }
    if (!equalBytes(encodeRustHistoricalExternalDescriptorV2(descriptor), descriptorBytes)) {
      throw this.error("historical-prefix", "historical prefix BWHE bytes are not canonical");
    }
    const rebound = bindRustHistoricalExternalDescriptorProposalV2(proposal, descriptor.mutable.nativeRecords);
    if (!equalBytes(encodeRustHistoricalExternalDescriptorV2(rebound), descriptorBytes)) {
      throw this.error("historical-prefix", "historical prefix BWHE does not bind the identical BWHP proposal");
    }
    try {
      await assertRustHistoricalExternalDescriptorPlanV2(descriptor, plan, decoded.envelope);
      await assertRustHistoricalExternalDescriptorEnvelopeV2(descriptor, decoded.envelope);
    } catch (error) {
      throw this.error(
        "historical-prefix",
        failureMessage(error, "historical prefix BWHE differs from the exact archive custody plan"),
      );
    }
    return Object.freeze({ descriptor, descriptorBytes, descriptorRecord: records[0] });
  }

  private async verifyInitialHistoricalPrefix(
    latest: PersistenceCheckpointV1,
    proposal: RustHistoricalExternalDescriptorProposalV2,
    decoded: HistoricalExternalDecodedV2,
    plan: RustHistoricalSaveCompatibilityPlanV1,
    createdAt: number,
  ) {
    const bound = await this.readHistoricalProposalDescriptor(latest, proposal, decoded, plan, createdAt);
    const expected = this.historicalExpectedRecords(
      bound.descriptor,
      bound.descriptorBytes,
      decoded.envelope,
      null,
    );
    if (latest.records.length < 1 || latest.records.length >= expected.length) {
      throw this.error("historical-prefix", "existing historical migration head is not a strict save-set prefix");
    }

    const seen = new Set<string>();
    let checkpoint: PersistenceCheckpointV1 | null = latest;
    let childRecordCount = expected.length;
    while (checkpoint) {
      if (seen.has(checkpoint.checkpointId)
        || checkpoint.worldId !== this.worldId
        || checkpoint.createdAt !== createdAt
        || checkpoint.generatorHash !== plan.target.generationIdentity.generatorHash
        || checkpoint.contentHash !== plan.target.contentHash
        || checkpoint.records.length < 1
        || checkpoint.records.length >= childRecordCount) {
        throw this.error("historical-prefix", "historical migration prefix ancestry is ambiguous or non-canonical");
      }
      seen.add(checkpoint.checkpointId);
      for (let index = 0; index < checkpoint.records.length; index += 1) {
        const actual = checkpoint.records[index];
        const target = expected[index];
        if (!target || !this.historicalExpectedRecordMatches(actual, target)) {
          throw this.error("historical-prefix", "historical migration checkpoint is not the exact canonical record prefix");
        }
        const payload = await this.readExactCheckpointRecord(
          checkpoint,
          actual,
          `historical migration prefix record ${actual.address.recordId}`,
        );
        if (target.bytes && !equalBytes(payload, target.bytes)) {
          throw this.error("historical-prefix", "historical migration prefix record differs from its exact proposal bytes");
        }
      }
      if (!checkpoint.parentCheckpointId) {
        if (checkpoint.journalSequence !== 1) {
          throw this.error("historical-prefix", "historical migration prefix does not begin at a pristine journal");
        }
        break;
      }
      if (seen.size >= expected.length) {
        throw this.error("historical-prefix", "historical migration prefix ancestry exceeds its save-set bound");
      }
      let parent: PersistenceCheckpointV1 | null;
      try { parent = await this.checkpoints.readCheckpoint(this.worldId, checkpoint.parentCheckpointId); }
      catch (error) {
        throw this.error("storage-corrupt", failureMessage(error, "historical migration prefix parent could not be read"));
      }
      if (!parent || parent.journalSequence + 1 !== checkpoint.journalSequence) {
        throw this.error("historical-prefix", "historical migration prefix parent is missing or discontinuous");
      }
      childRecordCount = checkpoint.records.length;
      checkpoint = parent;
    }
  }

  private async verifySuccessorHistoricalPrefix(
    latest: PersistenceCheckpointV1,
    previous: HistoricalExternalHeadV2,
    proposal: RustHistoricalExternalDescriptorProposalV2,
    decoded: HistoricalExternalDecodedV2,
    plan: RustHistoricalSaveCompatibilityPlanV1,
    createdAt: number,
  ) {
    const bound = await this.readHistoricalProposalDescriptor(latest, proposal, decoded, plan, createdAt);
    const expectedRecords = this.historicalExpectedRecords(
      bound.descriptor,
      bound.descriptorBytes,
      decoded.envelope,
      previous.checkpoint,
    );
    const finalByKey = new Map(expectedRecords.map(record => [persistenceRecordKeyV1(record.address), record]));
    const previousByKey = new Map(previous.checkpoint.records.map(record => [persistenceRecordKeyV1(record.address), record]));
    const actualByKey = new Map(latest.records.map(record => [persistenceRecordKeyV1(record.address), record]));
    if (actualByKey.size !== latest.records.length) {
      throw this.error("historical-prefix", "historical successor prefix contains duplicate record addresses");
    }
    const unionKeys = [...new Set([...previousByKey.keys(), ...finalByKey.keys()])].sort();
    if (latest.records.some(record => !unionKeys.includes(persistenceRecordKeyV1(record.address)))) {
      throw this.error("historical-prefix", "historical successor prefix contains a record outside the exact prior/final save sets");
    }
    const dirtyKeys = unionKeys.filter((key) => {
      const prior = previousByKey.get(key) ?? null;
      const final = finalByKey.get(key) ?? null;
      return !prior || !final || !this.historicalExpectedRecordMatches(prior, final);
    });
    if (dirtyKeys.length < 2) {
      throw this.error("historical-prefix", "historical successor has no bounded strict-prefix continuation");
    }
    const dirtyKeySet = new Set(dirtyKeys);
    for (const key of unionKeys) {
      if (!dirtyKeySet.has(key)
        && !this.historicalExpectedRecordMatches(actualByKey.get(key) ?? null, finalByKey.get(key) ?? null)) {
        throw this.error(
          "historical-prefix",
          "historical successor prefix dropped or changed an otherwise clean record",
        );
      }
    }

    let committed = 0;
    let reachedPriorSuffix = false;
    for (const key of dirtyKeys) {
      const actual = actualByKey.get(key) ?? null;
      const final = finalByKey.get(key) ?? null;
      const prior = previousByKey.get(key) ?? null;
      const isFinal = this.historicalExpectedRecordMatches(actual, final);
      const isPrior = this.historicalExpectedRecordMatches(actual, prior ? Object.freeze({
        address: prior.address,
        revision: prior.revision,
        byteLength: prior.byteLength,
        payloadHash: prior.payloadHash,
        bytes: null,
      }) : null);
      if (isFinal && !reachedPriorSuffix) committed += 1;
      else if (isPrior) reachedPriorSuffix = true;
      else {
        throw this.error("historical-prefix", "historical successor checkpoint is not a canonical dirty-record prefix");
      }
    }
    if (committed < 1 || committed >= dirtyKeys.length) {
      throw this.error("historical-prefix", "existing historical successor is not a strict dirty-record prefix");
    }

    const actualKeys = latest.records.map(record => persistenceRecordKeyV1(record.address));
    const sortedActualKeys = [...actualKeys].sort();
    if (!equalStrings(actualKeys, sortedActualKeys)) {
      throw this.error("historical-prefix", "historical successor checkpoint records are not canonically ordered");
    }
    for (const actual of latest.records) {
      const payload = await this.readExactCheckpointRecord(
        latest,
        actual,
        `historical successor prefix record ${actual.address.recordId}`,
      );
      const final = finalByKey.get(persistenceRecordKeyV1(actual.address));
      if (final?.bytes && this.historicalExpectedRecordMatches(actual, final) && !equalBytes(payload, final.bytes)) {
        throw this.error("historical-prefix", "historical successor prefix differs from its exact final document bytes");
      }
    }
    for (const native of bound.descriptor.mutable.nativeRecords) {
      const actual = actualByKey.get(persistenceRecordKeyV1(native.address)) ?? null;
      const expected = finalByKey.get(persistenceRecordKeyV1(native.address)) ?? null;
      if (!this.historicalExpectedRecordMatches(actual, expected)) {
        throw this.error(
          "historical-prefix",
          `historical successor cannot resume before native record ${native.address.recordId} is exact`,
        );
      }
    }

    const seen = new Set<string>();
    let cursor: PersistenceCheckpointV1 | null = latest;
    while (cursor.checkpointId !== previous.checkpoint.checkpointId) {
      if (seen.has(cursor.checkpointId)
        || !cursor.parentCheckpointId
        || cursor.worldId !== this.worldId
        || cursor.journalSequence <= previous.checkpoint.journalSequence
        || seen.size > dirtyKeys.length) {
        throw this.error("historical-prefix", "historical successor prefix is not descended from the exact session head");
      }
      seen.add(cursor.checkpointId);
      let parent: PersistenceCheckpointV1 | null;
      try { parent = await this.checkpoints.readCheckpoint(this.worldId, cursor.parentCheckpointId); }
      catch (error) {
        throw this.error("storage-corrupt", failureMessage(error, "historical successor prefix parent could not be read"));
      }
      if (!parent || parent.journalSequence + 1 !== cursor.journalSequence) {
        throw this.error("historical-prefix", "historical successor prefix ancestry is missing or discontinuous");
      }
      if (parent.checkpointId !== previous.checkpoint.checkpointId && parent.createdAt !== createdAt) {
        throw this.error("historical-prefix", "historical successor prefix ancestry has a changed timestamp");
      }
      cursor = parent;
    }
    if (cursor.checkpointHash !== previous.checkpoint.checkpointHash) {
      throw this.error("historical-prefix", "historical successor prefix descends from a changed descriptor head");
    }
  }

  private async readExactCheckpointRecord(
    checkpoint: PersistenceCheckpointV1,
    expected: PersistenceRecordDescriptorV1,
    label: string,
  ) {
    const matches = checkpoint.records.filter(record => sameRecordAddress(record.address, expected.address));
    if (matches.length !== 1) {
      throw this.error("historical-pair-mismatch", `${label} is missing or duplicated in the checkpoint`);
    }
    const descriptor = matches[0];
    if (descriptor.revision !== expected.revision
      || descriptor.byteLength !== expected.byteLength
      || descriptor.payloadHash !== expected.payloadHash) {
      throw this.error("historical-pair-mismatch", `${label} descriptor differs from its exact BWHE binding`);
    }
    let payload: Uint8Array | null;
    try { payload = await this.checkpoints.readRecord(descriptor.address, descriptor.revision); }
    catch (error) {
      throw this.error("storage-corrupt", failureMessage(error, `${label} exact revision could not be read`));
    }
    if (!(payload instanceof Uint8Array)
      || payload.byteLength !== descriptor.byteLength
      || persistencePayloadHashV1(payload) !== descriptor.payloadHash) {
      throw this.error("historical-pair-mismatch", `${label} failed exact byte/hash readback`);
    }
    return Uint8Array.from(payload);
  }

  private async checkpointRecordPayloadsAreExact(checkpoint: PersistenceCheckpointV1) {
    for (const descriptor of checkpoint.records) {
      let payload: Uint8Array | null;
      try { payload = await this.checkpoints.readRecord(descriptor.address, descriptor.revision); }
      catch { return false; }
      if (!(payload instanceof Uint8Array)
        || payload.byteLength !== descriptor.byteLength
        || persistencePayloadHashV1(payload) !== descriptor.payloadHash) return false;
    }
    return true;
  }

  private async readHistoricalExternalCheckpoint(
    checkpoint: PersistenceCheckpointV1,
    plan: RustHistoricalSaveCompatibilityPlanV1,
  ): Promise<HistoricalExternalCheckpointProofV2> {
    if (checkpoint.worldId !== this.worldId) {
      throw this.error("historical-pair-mismatch", "historical checkpoint belongs to another persistence world");
    }
    const descriptorAddress = rustHistoricalExternalDescriptorAddressV2(
      plan.target.universeId,
      plan.target.locationId,
    );
    const descriptorRecords = checkpoint.records.filter(record => sameRecordAddress(record.address, descriptorAddress));
    if (descriptorRecords.length !== 1) {
      throw this.error("historical-pair-mismatch", "historical checkpoint has no unique BWHE descriptor");
    }
    const descriptorBytes = await this.readExactCheckpointRecord(
      checkpoint,
      descriptorRecords[0],
      "historical BWHE descriptor",
    );
    let descriptor: RustHistoricalExternalDescriptorV2;
    try { descriptor = decodeRustHistoricalExternalDescriptorV2(descriptorBytes); }
    catch (error) {
      throw this.error("historical-pair-mismatch", failureMessage(error, "historical BWHE descriptor is invalid"));
    }
    if (!equalBytes(encodeRustHistoricalExternalDescriptorV2(descriptor), descriptorBytes)) {
      throw this.error("historical-pair-mismatch", "historical BWHE descriptor bytes are not canonical");
    }
    if (`${descriptor.immutable.target.universeId}@${descriptor.immutable.target.locationId}` !== this.worldId
      || checkpoint.generatorHash !== descriptor.immutable.target.generationIdentity.generatorHash
      || checkpoint.contentHash !== descriptor.immutable.target.contentHash) {
      throw this.error(
        "historical-pair-mismatch",
        "historical checkpoint world, generator, or content identity differs from BWHE",
      );
    }

    const expectedByKey = new Map<string, PersistenceRecordDescriptorV1>();
    const addExpected = (record: PersistenceRecordDescriptorV1, label: string) => {
      const key = persistenceRecordKeyV1(record.address);
      if (expectedByKey.has(key)) throw this.error("historical-pair-mismatch", `${label} collides with another record`);
      expectedByKey.set(key, record);
    };
    for (const record of descriptor.mutable.nativeRecords) addExpected(record, "historical native record");
    addExpected(descriptorRecords[0], "historical descriptor");

    const chunks = [] as Array<RustHistoricalStoredWorldEnvelopeV2["chunks"][number]>;
    for (const fingerprint of descriptor.mutable.chunks) {
      const address = rustHistoricalExternalDocumentChunkAddressV2(
        descriptor.immutable.target.universeId,
        descriptor.immutable.target.locationId,
        fingerprint.index,
      );
      const records = checkpoint.records.filter(record => sameRecordAddress(record.address, address));
      if (records.length !== 1
        || records[0].byteLength !== fingerprint.byteLength
        || records[0].payloadHash !== fingerprint.payloadHash) {
        throw this.error(
          "historical-pair-mismatch",
          `historical external document chunk ${fingerprint.index} differs from BWHE`,
        );
      }
      addExpected(records[0], `historical external document chunk ${fingerprint.index}`);
      const bytes = await this.readExactCheckpointRecord(
        checkpoint,
        records[0],
        `historical external document chunk ${fingerprint.index}`,
      );
      chunks.push(Object.freeze({ ...fingerprint, bytes }));
    }

    const manifestAddress: PersistenceRecordAddressV1 = Object.freeze({
      universeId: descriptor.immutable.target.universeId,
      locationId: descriptor.immutable.target.locationId,
      kind: "location-manifest",
      recordId: RUST_NATIVE_WORLD_MANIFEST_RECORD_ID_V1,
    });
    const manifests = checkpoint.records.filter(record => sameRecordAddress(record.address, manifestAddress));
    if (manifests.length !== 1) {
      throw this.error("historical-pair-mismatch", "historical checkpoint has no unique native manifest");
    }
    addExpected(manifests[0], "historical native manifest");

    const checkpointKeys = checkpoint.records.map(record => persistenceRecordKeyV1(record.address));
    if (checkpoint.records.length !== expectedByKey.size
      || checkpointKeys.some(key => !expectedByKey.has(key))
      || checkpoint.records.some(record => record.address.recordId.startsWith(RUST_NATIVE_WORLD_COMPATIBILITY_RECORD_PREFIX_V1))
      || checkpoint.records.some(record => record.address.recordId.startsWith(RUST_HISTORICAL_EXTERNAL_DOCUMENT_RECORD_PREFIX_V2)
        && !expectedByKey.has(persistenceRecordKeyV1(record.address)))) {
      throw this.error(
        "historical-pair-mismatch",
        "historical checkpoint is not the exact BWHE, external document, native record, and manifest set",
      );
    }
    for (const record of descriptor.mutable.nativeRecords) {
      await this.readExactCheckpointRecord(checkpoint, record, `historical native record ${record.address.recordId}`);
    }
    await this.readExactCheckpointRecord(checkpoint, manifests[0], "historical native manifest");

    const source = { ...descriptor.immutable.source };
    delete (source as Partial<typeof source>).generatorVersion;
    const envelope: RustHistoricalStoredWorldEnvelopeV2 = Object.freeze({
      schemaVersion: descriptor.schemaVersion,
      format: "blockwild-stored-world-canonical-json-v2",
      source,
      initialDocument: descriptor.immutable.initialDocument,
      currentDocument: descriptor.mutable.currentDocument,
      expectedPreviousDocument: descriptor.mutable.expectedPreviousDocument,
      chunks: Object.freeze(chunks),
      chunkSetHash: descriptor.mutable.chunkSetHash,
    });
    let decoded: HistoricalExternalDecodedV2;
    try {
      // This guard binds a structurally valid BWHE to the freshly revalidated
      // raw archive, catalog target, content/options identities and custody plan.
      decoded = await assertRustHistoricalExternalDescriptorPlanV2(descriptor, plan, envelope);
      await assertRustHistoricalExternalDescriptorEnvelopeV2(descriptor, decoded.envelope);
    } catch (error) {
      throw this.error("historical-pair-mismatch", failureMessage(error, "historical descriptor custody is invalid"));
    }
    return Object.freeze({
      checkpoint,
      descriptor,
      descriptorBytes,
      decoded,
    });
  }

  private validateHistoricalExternalReceipt(
    receipt: RustHistoricalExternalAnyReceiptV2,
    proof: HistoricalExternalCheckpointProofV2,
    operation: RustHistoricalExternalAnyReceiptV2["operation"],
    operationId: string,
    terminal: NonNullable<RustIntegratedPersistenceStatusReceiptV1["terminalCheckpoint"]>,
  ) {
    const { descriptor, checkpoint } = proof;
    const external = descriptor.mutable;
    const bwas = descriptor.immutable.bwas;
    const operationIdentityMatches = operation === "recovery" || operation === "reconciliation"
      ? receipt.recoveryId === operationId && receipt.stageId === null
      : receipt.stageId === operationId && receipt.recoveryId === null;
    if (receipt.operation !== operation
      || !operationIdentityMatches
      || receipt.createdAt !== checkpoint.createdAt
      || receipt.authorityProfile !== RUST_HISTORICAL_EXTERNAL_PROFILE_V2
      || receipt.nativePlayer !== "off"
      || receipt.nativeRichState !== "not-adopted"
      || (operation === "reconciliation") !== (receipt.reconciliation !== null)
      || descriptor.immutable.authority.claim !== RUST_HISTORICAL_EXTERNAL_AUTHORITY_CLAIM_V2
      || descriptor.immutable.nativeExecutionScope !== RUST_HISTORICAL_EXTERNAL_NATIVE_EXECUTION_SCOPE_V2
      || receipt.externalStateFlags !== descriptor.immutable.externalStateFlags
      || receipt.descriptorHash !== descriptor.descriptorHash
      || receipt.externalDocumentHash !== external.currentDocument.hash
      || receipt.externalDocumentByteLength !== external.currentDocument.byteLength
      || receipt.externalDocumentRevision !== external.currentDocument.revision
      || receipt.externalChunkCount !== external.chunks.length
      || receipt.externalChunkSetHash !== external.chunkSetHash
      || receipt.projectionHash !== bwas.projectionHash
      || receipt.projectionByteLength !== bwas.projectionByteLength
      || receipt.saveSetHash !== terminal.saveSetHash
      || receipt.manifestHash !== terminal.manifestHash
      || operation === "recovery"
        && (receipt.dispatcherRequestId !== 0 || receipt.remainingDirtyRecords !== 0)
      || operation === "reconciliation"
        && (receipt.dispatcherRequestId < 1 || receipt.remainingDirtyRecords !== 0)
      || (operation === "initial-migration" || operation === "external-save")
        && (receipt.dispatcherRequestId < 1 || receipt.remainingDirtyRecords < 1)) {
      throw this.error(
        "historical-pair-mismatch",
        "Rust historical receipt differs from the exact descriptor, document, authority, or terminal checkpoint",
      );
    }
    if ((operation === "initial-migration" || external.currentDocument.revision === 1)
      && (receipt.nativeWorldSemanticHash !== bwas.projectionHash
        || receipt.nativeWorldEditCount !== bwas.editCount
        || receipt.nativeWorldFacingCount !== bwas.facingCount)) {
      throw this.error(
        "historical-pair-mismatch",
        "Rust historical migration did not read back the exact admitted R4 BWAS projection",
      );
    }
  }

  private async requireHistoricalTerminal(
    checkpoint: PersistenceCheckpointV1,
    saveSetHash: string,
    manifestHash: string,
  ) {
    const status = await this.port.status();
    const terminal = status.terminalCheckpoint;
    if (!status.terminal || !terminal || status.closed || status.pending !== 0 || status.queuedBytes !== 0
      || terminal.checkpointId !== checkpoint.checkpointId
      || terminal.checkpointHash !== checkpoint.checkpointHash
      || terminal.journalSequence !== checkpoint.journalSequence
      || terminal.recordCount !== checkpoint.records.length
      || terminal.saveSetHash !== saveSetHash
      || terminal.manifestHash !== manifestHash) {
      throw this.error(
        "historical-pair-mismatch",
        "historical external pair does not reproduce the exact Rust terminal checkpoint attestation",
      );
    }
    return terminal;
  }

  private async reconcileHistoricalFallback(
    observedLatest: PersistenceCheckpointV1,
    fallback: HistoricalExternalCheckpointProofV2,
    fallbackReceipt: RustIntegratedRuntimeHistoricalExternalReceiptV2,
    plan: RustHistoricalSaveCompatibilityPlanV1,
  ) {
    if (observedLatest.parentCheckpointId !== fallback.checkpoint.checkpointId
      || observedLatest.journalSequence !== fallback.checkpoint.journalSequence + 1
      || observedLatest.worldId !== fallback.checkpoint.worldId
      || observedLatest.generatorHash !== fallback.checkpoint.generatorHash
      || observedLatest.contentHash !== fallback.checkpoint.contentHash) {
      throw this.error(
        "historical-reconciliation",
        "historical fallback repair requires one exact corrupt direct-child observation",
      );
    }
    const capture = this.checkpoints.captureHistoricalExternalReconciliationObservationV2;
    const reconcile = this.runtime.reconcileHistoricalExternalFallbackV2;
    if (!capture || !reconcile) {
      throw this.error(
        "historical-reconciliation",
        "historical fallback remains read-only because atomic reconciliation is unavailable",
      );
    }

    const observation = await capture.call(
      this.checkpoints,
      this.worldId,
      fallback.checkpoint.checkpointId,
    );
    // The capture must be the final browser read before Rust consumes the
    // BWHO. Its executor performs the authoritative storage-revision/head CAS.
    const transport = await reconcile.call(
      this.runtime,
      fallback.checkpoint.checkpointId,
      observedLatest.createdAt,
      Uint8Array.from(observation),
    );
    const receipt = transport.receipt;
    const reconciliation = receipt.reconciliation;
    if (receipt.operation !== "reconciliation"
      || !reconciliation
      || receipt.stageId !== null
      || receipt.recoveryId !== fallback.checkpoint.checkpointId
      || receipt.createdAt !== observedLatest.createdAt
      || receipt.authorityProfile !== RUST_HISTORICAL_EXTERNAL_PROFILE_V2
      || receipt.nativePlayer !== "off"
      || receipt.nativeRichState !== "not-adopted"
      || receipt.externalStateFlags !== fallback.descriptor.immutable.externalStateFlags
      || receipt.externalDocumentHash !== fallback.descriptor.mutable.currentDocument.hash
      || receipt.externalDocumentByteLength !== fallback.descriptor.mutable.currentDocument.byteLength
      || receipt.externalDocumentRevision !== fallback.descriptor.mutable.currentDocument.revision
      || receipt.externalChunkCount !== fallback.descriptor.mutable.chunks.length
      || receipt.externalChunkSetHash !== fallback.descriptor.mutable.chunkSetHash
      || receipt.projectionHash !== fallback.descriptor.immutable.bwas.projectionHash
      || receipt.projectionByteLength !== fallback.descriptor.immutable.bwas.projectionByteLength
      || receipt.nativeWorldSemanticHash !== fallbackReceipt.nativeWorldSemanticHash
      || receipt.nativeWorldEditCount !== fallbackReceipt.nativeWorldEditCount
      || receipt.nativeWorldFacingCount !== fallbackReceipt.nativeWorldFacingCount
      || receipt.dispatcherRequestId < 1
      || receipt.remainingDirtyRecords !== 0
      || reconciliation.observationHash !== persistencePayloadHashV1(observation)
      || reconciliation.observedLatestCheckpointId !== observedLatest.checkpointId
      || reconciliation.observedLatestCheckpointHash !== observedLatest.checkpointHash
      || reconciliation.observedLatestJournalSequence !== observedLatest.journalSequence
      || reconciliation.fallbackCheckpointId !== fallback.checkpoint.checkpointId
      || reconciliation.fallbackCheckpointHash !== fallback.checkpoint.checkpointHash
      || reconciliation.fallbackJournalSequence !== fallback.checkpoint.journalSequence
      || reconciliation.targetJournalSequence !== observedLatest.journalSequence + 1) {
      throw this.error(
        "historical-reconciliation",
        "Rust fallback reconciliation receipt differs from the captured corrupt head or exact fallback",
      );
    }

    const drained = await this.drain();
    if (drained.operations < 1) {
      throw this.error("historical-reconciliation", "historical fallback reconciliation did not commit platform work");
    }
    const target = await this.checkpoints.readLatestCheckpoint(this.worldId);
    if (!target
      || target.checkpointId !== reconciliation.targetCheckpointId
      || target.checkpointHash !== reconciliation.targetCheckpointHash
      || target.journalSequence !== reconciliation.targetJournalSequence
      || target.parentCheckpointId !== observedLatest.checkpointId
      || target.worldId !== this.worldId
      || target.generatorHash !== observedLatest.generatorHash
      || target.contentHash !== observedLatest.contentHash
      || target.createdAt !== observedLatest.createdAt) {
      throw this.error(
        "historical-reconciliation",
        "browser durable head does not equal the Rust-planned forward reconciliation checkpoint",
      );
    }
    const reconciliationTerminal = await this.requireHistoricalTerminal(
      target,
      receipt.saveSetHash,
      receipt.manifestHash,
    );
    const targetProof = await this.readHistoricalExternalCheckpoint(target, plan);
    if (!equalBytes(targetProof.decoded.canonicalBytes, fallback.decoded.canonicalBytes)
      || targetProof.descriptor.mutable.currentDocument.hash !== fallback.descriptor.mutable.currentDocument.hash
      || targetProof.descriptor.mutable.currentDocument.revision !== fallback.descriptor.mutable.currentDocument.revision
      || targetProof.descriptor.mutable.chunkSetHash !== fallback.descriptor.mutable.chunkSetHash) {
      throw this.error(
        "historical-reconciliation",
        "forward reconciliation changed the exact fallback external document",
      );
    }
    this.validateHistoricalExternalReceipt(
      receipt,
      targetProof,
      "reconciliation",
      fallback.checkpoint.checkpointId,
      reconciliationTerminal,
    );

    await this.assembleCheckpointRecovery(target);
    const hydration = await this.runtime.hydrateHistoricalExternalRecoveryV2(target.checkpointId);
    const hydratedReceipt = hydration.receipt;
    const hydratedTerminal = await this.requireHistoricalTerminal(
      target,
      hydratedReceipt.saveSetHash,
      hydratedReceipt.manifestHash,
    );
    this.validateHistoricalExternalReceipt(
      hydratedReceipt,
      targetProof,
      "recovery",
      target.checkpointId,
      hydratedTerminal,
    );
    if (hydratedReceipt.nativeWorldSemanticHash !== receipt.nativeWorldSemanticHash
      || hydratedReceipt.nativeWorldEditCount !== receipt.nativeWorldEditCount
      || hydratedReceipt.nativeWorldFacingCount !== receipt.nativeWorldFacingCount) {
      throw this.error(
        "historical-reconciliation",
        "post-repair Rust hydration differs from the reconciled native authority",
      );
    }
    return Object.freeze({ proof: targetProof, receipt: hydratedReceipt });
  }

  private async performHistoricalExternalCommit(
    operation: "initial-migration" | "external-save",
    proposal: RustHistoricalExternalDescriptorProposalV2,
    decoded: HistoricalExternalDecodedV2,
    plan: RustHistoricalSaveCompatibilityPlanV1,
    createdAt: number,
  ): Promise<RustNativeHistoricalExternalCommitV2> {
    this.validateCreatedAt(createdAt, "historical external save");
    const previousHead = await this.checkpoints.readLatestCheckpoint(this.worldId);
    let recoveredPrefix: PersistenceCheckpointV1 | null = null;
    if (operation === "initial-migration") {
      if (this.historicalHead) {
        throw this.error("historical-existing", "initial historical external migration requires a pristine durable world");
      }
      if (previousHead) {
        await this.verifyInitialHistoricalPrefix(previousHead, proposal, decoded, plan, createdAt);
        recoveredPrefix = previousHead;
      }
    } else {
      const expected = this.historicalHead;
      if (!expected
        || !previousHead) {
        throw this.error("historical-cas", "historical external save has no exact durable descriptor head");
      }
      if (previousHead.checkpointId !== expected.checkpoint.checkpointId
        || previousHead.checkpointHash !== expected.checkpoint.checkpointHash) {
        await this.verifySuccessorHistoricalPrefix(
          previousHead,
          expected,
          proposal,
          decoded,
          plan,
          createdAt,
        );
        recoveredPrefix = previousHead;
      }
    }
    if (`${proposal.immutable.target.universeId}@${proposal.immutable.target.locationId}` !== this.worldId) {
      throw this.error("historical-address", "historical descriptor proposal belongs to another native persistence world");
    }
    const stageId = `historical.${operation === "initial-migration" ? "migrate" : "save"}.v2.${createdAt.toString(36)}.${proposal.proposalHash}`;
    const operationsBefore = this.platformOperations;
    const requestBytesBefore = this.requestBytes;
    const responseBytesBefore = this.responseBytes;
    if (recoveredPrefix) await this.assembleCheckpointRecovery(recoveredPrefix);
    await this.stageHistoricalExternalDocument(stageId, decoded.envelope);
    const proposalBytes = encodeRustHistoricalExternalDescriptorProposalV2(proposal);
    const transport = operation === "initial-migration"
      ? await this.runtime.migrateHistoricalExternalV2(
        stageId,
        createdAt,
        proposalBytes,
        Uint8Array.from(plan.nativeWorld.projectionBytes),
      )
      : await this.runtime.finalizeHistoricalExternalSaveV2(
        stageId,
        createdAt,
        proposalBytes,
        encodeRustPersistenceCheckpointWireV1(this.historicalHead!.checkpoint),
      );
    const receipt = transport.receipt;
    if (receipt.operation !== operation
      || receipt.stageId !== stageId
      || receipt.recoveryId !== null
      || receipt.createdAt !== createdAt
      || receipt.dispatcherRequestId < 1
      || receipt.remainingDirtyRecords < 1) {
      throw this.error("historical-receipt", "Rust historical operation did not return its exact pending receipt");
    }
    const drained = await this.drain();
    if (drained.operations < 1) {
      throw this.error("historical-durability", "historical external operation did not advance durable platform work");
    }
    const head = await this.checkpoints.readLatestCheckpoint(this.worldId);
    if (!head
      || head.worldId !== this.worldId
      || head.createdAt !== createdAt
      || head.journalSequence <= (previousHead?.journalSequence ?? 0)) {
      throw this.error("historical-durability", "historical external operation did not create an advanced durable head");
    }
    const terminal = await this.requireHistoricalTerminal(head, receipt.saveSetHash, receipt.manifestHash);
    const proof = await this.readHistoricalExternalCheckpoint(head, plan);
    const rebound = bindRustHistoricalExternalDescriptorProposalV2(proposal, proof.descriptor.mutable.nativeRecords);
    if (!equalBytes(encodeRustHistoricalExternalDescriptorV2(rebound), proof.descriptorBytes)) {
      throw this.error(
        "historical-pair-mismatch",
        "persisted BWHE is not the exact Rust-native binding of the submitted BWHP proposal",
      );
    }
    this.validateHistoricalExternalReceipt(receipt, proof, operation, stageId, terminal);
    this.historicalHead = Object.freeze({ ...proof, plan, receipt, durability: "exact" });
    this.saves += 1;
    if (operation === "initial-migration") this.historicalMigrations += 1;
    else this.historicalSaves += 1;
    this.lastCheckpointId = head.checkpointId;
    this.lastError = null;
    return Object.freeze({
      status: operation === "initial-migration" ? "migrated" : "saved",
      worldId: this.worldId,
      checkpointId: head.checkpointId,
      checkpointHash: head.checkpointHash,
      journalSequence: head.journalSequence,
      descriptor: proof.descriptor,
      envelope: proof.decoded.envelope,
      document: proof.decoded.document,
      receipt,
      records: head.records.length,
      commits: this.platformOperations - operationsBefore,
      requestBytes: this.requestBytes - requestBytesBefore,
      responseBytes: this.responseBytes - responseBytesBefore,
    });
  }

  private async performHistoricalExternalRecovery(
    plan: RustHistoricalSaveCompatibilityPlanV1,
  ): Promise<RustNativeHistoricalExternalRecoveryV2> {
    let latest: PersistenceCheckpointV1 | null;
    try { latest = await this.checkpoints.readLatestCheckpoint(this.worldId); }
    catch (error) {
      const message = failureMessage(error, "historical checkpoint head could not be read");
      this.rememberError("storage-corrupt", message);
      return Object.freeze({
        status: "blocked",
        worldId: this.worldId,
        code: "storage-corrupt",
        message,
        attemptedCheckpointIds: Object.freeze([]),
      });
    }
    if (!latest) {
      this.historicalHead = null;
      this.lastError = null;
      return Object.freeze({ status: "empty", worldId: this.worldId });
    }
    const latestPayloadsAreExact = await this.checkpointRecordPayloadsAreExact(latest);
    const candidates: PersistenceCheckpointV1[] = [];
    const seen = new Set<string>();
    let cursor: PersistenceCheckpointV1 | null = latest;
    while (cursor && candidates.length <= this.maxParentFallbacks) {
      if (cursor.worldId !== this.worldId || seen.has(cursor.checkpointId)) {
        const message = "historical checkpoint parent chain is cyclic or crosses worlds";
        this.rememberError("storage-corrupt", message);
        return Object.freeze({
          status: "blocked",
          worldId: this.worldId,
          code: "storage-corrupt",
          message,
          attemptedCheckpointIds: Object.freeze(candidates.map(candidate => candidate.checkpointId)),
        });
      }
      candidates.push(cursor);
      seen.add(cursor.checkpointId);
      if (!cursor.parentCheckpointId) break;
      try { cursor = await this.checkpoints.readCheckpoint(this.worldId, cursor.parentCheckpointId); }
      catch (error) {
        const message = failureMessage(error, "historical checkpoint parent could not be read");
        this.rememberError("storage-corrupt", message);
        return Object.freeze({
          status: "blocked",
          worldId: this.worldId,
          code: "storage-corrupt",
          message,
          attemptedCheckpointIds: Object.freeze(candidates.map(candidate => candidate.checkpointId)),
        });
      }
    }

    const attempted: string[] = [];
    let failure = "no retained checkpoint proved an exact historical external/native pair";
    for (let depth = 0; depth < candidates.length; depth += 1) {
      const checkpoint = candidates[depth];
      attempted.push(checkpoint.checkpointId);
      try {
        if (depth > 1) {
          throw this.error(
            "historical-reconciliation",
            "historical fallback repair cannot skip more than one observed durable head",
          );
        }
        let proof = await this.readHistoricalExternalCheckpoint(checkpoint, plan);
        await this.assembleCheckpointRecovery(checkpoint);
        const transport = await this.runtime.hydrateHistoricalExternalRecoveryV2(checkpoint.checkpointId);
        let receipt = transport.receipt;
        const terminal = await this.requireHistoricalTerminal(checkpoint, receipt.saveSetHash, receipt.manifestHash);
        this.validateHistoricalExternalReceipt(receipt, proof, "recovery", checkpoint.checkpointId, terminal);

        let durability: HistoricalExternalHeadV2["durability"] = "exact";
        if (depth === 1) {
          if (latestPayloadsAreExact) {
            // An intact but incomplete successor may use its verified parent as
            // the semantic basis only for retrying the identical BWHP. The
            // strict-prefix verifier owns that continuation; diagnostics must
            // not expose this parent as a generally writable durable head.
            durability = "prefix-continuation";
          } else {
            const reconciled = await this.reconcileHistoricalFallback(latest, proof, receipt, plan);
            proof = reconciled.proof;
            receipt = reconciled.receipt;
          }
        }

        this.historicalHead = Object.freeze({ ...proof, plan, receipt, durability });
        this.historicalRecoveries += 1;
        this.recoveries += 1;
        this.parentFallbacks += depth;
        this.lastCheckpointId = proof.checkpoint.checkpointId;
        this.lastError = null;
        return Object.freeze({
          status: "hydrated",
          worldId: this.worldId,
          checkpointId: proof.checkpoint.checkpointId,
          checkpointHash: proof.checkpoint.checkpointHash,
          journalSequence: proof.checkpoint.journalSequence,
          fallbackDepth: depth,
          descriptor: proof.descriptor,
          envelope: proof.decoded.envelope,
          document: proof.decoded.document,
          receipt,
        });
      } catch (error) {
        if (error instanceof RustIntegratedRuntimeServiceError && error.code !== "bulk-platform") throw error;
        failure = failureMessage(error, failure);
        this.rememberError("historical-pair-mismatch", failure);
        // The only supported repair is an atomic direct-child reconciliation.
        // Once its exact fallback has been considered, proceeding farther back
        // would create an ambiguous writable lineage.
        if (depth >= 1) break;
      }
    }
    this.historicalHead = null;
    return Object.freeze({
      status: "blocked",
      worldId: this.worldId,
      code: "recovery-exhausted",
      message: failure,
      attemptedCheckpointIds: Object.freeze(attempted),
    });
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
