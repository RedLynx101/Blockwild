import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVENTURE_DUNGEON_ARCHETYPES,
  ADVENTURE_POI_ARCHETYPES,
  adventureDungeonCandidateForChunk,
  adventureMarkersForChunk,
  adventurePlacementsForChunk,
  adventurePoiCandidateForChunk,
  planAdventureStructure,
  planDungeonTiles,
  type AdventureDungeonKind,
  type AdventureStructureKind,
} from "../app/game/adventure-content.ts";
import { BLOCKS, RECIPES, BlockId, Item, ITEMS } from "../app/game/data.ts";
import { DOOR_STATES, doorBlocks, doorItem, doorState, isDoorBlock } from "../app/game/doors.ts";
import { VoxelEngine, lanternPiehouseKeeperOrigin, mapLocationNameFromTag, migrateLanternPiehouseSaveState, planHostileAirbornePursuit, resolveStructureLootItem, structureMobSpawnY, type SavedCreature } from "../app/game/engine.ts";
import { createBirdBehavior } from "../app/game/fauna.ts";
import { createAvatarHeldItemModel } from "../app/game/held-items.ts";
import { createMerchant } from "../app/game/economy.ts";
import {
  LEGENDARY_ITEMS,
  isInfiniteDurabilityItem,
  legendaryCombatMultiplier,
  legendaryMiningMultiplier,
} from "../app/game/legendary-items.ts";
import { createMobVisual } from "../app/game/mob-models.ts";
import { ADVENTURE_MOB_ORDER, MOB_DEFS } from "../app/game/mobs.ts";
import { mythicSiteByStructureKind } from "../app/game/mythic-frontiers.ts";
import { structureLootTable } from "../app/game/structures.ts";
import { BiomeId, ChunkWorld } from "../app/game/world.ts";
import { createMobInspectionSpecs, inspectGrounding } from "../scripts/render-models.ts";

const ORIGIN = { x: 8, y: 48, z: 8 } as const;

test("Mythic Frontiers exposes thirty-eight varied POIs and eleven dungeons", () => {
  assert.equal(ADVENTURE_POI_ARCHETYPES.length, 38);
  assert.equal(new Set(ADVENTURE_POI_ARCHETYPES.map((entry) => entry.kind)).size, 38);
  assert.deepEqual(
    Object.fromEntries(["tiny", "medium", "large"].map((scale) => [scale, ADVENTURE_POI_ARCHETYPES.filter((entry) => entry.scale === scale).length])),
    { tiny: 8, medium: 14, large: 16 },
  );
  assert.equal(ADVENTURE_DUNGEON_ARCHETYPES.length, 11);
  assert.equal(new Set(ADVENTURE_DUNGEON_ARCHETYPES.map((entry) => entry.kind)).size, 11);
  assert.equal(ADVENTURE_DUNGEON_ARCHETYPES.filter((entry) => entry.underground).length, 7);
  assert.equal(ADVENTURE_DUNGEON_ARCHETYPES.filter((entry) => !entry.underground).length, 4);
  assert.equal(new Set(ADVENTURE_DUNGEON_ARCHETYPES.map((entry) => entry.materialIdentity)).size, 11);
  assert.equal(new Set(ADVENTURE_DUNGEON_ARCHETYPES.map((entry) => entry.lightingIdentity)).size, 11);
});

test("all thirty-eight landmark plans are deterministic, bounded and map-discoverable", () => {
  for (const archetype of ADVENTURE_POI_ARCHETYPES) {
    const first = planAdventureStructure(archetype.kind, ORIGIN, "trailbound-adventure");
    const second = planAdventureStructure(archetype.kind, ORIGIN, "trailbound-adventure");
    assert.deepEqual(first, second, `${archetype.kind} must be deterministic`);
    assert.ok(first.placements.length >= 8, `${archetype.kind} needs authored geometry`);
    assert.ok(first.placements.length < 9_000, `${archetype.kind} must remain bounded`);
    const mythicSite = mythicSiteByStructureKind(archetype.kind);
    assert.equal(first.rooms.length, mythicSite?.minimumRooms ?? 0);
    assert.ok(first.markers.some((marker) => marker.type === "landmark" && marker.tag === `adventure-poi:${archetype.kind}`));
    assert.ok(first.bounds.min.x <= first.origin.x && first.bounds.max.x >= first.origin.x);
  }
});

test("six faction wayposts expose one aligned merchant-guide plus local quest identity", () => {
  const expected = new Map([
    ["lantern-piehouse", "hobbits"],
    ["switchback-tollcamp", "goblins"],
    ["tideglass-embassy", "atlantians"],
    ["sugarwind-teahouse", "sugarcourt"],
    ["moonpost-listening-tree", "wood-elves"],
    ["skyshaft-depot", "dwarves"],
  ]);
  for (const [kind, faction] of expected) {
    const plan = planAdventureStructure(kind as AdventureStructureKind, ORIGIN, "waypost-contract");
    const residents = plan.markers.filter((marker) => marker.type === "spawn" && marker.tags?.includes("outpost-guide"));
    assert.equal(residents.length, 1, `${kind} needs one stable guide`);
    const resident = residents[0];
    assert.equal(resident.type, "spawn");
    if (resident.type !== "spawn") throw new Error(`${kind} guide marker must be a spawn marker`);
    assert.ok(resident.tags?.includes("outpost-merchant"));
    assert.ok(resident.tags?.includes(`faction:${faction}`));
    assert.ok(resident.tags?.some((tag) => tag.startsWith("resident:waypost-")));
    assert.ok(resident.tags?.some((tag) => tag.startsWith("profession:")));
    assert.ok(resident.tags?.some((tag) => tag.startsWith("name:")));
    assert.ok(plan.markers.some((marker) => marker.type === "chest" && marker.loot.length > 0));
  }
});

test("Palimpsest Vault descending treads preserve transition headroom", () => {
  const plan = planAdventureStructure("palimpsest-vault", ORIGIN, "palimpsest-clearance");
  const blocks = new Map(plan.placements.map((placement) => [`${placement.x},${placement.y},${placement.z}`, placement.block]));
  const treads = plan.placements.filter((placement) => placement.variant?.startsWith("palimpsest-vault-stair-step-"));
  assert.equal(treads.length, 18);
  for (const tread of treads) {
    for (let clearance = 1; clearance <= 3; clearance += 1) {
      assert.equal(
        blocks.get(`${tread.x},${tread.y + clearance},${tread.z}`),
        BlockId.Air,
        `stair ${tread.variant} needs ${clearance} blocks of descending clearance`,
      );
    }
  }
});

test("Lantern Piehouse keeper is grounded indoors and reliably stocks its signature pie", () => {
  const plan = planAdventureStructure("lantern-piehouse", ORIGIN, "piehouse-contract");
  const keeper = plan.markers.find((marker) => marker.type === "spawn" && marker.id === "lantern-piehouse-keeper");
  assert.ok(keeper && keeper.type === "spawn");
  if (!keeper || keeper.type !== "spawn") return;
  assert.deepEqual(keeper.position, { x: ORIGIN.x, y: ORIGIN.y + 1, z: ORIGIN.z - 3 });
  assert.equal(keeper.radius, 0);
  assert.ok(keeper.tags?.includes("profession:brewer"));
  assert.ok(keeper.tags?.includes("authored-interior-spawn"));
  const blocks = new Map(plan.placements.map((entry) => [`${entry.x},${entry.y},${entry.z}`, entry.block]));
  const world = { getBlock: (x: number, y: number, z: number) => blocks.get(`${x},${y},${z}`) ?? BlockId.Air, findWalkableY: () => { throw new Error("interior anchor must not scan to roof"); } };
  assert.equal(structureMobSpawnY(world as never, "hobbit-merchant", keeper.position.x, keeper.position.z, keeper.position.y, keeper.tags), ORIGIN.y + MOB_DEFS["hobbit-merchant"].footOffset);
  const merchant = createMerchant("host", "waypost-lantern-piehouse", "hobbits", "brewer");
  assert.ok(merchant.inventory.some((stack) => stack.itemKey === "hearthberry-apple-pie" && stack.count >= 1));
  assert.deepEqual(RECIPES.find((entry) => entry.id === "hearthberry-apple-pie")?.pattern, [Item.Flour, Item.Flour, Item.Flour, Item.Apple, Item.Berry, Item.HoneyJar]);
  assert.equal(ITEMS[Item.HearthberryApplePie].food, 8);
  assert.ok(createAvatarHeldItemModel(Item.HearthberryApplePie)?.getObjectByName("hearthberry-pie-crust"));
});

test("legacy Lantern Piehouse saves narrowly re-anchor Merry and repair brewer stock", () => {
  const residentId = "waypost-lantern-piehouse--24-40-keeper";
  const settlementId = "waypost-lantern-piehouse--24-40";
  const merry = {
    id: 42,
    kind: "hobbit-merchant",
    name: "Merry Bramblebun",
    x: -22.8,
    y: 71.5,
    z: 41.1,
    yaw: 0,
    health: 16,
    age: 12,
    persistentPoiResident: true,
    poiMarkerId: "adventure:lantern-piehouse:-24,40:spawn:lantern-piehouse-keeper",
    factionId: "hobbits",
    profession: "hobbit-merchant",
    settlementId,
    residentId,
    aligned: true,
  } satisfies SavedCreature;
  assert.deepEqual(lanternPiehouseKeeperOrigin(merry), { x: -24, z: 40 });

  const stale = { ...createMerchant("host", residentId, "hobbits", "general", 317), profession: "hobbit-merchant" as never };
  const unrelated = createMerchant("host", "waypost-switchback-tollcamp-0-0-keeper", "goblins", "general", 211);
  const migrated = migrateLanternPiehouseSaveState([merry], { [residentId]: stale, [unrelated.id]: unrelated }, "host");
  assert.deepEqual({ x: migrated.creatures[0].x, z: migrated.creatures[0].z, profession: migrated.creatures[0].profession }, { x: -24, z: 37, profession: "brewer" });
  const brewer = migrated.merchants.get(residentId);
  assert.equal(brewer?.profession, "brewer");
  assert.equal(brewer?.gold, stale.gold, "migration should preserve player-shaped merchant value state");
  assert.ok(brewer?.inventory.some((stack) => stack.itemKey === "hearthberry-apple-pie" && stack.count >= 1));
  assert.equal(migrated.merchants.get(unrelated.id), unrelated, "other merchants must remain byte-for-byte untouched");

  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  const requestedChunks: Array<readonly [number, number]> = [];
  let restoredPosition: { x: number; y: number; z: number } | null = null;
  let restoredProfession: string | null | undefined;
  engine.world = {
    requestChunk: (cx: number, cz: number) => {
      requestedChunks.push([cx, cz]);
      return { cx, cz };
    },
    installedColumn: () => ({ height: 48 }),
    getBlock: (x: number, y: number, z: number) => x === -24 && y === 48 && z === 37 ? BlockId.Moss : BlockId.Air,
    findWalkableY: () => { throw new Error("migrated Merry must use the authored interior anchor"); },
  } as never;
  engine.spawnMob = ((_kind: string, position: { x: number; y: number; z: number }, options: { profession?: string | null }) => {
    restoredPosition = { x: position.x, y: position.y, z: position.z };
    restoredProfession = options.profession;
    return {};
  }) as never;
  engine.restoreCreature(merry);
  assert.deepEqual(requestedChunks, [[-2, 2]], "a far-away saved Piehouse should request only its resident anchor chunk for exact grounding");
  assert.deepEqual(restoredPosition, { x: -24, y: 48 + MOB_DEFS["hobbit-merchant"].footOffset, z: 37 });
  assert.equal(restoredProfession, "brewer");

  const lookalike = { ...merry, id: 43, poiMarkerId: "adventure:lantern-piehouse:-24,40:spawn:travelling-hobbit" };
  const untouched = migrateLanternPiehouseSaveState([lookalike], {}, "host");
  assert.equal(untouched.creatures[0], lookalike, "a similar Hearthkin without the exact authored marker must not migrate");
});

test("v1.3.5 materials are distinct craftable blocks and the Palimpsest loot resolves", () => {
  const materials = [
    [BlockId.WayfarerCanvas, Item.WayfarerCanvasItem],
    [BlockId.Whisperglass, Item.WhisperglassItem],
    [BlockId.StorybookBrick, Item.StorybookBrickItem],
  ] as const;
  assert.equal(new Set(materials.map(([block]) => BLOCKS[block].side)).size, 3);
  for (const [block, item] of materials) {
    assert.equal(ITEMS[item].placeBlock, block);
    assert.equal(ITEMS[item].worldTextureBlock, block);
  }
  const palimpsest = structureLootTable("palimpsest-vault");
  for (const entry of [...palimpsest.entries, ...palimpsest.bonuses]) assert.notEqual(resolveStructureLootItem(entry.itemKey), null);
  const plan = planAdventureStructure("palimpsest-vault", ORIGIN, "living-archive");
  assert.ok(plan.placements.some((placement) => placement.block === BlockId.StorybookBrick));
  assert.ok(plan.placements.some((placement) => placement.block === BlockId.Whisperglass));
  assert.ok(plan.markers.some((marker) => marker.type === "spawn" && marker.mobKind === "inkmaw-curator" && marker.tags?.includes("boss")));
});

test("every dungeon has authored progression, multiple encounters, loot and a map heart", () => {
  for (const archetype of ADVENTURE_DUNGEON_ARCHETYPES) {
    const plan = planAdventureStructure(archetype.kind, ORIGIN, "dungeon-audit");
    const spawns = plan.markers.filter((marker) => marker.type === "spawn");
    const chests = plan.markers.filter((marker) => marker.type === "chest");
    assert.ok(plan.placements.length >= 220, `${archetype.kind} needs substantial multi-room geometry`);
    assert.ok(plan.placements.length < 18_000, `${archetype.kind} must remain bounded`);
    const mythicSite = mythicSiteByStructureKind(archetype.kind);
    const expectedRooms = mythicSite?.minimumRooms ?? 3;
    assert.equal(plan.rooms.length, expectedRooms);
    assert.deepEqual(plan.rooms.map((room) => room.stage), Array.from({ length: expectedRooms }, (_, index) => index + 1));
    assert.equal(new Set(plan.rooms.map((room) => room.id)).size, expectedRooms);
    assert.ok(plan.rooms.every((room) => room.objective.length >= 35));
    assert.ok(spawns.length >= 4, `${archetype.kind} should contain multiple encounter markers`);
    assert.ok(spawns.some((marker) => marker.tags?.includes("boss")));
    assert.ok(chests.length >= 2, `${archetype.kind} should contain progression and vault loot`);
    assert.ok(chests.every((marker) => marker.loot.length > 0));
    assert.ok(plan.markers.some((marker) => marker.type === "landmark" && marker.tag === `dungeon:${archetype.kind}`));
  }
});

test("both surface dungeons have complete authored room perimeters and deliberate openings", () => {
  const bloomrot = planAdventureStructure("bloomrot-cathedral", ORIGIN, "surface-wall-audit");
  const bloomrotBlocks = new Map(bloomrot.placements.map((placement) => [`${placement.x - ORIGIN.x},${placement.y - ORIGIN.y},${placement.z - ORIGIN.z}`, placement.block]));
  for (const y of [2, 4, 7]) {
    for (let z = -5; z <= 5; z += 1) {
      const expected = Math.abs(z) === 5 ? BlockId.WildwoodLog : BlockId.Moss;
      assert.equal(bloomrotBlocks.get(`-14,${y},${z}`), expected, `west transept end missing at ${y},${z}`);
      assert.equal(bloomrotBlocks.get(`14,${y},${z}`), expected, `east transept end missing at ${y},${z}`);
    }
    for (const z of [-5, 5]) for (const [minX, maxX] of [[-14, -8], [8, 14]] as const) for (let x = minX; x <= maxX; x += 1) {
      const expected = (Math.abs(x) === 14) ? BlockId.WildwoodLog : BlockId.Moss;
      assert.equal(bloomrotBlocks.get(`${x},${y},${z}`), expected, `transept side missing at ${x},${y},${z}`);
    }
    for (const x of [-7, 7]) for (const [minZ, maxZ] of [[-14, -6], [6, 14]] as const) for (let z = minZ; z <= maxZ; z += 1) {
      const expected = Math.abs(z) === 14 ? BlockId.WildwoodLog : BlockId.Moss;
      assert.equal(bloomrotBlocks.get(`${x},${y},${z}`), expected, `nave side missing at ${x},${y},${z}`);
    }
  }
  for (const x of [-7, -6, -5, 5, 6, 7]) assert.equal(bloomrotBlocks.get(`${x},3,14`), Math.abs(x) === 7 ? BlockId.WildwoodLog : BlockId.Moss);
  for (let x = -2; x <= 2; x += 1) assert.equal(bloomrotBlocks.get(`${x},3,14`), BlockId.Air, "the public entry must stay open");
  assert.equal(bloomrotBlocks.get(`-7,3,0`), BlockId.Air, "the west garden must open into the nave");
  assert.equal(bloomrotBlocks.get(`7,3,0`), BlockId.Air, "the east garden must open into the nave");

  const stormglass = planAdventureStructure("stormglass-citadel", ORIGIN, "surface-wall-audit");
  const stormglassBlocks = new Map(stormglass.placements.map((placement) => [`${placement.x - ORIGIN.x},${placement.y - ORIGIN.y},${placement.z - ORIGIN.z}`, placement.block]));
  for (let edge = -13; edge <= 13; edge += 1) {
    assert.equal(stormglassBlocks.get(`${edge},3,-13`), BlockId.SnowcapStone);
    if (Math.abs(edge) > 2) assert.equal(stormglassBlocks.get(`${edge},3,13`), BlockId.SnowcapStone);
    assert.equal(stormglassBlocks.get(`-13,3,${edge}`), BlockId.SnowcapStone);
    assert.equal(stormglassBlocks.get(`13,3,${edge}`), BlockId.SnowcapStone);
  }
  for (let x = -2; x <= 2; x += 1) assert.equal(stormglassBlocks.get(`${x},3,13`), BlockId.Air, "the gate court opening is intentional");
});

test("the four modular underground dungeons use connected seeded tile graphs with variable footprints", () => {
  const modularKinds = new Set<AdventureStructureKind>(["rootbound-labyrinth", "starless-observatory", "brassdeep-foundry", "palimpsest-vault"]);
  for (const archetype of ADVENTURE_DUNGEON_ARCHETYPES.filter((entry) => modularKinds.has(entry.kind))) {
    const kind = archetype.kind as AdventureDungeonKind;
    const first = planDungeonTiles(kind, "tile-seed-a");
    assert.deepEqual(planDungeonTiles(kind, "tile-seed-a"), first);
    assert.ok(first.length >= 7 && first.length <= 11);
    const occupied = new Set(first.map((tile) => `${tile.gridX},${tile.gridZ}`));
    const queue = ["0,2"];
    const reached = new Set<string>();
    while (queue.length) {
      const key = queue.shift()!;
      if (reached.has(key) || !occupied.has(key)) continue;
      reached.add(key);
      const [x, z] = key.split(",").map(Number);
      queue.push(`${x+1},${z}`, `${x-1},${z}`, `${x},${z+1}`, `${x},${z-1}`);
    }
    assert.equal(reached.size, first.length);
    const counts = new Set(["tile-seed-a", "tile-seed-b", "tile-seed-c", "tile-seed-d"].map((seed) => planDungeonTiles(kind, seed).length));
    assert.ok(counts.size > 1, `${archetype.kind} varies its module count across seeds`);
    const plan = planAdventureStructure(archetype.kind, ORIGIN, "tile-seed-a");
    assert.ok(plan.placements.some((placement) => placement.variant?.includes("dungeon-tile")));
    assert.ok(plan.bounds.min.x >= ORIGIN.x - 24 && plan.bounds.max.x <= ORIGIN.x + 23);
    assert.ok(plan.bounds.min.z >= ORIGIN.z - 24 && plan.bounds.max.z <= ORIGIN.z + 23);
  }
});

test("wrought-iron dungeon doors are a complete craftable family with paired authored leaves", () => {
  const wrought = [...DOOR_STATES.entries()].filter(([, state]) => state.family === "wrought-iron");
  assert.equal(wrought.length, 8);
  assert.equal(new Set(wrought.map(([block]) => block)).size, 8);
  for (const [block, state] of wrought) {
    assert.equal(isDoorBlock(block), true);
    assert.equal(doorItem(block), Item.WroughtIronDoor);
    assert.equal(BLOCKS[block].shape, "door");
    assert.equal(BLOCKS[block].preferredTool, "pickaxe");
    assert.equal(doorState(block), state);
  }
  for (const xAxis of [false, true]) for (const open of [false, true]) {
    const pair = doorBlocks("wrought-iron", open, xAxis);
    assert.equal(doorState(pair.lower)?.upper, false);
    assert.equal(doorState(pair.upper)?.upper, true);
  }
  assert.equal(ITEMS[Item.WroughtIronDoor].placeBlock, BlockId.WroughtIronDoorClosedLower);
  assert.ok(RECIPES.some((recipe) => recipe.id === "wrought-iron-door" && recipe.output.item === Item.WroughtIronDoor));
  for (const archetype of ADVENTURE_DUNGEON_ARCHETYPES.filter((entry) => entry.underground)) {
    const plan = planAdventureStructure(archetype.kind, ORIGIN, "barred-threshold");
    const lowers = plan.placements.filter((placement) => placement.block === BlockId.WroughtIronDoorClosedLower);
    assert.equal(lowers.length, 1);
    for (const lower of lowers) assert.ok(plan.placements.some((upper) => upper.x === lower.x && upper.y === lower.y + 1 && upper.z === lower.z && upper.block === BlockId.WroughtIronDoorClosedUpper));
  }
});

test("all seven underground dungeons provide a reversible one-block spiral stair", () => {
  for (const archetype of ADVENTURE_DUNGEON_ARCHETYPES.filter((entry) => entry.underground)) {
    const plan = planAdventureStructure(archetype.kind, ORIGIN, "stair-audit");
    const steps = plan.placements
      .filter((placement) => placement.variant?.includes("stair-step-"))
      .sort((left, right) => Number(left.variant?.split("stair-step-")[1]) - Number(right.variant?.split("stair-step-")[1]));
    assert.equal(steps.length, 18, `${archetype.kind} should author every tread from surface to threshold`);
    assert.equal(steps[0].y, ORIGIN.y);
    assert.equal(steps.at(-1)?.y, ORIGIN.y - 17);
    for (let index = 1; index < steps.length; index += 1) {
      assert.equal(Math.abs(steps[index].x - steps[index - 1].x) + Math.abs(steps[index].z - steps[index - 1].z), 1, "successive treads must share a horizontal edge");
      assert.equal(steps[index].y, steps[index - 1].y - 1, "successive treads may change height by exactly one block");
    }
    const bottom = steps.at(-1)!;
    const threshold = plan.rooms.find((room) => room.stage === 1)!;
    assert.equal(bottom.y, threshold.bounds.min.y, "bottom tread and threshold floor should align");
    assert.ok(plan.placements.some((placement) => placement.block === BlockId.Air
      && placement.variant?.includes("stair-threshold-door")
      && Math.abs(placement.x - bottom.x) + Math.abs(placement.z - bottom.z) === 1), "bottom tread needs an adjacent exit into the first room");

    // Treat every authored solid with two explicit air cells above it as a
    // walkable voxel. A reversible BFS under one-block step rules must reach
    // the center floor of every stage from the surface tread.
    const blockMap = new Map(plan.placements.map((placement) => [`${placement.x},${placement.y},${placement.z}`, placement.block]));
    const walkable = plan.placements.filter((placement) => BLOCKS[placement.block]?.solid
      && blockMap.get(`${placement.x},${placement.y + 1},${placement.z}`) === BlockId.Air
      && blockMap.get(`${placement.x},${placement.y + 2},${placement.z}`) === BlockId.Air);
    const byColumn = new Map<string, typeof walkable>();
    for (const cell of walkable) {
      const key = `${cell.x},${cell.z}`;
      const column = byColumn.get(key) ?? [];
      column.push(cell);
      byColumn.set(key, column);
    }
    const start = steps[0];
    const queue = [start];
    const visited = new Set([`${start.x},${start.y},${start.z}`]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        for (const neighbor of byColumn.get(`${current.x + dx},${current.z + dz}`) ?? []) {
          if (Math.abs(neighbor.y - current.y) > 1) continue;
          const key = `${neighbor.x},${neighbor.y},${neighbor.z}`;
          if (!visited.has(key)) { visited.add(key); queue.push(neighbor); }
        }
      }
    }
    for (const room of plan.rooms) {
      const centerX = Math.round((room.bounds.min.x + room.bounds.max.x) / 2);
      const centerZ = Math.round((room.bounds.min.z + room.bounds.max.z) / 2);
      const target = `${centerX},${room.bounds.min.y},${centerZ}`;
      if (blockMap.get(`${centerX},${room.bounds.min.y + 1},${centerZ}`) === BlockId.Water) {
        const reachesPond = [...visited].some((key) => {
          const [x, y, z] = key.split(",").map(Number);
          if (x < room.bounds.min.x - 1 || x > room.bounds.max.x + 1 || z < room.bounds.min.z - 1 || z > room.bounds.max.z + 1) return false;
          return ([[1,0],[-1,0],[0,1],[0,-1]] as const).some(([dx, dz]) => blockMap.get(`${x + dx},${y + 1},${z + dz}`) === BlockId.Water);
        });
        assert.ok(reachesPond, `${archetype.kind} stage ${room.stage} pond is not reachable from the dry return path`);
      } else {
        assert.ok(visited.has(target), `${archetype.kind} stage ${room.stage} is not reversibly reachable from the surface`);
      }
    }
  }
});

test("dungeon loot includes usable spell opportunities and resolvable legendary provenance", () => {
  const dungeonTables = ["rootbound-vault", "starless-vault", "brassdeep-vault", "stormglass-vault", "bloomrot-vault", "palimpsest-vault"] as const;
  const allKeys = dungeonTables.flatMap((table) => {
    const definition = structureLootTable(table);
    return [...definition.entries, ...definition.bonuses].map((entry) => entry.itemKey);
  });
  assert.ok(allKeys.some((key) => key.startsWith("tome-")), "the dungeon set should contain spell-tome opportunities");
  for (const key of allKeys) assert.notEqual(resolveStructureLootItem(key), null, `${key} should resolve to a concrete inventory item`);
  for (const legendary of Object.values(LEGENDARY_ITEMS)) {
    assert.equal(ITEMS[legendary.item].rarity, "legendary");
    assert.ok(legendary.provenance.length >= 1);
    assert.ok(legendary.provenance.every((source) => allKeys.includes(legendary.id) && dungeonTables.includes(source.lootTable)));
  }
});

test("adventure plans partition exactly across negative and positive chunk seams", () => {
  const kinds = [...ADVENTURE_POI_ARCHETYPES.map((entry) => entry.kind), ...ADVENTURE_DUNGEON_ARCHETYPES.map((entry) => entry.kind)] as AdventureStructureKind[];
  for (const [index, kind] of kinds.entries()) {
    const origin = { x: index % 2 ? -8 : 8, y: 44, z: index % 3 ? 8 : -8 };
    const plan = planAdventureStructure(kind, origin, "seam-audit");
    const placements = new Set<string>();
    const markers = new Set<string>();
    for (let cx = Math.floor(plan.bounds.min.x / 16); cx <= Math.floor(plan.bounds.max.x / 16); cx += 1) {
      for (let cz = Math.floor(plan.bounds.min.z / 16); cz <= Math.floor(plan.bounds.max.z / 16); cz += 1) {
        for (const block of adventurePlacementsForChunk(plan, cx, cz)) placements.add(`${block.x},${block.y},${block.z}`);
        for (const marker of adventureMarkersForChunk(plan, cx, cz)) markers.add(`${marker.type}:${marker.id}:${marker.position.x},${marker.position.y},${marker.position.z}`);
      }
    }
    assert.equal(placements.size, plan.placements.length, `${kind} lost or duplicated a block across seams`);
    assert.equal(markers.size, plan.markers.length, `${kind} lost or duplicated a marker across seams`);
  }
});

test("regional candidates are repeatable at positive and negative coordinates", () => {
  const poiResults = [];
  for (let cx = -12; cx < 0; cx += 1) for (let cz = 12; cz < 24; cz += 1) {
    const input = { seed: "candidate-stability", chunkX: cx, chunkZ: cz, biome: "forest" as const };
    const first = adventurePoiCandidateForChunk(input);
    assert.equal(first, adventurePoiCandidateForChunk(input));
    if (first) poiResults.push(first);
  }
  assert.equal(poiResults.length, 1, "one POI candidate belongs to a 12x12 region");

  const dungeonResults: AdventureDungeonKind[] = [];
  for (let cx = -36; cx < 0; cx += 1) for (let cz = 0; cz < 36; cz += 1) {
    const input = { seed: "candidate-stability", chunkX: cx, chunkZ: cz, biome: "highlands" as const };
    const result = adventureDungeonCandidateForChunk(input);
    if (result) dungeonResults.push(result);
  }
  assert.equal(dungeonResults.length, 1, "one dungeon candidate belongs to a 36x36 region");
});

test("coastal adventure candidates stamp real geometry, landmarks and encounter loot", () => {
  const world = new ChunkWorld();
  world.reset("coast-audit");
  const found = new Map<string, { chunkX: number; chunkZ: number }>();
  for (let chunkX = -160; chunkX <= 160 && found.size < 2; chunkX += 1) {
    for (let chunkZ = -160; chunkZ <= 160 && found.size < 2; chunkZ += 1) {
      const originX = chunkX * 16 + 8;
      const originZ = chunkZ * 16 + 8;
      const column = world.sampleColumn(originX, originZ);
      if (column.biome !== BiomeId.Beach || column.height < column.waterline) continue;
      const kind = adventurePoiCandidateForChunk({ seed: world.seedText, chunkX, chunkZ, biome: "coast" });
      if (kind === "sunwash-tidepool" || kind === "saltwind-lighthouse") found.set(kind, { chunkX, chunkZ });
    }
  }
  assert.deepEqual([...found.keys()].sort(), ["saltwind-lighthouse", "sunwash-tidepool"]);
  for (const [kind, candidate] of found) {
    const originX = candidate.chunkX * 16 + 8;
    const originZ = candidate.chunkZ * 16 + 8;
    const surfaceY = world.sampleColumn(originX, originZ).height;
    const plan = planAdventureStructure(kind as AdventureStructureKind, { x: originX, y: surfaceY, z: originZ }, world.seedText);
    world.generateChunk(candidate.chunkX, candidate.chunkZ);
    const stamped = adventurePlacementsForChunk(plan, candidate.chunkX, candidate.chunkZ).find((placement) => placement.block !== BlockId.Air);
    assert.ok(stamped && world.getBlock(stamped.x, stamped.y, stamped.z) === stamped.block, `${kind} geometry should reach the live chunk`);
    const liveMarkers = [...world.structureMarkers.entries()].filter(([key]) => key.startsWith(plan.id));
    assert.ok(liveMarkers.some(([, marker]) => marker.type === "landmark" && marker.tag === `adventure-poi:${kind}`));
    if (kind === "saltwind-lighthouse") {
      assert.ok(liveMarkers.some(([, marker]) => marker.type === "chest" && marker.loot.length > 0));
      assert.ok(liveMarkers.some(([, marker]) => marker.type === "spawn" && marker.mobKind === "vaultwing"));
    }
  }
  world.dispose();
});

test("Saltwind Lighthouse keeper furniture rests directly on its authored floor", () => {
  const origin = { x: 80, y: 42, z: -32 };
  const plan = planAdventureStructure("saltwind-lighthouse", origin, "saltwind-furniture-audit");
  const byPosition = new Map(plan.placements.map((placement) => [`${placement.x},${placement.y},${placement.z}`, placement]));
  const furniture = plan.placements.filter((placement) =>
    placement.variant === "keeper-table"
      || placement.variant === "keeper-chair"
      || placement.variant === "adventure-cache-chest",
  );

  assert.deepEqual(
    furniture.map(({ x, y, z, block, variant }) => ({ x, y, z, block, variant })),
    [
      { x: origin.x - 4, y: origin.y + 1, z: origin.z + 1, block: BlockId.HearthChair, variant: "keeper-chair" },
      { x: origin.x - 3, y: origin.y + 1, z: origin.z + 1, block: BlockId.WildwoodTable, variant: "keeper-table" },
      { x: origin.x + 3, y: origin.y + 1, z: origin.z + 2, block: BlockId.Chest, variant: "adventure-cache-chest" },
    ],
  );
  for (const placement of furniture) {
    const support = byPosition.get(`${placement.x},${placement.y - 1},${placement.z}`);
    assert.equal(support?.block, BlockId.TempleSandstone, `${placement.variant} must have a floor immediately below it`);
    assert.equal(support?.variant, "lighthouse-floor");
  }
  const chestMarker = plan.markers.find((marker) => marker.type === "chest" && marker.id === "keeper-sea-chest");
  assert.deepEqual(chestMarker?.position, { x: origin.x + 3, y: origin.y + 1, z: origin.z + 2 });
});

test("dungeon spawn grounding stays inside authored rooms and flying markers retain height", () => {
  let surfaceQueries = 0;
  const markerY = -16;
  const world = {
    getBlock: (_x: number, y: number) => y === markerY - 1 || y === markerY + 5 ? BlockId.Stone : BlockId.Air,
    findWalkableY: () => { surfaceQueries += 1; return markerY + 5; },
  };
  assert.equal(
    structureMobSpawnY(world as never, "rootwrithe", 0, 0, markerY, ["dungeon", "stage-1"]),
    markerY - 1 + MOB_DEFS.rootwrithe.footOffset,
  );
  assert.equal(structureMobSpawnY(world as never, "vaultwing", 0, 0, markerY, ["dungeon", "stage-2"]), markerY);
  assert.equal(surfaceQueries, 0, "authored dungeon spawns must never scan upward onto a roof");
  assert.equal(structureMobSpawnY(world as never, "fire-dragon", 0, 0, markerY, ["dragon-lair:fire"]), markerY + 5 + MOB_DEFS["fire-dragon"].footOffset);
  assert.equal(surfaceQueries, 1, "legacy dragon guardians should retain their established ground scan");
});

test("Vaultwings initialize in airborne route mode and map tags retain specific names", () => {
  assert.equal(MOB_DEFS.vaultwing.movement, "flying");
  assert.equal(createBirdBehavior("vaultwing").mode, "flight");
  assert.equal(mapLocationNameFromTag("adventure-poi:saltwind-lighthouse"), "Saltwind Lighthouse");
  assert.equal(mapLocationNameFromTag("dungeon:rootbound-labyrinth"), "Rootbound Labyrinth");
  assert.notEqual(mapLocationNameFromTag("dungeon:rootbound-labyrinth"), "Dungeon");

  const closing = planHostileAirbornePursuit({ hostile: MOB_DEFS.vaultwing.hostile, aware: true, distance: 8, chaseSpeed: MOB_DEFS.vaultwing.chaseSpeed, reach: MOB_DEFS.vaultwing.attackRange, cooldownSeconds: 0, dt: 0.1 });
  assert.ok(closing.advance > 0 && closing.nextDistance < 8 && !closing.attacks, "an aware Vaultwing should close a distant three-dimensional gap");
  const striking = planHostileAirbornePursuit({ hostile: MOB_DEFS.vaultwing.hostile, aware: true, distance: MOB_DEFS.vaultwing.attackRange, chaseSpeed: MOB_DEFS.vaultwing.chaseSpeed, reach: MOB_DEFS.vaultwing.attackRange, cooldownSeconds: 0, dt: 0.1 });
  assert.equal(striking.attacks, true, "a Vaultwing inside reach should damage after its cooldown");
  const emberjay = planHostileAirbornePursuit({ hostile: MOB_DEFS.emberjay.hostile, aware: true, distance: 2, chaseSpeed: MOB_DEFS.emberjay.chaseSpeed, reach: MOB_DEFS.emberjay.attackRange, cooldownSeconds: 0, dt: 0.1 });
  assert.deepEqual(emberjay, { advance: 0, nextDistance: 2, attacks: false }, "ordinary Emberjays must retain nonhostile bird behavior");
});

test("nine authored encounter creatures have rich metadata and production rigs", () => {
  assert.equal(ADVENTURE_MOB_ORDER.length, 9);
  assert.equal(new Set(ADVENTURE_MOB_ORDER).size, 9);
  const inspection = new Map(createMobInspectionSpecs().map((spec) => [spec.id, spec]));
  for (const kind of ADVENTURE_MOB_ORDER) {
    const definition = MOB_DEFS[kind];
    assert.ok(definition.behavior.length > 90, `${kind} needs meaningful AI notes`);
    assert.ok(definition.lore.length > 80, `${kind} needs authored lore`);
    assert.ok(definition.discoveryHint && definition.utility);
    assert.ok(definition.drops.length >= 2);
    const model = createMobVisual(kind, 731);
    let meshes = 0;
    model.group.traverse((object) => { if (object instanceof Object && object.type === "Mesh") meshes += 1; });
    assert.ok(meshes >= 14, `${kind} should be a detailed production model`);
    const spec = inspection.get(kind);
    assert.ok(spec && spec.boxes.length >= 14);
    if (!definition.flying && !definition.aquatic) {
      const grounding = inspectGrounding(spec);
      assert.ok(Math.abs(grounding.groundDelta) < 0.001, `${kind} ground delta ${grounding.groundDelta} is visible at runtime`);
    }
  }
});

test("adventure creature limb pivots attach outward and preserve animation axes", () => {
  const scarab = createMobVisual("auric-scarab", 732);
  assert.equal(scarab.parts.legs.length, 6, "the scarab needs three articulated legs per side");
  for (const leg of scarab.parts.legs) {
    const side = Number(leg.userData.side);
    assert.ok(side === -1 || side === 1);
    assert.ok(leg.rotation.z * side < 0, "a local-X scarab leg must angle down as it extends outward");
    const restZ = leg.rotation.z;
    leg.rotation.x = Math.sin(1.1 + Number(leg.userData.phase ?? 0)) * 0.34;
    assert.equal(leg.rotation.z, restZ, "the runtime gait axis must not erase the authored hip angle");
    assert.ok(leg.children.some((child) => child.name.endsWith("-knee")), "each upper leg should own its lower joint");
  }

  for (const [kind, expectedArms] of [["rootwrithe", 2], ["bellroot-matron", 3]] as const) {
    const model = createMobVisual(kind, 733);
    const legSwingAmplitude = kind === "rootwrithe" ? 0.18 : 0.12;
    assert.equal(model.parts.legs.length, 4, `${kind} should retain four attached roots`);
    assert.equal(model.parts.arms.length, expectedArms, `${kind} arm count should match its authored silhouette`);
    for (const root of model.parts.legs) {
      const side = Number(root.userData.side);
      assert.ok(root.rotation.z * side > 0, `${kind} roots should splay outward instead of crossing inward`);
      const restZ = root.rotation.z;
      root.rotation.x = Math.sin(1.1 + Number(root.userData.phase ?? 0)) * legSwingAmplitude;
      assert.equal(root.rotation.z, restZ);
    }
    for (const arm of model.parts.arms.filter((part) => Number(part.userData.side) !== 0)) {
      const side = Number(arm.userData.side);
      assert.ok(arm.rotation.z * side > 0, `${kind} side arms should descend outward from their shoulders`);
      const restZ = arm.rotation.z;
      arm.rotation.x = Math.sin(1.1 + Number(arm.userData.phase ?? 0)) * 0.5 - 1.1;
      assert.equal(arm.rotation.z, restZ, "the attack sweep must retain the shoulder attachment angle");
      assert.ok(arm.children.some((child) => child.name.endsWith("-elbow")), "hands and forearms should be parented through an elbow");
    }
  }
});

test("legendary heirlooms have stable ids, real models and concrete mechanics", () => {
  assert.deepEqual([Item.DawnthreadSaber, Item.DeepdelversPromise, Item.BriarheartCrook], [434, 435, 436]);
  assert.equal(isInfiniteDurabilityItem(Item.DawnthreadSaber), true);
  assert.equal(isInfiniteDurabilityItem(Item.DeepdelversPromise), true);
  assert.equal(isInfiniteDurabilityItem(Item.BriarheartCrook), false);
  assert.equal(legendaryCombatMultiplier(Item.DawnthreadSaber, { hostile: true, family: "undead" }), 1.35);
  assert.equal(legendaryCombatMultiplier(Item.BriarheartCrook, { hostile: true, family: "surface" }), 1.2);
  assert.equal(legendaryMiningMultiplier(Item.DeepdelversPromise, BlockId.Deepstone), 1.5);
  assert.equal(legendaryMiningMultiplier(Item.DeepdelversPromise, BlockId.Dirt), 1);
  for (const item of [Item.DawnthreadSaber, Item.DeepdelversPromise, Item.BriarheartCrook]) {
    const model = createAvatarHeldItemModel(item);
    assert.ok(model, `${ITEMS[item].name} needs a held model`);
    let meshes = 0;
    model.traverse((object) => { if (object.type === "Mesh") meshes += 1; });
    assert.ok(meshes >= 5, `${ITEMS[item].name} needs a crafted silhouette rather than one block`);
  }
});
