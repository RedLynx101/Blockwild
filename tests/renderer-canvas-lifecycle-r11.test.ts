import assert from "node:assert/strict";
import test from "node:test";
import {
  RendererCutoverRuntimeR11,
  RendererVisibleCanvasLifecycleR11,
  applyRendererCanvasPresentationR11,
  rendererCanvasEffectivePixelRatioR11,
  rendererCanvasMetricsR11,
  type RendererSurfaceReplacementRequestR11,
} from "../app/game/renderer-cutover-r11.ts";
import type { RendererBackendR11 } from "../app/game/rust-renderer-backend-r11.ts";
import type { RustRendererDiagnosticsR11, RustRendererDiagnosticsListenerR11 } from "../app/game/rust-renderer-service-r11.ts";

const ALL_GATES = Object.freeze({
  hardwareBrowser: true,
  fullGameParity: true,
  supportedDeviceConformance: true,
  comparativePerformance: true,
  compatibilityBundleIsolated: true,
});

class FakeCanvas {
  width = 300;
  height = 150;
  clientWidth: number;
  clientHeight: number;
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  transfers = 0;

  constructor(width = 800, height = 450) {
    this.clientWidth = width;
    this.clientHeight = height;
  }

  transferControlToOffscreen() {
    this.transfers += 1;
    return { transfer: this.transfers } as unknown as OffscreenCanvas;
  }
}

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type } as Event);
  }

  count(type: string) { return this.listeners.get(type)?.size ?? 0; }
}

class FakeResizeObserver {
  observed: Element | null = null;
  disconnected = false;
  constructor(readonly listener: () => void) {}
  observe(target: Element) { this.observed = target; }
  disconnect() { this.disconnected = true; }
  emit() { this.listener(); }
}

class FakeMutationObserver {
  observed: Node | null = null;
  disconnected = false;
  constructor(readonly listener: () => void) {}
  observe(target: Node) { this.observed = target; }
  disconnect() { this.disconnected = true; }
  emit() { this.listener(); }
}

function canvas(value = new FakeCanvas()) { return value as unknown as HTMLCanvasElement; }

test("canvas presentation has exactly one visual contributor and one stable Three input target", () => {
  const three = new FakeCanvas();
  const wgpu = new FakeCanvas();
  assert.deepEqual(applyRendererCanvasPresentationR11(canvas(three), canvas(wgpu), "wgpu"), {
    presentation: "wgpu",
    visualContributors: 1,
    inputTarget: "three",
  });
  assert.deepEqual({
    threeOpacity: three.style.opacity,
    threePointerEvents: three.style.pointerEvents,
    threeInput: three.dataset.rendererInputTarget,
    wgpuOpacity: wgpu.style.opacity,
    wgpuPointerEvents: wgpu.style.pointerEvents,
    wgpuInput: wgpu.dataset.rendererInputTarget,
  }, {
    threeOpacity: "0",
    threePointerEvents: "auto",
    threeInput: "primary",
    wgpuOpacity: "1",
    wgpuPointerEvents: "none",
    wgpuInput: "none",
  });

  applyRendererCanvasPresentationR11(canvas(three), canvas(wgpu), "three");
  assert.deepEqual([three.style.opacity, wgpu.style.opacity], ["1", "0"]);
  assert.equal(three.style.visibility, "visible", "the pointer-lock target remains in layout");
});

test("canvas lifecycle preserves DPR, resize, fullscreen, keyed replacement ordering, and cleanup", () => {
  const three = new FakeCanvas(800, 450);
  const firstWgpu = new FakeCanvas();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeEventTarget();
  const sizes: Array<readonly [number, number]> = [];
  let dpr = 2;
  const observers: { resize?: FakeResizeObserver; mutation?: FakeMutationObserver } = {};
  const lifecycle = new RendererVisibleCanvasLifecycleR11({
    threeCanvas: canvas(three),
    wgpuCanvas: canvas(firstWgpu),
    resize: (width, height) => { sizes.push([width, height]); },
    devicePixelRatio: () => dpr,
    windowTarget,
    documentTarget,
    createResizeObserver: (listener) => (observers.resize = new FakeResizeObserver(listener)) as never,
    createMutationObserver: (listener) => (observers.mutation = new FakeMutationObserver(listener)) as never,
  });

  assert.deepEqual(lifecycle.start(), {
    cssWidth: 800, cssHeight: 450, devicePixelRatio: 2,
    pixelWidth: 1600, pixelHeight: 900, dimensionClamped: false,
  });
  assert.deepEqual([firstWgpu.width, firstWgpu.height], [1600, 900]);
  assert.deepEqual(sizes, [[1600, 900]]);
  assert.equal(windowTarget.count("resize"), 1);
  assert.equal(documentTarget.count("fullscreenchange"), 1);
  assert.equal(observers.resize?.observed, canvas(three));
  assert.equal(observers.mutation?.observed, canvas(three));

  lifecycle.setPresentation("wgpu");
  const generation = lifecycle.prepareReplacement("worker crashed before a fresh frame");
  assert.equal(firstWgpu.style.opacity, "0", "fallback is visible before React removes the transferred node");
  assert.equal(three.style.opacity, "1");
  assert.equal(generation, 1);

  const replacement = new FakeCanvas();
  assert.equal(lifecycle.installReplacementCanvas(canvas(replacement), generation!), lifecycle.diagnostics().metrics);
  assert.deepEqual([replacement.width, replacement.height], [1600, 900]);
  assert.equal(replacement.style.opacity, "0", "a fresh canvas stays hidden until its first presented frame");
  lifecycle.setPresentation("wgpu");
  assert.deepEqual([three.style.opacity, replacement.style.opacity], ["0", "1"]);

  three.clientWidth = 1024;
  three.clientHeight = 576;
  dpr = 1.25;
  documentTarget.emit("fullscreenchange");
  assert.deepEqual(sizes.at(-1), [1280, 720]);
  observers.resize?.emit();
  windowTarget.emit("resize");
  assert.deepEqual(lifecycle.diagnostics().metrics, rendererCanvasMetricsR11(canvas(three), 1.25));
  assert.deepEqual({ fullscreen: lifecycle.diagnostics().fullscreenEvents, resize: lifecycle.diagnostics().resizeEvents }, { fullscreen: 1, resize: 2 });

  three.width = 1152;
  three.height = 648;
  dpr = rendererCanvasEffectivePixelRatioR11(canvas(three), 1.25);
  observers.mutation?.emit();
  assert.deepEqual(sizes.at(-1), [1152, 648], "adaptive drawing-buffer DPR propagates without a CSS resize");

  lifecycle.dispose();
  assert.equal(observers.resize?.disconnected, true);
  assert.equal(observers.mutation?.disconnected, true);
  assert.equal(windowTarget.count("resize"), 0);
  assert.equal(documentTarget.count("fullscreenchange"), 0);
  assert.deepEqual([three.style.opacity, replacement.style.opacity], ["1", "0"]);
});

class MutableBackend implements RendererBackendR11 {
  readonly kind = "rust-webgpu" as const;
  private readonly listeners = new Set<RustRendererDiagnosticsListenerR11>();
  state: RustRendererDiagnosticsR11["state"] = "ready";
  lastPresentedSequence: bigint | null = null;
  latestSkipReason: string | null = null;
  replacementSurfaceRequired = false;
  epoch = BigInt(7);
  restartSurfaces: OffscreenCanvas[] = [];
  disposed = false;

  ready = async () => undefined;
  resources() {}
  frame() { return true; }
  resize() {}
  requestRecovery(reason = "manual recovery") {
    this.state = "recovering";
    this.lastPresentedSequence = null;
    assert.ok(reason.length > 0);
    this.emit();
  }
  switchEpoch(epoch: bigint) {
    this.epoch = epoch;
    this.state = "recovering";
    this.lastPresentedSequence = null;
    this.emit();
  }
  async restartSurface(surface: OffscreenCanvas) {
    this.restartSurfaces.push(surface);
    this.state = "starting";
    this.replacementSurfaceRequired = false;
    this.lastPresentedSequence = null;
    this.emit();
    this.state = "ready";
    this.emit();
  }
  dispose() { this.disposed = true; }
  diagnostics = () => ({
    state: this.state,
    lastPresentedSequence: this.lastPresentedSequence,
    latestSkipReason: this.latestSkipReason,
    replacementSurfaceRequired: this.replacementSurfaceRequired,
    epoch: this.epoch,
    lastError: this.state === "failed" ? "synthetic worker crash" : null,
  }) as RustRendererDiagnosticsR11;
  subscribe(listener: RustRendererDiagnosticsListenerR11) {
    this.listeners.add(listener);
    listener(this.diagnostics());
    return () => { this.listeners.delete(listener); };
  }
  presented(sequence: bigint) {
    this.state = "ready";
    this.lastPresentedSequence = sequence;
    this.latestSkipReason = null;
    this.emit();
  }
  recoveredWithoutFrame() {
    this.state = "ready";
    this.lastPresentedSequence = null;
    this.emit();
  }
  fail() {
    this.state = "failed";
    this.replacementSurfaceRequired = true;
    this.emit();
  }
  private emit() {
    const diagnostics = this.diagnostics();
    for (const listener of this.listeners) listener(diagnostics);
  }
}

test("primary lifecycle falls back before bounded worker replacement and waits for a fresh frame", async () => {
  const backend = new MutableBackend();
  const order: string[] = [];
  const replacementRequests: RendererSurfaceReplacementRequestR11[] = [];
  const runtime = new RendererCutoverRuntimeR11({
    request: "wgpu",
    canvas: canvas(),
    canvasRole: "primary",
    epoch: BigInt(7),
    width: 1600,
    height: 900,
    capability: { supported: true },
    allowWgpuPrimary: true,
    promotionGates: ALL_GATES,
    surfaceReplacementLimit: 2,
    loadArtifact: async () => ({ hash: "a".repeat(64) }) as never,
    createBackend: () => backend,
    onPrimaryPresentation: (presentation) => { order.push(`present:${presentation}`); },
    onSurfaceReplacementRequired: (request) => {
      order.push(`replace:${request.attempt}`);
      replacementRequests.push(request);
    },
  });

  await runtime.start();
  assert.equal(runtime.diagnostics().activePrimary, "three", "worker-ready cannot expose a blank surface");
  backend.presented(BigInt(1));
  assert.equal(runtime.diagnostics().activePrimary, "wgpu");

  runtime.requestRecovery("synthetic device loss");
  assert.equal(runtime.diagnostics().activePrimary, "three");
  backend.recoveredWithoutFrame();
  assert.equal(runtime.diagnostics().activePrimary, "three", "resource replay alone cannot expose a stale frame");
  backend.presented(BigInt(2));
  assert.equal(runtime.diagnostics().activePrimary, "wgpu");

  assert.equal(runtime.switchEpoch(BigInt(8)), true);
  assert.equal(runtime.diagnostics().activePrimary, "three", "old-world pixels hide synchronously at the epoch boundary");
  backend.recoveredWithoutFrame();
  assert.equal(runtime.diagnostics().activePrimary, "three");
  backend.presented(BigInt(1));
  assert.equal(runtime.diagnostics().activePrimary, "wgpu", "only a current-epoch frame may re-promote WGPU");

  backend.fail();
  assert.deepEqual(order.slice(-2), ["present:three", "replace:1"], "fallback is synchronous before keyed replacement");
  assert.equal(runtime.diagnostics().surfaceReplacementPending, true);
  const firstReplacement = new FakeCanvas();
  assert.equal(await runtime.replaceSurface(canvas(firstReplacement), replacementRequests[0]!.token), true);
  assert.equal(firstReplacement.transfers, 1);
  assert.equal(runtime.diagnostics().activePrimary, "three");
  backend.presented(BigInt(3));
  assert.equal(runtime.diagnostics().activePrimary, "wgpu");

  backend.fail();
  const secondReplacement = new FakeCanvas();
  assert.equal(await runtime.replaceSurface(canvas(secondReplacement), replacementRequests[1]!.token), true);
  backend.fail();
  assert.equal(replacementRequests.length, 2, "the replacement budget is hard bounded");
  assert.equal(runtime.diagnostics().surfaceReplacementExhausted, true);
  assert.equal(runtime.diagnostics().activePrimary, "three");
  assert.ok(runtime.diagnostics().fallbackEvents.length <= 8);
  runtime.stop();
});
