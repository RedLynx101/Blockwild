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
import {
  ARCHIVE_SHELF_BLOCKS,
  BLOCKS,
  CULTIVATED_FLOWERS,
  ITEMS,
  ORDINARY_FLOWERS,
  RECIPES,
  SMELTING,
  BlockId,
  Item,
  isBedBlock,
  itemForBlock,
  type BlockDefinition,
  type ItemCode,
} from "./data";
import { isDirectionallyPlacedBlock } from "./block-facing";
import { doorItem, isDoorBlock } from "./doors";
import { canTill, isTreeLogBlock, plantingResult } from "./farming";
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
import {
  BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2,
  RENDER_PRESENTATION_CATALOG_ID_V1,
  RENDER_PRESENTATION_CATALOG_SCHEMA_ID_V1,
  RENDER_PRESENTATION_CATALOG_SCHEMA_V2,
} from "./rust-render-presentation-profile.ts";

export const RUST_CONTENT_MANIFEST_SCHEMA = 1 as const;
export const RUST_METADATA_STORE_SCHEMA = 1 as const;
export const MAX_RUST_CONTENT_ENTRIES = 32_768;
export const MAX_RUST_CONTENT_BYTES = 256 * 1024;
export const MAX_RUST_CONTENT_EXTENSION_BYTES = 64 * 1024;
export const MAX_RUST_CONTENT_ALIASES = 16;
export const RUST_BLOCK_ACTION_CATALOG_ID = "block-actions" as const;
export const RUST_BLOCK_ACTION_CATALOG_SCHEMA = 2 as const;
export const RUST_BLOCK_ACTION_RNG_SCALE = 1_000_000 as const;
export const RUST_ACTION_PROMOTION_REPORT_SCHEMA_V1 = 1 as const;
export const RUST_ACTION_PROMOTION_RUNTIME_SEMANTIC_FEATURE_ID_V1 = "block-action-runtime-semantics-v1" as const;
export const RUST_ACTION_PROMOTION_RNG_SEMANTICS_VERSION_ID_V1 = "block-action-rng-semantics-v1" as const;
export const MAX_RUST_ACTION_PROMOTION_BLOCKER_RECORDS_V1 = 64;
export const MAX_RUST_ACTION_PROMOTION_AFFECTED_BLOCK_IDS_V1 = 4_096;
export const MAX_RUST_ACTION_PROMOTION_TOTAL_AFFECTED_BLOCK_IDS_V1 = 65_536;

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

export type RustActionPromotionBlockerScopeV1 = "global" | "profile";
export type RustActionPromotionDispositionV1 = "implementation-gap" | "content-unresolved" | "runtime-context" | "transient";
export type RustActionPromotionSupportLevelV1 = "legacy-unproven" | "declared-blocked" | "declared-ready";

export type RustActionPromotionBlockerRecordV1 = Readonly<{
  scope: RustActionPromotionBlockerScopeV1;
  blockerId: string;
  disposition: RustActionPromotionDispositionV1;
  affectedBlockIds: readonly number[];
  affectedBlockCount: number;
}>;

/** Immutable content support evidence. This is deliberately not a capability. */
export type RustActionPromotionReportV1 = Readonly<{
  schemaVersion: 1;
  manifestHash: string;
  installedRegistryHash: string | null;
  blockActionCatalogSchemaVersion: number;
  blockActionCatalogContentVersion: number;
  blockActionCatalogBlobHash: string;
  rngSemanticsVersionId: string | null;
  rngSemanticsHash: string | null;
  runtimeSemanticFeatureId: string;
  supportLevel: RustActionPromotionSupportLevelV1;
  blockers: readonly RustActionPromotionBlockerRecordV1[];
  reportHash: string;
}>;

export type RustActionPromotionReportErrorCodeV1 =
  | "unsupported-schema" | "unknown-blocker" | "classification" | "capacity" | "ordering"
  | "descriptor-mismatch" | "hash-mismatch";

export type RustActionPromotionReportErrorV1 = Readonly<{
  code: RustActionPromotionReportErrorCodeV1;
  path: string;
  expected: string;
  actual: string;
}>;

export class RustActionPromotionReportCompilationErrorV1 extends Error {
  readonly errors: readonly RustActionPromotionReportErrorV1[];

  constructor(errors: readonly RustActionPromotionReportErrorV1[]) {
    super(`Rust action-promotion report rejected with ${errors.length} error(s).`);
    this.name = "RustActionPromotionReportCompilationErrorV1";
    this.errors = errors;
  }
}

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

export const RUST_BLOCK_ACTION_RNG_SEMANTICS_V2 = Object.freeze({
  algorithm: "xorshift32",
  seedDerivation: "blockwild-seed-stream-v1",
  stream: "block-action-loot-v1",
  unit: "u32-open-upper-v1",
  ordering: "stable-profile-rule-order-v1",
  randomDropGate: "less-than-or-equal-v1",
  exclusiveSelection: "less-than-cumulative-v1",
  plantYieldClampMaximumMillionths: 999_900,
} as const);

export const RUST_BLOCK_ACTION_AUTHORITY_BLOCKERS_V2 = Object.freeze([
  "authoritative-rng-context-unbound",
  "dynamic-session-dispatch-runtime",
  "game-mode-host-custody-runtime",
  "legacy-computed-loot-source-runtime",
  "world-support-collision-runtime",
] as const);

export type RustBlockLootCountV2 = Readonly<
  | { kind: "constant"; value: number }
  | { kind: "uniform-inclusive"; minimum: number; maximum: number }
  | {
    kind: "shared-roll-formula";
    base: number;
    floorRollMultiplier: number;
    scytheBonus: number;
    thresholdBonuses: readonly Readonly<{ aboveMillionths: number; amount: number; scytheOnly: boolean }>[];
  }
>;

export type RustBlockLootRuleV2 = Readonly<{
  id: string;
  item: ItemCode;
  chanceMillionths: number;
  chanceModifier: "none" | "luck-adjusted-v1";
  /**
   * `random-drop-v1` consumes a gate draw even at probability one and, on
   * success, a second count draw even for a constant range. `shared-plant-yield`
   * consumes one draw for the complete harvest. `shared-exclusive` consumes
   * one strict cumulative-selection draw for the complete rule list.
   */
  rollScope: "none" | "random-drop-v1" | "shared-plant-yield" | "shared-exclusive";
  count: RustBlockLootCountV2;
}>;

export type RustBlockHarvestIntentV2 = Readonly<{
  replacementWithoutScythe: BlockId;
  replacementWithScythe: BlockId;
  replantedWithoutScythe: boolean;
  replantedWithScythe: boolean;
  preserveCultivated: true;
  scytheDurabilityCost: number;
}>;

export type RustBlockPlantingRuleV2 = Readonly<{
  item: ItemCode;
  above: "air" | "replaceable-dry" | "water-source";
  resultBlock: BlockId;
}>;

type RustBlockLootV2 = Readonly<{
  mode: "none" | "all" | "exclusive";
  selfDropMode: "absent" | "contextual" | "mapped-item";
  silkTouch: "not-authored";
  rules: readonly RustBlockLootRuleV2[];
}>;

type PlantHarvestSpec = Readonly<{
  replacementWithoutScythe: BlockId;
  replacementWithScythe: BlockId;
  replantedWithoutScythe: boolean;
  replantedWithScythe: boolean;
  rules: readonly RustBlockLootRuleV2[];
}>;

const constantCount = (value: number): RustBlockLootCountV2 => ({ kind: "constant", value });
const uniformCount = (minimum: number, maximum: number): RustBlockLootCountV2 => ({ kind: "uniform-inclusive", minimum, maximum });
const sharedCount = (
  base: number,
  floorRollMultiplier: number,
  scytheBonus = 0,
  thresholdBonuses: readonly Readonly<{ aboveMillionths: number; amount: number; scytheOnly?: boolean }>[] = [],
): RustBlockLootCountV2 => ({
  kind: "shared-roll-formula",
  base,
  floorRollMultiplier,
  scytheBonus,
  thresholdBonuses: thresholdBonuses.map((bonus) => ({ ...bonus, scytheOnly: bonus.scytheOnly === true })),
});

const lootRule = (
  id: string,
  item: ItemCode,
  count: RustBlockLootCountV2,
  options: Readonly<{
    chanceMillionths?: number;
    chanceModifier?: RustBlockLootRuleV2["chanceModifier"];
    rollScope?: RustBlockLootRuleV2["rollScope"];
  }> = {},
): RustBlockLootRuleV2 => ({
  id,
  item,
  chanceMillionths: options.chanceMillionths ?? RUST_BLOCK_ACTION_RNG_SCALE,
  chanceModifier: options.chanceModifier ?? "none",
  rollScope: options.rollScope ?? "none",
  count,
});

const plantRule = (id: string, item: ItemCode, count: RustBlockLootCountV2): RustBlockLootRuleV2 => lootRule(
  id,
  item,
  count,
  { rollScope: "shared-plant-yield" },
);

function plantHarvestSpec(block: BlockId): PlantHarvestSpec | null {
  const crop = (
    replacement: BlockId,
    rules: readonly RustBlockLootRuleV2[],
  ): PlantHarvestSpec => ({
    replacementWithoutScythe: replacement,
    replacementWithScythe: replacement,
    replantedWithoutScythe: true,
    replantedWithScythe: true,
    rules,
  });
  if (block === BlockId.WheatCrop) return crop(BlockId.WheatSprout, [
    plantRule("wheat", Item.Wheat, sharedCount(2, 2, 1)),
    plantRule("wheat-seeds", Item.WheatSeeds, sharedCount(1, 0, 0, [
      { aboveMillionths: 560_000, amount: 1 },
      { aboveMillionths: 820_000, amount: 1, scytheOnly: true },
    ])),
  ]);
  if (block === BlockId.MoonriceCrop) return crop(BlockId.MoonriceSprout, [
    plantRule("moonrice", Item.Moonrice, sharedCount(2, 3, 1)),
    plantRule("moonrice-seeds", Item.MoonriceSeeds, sharedCount(1, 0, 0, [{ aboveMillionths: 500_000, amount: 1 }])),
  ]);
  if (block === BlockId.SunrootCrop) return crop(BlockId.SunrootSprout, [
    plantRule("sunroot", Item.Sunroot, sharedCount(2, 3, 1)),
    plantRule("sunroot-starts", Item.SunrootStarts, sharedCount(1, 0, 0, [{ aboveMillionths: 620_000, amount: 1 }])),
  ]);
  if (block === BlockId.PeppermintCrop) return crop(BlockId.PeppermintSprout, [
    plantRule("peppermint-cane", Item.PeppermintCane, sharedCount(2, 3, 1)),
    plantRule("peppermint-starts", Item.PeppermintSeeds, sharedCount(1, 0, 0, [{ aboveMillionths: 580_000, amount: 1 }])),
  ]);
  if (block === BlockId.CocoaCrop) return crop(BlockId.CocoaSprout, [
    plantRule("cocoa-nib", Item.CocoaNib, sharedCount(2, 3, 1)),
    plantRule("cocoa-seeds", Item.CocoaSeeds, sharedCount(1, 0, 0, [{ aboveMillionths: 620_000, amount: 1 }])),
  ]);
  if (block === BlockId.CottonCrop) return crop(BlockId.CottonSprout, [
    plantRule("cotton-boll", Item.CottonBoll, sharedCount(2, 3, 1)),
    plantRule("cotton-seeds", Item.CottonSeeds, sharedCount(1, 0, 0, [{ aboveMillionths: 550_000, amount: 1 }])),
  ]);
  if (block === BlockId.SunCarrotCrop) return crop(BlockId.SunCarrotSprout, [
    plantRule("sun-carrot", Item.SunCarrot, sharedCount(2, 2, 1)),
    plantRule("sun-carrot-seeds", Item.SunCarrotSeeds, sharedCount(1, 0, 0, [{ aboveMillionths: 620_000, amount: 1 }])),
  ]);
  if (block === BlockId.BluepodCrop) return crop(BlockId.BluepodSprout, [
    plantRule("bluepod-beans", Item.BluepodBeans, sharedCount(2, 3, 1)),
    plantRule("bluepod-seeds", Item.BluepodSeeds, sharedCount(1, 0, 0, [{ aboveMillionths: 580_000, amount: 1 }])),
  ]);
  const stable = (replacement: BlockId, replanted: boolean, rules: readonly RustBlockLootRuleV2[]): PlantHarvestSpec => ({
    replacementWithoutScythe: replacement,
    replacementWithScythe: replacement,
    replantedWithoutScythe: replanted,
    replantedWithScythe: replanted,
    rules,
  });
  if (block === BlockId.ShellfruitCrop) return stable(BlockId.ShellfruitYoung, true, [
    plantRule("shellfruit", Item.Shellfruit, sharedCount(2, 3, 1)),
  ]);
  if (block === BlockId.MoonberryBushRipe) return stable(BlockId.MoonberryBush, true, [
    plantRule("moonberry", Item.Berry, sharedCount(2, 3, 1)),
  ]);
  if (block === BlockId.SunberryBushRipe) return stable(BlockId.SunberryBush, true, [
    plantRule("sunberry", Item.Sunberry, sharedCount(2, 2, 1)),
  ]);
  if (block === BlockId.AppleFruit) return stable(BlockId.Air, false, [plantRule("apple", Item.Apple, constantCount(1))]);
  if (block === BlockId.FrostpearFruit) return stable(BlockId.Air, false, [plantRule("frostpear", Item.Frostpear, constantCount(1))]);
  const cultivatedIndex = CULTIVATED_FLOWERS.indexOf(block);
  if (cultivatedIndex >= 0) return stable(ORDINARY_FLOWERS[cultivatedIndex], true, [
    plantRule("cultivated-flower", itemForBlock(ORDINARY_FLOWERS[cultivatedIndex]), sharedCount(4, 4, 2)),
  ]);
  const wild: Readonly<Partial<Record<BlockId, Readonly<{ item: ItemCode; count: RustBlockLootCountV2; replacement?: BlockId }>>>> = {
    [BlockId.Saltbrush]: { item: Item.SaltbrushSprig, count: sharedCount(1, 2) },
    [BlockId.CoastAster]: { item: Item.CoastAsterPetal, count: sharedCount(2, 2) },
    [BlockId.SakuraBloom]: { item: Item.SakuraBloomItem, count: sharedCount(1, 2) },
    [BlockId.Dreamblossom]: { item: Item.DreamblossomItem, count: sharedCount(1, 2) },
    [BlockId.LanternLotus]: { item: Item.LanternLotusItem, count: sharedCount(1, 2) },
    [BlockId.RainveilFern]: { item: Item.RainveilFernItem, count: constantCount(1) },
    [BlockId.GumdropBush]: { item: Item.Gumdrop, count: sharedCount(1, 3) },
    [BlockId.PeppermintTuft]: { item: Item.PeppermintCane, count: sharedCount(1, 2) },
    [BlockId.LollipopOrchid]: { item: Item.LollipopPetal, count: sharedCount(1, 2) },
    [BlockId.MarshmallowShrub]: { item: Item.MarshmallowTuft, count: sharedCount(1, 2) },
    [BlockId.LumenKelp]: { item: Item.LumenKelpFrond, count: sharedCount(1, 2), replacement: BlockId.Water },
    [BlockId.StarCoral]: { item: Item.StarCoralShard, count: sharedCount(1, 2), replacement: BlockId.Water },
    [BlockId.AbyssBloom]: { item: Item.AbyssBloomNectar, count: constantCount(1), replacement: BlockId.Water },
    [BlockId.Tidevine]: { item: Item.TidevineFiber, count: sharedCount(1, 3), replacement: BlockId.Water },
  };
  const entry = wild[block];
  return entry ? stable(
    entry.replacement ?? BlockId.Air,
    false,
    [plantRule("wild-plant", entry.item, entry.count)],
  ) : null;
}

const GRASS_TO_DIRT = new Set<BlockId>([
  BlockId.Grass, BlockId.SnowyGrass, BlockId.SavannaGrass, BlockId.SwampGrass, BlockId.JungleGrass, BlockId.SakuraGrass,
]);
const STONE_TO_COBBLE = new Set<BlockId>([BlockId.Stone, BlockId.Deepstone, BlockId.Basalt]);
const ORDINARY_LEAVES = new Set<BlockId>([
  BlockId.WildwoodLeaves, BlockId.PineLeaves, BlockId.BirchLeaves, BlockId.BloomLeaves,
  BlockId.JungleLeaves, BlockId.SakuraLeaves, BlockId.CandywoodLeaves,
]);
const SAPLING_BLOCKS = new Set<BlockId>([
  BlockId.WildwoodSapling, BlockId.JungleSapling, BlockId.SakuraSapling, BlockId.CandywoodSapling,
]);
const FENCE_GATE_BLOCKS = new Set<BlockId>([
  BlockId.FenceGateNorthSouthClosed, BlockId.FenceGateEastWestClosed,
  BlockId.FenceGateNorthSouthOpen, BlockId.FenceGateEastWestOpen,
]);
const DYNAMIC_STATE_BLOCKS = new Set<BlockId>([
  BlockId.Furnace, BlockId.WheatMill, BlockId.Chest, BlockId.Apiary, BlockId.WildBeehive,
  BlockId.ChrysalisLoom, BlockId.CaptureOrbRack, BlockId.CreatureHealer, BlockId.FieldPerch,
  BlockId.AlchemyStand, BlockId.Distillery, BlockId.Sugarworks, BlockId.GolemForge,
  BlockId.ButterflyExhibit, BlockId.GlassAquarium, BlockId.TomeDisplay, ...ARCHIVE_SHELF_BLOCKS,
]);

function blockLoot(definition: BlockDefinition): RustBlockLootV2 {
  const type = definition.id;
  if (type === BlockId.Air || type === BlockId.Bedrock || definition.liquid !== undefined || type === BlockId.WildBeehive) {
    return { mode: "none", selfDropMode: "absent", silkTouch: "not-authored", rules: [] };
  }
  if (isDoorBlock(type)) return {
    mode: "all", selfDropMode: "contextual", silkTouch: "not-authored",
    rules: [lootRule("paired-door", doorItem(type), constantCount(1))],
  };
  if (isBedBlock(type)) return {
    mode: "all", selfDropMode: "contextual", silkTouch: "not-authored",
    rules: [lootRule("paired-bed", Item.WildwoodBed, constantCount(1))],
  };
  const harvest = plantHarvestSpec(type);
  if (harvest) return { mode: "all", selfDropMode: "contextual", silkTouch: "not-authored", rules: harvest.rules };
  if (type === BlockId.SugarplumGrass) return { mode: "all", selfDropMode: "contextual", silkTouch: "not-authored", rules: [lootRule("sugar-soil", Item.SugarSoilBlock, constantCount(1))] };
  if (GRASS_TO_DIRT.has(type)) return { mode: "all", selfDropMode: "contextual", silkTouch: "not-authored", rules: [lootRule("soil", BlockId.Dirt, constantCount(1))] };
  if (STONE_TO_COBBLE.has(type)) return { mode: "all", selfDropMode: "contextual", silkTouch: "not-authored", rules: [lootRule("cobblestone", BlockId.Cobblestone, constantCount(1))] };
  const rangedOre: Readonly<Partial<Record<BlockId, readonly [ItemCode, number, number]>>> = {
    [BlockId.CoalOre]: [Item.Coal, 1, 2],
    [BlockId.IronOre]: [Item.RawIron, 1, 4],
    [BlockId.CopperOre]: [Item.RawCopper, 1, 4],
    [BlockId.CrystalOre]: [Item.CrystalShard, 1, 2],
    [BlockId.LivingVein]: [Item.VeinmetalFlake, 1, 2],
  };
  const ore = rangedOre[type];
  if (ore) return {
    mode: "all", selfDropMode: "contextual", silkTouch: "not-authored",
    rules: [lootRule("ore", ore[0], uniformCount(ore[1], ore[2]), { rollScope: "random-drop-v1" })],
  };
  if (type === BlockId.GoldOre) return { mode: "all", selfDropMode: "contextual", silkTouch: "not-authored", rules: [lootRule("raw-gold", Item.RawGold, constantCount(1))] };
  if (type === BlockId.VeinmetalHeart) return {
    mode: "all", selfDropMode: "contextual", silkTouch: "not-authored",
    rules: [
      lootRule("living-node", Item.LivingNode, constantCount(1)),
      lootRule("veinmetal-flake", Item.VeinmetalFlake, uniformCount(2, 4), { rollScope: "random-drop-v1" }),
    ],
  };
  if (ORDINARY_LEAVES.has(type)) {
    const sapling = type === BlockId.JungleLeaves ? Item.RainveilSapling
      : type === BlockId.SakuraLeaves ? Item.SakurabloomSapling
        : type === BlockId.CandywoodLeaves ? Item.CandywoodSaplingItem : BlockId.WildwoodSapling;
    return {
      mode: "all", selfDropMode: "contextual", silkTouch: "not-authored",
      rules: [
        lootRule("stick", Item.Stick, uniformCount(1, 2), { chanceMillionths: 220_000, chanceModifier: "luck-adjusted-v1", rollScope: "random-drop-v1" }),
        lootRule("sapling", sapling, constantCount(1), { chanceMillionths: 55_000, chanceModifier: "luck-adjusted-v1", rollScope: "random-drop-v1" }),
        lootRule("apple", Item.Apple, constantCount(1), { chanceMillionths: 60_000, chanceModifier: "luck-adjusted-v1", rollScope: "random-drop-v1" }),
      ],
    };
  }
  if (type === BlockId.AppleLeaves || type === BlockId.FrostpearLeaves) return {
    mode: "all", selfDropMode: "contextual", silkTouch: "not-authored",
    rules: [
      lootRule("stick", Item.Stick, uniformCount(1, 2), { chanceMillionths: 200_000, chanceModifier: "luck-adjusted-v1", rollScope: "random-drop-v1" }),
      lootRule(type === BlockId.AppleLeaves ? "apple" : "frostpear", type === BlockId.AppleLeaves ? Item.Apple : Item.Frostpear, constantCount(1), {
        chanceMillionths: type === BlockId.AppleLeaves ? 80_000 : 85_000,
        chanceModifier: "luck-adjusted-v1",
        rollScope: "random-drop-v1",
      }),
    ],
  };
  if (type === BlockId.TallGrass || definition.verticalConnectGroup === "double-tall-grass") return {
    mode: "all", selfDropMode: "contextual", silkTouch: "not-authored",
    rules: [lootRule("fiber", Item.Fiber, constantCount(1), { chanceMillionths: 350_000, chanceModifier: "luck-adjusted-v1", rollScope: "random-drop-v1" })],
  };
  if (type === BlockId.Gravel) return {
    mode: "exclusive", selfDropMode: "contextual", silkTouch: "not-authored",
    rules: [
      lootRule("flint", Item.Flint, constantCount(1), { chanceMillionths: 160_000, rollScope: "shared-exclusive" }),
      lootRule("gravel", BlockId.Gravel, constantCount(1), { chanceMillionths: 840_000, rollScope: "shared-exclusive" }),
    ],
  };
  if (type === BlockId.WheatSprout || type === BlockId.WheatYoung) return { mode: "all", selfDropMode: "contextual", silkTouch: "not-authored", rules: [lootRule("wheat-seeds", Item.WheatSeeds, constantCount(1))] };
  if (type === BlockId.MoonberryShoot || type === BlockId.MoonberryBush) return { mode: "all", selfDropMode: "contextual", silkTouch: "not-authored", rules: [lootRule("moonberry", Item.Berry, constantCount(1))] };
  if (type === BlockId.SunberryShoot || type === BlockId.SunberryBush) return { mode: "all", selfDropMode: "contextual", silkTouch: "not-authored", rules: [lootRule("sunberry", Item.Sunberry, constantCount(1))] };
  if (type === BlockId.AppleSapling) return { mode: "all", selfDropMode: "contextual", silkTouch: "not-authored", rules: [lootRule("apple", Item.Apple, constantCount(1))] };
  if (type === BlockId.FrostpearSapling) return { mode: "all", selfDropMode: "contextual", silkTouch: "not-authored", rules: [lootRule("frostpear", Item.Frostpear, constantCount(1))] };
  const item = type === BlockId.Torch || definition.shape === "torch" ? BlockId.Torch : itemForBlock(type);
  if (ITEMS[item] === undefined) return { mode: "none", selfDropMode: "absent", silkTouch: "not-authored", rules: [] };
  return { mode: "all", selfDropMode: "mapped-item", silkTouch: "not-authored", rules: [lootRule("mapped-item", item, constantCount(1))] };
}

function plantingRulesForBlock(soil: BlockId): RustBlockPlantingRuleV2[] {
  const representatives = [
    ["air", BlockId.Air],
    ["replaceable-dry", BlockId.TallGrass],
    ["water-source", BlockId.Water],
  ] as const;
  const rules: RustBlockPlantingRuleV2[] = [];
  for (const item of Object.values(ITEMS).filter((entry) => entry.useKind === "plant").sort((left, right) => left.id - right.id)) {
    for (const [above, aboveBlock] of representatives) {
      const planted = plantingResult(item.id, soil, aboveBlock);
      if (planted) rules.push({ item: item.id, above, resultBlock: planted.block });
    }
  }
  return rules;
}

const PLACEMENT_ITEMS_BY_BLOCK = new Map<BlockId, ItemCode[]>();
for (const item of Object.values(ITEMS)) {
  if (item.placeBlock === undefined) continue;
  const items = PLACEMENT_ITEMS_BY_BLOCK.get(item.placeBlock) ?? [];
  items.push(item.id);
  PLACEMENT_ITEMS_BY_BLOCK.set(item.placeBlock, items);
}
for (const items of PLACEMENT_ITEMS_BY_BLOCK.values()) items.sort((left, right) => left - right);

function placementIntent(definition: BlockDefinition, placementItems: readonly ItemCode[]) {
  if (!placementItems.length) return "none" as const;
  if (definition.shape === "torch") return "attached-torch" as const;
  if (isDoorBlock(definition.id)) return "paired-door" as const;
  if (isBedBlock(definition.id)) return "paired-bed" as const;
  if (FENCE_GATE_BLOCKS.has(definition.id)) return "oriented-gate" as const;
  if (definition.shape === "aquarium" || definition.shape === "exhibit") return "bounded-network" as const;
  if (SAPLING_BLOCKS.has(definition.id)) return "sapling" as const;
  return isDirectionallyPlacedBlock(definition.id) ? "directional" as const : "direct" as const;
}

function interactionIntents(definition: BlockDefinition, plantingRules: readonly RustBlockPlantingRuleV2[]) {
  const intents: string[] = [];
  if (plantHarvestSpec(definition.id)) intents.push("harvest");
  if (canTill(definition.id, BlockId.Air)) intents.push("till");
  if (plantingRules.length) intents.push("plant");
  if (definition.liquid !== undefined) intents.push("bucket");
  if (definition.id === BlockId.Water) intents.push("fill-bottle");
  if (FENCE_GATE_BLOCKS.has(definition.id)) intents.push("toggle-gate");
  if (definition.id === BlockId.WildwoodFence || FENCE_GATE_BLOCKS.has(definition.id)) intents.push("hitch-lead");
  if (isDoorBlock(definition.id)) intents.push("toggle-door");
  if (isBedBlock(definition.id)) intents.push("sleep-session");
  if (definition.shape === "chair" || definition.shape === "stool") intents.push("seat");
  const sessions: Readonly<Partial<Record<BlockId, string>>> = {
    [BlockId.CraftingTable]: "crafting-session",
    [BlockId.Furnace]: "furnace-session",
    [BlockId.WheatMill]: "wheat-mill-session",
    [BlockId.Chest]: "chest-session",
    [BlockId.Apiary]: "apiary-session",
    [BlockId.WildBeehive]: "apiary-session",
    [BlockId.ChrysalisLoom]: "morph-loom-session",
    [BlockId.CaptureOrbRack]: "orb-rack-session",
    [BlockId.CreatureHealer]: "healing-station-session",
    [BlockId.GlassAquarium]: "aquarium-session",
    [BlockId.FieldPerch]: "field-perch-session",
    [BlockId.WaygridVaultTerminal]: "waygrid-items-session",
    [BlockId.WaygridCreatureArchive]: "waygrid-creatures-session",
    [BlockId.GolemForge]: "golem-forge-session",
    [BlockId.ButterflyExhibit]: "exhibit-session",
    [BlockId.CartographyTable]: "cartography-session",
    [BlockId.AlchemyStand]: "alchemy-session",
    [BlockId.Distillery]: "distillery-session",
    [BlockId.Sugarworks]: "sugarworks-session",
    [BlockId.Wayshrine]: "map-session",
    [BlockId.DraconicIncubator]: "incubator-session",
    [BlockId.DeepgearLift]: "lift",
    [BlockId.TomeDisplay]: "tome-display-session",
    [BlockId.CaveMarker]: "wayfinder-session",
  };
  if (ARCHIVE_SHELF_BLOCKS.includes(definition.id)) intents.push("archive-shelf-session");
  const session = sessions[definition.id];
  if (session) intents.push(session);
  return intents;
}

function authorityBlockers(definition: BlockDefinition, loot: RustBlockLootV2) {
  const blockers: string[] = [];
  if (isTreeLogBlock(definition.id)) blockers.push("rooted-tree-discovery-runtime");
  if (isDoorBlock(definition.id) || isBedBlock(definition.id)) blockers.push("paired-world-state-runtime");
  if (definition.waterlogged || definition.id === BlockId.PeppermintTuft || definition.verticalConnectGroup === "double-tall-grass") blockers.push("column-world-state-runtime");
  if (definition.shape === "aquarium" || definition.shape === "exhibit") blockers.push("network-topology-state-runtime");
  if (DYNAMIC_STATE_BLOCKS.has(definition.id)) blockers.push("dynamic-block-state-runtime");
  if (loot.rules.some((rule) => rule.chanceModifier === "luck-adjusted-v1")) blockers.push("player-luck-context-runtime");
  if (loot.rules.some((rule) => rule.rollScope !== "none")) blockers.push("authoritative-rng-context-unbound");
  if (definition.liquid !== undefined) blockers.push("liquid-source-state-runtime");
  const mappedItem = itemForBlock(definition.id);
  if (loot.mode === "none" && definition.id !== BlockId.Air && definition.id !== BlockId.Bedrock
    && definition.liquid === undefined && definition.id !== BlockId.WildBeehive && ITEMS[mappedItem] === undefined) {
    blockers.push("legacy-loot-item-reference-unresolved");
  }
  return [...new Set(blockers)].sort();
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

export function blockwildBlockActionCatalogV2() {
  const profiles = Object.values(BLOCKS)
    .sort((left, right) => left.id - right.id)
    .map((definition) => {
      const mappedItem = itemForBlock(definition.id);
      const loot = blockLoot(definition);
      const harvest = plantHarvestSpec(definition.id);
      const plantingRules = plantingRulesForBlock(definition.id);
      const placementItems = PLACEMENT_ITEMS_BY_BLOCK.get(definition.id) ?? [];
      const interactions = interactionIntents(definition, plantingRules);
      const profileAuthorityBlockers = authorityBlockers(definition, loot);
      const blocked = definition.id === BlockId.Air || definition.id === BlockId.Bedrock || definition.liquid !== undefined;
      const rootedTree = isTreeLogBlock(definition.id);
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
        breakProfile: {
          replacement: blocked ? "blocked"
            : isDoorBlock(definition.id) || isBedBlock(definition.id) ? "paired-air"
              : definition.waterlogged ? "column-water"
                : definition.id === BlockId.PeppermintTuft || definition.verticalConnectGroup === "double-tall-grass" ? "column-air"
                  : rootedTree ? "rooted-tree-or-air"
                    : "air",
          durabilityCost: blocked ? { kind: "none" }
            : rootedTree ? { kind: "rooted-tree-log-count", minimum: 1, divisor: 4, rounding: "ceiling" }
              : { kind: "constant", amount: 1 },
          wrongTool: "break-no-loot",
          contextualOverride: rootedTree ? "rooted-tree-fall-runtime" : "none",
          loot: { ...loot, rules: loot.rules.map((rule, ordinal) => ({ ...rule, ordinal })) },
        },
        ...(harvest === null ? {} : { harvestIntent: {
          replacementWithoutScythe: harvest.replacementWithoutScythe,
          replacementWithScythe: harvest.replacementWithScythe,
          replantedWithoutScythe: harvest.replantedWithoutScythe,
          replantedWithScythe: harvest.replantedWithScythe,
          preserveCultivated: true,
          scytheDurabilityCost: 1,
        } satisfies RustBlockHarvestIntentV2 }),
        placementIntent: placementIntent(definition, placementItems),
        ...(placementItems.length ? { placementItems } : {}),
        ...(interactions.length ? { interactionIntents: interactions } : {}),
        ...(plantingRules.length ? { plantingRules } : {}),
        ...(profileAuthorityBlockers.length ? { authorityBlockers: profileAuthorityBlockers } : {}),
      };
    });
  return {
    schema: RUST_BLOCK_ACTION_CATALOG_SCHEMA,
    rngSemantics: RUST_BLOCK_ACTION_RNG_SEMANTICS_V2,
    authorityBlockers: RUST_BLOCK_ACTION_AUTHORITY_BLOCKERS_V2,
    profiles,
  } as const;
}

/** Compatibility name retained for callers; it now returns the explicit V2 catalog. */
export const blockwildBlockActionCatalogV1 = blockwildBlockActionCatalogV2;

const ACTION_PROMOTION_DISPOSITIONS_V1 = Object.freeze({
  "authoritative-rng-context-unbound": "runtime-context",
  "column-world-state-runtime": "runtime-context",
  "dynamic-block-state-runtime": "runtime-context",
  "dynamic-session-dispatch-runtime": "implementation-gap",
  "game-mode-host-custody-runtime": "runtime-context",
  "legacy-block-action-catalog-schema-unproven": "content-unresolved",
  "legacy-computed-loot-source-runtime": "implementation-gap",
  "legacy-loot-item-reference-unresolved": "content-unresolved",
  "liquid-source-state-runtime": "runtime-context",
  "network-topology-state-runtime": "runtime-context",
  "paired-world-state-runtime": "runtime-context",
  "player-luck-context-runtime": "runtime-context",
  "rooted-tree-discovery-runtime": "runtime-context",
  "world-support-collision-runtime": "runtime-context",
} satisfies Readonly<Record<string, RustActionPromotionDispositionV1>>);

type ActionPromotionCatalogV1 = Readonly<{
  schema: number;
  rngSemantics?: unknown;
  authorityBlockers?: unknown;
  profiles: readonly unknown[];
}>;

function actionPromotionErrorV1(
  code: RustActionPromotionReportErrorCodeV1,
  path: string,
  expected: string,
  actual: string,
): RustActionPromotionReportErrorV1 {
  return Object.freeze({ code, path, expected, actual });
}

function rejectActionPromotionV1(
  code: RustActionPromotionReportErrorCodeV1,
  path: string,
  expected: string,
  actual: unknown,
): never {
  throw new RustActionPromotionReportCompilationErrorV1([
    actionPromotionErrorV1(code, path, expected, String(actual)),
  ]);
}

function actionPromotionDispositionV1(blockerId: string): RustActionPromotionDispositionV1 | null {
  return ACTION_PROMOTION_DISPOSITIONS_V1[blockerId as keyof typeof ACTION_PROMOTION_DISPOSITIONS_V1] ?? null;
}

function actionPromotionRngSemanticsHashV1(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return rejectActionPromotionV1("descriptor-mismatch", "$.catalog.rngSemantics", "exact RNG semantics object", value);
  }
  const semantics = value as Record<string, unknown>;
  const expected = RUST_BLOCK_ACTION_RNG_SEMANTICS_V2;
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (semantics[key] !== expected[key]) {
      return rejectActionPromotionV1("descriptor-mismatch", `$.catalog.rngSemantics.${key}`, String(expected[key]), semantics[key]);
    }
  }
  if (Object.keys(semantics).sort().join("\u0000") !== Object.keys(expected).sort().join("\u0000")) {
    return rejectActionPromotionV1(
      "descriptor-mismatch",
      "$.catalog.rngSemantics",
      "exact RNG semantic fields",
      Object.keys(semantics).sort().join(","),
    );
  }
  const writer = new CanonicalHashWriter("blockwild.gameplay.block-action-rng-semantics.v1");
  writer.writeString(RUST_ACTION_PROMOTION_RNG_SEMANTICS_VERSION_ID_V1);
  writer.writeString(expected.algorithm);
  writer.writeString(expected.seedDerivation);
  writer.writeString(expected.stream);
  writer.writeString(expected.unit);
  writer.writeString(expected.ordering);
  writer.writeString(expected.randomDropGate);
  writer.writeString(expected.exclusiveSelection);
  writer.writeU64(BigInt(expected.plantYieldClampMaximumMillionths));
  return writer.finish();
}

function actionPromotionScopeTagV1(scope: RustActionPromotionBlockerScopeV1) { return scope === "global" ? 0 : 1; }
function actionPromotionDispositionTagV1(disposition: RustActionPromotionDispositionV1) {
  return disposition === "implementation-gap" ? 0 : disposition === "content-unresolved" ? 1
    : disposition === "runtime-context" ? 2 : 3;
}
function actionPromotionSupportTagV1(support: RustActionPromotionSupportLevelV1) {
  return support === "legacy-unproven" ? 0 : support === "declared-blocked" ? 1 : 2;
}

export function canonicalRustActionPromotionReportHashV1(report: Omit<RustActionPromotionReportV1, "reportHash">) {
  const writer = new CanonicalHashWriter("blockwild.gameplay.action-promotion-report.v1");
  writer.writeU16(report.schemaVersion);
  writer.writeBytes(hexToBytes(report.manifestHash));
  if (report.installedRegistryHash === null) writer.writeU16(0);
  else { writer.writeU16(1); writer.writeBytes(hexToBytes(report.installedRegistryHash)); }
  writer.writeU16(report.blockActionCatalogSchemaVersion);
  writer.writeU32(report.blockActionCatalogContentVersion);
  writer.writeBytes(hexToBytes(report.blockActionCatalogBlobHash));
  if (report.rngSemanticsVersionId === null || report.rngSemanticsHash === null) writer.writeU16(0);
  else {
    writer.writeU16(1);
    writer.writeString(report.rngSemanticsVersionId);
    writer.writeBytes(hexToBytes(report.rngSemanticsHash));
  }
  writer.writeString(report.runtimeSemanticFeatureId);
  writer.writeU16(actionPromotionSupportTagV1(report.supportLevel));
  writer.writeU64(BigInt(report.blockers.length));
  for (const blocker of report.blockers) {
    writer.writeU16(actionPromotionScopeTagV1(blocker.scope));
    writer.writeString(blocker.blockerId);
    writer.writeU16(actionPromotionDispositionTagV1(blocker.disposition));
    writer.writeU32(blocker.affectedBlockCount);
    writer.writeU64(BigInt(blocker.affectedBlockIds.length));
    for (const blockId of blocker.affectedBlockIds) writer.writeU16(blockId);
  }
  return writer.finish();
}

function validateActionPromotionHashV1(value: unknown, path: string, errors: RustActionPromotionReportErrorV1[]) {
  if (typeof value !== "string" || !/^[0-9a-f]{32}$/u.test(value)) {
    errors.push(actionPromotionErrorV1("descriptor-mismatch", path, "32 lowercase hexadecimal digits", String(value)));
  }
}

export function validateRustActionPromotionReportV1(report: RustActionPromotionReportV1) {
  const errors: RustActionPromotionReportErrorV1[] = [];
  if (report.schemaVersion !== RUST_ACTION_PROMOTION_REPORT_SCHEMA_V1) {
    errors.push(actionPromotionErrorV1("unsupported-schema", "$.schemaVersion", "1", String(report.schemaVersion)));
  }
  validateActionPromotionHashV1(report.manifestHash, "$.manifestHash", errors);
  if (report.installedRegistryHash !== null) validateActionPromotionHashV1(report.installedRegistryHash, "$.installedRegistryHash", errors);
  validateActionPromotionHashV1(report.blockActionCatalogBlobHash, "$.blockActionCatalogBlobHash", errors);
  if (report.rngSemanticsHash !== null) validateActionPromotionHashV1(report.rngSemanticsHash, "$.rngSemanticsHash", errors);
  validateActionPromotionHashV1(report.reportHash, "$.reportHash", errors);
  if (report.runtimeSemanticFeatureId !== RUST_ACTION_PROMOTION_RUNTIME_SEMANTIC_FEATURE_ID_V1) {
    errors.push(actionPromotionErrorV1(
      "descriptor-mismatch", "$.runtimeSemanticFeatureId", RUST_ACTION_PROMOTION_RUNTIME_SEMANTIC_FEATURE_ID_V1,
      report.runtimeSemanticFeatureId,
    ));
  }
  if (report.blockers.length > MAX_RUST_ACTION_PROMOTION_BLOCKER_RECORDS_V1) {
    errors.push(actionPromotionErrorV1(
      "capacity", "$.blockers", String(MAX_RUST_ACTION_PROMOTION_BLOCKER_RECORDS_V1), String(report.blockers.length),
    ));
  }
  let previousKey: string | null = null;
  let totalAffected = 0;
  for (const [index, blocker] of report.blockers.entries()) {
    const path = `$.blockers[${index}]`;
    const scopeTag = blocker.scope === "global" ? "0" : blocker.scope === "profile" ? "1" : "?";
    if (scopeTag === "?") errors.push(actionPromotionErrorV1("descriptor-mismatch", `${path}.scope`, "global or profile", String(blocker.scope)));
    const key = `${scopeTag}\u0000${blocker.blockerId}`;
    if (previousKey !== null && previousKey >= key) {
      errors.push(actionPromotionErrorV1("ordering", `${path}.blockerId`, "strict scope then blocker-id order", blocker.blockerId));
    }
    previousKey = key;
    const disposition = actionPromotionDispositionV1(blocker.blockerId);
    if (disposition === null) {
      errors.push(actionPromotionErrorV1("unknown-blocker", `${path}.blockerId`, "registered blocker id", blocker.blockerId));
    } else if (disposition !== blocker.disposition) {
      errors.push(actionPromotionErrorV1("classification", `${path}.disposition`, disposition, blocker.disposition));
    }
    if (blocker.affectedBlockIds.length < 1 || blocker.affectedBlockIds.length > MAX_RUST_ACTION_PROMOTION_AFFECTED_BLOCK_IDS_V1) {
      errors.push(actionPromotionErrorV1(
        "capacity", `${path}.affectedBlockIds`, `1..=${MAX_RUST_ACTION_PROMOTION_AFFECTED_BLOCK_IDS_V1}`,
        String(blocker.affectedBlockIds.length),
      ));
    }
    if (blocker.affectedBlockCount !== blocker.affectedBlockIds.length) {
      errors.push(actionPromotionErrorV1(
        "descriptor-mismatch", `${path}.affectedBlockCount`, String(blocker.affectedBlockIds.length),
        String(blocker.affectedBlockCount),
      ));
    }
    for (const [affectedIndex, blockId] of blocker.affectedBlockIds.entries()) {
      if (!Number.isInteger(blockId) || blockId < 0 || blockId > 0xffff) {
        errors.push(actionPromotionErrorV1("descriptor-mismatch", `${path}.affectedBlockIds[${affectedIndex}]`, "u16", String(blockId)));
      }
      if (affectedIndex && blocker.affectedBlockIds[affectedIndex - 1] >= blockId) {
        errors.push(actionPromotionErrorV1("ordering", `${path}.affectedBlockIds`, "strict ascending unique block ids", String(blockId)));
      }
    }
    totalAffected += blocker.affectedBlockIds.length;
  }
  if (totalAffected > MAX_RUST_ACTION_PROMOTION_TOTAL_AFFECTED_BLOCK_IDS_V1) {
    errors.push(actionPromotionErrorV1(
      "capacity", "$.blockers[*].affectedBlockIds", String(MAX_RUST_ACTION_PROMOTION_TOTAL_AFFECTED_BLOCK_IDS_V1),
      String(totalAffected),
    ));
  }
  const rngExact = report.rngSemanticsVersionId === RUST_ACTION_PROMOTION_RNG_SEMANTICS_VERSION_ID_V1
    && report.rngSemanticsHash !== null;
  if (report.blockActionCatalogSchemaVersion === 1) {
    const legacy = report.blockers[0];
    if (report.supportLevel !== "legacy-unproven" || report.rngSemanticsVersionId !== null || report.rngSemanticsHash !== null
      || report.blockers.length !== 1 || legacy?.scope !== "global"
      || legacy?.blockerId !== "legacy-block-action-catalog-schema-unproven") {
      errors.push(actionPromotionErrorV1(
        "descriptor-mismatch", "$.supportLevel", "legacy-unproven with one legacy schema blocker and no RNG proof",
        report.supportLevel,
      ));
    }
  } else if (report.blockActionCatalogSchemaVersion === 2) {
    const expected = report.blockers.length ? "declared-blocked" : "declared-ready";
    if (report.blockers.some((blocker) => blocker.blockerId === "legacy-block-action-catalog-schema-unproven")) {
      errors.push(actionPromotionErrorV1(
        "descriptor-mismatch", "$.blockers", "schema-2 blocker evidence without the legacy-schema sentinel",
        "legacy-block-action-catalog-schema-unproven",
      ));
    }
    if (report.supportLevel !== expected || !rngExact) {
      errors.push(actionPromotionErrorV1(
        "descriptor-mismatch", "$.supportLevel/rngSemantics", `${expected} with exact V1 RNG proof`, report.supportLevel,
      ));
    }
  } else {
    errors.push(actionPromotionErrorV1(
      "unsupported-schema", "$.blockActionCatalogSchemaVersion", "1 or 2", String(report.blockActionCatalogSchemaVersion),
    ));
  }
  if (!Number.isInteger(report.blockActionCatalogContentVersion)
    || report.blockActionCatalogContentVersion < 0 || report.blockActionCatalogContentVersion > 0xffff_ffff) {
    errors.push(actionPromotionErrorV1(
      "descriptor-mismatch", "$.blockActionCatalogContentVersion", "u32", String(report.blockActionCatalogContentVersion),
    ));
  }
  if (!errors.some((error) => error.path.endsWith("Hash") || error.path === "$.manifestHash")) {
    try {
      const expectedHash = canonicalRustActionPromotionReportHashV1(report);
      if (report.reportHash !== expectedHash) {
        errors.push(actionPromotionErrorV1("hash-mismatch", "$.reportHash", expectedHash, report.reportHash));
      }
    } catch (error) {
      errors.push(actionPromotionErrorV1("descriptor-mismatch", "$.reportHash", "canonical hashable report", String(error)));
    }
  }
  return Object.freeze(errors);
}

function validateCatalogBlockerIdsV1(value: unknown, path: string, required: boolean) {
  if (value === undefined && !required) return [] as string[];
  if (!Array.isArray(value) || value.length > 32) {
    return rejectActionPromotionV1("capacity", path, "sorted blocker array with at most 32 entries", value);
  }
  const result: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry === "legacy-block-action-catalog-schema-unproven"
      || actionPromotionDispositionV1(entry) === null) {
      return rejectActionPromotionV1("unknown-blocker", `${path}[${index}]`, "registered catalog blocker id", entry);
    }
    if (index && result[index - 1] >= entry) {
      return rejectActionPromotionV1("ordering", `${path}[${index}]`, "strict ascending unique blocker ids", entry);
    }
    result.push(entry);
  }
  return result;
}

function exactManifestHashV1(manifest: RustProductionContentManifest) {
  const writer = new CanonicalHashWriter("blockwild.gameplay.content-manifest.v1");
  writer.writeU16(manifest.schemaVersion);
  writer.writeString(manifest.sourceRevision);
  writer.writeU64(BigInt(RUST_CONTENT_DOMAINS.length));
  for (const domain of RUST_CONTENT_DOMAINS) {
    const digest = manifest.domains[domain];
    writer.writeString(domain);
    writer.writeU32(digest.count);
    writer.writeBytes(hexToBytes(digest.hash));
  }
  return writer.finish();
}

export function createRustActionPromotionReportV1(
  bundle: RustProductionContentBundle,
  installedRegistryHash: string | null = null,
): RustActionPromotionReportV1 {
  if (!bundle.manifest || bundle.blockers.length) {
    return rejectActionPromotionV1("descriptor-mismatch", "$.manifest", "compiled content manifest without blockers", "absent or blocked");
  }
  if (exactManifestHashV1(bundle.manifest) !== bundle.manifest.manifestHash) {
    return rejectActionPromotionV1("hash-mismatch", "$.manifestHash", exactManifestHashV1(bundle.manifest), bundle.manifest.manifestHash);
  }
  if (installedRegistryHash !== null && !/^[0-9a-f]{32}$/u.test(installedRegistryHash)) {
    return rejectActionPromotionV1("descriptor-mismatch", "$.installedRegistryHash", "32 lowercase hexadecimal digits or null", installedRegistryHash);
  }
  const matching = bundle.artifacts.filter((artifact) => artifact.domain === "item" && artifact.id === RUST_BLOCK_ACTION_CATALOG_ID);
  if (matching.length !== 1) {
    return rejectActionPromotionV1("descriptor-mismatch", "$.catalog", "one installed block-action catalog", matching.length);
  }
  const artifact = matching[0];
  if (artifact.schemaId !== "block-action-catalog" || (artifact.schemaVersion !== 1 && artifact.schemaVersion !== 2)) {
    return rejectActionPromotionV1(
      "unsupported-schema", "$.catalog.schema", "block-action-catalog@1 or block-action-catalog@2",
      `${artifact.schemaId}@${artifact.schemaVersion}`,
    );
  }
  const computedBlobHash = canonicalRustMetadataHash({
    domain: artifact.domain, id: artifact.id, schemaId: artifact.schemaId, schemaVersion: artifact.schemaVersion,
    contentVersion: artifact.contentVersion, aliases: artifact.aliases, canonicalBytes: artifact.canonicalBytes,
    unknownExtensionBytes: artifact.unknownExtensionBytes,
  });
  if (computedBlobHash !== artifact.blobHash) {
    return rejectActionPromotionV1("hash-mismatch", "$.catalog.blobHash", computedBlobHash, artifact.blobHash);
  }
  const manifestEntry = bundle.manifest.entries.find((entry) => entry.domain === "item" && entry.id === RUST_BLOCK_ACTION_CATALOG_ID);
  if (!manifestEntry || manifestEntry.blobHash !== artifact.blobHash
    || manifestEntry.byteLength !== artifact.canonicalBytes.byteLength + artifact.unknownExtensionBytes.byteLength) {
    return rejectActionPromotionV1("descriptor-mismatch", "$.manifest.entries.block-actions", "exact catalog descriptor", manifestEntry?.blobHash);
  }
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(artifact.canonicalBytes)); }
  catch (error) { return rejectActionPromotionV1("descriptor-mismatch", "$.catalog.canonicalBytes", "canonical JSON", error); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return rejectActionPromotionV1("descriptor-mismatch", "$.catalog", "catalog object", decoded);
  }
  const catalog = decoded as ActionPromotionCatalogV1;
  if (catalog.schema !== artifact.schemaVersion || !Array.isArray(catalog.profiles)
    || catalog.profiles.length < 1 || catalog.profiles.length > MAX_RUST_ACTION_PROMOTION_AFFECTED_BLOCK_IDS_V1) {
    return rejectActionPromotionV1("descriptor-mismatch", "$.catalog.schema/profiles", "matching schema and 1..4096 profiles", catalog.schema);
  }
  const profileRows = catalog.profiles.map((profile, index) => {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return rejectActionPromotionV1("descriptor-mismatch", `$.catalog.profiles[${index}]`, "profile object", profile);
    }
    const row = profile as Record<string, unknown>;
    if (!Number.isInteger(row.id) || (row.id as number) < 0 || (row.id as number) > 0xffff) {
      return rejectActionPromotionV1("descriptor-mismatch", `$.catalog.profiles[${index}].id`, "u16", row.id);
    }
    return { id: row.id as number, blockers: validateCatalogBlockerIdsV1(row.authorityBlockers, `$.catalog.profiles[${index}].authorityBlockers`, false) };
  }).sort((left, right) => left.id - right.id);
  if (profileRows.some((row, index) => index > 0 && profileRows[index - 1].id === row.id)) {
    return rejectActionPromotionV1("ordering", "$.catalog.profiles[*].id", "unique block ids", "duplicate");
  }
  const allBlockIds = Object.freeze(profileRows.map((row) => row.id));
  const records: RustActionPromotionBlockerRecordV1[] = [];
  let rngSemanticsVersionId: string | null = null;
  let rngSemanticsHash: string | null = null;
  if (artifact.schemaVersion === 1) {
    records.push(Object.freeze({
      scope: "global", blockerId: "legacy-block-action-catalog-schema-unproven", disposition: "content-unresolved",
      affectedBlockIds: allBlockIds, affectedBlockCount: allBlockIds.length,
    }));
  } else {
    const globalBlockers = validateCatalogBlockerIdsV1(catalog.authorityBlockers, "$.catalog.authorityBlockers", true);
    for (const blockerId of globalBlockers) records.push(Object.freeze({
      scope: "global", blockerId, disposition: actionPromotionDispositionV1(blockerId)!,
      affectedBlockIds: allBlockIds, affectedBlockCount: allBlockIds.length,
    }));
    const affectedByProfile = new Map<string, number[]>();
    for (const profile of profileRows) for (const blockerId of profile.blockers) {
      const affected = affectedByProfile.get(blockerId) ?? [];
      affected.push(profile.id);
      affectedByProfile.set(blockerId, affected);
    }
    for (const [blockerId, affectedBlockIds] of [...affectedByProfile]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
      records.push(Object.freeze({
        scope: "profile", blockerId, disposition: actionPromotionDispositionV1(blockerId)!,
        affectedBlockIds: Object.freeze(affectedBlockIds), affectedBlockCount: affectedBlockIds.length,
      }));
    }
    rngSemanticsVersionId = RUST_ACTION_PROMOTION_RNG_SEMANTICS_VERSION_ID_V1;
    rngSemanticsHash = actionPromotionRngSemanticsHashV1(catalog.rngSemantics);
  }
  const supportLevel: RustActionPromotionSupportLevelV1 = artifact.schemaVersion === 1 ? "legacy-unproven"
    : records.length ? "declared-blocked" : "declared-ready";
  const withoutHash = Object.freeze({
    schemaVersion: RUST_ACTION_PROMOTION_REPORT_SCHEMA_V1,
    manifestHash: bundle.manifest.manifestHash,
    installedRegistryHash,
    blockActionCatalogSchemaVersion: artifact.schemaVersion,
    blockActionCatalogContentVersion: artifact.contentVersion,
    blockActionCatalogBlobHash: artifact.blobHash,
    rngSemanticsVersionId,
    rngSemanticsHash,
    runtimeSemanticFeatureId: RUST_ACTION_PROMOTION_RUNTIME_SEMANTIC_FEATURE_ID_V1,
    supportLevel,
    blockers: Object.freeze(records),
  });
  const report = Object.freeze({ ...withoutHash, reportHash: canonicalRustActionPromotionReportHashV1(withoutHash) });
  const errors = validateRustActionPromotionReportV1(report);
  if (errors.length) throw new RustActionPromotionReportCompilationErrorV1(errors);
  return report;
}

export function blockwildProductionContentSources(): readonly RustContentSourceEntry[] {
  const entries: RustContentSourceEntry[] = [];
  entries.push(source(
    "item",
    RUST_BLOCK_ACTION_CATALOG_ID,
    "block-action-catalog",
    RUST_BLOCK_ACTION_CATALOG_SCHEMA,
    blockwildBlockActionCatalogV2(),
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
  entries.push({
    domain: "machine-profile",
    id: RENDER_PRESENTATION_CATALOG_ID_V1,
    schemaId: RENDER_PRESENTATION_CATALOG_SCHEMA_ID_V1,
    schemaVersion: RENDER_PRESENTATION_CATALOG_SCHEMA_V2,
    contentVersion: 2,
    value: BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2,
    aliases: Object.freeze(["render-presentation-catalog:production"]),
  });
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
