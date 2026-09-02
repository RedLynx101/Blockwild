import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import {
  BLOCKWILD_WORLDGEN_BUILD_PROFILE_ENV,
  DEFAULT_WORLDGEN_BUILD_PROFILE,
  resolveWorldgenBuildProfile,
} from "../build/worldgen-build-profile.ts";
import { currentBuildIdentity, worldgenBuildUsesRustRuntime } from "../app/game/build-info.ts";

const root = process.cwd();

function nextProfile(environmentValue: string | undefined) {
  const environment = { ...process.env };
  delete environment[BLOCKWILD_WORLDGEN_BUILD_PROFILE_ENV];
  if (environmentValue !== undefined) environment[BLOCKWILD_WORLDGEN_BUILD_PROFILE_ENV] = environmentValue;
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    "const config = (await import('./next.config.ts')).default; process.stdout.write(config.env.NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE);",
  ], { cwd: root, encoding: "utf8", env: environment });
}

function diagnosticProfile(publicLiteral: string) {
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    "const { currentBuildIdentity } = await import('./app/game/build-info.ts'); process.stdout.write(currentBuildIdentity(null).worldgenBuildProfile);",
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE: publicLiteral },
  });
}

test("the private worldgen build profile accepts only the two reviewed exact values", () => {
  assert.equal(DEFAULT_WORLDGEN_BUILD_PROFILE, "rust-primary");
  assert.equal(resolveWorldgenBuildProfile(undefined), "rust-primary");
  assert.equal(resolveWorldgenBuildProfile("rust-primary"), "rust-primary");
  assert.equal(resolveWorldgenBuildProfile("typescript-rollback"), "typescript-rollback");
  for (const rejected of ["", "typescript", "rust", "RUST-PRIMARY", " typescript-rollback", "typescript-rollback "]) {
    assert.throws(() => resolveWorldgenBuildProfile(rejected), /must be exactly/);
  }
});

test("Next publishes only the sanitized profile literal and fails before bundling invalid input", () => {
  const ordinary = nextProfile(undefined);
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.equal(ordinary.stdout, "rust-primary");

  const rollback = nextProfile("typescript-rollback");
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(rollback.stdout, "typescript-rollback");

  const invalid = nextProfile("1");
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /BLOCKWILD_WORLDGEN_BUILD_PROFILE must be exactly/);
});

test("normal builds remain Rust-primary and rollback build commands are cross-platform wrappers", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts.build, "node scripts/run-sites-build.mjs");
  assert.equal(packageJson.scripts["build:worldgen-rollback"], "node scripts/run-worldgen-rollback-build.mjs sites");
  assert.equal(packageJson.scripts["build:vercel:worldgen-rollback"], "node scripts/run-worldgen-rollback-build.mjs vercel");
  const wrapper = readFileSync(resolve(root, "scripts/run-worldgen-rollback-build.mjs"), "utf8");
  assert.match(wrapper, /BLOCKWILD_WORLDGEN_BUILD_PROFILE: "typescript-rollback"/);
  assert.match(wrapper, /process\.env\.npm_execpath/u);
  assert.match(wrapper, /spawnSync\(process\.execPath/u);
  assert.doesNotMatch(wrapper, /npm\.cmd/u);
});

test("build diagnostics expose the profile without changing runtime/save protocol versions", () => {
  const identity = currentBuildIdentity("https://blockwild.app");
  assert.equal(identity.deployment, "vercel");
  assert.equal(identity.origin, "https://blockwild.app");
  assert.equal(identity.worldgenBuildProfile, "rust-primary");
  assert.equal(identity.telemetrySchema, 3);
  assert.equal(identity.generationWorkerProtocol, 1);
  assert.equal(identity.terrainWorkerProtocol, 1);

  const rollback = diagnosticProfile("typescript-rollback");
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(rollback.stdout, "typescript-rollback");
});

test("only the Rust-primary build may activate the Rust world runtime", () => {
  assert.equal(worldgenBuildUsesRustRuntime("rust-primary"), true);
  assert.equal(worldgenBuildUsesRustRuntime("typescript-rollback"), false);
  const engine = readFileSync(resolve(root, "app/game/engine.ts"), "utf8");
  for (const signature of [
    "async createWorldWithRustRuntime(",
    "async loadWorldWithRustRuntime(",
    "async loadStoredWorldWithRustRuntime(",
  ]) {
    const start = engine.indexOf(signature);
    assert.notEqual(start, -1, `${signature} must remain present`);
    const rustPreparation = engine.indexOf("prepareRustWorldTransition", start);
    const rollbackGate = engine.indexOf("if (!worldgenBuildUsesRustRuntime())", start);
    assert.ok(rollbackGate > start && rollbackGate < rustPreparation,
      `${signature} must select the compatibility lifecycle before Rust preparation`);
  }
  const activate = engine.match(/\n  activate\(\) \{[\s\S]*?\n  \}/u)?.[0] ?? "";
  assert.match(activate, /if \(worldgenBuildUsesRustRuntime\(\)/u);
  assert.ok(activate.indexOf("worldgenBuildUsesRustRuntime()") < activate.indexOf("rustRuntimeOperationsBlocked"),
    "rollback activation must bypass native readiness before consulting Rust state");
});
