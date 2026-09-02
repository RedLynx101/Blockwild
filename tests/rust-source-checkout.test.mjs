import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRustEngineSourceSnapshot } from "../scripts/rust-engine-common.mjs";
import { createIsolatedGitEnvironment, listRustSourceCheckoutInputs, verifyRustSourceCheckout } from "../scripts/verify-rust-source-checkout.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(workspace, "work");
mkdirSync(work, { recursive: true });
// Keep owned fixtures and reports for diagnosis; no recursive cleanup is used.
const owned = mkdtempSync(path.join(work, "rust-source-checkout-tests-"));
const pinnedAttributes = readFileSync(path.join(workspace, ".gitattributes"), "utf8");

function fixture(label, attributes = pinnedAttributes) {
  const root = path.join(owned, label, "source");
  const entries = [
    [".gitattributes", attributes],
    ["engine/Cargo.toml", "[workspace]\nmembers = []\n"],
    ["engine/src/lib.rs", "pub fn example() -> u32 { 42 }\n"],
    ["engine/assets/example.png", Buffer.from([0, 13, 10, 255, 10, 42])],
    // No NUL: only the explicit binary rule prevents CRLF normalization.
    ["engine/assets/named-binary.png", "binary-by-attribute\r\npreserve-these-bytes\r\n"],
    ["engine/crates/example/target/included.txt", "nested target is not excluded\n"],
    ["engine/work/ignored.txt", "root scratch is excluded\n"],
    ["engine/target/ignored.txt", "root build output is excluded\n"],
    ["engine/.sites-runtime/ignored.txt", "root runtime is excluded\n"],
    ["scripts/build-rust-engine.mjs", "export const build = true;\n"],
    ["scripts/rust-engine-common.mjs", "export const common = true;\n"],
  ];
  for (const [relative, bytes] of entries) {
    const absolute = path.join(root, ...relative.split("/"));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes, { flag: "wx" });
  }
  return { root, output: path.join(owned, label, "verification") };
}

test("isolated clean checkout preserves pinned text and binary inputs with autocrlf=true", () => {
  const { root, output } = fixture("preserved");
  const baseline = createRustEngineSourceSnapshot(root);
  const result = verifyRustSourceCheckout({ repositoryRoot: root, outputDirectory: output, expectedSourceDigest: baseline.digest, expectedFileCount: baseline.fileCount });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.sourceBefore, baseline);
  assert.deepEqual(result.checkoutSource, baseline);
  assert.deepEqual(result.sourceAfter, baseline);
  assert.equal(result.checkoutStatus, "");
  assert.deepEqual(result.byteDifferences, []);
  assert.equal(result.attributesUnchanged, true);
  assert.equal(result.files.length, baseline.fileCount + 1);
  assert.equal(existsSync(path.join(root, ".git")), false, "the input repository receives no Git metadata");
  assert.equal(existsSync(path.join(output, "source-repository", ".git")), true);
  assert.equal(existsSync(path.join(output, "clean-checkout", ".git")), true);
  assert.deepEqual(readFileSync(path.join(output, "clean-checkout", "engine/assets/named-binary.png")), readFileSync(path.join(root, "engine/assets/named-binary.png")));
  assert.equal(JSON.parse(readFileSync(result.reportPath, "utf8")).status, "passed");
});

test("enumeration uses root-only exclusions and matches the shared snapshot file count", () => {
  const { root } = fixture("enumeration");
  const files = listRustSourceCheckoutInputs(root);
  assert.equal(files.length, createRustEngineSourceSnapshot(root).fileCount);
  assert.ok(files.includes("engine/crates/example/target/included.txt"));
  assert.ok(!files.some((file) => /^engine\/(work|target|\.sites-runtime)\//.test(file)));
  assert.ok(!files.includes(".gitattributes"));
});

test("missing LF pins produces a retained negative report without changing input bytes", () => {
  const { root, output } = fixture("drift", "* text=auto\n*.png binary\n");
  const baseline = createRustEngineSourceSnapshot(root);
  assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: root, outputDirectory: output }), /Clean checkout changed raw source bytes/);
  const report = JSON.parse(readFileSync(path.join(output, "report.json"), "utf8"));
  assert.equal(report.status, "failed");
  assert.notEqual(report.checkoutSource.digest, baseline.digest);
  assert.ok(report.byteDifferences.some((file) => file.path === "engine/src/lib.rs"));
  assert.ok(!report.byteDifferences.some((file) => file.path.endsWith(".png")));
  assert.deepEqual(createRustEngineSourceSnapshot(root), baseline);
  assert.equal(existsSync(path.join(root, ".git")), false);
});

test("expected digest and file-count drift fail before creating output", () => {
  const { root, output } = fixture("expected-drift");
  assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: root, outputDirectory: output, expectedSourceDigest: "0".repeat(64) }), /Source digest differs/);
  assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: root, outputDirectory: output, expectedFileCount: 999 }), /Source file count differs/);
  assert.equal(existsSync(output), false);
});

test("root, invalid, dirty and out-of-work output directories are refused", () => {
  const { root, output } = fixture("paths");
  for (const invalid of [workspace, work, path.parse(workspace).root, path.join(workspace, "not-a-work-output")]) {
    assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: root, outputDirectory: invalid }), /Output must be strictly beneath workspace work/);
  }
  assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: path.parse(workspace).root, outputDirectory: output }), /filesystem root or home directory/);
  assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: os.homedir(), outputDirectory: output }), /filesystem root or home directory/);
  assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: path.join(root, "missing"), outputDirectory: output }), /Source directory is missing/);
  assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: root, outputDirectory: path.join(root, "engine", "output") }), /Output would overlap source inputs/);
  mkdirSync(output);
  writeFileSync(path.join(output, "retain.txt"), "do not change\n", { flag: "wx" });
  assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: root, outputDirectory: output }), /refusing existing output/);
  assert.equal(readFileSync(path.join(output, "retain.txt"), "utf8"), "do not change\n");
  assert.equal(existsSync(path.join(output, "source-repository")), false);
});

test("source and output directory links are refused", () => {
  const { root, output } = fixture("links");
  const destination = path.join(owned, "link-destination");
  mkdirSync(destination);
  symlinkSync(destination, path.join(root, "engine", "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: root, outputDirectory: output }), /Links are not allowed/);
  assert.equal(existsSync(output), false);
  const clean = fixture("output-links");
  const linkedOutputParent = path.join(owned, "linked-output-parent");
  symlinkSync(destination, linkedOutputParent, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => verifyRustSourceCheckout({ repositoryRoot: clean.root, outputDirectory: path.join(linkedOutputParent, "run") }), /Links are not allowed/);
  assert.equal(existsSync(path.join(destination, "run")), false);
});

test("inherited Git routing/config is removed without redefining home/profile", () => {
  const inherited = {
    PATH: process.env.PATH,
    HOME: "unchanged-home",
    USERPROFILE: "unchanged-profile",
    GIT_DIR: "never-use-this-metadata",
    GIT_INDEX_FILE: "never-use-this-index",
    GIT_OBJECT_DIRECTORY: "never-use-these-objects",
    GIT_WORK_TREE: "never-use-this-worktree",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.attributesFile",
    GIT_CONFIG_VALUE_0: "never-use-these-attributes",
    git_config_parameters: "inherited config",
  };
  const isolated = createIsolatedGitEnvironment("owned-empty-config", inherited);
  for (const key of Object.keys(inherited).filter((name) => name.toUpperCase().startsWith("GIT_"))) assert.equal(isolated[key], undefined);
  assert.equal(isolated.GIT_CONFIG_GLOBAL, "owned-empty-config");
  assert.equal(isolated.GIT_CONFIG_SYSTEM, "owned-empty-config");
  assert.equal(isolated.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(isolated.GIT_ATTR_NOSYSTEM, "1");
  assert.equal(isolated.HOME, inherited.HOME);
  assert.equal(isolated.USERPROFILE, inherited.USERPROFILE);
  assert.equal(inherited.GIT_DIR, "never-use-this-metadata");
});
