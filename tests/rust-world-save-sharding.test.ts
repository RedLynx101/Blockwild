import assert from "node:assert/strict";
import test from "node:test";
import type { WorldSave } from "../app/game/engine.ts";
import { persistencePayloadHashV1, persistenceRecordKeyV1 } from "../app/game/persistence-journal-contract.ts";
import {
  checkpointWorldSaveShardsV1,
  decodeCanonicalWorldSaveValueV1,
  encodeCanonicalWorldSaveValueV1,
  planWorldSaveJournalV1,
  restoreWorldSaveV1,
  shardWorldSaveV1,
} from "../app/game/world-save-sharding.ts";

const decoder = new TextDecoder();

function canonical(value: unknown) {
  return JSON.parse(decoder.decode(encodeCanonicalWorldSaveValueV1(value))) as unknown;
}

function save(overrides: Record<string, unknown> = {}): WorldSave {
  return {
    version: 2,
    generatorVersion: 18,
    seed: "SHARD-TEST",
    mode: "survival",
    edits: { "0,0": [[17, 3]], "-1,2": [[4, 8]] },
    player: { x: 1, y: 50, z: -2, yaw: 0.3, pitch: -0.1 },
    spawn: { x: 0, y: 48, z: 0 },
    inventory: [],
    selected: 0,
    health: 10,
    hunger: 10,
    xp: 0,
    level: 0,
    time: 0.32,
    day: 1,
    weather: "clear",
    furnaces: { "1,50,2": { fuel: null, input: null, output: null, progress: 0, burn: 0, burnMax: 0 } },
    chests: { "2,50,2": { slots: [null] } },
    creatures: [
      { id: 11, specimenId: "specimen-a", kind: "petalfox", x: 4, y: 50, z: 4 },
      { id: 12, specimenId: "specimen-b", kind: "tidepup", x: 6, y: 50, z: 6 },
    ],
    drops: [],
    multiplayerWallets: {},
    savedAt: 900,
    ...overrides,
  } as unknown as WorldSave;
}

test("world saves shard by deterministic domain and restore losslessly", () => {
  const source = save({
    optionalUndefined: undefined,
    negativeZero: -0,
    rustNativePlayerDeathRespawnProjection: {
      schema: 1,
      cursor: 4,
      lastReceiptHash: "1".repeat(32),
    },
    rustNativePlayerRespawnPlan: {
      schema: 1,
      requestPayloadHex: "42574437",
      requestPayloadHash: "2".repeat(32),
      commandHash: "3".repeat(32),
    },
  });
  const set = shardWorldSaveV1("world-a", source);
  assert.deepEqual(canonical(restoreWorldSaveV1(set)), canonical(source));
  assert.ok(set.shards.some((entry) => entry.address.kind === "chunk-edits"));
  assert.ok(set.shards.some((entry) => entry.address.kind === "machine"));
  assert.ok(set.shards.some((entry) => entry.address.kind === "entity"));
  assert.ok(set.shards.some((entry) => entry.address.recordId === "manifest"));
  for (const property of ["rustNativePlayerDeathRespawnProjection", "rustNativePlayerRespawnPlan"]) {
    const manifestProperty = set.manifest.properties.find((entry) => entry.property === property);
    assert.equal(manifestProperty?.kind, "player", `${property} must checkpoint in player custody`);
  }
  assert.equal(new Set(set.shards.map((entry) => persistenceRecordKeyV1(entry.address))).size, set.shards.length);
});

test("shard hashes ignore object insertion order but preserve array order", () => {
  const first = shardWorldSaveV1("world-a", save({ weatherState: { wind: 2, rain: 1 } }));
  const second = shardWorldSaveV1("world-a", save({ weatherState: { rain: 1, wind: 2 } }));
  assert.equal(first.setHash, second.setHash);
  const reversed = shardWorldSaveV1("world-a", save({ creatures: [...(save().creatures ?? [])].reverse() }));
  assert.notEqual(first.setHash, reversed.setHash);
});

test("canonical bytes preserve own prototype-named keys without collisions", () => {
  const first = JSON.parse('{"nested":{"__proto__":{"marker":"first"},"constructor":{"safe":1},"prototype":"kept"}}') as Record<string, unknown>;
  const second = JSON.parse('{"nested":{"__proto__":{"marker":"second"},"constructor":{"safe":1},"prototype":"kept"}}') as Record<string, unknown>;
  const firstBytes = encodeCanonicalWorldSaveValueV1(first);
  const secondBytes = encodeCanonicalWorldSaveValueV1(second);

  assert.notDeepEqual(firstBytes, secondBytes);
  assert.notEqual(persistencePayloadHashV1(firstBytes), persistencePayloadHashV1(secondBytes));
  assert.equal(decoder.decode(firstBytes), '{"nested":{"__proto__":{"marker":"first"},"constructor":{"safe":1},"prototype":"kept"}}');

  const roundTrip = decodeCanonicalWorldSaveValueV1(firstBytes) as { nested: Record<string, unknown> };
  assert.equal(Object.hasOwn(roundTrip.nested, "__proto__"), true);
  assert.deepEqual(roundTrip, first);
  assert.equal(({} as { marker?: string }).marker, undefined, "canonicalization must not mutate Object.prototype");

  const topLevel = JSON.parse('{"__proto__":{"nested":{"__proto__":"kept"}},"constructor":"also-kept","prototype":3}') as WorldSave;
  const restored = restoreWorldSaveV1(shardWorldSaveV1("prototype-keys", topLevel)) as unknown as Record<string, unknown>;
  assert.equal(Object.hasOwn(restored, "__proto__"), true);
  assert.deepEqual(restored, topLevel, "shard restoration must use the same safe own-property semantics");
});

test("journal planning writes only dirty shards and preserves stable creature records", () => {
  const initial = shardWorldSaveV1("world-a", save());
  const create = planWorldSaveJournalV1({ transactionId: "tx-create", checkpointId: "cp-1", expectedJournalSequence: 0, shards: initial, previousRecords: [] });
  assert.ok(create.transaction);
  assert.equal(create.nextRecords.length, initial.shards.length);

  const unchanged = planWorldSaveJournalV1({ transactionId: "tx-none", checkpointId: "cp-1", expectedJournalSequence: 1, shards: initial, previousRecords: create.nextRecords });
  assert.equal(unchanged.transaction, null);
  assert.deepEqual(unchanged.dirtyRecordKeys, []);

  const changedFurnace = shardWorldSaveV1("world-a", save({
    furnaces: { "1,50,2": { fuel: null, input: { item: 3, count: 1 }, output: null, progress: 0.5, burn: 3, burnMax: 10 } },
  }));
  const machineEdit = planWorldSaveJournalV1({ transactionId: "tx-machine", checkpointId: "cp-1", expectedJournalSequence: 1, shards: changedFurnace, previousRecords: create.nextRecords });
  assert.equal(machineEdit.transaction?.mutations.length, 1);
  assert.equal(machineEdit.transaction?.mutations[0]?.address.kind, "machine");

  const oneCreature = shardWorldSaveV1("world-a", save({ creatures: [save().creatures?.[1]] }));
  const creatureEdit = planWorldSaveJournalV1({ transactionId: "tx-creature", checkpointId: "cp-1", expectedJournalSequence: 1, shards: oneCreature, previousRecords: create.nextRecords });
  const specimenB = initial.shards.find((entry) => entry.address.recordId.includes("specimen-b"));
  assert.ok(specimenB);
  assert.equal(creatureEdit.transaction?.mutations.some((mutation) => persistenceRecordKeyV1(mutation.address) === persistenceRecordKeyV1(specimenB!.address)), false,
    "removing an earlier array member must not rewrite a stable surviving entity record");
  assert.equal(creatureEdit.transaction?.mutations.filter((mutation) => mutation.operation === "delete").length, 1);
  assert.equal(creatureEdit.transaction?.mutations.some((mutation) => mutation.address.recordId === "manifest"), true);
});

test("restore rejects corrupt and duplicate shards", () => {
  const set = shardWorldSaveV1("world-a", save());
  const target = set.shards.find((entry) => entry.address.recordId !== "manifest")!;
  const corrupt = { ...target, payload: Uint8Array.of(0xff) };
  assert.throws(() => restoreWorldSaveV1({ manifest: set.manifest, shards: set.shards.map((entry) => entry === target ? corrupt : entry) }), /missing or corrupt/u);
  assert.throws(() => restoreWorldSaveV1({ manifest: set.manifest, shards: [...set.shards, target] }), /duplicate world-save shard/u);
});

test("checkpoint construction binds the current record set", () => {
  const set = shardWorldSaveV1("world-a", save());
  const plan = planWorldSaveJournalV1({ transactionId: "tx-create", checkpointId: "cp-1", expectedJournalSequence: 0, shards: set, previousRecords: [] });
  const checkpoint = checkpointWorldSaveShardsV1({
    checkpointId: "cp-1",
    parentCheckpointId: null,
    worldId: "world-a",
    journalSequence: 1,
    generatorHash: "1".repeat(32),
    contentHash: "2".repeat(32),
    createdAt: 1_000,
    records: plan.nextRecords,
  });
  assert.equal(checkpoint.records.length, set.shards.length);
  assert.match(checkpoint.checkpointHash, /^[0-9a-f]{32}$/u);
});
