import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rollbackWindowPath = path.join(root, "docs", "RUST_ENGINE_ROLLBACK_WINDOWS.json");
const schemaConvergencePath = path.join(root, "engine", "schema", "integrated-runtime-r5-r9.v1.json");

function rollbackAudit(source) {
  const fixture = path.join(tmpdir(), `blockwild-rollback-window-${randomUUID()}.json`);
  writeFileSync(fixture, JSON.stringify(source), "utf8");
  try {
    const result = spawnSync(process.execPath, [
      "scripts/audit-rust-migration.mjs",
      "--rollback-windows",
      fixture,
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    unlinkSync(fixture);
  }
}

function stableRelease(releaseId, commitSha, measuredAt) {
  return {
    releaseId,
    commitSha,
    buildProfile: "rust-primary",
    evidence: `work/rust-worldgen-promotion/releases/${releaseId}.json`,
    measuredAt,
  };
}

function schemaConvergenceAudit(source) {
  const fixture = path.join(tmpdir(), `blockwild-schema-convergence-audit-${randomUUID()}.json`);
  writeFileSync(fixture, JSON.stringify(source), "utf8");
  try {
    const result = spawnSync(process.execPath, [
      "scripts/audit-rust-migration.mjs",
      "--schema-convergence",
      fixture,
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    unlinkSync(fixture);
  }
}

function withoutField(source, field) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => key !== field));
}

test("Rust migration completion audit emits a bounded, machine-readable release report", () => {
  const output = execFileSync(process.execPath, ["scripts/audit-rust-migration.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  const report = JSON.parse(output);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.complete, false);
  assert.ok(Array.isArray(report.blockers));
  assert.deepEqual(report.defaults, {
    engine: null,
    simulationPlayer: "TypeScript",
    terrainGeneration: "required Rust/Wasm by default; explicit TypeScript rollback build",
    renderer: "Three.js",
  });
  assert.ok(report.blockers.includes("ledger simulation/player default is TypeScript"));
  assert.ok(!report.blockers.includes("ledger engine default is unset"));
  assert.ok(!report.blockers.some((blocker) => blocker.startsWith("ledger terrain-generation implementation is ")));
  assert.ok(report.blockers.includes("ledger renderer default is Three.js"));
  assert.ok(Array.isArray(report.pendingAuthority));
  assert.ok(Array.isArray(report.normalPathThreeImports));
  assert.ok(Array.isArray(report.compatibilityThreeImports));
  assert.ok(report.compatibilityThreeImports.includes("app/three-compat/visual-theme-audit.ts"));
  assert.ok(!report.normalPathThreeImports.includes("app/three-compat/visual-theme-audit.ts"));
  assert.ok(Array.isArray(report.staticThreeCompatibilityImports));
  assert.ok(Array.isArray(report.legacyAuthoritySymbols));
  assert.ok(Array.isArray(report.missingWasmExports));
  assert.deepEqual(report.missingWasmExports, []);
  assert.equal(report.checks.strictScriptPresent, true);
  assert.equal(report.checks.schemaConvergenceScriptPresent, true);
  assert.equal(report.checks.rustTestDiscoveryPresent, true);
  assert.equal(report.checks.basicRenderProductionOff, true);
  assert.equal(typeof report.checks.facadeWired, "boolean");
  assert.equal(typeof report.checks.runtimeEngineDefault, "string");
  assert.equal(typeof report.checks.runtimeRendererDefault, "string");
  assert.equal(report.checks.artifactValid, true);
  assert.equal(report.checks.terrainRollbackWindowValid, true);
  assert.deepEqual(report.terrainRollbackWindow, {
    minimumStableReleases: 2,
    verifiedStableReleases: [],
    retireAfter: null,
  });
  assert.equal(report.wireSchemaConvergence.valid, true);
  assert.equal(report.wireSchemaConvergence.complete, true);
  assert.equal(report.wireSchemaConvergence.completeDomains, 5);
  assert.deepEqual(report.wireSchemaConvergence.partialDomains, []);
  assert.ok(!report.blockers.some((blocker) => blocker.startsWith("wire schema convergence is partial:")));
});

test("the migration audit keeps explicit partial wire evidence separate from whole-project completion", () => {
  const source = JSON.parse(readFileSync(schemaConvergencePath, "utf8"));
  source.domains[1].assurance.hashes.status = "partial";
  source.domains[1].completion = { status: "partial", complete: false, remaining: ["synthetic-semantic-hash-gap"] };
  const report = schemaConvergenceAudit(source);
  assert.equal(report.complete, false);
  assert.equal(report.wireSchemaConvergence.valid, true);
  assert.equal(report.wireSchemaConvergence.complete, false);
  assert.equal(report.wireSchemaConvergence.completeDomains, 4);
  assert.deepEqual(report.wireSchemaConvergence.partialDomains, ["R6/entities"]);
  assert.ok(report.blockers.includes("wire schema convergence is partial: 4/5 domains complete"));
});

test("the migration audit reports invalid wire schema convergence separately", () => {
  const source = JSON.parse(readFileSync(schemaConvergencePath, "utf8"));
  source.domains[0].evidence.tests = [];
  const report = schemaConvergenceAudit(source);
  assert.equal(report.wireSchemaConvergence.valid, false);
  assert.equal(report.wireSchemaConvergence.complete, false);
  assert.match(report.wireSchemaConvergence.blockers.join("\n"), /R5\/simulation\.evidence\.tests must be a non-empty/);
  assert.ok(report.blockers.some((blocker) => blocker.startsWith("wire schema convergence manifest is invalid:")));
});

test("the migration audit rejects terrain rollback retirement before two verified stable releases", () => {
  const source = JSON.parse(readFileSync(rollbackWindowPath, "utf8"));
  assert.equal(source.schemaVersion, 2);
  assert.equal(source.supportWindow.minimumStableReleases, 2);
  assert.deepEqual(source.supportWindow.verifiedStableReleases, []);
  assert.equal(source.supportWindow.retireAfter, null);

  const first = stableRelease("v1.14.0", "1".repeat(40), "2026-08-23T10:00:00.000Z");
  const report = rollbackAudit({
    ...source,
    supportWindow: {
      ...source.supportWindow,
      verifiedStableReleases: [first],
      retireAfter: "v1.14.0",
    },
  });
  assert.equal(report.checks.terrainRollbackWindowValid, false);
  assert.match(report.checks.terrainRollbackWindowReason, /only 1\/2 verified stable releases/);
  assert.ok(report.blockers.some((blocker) => blocker.startsWith("terrain rollback window is invalid:")));
});

test("the migration audit accepts exact distinct release evidence and a qualifying retirement anchor", () => {
  const source = JSON.parse(readFileSync(rollbackWindowPath, "utf8"));
  const first = stableRelease("v1.14.0", "1".repeat(40), "2026-08-23T10:00:00.000Z");
  const second = stableRelease("v1.15.0", "2".repeat(40), "2026-08-30T10:00:00.000Z");
  second.evidence = "https://example.com/blockwild/v1.15.0/rust-primary-report.json";
  const report = rollbackAudit({
    ...source,
    supportWindow: {
      ...source.supportWindow,
      verifiedStableReleases: [first, second],
      retireAfter: second.releaseId,
    },
  });
  assert.equal(report.checks.terrainRollbackWindowValid, true);
  assert.equal(report.terrainRollbackWindow.retireAfter, "v1.15.0");
  assert.deepEqual(report.terrainRollbackWindow.verifiedStableReleases, [first, second]);
});

test("the migration audit rejects malformed, incomplete, repeated, or non-Rust release evidence", async (t) => {
  const source = JSON.parse(readFileSync(rollbackWindowPath, "utf8"));
  const first = stableRelease("v1.14.0", "1".repeat(40), "2026-08-23T10:00:00.000Z");
  const second = stableRelease("v1.15.0", "2".repeat(40), "2026-08-30T10:00:00.000Z");
  const cases = [
    ["malformed record", ["v1.14.0"], /exact schema-v2 evidence shape/],
    ["extra record field", [{ ...first, note: "not part of the evidence contract" }], /exact schema-v2 evidence shape/],
    ["missing commit", [withoutField(first, "commitSha")], /missing an exact full commitSha/],
    ["empty commit", [{ ...first, commitSha: "" }], /missing an exact full commitSha/],
    ["abbreviated commit", [{ ...first, commitSha: "1234567" }], /missing an exact full commitSha/],
    ["non-Rust profile", [{ ...first, buildProfile: "typescript-rollback" }], /does not use the rust-primary build profile/],
    ["missing evidence", [withoutField(first, "evidence")], /missing a portable evidence path or HTTPS URL/],
    ["empty evidence", [{ ...first, evidence: "" }], /missing a portable evidence path or HTTPS URL/],
    ["non-portable evidence", [{ ...first, evidence: "../outside/report.json" }], /missing a portable evidence path or HTTPS URL/],
    ["missing timestamp", [withoutField(first, "measuredAt")], /missing a canonical UTC measuredAt timestamp/],
    ["empty timestamp", [{ ...first, measuredAt: "" }], /missing a canonical UTC measuredAt timestamp/],
    ["non-canonical timestamp", [{ ...first, measuredAt: "2026-08-23T10:00:00Z" }], /missing a canonical UTC measuredAt timestamp/],
    ["duplicate release identifier", [first, { ...second, releaseId: first.releaseId }], /identifiers are not unique/],
    ["duplicate release commit", [first, { ...second, commitSha: first.commitSha }], /commits are not distinct/],
    ["out-of-order measurements", [second, first], /not ordered by strictly increasing measuredAt/],
  ];

  for (const [name, verifiedStableReleases, reason] of cases) {
    await t.test(name, () => {
      const report = rollbackAudit({
        ...source,
        supportWindow: { ...source.supportWindow, verifiedStableReleases },
      });
      assert.equal(report.checks.terrainRollbackWindowValid, false);
      assert.match(report.checks.terrainRollbackWindowReason, reason);
    });
  }
});

test("the migration audit rejects retirement anchors before or outside the qualifying release window", async (t) => {
  const source = JSON.parse(readFileSync(rollbackWindowPath, "utf8"));
  const first = stableRelease("v1.14.0", "1".repeat(40), "2026-08-23T10:00:00.000Z");
  const second = stableRelease("v1.15.0", "2".repeat(40), "2026-08-30T10:00:00.000Z");
  for (const [name, retireAfter, reason] of [
    ["premature recorded anchor", first.releaseId, /precedes the required 2 verified stable releases/],
    ["unknown anchor", "v1.16.0", /is not a verified stable release/],
  ]) {
    await t.test(name, () => {
      const report = rollbackAudit({
        ...source,
        supportWindow: {
          ...source.supportWindow,
          verifiedStableReleases: [first, second],
          retireAfter,
        },
      });
      assert.equal(report.checks.terrainRollbackWindowValid, false);
      assert.match(report.checks.terrainRollbackWindowReason, reason);
    });
  }
});

test("Rust migration strict audit fails closed for the current mixed-authority defaults", () => {
  const result = spawnSync(process.execPath, ["scripts/audit-rust-migration.mjs", "--strict"], {
    cwd: root,
    encoding: "utf8",
  });
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(report.complete, false);
  assert.ok(report.blockers.includes("ledger simulation/player default is TypeScript"));
  assert.ok(report.blockers.includes("ledger renderer default is Three.js"));
  assert.ok(!report.blockers.some((blocker) => blocker.startsWith("ledger terrain-generation implementation is ")));
});
