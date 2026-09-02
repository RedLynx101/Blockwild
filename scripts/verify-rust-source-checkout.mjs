#!/usr/bin/env node
/**
 * Verify source-snapshot bytes through a real, isolated Git clean checkout.
 *
 * Usage: node scripts/verify-rust-source-checkout.mjs --output work/<fresh-name>
 *   [--expected-source-digest <sha256>] [--expected-file-count <count>]
 *
 * No command runs against the real repository's Git metadata. All temporary
 * files and the retained report live beneath this workspace's work/ directory.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSha256,
  createRustEngineSourceSnapshot,
  isDirectInvocation,
} from "./rust-engine-common.mjs";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_ROOT = path.join(WORKSPACE_ROOT, "work");
const SOURCE_SCRIPTS = ["scripts/build-rust-engine.mjs", "scripts/rust-engine-common.mjs"];
const EXCLUDED_ENGINE_ROOTS = new Set([".sites-runtime", "target", "work"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const comparePaths = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertNoLinks(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let entry;
    try {
      entry = lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (entry.isSymbolicLink()) throw new Error(`Links are not allowed: ${current}`);
  }
}

function assertSourceRoot(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  if (root === path.parse(root).root || root === path.resolve(os.homedir())) {
    throw new Error(`Refusing a filesystem root or home directory as source: ${root}`);
  }
  assertNoLinks(root);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new Error(`Source directory is missing: ${root}`);
  return realpathSync(root);
}

function assertRegularSourceFile(absolute) {
  assertNoLinks(absolute);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
    throw new Error(`Source input must be a regular file: ${absolute}`);
  }
}

/**
 * Mirror createRustEngineSourceSnapshot's enumeration, including untracked
 * files and root-only exclusions. Comparing the copied tree with that shared
 * snapshot function below makes any future enumeration mismatch fail closed.
 */
export function listRustSourceCheckoutInputs(repositoryRoot) {
  const root = assertSourceRoot(repositoryRoot);
  const engineRoot = path.join(root, "engine");
  assertNoLinks(engineRoot);
  if (!existsSync(engineRoot) || !lstatSync(engineRoot).isDirectory()) throw new Error(`Rust engine source directory is missing: ${engineRoot}`);
  const files = [];
  function visit(directory, relativeDirectory = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => comparePaths(a.name, b.name))) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Links are not allowed in source inputs: ${absolute}`);
      if (entry.isDirectory()) {
        if (!relativeDirectory && EXCLUDED_ENGINE_ROOTS.has(entry.name)) continue;
        visit(absolute, relative);
      } else if (entry.isFile()) {
        files.push(`engine/${relative}`);
      } else {
        throw new Error(`Unsupported source input: ${absolute}`);
      }
    }
  }
  visit(engineRoot);
  for (const relative of SOURCE_SCRIPTS) {
    assertRegularSourceFile(path.join(root, ...relative.split("/")));
    files.push(relative);
  }
  return files.sort(comparePaths);
}

export function createIsolatedGitEnvironment(emptyConfig, inherited = process.env) {
  const environment = Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: emptyConfig,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Rust source checkout verifier",
    GIT_AUTHOR_EMAIL: "rust-source-checkout@example.invalid",
    GIT_COMMITTER_NAME: "Rust source checkout verifier",
    GIT_COMMITTER_EMAIL: "rust-source-checkout@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
}

function prepareOutputDirectory(outputDirectory, sourceRoot) {
  if (!outputDirectory) throw new Error("A fresh --output directory beneath workspace work/ is required.");
  const output = path.resolve(WORKSPACE_ROOT, outputDirectory);
  if (!isWithin(WORK_ROOT, output)) throw new Error(`Output must be strictly beneath workspace work/: ${output}`);
  if (output === sourceRoot || isWithin(output, sourceRoot)
      || (isWithin(sourceRoot, output) && !isWithin(path.join(sourceRoot, "work"), output))) {
    throw new Error(`Output would overlap source inputs: ${output}`);
  }
  assertNoLinks(output);
  if (existsSync(output)) throw new Error(`Output directory must be fresh; refusing existing output: ${output}`);
  mkdirSync(path.dirname(output), { recursive: true });
  assertNoLinks(path.dirname(output));
  if (!isWithin(realpathSync(WORK_ROOT), path.join(realpathSync(path.dirname(output)), path.basename(output)))) {
    throw new Error(`Resolved output escapes workspace work/: ${output}`);
  }
  mkdirSync(output);
  return realpathSync(output);
}

function snapshotsMatch(left, right) {
  return left.schema === right.schema && left.digest === right.digest && left.fileCount === right.fileCount;
}

export function verifyRustSourceCheckout({
  repositoryRoot = WORKSPACE_ROOT,
  outputDirectory,
  expectedSourceDigest,
  expectedFileCount,
} = {}) {
  const root = assertSourceRoot(repositoryRoot);
  const inputPaths = listRustSourceCheckoutInputs(root);
  const attributesPath = path.join(root, ".gitattributes");
  assertRegularSourceFile(attributesPath);
  const attributesBefore = readFileSync(attributesPath);
  const sourceBefore = createRustEngineSourceSnapshot(root);
  if (expectedSourceDigest && sourceBefore.digest !== assertSha256(expectedSourceDigest, "Expected source digest")) {
    throw new Error(`Source digest differs from expected digest: ${sourceBefore.digest}`);
  }
  if (expectedFileCount !== undefined && (!Number.isSafeInteger(expectedFileCount) || expectedFileCount < 1 || sourceBefore.fileCount !== expectedFileCount)) {
    throw new Error(`Source file count differs from expected positive count: ${sourceBefore.fileCount}`);
  }
  if (inputPaths.length !== sourceBefore.fileCount) throw new Error("Input enumeration differs from shared source snapshot semantics.");
  const output = prepareOutputDirectory(outputDirectory, root);
  const reportPath = path.join(output, "report.json");
  const staging = path.join(output, "source-repository");
  const checkout = path.join(output, "clean-checkout");
  const emptyConfig = path.join(output, "empty-git-config");
  const emptyTemplate = path.join(output, "empty-git-template");
  const report = {
    schema: 1,
    status: "running",
    createdAt: new Date().toISOString(),
    repositoryRoot: root,
    outputDirectory: output,
    sourceBefore,
    expectedSourceDigest: expectedSourceDigest ?? null,
    expectedFileCount: expectedFileCount ?? null,
    attributesSha256: sha256(attributesBefore),
    gitIsolation: { coreAutocrlf: true, coreEol: "crlf", inheritedGitEnvironment: false, globalAndSystemConfig: false, systemAttributes: false, templateAndHooks: "owned-empty-directory" },
    files: [],
  };
  let failure;
  try {
    mkdirSync(staging);
    mkdirSync(emptyTemplate);
    writeFileSync(emptyConfig, "", { flag: "wx" });
    for (const relative of [...inputPaths, ".gitattributes"].sort(comparePaths)) {
      const original = path.join(root, ...relative.split("/"));
      assertRegularSourceFile(original);
      const bytes = readFileSync(original);
      const destination = path.join(staging, ...relative.split("/"));
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: "wx" });
      report.files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
    }
    report.copiedSource = createRustEngineSourceSnapshot(staging);
    if (!snapshotsMatch(sourceBefore, report.copiedSource)
        || sha256(readFileSync(path.join(staging, ".gitattributes"))) !== report.attributesSha256) {
      throw new Error("Source changed during copy or input enumeration differs from shared snapshot semantics.");
    }
    const environment = createIsolatedGitEnvironment(emptyConfig);
    const config = [
      "-c", "core.autocrlf=true", "-c", "core.eol=crlf", "-c", "core.safecrlf=false",
      "-c", `core.attributesFile=${emptyConfig}`, "-c", `core.hooksPath=${emptyTemplate}`,
      "-c", `init.templateDir=${emptyTemplate}`, "-c", "commit.gpgSign=false",
    ];
    const runGit = (cwd, args) => {
      assertNoLinks(cwd);
      if (!isWithin(output, realpathSync(cwd))) throw new Error(`Git working directory escapes owned output: ${cwd}`);
      const result = spawnSync("git", ["-C", cwd, ...config, ...args], {
        env: environment, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
      });
      if (result.error || result.status !== 0) throw new Error(`Isolated Git ${args[0]} failed: ${result.error?.message ?? result.stderr?.trim() ?? result.status}`);
      return result.stdout;
    };
    runGit(staging, ["init", "--initial-branch=source-snapshot", `--template=${emptyTemplate}`]);
    runGit(staging, ["add", "--all", "--force", "--", "."]);
    runGit(staging, ["commit", "--no-gpg-sign", "-m", "Capture source bytes"]);
    report.isolatedCommit = runGit(staging, ["rev-parse", "HEAD"]).trim();
    // --no-local uses Git's transport/object-copy path, avoiding hardlinks and
    // ensuring this is a new checkout rather than copying a populated tree.
    runGit(staging, ["clone", "--no-local", "--no-hardlinks", `--template=${emptyTemplate}`, "--", staging, checkout]);
    report.checkoutSource = createRustEngineSourceSnapshot(checkout);
    report.checkoutStatus = runGit(checkout, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const tracked = runGit(checkout, ["ls-files", "-z"]).split("\0").filter(Boolean).sort(comparePaths);
    if (JSON.stringify(tracked) !== JSON.stringify(report.files.map((file) => file.path))) throw new Error("Clean checkout tracked file set differs from the exact source inputs plus .gitattributes.");
    report.byteDifferences = [];
    for (const file of report.files) {
      const checkedOut = path.join(checkout, ...file.path.split("/"));
      assertRegularSourceFile(checkedOut);
      const bytes = readFileSync(checkedOut);
      const checkoutSha256 = sha256(bytes);
      if (file.path !== ".gitattributes" && (bytes.length !== file.bytes || checkoutSha256 !== file.sha256)) {
        report.byteDifferences.push({ path: file.path, sourceBytes: file.bytes, checkoutBytes: bytes.length, sourceSha256: file.sha256, checkoutSha256 });
      }
    }
    // The root attributes file is included for Git behavior, not in the engine
    // digest; its own permitted checkout newline conversion is not source drift.
    if (!snapshotsMatch(sourceBefore, report.checkoutSource) || report.byteDifferences.length > 0) {
      throw new Error(`Clean checkout changed raw source bytes (${report.byteDifferences.length} files).`);
    }
    if (report.checkoutStatus !== "") throw new Error("Clean checkout contains dirty or untracked files.");
  } catch (error) {
    failure = error;
  } finally {
    try {
      report.sourceAfter = createRustEngineSourceSnapshot(root);
      report.attributesUnchanged = sha256(readFileSync(attributesPath)) === report.attributesSha256;
      if (!snapshotsMatch(sourceBefore, report.sourceAfter) || !report.attributesUnchanged) {
        failure = new Error("Real source inputs or .gitattributes changed during verification.");
      }
    } catch (error) {
      failure = error;
    }
    report.status = failure ? "failed" : "passed";
    if (failure) report.error = failure.message;
    report.finishedAt = new Date().toISOString();
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  }
  if (failure) throw new Error(`${failure.message} Retained report: ${reportPath}`, { cause: failure });
  return { ...report, reportPath };
}

function main(argv) {
  const options = {};
  const keys = { "--output": "outputDirectory", "--repo-root": "repositoryRoot", "--expected-source-digest": "expectedSourceDigest", "--expected-file-count": "expectedFileCount" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log("Usage: node scripts/verify-rust-source-checkout.mjs --output work/<fresh-name> [--repo-root <source>] [--expected-source-digest <sha256>] [--expected-file-count <count>]");
      return;
    }
    const key = keys[argument];
    const value = argv[++index];
    if (!key || value === undefined || value.startsWith("--") || Object.hasOwn(options, key)) throw new Error(`Invalid or duplicate option: ${argument}`);
    options[key] = key === "expectedFileCount" ? Number(value) : value;
  }
  const report = verifyRustSourceCheckout(options);
  console.log(JSON.stringify({ status: report.status, sourceSnapshot: report.checkoutSource, reportPath: report.reportPath }, null, 2));
}

if (isDirectInvocation(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
