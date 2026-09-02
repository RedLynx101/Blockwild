import type { NextConfig } from "next";
import { resolveWorldgenBuildProfile } from "./build/worldgen-build-profile";

const buildSha = process.env.VERCEL_GIT_COMMIT_SHA
  ?? process.env.GITHUB_SHA
  ?? process.env.BLOCKWILD_BUILD_SHA
  ?? "local";

const worldgenBuildProfile = resolveWorldgenBuildProfile();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BLOCKWILD_BUILD_SHA: buildSha,
    NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE: worldgenBuildProfile,
  },
};

export default nextConfig;
