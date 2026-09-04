import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RustEngineToolError,
  assertSha256,
  createRustEngineSourceSnapshot,
  findRepositoryRoot,
  isDirectInvocation,
  parseCommandLine,
  sha256,
  validatePublishedArtifacts,
} from "./rust-engine-common.mjs";

const GATE_NAME = "blockwild-renderer-lab-wasm-smoke-v1";
const PROFILE_PREFIX = "blockwild-renderer-smoke-";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const ALLOWED_CONSOLE_WARNINGS = Object.freeze([
  "The powerPreference option is currently ignored when calling requestAdapter() on Windows. See https://crbug.com/369219127",
]);
const BROWSER_FLAGS = Object.freeze([
  "--enable-gpu",
  "--enable-unsafe-webgpu",
  "--ignore-gpu-blocklist",
  "--force-high-performance-gpu",
  "--use-angle=d3d11",
]);
const OPTIONS = {
  "repo-root": { type: "string", default: null },
  "public-dir": { type: "string", default: "public/engine" },
  "artifact-hash": { type: "string", default: null },
  "manifest-sha256": { type: "string", default: null },
  "fixture-hash": { type: "string", default: null },
  "source-digest": { type: "string", default: null },
  "source-file-count": { type: "integer", default: null },
  output: { type: "string", default: null },
  "playwright-module": { type: "string", default: process.env.BLOCKWILD_PLAYWRIGHT_MODULE ?? null },
  "browser-executable": { type: "string", default: process.env.BLOCKWILD_BROWSER_EXECUTABLE ?? null },
  "timeout-ms": { type: "integer", default: 120_000 },
  headed: { type: "boolean", default: false },
};

function fail(message, details) {
  throw new RustEngineToolError(message, details);
}

function assertCanonicalHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/u.test(value)) fail(`${label} must be a lowercase 32-character canonical hash.`);
  return value;
}

function readU16(view, offset) {
  return view.getUint16(offset, true);
}

function readU32(view, offset) {
  return view.getUint32(offset, true);
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** Decode enough of the canonical BWEP RenderScene fixture to reject vacuous smoke exports. */
export function decodeRendererSmokeFixture(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 32) fail("Renderer smoke fixture is shorter than the BWEP header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== "BWEP") fail("Renderer smoke fixture has invalid BWEP magic.");
  const header = {
    magic,
    protocolVersion: readU16(view, 4),
    schemaVersion: readU16(view, 6),
    kind: readU16(view, 8),
    flags: readU16(view, 10),
    requestId: readU32(view, 12),
    epoch: readU32(view, 16),
    payloadLength: readU32(view, 20),
    ownershipToken: view.getBigUint64(24, true).toString(),
  };
  if (header.protocolVersion !== 1 || header.schemaVersion !== 1 || header.kind !== 20 || header.flags !== 0) {
    fail("Renderer smoke fixture is not a supported BWEP RenderScene envelope.", { header });
  }
  if (bytes.byteLength !== 32 + header.payloadLength) {
    fail("Renderer smoke fixture payload length does not match its envelope.");
  }

  let offset = 32;
  const requireBytes = (count, label) => {
    if (!Number.isSafeInteger(count) || count < 0 || offset + count > bytes.byteLength) {
      fail(`Renderer smoke fixture is truncated while reading ${label}.`);
    }
  };
  requireBytes(16, "fixture hash");
  const fixtureHash = bytesToHex(bytes.subarray(offset, offset + 16));
  offset += 16;
  requireBytes(6, "scene schema and name length");
  const sceneSchema = readU16(view, offset); offset += 2;
  const nameLength = readU32(view, offset); offset += 4;
  requireBytes(nameLength, "scene name");
  const sceneName = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset, offset + nameLength));
  offset += nameLength;
  requireBytes(8 + 4 + 36 + 4, "scene header");
  const animationTick = view.getBigUint64(offset, true).toString(); offset += 8;
  const clearRgba8 = [...bytes.subarray(offset, offset + 4)]; offset += 4;
  const camera = [];
  for (let index = 0; index < 9; index += 1) {
    const value = view.getFloat32(offset, true); offset += 4;
    if (!Number.isFinite(value)) fail("Renderer smoke fixture camera contains a non-finite value.");
    camera.push(value);
  }
  const materialCount = readU32(view, offset); offset += 4;
  if (materialCount < 1 || materialCount > 65_536) fail("Renderer smoke fixture must contain materials.");
  const materialIds = new Set();
  for (let index = 0; index < materialCount; index += 1) {
    requireBytes(12, `material ${index}`);
    const id = readU32(view, offset); offset += 12;
    if (materialIds.has(id)) fail("Renderer smoke fixture contains duplicate material ids.");
    materialIds.add(id);
  }
  requireBytes(4, "instance count");
  const instanceCount = readU32(view, offset); offset += 4;
  if (instanceCount < 1 || instanceCount > 1_000_000) fail("Renderer smoke fixture must contain instances.");
  const stableIds = new Set();
  for (let index = 0; index < instanceCount; index += 1) {
    requireBytes(36, `instance ${index}`);
    const stableId = view.getBigUint64(offset, true).toString(); offset += 8;
    const materialId = readU32(view, offset); offset += 4;
    if (stableId === "0" || stableIds.has(stableId)) fail("Renderer smoke fixture contains an invalid stable instance id.");
    if (!materialIds.has(materialId)) fail("Renderer smoke fixture instance references an unknown material.");
    stableIds.add(stableId);
    for (let component = 0; component < 6; component += 1) {
      const value = view.getFloat32(offset, true); offset += 4;
      if (!Number.isFinite(value)) fail("Renderer smoke fixture instance contains a non-finite transform.");
    }
  }
  requireBytes(9, "visual diff policy");
  const perChannelTolerance = bytes[offset]; offset += 1;
  const maxMismatchedPixels = readU32(view, offset); offset += 4;
  const ignoredRectangleCount = readU32(view, offset); offset += 4;
  requireBytes(ignoredRectangleCount * 8, "ignored rectangles");
  offset += ignoredRectangleCount * 8;
  if (offset !== bytes.byteLength) fail("Renderer smoke fixture contains trailing bytes.");
  if (sceneSchema !== 1 || sceneName !== "blockwild-wgpu-smoke") {
    fail("Renderer smoke fixture does not identify the canonical smoke scene.");
  }
  return Object.freeze({
    byteLength: bytes.byteLength,
    header: Object.freeze(header),
    fixtureHash,
    sceneSchema,
    sceneName,
    animationTick,
    clearRgba8: Object.freeze(clearRgba8),
    camera: Object.freeze(camera),
    materialCount,
    instanceCount,
    diffPolicy: Object.freeze({ perChannelTolerance, maxMismatchedPixels, ignoredRectangleCount }),
  });
}

function sourceSnapshotMatches(actual, expected) {
  return actual?.schema === 1
    && actual.digest === expected?.digest
    && actual.fileCount === expected?.fileCount;
}

/** Select only the exact renderer-lab artifact named by the caller. */
export function selectExactRendererLabArtifactFromVerification(verification, expected) {
  assertSha256(expected?.artifactHash, "Expected renderer-lab artifact hash");
  assertSha256(expected?.manifestSha256, "Expected renderer-lab manifest SHA-256");
  assertSha256(expected?.sourceDigest, "Expected renderer-lab source digest");
  if (!Number.isSafeInteger(expected?.sourceFileCount) || expected.sourceFileCount < 1) {
    fail("Expected renderer-lab source file count must be a positive integer.");
  }
  const indexEntry = verification?.index?.artifacts?.["renderer-lab"];
  const artifact = verification?.artifacts?.find((candidate) => candidate.variant === "renderer-lab");
  if (!indexEntry || !artifact) fail("Canonical engine publication has no renderer-lab artifact.");
  if (indexEntry.hash !== expected.artifactHash || artifact.hash !== expected.artifactHash) {
    fail(`Canonical renderer-lab artifact hash mismatch: expected ${expected.artifactHash}, found ${indexEntry.hash ?? "missing"}.`);
  }
  const expectedSource = { digest: expected.sourceDigest, fileCount: expected.sourceFileCount };
  if (!sourceSnapshotMatches(artifact.manifest?.sourceSnapshot, expectedSource)) {
    fail("Canonical renderer-lab artifact source snapshot does not match the requested source.");
  }
  if (!Array.isArray(artifact.manifest?.cargoFeatures) || !artifact.manifest.cargoFeatures.includes("renderer")) {
    fail("Canonical renderer-lab artifact was not built with the renderer feature.");
  }
  const wasmFiles = artifact.files.filter((file) => file.role === "wasm");
  const glueFiles = artifact.files.filter((file) => file.role === "glue");
  if (wasmFiles.length !== 1 || glueFiles.length !== 1) {
    fail("Canonical renderer-lab artifact must contain exactly one Wasm binary and one JavaScript glue module.");
  }
  return Object.freeze({
    artifact,
    indexEntry,
    wasm: wasmFiles[0],
    glue: glueFiles[0],
    sourceSnapshot: artifact.manifest.sourceSnapshot,
  });
}

export function assertExactRendererLabManifestSha256(actual, expected) {
  const actualHash = assertSha256(actual, "Canonical renderer-lab manifest SHA-256");
  const expectedHash = assertSha256(expected, "Expected renderer-lab manifest SHA-256");
  if (actualHash !== expectedHash) {
    fail(`Canonical renderer-lab manifest SHA-256 mismatch: expected ${expectedHash}, found ${actualHash}.`);
  }
  return actualHash;
}

export function selectExactRendererLabArtifact(publicEngineDirectory, expected) {
  const verification = validatePublishedArtifacts(publicEngineDirectory);
  const selected = selectExactRendererLabArtifactFromVerification(verification, expected);
  const manifestPath = path.join(selected.artifact.directory, "manifest.json");
  const manifestSha256 = fileIdentity(manifestPath).sha256;
  assertExactRendererLabManifestSha256(manifestSha256, expected.manifestSha256);
  const glueSource = readFileSync(path.join(selected.artifact.directory, ...selected.glue.path.split("/")), "utf8");
  for (const exportName of ["blockwild_render_smoke_fixture", "blockwild_render_smoke"]) {
    if (!glueSource.includes(exportName)) fail(`Renderer-lab glue omits ${exportName}.`);
  }
  return selected;
}

function fileIdentity(filePath) {
  const bytes = readFileSync(filePath);
  return Object.freeze({ bytes: bytes.byteLength, sha256: sha256(bytes) });
}

function artifactIdentity(selected) {
  const files = Object.fromEntries(selected.artifact.files.map((file) => [
    file.path,
    fileIdentity(path.join(selected.artifact.directory, ...file.path.split("/"))),
  ]));
  return Object.freeze({
    hash: selected.artifact.hash,
    sourceSnapshot: selected.sourceSnapshot,
    manifest: fileIdentity(path.join(selected.artifact.directory, "manifest.json")),
    files: Object.freeze(files),
  });
}

function harnessHtml() {
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,"><title>Blockwild renderer-lab Wasm smoke</title>
<style>
:root{color-scheme:dark;font:14px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;background:#08110f;color:#e8f5ee}
body{margin:0;min-height:100vh;padding:28px;box-sizing:border-box;background:radial-gradient(circle at 78% 8%,#204c3d 0,#0d211b 30%,#08110f 68%)}
main{max-width:1060px;margin:auto}.eyebrow{color:#79dca8;letter-spacing:.12em;text-transform:uppercase}h1{font:700 30px/1.1 system-ui,sans-serif;margin:.35rem 0 1.5rem}
.grid{display:grid;grid-template-columns:minmax(270px,.8fr) minmax(420px,1.4fr);gap:18px}.card{background:#0d211bea;border:1px solid #316955;border-radius:14px;padding:18px;box-shadow:0 18px 54px #0008}
#status{font:700 20px/1.25 system-ui,sans-serif;color:#f5d47a}.pass{color:#70e6a9!important}.fail{color:#ff8f86!important}dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 14px}dt{color:#9bb9aa}dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:68vh;overflow:auto;margin:0;font-size:12px}
@media(max-width:820px){.grid{grid-template-columns:1fr}}
</style></head><body><main><div class="eyebrow">Blockwild · canonical renderer-lab</div><h1>Wasm WebGPU smoke verifier</h1><div class="grid"><section class="card"><div id="status">Awaiting exact artifact…</div><dl><dt>Artifact</dt><dd id="artifact">pending</dd><dt>Source</dt><dd id="source">pending</dd><dt>Fixture</dt><dd id="fixture">pending</dd><dt>Backend</dt><dd id="backend">pending</dd></dl></section><section class="card"><pre id="evidence">pending</pre></section></div></main></body></html>`;
}

async function startArtifactServer(selected) {
  const artifactRoot = path.resolve(selected.artifact.directory);
  const hash = selected.artifact.hash;
  const prefix = `/engine/${hash}/`;
  const allowed = new Map(selected.artifact.files.map((file) => [
    `${prefix}${file.path}`,
    { filePath: path.join(artifactRoot, ...file.path.split("/")), mimeType: file.mimeType },
  ]));
  allowed.set(`${prefix}manifest.json`, {
    filePath: path.join(artifactRoot, "manifest.json"),
    mimeType: "application/json; charset=utf-8",
  });
  const requests = [];
  const server = createServer((request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/__blockwild_renderer_smoke__") {
        const bytes = Buffer.from(harnessHtml());
        requests.push({ pathname, status: 200, bytes: bytes.byteLength, sha256: sha256(bytes), cacheControl: "no-store" });
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(bytes); return;
      }
      const resource = allowed.get(pathname);
      if (!resource) {
        requests.push({ pathname, status: 404, bytes: 0 });
        response.writeHead(404, { "Cache-Control": "no-store" }); response.end("not found"); return;
      }
      const bytes = readFileSync(resource.filePath);
      requests.push({
        pathname,
        status: 200,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        contentType: resource.mimeType,
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
      response.writeHead(200, {
        "Content-Type": resource.mimeType,
        "Cache-Control": IMMUTABLE_CACHE_CONTROL,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(bytes);
    } catch (error) {
      requests.push({ pathname: request.url ?? "unknown", status: 500, error: error instanceof Error ? error.message : String(error) });
      response.writeHead(500, { "Cache-Control": "no-store" }); response.end("internal error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") fail("Renderer smoke server did not bind a loopback port.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      if (!server.listening) return true;
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      return !server.listening;
    },
  };
}

function playwrightCandidates(explicitPath) {
  return [
    explicitPath,
    "playwright",
    path.join(os.homedir(), ".codex", "skills", "develop-web-game", "scripts", "node_modules", "playwright", "index.mjs"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "playwright", "index.mjs") : null,
  ].filter((candidate, index, entries) => candidate && entries.indexOf(candidate) === index);
}

async function loadInstalledPlaywright(explicitPath) {
  const failures = [];
  for (const candidate of playwrightCandidates(explicitPath)) {
    if (path.isAbsolute(candidate) && !existsSync(candidate)) {
      failures.push(`${candidate}: missing`); continue;
    }
    try {
      const loaded = await import(path.isAbsolute(candidate) ? pathToFileURL(candidate).href : candidate);
      if (loaded.chromium) return { module: loaded, source: candidate };
      failures.push(`${candidate}: no chromium export`);
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  fail("An installed local Playwright module is required; this verifier never downloads packages or browsers.", { failures });
}

function discoverInstalledBrowser(explicitPath) {
  const candidates = explicitPath ? [path.resolve(explicitPath)] : process.platform === "win32" ? [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ] : [
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const selected = candidates.find((candidate) => candidate && existsSync(candidate) && statSync(candidate).isFile());
  if (!selected) fail(`No installed Chrome or Edge executable was found; checked ${candidates.join(", ")}.`);
  return path.resolve(selected);
}

/** Serialized by Playwright and executed on the loopback harness page. */
export async function runRendererSmokeInBrowser(configuration) {
  const evidence = {
    schema: 1,
    complete: false,
    expected: configuration.expected,
    browser: { userAgent: navigator.userAgent, secureContext: isSecureContext, webGpu: Boolean(navigator.gpu) },
    resources: {},
    manifest: null,
    exports: null,
    fixtureBytesHex: null,
    fixture: null,
    diagnostic: null,
    webGpuDiagnostics: {
      instrumentation: {
        requestAdapter: false,
        requestDevice: false,
        pushErrorScope: false,
        popErrorScope: false,
        queueSubmit: false,
        queueWorkDone: false,
      },
      adapters: 0,
      devices: 0,
      queues: 0,
      submissions: 0,
      submittedQueues: 0,
      queueWaitsStarted: 0,
      queueWaitsResolved: 0,
      queueWaitErrors: [],
      wgpuPushes: 0,
      wgpuPops: 0,
      wgpuPopResults: [],
      scopedErrors: [],
      harnessScopesInstalled: 0,
      harnessScopeResults: [],
      uncapturedErrors: [],
      deviceLosses: [],
      instrumentationErrors: [],
      settledAfterSmoke: false,
    },
    error: null,
  };
  window.__blockwildRendererSmokeEvidence = evidence;
  const status = document.querySelector("#status");
  const output = document.querySelector("#evidence");
  const show = () => {
    document.querySelector("#artifact").textContent = evidence.manifest?.artifactHash ?? configuration.expected.artifactHash;
    document.querySelector("#source").textContent = evidence.manifest?.sourceSnapshot?.digest ?? configuration.expected.sourceDigest;
    document.querySelector("#fixture").textContent = evidence.fixture ? `${evidence.fixture.sceneName} · ${evidence.fixture.instanceCount} instance(s)` : "pending";
    document.querySelector("#backend").textContent = evidence.diagnostic?.backend ?? "pending";
    output.textContent = JSON.stringify(evidence, null, 2);
  };
  const hex = (bytes) => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  const sha256Hex = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  const gpuDiagnostic = evidence.webGpuDiagnostics;
  const restorers = [];
  const instrumentedAdapters = new WeakSet();
  const instrumentedDevices = new WeakSet();
  const instrumentedQueues = new WeakSet();
  const deviceStates = new WeakMap();
  const deviceRecords = [];
  const queueStates = new WeakMap();
  const queueRecords = [];
  const patchedMethods = new WeakMap();
  const harnessFilters = ["out-of-memory", "internal", "validation"];
  const describeGpuError = (error) => ({
    constructor: error?.constructor?.name ?? null,
    name: typeof error?.name === "string" ? error.name : null,
    message: typeof error?.message === "string" ? error.message : String(error),
  });
  const emitGpuEvent = async (phase, fields = {}) => {
    const binding = globalThis[configuration.gpuEventBinding];
    if (typeof binding !== "function") {
      gpuDiagnostic.instrumentationErrors.push({ label: "gpu-event-binding", message: "Playwright binding is unavailable" });
      return;
    }
    try {
      await binding({ phase, ...fields });
    } catch (error) {
      gpuDiagnostic.instrumentationErrors.push({ label: "gpu-event-binding", ...describeGpuError(error) });
    }
  };
  const findMethod = (target, methodName) => {
    let owner = target;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, methodName)) owner = Object.getPrototypeOf(owner);
    const descriptor = owner ? Object.getOwnPropertyDescriptor(owner, methodName) : null;
    return owner && descriptor && typeof descriptor.value === "function" ? { owner, descriptor } : null;
  };
  const replaceMethod = (target, methodName, createReplacement, label) => {
    const method = findMethod(target, methodName);
    if (!method || method.descriptor.configurable !== true) {
      gpuDiagnostic.instrumentationErrors.push({ label, message: `${methodName} is not patchable` });
      return false;
    }
    const { owner, descriptor } = method;
    const names = patchedMethods.get(owner) ?? new Set();
    if (names.has(methodName)) return true;
    try {
      Object.defineProperty(owner, methodName, { ...descriptor, value: createReplacement(descriptor.value) });
      names.add(methodName);
      patchedMethods.set(owner, names);
      restorers.push(() => Object.defineProperty(owner, methodName, descriptor));
      return true;
    } catch (error) {
      gpuDiagnostic.instrumentationErrors.push({ label, ...describeGpuError(error) });
      return false;
    }
  };
  const instrumentQueue = (queue) => {
    if (!queue || instrumentedQueues.has(queue)) return;
    instrumentedQueues.add(queue);
    const workDoneMethod = findMethod(queue, "onSubmittedWorkDone");
    if (!workDoneMethod) {
      gpuDiagnostic.instrumentationErrors.push({ label: "GPUQueue.onSubmittedWorkDone", message: "onSubmittedWorkDone is unavailable" });
      return;
    }
    const record = { id: queueRecords.length + 1, queue, workDone: workDoneMethod.descriptor.value, submissions: 0 };
    queueStates.set(queue, record);
    queueRecords.push(record);
    gpuDiagnostic.queues += 1;
    gpuDiagnostic.instrumentation.queueWorkDone = true;
    gpuDiagnostic.instrumentation.queueSubmit = replaceMethod(
      queue,
      "submit",
      (originalSubmit) => function instrumentedSubmit(...commandBuffers) {
        const result = Reflect.apply(originalSubmit, this, commandBuffers);
        const state = queueStates.get(this);
        if (state) state.submissions += 1;
        else gpuDiagnostic.instrumentationErrors.push({ label: "GPUQueue.submit", message: "submitted queue was not retained" });
        gpuDiagnostic.submissions += 1;
        return result;
      },
      "GPUQueue.submit",
    );
  };
  const instrumentDevice = (device) => {
    if (!device || instrumentedDevices.has(device)) return;
    instrumentedDevices.add(device);
    const pushMethod = findMethod(device, "pushErrorScope");
    const popMethod = findMethod(device, "popErrorScope");
    if (!pushMethod || !popMethod) {
      gpuDiagnostic.instrumentationErrors.push({ label: "GPUDevice.errorScopes", message: "native error-scope methods are unavailable" });
      return;
    }
    const state = {
      id: deviceRecords.length + 1,
      device,
      pushErrorScope: pushMethod.descriptor.value,
      popErrorScope: popMethod.descriptor.value,
      filters: [],
    };
    deviceStates.set(device, state);
    deviceRecords.push(state);
    gpuDiagnostic.devices += 1;
    const onUncapturedError = (event) => {
      const error = describeGpuError(event?.error ?? event);
      gpuDiagnostic.uncapturedErrors.push({ deviceId: state.id, ...error });
      show();
      void emitGpuEvent("uncaptured-error", { deviceId: state.id, ...error });
    };
    device.addEventListener("uncapturederror", onUncapturedError);
    restorers.push(() => device.removeEventListener("uncapturederror", onUncapturedError));
    void Promise.resolve(device.lost).then((info) => {
      const loss = { deviceId: state.id, reason: info?.reason ?? null, message: info?.message ?? "device lost" };
      gpuDiagnostic.deviceLosses.push(loss);
      show();
      return emitGpuEvent("device-lost", loss);
    });
    for (const filter of harnessFilters) {
      try {
        Reflect.apply(state.pushErrorScope, device, [filter]);
        state.filters.push(filter);
        gpuDiagnostic.harnessScopesInstalled += 1;
      } catch (error) {
        const detail = { label: `GPUDevice.pushErrorScope(${filter})`, ...describeGpuError(error) };
        gpuDiagnostic.instrumentationErrors.push(detail);
        void emitGpuEvent("harness-scope-install-error", { deviceId: state.id, filter, ...describeGpuError(error) });
      }
    }
    gpuDiagnostic.instrumentation.pushErrorScope = replaceMethod(
      device,
      "pushErrorScope",
      (originalPushErrorScope) => function instrumentedPushErrorScope(...args) {
        gpuDiagnostic.wgpuPushes += 1;
        return Reflect.apply(originalPushErrorScope, this, args);
      },
      "GPUDevice.pushErrorScope",
    );
    gpuDiagnostic.instrumentation.popErrorScope = replaceMethod(
      device,
      "popErrorScope",
      (originalPopErrorScope) => function instrumentedPopErrorScope(...args) {
        gpuDiagnostic.wgpuPops += 1;
        return Promise.resolve(Reflect.apply(originalPopErrorScope, this, args)).then(
          async (error) => {
            const deviceId = deviceStates.get(this)?.id ?? null;
            const result = { deviceId, error: error ? describeGpuError(error) : null };
            gpuDiagnostic.wgpuPopResults.push(result);
            await emitGpuEvent("wgpu-pop-result", {
              deviceId,
              ...(result.error ?? { constructor: null, name: null, message: null }),
            });
            if (error) {
              const detail = { deviceId, ...describeGpuError(error) };
              gpuDiagnostic.scopedErrors.push(detail);
              show();
            }
            return error;
          },
          async (error) => {
            const detail = { deviceId: deviceStates.get(this)?.id ?? null, ...describeGpuError(error) };
            gpuDiagnostic.scopedErrors.push(detail);
            show();
            await emitGpuEvent("wgpu-pop-rejection", detail);
            throw error;
          },
        );
      },
      "GPUDevice.popErrorScope",
    );
    instrumentQueue(device.queue);
  };
  const instrumentAdapter = (adapter) => {
    if (!adapter || instrumentedAdapters.has(adapter)) return;
    instrumentedAdapters.add(adapter);
    gpuDiagnostic.adapters += 1;
    gpuDiagnostic.instrumentation.requestDevice = replaceMethod(
      adapter,
      "requestDevice",
      (originalRequestDevice) => function instrumentedRequestDevice(...args) {
        return Promise.resolve(Reflect.apply(originalRequestDevice, this, args)).then((device) => {
          instrumentDevice(device);
          return device;
        });
      },
      "GPUAdapter.requestDevice",
    );
  };
  gpuDiagnostic.instrumentation.requestAdapter = replaceMethod(
    navigator.gpu,
    "requestAdapter",
    (originalRequestAdapter) => function instrumentedRequestAdapter(...args) {
      return Promise.resolve(Reflect.apply(originalRequestAdapter, this, args)).then((adapter) => {
        if (adapter) instrumentAdapter(adapter);
        return adapter;
      });
    },
    "GPU.requestAdapter",
  );
  const fetchExact = async (label, descriptor) => {
    const response = await fetch(descriptor.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const expectedContentType = descriptor.mimeType.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== expectedContentType) throw new Error(`${label} content type mismatch`);
    const cacheControl = response.headers.get("cache-control") ?? "";
    if (!/\bimmutable\b/iu.test(cacheControl) || !/\bmax-age=\d+/iu.test(cacheControl)) {
      throw new Error(`${label} was not served as immutable content`);
    }
    const bytes = await response.arrayBuffer();
    const digest = await sha256Hex(bytes);
    if (bytes.byteLength !== descriptor.bytes || digest !== descriptor.sha256) throw new Error(`${label} bytes differ from the selected artifact`);
    evidence.resources[label] = { url: descriptor.url, bytes: bytes.byteLength, sha256: digest, contentType, cacheControl };
    return bytes;
  };
  const decodeFixture = (input) => {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < 32) throw new Error("smoke fixture is shorter than BWEP");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = new TextDecoder().decode(bytes.subarray(0, 4));
    const protocolVersion = view.getUint16(4, true), schemaVersion = view.getUint16(6, true);
    const kind = view.getUint16(8, true), flags = view.getUint16(10, true), payloadLength = view.getUint32(20, true);
    if (magic !== "BWEP" || protocolVersion !== 1 || schemaVersion !== 1 || kind !== 20 || flags !== 0 || bytes.byteLength !== 32 + payloadLength) {
      throw new Error("smoke fixture is not a valid BWEP RenderScene envelope");
    }
    let offset = 32;
    const requireBytes = (count, label) => { if (offset + count > bytes.byteLength) throw new Error(`smoke fixture truncated at ${label}`); };
    requireBytes(16, "fixture hash"); const fixtureHash = hex(bytes.subarray(offset, offset + 16)); offset += 16;
    requireBytes(6, "scene identity"); const sceneSchema = view.getUint16(offset, true); offset += 2;
    const nameLength = view.getUint32(offset, true); offset += 4; requireBytes(nameLength, "scene name");
    const sceneName = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset, offset + nameLength)); offset += nameLength;
    requireBytes(8 + 4 + 36 + 4, "scene header"); offset += 8 + 4 + 36;
    const materialCount = view.getUint32(offset, true); offset += 4;
    if (materialCount < 1 || materialCount > 65_536) throw new Error("smoke fixture has no materials");
    const materialIds = new Set();
    for (let index = 0; index < materialCount; index += 1) { requireBytes(12, "material"); materialIds.add(view.getUint32(offset, true)); offset += 12; }
    requireBytes(4, "instance count"); const instanceCount = view.getUint32(offset, true); offset += 4;
    if (instanceCount < 1 || instanceCount > 1_000_000) throw new Error("smoke fixture has no instances");
    for (let index = 0; index < instanceCount; index += 1) {
      requireBytes(36, "instance"); const stableId = view.getBigUint64(offset, true); offset += 8;
      const materialId = view.getUint32(offset, true); offset += 4;
      if (stableId === 0n || !materialIds.has(materialId)) throw new Error("smoke fixture instance is not renderable");
      for (let component = 0; component < 6; component += 1) { const value = view.getFloat32(offset, true); offset += 4; if (!Number.isFinite(value)) throw new Error("smoke fixture transform is non-finite"); }
    }
    requireBytes(9, "diff policy"); offset += 5; const ignoredRectangleCount = view.getUint32(offset, true); offset += 4;
    requireBytes(ignoredRectangleCount * 8, "ignored rectangles"); offset += ignoredRectangleCount * 8;
    if (offset !== bytes.byteLength || sceneSchema !== 1 || sceneName !== "blockwild-wgpu-smoke") throw new Error("smoke fixture identity or framing mismatch");
    return { byteLength: bytes.byteLength, payloadLength, fixtureHash, sceneSchema, sceneName, materialCount, instanceCount, ignoredRectangleCount };
  };

  let moduleUrl = null;
  try {
    if (!isSecureContext) throw new Error("renderer smoke harness is not a secure context");
    if (!navigator.gpu) throw new Error("navigator.gpu is unavailable");
    const manifestBytes = await fetchExact("manifest", configuration.resources.manifest);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    evidence.manifest = manifest;
    if (manifest.schema !== 1 || manifest.variant !== "renderer-lab" || manifest.artifactHash !== configuration.expected.artifactHash) {
      throw new Error("renderer-lab manifest identity mismatch");
    }
    if (manifest.sourceSnapshot?.schema !== 1
      || manifest.sourceSnapshot.digest !== configuration.expected.sourceDigest
      || manifest.sourceSnapshot.fileCount !== configuration.expected.sourceFileCount) {
      throw new Error("renderer-lab manifest source snapshot mismatch");
    }
    const glueBytes = await fetchExact("glue", configuration.resources.glue);
    const wasmBytes = await fetchExact("wasm", configuration.resources.wasm);
    moduleUrl = URL.createObjectURL(new Blob([glueBytes], { type: "text/javascript" }));
    const renderer = await import(moduleUrl);
    evidence.exports = {
      fixture: typeof renderer.blockwild_render_smoke_fixture === "function",
      smoke: typeof renderer.blockwild_render_smoke === "function",
      names: Object.keys(renderer).sort(),
    };
    if (!evidence.exports.fixture || !evidence.exports.smoke) throw new Error("renderer-lab smoke exports are missing");
    await renderer.default({ module_or_path: wasmBytes });
    const fixtureBytes = renderer.blockwild_render_smoke_fixture();
    evidence.fixtureBytesHex = hex(fixtureBytes);
    evidence.fixture = decodeFixture(fixtureBytes);
    if (evidence.fixture.fixtureHash !== configuration.expected.fixtureHash) throw new Error("renderer-lab smoke fixture hash mismatch");
    const diagnosticValue = await renderer.blockwild_render_smoke();
    const diagnostic = typeof diagnosticValue === "string" ? JSON.parse(diagnosticValue) : diagnosticValue;
    evidence.diagnostic = diagnostic;
    if (!diagnostic || typeof diagnostic !== "object" || diagnostic.status !== "Rendered") throw new Error("WebGPU smoke did not render successfully");
    if (diagnostic.fixtureHash !== evidence.fixture.fixtureHash) throw new Error("WebGPU smoke diagnostic used a different fixture");
    if (typeof diagnostic.backend !== "string" || !diagnostic.backend || diagnostic.backend === "unavailable") throw new Error("WebGPU smoke backend is vacuous");
    if (typeof diagnostic.message !== "string" || !diagnostic.message.includes("submitted")) throw new Error("WebGPU smoke message is vacuous");
    if (!(Number(diagnostic.maxTextureDimension2d) > 0) || !(Number(diagnostic.maxStorageBufferBindingSize) > 0)) throw new Error("WebGPU smoke device limits are vacuous");
    const submittedQueues = queueRecords.filter((record) => record.submissions > 0);
    gpuDiagnostic.submittedQueues = submittedQueues.length;
    gpuDiagnostic.queueWaitsStarted = submittedQueues.length;
    const queueWork = submittedQueues.map((record) => {
      try { return Promise.resolve(Reflect.apply(record.workDone, record.queue, [])); }
      catch (error) { return Promise.reject(error); }
    });
    const queueResults = await Promise.allSettled(queueWork);
    for (let index = 0; index < queueResults.length; index += 1) {
      const result = queueResults[index];
      if (result.status === "fulfilled") gpuDiagnostic.queueWaitsResolved += 1;
      else {
        const detail = { queueId: submittedQueues[index].id, ...describeGpuError(result.reason) };
        gpuDiagnostic.queueWaitErrors.push(detail);
        await emitGpuEvent("queue-work-rejection", detail);
      }
    }
    for (const state of deviceRecords) {
      for (const filter of [...state.filters].reverse()) {
        let error = null;
        try { error = await Reflect.apply(state.popErrorScope, state.device, []); }
        catch (scopeError) { error = scopeError; }
        const detail = { deviceId: state.id, filter, error: error ? describeGpuError(error) : null };
        gpuDiagnostic.harnessScopeResults.push(detail);
        await emitGpuEvent("harness-scope-result", {
          deviceId: state.id,
          filter,
          ...(detail.error ?? { constructor: null, name: null, message: null }),
        });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    gpuDiagnostic.settledAfterSmoke = true;
    if (!Object.values(gpuDiagnostic.instrumentation).every(Boolean)) throw new Error("WebGPU diagnostic instrumentation is incomplete");
    if (gpuDiagnostic.devices < 1 || gpuDiagnostic.submissions < 1) throw new Error("WebGPU smoke did not create a device and submit work");
    if (gpuDiagnostic.submittedQueues < 1
      || gpuDiagnostic.queueWaitsStarted !== gpuDiagnostic.submittedQueues
      || gpuDiagnostic.queueWaitsResolved !== gpuDiagnostic.submittedQueues
      || gpuDiagnostic.queueWaitErrors.length > 0) {
      throw new Error("WebGPU submitted work did not complete cleanly");
    }
    if (gpuDiagnostic.wgpuPushes !== 1
      || gpuDiagnostic.wgpuPops !== 1
      || gpuDiagnostic.wgpuPopResults.length !== 1
      || gpuDiagnostic.wgpuPopResults[0].error !== null) {
      throw new Error("Renderer-lab wgpu validation scope did not resolve once with a clean null result");
    }
    if (gpuDiagnostic.harnessScopesInstalled !== gpuDiagnostic.devices * harnessFilters.length
      || gpuDiagnostic.harnessScopeResults.length !== gpuDiagnostic.harnessScopesInstalled
      || gpuDiagnostic.harnessScopeResults.some((result) => result.error !== null)
      || gpuDiagnostic.scopedErrors.length > 0
      || gpuDiagnostic.uncapturedErrors.length > 0
      || gpuDiagnostic.deviceLosses.length > 0) {
      throw new Error("WebGPU smoke produced a scoped or uncaptured GPU error");
    }
    evidence.complete = true; evidence.pass = true; status.textContent = "Exact Wasm WebGPU smoke rendered"; status.className = "pass"; show();
  } catch (error) {
    evidence.complete = true; evidence.pass = false;
    evidence.error = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null };
    status.textContent = "Renderer-lab smoke failed closed"; status.className = "fail"; show();
  } finally {
    if (moduleUrl) URL.revokeObjectURL(moduleUrl);
    for (const restore of restorers.reverse()) {
      try { restore(); }
      catch (error) { gpuDiagnostic.instrumentationErrors.push({ label: "restore", ...describeGpuError(error) }); }
    }
  }
  return evidence;
}

export function rendererSmokeDiagnosticsAreClean(diagnostics, webGpuDiagnostics) {
  return Array.isArray(diagnostics?.consoleErrors)
    && diagnostics.consoleErrors.length === 0
    && Array.isArray(diagnostics?.consoleWarnings)
    && diagnostics.consoleWarnings.every((warning) => ALLOWED_CONSOLE_WARNINGS.includes(warning?.text))
    && Array.isArray(diagnostics?.pageErrors)
    && diagnostics.pageErrors.length === 0
    && Array.isArray(diagnostics?.requestFailures)
    && diagnostics.requestFailures.length === 0
    && Object.values(webGpuDiagnostics?.instrumentation ?? {}).length === 6
    && Object.values(webGpuDiagnostics.instrumentation).every((installed) => installed === true)
    && Number.isSafeInteger(webGpuDiagnostics?.devices)
    && webGpuDiagnostics.devices >= 1
    && Number.isSafeInteger(webGpuDiagnostics?.queues)
    && webGpuDiagnostics.queues >= 1
    && Number.isSafeInteger(webGpuDiagnostics?.submissions)
    && webGpuDiagnostics.submissions >= 1
    && Number.isSafeInteger(webGpuDiagnostics?.submittedQueues)
    && webGpuDiagnostics.submittedQueues >= 1
    && webGpuDiagnostics.queueWaitsStarted === webGpuDiagnostics.submittedQueues
    && webGpuDiagnostics.queueWaitsResolved === webGpuDiagnostics.submittedQueues
    && Array.isArray(webGpuDiagnostics?.queueWaitErrors)
    && webGpuDiagnostics.queueWaitErrors.length === 0
    && webGpuDiagnostics.wgpuPushes === 1
    && webGpuDiagnostics.wgpuPops === 1
    && Array.isArray(webGpuDiagnostics?.wgpuPopResults)
    && webGpuDiagnostics.wgpuPopResults.length === 1
    && webGpuDiagnostics.wgpuPopResults[0]?.error === null
    && Array.isArray(webGpuDiagnostics?.scopedErrors)
    && webGpuDiagnostics.scopedErrors.length === 0
    && webGpuDiagnostics.harnessScopesInstalled === webGpuDiagnostics.devices * 3
    && Array.isArray(webGpuDiagnostics?.harnessScopeResults)
    && webGpuDiagnostics.harnessScopeResults.length === webGpuDiagnostics.harnessScopesInstalled
    && webGpuDiagnostics.harnessScopeResults.every((result) => result?.error === null)
    && Array.isArray(webGpuDiagnostics?.uncapturedErrors)
    && webGpuDiagnostics.uncapturedErrors.length === 0
    && Array.isArray(webGpuDiagnostics?.deviceLosses)
    && webGpuDiagnostics.deviceLosses.length === 0
    && Array.isArray(webGpuDiagnostics?.instrumentationErrors)
    && webGpuDiagnostics.instrumentationErrors.length === 0
    && Array.isArray(diagnostics?.gpuEvents)
    && diagnostics.gpuEvents.length === webGpuDiagnostics.harnessScopeResults.length + webGpuDiagnostics.wgpuPopResults.length
    && diagnostics.gpuEvents.filter((event) => event?.phase === "wgpu-pop-result").length === 1
    && diagnostics.gpuEvents.filter((event) => event?.phase === "harness-scope-result").length === webGpuDiagnostics.harnessScopeResults.length
    && diagnostics.gpuEvents.every((event) => ["wgpu-pop-result", "harness-scope-result"].includes(event?.phase)
      && event.constructor === null
      && event.name === null
      && event.message === null)
    && webGpuDiagnostics.settledAfterSmoke === true;
}

function sameJson(left, right) {
  return Boolean(left && right && typeof left === "object" && typeof right === "object" && JSON.stringify(left) === JSON.stringify(right));
}

function immutableResourceMatches(resource, expected) {
  return resource?.bytes === expected?.bytes
    && resource.sha256 === expected.sha256
    && /\bimmutable\b/iu.test(resource.cacheControl ?? "")
    && /\bmax-age=\d+/iu.test(resource.cacheControl ?? "");
}

function exactHttpResponseObserved(requests, pathname, expected) {
  return Array.isArray(requests) && requests.some((request) => request?.pathname === pathname
    && request.status === 200
    && request.bytes === expected?.bytes
    && request.sha256 === expected?.sha256
    && /\bimmutable\b/iu.test(request.cacheControl ?? "")
    && /\bmax-age=\d+/iu.test(request.cacheControl ?? ""));
}

function artifactIdentityMatchesEvidence(identity, evidence) {
  const artifact = evidence?.artifact;
  const expected = evidence?.expected;
  if (!identity || typeof identity !== "object" || !identity.files || typeof identity.files !== "object") return false;
  const sameFile = (actual, declared) => actual?.bytes === declared?.bytes && actual?.sha256 === declared?.sha256;
  return identity.hash === expected?.artifactHash
    && sourceSnapshotMatches(identity.sourceSnapshot, { digest: expected?.sourceDigest, fileCount: expected?.sourceFileCount })
    && sameFile(identity.manifest, artifact?.manifest)
    && sameFile(identity.files[artifact?.glue?.path], artifact?.glue)
    && sameFile(identity.files[artifact?.wasm?.path], artifact?.wasm)
    && Object.keys(identity.files).length === artifact?.fileCount;
}

/** Fail-closed, subsystem-only interpretation of retained browser evidence. */
export function validateRendererSmokeBrowserEvidence(evidence) {
  const expected = evidence?.expected;
  const runtime = evidence?.runtime;
  const diagnostic = runtime?.diagnostic;
  const checks = Object.freeze({
    exactArtifact: /^[a-f0-9]{64}$/u.test(expected?.artifactHash ?? "")
      && evidence?.artifact?.hash === expected.artifactHash
      && runtime?.manifest?.artifactHash === expected.artifactHash
      && /^[a-f0-9]{64}$/u.test(expected?.manifestSha256 ?? "")
      && evidence?.artifact?.manifest?.sha256 === expected.manifestSha256
      && runtime?.resources?.manifest?.sha256 === expected.manifestSha256,
    exactSource: /^[a-f0-9]{64}$/u.test(expected?.sourceDigest ?? "")
      && Number.isSafeInteger(expected?.sourceFileCount)
      && sourceSnapshotMatches(evidence?.artifact?.sourceSnapshot, { digest: expected.sourceDigest, fileCount: expected.sourceFileCount })
      && sourceSnapshotMatches(runtime?.manifest?.sourceSnapshot, { digest: expected.sourceDigest, fileCount: expected.sourceFileCount })
      && sourceSnapshotMatches(evidence?.sourceBefore, { digest: expected.sourceDigest, fileCount: expected.sourceFileCount })
      && sourceSnapshotMatches(evidence?.sourceAfter, { digest: expected.sourceDigest, fileCount: expected.sourceFileCount }),
    immutableManifest: immutableResourceMatches(runtime?.resources?.manifest, evidence?.artifact?.manifest),
    immutableGlue: immutableResourceMatches(runtime?.resources?.glue, evidence?.artifact?.glue),
    immutableWasm: immutableResourceMatches(runtime?.resources?.wasm, evidence?.artifact?.wasm),
    exactHttpResponses: exactHttpResponseObserved(evidence?.http?.requests, `/engine/${expected?.artifactHash}/manifest.json`, evidence?.artifact?.manifest)
      && exactHttpResponseObserved(evidence?.http?.requests, `/engine/${expected?.artifactHash}/${evidence?.artifact?.glue?.path}`, evidence?.artifact?.glue)
      && exactHttpResponseObserved(evidence?.http?.requests, `/engine/${expected?.artifactHash}/${evidence?.artifact?.wasm?.path}`, evidence?.artifact?.wasm)
      && evidence.http.requests.every((request) => request.status < 400),
    browserWebGpu: runtime?.browser?.secureContext === true && runtime.browser.webGpu === true,
    smokeExports: runtime?.exports?.fixture === true && runtime?.exports?.smoke === true,
    structuredFixture: runtime?.fixture?.byteLength === 187
      && runtime.fixture.header?.payloadLength === 155
      && runtime.fixtureDecodedBy === "node-canonical-decoder-v1"
      && typeof runtime.fixtureBytesHex === "string"
      && /^[a-f0-9]{374}$/u.test(runtime.fixtureBytesHex)
      && runtime.fixtureBytesHex.slice(64, 96) === runtime.fixture.fixtureHash
      && runtime.fixture.fixtureHash === expected?.fixtureHash
      && runtime.fixture.header?.requestId === 0
      && runtime.fixture.header?.epoch === 0
      && runtime.fixture.header?.ownershipToken === "0"
      && runtime.fixture.sceneName === "blockwild-wgpu-smoke"
      && runtime.fixture.sceneSchema === 1
      && runtime.fixture.animationTick === "0"
      && runtime.fixture.materialCount > 0
      && runtime.fixture.instanceCount > 0
      && sameJson(runtime.fixture.clearRgba8, [18, 32, 28, 255])
      && sameJson(runtime.fixture.camera, [2.5, 2, 3.5, 0, 0, 0, Math.fround(Math.PI / 4), Math.fround(0.05), 256])
      && runtime.fixture.diffPolicy?.perChannelTolerance === 3
      && runtime.fixture.diffPolicy?.maxMismatchedPixels === 8
      && runtime.fixture.diffPolicy?.ignoredRectangleCount === 0
      && /^[a-f0-9]{32}$/u.test(runtime.fixture.fixtureHash ?? ""),
    renderedDiagnostic: runtime?.pass === true
      && diagnostic?.status === "Rendered"
      && diagnostic.fixtureHash === runtime?.fixture?.fixtureHash
      && diagnostic.backend === "BrowserWebGpu"
      && typeof diagnostic.message === "string"
      && diagnostic.message.includes("submitted")
      && Number(diagnostic.maxTextureDimension2d) > 0
      && Number(diagnostic.maxStorageBufferBindingSize) > 0,
    cleanDiagnostics: rendererSmokeDiagnosticsAreClean(evidence?.diagnostics, runtime?.webGpuDiagnostics),
    retainedScreenshot: evidence?.artifacts?.screenshotRetained === true,
    immutableInputs: artifactIdentityMatchesEvidence(evidence?.artifactIdentityBefore, evidence)
      && artifactIdentityMatchesEvidence(evidence?.artifactIdentityAfter, evidence)
      && sameJson(evidence?.artifactIdentityBefore, evidence?.artifactIdentityAfter)
      && sameJson(evidence?.sourceBefore, evidence?.sourceAfter),
    cleanShutdown: evidence?.cleanup?.contextClosed === true
      && evidence?.cleanup?.browserStopped === true
      && evidence?.cleanup?.serverClosed === true
      && evidence?.cleanup?.profileRemoved === true,
  });
  return Object.freeze({
    schema: 1,
    name: GATE_NAME,
    pass: Object.values(checks).every(Boolean),
    checks,
    promotionAuthorized: false,
    promotionBlocker: "This proves only the selected renderer-lab Wasm smoke fixture and offscreen WebGPU submission; full renderer parity, performance, recovery, and production cutover gates remain separate.",
  });
}

function assertFreshWorkOutput(repositoryRoot, requestedOutput) {
  if (!requestedOutput) fail("--output is required and must name a fresh directory beneath work/.");
  const workRoot = path.resolve(repositoryRoot, "work");
  const output = path.resolve(repositoryRoot, requestedOutput);
  const relative = path.relative(workRoot, output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`Renderer smoke output must be strictly beneath ${workRoot}.`);
  }
  if (existsSync(output)) fail(`Renderer smoke output already exists; choose a fresh path: ${output}`);
  return output;
}

async function createOwnedProfile() {
  const trustedTemp = await realpath(os.tmpdir());
  const profile = await mkdtemp(path.join(trustedTemp, PROFILE_PREFIX));
  const token = randomUUID();
  await writeFile(path.join(profile, ".blockwild-renderer-smoke-owner"), token, { encoding: "utf8", flag: "wx" });
  return { profile, token, trustedTemp };
}

async function removeOwnedProfile(ownership) {
  const independentlyResolvedTemp = await realpath(os.tmpdir());
  const profile = path.resolve(ownership.profile);
  const canonicalProfile = await realpath(profile);
  if (independentlyResolvedTemp !== ownership.trustedTemp
    || path.dirname(canonicalProfile) !== independentlyResolvedTemp
    || !path.basename(canonicalProfile).startsWith(PROFILE_PREFIX)
    || lstatSync(profile).isSymbolicLink()
    || canonicalProfile !== profile
    || readFileSync(path.join(canonicalProfile, ".blockwild-renderer-smoke-owner"), "utf8") !== ownership.token) {
    fail(`Refusing to remove unowned browser profile ${profile}.`);
  }
  await rm(canonicalProfile, { recursive: true, force: false, maxRetries: 5, retryDelay: 200 });
  return !existsSync(canonicalProfile);
}

function withTimeout(promise, timeoutMilliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new RustEngineToolError(`${label} timed out after ${timeoutMilliseconds} ms.`)), timeoutMilliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

function sanitizeGpuEvent(record) {
  const boundedText = (value) => typeof value === "string" ? value.slice(0, 2_048) : null;
  const safeInteger = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return Object.freeze({
    phase: boundedText(record?.phase),
    deviceId: safeInteger(record?.deviceId),
    queueId: safeInteger(record?.queueId),
    filter: boundedText(record?.filter),
    constructor: boundedText(record?.constructor),
    name: boundedText(record?.name),
    message: boundedText(record?.message),
  });
}

export async function runRendererSmokeBrowserVerifier(argv = process.argv) {
  const options = parseCommandLine(argv, OPTIONS);
  const repositoryRoot = findRepositoryRoot(options["repo-root"] ?? process.cwd());
  const expected = Object.freeze({
    artifactHash: assertSha256(options["artifact-hash"], "Expected renderer-lab artifact hash"),
    manifestSha256: assertSha256(options["manifest-sha256"], "Expected renderer-lab manifest SHA-256"),
    fixtureHash: assertCanonicalHash(options["fixture-hash"], "Expected renderer-lab fixture hash"),
    sourceDigest: assertSha256(options["source-digest"], "Expected renderer-lab source digest"),
    sourceFileCount: options["source-file-count"],
  });
  if (!Number.isSafeInteger(expected.sourceFileCount) || expected.sourceFileCount < 1) fail("--source-file-count must be a positive integer.");
  if (!Number.isSafeInteger(options["timeout-ms"]) || options["timeout-ms"] < 10_000 || options["timeout-ms"] > 600_000) {
    fail("--timeout-ms must be between 10000 and 600000.");
  }
  const publicEngineDirectory = path.resolve(repositoryRoot, options["public-dir"]);
  const selected = selectExactRendererLabArtifact(publicEngineDirectory, expected);
  const sourceBefore = createRustEngineSourceSnapshot(repositoryRoot);
  if (!sourceSnapshotMatches(sourceBefore, { digest: expected.sourceDigest, fileCount: expected.sourceFileCount })) {
    fail(`Current Rust source does not match requested renderer-lab source ${expected.sourceDigest}/${expected.sourceFileCount}.`);
  }
  const output = assertFreshWorkOutput(repositoryRoot, options.output);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  const screenshotPath = path.join(output, "renderer-lab-wasm-smoke.png");
  const jsonPath = path.join(output, "renderer-lab-wasm-smoke.json");
  const textPath = path.join(output, "renderer-lab-wasm-smoke.txt");
  const manifestPath = path.join(selected.artifact.directory, "manifest.json");
  const artifactIdentityBefore = artifactIdentity(selected);
  const artifact = {
    variant: "renderer-lab",
    hash: selected.artifact.hash,
    sourceSnapshot: selected.sourceSnapshot,
    fileCount: selected.artifact.files.length,
    manifest: { ...fileIdentity(manifestPath), path: "manifest.json" },
    glue: { ...selected.glue },
    wasm: { ...selected.wasm },
  };
  const diagnostics = { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [], gpuEvents: [] };
  const gpuEventBinding = `__blockwildRendererGpuEvent_${randomUUID().replaceAll("-", "")}`;
  const cleanup = { contextClosed: false, browserStopped: false, serverClosed: false, profileRemoved: false };
  const ownership = await createOwnedProfile();
  let server = null, context = null, browser = null, page = null, runtime = null, failure = null;
  let playwrightSource = null, browserExecutable = null, browserVersion = null, screenshotRetained = false;
  try {
    const playwright = await loadInstalledPlaywright(options["playwright-module"]);
    playwrightSource = playwright.source;
    browserExecutable = discoverInstalledBrowser(options["browser-executable"]);
    server = await startArtifactServer(selected);
    context = await playwright.module.chromium.launchPersistentContext(ownership.profile, {
      headless: !options.headed,
      executablePath: browserExecutable,
      ignoreDefaultArgs: ["--disable-gpu"],
      args: [...BROWSER_FLAGS, "--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
      viewport: { width: 1280, height: 800 },
    });
    browser = context.browser();
    browserVersion = browser?.version() ?? null;
    page = context.pages()[0] ?? await context.newPage();
    await page.exposeBinding(gpuEventBinding, (_source, record) => {
      diagnostics.gpuEvents.push(sanitizeGpuEvent(record));
      return true;
    });
    page.on("console", (message) => {
      const record = { type: message.type(), text: message.text() };
      if (["error", "assert"].includes(message.type())) diagnostics.consoleErrors.push(record);
      else if (message.type() === "warning") diagnostics.consoleWarnings.push(record);
    });
    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("requestfailed", (request) => diagnostics.requestFailures.push({ url: request.url(), error: request.failure()?.errorText ?? "unknown" }));
    await page.goto(`${server.baseUrl}/__blockwild_renderer_smoke__`, { waitUntil: "load", timeout: options["timeout-ms"] });
    const prefix = `${server.baseUrl}/engine/${selected.artifact.hash}`;
    runtime = await withTimeout(page.evaluate(runRendererSmokeInBrowser, {
      expected,
      gpuEventBinding,
      resources: {
        manifest: { ...artifact.manifest, mimeType: "application/json; charset=utf-8", url: `${prefix}/manifest.json` },
        glue: { ...selected.glue, url: `${prefix}/${selected.glue.path}` },
        wasm: { ...selected.wasm, url: `${prefix}/${selected.wasm.path}` },
      },
    }), options["timeout-ms"], "Renderer-lab browser smoke");
    if (typeof runtime?.fixtureBytesHex !== "string" || !/^[a-f0-9]+$/u.test(runtime.fixtureBytesHex) || runtime.fixtureBytesHex.length % 2 !== 0) {
      fail("Renderer-lab browser did not return its exact smoke fixture bytes.");
    }
    runtime.browserFixture = runtime.fixture;
    runtime.fixture = decodeRendererSmokeFixture(Buffer.from(runtime.fixtureBytesHex, "hex"));
    runtime.fixtureDecodedBy = "node-canonical-decoder-v1";
  } catch (error) {
    failure = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null };
    if (page) {
      try {
        runtime = await withTimeout(
          page.evaluate(() => window.__blockwildRendererSmokeEvidence ?? null),
          5_000,
          "Partial renderer-lab browser evidence recovery",
        );
      } catch (recoveryError) {
        failure.evidenceRecovery = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      }
    }
  } finally {
    if (page) {
      try { await page.screenshot({ path: screenshotPath, fullPage: true }); screenshotRetained = true; }
      catch (error) { cleanup.screenshotError = error instanceof Error ? error.message : String(error); }
    }
    if (context) {
      try { await context.close(); cleanup.contextClosed = true; }
      catch (error) { cleanup.contextError = error instanceof Error ? error.message : String(error); }
    }
    cleanup.browserStopped = !browser || !browser.isConnected();
    if (server) {
      try { cleanup.serverClosed = await server.close(); }
      catch (error) { cleanup.serverError = error instanceof Error ? error.message : String(error); }
    }
    try { cleanup.profileRemoved = await removeOwnedProfile(ownership); }
    catch (error) { cleanup.profileError = error instanceof Error ? error.message : String(error); }
  }

  const sourceAfter = createRustEngineSourceSnapshot(repositoryRoot);
  let artifactIdentityAfter = null;
  try { artifactIdentityAfter = artifactIdentity(selectExactRendererLabArtifact(publicEngineDirectory, expected)); }
  catch (error) { failure ??= { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null }; }
  const evidence = {
    schema: 1,
    name: GATE_NAME,
    createdAt: new Date().toISOString(),
    expected,
    repositoryRoot,
    publicEngineDirectory,
    artifact,
    sourceBefore,
    sourceAfter,
    artifactIdentityBefore,
    artifactIdentityAfter,
    browser: {
      playwrightSource,
      executable: browserExecutable,
      executableSha256: browserExecutable ? fileIdentity(browserExecutable).sha256 : null,
      version: browserVersion,
      headless: !options.headed,
      flags: BROWSER_FLAGS,
    },
    runtime,
    diagnostics,
    http: { requests: server?.requests ?? [] },
    cleanup,
    artifacts: { screenshot: screenshotPath, json: jsonPath, text: textPath, screenshotRetained },
    failure: failure ?? runtime?.error ?? null,
  };
  evidence.gate = validateRendererSmokeBrowserEvidence(evidence);
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(textPath, [
    `renderer_lab_wasm_smoke=${evidence.gate.pass ? "pass" : "fail"}`,
    `artifact=${artifact.hash}`,
    `source=${sourceBefore.digest}/${sourceBefore.fileCount}`,
    `status=${runtime?.diagnostic?.status ?? "unavailable"}`,
    `backend=${runtime?.diagnostic?.backend ?? "unavailable"}`,
    `fixture=${runtime?.fixture?.sceneName ?? "unavailable"}`,
    `fixture_hash=${runtime?.fixture?.fixtureHash ?? "unavailable"}`,
    `cleanup=${JSON.stringify(cleanup)}`,
    "promotion_authorized=false",
  ].join("\n") + "\n", "utf8");
  return evidence;
}

async function main() {
  try {
    const evidence = await runRendererSmokeBrowserVerifier();
    process.stdout.write(`${JSON.stringify({ pass: evidence.gate.pass, checks: evidence.gate.checks, artifacts: evidence.artifacts })}\n`);
    if (!evidence.gate.pass) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Renderer-lab browser smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
    if (error instanceof RustEngineToolError && error.details) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectInvocation(import.meta.url)) await main();
