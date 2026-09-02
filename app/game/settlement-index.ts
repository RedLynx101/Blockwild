import { NPC_FACTION_IDS, normalizeEnabledFactions, type NpcFactionId } from "./factions.ts";
import {
  SETTLEMENT_SIZE_RULES,
  planSettlementCandidate,
  settlementBiomeEligible,
  settlementWinsSpacingTieBreak,
  type SettlementBiome,
  type SettlementCandidate,
  type SettlementEnvironment,
  type SettlementSize,
} from "./settlements.ts";
import { planRegionalRoadGraph, type RoadNode } from "./surface-roads.ts";

export const SETTLEMENT_REGION_BLOCKS = 32 * 16;
export const SETTLEMENT_PROVINCE_REGIONS = 8;
export const SETTLEMENT_PROVINCE_BLOCKS = SETTLEMENT_REGION_BLOCKS * SETTLEMENT_PROVINCE_REGIONS;
export const DEFAULT_SETTLEMENT_ORIGIN_SEARCH_RADIUS = 18;
export const MAX_SETTLEMENT_ORIGIN_SEARCH_RADIUS = 64;

export type SettlementPattern = "legacy-scattered-v1" | "heartlands-v2";
export type SettlementClustering = "even" | "regional" | "strong";
export type RoadCoverage = "none" | "local" | "regional" | "dense";
export type LargeTownFrequency = "rare" | "balanced" | "frequent";
export type SettlementProvinceClass = "wild" | "frontier" | "heartland" | "crossroads";
export type SettlementKnowledge = "rumored" | "charted" | "visited";

export type WorldOriginPreference =
  | Readonly<{ mode: "wilderness" }>
  | Readonly<{ mode: "near-any-settlement" }>
  | Readonly<{ mode: "culture-settlement"; factionId: NpcFactionId; minimumSize: SettlementSize }>;

export type SettlementPlacementOptions = Readonly<{
  settlementPattern: SettlementPattern;
  settlementDensity: number;
  settlementClustering: SettlementClustering;
  roadCoverage: RoadCoverage;
  largeTownFrequency: LargeTownFrequency;
  structures: boolean;
  enabledFactions: readonly NpcFactionId[];
}>;

export type SettlementTerrainSample = Readonly<{
  height: number;
  waterline: number;
  biome: SettlementBiome | null;
  /** True for a protected liquid/structure footprint that cannot host a settlement. */
  forbidden?: boolean;
}>;

export type SettlementTerrainSampler = (x: number, z: number) => SettlementTerrainSample;

export type SettlementProvincePlan = Readonly<{
  id: string;
  provinceX: number;
  provinceZ: number;
  classification: SettlementProvinceClass;
  principalFactionId: NpcFactionId | null;
  parentRegion: Readonly<{ x: number; z: number }>;
  memberRegions: readonly Readonly<{ x: number; z: number; role: "parent" | "satellite" | "solitary" }>[];
}>;

export type SettlementIndexResult = Readonly<{
  candidate: SettlementCandidate;
  distanceBlocks: number;
  provinceId: string;
  provinceClass: SettlementProvinceClass;
  roadNodeId: string | null;
}>;

export type SettlementQuery = Readonly<{
  origin: Readonly<{ x: number; z: number }>;
  factionIds?: readonly NpcFactionId[];
  sizes?: readonly SettlementSize[];
  environments?: readonly SettlementEnvironment[];
  excludeIds?: ReadonlySet<string> | readonly string[];
  maxRegionRadius?: number;
  limit?: number;
}>;

export type SettlementRoadTier = "local" | "regional" | "trunk";
export type SettlementRoadConnection = Readonly<{
  id: string;
  from: SettlementCandidate;
  to: SettlementCandidate;
  length: number;
  loop: boolean;
  tier: SettlementRoadTier;
  ownerProvinceId: string;
}>;

type RegionIntent = Readonly<{
  role: "parent" | "satellite" | "solitary";
  size: SettlementSize;
  preferredFactionId: NpcFactionId | null;
  province: SettlementProvincePlan;
}>;

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const floorDiv = (value: number, divisor: number) => Math.floor(value / divisor);
const compareCanonicalSettlementId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export function normalizeSettlementOriginSearchRadius(value: unknown) {
  return Math.floor(clamp(
    typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_SETTLEMENT_ORIGIN_SEARCH_RADIUS,
    0,
    MAX_SETTLEMENT_ORIGIN_SEARCH_RADIUS,
  ));
}

function hash32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function hashUnit(seed: string, salt: string) {
  return hash32(`${seed}|${salt}`) / 0x1_0000_0000;
}

function seedToInt(seed: string) { return hash32(seed); }

function hash2(x: number, z: number, seed: number) {
  let n = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function optionsKey(options: SettlementPlacementOptions) {
  return [
    options.settlementPattern,
    options.settlementDensity.toFixed(2),
    options.settlementClustering,
    options.roadCoverage,
    options.largeTownFrequency,
    options.structures ? 1 : 0,
    options.enabledFactions.join(","),
  ].join("|");
}

export function normalizeWorldOriginPreference(value: unknown, enabledFactions: readonly NpcFactionId[] = NPC_FACTION_IDS): WorldOriginPreference {
  if (!value || typeof value !== "object") return Object.freeze({ mode: "wilderness" });
  const input = value as Partial<WorldOriginPreference> & { factionId?: unknown; minimumSize?: unknown };
  if (input.mode === "near-any-settlement") return Object.freeze({ mode: "near-any-settlement" });
  if (input.mode === "culture-settlement" && typeof input.factionId === "string" && enabledFactions.includes(input.factionId as NpcFactionId)) {
    const minimumSize: SettlementSize = input.minimumSize === "town" ? "town" : input.minimumSize === "village" ? "village" : "hamlet";
    return Object.freeze({ mode: "culture-settlement", factionId: input.factionId as NpcFactionId, minimumSize });
  }
  return Object.freeze({ mode: "wilderness" });
}

export function normalizeSettlementPlacementOptions(value?: Partial<SettlementPlacementOptions> | null): SettlementPlacementOptions {
  const enabledFactions = normalizeEnabledFactions(value?.enabledFactions);
  const density = typeof value?.settlementDensity === "number" && Number.isFinite(value.settlementDensity)
    ? Math.round(clamp(value.settlementDensity, 0, 2) * 100) / 100 : 1;
  return Object.freeze({
    settlementPattern: value?.settlementPattern === "legacy-scattered-v1" ? "legacy-scattered-v1" : "heartlands-v2",
    settlementDensity: density,
    settlementClustering: value?.settlementClustering === "even" || value?.settlementClustering === "strong" ? value.settlementClustering : "regional",
    roadCoverage: value?.roadCoverage === "none" || value?.roadCoverage === "local" || value?.roadCoverage === "dense" ? value.roadCoverage : "regional",
    largeTownFrequency: value?.largeTownFrequency === "rare" || value?.largeTownFrequency === "frequent" ? value.largeTownFrequency : "balanced",
    structures: value?.structures !== false,
    enabledFactions: Object.freeze([...enabledFactions]),
  });
}

function provinceId(provinceX: number, provinceZ: number) {
  return `province:${provinceX},${provinceZ}`;
}

function provinceClassification(seed: string, options: SettlementPlacementOptions, provinceX: number, provinceZ: number): SettlementProvinceClass {
  if (!options.structures || !options.enabledFactions.length || options.settlementDensity <= 0) return "wild";
  const clusteringCoverage = options.settlementClustering === "strong" ? 0.29 : options.settlementClustering === "even" ? 0.48 : 0.38;
  const coverage = clamp(clusteringCoverage * Math.pow(options.settlementDensity, 0.72), 0, 0.82);
  const roll = hashUnit(seed, `heartland-class|${provinceX}|${provinceZ}`);
  if (roll >= coverage) return "wild";
  const kind = hashUnit(seed, `heartland-kind|${provinceX}|${provinceZ}`);
  if (kind < 0.1) return "crossroads";
  if (kind < 0.56) return "heartland";
  return "frontier";
}

function parentRegion(seed: string, provinceX: number, provinceZ: number) {
  const originX = provinceX * SETTLEMENT_PROVINCE_REGIONS;
  const originZ = provinceZ * SETTLEMENT_PROVINCE_REGIONS;
  return Object.freeze({
    x: originX + 2 + Math.floor(hashUnit(seed, `heartland-parent-x|${provinceX}|${provinceZ}`) * 4),
    z: originZ + 2 + Math.floor(hashUnit(seed, `heartland-parent-z|${provinceX}|${provinceZ}`) * 4),
  });
}

function principalFaction(seed: string, options: SettlementPlacementOptions, parent: Readonly<{ x: number; z: number }>, sample: SettlementTerrainSampler) {
  if (!options.enabledFactions.length) return null;
  const terrain = sample(parent.x * SETTLEMENT_REGION_BLOCKS + SETTLEMENT_REGION_BLOCKS / 2, parent.z * SETTLEMENT_REGION_BLOCKS + SETTLEMENT_REGION_BLOCKS / 2);
  const eligible = terrain.biome ? options.enabledFactions.filter((factionId) => settlementBiomeEligible(factionId, terrain.biome!)) : [];
  const pool = eligible.length ? eligible : options.enabledFactions;
  return pool[Math.floor(hashUnit(seed, `heartland-culture|${parent.x}|${parent.z}`) * pool.length)] ?? null;
}

function settlementCount(classification: SettlementProvinceClass, options: SettlementPlacementOptions) {
  if (classification === "wild") return 0;
  const base = classification === "frontier" ? 2 : classification === "heartland" ? 5 : 6;
  const clusteringBonus = options.settlementClustering === "strong" ? 1 : options.settlementClustering === "even" ? -1 : 0;
  return clamp(Math.round(base * clamp(options.settlementDensity, 0.35, 2) + clusteringBonus), 1, 10);
}

function memberRegionsForProvince(seed: string, options: SettlementPlacementOptions, provinceX: number, provinceZ: number, classification: SettlementProvinceClass, parent: Readonly<{ x: number; z: number }>) {
  if (classification === "wild") return Object.freeze([]) as SettlementProvincePlan["memberRegions"];
  const count = settlementCount(classification, options);
  const originX = provinceX * SETTLEMENT_PROVINCE_REGIONS;
  const originZ = provinceZ * SETTLEMENT_PROVINCE_REGIONS;
  const distanceWeight = options.settlementClustering === "strong" ? 3.8 : options.settlementClustering === "regional" ? 1.75 : 0.18;
  const cells: Array<{ x: number; z: number; score: number }> = [];
  for (let localX = 0; localX < SETTLEMENT_PROVINCE_REGIONS; localX += 1) for (let localZ = 0; localZ < SETTLEMENT_PROVINCE_REGIONS; localZ += 1) {
    const x = originX + localX;
    const z = originZ + localZ;
    if (x === parent.x && z === parent.z) continue;
    const distance = Math.hypot(x - parent.x, z - parent.z);
    const edgePenalty = localX === 0 || localZ === 0 || localX === 7 || localZ === 7 ? 0.55 : 0;
    const score = distance * distanceWeight + edgePenalty + hashUnit(seed, `heartland-member|${provinceX}|${provinceZ}|${x}|${z}`) * 5;
    cells.push({ x, z, score });
  }
  cells.sort((left, right) => left.score - right.score || left.x - right.x || left.z - right.z);
  return Object.freeze([
    Object.freeze({ ...parent, role: "parent" as const }),
    ...cells.slice(0, Math.max(0, count - 1)).map(({ x, z }) => Object.freeze({ x, z, role: "satellite" as const })),
  ]);
}

export function querySettlementProvince(
  seed: string,
  optionsValue: Partial<SettlementPlacementOptions>,
  provinceX: number,
  provinceZ: number,
  sample: SettlementTerrainSampler,
): SettlementProvincePlan {
  const options = normalizeSettlementPlacementOptions(optionsValue);
  const classification = options.settlementPattern === "legacy-scattered-v1" ? "frontier" : provinceClassification(seed, options, provinceX, provinceZ);
  const parent = parentRegion(seed, provinceX, provinceZ);
  const principalFactionId = principalFaction(seed, options, parent, sample);
  return Object.freeze({
    id: provinceId(provinceX, provinceZ), provinceX, provinceZ, classification, principalFactionId,
    parentRegion: parent,
    memberRegions: memberRegionsForProvince(seed, options, provinceX, provinceZ, classification, parent),
  });
}

function regionIntent(seed: string, options: SettlementPlacementOptions, regionX: number, regionZ: number, sample: SettlementTerrainSampler): RegionIntent | null {
  const provinceX = floorDiv(regionX, SETTLEMENT_PROVINCE_REGIONS);
  const provinceZ = floorDiv(regionZ, SETTLEMENT_PROVINCE_REGIONS);
  const province = querySettlementProvince(seed, options, provinceX, provinceZ, sample);
  if (options.settlementPattern === "legacy-scattered-v1") return Object.freeze({ role: "solitary", size: "hamlet", preferredFactionId: null, province });
  const member = province.memberRegions.find((entry) => entry.x === regionX && entry.z === regionZ);
  if (!member) {
    const solitaryChance = 0.004 * options.settlementDensity * (province.classification === "wild" ? 1 : 0.2);
    if (hashUnit(seed, `frontier-solitary|${regionX}|${regionZ}`) >= solitaryChance) return null;
    return Object.freeze({ role: "solitary", size: "hamlet", preferredFactionId: null, province });
  }
  if (member.role === "parent") {
    const townChance = options.largeTownFrequency === "frequent" ? 0.94 : options.largeTownFrequency === "rare" ? 0.48 : 0.76;
    const size: SettlementSize = province.classification === "frontier" || hashUnit(seed, `heartland-parent-size|${regionX}|${regionZ}`) > townChance ? "village" : "town";
    return Object.freeze({ role: "parent", size, preferredFactionId: province.principalFactionId, province });
  }
  const villageChance = options.largeTownFrequency === "frequent" ? 0.52 : options.largeTownFrequency === "rare" ? 0.22 : 0.36;
  const size: SettlementSize = hashUnit(seed, `heartland-satellite-size|${regionX}|${regionZ}`) < villageChance ? "village" : "hamlet";
  const cultureRoll = hashUnit(seed, `heartland-satellite-culture|${regionX}|${regionZ}`);
  return Object.freeze({ role: "satellite", size, preferredFactionId: cultureRoll < 0.82 ? province.principalFactionId : null, province });
}

function siteCandidate(
  seed: string,
  options: SettlementPlacementOptions,
  regionX: number,
  regionZ: number,
  sample: SettlementTerrainSampler,
  intent: RegionIntent,
) {
  const originX = regionX * SETTLEMENT_REGION_BLOCKS;
  const originZ = regionZ * SETTLEMENT_REGION_BLOCKS;
  const preferred = intent.preferredFactionId && options.enabledFactions.includes(intent.preferredFactionId) ? [intent.preferredFactionId] : options.enabledFactions;
  const factionPasses = preferred.length === options.enabledFactions.length ? [preferred] : [preferred, options.enabledFactions];
  let best: { candidate: SettlementCandidate; score: number } | null = null;
  const numericSeed = seedToInt(seed);
  for (const enabledFactions of factionPasses) {
    for (let siteIndex = 0; siteIndex < 16; siteIndex += 1) {
      const gridX = siteIndex % 4;
      const gridZ = Math.floor(siteIndex / 4);
      const jitterX = Math.floor(((options.settlementPattern === "legacy-scattered-v1"
        ? hash2(regionX * 31 + siteIndex, regionZ, numericSeed ^ 0x51a7e5)
        : hashUnit(seed, `site-x|${regionX}|${regionZ}|${siteIndex}`)) - 0.5) * 46);
      const jitterZ = Math.floor(((options.settlementPattern === "legacy-scattered-v1"
        ? hash2(regionX, regionZ * 31 + siteIndex, numericSeed ^ 0x7e115e)
        : hashUnit(seed, `site-z|${regionX}|${regionZ}|${siteIndex}`)) - 0.5) * 46);
      const x = originX + 80 + gridX * 112 + jitterX;
      const z = originZ + 80 + gridZ * 112 + jitterZ;
      const terrain = sample(x, z);
      if (!terrain.biome || terrain.forbidden) continue;
      const planned = planSettlementCandidate({
        worldSeed: seed, regionX, regionZ, biome: terrain.biome, existing: [], floorY: terrain.height,
        enabledFactions, siteSearch: true,
      });
      if (!planned) continue;
      const resolvedSize = options.settlementPattern === "legacy-scattered-v1" ? planned.size : intent.size;
      const environment = planned.environment ?? "surface";
      const underwater = environment === "underwater";
      if (underwater ? terrain.height >= terrain.waterline - 5 : terrain.height <= terrain.waterline + 3) continue;
      const footprint = Math.min(12, SETTLEMENT_SIZE_RULES[resolvedSize].radiusBlocks);
      const neighboring = [[footprint, 0], [-footprint, 0], [0, footprint], [0, -footprint]].map(([dx, dz]) => sample(x + dx, z + dz));
      if (neighboring.some((entry) => entry.forbidden)) continue;
      const relief = Math.max(...neighboring.map((entry) => Math.abs(entry.height - terrain.height)));
      const limit = underwater ? 7 : environment === "underground" ? 12 : 5;
      if (relief > limit) continue;
      const floorY = underwater ? terrain.height : environment === "underground" ? Math.max(-54, terrain.height - 18) : undefined;
      const candidate = Object.freeze({
        ...planned,
        size: resolvedSize,
        center: Object.freeze({ x, z, ...(floorY === undefined ? {} : { y: floorY + 2 }) }),
        ...(floorY === undefined ? {} : { floorY }),
      });
      const waterAccess = Math.abs(terrain.height - terrain.waterline) <= 8 ? 1 : 0;
      const culturePriority = candidate.factionId === "dwarves" || candidate.factionId === "sugarcourt" || candidate.factionId === "wood-elves" ? 9
        : candidate.factionId === "goblins" ? 5 : candidate.factionId === "atlantians" ? 2 : 0;
      const scoreNoise = options.settlementPattern === "legacy-scattered-v1"
        ? hash2(x, z, numericSeed ^ 0x510e5e) : hashUnit(seed, `site-score|${x}|${z}`);
      const score = relief * 12 - waterAccess * 4 - culturePriority + scoreNoise * 3;
      if (!best || score < best.score) best = { candidate, score };
    }
    if (best) break;
  }
  if (!best) return null;
  if (options.settlementPattern === "legacy-scattered-v1") {
    const chance = best.candidate.factionId === "hobbits" ? 0.06
      : best.candidate.factionId === "atlantians" ? 0.18
        : best.candidate.factionId === "goblins" ? 0.58
          : best.candidate.factionId === "wood-elves" ? 0.82 : 0.9;
    if (hash2(regionX, regionZ, numericSeed ^ 0x2e1b2138) > chance) return null;
  }
  return best.candidate;
}

function contextualSpacing(candidate: SettlementCandidate, provinceClass: SettlementProvinceClass) {
  const table: Record<SettlementProvinceClass, Record<SettlementSize, number>> = {
    wild: { hamlet: 384, village: 512, town: 672 },
    frontier: { hamlet: 256, village: 384, town: 576 },
    heartland: { hamlet: 192, village: 288, town: 480 },
    crossroads: { hamlet: 192, village: 288, town: 480 },
  };
  return table[provinceClass][candidate.size];
}

function spacingWinner(candidate: SettlementCandidate, candidateClass: SettlementProvinceClass, contenders: readonly { candidate: SettlementCandidate; classification: SettlementProvinceClass }[]) {
  const rank = hash32(`${candidate.worldSeed}|heartlands-spacing|${candidate.id}`);
  for (const contender of contenders) {
    const other = contender.candidate;
    if (other.id === candidate.id) continue;
    const required = Math.max(contextualSpacing(candidate, candidateClass), contextualSpacing(other, contender.classification));
    if (Math.hypot(candidate.center.x - other.center.x, candidate.center.z - other.center.z) >= required) continue;
    const otherRank = hash32(`${other.worldSeed}|heartlands-spacing|${other.id}`);
    if (otherRank < rank || otherRank === rank && other.id < candidate.id) return false;
  }
  return true;
}

class BoundedLru<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly maximum: number) {}
  get(key: K) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key: K, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maximum) this.map.delete(this.map.keys().next().value!);
  }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

export class SettlementIndex {
  private readonly rawCache = new BoundedLru<string, SettlementCandidate | null>(4096);
  private readonly validatedCache = new BoundedLru<string, SettlementCandidate | null>(4096);
  private readonly provinceCache = new BoundedLru<string, SettlementProvincePlan>(256);

  clear() { this.rawCache.clear(); this.validatedCache.clear(); this.provinceCache.clear(); }
  get cacheSize() { return this.rawCache.size + this.validatedCache.size + this.provinceCache.size; }

  province(seed: string, optionsValue: Partial<SettlementPlacementOptions>, provinceX: number, provinceZ: number, sample: SettlementTerrainSampler) {
    const options = normalizeSettlementPlacementOptions(optionsValue);
    const key = `${seed}|${optionsKey(options)}|${provinceX},${provinceZ}`;
    const cached = this.provinceCache.get(key);
    if (cached) return cached;
    const planned = querySettlementProvince(seed, options, provinceX, provinceZ, sample);
    this.provinceCache.set(key, planned);
    return planned;
  }

  private raw(seed: string, optionsValue: Partial<SettlementPlacementOptions>, regionX: number, regionZ: number, sample: SettlementTerrainSampler) {
    const options = normalizeSettlementPlacementOptions(optionsValue);
    const key = `${seed}|${optionsKey(options)}|${regionX},${regionZ}`;
    const cached = this.rawCache.get(key);
    if (cached !== undefined) return cached;
    if (!options.structures || !options.enabledFactions.length || options.settlementDensity <= 0) {
      this.rawCache.set(key, null);
      return null;
    }
    const intent = regionIntent(seed, options, regionX, regionZ, sample);
    const candidate = intent ? siteCandidate(seed, options, regionX, regionZ, sample, intent) : null;
    this.rawCache.set(key, candidate);
    return candidate;
  }

  candidateForRegion(seed: string, optionsValue: Partial<SettlementPlacementOptions>, regionX: number, regionZ: number, sample: SettlementTerrainSampler) {
    const options = normalizeSettlementPlacementOptions(optionsValue);
    const key = `${seed}|${optionsKey(options)}|validated|${regionX},${regionZ}`;
    const cached = this.validatedCache.get(key);
    if (cached !== undefined) return cached;
    const planned = this.raw(seed, options, regionX, regionZ, sample);
    if (!planned) { this.validatedCache.set(key, null); return null; }
    const center = sample(planned.center.x, planned.center.z);
    const environment = planned.environment ?? "surface";
    const underwater = environment === "underwater";
    const underground = environment === "underground";
    const nearby = [[4, 0], [-4, 0], [0, 4], [0, -4]].map(([dx, dz]) => sample(planned.center.x + dx, planned.center.z + dz));
    const terrainValid = center.biome === planned.biome && !center.forbidden
      && !(underwater ? center.height >= center.waterline - 5 : center.height <= center.waterline + 3)
      && nearby.every((entry) => !entry.forbidden && Math.abs(entry.height - center.height) <= (underwater ? 7 : underground ? 12 : 4));
    if (!terrainValid) { this.validatedCache.set(key, null); return null; }
    const ownProvince = this.province(seed, options, floorDiv(regionX, 8), floorDiv(regionZ, 8), sample);
    const contenders: Array<{ candidate: SettlementCandidate; classification: SettlementProvinceClass }> = [];
    for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) {
      if (dx === 0 && dz === 0) continue;
      const candidate = this.raw(seed, options, regionX + dx, regionZ + dz, sample);
      if (!candidate) continue;
      const province = this.province(seed, options, floorDiv(regionX + dx, 8), floorDiv(regionZ + dz, 8), sample);
      contenders.push({ candidate, classification: province.classification });
    }
    const accepted = (options.settlementPattern === "legacy-scattered-v1"
      ? settlementWinsSpacingTieBreak(planned, contenders.map((entry) => entry.candidate))
      : spacingWinner(planned, ownProvince.classification, contenders)) ? planned : null;
    this.validatedCache.set(key, accepted);
    return accepted;
  }

  queryNearest(
    seed: string,
    optionsValue: Partial<SettlementPlacementOptions>,
    query: SettlementQuery,
    sample: SettlementTerrainSampler,
    acceptCandidate?: (candidate: SettlementCandidate) => boolean,
  ) {
    return this.queryNearestMany(seed, optionsValue, { ...query, limit: 1 }, sample, acceptCandidate)[0] ?? null;
  }

  queryNearestMany(
    seed: string,
    optionsValue: Partial<SettlementPlacementOptions>,
    query: SettlementQuery,
    sample: SettlementTerrainSampler,
    acceptCandidate?: (candidate: SettlementCandidate) => boolean,
  ) {
    const options = normalizeSettlementPlacementOptions(optionsValue);
    if (!options.structures || !options.enabledFactions.length || options.settlementDensity <= 0) return Object.freeze([]) as readonly SettlementIndexResult[];
    // Locator transport uses integer milliblocks so Rust and the compatibility
    // oracle share exact fractional-player distance and tie semantics.
    const originXMillis = Math.round(query.origin.x * 1_000);
    const originZMillis = Math.round(query.origin.z * 1_000);
    const originRegionX = floorDiv(originXMillis, SETTLEMENT_REGION_BLOCKS * 1_000);
    const originRegionZ = floorDiv(originZMillis, SETTLEMENT_REGION_BLOCKS * 1_000);
    const limit = clamp(Math.floor(query.limit ?? 1), 1, 32);
    const maxRadius = clamp(Math.floor(query.maxRegionRadius ?? 24), 0, 96);
    const factions = query.factionIds ? new Set(query.factionIds) : null;
    const sizes = query.sizes ? new Set(query.sizes) : null;
    const environments = query.environments ? new Set(query.environments) : null;
    const excluded = query.excludeIds instanceof Set ? query.excludeIds : new Set(query.excludeIds ?? []);
    const results = new Map<string, SettlementIndexResult & { distanceSquaredMillis: bigint }>();
    for (let radius = 0; radius <= maxRadius; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const regionX = originRegionX + dx;
        const regionZ = originRegionZ + dz;
        const candidate = this.candidateForRegion(seed, options, regionX, regionZ, sample);
        if (!candidate || excluded.has(candidate.id) || factions && !factions.has(candidate.factionId)
          || sizes && !sizes.has(candidate.size) || environments && !environments.has(candidate.environment ?? "surface")
          || acceptCandidate && !acceptCandidate(candidate)) continue;
        const province = this.province(seed, options, floorDiv(regionX, 8), floorDiv(regionZ, 8), sample);
        const deltaXMillis = BigInt(candidate.center.x) * BigInt(1_000) - BigInt(originXMillis);
        const deltaZMillis = BigInt(candidate.center.z) * BigInt(1_000) - BigInt(originZMillis);
        results.set(candidate.id, Object.freeze({
          candidate,
          distanceBlocks: Math.sqrt(Number(deltaXMillis * deltaXMillis + deltaZMillis * deltaZMillis)) / 1_000,
          distanceSquaredMillis: deltaXMillis * deltaXMillis + deltaZMillis * deltaZMillis,
          provinceId: province.id,
          provinceClass: province.classification,
          roadNodeId: options.roadCoverage !== "none" && candidate.environment === "surface" ? `road:${candidate.id}` : null,
        }));
      }
      const ordered = [...results.values()].sort((left, right) => left.distanceSquaredMillis < right.distanceSquaredMillis ? -1
        : left.distanceSquaredMillis > right.distanceSquaredMillis ? 1 : compareCanonicalSettlementId(left.candidate.id, right.candidate.id));
      if (ordered.length >= limit) {
        // ceil(512_000 * sqrt(2)); shared with Rust. Squared integer
        // comparison avoids platform float drift at an early-exit boundary.
        const regionDiagonalMillisCeil = BigInt(724_078);
        const futureMinimumMillis = BigInt(radius * SETTLEMENT_REGION_BLOCKS * 1_000)
          - regionDiagonalMillisCeil * BigInt(2);
        if (futureMinimumMillis > BigInt(0)
          && futureMinimumMillis * futureMinimumMillis > ordered[limit - 1].distanceSquaredMillis) {
          return Object.freeze(ordered.slice(0, limit));
        }
      }
    }
    return Object.freeze([...results.values()].sort((left, right) => left.distanceSquaredMillis < right.distanceSquaredMillis ? -1
      : left.distanceSquaredMillis > right.distanceSquaredMillis ? 1 : compareCanonicalSettlementId(left.candidate.id, right.candidate.id)).slice(0, limit));
  }

  settlementsInProvince(seed: string, optionsValue: Partial<SettlementPlacementOptions>, provinceX: number, provinceZ: number, sample: SettlementTerrainSampler) {
    const results: SettlementCandidate[] = [];
    for (let dx = 0; dx < 8; dx += 1) for (let dz = 0; dz < 8; dz += 1) {
      const candidate = this.candidateForRegion(seed, optionsValue, provinceX * 8 + dx, provinceZ * 8 + dz, sample);
      if (candidate) results.push(candidate);
    }
    return Object.freeze(results.sort((left, right) => left.id.localeCompare(right.id)));
  }

  roadConnectionsForProvince(seed: string, optionsValue: Partial<SettlementPlacementOptions>, provinceX: number, provinceZ: number, sample: SettlementTerrainSampler) {
    const options = normalizeSettlementPlacementOptions(optionsValue);
    if (options.roadCoverage === "none") return Object.freeze([]) as readonly SettlementRoadConnection[];
    const owner = provinceId(provinceX, provinceZ);
    const localCandidates = this.settlementsInProvince(seed, options, provinceX, provinceZ, sample).filter((candidate) => candidate.environment === "surface");
    const participation = (candidate: SettlementCandidate) => options.roadCoverage === "dense" ? 1
      : options.roadCoverage === "local" ? (candidate.size === "town" ? 0.7 : candidate.size === "village" ? 0.45 : 0.2)
        : candidate.size === "town" ? 1 : candidate.size === "village" ? 0.82 : 0.58;
    const selected = localCandidates.filter((candidate) => hashUnit(seed, `road-participation|${candidate.id}`) < participation(candidate));
    const nodes: RoadNode[] = selected.map((candidate) => ({ id: candidate.id, x: candidate.center.x, z: candidate.center.z, y: candidate.center.y, factionId: candidate.factionId, settlementSize: candidate.size }));
    const byId = new Map(selected.map((candidate) => [candidate.id, candidate]));
    const local = planRegionalRoadGraph(nodes).map((edge): SettlementRoadConnection => {
      const from = byId.get(edge.from.id)!;
      const to = byId.get(edge.to.id)!;
      const tier: SettlementRoadTier = from.size === "town" || to.size === "town" ? "regional" : "local";
      return Object.freeze({ id: edge.id, from, to, length: edge.length, loop: edge.loop, tier, ownerProvinceId: owner });
    });
    if (options.roadCoverage === "local") return Object.freeze(local);
    const trunks: SettlementRoadConnection[] = [];
    const principal = localCandidates.filter((candidate) => candidate.size === "town").sort((a, b) => a.id.localeCompare(b.id))[0]
      ?? localCandidates.filter((candidate) => candidate.size === "village").sort((a, b) => a.id.localeCompare(b.id))[0];
    if (principal) for (const [offsetX, offsetZ] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const neighborX = provinceX + offsetX;
      const neighborZ = provinceZ + offsetZ;
      const neighborOwner = provinceId(neighborX, neighborZ);
      if (owner > neighborOwner) continue;
      const neighbors = this.settlementsInProvince(seed, options, neighborX, neighborZ, sample).filter((candidate) => candidate.environment === "surface");
      const target = neighbors.filter((candidate) => candidate.size === "town").sort((a, b) => a.id.localeCompare(b.id))[0]
        ?? neighbors.filter((candidate) => candidate.size === "village").sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!target) continue;
      const length = Math.hypot(principal.center.x - target.center.x, principal.center.z - target.center.z);
      const id = [principal.id, target.id].sort().join("<->");
      trunks.push(Object.freeze({ id, from: principal, to: target, length, loop: false, tier: "trunk", ownerProvinceId: owner }));
    }
    return Object.freeze([...local, ...trunks].sort((left, right) => left.id.localeCompare(right.id)));
  }

  roadNeighbors(seed: string, optionsValue: Partial<SettlementPlacementOptions>, settlementId: string, sample: SettlementTerrainSampler) {
    const match = /-(-?[0-9a-z]+)-(-?[0-9a-z]+)-[0-9a-z]+$/u.exec(settlementId);
    if (!match) return Object.freeze([]) as readonly SettlementRoadConnection[];
    const regionX = Number.parseInt(match[1], 36);
    const regionZ = Number.parseInt(match[2], 36);
    if (!Number.isFinite(regionX) || !Number.isFinite(regionZ)) return Object.freeze([]);
    const provinceX = floorDiv(regionX, 8);
    const provinceZ = floorDiv(regionZ, 8);
    const edges: SettlementRoadConnection[] = [];
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) edges.push(...this.roadConnectionsForProvince(seed, optionsValue, provinceX + dx, provinceZ + dz, sample));
    return Object.freeze([...new Map(edges.filter((edge) => edge.from.id === settlementId || edge.to.id === settlementId).map((edge) => [edge.id, edge])).values()]);
  }
}

export function settlementCandidateForRegion(seed: string, options: Partial<SettlementPlacementOptions>, regionX: number, regionZ: number, sample: SettlementTerrainSampler) {
  return new SettlementIndex().candidateForRegion(seed, options, regionX, regionZ, sample);
}

export function queryNearestSettlement(seed: string, options: Partial<SettlementPlacementOptions>, query: SettlementQuery, sample: SettlementTerrainSampler) {
  return new SettlementIndex().queryNearest(seed, options, query, sample);
}

export function queryNearestSettlements(seed: string, options: Partial<SettlementPlacementOptions>, query: SettlementQuery, sample: SettlementTerrainSampler) {
  return new SettlementIndex().queryNearestMany(seed, options, query, sample);
}

export function roadNeighborsForSettlement(seed: string, options: Partial<SettlementPlacementOptions>, settlementId: string, sample: SettlementTerrainSampler) {
  return new SettlementIndex().roadNeighbors(seed, options, settlementId, sample);
}
