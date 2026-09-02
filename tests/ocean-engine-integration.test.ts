import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  VoxelEngine,
  aquaticSpawnHeight,
  normalizeLeviathanCargoStorage,
  restoreChestStorage,
  structureMobSpawnY,
  worldTicksForDelta,
} from "../app/game/engine.ts";
import { AQUATIC_FLORA, BlockId, Item, ITEMS, itemForBlock } from "../app/game/data.ts";
import type { CreatureMetadata } from "../app/game/creature-cage.ts";
import { MOB_DEFS } from "../app/game/mobs.ts";
import { validatePayload } from "../app/game/multiplayer.ts";
import { createAetherbellMorphState, createLeviathanEgg, stepLeviathanEgg } from "../app/game/fauna.ts";
import { createGoldWallet, createMerchant } from "../app/game/economy.ts";
import { createFactionRelations } from "../app/game/factions.ts";
import { commerceItemCode, inventoryResourceCounts, resourceItemCode } from "../app/game/hearthroads-adapter.ts";
import { acceptQuest, applyQuestEvent, createQuestBook } from "../app/game/quests.ts";
import {
  ATLANTIAN_SIDE_QUESTS,
  GOBLIN_SIDE_QUESTS,
  HOBBIT_SIDE_QUESTS,
  createSettlementState,
  type SettlementCandidate,
} from "../app/game/settlements.ts";

function silenceEngineSideEffects(engine: VoxelEngine) {
  engine.events = { onToast: () => undefined } as never;
  engine.audio = { play: () => undefined } as never;
  (engine as unknown as { saveSoon: () => void }).saveSoon = () => undefined;
  (engine as unknown as { emitHud: (force?: boolean) => void }).emitHud = () => undefined;
}

test("ocean lifecycle time follows the configured world-day duration", () => {
  assert.equal(worldTicksForDelta(1, 20), 20);
  assert.equal(worldTicksForDelta(1, 10), 40);
  assert.equal(worldTicksForDelta(30, 1), 12_000);
  assert.equal(worldTicksForDelta(Number.NaN, 20), 0);
});

test("six-chest Worldshell cargo survives storage restoration and exact-state normalization", () => {
  const cargo = Array.from({ length: 162 }, (_, index) => index === 161
    ? { item: Item.WorldshellEgg, count: 1, metadata: { eggId: "last-slot" } }
    : null);
  const restored = restoreChestStorage({ "leviathan:77:cargo": cargo });
  assert.equal(restored.get("leviathan:77:cargo")?.length, 162);
  assert.deepEqual(restored.get("leviathan:77:cargo")?.[161], cargo[161]);

  const normalized = normalizeLeviathanCargoStorage(cargo, 6);
  assert.equal(normalized.length, 162);
  assert.deepEqual(normalized[161], cargo[161]);
  assert.notEqual(normalized[161], cargo[161], "capture payloads must not alias live cargo slots");
});

test("saved Aetherbell lifecycle, morph, and follower orders survive the live restore boundary", () => {
  const egg = createLeviathanEgg("aetherbell-leviathan", { incubationTicks: 1, eggId: "restore-bell" });
  const growth = stepLeviathanEgg(egg, { elapsedTicks: 1, underwater: true }).hatchling!;
  const morph = createAetherbellMorphState("air");
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  const requestedChunks: Array<readonly [number, number]> = [];
  const captured: { position: THREE.Vector3 | null; options: Record<string, unknown> | null } = { position: null, options: null };
  engine.world = {
    requestChunk: (cx: number, cz: number) => {
      requestedChunks.push([cx, cz]);
      return { cx, cz };
    },
  } as never;
  (engine as unknown as { spawnMob: (kind: string, position: THREE.Vector3, options: Record<string, unknown>) => unknown }).spawnMob = (_kind, position, options) => {
    captured.position = position.clone();
    captured.options = options;
    return {};
  };

  assert.ok(engine.restoreCreature({
    id: 77,
    kind: "aetherbell-larva",
    x: 4,
    y: -18,
    z: 9,
    yaw: 0.4,
    health: 8,
    age: 12,
    leviathanGrowth: growth,
    aetherbellMorph: morph,
    followDistance: 8,
    followCommand: "hold",
  }));
  assert.deepEqual(requestedChunks, [[0, 0]], "restore should acquire the creature's resident chunk before spawning it");
  assert.equal(captured.position?.y, -18, "aquatic saves must not be regrounded during restore");
  assert.deepEqual(captured.options?.leviathanGrowth, growth);
  assert.deepEqual(captured.options?.aetherbellMorph, morph);
  assert.equal(captured.options?.followDistance, 8);
  assert.equal(captured.options?.followCommand, "hold");
});

test("large aquatic creature spawn origins respect the sea floor and reject shallow water", () => {
  assert.equal(aquaticSpawnHeight("aetherbell-leviathan", 10, 15, 0.5), null);
  const bellY = aquaticSpawnHeight("aetherbell-leviathan", 4, 24, 0.5)!;
  assert.ok(bellY >= 9.4 && bellY <= 23.4);
  assert.equal(aquaticSpawnHeight("worldshell-leviathan", 10, 12, 0.5), null);
  assert.equal(aquaticSpawnHeight("worldshell-leviathan", 10, 20, 0.5), 19.2);
  assert.equal(aquaticSpawnHeight("tideglass-crab", 10, 20, 0.5), 10.65, "Tideglass Crabs should remain on the seafloor");
});

test("Capture Orbs release aquatic creatures into water instead of grounding them", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.world = {
    getBlock: (_x: number, y: number) => y === 0 ? BlockId.Stone : y >= 1 && y <= 10 ? BlockId.Water : BlockId.Air,
    surfaceAt: () => 0,
    findWalkableY: () => 0,
  } as never;
  const metadata: CreatureMetadata = {
    schema: 1,
    entityId: "tidepup-water-release",
    kind: "tidepup",
    health: 6,
    maxHealth: 6,
    ageTicks: 100,
    baby: false,
    temperament: "Gentle",
    hostile: false,
    tamed: true,
    ownerId: "keeper",
    name: "Foam",
    geneticSeed: 8,
    command: null,
    custom: {},
  };
  const released = engine.creatureReleasePosition(metadata, new THREE.Vector3(0, 1, 0));
  assert.ok(released);
  assert.equal(MOB_DEFS.tidepup.aquatic, true);
  assert.equal(engine.world.getBlock(Math.round(released!.x), Math.round(released!.y), Math.round(released!.z)), BlockId.Water);
});

test("tiny leviathans render at their authored eight-percent hatchling scale", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  const visual = new THREE.Group();
  const egg = createLeviathanEgg("worldshell-leviathan", { incubationTicks: 1 });
  const growth = stepLeviathanEgg(egg, { elapsedTicks: 1, underwater: true }).hatchling!;
  engine.applyMobScale({
    kind: "worldshell-leviathan",
    visual,
    visualBaseY: 0,
    visualMinY: 0,
    shadeSaddle: null,
    shadeState: null,
    reedstriderBond: null,
    courserBond: null,
    leviathanGrowth: growth,
    definition: MOB_DEFS["worldshell-leviathan"],
  } as never, growth.growthScale);
  assert.equal(visual.scale.x, 0.08);
});

test("multiplayer accepts bounded egg metadata and rejects oversized drop payloads", () => {
  const base = {
    tick: 1,
    scope: { centerPlayerId: "player-ocean-test", radius: 64, epoch: 1 },
    drops: [{ id: 1, item: Item.WorldshellEgg, count: 1, x: 0, y: 8, z: 0, age: 1 }],
  };
  assert.equal(validatePayload("drop-snapshot", {
    ...base,
    drops: [{ ...base.drops[0], metadata: { kind: "placed-leviathan-egg", egg: { eggId: "worldshell-1", submergedTicks: 15.5 } } }],
  }), true);
  assert.equal(validatePayload("drop-snapshot", {
    ...base,
    drops: [{ ...base.drops[0], metadata: { payload: "x".repeat(8_300) } }],
  }), false);
});

test("every Atlantian market good resolves to a real inventory item and resource bridge", () => {
  const expected = {
    "glow-kelp": BlockId.GlowKelp,
    shellfruit: Item.Shellfruit,
    reefglass: Item.Reefglass,
    "living-coral": Item.LivingCoral,
    "lumen-pearl": Item.LumenPearl,
    "prismatic-pearl": Item.PrismaticPearl,
    "tideglass-trident": Item.TideglassTrident,
    "glowmender-salve": Item.GlowmenderSalve,
  } as const;
  const inventory = Object.values(expected).map((item, index) => ({ item, count: index + 1 }));
  const resources = inventoryResourceCounts(inventory);
  for (const [key, item] of Object.entries(expected)) {
    assert.equal(resourceItemCode(key), item);
    assert.equal(commerceItemCode(key), item);
    assert.ok(ITEMS[item], `${key} must have a production item definition`);
    assert.ok((resources[key] ?? 0) > 0, `${key} must be countable for quest collection and delivery`);
  }
});

test("the live merchant bridge can buy Atlantian stock into the player's pack", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.inventory = Array.from({ length: 36 }, () => null);
  engine.questBook = createQuestBook();
  engine.sideQuestDefinitions = [];
  engine.goldWallet = createGoldWallet("host-ocean", "local", 1_000);
  engine.activeMerchantId = "pearlbroker";
  engine.merchants = new Map([["pearlbroker", createMerchant("host-ocean", "pearlbroker", "atlantians", "atlantian-pearlbroker", 500)]]);
  silenceEngineSideEffects(engine);

  assert.equal(engine.tradeWithActiveMerchant("buy", "lumen-pearl", 1), true);
  assert.equal(engine.countItem(Item.LumenPearl), 1);
  assert.ok(BigInt(engine.goldWallet.balance) < BigInt(1_000));
});

test("the distinct tempered Goblin spear is real purchasable stock", () => {
  assert.equal(resourceItemCode("tempered-spear"), Item.TemperedRootspike);
  assert.equal(commerceItemCode("tempered-spear"), Item.TemperedRootspike);
  assert.equal(ITEMS[Item.TemperedRootspike].name, "Tempered Rootspike");
  assert.ok((ITEMS[Item.TemperedRootspike].damage ?? 0) > (ITEMS[Item.GoblinsmithSpear].damage ?? 0));

  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.inventory = Array.from({ length: 36 }, () => null);
  engine.questBook = createQuestBook();
  engine.sideQuestDefinitions = [];
  engine.goldWallet = createGoldWallet("host-road", "local", 1_000);
  engine.activeMerchantId = "goblin-smith";
  engine.merchants = new Map([["goblin-smith", createMerchant("host-road", "goblin-smith", "goblins", "blacksmith", 500)]]);
  silenceEngineSideEffects(engine);

  assert.equal(engine.tradeWithActiveMerchant("buy", "tempered-spear", 1), true);
  assert.equal(engine.countItem(Item.TemperedRootspike), 1);
});

test("every authored side-quest collection target and item reward has a live inventory bridge", () => {
  const templates = [...HOBBIT_SIDE_QUESTS, ...GOBLIN_SIDE_QUESTS, ...ATLANTIAN_SIDE_QUESTS];
  for (const template of templates) {
    assert.equal(template.failureConditions.includes("protected-target-dies"), false, `${template.id} still depends on an unauthored protected entity`);
    for (const criterion of template.criteria) {
      assert.notEqual(criterion.kind, "visit", `${template.id} still depends on a custom visit event that the engine never emits`);
      assert.notEqual(criterion.kind, "protect", `${template.id} still depends on a custom protection event that the engine never emits`);
      if (criterion.kind === "collect" || criterion.kind === "deliver") {
        assert.notEqual(resourceItemCode(criterion.target), null, `${template.id} cannot collect or deliver ${criterion.target}`);
      } else if (criterion.kind === "defeat") {
        assert.equal(criterion.target === "overworld-monster" || criterion.target in MOB_DEFS, true, `${template.id} cannot observe kills of ${criterion.target}`);
      }
    }
    for (const reward of template.rewards.items) {
      assert.notEqual(
        resourceItemCode(reward.itemKey) ?? commerceItemCode(reward.itemKey),
        null,
        `${template.id} cannot deliver its ${reward.itemKey} reward`,
      );
    }
  }
  assert.equal(itemForBlock(BlockId.Moss), Item.GlowRoot, "breaking naturally generated cave moss must yield the requested Glowroot resource");
  assert.equal(MOB_DEFS.warg.diet?.includes(Item.WargFeed), true);
  assert.equal(MOB_DEFS.warg.tameItems?.includes(Item.WargFeed), true);
});

test("Rare Seed Pouch rewards unpack atomically into useful cultivars", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.inventory = Array.from({ length: 36 }, (_, index) => index === 0 ? { item: Item.RareSeedPouch, count: 1 } : null);
  engine.selected = 0;
  engine.mode = "survival";
  engine.placeCooldown = 0;
  silenceEngineSideEffects(engine);

  engine.useSelected();
  assert.equal(engine.countItem(Item.RareSeedPouch), 0);
  assert.equal(engine.countItem(Item.MoonriceSeeds), 2);
  assert.equal(engine.countItem(Item.SunrootStarts), 2);
  assert.equal(engine.countItem(Item.SakurabloomSapling), 1);
});

test("the live quest catalog exposes and rewards the authored Atlantian first-contact line", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.inventory = Array.from({ length: 36 }, () => null);
  engine.sideQuestDefinitions = [];
  engine.activeSentient = null;
  engine.mobs = [];
  engine.goldWallet = createGoldWallet("host-ocean", "local", 0);
  engine.factionRelations = createFactionRelations("host-ocean");
  silenceEngineSideEffects(engine);

  const definitions = engine.allQuestDefinitions();
  const firstContact = definitions.find((quest) => quest.id === "atlantian-light-below");
  assert.ok(firstContact);
  let book = acceptQuest(createQuestBook(), definitions, firstContact.id, 1).book;
  book = applyQuestEvent(book, definitions, {
    type: "town-discovered",
    townId: "tidehold-live-test",
    factionId: "atlantians",
    at: 2,
  });
  engine.questBook = book;

  assert.equal(engine.turnInQuestById(firstContact.id), true);
  assert.equal(engine.countItem(Item.GlowmenderSalve), 1);
  assert.equal(engine.goldWallet.balance, "20");
  assert.equal(engine.allQuestDefinitions().some((quest) => quest.id === "atlantian-fair-current"), true);
});

test("Glowmender Salve heals intentionally instead of inheriting Gloamstep's buff", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.inventory = Array.from({ length: 36 }, (_, index) => index === 0 ? { item: Item.GlowmenderSalve, count: 1 } : null);
  engine.selected = 0;
  engine.mode = "survival";
  engine.health = 4;
  engine.placeCooldown = 0;
  engine.potionBuffs = {};
  silenceEngineSideEffects(engine);

  engine.useSelected();
  assert.equal(engine.health, 9);
  assert.deepEqual(engine.inventory[0], { item: Item.GlassBottle, count: 1 });
  assert.deepEqual(engine.potionBuffs, {});
});

test("Tidewardens can hire Trident Guards at the same 180-gold cost as the settlement contract", () => {
  const candidate: SettlementCandidate = {
    schema: 1,
    id: "tidehold-live-hiring",
    worldSeed: "hire-the-tide",
    regionX: 1,
    regionZ: 1,
    center: { x: 64, y: -20, z: 64 },
    size: "town",
    factionId: "atlantians",
    biome: "lumen-trench",
    environment: "underwater",
    floorY: -22,
  };
  const settlement = createSettlementState("host-ocean", candidate);
  const mayor = settlement.residents.find((resident) => resident.profession === "atlantian-tidewarden")!;
  const guard = settlement.residents.find((resident) => resident.profession === "atlantian-trident-guard")!;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.activeSentient = {
    settlementId: settlement.id,
    profession: mayor.profession,
    factionId: "atlantians",
  } as never;
  engine.settlements = new Map([[settlement.id, settlement]]);
  engine.factionRelations = {
    ...createFactionRelations("host-ocean"),
    alignments: { ...createFactionRelations("host-ocean").alignments, atlantians: 80 },
  };
  engine.goldWallet = createGoldWallet("host-ocean", "local", 500);
  engine.mobs = [];
  engine.multiplayer = null;
  silenceEngineSideEffects(engine);

  assert.equal(engine.hireResidentFromMayor(guard.id), true);
  assert.equal(engine.goldWallet.balance, "320");
  assert.equal(engine.settlements.get(settlement.id)?.residents.find((resident) => resident.id === guard.id)?.factionId, "player");
});

test("structure spawn activation preserves authored aquatic marker height", () => {
  let groundQueries = 0;
  const world = {
    getBlock: (_x: number, y: number) => y === -20 ? BlockId.Water : y === -30 ? BlockId.Stone : BlockId.Air,
    findWalkableY: () => { groundQueries += 1; return -30; },
    structureMarkersNear: () => [["tidehold:resident", {
      type: "spawn",
      id: "resident-live",
      position: { x: 2, y: -20, z: 3 },
      mobKind: "atlantian-kelpkeeper",
      count: 1,
      radius: 0,
      persistent: true,
      tags: ["settlement:tidehold-live", "resident:keeper-live", "profession:atlantian-kelpkeeper", "faction:atlantians"],
    }]] as const,
  };
  assert.equal(structureMobSpawnY(world as never, "atlantian-kelpkeeper", 2, 3, -20), -20);
  assert.equal(groundQueries, 0);

  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.structureActivationTimer = 0;
  engine.world = world as never;
  engine.position = new THREE.Vector3(2, -20, 3);
  engine.activatedStructureMarkers = new Set();
  let spawnedY: number | undefined;
  (engine as unknown as { spawnMob: (kind: string, position: THREE.Vector3) => void }).spawnMob = (_kind, position) => { spawnedY = position.y; };
  (engine as unknown as { saveSoon: () => void }).saveSoon = () => undefined;

  engine.updateStructureSpawns(1);
  assert.equal(spawnedY, -20);
  assert.equal(groundQueries, 0);
});

test("the live block-break path clears a trimmed aquatic column and re-arms its surviving top", () => {
  const blocks = new Map<string, BlockId>([
    ["0,-1,0", BlockId.Stone],
    ["0,0,0", BlockId.LumenKelp],
    ["0,1,0", BlockId.LumenKelp],
    ["0,2,0", BlockId.LumenKelp],
    ["0,3,0", BlockId.Water],
  ]);
  const world = {
    getBlock: (x: number, y: number, z: number) => blocks.get(`${x},${y},${z}`) ?? BlockId.Water,
    setBlock: (x: number, y: number, z: number, type: BlockId) => { blocks.set(`${x},${y},${z}`, type); },
    setBlocksBatch: (edits: readonly { x: number; y: number; z: number; type: BlockId }[]) => {
      for (const edit of edits) blocks.set(`${edit.x},${edit.y},${edit.z}`, edit.type);
    },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.world = world as never;
  engine.mode = "builder";
  engine.target = { x: 0, y: 1, z: 0, type: BlockId.LumenKelp } as never;
  engine.saplings = new Map([["0,0,0", 1], ["0,1,0", 1], ["0,2,0", 1]]);
  engine.miningProgress = 1;
  engine.audio = { play: () => undefined } as never;
  engine.events = { onToast: () => undefined } as never;
  const methods = engine as unknown as Record<string, unknown>;
  methods.tryFellTree = () => false;
  methods.toolCanHarvest = () => true;
  methods.breakUnsupportedAround = () => undefined;
  methods.notifyLiquidChanged = () => undefined;
  methods.publishBlockEdits = () => undefined;
  methods.spawnParticles = () => undefined;
  methods.saveSoon = () => undefined;
  methods.emitHud = () => undefined;

  engine.breakTarget();
  assert.equal(blocks.get("0,0,0"), BlockId.LumenKelp);
  assert.equal(blocks.get("0,1,0"), BlockId.Water);
  assert.equal(blocks.get("0,2,0"), BlockId.Water);
  assert.equal(engine.saplings.has("0,1,0"), false);
  assert.equal(engine.saplings.has("0,2,0"), false);
  assert.equal(engine.saplings.has("0,0,0"), true);
  assert.ok((engine.saplings.get("0,0,0") ?? 0) > Date.now());
});

test("the browser ocean-flora audit uses natural patches with open seabed and continuous columns", () => {
  const blocks = new Map<string, BlockId>();
  const world = {
    setRenderDistance: () => undefined,
    setBlocksBatch: (edits: readonly { x: number; y: number; z: number; type: BlockId }[]) => {
      for (const edit of edits) blocks.set(`${edit.x},${edit.y},${edit.z}`, edit.type);
    },
    setBlock: (x: number, y: number, z: number, type: BlockId) => { blocks.set(`${x},${y},${z}`, type); },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.world = world as never;
  engine.position = new THREE.Vector3(0, 10.51, 0);
  engine.spawn = new THREE.Vector3();
  (engine as unknown as { clearEntities: () => void }).clearEntities = () => undefined;
  (engine as unknown as { emitHud: (force?: boolean) => void }).emitHud = () => undefined;

  engine.primeOceanFloraAudit();
  const columns = new Map<string, number[]>();
  const visibleSpecies = new Set<BlockId>();
  for (const [key, block] of blocks) if (AQUATIC_FLORA.includes(block)) {
    const [x, y, z] = key.split(",").map(Number);
    const column = `${x},${z}:${block}`;
    columns.set(column, [...(columns.get(column) ?? []), y]);
    visibleSpecies.add(block);
  }
  assert.ok(visibleSpecies.has(BlockId.Brinegrass), "the natural ocean audit retains its dominant short meadow");
  assert.ok(visibleSpecies.has(BlockId.Sailkelp), "the natural ocean audit retains its dominant canopy");
  assert.ok(visibleSpecies.size >= 3, "the reviewed window should still include a restrained accent species");
  assert.ok(columns.size >= 80 && columns.size <= 180, "the reviewed window balances planted beds with open seabed");
  for (const heights of columns.values()) {
    heights.sort((a, b) => a - b);
    for (let index = 1; index < heights.length; index += 1) assert.equal(heights[index], heights[index - 1] + 1, "tall audit flora must have no vertical gap");
  }
  assert.ok([...columns.values()].some((heights) => heights.length >= 4), "the natural audit must expose a tall connected canopy");
});
