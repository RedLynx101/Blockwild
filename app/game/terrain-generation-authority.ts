import type { WorldgenBuildProfile } from "../../build/worldgen-build-profile";

export type TerrainGenerationAuthorityModeV2 = "rust" | "typescript";

export const DEFAULT_TERRAIN_GENERATION_AUTHORITY_MODE_V2: TerrainGenerationAuthorityModeV2 = "rust";
export const TERRAIN_GENERATION_BUILD_PROFILE_PUBLIC_ENV_V2 = "NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE";

const configuredBuildProfile = typeof process === "undefined"
  ? undefined
  : process.env.NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE;

export type TerrainGenerationAuthoritySelectionV2 = Readonly<{
  mode: TerrainGenerationAuthorityModeV2;
  source: "default-rust" | "build-rust-primary" | "build-typescript-rollback" | "constructor" | "test";
  rollbackRequiresWorldReload: true;
}>;

export type TerrainGenerationAuthorityConfigurationV2 = Readonly<{
  buildProfile?: WorldgenBuildProfile | null;
  nodeTestMode?: boolean;
}>;

/** Pure selector used by tests and by the once-per-world build snapshot. */
export function resolveTerrainGenerationAuthorityV2(
  configuration: TerrainGenerationAuthorityConfigurationV2 = {},
): TerrainGenerationAuthoritySelectionV2 {
  if (configuration.nodeTestMode === true) return Object.freeze({
    mode: "typescript",
    source: "test",
    rollbackRequiresWorldReload: true,
  });
  if (configuration.buildProfile === "typescript-rollback") return Object.freeze({
    mode: "typescript",
    source: "build-typescript-rollback",
    rollbackRequiresWorldReload: true,
  });
  if (configuration.buildProfile !== undefined
    && configuration.buildProfile !== null
    && configuration.buildProfile !== "rust-primary") {
    throw new Error(`Invalid compiled worldgen build profile: ${JSON.stringify(configuration.buildProfile)}`);
  }
  return Object.freeze({
    mode: DEFAULT_TERRAIN_GENERATION_AUTHORITY_MODE_V2,
    source: configuration.buildProfile === "rust-primary" ? "build-rust-primary" : "default-rust",
    rollbackRequiresWorldReload: true,
  });
}

/**
 * Browser configuration is read exactly once by each ChunkWorld constructor.
 * A missing browser global never selects TypeScript: SSR and tools must pass an
 * explicit constructor/test selection when they need the compatibility oracle.
 */
export function configuredTerrainGenerationAuthorityV2(): TerrainGenerationAuthoritySelectionV2 {
  return resolveTerrainGenerationAuthorityV2({
    buildProfile: configuredBuildProfile as WorldgenBuildProfile | undefined,
    nodeTestMode: typeof process !== "undefined" && process.env.NODE_TEST_CONTEXT !== undefined,
  });
}

export function explicitTerrainGenerationAuthorityV2(
  mode: TerrainGenerationAuthorityModeV2,
  source: "constructor" | "test" = "constructor",
): TerrainGenerationAuthoritySelectionV2 {
  return Object.freeze({ mode, source, rollbackRequiresWorldReload: true });
}
