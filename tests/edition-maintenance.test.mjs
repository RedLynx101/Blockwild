import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("package and repository identify the unfinished Rust edition", async () => {
  const [packageSource, readme, agents, contributing, development, paused] = await Promise.all([
    read("package.json"),
    read("README.md"),
    read("AGENTS.md"),
    read("CONTRIBUTING.md"),
    read("docs/DEVELOPMENT.md"),
    read("docs/PAUSED_WORK_HANDOFF_2026-09-07.md"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.displayName, "Blockwild Rust Edition");
  assert.deepEqual(packageJson.blockwildEdition, {
    id: "rust",
    branch: "edition/rust",
    runtime: "rust-wasm-wgpu",
  });
  assert.equal(
    packageJson.scripts["test:edition-maintenance"],
    "node --test tests/edition-maintenance.test.mjs",
  );
  assert.match(packageJson.scripts["test:repository"], /edition-maintenance\.test\.mjs/);

  for (const source of [readme, agents, contributing, development, paused]) {
    assert.match(source, /edition\/rust/);
  }
  assert.match(readme, /git switch edition\/rust/);
  assert.match(readme, /9\/32/);
  assert.match(readme, /139\/143/);
  assert.match(readme, /github\.com\/RedLynx101\/blockwild\/tree\/edition\/typescript/);
  assert.match(readme, /codex\/checkpoint-2026-09-07/);
  assert.match(paused, /a40e62c33b60b973ca75e87990503948ed7f2a65/);
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

  assert.match(parity, /Parity specification version: \*\*1\*\*/);
  assert.match(parity, /`not-present`/);
  assert.match(parity, /`implemented`/);
  assert.match(parity, /`verified`/);
  assert.match(parity, /No automatic cross-edition save import or converter is supported/);
  assert.match(parity, /Behavior specification template/);
  assert.match(parity, /TypeScript implementation SHA:/);
  assert.match(parity, /Rust implementation SHA:/);
});

test("automation targets the Rust edition and preserves its gates", async () => {
  const [ci, rustEngine, codeql, dependencyReview, dependabot] = await Promise.all([
    read(".github/workflows/ci.yml"),
    read(".github/workflows/rust-engine.yml"),
    read(".github/workflows/codeql.yml"),
    read(".github/workflows/dependency-review.yml"),
    read(".github/dependabot.yml"),
  ]);

  for (const workflow of [ci, rustEngine, codeql, dependencyReview]) {
    assert.match(workflow, /branches: \[edition\/rust\]/);
    assert.doesNotMatch(workflow, /branches: \[main\]/);
    assert.doesNotMatch(workflow, /branches: \[edition\/typescript\]/);
    assert.doesNotMatch(workflow, /continue-on-error/);
  }
  assert.match(ci, /name: Rust edition contract/);
  assert.match(ci, /run: npm run test:edition-maintenance/);
  assert.equal((ci.match(/blockwild-rust-npm-/g) ?? []).length, 6);

  assert.equal((rustEngine.match(/blockwild-rust-cargo-/g) ?? []).length, 2);
  assert.equal((rustEngine.match(/blockwild-rust-npm-/g) ?? []).length, 2);
  assert.match(rustEngine, /rustc-\$\{\{ env\.BLOCKWILD_RUST_TOOLCHAIN \}\}/);
  assert.match(rustEngine, /engine\/rust-toolchain\.toml/);
  assert.match(rustEngine, /engine\/\*\*\/\*\.rs/);
  assert.match(rustEngine, /blockwild-rust-migration-gates-rustc-.*github\.sha/);
  assert.match(rustEngine, /wasm-bindgen-cli --version 0\.2\.122 --locked/);
  assert.match(rustEngine, /tests\/acceptance\/\*\*/);
  assert.match(rustEngine, /npm\.cmd run test:rust-engine/);

  assert.equal((dependabot.match(/target-branch: edition\/rust/g) ?? []).length, 3);
  assert.match(dependabot, /package-ecosystem: cargo/);
});

test("automatic Vercel Git deployment is disabled", async () => {
  const config = JSON.parse(await read("vercel.json"));

  assert.equal(config.git?.deploymentEnabled, false);
  assert.equal(config.buildCommand, "npm run build:vercel");
});
