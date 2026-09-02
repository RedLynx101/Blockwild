#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const target = process.argv[2];
const script = target === "sites"
  ? "build"
  : target === "vercel"
    ? "build:vercel"
    : null;

if (!script) {
  process.stderr.write("Usage: node scripts/run-worldgen-rollback-build.mjs <sites|vercel>\n");
  process.exitCode = 64;
} else {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("The rollback wrapper must be launched through npm so its exact CLI path is available.");
  }
  const result = spawnSync(process.execPath, [npmCli, "run", script], {
    env: {
      ...process.env,
      BLOCKWILD_WORLDGEN_BUILD_PROFILE: "typescript-rollback",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
