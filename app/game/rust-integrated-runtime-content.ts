import { ALCHEMY_RECIPES, ALCHEMY_SCHEMA, DISTILLERY_RECIPES, DISTILLERY_SCHEMA, STATION_OUTPUT_CAP } from "./alchemy";
import { APIARY_CONTAINER_KIND, APIARY_HONEY_CAP, APIARY_HONEY_CYCLE_SECONDS, APIARY_JELLY_CAP, APIARY_JELLY_CYCLE_SECONDS, APIARY_NECTAR_CAP, APIARY_WORKER_CAP, APIARY_WORKER_GROWTH_SECONDS } from "./apiary";
import { AQUARIUM_BREED_SECONDS, AQUARIUM_MAX_BLOCKS } from "./aquarium";
import { BLUEPRINTS, BLUEPRINT_SCHEMA } from "./blueprints";
import { EXHIBIT_BREEDING_CYCLE_SECONDS, MAX_EXHIBIT_BLOCKS } from "./butterfly-exhibit";
import { SUGARWORKS_OUTPUT_CAP, SUGARWORKS_RECIPES, SUGARWORKS_SCHEMA } from "./candyworks";
import { CAPTURE_ORB_RACK_SIZE, CREATURE_HEALER_GEL_CAP, CREATURE_HEALER_GEL_MULTIPLIER, CREATURE_HEALER_GEL_SECONDS, CREATURE_HEALER_SIZE, CREATURE_HEAL_INTERVAL_SECONDS, HEALING_STATION_CONTAINER_KIND, ORB_RACK_CONTAINER_KIND } from "./capture-orbs";
import { CREATURE_MOVES, CREATURE_REACTIONS, CREATURE_STATUSES } from "./creature-moves";
import { CREATURE_PROFILES } from "./creature-profiles";
import { CREATURE_TYPE_CHART, CREATURE_TYPES } from "./creature-types";
import { BLOCKS, ITEMS, RECIPES, SMELTING, itemForBlock, type BlockDefinition } from "./data";
import { isDirectionallyPlacedBlock } from "./block-facing";
import { DIGITAL_CREATURE_CELL_CAPACITY, DIGITAL_CREATURE_HEAL_SECONDS, DIGITAL_ITEM_CELL_CAPACITY } from "./digital-storage";
import { COMMERCE_CATALOG, STOCKS, ATLANTIAN_MERCHANT_OFFERS, DWARF_MERCHANT_OFFERS, GOBLIN_MERCHANT_OFFERS, HOBBIT_MERCHANT_OFFERS, SUGARCOURT_MERCHANT_OFFERS, WOOD_ELF_MERCHANT_OFFERS } from "./economy";
import { FACTIONS } from "./factions";
import { GUILD_NPCS, GUILD_QUESTS, GUILDS } from "./guilds";
import { SPELLS } from "./magic";
import { ORB_MORPH_RECIPES, ORB_MORPH_RESOURCE_CAP, ORB_MORPH_SCHEMA } from "./orb-morphing";
import { DEFAULT_QUEST_DEFINITIONS, DEFAULT_QUESTLINES, QUEST_BOOK_SCHEMA } from "./quests";
import { TCG_CATALOG, TCG_PACKS, TCG_SETS } from "./tcg/catalog";
import { TCG_CATALOG_REVISION, TCG_SCHEMA } from "./tcg/types";
import { GOLEM_RECIPES } from "./v1-cultures";
import { WHEAT_MILL_CYCLE_SECONDS, WHEAT_MILL_PROCESS, WHEAT_MILL_SCHEMA, WHEAT_MILL_STACK_CAP } from "./wheat-mill";
import { rustIntegratedRuntimeWireChecksumV1 } from "./rust-integrated-runtime-codec";
import {
  BLOCKWILD_PLAYER_RENDER_PROFILE_V1,
  PLAYER_RENDER_PROFILE_ID_V1,
  PLAYER_RENDER_PROFILE_SCHEMA_ID_V1,
  PLAYER_RENDER_PROFILE_SCHEMA_V1,
} from "./rust-player-render-profile.ts";

export const RUST_CONTENT_MANIFEST_SCHEMA = 1 as const;
export const RUST_METADATA_STORE_SCHEMA = 1 as const;
export const MAX_RUST_CONTENT_ENTRIES = 32_768;
export const MAX_RUST_CONTENT_BYTES = 256 * 1024;
export const MAX_RUST_CONTENT_EXTENSION_BYTES = 64 * 1024;
export const MAX_RUST_CONTENT_ALIASES = 16;
export const RUST_BLOCK_ACTION_CATALOG_ID = "block-actions" as const;
export const RUST_BLOCK_ACTION_CATALOG_SCHEMA = 1 as const;

export const RUST_CONTENT_DOMAINS = Object.freeze([
  "item", "crafting-recipe", "machine-recipe", "machine-profile", "ability-spell", "creature-profile",
  "creature-type-chart", "quest-guild", "economy", "cardforge-card", "cardforge-pack",
] as const);
export type RustContentDomain = (typeof RUST_CONTENT_DOMAINS)[number];

export type RustContentBlockerCode =
  | "invalid-id" | "unsupported-value" | "unsupported-schema" | "capacity" | "duplicate-id" | "alias-conflict"
  | "serialization-cycle" | "hash-drift" | "count-drift" | "manifest-hash-drift";

export type RustContentBlocker = Readonly<{
  code: RustContentBlockerCode;
  domain: RustContentDomain | null;
  id: string | null;
  path: string;
  expected?: string;
  actual?: string;
}>;

export type RustContentArtifact = Readonly<{
  domain: RustContentDomain;
  id: string;
  schemaId: string;
  schemaVersion: number;
  contentVersion: number;
  aliases: readonly string[];
  canonicalBytes: Uint8Array;
  unknownExtensionBytes: Uint8Array;
  blobHash: string;
}>;

export type RustContentDomainDigest = Readonly<{ count: number; hash: string }>;
export type RustProductionContentManifest = Readonly<{
  schemaVersion: 1;
  sourceRevision: string;
  domains: Readonly<Record<RustContentDomain, RustContentDomainDigest>>;
  entries: readonly Readonly<{ domain: RustContentDomain; id: string; blobHash: string; byteLength: number }>[];
  manifestHash: string;
}>;

export type RustProductionContentBundle = Readonly<{
  manifest: RustProductionContentManifest | null;
  artifacts: readonly RustContentArtifact[];
  blockers: readonly RustContentBlocker[];
}>;

export type RustContentAuditReport = Readonly<{
  schema: 1;
  ok: boolean;
  sourceRevision: string;
  entryCount: number;
  manifestHash: string | null;
  domains: Readonly<Partial<Record<RustContentDomain, RustContentDomainDigest>>>;
  blockers: readonly RustContentBlocker[];
}>;

export class RustContentCompilationError extends Error {
  readonly report: RustContentAuditReport;

  constructor(report: RustContentAuditReport) {
    super(`Rust production content rejected with ${report.blockers.length} blocker(s).`);
    this.name = "RustContentCompilationError";
    this.report = report;
  }
}

export type RustContentSourceEntry = Readonly<{
  domain: RustContentDomain;
  id: string;
  schemaId: string;
  schemaVersion: number;
  contentVersion: number;
  value: unknown;
  aliases?: readonly string[];
  unknownExtensionBytes?: Uint8Array;
}>;

const encoder = new TextEncoder();
const MASK_64 = BigInt("0xffffffffffffffff");
const FNV_64_OFFSET = BigInt("14695981039346656037");
const FNV_64_PRIME = BigInt("1099511628211");
const HIGH_SEED_XOR = BigInt("0xa0761d6478bd642f");
const HIGH_PRIME = FNV_64_PRIME ^ BigInt("0x13b");

class CanonicalHashWriter {
  private low = FNV_64_OFFSET;
  private high = FNV_64_OFFSET ^ HIGH_SEED_XOR;

  constructor(domain: string) { this.writeString(domain); }

  writeBytesRaw(bytes: Uint8Array) {
    for (const byte of bytes) {
      this.low = ((this.low ^ BigInt(byte)) * FNV_64_PRIME) & MASK_64;
      this.high = ((this.high ^ (BigInt(byte) * BigInt(2) + BigInt(1))) * HIGH_PRIME) & MASK_64;
    }
  }

  writeBytes(bytes: Uint8Array) { this.writeU64(BigInt(bytes.byteLength)); this.writePayload(bytes); }
  writeString(value: string) { this.writeBytes(encoder.encode(value)); }
  writeU16(value: number) { this.writeNumber(value, 2); }
  writeU32(value: number) { this.writeNumber(value, 4); }
  writeU64(value: bigint) { this.writeBigInt(value, 8); }

  private writePayload(bytes: Uint8Array) {
    for (const byte of bytes) {
      this.low = ((this.low ^ BigInt(byte)) * FNV_64_PRIME) & MASK_64;
      // Rust promotes the byte to u64 before rotate_left(1), so no u8 wrap occurs.
      this.high = ((this.high ^ (BigInt(byte) * BigInt(2))) * HIGH_PRIME) & MASK_64;
    }
  }

  private writeNumber(value: number, bytes: number) {
    const buffer = new Uint8Array(bytes);
    let remaining = value >>> 0;
    for (let index = 0; index < bytes; index += 1) { buffer[index] = remaining & 0xff; remaining >>>= 8; }
    this.writeBytesRaw(buffer);
  }

  private writeBigInt(value: bigint, bytes: number) {
    const buffer = new Uint8Array(bytes);
    let remaining = value;
    for (let index = 0; index < bytes; index += 1) { buffer[index] = Number(remaining & BigInt(0xff)); remaining >>= BigInt(8); }
    this.writeBytesRaw(buffer);
  }

  finish() {
    const output = new Uint8Array(16);
    let low = this.low;
    let high = this.high;
    for (let index = 0; index < 8; index += 1) { output[index] = Number(low & BigInt(0xff)); low >>= BigInt(8); }
    for (let index = 0; index < 8; index += 1) { output[index + 8] = Number(high & BigInt(0xff)); high >>= BigInt(8); }
    return bytesToHex(output);
  }
}

function bytesToHex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(hex: string) {
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`invalid canonical hash: ${hex}`);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function unsupported(blockers: RustContentBlocker[], domain: RustContentDomain, id: string, path: string, actual: string) {
  blockers.push({ code: "unsupported-value", domain, id, path, actual });
}

/** Canonical JSON subset. Unsupported values are blockers, never silently normalized. */
export function canonicalContentBytes(
  value: unknown,
  context: Readonly<{ domain: RustContentDomain; id: string }>,
  blockers: RustContentBlocker[],
) {
  const active = new Set<object>();
  const encode = (input: unknown, path: string): string | null => {
    if (input === null) return "null";
    if (typeof input === "string") return JSON.stringify(input);
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number") {
      if (!Number.isFinite(input)) { unsupported(blockers, context.domain, context.id, path, String(input)); return null; }
      return Object.is(input, -0) ? "0" : JSON.stringify(input);
    }
    if (typeof input !== "object") { unsupported(blockers, context.domain, context.id, path, typeof input); return null; }
    if (active.has(input)) {
      blockers.push({ code: "serialization-cycle", domain: context.domain, id: context.id, path });
      return null;
    }
    active.add(input);
    let result: string | null = null;
    if (input instanceof Uint8Array) {
      result = `{"$bytes":${JSON.stringify(bytesToHex(input))}}`;
    } else if (Array.isArray(input)) {
      const values = input.map((entry, index) => encode(entry, `${path}[${index}]`));
      result = values.some((entry) => entry === null) ? null : `[${values.join(",")}]`;
    } else if (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null) {
      // Optional object fields whose authored value is undefined are canonically absent.
      // Undefined array entries and top-level values remain unsupported blockers.
      const fields = Object.keys(input as Record<string, unknown>)
        .filter((key) => (input as Record<string, unknown>)[key] !== undefined)
        .sort().map((key) => {
        const encoded = encode((input as Record<string, unknown>)[key], `${path}.${key}`);
        return encoded === null ? null : `${JSON.stringify(key)}:${encoded}`;
      });
      result = fields.some((entry) => entry === null) ? null : `{${fields.join(",")}}`;
    } else {
      unsupported(blockers, context.domain, context.id, path, Object.prototype.toString.call(input));
    }
    active.delete(input);
    return result;
  };
  const encoded = encode(value, "$.");
  return encoded === null ? null : encoder.encode(encoded);
}

export type RustMetadataHashInputV1 = Readonly<{
  typeId: string;
  schemaId: string;
  schemaVersion: number;
  contentVersion: number;
  aliases: readonly string[];
  canonicalBytes: Uint8Array;
  unknownExtensionBytes: Uint8Array;
}>;

export function canonicalMetadataBlobHashV1(input: RustMetadataHashInputV1) {
  const aliases = [...input.aliases].sort();
  const writer = new CanonicalHashWriter("blockwild.gameplay.metadata-blob.v1");
  writer.writeU16(RUST_METADATA_STORE_SCHEMA);
  writer.writeString(input.typeId);
  writer.writeString(input.schemaId);
  writer.writeU16(input.schemaVersion);
  writer.writeU32(input.contentVersion);
  writer.writeU64(BigInt(aliases.length));
  for (const alias of aliases) writer.writeString(alias);
  writer.writeBytes(input.canonicalBytes);
  writer.writeBytes(input.unknownExtensionBytes);
  writer.writeU16(0); // future_sha256 is explicitly absent in V1.
  return writer.finish();
}

export function canonicalRustMetadataHash(input: Readonly<Omit<RustContentArtifact, "blobHash">>) {
  return canonicalMetadataBlobHashV1({ ...input, typeId: `blockwild.content.${input.domain}` });
}

export function compileRustProductionContent(sourceRevision: string, sourceEntries: readonly RustContentSourceEntry[]): RustProductionContentBundle {
  const blockers: RustContentBlocker[] = [];
  if (!sourceRevision || sourceRevision.length > 160 || /[\u0000-\u001f\u007f]/u.test(sourceRevision)) {
    blockers.push({ code: "invalid-id", domain: null, id: null, path: "$.sourceRevision", actual: sourceRevision });
  }
  if (sourceEntries.length > MAX_RUST_CONTENT_ENTRIES) {
    blockers.push({ code: "capacity", domain: null, id: null, path: "$.entries", expected: String(MAX_RUST_CONTENT_ENTRIES), actual: String(sourceEntries.length) });
  }
  const seen = new Set<string>();
  const seenAliases = new Set<string>();
  const artifacts: RustContentArtifact[] = [];
  for (const entry of sourceEntries) {
    const key = `${entry.domain}\u0000${entry.id}`;
    if (!entry.id || entry.id.length > 160 || /[\u0000-\u001f\u007f]/u.test(entry.id)) {
      blockers.push({ code: "invalid-id", domain: entry.domain, id: entry.id, path: "$.id", actual: entry.id });
      continue;
    }
    if (seen.has(key)) {
      blockers.push({ code: "duplicate-id", domain: entry.domain, id: entry.id, path: "$.id" });
      continue;
    }
    seen.add(key);
    if (!Number.isInteger(entry.schemaVersion) || entry.schemaVersion <= 0 || entry.schemaVersion > 0xffff) {
      blockers.push({ code: "unsupported-schema", domain: entry.domain, id: entry.id, path: "$.schemaVersion", actual: String(entry.schemaVersion) });
      continue;
    }
    if (!entry.schemaId || entry.schemaId.length > 160 || /[\u0000-\u001f\u007f]/u.test(entry.schemaId)
      || !Number.isInteger(entry.contentVersion) || entry.contentVersion < 0 || entry.contentVersion > 0xffff_ffff) {
      blockers.push({ code: "unsupported-schema", domain: entry.domain, id: entry.id, path: "$.schemaId/contentVersion", actual: `${entry.schemaId}/${entry.contentVersion}` });
      continue;
    }
    const aliases = [...(entry.aliases ?? [`${entry.domain}:${entry.id}`])].sort();
    if (aliases.length > MAX_RUST_CONTENT_ALIASES || new Set(aliases).size !== aliases.length
      || aliases.some((alias) => !alias || alias.length > 160 || /[\u0000-\u001f\u007f]/u.test(alias))) {
      blockers.push({ code: "capacity", domain: entry.domain, id: entry.id, path: "$.aliases", expected: String(MAX_RUST_CONTENT_ALIASES), actual: String(aliases.length) });
      continue;
    }
    const conflictingAlias = aliases.find((alias) => seenAliases.has(alias));
    if (conflictingAlias) {
      blockers.push({ code: "alias-conflict", domain: entry.domain, id: entry.id, path: "$.aliases", actual: conflictingAlias });
      continue;
    }
    aliases.forEach((alias) => seenAliases.add(alias));
    const canonicalBytes = canonicalContentBytes(entry.value, entry, blockers);
    const unknownExtensionBytes = entry.unknownExtensionBytes?.slice() ?? new Uint8Array();
    if (!canonicalBytes) continue;
    if (canonicalBytes.byteLength > MAX_RUST_CONTENT_BYTES || unknownExtensionBytes.byteLength > MAX_RUST_CONTENT_EXTENSION_BYTES) {
      blockers.push({ code: "capacity", domain: entry.domain, id: entry.id, path: "$.bytes", expected: `${MAX_RUST_CONTENT_BYTES}/${MAX_RUST_CONTENT_EXTENSION_BYTES}`, actual: `${canonicalBytes.byteLength}/${unknownExtensionBytes.byteLength}` });
      continue;
    }
    const withoutHash = {
      domain: entry.domain, id: entry.id, schemaId: entry.schemaId, schemaVersion: entry.schemaVersion,
      contentVersion: entry.contentVersion, aliases, canonicalBytes, unknownExtensionBytes,
    };
    artifacts.push(Object.freeze({ ...withoutHash, blobHash: canonicalRustMetadataHash(withoutHash) }));
  }
  artifacts.sort((left, right) => RUST_CONTENT_DOMAINS.indexOf(left.domain) - RUST_CONTENT_DOMAINS.indexOf(right.domain)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  if (blockers.length) return Object.freeze({ manifest: null, artifacts: Object.freeze(artifacts), blockers: Object.freeze(blockers) });

  const entries = artifacts.map((artifact) => Object.freeze({
    domain: artifact.domain, id: artifact.id, blobHash: artifact.blobHash,
    byteLength: artifact.canonicalBytes.byteLength + artifact.unknownExtensionBytes.byteLength,
  }));
  const domains = Object.fromEntries(RUST_CONTENT_DOMAINS.map((domain) => {
    const selected = entries.filter((entry) => entry.domain === domain);
    const writer = new CanonicalHashWriter("blockwild.gameplay.content-domain.v1");
    writer.writeString(domain);
    writer.writeU64(BigInt(selected.length));
    for (const entry of selected) {
      writer.writeString(entry.id);
      writer.writeBytes(hexToBytes(entry.blobHash));
      writer.writeU32(entry.byteLength);
    }
    return [domain, Object.freeze({ count: selected.length, hash: writer.finish() })];
  })) as Record<RustContentDomain, RustContentDomainDigest>;
  const manifestWriter = new CanonicalHashWriter("blockwild.gameplay.content-manifest.v1");
  manifestWriter.writeU16(RUST_CONTENT_MANIFEST_SCHEMA);
  manifestWriter.writeString(sourceRevision);
  manifestWriter.writeU64(BigInt(RUST_CONTENT_DOMAINS.length));
  for (const domain of RUST_CONTENT_DOMAINS) {
    manifestWriter.writeString(domain);
    manifestWriter.writeU32(domains[domain].count);
    manifestWriter.writeBytes(hexToBytes(domains[domain].hash));
  }
  const manifest = Object.freeze({
    schemaVersion: RUST_CONTENT_MANIFEST_SCHEMA,
    sourceRevision,
    domains: Object.freeze(domains),
    entries: Object.freeze(entries),
    manifestHash: manifestWriter.finish(),
  });
  return Object.freeze({ manifest, artifacts: Object.freeze(artifacts), blockers: Object.freeze([]) });
}

function objectEntries<T>(record: Readonly<Record<string, T>>) {
  return Object.entries(record).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}
function source(domain: RustContentDomain, id: string, schemaId: string, schemaVersion: number, value: unknown, contentVersion = 1): RustContentSourceEntry {
  return { domain, id, schemaId, schemaVersion, contentVersion, value };
}

function blockActionTopologyFlags(definition: BlockDefinition) {
  const flags: string[] = [];
  if (isDirectionallyPlacedBlock(definition.id)) flags.push("directional");
  if (definition.shape === "door" || definition.shape === "bed") flags.push("paired");
  if (definition.shape === "torch") flags.push("attached");
  if (definition.verticalConnectGroup !== undefined) flags.push("vertical-connected");
  if (definition.connectGroup !== undefined) flags.push("horizontal-connected");
  if (definition.waterlogged === true) flags.push("waterlogged");
  if (definition.shape === "aquarium" || definition.shape === "exhibit") flags.push("bounded-network");
  return flags;
}

export function blockwildBlockActionCatalogV1() {
  const profiles = Object.values(BLOCKS)
    .sort((left, right) => left.id - right.id)
    .map((definition) => {
      const mappedItem = itemForBlock(definition.id);
      return {
        id: definition.id,
        hardness: definition.hardness,
        solid: definition.solid,
        replaceable: definition.replaceable === true,
        preferredTool: definition.preferredTool,
        requiredTier: definition.requiredTier,
        ...(ITEMS[mappedItem] === undefined ? {} : { item: mappedItem }),
        ...(definition.liquid === undefined ? {} : { liquid: definition.liquid }),
        ...(definition.shape === undefined ? {} : { shape: definition.shape }),
        ...(definition.collisionHeight === undefined ? {} : { collisionHeight: definition.collisionHeight }),
        ...(definition.verticalConnectGroup === undefined ? {} : { verticalConnectGroup: definition.verticalConnectGroup }),
        ...(definition.connectGroup === undefined ? {} : { connectGroup: definition.connectGroup }),
        topologyFlags: blockActionTopologyFlags(definition),
      };
    });
  return { schema: RUST_BLOCK_ACTION_CATALOG_SCHEMA, profiles } as const;
}

export function blockwildProductionContentSources(): readonly RustContentSourceEntry[] {
  const entries: RustContentSourceEntry[] = [];
  entries.push(source(
    "item",
    RUST_BLOCK_ACTION_CATALOG_ID,
    "block-action-catalog",
    RUST_BLOCK_ACTION_CATALOG_SCHEMA,
    blockwildBlockActionCatalogV1(),
  ));
  for (const item of Object.values(ITEMS)) entries.push(source("item", String(item.id), "item-definition", 1, item));
  for (const recipe of RECIPES) entries.push(source("crafting-recipe", recipe.id, "crafting-recipe", 1, recipe));
  for (const blueprint of BLUEPRINTS) entries.push(source("crafting-recipe", `blueprint:${blueprint.id}`, "blueprint-definition", BLUEPRINT_SCHEMA, blueprint));
  for (const recipe of ALCHEMY_RECIPES) entries.push(source("machine-recipe", `alchemy:${recipe.id}`, "alchemy-recipe", ALCHEMY_SCHEMA, recipe));
  for (const recipe of DISTILLERY_RECIPES) entries.push(source("machine-recipe", `distillery:${recipe.id}`, "distillery-recipe", DISTILLERY_SCHEMA, recipe));
  for (const recipe of SUGARWORKS_RECIPES) entries.push(source("machine-recipe", `sugarworks:${recipe.id}`, "sugarworks-recipe", SUGARWORKS_SCHEMA, recipe));
  for (const [inputItem, output] of objectEntries(SMELTING)) entries.push(source("machine-recipe", `furnace:${inputItem}`, "furnace-recipe", 1, { inputItem: Number(inputItem), output }));
  for (const recipe of ORB_MORPH_RECIPES) entries.push(source("machine-recipe", `orb-morph:${recipe.id}`, "orb-morph-recipe", ORB_MORPH_SCHEMA, recipe));
  for (const [id, recipe] of objectEntries(GOLEM_RECIPES)) entries.push(source("machine-recipe", `golem-forge:${id}`, "golem-forge-recipe", 1, recipe));
  entries.push(source("machine-recipe", "wheat-mill", "wheat-mill-process", WHEAT_MILL_SCHEMA, WHEAT_MILL_PROCESS));
  entries.push(source("machine-profile", "alchemy", "machine-profile", ALCHEMY_SCHEMA, { outputCap: STATION_OUTPUT_CAP, recipeIds: ALCHEMY_RECIPES.map((recipe) => recipe.id) }));
  entries.push(source("machine-profile", "distillery", "machine-profile", DISTILLERY_SCHEMA, { outputCap: STATION_OUTPUT_CAP, recipeIds: DISTILLERY_RECIPES.map((recipe) => recipe.id) }));
  entries.push(source("machine-profile", "furnace", "machine-profile", 1, { inputItemIds: Object.keys(SMELTING).map(Number).sort((left, right) => left - right) }));
  entries.push(source("machine-profile", "sugarworks", "machine-profile", 1, { schema: SUGARWORKS_SCHEMA, outputCap: SUGARWORKS_OUTPUT_CAP }));
  entries.push(source("machine-profile", "wheat-mill", "machine-profile", 1, { schema: WHEAT_MILL_SCHEMA, cycleSeconds: WHEAT_MILL_CYCLE_SECONDS, stackCap: WHEAT_MILL_STACK_CAP }));
  entries.push(source("machine-profile", "apiary", "machine-profile", 1, { kind: APIARY_CONTAINER_KIND, workerCap: APIARY_WORKER_CAP, nectarCap: APIARY_NECTAR_CAP, honeyCap: APIARY_HONEY_CAP, jellyCap: APIARY_JELLY_CAP, honeyCycleSeconds: APIARY_HONEY_CYCLE_SECONDS, jellyCycleSeconds: APIARY_JELLY_CYCLE_SECONDS, workerGrowthSeconds: APIARY_WORKER_GROWTH_SECONDS }));
  entries.push(source("machine-profile", "capture-orb-rack", "machine-profile", 1, { kind: ORB_RACK_CONTAINER_KIND, slots: CAPTURE_ORB_RACK_SIZE }));
  entries.push(source("machine-profile", "creature-healing-station", "machine-profile", 1, { kind: HEALING_STATION_CONTAINER_KIND, slots: CREATURE_HEALER_SIZE, healIntervalSeconds: CREATURE_HEAL_INTERVAL_SECONDS, gelCap: CREATURE_HEALER_GEL_CAP, gelSeconds: CREATURE_HEALER_GEL_SECONDS, gelMultiplier: CREATURE_HEALER_GEL_MULTIPLIER }));
  entries.push(source("machine-profile", "orb-morph-loom", "machine-profile", ORB_MORPH_SCHEMA, { resourceCap: ORB_MORPH_RESOURCE_CAP }));
  entries.push(source("machine-profile", "digital-item-vault", "machine-profile", 1, { capacities: DIGITAL_ITEM_CELL_CAPACITY }));
  entries.push(source("machine-profile", "digital-creature-archive", "machine-profile", 1, { capacities: DIGITAL_CREATURE_CELL_CAPACITY, healSeconds: DIGITAL_CREATURE_HEAL_SECONDS }));
  entries.push(source("machine-profile", "aquarium", "machine-profile", 1, { maxBlocks: AQUARIUM_MAX_BLOCKS, breedSeconds: AQUARIUM_BREED_SECONDS }));
  entries.push(source("machine-profile", "butterfly-exhibit", "machine-profile", 1, { maxBlocks: MAX_EXHIBIT_BLOCKS, breedSeconds: EXHIBIT_BREEDING_CYCLE_SECONDS }));
  entries.push(source("machine-profile", "golem-forge", "machine-profile", 1, { recipeIds: Object.keys(GOLEM_RECIPES).sort() }));
  for (const spell of SPELLS) entries.push(source("ability-spell", `spell:${spell.id}`, "spell-definition", 1, spell));
  for (const [id, move] of objectEntries(CREATURE_MOVES)) entries.push(source("ability-spell", `move:${id}`, "creature-move", 1, move));
  for (const [id, status] of objectEntries(CREATURE_STATUSES)) entries.push(source("ability-spell", `status:${id}`, "creature-status", 1, status));
  CREATURE_REACTIONS.forEach((reaction, index) => entries.push(source("ability-spell", `reaction:${index}`, "creature-reaction", 1, reaction)));
  for (const [id, profile] of objectEntries(CREATURE_PROFILES)) entries.push(source("creature-profile", id, "creature-profile", 1, profile));
  entries.push({
    domain: "creature-profile",
    id: PLAYER_RENDER_PROFILE_ID_V1,
    schemaId: PLAYER_RENDER_PROFILE_SCHEMA_ID_V1,
    schemaVersion: PLAYER_RENDER_PROFILE_SCHEMA_V1,
    contentVersion: 1,
    value: BLOCKWILD_PLAYER_RENDER_PROFILE_V1,
    aliases: Object.freeze([
      `creature-profile:${PLAYER_RENDER_PROFILE_ID_V1}`,
      "player-render-profile:standing",
    ]),
  });
  for (const [id, definition] of objectEntries(CREATURE_TYPES)) entries.push(source("creature-type-chart", `type:${id}`, "creature-type", 1, definition));
  for (const [id, chart] of objectEntries(CREATURE_TYPE_CHART)) entries.push(source("creature-type-chart", `chart:${id}`, "creature-type-chart", 1, chart));
  for (const quest of DEFAULT_QUEST_DEFINITIONS) entries.push(source("quest-guild", `quest:${quest.id}`, "quest-definition", QUEST_BOOK_SCHEMA, quest));
  for (const questline of DEFAULT_QUESTLINES) entries.push(source("quest-guild", `questline:${questline.id}`, "questline-definition", QUEST_BOOK_SCHEMA, questline));
  for (const [id, guild] of objectEntries(GUILDS)) entries.push(source("quest-guild", `guild:${id}`, "guild-definition", 1, guild));
  for (const quest of GUILD_QUESTS) entries.push(source("quest-guild", `guild-quest:${quest.id}`, "guild-quest", 1, quest));
  for (const npc of GUILD_NPCS) entries.push(source("quest-guild", `guild-npc:${npc.id}`, "guild-npc", 1, npc));
  for (const [id, faction] of objectEntries(FACTIONS)) entries.push(source("quest-guild", `faction:${id}`, "faction-definition", 1, faction));
  for (const [id, commerce] of objectEntries(COMMERCE_CATALOG)) entries.push(source("economy", `commerce:${id}`, "commerce-item", 1, commerce));
  const merchantOffers = { hobbit: HOBBIT_MERCHANT_OFFERS, goblin: GOBLIN_MERCHANT_OFFERS, atlantian: ATLANTIAN_MERCHANT_OFFERS, sugarcourt: SUGARCOURT_MERCHANT_OFFERS, "wood-elf": WOOD_ELF_MERCHANT_OFFERS, dwarf: DWARF_MERCHANT_OFFERS };
  for (const [merchant, offers] of objectEntries(merchantOffers)) offers.forEach((offer, index) => entries.push(source("economy", `merchant:${merchant}:${index}`, "merchant-offer", 1, offer)));
  for (const [id, stock] of objectEntries(STOCKS)) entries.push(source("economy", `stock:${id}`, "stock-definition", 1, stock));
  for (const [id, definition] of objectEntries(TCG_CATALOG.definitions)) entries.push(source("cardforge-card", `definition:${id}`, "tcg-card-definition", TCG_SCHEMA, definition, definition.rulesRevision));
  for (const [id, printing] of objectEntries(TCG_CATALOG.printings)) entries.push(source("cardforge-card", `printing:${id}`, "tcg-printing", TCG_SCHEMA, printing));
  for (const [id, pack] of objectEntries(TCG_PACKS)) entries.push(source("cardforge-pack", `pack:${id}`, "tcg-pack", TCG_SCHEMA, pack));
  for (const [id, set] of objectEntries(TCG_SETS)) entries.push(source("cardforge-pack", `set:${id}`, "tcg-set", TCG_SCHEMA, set));
  return Object.freeze(entries);
}

export function compileBlockwildProductionContent() {
  return compileRustProductionContent(`blockwild-1.12.0+${TCG_CATALOG_REVISION}`, blockwildProductionContentSources());
}

export function rustContentAuditReport(bundle: RustProductionContentBundle, sourceRevision: string): RustContentAuditReport {
  return Object.freeze({
    schema: 1,
    ok: bundle.blockers.length === 0 && bundle.manifest !== null,
    sourceRevision,
    entryCount: bundle.artifacts.length,
    manifestHash: bundle.manifest?.manifestHash ?? null,
    domains: bundle.manifest?.domains ?? Object.freeze({}),
    blockers: bundle.blockers,
  });
}

export function requireBlockwildProductionContent() {
  const sourceRevision = `blockwild-1.12.0+${TCG_CATALOG_REVISION}`;
  const bundle = compileRustProductionContent(sourceRevision, blockwildProductionContentSources());
  const report = rustContentAuditReport(bundle, sourceRevision);
  if (!report.ok || !bundle.manifest) throw new RustContentCompilationError(report);
  return Object.freeze({ manifest: bundle.manifest, artifacts: bundle.artifacts, report });
}

export function validateRustContentExpectation(
  bundle: RustProductionContentBundle,
  expected: Readonly<{ manifestHash: string; domains: Readonly<Partial<Record<RustContentDomain, RustContentDomainDigest>>> }>,
) {
  const blockers: RustContentBlocker[] = [...bundle.blockers];
  if (!bundle.manifest) return Object.freeze(blockers);
  for (const domain of RUST_CONTENT_DOMAINS) {
    const domainExpected = expected.domains[domain];
    if (!domainExpected) continue;
    const actual = bundle.manifest.domains[domain];
    if (domainExpected.count !== actual.count) blockers.push({ code: "count-drift", domain, id: null, path: `$.domains.${domain}.count`, expected: String(domainExpected.count), actual: String(actual.count) });
    if (domainExpected.hash !== actual.hash) blockers.push({ code: "hash-drift", domain, id: null, path: `$.domains.${domain}.hash`, expected: domainExpected.hash, actual: actual.hash });
  }
  if (expected.manifestHash !== bundle.manifest.manifestHash) blockers.push({ code: "manifest-hash-drift", domain: null, id: null, path: "$.manifestHash", expected: expected.manifestHash, actual: bundle.manifest.manifestHash });
  return Object.freeze(blockers);
}

export const RUST_CONTENT_INSTALL_PAGE_TYPE_V1 = "blockwild.gameplay.content-install-page.v1" as const;
export const RUST_CONTENT_INSTALL_RECEIPT_TYPE_V1 = "blockwild.gameplay.content-install-receipt.v1" as const;
export const RUST_CONTENT_INSTALL_CAPABILITY_V1 = "content-bundle-install-v1" as const;
export const RUST_CONTENT_AUTHORITY_CAPABILITY_V1 = "content-authority-v1" as const;
export const RUST_CONTENT_INSTALL_MAX_PAGES_V1 = 128;
export const RUST_CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1 = 1_024;
export const RUST_CONTENT_INSTALL_PAGE_BUDGET_V1 = 768 * 1024;

export type RustContentInstallPageV1 = Readonly<{
  installId: string;
  manifestSchema: number;
  sourceRevision: string;
  manifestHash: string;
  domains: Readonly<Record<RustContentDomain, RustContentDomainDigest>>;
  pageIndex: number;
  pageCount: number;
  artifacts: readonly RustContentArtifact[];
}>;

export type RustContentInstallReceiptV1 = Readonly<{
  status: "staged" | "installed";
  installId: string;
  sourceRevision: string;
  manifestHash: string;
  domains: Readonly<Record<RustContentDomain, RustContentDomainDigest>>;
  acceptedPages: number;
  pageCount: number;
  acceptedEntries: number;
  installedEntries: number;
  installedBytes: number;
}>;

export type RustContentInstallPlanV1 = Readonly<{
  installId: string;
  manifestHash: string;
  pages: readonly Readonly<{ page: RustContentInstallPageV1; payload: Uint8Array }>[];
}>;

const CONTENT_PAGE_MAGIC = encoder.encode("BWC7");
const CONTENT_RECEIPT_MAGIC = encoder.encode("BWT7");
const CONTENT_DOMAIN_HEADER_BYTES = 28;

class ContentWireWriter {
  private readonly values: number[] = [];
  u8(value: number) { this.values.push(value & 0xff); }
  u16(value: number) { this.rawNumber(value, 2); }
  u32(value: number) { this.rawNumber(value, 4); }
  u64(value: number) {
    let remaining = BigInt(value);
    for (let index = 0; index < 8; index += 1) { this.u8(Number(remaining & BigInt(0xff))); remaining >>= BigInt(8); }
  }
  hash(value: string) { this.raw(hexToBytes(value)); }
  string(value: string) {
    const bytes = encoder.encode(value);
    if (!value || bytes.byteLength > 16 * 1024 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("content wire string is malformed");
    this.bytes(bytes);
  }
  bytes(value: Uint8Array) { this.u32(value.byteLength); this.raw(value); }
  raw(value: Uint8Array) { for (const byte of value) this.values.push(byte); }
  finish() { return Uint8Array.from(this.values); }
  private rawNumber(value: number, width: number) {
    let remaining = value >>> 0;
    for (let index = 0; index < width; index += 1) { this.u8(remaining); remaining >>>= 8; }
  }
}

class ContentWireReader {
  private offset = 0;
  constructor(private readonly bytesValue: Uint8Array) {}
  u8() { return this.take(1)[0]; }
  u16() { const bytes = this.take(2); return bytes[0] | (bytes[1] << 8); }
  u32() { const bytes = this.take(4); return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true); }
  u64() {
    const bytes = this.take(8); let value = BigInt(0);
    for (let index = 7; index >= 0; index -= 1) value = (value << BigInt(8)) | BigInt(bytes[index]);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("content wire u64 exceeds browser safe integer range");
    return Number(value);
  }
  hash() { return bytesToHex(this.take(16)); }
  bytes(maximum = Number.MAX_SAFE_INTEGER) { const length = this.u32(); if (length > maximum) throw new Error("content wire bytes exceed budget"); return Uint8Array.from(this.take(length)); }
  string() {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(this.bytes(16 * 1024));
    if (!value || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("content wire string is malformed");
    return value;
  }
  finish() { if (this.offset !== this.bytesValue.byteLength) throw new Error("content wire packet has trailing bytes"); }
  private take(length: number) {
    const result = this.bytesValue.subarray(this.offset, this.offset + length);
    if (result.byteLength !== length) throw new Error("content wire packet is truncated");
    this.offset += length; return result;
  }
}

function writeContentDomains(writer: ContentWireWriter, domains: Readonly<Record<RustContentDomain, RustContentDomainDigest>>) {
  writer.u16(RUST_CONTENT_DOMAINS.length);
  RUST_CONTENT_DOMAINS.forEach((domain, tag) => {
    const digest = domains[domain];
    if (!digest) throw new Error(`content manifest is missing ${domain}`);
    writer.u8(tag); writer.u32(digest.count); writer.hash(digest.hash);
  });
}

function readContentDomains(reader: ContentWireReader) {
  if (reader.u16() !== RUST_CONTENT_DOMAINS.length) throw new Error("content domain count is invalid");
  const result = {} as Record<RustContentDomain, RustContentDomainDigest>;
  RUST_CONTENT_DOMAINS.forEach((domain, tag) => {
    if (reader.u8() !== tag) throw new Error("content domains are not canonically ordered");
    result[domain] = Object.freeze({ count: reader.u32(), hash: reader.hash() });
  });
  return Object.freeze(result);
}

function writeContentArtifact(writer: ContentWireWriter, artifact: RustContentArtifact) {
  writer.u8(RUST_CONTENT_DOMAINS.indexOf(artifact.domain));
  writer.string(artifact.id); writer.string(artifact.schemaId); writer.u16(artifact.schemaVersion); writer.u32(artifact.contentVersion);
  if (artifact.aliases.length > MAX_RUST_CONTENT_ALIASES) throw new Error("content artifact alias count exceeds budget");
  writer.u32(artifact.aliases.length);
  for (const alias of artifact.aliases) writer.string(alias);
  writer.bytes(artifact.canonicalBytes); writer.bytes(artifact.unknownExtensionBytes);
}

function readContentArtifact(reader: ContentWireReader): RustContentArtifact {
  const domain = RUST_CONTENT_DOMAINS[reader.u8()];
  if (!domain) throw new Error("content artifact domain is invalid");
  const id = reader.string(); const schemaId = reader.string(); const schemaVersion = reader.u16(); const contentVersion = reader.u32();
  const aliasCount = reader.u32();
  if (aliasCount > MAX_RUST_CONTENT_ALIASES) throw new Error("content artifact alias count exceeds budget");
  const aliases = Object.freeze(Array.from({ length: aliasCount }, () => reader.string()));
  const canonicalBytes = reader.bytes(MAX_RUST_CONTENT_BYTES);
  const unknownExtensionBytes = reader.bytes(MAX_RUST_CONTENT_EXTENSION_BYTES);
  const withoutHash = { domain, id, schemaId, schemaVersion, contentVersion, aliases, canonicalBytes, unknownExtensionBytes };
  return Object.freeze({ ...withoutHash, blobHash: canonicalRustMetadataHash(withoutHash) });
}

function contentPageBody(page: RustContentInstallPageV1) {
  const writer = new ContentWireWriter();
  writer.string(page.installId); writer.u16(page.manifestSchema); writer.string(page.sourceRevision); writer.hash(page.manifestHash);
  writeContentDomains(writer, page.domains); writer.u32(page.pageIndex); writer.u32(page.pageCount); writer.u32(page.artifacts.length);
  for (const artifact of page.artifacts) writeContentArtifact(writer, artifact);
  return writer.finish();
}

function wrapContentPacket(magic: Uint8Array, body: Uint8Array) {
  const writer = new ContentWireWriter();
  writer.raw(magic); writer.u16(1); writer.u16(1); writer.u32(body.byteLength);
  writer.hash(rustIntegratedRuntimeWireChecksumV1(body)); writer.raw(body);
  return writer.finish();
}

function unwrapContentPacket(packet: Uint8Array, magic: Uint8Array) {
  if (packet.byteLength < CONTENT_DOMAIN_HEADER_BYTES) throw new Error("content wire packet is truncated");
  if (!magic.every((byte, index) => packet[index] === byte)) throw new Error("content wire magic mismatch");
  const header = new DataView(packet.buffer, packet.byteOffset, CONTENT_DOMAIN_HEADER_BYTES);
  if (header.getUint16(4, true) !== 1 || header.getUint16(6, true) !== 1) throw new Error("content wire version is unsupported");
  const length = header.getUint32(8, true); const checksum = bytesToHex(packet.subarray(12, 28));
  const payload = packet.subarray(CONTENT_DOMAIN_HEADER_BYTES);
  if (length !== payload.byteLength || checksum !== rustIntegratedRuntimeWireChecksumV1(payload)) throw new Error("content wire length or checksum mismatch");
  return payload;
}

export function encodeRustContentInstallPageV1(page: RustContentInstallPageV1) {
  if (page.manifestSchema !== RUST_CONTENT_MANIFEST_SCHEMA || page.pageCount < 1 || page.pageCount > RUST_CONTENT_INSTALL_MAX_PAGES_V1
    || page.pageIndex < 0 || page.pageIndex >= page.pageCount || page.artifacts.length < 1
    || page.artifacts.length > RUST_CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1) throw new Error("content install page shape is invalid");
  return wrapContentPacket(CONTENT_PAGE_MAGIC, contentPageBody(page));
}

export function decodeRustContentInstallPageV1(packet: Uint8Array): RustContentInstallPageV1 {
  const reader = new ContentWireReader(unwrapContentPacket(packet, CONTENT_PAGE_MAGIC));
  const installId = reader.string(); const manifestSchema = reader.u16(); const sourceRevision = reader.string(); const manifestHash = reader.hash();
  const domains = readContentDomains(reader); const pageIndex = reader.u32(); const pageCount = reader.u32(); const count = reader.u32();
  if (count < 1 || count > RUST_CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1) throw new Error("content install artifact count is invalid");
  const artifacts = Object.freeze(Array.from({ length: count }, () => readContentArtifact(reader))); reader.finish();
  return Object.freeze({ installId, manifestSchema, sourceRevision, manifestHash, domains, pageIndex, pageCount, artifacts });
}

export function encodeRustContentInstallReceiptV1(receipt: RustContentInstallReceiptV1) {
  const writer = new ContentWireWriter();
  writer.u8(receipt.status === "staged" ? 0 : 1); writer.string(receipt.installId); writer.string(receipt.sourceRevision); writer.hash(receipt.manifestHash);
  writeContentDomains(writer, receipt.domains); writer.u32(receipt.acceptedPages); writer.u32(receipt.pageCount); writer.u32(receipt.acceptedEntries);
  writer.u32(receipt.installedEntries); writer.u64(receipt.installedBytes);
  return wrapContentPacket(CONTENT_RECEIPT_MAGIC, writer.finish());
}

export function decodeRustContentInstallReceiptV1(packet: Uint8Array): RustContentInstallReceiptV1 {
  const reader = new ContentWireReader(unwrapContentPacket(packet, CONTENT_RECEIPT_MAGIC));
  const tag = reader.u8(); if (tag > 1) throw new Error("content install receipt status is invalid");
  const result = Object.freeze({
    status: tag === 0 ? "staged" as const : "installed" as const,
    installId: reader.string(), sourceRevision: reader.string(), manifestHash: reader.hash(), domains: readContentDomains(reader),
    acceptedPages: reader.u32(), pageCount: reader.u32(), acceptedEntries: reader.u32(), installedEntries: reader.u32(), installedBytes: reader.u64(),
  });
  reader.finish();
  if (result.pageCount < 1 || result.acceptedPages > result.pageCount
    || (result.status === "installed" && (result.acceptedPages !== result.pageCount || result.installedEntries !== result.acceptedEntries))) {
    throw new Error("content install receipt counters are inconsistent");
  }
  return result;
}

export function createRustContentInstallPlanV1(bundle: RustProductionContentBundle): RustContentInstallPlanV1 {
  if (!bundle.manifest || bundle.blockers.length || !bundle.artifacts.length) throw new RustContentCompilationError(rustContentAuditReport(bundle, bundle.manifest?.sourceRevision ?? "invalid"));
  const installId = `install:${bundle.manifest.manifestHash}`;
  const template = {
    installId, manifestSchema: bundle.manifest.schemaVersion, sourceRevision: bundle.manifest.sourceRevision,
    manifestHash: bundle.manifest.manifestHash, domains: bundle.manifest.domains,
  } as const;
  const fixedBodyBytes = contentPageBody({ ...template, pageIndex: 0, pageCount: 1, artifacts: [] }).byteLength;
  const groups: RustContentArtifact[][] = [];
  let current: RustContentArtifact[] = []; let currentBytes = fixedBodyBytes;
  for (const artifact of bundle.artifacts) {
    const writer = new ContentWireWriter(); writeContentArtifact(writer, artifact); const bytes = writer.finish().byteLength;
    if (bytes + fixedBodyBytes + CONTENT_DOMAIN_HEADER_BYTES > RUST_CONTENT_INSTALL_PAGE_BUDGET_V1) throw new Error(`content artifact ${artifact.domain}:${artifact.id} exceeds the coarse page budget`);
    if (current.length && (current.length >= RUST_CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1
      || currentBytes + bytes + CONTENT_DOMAIN_HEADER_BYTES > RUST_CONTENT_INSTALL_PAGE_BUDGET_V1)) {
      groups.push(current); current = []; currentBytes = fixedBodyBytes;
    }
    current.push(artifact); currentBytes += bytes;
  }
  if (current.length) groups.push(current);
  if (!groups.length || groups.length > RUST_CONTENT_INSTALL_MAX_PAGES_V1) throw new Error("content bundle requires too many coarse pages");
  const pages = groups.map((artifacts, pageIndex) => {
    const page = Object.freeze({ ...template, pageIndex, pageCount: groups.length, artifacts: Object.freeze(artifacts) });
    const payload = encodeRustContentInstallPageV1(page);
    if (payload.byteLength > RUST_CONTENT_INSTALL_PAGE_BUDGET_V1) throw new Error("content page exceeds its declared budget");
    return Object.freeze({ page, payload });
  });
  return Object.freeze({ installId, manifestHash: bundle.manifest.manifestHash, pages: Object.freeze(pages) });
}
