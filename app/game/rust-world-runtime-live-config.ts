import {
  LEGACY_TERRAIN_CONTENT_HASH_V2,
  legacyTerrainGeneratorHashV2,
  stableTerrainGenerationJsonV2,
} from "./terrain-generation-contract";
import { currentRustWorldBlockCatalogR4V1 } from "./rust-world-authority-runtime-r4";
import type { RustWorldRuntimeHostConfigV1 } from "./rust-world-runtime-host";
import {
  GENERATOR_VERSION,
  normalizeWorldGenerationOptions,
  type WorldGenerationOptions,
} from "./world";

const WORLD_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
// Runtime sessions are also multiplayer session IDs. Keep this contract in
// the exact portable ID alphabet accepted by signaling and invite payloads.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_.-]{8,160}$/u;
const LOCATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/u;

export type RustWorldRuntimeLiveConfigInputV1 = Readonly<{
  worldId: string;
  worldSeed: string;
  sessionId: string;
  locationId?: string;
  generationOptions?: Partial<WorldGenerationOptions> | null;
  /** Exact catalog identity for an existing or freshly allocated durable world. */
  generationIdentity?: Readonly<{
    schemaVersion: 1;
    terrainContentHash: string;
    generatorHash: string;
    generationOptionsJson: string;
  }> | null;
}>;

/**
 * Seals only byte-affecting generation controls. `origin` selects a spawn
 * search target and is deliberately not part of terrain chunk identity.
 */
export function canonicalRustTerrainGenerationOptionsJsonV1(
  value?: Partial<WorldGenerationOptions> | null,
) {
  const options = normalizeWorldGenerationOptions(value);
  return stableTerrainGenerationJsonV2({
    biomeScale: options.biomeScale,
    caveFrequency: options.caveFrequency,
    enabledFactions: options.enabledFactions,
    largeTownFrequency: options.largeTownFrequency,
    profile: options.profile,
    resourceAbundance: options.resourceAbundance,
    roadCoverage: options.roadCoverage,
    settlementClustering: options.settlementClustering,
    settlementDensity: options.settlementDensity,
    settlementPattern: options.settlementPattern,
    structures: options.structures,
  });
}

export function createRustWorldRuntimeSessionIdV1(randomUuid?: () => string) {
  const uuid = randomUuid?.() ?? globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Secure random UUID generation is unavailable for the Rust runtime session");
  const sessionId = `runtime.${uuid}`;
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("Rust runtime session ID is invalid");
  return sessionId;
}

/**
 * Derives the immutable native identity from the browser catalog record. A
 * duplicated world may share a seed, but it never shares its universe ID.
 */
export function createRustWorldRuntimeLiveConfigV1(
  input: RustWorldRuntimeLiveConfigInputV1,
): RustWorldRuntimeHostConfigV1 {
  if (!WORLD_ID_PATTERN.test(input.worldId)) throw new Error("Rust runtime world ID is not a canonical browser world ID");
  if (!input.worldSeed || input.worldSeed.length > 512) throw new Error("Rust runtime world seed must contain 1..512 UTF-16 code units");
  if (!SESSION_ID_PATTERN.test(input.sessionId)) throw new Error("Rust runtime session ID is invalid");
  if (input.generationIdentity && input.generationOptions) {
    throw new Error("Rust runtime generation identity and loose generation options are mutually exclusive");
  }
  const locationId = input.locationId ?? "overworld";
  if (!LOCATION_ID_PATTERN.test(locationId)) throw new Error("Rust runtime location ID is invalid");
  const catalog = currentRustWorldBlockCatalogR4V1();
  const exact = input.generationIdentity;
  let generatorHash = legacyTerrainGeneratorHashV2(`g${GENERATOR_VERSION}`);
  let terrainContentHash = LEGACY_TERRAIN_CONTENT_HASH_V2;
  let generationOptionsJson = canonicalRustTerrainGenerationOptionsJsonV1(input.generationOptions);
  if (exact) {
    if (exact.schemaVersion !== 1
      || !/^[0-9a-f]{32}$/u.test(exact.generatorHash)
      || !/^[0-9a-f]{32}$/u.test(exact.terrainContentHash)) {
      throw new Error("Rust runtime catalog generation identity is invalid");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(exact.generationOptionsJson); }
    catch { throw new Error("Rust runtime catalog generation options are not valid JSON"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || canonicalRustTerrainGenerationOptionsJsonV1(parsed as Partial<WorldGenerationOptions>) !== exact.generationOptionsJson) {
      throw new Error("Rust runtime catalog generation options are not exact canonical terrain JSON");
    }
    generatorHash = exact.generatorHash;
    terrainContentHash = exact.terrainContentHash;
    generationOptionsJson = exact.generationOptionsJson;
  }
  return Object.freeze({
    worldSeed: input.worldSeed,
    universeId: `world:${input.worldId}`,
    locationId,
    sessionId: input.sessionId,
    catalogWorldId: input.worldId,
    generatorHash,
    terrainContentHash,
    generationOptionsJson,
    waterBlockId: catalog.waterBlockId,
    directionalBlockIds: catalog.directionalBlocks,
    waterloggedBlockIds: catalog.waterloggedBlocks,
  });
}
