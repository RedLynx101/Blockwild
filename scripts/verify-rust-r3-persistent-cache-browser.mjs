/**
 * Unmeasured, real IndexedDB cache gate. Run only in the serialized browser lane:
 * node --import tsx scripts/verify-rust-r3-persistent-cache-browser.mjs --output work/<fresh-directory>
 *
 * Uses the canonical compatibility artifact, default compiled Rust world,
 * independent production-worker corpus oracle, and two fresh same-origin pages.
 * Retains cold/restore state, screenshots, immutable requests and cleanup proof.
 * Review cold.png + restore.png manually; no authority/performance promotion.
 */
import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRustEngineSourceSnapshot, isDirectInvocation, parseCommandLine, sha256, validatePublishedArtifacts } from "./rust-engine-common.mjs";
import { acquireManagedBrowserGateMutex } from "./verify-rust-r5-player-browser.mjs";
import {
  buildR3ProductionWorkerCorpus, r3ProductionWorkerAsset, resolveR3ProductionWorkerOutput,
  runR3WorkerSkillClient, selectR3ProductionWorkerArtifact,
} from "./verify-rust-generation-production-worker.mjs";
import { closeR3PerformanceResources, r3PerformanceBuildDefinition } from "./benchmark-r3-generation-browser.mjs";
import { normalizeWorldGenerationOptions } from "../app/game/world.ts";
import { decodeR3WorkerExpectedChunk } from "../tests/fixtures/r3-production-worker-contract.ts";
import { r3PerformanceRequest } from "../tests/fixtures/r3-generation-performance-contract.ts";
import {
  assertR3CachePageEvidence, assertR3PersistentCacheEvidence, r3CacheChunkProof,
  R3_PERSISTENT_CACHE_ARTIFACT, R3_PERSISTENT_CACHE_CASE,
} from "../tests/fixtures/r3-persistent-cache-contract.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = "tests/fixtures/r3-persistent-cache.html";
const OWN_FILES = [ENTRY, "tests/fixtures/r3-persistent-cache.ts", "tests/fixtures/r3-persistent-cache-contract.ts",
  "tests/r3-persistent-cache-verifier.test.ts", "scripts/verify-rust-r3-persistent-cache-browser.mjs",
  "scripts/verify-rust-generation-production-worker.mjs", "scripts/benchmark-r3-generation-browser.mjs",
  "scripts/lib/rust-worldgen-promotion-corpus.ts", "tests/fixtures/r3-production-worker-contract.ts",
  "tests/fixtures/r3-generation-performance-contract.ts", "tests/fixtures/rust-engine/r3/promotion-corpus.json",
  "tests/fixtures/rust-engine/r3/promotion-options-extension.json"];
const OPTIONS = {
  "expected-artifact-hash": { type: "string", default: R3_PERSISTENT_CACHE_ARTIFACT },
  output: { type: "string", default: null },
  "skill-review": { type: "boolean", default: true },
};

export function r3PersistentCacheKey(entry) {
  assert.equal(entry.id, R3_PERSISTENT_CACHE_CASE); assert(!entry.edits?.length, "persistent cache target must use the existing unedited POI case");
  return `terrain-v5|g18|${entry.seed}|${JSON.stringify(normalizeWorldGenerationOptions(entry.options))}|${entry.chunk.join(",")}|0.0.0.0.0.0.0.0.0`;
}

export function assertR3PersistentCacheBrowserErrors(errors) {
  assert(Array.isArray(errors), "browser error evidence must be an array");
  assert.equal(errors.length, 0, "browser errors were observed, including during owned cleanup");
}

export function auditR3PersistentCacheFixture(repositoryRoot = ROOT) {
  const text = readFileSync(path.join(repositoryRoot, "tests/fixtures/r3-persistent-cache.ts"), "utf8");
  assert.match(text, /const world = new ChunkWorld\(\)/u, "fixture must use the default constructor");
  assert(!/new ChunkWorld\(\s*\{|workerFactory\s*:|authoritySelection\s*:|chunkPersistentCache\s*=|chunkMemoryCache\s*=/u.test(text), "fixture overrides production authority/cache");
  assert(!/world\.(?:unloadChunk|restoreCachedChunk|requestPersistentChunk)\s*\(|structureMarkers\.set\s*\(|localStorage|sessionStorage|indexedDB\.deleteDatabase/u.test(text), "fixture bypasses natural eviction/restore or injects durable markers");
  assert.match(text, /world\.scheduleAround\(x, z, true, y\)/u);
  assert.match(text, /world\.awaitGenerationRing\(x, z, 0, 5_000\)/u);
  assert.match(text, /state\.phase === "cold"/u);
  assert.match(text, /Reflect\.apply\(nativeGet, this, args\)/u); assert.match(text, /Reflect\.apply\(nativePut, this, args\)/u);
  return { fixtureSha256: sha256(Buffer.from(text)), defaultWorld: true, observationOnlyCacheHooks: true,
    injectedCacheOrMarkers: false, naturalEvictionAndNearRestore: true };
}

function browserSnapshot() {
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name); assert(!entry.isSymbolicLink(), `source link rejected: ${absolute}`);
      if (entry.isDirectory()) visit(absolute); else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(path.join(ROOT, "app")); visit(path.join(ROOT, "build"));
  for (const relative of OWN_FILES) files.push(path.join(ROOT, relative));
  const rows = [...new Set(files)].sort().map(file => {
    assert(!lstatSync(file).isSymbolicLink(), `source link rejected: ${file}`);
    return [path.relative(ROOT, file).replaceAll(path.sep, "/"), sha256(readFileSync(file))];
  });
  return { schema: 1, fileCount: rows.length, digest: sha256(Buffer.from(JSON.stringify(rows))) };
}

export async function verifyRustR3PersistentCache(argv = process.argv) {
  const options = parseCommandLine(argv, OPTIONS);
  const selection = selectR3ProductionWorkerArtifact("public/engine", options["expected-artifact-hash"]);
  const output = resolveR3ProductionWorkerOutput(options.output ?? `work/hybrid-rust-migration/r3-persistent-cache/${new Date().toISOString().replaceAll(":", "-")}`);
  assert(!existsSync(output) || readdirSync(output).length === 0, "use a fresh empty cache evidence directory");
  const audit = auditR3PersistentCacheFixture(); const sourceBefore = browserSnapshot();
  const canonicalBefore = JSON.stringify(validatePublishedArtifacts(path.join(ROOT, "public/engine")));
  const mutex = await acquireManagedBrowserGateMutex(ROOT);
  let server; let browser; let context; let cold; let restore; let manifest; let success = false; let failure = null;
  const requests = []; const routes = []; const errors = []; const cleanup = {}; const skill = { ran: false };
  try {
    await mkdir(output, { recursive: true });
    // The same certified 155-case independent oracle builds the target payload;
    // no browser-generated or synthetic cache response is served as an oracle.
    const corpus = await buildR3ProductionWorkerCorpus(selection.artifact.hash);
    const entry = corpus.manifest.cases.find(value => value.id === R3_PERSISTENT_CACHE_CASE);
    assert(entry && entry.minimumMarkers >= 1 && !entry.edits?.length, "existing POI target case is absent or vacuous");
    const expected = corpus.expectedBytes.get(`/__r3-production-worker/expected/${entry.ordinal}.bin`);
    assert(expected, "independent target byte payload is absent");
    const chunk = decodeR3WorkerExpectedChunk(new Uint8Array(expected.bytes), entry, r3PerformanceRequest(entry));
    manifest = { schema: 1, artifactHash: selection.artifact.hash, corpusHash: corpus.manifest.corpusHash, entry,
      cacheKey: r3PersistentCacheKey(entry), oracle: await r3CacheChunkProof(chunk) };
    assert(manifest.oracle.markerCount > 0, "independent target oracle contains no POIs");
    await writeFile(path.join(output, "oracle-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const assets = new Map([...selection.assets, ...corpus.expectedBytes,
      ["/__r3-persistent-cache/manifest.json", { bytes: Buffer.from(JSON.stringify(manifest)), type: "application/json" }]]);
    const { createServer } = await import("vite"); const envDir = path.join(output, "empty-env"); await mkdir(envDir);
    server = await createServer({
      configFile: false, root: ROOT, publicDir: false, envDir, logLevel: "warn", resolve: { alias: { "@": ROOT } },
      define: r3PerformanceBuildDefinition("rust-primary"), optimizeDeps: { noDiscovery: true },
      server: { host: "127.0.0.1", port: 0, hmr: false, watch: { ignored: ["**/*"] }, fs: { strict: true, allow: [ROOT] } },
      plugins: [{ name: "r3-persistent-cache-immutable-assets", configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          const rawUrl = request.url ?? "/"; requests.push(rawUrl);
          response.setHeader("Cross-Origin-Opener-Policy", "same-origin"); response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          if (rawUrl.startsWith("/engine") || rawUrl.startsWith("/__r3-")) {
            const asset = request.method === "GET" ? r3ProductionWorkerAsset(rawUrl, assets) : null;
            routes.push({ url: rawUrl, status: asset ? 200 : 404, bytes: asset?.bytes.length ?? 0, sha256: asset ? sha256(asset.bytes) : null });
            response.writeHead(asset ? 200 : 404, { "Content-Type": asset?.type ?? "text/plain", "Content-Length": asset?.bytes.length ?? 0,
              "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" }); response.end(asset?.bytes); return;
          }
          next();
        });
      } }],
    });
    await server.listen(); const address = server.httpServer.address(); assert(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/${ENTRY}`;
    const playwrightPath = path.join(os.homedir(), ".codex/skills/develop-web-game/scripts/node_modules/playwright/index.mjs");
    assert(existsSync(playwrightPath), "installed local Playwright is required; this gate never downloads packages/browsers");
    const { chromium } = await import(pathToFileURL(playwrightPath).href);
    const browserPath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(file => existsSync(file));
    browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
    // A dedicated fresh context supplies empty IndexedDB. A second NEW page,
    // not reset/reload of the first world, shares only that context's origin storage.
    context = await browser.newContext({ viewport: { width: 1100, height: 760 }, serviceWorkers: "block" });
    async function pagePhase(phase) {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push({ phase, type: "pageerror", message: String(error) }));
      page.on("console", message => { if (message.type() === "error") errors.push({ phase, type: "console", message: message.text() }); });
      try {
        await page.goto(`${baseUrl}?phase=${phase}`, { waitUntil: "load" }); await page.click("#run");
        await page.waitForFunction(() => {
          const raw = window.render_game_to_text?.(); if (!raw) return false;
          return ["passed", "failed"].includes(JSON.parse(raw).status);
        }, null, { timeout: 240_000 });
        const state = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
        await writeFile(path.join(output, `${phase}.json`), `${JSON.stringify(state, null, 2)}\n`);
        await page.screenshot({ path: path.join(output, `${phase}.png`), fullPage: true });
        assertR3CachePageEvidence(state, manifest); return state;
      } catch (error) {
        // Preserve partial state even when startup/restore times out before a
        // terminal fixture status, rather than closing away the diagnostic.
        try {
          const partial = await page.evaluate(() => window.render_game_to_text?.() ?? null);
          if (partial) await writeFile(path.join(output, `${phase}-partial.json`), `${partial}\n`);
          await page.screenshot({ path: path.join(output, `${phase}-failure.png`), fullPage: true });
        } catch (captureError) { errors.push({ phase, type: "failure-capture", message: String(captureError) }); }
        throw error;
      } finally { await page.close(); }
    }
    cold = await pagePhase("cold");
    assert.equal(context.pages().length, 0, "source page was not closed before fresh-page restore");
    restore = await pagePhase("restore"); assertR3PersistentCacheEvidence(cold, restore, manifest);
    assertR3PersistentCacheBrowserErrors(errors);
    assert(!routes.some(route => route.status !== 200), "artifact/oracle request escaped the exact immutable allowlist");
    assert(requests.some(url => /^\/app\/game\/terrain-generation-worker\.ts\?/u.test(url) && url.includes("worker_file") && url.includes("type=module")), "actual production generation Worker module was not requested");
    assert(!requests.some(url => /\/app\/game\/rust-terrain-generation-legacy-oracle\.ts/u.test(url)), "browser loaded the independent legacy oracle");
    for (const suffix of ["manifest.json", `${selection.artifact.hash}/manifest.json`, `${selection.artifact.hash}/engine.js`, `${selection.artifact.hash}/engine_bg.wasm`]) {
      assert(routes.some(route => route.url.split("?")[0] === `/engine/${suffix}` && route.status === 200), `canonical loader route was not exercised: ${suffix}`);
    }
    if (options["skill-review"]) {
      // The skill's virtual-time shim must not supply the lease/cache acceptance
      // clock. Use it only for the idle UI; both real-rAF phases above are native.
      const directory = path.join(output, "skill-ui-only"); await mkdir(directory);
      const client = path.join(os.homedir(), ".codex/skills/develop-web-game/scripts/web_game_playwright_client.js");
      assert(existsSync(client), "installed develop-web-game client is unavailable"); skill.ran = true; skill.process = {};
      const code = await runR3WorkerSkillClient(client, ["--url", baseUrl, "--actions-json", JSON.stringify({ steps: [{ buttons: [], frames: 1 }] }),
        "--iterations", "1", "--screenshot-dir", directory], { evidence: skill.process, timeoutMilliseconds: 60_000 });
      assert.equal(code, 0, "installed skill UI-review client failed");
      const idle = JSON.parse(await readFile(path.join(directory, "state-0.json"), "utf8"));
      assert.equal(idle.status, "idle"); assert.equal(idle.targetGenerationRequests.length, 0);
      assert(!readdirSync(directory).some(name => name.startsWith("errors-")), "skill UI-review errors were captured");
      skill.scope = "Idle UI only; virtual-time skill client excluded from persistent-cache acceptance";
    }
    success = true;
  } catch (error) { failure = error; }
  finally {
    cleanup.resources = await closeR3PerformanceResources({ context, browser });
    try { await server?.close(); cleanup.serverClosed = !server?.httpServer?.listening; }
    catch (error) { cleanup.serverClosed = false; cleanup.serverError = String(error); failure ??= error; }
    try { await mutex.release(); } catch (error) { failure ??= error; }
    cleanup.mutex = mutex.evidence;
    cleanup.nativeSourceUnchanged = createRustEngineSourceSnapshot(ROOT).digest === selection.sourceSnapshot.digest;
    cleanup.browserSourceUnchanged = JSON.stringify(browserSnapshot()) === JSON.stringify(sourceBefore);
    cleanup.canonicalUnchanged = JSON.stringify(validatePublishedArtifacts(path.join(ROOT, "public/engine"))) === canonicalBefore;
    // Closing owned pages/context/browser can deliver late console/page errors.
    // Recheck after every close and before deciding or writing summary status.
    try { assertR3PersistentCacheBrowserErrors(errors); cleanup.browserErrorsClear = true; }
    catch (error) { cleanup.browserErrorsClear = false; failure ??= error; }
    cleanup.passed = cleanup.resources.passed && cleanup.serverClosed && cleanup.nativeSourceUnchanged
      && cleanup.browserSourceUnchanged && cleanup.canonicalUnchanged && cleanup.browserErrorsClear;
    if (!cleanup.passed) failure ??= new Error("Cache gate resource/source/artifact cleanup failed");
    if (existsSync(output)) {
      await writeFile(path.join(output, "requests.json"), `${JSON.stringify({ requests: [...new Set(requests)], routes, errors }, null, 2)}\n`);
      await writeFile(path.join(output, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`);
      await writeFile(path.join(output, "summary.json"), `${JSON.stringify({ schema: 1, status: success && !failure ? "passed" : "failed",
        scope: "Unmeasured production persistent-cache acceptance; not performance/full-game/authority promotion", output,
        liveEditHaloNamespaceRejection: "Not exercised; this lane covers an unedited POI cache round trip only",
        artifactHash: selection.artifact.hash, sourceSnapshot: selection.sourceSnapshot, browserSource: sourceBefore, audit,
        manifest, cold, restore, skill, cleanup, error: failure ? String(failure) : null,
        screenshotReview: "cold.png and restore.png require manual visual review; file existence is not visual acceptance" }, null, 2)}\n`);
    }
  }
  if (failure) throw failure;
  process.stdout.write(`${JSON.stringify({ status: "passed", output, artifactHash: selection.artifact.hash, markerCount: manifest.oracle.markerCount }, null, 2)}\n`);
  return { output, cold, restore, manifest, cleanup };
}

if (isDirectInvocation(import.meta.url)) {
  try { await verifyRustR3PersistentCache(); }
  catch (error) { console.error(`R3 persistent-cache gate failed: ${error.message}`); process.exitCode = 1; }
}
