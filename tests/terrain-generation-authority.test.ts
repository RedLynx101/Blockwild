import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { createApiary } from "../app/game/apiary.ts";
import { BlockId } from "../app/game/data.ts";
import {
  DEFAULT_TERRAIN_GENERATION_AUTHORITY_MODE_V2,
  configuredTerrainGenerationAuthorityV2,
  resolveTerrainGenerationAuthorityV2,
} from "../app/game/terrain-generation-authority.ts";
import { VoxelEngine } from "../app/game/engine.ts";
import { ChunkWorld } from "../app/game/world.ts";

test("worldgen authority defaults to Rust without browser globals or ambient fallback", () => {
  assert.equal(DEFAULT_TERRAIN_GENERATION_AUTHORITY_MODE_V2, "rust");
  assert.deepEqual(resolveTerrainGenerationAuthorityV2(), {
    mode: "rust",
    source: "default-rust",
    rollbackRequiresWorldReload: true,
  });
  assert.deepEqual(resolveTerrainGenerationAuthorityV2({ buildProfile: "rust-primary" }), {
    mode: "rust",
    source: "build-rust-primary",
    rollbackRequiresWorldReload: true,
  });
  assert.equal(resolveTerrainGenerationAuthorityV2({
    buildProfile: "rust-primary",
    search: "?domain.worldgen=typescript",
  } as Parameters<typeof resolveTerrainGenerationAuthorityV2>[0]).mode, "rust");
});

test("only the exact compile-time build profile selects the reload-only rollback", () => {
  assert.deepEqual(resolveTerrainGenerationAuthorityV2({ buildProfile: "typescript-rollback" }), {
    mode: "typescript",
    source: "build-typescript-rollback",
    rollbackRequiresWorldReload: true,
  });
  assert.throws(
    () => resolveTerrainGenerationAuthorityV2({ buildProfile: "typescript" as "rust-primary" }),
    /Invalid compiled worldgen build profile/,
  );

  const authoritySource = readFileSync(new URL("../app/game/terrain-generation-authority.ts", import.meta.url), "utf8");
  assert.doesNotMatch(authoritySource, /domain\.worldgen/u);
  assert.doesNotMatch(authoritySource, /NEXT_PUBLIC_BLOCKWILD_WORLDGEN_TYPESCRIPT_ROLLBACK/u);
});

test("node tests require an explicit test selection and each ChunkWorld snapshots its mode", () => {
  const productionSelection = resolveTerrainGenerationAuthorityV2({ nodeTestMode: false });
  const testSelection = resolveTerrainGenerationAuthorityV2({ nodeTestMode: true });
  assert.equal(productionSelection.mode, "rust");
  assert.equal(testSelection.mode, "typescript");
  assert.equal(configuredTerrainGenerationAuthorityV2().source, "test");

  const rust = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  const typescript = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  assert.equal(rust.terrainGenerationAuthority.mode, "rust");
  assert.equal(typescript.terrainGenerationAuthority.mode, "typescript");
  assert.equal(rust.terrainGenerationPipeline.diagnostics().rollbackRequiresWorldReload, true);
  assert.throws(() => rust.generateChunk(0, 0), /forbidden/);
  assert.equal(rust.chunks.size, 0, "failed synchronous access must not mutate Rust-authoritative world state");
  assert.ok(typescript.generateChunk(0, 0));
  rust.dispose();
  typescript.dispose();
});

test("Rust startup queues the initial 3x3 and terminal authority loss blocks readiness without TypeScript work", () => {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.setRenderDistance(2);
  world.reset("RUST-REQUIRED-STARTUP", undefined, { structures: false });
  world.initializeAround(0, 0);
  const diagnostics = world.streamingDiagnostics();
  assert.equal(world.chunks.size, 0);
  assert.equal(diagnostics.generationWorker.mode, "rust");
  assert.equal(diagnostics.generationWorker.state, "authority-unavailable");
  assert.equal(diagnostics.playerChunkReady, false);
  assert.equal(diagnostics.playerChunkDetail, "authority-unavailable");
  for (let cx = -1; cx <= 1; cx += 1) for (let cz = -1; cz <= 1; cz += 1) {
    assert.ok(world.generationQueued.has(`${cx},${cz}`), `startup must queue ${cx},${cz}`);
  }
  assert.throws(() => world.processGeneration(), /unavailable/);
  assert.equal(world.chunks.size, 0);
  world.dispose();
});

test("Rust terrain queries fail closed and opt-in far-field compatibility declares its TypeScript provenance", () => {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  assert.equal(world.installedColumn(0, 0), undefined);
  assert.throws(() => world.sampleColumn(0, 0), /Legacy TypeScript sampleColumn is unavailable/);
  assert.throws(() => world.surfaceAt(0, 0), /not installed/);
  assert.throws(() => world.biomeAt(0, 0), /not installed/);
  world.dispose();

  const worker = readFileSync(new URL("../app/game/basic-world-worker.ts", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../app/game/basic-world-renderer.ts", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  assert.match(worker, /terrainGenerationAuthorityMode: "typescript"/);
  assert.match(renderer, /rust-authority-no-legacy-fallback/);
  assert.ok(renderer.indexOf('mode === "rust"') < renderer.indexOf("this.worker.postMessage"), "Rust rejection must precede TS worker submission");
  assert.match(renderer, /input\.world\.terrainGenerationAuthority\.mode === "rust"/);
  assert.match(engine, /previewWorld\(seed: string\)[\s\S]*terrainGenerationMode\(\) === "rust"[\s\S]*world\.initializeAround\(0, 0\)/);
  assert.match(engine, /new ChunkWorld\(\{ terrainGenerationAuthorityMode: "typescript" \}\)/);
});

test("UI uses engine-snapshotted worldgen authority and cold HUD presentation does not demand absent terrain", () => {
  const ui = readFileSync(new URL("../app/game/VoxelGame.tsx", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /new URLSearchParams\(window\.location\.search\)\.get\("domain\.worldgen"\)/);
  assert.match(ui, /ROLLBACK BUILD/);
  assert.match(ui, /TYPESCRIPT TERRAIN · RELOAD REQUIRED/);
  assert.match(ui, /previewWorldOriginAuthoritative\(seed, worldOptions, originSearchRadius, controller\.signal\)/);
  assert.doesNotMatch(ui, /Required Rust worldgen supports wilderness starts/);
  assert.match(engine, /emitHud\([\s\S]*installedColumn\(Math\.round\(this\.position\.x\), Math\.round\(this\.position\.z\)\)/);
  assert.match(engine, /updateRain\(dt: number\)[\s\S]*installedColumn\(Math\.round\(x\), Math\.round\(z\)\)[\s\S]*if \(!column\) continue/);
  assert.doesNotMatch(engine.match(/updateRain\(dt: number\)[\s\S]*?updateParticles\(dt: number\)/)?.[0] ?? "", /world\.surfaceAt/);
});

test("installed-column reads preserve active and exact cached bytes while edit-halo namespaces fail closed", () => {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  world.reset("CACHE-COLUMN-AUTHORITY", undefined, { structures: false });
  const chunk = world.generateChunk(0, 0);
  const active = world.installedColumn(3, 5);
  assert.deepEqual(active, {
    height: chunk.heightmap[3 + 5 * 16],
    biome: chunk.biomes[3 + 5 * 16],
    waterline: 32,
  });
  world.unloadChunk("0,0");
  assert.deepEqual(world.installedColumn(3, 5), active, "cache peek must retain exact accepted bytes without restoring voxel residency");
  assert.equal(world.getBlock(3, active!.height, 5), undefined, "a cached column is not resident voxel authority");
  world.setBlock(17, 40, 5, 3);
  assert.equal(world.installedColumn(3, 5), undefined, "adjacent edit signature drift must not resurrect a stale cached column");
  world.scheduleAround(0, 0, true, 10);
  world.processGeneration();
  assert.ok(world.chunks.has("0,0"), "the current namespace regenerates instead of taking stale cache ownership");
  world.dispose();
});

test("cold title drizzle omits unknown Rust columns without touching strict surface queries", () => {
  const positions = { array: new Float32Array(0), needsUpdate: false };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  Object.assign(engine, {
    weatherState: { kind: "drizzle", cycle: 0, elapsedSeconds: 50, durationSeconds: 180, intensity: 0.7, windAngle: 0, windSpeed: 1 },
    position: { y: 48 },
    camera: { position: { x: 0, y: 48, z: 0 } },
    rainExposureTimer: 0,
    rainOpenFraction: 1,
    rain: {
      visible: false,
      position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
      material: { opacity: 0, color: { set() {} } },
      geometry: { getAttribute: () => positions },
    },
    world: {
      installedColumn: () => undefined,
      getBlock: () => undefined,
      surfaceAt: () => { throw new Error("cold title must not demand a surface"); },
    },
  });
  assert.doesNotThrow(() => engine.updateRain(0.016));
  assert.equal((engine as unknown as { rainOpenFraction: number }).rainOpenFraction, 0);
});

test("Rust gameplay residency is bounded, requests every intersected chunk, and fails closed", () => {
  const requests: string[] = [];
  let ready = false;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  Object.assign(engine, {
    world: {
      terrainGenerationAuthority: { mode: "rust" },
      requestChunkForResidency(cx: number, cz: number) {
        requests.push(`${cx},${cz}`);
        return ready ? {} : undefined;
      },
      installedColumn: () => ready ? { height: 42, biome: 1, waterline: 32 } : undefined,
      getBlock: () => ready ? 3 : undefined,
    },
  });
  const ensure = (engine as unknown as {
    ensureTerrainResidency(x: number, z: number, radius?: number): boolean;
  }).ensureTerrainResidency.bind(engine);
  assert.equal(ensure(15, 15, 2), false);
  assert.deepEqual(requests, ["0,0", "1,0", "0,1", "1,1"]);
  ready = true;
  requests.length = 0;
  assert.equal(ensure(15, 15, 2), true);
  assert.deepEqual(requests, ["0,0", "1,0", "0,1", "1,1"]);
});

test("remote gameplay systems defer before strict terrain queries and fast travel commits only after residency", () => {
  const engine = readFileSync(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  const butterflies = readFileSync(new URL("../app/game/butterflies.ts", import.meta.url), "utf8");
  const structure = engine.match(/updateStructureSpawns\(dt: number\)[\s\S]*?const tagValue/)?.[0] ?? "";
  const spawn = engine.match(/trySpawnMob\(intent:[\s\S]*?const waterBiome/)?.[0] ?? "";
  const path = engine.match(/private planAgentPath\([\s\S]*?private cancelAgentRuntime/)?.[0] ?? "";
  const observation = engine.match(/let observationColumn[\s\S]*?self: \{/)?.[0] ?? "";
  const travel = engine.match(/private updateFastTravelChannel\(\)[\s\S]*?private syncSettlementPlans/)?.[0] ?? "";
  const guildSites = engine.match(/private ensureActiveGuildQuestSites\(\)[\s\S]*?private clearGuildQuestSite/)?.[0] ?? "";
  const population = engine.match(/const population = growSettlementPopulation[\s\S]*?if \(settlement !== currentSettlement\)/)?.[0] ?? "";
  const naturalGroup = engine.match(/spawnNaturalGroup\([\s\S]*?naturalSpawnMicrohabitatAffinity/)?.[0] ?? "";
  const mobLoop = engine.match(/if \(rangeAction\.action === "linger"\)[\s\S]*?let mobDt = dt/)?.[0] ?? "";
  const roadEvent = engine.match(/private triggerNearbyRoadEvent\(\)[\s\S]*?private updateHearthroadsSimulation/)?.[0] ?? "";
  const guildUpgrade = engine.match(/private applyGuildHallUpgrade\([\s\S]*?private applyLoadedGuildHallUpgrades/)?.[0] ?? "";
  const creatureWork = engine.match(/const due = group\.workers[\s\S]*?const environment = this\.creatureWorkObservation/)?.[0] ?? "";
  const guestSnapshot = engine.match(/private applyNetworkMobSnapshot\([\s\S]*?let mob = this\.mobs\.find/)?.[0] ?? "";
  const guestAnimation = engine.match(/if \(multiplayerGuest\) \{[\s\S]*?this\.animateMob\(mob/)?.[0] ?? "";
  const remoteBlocks = engine.match(/private remoteBlockActionTerrainReady[\s\S]*?private handleAgentVoiceChunk/)?.[0] ?? "";
  const remoteContainers = engine.match(/private remoteContainerCoordinateBlocks[\s\S]*?private syncMultiplayerPlayerState/)?.[0] ?? "";
  const remoteContainerOpen = remoteContainers.match(/if \(action\.kind === "open"\)[\s\S]*?const boat =/)?.[0] ?? "";
  const remoteContainerMutation = remoteContainers.match(/const activeId = this\.multiplayerPeerActiveContainers[\s\S]*?const existing =/)?.[0] ?? "";
  const tombstones = engine.match(/private activeMultiplayerTombstones[\s\S]*?private publishDestructionTombstones/)?.[0] ?? "";
  const rootbridge = engine.match(/private castRootbridge[\s\S]*?private deepLanternSignal/)?.[0] ?? "";
  const rootCleanup = engine.match(/private clearTemporaryMagicState[\s\S]*?private createKinmarkVisual/)?.[0] ?? "";
  const expiredRoots = engine.match(/for \(const \[key, block\] of \[\.\.\.this\.temporarySpellBlocks\]\)[\s\S]*?const remaining/)?.[0] ?? "";
  const saplings = engine.match(/updateSaplings\(dt: number\)[\s\S]*?private nearbyVeinmetalHeart/)?.[0] ?? "";
  const apiaries = engine.match(/updatePersistentMachines\(dt: number\)[\s\S]*?pickTarget\(\)/)?.[0] ?? "";
  const boats = engine.match(/updateBoats\(dt: number\)[\s\S]*?exhibitSpecimen/)?.[0] ?? "";
  const drops = engine.match(/updateDrops\(dt: number\)[\s\S]*?\n  removeDrop\(/)?.[0] ?? "";
  assert.match(structure, /!this\.world\.requestChunkForResidency[\s\S]*continue/);
  assert.ok(structure.indexOf("ensureTerrainResidency") < structure.indexOf("const tagValue"));
  assert.ok(spawn.indexOf("requestChunkForResidency") < spawn.indexOf("const underground"));
  assert.ok(spawn.indexOf("focusColumn.biome") > spawn.indexOf("requestChunkForResidency"));
  assert.match(path, /requestChunkForResidency[\s\S]*return null[\s\S]*return localGoal \?/);
  assert.doesNotMatch(observation, /biomeAt|surfaceAt/);
  assert.ok(travel.indexOf("requestChunkForResidency") < travel.indexOf("commitFastTravel"));
  assert.ok(guildSites.indexOf("ensureTerrainResidency") < guildSites.indexOf("world.surfaceAt"));
  assert.ok(population.indexOf("ensureTerrainResidency") < population.indexOf("findWalkableY"));
  assert.ok(naturalGroup.indexOf("ensureTerrainResidency") < naturalGroup.indexOf("world.surfaceAt"));
  assert.match(mobLoop, /ensureTerrainResidency\(mob\.group\.position\.x, mob\.group\.position\.z, 10\)/);
  assert.ok(roadEvent.indexOf("ensureTerrainResidency") < roadEvent.indexOf("roadEvents.set"));
  assert.ok(guildUpgrade.indexOf("ensureTerrainResidency") < guildUpgrade.indexOf("structureMarkers.set"));
  assert.ok(creatureWork.indexOf("ensureTerrainResidency") < creatureWork.indexOf("creatureWorkObservation"));
  assert.ok(guestSnapshot.indexOf("ensureTerrainResidency") < guestSnapshot.indexOf("this.mobs.find"));
  assert.ok(guestAnimation.indexOf("ensureTerrainResidency") < guestAnimation.indexOf("this.animateMob"));
  assert.doesNotMatch(engine.match(/animateMob\(mob: MobEntity[\s\S]*?mobMovementTargetY/)?.[0] ?? "", /world\.surfaceAt/);
  assert.match(engine.match(/generateChestLoot\(key: string\)[\s\S]*?return slots/)?.[0] ?? "", /ensureTerrainResidency[\s\S]*throw new Error/);
  assert.ok(remoteBlocks.indexOf("remoteBlockActionTerrainReady(action)") < remoteBlocks.indexOf("ensureHostPlayerSession"));
  assert.ok(remoteBlocks.indexOf("remoteBlockActionTerrainReady(action)") < remoteBlocks.indexOf("pendingGuestPlacementRequests.delete"));
  assert.match(remoteBlocks, /deferredRemoteBlockActions[\s\S]*flushDeferredRemoteBlockActions/);
  assert.ok(remoteContainerOpen.indexOf("remoteContainerInReach(action.containerId") < remoteContainerOpen.indexOf("remoteContainerTerrainReady(action.containerId)"));
  assert.ok(remoteContainerOpen.indexOf("remoteContainerTerrainReady(action.containerId)") < remoteContainerOpen.indexOf("exhibitTopologyAt"));
  assert.ok(remoteContainerMutation.indexOf("remoteContainerTerrainReady(action.containerId)") < remoteContainerMutation.indexOf("remoteContainerStillCanonical(action.containerId)"));
  assert.ok(remoteContainerMutation.indexOf("remoteContainerStillCanonical(action.containerId)") < remoteContainerMutation.indexOf("const existing ="));
  assert.match(remoteContainers, /coordinateBacked \? \(coordinateBlock === BlockId\.Chest \? this\.resolveChest\(firstBlock\) : null\)/);
  assert.match(tombstones, /block === undefined \|\| block === BlockId\.Air/);
  assert.ok(rootbridge.indexOf("ensureTerrainResidency") < rootbridge.indexOf("startBlock = this.world.getBlock"));
  assert.ok(rootCleanup.indexOf("ensureTerrainResidency") < rootCleanup.indexOf("temporarySpellBlocks.delete"));
  assert.ok(expiredRoots.indexOf("ensureTerrainResidency") < expiredRoots.indexOf("temporarySpellBlocks.delete"));
  assert.ok(saplings.indexOf("ensureTerrainResidency(x, z, 4)") < saplings.indexOf("const current = this.world.getBlock"));
  assert.ok(apiaries.indexOf("ensureTerrainResidency(x, z, 5)") < apiaries.indexOf("persistentMachineLastStep.set"));
  assert.ok(boats.indexOf("ensureTerrainResidency(boat.save.x, boat.save.z, 3)") < boats.indexOf("integrateSailboat"));
  assert.ok(drops.indexOf("ensureTerrainResidency(drop.mesh.position.x") < drops.indexOf("drop.age += dt"));
  assert.ok(drops.indexOf("ensureTerrainResidency(drop.mesh.position.x") < drops.indexOf("placedDragonEggMetadata"));
  assert.doesNotMatch(butterflies, /world\.(?:surfaceAt|biomeAt)\(/);
});

test("creature load, wake, and restore share one rounded-cell terrain admission rule", () => {
  const engine = readFileSync(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  const cell = engine.match(/function creatureRestoreTerrainCell[\s\S]*?\n\}/)?.[0] ?? "";
  const load = engine.match(/this\.sleepingCreatures = this\.restoreLoadedCreatureRecords\([\s\S]*?\n    \);/)?.[0] ?? "";
  const loadRecords = engine.match(/private restoreLoadedCreatureRecords\([\s\S]*?\n  restoreCreature/)?.[0] ?? "";
  const restore = engine.match(/restoreCreature\(saved: SavedCreature\)[\s\S]*?\n  isMobEnclosed/)?.[0] ?? "";
  const wake = engine.match(/wakeSleepingCreatures\(dt: number\)[\s\S]*?\n  sleepProtectedCreature/)?.[0] ?? "";

  assert.match(cell, /const cellX = Math\.round\(saved\.x\)/);
  assert.match(cell, /const cellZ = Math\.round\(saved\.z\)/);
  assert.match(cell, /chunkX: Math\.floor\(cellX \/ CHUNK_SIZE\)/);
  assert.match(cell, /chunkZ: Math\.floor\(cellZ \/ CHUNK_SIZE\)/);

  assert.match(load, /piehouseSave\.creatures,[\s\S]*?save\.sleepingCreatures \?\? \[\],[\s\S]*?rustRequired/);
  assert.ok(loadRecords.indexOf("creatureRestoreTerrainCell(savedCreature)") < loadRecords.indexOf("this.world.chunks.has(key)"));
  assert.match(loadRecords, /const restored = this\.restoreCreature\(savedCreature\);[\s\S]*?if \(rustRequired && !restored\) deferredCreatures\.push/);

  assert.ok(restore.indexOf("creatureRestoreTerrainCell(migrated)") < restore.indexOf("this.world.requestChunk"));
  assert.match(restore, /getBlock\(cellX, candidateY, cellZ\)/);
  assert.match(restore, /findWalkableY\(cellX, cellZ, migrated\.y\)/);
  assert.match(restore, /surfaceAt\(cellX, cellZ\)/);

  assert.ok(wake.indexOf("creatureRestoreTerrainCell(migrated)") < wake.indexOf("this.world.requestChunk"));
  assert.ok(wake.indexOf("this.restoreCreature") < wake.indexOf("this.sleepingCreatures.splice"));
});

test("remote Rust mob images retain state while target voxels are pending", () => {
  const requests: string[] = [];
  let spawned = 0;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  Object.assign(engine, {
    multiplayerTick: 1,
    position: new THREE.Vector3(),
    mobs: [],
    pendingNetworkMobDeaths: new Set(),
    appliedMultiplayerTombstones: new Map(),
    leadAnchors: new Map(),
    leadLines: new Map(),
    lastNetworkMobSnapshotTick: -1,
    lastNetworkMobSnapshotScope: null,
    world: {
      terrainGenerationAuthority: { mode: "rust" },
      requestChunkForResidency(cx: number, cz: number) {
        requests.push(`${cx},${cz}`);
        return undefined;
      },
      installedColumn: () => undefined,
      getBlock: () => { throw new Error("pending network entry must not inspect voxels"); },
    },
    spawnMob: () => { spawned += 1; throw new Error("pending network entry must not spawn"); },
    removeMob: () => { throw new Error("pending network entry must not replace"); },
  });
  const apply = (engine as unknown as {
    applyNetworkMobSnapshot(entries: unknown[], tick: number): void;
  }).applyNetworkMobSnapshot.bind(engine);
  assert.doesNotThrow(() => apply([{ id: 51, kind: "peelop", x: 100, y: 42, z: -100, yaw: 0, health: 4 }], 1));
  assert.equal(spawned, 0);
  assert.ok(requests.length > 0, "the deferred image must establish a bounded residency lease");
});

test("retained road and spawn markers do not mutate before Rust terrain is resident", () => {
  const road = Object.create(VoxelEngine.prototype) as VoxelEngine;
  const roadEvents = new Map();
  Object.assign(road, {
    multiplayer: null,
    position: new THREE.Vector3(),
    mobs: [],
    roadEvents,
    world: {
      structureMarkers: new Map([["road:pending", {
        type: "landmark", id: "road:pending", tag: "surface-road:pending", position: { x: 3, y: 40, z: 3 },
      }]]),
    },
    ensureTerrainResidency: () => false,
  });
  const trigger = (road as unknown as { triggerNearbyRoadEvent(): boolean }).triggerNearbyRoadEvent.bind(road);
  assert.equal(trigger(), false);
  assert.equal(roadEvents.size, 0, "a pending marker must not consume its one-shot road event");

  const structures = Object.create(VoxelEngine.prototype) as VoxelEngine;
  const activated = new Set<string>();
  let gatedRadius = -1;
  Object.assign(structures, {
    structureActivationTimer: 0,
    activatedStructureMarkers: activated,
    simulationInterestPoints: () => [{ x: 96, y: 40, z: 96 }],
    world: {
      requestChunkForResidency: () => ({}),
      structureMarkersNear: () => [["spawn:pending", {
        type: "spawn", id: "spawn:pending", mobKind: "peelop", count: 1, radius: 5,
        persistent: true, position: { x: 99, y: 40, z: 99 }, tags: [],
      }]],
    },
    ensureTerrainResidency: (_x: number, _z: number, radius: number) => { gatedRadius = radius; return false; },
  });
  assert.doesNotThrow(() => structures.updateStructureSpawns(1));
  assert.equal(gatedRadius, 7);
  assert.equal(activated.size, 0, "pending marker terrain must leave activation state untouched");
});

test("sentient passage closure defers without deleting its pending state", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  let reads = 0;
  Object.assign(engine, {
    ensureTerrainResidency: () => false,
    world: { getBlock: () => { reads += 1; return undefined; } },
  });
  const mob = { age: 10, openedPassage: { kind: "door", x: 80, y: 41, z: 80, closeAfter: 5 } };
  const update = (engine as unknown as { updateSentientPassage(value: typeof mob): void }).updateSentientPassage.bind(engine);
  update(mob);
  assert.equal(reads, 0);
  assert.deepEqual(mob.openedPassage, { kind: "door", x: 80, y: 41, z: 80, closeAfter: 5 });
});

test("host remote block edits preflight before leasing, then retry the intact transaction after residency", () => {
  const responses: Array<{ action: { status?: string; edits: unknown[] }; target?: string }> = [];
  const mutations: unknown[][] = [];
  const peer = { state: "connected", identity: { id: "guest-a", name: "Guest", color: "#fff" } };
  let ready = false;
  let leases = 0;
  let reads = 0;
  const session = {
    role: "host",
    identity: { id: "host" },
    getPeer: () => peer,
    sendBlockAction(action: { status?: string; edits: unknown[] }, target?: string) { responses.push({ action, target }); return 1; },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: session,
    multiplayerTerrainReadinessGeneration: 7,
    deferredRemoteBlockActions: new Map(),
    remotePlayers: new Map([["guest-a", { target: { x: 0, y: 40, z: 0, variant: "male" } }]]),
    multiplayerPlayerStates: new Map(),
    mode: "builder",
    chests: new Map(),
    localNetworkPose: () => null,
    ensureHostPlayerSession: () => ({ playerId: "guest-a", revision: 0, variant: "male", inventory: [null], equipment: {}, selected: 0 }),
    teardownBrokenBlockState: () => undefined,
    applyBlockEditFacings: () => undefined,
    publishDestructionTombstones: () => undefined,
    saveSoon: () => undefined,
    world: {
      terrainGenerationAuthority: { mode: "rust" },
      requestChunkForResidency: () => { leases += 1; return ready ? {} : undefined; },
      getBlock: () => { reads += 1; return ready ? BlockId.Dirt : undefined; },
      blockFacingAt: () => 0,
      setBlocksBatch(changes: unknown[]) { mutations.push(changes); },
    },
  });
  const handle = (engine as unknown as { handleRemoteBlockAction(action: unknown, peer: unknown): void }).handleRemoteBlockAction.bind(engine);
  const flush = (engine as unknown as { flushDeferredRemoteBlockActions(): void }).flushDeferredRemoteBlockActions.bind(engine);
  const action = { requestId: "block-1", actorId: "guest-a", tick: 1, kind: "break", edits: [{ x: 3, y: 41, z: 3, type: BlockId.Air }], status: "request" };
  handle(action, peer);
  assert.equal(mutations.length, 0);
  assert.equal(responses.length, 0);
  assert.equal((engine.deferredRemoteBlockActions as Map<unknown, unknown>).size, 1);
  assert.equal(reads, 0, "cold admission cannot fabricate an Air correction");
  ready = true;
  flush();
  assert.equal(mutations.length, 1);
  assert.equal(responses.at(-1)?.action.status, "accepted");
  assert.equal((engine.deferredRemoteBlockActions as Map<unknown, unknown>).size, 0);

  const leasesBeforeFarEdit = leases;
  handle({ ...action, requestId: "block-far", kind: "place", edits: [{ x: 2_000, y: 41, z: 2_000, type: BlockId.Dirt }] }, peer);
  assert.equal(leases, leasesBeforeFarEdit, "out-of-range edits are rejected before any terrain lease");
  assert.deepEqual(responses.at(-1)?.action.edits, [], "host rejection carries no fabricated cold voxel image");
  assert.equal(responses.at(-1)?.action.status, "rejected");
});

test("oversized guest corrections fail closed before leases or voxel mutation", () => {
  let leases = 0;
  let mutations = 0;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { role: "guest", identity: { id: "guest-a" } },
    deferredRemoteBlockActions: new Map(),
    pendingGuestPlacementRequests: new Map([["oversized", Date.now() + 1_000]]),
    world: {
      terrainGenerationAuthority: { mode: "rust" },
      requestChunkForResidency: () => { leases += 1; return {}; },
      setBlocksBatch: () => { mutations += 1; },
    },
  });
  const handle = (engine as unknown as { handleRemoteBlockAction(action: unknown, peer: unknown): void }).handleRemoteBlockAction.bind(engine);
  handle({
    requestId: "oversized", actorId: "host", tick: 1, kind: "batch", status: "accepted",
    edits: Array.from({ length: 2_049 }, () => ({ x: 0, y: 40, z: 0, type: BlockId.Dirt })),
  }, { state: "connected", identity: { id: "host" } });
  assert.equal(leases, 0);
  assert.equal(mutations, 0);
  assert.equal((engine.deferredRemoteBlockActions as Map<unknown, unknown>).size, 0);
});

test("remote container leases are reach-bounded and a replaced chest invalidates mutation authority", () => {
  const responses: Array<{ status?: string; reason?: string }> = [];
  let leases = 0;
  let semanticMutations = 0;
  const peer = { state: "connected", identity: { id: "guest-a", name: "Guest", color: "#fff" } };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { role: "host", sendContainerAction(action: { status?: string; reason?: string }) { responses.push(action); return 1; } },
    remotePlayers: new Map([["guest-a", { target: { x: 1, y: 41, z: 1 } }]]),
    boats: new Map(),
    mobs: [],
    multiplayerPeerActiveContainers: new Map([["guest-a", "1,41,1"]]),
    multiplayerPeerContainerSignatures: new Map([["guest-a|1,41,1", "old"]]),
    queueCriticalReliableRequest: (_key: string, send: () => number) => send(),
    applySemanticContainerOperation: () => { semanticMutations += 1; throw new Error("stale container must not mutate"); },
    world: {
      terrainGenerationAuthority: { mode: "rust" },
      requestChunkForResidency: () => { leases += 1; return {}; },
      installedColumn: () => ({ height: 41, biome: 1, waterline: 32 }),
      getBlock: () => BlockId.Dirt,
      blockFacingAt: () => 0,
    },
  });
  const handle = (engine as unknown as { handleRemoteContainerAction(action: unknown, peer: unknown): void }).handleRemoteContainerAction.bind(engine);
  handle({ requestId: "far-open", actorId: "guest-a", containerId: "2000,41,2000", kind: "open", status: "request" }, peer);
  assert.equal(leases, 0, "far coordinate IDs are rejected before terrain requests");
  handle({
    requestId: "stale-mutate", actorId: "guest-a", containerId: "1,41,1", kind: "mutate", status: "request",
    expectedRevision: 0, expectedPlayerRevision: 0, operation: { op: "cursor-from-container", index: 0, count: 1 },
  }, peer);
  assert.equal(semanticMutations, 0);
  assert.equal((engine.multiplayerPeerActiveContainers as Map<string, string>).has("guest-a"), false);
  assert.match(responses.at(-1)?.reason ?? "", /changed or moved out of reach/u);
});

test("unknown tombstone and temporary LivingRoot state survive and retry when terrain returns", () => {
  let resident = false;
  let restored = 0;
  const rootKey = "8,40,8";
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayerTick: 100,
    multiplayerTombstones: [{ id: "tomb", tick: 99, kind: "block", cause: "broken", block: { x: 8, y: 40, z: 8 } }],
    temporarySpellBlocks: new Map([[rootKey, { x: 8, y: 40, z: 8, original: BlockId.Dirt, expiresAt: 0 }]]),
    activeSpellFields: [],
    ensureTerrainResidency: () => resident,
    clearTemporaryMagicVisuals: () => undefined,
    world: {
      getBlock: () => resident ? BlockId.LivingRoot : undefined,
      setBlock: () => { restored += 1; return true; },
    },
  });
  const tombstones = (engine as unknown as { activeMultiplayerTombstones(): unknown[] }).activeMultiplayerTombstones.bind(engine);
  const clearRoots = (engine as unknown as { clearTemporaryMagicState(): void }).clearTemporaryMagicState.bind(engine);
  assert.equal(tombstones().length, 1);
  clearRoots();
  assert.equal((engine.temporarySpellBlocks as Map<string, unknown>).has(rootKey), true);
  assert.equal(restored, 0);
  resident = true;
  clearRoots();
  assert.equal((engine.temporarySpellBlocks as Map<string, unknown>).has(rootKey), false);
  assert.equal(restored, 1);
});

test("cold growth and apiary records do not advance until their full terrain halos are resident", () => {
  let resident = false;
  let growthReads = 0;
  const saplingKey = "15,41,15";
  const growth = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(growth, {
    saplingCheckTimer: 0,
    saplings: new Map([[saplingKey, 0]]),
    ensureTerrainResidency: () => resident,
    saveSoon: () => undefined,
    world: { getBlock: () => { growthReads += 1; return BlockId.Air; } },
  });
  growth.updateSaplings(1);
  assert.equal(growthReads, 0);
  assert.equal((growth.saplings as Map<string, number>).has(saplingKey), true);
  resident = true;
  growth.saplingCheckTimer = 0;
  growth.updateSaplings(1);
  assert.ok(growthReads > 0, "the same due record retries once its growth halo is resident");
  assert.equal((growth.saplings as Map<string, number>).has(saplingKey), false);

  resident = false;
  let apiaryReads = 0;
  const apiaryKey = "31,42,31";
  const apiary = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(apiary, {
    apiaries: new Map([[apiaryKey, createApiary("queen", ["worker"], 3, 0)]]),
    morphLooms: new Map(), healingStations: new Map(), alchemyStands: new Map(), distilleries: new Map(),
    sugarworks: new Map(), golemForges: new Map(), wheatMills: new Map(),
    persistentMachineLastStep: new Map(), persistentMachineCursor: 0, persistentMachineTimer: 0,
    digitalCreatureArchive: { schema: 1, cells: [], orbs: [], healClock: 0, healCycles: 0 },
    apiaryFlowerCache: new Map(), mobs: [], worldTime: 0.3, day: 2,
    position: new THREE.Vector3(0, 40, 0), activeApiaryKey: null,
    ensureTerrainResidency: () => resident,
    apiaryFlowersNear: () => [], syncApiaryWorkerMobs: () => undefined,
    saveSoon: () => undefined, emitHud: () => undefined, spawnParticles: () => undefined,
    world: { getBlock: () => { apiaryReads += 1; return BlockId.Apiary; } },
  });
  apiary.updatePersistentMachines(1);
  assert.equal(apiaryReads, 0);
  assert.equal((apiary.persistentMachineLastStep as Map<string, number>).has(apiaryKey), false, "offline time cannot be consumed while attachment is unknown");
  resident = true;
  apiary.persistentMachineTimer = 0;
  apiary.updatePersistentMachines(1);
  assert.ok(apiaryReads > 0);
  assert.equal((apiary.persistentMachineLastStep as Map<string, number>).has(apiaryKey), true);
});

test("boat and drop physics defer atomically and retry after current and candidate halos arrive", () => {
  let resident = false;
  const boatGroup = new THREE.Group();
  const boatSave = { id: "boat-a", x: 20, y: 32, z: 20, yaw: 0, velocity: 1, passengers: ["local"], ownerId: "local", inventory: [] };
  const boat = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(boat, {
    boats: new Map([["boat-a", { save: boatSave, group: boatGroup }]]),
    rustLivePlayerAuthorityEnabledR5: () => false,
    localPlayerId: () => "local",
    multiplayer: null,
    multiplayerBoatInputs: new Map(),
    mountedBoatId: "boat-a",
    keys: new Set(["KeyW"]),
    position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    ensureTerrainResidency: () => resident,
    world: { getBlock: () => BlockId.Water },
  });
  boat.updateBoats(0.1);
  assert.deepEqual([boatSave.x, boatSave.z], [20, 20]);
  assert.deepEqual(boatGroup.position.toArray(), [0, 0, 0]);
  resident = true;
  boat.updateBoats(0.1);
  assert.notDeepEqual([boatSave.x, boatSave.z], [20, 20]);
  assert.notDeepEqual(boatGroup.position.toArray(), [0, 0, 0]);

  resident = false;
  const mesh = new THREE.Group();
  mesh.position.set(20, 50, 20);
  const drop = { id: 1, item: BlockId.Dirt, count: 1, mesh, velocity: new THREE.Vector3(1, 0, 0), age: 0, pickupDelay: 1 };
  const drops = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(drops, {
    drops: [drop],
    position: new THREE.Vector3(),
    worldOptions: { dayLengthMinutes: 20 },
    simulationInterestPoints: () => [{ x: 20, y: 50, z: 20 }],
    ensureTerrainResidency: () => resident,
    world: { getBlock: () => BlockId.Air },
  });
  drops.updateDrops(0.1);
  assert.equal(drop.age, 0);
  assert.deepEqual(mesh.position.toArray(), [20, 50, 20]);
  resident = true;
  drops.updateDrops(0.1);
  assert.equal(drop.age, 0.1);
  assert.ok(mesh.position.x > 20);
});
