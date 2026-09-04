import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { brotliCompressSync, gzipSync } from "node:zlib";
import {
  RUST_ENGINE_ARTIFACT_SCHEMA,
  RUST_ENGINE_INDEX_SCHEMA,
  RUST_ENGINE_TARGET,
  RustEngineToolError,
  assertContainedPath,
  assertRegularFile,
  assertSha256,
  assertVersion,
  cargoLockPackageVersion,
  contentAddressForFiles,
  createRustEngineSourceSnapshot,
  describeArtifactFiles,
  discoverEngineWorkspace,
  findRepositoryRoot,
  isDirectInvocation,
  parseCommandLine,
  parseToolVersion,
  readPinnedRustToolchain,
  resolveWasmTargetName,
  runChecked,
  safeExistingRealPath,
  selectWasmPackage,
  validatePublishedArtifacts,
} from "./rust-engine-common.mjs";

const OPTIONS = {
  "repo-root": { type: "string", default: null },
  workspace: { type: "string", default: null },
  package: { type: "string", default: null },
  variant: { type: "string", default: "compatibility" },
  profile: { type: "string", default: "release" },
  features: { type: "string", default: "" },
  cargo: { type: "string", default: process.env.BLOCKWILD_CARGO ?? "cargo" },
  rustc: { type: "string", default: process.env.BLOCKWILD_RUSTC ?? "rustc" },
  rustup: { type: "string", default: process.env.BLOCKWILD_RUSTUP ?? "rustup" },
  "wasm-bindgen": { type: "string", default: process.env.BLOCKWILD_WASM_BINDGEN ?? "wasm-bindgen" },
  "wasm-opt": { type: "string", default: process.env.BLOCKWILD_WASM_OPT ?? null },
  "public-dir": { type: "string", default: "public/engine" },
  "expected-source-digest": { type: "string", default: null },
  "expected-artifact-hash": { type: "string", default: null },
};

function safeRemoveTree(parentDirectory, targetDirectory) {
  const parent = path.resolve(parentDirectory);
  const target = assertContainedPath(parent, targetDirectory, "Build cleanup target");
  if (!existsSync(target)) return;
  const canonicalParent = safeExistingRealPath(parent);
  const canonicalTarget = safeExistingRealPath(target);
  assertContainedPath(canonicalParent, canonicalTarget, "Canonical build cleanup target");
  rmSync(target, { recursive: true, force: true });
}

function ensurePinnedToolchain({ repositoryRoot, workspaceRoot, cargo, rustc, rustup }) {
  const toolchain = readPinnedRustToolchain(repositoryRoot, workspaceRoot);
  const rustcVersion = parseToolVersion(runChecked(rustc, ["--version"], { cwd: workspaceRoot }).stdout, "rustc");
  assertVersion("rustc", rustcVersion, toolchain.channel);
  const cargoVersion = parseToolVersion(runChecked(cargo, ["--version"], { cwd: workspaceRoot }).stdout, "cargo");
  const installedTargets = runChecked(rustup, ["target", "list", "--installed"], { cwd: workspaceRoot }).stdout.split(/\r?\n/);
  if (!installedTargets.includes(RUST_ENGINE_TARGET)) {
    throw new RustEngineToolError(
      `Rust target ${RUST_ENGINE_TARGET} is not installed for ${toolchain.channel}. Install it explicitly with: rustup target add ${RUST_ENGINE_TARGET}`,
    );
  }
  return { ...toolchain, rustcVersion, cargoVersion };
}

function findWorkspaceLockfile(workspaceRoot, metadata) {
  const candidates = [
    path.join(workspaceRoot, "Cargo.lock"),
    path.join(metadata.workspace_root, "Cargo.lock"),
  ];
  const lockfile = candidates.find((candidate) => existsSync(candidate));
  if (!lockfile) throw new RustEngineToolError("Cargo.lock is required for reproducible browser builds.");
  return lockfile;
}

function compressedTotals(directory, files) {
  let rawBytes = 0;
  let gzipBytes = 0;
  let brotliBytes = 0;
  for (const file of files) {
    const contents = readFileSync(path.join(directory, ...file.path.split("/")));
    rawBytes += contents.byteLength;
    gzipBytes += gzipSync(contents, { level: 9 }).byteLength;
    brotliBytes += brotliCompressSync(contents).byteLength;
  }
  return { rawBytes, gzipBytes, brotliBytes };
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function replaceJsonAtomically(filePath, value) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}-${process.pid}-${Date.now()}.tmp`);
  try {
    writeJson(temporary, value);
    renameSync(temporary, filePath);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function preserveTimestampForUnchangedIdentity(nextValue, existingValue, field) {
  if (!existingValue || typeof existingValue !== "object" || Array.isArray(existingValue)) return nextValue;
  const nextIdentity = { ...nextValue };
  delete nextIdentity[field];
  const { [field]: existingTimestamp, ...existingIdentity } = existingValue;
  if (typeof existingTimestamp !== "string" || !isDeepStrictEqual(existingIdentity, nextIdentity)) return nextValue;
  return { ...nextValue, [field]: existingTimestamp };
}

/** Keep an immutable artifact's publication time stable across exact rebuilds. */
export function stabilizeArtifactManifestTimestamp(nextManifest, existingManifest = null) {
  return preserveTimestampForUnchangedIdentity(nextManifest, existingManifest, "createdAt");
}

/** Keep the selector's publication time stable while its complete identity is unchanged. */
export function stabilizeArtifactIndexTimestamp(nextIndex, existingIndex = null) {
  return preserveTimestampForUnchangedIdentity(nextIndex, existingIndex, "generatedAt");
}

function artifactFileMap(files, label) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new RustEngineToolError(`${label} must contain at least one file.`);
  }
  const result = new Map();
  for (const file of files) {
    if (!file || typeof file !== "object" || typeof file.path !== "string" || result.has(file.path)) {
      throw new RustEngineToolError(`${label} contains an invalid or duplicate file path.`);
    }
    result.set(file.path, file);
  }
  return result;
}

function assertArtifactFileListsMatch(expectedFiles, actualFiles, label) {
  const expected = artifactFileMap(expectedFiles, `${label} expected file list`);
  const actual = artifactFileMap(actualFiles, `${label} actual file list`);
  if (expected.size !== actual.size) {
    throw new RustEngineToolError(`${label} file list mismatch: expected ${expected.size} files, found ${actual.size}.`);
  }
  for (const [relativePath, expectedFile] of expected) {
    const actualFile = actual.get(relativePath);
    if (!actualFile) throw new RustEngineToolError(`${label} is missing ${relativePath}.`);
    for (const field of ["sha256", "bytes", "role", "mimeType"]) {
      if (actualFile[field] !== expectedFile[field]) {
        throw new RustEngineToolError(`${label} ${field} mismatch for ${relativePath}.`);
      }
    }
  }
}

export function validateExistingArtifactDestination(destination, { artifactHash, files }) {
  assertSha256(artifactHash, "Existing Rust engine artifact hash");
  const manifestPath = path.join(destination, "manifest.json");
  const manifestFile = assertRegularFile(manifestPath, "Existing Rust engine artifact manifest");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch (error) {
    throw new RustEngineToolError(`Existing Rust engine artifact manifest is invalid JSON: ${error.message}`);
  }
  if (manifest.schema !== RUST_ENGINE_ARTIFACT_SCHEMA || manifest.artifactHash !== artifactHash) {
    throw new RustEngineToolError(`Existing content-addressed artifact ${destination} does not match ${artifactHash}.`);
  }
  const actualFiles = describeArtifactFiles(destination);
  assertArtifactFileListsMatch(files, actualFiles, "Existing Rust engine artifact bytes");
  assertArtifactFileListsMatch(manifest.files, actualFiles, "Existing Rust engine artifact manifest");
  const actualHash = contentAddressForFiles(actualFiles);
  if (actualHash !== artifactHash) {
    throw new RustEngineToolError(`Existing Rust engine artifact content address mismatch: expected ${artifactHash}, found ${actualHash}.`);
  }
  return { manifest, files: actualFiles };
}

function publishIndex(publicEngineDirectory, index) {
  const target = path.join(publicEngineDirectory, "manifest.json");
  const temporary = path.join(publicEngineDirectory, `.manifest-${process.pid}-${Date.now()}.tmp`);
  writeJson(temporary, index);
  renameSync(temporary, target);
}

function readExistingIndex(publicEngineDirectory) {
  const manifestPath = path.join(publicEngineDirectory, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  return validatePublishedArtifacts(publicEngineDirectory, { allowBuildLock: true }).index;
}

function pruneUnreferencedArtifacts(publicEngineDirectory, index) {
  const retained = new Set(Object.values(index.artifacts).map((entry) => entry.directory));
  for (const entry of readdirSync(publicEngineDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && !retained.has(entry.name)) {
      safeRemoveTree(publicEngineDirectory, path.join(publicEngineDirectory, entry.name));
    }
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

export function acquireRustEngineBuildLock(lockPath, { isProcessAlive = processIsAlive } = {}) {
  const open = () => {
    const descriptor = openSync(lockPath, "wx");
    try {
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      return descriptor;
    } catch (error) {
      closeSync(descriptor);
      if (existsSync(lockPath)) unlinkSync(lockPath);
      throw error;
    }
  };
  try {
    return open();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let owner = null;
    try { owner = JSON.parse(readFileSync(lockPath, "utf8")); } catch { /* fail closed below */ }
    if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0 || isProcessAlive(owner.pid)) {
      throw new RustEngineToolError(`Another Rust engine build may be active (${lockPath}).`, {
        owner,
        cause: error.message,
      });
    }
    // The target is the fixed, non-recursive lock file inside public/engine;
    // the recorded process was independently verified absent before removal.
    unlinkSync(lockPath);
    return open();
  }
}

export function releaseRustEngineBuildLock(lockPath, descriptor) {
  if (descriptor !== undefined) closeSync(descriptor);
  if (existsSync(lockPath)) unlinkSync(lockPath);
}

export function assertExpectedArtifactHashBeforePublication(actualArtifactHash, expectedArtifactHash = null) {
  const actual = assertSha256(actualArtifactHash, "Generated Rust engine artifact hash");
  if (!expectedArtifactHash) return actual;
  const expected = assertSha256(expectedArtifactHash, "Expected Rust engine artifact hash");
  if (actual !== expected) {
    throw new RustEngineToolError(
      `Rust engine artifact hash mismatch before publication: expected ${expected}, found ${actual}.`,
    );
  }
  return actual;
}

export function buildRustEngine(argv = process.argv) {
  const options = parseCommandLine(argv, OPTIONS);
  if (!/^[a-z][a-z0-9-]*$/.test(options.variant)) {
    throw new RustEngineToolError(`Invalid artifact variant ${options.variant}. Use lowercase letters, digits, and hyphens.`);
  }
  const repositoryRoot = findRepositoryRoot(options["repo-root"] ?? process.cwd());
  const expectedSourceDigest = options["expected-source-digest"]
    ? assertSha256(options["expected-source-digest"], "Expected Rust engine source digest")
    : null;
  const expectedArtifactHash = options["expected-artifact-hash"]
    ? assertSha256(options["expected-artifact-hash"], "Expected Rust engine artifact hash")
    : null;
  const sourceSnapshotBeforeBuild = createRustEngineSourceSnapshot(repositoryRoot);
  if (expectedSourceDigest && sourceSnapshotBeforeBuild.digest !== expectedSourceDigest) {
    throw new RustEngineToolError(
      `Rust engine source digest mismatch before build: expected ${expectedSourceDigest}, found ${sourceSnapshotBeforeBuild.digest}.`,
    );
  }
  const { workspaceRoot, metadata } = discoverEngineWorkspace({
    repositoryRoot,
    workspace: options.workspace,
    cargo: options.cargo,
  });
  const selectedPackage = selectWasmPackage(metadata, options.package);
  const cdylibTarget = resolveWasmTargetName(selectedPackage);
  const toolchain = ensurePinnedToolchain({
    repositoryRoot,
    workspaceRoot,
    cargo: options.cargo,
    rustc: options.rustc,
    rustup: options.rustup,
  });
  const lockfile = findWorkspaceLockfile(workspaceRoot, metadata);
  const pinnedBindgenVersion = cargoLockPackageVersion(lockfile, "wasm-bindgen");
  const bindgenVersion = parseToolVersion(
    runChecked(options["wasm-bindgen"], ["--version"], { cwd: workspaceRoot }).stdout,
    "wasm-bindgen",
  );
  assertVersion("wasm-bindgen CLI", bindgenVersion, pinnedBindgenVersion);

  const publicEngineDirectory = path.resolve(repositoryRoot, options["public-dir"]);
  const publicDirectory = path.resolve(repositoryRoot, "public");
  if (publicEngineDirectory !== path.join(publicDirectory, "engine") && !publicEngineDirectory.startsWith(`${publicDirectory}${path.sep}`)) {
    throw new RustEngineToolError(`Published engine artifacts must remain inside ${publicDirectory}.`);
  }
  const lockPath = path.join(publicEngineDirectory, ".build-lock");
  let lockDescriptor;

  let buildRoot;
  let stagingRoot;
  let result;
  try {
    buildRoot = path.join(repositoryRoot, "work", "rust-engine-build");
    mkdirSync(buildRoot, { recursive: true });
    stagingRoot = assertContainedPath(buildRoot, path.join(buildRoot, `${options.variant}-${process.pid}-${Date.now()}`), "Build staging directory");
    const packageDirectory = path.join(stagingRoot, "package");
    mkdirSync(packageDirectory, { recursive: true });
    const cargoArgs = [
      "build",
      "--locked",
      "--target",
      RUST_ENGINE_TARGET,
      "--profile",
      options.profile,
      "--package",
      selectedPackage.name,
    ];
    if (options.features) cargoArgs.push("--features", options.features);
    runChecked(options.cargo, cargoArgs, { cwd: workspaceRoot, timeoutMilliseconds: 20 * 60_000 });

    const targetDirectory = path.resolve(metadata.target_directory);
    const wasmPath = assertRegularFile(
      path.join(targetDirectory, RUST_ENGINE_TARGET, options.profile, `${cdylibTarget}.wasm`),
      "Compiled Rust Wasm module",
    );
    runChecked(options["wasm-bindgen"], [
      "--target",
      "web",
      "--out-dir",
      packageDirectory,
      "--out-name",
      "engine",
      wasmPath,
    ], { cwd: workspaceRoot, timeoutMilliseconds: 5 * 60_000 });

    if (options["wasm-opt"]) {
      const wasmOutput = assertRegularFile(path.join(packageDirectory, "engine_bg.wasm"), "wasm-bindgen output");
      const optimized = path.join(packageDirectory, "engine_bg.optimized.wasm");
      runChecked(options["wasm-opt"], ["-O3", wasmOutput, "-o", optimized], {
        cwd: workspaceRoot,
        timeoutMilliseconds: 5 * 60_000,
      });
      unlinkSync(wasmOutput);
      renameSync(optimized, wasmOutput);
    }

    const sourceSnapshotAfterBuild = createRustEngineSourceSnapshot(repositoryRoot);
    if (
      sourceSnapshotAfterBuild.digest !== sourceSnapshotBeforeBuild.digest
      || sourceSnapshotAfterBuild.fileCount !== sourceSnapshotBeforeBuild.fileCount
    ) {
      throw new RustEngineToolError(
        `Rust engine source changed during the artifact build: before ${sourceSnapshotBeforeBuild.digest}/${sourceSnapshotBeforeBuild.fileCount} files, after ${sourceSnapshotAfterBuild.digest}/${sourceSnapshotAfterBuild.fileCount} files.`,
      );
    }
    const files = describeArtifactFiles(packageDirectory);
    if (files.length === 0) throw new RustEngineToolError("wasm-bindgen produced no browser artifacts.");
    const artifactHash = contentAddressForFiles(files);
    assertExpectedArtifactHashBeforePublication(artifactHash, expectedArtifactHash);
    const totals = compressedTotals(packageDirectory, files);
    let artifactManifest = {
      schema: RUST_ENGINE_ARTIFACT_SCHEMA,
      artifactHash,
      variant: options.variant,
      package: selectedPackage.name,
      packageVersion: selectedPackage.version,
      protocolVersion: 1,
      target: RUST_ENGINE_TARGET,
      cargoProfile: options.profile,
      cargoFeatures: options.features ? options.features.split(",").map((entry) => entry.trim()).filter(Boolean).sort() : [],
      rustToolchain: toolchain.channel,
      cargoVersion: toolchain.cargoVersion,
      wasmBindgenVersion: bindgenVersion,
      wasmOpt: options["wasm-opt"] ? runChecked(options["wasm-opt"], ["--version"], { cwd: workspaceRoot }).stdout : null,
      createdAt: new Date().toISOString(),
      sourceSnapshot: sourceSnapshotBeforeBuild,
      totals,
      files,
    };
    writeJson(path.join(packageDirectory, "manifest.json"), artifactManifest);

    // Publication begins only after both the source snapshot and expected
    // artifact hash have passed. The lock therefore protects the destination
    // and index mutation without creating public state for a rejected build.
    mkdirSync(publicEngineDirectory, { recursive: true });
    try {
      lockDescriptor = acquireRustEngineBuildLock(lockPath);
    } catch (error) {
      if (error instanceof RustEngineToolError) throw error;
      throw new RustEngineToolError(`Rust engine build lock could not be acquired (${lockPath}).`, { cause: error.message });
    }
    const existingIndex = readExistingIndex(publicEngineDirectory);

    const destination = assertContainedPath(
      publicEngineDirectory,
      path.join(publicEngineDirectory, artifactHash),
      "Published artifact directory",
    );
    if (existsSync(destination)) {
      const existingArtifact = validateExistingArtifactDestination(destination, { artifactHash, files });
      artifactManifest = stabilizeArtifactManifestTimestamp(artifactManifest, existingArtifact.manifest);
      replaceJsonAtomically(path.join(destination, "manifest.json"), artifactManifest);
      safeRemoveTree(stagingRoot, packageDirectory);
    } else {
      renameSync(packageDirectory, destination);
    }

    let nextIndex = {
      schema: RUST_ENGINE_INDEX_SCHEMA,
      generatedAt: new Date().toISOString(),
      defaultVariant: existingIndex?.defaultVariant ?? options.variant,
      artifacts: {
        ...(existingIndex?.artifacts ?? {}),
        [options.variant]: {
          hash: artifactHash,
          directory: artifactHash,
          manifest: `${artifactHash}/manifest.json`,
        },
      },
    };
    if (!nextIndex.artifacts[nextIndex.defaultVariant]) nextIndex.defaultVariant = options.variant;
    nextIndex = stabilizeArtifactIndexTimestamp(nextIndex, existingIndex);
    publishIndex(publicEngineDirectory, nextIndex);
    pruneUnreferencedArtifacts(publicEngineDirectory, nextIndex);
    result = {
      schema: 1,
      repositoryRoot,
      workspaceRoot,
      package: selectedPackage.name,
      variant: options.variant,
      artifactHash,
      artifactDirectory: destination,
      indexPath: path.join(publicEngineDirectory, "manifest.json"),
      files,
      totals,
      sourceSnapshot: sourceSnapshotBeforeBuild,
      toolchain: {
        rustc: toolchain.rustcVersion,
        cargo: toolchain.cargoVersion,
        wasmBindgen: bindgenVersion,
        wasmOpt: artifactManifest.wasmOpt,
      },
    };
  } finally {
    if (lockDescriptor !== undefined) releaseRustEngineBuildLock(lockPath, lockDescriptor);
    if (stagingRoot && existsSync(stagingRoot)) safeRemoveTree(buildRoot, stagingRoot);
  }

  const verification = validatePublishedArtifacts(publicEngineDirectory);
  result.verifiedVariants = verification.artifacts.map((artifact) => artifact.variant);
  return result;
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(buildRustEngine(), null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Rust engine build failed: ${message}\n`);
    if (error instanceof RustEngineToolError && error.details) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectInvocation(import.meta.url)) main();
