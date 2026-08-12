import type { WorldSave } from "./engine";
import {
  createLegacyMigrationBundleV1,
  persistenceRecordKeyV1,
  type PersistenceCheckpointV1,
  type PersistenceCommitResultV1,
  type PersistencePlatformAdapterV1,
  type PersistenceRecordDescriptorV1,
  type PersistenceTransactionV1,
} from "./persistence-journal-contract";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import {
  checkpointWorldSaveShardsV1,
  decodeCanonicalWorldSaveValueV1,
  encodeCanonicalWorldSaveValueV1,
  planWorldSaveJournalV1,
  restoreWorldSaveV1,
  shardWorldSaveV1,
  type WorldSaveManifestV1,
  type WorldSaveShardSetV1,
  type WorldSaveShardV1,
} from "./world-save-sharding";

export type WorldPersistenceAdapterV1 = PersistencePlatformAdapterV1 & Readonly<{
  commit(transaction: PersistenceTransactionV1, checkpoint?: PersistenceCheckpointV1): Promise<PersistenceCommitResultV1>;
  putCheckpoint(checkpoint: PersistenceCheckpointV1, markLatest?: boolean): Promise<void>;
  readLatestCheckpoint(worldId: string): Promise<PersistenceCheckpointV1 | null>;
  deleteWorld?: (worldId: string) => Promise<void>;
  commitMigration?: (input: Readonly<{
    bundle: ReturnType<typeof createLegacyMigrationBundleV1>;
    sourcePayload: Uint8Array;
    checkpoint: PersistenceCheckpointV1;
    recordPayloads: ReadonlyMap<string, Uint8Array>;
  }>) => Promise<void>;
  verifyMigrationReadback?: (input: Readonly<{
    bundle: ReturnType<typeof createLegacyMigrationBundleV1>;
    checkpoint: PersistenceCheckpointV1;
  }>) => Promise<Readonly<{ ready: boolean; checkpointHash: string | null; missingRecords: readonly string[]; corruptRecords: readonly string[]; backupPreserved: boolean }>>;
}>;

export type WorldPersistenceFingerprintV1 = Readonly<{ generatorHash: string; contentHash: string }>;
export type WorldPersistenceWriteResultV1 = Readonly<{
  status: "committed" | "unchanged";
  checkpoint: PersistenceCheckpointV1;
  dirtyRecordKeys: readonly string[];
}>;

type CoordinatorStateV1 = Readonly<{
  checkpoint: PersistenceCheckpointV1 | null;
  records: readonly PersistenceRecordDescriptorV1[];
  journalSequence: number;
}>;

const HASH_PATTERN = /^[0-9a-f]{32}$/u;

function defaultFingerprint(save: WorldSave): WorldPersistenceFingerprintV1 {
  const generatorHash = new TypeScriptCanonicalHasher("blockwild-world-generator-fingerprint-v1")
    .writeU32(save.generatorVersion).writeString(save.generatorProfile ?? "world-below-v15").writeString(save.seed).finishHex();
  const contentHash = new TypeScriptCanonicalHasher("blockwild-world-content-fingerprint-v1")
    .writeString(save.lastSavedGameVersion ?? "unknown").writeU16(save.version).finishHex();
  return Object.freeze({ generatorHash, contentHash });
}

function validateFingerprint(value: WorldPersistenceFingerprintV1) {
  if (!HASH_PATTERN.test(value.generatorHash) || !HASH_PATTERN.test(value.contentHash)) throw new Error("world persistence fingerprints must be canonical 128-bit hashes");
  return value;
}

function checkpointId(sequence: number, setHash: string) {
  return `cp-${sequence.toString(36).padStart(8, "0")}-${setHash.slice(0, 16)}`;
}

function migrationCheckpointCreatedAt(save: WorldSave) {
  if (!Number.isSafeInteger(save.savedAt) || save.savedAt < 0) throw new Error("legacy migration save timestamp must be a non-negative safe integer");
  return save.savedAt;
}

function manifestShard(checkpoint: PersistenceCheckpointV1, shards: readonly WorldSaveShardV1[]) {
  const descriptor = checkpoint.records.find((record) => record.address.kind === "location-manifest" && record.address.recordId === "manifest");
  if (!descriptor) throw new Error("checkpoint has no world-save manifest record");
  return shards.find((entry) => persistenceRecordKeyV1(entry.address) === persistenceRecordKeyV1(descriptor.address)) ?? null;
}

/**
 * Serializes each world's dirty-set commits and binds records, journal sequence,
 * and the new head checkpoint in one durable adapter transaction.
 */
export class WorldPersistenceCoordinatorV1 {
  private readonly states = new Map<string, CoordinatorStateV1>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private idSequence = 0;

  constructor(
    private readonly adapter: WorldPersistenceAdapterV1,
    private readonly now: () => number = Date.now,
  ) {}

  private enqueue<T>(worldId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(worldId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(worldId, next);
    const release = () => { if (this.queues.get(worldId) === next) this.queues.delete(worldId); };
    // A detached finally() inherits rejection and creates an unhandled promise.
    // Observe both settlements explicitly while preserving `next` for callers.
    void next.then(release, release);
    return next;
  }

  private async state(worldId: string): Promise<CoordinatorStateV1> {
    const cached = this.states.get(worldId);
    if (cached) return cached;
    const checkpoint = await this.adapter.readLatestCheckpoint(worldId);
    const state = Object.freeze({ checkpoint, records: checkpoint?.records ?? Object.freeze([]), journalSequence: checkpoint?.journalSequence ?? 0 });
    this.states.set(worldId, state);
    return state;
  }

  persistWorld(worldId: string, save: WorldSave, fingerprint = defaultFingerprint(save)): Promise<WorldPersistenceWriteResultV1> {
    return this.enqueue(worldId, async () => {
      validateFingerprint(fingerprint);
      const shards = shardWorldSaveV1(worldId, save);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const previous = await this.state(worldId);
        this.idSequence += 1;
        const plan = planWorldSaveJournalV1({
          transactionId: `world-${worldId}-${previous.journalSequence + 1}-${this.idSequence}`,
          checkpointId: previous.checkpoint?.checkpointId ?? "root",
          expectedJournalSequence: previous.journalSequence,
          shards,
          previousRecords: previous.records,
        });
        if (!plan.transaction) {
          if (!previous.checkpoint) throw new Error("an empty initial world journal cannot form a checkpoint");
          return Object.freeze({ status: "unchanged", checkpoint: previous.checkpoint, dirtyRecordKeys: plan.dirtyRecordKeys });
        }
        const nextCheckpoint = checkpointWorldSaveShardsV1({
          checkpointId: checkpointId(plan.transaction.nextJournalSequence, shards.setHash),
          parentCheckpointId: previous.checkpoint?.checkpointId ?? null,
          worldId,
          journalSequence: plan.transaction.nextJournalSequence,
          generatorHash: fingerprint.generatorHash,
          contentHash: fingerprint.contentHash,
          createdAt: this.now(),
          records: plan.nextRecords,
        });
        const result = await this.adapter.commit(plan.transaction, nextCheckpoint);
        if (result.status === "committed") {
          this.states.set(worldId, Object.freeze({ checkpoint: nextCheckpoint, records: nextCheckpoint.records, journalSequence: nextCheckpoint.journalSequence }));
          return Object.freeze({ status: "committed", checkpoint: nextCheckpoint, dirtyRecordKeys: plan.dirtyRecordKeys });
        }
        if (attempt === 0 && (result.code === "stale-sequence" || result.code === "record-conflict")) {
          this.states.delete(worldId);
          continue;
        }
        throw new Error(`world journal rejected ${result.code}: ${result.message}`);
      }
      throw new Error("world journal retry budget exhausted");
    });
  }

  async readWorld(worldId: string): Promise<WorldSave | null> {
    await this.flush(worldId);
    const checkpoint = (await this.state(worldId)).checkpoint;
    if (!checkpoint) return null;
    const shards: WorldSaveShardV1[] = [];
    for (const descriptor of checkpoint.records) {
      const payload = await this.adapter.readRecord(descriptor.address, descriptor.revision);
      if (!payload) throw new Error(`checkpoint record ${persistenceRecordKeyV1(descriptor.address)} is unavailable`);
      shards.push(Object.freeze({ address: descriptor.address, payload, payloadHash: descriptor.payloadHash }));
    }
    const encodedManifest = manifestShard(checkpoint, shards);
    if (!encodedManifest) throw new Error("checkpoint manifest payload is unavailable");
    const manifest = decodeCanonicalWorldSaveValueV1(encodedManifest.payload) as WorldSaveManifestV1;
    if (manifest.worldId !== worldId) throw new Error("checkpoint manifest belongs to another world");
    return restoreWorldSaveV1({ manifest, shards });
  }

  migrateLegacyWorld(input: Readonly<{
    worldId: string;
    sourceKey: string;
    sourcePayload: Uint8Array;
    sourceFormat: "blockwild-world-v2" | "blockwild-world-export-v1";
    save: WorldSave;
    fingerprint?: WorldPersistenceFingerprintV1;
  }>) {
    return this.enqueue(input.worldId, async () => {
      if (!this.adapter.commitMigration || !this.adapter.verifyMigrationReadback) throw new Error("persistence adapter does not support protected legacy migration");
      const fingerprint = validateFingerprint(input.fingerprint ?? defaultFingerprint(input.save));
      const shards = shardWorldSaveV1(input.worldId, input.save);
      const records = shards.shards.map((entry) => Object.freeze({ address: entry.address, revision: 1, byteLength: entry.payload.byteLength, payloadHash: entry.payloadHash }));
      const checkpoint = checkpointWorldSaveShardsV1({ checkpointId: checkpointId(0, shards.setHash), parentCheckpointId: null, worldId: input.worldId, journalSequence: 0,
        generatorHash: fingerprint.generatorHash, contentHash: fingerprint.contentHash, createdAt: migrationCheckpointCreatedAt(input.save), records });
      const bundle = createLegacyMigrationBundleV1({ sourceKey: input.sourceKey, sourceFormat: input.sourceFormat, worldId: input.worldId,
        sourcePayload: input.sourcePayload, normalizedPayload: encodeCanonicalWorldSaveValueV1(input.save) });
      const recordPayloads = new Map(shards.shards.map((entry) => [persistenceRecordKeyV1(entry.address), entry.payload]));
      await this.adapter.commitMigration({ bundle, sourcePayload: input.sourcePayload, checkpoint, recordPayloads });
      const verified = await this.adapter.verifyMigrationReadback({ bundle, checkpoint });
      const exactReadback = verified.ready && verified.checkpointHash === checkpoint.checkpointHash && verified.backupPreserved
        && verified.missingRecords.length === 0 && verified.corruptRecords.length === 0;
      if (!exactReadback) {
        const failures = [...verified.missingRecords, ...verified.corruptRecords];
        if (verified.checkpointHash !== checkpoint.checkpointHash) failures.push("checkpoint hash mismatch");
        if (!verified.backupPreserved) failures.push("legacy source backup mismatch");
        throw new Error(`legacy migration failed readback: ${failures.join(", ") || "adapter did not confirm exact durable state"}`);
      }
      this.states.set(input.worldId, Object.freeze({ checkpoint, records: checkpoint.records, journalSequence: 0 }));
      return checkpoint;
    });
  }

  async flush(worldId?: string) {
    if (worldId) await this.queues.get(worldId);
    else await Promise.all([...this.queues.values()]);
  }

  deleteWorld(worldId: string) {
    return this.enqueue(worldId, async () => {
      if (this.adapter.deleteWorld) await this.adapter.deleteWorld(worldId);
      this.states.delete(worldId);
    });
  }
}

export function worldPersistenceFingerprintV1(save: WorldSave) { return defaultFingerprint(save); }
export type { WorldSaveShardSetV1 };
