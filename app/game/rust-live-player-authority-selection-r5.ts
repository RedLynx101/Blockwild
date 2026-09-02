export type RustLivePlayerAuthorityModeR5 = "off" | "experimental-r5";

export const DEFAULT_RUST_LIVE_PLAYER_AUTHORITY_MODE_R5: RustLivePlayerAuthorityModeR5 = "off";
export const RUST_LIVE_PLAYER_AUTHORITY_EXPERIMENT_QUERY_R5 = "experimental.rust-live-player-authority";
export const RUST_LIVE_PLAYER_AUTHORITY_EXPERIMENT_ENV_R5 = "NEXT_PUBLIC_BLOCKWILD_EXPERIMENTAL_RUST_LIVE_PLAYER_AUTHORITY_R5";

export type RustLivePlayerAuthoritySelectionR5 = Readonly<{
  mode: RustLivePlayerAuthorityModeR5;
  source: "default-off" | "query-experimental-r5" | "environment-experimental-r5";
}>;

export type RustLivePlayerAuthoritySelectionConfigurationR5 = Readonly<{
  search?: string | null;
  experimentalEnvironment?: string | null;
}>;

const configuredExperimentalEnvironment = typeof process === "undefined"
  ? undefined
  : process.env.NEXT_PUBLIC_BLOCKWILD_EXPERIMENTAL_RUST_LIVE_PLAYER_AUTHORITY_R5;

/** Pure, exact-match selector. Live Rust player custody is never the default. */
export function resolveRustLivePlayerAuthoritySelectionR5(
  configuration: RustLivePlayerAuthoritySelectionConfigurationR5 = {},
): RustLivePlayerAuthoritySelectionR5 {
  const parameters = new URLSearchParams(configuration.search ?? "");
  if (parameters.get(RUST_LIVE_PLAYER_AUTHORITY_EXPERIMENT_QUERY_R5) === "r5") return Object.freeze({
    mode: "experimental-r5",
    source: "query-experimental-r5",
  });
  if (configuration.experimentalEnvironment === "1") return Object.freeze({
    mode: "experimental-r5",
    source: "environment-experimental-r5",
  });
  return Object.freeze({
    mode: DEFAULT_RUST_LIVE_PLAYER_AUTHORITY_MODE_R5,
    source: "default-off",
  });
}

/** Snapshot browser configuration once for each VoxelEngine construction. */
export function configuredRustLivePlayerAuthoritySelectionR5(): RustLivePlayerAuthoritySelectionR5 {
  if (typeof window === "undefined") return resolveRustLivePlayerAuthoritySelectionR5();
  return resolveRustLivePlayerAuthoritySelectionR5({
    search: window.location.search,
    experimentalEnvironment: configuredExperimentalEnvironment,
  });
}
