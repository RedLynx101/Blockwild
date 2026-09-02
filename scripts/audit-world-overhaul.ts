import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { caveEntranceForCell, CAVE_ENTRANCE_CELL_SIZE } from "../app/game/caves";
import { BlockId } from "../app/game/data";
import { NPC_FACTION_IDS } from "../app/game/factions";
import { settlementWinsSpacingTieBreak } from "../app/game/settlements";
import { buildBiomeEcologyAudit, buildUndergroundEcologyAudit } from "./audit-biome-ecology";
import {
  CAVE_GRAPH_CELL_SIZE,
  UNDERGROUND_BIOME_NAMES,
  caveGraphEdgesInBounds,
  caveGraphNodesInBounds,
  nearestUpperCaveNode,
} from "../app/game/underground";
import { BIOME_NAMES, BiomeId, CHUNK_SIZE, ChunkWorld, planDeepgearMineRoad, selectDeepgearLiftSite, selectSettlementSite, type SettlementWorldPlan } from "../app/game/world";

const AUDIT_SEEDS = Object.freeze(["WILDERNESS", "GLASSWATER", "DEEP-ROADS"]);
const SURFACE_RADIUS = 4_096;
const SURFACE_STEP = 64;
const CAVE_RADIUS = 768;

type SurfaceMetric = {
  biome: string;
  samples: number;
  share: number;
  meanElevation: number;
  meanRelief32: number;
  meanSlope64Percent: number;
  elevationRange: readonly [number, number];
  patches: number;
  largestPatchSquareKm: number;
  nearestFromSpawn: number | null;
};

function rounded(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function surfaceAudit(world: ChunkWorld) {
  const records = new Map<BiomeId, { count: number; elevation: number; relief: number; slope: number; minimum: number; maximum: number; nearest: number }>();
  const grid = new Map<string, ReturnType<ChunkWorld["sampleColumn"]>>();
  const isWaterBiome = (biome: BiomeId) => [BiomeId.DeepOcean, BiomeId.Ocean, BiomeId.River, BiomeId.LumenTrench].includes(biome);
  const isInlandBiome = (biome: BiomeId) => !isWaterBiome(biome) && biome !== BiomeId.Beach;
  let samples = 0;
  let transitions = 0;
  let neighborChecks = 0;
  let landTransitions = 0;
  let landNeighborChecks = 0;
  let waterSamples = 0;
  let coastSamples = 0;
  for (let z = -SURFACE_RADIUS; z <= SURFACE_RADIUS; z += SURFACE_STEP) {
    for (let x = -SURFACE_RADIUS; x <= SURFACE_RADIUS; x += SURFACE_STEP) {
      const column = world.sampleColumn(x, z);
      grid.set(`${x},${z}`, column);
      const east = world.sampleColumn(x + SURFACE_STEP, z);
      const south = world.sampleColumn(x, z + SURFACE_STEP);
      const relief = Math.max(
        Math.abs(column.height - world.sampleColumn(x + 32, z).height),
        Math.abs(column.height - world.sampleColumn(x, z + 32).height),
      );
      const record = records.get(column.biome) ?? { count: 0, elevation: 0, relief: 0, slope: 0, minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY, nearest: Number.POSITIVE_INFINITY };
      record.count += 1;
      record.elevation += column.height;
      record.relief += relief;
      record.slope += (Math.abs(column.height - east.height) + Math.abs(column.height - south.height)) / (2 * SURFACE_STEP) * 100;
      record.minimum = Math.min(record.minimum, column.height);
      record.maximum = Math.max(record.maximum, column.height);
      record.nearest = Math.min(record.nearest, Math.hypot(x, z));
      records.set(column.biome, record);
      transitions += Number(east.biome !== column.biome) + Number(south.biome !== column.biome);
      neighborChecks += 2;
      for (const neighbor of [east, south]) if (isInlandBiome(column.biome) && isInlandBiome(neighbor.biome)) {
        landTransitions += Number(neighbor.biome !== column.biome);
        landNeighborChecks += 1;
      }
      waterSamples += Number(isWaterBiome(column.biome));
      coastSamples += Number(column.biome === BiomeId.Beach);
      samples += 1;
    }
  }

  const patchSizes = new Map<BiomeId, number[]>();
  const unseen = new Set(grid.keys());
  while (unseen.size) {
    const firstKey = unseen.values().next().value as string;
    const first = grid.get(firstKey)!;
    unseen.delete(firstKey);
    const stack = [firstKey];
    let size = 0;
    while (stack.length) {
      const currentKey = stack.pop()!;
      const [x, z] = currentKey.split(",").map(Number);
      size += 1;
      for (const [dx, dz] of [[SURFACE_STEP, 0], [-SURFACE_STEP, 0], [0, SURFACE_STEP], [0, -SURFACE_STEP]] as const) {
        const neighborKey = `${x + dx},${z + dz}`;
        if (grid.get(neighborKey)?.biome === first.biome && unseen.delete(neighborKey)) stack.push(neighborKey);
      }
    }
    const sizes = patchSizes.get(first.biome) ?? [];
    sizes.push(size);
    patchSizes.set(first.biome, sizes);
  }
  const biomes: SurfaceMetric[] = (Object.values(BiomeId).filter((value): value is BiomeId => typeof value === "number"))
    .sort((left, right) => left - right)
    .map((id) => {
      const record = records.get(id) ?? { count: 0, elevation: 0, relief: 0, slope: 0, minimum: 0, maximum: 0, nearest: Number.POSITIVE_INFINITY };
      const patches = patchSizes.get(id) ?? [];
      return {
        biome: BIOME_NAMES[id],
        samples: record.count,
        share: rounded(record.count / samples * 100, 3),
        meanElevation: record.count ? rounded(record.elevation / record.count) : 0,
        meanRelief32: record.count ? rounded(record.relief / record.count) : 0,
        meanSlope64Percent: record.count ? rounded(record.slope / record.count) : 0,
        elevationRange: [record.minimum, record.maximum] as const,
        patches: patches.length,
        largestPatchSquareKm: rounded((Math.max(0, ...patches) * SURFACE_STEP ** 2) / 1_000_000, 3),
        nearestFromSpawn: Number.isFinite(record.nearest) ? rounded(record.nearest) : null,
      };
    });
  return {
    radius: SURFACE_RADIUS,
    step: SURFACE_STEP,
    samples,
    biomeCoverage: biomes.filter((entry) => entry.samples > 0).length,
    transitionRate: rounded(transitions / neighborChecks * 100, 2),
    landTransitionRate: rounded(landTransitions / Math.max(1, landNeighborChecks) * 100, 2),
    waterCoverage: rounded(waterSamples / samples * 100, 2),
    coastlineShare: rounded(coastSamples / samples * 100, 2),
    biomes,
  };
}

export function caveAudit(world: ChunkWorld) {
  const nodes = caveGraphNodesInBounds(world.seed, -CAVE_RADIUS, CAVE_RADIUS, -CAVE_RADIUS, CAVE_RADIUS);
  const edges = caveGraphEdgesInBounds(world.seed, -CAVE_RADIUS, CAVE_RADIUS, -CAVE_RADIUS, CAVE_RADIUS);
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    adjacency.get(edge.from.id)?.add(edge.to.id);
    adjacency.get(edge.to.id)?.add(edge.from.id);
  }
  const unseen = new Set(adjacency.keys());
  let components = 0;
  while (unseen.size) {
    components += 1;
    const stack = [unseen.values().next().value as string];
    unseen.delete(stack[0]);
    while (stack.length) {
      const current = stack.pop()!;
      for (const neighbor of adjacency.get(current) ?? []) if (unseen.delete(neighbor)) stack.push(neighbor);
    }
  }

  let mouths = 0;
  let connectedMouths = 0;
  let minimumReachableDepth = Number.POSITIVE_INFINITY;
  const cellRadius = Math.ceil(CAVE_RADIUS / CAVE_ENTRANCE_CELL_SIZE);
  for (let cellX = -cellRadius; cellX <= cellRadius; cellX += 1) for (let cellZ = -cellRadius; cellZ <= cellRadius; cellZ += 1) {
    const entrance = caveEntranceForCell(world.seed, cellX, cellZ);
    if (!entrance || Math.abs(entrance.centerX) > CAVE_RADIUS || Math.abs(entrance.centerZ) > CAVE_RADIUS) continue;
    const column = world.sampleColumn(entrance.centerX, entrance.centerZ);
    if (column.height <= column.waterline + 3) continue;
    mouths += 1;
    const target = nearestUpperCaveNode(world.seed, entrance.centerX, entrance.centerZ);
    const depth = column.height - target.y;
    if (adjacency.has(target.id) && depth >= 25) connectedMouths += 1;
    minimumReachableDepth = Math.min(minimumReachableDepth, depth);
  }
  const biomeCounts: Record<string, number> = {};
  for (const node of nodes) biomeCounts[UNDERGROUND_BIOME_NAMES[node.biome]] = (biomeCounts[UNDERGROUND_BIOME_NAMES[node.biome]] ?? 0) + 1;
  const deadEnds = [...adjacency.values()].filter((neighbors) => neighbors.size <= 1).length;
  const cavernWidths = nodes.map((node) => Math.round(Math.max(node.radiusX, node.radiusZ) * 2));
  const cavernHeights = nodes.map((node) => Math.round(node.radiusY * 2));
  const scaleCounts = Object.fromEntries(["room", "chamber", "great", "cathedral"].map((scale) => [scale, nodes.filter((node) => node.scale === scale).length]));
  const biomeCountsByLayer = Object.fromEntries([0, 1, 2].map((layer) => [String(layer), Object.fromEntries(
    Object.entries(UNDERGROUND_BIOME_NAMES).map(([id, name]) => [name, nodes.filter((node) => node.layer === layer && node.biome === Number(id)).length]),
  )]));
  return {
    radius: CAVE_RADIUS,
    cellSize: CAVE_GRAPH_CELL_SIZE,
    nodes: nodes.length,
    edges: edges.length,
    components,
    loops: Math.max(0, edges.length - nodes.length + components),
    deadEnds,
    deadEndPercent: rounded(deadEnds / Math.max(1, nodes.length) * 100, 2),
    cavernWidthRange: [Math.min(...cavernWidths), Math.max(...cavernWidths)] as const,
    cavernHeightRange: [Math.min(...cavernHeights), Math.max(...cavernHeights)] as const,
    scaleCounts,
    greatCaverns: nodes.filter((node) => node.grand).length,
    cathedralCaverns: nodes.filter((node) => node.scale === "cathedral").length,
    undergroundStreams: edges.filter((edge) => edge.flow === "stream").length,
    waterfalls: edges.filter((edge) => edge.flow === "waterfall").length,
    ecologicalCenters: nodes.filter((node) => node.biome !== 0).length,
    poiNodes: nodes.filter((node) => node.poi !== null).length,
    mouths,
    connectedMouths,
    connectedMouthPercent: mouths ? rounded(connectedMouths / mouths * 100, 1) : 100,
    minimumReachableDepth: Number.isFinite(minimumReachableDepth) ? rounded(minimumReachableDepth) : null,
    biomeCounts,
    biomeCountsByLayer,
  };
}

export function settlementAudit(world: ChunkWorld) {
  const regionRadius = 8;
  const raw: Array<ReturnType<typeof selectSettlementSite>> = [];
  let noViableSite = 0;
  let inhabitedWayposts = 0;
  for (let regionX = -regionRadius; regionX <= regionRadius; regionX += 1) for (let regionZ = -regionRadius; regionZ <= regionRadius; regionZ += 1) {
    const candidate = selectSettlementSite({
      worldSeed: world.seedText,
      seed: world.seed,
      regionX,
      regionZ,
      enabledFactions: world.generationOptions.enabledFactions,
      sample: (x, z) => world.sampleColumn(x, z),
    });
    raw.push(candidate);
    if (!candidate) {
      noViableSite += 1;
      const x = regionX * 512 + 256;
      const z = regionZ * 512 + 256;
      const column = world.sampleColumn(x, z);
      if (column.height > column.waterline + 3) inhabitedWayposts += 1;
    }
  }
  const candidates = raw.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  const accepted = candidates.filter((candidate) => settlementWinsSpacingTieBreak(candidate, candidates));
  const factionCounts = Object.fromEntries(NPC_FACTION_IDS.map((faction) => [faction, accepted.filter((candidate) => candidate.factionId === faction).length]));
  const sizeCounts = Object.fromEntries(["hamlet", "village", "town"].map((size) => [size, accepted.filter((candidate) => candidate.size === size).length]));
  const environmentCounts = Object.fromEntries(["surface", "underwater", "underground"].map((environment) => [environment, accepted.filter((candidate) => candidate.environment === environment).length]));
  const nearestSurface = accepted.filter((candidate) => candidate.environment === "surface")
    .reduce((nearest, candidate) => Math.min(nearest, Math.hypot(candidate.center.x, candidate.center.z)), Number.POSITIVE_INFINITY);
  const widthKm = (regionRadius * 2 + 1) * 512 / 1_000;
  const areaSquareKm = widthKm ** 2;
  return {
    regionRadius,
    areaSquareKm: rounded(areaSquareKm),
    viableCandidates: candidates.length,
    acceptedSettlements: accepted.length,
    rejectedNoViableSite: noViableSite,
    rejectedBySpacing: candidates.length - accepted.length,
    inhabitedWayposts,
    densityPerSquareKm: rounded(accepted.length / areaSquareKm, 3),
    characteristicSpacingKm: accepted.length ? rounded(Math.sqrt(areaSquareKm / accepted.length), 2) : null,
    nearestSurfaceSettlement: Number.isFinite(nearestSurface) ? rounded(nearestSurface) : null,
    factionCounts,
    sizeCounts,
    environmentCounts,
    allCulturesRepresented: NPC_FACTION_IDS.every((faction) => factionCounts[faction] > 0),
  };
}

const DWARF_MOUNTAIN_BIOMES = new Set(["snowcap-range", "highlands", "badlands", "cloudreed-glen", "rocky-forest"]);

/**
 * Generates one real, spacing-approved Deepgear hold and inspects its authored
 * mountain infrastructure block by block. Candidate counts alone cannot catch
 * a capped lift shaft, a missing gate, or a road that failed at a chunk seam.
 */
export function dwarfHoldAudit(world: ChunkWorld) {
  const regionRadius = 8;
  const legacyCandidates: NonNullable<ReturnType<typeof selectSettlementSite>>[] = [];
  if (world.generationOptions.settlementPattern === "legacy-scattered-v1") {
    for (let regionX = -regionRadius; regionX <= regionRadius; regionX += 1) for (let regionZ = -regionRadius; regionZ <= regionRadius; regionZ += 1) {
      const candidate = selectSettlementSite({
        worldSeed: world.seedText,
        seed: world.seed,
        regionX,
        regionZ,
        enabledFactions: world.generationOptions.enabledFactions,
        sample: (x, z) => world.sampleColumn(x, z),
      });
      if (candidate) legacyCandidates.push(candidate);
    }
  }
  const dwarfCandidates = world.generationOptions.settlementPattern === "legacy-scattered-v1"
    ? legacyCandidates.filter((candidate) => candidate.factionId === "dwarves")
    : world.queryNearestSettlements({
      origin: { x: 0, z: 0 },
      factionIds: ["dwarves"],
      environments: ["underground"],
      maxRegionRadius: 48,
      limit: 24,
    }).map((result) => result.candidate);
  const dwarfAccepted = world.generationOptions.settlementPattern === "legacy-scattered-v1"
    ? dwarfCandidates.filter((candidate) => settlementWinsSpacingTieBreak(candidate, legacyCandidates))
    : dwarfCandidates;
  let verified: SettlementWorldPlan | undefined;
  for (const candidate of dwarfAccepted) {
    world.generateChunk(Math.floor(candidate.center.x / CHUNK_SIZE), Math.floor(candidate.center.z / CHUNK_SIZE));
    verified = world.settlementPlans.get(candidate.id);
    if (verified) break;
  }
  if (!verified) return {
    candidates: dwarfCandidates.length,
    accepted: dwarfAccepted.length,
    mountainCompatible: dwarfAccepted.filter((candidate) => DWARF_MOUNTAIN_BIOMES.has(candidate.biome)).length,
    verifiedHoldId: null,
    verifiedBiome: null,
    civicRoles: [] as string[],
    caveGraphTarget: null,
    pairedLift: false,
    shaftClear: false,
    gatehouseComplete: false,
    mineRoadConnected: false,
    discoveryMarker: false,
  };

  const { candidate, layout } = verified;
  const holdY = candidate.floorY ?? world.sampleColumn(candidate.center.x, candidate.center.z).height - 18;
  const lift = selectDeepgearLiftSite(candidate.center, layout.radiusBlocks, holdY, (x, z) => world.sampleColumn(x, z));
  const liftX = lift.x;
  const liftZ = lift.z;
  const liftBottomY = lift.liftBottomY;
  const liftTopY = lift.liftTopY;
  for (let x = liftX - 2; x <= liftX + 2; x += 4) for (let z = liftZ - 2; z <= liftZ + 2; z += 4) {
    world.generateChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
  }

  let shaftClear = liftTopY - liftBottomY >= 5;
  for (let y = liftBottomY + 1; y < liftTopY && shaftClear; y += 1) {
    for (let dx = -1; dx <= 1 && shaftClear; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
      if (world.getBlock(liftX + dx, y, liftZ + dz) !== BlockId.Air) {
        shaftClear = false;
        break;
      }
    }
  }
  const pairedLift = world.getBlock(liftX, liftBottomY, liftZ) === BlockId.DeepgearLift
    && world.getBlock(liftX, liftTopY, liftZ) === BlockId.DeepgearLift;
  const landingRingComplete = [-2, -1, 0, 1, 2].every((dx) => [-2, -1, 0, 1, 2].every((dz) => (
    Math.max(Math.abs(dx), Math.abs(dz)) !== 2
      || world.getBlock(liftX + dx, liftTopY - 1, liftZ + dz) === BlockId.DeepgearBrick
  )));
  const gatehouseComplete = landingRingComplete
    && world.getBlock(liftX - 2, liftTopY + 2, liftZ) === BlockId.RivetedBrass
    && world.getBlock(liftX + 2, liftTopY + 2, liftZ) === BlockId.RivetedBrass
    && world.getBlock(liftX, liftTopY + 4, liftZ) === BlockId.DeepgearBrick
    && world.getBlock(liftX - 2, liftTopY + 2, liftZ + 1) === BlockId.DeepgearLantern
    && world.getBlock(liftX + 2, liftTopY + 2, liftZ + 1) === BlockId.DeepgearLantern;

  const graphTarget = nearestUpperCaveNode(world.seed, candidate.center.x, candidate.center.z);
  const approachStart = { x: candidate.center.x, y: holdY + 2, z: candidate.center.z };
  const approachPath = planDeepgearMineRoad(approachStart, graphTarget);
  const roadProbe = approachPath[Math.max(1, Math.floor(approachPath.length * 0.55))];
  const { x: roadX, y: roadY, z: roadZ } = roadProbe;
  world.generateChunk(Math.floor(roadX / CHUNK_SIZE), Math.floor(roadZ / CHUNK_SIZE));
  const mineRoadConnected = world.getBlock(roadX, roadY - 1, roadZ) === BlockId.DeepgearBrick
    && [0, 1, 2, 3].every((dy) => world.getBlock(roadX, roadY + dy, roadZ) === BlockId.Air);
  const discoveryMarker = [...world.structureMarkers.values()].some((marker) => (
    marker.id === `${candidate.id}:deepgear-lift`
    && marker.type === "landmark"
    && marker.tag?.includes("cave-graph-anchor")
  ));

  return {
    candidates: dwarfCandidates.length,
    accepted: dwarfAccepted.length,
    mountainCompatible: dwarfAccepted.filter((entry) => DWARF_MOUNTAIN_BIOMES.has(entry.biome)).length,
    verifiedHoldId: candidate.id,
    verifiedBiome: candidate.biome,
    civicRoles: [...new Set(layout.buildings.map((building) => building.role))],
    caveGraphTarget: graphTarget.id,
    pairedLift,
    shaftClear,
    gatehouseComplete,
    mineRoadConnected,
    discoveryMarker,
  };
}

export function generatedContentAudit(world: ChunkWorld) {
  const started = performance.now();
  const oreCounts: Record<string, number> = { Iron: 0, Copper: 0, Gold: 0, "Living Vein": 0, "Veinmetal Heart": 0 };
  for (let cz = -1; cz <= 1; cz += 1) for (let cx = -1; cx <= 1; cx += 1) {
    const chunk = world.generateChunk(cx, cz);
    for (const block of chunk.blocks) {
      if (block === BlockId.IronOre) oreCounts.Iron += 1;
      else if (block === BlockId.CopperOre) oreCounts.Copper += 1;
      else if (block === BlockId.GoldOre) oreCounts.Gold += 1;
      else if (block === BlockId.LivingVein) oreCounts["Living Vein"] += 1;
      else if (block === BlockId.VeinmetalHeart) oreCounts["Veinmetal Heart"] += 1;
    }
  }
  const generatedBlocks = 9 * CHUNK_SIZE * CHUNK_SIZE * 192;
  return {
    initialNineChunkGenerationMs: rounded(performance.now() - started),
    generatedBlocks,
    bytesPerGeneratedChunkVoxelField: world.chunks.get("0,0")?.blocks.byteLength ?? 0,
    oreCounts,
    structureMarkers: world.structureMarkers.size,
    settlementPlans: world.settlementPlans.size,
  };
}

export function buildWorldOverhaulAudit(seeds: readonly string[] = AUDIT_SEEDS) {
  return {
    generatedAt: new Date().toISOString(),
    profile: "world-below-v15",
    seeds: seeds.map((seed) => {
      // Historical world-overhaul oracle, not a production authority verifier.
      const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
      world.reset(seed, undefined, { profile: "world-below-v15" });
      return {
        seed,
        surface: surfaceAudit(world),
        caves: caveAudit(world),
        settlements: settlementAudit(world),
        dwarvenHold: dwarfHoldAudit(world),
        generated: generatedContentAudit(world),
      };
    }),
    ecology: {
      surface: buildBiomeEcologyAudit(),
      underground: buildUndergroundEcologyAudit(),
    },
  };
}

export function formatWorldOverhaulAudit(audit: ReturnType<typeof buildWorldOverhaulAudit>) {
  const lines = [
    "BLOCKWILD · THE WORLD BELOW AUDIT",
    `Profile: ${audit.profile}`,
    "",
  ];
  for (const seed of audit.seeds) {
    lines.push(
      `Seed ${seed.seed}`,
      `  Surface biomes found: ${seed.surface.biomeCoverage}/24 within ${seed.surface.radius} blocks`,
      `  64-block transition rate: ${seed.surface.transitionRate}% overall · ${seed.surface.landTransitionRate}% on land`,
      `  Water/coast share: ${seed.surface.waterCoverage}% water · ${seed.surface.coastlineShare}% coast`,
      `  Cave graph: ${seed.caves.nodes} nodes · ${seed.caves.edges} edges · ${seed.caves.loops} loops · ${seed.caves.components} component(s)`,
      `  Trusted mouths: ${seed.caves.connectedMouths}/${seed.caves.mouths} (${seed.caves.connectedMouthPercent}%) · minimum descent ${seed.caves.minimumReachableDepth ?? "n/a"} blocks`,
      `  Cave destinations: ${seed.caves.ecologicalCenters} ecological centers · ${seed.caves.greatCaverns} great caverns (${seed.caves.cathedralCaverns} cathedral) · ${seed.caves.poiNodes} POI nodes`,
      `  Aquifers: ${seed.caves.undergroundStreams} stream routes · ${seed.caves.waterfalls} waterfall shafts`,
      `  Cavern scale: ${seed.caves.cavernWidthRange[0]}-${seed.caves.cavernWidthRange[1]} blocks wide · ${seed.caves.cavernHeightRange[0]}-${seed.caves.cavernHeightRange[1]} tall · ${seed.caves.deadEnds} dead ends`,
      `  Settlements: ${seed.settlements.acceptedSettlements} accepted · ${seed.settlements.characteristicSpacingKm ?? "n/a"} km characteristic spacing · nearest surface ${seed.settlements.nearestSurfaceSettlement ?? "n/a"} blocks`,
      `  Culture coverage: ${Object.entries(seed.settlements.factionCounts).map(([name, count]) => `${name} ${count}`).join(" · ")} · all represented ${seed.settlements.allCulturesRepresented ? "YES" : "NO"}`,
      `  Dwarven holds: ${seed.dwarvenHold.accepted} accepted / ${seed.dwarvenHold.candidates} viable · mountain-compatible ${seed.dwarvenHold.mountainCompatible}/${seed.dwarvenHold.accepted} · verified ${seed.dwarvenHold.verifiedHoldId ?? "NONE"}`,
      `  Deepgear infrastructure: paired lift ${seed.dwarvenHold.pairedLift ? "PASS" : "FAIL"} · clear shaft ${seed.dwarvenHold.shaftClear ? "PASS" : "FAIL"} · gatehouse ${seed.dwarvenHold.gatehouseComplete ? "PASS" : "FAIL"} · mine road ${seed.dwarvenHold.mineRoadConnected ? "PASS" : "FAIL"} · marker ${seed.dwarvenHold.discoveryMarker ? "PASS" : "FAIL"}`,
      `  Initial 3×3 generation: ${seed.generated.initialNineChunkGenerationMs} ms · ${seed.generated.bytesPerGeneratedChunkVoxelField.toLocaleString()} voxel bytes/chunk`,
      `  Ores in generated 3×3: ${Object.entries(seed.generated.oreCounts).map(([name, count]) => `${name} ${count}`).join(" · ")}`,
      "",
    );
  }
  lines.push(
    `Ecology catalogs: ${audit.ecology.surface.length} surface biomes · ${audit.ecology.underground.length} underground layers`,
    "Underground flora/fauna/sound/POI rows:",
    ...audit.ecology.underground.map((entry) => `  ${entry.name}: flora ${entry.flora} · fauna ${entry.fauna} · custom sound ${entry.customSound}/${entry.fauna} · POIs ${entry.poiCount}`),
  );
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const audit = buildWorldOverhaulAudit();
  process.stdout.write(process.argv.includes("--json") ? `${JSON.stringify(audit, null, 2)}\n` : `${formatWorldOverhaulAudit(audit)}\n`);
}
