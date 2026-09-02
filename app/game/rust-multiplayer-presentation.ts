import type { NetworkDeltaV1 } from "./network-authority-contract";
import {
  validateWorldSnapshot,
  type PeerIdentity,
  type PlayerProgressionSnapshot,
  type WorldSnapshot,
} from "./multiplayer";

export const RUST_MULTIPLAYER_PRESENTATION_SCHEMA_V2 = 2 as const;
export const RUST_MULTIPLAYER_PRESENTATION_KIND_V2 = "blockwild.multiplayer.world-presentation.v2" as const;
export const RUST_MULTIPLAYER_PRESENTATION_RECORD_PREFIX_V2 = "blockwild:presentation:snapshot:v2:" as const;
export const RUST_MULTIPLAYER_PRESENTATION_MAX_BYTES_V2 = 15 * 1024 * 1024;

const PRESENTATION_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

export type RustMultiplayerPlayerProgressionV2 = Readonly<{
  revision: number;
  state: PlayerProgressionSnapshot;
}>;

export type RustMultiplayerProgressionReceiptV2 = Readonly<{
  transferId: string;
  status: "accepted" | "rejected";
  committedRevision: number;
}>;

export type RustMultiplayerWorldPresentationV2 = Readonly<{
  schema: typeof RUST_MULTIPLAYER_PRESENTATION_SCHEMA_V2;
  kind: typeof RUST_MULTIPLAYER_PRESENTATION_KIND_V2;
  sessionId: string;
  hostPeerId: string;
  targetPeerId: string;
  targetPeerKind: "human" | "agent";
  deltaSequence: number;
  snapshot: WorldSnapshot;
  playerProgression: RustMultiplayerPlayerProgressionV2 | null;
  progressionReceipt: RustMultiplayerProgressionReceiptV2 | null;
}>;

export class RustMultiplayerPresentationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RustMultiplayerPresentationError";
  }
}

const REQUIRED_SNAPSHOT_FIELDS = [
  "tick", "seed", "mode", "generatorVersion", "generatorProfile", "players", "blockEdits",
  "mobs", "mobScope", "drops", "dropScope", "tombstones", "boats", "time", "worldOptions",
  "containers", "guildBook",
] as const;

const PRESENTATION_FIELDS = [
  "schema", "kind", "sessionId", "hostPeerId", "targetPeerId", "targetPeerKind", "deltaSequence",
  "snapshot", "playerProgression", "progressionReceipt",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]) {
  const expected = new Set(fields);
  return Object.keys(value).length === fields.length && Object.keys(value).every((key) => expected.has(key));
}

function exactFieldsWithOptional(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function invalidProgression(label: string): never {
  throw new RustMultiplayerPresentationError(`Rust presentation contains invalid exact player progression (${label})`);
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") invalidProgression(label);
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalidProgression(label);
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalidProgression(label);
}

function assertNullableText(value: unknown, label: string): asserts value is string | null {
  if (value !== null && typeof value !== "string") invalidProgression(label);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) invalidProgression(label);
}

function assertFiniteNumberRecord(value: unknown, label: string, nonNegative = false): asserts value is Record<string, number> {
  if (!isRecord(value)) invalidProgression(label);
  for (const entry of Object.values(value)) {
    assertFinite(entry, label);
    if (nonNegative && entry < 0) invalidProgression(label);
  }
}

function assertWorldPoint(value: unknown, label: string) {
  if (!isRecord(value) || !exactFields(value, ["x", "y", "z"])) invalidProgression(label);
  assertFinite(value.x, `${label}.x`);
  assertFinite(value.y, `${label}.y`);
  assertFinite(value.z, `${label}.z`);
}

function assertTurnInRoute(value: unknown, label: string) {
  if (!isRecord(value) || typeof value.kind !== "string") invalidProgression(label);
  if (value.kind === "menu") {
    if (!exactFields(value, ["kind"])) invalidProgression(label);
    return;
  }
  if (value.kind === "individual") {
    if (!exactFields(value, ["kind", "entityId", "role", "factionId"])) invalidProgression(label);
    assertText(value.entityId, `${label}.entityId`);
    assertNullableText(value.role, `${label}.role`);
    assertNullableText(value.factionId, `${label}.factionId`);
    return;
  }
  if (value.kind === "faction-mayor") {
    if (!exactFields(value, ["kind", "factionId"])) invalidProgression(label);
    assertText(value.factionId, `${label}.factionId`);
    return;
  }
  invalidProgression(label);
}

function assertQuestBook(value: unknown) {
  const fields = ["schema", "active", "completed", "failed", "abandoned", "pinnedQuestIds", "pinnedQuestId", "factionAlignment"];
  if (!isRecord(value) || !exactFields(value, fields) || value.schema !== 1 || !Array.isArray(value.active)) {
    invalidProgression("questBook");
  }
  for (const [index, active] of value.active.entries()) {
    const label = `questBook.active[${index}]`;
    if (!isRecord(active) || !exactFields(active, ["questId", "status", "acceptedAt", "giverEntityId", "turnInRoute", "objectiveProgress"])) {
      invalidProgression(label);
    }
    assertText(active.questId, `${label}.questId`);
    if (active.status !== "active" && active.status !== "ready") invalidProgression(`${label}.status`);
    assertFinite(active.acceptedAt, `${label}.acceptedAt`);
    assertNullableText(active.giverEntityId, `${label}.giverEntityId`);
    assertTurnInRoute(active.turnInRoute, `${label}.turnInRoute`);
    assertFiniteNumberRecord(active.objectiveProgress, `${label}.objectiveProgress`, true);
  }
  assertStringArray(value.completed, "questBook.completed");
  if (!Array.isArray(value.failed)) invalidProgression("questBook.failed");
  for (const [index, failed] of value.failed.entries()) {
    const label = `questBook.failed[${index}]`;
    if (!isRecord(failed) || !exactFields(failed, ["questId", "failedAt", "reason"])) invalidProgression(label);
    assertText(failed.questId, `${label}.questId`);
    assertFinite(failed.failedAt, `${label}.failedAt`);
    assertText(failed.reason, `${label}.reason`);
  }
  assertStringArray(value.abandoned, "questBook.abandoned");
  assertStringArray(value.pinnedQuestIds, "questBook.pinnedQuestIds");
  assertNullableText(value.pinnedQuestId, "questBook.pinnedQuestId");
  assertFiniteNumberRecord(value.factionAlignment, "questBook.factionAlignment");
}

function assertQuestObjective(value: unknown, label: string) {
  if (!isRecord(value) || typeof value.kind !== "string") invalidProgression(label);
  const base = ["id", "label", "kind"];
  let required: string[];
  let optional: string[] = [];
  switch (value.kind) {
    case "survive-day": required = [...base, "targetDay"]; break;
    case "discover-town": required = base; optional = ["factionId"]; break;
    case "trade": required = [...base, "count"]; optional = ["factionId"]; break;
    case "kill": required = [...base, "mobKind", "count"]; break;
    case "collect-item":
    case "deliver-item": required = [...base, "itemId", "count"]; break;
    case "interact": required = [...base, "count"]; optional = ["entityId", "role"]; break;
    case "custom": required = [...base, "eventId", "count"]; break;
    default: invalidProgression(`${label}.kind`);
  }
  if (!exactFieldsWithOptional(value, required, optional)) invalidProgression(label);
  assertText(value.id, `${label}.id`);
  assertText(value.label, `${label}.label`);
  for (const key of ["targetDay", "count"] as const) if (Object.hasOwn(value, key)) assertFinite(value[key], `${label}.${key}`);
  for (const key of ["factionId", "entityId", "role"] as const) if (Object.hasOwn(value, key)) assertNullableText(value[key], `${label}.${key}`);
  for (const key of ["mobKind", "itemId", "eventId"] as const) if (Object.hasOwn(value, key)) assertText(value[key], `${label}.${key}`);
}

function assertQuestFailure(value: unknown, label: string) {
  if (!isRecord(value) || typeof value.kind !== "string") invalidProgression(label);
  if (value.kind === "deadline") {
    if (!exactFields(value, ["kind", "afterDay", "reason"])) invalidProgression(label);
    assertFinite(value.afterDay, `${label}.afterDay`);
  } else if (value.kind === "entity-dies") {
    if (!exactFieldsWithOptional(value, ["kind", "reason"], ["entityId", "role"])) invalidProgression(label);
    if (Object.hasOwn(value, "entityId")) assertNullableText(value.entityId, `${label}.entityId`);
    if (Object.hasOwn(value, "role")) assertNullableText(value.role, `${label}.role`);
  } else if (value.kind === "custom") {
    if (!exactFields(value, ["kind", "eventId", "reason"])) invalidProgression(label);
    assertText(value.eventId, `${label}.eventId`);
  } else invalidProgression(`${label}.kind`);
  assertText(value.reason, `${label}.reason`);
}

function assertQuestDefinition(value: unknown, label: string) {
  const required = ["id", "questlineId", "kind", "name", "summary", "objectives", "rewards"];
  const optional = ["prerequisites", "giver", "failureConditions", "abandonable", "reacceptAfterAbandon"];
  if (!isRecord(value) || !exactFieldsWithOptional(value, required, optional) || !Array.isArray(value.objectives)) invalidProgression(label);
  for (const key of ["id", "questlineId", "name", "summary"] as const) assertText(value[key], `${label}.${key}`);
  if (value.kind !== "main" && value.kind !== "side") invalidProgression(`${label}.kind`);
  value.objectives.forEach((objective, index) => assertQuestObjective(objective, `${label}.objectives[${index}]`));
  if (Object.hasOwn(value, "prerequisites")) {
    const prerequisites = value.prerequisites;
    if (!isRecord(prerequisites) || !exactFieldsWithOptional(prerequisites, [], ["allOf", "anyOf"])) invalidProgression(`${label}.prerequisites`);
    if (Object.hasOwn(prerequisites, "allOf")) assertStringArray(prerequisites.allOf, `${label}.prerequisites.allOf`);
    if (Object.hasOwn(prerequisites, "anyOf")) assertStringArray(prerequisites.anyOf, `${label}.prerequisites.anyOf`);
  }
  if (Object.hasOwn(value, "giver") && value.giver !== null) {
    const giver = value.giver;
    if (!isRecord(giver) || !exactFieldsWithOptional(giver, [], ["scope", "entityId", "role", "factionId", "failOnDeath"])) invalidProgression(`${label}.giver`);
    if (Object.hasOwn(giver, "scope") && giver.scope !== "individual" && giver.scope !== "faction-mayor") invalidProgression(`${label}.giver.scope`);
    for (const key of ["entityId", "role", "factionId"] as const) if (Object.hasOwn(giver, key)) assertNullableText(giver[key], `${label}.giver.${key}`);
    if (Object.hasOwn(giver, "failOnDeath") && typeof giver.failOnDeath !== "boolean") invalidProgression(`${label}.giver.failOnDeath`);
  }
  if (Object.hasOwn(value, "failureConditions")) {
    if (!Array.isArray(value.failureConditions)) invalidProgression(`${label}.failureConditions`);
    value.failureConditions.forEach((condition, index) => assertQuestFailure(condition, `${label}.failureConditions[${index}]`));
  }
  if (!isRecord(value.rewards) || !exactFields(value.rewards, ["gold", "items", "blueprints", "factionAlignment"])) invalidProgression(`${label}.rewards`);
  assertFinite(value.rewards.gold, `${label}.rewards.gold`);
  if (!Array.isArray(value.rewards.items)) invalidProgression(`${label}.rewards.items`);
  for (const [index, item] of value.rewards.items.entries()) {
    if (!isRecord(item) || !exactFields(item, ["itemId", "count"])) invalidProgression(`${label}.rewards.items[${index}]`);
    assertText(item.itemId, `${label}.rewards.items[${index}].itemId`);
    assertFinite(item.count, `${label}.rewards.items[${index}].count`);
  }
  assertStringArray(value.rewards.blueprints, `${label}.rewards.blueprints`);
  assertFiniteNumberRecord(value.rewards.factionAlignment, `${label}.rewards.factionAlignment`);
  for (const key of ["abandonable", "reacceptAfterAbandon"] as const) {
    if (Object.hasOwn(value, key) && typeof value[key] !== "boolean") invalidProgression(`${label}.${key}`);
  }
}

function assertMapKnowledge(value: unknown, targetPeerId: string) {
  const fields = ["schema", "worldId", "playerId", "revision", "exploredChunks", "terrainByChunk", "surfaceByChunk", "undergroundByChunk", "markers", "activeBedId", "fastTravelCharges"];
  if (!isRecord(value) || !exactFields(value, fields) || value.schema !== 1) invalidProgression("mapKnowledge");
  assertText(value.worldId, "mapKnowledge.worldId");
  if (value.playerId !== targetPeerId) invalidProgression("mapKnowledge.playerId");
  assertNonNegativeInteger(value.revision, "mapKnowledge.revision");
  assertStringArray(value.exploredChunks, "mapKnowledge.exploredChunks");
  if (!isRecord(value.terrainByChunk)) invalidProgression("mapKnowledge.terrainByChunk");
  for (const biome of Object.values(value.terrainByChunk)) {
    if (typeof biome === "number") assertFinite(biome, "mapKnowledge.terrainByChunk");
    else assertText(biome, "mapKnowledge.terrainByChunk");
  }
  if (!isRecord(value.surfaceByChunk)) invalidProgression("mapKnowledge.surfaceByChunk");
  for (const sample of Object.values(value.surfaceByChunk)) {
    if (!Array.isArray(sample) || sample.length !== 4 || !sample.every((color) => typeof color === "string")) invalidProgression("mapKnowledge.surfaceByChunk");
  }
  if (!isRecord(value.undergroundByChunk)) invalidProgression("mapKnowledge.undergroundByChunk");
  for (const sample of Object.values(value.undergroundByChunk)) {
    if (!isRecord(sample) || !exactFieldsWithOptional(sample, ["biome", "elevation"], ["bands"])) invalidProgression("mapKnowledge.undergroundByChunk");
    assertText(sample.biome, "mapKnowledge.undergroundByChunk.biome");
    assertFinite(sample.elevation, "mapKnowledge.undergroundByChunk.elevation");
    if (Object.hasOwn(sample, "bands")) {
      if (!isRecord(sample.bands) || !Object.keys(sample.bands).every((key) => ["upper", "middle", "deep"].includes(key))) invalidProgression("mapKnowledge.undergroundByChunk.bands");
      for (const band of Object.values(sample.bands)) {
        if (!isRecord(band) || !exactFields(band, ["biome", "elevation"])) invalidProgression("mapKnowledge.undergroundByChunk.bands");
        assertText(band.biome, "mapKnowledge.undergroundByChunk.bands.biome");
        assertFinite(band.elevation, "mapKnowledge.undergroundByChunk.bands.elevation");
      }
    }
  }
  if (!Array.isArray(value.markers)) invalidProgression("mapKnowledge.markers");
  for (const [index, marker] of value.markers.entries()) {
    const label = `mapKnowledge.markers[${index}]`;
    const required = ["id", "kind", "name", "position", "discoveredAt", "updatedAt", "discoveredBy", "ownerId", "icon", "layer"];
    if (!isRecord(marker) || !exactFieldsWithOptional(marker, required, ["settlementKnowledge", "factionId", "settlementSize"])) invalidProgression(label);
    for (const key of ["id", "name", "discoveredBy"] as const) assertText(marker[key], `${label}.${key}`);
    if (!["natural-poi", "manual", "bed-spawn", "wayshrine", "settlement"].includes(String(marker.kind))) invalidProgression(`${label}.kind`);
    if (!["surface", "underground", "underwater", "sky"].includes(String(marker.layer))) invalidProgression(`${label}.layer`);
    assertWorldPoint(marker.position, `${label}.position`);
    assertFinite(marker.discoveredAt, `${label}.discoveredAt`);
    assertFinite(marker.updatedAt, `${label}.updatedAt`);
    assertNullableText(marker.ownerId, `${label}.ownerId`);
    assertNullableText(marker.icon, `${label}.icon`);
    if (Object.hasOwn(marker, "settlementKnowledge") && !["rumored", "charted", "visited"].includes(String(marker.settlementKnowledge))) invalidProgression(`${label}.settlementKnowledge`);
    if (Object.hasOwn(marker, "factionId")) assertText(marker.factionId, `${label}.factionId`);
    if (Object.hasOwn(marker, "settlementSize") && !["hamlet", "village", "town"].includes(String(marker.settlementSize))) invalidProgression(`${label}.settlementSize`);
  }
  assertNullableText(value.activeBedId, "mapKnowledge.activeBedId");
  assertNonNegativeInteger(value.fastTravelCharges, "mapKnowledge.fastTravelCharges");
}

function assertBestiary(value: unknown) {
  if (!isRecord(value)) invalidProgression("bestiary");
  const fields = ["schemaVersion", "seen", "kills", "captures", "tames", "breeds", "secretUnlocked", "milestones", "firstSeenAt", "lastObservedAt", "firstCapturedAt", "research", "forms", "specimenIds", "summonOrigins", "guildLinks", "sections"];
  for (const [kind, entry] of Object.entries(value)) {
    const label = `bestiary.${kind}`;
    if (!isRecord(entry) || !exactFields(entry, fields) || entry.schemaVersion !== 2) invalidProgression(label);
    for (const key of ["seen", "secretUnlocked"] as const) if (typeof entry[key] !== "boolean") invalidProgression(`${label}.${key}`);
    for (const key of ["kills", "captures", "tames", "breeds"] as const) assertNonNegativeInteger(entry[key], `${label}.${key}`);
    assertFiniteNumberRecord(entry.milestones, `${label}.milestones`, true);
    for (const key of ["firstSeenAt", "lastObservedAt", "firstCapturedAt"] as const) if (entry[key] !== null) assertFinite(entry[key], `${label}.${key}`);
    if (!isRecord(entry.research)) invalidProgression(`${label}.research`);
    for (const [id, node] of Object.entries(entry.research)) {
      if (!isRecord(node) || !exactFields(node, ["id", "title", "progress", "goal", "unlockedAt"])) invalidProgression(`${label}.research.${id}`);
      assertText(node.id, `${label}.research.${id}.id`);
      assertText(node.title, `${label}.research.${id}.title`);
      assertFinite(node.progress, `${label}.research.${id}.progress`);
      assertFinite(node.goal, `${label}.research.${id}.goal`);
      if (node.unlockedAt !== null) assertFinite(node.unlockedAt, `${label}.research.${id}.unlockedAt`);
    }
    if (!isRecord(entry.forms)) invalidProgression(`${label}.forms`);
    for (const [id, form] of Object.entries(entry.forms)) {
      if (!isRecord(form) || !exactFields(form, ["id", "firstRecordedAt", "sightings", "category"])) invalidProgression(`${label}.forms.${id}`);
      assertText(form.id, `${label}.forms.${id}.id`);
      assertFinite(form.firstRecordedAt, `${label}.forms.${id}.firstRecordedAt`);
      assertNonNegativeInteger(form.sightings, `${label}.forms.${id}.sightings`);
      if (!["shiny", "prime", "regional", "seasonal", "story", "legendary", "summoned"].includes(String(form.category))) invalidProgression(`${label}.forms.${id}.category`);
    }
    for (const key of ["specimenIds", "summonOrigins", "guildLinks"] as const) assertStringArray(entry[key], `${label}.${key}`);
    if (!isRecord(entry.sections)) invalidProgression(`${label}.sections`);
    for (const [section, records] of Object.entries(entry.sections)) {
      if (!Array.isArray(records)) invalidProgression(`${label}.sections.${section}`);
      for (const [index, record] of records.entries()) {
        if (!isRecord(record) || !exactFields(record, ["id", "title", "text", "recordedAt", "sourceId"])) invalidProgression(`${label}.sections.${section}[${index}]`);
        for (const key of ["id", "title", "text"] as const) assertText(record[key], `${label}.sections.${section}[${index}].${key}`);
        assertFinite(record.recordedAt, `${label}.sections.${section}[${index}].recordedAt`);
        assertNullableText(record.sourceId, `${label}.sections.${section}[${index}].sourceId`);
      }
    }
  }
}

function assertAuthorityStamp(value: Record<string, unknown>, label: string) {
  assertText(value.authorityId, `${label}.authorityId`);
  assertNonNegativeInteger(value.revision, `${label}.revision`);
  assertStringArray(value.recentEventIds, `${label}.recentEventIds`);
}

function assertExactPlayerProgression(value: unknown, targetPeerId: string): asserts value is PlayerProgressionSnapshot {
  const required = ["questBook", "sideQuestDefinitions", "mapKnowledge", "bestiary", "plantBestiary", "blueprints", "magicState", "potionBuffs", "rangedLoaded", "bankAccount", "stockMarket"];
  if (!isRecord(value) || !exactFieldsWithOptional(value, required, ["respawn"])) invalidProgression("state");
  assertQuestBook(value.questBook);
  if (!Array.isArray(value.sideQuestDefinitions)) invalidProgression("sideQuestDefinitions");
  value.sideQuestDefinitions.forEach((definition, index) => assertQuestDefinition(definition, `sideQuestDefinitions[${index}]`));
  assertMapKnowledge(value.mapKnowledge, targetPeerId);
  assertBestiary(value.bestiary);
  if (!isRecord(value.plantBestiary) || !exactFields(value.plantBestiary, ["schema", "discovered"])
    || value.plantBestiary.schema !== 1) invalidProgression("plantBestiary");
  assertStringArray(value.plantBestiary.discovered, "plantBestiary.discovered");
  if (!isRecord(value.blueprints) || !exactFields(value.blueprints, ["schema", "unlocked", "unlockedAt"])
    || value.blueprints.schema !== 1) invalidProgression("blueprints");
  assertStringArray(value.blueprints.unlocked, "blueprints.unlocked");
  assertFiniteNumberRecord(value.blueprints.unlockedAt, "blueprints.unlockedAt", true);
  const magic = value.magicState;
  if (!isRecord(magic) || !exactFields(magic, ["schema", "attuned", "attunedAt", "mana", "maxMana", "learnedSpellIds", "favoriteSpellIds", "selectedSpellId", "journal", "cooldownReadyAt"])
    || magic.schema !== 1 || typeof magic.attuned !== "boolean") invalidProgression("magicState");
  if (magic.attunedAt !== null) assertFinite(magic.attunedAt, "magicState.attunedAt");
  assertFinite(magic.mana, "magicState.mana");
  assertFinite(magic.maxMana, "magicState.maxMana");
  assertStringArray(magic.learnedSpellIds, "magicState.learnedSpellIds");
  assertStringArray(magic.favoriteSpellIds, "magicState.favoriteSpellIds");
  assertNullableText(magic.selectedSpellId, "magicState.selectedSpellId");
  if (!isRecord(magic.journal)) invalidProgression("magicState.journal");
  for (const [spellId, entry] of Object.entries(magic.journal)) {
    if (!isRecord(entry) || !exactFields(entry, ["spellId", "discoveredAt", "learnedAt", "castCount", "lastCastAt"])) invalidProgression(`magicState.journal.${spellId}`);
    assertText(entry.spellId, `magicState.journal.${spellId}.spellId`);
    assertFinite(entry.discoveredAt, `magicState.journal.${spellId}.discoveredAt`);
    if (entry.learnedAt !== null) assertFinite(entry.learnedAt, `magicState.journal.${spellId}.learnedAt`);
    assertNonNegativeInteger(entry.castCount, `magicState.journal.${spellId}.castCount`);
    if (entry.lastCastAt !== null) assertFinite(entry.lastCastAt, `magicState.journal.${spellId}.lastCastAt`);
  }
  assertFiniteNumberRecord(magic.cooldownReadyAt, "magicState.cooldownReadyAt", true);
  assertFiniteNumberRecord(value.potionBuffs, "potionBuffs", true);
  assertFiniteNumberRecord(value.rangedLoaded, "rangedLoaded", true);
  for (const [item, loaded] of Object.entries(value.rangedLoaded)) {
    if (!/^\d{1,6}$/u.test(item) || !Number.isSafeInteger(loaded) || loaded > 999) invalidProgression(`rangedLoaded.${item}`);
  }
  const bank = value.bankAccount;
  if (!isRecord(bank) || !exactFields(bank, ["schema", "authorityId", "revision", "recentEventIds", "ownerId", "bankerFaction", "balanceMicroGold", "lastInterestDay"])
    || bank.schema !== 1 || bank.ownerId !== targetPeerId || bank.bankerFaction !== "hobbits") invalidProgression("bankAccount");
  assertAuthorityStamp(bank, "bankAccount");
  if (typeof bank.balanceMicroGold !== "string" || !/^(0|[1-9]\d*)$/u.test(bank.balanceMicroGold)) invalidProgression("bankAccount.balanceMicroGold");
  assertNonNegativeInteger(bank.lastInterestDay, "bankAccount.lastInterestDay");
  const stock = value.stockMarket;
  if (!isRecord(stock) || !exactFields(stock, ["schema", "authorityId", "revision", "recentEventIds", "ownerId", "worldSeed", "day", "quotes", "holdings"])
    || stock.schema !== 1 || stock.ownerId !== targetPeerId) invalidProgression("stockMarket");
  assertAuthorityStamp(stock, "stockMarket");
  assertText(stock.worldSeed, "stockMarket.worldSeed");
  assertNonNegativeInteger(stock.day, "stockMarket.day");
  const symbols = ["BURR", "MOSS", "TIDE", "LAMP"] as const;
  if (!isRecord(stock.quotes) || !exactFields(stock.quotes, symbols) || !isRecord(stock.holdings) || !exactFields(stock.holdings, symbols)) invalidProgression("stockMarket.symbols");
  for (const symbol of symbols) {
    const quote = stock.quotes[symbol];
    if (!isRecord(quote) || !exactFields(quote, ["priceGold", "splitCount", "lastChangeBasisPoints"])) invalidProgression(`stockMarket.quotes.${symbol}`);
    assertFinite(quote.priceGold, `stockMarket.quotes.${symbol}.priceGold`);
    assertNonNegativeInteger(quote.splitCount, `stockMarket.quotes.${symbol}.splitCount`);
    assertFinite(quote.lastChangeBasisPoints, `stockMarket.quotes.${symbol}.lastChangeBasisPoints`);
    const holding = stock.holdings[symbol];
    if (typeof holding !== "string" || !/^(0|[1-9]\d*)$/u.test(holding)) invalidProgression(`stockMarket.holdings.${symbol}`);
  }
  if (Object.hasOwn(value, "respawn")) assertWorldPoint(value.respawn, "respawn");
}

function assertIdentifier(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{8,160}$/u.test(value)) {
    throw new RustMultiplayerPresentationError(`${label} is not a bounded multiplayer identifier`);
  }
  return value;
}

function assertSequence(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RustMultiplayerPresentationError(`${label} is not a non-negative safe integer`);
  }
  return value as number;
}

function assertExactSnapshot(
  value: unknown,
  hostPeerId: string,
  targetPeerId: string,
  targetPeerKind: "human" | "agent",
): asserts value is WorldSnapshot {
  const snapshotFields = targetPeerKind === "human"
    ? [...REQUIRED_SNAPSHOT_FIELDS, "playerState"]
    : REQUIRED_SNAPSHOT_FIELDS;
  if (!isRecord(value) || !exactFields(value, snapshotFields)) {
    throw new RustMultiplayerPresentationError("Rust presentation has a missing or unknown authoritative world-snapshot field");
  }
  if ((value.mode !== "builder" && value.mode !== "survival")
    || (value.generatorProfile !== "legacy-v14" && value.generatorProfile !== "world-below-v15")
    || !isRecord(value.worldOptions)
    || !Array.isArray(value.tombstones)
    || !Array.isArray(value.boats)
    || !Array.isArray(value.containers)
    || !isRecord(value.guildBook)) {
    throw new RustMultiplayerPresentationError("Rust presentation omitted exact generator, option, or shared-world state");
  }
  if (!isRecord(value.time) || !isRecord(value.time.weatherState)) {
    throw new RustMultiplayerPresentationError("Rust presentation omitted the authoritative weather state");
  }
  if (!validateWorldSnapshot(value)) {
    throw new RustMultiplayerPresentationError("Rust presentation contains an invalid world snapshot");
  }
  const hostPoses = value.players.filter((pose) => pose.playerId === hostPeerId);
  if (hostPoses.length !== 1) {
    throw new RustMultiplayerPresentationError("Rust presentation must contain exactly one host pose");
  }
  if (value.mobScope.centerPlayerId !== targetPeerId || value.dropScope.centerPlayerId !== targetPeerId) {
    throw new RustMultiplayerPresentationError("Rust presentation scopes are not targeted to this guest");
  }
  if (targetPeerKind === "human") {
    if (!value.playerState || value.playerState.playerId !== targetPeerId) {
      throw new RustMultiplayerPresentationError("Rust presentation omitted the targeted human player state");
    }
  }
}

function assertProgression(
  value: unknown,
  targetPeerId: string,
  targetPeerKind: "human" | "agent",
): asserts value is RustMultiplayerPlayerProgressionV2 | null {
  if (targetPeerKind === "agent") {
    if (value !== null) throw new RustMultiplayerPresentationError("Agent presentations cannot contain private player progression");
    return;
  }
  if (!isRecord(value) || !exactFields(value, ["revision", "state"])) {
    throw new RustMultiplayerPresentationError("Rust presentation omitted the targeted player progression");
  }
  assertSequence(value.revision, "player progression revision");
  assertExactPlayerProgression(value.state, targetPeerId);
}

function assertProgressionReceipt(
  value: unknown,
  targetPeerKind: "human" | "agent",
  playerProgression: RustMultiplayerPlayerProgressionV2 | null,
): asserts value is RustMultiplayerProgressionReceiptV2 | null {
  if (targetPeerKind === "agent") {
    if (value !== null) throw new RustMultiplayerPresentationError("Agent presentations cannot contain private progression receipts");
    return;
  }
  if (value === null) return;
  if (!isRecord(value) || !exactFields(value, ["transferId", "status", "committedRevision"])) {
    throw new RustMultiplayerPresentationError("Rust presentation contains an invalid progression receipt");
  }
  assertIdentifier(value.transferId, "progression receipt transfer");
  if (value.status !== "accepted" && value.status !== "rejected") {
    throw new RustMultiplayerPresentationError("Rust presentation progression receipt has an invalid status");
  }
  const committedRevision = assertSequence(value.committedRevision, "progression receipt committed revision");
  if (!playerProgression || committedRevision > playerProgression.revision) {
    throw new RustMultiplayerPresentationError("Rust presentation progression receipt exceeds its authoritative progression image");
  }
}

function assertPresentation(
  value: unknown,
  expected: Readonly<{
    sessionId: string;
    hostPeerId: string;
    targetPeerId: string;
    targetPeerKind: "human" | "agent";
    deltaSequence: number;
  }>,
): asserts value is RustMultiplayerWorldPresentationV2 {
  if (!isRecord(value) || !exactFields(value, PRESENTATION_FIELDS)) {
    throw new RustMultiplayerPresentationError("Rust presentation wrapper has an unknown or missing field");
  }
  if (value.schema !== RUST_MULTIPLAYER_PRESENTATION_SCHEMA_V2 || value.kind !== RUST_MULTIPLAYER_PRESENTATION_KIND_V2) {
    throw new RustMultiplayerPresentationError("Rust presentation schema is unsupported");
  }
  if (assertIdentifier(value.sessionId, "presentation session") !== expected.sessionId
    || assertIdentifier(value.hostPeerId, "presentation host") !== expected.hostPeerId
    || assertIdentifier(value.targetPeerId, "presentation target") !== expected.targetPeerId
    || value.targetPeerKind !== expected.targetPeerKind
    || assertSequence(value.deltaSequence, "presentation delta sequence") !== expected.deltaSequence) {
    throw new RustMultiplayerPresentationError("Rust presentation identity or sequence does not match its accepted delta");
  }
  assertExactSnapshot(value.snapshot, expected.hostPeerId, expected.targetPeerId, expected.targetPeerKind);
  assertProgression(value.playerProgression, expected.targetPeerId, expected.targetPeerKind);
  assertProgressionReceipt(value.progressionReceipt, expected.targetPeerKind, value.playerProgression);
}

export function rustMultiplayerPresentationRecordIdV2(peerId: string) {
  return `${RUST_MULTIPLAYER_PRESENTATION_RECORD_PREFIX_V2}${assertIdentifier(peerId, "presentation target")}`;
}

export function encodeRustMultiplayerWorldPresentationV2(value: RustMultiplayerWorldPresentationV2) {
  assertPresentation(value, value);
  let json: string;
  try { json = JSON.stringify(value); }
  catch { throw new RustMultiplayerPresentationError("Rust presentation is not JSON encodable"); }
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength < 1 || bytes.byteLength > RUST_MULTIPLAYER_PRESENTATION_MAX_BYTES_V2) {
    throw new RustMultiplayerPresentationError("Rust presentation exceeds its bounded payload budget");
  }
  return bytes;
}

export function decodeRustMultiplayerWorldPresentationV2(input: Readonly<{
  delta: NetworkDeltaV1;
  sessionId: string;
  host: PeerIdentity;
  target: PeerIdentity;
}>) {
  const expectedRecordId = rustMultiplayerPresentationRecordIdV2(input.target.id);
  const presentationRecords = input.delta.records.filter((record) => (
    record.recordId.startsWith(RUST_MULTIPLAYER_PRESENTATION_RECORD_PREFIX_V2)
  ));
  if (presentationRecords.length !== 1 || presentationRecords[0]!.kind !== "player"
    || presentationRecords[0]!.recordId !== expectedRecordId) {
    throw new RustMultiplayerPresentationError("Accepted Rust delta has a missing, duplicate, or mistargeted presentation record");
  }
  const record = presentationRecords[0]!;
  // The record revision belongs to the stable Rust replication index, while
  // the outer delta sequence is a connection-local replay cursor. A reconnect
  // deliberately restarts the latter at one without regressing the former.
  if (!Number.isSafeInteger(record.revision) || record.revision < 1
    || record.payload.byteLength > RUST_MULTIPLAYER_PRESENTATION_MAX_BYTES_V2) {
    throw new RustMultiplayerPresentationError("Accepted Rust presentation record revision or size is inconsistent");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(PRESENTATION_TEXT_DECODER.decode(record.payload)); }
  catch (error) {
    throw new RustMultiplayerPresentationError(error instanceof Error ? error.message : "Rust presentation is not strict UTF-8 JSON");
  }
  const targetPeerKind = input.target.peerKind ?? "human";
  assertPresentation(parsed, {
    sessionId: input.sessionId,
    hostPeerId: input.host.id,
    targetPeerId: input.target.id,
    targetPeerKind,
    deltaSequence: input.delta.sequence,
  });
  return structuredClone(parsed);
}
