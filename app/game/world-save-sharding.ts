import type { WorldSave } from "./engine";
import {
  createPersistenceCheckpointV1,
  createPersistenceTransactionV1,
  persistencePayloadHashV1,
  persistenceRecordKeyV1,
  type PersistenceCheckpointV1,
  type PersistenceRecordAddressV1,
  type PersistenceRecordDescriptorV1,
  type PersistenceRecordKindV1,
  type PersistenceTransactionV1,
} from "./persistence-journal-contract";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

export const WORLD_SAVE_SHARD_SCHEMA_V1 = 1 as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const MACHINE_MAP_PROPERTIES = new Set([
  "furnaces", "wheatMills", "chests", "apiaries", "morphLooms", "orbRacks", "healingStations", "aquariums", "fieldPerches",
  "golemForges", "alchemyStands", "distilleries", "sugarworks", "archiveShelves", "tomeDisplays", "merchants",
]);
const ACTOR_MAP_PROPERTIES = new Set(["multiplayerPlayers", "multiplayerProgressions", "multiplayerWallets"]);
const ENTITY_ARRAY_PROPERTIES = new Set(["creatures", "sleepingCreatures", "drops", "boats", "leads"]);
const MAP_KNOWLEDGE_PROPERTIES = new Set(["mapKnowledge", "surfaceRoadGraph", "roadEvents", "activatedStructureMarkers"]);
const CARDFORGE_PROPERTIES = new Set(["cardforge"]);
const QUEST_PROPERTIES = new Set(["questBook", "sideQuestDefinitions", "guildBook", "legendaryEncounters", "primeEncounters", "settlements", "factionRelations"]);
const PLAYER_PROPERTIES = new Set([
  "player", "spawn", "startingSettlementId", "inventory", "cursor", "trash", "craftGrid", "equipment", "offhand", "bestiary", "selected",
  "health", "hunger", "xp", "level", "playerVariant", "skillState", "magicState", "spellWorldState", "potionBuffs", "rangedLoaded", "plantBestiary",
  "blueprints", "goldWallet", "bankAccount", "stockMarket", "digitalItemVault", "digitalCreatureArchive", "summonContracts",
  "rustNativePlayerDeathRespawnProjection", "rustNativePlayerRespawnPlan",
]);
const SETTINGS_PROPERTIES = new Set(["options", "mode"]);

type ShardContainerV1 = "scalar" | "map" | "array";
type WorldSaveManifestEntryV1 = Readonly<{ memberKey: string | null; recordId: string }>;
type WorldSaveManifestPropertyV1 = Readonly<{
  property: string;
  container: ShardContainerV1;
  kind: PersistenceRecordKindV1;
  entries: readonly WorldSaveManifestEntryV1[];
}>;
export type WorldSaveManifestV1 = Readonly<{
  schema: typeof WORLD_SAVE_SHARD_SCHEMA_V1;
  worldId: string;
  universeId: string;
  locationId: string;
  properties: readonly WorldSaveManifestPropertyV1[];
}>;

export type WorldSaveShardV1 = Readonly<{
  address: PersistenceRecordAddressV1;
  payload: Uint8Array;
  payloadHash: string;
}>;

export type WorldSaveShardSetV1 = Readonly<{
  schema: typeof WORLD_SAVE_SHARD_SCHEMA_V1;
  worldId: string;
  manifest: WorldSaveManifestV1;
  shards: readonly WorldSaveShardV1[];
  setHash: string;
}>;

export type WorldSaveShardJournalPlanV1 = Readonly<{
  transaction: PersistenceTransactionV1 | null;
  nextRecords: readonly PersistenceRecordDescriptorV1[];
  dirtyRecordKeys: readonly string[];
}>;

function compareOrdinal(left: string, right: string) { return left === right ? 0 : left < right ? -1 : 1; }

function defineEnumerableDataProperty(output: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(output, key, { configurable: true, enumerable: true, value, writable: true });
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? Object.is(value, -0) ? 0 : value : null;
  if (Array.isArray(value)) return value.map((entry) => canonicalJsonValue(entry));
  if (typeof value !== "object") return null;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort(compareOrdinal)) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined && typeof entry !== "function" && typeof entry !== "symbol") {
      defineEnumerableDataProperty(output, key, canonicalJsonValue(entry));
    }
  }
  return output;
}

export function encodeCanonicalWorldSaveValueV1(value: unknown) {
  return textEncoder.encode(JSON.stringify(canonicalJsonValue(value)));
}

export function decodeCanonicalWorldSaveValueV1(payload: Uint8Array) {
  return JSON.parse(textDecoder.decode(payload)) as unknown;
}

function classifyProperty(property: string): PersistenceRecordKindV1 {
  if (property === "edits" || property === "blockFacings" || property === "liquidLevels") return "chunk-edits";
  if (MACHINE_MAP_PROPERTIES.has(property)) return "machine";
  if (ACTOR_MAP_PROPERTIES.has(property) || property === "agentPlatform") return "actor-digest";
  if (ENTITY_ARRAY_PROPERTIES.has(property) || property === "ecologySectors") return "entity";
  if (MAP_KNOWLEDGE_PROPERTIES.has(property)) return "map-knowledge";
  if (CARDFORGE_PROPERTIES.has(property)) return "cardforge";
  if (QUEST_PROPERTIES.has(property)) return "quest";
  if (PLAYER_PROPERTIES.has(property)) return "player";
  if (SETTINGS_PROPERTIES.has(property)) return "settings-reference";
  return "location-manifest";
}

function containerFor(property: string): ShardContainerV1 {
  if (property === "edits" || MACHINE_MAP_PROPERTIES.has(property) || ACTOR_MAP_PROPERTIES.has(property)) return "map";
  if (ENTITY_ARRAY_PROPERTIES.has(property)) return "array";
  return "scalar";
}

function recordId(property: string, memberKey: string | null) {
  const source = memberKey === null ? property : `${property}/${memberKey}`;
  const digest = new TypeScriptCanonicalHasher("blockwild-world-save-record-id-v1").writeString(source).finishHex().slice(0, 16);
  const readable = source.replace(/[^a-zA-Z0-9_.:-]+/gu, "-").slice(0, 72) || "record";
  return `${readable}:${digest}`;
}

function stableArrayRecordMemberKey(index: number, value: unknown, used: Set<string>) {
  const candidate = value && typeof value === "object"
    ? ["specimenId", "id", "entityId", "boatId", "anchorId"].map((key) => (value as Record<string, unknown>)[key])
      .find((entry) => typeof entry === "string" || typeof entry === "number")
    : undefined;
  const stable = candidate === undefined ? String(index) : `id:${String(candidate)}`;
  const result = used.has(stable) ? String(index) : stable;
  used.add(result);
  return result;
}

function shard(address: PersistenceRecordAddressV1, value: unknown): WorldSaveShardV1 {
  const payload = encodeCanonicalWorldSaveValueV1(value);
  return Object.freeze({ address: Object.freeze({ ...address }), payload, payloadHash: persistencePayloadHashV1(payload) });
}

export function shardWorldSaveV1(worldId: string, save: WorldSave): WorldSaveShardSetV1 {
  if (!worldId || worldId.length > 48) throw new RangeError("worldId must contain 1..48 code units");
  const universeId = `world:${worldId}`;
  const locationId = "overworld";
  const properties: WorldSaveManifestPropertyV1[] = [];
  const shards: WorldSaveShardV1[] = [];
  for (const property of Object.keys(save).sort(compareOrdinal)) {
    const value = (save as unknown as Record<string, unknown>)[property];
    if (value === undefined) continue;
    const kind = classifyProperty(property);
    const container = containerFor(property);
    const entries: WorldSaveManifestEntryV1[] = [];
    const usedArrayRecordKeys = new Set<string>();
    const values: ReadonlyArray<readonly [string | null, unknown]> = container === "map"
      ? Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareOrdinal(left, right))
      : container === "array"
        ? (value as unknown[]).map((entry, index) => [String(index), entry] as const)
        : [[null, value] as const];
    for (const [memberKey, member] of values) {
      const recordMemberKey = container === "array" && memberKey !== null
        ? stableArrayRecordMemberKey(Number(memberKey), member, usedArrayRecordKeys)
        : memberKey;
      const id = recordId(property, recordMemberKey);
      entries.push(Object.freeze({ memberKey, recordId: id }));
      shards.push(shard({ universeId, locationId, kind, recordId: id }, member));
    }
    properties.push(Object.freeze({ property, container, kind, entries: Object.freeze(entries) }));
  }
  const manifest: WorldSaveManifestV1 = Object.freeze({ schema: WORLD_SAVE_SHARD_SCHEMA_V1, worldId, universeId, locationId, properties: Object.freeze(properties) });
  shards.push(shard({ universeId, locationId, kind: "location-manifest", recordId: "manifest" }, manifest));
  shards.sort((left, right) => compareOrdinal(persistenceRecordKeyV1(left.address), persistenceRecordKeyV1(right.address)));
  const hasher = new TypeScriptCanonicalHasher("blockwild-world-save-shard-set-v1").writeString(worldId).writeU32(shards.length);
  for (const entry of shards) hasher.writeString(persistenceRecordKeyV1(entry.address)).writeString(entry.payloadHash).writeU32(entry.payload.byteLength);
  return Object.freeze({ schema: WORLD_SAVE_SHARD_SCHEMA_V1, worldId, manifest, shards: Object.freeze(shards), setHash: hasher.finishHex() });
}

export function restoreWorldSaveV1(set: Pick<WorldSaveShardSetV1, "manifest" | "shards">): WorldSave {
  if (set.manifest.schema !== WORLD_SAVE_SHARD_SCHEMA_V1) throw new Error("unsupported world-save shard manifest");
  const byAddress = new Map<string, WorldSaveShardV1>();
  for (const entry of set.shards) {
    const key = persistenceRecordKeyV1(entry.address);
    if (byAddress.has(key)) throw new Error(`duplicate world-save shard ${key}`);
    byAddress.set(key, entry);
  }
  const output: Record<string, unknown> = {};
  for (const property of set.manifest.properties) {
    const decoded = property.entries.map((entry) => {
      const address = { universeId: set.manifest.universeId, locationId: set.manifest.locationId, kind: property.kind, recordId: entry.recordId } as const;
      const entryShard = byAddress.get(persistenceRecordKeyV1(address));
      if (!entryShard || !persistencePayloadMatches(entryShard)) throw new Error(`world-save shard ${entry.recordId} is missing or corrupt`);
      return [entry.memberKey, decodeCanonicalWorldSaveValueV1(entryShard.payload)] as const;
    });
    if (property.container === "scalar") {
      if (decoded.length !== 1 || decoded[0][0] !== null) throw new Error(`scalar property ${property.property} has an invalid manifest`);
      defineEnumerableDataProperty(output, property.property, decoded[0][1]);
    } else if (property.container === "map") {
      defineEnumerableDataProperty(output, property.property, Object.fromEntries(decoded.map(([key, value]) => [key ?? "", value])));
    } else {
      const array: unknown[] = [];
      for (const [key, value] of decoded) {
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0) throw new Error(`array property ${property.property} has an invalid index`);
        array[index] = value;
      }
      defineEnumerableDataProperty(output, property.property, array);
    }
  }
  return output as unknown as WorldSave;
}

function persistencePayloadMatches(entry: WorldSaveShardV1) { return persistencePayloadHashV1(entry.payload) === entry.payloadHash; }

export function planWorldSaveJournalV1(input: Readonly<{
  transactionId: string;
  checkpointId: string;
  expectedJournalSequence: number;
  shards: WorldSaveShardSetV1;
  previousRecords: readonly PersistenceRecordDescriptorV1[];
}>): WorldSaveShardJournalPlanV1 {
  const previous = new Map(input.previousRecords.map((record) => [persistenceRecordKeyV1(record.address), record]));
  const next = new Map(previous);
  const mutations: Parameters<typeof createPersistenceTransactionV1>[0]["mutations"][number][] = [];
  const dirty = new Set<string>();
  for (const entry of input.shards.shards) {
    const key = persistenceRecordKeyV1(entry.address);
    const current = previous.get(key);
    if (current?.payloadHash === entry.payloadHash && current.byteLength === entry.payload.byteLength) continue;
    mutations.push({ operation: "put", address: entry.address, expectedRecordRevision: current?.revision ?? null, nextRecordRevision: (current?.revision ?? 0) + 1, payload: entry.payload });
    dirty.add(key);
    next.set(key, Object.freeze({ address: entry.address, revision: (current?.revision ?? 0) + 1, byteLength: entry.payload.byteLength, payloadHash: entry.payloadHash }));
  }
  const currentKeys = new Set(input.shards.shards.map((entry) => persistenceRecordKeyV1(entry.address)));
  for (const [key, record] of previous) if (!currentKeys.has(key)) {
    mutations.push({ operation: "delete", address: record.address, expectedRecordRevision: record.revision, nextRecordRevision: record.revision + 1 });
    dirty.add(key); next.delete(key);
  }
  const transaction = mutations.length ? createPersistenceTransactionV1({
    transactionId: input.transactionId, worldId: input.shards.worldId, checkpointId: input.checkpointId,
    expectedJournalSequence: input.expectedJournalSequence, nextJournalSequence: input.expectedJournalSequence + 1, mutations,
  }) : null;
  const nextRecords = [...next.values()].sort((left, right) => compareOrdinal(persistenceRecordKeyV1(left.address), persistenceRecordKeyV1(right.address)));
  return Object.freeze({ transaction, nextRecords: Object.freeze(nextRecords), dirtyRecordKeys: Object.freeze([...dirty].sort(compareOrdinal)) });
}

export function checkpointWorldSaveShardsV1(input: Readonly<{
  checkpointId: string;
  parentCheckpointId: string | null;
  worldId: string;
  journalSequence: number;
  generatorHash: string;
  contentHash: string;
  createdAt: number;
  records: readonly PersistenceRecordDescriptorV1[];
}>): PersistenceCheckpointV1 {
  return createPersistenceCheckpointV1(input);
}
