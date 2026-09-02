import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertSha256, createRustEngineSourceSnapshot, isDirectInvocation, parseCommandLine, sha256, summarizeSamples,
  validatePublishedArtifacts,
} from "./rust-engine-common.mjs";
import { acquireManagedBrowserGateMutex, assertR5ArtifactCurrentSource, stopOwnedProcess } from "./verify-rust-r5-player-browser.mjs";
import {
  assignStableCorpusOrdinals, COMPOSED_PROMOTION_CASES_V2, COMPOSED_PROMOTION_COVERAGE_V2,
  expandFrozenPromotionCases, expandNormalizedOptionCases, loadFrozenPromotionCorpusV1,
  loadNormalizedOptionsExtensionV1, promotionCorpusHashV2, promotionExecutionSchedules, requestForPromotionCase,
} from "./lib/rust-worldgen-promotion-corpus.ts";
import { createGeneratedChunkV2, TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2 } from "../app/game/terrain-generation-contract.ts";
import { generateChunkWithLegacyOracleV2 } from "../app/game/rust-terrain-generation-legacy-oracle.ts";
import { encodeR3WorkerExpectedBytes, r3WorkerStreams } from "../tests/fixtures/r3-production-worker-contract.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const ALLOWED_ROOTS = ["public/engine", "public/engine-schema-candidate"];
const OPTIONS = {
  "public-dir": { type: "string", default: "public/engine-schema-candidate" },
  "expected-artifact-hash": { type: "string", default: null },
  output: { type: "string", default: "work/hybrid-rust-migration/r3-production-worker" },
};
const ownFiles = [
  "scripts/verify-rust-generation-production-worker.mjs", "scripts/lib/rust-worldgen-promotion-corpus.ts",
  "tests/fixtures/r3-production-worker.html", "tests/fixtures/r3-production-worker.ts",
  "tests/fixtures/r3-production-worker-contract.ts", "tests/fixtures/rust-engine/r3/promotion-corpus.json",
  "tests/fixtures/rust-engine/r3/promotion-options-extension.json",
];
function comparable(value) { const resolved = path.resolve(value); return process.platform === "win32" ? resolved.toLowerCase() : resolved; }
function inside(parent, target) { const relative = path.relative(parent, target); return relative && !relative.startsWith("..") && !path.isAbsolute(relative); }

function assertNoLinks(root, target, allowMissing = false) {
  const relative = path.relative(root, target);
  assert(inside(root, target), `path must be strictly inside ${root}`);
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (!existsSync(cursor)) { assert(allowMissing, `required path is missing: ${cursor}`); return; }
    assert(!lstatSync(cursor).isSymbolicLink(), `path may not traverse a symbolic link: ${cursor}`);
    assert.equal(comparable(realpathSync(cursor)), comparable(path.join(realpathSync(root), path.relative(root, cursor))), `path escaped canonical root: ${cursor}`);
  }
}

export function resolveR3ProductionWorkerDirectory(requested, repositoryRoot = ROOT) {
  const root = realpathSync(repositoryRoot);
  const resolved = path.resolve(root, requested);
  assert(ALLOWED_ROOTS.some(relative => comparable(resolved) === comparable(path.join(root, relative))),
    "production-worker --public-dir must be exactly public/engine or public/engine-schema-candidate");
  assertNoLinks(root, resolved);
  assert(lstatSync(resolved).isDirectory(), "selected engine root must be a directory");
  return resolved;
}

export function resolveR3ProductionWorkerOutput(requested, repositoryRoot = ROOT) {
  const root = realpathSync(repositoryRoot); const work = path.join(root, "work");
  const resolved = path.resolve(root, requested);
  assert(inside(work, resolved), "production-worker output must be strictly inside workspace work/");
  assertNoLinks(root, resolved, true);
  if (existsSync(resolved)) assert(lstatSync(resolved).isDirectory(), "production-worker output must be a directory");
  return resolved;
}

export function selectR3ProductionWorkerArtifact(requested, expectedHash, repositoryRoot = ROOT) {
  assertSha256(expectedHash, "Expected production-worker artifact hash");
  const directory = resolveR3ProductionWorkerDirectory(requested, repositoryRoot);
  const validation = validatePublishedArtifacts(directory);
  // The unchanged production loader explicitly selects compatibility, not an arbitrary test variant.
  assert.equal(validation.index.defaultVariant, "compatibility", "production-worker index must select compatibility");
  const artifact = validation.artifacts.find(entry => entry.variant === "compatibility");
  assert(artifact, "compatibility artifact is absent"); assert.equal(artifact.hash, expectedHash, "production-worker artifact hash mismatch");
  assertNoLinks(directory, artifact.directory);
  const sourceSnapshot = assertR5ArtifactCurrentSource(artifact, createRustEngineSourceSnapshot(repositoryRoot));
  const assets = new Map();
  assets.set("/engine/manifest.json", { bytes: Buffer.from(readFileSync(path.join(directory, "manifest.json"))), type: "application/json" });
  assets.set(`/engine/${artifact.hash}/manifest.json`, { bytes: Buffer.from(readFileSync(path.join(artifact.directory, "manifest.json"))), type: "application/json" });
  for (const file of artifact.files) {
    const filePath = path.join(artifact.directory, file.path); assertNoLinks(directory, filePath);
    assets.set(`/engine/${artifact.hash}/${file.path}`, { bytes: Buffer.from(readFileSync(filePath)), type: file.mimeType });
  }
  return { directory, artifact, validation, sourceSnapshot, assets };
}

/** Exact allowlist lookup: never resolve a browser-controlled path against the filesystem. */
export function r3ProductionWorkerAsset(rawUrl, assets) {
  const pathname = rawUrl.split("?")[0];
  if (pathname.includes("%") || pathname.includes("\\") || pathname.split("/").includes("..")) return null;
  return assets.get(pathname) ?? null;
}

export function auditR3ProductionWorkerSources(repositoryRoot = ROOT) {
  const worker = readFileSync(path.join(repositoryRoot, "app/game/terrain-generation-worker.ts"), "utf8");
  const pipeline = readFileSync(path.join(repositoryRoot, "app/game/terrain-generation-pipeline.ts"), "utf8");
  const loader = readFileSync(path.join(repositoryRoot, "app/game/rust-engine-loader.ts"), "utf8");
  const codeCache = readFileSync(path.join(repositoryRoot, "app/game/rust-engine-code-cache.ts"), "utf8");
  const entry = readFileSync(path.join(repositoryRoot, "tests/fixtures/r3-production-worker.ts"), "utf8");
  assert.match(pipeline, /new Worker\(new URL\("\.\/terrain-generation-worker\.ts", import\.meta\.url\), \{ type: "module" \}\)/u);
  assert.match(entry, /new TerrainGenerationPipeline\(2, 2, \{ startupTimeoutMilliseconds:/u);
  assert(!/workerFactory\s*:|authoritySelection\s*:|codeCache\s*:|new\s+Worker\s*\(/u.test(entry), "fixture may not replace the factory, code cache, or selected authority");
  assert.match(worker, /new RustTerrainGenerationBridgeV2\(\{ preparedCode: preparedCode! \}\)/u);
  assert.match(worker, /if \(message\.type === "initialize-terrain-generation-v2"\) \{ initialize\(message\); return; \}/u);
  assert.match(worker, /if \(bootstrapStarted \|\|/u);
  assert.match(pipeline, /new RustEngineCodeCache\(\)/u);
  assert.match(pipeline, /this\.workerFactory \? null : new RustEngineCodeCache\(\)/u);
  assert.match(pipeline, /slot\.worker\.postMessage\(\{ type: "initialize-terrain-generation-v2", bootstrapId: slot\.bootstrapId, code \}\)/u);
  assert.match(pipeline, /message\.bootstrapId === slot\.bootstrapId && message\.codeIdentity === slot\.codeIdentity/u);
  assert.match(loader, /module_or_path: prepared\?\.wasmModule \?\? artifact\.wasmUrl/u);
  assert.match(codeCache, /bytes\.byteLength === file\.bytes/u);
  assert.match(codeCache, /await sha256\(bytes\) === file\.sha256/u);
  assert.match(worker, /generatedChunkTransferListV2\(result\.chunk\)/u);
  const runtimeImports = [...worker.matchAll(/from\s+["']([^"']+)["']/gu)].map(match => match[1]).sort();
  assert.deepEqual(runtimeImports, ["./rust-terrain-generation-backend", "./rust-terrain-generation-bridge", "./terrain-generation-contract"]);
  assert(!/legacy-oracle|from\s+["']\.\/world["']/u.test(worker), "production worker imports the legacy oracle/world");
  return {
    workerPath: "app/game/terrain-generation-worker.ts", workerSha256: sha256(Buffer.from(worker)),
    pipelineSha256: sha256(Buffer.from(pipeline)), fixtureSha256: sha256(Buffer.from(entry)), runtimeImports,
    loaderSha256: sha256(Buffer.from(loader)), codeCacheSha256: sha256(Buffer.from(codeCache)),
    verifiedImmutableBootstrapInProductionSource: true,
    defaultWorkerFactory: true, outputTransferListInProductionSource: true,
    outputSenderDetachmentObserved: false,
  };
}

function browserSourcesSnapshot(repositoryRoot) {
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      assert(!entry.isSymbolicLink(), `browser source symlink rejected: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(path.join(repositoryRoot, "app")); visit(path.join(repositoryRoot, "build"));
  for (const relative of ownFiles) files.push(path.join(repositoryRoot, relative));
  const rows = files.sort().map(file => [path.relative(repositoryRoot, file).replaceAll(path.sep, "/"), sha256(readFileSync(file))]);
  return { schema: 1, fileCount: rows.length, digest: sha256(Buffer.from(JSON.stringify(rows))) };
}

export async function buildR3ProductionWorkerCorpus(artifactHash) {
  const [frozen, extension] = await Promise.all([loadFrozenPromotionCorpusV1(), loadNormalizedOptionsExtensionV1()]);
  const cases = assignStableCorpusOrdinals(expandFrozenPromotionCases(frozen), expandNormalizedOptionCases(extension));
  const coverageCount = new Set([...frozen.requiredCoverage, ...extension.requiredCoverage]).size;
  assert.equal(cases.length, COMPOSED_PROMOTION_CASES_V2); assert.equal(coverageCount, COMPOSED_PROMOTION_COVERAGE_V2);
  const expectedBytes = new Map(); const rows = []; const references = []; const durations = [];
  for (const entry of cases) {
    const request = requestForPromotionCase(entry); const started = performance.now();
    const reference = createGeneratedChunkV2(request, generateChunkWithLegacyOracleV2(request));
    durations.push(performance.now() - started);
    const bytes = Buffer.from(encodeR3WorkerExpectedBytes(reference));
    expectedBytes.set(`/__r3-production-worker/expected/${entry.ordinal}.bin`, { bytes, type: "application/octet-stream" });
    references.push({ ...entry, streamBytes: r3WorkerStreams(reference).map(stream => stream.byteLength),
      expectedChunkHash: reference.chunkHash, expectedBytesHash: sha256(bytes) });
    rows.push({ id: entry.id, referenceChunkHash: reference.chunkHash, candidateChunkHash: reference.chunkHash });
  }
  const corpusHash = promotionCorpusHashV2(frozen, extension, rows);
  assert.equal(corpusHash, TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2, "independent oracle does not reproduce the production certificate corpus");
  const schedules = Object.fromEntries(Object.entries(promotionExecutionSchedules(cases)).map(([name, entries]) => [name, entries.map(entry => entry.id)]));
  return {
    manifest: { schema: 1, artifactHash, corpusHash, coverageCount, cases: references, schedules },
    expectedBytes, oracleTimingMilliseconds: summarizeSamples(durations),
  };
}

export function assertR3ProductionWorkerEvidence(state, manifest) {
  assert.equal(state.schema, 1); assert.equal(state.status, "passed", `worker fixture failed: ${state.error ?? state.phase}`);
  assert.equal(state.artifactHash, manifest.artifactHash); assert.equal(state.corpusHash, manifest.corpusHash);
  assert.equal(state.caseCount, 155); assert.equal(state.coverageCount, 89);
  assert.equal(state.compared, 465); assert.equal(state.transferredStreams, 4_650);
  assert.equal(state.rows.length, 465); assert.equal(state.checks.length, 7);
  assert.deepEqual(state.schedules, manifest.schedules, "browser execution did not preserve all three exact schedules");
  const expected = new Map(manifest.cases.map(entry => [entry.id, entry]));
  const unique = new Set();
  for (const row of state.rows) {
    const entry = expected.get(row.id); assert(entry, `unknown browser case ${row.id}`);
    const key = `${row.order}:${row.id}`; assert(!unique.has(key), `repeated browser evidence row ${key}`); unique.add(key);
    assert(Object.keys(manifest.schedules).includes(row.order)); assert.equal(row.canonicalHash, entry.expectedChunkHash);
    assert.equal(row.bytes, entry.streamBytes.reduce((sum, bytes) => sum + bytes, 0));
    assert(Number.isFinite(row.milliseconds) && row.milliseconds >= 0, "invalid observed browser timing");
    assert(Number.isSafeInteger(row.markers) && row.markers >= 0, "invalid marker count");
  }
  assert.equal(state.markerRows, state.rows.reduce((sum, row) => sum + row.markers, 0));
  assert(state.markerRows > 0, "POI-bearing corpus was not observed");
  const diagnostics = state.diagnostics;
  assert.equal(diagnostics.mode, "rust"); assert(["default-rust", "build-rust-primary"].includes(diagnostics.selectionSource));
  assert.equal(diagnostics.state, "disposed");
  for (const field of ["workers", "busy", "ready", "failed", "rejected"]) assert.equal(diagnostics[field], 0, field);
  assert.equal(diagnostics.restarts, 1); assert.equal(diagnostics.submitted, 473); assert.equal(diagnostics.completed, 469);
  assert.equal(diagnostics.canceled, 1); assert.equal(diagnostics.stale, 2); assert.equal(diagnostics.lastError, null);
  assert.equal(diagnostics.acceptingRequests, false);
  for (const [phase, resolutions, cacheHits, disposed] of [
    ["startup", 1, 0, false], ["reset", 2, 1, false], ["replacement", 2, 1, false], ["disposed", 2, 1, true],
  ]) {
    const cache = phase === "disposed" ? diagnostics.codeCache : state.codeReuse?.[phase];
    assert(cache, `missing real code-cache ${phase} evidence`);
    assert.equal(cache.disposed, disposed); assert.equal(cache.maximumEntries, 2);
    assert.equal(cache.entries, disposed ? 0 : 1); assert.equal(cache.pending, 0);
    assert.equal(cache.resolutions, resolutions); assert.equal(cache.cacheHits, cacheHits);
    assert.equal(cache.compilations, 1); assert.equal(cache.assetFetches, 2); assert.equal(cache.failures, 0);
    assert(Number.isSafeInteger(cache.verifiedBytes) && cache.verifiedBytes > 0);
    assert.equal(cache.verifiedBytes, state.codeReuse.startup.verifiedBytes);
  }
  assert.equal(state.transfers.requests, 473); assert.equal(state.transfers.sourceInputsUnchanged, 473);
  assert(state.transfers.nonemptyInputs > 0); assert.equal(state.transfers.nonemptyInputs, state.transfers.detachedNonemptyInputs);
  assert.deepEqual(state.cleanup, { pipelineDisposed: true, postDisposeRejected: true, prototypesRestored: true, observedWorkers: 5, terminatedWorkers: 5 });
  return true;
}

/** Bind observable cache counters to exact server delivery, not HTTP cache assumptions. */
export function assertR3ImmutableCodeRequests(routes, artifact, state) {
  let codeBytes = 0;
  for (const role of ["glue", "wasm"]) {
    const files = artifact.files.filter(file => file.role === role); assert.equal(files.length, 1);
    const file = files[0]; const url = `/engine/${artifact.hash}/${file.path}`;
    const delivered = routes.filter(route => route.url.split("?")[0] === url);
    assert.equal(delivered.length, 1, `${role} must be fetched exactly once across all five fresh workers`);
    assert.equal(delivered[0].status, 200); assert.equal(delivered[0].bytes, file.bytes); assert.equal(delivered[0].sha256, file.sha256);
    codeBytes += file.bytes;
  }
  for (const url of ["/engine/manifest.json", `/engine/${artifact.hash}/manifest.json`]) {
    const delivered = routes.filter(route => route.url.split("?")[0] === url);
    assert.equal(delivered.length, 2, "each epoch must resolve current selector and manifest exactly once");
    assert(delivered.every(route => route.status === 200));
  }
  assert.equal(state.diagnostics.codeCache.verifiedBytes, codeBytes);
  return { glueFetches: 1, wasmFetches: 1, selectorResolutions: 2, compiledModules: 1, freshWorkers: 5, verifiedBytes: codeBytes };
}

export async function runR3WorkerSkillClient(client, args, options = {}) {
  const spawnProcess = options.spawnProcess ?? spawn;
  const stopProcess = options.stopProcess ?? stopOwnedProcess;
  const evidence = options.evidence ?? {};
  evidence.timedOut = false; evidence.stop = {};
  const child = spawnProcess(process.execPath, [client, ...args], { cwd: ROOT, stdio: "inherit", windowsHide: true });
  evidence.pid = child.pid ?? null;
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => { evidence.timedOut = true; reject(new Error("production-worker skill client exceeded its bounded timeout")); }, options.timeoutMilliseconds ?? 900_000);
      child.once("error", reject);
      child.once("exit", (code, signal) => signal ? reject(new Error(`skill client terminated by ${signal}`)) : resolve(code));
    });
  } finally {
    clearTimeout(timer);
    // The established helper only signals this spawned child's exact owned PID.
    evidence.stopped = Number.isSafeInteger(child.pid) && child.pid > 0
      ? await stopProcess(child, { diagnostics: evidence.stop }) : true;
    assert(evidence.stopped, "owned skill client did not stop");
  }
}

export async function verifyRustGenerationProductionWorker(argv = process.argv) {
  const options = parseCommandLine(argv, OPTIONS);
  const selection = selectR3ProductionWorkerArtifact(options["public-dir"], options["expected-artifact-hash"]);
  const output = resolveR3ProductionWorkerOutput(options.output);
  assert(!existsSync(output) || readdirSync(output).length === 0, "use a fresh empty evidence directory; stale browser output is forbidden");
  const sourceAudit = auditR3ProductionWorkerSources(); const browserSource = browserSourcesSnapshot(ROOT);
  const canonicalBefore = JSON.stringify(validatePublishedArtifacts(path.join(ROOT, "public/engine")));
  const selectedBefore = JSON.stringify(selection.validation);
  const mutex = await acquireManagedBrowserGateMutex(ROOT);
  let server; let state; let success = false; let clientExitCode = null;
  const requests = []; const routes = []; const cleanup = { clientProcess: {} };
  try {
    await mkdir(output, { recursive: true });
    process.stdout.write("Preparing all 155 independent legacy-oracle reference payloads...\n");
    const corpus = await buildR3ProductionWorkerCorpus(selection.artifact.hash);
    await writeFile(path.join(output, "oracle-manifest.json"), `${JSON.stringify(corpus.manifest, null, 2)}\n`);
    const manifestBytes = Buffer.from(JSON.stringify(corpus.manifest));
    const assets = new Map([...selection.assets, ...corpus.expectedBytes, ["/__r3-production-worker/manifest.json", { bytes: manifestBytes, type: "application/json" }]]);
    const { createServer } = await import("vite");
    server = await createServer({
      configFile: false, root: ROOT, publicDir: false, logLevel: "warn", resolve: { alias: { "@": ROOT } },
      server: { host: "127.0.0.1", port: 0, hmr: false, watch: { ignored: ["**/*"] }, fs: { strict: true, allow: [ROOT] } },
      optimizeDeps: { noDiscovery: true },
      plugins: [{ name: "r3-production-worker-immutable-assets", configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          const rawUrl = request.url ?? "/"; requests.push(rawUrl);
          response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          if (rawUrl.startsWith("/engine") || rawUrl.startsWith("/__r3-production-worker/")) {
            const asset = request.method === "GET" ? r3ProductionWorkerAsset(rawUrl, assets) : null;
            if (!asset) { routes.push({ url: rawUrl, status: 404 }); response.statusCode = 404; response.end("not in immutable gate allowlist"); return; }
            routes.push({ url: rawUrl, status: 200, bytes: asset.bytes.length, sha256: sha256(asset.bytes) });
            response.writeHead(200, { "Content-Type": asset.type, "Content-Length": asset.bytes.length, "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" });
            response.end(asset.bytes); return;
          }
          next();
        });
      } }],
    });
    await server.listen(); const address = server.httpServer.address(); assert(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/tests/fixtures/r3-production-worker.html`;
    const client = path.join(os.homedir(), ".codex/skills/develop-web-game/scripts/web_game_playwright_client.js");
    assert(existsSync(client), "develop-web-game skill client is unavailable");
    const args = ["--url", url, "--click-selector", "#run", "--actions-json", JSON.stringify({ steps: [{ buttons: [], frames: 2 }] }), "--iterations", "1", "--screenshot-dir", output];
    process.stdout.write(`Running the production-worker skill client at ${url}\n`);
    clientExitCode = await runR3WorkerSkillClient(client, args, { evidence: cleanup.clientProcess });
    assert.equal(clientExitCode, 0, "develop-web-game skill client failed");
    state = JSON.parse(await readFile(path.join(output, "state-0.json"), "utf8"));
    assertR3ProductionWorkerEvidence(state, corpus.manifest);
    assert(!(await readdir(output)).some(name => name.startsWith("errors-")), "browser console/page errors were captured");
    assert((await readFile(path.join(output, "shot-0.png"))).byteLength > 0, "legible screenshot artifact missing");
    const workerScriptUrls = [...new Set(requests.filter(url => /^\/app\/game\/terrain-generation-worker\.ts\?/u.test(url)))];
    assert(workerScriptUrls.some(url => url.includes("worker_file") && url.includes("type=module")), "actual Vite production Worker script was not requested");
    for (const suffix of ["manifest.json", `${selection.artifact.hash}/manifest.json`, `${selection.artifact.hash}/engine.js`, `${selection.artifact.hash}/engine_bg.wasm`]) {
      assert(routes.some(route => route.url.split("?")[0] === `/engine/${suffix}` && route.status === 200), `production loader route /engine/${suffix} was not exercised`);
    }
    assert(!routes.some(route => route.status !== 200), "engine/reference route escaped the exact allowlist");
    const immutableCodeReuse = assertR3ImmutableCodeRequests(routes, selection.artifact, state);
    assert(!requests.some(url => /^\/app\/game\/(world|rust-terrain-generation-legacy-oracle)\.ts(?:\?|$)/u.test(url)), "browser worker gate loaded legacy world/oracle production modules");
    const evidence = {
      schema: 1, output, artifactHash: selection.artifact.hash, sourceSnapshot: selection.sourceSnapshot, browserSource, sourceAudit,
      workerScriptUrls, immutableCodeReuse, artifactFiles: selection.artifact.files, corpusHash: corpus.manifest.corpusHash,
      selectedPublicDirectory: path.relative(ROOT, selection.directory).replaceAll(path.sep, "/"),
      timingMilliseconds: { independentLegacyOracle: corpus.oracleTimingMilliseconds,
        actualWorkerEndToEnd: summarizeSamples(state.rows.map(row => row.milliseconds)), startup: state.timings.startupMilliseconds },
      timingScope: "Observational timings include pipeline admission, transfer and validation. No performance acceptance or speedup is claimed.",
      screenshotReview: "shot-0.png requires human/agent visual inspection after the run; existence alone is not visual acceptance.",
      ...state,
    };
    await writeFile(path.join(output, "summary.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    success = true;
    process.stdout.write(`${JSON.stringify({ output, artifactHash: state.artifactHash, compared: state.compared, checks: state.checks, workerScriptUrls }, null, 2)}\n`);
    return evidence;
  } finally {
    try { await server?.close(); } finally { await mutex.release(); }
    cleanup.serverClosed = !server?.httpServer?.listening;
    cleanup.clientExitedSuccessfully = clientExitCode === 0;
    cleanup.sourceUnchanged = createRustEngineSourceSnapshot(ROOT).digest === selection.sourceSnapshot.digest;
    cleanup.browserSourceUnchanged = JSON.stringify(browserSourcesSnapshot(ROOT)) === JSON.stringify(browserSource);
    cleanup.canonicalUnchanged = JSON.stringify(validatePublishedArtifacts(path.join(ROOT, "public/engine"))) === canonicalBefore;
    cleanup.selectedArtifactUnchanged = JSON.stringify(validatePublishedArtifacts(selection.directory)) === selectedBefore;
    cleanup.mutex = mutex.evidence; cleanup.workerCleanup = state?.cleanup ?? null; cleanup.evidencePassedBeforeCleanup = success;
    if (existsSync(output)) {
      await writeFile(path.join(output, "requests.json"), `${JSON.stringify({ sourceRequests: [...new Set(requests)], immutableRoutes: routes }, null, 2)}\n`);
      await writeFile(path.join(output, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`);
    }
    assert(cleanup.serverClosed && cleanup.sourceUnchanged && cleanup.browserSourceUnchanged && cleanup.canonicalUnchanged && cleanup.selectedArtifactUnchanged,
      "server/source/artifact cleanup integrity failed");
  }
}

if (isDirectInvocation(import.meta.url)) {
  try { await verifyRustGenerationProductionWorker(); }
  catch (error) { process.stderr.write(`R3 production worker verification failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
