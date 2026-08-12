import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const coveragePath = path.join(ROOT, "tests", "fixtures", "rust-engine", "r11-renderer", "visual-coverage.json");

async function normalPathThreeImports() {
  const game = path.join(ROOT, "app", "game");
  const files = await readdir(game, { recursive: true, withFileTypes: true });
  const imports: string[] = [];
  for (const entry of files) {
    if (!entry.isFile() || !/\.(?:ts|tsx)$/u.test(entry.name)) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const source = await readFile(absolute, "utf8");
    if (/from\s+["']three["']|import\s*\(\s*["']three["']/u.test(source)) {
      imports.push(path.relative(ROOT, absolute).replaceAll("\\", "/"));
    }
  }
  return imports.sort();
}

test("visual coverage ledger maps every remaining normal-path Three module without declaring retirement", async () => {
  const coverage = JSON.parse(await readFile(coveragePath, "utf8")) as {
    threeRetired: boolean;
    normalPathModules: Record<string, { cases: string[]; state: string }>;
    compatibilityModules: Record<string, { cases: string[]; state: string }>;
    scenes: Record<string, string[]>;
  };
  assert.equal(coverage.threeRetired, false);
  const imports = await normalPathThreeImports();
  assert.deepEqual(Object.keys(coverage.normalPathModules).sort(), imports);
  for (const [module, record] of Object.entries(coverage.normalPathModules)) {
    assert.ok(record.cases.length > 0, `${module} has no visual case`);
    assert.ok(record.state.includes("pending") || record.state.includes("awaiting"), `${module} prematurely claims retirement`);
    for (const visualCase of record.cases) assert.ok(coverage.scenes[visualCase], `${module} refers to unknown case ${visualCase}`);
  }
  assert.deepEqual(Object.keys(coverage.compatibilityModules), [
    "app/three-compat/PlayerAvatarPreviewThree.tsx",
    "app/three-compat/visual-theme-audit.ts",
  ]);
  const avatarPreview = coverage.compatibilityModules["app/three-compat/PlayerAvatarPreviewThree.tsx"];
  assert.ok(avatarPreview.state.includes("pending"), "avatar compatibility preview must not claim renderer retirement");
  assert.deepEqual(avatarPreview.cases, ["overworld-day", "settlement-machinery"]);
  const visualThemeOracle = coverage.compatibilityModules["app/three-compat/visual-theme-audit.ts"];
  assert.equal(visualThemeOracle.state, "tested-build-tool-oracle");
  for (const visualCase of visualThemeOracle.cases) assert.ok(coverage.scenes[visualCase], `visual-theme oracle refers to unknown case ${visualCase}`);
  const [auditScript, auditTest] = await Promise.all([
    readFile(path.join(ROOT, "scripts", "audit-visual-theme.ts"), "utf8"),
    readFile(path.join(ROOT, "tests", "visual-theme.test.ts"), "utf8"),
  ]);
  assert.match(auditScript, /from "\.\.\/app\/three-compat\/visual-theme-audit"/u);
  assert.match(auditTest, /from "\.\.\/app\/three-compat\/visual-theme-audit"/u);
});

test("visual coverage ledger records every cutover failure mode", async () => {
  const coverage = JSON.parse(await readFile(coveragePath, "utf8")) as { behaviorEvidence: Record<string, string[]> };
  assert.deepEqual(Object.keys(coverage.behaviorEvidence).sort(), [
    "canvasResizeAndFullscreen",
    "capabilityFallback",
    "deviceLossAndRecreate",
    "liveCanvas",
    "resourceRevisionAndStaleFrame",
    "transparentOrdering",
    "underwaterAndCaveFog",
  ]);
  assert.ok(Object.values(coverage.behaviorEvidence).every((evidence) => evidence.length >= 2));
});
