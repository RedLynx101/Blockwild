import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RustEngineToolError,
  createRustEngineSourceSnapshot,
  findRepositoryRoot,
  isDirectInvocation,
  sha256File,
} from "./rust-engine-common.mjs";
import {
  acquireManagedBrowserGateMutex,
  assertR5AuthorityDiagnostics,
  collectR5RuntimeErrors,
  prepareCandidateRoute,
  resolveManagedCanonicalAsset,
  resolveWorkOutputDirectory,
} from "./verify-rust-r5-player-browser.mjs";
import {
  TERRAIN_EDIT_TITLE_MENU_LABELS,
  canonicalSavedEdits,
  selectTerrainBreakTarget,
  terrainEditAddress,
  terrainRayCells,
} from "./verify-rust-terrain-edit-reload-browser.mjs";
import {
  installRustMultiplayerViteEnvironment,
  isExpectedLocalMusicCancellation,
  isExpectedManagedViteWebSocket,
  rustMultiplayerManagedViteInlineConfig,
  rustMultiplayerManagedViteWrapperSource,
  waitForRustMultiplayerPortRefusal,
  waitForRustMultiplayerVisualTerrainReadiness,
} from "./verify-rust-multiplayer-browser.mjs";

const ARTIFACT_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const RECEIPT_HASH_PATTERN = /^[a-f0-9]{32}$/u;
const POSITIVE_NATIVE_ID_PATTERN = /^[1-9][0-9]*$/u;
const EXPECTED_ENGINE_RELATIVE_DIRECTORY = "public/engine-locator-candidate";
const CANONICAL_ENGINE_RELATIVE_DIRECTORY = "public/engine";
const PROFILE_ROOT_NAME = ".basic-dirt-profile";
const PROFILE_PREFIX = "browser-";
const VITE_RUNTIME_PREFIX = ".basic-dirt-vite-";
const DEFAULT_TIMEOUT_MILLISECONDS = 300_000;
const DEFAULT_SCENARIO = "dirt-cycle";
const GENERIC_GRASS_SCENARIO = "generic-grass";
const GENERIC_GRASS_RECOVERY_SCENARIO = "generic-grass-recovery";
const GENERIC_SHAPED_PROP_SCENARIO = "generic-shaped-prop";
const MEADOW_GRASS_BLOCK_ID = 73;
const WILDWOOD_SHELF_BLOCK_ID = 130;
const WILDWOOD_SHELF_ITEM_ID = 270;
const NATIVE_DROP_PICKUP_RADIUS = 1.45;
const DIRT_BLOCK_ID = 2;
const BERRY_ITEM_ID = 124;
const AIR_BLOCK_ID = 0;
const PRIMARY_ATTACK_BUTTON = 1 << 5;
const SECONDARY_USE_BUTTON = 1 << 6;
const MIN_Y = -64;
const CHUNK_SIZE = 16;
const MAX_AIM_ATTEMPTS = 36;
const TITLE_SCREENSHOT_MAX_ATTEMPTS = 12;
const TITLE_LABEL_MINIMUM_BRIGHT_PIXELS = 12;
const U64_MASK = BigInt("0xffffffffffffffff");
const FNV1A_64_OFFSET = BigInt("14695981039346656037");
const FNV1A_64_PRIME = BigInt("1099511628211");
const FNV1A_64_HIGH_PRIME = FNV1A_64_PRIME ^ BigInt(0x13b);
const NATIVE_BLOCK_EDIT_DIRTY_HASH_DOMAIN = "blockwild.integrated.native-block-edit-dirty-evidence.v1";
export const NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2 = Object.freeze([
  "lighting",
  "liquids",
  "topology",
  "meshing",
  "navigation",
  "maps",
  "persistence",
]);
const MANAGED_CANONICAL_ASSET_URLS = Object.freeze([
  "https://blockwild.app/manifest.webmanifest",
  "https://blockwild.app/brand/blockwild-icon-16.png",
  "https://blockwild.app/brand/blockwild-icon-32.png",
  "https://blockwild.app/brand/blockwild-icon-64.png",
  "https://blockwild.app/brand/blockwild-icon-192.png",
  "https://blockwild.app/brand/blockwild-icon-512.png",
]);

export const BASIC_DIRT_ACTION_WORLD_FIXTURE = Object.freeze({
  name: "Native Basic Dirt Receipt Acceptance",
  seed: "PINE-HOLLOW-105",
  mode: "survival",
  initialSelectedSlot: 0,
  acquiredDirtSlot: 1,
  starterStack: Object.freeze({ item: BERRY_ITEM_ID, count: 3 }),
  acquiredDirtStack: Object.freeze({ item: DIRT_BLOCK_ID, count: 1 }),
  expectedSpawn: Object.freeze([0, 36.51, -4]),
  expectedCreationEdits: Object.freeze({
    count: 4,
    sha256: "f0bb2632d601e4507703003b33cb0f6b8e4fb4a2d0b17bde481eac6ba77e06ab",
  }),
  naturalDirtCoordinate: Object.freeze([1, 35, -3]),
  acquisitionVantage: Object.freeze([3, -2]),
  finalPersistenceVantage: Object.freeze([3, -2]),
});

export const GENERIC_GRASS_ACTION_WORLD_FIXTURE = Object.freeze({
  name: "Native Generic Meadow Grass Receipt Acceptance",
  seed: "PINE-HOLLOW-105",
  mode: "survival",
  initialSelectedSlot: 0,
  starterStack: Object.freeze({ item: BERRY_ITEM_ID, count: 3 }),
  expectedSpawn: Object.freeze([0, 36.51, -4]),
  expectedCreationEdits: Object.freeze({
    count: 4,
    sha256: "f0bb2632d601e4507703003b33cb0f6b8e4fb4a2d0b17bde481eac6ba77e06ab",
  }),
  naturalMeadowGrassCoordinate: Object.freeze([1, 36, -3]),
  expectedTargetName: "Meadow Grass",
  miningVantage: Object.freeze([3, -2]),
  expectedBlockTransition: Object.freeze({
    expectedPreviousBlockId: MEADOW_GRASS_BLOCK_ID,
    expectedPreviousFacing: 0,
    expectedBlockId: AIR_BLOCK_ID,
    expectedFacing: 0,
  }),
  generatedDrop: Object.freeze({ item: MEADOW_GRASS_BLOCK_ID, count: 1 }),
});

export const GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE = Object.freeze({
  name: "Native Generic Wildwood Shelf Receipt Acceptance",
  seed: "PINE-HOLLOW-105",
  mode: "builder",
  survivalMode: "survival",
  initialSelectedSlot: 0,
  selectedStack: Object.freeze({ item: WILDWOOD_SHELF_ITEM_ID, count: 64 }),
  expectedSpawn: Object.freeze([0, 36.51, -4]),
  expectedCreationEdits: Object.freeze({
    count: 4,
    sha256: "f0bb2632d601e4507703003b33cb0f6b8e4fb4a2d0b17bde481eac6ba77e06ab",
  }),
  protectedNaturalCoordinate: Object.freeze([1, 36, -3]),
  placementCoordinate: Object.freeze([2, 37, -4]),
  placementSupportCoordinate: Object.freeze([2, 36, -4]),
  expectedSupportName: "Meadow Grass",
  placementVantage: Object.freeze([3, -4]),
  miningVantage: Object.freeze([3, -2]),
  expectedTargetName: "Wildwood Shelf",
  expectedFacing: 1,
  expectedBlockTransition: Object.freeze({
    placementPreviousBlockId: AIR_BLOCK_ID,
    placedBlockId: WILDWOOD_SHELF_BLOCK_ID,
    minedBlockId: AIR_BLOCK_ID,
  }),
  generatedDrop: Object.freeze({ item: WILDWOOD_SHELF_ITEM_ID, count: 1 }),
});

function fail(message, details) {
  throw new RustEngineToolError(message, details);
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function boundedPush(target, value, maximum = 512) {
  target.push(Object.freeze(value));
  while (target.length > maximum) target.shift();
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function nativeBlockEditDirtyHashBytesFromHex(value, label) {
  assertCondition(RECEIPT_HASH_PATTERN.test(value ?? ""), `${label} is not canonical lowercase hex.`);
  return Uint8Array.from(value.match(/.{2}/gu), (pair) => Number.parseInt(pair, 16));
}

function nativeBlockEditDirtyHashLittleEndian(value, byteCount) {
  const bytes = [];
  const maximum = BigInt(1) << BigInt(byteCount * 8);
  const integer = BigInt(value);
  assertCondition(integer >= 0 && integer < maximum, "Dirty-evidence canonical integer is out of range.");
  for (let shift = 0; shift < byteCount * 8; shift += 8) {
    bytes.push(Number(integer >> BigInt(shift) & BigInt(0xff)));
  }
  return Uint8Array.from(bytes);
}

class NativeBlockEditDirtyCanonicalHasher {
  constructor(domain) {
    this.low = FNV1A_64_OFFSET;
    this.high = FNV1A_64_OFFSET ^ BigInt("0xa0761d6478bd642f");
    this.writeString(domain);
  }

  writeRaw(bytes) {
    for (const byte of bytes) {
      const value = BigInt(byte);
      this.low = (this.low ^ value) * FNV1A_64_PRIME & U64_MASK;
      this.high = (this.high ^ (value << BigInt(1) | BigInt(1)))
        * FNV1A_64_HIGH_PRIME & U64_MASK;
    }
    return this;
  }

  writeBytes(bytes) {
    this.writeU64(bytes.byteLength);
    for (const byte of bytes) {
      const value = BigInt(byte);
      this.low = (this.low ^ value) * FNV1A_64_PRIME & U64_MASK;
      this.high = (this.high ^ value << BigInt(1)) * FNV1A_64_HIGH_PRIME & U64_MASK;
    }
    return this;
  }

  writeString(value) {
    return this.writeBytes(new TextEncoder().encode(value));
  }

  writeU16(value) {
    return this.writeRaw(nativeBlockEditDirtyHashLittleEndian(value, 2));
  }

  writeI32(value) {
    assertCondition(Number.isSafeInteger(value) && value >= -0x8000_0000 && value <= 0x7fff_ffff,
      "Dirty-evidence signed integer is out of range.");
    return this.writeRaw(nativeBlockEditDirtyHashLittleEndian(value >>> 0, 4));
  }

  writeU64(value) {
    return this.writeRaw(nativeBlockEditDirtyHashLittleEndian(value, 8));
  }

  finishHex() {
    return [...nativeBlockEditDirtyHashLittleEndian(this.low, 8),
      ...nativeBlockEditDirtyHashLittleEndian(this.high, 8)]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

/** Recompute the exact Rust/TypeScript canonical hash for one V2 dirty-evidence record. */
export function nativeBlockEditDirtyEvidenceHashV2(value) {
  const hasher = new NativeBlockEditDirtyCanonicalHasher(NATIVE_BLOCK_EDIT_DIRTY_HASH_DOMAIN)
    .writeU16(value.schema)
    .writeU64(value.sequence)
    .writeBytes(nativeBlockEditDirtyHashBytesFromHex(value.receiptHash, "Dirty-evidence receipt hash"))
    .writeU64(value.sections.length);
  for (const section of value.sections) {
    hasher.writeString(section.universeId).writeString(section.locationId)
      .writeI32(section.chunkX).writeI32(section.chunkZ).writeI32(section.sectionY);
  }
  hasher.writeU64(value.columns.length);
  for (const column of value.columns) hasher.writeI32(column.x).writeI32(column.z);
  hasher.writeU64(value.subsystemSeeds.length);
  for (const entry of value.subsystemSeeds) {
    const tag = NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2.indexOf(entry.subsystem);
    assertCondition(tag >= 0, "Dirty-evidence subsystem is unknown.");
    hasher.writeU16(tag).writeString(entry.seed);
  }
  return hasher.finishHex();
}

function comparablePath(value) {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathIsInside(parentDirectory, candidatePath) {
  const relation = path.relative(parentDirectory, candidatePath);
  return relation.length > 0
    && relation !== ".."
    && !relation.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relation);
}

function relativeEvidencePath(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
}

function isGenericGrassScenario(scenario) {
  return scenario === GENERIC_GRASS_SCENARIO || scenario === GENERIC_GRASS_RECOVERY_SCENARIO;
}

function isGenericShapedPropScenario(scenario) {
  return scenario === GENERIC_SHAPED_PROP_SCENARIO;
}

function parseRawOptions(argv) {
  const definitions = new Map([
    ["repo-root", "string"],
    ["expected-artifact-hash", "string"],
    ["output", "string"],
    ["engine-dir", "string"],
    ["timeout-ms", "integer"],
    ["playwright-module", "string"],
    ["browser-executable", "string"],
    ["scenario", "string"],
    ["headed", "boolean"],
    ["help", "boolean"],
  ]);
  const parsed = Object.create(null);
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}.`);
    const key = token.slice(2);
    const type = definitions.get(key);
    if (!type) fail(`Unknown option: ${token}.`);
    if (Object.hasOwn(parsed, key)) fail(`${token} may only be provided once.`);
    if (type === "boolean") {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value.`);
    if (type === "integer") {
      if (!/^[0-9]+$/u.test(value)) fail(`${token} requires a base-10 integer.`);
      parsed[key] = Number(value);
    } else parsed[key] = value;
    index += 1;
  }
  return parsed;
}

export function parseBasicDirtBrowserOptions(argv = process.argv, context = {}) {
  const raw = parseRawOptions(argv);
  const repositoryRoot = realpathSync(raw["repo-root"]
    ? findRepositoryRoot(path.resolve(context.cwd ?? process.cwd(), raw["repo-root"]))
    : findRepositoryRoot(context.cwd ?? process.cwd()));
  if (raw.help) return Object.freeze({ help: true, repositoryRoot });
  if (!ARTIFACT_HASH_PATTERN.test(raw["expected-artifact-hash"] ?? "")) {
    fail("--expected-artifact-hash is required and must be exactly 64 lowercase hexadecimal characters.");
  }
  if (typeof raw["engine-dir"] !== "string" || raw["engine-dir"].trim() === "") {
    fail(`--engine-dir is required and must explicitly select ${EXPECTED_ENGINE_RELATIVE_DIRECTORY}.`);
  }
  const expectedEngineDirectory = path.join(repositoryRoot, ...EXPECTED_ENGINE_RELATIVE_DIRECTORY.split("/"));
  const engineDirectory = path.resolve(repositoryRoot, raw["engine-dir"]);
  if (comparablePath(engineDirectory) !== comparablePath(expectedEngineDirectory)) {
    fail(`--engine-dir must resolve exactly to ${EXPECTED_ENGINE_RELATIVE_DIRECTORY}.`);
  }
  const timeoutMilliseconds = raw["timeout-ms"] ?? DEFAULT_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 60_000 || timeoutMilliseconds > 900_000) {
    fail("--timeout-ms must be an integer from 60000 through 900000.");
  }
  const scenario = raw.scenario ?? DEFAULT_SCENARIO;
  if (scenario !== DEFAULT_SCENARIO
    && !isGenericGrassScenario(scenario)
    && !isGenericShapedPropScenario(scenario)) {
    fail(`--scenario must be ${DEFAULT_SCENARIO}, ${GENERIC_GRASS_SCENARIO}, ${GENERIC_GRASS_RECOVERY_SCENARIO}, or ${GENERIC_SHAPED_PROP_SCENARIO}.`);
  }
  return Object.freeze({
    help: false,
    repositoryRoot,
    expectedArtifactHash: raw["expected-artifact-hash"],
    scenario,
    engineDirectory,
    outputDirectory: resolveWorkOutputDirectory(repositoryRoot, raw.output),
    timeoutMilliseconds,
    playwrightModule: raw["playwright-module"] ? path.resolve(repositoryRoot, raw["playwright-module"]) : null,
    browserExecutable: raw["browser-executable"] ? path.resolve(repositoryRoot, raw["browser-executable"]) : null,
    headless: raw.headed !== true,
  });
}

function assertNonSymlinkTree(rootDirectory, label) {
  const root = lstatSync(rootDirectory);
  if (root.isSymbolicLink() || !root.isDirectory()) fail(`${label} must be a non-symlink directory: ${rootDirectory}.`);
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) fail(`${label} must not contain symlinks: ${absolute}.`);
      if (metadata.isDirectory()) visit(absolute);
      else if (!metadata.isFile()) fail(`${label} contains an unsupported entry: ${absolute}.`);
    }
  };
  visit(rootDirectory);
}

export function immutableBasicDirtTreeSnapshot(rootDirectory) {
  assertNonSymlinkTree(rootDirectory, "Snapshotted tree");
  const entries = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const metadata = lstatSync(absolute);
      if (metadata.isDirectory()) {
        entries.push({ kind: "directory", relative });
        visit(absolute, relative);
      } else {
        entries.push({ kind: "file", relative, bytes: metadata.size, sha256: sha256File(absolute) });
      }
    }
  };
  visit(rootDirectory);
  const digest = createHash("sha256").update("blockwild-basic-dirt-browser-tree-v1\n", "utf8");
  for (const entry of entries) {
    digest.update(`${entry.kind}\0${entry.relative}\0${entry.bytes ?? ""}\0${entry.sha256 ?? ""}\n`, "utf8");
  }
  return Object.freeze({
    digest: digest.digest("hex"),
    files: entries.filter((entry) => entry.kind === "file").length,
    directories: entries.filter((entry) => entry.kind === "directory").length,
  });
}

function canonicalCandidateFile(filePath, contentType, immutable) {
  const canonical = realpathSync(filePath);
  const metadata = lstatSync(canonical);
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail(`Candidate route is not a regular file: ${filePath}.`);
  return Object.freeze({
    filePath: canonical,
    contentType,
    immutable,
    bytes: metadata.size,
    sha256: sha256File(canonical),
  });
}

export function selectBasicDirtCandidate(repositoryRoot, engineDirectory, expectedArtifactHash) {
  const candidate = prepareCandidateRoute(repositoryRoot, engineDirectory, expectedArtifactHash);
  const directory = realpathSync(candidate.verification.root);
  const canonicalDirectory = realpathSync(path.join(repositoryRoot, ...CANONICAL_ENGINE_RELATIVE_DIRECTORY.split("/")));
  assertNonSymlinkTree(directory, "Selected Basic Dirt candidate");
  assertNonSymlinkTree(canonicalDirectory, "Canonical engine tree");
  const routes = new Map();
  routes.set("/engine/manifest.json", canonicalCandidateFile(
    path.join(directory, "manifest.json"), "application/json; charset=utf-8", false,
  ));
  routes.set(`/engine/${candidate.artifact.hash}/manifest.json`, canonicalCandidateFile(
    path.join(candidate.artifact.directory, "manifest.json"), "application/json; charset=utf-8", true,
  ));
  for (const file of candidate.artifact.files) {
    routes.set(`/engine/${candidate.artifact.hash}/${file.path}`, canonicalCandidateFile(
      path.join(candidate.artifact.directory, ...file.path.split("/")), file.mimeType, true,
    ));
  }
  return Object.freeze({
    ...candidate,
    directory,
    canonicalDirectory,
    routes,
    candidateTreeSnapshot: immutableBasicDirtTreeSnapshot(directory),
    canonicalTreeSnapshot: immutableBasicDirtTreeSnapshot(canonicalDirectory),
  });
}

export function assertBasicDirtCandidateAndCanonicalUnchanged(selection) {
  const sourceSnapshot = createRustEngineSourceSnapshot(selection.repositoryRoot);
  assertCondition(sourceSnapshot.digest === selection.sourceSnapshot.digest
    && sourceSnapshot.fileCount === selection.sourceSnapshot.fileCount,
  "Rust engine source changed during Basic Dirt browser acceptance.");
  const candidateTreeSnapshot = immutableBasicDirtTreeSnapshot(selection.directory);
  const canonicalTreeSnapshot = immutableBasicDirtTreeSnapshot(selection.canonicalDirectory);
  assertCondition(JSON.stringify(candidateTreeSnapshot) === JSON.stringify(selection.candidateTreeSnapshot),
    "Isolated Basic Dirt candidate tree changed during browser acceptance.");
  assertCondition(JSON.stringify(canonicalTreeSnapshot) === JSON.stringify(selection.canonicalTreeSnapshot),
    "Canonical public/engine changed during isolated Basic Dirt browser acceptance.");
  return Object.freeze({ sourceSnapshot, candidateTreeSnapshot, canonicalTreeSnapshot });
}

function engineRequestPathname(requestUrl) {
  if (typeof requestUrl !== "string" || !requestUrl.startsWith("/")
    || requestUrl.includes("\\") || requestUrl.includes("%")) return null;
  const pathname = requestUrl.split(/[?#]/u, 1)[0];
  return pathname.split("/").some((segment) => segment === "." || segment === "..") ? null : pathname;
}

export function createBasicDirtEnginePlugin(selection, onRequest = () => undefined) {
  return {
    name: "blockwild-rust-basic-dirt-exact-engine",
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
        if (!route || (method !== "GET" && method !== "HEAD")) {
          const status = pathname === null ? 400 : 404;
          response.statusCode = status;
          response.setHeader("Cache-Control", "no-store");
          response.end();
          onRequest(Object.freeze({ method, pathname, status, bytes: 0, sha256: null }));
          return;
        }
        const metadata = lstatSync(route.filePath);
        if (metadata.isSymbolicLink() || !metadata.isFile()
          || metadata.size !== route.bytes || sha256File(route.filePath) !== route.sha256) {
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

async function startManagedViteServer(selection, timeoutMilliseconds, routeRequests, runtimeDirectory, onAttempt) {
  const port = await reserveLoopbackPort();
  const plugin = createBasicDirtEnginePlugin(selection, (entry) => boundedPush(routeRequests, entry));
  const inlineConfig = rustMultiplayerManagedViteInlineConfig(
    selection.repositoryRoot, port, runtimeDirectory, plugin,
  );
  writeFileSync(
    inlineConfig.configFile,
    rustMultiplayerManagedViteWrapperSource(selection.repositoryRoot, runtimeDirectory),
    { encoding: "utf8", flag: "wx" },
  );
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
    assertCondition(attempt.server.config.server.hmr === false
      && typeof ignored === "function"
      && ignored(path.join(selection.repositoryRoot, "app", "page.tsx")) === true,
    "Managed Vite did not retain HMR-off and ignore-all watch configuration.");
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
      } catch { /* Managed server is still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    fail("Managed Vite did not become ready within its bounded startup window.");
  } catch (error) {
    try {
      attempt.server?.httpServer?.closeAllConnections?.();
      await attempt.server?.close();
      attempt.serverClosed = attempt.server?.httpServer?.listening !== true;
      attempt.portRefused = await waitForRustMultiplayerPortRefusal(port);
      attempt.environmentRestored = restoreEnvironment ? restoreEnvironment() : true;
    } catch (cleanupError) {
      fail(`Managed Vite startup and cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}.`, {
        startupError: error instanceof Error ? error.message : String(error),
        attempt,
      });
    }
    throw error;
  }
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
      const loaded = await import(path.isAbsolute(candidate) ? pathToFileURL(candidate).href : candidate);
      if (loaded.chromium) return Object.freeze({ module: loaded, source: candidate });
      failures.push(`${candidate}: no chromium export`);
    } catch (error) { failures.push(`${candidate}: ${error?.code ?? error?.message ?? String(error)}`); }
  }
  fail("A local Playwright runtime is required; this verifier never downloads a package or browser.", { failures });
}

function discoverBrowserExecutable(explicitPath) {
  if (explicitPath) {
    if (!existsSync(explicitPath) || !statSync(explicitPath).isFile()) {
      fail(`Browser executable does not exist: ${explicitPath}.`);
    }
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

export function safeRemoveBasicDirtOwnedDirectory(parentDirectory, ownedDirectory, prefix) {
  const parent = realpathSync(parentDirectory);
  const resolved = path.resolve(ownedDirectory);
  assertCondition(path.dirname(resolved) === parent,
    `Refusing to remove a non-direct owned child: ${resolved}.`);
  assertCondition(path.basename(resolved).startsWith(prefix) && path.basename(resolved).length > prefix.length,
    `Refusing to remove a directory without the exact ownership prefix ${prefix}: ${resolved}.`);
  assertCondition(resolved !== parent && pathIsInside(parent, resolved),
    `Refusing to remove a dangerous owned-directory target: ${resolved}.`);
  if (!existsSync(resolved)) return true;
  const metadata = lstatSync(resolved);
  assertCondition(!metadata.isSymbolicLink() && metadata.isDirectory(),
    `Owned cleanup target must be a non-symlink directory: ${resolved}.`);
  rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return !existsSync(resolved);
}

function editEntryCoordinate(entry) {
  assertCondition(entry && /^-?[0-9]+,-?[0-9]+$/u.test(entry.chunkKey),
    "Canonical edit entry has no valid chunk key.");
  assertCondition(Number.isSafeInteger(entry.index) && entry.index >= 0,
    "Canonical edit entry has no valid index.");
  const [chunkX, chunkZ] = entry.chunkKey.split(",").map(Number);
  const yOffset = Math.floor(entry.index / (CHUNK_SIZE * CHUNK_SIZE));
  const horizontal = entry.index - yOffset * CHUNK_SIZE * CHUNK_SIZE;
  const localZ = Math.floor(horizontal / CHUNK_SIZE);
  const localX = horizontal - localZ * CHUNK_SIZE;
  return Object.freeze([
    chunkX * CHUNK_SIZE + localX,
    MIN_Y + yOffset,
    chunkZ * CHUNK_SIZE + localZ,
  ]);
}

/**
 * New Survival worlds may persist the Air edits made by the engine's bounded
 * spawn-clearance pass. Accept only edits inside that exact 3x3x3 footprint,
 * and require the protected acquisition cell to remain untouched.
 */
export function inspectSurvivalCreationEdits(storage, spawn, protectedCoordinate) {
  const canonical = canonicalSavedEdits(storage);
  const validSpawn = Array.isArray(spawn) && spawn.length === 3
    && Number.isSafeInteger(spawn[0]) && Number.isFinite(spawn[1])
    && Number.isSafeInteger(spawn[2]);
  const validProtectedCoordinate = Array.isArray(protectedCoordinate)
    && protectedCoordinate.length === 3
    && protectedCoordinate.every(Number.isSafeInteger);
  if (!validSpawn || !validProtectedCoordinate) {
    return Object.freeze({
      valid: false,
      spawnClearanceOnly: false,
      protectedCoordinateUntouched: false,
      canonical,
    });
  }
  const minimumClearY = Math.floor(spawn[1] + 0.5);
  const maximumClearY = Math.floor(spawn[1] + 2.5);
  const spawnClearanceOnly = canonical.entries.every((entry) => {
    const [x, y, z] = editEntryCoordinate(entry);
    return entry.type === AIR_BLOCK_ID
      && Math.abs(x - spawn[0]) <= 1
      && y >= minimumClearY && y <= maximumClearY
      && Math.abs(z - spawn[2]) <= 1;
  });
  const protectedAddress = terrainEditAddress(protectedCoordinate);
  const protectedCoordinateUntouched = !canonical.entries.some((entry) => (
    entry.chunkKey === protectedAddress.chunkKey && entry.index === protectedAddress.index
  ));
  return Object.freeze({
    valid: spawnClearanceOnly && protectedCoordinateUntouched,
    spawnClearanceOnly,
    protectedCoordinateUntouched,
    canonical,
  });
}

export function nativeBlockEditTransition(beforeStorage, afterStorage, expectedBlockId) {
  assertCondition(Number.isSafeInteger(expectedBlockId) && expectedBlockId >= 0,
    "Native block edit transition must expect one non-negative block id.");
  const before = canonicalSavedEdits(beforeStorage);
  const after = canonicalSavedEdits(afterStorage);
  const prior = new Map(before.entries.map((entry) => [`${entry.chunkKey}:${entry.index}`, entry]));
  const next = new Map(after.entries.map((entry) => [`${entry.chunkKey}:${entry.index}`, entry]));
  const changedKeys = [...new Set([...prior.keys(), ...next.keys()])]
    .filter((key) => prior.get(key)?.type !== next.get(key)?.type);
  assertCondition(changedKeys.length === 1,
    `Native block edit changed ${changedKeys.length} canonical edit addresses instead of exactly one.`);
  const changed = next.get(changedKeys[0]);
  assertCondition(changed !== undefined,
    "Native block edit deleted its only changed canonical edit address.");
  assertCondition(changed.type === expectedBlockId,
    `Native block edit wrote block ${changed.type} instead of ${expectedBlockId}.`);
  const coordinate = editEntryCoordinate(changed);
  const address = terrainEditAddress(coordinate);
  assertCondition(address.chunkKey === changed.chunkKey && address.index === changed.index,
    "Decoded native block edit coordinate does not round-trip its save address.");
  return Object.freeze({
    coordinate,
    address,
    before,
    after,
    expectedBlockId,
  });
}

export function basicDirtEditTransition(beforeStorage, afterStorage, expectedBlockId) {
  assertCondition(expectedBlockId === DIRT_BLOCK_ID || expectedBlockId === AIR_BLOCK_ID,
    "Basic Dirt edit transition must expect Dirt or Air.");
  return nativeBlockEditTransition(beforeStorage, afterStorage, expectedBlockId);
}

function savedCursor(snapshot) {
  return snapshot?.storage?.save?.rustNativeBlockEditProjection ?? null;
}

function savedPickupCursor(snapshot) {
  return snapshot?.storage?.save?.rustNativeDropPickupProjection ?? null;
}

function savedPlayerDropCursor(snapshot) {
  return snapshot?.storage?.save?.rustNativePlayerDropProjection ?? null;
}

function projectedCursor(snapshot) {
  return snapshot?.runtime?.playerAuthority?.nativeBlockEditProjection ?? null;
}

function projectedPickupCursor(snapshot) {
  return snapshot?.runtime?.playerAuthority?.dropPickupProjection ?? null;
}

function projectedPlayerDropCursor(snapshot) {
  return snapshot?.runtime?.playerAuthority?.playerDropProjection ?? null;
}

function pumpDiagnostics(snapshot) {
  return snapshot?.runtime?.playerAuthority?.pump ?? null;
}

function nativeInventoryDiagnostics(snapshot) {
  return snapshot?.runtime?.playerAuthority?.nativeInventory ?? null;
}

function assertGenericNativeBlockEditPumpReady(pump, label, { settled = false } = {}) {
  assertCondition(pump?.nativeBlockEditQueryConfigured === true
    && Number.isSafeInteger(pump.nativeBlockEditCursor)
    && pump.nativeBlockEditLegacySeedPending === false
    && Number.isSafeInteger(pump.nativeBlockEditQueryCalls)
    && pump.nativeBlockEditQueryCalls > 0,
  `${label} generic native block-edit query is not configured, seeded, and observed.`);
  assertCondition(pump.basicDirtActionQueryConfigured === false
    && pump.basicDirtActionQuerySuppressedByNativeBlockEdit === false
    && pump.basicDirtActionCursor === null
    && pump.basicDirtActionLegacySeedPending === false
    && pump.basicDirtActionQueryCalls === 0,
  `${label} legacy Basic Dirt query path is not exactly disabled.`);
  if (settled) {
    assertCondition(pump.pendingNativeBlockEditSequence === null
      && pump.pendingNativeBlockEditReceiptHash === null
      && pump.pendingNativeBlockEditIdentityHash === null,
    `${label} generic native block-edit receipt is still pending.`);
  }
  return pump;
}

function nativePersistenceDiagnostics(snapshot) {
  return snapshot?.runtime?.manager?.host?.nativePersistence ?? null;
}

function selectedSavedStack(snapshot) {
  const save = snapshot?.storage?.save;
  return Array.isArray(save?.inventory) && Number.isSafeInteger(save?.selected)
    ? save.inventory[save.selected] ?? null
    : null;
}

function savedStackAt(snapshot, slot) {
  const inventory = snapshot?.storage?.save?.inventory;
  return Array.isArray(inventory) && Number.isSafeInteger(slot) ? inventory[slot] ?? null : null;
}

function savedBlockFacing(snapshot, coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length !== 3
    || !coordinate.every(Number.isSafeInteger)) return null;
  const raw = snapshot?.storage?.save?.blockFacings?.[coordinate.join(",")];
  if (raw === undefined) return 0;
  return Number.isSafeInteger(raw) && raw >= 0 && raw <= 3 ? raw : null;
}

function exactPlainStack(stack, expected) {
  if (expected === null) return stack === null || stack === undefined;
  return stack?.item === expected.item
    && stack.count === expected.count
    && stack.durability === undefined
    && stack.metadata === undefined
    && Object.keys(stack).every((key) => key === "item" || key === "count");
}

function exactNativePlainStack(stack, expected) {
  if (expected === null) return stack === null || stack === undefined;
  return stack?.itemCode === expected.item
    && stack.count === expected.count
    && stack.durabilityMillionths === null
    && stack.metadataHash === "0".repeat(32)
    && Object.keys(stack).every((key) => (
      key === "itemCode" || key === "count" || key === "durabilityMillionths" || key === "metadataHash"
  ));
}

function canonicalDiagnosticRevision(value) {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? BigInt(value)
    : null;
}

function creativeCatalogNativeCustodyEvidence(
  beforeSnapshot,
  afterSnapshot,
  expectedSelectedSlot,
  expectedStack,
) {
  const before = nativeInventoryDiagnostics(beforeSnapshot);
  const after = nativeInventoryDiagnostics(afterSnapshot);
  const beforePump = pumpDiagnostics(beforeSnapshot);
  const afterPump = pumpDiagnostics(afterSnapshot);
  const beforeInventoryRevision = canonicalDiagnosticRevision(before?.inventoryContainerRevision);
  const afterInventoryRevision = canonicalDiagnosticRevision(after?.inventoryContainerRevision);
  const beforeExtractionRevision = canonicalDiagnosticRevision(before?.extractionRevision);
  const afterExtractionRevision = canonicalDiagnosticRevision(after?.extractionRevision);
  if (before?.held !== null
    || before?.selectedSlot !== expectedSelectedSlot
    || typeof before.inventoryContainer !== "string" || before.inventoryContainer.length === 0
    || beforeInventoryRevision === null || beforeExtractionRevision === null
    || after?.inventoryContainer !== before.inventoryContainer
    || after?.selectedSlot !== expectedSelectedSlot
    || !exactNativePlainStack(after?.held, expectedStack)
    || afterInventoryRevision !== beforeInventoryRevision + BigInt(1)
    || afterExtractionRevision === null || afterExtractionRevision <= beforeExtractionRevision
    || !Number.isSafeInteger(beforePump?.commandCalls)
    || !Number.isSafeInteger(afterPump?.commandCalls)
    || afterPump.commandCalls < beforePump.commandCalls + 1
    || !Number.isSafeInteger(beforePump?.creativeSlotSetCalls)
    || !Number.isSafeInteger(afterPump?.creativeSlotSetCalls)
    || afterPump.creativeSlotSetCalls !== beforePump.creativeSlotSetCalls + 1) {
    return null;
  }
  return Object.freeze({
    inventoryContainer: before.inventoryContainer,
    selectedSlot: expectedSelectedSlot,
    inventoryRevisionBefore: before.inventoryContainerRevision,
    inventoryRevisionAfter: after.inventoryContainerRevision,
    extractionRevisionBefore: before.extractionRevision,
    extractionRevisionAfter: after.extractionRevision,
    commandCallsBefore: beforePump.commandCalls,
    commandCallsAfter: afterPump.commandCalls,
    creativeSlotSetCallsBefore: beforePump.creativeSlotSetCalls,
    creativeSlotSetCallsAfter: afterPump.creativeSlotSetCalls,
  });
}

export function assertCreativeCatalogNativeCustody(
  beforeSnapshot,
  afterSnapshot,
  expectedSelectedSlot,
  expectedStack,
) {
  const evidence = creativeCatalogNativeCustodyEvidence(
    beforeSnapshot,
    afterSnapshot,
    expectedSelectedSlot,
    expectedStack,
  );
  assertCondition(evidence !== null,
    "Creative catalog selection did not prove one exact BWF7 native selected-slot CAS from the baseline custody row.");
  return evidence;
}

function exactPlainDirtStack(stack, expectedCount = BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtStack.count) {
  return stack?.item === DIRT_BLOCK_ID
    && stack.count === expectedCount
    && stack.durability === undefined
    && stack.metadata === undefined;
}

function exactStarterStack(stack) {
  return exactPlainStack(stack, BASIC_DIRT_ACTION_WORLD_FIXTURE.starterStack);
}

function exactNativePlainDropFromSave(drop, expectedItem, expectedCount = 1, { requireFresh = false } = {}) {
  return drop?.item === expectedItem
    && drop.count === expectedCount
    && POSITIVE_NATIVE_ID_PATTERN.test(drop.rustEntityId ?? "")
    && Number.isFinite(drop.x) && Number.isFinite(drop.y) && Number.isFinite(drop.z)
    && Number.isFinite(drop.vx) && Number.isFinite(drop.vy) && Number.isFinite(drop.vz)
    && Number.isFinite(drop.rotationY)
    && drop.pickupDelay === 0.35
    && Number.isFinite(drop.age) && drop.age >= 0
    && (!requireFresh || drop.age === 0)
    && drop.durability === undefined
    && drop.metadata === undefined;
}

function exactNativeDropFromSave(drop, options = {}) {
  return exactNativePlainDropFromSave(drop, DIRT_BLOCK_ID, 1, options);
}

function decimalInteger(value) {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
}

function exactRoundedVector(actual, expected) {
  return Array.isArray(actual) && actual.length === 3
    && [expected.x, expected.y, expected.z].every((value, index) => (
      Number.isFinite(value) && actual[index] === Number(value.toFixed(3))
    ));
}

/**
 * Proves that one compatibility drop root is the exact accepted Rust hot
 * transform for this extraction. Passing the previous sample additionally
 * proves monotonic extraction/entity/age continuity.
 */
export function assertNativeDropHotTransformSample(snapshot, rustEntityId, previous = null) {
  assertCondition(POSITIVE_NATIVE_ID_PATTERN.test(rustEntityId ?? ""),
    "Native hot-transform sample has no positive entity identity.");
  const frame = snapshot?.runtime?.playerAuthority?.nativeDropTransforms;
  const extractionRevision = decimalInteger(frame?.extractionRevision);
  const authorityTick = decimalInteger(frame?.authorityTick);
  const inventoryDomainRevision = decimalInteger(frame?.inventoryDomainRevision);
  assertCondition(extractionRevision !== null && authorityTick !== null && inventoryDomainRevision !== null,
    "Native hot-transform frame has no exact monotonic source revisions.");
  const transforms = frame?.transforms?.filter((transform) => transform.entityId === rustEntityId) ?? [];
  assertCondition(transforms.length === 1,
    "Native hot-transform frame does not contain exactly one requested entity.");
  const transform = transforms[0];
  const entityRevision = decimalInteger(transform.entityRevision);
  const ageTicks = decimalInteger(transform.ageTicks);
  assertCondition(entityRevision !== null && ageTicks !== null
    && ageTicks <= BigInt(Number.MAX_SAFE_INTEGER)
    && Number.isFinite(transform.yawRadians),
  "Native hot transform has invalid entity, age, or rotation evidence.");
  const presented = snapshot?.state?.drops?.filter((drop) => drop.rustEntityId === rustEntityId) ?? [];
  assertCondition(presented.length === 1
    && exactRoundedVector(presented[0].position, transform.position)
    && exactRoundedVector(presented[0].velocity, transform.velocity)
    && presented[0].rotationY === Number(transform.yawRadians.toFixed(6))
    && presented[0].age === Number((Number(ageTicks) * 0.05).toFixed(3)),
  "Compatibility drop root does not exactly mirror its accepted Rust hot transform.");
  if (previous !== null) {
    assertCondition(previous.rustEntityId === rustEntityId
      && extractionRevision > BigInt(previous.extractionRevision)
      && authorityTick > BigInt(previous.authorityTick)
      && inventoryDomainRevision >= BigInt(previous.inventoryDomainRevision)
      && entityRevision >= BigInt(previous.entityRevision)
      && ageTicks >= BigInt(previous.ageTicks),
    "Native hot-transform sequence regressed or reused a prior extraction revision.");
  }
  return Object.freeze({
    rustEntityId,
    dropId: transform.dropId,
    extractionRevision: extractionRevision.toString(10),
    authorityTick: authorityTick.toString(10),
    inventoryDomainRevision: inventoryDomainRevision.toString(10),
    entityRevision: entityRevision.toString(10),
    ageTicks: ageTicks.toString(10),
    position: cloneJson(transform.position),
    velocity: cloneJson(transform.velocity),
    yawRadians: transform.yawRadians,
  });
}

/** Proves one durable save row was serialized from the same accepted frame. */
export function assertSavedNativeDropMatchesHotTransform(
  write,
  rustEntityId,
  { expectedItem = DIRT_BLOCK_ID, expectedCount = 1 } = {},
) {
  const frame = write?.runtime?.playerAuthority?.nativeDropTransforms;
  const transform = frame?.transforms?.find((candidate) => candidate.entityId === rustEntityId);
  assertCondition(transform?.position && transform?.velocity,
    "Durable native drop write has no complete accepted Rust hot transform.");
  const acceptedAgeTicks = decimalInteger(transform.ageTicks);
  const snapshot = {
    runtime: write?.runtime,
    state: {
      drops: transform ? [{
        rustEntityId,
        position: [transform.position.x, transform.position.y, transform.position.z]
          .map((value) => Number(value.toFixed(3))),
        velocity: [transform.velocity.x, transform.velocity.y, transform.velocity.z]
          .map((value) => Number(value.toFixed(3))),
        rotationY: Number(transform.yawRadians.toFixed(6)),
        age: acceptedAgeTicks !== null && acceptedAgeTicks <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number((Number(acceptedAgeTicks) * 0.05).toFixed(3))
          : Number.NaN,
      }] : [],
    },
  };
  const sample = assertNativeDropHotTransformSample(snapshot, rustEntityId);
  const saved = write?.save?.drops?.filter((drop) => drop.rustEntityId === rustEntityId) ?? [];
  assertCondition(saved.length === 1
    && exactNativePlainDropFromSave(saved[0], expectedItem, expectedCount)
    && saved[0].x === transform.position.x
    && saved[0].y === transform.position.y
    && saved[0].z === transform.position.z
    && saved[0].vx === transform.velocity.x
    && saved[0].vy === transform.velocity.y
    && saved[0].vz === transform.velocity.z
    && saved[0].rotationY === transform.yawRadians
    && saved[0].age === Number(BigInt(sample.ageTicks)) * 0.05,
  "Durable native drop row does not preserve the accepted Rust hot-transform age and identity.");
  return sample;
}

function compactActionWrite(write) {
  return Object.freeze({
    ordinal: write.ordinal,
    at: write.at,
    documentShape: nativeBlockEditDocumentShape(write.save),
    saveCursor: cloneJson(write.save?.rustNativeBlockEditProjection ?? null),
    savePickupCursor: cloneJson(write.save?.rustNativeDropPickupProjection ?? null),
    savePlayerDropCursor: cloneJson(write.save?.rustNativePlayerDropProjection ?? null),
    selected: write.save?.selected ?? null,
    inventory: cloneJson(write.save?.inventory ?? null),
    selectedStack: Array.isArray(write.save?.inventory) && Number.isSafeInteger(write.save?.selected)
      ? cloneJson(write.save.inventory[write.save.selected] ?? null)
      : null,
    edits: cloneJson(write.save?.edits ?? null),
    blockFacings: cloneJson(write.save?.blockFacings ?? null),
    drops: cloneJson(write.save?.drops ?? []),
    runtimeProjection: cloneJson(write.runtime?.playerAuthority?.nativeBlockEditProjection ?? null),
    nativeBlockEditFinalize: cloneJson(
      write.runtime?.playerAuthority?.nativeBlockEditFinalize ?? null,
    ),
    nativeBlockEditCheckpoint: cloneJson(
      write.runtime?.playerAuthority?.nativeBlockEditCheckpoint ?? null,
    ),
    runtimePickupProjection: cloneJson(write.runtime?.playerAuthority?.dropPickupProjection ?? null),
    dropPickupCheckpoint: cloneJson(write.runtime?.playerAuthority?.dropPickupCheckpoint ?? null),
    runtimePlayerDropProjection: cloneJson(write.runtime?.playerAuthority?.playerDropProjection ?? null),
    playerDropCheckpoint: cloneJson(write.runtime?.playerAuthority?.playerDropCheckpoint ?? null),
    runtimePump: cloneJson(write.runtime?.playerAuthority?.pump ?? null),
    nativePersistence: cloneJson(write.runtime?.manager?.host?.nativePersistence ?? null),
  });
}

function exactNativePersistenceIdentitySuccessor(before, after) {
  const left = before?.revision;
  const right = after?.revision;
  return before?.universeId === after?.universeId
    && before?.locationId === after?.locationId
    && before?.tick === after?.tick
    && RECEIPT_HASH_PATTERN.test(before?.stateHash ?? "")
    && RECEIPT_HASH_PATTERN.test(after?.stateHash ?? "")
    && before.stateHash !== after.stateHash
    && Number.isSafeInteger(left?.persistence)
    // One native save advances the runtime's internal persistence lane through
    // multiple journal phases. Session `saves` below is the exact +1 counter;
    // the integrated identity contract requires only a positive persistence-only successor.
    && Number.isSafeInteger(right?.persistence)
    && right.persistence > left.persistence
    && left.epoch === right.epoch
    && left.world === right.world
    && left.entities === right.entities
    && left.gameplay === right.gameplay
    && left.network === right.network
    && left.simulation === right.simulation;
}

function assertNativeCheckpointWitnessCommon(witness, label) {
  const before = witness?.persistenceBefore;
  const after = witness?.persistenceAfter;
  const checkpoint = witness?.checkpoint;
  assertCondition(RECEIPT_HASH_PATTERN.test(witness?.queryIdentityHash ?? "")
    && witness.identityBefore?.stateHash === witness.queryIdentityHash
    && exactNativePersistenceIdentitySuccessor(witness.identityBefore, witness.identityAfter),
  `${label} has no exact receipt-bound persistence identity witness.`);
  assertCondition(before?.state === "open" && after?.state === "open"
    && before.worldId === after.worldId
    && Number.isSafeInteger(before.saves)
    && before.saves >= 0
    && (before.lastCheckpointId === null
      || (typeof before.lastCheckpointId === "string" && before.lastCheckpointId.length > 0))
    && (before.saves === 0
      || (typeof before.lastCheckpointId === "string" && before.lastCheckpointId.length > 0))
    && after.saves === before.saves + 1
    && Number.isSafeInteger(before.platformOperations)
    && Number.isSafeInteger(checkpoint?.commits)
    && checkpoint.commits >= 1
    && after.platformOperations === before.platformOperations + checkpoint.commits
    && before.lastError === null && after.lastError === null
    && checkpoint.worldId === after.worldId
    && typeof checkpoint.saveId === "string" && checkpoint.saveId.length > 0
    && typeof checkpoint.checkpointId === "string" && checkpoint.checkpointId.length > 0
    && checkpoint.checkpointId !== before.lastCheckpointId
    && after.lastCheckpointId === checkpoint.checkpointId
    && RECEIPT_HASH_PATTERN.test(checkpoint.checkpointHash ?? "")
    && Number.isSafeInteger(checkpoint.journalSequence) && checkpoint.journalSequence >= 1
    && Number.isSafeInteger(checkpoint.records) && checkpoint.records >= 1
    && Number.isSafeInteger(checkpoint.requestBytes) && checkpoint.requestBytes >= 0
    && Number.isSafeInteger(checkpoint.responseBytes) && checkpoint.responseBytes >= 0,
  `${label} checkpoint witness does not attest exactly one durable native save.`);
}

/**
 * Prove that one mutating V2 block-edit checkpoint carries the exact Rust-authored
 * dirty section, column, subsystem ordering, ancestry, and canonical hash.
 */
export function assertRustAuthoredNativeBlockEditDirtySetV2(witness, coordinate) {
  assertCondition(Array.isArray(coordinate) && coordinate.length === 3
    && coordinate.every(Number.isSafeInteger),
  "Rust-authored dirty-set coordinate is invalid.");
  assertCondition(witness?.protocolVersion === 2 && witness.legacyFallback === null,
    "Native block edit did not use the non-legacy V2 dirty-evidence protocol.");
  const dirty = witness.dirty;
  assertCondition(dirty?.schema === 1
    && dirty.sequence === witness.cursorAfter
    && dirty.receiptHash === witness.receiptHash,
  "Native dirty evidence does not bind the exact cursor and V1 receipt ancestry.");
  assertCondition(RECEIPT_HASH_PATTERN.test(dirty.receiptHash ?? "")
    && RECEIPT_HASH_PATTERN.test(dirty.evidenceHash ?? ""),
  "Native dirty evidence does not use canonical lowercase hashes.");

  const [x, y, z] = coordinate;
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkZ = Math.floor(z / CHUNK_SIZE);
  const sectionY = Math.floor((y - MIN_Y) / CHUNK_SIZE);
  const identity = witness.identityBefore;
  assertCondition(dirty.sections.length === 1,
    "Native dirty evidence does not contain exactly one Rust-authored dirty section.");
  const section = dirty.sections[0];
  assertCondition(section?.universeId === identity?.universeId
    && section.locationId === identity?.locationId,
  "Native dirty section does not bind the active world identity.");
  assertCondition(section.chunkX === chunkX && section.chunkZ === chunkZ && section.sectionY === sectionY,
    "Native dirty section does not match the exact edited-cell section.");
  assertCondition(dirty.columns.length === 1
    && dirty.columns[0]?.x === x && dirty.columns[0]?.z === z,
  "Native dirty evidence does not contain the exact edited-cell column.");
  assertCondition(dirty.subsystemSeeds.length === NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2.length
    && dirty.subsystemSeeds.every((entry, index) => (
      entry?.subsystem === NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2[index]
        && RECEIPT_HASH_PATTERN.test(entry.seed ?? "")
    )),
  "Native dirty evidence does not contain the seven ordered canonical subsystem seeds.");
  assertCondition(nativeBlockEditDirtyEvidenceHashV2(dirty) === dirty.evidenceHash,
    "Native dirty evidence hash does not match its canonical fields.");
  return cloneJson(dirty);
}

function exactNativePersistenceCheckpointBinding(actual, witness) {
  return actual?.worldId === witness?.persistenceAfter?.worldId
    && actual?.saves === witness?.persistenceAfter?.saves
    && actual?.platformOperations === witness?.persistenceAfter?.platformOperations
    && actual?.lastCheckpointId === witness?.checkpoint?.checkpointId;
}

function exactNativePersistenceSnapshotBinding(actual, expected) {
  return actual?.worldId === expected?.worldId
    && actual?.saves === expected?.saves
    && actual?.platformOperations === expected?.platformOperations
    && actual?.lastCheckpointId === expected?.lastCheckpointId;
}

/** Assert one checkpoint result causally bound to one native player-drop receipt. */
export function assertNativePlayerDropCheckpointWitness(
  snapshot,
  { cursorBefore, cursorAfter, receiptHash },
) {
  const witness = snapshot?.runtime?.playerAuthority?.playerDropCheckpoint;
  assertCondition(witness?.schema === 1
    && witness.cursorBefore === cursorBefore
    && witness.cursorAfter === cursorAfter
    && witness.receiptHash === receiptHash,
  "Player drop has no exact receipt-bound checkpoint witness.");
  assertNativeCheckpointWitnessCommon(witness, "Player drop");
  return cloneJson(witness);
}

/** Assert one checkpoint result causally bound to one exact native pickup receipt. */
export function assertNativeDropPickupCheckpointWitness(
  snapshot,
  { cursorBefore, cursorAfter, receiptHash, rustEntityId },
) {
  const witness = snapshot?.runtime?.playerAuthority?.dropPickupCheckpoint;
  assertCondition(witness?.schema === 1
    && witness.cursorBefore === cursorBefore
    && witness.cursorAfter === cursorAfter
    && witness.receiptHash === receiptHash
    && witness.rustEntityId === rustEntityId
    && POSITIVE_NATIVE_ID_PATTERN.test(witness.rustEntityId ?? ""),
  "Native pickup has no exact receipt/entity-bound checkpoint witness.");
  assertNativeCheckpointWitnessCommon(witness, "Native pickup");
  return cloneJson(witness);
}

/** Assert one checkpoint result causally bound to one generic native block-edit receipt. */
export function assertNativeBlockEditCheckpointWitness(
  snapshot,
  {
    cursorBefore,
    cursorAfter,
    receiptHash,
    action,
    coordinate,
    expectedPreviousBlockId = action === "mine" ? DIRT_BLOCK_ID : AIR_BLOCK_ID,
    expectedBlockId = action === "mine" ? AIR_BLOCK_ID : DIRT_BLOCK_ID,
    expectedPreviousFacing = 0,
    expectedFacing = 0,
    expectedMutated = true,
    requireRustAuthoredDirtySet = false,
  },
) {
  assertCondition(action === "mine" || action === "place",
    "Native block-edit checkpoint action is invalid.");
  assertCondition(Array.isArray(coordinate) && coordinate.length === 3
    && coordinate.every(Number.isSafeInteger),
  "Native block-edit checkpoint coordinate is invalid.");
  const witness = snapshot?.runtime?.playerAuthority?.nativeBlockEditCheckpoint;
  assertCondition(Number.isSafeInteger(expectedPreviousBlockId) && expectedPreviousBlockId >= 0
    && Number.isSafeInteger(expectedBlockId) && expectedBlockId >= 0
    && Number.isSafeInteger(expectedPreviousFacing) && expectedPreviousFacing >= 0
    && Number.isSafeInteger(expectedFacing) && expectedFacing >= 0
    && typeof expectedMutated === "boolean",
  "Native block-edit checkpoint expectations are invalid.");
  assertCondition(witness?.schema === 1
    && witness.cursorBefore === cursorBefore
    && witness.cursorAfter === cursorAfter
    && witness.receiptHash === receiptHash
    && witness.action === action
    && witness.cell?.x === coordinate[0]
    && witness.cell?.y === coordinate[1]
    && witness.cell?.z === coordinate[2]
    && witness.cell.previousBlockId === expectedPreviousBlockId
    && witness.cell.blockId === expectedBlockId
    && witness.cell.previousFacing === expectedPreviousFacing
    && witness.cell.facing === expectedFacing
    && witness.cell.mutated === expectedMutated,
  "Native block edit has no exact receipt/action/cell-bound checkpoint witness.");
  assertNativeCheckpointWitnessCommon(witness, "Native block edit");
  if (requireRustAuthoredDirtySet) {
    assertRustAuthoredNativeBlockEditDirtySetV2(witness, coordinate);
  }
  return cloneJson(witness);
}

/**
 * Assert one end-to-end action transaction and its native-checkpoint / local
 * document / pump-ack ordering. The localStorage audit calls the public runtime
 * renderer synchronously from the real WorldStorage write; no mutation hook is
 * used by this evidence.
 */
export function assertGenericNativeBlockEditTransaction({
  action,
  before,
  after,
  auditWrites,
  firstAuditOrdinal = 0,
  expectedCoordinate = null,
  expectedSelectedSlot,
  expectedSelectedStackBefore,
  expectedSelectedStackAfter,
  expectedSavedSelectedSlotBefore = undefined,
  expectedSavedSelectedStackBefore = undefined,
  expectedPreviousBlockId = action === "mine" ? DIRT_BLOCK_ID : AIR_BLOCK_ID,
  expectedBlockId = action === "mine" ? AIR_BLOCK_ID : DIRT_BLOCK_ID,
  expectedPreviousFacing = 0,
  expectedFacing = 0,
  expectedGeneratedDrop = action === "mine" ? { item: DIRT_BLOCK_ID, count: 1 } : null,
  requireInventoryDocumentUnchanged = false,
  requireRustAuthoredDirtySet = false,
}) {
  assertCondition(action === "place" || action === "mine", "Native block-edit action kind is invalid.");
  assertCondition(Number.isSafeInteger(expectedPreviousBlockId) && expectedPreviousBlockId >= 0
    && Number.isSafeInteger(expectedBlockId) && expectedBlockId >= 0,
  "Native block-edit block expectations are invalid.");
  assertCondition(expectedGeneratedDrop === null || (
    Number.isSafeInteger(expectedGeneratedDrop?.item) && expectedGeneratedDrop.item >= 0
      && Number.isSafeInteger(expectedGeneratedDrop?.count) && expectedGeneratedDrop.count > 0
  ), "Native block-edit generated-drop expectation is invalid.");
  assertCondition(Number.isSafeInteger(expectedSelectedSlot)
    && expectedSelectedSlot >= 0 && expectedSelectedSlot <= 8,
  `${action} expected selected hotbar slot is invalid.`);
  for (const [label, expected] of [["before", expectedSelectedStackBefore], ["after", expectedSelectedStackAfter]]) {
    assertCondition(expected === null || (Number.isSafeInteger(expected?.item)
      && Number.isSafeInteger(expected?.count) && expected.count > 0),
    `${action} expected ${label} stack is invalid.`);
  }
  const savedSelectedSlotBefore = expectedSavedSelectedSlotBefore === undefined
    ? expectedSelectedSlot
    : expectedSavedSelectedSlotBefore;
  const savedSelectedStackBefore = expectedSavedSelectedStackBefore === undefined
    ? expectedSelectedStackBefore
    : expectedSavedSelectedStackBefore;
  assertCondition(Number.isSafeInteger(savedSelectedSlotBefore)
    && savedSelectedSlotBefore >= 0 && savedSelectedSlotBefore <= 8,
  `${action} expected saved pre-action hotbar slot is invalid.`);
  assertCondition(savedSelectedStackBefore === null || (Number.isSafeInteger(savedSelectedStackBefore?.item)
    && Number.isSafeInteger(savedSelectedStackBefore?.count) && savedSelectedStackBefore.count > 0),
  `${action} expected saved pre-action stack is invalid.`);
  assertCondition(before?.storage?.save?.selected === savedSelectedSlotBefore
    && after?.storage?.save?.selected === expectedSelectedSlot,
  `${action} did not preserve the exact saved-before/live-after hotbar selection boundary.`);
  assertCondition(exactPlainStack(selectedSavedStack(before), savedSelectedStackBefore),
    `${action} began with the wrong exact saved stack.`);
  assertCondition(exactPlainStack(selectedSavedStack(after), expectedSelectedStackAfter),
    `${action} ended with the wrong exact selected stack.`);
  assertCondition(before?.state?.inventory?.selectedSlot === expectedSelectedSlot
    && exactPlainStack(before?.state?.inventory?.held, expectedSelectedStackBefore)
    && pumpDiagnostics(before)?.selectedSlot === expectedSelectedSlot,
  `${action} began without the exact authoritative live selected stack.`);
  assertCondition(after?.state?.inventory?.selectedSlot === expectedSelectedSlot
    && exactPlainStack(after?.state?.inventory?.held ?? null, expectedSelectedStackAfter)
    && pumpDiagnostics(after)?.selectedSlot === expectedSelectedSlot,
  `${action} ended without the exact authoritative live selected stack.`);
  const cursorBefore = savedCursor(before)?.cursor;
  const cursorAfter = savedCursor(after)?.cursor;
  assertCondition(Number.isSafeInteger(cursorBefore) && cursorAfter === cursorBefore + 1,
    `${action} did not advance the saved receipt cursor exactly once.`);
  const edit = nativeBlockEditTransition(before.storage, after.storage, expectedBlockId);
  if (expectedCoordinate) {
    assertCondition(JSON.stringify(edit.coordinate) === JSON.stringify(expectedCoordinate),
      `${action} changed ${JSON.stringify(edit.coordinate)} instead of ${JSON.stringify(expectedCoordinate)}.`);
  }
  assertCondition(savedBlockFacing(before, edit.coordinate) === expectedPreviousFacing
    && savedBlockFacing(after, edit.coordinate) === expectedFacing,
  `${action} did not preserve the exact saved cardinal-facing transition.`);
  const projection = projectedCursor(after);
  const pump = pumpDiagnostics(after);
  const nativeBefore = nativePersistenceDiagnostics(before);
  const nativeAfter = nativePersistenceDiagnostics(after);
  assertCondition(projection?.cursor === cursorAfter && projection.lastReceiptHash === savedCursor(after).lastReceiptHash,
    `${action} browser projection cursor/hash disagrees with the saved document.`);
  assertCondition(RECEIPT_HASH_PATTERN.test(projection?.lastReceiptHash ?? ""),
    `${action} receipt hash is not canonical.`);
  assertGenericNativeBlockEditPumpReady(pump, action, { settled: true });
  assertCondition(pump.nativeBlockEditCursor === cursorAfter
    && pump.lastAcknowledgedNativeBlockEditSequence === cursorAfter
    && pump.lastAcknowledgedNativeBlockEditReceiptHash === projection.lastReceiptHash,
  `${action} did not finish with one exactly acknowledged native receipt.`);
  const checkpointWitness = assertNativeBlockEditCheckpointWitness(after, {
    cursorBefore,
    cursorAfter,
    receiptHash: projection.lastReceiptHash,
    action,
    coordinate: edit.coordinate,
    expectedPreviousBlockId,
    expectedBlockId,
    expectedPreviousFacing,
    expectedFacing,
    requireRustAuthoredDirtySet,
  });
  assertCondition(typeof nativeAfter.lastCheckpointId === "string" && nativeAfter.lastCheckpointId.length > 0,
    `${action} native checkpoint id is absent.`);
  const relevantWrites = auditWrites
    .filter((write) => Number.isSafeInteger(write?.ordinal) && write.ordinal >= firstAuditOrdinal)
    .map(compactActionWrite);
  const premature = relevantWrites.filter((write) => {
    let transition;
    try {
      transition = nativeBlockEditTransition(before.storage, { save: write.edits ? { edits: write.edits } : { edits: {} } }, expectedBlockId);
    } catch { return false; }
    return JSON.stringify(transition.coordinate) === JSON.stringify(edit.coordinate)
      && (write.saveCursor?.cursor ?? -1) <= cursorBefore;
  });
  assertCondition(premature.length === 0,
    `${action} persisted its compatibility edit before the native receipt cursor advanced.`);
  const orderedWrites = relevantWrites.filter((write) => {
    let transition;
    try {
      transition = nativeBlockEditTransition(before.storage, { save: { edits: write.edits ?? {} } }, expectedBlockId);
    } catch { return false; }
    const pending = write.runtimePump;
    return JSON.stringify(transition.coordinate) === JSON.stringify(edit.coordinate)
      && write.saveCursor?.cursor === cursorAfter
      && write.saveCursor.lastReceiptHash === projection.lastReceiptHash
      && write.runtimeProjection?.cursor === cursorAfter
      && write.runtimeProjection.lastReceiptHash === projection.lastReceiptHash
      && JSON.stringify(write.nativeBlockEditCheckpoint) === JSON.stringify(checkpointWitness)
      && savedBlockFacing({ storage: { save: { blockFacings: write.blockFacings } } }, edit.coordinate)
        === expectedFacing
      && write.selected === expectedSelectedSlot
      && exactPlainStack(write.selectedStack, expectedSelectedStackAfter)
      && pending?.nativeBlockEditCursor === cursorBefore
      && pending?.pendingNativeBlockEditSequence === cursorAfter
      && pending?.pendingNativeBlockEditReceiptHash === projection.lastReceiptHash
      && pending?.pendingNativeBlockEditIdentityHash === checkpointWitness.queryIdentityHash
      && exactNativePersistenceCheckpointBinding(write.nativePersistence, checkpointWitness);
  });
  assertCondition(orderedWrites.length >= 1,
    `${action} has no observed local document write between native checkpoint and exact receipt acknowledgment.`);
  const cursorSuccessorWrites = relevantWrites.filter((write) => (
    write.saveCursor?.cursor === cursorAfter || write.runtimeProjection?.cursor === cursorAfter
  ));
  assertCondition(cursorSuccessorWrites.every((write) => (
    write.saveCursor?.cursor === cursorAfter
      && write.saveCursor.lastReceiptHash === projection.lastReceiptHash
      && write.runtimeProjection?.cursor === cursorAfter
      && write.runtimeProjection.lastReceiptHash === projection.lastReceiptHash
      && JSON.stringify(write.nativeBlockEditCheckpoint) === JSON.stringify(checkpointWitness)
  )), `${action} exposed multiple receipt or checkpoint identities for one successor cursor.`);
  const firstOrderedOrdinal = Math.min(...orderedWrites.map((write) => write.ordinal));
  const pendingPredecessors = relevantWrites
    .filter((write) => {
      const pending = write.runtimePump;
      return write.ordinal < firstOrderedOrdinal
        && write.saveCursor?.cursor === cursorBefore
        && write.saveCursor.lastReceiptHash === savedCursor(before)?.lastReceiptHash
        && write.runtimeProjection?.cursor === cursorBefore
        && write.runtimeProjection.lastReceiptHash === projectedCursor(before)?.lastReceiptHash
        && (write.selected === savedSelectedSlotBefore || write.selected === expectedSelectedSlot)
        && JSON.stringify(write.inventory) === JSON.stringify(before.storage.save.inventory)
        && JSON.stringify(canonicalSavedEdits({ save: { edits: write.edits ?? {} } }))
          === JSON.stringify(canonicalSavedEdits(before.storage))
        && JSON.stringify(write.drops) === JSON.stringify(before.storage.save.drops ?? [])
        && pending?.nativeBlockEditCursor === cursorBefore
        && pending?.pendingNativeBlockEditSequence === cursorAfter
        && pending?.pendingNativeBlockEditReceiptHash === projection.lastReceiptHash
        && pending?.pendingNativeBlockEditIdentityHash === checkpointWitness.queryIdentityHash
        && Number.isSafeInteger(write.nativePersistence?.saves);
    })
    .sort((left, right) => right.ordinal - left.ordinal);
  const observedPendingPredecessor = pendingPredecessors[0]?.nativePersistence ?? null;
  assertCondition(observedPendingPredecessor === null
    || exactNativePersistenceSnapshotBinding(observedPendingPredecessor, checkpointWitness.persistenceBefore),
  `${action} checkpoint does not follow its latest evidenced pending predecessor.`);
  const checkpointAnchor = observedPendingPredecessor ?? checkpointWitness.persistenceBefore;
  assertCondition(nativeBefore?.worldId === checkpointWitness.persistenceBefore.worldId
    && nativeBefore.saves <= checkpointWitness.persistenceBefore.saves
    && nativeBefore.platformOperations <= checkpointWitness.persistenceBefore.platformOperations
    && nativeBefore.lastError === null
    && nativeAfter?.worldId === checkpointWitness.persistenceAfter.worldId
    && nativeAfter.saves >= checkpointWitness.persistenceAfter.saves
    && nativeAfter.platformOperations >= checkpointWitness.persistenceAfter.platformOperations
    && nativeAfter.lastError === null,
  `${action} final persistence diagnostics precede or contradict its causal checkpoint witness.`);

  if (requireInventoryDocumentUnchanged) {
    assertCondition(JSON.stringify(after.storage.save.inventory) === JSON.stringify(before.storage.save.inventory),
      `${action} changed the player inventory document despite a required no-op inventory transition.`);
  }
  const drops = after.storage.save.drops ?? [];
  let generatedHotTransform = null;
  if (expectedGeneratedDrop === null) {
    assertCondition(drops.length === (before.storage.save.drops ?? []).length,
      "Native block edit unexpectedly generated a browser drop.");
  } else {
    assertCondition(drops.length === (before.storage.save.drops ?? []).length + 1,
      "Native block edit did not add exactly one browser drop.");
    const generated = drops.find((drop) => !(before.storage.save.drops ?? [])
      .some((prior) => prior.rustEntityId === drop.rustEntityId));
    assertCondition(exactNativePlainDropFromSave(
      generated,
      expectedGeneratedDrop.item,
      expectedGeneratedDrop.count,
    ), "Native block edit did not save its one expected native-identity drop transform.");
    const projectionWrite = auditWrites.find((write) => orderedWrites
      .some((ordered) => ordered.ordinal === write?.ordinal)
      && write?.save?.drops?.filter((drop) => drop.rustEntityId === generated.rustEntityId).length === 1
      && write?.runtime?.playerAuthority?.nativeDropTransforms?.transforms
        ?.filter((transform) => transform.entityId === generated.rustEntityId).length === 1);
    assertCondition(projectionWrite,
      "Native block edit has no ordered browser write containing its accepted Rust hot transform.");
    generatedHotTransform = assertSavedNativeDropMatchesHotTransform(
      projectionWrite,
      generated.rustEntityId,
      { expectedItem: expectedGeneratedDrop.item, expectedCount: expectedGeneratedDrop.count },
    );
  }
  return Object.freeze({
    action,
    cursorBefore,
    cursorAfter,
    receiptHash: projection.lastReceiptHash,
    edit,
    nativePersistenceObservedBefore: cloneJson(nativeBefore),
    nativeCheckpointBefore: cloneJson(checkpointWitness.persistenceBefore),
    nativeCheckpointAnchor: cloneJson(checkpointAnchor),
    nativeCheckpointAfter: cloneJson(checkpointWitness.persistenceAfter),
    nativePersistenceObservedAfter: cloneJson(nativeAfter),
    checkpointWitness,
    dirtyEvidence: checkpointWitness.dirty ?? null,
    orderedWrites: Object.freeze(orderedWrites),
    generatedDrop: expectedGeneratedDrop !== null
      ? cloneJson((after.storage.save.drops ?? []).find((drop) => !(before.storage.save.drops ?? [])
        .some((prior) => prior.rustEntityId === drop.rustEntityId)) ?? null)
      : null,
    generatedHotTransform,
  });
}

export function assertBasicDirtActionTransaction(input) {
  return assertGenericNativeBlockEditTransaction(input);
}

function nativeBlockEditDocumentShape(save) {
  return JSON.stringify({
    seed: save?.seed ?? null,
    mode: save?.mode ?? null,
    player: save?.player ?? null,
    inventory: save?.inventory ?? null,
    selected: save?.selected ?? null,
    edits: save?.edits ?? null,
    blockFacings: save?.blockFacings ?? null,
    drops: save?.drops ?? null,
    rustNativeBlockEditProjection: save?.rustNativeBlockEditProjection ?? null,
    rustNativeDropPickupProjection: save?.rustNativeDropPickupProjection ?? null,
    rustNativePlayerDropProjection: save?.rustNativePlayerDropProjection ?? null,
  });
}

/**
 * Proves the deliberately failed local document write remained pending until
 * Save & Quit drained, retried, acknowledged, and wrote a settled successor.
 */
export function assertGenericNativeBlockEditRecoveryTransaction({
  before,
  pending,
  titleAfterSave,
  failureInjection,
  saveQuitMarker,
  auditWrites,
  firstAuditOrdinal = 0,
  expectedCoordinate,
  expectedPreviousBlockId,
  expectedBlockId,
  expectedSelectedSlot,
  expectedSelectedStack,
  expectedGeneratedDrop,
  requireRustAuthoredDirtySet = false,
}) {
  const cursorBefore = savedCursor(before)?.cursor;
  const runtimeProjection = projectedCursor(pending);
  const cursorAfter = runtimeProjection?.cursor;
  const receiptHash = runtimeProjection?.lastReceiptHash;
  assertCondition(Number.isSafeInteger(cursorBefore) && cursorAfter === cursorBefore + 1
    && RECEIPT_HASH_PATTERN.test(receiptHash ?? ""),
  "Recovery pending state has no exact successor native block-edit receipt.");
  assertCondition(nativeBlockEditDocumentShape(pending?.storage?.save)
      === nativeBlockEditDocumentShape(before?.storage?.save),
  "Failed local save changed the durable browser document before recovery.");
  const pump = pumpDiagnostics(pending);
  assertCondition(pump?.nativeBlockEditCursor === cursorBefore
    && pump.pendingNativeBlockEditSequence === cursorAfter
    && pump.pendingNativeBlockEditReceiptHash === receiptHash
    && pump.lastAcknowledgedNativeBlockEditSequence !== cursorAfter
    && pump.lastAcknowledgedNativeBlockEditReceiptHash !== receiptHash,
  "Failed local save did not retain the exact unacknowledged pump receipt.");
  const finalize = pending?.runtime?.playerAuthority?.nativeBlockEditFinalize;
  assertCondition(finalize?.schema === 1
    && finalize.state === "awaiting-local-save"
    && finalize.attempts === 1
    && typeof finalize.lastError === "string" && finalize.lastError.length > 0
    && finalize.cursorBefore === cursorBefore
    && finalize.cursorAfter === cursorAfter
    && finalize.receiptHash === receiptHash
    && finalize.pendingSelectedSlot === null,
  "Failed local save has no bounded one-attempt pending-finalize diagnostic.");
  const checkpointWitness = assertNativeBlockEditCheckpointWitness(pending, {
    cursorBefore,
    cursorAfter,
    receiptHash,
    action: "mine",
    coordinate: expectedCoordinate,
    expectedPreviousBlockId,
    expectedBlockId,
    expectedPreviousFacing: 0,
    expectedFacing: 0,
    requireRustAuthoredDirtySet,
  });
  assertCondition(exactNativePersistenceCheckpointBinding(
    nativePersistenceDiagnostics(pending), checkpointWitness,
  ), "Pending recovery does not retain its one exact native checkpoint.");

  const injection = failureInjection;
  assertCondition(injection?.schema === 1
    && injection.key === `blockwild-world-data-v1:${before?.storage?.activeWorldId}`
    && injection.expectedCursorAfter === cursorAfter
    && injection.armed === false && injection.restored === true
    && injection.matchingAttempts === 1
    && injection.failures === 1 && injection.passThroughs === 0
    && Number.isSafeInteger(injection.nonTargetPassThroughs)
    && injection.nonTargetPassThroughs >= 1
    && Number.isSafeInteger(injection.initialDocumentBytes)
    && injection.initialDocumentBytes > 0
    && Number.isSafeInteger(injection.initialCatalogBytes)
    && injection.initialCatalogBytes > 0
    && ARTIFACT_HASH_PATTERN.test(injection.initialDocumentSha256 ?? "")
    && ARTIFACT_HASH_PATTERN.test(injection.initialCatalogSha256 ?? "")
    && injection.restoredDocumentSha256 === injection.initialDocumentSha256
    && injection.restoredCatalogSha256 === injection.initialCatalogSha256
    && Array.isArray(injection.events) && injection.events.length >= 2,
  "Recovery did not use one exact restored active-world failure injection and rollback.");
  const failed = injection.events.find((event) => event.outcome === "injected-failure");
  const rollback = injection.events.find((event) => (
    event.outcome === "non-target-pass-through"
      && event.worldAttempt > (failed?.worldAttempt ?? Number.MAX_SAFE_INTEGER)
      && nativeBlockEditDocumentShape(event.save)
        === nativeBlockEditDocumentShape(before?.storage?.save)
  ));
  assertCondition(failed?.targetAttempt === 1 && rollback
    && failed.key === injection.key && rollback.key === injection.key,
  "Recovery failure and rollback attempts are missing or out of order.");
  assertCondition(failed?.save?.rustNativeBlockEditProjection?.cursor === cursorAfter
    && failed.save.rustNativeBlockEditProjection.lastReceiptHash === receiptHash
    && failed.runtime?.playerAuthority?.nativeBlockEditProjection?.cursor === cursorAfter
    && failed.runtime.playerAuthority.pump?.nativeBlockEditCursor === cursorBefore
    && failed.runtime.playerAuthority.pump.pendingNativeBlockEditSequence === cursorAfter
    && failed.runtime.playerAuthority.nativeBlockEditFinalize?.attempts === 0,
  "Injected failure did not intercept the exact projected successor before acknowledgment.");
  assertCondition(nativeBlockEditDocumentShape(rollback?.save)
      === nativeBlockEditDocumentShape(before?.storage?.save)
      && rollback.documentMatchesInitial === true
      && rollback.catalogMatchesInitial === true,
  "WorldStorage rollback did not restore the exact raw pre-receipt document and catalog.");

  const markerFinalize = saveQuitMarker?.runtime?.playerAuthority?.nativeBlockEditFinalize;
  const markerPump = saveQuitMarker?.runtime?.playerAuthority?.pump;
  assertCondition(saveQuitMarker?.schema === 1
    && saveQuitMarker.kind === "save-and-quit-click-boundary"
    && Number.isFinite(saveQuitMarker.at)
    && markerFinalize?.attempts === 1
    && markerFinalize.cursorAfter === cursorAfter
    && markerFinalize.receiptHash === receiptHash
    && markerPump?.nativeBlockEditCursor === cursorBefore
    && markerPump.pendingNativeBlockEditSequence === cursorAfter,
  "Save & Quit click was not marked while the exact failed receipt remained pending.");

  const finalCursor = savedCursor(titleAfterSave);
  assertCondition(finalCursor?.cursor === cursorAfter && finalCursor.lastReceiptHash === receiptHash,
    "Save & Quit did not durably retain the recovered receipt cursor and hash.");
  const edit = nativeBlockEditTransition(before.storage, titleAfterSave.storage, expectedBlockId);
  assertCondition(JSON.stringify(edit.coordinate) === JSON.stringify(expectedCoordinate),
    "Save & Quit recovered the wrong native-edited coordinate.");
  assertCondition(titleAfterSave.storage.save.selected === expectedSelectedSlot
    && exactPlainStack(selectedSavedStack(titleAfterSave), expectedSelectedStack)
    && JSON.stringify(titleAfterSave.storage.save.inventory)
      === JSON.stringify(before.storage.save.inventory),
  "Save & Quit recovery changed the selected stack or player inventory document.");
  const generatedDrops = (titleAfterSave.storage.save.drops ?? []).filter((drop) => (
    !(before.storage.save.drops ?? []).some((prior) => prior.rustEntityId === drop.rustEntityId)
  ));
  assertCondition(generatedDrops.length === 1
    && exactNativePlainDropFromSave(
      generatedDrops[0], expectedGeneratedDrop?.item, expectedGeneratedDrop?.count,
    ), "Save & Quit recovery did not retain exactly one expected native generated drop.");
  const generatedDrop = generatedDrops[0];
  const hotTransform = assertNativeDropHotTransformSample(pending, generatedDrop.rustEntityId);

  const writes = auditWrites
    .filter((write) => Number.isSafeInteger(write?.ordinal) && write.ordinal >= firstAuditOrdinal)
    .map(compactActionWrite);
  const isExactDurableSuccessor = (write) => (
    write.saveCursor?.cursor === cursorAfter
      && write.saveCursor.lastReceiptHash === receiptHash
      && write.runtimeProjection?.cursor === cursorAfter
      && write.runtimeProjection.lastReceiptHash === receiptHash
      && JSON.stringify(write.nativeBlockEditCheckpoint) === JSON.stringify(checkpointWitness)
      && write.selected === expectedSelectedSlot
      && exactPlainStack(write.selectedStack, expectedSelectedStack)
      && JSON.stringify(write.inventory) === JSON.stringify(before.storage.save.inventory)
      && (write.drops ?? []).filter((drop) => drop.rustEntityId === generatedDrop.rustEntityId).length === 1
      && write.documentShape === nativeBlockEditDocumentShape(titleAfterSave.storage.save)
  );
  const cursorSuccessorWrites = writes.filter((write) => (
    write.saveCursor?.cursor === cursorAfter
  ));
  assertCondition(cursorSuccessorWrites.length === 2
    && cursorSuccessorWrites.every(isExactDurableSuccessor),
  `Recovery exposed a divergent, missing, or duplicate successor document write. ${JSON.stringify(
    cursorSuccessorWrites.map((write) => ({
      ordinal: write.ordinal,
      exact: isExactDurableSuccessor(write),
      saveCursor: write.saveCursor,
      runtimeProjection: write.runtimeProjection,
      checkpoint: JSON.stringify(write.nativeBlockEditCheckpoint) === JSON.stringify(checkpointWitness),
      selected: write.selected,
      stack: write.selectedStack,
      inventory: JSON.stringify(write.inventory) === JSON.stringify(before.storage.save.inventory),
      dropCount: (write.drops ?? []).filter((drop) => drop.rustEntityId === generatedDrop.rustEntityId).length,
      document: write.documentShape === nativeBlockEditDocumentShape(titleAfterSave.storage.save),
    })),
  )}`);
  const retryWrites = cursorSuccessorWrites.filter((write) => (
    write.runtimePump?.nativeBlockEditCursor === cursorBefore
      && write.runtimePump.pendingNativeBlockEditSequence === cursorAfter
      && write.runtimePump.pendingNativeBlockEditReceiptHash === receiptHash
      && write.nativeBlockEditFinalize?.attempts === 1
  ));
  const settledWrites = cursorSuccessorWrites.filter((write) => (
    write.runtimePump?.nativeBlockEditCursor === cursorAfter
      && write.runtimePump.pendingNativeBlockEditSequence === null
      && write.runtimePump.lastAcknowledgedNativeBlockEditSequence === cursorAfter
      && write.runtimePump.lastAcknowledgedNativeBlockEditReceiptHash === receiptHash
      && write.nativeBlockEditFinalize === null
  ));
  assertCondition(retryWrites.length === 1 && settledWrites.length === 1,
    "Save & Quit has no unique retry-before-ack and settled-after-ack document writes.");
  const retryWrite = retryWrites[0];
  const settledWrite = settledWrites[0];
  const rollbackAuditWrites = writes.filter((write) => (
    write.saveCursor?.cursor === cursorBefore
      && write.runtimeProjection?.cursor === cursorAfter
      && write.runtimePump?.nativeBlockEditCursor === cursorBefore
      && write.runtimePump.pendingNativeBlockEditSequence === cursorAfter
      && write.documentShape === nativeBlockEditDocumentShape(before.storage.save)
  ));
  assertCondition(rollbackAuditWrites.length === 1
    && rollbackAuditWrites[0].ordinal < retryWrite.ordinal
    && retryWrite.ordinal < settledWrite.ordinal
    && retryWrite.at >= saveQuitMarker.at,
  "Recovery writes are not exactly ordered rollback, Save & Quit retry, then settled acknowledgment.");
  const optimisticOldCursorWrites = writes.filter((write) => {
    if (write.saveCursor?.cursor !== cursorBefore) return false;
    try {
      return JSON.stringify(nativeBlockEditTransition(
        before.storage, { save: { edits: write.edits ?? {} } }, expectedBlockId,
      ).coordinate) === JSON.stringify(expectedCoordinate);
    } catch {
      return false;
    }
  });
  assertCondition(optimisticOldCursorWrites.length === 0,
    "Recovery durably exposed the compatibility edit under the old receipt cursor.");
  const durableHotTransform = assertSavedNativeDropMatchesHotTransform(
    auditWrites.find((write) => write.ordinal === retryWrite.ordinal),
    generatedDrop.rustEntityId,
    { expectedItem: expectedGeneratedDrop.item, expectedCount: expectedGeneratedDrop.count },
  );
  return Object.freeze({
    cursorBefore,
    cursorAfter,
    receiptHash,
    edit,
    generatedDrop: cloneJson(generatedDrop),
    checkpointWitness,
    failure: cloneJson(failed),
    rollback: cloneJson(rollback),
    rollbackWrite: rollbackAuditWrites[0],
    saveQuitMarker: cloneJson(saveQuitMarker),
    pendingFinalize: cloneJson(finalize),
    retryWrite,
    settledWrite,
    hotTransform,
    durableHotTransform,
  });
}

/**
 * Assert one native drop-pickup custody transfer. The native checkpoint must
 * precede the one browser document that removes the exact projected entity and
 * installs its exact stack; the pump may acknowledge only after that write.
 */
export function assertNativeDirtPickupTransaction({
  before,
  after,
  auditWrites,
  firstAuditOrdinal = 0,
  expectedRustEntityId,
  expectedDestinationSlot = BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot,
}) {
  assertCondition(POSITIVE_NATIVE_ID_PATTERN.test(expectedRustEntityId ?? ""),
    "Pickup expected source is not one positive native entity id.");
  assertCondition(Number.isSafeInteger(expectedDestinationSlot)
    && expectedDestinationSlot >= 0 && expectedDestinationSlot <= 8,
  "Pickup expected destination hotbar slot is invalid.");
  const beforeCursor = savedPickupCursor(before)?.cursor;
  const afterCursor = savedPickupCursor(after)?.cursor;
  assertCondition(Number.isSafeInteger(beforeCursor) && afterCursor === beforeCursor + 1,
    "Pickup did not advance the saved receipt cursor exactly once.");
  assertCondition(savedCursor(after)?.cursor === savedCursor(before)?.cursor
    && savedCursor(after)?.lastReceiptHash === savedCursor(before)?.lastReceiptHash,
  "Pickup changed the generic native block-edit cursor.");
  assertCondition(JSON.stringify(canonicalSavedEdits(after.storage))
    === JSON.stringify(canonicalSavedEdits(before.storage)),
  "Pickup changed the compatibility terrain edit document.");
  assertCondition(exactPlainStack(savedStackAt(before, expectedDestinationSlot), null)
    && exactPlainDirtStack(savedStackAt(after, expectedDestinationSlot), 1),
  "Pickup did not install one exact Dirt stack into the empty destination slot.");
  assertCondition(before.storage.save.selected === BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot
    && after.storage.save.selected === BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot
    && exactStarterStack(selectedSavedStack(before))
    && exactStarterStack(selectedSavedStack(after)),
  "Pickup changed the selected starter stack before explicit hotbar selection.");

  const beforeDrops = before.storage.save.drops ?? [];
  const afterDrops = after.storage.save.drops ?? [];
  const sources = beforeDrops.filter((drop) => drop.rustEntityId === expectedRustEntityId);
  assertCondition(sources.length === 1 && exactNativeDropFromSave(sources[0]),
    "Pickup source is not one exact saved native Dirt drop.");
  assertCondition(afterDrops.length === beforeDrops.length - 1
    && !afterDrops.some((drop) => drop.rustEntityId === expectedRustEntityId)
    && afterDrops.every((drop) => beforeDrops.some((prior) => prior.rustEntityId === drop.rustEntityId)),
  "Pickup did not remove exactly its native source drop.");

  const projection = projectedPickupCursor(after);
  const pump = pumpDiagnostics(after);
  const nativeBefore = nativePersistenceDiagnostics(before);
  const nativeAfter = nativePersistenceDiagnostics(after);
  assertCondition(projection?.cursor === afterCursor
    && projection.lastReceiptHash === savedPickupCursor(after).lastReceiptHash
    && RECEIPT_HASH_PATTERN.test(projection.lastReceiptHash ?? ""),
  "Pickup runtime projection cursor/hash disagrees with the saved document.");
  assertCondition(pump?.dropPickupQueryConfigured === true
    && pump.dropPickupCursor === afterCursor
    && pump.dropPickupLegacySeedPending === false
    && pump.pendingDropPickupSequence === null
    && pump.pendingDropPickupReceiptHash === null
    && pump.pendingDropPickupIdentityHash === null
    && pump.lastAcknowledgedDropPickupSequence === afterCursor
    && pump.lastAcknowledgedDropPickupReceiptHash === projection.lastReceiptHash,
  "Pickup did not finish with one exactly acknowledged native receipt.");
  assertCondition(typeof nativeAfter.lastCheckpointId === "string" && nativeAfter.lastCheckpointId.length > 0,
    "Pickup native checkpoint id is absent.");
  const checkpointWitness = assertNativeDropPickupCheckpointWitness(after, {
    cursorBefore: beforeCursor,
    cursorAfter: afterCursor,
    receiptHash: projection.lastReceiptHash,
    rustEntityId: expectedRustEntityId,
  });
  assertCondition(nativeAfter?.worldId === checkpointWitness.persistenceAfter.worldId
    && nativeAfter.saves >= checkpointWitness.persistenceAfter.saves
    && nativeAfter.platformOperations >= checkpointWitness.persistenceAfter.platformOperations
    && nativeAfter.lastError === null,
  "Pickup final persistence diagnostics precede or contradict its causal checkpoint witness.");

  const relevantWrites = auditWrites
    .filter((write) => Number.isSafeInteger(write?.ordinal) && write.ordinal >= firstAuditOrdinal)
    .map(compactActionWrite);
  const changesPickupDocument = (write) => (
    !write.drops.some((drop) => drop.rustEntityId === expectedRustEntityId)
      || exactPlainDirtStack(write.inventory?.[expectedDestinationSlot], 1)
  );
  const premature = relevantWrites.filter((write) => (
    changesPickupDocument(write) && (write.savePickupCursor?.cursor ?? -1) <= beforeCursor
  ));
  assertCondition(premature.length === 0,
    "Pickup changed browser drop/inventory custody before the native receipt cursor advanced.");
  const orderedWrites = relevantWrites.filter((write) => {
    const pending = write.runtimePump;
    return write.savePickupCursor?.cursor === afterCursor
      && write.savePickupCursor.lastReceiptHash === projection.lastReceiptHash
      && write.runtimePickupProjection?.cursor === afterCursor
      && write.runtimePickupProjection.lastReceiptHash === projection.lastReceiptHash
      && !write.drops.some((drop) => drop.rustEntityId === expectedRustEntityId)
      && exactPlainDirtStack(write.inventory?.[expectedDestinationSlot], 1)
      && pending?.dropPickupCursor === beforeCursor
      && pending?.pendingDropPickupSequence === afterCursor
      && pending?.pendingDropPickupReceiptHash === projection.lastReceiptHash
      && pending?.pendingDropPickupIdentityHash === checkpointWitness.queryIdentityHash
      && JSON.stringify(write.dropPickupCheckpoint) === JSON.stringify(checkpointWitness)
      && write.nativePersistence?.worldId === checkpointWitness.persistenceAfter.worldId
      && write.nativePersistence?.saves === checkpointWitness.persistenceAfter.saves
      && write.nativePersistence?.platformOperations === checkpointWitness.persistenceAfter.platformOperations
      && write.nativePersistence?.lastCheckpointId === checkpointWitness.checkpoint.checkpointId;
  });
  assertCondition(orderedWrites.length >= 1,
    "Pickup has no observed local document write between native checkpoint and exact receipt acknowledgment.");
  return Object.freeze({
    cursorBefore: beforeCursor,
    cursorAfter: afterCursor,
    receiptHash: projection.lastReceiptHash,
    rustEntityId: expectedRustEntityId,
    sourceDrop: cloneJson(sources[0]),
    destinationSlot: expectedDestinationSlot,
    destinationStack: cloneJson(savedStackAt(after, expectedDestinationSlot)),
    checkpointWitness,
    nativePersistenceObservedBefore: cloneJson(nativeBefore),
    nativeCheckpointBefore: cloneJson(checkpointWitness.persistenceBefore),
    nativeCheckpointAnchor: cloneJson(checkpointWitness.persistenceBefore),
    nativeCheckpointAfter: cloneJson(checkpointWitness.persistenceAfter),
    nativePersistenceObservedAfter: cloneJson(nativeAfter),
    orderedWrites: Object.freeze(orderedWrites),
  });
}

/** Assert native Q/G drop checkpoint -> browser document -> exact ack custody. */
export function assertNativePlayerDropTransaction({
  before,
  after,
  auditWrites,
  firstAuditOrdinal = 0,
  expectedSlot = BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot,
}) {
  const cursorBefore = savedPlayerDropCursor(before)?.cursor;
  const cursorAfter = savedPlayerDropCursor(after)?.cursor;
  assertCondition(Number.isSafeInteger(cursorBefore) && cursorAfter === cursorBefore + 1,
    "Player drop did not advance its saved receipt cursor exactly once.");
  assertCondition(savedCursor(after)?.cursor === savedCursor(before)?.cursor
    && savedPickupCursor(after)?.cursor === savedPickupCursor(before)?.cursor,
  "Player drop changed an unrelated durable gameplay cursor.");
  assertCondition(JSON.stringify(canonicalSavedEdits(after.storage))
    === JSON.stringify(canonicalSavedEdits(before.storage)),
  "Player drop changed the compatibility terrain edit document.");
  assertCondition(exactPlainStack(savedStackAt(before, expectedSlot), { item: BERRY_ITEM_ID, count: 3 })
    && exactPlainStack(savedStackAt(after, expectedSlot), { item: BERRY_ITEM_ID, count: 2 })
    && after.storage.save.selected === expectedSlot,
  "Player drop did not debit exactly one selected starter Moonberry.");

  const beforeDrops = before.storage.save.drops ?? [];
  const afterDrops = after.storage.save.drops ?? [];
  const generated = afterDrops.filter((drop) => !beforeDrops
    .some((prior) => prior.rustEntityId === drop.rustEntityId));
  assertCondition(afterDrops.length === beforeDrops.length + 1
    && generated.length === 1
    && exactNativePlainDropFromSave(generated[0], BERRY_ITEM_ID),
  "Player drop did not add one exact native Moonberry presentation row.");
  const rustEntityId = generated[0].rustEntityId;
  const projection = projectedPlayerDropCursor(after);
  const pump = pumpDiagnostics(after);
  const nativeBefore = nativePersistenceDiagnostics(before);
  const nativeAfter = nativePersistenceDiagnostics(after);
  assertCondition(projection?.cursor === cursorAfter
    && projection.lastReceiptHash === savedPlayerDropCursor(after).lastReceiptHash
    && RECEIPT_HASH_PATTERN.test(projection.lastReceiptHash ?? ""),
  "Player-drop runtime projection cursor/hash disagrees with the saved document.");
  assertCondition(pump?.playerDropQueryConfigured === true
    && pump.playerDropCursor === cursorAfter
    && pump.playerDropLegacySeedPending === false
    && pump.pendingPlayerDropSequence === null
    && pump.pendingPlayerDropReceiptHash === null
    && pump.pendingPlayerDropIdentityHash === null
    && pump.lastAcknowledgedPlayerDropSequence === cursorAfter
    && pump.lastAcknowledgedPlayerDropReceiptHash === projection.lastReceiptHash,
  "Player drop did not finish with one exactly acknowledged native receipt.");
  assertCondition(typeof nativeAfter?.lastCheckpointId === "string" && nativeAfter.lastCheckpointId.length > 0,
    "Player drop native checkpoint id is absent.");
  const checkpointWitness = assertNativePlayerDropCheckpointWitness(after, {
    cursorBefore,
    cursorAfter,
    receiptHash: projection.lastReceiptHash,
  });
  assertCondition(nativeAfter?.worldId === checkpointWitness.persistenceAfter.worldId
    && nativeAfter.saves >= checkpointWitness.persistenceAfter.saves
    && nativeAfter.platformOperations >= checkpointWitness.persistenceAfter.platformOperations
    && nativeAfter.lastError === null,
  "Player drop final persistence diagnostics precede or contradict its causal checkpoint witness.");

  const relevantWrites = auditWrites
    .filter((write) => Number.isSafeInteger(write?.ordinal) && write.ordinal >= firstAuditOrdinal)
    .map(compactActionWrite);
  const premature = relevantWrites.filter((write) => (
    (exactPlainStack(write.inventory?.[expectedSlot], { item: BERRY_ITEM_ID, count: 2 })
      || write.drops.some((drop) => drop.rustEntityId === rustEntityId))
      && (write.savePlayerDropCursor?.cursor ?? -1) <= cursorBefore
  ));
  assertCondition(premature.length === 0,
    "Player drop changed browser inventory/drop custody before its native receipt cursor advanced.");
  const orderedWrites = relevantWrites.filter((write) => {
    const pending = write.runtimePump;
    return write.savePlayerDropCursor?.cursor === cursorAfter
      && write.savePlayerDropCursor.lastReceiptHash === projection.lastReceiptHash
      && write.runtimePlayerDropProjection?.cursor === cursorAfter
      && write.runtimePlayerDropProjection.lastReceiptHash === projection.lastReceiptHash
      && exactPlainStack(write.inventory?.[expectedSlot], { item: BERRY_ITEM_ID, count: 2 })
      && write.drops.some((drop) => drop.rustEntityId === rustEntityId
        && exactNativePlainDropFromSave(drop, BERRY_ITEM_ID))
      && pending?.playerDropCursor === cursorBefore
      && pending?.pendingPlayerDropSequence === cursorAfter
      && pending?.pendingPlayerDropReceiptHash === projection.lastReceiptHash
      && pending?.pendingPlayerDropIdentityHash === checkpointWitness.queryIdentityHash
      && JSON.stringify(write.playerDropCheckpoint) === JSON.stringify(checkpointWitness)
      && write.nativePersistence?.worldId === checkpointWitness.persistenceAfter.worldId
      && write.nativePersistence?.saves === checkpointWitness.persistenceAfter.saves
      && write.nativePersistence?.platformOperations === checkpointWitness.persistenceAfter.platformOperations
      && write.nativePersistence?.lastCheckpointId === checkpointWitness.checkpoint.checkpointId;
  });
  assertCondition(orderedWrites.length >= 1,
    "Player drop has no observed local document between native checkpoint and exact receipt ack.");
  return Object.freeze({
    cursorBefore,
    cursorAfter,
    receiptHash: projection.lastReceiptHash,
    rustEntityId,
    sourceSlot: expectedSlot,
    sourceBefore: cloneJson(savedStackAt(before, expectedSlot)),
    sourceAfter: cloneJson(savedStackAt(after, expectedSlot)),
    nativeDrop: cloneJson(generated[0]),
    checkpointWitness,
    nativePersistenceObservedBefore: cloneJson(nativeBefore),
    nativeCheckpointBefore: cloneJson(checkpointWitness.persistenceBefore),
    nativeCheckpointAnchor: cloneJson(checkpointWitness.persistenceBefore),
    nativeCheckpointAfter: cloneJson(checkpointWitness.persistenceAfter),
    nativePersistenceObservedAfter: cloneJson(nativeAfter),
    orderedWrites: Object.freeze(orderedWrites),
  });
}

/** Assert re-pickup of the exact player-origin Moonberry through BWR8 custody. */
export function assertNativePlayerDropPickupTransaction({
  before,
  after,
  auditWrites,
  firstAuditOrdinal = 0,
  expectedRustEntityId,
  expectedSlot = BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot,
}) {
  assertCondition(POSITIVE_NATIVE_ID_PATTERN.test(expectedRustEntityId ?? ""),
    "Player-drop pickup expected source is not one positive native entity id.");
  const cursorBefore = savedPickupCursor(before)?.cursor;
  const cursorAfter = savedPickupCursor(after)?.cursor;
  assertCondition(Number.isSafeInteger(cursorBefore) && cursorAfter === cursorBefore + 1,
    "Player-drop pickup did not advance the native pickup cursor exactly once.");
  assertCondition(savedPlayerDropCursor(after)?.cursor === savedPlayerDropCursor(before)?.cursor
    && savedPlayerDropCursor(after)?.lastReceiptHash === savedPlayerDropCursor(before)?.lastReceiptHash
    && savedCursor(after)?.cursor === savedCursor(before)?.cursor,
  "Player-drop pickup changed an unrelated durable gameplay cursor.");
  assertCondition(exactPlainStack(savedStackAt(before, expectedSlot), { item: BERRY_ITEM_ID, count: 2 })
    && exactPlainStack(savedStackAt(after, expectedSlot), { item: BERRY_ITEM_ID, count: 3 }),
  "Player-drop pickup did not restore the exact starter Moonberry stack.");
  const beforeDrops = before.storage.save.drops ?? [];
  const afterDrops = after.storage.save.drops ?? [];
  const sources = beforeDrops.filter((drop) => drop.rustEntityId === expectedRustEntityId);
  assertCondition(sources.length === 1 && exactNativePlainDropFromSave(sources[0], BERRY_ITEM_ID),
    "Player-drop pickup source is not one exact saved native Moonberry.");
  assertCondition(afterDrops.length === beforeDrops.length - 1
    && !afterDrops.some((drop) => drop.rustEntityId === expectedRustEntityId)
    && afterDrops.every((drop) => beforeDrops.some((prior) => prior.rustEntityId === drop.rustEntityId)),
  "Player-drop pickup did not remove only its exact native Moonberry source.");

  const projection = projectedPickupCursor(after);
  const pump = pumpDiagnostics(after);
  const nativeBefore = nativePersistenceDiagnostics(before);
  const nativeAfter = nativePersistenceDiagnostics(after);
  assertCondition(projection?.cursor === cursorAfter
    && projection.lastReceiptHash === savedPickupCursor(after).lastReceiptHash
    && RECEIPT_HASH_PATTERN.test(projection.lastReceiptHash ?? ""),
  "Player-drop pickup projection cursor/hash disagrees with the saved document.");
  assertCondition(pump?.dropPickupCursor === cursorAfter
    && pump.pendingDropPickupSequence === null
    && pump.pendingDropPickupReceiptHash === null
    && pump.pendingDropPickupIdentityHash === null
    && pump.lastAcknowledgedDropPickupSequence === cursorAfter
    && pump.lastAcknowledgedDropPickupReceiptHash === projection.lastReceiptHash,
  "Player-drop pickup did not finish with one exactly acknowledged BWR8 receipt.");
  const checkpointWitness = assertNativeDropPickupCheckpointWitness(after, {
    cursorBefore,
    cursorAfter,
    receiptHash: projection.lastReceiptHash,
    rustEntityId: expectedRustEntityId,
  });
  assertCondition(nativeAfter?.worldId === checkpointWitness.persistenceAfter.worldId
    && nativeAfter.saves >= checkpointWitness.persistenceAfter.saves
    && nativeAfter.platformOperations >= checkpointWitness.persistenceAfter.platformOperations
    && nativeAfter.lastError === null,
  "Player-drop pickup final persistence diagnostics precede or contradict its causal checkpoint witness.");
  const relevantWrites = auditWrites
    .filter((write) => Number.isSafeInteger(write?.ordinal) && write.ordinal >= firstAuditOrdinal)
    .map(compactActionWrite);
  const premature = relevantWrites.filter((write) => (
    (!write.drops.some((drop) => drop.rustEntityId === expectedRustEntityId)
      || exactPlainStack(write.inventory?.[expectedSlot], { item: BERRY_ITEM_ID, count: 3 }))
      && (write.savePickupCursor?.cursor ?? -1) <= cursorBefore
  ));
  assertCondition(premature.length === 0,
    "Player-drop pickup changed browser custody before its native pickup cursor advanced.");
  const orderedWrites = relevantWrites.filter((write) => {
    const pending = write.runtimePump;
    return write.savePickupCursor?.cursor === cursorAfter
      && write.savePickupCursor.lastReceiptHash === projection.lastReceiptHash
      && write.runtimePickupProjection?.cursor === cursorAfter
      && write.runtimePickupProjection.lastReceiptHash === projection.lastReceiptHash
      && !write.drops.some((drop) => drop.rustEntityId === expectedRustEntityId)
      && exactPlainStack(write.inventory?.[expectedSlot], { item: BERRY_ITEM_ID, count: 3 })
      && pending?.dropPickupCursor === cursorBefore
      && pending?.pendingDropPickupSequence === cursorAfter
      && pending?.pendingDropPickupReceiptHash === projection.lastReceiptHash
      && pending?.pendingDropPickupIdentityHash === checkpointWitness.queryIdentityHash
      && JSON.stringify(write.dropPickupCheckpoint) === JSON.stringify(checkpointWitness)
      && write.nativePersistence?.worldId === checkpointWitness.persistenceAfter.worldId
      && write.nativePersistence?.saves === checkpointWitness.persistenceAfter.saves
      && write.nativePersistence?.platformOperations === checkpointWitness.persistenceAfter.platformOperations
      && write.nativePersistence?.lastCheckpointId === checkpointWitness.checkpoint.checkpointId;
  });
  assertCondition(orderedWrites.length >= 1,
    "Player-drop pickup has no browser document between native checkpoint and exact receipt ack.");
  return Object.freeze({
    cursorBefore,
    cursorAfter,
    receiptHash: projection.lastReceiptHash,
    rustEntityId: expectedRustEntityId,
    restoredStack: cloneJson(savedStackAt(after, expectedSlot)),
    sourceDrop: cloneJson(sources[0]),
    checkpointWitness,
    nativePersistenceObservedBefore: cloneJson(nativeBefore),
    nativeCheckpointBefore: cloneJson(checkpointWitness.persistenceBefore),
    nativeCheckpointAnchor: cloneJson(checkpointWitness.persistenceBefore),
    nativeCheckpointAfter: cloneJson(checkpointWitness.persistenceAfter),
    nativePersistenceObservedAfter: cloneJson(nativeAfter),
    orderedWrites: Object.freeze(orderedWrites),
  });
}

function exactSavedRestorationShape(snapshot) {
  const save = snapshot?.storage?.save;
  return JSON.stringify({
    activeWorldId: snapshot?.storage?.activeWorldId ?? null,
    seed: save?.seed ?? null,
    mode: save?.mode ?? null,
    player: save?.player ?? null,
    inventory: save?.inventory ?? null,
    selected: save?.selected ?? null,
    edits: save?.edits ?? null,
    blockFacings: save?.blockFacings ?? null,
    drops: save?.drops ?? null,
    rustNativeBlockEditProjection: save?.rustNativeBlockEditProjection ?? null,
    rustNativeDropPickupProjection: save?.rustNativeDropPickupProjection ?? null,
    rustNativePlayerDropProjection: save?.rustNativePlayerDropProjection ?? null,
  });
}

function durableSavedRestorationShape(snapshot) {
  const save = snapshot?.storage?.save;
  return JSON.stringify({
    activeWorldId: snapshot?.storage?.activeWorldId ?? null,
    seed: save?.seed ?? null,
    mode: save?.mode ?? null,
    player: save?.player ?? null,
    inventory: save?.inventory ?? null,
    selected: save?.selected ?? null,
    edits: save?.edits ?? null,
    blockFacings: save?.blockFacings ?? null,
    drops: Array.isArray(save?.drops) ? save.drops.map((drop) => ({
      item: drop?.item ?? null,
      count: drop?.count ?? null,
      rustEntityId: drop?.rustEntityId ?? null,
    })) : save?.drops ?? null,
    rustNativeBlockEditProjection: save?.rustNativeBlockEditProjection ?? null,
    rustNativeDropPickupProjection: save?.rustNativeDropPickupProjection ?? null,
    rustNativePlayerDropProjection: save?.rustNativePlayerDropProjection ?? null,
  });
}

function splitRayDurableCustodyShape(value) {
  const save = value?.storage?.save ?? value?.save;
  const edits = save ? canonicalSavedEdits({ save }).entries : null;
  const facings = save?.blockFacings && typeof save.blockFacings === "object"
    ? Object.entries(save.blockFacings).sort(([left], [right]) => left.localeCompare(right))
    : save?.blockFacings ?? null;
  const drops = Array.isArray(save?.drops) ? save.drops.map((drop) => ({
    item: drop?.item ?? null,
    count: drop?.count ?? null,
    rustEntityId: drop?.rustEntityId ?? null,
  })).sort((left, right) => String(left.rustEntityId).localeCompare(String(right.rustEntityId)))
    : save?.drops ?? null;
  return JSON.stringify({
    seed: save?.seed ?? null,
    mode: save?.mode ?? null,
    inventory: save?.inventory ?? null,
    selected: save?.selected ?? null,
    edits,
    blockFacings: facings,
    drops,
    rustNativeBlockEditProjection: save?.rustNativeBlockEditProjection ?? null,
    rustNativeDropPickupProjection: save?.rustNativeDropPickupProjection ?? null,
    rustNativePlayerDropProjection: save?.rustNativePlayerDropProjection ?? null,
  });
}

function splitRayAuthorityCursorShape(snapshot) {
  const pump = pumpDiagnostics(snapshot);
  return JSON.stringify({
    blockEditProjection: projectedCursor(snapshot),
    dropPickupProjection: projectedPickupCursor(snapshot),
    playerDropProjection: projectedPlayerDropCursor(snapshot),
    nativeBlockEditCursor: pump?.nativeBlockEditCursor ?? null,
    pendingNativeBlockEditSequence: pump?.pendingNativeBlockEditSequence ?? null,
    pendingNativeBlockEditReceiptHash: pump?.pendingNativeBlockEditReceiptHash ?? null,
    dropPickupCursor: pump?.dropPickupCursor ?? null,
    pendingDropPickupSequence: pump?.pendingDropPickupSequence ?? null,
    pendingDropPickupReceiptHash: pump?.pendingDropPickupReceiptHash ?? null,
    playerDropCursor: pump?.playerDropCursor ?? null,
    pendingPlayerDropSequence: pump?.pendingPlayerDropSequence ?? null,
    pendingPlayerDropReceiptHash: pump?.pendingPlayerDropReceiptHash ?? null,
    nextActionSequence: pump?.nextActionSequence ?? null,
    lastActionReceipt: pump?.lastActionReceipt ?? null,
    selectedSlot: pump?.selectedSlot ?? null,
    authoritativeFlags: pump?.authoritativeFlags ?? null,
  });
}

export function assertGenericNativeBlockEditFreshRestoration({
  titleAfterSave,
  titleAfterReload,
  continued,
  coordinate,
  expectedCursor,
  expectedPickupCursor,
  expectedPlayerDropCursor = 0,
  expectedSelectedSlot,
  expectedSelectedStack,
  expectedRestoredBlockId = AIR_BLOCK_ID,
  expectedRestoredFacing = 0,
  expectedDrop,
  expectedDropId,
  forbiddenDropId = null,
  liveEmptyCellEvidence,
}) {
  const expected = exactSavedRestorationShape(titleAfterSave);
  assertCondition(exactSavedRestorationShape(titleAfterReload) === expected,
    "Full page reload changed the exact saved native block-edit document before Continue.");
  assertCondition(durableSavedRestorationShape(continued) === durableSavedRestorationShape(titleAfterSave),
    "Fresh Continue changed durable native block-edit custody during restoration.");
  const cursor = savedCursor(continued);
  const pump = pumpDiagnostics(continued);
  assertCondition(Number.isSafeInteger(expectedCursor) && expectedCursor > 0
    && cursor?.cursor === expectedCursor && RECEIPT_HASH_PATTERN.test(cursor.lastReceiptHash ?? ""),
  "Fresh restoration did not retain the exact native block-edit browser cursor/hash.");
  assertCondition(projectedCursor(continued)?.cursor === expectedCursor
    && projectedCursor(continued)?.lastReceiptHash === cursor.lastReceiptHash,
  "Fresh restoration browser projection disagrees with its durable cursor.");
  assertGenericNativeBlockEditPumpReady(pump, "Fresh restoration", { settled: true });
  assertCondition(pump.nativeBlockEditCursor === expectedCursor,
  "Fresh restoration did not query and seed the exact generic native block-edit receipt tail.");
  const pickupCursor = savedPickupCursor(continued);
  assertCondition(Number.isSafeInteger(expectedPickupCursor) && expectedPickupCursor >= 0
    && pickupCursor?.cursor === expectedPickupCursor
    && (expectedPickupCursor === 0
      ? pickupCursor.lastReceiptHash === null
      : RECEIPT_HASH_PATTERN.test(pickupCursor.lastReceiptHash ?? "")),
  "Fresh restoration did not retain the exact native pickup browser cursor/hash.");
  assertCondition(projectedPickupCursor(continued)?.cursor === expectedPickupCursor
    && projectedPickupCursor(continued)?.lastReceiptHash === pickupCursor.lastReceiptHash,
  "Fresh restoration pickup projection disagrees with its durable cursor.");
  assertCondition(pump?.dropPickupQueryConfigured === true
    && pump.dropPickupCursor === expectedPickupCursor
    && pump.dropPickupLegacySeedPending === false
    && pump.pendingDropPickupSequence === null,
  "Fresh restoration did not query and seed the exact native pickup receipt tail.");
  const playerDropCursor = savedPlayerDropCursor(continued);
  assertCondition(Number.isSafeInteger(expectedPlayerDropCursor) && expectedPlayerDropCursor >= 0
    && playerDropCursor?.cursor === expectedPlayerDropCursor
    && (expectedPlayerDropCursor === 0
      ? playerDropCursor.lastReceiptHash === null
      : RECEIPT_HASH_PATTERN.test(playerDropCursor.lastReceiptHash ?? ""))
    && projectedPlayerDropCursor(continued)?.cursor === expectedPlayerDropCursor
    && projectedPlayerDropCursor(continued)?.lastReceiptHash === playerDropCursor.lastReceiptHash,
  "Fresh restoration did not retain the exact native player-drop cursor/hash.");
  assertCondition(pump?.playerDropQueryConfigured === true
    && pump.playerDropCursor === expectedPlayerDropCursor
    && pump.playerDropLegacySeedPending === false
    && pump.pendingPlayerDropSequence === null,
  "Fresh restoration did not query and seed the exact native player-drop receipt tail.");
  assertCondition(continued?.runtime?.hydration === "restored",
    "Fresh Continue did not use restored native hydration.");
  const nativePersistence = nativePersistenceDiagnostics(continued);
  assertCondition((nativePersistence?.recoveries ?? 0) >= 1 && nativePersistence?.parentFallbacks === 0,
    "Fresh Continue lacks clean native persistence recovery evidence.");
  assertCondition(Number.isSafeInteger(expectedSelectedSlot)
    && expectedSelectedSlot >= 0 && expectedSelectedSlot <= 8
    && (expectedSelectedStack === null || (
      Number.isSafeInteger(expectedSelectedStack?.item)
        && Number.isSafeInteger(expectedSelectedStack?.count)
        && expectedSelectedStack.count > 0
    ))
    && continued.storage.save.selected === expectedSelectedSlot
    && exactPlainStack(selectedSavedStack(continued), expectedSelectedStack)
    && continued.state?.inventory?.selectedSlot === expectedSelectedSlot
    && exactPlainStack(continued.state?.inventory?.held ?? null, expectedSelectedStack),
  "Fresh Continue changed the exact selected inventory custody.");
  const address = terrainEditAddress(coordinate);
  const savedEdit = canonicalSavedEdits(continued.storage).entries
    .find((entry) => entry.chunkKey === address.chunkKey && entry.index === address.index);
  assertCondition(Number.isSafeInteger(expectedRestoredBlockId) && expectedRestoredBlockId >= 0
    && savedEdit?.type === expectedRestoredBlockId,
  "Fresh Continue did not restore the expected block at the native-edited coordinate.");
  assertCondition(Number.isSafeInteger(expectedRestoredFacing)
    && expectedRestoredFacing >= 0 && expectedRestoredFacing <= 3
    && savedBlockFacing(continued, coordinate) === expectedRestoredFacing,
  "Fresh Continue did not restore the expected cardinal facing at the native-edited coordinate.");
  const sameRayEmptyCellProof = liveEmptyCellEvidence?.mode !== "split-ray"
    && liveEmptyCellEvidence?.liveCellObservedEmpty === true
    && JSON.stringify(liveEmptyCellEvidence.emptyCoordinate) === JSON.stringify(coordinate)
    && Number.isSafeInteger(liveEmptyCellEvidence.emptyRayOrdinal)
    && Number.isSafeInteger(liveEmptyCellEvidence.supportTargetRayOrdinal)
    && liveEmptyCellEvidence.supportTargetRayOrdinal > liveEmptyCellEvidence.emptyRayOrdinal;
  const splitRayEmptyCellProof = liveEmptyCellEvidence?.mode === "split-ray"
    && liveEmptyCellEvidence.splitProofValid === true
    && liveEmptyCellEvidence.liveCellObservedEmpty === true
    && JSON.stringify(liveEmptyCellEvidence.emptyCoordinate) === JSON.stringify(coordinate)
    && Number.isSafeInteger(liveEmptyCellEvidence.emptyRayOrdinal)
    && liveEmptyCellEvidence.emptyRayOrdinal >= 1
    && liveEmptyCellEvidence.targetAbsent === true
    && Number.isSafeInteger(liveEmptyCellEvidence.supportTargetRayOrdinal)
    && liveEmptyCellEvidence.supportTargetRayOrdinal >= 1;
  assertCondition(sameRayEmptyCellProof || splitRayEmptyCellProof,
  "Fresh Continue has no public live-terrain ray proof through the restored empty cell.");
  assertCondition(Number.isSafeInteger(expectedDrop?.item) && expectedDrop.item >= 0
    && Number.isSafeInteger(expectedDrop?.count) && expectedDrop.count > 0
    && POSITIVE_NATIVE_ID_PATTERN.test(expectedDropId ?? ""),
  "Fresh restoration expected drop custody is invalid.");
  const nativeDrops = (continued.storage.save.drops ?? []).filter((drop) => drop.rustEntityId !== undefined);
  assertCondition(nativeDrops.length === 1
    && nativeDrops[0].rustEntityId === expectedDropId
    && exactNativePlainDropFromSave(nativeDrops[0], expectedDrop.item, expectedDrop.count),
  "Fresh Continue did not restore the exact expected native drop document.");
  assertCondition(forbiddenDropId === null || (POSITIVE_NATIVE_ID_PATTERN.test(forbiddenDropId ?? "")
    && nativeDrops[0].rustEntityId !== forbiddenDropId),
  "Fresh Continue restored a forbidden consumed pickup source.");
  const presented = continued?.state?.drops?.filter((drop) => drop.rustEntityId === nativeDrops[0].rustEntityId) ?? [];
  assertCondition(presented.length === 1
    && presented[0].item === expectedDrop.item && presented[0].count === expectedDrop.count,
  "Fresh Continue did not present exactly one matching expected native drop.");
  return Object.freeze({
    activeWorldId: continued.storage.activeWorldId,
    cursor: cloneJson(cursor),
    pickupCursor: cloneJson(pickupCursor),
    coordinate: Object.freeze([...coordinate]),
    liveEmptyCellEvidence: cloneJson(liveEmptyCellEvidence),
    nativeDrop: cloneJson(nativeDrops[0]),
    nativePersistence: cloneJson(nativePersistence),
  });
}

export function assertBasicDirtFreshRestoration({
  titleAfterSave,
  titleAfterReload,
  continued,
  coordinate,
  acquiredDropId,
  liveEmptyCellEvidence,
}) {
  const nativeDrops = (continued?.storage?.save?.drops ?? [])
    .filter((drop) => drop.rustEntityId !== undefined);
  return assertGenericNativeBlockEditFreshRestoration({
    titleAfterSave,
    titleAfterReload,
    continued,
    coordinate,
    expectedCursor: 3,
    expectedPickupCursor: 1,
    expectedPlayerDropCursor: 0,
    expectedSelectedSlot: BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot,
    expectedSelectedStack: null,
    expectedDrop: BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtStack,
    expectedDropId: nativeDrops[0]?.rustEntityId ?? null,
    forbiddenDropId: acquiredDropId,
    liveEmptyCellEvidence,
  });
}

export function assertBasicDirtBrowserErrorStreams(streams) {
  for (const key of [
    "consoleErrors", "pageErrors", "runtimeErrors", "routeErrors", "httpErrors",
    "requestFailures", "externalRequests", "webSockets",
  ]) {
    assertCondition(Array.isArray(streams?.[key]), `Browser error stream ${key} must be an array.`);
    assertCondition(streams[key].length === 0, `${key} contains ${streams[key].length} error(s).`);
  }
  return true;
}

export function isReadyR5AuthorityCheckpoint(snapshot) {
  const runtime = snapshot?.runtime;
  return snapshot?.state?.state === "playing"
    && runtime?.ready === true
    && runtime?.playerAuthority?.state === "ready"
    && runtime?.playerAuthority?.pump?.state === "ready";
}

export function assertBasicDirtCleanupEvidence(cleanup) {
  for (const key of [
    "browserClosed", "browserDisconnected", "serverClosed", "serverPortRefused",
    "environmentRestored", "profileRemoved", "profileRootRemoved", "viteRuntimeRemoved",
    "candidateUnchanged", "canonicalUnchanged", "sourceUnchanged", "cdpSessionDetached",
    "browserMutexReleased", "eventsDrained",
  ]) assertCondition(cleanup?.[key] === true, `Cleanup evidence ${key} is not true.`);
  assertCondition(Array.isArray(cleanup?.aliveChildPidsAfterCleanup)
    && cleanup.aliveChildPidsAfterCleanup.length === 0,
  "An owned browser process remains alive after cleanup.");
  return true;
}

async function installManagedCanonicalAssetRoutes(context, repositoryRoot, requests) {
  for (const requestUrl of MANAGED_CANONICAL_ASSET_URLS) {
    const asset = resolveManagedCanonicalAsset(repositoryRoot, requestUrl);
    await context.route(requestUrl, async (route) => {
      const selected = resolveManagedCanonicalAsset(repositoryRoot, route.request().url());
      if (!selected || selected.filePath !== asset.filePath) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: selected.contentType,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
        body: readFileSync(selected.filePath),
      });
      boundedPush(requests, {
        url: selected.requestUrl,
        path: selected.relativeAssetPath,
        status: 200,
      });
    });
  }
}

async function installNetworkGuard(context, managedOrigin, repositoryRoot, streams, canonicalAssetRequests) {
  await installManagedCanonicalAssetRoutes(context, repositoryRoot, canonicalAssetRequests);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === managedOrigin || MANAGED_CANONICAL_ASSET_URLS.includes(url.href)) {
      await route.fallback();
      return;
    }
    boundedPush(streams.externalRequests, {
      url: url.href,
      method: route.request().method(),
      resourceType: route.request().resourceType(),
    });
    await route.abort("blockedbyclient");
  });
}

function installBrowserAudit(context) {
  return context.addInitScript(() => {
    const audit = {
      schema: 1,
      generationCertificates: [],
      trustedTouchLookDown: [],
      trustedTouchLookMoves: [],
      trustedTouchPlaceDown: [],
      trustedTouchPlaceUp: [],
      trustedTouchMineDown: [],
      trustedTouchMineUp: [],
      trustedTouchMoveDown: [],
      trustedTouchMoveUp: [],
      trustedTouchHotbarDown: [],
      trustedTouchHotbarUp: [],
      trustedPlayerDropKeyDown: [],
      trustedPlayerDropKeyUp: [],
      worldDocumentWrites: [],
      worldDocumentWriteFailureInjection: null,
      lifecycleMarkers: [],
      nextWriteOrdinal: 0,
    };
    Object.defineProperty(window, "__blockwildBasicDirtActionAudit", {
      configurable: true,
      value: audit,
    });
    const bounded = (array, value) => {
      array.push(value);
      while (array.length > 256) array.shift();
    };
    const renderRuntime = () => {
      try {
        return typeof window.render_rust_runtime_to_text === "function"
          ? JSON.parse(window.render_rust_runtime_to_text())
          : null;
      } catch (error) {
        return { __parseError: error instanceof Error ? error.message : String(error) };
      }
    };
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      nativeSetItem.call(this, key, value);
      if (this !== localStorage || typeof key !== "string"
        || !key.startsWith("blockwild-world-data-v1:")) return;
      let documentValue = null;
      try { documentValue = JSON.parse(String(value)); } catch { documentValue = null; }
      const save = documentValue?.save;
      bounded(audit.worldDocumentWrites, {
        ordinal: audit.nextWriteOrdinal,
        at: performance.now(),
        key,
        save: save ? {
          seed: save.seed,
          mode: save.mode,
          player: save.player ? structuredClone(save.player) : null,
          inventory: Array.isArray(save.inventory) ? structuredClone(save.inventory) : null,
          selected: save.selected,
          edits: save.edits ? structuredClone(save.edits) : null,
          blockFacings: save.blockFacings ? structuredClone(save.blockFacings) : null,
          drops: Array.isArray(save.drops) ? structuredClone(save.drops) : null,
          rustNativeBlockEditProjection: save.rustNativeBlockEditProjection
            ? structuredClone(save.rustNativeBlockEditProjection)
            : null,
          rustNativeDropPickupProjection: save.rustNativeDropPickupProjection
            ? structuredClone(save.rustNativeDropPickupProjection)
            : null,
          rustNativePlayerDropProjection: save.rustNativePlayerDropProjection
            ? structuredClone(save.rustNativePlayerDropProjection)
            : null,
        } : null,
        runtime: renderRuntime(),
      });
      audit.nextWriteOrdinal += 1;
    };
    const placePointers = new Set();
    const minePointers = new Set();
    const movePointers = new Map();
    const hotbarPointers = new Map();
    document.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.classList.contains("touch-look-zone")) {
        bounded(audit.trustedTouchLookDown, {
          at: performance.now(), trusted: event.isTrusted, pointerId: event.pointerId,
        });
      }
      if (target instanceof HTMLElement && target.closest("button.place-action")) {
        placePointers.add(event.pointerId);
        bounded(audit.trustedTouchPlaceDown, {
          at: performance.now(), trusted: event.isTrusted, pointerId: event.pointerId,
        });
      }
      if (target instanceof HTMLElement && target.closest("button.mine-action")) {
        minePointers.add(event.pointerId);
        bounded(audit.trustedTouchMineDown, {
          at: performance.now(), trusted: event.isTrusted, pointerId: event.pointerId,
        });
      }
      const moveButton = target instanceof HTMLElement ? target.closest("button.touch-key") : null;
      if (moveButton instanceof HTMLButtonElement) {
        movePointers.set(event.pointerId, moveButton.getAttribute("aria-label"));
        bounded(audit.trustedTouchMoveDown, {
          at: performance.now(), trusted: event.isTrusted, pointerId: event.pointerId,
          label: moveButton.getAttribute("aria-label"),
        });
      }
      const hotbarButton = target instanceof HTMLElement ? target.closest("button.hotbar-slot") : null;
      if (hotbarButton instanceof HTMLButtonElement) {
        hotbarPointers.set(event.pointerId, hotbarButton.getAttribute("aria-label"));
        bounded(audit.trustedTouchHotbarDown, {
          at: performance.now(), trusted: event.isTrusted, pointerId: event.pointerId,
          label: hotbarButton.getAttribute("aria-label"),
        });
      }
    }, true);
    document.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch") return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains("touch-look-zone")) return;
      bounded(audit.trustedTouchLookMoves, {
        at: performance.now(),
        trusted: event.isTrusted,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }, true);
    const recordTouchRelease = (event) => {
      if (event.pointerType !== "touch") return;
      if (placePointers.delete(event.pointerId)) {
        bounded(audit.trustedTouchPlaceUp, {
          at: performance.now(), trusted: event.isTrusted, pointerId: event.pointerId,
        });
      }
      if (minePointers.delete(event.pointerId)) {
        bounded(audit.trustedTouchMineUp, {
          at: performance.now(), trusted: event.isTrusted, pointerId: event.pointerId,
        });
      }
      if (movePointers.has(event.pointerId)) {
        bounded(audit.trustedTouchMoveUp, {
          at: performance.now(), trusted: event.isTrusted, pointerId: event.pointerId,
          label: movePointers.get(event.pointerId),
        });
        movePointers.delete(event.pointerId);
      }
      if (hotbarPointers.has(event.pointerId)) {
        bounded(audit.trustedTouchHotbarUp, {
          at: performance.now(), trusted: event.isTrusted, pointerId: event.pointerId,
          label: hotbarPointers.get(event.pointerId),
        });
        hotbarPointers.delete(event.pointerId);
      }
    };
    document.addEventListener("pointerup", recordTouchRelease, true);
    document.addEventListener("pointercancel", recordTouchRelease, true);
    document.addEventListener("keydown", (event) => {
      if (event.code !== "KeyG" || event.repeat) return;
      bounded(audit.trustedPlayerDropKeyDown, {
        at: performance.now(), trusted: event.isTrusted, code: event.code,
      });
    }, true);
    document.addEventListener("keyup", (event) => {
      if (event.code !== "KeyG") return;
      bounded(audit.trustedPlayerDropKeyUp, {
        at: performance.now(), trusted: event.isTrusted, code: event.code,
      });
    }, true);
    const NativeWorker = window.Worker;
    const AuditedWorker = function (...args) {
      const worker = new NativeWorker(...args);
      worker.addEventListener("message", (event) => {
        const message = event.data;
        if (message?.type !== "terrain-generation-ready-v2" || !message.certificate) return;
        bounded(audit.generationCertificates, structuredClone(message.certificate));
      });
      return worker;
    };
    AuditedWorker.prototype = NativeWorker.prototype;
    Object.defineProperty(AuditedWorker, "name", { value: "Worker" });
    window.Worker = AuditedWorker;
  });
}

async function installOneShotWorldDocumentWriteFailure(page, activeWorldId, expectedCursorAfter) {
  assertCondition(typeof activeWorldId === "string" && activeWorldId.length > 0,
    "One-shot document failure requires one exact active world id.");
  assertCondition(Number.isSafeInteger(expectedCursorAfter) && expectedCursorAfter > 0,
    "One-shot document failure requires one positive successor cursor.");
  return page.evaluate(async ({ worldId, successorCursor }) => {
    const audit = window.__blockwildBasicDirtActionAudit;
    if (!audit || audit.worldDocumentWriteFailureInjection !== null) {
      throw new Error("The browser document failure injection is unavailable or already installed");
    }
    const exactKey = `blockwild-world-data-v1:${worldId}`;
    const catalogKey = "blockwild-world-catalog-v1";
    const initialDocumentRaw = localStorage.getItem(exactKey);
    const initialCatalogRaw = localStorage.getItem(catalogKey);
    if (initialDocumentRaw === null || initialCatalogRaw === null) {
      throw new Error("The exact active-world document or catalog is unavailable before failure injection");
    }
    const sha256 = async (value) => [...new Uint8Array(await crypto.subtle.digest(
      "SHA-256", new TextEncoder().encode(value),
    ))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const delegate = Storage.prototype.setItem;
    const message = "Injected one-shot active-world document failure";
    const state = {
      schema: 1,
      key: exactKey,
      message,
      expectedCursorAfter: successorCursor,
      initialDocumentBytes: new TextEncoder().encode(initialDocumentRaw).byteLength,
      initialCatalogBytes: new TextEncoder().encode(initialCatalogRaw).byteLength,
      initialDocumentSha256: await sha256(initialDocumentRaw),
      initialCatalogSha256: await sha256(initialCatalogRaw),
      restoredDocumentSha256: null,
      restoredCatalogSha256: null,
      armed: true,
      restored: false,
      worldDocumentAttempts: 0,
      matchingAttempts: 0,
      failures: 0,
      passThroughs: 0,
      nonTargetPassThroughs: 0,
      events: [],
    };
    const bounded = (value) => {
      state.events.push(value);
      while (state.events.length > 16) state.events.shift();
    };
    const renderRuntime = () => {
      try {
        return typeof window.render_rust_runtime_to_text === "function"
          ? JSON.parse(window.render_rust_runtime_to_text())
          : null;
      } catch (error) {
        return { __parseError: error instanceof Error ? error.message : String(error) };
      }
    };
    const attemptedSave = (value) => {
      try {
        const save = JSON.parse(String(value))?.save;
        return save ? structuredClone(save) : null;
      } catch {
        return null;
      }
    };
    const wrapper = function (key, value) {
      if (this !== localStorage || key !== exactKey) return delegate.call(this, key, value);
      state.worldDocumentAttempts += 1;
      const save = attemptedSave(value);
      const targeted = save?.rustNativeBlockEditProjection?.cursor === successorCursor;
      if (targeted) state.matchingAttempts += 1;
      const event = {
        worldAttempt: state.worldDocumentAttempts,
        targetAttempt: targeted ? state.matchingAttempts : null,
        at: performance.now(),
        key,
        save,
        documentMatchesInitial: String(value) === initialDocumentRaw,
        catalogMatchesInitial: localStorage.getItem(catalogKey) === initialCatalogRaw,
        runtime: renderRuntime(),
      };
      if (!targeted) {
        const result = delegate.call(this, key, value);
        state.nonTargetPassThroughs += 1;
        bounded({ ...event, outcome: "non-target-pass-through" });
        return result;
      }
      if (state.armed) {
        state.armed = false;
        state.failures += 1;
        bounded({ ...event, outcome: "injected-failure" });
        throw new DOMException(message, "QuotaExceededError");
      }
      const result = delegate.call(this, key, value);
      state.passThroughs += 1;
      bounded({ ...event, outcome: "pass-through" });
      return result;
    };
    audit.worldDocumentWriteFailureInjection = state;
    Storage.prototype.setItem = wrapper;
    Object.defineProperty(window, "__blockwildRestoreBasicDirtWriteFailure", {
      configurable: true,
      value: async () => {
        if (Storage.prototype.setItem !== wrapper) {
          throw new Error("The browser document failure wrapper was superseded before restoration");
        }
        Storage.prototype.setItem = delegate;
        state.restored = true;
        const restoredDocumentRaw = localStorage.getItem(exactKey);
        const restoredCatalogRaw = localStorage.getItem(catalogKey);
        state.restoredDocumentSha256 = restoredDocumentRaw === null
          ? null
          : await sha256(restoredDocumentRaw);
        state.restoredCatalogSha256 = restoredCatalogRaw === null
          ? null
          : await sha256(restoredCatalogRaw);
        return structuredClone(state);
      },
    });
    return structuredClone(state);
  }, { worldId: activeWorldId, successorCursor: expectedCursorAfter });
}

async function restoreOneShotWorldDocumentWriteFailure(page) {
  return page.evaluate(async () => {
    const restore = window.__blockwildRestoreBasicDirtWriteFailure;
    if (typeof restore !== "function") {
      throw new Error("The browser document failure restore callback is unavailable");
    }
    const evidence = await restore();
    delete window.__blockwildRestoreBasicDirtWriteFailure;
    return evidence;
  });
}

async function recordPendingSaveAndQuitMarker(page) {
  return page.evaluate(() => {
    const audit = window.__blockwildBasicDirtActionAudit;
    if (!audit || !Array.isArray(audit.lifecycleMarkers)) {
      throw new Error("The browser lifecycle marker audit is unavailable");
    }
    let runtime = null;
    try {
      runtime = typeof window.render_rust_runtime_to_text === "function"
        ? JSON.parse(window.render_rust_runtime_to_text())
        : null;
    } catch (error) {
      runtime = { __parseError: error instanceof Error ? error.message : String(error) };
    }
    const marker = {
      schema: 1,
      kind: "save-and-quit-click-boundary",
      at: performance.now(),
      runtime,
    };
    audit.lifecycleMarkers.push(marker);
    while (audit.lifecycleMarkers.length > 16) audit.lifecycleMarkers.shift();
    return structuredClone(marker);
  });
}

async function readBrowserSnapshot(page) {
  return page.evaluate(() => {
    const parseRenderer = (name) => {
      try {
        const renderer = window[name];
        return typeof renderer === "function" ? JSON.parse(renderer()) : null;
      } catch (error) {
        return { __parseError: error instanceof Error ? error.message : String(error) };
      }
    };
    let catalog = null;
    let documentValue = null;
    try { catalog = JSON.parse(localStorage.getItem("blockwild-world-catalog-v1") ?? "null"); }
    catch { catalog = null; }
    const activeWorldId = typeof catalog?.activeWorldId === "string" ? catalog.activeWorldId : null;
    if (activeWorldId) {
      try { documentValue = JSON.parse(localStorage.getItem(`blockwild-world-data-v1:${activeWorldId}`) ?? "null"); }
      catch { documentValue = null; }
    }
    const save = documentValue?.save;
    return {
      state: parseRenderer("render_game_to_text"),
      runtime: parseRenderer("render_rust_runtime_to_text"),
      audit: window.__blockwildBasicDirtActionAudit
        ? structuredClone(window.__blockwildBasicDirtActionAudit)
        : null,
      storage: {
        activeWorldId,
        catalogWorldCount: Array.isArray(catalog?.worlds) ? catalog.worlds.length : null,
        worldStorageKeys: Object.keys(localStorage).filter((key) => key.startsWith("blockwild-world-")).sort(),
        save: save ? {
          seed: save.seed,
          mode: save.mode,
          player: save.player ? structuredClone(save.player) : null,
          inventory: Array.isArray(save.inventory) ? structuredClone(save.inventory) : null,
          selected: save.selected,
          edits: save.edits ? structuredClone(save.edits) : {},
          blockFacings: save.blockFacings ? structuredClone(save.blockFacings) : {},
          drops: Array.isArray(save.drops) ? structuredClone(save.drops) : [],
          rustNativeBlockEditProjection: save.rustNativeBlockEditProjection
            ? structuredClone(save.rustNativeBlockEditProjection)
            : null,
          rustNativeDropPickupProjection: save.rustNativeDropPickupProjection
            ? structuredClone(save.rustNativeDropPickupProjection)
            : null,
          rustNativePlayerDropProjection: save.rustNativePlayerDropProjection
            ? structuredClone(save.rustNativePlayerDropProjection)
            : null,
        } : null,
      },
    };
  });
}

async function waitForHarness(page, timeoutMilliseconds) {
  await page.waitForFunction(() => (
    typeof window.render_game_to_text === "function"
    && typeof window.render_rust_runtime_to_text === "function"
    && typeof window.advanceTime === "function"
  ), undefined, { timeout: Math.min(timeoutMilliseconds, 120_000) });
}

function assertTerrainAndRuntimeBase(snapshot, expectedArtifactHash, label, expectedState = "playing") {
  assertCondition(snapshot?.state?.state === expectedState,
    `${label} game state is ${String(snapshot?.state?.state)}.`);
  const generation = snapshot?.state?.performance?.streaming?.generationWorker;
  assertCondition(generation?.mode === "rust"
    && generation.selectionSource === "build-rust-primary"
    && generation.authorityRequired === true
    && generation.state === "ready"
    && generation.supported === true
    && Number.isSafeInteger(generation.workers) && generation.workers > 0
    && generation.ready === generation.workers
    && generation.failed === 0 && generation.restarts === 0 && generation.rejected === 0,
  `${label} Rust-primary terrain authority is not healthy.`);
  const host = snapshot?.runtime?.manager?.host;
  assertCondition(snapshot?.runtime?.ready === true
    && snapshot.runtime.operationsBlocked === false
    && snapshot.runtime.manager?.state === "ready"
    && host?.state === "ready"
    && host?.adapter?.liveAuthorityReady === true
    && host?.artifactHash === expectedArtifactHash,
  `${label} exact Rust runtime host is not ready.`);
  assertCondition(snapshot.runtime.activeWorldId === snapshot.storage?.activeWorldId
    && snapshot.runtime.nativePersistenceWorldId === snapshot.storage?.activeWorldId,
  `${label} browser catalog and native persistence bindings differ.`);
  assertCondition(snapshot?.audit?.generationCertificates?.some((certificate) => (
    certificate?.corpusCases === 155
      && certificate.corpusHash === "5d4e6b1445b00f3430164d1a8093d8dc"
      && certificate.byteEqual === true
  )), `${label} exact 155-case generation certificate is absent.`);
  return snapshot;
}

function assertR5BasicDirtCheckpoint(snapshot, expectedArtifactHash, label, expectedState = "playing") {
  assertTerrainAndRuntimeBase(snapshot, expectedArtifactHash, label, expectedState);
  const playingShape = expectedState === "playing"
    ? snapshot
    : { ...snapshot, state: { ...snapshot.state, state: "playing" } };
  assertR5AuthorityDiagnostics({
    ...playingShape,
    generationCertificates: snapshot.audit.generationCertificates,
  }, expectedArtifactHash, label);
  const projection = projectedCursor(snapshot);
  const pickupProjection = projectedPickupCursor(snapshot);
  const playerDropProjection = projectedPlayerDropCursor(snapshot);
  const pump = pumpDiagnostics(snapshot);
  assertCondition(Array.isArray(snapshot?.runtime?.manager?.host?.adapter?.capabilities)
    && snapshot.runtime.manager.host.adapter.capabilities.includes("native-block-edit-receipt-v1"),
  `${label} exact generic native block-edit capability is absent.`);
  assertCondition(projection && Number.isSafeInteger(projection.cursor),
    `${label} generic native block-edit browser cursor is absent.`);
  assertGenericNativeBlockEditPumpReady(pump, label, { settled: true });
  assertCondition(pickupProjection && Number.isSafeInteger(pickupProjection.cursor),
    `${label} native pickup browser cursor is absent.`);
  assertCondition(pump?.dropPickupQueryConfigured === true
    && pump.dropPickupLegacySeedPending === false
    && Number.isSafeInteger(pump.dropPickupCursor),
  `${label} native pickup receipt query is not configured and seeded.`);
  assertCondition(playerDropProjection && Number.isSafeInteger(playerDropProjection.cursor),
    `${label} native player-drop browser cursor is absent.`);
  assertCondition(pump?.playerDropQueryConfigured === true
    && pump.playerDropLegacySeedPending === false
    && Number.isSafeInteger(pump.playerDropCursor),
  `${label} native player-drop receipt query is not configured and seeded.`);
  return snapshot;
}

async function dispatchTrustedTouchSwipe(cdp, box, deltaX, deltaY, identifier = 11) {
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = Math.max(box.x + 8, Math.min(box.x + box.width - 8, startX + deltaX));
  const endY = Math.max(box.y + 8, Math.min(box.y + box.height - 8, startY + deltaY));
  const point = (x, y) => ({ x, y, id: identifier, radiusX: 1, radiusY: 1, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [point(startX, startY)],
  });
  for (let step = 1; step <= 4; step += 1) {
    const fraction = step / 4;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(
        startX + (endX - startX) * fraction,
        startY + (endY - startY) * fraction,
      )],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function beginTrustedTouchHold(cdp, box, identifier) {
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    id: identifier,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
}

async function beginTrustedTouchAction(page, cdp, name, identifier) {
  const button = page.getByRole("button", { name });
  await button.waitFor({ state: "visible" });
  const box = await button.boundingBox();
  assertCondition(box && box.width >= 20 && box.height >= 20,
    `Public ${name} touch control has no usable visible bounds.`);
  return beginTrustedTouchHold(cdp, box, identifier);
}

async function tapPublicPauseControl(page) {
  const button = page.getByRole("button", { name: "Pause game" });
  await button.waitFor({ state: "visible" });
  const box = await button.boundingBox();
  assertCondition(box && box.width >= 20 && box.height >= 20,
    "Public Pause game touch control has no usable visible bounds.");
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

function normalizedAngleDelta(value) {
  let normalized = value;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

async function publicTouchLookBounds(page) {
  const touchLookZone = page.locator(".touch-look-zone");
  await touchLookZone.waitFor({ state: "visible", timeout: 15_000 });
  const box = await touchLookZone.boundingBox();
  assertCondition(box && box.width >= 100 && box.height >= 100,
    "Public touch look zone has no usable visible bounds.");
  return box;
}

async function adjustTrustedTouchLook(cdp, box, snapshot, aimPoint, identifier = 11) {
  const position = snapshot?.state?.player?.position;
  assertCondition(Array.isArray(position) && position.length === 3
    && position.every(Number.isFinite), "Public player position is unavailable for trusted aiming.");
  const eye = [position[0], position[1] + 1.62, position[2]];
  const delta = aimPoint.map((value, index) => value - eye[index]);
  const length = Math.hypot(...delta);
  assertCondition(length > 0.1, "Trusted aim point is too close to the public eye position.");
  const desiredYaw = Math.atan2(-delta[0], -delta[2]);
  const desiredPitch = Math.asin(delta[1] / length);
  const yaw = Number(snapshot?.state?.player?.yaw);
  const pitch = Number(snapshot?.state?.player?.pitch);
  assertCondition(Number.isFinite(yaw) && Number.isFinite(pitch),
    "Public player yaw/pitch is unavailable for trusted aiming.");
  const movementX = Math.max(-55, Math.min(55,
    Math.round(normalizedAngleDelta(yaw - desiredYaw) / 0.00275)));
  const movementY = Math.max(-55, Math.min(55, Math.round((pitch - desiredPitch) / 0.00275)));
  await dispatchTrustedTouchSwipe(
    cdp,
    box,
    movementX === 0 ? 1 : movementX,
    movementY === 0 ? 1 : movementY,
    identifier,
  );
  return Object.freeze({ desiredYaw, desiredPitch, movementX, movementY, eye, aimPoint: [...aimPoint] });
}

async function orientTowardHorizontalPoint(page, cdp, readAndRecord, x, z, label) {
  const box = await publicTouchLookBounds(page);
  let lastAdjustment = null;
  for (let attempt = 0; attempt < MAX_AIM_ATTEMPTS; attempt += 1) {
    const snapshot = await readAndRecord(`${label}-orient-${attempt}`);
    const position = snapshot?.state?.player?.position;
    assertCondition(Array.isArray(position) && position.length === 3,
      `${label} public position is unavailable.`);
    const desiredYaw = Math.atan2(-(x - position[0]), -(z - position[2]));
    const yawError = normalizedAngleDelta(Number(snapshot.state.player.yaw) - desiredYaw);
    if (Math.abs(yawError) <= 0.04 && attempt > 0) {
      return Object.freeze({ snapshot, attempts: attempt + 1, lastAdjustment });
    }
    lastAdjustment = await adjustTrustedTouchLook(
      cdp, box, snapshot, [x, position[1] + 1.62, z], 11,
    );
    await page.waitForTimeout(120);
  }
  fail(`${label} could not orient through trusted public touch look.`, {
    snapshot: await readAndRecord(`${label}-orient-failed`), lastAdjustment,
  });
}

async function aimAtExpectedNaturalBlock(
  page,
  cdp,
  readAndRecord,
  coordinate,
  expectedName,
  label = expectedName.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-"),
) {
  assertCondition(typeof expectedName === "string" && expectedName.length > 0,
    "Trusted natural-block aim requires one exact block name.");
  const box = await publicTouchLookBounds(page);
  let lastAdjustment = null;
  for (let attempt = 0; attempt < MAX_AIM_ATTEMPTS; attempt += 1) {
    const snapshot = await readAndRecord(`touch-aim-natural-${label}-${attempt}`);
    const selection = selectTerrainBreakTarget(snapshot);
    if (selection?.name === expectedName
      && JSON.stringify(selection.position) === JSON.stringify(coordinate)
      && selection.rayEntryDistance <= 4.5
      && attempt > 0) {
      return Object.freeze({
        selection,
        snapshot,
        attempts: attempt + 1,
        lastAdjustment,
        inputMode: "public-touch-controls",
      });
    }
    lastAdjustment = await adjustTrustedTouchLook(cdp, box, snapshot, coordinate, 11);
    await page.waitForTimeout(120);
  }
  const snapshot = await readAndRecord(`touch-aim-natural-${label}-failed`);
  fail(`Trusted public touch-look gestures did not select the exact deterministic natural ${expectedName} cell.`, {
    state: snapshot?.state,
    audit: snapshot?.audit,
    coordinate,
    lastAdjustment,
  });
}

async function aimAtExpectedNaturalDirt(page, cdp, readAndRecord, coordinate) {
  return aimAtExpectedNaturalBlock(page, cdp, readAndRecord, coordinate, "Dirt", "dirt");
}

export function expectedEmptyCellRayEvidence({ coordinate, rayCells, target, playerPosition }) {
  const cells = Array.isArray(rayCells) ? rayCells : [];
  const emptyOrdinal = cells.findIndex((cell) => (
    Array.isArray(cell) && cell.every((value, index) => value === coordinate?.[index])
  ));
  const targetOrdinal = target?.type === "block" && Array.isArray(target.position)
    ? cells.findIndex((cell) => cell.every((value, index) => value === target.position[index]))
    : -1;
  const horizontalTargetDistance = target?.type === "block" && Array.isArray(playerPosition)
    ? Math.hypot(target.position[0] - playerPosition[0], target.position[2] - playerPosition[2])
    : Infinity;
  const supportDelta = target?.type === "block" && Array.isArray(target.position)
    && Array.isArray(coordinate) && coordinate.length === 3
    ? target.position.map((value, index) => value - coordinate[index])
    : [];
  const supportImmediatelyAfterEmpty = targetOrdinal === emptyOrdinal + 1
    && supportDelta.length === 3
    && supportDelta.every(Number.isSafeInteger)
    && supportDelta.reduce((sum, value) => sum + Math.abs(value), 0) === 1;
  return Object.freeze({
    liveCellObservedEmpty: emptyOrdinal >= 1 && targetOrdinal > emptyOrdinal
      && supportImmediatelyAfterEmpty && horizontalTargetDistance <= 4.5,
    emptyCoordinate: Object.freeze(Array.isArray(coordinate) ? [...coordinate] : []),
    emptyRayOrdinal: emptyOrdinal,
    supportTarget: cloneJson(target ?? null),
    supportTargetRayOrdinal: targetOrdinal,
    supportDelta: Object.freeze(supportDelta),
    supportImmediatelyAfterEmpty,
    horizontalTargetDistance,
  });
}

export function expectedUntargetedEmptyCellRayEvidence({
  coordinate,
  rayCells,
  target,
  rayOrigin,
}) {
  const cells = Array.isArray(rayCells) ? rayCells : [];
  const emptyOrdinal = cells.findIndex((cell) => (
    Array.isArray(cell) && cell.every((value, index) => value === coordinate?.[index])
  ));
  const exactCoordinate = Array.isArray(coordinate) && coordinate.length === 3
    && coordinate.every(Number.isSafeInteger);
  const exactOrigin = Array.isArray(rayOrigin) && rayOrigin.length === 3
    && rayOrigin.every(Number.isFinite);
  const coordinateDistance = exactCoordinate && exactOrigin
    ? Math.hypot(...coordinate.map((value, index) => value - rayOrigin[index]))
    : Infinity;
  const targetAbsent = target === null;
  return Object.freeze({
    mode: "untargeted-empty-ray",
    liveCellObservedEmpty: exactCoordinate && targetAbsent
      && emptyOrdinal >= 1 && coordinateDistance <= 4.5,
    emptyCoordinate: Object.freeze(exactCoordinate ? [...coordinate] : []),
    emptyRayOrdinal: emptyOrdinal,
    emptyTarget: cloneJson(target ?? null),
    targetAbsent,
    coordinateDistance,
  });
}

export function composeSplitEmptyCellSupportEvidence({
  coordinate,
  supportCoordinate,
  supportName,
  emptyAim,
  supportAim,
  durableCustodyUnchanged,
  authorityCursorsUnchanged,
  interveningWritesPreservedCustody,
}) {
  const supportSelection = supportAim?.selection;
  const supportDelta = Array.isArray(coordinate) && coordinate.length === 3
    && Array.isArray(supportCoordinate) && supportCoordinate.length === 3
    ? supportCoordinate.map((value, index) => value - coordinate[index])
    : [];
  const adjacentSupport = supportDelta.length === 3
    && supportDelta.every(Number.isSafeInteger)
    && supportDelta.reduce((sum, value) => sum + Math.abs(value), 0) === 1;
  const exactSupport = typeof supportName === "string" && supportName.length > 0
    && supportSelection?.name === supportName
    && Array.isArray(supportSelection.position)
    && supportSelection.position.length === 3
    && supportSelection.position.every((value, index) => value === supportCoordinate?.[index])
    && Number.isSafeInteger(supportSelection.rayOrdinal)
    && supportSelection.rayOrdinal >= 1
    && Number.isFinite(supportSelection.rayEntryDistance)
    && supportSelection.rayEntryDistance <= 4.5;
  const splitProofValid = emptyAim?.mode === "untargeted-empty-ray"
    && emptyAim.liveCellObservedEmpty === true
    && emptyAim.targetAbsent === true
    && JSON.stringify(emptyAim.emptyCoordinate) === JSON.stringify(coordinate)
    && Number.isSafeInteger(emptyAim.emptyRayOrdinal)
    && emptyAim.emptyRayOrdinal >= 1
    && Number.isFinite(emptyAim.coordinateDistance)
    && emptyAim.coordinateDistance <= 4.5
    && adjacentSupport
    && exactSupport
    && durableCustodyUnchanged === true
    && authorityCursorsUnchanged === true
    && interveningWritesPreservedCustody === true;
  return Object.freeze({
    mode: "split-ray",
    splitProofValid,
    liveCellObservedEmpty: splitProofValid,
    emptyCoordinate: Object.freeze(Array.isArray(coordinate) ? [...coordinate] : []),
    emptyRayOrdinal: emptyAim?.emptyRayOrdinal ?? -1,
    emptyTarget: cloneJson(emptyAim?.emptyTarget ?? null),
    targetAbsent: emptyAim?.targetAbsent === true,
    coordinateDistance: emptyAim?.coordinateDistance ?? Infinity,
    supportTarget: exactSupport ? Object.freeze({
      type: "block",
      name: supportSelection.name,
      position: Object.freeze([...supportSelection.position]),
    }) : cloneJson(supportSelection ?? null),
    supportTargetRayOrdinal: supportSelection?.rayOrdinal ?? -1,
    supportRayEntryDistance: supportSelection?.rayEntryDistance ?? Infinity,
    supportDelta: Object.freeze(supportDelta),
    supportImmediatelyAfterEmpty: false,
    adjacentSupport,
    exactSupport,
    durableCustodyUnchanged: durableCustodyUnchanged === true,
    authorityCursorsUnchanged: authorityCursorsUnchanged === true,
    interveningWritesPreservedCustody: interveningWritesPreservedCustody === true,
    emptyObservation: cloneJson(emptyAim),
    supportObservation: cloneJson(supportAim),
    inputMode: "public-touch-controls",
  });
}

async function aimAtExpectedUntargetedEmptyCell(
  page,
  cdp,
  readAndRecord,
  coordinate,
  label,
) {
  const box = await publicTouchLookBounds(page);
  let lastAdjustment = null;
  for (let attempt = 0; attempt < MAX_AIM_ATTEMPTS; attempt += 1) {
    const snapshot = await readAndRecord(`touch-aim-untargeted-empty-${label}-${attempt}`);
    const ray = terrainRayCells(snapshot?.state, 6);
    const traversal = expectedUntargetedEmptyCellRayEvidence({
      coordinate,
      rayCells: ray.cells,
      target: snapshot?.state?.target,
      rayOrigin: ray.origin,
    });
    if (traversal.liveCellObservedEmpty && attempt > 0) {
      return Object.freeze({
        ...traversal,
        snapshot,
        attempts: attempt + 1,
        lastAdjustment,
        inputMode: "public-touch-controls",
      });
    }
    lastAdjustment = await adjustTrustedTouchLook(cdp, box, snapshot, coordinate, 11);
    await page.waitForTimeout(120);
  }
  fail(`Trusted public touch-look gestures did not traverse the exact untargeted empty ${label} cell.`, {
    snapshot: await readAndRecord(`touch-aim-untargeted-empty-${label}-failed`),
    coordinate,
    lastAdjustment,
  });
}

async function aimThroughExpectedEmptyCell(
  page,
  cdp,
  readAndRecord,
  coordinate,
  label = "Dirt",
  { supportCoordinate = null, aimPoint = coordinate } = {},
) {
  const box = await publicTouchLookBounds(page);
  let lastAdjustment = null;
  for (let attempt = 0; attempt < MAX_AIM_ATTEMPTS; attempt += 1) {
    const snapshot = await readAndRecord(`touch-aim-empty-${label.toLowerCase()}-${attempt}`);
    const target = snapshot?.state?.target;
    const ray = terrainRayCells(snapshot?.state, 6);
    const traversal = expectedEmptyCellRayEvidence({
      coordinate,
      rayCells: ray.cells,
      target,
      playerPosition: ray.pose.position,
    });
    const exactSupport = supportCoordinate === null
      || (target?.type === "block" && Array.isArray(target.position)
        && target.position.every((value, index) => value === supportCoordinate[index]));
    if (traversal.liveCellObservedEmpty && exactSupport && attempt > 0) {
      return Object.freeze({
        ...traversal,
        exactSupport,
        expectedSupportCoordinate: supportCoordinate === null
          ? null
          : Object.freeze([...supportCoordinate]),
        snapshot,
        attempts: attempt + 1,
        lastAdjustment,
        inputMode: "public-touch-controls",
      });
    }
    lastAdjustment = await adjustTrustedTouchLook(cdp, box, snapshot, aimPoint, 11);
    await page.waitForTimeout(120);
  }
  fail(`Trusted public touch-look gestures did not traverse the exact empty ${label} cell before one support block.`, {
    snapshot: await readAndRecord(`touch-aim-empty-${label.toLowerCase()}-failed`), coordinate, lastAdjustment,
  });
}

async function beginTrustedTouchMovement(page, cdp, name, identifier) {
  return beginTrustedTouchAction(page, cdp, name, identifier);
}

async function tapPublicHotbarSlot(page, slot) {
  const button = page.getByRole("button", { name: new RegExp(`^Slot ${slot + 1}:`, "u") });
  await button.waitFor({ state: "visible" });
  const box = await button.boundingBox();
  assertCondition(box && box.width >= 20 && box.height >= 20,
    `Public hotbar slot ${slot + 1} has no usable visible bounds.`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function selectVisibleCreativeCatalogItem(page, expectedName, expectedItem) {
  assertCondition(expectedName === GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.expectedTargetName
    && expectedItem === WILDWOOD_SHELF_ITEM_ID,
  "Creative catalog selector was asked to choose an out-of-scope shaped prop.");
  await page.keyboard.press("KeyE");
  await page.getByRole("heading", { name: "Inventory" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "ALL ITEMS" }).click();
  const search = page.getByRole("searchbox", { name: "SEARCH EVERY ITEM" });
  await search.fill(expectedName);
  const entries = page.locator("button.creative-entry");
  const exactTitle = `Place ${expectedName} in the selected hotbar slot`;
  const deadline = Date.now() + 15_000;
  let visibleEntries = 0;
  let name = "";
  let title = null;
  while (Date.now() < deadline) {
    visibleEntries = await entries.count();
    if (visibleEntries === 1) {
      const candidate = entries.first();
      name = (await candidate.locator(":scope > span:not([data-item-icon])").textContent())?.trim() ?? "";
      title = await candidate.getAttribute("title");
      if (name === expectedName && title === exactTitle && await candidate.isVisible()) break;
    }
    await page.waitForTimeout(25);
  }
  assertCondition(visibleEntries === 1,
    `Creative catalog search exposed ${visibleEntries} entries instead of one exact ${expectedName}.`);
  const entry = entries.first();
  assertCondition(name === expectedName
    && title === exactTitle
    && await entry.isVisible(),
  "Visible Creative catalog entry does not bind the exact Wildwood Shelf item.");
  await entry.click();
  return Object.freeze({
    schema: 1,
    query: expectedName,
    visibleEntries,
    item: expectedItem,
    name,
    title,
    clicked: true,
  });
}

export function assertCompleteTitleMenuRasterEvidence(
  evidence,
  expectedLabels = TERRAIN_EDIT_TITLE_MENU_LABELS,
  minimumBrightPixels = TITLE_LABEL_MINIMUM_BRIGHT_PIXELS,
) {
  assertCondition(evidence?.schema === 1, "Title screenshot raster evidence has an unsupported schema.");
  assertCondition(Number.isInteger(evidence.imageWidth) && evidence.imageWidth > 0
    && Number.isInteger(evidence.imageHeight) && evidence.imageHeight > 0,
  "Title screenshot raster evidence has invalid image dimensions.");
  assertCondition(Array.isArray(evidence.labels) && evidence.labels.length === expectedLabels.length,
    "Title screenshot raster evidence has the wrong label count.");
  assertCondition(Number.isSafeInteger(minimumBrightPixels) && minimumBrightPixels > 0,
    "Title screenshot raster minimum must be a positive safe integer.");
  evidence.labels.forEach((labelEvidence, index) => {
    assertCondition(labelEvidence?.label === expectedLabels[index],
      `Title screenshot raster label ${index + 1} does not match ${expectedLabels[index]}.`);
    assertCondition(Number.isInteger(labelEvidence.totalPixels) && labelEvidence.totalPixels > 0,
      `Title screenshot raster label ${expectedLabels[index]} has no sampled pixels.`);
    assertCondition(Number.isInteger(labelEvidence.brightPixels)
      && labelEvidence.brightPixels >= minimumBrightPixels,
    `Title screenshot raster label ${expectedLabels[index]} is not visibly painted.`);
  });
  return evidence;
}

async function readTitleMenuLabelLayout(page) {
  return page.evaluate((expectedLabels) => {
    const menu = document.querySelector(".title-main-menu[aria-label='Main menu']");
    if (!(menu instanceof Element)) return null;
    const labels = [...menu.querySelectorAll(":scope > button.title-menu-choice > strong")];
    if (labels.length !== expectedLabels.length) return null;
    const layout = labels.map((label, index) => {
      if ((label.textContent?.trim() ?? "") !== expectedLabels[index]) return null;
      const bounds = label.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      return {
        label: expectedLabels[index],
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    });
    if (layout.some((entry) => entry === null)) return null;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      labels: layout,
    };
  }, TERRAIN_EDIT_TITLE_MENU_LABELS);
}

async function inspectTitleMenuScreenshotRaster(page, screenshotBuffer, layout) {
  const dataUrl = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;
  return page.evaluate(async ({ encodedScreenshot, labelLayout }) => {
    const image = new Image();
    image.src = encodedScreenshot;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Title screenshot raster canvas could not be created.");
    context.drawImage(image, 0, 0);
    const scaleX = image.naturalWidth / labelLayout.viewportWidth;
    const scaleY = image.naturalHeight / labelLayout.viewportHeight;
    const labels = labelLayout.labels.map((label) => {
      const x = Math.max(0, Math.floor(label.x * scaleX));
      const y = Math.max(0, Math.floor(label.y * scaleY));
      const right = Math.min(image.naturalWidth, Math.ceil((label.x + label.width) * scaleX));
      const bottom = Math.min(image.naturalHeight, Math.ceil((label.y + label.height) * scaleY));
      const width = Math.max(1, right - x);
      const height = Math.max(1, bottom - y);
      const pixels = context.getImageData(x, y, width, height).data;
      let brightPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] >= 224
          && pixels[offset] >= 205
          && pixels[offset + 1] >= 205
          && pixels[offset + 2] >= 205) brightPixels += 1;
      }
      return {
        label: label.label,
        brightPixels,
        totalPixels: width * height,
        bounds: { x, y, width, height },
      };
    });
    return {
      schema: 1,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      labels,
    };
  }, { encodedScreenshot: dataUrl, labelLayout: layout });
}

async function captureScreenshot(
  page,
  repositoryRoot,
  outputDirectory,
  screenshots,
  name,
  rasterChecks = null,
) {
  const filePath = path.join(outputDirectory, `${name}.png`);
  const isTitleScreenshot = /^\d+-title-/u.test(name);
  let acceptedRasterEvidence = null;
  let lastRasterEvidence = null;
  const maximumAttempts = isTitleScreenshot ? TITLE_SCREENSHOT_MAX_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const layout = isTitleScreenshot ? await readTitleMenuLabelLayout(page) : null;
    if (isTitleScreenshot && layout === null) {
      lastRasterEvidence = { schema: 1, attempt, error: "complete title label layout unavailable" };
      await page.waitForTimeout(250);
      continue;
    }
    const screenshotBuffer = await page.screenshot({ path: filePath, type: "png" });
    if (!isTitleScreenshot) break;
    const evidence = {
      ...await inspectTitleMenuScreenshotRaster(page, screenshotBuffer, layout),
      attempt,
      minimumBrightPixels: TITLE_LABEL_MINIMUM_BRIGHT_PIXELS,
    };
    lastRasterEvidence = evidence;
    try {
      acceptedRasterEvidence = assertCompleteTitleMenuRasterEvidence(evidence);
      break;
    } catch {
      await page.waitForTimeout(250);
    }
  }
  if (isTitleScreenshot && acceptedRasterEvidence === null) {
    fail(`Title screenshot ${name} never painted every expected menu label.`, {
      attempts: TITLE_SCREENSHOT_MAX_ATTEMPTS,
      lastRasterEvidence,
    });
  }
  if (rasterChecks && acceptedRasterEvidence) rasterChecks[name] = acceptedRasterEvidence;
  screenshots[name] = relativeEvidencePath(repositoryRoot, filePath);
  return screenshots[name];
}

async function waitForCompleteTitleMenu(page, timeoutMilliseconds) {
  const waitForSettledLabels = () => page.waitForFunction((expectedLabels) => {
    if (document.visibilityState !== "visible" || document.fonts.status !== "loaded") return false;
    const menu = document.querySelector(".title-main-menu[aria-label='Main menu']");
    if (!(menu instanceof Element)) return false;
    const buttons = [...menu.querySelectorAll(":scope > button.title-menu-choice")];
    if (buttons.length !== expectedLabels.length) return false;
    return buttons.every((button, index) => {
      const label = button.querySelector(":scope > strong")?.textContent?.trim() ?? "";
      const style = getComputedStyle(button);
      return button instanceof HTMLButtonElement
        && button.disabled === false
        && label === expectedLabels[index]
        && style.display !== "none"
        && style.visibility === "visible"
        && Number(style.opacity) > 0
        && button.getAnimations({ subtree: true })
          .every((animation) => animation.playState !== "running" && animation.playState !== "pending");
    });
  }, TERRAIN_EDIT_TITLE_MENU_LABELS, { timeout: timeoutMilliseconds });
  await waitForSettledLabels();
  // A full reload can replace the initially complete menu after the async
  // world catalog hydrates. Require a second complete paint after a bounded
  // stability interval so evidence never captures the transient blank labels.
  await page.waitForTimeout(1_500);
  await waitForSettledLabels();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

export function assertTrustedBasicDirtActionInputs(audit) {
  const trustedPairs = (down, up, predicate = () => true) => (down ?? []).filter((entry) => (
    entry.trusted === true && predicate(entry)
      && up?.some((release) => release.trusted === true
        && release.pointerId === entry.pointerId
        && predicate(release))
  ));
  assertCondition(audit?.trustedTouchLookDown?.some((down) => (
    down.trusted === true
      && audit.trustedTouchLookMoves?.some((move) => (
        move.trusted === true && move.pointerId === down.pointerId
      ))
  )), "No complete trusted public touch-look gesture was observed.");
  assertCondition(trustedPairs(audit?.trustedTouchPlaceDown, audit?.trustedTouchPlaceUp).length >= 1,
    "No complete trusted public touch-place hold was observed.");
  const minePairs = trustedPairs(audit?.trustedTouchMineDown, audit?.trustedTouchMineUp);
  assertCondition(new Set(minePairs.map((entry) => entry.pointerId)).size >= 2,
    "Two distinct complete trusted public touch-mine holds were not observed.");
  const movementPairs = trustedPairs(
    audit?.trustedTouchMoveDown,
    audit?.trustedTouchMoveUp,
    (entry) => typeof entry.label === "string" && entry.label.startsWith("Move "),
  );
  assertCondition(movementPairs.length >= 2,
    "No complete trusted public touch movement into and away from pickup custody was observed.");
  const hotbarPairs = trustedPairs(
    audit?.trustedTouchHotbarDown,
    audit?.trustedTouchHotbarUp,
    (entry) => typeof entry.label === "string"
      && entry.label.startsWith(`Slot ${BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot + 1}:`),
  );
  assertCondition(hotbarPairs.length >= 1,
    "No complete trusted public touch selection of the acquired Dirt hotbar slot was observed.");
  return Object.freeze({
    mode: "public-touch-controls",
    touchLookDown: audit.trustedTouchLookDown.length,
    touchLookMoves: audit.trustedTouchLookMoves.length,
    touchPlaceDown: audit.trustedTouchPlaceDown.length,
    touchPlaceUp: audit.trustedTouchPlaceUp.length,
    touchMineDown: audit.trustedTouchMineDown.length,
    touchMineUp: audit.trustedTouchMineUp.length,
    touchMoveDown: audit.trustedTouchMoveDown.length,
    touchMoveUp: audit.trustedTouchMoveUp.length,
    touchHotbarDown: audit.trustedTouchHotbarDown.length,
    touchHotbarUp: audit.trustedTouchHotbarUp.length,
  });
}

export function assertTrustedGenericMineInput(audit) {
  const trustedMinePairs = (audit?.trustedTouchMineDown ?? []).filter((down) => (
    down.trusted === true
      && audit?.trustedTouchMineUp?.some((up) => (
        up.trusted === true && up.pointerId === down.pointerId
      ))
  ));
  const trustedMovementPairs = (audit?.trustedTouchMoveDown ?? []).filter((down) => (
    down.trusted === true
      && typeof down.label === "string" && down.label.startsWith("Move ")
      && audit?.trustedTouchMoveUp?.some((up) => (
        up.trusted === true && up.pointerId === down.pointerId
          && typeof up.label === "string" && up.label.startsWith("Move ")
      ))
  ));
  assertCondition(audit?.trustedTouchLookDown?.some((down) => (
    down.trusted === true
      && audit.trustedTouchLookMoves?.some((move) => (
        move.trusted === true && move.pointerId === down.pointerId
      ))
  )), "No complete trusted public touch-look gesture was observed.");
  assertCondition(trustedMinePairs.length === 1,
    "Exactly one complete trusted public touch-mine hold was not observed.");
  assertCondition(trustedMovementPairs.length >= 1,
    "No complete trusted public touch movement to the mining vantage was observed.");
  assertCondition((audit?.trustedTouchPlaceDown ?? []).length === 0
    && (audit?.trustedTouchPlaceUp ?? []).length === 0
    && (audit?.trustedTouchHotbarDown ?? []).length === 0
    && (audit?.trustedTouchHotbarUp ?? []).length === 0
    && (audit?.trustedPlayerDropKeyDown ?? []).length === 0
    && (audit?.trustedPlayerDropKeyUp ?? []).length === 0,
  "Generic mine evidence contains an out-of-scope placement, hotbar, or player-drop input.");
  return Object.freeze({
    mode: "public-touch-controls",
    touchLookDown: audit.trustedTouchLookDown.length,
    touchLookMoves: audit.trustedTouchLookMoves.length,
    touchMineDown: audit.trustedTouchMineDown.length,
    touchMineUp: audit.trustedTouchMineUp.length,
    touchMoveDown: audit.trustedTouchMoveDown.length,
    touchMoveUp: audit.trustedTouchMoveUp.length,
  });
}

export function assertTrustedGenericShapedPropInputs(audit, catalogSelection) {
  const trustedPairs = (down, up, predicate = () => true) => (down ?? []).filter((entry) => (
    entry.trusted === true && predicate(entry)
      && up?.some((release) => release.trusted === true
        && release.pointerId === entry.pointerId
        && predicate(release))
  ));
  const placePairs = trustedPairs(audit?.trustedTouchPlaceDown, audit?.trustedTouchPlaceUp);
  const minePairs = trustedPairs(audit?.trustedTouchMineDown, audit?.trustedTouchMineUp);
  const movementPairs = trustedPairs(
    audit?.trustedTouchMoveDown,
    audit?.trustedTouchMoveUp,
    (entry) => typeof entry.label === "string" && entry.label.startsWith("Move "),
  );
  const lookDown = (audit?.trustedTouchLookDown ?? []).filter((entry) => entry.trusted === true);
  const completeLookDown = lookDown.filter((down) => (
    audit?.trustedTouchLookMoves?.some((move) => (
      move.trusted === true && move.pointerId === down.pointerId
    ))
  ));
  assertCondition(new Set(completeLookDown.map((entry) => entry.pointerId)).size >= 2,
    "Shaped-prop evidence lacks two complete trusted public touch-look gestures.");
  assertCondition(placePairs.length === 1 && minePairs.length === 1,
    "Shaped-prop evidence does not contain exactly one complete public placement and one complete public mine.");
  assertCondition(movementPairs.length >= 1,
    "Shaped-prop evidence lacks complete trusted public movement to its placement vantage.");
  assertCondition((audit?.trustedTouchHotbarDown ?? []).length === 0
    && (audit?.trustedTouchHotbarUp ?? []).length === 0
    && (audit?.trustedPlayerDropKeyDown ?? []).length === 0
    && (audit?.trustedPlayerDropKeyUp ?? []).length === 0,
  "Shaped-prop evidence contains an out-of-scope hotbar or player-drop gesture.");
  assertCondition(catalogSelection?.schema === 1
    && catalogSelection.query === GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.expectedTargetName
    && catalogSelection.visibleEntries === 1
    && catalogSelection.item === WILDWOOD_SHELF_ITEM_ID
    && catalogSelection.name === GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.expectedTargetName
    && catalogSelection.title
      === `Place ${GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.expectedTargetName} in the selected hotbar slot`
    && catalogSelection.clicked === true,
  "Shaped-prop evidence does not bind one exact visible Creative catalog selection.");
  return Object.freeze({
    mode: "public-ui-and-touch-controls",
    catalogSelection: cloneJson(catalogSelection),
    touchLookDown: audit.trustedTouchLookDown.length,
    touchLookMoves: audit.trustedTouchLookMoves.length,
    completeTouchLookGestures: completeLookDown.length,
    touchPlaceDown: audit.trustedTouchPlaceDown.length,
    touchPlaceUp: audit.trustedTouchPlaceUp.length,
    touchMineDown: audit.trustedTouchMineDown.length,
    touchMineUp: audit.trustedTouchMineUp.length,
    touchMoveDown: audit.trustedTouchMoveDown.length,
    touchMoveUp: audit.trustedTouchMoveUp.length,
  });
}

function shapedPropModePreservedDocument(snapshot) {
  const save = snapshot?.storage?.save;
  return JSON.stringify({
    activeWorldId: snapshot?.storage?.activeWorldId ?? null,
    seed: save?.seed ?? null,
    player: save?.player ?? null,
    inventory: save?.inventory ?? null,
    selected: save?.selected ?? null,
    edits: save?.edits ?? null,
    blockFacings: save?.blockFacings ?? null,
    drops: save?.drops ?? null,
    rustNativeBlockEditProjection: save?.rustNativeBlockEditProjection ?? null,
    rustNativeDropPickupProjection: save?.rustNativeDropPickupProjection ?? null,
    rustNativePlayerDropProjection: save?.rustNativePlayerDropProjection ?? null,
  });
}

export function assertGenericShapedPropModeTransition({
  titleAfterCreativeSave,
  titleAfterModeChange,
  survivalLoaded,
  modeEditorEvidence,
  coordinate = GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.placementCoordinate,
}) {
  const fixture = GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE;
  const activeWorldId = titleAfterCreativeSave?.storage?.activeWorldId;
  assertCondition(typeof activeWorldId === "string" && activeWorldId.length > 0
    && titleAfterCreativeSave?.state?.state === "title"
    && titleAfterModeChange?.state?.state === "title"
    && titleAfterModeChange?.storage?.activeWorldId === activeWorldId
    && survivalLoaded?.storage?.activeWorldId === activeWorldId,
  "Shaped-prop mode transition did not retain one exact selected saved world.");
  assertCondition(titleAfterCreativeSave.storage?.save?.mode === fixture.mode
    && titleAfterModeChange.storage?.save?.mode === fixture.survivalMode
    && survivalLoaded.storage?.save?.mode === fixture.survivalMode
    && survivalLoaded.state?.player?.mode === fixture.survivalMode
    && survivalLoaded.state?.player?.flying === false,
  "Shaped-prop mode transition did not change Creative to Survival on the next load.");
  assertCondition(shapedPropModePreservedDocument(titleAfterCreativeSave)
    === shapedPropModePreservedDocument(titleAfterModeChange),
  "Worlds game-mode editor changed saved world state outside the exact mode field.");
  assertCondition(shapedPropModePreservedDocument(titleAfterModeChange)
    === shapedPropModePreservedDocument(survivalLoaded),
  "Survival load changed the persisted shaped-prop document before the mining action.");
  const address = terrainEditAddress(coordinate);
  for (const [label, snapshot] of [
    ["Creative Save & Quit", titleAfterCreativeSave],
    ["Worlds mode edit", titleAfterModeChange],
    ["Survival load", survivalLoaded],
  ]) {
    const savedEdit = canonicalSavedEdits(snapshot.storage).entries
      .find((entry) => entry.chunkKey === address.chunkKey && entry.index === address.index);
    assertCondition(savedEdit?.type === WILDWOOD_SHELF_BLOCK_ID
      && savedBlockFacing(snapshot, coordinate) === fixture.expectedFacing
      && savedCursor(snapshot)?.cursor === 1
      && savedPickupCursor(snapshot)?.cursor === 0
      && savedPlayerDropCursor(snapshot)?.cursor === 0
      && snapshot.storage.save.selected === fixture.initialSelectedSlot
      && exactPlainStack(selectedSavedStack(snapshot), fixture.selectedStack)
      && (snapshot.storage.save.drops ?? []).length === 0,
    `${label} lost exact shelf, facing, inventory, cursor, or zero-drop custody.`);
  }
  assertCondition(survivalLoaded.runtime?.hydration === "restored",
    "Survival load did not hydrate the shaped-prop world from native persistence.");
  const pump = assertGenericNativeBlockEditPumpReady(
    pumpDiagnostics(survivalLoaded),
    "Shaped-prop Survival load",
    {
      settled: true,
    },
  );
  const playerAuthority = survivalLoaded.runtime?.playerAuthority;
  const modeSet = playerAuthority?.lastGameModeSet;
  const checkpoint = modeSet?.checkpoint;
  const nativePersistence = nativePersistenceDiagnostics(survivalLoaded);
  const nativeInventory = nativeInventoryDiagnostics(survivalLoaded);
  const nonzeroHash = (value) => RECEIPT_HASH_PATTERN.test(value ?? "")
    && value !== "0".repeat(32);
  assertCondition(playerAuthority?.gameModeSetCalls === 1
    && modeSet?.schema === 1
    && nonzeroHash(modeSet.requestPayloadHash)
    && nonzeroHash(modeSet.receiptHash)
    && modeSet.priorMode === fixture.mode
    && modeSet.resultingMode === fixture.survivalMode
    && modeSet.priorFlags === 3
    && modeSet.resultingFlags === 0
    && Number.isSafeInteger(modeSet.identityBefore?.simulationRevision)
    && modeSet.identityAfter?.simulationRevision === modeSet.identityBefore.simulationRevision + 1
    && nonzeroHash(modeSet.identityBefore?.stateHash)
    && nonzeroHash(modeSet.identityAfter?.stateHash)
    && modeSet.identityAfter.stateHash !== modeSet.identityBefore.stateHash,
  "Survival load lacks one exact sealed native Creative/Flying to Survival game-mode CAS.");
  assertCondition(typeof checkpoint?.checkpointId === "string" && checkpoint.checkpointId.length > 0
    && nonzeroHash(checkpoint.checkpointHash)
    && Number.isSafeInteger(checkpoint.commits) && checkpoint.commits >= 1
    && Number.isSafeInteger(checkpoint.savesBefore)
    && checkpoint.savesAfter === checkpoint.savesBefore + 1
    && Number.isSafeInteger(checkpoint.platformOperationsBefore)
    && checkpoint.platformOperationsAfter
      === checkpoint.platformOperationsBefore + checkpoint.commits
    && Number.isSafeInteger(checkpoint.persistenceRevisionBefore)
    && checkpoint.persistenceRevisionAfter > checkpoint.persistenceRevisionBefore,
  "Native game-mode CAS lacks one exact durable persistence checkpoint witness.");
  assertCondition(nativePersistence?.state === "open"
    && nativePersistence.saves >= checkpoint.savesAfter
    && nativePersistence.platformOperations >= checkpoint.platformOperationsAfter
    && ((nativePersistence.saves === checkpoint.savesAfter
      && nativePersistence.platformOperations === checkpoint.platformOperationsAfter)
      ? nativePersistence.lastCheckpointId === checkpoint.checkpointId
      : true),
  "Live native persistence diagnostics precede or contradict the game-mode checkpoint witness.");
  assertCondition(Array.isArray(survivalLoaded.runtime?.manager?.host?.adapter?.capabilities)
    && survivalLoaded.runtime.manager.host.adapter.capabilities.includes("player-game-mode-set-v1"),
  "Survival load does not advertise the dedicated native player game-mode capability.");
  assertCondition(pump.nativeBlockEditCursor === 1
    && pump.authoritativeFlags === 0
    && projectedCursor(survivalLoaded)?.cursor === 1
    && nativeInventory?.selectedSlot === fixture.initialSelectedSlot
    && exactNativePlainStack(nativeInventory?.held, fixture.selectedStack),
  "Survival load did not retain exact native shelf cursor, flags, or selected inventory custody.");
  const postModeBoundary = titleAfterModeChange?.audit?.nextWriteOrdinal;
  const auditedWrites = survivalLoaded?.audit?.worldDocumentWrites;
  assertCondition(Number.isSafeInteger(postModeBoundary) && postModeBoundary >= 0
    && Array.isArray(auditedWrites)
    && auditedWrites
      .filter((write) => write?.ordinal >= postModeBoundary
        && write?.key === `blockwild-world-data-v1:${activeWorldId}`)
      .every((write) => write?.save?.mode === fixture.survivalMode),
  "A post-edit browser document write transiently reverted the saved world to Creative.");
  const expectedDialog = `Change “${fixture.name}” to Survival before its next load? World edits and inventory are preserved.`;
  assertCondition(modeEditorEvidence?.schema === 1
    && modeEditorEvidence.worldName === fixture.name
    && modeEditorEvidence.fromMode === fixture.mode
    && modeEditorEvidence.toMode === fixture.survivalMode
    && modeEditorEvidence.dialogType === "confirm"
    && modeEditorEvidence.dialogMessage === expectedDialog
    && modeEditorEvidence.accepted === true
    && modeEditorEvidence.notice
      === `${fixture.name} will load in Survival. Inventory and world progress were preserved.`,
  "Shaped-prop mode transition lacks the exact visible Worlds editor confirmation evidence.");
  return Object.freeze({
    activeWorldId,
    fromMode: fixture.mode,
    toMode: fixture.survivalMode,
    flying: survivalLoaded.state.player.flying,
    coordinate: Object.freeze([...coordinate]),
    facing: fixture.expectedFacing,
    cursor: cloneJson(savedCursor(survivalLoaded)),
    nativeGameModeSet: cloneJson(modeSet),
    modeEditorEvidence: cloneJson(modeEditorEvidence),
  });
}

export function assertTrustedNativePlayerDropInput(audit) {
  const downs = audit?.trustedPlayerDropKeyDown ?? [];
  const ups = audit?.trustedPlayerDropKeyUp ?? [];
  const complete = downs.filter((down) => down.trusted === true && down.code === "KeyG"
    && ups.some((up) => up.trusted === true && up.code === "KeyG" && up.at >= down.at));
  assertCondition(complete.length === 1,
    "Exactly one complete trusted public G player-drop key gesture was not observed.");
  return Object.freeze({
    mode: "public-keyboard-control",
    code: "KeyG",
    trustedKeyDown: downs.length,
    trustedKeyUp: ups.length,
  });
}

export async function runBasicDirtActionBrowser(argv = process.argv) {
  const options = parseBasicDirtBrowserOptions(argv);
  if (options.help) return Object.freeze({ help: true, usage: usage() });
  const worldFixture = isGenericShapedPropScenario(options.scenario)
    ? GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE
    : isGenericGrassScenario(options.scenario)
      ? GENERIC_GRASS_ACTION_WORLD_FIXTURE
      : BASIC_DIRT_ACTION_WORLD_FIXTURE;
  mkdirSync(options.outputDirectory, { recursive: true });
  resolveWorkOutputDirectory(options.repositoryRoot, options.outputDirectory);
  const selection = selectBasicDirtCandidate(
    options.repositoryRoot, options.engineDirectory, options.expectedArtifactHash,
  );
  const profileRoot = path.join(options.outputDirectory, PROFILE_ROOT_NAME);
  if (existsSync(profileRoot)) {
    const metadata = lstatSync(profileRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || readdirSync(profileRoot).length > 0) {
      fail(`Browser profile root must be absent or empty: ${profileRoot}.`);
    }
  } else mkdirSync(profileRoot);
  const profileDirectory = mkdtempSync(path.join(profileRoot, PROFILE_PREFIX));
  const viteRuntimeDirectory = mkdtempSync(path.join(options.outputDirectory, VITE_RUNTIME_PREFIX));
  const routeRequests = [];
  const canonicalAssetRequests = [];
  const streams = {
    consoleErrors: [],
    pageErrors: [],
    runtimeErrors: [],
    routeErrors: [],
    httpErrors: [],
    requestFailures: [],
    externalRequests: [],
    webSockets: [],
    expectedRequestCancellations: [],
    expectedManagedViteWebSockets: [],
  };
  const screenshots = Object.create(null);
  const screenshotRasterChecks = Object.create(null);
  const cleanup = {
    browserStarted: false,
    browserClosed: false,
    browserDisconnected: false,
    serverStarted: false,
    serverClosed: true,
    serverPortRefused: true,
    environmentRestored: true,
    profileRemoved: false,
    profileRootRemoved: false,
    viteRuntimeRemoved: false,
    candidateUnchanged: false,
    canonicalUnchanged: false,
    sourceUnchanged: false,
    cdpSessionStarted: false,
    cdpSessionDetached: true,
    browserMutexReleased: true,
    eventsDrained: false,
    trackedChildPids: [],
    aliveChildPidsAfterCleanup: [],
    processTracking: {
      vite: "in-process-no-child",
      browser: "playwright-owned-browser-handle",
    },
  };
  const collectionState = { active: true };
  let browserMutex = null;
  let browserMutexEvidence = null;
  let playwright = null;
  let browserExecutable = null;
  let managedServer = null;
  let managedServerAttempt = null;
  let context = null;
  let browser = null;
  let page = null;
  let cdp = null;
  let result = null;
  let lastSnapshot = null;
  let r5Baseline = null;
  let afterAcquisitionMine = null;
  let afterPickup = null;
  let afterPlace = null;
  let afterFinalMine = null;
  let titleAfterSave = null;
  let titleAfterReload = null;
  let continued = null;
  let acquisitionMineEvidence = null;
  let pickupEvidence = null;
  let placeEvidence = null;
  let finalMineEvidence = null;
  let restorationEvidence = null;
  let targetEvidence = null;
  let playerDropBaseline = null;
  let afterPlayerDrop = null;
  let playerDropEvidence = null;
  let playerDropTitleAfterSave = null;
  let playerDropTitleAfterReload = null;
  let playerDropContinued = null;
  let afterPlayerDropPickup = null;
  let playerDropPickupEvidence = null;
  let playerDropInputProof = null;
  let playerDropDurableHotTransformEvidence = null;
  const nativeDropHotTransformEvidence = [];
  let durableNativeDropHotTransformEvidence = null;
  let nativeBlockEditRecoveryPending = null;
  let nativeBlockEditRecoveryPaused = null;
  let nativeBlockEditRecoveryInjection = null;
  let nativeBlockEditRecoverySaveQuitMarker = null;
  let nativeBlockEditRecoveryEvidence = null;
  let nativeBlockEditFailureWrapperInstalled = false;
  let shapedPropCatalogSelection = null;
  let shapedPropCreativeFlightEvidence = null;
  let shapedPropPlacementAim = null;
  let shapedPropPlacementEvidence = null;
  let shapedPropTitleAfterCreativeSave = null;
  let shapedPropTitleAfterModeChange = null;
  let shapedPropSurvivalLoaded = null;
  let shapedPropModeEditorEvidence = null;
  let shapedPropModeTransitionEvidence = null;
  let shapedPropMineAim = null;
  let shapedPropInputProof = null;
  const terrainReadiness = { created: null, restored: null };
  const recordRuntimeErrors = (snapshot, label) => {
    for (const message of collectR5RuntimeErrors(snapshot?.state, snapshot?.runtime, {
      authorityCheckpoint: isReadyR5AuthorityCheckpoint(snapshot),
    })) {
      const rendered = `${label}: ${message}`;
      if (!streams.runtimeErrors.includes(rendered)) streams.runtimeErrors.push(rendered);
    }
    if (snapshot?.state?.__parseError) boundedPush(streams.runtimeErrors, `${label}: ${snapshot.state.__parseError}`);
    if (snapshot?.runtime?.__parseError) boundedPush(streams.runtimeErrors, `${label}: ${snapshot.runtime.__parseError}`);
  };
  try {
    try {
      browserMutex = await acquireManagedBrowserGateMutex(options.repositoryRoot);
      browserMutexEvidence = browserMutex.evidence;
      cleanup.browserMutexReleased = false;
    } catch (error) {
      browserMutexEvidence = error?.browserGateMutex ?? null;
      throw error;
    }
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
    context = await playwright.module.chromium.launchPersistentContext(profileDirectory, {
      headless: options.headless,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      viewport: { width: 1280, height: 720 },
      hasTouch: true,
      serviceWorkers: "block",
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--disable-breakpad",
        "--disable-crash-reporter",
        `--disk-cache-dir=${path.join(profileDirectory, "browser-cache")}`,
        `--crash-dumps-dir=${path.join(profileDirectory, "crash-dumps")}`,
      ],
    });
    cleanup.browserStarted = true;
    browser = context.browser();
    assertCondition(browser, "Playwright did not expose the owned Browser handle.");
    const browserPid = browserProcessPid(browser);
    if (browserPid !== null) cleanup.trackedChildPids.push(browserPid);
    await context.addInitScript(() => {
      localStorage.setItem("blockwild-settings-v2", JSON.stringify({
        renderDistance: 2,
        simulationDistance: 2,
        basicRenderDistance: 2,
        rememberedBasicRenderDistance: 2,
        resourceMode: "cpu",
      }));
      localStorage.setItem("blockwild-ui-preferences-v1", JSON.stringify({
        touchControls: "on",
        targetOutlineOpacity: 0.45,
        showReferenceHints: true,
      }));
      localStorage.setItem("blockwild-browser-player-id-v1", "basic_dirt_acceptance_browser");
      localStorage.setItem("blockwild-character-profiles-v1", JSON.stringify({
        version: 1,
        browserId: "basic_dirt_acceptance_browser",
        selectedProfileId: "basic_dirt_acceptance_profile",
        profiles: [{
          version: 1,
          id: "basic_dirt_acceptance_profile",
          browserId: "basic_dirt_acceptance_browser",
          name: "Dirt Custodian",
          appearance: { sex: "male", skinTone: 2, hair: 1, hairColor: 2, shirtColor: 4, pantsColor: 1 },
          createdAt: 1,
          updatedAt: 1,
        }],
      }));
    });
    await installBrowserAudit(context);
    await installNetworkGuard(
      context, managedServer.baseUrl, selection.repositoryRoot, streams, canonicalAssetRequests,
    );
    page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(Math.min(options.timeoutMilliseconds, 60_000));
    cdp = await context.newCDPSession(page);
    cleanup.cdpSessionStarted = true;
    cleanup.cdpSessionDetached = false;
    page.on("console", (message) => {
      if (!collectionState.active || message.type() !== "error") return;
      boundedPush(streams.consoleErrors, { text: message.text(), location: message.location() });
    });
    page.on("pageerror", (error) => {
      if (!collectionState.active) return;
      boundedPush(streams.pageErrors, {
        name: error?.name ?? null,
        message: error?.message ?? String(error),
        stack: error?.stack ?? null,
      });
    });
    page.on("response", (response) => {
      if (!collectionState.active || response.status() < 400) return;
      boundedPush(streams.httpErrors, {
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
        resourceType: response.request().resourceType(),
      });
    });
    page.on("requestfailed", (request) => {
      if (!collectionState.active) return;
      const event = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failure: request.failure()?.errorText ?? "unknown request failure",
      };
      if (isExpectedLocalMusicCancellation(event, managedServer.baseUrl)) {
        boundedPush(streams.expectedRequestCancellations, event);
      } else boundedPush(streams.requestFailures, event);
    });
    page.on("websocket", (socket) => {
      if (!collectionState.active) return;
      const event = { url: socket.url() };
      if (isExpectedManagedViteWebSocket(event, managedServer.baseUrl)) {
        boundedPush(streams.expectedManagedViteWebSockets, event);
      } else boundedPush(streams.webSockets, event);
    });

    const readAndRecord = async (label) => {
      const snapshot = await readBrowserSnapshot(page);
      lastSnapshot = snapshot;
      recordRuntimeErrors(snapshot, label);
      return snapshot;
    };
    const advanceAuthority = async () => {
      await page.evaluate(async () => {
        if (typeof window.advanceTime !== "function") throw new Error("window.advanceTime is unavailable");
        await window.advanceTime(50);
      });
      await page.waitForTimeout(35);
    };
    const waitForGameplay = async (label, requireR5) => {
      const deadline = Date.now() + options.timeoutMilliseconds;
      let snapshot = null;
      while (Date.now() < deadline) {
        await page.waitForTimeout(350);
        snapshot = await readAndRecord(label);
        const ring = snapshot?.state?.performance?.streaming?.immediateRing;
        const generation = snapshot?.state?.performance?.streaming?.generationWorker;
        const baseReady = snapshot?.state?.state === "playing"
          && ring?.desired === 9 && ring.ready === 9
          && generation?.state === "ready" && generation.ready === generation.workers
          && snapshot?.runtime?.ready === true
          && snapshot?.audit?.generationCertificates?.length > 0;
        const readinessPump = snapshot?.runtime?.playerAuthority?.pump;
        const r5Ready = snapshot?.runtime?.playerAuthority?.state === "ready"
          && readinessPump?.state === "ready"
          && Number.isSafeInteger(readinessPump.nativeBlockEditQueryCalls)
          && readinessPump.nativeBlockEditQueryCalls > 0
          && readinessPump.basicDirtActionQueryConfigured === false;
        if (!baseReady || (requireR5 && !r5Ready)) continue;
        return requireR5
          ? assertR5BasicDirtCheckpoint(snapshot, options.expectedArtifactHash, label)
          : assertTerrainAndRuntimeBase(snapshot, options.expectedArtifactHash, label);
      }
      fail(`${label} did not reach exact 9/9 gameplay readiness.`, { snapshot });
    };
    const waitForCursor = async (label, expectedCursor, timeoutMilliseconds = 45_000) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let snapshot = null;
      while (Date.now() < deadline) {
        await advanceAuthority();
        snapshot = await readAndRecord(label);
        if (savedCursor(snapshot)?.cursor !== expectedCursor
          || projectedCursor(snapshot)?.cursor !== expectedCursor
          || pumpDiagnostics(snapshot)?.nativeBlockEditCursor !== expectedCursor
          || pumpDiagnostics(snapshot)?.pendingNativeBlockEditSequence !== null) continue;
        return assertR5BasicDirtCheckpoint(snapshot, options.expectedArtifactHash, label);
      }
      fail(`${label} did not commit and acknowledge cursor ${expectedCursor}.`, { snapshot });
    };
    const waitForPendingNativeBlockEditFinalize = async (
      label,
      expectedCursor,
      timeoutMilliseconds = 60_000,
    ) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let snapshot = null;
      while (Date.now() < deadline) {
        await advanceAuthority();
        snapshot = await readAndRecord(label);
        const finalize = snapshot?.runtime?.playerAuthority?.nativeBlockEditFinalize;
        const pump = pumpDiagnostics(snapshot);
        if (savedCursor(snapshot)?.cursor !== expectedCursor - 1
          || projectedCursor(snapshot)?.cursor !== expectedCursor
          || pump?.nativeBlockEditCursor !== expectedCursor - 1
          || pump.pendingNativeBlockEditSequence !== expectedCursor
          || finalize?.state !== "awaiting-local-save"
          || finalize.attempts !== 1) continue;
        assertTerrainAndRuntimeBase(snapshot, options.expectedArtifactHash, label);
        return snapshot;
      }
      fail(`${label} did not retain the exact failed local-save successor.`, { snapshot });
    };
    const waitForPickupCursor = async (label, expectedCursor, timeoutMilliseconds = 45_000) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let snapshot = null;
      while (Date.now() < deadline) {
        await advanceAuthority();
        snapshot = await readAndRecord(label);
        if (savedPickupCursor(snapshot)?.cursor !== expectedCursor
          || projectedPickupCursor(snapshot)?.cursor !== expectedCursor
          || pumpDiagnostics(snapshot)?.dropPickupCursor !== expectedCursor
          || pumpDiagnostics(snapshot)?.pendingDropPickupSequence !== null) continue;
        return assertR5BasicDirtCheckpoint(snapshot, options.expectedArtifactHash, label);
      }
      fail(`${label} did not commit and acknowledge pickup cursor ${expectedCursor}.`, { snapshot });
    };
    const waitForPlayerDropCursor = async (label, expectedCursor, timeoutMilliseconds = 45_000) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let snapshot = null;
      while (Date.now() < deadline) {
        await advanceAuthority();
        snapshot = await readAndRecord(label);
        if (savedPlayerDropCursor(snapshot)?.cursor !== expectedCursor
          || projectedPlayerDropCursor(snapshot)?.cursor !== expectedCursor
          || pumpDiagnostics(snapshot)?.playerDropCursor !== expectedCursor
          || pumpDiagnostics(snapshot)?.pendingPlayerDropSequence !== null) continue;
        return assertR5BasicDirtCheckpoint(snapshot, options.expectedArtifactHash, label);
      }
      fail(`${label} did not commit and acknowledge player-drop cursor ${expectedCursor}.`, { snapshot });
    };
    const waitForNativeDropHotTransformAdvance = async (
      label,
      rustEntityId,
      previous,
      timeoutMilliseconds = 15_000,
    ) => {
      const previousRevision = decimalInteger(previous?.extractionRevision);
      assertCondition(previousRevision !== null,
        `${label} has no canonical prior native-drop extraction revision.`);
      const deadline = Date.now() + timeoutMilliseconds;
      let snapshot = null;
      while (Date.now() < deadline) {
        await advanceAuthority();
        snapshot = await readAndRecord(label);
        const frame = snapshot?.runtime?.playerAuthority?.nativeDropTransforms;
        const extractionRevision = decimalInteger(frame?.extractionRevision);
        const transforms = frame?.transforms
          ?.filter((transform) => transform.entityId === rustEntityId) ?? [];
        if (extractionRevision === null || extractionRevision <= previousRevision
          || transforms.length !== 1) continue;
        return snapshot;
      }
      fail(`${label} did not observe a newer accepted native-drop extraction.`, { snapshot, previous });
    };
    const waitForButtonReleased = async (label, button, expectedCursor) => {
      const deadline = Date.now() + 15_000;
      let snapshot = null;
      while (Date.now() < deadline) {
        await advanceAuthority();
        snapshot = await readAndRecord(label);
        if (savedCursor(snapshot)?.cursor === expectedCursor
          && (pumpDiagnostics(snapshot)?.lastAppliedButtons & button) === 0) {
          return assertR5BasicDirtCheckpoint(snapshot, options.expectedArtifactHash, label);
        }
      }
      fail(`${label} did not observe trusted button release.`, { snapshot });
    };
    const enablePublicCreativeFlight = async (baseline, label) => {
      const beforePosition = baseline?.state?.player?.position;
      assertCondition(baseline?.state?.player?.mode === GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.mode
        && baseline?.state?.player?.flying === false
        && Array.isArray(beforePosition) && beforePosition.length === 3,
      "Public Creative flight baseline is not exact grounded Builder gameplay.");
      const flightHud = page.locator(".creative-flight-hud");
      await flightHud.filter({ hasText: "CREATIVE · GROUNDED" }).waitFor({ state: "visible" });
      const groundedStatus = (await flightHud.textContent())?.replaceAll(/\s+/gu, " ").trim() ?? "";
      assertCondition(groundedStatus.includes("SPACE ×2") && groundedStatus.includes("FLY"),
        "Visible Creative flight HUD did not expose its public double-Space control.");
      await page.keyboard.press("Space");
      await page.waitForTimeout(80);
      await page.keyboard.press("Space");
      let snapshot = baseline;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await advanceAuthority();
        snapshot = await readAndRecord(`${label}-flight-${attempt}`);
        if (snapshot?.state?.player?.mode === GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.mode
          && snapshot?.state?.player?.flying === true) break;
      }
      await flightHud.filter({ hasText: "CREATIVE · FLYING" }).waitFor({ state: "visible" });
      const flyingStatus = (await flightHud.textContent())?.replaceAll(/\s+/gu, " ").trim() ?? "";
      const afterPosition = snapshot?.state?.player?.position;
      assertCondition(snapshot?.state?.player?.mode === GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.mode
        && snapshot?.state?.player?.flying === true
        && Array.isArray(afterPosition) && afterPosition.length === 3
        && Math.abs(afterPosition[0] - beforePosition[0]) <= 0.15
        && Math.abs(afterPosition[2] - beforePosition[2]) <= 0.15
        && Math.abs(afterPosition[1] - beforePosition[1]) <= 0.35
        && flyingStatus.includes("SPACE / SHIFT") && flyingStatus.includes("RISE / DESCEND"),
      "Public double-Space control did not deterministically enter stationary Creative flight.");
      return Object.freeze({
        snapshot,
        evidence: Object.freeze({
          schema: 1,
          mode: "public-keyboard-control",
          controls: Object.freeze(["Space", "Space"]),
          groundedStatus,
          flyingStatus,
          beforePosition: Object.freeze([...beforePosition]),
          afterPosition: Object.freeze([...afterPosition]),
          flying: true,
        }),
      });
    };
    const moveToVantage = async (
      baseline,
      [targetX, targetZ],
      label,
      identifier = 31,
      { releaseRadius = 0.8, settle = false } = {},
    ) => {
      await orientTowardHorizontalPoint(
        page, cdp, readAndRecord, targetX, targetZ, label,
      );
      const release = await beginTrustedTouchMovement(page, cdp, "Move forward", identifier);
      let snapshot = baseline;
      try {
        for (let step = 0; step < 60; step += 1) {
          await advanceAuthority();
          snapshot = await readAndRecord(`${label}-move-${step}`);
          const position = snapshot?.state?.player?.position;
          if (Array.isArray(position)
            && Math.hypot(position[0] - targetX, position[2] - targetZ) <= releaseRadius) break;
        }
      } finally { await release().catch(() => undefined); }
      await advanceAuthority();
      snapshot = await readAndRecord(`${label}-released`);
      if (settle) {
        for (let step = 0; step < 60; step += 1) {
          const velocity = snapshot?.state?.player?.velocity;
          if (Array.isArray(velocity) && velocity.length === 3
            && Math.hypot(velocity[0], velocity[2]) <= 0.05) break;
          await advanceAuthority();
          snapshot = await readAndRecord(`${label}-settle-${step}`);
        }
      }
      const start = baseline?.state?.player?.position;
      const position = snapshot?.state?.player?.position;
      const velocity = snapshot?.state?.player?.velocity;
      assertCondition(Array.isArray(start) && Array.isArray(position)
        && Math.hypot(position[0] - targetX, position[2] - targetZ) <= 1
        && Math.hypot(position[0] - start[0], position[2] - start[2]) >= 2
        && (!settle || (Array.isArray(velocity) && velocity.length === 3
          && Math.hypot(velocity[0], velocity[2]) <= 0.05)),
      `Trusted public movement did not reach deterministic ${label}.`);
      return snapshot;
    };
    const moveToAcquisitionVantage = (baseline) => moveToVantage(
      baseline,
      isGenericGrassScenario(options.scenario)
        ? GENERIC_GRASS_ACTION_WORLD_FIXTURE.miningVantage
        : BASIC_DIRT_ACTION_WORLD_FIXTURE.acquisitionVantage,
      "acquisition-vantage",
    );
    const moveIntoNativeDrop = async (baseline, expectedDropId, label = "native-drop-pickup") => {
      const priorPickupCursor = savedPickupCursor(baseline)?.cursor;
      assertCondition(Number.isSafeInteger(priorPickupCursor),
        `${label} has no exact successor pickup cursor.`);
      const expectedPickupCursor = priorPickupCursor + 1;
      const presented = baseline?.state?.drops?.filter((drop) => drop.rustEntityId === expectedDropId) ?? [];
      assertCondition(presented.length === 1 && Array.isArray(presented[0].position),
        "Native pickup source is not presented exactly once before movement.");
      const [targetX, , targetZ] = presented[0].position;
      await orientTowardHorizontalPoint(
        page, cdp, readAndRecord, targetX, targetZ, label,
      );
      const release = await beginTrustedTouchMovement(page, cdp, "Move forward", 32);
      let snapshot = baseline;
      try {
        for (let step = 0; step < 80; step += 1) {
          await advanceAuthority();
          snapshot = await readAndRecord(`${label}-move-${step}`);
          if (savedPickupCursor(snapshot)?.cursor === expectedPickupCursor) break;
        }
      } finally { await release().catch(() => undefined); }
      return waitForPickupCursor(`${label}-release`, expectedPickupCursor);
    };
    const moveAwayFromBlockCell = async (
      baseline,
      coordinate,
      [targetX, targetZ],
      label,
      identifier,
      {
        minimumCoordinateDistance = 2.15,
        maximumCoordinateDistance = 3.75,
        maximumVantageDistance = 1.25,
        maximumSupportDistance = 4.4,
      } = {},
    ) => {
      await orientTowardHorizontalPoint(
        page, cdp, readAndRecord, targetX, targetZ, `${label}-vantage`,
      );
      const release = await beginTrustedTouchMovement(page, cdp, "Move forward", identifier);
      let snapshot = baseline;
      let closestVantageDistance = Infinity;
      try {
        for (let step = 0; step < 60; step += 1) {
          await advanceAuthority();
          snapshot = await readAndRecord(`${label}-vantage-${step}`);
          const position = snapshot?.state?.player?.position;
          if (!Array.isArray(position)) continue;
          const vantageDistance = Math.hypot(position[0] - targetX, position[2] - targetZ);
          const dirtDistance = Math.hypot(position[0] - coordinate[0], position[2] - coordinate[2]);
          const passedClosestApproach = closestVantageDistance <= 1.25
            && vantageDistance > closestVantageDistance + 0.08;
          closestVantageDistance = Math.min(closestVantageDistance, vantageDistance);
          if (vantageDistance <= 0.75 || dirtDistance >= 2.65 || passedClosestApproach) break;
        }
      } finally { await release().catch(() => undefined); }
      let stableVelocityPolls = 0;
      for (let step = 0; step < 80; step += 1) {
        await advanceAuthority();
        snapshot = await readAndRecord(`${label}-settle-${step}`);
        const velocity = snapshot?.state?.player?.velocity;
        const horizontalSpeed = Array.isArray(velocity)
          ? Math.hypot(velocity[0], velocity[2])
          : Infinity;
        stableVelocityPolls = horizontalSpeed <= 0.03 ? stableVelocityPolls + 1 : 0;
        if (stableVelocityPolls >= 3) break;
      }
      const position = snapshot?.state?.player?.position;
      const velocity = snapshot?.state?.player?.velocity;
      const distance = Array.isArray(position)
        ? Math.hypot(position[0] - coordinate[0], position[2] - coordinate[2])
        : Infinity;
      const vantageDistance = Array.isArray(position)
        ? Math.hypot(position[0] - targetX, position[2] - targetZ)
        : Infinity;
      const supportDistance = Array.isArray(position)
        ? Math.hypot(position[0] - (coordinate[0] - 1), position[2] - coordinate[2])
        : Infinity;
      const horizontalSpeed = Array.isArray(velocity)
        ? Math.hypot(velocity[0], velocity[2])
        : Infinity;
      assertCondition(distance >= minimumCoordinateDistance
        && distance <= maximumCoordinateDistance
        && vantageDistance <= maximumVantageDistance
        && supportDistance <= maximumSupportDistance
        && stableVelocityPolls >= 3 && horizontalSpeed <= 0.03,
        `Trusted public movement did not establish a safe ${label} distance.`);
      return snapshot;
    };
    const moveAwayFromDirtCell = (baseline, coordinate) => moveAwayFromBlockCell(
      baseline,
      coordinate,
      BASIC_DIRT_ACTION_WORLD_FIXTURE.finalPersistenceVantage,
      "native-drop-persistence",
      33,
    );
    const waitForSelectedDirtSlot = async (baseline) => {
      const deadline = Date.now() + 15_000;
      const initialWriteOrdinal = baseline.audit?.nextWriteOrdinal;
      let snapshot = baseline;
      while (Date.now() < deadline) {
        await advanceAuthority();
        snapshot = await readAndRecord("select-acquired-dirt-slot");
        if (snapshot.state?.inventory?.selectedSlot === BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot
          && pumpDiagnostics(snapshot)?.selectedSlot === BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot
          && exactPlainDirtStack(snapshot.state?.inventory?.held, 1)
          && snapshot.storage?.save?.selected === BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot
          && exactStarterStack(selectedSavedStack(snapshot))
          && exactPlainDirtStack(savedStackAt(snapshot, BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot), 1)
          && snapshot.audit?.nextWriteOrdinal === initialWriteOrdinal) return snapshot;
      }
      fail("Trusted public hotbar selection did not select the acquired Dirt stack.", { snapshot });
    };

    const r5Url = new URL("/", `${managedServer.baseUrl}/`);
    r5Url.searchParams.set("experimental.rust-live-player-authority", "r5");
    await page.goto(r5Url.href, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(options.timeoutMilliseconds, 120_000),
    });
    await waitForHarness(page, options.timeoutMilliseconds);
    assertCondition(new URL(page.url()).searchParams.get("experimental.rust-live-player-authority") === "r5",
      "R5 new-world route lost its explicit selector.");
    await page.getByRole("button", { name: /Create New World/u }).click();
    await page.getByRole("heading", { name: "Create a New World" }).waitFor();
    await page.getByLabel("World name").fill(worldFixture.name);
    await page.getByLabel("World seed").fill(worldFixture.seed);
    await page.getByRole("button", {
      name: isGenericShapedPropScenario(options.scenario) ? /^CREATIVE/u : /^SURVIVAL/u,
    }).click();
    await page.getByRole("button", { name: "Generate World" }).click({ noWaitAfter: true });
    r5Baseline = await waitForGameplay("r5-new-world", true);
    terrainReadiness.created = await waitForRustMultiplayerVisualTerrainReadiness(
      page,
      Math.min(options.timeoutMilliseconds, 180_000),
      { label: isGenericShapedPropScenario(options.scenario)
        ? "generic-shaped-prop-r5-created"
        : isGenericGrassScenario(options.scenario)
          ? "generic-grass-r5-created"
          : "basic-dirt-r5-created" },
    );
    const spawn = r5Baseline.state?.player?.position;
    const creationEdits = inspectSurvivalCreationEdits(
      r5Baseline.storage,
      spawn,
      isGenericShapedPropScenario(options.scenario)
        ? GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE.protectedNaturalCoordinate
        : isGenericGrassScenario(options.scenario)
          ? GENERIC_GRASS_ACTION_WORLD_FIXTURE.naturalMeadowGrassCoordinate
          : BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate,
    );
    const exactInitialInventory = isGenericShapedPropScenario(options.scenario)
      ? Array.isArray(r5Baseline.storage.save.inventory)
        && r5Baseline.storage.save.inventory.length === 36
        && r5Baseline.storage.save.inventory.every((slot) => slot === null)
        && exactPlainStack(r5Baseline.state?.inventory?.held ?? null, null)
      : exactStarterStack(selectedSavedStack(r5Baseline))
        && exactStarterStack(r5Baseline.state?.inventory?.held)
        && exactPlainStack(savedStackAt(r5Baseline, BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot), null);
    assertCondition(r5Baseline.storage.catalogWorldCount === 1
      && r5Baseline.storage.save?.seed === worldFixture.seed
      && r5Baseline.storage.save?.mode === worldFixture.mode
      && r5Baseline.runtime?.hydration === "new-world"
      && savedCursor(r5Baseline)?.cursor === 0
      && projectedCursor(r5Baseline)?.cursor === 0
      && pumpDiagnostics(r5Baseline)?.nativeBlockEditCursor === 0
      && savedPickupCursor(r5Baseline)?.cursor === 0
      && projectedPickupCursor(r5Baseline)?.cursor === 0
      && pumpDiagnostics(r5Baseline)?.dropPickupCursor === 0
      && r5Baseline.storage.save.selected === worldFixture.initialSelectedSlot
      && exactInitialInventory
      && creationEdits.valid
      && creationEdits.canonical.count === worldFixture.expectedCreationEdits.count
      && creationEdits.canonical.sha256 === worldFixture.expectedCreationEdits.sha256
      && (r5Baseline.storage.save.drops ?? []).length === 0
      && Array.isArray(spawn)
      && spawn.every((value, index) => Math.abs(value - worldFixture.expectedSpawn[index]) <= 0.15),
    "Real UI R5 world creation did not bind the exact mode inventory, spawn, bounded spawn-clearance edits, and zero receipt cursors.");
    await captureScreenshot(
      page,
      options.repositoryRoot,
      options.outputDirectory,
      screenshots,
      isGenericShapedPropScenario(options.scenario)
        ? "01-r5-creative-shaped-prop-created"
        : "01-r5-survival-created",
    );

    if (isGenericShapedPropScenario(options.scenario)) {
      const fixture = GENERIC_SHAPED_PROP_ACTION_WORLD_FIXTURE;
      const placementEmptyCellAimOptions = Object.freeze({
        supportCoordinate: fixture.placementSupportCoordinate,
        // The Creative placement pose is above the empty shelf cell, so this
        // ray can traverse that cell before reaching the support's top face.
        aimPoint: Object.freeze([
          fixture.placementSupportCoordinate[0],
          fixture.placementSupportCoordinate[1] + 0.49,
          fixture.placementSupportCoordinate[2],
        ]),
      });
      const placementAddress = terrainEditAddress(fixture.placementCoordinate);
      const creationPlacementEdit = creationEdits.canonical.entries.find((entry) => (
        entry.chunkKey === placementAddress.chunkKey && entry.index === placementAddress.index
      ));
      assertCondition(Math.abs(fixture.placementCoordinate[0] - spawn[0]) > 1
        && creationPlacementEdit === undefined
        && savedBlockFacing(r5Baseline, fixture.placementCoordinate) === 0,
      "Creative creation did not expose the exact natural Air placement cell beyond the spawn-clearance footprint.");

      shapedPropCatalogSelection = await selectVisibleCreativeCatalogItem(
        page,
        fixture.expectedTargetName,
        fixture.selectedStack.item,
      );
      let catalogSelected = null;
      const nativeSelectionDeadline = Date.now() + 15_000;
      while (Date.now() < nativeSelectionDeadline) {
        await advanceAuthority();
        catalogSelected = await readAndRecord("creative-catalog-wildwood-shelf-selected");
        const nativeInventory = nativeInventoryDiagnostics(catalogSelected);
        if (catalogSelected.state?.inventory?.selectedSlot === fixture.initialSelectedSlot
          && exactPlainStack(catalogSelected.state?.inventory?.held, fixture.selectedStack)
          && nativeInventory?.selectedSlot === fixture.initialSelectedSlot
          && exactNativePlainStack(nativeInventory.held, fixture.selectedStack)
          && creativeCatalogNativeCustodyEvidence(
            r5Baseline,
            catalogSelected,
            fixture.initialSelectedSlot,
            fixture.selectedStack,
          )) break;
        await page.waitForTimeout(80);
      }
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "02-creative-catalog-wildwood-shelf-selected",
      );
      const nativeCatalogInventory = nativeInventoryDiagnostics(catalogSelected);
      const nativeCatalogCustody = assertCreativeCatalogNativeCustody(
        r5Baseline,
        catalogSelected,
        fixture.initialSelectedSlot,
        fixture.selectedStack,
      );
      shapedPropCatalogSelection = Object.freeze({
        ...shapedPropCatalogSelection,
        nativeCustody: nativeCatalogCustody,
      });
      assertCondition(catalogSelected.state?.inventory?.selectedSlot === fixture.initialSelectedSlot
        && exactPlainStack(catalogSelected.state?.inventory?.held, fixture.selectedStack)
        && pumpDiagnostics(catalogSelected)?.selectedSlot === fixture.initialSelectedSlot
        && nativeCatalogInventory?.selectedSlot === fixture.initialSelectedSlot
        && exactNativePlainStack(nativeCatalogInventory.held, fixture.selectedStack)
        && savedCursor(catalogSelected)?.cursor === 0
        && savedPickupCursor(catalogSelected)?.cursor === 0
        && savedPlayerDropCursor(catalogSelected)?.cursor === 0,
      "Visible Creative catalog selection did not bind exact item-270 live custody.");
      await page.getByRole("button", { name: "Close inventory" }).click();
      // Keep the movement calibration on the same grounded physics path used
      // by the other public-input witnesses. Creative flight has a much higher
      // horizontal acceleration and can overshoot this nearby vantage before
      // a fixed-step observation can release the touch control.
      catalogSelected = await moveToVantage(
        catalogSelected,
        fixture.placementVantage,
        "shaped-prop-placement-vantage",
        31,
        { releaseRadius: 1.8, settle: true },
      );
      const creativeFlight = await enablePublicCreativeFlight(
        catalogSelected,
        "shaped-prop-placement",
      );
      catalogSelected = creativeFlight.snapshot;
      shapedPropCreativeFlightEvidence = creativeFlight.evidence;
      shapedPropPlacementAim = await aimThroughExpectedEmptyCell(
        page,
        cdp,
        readAndRecord,
        fixture.placementCoordinate,
        fixture.expectedTargetName,
        placementEmptyCellAimOptions,
      );
      const placeBaseline = shapedPropPlacementAim.snapshot;
      const savedSelectionBeforePlace = placeBaseline.storage?.save?.selected;
      const savedStackBeforePlace = selectedSavedStack(placeBaseline);
      const savedCatalogLagged = savedSelectionBeforePlace === fixture.initialSelectedSlot
        && exactPlainStack(savedStackBeforePlace, null);
      const savedCatalogCaughtUp = savedSelectionBeforePlace === fixture.initialSelectedSlot
        && exactPlainStack(savedStackBeforePlace, fixture.selectedStack);
      assertCondition((savedCatalogLagged || savedCatalogCaughtUp)
        && placeBaseline.state?.inventory?.selectedSlot === fixture.initialSelectedSlot
        && exactPlainStack(placeBaseline.state?.inventory?.held, fixture.selectedStack)
        && savedCursor(placeBaseline)?.cursor === 0
        && savedPickupCursor(placeBaseline)?.cursor === 0
        && savedPlayerDropCursor(placeBaseline)?.cursor === 0
        && savedBlockFacing(placeBaseline, fixture.placementCoordinate) === 0
        && (placeBaseline.storage.save.drops ?? []).length === 0,
      "Creative placement baseline lost its exact catalog item, empty cell, or zero receipt/drop custody.");
      const placementWriteOrdinal = placeBaseline.audit?.nextWriteOrdinal ?? 0;
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "03-before-east-facing-wildwood-shelf-placement",
      );
      const releasePlacement = await beginTrustedTouchAction(
        page,
        cdp,
        "Use, place, or raise shield",
        23,
      );
      try { afterPlace = await waitForCursor("wildwood-shelf-place", 1, 60_000); }
      finally { await releasePlacement().catch(() => undefined); }
      afterPlace = await waitForButtonReleased(
        "wildwood-shelf-place-release",
        SECONDARY_USE_BUTTON,
        1,
      );
      shapedPropPlacementEvidence = assertGenericNativeBlockEditTransaction({
        action: "place",
        before: placeBaseline,
        after: afterPlace,
        auditWrites: afterPlace.audit.worldDocumentWrites,
        firstAuditOrdinal: placementWriteOrdinal,
        expectedCoordinate: fixture.placementCoordinate,
        expectedSelectedSlot: fixture.initialSelectedSlot,
        expectedSelectedStackBefore: fixture.selectedStack,
        expectedSelectedStackAfter: fixture.selectedStack,
        expectedSavedSelectedSlotBefore: fixture.initialSelectedSlot,
        expectedSavedSelectedStackBefore: savedCatalogLagged ? null : fixture.selectedStack,
        expectedPreviousBlockId: fixture.expectedBlockTransition.placementPreviousBlockId,
        expectedBlockId: fixture.expectedBlockTransition.placedBlockId,
        expectedPreviousFacing: 0,
        expectedFacing: fixture.expectedFacing,
        expectedGeneratedDrop: null,
        requireInventoryDocumentUnchanged: savedCatalogCaughtUp,
        requireRustAuthoredDirtySet: true,
      });
      assertCondition(afterPlace.storage.save.mode === fixture.mode
        && savedBlockFacing(afterPlace, fixture.placementCoordinate) === fixture.expectedFacing
        && shapedPropPlacementEvidence.checkpointWitness.cell.facing === fixture.expectedFacing
        && (afterPlace.storage.save.drops ?? []).length === 0,
      "Creative shelf placement did not retain exact East-facing block custody with no drop.");
      const shelfRetargetDeadline = Date.now() + 15_000;
      while (Date.now() < shelfRetargetDeadline) {
        const target = afterPlace?.state?.target;
        if (target?.type === "block" && target.name === fixture.expectedTargetName
          && JSON.stringify(target.position) === JSON.stringify(fixture.placementCoordinate)) break;
        await page.waitForTimeout(50);
        afterPlace = await readAndRecord("retarget-east-facing-wildwood-shelf");
      }
      assertCondition(afterPlace?.state?.target?.name === fixture.expectedTargetName
        && JSON.stringify(afterPlace.state.target.position)
          === JSON.stringify(fixture.placementCoordinate),
      "Unchanged public ray did not retarget the exact placed Wildwood Shelf.");
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "04-after-east-facing-wildwood-shelf-placement",
      );

      await tapPublicPauseControl(page);
      await page.getByRole("heading", { name: "Game Paused" }).waitFor();
      const pausedAfterPlacement = await readAndRecord("paused-after-wildwood-shelf-placement");
      assertR5BasicDirtCheckpoint(
        pausedAfterPlacement,
        options.expectedArtifactHash,
        "paused-after-wildwood-shelf-placement",
        "paused",
      );
      await page.getByRole("button", { name: "Save & Quit to Title" }).click({ noWaitAfter: true });
      await page.getByRole("button", { name: /^Continue\b/u }).waitFor({ timeout: 120_000 });
      await waitForCompleteTitleMenu(page, 120_000);
      shapedPropTitleAfterCreativeSave = await readAndRecord("title-after-wildwood-shelf-creative-save");
      assertCondition(shapedPropTitleAfterCreativeSave.state?.state === "title"
        && shapedPropTitleAfterCreativeSave.storage.save.mode === fixture.mode
        && savedCursor(shapedPropTitleAfterCreativeSave)?.cursor === 1
        && savedBlockFacing(shapedPropTitleAfterCreativeSave, fixture.placementCoordinate)
          === fixture.expectedFacing
        && exactPlainStack(selectedSavedStack(shapedPropTitleAfterCreativeSave), fixture.selectedStack)
        && (shapedPropTitleAfterCreativeSave.storage.save.drops ?? []).length === 0,
      "Creative Save & Quit did not retain the exact placed shelf, facing, stack, and cursor.");
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "05-title-after-wildwood-shelf-creative-save",
        screenshotRasterChecks,
      );

      await page.getByRole("button", { name: /^Worlds\b/u }).click();
      await page.getByRole("heading", { name: "Worlds" }).waitFor({ state: "visible" });
      const worldCard = page.locator("button.world-catalog-card").filter({ hasText: fixture.name });
      assertCondition(await worldCard.count() === 1,
        "Worlds UI did not expose one exact saved shaped-prop world card.");
      await worldCard.click();
      const modeEditor = page.getByRole("region", { name: `Game mode for ${fixture.name}` });
      await modeEditor.waitFor({ state: "visible" });
      const survivalButton = modeEditor.getByRole("button", { name: /^SURVIVAL\b/u });
      assertCondition(await survivalButton.getAttribute("aria-pressed") === "false",
        "Worlds UI did not begin with the exact Creative mode selected.");
      const dialogPromise = page.waitForEvent("dialog");
      const modeClickPromise = survivalButton.click({ noWaitAfter: true });
      const dialog = await dialogPromise;
      shapedPropModeEditorEvidence = {
        schema: 1,
        worldName: fixture.name,
        fromMode: fixture.mode,
        toMode: fixture.survivalMode,
        dialogType: dialog.type(),
        dialogMessage: dialog.message(),
        accepted: true,
        notice: `${fixture.name} will load in Survival. Inventory and world progress were preserved.`,
      };
      await dialog.accept();
      await modeClickPromise;
      await page.locator(".world-catalog-notice").filter({
        hasText: shapedPropModeEditorEvidence.notice,
      }).waitFor({ state: "visible" });
      shapedPropTitleAfterModeChange = await readAndRecord("worlds-after-survival-mode-confirmation");
      assertCondition(shapedPropTitleAfterModeChange.storage.save.mode === fixture.survivalMode
        && await survivalButton.getAttribute("aria-pressed") === "true",
      "Worlds UI did not durably select Survival after exact confirmation.");
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "06-worlds-wildwood-shelf-survival-mode",
      );
      await page.getByRole("button", { name: /Main Menu/u }).click();
      await waitForCompleteTitleMenu(page, 120_000);
      await page.getByRole("button", { name: /^Continue\b/u }).click({ noWaitAfter: true });
      shapedPropSurvivalLoaded = await waitForGameplay("wildwood-shelf-survival-load", true);
      terrainReadiness.survivalModeLoaded = await waitForRustMultiplayerVisualTerrainReadiness(
        page,
        Math.min(options.timeoutMilliseconds, 180_000),
        { label: "generic-shaped-prop-survival-loaded" },
      );
      shapedPropModeTransitionEvidence = assertGenericShapedPropModeTransition({
        titleAfterCreativeSave: shapedPropTitleAfterCreativeSave,
        titleAfterModeChange: shapedPropTitleAfterModeChange,
        survivalLoaded: shapedPropSurvivalLoaded,
        modeEditorEvidence: shapedPropModeEditorEvidence,
      });
      shapedPropSurvivalLoaded = await moveAwayFromBlockCell(
        shapedPropSurvivalLoaded,
        fixture.placementCoordinate,
        fixture.miningVantage,
        "wildwood-shelf-drop-persistence",
        35,
        {
          // Public movement can coast past the flat meadow vantage. The later
          // public-ray gate still enforces an exact <=4.5-block Shelf hit.
          minimumCoordinateDistance: NATIVE_DROP_PICKUP_RADIUS + 0.2,
          maximumCoordinateDistance: 4.25,
          maximumVantageDistance: 1.6,
          maximumSupportDistance: 5.25,
        },
      );
      shapedPropMineAim = await aimAtExpectedNaturalBlock(
        page,
        cdp,
        readAndRecord,
        fixture.placementCoordinate,
        fixture.expectedTargetName,
        "wildwood-shelf",
      );
      const mineBaseline = shapedPropMineAim.snapshot;
      assertCondition(mineBaseline.storage.save.mode === fixture.survivalMode
        && savedCursor(mineBaseline)?.cursor === 1
        && savedBlockFacing(mineBaseline, fixture.placementCoordinate) === fixture.expectedFacing
        && exactPlainStack(selectedSavedStack(mineBaseline), fixture.selectedStack)
        && exactPlainStack(mineBaseline.state?.inventory?.held, fixture.selectedStack)
        && (mineBaseline.storage.save.drops ?? []).length === 0,
      "Survival mining baseline lost the exact placed shelf or preserved Creative stack.");
      const mineWriteOrdinal = mineBaseline.audit?.nextWriteOrdinal ?? 0;
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "07-before-survival-wildwood-shelf-mine",
      );
      const releaseMine = await beginTrustedTouchAction(page, cdp, "Harvest or attack", 24);
      try { afterFinalMine = await waitForCursor("wildwood-shelf-mine", 2, 60_000); }
      finally { await releaseMine().catch(() => undefined); }
      afterFinalMine = await waitForButtonReleased(
        "wildwood-shelf-mine-release",
        PRIMARY_ATTACK_BUTTON,
        2,
      );
      finalMineEvidence = assertGenericNativeBlockEditTransaction({
        action: "mine",
        before: mineBaseline,
        after: afterFinalMine,
        auditWrites: afterFinalMine.audit.worldDocumentWrites,
        firstAuditOrdinal: mineWriteOrdinal,
        expectedCoordinate: fixture.placementCoordinate,
        expectedSelectedSlot: fixture.initialSelectedSlot,
        expectedSelectedStackBefore: fixture.selectedStack,
        expectedSelectedStackAfter: fixture.selectedStack,
        expectedPreviousBlockId: fixture.expectedBlockTransition.placedBlockId,
        expectedBlockId: fixture.expectedBlockTransition.minedBlockId,
        expectedPreviousFacing: fixture.expectedFacing,
        expectedFacing: 0,
        expectedGeneratedDrop: fixture.generatedDrop,
        requireInventoryDocumentUnchanged: true,
        requireRustAuthoredDirtySet: true,
      });
      const shelfDropId = finalMineEvidence.generatedDrop.rustEntityId;
      assertCondition(afterFinalMine.storage.save.mode === fixture.survivalMode
        && savedPickupCursor(afterFinalMine)?.cursor === 0
        && savedPlayerDropCursor(afterFinalMine)?.cursor === 0
        && savedBlockFacing(afterFinalMine, fixture.placementCoordinate) === 0,
      "Survival shelf mine changed mode/pickup/player-drop custody or retained stale facing.");
      let previousHotTransform = null;
      for (let sampleIndex = 0; sampleIndex < 3; sampleIndex += 1) {
        if (sampleIndex > 0) {
          afterFinalMine = await waitForNativeDropHotTransformAdvance(
            `wildwood-shelf-native-drop-hot-transform-${sampleIndex + 1}`,
            shelfDropId,
            previousHotTransform,
          );
        }
        previousHotTransform = assertNativeDropHotTransformSample(
          afterFinalMine,
          shelfDropId,
          previousHotTransform,
        );
        nativeDropHotTransformEvidence.push(previousHotTransform);
        assertCondition(savedPickupCursor(afterFinalMine)?.cursor === 0,
          "Wildwood Shelf drop was picked up before persistence evidence.");
      }
      shapedPropInputProof = assertTrustedGenericShapedPropInputs(
        afterFinalMine.audit,
        shapedPropCatalogSelection,
      );
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "08-after-survival-wildwood-shelf-mine",
      );

      await tapPublicPauseControl(page);
      await page.getByRole("heading", { name: "Game Paused" }).waitFor();
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "09-paused-after-wildwood-shelf-mine",
      );
      await page.getByRole("button", { name: "Save & Quit to Title" }).click({ noWaitAfter: true });
      await page.getByRole("button", { name: /^Continue\b/u }).waitFor({ timeout: 120_000 });
      await waitForCompleteTitleMenu(page, 120_000);
      titleAfterSave = await readAndRecord("title-after-wildwood-shelf-mine-save");
      assertCondition(titleAfterSave.state?.state === "title"
        && titleAfterSave.storage.save.mode === fixture.survivalMode
        && savedCursor(titleAfterSave)?.cursor === 2
        && savedPickupCursor(titleAfterSave)?.cursor === 0
        && exactPlainStack(selectedSavedStack(titleAfterSave), fixture.selectedStack)
        && savedBlockFacing(titleAfterSave, fixture.placementCoordinate) === 0
        && titleAfterSave.storage.save.drops?.filter((drop) => drop.rustEntityId === shelfDropId).length === 1,
      "Survival Save & Quit did not retain the exact empty shelf cell, item-270 stack/drop, and cursor.");
      const shelfDropWrite = [...(titleAfterSave.audit?.worldDocumentWrites ?? [])]
        .reverse()
        .find((write) => write?.save?.rustNativeBlockEditProjection?.cursor === 2
          && write.save?.drops?.filter((drop) => drop.rustEntityId === shelfDropId).length === 1);
      assertCondition(shelfDropWrite,
        "Shelf Save & Quit produced no audited durable row for its exact native item-270 drop.");
      durableNativeDropHotTransformEvidence = assertSavedNativeDropMatchesHotTransform(
        shelfDropWrite,
        shelfDropId,
        { expectedItem: fixture.generatedDrop.item, expectedCount: fixture.generatedDrop.count },
      );
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "10-title-after-wildwood-shelf-mine-save",
        screenshotRasterChecks,
      );

      await page.reload({
        waitUntil: "domcontentloaded",
        timeout: Math.min(options.timeoutMilliseconds, 120_000),
      });
      assertCondition(new URL(page.url()).searchParams.get("experimental.rust-live-player-authority") === "r5",
        "Shaped-prop full reload lost the explicit R5 selector.");
      await waitForHarness(page, options.timeoutMilliseconds);
      const freshContinue = page.getByRole("button", { name: /^Continue\b/u });
      await freshContinue.waitFor({ timeout: 120_000 });
      await waitForCompleteTitleMenu(page, 120_000);
      titleAfterReload = await readAndRecord("title-after-wildwood-shelf-full-reload");
      assertCondition(titleAfterReload.state?.state === "title"
        && exactSavedRestorationShape(titleAfterReload) === exactSavedRestorationShape(titleAfterSave),
      "Full reload changed the exact saved shaped-prop document before Continue.");
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "11-title-after-wildwood-shelf-full-reload",
        screenshotRasterChecks,
      );
      await freshContinue.click({ noWaitAfter: true });
      continued = await waitForGameplay("fresh-wildwood-shelf-continue", true);
      terrainReadiness.restored = await waitForRustMultiplayerVisualTerrainReadiness(
        page,
        Math.min(options.timeoutMilliseconds, 180_000),
        { label: "generic-shaped-prop-restored" },
      );
      const restoredEmptyAim = await aimAtExpectedUntargetedEmptyCell(
        page,
        cdp,
        readAndRecord,
        fixture.placementCoordinate,
        "wildwood-shelf",
      );
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "12-fresh-wildwood-shelf-empty-cell-restoration",
      );
      const splitWriteOrdinal = restoredEmptyAim.snapshot?.audit?.nextWriteOrdinal;
      assertCondition(Number.isSafeInteger(splitWriteOrdinal) && splitWriteOrdinal >= 0,
        "Restored empty Shelf observation omitted its audited write boundary.");
      const emptyDurableCustody = splitRayDurableCustodyShape(restoredEmptyAim.snapshot);
      const emptyAuthorityCursors = splitRayAuthorityCursorShape(restoredEmptyAim.snapshot);
      const restoredSupportAim = await aimAtExpectedNaturalBlock(
        page,
        cdp,
        readAndRecord,
        fixture.placementSupportCoordinate,
        fixture.expectedSupportName,
        "wildwood-shelf-support",
      );
      const interveningWrites = (restoredSupportAim.snapshot?.audit?.worldDocumentWrites ?? [])
        .filter((write) => Number.isSafeInteger(write?.ordinal) && write.ordinal >= splitWriteOrdinal);
      const restoredEmptySupportEvidence = composeSplitEmptyCellSupportEvidence({
        coordinate: fixture.placementCoordinate,
        supportCoordinate: fixture.placementSupportCoordinate,
        supportName: fixture.expectedSupportName,
        emptyAim: restoredEmptyAim,
        supportAim: restoredSupportAim,
        durableCustodyUnchanged: splitRayDurableCustodyShape(restoredSupportAim.snapshot)
          === emptyDurableCustody,
        authorityCursorsUnchanged: splitRayAuthorityCursorShape(restoredSupportAim.snapshot)
          === emptyAuthorityCursors,
        interveningWritesPreservedCustody: interveningWrites.every((write) => (
          splitRayDurableCustodyShape(write) === emptyDurableCustody
        )),
      });
      continued = restoredSupportAim.snapshot;
      restorationEvidence = assertGenericNativeBlockEditFreshRestoration({
        titleAfterSave,
        titleAfterReload,
        continued,
        coordinate: fixture.placementCoordinate,
        expectedCursor: 2,
        expectedPickupCursor: 0,
        expectedPlayerDropCursor: 0,
        expectedSelectedSlot: fixture.initialSelectedSlot,
        expectedSelectedStack: fixture.selectedStack,
        expectedRestoredBlockId: AIR_BLOCK_ID,
        expectedRestoredFacing: 0,
        expectedDrop: fixture.generatedDrop,
        expectedDropId: shelfDropId,
        liveEmptyCellEvidence: restoredEmptySupportEvidence,
      });
      await captureScreenshot(
        page,
        options.repositoryRoot,
        options.outputDirectory,
        screenshots,
        "13-fresh-wildwood-shelf-support-and-drop-restoration",
      );

      result = {
        schema: 2,
        gate: "blockwild-rust-generic-shaped-prop-browser-v1",
        status: "passed",
        createdAt: new Date().toISOString(),
        authorityClaim: "bounded-isolated-candidate-generic-shaped-prop-only",
        scenario: options.scenario,
        artifact: {
          hash: options.expectedArtifactHash,
          directory: EXPECTED_ENGINE_RELATIVE_DIRECTORY,
          sourceSnapshot: selection.sourceSnapshot,
          candidateTree: selection.candidateTreeSnapshot,
          canonicalTreeBefore: selection.canonicalTreeSnapshot,
          routeRequests,
        },
        fixture,
        creativeCatalogSelection: shapedPropCatalogSelection,
        creativeFlight: shapedPropCreativeFlightEvidence,
        placementTarget: shapedPropPlacementAim,
        placement: shapedPropPlacementEvidence,
        modeTransition: shapedPropModeTransitionEvidence,
        survivalMineTarget: shapedPropMineAim,
        mine: finalMineEvidence,
        nativeDropHotTransforms: {
          liveSamples: nativeDropHotTransformEvidence,
          durableSave: durableNativeDropHotTransformEvidence,
        },
        restoration: restorationEvidence,
        inputProof: shapedPropInputProof,
        terrainReadiness,
        checkpoints: {
          created: r5Baseline,
          titleAfterCreativeSave: shapedPropTitleAfterCreativeSave,
          titleAfterModeChange: shapedPropTitleAfterModeChange,
          survivalLoaded: shapedPropSurvivalLoaded,
          afterPlacement: afterPlace,
          afterMine: afterFinalMine,
          titleAfterMineSave: titleAfterSave,
          titleAfterReload,
          continued,
        },
        harness: {
          baseUrl: managedServer.baseUrl,
          managedVite: true,
          hmr: managedServer.inlineConfig.server.hmr,
          watch: "ignore-all",
          preparationRouteSearch: "experimental.rust-live-player-authority=r5",
          authorityRouteSelector: "r5",
          inputMode: shapedPropInputProof.mode,
          browserProfileToken: path.basename(profileDirectory),
          browserExecutable: browserExecutable ?? "playwright-managed",
          playwrightSource: playwright.source,
          browserGateMutex: browserMutexEvidence,
        },
        coverage: {
          realUiCreativeNativeCreation: "passed",
          exactVisibleCatalogItem270Selection: "passed",
          publicDoubleSpaceCreativeFlight: "passed",
          exactSpawnClearanceAirPlacementTarget: "passed",
          trustedPublicTouchMovementTargetingPlacementAndMine: "passed",
          exactAirToWildwoodShelfEastFacingTransition: "passed",
          creativeInventoryNoOpPlacement: "passed",
          rustAuthoredPlacementDirtySet: "passed",
          creativeSaveAndQuit: "passed",
          exactWorldsUiCreativeToSurvivalConfirm: "passed",
          sameWorldInventoryEditFacingAndCursorPreservation: "passed",
          survivalNativeHydration: "passed",
          exactWildwoodShelfToAirFacingReset: "passed",
          exactGeneratedNativeItem270Drop: "passed",
          rustDrivenNativeDropHotTransforms: "passed",
          acceptedHotTransformDurableSave: "passed",
          nativeCheckpointBeforeEachProjection: "passed",
          receiptBoundDocumentBeforeEachAck: "passed",
          noOldCursorOptimisticDocumentMutation: "passed",
          survivalSaveAndQuit: "passed",
          fullPageReloadAndFreshContinue: "passed",
          exactEmptyCellAndSameNativeDropRestoration: "passed",
          currentSourceCandidateUnchanged: "passed",
          canonicalPublicEngineUnchanged: "passed",
        },
        screenshots,
        screenshotRasterChecks,
        canonicalAssetRequests,
        errors: streams,
        cleanup,
        exclusions: {
          broaderShapedAndTopologyEdits: "This bounded gate proves one static one-cell shelf profile. Connected, paired, multi-cell, rooted, liquid, dynamic-state, container, and other shaped behavior remains outside the claim.",
          alternateStaticProfiles: "Mooncap and Sealed Barrel are admitted by the same exact static-shape predicate but are not exercised by this Wildwood Shelf witness. Dragon eggs, fireplaces, and every other shaped content profile remain explicitly excluded.",
          creativeAuthority: "Creative is used only to select and place item 270; the same saved world is explicitly changed through the Worlds UI and mined only after a fresh Survival load.",
          canonicalPromotion: "The isolated candidate is tested without modifying or promoting canonical public/engine.",
          mutationSurface: "Creation, catalog selection, movement, targeting, placement, both Save & Quit actions, Worlds mode editing with confirmation, mining, reload, and Continue use visible production UI or trusted public controls. Evidence reads public diagnostics and the production WorldStorage document; no storage mutation or test-only engine hook is called.",
        },
      };
    } else if (isGenericGrassScenario(options.scenario)) {
      const grassCreationBaseline = r5Baseline;
      await moveToAcquisitionVantage(r5Baseline);
      const grassAim = await aimAtExpectedNaturalBlock(
        page,
        cdp,
        readAndRecord,
        GENERIC_GRASS_ACTION_WORLD_FIXTURE.naturalMeadowGrassCoordinate,
        GENERIC_GRASS_ACTION_WORLD_FIXTURE.expectedTargetName,
        "grass",
      );
      targetEvidence = grassAim;
      r5Baseline = grassAim.snapshot;
      assertR5BasicDirtCheckpoint(r5Baseline, options.expectedArtifactHash, "before-generic-grass-mine");
      assertCondition(savedCursor(r5Baseline)?.cursor === 0
        && savedPickupCursor(r5Baseline)?.cursor === 0
        && savedPlayerDropCursor(r5Baseline)?.cursor === 0
        && JSON.stringify(canonicalSavedEdits(r5Baseline.storage))
          === JSON.stringify(creationEdits.canonical)
        && JSON.stringify(r5Baseline.storage.save.inventory)
          === JSON.stringify(grassCreationBaseline.storage.save.inventory)
        && r5Baseline.storage.save.selected === GENERIC_GRASS_ACTION_WORLD_FIXTURE.initialSelectedSlot
        && exactStarterStack(selectedSavedStack(r5Baseline))
        && (r5Baseline.storage.save.drops ?? []).length === 0,
      "Trusted Grass targeting changed the exact no-receipt Survival baseline.");
      const grassWriteOrdinal = r5Baseline.audit?.nextWriteOrdinal ?? 0;
      await captureScreenshot(
        page, options.repositoryRoot, options.outputDirectory, screenshots, "02-before-natural-grass-mine",
      );
      const recoveryScenario = options.scenario === GENERIC_GRASS_RECOVERY_SCENARIO;
      if (recoveryScenario) {
        await installOneShotWorldDocumentWriteFailure(page, r5Baseline.storage.activeWorldId, 1);
        nativeBlockEditFailureWrapperInstalled = true;
      }
      const releaseGrassMine = await beginTrustedTouchAction(
        page, cdp, "Harvest or attack", 22,
      );
      let grassDropId = null;
      let inputProof = null;
      if (recoveryScenario) {
        try {
          nativeBlockEditRecoveryPending = await waitForPendingNativeBlockEditFinalize(
            "generic-grass-local-save-failure", 1,
          );
        } finally {
          await releaseGrassMine().catch(() => undefined);
        }
        await tapPublicPauseControl(page);
        await page.getByRole("heading", { name: "Game Paused" }).waitFor();
        nativeBlockEditRecoveryPaused = await readAndRecord("paused-pending-generic-grass-recovery");
        assertCondition(
          nativeBlockEditRecoveryPaused?.runtime?.playerAuthority?.nativeBlockEditFinalize?.attempts === 1
            && savedCursor(nativeBlockEditRecoveryPaused)?.cursor === 0
            && projectedCursor(nativeBlockEditRecoveryPaused)?.cursor === 1
            && pumpDiagnostics(nativeBlockEditRecoveryPaused)?.nativeBlockEditCursor === 0
            && pumpDiagnostics(nativeBlockEditRecoveryPaused)?.pendingNativeBlockEditSequence === 1,
          "Pausing did not preserve the exact pending native block-edit recovery boundary.",
        );
        nativeBlockEditRecoveryInjection = await restoreOneShotWorldDocumentWriteFailure(page);
        nativeBlockEditFailureWrapperInstalled = false;
        const failedWrite = nativeBlockEditRecoveryInjection.events
          .find((event) => event.outcome === "injected-failure");
        const generatedDrops = (failedWrite?.save?.drops ?? []).filter((drop) => (
          !(r5Baseline.storage.save.drops ?? []).some((prior) => prior.rustEntityId === drop.rustEntityId)
        ));
        assertCondition(generatedDrops.length === 1
          && exactNativePlainDropFromSave(
            generatedDrops[0],
            GENERIC_GRASS_ACTION_WORLD_FIXTURE.generatedDrop.item,
            GENERIC_GRASS_ACTION_WORLD_FIXTURE.generatedDrop.count,
          ), "Injected failure did not expose the exact projected Meadow Grass drop attempt.");
        grassDropId = generatedDrops[0].rustEntityId;
        afterAcquisitionMine = nativeBlockEditRecoveryPaused;
        nativeDropHotTransformEvidence.push(assertNativeDropHotTransformSample(
          afterAcquisitionMine, grassDropId,
        ));
        inputProof = assertTrustedGenericMineInput(afterAcquisitionMine.audit);
        await captureScreenshot(
          page, options.repositoryRoot, options.outputDirectory, screenshots,
          "03-pending-generic-grass-local-save-recovery",
        );
      } else {
        try { afterAcquisitionMine = await waitForCursor("generic-grass-mine", 1, 60_000); }
        finally { await releaseGrassMine().catch(() => undefined); }
        afterAcquisitionMine = await waitForButtonReleased(
          "generic-grass-mine-release", PRIMARY_ATTACK_BUTTON, 1,
        );
        assertCondition(savedPickupCursor(afterAcquisitionMine)?.cursor === 0
          && savedPlayerDropCursor(afterAcquisitionMine)?.cursor === 0,
        "Generic Grass mine changed a pickup or player-drop cursor.");
        acquisitionMineEvidence = assertGenericNativeBlockEditTransaction({
          action: "mine",
          before: r5Baseline,
          after: afterAcquisitionMine,
          auditWrites: afterAcquisitionMine.audit.worldDocumentWrites,
          firstAuditOrdinal: grassWriteOrdinal,
          expectedCoordinate: GENERIC_GRASS_ACTION_WORLD_FIXTURE.naturalMeadowGrassCoordinate,
          expectedSelectedSlot: GENERIC_GRASS_ACTION_WORLD_FIXTURE.initialSelectedSlot,
          expectedSelectedStackBefore: GENERIC_GRASS_ACTION_WORLD_FIXTURE.starterStack,
          expectedSelectedStackAfter: GENERIC_GRASS_ACTION_WORLD_FIXTURE.starterStack,
          ...GENERIC_GRASS_ACTION_WORLD_FIXTURE.expectedBlockTransition,
          expectedGeneratedDrop: GENERIC_GRASS_ACTION_WORLD_FIXTURE.generatedDrop,
          requireInventoryDocumentUnchanged: true,
          requireRustAuthoredDirtySet: true,
        });
        grassDropId = acquisitionMineEvidence.generatedDrop.rustEntityId;
        let previousGrassHotTransform = null;
        for (let sampleIndex = 0; sampleIndex < 3; sampleIndex += 1) {
          if (sampleIndex > 0) {
            afterAcquisitionMine = await waitForNativeDropHotTransformAdvance(
              `generic-grass-native-drop-hot-transform-${sampleIndex + 1}`,
              grassDropId,
              previousGrassHotTransform,
            );
          }
          previousGrassHotTransform = assertNativeDropHotTransformSample(
            afterAcquisitionMine,
            grassDropId,
            previousGrassHotTransform,
          );
          nativeDropHotTransformEvidence.push(previousGrassHotTransform);
          assertCondition(savedPickupCursor(afterAcquisitionMine)?.cursor === 0,
            "Generated Meadow Grass drop was picked up before persistence evidence.");
        }
        inputProof = assertTrustedGenericMineInput(afterAcquisitionMine.audit);
        await captureScreenshot(
          page, options.repositoryRoot, options.outputDirectory, screenshots, "03-after-natural-grass-mine",
        );

        await tapPublicPauseControl(page);
        await page.getByRole("heading", { name: "Game Paused" }).waitFor();
        const paused = await readAndRecord("paused-after-generic-grass-mine");
        assertR5BasicDirtCheckpoint(
          paused, options.expectedArtifactHash, "paused-after-generic-grass-mine", "paused",
        );
        assertCondition(savedCursor(paused)?.cursor === 1
          && savedPickupCursor(paused)?.cursor === 0
          && savedPlayerDropCursor(paused)?.cursor === 0
          && (paused.storage.save.drops ?? []).some((drop) => drop.rustEntityId === grassDropId),
        "Paused generic Meadow Grass state lost its exact edit or native drop custody.");
        await captureScreenshot(
          page, options.repositoryRoot, options.outputDirectory, screenshots, "04-paused-generic-grass",
        );
      }
      if (recoveryScenario) {
        nativeBlockEditRecoverySaveQuitMarker = await recordPendingSaveAndQuitMarker(page);
      }
      await page.getByRole("button", { name: "Save & Quit to Title" }).click({ noWaitAfter: true });
      const continueAfterGrassSave = page.getByRole("button", { name: /^Continue\b/u });
      await continueAfterGrassSave.waitFor({ timeout: 120_000 });
      await waitForCompleteTitleMenu(page, 120_000);
      titleAfterSave = await readAndRecord("title-after-generic-grass-save");
      if (recoveryScenario) {
        nativeBlockEditRecoveryEvidence = assertGenericNativeBlockEditRecoveryTransaction({
          before: r5Baseline,
          pending: nativeBlockEditRecoveryPaused,
          titleAfterSave,
          failureInjection: nativeBlockEditRecoveryInjection,
          saveQuitMarker: nativeBlockEditRecoverySaveQuitMarker,
          auditWrites: titleAfterSave.audit.worldDocumentWrites,
          firstAuditOrdinal: grassWriteOrdinal,
          expectedCoordinate: GENERIC_GRASS_ACTION_WORLD_FIXTURE.naturalMeadowGrassCoordinate,
          ...GENERIC_GRASS_ACTION_WORLD_FIXTURE.expectedBlockTransition,
          expectedSelectedSlot: GENERIC_GRASS_ACTION_WORLD_FIXTURE.initialSelectedSlot,
          expectedSelectedStack: GENERIC_GRASS_ACTION_WORLD_FIXTURE.starterStack,
          expectedGeneratedDrop: GENERIC_GRASS_ACTION_WORLD_FIXTURE.generatedDrop,
          requireRustAuthoredDirtySet: true,
        });
        acquisitionMineEvidence = nativeBlockEditRecoveryEvidence;
        assertCondition(nativeBlockEditRecoveryEvidence.generatedDrop.rustEntityId === grassDropId,
          "Recovery evidence changed the generated native drop identity.");
      }
      assertCondition(titleAfterSave.state?.state === "title"
        && savedCursor(titleAfterSave)?.cursor === 1
        && savedPickupCursor(titleAfterSave)?.cursor === 0
        && savedPlayerDropCursor(titleAfterSave)?.cursor === 0
        && titleAfterSave.storage.save.selected === GENERIC_GRASS_ACTION_WORLD_FIXTURE.initialSelectedSlot
        && exactStarterStack(selectedSavedStack(titleAfterSave))
        && (titleAfterSave.storage.save.drops ?? []).filter((drop) => (
          drop.rustEntityId === grassDropId
            && exactNativePlainDropFromSave(
              drop,
              GENERIC_GRASS_ACTION_WORLD_FIXTURE.generatedDrop.item,
              GENERIC_GRASS_ACTION_WORLD_FIXTURE.generatedDrop.count,
            )
        )).length === 1,
      "Save & Quit did not retain the exact generic Meadow Grass edit and drop custody.");
      const grassDropWrite = [...(titleAfterSave.audit?.worldDocumentWrites ?? [])]
        .reverse()
        .find((write) => write?.save?.rustNativeBlockEditProjection?.cursor === 1
          && write.save?.rustNativeDropPickupProjection?.cursor === 0
          && write.save?.rustNativePlayerDropProjection?.cursor === 0
          && write.save?.drops?.some((drop) => drop.rustEntityId === grassDropId));
      assertCondition(grassDropWrite,
        "Meadow Grass Save & Quit produced no audited durable row for its native drop.");
      durableNativeDropHotTransformEvidence = assertSavedNativeDropMatchesHotTransform(
        grassDropWrite,
        grassDropId,
        {
          expectedItem: GENERIC_GRASS_ACTION_WORLD_FIXTURE.generatedDrop.item,
          expectedCount: GENERIC_GRASS_ACTION_WORLD_FIXTURE.generatedDrop.count,
        },
      );
      assertCondition(
        BigInt(durableNativeDropHotTransformEvidence.extractionRevision)
          >= BigInt(nativeDropHotTransformEvidence.at(-1).extractionRevision)
        && BigInt(durableNativeDropHotTransformEvidence.authorityTick)
          >= BigInt(nativeDropHotTransformEvidence.at(-1).authorityTick)
        && BigInt(durableNativeDropHotTransformEvidence.inventoryDomainRevision)
          >= BigInt(nativeDropHotTransformEvidence.at(-1).inventoryDomainRevision)
        && BigInt(durableNativeDropHotTransformEvidence.entityRevision)
          >= BigInt(nativeDropHotTransformEvidence.at(-1).entityRevision)
        && BigInt(durableNativeDropHotTransformEvidence.ageTicks)
          >= BigInt(nativeDropHotTransformEvidence.at(-1).ageTicks),
      "Grass Save & Quit serialized a stale native drop hot-transform frame.");
      await captureScreenshot(
        page, options.repositoryRoot, options.outputDirectory, screenshots,
        recoveryScenario
          ? "04-title-after-generic-grass-recovery-save"
          : "05-title-after-generic-grass-save",
        screenshotRasterChecks,
      );

      await page.reload({
        waitUntil: "domcontentloaded",
        timeout: Math.min(options.timeoutMilliseconds, 120_000),
      });
      assertCondition(new URL(page.url()).searchParams.get("experimental.rust-live-player-authority") === "r5",
        "Generic Grass full reload lost the explicit R5 player-authority selector.");
      await waitForHarness(page, options.timeoutMilliseconds);
      const freshGrassContinue = page.getByRole("button", { name: /^Continue\b/u });
      await freshGrassContinue.waitFor({ timeout: 120_000 });
      await waitForCompleteTitleMenu(page, 120_000);
      titleAfterReload = await readAndRecord("title-after-generic-grass-reload");
      assertCondition(titleAfterReload.state?.state === "title"
        && exactSavedRestorationShape(titleAfterReload) === exactSavedRestorationShape(titleAfterSave),
      "Full reload changed the exact saved generic Meadow Grass document before Continue.");
      await captureScreenshot(
        page, options.repositoryRoot, options.outputDirectory, screenshots,
        recoveryScenario
          ? "05-title-after-generic-grass-recovery-reload"
          : "06-title-after-generic-grass-reload",
        screenshotRasterChecks,
      );
      await freshGrassContinue.click({ noWaitAfter: true });
      continued = await waitForGameplay("fresh-generic-grass-continue", true);
      terrainReadiness.restored = await waitForRustMultiplayerVisualTerrainReadiness(
        page,
        Math.min(options.timeoutMilliseconds, 180_000),
        { label: "generic-grass-restored" },
      );
      const liveEmptyCellEvidence = await aimThroughExpectedEmptyCell(
        page,
        cdp,
        readAndRecord,
        GENERIC_GRASS_ACTION_WORLD_FIXTURE.naturalMeadowGrassCoordinate,
        "Grass",
      );
      restorationEvidence = assertGenericNativeBlockEditFreshRestoration({
        titleAfterSave,
        titleAfterReload,
        continued,
        coordinate: GENERIC_GRASS_ACTION_WORLD_FIXTURE.naturalMeadowGrassCoordinate,
        expectedCursor: 1,
        expectedPickupCursor: 0,
        expectedPlayerDropCursor: 0,
        expectedSelectedSlot: GENERIC_GRASS_ACTION_WORLD_FIXTURE.initialSelectedSlot,
        expectedSelectedStack: GENERIC_GRASS_ACTION_WORLD_FIXTURE.starterStack,
        expectedRestoredBlockId: GENERIC_GRASS_ACTION_WORLD_FIXTURE.expectedBlockTransition.expectedBlockId,
        expectedDrop: GENERIC_GRASS_ACTION_WORLD_FIXTURE.generatedDrop,
        expectedDropId: grassDropId,
        liveEmptyCellEvidence,
      });
      await captureScreenshot(
        page, options.repositoryRoot, options.outputDirectory, screenshots,
        recoveryScenario
          ? "06-fresh-generic-grass-recovery-restoration"
          : "07-fresh-generic-grass-restoration",
      );

      assertCondition(routeRequests.some((request) => request.status === 200
        && request.pathname?.startsWith(`/engine/${options.expectedArtifactHash}/`)),
      "No successful request loaded the exact expected content-addressed candidate artifact.");
      assertBasicDirtBrowserErrorStreams(streams);
      const immutableEvidence = assertBasicDirtCandidateAndCanonicalUnchanged(selection);
      result = {
        schema: 2,
        gate: recoveryScenario
          ? "blockwild-rust-generic-grass-block-edit-recovery-browser-v1"
          : "blockwild-rust-generic-grass-block-edit-browser-v2",
        status: "passed",
        createdAt: new Date().toISOString(),
        authorityClaim: recoveryScenario
          ? "rust-generic-native-block-edit-local-save-failure-custody-save-and-quit-drain-retry-acknowledgment-and-fresh-restoration-for-one-exact-survival-meadow-grass-mine-candidate-only"
          : "rust-generic-native-block-edit-receipt-and-dirty-set-authority-for-one-exact-survival-meadow-grass-mine-generated-self-drop-and-durable-browser-projection-candidate-only",
        selector: "experimental.rust-live-player-authority=r5",
        scenario: options.scenario,
        artifact: {
          hash: options.expectedArtifactHash,
          directory: EXPECTED_ENGINE_RELATIVE_DIRECTORY,
          sourceSnapshot: immutableEvidence.sourceSnapshot,
          candidateTreeSnapshot: immutableEvidence.candidateTreeSnapshot,
          canonicalTreeSnapshot: immutableEvidence.canonicalTreeSnapshot,
          routeRequests,
        },
        fixture: GENERIC_GRASS_ACTION_WORLD_FIXTURE,
        target: targetEvidence,
        mine: acquisitionMineEvidence,
        nativeDropHotTransforms: {
          liveSamples: nativeDropHotTransformEvidence,
          durableSave: durableNativeDropHotTransformEvidence,
        },
        restoration: restorationEvidence,
        recovery: nativeBlockEditRecoveryEvidence,
        inputProof,
        terrainReadiness,
        checkpoints: {
          created: grassCreationBaseline,
          beforeMine: r5Baseline,
          afterMine: afterAcquisitionMine,
          pendingAfterInjectedFailure: nativeBlockEditRecoveryPending,
          pausedPendingRecovery: nativeBlockEditRecoveryPaused,
          titleAfterSave,
          titleAfterReload,
          continued,
        },
        harness: {
          baseUrl: managedServer.baseUrl,
          managedVite: true,
          hmr: managedServer.inlineConfig.server.hmr,
          watch: "ignore-all",
          preparationRouteSearch: "experimental.rust-live-player-authority=r5",
          authorityRouteSelector: "r5",
          inputMode: targetEvidence.inputMode,
          browserProfileToken: path.basename(profileDirectory),
          browserExecutable: browserExecutable ?? "playwright-managed",
          playwrightSource: playwright.source,
          browserGateMutex: browserMutexEvidence,
        },
        coverage: {
          realUiSurvivalNativeCreation: "passed",
          exactNaturalMeadowGrassTarget: "passed",
          genericNativeBlockEditReceiptStream: "passed",
          exactMeadowGrassToAirFacingZeroTransition: "passed",
          exactNoOpPlayerInventoryDocumentAndSelectedStack: "passed",
          exactGeneratedNativeMeadowGrassDrop: "passed",
          rustDrivenNativeDropHotTransforms: "passed",
          acceptedHotTransformDurableSave: "passed",
          trustedPublicTouchMovementTargetingAndMine: "passed",
          rustAuthoredDirtySetProjection: "passed",
          nativeCheckpointBeforeProjection: "passed",
          receiptBoundDocumentBeforeAck: "passed",
          noOldCursorOptimisticDocumentMutation: "passed",
          ...(recoveryScenario ? {
            oneShotActiveWorldDocumentFailure: "passed",
            exactPreReceiptDocumentRollback: "passed",
            pendingReceiptAndCheckpointCustody: "passed",
            saveAndQuitLifecycleDrainRetry: "passed",
            retryWriteBeforeReceiptAcknowledgment: "passed",
            settledWriteAfterReceiptAcknowledgment: "passed",
          } : {}),
          realSaveAndQuit: "passed",
          fullPageReloadAndFreshContinue: "passed",
          exactAirEditAndDropRestoration: "passed",
          currentSourceCandidateUnchanged: "passed",
          canonicalPublicEngineUnchanged: "passed",
        },
        screenshots,
        screenshotRasterChecks,
        canonicalAssetRequests,
        errors: streams,
        cleanup,
        exclusions: {
          broaderBlockEdits: "This bounded gate proves one exact natural Meadow Grass mine and its generated self-drop; placement, other blocks, shapes, topology, durability, luck, quests, and multiplayer consequences remain outside the claim.",
          canonicalPromotion: "The isolated candidate is tested without modifying or promoting canonical public/engine.",
          mutationSurface: recoveryScenario
            ? "Setup and the action use the real UI plus trusted public touch controls. The gate wraps only the active browser document write once to inject a storage failure, then restores the original method before Save & Quit; no world mutation or test-only engine hook is called."
            : "Setup and the one action use the real UI plus trusted public touch controls. Evidence reads public text diagnostics and the production WorldStorage document; no world mutation or test-only engine hook is called.",
        },
      };
    } else {
    await moveToAcquisitionVantage(r5Baseline);
    const acquisitionAim = await aimAtExpectedNaturalDirt(
      page, cdp, readAndRecord, BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate,
    );
    targetEvidence = acquisitionAim;
    r5Baseline = acquisitionAim.snapshot;
    assertR5BasicDirtCheckpoint(r5Baseline, options.expectedArtifactHash, "before-acquisition-mine");
    assertCondition(savedCursor(r5Baseline)?.cursor === 0
      && savedPickupCursor(r5Baseline)?.cursor === 0
      && JSON.stringify(canonicalSavedEdits(r5Baseline.storage))
        === JSON.stringify(creationEdits.canonical)
      && (r5Baseline.storage.save.drops ?? []).length === 0
      && exactStarterStack(selectedSavedStack(r5Baseline)),
    "Trusted targeting changed the bounded Survival acquisition baseline.");
    const acquisitionWriteOrdinal = r5Baseline.audit?.nextWriteOrdinal ?? 0;
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "02-before-natural-dirt-mine");
    const releaseAcquisitionMine = await beginTrustedTouchAction(
      page, cdp, "Harvest or attack", 22,
    );
    try { afterAcquisitionMine = await waitForCursor("acquisition-mine", 1, 60_000); }
    finally { await releaseAcquisitionMine().catch(() => undefined); }
    afterAcquisitionMine = await waitForButtonReleased(
      "acquisition-mine-release", PRIMARY_ATTACK_BUTTON, 1,
    );
    assertCondition(savedPickupCursor(afterAcquisitionMine)?.cursor === 0,
      "Natural Dirt auto-picked up before its exact mined-drop boundary could be evidenced.");
    acquisitionMineEvidence = assertBasicDirtActionTransaction({
      action: "mine",
      before: r5Baseline,
      after: afterAcquisitionMine,
      auditWrites: afterAcquisitionMine.audit.worldDocumentWrites,
      firstAuditOrdinal: acquisitionWriteOrdinal,
      expectedCoordinate: BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate,
      expectedSelectedSlot: BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot,
      expectedSelectedStackBefore: BASIC_DIRT_ACTION_WORLD_FIXTURE.starterStack,
      expectedSelectedStackAfter: BASIC_DIRT_ACTION_WORLD_FIXTURE.starterStack,
    });
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "03-after-natural-dirt-mine");

    const acquiredDropId = acquisitionMineEvidence.generatedDrop.rustEntityId;
    const pickupWriteOrdinal = afterAcquisitionMine.audit?.nextWriteOrdinal ?? 0;
    afterPickup = await moveIntoNativeDrop(afterAcquisitionMine, acquiredDropId);
    pickupEvidence = assertNativeDirtPickupTransaction({
      before: afterAcquisitionMine,
      after: afterPickup,
      auditWrites: afterPickup.audit.worldDocumentWrites,
      firstAuditOrdinal: pickupWriteOrdinal,
      expectedRustEntityId: acquiredDropId,
    });
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "04-after-native-dirt-pickup");

    const away = await moveAwayFromDirtCell(
      afterPickup, BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate,
    );
    await tapPublicHotbarSlot(page, BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot);
    const selectedDirt = await waitForSelectedDirtSlot(away);
    assertCondition(savedCursor(selectedDirt)?.cursor === 1
      && savedPickupCursor(selectedDirt)?.cursor === 1,
    "Real hotbar selection changed a native receipt cursor.");
    const placementAim = await aimThroughExpectedEmptyCell(
      page, cdp, readAndRecord, BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate,
    );
    const placeBaseline = placementAim.snapshot;
    const savedSelectionBeforePlace = placeBaseline.storage?.save?.selected;
    const savedSelectionLagged = savedSelectionBeforePlace
      === BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot
      && exactStarterStack(selectedSavedStack(placeBaseline));
    const savedSelectionCaughtUp = savedSelectionBeforePlace
      === BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot
      && exactPlainDirtStack(selectedSavedStack(placeBaseline), 1);
    assertCondition((savedSelectionLagged || savedSelectionCaughtUp)
      && exactStarterStack(savedStackAt(placeBaseline, BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot))
      && exactPlainDirtStack(savedStackAt(placeBaseline, BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot), 1)
      && savedCursor(placeBaseline)?.cursor === 1
      && savedPickupCursor(placeBaseline)?.cursor === 1,
    "Placement baseline is neither the exact lagging nor caught-up selected-slot save state.");
    const placeWriteOrdinal = placeBaseline.audit?.nextWriteOrdinal ?? 0;
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "05-before-return-placement");
    const releasePlace = await beginTrustedTouchAction(
      page, cdp, "Use, place, or raise shield", 23,
    );
    try { afterPlace = await waitForCursor("return-place", 2); }
    finally { await releasePlace().catch(() => undefined); }
    afterPlace = await waitForButtonReleased("return-place-release", SECONDARY_USE_BUTTON, 2);
    placeEvidence = assertBasicDirtActionTransaction({
      action: "place",
      before: placeBaseline,
      after: afterPlace,
      auditWrites: afterPlace.audit.worldDocumentWrites,
      firstAuditOrdinal: placeWriteOrdinal,
      expectedCoordinate: BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate,
      expectedSelectedSlot: BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot,
      expectedSelectedStackBefore: BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtStack,
      expectedSelectedStackAfter: null,
      expectedSavedSelectedSlotBefore: savedSelectionBeforePlace,
      expectedSavedSelectedStackBefore: savedSelectionLagged
        ? BASIC_DIRT_ACTION_WORLD_FIXTURE.starterStack
        : BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtStack,
    });
    assertCondition(savedPickupCursor(afterPlace)?.cursor === 1,
      "Dirt placement changed the native pickup cursor.");
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "06-after-return-placement");

    const retargetDeadline = Date.now() + 10_000;
    let retargeted = afterPlace;
    while (Date.now() < retargetDeadline) {
      const target = retargeted?.state?.target;
      if (target?.type === "block" && target.name === "Dirt"
        && JSON.stringify(target.position)
          === JSON.stringify(BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate)) break;
      await page.waitForTimeout(50);
      retargeted = await readAndRecord("retarget-returned-dirt");
    }
    assertCondition(retargeted?.state?.target?.name === "Dirt"
      && JSON.stringify(retargeted.state.target.position)
        === JSON.stringify(BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate),
    "Unchanged trusted ray did not retarget the returned Dirt cell.");
    const finalMineBaseline = await readAndRecord("before-final-mine");
    const finalMineWriteOrdinal = finalMineBaseline.audit?.nextWriteOrdinal ?? 0;
    const releaseFinalMine = await beginTrustedTouchAction(page, cdp, "Harvest or attack", 24);
    try { afterFinalMine = await waitForCursor("final-mine", 3, 60_000); }
    finally { await releaseFinalMine().catch(() => undefined); }
    afterFinalMine = await waitForButtonReleased("final-mine-release", PRIMARY_ATTACK_BUTTON, 3);
    finalMineEvidence = assertBasicDirtActionTransaction({
      action: "mine",
      before: finalMineBaseline,
      after: afterFinalMine,
      auditWrites: afterFinalMine.audit.worldDocumentWrites,
      firstAuditOrdinal: finalMineWriteOrdinal,
      expectedCoordinate: BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate,
      expectedSelectedSlot: BASIC_DIRT_ACTION_WORLD_FIXTURE.acquiredDirtSlot,
      expectedSelectedStackBefore: null,
      expectedSelectedStackAfter: null,
    });
    assertCondition(savedPickupCursor(afterFinalMine)?.cursor === 1
      && finalMineEvidence.generatedDrop.rustEntityId !== acquiredDropId,
    "Final mine reused the consumed pickup source or changed the pickup cursor.");
    const finalDropId = finalMineEvidence.generatedDrop.rustEntityId;
    let previousHotTransform = null;
    for (let sampleIndex = 0; sampleIndex < 3; sampleIndex += 1) {
      if (sampleIndex > 0) {
        afterFinalMine = await waitForNativeDropHotTransformAdvance(
          `final-native-drop-hot-transform-${sampleIndex + 1}`,
          finalDropId,
          previousHotTransform,
        );
      }
      previousHotTransform = assertNativeDropHotTransformSample(
        afterFinalMine,
        finalDropId,
        previousHotTransform,
      );
      nativeDropHotTransformEvidence.push(previousHotTransform);
      assertCondition(savedPickupCursor(afterFinalMine)?.cursor === 1,
        "Final native Dirt drop was picked up while collecting hot-transform evidence.");
    }
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "07-after-final-native-drop");
    const inputProof = assertTrustedBasicDirtActionInputs(afterFinalMine.audit);

    await tapPublicPauseControl(page);
    await page.getByRole("heading", { name: "Game Paused" }).waitFor();
    const paused = await readAndRecord("paused-after-actions");
    assertR5BasicDirtCheckpoint(paused, options.expectedArtifactHash, "paused-after-actions", "paused");
    assertCondition(savedCursor(paused)?.cursor === 3 && savedPickupCursor(paused)?.cursor === 1,
      "Paused final state lost an action or pickup receipt cursor.");
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "08-paused-before-save");
    await page.getByRole("button", { name: "Save & Quit to Title" }).click({ noWaitAfter: true });
    const continueAfterSave = page.getByRole("button", { name: /^Continue\b/u });
    await continueAfterSave.waitFor({ timeout: 120_000 });
    await waitForCompleteTitleMenu(page, 120_000);
    titleAfterSave = await readAndRecord("title-after-save");
    assertCondition(titleAfterSave.state?.state === "title"
      && savedCursor(titleAfterSave)?.cursor === 3
      && savedPickupCursor(titleAfterSave)?.cursor === 1,
    "Save & Quit did not retain the three-action and one-pickup cursors.");
    const finalDropWrite = [...(titleAfterSave.audit?.worldDocumentWrites ?? [])]
      .reverse()
      .find((write) => write?.save?.rustNativeBlockEditProjection?.cursor === 3
        && write.save?.rustNativeDropPickupProjection?.cursor === 1
        && write.save?.drops?.some((drop) => drop.rustEntityId === finalDropId));
    assertCondition(finalDropWrite,
      "Save & Quit produced no audited durable row for the final native Dirt drop.");
    durableNativeDropHotTransformEvidence = assertSavedNativeDropMatchesHotTransform(
      finalDropWrite,
      finalDropId,
    );
    assertCondition(
      BigInt(durableNativeDropHotTransformEvidence.extractionRevision)
        >= BigInt(nativeDropHotTransformEvidence.at(-1).extractionRevision)
      && BigInt(durableNativeDropHotTransformEvidence.authorityTick)
        >= BigInt(nativeDropHotTransformEvidence.at(-1).authorityTick)
      && BigInt(durableNativeDropHotTransformEvidence.entityRevision)
        >= BigInt(nativeDropHotTransformEvidence.at(-1).entityRevision)
      && BigInt(durableNativeDropHotTransformEvidence.ageTicks)
        >= BigInt(nativeDropHotTransformEvidence.at(-1).ageTicks),
    "Save & Quit serialized an older native drop transform than the last accepted live frame.");
    await captureScreenshot(
      page, options.repositoryRoot, options.outputDirectory, screenshots, "09-title-after-save", screenshotRasterChecks,
    );

    await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(options.timeoutMilliseconds, 120_000) });
    assertCondition(new URL(page.url()).searchParams.get("experimental.rust-live-player-authority") === "r5",
      "Full page reload lost the explicit R5 player-authority selector.");
    await waitForHarness(page, options.timeoutMilliseconds);
    const freshContinue = page.getByRole("button", { name: /^Continue\b/u });
    await freshContinue.waitFor({ timeout: 120_000 });
    await waitForCompleteTitleMenu(page, 120_000);
    titleAfterReload = await readAndRecord("title-after-full-reload");
    assertCondition(titleAfterReload.state?.state === "title",
      "Full page reload did not return to the production title.");
    await captureScreenshot(
      page, options.repositoryRoot, options.outputDirectory, screenshots, "10-title-after-reload", screenshotRasterChecks,
    );
    await freshContinue.click({ noWaitAfter: true });
    continued = await waitForGameplay("fresh-continue", true);
    terrainReadiness.restored = await waitForRustMultiplayerVisualTerrainReadiness(
      page, Math.min(options.timeoutMilliseconds, 180_000), { label: "basic-dirt-restored" },
    );
    const liveEmptyCellEvidence = await aimThroughExpectedEmptyCell(
      page,
      cdp,
      readAndRecord,
      BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate,
      "Dirt",
    );
    restorationEvidence = assertBasicDirtFreshRestoration({
      titleAfterSave,
      titleAfterReload,
      continued,
      coordinate: BASIC_DIRT_ACTION_WORLD_FIXTURE.naturalDirtCoordinate,
      acquiredDropId,
      liveEmptyCellEvidence,
    });
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "11-fresh-restoration");

    const playerDropAppliedInputsBefore = pumpDiagnostics(continued)?.appliedInputs;
    assertCondition(Number.isSafeInteger(playerDropAppliedInputsBefore),
      "Fresh restoration omitted the authoritative applied-input baseline.");
    await tapPublicHotbarSlot(page, BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot);
    // A restored native checkpoint may already own the serialized pump tail.
    // Wait for the exact post-click input acknowledgement rather than treating
    // the immediate compatibility selection as authoritative custody.
    const playerDropSelectionDeadline = Date.now()
      + Math.min(options.timeoutMilliseconds, 120_000);
    while (Date.now() < playerDropSelectionDeadline) {
      await advanceAuthority();
      playerDropBaseline = await readAndRecord("select-starter-player-drop-slot");
      const playerDropPump = pumpDiagnostics(playerDropBaseline);
      if (playerDropBaseline.state?.inventory?.selectedSlot === BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot
        && exactStarterStack(playerDropBaseline.state?.inventory?.held)
        && playerDropBaseline.storage?.save?.selected === BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot
        && exactStarterStack(savedStackAt(playerDropBaseline, BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot))
        && playerDropPump?.selectedSlot === BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot
        && Number.isSafeInteger(playerDropPump.appliedInputs)
        && playerDropPump.appliedInputs > playerDropAppliedInputsBefore
        && playerDropPump.lastAppliedButtons === 0
        && playerDropPump.pendingNativeBlockEditSequence === null
        && playerDropPump.pendingDropPickupSequence === null
        && playerDropPump.pendingPlayerDropSequence === null) break;
    }
    const playerDropBaselinePump = pumpDiagnostics(playerDropBaseline);
    assertCondition(playerDropBaseline
      && playerDropBaseline.runtime?.ready === true
      && playerDropBaseline.runtime?.playerAuthority?.state === "ready"
      && playerDropBaseline.runtime.playerAuthority.lastError === null
      && playerDropBaseline.state?.inventory?.selectedSlot === BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot
      && exactStarterStack(playerDropBaseline.state?.inventory?.held)
      && playerDropBaselinePump?.state === "ready"
      && playerDropBaselinePump.lastError === null
      && playerDropBaselinePump.selectedSlot === BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot
      && Number.isSafeInteger(playerDropBaselinePump.appliedInputs)
      && playerDropBaselinePump.appliedInputs > playerDropAppliedInputsBefore
      && playerDropBaselinePump.lastAppliedButtons === 0
      && playerDropBaselinePump.pendingNativeBlockEditSequence === null
      && playerDropBaselinePump.pendingDropPickupSequence === null
      && playerDropBaselinePump.pendingPlayerDropSequence === null
      && playerDropBaseline.storage?.save?.selected === BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot
      && exactStarterStack(savedStackAt(playerDropBaseline, BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot))
      && savedCursor(playerDropBaseline)?.cursor === 3
      && savedPickupCursor(playerDropBaseline)?.cursor === 1
      && savedPlayerDropCursor(playerDropBaseline)?.cursor === 0,
    "Public hotbar selection did not establish the exact starter Moonberry player-drop baseline.");
    const playerDropWriteOrdinal = playerDropBaseline.audit?.nextWriteOrdinal ?? 0;
    await page.keyboard.press("KeyG");
    afterPlayerDrop = await waitForPlayerDropCursor("native-player-drop", 1, 60_000);
    playerDropEvidence = assertNativePlayerDropTransaction({
      before: playerDropBaseline,
      after: afterPlayerDrop,
      auditWrites: afterPlayerDrop.audit.worldDocumentWrites,
      firstAuditOrdinal: playerDropWriteOrdinal,
    });
    const playerDropHotTransform = assertNativeDropHotTransformSample(
      afterPlayerDrop,
      playerDropEvidence.rustEntityId,
    );
    playerDropInputProof = assertTrustedNativePlayerDropInput(afterPlayerDrop.audit);
    assertCondition(savedPickupCursor(afterPlayerDrop)?.cursor === 1,
      "Native player drop was picked up before its durable world-custody boundary was evidenced.");
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "12-native-player-drop");

    await tapPublicPauseControl(page);
    await page.getByRole("heading", { name: "Game Paused" }).waitFor();
    const pausedPlayerDrop = await readAndRecord("paused-native-player-drop");
    assertR5BasicDirtCheckpoint(pausedPlayerDrop, options.expectedArtifactHash, "paused-native-player-drop", "paused");
    assertCondition(savedPlayerDropCursor(pausedPlayerDrop)?.cursor === 1
      && savedPickupCursor(pausedPlayerDrop)?.cursor === 1
      && (pausedPlayerDrop.storage.save.drops ?? [])
        .some((drop) => drop.rustEntityId === playerDropEvidence.rustEntityId),
    "Paused native player-drop state lost its exact world custody or cursor.");
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "13-paused-player-drop");
    await page.getByRole("button", { name: "Save & Quit to Title" }).click({ noWaitAfter: true });
    const continueAfterPlayerDropSave = page.getByRole("button", { name: /^Continue\b/u });
    await continueAfterPlayerDropSave.waitFor({ timeout: 120_000 });
    await waitForCompleteTitleMenu(page, 120_000);
    playerDropTitleAfterSave = await readAndRecord("title-after-player-drop-save");
    assertCondition(playerDropTitleAfterSave.state?.state === "title"
      && savedPlayerDropCursor(playerDropTitleAfterSave)?.cursor === 1
      && savedPickupCursor(playerDropTitleAfterSave)?.cursor === 1
      && exactPlainStack(
        savedStackAt(playerDropTitleAfterSave, BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot),
        { item: BERRY_ITEM_ID, count: 2 },
      )
      && (playerDropTitleAfterSave.storage.save.drops ?? [])
        .some((drop) => drop.rustEntityId === playerDropEvidence.rustEntityId
          && exactNativePlainDropFromSave(drop, BERRY_ITEM_ID)),
    "Save & Quit did not retain the exact native Moonberry world custody and player-drop cursor.");
    const playerDropSaveWrite = [...(playerDropTitleAfterSave.audit?.worldDocumentWrites ?? [])]
      .reverse()
      .find((write) => write?.save?.rustNativePlayerDropProjection?.cursor === 1
        && write.save?.rustNativeDropPickupProjection?.cursor === 1
        && write.save?.drops?.some((drop) => drop.rustEntityId === playerDropEvidence.rustEntityId));
    assertCondition(playerDropSaveWrite,
      "Player-drop Save & Quit produced no audited durable native Moonberry row.");
    playerDropDurableHotTransformEvidence = assertSavedNativeDropMatchesHotTransform(
      playerDropSaveWrite,
      playerDropEvidence.rustEntityId,
      { expectedItem: BERRY_ITEM_ID },
    );
    const auditedPlayerDropDocumentSaves = nativePersistenceDiagnostics({
      runtime: playerDropSaveWrite.runtime,
    })?.saves;
    const playerDropTransactionSaves = playerDropEvidence.nativeCheckpointAfter?.saves;
    assertCondition(Number.isSafeInteger(auditedPlayerDropDocumentSaves)
      && auditedPlayerDropDocumentSaves === playerDropTransactionSaves,
    "Player-drop Save & Quit local document was not based on the exact transaction checkpoint.");
    // Save & Quit requires and awaits one further native checkpoint after this
    // audited local document; the post-reload pickup must then add exactly one.
    await captureScreenshot(
      page, options.repositoryRoot, options.outputDirectory, screenshots,
      "14-title-after-player-drop-save", screenshotRasterChecks,
    );

    await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(options.timeoutMilliseconds, 120_000) });
    assertCondition(new URL(page.url()).searchParams.get("experimental.rust-live-player-authority") === "r5",
      "Player-drop full reload lost the explicit R5 player-authority selector.");
    await waitForHarness(page, options.timeoutMilliseconds);
    const freshPlayerDropContinue = page.getByRole("button", { name: /^Continue\b/u });
    await freshPlayerDropContinue.waitFor({ timeout: 120_000 });
    await waitForCompleteTitleMenu(page, 120_000);
    playerDropTitleAfterReload = await readAndRecord("title-after-player-drop-reload");
    assertCondition(playerDropTitleAfterReload.state?.state === "title"
      && exactSavedRestorationShape(playerDropTitleAfterReload)
        === exactSavedRestorationShape(playerDropTitleAfterSave),
    "Full reload changed the exact saved native player-drop document before Continue.");
    await captureScreenshot(
      page, options.repositoryRoot, options.outputDirectory, screenshots,
      "15-title-after-player-drop-reload", screenshotRasterChecks,
    );
    const playerDropPickupWriteOrdinal = playerDropTitleAfterReload.audit?.nextWriteOrdinal ?? 0;
    await freshPlayerDropContinue.click({ noWaitAfter: true });
    playerDropContinued = await waitForGameplay("fresh-player-drop-continue", true);
    if (savedPickupCursor(playerDropContinued)?.cursor === 2) {
      afterPlayerDropPickup = playerDropContinued;
    } else {
      assertCondition(savedPickupCursor(playerDropContinued)?.cursor === 1
        && (playerDropContinued.state?.drops ?? [])
          .some((drop) => drop.rustEntityId === playerDropEvidence.rustEntityId),
      "Fresh player-drop Continue neither restored the source nor completed its native pickup.");
      afterPlayerDropPickup = await moveIntoNativeDrop(
        playerDropContinued,
        playerDropEvidence.rustEntityId,
        "player-drop-repickup",
      );
    }
    playerDropPickupEvidence = assertNativePlayerDropPickupTransaction({
      before: playerDropTitleAfterReload,
      after: afterPlayerDropPickup,
      auditWrites: afterPlayerDropPickup.audit.worldDocumentWrites,
      firstAuditOrdinal: playerDropPickupWriteOrdinal,
      expectedRustEntityId: playerDropEvidence.rustEntityId,
    });
    assertCondition(savedPlayerDropCursor(afterPlayerDropPickup)?.cursor === 1
      && savedPickupCursor(afterPlayerDropPickup)?.cursor === 2
      && exactStarterStack(savedStackAt(
        afterPlayerDropPickup,
        BASIC_DIRT_ACTION_WORLD_FIXTURE.initialSelectedSlot,
      ))
      && !(afterPlayerDropPickup.storage.save.drops ?? [])
        .some((drop) => drop.rustEntityId === playerDropEvidence.rustEntityId)
      && (afterPlayerDropPickup.storage.save.drops ?? [])
        .some((drop) => drop.rustEntityId === restorationEvidence.nativeDrop.rustEntityId),
    "Player-origin native pickup did not restore the exact Moonberry stack while preserving the Dirt drop.");
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "16-player-drop-repickup");

    assertCondition(routeRequests.some((request) => request.status === 200
      && request.pathname?.startsWith(`/engine/${options.expectedArtifactHash}/`)),
    "No successful request loaded the exact expected content-addressed candidate artifact.");
    assertBasicDirtBrowserErrorStreams(streams);
    const immutableEvidence = assertBasicDirtCandidateAndCanonicalUnchanged(selection);
    result = {
      schema: 2,
      gate: "blockwild-rust-generic-block-edit-and-player-drop-browser-v3",
      status: "passed",
      createdAt: new Date().toISOString(),
      authorityClaim: "rust-generic-native-block-edit-receipt-authority-for-exact-survival-dirt-cycle-and-plain-player-drop-repickup-with-durable-browser-projection-candidate-only",
      selector: "experimental.rust-live-player-authority=r5",
      artifact: {
        hash: options.expectedArtifactHash,
        directory: EXPECTED_ENGINE_RELATIVE_DIRECTORY,
        sourceSnapshot: immutableEvidence.sourceSnapshot,
        candidateTreeSnapshot: immutableEvidence.candidateTreeSnapshot,
        canonicalTreeSnapshot: immutableEvidence.canonicalTreeSnapshot,
        routeRequests,
      },
      fixture: BASIC_DIRT_ACTION_WORLD_FIXTURE,
      target: targetEvidence,
      acquisitionMine: acquisitionMineEvidence,
      pickup: pickupEvidence,
      place: placeEvidence,
      finalMine: finalMineEvidence,
      nativeDropHotTransforms: {
        liveSamples: nativeDropHotTransformEvidence,
        durableSave: durableNativeDropHotTransformEvidence,
      },
      restoration: restorationEvidence,
      playerDrop: {
        transaction: playerDropEvidence,
        hotTransform: playerDropHotTransform,
        durableHotTransform: playerDropDurableHotTransformEvidence,
        inputProof: playerDropInputProof,
        pickup: playerDropPickupEvidence,
      },
      inputProof,
      terrainReadiness,
      checkpoints: {
        r5Baseline,
        afterAcquisitionMine,
        afterPickup,
        afterPlace,
        afterFinalMine,
        titleAfterSave,
        titleAfterReload,
        continued,
        playerDropBaseline,
        afterPlayerDrop,
        playerDropTitleAfterSave,
        playerDropTitleAfterReload,
        playerDropContinued,
        afterPlayerDropPickup,
      },
      harness: {
        baseUrl: managedServer.baseUrl,
        managedVite: true,
        hmr: managedServer.inlineConfig.server.hmr,
        watch: "ignore-all",
        preparationRouteSearch: "experimental.rust-live-player-authority=r5",
        authorityRouteSelector: "r5",
        inputMode: targetEvidence.inputMode,
        browserProfileToken: path.basename(profileDirectory),
        browserExecutable: browserExecutable ?? "playwright-managed",
        playwrightSource: playwright.source,
        browserGateMutex: browserMutexEvidence,
      },
      coverage: {
        realUiSurvivalNativeCreation: "passed",
        genericNativeBlockEditReceiptStream: "passed",
        exactStarterInventoryBootstrap: "passed",
        exactNativeDirtDropPickup: "passed",
        rustDrivenNativeDropHotTransforms: "passed",
        acceptedHotTransformDurableSave: "passed",
        exactNativePlayerDrop: "passed",
        playerDropSaveReloadAndNativeRepickup: "passed",
        playerOriginPickupReceipt: "passed",
        explicitAcquiredDirtHotbarSelection: "passed",
        trustedPublicTouchTargeting: "passed",
        trustedPublicTouchPlacement: "passed",
        trustedHeldPublicTouchMiningTwice: "passed",
        trustedPublicTouchPickupMovement: "passed",
        nativeCheckpointBeforeEachProjection: "passed",
        receiptBoundDocumentBeforeEachAck: "passed",
        noOldCursorOptimisticDocumentMutation: "passed",
        exactCellInventoryDropAndCursorPersistence: "passed",
        realSaveAndQuit: "passed",
        fullPageReloadAndFreshContinue: "passed",
        currentSourceCandidateUnchanged: "passed",
        canonicalPublicEngineUnchanged: "passed",
      },
      screenshots,
      screenshotRasterChecks,
      canonicalAssetRequests,
      errors: streams,
      cleanup,
      exclusions: {
        broaderR5Authority: "This bounded gate proves only the exact Survival Dirt mine/pickup/place/mine loop plus one plain Moonberry player-drop/save/reload/re-pickup loop; other items and player actions remain outside the claim.",
        canonicalPromotion: "The isolated candidate is tested without modifying or promoting canonical public/engine.",
        mutationSurface: "Setup and actions use the real UI plus trusted public touch and keyboard controls. Evidence reads public text diagnostics and the production WorldStorage document; no world mutation or test-only engine hook is called.",
      },
    };
    }
  } catch (error) {
    if (page) {
      const failedPath = path.join(options.outputDirectory, "failed.png");
      await page.screenshot({ path: failedPath, type: "png" }).then(() => {
        screenshots.failed = relativeEvidencePath(options.repositoryRoot, failedPath);
      }).catch(() => undefined);
    }
    result = {
      schema: 2,
      gate: isGenericShapedPropScenario(options.scenario)
        ? "blockwild-rust-generic-shaped-prop-browser-v1"
        : options.scenario === GENERIC_GRASS_RECOVERY_SCENARIO
          ? "blockwild-rust-generic-grass-block-edit-recovery-browser-v1"
          : isGenericGrassScenario(options.scenario)
            ? "blockwild-rust-generic-grass-block-edit-browser-v2"
            : "blockwild-rust-generic-block-edit-and-player-drop-browser-v3",
      status: "failed",
      createdAt: new Date().toISOString(),
      authorityClaim: "none",
      scenario: options.scenario,
      artifact: { hash: options.expectedArtifactHash, directory: EXPECTED_ENGINE_RELATIVE_DIRECTORY },
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      errorDetails: error instanceof RustEngineToolError ? cloneJson(error.details) ?? null : null,
      browserGateMutex: browserMutexEvidence,
      target: targetEvidence,
      acquisitionMine: acquisitionMineEvidence,
      nativeBlockEditRecovery: nativeBlockEditRecoveryEvidence,
      nativeBlockEditRecoveryInjection,
      shapedProp: {
        creativeCatalogSelection: shapedPropCatalogSelection,
        creativeFlight: shapedPropCreativeFlightEvidence,
        placementTarget: shapedPropPlacementAim,
        placement: shapedPropPlacementEvidence,
        titleAfterCreativeSave: shapedPropTitleAfterCreativeSave,
        titleAfterModeChange: shapedPropTitleAfterModeChange,
        modeEditorEvidence: shapedPropModeEditorEvidence,
        modeTransition: shapedPropModeTransitionEvidence,
        survivalLoaded: shapedPropSurvivalLoaded,
        survivalMineTarget: shapedPropMineAim,
        inputProof: shapedPropInputProof,
      },
      pickup: pickupEvidence,
      place: placeEvidence,
      finalMine: finalMineEvidence,
      nativeDropHotTransforms: {
        liveSamples: nativeDropHotTransformEvidence,
        durableSave: durableNativeDropHotTransformEvidence,
      },
      restoration: restorationEvidence,
      playerDrop: {
        transaction: playerDropEvidence,
        durableHotTransform: playerDropDurableHotTransformEvidence,
        inputProof: playerDropInputProof,
        pickup: playerDropPickupEvidence,
      },
      playerDropCheckpoints: {
        playerDropBaseline,
        afterPlayerDrop,
        playerDropTitleAfterSave,
        playerDropTitleAfterReload,
        playerDropContinued,
        afterPlayerDropPickup,
      },
      terrainReadiness,
      state: lastSnapshot?.state ?? null,
      runtime: lastSnapshot?.runtime ?? null,
      storage: lastSnapshot?.storage ?? null,
      audit: lastSnapshot?.audit ?? null,
      screenshots,
      screenshotRasterChecks,
      routeRequests,
      canonicalAssetRequests,
      errors: streams,
      cleanup,
    };
  } finally {
    if (page && nativeBlockEditFailureWrapperInstalled) {
      try {
        nativeBlockEditRecoveryInjection = await restoreOneShotWorldDocumentWriteFailure(page);
        nativeBlockEditFailureWrapperInstalled = false;
        if (result) result.nativeBlockEditRecoveryInjection = nativeBlockEditRecoveryInjection;
      } catch (error) {
        boundedPush(streams.runtimeErrors,
          `failure-wrapper cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (cdp) {
      await cdp.detach().then(() => { cleanup.cdpSessionDetached = true; }).catch((error) => {
        boundedPush(streams.runtimeErrors, `CDP cleanup: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (context) {
      await context.close().then(() => { cleanup.browserClosed = true; }).catch((error) => {
        boundedPush(streams.runtimeErrors, `browser cleanup: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    cleanup.browserDisconnected = browser === null
      ? !cleanup.browserStarted
      : await waitForBrowserDisconnect(browser).catch((error) => {
        boundedPush(streams.runtimeErrors, `browser disconnect: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      });
    if (managedServer) {
      try {
        managedServer.server.httpServer?.closeAllConnections?.();
        await managedServer.server.close();
        cleanup.serverClosed = managedServer.server.httpServer?.listening !== true;
      } catch (error) {
        boundedPush(streams.runtimeErrors, `Vite cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
      try { cleanup.serverPortRefused = await waitForRustMultiplayerPortRefusal(managedServer.port); }
      catch (error) { boundedPush(streams.runtimeErrors, `Vite port cleanup: ${error instanceof Error ? error.message : String(error)}`); }
      try { cleanup.environmentRestored = managedServer.restoreEnvironment(); }
      catch (error) { boundedPush(streams.runtimeErrors, `environment cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    } else if (managedServerAttempt) {
      cleanup.serverStarted = managedServerAttempt.server !== null;
      cleanup.serverClosed = managedServerAttempt.serverClosed;
      cleanup.serverPortRefused = managedServerAttempt.portRefused;
      cleanup.environmentRestored = managedServerAttempt.environmentRestored;
    }
    try {
      const immutableEvidence = assertBasicDirtCandidateAndCanonicalUnchanged(selection);
      cleanup.candidateUnchanged = true;
      cleanup.canonicalUnchanged = true;
      cleanup.sourceUnchanged = Boolean(immutableEvidence.sourceSnapshot);
      if (result?.artifact) result.artifact = { ...result.artifact, terminalImmutableEvidence: immutableEvidence };
    } catch (error) {
      boundedPush(streams.runtimeErrors, `candidate/canonical/source drift: ${error instanceof Error ? error.message : String(error)}`);
    }
    const processDeadline = Date.now() + 5_000;
    do {
      cleanup.aliveChildPidsAfterCleanup = cleanup.trackedChildPids.filter((pid) => {
        try { return exactProcessAlive(pid); }
        catch (error) {
          boundedPush(streams.runtimeErrors, `process cleanup ${pid}: ${error instanceof Error ? error.message : String(error)}`);
          return true;
        }
      });
      if (cleanup.aliveChildPidsAfterCleanup.length === 0 || Date.now() >= processDeadline) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (true);
    if (cleanup.browserDisconnected && cleanup.aliveChildPidsAfterCleanup.length === 0) {
      try { cleanup.profileRemoved = safeRemoveBasicDirtOwnedDirectory(profileRoot, profileDirectory, PROFILE_PREFIX); }
      catch (error) { boundedPush(streams.runtimeErrors, `profile cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    } else boundedPush(streams.runtimeErrors, "profile cleanup refused before exact browser process shutdown.");
    try {
      if (existsSync(profileRoot) && readdirSync(profileRoot).length === 0) rmdirSync(profileRoot);
      cleanup.profileRootRemoved = !existsSync(profileRoot);
    } catch (error) { boundedPush(streams.runtimeErrors, `profile-root cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    if (cleanup.serverClosed && cleanup.serverPortRefused && cleanup.environmentRestored) {
      try {
        cleanup.viteRuntimeRemoved = safeRemoveBasicDirtOwnedDirectory(
          options.outputDirectory, viteRuntimeDirectory, VITE_RUNTIME_PREFIX,
        );
      } catch (error) { boundedPush(streams.runtimeErrors, `Vite-runtime cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    } else boundedPush(streams.runtimeErrors, "Vite-runtime cleanup refused before server/environment cleanup.");
    if (browserMutex) {
      try { cleanup.browserMutexReleased = await browserMutex.release(); }
      catch (error) {
        cleanup.browserMutexReleased = false;
        boundedPush(streams.runtimeErrors, `browser mutex cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    cleanup.eventsDrained = true;
    collectionState.active = false;
    let cleanupError = null;
    try { assertBasicDirtCleanupEvidence(cleanup); }
    catch (error) { cleanupError = error; }
    let streamError = null;
    try { assertBasicDirtBrowserErrorStreams(streams); }
    catch (error) { streamError = error; }
    if (cleanupError || streamError || result?.status !== "passed") {
      result = {
        ...result,
        status: "failed",
        authorityClaim: "none",
        error: result?.error ?? cleanupError?.message ?? streamError?.message
          ?? "Basic Dirt browser, cleanup, or error-stream gate failed.",
      };
    }
    result.cleanup = cleanup;
    result.errors = streams;
    result.screenshots = screenshots;
    result.screenshotRasterChecks = screenshotRasterChecks;
    writeFileSync(path.join(options.outputDirectory, "errors.json"), `${JSON.stringify(streams, null, 2)}\n`, "utf8");
    writeFileSync(path.join(options.outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return Object.freeze({ ...result, outputPath: path.join(options.outputDirectory, "result.json") });
}

export function usage() {
  return `Usage: node scripts/verify-rust-basic-dirt-action-browser.mjs \\
  --expected-artifact-hash <64 lowercase hex> \\
  --output <directory beneath work/> \\
  --engine-dir public/engine-locator-candidate \\
  [--scenario dirt-cycle|generic-grass|generic-grass-recovery|generic-shaped-prop] \\
  [--timeout-ms <60000..900000>] [--playwright-module <path>] \\
  [--browser-executable <path>] [--headed]\n\nThe gate owns a serialized HMR-off Vite server and browser profile. The default dirt-cycle route creates an exact Survival world through the real UI, mines Dirt, walks into and receipts that exact native drop, completes the Dirt place/mine loop, and performs the Moonberry drop/re-pickup loop. The generic-grass route performs one exact natural Meadow Grass mine and fresh restoration; generic-grass-recovery adds one injected local document failure plus same-session finalize recovery. The generic-shaped-prop route creates Creative through the real UI, visibly searches the complete catalog for Wildwood Shelf item 270, places one exact East-facing shelf, Save & Quits, changes that same saved world to Survival through the Worlds editor and its confirmation, loads and mines the shelf for one exact native item-270 drop, then Save & Quits, fully reloads, and proves the empty cell plus same drop restoration. Every route proves native checkpoint / browser projection / receipt acknowledgment ordering. Canonical public/engine is snapshotted but never routed or modified.\n`;
}

async function main() {
  try {
    const result = await runBasicDirtActionBrowser(process.argv);
    if (result.help) {
      process.stdout.write(result.usage);
      return;
    }
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      artifactHash: result.artifact?.hash ?? null,
      coverage: result.coverage ?? null,
      screenshots: result.screenshots,
      cleanup: result.cleanup,
      outputPath: result.outputPath,
      error: result.error ?? null,
    }, null, 2)}\n`);
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Rust Basic Dirt browser verifier failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectInvocation(import.meta.url)) await main();
