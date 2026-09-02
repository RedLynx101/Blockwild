import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, realpathSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  createRustEngineSourceSnapshot,
  sha256File,
  validatePublishedArtifacts,
} from "../../scripts/rust-engine-common.mjs";

export const NEAR_LIMIT_ENGINE_DIRECTORY_ENV = "BLOCKWILD_NEAR_LIMIT_ENGINE_DIR";
export const NEAR_LIMIT_EXPECTED_ARTIFACT_HASH_ENV = "BLOCKWILD_NEAR_LIMIT_EXPECTED_ARTIFACT_HASH";
export const REQUIRED_NEAR_LIMIT_ARTIFACT_HASH = "78b5e0e43ad3d0bd66f01d9f61b20e350fa341fcbd73e05376179812ed63b63d";

const CANDIDATE_RELATIVE_PATH = "public/engine-locator-candidate";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function fail(message) {
  throw new Error(message);
}

function comparablePath(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function pathIsInside(parentDirectory, candidatePath) {
  const relation = path.relative(parentDirectory, candidatePath);
  return relation.length > 0
    && relation !== ".."
    && !relation.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relation);
}

function canonicalIsoTimestamp(value) {
  return typeof value === "string"
    && ISO_TIMESTAMP_PATTERN.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function assertNonSymlinkTree(rootDirectory, label) {
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) fail(`${label} must not contain symlinks: ${absolute}`);
      if (metadata.isDirectory()) visit(absolute);
      else if (!metadata.isFile()) fail(`${label} contains an unsupported filesystem entry: ${absolute}`);
    }
  };
  const rootMetadata = lstatSync(rootDirectory);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    fail(`${label} must be a non-symlink directory: ${rootDirectory}`);
  }
  visit(rootDirectory);
}

function immutableTreeSnapshot(rootDirectory) {
  const files = [];
  const directories = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) fail(`selected engine tree changed to include a symlink: ${absolute}`);
      if (metadata.isDirectory()) {
        directories.push(relative);
        visit(absolute, relative);
      }
      else if (metadata.isFile()) files.push({ absolute, relative, bytes: metadata.size });
      else fail(`selected engine tree changed to include an unsupported entry: ${absolute}`);
    }
  };
  visit(rootDirectory);
  const digest = createHash("sha256");
  digest.update("blockwild-near-limit-selected-engine-v1\n", "utf8");
  for (const directory of directories.sort((left, right) => left.localeCompare(right, "en"))) {
    digest.update("directory\0", "utf8");
    digest.update(directory, "utf8");
    digest.update("\n", "utf8");
  }
  for (const file of files) {
    digest.update("file\0", "utf8");
    digest.update(file.relative, "utf8");
    digest.update("\0", "utf8");
    digest.update(sha256File(file.absolute), "ascii");
    digest.update("\0", "utf8");
    digest.update(String(file.bytes), "ascii");
    digest.update("\n", "utf8");
  }
  return Object.freeze({
    digest: digest.digest("hex"),
    fileCount: files.length,
    directoryCount: directories.length,
  });
}

function validatedSourceSnapshot(manifest, currentSourceSnapshot) {
  const source = manifest?.sourceSnapshot;
  if (source?.schema !== 1
    || !SHA256_PATTERN.test(source.digest ?? "")
    || !Number.isSafeInteger(source.fileCount)
    || source.fileCount <= 0) {
    fail("selected near-limit artifact has incomplete sourceSnapshot provenance");
  }
  if (source.digest !== currentSourceSnapshot.digest || source.fileCount !== currentSourceSnapshot.fileCount) {
    fail(
      `selected near-limit artifact is not current-source: artifact ${source.digest}/${source.fileCount}, current ${currentSourceSnapshot.digest}/${currentSourceSnapshot.fileCount}`,
    );
  }
  return Object.freeze({ schema: 1, digest: source.digest, fileCount: source.fileCount });
}

function validatedArtifactProvenance(artifact, currentSourceSnapshot, expectedArtifactHash) {
  const manifest = artifact.manifest;
  if (manifest.schema !== 1
    || manifest.artifactHash !== expectedArtifactHash
    || manifest.variant !== "compatibility"
    || manifest.package !== "blockwild-wasm"
    || manifest.protocolVersion !== 1
    || manifest.target !== "wasm32-unknown-unknown"
    || manifest.cargoProfile !== "release"
    || !Array.isArray(manifest.cargoFeatures)
    || manifest.cargoFeatures.length !== 0
    || typeof manifest.packageVersion !== "string"
    || manifest.packageVersion.length === 0
    || typeof manifest.rustToolchain !== "string"
    || manifest.rustToolchain.length === 0
    || typeof manifest.cargoVersion !== "string"
    || manifest.cargoVersion.length === 0
    || typeof manifest.wasmBindgenVersion !== "string"
    || manifest.wasmBindgenVersion.length === 0
    || !canonicalIsoTimestamp(manifest.createdAt)) {
    fail("selected near-limit artifact has incomplete build provenance");
  }
  const rawBytes = artifact.files.reduce((total, file) => total + file.bytes, 0);
  if (!Number.isSafeInteger(manifest.totals?.rawBytes)
    || manifest.totals.rawBytes !== rawBytes
    || !Number.isSafeInteger(manifest.totals.gzipBytes)
    || manifest.totals.gzipBytes <= 0
    || manifest.totals.gzipBytes > rawBytes
    || !Number.isSafeInteger(manifest.totals.brotliBytes)
    || manifest.totals.brotliBytes <= 0
    || manifest.totals.brotliBytes > rawBytes) {
    fail("selected near-limit artifact has invalid size provenance");
  }
  return Object.freeze({
    sourceSnapshot: validatedSourceSnapshot(manifest, currentSourceSnapshot),
    createdAt: manifest.createdAt,
    package: manifest.package,
    packageVersion: manifest.packageVersion,
    protocolVersion: manifest.protocolVersion,
    target: manifest.target,
    cargoProfile: manifest.cargoProfile,
    cargoFeatures: Object.freeze([...manifest.cargoFeatures]),
    rustToolchain: manifest.rustToolchain,
    cargoVersion: manifest.cargoVersion,
    wasmBindgenVersion: manifest.wasmBindgenVersion,
    wasmOpt: manifest.wasmOpt ?? null,
    fileCount: artifact.files.length,
    rawBytes,
    gzipBytes: manifest.totals.gzipBytes,
    brotliBytes: manifest.totals.brotliBytes,
  });
}

function routeRecord(filePath, contentType, immutable) {
  const canonicalFile = realpathSync(filePath);
  const metadata = lstatSync(canonicalFile);
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail(`selected engine route is not a regular file: ${filePath}`);
  return Object.freeze({
    filePath: canonicalFile,
    contentType,
    bytes: metadata.size,
    sha256: sha256File(canonicalFile),
    immutable,
  });
}

function selectedRoutes(directory, artifact) {
  const routes = new Map();
  routes.set("/engine/manifest.json", routeRecord(
    path.join(directory, "manifest.json"),
    "application/json; charset=utf-8",
    false,
  ));
  routes.set(`/engine/${artifact.hash}/manifest.json`, routeRecord(
    path.join(artifact.directory, "manifest.json"),
    "application/json; charset=utf-8",
    true,
  ));
  for (const file of artifact.files) {
    routes.set(`/engine/${artifact.hash}/${file.path}`, routeRecord(
      path.join(artifact.directory, ...file.path.split("/")),
      file.mimeType,
      true,
    ));
  }
  return routes;
}

export function selectNearLimitRustEngineArtifact(repositoryRoot, environment = process.env) {
  const requestedDirectory = environment[NEAR_LIMIT_ENGINE_DIRECTORY_ENV];
  const requestedHash = environment[NEAR_LIMIT_EXPECTED_ARTIFACT_HASH_ENV];
  if (typeof requestedDirectory !== "string" || requestedDirectory.trim() === "") {
    fail(`${NEAR_LIMIT_ENGINE_DIRECTORY_ENV} is required and must explicitly select ${CANDIDATE_RELATIVE_PATH}`);
  }
  if (requestedHash !== REQUIRED_NEAR_LIMIT_ARTIFACT_HASH) {
    fail(`${NEAR_LIMIT_EXPECTED_ARTIFACT_HASH_ENV} must explicitly equal ${REQUIRED_NEAR_LIMIT_ARTIFACT_HASH}`);
  }

  return selectNearLimitRustEngineCandidate(repositoryRoot, requestedDirectory, requestedHash);
}

/** Explicit-hash selection is reusable; the browser environment wrapper keeps its historical pin. */
export function selectNearLimitRustEngineCandidate(repositoryRoot, requestedDirectory, requestedHash) {
  if (typeof requestedDirectory !== "string" || requestedDirectory.trim() === "") {
    fail(`${NEAR_LIMIT_ENGINE_DIRECTORY_ENV} is required and must explicitly select ${CANDIDATE_RELATIVE_PATH}`);
  }
  if (typeof requestedHash !== "string" || !SHA256_PATTERN.test(requestedHash)) {
    fail("near-limit candidate selection requires an explicit lowercase SHA-256 artifact hash");
  }

  const lexicalRepositoryRoot = path.resolve(repositoryRoot);
  if (!existsSync(lexicalRepositoryRoot)) fail(`repository root does not exist: ${lexicalRepositoryRoot}`);
  const canonicalRepositoryRoot = realpathSync(lexicalRepositoryRoot);
  const publicRoot = path.join(lexicalRepositoryRoot, "public");
  const publicMetadata = lstatSync(publicRoot);
  if (publicMetadata.isSymbolicLink() || !publicMetadata.isDirectory()) {
    fail(`repository public root must be a non-symlink directory: ${publicRoot}`);
  }
  const canonicalPublicRoot = realpathSync(publicRoot);
  if (!pathIsInside(canonicalRepositoryRoot, canonicalPublicRoot)) {
    fail(`repository public root resolves outside the canonical repository: ${canonicalPublicRoot}`);
  }

  const expectedDirectory = path.join(lexicalRepositoryRoot, ...CANDIDATE_RELATIVE_PATH.split("/"));
  const selectedDirectory = path.resolve(lexicalRepositoryRoot, requestedDirectory);
  if (comparablePath(selectedDirectory) !== comparablePath(expectedDirectory)) {
    fail(`${NEAR_LIMIT_ENGINE_DIRECTORY_ENV} must resolve exactly to ${CANDIDATE_RELATIVE_PATH}`);
  }
  if (!existsSync(selectedDirectory)) fail(`selected near-limit engine directory is missing: ${selectedDirectory}`);
  assertNonSymlinkTree(selectedDirectory, "selected near-limit engine artifact tree");
  const canonicalSelectedDirectory = realpathSync(selectedDirectory);
  const expectedCanonicalDirectory = path.join(canonicalPublicRoot, "engine-locator-candidate");
  if (comparablePath(canonicalSelectedDirectory) !== comparablePath(expectedCanonicalDirectory)
    || !pathIsInside(canonicalPublicRoot, canonicalSelectedDirectory)) {
    fail(`selected near-limit engine directory is not canonically contained at ${CANDIDATE_RELATIVE_PATH}`);
  }

  const verification = validatePublishedArtifacts(canonicalSelectedDirectory);
  if (verification.index.defaultVariant !== "compatibility"
    || Object.keys(verification.index.artifacts).length !== 1
    || !canonicalIsoTimestamp(verification.index.generatedAt)) {
    fail("selected near-limit engine index is not an isolated compatibility artifact index");
  }
  const artifact = verification.artifacts.find((entry) => entry.variant === "compatibility");
  if (!artifact || artifact.hash !== requestedHash) {
    fail(`selected near-limit compatibility artifact does not equal required hash ${requestedHash}`);
  }
  if (!pathIsInside(canonicalSelectedDirectory, artifact.directory)) {
    fail("selected near-limit compatibility artifact is not canonically contained by its index root");
  }

  const currentSourceSnapshot = createRustEngineSourceSnapshot(canonicalRepositoryRoot);
  const provenance = validatedArtifactProvenance(artifact, currentSourceSnapshot, requestedHash);
  const routes = selectedRoutes(canonicalSelectedDirectory, artifact);
  const treeSnapshot = immutableTreeSnapshot(canonicalSelectedDirectory);
  return Object.freeze({
    repositoryRoot: canonicalRepositoryRoot,
    relativeDirectory: CANDIDATE_RELATIVE_PATH,
    directory: canonicalSelectedDirectory,
    artifactDirectory: artifact.directory,
    variant: artifact.variant,
    hash: artifact.hash,
    provenance,
    sourceSnapshot: currentSourceSnapshot,
    treeSnapshot,
    routes,
  });
}

export function assertNearLimitSelectionUnchanged(selection) {
  assertNonSymlinkTree(selection.directory, "selected near-limit engine artifact tree");
  const treeSnapshot = immutableTreeSnapshot(selection.directory);
  if (treeSnapshot.digest !== selection.treeSnapshot.digest
    || treeSnapshot.fileCount !== selection.treeSnapshot.fileCount
    || treeSnapshot.directoryCount !== selection.treeSnapshot.directoryCount) {
    fail("selected near-limit engine artifact tree changed during browser acceptance");
  }
  const sourceSnapshot = createRustEngineSourceSnapshot(selection.repositoryRoot);
  if (sourceSnapshot.digest !== selection.sourceSnapshot.digest
    || sourceSnapshot.fileCount !== selection.sourceSnapshot.fileCount) {
    fail("Rust engine source changed during browser acceptance");
  }
  return Object.freeze({ treeSnapshot, sourceSnapshot });
}

function engineRequestPathname(requestUrl) {
  if (typeof requestUrl !== "string" || !requestUrl.startsWith("/") || requestUrl.includes("\\") || requestUrl.includes("%")) {
    return null;
  }
  const pathname = requestUrl.split(/[?#]/u, 1)[0];
  if (pathname.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return pathname;
}

export function selectedNearLimitEngineRoute(selection, requestUrl) {
  const pathname = engineRequestPathname(requestUrl);
  if (pathname === null) return null;
  return selection.routes.get(pathname) ?? null;
}

export function createNearLimitEngineRoutePlugin(selection, onRequest = () => undefined) {
  return {
    name: "blockwild-near-limit-selected-engine",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const rawUrl = request.url ?? "/";
        if (!rawUrl.startsWith("/engine/")) {
          next();
          return;
        }
        const pathname = engineRequestPathname(rawUrl);
        if (pathname === null) {
          response.statusCode = 400;
          response.setHeader("Cache-Control", "no-store");
          response.end();
          onRequest(Object.freeze({ method: request.method ?? "GET", pathname: null, status: 400, bytes: 0, sha256: null }));
          return;
        }
        const method = request.method ?? "GET";
        const route = selection.routes.get(pathname);
        if (!route || (method !== "GET" && method !== "HEAD")) {
          response.statusCode = 404;
          response.setHeader("Cache-Control", "no-store");
          response.end();
          onRequest(Object.freeze({ method, pathname, status: 404, bytes: 0, sha256: null }));
          return;
        }
        const metadata = lstatSync(route.filePath);
        if (metadata.isSymbolicLink()
          || !metadata.isFile()
          || metadata.size !== route.bytes
          || sha256File(route.filePath) !== route.sha256) {
          response.statusCode = 500;
          response.setHeader("Cache-Control", "no-store");
          response.end();
          onRequest(Object.freeze({ method, pathname, status: 500, bytes: 0, sha256: null }));
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", route.contentType);
        response.setHeader("Content-Length", String(route.bytes));
        response.setHeader("Cache-Control", route.immutable ? "public, max-age=31536000, immutable" : "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        onRequest(Object.freeze({ method, pathname, status: 200, bytes: route.bytes, sha256: route.sha256 }));
        if (method === "HEAD") {
          response.end();
          return;
        }
        const stream = createReadStream(route.filePath);
        stream.on("error", (error) => response.destroy(error));
        stream.pipe(response);
      });
    },
  };
}
