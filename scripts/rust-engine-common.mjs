import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUST_ENGINE_ARTIFACT_SCHEMA = 1;
export const RUST_ENGINE_INDEX_SCHEMA = 1;
export const RUST_ENGINE_SOURCE_SNAPSHOT_SCHEMA = 1;
export const RUST_ENGINE_TARGET = "wasm32-unknown-unknown";

const RUST_ENGINE_SOURCE_SNAPSHOT_SCRIPTS = Object.freeze([
  "scripts/build-rust-engine.mjs",
  "scripts/rust-engine-common.mjs",
]);
const RUST_ENGINE_SOURCE_EXCLUDED_DIRECTORIES = new Set([
  ".sites-runtime",
  "target",
  "work",
]);

export class RustEngineToolError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "RustEngineToolError";
    this.details = details;
  }
}

export function isDirectInvocation(importMetaUrl, argv = process.argv) {
  if (!argv[1]) return false;
  return path.resolve(argv[1]) === path.resolve(fileURLToPath(importMetaUrl));
}

export function findRepositoryRoot(startDirectory = process.cwd()) {
  let current = path.resolve(startDirectory);
  for (;;) {
    if (existsSync(path.join(current, "package.json")) && existsSync(path.join(current, "docs"))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new RustEngineToolError(`Could not find the Blockwild repository root above ${startDirectory}.`);
    }
    current = parent;
  }
}

export function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    windowsHide: true,
    timeout: options.timeoutMilliseconds ?? 10 * 60_000,
    maxBuffer: options.maxBufferBytes ?? 32 * 1024 * 1024,
    shell: false,
  });
  if (result.error) {
    const suffix = result.error.code === "ENOENT" ? " The executable was not found on PATH." : "";
    throw new RustEngineToolError(`Failed to run ${command}.${suffix}`, {
      command,
      args,
      cause: result.error.message,
    });
  }
  if (result.status !== 0) {
    throw new RustEngineToolError(
      `${command} ${args.join(" ")} exited with status ${result.status}.\n${(result.stderr || result.stdout || "").trim()}`,
      { command, args, status: result.status, signal: result.signal },
    );
  }
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    status: result.status,
  };
}

export function parseCommandLine(argv, definition) {
  const values = Object.fromEntries(Object.entries(definition).map(([key, entry]) => [key, entry.default]));
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new RustEngineToolError(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const entry = definition[key];
    if (!entry) throw new RustEngineToolError(`Unknown option: ${token}`);
    if (entry.type === "boolean") {
      values[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new RustEngineToolError(`${token} requires a value.`);
    values[key] = entry.type === "integer" ? Number.parseInt(next, 10) : next;
    if (entry.type === "integer" && !Number.isFinite(values[key])) {
      throw new RustEngineToolError(`${token} requires an integer, received ${next}.`);
    }
    index += 1;
  }
  return values;
}

function parseToolchainFile(contents, source) {
  const match = contents.match(/^\s*channel\s*=\s*["']([^"']+)["']/m);
  if (!match) throw new RustEngineToolError(`${source} does not declare a Rust channel.`);
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(match[1])) {
    throw new RustEngineToolError(
      `${source} must pin an exact Rust release (for example 1.91.1); found ${match[1]}.`,
    );
  }
  return match[1];
}

export function readPinnedRustToolchain(repositoryRoot, workspaceRoot) {
  const candidates = [
    path.join(repositoryRoot, "rust-toolchain.toml"),
    path.join(workspaceRoot, "rust-toolchain.toml"),
  ];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) {
    throw new RustEngineToolError(
      "Rust is not pinned. Add rust-toolchain.toml at the repository or engine workspace root before building browser artifacts.",
    );
  }
  return { channel: parseToolchainFile(readFileSync(source, "utf8"), source), source };
}

export function discoverEngineWorkspace({ repositoryRoot, workspace, cargo = "cargo" }) {
  const candidates = workspace
    ? [path.resolve(repositoryRoot, workspace)]
    : [path.join(repositoryRoot, "engine"), repositoryRoot];
  const workspaceRoot = candidates.find((candidate) => existsSync(path.join(candidate, "Cargo.toml")));
  if (!workspaceRoot) {
    throw new RustEngineToolError(
      `No Rust workspace was found. Expected ${path.join(repositoryRoot, "engine", "Cargo.toml")} or pass --workspace.`,
    );
  }
  const metadataResult = runChecked(cargo, ["metadata", "--format-version", "1", "--locked"], {
    cwd: workspaceRoot,
  });
  let metadata;
  try {
    metadata = JSON.parse(metadataResult.stdout);
  } catch (error) {
    throw new RustEngineToolError(`cargo metadata returned invalid JSON: ${error.message}`);
  }
  return { workspaceRoot, metadata };
}

export function selectWasmPackage(metadata, requestedPackage) {
  const workspaceMemberIds = new Set(metadata.workspace_members ?? []);
  const candidates = metadata.packages.filter((pkg) => workspaceMemberIds.has(pkg.id)).filter((pkg) =>
    pkg.targets.some((target) => target.crate_types.includes("cdylib")),
  );
  if (requestedPackage) {
    const selected = candidates.find((pkg) => pkg.name === requestedPackage);
    if (!selected) {
      throw new RustEngineToolError(
        `Rust package ${requestedPackage} is not a workspace cdylib. Candidates: ${candidates.map((entry) => entry.name).join(", ") || "none"}.`,
      );
    }
    return selected;
  }
  if (candidates.length !== 1) {
    throw new RustEngineToolError(
      `Expected exactly one browser cdylib package; found ${candidates.length}: ${candidates.map((entry) => entry.name).join(", ") || "none"}. Pass --package to disambiguate.`,
    );
  }
  return candidates[0];
}

export function resolveWasmTargetName(pkg) {
  const targets = pkg.targets.filter((target) => target.crate_types.includes("cdylib"));
  if (targets.length !== 1) {
    throw new RustEngineToolError(`Package ${pkg.name} must have exactly one cdylib target; found ${targets.length}.`);
  }
  return targets[0].name.replaceAll("-", "_");
}

export function cargoLockPackageVersion(lockPath, packageName) {
  if (!existsSync(lockPath)) throw new RustEngineToolError(`Cargo lockfile missing: ${lockPath}`);
  const contents = readFileSync(lockPath, "utf8");
  const packages = contents.split(/\r?\n\[\[package\]\]\r?\n/g);
  for (const section of packages) {
    const name = section.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = section.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (name === packageName && version) return version;
  }
  throw new RustEngineToolError(`${packageName} is not pinned in ${lockPath}.`);
}

export function parseToolVersion(output, toolName) {
  const match = output.match(/\b(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\b/);
  if (!match) throw new RustEngineToolError(`Could not parse ${toolName} version from: ${output}`);
  return match[1];
}

export function assertVersion(name, actual, expected) {
  if (actual !== expected) {
    throw new RustEngineToolError(`${name} version mismatch: expected ${expected}, found ${actual}.`);
  }
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

export function assertSha256(value, label = "SHA-256 digest") {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new RustEngineToolError(`${label} must be a lowercase 64-character SHA-256 digest.`);
  }
  return value;
}

/**
 * Hashes every checked-in Rust engine input which can affect a browser artifact.
 * Cargo output and local runtime scratch roots are intentionally excluded. File
 * paths, content hashes, and byte lengths are framed so neither traversal order
 * nor ambiguous concatenation can change the identity.
 */
export function createRustEngineSourceSnapshot(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const engineRoot = path.join(root, "engine");
  if (!existsSync(engineRoot) || !lstatSync(engineRoot).isDirectory()) {
    throw new RustEngineToolError(`Rust engine source directory is missing: ${engineRoot}`);
  }

  const sourceFiles = [];
  const visitEngineDirectory = (directory, relativeDirectory = "") => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relativeWithinEngine = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (entry.isSymbolicLink()) {
        throw new RustEngineToolError(`Symlinks are not allowed in the Rust engine source snapshot: ${absolute}`);
      }
      if (entry.isDirectory()) {
        if (!relativeDirectory && RUST_ENGINE_SOURCE_EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        visitEngineDirectory(absolute, relativeWithinEngine);
      } else if (entry.isFile()) {
        sourceFiles.push({
          absolute,
          relative: `engine/${relativeWithinEngine}`,
        });
      } else {
        throw new RustEngineToolError(`Unsupported filesystem entry in the Rust engine source snapshot: ${absolute}`);
      }
    }
  };
  visitEngineDirectory(engineRoot);

  for (const relative of RUST_ENGINE_SOURCE_SNAPSHOT_SCRIPTS) {
    const absolute = path.join(root, ...relative.split("/"));
    if (!existsSync(absolute)) {
      throw new RustEngineToolError(`Rust engine artifact build input is missing: ${absolute}`);
    }
    const entry = lstatSync(absolute);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new RustEngineToolError(`Rust engine artifact build input must be a regular non-symlink file: ${absolute}`);
    }
    sourceFiles.push({ absolute, relative });
  }

  sourceFiles.sort((left, right) => left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0);
  const hash = createHash("sha256");
  hash.update(`blockwild-rust-engine-source-v${RUST_ENGINE_SOURCE_SNAPSHOT_SCHEMA}\n`, "utf8");
  for (const file of sourceFiles) {
    const contents = readFileSync(file.absolute);
    hash.update(file.relative, "utf8");
    hash.update("\0", "utf8");
    hash.update(sha256(contents), "ascii");
    hash.update("\0", "utf8");
    hash.update(String(contents.byteLength), "ascii");
    hash.update("\n", "utf8");
  }
  return Object.freeze({
    schema: RUST_ENGINE_SOURCE_SNAPSHOT_SCHEMA,
    digest: hash.digest("hex"),
    fileCount: sourceFiles.length,
  });
}

export function listFilesRecursively(rootDirectory) {
  if (!existsSync(rootDirectory)) return [];
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new RustEngineToolError(`Symlinks are not allowed in engine artifacts: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(path.relative(rootDirectory, absolute).replaceAll(path.sep, "/"));
    }
  };
  visit(rootDirectory);
  return result.sort((left, right) => left.localeCompare(right, "en"));
}

export function artifactRole(relativePath) {
  if (relativePath.endsWith(".wasm")) return "wasm";
  if (relativePath.endsWith(".wasm.d.ts")) return "wasm-types";
  if (relativePath.endsWith(".d.ts")) return "glue-types";
  if (relativePath.endsWith(".js") || relativePath.endsWith(".mjs")) return "glue";
  if (relativePath.endsWith(".json")) return "metadata";
  return "support";
}

export function artifactMimeType(relativePath) {
  if (relativePath.endsWith(".wasm")) return "application/wasm";
  if (relativePath.endsWith(".js") || relativePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (relativePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export function describeArtifactFiles(directory, options = {}) {
  const excluded = new Set(options.exclude ?? ["manifest.json"]);
  return listFilesRecursively(directory).filter((relativePath) => !excluded.has(relativePath)).map((relativePath) => {
    const absolute = path.join(directory, ...relativePath.split("/"));
    const bytes = statSync(absolute).size;
    return {
      path: relativePath,
      role: artifactRole(relativePath),
      mimeType: artifactMimeType(relativePath),
      bytes,
      sha256: sha256File(absolute),
    };
  });
}

export function contentAddressForFiles(files) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path, "en"))) {
    hash.update(file.path, "utf8");
    hash.update("\0", "utf8");
    hash.update(file.sha256, "ascii");
    hash.update("\0", "utf8");
    hash.update(String(file.bytes), "ascii");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

export function assertContainedPath(parentDirectory, candidatePath, label = "path") {
  const parent = path.resolve(parentDirectory);
  const candidate = path.resolve(candidatePath);
  if (candidate === parent || !candidate.startsWith(`${parent}${path.sep}`)) {
    throw new RustEngineToolError(`${label} must be strictly inside ${parent}; received ${candidate}.`);
  }
  return candidate;
}

function parseJsonFile(filePath, label) {
  if (!existsSync(filePath)) throw new RustEngineToolError(`${label} is missing: ${filePath}`);
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new RustEngineToolError(`${label} is invalid JSON (${filePath}): ${error.message}`);
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RustEngineToolError(`${label} must be an object.`);
  }
}

export function validatePublishedArtifacts(publicEngineDirectory, options = {}) {
  const root = path.resolve(publicEngineDirectory);
  const indexPath = path.join(root, "manifest.json");
  const index = parseJsonFile(indexPath, "Rust engine artifact index");
  if (index.schema !== RUST_ENGINE_INDEX_SCHEMA) {
    throw new RustEngineToolError(`Unsupported Rust engine artifact index schema ${index.schema}.`);
  }
  assertPlainObject(index.artifacts, "Rust engine artifact index artifacts");
  const entries = Object.entries(index.artifacts);
  if (entries.length === 0) throw new RustEngineToolError("Rust engine artifact index contains no variants.");

  const expectedDirectories = new Set();
  const reports = [];
  for (const [variant, entry] of entries) {
    assertPlainObject(entry, `Artifact entry ${variant}`);
    if (!/^[a-f0-9]{64}$/.test(entry.hash)) throw new RustEngineToolError(`Artifact ${variant} has invalid SHA-256 hash ${entry.hash}.`);
    if (entry.directory !== entry.hash) throw new RustEngineToolError(`Artifact ${variant} directory must equal its content hash.`);
    if (entry.manifest !== `${entry.hash}/manifest.json`) {
      throw new RustEngineToolError(`Artifact ${variant} manifest path is not canonical.`);
    }
    expectedDirectories.add(entry.hash);
    const directory = assertContainedPath(root, path.join(root, entry.hash), `Artifact ${variant} directory`);
    const manifestPath = path.join(directory, "manifest.json");
    const manifest = parseJsonFile(manifestPath, `Artifact ${variant} manifest`);
    if (manifest.schema !== RUST_ENGINE_ARTIFACT_SCHEMA) throw new RustEngineToolError(`Artifact ${variant} has unsupported manifest schema ${manifest.schema}.`);
    if (manifest.variant !== variant) throw new RustEngineToolError(`Artifact variant mismatch: index=${variant}, manifest=${manifest.variant}.`);
    if (manifest.artifactHash !== entry.hash) throw new RustEngineToolError(`Artifact ${variant} hash differs between index and manifest.`);
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new RustEngineToolError(`Artifact ${variant} manifest has no files.`);

    const actualFiles = describeArtifactFiles(directory);
    const actualPaths = new Set(actualFiles.map((file) => file.path));
    const manifestPaths = new Set(manifest.files.map((file) => file.path));
    for (const relativePath of actualPaths) {
      if (!manifestPaths.has(relativePath)) throw new RustEngineToolError(`Artifact ${variant} contains stale unmanifested file ${relativePath}.`);
    }
    for (const relativePath of manifestPaths) {
      if (!actualPaths.has(relativePath)) throw new RustEngineToolError(`Artifact ${variant} is missing manifest file ${relativePath}.`);
    }
    for (const declared of manifest.files) {
      const actual = actualFiles.find((file) => file.path === declared.path);
      if (actual.sha256 !== declared.sha256 || actual.bytes !== declared.bytes) {
        throw new RustEngineToolError(`Artifact ${variant} checksum or size mismatch for ${declared.path}.`);
      }
      if (actual.mimeType !== declared.mimeType || actual.role !== declared.role) {
        throw new RustEngineToolError(`Artifact ${variant} metadata mismatch for ${declared.path}.`);
      }
    }
    const recomputedHash = contentAddressForFiles(actualFiles);
    if (recomputedHash !== entry.hash) throw new RustEngineToolError(`Artifact ${variant} content address mismatch: expected ${entry.hash}, got ${recomputedHash}.`);
    if (!actualFiles.some((file) => file.role === "wasm")) throw new RustEngineToolError(`Artifact ${variant} has no Wasm binary.`);
    if (!actualFiles.some((file) => file.role === "glue")) throw new RustEngineToolError(`Artifact ${variant} has no JavaScript glue.`);
    reports.push({ variant, hash: entry.hash, directory, manifest, files: actualFiles });
  }

  const rootEntries = readdirSync(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.name === "manifest.json") continue;
    if (entry.isDirectory() && expectedDirectories.has(entry.name)) continue;
    if (options.allowBuildLock && entry.name === ".build-lock" && entry.isFile()) continue;
    if (entry.isDirectory()) throw new RustEngineToolError(`Stale unreferenced Rust engine artifact directory: ${entry.name}`);
    throw new RustEngineToolError(`Unexpected file in Rust engine artifact root: ${entry.name}`);
  }

  return { root, index, artifacts: reports };
}

export function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) throw new RustEngineToolError("Cannot calculate a percentile from an empty sample set.");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

export function summarizeSamples(values) {
  if (!Array.isArray(values) || values.length === 0) throw new RustEngineToolError("Benchmark sample set is empty.");
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    averageMilliseconds: sum / values.length,
    p50Milliseconds: percentile(values, 0.5),
    p95Milliseconds: percentile(values, 0.95),
    p99Milliseconds: percentile(values, 0.99),
    minimumMilliseconds: Math.min(...values),
    maximumMilliseconds: Math.max(...values),
  };
}

export function safeExistingRealPath(candidatePath) {
  return existsSync(candidatePath) ? realpathSync(candidatePath) : path.resolve(candidatePath);
}

export function assertRegularFile(filePath, label) {
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) throw new RustEngineToolError(`${label} is not a regular file: ${filePath}`);
  return filePath;
}
