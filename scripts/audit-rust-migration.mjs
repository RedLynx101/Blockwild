#!/usr/bin/env node

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runRustEngineTests } from "./run-rust-engine-tests.mjs";
import {
  INTEGRATED_RUNTIME_SCHEMA_MANIFEST,
  verifyIntegratedRuntimeSchemaConvergence,
} from "./verify-integrated-runtime-schema-convergence.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLAN = path.join(ROOT, "docs", "HYBRID_RUST_ENGINE_MIGRATION_MASTER_PLAN.md");
const LEDGER = path.join(ROOT, "docs", "RUST_ENGINE_AUTHORITY_LEDGER.md");
const IMPLEMENTATION_LOG = path.join(ROOT, "docs", "HYBRID_RUST_MIGRATION_IMPLEMENTATION_LOG.md");
const DEFAULT_ROLLBACK_WINDOWS = path.join(ROOT, "docs", "RUST_ENGINE_ROLLBACK_WINDOWS.json");

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const outputIndex = process.argv.indexOf("--out");
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(ROOT, process.argv[outputIndex + 1])
  : null;
const rollbackWindowsIndex = process.argv.indexOf("--rollback-windows");
const rollbackWindowsPath = rollbackWindowsIndex >= 0 && process.argv[rollbackWindowsIndex + 1]
  ? path.resolve(ROOT, process.argv[rollbackWindowsIndex + 1])
  : DEFAULT_ROLLBACK_WINDOWS;
const schemaConvergenceIndex = process.argv.indexOf("--schema-convergence");
const schemaConvergencePath = schemaConvergenceIndex >= 0 && process.argv[schemaConvergenceIndex + 1]
  ? path.resolve(ROOT, process.argv[schemaConvergenceIndex + 1])
  : path.join(ROOT, ...INTEGRATED_RUNTIME_SCHEMA_MANIFEST.split("/"));

async function text(file) {
  return readFile(file, "utf8");
}

async function jsonDocument(file) {
  try {
    return { value: JSON.parse(await text(file)), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function terrainRollbackWindowCheck(document) {
  if (document.error) return {
    valid: false,
    reason: `rollback-window document is unreadable: ${document.error}`,
    summary: null,
  };
  const value = document.value;
  const support = value?.supportWindow;
  const releases = support?.verifiedStableReleases;
  const minimum = support?.minimumStableReleases;
  const retireAfter = support?.retireAfter;

  const isObject = (candidate) => candidate !== null
    && typeof candidate === "object"
    && !Array.isArray(candidate);
  const hasExactKeys = (candidate, expected) => isObject(candidate)
    && Object.keys(candidate).length === expected.length
    && expected.every((key) => Object.hasOwn(candidate, key));
  const releaseIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
  const commitShaPattern = /^[0-9a-f]{40}$/u;
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
  const isCanonicalTimestamp = (candidate) => typeof candidate === "string"
    && timestampPattern.test(candidate)
    && !Number.isNaN(Date.parse(candidate))
    && new Date(candidate).toISOString() === candidate;
  const isEvidenceReference = (candidate) => {
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.trim() !== candidate) return false;
    try {
      const url = new URL(candidate);
      return url.protocol === "https:" && url.hostname.length > 0 && url.username === "" && url.password === "";
    } catch {
      const segments = candidate.split("/");
      return !candidate.includes("\\")
        && !candidate.startsWith("/")
        && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(candidate)
        && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
    }
  };

  const documentShapeValid = hasExactKeys(value, [
    "schemaVersion",
    "domain",
    "primaryBuildProfile",
    "rollbackBuildProfile",
    "requiresReload",
    "saveCompatibility",
    "supportWindow",
  ])
    && value.schemaVersion === 2
    && value.domain === "terrain-generation"
    && value.primaryBuildProfile === "rust-primary"
    && value.rollbackBuildProfile === "typescript-rollback"
    && value.requiresReload === true
    && hasExactKeys(value.saveCompatibility, ["generatorVersion", "profilePersisted"])
    && value.saveCompatibility.generatorVersion === 18
    && value.saveCompatibility.profilePersisted === false
    && hasExactKeys(support, ["minimumStableReleases", "verifiedStableReleases", "retireAfter"])
    && Number.isInteger(minimum)
    && minimum >= 2
    && Array.isArray(releases)
    && (retireAfter === null || (typeof retireAfter === "string" && releaseIdPattern.test(retireAfter)));
  if (!documentShapeValid) return {
    valid: false,
    reason: "rollback-window document does not match the terrain build-profile schema v2",
    summary: null,
  };

  const releaseKeys = ["releaseId", "commitSha", "buildProfile", "evidence", "measuredAt"];
  for (const [index, release] of releases.entries()) {
    if (!isObject(release)) return {
      valid: false,
      reason: `verified stable release ${index + 1} does not have the exact schema-v2 evidence shape`,
      summary: null,
    };
    if (!Object.hasOwn(release, "commitSha")) return {
      valid: false,
      reason: `verified stable release ${release.releaseId ?? index + 1} is missing an exact full commitSha`,
      summary: null,
    };
    if (!Object.hasOwn(release, "evidence")) return {
      valid: false,
      reason: `verified stable release ${release.releaseId ?? index + 1} is missing a portable evidence path or HTTPS URL`,
      summary: null,
    };
    if (!Object.hasOwn(release, "measuredAt")) return {
      valid: false,
      reason: `verified stable release ${release.releaseId ?? index + 1} is missing a canonical UTC measuredAt timestamp`,
      summary: null,
    };
    if (!hasExactKeys(release, releaseKeys)) return {
      valid: false,
      reason: `verified stable release ${index + 1} does not have the exact schema-v2 evidence shape`,
      summary: null,
    };
    if (typeof release.releaseId !== "string" || !releaseIdPattern.test(release.releaseId)) return {
      valid: false,
      reason: `verified stable release ${index + 1} has an invalid releaseId`,
      summary: null,
    };
    if (typeof release.commitSha !== "string" || !commitShaPattern.test(release.commitSha)) return {
      valid: false,
      reason: `verified stable release ${release.releaseId} is missing an exact full commitSha`,
      summary: null,
    };
    if (release.buildProfile !== "rust-primary") return {
      valid: false,
      reason: `verified stable release ${release.releaseId} does not use the rust-primary build profile`,
      summary: null,
    };
    if (!isEvidenceReference(release.evidence)) return {
      valid: false,
      reason: `verified stable release ${release.releaseId} is missing a portable evidence path or HTTPS URL`,
      summary: null,
    };
    if (!isCanonicalTimestamp(release.measuredAt)) return {
      valid: false,
      reason: `verified stable release ${release.releaseId} is missing a canonical UTC measuredAt timestamp`,
      summary: null,
    };
    if (index > 0 && release.measuredAt <= releases[index - 1].measuredAt) return {
      valid: false,
      reason: "verified stable releases are not ordered by strictly increasing measuredAt timestamps",
      summary: null,
    };
  }

  const releaseIds = releases.map((release) => release.releaseId);
  if (new Set(releaseIds).size !== releaseIds.length) return {
    valid: false,
    reason: "verified stable release identifiers are not unique",
    summary: null,
  };
  const commitShas = releases.map((release) => release.commitSha);
  if (new Set(commitShas).size !== commitShas.length) return {
    valid: false,
    reason: "verified stable release commits are not distinct",
    summary: null,
  };

  const summary = {
    minimumStableReleases: minimum,
    verifiedStableReleases: releases.map((release) => ({ ...release })),
    retireAfter,
  };
  if (retireAfter !== null && releases.length < minimum) return {
    valid: false,
    reason: `TypeScript terrain rollback retires after ${retireAfter} with only ${releases.length}/${minimum} verified stable releases`,
    summary,
  };
  if (retireAfter !== null) {
    const anchorIndex = releases.findIndex((release) => release.releaseId === retireAfter);
    if (anchorIndex < 0) return {
      valid: false,
      reason: `TypeScript terrain rollback retirement anchor ${retireAfter} is not a verified stable release`,
      summary,
    };
    if (anchorIndex < minimum - 1) return {
      valid: false,
      reason: `TypeScript terrain rollback retirement anchor ${retireAfter} precedes the required ${minimum} verified stable releases`,
      summary,
    };
  }
  return {
    valid: true,
    reason: retireAfter === null
      ? `TypeScript terrain rollback remains active; ${releases.length}/${minimum} stable releases are verified`
      : `TypeScript terrain rollback retirement follows ${releases.length}/${minimum} verified stable releases`,
    summary,
  };
}

async function filesBelow(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...await filesBelow(absolute));
    else if (entry.isFile()) found.push(absolute);
  }
  return found;
}

async function joinedTextBelow(root, extension) {
  const files = (await filesBelow(root))
    .filter((file) => file.endsWith(extension))
    .sort((left, right) => left.localeCompare(right));
  return (await Promise.all(files.map((file) => text(file)))).join("\n");
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function ledgerRows(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/u)) {
    if (!line.startsWith("| ") || line.includes("---") || line.includes("Domain |")) continue;
    const columns = line.split("|").slice(1, -1).map((value) => value.trim());
    if (columns.length < 7) continue;
    rows.push({
      domain: columns[0],
      typescriptOwner: columns[1],
      rustTarget: columns[2],
      mode: columns[3].replaceAll("`", ""),
      evidence: columns[4],
      boundary: columns[5],
      rollback: columns[6],
    });
  }
  return rows;
}

function isMigratedMode(mode) {
  return mode === "rust-authoritative" || mode === "retired-typescript";
}

async function audit() {
  const [plan, ledger, log, packageJson, facade, voxelGame, legacyEngine, legacyWorld, wasm, performance, testEntries, rollbackWindowDocument, wireSchemaConvergence] = await Promise.all([
    text(PLAN),
    text(LEDGER),
    text(IMPLEMENTATION_LOG),
    text(path.join(ROOT, "package.json")),
    text(path.join(ROOT, "app", "game", "engine-facade.ts")),
    text(path.join(ROOT, "app", "game", "VoxelGame.tsx")),
    text(path.join(ROOT, "app", "game", "engine.ts")),
    text(path.join(ROOT, "app", "game", "world.ts")),
    joinedTextBelow(path.join(ROOT, "engine", "crates", "blockwild-wasm", "src"), ".rs"),
    text(path.join(ROOT, "app", "game", "performance.ts")),
    readdir(path.join(ROOT, "tests"), { withFileTypes: true }),
    jsonDocument(rollbackWindowsPath),
    verifyIntegratedRuntimeSchemaConvergence({ root: ROOT, manifestPath: schemaConvergencePath }),
  ]);
  const packageData = JSON.parse(packageJson);
  const rows = ledgerRows(ledger);
  const migratableRows = rows.filter((row) => row.rustTarget !== "none; remains TypeScript" && row.rollback !== "not migrated");
  const pendingAuthority = migratableRows.filter((row) => !isMigratedMode(row.mode));
  const uncheckedPlanItems = [...plan.matchAll(/^- \[ \] (.+)$/gmu)].map((match) => match[1]);
  const openLogGates = (() => {
    const marker = "## Open completion gates";
    const start = log.indexOf(marker);
    if (start < 0) return ["implementation log has no Open completion gates section"];
    const remainder = log.slice(start + marker.length);
    const nextHeading = remainder.search(/^## /mu);
    const section = nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder;
    return [...section.matchAll(/^- (.+)$/gmu)].map((match) => match[1]);
  })();

  const sourceFiles = (await filesBelow(path.join(ROOT, "app")))
    .filter((file) => /\.(?:ts|tsx|js|jsx)$/u.test(file));
  const allowedThreePrefixes = [
    "app/three-compat/",
    "app/engine-lab/",
    "app/renderer-lab/",
  ];
  const normalPathThreeImports = [];
  const compatibilityThreeImports = [];
  const staticThreeCompatibilityImports = [];
  for (const file of sourceFiles) {
    const source = await text(file);
    const name = relative(file);
    const compatibilityOnly = allowedThreePrefixes.some((prefix) => name.startsWith(prefix));
    if (/(?:from\s+["']three["']|import\s*\(["']three["']\))/u.test(source)) {
      if (compatibilityOnly) compatibilityThreeImports.push(name);
      else normalPathThreeImports.push(name);
    }
    if (!compatibilityOnly && /(?:^|\n)\s*import(?:\s+[^;]+?\s+from\s+|\s*)["'][^"']*three-compat[^"']*["']/u.test(source)) {
      staticThreeCompatibilityImports.push(name);
    }
  }

  const legacyAuthoritySymbols = [
    ["VoxelEngine.moveWithCollisions", /\n\s*moveWithCollisions\s*\(/u.test(legacyEngine)],
    ["VoxelEngine.collidesAt", /\n\s*collidesAt\s*\(/u.test(legacyEngine)],
    ["ChunkWorld.sampleColumn", /\n\s*sampleColumn\s*\(/u.test(legacyWorld)],
    ["ChunkWorld.generateChunk", /\n\s*generateChunk\s*\(/u.test(legacyWorld)],
    ["ChunkWorld.setBlock", /\n\s*setBlock\s*\(/u.test(legacyWorld)],
  ].filter(([, present]) => present).map(([symbol]) => symbol);

  const requiredWasmExports = [
    "blockwild_runtime_create_v2",
    "blockwild_runtime_command_v2",
    "blockwild_runtime_step_v2",
    "blockwild_runtime_extract_v2",
    "blockwild_runtime_export_save_v2",
    "blockwild_runtime_destroy_v2",
  ];
  const missingWasmExports = requiredWasmExports.filter((name) => !wasm.includes(`fn ${name}`));
  const declaredLegacyEngineDefault = /Public engine default:\s*([^\r\n]+)/u.exec(ledger)?.[1]?.trim() ?? null;
  const declaredSimulationPlayerDefault = /Public simulation\/player default:\s*([^\r\n]+)/u.exec(ledger)?.[1]?.trim() ?? null;
  const declaredTerrainGenerationDefault = /Public terrain-generation implementation:\s*([^\r\n]+)/u.exec(ledger)?.[1]?.trim() ?? null;
  const declaredRendererDefault = /Public renderer default:\s*([^\r\n]+)/u.exec(ledger)?.[1]?.trim() ?? null;
  const facadeStillDormant = facade.includes("intentionally not wired into VoxelGame yet");
  const facadeImportedByVoxelGame = /from\s+["']\.\/engine-facade["']/u.test(voxelGame)
    || /import\s*\(["']\.\/engine-facade["']\)/u.test(voxelGame);
  const runtimeEngineDefault = /engineSelection\s*\?\?\s*["']([^"']+)["']/u.exec(facade)?.[1] ?? null;
  const runtimeRendererDefault = /rendererSelection\s*\?\?\s*["']([^"']+)["']/u.exec(facade)?.[1] ?? null;
  const basicRenderProductionOff = performance.includes("BASIC_RENDER_DISTANCE_ENABLED")
    && performance.includes("NEXT_PUBLIC_BLOCKWILD_BASIC_RENDER_DISTANCE");
  const strictScriptPresent = typeof packageData.scripts?.["audit:rust-migration"] === "string"
    && packageData.scripts["audit:rust-migration"].includes("--strict");
  const schemaConvergenceScriptPresent = [
    "node scripts/verify-integrated-runtime-schema-convergence.mjs",
    "node scripts/generate-integrated-runtime-domain-schema.mjs --check && node scripts/verify-integrated-runtime-schema-convergence.mjs",
    "node scripts/generate-integrated-runtime-domain-schema.mjs --check && node scripts/verify-integrated-runtime-schema-convergence.mjs --require-complete",
  ].includes(packageData.scripts?.["verify:rust-schema-convergence"]);
  // Audit the actual runner's forwarding behavior without spawning tests. A
  // source-text spelling check incorrectly rejected expanded R3 discovery.
  const expectedTests = testEntries.filter(entry => entry.isFile()
    && /^(?:(?:rust|renderer|r3|terrain-generation|world-streaming)-.+|world-import-source)[.]test[.](mjs|ts)$/u.test(entry.name))
    .map(entry => `tests/${entry.name}`).sort();
  const discoveryCalls = [];
  runRustEngineTests({ root: ROOT, entries: testEntries, log: () => {},
    spawn: (executable, arguments_, options) => {
      discoveryCalls.push({ executable, arguments_, cwd: options.cwd });
      return { status: 0 };
    } });
  const rustTestDiscoveryPresent = typeof packageData.scripts?.["test:rust-engine"] === "string"
    && packageData.scripts["test:rust-engine"].includes("run-rust-engine-tests.mjs")
    && expectedTests.length > 0 && discoveryCalls.length === 1
    && discoveryCalls[0].executable === process.execPath && discoveryCalls[0].cwd === ROOT
    && JSON.stringify(discoveryCalls[0].arguments_) === JSON.stringify(["--import", "tsx", "--test", ...expectedTests]);
  const terrainRollbackWindow = terrainRollbackWindowCheck(rollbackWindowDocument);

  const artifactSelector = JSON.parse(await text(path.join(ROOT, "public", "engine", "manifest.json")));
  const defaultArtifact = artifactSelector.artifacts?.[artifactSelector.defaultVariant];
  let artifactValid = false;
  let artifactReason = "default artifact is absent";
  if (defaultArtifact?.manifest) {
    const manifestPath = path.join(ROOT, "public", "engine", ...defaultArtifact.manifest.split("/"));
    try {
      const manifest = JSON.parse(await text(manifestPath));
      const wasmEntry = manifest.files?.find((entry) => entry.role === "wasm");
      if (wasmEntry) {
        const wasmPath = path.join(path.dirname(manifestPath), wasmEntry.path);
        const info = await stat(wasmPath);
        artifactValid = info.isFile() && info.size === wasmEntry.bytes;
        artifactReason = artifactValid ? "content-addressed default artifact is present" : "default artifact size does not match its manifest";
      }
    } catch (error) {
      artifactReason = error instanceof Error ? error.message : String(error);
    }
  }

  const blockers = [];
  if (uncheckedPlanItems.length) blockers.push(`${uncheckedPlanItems.length} master-plan definition-of-done items remain unchecked`);
  if (pendingAuthority.length) blockers.push(`${pendingAuthority.length} migratable authority rows are not Rust-authoritative or retired`);
  if (openLogGates.length) blockers.push(`${openLogGates.length} implementation-log completion gates remain open`);
  if (normalPathThreeImports.length) blockers.push(`${normalPathThreeImports.length} normal-path app modules still import Three.js`);
  if (staticThreeCompatibilityImports.length) blockers.push(`${staticThreeCompatibilityImports.length} normal-path modules statically import the Three.js compatibility bundle`);
  if (legacyAuthoritySymbols.length) blockers.push(`${legacyAuthoritySymbols.length} known TypeScript authority implementations remain`);
  if (missingWasmExports.length) blockers.push(`${missingWasmExports.length} integrated runtime Wasm exports are missing`);
  const effectiveSimulationPlayerDefault = declaredSimulationPlayerDefault ?? declaredLegacyEngineDefault;
  if (effectiveSimulationPlayerDefault?.toLowerCase() !== "rust") {
    blockers.push(`ledger simulation/player default is ${effectiveSimulationPlayerDefault ?? "unset"}`);
  }
  if (!/^required rust\/wasm by default(?:;|$)/iu.test(declaredTerrainGenerationDefault ?? "")) {
    blockers.push(`ledger terrain-generation implementation is ${declaredTerrainGenerationDefault ?? "unset"}`);
  }
  if (declaredRendererDefault?.toLowerCase() !== "wgpu") blockers.push(`ledger renderer default is ${declaredRendererDefault ?? "unset"}`);
  if (facadeStillDormant || !facadeImportedByVoxelGame) blockers.push("EngineFacade is not wired into VoxelGame");
  if (runtimeEngineDefault !== "rust") blockers.push(`runtime engine default is ${runtimeEngineDefault ?? "unset"}`);
  if (runtimeRendererDefault !== "wgpu") blockers.push(`runtime renderer default is ${runtimeRendererDefault ?? "unset"}`);
  if (!basicRenderProductionOff) blockers.push("Basic Render Distance production-off gate is not detectable");
  if (!strictScriptPresent) blockers.push("package.json does not expose the strict migration audit as a release gate");
  if (!schemaConvergenceScriptPresent) blockers.push("package.json does not expose the wire schema convergence verifier");
  if (!rustTestDiscoveryPresent) blockers.push("the standard Rust gate does not discover every rust-, renderer-, and r3- test file");
  if (!artifactValid) blockers.push(`default Wasm artifact is invalid: ${artifactReason}`);
  if (!terrainRollbackWindow.valid) blockers.push(`terrain rollback window is invalid: ${terrainRollbackWindow.reason}`);
  if (!wireSchemaConvergence.valid) {
    blockers.push(`wire schema convergence manifest is invalid: ${wireSchemaConvergence.blockers[0] ?? "unknown validation failure"}`);
  } else if (!wireSchemaConvergence.complete) {
    blockers.push(`wire schema convergence is partial: ${wireSchemaConvergence.completeDomains}/${wireSchemaConvergence.domains.length} domains complete`);
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    complete: blockers.length === 0,
    blockers,
    counts: {
      planUnchecked: uncheckedPlanItems.length,
      authorityPending: pendingAuthority.length,
      openLogGates: openLogGates.length,
      normalPathThreeImports: normalPathThreeImports.length,
      compatibilityThreeImports: compatibilityThreeImports.length,
      staticThreeCompatibilityImports: staticThreeCompatibilityImports.length,
      legacyAuthoritySymbols: legacyAuthoritySymbols.length,
      missingWasmExports: missingWasmExports.length,
    },
    defaults: {
      // Preserve the legacy field for report consumers, but never synthesize it
      // from split declarations that intentionally describe mixed authority.
      engine: declaredLegacyEngineDefault,
      simulationPlayer: declaredSimulationPlayerDefault,
      terrainGeneration: declaredTerrainGenerationDefault,
      renderer: declaredRendererDefault,
    },
    checks: {
      basicRenderProductionOff,
      facadeWired: !facadeStillDormant && facadeImportedByVoxelGame,
      runtimeEngineDefault,
      runtimeRendererDefault,
      strictScriptPresent,
      schemaConvergenceScriptPresent,
      rustTestDiscoveryPresent,
      artifactValid,
      artifactReason,
      terrainRollbackWindowValid: terrainRollbackWindow.valid,
      terrainRollbackWindowReason: terrainRollbackWindow.reason,
    },
    terrainRollbackWindow: terrainRollbackWindow.summary,
    wireSchemaConvergence,
    pendingAuthority: pendingAuthority.map(({ domain, mode, rustTarget }) => ({ domain, mode, rustTarget })),
    uncheckedPlanItems,
    openLogGates,
    normalPathThreeImports,
    compatibilityThreeImports,
    staticThreeCompatibilityImports,
    legacyAuthoritySymbols,
    missingWasmExports,
  };
}

const report = await audit();
const rendered = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, rendered, "utf8");
process.stdout.write(rendered);
if (strict && !report.complete) process.exitCode = 1;
