import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSED_RENDERER_PROMOTION_GATES_R11,
  RendererCutoverRuntimeR11,
  RendererShellExtractionPublisherR11,
  rendererRequestFromSearchR11,
  rendererWorldEpochR11,
  resolveRendererCutoverR11,
  type RendererExtractionSinkR11,
} from "../app/game/renderer-cutover-r11.ts";
import type { RendererBackendR11 } from "../app/game/rust-renderer-backend-r11.ts";
import type { RenderFrameV2, RenderResourceBatchV2 } from "../app/game/rust-render-extraction-v2.ts";

const CAPABLE = { supported: true } as const;
const ALL_GATES = {
  hardwareBrowser: true,
  fullGameParity: true,
  supportedDeviceConformance: true,
  comparativePerformance: true,
  compatibilityBundleIsolated: true,
} as const;

test("world renderer epochs are deterministic, positive, and overflow-safe", () => {
  const maximum = BigInt("0xffffffffffffffff");
  assert.equal(rendererWorldEpochR11(BigInt(40), 0), BigInt(40));
  assert.equal(rendererWorldEpochR11(BigInt(40), 2), BigInt(42));
  assert.equal(rendererWorldEpochR11(maximum, 1), BigInt(1));
  assert.throws(() => rendererWorldEpochR11(BigInt(0), 1), /positive u64/u);
  assert.throws(() => rendererWorldEpochR11(BigInt(1), -1), /world generation/u);
});

test("normal renderer selection stays Three and does not silently add a shadow", () => {
  assert.equal(rendererRequestFromSearchR11("?renderer=unknown"), "three");
  const decision = resolveRendererCutoverR11("three", { capability: CAPABLE, allowWgpuShadow: true, allowWgpuPrimary: true, promotionGates: ALL_GATES });
  assert.equal(decision.primary, "three");
  assert.equal(decision.shadow, null);
  assert.equal(decision.compatibilityRole, "shipping-primary");
});

test("wgpu shadow is explicit, independently gated, and leaves Three primary", () => {
  const allowed = resolveRendererCutoverR11("wgpu-shadow", { capability: CAPABLE, allowWgpuShadow: true, allowWgpuPrimary: false, promotionGates: CLOSED_RENDERER_PROMOTION_GATES_R11 });
  assert.deepEqual({ primary: allowed.primary, shadow: allowed.shadow, role: allowed.compatibilityRole }, { primary: "three", shadow: "wgpu", role: "oracle-with-explicit-shadow" });
  const denied = resolveRendererCutoverR11("wgpu-shadow", { capability: CAPABLE, allowWgpuShadow: false, allowWgpuPrimary: false, promotionGates: CLOSED_RENDERER_PROMOTION_GATES_R11 });
  assert.equal(denied.shadow, null);
  assert.equal(denied.fallback?.code, "shadow-policy");
});

test("wgpu primary fails closed until policy and every promotion gate pass", () => {
  const policyClosed = resolveRendererCutoverR11("wgpu", { capability: CAPABLE, allowWgpuShadow: true, allowWgpuPrimary: false, promotionGates: ALL_GATES });
  assert.equal(policyClosed.primary, "three"); assert.equal(policyClosed.fallback?.code, "primary-policy");
  const gatesOpen = resolveRendererCutoverR11("wgpu", { capability: CAPABLE, allowWgpuShadow: true, allowWgpuPrimary: true, promotionGates: { ...ALL_GATES, fullGameParity: false } });
  assert.equal(gatesOpen.primary, "three"); assert.deepEqual(gatesOpen.openPromotionGates, ["fullGameParity"]);
  const promoted = resolveRendererCutoverR11("wgpu", { capability: CAPABLE, allowWgpuShadow: true, allowWgpuPrimary: true, promotionGates: ALL_GATES });
  assert.equal(promoted.primary, "wgpu"); assert.equal(promoted.compatibilityRole, "isolated-fallback");
});

test("renderer selector matrix is deterministic across requests, capabilities, and closed policy", () => {
  const cases = [
    { request: "three", capability: CAPABLE, shadow: true, primary: true, expected: ["three", null, null] },
    { request: "wgpu-shadow", capability: CAPABLE, shadow: true, primary: false, expected: ["three", "wgpu", null] },
    { request: "wgpu-shadow", capability: CAPABLE, shadow: false, primary: false, expected: ["three", null, "shadow-policy"] },
    { request: "wgpu", capability: CAPABLE, shadow: true, primary: false, expected: ["three", null, "primary-policy"] },
    { request: "wgpu", capability: { supported: false, reason: "worker-unavailable" } as const, shadow: true, primary: true, expected: ["three", null, "capability"] },
    { request: "wgpu", capability: { supported: false, reason: "offscreen-canvas-unavailable" } as const, shadow: true, primary: true, expected: ["three", null, "capability"] },
    { request: "wgpu", capability: { supported: false, reason: "webgpu-unavailable" } as const, shadow: true, primary: true, expected: ["three", null, "capability"] },
  ] as const;
  for (const entry of cases) {
    const result = resolveRendererCutoverR11(entry.request, {
      capability: entry.capability,
      allowWgpuShadow: entry.shadow,
      allowWgpuPrimary: entry.primary,
      promotionGates: ALL_GATES,
    });
    assert.deepEqual([result.primary, result.shadow, result.fallback?.code ?? null], entry.expected);
  }
});

test("compatibility selection performs no artifact or backend work", async () => {
  let loads = 0;
  const runtime = new RendererCutoverRuntimeR11({
    request: "three", canvas: {} as HTMLCanvasElement, canvasRole: "shadow", epoch: BigInt(1), width: 640, height: 360,
    capability: CAPABLE, loadArtifact: async () => { loads += 1; throw new Error("must not load"); },
  });
  await runtime.start();
  assert.equal(loads, 0);
  assert.equal(runtime.needsExtraction, false);
  assert.equal(runtime.diagnostics().state, "compatibility");
});

test("wgpu primary keeps Three visible until a real frame presents and restores it on failure", async () => {
  let backendState: "starting" | "ready" | "failed" = "starting";
  let lastPresentedSequence: bigint | null = null;
  let replacementSurfaceRequired = false;
  let emitBackendDiagnostics: (value: unknown) => void = (value) => { void value; throw new Error("backend diagnostics subscriber is not installed"); };
  let resolveReady!: () => void;
  let signalCreated!: () => void;
  const created = new Promise<void>((resolve) => { signalCreated = resolve; });
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  const backend: RendererBackendR11 = {
    kind: "rust-webgpu",
    ready: () => ready,
    resources: () => undefined,
    frame: () => true,
    resize: () => undefined,
    requestRecovery: () => undefined,
    switchEpoch: () => undefined,
    subscribe: (listener) => {
      emitBackendDiagnostics = (value) => { listener(value as never); };
      listener({ state: backendState, lastPresentedSequence, latestSkipReason: null, replacementSurfaceRequired } as never);
      return () => { emitBackendDiagnostics = () => undefined; };
    },
    dispose: () => undefined,
    diagnostics: () => ({ state: backendState, lastPresentedSequence, latestSkipReason: null, replacementSurfaceRequired }) as never,
  };
  const runtime = new RendererCutoverRuntimeR11({
    request: "wgpu", canvas: {} as HTMLCanvasElement, canvasRole: "primary", epoch: BigInt(3), width: 640, height: 360,
    capability: CAPABLE, allowWgpuPrimary: true, promotionGates: ALL_GATES,
    loadArtifact: async () => ({ hash: "a".repeat(64) }) as never,
    createBackend: () => { signalCreated(); return backend; },
  });

  const starting = runtime.start();
  await created;
  assert.deepEqual({ state: runtime.diagnostics().state, selected: runtime.diagnostics().selectedPrimary, active: runtime.diagnostics().activePrimary }, {
    state: "starting", selected: "wgpu", active: "three",
  });
  backendState = "ready";
  emitBackendDiagnostics({ state: backendState, lastPresentedSequence, latestSkipReason: null, replacementSurfaceRequired });
  resolveReady();
  await starting;
  assert.deepEqual({ state: runtime.diagnostics().state, active: runtime.diagnostics().activePrimary }, { state: "ready", active: "three" });
  lastPresentedSequence = BigInt(1);
  emitBackendDiagnostics({ state: backendState, lastPresentedSequence, latestSkipReason: null, replacementSurfaceRequired });
  assert.equal(runtime.diagnostics().activePrimary, "wgpu");
  backendState = "failed";
  replacementSurfaceRequired = true;
  emitBackendDiagnostics({ state: backendState, lastPresentedSequence, latestSkipReason: null, replacementSurfaceRequired });
  assert.deepEqual({ state: runtime.diagnostics().state, active: runtime.diagnostics().activePrimary }, { state: "failed", active: "three" });
});

test("wgpu startup transfer failure keeps the rendered Three fallback without claiming replacement", async () => {
  const runtime = new RendererCutoverRuntimeR11({
    request: "wgpu", canvas: {} as HTMLCanvasElement, canvasRole: "primary", epoch: BigInt(4), width: 640, height: 360,
    capability: CAPABLE, allowWgpuPrimary: true, promotionGates: ALL_GATES,
    loadArtifact: async () => ({ hash: "b".repeat(64) }) as never,
    createBackend: () => { throw new DOMException("OffscreenCanvas transfer failed", "DataCloneError"); },
  });
  await runtime.start();
  assert.deepEqual({
    state: runtime.diagnostics().state,
    selected: runtime.diagnostics().selectedPrimary,
    active: runtime.diagnostics().activePrimary,
    replacement: runtime.diagnostics().replacementSurfaceRequired,
    automatic: runtime.diagnostics().automaticSurfaceReplacement,
    exhausted: runtime.diagnostics().surfaceReplacementExhausted,
  }, { state: "failed", selected: "wgpu", active: "three", replacement: true, automatic: false, exhausted: false });
});

test("shadow runtime queues immutable extraction until its distinct backend is ready", async () => {
  const commands: string[] = [];
  let resolveArtifact!: (value: { hash: string }) => void;
  const artifactPromise = new Promise<{ hash: string }>((resolve) => { resolveArtifact = resolve; });
  const backend: RendererBackendR11 = {
    kind: "rust-webgpu",
    resources: (value) => { commands.push(`resources:${value instanceof Uint8Array}`); },
    frame: (value) => { commands.push(`frame:${value instanceof Uint8Array}`); return true; },
    resize: (width, height) => { commands.push(`resize:${width}x${height}`); },
    requestRecovery: (reason) => { commands.push(`recover:${reason}`); },
    switchEpoch: (epoch) => { commands.push(`epoch:${epoch}`); },
    dispose: () => { commands.push("dispose"); },
    diagnostics: () => ({ state: "ready" }) as never,
  };
  const runtime = new RendererCutoverRuntimeR11({
    request: "wgpu-shadow", canvas: {} as HTMLCanvasElement, canvasRole: "shadow", epoch: BigInt(7), width: 640, height: 360,
    capability: CAPABLE, allowWgpuShadow: true,
    loadArtifact: () => artifactPromise as Promise<never>, createBackend: () => backend,
  });
  const publisher = new RendererShellExtractionPublisherR11(runtime, BigInt(7));
  assert.equal(publisher.present(shellSnapshot()), true);
  const starting = runtime.start();
  resolveArtifact({ hash: "a".repeat(64) });
  await starting;
  assert.deepEqual(commands.slice(0, 3), ["resources:true", "frame:true", "resize:640x360"]);
  assert.equal(runtime.requestRecovery("test"), true);
  assert.equal(commands.at(-1), "recover:test");
  runtime.stop(); assert.equal(commands.at(-1), "dispose");
});

test("world epoch switch drops queued prior-world frames before revisions restart", async () => {
  const commands: string[] = [];
  let backendEpoch = BigInt(0);
  let resolveArtifact!: (value: { hash: string }) => void;
  const artifactPromise = new Promise<{ hash: string }>((resolve) => { resolveArtifact = resolve; });
  const backend: RendererBackendR11 = {
    kind: "rust-webgpu",
    resources: () => { commands.push("resources"); },
    frame: () => { commands.push("frame"); return true; },
    resize: () => undefined,
    requestRecovery: () => undefined,
    switchEpoch: (epoch) => { commands.push(`switch:${epoch}`); },
    dispose: () => undefined,
    diagnostics: () => ({ state: "ready" }) as never,
  };
  const runtime = new RendererCutoverRuntimeR11({
    request: "wgpu-shadow", canvas: {} as HTMLCanvasElement, canvasRole: "shadow", epoch: BigInt(41), width: 640, height: 360,
    capability: CAPABLE, allowWgpuShadow: true,
    loadArtifact: () => artifactPromise as Promise<never>,
    createBackend: (options) => { backendEpoch = options.epoch; return backend; },
  });
  const oldPublisher = new RendererShellExtractionPublisherR11(runtime, BigInt(41));
  oldPublisher.present(shellSnapshot());
  const starting = runtime.start();
  assert.equal(runtime.switchEpoch(BigInt(42)), true);
  assert.equal(oldPublisher.present(shellSnapshot()), false, "a stale world publisher cannot repopulate the new epoch queue");
  const nextPublisher = new RendererShellExtractionPublisherR11(runtime, BigInt(42));
  nextPublisher.present(shellSnapshot());
  resolveArtifact({ hash: "b".repeat(64) });
  await starting;
  assert.equal(backendEpoch, BigInt(42));
  assert.deepEqual(commands.slice(0, 2), ["resources", "frame"], "only the new world queue may reach the backend");
  assert.equal(runtime.diagnostics().epoch, BigInt(42));
});

test("terrain publisher seeds canonical materials without claiming full-game parity", () => {
  const resources: RenderResourceBatchV2[] = [], frames: RenderFrameV2[] = [];
  const sink: RendererExtractionSinkR11 = {
    resources: (value) => { resources.push(value); return true; },
    frame: (value) => { frames.push(value); return true; },
    resize: () => undefined, requestRecovery: () => true, diagnostics: () => ({ state: "ready" }),
  };
  const publisher = new RendererShellExtractionPublisherR11(sink, BigInt(9));
  publisher.present(shellSnapshot());
  assert.equal(resources.length, 1); assert.equal(resources[0].revision, BigInt(1)); assert.equal(resources[0].operations.length, 7);
  assert.ok(resources[0].operations.every((operation) => operation.kind === "upsert-material"));
  assert.equal(frames.length, 1); assert.deepEqual(frames[0].camera.viewport, [960, 540]);
  assert.deepEqual(frames[0].instances, []); assert.deepEqual(frames[0].particles, []);
  assert.deepEqual({ coverage: publisher.diagnostics().coverage, full: publisher.diagnostics().fullGameParity }, {
    coverage: "terrain-camera-environment", full: false,
  });
});

test("terrain publisher revisions geometry, removes unloaded pages, and rejects stale snapshots", () => {
  const resources: RenderResourceBatchV2[] = [], frames: RenderFrameV2[] = [];
  const sink: RendererExtractionSinkR11 = {
    resources: (value) => { resources.push(value); return true; },
    frame: (value) => { frames.push(value); return true; },
    resize: () => undefined, requestRecovery: () => true, diagnostics: () => ({ state: "ready" }),
  };
  const publisher = new RendererShellExtractionPublisherR11(sink, BigInt(11));
  const source = terrainPage(1, 1);
  assert.equal(publisher.present({
    ...shellSnapshot(),
    environment: {
      ...shellSnapshot().environment,
      clearRgb8: [17, 29, 43] as const,
      fogRgb8: [17, 29, 43] as const,
      fogNear: 51.84,
      fogFar: 100.8,
    },
    terrain: source,
  }), true);
  assert.equal(resources.length, 2);
  assert.equal(resources[1].revision, BigInt(2));
  assert.ok(resources[1].operations.some((operation) => operation.kind === "upsert-texture"));
  assert.ok(resources[1].operations.some((operation) => operation.kind === "upsert-geometry"));
  assert.equal(frames.at(-1)?.resourceRevision, BigInt(2));
  assert.equal(frames.at(-1)?.instances.length, 1);
  assert.deepEqual(frames.at(-1)?.environment.lighting, {
    blockIntensity: 1.35,
    minimumAmbient: 0.026,
    waterPhase: 0.375,
    held: source.lighting.held,
    machine: source.lighting.machine,
  });
  assert.deepEqual({
    clear: frames.at(-1)?.environment.clearRgba8,
    fog: frames.at(-1)?.environment.fogRgb8,
    near: frames.at(-1)?.environment.fogNear,
    far: frames.at(-1)?.environment.fogFar,
  }, { clear: [17, 29, 43, 255], fog: [17, 29, 43], near: 51.84, far: 100.8 });

  assert.equal(publisher.present({ ...shellSnapshot(), terrain: source }), true);
  assert.equal(resources.length, 2, "unchanged terrain does not republish resources");
  assert.equal(publisher.present({ ...shellSnapshot(), terrain: terrainPage(2, 2) }), true);
  assert.equal(resources.length, 3);
  assert.ok(resources[2].operations.some((operation) => operation.kind === "upsert-geometry"));

  assert.equal(publisher.present({ ...shellSnapshot(), terrain: { ...terrainPage(3, 2), pages: [] } }), true);
  assert.equal(resources.at(-1)?.operations[0]?.kind, "remove-geometry");
  const frameCount = frames.length;
  assert.equal(publisher.present({ ...shellSnapshot(), terrain: terrainPage(2, 2) }), false);
  assert.equal(frames.length, frameCount, "a stale snapshot cannot submit a frame");
  assert.deepEqual({ rejected: publisher.diagnostics().rejectedStaleTerrain, revision: publisher.diagnostics().terrainSnapshotRevision }, {
    rejected: 1, revision: 3,
  });
});

function shellSnapshot() {
  return {
    simulationTick: BigInt(10), animationTimeMicros: BigInt(20),
    camera: { position: [1, 2, 3] as const, orientation: [0, 0, 0, 1] as const, verticalFovRadians: 1, near: .05, far: 256, viewport: [960, 540] as const },
    environment: { daylight: .8, worldTime: .3, weather: "clear", underwater: 0, caveOcclusion: 0 },
  };
}

function terrainPage(revision: number, pageRevision: number) {
  return {
    schema: 1 as const,
    revision,
    atlas: { revision: 1, width: 1, height: 1, rgba8: new Uint8Array([75, 140, 82, 255]) },
    lighting: {
      skyRgb8: [85, 146, 201] as const, skyIntensity: 0.81,
      sunRgb8: [255, 224, 174] as const, sunDirection: [0.3, 0.9, -0.2] as const, sunIntensity: 0.52,
      blockIntensity: 1.35, minimumAmbient: 0.026, waterPhase: 0.375,
      held: { position: [1, 2, 3] as const, colorRgb8: [255, 116, 40] as const, intensity: 0.72, radius: 9 },
      machine: { position: [-4, 5, 6] as const, colorRgb8: [255, 133, 49] as const, intensity: 0.42, radius: 7.5 },
    },
    pages: [{
      key: "0,0:section:0:opaque", revision: pageRevision, source: "section" as const, section: 0, layer: "opaque" as const,
      translation: [0, 0, 0] as const,
      bounds: { minimum: [0, 0, 0] as const, maximum: [1, 1, 0] as const },
      geometry: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]),
        colors: new Uint8Array(9).fill(255), lights: new Uint8Array(12).fill(255),
        emissions: new Uint8Array(3), occlusions: new Uint8Array(3),
        uvs: new Uint16Array([0, 0, 65_535, 0, 0, 65_535]), indices: new Uint16Array([0, 1, 2]),
      },
      byteLength: 114,
    }],
    selectedChunks: 1,
    availablePages: 1,
    bytes: 114,
    truncated: false,
  };
}
