import type { WorldgenBuildProfile } from "../../build/worldgen-build-profile";

export type BlockwildDeployment = "vercel" | "sites" | "local" | "other";

export type BlockwildBuildIdentity = Readonly<{
  commitSha: string | null;
  deployment: BlockwildDeployment;
  origin: string | null;
  worldgenBuildProfile: WorldgenBuildProfile;
  telemetrySchema: 3;
  generationWorkerProtocol: 1;
  terrainWorkerProtocol: 1;
}>;

const compiledCommitSha = process.env.NEXT_PUBLIC_BLOCKWILD_BUILD_SHA?.trim() ?? "";

function resolveCompiledWorldgenBuildProfile(value: string | undefined): WorldgenBuildProfile {
  if (value === undefined || value === "rust-primary") return "rust-primary";
  if (value === "typescript-rollback") return value;
  throw new Error(`Invalid NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE literal: ${JSON.stringify(value)}`);
}

export const COMPILED_WORLDGEN_BUILD_PROFILE = resolveCompiledWorldgenBuildProfile(
  process.env.NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE,
);

/**
 * Rust world activation is a build-profile contract, not a runtime fallback.
 * The rollback bundle must never probe a Rust artifact or native persistence.
 */
export function worldgenBuildUsesRustRuntime(
  profile: WorldgenBuildProfile = COMPILED_WORLDGEN_BUILD_PROFILE,
) {
  return profile === "rust-primary";
}

export function classifyDeploymentOrigin(origin: string | null | undefined): BlockwildDeployment {
  if (!origin) return "local";
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (hostname === "blockwild.app" || hostname.endsWith(".vercel.app")) return "vercel";
    if (hostname.endsWith(".chatgpt.site")) return "sites";
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return "local";
    return "other";
  } catch {
    return "other";
  }
}

/** Compile-time commit plus runtime origin, recorded in every downloadable performance log. */
export function currentBuildIdentity(origin = typeof window === "undefined" ? null : window.location.origin): BlockwildBuildIdentity {
  return Object.freeze({
    commitSha: compiledCommitSha && compiledCommitSha !== "unknown" && compiledCommitSha !== "local" ? compiledCommitSha : null,
    deployment: classifyDeploymentOrigin(origin),
    origin,
    worldgenBuildProfile: COMPILED_WORLDGEN_BUILD_PROFILE,
    telemetrySchema: 3,
    generationWorkerProtocol: 1,
    terrainWorkerProtocol: 1,
  });
}
