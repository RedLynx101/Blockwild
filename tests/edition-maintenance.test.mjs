import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

function dependabotTuples(source) {
  return [...source.matchAll(
    /package-ecosystem:\s*([^\s]+)[\s\S]*?\n\s+directory:\s*([^\s]+)[\s\S]*?\n\s+target-branch:\s*([^\s]+)/gu,
  )].map((match) => `${match[1]}|${match[2]}|${match[3]}`).sort();
}

test("package and repository identify the TypeScript edition", async () => {
  const [packageSource, readme, agents, contributing, development] = await Promise.all([
    read("package.json"),
    read("README.md"),
    read("AGENTS.md"),
    read("CONTRIBUTING.md"),
    read("docs/DEVELOPMENT.md"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.displayName, "Blockwild TypeScript Edition");
  assert.deepEqual(packageJson.blockwildEdition, {
    id: "typescript",
    branch: "edition/typescript",
    runtime: "typescript-three",
  });
  assert.equal(
    packageJson.scripts["test:edition-maintenance"],
    "node --test tests/edition-maintenance.test.mjs",
  );
  assert.match(packageJson.scripts["test:repository"], /edition-maintenance\.test\.mjs/);

  for (const source of [readme, agents, contributing, development]) {
    assert.match(source, /edition\/typescript/);
  }
  assert.match(readme, /git switch edition\/typescript/);
  assert.match(readme, /ci\.yml\/badge\.svg\?branch=edition%2Ftypescript/);
  assert.match(readme, /codeql\.yml\/badge\.svg\?branch=edition%2Ftypescript/);
  assert.match(readme, /github\.com\/RedLynx101\/blockwild\/tree\/edition\/rust/);
  assert.match(readme, /baseline\/typescript-pre-conversion-2026-08-11/);
  assert.match(agents, /does not consume Rust build output|Do not add dependencies on the Rust workspace/);
});

test("maintenance and parity documents retain versioned compatibility boundaries", async () => {
  const [maintenance, parity] = await Promise.all([
    read("docs/EDITION_MAINTENANCE.md"),
    read("docs/EDITION_PARITY.md"),
  ]);

  assert.match(maintenance, /Contract version: \*\*1\*\*/);
  assert.match(maintenance, /edition\/typescript/);
  assert.match(maintenance, /edition\/rust/);
  assert.match(maintenance, /Routine merges .* prohibited/i);
  assert.match(maintenance, /deploymentEnabled/);
  assert.match(maintenance, /9\/32/);
  assert.match(maintenance, /reads `\.github\/dependabot\.yml` from the repository's default branch/);
  assert.match(maintenance, /security updates always use the repository default branch/);
  assert.match(maintenance, /scheduled workflows.*run the latest commit on the default branch/i);

  assert.match(parity, /Parity specification version: \*\*1\*\*/);
  assert.match(parity, /`not-present`/);
  assert.match(parity, /`implemented`/);
  assert.match(parity, /`verified`/);
  assert.match(parity, /No automatic cross-edition save import or converter is supported/);
  assert.match(parity, /Behavior specification template/);
  assert.match(parity, /TypeScript implementation SHA:/);
  assert.match(parity, /Rust implementation SHA:/);
});

test("automation targets only the TypeScript edition with edition-aware caches", async () => {
  const [ci, codeql, dependencyReview, dependabot] = await Promise.all([
    read(".github/workflows/ci.yml"),
    read(".github/workflows/codeql.yml"),
    read(".github/workflows/dependency-review.yml"),
    read(".github/dependabot.yml"),
  ]);

  for (const workflow of [ci, codeql, dependencyReview]) {
    assert.match(workflow, /branches: \[edition\/typescript\]/);
    assert.doesNotMatch(workflow, /branches: \[main\]/);
    assert.doesNotMatch(workflow, /branches: \[edition\/rust\]/);
  }
  assert.match(ci, /name: TypeScript edition contract/);
  assert.match(ci, /run: npm run test:edition-maintenance/);
  assert.equal((ci.match(/blockwild-typescript-npm-/g) ?? []).length, 6);
  assert.doesNotMatch(ci, /\bcargo\b|rustup|wasm-bindgen|public\/engine/i);
  assert.deepEqual(dependabotTuples(dependabot), [
    "cargo|/engine|edition/rust",
    "github-actions|/|edition/rust",
    "github-actions|/|edition/typescript",
    "npm|/|edition/rust",
    "npm|/|edition/typescript",
  ]);
});

test("automatic Vercel Git deployment is disabled", async () => {
  const config = JSON.parse(await read("vercel.json"));

  assert.equal(config.git?.deploymentEnabled, false);
  assert.equal(config.buildCommand, "npm run build:vercel");
});
