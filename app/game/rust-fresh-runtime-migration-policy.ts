import { normalizeCharacterAppearance, normalizeCharacterSkillAllocation, type CharacterProfile } from "./character-profiles";
import type { WorldSave } from "./engine";
import { NPC_FACTION_IDS } from "./factions";
import { persistencePayloadHashV1 } from "./persistence-journal-contract";
import { deriveRustPlayerBootstrapCompatibilityIdentityV1 } from "./rust-player-bootstrap-compatibility";
import { normalizeSkillState, SKILL_IDS } from "./skills";
import { WORLD_HEIGHT } from "./world";
import { assertWorldImportSourceReferenceV1, type WorldImportSourceReferenceV1 } from "./world-import-source";
import { encodeCanonicalWorldSaveValueV1 } from "./world-save-sharding";
import {
  deriveWorldGenerationIdentityV1, migrateLegacyWorldSave, normalizeWorldOptions,
  type WorldGenerationIdentityV1, type WorldOptions,
} from "./world-save-normalization";

/**
 * Review contract only. It neither attests archive durability nor proves that a
 * native target is empty. A future executor must independently re-read the
 * archive, check fresh-target/CAS preconditions, import each typed domain, and
 * prove native readback/rollback before any migration can be called accepted.
 *
 * V1 recognizes only the g16/g17 builder/empty-custody fixture-shaped subset.
 * "Recognized" means source terms can be reviewed, NOT that native codecs exist.
 * Source generator versions describe provenance; normalized target generation
 * uses the current storage migration, not historical executable binaries.
 */
export const FRESH_RUNTIME_MIGRATION_POLICY_ID_V1 = "blockwild-fresh-runtime-review-g16-g17-builder-v1";
const MAX_POLICY_JSON_DEPTH = 64;
const MAX_POLICY_JSON_NODES = 100_000;
const encoder = new TextEncoder();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const byteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const resizableBufferGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const setByteArray = Uint8Array.prototype.set;

export const FRESH_RUNTIME_MIGRATION_ACKNOWLEDGEMENTS_V1 = Object.freeze([
  "bind-selected-actor-not-historical-owner",
  "fresh-transient-decisions-not-restored-continuity",
  "preserve-all-source-and-review-continuation-terms",
  "consent-is-not-native-execution-or-migration-acceptance",
] as const);
export type FreshRuntimeMigrationTargetV1 = Readonly<{
  catalogWorldId: string; universeId: string; locationId: string; generatorHash: string; contentHash: string;
}>;
export type FreshRuntimeMigrationActorV1 = Readonly<{
  profileId: string; actorId: string; commandActorId: string; profileCanonicalHash: string;
}>;
export type FreshRuntimeMigrationInputV1 = Readonly<{
  policyVersion: 1; originalSource: WorldImportSourceReferenceV1; sourceBytes: Uint8Array;
  target: FreshRuntimeMigrationTargetV1;
  actor: Readonly<{ profile: CharacterProfile; actorId: string; commandActorId: string }>;
}>;
export type FreshRuntimeMigrationProposalV1 = Readonly<{
  policyVersion: 1; policyId: string; status: "review-only"; nativeExecutionAllowed: false;
  sourceSubset: "g16-g17-builder-empty-custody-v1" | null;
  source: Readonly<{ reference: WorldImportSourceReferenceV1; semanticHash: string; document: unknown }>;
  target: Readonly<{ address: FreshRuntimeMigrationTargetV1; normalizedSemanticHash: string | null }>;
  actor: FreshRuntimeMigrationActorV1;
  sourceBlockers: readonly Readonly<{ path: string; kind: "unknown-field" | "unsupported-value" | "missing-required"; reason: string }>[];
  nativeUnimplementedTerms: readonly Readonly<{ id: string; sourcePaths: readonly string[]; status: "recognized-native-unimplemented" }>[];
  terms: Readonly<{
    /** Exhaustive JSON-pointer inventory, including containers and empty custody. */
    sourcePropertyPaths: readonly string[];
    /** Review data only; excludes new-instance catalog timestamps and agent fingerprint. */
    normalizedTarget: Readonly<{ save: WorldSave; options: WorldOptions; generationIdentity: WorldGenerationIdentityV1 }> | null;
    legacyLoad: Readonly<{ health: Readonly<{ sourcePresent: boolean; afterStorageNormalization: number; afterBuilderLoad: number }>; worldTime: number; explorationLevelWhenSourceAbsent: number }> | null;
    freshRuntimeDecisions: readonly Readonly<{ id: string; decision: string; basis: "explicit-fresh-runtime-decision-not-source-continuity" }>[];
  }>;
  proposalHash: string;
}>;
export type FreshRuntimeMigrationConsentDecisionV1 = Readonly<{
  schemaVersion: 1; decision: "affirm-review-only"; proposalHash: string;
  sourceRawSha256: string; sourceByteLength: number; sourceSemanticHash: string; normalizedTargetSemanticHash: string;
  target: FreshRuntimeMigrationTargetV1; actor: FreshRuntimeMigrationActorV1;
  acknowledgements: typeof FRESH_RUNTIME_MIGRATION_ACKNOWLEDGEMENTS_V1;
}>;
export type FreshRuntimeMigrationConsentRecordV1 = Readonly<{
  status: "consent-record-only"; policyVersion: 1; proposalHash: string; nativeExecutionAllowed: false;
}>;

export class FreshRuntimeMigrationPolicyError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "FreshRuntimeMigrationPolicyError"; }
}

function fail(code: string, message: string): never { throw new FreshRuntimeMigrationPolicyError(code, message); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function record(value: unknown, label: string) {
  if (!isRecord(value)) fail("shape", `${label} must be a plain record`);
  return value;
}
function exact(value: unknown, keys: readonly string[], label: string) {
  const result = record(value, label);
  if (Object.keys(result).sort().join("\0") !== [...keys].sort().join("\0")) fail("shape", `${label} has missing or unsupported fields`);
  if (Reflect.ownKeys(result).some(key => typeof key !== "string" || !Object.getOwnPropertyDescriptor(result, key)?.enumerable
    || !("value" in Object.getOwnPropertyDescriptor(result, key)!))) fail("shape", `${label} must contain only enumerable data fields`);
  return result;
}
function visible(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || value.length === 0 || encoder.encode(value).length > max
    || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value)) fail("identity", `${label} must be a bounded visible identity`);
  return value;
}

/** Snapshot before awaits; rejects values the permissive canonical encoder could erase. */
function snapshotJson<T>(input: T): T {
  let nodes = 0;
  const ancestors = new Set<object>();
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > MAX_POLICY_JSON_NODES || depth > MAX_POLICY_JSON_DEPTH) fail("json-bound", "Policy JSON exceeds its node/depth bound");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("json-finite", "Policy JSON numbers must be finite");
      return value;
    }
    if (typeof value !== "object" || (!Array.isArray(value) && !isRecord(value))) fail("json-shape", "Policy data must be strict JSON");
    if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) fail("json-array", "Policy arrays must have the ordinary Array prototype");
    if (ancestors.has(value)) fail("json-cycle", "Policy data must not contain cycles");
    ancestors.add(value);
    const entries = Reflect.ownKeys(value).filter(key => key !== "length" || !Array.isArray(value));
    if (entries.some(key => typeof key !== "string" || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
      || !("value" in Object.getOwnPropertyDescriptor(value, key)!))) fail("json-shape", "Policy data must contain only enumerable data properties");
    let result: unknown;
    if (Array.isArray(value)) {
      if (entries.length !== value.length || entries.some((key, index) => key !== String(index))) fail("json-array", "Policy arrays must be dense and have no extra properties");
      const array: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) array.push(copy(Object.getOwnPropertyDescriptor(value, String(index))!.value, depth + 1));
      result = array;
    } else {
      result = Object.fromEntries(entries.map(key => [key, copy((value as Record<string, unknown>)[key as string], depth + 1)]));
    }
    ancestors.delete(value);
    return Object.freeze(result);
  }
  return copy(input, 0) as T;
}

/** File.arrayBuffer/readback shape only; no iterator, species, or getter hooks. */
function snapshotSourceBytes(value: unknown, expectedLength: number) {
  if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype) fail("byte-shape", "Source bytes must have the ordinary Uint8Array prototype");
  // O(1) hook checks, not enumeration of up to 64 million indexed properties.
  for (const key of ["buffer", "byteOffset", "byteLength", "constructor", Symbol.iterator]) {
    if (Object.hasOwn(value, key)) fail("byte-hook", "Source byte views must not override intrinsic access or iterator hooks");
  }
  const buffer = byteBufferGetter.call(value) as ArrayBuffer;
  const byteOffset = byteOffsetGetter.call(value) as number;
  const byteLength = byteLengthGetter.call(value) as number;
  if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || resizableBufferGetter?.call(buffer)) fail("byte-buffer", "Source bytes require an ordinary fixed ArrayBuffer, never shared/resizable storage");
  if (byteLength !== expectedLength) fail("source-length", "Original source length does not match its reference");
  const output = new Uint8Array(byteLength);
  setByteArray.call(output, new Uint8Array(buffer, byteOffset, byteLength));
  return output;
}
/**
 * Exact review canonical JSON: ordinal keys, dense arrays, finite JSON numbers,
 * and literal -0. Established save semantic hashes intentionally canonicalize
 * zero; they must not be used for f64 review equality or the SHA-256 review ID.
 * Callers first pass snapshotJson, so unsupported values cannot reach this seam.
 */
function canonical(value: unknown): string {
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function semanticHash(value: unknown) { return persistencePayloadHashV1(encodeCanonicalWorldSaveValueV1(value)); }
async function sha256(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) fail("crypto", "Review identities require Web Crypto SHA-256");
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function domainHash(domain: string, value: unknown) {
  return sha256(encoder.encode(`${domain}\0${canonical(value)}`));
}
function pointer(path: string, key: string) { return `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`; }
function sourcePropertyPaths(value: unknown, path = ""): string[] {
  return [path, ...(value !== null && typeof value === "object"
    ? Object.entries(value).flatMap(([key, entry]) => sourcePropertyPaths(entry, pointer(path, key))) : [])];
}

/** JSON.parse has already checked syntax; reject last-property-wins ambiguity. */
function assertUniqueJsonKeys(json: string) {
  const stack: Array<{ keys: Set<string> | null; expectKey: boolean }> = [];
  const tokens = /"(?:\\.|[^"\\])*"|\{|\}|\[|\]|,|:/gu;
  for (const match of json.matchAll(tokens)) {
    const token = match[0];
    if (token === "{" || token === "[") stack.push({ keys: token === "{" ? new Set() : null, expectKey: true });
    else if (token === "}" || token === "]") stack.pop();
    else {
      const context = stack.at(-1);
      if (!context?.keys) continue;
      if (token === ",") context.expectKey = true;
      else if (token.startsWith('"') && context.expectKey) {
        const key = JSON.parse(token) as string;
        if (context.keys.has(key)) fail("source-duplicate-key", "Duplicate JSON property names are not eligible for source review");
        context.keys.add(key);
        context.expectKey = false;
      }
    }
  }
}

type Blocker = FreshRuntimeMigrationProposalV1["sourceBlockers"][number];
type SourceRule = Readonly<{
  fields?: Readonly<Record<string, SourceRule>>; optional?: readonly string[];
  test?: (value: unknown) => boolean; reason?: string; edits?: true;
}>;
const numberRule: SourceRule = { test: value => typeof value === "number" && Number.isFinite(value), reason: "Expected a finite f64 number" };
const stringRule: SourceRule = { test: value => typeof value === "string" && value.length > 0 && value.length <= 512, reason: "Expected a nonempty bounded string" };
const booleanRule: SourceRule = { test: value => typeof value === "boolean", reason: "Expected a boolean" };
const timestampRule: SourceRule = { test: value => Number.isSafeInteger(value) && (value as number) >= 0, reason: "Expected a nonnegative safe timestamp" };
const oneOf = (...values: readonly unknown[]): SourceRule => ({ test: value => values.includes(value), reason: "Value is outside the reviewed source subset" });
const emptyMap: SourceRule = { test: value => isRecord(value) && Object.keys(value).length === 0, reason: "Nonempty custody needs an explicit lossless native codec" };
const positionFields = { x: numberRule, y: numberRule, z: numberRule };
const SOURCE_RULE: SourceRule = {
  fields: {
    format: oneOf("blockwild-world"), version: oneOf(1), exportedAt: timestampRule, ownershipNotice: stringRule,
    world: { fields: {
      version: oneOf(1),
      metadata: { fields: {
        id: stringRule, ownership: oneOf("host-device"), name: stringRule, seed: stringRule, mode: oneOf("builder"),
        createdAt: timestampRule, updatedAt: timestampRule, lastPlayedAt: timestampRule, playTimeMs: timestampRule,
        lastSavedGameVersion: stringRule, generationIdentity: oneOf(null),
      } },
      options: { optional: ["settlementPattern", "settlementDensity", "settlementClustering", "roadCoverage", "largeTownFrequency"], fields: {
        difficulty: oneOf("peaceful", "easy", "normal", "hard"), dayLengthMinutes: numberRule, mobDensity: numberRule,
        butterflyDensity: numberRule, caveFrequency: numberRule, biomeScale: numberRule, resourceAbundance: numberRule,
        structures: booleanRule, weather: booleanRule, keepInventory: booleanRule, friendlyFire: booleanRule,
        sleepRule: oneOf("any-player", "percentage", "all-players"), sleepPercentage: numberRule,
        enabledFactions: { test: value => Array.isArray(value) && value.length > 0 && new Set(value).size === value.length
          && value.every(entry => (NPC_FACTION_IDS as readonly unknown[]).includes(entry)), reason: "Factions must be known and unique" },
        settlementPattern: oneOf("legacy-scattered-v1", "heartlands-v2"), settlementDensity: numberRule,
        settlementClustering: oneOf("even", "regional", "strong"), roadCoverage: oneOf("none", "local", "regional", "dense"),
        largeTownFrequency: oneOf("rare", "balanced", "frequent"), origin: { fields: { mode: oneOf("wilderness") } },
      } },
      save: { optional: ["health"], fields: {
        version: oneOf(2), generatorVersion: oneOf(16, 17), generatorProfile: oneOf("world-below-v15"),
        lastSavedGameVersion: stringRule, seed: stringRule, mode: oneOf("builder"), edits: { edits: true },
        player: { fields: { ...positionFields, yaw: numberRule, pitch: numberRule } }, spawn: { fields: positionFields },
        inventory: { test: value => Array.isArray(value) && value.length === 0, reason: "Only the empty-custody source subset is reviewed" },
        selected: { test: value => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 8, reason: "Selected slot must be 0..8" },
        health: numberRule, hunger: numberRule, xp: oneOf(0), level: oneOf(0), time: numberRule,
        day: { test: value => Number.isSafeInteger(value) && (value as number) >= 1, reason: "Day must be a positive safe integer" },
        weather: oneOf("clear", "rain"), furnaces: emptyMap, chests: emptyMap, savedAt: timestampRule,
      } },
    } },
  },
};

function inspectSource(value: unknown) {
  const blockers: Blocker[] = [];
  function block(path: string, kind: Blocker["kind"], reason: string) { blockers.push({ path, kind, reason }); }
  function visit(entry: unknown, rule: SourceRule, path: string) {
    if (rule.fields) {
      if (!isRecord(entry)) { block(path, "unsupported-value", "Expected the reviewed record shape"); return; }
      for (const key of Object.keys(entry)) if (!Object.hasOwn(rule.fields, key)) block(pointer(path, key), "unknown-field", "No reviewed source rule owns this property");
      for (const [key, child] of Object.entries(rule.fields)) {
        if (!Object.hasOwn(entry, key)) {
          if (!rule.optional?.includes(key)) block(pointer(path, key), "missing-required", "Required review data is absent");
        } else visit(entry[key], child, pointer(path, key));
      }
    } else if (rule.edits) {
      if (!isRecord(entry)) { block(path, "unsupported-value", "Edits must be a coordinate-keyed map"); return; }
      for (const [key, pairs] of Object.entries(entry)) {
        const coordinate = /^(-?(?:0|[1-9]\d*)),(-?(?:0|[1-9]\d*))$/u.exec(key);
        const validCoordinate = coordinate && coordinate.slice(1).every(part => Number.isSafeInteger(Number(part)) && String(Number(part)) === part);
        if (!validCoordinate || !Array.isArray(pairs)) { block(pointer(path, key), "unsupported-value", "Edit chunk address must be canonical and exact"); continue; }
        const indices = new Set<number>();
        pairs.forEach((pair, index) => {
          if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) || pair[0] < 0 || pair[0] >= WORLD_HEIGHT * 256
            || !Number.isInteger(pair[1]) || pair[1] < 0 || pair[1] > 65535 || indices.has(pair[0])) {
            block(pointer(pointer(path, key), String(index)), "unsupported-value", "Edit pair must be exact, in range, and nonduplicate");
          } else indices.add(pair[0]);
        });
      }
    } else if (!rule.test?.(entry)) block(path, "unsupported-value", rule.reason ?? "Unsupported source value");
  }
  visit(value, SOURCE_RULE, "");
  return blockers.sort((a, b) => a.path === b.path ? 0 : a.path < b.path ? -1 : 1);
}

function validateProfile(value: unknown): CharacterProfile {
  const profile = exact(value, ["schema", "id", "browserId", "name", "appearance", "startingSkills", "createdAt", "updatedAt"], "profile");
  const appearance = exact(profile.appearance, ["sex", "race", "colors"], "profile.appearance");
  exact(appearance.colors, ["skin", "hair", "shirt", "trousers", "accent"], "profile.appearance.colors");
  exact(profile.startingSkills, SKILL_IDS, "profile.startingSkills");
  visible(profile.id, "profile.id", 72); visible(profile.browserId, "profile.browserId", 72);
  if (typeof profile.createdAt !== "number" || !Number.isSafeInteger(profile.createdAt) || profile.createdAt < 0
    || typeof profile.updatedAt !== "number" || !Number.isSafeInteger(profile.updatedAt) || profile.updatedAt < profile.createdAt) fail("profile", "Profile timestamps are not canonical");
  // normalizeCharacterProfile eagerly generates fallback random IDs even for
  // valid profiles. A pure review must never call that constructor-like seam.
  const canonicalId = typeof profile.id === "string" && profile.id === profile.id.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 72);
  const canonicalName = typeof profile.name === "string" && profile.name.length > 0 && profile.name.length <= 32
    && profile.name === profile.name.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().replace(/\s+/gu, " ");
  if (profile.schema !== 1 || !canonicalId || !canonicalName
    || canonical(profile.appearance) !== canonical(normalizeCharacterAppearance(profile.appearance))
    || canonical(profile.startingSkills) !== canonical(normalizeCharacterSkillAllocation(profile.startingSkills))) {
    fail("profile", "Profile must already be complete and canonical; no identity or skill defaults are inferred");
  }
  return profile as CharacterProfile;
}
function validateTarget(value: unknown): FreshRuntimeMigrationTargetV1 {
  const target = exact(value, ["catalogWorldId", "universeId", "locationId", "generatorHash", "contentHash"], "target");
  visible(target.catalogWorldId, "target.catalogWorldId", 48); visible(target.universeId, "target.universeId", 64); visible(target.locationId, "target.locationId", 128);
  for (const key of ["generatorHash", "contentHash"]) if (typeof target[key] !== "string" || !/^[0-9a-f]{32}$/u.test(target[key])) fail("target", `${key} must be an exact semantic identity`);
  return target as FreshRuntimeMigrationTargetV1;
}

const NATIVE_UNIMPLEMENTED_TERMS = Object.freeze([
  { id: "generation-world-adoption", sourcePaths: ["/world/save/edits", "/world/save/seed", "/world/save/generatorVersion", "/world/save/generatorProfile"] },
  { id: "day-time-weather-continuation", sourcePaths: ["/world/save/day", "/world/save/time", "/world/save/weather"] },
  { id: "saved-spawn-continuation", sourcePaths: ["/world/save/spawn"] },
  { id: "runtime-options-continuation", sourcePaths: ["/world/options", "/world/save/mode"] },
  { id: "f64-player-pose-continuation", sourcePaths: ["/world/save/player"] },
  { id: "empty-custody-adoption", sourcePaths: ["/world/save/inventory", "/world/save/selected", "/world/save/furnaces", "/world/save/chests"] },
  { id: "legacy-vitals-and-progression-continuation", sourcePaths: ["/world/save/health", "/world/save/hunger", "/world/save/xp", "/world/save/level"] },
  { id: "fresh-actor-and-transient-adoption", sourcePaths: [] },
].map(term => ({ ...term, status: "recognized-native-unimplemented" as const })));
const FRESH_DECISIONS = Object.freeze([
  { id: "adopted-owner", decision: "Bind the explicitly selected actor; do not attest historical ownership." },
  { id: "velocity", decision: "Begin a fresh runtime at rest, not with restored historical velocity." },
  { id: "grounded", decision: "Begin without a historical grounded assertion and recompute contact in the fresh runtime." },
  { id: "session-age", decision: "Begin a new native session age at zero; do not infer historical age." },
].map(term => ({ ...term, basis: "explicit-fresh-runtime-decision-not-source-continuity" as const })));

export async function planRustFreshRuntimeMigrationV1(input: unknown): Promise<FreshRuntimeMigrationProposalV1> {
  const root = exact(input, ["policyVersion", "originalSource", "sourceBytes", "target", "actor"], "policy input");
  if (root.policyVersion !== 1) fail("policy-version", "Only policy version one is supported");
  const reference = snapshotJson(root.originalSource);
  assertWorldImportSourceReferenceV1(reference);
  const bytes = snapshotSourceBytes(root.sourceBytes, reference.byteLength);
  const target = validateTarget(snapshotJson(root.target));
  const actorInput = exact(snapshotJson(root.actor), ["profile", "actorId", "commandActorId"], "actor");
  const profile = validateProfile(actorInput.profile);
  const identity = deriveRustPlayerBootstrapCompatibilityIdentityV1(profile, {
    universeKey: target.universeId, locationKey: target.locationId,
    commandActorId: visible(actorInput.commandActorId, "actor.commandActorId", 160),
  });
  if (actorInput.actorId !== identity.actorId) fail("actor", "Selected actor does not match the canonical profile");
  // All external mutable inputs are owned before the first asynchronous digest.
  if (await sha256(bytes) !== reference.rawSha256) fail("source-hash", "Original source SHA-256 does not match its reference");
  let parsed: unknown;
  let json: string;
  try { json = new TextDecoder("utf-8", { fatal: true }).decode(bytes); parsed = JSON.parse(json); }
  catch { fail("source-json", "Original source must be valid UTF-8 JSON"); }
  const document = snapshotJson(parsed);
  assertUniqueJsonKeys(json);
  if (!isRecord(document) || document.format !== "blockwild-world" || document.version !== 1) fail("source-format", "Source must be a version-one Blockwild export");
  const sourceBlockers = inspectSource(document);
  const world = isRecord(document.world) ? document.world : null;
  const sourceSave = world && isRecord(world.save) ? world.save : null;
  const sourceOptions = world && isRecord(world.options) ? world.options : null;
  let normalizedTarget: FreshRuntimeMigrationProposalV1["terms"]["normalizedTarget"] = null;
  let legacyLoad: FreshRuntimeMigrationProposalV1["terms"]["legacyLoad"] = null;
  if (sourceBlockers.length === 0 && world && sourceSave && sourceOptions) {
    // Match public import's existing pre-v17 envelope option migration. The
    // original document remains separately retained in full, including absence.
    const save = migrateLegacyWorldSave(sourceSave);
    if (!save) fail("source-normalization", "Recognized source did not pass the existing legacy save normalizer");
    const options = normalizeWorldOptions(sourceSave.generatorVersion === 16 ? { ...sourceOptions, settlementPattern: "legacy-scattered-v1" } : sourceOptions);
    const generationIdentity = deriveWorldGenerationIdentityV1(save, options);
    if (generationIdentity.generatorHash !== target.generatorHash || generationIdentity.terrainContentHash !== target.contentHash) fail("target-identity", "Target generation/content identity differs from the normalized source");
    normalizedTarget = { save, options, generationIdentity };
    // engine.loadSave uses Number(save.health)||10 then clamps, and builder
    // mode overrides vitals to 10. Preserve storage and load stages separately.
    legacyLoad = {
      health: { sourcePresent: Object.hasOwn(sourceSave, "health"), afterStorageNormalization: save.health, afterBuilderLoad: 10 },
      worldTime: (((Number(save.time) || 0.32) % 1) + 1) % 1,
      // engine.loadSave calls normalizeSkillState(save.skillState); it does NOT
      // substitute the selected profile's starting allocation on this path.
      explorationLevelWhenSourceAbsent: normalizeSkillState(undefined).skills.exploration.level,
    };
  }
  const actor: FreshRuntimeMigrationActorV1 = {
    profileId: profile.id, actorId: identity.actorId, commandActorId: identity.commandActorId,
    // CharacterProfile has no revision counter. Hash ALL canonical fields,
    // including createdAt/updatedAt; neither timestamp is renamed a revision.
    profileCanonicalHash: await domainHash("blockwild-character-profile-canonical-sha256-v1", profile),
  };
  const body = snapshotJson({
    policyVersion: 1 as const, policyId: FRESH_RUNTIME_MIGRATION_POLICY_ID_V1,
    status: "review-only" as const, nativeExecutionAllowed: false as const,
    sourceSubset: sourceBlockers.length === 0 ? "g16-g17-builder-empty-custody-v1" as const : null,
    source: { reference, semanticHash: semanticHash(document), document },
    target: { address: target, normalizedSemanticHash: normalizedTarget === null ? null : semanticHash(normalizedTarget) },
    actor, sourceBlockers, nativeUnimplementedTerms: NATIVE_UNIMPLEMENTED_TERMS,
    terms: { sourcePropertyPaths: sourcePropertyPaths(document), normalizedTarget, legacyLoad, freshRuntimeDecisions: FRESH_DECISIONS },
  });
  return Object.freeze({ ...body, proposalHash: await domainHash("blockwild-fresh-runtime-migration-proposal-sha256-v1", body) });
}

/** No capability token: this records exact review intent, never an executable plan. */
export async function validateRustFreshRuntimeMigrationConsentV1(proposal: unknown, decision: unknown, currentInput: unknown): Promise<FreshRuntimeMigrationConsentRecordV1> {
  const reviewed = snapshotJson(proposal);
  const consent = exact(snapshotJson(decision), ["schemaVersion", "decision", "proposalHash", "sourceRawSha256", "sourceByteLength", "sourceSemanticHash", "normalizedTargetSemanticHash", "target", "actor", "acknowledgements"], "consent");
  // Rebuild from fresh caller-supplied bindings, not from a self-declared hash
  // on the proposal. This also rejects changed terms with a copied/rehashed ID.
  const current = await planRustFreshRuntimeMigrationV1(currentInput);
  if (current.sourceBlockers.length !== 0) fail("source-blocked", "Source has unknown or unsupported data; consent cannot waive source blockers");
  if (canonical(reviewed) !== canonical(current)) fail("stale-proposal", "Reviewed proposal no longer matches the exact current source, target, actor, or policy");
  const expected = {
    schemaVersion: 1, decision: "affirm-review-only", proposalHash: current.proposalHash,
    sourceRawSha256: current.source.reference.rawSha256, sourceByteLength: current.source.reference.byteLength,
    sourceSemanticHash: current.source.semanticHash, normalizedTargetSemanticHash: current.target.normalizedSemanticHash,
    target: current.target.address, actor: current.actor, acknowledgements: FRESH_RUNTIME_MIGRATION_ACKNOWLEDGEMENTS_V1,
  };
  if (canonical(consent) !== canonical(expected)) fail("consent-binding", "Explicit review consent must match every binding and acknowledgement");
  return Object.freeze({ status: "consent-record-only", policyVersion: 1, proposalHash: current.proposalHash, nativeExecutionAllowed: false });
}
