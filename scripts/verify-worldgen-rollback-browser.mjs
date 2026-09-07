#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { findRepositoryRoot, isDirectInvocation } from "./rust-engine-common.mjs";
import {
  resolveManagedCanonicalAsset,
  resolveWorkOutputDirectory,
} from "./verify-rust-r5-player-browser.mjs";
import {
  TERRAIN_EDIT_TITLE_MENU_LABELS,
  waitForTerrainEditReloadTitleVisualReadiness,
} from "./verify-rust-terrain-edit-reload-browser.mjs";

export const WORLDGEN_ROLLBACK_PROFILE = "typescript-rollback";
export const WORLDGEN_ROLLBACK_SELECTION_SOURCE = "build-typescript-rollback";
export const WORLDGEN_ROLLBACK_BADGE_ARIA = "TypeScript terrain rollback build; changing terrain authority requires a reload";
export const WORLDGEN_ROLLBACK_TITLE_MARKER = "TERRAIN ROLLBACK";
const WORLDGEN_ROLLBACK_TITLE_UTILITY_LABELS = Object.freeze(["WIKI", "FULLSCREEN"]);
const WORLDGEN_ROLLBACK_TITLE_UTILITY_STABLE_SAMPLES = 3;

const DEFAULT_TIMEOUT_MILLISECONDS = 240_000;
const PROFILE_PREFIX = "browser-profile-";
const VITE_RUNTIME_PREFIX = "vite-runtime-";
const BROWSER_AUDIT_SCHEMA = 1;
const BROWSER_AUDIT_SENTINEL = "blockwild-worldgen-rollback-audit-v1";
const WORLD_FIXTURE = Object.freeze({
  name: "TypeScript Terrain Rollback Acceptance",
  seed: "ROLLBACK-TERRAIN-824",
  mode: "survival",
});
const OPTION_DEFINITIONS = Object.freeze({
  "repo-root": "string",
  output: "string",
  "timeout-ms": "integer",
  "playwright-module": "string",
  "browser-executable": "string",
  headed: "boolean",
  help: "boolean",
});
const SANITIZED_ENVIRONMENT_KEYS = Object.freeze([
  "BLOCKWILD_RUST_ENGINE_CANDIDATE_ALIAS",
  "NEXT_PUBLIC_BLOCKWILD_EXPERIMENTAL_RUST_LIVE_PLAYER_AUTHORITY_R5",
  "NEXT_PUBLIC_BLOCKWILD_RUST_TERRAIN_MESHER",
  "NEXT_PUBLIC_BLOCKWILD_RUST_WORLD_AUTHORITY",
]);
const OWNED_RUNTIME_ENVIRONMENT_KEYS = Object.freeze([
  "WRANGLER_WRITE_LOGS",
  "WRANGLER_LOG_PATH",
  "WRANGLER_SEND_METRICS",
  "MINIFLARE_REGISTRY_PATH",
]);
const MANAGED_CANONICAL_ASSET_URLS = Object.freeze([
  "https://blockwild.app/manifest.webmanifest",
  "https://blockwild.app/brand/blockwild-icon-16.png",
  "https://blockwild.app/brand/blockwild-icon-32.png",
  "https://blockwild.app/brand/blockwild-icon-64.png",
  "https://blockwild.app/brand/blockwild-icon-192.png",
  "https://blockwild.app/brand/blockwild-icon-512.png",
]);
const MIME_TYPES = new Map([
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function fail(message, details) {
  const error = new Error(message);
  if (details !== undefined) error.details = details;
  throw error;
}

function assertCondition(condition, message) {
  if (!condition) fail(message);
}

function finite(value, label) {
  assertCondition(typeof value === "number" && Number.isFinite(value), `${label} is not finite: ${String(value)}`);
  return value;
}

function zero(value, label) {
  assertCondition(value === 0, `${label} must be zero; received ${String(value)}`);
  return value;
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

export function parseWorldgenRollbackBrowserOptions(argv = process.argv, context = {}) {
  const raw = parseRawOptions(argv);
  const repositoryRoot = raw["repo-root"]
    ? findRepositoryRoot(path.resolve(context.cwd ?? process.cwd(), raw["repo-root"]))
    : findRepositoryRoot(context.cwd ?? process.cwd());
  if (raw.help) return Object.freeze({ help: true, repositoryRoot });
  const timeoutMilliseconds = raw["timeout-ms"] ?? DEFAULT_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 30_000 || timeoutMilliseconds > 900_000) {
    fail("--timeout-ms must be an integer from 30000 through 900000.");
  }
  return Object.freeze({
    help: false,
    repositoryRoot,
    outputDirectory: resolveWorkOutputDirectory(repositoryRoot, raw.output),
    timeoutMilliseconds,
    playwrightModule: raw["playwright-module"] ? path.resolve(repositoryRoot, raw["playwright-module"]) : null,
    browserExecutable: raw["browser-executable"] ? path.resolve(repositoryRoot, raw["browser-executable"]) : null,
    headless: raw.headed !== true,
  });
}

/** Exact environment passed to the managed Vite lifetime. */
export function worldgenRollbackViteEnvironment(environment, runtimeDirectory) {
  if (!environment || typeof environment !== "object") fail("Managed rollback Vite requires an environment object.");
  if (typeof runtimeDirectory !== "string" || runtimeDirectory.length === 0) {
    fail("Managed rollback Vite requires an owned runtime directory.");
  }
  const next = {
    ...environment,
    BLOCKWILD_WORLDGEN_BUILD_PROFILE: WORLDGEN_ROLLBACK_PROFILE,
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: path.join(runtimeDirectory, "wrangler", "wrangler.log"),
    MINIFLARE_REGISTRY_PATH: path.join(runtimeDirectory, "miniflare", "registry"),
  };
  for (const key of SANITIZED_ENVIRONMENT_KEYS) delete next[key];
  return next;
}

function installWorldgenRollbackViteEnvironment(runtimeDirectory) {
  const previous = { ...process.env };
  const sanitized = worldgenRollbackViteEnvironment(process.env, runtimeDirectory);
  for (const key of [...SANITIZED_ENVIRONMENT_KEYS, ...OWNED_RUNTIME_ENVIRONMENT_KEYS]) delete process.env[key];
  for (const [key, value] of Object.entries(sanitized)) process.env[key] = value;
  return () => {
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(previous, key)) delete process.env[key];
    for (const [key, value] of Object.entries(previous)) process.env[key] = value;
    const currentKeys = Object.keys(process.env);
    assertCondition(currentKeys.length === Object.keys(previous).length
      && currentKeys.every((key) => process.env[key] === previous[key]),
    "Managed rollback Vite did not restore the exact inherited process environment.");
    return true;
  };
}

export function worldgenRollbackManagedViteInlineConfig(repositoryRoot, port, runtimeDirectory) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    fail("Managed rollback Vite repository root must be a non-empty path.");
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    fail(`Managed rollback Vite port must be an integer from 1 through 65535, received ${String(port)}.`);
  }
  const canonicalRoot = realpathSync(repositoryRoot);
  const productionConfigFile = path.join(canonicalRoot, "vite.config.ts");
  if (!existsSync(productionConfigFile)
    || lstatSync(productionConfigFile).isSymbolicLink()
    || !statSync(productionConfigFile).isFile()) {
    fail(`Managed rollback Vite requires the repository's non-symlink config: ${productionConfigFile}`);
  }
  const ownedRuntime = resolveWorkOutputDirectory(canonicalRoot, runtimeDirectory);
  return {
    root: canonicalRoot,
    configFile: path.join(ownedRuntime, "vite.config.mjs"),
    configLoader: "runner",
    // Vinext's CommonJS transform excludes optimized dependencies by their
    // node_modules path. Keep the cache verifier-owned while retaining that
    // path contract so optimized React server modules are not transformed twice.
    cacheDir: path.join(ownedRuntime, "node_modules", ".vite"),
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      hmr: false,
      // Vite drops null during config merging. An ignore-all predicate is the
      // merge-stable way to suppress every source watcher for this frozen run.
      watch: {
        ignored: () => true,
      },
    },
  };
}

export function worldgenRollbackManagedViteWrapperSource(repositoryRoot, runtimeDirectory) {
  const canonicalRoot = realpathSync(repositoryRoot);
  const ownedRuntime = resolveWorkOutputDirectory(canonicalRoot, runtimeDirectory);
  const hostingPath = path.join(canonicalRoot, ".openai", "hosting.json");
  if (!existsSync(hostingPath) || lstatSync(hostingPath).isSymbolicLink() || !statSync(hostingPath).isFile()) {
    fail(`Managed rollback Vite requires the repository hosting config: ${hostingPath}`);
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
  const cacheDir = path.join(ownedRuntime, "node_modules", ".vite");
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

// Vite disposes its config module runner before invoking an exported config
// function. Resolve the imported async production config while this module is
// still loading so its dynamic Cloudflare import cannot outlive that runner.
const rollbackConfigEnvironment = Object.freeze({
  command: "serve",
  mode: "development",
  isSsrBuild: false,
  isPreview: false,
});
const resolvedBaseConfig = typeof baseConfig === "function"
  ? await baseConfig(rollbackConfigEnvironment)
  : baseConfig;
const productionPlugins = (resolvedBaseConfig.plugins ?? []).flat(Infinity)
  .filter((plugin) => !cloudflarePlugin(plugin))
  .map(ownVinextRuntimeWrites);

export default {
  ...resolvedBaseConfig,
  cacheDir: ${JSON.stringify(cacheDir)},
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

async function reserveLoopbackPort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") fail("Managed rollback Vite could not reserve a loopback port.");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startManagedRollbackVite(repositoryRoot, runtimeDirectory) {
  const port = await reserveLoopbackPort();
  mkdirSync(runtimeDirectory, { recursive: true });
  resolveWorkOutputDirectory(repositoryRoot, runtimeDirectory);
  const inlineConfig = worldgenRollbackManagedViteInlineConfig(repositoryRoot, port, runtimeDirectory);
  writeFileSync(
    inlineConfig.configFile,
    worldgenRollbackManagedViteWrapperSource(repositoryRoot, runtimeDirectory),
    { encoding: "utf8", flag: "wx" },
  );
  const viteModule = path.join(repositoryRoot, "node_modules", "vite", "dist", "node", "index.js");
  if (!existsSync(viteModule) || !statSync(viteModule).isFile()) {
    fail(`Managed rollback server requires the installed Vite module: ${viteModule}`);
  }
  const restoreEnvironment = installWorldgenRollbackViteEnvironment(runtimeDirectory);
  let server = null;
  try {
    const vite = await import(pathToFileURL(viteModule).href);
    server = await vite.createServer(inlineConfig);
    assertCondition(server.config.server.hmr === false, "Managed rollback Vite did not retain HMR=false.");
    const ignored = server.config.server.watch?.ignored;
    const ignoresManagedSource = typeof ignored === "function"
      && ignored(path.join(inlineConfig.root, "app", "page.tsx")) === true
      && ignored(inlineConfig.configFile) === true;
    assertCondition(ignoresManagedSource,
      `Managed rollback Vite did not retain the ignore-all watcher (ignored=${typeof ignored}).`);
    assertCondition(path.resolve(server.config.cacheDir) === path.resolve(inlineConfig.cacheDir),
      `Managed rollback Vite cache escaped the owned runtime: ${server.config.cacheDir}`);
    assertCondition(
      server.config.define?.["process.env.NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE"] === JSON.stringify(WORLDGEN_ROLLBACK_PROFILE),
      "Managed rollback Vite did not compile the exact TypeScript rollback build profile.",
    );
    assertCondition(process.env.BLOCKWILD_RUST_ENGINE_CANDIDATE_ALIAS !== "1", "Candidate engine alias leaked into rollback Vite.");
    await server.listen();
    return {
      server,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      inlineConfig,
      restoreEnvironment,
    };
  } catch (error) {
    if (server) await server.close().catch(() => {});
    restoreEnvironment();
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
    } catch (error) {
      failures.push(`${candidate}: ${error.code ?? error.message}`);
    }
  }
  fail("A local Playwright runtime is required. This verifier never downloads a package or browser.", { failures });
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

function contentType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

async function installManagedCanonicalAssetRoutes(context, repositoryRoot, requests) {
  for (const requestUrl of MANAGED_CANONICAL_ASSET_URLS) {
    const asset = resolveManagedCanonicalAsset(repositoryRoot, requestUrl);
    await context.route(requestUrl, async (route) => {
      const requestedAsset = resolveManagedCanonicalAsset(repositoryRoot, route.request().url());
      if (!requestedAsset || requestedAsset.filePath !== asset.filePath) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: contentType(requestedAsset.filePath),
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
        body: readFileSync(requestedAsset.filePath),
      });
      requests.push(Object.freeze({
        url: requestedAsset.requestUrl,
        path: requestedAsset.relativeAssetPath,
        status: 200,
        source: "managed-canonical-asset-route",
      }));
    });
  }
}

export function resolvePublicRustArtifactPrefixes(repositoryRoot) {
  const publicRoot = path.join(realpathSync(repositoryRoot), "public");
  if (!existsSync(publicRoot) || lstatSync(publicRoot).isSymbolicLink() || !statSync(publicRoot).isDirectory()) {
    fail(`Rollback verifier requires a real public directory: ${publicRoot}`);
  }
  const prefixes = [];
  for (const entry of readdirSync(publicRoot, { withFileTypes: true })) {
    if (entry.name !== "engine" && !entry.name.startsWith("engine-")) continue;
    const entryPath = path.join(publicRoot, entry.name);
    if (entry.isSymbolicLink() || lstatSync(entryPath).isSymbolicLink() || !statSync(entryPath).isDirectory()) {
      fail(`Rust artifact public root must be a non-symlink directory: ${entryPath}`);
    }
    prefixes.push(`/${entry.name}`);
  }
  prefixes.sort((left, right) => left.localeCompare(right, "en"));
  assertCondition(prefixes.includes("/engine"), "Canonical public/engine artifact root is missing from the rollback audit.");
  return Object.freeze(prefixes);
}

export function isPublicRustArtifactRequestPath(pathname, prefixes) {
  assertCondition(typeof pathname === "string" && pathname.startsWith("/"), "Rust artifact request pathname is malformed");
  assertCondition(Array.isArray(prefixes) && prefixes.length > 0, "Rust artifact request prefixes are absent");
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { decoded = pathname; }
  return prefixes.some((prefix) => decoded === prefix || decoded.startsWith(`${prefix}/`));
}

function installBrowserAudit(context) {
  return context.addInitScript(({ schema, sentinel }) => {
    const workerRecords = [];
    const certificateRecords = [];
    const runtimeErrorRecords = [];
    const audit = {
      schema,
      sentinel,
      workerInstrumentation: false,
      sharedWorkerInstrumentation: "unavailable",
      get workers() { return workerRecords.map(copy); },
      get certificates() { return certificateRecords.map(copy); },
      get runtimeErrors() { return runtimeErrorRecords.map(copy); },
    };
    const copy = (value) => {
      try { return structuredClone(value); }
      catch {
        try { return JSON.parse(JSON.stringify(value)); }
        catch { return String(value); }
      }
    };
    const wrapWorker = (NativeWorker, kind) => new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget);
        const options = args[1] && typeof args[1] === "object" ? args[1] : {};
        workerRecords.push({ kind, url: String(args[0]), name: options.name ?? null, type: options.type ?? null });
        worker.addEventListener?.("message", (event) => {
          if (event.data?.type === "terrain-generation-ready-v2" && event.data.certificate) {
            certificateRecords.push(copy(event.data.certificate));
          }
        });
        return worker;
      },
    });
    const installConstructor = (property, kind) => {
      const NativeWorker = window[property];
      if (typeof NativeWorker !== "function") return false;
      const AuditedWorker = wrapWorker(NativeWorker, kind);
      Object.defineProperty(window, property, {
        configurable: false,
        enumerable: true,
        value: AuditedWorker,
        writable: false,
      });
      return window[property] === AuditedWorker;
    };
    audit.workerInstrumentation = installConstructor("Worker", "Worker");
    audit.sharedWorkerInstrumentation = typeof window.SharedWorker === "function"
      ? installConstructor("SharedWorker", "SharedWorker")
      : "unavailable";
    Object.freeze(audit);
    Object.defineProperty(window, "__blockwildWorldgenRollbackAudit", {
      configurable: false,
      enumerable: false,
      value: audit,
      writable: false,
    });
    window.addEventListener("error", (event) => {
      if (event.error === undefined && event.message === undefined) return;
      runtimeErrorRecords.push({ type: "error", message: event.message ?? String(event.error), stack: event.error?.stack ?? null });
    });
    window.addEventListener("unhandledrejection", (event) => {
      runtimeErrorRecords.push({
        type: "unhandledrejection",
        message: event.reason?.message ?? String(event.reason),
        stack: event.reason?.stack ?? null,
      });
    });
  }, { schema: BROWSER_AUDIT_SCHEMA, sentinel: BROWSER_AUDIT_SENTINEL });
}

export function collectWorldgenRollbackRuntimeErrors(state) {
  const streaming = state?.performance?.streaming;
  const generation = streaming?.generationWorker;
  const terrainWorker = streaming?.terrainWorker;
  const rustTerrain = streaming?.rustTerrain;
  const rustWorld = streaming?.rustWorldAuthority;
  const errors = [];
  const nonNull = (label, value) => {
    if (value !== null && value !== undefined && value !== "") errors.push(`${label}: ${String(value)}`);
  };
  nonNull("generationWorker.lastError", generation?.lastError);
  nonNull("terrainWorker.lastError", terrainWorker?.lastError);
  nonNull("rustTerrain.lastMismatch", rustTerrain?.lastMismatch);
  nonNull("rustWorldAuthority.lastFallbackReason", rustWorld?.lastFallbackReason);
  if ((terrainWorker?.failed ?? 0) !== 0) errors.push(`terrain worker failures: ${String(terrainWorker?.failed)}`);
  if ((terrainWorker?.restarts ?? 0) !== 0) errors.push(`terrain worker restarts: ${String(terrainWorker?.restarts)}`);
  if ((rustTerrain?.fallback ?? 0) !== 0) errors.push(`Rust terrain fallbacks: ${String(rustTerrain?.fallback)}`);
  if ((rustTerrain?.parityMismatches ?? 0) !== 0) errors.push(`Rust terrain parity mismatches: ${String(rustTerrain?.parityMismatches)}`);
  if ((rustTerrain?.installFailures ?? 0) !== 0) errors.push(`Rust terrain install failures: ${String(rustTerrain?.installFailures)}`);
  if ((rustWorld?.failures ?? 0) !== 0) errors.push(`Rust world failures: ${String(rustWorld?.failures)}`);
  if ((rustWorld?.restarts ?? 0) !== 0) errors.push(`Rust world restarts: ${String(rustWorld?.restarts)}`);
  return Object.freeze(errors);
}

function neutralPlayerEdits(state, label) {
  const edits = state?.performance?.streaming?.playerEdits;
  assertCondition(edits && typeof edits === "object", `${label}: player-edit diagnostics are absent`);
  zero(edits.total, `${label}: player edit total`);
  zero(edits.byKind?.break, `${label}: break edit count`);
  zero(edits.byKind?.place, `${label}: place edit count`);
  zero(edits.byKind?.["tree-fell"], `${label}: tree-fell edit count`);
  zero(edits.pendingConsolidationTransactions, `${label}: pending edit consolidation transactions`);
  return Object.freeze(structuredClone(edits));
}

export function assertWorldgenRollbackCheckpoint(snapshot, label = "rollback checkpoint", expectedState = "playing") {
  const state = snapshot?.state;
  const streaming = state?.performance?.streaming;
  const generation = streaming?.generationWorker;
  assertCondition(state?.state === expectedState, `${label}: expected state ${expectedState}, received ${String(state?.state)}`);
  assertCondition(generation?.mode === "typescript", `${label}: generation mode is ${String(generation?.mode)}`);
  assertCondition(generation?.selectionSource === WORLDGEN_ROLLBACK_SELECTION_SOURCE,
    `${label}: generation selection source is ${String(generation?.selectionSource)}`);
  assertCondition(generation?.state === "typescript-rollback", `${label}: generation state is ${String(generation?.state)}`);
  assertCondition(generation?.authorityRequired === false, `${label}: Rust generation authority is still required`);
  assertCondition(generation?.rollbackRequiresWorldReload === true, `${label}: rollback is not isolated to a world reload`);
  assertCondition(generation?.supported === false, `${label}: Rust generation support unexpectedly became active`);
  for (const [field, value] of Object.entries({
    workers: generation?.workers,
    ready: generation?.ready,
    busy: generation?.busy,
    submitted: generation?.submitted,
    completed: generation?.completed,
    failed: generation?.failed,
    stale: generation?.stale,
    canceled: generation?.canceled,
    rejected: generation?.rejected,
    transferBytes: generation?.transferBytes,
    restarts: generation?.restarts,
    staleResults: generation?.staleResults,
  })) zero(value, `${label}: generation ${field}`);
  assertCondition(generation?.lastError === null, `${label}: generation lastError is not null`);
  assertCondition(streaming?.rustTerrain?.mode === "off", `${label}: Rust terrain mesher is not off`);
  assertCondition(streaming?.rustWorldAuthority?.configuredMode === "off", `${label}: Rust world authority is not off`);
  const runtimeErrors = collectWorldgenRollbackRuntimeErrors(state);
  assertCondition(runtimeErrors.length === 0, `${label}: ${runtimeErrors.join(" | ")}`);
  const playerEdits = neutralPlayerEdits(state, label);
  return Object.freeze({
    generation: Object.freeze({ ...generation }),
    playerEdits,
    runtimeErrors,
  });
}

export function assertWorldgenRollbackUi(ui, phase) {
  assertCondition(ui?.worldgenBuildProfile === WORLDGEN_ROLLBACK_PROFILE,
    `${phase}: DOM build profile is ${String(ui?.worldgenBuildProfile)}`);
  if (phase === "title") {
    assertCondition(ui.titleMarkerVisible === true, "title: rollback title marker is not visible");
    assertCondition(ui.titleText?.includes(WORLDGEN_ROLLBACK_TITLE_MARKER),
      `title: version label lacks ${WORLDGEN_ROLLBACK_TITLE_MARKER}`);
  } else if (phase === "playing") {
    assertCondition(ui.rollbackBadgeVisible === true, "playing: rollback badge is not visible");
    assertCondition(ui.rollbackBadgeRole === "status", `playing: rollback badge role is ${String(ui?.rollbackBadgeRole)}`);
    assertCondition(ui.rollbackBadgeAria === WORLDGEN_ROLLBACK_BADGE_ARIA,
      `playing: rollback badge ARIA is ${String(ui?.rollbackBadgeAria)}`);
    assertCondition(ui.rollbackBadgeText?.includes("ROLLBACK BUILD"), "playing: rollback badge lacks ROLLBACK BUILD");
    assertCondition(ui.rollbackBadgeText?.includes("TYPESCRIPT TERRAIN · RELOAD REQUIRED"),
      "playing: rollback badge lacks the exact TypeScript terrain reload warning");
  } else fail(`Unknown rollback UI phase: ${String(phase)}`);
  return true;
}

function worldgenRollbackTitleUtilitySignature(observation) {
  const visual = (element) => [
    element?.visible,
    element?.inViewport,
    element?.unoccluded,
    element?.bounds?.x,
    element?.bounds?.y,
    element?.bounds?.width,
    element?.bounds?.height,
    element?.fontReady,
    element?.colorVisible,
  ];
  return JSON.stringify({
    documentVisibility: observation?.documentVisibility,
    fontsStatus: observation?.fontsStatus,
    utility: visual(observation?.utility),
    version: [observation?.version?.text, ...visual(observation?.version?.textVisual)],
    labels: observation?.labels?.map((label) => [label.text, ...visual(label.textVisual)]),
    menu: visual(observation?.menu),
    buttons: observation?.buttons?.map((button) => [
      button.label,
      button.disabled,
      ...visual(button.button),
      ...visual(button.strong),
      ...visual(button.small),
    ]),
  });
}

export function assertWorldgenRollbackTitleUtilityVisualReadiness(evidence) {
  assertCondition(evidence?.schema === 1, "Rollback title utility visual evidence schema is not 1.");
  assertCondition(Array.isArray(evidence.samples), "Rollback title utility visual samples are absent.");
  assertCondition(evidence.samples.length >= WORLDGEN_ROLLBACK_TITLE_UTILITY_STABLE_SAMPLES,
    `Rollback title utility produced ${evidence.samples.length} stable visual sample(s) instead of ${WORLDGEN_ROLLBACK_TITLE_UTILITY_STABLE_SAMPLES}.`);
  const samples = evidence.samples.slice(-WORLDGEN_ROLLBACK_TITLE_UTILITY_STABLE_SAMPLES);
  const assertPainted = (element, label) => {
    assertCondition(element?.visible === true, `${label} is not visibly rendered.`);
    assertCondition(element?.inViewport === true, `${label} is outside the retained viewport.`);
    assertCondition(element?.unoccluded === true, `${label} is obscured in the retained viewport.`);
    assertCondition(element?.bounds && element.bounds.width >= 1 && element.bounds.height >= 1,
      `${label} has no painted bounds.`);
  };
  for (const [index, observation] of samples.entries()) {
    const prefix = `Rollback title utility observation ${index + 1}`;
    assertCondition(observation?.documentVisibility === "visible", `${prefix} document is not visible.`);
    assertCondition(observation?.fontsStatus === "loaded", `${prefix} fonts are not loaded.`);
    assertPainted(observation.utility, `${prefix} utility`);
    assertCondition(observation.version?.text?.includes(WORLDGEN_ROLLBACK_TITLE_MARKER),
      `${prefix} version label lacks ${WORLDGEN_ROLLBACK_TITLE_MARKER}.`);
    assertPainted(observation.version?.textVisual, `${prefix} version label text`);
    assertCondition(observation.version.textVisual.fontReady === true, `${prefix} version label font is not ready.`);
    assertCondition(observation.version.textVisual.colorVisible === true, `${prefix} version label text color is transparent.`);
    assertCondition(Array.isArray(observation.labels), `${prefix} utility labels are absent.`);
    assertCondition(observation.labels.length === WORLDGEN_ROLLBACK_TITLE_UTILITY_LABELS.length,
      `${prefix} rendered ${observation.labels.length} utility labels instead of ${WORLDGEN_ROLLBACK_TITLE_UTILITY_LABELS.length}.`);
    for (const [labelIndex, label] of observation.labels.entries()) {
      const expected = WORLDGEN_ROLLBACK_TITLE_UTILITY_LABELS[labelIndex];
      assertCondition(label.text === expected, `${prefix} utility label ${labelIndex} is not ${expected}.`);
      assertPainted(label.textVisual, `${prefix} ${expected} label`);
      assertCondition(label.textVisual.fontReady === true, `${prefix} ${expected} label font is not ready.`);
      assertCondition(label.textVisual.colorVisible === true, `${prefix} ${expected} label text color is transparent.`);
    }
    assertPainted(observation.menu, `${prefix} main menu`);
    assertCondition(Array.isArray(observation.buttons), `${prefix} main menu buttons are absent.`);
    assertCondition(observation.buttons.length === TERRAIN_EDIT_TITLE_MENU_LABELS.length,
      `${prefix} rendered ${observation.buttons.length} main menu buttons instead of ${TERRAIN_EDIT_TITLE_MENU_LABELS.length}.`);
    for (const [buttonIndex, button] of observation.buttons.entries()) {
      const expected = TERRAIN_EDIT_TITLE_MENU_LABELS[buttonIndex];
      assertCondition(button.label === expected, `${prefix} main menu label ${buttonIndex} is not ${expected}.`);
      assertCondition(button.disabled === false, `${prefix} ${expected} button is disabled.`);
      assertPainted(button.button, `${prefix} ${expected} button`);
      assertPainted(button.strong, `${prefix} ${expected} label text`);
      assertCondition(button.strong.fontReady === true, `${prefix} ${expected} label font is not ready.`);
      assertCondition(button.strong.colorVisible === true, `${prefix} ${expected} label text color is transparent.`);
      if (button.small?.text) {
        assertPainted(button.small, `${prefix} ${expected} supporting text`);
        assertCondition(button.small.fontReady === true, `${prefix} ${expected} supporting font is not ready.`);
        assertCondition(button.small.colorVisible === true, `${prefix} ${expected} supporting text color is transparent.`);
      }
    }
  }
  const signatures = samples.map(worldgenRollbackTitleUtilitySignature);
  assertCondition(signatures.every((signature) => signature === signatures[0]),
    "Rollback title utility labels did not remain visually stable across compositor observations.");
  return Object.freeze({
    ...evidence,
    samples: Object.freeze(samples.map((sample) => Object.freeze(structuredClone(sample)))),
    expectedLabels: WORLDGEN_ROLLBACK_TITLE_UTILITY_LABELS,
    expectedMenuLabels: TERRAIN_EDIT_TITLE_MENU_LABELS,
    stableSamples: WORLDGEN_ROLLBACK_TITLE_UTILITY_STABLE_SAMPLES,
  });
}

function isRustGenerationWorker(worker) {
  const identity = `${worker?.url ?? ""} ${worker?.name ?? ""}`.toLowerCase();
  return identity.includes("terrain-generation-worker") || identity.includes("rust-generation");
}

export function assertNoRustGenerationBrowserActivity({ audits, artifactRequests }) {
  assertCondition(Array.isArray(audits), "rollback browser audits must be an array");
  assertCondition(Array.isArray(artifactRequests), "rollback artifact requests must be an array");
  assertCondition(audits.length === 2, `rollback browser requires exactly two document audits; received ${audits.length}`);
  for (const [index, audit] of audits.entries()) {
    assertCondition(audit && typeof audit === "object", `rollback document audit ${index + 1} is absent`);
    assertCondition(audit.navigation === index + 1, `rollback document audit navigation ${index + 1} is malformed`);
    assertCondition(audit.schema === BROWSER_AUDIT_SCHEMA, `rollback document audit ${index + 1} has the wrong schema`);
    assertCondition(audit.sentinel === BROWSER_AUDIT_SENTINEL, `rollback document audit ${index + 1} lacks the exact sentinel`);
    assertCondition(audit.workerInstrumentation === true,
      `rollback document audit ${index + 1} did not retain Worker instrumentation`);
    assertCondition(audit.sharedWorkerInstrumentation === true || audit.sharedWorkerInstrumentation === "unavailable",
      `rollback document audit ${index + 1} has malformed SharedWorker instrumentation`);
    for (const field of ["workers", "certificates", "runtimeErrors"]) {
      assertCondition(Array.isArray(audit[field]), `rollback document audit ${index + 1} ${field} is not an array`);
    }
  }
  const generationWorkers = audits.flatMap((audit) => audit.workers.filter(isRustGenerationWorker));
  const certificates = audits.flatMap((audit) => audit.certificates);
  assertCondition(generationWorkers.length === 0,
    `Rollback created ${generationWorkers.length} Rust generation Worker(s): ${JSON.stringify(generationWorkers)}`);
  assertCondition(certificates.length === 0,
    `Rollback observed ${certificates.length} Rust generation certificate(s): ${JSON.stringify(certificates)}`);
  assertCondition(artifactRequests.length === 0,
    `Rollback requested ${artifactRequests.length} Rust artifact path(s): ${JSON.stringify(artifactRequests)}`);
  return Object.freeze({ generationWorkers: 0, generationCertificates: 0, artifactRequests: 0 });
}

function poseFromState(state, label) {
  const position = state?.player?.position;
  assertCondition(Array.isArray(position) && position.length === 3, `${label}: player position is absent`);
  return Object.freeze({
    position: Object.freeze(position.map((value, index) => finite(value, `${label} position[${index}]`))),
    yaw: finite(state?.player?.yaw, `${label} yaw`),
    pitch: finite(state?.player?.pitch, `${label} pitch`),
  });
}

export function assertExactWorldgenRollbackPersistence(beforeSave, afterReload, fixture = WORLD_FIXTURE) {
  assertCondition(beforeSave?.state?.world?.seed === fixture.seed, "pre-save world seed disagrees with the deterministic fixture");
  assertCondition(afterReload?.state?.world?.seed === fixture.seed, "reload changed the exact world seed");
  assertCondition(beforeSave?.state?.player?.mode === fixture.mode, "pre-save mode disagrees with the deterministic fixture");
  assertCondition(afterReload?.state?.player?.mode === fixture.mode, "reload changed the exact world mode");
  const beforePose = poseFromState(beforeSave.state, "pre-save rollback pose");
  const afterPose = poseFromState(afterReload.state, "reloaded rollback pose");
  assertCondition(JSON.stringify(beforePose) === JSON.stringify(afterPose),
    `reload changed the exact rollback pose: before=${JSON.stringify(beforePose)} after=${JSON.stringify(afterPose)}`);
  const beforeEdits = neutralPlayerEdits(beforeSave.state, "pre-save rollback edits");
  const afterEdits = neutralPlayerEdits(afterReload.state, "reloaded rollback edits");
  assertCondition(JSON.stringify(beforeEdits) === JSON.stringify(afterEdits), "reload changed the exact edit-neutral diagnostics");
  return Object.freeze({ seed: fixture.seed, mode: fixture.mode, pose: afterPose, playerEdits: afterEdits });
}

export function assertWorldgenRollbackErrorStreams({
  consoleErrors,
  pageErrors,
  runtimeErrors,
  httpErrors,
  requestFailures,
}) {
  for (const [label, errors] of Object.entries({ consoleErrors, pageErrors, runtimeErrors, httpErrors, requestFailures })) {
    assertCondition(Array.isArray(errors), `${label} must be an array`);
    assertCondition(errors.length === 0, `${label} contains ${errors.length} error(s): ${JSON.stringify(errors)}`);
  }
  return true;
}

/**
 * Chromium cancels outstanding local audio preloads when this verifier leaves
 * gameplay or reloads the document. Classify only that exact benign browser
 * cancellation; every other failed request remains release-blocking.
 */
export function isExpectedWorldgenRollbackRequestCancellation(entry) {
  if (entry?.method !== "GET" || entry?.resourceType !== "media" || entry?.failure !== "net::ERR_ABORTED") return false;
  try {
    const url = new URL(entry.url);
    return url.protocol === "http:"
      && url.hostname === "127.0.0.1"
      && /^\/music\/[A-Za-z0-9._-]+\.mp3$/u.test(url.pathname)
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

function relativeEvidencePath(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
}

function removeOwnedDirectory(outputDirectory, ownedDirectory, prefix, label) {
  const canonicalOutput = realpathSync(outputDirectory);
  const resolvedOwned = path.resolve(ownedDirectory);
  assertCondition(path.dirname(resolvedOwned) === path.resolve(outputDirectory),
    `Refusing to remove ${label} outside the exact output directory: ${resolvedOwned}`);
  assertCondition(path.basename(resolvedOwned).startsWith(prefix),
    `Refusing to remove ${label} without the owned prefix: ${resolvedOwned}`);
  assertCondition(existsSync(resolvedOwned) && !lstatSync(resolvedOwned).isSymbolicLink() && statSync(resolvedOwned).isDirectory(),
    `Owned ${label} must be a real directory: ${resolvedOwned}`);
  const canonicalOwned = realpathSync(resolvedOwned);
  const relation = path.relative(canonicalOutput, canonicalOwned);
  assertCondition(relation.length > 0 && relation !== ".." && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation),
    `Refusing to remove ${label} outside canonical output: ${canonicalOwned}`);
  rmSync(canonicalOwned, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return !existsSync(canonicalOwned);
}

function removeOwnedProfile(outputDirectory, profileDirectory) {
  return removeOwnedDirectory(outputDirectory, profileDirectory, PROFILE_PREFIX, "browser profile");
}

function removeOwnedRuntimeDirectory(outputDirectory, runtimeDirectory) {
  return removeOwnedDirectory(outputDirectory, runtimeDirectory, VITE_RUNTIME_PREFIX, "Vite runtime");
}

function snapshotUiInPage() {
  const root = document.querySelector("[data-worldgen-build-profile]");
  const title = document.querySelector(".game-version-badge");
  const badge = document.querySelector(".worldgen-rollback-badge");
  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
  };
  return {
    worldgenBuildProfile: root?.getAttribute("data-worldgen-build-profile") ?? null,
    titleText: title?.textContent?.trim() ?? null,
    titleMarkerVisible: visible(title),
    rollbackBadgeText: badge?.textContent?.trim() ?? null,
    rollbackBadgeRole: badge?.getAttribute("role") ?? null,
    rollbackBadgeAria: badge?.getAttribute("aria-label") ?? null,
    rollbackBadgeVisible: visible(badge),
    alerts: [...document.querySelectorAll('[role="alert"]')]
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean),
  };
}

async function observeWorldgenRollbackTitleUtilityVisuals(page) {
  return page.evaluate(async (expectedLabels) => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rounded = (value) => Math.round(Number(value) * 4) / 4;
    const boundsOf = (rect) => ({
      x: rounded(rect?.x ?? 0),
      y: rounded(rect?.y ?? 0),
      width: rounded(rect?.width ?? 0),
      height: rounded(rect?.height ?? 0),
    });
    const visual = (element, rect = element?.getBoundingClientRect()) => {
      if (!(element instanceof Element)) return {
        visible: false,
        inViewport: false,
        unoccluded: false,
        bounds: boundsOf(null),
      };
      const style = getComputedStyle(element);
      const bounds = boundsOf(rect);
      const visible = typeof element.checkVisibility === "function"
        ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0;
      const inViewport = bounds.width >= 1 && bounds.height >= 1
        && bounds.x >= 0 && bounds.y >= 0
        && bounds.x + bounds.width <= innerWidth && bounds.y + bounds.height <= innerHeight;
      const centerX = Math.max(0, Math.min(innerWidth - 1, bounds.x + bounds.width / 2));
      const centerY = Math.max(0, Math.min(innerHeight - 1, bounds.y + bounds.height / 2));
      const unoccluded = inViewport && document.elementsFromPoint(centerX, centerY)
        .some((hit) => hit === element || element.contains(hit) || hit.contains(element));
      return { visible, inViewport, unoccluded, bounds };
    };
    const textVisual = (element, text) => {
      if (!(element instanceof Element)) return {
        ...visual(null),
        fontReady: false,
        colorVisible: false,
      };
      const range = document.createRange();
      range.selectNodeContents(element);
      const style = getComputedStyle(element);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const colors = [style.color, style.webkitTextFillColor]
        .filter((color) => typeof color === "string" && color.length > 0);
      const colorVisible = colors.every((color) => color !== "transparent"
        && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/u.test(color));
      return {
        ...visual(element, range.getBoundingClientRect()),
        fontReady: document.fonts.check(font, text),
        colorVisible,
      };
    };
    const utility = document.querySelector(".title-screen-utility");
    const version = document.querySelector(".game-version-badge");
    const actions = document.querySelector(".title-screen-actions");
    const menu = document.querySelector(".title-main-menu[aria-label='Main menu']");
    const labels = actions instanceof Element
      ? [...actions.querySelectorAll(":scope > a, :scope > button")]
      : [];
    const buttons = menu instanceof Element
      ? [...menu.querySelectorAll(":scope > button.title-menu-choice")]
      : [];
    return {
      documentVisibility: document.visibilityState,
      fontsStatus: document.fonts.status,
      utility: visual(utility),
      version: {
        text: version?.textContent?.trim() ?? "",
        textVisual: textVisual(version, version?.textContent?.trim() ?? ""),
      },
      labels: labels.map((element) => ({
        text: element.textContent?.trim() ?? "",
        textVisual: textVisual(element, element.textContent?.trim() ?? ""),
      })),
      menu: visual(menu),
      buttons: buttons.map((button) => {
        const strong = button.querySelector(":scope > strong");
        const small = button.querySelector(":scope > small");
        return {
          label: strong?.textContent?.trim() ?? "",
          disabled: button instanceof HTMLButtonElement ? button.disabled : null,
          button: visual(button),
          strong: textVisual(strong, strong?.textContent?.trim() ?? ""),
          small: small
            ? { text: small.textContent?.trim() ?? "", ...textVisual(small, small.textContent?.trim() ?? "") }
            : null,
        };
      }),
      expectedLabels,
    };
  }, WORLDGEN_ROLLBACK_TITLE_UTILITY_LABELS);
}

async function waitForWorldgenRollbackTitleUtilityVisualReadiness(page, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  let stableSamples = [];
  let stableSignature = null;
  let lastObservation = null;
  let lastError = "No title utility visual observation completed.";
  while (Date.now() < deadline) {
    lastObservation = await observeWorldgenRollbackTitleUtilityVisuals(page);
    try {
      assertWorldgenRollbackTitleUtilityVisualReadiness({
        schema: 1,
        samples: [lastObservation, lastObservation, lastObservation],
      });
      const signature = worldgenRollbackTitleUtilitySignature(lastObservation);
      if (signature === stableSignature) stableSamples.push(lastObservation);
      else {
        stableSignature = signature;
        stableSamples = [lastObservation];
      }
      if (stableSamples.length >= WORLDGEN_ROLLBACK_TITLE_UTILITY_STABLE_SAMPLES) {
        return assertWorldgenRollbackTitleUtilityVisualReadiness({
          schema: 1,
          samples: stableSamples.slice(-WORLDGEN_ROLLBACK_TITLE_UTILITY_STABLE_SAMPLES),
        });
      }
    } catch (error) {
      stableSamples = [];
      stableSignature = null;
      lastError = error instanceof Error ? error.message : String(error);
    }
    await page.waitForTimeout(80);
  }
  const error = new Error(`Rollback title utility did not become visually ready: ${lastError}`);
  error.titleUtilityVisualReadinessEvidence = {
    schema: 1,
    expectedLabels: WORLDGEN_ROLLBACK_TITLE_UTILITY_LABELS,
    requiredStableSamples: WORLDGEN_ROLLBACK_TITLE_UTILITY_STABLE_SAMPLES,
    lastObservation,
  };
  throw error;
}

function decodeRollbackScreenshot(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assertCondition(source.subarray(0, signature.length).equals(signature), "Rollback screenshot is not a PNG.");
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressed = [];
  let offset = signature.length;
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assertCondition(dataEnd + 4 <= source.length, "Rollback screenshot PNG chunk is truncated.");
    const data = source.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      assertCondition(length === 13, "Rollback screenshot PNG header is malformed.");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assertCondition(data[8] === 8 && (data[9] === 2 || data[9] === 6) && data[10] === 0 && data[11] === 0 && data[12] === 0,
        "Rollback screenshot PNG uses an unsupported pixel format.");
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") compressed.push(data);
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  assertCondition(width > 0 && height > 0 && channels === 3, "Rollback screenshot PNG pixels are absent.");
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(compressed));
  assertCondition(inflated.length >= height * (rowBytes + 1), "Rollback screenshot PNG pixel data is truncated.");
  const pixels = Buffer.alloc(height * rowBytes);
  const paeth = (left, up, upperLeft) => {
    const estimate = left + up - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
    if (upDistance <= upperLeftDistance) return up;
    return upperLeft;
  };
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset++];
    const rowStart = y * rowBytes;
    const previousRowStart = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[inputOffset++];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[previousRowStart + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[previousRowStart + x - channels] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upperLeft);
      else assertCondition(filter === 0, `Rollback screenshot PNG filter ${filter} is unsupported.`);
      pixels[rowStart + x] = value & 0xff;
    }
  }
  return Object.freeze({ width, height, channels, pixels });
}

function rollbackScreenshotBrightPixelCount(decoded, bounds) {
  const xStart = Math.max(0, Math.floor(bounds?.x ?? 0));
  const yStart = Math.max(0, Math.floor(bounds?.y ?? 0));
  const xEnd = Math.min(decoded.width, Math.ceil((bounds?.x ?? 0) + (bounds?.width ?? 0)));
  const yEnd = Math.min(decoded.height, Math.ceil((bounds?.y ?? 0) + (bounds?.height ?? 0)));
  let count = 0;
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const offset = (y * decoded.width + x) * decoded.channels;
      const red = decoded.pixels[offset];
      const green = decoded.pixels[offset + 1];
      const blue = decoded.pixels[offset + 2];
      if (Math.min(red, green, blue) >= 180 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 100) count += 1;
    }
  }
  return count;
}

function assertRollbackTitleScreenshotPainted(buffer, observation) {
  const decoded = decodeRollbackScreenshot(buffer);
  const count = (element, label) => {
    const pixels = rollbackScreenshotBrightPixelCount(decoded, element?.bounds);
    assertCondition(pixels >= 3, `${label} has no painted screenshot pixels.`);
    return pixels;
  };
  const counts = {
    version: count(observation?.version?.textVisual, "Rollback version label"),
    labels: observation?.labels?.map((label) => count(label.textVisual, `Rollback ${label.text} label`)),
    buttons: observation?.buttons?.map((button) => ({
      label: button.label,
      strong: count(button.strong, `Rollback ${button.label} menu label`),
      ...(button.small?.text ? { small: count(button.small, `Rollback ${button.label} supporting text`) } : {}),
    })),
  };
  return Object.freeze({ width: decoded.width, height: decoded.height, counts });
}

async function capturePaintedRollbackTitleScreenshot(page, filePath, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  let stableSignature = null;
  let stableSamples = 0;
  let lastEvidence = null;
  let lastError = "No painted screenshot sample completed.";
  while (Date.now() < deadline) {
    try {
      const observation = await observeWorldgenRollbackTitleUtilityVisuals(page);
      assertWorldgenRollbackTitleUtilityVisualReadiness({ schema: 1, samples: [observation, observation, observation] });
      const buffer = await page.screenshot({ type: "png" });
      const painted = assertRollbackTitleScreenshotPainted(buffer, observation);
      const signature = JSON.stringify(painted.counts);
      if (signature === stableSignature) stableSamples += 1;
      else {
        stableSignature = signature;
        stableSamples = 1;
      }
      lastEvidence = { observation, painted };
      if (stableSamples >= WORLDGEN_ROLLBACK_TITLE_UTILITY_STABLE_SAMPLES) {
        writeFileSync(filePath, buffer);
        return Object.freeze({ schema: 1, stableSamples, ...painted });
      }
    } catch (error) {
      stableSignature = null;
      stableSamples = 0;
      lastError = error instanceof Error ? error.message : String(error);
    }
    await page.waitForTimeout(100);
  }
  const error = new Error(`Rollback title screenshot did not retain painted menu text: ${lastError}`);
  error.titleScreenshotPaintEvidence = { schema: 1, requiredStableSamples: WORLDGEN_ROLLBACK_TITLE_UTILITY_STABLE_SAMPLES, lastEvidence };
  throw error;
}

export async function runWorldgenRollbackBrowser(argv = process.argv, runContext = {}) {
  const options = parseWorldgenRollbackBrowserOptions(argv);
  if (options.help) return Object.freeze({ help: true, usage: usage() });
  const profileDirectory = { value: null };
  const viteRuntimeDirectory = { value: null };
  const artifactPrefixes = { value: [] };
  let playwright = null;
  let browserExecutable = null;
  const screenshots = Object.create(null);
  const consoleErrors = [];
  const pageErrors = [];
  const runtimeErrors = [];
  const httpErrors = [];
  const requestFailures = [];
  const expectedRequestCancellations = [];
  const artifactRequests = [];
  const canonicalAssetRequests = [];
  const documentAudits = [];
  const cleanup = {
    browserStarted: false,
    browserClosed: true,
    serverStarted: false,
    serverClosed: true,
    profileRemoved: false,
    environmentRestored: true,
    viteRuntimeRemoved: false,
  };
  let managed = null;
  let context = null;
  let page = null;
  let lastSnapshot = null;
  let result = null;
  const injectedSetupFailureAt = runContext.injectSetupFailureAt ?? null;
  const injectSetupFailure = (stage) => {
    if (injectedSetupFailureAt === stage) fail(`Injected rollback setup failure after ${stage}.`);
  };

  const addRuntimeErrors = (entries, label) => {
    for (const entry of entries ?? []) {
      const rendered = `${label}: ${typeof entry === "string" ? entry : JSON.stringify(entry)}`;
      if (!runtimeErrors.includes(rendered)) runtimeErrors.push(rendered);
    }
  };

  try {
    mkdirSync(options.outputDirectory, { recursive: true });
    resolveWorkOutputDirectory(options.repositoryRoot, options.outputDirectory);
    injectSetupFailure("output-directory");
    profileDirectory.value = mkdtempSync(path.join(options.outputDirectory, PROFILE_PREFIX));
    injectSetupFailure("browser-profile");
    viteRuntimeDirectory.value = mkdtempSync(path.join(options.outputDirectory, VITE_RUNTIME_PREFIX));
    injectSetupFailure("vite-runtime");
    artifactPrefixes.value = resolvePublicRustArtifactPrefixes(options.repositoryRoot);
    injectSetupFailure("artifact-prefixes");
    playwright = await loadPlaywright(options.playwrightModule);
    browserExecutable = discoverBrowserExecutable(options.browserExecutable);
    managed = await startManagedRollbackVite(options.repositoryRoot, viteRuntimeDirectory.value);
    cleanup.serverStarted = true;
    cleanup.serverClosed = false;
    cleanup.environmentRestored = false;
    context = await playwright.module.chromium.launchPersistentContext(profileDirectory.value, {
      headless: options.headless,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      viewport: { width: 1280, height: 720 },
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
    });
    cleanup.browserStarted = true;
    cleanup.browserClosed = false;
    await context.addInitScript(() => {
      localStorage.setItem("blockwild-settings-v2", JSON.stringify({
        renderDistance: 2,
        simulationDistance: 2,
        basicRenderDistance: 2,
        rememberedBasicRenderDistance: 2,
        resourceMode: "cpu",
      }));
    });
    await installBrowserAudit(context);
    await installManagedCanonicalAssetRoutes(context, options.repositoryRoot, canonicalAssetRequests);
    const auditRustArtifactRequest = async (route) => {
      const requestUrl = new URL(route.request().url());
      if (!isPublicRustArtifactRequestPath(requestUrl.pathname, artifactPrefixes.value)) {
        await route.fallback();
        return;
      }
      artifactRequests.push(Object.freeze({
        url: route.request().url(),
        method: route.request().method(),
        resourceType: route.request().resourceType(),
        blocked: true,
      }));
      await route.abort("blockedbyclient");
    };
    await context.route("**/*", auditRustArtifactRequest);
    page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(Math.min(options.timeoutMilliseconds, 45_000));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      consoleErrors.push(Object.freeze({ text: message.text(), location: message.location() }));
    });
    page.on("pageerror", (error) => pageErrors.push(Object.freeze({
      name: error?.name ?? null,
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    })));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (isPublicRustArtifactRequestPath(url.pathname, artifactPrefixes.value)) {
        if (!artifactRequests.some((entry) => entry.url === request.url())) artifactRequests.push(Object.freeze({
          url: request.url(), method: request.method(), resourceType: request.resourceType(), blocked: false,
        }));
      }
    });
    page.on("requestfailed", (request) => {
      const failure = Object.freeze({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failure: request.failure()?.errorText ?? "unknown request failure",
      });
      if (isExpectedWorldgenRollbackRequestCancellation(failure)) expectedRequestCancellations.push(failure);
      else requestFailures.push(failure);
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      httpErrors.push(Object.freeze({
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
        resourceType: response.request().resourceType(),
      }));
    });

    const readSnapshot = async () => {
      const [core, ui] = await Promise.all([
        page.evaluate(() => {
          try {
            const render = window.render_game_to_text;
            return {
              state: typeof render === "function" ? JSON.parse(render()) : null,
              audit: window.__blockwildWorldgenRollbackAudit
                ? structuredClone(window.__blockwildWorldgenRollbackAudit)
                : null,
            };
          } catch (error) {
            return {
              state: { __parseError: error instanceof Error ? error.message : String(error) },
              audit: window.__blockwildWorldgenRollbackAudit
                ? structuredClone(window.__blockwildWorldgenRollbackAudit)
                : null,
            };
          }
        }),
        page.evaluate(snapshotUiInPage),
      ]);
      return { ...core, ui };
    };

    const recordSnapshotErrors = (snapshot, label) => {
      lastSnapshot = snapshot;
      addRuntimeErrors(collectWorldgenRollbackRuntimeErrors(snapshot?.state), label);
      addRuntimeErrors(snapshot?.audit?.runtimeErrors, `${label}-browser-runtime`);
      if (snapshot?.state?.__parseError) addRuntimeErrors([snapshot.state.__parseError], `${label}-state-parse`);
      if (snapshot?.ui?.alerts?.length) addRuntimeErrors(snapshot.ui.alerts, `${label}-ui-alert`);
    };

    const waitForHarness = async () => {
      await page.waitForFunction(() => typeof window.render_game_to_text === "function", undefined, {
        timeout: Math.min(options.timeoutMilliseconds, 120_000),
      });
    };

    const readAndValidate = async (label, expectedState) => {
      const snapshot = await readSnapshot();
      recordSnapshotErrors(snapshot, label);
      assertWorldgenRollbackCheckpoint(snapshot, label, expectedState);
      return snapshot;
    };

    const waitForGameplay = async (label) => {
      const deadline = Date.now() + options.timeoutMilliseconds;
      let snapshot = null;
      while (Date.now() < deadline) {
        await page.waitForTimeout(300);
        snapshot = await readSnapshot();
        recordSnapshotErrors(snapshot, label);
        if (snapshot.state?.state !== "playing") continue;
        assertWorldgenRollbackCheckpoint(snapshot, label, "playing");
        assertWorldgenRollbackUi(snapshot.ui, "playing");
        return snapshot;
      }
      fail(`${label}: gameplay did not become active`, { snapshot });
    };

    const waitForImmediateRing = async (label) => {
      const deadline = Date.now() + Math.min(options.timeoutMilliseconds, 120_000);
      let snapshot = null;
      while (Date.now() < deadline) {
        await page.waitForTimeout(350);
        snapshot = await readSnapshot();
        recordSnapshotErrors(snapshot, label);
        if (snapshot.state?.state !== "playing") continue;
        assertWorldgenRollbackCheckpoint(snapshot, label, "playing");
        const ring = snapshot.state?.performance?.streaming?.immediateRing;
        if (ring?.desired === 9 && ring.ready === 9) return snapshot;
      }
      fail(`${label}: exact 9/9 immediate ring was not ready`, {
        immediateRing: snapshot?.state?.performance?.streaming?.immediateRing ?? null,
      });
    };

    const waitForStablePose = async (label) => {
      const deadline = Date.now() + 45_000;
      let prior = null;
      let stableSamples = 0;
      let snapshot = null;
      while (Date.now() < deadline) {
        await page.waitForTimeout(250);
        snapshot = await readAndValidate(label, "playing");
        const ring = snapshot.state.performance.streaming.immediateRing;
        const pose = poseFromState(snapshot.state, label);
        const velocity = snapshot.state.player?.velocity;
        assertCondition(Array.isArray(velocity) && velocity.length === 3, `${label}: player velocity is absent`);
        const stationary = velocity.every((value, index) => Math.abs(finite(value, `${label} velocity[${index}]`)) <= 0.01);
        const serialized = JSON.stringify(pose);
        if (ring?.desired === 9 && ring.ready === 9 && stationary && serialized === prior) stableSamples += 1;
        else stableSamples = 0;
        prior = serialized;
        if (stableSamples >= 3) return snapshot;
      }
      fail(`${label}: exact stationary pose did not stabilize`, { snapshot });
    };

    const capture = async (name) => {
      const filePath = path.join(options.outputDirectory, `${name}.png`);
      if (name === "title-after-save" || name === "title-after-full-reload") {
        // Chromium can expose complete DOM/font metrics one compositor pass before
        // the glyph atlas appears in a screenshot. Prime that capture path, then
        // re-prove the full menu is painted before retaining the evidence image.
        await page.screenshot({ type: "png" });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await waitForTerrainEditReloadTitleVisualReadiness(page, options.timeoutMilliseconds);
        await waitForWorldgenRollbackTitleUtilityVisualReadiness(page, options.timeoutMilliseconds);
        await capturePaintedRollbackTitleScreenshot(page, filePath, options.timeoutMilliseconds);
      } else {
        await page.screenshot({ path: filePath, type: "png" });
      }
      screenshots[name] = relativeEvidencePath(options.repositoryRoot, filePath);
      return screenshots[name];
    };

    await page.goto(`${managed.baseUrl}/`, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(options.timeoutMilliseconds, 120_000),
    });
    assertCondition(new URL(page.url()).search === "", "Rollback verifier must use the unmodified production route without experiment selectors.");
    await waitForHarness();
    let title = await readSnapshot();
    recordSnapshotErrors(title, "initial-title");
    assertWorldgenRollbackCheckpoint(title, "initial-title", "title");
    assertWorldgenRollbackUi(title.ui, "title");
    await capture("title-rollback-marker");

    await page.getByRole("button", { name: /Create New World/u }).click();
    await page.getByRole("heading", { name: "Create a New World" }).waitFor();
    await page.getByLabel("World name").fill(WORLD_FIXTURE.name);
    await page.getByLabel("World seed").fill(WORLD_FIXTURE.seed);
    await page.getByRole("button", { name: /^SURVIVAL/u }).click();
    await page.getByRole("button", { name: "Generate World" }).click({ noWaitAfter: true });

    await waitForGameplay("create");
    const createdRing = await waitForImmediateRing("create-ring");
    const created = await waitForStablePose("create-stable");
    assertCondition(created.state.world?.seed === WORLD_FIXTURE.seed, "Fresh rollback create changed the deterministic seed.");
    assertCondition(created.state.player?.mode === WORLD_FIXTURE.mode, "Fresh rollback create changed the selected mode.");
    assertWorldgenRollbackUi(created.ui, "playing");
    await capture("created-9-of-9-rollback-badge");

    await page.keyboard.press("Escape");
    await page.getByRole("heading", { name: "Game Paused" }).waitFor();
    const paused = await readAndValidate("paused-before-save", "paused");
    assertWorldgenRollbackUi(paused.ui, "playing");
    await capture("paused-before-save");
    await page.getByRole("button", { name: "Save & Quit to Title" }).click({ noWaitAfter: true });
    const continueButton = page.getByRole("button", { name: /Continue/u });
    await continueButton.waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => [...document.querySelectorAll("button")]
      .some((button) => /Continue/u.test(button.textContent ?? "") && !button.disabled), undefined, { timeout: 120_000 });
    title = await readSnapshot();
    recordSnapshotErrors(title, "title-after-save");
    assertWorldgenRollbackCheckpoint(title, "title-after-save", "title");
    assertWorldgenRollbackUi(title.ui, "title");
    await waitForTerrainEditReloadTitleVisualReadiness(page, options.timeoutMilliseconds);
    await capture("title-after-save");
    const firstDocumentFinal = await readSnapshot();
    recordSnapshotErrors(firstDocumentFinal, "first-document-final");
    assertWorldgenRollbackCheckpoint(firstDocumentFinal, "first-document-final", "title");
    documentAudits.push(Object.freeze({ navigation: 1, ...firstDocumentFinal.audit }));

    await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(options.timeoutMilliseconds, 120_000) });
    assertCondition(new URL(page.url()).search === "", "Full page reload introduced an experimental route selector.");
    await waitForHarness();
    const reloadedTitle = await readSnapshot();
    recordSnapshotErrors(reloadedTitle, "reloaded-title");
    assertWorldgenRollbackCheckpoint(reloadedTitle, "reloaded-title", "title");
    assertWorldgenRollbackUi(reloadedTitle.ui, "title");
    const freshContinue = page.getByRole("button", { name: /Continue/u });
    await freshContinue.waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => [...document.querySelectorAll("button")]
      .some((button) => /Continue/u.test(button.textContent ?? "") && !button.disabled), undefined, { timeout: 120_000 });
    await waitForTerrainEditReloadTitleVisualReadiness(page, options.timeoutMilliseconds);
    await capture("title-after-full-reload");
    await freshContinue.click({ noWaitAfter: true });
    await waitForGameplay("continue-after-full-reload");
    const reloadedRing = await waitForImmediateRing("continue-ring");
    const continued = await waitForStablePose("continue-stable");
    assertWorldgenRollbackUi(continued.ui, "playing");
    const persistence = assertExactWorldgenRollbackPersistence(paused, continued);
    await capture("continued-9-of-9-rollback-badge");
    const secondDocumentFinal = await readAndValidate("second-document-final", "playing");
    assertWorldgenRollbackUi(secondDocumentFinal.ui, "playing");
    documentAudits.push(Object.freeze({ navigation: 2, ...secondDocumentFinal.audit }));

    const noRustGeneration = assertNoRustGenerationBrowserActivity({ audits: documentAudits, artifactRequests });
    assertWorldgenRollbackErrorStreams({ consoleErrors, pageErrors, runtimeErrors, httpErrors, requestFailures });
    result = {
      schema: 1,
      gate: "blockwild-worldgen-typescript-rollback-browser-v1",
      status: "passed",
      createdAt: new Date().toISOString(),
      authorityClaim: "terrain-typescript-rollback-browser-evidence-only",
      buildProfile: WORLDGEN_ROLLBACK_PROFILE,
      selectionSource: WORLDGEN_ROLLBACK_SELECTION_SOURCE,
      fixture: WORLD_FIXTURE,
      harness: {
        baseUrl: managed.baseUrl,
        managedProgrammaticVite: true,
        port: managed.port,
        hmr: managed.inlineConfig.server.hmr,
        watch: managed.inlineConfig.server.watch,
        candidateAlias: false,
        productionRouteSearch: "",
        browserOwnership: "playwright-persistent-context",
        browserProfileToken: path.basename(profileDirectory.value),
        viteRuntimeToken: path.basename(viteRuntimeDirectory.value),
        browserExecutable: browserExecutable ?? "playwright-managed",
        playwrightSource: playwright.source,
      },
      coverage: {
        visibleTitleRollbackMarker: "passed",
        deterministicProductionUiCreate: "passed",
        initialImmediateRing: `${createdRing.state.performance.streaming.immediateRing.ready}/${createdRing.state.performance.streaming.immediateRing.desired}`,
        visibleGameplayRollbackBadgeAndAria: "passed",
        generationDiagnostics: "typescript/build-typescript-rollback",
        zeroGenerationWorkersRestartsFailures: "passed",
        noRustGenerationCertificatesOrArtifactRequests: "passed",
        saveAndQuit: "passed",
        fullPageReload: "passed",
        continueAfterReload: "passed",
        continuedImmediateRing: `${reloadedRing.state.performance.streaming.immediateRing.ready}/${reloadedRing.state.performance.streaming.immediateRing.desired}`,
        exactSeedModePoseAndEditNeutralPersistence: "passed",
      },
      noRustGeneration,
      persistence,
      workerAudits: documentAudits,
      artifactPrefixes: artifactPrefixes.value,
      artifactRequests,
      managedCanonicalAssetRequests: canonicalAssetRequests,
      checkpoints: {
        created: created.state,
        paused: paused.state,
        continued: continued.state,
      },
      screenshots,
      consoleErrors,
      pageErrors,
      runtimeErrors,
      httpErrors,
      requestFailures,
      expectedRequestCancellations,
      cleanup,
      exclusions: {
        scope: "This gate proves only the compile-time TypeScript terrain-generation rollback path and its local save/reload lifecycle.",
        playerEdits: "No edit is performed; the gate requires exact edit-neutral diagnostics before and after reload.",
        rustSimulationAndRendering: "Rust simulation, player-authority, renderer, and broader migration acceptance are outside this terrain rollback gate.",
      },
    };
  } catch (error) {
    if (lastSnapshot) {
      addRuntimeErrors(collectWorldgenRollbackRuntimeErrors(lastSnapshot.state), "failure-snapshot");
      addRuntimeErrors(lastSnapshot.audit?.runtimeErrors, "failure-browser-runtime");
    }
    if (page) {
      const failurePath = path.join(options.outputDirectory, "failed.png");
      await page.screenshot({ path: failurePath, type: "png" }).then(() => {
        screenshots.failed = relativeEvidencePath(options.repositoryRoot, failurePath);
      }).catch(() => {});
    }
    result = {
      schema: 1,
      gate: "blockwild-worldgen-typescript-rollback-browser-v1",
      status: "failed",
      createdAt: new Date().toISOString(),
      authorityClaim: "none",
      buildProfile: WORLDGEN_ROLLBACK_PROFILE,
      selectionSource: WORLDGEN_ROLLBACK_SELECTION_SOURCE,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      state: lastSnapshot?.state ?? null,
      ui: lastSnapshot?.ui ?? null,
      workerAudits: documentAudits,
      artifactPrefixes: artifactPrefixes.value,
      artifactRequests,
      managedCanonicalAssetRequests: canonicalAssetRequests,
      screenshots,
      consoleErrors,
      pageErrors,
      runtimeErrors,
      httpErrors,
      requestFailures,
      expectedRequestCancellations,
      cleanup,
    };
  } finally {
    if (context) {
      await context.close().then(() => { cleanup.browserClosed = true; }).catch((error) => {
        runtimeErrors.push(`browser cleanup: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (managed) {
      await managed.server.close().then(() => { cleanup.serverClosed = true; }).catch((error) => {
        runtimeErrors.push(`Vite cleanup: ${error instanceof Error ? error.message : String(error)}`);
      });
      if (managed.server.httpServer?.listening === true) {
        cleanup.serverClosed = false;
        runtimeErrors.push("Vite cleanup: the exact owned HTTP server remains listening after close().");
      }
      try {
        cleanup.environmentRestored = managed.restoreEnvironment();
      } catch (error) {
        runtimeErrors.push(`environment cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!viteRuntimeDirectory.value) {
      cleanup.viteRuntimeRemoved = true;
    } else if (cleanup.serverClosed) {
      try {
        cleanup.viteRuntimeRemoved = removeOwnedRuntimeDirectory(options.outputDirectory, viteRuntimeDirectory.value);
      } catch (error) {
        runtimeErrors.push(`Vite runtime cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      runtimeErrors.push("Vite runtime cleanup refused because the exact owned server did not close.");
    }
    if (!profileDirectory.value) {
      cleanup.profileRemoved = true;
    } else if (cleanup.browserClosed) {
      try {
        cleanup.profileRemoved = removeOwnedProfile(options.outputDirectory, profileDirectory.value);
      } catch (error) {
        runtimeErrors.push(`profile cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      runtimeErrors.push("Browser profile cleanup refused because the exact owned browser context did not close.");
    }
    if (!cleanup.browserClosed || !cleanup.serverClosed || !cleanup.profileRemoved || !cleanup.environmentRestored
      || !cleanup.viteRuntimeRemoved
      || consoleErrors.length || pageErrors.length || runtimeErrors.length || httpErrors.length || requestFailures.length
      || artifactRequests.length) {
      result = {
        ...result,
        status: "failed",
        authorityClaim: "none",
        error: result?.error ?? "Rollback browser, Vite, profile, network, or error-stream cleanup gate failed.",
      };
    }
    Object.assign(result, {
      cleanup,
      screenshots,
      artifactRequests,
      consoleErrors,
      pageErrors,
      runtimeErrors,
      httpErrors,
      requestFailures,
    });
    writeFileSync(path.join(options.outputDirectory, "errors.json"), `${JSON.stringify({
      consoleErrors, pageErrors, runtimeErrors, httpErrors, requestFailures, artifactRequests,
      expectedRequestCancellations,
    }, null, 2)}\n`, "utf8");
    writeFileSync(path.join(options.outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return Object.freeze({ ...result, outputPath: path.join(options.outputDirectory, "result.json") });
}

function usage() {
  return `Usage: node scripts/verify-worldgen-rollback-browser.mjs \\
  --output <directory strictly beneath work/> \\
  [--timeout-ms <30000..900000>] [--playwright-module <path>] \\
  [--browser-executable <path>] [--headed]\n\nThe verifier always starts and owns a fresh programmatic Vite server compiled with BLOCKWILD_WORLDGEN_BUILD_PROFILE=typescript-rollback. Candidate engine aliasing and Rust experiment selectors are disabled.\n`;
}

async function main() {
  try {
    const result = await runWorldgenRollbackBrowser(process.argv);
    if (result.help) {
      process.stdout.write(result.usage);
      return;
    }
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      buildProfile: result.buildProfile,
      selectionSource: result.selectionSource,
      coverage: result.coverage ?? null,
      screenshots: result.screenshots,
      cleanup: result.cleanup,
      outputPath: result.outputPath,
      error: result.error ?? null,
    }, null, 2)}\n`);
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Worldgen rollback browser verifier failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectInvocation(import.meta.url)) await main();
