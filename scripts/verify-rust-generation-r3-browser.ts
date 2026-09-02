import { createServer } from "node:http";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createGeneratedChunkV2,
} from "../app/game/terrain-generation-contract.ts";
import { terrainGenerationChunksByteEqualV2 } from "../app/game/rust-terrain-generation-backend.ts";
import {
  decodeRustTerrainGenerationResultV2,
  encodeRustTerrainGenerationRequestV2,
  parseTerrainGenerationParityCertificateV2,
} from "../app/game/rust-terrain-generation-bridge.ts";
import { generateChunkWithLegacyOracleV2 } from "../app/game/rust-terrain-generation-legacy-oracle.ts";
import {
  RUST_ENGINE_SOURCE_SNAPSHOT_SCHEMA,
  RustEngineToolError,
  assertSha256,
  isDirectInvocation,
  parseCommandLine,
  validatePublishedArtifacts,
} from "./rust-engine-common.mjs";
import {
  COMPOSED_PROMOTION_CASES_V2,
  COMPOSED_PROMOTION_COVERAGE_V2,
  FROZEN_PROMOTION_CASES_V1,
  NORMALIZED_OPTION_EXTENSION_CASES_V1,
  assignStableCorpusOrdinals,
  expandFrozenPromotionCases,
  expandNormalizedOptionCases,
  loadFrozenPromotionCorpusV1,
  loadNormalizedOptionsExtensionV1,
  promotionCorpusHashV2,
  requestForPromotionCase,
  type PromotionParityHashRowV2,
} from "./lib/rust-worldgen-promotion-corpus.ts";
type BrowserInitialization = Readonly<{
  certificate: number[];
  coldMilliseconds: number;
}>;
type BrowserGeneration = Readonly<{ result: number[]; duration: number }>;

const ROOT = path.resolve(import.meta.dirname, "..");
const WORK = path.join(ROOT, "work", "hybrid-rust-migration", "r3-generation");
const FIXTURE = path.join(ROOT, "engine", "target", "release", `blockwild-generation-fixture${process.platform === "win32" ? ".exe" : ""}`);
const OPTIONS = {
  "public-dir": { type: "string", default: "public/engine" },
  "expected-artifact-hash": { type: "string", default: null },
  output: { type: "string", default: path.relative(ROOT, path.join(WORK, "browser-worker-performance.json")) },
};
const ALLOWED_PUBLIC_DIRECTORIES = Object.freeze([
  "public/engine",
  "public/engine-locator-candidate",
]);

function comparablePath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function lstatIfPresent(value: string) {
  try {
    return lstatSync(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertRealDirectoryAtExpectedPath(directory: string, expectedRealPath: string, label: string) {
  if (!existsSync(directory)) throw new RustEngineToolError(`${label} is missing: ${directory}`);
  const entry = lstatSync(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new RustEngineToolError(`${label} must be a real non-symlink directory: ${directory}`);
  }
  const actualRealPath = realpathSync(directory);
  if (comparablePath(actualRealPath) !== comparablePath(expectedRealPath)) {
    throw new RustEngineToolError(
      `${label} resolves outside its exact approved path: expected ${expectedRealPath}, found ${actualRealPath}.`,
    );
  }
  return actualRealPath;
}

export function resolveR3BrowserPublicDirectory(requestedPath: string, repositoryRoot = ROOT) {
  const resolved = path.resolve(repositoryRoot, requestedPath);
  const allowedRelativePath = ALLOWED_PUBLIC_DIRECTORIES.find(
    (relativePath) => comparablePath(path.resolve(repositoryRoot, relativePath)) === comparablePath(resolved),
  );
  if (!allowedRelativePath) {
    throw new RustEngineToolError(
      `R3 browser --public-dir must resolve to public/engine or public/engine-locator-candidate; received ${resolved}.`,
    );
  }
  const canonicalRepositoryRoot = realpathSync(repositoryRoot);
  assertRealDirectoryAtExpectedPath(
    resolved,
    path.join(canonicalRepositoryRoot, ...allowedRelativePath.split("/")),
    "R3 browser public root",
  );
  return resolved;
}

export function resolveR3BrowserOutputPath(requestedPath: string, repositoryRoot = ROOT) {
  const resolved = path.resolve(repositoryRoot, requestedPath);
  if (path.extname(resolved) !== ".json") {
    throw new RustEngineToolError(`R3 browser --output must use the lowercase .json extension: ${resolved}`);
  }

  const workRoot = path.resolve(repositoryRoot, "work");
  const relativeOutput = path.relative(workRoot, resolved);
  if (!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
    throw new RustEngineToolError(`R3 browser --output must be strictly inside ${workRoot}; received ${resolved}.`);
  }
  const canonicalRepositoryRoot = realpathSync(repositoryRoot);
  const canonicalWorkRoot = assertRealDirectoryAtExpectedPath(
    workRoot,
    path.join(canonicalRepositoryRoot, "work"),
    "R3 browser work root",
  );

  const segments = relativeOutput.split(path.sep);
  let current = workRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const entry = lstatIfPresent(current);
    if (!entry) break;
    if (entry.isSymbolicLink()) {
      throw new RustEngineToolError(`R3 browser --output may not traverse or replace a symlink: ${current}`);
    }
    const isOutput = index === segments.length - 1;
    if ((!isOutput && !entry.isDirectory()) || (isOutput && !entry.isFile())) {
      throw new RustEngineToolError(
        `R3 browser --output ${isOutput ? "must be a regular file when it exists" : "parent must be a directory"}: ${current}`,
      );
    }
    const canonicalCurrent = realpathSync(current);
    const canonicalRelative = path.relative(canonicalWorkRoot, canonicalCurrent);
    if (!canonicalRelative || canonicalRelative.startsWith("..") || path.isAbsolute(canonicalRelative)) {
      throw new RustEngineToolError(`R3 browser --output resolves outside the canonical work root: ${current}`);
    }
  }
  return path.join(canonicalWorkRoot, ...relativeOutput.split(path.sep));
}

function validatedArtifactSourceSnapshot(manifest: Record<string, unknown>) {
  const sourceSnapshot = manifest.sourceSnapshot as Record<string, unknown> | undefined;
  if (
    !sourceSnapshot
    || sourceSnapshot.schema !== RUST_ENGINE_SOURCE_SNAPSHOT_SCHEMA
    || !Number.isSafeInteger(sourceSnapshot.fileCount)
    || Number(sourceSnapshot.fileCount) <= 0
  ) {
    throw new RustEngineToolError("Selected Rust engine artifact lacks a valid source snapshot.");
  }
  return Object.freeze({
    schema: RUST_ENGINE_SOURCE_SNAPSHOT_SCHEMA,
    digest: assertSha256(sourceSnapshot.digest, "Selected Rust engine artifact source digest"),
    fileCount: Number(sourceSnapshot.fileCount),
  });
}

export function selectR3BrowserArtifact(publicEngineDirectory: string, expectedArtifactHash: string) {
  const expectedHash = assertSha256(expectedArtifactHash, "Expected R3 browser artifact hash");
  const verification = validatePublishedArtifacts(publicEngineDirectory);
  const variant = verification.index.defaultVariant as string;
  const selected = verification.artifacts.find((artifact: { variant: string }) => artifact.variant === variant);
  if (!selected) throw new RustEngineToolError(`R3 browser artifact index has no validated default variant ${variant}.`);
  if (selected.hash !== expectedHash) {
    throw new RustEngineToolError(
      `R3 browser artifact hash mismatch: expected ${expectedHash}, selected ${selected.hash}.`,
    );
  }
  return Object.freeze({
    variant,
    hash: selected.hash as string,
    directory: selected.directory as string,
    sourceSnapshot: validatedArtifactSourceSnapshot(selected.manifest as Record<string, unknown>),
  });
}

function percentile(values: readonly number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1))] ?? 0;
}

function timingSummary(values: readonly number[]) {
  return {
    samples: values.length,
    mean: values.reduce((total, value) => total + value, 0) / Math.max(1, values.length),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

async function playwrightModule() {
  for (const candidate of [
    "playwright",
    path.join(os.homedir(), ".codex", "skills", "develop-web-game", "scripts", "node_modules", "playwright", "index.mjs"),
  ]) {
    try { return await import(candidate.startsWith("playwright") ? candidate : pathToFileURL(candidate).href); } catch { /* next */ }
  }
  throw new Error("A local Playwright runtime is required for the R3 browser audit");
}

function browserExecutable() {
  return [
    process.env.BLOCKWILD_BROWSER_EXECUTABLE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ].find((candidate) => candidate && existsSync(candidate));
}

function writePacketBatch(packets: readonly Uint8Array[]) {
  const size = 4 + packets.reduce((total, packet) => total + 4 + packet.byteLength, 0);
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  view.setUint32(0, packets.length, true);
  let offset = 4;
  for (const packet of packets) {
    view.setUint32(offset, packet.byteLength, true);
    offset += 4;
    result.set(packet, offset);
    offset += packet.byteLength;
  }
  return result;
}

function readPacketBatch(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const results: Uint8Array[] = [];
  let offset = 4;
  for (let index = 0; index < count; index += 1) {
    const length = view.getUint32(offset, true);
    offset += 4;
    results.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  if (offset !== bytes.byteLength) throw new Error("native batch result has trailing bytes");
  return results;
}

export async function verifyRustGenerationR3Browser(argv = process.argv) {
  const options = parseCommandLine(argv, OPTIONS);
  const publicEngineDirectory = resolveR3BrowserPublicDirectory(options["public-dir"]);
  const outputPath = resolveR3BrowserOutputPath(options.output);
  if (!options["expected-artifact-hash"]) {
    throw new RustEngineToolError("R3 browser verification requires --expected-artifact-hash.");
  }
  const selectedArtifact = selectR3BrowserArtifact(publicEngineDirectory, options["expected-artifact-hash"]);
  const artifactHash = selectedArtifact.hash;
  const artifact = selectedArtifact.directory;
  const [frozenManifest, extensionManifest] = await Promise.all([
    loadFrozenPromotionCorpusV1(),
    loadNormalizedOptionsExtensionV1(),
  ]);
  const cases = assignStableCorpusOrdinals(
    expandFrozenPromotionCases(frozenManifest),
    expandNormalizedOptionCases(extensionManifest),
  );
  const requiredCoverageCount = new Set([
    ...frozenManifest.requiredCoverage,
    ...extensionManifest.requiredCoverage,
  ]).size;
  if (cases.length !== COMPOSED_PROMOTION_CASES_V2 || requiredCoverageCount !== COMPOSED_PROMOTION_COVERAGE_V2) {
    throw new Error("shared promotion corpus does not retain the exact 155-case / 89-coverage shape");
  }
  const requests = cases.map(requestForPromotionCase);
  const packets = requests.map(encodeRustTerrainGenerationRequestV2);

  const referenceDurations: number[] = [];
  const references = requests.map((request) => {
    const started = performance.now();
    const result = createGeneratedChunkV2(request, generateChunkWithLegacyOracleV2(request));
    referenceDurations.push(performance.now() - started);
    return result;
  });

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/") {
      response.writeHead(200, { "content-type": "text/html", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" });
      response.end("<!doctype html><title>Blockwild R3 generation audit</title><main id=ready>ready</main>");
      return;
    }
    const file = pathname === "/engine.js" ? "engine.js" : pathname === "/engine_bg.wasm" ? "engine_bg.wasm" : null;
    if (!file) { response.writeHead(404); response.end(); return; }
    const bytes = await readFile(path.join(artifact, file));
    response.writeHead(200, {
      "content-type": file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
      "content-length": bytes.byteLength,
      "cross-origin-resource-policy": "same-origin",
      "cache-control": "no-store",
    });
    response.end(bytes);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("R3 audit server did not bind a TCP port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const playwright = await playwrightModule();
  const browser = await playwright.chromium.launch({ headless: true, executablePath: browserExecutable(), args: ["--ignore-gpu-blocklist"] });
  let browserInitialization: BrowserInitialization;
  const browserDurations: number[] = [];
  const browserParityRows: PromotionParityHashRowV2[] = [];
  try {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const workerSource = `
        self.onmessage = async (event) => {
          if (event.data.kind === 'initialize') {
            const coldStarted = performance.now();
            const module = await import(event.data.baseUrl + '/engine.js?worker=' + Date.now());
            const wasm = new Uint8Array(await (await fetch(event.data.baseUrl + '/engine_bg.wasm', { cache: 'no-store' })).arrayBuffer());
            await module.default({ module_or_path: wasm });
            self.blockwildGenerationModule = module;
            self.postMessage({ id: event.data.id, certificate: Array.from(module.blockwild_generation_parity_certificate_v2()), coldMilliseconds: performance.now() - coldStarted });
          } else {
            const started = performance.now();
            const result = self.blockwildGenerationModule.blockwild_generate_chunk_v2(Uint8Array.from(event.data.packet));
            self.postMessage({ id: event.data.id, result: Array.from(result), duration: performance.now() - started });
          }
        };
      `;
    browserInitialization = await page.evaluate(`(async () => {
      const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}], { type: "text/javascript" })));
      const pending = new Map();
      worker.onmessage = (event) => pending.get(event.data.id)?.(event.data);
      let nextId = 1;
      const send = (payload) => new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, (value) => { pending.delete(id); resolve(value); });
        worker.postMessage({ ...payload, id });
      });
      Object.assign(globalThis, { blockwildR3GenerationWorker: { send, terminate: () => worker.terminate() } });
      return await send({ kind: "initialize", baseUrl: ${JSON.stringify(baseUrl)} });
    })()`) as BrowserInitialization;
    const certificate = parseTerrainGenerationParityCertificateV2(Uint8Array.from(browserInitialization.certificate));
    if (!certificate.byteEqual || certificate.corpusCases !== cases.length) throw new Error("browser Worker rejected the promotion certificate");
    for (const [index, packet] of packets.entries()) {
      const generated = await page.evaluate(`globalThis.blockwildR3GenerationWorker.send({ kind: "generate", packet: ${JSON.stringify(Array.from(packet))} })`) as BrowserGeneration;
      browserDurations.push(generated.duration);
      const candidate = decodeRustTerrainGenerationResultV2(Uint8Array.from(generated.result), requests[index]);
      if (!terrainGenerationChunksByteEqualV2(references[index], candidate)) throw new Error(`${cases[index].id}: browser Worker result differs from TS oracle`);
      browserParityRows.push(Object.freeze({
        id: cases[index].id,
        referenceChunkHash: references[index].chunkHash,
        candidateChunkHash: candidate.chunkHash,
      }));
    }
    await page.evaluate("globalThis.blockwildR3GenerationWorker.terminate()");
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  const certificate = parseTerrainGenerationParityCertificateV2(Uint8Array.from(browserInitialization.certificate));
  const browserCorpusHash = promotionCorpusHashV2(frozenManifest, extensionManifest, browserParityRows);
  if (certificate.corpusHash !== browserCorpusHash) {
    throw new Error("browser Worker certificate does not identify the exact 155-case v2 corpus");
  }

  const releaseBuild = spawnSync("cargo", ["build", "--locked", "--release", "-p", "blockwild-generation", "--bin", "blockwild-generation-fixture"], {
    cwd: path.join(ROOT, "engine"), encoding: "utf8", timeout: 300_000,
  });
  if (releaseBuild.status !== 0) throw new Error(releaseBuild.stderr || releaseBuild.stdout);
  await mkdir(WORK, { recursive: true });
  const input = path.join(WORK, "benchmark-requests.bin");
  const output = path.join(WORK, "benchmark-results.bin");
  await writeFile(input, writePacketBatch(packets));
  const native = spawnSync(FIXTURE, ["--packet-benchmark", input, output], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
  if (native.status !== 0) throw new Error(native.stderr || native.stdout);
  const nativeMetrics = JSON.parse(native.stdout.trim()) as Record<string, number> & { perCaseUs: number[] };
  const nativeResults = readPacketBatch(new Uint8Array(await readFile(output)));
  if (nativeMetrics.samples !== cases.length || nativeMetrics.perCaseUs.length !== cases.length || nativeResults.length !== cases.length) {
    throw new Error(`native benchmark returned an incomplete corpus: expected ${cases.length} cases`);
  }
  const nativeParityRows: PromotionParityHashRowV2[] = [];
  for (const [index, result] of nativeResults.entries()) {
    const candidate = decodeRustTerrainGenerationResultV2(result, requests[index]);
    if (!terrainGenerationChunksByteEqualV2(references[index], candidate)) throw new Error(`${cases[index].id}: native benchmark result differs from TS oracle`);
    nativeParityRows.push(Object.freeze({
      id: cases[index].id,
      referenceChunkHash: references[index].chunkHash,
      candidateChunkHash: candidate.chunkHash,
    }));
  }
  const nativeCorpusHash = promotionCorpusHashV2(frozenManifest, extensionManifest, nativeParityRows);
  if (nativeCorpusHash !== browserCorpusHash) throw new Error("native and browser Worker corpus identities differ");

  const wasmBytes = (await readFile(path.join(artifact, "engine_bg.wasm"))).byteLength;
  const jsBytes = (await readFile(path.join(artifact, "engine.js"))).byteLength;
  const namedCaseCount = frozenManifest.cases.length;
  const genericCaseCount = frozenManifest.genericSweep.cases;
  const optionStart = FROZEN_PROMOTION_CASES_V1;
  const optionLaneRows = cases.slice(optionStart).map((entry, offset) => {
    const index = optionStart + offset;
    return Object.freeze({
      ordinal: entry.ordinal,
      id: entry.id,
      typescriptMilliseconds: referenceDurations[index],
      nativeMilliseconds: nativeMetrics.perCaseUs[index] / 1_000,
      browserWorkerMilliseconds: browserDurations[index],
    });
  });
  const result = {
    schema: 2,
    generatorVersion: 18,
    corpusCases: cases.length,
    corpus: {
      namedCases: namedCaseCount,
      genericCases: genericCaseCount,
      normalizedOptionCases: NORMALIZED_OPTION_EXTENSION_CASES_V1,
      totalCases: cases.length,
      requiredCoverageCount,
      corpusHash: browserCorpusHash,
      order: "67 frozen named cases, 64 frozen generic cases, then 24 normalized option lanes; request identity follows stable ordinals 1..155",
    },
    certificate,
    artifactHash,
    artifact: {
      variant: selectedArtifact.variant,
      publicDirectory: path.relative(ROOT, publicEngineDirectory).replaceAll(path.sep, "/"),
      selectedPath: path.relative(ROOT, artifact).replaceAll(path.sep, "/"),
      hash: artifactHash,
      sourceSnapshot: selectedArtifact.sourceSnapshot,
    },
    transferredBytes: { wasm: wasmBytes, javascript: jsBytes, total: wasmBytes + jsBytes },
    timingMilliseconds: {
      typescriptOracle: timingSummary(referenceDurations),
      nativeRust: {
        samples: nativeMetrics.samples,
        cold: nativeMetrics.coldUs / 1_000,
        mean: nativeMetrics.warmMeanUs / 1_000,
        p50: nativeMetrics.warmP50Us / 1_000, p95: nativeMetrics.warmP95Us / 1_000, p99: nativeMetrics.warmP99Us / 1_000,
      },
      browserWorkerWasm: {
        coldImportInstantiate: browserInitialization.coldMilliseconds,
        ...timingSummary(browserDurations),
      },
      genericSweep: {
        typescriptOracle: timingSummary(referenceDurations.slice(namedCaseCount, optionStart)),
        nativeRust: timingSummary(nativeMetrics.perCaseUs.slice(namedCaseCount, optionStart).map((value) => value / 1_000)),
        browserWorkerWasm: timingSummary(browserDurations.slice(namedCaseCount, optionStart)),
      },
      normalizedOptionLanes: {
        typescriptOracle: timingSummary(referenceDurations.slice(optionStart)),
        nativeRust: timingSummary(nativeMetrics.perCaseUs.slice(optionStart).map((value) => value / 1_000)),
        browserWorkerWasm: timingSummary(browserDurations.slice(optionStart)),
      },
    },
    normalizedOptionLanes: {
      cases: optionLaneRows.length,
      rows: optionLaneRows,
    },
    slowestCases: cases.map((entry, index) => ({
      id: entry.id,
      typescriptMilliseconds: referenceDurations[index],
      nativeMilliseconds: nativeMetrics.perCaseUs[index] / 1_000,
      browserWorkerMilliseconds: browserDurations[index],
    })).sort((left, right) => right.nativeMilliseconds - left.nativeMilliseconds).slice(0, 12),
    assertions: {
      exactTypeScriptNative: true,
      exactTypeScriptBrowserWorkerWasm: true,
      exactV2CorpusHashAcrossNativeAndBrowserWorker: true,
      certificateFailClosed: true,
      workerConstructsChunkWorld: false,
    },
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  const verifiedOutputPath = resolveR3BrowserOutputPath(outputPath);
  await writeFile(verifiedOutputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await verifyRustGenerationR3Browser();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`R3 browser verification failed: ${message}\n`);
    process.exitCode = 1;
  }
}
