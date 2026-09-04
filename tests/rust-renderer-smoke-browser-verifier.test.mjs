import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertExactRendererLabManifestSha256,
  decodeRendererSmokeFixture,
  rendererSmokeDiagnosticsAreClean,
  selectExactRendererLabArtifactFromVerification,
  validateRendererSmokeBrowserEvidence,
} from "../scripts/verify-rust-renderer-smoke-browser.mjs";

const ARTIFACT_HASH = "a".repeat(64);
const SOURCE_DIGEST = "b".repeat(64);
const MANIFEST_SHA256 = "f".repeat(64);
const FIXTURE_HASH = "c".repeat(32);

function pushU16(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pushU64(bytes, value) {
  let remaining = BigInt(value);
  for (let index = 0; index < 8; index += 1) { bytes.push(Number(remaining & 0xffn)); remaining >>= 8n; }
}

function pushF32(bytes, value) {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  bytes.push(...new Uint8Array(buffer));
}

function smokeFixture({ materials = 1, instances = 1, instanceMaterialId = 1 } = {}) {
  const payload = [];
  payload.push(...Buffer.from(FIXTURE_HASH, "hex"));
  pushU16(payload, 1);
  const name = Buffer.from("blockwild-wgpu-smoke"); pushU32(payload, name.length); payload.push(...name);
  pushU64(payload, 0); payload.push(18, 32, 28, 255);
  for (const value of [2.5, 2, 3.5, 0, 0, 0, Math.PI / 4, 0.05, 256]) pushF32(payload, value);
  pushU32(payload, materials);
  for (let index = 0; index < materials; index += 1) {
    pushU32(payload, index + 1); payload.push(91, 159, 93, 255, 0, 0, 0, 0);
  }
  pushU32(payload, instances);
  for (let index = 0; index < instances; index += 1) {
    pushU64(payload, index + 1); pushU32(payload, instanceMaterialId);
    for (const value of [0, 0, 0, 1, 1, 1]) pushF32(payload, value);
  }
  payload.push(3); pushU32(payload, 8); pushU32(payload, 0);
  const envelope = [...Buffer.from("BWEP")];
  pushU16(envelope, 1); pushU16(envelope, 1); pushU16(envelope, 20); pushU16(envelope, 0);
  pushU32(envelope, 0); pushU32(envelope, 0); pushU32(envelope, payload.length); pushU64(envelope, 0);
  envelope.push(...payload);
  return Uint8Array.from(envelope);
}

test("canonical smoke fixture decoder requires a non-vacuous BWEP RenderScene", () => {
  const decoded = decodeRendererSmokeFixture(smokeFixture());
  assert.equal(decoded.header.magic, "BWEP");
  assert.equal(decoded.header.kind, 20);
  assert.equal(decoded.sceneName, "blockwild-wgpu-smoke");
  assert.equal(decoded.fixtureHash, FIXTURE_HASH);
  assert.equal(decoded.byteLength, 187);
  assert.equal(decoded.header.payloadLength, 155);
  assert.equal(decoded.materialCount, 1);
  assert.equal(decoded.instanceCount, 1);
  assert.deepEqual(decoded.clearRgba8, [18, 32, 28, 255]);
});

test("canonical smoke fixture decoder rejects framing and renderability defects", () => {
  const badMagic = smokeFixture(); badMagic[0] = 0;
  assert.throws(() => decodeRendererSmokeFixture(badMagic), /invalid BWEP magic/u);
  assert.throws(() => decodeRendererSmokeFixture(smokeFixture().subarray(0, 31)), /shorter than the BWEP header/u);
  const badLength = smokeFixture(); badLength[20] -= 1;
  assert.throws(() => decodeRendererSmokeFixture(badLength), /payload length/u);
  assert.throws(() => decodeRendererSmokeFixture(smokeFixture({ materials: 0, instances: 0 })), /must contain materials/u);
  assert.throws(() => decodeRendererSmokeFixture(smokeFixture({ instanceMaterialId: 99 })), /unknown material/u);
});

function verificationFixture() {
  const sourceSnapshot = { schema: 1, digest: SOURCE_DIGEST, fileCount: 230 };
  const artifact = {
    variant: "renderer-lab",
    hash: ARTIFACT_HASH,
    directory: "/synthetic/renderer-lab",
    manifest: { variant: "renderer-lab", artifactHash: ARTIFACT_HASH, sourceSnapshot, cargoFeatures: ["renderer"] },
    files: [
      { path: "engine.js", role: "glue", bytes: 100, sha256: "d".repeat(64), mimeType: "text/javascript; charset=utf-8" },
      { path: "engine_bg.wasm", role: "wasm", bytes: 200, sha256: "e".repeat(64), mimeType: "application/wasm" },
    ],
  };
  return {
    index: { artifacts: { "renderer-lab": { hash: ARTIFACT_HASH, directory: ARTIFACT_HASH, manifest: `${ARTIFACT_HASH}/manifest.json` } } },
    artifacts: [artifact],
  };
}

test("renderer smoke selection binds the exact canonical renderer-lab artifact and source", () => {
  const selected = selectExactRendererLabArtifactFromVerification(verificationFixture(), {
    artifactHash: ARTIFACT_HASH,
    manifestSha256: MANIFEST_SHA256,
    sourceDigest: SOURCE_DIGEST,
    sourceFileCount: 230,
  });
  assert.equal(selected.artifact.variant, "renderer-lab");
  assert.equal(selected.wasm.path, "engine_bg.wasm");
  assert.equal(selected.glue.path, "engine.js");
  for (const [mutate, pattern] of [
    [(fixture) => { fixture.index.artifacts["renderer-lab"].hash = "f".repeat(64); }, /hash mismatch/u],
    [(fixture) => { fixture.artifacts[0].manifest.sourceSnapshot.digest = "f".repeat(64); }, /source snapshot/u],
    [(fixture) => { fixture.artifacts[0].manifest.cargoFeatures = []; }, /renderer feature/u],
    [(fixture) => { fixture.artifacts[0].files.pop(); }, /exactly one Wasm/u],
  ]) {
    const fixture = verificationFixture(); mutate(fixture);
    assert.throws(() => selectExactRendererLabArtifactFromVerification(fixture, {
      artifactHash: ARTIFACT_HASH, manifestSha256: MANIFEST_SHA256, sourceDigest: SOURCE_DIGEST, sourceFileCount: 230,
    }), pattern);
  }
});

test("renderer smoke manifest guard independently binds the provenance metadata bytes", () => {
  assert.equal(assertExactRendererLabManifestSha256(MANIFEST_SHA256, MANIFEST_SHA256), MANIFEST_SHA256);
  assert.throws(
    () => assertExactRendererLabManifestSha256(MANIFEST_SHA256, "0".repeat(64)),
    /manifest SHA-256 mismatch/u,
  );
});

test("wgpu 30 remains on the pre-JsOption-null-change wasm-bindgen family", async () => {
  const [workspaceManifest, rendererWebManifest, lockfile] = await Promise.all([
    readFile(new URL("../engine/Cargo.toml", import.meta.url), "utf8"),
    readFile(new URL("../engine/crates/blockwild-render-web/Cargo.toml", import.meta.url), "utf8"),
    readFile(new URL("../engine/Cargo.lock", import.meta.url), "utf8"),
  ]);
  assert.match(workspaceManifest, /wasm-bindgen = "=0\.2\.122"/u);
  assert.match(workspaceManifest, /wasm-bindgen-futures = "=0\.4\.72"/u);
  assert.match(workspaceManifest, /0\.2\.123\+ treats a clean WebGPU null as present/u);
  assert.match(rendererWebManifest, /js-sys = "=0\.3\.99"/u);
  assert.match(rendererWebManifest, /web-sys = \{ version = "=0\.3\.99"/u);
  for (const exactPackage of [
    'name = "js-sys"\nversion = "0.3.99"',
    'name = "wasm-bindgen"\nversion = "0.2.122"',
    'name = "wasm-bindgen-futures"\nversion = "0.4.72"',
    'name = "web-sys"\nversion = "0.3.99"',
  ]) assert.ok(lockfile.replaceAll("\r\n", "\n").includes(exactPackage), `lockfile omitted ${exactPackage}`);
});

function passingEvidence() {
  const snapshot = { schema: 1, digest: SOURCE_DIGEST, fileCount: 230 };
  const manifestFile = { path: "manifest.json", bytes: 900, sha256: MANIFEST_SHA256 };
  const glue = { path: "engine.js", bytes: 100, sha256: "d".repeat(64) };
  const wasm = { path: "engine_bg.wasm", bytes: 200, sha256: "e".repeat(64) };
  const resource = (file) => ({ ...file, cacheControl: "public, max-age=31536000, immutable" });
  const request = (pathname, file) => ({ pathname, status: 200, ...resource(file) });
  const identity = { hash: ARTIFACT_HASH, sourceSnapshot: snapshot, manifest: manifestFile, files: { "engine.js": glue, "engine_bg.wasm": wasm } };
  const fixtureBytes = smokeFixture();
  const fixture = decodeRendererSmokeFixture(fixtureBytes);
  return {
    expected: { artifactHash: ARTIFACT_HASH, manifestSha256: MANIFEST_SHA256, fixtureHash: FIXTURE_HASH, sourceDigest: SOURCE_DIGEST, sourceFileCount: 230 },
    artifact: { hash: ARTIFACT_HASH, sourceSnapshot: snapshot, fileCount: 2, manifest: manifestFile, glue, wasm },
    sourceBefore: snapshot,
    sourceAfter: snapshot,
    artifactIdentityBefore: identity,
    artifactIdentityAfter: structuredClone(identity),
    runtime: {
      pass: true,
      browser: { secureContext: true, webGpu: true },
      manifest: { artifactHash: ARTIFACT_HASH, sourceSnapshot: snapshot },
      resources: { manifest: resource(manifestFile), glue: resource(glue), wasm: resource(wasm) },
      exports: { fixture: true, smoke: true },
      fixtureBytesHex: Buffer.from(fixtureBytes).toString("hex"),
      fixtureDecodedBy: "node-canonical-decoder-v1",
      fixture,
      diagnostic: { status: "Rendered", backend: "BrowserWebGpu", fixtureHash: FIXTURE_HASH, message: "offscreen triangle submitted", maxTextureDimension2d: 8192, maxStorageBufferBindingSize: 134217728 },
      webGpuDiagnostics: {
        instrumentation: {
          requestAdapter: true,
          requestDevice: true,
          pushErrorScope: true,
          popErrorScope: true,
          queueSubmit: true,
          queueWorkDone: true,
        },
        adapters: 1,
        devices: 1,
        queues: 1,
        submissions: 1,
        submittedQueues: 1,
        queueWaitsStarted: 1,
        queueWaitsResolved: 1,
        queueWaitErrors: [],
        wgpuPushes: 1,
        wgpuPops: 1,
        wgpuPopResults: [{ deviceId: 1, error: null }],
        scopedErrors: [],
        harnessScopesInstalled: 3,
        harnessScopeResults: [
          { deviceId: 1, filter: "validation", error: null },
          { deviceId: 1, filter: "internal", error: null },
          { deviceId: 1, filter: "out-of-memory", error: null },
        ],
        uncapturedErrors: [],
        deviceLosses: [],
        instrumentationErrors: [],
        settledAfterSmoke: true,
      },
    },
    diagnostics: {
      consoleErrors: [],
      consoleWarnings: [{
        type: "warning",
        text: "The powerPreference option is currently ignored when calling requestAdapter() on Windows. See https://crbug.com/369219127",
      }],
      pageErrors: [],
      requestFailures: [],
      gpuEvents: [
        { phase: "wgpu-pop-result", deviceId: 1, filter: null, constructor: null, name: null, message: null },
        { phase: "harness-scope-result", deviceId: 1, filter: "validation", constructor: null, name: null, message: null },
        { phase: "harness-scope-result", deviceId: 1, filter: "internal", constructor: null, name: null, message: null },
        { phase: "harness-scope-result", deviceId: 1, filter: "out-of-memory", constructor: null, name: null, message: null },
      ],
    },
    http: { requests: [
      { pathname: "/__blockwild_renderer_smoke__", status: 200, bytes: 1, sha256: "1".repeat(64), cacheControl: "no-store" },
      request(`/engine/${ARTIFACT_HASH}/manifest.json`, manifestFile),
      request(`/engine/${ARTIFACT_HASH}/${glue.path}`, glue),
      request(`/engine/${ARTIFACT_HASH}/${wasm.path}`, wasm),
    ] },
    artifacts: { screenshotRetained: true },
    cleanup: { contextClosed: true, browserStopped: true, serverClosed: true, profileRemoved: true },
  };
}

test("positive smoke evidence passes only its bounded subsystem gate", () => {
  const gate = validateRendererSmokeBrowserEvidence(passingEvidence());
  assert.equal(gate.pass, true);
  assert.equal(gate.promotionAuthorized, false);
  assert.match(gate.promotionBlocker, /full renderer parity/u);
  assert(Object.values(gate.checks).every(Boolean));
});

test("smoke evidence fails closed for identity, runtime, diagnostic, screenshot, or cleanup drift", () => {
  const mutations = [
    (evidence) => { evidence.runtime.manifest.artifactHash = "0".repeat(64); },
    (evidence) => { evidence.artifact.manifest.sha256 = "0".repeat(64); },
    (evidence) => { evidence.sourceAfter = { ...evidence.sourceAfter, digest: "0".repeat(64) }; },
    (evidence) => { evidence.runtime.resources.wasm.cacheControl = "no-store"; },
    (evidence) => { evidence.http.requests.at(-1).sha256 = "0".repeat(64); },
    (evidence) => { evidence.runtime.exports.smoke = false; },
    (evidence) => { evidence.runtime.browser.webGpu = false; },
    (evidence) => { evidence.runtime.fixture = { ...evidence.runtime.fixture, instanceCount: 0 }; },
    (evidence) => { evidence.expected.fixtureHash = "0".repeat(32); },
    (evidence) => { evidence.runtime.diagnostic.status = "AdapterUnavailable"; },
    (evidence) => { evidence.runtime.diagnostic.backend = "Vulkan"; },
    (evidence) => { evidence.diagnostics.consoleErrors.push({ text: "GPU error" }); },
    (evidence) => { evidence.diagnostics.consoleWarnings.push({ text: "unexpected WebGPU warning" }); },
    (evidence) => { evidence.runtime.webGpuDiagnostics.queueWaitsResolved = 0; },
    (evidence) => { evidence.runtime.webGpuDiagnostics.wgpuPops = 0; },
    (evidence) => { evidence.runtime.webGpuDiagnostics.scopedErrors.push({ constructor: "GPUInternalError", message: "injected" }); },
    (evidence) => { evidence.runtime.webGpuDiagnostics.harnessScopeResults[0].error = { constructor: "GPUInternalError", message: "injected" }; },
    (evidence) => { evidence.runtime.webGpuDiagnostics.uncapturedErrors.push({ constructor: "GPUValidationError", message: "injected" }); },
    (evidence) => { evidence.runtime.webGpuDiagnostics.deviceLosses.push({ reason: "unknown", message: "injected" }); },
    (evidence) => { evidence.diagnostics.gpuEvents[0].constructor = "GPUInternalError"; },
    (evidence) => { evidence.artifacts.screenshotRetained = false; },
    (evidence) => { evidence.artifactIdentityAfter.files["engine.js"].sha256 = "0".repeat(64); },
    (evidence) => { delete evidence.artifactIdentityBefore; delete evidence.artifactIdentityAfter; },
    (evidence) => { evidence.cleanup.serverClosed = false; },
  ];
  for (const mutate of mutations) {
    const evidence = passingEvidence(); mutate(evidence);
    assert.equal(validateRendererSmokeBrowserEvidence(evidence).pass, false);
  }
});

test("WebGPU diagnostic acceptance rejects injected GPU faults and incomplete queue work", () => {
  const evidence = passingEvidence();
  assert.equal(rendererSmokeDiagnosticsAreClean(evidence.diagnostics, evidence.runtime.webGpuDiagnostics), true);
  for (const mutate of [
    (gpu) => { gpu.instrumentation.popErrorScope = false; },
    (gpu) => { gpu.queueWaitErrors.push({ constructor: "OperationError", message: "injected" }); },
    (gpu) => { gpu.wgpuPushes = 0; },
    (gpu) => { gpu.scopedErrors.push({ constructor: "GPUInternalError", message: "injected" }); },
    (gpu) => { gpu.harnessScopeResults[0].error = { constructor: "GPUInternalError", message: "injected" }; },
    (gpu) => { gpu.uncapturedErrors.push({ constructor: "GPUValidationError", message: "injected" }); },
    (gpu) => { gpu.deviceLosses.push({ reason: "unknown", message: "injected" }); },
    (gpu) => { gpu.settledAfterSmoke = false; },
  ]) {
    const candidate = structuredClone(evidence.runtime.webGpuDiagnostics);
    mutate(candidate);
    assert.equal(rendererSmokeDiagnosticsAreClean(evidence.diagnostics, candidate), false);
  }
});

test("tracked verifier owns exact immutable bytes, real smoke exports, screenshot evidence, and cleanup", async () => {
  const source = await readFile(new URL("../scripts/verify-rust-renderer-smoke-browser.mjs", import.meta.url), "utf8");
  for (const contract of [
    "--output is required and must name a fresh directory beneath work/",
    "public, max-age=31536000, immutable",
    "createRustEngineSourceSnapshot",
    "manifest-sha256",
    "fixture-hash",
    "selectExactRendererLabArtifact",
    "blockwild_render_smoke_fixture",
    "blockwild_render_smoke",
    "exposeBinding",
    "onSubmittedWorkDone",
    "uncapturederror",
    "popErrorScope",
    "status !== \"Rendered\"",
    "navigator.gpu",
    "page.screenshot",
    "context.close",
    "removeOwnedProfile",
    "promotionAuthorized: false",
    "never downloads packages or browsers",
  ]) assert.ok(source.includes(contract), `verifier omitted ${contract}`);
});
