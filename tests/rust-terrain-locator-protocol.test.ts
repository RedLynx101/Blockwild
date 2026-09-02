import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CanonicalGenerationHasher,
  TERRAIN_LOCATOR_MAX_OPTIONS_BYTES_V1,
  TERRAIN_LOCATOR_MAX_ORIGIN_MILLIS_V1,
  TERRAIN_LOCATOR_MAX_SEED_BYTES_V1,
  createDragonLairLocatorRequestV1,
  createSettlementLocatorRequestV1,
  hashDragonLairLocatorRequestV1,
  hashSettlementLocatorRequestV1,
  type DragonLairLocatorRequestV1,
  type DragonLairLocatorResultV1,
  type SettlementLocatorRequestV1,
  type SettlementLocatorResultV1,
  type TerrainDragonSurveyTypeV1,
} from "../app/game/terrain-generation-contract.ts";
import {
  decodeRustDragonLairLocatorResultV1,
  decodeRustSettlementLocatorResultV1,
  encodeRustDragonLairLocatorRequestV1,
  encodeRustSettlementLocatorRequestV1,
} from "../app/game/rust-terrain-generation-bridge.ts";
import { dragonLairCandidateForRegion } from "../app/game/dragon-world.ts";
import { settlementId as productionSettlementId } from "../app/game/settlements.ts";
import { planSeaDragonNest } from "../app/game/v1-cultures.ts";

type SettlementEntry = SettlementLocatorResultV1["entries"][number];
type LairEntry = NonNullable<DragonLairLocatorResultV1["entry"]>;

const encoder = new TextEncoder();
const HASH_DENOMINATOR = 4_294_967_296;
const MILLIS = BigInt(1_000);

class PacketWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  constructor(magic: string) { this.raw(encoder.encode(magic)); }

  private raw(value: Uint8Array) { this.chunks.push(value); this.length += value.byteLength; }
  u8(value: number) { this.raw(Uint8Array.of(value)); }
  u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); this.raw(bytes); }
  i32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setInt32(0, value, true); this.raw(bytes); }
  u64(value: bigint) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, value, true); this.raw(bytes); }
  string(value: string) { const bytes = encoder.encode(value); const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, bytes.byteLength, true); this.raw(length); this.raw(bytes); }
  finish() { const result = new Uint8Array(this.length); let offset = 0;
    for (const chunk of this.chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result; }
}

class PacketReader {
  private readonly view: DataView;
  private offset = 4;

  constructor(private readonly value: Uint8Array, magic: string) {
    this.view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    assert.deepEqual([...value.subarray(0, 4)], [...encoder.encode(magic)]);
  }

  private take(length: number) {
    const end = this.offset + length;
    assert.ok(Number.isSafeInteger(end) && end <= this.value.byteLength, "vector request is truncated");
    const result = this.value.subarray(this.offset, end);
    this.offset = end;
    return result;
  }

  u8() { return this.take(1)[0]; }
  u16() { const offset = this.offset; this.take(2); return this.view.getUint16(offset, true); }
  i64() { const offset = this.offset; this.take(8); return this.view.getBigInt64(offset, true); }
  string() { const offset = this.offset; this.take(4); const length = this.view.getUint32(offset, true);
    return new TextDecoder("utf-8", { fatal: true }).decode(this.take(length)); }
  done() { assert.equal(this.offset, this.value.byteLength, "vector request contains trailing bytes"); }
}

function optionalStringList(reader: PacketReader) {
  const present = reader.u8();
  assert.ok(present === 0 || present === 1);
  if (present === 0) return undefined;
  return Object.freeze(Array.from({ length: reader.u8() }, () => reader.string()));
}

function decodeSettlementVectorRequest(bytes: Uint8Array): SettlementLocatorRequestV1 {
  const reader = new PacketReader(bytes, "BWSQ");
  const schemaVersion = reader.u16();
  assert.equal(schemaVersion, 1);
  const seedText = reader.string();
  const optionsJson = reader.string();
  const originXMillis = reader.i64();
  const originZMillis = reader.i64();
  const factionIds = optionalStringList(reader);
  const sizes = optionalStringList(reader);
  const environments = optionalStringList(reader);
  const excludeIds = Object.freeze(Array.from({ length: reader.u16() }, () => reader.string()));
  const maxRegionRadius = reader.u16();
  const limit = reader.u8();
  const waterFlag = reader.u8();
  assert.ok(waterFlag === 0 || waterFlag === 1);
  const requestHash = reader.string();
  reader.done();
  return Object.freeze({ schemaVersion, epoch: 1, taskId: 1, seedText, optionsJson, originXMillis, originZMillis,
    factionIds, sizes, environments, excludeIds, maxRegionRadius, limit, breathesWater: waterFlag === 1,
    requestHash }) as unknown as SettlementLocatorRequestV1;
}

function decodeLairVectorRequest(bytes: Uint8Array): DragonLairLocatorRequestV1 {
  const reader = new PacketReader(bytes, "BWLQ");
  const schemaVersion = reader.u16();
  assert.equal(schemaVersion, 1);
  const seedText = reader.string();
  const optionsJson = reader.string();
  const originXMillis = reader.i64();
  const originZMillis = reader.i64();
  const dragonType = reader.string();
  const minimumStage = reader.u8();
  const excludeIds = Object.freeze(Array.from({ length: reader.u16() }, () => reader.string()));
  const maxRegionRadius = reader.u16();
  const requestHash = reader.string();
  reader.done();
  return Object.freeze({ schemaVersion, epoch: 1, taskId: 1, seedText, optionsJson, originXMillis, originZMillis,
    dragonType, minimumStage, excludeIds, maxRegionRadius, requestHash }) as unknown as DragonLairLocatorRequestV1;
}

function plannerHash32(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function plannerUnit(seed: string, salt: string) {
  return plannerHash32(`${seed}|${salt}`) / HASH_DENOMINATOR;
}

function dragonUnit(seed: string, salt: string) {
  let value = plannerHash32(`${seed}|${salt}`);
  value = Math.imul(value ^ (value >>> 15), 2_246_822_519);
  value = Math.imul(value ^ (value >>> 13), 3_266_489_917);
  return ((value ^ (value >>> 16)) >>> 0) / HASH_DENOMINATOR;
}

function distanceSquared(x: number, z: number, originXMillis: bigint, originZMillis: bigint) {
  const dx = BigInt(x) * MILLIS - originXMillis;
  const dz = BigInt(z) * MILLIS - originZMillis;
  return dx * dx + dz * dz;
}

function settlementId(seed: string, regionX: number, regionZ: number, faction: SettlementEntry["factionId"]) {
  return productionSettlementId(seed, regionX, regionZ, faction);
}

function settlementEntry(
  request: SettlementLocatorRequestV1,
  regionX: number,
  regionZ: number,
  localX = 57,
  localZ = 57,
): SettlementEntry {
  const x = regionX * 512 + localX;
  const z = regionZ * 512 + localZ;
  return Object.freeze({
    id: settlementId(request.seedText, regionX, regionZ, "hobbits"),
    factionId: "hobbits",
    size: "hamlet",
    environment: "surface",
    biome: "forest",
    regionX,
    regionZ,
    x,
    z,
    floorY: null,
    distanceSquaredMillis: distanceSquared(x, z, request.originXMillis, request.originZMillis),
    publicArrival: Object.freeze({ x, yMillis: 35_510, z, anchorKind: "public-approach" }),
  });
}

function settlementRuleEntry(
  request: SettlementLocatorRequestV1,
  factionId: SettlementEntry["factionId"],
  biome: SettlementEntry["biome"],
  environment: SettlementEntry["environment"],
  floorY: number | null,
  anchorKind: string,
  yMillis: number,
): SettlementEntry {
  const base = settlementEntry(request, 0, 0);
  return Object.freeze({ ...base, id: settlementId(request.seedText, 0, 0, factionId), factionId, biome, environment,
    floorY, publicArrival: Object.freeze({ ...base.publicArrival!, yMillis, anchorKind }) });
}

function settlementResultPacket(request: SettlementLocatorRequestV1, entries: readonly SettlementEntry[]) {
  const writer = new PacketWriter("BWSR");
  const hash = new CanonicalGenerationHasher("blockwild-settlement-query-result-v1");
  writer.u16(1); writer.string(request.requestHash); writer.u8(entries.length);
  hash.writeString(request.requestHash); hash.writeU16(entries.length);
  for (const entry of entries) {
    const arrival = entry.publicArrival!;
    writer.string(entry.id); writer.string(entry.factionId); writer.string(entry.size); writer.string(entry.environment);
    writer.string(entry.biome); writer.i32(entry.regionX); writer.i32(entry.regionZ); writer.i32(entry.x); writer.i32(entry.z);
    writer.u8(entry.floorY === null ? 0 : 1); if (entry.floorY !== null) writer.i32(entry.floorY);
    writer.u64(entry.distanceSquaredMillis); writer.i32(arrival.x); writer.i32(arrival.yMillis); writer.i32(arrival.z);
    writer.string(arrival.anchorKind);
    hash.writeString(entry.id); hash.writeString(entry.factionId); hash.writeString(entry.size); hash.writeString(entry.environment);
    hash.writeString(entry.biome); hash.writeI32(entry.regionX); hash.writeI32(entry.regionZ); hash.writeI32(entry.x);
    hash.writeI32(entry.z); hash.writeU16(entry.floorY === null ? 0 : 1);
    if (entry.floorY !== null) hash.writeI32(entry.floorY);
    hash.writeU64(entry.distanceSquaredMillis); hash.writeI32(arrival.x); hash.writeI32(arrival.yMillis);
    hash.writeI32(arrival.z); hash.writeString(arrival.anchorKind);
  }
  writer.string(hash.finish());
  return writer.finish();
}

function terrestrialType(seed: string, regionX: number, regionZ: number): Exclude<TerrainDragonSurveyTypeV1, "sea"> {
  const roll = dragonUnit(seed, `dragon-type:${regionX},${regionZ}`);
  return roll < 0.31 ? "fire" : roll < 0.62 ? "ice" : roll < 0.93 ? "steel" : roll < 0.965 ? "gold" : "silver";
}

function findTerrestrialRegion(seed: string, type: Exclude<TerrainDragonSurveyTypeV1, "sea">, minimumRadius: number, maximumRadius: number) {
  for (let radius = minimumRadius; radius <= maximumRadius; radius += 1) {
    for (let regionX = -radius; regionX <= radius; regionX += 1) for (let regionZ = -radius; regionZ <= radius; regionZ += 1) {
      if (Math.max(Math.abs(regionX), Math.abs(regionZ)) !== radius) continue;
      if (dragonUnit(seed, `dragon-lair-present:${regionX},${regionZ}`) >= 0.29
        && terrestrialType(seed, regionX, regionZ) === type) return { regionX, regionZ };
    }
  }
  throw new Error(`No ${type} lair fixture region found`);
}

function terrestrialEntry(request: DragonLairLocatorRequestV1, regionX: number, regionZ: number, y = -46): LairEntry {
  const candidate = dragonLairCandidateForRegion({ seed: request.seedText, regionX, regionZ, surfaceYAt: () => -24 });
  assert.ok(candidate);
  assert.equal(candidate.origin.y, -46);
  return Object.freeze({
    id: candidate.id,
    dragonType: candidate.type,
    stage: candidate.stage,
    sex: candidate.sex,
    x: candidate.origin.x,
    y,
    z: candidate.origin.z,
    distanceSquaredMillis: distanceSquared(candidate.origin.x, candidate.origin.z,
      request.originXMillis, request.originZMillis),
  });
}

function findSeaRegion(seed: string, minimumRadius: number, maximumRadius: number) {
  for (let radius = minimumRadius; radius <= maximumRadius; radius += 1) {
    for (let regionX = -radius; regionX <= radius; regionX += 1) for (let regionZ = -radius; regionZ <= radius; regionZ += 1) {
      if (Math.max(Math.abs(regionX), Math.abs(regionZ)) !== radius) continue;
      const salt = `${seed}|sea-dragon-nest|${regionX}|${regionZ}`;
      if (plannerUnit(salt, "rarity") < 0.115) return { regionX, regionZ };
    }
  }
  throw new Error("No sea-lair fixture region found");
}

function seaEntry(request: DragonLairLocatorRequestV1, regionX: number, regionZ: number, y = -58): LairEntry {
  const candidate = planSeaDragonNest({ seed: request.seedText, regionX, regionZ, oceanFloorY: y - 2,
    biome: "deep-ocean" });
  assert.ok(candidate);
  assert.equal(candidate.center.y, y);
  return Object.freeze({
    id: candidate.id,
    dragonType: "sea",
    stage: candidate.guardianStage,
    sex: candidate.guardianSex,
    x: candidate.center.x,
    y,
    z: candidate.center.z,
    distanceSquaredMillis: distanceSquared(candidate.center.x, candidate.center.z,
      request.originXMillis, request.originZMillis),
  });
}

function lairResultPacket(request: DragonLairLocatorRequestV1, entry: LairEntry | null) {
  const writer = new PacketWriter("BWLR");
  const hash = new CanonicalGenerationHasher("blockwild-lair-query-result-v1");
  writer.u16(1); writer.string(request.requestHash); writer.u8(entry ? 1 : 0);
  hash.writeString(request.requestHash); hash.writeU16(entry ? 1 : 0);
  if (entry) {
    writer.string(entry.id); writer.string(entry.dragonType); writer.u8(entry.stage); writer.string(entry.sex);
    writer.i32(entry.x); writer.i32(entry.y); writer.i32(entry.z); writer.u64(entry.distanceSquaredMillis);
    hash.writeString(entry.id); hash.writeString(entry.dragonType); hash.writeU16(entry.stage); hash.writeString(entry.sex);
    hash.writeI32(entry.x); hash.writeI32(entry.y); hash.writeI32(entry.z); hash.writeU64(entry.distanceSquaredMillis);
  }
  writer.string(hash.finish());
  return writer.finish();
}

test("locator text bounds use UTF-8 bytes before hashing and transport", () => {
  const exactSeed = "é".repeat(TERRAIN_LOCATOR_MAX_SEED_BYTES_V1 / 2);
  const settlement = createSettlementLocatorRequestV1({ epoch: 1, taskId: 1, seedText: exactSeed,
    generationOptions: {}, origin: { x: 0, z: 0 } });
  assert.equal(encoder.encode(settlement.seedText).byteLength, TERRAIN_LOCATOR_MAX_SEED_BYTES_V1);
  assert.doesNotThrow(() => encodeRustSettlementLocatorRequestV1(settlement));
  assert.throws(() => createSettlementLocatorRequestV1({ epoch: 1, taskId: 2, seedText: `${exactSeed}é`,
    generationOptions: {}, origin: { x: 0, z: 0 } }), /2048 UTF-8 bytes/);
  assert.throws(() => createSettlementLocatorRequestV1({ epoch: 1, taskId: 2, seedText: "\ud800",
    generationOptions: {}, origin: { x: 0, z: 0 } }), /well-formed Unicode/);

  const frame = '{"padding":""}';
  const exactOptions = `{"padding":"${"a".repeat(TERRAIN_LOCATOR_MAX_OPTIONS_BYTES_V1 - encoder.encode(frame).byteLength)}"}`;
  const oversizedOptions = `${exactOptions} `;
  assert.equal(encoder.encode(exactOptions).byteLength, TERRAIN_LOCATOR_MAX_OPTIONS_BYTES_V1);
  const settlementAtLimit = { ...settlement, seedText: "locator-byte-limit", optionsJson: exactOptions };
  const settlementHash = hashSettlementLocatorRequestV1(settlementAtLimit);
  assert.doesNotThrow(() => encodeRustSettlementLocatorRequestV1({ ...settlementAtLimit, requestHash: settlementHash }));
  assert.throws(() => hashSettlementLocatorRequestV1({ ...settlementAtLimit, optionsJson: oversizedOptions }), /8192 UTF-8 bytes/);
  assert.throws(() => encodeRustSettlementLocatorRequestV1({ ...settlementAtLimit, optionsJson: oversizedOptions }), /8192 UTF-8 bytes/);

  const lair = createDragonLairLocatorRequestV1({ epoch: 1, taskId: 3, seedText: "locator-byte-limit",
    generationOptions: {}, origin: { x: 0, z: 0 }, dragonType: "fire", minimumStage: 3 });
  const lairAtLimit = { ...lair, optionsJson: exactOptions };
  const lairHash = hashDragonLairLocatorRequestV1(lairAtLimit);
  assert.doesNotThrow(() => encodeRustDragonLairLocatorRequestV1({ ...lairAtLimit, requestHash: lairHash }));
  assert.throws(() => hashDragonLairLocatorRequestV1({ ...lairAtLimit, optionsJson: oversizedOptions }), /8192 UTF-8 bytes/);
  assert.throws(() => encodeRustDragonLairLocatorRequestV1({ ...lairAtLimit, optionsJson: oversizedOptions }), /8192 UTF-8 bytes/);
});

test("settlement decoder accepts world-edge planner geometry and rejects self-rehashed impossible rows", () => {
  const origin = Number(TERRAIN_LOCATOR_MAX_ORIGIN_MILLIS_V1 / MILLIS);
  const request = createSettlementLocatorRequestV1({ epoch: 4, taskId: 7, seedText: "locator-settlement-protocol",
    generationOptions: {}, origin: { x: origin, z: -origin }, maxRegionRadius: 96, limit: 4 });
  const originRegionX = Math.floor(Number(request.originXMillis) / 512_000);
  const originRegionZ = Math.floor(Number(request.originZMillis) / 512_000);
  const valid = settlementEntry(request, originRegionX + 96, originRegionZ - 96, 438, 438);
  assert.deepEqual(decodeRustSettlementLocatorResultV1(settlementResultPacket(request, [valid]), request).entries, [valid]);

  const remeasure = (entry: SettlementEntry): SettlementEntry => Object.freeze({ ...entry,
    distanceSquaredMillis: distanceSquared(entry.x, entry.z, request.originXMillis, request.originZMillis) });
  const outsideRegion = settlementEntry(request, originRegionX + 97, originRegionZ, 57, 57);
  const impossible: readonly SettlementEntry[] = [
    { ...valid, id: `${valid.id}-forged` },
    remeasure({ ...valid, x: valid.regionX * 512 + 103 }),
    { ...valid, biome: "deep-ocean" },
    { ...valid, environment: "underwater", floorY: -20,
      publicArrival: { ...valid.publicArrival!, yMillis: 33_510, anchorKind: "reef-air-arrival" } },
    { ...valid, floorY: 20 },
    { ...valid, publicArrival: { ...valid.publicArrival!, anchorKind: "surface-entry" } },
    { ...valid, publicArrival: { ...valid.publicArrival!, x: valid.x + 60 } },
    outsideRegion,
  ];
  for (const entry of impossible) {
    assert.throws(() => decodeRustSettlementLocatorResultV1(settlementResultPacket(request, [entry]), request),
      /planner-inconsistent geometry/, entry.id);
  }
});

test("settlement decoder accepts every faction's exact biome, floor, and arrival family", () => {
  const request = createSettlementLocatorRequestV1({ epoch: 5, taskId: 8, seedText: "locator-settlement-rules",
    generationOptions: {}, origin: { x: 0, z: 0 }, maxRegionRadius: 0, limit: 1 });
  const accepted = [
    settlementRuleEntry(request, "hobbits", "forest", "surface", null, "public-approach", -55_490),
    settlementRuleEntry(request, "goblins", "highlands", "surface", null, "public-approach", 120_510),
    settlementRuleEntry(request, "sugarcourt", "sugarplum-vale", "surface", null, "public-approach", 35_510),
    settlementRuleEntry(request, "wood-elves", "glimmerwood", "surface", null, "public-approach", 35_510),
    settlementRuleEntry(request, "dwarves", "badlands", "underground", -54, "surface-entry", -55_490),
    settlementRuleEntry(request, "dwarves", "snowcap-range", "underground", 101, "surface-entry", 35_510),
    settlementRuleEntry(request, "atlantians", "lumen-trench", "underwater", 26, "reef-air-arrival", 33_510),
  ];
  for (const entry of accepted) {
    assert.deepEqual(decodeRustSettlementLocatorResultV1(settlementResultPacket(request, [entry]), request).entries, [entry]);
  }
  const breathingRequest = createSettlementLocatorRequestV1({ epoch: 5, taskId: 9, seedText: request.seedText,
    generationOptions: {}, origin: { x: 0, z: 0 }, maxRegionRadius: 0, limit: 1, breathesWater: true });
  const breathingEntry = settlementRuleEntry(breathingRequest, "atlantians", "deep-ocean", "underwater", -57,
    "public-approach", -55_000);
  assert.deepEqual(decodeRustSettlementLocatorResultV1(
    settlementResultPacket(breathingRequest, [breathingEntry]), breathingRequest,
  ).entries, [breathingEntry]);
  const impossibleReefY = settlementRuleEntry(request, "atlantians", "deep-ocean", "underwater", -20,
    "reef-air-arrival", 34_510);
  assert.throws(() => decodeRustSettlementLocatorResultV1(
    settlementResultPacket(request, [impossibleReefY]), request,
  ), /planner-inconsistent geometry/);
});

test("terrestrial lair decoder binds grid, seeded identity, stage, sex, Y, and scan radius", () => {
  const seed = "locator-terrestrial-protocol";
  const request = createDragonLairLocatorRequestV1({ epoch: 8, taskId: 9, seedText: seed,
    generationOptions: {}, origin: { x: 0, z: 0 }, dragonType: "fire", minimumStage: 3, maxRegionRadius: 64 });
  const region = findTerrestrialRegion(seed, "fire", 0, 64);
  const valid = terrestrialEntry(request, region.regionX, region.regionZ, -46);
  assert.deepEqual(decodeRustDragonLairLocatorResultV1(lairResultPacket(request, valid), request).entry, valid);

  const remeasure = (entry: LairEntry): LairEntry => Object.freeze({ ...entry,
    distanceSquaredMillis: distanceSquared(entry.x, entry.z, request.originXMillis, request.originZMillis) });
  const farRegion = findTerrestrialRegion(seed, "fire", 65, 72);
  const outsideScan = terrestrialEntry(request, farRegion.regionX, farRegion.regionZ);
  const impossible: readonly LairEntry[] = [
    { ...valid, id: `${valid.id}-forged` },
    remeasure({ ...valid, x: valid.x + 1 }),
    { ...valid, stage: valid.stage === 5 ? 4 : 5 },
    { ...valid, sex: valid.sex === "female" ? "male" : "female" },
    { ...valid, y: -15 },
    outsideScan,
  ];
  for (const entry of impossible) {
    assert.throws(() => decodeRustDragonLairLocatorResultV1(lairResultPacket(request, entry), request),
      /planner-inconsistent geometry/, entry.id);
  }
});

test("sea-lair decoder applies its distinct grid, plain culture hash, and Y envelope", () => {
  const seed = "locator-sea-protocol";
  const request = createDragonLairLocatorRequestV1({ epoch: 10, taskId: 11, seedText: seed,
    generationOptions: {}, origin: { x: 0, z: 0 }, dragonType: "sea", minimumStage: 3, maxRegionRadius: 64 });
  const region = findSeaRegion(seed, 0, 64);
  const valid = seaEntry(request, region.regionX, region.regionZ, 10);
  assert.deepEqual(decodeRustDragonLairLocatorResultV1(lairResultPacket(request, valid), request).entry, valid);

  const remeasure = (entry: LairEntry): LairEntry => Object.freeze({ ...entry,
    distanceSquaredMillis: distanceSquared(entry.x, entry.z, request.originXMillis, request.originZMillis) });
  const alternativeStage = valid.stage === 3 ? 4 : 3;
  const impossible: readonly LairEntry[] = [
    { ...valid, id: `${valid.id}-forged` },
    remeasure({ ...valid, z: valid.z + 1 }),
    { ...valid, stage: alternativeStage },
    { ...valid, sex: valid.sex === "female" ? "male" : "female" },
    { ...valid, y: 11 },
  ];
  for (const entry of impossible) {
    assert.throws(() => decodeRustDragonLairLocatorResultV1(lairResultPacket(request, entry), request),
      /planner-inconsistent geometry/, entry.id);
  }
});

test("hardened decoders accept every checked-in native locator vector", () => {
  const vectors = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/locator/native-vectors.json", import.meta.url), "utf8")) as {
    schema: number;
    corpusHash: string;
    rows: readonly Readonly<{ kind: "settlement" | "lair"; id: string; requestHex: string; resultHex: string }>[];
  };
  assert.equal(vectors.schema, 1);
  assert.match(vectors.corpusHash, /^[0-9a-f]{32}$/);
  const counts = { settlement: 0, lair: 0 };
  for (const vector of vectors.rows) {
    const requestBytes = Uint8Array.from(Buffer.from(vector.requestHex, "hex"));
    const resultBytes = Uint8Array.from(Buffer.from(vector.resultHex, "hex"));
    if (vector.kind === "settlement") {
      counts.settlement += 1;
      const request = decodeSettlementVectorRequest(requestBytes);
      assert.equal(hashSettlementLocatorRequestV1(request), request.requestHash, `${vector.id}: request hash drift`);
      assert.doesNotThrow(() => decodeRustSettlementLocatorResultV1(resultBytes, request), vector.id);
    } else {
      counts.lair += 1;
      const request = decodeLairVectorRequest(requestBytes);
      assert.equal(hashDragonLairLocatorRequestV1(request), request.requestHash, `${vector.id}: request hash drift`);
      assert.doesNotThrow(() => decodeRustDragonLairLocatorResultV1(resultBytes, request), vector.id);
    }
  }
  assert.deepEqual(counts, { settlement: 114, lair: 16 });
});
