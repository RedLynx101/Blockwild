import type { WorldSave } from "./engine";
import {
  RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1,
  RUST_HISTORICAL_SAVE_COMPATIBILITY_SCHEMA_V1,
  type RustHistoricalSaveCompatibilityInputV1,
} from "./rust-historical-save-compatibility";
import {
  deriveWorldGenerationIdentityV1,
  migrateLegacyWorldSave,
  normalizeWorldOptions,
} from "./world-save-normalization";
import { stableTerrainGenerationJsonV2 } from "./terrain-generation-contract";
import {
  assertWorldImportSourceReferenceV1,
  type WorldImportSourceReferenceV1,
} from "./world-import-source";
import type { StoredWorld } from "./world-storage";

const CONTENT_HASH = /^[0-9a-f]{32}$/u;
const IMPORT_FINGERPRINT = /^worldfp_import_([a-z0-9][a-z0-9_-]{0,47})_([0-9a-z]+)$/u;
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class RustHistoricalSaveStoragePlanError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RustHistoricalSaveStoragePlanError";
  }
}

function fail(code: string, message: string): never {
  throw new RustHistoricalSaveStoragePlanError(code, message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("shape", `${label} must be a record`);
  }
  return value as Record<string, unknown>;
}

function equalJson(left: unknown, right: unknown) {
  return stableTerrainGenerationJsonV2(left) === stableTerrainGenerationJsonV2(right);
}

function exactGenerationIdentity(
  left: StoredWorld["metadata"]["generationIdentity"],
  right: NonNullable<StoredWorld["metadata"]["generationIdentity"]>,
) {
  return left !== null
    && left.schemaVersion === right.schemaVersion
    && left.generatorHash === right.generatorHash
    && left.terrainContentHash === right.terrainContentHash
    && left.generationOptionsJson === right.generationOptionsJson;
}

function exactSourceReference(
  left: WorldImportSourceReferenceV1,
  right: WorldImportSourceReferenceV1,
) {
  return left.schemaVersion === right.schemaVersion
    && left.provenance === right.provenance
    && left.sourceFormat === right.sourceFormat
    && left.encoding === right.encoding
    && left.archiveWorldId === right.archiveWorldId
    && left.objectId === right.objectId
    && left.rawSha256 === right.rawSha256
    && left.byteLength === right.byteLength;
}

/**
 * Reconstructs the immutable post-import normalization from archived g16/g17
 * bytes while treating the current StoredWorld only as the source of its
 * catalog-bound import fingerprint. Evolving gameplay state therefore cannot
 * silently redefine the migration plan on restart.
 *
 * This helper performs no hashing or authority mutation. The returned input
 * must still pass `assertRustHistoricalSaveCompatibilityPlanV1` immediately
 * before a native operation consumes any of its bytes.
 */
export function createRustHistoricalSaveStoragePlanInputV1(input: Readonly<{
  catalogWorldId: string;
  nativeWorldId: string;
  contentHash: string;
  sourceReference: WorldImportSourceReferenceV1;
  sourceBytes: Uint8Array;
  document: StoredWorld;
}>): RustHistoricalSaveCompatibilityInputV1 {
  const { document } = input;
  if (!document || document.version !== 1 || document.metadata.id !== input.catalogWorldId) {
    fail("catalog-target", "Historical StoredWorld does not match the requested catalog target");
  }
  if (!document.importSource) fail("source-reference", "Historical StoredWorld has no archived import source");
  try {
    assertWorldImportSourceReferenceV1(input.sourceReference);
    assertWorldImportSourceReferenceV1(document.importSource);
  } catch (error) {
    fail("source-reference", error instanceof Error ? error.message : "Historical import source is invalid");
  }
  if (!exactSourceReference(document.importSource, input.sourceReference)) {
    fail("source-reference", "Historical StoredWorld and archived source references differ");
  }
  if (!(input.sourceBytes instanceof Uint8Array)
    || input.sourceBytes.byteLength !== input.sourceReference.byteLength) {
    fail("source-bytes", "Historical archived bytes do not match their declared length");
  }
  if (!CONTENT_HASH.test(input.contentHash)) {
    fail("content-hash", "Historical target content hash is not canonical");
  }
  const separator = input.nativeWorldId.lastIndexOf("@");
  const universeId = separator < 1 ? "" : input.nativeWorldId.slice(0, separator);
  const locationId = separator < 1 ? "" : input.nativeWorldId.slice(separator + 1);
  if (universeId !== `world:${input.catalogWorldId}` || !locationId) {
    fail("native-target", "Historical native world does not match the catalog target");
  }

  let sourceRoot: Record<string, unknown>;
  try {
    sourceRoot = record(JSON.parse(textDecoder.decode(Uint8Array.from(input.sourceBytes))), "historical export");
  } catch (error) {
    if (error instanceof RustHistoricalSaveStoragePlanError) throw error;
    fail("source-json", "Historical archived source is not valid UTF-8 JSON");
  }
  const sourceWorld = record(sourceRoot.world, "historical export.world");
  const sourceSave = record(sourceWorld.save, "historical export.world.save");
  const sourceOptions = record(sourceWorld.options, "historical export.world.options");
  const generatorVersion = sourceSave.generatorVersion;
  if (sourceRoot.format !== "blockwild-world" || sourceRoot.version !== 1 || sourceWorld.version !== 1
    || generatorVersion !== 16 && generatorVersion !== 17) {
    fail("source-version", "Historical external custody supports only g16/g17 world exports");
  }
  const normalized = migrateLegacyWorldSave(sourceSave);
  if (!normalized) fail("source-normalization", "Historical archived save cannot be normalized");
  const fingerprint = document.save.agentWorldFingerprint;
  const fingerprintMatch = typeof fingerprint === "string" ? IMPORT_FINGERPRINT.exec(fingerprint) : null;
  if (!fingerprintMatch || fingerprintMatch[1] !== input.catalogWorldId) {
    fail("import-fingerprint", "Historical StoredWorld lacks its exact catalog-bound import fingerprint");
  }
  const initialSave = Object.freeze({ ...normalized, agentWorldFingerprint: fingerprint }) as WorldSave;
  const options = normalizeWorldOptions(generatorVersion === 16
    ? { ...sourceOptions, settlementPattern: "legacy-scattered-v1" }
    : sourceOptions);
  const generationIdentity = deriveWorldGenerationIdentityV1(initialSave, options);
  if (!exactGenerationIdentity(document.metadata.generationIdentity, generationIdentity)
    || document.metadata.seed !== initialSave.seed
    || document.save.seed !== initialSave.seed
    || !equalJson(document.options, options)) {
    fail("normalized-target", "Historical StoredWorld no longer matches its immutable imported generation target");
  }

  return Object.freeze({
    schemaVersion: RUST_HISTORICAL_SAVE_COMPATIBILITY_SCHEMA_V1,
    authority: Object.freeze({
      claim: RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1,
      nativePlayer: "off" as const,
      nativeRichState: "not-adopted" as const,
    }),
    originalSource: Object.freeze({ ...input.sourceReference }),
    sourceBytes: Uint8Array.from(input.sourceBytes),
    normalizedSource: Object.freeze({ save: initialSave, options }),
    target: Object.freeze({
      catalogWorldId: input.catalogWorldId,
      universeId,
      locationId,
      worldSeed: initialSave.seed,
      contentHash: input.contentHash,
      generationIdentity,
    }),
  });
}
