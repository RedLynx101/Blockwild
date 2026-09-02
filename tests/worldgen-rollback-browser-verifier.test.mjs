import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  WORLDGEN_ROLLBACK_BADGE_ARIA,
  WORLDGEN_ROLLBACK_PROFILE,
  WORLDGEN_ROLLBACK_SELECTION_SOURCE,
  assertExactWorldgenRollbackPersistence,
  assertNoRustGenerationBrowserActivity,
  assertWorldgenRollbackCheckpoint,
  assertWorldgenRollbackErrorStreams,
  isExpectedWorldgenRollbackRequestCancellation,
  assertWorldgenRollbackUi,
  collectWorldgenRollbackRuntimeErrors,
  isPublicRustArtifactRequestPath,
  parseWorldgenRollbackBrowserOptions,
  resolvePublicRustArtifactPrefixes,
  worldgenRollbackManagedViteInlineConfig,
  worldgenRollbackManagedViteWrapperSource,
  worldgenRollbackViteEnvironment,
} from "../scripts/verify-worldgen-rollback-browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "verify-worldgen-rollback-browser.mjs");

function argv(...options) {
  return ["node", "scripts/verify-worldgen-rollback-browser.mjs", ...options];
}

function playerEdits() {
  const empty = { count: 0, p50Milliseconds: 0, p95Milliseconds: 0, maxMilliseconds: 0 };
  return {
    total: 0,
    byKind: { break: 0, place: 0, "tree-fell": 0 },
    pendingConsolidationTransactions: 0,
    inputToMutation: { ...empty },
    mutationToStaleGeometryHidden: { ...empty },
    mutationToLocalMeshVisible: { ...empty },
    localMeshToConsolidated: { ...empty },
    treeProxyAfterStaleGeometryHidden: { ...empty },
    last: null,
  };
}

function healthySnapshot(state = "playing") {
  return {
    state: {
      state,
      player: {
        position: [4, 43.51, 0],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        mode: "survival",
      },
      world: { seed: "ROLLBACK-TERRAIN-824" },
      performance: {
        streaming: {
          generationWorker: {
            mode: "typescript",
            selectionSource: WORLDGEN_ROLLBACK_SELECTION_SOURCE,
            state: "typescript-rollback",
            authorityRequired: false,
            acceptingRequests: false,
            rollbackRequiresWorldReload: true,
            supported: false,
            workers: 0,
            ready: 0,
            busy: 0,
            submitted: 0,
            completed: 0,
            failed: 0,
            stale: 0,
            canceled: 0,
            rejected: 0,
            transferBytes: 0,
            restarts: 0,
            staleResults: 0,
            lastError: null,
          },
          terrainWorker: { failed: 0, restarts: 0, lastError: null },
          rustTerrain: {
            mode: "off",
            fallback: 0,
            parityMismatches: 0,
            installFailures: 0,
            lastMismatch: null,
          },
          rustWorldAuthority: {
            configuredMode: "off",
            failures: 0,
            restarts: 0,
            lastFallbackReason: null,
          },
          immediateRing: { desired: 9, ready: 9 },
          playerEdits: playerEdits(),
        },
      },
    },
  };
}

test("rollback browser CLI owns its server and limits output to work", () => {
  const parsed = parseWorldgenRollbackBrowserOptions(argv(
    "--output", "work/worldgen-rollback-browser-unit",
    "--timeout-ms", "30000",
  ), { cwd: ROOT });
  assert.equal(parsed.outputDirectory, path.join(ROOT, "work", "worldgen-rollback-browser-unit"));
  assert.equal(parsed.timeoutMilliseconds, 30_000);
  assert.equal(parsed.headless, true);

  assert.throws(() => parseWorldgenRollbackBrowserOptions(argv(
    "--output", "outside-work",
  ), { cwd: ROOT }), /strictly beneath/u);
  assert.throws(() => parseWorldgenRollbackBrowserOptions(argv(
    "--output", "work/worldgen-rollback-browser-unit",
    "--output", "work/duplicate",
  ), { cwd: ROOT }), /may only be provided once/u);
  assert.throws(() => parseWorldgenRollbackBrowserOptions(argv(
    "--output", "work/worldgen-rollback-browser-unit",
    "--base-url", "http:\/\/127.0.0.1:5173",
  ), { cwd: ROOT }), /Unknown option/u);
  assert.throws(() => parseWorldgenRollbackBrowserOptions(argv(
    "--output", "work/worldgen-rollback-browser-unit",
    "--expected-artifact-hash", "a".repeat(64),
  ), { cwd: ROOT }), /Unknown option/u);
  assert.throws(() => parseWorldgenRollbackBrowserOptions(argv(
    "--output", "work/worldgen-rollback-browser-unit",
    "--timeout-ms", "29999",
  ), { cwd: ROOT }), /30000 through 900000/u);
});

test("managed rollback Vite is mutable, HMR-free, watcher-free, and candidate-free", () => {
  const runtimeDirectory = path.join(ROOT, "work", "worldgen-rollback-browser-unit-runtime");
  const environment = worldgenRollbackViteEnvironment({
    KEEP_ME: "yes",
    BLOCKWILD_WORLDGEN_BUILD_PROFILE: "rust-primary",
    BLOCKWILD_RUST_ENGINE_CANDIDATE_ALIAS: "1",
    NEXT_PUBLIC_BLOCKWILD_EXPERIMENTAL_RUST_LIVE_PLAYER_AUTHORITY_R5: "1",
    NEXT_PUBLIC_BLOCKWILD_RUST_TERRAIN_MESHER: "promote",
    NEXT_PUBLIC_BLOCKWILD_RUST_WORLD_AUTHORITY: "authority",
  }, runtimeDirectory);
  assert.equal(environment.KEEP_ME, "yes");
  assert.equal(environment.BLOCKWILD_WORLDGEN_BUILD_PROFILE, WORLDGEN_ROLLBACK_PROFILE);
  assert.equal(Object.hasOwn(environment, "BLOCKWILD_RUST_ENGINE_CANDIDATE_ALIAS"), false);
  assert.equal(Object.hasOwn(environment, "NEXT_PUBLIC_BLOCKWILD_EXPERIMENTAL_RUST_LIVE_PLAYER_AUTHORITY_R5"), false);
  assert.equal(Object.hasOwn(environment, "NEXT_PUBLIC_BLOCKWILD_RUST_TERRAIN_MESHER"), false);
  assert.equal(Object.hasOwn(environment, "NEXT_PUBLIC_BLOCKWILD_RUST_WORLD_AUTHORITY"), false);
  assert.equal(environment.WRANGLER_WRITE_LOGS, "false");
  assert.equal(environment.WRANGLER_SEND_METRICS, "false");
  assert.equal(environment.WRANGLER_LOG_PATH, path.join(runtimeDirectory, "wrangler", "wrangler.log"));
  assert.equal(environment.MINIFLARE_REGISTRY_PATH, path.join(runtimeDirectory, "miniflare", "registry"));

  const config = worldgenRollbackManagedViteInlineConfig(ROOT, 51_733, runtimeDirectory);
  assert.equal(config.root, realpathSync(ROOT));
  assert.equal(config.configFile, path.join(runtimeDirectory, "vite.config.mjs"));
  assert.equal(config.configLoader, "runner");
  assert.equal(config.cacheDir, path.join(runtimeDirectory, "node_modules", ".vite"));
  assert.equal(config.server.host, "127.0.0.1");
  assert.equal(config.server.port, 51_733);
  assert.equal(config.server.strictPort, true);
  assert.equal(config.server.hmr, false);
  assert.equal(typeof config.server.watch.ignored, "function");
  assert.equal(config.server.watch.ignored(path.join(ROOT, "app", "page.tsx")), true);
  assert.equal(config.server.watch.ignored(config.configFile), true);
  config.server.open = false;
  assert.equal(config.server.open, false);
  const wrapper = worldgenRollbackManagedViteWrapperSource(ROOT, runtimeDirectory);
  assert.match(wrapper, /import baseConfig from "file:\/\/\//u);
  assert.match(wrapper, /persistState:/u);
  assert.equal(wrapper.includes(JSON.stringify(path.join(runtimeDirectory, "node_modules", ".vite"))), true);
  assert.equal(wrapper.includes(JSON.stringify(path.join(runtimeDirectory, "cloudflare-state"))), true);
  assert.match(wrapper, /vite-plugin-cloudflare:/u);
  assert.match(wrapper, /vinext:google-fonts/u);
  assert.match(wrapper, /const resolvedBaseConfig = typeof baseConfig === "function"/u);
  assert.match(wrapper, /\? await baseConfig\(rollbackConfigEnvironment\)/u);
  assert.match(wrapper, /export default \{/u);
  assert.doesNotMatch(wrapper, /export default async function/u);
  assert.throws(() => worldgenRollbackManagedViteInlineConfig(ROOT, 0, runtimeDirectory), /port must be an integer/u);
  assert.throws(() => worldgenRollbackManagedViteInlineConfig(ROOT, 65_536, runtimeDirectory), /port must be an integer/u);
  assert.throws(() => worldgenRollbackManagedViteInlineConfig(ROOT, 51_733, path.join(ROOT, "outside-work")), /strictly beneath/u);
});

test("rollback diagnostics require exact TypeScript selection and zero generation workers", () => {
  const snapshot = healthySnapshot();
  const evidence = assertWorldgenRollbackCheckpoint(snapshot, "healthy", "playing");
  assert.equal(evidence.generation.mode, "typescript");
  assert.equal(evidence.generation.selectionSource, WORLDGEN_ROLLBACK_SELECTION_SOURCE);
  assert.equal(evidence.generation.workers, 0);
  assert.equal(evidence.generation.restarts, 0);
  assert.equal(evidence.generation.failed, 0);
  assert.deepEqual(evidence.runtimeErrors, []);

  const mutations = [
    ["Rust mode", (value) => { value.state.performance.streaming.generationWorker.mode = "rust"; }, /generation mode/u],
    ["default selector", (value) => { value.state.performance.streaming.generationWorker.selectionSource = "default-rust"; }, /selection source/u],
    ["ready state", (value) => { value.state.performance.streaming.generationWorker.state = "ready"; }, /generation state/u],
    ["worker allocated", (value) => { value.state.performance.streaming.generationWorker.workers = 1; }, /workers must be zero/u],
    ["worker restart", (value) => { value.state.performance.streaming.generationWorker.restarts = 1; }, /restarts must be zero/u],
    ["generation failure", (value) => { value.state.performance.streaming.generationWorker.failed = 1; }, /failed must be zero/u],
    ["certificate path rejected", (value) => { value.state.performance.streaming.generationWorker.supported = true; }, /unexpectedly became active/u],
    ["Rust mesher", (value) => { value.state.performance.streaming.rustTerrain.mode = "promote"; }, /mesher is not off/u],
    ["Rust world", (value) => { value.state.performance.streaming.rustWorldAuthority.configuredMode = "authority"; }, /world authority is not off/u],
    ["player edit", (value) => { value.state.performance.streaming.playerEdits.total = 1; }, /player edit total must be zero/u],
  ];
  for (const [label, mutate, pattern] of mutations) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.throws(() => assertWorldgenRollbackCheckpoint(changed, label), pattern);
  }
});

test("rollback runtime errors and browser errors remain fail-closed", () => {
  const snapshot = healthySnapshot();
  snapshot.state.performance.streaming.terrainWorker.lastError = "buffer worker failed";
  snapshot.state.performance.streaming.rustTerrain.fallback = 1;
  assert.deepEqual(collectWorldgenRollbackRuntimeErrors(snapshot.state), [
    "terrainWorker.lastError: buffer worker failed",
    "Rust terrain fallbacks: 1",
  ]);
  assert.throws(() => assertWorldgenRollbackCheckpoint(snapshot, "runtime-failed"), /buffer worker failed/u);

  const healthyStreams = {
    consoleErrors: [],
    pageErrors: [],
    runtimeErrors: [],
    httpErrors: [],
    requestFailures: [],
  };
  assert.equal(assertWorldgenRollbackErrorStreams(healthyStreams), true);
  for (const stream of Object.keys(healthyStreams)) {
    const changed = structuredClone(healthyStreams);
    changed[stream].push({ message: "unfiltered" });
    assert.throws(() => assertWorldgenRollbackErrorStreams(changed), new RegExp(`${stream} contains 1 error`, "u"));
  }
});

test("only exact loopback MP3 aborts are classified as benign navigation cancellations", () => {
  const expected = {
    url: "http://127.0.0.1:5173/music/blockwild-theme.mp3",
    method: "GET",
    resourceType: "media",
    failure: "net::ERR_ABORTED",
  };
  assert.equal(isExpectedWorldgenRollbackRequestCancellation(expected), true);
  for (const changed of [
    { ...expected, url: "https://blockwild.app/music/blockwild-theme.mp3" },
    { ...expected, url: "http://127.0.0.1:5173/engine/runtime.mp3" },
    { ...expected, url: "http://127.0.0.1:5173/music/theme.ogg" },
    { ...expected, url: `${expected.url}?unexpected=1` },
    { ...expected, method: "POST" },
    { ...expected, resourceType: "fetch" },
    { ...expected, failure: "net::ERR_FAILED" },
  ]) assert.equal(isExpectedWorldgenRollbackRequestCancellation(changed), false);
});

test("rollback UI requires the exact visible title and gameplay disclosure", () => {
  assert.equal(assertWorldgenRollbackUi({
    worldgenBuildProfile: WORLDGEN_ROLLBACK_PROFILE,
    titleMarkerVisible: true,
    titleText: `Blockwild v1.12 · ${"TERRAIN ROLLBACK"}`,
  }, "title"), true);
  assert.equal(assertWorldgenRollbackUi({
    worldgenBuildProfile: WORLDGEN_ROLLBACK_PROFILE,
    rollbackBadgeVisible: true,
    rollbackBadgeRole: "status",
    rollbackBadgeAria: WORLDGEN_ROLLBACK_BADGE_ARIA,
    rollbackBadgeText: "ROLLBACK BUILD TYPESCRIPT TERRAIN · RELOAD REQUIRED",
  }, "playing"), true);
  assert.throws(() => assertWorldgenRollbackUi({
    worldgenBuildProfile: "rust-primary",
    titleMarkerVisible: true,
    titleText: "TERRAIN ROLLBACK",
  }, "title"), /DOM build profile/u);
  assert.throws(() => assertWorldgenRollbackUi({
    worldgenBuildProfile: WORLDGEN_ROLLBACK_PROFILE,
    rollbackBadgeVisible: true,
    rollbackBadgeRole: "status",
    rollbackBadgeAria: "Terrain fallback",
    rollbackBadgeText: "ROLLBACK BUILD TYPESCRIPT TERRAIN · RELOAD REQUIRED",
  }, "playing"), /badge ARIA/u);
});

test("worker and request audit forbids generation workers, certificates, and every engine path", () => {
  const healthy = {
    audits: [1, 2].map((navigation) => ({
      navigation,
      schema: 1,
      sentinel: "blockwild-worldgen-rollback-audit-v1",
      workerInstrumentation: true,
      sharedWorkerInstrumentation: "unavailable",
      workers: navigation === 1 ? [
        { kind: "Worker", url: "/app/game/terrain-buffer-worker.ts", name: null },
        { kind: "Worker", url: "/app/game/basic-world-worker.ts", name: null },
      ] : [],
      certificates: [],
      runtimeErrors: [],
    })),
    artifactRequests: [],
  };
  assert.deepEqual(assertNoRustGenerationBrowserActivity(healthy), {
    generationWorkers: 0,
    generationCertificates: 0,
    artifactRequests: 0,
  });

  const withGenerationWorker = structuredClone(healthy);
  withGenerationWorker.audits[0].workers.push({
    kind: "Worker",
    url: "/app/game/terrain-generation-worker.ts?worker_file&type=module",
    name: null,
  });
  assert.throws(() => assertNoRustGenerationBrowserActivity(withGenerationWorker), /Rust generation Worker/u);

  const withCertificate = structuredClone(healthy);
  withCertificate.audits[0].certificates.push({ corpusCases: 155 });
  assert.throws(() => assertNoRustGenerationBrowserActivity(withCertificate), /generation certificate/u);

  const withArtifact = structuredClone(healthy);
  withArtifact.artifactRequests.push({ url: "http://127.0.0.1:5173/engine-locator-candidate/manifest.json" });
  assert.throws(() => assertNoRustGenerationBrowserActivity(withArtifact), /Rust artifact path/u);

  const missingAudit = structuredClone(healthy);
  missingAudit.audits[1] = null;
  assert.throws(() => assertNoRustGenerationBrowserActivity(missingAudit), /audit 2 is absent/u);
  const malformedAudit = structuredClone(healthy);
  malformedAudit.audits[0].schema = 0;
  assert.throws(() => assertNoRustGenerationBrowserActivity(malformedAudit), /wrong schema/u);
});

test("every tracked public Rust artifact root is discovered and classified", () => {
  const prefixes = resolvePublicRustArtifactPrefixes(ROOT);
  assert.deepEqual(prefixes, [
    "/engine",
    "/engine-locator-candidate",
    "/engine-r5-candidate",
    "/engine-r5-debug",
  ]);
  for (const prefix of prefixes) {
    assert.equal(isPublicRustArtifactRequestPath(prefix, prefixes), true);
    assert.equal(isPublicRustArtifactRequestPath(`${prefix}/manifest.json`, prefixes), true);
  }
  assert.equal(isPublicRustArtifactRequestPath("/%65ngine/manifest.json", prefixes), true);
  assert.equal(isPublicRustArtifactRequestPath("/engine-lab", prefixes), false);
  assert.equal(isPublicRustArtifactRequestPath("/brand/engine-icon.png", prefixes), false);
});

test("save/reload comparison requires exact seed, mode, pose, and edit-neutral state", () => {
  const before = healthySnapshot("paused");
  const after = healthySnapshot("playing");
  const persistence = assertExactWorldgenRollbackPersistence(before, after);
  assert.deepEqual(persistence.pose, { position: [4, 43.51, 0], yaw: 0, pitch: 0 });
  assert.equal(persistence.seed, "ROLLBACK-TERRAIN-824");
  assert.equal(persistence.mode, "survival");

  const moved = structuredClone(after);
  moved.state.player.position[0] = 4.01;
  assert.throws(() => assertExactWorldgenRollbackPersistence(before, moved), /changed the exact rollback pose/u);
  const edited = structuredClone(after);
  edited.state.performance.streaming.playerEdits.total = 1;
  edited.state.performance.streaming.playerEdits.byKind.place = 1;
  assert.throws(() => assertExactWorldgenRollbackPersistence(before, edited), /player edit total must be zero/u);
});

test("tracked verifier retains the full managed production UI lifecycle", () => {
  const source = readFileSync(SCRIPT, "utf8");
  for (const pattern of [
    /vite\.createServer\(inlineConfig\)/u,
    /launchPersistentContext\(profileDirectory/u,
    /Create New World/u,
    /Generate World/u,
    /desired === 9 && ring\.ready === 9/u,
    /Save & Quit to Title/u,
    /page\.reload\(/u,
    /name: \/Continue\/u/u,
    /worldgen-rollback-badge/u,
    /TERRAIN ROLLBACK/u,
    /BLOCKWILD_RUST_ENGINE_CANDIDATE_ALIAS/u,
  ]) assert.match(source, pattern);
  assert.doesNotMatch(source, /runR5PlayerBrowser/u);
});
