export const BLOCKWILD_WORLDGEN_BUILD_PROFILE_ENV = "BLOCKWILD_WORLDGEN_BUILD_PROFILE";
export const DEFAULT_WORLDGEN_BUILD_PROFILE = "rust-primary" as const;

export type WorldgenBuildProfile = "rust-primary" | "typescript-rollback";

/**
 * Validate the private build selector before either bundler publishes a
 * client-visible literal. An absent value is the ordinary Rust-primary build;
 * every present value must be one of the two reviewed profiles exactly.
 */
export function resolveWorldgenBuildProfile(
  configured = process.env[BLOCKWILD_WORLDGEN_BUILD_PROFILE_ENV],
): WorldgenBuildProfile {
  if (configured === undefined) return DEFAULT_WORLDGEN_BUILD_PROFILE;
  if (configured === "rust-primary" || configured === "typescript-rollback") return configured;
  throw new Error(
    `${BLOCKWILD_WORLDGEN_BUILD_PROFILE_ENV} must be exactly "rust-primary" or "typescript-rollback"; received ${JSON.stringify(configured)}`,
  );
}
