import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Item } from "../app/game/data";
import { auditLootFamilies, LOOT_FAMILIES, resolveContextualLoot } from "../app/game/contextual-loot";
import {
  GUILDS,
  GUILD_NPCS,
  GUILD_QUESTS,
  applyGuildSemanticEvent,
  compatibleGuildIdsForSettlement,
  completeGuildQuest,
  createGuildBook,
  inviteToGuild,
  joinGuild,
  planGuildHalls,
  questProgress,
  startGuildQuest,
} from "../app/game/guilds";
import { auditLegendaryEncounterDefinitions } from "../app/game/legendary-encounters";
import { SUMMON_CONTRACTS } from "../app/game/summon-contracts";
import { auditRoadPlan, planRegionalRoadGraph, planTerrainFollowingRoad } from "../app/game/surface-roads";
import { ChunkWorld } from "../app/game/world";
import { dwarfHoldAudit } from "./audit-world-overhaul";

const OUTPUT_PATH = path.resolve("output/living-bestiary-showcase/audits/living-bestiary-release-audit.json");

function auditLoot(simulations = 10_000) {
  const familyIds = Object.keys(LOOT_FAMILIES) as Array<keyof typeof LOOT_FAMILIES>;
  const familyCounts = Object.fromEntries(familyIds.map((id) => [id, 0])) as Record<string, number>;
  let empty = 0;
  let criticalMisses = 0;
  let deterministicMismatches = 0;
  let privateContainers = 0;
  for (let index = 0; index < simulations; index += 1) {
    const family = LOOT_FAMILIES[familyIds[index % familyIds.length]];
    const roles = Object.keys(family.purpose);
    const criticalItems = index % 137 === 0 ? [Item.Worldpin] : [];
    const context = {
      generatorVersion: 2, containerId: `release-audit-${index}`, archetype: "chest" as const,
      structureKind: family.id, roomRole: roles[index % roles.length], biomeId: index % 24,
      depthBand: (["surface", "shallow", "deep", "abyssal"] as const)[index % 4], dangerTier: index % 10,
      lockTier: index % 5, progressionTags: [] as string[], seed: Math.imul(index + 1, 7919), criticalItems,
    };
    const first = resolveContextualLoot(context);
    const second = resolveContextualLoot(context);
    familyCounts[first.familyId] += 1;
    if (!first.slots.some(Boolean)) empty += 1;
    if (criticalItems.length && !first.slots.some((slot) => slot?.item === criticalItems[0])) criticalMisses += 1;
    if (JSON.stringify(first) !== JSON.stringify(second)) deterministicMismatches += 1;
    if (first.theft) privateContainers += 1;
  }
  const familyErrors = auditLootFamilies();
  return { simulations, empty, criticalMisses, deterministicMismatches, privateContainers, familyCounts, familyErrors, pass: empty === 0 && criticalMisses === 0 && deterministicMismatches === 0 && familyErrors.length === 0 };
}

function auditGuilds() {
  const candidates = Array.from({ length: 10 }, () => [
    ["wood-elves", "surface"], ["hobbits", "surface"], ["atlantians", "underwater"],
    ["dwarves", "underground"], ["goblins", "surface"], ["sugarcourt", "surface"],
  ] as const).flatMap((entries, region) => entries.map(([factionId, environment], index) => ({
    settlementId: `region-${region}-${factionId}`, factionId, size: index % 3 === 0 ? "town" as const : "village" as const,
    regionId: `region-${region}`, civicParcelId: `parcel-${region}-${index}`,
    compatibleGuildIds: compatibleGuildIdsForSettlement(factionId, environment),
  })));
  const halls = planGuildHalls("release-halls", candidates);
  const counts = Object.fromEntries(Object.keys(GUILDS).map((id) => [id, halls.filter((hall) => hall.guildId === id).length]));
  const occupiedOnce = new Set(halls.map((hall) => hall.settlementId)).size === halls.length;
  const deterministic = JSON.stringify(halls) === JSON.stringify(planGuildHalls("release-halls", [...candidates].reverse()));
  const campaignComplete = Object.values(GUILDS).every((guild) => guild.ranks.length === 6 && guild.questIds.length === 8 && guild.principalNpcIds.length === 3);
  const campaignFailures: string[] = [];
  for (const guildId of Object.keys(GUILDS) as Array<keyof typeof GUILDS>) {
    const inviter = GUILD_NPCS.find((npc) => npc.guildId === guildId);
    if (!inviter) { campaignFailures.push(`${guildId}: no inviter`); continue; }
    let book = joinGuild(inviteToGuild(createGuildBook(), guildId, inviter.id), guildId);
    for (const quest of GUILD_QUESTS.filter((entry) => entry.guildId === guildId)) {
      book = startGuildQuest(book, quest.id);
      if (!book.guilds[guildId].activeQuestIds.includes(quest.id)) { campaignFailures.push(`${quest.id}: unreachable start`); break; }
      for (const objective of quest.objectives) for (let proof = 0; proof < objective.target; proof += 1) {
        book = applyGuildSemanticEvent(book, {
          kind: objective.kind,
          guildId,
          questId: quest.id,
          objectiveId: objective.id,
          targetId: objective.predicate.targetIds[0],
          demonstrationId: `${quest.id}:${objective.id}:${proof}`,
          context: {
            creatureKind: objective.predicate.creatureKinds[0],
            locationId: objective.predicate.locationIds[0],
            itemId: objective.predicate.itemIds[0],
            encounterId: objective.predicate.encounterIds[0],
            actorId: objective.predicate.actorIds[0],
          },
        });
      }
      if (!questProgress(book, quest.id)?.complete) { campaignFailures.push(`${quest.id}: objectives cannot complete`); break; }
      book = completeGuildQuest(book, quest.id, quest.solutionFamilies[0]);
      if (!book.guilds[guildId].completedQuestIds.includes(quest.id)) { campaignFailures.push(`${quest.id}: outcome cannot resolve`); break; }
    }
  }
  const campaignReachable = campaignFailures.length === 0;
  return { guilds: Object.keys(GUILDS).length, quests: GUILD_QUESTS.length, principalNpcs: GUILD_NPCS.length, recruits: GUILD_NPCS.filter((npc) => npc.recruitable).length, halls: halls.length, counts, occupiedOnce, deterministic, campaignComplete, campaignReachable, campaignFailures, pass: campaignComplete && campaignReachable && occupiedOnce && deterministic && Object.values(counts).every((count) => count > 0) };
}

function auditRoads(seedCount = 50) {
  const failures: Array<{ seed: number; errors: readonly string[] }> = [];
  let bridges = 0;
  let causeways = 0;
  let ferries = 0;
  for (let seed = 0; seed < seedCount; seed += 1) {
    const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `s${seed}-n${index}`, x: (index % 4) * 170 + (seed * 19 + index * 31) % 67, z: Math.floor(index / 4) * 190 + (seed * 23 + index * 17) % 59 }));
    const graph = planRegionalRoadGraph(nodes);
    const degree = new Map(nodes.map((node) => [node.id, 0]));
    for (const edge of graph) { degree.set(edge.from.id, (degree.get(edge.from.id) ?? 0) + 1); degree.set(edge.to.id, (degree.get(edge.to.id) ?? 0) + 1); }
    const route = planTerrainFollowingRoad(nodes[0], nodes.at(-1)!, (x, z) => {
      const water = ((x + seed * 29) % 310 + 310) % 310 > 214 && ((x + seed * 29) % 310 + 310) % 310 < 264;
      return { height: Math.round(Math.sin((x + seed) / 47) * 6 + Math.cos((z - seed) / 63) * 5 + z / 120), waterline: 8, water, slopeRisk: Math.abs(Math.sin((x + z + seed) / 29)) };
    });
    bridges += route.filter((point) => point.kind === "bridge").length;
    causeways += route.filter((point) => point.kind === "causeway").length;
    ferries += route.filter((point) => point.kind === "ferry").length;
    const errors = [...auditRoadPlan(route), ...([...degree.values()].some((value) => value > 3) ? ["regional degree above three"] : []), ...(graph.length < nodes.length - 1 ? ["regional graph disconnected"] : [])];
    if (errors.length) failures.push({ seed, errors });
  }
  return { seedCount, failures, bridges, causeways, ferries, pass: failures.length === 0 && bridges + causeways + ferries > 0 };
}

function auditDwarvenHolds(seedCount = 50) {
  const results = [];
  for (let index = 0; index < seedCount; index += 1) {
    const seed = `DEEPGEAR-RELEASE-${index.toString().padStart(2, "0")}`;
    // Historical authored-content oracle: this does not attest production
    // worldgen authority and intentionally exercises the legacy TS generator.
    const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
    world.reset(seed, undefined, { profile: "world-below-v15" });
    results.push({ seed, ...dwarfHoldAudit(world) });
  }
  const verified = results.filter((entry) => entry.verifiedHoldId);
  const infrastructureFailures = verified.filter((entry) => !entry.pairedLift || !entry.shaftClear || !entry.gatehouseComplete || !entry.mineRoadConnected || !entry.discoveryMarker);
  return { seedCount, verified: verified.length, mountainCompatible: results.reduce((sum, entry) => sum + entry.mountainCompatible, 0), infrastructureFailures, results, pass: verified.length > 0 && infrastructureFailures.length === 0 };
}

export async function buildLivingBestiaryReleaseAudit(options: Readonly<{ dwarvenSeeds?: number }> = {}) {
  const startedAt = performance.now();
  const loot = auditLoot();
  const guilds = auditGuilds();
  const roads = auditRoads(50);
  const dwarven = auditDwarvenHolds(options.dwarvenSeeds ?? 50);
  const legendaries = auditLegendaryEncounterDefinitions();
  const summons = { count: Object.keys(SUMMON_CONTRACTS).length, realms: Object.values(SUMMON_CONTRACTS).map((entry) => entry.realm), pass: Object.keys(SUMMON_CONTRACTS).length === 4 && new Set(Object.values(SUMMON_CONTRACTS).map((entry) => entry.realm)).size === 4 };
  const pass = loot.pass && guilds.pass && roads.pass && dwarven.pass && legendaries.ok && summons.pass;
  return { schema: 1, generatedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - startedAt), pass, loot, guilds, roads, dwarven, legendaries, summons };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const countArgument = process.argv.find((argument) => argument.startsWith("--dwarven-seeds="));
  const dwarvenSeeds = countArgument ? Math.max(1, Math.min(50, Number(countArgument.split("=")[1]) || 50)) : 50;
  const report = await buildLivingBestiaryReleaseAudit({ dwarvenSeeds });
  if (process.argv.includes("--write")) {
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify({ output: process.argv.includes("--write") ? OUTPUT_PATH : null, pass: report.pass, durationMs: report.durationMs, loot: report.loot, guilds: report.guilds, roads: report.roads, dwarven: { seedCount: report.dwarven.seedCount, verified: report.dwarven.verified, infrastructureFailures: report.dwarven.infrastructureFailures.length, pass: report.dwarven.pass }, legendaries: report.legendaries, summons: report.summons }, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
}
