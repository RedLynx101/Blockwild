import assert from "node:assert/strict";
import test from "node:test";
import type { WorldSave } from "../app/game/engine.ts";
import {
  MemoryPersistenceAdapterV1,
  type PersistenceMigrationReadbackV1,
  type PersistenceMigrationWriteV1,
} from "../app/game/indexeddb-persistence-adapter.ts";
import { WorldPersistenceCoordinatorV1 } from "../app/game/world-persistence-coordinator.ts";
import { encodeCanonicalWorldSaveValueV1 } from "../app/game/world-save-sharding.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const canonical = (value: unknown) => JSON.parse(decoder.decode(encodeCanonicalWorldSaveValueV1(value))) as unknown;

function save(day = 1): WorldSave {
  return {
    version: 2, generatorVersion: 18, seed: "COORDINATOR", mode: "survival", edits: { "0,0": [[17, 3]] },
    player: { x: 1, y: 50, z: -2, yaw: 0.3, pitch: -0.1 }, spawn: { x: 0, y: 48, z: 0 }, inventory: [], selected: 0,
    health: 10, hunger: 10, xp: 0, level: 0, time: 0.32, day, weather: "clear", furnaces: {}, chests: {}, savedAt: 900 + day,
  };
}

function legacyMigration(worldId: string, value: WorldSave, label: string) {
  return Object.freeze({
    worldId,
    sourceKey: `blockwild-world-v2:${label}`,
    sourcePayload: encoder.encode(JSON.stringify({ label, worldId, savedAt: value.savedAt })),
    sourceFormat: "blockwild-world-v2" as const,
    save: value,
  });
}

class TrackingMigrationAdapter extends MemoryPersistenceAdapterV1 {
  readonly migrationCalls: string[] = [];

  override async readLatestCheckpoint(worldId: string) {
    this.migrationCalls.push(`read-latest:${worldId}`);
    return super.readLatestCheckpoint(worldId);
  }

  override async commitMigration(input: PersistenceMigrationWriteV1) {
    this.migrationCalls.push(`commit-migration:${input.bundle.migrationHash}`);
    return super.commitMigration(input);
  }

  override async verifyMigrationReadback(input: Pick<PersistenceMigrationWriteV1, "bundle" | "checkpoint">): Promise<PersistenceMigrationReadbackV1> {
    this.migrationCalls.push(`verify-migration:${input.bundle.migrationHash}`);
    return super.verifyMigrationReadback(input);
  }
}

test("world persistence coordinator atomically advances records and head checkpoints", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const coordinator = new WorldPersistenceCoordinatorV1(adapter, () => 1_000);
  const first = await coordinator.persistWorld("world-a", save(1));
  assert.equal(first.status, "committed");
  assert.equal(first.checkpoint.journalSequence, 1);
  assert.deepEqual(canonical(await coordinator.readWorld("world-a")), canonical(save(1)));

  const unchanged = await coordinator.persistWorld("world-a", save(1));
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.checkpoint.checkpointHash, first.checkpoint.checkpointHash);

  const second = await coordinator.persistWorld("world-a", save(2));
  assert.equal(second.checkpoint.journalSequence, 2);
  assert.ok(second.dirtyRecordKeys.length >= 1);
  assert.deepEqual(canonical(await coordinator.readWorld("world-a")), canonical(save(2)));
});

test("a fresh coordinator hydrates the durable head without renderer or localStorage", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const writer = new WorldPersistenceCoordinatorV1(adapter, () => 2_000);
  await Promise.all([writer.persistWorld("world-a", save(1)), writer.persistWorld("world-a", save(2)), writer.persistWorld("world-a", save(3))]);
  await writer.flush();

  const reader = new WorldPersistenceCoordinatorV1(adapter, () => 3_000);
  const hydrated = await reader.readWorld("world-a");
  assert.deepEqual(canonical(hydrated), canonical(save(3)));
  const checkpoint = await adapter.readLatestCheckpoint("world-a");
  assert.equal(checkpoint?.journalSequence, 3, "queued writes must retain strict per-world ordering");
});

test("different worlds use independent queues and checkpoints", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const coordinator = new WorldPersistenceCoordinatorV1(adapter, () => 4_000);
  await Promise.all([coordinator.persistWorld("world-a", save(4)), coordinator.persistWorld("world-b", { ...save(5), seed: "OTHER" })]);
  assert.equal((await adapter.readLatestCheckpoint("world-a"))?.journalSequence, 1);
  assert.equal((await adapter.readLatestCheckpoint("world-b"))?.journalSequence, 1);
  assert.equal((await coordinator.readWorld("world-a"))?.seed, "COORDINATOR");
  assert.equal((await coordinator.readWorld("world-b"))?.seed, "OTHER");
});

test("cross-tab stale heads reload once and deleted worlds leave no durable head", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const first = new WorldPersistenceCoordinatorV1(adapter, () => 5_000);
  await first.persistWorld("world-a", save(1));
  const second = new WorldPersistenceCoordinatorV1(adapter, () => 5_001);
  assert.equal((await second.readWorld("world-a"))?.day, 1, "second tab caches the initial head");
  await first.persistWorld("world-a", save(2));
  const recovered = await second.persistWorld("world-a", save(3));
  assert.equal(recovered.checkpoint.journalSequence, 3, "stale cross-tab state should reload and retry exactly once");
  assert.equal((await second.readWorld("world-a"))?.day, 3);

  await second.deleteWorld("world-a");
  assert.equal(await adapter.readLatestCheckpoint("world-a"), null);
  const emptyReader = new WorldPersistenceCoordinatorV1(adapter);
  assert.equal(await emptyReader.readWorld("world-a"), null);
});

test("legacy migration always enters the atomic adapter path and exact retries require strong readback", async () => {
  const adapter = new TrackingMigrationAdapter();
  const input = legacyMigration("world:migration-exact", save(6), "exact");
  const first = new WorldPersistenceCoordinatorV1(adapter, () => 10_000);
  const second = new WorldPersistenceCoordinatorV1(adapter, () => 99_999);

  const [firstCheckpoint, retryCheckpoint] = await Promise.all([
    first.migrateLegacyWorld(input),
    second.migrateLegacyWorld(input),
  ]);
  assert.equal(firstCheckpoint.checkpointHash, retryCheckpoint.checkpointHash, "coordinator clocks cannot make the same migration look different");
  assert.equal(firstCheckpoint.createdAt, input.save.savedAt, "migration checkpoint identity comes from the durable legacy save");
  assert.equal(adapter.migrationCalls.filter((entry) => entry.startsWith("commit-migration:")).length, 2);
  assert.equal(adapter.migrationCalls.filter((entry) => entry.startsWith("verify-migration:")).length, 2);
  assert.equal(adapter.migrationCalls.some((entry) => entry.startsWith("read-latest:")), false, "no unlocked head read may authorize migration success");
  assert.deepEqual(canonical(await first.readWorld(input.worldId)), canonical(input.save));
});

test("pre-existing normal heads and competing migrations fail closed without replacing the winner", async () => {
  const occupiedAdapter = new TrackingMigrationAdapter();
  const normalWriter = new WorldPersistenceCoordinatorV1(occupiedAdapter, () => 20_000);
  const normal = await normalWriter.persistWorld("world:migration-occupied", save(7));
  occupiedAdapter.migrationCalls.length = 0;
  const migration = new WorldPersistenceCoordinatorV1(occupiedAdapter, () => 20_001);
  await assert.rejects(migration.migrateLegacyWorld(legacyMigration("world:migration-occupied", save(7), "occupied")), /durable world state already exists/u);
  assert.equal(occupiedAdapter.migrationCalls.length, 1);
  assert.match(occupiedAdapter.migrationCalls[0], /^commit-migration:/u);
  assert.equal((await occupiedAdapter.readLatestCheckpoint("world:migration-occupied"))?.checkpointHash, normal.checkpoint.checkpointHash);

  const racedAdapter = new TrackingMigrationAdapter();
  const first = legacyMigration("world:migration-different", save(8), "winner");
  const second = legacyMigration("world:migration-different", save(9), "loser");
  const race = await Promise.allSettled([
    new WorldPersistenceCoordinatorV1(racedAdapter, () => 30_000).migrateLegacyWorld(first),
    new WorldPersistenceCoordinatorV1(racedAdapter, () => 40_000).migrateLegacyWorld(second),
  ]);
  assert.equal(race[0].status, "fulfilled");
  assert.equal(race[1].status, "rejected");
  if (race[1].status === "rejected") assert.match(String(race[1].reason), /migration conflict/u);
  const winner = new WorldPersistenceCoordinatorV1(racedAdapter);
  assert.deepEqual(canonical(await winner.readWorld(first.worldId)), canonical(first.save));
});

test("corrupt migration markers and failed strong readback never become coordinator success", async () => {
  const corruptAdapter = new TrackingMigrationAdapter();
  const input = legacyMigration("world:migration-corrupt-marker", save(10), "corrupt-marker");
  await new WorldPersistenceCoordinatorV1(corruptAdapter).migrateLegacyWorld(input);
  const internals = corruptAdapter as unknown as { migrationMarkers: Map<string, string> };
  internals.migrationMarkers.set(input.worldId, `migration-v1|${"0".repeat(32)}|${"0".repeat(32)}`);
  await assert.rejects(new WorldPersistenceCoordinatorV1(corruptAdapter).migrateLegacyWorld(input), /incomplete, different, or corrupt/u);

  class FailedReadbackAdapter extends MemoryPersistenceAdapterV1 {
    override async verifyMigrationReadback(candidate: Pick<PersistenceMigrationWriteV1, "bundle" | "checkpoint">): Promise<PersistenceMigrationReadbackV1> {
      const actual = await super.verifyMigrationReadback(candidate);
      return Object.freeze({ ...actual, ready: false, corruptRecords: Object.freeze([...actual.corruptRecords, "forced-readback-failure"]) });
    }
  }
  const failedReadbackAdapter = new FailedReadbackAdapter();
  const failed = legacyMigration("world:migration-readback-failure", save(11), "failed-readback");
  await assert.rejects(new WorldPersistenceCoordinatorV1(failedReadbackAdapter).migrateLegacyWorld(failed), /forced-readback-failure/u);

  class InconsistentReadbackAdapter extends MemoryPersistenceAdapterV1 {
    override async verifyMigrationReadback(candidate: Pick<PersistenceMigrationWriteV1, "bundle" | "checkpoint">): Promise<PersistenceMigrationReadbackV1> {
      const actual = await super.verifyMigrationReadback(candidate);
      return Object.freeze({ ...actual, ready: true, checkpointHash: "0".repeat(32) });
    }
  }
  const inconsistentAdapter = new InconsistentReadbackAdapter();
  const inconsistent = legacyMigration("world:migration-inconsistent-readback", save(12), "inconsistent-readback");
  await assert.rejects(new WorldPersistenceCoordinatorV1(inconsistentAdapter).migrateLegacyWorld(inconsistent), /checkpoint hash mismatch/u);
});
