import type { WorldSave } from "./engine";
import { persistencePayloadHashV1 } from "./persistence-journal-contract";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import { encodeCanonicalWorldSaveValueV1 } from "./world-save-sharding";

export const RUST_LEGACY_WORLD_MIGRATION_SCHEMA_V1 = 1 as const;
export const RUST_LEGACY_STATE_ENTITIES_V1 = 1 << 0;
export const RUST_LEGACY_STATE_PLAYER_V1 = 1 << 1;
export const RUST_LEGACY_STATE_RUNTIME_CLOCKS_V1 = 1 << 2;
export const RUST_LEGACY_STATE_GAMEPLAY_V1 = 1 << 3;
export const RUST_LEGACY_STATE_MACHINES_V1 = 1 << 4;
export const RUST_LEGACY_STATE_MAP_V1 = 1 << 5;
export const RUST_LEGACY_STATE_NETWORK_V1 = 1 << 6;
export const RUST_LEGACY_STATE_UNKNOWN_V1 = 1 << 15;

const WORLD_MIN_Y_V1 = -64;
const WORLD_MAX_Y_V1 = 127;
const WORLD_CHUNK_SIZE_V1 = 16;
const WORLD_COLUMN_CELLS_V1 = 16 * 16 * (WORLD_MAX_Y_V1 - WORLD_MIN_Y_V1 + 1);
const WORLD_MAX_CHUNKS_V1 = 65_536;
const WORLD_MAX_FACINGS_V1 = 1_000_000;
const WORLD_CODEC_MAX_BYTES_V1 = 32 * 1024 * 1024;
const LEGACY_SOURCE_MAX_BYTES_V1 = 64 * 1024 * 1024;
const I32_MIN = -0x8000_0000;
const I32_MAX = 0x7fff_ffff;
const MIN_CELL_CHUNK_V1 = I32_MIN / WORLD_CHUNK_SIZE_V1;
const MAX_CELL_CHUNK_V1 = Math.floor(I32_MAX / WORLD_CHUNK_SIZE_V1);
const JS_MAX_SAFE_INTEGER_V1 = Number.MAX_SAFE_INTEGER;
const textEncoder = new TextEncoder();

/** A legacy snapshot has no native authority history; bootstrap keeps the fresh-store epoch and invents no mutations. */
export const RUST_LEGACY_WORLD_PROJECTION_REVISION_V1 = Object.freeze({
  epoch: 1,
  mutation: 0,
  residency: 0,
});

export type RustLegacyWorldAddressV1 = Readonly<{
  universeId: string;
  locationId: string;
}>;

export type RustLegacyWorldProjectionRevisionV1 = Readonly<{
  epoch: number;
  mutation: number;
  residency: number;
}>;

export type RustLegacyStateDomainV1 =
  | "entities"
  | "player"
  | "runtime-clocks"
  | "gameplay"
  | "machines"
  | "map"
  | "network"
  | "unknown";

export type RustLegacyWorldStateClassificationV1 = Readonly<{
  flags: number;
  domains: readonly RustLegacyStateDomainV1[];
  properties: Readonly<Partial<Record<RustLegacyStateDomainV1, readonly string[]>>>;
}>;

export type RustLegacyWorldProjectionV1 = Readonly<{
  schemaVersion: typeof RUST_LEGACY_WORLD_MIGRATION_SCHEMA_V1;
  address: RustLegacyWorldAddressV1;
  revision: RustLegacyWorldProjectionRevisionV1;
  bytes: Uint8Array;
  projectionHash: string;
  compatibilityChecksum: string;
  extensionChecksum: string;
  chunkCount: number;
  editCount: number;
  facingCount: number;
  collapsedDuplicateEdits: number;
  ignoredOrphanFacings: number;
}>;

export type RustLegacyWorldMigrationPlanV1 = Readonly<{
  schemaVersion: typeof RUST_LEGACY_WORLD_MIGRATION_SCHEMA_V1;
  status: "world-only" | "blocked";
  sourceSemanticHash: string;
  sourceSemanticBytes: number;
  state: RustLegacyWorldStateClassificationV1;
  projection: RustLegacyWorldProjectionV1;
}>;

type CompatibilityChunkV1 = Readonly<{
  chunkX: number;
  chunkZ: number;
  entries: readonly (readonly [number, number])[];
}>;

type CompatibilityFacingV1 = Readonly<{
  x: number;
  y: number;
  z: number;
  facing: number;
}>;

const FLAG_BY_DOMAIN = Object.freeze({
  entities: RUST_LEGACY_STATE_ENTITIES_V1,
  player: RUST_LEGACY_STATE_PLAYER_V1,
  "runtime-clocks": RUST_LEGACY_STATE_RUNTIME_CLOCKS_V1,
  gameplay: RUST_LEGACY_STATE_GAMEPLAY_V1,
  machines: RUST_LEGACY_STATE_MACHINES_V1,
  map: RUST_LEGACY_STATE_MAP_V1,
  network: RUST_LEGACY_STATE_NETWORK_V1,
  unknown: RUST_LEGACY_STATE_UNKNOWN_V1,
} satisfies Readonly<Record<RustLegacyStateDomainV1, number>>);

const DOMAIN_ORDER = Object.freeze([
  "entities",
  "player",
  "runtime-clocks",
  "gameplay",
  "machines",
  "map",
  "network",
  "unknown",
] satisfies readonly RustLegacyStateDomainV1[]);

const SOURCE_METADATA_PROPERTIES = new Set([
  "version",
  "generatorVersion",
  "generatorProfile",
  "lastSavedGameVersion",
  "seed",
  "savedAt",
]);
const PROJECTED_WORLD_PROPERTIES = new Set(["edits", "blockFacings"]);
const ENTITY_PROPERTIES = new Set([
  "creatures",
  "sleepingCreatures",
  "drops",
  "boats",
  "leads",
  "ecologySectors",
  "contextualLoot",
]);
const PLAYER_PROPERTIES = new Set([
  "player",
  "spawn",
  "startingSettlementId",
  "inventory",
  "cursor",
  "trash",
  "craftGrid",
  "equipment",
  "offhand",
  "bestiary",
  "selected",
  "health",
  "hunger",
  "xp",
  "level",
  "playerVariant",
  "skillState",
  "magicState",
  "potionBuffs",
  "rangedLoaded",
  "plantBestiary",
  "blueprints",
  "goldWallet",
  "bankAccount",
  "stockMarket",
  "digitalItemVault",
  "digitalCreatureArchive",
  "summonContracts",
]);
const RUNTIME_CLOCK_PROPERTIES = new Set(["time", "day", "weather", "weatherState"]);
const GAMEPLAY_PROPERTIES = new Set([
  "mode",
  "options",
  "saplings",
  "veinRegrowth",
  "rustTerrainLocatorEffectJournal",
  "rustTerrainLocatorAppliedEffectIds",
  "questBook",
  "sideQuestDefinitions",
  "guildBook",
  "legendaryEncounters",
  "primeEncounters",
  "factionRelations",
  "settlements",
  "merchants",
  "spellWorldState",
  "cardforge",
]);
const MACHINE_PROPERTIES = new Set([
  "furnaces",
  "wheatMills",
  "chests",
  "apiaries",
  "morphLooms",
  "orbRacks",
  "healingStations",
  "aquariums",
  "fieldPerches",
  "golemForges",
  "alchemyStands",
  "distilleries",
  "sugarworks",
  "archiveShelves",
  "tomeDisplays",
]);
const MAP_PROPERTIES = new Set([
  "mapKnowledge",
  "surfaceRoadGraph",
  "roadEvents",
  "activatedStructureMarkers",
]);
const NETWORK_PROPERTIES = new Set([
  "multiplayerPlayers",
  "multiplayerProgressions",
  "multiplayerWallets",
  "agentPlatform",
]);

export class RustLegacyWorldMigrationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RustLegacyWorldMigrationError";
  }
}

function fail(code: string, message: string): never {
  throw new RustLegacyWorldMigrationError(code, message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-source", `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid-source", `${label} must not carry a custom prototype`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") fail("invalid-source", `${label} must not contain symbol keys`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail("invalid-source", `${label}.${key} must be an enumerable data property`);
    }
  }
  return value as Record<string, unknown>;
}

function compareNumber(left: number, right: number) {
  return left - right;
}

function compareOrdinal(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function integer(value: unknown, minimum: number, maximum: number, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    fail("invalid-integer", `${label} must be an integer in ${minimum}..${maximum}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function visibleUnicodeLabel(value: unknown, maximumUtf16: number, label: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumUtf16) {
    fail("invalid-address", `${label} must contain 1..${maximumUtf16} visible UTF-16 units`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x1f || unit === 0x7f) {
      fail("invalid-address", `${label} must contain 1..${maximumUtf16} visible UTF-16 units`);
    }
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) fail("invalid-address", `${label} contains an unpaired surrogate`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("invalid-address", `${label} contains an unpaired surrogate`);
    }
  }
  return value;
}

function normalizeAddress(value: RustLegacyWorldAddressV1) {
  return Object.freeze({
    universeId: visibleUnicodeLabel(value?.universeId, 64, "address.universeId"),
    locationId: visibleUnicodeLabel(value?.locationId, 128, "address.locationId"),
  });
}

function normalizeRevision(value: RustLegacyWorldProjectionRevisionV1) {
  return Object.freeze({
    epoch: integer(value?.epoch, 0, JS_MAX_SAFE_INTEGER_V1, "revision.epoch"),
    mutation: integer(value?.mutation, 0, JS_MAX_SAFE_INTEGER_V1, "revision.mutation"),
    residency: integer(value?.residency, 0, JS_MAX_SAFE_INTEGER_V1, "revision.residency"),
  });
}

function canonicalChunkCoordinate(raw: string, label: string) {
  if (!/^-?(?:0|[1-9]\d*)$/u.test(raw)) fail("invalid-edits", `${label} is not a canonical decimal coordinate`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < MIN_CELL_CHUNK_V1 || value > MAX_CELL_CHUNK_V1 || String(value) !== raw) {
    fail("invalid-edits", `${label} is outside the cell-addressable chunk range`);
  }
  return value;
}

function normalizeEdits(value: unknown) {
  const source = record(value, "save.edits");
  const sourceKeys = Object.keys(source);
  if (sourceKeys.length > WORLD_MAX_CHUNKS_V1) fail("projection-size", `save.edits exceeds ${WORLD_MAX_CHUNKS_V1} chunks`);
  const chunks: CompatibilityChunkV1[] = [];
  const finalCells = new Map<string, number>();
  let editCount = 0;
  let collapsedDuplicateEdits = 0;
  for (const key of sourceKeys) {
    const match = /^([^,]+),([^,]+)$/u.exec(key);
    if (!match) fail("invalid-edits", `save.edits key ${JSON.stringify(key)} must be chunkX,chunkZ`);
    const chunkX = canonicalChunkCoordinate(match[1], `save.edits key ${JSON.stringify(key)} chunkX`);
    const chunkZ = canonicalChunkCoordinate(match[2], `save.edits key ${JSON.stringify(key)} chunkZ`);
    const rawEntries = source[key];
    if (!Array.isArray(rawEntries)) fail("invalid-edits", `save.edits[${JSON.stringify(key)}] must be an array`);
    if (rawEntries.length > WORLD_COLUMN_CELLS_V1) {
      fail("projection-size", `save.edits[${JSON.stringify(key)}] exceeds ${WORLD_COLUMN_CELLS_V1} bounded entries`);
    }
    const final = new Map<number, number>();
    for (let entryIndex = 0; entryIndex < rawEntries.length; entryIndex += 1) {
      const entry = rawEntries[entryIndex];
      if (!Array.isArray(entry) || entry.length !== 2) {
        fail("invalid-edits", `save.edits[${JSON.stringify(key)}][${entryIndex}] must be an exact [index, blockId] pair`);
      }
      const index = integer(entry[0], 0, WORLD_COLUMN_CELLS_V1 - 1, `save.edits[${JSON.stringify(key)}][${entryIndex}][0]`);
      const blockId = integer(entry[1], 0, 0xfffe, `save.edits[${JSON.stringify(key)}][${entryIndex}][1]`);
      if (final.has(index)) collapsedDuplicateEdits += 1;
      final.set(index, blockId);
    }
    if (final.size === 0) continue;
    const entries = [...final.entries()].sort(([left], [right]) => compareNumber(left, right)) as Array<[number, number]>;
    for (const [index, blockId] of entries) finalCells.set(`${chunkX},${chunkZ},${index}`, blockId);
    chunks.push(Object.freeze({ chunkX, chunkZ, entries: Object.freeze(entries.map((entry) => Object.freeze(entry))) }));
    editCount += entries.length;
  }
  chunks.sort((left, right) => compareNumber(left.chunkX, right.chunkX) || compareNumber(left.chunkZ, right.chunkZ));
  return Object.freeze({ chunks: Object.freeze(chunks), finalCells, editCount, collapsedDuplicateEdits });
}

function cellIndex(x: number, y: number, z: number) {
  const chunkX = Math.floor(x / WORLD_CHUNK_SIZE_V1);
  const chunkZ = Math.floor(z / WORLD_CHUNK_SIZE_V1);
  const localX = x - chunkX * WORLD_CHUNK_SIZE_V1;
  const localZ = z - chunkZ * WORLD_CHUNK_SIZE_V1;
  return Object.freeze({
    chunkX,
    chunkZ,
    index: localX + WORLD_CHUNK_SIZE_V1 * localZ + WORLD_CHUNK_SIZE_V1 * WORLD_CHUNK_SIZE_V1 * (y - WORLD_MIN_Y_V1),
  });
}

function canonicalCellCoordinate(raw: string, label: string) {
  if (!/^-?(?:0|[1-9]\d*)$/u.test(raw)) fail("invalid-facing", `${label} is not a canonical decimal coordinate`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < I32_MIN || value > I32_MAX || String(value) !== raw) {
    fail("invalid-facing", `${label} must be a signed 32-bit integer`);
  }
  return value;
}

function normalizeFacings(value: unknown, finalCells: ReadonlyMap<string, number>) {
  if (value === undefined) return Object.freeze({ facings: Object.freeze([] as CompatibilityFacingV1[]), ignoredOrphanFacings: 0 });
  const source = record(value, "save.blockFacings");
  const keys = Object.keys(source);
  if (keys.length > WORLD_MAX_FACINGS_V1) fail("projection-size", `save.blockFacings exceeds ${WORLD_MAX_FACINGS_V1} entries`);
  const facings: CompatibilityFacingV1[] = [];
  let ignoredOrphanFacings = 0;
  for (const key of keys) {
    const match = /^([^,]+),([^,]+),([^,]+)$/u.exec(key);
    if (!match) fail("invalid-facing", `save.blockFacings key ${JSON.stringify(key)} must be x,y,z`);
    const x = canonicalCellCoordinate(match[1], `save.blockFacings key ${JSON.stringify(key)} x`);
    const y = canonicalCellCoordinate(match[2], `save.blockFacings key ${JSON.stringify(key)} y`);
    const z = canonicalCellCoordinate(match[3], `save.blockFacings key ${JSON.stringify(key)} z`);
    if (y < WORLD_MIN_Y_V1 || y > WORLD_MAX_Y_V1) {
      fail("invalid-facing", `save.blockFacings key ${JSON.stringify(key)} y is outside ${WORLD_MIN_Y_V1}..${WORLD_MAX_Y_V1}`);
    }
    const facing = integer(source[key], 0, 3, `save.blockFacings[${JSON.stringify(key)}]`);
    const cell = cellIndex(x, y, z);
    const blockId = finalCells.get(`${cell.chunkX},${cell.chunkZ},${cell.index}`);
    if (blockId === undefined) {
      ignoredOrphanFacings += 1;
      continue;
    }
    if (blockId === 0) fail("invalid-facing", `save.blockFacings[${JSON.stringify(key)}] targets a final air edit`);
    facings.push(Object.freeze({ x, y, z, facing }));
  }
  facings.sort((left, right) => compareNumber(left.y, right.y) || compareNumber(left.z, right.z) || compareNumber(left.x, right.x));
  return Object.freeze({ facings: Object.freeze(facings), ignoredOrphanFacings });
}

function addressJson(address: RustLegacyWorldAddressV1) {
  return `{"locationId":${JSON.stringify(address.locationId)},"universeId":${JSON.stringify(address.universeId)}}`;
}

function revisionJson(revision: RustLegacyWorldProjectionRevisionV1) {
  return `{"epoch":${revision.epoch},"mutation":${revision.mutation},"residency":${revision.residency}}`;
}

function editsJson(edits: readonly CompatibilityChunkV1[]) {
  return `[${edits.map((chunk) => `{"chunkX":${chunk.chunkX},"chunkZ":${chunk.chunkZ},"entries":[${chunk.entries.map(([index, blockId]) => `[${index},${blockId}]`).join(",")}]}`).join(",")}]`;
}

function facingsJson(facings: readonly CompatibilityFacingV1[]) {
  return `[${facings.map((entry) => `{"facing":${entry.facing},"x":${entry.x},"y":${entry.y},"z":${entry.z}}`).join(",")}]`;
}

function compatibilityChecksum(
  address: RustLegacyWorldAddressV1,
  revision: RustLegacyWorldProjectionRevisionV1,
  edits: readonly CompatibilityChunkV1[],
  facings: readonly CompatibilityFacingV1[],
) {
  const canonical = `{"address":${addressJson(address)},"edits":${editsJson(edits)},"facings":${facingsJson(facings)},"revision":${revisionJson(revision)},"schemaVersion":1}`;
  return new TypeScriptCanonicalHasher("blockwild-world-compatibility-save-v1").writeString(canonical).finishHex();
}

function addressKey(address: RustLegacyWorldAddressV1) {
  return `${encodeURIComponent(address.universeId)}@${encodeURIComponent(address.locationId)}`;
}

function extensionChecksum(
  address: RustLegacyWorldAddressV1,
  revision: RustLegacyWorldProjectionRevisionV1,
  edits: readonly CompatibilityChunkV1[],
  facings: readonly CompatibilityFacingV1[],
  checksum: string,
) {
  const hasher = new TypeScriptCanonicalHasher("blockwild-world-compatibility-save-r4-v1")
    .writeString(addressKey(address))
    .writeU64(revision.epoch)
    .writeU64(revision.mutation)
    .writeU64(revision.residency)
    .writeU32(edits.length);
  for (const chunk of edits) {
    hasher.writeI32(chunk.chunkX).writeI32(chunk.chunkZ).writeU32(chunk.entries.length);
    for (const [index, blockId] of chunk.entries) hasher.writeU32(index).writeU16(blockId);
  }
  hasher.writeU32(facings.length);
  for (const facing of facings) {
    hasher.writeI32(facing.x).writeI32(facing.y).writeI32(facing.z).writeBytes(Uint8Array.of(facing.facing));
  }
  // liquidLevels are deliberately not projected. A source that contains that property is blocked below.
  return hasher.writeU32(0).writeString(checksum).finishHex();
}

class WireWriter {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || length > WORLD_CODEC_MAX_BYTES_V1) {
      fail("projection-size", `BWAS projection exceeds ${WORLD_CODEC_MAX_BYTES_V1} bytes`);
    }
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }

  raw(value: Uint8Array) { this.bytes.set(value, this.offset); this.offset += value.byteLength; return this; }
  u8(value: number) { this.view.setUint8(this.offset, value); this.offset += 1; return this; }
  u16(value: number) { this.view.setUint16(this.offset, value, true); this.offset += 2; return this; }
  u32(value: number) { this.view.setUint32(this.offset, value, true); this.offset += 4; return this; }
  i32(value: number) { this.view.setInt32(this.offset, value, true); this.offset += 4; return this; }
  u64(value: number) { this.view.setBigUint64(this.offset, BigInt(value), true); this.offset += 8; return this; }
  string(value: string) {
    const encoded = textEncoder.encode(value);
    if (encoded.byteLength > 0xffff) fail("projection-size", "BWAS string exceeds its u16 byte bound");
    return this.u16(encoded.byteLength).raw(encoded);
  }
  hash(value: string) {
    if (!/^[0-9a-f]{32}$/u.test(value)) fail("projection-hash", "BWAS checksum must be lowercase 128-bit hexadecimal");
    return this.raw(textEncoder.encode(value));
  }
  finish() {
    if (this.offset !== this.bytes.byteLength) fail("projection-size", "BWAS projection length accounting diverged");
    return this.bytes;
  }
}

function encodeProjection(
  address: RustLegacyWorldAddressV1,
  revision: RustLegacyWorldProjectionRevisionV1,
  edits: readonly CompatibilityChunkV1[],
  facings: readonly CompatibilityFacingV1[],
  checksum: string,
  extension: string,
) {
  const universeBytes = textEncoder.encode(address.universeId).byteLength;
  const locationBytes = textEncoder.encode(address.locationId).byteLength;
  let length = 4 + 2 + 2 + universeBytes + 2 + locationBytes + 24 + 4 + 4 + 4 + 32 + 32;
  for (const chunk of edits) length += 12 + chunk.entries.length * 6;
  length += facings.length * 13;
  const writer = new WireWriter(length)
    .raw(textEncoder.encode("BWAS"))
    .u16(RUST_LEGACY_WORLD_MIGRATION_SCHEMA_V1)
    .string(address.universeId)
    .string(address.locationId)
    .u64(revision.epoch)
    .u64(revision.mutation)
    .u64(revision.residency)
    .u32(edits.length);
  for (const chunk of edits) {
    writer.i32(chunk.chunkX).i32(chunk.chunkZ).u32(chunk.entries.length);
    for (const [index, blockId] of chunk.entries) writer.u32(index).u16(blockId);
  }
  writer.u32(facings.length);
  for (const facing of facings) writer.i32(facing.x).i32(facing.y).i32(facing.z).u8(facing.facing);
  return writer.u32(0).hash(checksum).hash(extension).finish();
}

function strictJsonSource(value: unknown, path: string, ancestors: Set<object>, depth = 0): void {
  if (depth > 96) fail("invalid-source", `${path} exceeds the maximum JSON nesting depth`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid-source", `${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== "object") fail("invalid-source", `${path} contains a non-JSON value`);
  if (ancestors.has(value)) fail("invalid-source", `${path} contains a cycle`);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) fail("invalid-source", `${path} contains a non-plain array`);
  } else if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid-source", `${path} contains a non-plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) fail("invalid-source", `${path} contains a symbol key`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const key of ownKeys) {
      if (key === "length") continue;
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
        fail("invalid-source", `${path} contains a non-index array property`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) fail("invalid-source", `${path}[${key}] is not plain JSON data`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("invalid-source", `${path} contains a sparse array`);
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor || !("value" in descriptor)) fail("invalid-source", `${path}[${index}] is not plain JSON data`);
      strictJsonSource(descriptor.value, `${path}[${index}]`, ancestors, depth + 1);
    }
  } else {
    for (const key of ownKeys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) fail("invalid-source", `${path}.${key} is not plain JSON data`);
      strictJsonSource(descriptor.value, `${path}.${key}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function domainForProperty(property: string): RustLegacyStateDomainV1 | null {
  if (ENTITY_PROPERTIES.has(property)) return "entities";
  if (PLAYER_PROPERTIES.has(property)) return "player";
  if (RUNTIME_CLOCK_PROPERTIES.has(property)) return "runtime-clocks";
  if (GAMEPLAY_PROPERTIES.has(property)) return "gameplay";
  if (MACHINE_PROPERTIES.has(property)) return "machines";
  if (MAP_PROPERTIES.has(property)) return "map";
  if (NETWORK_PROPERTIES.has(property)) return "network";
  if (SOURCE_METADATA_PROPERTIES.has(property) || PROJECTED_WORLD_PROPERTIES.has(property)) return null;
  // liquidLevels are intentionally caught here. Its richer LiquidCell shape has no proven BWAS conversion.
  return "unknown";
}

/**
 * Classify rich custody by property presence, never by whether a value looks empty or default.
 * Projected facings additionally require exact edit backing because generator-relative facings are not yet proven equivalent.
 * This is deliberately conservative: a normal WorldSave remains blocked until each rich domain has an explicit owner.
 */
export function classifyRustLegacyWorldSaveV1(save: WorldSave | Readonly<Record<string, unknown>>): RustLegacyWorldStateClassificationV1 {
  const source = record(save, "save");
  const grouped = new Map<RustLegacyStateDomainV1, string[]>();
  for (const property of Object.keys(source).sort(compareOrdinal)) {
    const domain = domainForProperty(property);
    if (!domain) continue;
    let properties = grouped.get(domain);
    if (!properties) {
      properties = [];
      grouped.set(domain, properties);
    }
    properties.push(property);
  }
  if (source.blockFacings !== undefined) {
    const normalizedEdits = normalizeEdits(source.edits);
    const normalizedFacings = normalizeFacings(source.blockFacings, normalizedEdits.finalCells);
    if (normalizedFacings.ignoredOrphanFacings > 0) {
      const properties = grouped.get("unknown") ?? [];
      properties.push("blockFacings");
      properties.sort(compareOrdinal);
      grouped.set("unknown", properties);
    }
  }
  let flags = 0;
  const domains: RustLegacyStateDomainV1[] = [];
  const properties: Partial<Record<RustLegacyStateDomainV1, readonly string[]>> = {};
  for (const domain of DOMAIN_ORDER) {
    const names = grouped.get(domain);
    if (!names?.length) continue;
    flags |= FLAG_BY_DOMAIN[domain];
    domains.push(domain);
    properties[domain] = Object.freeze([...names]);
  }
  return Object.freeze({ flags, domains: Object.freeze(domains), properties: Object.freeze(properties) });
}

/** Encode the exact binary BWAS V1 projection consumed by Rust's decode_compatibility_save_binary_v1. */
export function encodeRustLegacyWorldProjectionV1(input: Readonly<{
  save: Pick<WorldSave, "edits" | "blockFacings"> | Readonly<Record<string, unknown>>;
  address: RustLegacyWorldAddressV1;
  revision?: RustLegacyWorldProjectionRevisionV1;
}>): RustLegacyWorldProjectionV1 {
  const source = record(input.save, "save");
  const address = normalizeAddress(input.address);
  const revision = normalizeRevision(input.revision ?? RUST_LEGACY_WORLD_PROJECTION_REVISION_V1);
  const normalizedEdits = normalizeEdits(source.edits);
  const normalizedFacings = normalizeFacings(source.blockFacings, normalizedEdits.finalCells);
  const checksum = compatibilityChecksum(address, revision, normalizedEdits.chunks, normalizedFacings.facings);
  const extension = extensionChecksum(address, revision, normalizedEdits.chunks, normalizedFacings.facings, checksum);
  const bytes = encodeProjection(address, revision, normalizedEdits.chunks, normalizedFacings.facings, checksum, extension);
  return Object.freeze({
    schemaVersion: RUST_LEGACY_WORLD_MIGRATION_SCHEMA_V1,
    address,
    revision,
    bytes,
    projectionHash: persistencePayloadHashV1(bytes),
    compatibilityChecksum: checksum,
    extensionChecksum: extension,
    chunkCount: normalizedEdits.chunks.length,
    editCount: normalizedEdits.editCount,
    facingCount: normalizedFacings.facings.length,
    collapsedDuplicateEdits: normalizedEdits.collapsedDuplicateEdits,
    ignoredOrphanFacings: normalizedFacings.ignoredOrphanFacings,
  });
}

/** Build provenance and a fail-closed eligibility decision without performing migration or inferring profile ownership. */
export function planRustLegacyWorldMigrationV1(input: Readonly<{
  save: WorldSave | Readonly<Record<string, unknown>>;
  address: RustLegacyWorldAddressV1;
  revision?: RustLegacyWorldProjectionRevisionV1;
}>): RustLegacyWorldMigrationPlanV1 {
  const source = record(input.save, "save");
  strictJsonSource(source, "save", new Set());
  const canonicalSource = encodeCanonicalWorldSaveValueV1(source);
  if (canonicalSource.byteLength > LEGACY_SOURCE_MAX_BYTES_V1) {
    fail("source-size", `canonical legacy source exceeds ${LEGACY_SOURCE_MAX_BYTES_V1} bytes`);
  }
  const state = classifyRustLegacyWorldSaveV1(source);
  const projection = encodeRustLegacyWorldProjectionV1({ save: source, address: input.address, revision: input.revision });
  return Object.freeze({
    schemaVersion: RUST_LEGACY_WORLD_MIGRATION_SCHEMA_V1,
    status: state.flags === 0 && projection.ignoredOrphanFacings === 0 ? "world-only" : "blocked",
    sourceSemanticHash: persistencePayloadHashV1(canonicalSource),
    sourceSemanticBytes: canonicalSource.byteLength,
    state,
    projection,
  });
}

/** Prevent a blocked plan from being accidentally passed to the native world-only transport. */
export function requireRustLegacyWorldOnlyMigrationV1(plan: RustLegacyWorldMigrationPlanV1) {
  if (plan.projection.ignoredOrphanFacings !== 0) {
    fail("legacy-migration-orphan-facing", "legacy save contains block facings whose generated blocks cannot be proven equivalent by the world-only projection");
  }
  if (plan.status !== "world-only" || plan.state.flags !== 0) {
    fail("legacy-migration-rich-save", `legacy save retains unsupported native domains: ${plan.state.domains.join(", ") || "unknown"}`);
  }
  if (persistencePayloadHashV1(plan.projection.bytes) !== plan.projection.projectionHash) {
    fail("projection-hash", "legacy BWAS projection bytes no longer match their canonical provenance hash");
  }
  return plan;
}
