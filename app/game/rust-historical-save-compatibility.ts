import type { WorldSave } from "./engine";
import { persistencePayloadHashV1 } from "./persistence-journal-contract";
import {
  classifyRustLegacyWorldSaveV1,
  planRustLegacyWorldMigrationV1,
  type RustLegacyStateDomainV1,
  type RustLegacyWorldAddressV1,
  type RustLegacyWorldProjectionV1,
} from "./rust-legacy-world-migration";
import {
  assertWorldImportSourceReferenceV1,
  type WorldImportSourceReferenceV1,
} from "./world-import-source";
import { encodeCanonicalWorldSaveValueV1 } from "./world-save-sharding";
import {
  deriveWorldGenerationIdentityV1,
  migrateLegacyWorldSave,
  normalizeWorldOptions,
  type WorldGenerationIdentityV1,
  type WorldOptions,
} from "./world-storage";

// These normalization helpers are intentionally invoked only while a plan is
// built. Before WorldStorage consumes this planner, move the pure helpers to a
// shared leaf module so storage never imports back through this file.

/**
 * Pure planning contract for the narrow R3 historical-save lane.
 *
 * Rust may adopt only the exact BWAS edit/facing projection. Every other
 * normalized save property remains explicitly owned by the TypeScript save
 * document. This plan neither mutates storage nor authorizes R5/R8 execution;
 * a later persistence transport must independently prove archive durability,
 * a pristine native target, exact native readback and atomic checkpointing.
 */
export const RUST_HISTORICAL_SAVE_COMPATIBILITY_SCHEMA_V1 = 1 as const;
export const RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1 =
  "rust-terrain-generation-plus-typescript-historical-save-compatibility-only" as const;
export const RUST_HISTORICAL_SAVE_COMPATIBILITY_PROFILE_V1 =
  "typescript-historical-save-compatibility-v1" as const;

const MAX_JSON_DEPTH_V1 = 64;
const MAX_JSON_NODES_V1 = 100_000;
const HASH_V1 = /^[0-9a-f]{32}$/u;
const CATALOG_WORLD_ID_V1 = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
const LOCATION_ID_V1 = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/u;
const IMPORT_FINGERPRINT_V1 = /^worldfp_[A-Za-z0-9_-]{8,120}$/u;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const byteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const resizableBufferGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const setBytes = Uint8Array.prototype.set;

const SOURCE_ROOT_KEYS = Object.freeze(["exportedAt", "format", "ownershipNotice", "version", "world"]);
const SOURCE_WORLD_KEYS = Object.freeze(["metadata", "options", "save", "version"]);
const SOURCE_METADATA_KEYS = Object.freeze([
  "createdAt", "generationIdentity", "id", "lastPlayedAt", "lastSavedGameVersion",
  "mode", "name", "ownership", "playTimeMs", "seed", "updatedAt",
]);
const SOURCE_OPTION_KEYS = new Set([
  "biomeScale", "butterflyDensity", "caveFrequency", "dayLengthMinutes", "difficulty",
  "enabledFactions", "friendlyFire", "keepInventory", "largeTownFrequency", "mobDensity",
  "origin", "resourceAbundance", "roadCoverage", "settlementClustering", "settlementDensity",
  "settlementPattern", "sleepPercentage", "sleepRule", "structures", "weather",
]);
const NORMALIZED_METADATA_PROPERTIES = new Set([
  "agentWorldFingerprint", "generatorProfile", "generatorVersion", "lastSavedGameVersion",
  "savedAt", "seed", "version",
]);
const NATIVE_WORLD_PROPERTIES = new Set(["blockFacings", "edits"]);

const EXTERNAL_DOMAIN_BY_LEGACY_DOMAIN = Object.freeze({
  entities: "typescript-entities",
  player: "typescript-player",
  "runtime-clocks": "typescript-runtime-clocks",
  gameplay: "typescript-gameplay",
  machines: "typescript-machines",
  map: "typescript-map",
  network: "typescript-network",
} satisfies Readonly<Record<Exclude<RustLegacyStateDomainV1, "unknown">, RustHistoricalSaveCustodyDomainIdV1>>);

const DOMAIN_ORDER = Object.freeze([
  "native-world-r4",
  "typescript-source-metadata",
  "typescript-entities",
  "typescript-player",
  "typescript-runtime-clocks",
  "typescript-gameplay",
  "typescript-machines",
  "typescript-map",
  "typescript-network",
] as const);

export type RustHistoricalSaveCustodyDomainIdV1 = typeof DOMAIN_ORDER[number];

export type RustHistoricalSaveCompatibilityAuthorityV1 = Readonly<{
  claim: typeof RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1;
  nativePlayer: "off";
  nativeRichState: "not-adopted";
}>;

export type RustHistoricalSaveCompatibilityTargetV1 = Readonly<{
  catalogWorldId: string;
  universeId: string;
  locationId: string;
  worldSeed: string;
  /** Installed native content-manifest identity, distinct from terrain content. */
  contentHash: string;
  generationIdentity: WorldGenerationIdentityV1;
}>;

export type RustHistoricalSaveCompatibilityInputV1 = Readonly<{
  schemaVersion: typeof RUST_HISTORICAL_SAVE_COMPATIBILITY_SCHEMA_V1;
  authority: RustHistoricalSaveCompatibilityAuthorityV1;
  originalSource: WorldImportSourceReferenceV1;
  /** Fresh exact readback of originalSource, not decoded-text import input. */
  sourceBytes: Uint8Array;
  normalizedSource: Readonly<{ save: WorldSave; options: WorldOptions }>;
  target: RustHistoricalSaveCompatibilityTargetV1;
}>;

export type RustHistoricalSaveCustodyDomainV1 = Readonly<{
  id: RustHistoricalSaveCustodyDomainIdV1;
  owner: "rust-native-world-r4" | "typescript-external-save-v1";
  properties: readonly string[];
  /** Canonical value root for this exact property subset. */
  semanticHash: string;
}>;

export type RustHistoricalSaveCompatibilityReadbackV1 = Readonly<{
  universeId: string;
  locationId: string;
  projectionHash: string;
  projectionByteLength: number;
  nativeWorldSemanticHash: string;
  editCount: number;
  facingCount: number;
}>;

export type RustHistoricalSaveCompatibilityPlanV1 = Readonly<{
  schemaVersion: typeof RUST_HISTORICAL_SAVE_COMPATIBILITY_SCHEMA_V1;
  profile: typeof RUST_HISTORICAL_SAVE_COMPATIBILITY_PROFILE_V1;
  status: "external-custody-planned";
  authority: RustHistoricalSaveCompatibilityAuthorityV1;
  nativeExecutionScope: "world-r4-projection-only";
  source: Readonly<{
    raw: Readonly<WorldImportSourceReferenceV1 & { generatorVersion: 16 | 17 }>;
    normalized: Readonly<{
      semanticHash: string;
      byteLength: number;
      /** Owned canonical snapshot; revalidation detects any later byte mutation. */
      canonicalBytes: Uint8Array;
    }>;
  }>;
  target: Readonly<RustHistoricalSaveCompatibilityTargetV1 & {
    options: WorldOptions;
    optionsSemanticHash: string;
    optionsByteLength: number;
  }>;
  sourceProperties: readonly string[];
  domains: readonly RustHistoricalSaveCustodyDomainV1[];
  externalStateFlags: number;
  nativeWorld: Readonly<{
    address: RustLegacyWorldAddressV1;
    projectionHash: string;
    projectionByteLength: number;
    projectionBytes: Uint8Array;
    compatibilityChecksum: string;
    extensionChecksum: string;
    editCount: number;
    facingCount: number;
    expectedReadback: RustHistoricalSaveCompatibilityReadbackV1;
  }>;
  custodyRoot: string;
  planHash: string;
}>;

export class RustHistoricalSaveCompatibilityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RustHistoricalSaveCompatibilityError";
  }
}

function fail(code: string, message: string): never {
  throw new RustHistoricalSaveCompatibilityError(code, message);
}

function ordinaryRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail("shape", `${label} must be a plain record`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor)) {
      fail("shape", `${label} must contain only enumerable string data properties`);
    }
  }
  return value as Record<string, unknown>;
}

function exactRecord(value: unknown, keys: readonly string[], label: string) {
  const result = ordinaryRecord(value, label);
  const actual = Object.keys(result).sort(compareOrdinal);
  const expected = [...keys].sort(compareOrdinal);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("shape", `${label} has missing or unsupported fields`);
  }
  return result;
}

function compareOrdinal(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function safeInteger(value: unknown, label: string, minimum = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    fail("integer", `${label} must be an exact safe integer at least ${minimum}`);
  }
  return value;
}

function canonicalHash(value: unknown, label: string) {
  if (typeof value !== "string" || !HASH_V1.test(value)) fail("hash", `${label} must be lowercase 128-bit hexadecimal`);
  return value;
}

function visible(value: unknown, label: string, maximumUtf16: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumUtf16) {
    fail("identity", `${label} is empty or exceeds its UTF-16 bound`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x1f || unit === 0x7f) fail("identity", `${label} contains a control character`);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail("identity", `${label} contains an unpaired surrogate`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail("identity", `${label} contains an unpaired surrogate`);
  }
  return value;
}

/** Snapshot all mutable JSON inputs before validation or canonical hashing. */
function snapshotJson<T>(input: T): T {
  let nodes = 0;
  const ancestors = new Set<object>();
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > MAX_JSON_NODES_V1 || depth > MAX_JSON_DEPTH_V1) fail("json-bound", "Historical compatibility JSON exceeds its node/depth bound");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("json-finite", "Historical compatibility JSON numbers must be finite");
      return value;
    }
    if (typeof value !== "object") fail("json-shape", "Historical compatibility data must be strict JSON");
    const isArray = Array.isArray(value);
    if (!isArray && (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      fail("json-shape", "Historical compatibility records must have an ordinary prototype");
    }
    if (isArray && Object.getPrototypeOf(value) !== Array.prototype) {
      fail("json-array", "Historical compatibility arrays must have the ordinary Array prototype");
    }
    if (ancestors.has(value)) fail("json-cycle", "Historical compatibility data must not contain cycles");
    ancestors.add(value);
    const keys = Reflect.ownKeys(value).filter(key => !isArray || key !== "length");
    if (keys.some(key => typeof key !== "string" || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
      || !("value" in Object.getOwnPropertyDescriptor(value, key)!))) {
      fail("json-shape", "Historical compatibility data must contain only enumerable data properties");
    }
    let result: unknown;
    if (isArray) {
      if (keys.length !== (value as unknown[]).length || keys.some((key, index) => key !== String(index))) {
        fail("json-array", "Historical compatibility arrays must be dense and have no extra properties");
      }
      const array: unknown[] = [];
      for (let index = 0; index < (value as unknown[]).length; index += 1) {
        array.push(copy(Object.getOwnPropertyDescriptor(value, String(index))!.value, depth + 1));
      }
      result = Object.freeze(array);
    } else {
      const record: Record<string, unknown> = {};
      for (const key of keys as string[]) {
        Object.defineProperty(record, key, {
          value: copy(Object.getOwnPropertyDescriptor(value, key)!.value, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      result = Object.freeze(record);
    }
    ancestors.delete(value);
    return result;
  }
  return copy(input, 0) as T;
}

/** Ordinary fixed Uint8Array snapshot with no iterator/species/accessor dispatch. */
function snapshotBytes(value: unknown, expectedLength?: number) {
  if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
    fail("byte-shape", "Historical source bytes must have the ordinary Uint8Array prototype");
  }
  for (const key of ["buffer", "byteOffset", "byteLength", "constructor", Symbol.iterator]) {
    if (Object.hasOwn(value, key)) fail("byte-hook", "Historical source bytes must not override intrinsic access or iteration");
  }
  const buffer = byteBufferGetter.call(value) as ArrayBuffer;
  const byteOffset = byteOffsetGetter.call(value) as number;
  const byteLength = byteLengthGetter.call(value) as number;
  if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || resizableBufferGetter?.call(buffer)) {
    fail("byte-buffer", "Historical source bytes require an ordinary fixed ArrayBuffer");
  }
  if (expectedLength !== undefined && byteLength !== expectedLength) {
    fail("source-length", "Historical source bytes do not match their archived byte length");
  }
  const output = new Uint8Array(byteLength);
  setBytes.call(output, new Uint8Array(buffer, byteOffset, byteLength));
  // ECMAScript forbids sealing/freezing non-empty typed arrays. The returned
  // bytes are nevertheless caller-independent; plan revalidation binds every
  // byte and rejects any later mutation before consumption.
  return output;
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

async function rawSha256(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) fail("source-crypto", "Historical source verification requires Web Crypto SHA-256");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function semanticBytes(value: unknown) {
  const bytes = encodeCanonicalWorldSaveValueV1(value);
  return Object.freeze({ bytes: Uint8Array.from(bytes), hash: persistencePayloadHashV1(bytes) });
}

function canonicalEqual(left: unknown, right: unknown) {
  return equalBytes(encodeCanonicalWorldSaveValueV1(left), encodeCanonicalWorldSaveValueV1(right));
}

/** JSON.parse already checked syntax; reject duplicate last-property-wins ambiguity. */
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
        if (context.keys.has(key)) fail("source-duplicate-key", "Duplicate JSON property names cannot enter historical compatibility custody");
        context.keys.add(key);
        context.expectKey = false;
      }
    }
  }
}

function assertAllowedRawDocument(document: unknown) {
  const root = exactRecord(document, SOURCE_ROOT_KEYS, "original source");
  if (root.format !== "blockwild-world" || root.version !== 1) fail("source-format", "Historical source must be a version-one Blockwild export");
  const world = exactRecord(root.world, SOURCE_WORLD_KEYS, "original source.world");
  if (world.version !== 1) fail("source-format", "Historical source world envelope must be version one");
  const metadata = exactRecord(world.metadata, SOURCE_METADATA_KEYS, "original source.world.metadata");
  const options = ordinaryRecord(world.options, "original source.world.options");
  const save = ordinaryRecord(world.save, "original source.world.save");
  for (const key of Object.keys(options)) if (!SOURCE_OPTION_KEYS.has(key)) fail("source-option", `Historical source option ${key} is unknown`);
  if (Object.hasOwn(options, "origin")) {
    const origin = ordinaryRecord(options.origin, "original source.world.options.origin");
    const allowed = origin.mode === "culture-settlement" ? ["factionId", "minimumSize", "mode"] : ["mode"];
    exactRecord(origin, allowed, "original source.world.options.origin");
  }
  if (metadata.seed !== save.seed || metadata.mode !== save.mode) fail("source-identity", "Historical source metadata and save identity disagree");
  if (metadata.generationIdentity !== null) fail("source-identity", "Historical g16/g17 source must not claim a current generation identity");
  if (save.generatorVersion !== 16 && save.generatorVersion !== 17) fail("source-version", "Only exact g16/g17 historical sources are supported by this profile");
  if (Object.hasOwn(save, "agentWorldFingerprint")) fail("source-identity", "Original historical source must not predeclare the imported catalog fingerprint");
  return Object.freeze({ root, world, metadata, options, save, generatorVersion: save.generatorVersion as 16 | 17 });
}

function validateAuthority(value: unknown): RustHistoricalSaveCompatibilityAuthorityV1 {
  const authority = exactRecord(value, ["claim", "nativePlayer", "nativeRichState"], "authority");
  if (authority.claim !== RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1
    || authority.nativePlayer !== "off" || authority.nativeRichState !== "not-adopted") {
    fail("authority", "Historical compatibility cannot request R5 player or native-rich adoption authority");
  }
  return Object.freeze({
    claim: RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1,
    nativePlayer: "off",
    nativeRichState: "not-adopted",
  });
}

function validateTarget(
  value: unknown,
  save: WorldSave,
  options: WorldOptions,
): RustHistoricalSaveCompatibilityPlanV1["target"] {
  const target = exactRecord(value, ["catalogWorldId", "universeId", "locationId", "worldSeed", "contentHash", "generationIdentity"], "target");
  if (typeof target.catalogWorldId !== "string" || !CATALOG_WORLD_ID_V1.test(target.catalogWorldId)) {
    fail("target", "Historical target catalog world ID is not canonical");
  }
  const universeId = visible(target.universeId, "target.universeId", 64);
  const locationId = visible(target.locationId, "target.locationId", 128);
  if (universeId !== `world:${target.catalogWorldId}` || !LOCATION_ID_V1.test(locationId)) {
    fail("target", "Historical target address does not match its catalog identity");
  }
  const worldSeed = visible(target.worldSeed, "target.worldSeed", 512);
  if (worldSeed !== save.seed) fail("target", "Historical target seed differs from its normalized source");
  const expectedFingerprintPrefix = `worldfp_import_${target.catalogWorldId}_`;
  if (typeof save.agentWorldFingerprint !== "string"
    || !save.agentWorldFingerprint.startsWith(expectedFingerprintPrefix)
    || !/^[0-9a-z]+$/u.test(save.agentWorldFingerprint.slice(expectedFingerprintPrefix.length))) {
    fail("target", "Historical target catalog ID differs from its normalized import fingerprint");
  }
  const contentHash = canonicalHash(target.contentHash, "target.contentHash");
  const identity = exactRecord(target.generationIdentity,
    ["generationOptionsJson", "generatorHash", "schemaVersion", "terrainContentHash"], "target.generationIdentity");
  const generationIdentity: WorldGenerationIdentityV1 = Object.freeze({
    schemaVersion: identity.schemaVersion as 1,
    generatorHash: canonicalHash(identity.generatorHash, "target.generatorHash"),
    terrainContentHash: canonicalHash(identity.terrainContentHash, "target.terrainContentHash"),
    generationOptionsJson: typeof identity.generationOptionsJson === "string" ? identity.generationOptionsJson : fail("target", "Target generation options identity must be canonical JSON"),
  });
  if (generationIdentity.schemaVersion !== 1 || !canonicalEqual(generationIdentity, deriveWorldGenerationIdentityV1(save, options))) {
    fail("target", "Historical target generator, terrain content or generation options identity drifted");
  }
  const encodedOptions = semanticBytes(options);
  return Object.freeze({
    catalogWorldId: target.catalogWorldId,
    universeId,
    locationId,
    worldSeed,
    contentHash,
    generationIdentity,
    options,
    optionsSemanticHash: encodedOptions.hash,
    optionsByteLength: encodedOptions.bytes.byteLength,
  });
}

function expectedNormalizedOptions(rawOptions: Record<string, unknown>, version: 16 | 17) {
  return normalizeWorldOptions(version === 16
    ? { ...rawOptions, settlementPattern: "legacy-scattered-v1" }
    : rawOptions);
}

function expectedNormalizedSave(rawSave: Record<string, unknown>, supplied: Readonly<Record<string, unknown>>) {
  const normalized = migrateLegacyWorldSave(rawSave);
  if (!normalized) fail("source-normalization", "Historical source did not pass the production legacy normalizer");
  const fingerprint = supplied.agentWorldFingerprint;
  if (typeof fingerprint !== "string" || !IMPORT_FINGERPRINT_V1.test(fingerprint)) {
    fail("source-normalization", "Normalized imported source lacks its canonical catalog fingerprint");
  }
  return Object.freeze({ ...normalized, agentWorldFingerprint: fingerprint }) as WorldSave;
}

function assertNoUnreviewedNormalizationLoss(
  rawSave: Readonly<Record<string, unknown>>,
  normalizedSave: Readonly<Record<string, unknown>>,
  rawOptions: Readonly<Record<string, unknown>>,
  normalizedOptions: Readonly<Record<string, unknown>>,
) {
  // Generator 16/17 -> current is the one deliberate lossy save-field rewrite
  // admitted by this profile. Every other source value must survive production
  // normalization byte-for-byte; otherwise its nested state has no custody row.
  for (const key of Object.keys(rawSave)) {
    if (key === "generatorVersion") continue;
    if (!Object.hasOwn(normalizedSave, key) || !canonicalEqual(rawSave[key], normalizedSave[key])) {
      fail("lossy-normalization", `Historical save property ${key} changes or loses data during normalization`);
    }
  }
  // Missing historical options may receive reviewed defaults. Present values
  // may not be clamped, rewritten, or partially discarded.
  for (const key of Object.keys(rawOptions)) {
    if (!Object.hasOwn(normalizedOptions, key) || !canonicalEqual(rawOptions[key], normalizedOptions[key])) {
      fail("lossy-normalization", `Historical world option ${key} changes or loses data during normalization`);
    }
  }
}

function domainValues(save: Readonly<Record<string, unknown>>, properties: readonly string[]) {
  const values: Record<string, unknown> = {};
  for (const property of properties) values[property] = save[property];
  return values;
}

function buildCustodyDomains(
  save: Readonly<Record<string, unknown>>,
  projection: RustLegacyWorldProjectionV1,
) {
  if (Object.hasOwn(save, "liquidLevels")) {
    fail("unsupported-liquid", "Historical liquidLevels have no BWAS projection and cannot be relabeled as external custody");
  }
  const withoutImportFingerprint = { ...save };
  delete withoutImportFingerprint.agentWorldFingerprint;
  const classification = classifyRustLegacyWorldSaveV1(withoutImportFingerprint);
  if (classification.properties.unknown?.length) {
    fail("unassigned-property", `Historical source has unknown or unassigned properties: ${classification.properties.unknown.join(", ")}`);
  }
  if (projection.ignoredOrphanFacings !== 0) {
    fail("orphan-facing", "Historical block facings include entries without an exact final edited block");
  }
  const propertySets = new Map<RustHistoricalSaveCustodyDomainIdV1, Set<string>>(
    DOMAIN_ORDER.map(id => [id, new Set<string>()]),
  );
  for (const property of Object.keys(save)) {
    if (NATIVE_WORLD_PROPERTIES.has(property)) propertySets.get("native-world-r4")!.add(property);
    else if (NORMALIZED_METADATA_PROPERTIES.has(property)) propertySets.get("typescript-source-metadata")!.add(property);
  }
  for (const [legacyDomain, externalDomain] of Object.entries(EXTERNAL_DOMAIN_BY_LEGACY_DOMAIN) as Array<[
    Exclude<RustLegacyStateDomainV1, "unknown">,
    RustHistoricalSaveCustodyDomainIdV1,
  ]>) {
    for (const property of classification.properties[legacyDomain] ?? []) propertySets.get(externalDomain)!.add(property);
  }
  const sourceProperties = Object.freeze(Object.keys(save).sort(compareOrdinal));
  const ownerByProperty = new Map<string, string>();
  const domains = DOMAIN_ORDER.map(id => {
    const properties = Object.freeze([...propertySets.get(id)!].sort(compareOrdinal));
    for (const property of properties) {
      if (ownerByProperty.has(property)) fail("duplicate-property-owner", `Historical property ${property} has duplicate custody owners`);
      ownerByProperty.set(property, id);
    }
    const owner = id === "native-world-r4" ? "rust-native-world-r4" : "typescript-external-save-v1";
    const semanticHash = id === "native-world-r4"
      ? projection.projectionHash
      : persistencePayloadHashV1(encodeCanonicalWorldSaveValueV1(domainValues(save, properties)));
    return Object.freeze({ id, owner, properties, semanticHash }) as RustHistoricalSaveCustodyDomainV1;
  });
  const unassigned = sourceProperties.filter(property => !ownerByProperty.has(property));
  if (unassigned.length) fail("unassigned-property", `Historical properties lack an explicit custody owner: ${unassigned.join(", ")}`);
  if (ownerByProperty.size !== sourceProperties.length) fail("duplicate-property-owner", "Historical property ownership is not one-to-one");
  if (classification.flags === 0) fail("world-only-route", "A world-only source must use the existing guarded world-only migration path");
  return Object.freeze({
    sourceProperties,
    domains: Object.freeze(domains),
    externalStateFlags: classification.flags,
  });
}

function planHashBody(plan: Omit<RustHistoricalSaveCompatibilityPlanV1, "planHash">) {
  return {
    schemaVersion: plan.schemaVersion,
    profile: plan.profile,
    status: plan.status,
    authority: plan.authority,
    nativeExecutionScope: plan.nativeExecutionScope,
    source: {
      raw: plan.source.raw,
      normalized: {
        semanticHash: plan.source.normalized.semanticHash,
        byteLength: plan.source.normalized.byteLength,
      },
    },
    target: plan.target,
    sourceProperties: plan.sourceProperties,
    domains: plan.domains,
    externalStateFlags: plan.externalStateFlags,
    nativeWorld: {
      address: plan.nativeWorld.address,
      projectionHash: plan.nativeWorld.projectionHash,
      projectionByteLength: plan.nativeWorld.projectionByteLength,
      compatibilityChecksum: plan.nativeWorld.compatibilityChecksum,
      extensionChecksum: plan.nativeWorld.extensionChecksum,
      editCount: plan.nativeWorld.editCount,
      facingCount: plan.nativeWorld.facingCount,
      expectedReadback: plan.nativeWorld.expectedReadback,
    },
    custodyRoot: plan.custodyRoot,
  };
}

function custodyRoot(
  sourceProperties: readonly string[],
  domains: readonly RustHistoricalSaveCustodyDomainV1[],
) {
  return persistencePayloadHashV1(encodeCanonicalWorldSaveValueV1({
    schemaVersion: RUST_HISTORICAL_SAVE_COMPATIBILITY_SCHEMA_V1,
    profile: RUST_HISTORICAL_SAVE_COMPATIBILITY_PROFILE_V1,
    sourceProperties,
    domains,
  }));
}

export async function planRustHistoricalSaveCompatibilityV1(input: unknown): Promise<RustHistoricalSaveCompatibilityPlanV1> {
  const root = exactRecord(input, ["schemaVersion", "authority", "originalSource", "sourceBytes", "normalizedSource", "target"], "historical compatibility input");
  if (root.schemaVersion !== RUST_HISTORICAL_SAVE_COMPATIBILITY_SCHEMA_V1) fail("schema", "Only historical compatibility schema one is supported");
  const authority = validateAuthority(snapshotJson(root.authority));
  const reference = snapshotJson(root.originalSource);
  try { assertWorldImportSourceReferenceV1(reference); }
  catch (error) { fail("source-provenance", error instanceof Error ? error.message : "Original source provenance is invalid"); }
  const sourceBytes = snapshotBytes(root.sourceBytes, reference.byteLength);
  const normalizedInput = exactRecord(snapshotJson(root.normalizedSource), ["options", "save"], "normalized source");
  const suppliedSave = ordinaryRecord(normalizedInput.save, "normalized source.save") as unknown as WorldSave;
  const suppliedOptions = ordinaryRecord(normalizedInput.options, "normalized source.options") as unknown as WorldOptions;
  const targetInput = snapshotJson(root.target);

  // All caller-owned mutable inputs are copied before the asynchronous digest.
  // Recompute the archive identity here as well: a structural source reference
  // is forgeable and must not be allowed to relabel same-length bytes.
  if (await rawSha256(sourceBytes) !== reference.rawSha256) {
    fail("source-hash", "Historical source bytes do not match their archived SHA-256 identity");
  }
  let json: string;
  let parsed: unknown;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
    parsed = JSON.parse(json);
  } catch {
    fail("source-json", "Original historical source must be valid UTF-8 JSON");
  }
  assertUniqueJsonKeys(json);
  const raw = assertAllowedRawDocument(snapshotJson(parsed));
  const normalizedOptions = snapshotJson(expectedNormalizedOptions(raw.options, raw.generatorVersion));
  if (!canonicalEqual(suppliedOptions, normalizedOptions)) fail("options-drift", "Normalized historical options differ from production import semantics");
  const normalizedSave = snapshotJson(expectedNormalizedSave(raw.save, suppliedSave));
  if (!canonicalEqual(suppliedSave, normalizedSave)) fail("source-drift", "Canonical normalized source bytes differ from production import semantics");
  assertNoUnreviewedNormalizationLoss(raw.save, normalizedSave as unknown as Readonly<Record<string, unknown>>, raw.options, normalizedOptions);
  const target = validateTarget(targetInput, normalizedSave, normalizedOptions);
  let projectionPlan: ReturnType<typeof planRustLegacyWorldMigrationV1>;
  try {
    projectionPlan = planRustLegacyWorldMigrationV1({
      save: normalizedSave,
      address: { universeId: target.universeId, locationId: target.locationId },
    });
  } catch (error) {
    fail("invalid-projection", `Historical save cannot form an exact BWAS projection: ${error instanceof Error ? error.message : String(error)}`);
  }
  const projection = projectionPlan.projection;
  const custody = buildCustodyDomains(normalizedSave as unknown as Readonly<Record<string, unknown>>, projection);
  const normalized = semanticBytes(normalizedSave);
  const projectionBytes = Uint8Array.from(projection.bytes);
  const expectedReadback: RustHistoricalSaveCompatibilityReadbackV1 = Object.freeze({
    universeId: target.universeId,
    locationId: target.locationId,
    projectionHash: projection.projectionHash,
    projectionByteLength: projectionBytes.byteLength,
    nativeWorldSemanticHash: projection.projectionHash,
    editCount: projection.editCount,
    facingCount: projection.facingCount,
  });
  const rootHash = custodyRoot(custody.sourceProperties, custody.domains);
  const body = Object.freeze({
    schemaVersion: RUST_HISTORICAL_SAVE_COMPATIBILITY_SCHEMA_V1,
    profile: RUST_HISTORICAL_SAVE_COMPATIBILITY_PROFILE_V1,
    status: "external-custody-planned" as const,
    authority,
    nativeExecutionScope: "world-r4-projection-only" as const,
    source: Object.freeze({
      raw: Object.freeze({ ...reference, generatorVersion: raw.generatorVersion }),
      normalized: Object.freeze({ semanticHash: normalized.hash, byteLength: normalized.bytes.byteLength, canonicalBytes: normalized.bytes }),
    }),
    target,
    sourceProperties: custody.sourceProperties,
    domains: custody.domains,
    externalStateFlags: custody.externalStateFlags,
    nativeWorld: Object.freeze({
      address: Object.freeze({ universeId: target.universeId, locationId: target.locationId }),
      projectionHash: projection.projectionHash,
      projectionByteLength: projectionBytes.byteLength,
      projectionBytes,
      compatibilityChecksum: projection.compatibilityChecksum,
      extensionChecksum: projection.extensionChecksum,
      editCount: projection.editCount,
      facingCount: projection.facingCount,
      expectedReadback,
    }),
    custodyRoot: rootHash,
  }) satisfies Omit<RustHistoricalSaveCompatibilityPlanV1, "planHash">;
  return Object.freeze({ ...body, planHash: persistencePayloadHashV1(encodeCanonicalWorldSaveValueV1(planHashBody(body))) });
}

function ordinaryArray(value: unknown, label: string) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("plan-shape", `${label} must be an ordinary array`);
  const keys = Reflect.ownKeys(value).filter(key => key !== "length");
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index)
    || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !("value" in Object.getOwnPropertyDescriptor(value, key)!))) {
    fail("plan-shape", `${label} must be dense and contain only data entries`);
  }
  return value;
}

function assertCandidateOwnership(value: unknown) {
  const plan = ordinaryRecord(value, "historical compatibility plan");
  const domains = ordinaryArray(plan.domains, "plan.domains");
  const owners = new Map<string, string>();
  for (let index = 0; index < domains.length; index += 1) {
    const domain = ordinaryRecord(Object.getOwnPropertyDescriptor(domains, String(index))!.value, `plan.domains[${index}]`);
    const id = domain.id;
    if (typeof id !== "string" || !DOMAIN_ORDER.includes(id as RustHistoricalSaveCustodyDomainIdV1)) fail("plan-shape", "Plan domain identity is unsupported");
    const properties = ordinaryArray(domain.properties, `plan.domains[${index}].properties`);
    for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
      const property = Object.getOwnPropertyDescriptor(properties, String(propertyIndex))!.value;
      if (typeof property !== "string") fail("plan-shape", "Plan property identity must be a string");
      if (owners.has(property)) fail("duplicate-property-owner", `Historical property ${property} has duplicate custody owners`);
      owners.set(property, id);
    }
  }
}

function comparablePlan(value: unknown) {
  const root = exactRecord(value, [
    "authority", "custodyRoot", "domains", "externalStateFlags", "nativeExecutionScope",
    "nativeWorld", "planHash", "profile", "schemaVersion", "source", "sourceProperties",
    "status", "target",
  ], "historical compatibility plan") as unknown as RustHistoricalSaveCompatibilityPlanV1;
  assertCandidateOwnership(root);
  const source = exactRecord(root.source, ["normalized", "raw"], "plan.source");
  const normalized = exactRecord(source.normalized, ["byteLength", "canonicalBytes", "semanticHash"], "plan.source.normalized");
  const nativeWorld = exactRecord(root.nativeWorld, [
    "address", "compatibilityChecksum", "editCount", "expectedReadback", "extensionChecksum",
    "facingCount", "projectionByteLength", "projectionBytes", "projectionHash",
  ], "plan.nativeWorld");
  const canonicalBytes = snapshotBytes(normalized.canonicalBytes);
  const projectionBytes = snapshotBytes(nativeWorld.projectionBytes);
  if (persistencePayloadHashV1(canonicalBytes) !== normalized.semanticHash
    || canonicalBytes.byteLength !== normalized.byteLength) {
    fail("plan-source", "Plan canonical normalized bytes do not match their hash/length binding");
  }
  if (persistencePayloadHashV1(projectionBytes) !== nativeWorld.projectionHash
    || projectionBytes.byteLength !== nativeWorld.projectionByteLength) {
    fail("plan-projection", "Plan BWAS bytes do not match their hash/length binding");
  }
  const plain = snapshotJson({
    schemaVersion: root.schemaVersion,
    profile: root.profile,
    status: root.status,
    authority: root.authority,
    nativeExecutionScope: root.nativeExecutionScope,
    source: {
      raw: root.source.raw,
      normalized: {
        semanticHash: root.source.normalized.semanticHash,
        byteLength: root.source.normalized.byteLength,
      },
    },
    target: root.target,
    sourceProperties: root.sourceProperties,
    domains: root.domains,
    externalStateFlags: root.externalStateFlags,
    nativeWorld: {
      address: root.nativeWorld.address,
      projectionHash: root.nativeWorld.projectionHash,
      projectionByteLength: root.nativeWorld.projectionByteLength,
      compatibilityChecksum: root.nativeWorld.compatibilityChecksum,
      extensionChecksum: root.nativeWorld.extensionChecksum,
      editCount: root.nativeWorld.editCount,
      facingCount: root.nativeWorld.facingCount,
      expectedReadback: root.nativeWorld.expectedReadback,
    },
    custodyRoot: root.custodyRoot,
    planHash: root.planHash,
  });
  return Object.freeze({ plain, canonicalBytes, projectionBytes });
}

/** Rebuild from fresh inputs and reject any stale, resealed or mutated plan. */
export async function assertRustHistoricalSaveCompatibilityPlanV1(
  value: unknown,
  currentInput: unknown,
): Promise<RustHistoricalSaveCompatibilityPlanV1> {
  const candidate = comparablePlan(value);
  const expected = await planRustHistoricalSaveCompatibilityV1(currentInput);
  const canonical = comparablePlan(expected);
  if (!canonicalEqual(candidate.plain, canonical.plain)
    || !equalBytes(candidate.canonicalBytes, canonical.canonicalBytes)
    || !equalBytes(candidate.projectionBytes, canonical.projectionBytes)) {
    fail("stale-plan", "Historical compatibility plan no longer matches its exact source, target, custody, or BWAS projection");
  }
  return expected;
}

/** Validate post-import Rust world readback without granting any richer authority. */
export function assertRustHistoricalSaveCompatibilityReadbackV1(
  plan: RustHistoricalSaveCompatibilityPlanV1,
  value: unknown,
): RustHistoricalSaveCompatibilityReadbackV1 {
  if (plan.authority.claim !== RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1
    || plan.authority.nativePlayer !== "off" || plan.authority.nativeRichState !== "not-adopted"
    || plan.nativeExecutionScope !== "world-r4-projection-only") {
    fail("authority", "Historical readback cannot validate an R5 or native-rich plan");
  }
  const readback = exactRecord(value, [
    "editCount", "facingCount", "locationId", "nativeWorldSemanticHash", "projectionByteLength",
    "projectionHash", "universeId",
  ], "native readback");
  const normalized: RustHistoricalSaveCompatibilityReadbackV1 = Object.freeze({
    universeId: visible(readback.universeId, "readback.universeId", 64),
    locationId: visible(readback.locationId, "readback.locationId", 128),
    projectionHash: canonicalHash(readback.projectionHash, "readback.projectionHash"),
    projectionByteLength: safeInteger(readback.projectionByteLength, "readback.projectionByteLength", 1),
    nativeWorldSemanticHash: canonicalHash(readback.nativeWorldSemanticHash, "readback.nativeWorldSemanticHash"),
    editCount: safeInteger(readback.editCount, "readback.editCount"),
    facingCount: safeInteger(readback.facingCount, "readback.facingCount"),
  });
  if (!canonicalEqual(normalized, plan.nativeWorld.expectedReadback)) {
    fail("native-readback", "Native world readback does not reproduce the exact BWAS projection and target");
  }
  return normalized;
}
