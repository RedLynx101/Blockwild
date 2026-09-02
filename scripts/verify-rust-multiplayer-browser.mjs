import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createConnection, createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RustEngineToolError,
  createRustEngineSourceSnapshot,
  findRepositoryRoot,
  isDirectInvocation,
  sha256File,
  validatePublishedArtifacts,
} from "./rust-engine-common.mjs";

export const REQUIRED_MULTIPLAYER_ARTIFACT_HASH = "0099873c2f6a4758fdcca5b4e17877a2b063853f1141799bdf3331045dd28bbd";
export const REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE = Object.freeze({
  generatorVersion: 18,
  generatorHash: "161eef7e34381d450067b7ebedbcb4e1",
  contentHash: "cc59903be77dfe30109d15bfaf0e3022",
  corpusCases: 155,
  corpusHash: "5d4e6b1445b00f3430164d1a8093d8dc",
  byteEqual: true,
});
export const REQUIRED_LOCAL_WEBRTC_BROWSER_ARGUMENT = "--disable-features=WebRtcHideLocalIpsWithMdns";
export const RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR = Object.freeze({
  parameter: "experimental.rust-live-player-authority",
  value: "r5",
  claim: "experimental.rust-live-player-authority=r5",
});

const EXPECTED_ENGINE_RELATIVE_DIRECTORY = "public/engine-locator-candidate";
const ARTIFACT_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const CANONICAL_HASH_PATTERN = /^[0-9a-f]{32}$/u;
const ID_PATTERN = /^[A-Za-z0-9_.-]{8,160}$/u;
const DEFAULT_TIMEOUT_MILLISECONDS = 360_000;
export const RUST_MULTIPLAYER_CONTINUE_ROUTE_TIMEOUT_MS = DEFAULT_TIMEOUT_MILLISECONDS;
const PROFILE_PREFIX = "blockwild-rust-multiplayer-";
const MAX_SIGNAL_CODE_CHARACTERS = 512 * 1024;
const MAX_EVIDENCE_EVENTS = 256;
const MULTIPLAYER_PROTOCOL_NAME = "blockwild-webrtc";
const MULTIPLAYER_PROTOCOL_VERSION = 3;
const MULTIPLAYER_MOVEMENT_CHUNK_SIZE = 16;
const MULTIPLAYER_MOVEMENT_MAX_PULSES = 16;
const MULTIPLAYER_MOVEMENT_FRAMES_PER_PULSE = 8;
const MULTIPLAYER_LEGACY_MOVEMENT_FRAMES_PER_PULSE = 16;
const MULTIPLAYER_MOVEMENT_MAX_FRAME_ATTEMPTS = 32;
const MULTIPLAYER_MOVEMENT_MAX_FRAME_ELAPSED_MILLISECONDS = 10_000;
const GENERATION_AUDIT_SCHEMA = 1;
const GENERATION_AUDIT_SENTINEL = "blockwild-rust-multiplayer-generation-audit-v1";
const VITE_RUNTIME_PREFIX = "vite-runtime-";
export const MANAGED_BROWSER_GATE_MUTEX_HOST = "127.0.0.1";
const MANAGED_BROWSER_GATE_MUTEX_MIN_PORT = 41_000;
const MANAGED_BROWSER_GATE_MUTEX_PORT_SPAN = 8_000;
const SANITIZED_VITE_ENVIRONMENT_KEYS = Object.freeze([
  "BLOCKWILD_RUST_ENGINE_CANDIDATE_ALIAS",
  "NEXT_PUBLIC_BLOCKWILD_EXPERIMENTAL_RUST_LIVE_PLAYER_AUTHORITY_R5",
  "NEXT_PUBLIC_BLOCKWILD_RUST_TERRAIN_MESHER",
  "NEXT_PUBLIC_BLOCKWILD_RUST_WORLD_AUTHORITY",
]);
const OWNED_VITE_ENVIRONMENT_KEYS = Object.freeze([
  "BLOCKWILD_WORLDGEN_BUILD_PROFILE",
  "WRANGLER_WRITE_LOGS",
  "WRANGLER_LOG_PATH",
  "WRANGLER_SEND_METRICS",
  "MINIFLARE_REGISTRY_PATH",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
]);

const HOST_PROFILE = Object.freeze({
  browserId: "browser_acceptance_host",
  profileId: "character_acceptance_host",
  networkId: "browser_acceptance_host.character_acceptance_host",
  name: "Rust Host",
});
const GUEST_PROFILE = Object.freeze({
  browserId: "browser_acceptance_guest",
  profileId: "character_acceptance_guest",
  networkId: "browser_acceptance_guest.character_acceptance_guest",
  name: "Rust Guest",
});
const WORLD_FIXTURE = Object.freeze({
  host: Object.freeze({ name: "Rust Multiplayer Host", seed: "MOON-FIELD-505" }),
  guest: Object.freeze({ name: "Rust Multiplayer Guest Local", seed: "RUST-RTC-GUEST-LOCAL" }),
  mode: "builder",
});

const OPTION_DEFINITIONS = Object.freeze({
  "repo-root": "string",
  "engine-dir": "string",
  "expected-artifact-hash": "string",
  output: "string",
  "timeout-ms": "integer",
  "playwright-module": "string",
  "browser-executable": "string",
  "require-r5-player-authority": "boolean",
  headed: "boolean",
  help: "boolean",
});

const CANONICAL_ASSETS = new Map([
  ["https://blockwild.app/manifest.webmanifest", "manifest.webmanifest"],
  ["https://blockwild.app/brand/blockwild-icon-16.png", "brand/blockwild-icon-16.png"],
  ["https://blockwild.app/brand/blockwild-icon-32.png", "brand/blockwild-icon-32.png"],
  ["https://blockwild.app/brand/blockwild-icon-64.png", "brand/blockwild-icon-64.png"],
  ["https://blockwild.app/brand/blockwild-icon-192.png", "brand/blockwild-icon-192.png"],
  ["https://blockwild.app/brand/blockwild-icon-512.png", "brand/blockwild-icon-512.png"],
]);

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function fail(message, details) {
  throw new RustEngineToolError(message, details);
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
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

function nearestExistingPath(candidatePath) {
  let cursor = path.resolve(candidatePath);
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) fail(`No existing ancestor was found for ${candidatePath}.`);
    cursor = parent;
  }
  return cursor;
}

function parseRawOptions(argv) {
  const parsed = Object.create(null);
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const type = OPTION_DEFINITIONS[key];
    if (!type) fail(`Unknown option: ${token}`);
    if (Object.hasOwn(parsed, key)) fail(`${token} may only be provided once.`);
    if (type === "boolean") {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value.`);
    if (type === "integer") {
      if (!/^[0-9]+$/u.test(value)) fail(`${token} requires a base-10 integer, received ${value}.`);
      parsed[key] = Number(value);
    } else parsed[key] = value;
    index += 1;
  }
  return parsed;
}

export function resolveMultiplayerWorkOutputDirectory(repositoryRoot, requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.trim() === "") fail("--output is required.");
  const workRoot = path.resolve(repositoryRoot, "work");
  if (!existsSync(workRoot) || !statSync(workRoot).isDirectory() || lstatSync(workRoot).isSymbolicLink()) {
    fail(`Repository work directory must be an existing non-symlink directory: ${workRoot}`);
  }
  const output = path.resolve(repositoryRoot, requestedPath);
  if (!pathIsInside(workRoot, output)) fail(`--output must resolve strictly beneath ${workRoot}; received ${output}.`);
  if (existsSync(output)) {
    const metadata = lstatSync(output);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail(`--output must be a non-symlink directory: ${output}`);
  }
  const canonicalWork = realpathSync(workRoot);
  const canonicalAncestor = realpathSync(nearestExistingPath(output));
  if (canonicalAncestor !== canonicalWork && !pathIsInside(canonicalWork, canonicalAncestor)) {
    fail(`--output resolves through an ancestor outside the canonical work directory: ${canonicalAncestor}`);
  }
  return output;
}

export function parseRustMultiplayerBrowserOptions(argv = process.argv, context = {}) {
  const raw = parseRawOptions(argv);
  const repositoryRoot = raw["repo-root"]
    ? findRepositoryRoot(path.resolve(context.cwd ?? process.cwd(), raw["repo-root"]))
    : findRepositoryRoot(context.cwd ?? process.cwd());
  if (raw.help) return Object.freeze({ help: true, repositoryRoot });
  if (raw["expected-artifact-hash"] !== REQUIRED_MULTIPLAYER_ARTIFACT_HASH) {
    fail(`--expected-artifact-hash must explicitly equal ${REQUIRED_MULTIPLAYER_ARTIFACT_HASH}.`);
  }
  if (typeof raw["engine-dir"] !== "string" || raw["engine-dir"].trim() === "") {
    fail(`--engine-dir is required and must explicitly select ${EXPECTED_ENGINE_RELATIVE_DIRECTORY}.`);
  }
  const expectedEngineDirectory = path.resolve(repositoryRoot, EXPECTED_ENGINE_RELATIVE_DIRECTORY);
  const engineDirectory = path.resolve(repositoryRoot, raw["engine-dir"]);
  if (comparablePath(engineDirectory) !== comparablePath(expectedEngineDirectory)) {
    fail(`--engine-dir must resolve exactly to ${EXPECTED_ENGINE_RELATIVE_DIRECTORY}.`);
  }
  const timeoutMilliseconds = raw["timeout-ms"] ?? DEFAULT_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 60_000 || timeoutMilliseconds > 900_000) {
    fail("--timeout-ms must be an integer from 60000 through 900000.");
  }
  return Object.freeze({
    help: false,
    repositoryRoot: realpathSync(repositoryRoot),
    engineDirectory,
    expectedArtifactHash: REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
    outputDirectory: resolveMultiplayerWorkOutputDirectory(repositoryRoot, raw.output),
    timeoutMilliseconds,
    playwrightModule: raw["playwright-module"] ? path.resolve(repositoryRoot, raw["playwright-module"]) : null,
    browserExecutable: raw["browser-executable"] ? path.resolve(repositoryRoot, raw["browser-executable"]) : null,
    requireR5PlayerAuthority: raw["require-r5-player-authority"] === true,
    headless: raw.headed !== true,
  });
}

export function rustMultiplayerNavigationUrl(baseUrl, role, options = {}) {
  assertCondition(role === "host" || role === "guest", `Multiplayer browser role is invalid: ${String(role)}`);
  const url = new URL("/", baseUrl);
  url.searchParams.set("rust-multiplayer-acceptance", role);
  if (options.requireR5PlayerAuthority === true) {
    url.searchParams.set(
      RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR.parameter,
      RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR.value,
    );
  }
  return url.href;
}

export function assertRustMultiplayerR5RouteSelector(url, label = "multiplayer browser") {
  let parsed;
  try { parsed = new URL(url); } catch {
    throw new Error(`${label} route is not an absolute URL: ${String(url)}`);
  }
  const values = parsed.searchParams.getAll(RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR.parameter);
  assertCondition(values.length === 1 && values[0] === RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR.value,
    `${label} route lost the exact ${RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR.claim} selector.`);
  return true;
}

export function managedBrowserGateMutexPort(repositoryRoot) {
  const canonicalRoot = realpathSync(repositoryRoot);
  const digest = createHash("sha256").update(`blockwild-managed-browser-gate-v1\n${canonicalRoot}`, "utf8").digest();
  return MANAGED_BROWSER_GATE_MUTEX_MIN_PORT
    + (digest.readUInt16BE(0) % MANAGED_BROWSER_GATE_MUTEX_PORT_SPAN);
}

export async function acquireManagedBrowserGateMutex(repositoryRoot, options = {}) {
  const host = options.host ?? MANAGED_BROWSER_GATE_MUTEX_HOST;
  const requestedPort = options.port ?? managedBrowserGateMutexPort(repositoryRoot);
  assertCondition(typeof host === "string" && host.length > 0, "Managed browser mutex host is invalid.");
  assertCondition(Number.isSafeInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65_535,
    `Managed browser mutex port is invalid: ${String(requestedPort)}`);
  const server = (options.createServer ?? createNetServer)((socket) => socket.destroy());
  const evidence = {
    schema: 1,
    mechanism: "exclusive-loopback-listener-os-released",
    repositoryRoot: realpathSync(repositoryRoot),
    host,
    requestedPort,
    port: null,
    status: "acquiring",
    acquiredAt: null,
    releasedAt: null,
    released: false,
  };
  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host, port: requestedPort, exclusive: true });
    });
  } catch (cause) {
    evidence.status = cause?.code === "EADDRINUSE" ? "contended" : "failed";
    evidence.errorCode = cause?.code ?? null;
    evidence.error = cause instanceof Error ? cause.message : String(cause);
    const error = new Error(
      evidence.status === "contended"
        ? `Another managed Blockwild browser gate, or an unrelated process on its exact mutex port, is already active at ${host}:${requestedPort}.`
        : `Managed Blockwild browser gate mutex failed at ${host}:${requestedPort}: ${evidence.error}`,
      { cause },
    );
    error.code = evidence.status === "contended"
      ? "BLOCKWILD_BROWSER_GATE_OVERLAP"
      : "BLOCKWILD_BROWSER_GATE_MUTEX_FAILURE";
    error.browserGateMutex = evidence;
    throw error;
  }
  const address = server.address();
  assertCondition(address && typeof address === "object", "Managed browser mutex did not expose its loopback address.");
  evidence.port = address.port;
  evidence.status = "acquired";
  evidence.acquiredAt = new Date().toISOString();
  server.unref();
  let releasePromise = null;
  return Object.freeze({
    server,
    evidence,
    release() {
      if (releasePromise) return releasePromise;
      releasePromise = new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            evidence.status = "release-failed";
            evidence.errorCode = error.code ?? null;
            evidence.error = error.message;
            reject(error);
            return;
          }
          evidence.status = "released";
          evidence.released = true;
          evidence.releasedAt = new Date().toISOString();
          resolve(true);
        });
      });
      return releasePromise;
    },
  });
}

function assertNonSymlinkTree(rootDirectory, label) {
  const rootMetadata = lstatSync(rootDirectory);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) fail(`${label} must be a non-symlink directory: ${rootDirectory}`);
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) fail(`${label} must not contain symlinks: ${absolute}`);
      if (metadata.isDirectory()) visit(absolute);
      else if (!metadata.isFile()) fail(`${label} contains an unsupported filesystem entry: ${absolute}`);
    }
  };
  visit(rootDirectory);
}

function immutableTreeSnapshot(rootDirectory) {
  const entries = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) fail(`Selected engine tree changed to include a symlink: ${absolute}`);
      if (metadata.isDirectory()) {
        entries.push({ kind: "directory", relative });
        visit(absolute, relative);
      } else if (metadata.isFile()) {
        entries.push({ kind: "file", relative, bytes: metadata.size, sha256: sha256File(absolute) });
      } else fail(`Selected engine tree contains an unsupported entry: ${absolute}`);
    }
  };
  visit(rootDirectory);
  const digest = createHash("sha256");
  digest.update("blockwild-rust-multiplayer-candidate-v1\n", "utf8");
  for (const entry of entries) digest.update(`${entry.kind}\0${entry.relative}\0${entry.sha256 ?? ""}\0${entry.bytes ?? ""}\n`, "utf8");
  return Object.freeze({
    digest: digest.digest("hex"),
    fileCount: entries.filter((entry) => entry.kind === "file").length,
    directoryCount: entries.filter((entry) => entry.kind === "directory").length,
  });
}

function canonicalFileRecord(filePath, contentType, immutable) {
  const canonical = realpathSync(filePath);
  const metadata = lstatSync(canonical);
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail(`Candidate route is not a regular file: ${filePath}`);
  return Object.freeze({
    filePath: canonical,
    contentType,
    immutable,
    bytes: metadata.size,
    sha256: sha256File(canonical),
  });
}

export function selectRustMultiplayerCandidate(repositoryRoot, requestedDirectory, expectedArtifactHash) {
  // The CLI pins its historical acceptance artifact before calling this reusable
  // selector. Selection always validates the caller's explicit hash and source.
  if (typeof expectedArtifactHash !== "string" || !ARTIFACT_HASH_PATTERN.test(expectedArtifactHash)) {
    fail("Multiplayer candidate selection requires an explicit lowercase SHA-256 artifact hash.");
  }
  const lexicalRoot = path.resolve(repositoryRoot);
  const canonicalRoot = realpathSync(lexicalRoot);
  const publicRoot = path.join(lexicalRoot, "public");
  if (!existsSync(publicRoot) || lstatSync(publicRoot).isSymbolicLink() || !statSync(publicRoot).isDirectory()) {
    fail(`Repository public root must be a non-symlink directory: ${publicRoot}`);
  }
  const canonicalPublic = realpathSync(publicRoot);
  if (!pathIsInside(canonicalRoot, canonicalPublic)) fail(`Repository public root resolves outside the repository: ${canonicalPublic}`);
  const exactLexicalDirectory = path.join(lexicalRoot, ...EXPECTED_ENGINE_RELATIVE_DIRECTORY.split("/"));
  const selectedLexicalDirectory = path.resolve(lexicalRoot, requestedDirectory);
  if (comparablePath(selectedLexicalDirectory) !== comparablePath(exactLexicalDirectory)) {
    fail(`Selected engine directory must be exactly ${EXPECTED_ENGINE_RELATIVE_DIRECTORY}.`);
  }
  if (!existsSync(selectedLexicalDirectory)) fail(`Selected engine directory is missing: ${selectedLexicalDirectory}`);
  assertNonSymlinkTree(selectedLexicalDirectory, "Selected multiplayer engine tree");
  const selectedDirectory = realpathSync(selectedLexicalDirectory);
  const exactCanonicalDirectory = path.join(canonicalPublic, "engine-locator-candidate");
  if (comparablePath(selectedDirectory) !== comparablePath(exactCanonicalDirectory)
    || !pathIsInside(canonicalPublic, selectedDirectory)) {
    fail(`Selected engine directory is not canonically contained at ${EXPECTED_ENGINE_RELATIVE_DIRECTORY}.`);
  }
  const verification = validatePublishedArtifacts(selectedDirectory);
  if (verification.index.defaultVariant !== "compatibility"
    || Object.keys(verification.index.artifacts).length !== 1) {
    fail("Selected engine index must contain only the default compatibility artifact.");
  }
  const artifact = verification.artifacts.find((candidate) => candidate.variant === "compatibility");
  if (!artifact || artifact.hash !== expectedArtifactHash) fail(`Selected compatibility artifact is not ${expectedArtifactHash}.`);
  if (!pathIsInside(selectedDirectory, artifact.directory)) fail("Selected artifact resolves outside its isolated index.");
  const currentSourceSnapshot = createRustEngineSourceSnapshot(canonicalRoot);
  const sourceSnapshot = artifact.manifest?.sourceSnapshot;
  if (sourceSnapshot?.schema !== 1
    || !ARTIFACT_HASH_PATTERN.test(sourceSnapshot.digest ?? "")
    || !Number.isSafeInteger(sourceSnapshot.fileCount)
    || sourceSnapshot.fileCount <= 0) {
    fail("Selected artifact has incomplete sourceSnapshot provenance.");
  }
  if (sourceSnapshot.digest !== currentSourceSnapshot.digest || sourceSnapshot.fileCount !== currentSourceSnapshot.fileCount) {
    fail(`Selected artifact is not current-source: artifact ${sourceSnapshot.digest}/${sourceSnapshot.fileCount}, current ${currentSourceSnapshot.digest}/${currentSourceSnapshot.fileCount}.`);
  }
  if (artifact.manifest.artifactHash !== expectedArtifactHash
    || artifact.manifest.variant !== "compatibility"
    || artifact.manifest.package !== "blockwild-wasm"
    || artifact.manifest.target !== "wasm32-unknown-unknown"
    || artifact.manifest.cargoProfile !== "release") {
    fail("Selected artifact build provenance is incomplete or inconsistent.");
  }
  const routes = new Map();
  routes.set("/engine/manifest.json", canonicalFileRecord(path.join(selectedDirectory, "manifest.json"), "application/json; charset=utf-8", false));
  routes.set(`/engine/${artifact.hash}/manifest.json`, canonicalFileRecord(path.join(artifact.directory, "manifest.json"), "application/json; charset=utf-8", true));
  for (const file of artifact.files) {
    routes.set(`/engine/${artifact.hash}/${file.path}`, canonicalFileRecord(
      path.join(artifact.directory, ...file.path.split("/")),
      file.mimeType,
      true,
    ));
  }
  return Object.freeze({
    repositoryRoot: canonicalRoot,
    relativeDirectory: EXPECTED_ENGINE_RELATIVE_DIRECTORY,
    directory: selectedDirectory,
    artifactDirectory: artifact.directory,
    hash: artifact.hash,
    variant: artifact.variant,
    manifest: artifact.manifest,
    sourceSnapshot: currentSourceSnapshot,
    treeSnapshot: immutableTreeSnapshot(selectedDirectory),
    routes,
  });
}

export function assertRustMultiplayerCandidateUnchanged(selection) {
  assertNonSymlinkTree(selection.directory, "Selected multiplayer engine tree");
  const treeSnapshot = immutableTreeSnapshot(selection.directory);
  if (JSON.stringify(treeSnapshot) !== JSON.stringify(selection.treeSnapshot)) {
    fail("Selected multiplayer engine tree changed during browser acceptance.");
  }
  const sourceSnapshot = createRustEngineSourceSnapshot(selection.repositoryRoot);
  if (sourceSnapshot.digest !== selection.sourceSnapshot.digest || sourceSnapshot.fileCount !== selection.sourceSnapshot.fileCount) {
    fail("Rust engine source changed during browser acceptance.");
  }
  return Object.freeze({ treeSnapshot, sourceSnapshot });
}

function engineRequestPathname(requestUrl) {
  if (typeof requestUrl !== "string" || !requestUrl.startsWith("/") || requestUrl.includes("\\") || requestUrl.includes("%")) return null;
  const pathname = requestUrl.split(/[?#]/u, 1)[0];
  if (pathname.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return pathname;
}

export function resolveRustMultiplayerCandidateRoute(selection, requestUrl) {
  const pathname = engineRequestPathname(requestUrl);
  return pathname === null ? null : selection.routes.get(pathname) ?? null;
}

export function createRustMultiplayerEnginePlugin(selection, onRequest = () => undefined) {
  return {
    name: "blockwild-rust-multiplayer-exact-engine",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const rawUrl = request.url ?? "/";
        if (!rawUrl.startsWith("/engine/")) {
          next();
          return;
        }
        const pathname = engineRequestPathname(rawUrl);
        const method = request.method ?? "GET";
        const route = pathname === null ? null : selection.routes.get(pathname);
        if (pathname === null || !route || (method !== "GET" && method !== "HEAD")) {
          const status = pathname === null ? 400 : 404;
          response.statusCode = status;
          response.setHeader("Cache-Control", "no-store");
          response.end();
          onRequest(Object.freeze({ method, pathname, status, bytes: 0, sha256: null }));
          return;
        }
        const metadata = lstatSync(route.filePath);
        if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size !== route.bytes || sha256File(route.filePath) !== route.sha256) {
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
        stream.once("error", (error) => response.destroy(error));
        stream.pipe(response);
      });
    },
  };
}

export function rustMultiplayerViteEnvironment(environment, runtimeDirectory) {
  if (!environment || typeof environment !== "object") fail("Managed multiplayer Vite requires an environment object.");
  if (typeof runtimeDirectory !== "string" || runtimeDirectory.length === 0) {
    fail("Managed multiplayer Vite requires an owned runtime directory.");
  }
  const next = {
    ...environment,
    BLOCKWILD_WORLDGEN_BUILD_PROFILE: "rust-primary",
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: path.join(runtimeDirectory, "wrangler", "wrangler.log"),
    MINIFLARE_REGISTRY_PATH: path.join(runtimeDirectory, "miniflare", "registry"),
    XDG_CACHE_HOME: path.join(runtimeDirectory, "xdg-cache"),
    XDG_CONFIG_HOME: path.join(runtimeDirectory, "xdg-config"),
    XDG_STATE_HOME: path.join(runtimeDirectory, "xdg-state"),
  };
  for (const key of SANITIZED_VITE_ENVIRONMENT_KEYS) delete next[key];
  return next;
}

export function installRustMultiplayerViteEnvironment(runtimeDirectory, environment = process.env) {
  const previous = { ...environment };
  const managed = rustMultiplayerViteEnvironment(environment, runtimeDirectory);
  for (const key of [...SANITIZED_VITE_ENVIRONMENT_KEYS, ...OWNED_VITE_ENVIRONMENT_KEYS]) delete environment[key];
  for (const [key, value] of Object.entries(managed)) environment[key] = value;
  let restored = false;
  return () => {
    if (restored) return true;
    for (const key of Object.keys(environment)) if (!Object.hasOwn(previous, key)) delete environment[key];
    for (const [key, value] of Object.entries(previous)) environment[key] = value;
    const previousKeys = Object.keys(previous).sort();
    const currentKeys = Object.keys(environment).sort();
    assertCondition(JSON.stringify(currentKeys) === JSON.stringify(previousKeys)
      && currentKeys.every((key) => environment[key] === previous[key]),
    "Managed multiplayer Vite did not restore the exact inherited process environment.");
    restored = true;
    return true;
  };
}

export function rustMultiplayerManagedViteWrapperSource(repositoryRoot, runtimeDirectory) {
  const canonicalRoot = realpathSync(repositoryRoot);
  const ownedRuntime = resolveMultiplayerWorkOutputDirectory(canonicalRoot, runtimeDirectory);
  const hostingPath = path.join(canonicalRoot, ".openai", "hosting.json");
  if (!existsSync(hostingPath) || lstatSync(hostingPath).isSymbolicLink() || !statSync(hostingPath).isFile()) {
    fail(`Managed multiplayer Vite requires the repository hosting config: ${hostingPath}`);
  }
  const hosting = JSON.parse(readFileSync(hostingPath, "utf8"));
  const localBindingConfig = {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: hosting.d1 ? [{
      binding: hosting.d1,
      database_name: "site-creator-d1",
      database_id: "00000000-0000-4000-8000-000000000000",
    }] : [],
    r2_buckets: hosting.r2 ? [{ binding: hosting.r2, bucket_name: "site-creator-r2" }] : [],
  };
  const baseConfigUrl = pathToFileURL(path.join(canonicalRoot, "vite.config.ts")).href;
  const persistStatePath = path.join(ownedRuntime, "cloudflare-state");
  const cacheDirectory = path.join(ownedRuntime, "node_modules", ".vite");
  return `import baseConfig from ${JSON.stringify(baseConfigUrl)};
import { cloudflare } from "@cloudflare/vite-plugin";

const localBindingConfig = ${JSON.stringify(localBindingConfig, null, 2)};
const cloudflarePlugin = (plugin) => plugin?.name === "vite-plugin-cloudflare"
  || plugin?.name?.startsWith("vite-plugin-cloudflare:");
const ownVinextRuntimeWrites = (plugin) => {
  if (plugin?.name !== "vinext:google-fonts" || typeof plugin.configResolved !== "function") return plugin;
  const configResolved = plugin.configResolved;
  return {
    ...plugin,
    configResolved(config) {
      return configResolved.call(plugin, { ...config, root: ${JSON.stringify(ownedRuntime)} });
    },
  };
};

// Resolve the imported async production config during module evaluation.
// Vite closes its config runner before invoking an exported config function,
// so deferring the production config's dynamic imports is not safe here.
const multiplayerConfigEnvironment = Object.freeze({
  command: "serve",
  mode: "development",
  isSsrBuild: false,
  isPreview: false,
});
const resolvedBaseConfig = typeof baseConfig === "function"
  ? await baseConfig(multiplayerConfigEnvironment)
  : baseConfig;
const productionPlugins = (resolvedBaseConfig.plugins ?? []).flat(Infinity)
  .filter((plugin) => !cloudflarePlugin(plugin))
  .map(ownVinextRuntimeWrites);

export default {
  ...resolvedBaseConfig,
  cacheDir: ${JSON.stringify(cacheDirectory)},
  plugins: [
    ...productionPlugins,
    ...cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      inspectorPort: false,
      persistState: { path: ${JSON.stringify(persistStatePath)} },
      config: localBindingConfig,
    }),
  ],
};
`;
}

export function rustMultiplayerManagedViteInlineConfig(repositoryRoot, port, runtimeDirectory, enginePlugin = { name: "blockwild-rust-multiplayer-exact-engine" }) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) fail(`Managed Vite port must be an integer from 1 through 65535, received ${String(port)}.`);
  const canonicalRoot = realpathSync(repositoryRoot);
  const ownedRuntime = resolveMultiplayerWorkOutputDirectory(canonicalRoot, runtimeDirectory);
  const configFile = path.join(ownedRuntime, "vite.config.mjs");
  return {
    root: canonicalRoot,
    configFile,
    configLoader: "runner",
    // Keep the cache owned while preserving Vinext's node_modules exclusion;
    // otherwise its CommonJS plugin re-transforms optimized React modules.
    cacheDir: path.join(ownedRuntime, "node_modules", ".vite"),
    clearScreen: false,
    plugins: [enginePlugin],
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      hmr: false,
      watch: { ignored: () => true },
    },
  };
}

async function reserveLoopbackPort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") fail("Could not reserve a loopback port.");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function loopbackPortAcceptsConnections(port, timeoutMilliseconds = 500) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback(value);
    };
    socket.once("connect", () => finish(resolve, true));
    socket.once("error", (error) => {
      if (error?.code === "ECONNREFUSED") finish(resolve, false);
      else finish(reject, error);
    });
    socket.setTimeout(timeoutMilliseconds, () => finish(reject, new Error(`Loopback port ${port} probe timed out.`)));
  });
}

export async function waitForRustMultiplayerPortRefusal(port, options = {}) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) fail(`Loopback port must be an integer from 1 through 65535, received ${String(port)}.`);
  const probe = options.probe ?? loopbackPortAcceptsConnections;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 5_000;
  const pollMilliseconds = options.pollMilliseconds ?? 50;
  const deadline = Date.now() + timeoutMilliseconds;
  while (true) {
    if (!await probe(port)) return true;
    if (Date.now() >= deadline) fail(`Managed Vite loopback port ${port} still accepts connections after close.`);
    await sleep(Math.min(pollMilliseconds, Math.max(1, deadline - Date.now())));
  }
}

async function closeViteServer(server) {
  if (!server) return true;
  server.httpServer?.closeAllConnections?.();
  await server.close();
  assertCondition(server.httpServer?.listening !== true, "Managed Vite HTTP server remains listening after close().");
  return true;
}

export async function cleanupRustMultiplayerViteStartupAttempt(attempt, restoreEnvironment, options = {}) {
  if (!attempt || typeof attempt !== "object") fail("Managed Vite startup cleanup requires its exact attempt record.");
  const closeServer = options.closeServer ?? closeViteServer;
  const waitForPortRefusal = options.waitForPortRefusal ?? waitForRustMultiplayerPortRefusal;
  const cleanupErrors = [];
  try { attempt.serverClosed = await closeServer(attempt.server); }
  catch (error) { cleanupErrors.push(`server close: ${error instanceof Error ? error.message : String(error)}`); }
  try { attempt.portRefused = await waitForPortRefusal(attempt.port); }
  catch (error) { cleanupErrors.push(`port refusal: ${error instanceof Error ? error.message : String(error)}`); }
  try { attempt.environmentRestored = restoreEnvironment ? restoreEnvironment() : true; }
  catch (error) { cleanupErrors.push(`environment restore: ${error instanceof Error ? error.message : String(error)}`); }
  if (cleanupErrors.length > 0) fail(`Managed Vite startup cleanup was incomplete: ${cleanupErrors.join(" | ")}`, { attempt });
  assertCondition(attempt.serverClosed === true && attempt.portRefused === true && attempt.environmentRestored === true,
    "Managed Vite startup cleanup did not prove close, port refusal, and environment restoration.");
  return true;
}

async function startManagedViteServer(selection, timeoutMilliseconds, routeRequests, runtimeDirectory, onAttempt = () => undefined) {
  const port = await reserveLoopbackPort();
  const plugin = createRustMultiplayerEnginePlugin(selection, (entry) => boundedPush(routeRequests, entry));
  const inlineConfig = rustMultiplayerManagedViteInlineConfig(selection.repositoryRoot, port, runtimeDirectory, plugin);
  writeFileSync(inlineConfig.configFile, rustMultiplayerManagedViteWrapperSource(selection.repositoryRoot, runtimeDirectory), { encoding: "utf8", flag: "wx" });
  const viteModule = path.join(selection.repositoryRoot, "node_modules", "vite", "dist", "node", "index.js");
  if (!existsSync(viteModule)) fail(`Managed server requires installed Vite module ${viteModule}.`);
  const attempt = {
    port,
    server: null,
    environmentInstalled: false,
    environmentRestored: true,
    serverClosed: true,
    portRefused: true,
  };
  onAttempt(attempt);
  let restoreEnvironment = null;
  try {
    restoreEnvironment = installRustMultiplayerViteEnvironment(runtimeDirectory);
    attempt.environmentInstalled = true;
    attempt.environmentRestored = false;
    const { createServer } = await import(pathToFileURL(viteModule).href);
    attempt.server = await createServer(inlineConfig);
    attempt.serverClosed = false;
    attempt.portRefused = false;
    const ignored = attempt.server.config.server.watch?.ignored;
    const ignoresAll = typeof ignored === "function"
      && ignored(path.join(selection.repositoryRoot, "app", "page.tsx")) === true
      && ignored(inlineConfig.configFile) === true;
    if (attempt.server.config.server.hmr !== false || !ignoresAll) {
      fail("Managed Vite did not retain HMR-off and ignore-all watch configuration.");
    }
    assertCondition(path.resolve(attempt.server.config.cacheDir) === path.resolve(inlineConfig.cacheDir),
      `Managed Vite cache escaped its owned runtime: ${attempt.server.config.cacheDir}`);
    assertCondition(attempt.server.config.define?.["process.env.NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE"] === JSON.stringify("rust-primary"),
      "Managed Vite did not compile the exact rust-primary build profile.");
    await attempt.server.listen();
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + Math.min(timeoutMilliseconds, 120_000);
    while (Date.now() < deadline) {
      try {
        const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
        await response.arrayBuffer();
        if (response.ok) return Object.freeze({
          server: attempt.server,
          baseUrl,
          port,
          inlineConfig,
          runtimeDirectory,
          restoreEnvironment,
          attempt,
        });
      } catch { /* Server is still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    fail("Managed Vite did not become ready within its bounded startup window.");
  } catch (error) {
    try {
      await cleanupRustMultiplayerViteStartupAttempt(attempt, restoreEnvironment);
    } catch (cleanupError) {
      fail(`Managed Vite startup failed and cleanup was incomplete: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`, {
        startupError: error instanceof Error ? error.message : String(error),
        attempt,
      });
    }
    throw error;
  }
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function signalCandidateTypes(sdp) {
  return [...sdp.matchAll(/^a=candidate:[^\r\n]*\styp\s+([A-Za-z0-9_-]+)/gmu)].map((match) => match[1].toLowerCase());
}

function isBoundedWellFormedUtf8(value, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maximumBytes) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) return false;
  }
  return true;
}

function requireManualSignalRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Manual WebRTC signal payload is not an object.");
  const signal = value;
  assertCondition(signal.version === MULTIPLAYER_PROTOCOL_VERSION, `Manual signal version is ${String(signal.version)}.`);
  assertCondition(signal.protocol === MULTIPLAYER_PROTOCOL_NAME, `Manual signal protocol is ${String(signal.protocol)}.`);
  assertCondition(signal.kind === "offer" || signal.kind === "answer", `Manual signal kind is ${String(signal.kind)}.`);
  assertCondition(ID_PATTERN.test(signal.sessionId ?? ""), "Manual signal sessionId is invalid.");
  assertCondition(ID_PATTERN.test(signal.token ?? ""), "Manual signal token is invalid.");
  assertCondition(ID_PATTERN.test(signal.identity?.id ?? ""), "Manual signal identity is invalid.");
  assertCondition(typeof signal.identity?.name === "string" && signal.identity.name.length > 0, "Manual signal identity name is absent.");
  assertCondition(signal.description?.type === signal.kind && typeof signal.description?.sdp === "string" && signal.description.sdp.length > 0, "Manual signal SDP is absent.");
  assertCondition(signal.authority?.schema === 1 && typeof signal.authority?.packet === "string" && /^[A-Za-z0-9_-]+$/u.test(signal.authority.packet), "Manual signal Rust authority packet is absent.");
  const runtime = signal.runtime;
  assertCondition(runtime?.schema === 2, "Manual signal Rust runtime descriptor schema is absent.");
  assertCondition(runtime.runtimeSessionId === signal.sessionId, "Manual signal Rust runtime session differs from its WebRTC session.");
  for (const key of ["generatorHash", "contentHash", "terrainContentHash", "descriptorHash"]) {
    assertCondition(CANONICAL_HASH_PATTERN.test(runtime[key] ?? ""), `Manual signal runtime ${key} is invalid.`);
  }
  assertCondition(isBoundedWellFormedUtf8(runtime.worldSeed, 2_048), "Manual signal world seed is invalid.");
  assertCondition(isBoundedWellFormedUtf8(runtime.universeId, 64) && isBoundedWellFormedUtf8(runtime.locationId, 128),
    "Manual signal universe/location identity is invalid.");
  assertCondition(typeof runtime.generationOptionsJson === "string" && runtime.generationOptionsJson.length > 0, "Manual signal generation options are absent.");
  const candidateTypes = signalCandidateTypes(signal.description.sdp);
  assertCondition(candidateTypes.length > 0, "Manual signal SDP contains no gathered ICE candidates.");
  assertCondition(candidateTypes.every((type) => type === "host"), `Manual signal attempted non-local ICE candidate types: ${candidateTypes.join(",")}.`);
  return signal;
}

export function decodeRustMultiplayerManualSignal(code) {
  if (typeof code !== "string") throw new Error("Manual signal must be text.");
  const compact = code.trim().replace(/\s+/gu, "");
  if (compact.length < 5 || compact.length > MAX_SIGNAL_CODE_CHARACTERS || !compact.startsWith("BW1.")) {
    throw new Error("Manual signal has an invalid BW1 envelope.");
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.from(compact.slice(4), "base64url").toString("utf8")); }
  catch { throw new Error("Manual signal payload is malformed."); }
  return requireManualSignalRecord(parsed);
}

export function summarizeRustMultiplayerManualSignal(code) {
  const signal = decodeRustMultiplayerManualSignal(code);
  const sdp = signal.description.sdp;
  const authorityPacketBytes = Buffer.from(signal.authority.packet, "base64url");
  return Object.freeze({
    version: signal.version,
    protocol: signal.protocol,
    kind: signal.kind,
    sessionId: signal.sessionId,
    token: signal.token,
    identity: Object.freeze({
      id: signal.identity.id,
      name: signal.identity.name,
      peerKind: signal.identity.peerKind ?? "human",
      profileId: signal.identity.profileId ?? null,
      browserId: signal.identity.browserId ?? null,
    }),
    runtime: Object.freeze({
      schema: signal.runtime.schema,
      worldSeed: signal.runtime.worldSeed,
      universeId: signal.runtime.universeId,
      locationId: signal.runtime.locationId,
      runtimeSessionId: signal.runtime.runtimeSessionId,
      generatorHash: signal.runtime.generatorHash,
      contentHash: signal.runtime.contentHash,
      terrainContentHash: signal.runtime.terrainContentHash,
      descriptorHash: signal.runtime.descriptorHash,
      generationOptionsBytes: Buffer.byteLength(signal.runtime.generationOptionsJson, "utf8"),
      generationOptionsSha256: sha256Text(signal.runtime.generationOptionsJson),
    }),
    authority: Object.freeze({ bytes: authorityPacketBytes.byteLength, sha256: createHash("sha256").update(authorityPacketBytes).digest("hex") }),
    sdp: Object.freeze({ bytes: Buffer.byteLength(sdp, "utf8"), sha256: sha256Text(sdp), candidateTypes: Object.freeze(signalCandidateTypes(sdp)) }),
    envelope: Object.freeze({ characters: code.trim().length, sha256: sha256Text(code.trim()) }),
  });
}

export function assertRustMultiplayerSignalPair(offer, answer, expected = {}) {
  assertCondition(offer?.kind === "offer" && answer?.kind === "answer", "Manual signal pair must contain one offer and one answer.");
  assertCondition(offer.protocol === MULTIPLAYER_PROTOCOL_NAME && answer.protocol === MULTIPLAYER_PROTOCOL_NAME, "Manual signal pair protocol differs from production.");
  assertCondition(offer.sessionId === answer.sessionId, "Offer and answer use different sessions.");
  assertCondition(offer.token === answer.token, "Offer and answer use different invite tokens.");
  assertCondition(JSON.stringify(offer.runtime) === JSON.stringify(answer.runtime), "Offer and answer attest different Rust runtime descriptors.");
  assertCondition(offer.authority?.bytes > 0 && answer.authority?.bytes > 0, "Offer/answer Rust authority handshake packets are absent.");
  assertCondition(offer.sdp?.candidateTypes?.every((type) => type === "host") && answer.sdp?.candidateTypes?.every((type) => type === "host"), "Offer/answer used a non-host ICE candidate.");
  if (expected.hostId !== undefined) assertCondition(offer.identity.id === expected.hostId, `Offer host identity differs from ${expected.hostId}.`);
  if (expected.guestId !== undefined) assertCondition(answer.identity.id === expected.guestId, `Answer guest identity differs from ${expected.guestId}.`);
  if (expected.worldSeed !== undefined) assertCondition(offer.runtime.worldSeed === expected.worldSeed, `Offer world seed differs from ${expected.worldSeed}.`);
  return Object.freeze({
    sessionId: offer.sessionId,
    token: offer.token,
    contentHash: offer.runtime.contentHash,
    descriptorHash: offer.runtime.descriptorHash,
    hostId: offer.identity.id,
    guestId: answer.identity.id,
  });
}

function runtimeProof(runtime) {
  return Object.freeze({
    ready: runtime?.ready,
    operationsBlocked: runtime?.operationsBlocked,
    activeUniverseId: runtime?.activeUniverseId ?? null,
    activeLocationId: runtime?.activeLocationId ?? null,
    activeSessionId: runtime?.activeSessionId ?? null,
    hydration: runtime?.hydration ?? null,
    managerState: runtime?.manager?.state ?? null,
    hostState: runtime?.manager?.host?.state ?? null,
    artifactHash: runtime?.manager?.host?.artifactHash ?? null,
    contentHash: runtime?.manager?.host?.contentHash ?? null,
    adapterState: runtime?.manager?.host?.adapter?.state ?? null,
    adapterAuthoritative: runtime?.manager?.host?.adapter?.authoritative ?? null,
    adapterVerification: runtime?.manager?.host?.adapter?.verification ?? null,
    liveAuthorityReady: runtime?.manager?.host?.adapter?.liveAuthorityReady ?? null,
    multiplayer: Object.freeze({ ...(runtime?.multiplayer ?? {}) }),
  });
}

function exactGenerationCertificate(certificate) {
  if (!certificate || typeof certificate !== "object" || Array.isArray(certificate)) return false;
  const exactKeys = ["byteEqual", "contentHash", "corpusCases", "corpusHash", "generatorHash", "generatorVersion"];
  const keys = Object.keys(certificate).sort();
  return JSON.stringify(keys) === JSON.stringify(exactKeys)
    && certificate.generatorVersion === REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.generatorVersion
    && certificate.corpusCases === REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.corpusCases
    && certificate.corpusHash === REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.corpusHash
    && certificate.byteEqual === REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.byteEqual
    && certificate.generatorHash === REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.generatorHash
    && certificate.contentHash === REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.contentHash;
}

export function assertRustMultiplayerGenerationAudit(snapshot, expectedArtifactHash, label = "browser") {
  assertCondition(expectedArtifactHash === REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
    `${label} generation audit expected the wrong candidate artifact.`);
  assertCondition(snapshot?.runtime?.manager?.host?.artifactHash === expectedArtifactHash,
    `${label} generation audit is not bound to exact candidate ${expectedArtifactHash}.`);
  const audit = snapshot?.generationAudit;
  const descriptor = snapshot?.generationAuditDescriptor;
  assertCondition(audit && typeof audit === "object", `${label} generation audit is absent.`);
  assertCondition(audit.schema === GENERATION_AUDIT_SCHEMA && audit.sentinel === GENERATION_AUDIT_SENTINEL,
    `${label} generation audit has the wrong schema/sentinel.`);
  assertCondition(descriptor?.configurable === false && descriptor?.writable === false && descriptor?.enumerable === false,
    `${label} generation audit property is not exact and non-configurable.`);
  assertCondition(audit.workerInstrumentation === true, `${label} generation Worker instrumentation is absent.`);
  assertCondition(audit.dataChannelSendInstrumentation === true, `${label} multiplayer DataChannel send instrumentation is absent.`);
  assertCondition(audit.workerStillInstalled === true && audit.dataChannelSendStillInstalled === true,
    `${label} browser audit instrumentation was replaced after installation.`);
  assertCondition(Array.isArray(audit.outboundAuthorityCommands), `${label} multiplayer authority-command audit is malformed.`);
  assertCondition(Array.isArray(audit.outboundPlayerPoses), `${label} multiplayer pose audit is malformed.`);
  assertCondition(Array.isArray(audit.generationWorkerCreations) && audit.generationWorkerCreations.length > 0,
    `${label} generation audit observed no terrain Worker construction.`);
  assertCondition(Array.isArray(audit.generationReadyMessages) && audit.generationReadyMessages.length > 0,
    `${label} generation audit observed no Worker certificate.`);
  assertCondition(Array.isArray(audit.generationWorkerTerminations),
    `${label} generation Worker termination audit is malformed.`);
  assertCondition(Array.isArray(audit.generationStartupErrors) && audit.generationStartupErrors.length === 0,
    `${label} generation audit observed a Worker startup error.`);
  const generation = snapshot?.state?.performance?.streaming?.generationWorker;
  assertCondition(generation?.mode === "rust" && generation?.selectionSource === "build-rust-primary",
    `${label} generation diagnostics are not rust-primary.`);
  assertCondition(Number.isSafeInteger(generation?.workers) && generation.workers > 0 && generation.ready === generation.workers,
    `${label} generation Workers are not all ready.`);
  const creationOrdinals = new Set();
  for (const creation of audit.generationWorkerCreations) {
    assertCondition(Number.isSafeInteger(creation?.ordinal) && creation.ordinal > 0 && !creationOrdinals.has(creation.ordinal),
      `${label} generation Worker creation record is malformed or duplicated.`);
    assertCondition(typeof creation.url === "string" && creation.url.includes("terrain-generation-worker"),
      `${label} generation Worker URL is malformed.`);
    creationOrdinals.add(creation.ordinal);
  }
  const readyOrdinals = new Set();
  for (const record of audit.generationReadyMessages) {
    assertCondition(creationOrdinals.has(record?.ordinal) && !readyOrdinals.has(record.ordinal),
      `${label} generation certificate record is orphaned or duplicated.`);
    assertCondition(record.type === "terrain-generation-ready-v2"
      && record.protocolVersion === 2
      && record.requestSchemaVersion === 2
      && record.resultSchemaVersion === 2
      && record.backend === "rust-wasm-authoritative",
    `${label} generation certificate envelope is malformed.`);
    assertCondition(exactGenerationCertificate(record.certificate),
      `${label} generation certificate is not the exact v18 155-case byte-equal certificate.`);
    readyOrdinals.add(record.ordinal);
  }
  const terminationOrdinals = new Set();
  const terminationByOrdinal = new Map();
  for (const record of audit.generationWorkerTerminations) {
    assertCondition(Number.isSafeInteger(record?.ordinal) && creationOrdinals.has(record.ordinal)
      && !terminationOrdinals.has(record.ordinal),
    `${label} generation Worker termination record is malformed, orphaned, or duplicated.`);
    assertCondition(typeof record.ready === "boolean"
      && Number.isSafeInteger(record.postedMessages) && record.postedMessages >= 0,
    `${label} generation Worker termination evidence is malformed.`);
    terminationOrdinals.add(record.ordinal);
    terminationByOrdinal.set(record.ordinal, record);
  }
  for (const ordinal of creationOrdinals) {
    if (readyOrdinals.has(ordinal)) continue;
    const termination = terminationByOrdinal.get(ordinal);
    assertCondition(termination?.ready === false && termination.postedMessages === 0,
      `${label} generation audit has an uncertified Worker that was not canceled unused before readiness (ordinal ${ordinal}).`);
  }
  const liveOrdinals = new Set([...creationOrdinals].filter((ordinal) => !terminationOrdinals.has(ordinal)));
  assertCondition([...liveOrdinals].every((ordinal) => readyOrdinals.has(ordinal)),
    `${label} generation audit has a live Worker without exactly one startup certificate.`);
  assertCondition(liveOrdinals.size === generation.workers,
    `${label} generation audit does not cover every live Worker.`);
  const liveCertificate = audit.generationReadyMessages.find((record) => liveOrdinals.has(record.ordinal))?.certificate;
  assertCondition(exactGenerationCertificate(liveCertificate),
    `${label} generation audit has no exact certificate for a live Worker.`);
  return Object.freeze({
    schema: audit.schema,
    sentinel: audit.sentinel,
    artifactHash: expectedArtifactHash,
    propertyDescriptor: Object.freeze({ ...descriptor }),
    instrumentation: Object.freeze({ worker: true, dataChannelSend: true, stillInstalled: true }),
    workerCount: liveOrdinals.size,
    certificateCount: readyOrdinals.size,
    canceledBeforeReadyCount: [...terminationByOrdinal.values()].filter((record) => !record.ready).length,
    certificate: Object.freeze({ ...liveCertificate }),
  });
}

function multiplayerDeltaEvidence(snapshot, label) {
  const multiplayer = snapshot?.runtime?.multiplayer;
  const sequence = multiplayer?.authorityDeltaSequence;
  const applied = multiplayer?.authorityDeltaApplied;
  assertCondition(Number.isSafeInteger(sequence) && sequence >= 0, `${label} host authority sequence is malformed.`);
  assertCondition(Number.isSafeInteger(applied) && applied >= 0, `${label} guest authority applied count is malformed.`);
  assertCondition(multiplayer?.recordProducer === "coarse-legacy-projection" && multiplayer?.pendingNativeProducer === true,
    `${label} exceeds the current bounded multiplayer producer claim.`);
  const stateHash = multiplayer?.lastStateHash ?? null;
  assertCondition(stateHash === null || CANONICAL_HASH_PATTERN.test(stateHash), `${label} Rust state hash is malformed.`);
  return Object.freeze({
    authorityDeltaSequence: sequence,
    authorityDeltaApplied: applied,
    lastStateHash: stateHash,
    recordProducer: multiplayer.recordProducer,
    pendingNativeProducer: multiplayer.pendingNativeProducer,
  });
}

export function assertRustMultiplayerMovementProof(proof) {
  assertCondition(proof?.schema === 1, "Movement proof schema is malformed.");
  const legacyAttribution = proof?.attribution?.level
      === "typescript-legacy-player-simulation-with-native-guest-pose-custody-plus-post-input-keyframe"
    && proof.attribution.poseCustody === "rust-native"
    && proof.attribution.playerMovementSimulation === "typescript"
    && (proof.attribution.playerAuthoritySelector === null
      || proof.attribution.playerAuthoritySelector === undefined);
  const combinedR5Attribution = proof?.attribution?.level
      === "rust-r5-native-player-simulation-with-native-guest-pose-custody-plus-post-input-keyframe"
    && proof.attribution.poseCustody === "rust-native"
    && proof.attribution.playerMovementSimulation === "rust-r5-native-authority"
    && proof.attribution.playerAuthoritySelector === RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR.claim;
  assertCondition(legacyAttribution !== combinedR5Attribution && (legacyAttribution || combinedR5Attribution),
    "Movement proof has no exact legacy or R5 player-simulation attribution.");
  assertCondition(proof?.command?.kind === "virtual-key" && proof.command.key === "KeyD"
    && proof.command.down === true && proof.command.released === true,
  "Movement proof does not contain the exact bounded KeyD command.");
  assertCondition(proof.command.chunkSize === MULTIPLAYER_MOVEMENT_CHUNK_SIZE
    && proof.command.maximumPulses === MULTIPLAYER_MOVEMENT_MAX_PULSES
    && Number.isSafeInteger(proof.command.startChunkX)
    && proof.command.endChunkX === proof.command.startChunkX + 1
    && proof.command.crossedChunkBoundary === true,
  "Movement proof does not contain the exact bounded one-chunk transition contract.");
  assertCondition(Array.isArray(proof.command.pulses)
    && proof.command.pulses.length >= 1
    && proof.command.pulses.length <= proof.command.maximumPulses,
  "Movement proof contains no bounded input pulses.");
  if (combinedR5Attribution) {
    assertCondition(proof.command.clock === "native-monotonic-live"
      && proof.command.sampling === "engine-serialized-native-frames-immediate-release"
      && proof.command.framesPerPulse === MULTIPLAYER_MOVEMENT_FRAMES_PER_PULSE,
    "R5 movement proof does not use exact engine-serialized native sampling.");
    const witnessKeys = ["attempts", "buttons", "elapsedMilliseconds", "moveX", "moveZ", "sequence"];
    const isExactWitness = (witness) => witness !== null && typeof witness === "object"
      && Object.keys(witness).sort().join("\u0000") === witnessKeys.join("\u0000")
      && Number.isSafeInteger(witness.sequence)
      && Number.isSafeInteger(witness.attempts)
      && witness.attempts >= 1
      && witness.attempts <= MULTIPLAYER_MOVEMENT_MAX_FRAME_ATTEMPTS
      && Number.isFinite(witness.elapsedMilliseconds)
      && witness.elapsedMilliseconds >= 0
      && witness.elapsedMilliseconds <= MULTIPLAYER_MOVEMENT_MAX_FRAME_ELAPSED_MILLISECONDS;
    let minimumNextPulseSequence = null;
    for (const [pulseIndex, pulse] of proof.command.pulses.entries()) {
      assertCondition(pulse?.index === pulseIndex + 1
        && pulse.schema === 1
        && pulse.key === "KeyD"
        && pulse.frameCount === proof.command.framesPerPulse
        && Number.isSafeInteger(pulse.inputSequenceBefore)
        && pulse.inputSequenceBefore >= 1
        && !Object.hasOwn(pulse, "appliedSequences")
        && Array.isArray(pulse.frames)
        && pulse.frames.length === pulse.frameCount,
      "R5 movement proof contains a malformed native pulse receipt.");
      assertCondition(minimumNextPulseSequence === null || pulse.inputSequenceBefore >= minimumNextPulseSequence,
        "R5 movement pulse sequences overlap or regress across releases.");
      for (const [frameIndex, frame] of pulse.frames.entries()) {
        assertCondition(isExactWitness(frame)
          && frame.sequence === pulse.inputSequenceBefore + frameIndex
          && frame.moveX === 32_767
          && frame.moveZ === 0
          && frame.buttons === 0,
        "R5 movement proof lacks an exact bounded KeyD native-frame witness.");
      }
      const finalFrame = pulse.frames.at(-1);
      assertCondition(isExactWitness(pulse.release)
        && pulse.release.sequence === finalFrame.sequence + 1
        && pulse.release.moveX === 0
        && pulse.release.moveZ === 0
        && pulse.release.buttons === 0,
      "R5 movement proof lacks the exact bounded zero-input release witness.");
      minimumNextPulseSequence = pulse.release.sequence + 1;
    }
  } else {
    assertCondition(proof.command.clock === "browser-request-animation-frame"
      && proof.command.sampling === "request-animation-frame-bounded-typescript-key-hold"
      && proof.command.framesPerPulse === MULTIPLAYER_LEGACY_MOVEMENT_FRAMES_PER_PULSE
      && (proof.r5PlayerAuthority === null || proof.r5PlayerAuthority === undefined),
    "Legacy movement proof claims native sampling or R5 player authority.");
    assertCondition(proof.command.pulses.every((pulse, index) => (
      pulse?.index === index + 1
      && pulse.schema === 1
      && pulse.key === "KeyD"
      && pulse.frameCount === proof.command.framesPerPulse
      && pulse.completedFrames === pulse.frameCount
      && pulse.released === true
      && Number.isFinite(pulse.elapsedMilliseconds)
      && pulse.elapsedMilliseconds >= 0
      && pulse.elapsedMilliseconds <= MULTIPLAYER_MOVEMENT_MAX_FRAME_ELAPSED_MILLISECONDS
      && !Object.keys(pulse).some((key) => /sequence|moveX|moveZ|buttons|attempts/iu.test(key))
      && !Object.hasOwn(pulse, "frames")
      && !Object.hasOwn(pulse, "release")
      && !Object.hasOwn(pulse, "appliedSequences")
    )),
    "Legacy movement proof is unbounded or improperly claims native input evidence.");
  }
  assertCondition(Number.isSafeInteger(proof.command.authorityPose?.authoritySequence)
    && proof.command.authorityPose.authoritySequence > proof.command.authoritySequenceBefore,
  "Movement proof has no exact post-input guest pose authority sequence.");
  assertCondition(proof.command.authorityPose?.from === GUEST_PROFILE.networkId
    && proof.command.authorityPose?.playerId === GUEST_PROFILE.networkId,
  "Movement authority pose is not bound to the exact guest identity.");
  assertCondition(Array.isArray(proof.command.authorityPose?.position)
    && proof.command.authorityPose.position.length === 3
    && proof.command.authorityPose.position.every(Number.isFinite),
  "Movement authority pose position is malformed.");
  assertCondition(Math.floor(proof.receipt?.guestStart?.[0] / proof.command.chunkSize) === proof.command.startChunkX
    && Math.floor(proof.receipt?.guestEnd?.[0] / proof.command.chunkSize) === proof.command.endChunkX,
  "Movement receipt does not prove the commanded one-chunk transition.");
  const beforeHost = multiplayerDeltaEvidence(proof?.delta?.before?.host, "movement pre-input host");
  const beforeGuest = multiplayerDeltaEvidence(proof?.delta?.before?.guest, "movement pre-input guest");
  const afterHost = multiplayerDeltaEvidence(proof?.delta?.after?.host, "movement post-input host");
  const afterGuest = multiplayerDeltaEvidence(proof?.delta?.after?.guest, "movement post-input guest");
  assertCondition(afterHost.authorityDeltaSequence > beforeHost.authorityDeltaSequence,
    "Movement proof has no Rust host authority delta emitted after input.");
  assertCondition(afterGuest.authorityDeltaApplied > beforeGuest.authorityDeltaApplied,
    "Movement proof has no Rust guest authority delta applied after input.");
  assertCondition(afterGuest.lastStateHash !== null, "Movement proof has no post-input Rust guest state hash.");
  assertCondition(beforeGuest.lastStateHash === null || afterGuest.lastStateHash !== beforeGuest.lastStateHash,
    "Movement proof has no changed post-input Rust guest state hash.");
  assertCondition(proof?.delta?.capturedAfterInputRelease === true,
    "Movement Rust delta was not captured after the bounded input was released.");
  const nativeProjection = proof?.receipt?.nativeProjection;
  const priorNativeProjection = proof?.receipt?.priorNativeProjection;
  const remotePlayer = proof?.receipt?.remotePlayer;
  const nativePoseCustody = remotePlayer?.nativePoseCustody;
  const transportPeer = proof?.receipt?.transportPeer;
  assertCondition(proof?.receipt?.kind === "rust-native-guest-pose-projection"
    && proof.receipt.guestId === GUEST_PROFILE.networkId,
  "Movement receipt is not the bounded native guest-pose projection.");
  assertCondition(Number.isSafeInteger(nativeProjection?.connectionGeneration)
    && nativeProjection.connectionGeneration >= 1
    && Number.isSafeInteger(nativeProjection.commandSequence)
    && nativeProjection.commandSequence > proof.command.authoritySequenceBefore
    && nativeProjection.commandSequence === proof.command.authorityPose.authoritySequence
    && Number.isSafeInteger(nativeProjection.recordRevision)
    && nativeProjection.recordRevision >= 1
    && CANONICAL_HASH_PATTERN.test(nativeProjection.receiptHash ?? "")
    && CANONICAL_HASH_PATTERN.test(nativeProjection.recordHash ?? ""),
  "Movement receipt has no exact native projection receipt and pose-record identity.");
  assertCondition(Number.isSafeInteger(priorNativeProjection?.connectionGeneration)
    && priorNativeProjection.connectionGeneration === nativeProjection.connectionGeneration
    && Number.isSafeInteger(priorNativeProjection.commandSequence)
    && priorNativeProjection.commandSequence <= proof.command.authoritySequenceBefore
    && priorNativeProjection.commandSequence < nativeProjection.commandSequence
    && Number.isSafeInteger(priorNativeProjection.recordRevision)
    && priorNativeProjection.recordRevision < nativeProjection.recordRevision
    && CANONICAL_HASH_PATTERN.test(priorNativeProjection.receiptHash ?? "")
    && CANONICAL_HASH_PATTERN.test(priorNativeProjection.recordHash ?? "")
    && priorNativeProjection.receiptHash !== nativeProjection.receiptHash
    && priorNativeProjection.recordHash !== nativeProjection.recordHash,
  "Movement receipt did not advance from a prior native pose projection on the same connection.");
  assertCondition(remotePlayer?.id === GUEST_PROFILE.networkId
    && Array.isArray(remotePlayer.position)
    && remotePlayer.position.length === 3
    && remotePlayer.position.every(Number.isFinite)
    && Number.isSafeInteger(remotePlayer.tick)
    && remotePlayer.tick === proof.command.authorityPose.tick
    && nativePoseCustody?.connectionGeneration === nativeProjection.connectionGeneration
    && nativePoseCustody?.commandSequence === nativeProjection.commandSequence
    && nativePoseCustody?.recordRevision === nativeProjection.recordRevision
    && nativePoseCustody?.receiptHash === nativeProjection.receiptHash
    && nativePoseCustody?.recordHash === nativeProjection.recordHash,
  "Host remote-player state is not exactly bound to the native pose projection receipt.");
  assertCondition(horizontalDistance(remotePlayer.position, proof.command.authorityPose.position) <= 0.025,
    "Host remote-player position does not match the native-custodied authority pose.");
  assertCondition(transportPeer?.peerId === GUEST_PROFILE.networkId
    && transportPeer.state === "connected"
    && transportPeer.authorityGeneration === nativeProjection.connectionGeneration
    && Number.isSafeInteger(transportPeer.nativePoseAccepted)
    && transportPeer.nativePoseAccepted >= 1
    && transportPeer.nativePoseDelivered === transportPeer.nativePoseAccepted
    && transportPeer.nativePoseStaleGenerationDrops === 0
    && transportPeer.lastNativePoseCommandSequence === nativeProjection.commandSequence
    && transportPeer.lastNativePoseRecordRevision === nativeProjection.recordRevision
    && transportPeer.lastNativePoseReceiptHash === nativeProjection.receiptHash
    && transportPeer.lastNativePoseRecordHash === nativeProjection.recordHash
    && transportPeer.authorityRejected === 0
    && transportPeer.authorityErrors === 0
    && transportPeer.protocolStrikes === 0,
  "Host transport diagnostics are not exactly bound to a clean native pose delivery.");
  assertCondition(Array.isArray(proof.receipt.guestStart) && proof.receipt.guestStart.length === 3
    && proof.receipt.guestStart.every(Number.isFinite)
    && Array.isArray(proof.receipt.guestEnd) && proof.receipt.guestEnd.length === 3
    && proof.receipt.guestEnd.every(Number.isFinite),
  "Movement receipt guest positions are malformed.");
  assertCondition(Number.isFinite(proof.receipt.guestDistance) && proof.receipt.guestDistance > 1,
    "Guest did not move more than one block.");
  assertCondition(Math.abs(horizontalDistance(proof.receipt.guestStart, proof.receipt.guestEnd) - proof.receipt.guestDistance) <= 1e-6,
    "Movement receipt distance does not match its exact guest positions.");
  assertCondition(horizontalDistance(proof.command.authorityPose.position, proof.receipt.guestEnd) <= 0.5,
    "Movement authority pose did not converge on the final guest position.");
  assertCondition(Number.isFinite(proof.receipt.hostPinDisplacement) && proof.receipt.hostPinDisplacement > 0,
    "Host map pin did not move after guest input.");
  assertCondition(Number.isFinite(proof.receipt.hostPinConvergence) && proof.receipt.hostPinConvergence <= 2,
    "Host map pin did not converge on the moved guest.");
  assertCondition(proof.receipt.hostPinCountBefore === 1 && proof.receipt.hostPinCountAfter === 1,
    "Guest movement created a missing or duplicate host map pin.");
  if (combinedR5Attribution) {
    for (const phase of ["initial", "postInput"]) for (const role of ["host", "guest"]) {
      const diagnostics = proof?.r5PlayerAuthority?.[phase]?.[role];
      assertCondition(diagnostics?.operationsBlocked === false
        && diagnostics?.playerAuthority?.state === "ready"
        && diagnostics?.pump?.state === "ready"
        && diagnostics?.transitionGeneration === diagnostics?.playerAuthority?.worldGeneration
        && diagnostics?.transitionGeneration === diagnostics?.pump?.worldGeneration,
      `Movement proof lacks exact ${phase} ${role} R5 player-authority/pump readiness.`);
    }
    const outboundPose = proof?.r5PlayerAuthority?.postInputGuestOutboundPose;
    assertCondition(outboundPose?.producer === "rust-live-player-view-r10-kinematics"
      && outboundPose?.playerId === GUEST_PROFILE.networkId
      && outboundPose?.tick === proof.command.authorityPose.tick
      && Array.isArray(outboundPose?.position)
      && outboundPose.position.length === 3
      && horizontalDistance(outboundPose.position, proof.command.authorityPose.position) <= 0.025
      && Number.isFinite(outboundPose.position[1])
      && Math.abs(outboundPose.position[1] - proof.command.authorityPose.position[1]) <= 0.025
      && outboundPose?.nativeSource?.authorityTick === String(outboundPose?.pumpAuthorityTick),
    "Movement proof does not bind the native outbound-pose source to the exact Rust-custodied endpoint.");
  }
  assertCondition((legacyAttribution || combinedR5Attribution)
    && proof.attribution.worldKeyframeProducer === "coarse-legacy-projection",
  "Movement proof omitted the exact native-custody and compatibility attribution boundary.");
  return Object.freeze({ beforeHost, beforeGuest, afterHost, afterGuest });
}

export function collectRustMultiplayerRuntimeErrors(state, runtime) {
  const errors = [];
  const generation = state?.performance?.streaming?.generationWorker;
  const terrainWorker = state?.performance?.streaming?.terrainWorker;
  const rustTerrain = state?.performance?.streaming?.rustTerrain;
  const rustWorld = state?.performance?.streaming?.rustWorldAuthority;
  const host = runtime?.manager?.host;
  const adapter = host?.adapter;
  const nonNull = (label, value) => {
    if (value !== null && value !== undefined && value !== "") errors.push(`${label}: ${String(value)}`);
  };
  const nonZero = (label, value) => {
    if (typeof value === "number" && value !== 0) errors.push(`${label}: ${value}`);
  };
  nonNull("runtime.manager.lastError", runtime?.manager?.lastError);
  nonNull("runtime.manager.host.lastError", host?.lastError);
  nonNull("runtime.manager.host.adapter.lastError", adapter?.lastError);
  nonNull("runtime.manager.host.nativePersistence.lastError", host?.nativePersistence?.lastError);
  nonNull("runtime.playerAuthority.lastError", runtime?.playerAuthority?.lastError);
  nonNull("runtime.playerAuthority.pump.lastError", runtime?.playerAuthority?.pump?.lastError);
  nonNull("runtime.renderer.lastError", runtime?.renderer?.lastError);
  nonNull("runtime.renderer.runtime.lastError", runtime?.renderer?.runtime?.lastError);
  nonNull("runtime.renderer.publisher.lastError", runtime?.renderer?.publisher?.lastError);
  nonNull("runtime.multiplayer.lastError", runtime?.multiplayer?.lastError);
  nonNull("generationWorker.lastError", generation?.lastError);
  nonNull("terrainWorker.lastError", terrainWorker?.lastError);
  nonNull("rustTerrain.lastMismatch", rustTerrain?.lastMismatch);
  nonNull("rustWorldAuthority.lastFallbackReason", rustWorld?.lastFallbackReason);
  nonZero("runtime adapter failures", adapter?.failures);
  nonZero("runtime adapter rejected commands", adapter?.rejectedCommands);
  nonZero("runtime adapter indeterminate commands", adapter?.indeterminateCommands);
  nonZero("runtime adapter stale responses", adapter?.staleResponses);
  nonZero("native persistence parent fallbacks", host?.nativePersistence?.parentFallbacks);
  nonZero("generation failures", generation?.failed);
  nonZero("generation worker restarts", generation?.restarts);
  nonZero("generation rejections", generation?.rejected);
  nonZero("terrain worker failures", terrainWorker?.failed);
  nonZero("terrain worker restarts", terrainWorker?.restarts);
  nonZero("Rust terrain fallbacks", rustTerrain?.fallback);
  nonZero("Rust terrain parity mismatches", rustTerrain?.parityMismatches);
  nonZero("Rust terrain install failures", rustTerrain?.installFailures);
  nonZero("Rust world failures", rustWorld?.failures);
  nonZero("Rust world restarts", rustWorld?.restarts);
  nonZero("Rust multiplayer authority resyncs", runtime?.multiplayer?.authorityResyncs);
  nonZero("Rust multiplayer authority rejections", runtime?.multiplayer?.authorityRejections);
  return Object.freeze(errors);
}

export function assessRustMultiplayerVisualTerrainReadiness(snapshot, label = "browser") {
  const streaming = snapshot?.state?.performance?.streaming;
  const presentation = streaming?.playerTerrainPresentation;
  const generation = streaming?.generationWorker;
  const terrainWorker = streaming?.terrainWorker;
  const reasons = [];
  const add = (condition, reason) => { if (!condition) reasons.push(reason); };
  const runtimeErrors = collectRustMultiplayerRuntimeErrors(snapshot?.state, snapshot?.runtime);
  const authorityLastRejection = snapshot?.runtime?.multiplayer?.lastRejection ?? null;

  add(streaming?.playerChunkReady === true && streaming?.playerChunkStage === "ready", "player-chunk-not-ready");
  add(streaming?.immediateRing?.desired === 9
    && streaming.immediateRing.ready === 9
    && streaming.immediateRing.ratio === 1,
  "immediate-ring-not-ready");
  add(generation?.mode === "rust" && generation?.selectionSource === "build-rust-primary",
    "generation-authority-not-rust-primary");
  add(generation?.state === "ready"
    && generation?.supported === true
    && Number.isSafeInteger(generation?.workers)
    && generation.workers > 0
    && generation.ready === generation.workers,
  "generation-workers-not-ready");
  add(terrainWorker?.supported === true && terrainWorker?.ready === true,
    "terrain-buffer-worker-not-ready");
  add(presentation?.schema === 1, "player-terrain-presentation-schema-invalid");
  add(Number.isSafeInteger(presentation?.epoch) && presentation.epoch > 0,
    "player-terrain-presentation-epoch-invalid");
  add(typeof presentation?.centerKey === "string" && presentation.centerKey === streaming?.playerChunk,
    "player-terrain-presentation-center-mismatch");
  add(presentation?.desired === 9 && presentation?.ready === 9,
    "player-terrain-presentation-ring-not-ready");
  add(Array.isArray(presentation?.chunks) && presentation.chunks.length === 9,
    "player-terrain-presentation-chunks-invalid");

  const expectedOffsets = new Set([
    "-1,-1", "-1,0", "-1,1",
    "0,-1", "0,0", "0,1",
    "1,-1", "1,0", "1,1",
  ]);
  const observedOffsets = new Set();
  const stableChunks = [];
  if (Array.isArray(presentation?.chunks)) for (const chunk of presentation.chunks) {
    const offsetKey = `${chunk?.offset?.x},${chunk?.offset?.z}`;
    if (!expectedOffsets.has(offsetKey) || observedOffsets.has(offsetKey)) reasons.push(`terrain-chunk-offset-invalid:${offsetKey}`);
    observedOffsets.add(offsetKey);
    add(typeof chunk?.key === "string" && chunk.key.length > 0, `terrain-chunk-key-invalid:${offsetKey}`);
    add(chunk?.present === true && chunk?.visible === true && chunk?.lightReady === true && chunk?.ready === true,
      `terrain-chunk-not-presented:${chunk?.key ?? offsetKey}`);
    add(Array.isArray(chunk?.requiredSections) && chunk.requiredSections.length > 0,
      `terrain-chunk-required-sections-absent:${chunk?.key ?? offsetKey}`);
    let opaquePresented = false;
    const stableSections = [];
    if (Array.isArray(chunk?.requiredSections)) for (const section of chunk.requiredSections) {
      const sectionLabel = `${chunk?.key ?? offsetKey}:${section?.section ?? "unknown"}`;
      add(Number.isSafeInteger(section?.section), `terrain-section-index-invalid:${sectionLabel}`);
      add(section?.ready === true, `terrain-section-not-ready:${sectionLabel}`);
      add(Array.isArray(section?.requiredLayers), `terrain-section-required-layers-invalid:${sectionLabel}`);
      const layers = [];
      if (Array.isArray(section?.requiredLayers)) for (const layer of section.requiredLayers) {
        if (layer !== "opaque" && layer !== "cutout") {
          reasons.push(`terrain-layer-invalid:${sectionLabel}:${String(layer)}`);
          continue;
        }
        const layerPresentation = section?.presentations?.[layer];
        const sourcePresented = layerPresentation?.mode === "source"
          && layerPresentation.source === true
          && layerPresentation.sourceVisible === true;
        const combinedPresented = layerPresentation?.mode === "combined"
          && layerPresentation.combined === true
          && layerPresentation.combinedVisible === true;
        add(layerPresentation?.required === true && (sourcePresented || combinedPresented),
          `terrain-layer-not-visible:${sectionLabel}:${layer}`);
        if (layer === "opaque" && (sourcePresented || combinedPresented)) opaquePresented = true;
        layers.push(Object.freeze({ layer, mode: layerPresentation?.mode ?? null }));
      }
      stableSections.push(Object.freeze({ section: section?.section ?? null, layers: Object.freeze(layers) }));
    }
    add(opaquePresented, `terrain-chunk-opaque-not-visible:${chunk?.key ?? offsetKey}`);
    stableChunks.push(Object.freeze({
      key: chunk?.key ?? null,
      offset: offsetKey,
      sections: Object.freeze(stableSections),
    }));
  }
  add(observedOffsets.size === expectedOffsets.size
    && [...expectedOffsets].every((offset) => observedOffsets.has(offset)),
  "player-terrain-presentation-offset-ring-incomplete");
  for (const runtimeError of runtimeErrors) reasons.push(`runtime-error:${runtimeError}`);

  const fingerprintPayload = Object.freeze({
    epoch: presentation?.epoch ?? null,
    centerKey: presentation?.centerKey ?? null,
    generationEpoch: generation?.epoch ?? null,
    generationWorkers: generation?.workers ?? null,
    chunks: Object.freeze(stableChunks),
  });
  const terminal = Boolean(runtimeErrors.length > 0
    || generation?.state === "authority-unavailable"
    || (generation && generation.mode !== "rust")
    || (presentation && presentation.schema !== 1));
  return Object.freeze({
    schema: 1,
    label,
    ready: reasons.length === 0,
    terminal,
    reasons: Object.freeze(reasons),
    fingerprint: sha256Text(JSON.stringify(fingerprintPayload)),
    presentation: presentation ?? null,
    generation: generation ?? null,
    terrainWorker: terrainWorker ?? null,
    runtimeErrors,
    authorityLastRejection,
  });
}

export async function waitForRustMultiplayerVisualTerrainReadiness(page, timeoutMilliseconds, options = {}) {
  assertCondition(Number.isFinite(timeoutMilliseconds) && timeoutMilliseconds > 0,
    `Visual terrain readiness timeout is invalid: ${String(timeoutMilliseconds)}`);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readSnapshot = options.readSnapshot ?? readBrowserSnapshot;
  const pollMilliseconds = options.pollMilliseconds ?? 250;
  const stablePollsRequired = options.stablePolls ?? 4;
  const failureStage = options.failureStage ?? "terrain-readiness";
  assertCondition(Number.isSafeInteger(stablePollsRequired) && stablePollsRequired >= 3 && stablePollsRequired <= 12,
    `Visual terrain stable poll count is invalid: ${String(stablePollsRequired)}`);
  const started = now();
  let attempts = 0;
  let stablePolls = 0;
  let stableFingerprint = null;
  let assessment = null;
  while (now() - started <= timeoutMilliseconds) {
    attempts += 1;
    const snapshot = await readSnapshot(page);
    assessment = assessRustMultiplayerVisualTerrainReadiness(snapshot, options.label ?? "browser");
    options.onObservation?.(assessment);
    if (assessment.terminal) {
      const error = new Error(`Current-player visual terrain readiness failed: ${JSON.stringify(assessment)}`);
      error.code = "BLOCKWILD_VISUAL_TERRAIN_FAILURE";
      error.failureStage = failureStage;
      error.terrainReadinessEvidence = Object.freeze({ phase: failureStage, attempts, stablePolls, assessment });
      throw error;
    }
    if (assessment.ready) {
      if (assessment.fingerprint === stableFingerprint) stablePolls += 1;
      else {
        stableFingerprint = assessment.fingerprint;
        stablePolls = 1;
      }
      if (stablePolls >= stablePollsRequired) return Object.freeze({
        status: "ready",
        attempts,
        stablePolls,
        stablePollsRequired,
        phase: failureStage,
        elapsedMilliseconds: now() - started,
        assessment,
      });
    } else {
      stableFingerprint = null;
      stablePolls = 0;
    }
    await sleep(Math.min(pollMilliseconds, Math.max(1, timeoutMilliseconds - (now() - started))));
  }
  const error = new Error(`Current-player visual terrain readiness timed out: ${JSON.stringify(assessment)}`);
  error.code = "BLOCKWILD_VISUAL_TERRAIN_TIMEOUT";
  error.failureStage = failureStage;
  error.terrainReadinessEvidence = Object.freeze({ phase: failureStage, attempts, stablePolls, assessment });
  throw error;
}

export function assertRustMultiplayerR5PlayerAuthorityDiagnostics(
  snapshot,
  expectedArtifactHash = REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
  label = "R9+R5 browser checkpoint",
) {
  assertCondition(ARTIFACT_HASH_PATTERN.test(expectedArtifactHash), `${label}: expected artifact hash is invalid.`);
  const state = snapshot?.state;
  const runtime = snapshot?.runtime;
  const manager = runtime?.manager;
  const host = manager?.host;
  const adapter = host?.adapter;
  const authority = runtime?.playerAuthority;
  const pump = authority?.pump;
  assertCondition(state?.state === "playing", `${label}: gameplay is not active.`);
  assertCondition(runtime?.ready === true, `${label}: Rust runtime is not ready.`);
  assertCondition(runtime?.operationsBlocked === false, `${label}: Rust runtime operations are blocked.`);
  assertCondition(manager?.state === "ready", `${label}: Rust runtime manager is not ready.`);
  assertCondition(Number.isSafeInteger(runtime?.transitionGeneration) && runtime.transitionGeneration >= 1,
    `${label}: Rust runtime transition generation is invalid.`);
  assertCondition(Number.isSafeInteger(manager?.requestedGeneration) && manager.requestedGeneration >= 1,
    `${label}: Rust runtime manager request generation is invalid.`);
  assertCondition(Number.isSafeInteger(manager?.activeGeneration) && manager.activeGeneration >= 1
    && manager.activeGeneration <= manager.requestedGeneration,
  `${label}: Rust runtime manager active generation is invalid.`);
  assertCondition(host?.state === "ready", `${label}: Rust runtime host is not ready.`);
  assertCondition(host?.artifactHash === expectedArtifactHash,
    `${label}: expected artifact ${expectedArtifactHash}, received ${String(host?.artifactHash)}.`);
  assertCondition(adapter?.state === "ready"
    && adapter?.authoritative === true
    && adapter?.verification === "content-addressed-wasm"
    && adapter?.liveAuthorityReady === true,
  `${label}: Rust runtime adapter is not exact, authoritative, and live-ready.`);
  assertCondition(authority?.state === "ready", `${label}: R5 player authority is not ready.`);
  assertCondition(authority?.lastError === null, `${label}: R5 player authority lastError is ${String(authority?.lastError)}.`);
  assertCondition(authority?.worldGeneration === runtime.transitionGeneration,
    `${label}: R5 player authority generation is stale.`);
  assertCondition(typeof runtime?.activeSessionId === "string" && runtime.activeSessionId.length > 0,
    `${label}: active Rust runtime session is absent.`);
  assertCondition(authority?.runtimeSessionId === runtime.activeSessionId,
    `${label}: R5 player authority is bound to a different Rust runtime session.`);
  assertCondition(authority?.entityId !== null && authority?.entityId !== undefined,
    `${label}: R5 native player entity is absent.`);
  assertCondition(Number.isSafeInteger(authority?.terrainChunkCount) && authority.terrainChunkCount > 0,
    `${label}: R5 native player terrain residency is absent.`);
  assertCondition(pump?.state === "ready", `${label}: R5 live input pump is not ready.`);
  assertCondition(pump?.lastError === null, `${label}: R5 live input pump lastError is ${String(pump?.lastError)}.`);
  assertCondition(pump?.worldGeneration === runtime.transitionGeneration,
    `${label}: R5 live input pump generation is stale.`);
  assertCondition(Number.isSafeInteger(pump?.authoritativeFlags) && (pump.authoritativeFlags & 4) === 0,
    `${label}: R5 live input pump has invalid or unsupported authoritative flags.`);
  assertCondition(Number.isSafeInteger(pump?.lastAuthorityTick) && pump.lastAuthorityTick >= 0,
    `${label}: R5 live input pump authority tick is invalid.`);
  assertCondition(Number.isSafeInteger(pump?.nextInputSequence) && pump.nextInputSequence >= 0,
    `${label}: R5 live input pump input sequence is invalid.`);
  const runtimeErrors = collectRustMultiplayerRuntimeErrors(state, runtime);
  assertCondition(runtimeErrors.length === 0, `${label}: ${runtimeErrors.join(" | ")}`);
  return Object.freeze({
    artifactHash: host.artifactHash,
    transitionGeneration: runtime.transitionGeneration,
    playerAuthority: Object.freeze({
      state: authority.state,
      worldGeneration: authority.worldGeneration,
      runtimeSessionId: authority.runtimeSessionId,
      entityId: authority.entityId,
      terrainChunkCount: authority.terrainChunkCount,
    }),
    pump: Object.freeze({
      state: pump.state,
      worldGeneration: pump.worldGeneration,
      lastAuthorityTick: pump.lastAuthorityTick,
      nextInputSequence: pump.nextInputSequence,
      authoritativeFlags: pump.authoritativeFlags,
    }),
    operationsBlocked: runtime.operationsBlocked,
    runtimeErrors,
  });
}

export function assertRustMultiplayerR5PlayerAuthorityPair(hostSnapshot, guestSnapshot, label = "R9+R5 browser pair") {
  return Object.freeze({
    host: assertRustMultiplayerR5PlayerAuthorityDiagnostics(
      hostSnapshot,
      REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
      `${label} host`,
    ),
    guest: assertRustMultiplayerR5PlayerAuthorityDiagnostics(
      guestSnapshot,
      REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
      `${label} guest`,
    ),
  });
}

export function assertRustMultiplayerR5OutboundPoseDiagnostics(snapshot, expected = {}, label = "R9+R5 outbound pose") {
  const pose = snapshot?.runtime?.multiplayer?.lastOutboundPose;
  const pump = snapshot?.runtime?.playerAuthority?.pump;
  const decimalRevisionPattern = /^(0|[1-9][0-9]*)$/u;
  assertCondition(pose?.producer === "rust-live-player-view-r10-kinematics",
    `${label}: outbound pose was not produced from Rust live-player kinematics.`);
  assertCondition(typeof pose?.playerId === "string" && pose.playerId.length > 0,
    `${label}: outbound pose player identity is absent.`);
  if (expected.playerId !== undefined) {
    assertCondition(pose.playerId === expected.playerId, `${label}: outbound pose player identity changed.`);
  }
  assertCondition(Number.isSafeInteger(pose?.tick) && pose.tick >= 0,
    `${label}: outbound pose transport tick is invalid.`);
  if (expected.transportTick !== undefined) {
    assertCondition(pose.tick === expected.transportTick,
      `${label}: outbound pose transport tick differs from native pose custody.`);
  }
  const position = [pose?.position?.x, pose?.position?.y, pose?.position?.z];
  assertCondition(position.every(Number.isFinite), `${label}: outbound pose position is malformed.`);
  const velocity = [pose?.velocity?.x, pose?.velocity?.y, pose?.velocity?.z];
  assertCondition(velocity.every(Number.isFinite), `${label}: outbound pose velocity is malformed.`);
  assertCondition(Number.isFinite(pose?.yaw) && Number.isFinite(pose?.pitch),
    `${label}: outbound pose look projection is malformed.`);
  const nativeSource = pose?.nativeSource;
  for (const field of ["extractionRevision", "authorityTick", "entityRevision", "lastInputSequence"]) {
    assertCondition(decimalRevisionPattern.test(nativeSource?.[field] ?? ""),
      `${label}: outbound pose nativeSource.${field} is not an exact decimal revision.`);
  }
  assertCondition(Number.isSafeInteger(pump?.lastAuthorityTick) && pump.lastAuthorityTick >= 0,
    `${label}: R5 pump authority tick is unavailable.`);
  assertCondition(BigInt(nativeSource.authorityTick) === BigInt(pump.lastAuthorityTick),
    `${label}: outbound pose native authority tick differs from the exact R5 pump checkpoint.`);
  if (expected.position !== undefined) {
    assertCondition(Array.isArray(expected.position) && expected.position.length === 3
      && expected.position.every(Number.isFinite), `${label}: expected native-custody endpoint is malformed.`);
    assertCondition(Math.hypot(
      position[0] - expected.position[0],
      position[1] - expected.position[1],
      position[2] - expected.position[2],
    ) <= (expected.positionTolerance ?? 0.025),
    `${label}: outbound Rust-player position differs from the native pose-custody endpoint.`);
  }
  return Object.freeze({
    producer: pose.producer,
    playerId: pose.playerId,
    tick: pose.tick,
    position: Object.freeze([...position]),
    velocity: Object.freeze([...velocity]),
    nativeSource: Object.freeze({ ...nativeSource }),
    pumpAuthorityTick: pump.lastAuthorityTick,
  });
}

export function assertRustMultiplayerRuntimePair(hostRuntime, guestRuntime, signalPair, expected = {}) {
  const host = runtimeProof(hostRuntime);
  const guest = runtimeProof(guestRuntime);
  for (const [label, runtime] of [["host", host], ["guest", guest]]) {
    assertCondition(runtime.ready === true, `${label} Rust runtime is not ready.`);
    assertCondition(runtime.operationsBlocked === false, `${label} Rust runtime operations are blocked.`);
    assertCondition(runtime.managerState === "ready" && runtime.hostState === "ready", `${label} Rust runtime manager/host is not ready.`);
    assertCondition(runtime.artifactHash === REQUIRED_MULTIPLAYER_ARTIFACT_HASH, `${label} loaded unexpected artifact ${String(runtime.artifactHash)}.`);
    assertCondition(runtime.contentHash === signalPair.contentHash, `${label} content hash differs from the negotiated descriptor.`);
    assertCondition(runtime.activeSessionId === signalPair.sessionId, `${label} runtime session differs from the manual WebRTC session.`);
    assertCondition(runtime.activeUniverseId === signalPair.runtime?.universeId || runtime.activeUniverseId === expected.universeId, `${label} universe identity differs from the negotiated descriptor.`);
    assertCondition(runtime.activeLocationId === signalPair.runtime?.locationId || runtime.activeLocationId === expected.locationId, `${label} location identity differs from the negotiated descriptor.`);
    assertCondition(runtime.adapterState === "ready" && runtime.adapterAuthoritative === true, `${label} runtime adapter is not authoritative/ready.`);
    assertCondition(runtime.adapterVerification === "content-addressed-wasm" && runtime.liveAuthorityReady === true, `${label} runtime adapter lacks content-addressed live authority.`);
    assertCondition(runtime.multiplayer.authorityResyncs === 0, `${label} recorded a Rust authority resync.`);
    assertCondition(runtime.multiplayer.authorityRejections === 0, `${label} recorded a Rust authority rejection.`);
    assertCondition(runtime.multiplayer.lastError === null, `${label} Rust multiplayer lastError is ${String(runtime.multiplayer.lastError)}.`);
    assertCondition(runtime.multiplayer.recordProducer === "coarse-legacy-projection" && runtime.multiplayer.pendingNativeProducer === true,
      `${label} changed the bounded current multiplayer producer claim.`);
    const runtimeErrors = collectRustMultiplayerRuntimeErrors(null, label === "host" ? hostRuntime : guestRuntime);
    assertCondition(runtimeErrors.length === 0, `${label} runtime errors: ${runtimeErrors.join(" | ")}`);
  }
  assertCondition(host.multiplayer.authorityDeltaSequence >= (expected.minimumHostSequence ?? 1), "Host emitted no new Rust authority keyframe.");
  assertCondition(guest.multiplayer.authorityDeltaApplied >= (expected.minimumGuestApplied ?? 1), "Guest applied no new Rust authority keyframe.");
  assertCondition(CANONICAL_HASH_PATTERN.test(guest.multiplayer.lastStateHash ?? ""), "Guest has no accepted Rust authority state hash.");
  return Object.freeze({ host, guest });
}

export function assertRustMultiplayerReconnectProof(initial, reconnected) {
  assertCondition(initial?.signals?.sessionId === reconnected?.signals?.sessionId, "Reconnect changed the host WebRTC/Rust session.");
  assertCondition(initial?.signals?.token !== reconnected?.signals?.token, "Reconnect reused the prior one-shot invite token.");
  assertCondition(initial?.signals?.hostId === reconnected?.signals?.hostId, "Reconnect changed the host's stable character identity.");
  assertCondition(initial?.signals?.guestId === reconnected?.signals?.guestId, "Reconnect changed the guest's stable character identity.");
  assertCondition(initial?.signals?.contentHash === reconnected?.signals?.contentHash, "Reconnect changed the Rust content hash.");
  assertCondition(initial?.world?.seed === reconnected?.world?.seed && initial?.world?.mode === reconnected?.world?.mode, "Reconnect did not restore the same host world state.");
  assertCondition(initial?.world?.player?.health === reconnected?.world?.player?.health
    && initial?.world?.player?.hunger === reconnected?.world?.player?.hunger,
  "Reconnect did not restore the same guest session health/hunger state.");
  assertCondition(reconnected?.hostPeerCount === 1 && reconnected?.hostMapPins === 1, "Reconnect left a duplicate or missing host-side player record.");
  assertCondition(Number.isSafeInteger(reconnected?.hostAuthoritySequence) && reconnected.hostAuthoritySequence >= 1,
    "Reconnect did not emit a fresh connection-local Rust host keyframe.");
  assertCondition(Number.isSafeInteger(reconnected?.guestAuthorityApplied) && reconnected.guestAuthorityApplied >= 1,
    "Reconnect did not apply a fresh session-local Rust guest keyframe.");
  assertCondition(reconnected?.guestKeyframeAccepted === true
    && reconnected?.guestPresentationReady === true
    && Number.isSafeInteger(reconnected?.guestAcceptedDeltaCount)
    && reconnected.guestAcceptedDeltaCount >= 1,
  "Reconnect did not accept and present a fresh Rust guest keyframe.");
  assertCondition(CANONICAL_HASH_PATTERN.test(reconnected?.guestAuthorityStateHash ?? ""),
    "Reconnect fresh keyframe has no canonical Rust authority state hash.");
  assertRustMultiplayerReconnectPanelRouting(reconnected?.panelRouting);
  assertRustMultiplayerReconnectCommandContinuity(reconnected?.commandContinuity);
  return true;
}

export function assertRustMultiplayerReconnectPanelRouting(evidence) {
  assertCondition(evidence?.mode === "title-guest-reconnect",
    "Reconnect did not use the title guest direct-signaling route.");
  assertCondition(evidence?.continueLocalWorldUsed === false,
    "Reconnect used Continue/local-world hydration before direct signaling.");
  assertCondition(evidence?.host?.requestedKind === "session" && evidence?.host?.resolvedKind === "session",
    "Reconnect host did not remain on the in-world direct session panel.");
  assertCondition(evidence?.host?.observedSessionMultiplayer === true,
    "Reconnect host did not observe the in-world Multiplayer Session panel.");
  assertCondition(evidence?.guest?.requestedKind === "title" && evidence?.guest?.resolvedKind === "title",
    "Reconnect guest did not resolve the title Join Multiplayer panel.");
  assertCondition(evidence?.guest?.observedTitleMain === true
    && evidence?.guest?.actions?.includes("open-title-multiplayer")
    && evidence?.guest?.observedTitleMultiplayer === true,
  "Reconnect guest did not route from the title main menu into Join Multiplayer.");
  assertCondition(!evidence?.guest?.actions?.includes("continue-local-world")
    && !evidence?.guest?.actions?.includes("leave-title-multiplayer"),
  "Reconnect guest left the title route or restored a local world.");
  assertCondition(evidence?.guest?.joinOfferVisible === true,
    "Reconnect guest did not expose the title JOIN OFFER fallback.");
  assertCondition(evidence?.connected?.guest?.kind === "gameplay-runtime-connected"
    && evidence?.connected?.guest?.surface?.panelVisible === false,
  "Reconnect guest panel did not close into exact gameplay/runtime connectivity.");
  assertCondition(evidence?.connected?.guest?.surface?.runtime?.hydration === "guest-bootstrap",
    "Reconnect guest used local-world hydration instead of guest bootstrap.");
  return true;
}

export function compactRustMultiplayerAuthorityCommandEvidence(snapshot, peerId) {
  const transport = snapshot?.runtime?.multiplayer?.transport;
  const peers = Array.isArray(transport?.peers) ? transport.peers : [];
  const peer = peers.find((candidate) => candidate?.peerId === peerId) ?? null;
  return Object.freeze({
    transportState: transport?.state ?? null,
    transportRole: transport?.role ?? null,
    authorityMode: transport?.authorityMode ?? null,
    authorityOperations: Number.isSafeInteger(transport?.authorityOperations) ? transport.authorityOperations : null,
    outboundAuthorityCommandSequence: Number.isSafeInteger(transport?.outbound?.authorityCommandSequence)
      ? transport.outbound.authorityCommandSequence
      : null,
    guestPresentationReady: transport?.guest?.presentationReady ?? null,
    peer: peer ? Object.freeze({
      peerId: peer.peerId ?? null,
      state: peer.state ?? null,
      authorityQueued: Number.isSafeInteger(peer.authorityQueued) ? peer.authorityQueued : null,
      authorityInFlight: Number.isSafeInteger(peer.authorityInFlight) ? peer.authorityInFlight : null,
      authorityAccepted: Number.isSafeInteger(peer.authorityAccepted) ? peer.authorityAccepted : null,
      authorityRejected: Number.isSafeInteger(peer.authorityRejected) ? peer.authorityRejected : null,
      authorityErrors: Number.isSafeInteger(peer.authorityErrors) ? peer.authorityErrors : null,
      protocolStrikes: Number.isSafeInteger(peer.protocolStrikes) ? peer.protocolStrikes : null,
      authorityGeneration: Number.isSafeInteger(peer.authorityGeneration) ? peer.authorityGeneration : null,
      nativePoseAccepted: Number.isSafeInteger(peer.nativePoseAccepted) ? peer.nativePoseAccepted : null,
      nativePoseDelivered: Number.isSafeInteger(peer.nativePoseDelivered) ? peer.nativePoseDelivered : null,
      nativePoseStaleGenerationDrops: Number.isSafeInteger(peer.nativePoseStaleGenerationDrops)
        ? peer.nativePoseStaleGenerationDrops
        : null,
      lastNativePoseCommandSequence: Number.isSafeInteger(peer.lastNativePoseCommandSequence)
        ? peer.lastNativePoseCommandSequence
        : null,
      lastNativePoseRecordRevision: Number.isSafeInteger(peer.lastNativePoseRecordRevision)
        ? peer.lastNativePoseRecordRevision
        : null,
      lastNativePoseReceiptHash: CANONICAL_HASH_PATTERN.test(peer.lastNativePoseReceiptHash ?? "")
        ? peer.lastNativePoseReceiptHash
        : null,
      lastNativePoseRecordHash: CANONICAL_HASH_PATTERN.test(peer.lastNativePoseRecordHash ?? "")
        ? peer.lastNativePoseRecordHash
        : null,
      lastInboundType: peer.lastInboundType ?? null,
      lastInboundAuthoritySequence: Number.isSafeInteger(peer.lastInboundAuthoritySequence)
        ? peer.lastInboundAuthoritySequence
        : null,
    }) : null,
  });
}

export function assertRustMultiplayerReconnectCommandContinuity(continuity) {
  assertCondition(continuity?.schema === 1, "Reconnect command-continuity proof schema is malformed.");
  const initial = continuity?.initialHostObserved;
  const initialSequence = initial?.finalAcceptedAuthoritySequence;
  assertCondition(initial?.transportRole === "host"
    && initial?.authorityMode === "rust-authoritative"
    && initial?.peer?.peerId === GUEST_PROFILE.networkId
    && Number.isSafeInteger(initialSequence)
    && initialSequence >= 0,
  "Reconnect command-continuity proof has no final host-observed initial authority sequence.");
  assertCondition(initial?.authorityOperations === 0
    && initial.peer.authorityInFlight === 0
    && initial.peer.authorityAccepted === initialSequence + 1
    && initial.peer.authorityQueued === initial.peer.authorityAccepted
    && initial.peer.authorityRejected === 0
    && initial.peer.authorityErrors === 0
    && initial.peer.protocolStrikes === 0,
  "Initial host authority command stream was not quiescent and clean before disconnect.");
  const initialBoundary = continuity?.initialCommandBoundary;
  const initialTail = initialBoundary?.tail;
  assertCondition(Number.isSafeInteger(initialBoundary?.auditCount)
    && initialBoundary.auditCount >= 1
    && Number.isSafeInteger(initialBoundary?.lastAuthoritySequence)
    && initialBoundary.lastAuthoritySequence >= initialSequence
    && Array.isArray(initialTail)
    && initialTail.length >= 1
    && initialTail.length <= 64
    && initialTail.at(-1)?.authoritySequence === initialBoundary.lastAuthoritySequence,
  "Reconnect command-continuity proof has no bounded post-drain initial command boundary.");
  for (const [index, record] of initialTail.entries()) {
    const previous = initialTail[index - 1];
    assertCondition(typeof record?.type === "string" && record.type.length > 0
      && Number.isSafeInteger(record.authoritySequence)
      && (index === 0 || record.authoritySequence === previous.authoritySequence + 1)
      && record.from === GUEST_PROFILE.networkId
      && record.transportRole === "guest"
      && record.guestPresentationReady === true,
    "Initial post-drain command tail is not dense, guest-authored, and presentation-ready.");
  }
  const expectedCursor = initialBoundary.lastAuthoritySequence + 1;
  assertCondition(continuity?.reconnectCursor === expectedCursor,
    "Reconnect command cursor is not the successor of the final host-observed initial sequence.");
  const commands = continuity?.commands;
  assertCondition(Array.isArray(commands) && commands.length >= 2,
    "Reconnect command-continuity proof has no bounded post-reconnect command stream.");
  for (const [index, record] of commands.entries()) {
    const expectedSequence = expectedCursor + index;
    assertCondition(typeof record?.type === "string" && record.type.length > 0
      && record.authoritySequence === expectedSequence
      && record.from === GUEST_PROFILE.networkId
      && record.transportRole === "guest"
      && record.guestPresentationReady === true,
    `Reconnect command ${index + 1} did not continue densely at ${expectedSequence} after presentation readiness.`);
  }
  const observedPoseSequences = commands
    .filter((record) => record.type === "player-pose")
    .map((record) => record.authoritySequence);
  assertCondition(observedPoseSequences.length >= 2
    && JSON.stringify(continuity?.poseAuthoritySequences) === JSON.stringify(observedPoseSequences),
  "Reconnect command stream did not retain at least two exact pose heartbeat sequences.");
  const hostObserved = continuity?.reconnectHostObserved;
  assertCondition(hostObserved?.transportRole === "host"
    && hostObserved?.authorityMode === "rust-authoritative"
    && hostObserved?.authorityOperations === 0
    && hostObserved?.peer?.peerId === GUEST_PROFILE.networkId
    && hostObserved.peer.authorityQueued === commands.length
    && hostObserved.peer.authorityInFlight === 0
    && hostObserved.peer.authorityAccepted === commands.length
    && hostObserved.peer.authorityRejected === 0
    && hostObserved.peer.authorityErrors === 0
    && hostObserved.peer.protocolStrikes === 0,
  "Reconnect host did not accept the entire dense command stream without rejection or error.");
  assertCondition(continuity?.guestFinalAuthorityCommandSequence === expectedCursor + commands.length,
    "Reconnect guest final cursor does not follow the complete dense command stream.");
  return true;
}

export function assertRustMultiplayerStateTransfer(hostWorld, guestWorld, guestLocalWorld) {
  assertCondition(typeof hostWorld?.seed === "string" && hostWorld.seed.length > 0, "Host world state has no seed.");
  assertCondition(typeof guestLocalWorld?.seed === "string" && guestLocalWorld.seed !== hostWorld.seed,
    "Guest fixture must begin in a distinct local world before transfer.");
  assertCondition(guestWorld?.seed === hostWorld.seed, "Guest did not adopt the host world seed.");
  assertCondition(guestWorld?.mode === hostWorld.mode, "Guest did not adopt the host authoritative mode.");
  assertCondition(guestWorld?.weather === hostWorld.weather, "Guest did not adopt the host weather state.");
  return true;
}

export function assertLocalOnlyRtcConfigurations(configurations, label = "browser") {
  assertCondition(Array.isArray(configurations) && configurations.length > 0, `${label} created no RTCPeerConnection.`);
  for (const [index, configuration] of configurations.entries()) {
    assertCondition(Array.isArray(configuration?.iceServers) && configuration.iceServers.length === 0,
      `${label} RTCPeerConnection ${index} retained an external ICE server.`);
  }
  return true;
}

export function isExpectedLocalMusicCancellation(event, managedOrigin) {
  try {
    const origin = new URL(managedOrigin);
    const request = new URL(event?.url);
    return origin.protocol === "http:"
      && origin.hostname === "127.0.0.1"
      && origin.username === ""
      && origin.password === ""
      && origin.pathname === "/"
      && origin.search === ""
      && origin.hash === ""
      && request.origin === origin.origin
      && request.username === ""
      && request.password === ""
      && /^\/music\/[A-Za-z0-9][A-Za-z0-9._-]*\.mp3$/u.test(request.pathname)
      && request.search === ""
      && request.hash === ""
      && event?.method === "GET"
      && event?.resourceType === "media"
      && event?.failure === "net::ERR_ABORTED";
  } catch {
    return false;
  }
}

export function isExpectedManagedViteWebSocket(event, managedOrigin) {
  try {
    const origin = new URL(managedOrigin);
    const socket = new URL(event?.url);
    const queryKeys = [...socket.searchParams.keys()];
    return origin.protocol === "http:"
      && origin.hostname === "127.0.0.1"
      && origin.username === ""
      && origin.password === ""
      && origin.pathname === "/"
      && origin.search === ""
      && origin.hash === ""
      && socket.protocol === "ws:"
      && socket.hostname === origin.hostname
      && socket.port === origin.port
      && socket.username === ""
      && socket.password === ""
      && socket.pathname === "/"
      && socket.hash === ""
      && queryKeys.length === 1
      && queryKeys[0] === "token"
      && /^[A-Za-z0-9_-]{8,128}$/u.test(socket.searchParams.get("token") ?? "");
  } catch {
    return false;
  }
}

export function assertRustMultiplayerBrowserErrorStreams(streams) {
  for (const key of [
    "consoleErrors",
    "pageErrors",
    "runtimeErrors",
    "httpErrors",
    "externalRequests",
    "webSockets",
    "expectedRequestCancellations",
    "managedViteWebSockets",
  ]) {
    assertCondition(Array.isArray(streams[key]), `${key} must be an array.`);
  }
  assertCondition(streams.consoleErrors.length === 0, `Browser emitted ${streams.consoleErrors.length} console errors.`);
  assertCondition(streams.pageErrors.length === 0, `Browser emitted ${streams.pageErrors.length} page errors.`);
  assertCondition(streams.runtimeErrors.length === 0, `Runtime emitted ${streams.runtimeErrors.length} errors.`);
  assertCondition(streams.httpErrors.length === 0, `Browser observed ${streams.httpErrors.length} failed HTTP responses/requests.`);
  assertCondition(streams.externalRequests.length === 0, `Browser attempted ${streams.externalRequests.length} unapproved external requests.`);
  assertCondition(streams.webSockets.length === 0, `Browser opened ${streams.webSockets.length} unexpected WebSockets; direct acceptance permits no rendezvous signaling.`);
  for (const event of streams.expectedRequestCancellations) {
    assertCondition(isExpectedLocalMusicCancellation(event, event?.managedOrigin), "Expected-request evidence contains a non-music or non-local cancellation.");
  }
  for (const event of streams.managedViteWebSockets) {
    assertCondition(isExpectedManagedViteWebSocket(event, event?.managedOrigin), "Managed-Vite evidence contains a non-control WebSocket.");
  }
  return true;
}

function boundedPush(target, value) {
  if (target.length < MAX_EVIDENCE_EVENTS) target.push(Object.freeze(value));
  else if (target.length === MAX_EVIDENCE_EVENTS) target.push(Object.freeze({ truncated: true, retained: MAX_EVIDENCE_EVENTS }));
}

function contentType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function resolveCanonicalAsset(repositoryRoot, requestUrl) {
  const relative = CANONICAL_ASSETS.get(requestUrl);
  if (!relative) return null;
  const publicRoot = realpathSync(path.join(repositoryRoot, "public"));
  let cursor = path.join(publicRoot, ...relative.split("/"));
  if (!existsSync(cursor)) fail(`Managed canonical asset is missing: ${cursor}`);
  cursor = realpathSync(cursor);
  if (!pathIsInside(publicRoot, cursor) || lstatSync(cursor).isSymbolicLink() || !statSync(cursor).isFile()) {
    fail(`Managed canonical asset is not a regular file beneath public/: ${cursor}`);
  }
  return Object.freeze({ filePath: cursor, contentType: contentType(cursor), relative });
}

function playwrightCandidates(explicitPath) {
  return [
    explicitPath,
    "playwright",
    path.join(os.homedir(), ".codex", "skills", "develop-web-game", "scripts", "node_modules", "playwright", "index.mjs"),
  ].filter(Boolean);
}

async function loadPlaywright(explicitPath) {
  const failures = [];
  for (const candidate of playwrightCandidates(explicitPath)) {
    try {
      const loadedModule = await import(path.isAbsolute(candidate) ? pathToFileURL(candidate).href : candidate);
      if (loadedModule.chromium) return Object.freeze({ module: loadedModule, source: candidate });
      failures.push(`${candidate}: no chromium export`);
    } catch (error) { failures.push(`${candidate}: ${error.code ?? error.message}`); }
  }
  fail("A local Playwright runtime is required; this verifier never downloads dependencies.", { failures });
}

function discoverBrowserExecutable(explicitPath) {
  if (explicitPath) {
    if (!existsSync(explicitPath) || !statSync(explicitPath).isFile()) fail(`Browser executable does not exist: ${explicitPath}`);
    return explicitPath;
  }
  const candidates = process.platform === "win32" ? [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ] : [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function profileCatalog(profile) {
  const skills = { melee: 2, ranged: 2, mining: 2, crafting: 2, survival: 2, husbandry: 2, exploration: 2, magic: 2, bartering: 2, luck: 2 };
  return {
    schema: 1,
    browserId: profile.browserId,
    selectedProfileId: profile.profileId,
    profiles: [{
      schema: 1,
      id: profile.profileId,
      browserId: profile.browserId,
      name: profile.name,
      appearance: { sex: "male", race: "wayfarer", colors: { skin: "#c98f6b", hair: "#4d3424", shirt: "#3f7fba", trousers: "#293554", accent: "#f0c85b" } },
      startingSkills: skills,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    }],
  };
}

async function configureFreshContext(context, profile) {
  await context.addInitScript((input) => {
    localStorage.setItem("blockwild-browser-player-id-v1", input.profile.browserId);
    localStorage.setItem("blockwild-character-profiles-v1", JSON.stringify(input.catalog));
    localStorage.setItem("blockwild-settings-v2", JSON.stringify({
      renderDistance: 2,
      simulationDistance: 2,
      basicRenderDistance: 2,
      rememberedBasicRenderDistance: 2,
      resourceMode: "cpu",
      muted: true,
    }));
    const webglProbe = {
      schema: 1,
      webglRenderingContextType: typeof window.WebGLRenderingContext,
      webgl2RenderingContextType: typeof window.WebGL2RenderingContext,
      attempted: false,
      available: false,
      kind: null,
      contextLost: null,
      vendor: null,
      renderer: null,
      version: null,
      shadingLanguageVersion: null,
      error: null,
    };
    try {
      webglProbe.attempted = true;
      const canvas = document.createElement("canvas");
      const contextOptions = { alpha: false, antialias: false, failIfMajorPerformanceCaveat: false };
      const gl = canvas.getContext("webgl2", contextOptions) ?? canvas.getContext("webgl", contextOptions);
      if (gl) {
        webglProbe.available = true;
        webglProbe.kind = typeof window.WebGL2RenderingContext === "function" && gl instanceof window.WebGL2RenderingContext
          ? "webgl2"
          : "webgl";
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        webglProbe.vendor = String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR) ?? "");
        webglProbe.renderer = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) ?? "");
        webglProbe.version = String(gl.getParameter(gl.VERSION) ?? "");
        webglProbe.shadingLanguageVersion = String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION) ?? "");
        webglProbe.contextLost = gl.isContextLost();
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    } catch (error) {
      webglProbe.error = error instanceof Error ? error.message : String(error);
    }
    Object.defineProperty(window, "__blockwildRustMultiplayerBootstrapProbe", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze(webglProbe),
    });
    const NativeWorker = window.Worker;
    const generationWorkerCreations = [];
    const generationReadyMessages = [];
    const generationWorkerTerminations = [];
    const generationStartupErrors = [];
    const outboundAuthorityCommands = [];
    const outboundPlayerPoses = [];
    const runtimeLifecycle = [];
    let runtimeLifecycleSignature = "";
    const dataChannelPrototype = window.RTCDataChannel?.prototype;
    const nativeDataChannelSend = dataChannelPrototype?.send;
    let dataChannelSendInstrumentation = false;
    let auditedDataChannelSend = null;
    let auditedWorker = null;
    if (typeof nativeDataChannelSend === "function") {
      auditedDataChannelSend = function (data) {
        let commandRecord = null;
        let poseRecord = null;
        if (typeof data === "string") {
          try {
            const envelope = JSON.parse(data);
            let transport = null;
            if (envelope?.version === 3 && Number.isSafeInteger(envelope.authoritySequence)
              && envelope.authoritySequence >= 0) {
              try {
                transport = typeof window.render_rust_runtime_to_text === "function"
                  ? JSON.parse(window.render_rust_runtime_to_text())?.multiplayer?.transport ?? null
                  : null;
              } catch { /* Runtime diagnostics are optional during teardown. */ }
              commandRecord = {
                type: typeof envelope.type === "string" ? envelope.type : null,
                sequence: Number.isSafeInteger(envelope.sequence) ? envelope.sequence : null,
                authoritySequence: envelope.authoritySequence,
                from: typeof envelope.from === "string" ? envelope.from : null,
                transportRole: transport?.role ?? null,
                guestPresentationReady: transport?.guest?.presentationReady ?? null,
              };
            }
            if (envelope?.version === 3 && envelope.type === "player-pose") {
              const payload = envelope.payload;
              poseRecord = {
                sequence: envelope.sequence,
                authoritySequence: envelope.authoritySequence ?? null,
                sentAt: envelope.sentAt,
                from: envelope.from,
                playerId: payload?.playerId ?? null,
                tick: payload?.tick ?? null,
                position: [payload?.x, payload?.y, payload?.z],
                yaw: payload?.yaw ?? null,
                pitch: payload?.pitch ?? null,
                selected: payload?.selected ?? null,
                transportRole: transport?.role ?? null,
                guestPresentationReady: transport?.guest?.presentationReady ?? null,
              };
            }
          } catch { /* Non-JSON channels are outside the pose audit. */ }
        }
        const result = nativeDataChannelSend.call(this, data);
        if (commandRecord) {
          outboundAuthorityCommands.push(commandRecord);
          if (outboundAuthorityCommands.length > 512) outboundAuthorityCommands.shift();
        }
        if (poseRecord) {
          outboundPlayerPoses.push(poseRecord);
          if (outboundPlayerPoses.length > 256) outboundPlayerPoses.shift();
        }
        return result;
      };
      Object.defineProperty(dataChannelPrototype, "send", {
        configurable: true,
        writable: true,
        value: auditedDataChannelSend,
      });
      dataChannelSendInstrumentation = dataChannelPrototype.send === auditedDataChannelSend;
    }
    const audit = Object.freeze({
      schema: input.audit.schema,
      sentinel: input.audit.sentinel,
      workerInstrumentation: typeof NativeWorker === "function",
      dataChannelSendInstrumentation,
      snapshot: () => ({
        schema: input.audit.schema,
        sentinel: input.audit.sentinel,
        workerInstrumentation: typeof NativeWorker === "function",
        dataChannelSendInstrumentation,
        workerStillInstalled: auditedWorker !== null && window.Worker === auditedWorker,
        dataChannelSendStillInstalled: auditedDataChannelSend !== null && dataChannelPrototype?.send === auditedDataChannelSend,
        generationWorkerCreations: structuredClone(generationWorkerCreations),
        generationReadyMessages: structuredClone(generationReadyMessages),
        generationWorkerTerminations: structuredClone(generationWorkerTerminations),
        generationStartupErrors: structuredClone(generationStartupErrors),
        outboundAuthorityCommands: structuredClone(outboundAuthorityCommands),
        outboundPlayerPoses: structuredClone(outboundPlayerPoses),
        runtimeLifecycle: structuredClone(runtimeLifecycle),
      }),
    });
    Object.defineProperty(window, "__blockwildRustMultiplayerGenerationAudit", {
      value: audit,
      configurable: false,
      writable: false,
      enumerable: false,
    });
    const recordRuntimeLifecycle = () => {
      try {
        if (typeof window.render_game_to_text !== "function" || typeof window.render_rust_runtime_to_text !== "function") return;
        const state = JSON.parse(window.render_game_to_text());
        const runtime = JSON.parse(window.render_rust_runtime_to_text());
        const entry = {
          at: Date.now(),
          elapsedMilliseconds: Math.round(performance.now()),
          visibility: document.visibilityState,
          gameState: state?.state ?? null,
          worldSeed: state?.world?.seed ?? null,
          multiplayerStatus: state?.multiplayer?.status ?? null,
          multiplayerRole: state?.multiplayer?.role ?? null,
          multiplayerError: state?.multiplayer?.error ?? null,
          runtimeReady: runtime?.ready ?? null,
          operationsBlocked: runtime?.operationsBlocked ?? null,
          transitionGeneration: runtime?.transitionGeneration ?? null,
          activeWorldId: runtime?.activeWorldId ?? null,
          activeUniverseId: runtime?.activeUniverseId ?? null,
          activeLocationId: runtime?.activeLocationId ?? null,
          activeSessionId: runtime?.activeSessionId ?? null,
          nativePersistenceWorldId: runtime?.nativePersistenceWorldId ?? null,
          hydration: runtime?.hydration ?? null,
          managerState: runtime?.manager?.state ?? null,
          managerRequestedGeneration: runtime?.manager?.requestedGeneration ?? null,
          managerActiveGeneration: runtime?.manager?.activeGeneration ?? null,
          managerHostState: runtime?.manager?.host?.state ?? null,
          managerHostAdapterState: runtime?.manager?.host?.adapter?.state ?? null,
          managerHostAdapterRequests: runtime?.manager?.host?.adapter?.requests ?? null,
          managerHostAdapterFailures: runtime?.manager?.host?.adapter?.failures ?? null,
          managerHostAdapterLastError: runtime?.manager?.host?.adapter?.lastError ?? null,
          nativePersistenceState: runtime?.manager?.host?.nativePersistence?.state ?? null,
          nativePersistenceSaves: runtime?.manager?.host?.nativePersistence?.saves ?? null,
          nativePersistenceRecoveries: runtime?.manager?.host?.nativePersistence?.recoveries ?? null,
          nativePersistencePlatformOperations: runtime?.manager?.host?.nativePersistence?.platformOperations ?? null,
          nativePersistenceRequestBytes: runtime?.manager?.host?.nativePersistence?.requestBytes ?? null,
          nativePersistenceResponseBytes: runtime?.manager?.host?.nativePersistence?.responseBytes ?? null,
          nativePersistenceLastCheckpointId: runtime?.manager?.host?.nativePersistence?.lastCheckpointId ?? null,
          nativePersistenceLastError: runtime?.manager?.host?.nativePersistence?.lastError ?? null,
          playerAuthorityState: runtime?.playerAuthority?.state ?? null,
          playerAuthorityWorldGeneration: runtime?.playerAuthority?.worldGeneration ?? null,
          playerAuthorityPumpState: runtime?.playerAuthority?.pump?.state ?? null,
          playerAuthorityPumpLastError: runtime?.playerAuthority?.pump?.lastError ?? null,
          authorityDeltaSequence: runtime?.multiplayer?.authorityDeltaSequence ?? null,
          authorityDeltaApplied: runtime?.multiplayer?.authorityDeltaApplied ?? null,
          authorityRejections: runtime?.multiplayer?.authorityRejections ?? null,
          authorityResyncs: runtime?.multiplayer?.authorityResyncs ?? null,
          authorityLastError: runtime?.multiplayer?.lastError ?? null,
          transportState: runtime?.multiplayer?.transport?.state ?? null,
        };
        const signature = JSON.stringify({ ...entry, at: 0, elapsedMilliseconds: 0 });
        if (signature === runtimeLifecycleSignature) return;
        runtimeLifecycleSignature = signature;
        runtimeLifecycle.push(entry);
        if (runtimeLifecycle.length > 256) runtimeLifecycle.shift();
      } catch { /* Runtime globals are intentionally absent during bootstrap and teardown. */ }
    };
    window.setInterval(recordRuntimeLifecycle, 25);
    recordRuntimeLifecycle();
    if (typeof NativeWorker === "function") {
      const AuditedWorker = function (...args) {
        const worker = Reflect.construct(NativeWorker, args, new.target || NativeWorker);
        const workerUrl = String(args[0]);
        if (workerUrl.includes("terrain-generation-worker")) {
          const ordinal = generationWorkerCreations.length + 1;
          let ready = false;
          let postedMessages = 0;
          let terminated = false;
          generationWorkerCreations.push({
            ordinal,
            url: workerUrl,
            type: args[1]?.type ?? null,
            name: args[1]?.name ?? null,
          });
          worker.addEventListener("message", (event) => {
            const message = event.data;
            if (message?.type === "terrain-generation-ready-v2") {
              ready = true;
              generationReadyMessages.push({
                ordinal,
                workerUrl,
                type: message.type,
                protocolVersion: message.protocolVersion,
                requestSchemaVersion: message.requestSchemaVersion,
                resultSchemaVersion: message.resultSchemaVersion,
                backend: message.backend,
                certificate: structuredClone(message.certificate ?? null),
              });
            } else if (message?.type === "terrain-generation-startup-error-v2") {
              generationStartupErrors.push({ ordinal, workerUrl, message: String(message.message ?? "") });
            }
          });
          const nativePostMessage = worker.postMessage;
          Object.defineProperty(worker, "postMessage", {
            configurable: true,
            writable: true,
            value: function (...messageArgs) {
              postedMessages += 1;
              return Reflect.apply(nativePostMessage, worker, messageArgs);
            },
          });
          const nativeTerminate = worker.terminate;
          Object.defineProperty(worker, "terminate", {
            configurable: true,
            writable: true,
            value: function () {
              if (!terminated) {
                terminated = true;
                generationWorkerTerminations.push({ ordinal, ready, postedMessages });
              }
              return Reflect.apply(nativeTerminate, worker, []);
            },
          });
        }
        return worker;
      };
      AuditedWorker.prototype = NativeWorker.prototype;
      Object.setPrototypeOf(AuditedWorker, NativeWorker);
      Object.defineProperty(AuditedWorker, "name", { value: "Worker" });
      Object.defineProperty(window, "Worker", { configurable: true, writable: true, value: AuditedWorker });
      auditedWorker = AuditedWorker;
    }
    const NativePeerConnection = window.RTCPeerConnection;
    const configurations = [];
    Object.defineProperty(window, "__blockwildRustMultiplayerRtcConfigurations", { configurable: false, value: configurations });
    if (typeof NativePeerConnection === "function") {
      class LocalOnlyPeerConnection extends NativePeerConnection {
        constructor(configuration = {}) {
          const localOnly = { ...configuration, iceServers: [] };
          super(localOnly);
          configurations.push({ iceServers: [], bundlePolicy: localOnly.bundlePolicy ?? null });
        }
      }
      Object.defineProperty(window, "RTCPeerConnection", { configurable: true, writable: true, value: LocalOnlyPeerConnection });
    }
  }, {
    profile,
    catalog: profileCatalog(profile),
    audit: { schema: GENERATION_AUDIT_SCHEMA, sentinel: GENERATION_AUDIT_SENTINEL },
  });
}

async function installNetworkGuard(context, baseUrl, repositoryRoot, streams, canonicalAssetRequests, collectionState) {
  const allowedOrigin = new URL(baseUrl).origin;
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    let parsed;
    try { parsed = new URL(requestUrl); } catch {
      boundedPush(streams.externalRequests, { url: requestUrl, reason: "invalid-url" });
      await route.abort("blockedbyclient");
      return;
    }
    if (parsed.origin === allowedOrigin || parsed.protocol === "blob:" || parsed.protocol === "data:") {
      await route.continue();
      return;
    }
    const asset = resolveCanonicalAsset(repositoryRoot, requestUrl);
    if (asset) {
      boundedPush(canonicalAssetRequests, { url: requestUrl, path: asset.relative, status: 200 });
      await route.fulfill({
        status: 200,
        contentType: asset.contentType,
        headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "cross-origin" },
        body: readFileSync(asset.filePath),
      });
      return;
    }
    if (collectionState.active) boundedPush(streams.externalRequests, { url: requestUrl, resourceType: route.request().resourceType() });
    await route.abort("blockedbyclient");
  });
}

function attachPageGuards(page, label, streams, collectionState, managedOrigin, lifecycle) {
  lifecycle.attachedAt = new Date().toISOString();
  const recordLifecycle = (type) => {
    let url = null;
    try { url = page.url(); } catch { /* A crashed page may no longer expose a URL. */ }
    boundedPush(lifecycle.events, { type, at: new Date().toISOString(), url });
  };
  page.on("domcontentloaded", () => recordLifecycle("domcontentloaded"));
  page.on("load", () => recordLifecycle("load"));
  page.on("crash", () => {
    lifecycle.crashed = true;
    recordLifecycle("crash");
  });
  page.on("close", () => {
    lifecycle.closed = true;
    recordLifecycle("close");
  });
  page.on("console", (message) => {
    if (!collectionState.active || message.type() !== "error") return;
    const location = message.location();
    boundedPush(streams.consoleErrors, { label, text: message.text(), url: location?.url ?? null, lineNumber: location?.lineNumber ?? null });
  });
  page.on("pageerror", (error) => {
    if (!collectionState.active) return;
    boundedPush(streams.pageErrors, { label, name: error?.name ?? null, message: error?.message ?? String(error), stack: error?.stack ?? null });
  });
  page.on("response", (response) => {
    if (!collectionState.active || response.status() < 400) return;
    const request = response.request();
    boundedPush(streams.httpErrors, {
      label,
      url: response.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
    });
  });
  page.on("requestfailed", (request) => {
    if (!collectionState.active) return;
    const event = {
      label,
      managedOrigin,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText ?? "request-failed",
    };
    if (isExpectedLocalMusicCancellation(event, managedOrigin)) boundedPush(streams.expectedRequestCancellations, event);
    else boundedPush(streams.httpErrors, event);
  });
  page.on("websocket", (socket) => {
    if (!collectionState.active) return;
    const event = { label, managedOrigin, url: socket.url() };
    if (isExpectedManagedViteWebSocket(event, managedOrigin)) boundedPush(streams.managedViteWebSockets, event);
    else boundedPush(streams.webSockets, event);
  });
}

async function readBrowserSnapshot(page) {
  return page.evaluate(() => {
    const parse = (name) => {
      const renderer = window[name];
      if (typeof renderer !== "function") return null;
      try { return JSON.parse(renderer()); } catch { return null; }
    };
    let catalog = null;
    try { catalog = JSON.parse(localStorage.getItem("blockwild-character-profiles-v1") ?? "null"); } catch { catalog = null; }
    const generationAuditDescriptor = Object.getOwnPropertyDescriptor(window, "__blockwildRustMultiplayerGenerationAudit");
    const generationAudit = window.__blockwildRustMultiplayerGenerationAudit?.snapshot?.() ?? null;
    return {
      state: parse("render_game_to_text"),
      runtime: parse("render_rust_runtime_to_text"),
      buildProfile: document.querySelector("main.game-shell")?.getAttribute("data-worldgen-build-profile") ?? null,
      rtcConfigurations: structuredClone(window.__blockwildRustMultiplayerRtcConfigurations ?? []),
      characterCatalog: catalog,
      generationAudit: structuredClone(generationAudit),
      generationAuditDescriptor: generationAuditDescriptor ? {
        configurable: generationAuditDescriptor.configurable,
        writable: generationAuditDescriptor.writable,
        enumerable: generationAuditDescriptor.enumerable,
      } : null,
    };
  });
}

function assertOptionalR5PlayerAuthorityRoutes(options, phase, pages) {
  if (options?.requireR5PlayerAuthority !== true) return;
  for (const [label, page] of pages) {
    assertRustMultiplayerR5RouteSelector(page.url(), `${label} ${phase}`);
  }
}

function harnessStreamSnapshot(streams, label) {
  if (!streams) return {
    consoleErrors: [], pageErrors: [], httpErrors: [], externalRequests: [], webSockets: [],
  };
  const forPage = (events) => events.filter((event) => event?.label === label);
  return {
    consoleErrors: forPage(streams.consoleErrors),
    pageErrors: forPage(streams.pageErrors),
    httpErrors: forPage(streams.httpErrors),
    externalRequests: forPage(streams.externalRequests),
    webSockets: forPage(streams.webSockets),
  };
}

export async function readRustMultiplayerHarnessDiagnostics(page, options = {}) {
  const label = options.label ?? "browser";
  const lifecycle = options.lifecycle ?? { crashed: false, closed: false, events: [] };
  const browser = {
    isClosed: page.isClosed(),
    crashed: lifecycle.crashed === true,
    lifecycle: structuredClone(lifecycle),
  };
  const base = {
    schema: 1,
    label,
    capturedAt: new Date().toISOString(),
    elapsedMilliseconds: options.elapsedMilliseconds ?? 0,
    navigation: options.navigation ?? null,
    browser,
    streams: harnessStreamSnapshot(options.streams, label),
    expectedBuildProfile: options.expectedBuildProfile ?? "rust-primary",
  };
  if (browser.isClosed) return Object.freeze({ ...base, evaluationError: "page-is-closed" });
  try {
    const evaluated = await page.evaluate(() => {
      const compactText = (value, maximum) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maximum);
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden"
          && Number(style.opacity) !== 0 && bounds.width > 0 && bounds.height > 0;
      };
      const visibleText = (selector, maximumItems, maximumCharacters) => [...document.querySelectorAll(selector)]
        .filter(isVisible)
        .map((element) => compactText(element.textContent, maximumCharacters))
        .filter(Boolean)
        .slice(0, maximumItems);
      const parse = (rendererName) => {
        const renderer = window[rendererName];
        if (typeof renderer !== "function") return null;
        try { return JSON.parse(renderer()); } catch { return null; }
      };
      const state = parse("render_game_to_text");
      const runtime = parse("render_rust_runtime_to_text");
      const requiredGlobalNames = ["render_game_to_text", "render_rust_runtime_to_text", "set_game_key", "pulse_game_key", "advanceTime"];
      const globalTypes = Object.fromEntries(requiredGlobalNames.map((name) => [name, typeof window[name]]));
      const resources = performance.getEntriesByType("resource").slice(-48).map((entry) => ({
        name: compactText(entry.name, 512),
        initiatorType: entry.initiatorType,
        duration: Number(entry.duration.toFixed(3)),
        transferSize: entry.transferSize ?? null,
        encodedBodySize: entry.encodedBodySize ?? null,
        decodedBodySize: entry.decodedBodySize ?? null,
      }));
      const canvases = [...document.querySelectorAll("canvas")].slice(0, 16).map((canvas, index) => {
        const bounds = canvas.getBoundingClientRect();
        return {
          index,
          connected: canvas.isConnected,
          visible: isVisible(canvas),
          width: canvas.width,
          height: canvas.height,
          clientWidth: Number(bounds.width.toFixed(3)),
          clientHeight: Number(bounds.height.toFixed(3)),
        };
      });
      const bootstrapProbeDescriptor = Object.getOwnPropertyDescriptor(window, "__blockwildRustMultiplayerBootstrapProbe");
      return {
        document: {
          url: compactText(window.location.href, 512),
          title: compactText(document.title, 160),
          readyState: document.readyState,
          visibilityState: document.visibilityState,
          hidden: document.hidden,
          hasBody: Boolean(document.body),
          bodyText: compactText(document.body?.innerText, 2_048),
          visibleAlerts: visibleText('[role="alert"]', 12, 512),
          visibleHeadings: visibleText("h1, h2, h3", 16, 200),
          visibleStatuses: visibleText('[role="status"]', 12, 512),
          errorOverlays: visibleText("vite-error-overlay, nextjs-portal, [data-nextjs-dialog-overlay], [data-next-badge-root]", 8, 1_024),
          scripts: [...document.scripts].slice(0, 32).map((script) => ({
            src: compactText(script.src, 512),
            type: script.type || null,
            async: script.async,
            defer: script.defer,
          })),
          mainCount: document.querySelectorAll("main").length,
          gameShellCount: document.querySelectorAll("main.game-shell").length,
          canvases,
        },
        globals: {
          types: globalTypes,
          ready: requiredGlobalNames.every((name) => globalTypes[name] === "function"),
          generationAuditType: typeof window.__blockwildRustMultiplayerGenerationAudit,
          rtcConfigurationsType: typeof window.__blockwildRustMultiplayerRtcConfigurations,
          bootstrapProbeType: typeof window.__blockwildRustMultiplayerBootstrapProbe,
        },
        build: {
          domProfile: document.querySelector("[data-worldgen-build-profile]")?.getAttribute("data-worldgen-build-profile") ?? null,
          stateProfile: state?.build?.worldgenBuildProfile
            ?? state?.performance?.runtime?.build?.worldgenBuildProfile ?? null,
          runtimeProfile: runtime?.build?.worldgenBuildProfile
            ?? runtime?.manager?.build?.worldgenBuildProfile
            ?? runtime?.manager?.host?.build?.worldgenBuildProfile ?? null,
        },
        webgl: {
          probe: structuredClone(window.__blockwildRustMultiplayerBootstrapProbe ?? null),
          descriptor: bootstrapProbeDescriptor ? {
            configurable: bootstrapProbeDescriptor.configurable,
            enumerable: bootstrapProbeDescriptor.enumerable,
            writable: bootstrapProbeDescriptor.writable,
          } : null,
        },
        bootstrap: {
          stateParsed: state !== null,
          runtimeParsed: runtime !== null,
          stateName: state?.state ?? null,
          runtimeReady: runtime?.ready ?? null,
          runtimeState: runtime?.state ?? null,
          runtimeLastError: compactText(runtime?.lastError, 512) || null,
          managerState: runtime?.manager?.state ?? null,
          managerLastError: compactText(runtime?.manager?.lastError, 512) || null,
        },
        resources,
      };
    });
    return Object.freeze({ ...base, ...evaluated, evaluationError: null });
  } catch (error) {
    return Object.freeze({
      ...base,
      evaluationError: error instanceof Error ? error.message : String(error),
    });
  }
}

export function classifyRustMultiplayerHarnessDiagnostics(diagnostics) {
  const result = (status, stage, reason) => Object.freeze({ status, stage, reason });
  if (!diagnostics || typeof diagnostics !== "object") return result("failed", "bootstrap", "diagnostics-absent");
  if (diagnostics.browser?.crashed) return result("failed", "resource", "page-crashed");
  if (diagnostics.browser?.isClosed || diagnostics.browser?.lifecycle?.closed) {
    return result("failed", "resource", "page-closed");
  }
  const navigationStatus = diagnostics.navigation?.status;
  if (Number.isSafeInteger(navigationStatus) && (navigationStatus < 200 || navigationStatus >= 400)) {
    return result("failed", "resource", `document-http-${navigationStatus}`);
  }
  if (diagnostics.streams?.httpErrors?.length > 0 || diagnostics.streams?.externalRequests?.length > 0) {
    return result("failed", "resource", "resource-request-failure");
  }
  if (diagnostics.evaluationError) return result("failed", "bootstrap", "diagnostic-evaluation-failed");
  if (diagnostics.streams?.pageErrors?.length > 0) return result("failed", "bootstrap", "page-error");
  if (diagnostics.streams?.consoleErrors?.length > 0) {
    const resourceFailure = diagnostics.streams.consoleErrors.some((event) => /failed to load resource|net::err_|http \d{3}/iu.test(event?.text ?? ""));
    return result("failed", resourceFailure ? "resource" : "bootstrap",
      resourceFailure ? "resource-console-error" : "console-error");
  }
  const webglProbe = diagnostics.webgl?.probe;
  if (["interactive", "complete"].includes(diagnostics.document?.readyState) && !webglProbe) {
    return result("failed", "bootstrap", "bootstrap-probe-absent");
  }
  if (webglProbe && (diagnostics.webgl?.descriptor?.configurable !== false
    || diagnostics.webgl?.descriptor?.enumerable !== false
    || diagnostics.webgl?.descriptor?.writable !== false)) {
    return result("failed", "bootstrap", "bootstrap-probe-descriptor-invalid");
  }
  if (webglProbe?.attempted === true && webglProbe.available !== true) {
    return result("failed", "bootstrap", "webgl-unavailable");
  }
  const fatalText = [
    ...(diagnostics.document?.visibleAlerts ?? []),
    ...(diagnostics.document?.errorOverlays ?? []),
  ].join(" ");
  if (/failed|error|unhandled|could not|unavailable|invalid|mismatch|blocked/iu.test(fatalText)) {
    return result("failed", "bootstrap", "visible-fatal-ui");
  }
  if (diagnostics.globals?.ready === true) {
    const observedBuildProfiles = Object.values(diagnostics.build ?? {}).filter((value) => value !== null);
    if (observedBuildProfiles.length === 0) return result("failed", "bootstrap", "build-profile-absent");
    if (observedBuildProfiles.some((value) => value !== diagnostics.expectedBuildProfile)) {
      return result("failed", "bootstrap", "build-profile-mismatch");
    }
    return result("ready", "bootstrap", "required-globals-and-runtime-surface-ready");
  }
  return result("pending", "bootstrap", "required-globals-pending");
}

export function classifyRustMultiplayerFailure(error, acceptanceStage, signaling = {}) {
  const code = error && typeof error === "object" ? error.code ?? null : null;
  const explicitStage = error && typeof error === "object" ? error.failureStage : null;
  const stage = typeof explicitStage === "string" && explicitStage.length > 0
    ? explicitStage
    : acceptanceStage;
  let family = "setup-or-acceptance";
  if (code === "BLOCKWILD_BROWSER_GATE_OVERLAP") family = "concurrency";
  else if (stage === "resource") family = "resource";
  else if (stage === "bootstrap") family = "bootstrap";
  else if (typeof stage === "string" && stage.startsWith("terrain-readiness")) family = "terrain-readiness";
  else if (stage === "movement") family = "movement";
  else if (stage === "disconnect") family = "disconnect";
  else if (typeof stage === "string" && stage.startsWith("signaling")) family = "signaling";
  return Object.freeze({
    family,
    stage,
    code,
    reason: error && typeof error === "object"
      ? error.failureReason ?? error.harnessClassification?.reason ?? null
      : null,
    signalingStarted: typeof acceptanceStage === "string" && acceptanceStage.startsWith("signaling"),
    initialSignalCompleted: signaling.initial === true,
    reconnectSignalCompleted: signaling.reconnect === true,
  });
}

function rustMultiplayerHarnessError(diagnostics, classification, timedOut = false) {
  const stage = classification?.stage ?? "bootstrap";
  const reason = timedOut ? "required-globals-timeout" : classification?.reason ?? "unknown";
  const error = new Error(
    `${diagnostics?.label ?? "browser"} ${stage} harness ${timedOut ? "timed out" : "failed"} (${reason}): ${JSON.stringify(diagnostics)}`,
  );
  error.code = timedOut
    ? "BLOCKWILD_HARNESS_TIMEOUT"
    : reason === "peer-harness-failed"
      ? "BLOCKWILD_HARNESS_PEER_ABORT"
      : "BLOCKWILD_HARNESS_FAILURE";
  error.failureStage = stage;
  error.harnessDiagnostics = diagnostics;
  error.harnessClassification = Object.freeze({ status: "failed", stage, reason });
  return error;
}

export async function waitForHarness(page, timeoutMilliseconds, options = {}) {
  const timeout = Math.min(timeoutMilliseconds, 120_000);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readDiagnostics = options.readDiagnostics ?? readRustMultiplayerHarnessDiagnostics;
  const started = now();
  let diagnostics = null;
  while (now() - started <= timeout) {
    if (options.signal?.aborted) {
      throw rustMultiplayerHarnessError(
        diagnostics ?? Object.freeze({ schema: 1, label: options.label ?? "browser", abortedBeforeDiagnostics: true }),
        Object.freeze({ status: "failed", stage: "bootstrap", reason: "peer-harness-failed" }),
      );
    }
    diagnostics = await readDiagnostics(page, {
      label: options.label,
      lifecycle: options.lifecycle,
      navigation: options.navigation,
      streams: options.streams,
      expectedBuildProfile: options.expectedBuildProfile,
      elapsedMilliseconds: now() - started,
    });
    options.onDiagnostics?.(diagnostics);
    const classification = classifyRustMultiplayerHarnessDiagnostics(diagnostics);
    if (classification.status === "ready") return diagnostics;
    if (classification.status === "failed") throw rustMultiplayerHarnessError(diagnostics, classification);
    await sleep(Math.min(250, Math.max(1, timeout - (now() - started))));
  }
  throw rustMultiplayerHarnessError(
    diagnostics,
    Object.freeze({ status: "failed", stage: "bootstrap", reason: "required-globals-timeout" }),
    true,
  );
}

async function readFixtureCreationDiagnostics(page, fixture, expectedHash) {
  return page.evaluate(({ name, seed, hash }) => {
    const parse = (rendererName) => {
      const renderer = window[rendererName];
      if (typeof renderer !== "function") return null;
      try { return JSON.parse(renderer()); } catch { return null; }
    };
    const compactText = (value, maximum) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maximum);
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && bounds.width > 0 && bounds.height > 0;
    };
    const visibleText = (selector, maximumItems, maximumCharacters) => [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .map((element) => compactText(element.textContent, maximumCharacters))
      .filter(Boolean)
      .slice(0, maximumItems);
    const state = parse("render_game_to_text");
    const runtime = parse("render_rust_runtime_to_text");
    const host = runtime?.manager?.host;
    return {
      expected: { name, seed, artifactHash: hash },
      document: {
        title: compactText(document.title, 160),
        url: compactText(window.location.href, 512),
        visibleAlerts: visibleText('[role="alert"]', 8, 512),
        visibleHeadings: visibleText("h1, h2, h3", 12, 160),
      },
      state: {
        worldSeed: state?.world?.seed ?? null,
        playerMode: state?.player?.mode ?? null,
        playerPosition: Array.isArray(state?.player?.position) ? state.player.position.slice(0, 3) : null,
        scene: state?.scene ?? null,
      },
      runtime: {
        ready: runtime?.ready ?? null,
        operationsBlocked: runtime?.operationsBlocked ?? null,
        state: runtime?.state ?? null,
        lastError: compactText(runtime?.lastError, 512) || null,
        manager: {
          state: runtime?.manager?.state ?? null,
          lastError: compactText(runtime?.manager?.lastError, 512) || null,
          host: {
            state: host?.state ?? null,
            artifactHash: host?.artifactHash ?? null,
            lastError: compactText(host?.lastError, 512) || null,
          },
        },
      },
    };
  }, { name: fixture.name, seed: fixture.seed, hash: expectedHash });
}

async function createFixtureWorld(page, fixture, expectedHash, timeoutMilliseconds) {
  await page.getByRole("button", { name: /^Create New World/u }).click();
  await page.getByRole("heading", { name: "Create a New World" }).waitFor();
  await page.getByLabel("World name").fill(fixture.name);
  await page.getByLabel("World seed").fill(fixture.seed);
  await page.getByRole("button", { name: /^CREATIVE/u }).click();
  await page.locator("details.advanced-world-options > summary").click();
  await page.locator(".settlement-preset-grid").getByRole("button", { name: /^Wilderness/u }).click();
  await page.getByRole("button", { name: "Generate World" }).click({ noWaitAfter: true });
  try {
    await page.waitForFunction(({ seed, hash }) => {
      try {
        const state = JSON.parse(window.render_game_to_text?.() ?? "null");
        const runtime = JSON.parse(window.render_rust_runtime_to_text?.() ?? "null");
        return state?.world?.seed === seed
          && state?.player?.mode === "builder"
          && runtime?.ready === true
          && runtime?.operationsBlocked === false
          && runtime?.manager?.host?.artifactHash === hash;
      } catch { return false; }
    }, { seed: fixture.seed, hash: expectedHash }, { timeout: Math.min(timeoutMilliseconds, 180_000) });
  } catch (cause) {
    const fixtureDiagnostics = await readFixtureCreationDiagnostics(page, fixture, expectedHash).catch((diagnosticError) => ({
      expected: { name: fixture.name, seed: fixture.seed, artifactHash: expectedHash },
      diagnosticError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
    }));
    const error = new Error(`World ${fixture.name} did not reach exact Rust readiness. Final diagnostics: ${JSON.stringify(fixtureDiagnostics)}`, { cause });
    error.fixtureDiagnostics = fixtureDiagnostics;
    throw error;
  }
  const snapshot = await readBrowserSnapshot(page);
  assertCondition(snapshot.buildProfile === "rust-primary", `World ${fixture.name} did not use rust-primary build profile.`);
  return snapshot;
}

async function readRustMultiplayerPanelSurface(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const headingVisible = (expected) => [...document.querySelectorAll("h1, h2, h3")]
      .some((element) => visible(element) && element.textContent?.trim() === expected);
    let stateName = null;
    try { stateName = JSON.parse(window.render_game_to_text?.() ?? "null")?.state ?? null; } catch { /* Reported as an unknown surface below. */ }
    return {
      stateName,
      menuOverlayVisible: [...document.querySelectorAll(".menu-overlay")].some(visible),
      titleMainVisible: headingVisible("BLOCKWILD") && visible(document.querySelector(".title-overlay")),
      titleMultiplayerVisible: headingVisible("Join Multiplayer"),
      sessionMultiplayerVisible: headingVisible("Multiplayer Session"),
      pauseVisible: headingVisible("Game Paused") || headingVisible("Session Menu"),
      mapVisible: headingVisible("Known Roads"),
    };
  });
}

const RUST_MULTIPLAYER_CONTINUE_FATAL_TEXT = /failed|error|exceeded|timed out|could not|unavailable|invalid|mismatch|blocked|aborted|terminated|refused/iu;

async function readRustMultiplayerContinueOutcome(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const compactError = (value) => {
      if (value === null || value === undefined || value === "") return null;
      if (typeof value === "string") return value.replace(/\s+/gu, " ").trim().slice(0, 2_048) || null;
      if (typeof value === "object") {
        const code = typeof value.code === "string" ? value.code.replace(/\s+/gu, " ").trim() : "";
        const message = typeof value.message === "string" ? value.message.replace(/\s+/gu, " ").trim() : "";
        if (code || message) return `${code}${code && message ? ": " : ""}${message}`.slice(0, 2_048);
        try { return JSON.stringify(value).slice(0, 2_048); } catch { return String(value).slice(0, 2_048); }
      }
      return String(value).replace(/\s+/gu, " ").trim().slice(0, 2_048) || null;
    };
    const parse = (name) => {
      const renderer = window[name];
      if (typeof renderer !== "function") return null;
      try { return JSON.parse(renderer()); } catch { return null; }
    };
    const state = parse("render_game_to_text");
    const runtime = parse("render_rust_runtime_to_text");
    const manager = runtime?.manager;
    const host = manager?.host;
    const adapter = host?.adapter;
    const nativePersistence = host?.nativePersistence;
    return {
      stateName: state?.state ?? null,
      titleVisible: visible(document.querySelector(".title-overlay")),
      visibleAlerts: [...document.querySelectorAll('[role="alert"]')]
        .filter(visible)
        .map((element) => compactError(element.textContent))
        .filter(Boolean)
        .slice(0, 8),
      stateError: compactError(state?.multiplayer?.error),
      runtime: {
        ready: runtime?.ready ?? null,
        operationsBlocked: runtime?.operationsBlocked ?? null,
        transitionGeneration: runtime?.transitionGeneration ?? null,
        activeWorldId: runtime?.activeWorldId ?? null,
        activeUniverseId: runtime?.activeUniverseId ?? null,
        activeLocationId: runtime?.activeLocationId ?? null,
        activeSessionId: runtime?.activeSessionId ?? null,
        nativePersistenceWorldId: runtime?.nativePersistenceWorldId ?? null,
        hydration: runtime?.hydration ?? null,
        lastError: compactError(runtime?.lastError),
        managerState: manager?.state ?? null,
        managerRequestedGeneration: manager?.requestedGeneration ?? null,
        managerActiveGeneration: manager?.activeGeneration ?? null,
        managerActiveFingerprint: typeof manager?.activeFingerprint === "string"
          ? manager.activeFingerprint.slice(0, 2_048)
          : null,
        managerLastError: compactError(manager?.lastError),
        hostState: host?.state ?? null,
        hostArtifactHash: host?.artifactHash ?? null,
        hostContentHash: host?.contentHash ?? null,
        hostGeneratorHash: host?.generatorHash ?? null,
        hostLastError: compactError(host?.lastError),
        adapter: adapter ? {
          state: adapter.state ?? null,
          authoritative: adapter.authoritative ?? null,
          verification: adapter.verification ?? null,
          clientEpoch: adapter.clientEpoch ?? null,
          workerEpoch: adapter.workerEpoch ?? null,
          requests: adapter.requests ?? null,
          acceptedCommands: adapter.acceptedCommands ?? null,
          rejectedCommands: adapter.rejectedCommands ?? null,
          cachedReceipts: adapter.cachedReceipts ?? null,
          indeterminateCommands: adapter.indeterminateCommands ?? null,
          staleResponses: adapter.staleResponses ?? null,
          failures: adapter.failures ?? null,
          contentReady: adapter.contentReady ?? null,
          fixedStepInputReady: adapter.fixedStepInputReady ?? null,
          boundedExtractionAvailable: adapter.boundedExtractionAvailable ?? null,
          boundedExtractionReady: adapter.boundedExtractionReady ?? null,
          liveAuthorityReady: adapter.liveAuthorityReady ?? null,
          lastError: compactError(adapter.lastError),
        } : null,
        adapterLastError: compactError(adapter?.lastError),
        nativePersistence: nativePersistence ? {
          worldId: nativePersistence.worldId ?? null,
          state: nativePersistence.state ?? null,
          saves: nativePersistence.saves ?? null,
          recoveries: nativePersistence.recoveries ?? null,
          legacyMigrations: nativePersistence.legacyMigrations ?? null,
          legacyMigrationRetries: nativePersistence.legacyMigrationRetries ?? null,
          parentFallbacks: nativePersistence.parentFallbacks ?? null,
          platformOperations: nativePersistence.platformOperations ?? null,
          requestBytes: nativePersistence.requestBytes ?? null,
          responseBytes: nativePersistence.responseBytes ?? null,
          lastCheckpointId: nativePersistence.lastCheckpointId ?? null,
          lastError: compactError(nativePersistence.lastError),
        } : null,
        playerAuthorityState: runtime?.playerAuthority?.state ?? null,
        playerAuthorityWorldGeneration: runtime?.playerAuthority?.worldGeneration ?? null,
        playerAuthorityPumpState: runtime?.playerAuthority?.pump?.state ?? null,
        playerAuthorityPumpLastError: compactError(runtime?.playerAuthority?.pump?.lastError),
        playerAuthorityLastError: compactError(runtime?.playerAuthority?.lastError),
        multiplayerLastError: compactError(runtime?.multiplayer?.lastError),
      },
    };
  });
}

function assessRustMultiplayerContinueOutcome(snapshot) {
  if (snapshot?.stateName === "playing") return Object.freeze({ status: "ready", errors: Object.freeze([]) });
  const errors = [];
  const push = (source, message) => {
    if (typeof message === "string" && message.trim() !== "") {
      errors.push(Object.freeze({ source, message: message.trim() }));
    }
  };
  for (const alert of Array.isArray(snapshot?.visibleAlerts) ? snapshot.visibleAlerts : []) {
    if (RUST_MULTIPLAYER_CONTINUE_FATAL_TEXT.test(alert)) push("visible-alert", alert);
  }
  if (RUST_MULTIPLAYER_CONTINUE_FATAL_TEXT.test(snapshot?.stateError ?? "")) {
    push("state.multiplayer.error", snapshot.stateError);
  }
  push("runtime.lastError", snapshot?.runtime?.lastError);
  push("runtime.manager.lastError", snapshot?.runtime?.managerLastError);
  push("runtime.manager.host.lastError", snapshot?.runtime?.hostLastError);
  push("runtime.manager.host.adapter.lastError", snapshot?.runtime?.adapterLastError);
  push("runtime.playerAuthority.lastError", snapshot?.runtime?.playerAuthorityLastError);
  push("runtime.multiplayer.lastError", snapshot?.runtime?.multiplayerLastError);
  if (/^(?:error|failed|aborted|terminated)$/iu.test(snapshot?.runtime?.managerState ?? "")) {
    push("runtime.manager.state", String(snapshot.runtime.managerState));
  }
  if (/^(?:error|failed|aborted|terminated)$/iu.test(snapshot?.runtime?.hostState ?? "")) {
    push("runtime.manager.host.state", String(snapshot.runtime.hostState));
  }
  return Object.freeze({ status: errors.length > 0 ? "failed" : "pending", errors: Object.freeze(errors) });
}

function rustMultiplayerContinueRouteError(code, reason, message, evidence, cause) {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause });
  error.code = code;
  error.failureReason = reason;
  error.panelAction = "continue-local-world";
  error.panelRoutingEvidence = evidence;
  return error;
}

async function waitForRustMultiplayerContinueOutcome(page, timeoutMilliseconds, options = {}) {
  const requestedTimeoutMilliseconds = Number.isFinite(timeoutMilliseconds)
    ? Math.max(1, Math.trunc(timeoutMilliseconds))
    : DEFAULT_TIMEOUT_MILLISECONDS;
  const boundedTimeoutMilliseconds = Math.min(
    requestedTimeoutMilliseconds,
    RUST_MULTIPLAYER_CONTINUE_ROUTE_TIMEOUT_MS,
  );
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readOutcome = options.readContinueOutcome ?? (() => readRustMultiplayerContinueOutcome(page));
  const pollMilliseconds = Math.max(1, Math.trunc(options.pollMilliseconds ?? 50));
  const started = now();
  const observations = [];
  let lastObservationSignature = null;
  let attempts = 0;
  let finalSnapshot = null;
  while (now() - started <= boundedTimeoutMilliseconds) {
    attempts += 1;
    try {
      finalSnapshot = await readOutcome();
    } catch (cause) {
      const evidence = Object.freeze({
        action: "continue-local-world",
        requestedTimeoutMilliseconds,
        timeoutMilliseconds: boundedTimeoutMilliseconds,
        elapsedMilliseconds: Math.max(0, now() - started),
        attempts,
        finalSnapshot,
        observations: Object.freeze(observations),
      });
      throw rustMultiplayerContinueRouteError(
        "BLOCKWILD_MULTIPLAYER_CONTINUE_READ_ERROR",
        "continue-runtime-bootstrap-read-error",
        `Continue local-world runtime bootstrap could not be inspected: ${cause instanceof Error ? cause.message : String(cause)}`,
        evidence,
        cause,
      );
    }
    const assessment = assessRustMultiplayerContinueOutcome(finalSnapshot);
    const observation = Object.freeze({
      elapsedMilliseconds: Math.max(0, now() - started),
      snapshot: structuredClone(finalSnapshot),
      assessment,
    });
    const observationSignature = JSON.stringify({ snapshot: observation.snapshot, assessment });
    if (observationSignature !== lastObservationSignature) {
      observations.push(observation);
      if (observations.length > 64) observations.shift();
      lastObservationSignature = observationSignature;
    }
    if (assessment.status === "ready") {
      return Object.freeze({
        action: "continue-local-world",
        elapsedMilliseconds: Math.max(0, now() - started),
        attempts,
        finalSnapshot: structuredClone(finalSnapshot),
      });
    }
    if (assessment.status === "failed") {
      const evidence = Object.freeze({
        action: "continue-local-world",
        requestedTimeoutMilliseconds,
        timeoutMilliseconds: boundedTimeoutMilliseconds,
        elapsedMilliseconds: Math.max(0, now() - started),
        attempts,
        errors: assessment.errors,
        finalSnapshot: structuredClone(finalSnapshot),
        observations: Object.freeze(observations),
      });
      const attributedErrors = assessment.errors.map(({ source, message }) => `${source}: ${message}`).join(" | ");
      throw rustMultiplayerContinueRouteError(
        "BLOCKWILD_MULTIPLAYER_CONTINUE_BOOTSTRAP_ERROR",
        "continue-runtime-bootstrap-error",
        `Continue local-world runtime bootstrap failed: ${attributedErrors}`,
        evidence,
      );
    }
    const elapsedMilliseconds = now() - started;
    if (elapsedMilliseconds >= boundedTimeoutMilliseconds) break;
    await sleep(Math.min(pollMilliseconds, Math.max(1, boundedTimeoutMilliseconds - elapsedMilliseconds)));
  }
  const evidence = Object.freeze({
    action: "continue-local-world",
    requestedTimeoutMilliseconds,
    timeoutMilliseconds: boundedTimeoutMilliseconds,
    elapsedMilliseconds: Math.max(0, now() - started),
    attempts,
    finalSnapshot: structuredClone(finalSnapshot),
    observations: Object.freeze(observations),
  });
  throw rustMultiplayerContinueRouteError(
    "BLOCKWILD_MULTIPLAYER_CONTINUE_TIMEOUT",
    "continue-runtime-bootstrap-timeout",
    `Continue local-world runtime bootstrap did not reach playing within ${boundedTimeoutMilliseconds}ms. Final diagnostics: ${JSON.stringify(finalSnapshot)}`,
    evidence,
  );
}

export function rustMultiplayerPanelRoute(surface, requireDirectFallback = false, directPanelKind = "session") {
  const requestedDirectKind = directPanelKind === "title" ? "title" : "session";
  if (surface?.sessionMultiplayerVisible === true) {
    return requireDirectFallback && requestedDirectKind !== "session"
      ? Object.freeze({ status: "pending", action: null })
      : Object.freeze({ status: "ready", kind: "session" });
  }
  if (surface?.titleMultiplayerVisible === true) {
    return requireDirectFallback && requestedDirectKind === "session"
      ? Object.freeze({ status: "transition", action: "leave-title-multiplayer" })
      : Object.freeze({ status: "ready", kind: "title" });
  }
  if (surface?.titleMainVisible === true) {
    return requireDirectFallback && requestedDirectKind === "session"
      ? Object.freeze({ status: "transition", action: "continue-local-world" })
      : Object.freeze({ status: "transition", action: "open-title-multiplayer" });
  }
  if (surface?.mapVisible === true) return Object.freeze({ status: "transition", action: "close-map" });
  if (surface?.pauseVisible === true) return Object.freeze({ status: "transition", action: "open-session-multiplayer" });
  if ((surface?.stateName === "playing" || surface?.stateName === "paused")
    && surface?.menuOverlayVisible !== true) {
    return Object.freeze({ status: "transition", action: "open-pause-menu" });
  }
  return Object.freeze({ status: "pending", action: null });
}

export async function performRustMultiplayerPanelAction(page, action, timeoutMilliseconds, options = {}) {
  switch (action) {
    case "leave-title-multiplayer":
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("heading", { name: "BLOCKWILD", exact: true }).waitFor({ timeout: timeoutMilliseconds });
      return;
    case "continue-local-world":
      await page.getByRole("button", { name: /^Continue\b/u }).click({ noWaitAfter: true });
      await waitForRustMultiplayerContinueOutcome(page, timeoutMilliseconds, options);
      return;
    case "open-title-multiplayer":
      await page.getByRole("button", { name: /^Multiplayer\b/u }).click();
      await page.getByRole("heading", { name: /^(?:Join Multiplayer|Multiplayer Session)$/u }).waitFor({ timeout: timeoutMilliseconds });
      return;
    case "close-map":
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "Known Roads", exact: true })
        .waitFor({ state: "hidden", timeout: timeoutMilliseconds });
      return;
    case "open-pause-menu":
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: /^(?:Game Paused|Session Menu)$/u }).waitFor({ timeout: timeoutMilliseconds });
      return;
    case "open-session-multiplayer":
      await page.getByRole("button", { name: "Multiplayer Session", exact: true }).click();
      await page.getByRole("heading", { name: "Multiplayer Session", exact: true }).waitFor({ timeout: timeoutMilliseconds });
      return;
    default:
      throw new Error(`Unknown multiplayer panel route action: ${String(action)}`);
  }
}

export async function ensureRustMultiplayerPanel(page, options = {}) {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
  const requireDirectFallback = options.requireDirectFallback === true;
  const directPanelKind = options.directPanelKind ?? "session";
  assertCondition(directPanelKind === "session" || directPanelKind === "title",
    `Unknown direct multiplayer panel kind: ${String(directPanelKind)}`);
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readSurface = options.readSurface ?? (() => readRustMultiplayerPanelSurface(page));
  const performAction = options.performAction ?? ((action) => performRustMultiplayerPanelAction(page, action, timeoutMilliseconds));
  const pollMilliseconds = options.pollMilliseconds ?? 50;
  const started = now();
  const trace = [];
  let finalSurface = null;
  while (now() - started <= timeoutMilliseconds) {
    finalSurface = await readSurface();
    const route = rustMultiplayerPanelRoute(finalSurface, requireDirectFallback, directPanelKind);
    trace.push(Object.freeze({ surface: structuredClone(finalSurface), route }));
    if (route.status === "ready") return Object.freeze({ kind: route.kind, trace: Object.freeze(trace) });
    if (route.status === "transition") {
      await performAction(route.action, finalSurface);
    } else {
      await sleep(Math.min(pollMilliseconds, Math.max(1, timeoutMilliseconds - (now() - started))));
    }
  }
  const error = new Error(`Multiplayer panel routing timed out after ${timeoutMilliseconds}ms. Final surface: ${JSON.stringify(finalSurface)}`);
  error.code = "BLOCKWILD_MULTIPLAYER_PANEL_TIMEOUT";
  error.failureStage = "signaling";
  error.panelRoutingEvidence = Object.freeze({
    timeoutMilliseconds,
    finalSurface: structuredClone(finalSurface),
    trace: Object.freeze(trace.slice(-16)),
  });
  throw error;
}

function compactRustMultiplayerDirectPanelEvidence(panel, requestedKind, joinOfferVisible) {
  const trace = Array.isArray(panel?.trace) ? panel.trace : [];
  return Object.freeze({
    requestedKind,
    resolvedKind: panel?.kind ?? null,
    actions: Object.freeze(trace.map((entry) => entry?.route?.action).filter((action) => typeof action === "string")),
    observedTitleMain: trace.some((entry) => entry?.surface?.titleMainVisible === true),
    observedTitleMultiplayer: trace.some((entry) => entry?.surface?.titleMultiplayerVisible === true),
    observedSessionMultiplayer: trace.some((entry) => entry?.surface?.sessionMultiplayerVisible === true),
    joinOfferVisible,
    trace: Object.freeze(trace.map((entry) => Object.freeze({
      surface: structuredClone(entry?.surface ?? null),
      route: structuredClone(entry?.route ?? null),
    }))),
  });
}

async function openDirectPanel(page, playerName, timeoutMilliseconds, options = {}) {
  const requestedKind = options.requestedKind ?? "session";
  const panel = await ensureRustMultiplayerPanel(page, {
    requireDirectFallback: true,
    directPanelKind: requestedKind,
    timeoutMilliseconds,
  });
  assertCondition(panel.kind === requestedKind,
    `Advanced direct signaling requested the ${requestedKind} multiplayer panel but resolved ${String(panel.kind)}.`);
  await page.locator(".multiplayer-name-field input").fill(playerName);
  const details = page.locator("details.multiplayer-advanced");
  await details.waitFor({ timeout: Math.min(timeoutMilliseconds, 120_000) });
  if (!await details.evaluate((element) => element.open)) await details.locator(":scope > summary").click();
  const joinOffer = details.getByText("JOIN OFFER", { exact: true });
  await joinOffer.waitFor({ timeout: Math.min(timeoutMilliseconds, 120_000) });
  return compactRustMultiplayerDirectPanelEvidence(panel, requestedKind, true);
}

async function readRustMultiplayerSignalOutput(page, selector, previousValue) {
  return page.evaluate(({ outputSelector, priorValue }) => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0
        && bounds.width > 0 && bounds.height > 0;
    };
    const compactText = (value) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 2_048);
    const output = document.querySelector(outputSelector);
    if (output instanceof HTMLTextAreaElement && output.value.length > 4 && output.value !== priorValue) {
      return { status: "ready", value: output.value };
    }
    const visibleError = [...document.querySelectorAll('.multiplayer-error[role="alert"]')]
      .find(visible);
    if (visibleError) {
      return { status: "failed", uiError: compactText(visibleError.textContent) || "Unknown multiplayer error." };
    }
    return { status: "pending" };
  }, { outputSelector: selector, priorValue: previousValue });
}

function rustMultiplayerSignalOutputError(code, reason, message, evidence, cause) {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause });
  error.code = code;
  error.failureReason = reason;
  error.failureStage = "signaling";
  error.signalOutputEvidence = Object.freeze({ ...evidence });
  return error;
}

export async function changedInputValue(page, selector, previous, timeoutMilliseconds, options = {}) {
  assertCondition(typeof selector === "string" && selector.trim() !== "",
    "Signal output polling requires a stable selector.");
  const requestedTimeoutMilliseconds = Number.isFinite(timeoutMilliseconds)
    ? Math.max(1, Math.trunc(timeoutMilliseconds))
    : DEFAULT_TIMEOUT_MILLISECONDS;
  const boundedTimeoutMilliseconds = Math.min(requestedTimeoutMilliseconds, 120_000);
  const label = typeof options.label === "string" && options.label.trim() !== ""
    ? options.label.trim()
    : "multiplayer signal";
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readOutcome = options.readOutcome ?? (() => readRustMultiplayerSignalOutput(page, selector, previous));
  const pollMilliseconds = Math.max(1, Math.trunc(options.pollMilliseconds ?? 25));
  const pageClosed = () => typeof page?.isClosed === "function" && page.isClosed();
  const started = now();
  const evidence = () => ({ label, selector, timeoutMilliseconds: boundedTimeoutMilliseconds });

  while (now() - started <= boundedTimeoutMilliseconds) {
    if (pageClosed()) {
      throw rustMultiplayerSignalOutputError(
        "BLOCKWILD_MULTIPLAYER_SIGNAL_PAGE_CLOSED",
        "page-closed",
        `The ${label} page closed before its output was ready.`,
        evidence(),
      );
    }
    let outcome;
    try {
      outcome = await readOutcome();
    } catch (cause) {
      if (pageClosed() || /(?:page|context|browser).*(?:closed|closing)|target.*closed/iu.test(
        cause instanceof Error ? cause.message : String(cause),
      )) {
        throw rustMultiplayerSignalOutputError(
          "BLOCKWILD_MULTIPLAYER_SIGNAL_PAGE_CLOSED",
          "page-closed",
          `The ${label} page closed before its output was ready.`,
          evidence(),
          cause,
        );
      }
      throw rustMultiplayerSignalOutputError(
        "BLOCKWILD_MULTIPLAYER_SIGNAL_READ_FAILED",
        "signal-output-read-failed",
        `The ${label} output could not be inspected.`,
        evidence(),
        cause,
      );
    }
    if (outcome?.status === "ready" && typeof outcome.value === "string"
      && outcome.value.length > 4 && outcome.value !== previous) {
      return outcome.value;
    }
    if (outcome?.status === "failed") {
      const uiError = typeof outcome.uiError === "string" && outcome.uiError.trim() !== ""
        ? outcome.uiError.trim().slice(0, 2_048)
        : "Unknown multiplayer error.";
      throw rustMultiplayerSignalOutputError(
        "BLOCKWILD_MULTIPLAYER_SIGNAL_UI_ERROR",
        "visible-multiplayer-error",
        `The ${label} failed before its output was ready: ${uiError}`,
        { ...evidence(), uiError },
      );
    }
    const elapsed = now() - started;
    if (elapsed >= boundedTimeoutMilliseconds) break;
    await sleep(Math.min(pollMilliseconds, Math.max(1, boundedTimeoutMilliseconds - elapsed)));
  }
  throw rustMultiplayerSignalOutputError(
    "BLOCKWILD_MULTIPLAYER_SIGNAL_TIMEOUT",
    "signal-output-timeout",
    `The ${label} output did not become ready within ${boundedTimeoutMilliseconds}ms.`,
    evidence(),
  );
}

async function readRustMultiplayerConnectedSurface(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0
        && bounds.width > 0 && bounds.height > 0;
    };
    const parse = (name) => {
      const renderer = window[name];
      if (typeof renderer !== "function") return null;
      try { return JSON.parse(renderer()); } catch { return null; }
    };
    const state = parse("render_game_to_text");
    const runtime = parse("render_rust_runtime_to_text");
    const transport = runtime?.multiplayer?.transport;
    const transportPeers = Array.isArray(transport?.peers) ? transport.peers : [];
    return {
      panelVisible: visible(document.querySelector(".multiplayer-panel")),
      panelStatus: document.querySelector(".multiplayer-status-row strong")?.textContent?.trim() ?? null,
      panelPeerCount: document.querySelectorAll(".multiplayer-peer-list > div").length,
      state: {
        name: state?.state ?? null,
        multiplayerRole: state?.multiplayer?.role ?? null,
        multiplayerStatus: state?.multiplayer?.status ?? null,
      },
      runtime: {
        ready: runtime?.ready ?? null,
        operationsBlocked: runtime?.operationsBlocked ?? null,
        activeSessionId: runtime?.activeSessionId ?? null,
        hydration: runtime?.hydration ?? null,
        managerState: runtime?.manager?.state ?? null,
        hostState: runtime?.manager?.host?.state ?? null,
        transitionGeneration: runtime?.transitionGeneration ?? null,
        managerRequestedGeneration: runtime?.manager?.requestedGeneration ?? null,
        managerActiveGeneration: runtime?.manager?.activeGeneration ?? null,
        playerAuthorityState: runtime?.playerAuthority?.state ?? null,
        playerAuthorityGeneration: runtime?.playerAuthority?.worldGeneration ?? null,
        playerAuthorityEntityId: runtime?.playerAuthority?.entityId ?? null,
        playerAuthorityTerrainChunkCount: runtime?.playerAuthority?.terrainChunkCount ?? null,
        playerAuthorityLastError: runtime?.playerAuthority?.lastError ?? null,
        playerAuthorityPumpState: runtime?.playerAuthority?.pump?.state ?? null,
        playerAuthorityPumpGeneration: runtime?.playerAuthority?.pump?.worldGeneration ?? null,
        playerAuthorityPumpLastError: runtime?.playerAuthority?.pump?.lastError ?? null,
        transportRole: transport?.role ?? null,
        transportState: transport?.state ?? null,
        transportPeerCount: transportPeers.length,
        transportPeerIds: transportPeers.map((peer) => peer?.peerId ?? null),
      },
    };
  });
}

export function assessRustMultiplayerConnectedSurface(surface, expected = {}) {
  const role = expected.role ?? null;
  const expectedPeerId = expected.peerId ?? null;
  const expectedSessionId = expected.sessionId ?? null;
  const requireGameplayRuntimeConnected = expected.requireGameplayRuntimeConnected === true;
  const requireR5PlayerAuthority = expected.requireR5PlayerAuthority === true;
  const panelReady = surface?.panelVisible === true
    && surface?.panelStatus === "CONNECTED"
    && surface?.panelPeerCount === 1;
  const runtimePeerIds = Array.isArray(surface?.runtime?.transportPeerIds)
    ? surface.runtime.transportPeerIds
    : [];
  const r5PlayerAuthorityReady = !requireR5PlayerAuthority || (
    Number.isSafeInteger(surface?.runtime?.transitionGeneration)
    && surface.runtime.transitionGeneration >= 1
    && Number.isSafeInteger(surface?.runtime?.managerRequestedGeneration)
    && surface.runtime.managerRequestedGeneration >= 1
    && surface?.runtime?.managerActiveGeneration === surface.runtime.managerRequestedGeneration
    && surface?.runtime?.playerAuthorityState === "ready"
    && surface?.runtime?.playerAuthorityGeneration === surface.runtime.transitionGeneration
    && surface?.runtime?.playerAuthorityEntityId !== null
    && Number.isSafeInteger(surface?.runtime?.playerAuthorityTerrainChunkCount)
    && surface.runtime.playerAuthorityTerrainChunkCount > 0
    && surface?.runtime?.playerAuthorityLastError === null
    && surface?.runtime?.playerAuthorityPumpState === "ready"
    && surface?.runtime?.playerAuthorityPumpGeneration === surface.runtime.transitionGeneration
    && surface?.runtime?.playerAuthorityPumpLastError === null
  );
  const gameplayRuntimeReady = surface?.panelVisible === false
    && surface?.state?.name === "playing"
    && surface?.state?.multiplayerRole === role
    && surface?.state?.multiplayerStatus === "connected"
    && surface?.runtime?.ready === true
    && surface?.runtime?.operationsBlocked === false
    && surface?.runtime?.activeSessionId === expectedSessionId
    && surface?.runtime?.hydration === "guest-bootstrap"
    && surface?.runtime?.managerState === "ready"
    && surface?.runtime?.hostState === "ready"
    && surface?.runtime?.transportRole === role
    && surface?.runtime?.transportState === "connected"
    && surface?.runtime?.transportPeerCount === 1
    && runtimePeerIds.length === 1
    && runtimePeerIds[0] === expectedPeerId
    && r5PlayerAuthorityReady;
  // The initial exchange must remain visibly inspectable in both in-world
  // panels. Only the title reconnect is allowed to replace that panel proof
  // with the stricter closed-panel gameplay/runtime certificate above.
  const ready = requireGameplayRuntimeConnected ? gameplayRuntimeReady : panelReady;
  return Object.freeze({
    status: ready ? "ready" : "pending",
    kind: ready ? (requireGameplayRuntimeConnected ? "gameplay-runtime-connected" : "panel-connected") : null,
    panelReady,
    gameplayRuntimeReady,
  });
}

async function waitForConnected(page, timeoutMilliseconds, expected = {}) {
  const boundedTimeoutMilliseconds = Math.min(timeoutMilliseconds, 120_000);
  const started = Date.now();
  let surface = null;
  let assessment = null;
  while (Date.now() - started <= boundedTimeoutMilliseconds) {
    surface = await readRustMultiplayerConnectedSurface(page);
    assessment = assessRustMultiplayerConnectedSurface(surface, expected);
    if (assessment.status === "ready") {
      return Object.freeze({ ...assessment, surface: structuredClone(surface) });
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(50,
      Math.max(1, boundedTimeoutMilliseconds - (Date.now() - started)))));
  }
  const error = new Error(`Multiplayer connection readiness timed out: ${JSON.stringify({ expected, assessment, surface })}`);
  error.code = "BLOCKWILD_MULTIPLAYER_CONNECTED_TIMEOUT";
  error.connectionReadinessEvidence = Object.freeze({
    expected: structuredClone(expected),
    timeoutMilliseconds: boundedTimeoutMilliseconds,
    assessment,
    surface: structuredClone(surface),
  });
  throw error;
}

async function readConnectionDiagnostics(page, label) {
  return page.evaluate((contextLabel) => {
    const parse = (name) => {
      const renderer = window[name];
      if (typeof renderer !== "function") return null;
      try { return JSON.parse(renderer()); } catch { return null; }
    };
    const compactText = (value, maximum = 512) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maximum);
    const visibleAlerts = [...document.querySelectorAll('[role="alert"]')]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
      })
      .map((element) => compactText(element.textContent))
      .filter(Boolean)
      .slice(0, 8);
    const state = parse("render_game_to_text");
    const runtime = parse("render_rust_runtime_to_text");
    return {
      label: contextLabel,
      ui: {
        status: compactText(document.querySelector(".multiplayer-status-row strong")?.textContent, 80) || null,
        peerCount: document.querySelectorAll(".multiplayer-peer-list > div").length,
        visibleAlerts,
      },
      state: {
        worldSeed: state?.world?.seed ?? null,
        multiplayerStatus: state?.multiplayer?.status ?? null,
        multiplayerRole: state?.multiplayer?.role ?? null,
        multiplayerError: compactText(state?.multiplayer?.error) || null,
      },
      runtime: {
        ready: runtime?.ready ?? null,
        operationsBlocked: runtime?.operationsBlocked ?? null,
        activeSessionId: runtime?.activeSessionId ?? null,
        hydration: runtime?.hydration ?? null,
        managerState: runtime?.manager?.state ?? null,
        managerRequestedGeneration: runtime?.manager?.requestedGeneration ?? null,
        managerActiveGeneration: runtime?.manager?.activeGeneration ?? null,
        transitionGeneration: runtime?.transitionGeneration ?? null,
        playerAuthorityState: runtime?.playerAuthority?.state ?? null,
        playerAuthorityGeneration: runtime?.playerAuthority?.worldGeneration ?? null,
        playerAuthorityPumpState: runtime?.playerAuthority?.pump?.state ?? null,
        playerAuthorityPumpGeneration: runtime?.playerAuthority?.pump?.worldGeneration ?? null,
        lastError: compactText(runtime?.lastError) || null,
        transportState: runtime?.multiplayer?.transport?.state ?? null,
        multiplayerLastError: compactText(runtime?.multiplayer?.lastError) || null,
        authorityDeltaSequence: runtime?.multiplayer?.authorityDeltaSequence ?? null,
        authorityDeltaApplied: runtime?.multiplayer?.authorityDeltaApplied ?? null,
      },
      rtcConfigurations: structuredClone(window.__blockwildRustMultiplayerRtcConfigurations ?? []),
    };
  }, label);
}

async function manualDirectConnect(hostPage, guestPage, previousCodes, timeoutMilliseconds, options = {}) {
  const reconnect = previousCodes !== null && previousCodes !== undefined;
  const [hostPanel, guestPanel] = await Promise.all([
    openDirectPanel(hostPage, HOST_PROFILE.name, timeoutMilliseconds, { requestedKind: "session" }),
    openDirectPanel(guestPage, GUEST_PROFILE.name, timeoutMilliseconds, {
      requestedKind: reconnect ? "title" : "session",
    }),
  ]);
  const priorOffer = previousCodes?.offer ?? "";
  await hostPage.getByRole("button", { name: "Create direct offer" }).click();
  const offerCode = await changedInputValue(
    hostPage,
    'textarea[aria-label="Host offer code"]',
    priorOffer,
    timeoutMilliseconds,
    { label: "host offer" },
  );
  const guestOfferInput = guestPage.locator("#host-invite-code");
  await guestOfferInput.fill(offerCode);
  const priorAnswer = previousCodes?.answer ?? "";
  await guestPage.getByRole("button", { name: "Create return answer" }).click();
  const answerCode = await changedInputValue(
    guestPage,
    'textarea[aria-label="Guest answer code"]',
    priorAnswer,
    timeoutMilliseconds,
    { label: "guest answer" },
  );
  const offer = summarizeRustMultiplayerManualSignal(offerCode);
  const answer = summarizeRustMultiplayerManualSignal(answerCode);
  const pair = assertRustMultiplayerSignalPair(offer, answer, {
    hostId: HOST_PROFILE.networkId,
    guestId: GUEST_PROFILE.networkId,
    worldSeed: WORLD_FIXTURE.host.seed,
  });
  await hostPage.locator("#guest-answer-code").fill(answerCode);
  await hostPage.getByRole("button", { name: "ACCEPT ANSWER" }).click();
  let connected = null;
  try {
    const [hostConnected, guestConnected] = await Promise.all([
      waitForConnected(hostPage, timeoutMilliseconds, {
        role: "host",
        peerId: pair.guestId,
        sessionId: pair.sessionId,
        requireR5PlayerAuthority: options.requireR5PlayerAuthority === true,
      }),
      waitForConnected(guestPage, timeoutMilliseconds, {
        role: "guest",
        peerId: pair.hostId,
        sessionId: pair.sessionId,
        requireGameplayRuntimeConnected: reconnect,
        requireR5PlayerAuthority: options.requireR5PlayerAuthority === true,
      }),
    ]);
    connected = Object.freeze({ host: hostConnected, guest: guestConnected });
  } catch (cause) {
    const [host, guest] = await Promise.all([
      readConnectionDiagnostics(hostPage, "host").catch((error) => ({ label: "host", diagnosticError: error instanceof Error ? error.message : String(error) })),
      readConnectionDiagnostics(guestPage, "guest").catch((error) => ({ label: "guest", diagnosticError: error instanceof Error ? error.message : String(error) })),
    ]);
    const connectionDiagnostics = {
      offer,
      answer,
      pair,
      reconnect,
      panelRouting: { host: hostPanel, guest: guestPanel },
      readinessEvidence: cause?.connectionReadinessEvidence ?? null,
      host,
      guest,
    };
    const error = new Error(`Direct WebRTC connection did not reach one peer in both contexts. Final diagnostics: ${JSON.stringify(connectionDiagnostics)}`, { cause });
    error.connectionDiagnostics = connectionDiagnostics;
    throw error;
  }
  const panelRouting = Object.freeze({
    mode: reconnect ? "title-guest-reconnect" : "in-world-initial",
    continueLocalWorldUsed: [...hostPanel.actions, ...guestPanel.actions].includes("continue-local-world"),
    host: hostPanel,
    guest: guestPanel,
    connected,
  });
  if (reconnect) assertRustMultiplayerReconnectPanelRouting(panelRouting);
  return Object.freeze({
    offerCode,
    answerCode,
    offer,
    answer,
    pair: Object.freeze({ ...pair, runtime: offer.runtime }),
    panelRouting,
  });
}

function authorityPairRoleAssessment(snapshot, label, expectedRole, expectedPeerId) {
  const reasons = [];
  const state = snapshot?.state;
  const runtime = snapshot?.runtime;
  const multiplayer = runtime?.multiplayer;
  const transport = multiplayer?.transport;
  const peers = Array.isArray(transport?.peers) ? transport.peers : [];
  const stateError = typeof state?.multiplayer?.error === "string" ? state.multiplayer.error.trim() : "";
  for (const runtimeError of collectRustMultiplayerRuntimeErrors(state, runtime)) {
    reasons.push(`${label}-runtime:${runtimeError}`);
  }
  if (stateError) reasons.push(`${label}-state:${stateError}`);
  const awaitingGuestBootstrapKeyframe = expectedRole === "guest"
    && runtime?.ready === false
    && runtime?.operationsBlocked === true
    && runtime?.hydration === "guest-bootstrap"
    && runtime?.manager?.state === "ready"
    && runtime?.manager?.host?.state === "ready";
  if (!awaitingGuestBootstrapKeyframe
    && (runtime?.ready !== true || runtime?.operationsBlocked !== false)) {
    reasons.push(`${label}-runtime-not-ready`);
  }
  if (runtime?.manager?.state !== "ready" || runtime?.manager?.host?.state !== "ready") reasons.push(`${label}-runtime-host-not-ready`);
  if (state?.multiplayer?.role !== expectedRole) reasons.push(`${label}-state-role:${String(state?.multiplayer?.role ?? "missing")}`);
  if (transport?.schema !== 1) reasons.push(`${label}-transport-schema:${String(transport?.schema ?? "missing")}`);
  if (transport?.role !== expectedRole) reasons.push(`${label}-transport-role:${String(transport?.role ?? "missing")}`);
  if (transport?.authorityMode !== "rust-authoritative") reasons.push(`${label}-transport-authority:${String(transport?.authorityMode ?? "missing")}`);
  if (transport?.state !== "connected") reasons.push(`${label}-transport-state:${String(transport?.state ?? "missing")}`);
  if (peers.length !== 1) reasons.push(`${label}-transport-peers:${peers.length}`);
  const peer = peers[0];
  if (peer && peer.peerId !== expectedPeerId) reasons.push(`${label}-transport-peer:${String(peer.peerId ?? "missing")}`);
  if (peer && peer.state !== "connected") reasons.push(`${label}-peer-state:${String(peer.state ?? "missing")}`);
  if (peer && peer.reliableState !== null && peer.reliableState !== "open") {
    reasons.push(`${label}-peer-reliable:${String(peer.reliableState)}`);
  }
  if (peer && Number(peer.protocolStrikes ?? 0) !== 0) reasons.push(`${label}-peer-protocol-strikes:${String(peer.protocolStrikes)}`);
  if (peer && Number(peer.authorityRejected ?? 0) !== 0) reasons.push(`${label}-peer-authority-rejected:${String(peer.authorityRejected)}`);
  if (peer && Number(peer.authorityErrors ?? 0) !== 0) reasons.push(`${label}-peer-authority-errors:${String(peer.authorityErrors)}`);
  return Object.freeze({ reasons: Object.freeze(reasons), transport, peer: peer ?? null });
}

export function assessRustMultiplayerAuthorityPair(hostSnapshot, guestSnapshot, pair, minimums = {}) {
  const minimumHostSequence = minimums.host ?? 1;
  const minimumGuestApplied = minimums.guest ?? 1;
  assertCondition(Number.isSafeInteger(minimumHostSequence) && minimumHostSequence >= 1,
    "Rust authority host minimum must be a positive safe integer.");
  assertCondition(Number.isSafeInteger(minimumGuestApplied) && minimumGuestApplied >= 1,
    "Rust authority guest minimum must be a positive safe integer.");
  const hostRole = authorityPairRoleAssessment(hostSnapshot, "host", "host", pair?.guestId);
  const guestRole = authorityPairRoleAssessment(guestSnapshot, "guest", "guest", pair?.hostId);
  const terminalReasons = [...hostRole.reasons, ...guestRole.reasons];
  const hostSession = hostSnapshot?.runtime?.activeSessionId ?? null;
  const guestSession = guestSnapshot?.runtime?.activeSessionId ?? null;
  if (hostSession !== pair?.sessionId) terminalReasons.push(`host-runtime-session:${String(hostSession ?? "missing")}`);
  if (guestSession !== pair?.sessionId) terminalReasons.push(`guest-runtime-session:${String(guestSession ?? "missing")}`);
  const hostSequence = hostSnapshot?.runtime?.multiplayer?.authorityDeltaSequence;
  const guestApplied = guestSnapshot?.runtime?.multiplayer?.authorityDeltaApplied;
  if (!Number.isSafeInteger(hostSequence) || hostSequence < 0) terminalReasons.push(`host-authority-sequence:${String(hostSequence)}`);
  if (!Number.isSafeInteger(guestApplied) || guestApplied < 0) terminalReasons.push(`guest-authority-applied:${String(guestApplied)}`);
  const expectedWorldSeed = pair?.runtime?.worldSeed ?? WORLD_FIXTURE.host.seed;
  const guestWorldSeed = guestSnapshot?.state?.world?.seed ?? null;
  const guestTransport = guestRole.transport?.guest;
  const guestKeyframeAccepted = guestTransport?.keyframeAccepted === true;
  const guestPresentationReady = guestTransport?.presentationReady === true;
  const guestAcceptedDeltaCount = guestTransport?.acceptedDeltaCount;
  const guestStateHash = guestSnapshot?.runtime?.multiplayer?.lastStateHash ?? null;
  const ready = terminalReasons.length === 0
    && hostSequence >= minimumHostSequence
    && guestApplied >= minimumGuestApplied
    && guestWorldSeed === expectedWorldSeed
    && guestKeyframeAccepted
    && guestPresentationReady
    && Number.isSafeInteger(guestAcceptedDeltaCount)
    && guestAcceptedDeltaCount >= 1
    && CANONICAL_HASH_PATTERN.test(guestStateHash ?? "");
  return Object.freeze({
    status: terminalReasons.length > 0 ? "terminal" : ready ? "ready" : "pending",
    terminalReasons: Object.freeze(terminalReasons),
    minimums: Object.freeze({ host: minimumHostSequence, guest: minimumGuestApplied }),
    observed: Object.freeze({
      hostSequence: Number.isSafeInteger(hostSequence) ? hostSequence : null,
      guestApplied: Number.isSafeInteger(guestApplied) ? guestApplied : null,
      guestWorldSeed,
      expectedWorldSeed,
      guestKeyframeAccepted,
      guestPresentationReady,
      guestAcceptedDeltaCount: Number.isSafeInteger(guestAcceptedDeltaCount) ? guestAcceptedDeltaCount : null,
      guestStateHash,
    }),
  });
}

async function authorityPairFailureDiagnostics(hostPage, guestPage, minimums, assessment, readDiagnostics) {
  const [host, guest] = await Promise.all([
    readDiagnostics(hostPage, "host").catch((error) => ({ label: "host", diagnosticError: error instanceof Error ? error.message : String(error) })),
    readDiagnostics(guestPage, "guest").catch((error) => ({ label: "guest", diagnosticError: error instanceof Error ? error.message : String(error) })),
  ]);
  return Object.freeze({
    host,
    guest,
    minimums: Object.freeze({ ...minimums }),
    assessment,
  });
}

export async function waitForAuthorityPair(hostPage, guestPage, pair, minimums, timeoutMilliseconds, options = {}) {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readSnapshot = options.readSnapshot ?? ((page) => readBrowserSnapshot(page));
  const readDiagnostics = options.readDiagnostics ?? ((page, label) => readConnectionDiagnostics(page, label));
  const pollMilliseconds = options.pollMilliseconds ?? 50;
  const boundedTimeoutMilliseconds = Math.min(timeoutMilliseconds, 300_000);
  const started = now();
  let attempts = 0;
  let hostSnapshot = null;
  let guestSnapshot = null;
  let assessment = null;
  while (now() - started <= boundedTimeoutMilliseconds) {
    attempts += 1;
    try {
      [hostSnapshot, guestSnapshot] = await Promise.all([
        readSnapshot(hostPage, "host"),
        readSnapshot(guestPage, "guest"),
      ]);
    } catch (cause) {
      const diagnostics = await authorityPairFailureDiagnostics(
        hostPage, guestPage, minimums, assessment, readDiagnostics,
      );
      const error = new Error(`Rust authority pair snapshot failed closed. Final diagnostics: ${JSON.stringify(diagnostics)}`, { cause });
      error.code = "BLOCKWILD_AUTHORITY_PAIR_READ_ERROR";
      error.authorityDiagnostics = diagnostics;
      throw error;
    }
    assessment = assessRustMultiplayerAuthorityPair(hostSnapshot, guestSnapshot, pair, minimums);
    if (assessment.status === "ready") break;
    if (assessment.status === "terminal") {
      const diagnostics = await authorityPairFailureDiagnostics(
        hostPage, guestPage, minimums, assessment, readDiagnostics,
      );
      const error = new Error(`Rust authority pair became terminal before a fresh keyframe: ${JSON.stringify(diagnostics)}`);
      error.code = "BLOCKWILD_AUTHORITY_PAIR_TERMINAL";
      error.authorityDiagnostics = diagnostics;
      throw error;
    }
    await sleep(Math.min(pollMilliseconds, Math.max(1, boundedTimeoutMilliseconds - (now() - started))));
  }
  if (assessment?.status !== "ready") {
    const diagnostics = await authorityPairFailureDiagnostics(
      hostPage, guestPage, minimums, assessment, readDiagnostics,
    );
    const error = new Error(`Rust authority pair did not reach a fresh keyframe. Final diagnostics: ${JSON.stringify(diagnostics)}`);
    error.code = "BLOCKWILD_AUTHORITY_PAIR_TIMEOUT";
    error.authorityDiagnostics = diagnostics;
    throw error;
  }
  for (const [label, snapshot] of [["host", hostSnapshot], ["guest", guestSnapshot]]) {
    const errors = collectRustMultiplayerRuntimeErrors(snapshot.state, snapshot.runtime);
    assertCondition(errors.length === 0, `${label} runtime errors: ${errors.join(" | ")}`);
  }
  const proof = assertRustMultiplayerRuntimePair(hostSnapshot.runtime, guestSnapshot.runtime, pair, {
    minimumHostSequence: minimums.host,
    minimumGuestApplied: minimums.guest,
    universeId: pair.runtime.universeId,
    locationId: pair.runtime.locationId,
  });
  const generationCertificates = Object.freeze({
    host: assertRustMultiplayerGenerationAudit(hostSnapshot, REQUIRED_MULTIPLAYER_ARTIFACT_HASH, "host browser"),
    guest: assertRustMultiplayerGenerationAudit(guestSnapshot, REQUIRED_MULTIPLAYER_ARTIFACT_HASH, "guest browser"),
  });
  return Object.freeze({ hostSnapshot, guestSnapshot, proof, generationCertificates, authorityWait: Object.freeze({ attempts, assessment }) });
}

function panelRuntimeDiagnostics(snapshot, label, phase) {
  return Object.freeze({
    label,
    phase,
    gameState: snapshot?.state?.state ?? null,
    multiplayer: Object.freeze({ ...(snapshot?.state?.multiplayer ?? {}) }),
    runtime: Object.freeze({
      ready: snapshot?.runtime?.ready ?? null,
      operationsBlocked: snapshot?.runtime?.operationsBlocked ?? null,
      hydration: snapshot?.runtime?.hydration ?? null,
      manager: Object.freeze({ ...(snapshot?.runtime?.manager ?? {}) }),
      multiplayer: Object.freeze({ ...(snapshot?.runtime?.multiplayer ?? {}) }),
    }),
    runtimeLifecycle: Object.freeze((snapshot?.generationAudit?.runtimeLifecycle ?? [])
      .slice(-64).map((entry) => Object.freeze({ ...entry }))),
  });
}

async function leaveMultiplayerPanel(page, label = "browser") {
  const before = await readBrowserSnapshot(page);
  if (before.runtime?.ready !== true
    || before.runtime?.operationsBlocked !== false
    || before.runtime?.manager?.state !== "ready"
    || before.runtime?.manager?.host?.state !== "ready") {
    const error = new Error(`${label} Rust runtime stopped before leaving the multiplayer panel.`);
    error.authorityDiagnostics = panelRuntimeDiagnostics(before, label, "before-panel-exit");
    throw error;
  }
  await page.locator(".multiplayer-actions").getByRole("button", { name: "Back" }).click();
  await page.getByRole("heading", { name: /^(?:Game Paused|Session Menu)$/u }).waitFor();
  await page.getByRole("button", { name: "Back to Game" }).click();
  try {
    await page.waitForFunction(() => {
      try { return JSON.parse(window.render_game_to_text?.() ?? "null")?.state === "playing"; }
      catch { return false; }
    });
  } catch (cause) {
    const after = await readBrowserSnapshot(page).catch(() => null);
    const error = new Error(`${label} did not resume after leaving the multiplayer panel.`, { cause });
    error.authorityDiagnostics = panelRuntimeDiagnostics(after, label, "after-back-to-game");
    throw error;
  }
}

function parseMapPin(label, expectedName) {
  const match = new RegExp(`^${expectedName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} at (-?\\d+), (-?\\d+)$`, "u").exec(label ?? "");
  if (!match) throw new Error(`Host map pin does not identify ${expectedName}: ${String(label)}`);
  return Object.freeze({ name: expectedName, x: Number(match[1]), z: Number(match[2]), label });
}

async function hostMapPins(page) {
  const values = await page.locator(".hearthroads-other-player-pin").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
  return values.map((value) => parseMapPin(value, GUEST_PROFILE.name));
}

export function rustMultiplayerMapPinConverged(pins, priorLabel, expectedPosition, maximumDistance = 2) {
  if (!Array.isArray(pins) || pins.length !== 1 || !Array.isArray(expectedPosition) || expectedPosition.length !== 3) return false;
  const pin = pins[0];
  if (!pin || pin.label === priorLabel || !Number.isFinite(pin.x) || !Number.isFinite(pin.z)) return false;
  if (!Number.isFinite(expectedPosition[0]) || !Number.isFinite(expectedPosition[2]) || !Number.isFinite(maximumDistance) || maximumDistance < 0) return false;
  return Math.hypot(pin.x - Math.round(expectedPosition[0]), pin.z - Math.round(expectedPosition[2])) <= maximumDistance;
}

export async function waitForRustMultiplayerMapPinConvergence(page, priorLabel, expectedPosition, timeoutMilliseconds, options = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readPins = options.readPins ?? hostMapPins;
  const pollMilliseconds = options.pollMilliseconds ?? 25;
  const deadline = now() + timeoutMilliseconds;
  let pins = [];
  while (now() <= deadline) {
    try {
      pins = await readPins(page);
    } catch (cause) {
      const error = new Error("Host map pin could not be parsed while waiting for movement convergence.", { cause });
      error.mapPinEvidence = Object.freeze({
        priorLabel,
        expectedPosition: Object.freeze(expectedPosition.slice(0, 3)),
        finalPins: Object.freeze([]),
        readError: cause instanceof Error ? cause.message : String(cause),
      });
      throw error;
    }
    if (rustMultiplayerMapPinConverged(pins, priorLabel, expectedPosition)) return pins;
    await sleep(Math.min(pollMilliseconds, Math.max(1, deadline - now())));
  }
  const error = new Error(`Host map pin did not converge on the moved guest. Expected ${JSON.stringify(expectedPosition)}; final pins: ${JSON.stringify(pins)}`);
  error.mapPinEvidence = Object.freeze({
    priorLabel,
    expectedPosition: Object.freeze(expectedPosition.slice(0, 3)),
    finalPins: Object.freeze(pins.map((pin) => Object.freeze({ ...pin }))),
  });
  throw error;
}

function horizontalDistance(left, right) {
  return Math.hypot(Number(right[0]) - Number(left[0]), Number(right[2]) - Number(left[2]));
}

function movementDeltaSnapshot(snapshot) {
  return Object.freeze({
    runtime: Object.freeze({
      multiplayer: Object.freeze({ ...(snapshot?.runtime?.multiplayer ?? {}) }),
    }),
  });
}

function compactNativePoseCustody(value) {
  if (!value || typeof value !== "object") return null;
  return Object.freeze({
    connectionGeneration: Number.isSafeInteger(value.connectionGeneration) ? value.connectionGeneration : null,
    commandSequence: Number.isSafeInteger(value.commandSequence) ? value.commandSequence : null,
    recordRevision: Number.isSafeInteger(value.recordRevision) ? value.recordRevision : null,
    receiptHash: CANONICAL_HASH_PATTERN.test(value.receiptHash ?? "") ? value.receiptHash : null,
    recordHash: CANONICAL_HASH_PATTERN.test(value.recordHash ?? "") ? value.recordHash : null,
  });
}

function compactMovementRemotePlayer(player) {
  return Object.freeze({
    id: typeof player?.id === "string" ? player.id : null,
    name: typeof player?.name === "string" ? player.name : null,
    position: Array.isArray(player?.position)
      ? Object.freeze(player.position.slice(0, 3).map((value) => Number.isFinite(value) ? value : null))
      : null,
    tick: Number.isSafeInteger(player?.tick) ? player.tick : null,
    ageMilliseconds: Number.isFinite(player?.ageMilliseconds) ? player.ageMilliseconds : null,
    nativePoseCustody: compactNativePoseCustody(player?.nativePoseCustody),
  });
}

export function compactRustMultiplayerMovementDiagnostics(snapshot) {
  const audit = snapshot?.generationAudit;
  const pump = snapshot?.runtime?.playerAuthority?.pump;
  return Object.freeze({
    gameState: snapshot?.state?.state ?? null,
    playerPosition: Array.isArray(snapshot?.state?.player?.position)
      ? Object.freeze(snapshot.state.player.position.slice(0, 3))
      : null,
    remotePlayers: Object.freeze((snapshot?.state?.multiplayer?.remotePlayers ?? []).slice(0, 16)
      .map(compactMovementRemotePlayer)),
    multiplayer: Object.freeze({ ...(snapshot?.runtime?.multiplayer ?? {}) }),
    runtime: Object.freeze({
      ready: snapshot?.runtime?.ready ?? null,
      operationsBlocked: snapshot?.runtime?.operationsBlocked ?? null,
      transitionGeneration: snapshot?.runtime?.transitionGeneration ?? null,
      activeSessionId: snapshot?.runtime?.activeSessionId ?? null,
      hydration: snapshot?.runtime?.hydration ?? null,
      managerState: snapshot?.runtime?.manager?.state ?? null,
      hostState: snapshot?.runtime?.manager?.host?.state ?? null,
    }),
    playerAuthority: Object.freeze({
      state: snapshot?.runtime?.playerAuthority?.state ?? null,
      worldGeneration: snapshot?.runtime?.playerAuthority?.worldGeneration ?? null,
      runtimeSessionId: snapshot?.runtime?.playerAuthority?.runtimeSessionId ?? null,
      advanceInFlight: snapshot?.runtime?.playerAuthority?.advanceInFlight ?? null,
      lastError: snapshot?.runtime?.playerAuthority?.lastError ?? null,
      pump: pump ? Object.freeze({
        state: pump.state ?? null,
        worldGeneration: pump.worldGeneration ?? null,
        lastAuthorityTick: pump.lastAuthorityTick ?? null,
        lastNetworkRevision: pump.lastNetworkRevision ?? null,
        networkIdentityAdoptions: pump.networkIdentityAdoptions ?? null,
        nextInputSequence: pump.nextInputSequence ?? null,
        inFlight: pump.inFlight ?? null,
        queuedAdvances: pump.queuedAdvances ?? null,
        nativeInputPending: pump.nativeInputPending ?? null,
        pendingInputSequence: pump.pendingInputSequence ?? null,
        lastAppliedButtons: pump.lastAppliedButtons ?? null,
        lastError: pump.lastError ?? null,
      }) : null,
    }),
    outboundPlayerPoses: Object.freeze((audit?.outboundPlayerPoses ?? []).slice(-16).map((pose) => Object.freeze({ ...pose }))),
    generationStartupErrors: Object.freeze((audit?.generationStartupErrors ?? []).slice(-8).map((error) => Object.freeze({ ...error }))),
  });
}

export async function waitForRustMultiplayerMovementEndpoint(page, startPosition, minimumAuthoritySequence, timeoutMilliseconds, options = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readSnapshot = options.readSnapshot ?? readBrowserSnapshot;
  const pollMilliseconds = options.pollMilliseconds ?? 50;
  const stableDistance = options.stableDistance ?? 0.025;
  const requiredStableIntervals = options.requiredStableIntervals ?? 2;
  const deadline = now() + timeoutMilliseconds;
  let previousPosition = null;
  let stableIntervals = 0;
  let lastEvidence = null;
  while (now() <= deadline) {
    const snapshot = await readSnapshot(page);
    const position = snapshot?.state?.player?.position;
    const poses = (snapshot?.generationAudit?.outboundPlayerPoses ?? []).filter((pose) => (
      Number.isSafeInteger(pose?.authoritySequence)
      && pose.authoritySequence > minimumAuthoritySequence
      && pose.from === GUEST_PROFILE.networkId
      && pose.playerId === GUEST_PROFILE.networkId
      && Array.isArray(pose.position)
      && pose.position.length === 3
      && pose.position.every(Number.isFinite)
      && horizontalDistance(startPosition, pose.position) > 1
    ));
    const authorityPose = poses.at(-1) ?? null;
    const validPosition = Array.isArray(position) && position.length === 3 && position.every(Number.isFinite);
    const authorityConverged = validPosition && authorityPose
      ? horizontalDistance(authorityPose.position, position) <= 0.5
      : false;
    if (validPosition && authorityConverged && previousPosition
      && horizontalDistance(previousPosition, position) <= stableDistance) stableIntervals += 1;
    else stableIntervals = 0;
    lastEvidence = Object.freeze({
      position: validPosition ? Object.freeze(position.slice(0, 3)) : null,
      authorityPose: authorityPose ? Object.freeze({ ...authorityPose }) : null,
      stableIntervals,
    });
    const terminalReasons = [];
    const gameState = snapshot?.state?.state ?? null;
    if (gameState !== null && gameState !== "playing") terminalReasons.push(`guest game state: ${String(gameState)}`);
    terminalReasons.push(...collectRustMultiplayerRuntimeErrors(snapshot?.state, snapshot?.runtime));
    const transportState = snapshot?.runtime?.multiplayer?.transport?.state ?? null;
    if (transportState !== null && transportState !== "connected") {
      terminalReasons.push(`guest transport state: ${String(transportState)}`);
    }
    if (terminalReasons.length > 0) {
      const error = new Error(`Guest movement endpoint became terminal: ${terminalReasons.join(" | ")}`);
      error.endpointEvidence = Object.freeze({ ...lastEvidence, terminalReasons: Object.freeze(terminalReasons) });
      throw error;
    }
    if (stableIntervals >= requiredStableIntervals) {
      return Object.freeze({ snapshot, position: lastEvidence.position, authorityPose: lastEvidence.authorityPose });
    }
    previousPosition = validPosition ? position.slice(0, 3) : null;
    await sleep(Math.min(pollMilliseconds, Math.max(1, deadline - now())));
  }
  const error = new Error("Guest movement did not reach a stable post-release authority endpoint.");
  error.endpointEvidence = lastEvidence;
  throw error;
}

function finiteMovementPosition(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function assessRustMultiplayerNativePoseConvergence(
  hostSnapshot,
  guestSnapshot,
  endpointPosition,
  minimumAuthoritySequence,
  priorNativePoseCustody,
) {
  const remotePlayers = (hostSnapshot?.state?.multiplayer?.remotePlayers ?? [])
    .filter((player) => player?.id === GUEST_PROFILE.networkId);
  const remotePlayer = remotePlayers.length === 1 ? compactMovementRemotePlayer(remotePlayers[0]) : null;
  const nativePoseCustody = remotePlayer?.nativePoseCustody ?? null;
  const hostTransport = compactRustMultiplayerAuthorityCommandEvidence(hostSnapshot, GUEST_PROFILE.networkId);
  const transportPeers = (hostSnapshot?.runtime?.multiplayer?.transport?.peers ?? [])
    .filter((peer) => peer?.peerId === GUEST_PROFILE.networkId);
  const transportPeer = transportPeers.length === 1 ? hostTransport.peer : null;
  const nativeAuthorityPoses = nativePoseCustody === null
    ? []
    : (guestSnapshot?.generationAudit?.outboundPlayerPoses ?? []).filter((pose) => (
      pose?.authoritySequence === nativePoseCustody.commandSequence
      && pose.from === GUEST_PROFILE.networkId
      && pose.playerId === GUEST_PROFILE.networkId
    ));
  const nativeAuthorityPose = nativeAuthorityPoses.length === 1
    ? Object.freeze({ ...nativeAuthorityPoses[0] })
    : null;
  const hostRuntimeErrors = collectRustMultiplayerRuntimeErrors(hostSnapshot?.state, hostSnapshot?.runtime);
  const guestRuntimeErrors = collectRustMultiplayerRuntimeErrors(guestSnapshot?.state, guestSnapshot?.runtime);
  const endpointDistance = finiteMovementPosition(remotePlayer?.position)
    ? horizontalDistance(remotePlayer.position, endpointPosition)
    : null;
  const poseDistance = finiteMovementPosition(remotePlayer?.position) && finiteMovementPosition(nativeAuthorityPose?.position)
    ? horizontalDistance(remotePlayer.position, nativeAuthorityPose.position)
    : null;
  const priorProjectionAdvanced = priorNativePoseCustody === null || (
    nativePoseCustody?.connectionGeneration === priorNativePoseCustody.connectionGeneration
    && Number.isSafeInteger(nativePoseCustody?.commandSequence)
    && nativePoseCustody.commandSequence > priorNativePoseCustody.commandSequence
    && Number.isSafeInteger(nativePoseCustody?.recordRevision)
    && nativePoseCustody.recordRevision > priorNativePoseCustody.recordRevision
    && nativePoseCustody.receiptHash !== priorNativePoseCustody.receiptHash
    && nativePoseCustody.recordHash !== priorNativePoseCustody.recordHash
  );
  const projectionBound = Number.isSafeInteger(nativePoseCustody?.connectionGeneration)
    && nativePoseCustody.connectionGeneration >= 1
    && Number.isSafeInteger(nativePoseCustody?.commandSequence)
    && nativePoseCustody.commandSequence >= minimumAuthoritySequence
    && Number.isSafeInteger(nativePoseCustody?.recordRevision)
    && nativePoseCustody.recordRevision >= 1
    && CANONICAL_HASH_PATTERN.test(nativePoseCustody.receiptHash ?? "")
    && CANONICAL_HASH_PATTERN.test(nativePoseCustody.recordHash ?? "")
    && priorProjectionAdvanced
    && nativeAuthorityPose !== null
    && Number.isSafeInteger(nativeAuthorityPose.tick)
    && nativeAuthorityPose.tick === remotePlayer?.tick
    && finiteMovementPosition(nativeAuthorityPose.position)
    && endpointDistance !== null
    && endpointDistance <= 0.5
    && poseDistance !== null
    && poseDistance <= 0.025;
  const transportBound = hostTransport.transportState === "connected"
    && hostTransport.transportRole === "host"
    && hostTransport.authorityMode === "rust-authoritative"
    && transportPeer?.state === "connected"
    && transportPeer.authorityGeneration === nativePoseCustody?.connectionGeneration
    && Number.isSafeInteger(transportPeer.authorityQueued)
    && Number.isSafeInteger(transportPeer.authorityAccepted)
    && transportPeer.authorityQueued >= transportPeer.authorityAccepted
    && transportPeer.authorityAccepted >= (nativePoseCustody?.commandSequence ?? Number.MAX_SAFE_INTEGER) + 1
    && Number.isSafeInteger(transportPeer.nativePoseAccepted)
    && transportPeer.nativePoseAccepted >= 1
    && transportPeer.nativePoseDelivered === transportPeer.nativePoseAccepted
    && transportPeer.nativePoseStaleGenerationDrops === 0
    && transportPeer.lastNativePoseCommandSequence === nativePoseCustody?.commandSequence
    && transportPeer.lastNativePoseRecordRevision === nativePoseCustody?.recordRevision
    && transportPeer.lastNativePoseReceiptHash === nativePoseCustody?.receiptHash
    && transportPeer.lastNativePoseRecordHash === nativePoseCustody?.recordHash
    && transportPeer.authorityRejected === 0
    && transportPeer.authorityErrors === 0
    && transportPeer.protocolStrikes === 0;
  const terminalReasons = [];
  if (hostRuntimeErrors.length > 0) terminalReasons.push(...hostRuntimeErrors.map((error) => `host: ${error}`));
  if (guestRuntimeErrors.length > 0) terminalReasons.push(...guestRuntimeErrors.map((error) => `guest: ${error}`));
  if (hostSnapshot?.state?.state !== "playing" && hostSnapshot?.state?.state !== "paused") {
    terminalReasons.push(`host game state: ${String(hostSnapshot?.state?.state)}`);
  }
  if (guestSnapshot?.state?.state !== "playing") terminalReasons.push(`guest game state: ${String(guestSnapshot?.state?.state)}`);
  if (remotePlayers.length > 1) terminalReasons.push(`duplicate host guest records: ${remotePlayers.length}`);
  if (transportPeers.length > 1) terminalReasons.push(`duplicate host guest transport peers: ${transportPeers.length}`);
  if (hostTransport.transportState !== null && hostTransport.transportState !== "connected") {
    terminalReasons.push(`host transport state: ${String(hostTransport.transportState)}`);
  }
  if (transportPeer?.state !== undefined && transportPeer?.state !== null && transportPeer.state !== "connected") {
    terminalReasons.push(`host peer state: ${String(transportPeer.state)}`);
  }
  for (const [label, value] of [
    ["authority rejections", transportPeer?.authorityRejected],
    ["authority errors", transportPeer?.authorityErrors],
    ["protocol strikes", transportPeer?.protocolStrikes],
    ["stale-generation drops", transportPeer?.nativePoseStaleGenerationDrops],
  ]) {
    if (Number.isSafeInteger(value) && value > 0) terminalReasons.push(`${label}: ${value}`);
  }
  const evidence = Object.freeze({
    expectedPosition: Object.freeze(endpointPosition.slice(0, 3)),
    minimumAuthoritySequence,
    hostGameState: hostSnapshot?.state?.state ?? null,
    guestGameState: guestSnapshot?.state?.state ?? null,
    hostRuntimeErrors: Object.freeze([...hostRuntimeErrors]),
    guestRuntimeErrors: Object.freeze([...guestRuntimeErrors]),
    remotePlayerCount: remotePlayers.length,
    transportPeerCount: transportPeers.length,
    remotePlayer,
    nativePoseCustody,
    nativeAuthorityPose,
    nativeAuthorityPoseCount: nativeAuthorityPoses.length,
    hostTransport,
    endpointDistance,
    poseDistance,
    priorProjectionAdvanced,
    projectionBound,
    transportBound,
    terminalReasons: Object.freeze(terminalReasons),
  });
  return Object.freeze({
    converged: terminalReasons.length === 0 && projectionBound && transportBound,
    terminal: terminalReasons.length > 0,
    evidence,
    hostSnapshot,
    guestSnapshot,
    remotePlayer,
    nativePoseCustody,
    nativeAuthorityPose,
    hostTransport,
  });
}

export async function waitForRustMultiplayerNativePoseConvergence(
  hostPage,
  guestPage,
  endpointPosition,
  minimumAuthoritySequence,
  timeoutMilliseconds,
  options = {},
) {
  assertCondition(finiteMovementPosition(endpointPosition), "Native pose convergence endpoint is malformed.");
  assertCondition(Number.isSafeInteger(minimumAuthoritySequence) && minimumAuthoritySequence >= 0,
    "Native pose convergence minimum authority sequence is malformed.");
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readSnapshot = options.readSnapshot ?? readBrowserSnapshot;
  const pollMilliseconds = options.pollMilliseconds ?? 50;
  const stableDistance = options.stableDistance ?? 0.025;
  const requiredStableIntervals = options.requiredStableIntervals ?? 2;
  const priorNativePoseCustody = options.priorNativePoseCustody ?? null;
  const deadline = now() + timeoutMilliseconds;
  let stableIntervals = 0;
  let previousPosition = null;
  let lastAssessment = null;
  while (now() <= deadline) {
    // Preserve causality: a host projection captured first must already have
    // passed through the guest's synchronous outbound audit captured second.
    const hostSnapshot = await readSnapshot(hostPage);
    const guestSnapshot = await readSnapshot(guestPage);
    const assessment = assessRustMultiplayerNativePoseConvergence(
      hostSnapshot,
      guestSnapshot,
      endpointPosition,
      minimumAuthoritySequence,
      priorNativePoseCustody,
    );
    const currentPosition = assessment.remotePlayer?.position;
    if (assessment.converged && finiteMovementPosition(previousPosition)
      && horizontalDistance(previousPosition, currentPosition) <= stableDistance) stableIntervals += 1;
    else stableIntervals = assessment.converged ? 1 : 0;
    lastAssessment = assessment;
    if (assessment.terminal) {
      const error = new Error(`Host native pose convergence became terminal: ${assessment.evidence.terminalReasons.join(" | ")}`);
      error.nativePoseConvergenceEvidence = assessment.evidence;
      throw error;
    }
    if (assessment.converged && stableIntervals >= requiredStableIntervals) {
      return Object.freeze({
        hostSnapshot: assessment.hostSnapshot,
        guestSnapshot: assessment.guestSnapshot,
        remotePlayer: assessment.remotePlayer,
        nativePoseCustody: assessment.nativePoseCustody,
        nativeAuthorityPose: assessment.nativeAuthorityPose,
        hostTransport: assessment.hostTransport,
        stableIntervals,
        evidence: assessment.evidence,
      });
    }
    previousPosition = assessment.converged ? currentPosition.slice(0, 3) : null;
    await sleep(Math.min(pollMilliseconds, Math.max(1, deadline - now())));
  }
  const error = new Error("Host native pose did not converge on the final guest movement endpoint.");
  error.nativePoseConvergenceEvidence = lastAssessment?.evidence ?? null;
  throw error;
}

async function readMovementAuthorityDiagnostics(hostPage, guestPage) {
  const [hostSnapshot, guestSnapshot, hostConnection, guestConnection, pins] = await Promise.all([
    readBrowserSnapshot(hostPage),
    readBrowserSnapshot(guestPage),
    readConnectionDiagnostics(hostPage, "host"),
    readConnectionDiagnostics(guestPage, "guest"),
    hostMapPins(hostPage).catch(() => []),
  ]);
  return Object.freeze({
    host: compactRustMultiplayerMovementDiagnostics(hostSnapshot),
    guest: compactRustMultiplayerMovementDiagnostics(guestSnapshot),
    connections: Object.freeze({ host: hostConnection, guest: guestConnection }),
    hostMapPins: Object.freeze(pins),
  });
}

async function pulseGuestRustLiveMovement(page, index, frameCount) {
  const pulse = await page.evaluate(async (frames) => {
    if (typeof window.pulse_game_key !== "function") {
      throw new Error("Serialized native movement automation is unavailable");
    }
    return await window.pulse_game_key("KeyD", frames);
  }, frameCount);
  assertCondition(pulse?.schema === 1 && pulse.key === "KeyD" && pulse.frameCount === frameCount,
    "Serialized native movement automation returned a malformed receipt.");
  return Object.freeze({ index, ...pulse });
}

async function pulseGuestLegacyMovement(page, index, frameCount) {
  const pulse = await page.evaluate(async (frames) => {
    if (typeof window.set_game_key !== "function" || typeof window.requestAnimationFrame !== "function") {
      throw new Error("Bounded legacy movement automation is unavailable");
    }
    const startedAt = performance.now();
    let completedFrames = 0;
    window.set_game_key("KeyD", true);
    try {
      for (let frame = 0; frame < frames; frame += 1) {
        await new Promise((resolve) => window.requestAnimationFrame(() => {
          completedFrames += 1;
          resolve();
        }));
      }
    } finally {
      window.set_game_key("KeyD", false);
    }
    return {
      schema: 1,
      key: "KeyD",
      frameCount: frames,
      completedFrames,
      elapsedMilliseconds: performance.now() - startedAt,
      released: true,
    };
  }, frameCount);
  assertCondition(pulse?.schema === 1
    && pulse.key === "KeyD"
    && pulse.frameCount === frameCount
    && pulse.completedFrames === frameCount
    && pulse.released === true
    && Number.isFinite(pulse.elapsedMilliseconds)
    && pulse.elapsedMilliseconds >= 0
    && pulse.elapsedMilliseconds <= MULTIPLAYER_MOVEMENT_MAX_FRAME_ELAPSED_MILLISECONDS,
  "Bounded legacy movement automation returned a malformed receipt.");
  return Object.freeze({ index, ...pulse });
}

async function waitForReconnectDenseCommandStream(
  hostPage,
  guestPage,
  commandAuditStartIndex,
  reconnectCursor,
  timeoutMilliseconds,
) {
  const deadline = Date.now() + Math.min(timeoutMilliseconds, 45_000);
  let lastEvidence = null;
  while (Date.now() <= deadline) {
    const [hostSnapshot, guestSnapshot] = await Promise.all([
      readBrowserSnapshot(hostPage),
      readBrowserSnapshot(guestPage),
    ]);
    const commands = (guestSnapshot?.generationAudit?.outboundAuthorityCommands ?? [])
      .slice(commandAuditStartIndex);
    const poseSequences = commands
      .filter((record) => record?.type === "player-pose")
      .map((record) => record.authoritySequence);
    const hostObserved = compactRustMultiplayerAuthorityCommandEvidence(hostSnapshot, GUEST_PROFILE.networkId);
    const guestObserved = compactRustMultiplayerAuthorityCommandEvidence(guestSnapshot, HOST_PROFILE.networkId);
    const dense = commands.every((record, index) => (
      typeof record?.type === "string"
      && record.type.length > 0
      && record.authoritySequence === reconnectCursor + index
      && record.from === GUEST_PROFILE.networkId
      && record.transportRole === "guest"
      && record.guestPresentationReady === true
    ));
    lastEvidence = Object.freeze({
      commands: Object.freeze(commands.slice(-64).map((record) => Object.freeze({ ...record }))),
      poseSequences: Object.freeze([...poseSequences]),
      hostObserved,
      guestObserved,
    });
    if (commands.length >= 2
      && poseSequences.length >= 2
      && dense
      && guestObserved.outboundAuthorityCommandSequence === reconnectCursor + commands.length
      && hostObserved.transportState === "connected"
      && hostObserved.transportRole === "host"
      && hostObserved.authorityMode === "rust-authoritative"
      && hostObserved.authorityOperations === 0
      && hostObserved.peer?.state === "connected"
      && hostObserved.peer.authorityQueued === commands.length
      && hostObserved.peer.authorityInFlight === 0
      && hostObserved.peer.authorityAccepted === commands.length
      && hostObserved.peer.authorityRejected === 0
      && hostObserved.peer.authorityErrors === 0
      && hostObserved.peer.protocolStrikes === 0) {
      return Object.freeze({
        commands: Object.freeze(commands.map((record) => Object.freeze({ ...record }))),
        poseSequences: Object.freeze([...poseSequences]),
        hostObserved,
        guestObserved,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Reconnect command stream did not become dense and host-accepted after two pose heartbeats: ${JSON.stringify(lastEvidence)}`);
}

async function exerciseReconnectAuthorityCommandContinuity(
  hostPage,
  guestPage,
  initialHostObserved,
  initialCommandBoundary,
  timeoutMilliseconds,
) {
  const initialSequence = initialHostObserved?.finalAcceptedAuthoritySequence;
  assertCondition(Number.isSafeInteger(initialSequence) && initialSequence >= 0,
    "Reconnect has no final host-observed initial authority command sequence.");
  const guestCommandAuditStartIndex = initialCommandBoundary?.auditCount;
  const finalInitialAuthoredSequence = initialCommandBoundary?.lastAuthoritySequence;
  assertCondition(Number.isSafeInteger(guestCommandAuditStartIndex) && guestCommandAuditStartIndex >= 1,
    "Reconnect guest command-audit boundary is malformed.");
  assertCondition(Number.isSafeInteger(finalInitialAuthoredSequence)
    && finalInitialAuthoredSequence >= initialSequence,
  "Reconnect guest post-drain command cursor regressed behind the host's pre-disconnect lower bound.");
  const reconnectCursor = finalInitialAuthoredSequence + 1;
  const stream = await waitForReconnectDenseCommandStream(
    hostPage,
    guestPage,
    guestCommandAuditStartIndex,
    reconnectCursor,
    timeoutMilliseconds,
  );
  const continuity = Object.freeze({
    schema: 1,
    initialHostObserved,
    initialCommandBoundary,
    reconnectCursor,
    commands: stream.commands,
    poseAuthoritySequences: stream.poseSequences,
    reconnectHostObserved: stream.hostObserved,
    guestFinalAuthorityCommandSequence: stream.guestObserved.outboundAuthorityCommandSequence,
  });
  assertRustMultiplayerReconnectCommandContinuity(continuity);
  return continuity;
}

async function exerciseGuestMovement(hostPage, guestPage, signalPair, timeoutMilliseconds, options = {}) {
  // Pointer lock is process-global enough in Chromium that asking two visible
  // pages to acquire it concurrently can leave one engine paused even though
  // both overlays closed. Give the host the lock first, move it into the map
  // (which releases the lock), and only then resume the guest that must move.
  await leaveMultiplayerPanel(hostPage, "host");
  await hostPage.keyboard.press("m");
  await hostPage.getByRole("heading", { name: "Known Roads" }).waitFor();
  await leaveMultiplayerPanel(guestPage, "guest");
  const poseConvergenceTimeoutMilliseconds = Math.min(timeoutMilliseconds, 90_000);
  try {
    await hostPage.waitForFunction(
      () => document.querySelectorAll(".hearthroads-other-player-pin").length === 1,
      undefined,
      { timeout: poseConvergenceTimeoutMilliseconds },
    );
  } catch (cause) {
    const diagnostics = await readMovementAuthorityDiagnostics(hostPage, guestPage);
    const error = new Error(`Host map did not receive the initial Rust-authorized guest pose. Final diagnostics: ${JSON.stringify(diagnostics)}`, { cause });
    error.authorityDiagnostics = diagnostics;
    throw error;
  }
  const requireR5PlayerAuthority = options.requireR5PlayerAuthority === true;
  const movementFramesPerPulse = requireR5PlayerAuthority
    ? MULTIPLAYER_MOVEMENT_FRAMES_PER_PULSE
    : MULTIPLAYER_LEGACY_MOVEMENT_FRAMES_PER_PULSE;
  const initialPins = await hostMapPins(hostPage);
  assertCondition(initialPins.length === 1, `Host map contains ${initialPins.length} guest pins before movement.`);
  const [initialHost, initialGuest] = await Promise.all([readBrowserSnapshot(hostPage), readBrowserSnapshot(guestPage)]);
  const initialR5PlayerAuthority = requireR5PlayerAuthority
    ? assertRustMultiplayerR5PlayerAuthorityPair(initialHost, initialGuest, "movement pre-input")
    : null;
  const start = initialGuest.state?.player?.position;
  assertCondition(Array.isArray(start) && start.length === 3, "Guest movement start position is absent.");
  const initialRemotePlayers = (initialHost.state?.multiplayer?.remotePlayers ?? [])
    .filter((player) => player?.id === GUEST_PROFILE.networkId);
  assertCondition(initialRemotePlayers.length === 1,
    "Host has no exact singleton native-custodied guest before movement.");
  const initialRemotePlayer = compactMovementRemotePlayer(initialRemotePlayers[0]);
  const initialNativePoseCustody = initialRemotePlayer.nativePoseCustody;
  assertCondition(initialNativePoseCustody !== null,
    "Host guest record has no native pose custody before movement.");
  const beforeHostSequence = initialHost.runtime?.multiplayer?.authorityDeltaSequence;
  const beforeGuestApplied = initialGuest.runtime?.multiplayer?.authorityDeltaApplied;
  assertCondition(Number.isSafeInteger(beforeHostSequence) && beforeHostSequence >= 1,
    "Guest movement has no pre-input Rust host authority sequence.");
  assertCondition(Number.isSafeInteger(beforeGuestApplied) && beforeGuestApplied >= 1,
    "Guest movement has no pre-input Rust guest authority receipt.");
  const authoritySequenceBefore = Math.max(-1, ...(initialGuest.generationAudit?.outboundPlayerPoses ?? [])
    .map((pose) => pose?.authoritySequence)
    .filter((sequence) => Number.isSafeInteger(sequence)));
  assertCondition(authoritySequenceBefore >= 0, "Guest movement has no pre-input Rust-authorized pose envelope.");
  const startChunkX = Math.floor(start[0] / MULTIPLAYER_MOVEMENT_CHUNK_SIZE);
  const targetChunkX = startChunkX + 1;
  const pulses = [];
  let crossedChunkBoundary = false;
  try {
    // This exact seed/spawn uses +X as the clear fixture lane. Forward (-Z)
    // is occupied by the Wildwood tree visible at spawn.
    for (let index = 1; index <= MULTIPLAYER_MOVEMENT_MAX_PULSES; index += 1) {
      pulses.push(requireR5PlayerAuthority
        ? await pulseGuestRustLiveMovement(guestPage, index, movementFramesPerPulse)
        : await pulseGuestLegacyMovement(guestPage, index, movementFramesPerPulse));
      const snapshot = await readBrowserSnapshot(guestPage);
      const position = snapshot?.state?.player?.position;
      const gameState = snapshot?.state?.state ?? null;
      const runtimeErrors = collectRustMultiplayerRuntimeErrors(snapshot?.state, snapshot?.runtime);
      if (gameState !== "playing" || runtimeErrors.length > 0) {
        throw new Error(`${requireR5PlayerAuthority ? "Native R5" : "Legacy TypeScript"} movement pulse became terminal: ${[gameState, ...runtimeErrors].join(" | ")}`);
      }
      if (!finiteMovementPosition(position)) continue;
      const currentChunkX = Math.floor(position[0] / MULTIPLAYER_MOVEMENT_CHUNK_SIZE);
      if (currentChunkX > targetChunkX) {
        throw new Error(`${requireR5PlayerAuthority ? "Native R5" : "Legacy TypeScript"} movement pulse overshot the one-chunk acceptance boundary (${startChunkX} -> ${currentChunkX}).`);
      }
      if (currentChunkX === targetChunkX && horizontalDistance(start, position) > 1) {
        crossedChunkBoundary = true;
        break;
      }
    }
  } finally {
    await guestPage.evaluate(() => window.set_game_key?.("KeyD", false)).catch(() => undefined);
  }
  if (!crossedChunkBoundary) {
    const diagnostics = await readMovementAuthorityDiagnostics(hostPage, guestPage);
    const error = new Error(`Guest did not cross the exact next chunk under bounded ${requireR5PlayerAuthority ? "native R5" : "legacy TypeScript"} pulses. Final diagnostics: ${JSON.stringify(diagnostics)}`);
    error.authorityDiagnostics = diagnostics;
    error.failureStage = "movement";
    throw error;
  }
  try {
    await guestPage.waitForFunction(({ startPosition }) => {
      try {
        const position = JSON.parse(window.render_game_to_text?.() ?? "null")?.player?.position;
        return Array.isArray(position) && Math.hypot(position[0] - startPosition[0], position[2] - startPosition[2]) > 1;
      } catch { return false; }
    }, { startPosition: start }, { timeout: Math.min(timeoutMilliseconds, 45_000) });
  } catch (cause) {
    const diagnostics = await readMovementAuthorityDiagnostics(hostPage, guestPage);
    const error = new Error(`Guest did not move after the bounded ${requireR5PlayerAuthority ? "native R5 input sequence" : "legacy TypeScript key hold"}. Final diagnostics: ${JSON.stringify(diagnostics)}`, { cause });
    error.authorityDiagnostics = diagnostics;
    error.failureStage = "movement";
    throw error;
  }
  await guestPage.waitForFunction(({ minimumAuthoritySequence, startPosition }) => {
    const audit = window.__blockwildRustMultiplayerGenerationAudit?.snapshot?.();
    return Array.isArray(audit?.outboundPlayerPoses) && audit.outboundPlayerPoses.some((pose) => (
      Number.isSafeInteger(pose?.authoritySequence)
      && pose.authoritySequence > minimumAuthoritySequence
      && pose.from === "browser_acceptance_guest.character_acceptance_guest"
      && pose.playerId === "browser_acceptance_guest.character_acceptance_guest"
      && Array.isArray(pose.position)
      && pose.position.length === 3
      && pose.position.every(Number.isFinite)
      && Math.hypot(pose.position[0] - startPosition[0], pose.position[2] - startPosition[2]) > 1
    ));
  }, { minimumAuthoritySequence: authoritySequenceBefore, startPosition: start }, { timeout: poseConvergenceTimeoutMilliseconds });
  let endpoint;
  try {
    endpoint = await waitForRustMultiplayerMovementEndpoint(
      guestPage,
      start,
      authoritySequenceBefore,
      Math.min(timeoutMilliseconds, 45_000),
    );
  } catch (cause) {
    const diagnostics = await readMovementAuthorityDiagnostics(hostPage, guestPage);
    const error = new Error(`Guest movement did not settle on a final Rust-authorized pose. Final diagnostics: ${JSON.stringify(diagnostics)}`, { cause });
    error.authorityDiagnostics = Object.freeze({
      ...diagnostics,
      endpointEvidence: cause?.endpointEvidence ?? null,
    });
    error.failureStage = "movement";
    throw error;
  }
  const end = endpoint.position;
  await Promise.all([
    hostPage.waitForFunction(({ minimum }) => {
      try { return JSON.parse(window.render_rust_runtime_to_text?.() ?? "null")?.multiplayer?.authorityDeltaSequence > minimum; }
      catch { return false; }
    }, { minimum: beforeHostSequence }, { timeout: Math.min(timeoutMilliseconds, 45_000) }),
    guestPage.waitForFunction(({ minimum }) => {
      try { return JSON.parse(window.render_rust_runtime_to_text?.() ?? "null")?.multiplayer?.authorityDeltaApplied > minimum; }
      catch { return false; }
    }, { minimum: beforeGuestApplied }, { timeout: Math.min(timeoutMilliseconds, 45_000) }),
  ]);
  let nativeConvergence;
  try {
    nativeConvergence = await waitForRustMultiplayerNativePoseConvergence(
      hostPage,
      guestPage,
      end,
      endpoint.authorityPose.authoritySequence,
      poseConvergenceTimeoutMilliseconds,
      { priorNativePoseCustody: initialNativePoseCustody },
    );
  } catch (cause) {
    const diagnostics = await readMovementAuthorityDiagnostics(hostPage, guestPage);
    const error = new Error(`Host native pose did not converge on the final guest movement endpoint. Final diagnostics: ${JSON.stringify(diagnostics)}`, { cause });
    error.authorityDiagnostics = Object.freeze({
      ...diagnostics,
      nativePoseConvergenceEvidence: cause?.nativePoseConvergenceEvidence ?? null,
    });
    error.failureStage = "movement";
    throw error;
  }
  let movedPins;
  try {
    movedPins = await waitForRustMultiplayerMapPinConvergence(
      hostPage,
      initialPins[0].label,
      end,
      poseConvergenceTimeoutMilliseconds,
    );
  } catch (cause) {
    const diagnostics = await readMovementAuthorityDiagnostics(hostPage, guestPage);
    const error = new Error(`Host map pin did not converge on the moved guest. Final diagnostics: ${JSON.stringify(diagnostics)}`, { cause });
    error.authorityDiagnostics = Object.freeze({
      ...diagnostics,
      mapPinEvidence: cause?.mapPinEvidence ?? null,
    });
    error.failureStage = "movement";
    throw error;
  }
  assertCondition(movedPins.length === 1, `Host map contains ${movedPins.length} guest pins after movement.`);
  const hostPinConvergence = Math.hypot(movedPins[0].x - Math.round(end[0]), movedPins[0].z - Math.round(end[2]));
  const hostPinDisplacement = Math.hypot(movedPins[0].x - initialPins[0].x, movedPins[0].z - initialPins[0].z);
  const postInputHost = nativeConvergence.hostSnapshot;
  const postInputGuest = nativeConvergence.guestSnapshot;
  const postInputRuntime = assertRustMultiplayerRuntimePair(postInputHost.runtime, postInputGuest.runtime, signalPair, {
    minimumHostSequence: beforeHostSequence + 1,
    minimumGuestApplied: beforeGuestApplied + 1,
    universeId: signalPair.runtime.universeId,
    locationId: signalPair.runtime.locationId,
  });
  const postInputR5PlayerAuthority = requireR5PlayerAuthority
    ? assertRustMultiplayerR5PlayerAuthorityPair(postInputHost, postInputGuest, "movement post-input")
    : null;
  const postInputRemotePlayer = nativeConvergence.remotePlayer;
  const nativePoseCustody = nativeConvergence.nativePoseCustody;
  const hostTransport = nativeConvergence.hostTransport;
  assertCondition(hostTransport.transportRole === "host"
    && hostTransport.authorityMode === "rust-authoritative"
    && hostTransport.peer !== null,
  "Host has no Rust-authoritative transport peer for the native pose projection.");
  const nativeAuthorityPose = nativeConvergence.nativeAuthorityPose;
  const postInputR5OutboundPose = requireR5PlayerAuthority
    ? assertRustMultiplayerR5OutboundPoseDiagnostics(postInputGuest, {
      playerId: GUEST_PROFILE.networkId,
      transportTick: nativeAuthorityPose.tick,
      position: nativeAuthorityPose.position,
    }, "movement post-input guest")
    : null;
  const priorNativeProjection = Object.freeze({ ...initialNativePoseCustody });
  const nativeProjection = Object.freeze({ ...nativePoseCustody });
  const proof = {
    schema: 1,
    command: {
      kind: "virtual-key",
      key: "KeyD",
      down: true,
      released: true,
      clock: requireR5PlayerAuthority ? "native-monotonic-live" : "browser-request-animation-frame",
      sampling: requireR5PlayerAuthority
        ? "engine-serialized-native-frames-immediate-release"
        : "request-animation-frame-bounded-typescript-key-hold",
      framesPerPulse: movementFramesPerPulse,
      maximumPulses: MULTIPLAYER_MOVEMENT_MAX_PULSES,
      pulses: Object.freeze(pulses.map((pulse) => Object.freeze({ ...pulse }))),
      chunkSize: MULTIPLAYER_MOVEMENT_CHUNK_SIZE,
      startChunkX,
      endChunkX: Math.floor(end[0] / MULTIPLAYER_MOVEMENT_CHUNK_SIZE),
      crossedChunkBoundary,
      authoritySequenceBefore,
      authorityPose: nativeAuthorityPose,
    },
    receipt: {
      kind: "rust-native-guest-pose-projection",
      guestId: GUEST_PROFILE.networkId,
      priorNativeProjection,
      nativeProjection,
      remotePlayer: postInputRemotePlayer,
      transportPeer: hostTransport.peer,
      guestStart: Object.freeze([...start]),
      guestEnd: Object.freeze([...end]),
      guestDistance: horizontalDistance(start, end),
      hostPinCountBefore: initialPins.length,
      hostPinCountAfter: movedPins.length,
      hostBefore: initialPins[0],
      hostAfter: movedPins[0],
      hostPinDisplacement,
      hostPinConvergence,
    },
    delta: {
      before: { host: movementDeltaSnapshot(initialHost), guest: movementDeltaSnapshot(initialGuest) },
      after: { host: movementDeltaSnapshot(postInputHost), guest: movementDeltaSnapshot(postInputGuest) },
      capturedAfterInputRelease: true,
    },
    attribution: {
      level: requireR5PlayerAuthority
        ? "rust-r5-native-player-simulation-with-native-guest-pose-custody-plus-post-input-keyframe"
        : "typescript-legacy-player-simulation-with-native-guest-pose-custody-plus-post-input-keyframe",
      poseCustody: "rust-native",
      playerMovementSimulation: requireR5PlayerAuthority
        ? "rust-r5-native-authority"
        : "typescript",
      playerAuthoritySelector: requireR5PlayerAuthority
        ? RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR.claim
        : null,
      worldKeyframeProducer: "coarse-legacy-projection",
    },
    r5PlayerAuthority: requireR5PlayerAuthority
      ? Object.freeze({
        initial: initialR5PlayerAuthority,
        postInput: postInputR5PlayerAuthority,
        postInputGuestOutboundPose: postInputR5OutboundPose,
      })
      : null,
  };
  try {
    assertRustMultiplayerMovementProof(proof);
  } catch (error) {
    error.authorityDiagnostics = Object.freeze({
      proof: structuredClone(proof),
      runtime: await readMovementAuthorityDiagnostics(hostPage, guestPage),
    });
    error.failureStage = "movement";
    throw error;
  }
  return Object.freeze({ ...proof, postInputRuntime });
}

function compactRustMultiplayerDisconnectText(value, maximum = 512) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maximum) || null;
}

function compactRustMultiplayerDisconnectBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function compactRustMultiplayerDisconnectNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function compactRustMultiplayerDisconnectRevision(value) {
  if (!value || typeof value !== "object") return null;
  return Object.freeze({
    epoch: compactRustMultiplayerDisconnectNumber(value.epoch),
    world: compactRustMultiplayerDisconnectNumber(value.world),
    entities: compactRustMultiplayerDisconnectNumber(value.entities),
    gameplay: compactRustMultiplayerDisconnectNumber(value.gameplay),
    persistence: compactRustMultiplayerDisconnectNumber(value.persistence),
  });
}

function compactRustMultiplayerDisconnectProgression(value) {
  if (!value || typeof value !== "object") return null;
  const pending = value.pending && typeof value.pending === "object" ? Object.freeze({
    transferId: compactRustMultiplayerDisconnectText(value.pending.transferId, 160),
    revision: compactRustMultiplayerDisconnectNumber(value.pending.revision),
    transportComplete: compactRustMultiplayerDisconnectBoolean(value.pending.transportComplete),
  }) : null;
  const latestReceipt = value.latestReceipt && typeof value.latestReceipt === "object" ? Object.freeze({
    direction: compactRustMultiplayerDisconnectText(value.latestReceipt.direction, 40),
    peerId: compactRustMultiplayerDisconnectText(value.latestReceipt.peerId, 160),
    transferId: compactRustMultiplayerDisconnectText(value.latestReceipt.transferId, 160),
    status: compactRustMultiplayerDisconnectText(value.latestReceipt.status, 80),
    committedRevision: compactRustMultiplayerDisconnectNumber(value.latestReceipt.committedRevision),
    observedAt: compactRustMultiplayerDisconnectNumber(value.latestReceipt.observedAt),
    connectionCurrent: compactRustMultiplayerDisconnectBoolean(value.latestReceipt.connectionCurrent),
  }) : null;
  return Object.freeze({
    pending,
    outgoingRequestChunks: compactRustMultiplayerDisconnectNumber(value.outgoingRequestChunks),
    outgoingRequestTransfers: compactRustMultiplayerDisconnectNumber(value.outgoingRequestTransfers),
    confirmed: compactRustMultiplayerDisconnectBoolean(value.confirmed),
    confirmedRevision: compactRustMultiplayerDisconnectNumber(value.confirmedRevision),
    localDirty: compactRustMultiplayerDisconnectBoolean(value.localDirty),
    latestReceipt,
  });
}

function compactRustMultiplayerDisconnectRejection(value) {
  if (!value || typeof value !== "object") return null;
  const compactIdentity = (identity) => identity && typeof identity === "object" ? Object.freeze({
    revision: compactRustMultiplayerDisconnectRevision(identity.revision),
    stateHash: compactRustMultiplayerDisconnectText(identity.stateHash, 160),
  }) : null;
  return Object.freeze({
    messageType: compactRustMultiplayerDisconnectText(value.messageType, 80),
    commandId: compactRustMultiplayerDisconnectText(value.commandId, 160),
    code: compactRustMultiplayerDisconnectText(value.code, 80),
    expected: compactIdentity(value.expected),
    current: compactIdentity(value.current),
  });
}

function compactRustMultiplayerDisconnectNativePersistence(value) {
  if (!value || typeof value !== "object") return null;
  const error = value.lastError && typeof value.lastError === "object" ? Object.freeze({
    code: compactRustMultiplayerDisconnectText(value.lastError.code, 80),
    message: compactRustMultiplayerDisconnectText(value.lastError.message),
  }) : compactRustMultiplayerDisconnectText(value.lastError);
  return Object.freeze({
    state: compactRustMultiplayerDisconnectText(value.state, 40),
    saves: compactRustMultiplayerDisconnectNumber(value.saves),
    recoveries: compactRustMultiplayerDisconnectNumber(value.recoveries),
    platformOperations: compactRustMultiplayerDisconnectNumber(value.platformOperations),
    lastCheckpointId: compactRustMultiplayerDisconnectText(value.lastCheckpointId, 160),
    lastError: error,
  });
}

/**
 * Keep disconnect evidence bounded and avoid retaining arbitrary render/runtime
 * payloads. The selected fields are lifecycle counters and exact authority
 * receipts only; world/player bodies never enter the acceptance artifact.
 */
export function compactRustMultiplayerGuestDisconnectSnapshot(snapshot) {
  const state = snapshot?.state;
  const runtime = snapshot?.runtime;
  const manager = runtime?.manager;
  const host = manager?.host;
  const multiplayer = runtime?.multiplayer;
  const lastGracefulProgressionDrain = multiplayer?.lastGracefulProgressionDrain;
  return Object.freeze({
    ui: Object.freeze({
      titleVisible: snapshot?.ui?.titleVisible === true,
      multiplayerHeading: compactRustMultiplayerDisconnectText(snapshot?.ui?.multiplayerHeading, 80),
      multiplayerStatus: compactRustMultiplayerDisconnectText(snapshot?.ui?.multiplayerStatus, 80),
      visibleErrors: Object.freeze((Array.isArray(snapshot?.ui?.visibleErrors) ? snapshot.ui.visibleErrors : [])
        .map((value) => compactRustMultiplayerDisconnectText(value))
        .filter(Boolean)
        .slice(0, 8)),
    }),
    state: Object.freeze({
      name: compactRustMultiplayerDisconnectText(state?.name, 80),
      multiplayerRole: compactRustMultiplayerDisconnectText(state?.multiplayerRole, 40),
      multiplayerRemotePlayers: compactRustMultiplayerDisconnectNumber(state?.multiplayerRemotePlayers),
    }),
    runtime: Object.freeze({
      ready: compactRustMultiplayerDisconnectBoolean(runtime?.ready),
      operationsBlocked: compactRustMultiplayerDisconnectBoolean(runtime?.operationsBlocked),
      activeWorldId: compactRustMultiplayerDisconnectText(runtime?.activeWorldId, 160),
      nativePersistenceWorldId: compactRustMultiplayerDisconnectText(runtime?.nativePersistenceWorldId, 160),
      hydration: compactRustMultiplayerDisconnectText(runtime?.hydration, 80),
      managerState: compactRustMultiplayerDisconnectText(manager?.state, 80),
      hostState: compactRustMultiplayerDisconnectText(host?.state, 80),
      nativePersistence: compactRustMultiplayerDisconnectNativePersistence(host?.nativePersistence),
      lastError: compactRustMultiplayerDisconnectText(runtime?.lastError),
      managerLastError: compactRustMultiplayerDisconnectText(manager?.lastError),
      hostLastError: compactRustMultiplayerDisconnectText(host?.lastError),
      adapterLastError: compactRustMultiplayerDisconnectText(host?.adapter?.lastError),
      playerAuthorityLastError: compactRustMultiplayerDisconnectText(runtime?.playerAuthority?.lastError),
      multiplayerLastError: compactRustMultiplayerDisconnectText(multiplayer?.lastError),
      multiplayerLastRejection: compactRustMultiplayerDisconnectRejection(multiplayer?.lastRejection),
      multiplayerProgression: compactRustMultiplayerDisconnectProgression(multiplayer?.progression),
      multiplayerLastGracefulProgressionDrain: lastGracefulProgressionDrain && typeof lastGracefulProgressionDrain === "object"
        ? Object.freeze({
          schema: compactRustMultiplayerDisconnectNumber(lastGracefulProgressionDrain.schema),
          observedAt: compactRustMultiplayerDisconnectNumber(lastGracefulProgressionDrain.observedAt),
          exactReceiptCurrent: compactRustMultiplayerDisconnectBoolean(lastGracefulProgressionDrain.exactReceiptCurrent),
          progression: compactRustMultiplayerDisconnectProgression(lastGracefulProgressionDrain.progression),
        })
        : null,
      multiplayerPresentation: multiplayer?.presentation && typeof multiplayer.presentation === "object" ? Object.freeze({
        guestQueued: compactRustMultiplayerDisconnectNumber(multiplayer.presentation.guestQueued),
        guestInFlight: compactRustMultiplayerDisconnectNumber(multiplayer.presentation.guestInFlight),
        hostQueuedPeers: compactRustMultiplayerDisconnectNumber(multiplayer.presentation.hostQueuedPeers),
        hostPumpActive: compactRustMultiplayerDisconnectBoolean(multiplayer.presentation.hostPumpActive),
        authorityOperations: compactRustMultiplayerDisconnectNumber(multiplayer.presentation.authorityOperations),
      }) : null,
      multiplayerTransport: multiplayer?.transport && typeof multiplayer.transport === "object" ? Object.freeze({
        role: compactRustMultiplayerDisconnectText(multiplayer.transport.role, 40),
        state: compactRustMultiplayerDisconnectText(multiplayer.transport.state, 80),
      }) : null,
    }),
  });
}

async function readRustMultiplayerGuestDisconnectSnapshot(page) {
  const snapshot = await page.evaluate(() => {
    const parse = (name) => {
      const renderer = window[name];
      if (typeof renderer !== "function") return null;
      try { return JSON.parse(renderer()); } catch { return null; }
    };
    const compactText = (value, maximum = 512) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maximum);
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const state = parse("render_game_to_text");
    const runtime = parse("render_rust_runtime_to_text");
    return {
      ui: {
        titleVisible: visible(document.querySelector(".title-overlay"))
          && [...document.querySelectorAll("h1, h2")].some((element) => visible(element) && element.textContent?.trim() === "BLOCKWILD"),
        multiplayerHeading: [...document.querySelectorAll("h1, h2")]
          .find((element) => visible(element) && /^(?:Join Multiplayer|Multiplayer Session)$/u.test(element.textContent?.trim() ?? ""))
          ?.textContent?.trim() ?? null,
        multiplayerStatus: compactText(document.querySelector(".multiplayer-status-row strong")?.textContent, 80) || null,
        visibleErrors: [...document.querySelectorAll(".multiplayer-error, .webgl-fallback")]
          .filter(visible)
          .map((element) => compactText(element.textContent))
          .filter(Boolean)
          .slice(0, 8),
      },
      state: {
        name: state?.state ?? null,
        multiplayerRole: state?.multiplayer?.role ?? null,
        multiplayerRemotePlayers: Array.isArray(state?.multiplayer?.remotePlayers) ? state.multiplayer.remotePlayers.length : null,
      },
      runtime,
    };
  });
  return compactRustMultiplayerGuestDisconnectSnapshot(snapshot);
}

function rustMultiplayerGuestDisconnectErrors(snapshot) {
  return [
    ...(Array.isArray(snapshot?.ui?.visibleErrors) ? snapshot.ui.visibleErrors : []),
    snapshot?.runtime?.lastError,
    snapshot?.runtime?.managerLastError,
    snapshot?.runtime?.hostLastError,
    snapshot?.runtime?.adapterLastError,
    snapshot?.runtime?.playerAuthorityLastError,
    snapshot?.runtime?.multiplayerLastError,
  ].filter((value) => typeof value === "string" && value.trim() !== "");
}

export function assertRustMultiplayerGuestDisconnectProgressionDrain(snapshot) {
  const drain = snapshot?.runtime?.multiplayerLastGracefulProgressionDrain;
  const progression = drain?.progression;
  const receipt = progression?.latestReceipt;
  const failures = [];
  if (drain?.schema !== 1) failures.push("retained drain schema is not 1");
  if (!Number.isFinite(drain?.observedAt)) failures.push("retained drain observation time is missing");
  if (drain?.exactReceiptCurrent !== true) failures.push("exactReceiptCurrent is not true");
  if (progression?.pending !== null) failures.push("a progression transfer remains pending");
  if (progression?.outgoingRequestChunks !== 0) failures.push("outgoing request chunks remain");
  if (progression?.outgoingRequestTransfers !== 0) failures.push("outgoing request transfers remain");
  if (progression?.localDirty !== false) failures.push("local progression is not clean");
  if (progression?.confirmed !== true) failures.push("progression is not confirmed");
  if (!Number.isSafeInteger(progression?.confirmedRevision) || progression.confirmedRevision < 0) {
    failures.push("confirmed progression revision is missing");
  }
  if (!receipt || typeof receipt !== "object") {
    failures.push("latest progression receipt is missing");
  } else {
    if (receipt.direction !== "guest-observed") failures.push("latest progression receipt was not guest-observed");
    if (receipt.status !== "accepted") failures.push("latest progression receipt was not accepted");
    if (receipt.connectionCurrent !== true) failures.push("latest progression receipt is not from the current connection");
    if (!Number.isSafeInteger(receipt.committedRevision)
      || receipt.committedRevision !== progression?.confirmedRevision) {
      failures.push("latest receipt revision does not match the confirmed revision");
    }
    if (typeof receipt.transferId !== "string" || receipt.transferId.length === 0) {
      failures.push("latest progression receipt transfer is missing");
    }
  }
  if (failures.length > 0) {
    const error = new Error(`Guest disconnect lacks an exact graceful progression drain: ${failures.join("; ")}`);
    error.code = "BLOCKWILD_GUEST_DISCONNECT_DRAIN_INVALID";
    throw error;
  }
  return drain;
}

export async function waitForRustMultiplayerGuestDisconnect(page, timeoutMilliseconds, options = {}) {
  assertCondition(Number.isFinite(timeoutMilliseconds) && timeoutMilliseconds >= 0,
    `Guest disconnect timeout is invalid: ${String(timeoutMilliseconds)}`);
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readSnapshot = options.readSnapshot ?? (() => readRustMultiplayerGuestDisconnectSnapshot(page));
  const pollMilliseconds = options.pollMilliseconds ?? 50;
  const requiredStableReads = options.requiredStableReads ?? 2;
  const preDisconnectSnapshot = options.preDisconnectSnapshot === undefined
    ? null
    : structuredClone(options.preDisconnectSnapshot);
  const started = now();
  let stableReads = 0;
  let attempts = 0;
  let finalSnapshot = null;
  const observations = [];
  while (now() - started <= timeoutMilliseconds) {
    attempts += 1;
    finalSnapshot = await readSnapshot();
    observations.push(structuredClone(finalSnapshot));
    if (observations.length > 8) observations.shift();
    const errors = rustMultiplayerGuestDisconnectErrors(finalSnapshot);
    if (errors.length > 0) {
      const error = new Error(`Guest disconnect reported an error before reaching the title: ${errors.join(" | ")}`);
      error.code = "BLOCKWILD_GUEST_DISCONNECT_ERROR";
      error.failureStage = "disconnect";
      error.disconnectEvidence = Object.freeze({
        timeoutMilliseconds,
        elapsedMilliseconds: Math.max(0, now() - started),
        attempts,
        preDisconnectSnapshot,
        errors: Object.freeze([...errors]),
        finalSnapshot: structuredClone(finalSnapshot),
        observations: Object.freeze(observations),
      });
      throw error;
    }
    const titleComplete = finalSnapshot?.ui?.titleVisible === true
      && finalSnapshot?.state?.name === "title"
      && finalSnapshot?.state?.multiplayerRole === null;
    stableReads = titleComplete ? stableReads + 1 : 0;
    if (stableReads >= requiredStableReads) {
      let progressionDrain;
      try {
        progressionDrain = assertRustMultiplayerGuestDisconnectProgressionDrain(finalSnapshot);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const error = new Error(`Guest disconnect reached the title without an exact graceful progression drain. ${message}`, { cause });
        error.code = "BLOCKWILD_GUEST_DISCONNECT_DRAIN_INVALID";
        error.failureStage = "disconnect";
        error.disconnectEvidence = Object.freeze({
          timeoutMilliseconds,
          elapsedMilliseconds: Math.max(0, now() - started),
          attempts,
          stableReads,
          requiredStableReads,
          preDisconnectSnapshot,
          errors: Object.freeze([message]),
          progressionDrain: structuredClone(finalSnapshot?.runtime?.multiplayerLastGracefulProgressionDrain ?? null),
          finalSnapshot: structuredClone(finalSnapshot),
          observations: Object.freeze(observations),
        });
        throw error;
      }
      return Object.freeze({
        timeoutMilliseconds,
        elapsedMilliseconds: Math.max(0, now() - started),
        attempts,
        stableReads,
        preDisconnectSnapshot,
        progressionDrain: structuredClone(progressionDrain),
        finalSnapshot: structuredClone(finalSnapshot),
        observations: Object.freeze(observations),
      });
    }
    const remaining = timeoutMilliseconds - (now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(pollMilliseconds, Math.max(1, remaining)));
  }
  const error = new Error(`Guest disconnect did not reach a stable title state with no multiplayer role within ${timeoutMilliseconds}ms. Final evidence: ${JSON.stringify(finalSnapshot)}`);
  error.code = "BLOCKWILD_GUEST_DISCONNECT_TIMEOUT";
  error.failureStage = "disconnect";
  error.disconnectEvidence = Object.freeze({
    timeoutMilliseconds,
    elapsedMilliseconds: Math.max(0, now() - started),
    attempts,
    stableReads,
    requiredStableReads,
    preDisconnectSnapshot,
    finalSnapshot: structuredClone(finalSnapshot),
    observations: Object.freeze(observations),
  });
  throw error;
}

export const RUST_MULTIPLAYER_HOST_PEER_DRAIN_TIMEOUT_MS = 30_000;

function compactRustMultiplayerHostDisconnectSnapshot(snapshot) {
  const state = snapshot?.state;
  const runtime = snapshot?.runtime;
  const manager = runtime?.manager;
  const host = manager?.host;
  const multiplayer = runtime?.multiplayer;
  const transport = multiplayer?.transport;
  const peers = Array.isArray(transport?.peers) ? transport.peers : null;
  return Object.freeze({
    ui: Object.freeze({
      peerListAvailable: snapshot?.ui?.peerListAvailable === true,
      peerCount: compactRustMultiplayerDisconnectNumber(snapshot?.ui?.peerCount),
      visibleErrors: Object.freeze((Array.isArray(snapshot?.ui?.visibleErrors) ? snapshot.ui.visibleErrors : [])
        .map((value) => compactRustMultiplayerDisconnectText(value))
        .filter(Boolean)
        .slice(0, 8)),
    }),
    state: Object.freeze({
      name: compactRustMultiplayerDisconnectText(state?.name, 80),
      multiplayerStatus: compactRustMultiplayerDisconnectText(state?.multiplayerStatus, 80),
      multiplayerRole: compactRustMultiplayerDisconnectText(state?.multiplayerRole, 40),
      multiplayerRemotePlayers: compactRustMultiplayerDisconnectNumber(state?.multiplayerRemotePlayers),
      multiplayerError: compactRustMultiplayerDisconnectText(state?.multiplayerError),
    }),
    runtime: Object.freeze({
      ready: compactRustMultiplayerDisconnectBoolean(runtime?.ready),
      operationsBlocked: compactRustMultiplayerDisconnectBoolean(runtime?.operationsBlocked),
      managerState: compactRustMultiplayerDisconnectText(manager?.state, 80),
      hostState: compactRustMultiplayerDisconnectText(host?.state, 80),
      lastError: compactRustMultiplayerDisconnectText(runtime?.lastError),
      managerLastError: compactRustMultiplayerDisconnectText(manager?.lastError),
      hostLastError: compactRustMultiplayerDisconnectText(host?.lastError),
      adapterLastError: compactRustMultiplayerDisconnectText(host?.adapter?.lastError),
      playerAuthorityLastError: compactRustMultiplayerDisconnectText(runtime?.playerAuthority?.lastError),
      multiplayerLastError: compactRustMultiplayerDisconnectText(multiplayer?.lastError),
      transport: transport && typeof transport === "object" ? Object.freeze({
        schema: compactRustMultiplayerDisconnectNumber(transport.schema),
        state: compactRustMultiplayerDisconnectText(transport.state, 80),
        role: compactRustMultiplayerDisconnectText(transport.role, 40),
        authorityMode: compactRustMultiplayerDisconnectText(transport.authorityMode, 80),
        authorityOperations: compactRustMultiplayerDisconnectNumber(transport.authorityOperations),
        peerCount: peers?.length ?? null,
        peers: peers ? Object.freeze(peers.slice(0, 8).map((peer) => Object.freeze({
          peerId: compactRustMultiplayerDisconnectText(peer?.peerId, 160),
          state: compactRustMultiplayerDisconnectText(peer?.state, 80),
          reliableState: compactRustMultiplayerDisconnectText(peer?.reliableState, 80),
          authorityQueued: compactRustMultiplayerDisconnectNumber(peer?.authorityQueued),
          authorityInFlight: compactRustMultiplayerDisconnectNumber(peer?.authorityInFlight),
          authorityErrors: compactRustMultiplayerDisconnectNumber(peer?.authorityErrors),
          protocolStrikes: compactRustMultiplayerDisconnectNumber(peer?.protocolStrikes),
        }))) : null,
      }) : null,
    }),
  });
}

async function readRustMultiplayerHostDisconnectSnapshot(page) {
  const snapshot = await page.evaluate(() => {
    const parse = (name) => {
      const renderer = window[name];
      if (typeof renderer !== "function") return null;
      try { return JSON.parse(renderer()); } catch { return null; }
    };
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const peerList = document.querySelector(".multiplayer-peer-list");
    const state = parse("render_game_to_text");
    return {
      ui: {
        peerListAvailable: peerList instanceof HTMLElement,
        peerCount: peerList instanceof HTMLElement
          ? document.querySelectorAll(".multiplayer-peer-list > div").length
          : null,
        visibleErrors: [...document.querySelectorAll(".multiplayer-error, .webgl-fallback")]
          .filter(visible)
          .map((element) => element.textContent)
          .slice(0, 8),
      },
      state: {
        name: state?.state ?? null,
        multiplayerStatus: state?.multiplayer?.status ?? null,
        multiplayerRole: state?.multiplayer?.role ?? null,
        multiplayerRemotePlayers: Array.isArray(state?.multiplayer?.remotePlayers)
          ? state.multiplayer.remotePlayers.length
          : null,
        multiplayerError: state?.multiplayer?.error ?? null,
      },
      runtime: parse("render_rust_runtime_to_text"),
    };
  });
  return compactRustMultiplayerHostDisconnectSnapshot(snapshot);
}

function rustMultiplayerHostDisconnectErrors(snapshot) {
  return [
    ...(Array.isArray(snapshot?.ui?.visibleErrors) ? snapshot.ui.visibleErrors : []),
    snapshot?.state?.multiplayerError,
    snapshot?.runtime?.lastError,
    snapshot?.runtime?.managerLastError,
    snapshot?.runtime?.hostLastError,
    snapshot?.runtime?.adapterLastError,
    snapshot?.runtime?.playerAuthorityLastError,
    snapshot?.runtime?.multiplayerLastError,
  ].filter((value) => typeof value === "string" && value.trim() !== "");
}

export function rustMultiplayerHostDisconnectDrained(snapshot) {
  const transport = snapshot?.runtime?.transport;
  return snapshot?.state?.multiplayerRole === "host"
    && snapshot?.state?.multiplayerRemotePlayers === 0
    && snapshot?.runtime?.ready === true
    && snapshot?.runtime?.operationsBlocked === false
    && transport?.schema === 1
    && transport?.role === "host"
    && transport?.state === "hosting"
    && transport?.authorityOperations === 0
    && transport?.peerCount === 0
    && Array.isArray(transport?.peers)
    && transport.peers.length === 0
    && (snapshot?.ui?.peerListAvailable !== true || snapshot.ui.peerCount === 0);
}

export async function waitForRustMultiplayerHostPeerDrain(page, timeoutMilliseconds, options = {}) {
  assertCondition(Number.isFinite(timeoutMilliseconds) && timeoutMilliseconds >= 0,
    `Host peer-drain timeout is invalid: ${String(timeoutMilliseconds)}`);
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readSnapshot = options.readSnapshot ?? (() => readRustMultiplayerHostDisconnectSnapshot(page));
  const pollMilliseconds = options.pollMilliseconds ?? 50;
  const requiredStableReads = options.requiredStableReads ?? 2;
  const started = now();
  let attempts = 0;
  let stableReads = 0;
  let finalSnapshot = null;
  const observations = [];
  while (now() - started <= timeoutMilliseconds) {
    attempts += 1;
    try {
      finalSnapshot = await readSnapshot();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const error = new Error(`Host peer-drain diagnostics could not be read: ${message}`, { cause });
      error.code = "BLOCKWILD_HOST_DISCONNECT_DIAGNOSTICS_ERROR";
      error.failureStage = "disconnect";
      error.hostDisconnectEvidence = Object.freeze({
        timeoutMilliseconds,
        elapsedMilliseconds: Math.max(0, now() - started),
        attempts,
        stableReads,
        evaluationError: compactRustMultiplayerDisconnectText(message),
        finalSnapshot: structuredClone(finalSnapshot),
        observations: Object.freeze(observations),
      });
      throw error;
    }
    observations.push(structuredClone(finalSnapshot));
    if (observations.length > 8) observations.shift();
    const errors = rustMultiplayerHostDisconnectErrors(finalSnapshot);
    if (errors.length > 0) {
      const error = new Error(`Host peer drain reported an error: ${errors.join(" | ")}`);
      error.code = "BLOCKWILD_HOST_DISCONNECT_ERROR";
      error.failureStage = "disconnect";
      error.hostDisconnectEvidence = Object.freeze({
        timeoutMilliseconds,
        elapsedMilliseconds: Math.max(0, now() - started),
        attempts,
        stableReads,
        errors: Object.freeze([...errors]),
        finalSnapshot: structuredClone(finalSnapshot),
        observations: Object.freeze(observations),
      });
      throw error;
    }
    stableReads = rustMultiplayerHostDisconnectDrained(finalSnapshot) ? stableReads + 1 : 0;
    if (stableReads >= requiredStableReads) {
      return Object.freeze({
        timeoutMilliseconds,
        elapsedMilliseconds: Math.max(0, now() - started),
        attempts,
        stableReads,
        finalSnapshot: structuredClone(finalSnapshot),
        observations: Object.freeze(observations),
      });
    }
    const remaining = timeoutMilliseconds - (now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(pollMilliseconds, Math.max(1, remaining)));
  }
  const error = new Error(`Host did not reach a stable authoritative zero-peer state within ${timeoutMilliseconds}ms. Final evidence: ${JSON.stringify(finalSnapshot)}`);
  error.code = "BLOCKWILD_HOST_DISCONNECT_TIMEOUT";
  error.failureStage = "disconnect";
  error.hostDisconnectEvidence = Object.freeze({
    timeoutMilliseconds,
    elapsedMilliseconds: Math.max(0, now() - started),
    attempts,
    stableReads,
    requiredStableReads,
    finalSnapshot: structuredClone(finalSnapshot),
    observations: Object.freeze(observations),
  });
  throw error;
}

async function waitForRustMultiplayerInitialAuthorityBoundary(hostPage, guestPage, timeoutMilliseconds) {
  const deadline = Date.now() + Math.min(timeoutMilliseconds, 30_000);
  let hostEvidence = null;
  let guestEvidence = null;
  while (Date.now() <= deadline) {
    const [hostSnapshot, guestSnapshot] = await Promise.all([
      readBrowserSnapshot(hostPage),
      readBrowserSnapshot(guestPage),
    ]);
    hostEvidence = compactRustMultiplayerAuthorityCommandEvidence(hostSnapshot, GUEST_PROFILE.networkId);
    guestEvidence = compactRustMultiplayerAuthorityCommandEvidence(guestSnapshot, HOST_PROFILE.networkId);
    const cursor = guestEvidence.outboundAuthorityCommandSequence;
    if (hostEvidence.transportState === "connected"
      && hostEvidence.transportRole === "host"
      && hostEvidence.authorityMode === "rust-authoritative"
      && hostEvidence.authorityOperations === 0
      && hostEvidence.peer?.state === "connected"
      && Number.isSafeInteger(cursor)
      && cursor > 0
      && hostEvidence.peer.authorityQueued === cursor
      && hostEvidence.peer.authorityInFlight === 0
      && hostEvidence.peer.authorityAccepted === cursor
      && hostEvidence.peer.authorityRejected === 0
      && hostEvidence.peer.authorityErrors === 0
      && hostEvidence.peer.protocolStrikes === 0) {
      return Object.freeze({ ...hostEvidence, finalAcceptedAuthoritySequence: cursor - 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Initial host/guest authority stream did not reach a shared quiescent cursor before disconnect: ${JSON.stringify({ hostEvidence, guestEvidence })}`);
}

async function disconnectGuestThroughUi(hostPage, guestPage, timeoutMilliseconds) {
  await ensureRustMultiplayerPanel(guestPage, { requireDirectFallback: true, timeoutMilliseconds });
  const finalInitialHostObserved = await waitForRustMultiplayerInitialAuthorityBoundary(
    hostPage,
    guestPage,
    timeoutMilliseconds,
  );
  const preDisconnectSnapshot = await readRustMultiplayerGuestDisconnectSnapshot(guestPage);
  await guestPage.getByRole("button", { name: "Disconnect Session" }).click();
  const guestEvidence = await waitForRustMultiplayerGuestDisconnect(guestPage, timeoutMilliseconds, { preDisconnectSnapshot });
  const disconnectedGuestSnapshot = await readBrowserSnapshot(guestPage);
  const initialCommands = disconnectedGuestSnapshot?.generationAudit?.outboundAuthorityCommands ?? [];
  const guestCommandAuditCount = initialCommands.length;
  assertCondition(Number.isSafeInteger(guestCommandAuditCount) && guestCommandAuditCount >= 1,
    "Guest disconnect lost the initial-session authority-command audit boundary.");
  const initialCommandBoundary = Object.freeze({
    auditCount: guestCommandAuditCount,
    lastAuthoritySequence: initialCommands.at(-1)?.authoritySequence ?? null,
    tail: Object.freeze(initialCommands.slice(-64).map((record) => Object.freeze({ ...record }))),
  });
  const hostTimeoutMilliseconds = Math.min(timeoutMilliseconds, RUST_MULTIPLAYER_HOST_PEER_DRAIN_TIMEOUT_MS);
  try {
    const hostEvidence = await waitForRustMultiplayerHostPeerDrain(hostPage, hostTimeoutMilliseconds);
    return Object.freeze({
      guest: guestEvidence,
      host: hostEvidence,
      hostPeerCount: 0,
      initialHostObserved: finalInitialHostObserved,
      initialCommandBoundary,
    });
  } catch (cause) {
    const host = cause?.hostDisconnectEvidence ?? Object.freeze({
      timeoutMilliseconds: hostTimeoutMilliseconds,
      finalSnapshot: await readRustMultiplayerHostDisconnectSnapshot(hostPage).catch((diagnosticError) => ({
        diagnosticError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      })),
    });
    const error = new Error(`Host did not drain the disconnected guest record. Final evidence: ${JSON.stringify(host)}`, { cause });
    error.code = cause?.code ?? "BLOCKWILD_HOST_DISCONNECT_ERROR";
    error.failureStage = "disconnect";
    error.disconnectEvidence = Object.freeze({ guest: guestEvidence, host });
    throw error;
  }
}

function relativeEvidencePath(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
}

function safeRemoveProfile(profileDirectory, profileRoot) {
  const lexicalProfile = path.resolve(profileDirectory);
  const lexicalRoot = path.resolve(profileRoot);
  if (!pathIsInside(lexicalRoot, lexicalProfile) || lexicalProfile === lexicalRoot) throw new Error(`Refusing unsafe browser-profile removal: ${lexicalProfile}`);
  if (!existsSync(lexicalProfile)) return true;
  const rootCanonical = realpathSync(lexicalRoot);
  const profileCanonical = realpathSync(lexicalProfile);
  if (!pathIsInside(rootCanonical, profileCanonical) || lstatSync(lexicalProfile).isSymbolicLink()) {
    throw new Error(`Refusing non-contained or symlink browser-profile removal: ${profileCanonical}`);
  }
  rmSync(profileCanonical, { recursive: true, force: false, maxRetries: 5, retryDelay: 200 });
  return !existsSync(lexicalProfile);
}

function safeRemoveViteRuntime(outputDirectory, runtimeDirectory) {
  const lexicalOutput = path.resolve(outputDirectory);
  const lexicalRuntime = path.resolve(runtimeDirectory);
  if (path.dirname(lexicalRuntime) !== lexicalOutput || !path.basename(lexicalRuntime).startsWith(VITE_RUNTIME_PREFIX)) {
    throw new Error(`Refusing unsafe Vite-runtime removal: ${lexicalRuntime}`);
  }
  if (!existsSync(lexicalRuntime)) return true;
  const canonicalOutput = realpathSync(lexicalOutput);
  const canonicalRuntime = realpathSync(lexicalRuntime);
  if (!pathIsInside(canonicalOutput, canonicalRuntime) || lstatSync(lexicalRuntime).isSymbolicLink()) {
    throw new Error(`Refusing non-contained or symlink Vite-runtime removal: ${canonicalRuntime}`);
  }
  rmSync(canonicalRuntime, { recursive: true, force: false, maxRetries: 5, retryDelay: 200 });
  return !existsSync(lexicalRuntime);
}

function browserProcessPid(browser) {
  try {
    const child = typeof browser?.process === "function" ? browser.process() : null;
    return Number.isSafeInteger(child?.pid) && child.pid > 0 ? child.pid : null;
  } catch { return null; }
}

function exactProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function waitForBrowserDisconnect(browser, timeoutMilliseconds = 5_000) {
  if (!browser) return false;
  const deadline = Date.now() + timeoutMilliseconds;
  while (browser.isConnected()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

async function readRustMultiplayerLocalWorldIdentity(page, expected = {}) {
  return page.evaluate((input) => {
    const catalogKey = "blockwild-world-catalog-v1";
    const documentPrefix = "blockwild-world-data-v1:";
    const parse = (raw) => {
      if (typeof raw !== "string") return null;
      try { return JSON.parse(raw); } catch { return null; }
    };
    const compactMetadata = (metadata) => metadata && typeof metadata === "object" ? {
      id: metadata.id ?? null,
      ownership: metadata.ownership ?? null,
      name: metadata.name ?? null,
      seed: metadata.seed ?? null,
      mode: metadata.mode ?? null,
      generationIdentity: structuredClone(metadata.generationIdentity ?? null),
    } : null;
    const catalog = parse(localStorage.getItem(catalogKey));
    const worlds = Array.isArray(catalog?.worlds) ? catalog.worlds : [];
    const matchingWorlds = worlds.filter((world) => input.id
      ? world?.id === input.id
      : world?.name === input.name && world?.seed === input.seed);
    const entry = matchingWorlds[0] ?? null;
    const documentKey = typeof entry?.id === "string" ? `${documentPrefix}${entry.id}` : null;
    const document = documentKey ? parse(localStorage.getItem(documentKey)) : null;
    return {
      catalog: {
        key: catalogKey,
        version: catalog?.version ?? null,
        ownership: catalog?.ownership ?? null,
        activeWorldId: catalog?.activeWorldId ?? null,
        worldCount: worlds.length,
        matchingWorldIds: matchingWorlds.map((world) => world?.id ?? null),
      },
      catalogEntry: compactMetadata(entry),
      document: {
        key: documentKey,
        present: document !== null,
        version: document?.version ?? null,
        metadata: compactMetadata(document?.metadata),
        save: document?.save && typeof document.save === "object" ? {
          seed: document.save.seed ?? null,
          mode: document.save.mode ?? null,
          generatorVersion: document.save.generatorVersion ?? null,
          generatorProfile: document.save.generatorProfile ?? null,
        } : null,
      },
    };
  }, expected);
}

function rustMultiplayerLocalWorldStableIdentity(snapshot) {
  return Object.freeze({
    catalogVersion: snapshot?.catalog?.version ?? null,
    catalogOwnership: snapshot?.catalog?.ownership ?? null,
    worldCount: snapshot?.catalog?.worldCount ?? null,
    matchingWorldIds: Object.freeze([...(snapshot?.catalog?.matchingWorldIds ?? [])]),
    catalogEntry: structuredClone(snapshot?.catalogEntry ?? null),
    documentKey: snapshot?.document?.key ?? null,
    documentPresent: snapshot?.document?.present ?? null,
    documentVersion: snapshot?.document?.version ?? null,
    documentMetadata: structuredClone(snapshot?.document?.metadata ?? null),
    documentSave: structuredClone(snapshot?.document?.save ?? null),
  });
}

export function assertRustMultiplayerLocalWorldCatalogInvariant(evidence, expected = WORLD_FIXTURE.guest) {
  const before = rustMultiplayerLocalWorldStableIdentity(evidence?.before);
  const after = rustMultiplayerLocalWorldStableIdentity(evidence?.after);
  assertCondition(before.catalogVersion === 1 && before.catalogOwnership === "host-device",
    "Guest local world catalog was unavailable before multiplayer.");
  assertCondition(before.matchingWorldIds.length === 1 && typeof before.matchingWorldIds[0] === "string",
    "Guest local fixture did not have one exact catalog identity before multiplayer.");
  assertCondition(before.catalogEntry?.name === expected.name
    && before.catalogEntry?.seed === expected.seed
    && before.catalogEntry?.mode === WORLD_FIXTURE.mode,
  "Guest local fixture catalog metadata differed before multiplayer.");
  assertCondition(before.catalogEntry?.generationIdentity !== null,
    "Guest local fixture lacked its exact generation identity before multiplayer.");
  assertCondition(before.documentPresent === true
    && before.documentMetadata?.id === before.catalogEntry.id
    && before.documentMetadata?.name === expected.name
    && before.documentMetadata?.seed === expected.seed
    && before.documentSave?.seed === expected.seed
    && before.documentSave?.mode === WORLD_FIXTURE.mode,
  "Guest local fixture document differed from its catalog identity before multiplayer.");
  assertCondition(JSON.stringify(before.catalogEntry.generationIdentity)
    === JSON.stringify(before.documentMetadata.generationIdentity),
  "Guest local fixture catalog/document generation identities differed before multiplayer.");
  assertCondition(JSON.stringify(after) === JSON.stringify(before),
    "Guest local catalog/document identity changed during the initial host session or title return.");
  return true;
}

export function assertRustMultiplayerCleanupEvidence(cleanup) {
  for (const key of [
    "hostContextStarted", "guestContextStarted", "hostContextClosed", "guestContextClosed",
    "hostBrowserDisconnected", "guestBrowserDisconnected", "serverStarted", "serverClosed",
    "serverPortRefused", "environmentRestored", "viteRuntimeRemoved", "hostProfileRemoved",
    "guestProfileRemoved", "profileRootRemoved", "candidateUnchanged", "eventsDrained", "browserMutexReleased",
  ]) assertCondition(cleanup?.[key] === true, `Cleanup evidence ${key} is not true.`);
  assertCondition(Array.isArray(cleanup?.trackedChildPids)
    && cleanup.trackedChildPids.every((pid) => Number.isSafeInteger(pid) && pid > 0),
  "Cleanup trackedChildPids is malformed.");
  assertCondition(Array.isArray(cleanup?.aliveChildPidsAfterCleanup) && cleanup.aliveChildPidsAfterCleanup.length === 0,
    "An exact verifier-owned child PID remains alive after cleanup.");
  assertCondition(cleanup?.processTracking?.vite === "in-process-no-child"
    && cleanup?.processTracking?.browser === "playwright-browser-handle-with-public-pid-if-exposed",
  "Cleanup process ownership model is malformed.");
  return true;
}

function compactWorldState(snapshot) {
  return Object.freeze({
    seed: snapshot?.state?.world?.seed ?? null,
    mode: snapshot?.state?.player?.mode ?? null,
    day: snapshot?.state?.world?.day ?? null,
    weather: snapshot?.state?.world?.weather ?? null,
    player: Object.freeze({
      position: Object.freeze([...(snapshot?.state?.player?.position ?? [])]),
      health: snapshot?.state?.player?.health ?? null,
      hunger: snapshot?.state?.player?.hunger ?? null,
    }),
  });
}

export async function runRustMultiplayerBrowser(argv = process.argv) {
  const options = parseRustMultiplayerBrowserOptions(argv);
  if (options.help) return Object.freeze({ help: true, usage: usage() });
  const selection = selectRustMultiplayerCandidate(options.repositoryRoot, options.engineDirectory, options.expectedArtifactHash);
  mkdirSync(options.outputDirectory, { recursive: true });
  const profileRoot = path.join(options.outputDirectory, ".profiles");
  if (existsSync(profileRoot)) {
    const metadata = lstatSync(profileRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || readdirSync(profileRoot).length > 0) fail(`Browser profile root must be absent or empty: ${profileRoot}`);
  } else mkdirSync(profileRoot);
  const viteRuntimeDirectory = mkdtempSync(path.join(options.outputDirectory, VITE_RUNTIME_PREFIX));
  const routeRequests = [];
  const canonicalAssetRequests = [];
  const streams = {
    consoleErrors: [],
    pageErrors: [],
    runtimeErrors: [],
    httpErrors: [],
    externalRequests: [],
    webSockets: [],
    expectedRequestCancellations: [],
    managedViteWebSockets: [],
  };
  const collectionState = { active: true };
  const screenshots = Object.create(null);
  const screenshotAttempts = Object.create(null);
  const pageLifecycle = {
    host: { label: "host", attachedAt: null, crashed: false, closed: false, events: [] },
    guest: { label: "guest", attachedAt: null, crashed: false, closed: false, events: [] },
  };
  const navigation = { host: null, guest: null };
  const harnessDiagnostics = { host: null, guest: null };
  const cleanup = {
    hostContextStarted: false,
    guestContextStarted: false,
    hostContextClosed: false,
    guestContextClosed: false,
    hostBrowserDisconnected: false,
    guestBrowserDisconnected: false,
    serverStarted: false,
    serverClosed: true,
    serverPortRefused: true,
    environmentRestored: true,
    viteRuntimeCreated: true,
    viteRuntimeRemoved: false,
    hostProfileRemoved: false,
    guestProfileRemoved: false,
    profileRootRemoved: false,
    candidateUnchanged: false,
    eventsDrained: false,
    browserMutexReleased: true,
    trackedChildPids: [],
    aliveChildPidsAfterCleanup: [],
    processTracking: {
      vite: "in-process-no-child",
      browser: "playwright-browser-handle-with-public-pid-if-exposed",
    },
  };
  let managedServer = null;
  let managedServerAttempt = null;
  let hostContext = null;
  let guestContext = null;
  let hostBrowser = null;
  let guestBrowser = null;
  let hostPage = null;
  let guestPage = null;
  let hostProfileDirectory = null;
  let guestProfileDirectory = null;
  let playwright = null;
  let browserExecutable = null;
  let result = null;
  let initialConnection = null;
  let reconnectConnection = null;
  let movement = null;
  let disconnect = null;
  let guestLocalCatalogInvariant = null;
  const terrainReadiness = {
    localFixtures: { host: null, guest: null },
    initialSession: { host: null, guest: null },
    postMovement: { host: null, guest: null },
    reconnectSession: { host: null, guest: null },
  };
  const r5PlayerAuthority = {
    enabled: options.requireR5PlayerAuthority,
    selector: options.requireR5PlayerAuthority
      ? RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR.claim
      : null,
    checkpoints: {
      localFixtures: null,
      initialSession: null,
      postMovement: null,
      reconnectSession: null,
    },
  };
  let browserMutex = null;
  let browserMutexEvidence = null;
  let acceptanceStage = "setup";
  try {
    try {
      browserMutex = await acquireManagedBrowserGateMutex(options.repositoryRoot);
      browserMutexEvidence = browserMutex.evidence;
      cleanup.browserMutexReleased = false;
    } catch (error) {
      browserMutexEvidence = error?.browserGateMutex ?? null;
      throw error;
    }
    hostProfileDirectory = mkdtempSync(path.join(profileRoot, `${PROFILE_PREFIX}host-`));
    guestProfileDirectory = mkdtempSync(path.join(profileRoot, `${PROFILE_PREFIX}guest-`));
    playwright = await loadPlaywright(options.playwrightModule);
    browserExecutable = discoverBrowserExecutable(options.browserExecutable);
    managedServer = await startManagedViteServer(
      selection,
      options.timeoutMilliseconds,
      routeRequests,
      viteRuntimeDirectory,
      (attempt) => { managedServerAttempt = attempt; },
    );
    cleanup.serverStarted = true;
    cleanup.serverClosed = false;
    cleanup.serverPortRefused = false;
    cleanup.environmentRestored = false;
    const launchOptions = (profileDirectory) => ({
      headless: options.headless,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      viewport: { width: 1280, height: 720 },
      serviceWorkers: "block",
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--disable-breakpad",
        "--disable-crash-reporter",
        REQUIRED_LOCAL_WEBRTC_BROWSER_ARGUMENT,
        `--disk-cache-dir=${path.join(profileDirectory, "browser-cache")}`,
        `--crash-dumps-dir=${path.join(profileDirectory, "crash-dumps")}`,
      ],
    });
    hostContext = await playwright.module.chromium.launchPersistentContext(hostProfileDirectory, launchOptions(hostProfileDirectory));
    cleanup.hostContextStarted = true;
    hostBrowser = hostContext.browser();
    assertCondition(hostBrowser, "Playwright did not expose the owned host Browser handle.");
    const hostPid = browserProcessPid(hostBrowser);
    if (hostPid !== null) cleanup.trackedChildPids.push(hostPid);
    guestContext = await playwright.module.chromium.launchPersistentContext(guestProfileDirectory, launchOptions(guestProfileDirectory));
    cleanup.guestContextStarted = true;
    guestBrowser = guestContext.browser();
    assertCondition(guestBrowser, "Playwright did not expose the owned guest Browser handle.");
    const guestPid = browserProcessPid(guestBrowser);
    if (guestPid !== null && !cleanup.trackedChildPids.includes(guestPid)) cleanup.trackedChildPids.push(guestPid);
    await Promise.all([configureFreshContext(hostContext, HOST_PROFILE), configureFreshContext(guestContext, GUEST_PROFILE)]);
    await Promise.all([
      installNetworkGuard(hostContext, managedServer.baseUrl, selection.repositoryRoot, streams, canonicalAssetRequests, collectionState),
      installNetworkGuard(guestContext, managedServer.baseUrl, selection.repositoryRoot, streams, canonicalAssetRequests, collectionState),
    ]);
    hostPage = hostContext.pages()[0] ?? await hostContext.newPage();
    guestPage = guestContext.pages()[0] ?? await guestContext.newPage();
    hostPage.setDefaultTimeout(Math.min(options.timeoutMilliseconds, 60_000));
    guestPage.setDefaultTimeout(Math.min(options.timeoutMilliseconds, 60_000));
    attachPageGuards(hostPage, "host", streams, collectionState, managedServer.baseUrl, pageLifecycle.host);
    attachPageGuards(guestPage, "guest", streams, collectionState, managedServer.baseUrl, pageLifecycle.guest);
    acceptanceStage = "resource";
    const hostNavigationUrl = rustMultiplayerNavigationUrl(managedServer.baseUrl, "host", options);
    const guestNavigationUrl = rustMultiplayerNavigationUrl(managedServer.baseUrl, "guest", options);
    const [hostNavigationResponse, guestNavigationResponse] = await Promise.all([
      hostPage.goto(hostNavigationUrl, { waitUntil: "domcontentloaded", timeout: 120_000 }),
      guestPage.goto(guestNavigationUrl, { waitUntil: "domcontentloaded", timeout: 120_000 }),
    ]);
    const summarizeNavigation = (response, page) => Object.freeze({
      url: response?.url() ?? page.url(),
      status: response?.status() ?? null,
      ok: response?.ok() ?? false,
      resourceType: response?.request().resourceType() ?? null,
      contentType: response?.headers()["content-type"] ?? null,
    });
    navigation.host = summarizeNavigation(hostNavigationResponse, hostPage);
    navigation.guest = summarizeNavigation(guestNavigationResponse, guestPage);
    assertOptionalR5PlayerAuthorityRoutes(options, "initial navigation", [["host", hostPage], ["guest", guestPage]]);
    acceptanceStage = "bootstrap";
    const harnessAbort = new AbortController();
    let primaryHarnessFailure = null;
    const waitForPageHarness = async (page, label) => {
      try {
        return await waitForHarness(page, options.timeoutMilliseconds, {
          label,
          lifecycle: pageLifecycle[label],
          navigation: navigation[label],
          streams,
          expectedBuildProfile: "rust-primary",
          signal: harnessAbort.signal,
          onDiagnostics: (diagnostics) => { harnessDiagnostics[label] = diagnostics; },
        });
      } catch (error) {
        if (!primaryHarnessFailure && error?.code !== "BLOCKWILD_HARNESS_PEER_ABORT") {
          primaryHarnessFailure = error;
          harnessAbort.abort(error);
        }
        throw error;
      }
    };
    const harnessSettled = await Promise.allSettled([
      waitForPageHarness(hostPage, "host"),
      waitForPageHarness(guestPage, "guest"),
    ]);
    if (harnessSettled.some((entry) => entry.status === "rejected")) {
      const error = primaryHarnessFailure
        ?? harnessSettled.find((entry) => entry.status === "rejected")?.reason
        ?? new Error("Browser harness failed without a retained reason.");
      error.harnessDiagnosticsByPage = structuredClone(harnessDiagnostics);
      throw error;
    }
    const [hostCreated, guestCreated] = await Promise.all([
      createFixtureWorld(hostPage, WORLD_FIXTURE.host, options.expectedArtifactHash, options.timeoutMilliseconds),
      createFixtureWorld(guestPage, WORLD_FIXTURE.guest, options.expectedArtifactHash, options.timeoutMilliseconds),
    ]);
    assertCondition(hostCreated.characterCatalog?.selectedProfileId === HOST_PROFILE.profileId, "Host fixed character profile was not selected.");
    assertCondition(guestCreated.characterCatalog?.selectedProfileId === GUEST_PROFILE.profileId, "Guest fixed character profile was not selected.");
    acceptanceStage = "terrain-readiness-local-fixtures";
    terrainReadiness.localFixtures.host = await waitForRustMultiplayerVisualTerrainReadiness(
      hostPage,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "host-local-fixture",
        failureStage: acceptanceStage,
        onObservation: (assessment) => { terrainReadiness.localFixtures.host = { status: "pending", assessment }; },
      },
    );
    terrainReadiness.localFixtures.guest = await waitForRustMultiplayerVisualTerrainReadiness(
      guestPage,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "guest-local-fixture",
        failureStage: acceptanceStage,
        onObservation: (assessment) => { terrainReadiness.localFixtures.guest = { status: "pending", assessment }; },
      },
    );
    assertOptionalR5PlayerAuthorityRoutes(options, "local fixture", [["host", hostPage], ["guest", guestPage]]);
    if (options.requireR5PlayerAuthority) {
      const [hostSnapshot, guestSnapshot] = await Promise.all([readBrowserSnapshot(hostPage), readBrowserSnapshot(guestPage)]);
      r5PlayerAuthority.checkpoints.localFixtures = assertRustMultiplayerR5PlayerAuthorityPair(
        hostSnapshot,
        guestSnapshot,
        "local fixture",
      );
    }
    const createdHostScreenshot = path.join(options.outputDirectory, "01-host-world-created.png");
    const createdGuestScreenshot = path.join(options.outputDirectory, "02-guest-local-world-created.png");
    await Promise.all([hostPage.screenshot({ path: createdHostScreenshot, type: "png" }), guestPage.screenshot({ path: createdGuestScreenshot, type: "png" })]);
    screenshots.hostWorldCreated = relativeEvidencePath(options.repositoryRoot, createdHostScreenshot);
    screenshots.guestLocalWorldCreated = relativeEvidencePath(options.repositoryRoot, createdGuestScreenshot);
    guestLocalCatalogInvariant = Object.freeze({
      status: "pending-title-return",
      before: await readRustMultiplayerLocalWorldIdentity(guestPage, WORLD_FIXTURE.guest),
      after: null,
    });

    acceptanceStage = "signaling";
    initialConnection = await manualDirectConnect(
      hostPage,
      guestPage,
      null,
      options.timeoutMilliseconds,
      { requireR5PlayerAuthority: options.requireR5PlayerAuthority },
    );
    const initialAuthority = await waitForAuthorityPair(hostPage, guestPage, initialConnection.pair, { host: 1, guest: 1 }, options.timeoutMilliseconds);
    assertOptionalR5PlayerAuthorityRoutes(options, "initial connected session", [["host", hostPage], ["guest", guestPage]]);
    if (options.requireR5PlayerAuthority) {
      r5PlayerAuthority.checkpoints.initialSession = assertRustMultiplayerR5PlayerAuthorityPair(
        initialAuthority.hostSnapshot,
        initialAuthority.guestSnapshot,
        "initial connected session",
      );
    }
    const initialHostWorld = compactWorldState(initialAuthority.hostSnapshot);
    const initialWorld = compactWorldState(initialAuthority.guestSnapshot);
    const guestLocalWorld = compactWorldState(guestCreated);
    assertRustMultiplayerStateTransfer(initialHostWorld, initialWorld, guestLocalWorld);
    acceptanceStage = "terrain-readiness-initial-session";
    terrainReadiness.initialSession.host = await waitForRustMultiplayerVisualTerrainReadiness(
      hostPage,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "host-initial-session",
        failureStage: acceptanceStage,
        onObservation: (assessment) => { terrainReadiness.initialSession.host = { status: "pending", assessment }; },
      },
    );
    terrainReadiness.initialSession.guest = await waitForRustMultiplayerVisualTerrainReadiness(
      guestPage,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "guest-initial-session",
        failureStage: acceptanceStage,
        onObservation: (assessment) => { terrainReadiness.initialSession.guest = { status: "pending", assessment }; },
      },
    );
    const initialHostPanel = path.join(options.outputDirectory, "03-initial-host-session.png");
    const initialGuestPanel = path.join(options.outputDirectory, "04-initial-guest-session.png");
    await Promise.all([hostPage.screenshot({ path: initialHostPanel, type: "png" }), guestPage.screenshot({ path: initialGuestPanel, type: "png" })]);
    screenshots.initialHostSession = relativeEvidencePath(options.repositoryRoot, initialHostPanel);
    screenshots.initialGuestSession = relativeEvidencePath(options.repositoryRoot, initialGuestPanel);

    acceptanceStage = "movement";
    movement = await exerciseGuestMovement(
      hostPage,
      guestPage,
      initialConnection.pair,
      options.timeoutMilliseconds,
      { requireR5PlayerAuthority: options.requireR5PlayerAuthority },
    );
    assertOptionalR5PlayerAuthorityRoutes(options, "post-movement", [["host", hostPage], ["guest", guestPage]]);
    if (options.requireR5PlayerAuthority) {
      r5PlayerAuthority.checkpoints.postMovement = movement.r5PlayerAuthority ?? null;
      assertCondition(r5PlayerAuthority.checkpoints.postMovement !== null,
        "Combined R9+R5 movement omitted its exact player-authority checkpoint.");
    }
    acceptanceStage = "terrain-readiness-post-movement";
    terrainReadiness.postMovement.host = await waitForRustMultiplayerVisualTerrainReadiness(
      hostPage,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "host-post-movement",
        failureStage: acceptanceStage,
        onObservation: (assessment) => { terrainReadiness.postMovement.host = { status: "pending", assessment }; },
      },
    );
    terrainReadiness.postMovement.guest = await waitForRustMultiplayerVisualTerrainReadiness(
      guestPage,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "guest-post-movement",
        failureStage: acceptanceStage,
        onObservation: (assessment) => { terrainReadiness.postMovement.guest = { status: "pending", assessment }; },
      },
    );
    const movementHostScreenshot = path.join(options.outputDirectory, "05-host-observed-guest-movement.png");
    const movementGuestScreenshot = path.join(options.outputDirectory, "06-guest-after-movement.png");
    await Promise.all([hostPage.screenshot({ path: movementHostScreenshot, type: "png" }), guestPage.screenshot({ path: movementGuestScreenshot, type: "png" })]);
    screenshots.hostObservedGuestMovement = relativeEvidencePath(options.repositoryRoot, movementHostScreenshot);
    screenshots.guestAfterMovement = relativeEvidencePath(options.repositoryRoot, movementGuestScreenshot);

    const initialHostSequence = movement.delta.after.host.runtime.multiplayer.authorityDeltaSequence;
    const initialGuestApplied = movement.delta.after.guest.runtime.multiplayer.authorityDeltaApplied;
    acceptanceStage = "disconnect";
    disconnect = await disconnectGuestThroughUi(hostPage, guestPage, options.timeoutMilliseconds);
    assertOptionalR5PlayerAuthorityRoutes(options, "disconnect title return", [["host", hostPage], ["guest", guestPage]]);
    const guestLocalCatalogAfterTitleReturn = await readRustMultiplayerLocalWorldIdentity(guestPage, {
      ...WORLD_FIXTURE.guest,
      id: guestLocalCatalogInvariant.before.catalogEntry?.id ?? null,
    });
    guestLocalCatalogInvariant = Object.freeze({
      status: "passed",
      before: guestLocalCatalogInvariant.before,
      after: guestLocalCatalogAfterTitleReturn,
    });
    assertRustMultiplayerLocalWorldCatalogInvariant(guestLocalCatalogInvariant);
    const disconnectedHostScreenshot = path.join(options.outputDirectory, "07-host-after-guest-disconnect.png");
    await hostPage.screenshot({ path: disconnectedHostScreenshot, type: "png" });
    screenshots.hostAfterGuestDisconnect = relativeEvidencePath(options.repositoryRoot, disconnectedHostScreenshot);

    acceptanceStage = "signaling-reconnect";
    reconnectConnection = await manualDirectConnect(hostPage, guestPage, {
      offer: initialConnection.offerCode,
      answer: initialConnection.answerCode,
    }, options.timeoutMilliseconds, { requireR5PlayerAuthority: options.requireR5PlayerAuthority });
    assertOptionalR5PlayerAuthorityRoutes(options, "title reconnect", [["host", hostPage], ["guest", guestPage]]);
    assertCondition(reconnectConnection.pair.sessionId === initialConnection.pair.sessionId, "Reconnect changed the host session.");
    assertCondition(reconnectConnection.pair.token !== initialConnection.pair.token, "Reconnect reused the initial invite token.");
    acceptanceStage = "reconnect-command-continuity";
    const [reconnectAuthority, commandContinuity] = await Promise.all([
      waitForAuthorityPair(hostPage, guestPage, reconnectConnection.pair, {
        host: 1,
        guest: 1,
      }, options.timeoutMilliseconds),
      exerciseReconnectAuthorityCommandContinuity(
        hostPage,
        guestPage,
        disconnect.initialHostObserved,
        disconnect.initialCommandBoundary,
        options.timeoutMilliseconds,
      ),
    ]);
    if (options.requireR5PlayerAuthority) {
      const authorities = assertRustMultiplayerR5PlayerAuthorityPair(
        reconnectAuthority.hostSnapshot,
        reconnectAuthority.guestSnapshot,
        "reconnected session",
      );
      const guestOutboundPose = assertRustMultiplayerR5OutboundPoseDiagnostics(
        reconnectAuthority.guestSnapshot,
        { playerId: GUEST_PROFILE.networkId },
        "reconnected session guest",
      );
      r5PlayerAuthority.checkpoints.reconnectSession = Object.freeze({ authorities, guestOutboundPose });
    }
    acceptanceStage = "terrain-readiness-reconnect-session";
    terrainReadiness.reconnectSession.host = await waitForRustMultiplayerVisualTerrainReadiness(
      hostPage,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "host-reconnect-session",
        failureStage: acceptanceStage,
        onObservation: (assessment) => { terrainReadiness.reconnectSession.host = { status: "pending", assessment }; },
      },
    );
    terrainReadiness.reconnectSession.guest = await waitForRustMultiplayerVisualTerrainReadiness(
      guestPage,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "guest-reconnect-session",
        failureStage: acceptanceStage,
        onObservation: (assessment) => { terrainReadiness.reconnectSession.guest = { status: "pending", assessment }; },
      },
    );
    const hostPeerCount = await hostPage.locator(".multiplayer-peer-list > div").count();
    await hostPage.locator(".multiplayer-peer-list > div").filter({ hasText: GUEST_PROFILE.name }).waitFor();
    const reconnectHostScreenshot = path.join(options.outputDirectory, "08-reconnected-host-session.png");
    const reconnectGuestScreenshot = path.join(options.outputDirectory, "09-reconnected-guest-session.png");
    await Promise.all([hostPage.screenshot({ path: reconnectHostScreenshot, type: "png" }), guestPage.screenshot({ path: reconnectGuestScreenshot, type: "png" })]);
    screenshots.reconnectedHostSession = relativeEvidencePath(options.repositoryRoot, reconnectHostScreenshot);
    screenshots.reconnectedGuestSession = relativeEvidencePath(options.repositoryRoot, reconnectGuestScreenshot);
    await leaveMultiplayerPanel(hostPage, "host-reconnect");
    await hostPage.keyboard.press("m");
    await hostPage.getByRole("heading", { name: "Known Roads" }).waitFor();
    await hostPage.waitForFunction(() => document.querySelectorAll(".hearthroads-other-player-pin").length === 1, undefined, { timeout: 30_000 });
    const reconnectPins = await hostMapPins(hostPage);
    const reconnectWorld = compactWorldState(reconnectAuthority.guestSnapshot);
    const reconnectHostWorld = compactWorldState(reconnectAuthority.hostSnapshot);
    assertRustMultiplayerStateTransfer(reconnectHostWorld, reconnectWorld, guestLocalWorld);
    const reconnectProofInput = {
      signals: reconnectConnection.pair,
      panelRouting: reconnectConnection.panelRouting,
      world: reconnectWorld,
      hostPeerCount,
      hostMapPins: reconnectPins.length,
      hostAuthoritySequence: reconnectAuthority.proof.host.multiplayer.authorityDeltaSequence,
      guestAuthorityApplied: reconnectAuthority.proof.guest.multiplayer.authorityDeltaApplied,
      guestKeyframeAccepted: reconnectAuthority.proof.guest.multiplayer.transport?.guest?.keyframeAccepted === true,
      guestPresentationReady: reconnectAuthority.proof.guest.multiplayer.transport?.guest?.presentationReady === true,
      guestAcceptedDeltaCount: reconnectAuthority.proof.guest.multiplayer.transport?.guest?.acceptedDeltaCount ?? null,
      guestAuthorityStateHash: reconnectAuthority.proof.guest.multiplayer.lastStateHash ?? null,
      commandContinuity,
    };
    assertRustMultiplayerReconnectProof({
      signals: initialConnection.pair,
      world: initialWorld,
      hostAuthoritySequence: initialHostSequence,
      guestAuthorityApplied: initialGuestApplied,
    }, reconnectProofInput);
    assertOptionalR5PlayerAuthorityRoutes(options, "final reconnected gameplay", [["host", hostPage], ["guest", guestPage]]);
    if (options.requireR5PlayerAuthority) {
      assertCondition(Object.values(r5PlayerAuthority.checkpoints).every((checkpoint) => checkpoint !== null),
        "Combined R9+R5 acceptance omitted a required player-authority checkpoint.");
    }
    assertLocalOnlyRtcConfigurations((await readBrowserSnapshot(hostPage)).rtcConfigurations, "host browser");
    assertLocalOnlyRtcConfigurations((await readBrowserSnapshot(guestPage)).rtcConfigurations, "guest browser");
    assertCondition(hostContext.pages().length === 1 && guestContext.pages().length === 1, "Acceptance opened an unexpected browser page.");
    assertCondition(routeRequests.some((request) => request.status === 200 && request.pathname === "/engine/manifest.json"), "Production /engine/manifest.json alias was not exercised.");
    assertCondition(routeRequests.some((request) => request.status === 200 && request.pathname?.startsWith(`/engine/${selection.hash}/`) && request.pathname.endsWith(".wasm")), "Exact content-addressed Wasm route was not exercised.");
    assertCondition(routeRequests.every((request) => request.status === 200), "Candidate engine route recorded a rejected request.");
    result = {
      schema: 1,
      gate: "blockwild-rust-multiplayer-browser-v1",
      status: "passed",
      createdAt: new Date().toISOString(),
      authorityClaim: options.requireR5PlayerAuthority
        ? "rust-r5-native-player-simulation-with-rust-native-guest-pose-custody-and-compatibility-world-keyframes"
        : "rust-authoritative-transport-with-native-guest-pose-custody-and-compatibility-world-keyframes",
      acceptanceLane: options.requireR5PlayerAuthority
        ? "r9-plus-r5-combined-candidate"
        : "r9-multiplayer-candidate",
      artifact: {
        hash: selection.hash,
        variant: selection.variant,
        source: selection.relativeDirectory,
        sourceSnapshot: selection.sourceSnapshot,
        treeSnapshot: selection.treeSnapshot,
        createdAt: selection.manifest.createdAt,
        routeRequests,
      },
      harness: {
        baseUrl: managedServer.baseUrl,
        managedVite: true,
        hmr: false,
        watch: "ignore-all",
        engineServing: "exact-candidate-production-/engine-alias",
        browserOwnership: "two-independent-playwright-persistent-contexts",
        browserExecutable: browserExecutable ?? "playwright-managed",
        playwrightSource: playwright.source,
        profiles: [path.basename(hostProfileDirectory), path.basename(guestProfileDirectory)],
        viteRuntimeToken: path.basename(viteRuntimeDirectory),
        runtimeStateOwnership: "output-scoped-and-removed-after-server-close",
        processTracking: cleanup.processTracking,
        signaling: "manual-offer-answer-copied-in-process",
        rendezvous: "not-used",
        localIceCandidateMode: "numeric-host-candidates-with-browser-mDNS-masking-disabled-for-this-loopback-only-gate",
        managedViteWebSockets: "observed-separately-as-exact-loopback-control-channels",
        iceServers: [],
        browserGateMutex: browserMutexEvidence,
      },
      bootstrapEvidence: {
        status: "passed",
        expectedBuildProfile: "rust-primary",
        navigation,
        pages: harnessDiagnostics,
        lifecycle: pageLifecycle,
      },
      guestLocalCatalogInvariant,
      terrainReadiness,
      r5PlayerAuthority: Object.freeze({
        ...r5PlayerAuthority,
        status: options.requireR5PlayerAuthority ? "passed" : "not-requested",
      }),
      failureClassification: null,
      initialConnection: {
        offer: initialConnection.offer,
        answer: initialConnection.answer,
        signals: initialConnection.pair,
        runtime: initialAuthority.proof,
        generationCertificates: initialAuthority.generationCertificates,
        stateTransfer: {
          guestLocalBeforeJoin: guestLocalWorld,
          host: initialHostWorld,
          guestAfterJoin: initialWorld,
        },
        world: initialWorld,
        hostPeerCount: 1,
      },
      movement,
      disconnect,
      reconnect: {
        offer: reconnectConnection.offer,
        answer: reconnectConnection.answer,
        ...reconnectProofInput,
        runtime: reconnectAuthority.proof,
        generationCertificates: reconnectAuthority.generationCertificates,
        hostWorld: reconnectHostWorld,
        hostMapPin: reconnectPins[0],
      },
      screenshots,
      screenshotAttempts,
      canonicalAssetRequests,
      errors: streams,
      cleanup,
      exclusions: {
        playerMovementSimulation: options.requireR5PlayerAuthority
          ? "Rust-native R5 player simulation is proven only in this explicit selector lane; the default R9 verifier and formal authority ledger are not promoted by this candidate-only gate."
          : "Local player movement remains TypeScript-simulated. This verifier proves only that the resulting guest pose is decoded, validated, recorded, and projected by Rust before host gameplay state consumes it.",
        worldKeyframeProducer: "Periodic world keyframes still report coarse-legacy-projection with pendingNativeProducer=true; native guest-pose custody does not promote that separate compatibility producer.",
        candidatePromotion: "This verifier serves only public/engine-locator-candidate through production-shaped aliases. It does not mutate or promote canonical public/engine.",
        externalSignaling: "No room-code rendezvous or multiplayer WebSocket signaling is used; SDP offer/answer text is copied inside this verifier and all RTCPeerConnection iceServers are forced empty. Exact loopback Vite control WebSockets are observed separately and never counted as multiplayer signaling.",
      },
    };
  } catch (error) {
    const fixtureDiagnostics = error && typeof error === "object" && "fixtureDiagnostics" in error
      ? error.fixtureDiagnostics
      : null;
    const connectionDiagnostics = error && typeof error === "object" && "connectionDiagnostics" in error
      ? error.connectionDiagnostics
      : null;
    const authorityDiagnostics = error && typeof error === "object" && "authorityDiagnostics" in error
      ? error.authorityDiagnostics
      : null;
    const disconnectEvidence = error && typeof error === "object" && "disconnectEvidence" in error
      ? error.disconnectEvidence
      : null;
    const terrainReadinessEvidence = error && typeof error === "object" && "terrainReadinessEvidence" in error
      ? error.terrainReadinessEvidence
      : null;
    const panelRoutingEvidence = error && typeof error === "object" && "panelRoutingEvidence" in error
      ? error.panelRoutingEvidence
      : null;
    if (error?.harnessDiagnosticsByPage) {
      harnessDiagnostics.host = error.harnessDiagnosticsByPage.host ?? harnessDiagnostics.host;
      harnessDiagnostics.guest = error.harnessDiagnosticsByPage.guest ?? harnessDiagnostics.guest;
    } else if (error?.harnessDiagnostics?.label === "host" || error?.harnessDiagnostics?.label === "guest") {
      harnessDiagnostics[error.harnessDiagnostics.label] = error.harnessDiagnostics;
    }
    for (const [label, page] of [["host", hostPage], ["guest", guestPage]]) {
      if (!page) continue;
      harnessDiagnostics[label] = await readRustMultiplayerHarnessDiagnostics(page, {
        label,
        lifecycle: pageLifecycle[label],
        navigation: navigation[label],
        streams,
        expectedBuildProfile: "rust-primary",
      }).catch((diagnosticError) => Object.freeze({
        schema: 1,
        label,
        evaluationError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      }));
    }
    const failureClassification = classifyRustMultiplayerFailure(error, acceptanceStage, {
      initial: initialConnection !== null,
      reconnect: reconnectConnection !== null,
    });
    const { family: failureFamily, stage: failureStage } = failureClassification;
    boundedPush(streams.runtimeErrors, {
      phase: failureStage,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      ...(fixtureDiagnostics ? { fixtureDiagnostics } : {}),
      ...(connectionDiagnostics ? { connectionDiagnostics } : {}),
      ...(authorityDiagnostics ? { authorityDiagnostics } : {}),
      ...(disconnectEvidence ? { disconnectEvidence } : {}),
      ...(terrainReadinessEvidence ? { terrainReadinessEvidence } : {}),
      ...(panelRoutingEvidence ? { panelRoutingEvidence } : {}),
    });
    const failedCaptures = [
      ["failedHost", "host", hostPage, path.join(options.outputDirectory, "failed-host.png")],
      ["failedGuest", "guest", guestPage, path.join(options.outputDirectory, "failed-guest.png")],
    ];
    for (const [key, label, page, filePath] of failedCaptures) {
      const attempt = {
        label,
        requestedAt: new Date().toISOString(),
        path: relativeEvidencePath(options.repositoryRoot, filePath),
        pagePresent: page !== null,
        pageClosed: page?.isClosed() ?? null,
        status: "unavailable",
        error: null,
      };
      if (page) {
        try {
          await page.screenshot({ path: filePath, type: "png", timeout: 10_000 });
          const metadata = statSync(filePath);
          attempt.status = "captured";
          attempt.bytes = metadata.size;
          attempt.sha256 = sha256File(filePath);
          screenshots[key] = attempt.path;
        } catch (captureError) {
          attempt.status = "failed";
          attempt.error = captureError instanceof Error ? captureError.message : String(captureError);
        }
      }
      screenshotAttempts[label] = Object.freeze(attempt);
    }
    result = {
      schema: 1,
      gate: "blockwild-rust-multiplayer-browser-v1",
      status: "failed",
      createdAt: new Date().toISOString(),
      authorityClaim: "none",
      acceptanceLane: options.requireR5PlayerAuthority
        ? "r9-plus-r5-combined-candidate"
        : "r9-multiplayer-candidate",
      artifact: { hash: selection.hash, source: selection.relativeDirectory, sourceSnapshot: selection.sourceSnapshot },
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      failureClassification,
      ...(panelRoutingEvidence ? { panelRoutingEvidence } : {}),
      signaling: { initial: initialConnection?.pair ?? null, reconnect: reconnectConnection?.pair ?? null },
      harness: {
        baseUrl: managedServer?.baseUrl ?? managedServerAttempt?.baseUrl ?? null,
        managedVite: managedServer !== null,
        hmr: false,
        watch: "ignore-all",
        browserOwnership: "two-independent-playwright-persistent-contexts",
        browserGateMutex: browserMutexEvidence,
      },
      bootstrapEvidence: {
        status: failureFamily === "bootstrap" || failureFamily === "resource" ? "failed" : "completed-before-failure",
        expectedBuildProfile: "rust-primary",
        navigation,
        pages: harnessDiagnostics,
        lifecycle: pageLifecycle,
      },
      ...(fixtureDiagnostics ? { fixtureDiagnostics } : {}),
      ...(connectionDiagnostics ? { connectionDiagnostics } : {}),
      ...(authorityDiagnostics ? { authorityDiagnostics } : {}),
      ...(disconnectEvidence ? { disconnectEvidence } : {}),
      ...(guestLocalCatalogInvariant ? { guestLocalCatalogInvariant } : {}),
      terrainReadiness,
      r5PlayerAuthority: Object.freeze({ ...r5PlayerAuthority, status: "failed" }),
      ...(terrainReadinessEvidence ? { terrainReadinessEvidence } : {}),
      ...(movement ? { movement } : {}),
      ...(disconnect ? { disconnect } : {}),
      screenshots,
      screenshotAttempts,
      routeRequests,
      canonicalAssetRequests,
      errors: streams,
      cleanup,
    };
  } finally {
    if (guestPage) await guestPage.evaluate(() => window.set_game_key?.("KeyD", false)).catch(() => undefined);
    if (guestContext) await guestContext.close().then(() => { cleanup.guestContextClosed = true; }).catch((error) => boundedPush(streams.runtimeErrors, { phase: "guest-context-cleanup", message: error.message }));
    cleanup.guestBrowserDisconnected = guestBrowser === null
      ? !cleanup.guestContextStarted
      : await waitForBrowserDisconnect(guestBrowser).catch((error) => {
        boundedPush(streams.runtimeErrors, { phase: "guest-browser-cleanup", message: error.message });
        return false;
      });
    if (hostContext) await hostContext.close().then(() => { cleanup.hostContextClosed = true; }).catch((error) => boundedPush(streams.runtimeErrors, { phase: "host-context-cleanup", message: error.message }));
    cleanup.hostBrowserDisconnected = hostBrowser === null
      ? !cleanup.hostContextStarted
      : await waitForBrowserDisconnect(hostBrowser).catch((error) => {
        boundedPush(streams.runtimeErrors, { phase: "host-browser-cleanup", message: error.message });
        return false;
      });
    if (managedServer) {
      await closeViteServer(managedServer.server).then(() => { cleanup.serverClosed = true; }).catch((error) => {
        boundedPush(streams.runtimeErrors, { phase: "server-cleanup", message: error.message });
      });
      await waitForRustMultiplayerPortRefusal(managedServer.port).then(() => { cleanup.serverPortRefused = true; }).catch((error) => {
        boundedPush(streams.runtimeErrors, { phase: "server-port-cleanup", message: error.message });
      });
      try { cleanup.environmentRestored = managedServer.restoreEnvironment(); }
      catch (error) { boundedPush(streams.runtimeErrors, { phase: "environment-cleanup", message: error.message }); }
    } else if (managedServerAttempt) {
      cleanup.serverStarted = managedServerAttempt.server !== null;
      cleanup.serverClosed = managedServerAttempt.serverClosed;
      cleanup.serverPortRefused = managedServerAttempt.portRefused;
      cleanup.environmentRestored = managedServerAttempt.environmentRestored;
    }
    try { cleanup.candidateUnchanged = Boolean(assertRustMultiplayerCandidateUnchanged(selection)); }
    catch (error) { boundedPush(streams.runtimeErrors, { phase: "candidate-final-check", message: error.message }); }
    cleanup.aliveChildPidsAfterCleanup = cleanup.trackedChildPids.filter((pid) => {
      try { return exactProcessAlive(pid); }
      catch (error) {
        boundedPush(streams.runtimeErrors, { phase: "process-cleanup", pid, message: error.message });
        return true;
      }
    });
    if (cleanup.hostBrowserDisconnected) {
      try { cleanup.hostProfileRemoved = hostProfileDirectory === null || safeRemoveProfile(hostProfileDirectory, profileRoot); }
      catch (error) { boundedPush(streams.runtimeErrors, { phase: "host-profile-cleanup", message: error.message }); }
    } else boundedPush(streams.runtimeErrors, { phase: "host-profile-cleanup", message: "Refused profile removal before exact host Browser disconnection." });
    if (cleanup.guestBrowserDisconnected) {
      try { cleanup.guestProfileRemoved = guestProfileDirectory === null || safeRemoveProfile(guestProfileDirectory, profileRoot); }
      catch (error) { boundedPush(streams.runtimeErrors, { phase: "guest-profile-cleanup", message: error.message }); }
    } else boundedPush(streams.runtimeErrors, { phase: "guest-profile-cleanup", message: "Refused profile removal before exact guest Browser disconnection." });
    try {
      if (existsSync(profileRoot) && readdirSync(profileRoot).length === 0) rmdirSync(profileRoot);
      cleanup.profileRootRemoved = !existsSync(profileRoot);
    } catch (error) { boundedPush(streams.runtimeErrors, { phase: "profile-root-cleanup", message: error.message }); }
    if (cleanup.serverClosed && cleanup.serverPortRefused && cleanup.environmentRestored) {
      try { cleanup.viteRuntimeRemoved = safeRemoveViteRuntime(options.outputDirectory, viteRuntimeDirectory); }
      catch (error) { boundedPush(streams.runtimeErrors, { phase: "vite-runtime-cleanup", message: error.message }); }
    } else boundedPush(streams.runtimeErrors, { phase: "vite-runtime-cleanup", message: "Refused runtime removal before server close, port refusal, and exact environment restoration." });
    if (browserMutex) {
      try { cleanup.browserMutexReleased = await browserMutex.release(); }
      catch (error) {
        cleanup.browserMutexReleased = false;
        boundedPush(streams.runtimeErrors, { phase: "browser-mutex-cleanup", message: error.message });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    cleanup.eventsDrained = true;
    collectionState.active = false;
    let cleanupError = null;
    try { assertRustMultiplayerCleanupEvidence(cleanup); }
    catch (error) { cleanupError = error; }
    let finalError = null;
    try { assertRustMultiplayerBrowserErrorStreams(streams); }
    catch (error) { finalError = error; }
    if (cleanupError || finalError || result?.status !== "passed") {
      result = {
        ...result,
        status: "failed",
        authorityClaim: "none",
        error: result?.error ?? cleanupError?.message ?? finalError?.message ?? "Browser, server, profile, or candidate immutability cleanup gate failed.",
      };
    }
    result.cleanup = cleanup;
    result.errors = streams;
    writeFileSync(path.join(options.outputDirectory, "errors.json"), `${JSON.stringify(streams, null, 2)}\n`, "utf8");
    writeFileSync(path.join(options.outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return Object.freeze({ ...result, outputPath: path.join(options.outputDirectory, "result.json") });
}

async function main() {
  try {
    const result = await runRustMultiplayerBrowser(process.argv);
    if (result.help) {
      process.stdout.write(result.usage);
      return;
    }
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      acceptanceLane: result.acceptanceLane ?? null,
      authorityClaim: result.authorityClaim ?? "none",
      artifactHash: result.artifact?.hash ?? null,
      initialSession: result.initialConnection?.signals?.sessionId ?? null,
      movement: result.movement ? {
        guestDistance: result.movement.receipt?.guestDistance ?? null,
        authorityPoseSequence: result.movement.command?.authorityPose?.authoritySequence ?? null,
        nativeProjectionReceiptHash: result.movement.receipt?.nativeProjection?.receiptHash ?? null,
        nativePoseRecordRevision: result.movement.receipt?.nativeProjection?.recordRevision ?? null,
        nativePoseRecordHash: result.movement.receipt?.nativeProjection?.recordHash ?? null,
        hostDeltaBefore: result.movement.delta?.before?.host?.runtime?.multiplayer?.authorityDeltaSequence ?? null,
        hostDeltaAfter: result.movement.delta?.after?.host?.runtime?.multiplayer?.authorityDeltaSequence ?? null,
        guestDeltaBefore: result.movement.delta?.before?.guest?.runtime?.multiplayer?.authorityDeltaApplied ?? null,
        guestDeltaAfter: result.movement.delta?.after?.guest?.runtime?.multiplayer?.authorityDeltaApplied ?? null,
        attribution: result.movement.attribution?.level ?? null,
      } : null,
      reconnect: result.reconnect ? {
        guestId: result.reconnect.signals?.guestId ?? null,
        hostPeerCount: result.reconnect.hostPeerCount,
        hostMapPins: result.reconnect.hostMapPins,
        initialHostCommandSequence: result.reconnect.commandContinuity?.initialHostObserved?.finalAcceptedAuthoritySequence ?? null,
        finalInitialAuthoredCommandSequence: result.reconnect.commandContinuity?.initialCommandBoundary?.lastAuthoritySequence ?? null,
        reconnectCommandCursor: result.reconnect.commandContinuity?.reconnectCursor ?? null,
        reconnectCommandCount: result.reconnect.commandContinuity?.commands?.length ?? null,
        acceptedReconnectPoseSequences: result.reconnect.commandContinuity?.poseAuthoritySequences ?? null,
      } : null,
      r5PlayerAuthority: result.r5PlayerAuthority ? {
        status: result.r5PlayerAuthority.status ?? null,
        selector: result.r5PlayerAuthority.selector ?? null,
        checkpoints: Object.keys(result.r5PlayerAuthority.checkpoints ?? {}),
      } : null,
      screenshots: result.screenshots,
      cleanup: result.cleanup,
      outputPath: result.outputPath,
      error: result.error ?? null,
    }, null, 2)}\n`);
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Rust multiplayer browser verifier failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export function usage() {
  return `Usage: node scripts/verify-rust-multiplayer-browser.mjs \\
  --engine-dir public/engine-locator-candidate \\
  --expected-artifact-hash ${REQUIRED_MULTIPLAYER_ARTIFACT_HASH} \\
  --output <directory strictly beneath work/> \\
  [--timeout-ms <60000..900000>] [--playwright-module <path>] \\
  [--browser-executable <path>] [--require-r5-player-authority] [--headed]\n\nThe verifier always owns a loopback Vite server with HMR/watch disabled, serves the selected candidate at production /engine/ URLs, and uses in-process manual offer/answer exchange with no external rendezvous. The optional --require-r5-player-authority lane adds and continuously verifies experimental.rust-live-player-authority=r5 in both browser routes and requires exact R5 authority/pump readiness at every playing checkpoint.\n`;
}

if (isDirectInvocation(import.meta.url)) await main();
