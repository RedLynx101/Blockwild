import {
  decodeRenderFrameV2,
  decodeRenderResourceBatchV2,
  encodeRenderFrameV2,
  encodeRenderResourceBatchV2,
  type RenderFrameV2,
  type RenderResourceBatchV2,
} from "./rust-render-extraction-v2.ts";
import type {
  RustRendererLifecycleR11,
  RustRendererWorkerCommandR11,
  RustRendererWorkerEventR11,
} from "./rust-renderer-worker-r11.ts";

type WorkerLikeR11 = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent<RustRendererWorkerEventR11>) => void) | null;
  onerror?: ((event: ErrorEvent) => void) | null;
};

export type RustRendererDiagnosticsR11 = Readonly<{
  state: "idle" | "starting" | "ready" | "recovering" | "failed" | "stopped";
  epoch: bigint;
  surfaceGeneration: number;
  recoveryGeneration: number;
  resourceRevision: bigint;
  submittedFrames: number;
  presentedFrames: number;
  droppedFrames: number;
  staleFrames: number;
  resourceBytes: number;
  frameBytes: number;
  replayedResourceBytes: number;
  latestCpuMicros: number | null;
  latestGpuMicros: number | null;
  backend: string | null;
  adapter: string | null;
  timestampQuerySupported: boolean;
  visibleInstances: number;
  culledInstances: number;
  drawCalls: number;
  transparentDrawCalls: number;
  geometryBytes: number;
  uploadedInstanceBytes: number;
  residentInstanceBytes: number;
  instanceBufferReallocations: number;
  skippedFrames: number;
  workerRestarts: number;
  deviceRecoveries: number;
  coalescedRecoveryRequests: number;
  staleLifecycleEvents: number;
  replacementSurfaceRequired: boolean;
  replayPages: number;
  replayPageLimit: number;
  replayByteLimit: number;
  replayPressurePermille: number;
  replayOverflowCount: number;
  lastReplayOverflow: RustRendererReplayOverflowR11 | null;
  lastPresentedSequence: bigint | null;
  latestSkipReason: string | null;
  lastError: string | null;
}>;

export type RustRendererDiagnosticsListenerR11 = (diagnostics: RustRendererDiagnosticsR11) => void;

type MutableDiagnosticsR11 = { -readonly [K in keyof RustRendererDiagnosticsR11]: RustRendererDiagnosticsR11[K] };
export type RustRendererReplayLimitsR11 = Readonly<{
  maxBytes: number;
  maxPages: number;
}>;

export type RustRendererReplayOverflowR11 = Readonly<{
  code: "byte-limit" | "page-limit";
  attemptedBytes: number;
  attemptedPages: number;
  maxBytes: number;
  maxPages: number;
}>;

const DEFAULT_REPLAY_LIMITS_R11: RustRendererReplayLimitsR11 = Object.freeze({
  maxBytes: 256 * 1024 * 1024,
  maxPages: 65_536,
});
const U64_MAX_R11 = BigInt("0xffffffffffffffff");

type FrameSubmissionR11 = Readonly<{
  sequence: bigint;
  epoch: bigint;
  bytes: Uint8Array;
}>;

type InFlightFrameR11 = Readonly<{
  sequence: bigint;
  epoch: bigint;
  surfaceGeneration: number;
  recoveryGeneration: number;
}>;

type ReadyDeferredR11 = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  settled: boolean;
};

function checkedRendererEpochR11(epoch: bigint) {
  if (epoch <= BigInt(0) || epoch > U64_MAX_R11) throw new RangeError("renderer epoch must be a positive u64");
  return epoch;
}

export type RustRendererArtifactR11 = Readonly<{
  hash: string;
  moduleUrl: string;
  wasmUrl: string;
  resourceFixtureUrl: string;
  frameFixtureUrl: string;
  liveResourceFixtureUrl: string;
  liveFrameFixtureUrl: string;
  visualMatrixManifestUrl: string;
  visualMatrixScenes: readonly Readonly<{
    name: string;
    purpose: string;
    resourceFixtureUrl: string;
    frameFixtureUrl: string;
  }>[];
}>;

export async function loadRustRendererArtifactR11(options: Readonly<{
  fetcher?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
}> = {}): Promise<RustRendererArtifactR11> {
  const fetcher = options.fetcher ?? fetch;
  const base = (options.baseUrl ?? "/renderer").replace(/\/+$/, "");
  const response = await fetcher(`${base}/manifest.json`, { cache: "no-store", signal: options.signal });
  if (!response.ok) throw new Error(`renderer manifest returned HTTP ${response.status}`);
  const manifest = await response.json() as Record<string, unknown>;
  const runtime = manifest.runtime as Record<string, unknown> | undefined;
  const hash = runtime?.artifactHash;
  if (runtime?.schema !== 1 || runtime.backend !== "wgpu-webgpu" || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new TypeError("renderer manifest has no valid WebGPU runtime");
  }
  const safePathValue = (value: unknown, key: string) => {
    if (typeof value !== "string" || !value.startsWith(`${hash}/`) || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new TypeError(`renderer manifest ${key} is not content-addressed safely`);
    }
    return `${base}/${value}`;
  };
  const pathValue = (key: string) => safePathValue(runtime[key], key);
  const visualMatrix = runtime.visualMatrix as Record<string, unknown> | undefined;
  const rawScenes = visualMatrix?.scenes;
  if (!Array.isArray(rawScenes) || rawScenes.length !== 7) throw new TypeError("renderer manifest visualMatrix is incomplete");
  const sceneNames = new Set<string>();
  const visualMatrixScenes = rawScenes.map((raw, index) => {
    const scene = raw as Record<string, unknown>;
    if (typeof scene.name !== "string" || !/^[a-z0-9-]+$/u.test(scene.name) || typeof scene.purpose !== "string") {
      throw new TypeError(`renderer manifest visualMatrix scene ${index} is invalid`);
    }
    if (sceneNames.has(scene.name)) throw new TypeError(`renderer manifest visualMatrix scene ${scene.name} is duplicated`);
    sceneNames.add(scene.name);
    return Object.freeze({
      name: scene.name,
      purpose: scene.purpose,
      resourceFixtureUrl: safePathValue(scene.resourceFixture, `visualMatrix.scenes[${index}].resourceFixture`),
      frameFixtureUrl: safePathValue(scene.frameFixture, `visualMatrix.scenes[${index}].frameFixture`),
    });
  });
  return Object.freeze({
    hash,
    moduleUrl: pathValue("module"),
    wasmUrl: pathValue("wasm"),
    resourceFixtureUrl: pathValue("resourceFixture"),
    frameFixtureUrl: pathValue("frameFixture"),
    liveResourceFixtureUrl: pathValue("liveResourceFixture"),
    liveFrameFixtureUrl: pathValue("liveFrameFixture"),
    visualMatrixManifestUrl: safePathValue(visualMatrix?.manifest, "visualMatrix.manifest"),
    visualMatrixScenes: Object.freeze(visualMatrixScenes),
  });
}

export class RustRendererServiceR11 {
  private readonly replayPages = new Map<bigint, Uint8Array>();
  private inFlight: InFlightFrameR11 | null = null;
  private pending: FrameSubmissionR11 | null = null;
  private pendingSize: Readonly<{ width: number; height: number }> | null = null;
  private sentResourceRevision = BigInt(0);
  private worker: WorkerLikeR11 | null = null;
  private artifact: Pick<RustRendererArtifactR11, "moduleUrl" | "wasmUrl"> | null = null;
  private surfaceGeneration = 0;
  private surfaceEpoch = BigInt(0);
  private surfaceRecoveryGeneration = 0;
  private recoveryGeneration = 0;
  private recoveryInFlight = false;
  private initializingLifecycle: RustRendererLifecycleR11 | null = null;
  private replayOnReady = false;
  private readyDeferred: ReadyDeferredR11 | null = null;
  private readonly diagnosticsListeners = new Set<RustRendererDiagnosticsListenerR11>();
  private readonly replayLimits: RustRendererReplayLimitsR11;
  private diagnostics: MutableDiagnosticsR11 = {
    state: "idle", epoch: BigInt(0), surfaceGeneration: 0, recoveryGeneration: 0,
    resourceRevision: BigInt(0), submittedFrames: 0,
    presentedFrames: 0, droppedFrames: 0, staleFrames: 0, resourceBytes: 0, frameBytes: 0,
    replayedResourceBytes: 0, latestCpuMicros: null, latestGpuMicros: null,
    backend: null, adapter: null, timestampQuerySupported: false,
    visibleInstances: 0, culledInstances: 0, drawCalls: 0, transparentDrawCalls: 0,
    geometryBytes: 0, uploadedInstanceBytes: 0, residentInstanceBytes: 0,
    instanceBufferReallocations: 0, skippedFrames: 0, workerRestarts: 0, deviceRecoveries: 0,
    coalescedRecoveryRequests: 0, staleLifecycleEvents: 0, replacementSurfaceRequired: false,
    replayPages: 0, replayPageLimit: DEFAULT_REPLAY_LIMITS_R11.maxPages,
    replayByteLimit: DEFAULT_REPLAY_LIMITS_R11.maxBytes, replayPressurePermille: 0,
    replayOverflowCount: 0, lastReplayOverflow: null,
    lastPresentedSequence: null, latestSkipReason: null, lastError: null,
  };

  constructor(
    private readonly createWorker: () => WorkerLikeR11 = () => new Worker(new URL("./rust-renderer-worker-r11.ts", import.meta.url), { type: "module", name: "blockwild-r11-renderer" }),
    replayLimits: Partial<RustRendererReplayLimitsR11> = {},
  ) {
    const maxBytes = replayLimits.maxBytes ?? DEFAULT_REPLAY_LIMITS_R11.maxBytes;
    const maxPages = replayLimits.maxPages ?? DEFAULT_REPLAY_LIMITS_R11.maxPages;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("renderer replay byte limit must be a positive safe integer");
    if (!Number.isSafeInteger(maxPages) || maxPages <= 0) throw new RangeError("renderer replay page limit must be a positive safe integer");
    this.replayLimits = Object.freeze({ maxBytes, maxPages });
    this.diagnostics.replayByteLimit = maxBytes;
    this.diagnostics.replayPageLimit = maxPages;
  }

  start(canvas: OffscreenCanvas, artifact: Pick<RustRendererArtifactR11, "moduleUrl" | "wasmUrl">, epoch: bigint, width: number, height: number) {
    if (this.worker) throw new Error("renderer service is already started");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("renderer dimensions must be positive integers");
    this.artifact = Object.freeze({ ...artifact });
    this.replayOnReady = false;
    const checkedEpoch = checkedRendererEpochR11(epoch);
    this.surfaceEpoch = checkedEpoch;
    this.surfaceRecoveryGeneration = this.recoveryGeneration;
    this.recoveryInFlight = false;
    this.readyDeferred = this.createReadyDeferred();
    this.diagnostics = { ...this.diagnostics, state: "starting", epoch: checkedEpoch, resourceRevision: BigInt(0),
      recoveryGeneration: this.recoveryGeneration, resourceBytes: 0, replayedResourceBytes: 0,
      replayPages: 0, replayPressurePermille: 0, replacementSurfaceRequired: false,
      lastPresentedSequence: null, lastError: null };
    try { this.startWorker(canvas, width, height); }
    catch (error) { this.fail(this.errorMessage(error, "renderer worker initialization transfer failed")); }
    this.publishDiagnostics();
  }

  ready() {
    if (this.diagnostics.state === "ready") return Promise.resolve();
    if (this.diagnostics.state === "failed" || this.diagnostics.state === "stopped") {
      return Promise.reject(new Error(this.diagnostics.lastError ?? `renderer service is ${this.diagnostics.state}`));
    }
    if (!this.readyDeferred) return Promise.reject(new Error("renderer service has not been started"));
    return this.readyDeferred.promise;
  }

  /**
   * A crashed worker cannot recover ownership of its transferred canvas. The
   * caller must explicitly supply a replacement OffscreenCanvas; this service
   * does not claim that React or the DOM has recreated the transferred canvas.
   * Once supplied, it replays the exact durable BWRD history in revision order
   * before accepting a new frame.
   */
  restartSurface(canvas: OffscreenCanvas, width: number, height: number) {
    if (this.diagnostics.state !== "failed" || !this.artifact) throw new Error("renderer surface restart requires a failed initialized service");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("renderer dimensions must be positive integers");
    this.disposeWorker();
    this.inFlight = null; this.pending = null; this.pendingSize = null; this.sentResourceRevision = BigInt(0);
    this.recoveryInFlight = false;
    this.replayOnReady = true;
    this.readyDeferred = this.createReadyDeferred();
    this.diagnostics.state = "starting"; this.diagnostics.lastError = null;
    this.diagnostics.lastPresentedSequence = null;
    this.diagnostics.latestSkipReason = null;
    this.diagnostics.replacementSurfaceRequired = false; this.diagnostics.workerRestarts += 1;
    try { this.startWorker(canvas, width, height); }
    catch (error) { this.fail(this.errorMessage(error, "replacement renderer surface transfer failed")); }
    this.publishDiagnostics();
  }

  applyResources(value: RenderResourceBatchV2 | Uint8Array) {
    if (this.diagnostics.state === "failed" || this.diagnostics.state === "stopped") return false;
    const batch = value instanceof Uint8Array ? decodeRenderResourceBatchV2(value) : value;
    const bytes = value instanceof Uint8Array ? value.slice() : encodeRenderResourceBatchV2(batch);
    if (batch.epoch !== this.diagnostics.epoch) throw new Error("renderer resource epoch does not match the active world");
    const expected = this.diagnostics.resourceRevision + BigInt(1);
    if (batch.revision !== expected) throw new Error(`renderer resource revision gap: expected ${expected}, received ${batch.revision}`);
    const attemptedPages = this.replayPages.size + 1;
    const attemptedBytes = this.diagnostics.resourceBytes + bytes.byteLength;
    if (attemptedPages > this.replayLimits.maxPages || attemptedBytes > this.replayLimits.maxBytes) {
      const code = attemptedPages > this.replayLimits.maxPages ? "page-limit" : "byte-limit";
      this.diagnostics.replayOverflowCount += 1;
      this.diagnostics.lastReplayOverflow = Object.freeze({
        code,
        attemptedBytes,
        attemptedPages,
        maxBytes: this.replayLimits.maxBytes,
        maxPages: this.replayLimits.maxPages,
      });
      throw new RangeError(`renderer resource replay ${code} exceeded`);
    }
    this.replayPages.set(batch.revision, bytes.slice());
    this.diagnostics.resourceRevision = batch.revision;
    this.diagnostics.resourceBytes += bytes.byteLength;
    this.updateReplayPressure();
    if (this.diagnostics.state === "ready") this.sendUnsentResources();
    return true;
  }

  present(value: RenderFrameV2 | Uint8Array) {
    if (this.diagnostics.state === "failed" || this.diagnostics.state === "stopped") return false;
    const frame = value instanceof Uint8Array ? decodeRenderFrameV2(value) : value;
    const bytes = value instanceof Uint8Array ? value.slice() : encodeRenderFrameV2(frame);
    if (frame.epoch !== this.diagnostics.epoch || frame.resourceRevision > this.diagnostics.resourceRevision) {
      this.diagnostics.staleFrames += 1;
      return false;
    }
    this.diagnostics.submittedFrames += 1;
    this.diagnostics.frameBytes += bytes.byteLength;
    if (this.inFlight || this.diagnostics.state !== "ready") {
      if (this.pending) this.diagnostics.droppedFrames += 1;
      this.pending = { sequence: frame.frameSequence, epoch: frame.epoch, bytes };
      return true;
    }
    this.sendFrame({ sequence: frame.frameSequence, epoch: frame.epoch, bytes });
    return true;
  }

  resize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("renderer dimensions must be positive integers");
    this.pendingSize = { width, height };
    if (this.diagnostics.state === "ready") this.sendPendingSize();
  }

  requestRecovery(reason = "renderer recovery requested") {
    if (!this.worker || this.diagnostics.state === "failed" || this.diagnostics.state === "stopped") return false;
    if (this.recoveryInFlight) {
      this.diagnostics.coalescedRecoveryRequests += 1;
      return true;
    }
    return this.beginRecovery(reason, this.diagnostics.state !== "starting");
  }

  switchEpoch(epoch: bigint) {
    const nextEpoch = checkedRendererEpochR11(epoch);
    if (!this.worker || this.diagnostics.state === "failed" || this.diagnostics.state === "stopped") return false;
    const starting = this.diagnostics.state === "starting";
    this.replayPages.clear(); this.pending = null; this.inFlight = null; this.sentResourceRevision = BigInt(0);
    this.diagnostics = { ...this.diagnostics, epoch: nextEpoch, resourceRevision: BigInt(0), resourceBytes: 0,
      replayedResourceBytes: 0, replayPages: 0, replayPressurePermille: 0,
      lastPresentedSequence: null, latestSkipReason: null, state: starting ? "starting" : "recovering" };
    this.recoveryGeneration += 1;
    this.recoveryInFlight = true;
    this.diagnostics.recoveryGeneration = this.recoveryGeneration;
    this.diagnostics.deviceRecoveries += 1;
    // The visible-canvas shell must hide old-world pixels before the recovery
    // command can race a later paint or acknowledgement.
    this.publishDiagnostics();
    if (!starting) this.sendRecovery();
    return true;
  }

  stop() {
    if (this.diagnostics.state === "stopped") return;
    if (this.worker) {
      try { this.send({ type: "shutdown", ...this.commandLifecycle() }); }
      catch { /* Termination below remains authoritative. */ }
    }
    this.disposeWorker(); this.pending = null; this.pendingSize = null; this.inFlight = null;
    this.replayPages.clear(); this.sentResourceRevision = BigInt(0); this.artifact = null; this.replayOnReady = false;
    this.recoveryInFlight = false; this.initializingLifecycle = null;
    this.surfaceEpoch = BigInt(0);
    this.rejectReady(new Error("renderer service stopped"));
    this.diagnostics.state = "stopped";
    this.diagnostics.replacementSurfaceRequired = false;
    this.diagnostics.replayPages = 0;
    this.diagnostics.replayPressurePermille = 0;
    this.publishDiagnostics();
  }

  snapshot(): RustRendererDiagnosticsR11 { return Object.freeze({ ...this.diagnostics }); }

  /**
   * Lifecycle-only observer used by the visible-canvas shell. It intentionally
   * receives immutable snapshots and cannot influence renderer authority.
   */
  subscribe(listener: RustRendererDiagnosticsListenerR11) {
    this.diagnosticsListeners.add(listener);
    listener(this.snapshot());
    return () => { this.diagnosticsListeners.delete(listener); };
  }

  private handle(event: RustRendererWorkerEventR11) {
    try {
    if (event.type === "ready") {
      const expected = this.initializingLifecycle;
      if (!expected || event.surfaceGeneration !== expected.surfaceGeneration) { this.markStaleLifecycleEvent(); return; }
      if (event.epoch !== expected.epoch || event.recoveryGeneration !== expected.recoveryGeneration) {
        this.fail(`worker ready lifecycle mismatch: expected epoch ${expected.epoch} recovery ${expected.recoveryGeneration}, received epoch ${event.epoch} recovery ${event.recoveryGeneration}`);
        return;
      }
      this.initializingLifecycle = null;
      this.surfaceEpoch = event.epoch;
      this.surfaceRecoveryGeneration = event.recoveryGeneration;
      this.diagnostics.backend = event.backend;
      this.diagnostics.adapter = event.adapter;
      this.diagnostics.timestampQuerySupported = event.timestampQuerySupported;
      if (event.epoch !== this.diagnostics.epoch) {
        this.diagnostics.state = "recovering";
        if (!this.recoveryInFlight) {
          this.recoveryGeneration += 1;
          this.recoveryInFlight = true;
          this.diagnostics.recoveryGeneration = this.recoveryGeneration;
          this.diagnostics.deviceRecoveries += 1;
        }
        this.sendRecovery();
        return;
      }
      if (this.recoveryInFlight || this.recoveryGeneration !== event.recoveryGeneration) {
        this.diagnostics.state = "recovering";
        this.sendRecovery();
        return;
      }
      this.diagnostics.state = "ready";
      this.diagnostics.replacementSurfaceRequired = false;
      this.sendPendingSize(); this.sendUnsentResources(this.replayOnReady); this.replayOnReady = false;
      this.flush(); this.resolveReady();
    } else if (event.type === "frame-presented") {
      if (!this.isCurrentSurfaceEvent(event)) { this.markStaleLifecycleEvent(); return; }
      const inFlight = this.inFlight;
      if (!inFlight || event.sequence !== inFlight.sequence || event.epoch !== inFlight.epoch
        || event.surfaceGeneration !== inFlight.surfaceGeneration || event.recoveryGeneration !== inFlight.recoveryGeneration
        || this.diagnostics.state !== "ready") {
        this.markStaleLifecycleEvent();
        return;
      }
      this.inFlight = null; this.diagnostics.presentedFrames += 1; this.diagnostics.latestCpuMicros = event.cpuMicros;
      this.diagnostics.latestGpuMicros = event.gpuMicros; this.diagnostics.visibleInstances = event.visibleInstances;
      this.diagnostics.culledInstances = event.culledInstances; this.diagnostics.drawCalls = event.drawCalls;
      this.diagnostics.transparentDrawCalls = event.transparentDrawCalls;
      this.diagnostics.geometryBytes = event.geometryBytes;
      this.diagnostics.uploadedInstanceBytes = event.instanceBytes;
      this.diagnostics.residentInstanceBytes = event.residentInstanceBytes;
      this.diagnostics.instanceBufferReallocations = event.instanceBufferReallocations;
      this.diagnostics.lastPresentedSequence = event.sequence;
      this.diagnostics.latestSkipReason = event.skippedReason;
      if (event.skippedReason) this.diagnostics.skippedFrames += 1;
      this.flush();
    } else if (event.type === "device-lost") {
      if (event.surfaceGeneration !== this.surfaceGeneration || event.epoch !== this.surfaceEpoch) {
        this.markStaleLifecycleEvent();
        return;
      }
      if (this.recoveryInFlight) {
        this.diagnostics.coalescedRecoveryRequests += 1;
        return;
      }
      if (event.recoveryGeneration !== this.surfaceRecoveryGeneration) { this.markStaleLifecycleEvent(); return; }
      this.beginRecovery(event.reason, true);
    } else if (event.type === "replay-required") {
      if (!this.recoveryInFlight || event.surfaceGeneration !== this.surfaceGeneration
        || event.epoch !== this.diagnostics.epoch || event.recoveryGeneration !== this.recoveryGeneration) {
        this.markStaleLifecycleEvent();
        return;
      }
      this.surfaceEpoch = event.epoch;
      this.surfaceRecoveryGeneration = event.recoveryGeneration;
      this.recoveryInFlight = false;
      this.diagnostics.state = "ready";
      this.diagnostics.lastError = null;
      this.diagnostics.replacementSurfaceRequired = false;
      this.sentResourceRevision = BigInt(0);
      this.sendPendingSize();
      this.sendUnsentResources(true);
      this.replayOnReady = false;
      this.flush(); this.resolveReady();
    } else if (event.type === "error") {
      const initializationError = this.initializingLifecycle !== null
        && event.surfaceGeneration === this.initializingLifecycle.surfaceGeneration
        && event.epoch === this.initializingLifecycle.epoch
        && event.recoveryGeneration === this.initializingLifecycle.recoveryGeneration;
      const activeRecoveryError = this.recoveryInFlight
        && event.surfaceGeneration === this.surfaceGeneration
        && event.epoch === this.diagnostics.epoch
        && event.recoveryGeneration === this.recoveryGeneration;
      if (!initializationError && this.recoveryInFlight && !activeRecoveryError) { this.markStaleLifecycleEvent(); return; }
      if (!initializationError && !activeRecoveryError && !this.isCurrentSurfaceEvent(event)) { this.markStaleLifecycleEvent(); return; }
      this.fail(`${event.operation}: ${event.message}`);
    } else if (!this.isCurrentSurfaceEvent(event)) {
      this.markStaleLifecycleEvent();
    }
    } finally {
      this.publishDiagnostics();
    }
  }

  private flush() {
    if (this.inFlight || this.diagnostics.state !== "ready" || !this.pending) return;
    const next = this.pending; this.pending = null;
    if (next.epoch !== this.diagnostics.epoch) { this.diagnostics.staleFrames += 1; return; }
    this.sendFrame(next);
  }

  private sendPendingSize() {
    if (!this.pendingSize) return;
    const size = this.pendingSize;
    this.pendingSize = null;
    this.send({ type: "resize", ...size, ...this.commandLifecycle() });
  }

  private sendFrame(frame: FrameSubmissionR11) {
    const lifecycle = this.commandLifecycle();
    this.inFlight = Object.freeze({ sequence: frame.sequence, ...lifecycle });
    this.transfer({ type: "frame", bytes: frame.bytes.buffer as ArrayBuffer, sequence: frame.sequence, ...lifecycle }, frame.bytes);
  }

  private sendUnsentResources(replayed = false) {
    for (const [revision, page] of [...this.replayPages].sort(([left], [right]) => left < right ? -1 : 1)) {
      if (revision <= this.sentResourceRevision) continue;
      const copy = page.slice();
      if (replayed) this.diagnostics.replayedResourceBytes += copy.byteLength;
      this.transfer({ type: "resources", bytes: copy.buffer, ...this.commandLifecycle() }, copy);
      this.sentResourceRevision = revision;
    }
  }

  private transfer(command: RustRendererWorkerCommandR11, bytes: Uint8Array) {
    if (bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) {
      const copy = bytes.slice(); this.send({ ...command, bytes: copy.buffer } as RustRendererWorkerCommandR11, [copy.buffer]);
    } else this.send(command, [bytes.buffer as ArrayBuffer]);
  }

  private send(command: RustRendererWorkerCommandR11, transfer: Transferable[] = []) {
    if (!this.worker) throw new Error("renderer service is not started");
    this.worker.postMessage(command, transfer);
  }

  private startWorker(canvas: OffscreenCanvas, width: number, height: number) {
    if (!this.artifact) throw new Error("renderer artifact is not installed");
    const worker = this.createWorker();
    const generation = ++this.surfaceGeneration;
    const lifecycle = Object.freeze({
      epoch: this.diagnostics.epoch,
      surfaceGeneration: generation,
      recoveryGeneration: this.recoveryGeneration,
    });
    this.initializingLifecycle = lifecycle;
    this.diagnostics.surfaceGeneration = generation;
    this.diagnostics.recoveryGeneration = this.recoveryGeneration;
    this.worker = worker;
    worker.onmessage = (event) => { if (this.worker === worker && generation === this.surfaceGeneration) this.handle(event.data); };
    worker.onerror = (event) => {
      if (this.worker !== worker || generation !== this.surfaceGeneration) return;
      this.fail(`worker: ${event.message || "renderer worker crashed"}`);
    };
    this.send({ type: "initialize", canvas, width, height, moduleUrl: this.artifact.moduleUrl, wasmUrl: this.artifact.wasmUrl, ...lifecycle }, [canvas]);
  }

  private disposeWorker() {
    if (!this.worker) return;
    this.worker.onmessage = null;
    if ("onerror" in this.worker) this.worker.onerror = null;
    this.worker.terminate();
    this.worker = null;
  }

  private fail(message: string) {
    this.inFlight = null;
    this.pending = null;
    this.recoveryInFlight = false;
    this.diagnostics.state = "failed";
    this.diagnostics.lastError = message;
    this.diagnostics.lastPresentedSequence = null;
    this.diagnostics.latestSkipReason = null;
    this.diagnostics.replacementSurfaceRequired = true;
    this.rejectReady(new Error(message));
    this.publishDiagnostics();
  }

  private beginRecovery(reason: string, sendImmediately: boolean) {
    this.inFlight = null;
    this.recoveryGeneration += 1;
    this.recoveryInFlight = true;
    this.diagnostics.recoveryGeneration = this.recoveryGeneration;
    this.diagnostics.state = sendImmediately ? "recovering" : "starting";
    this.diagnostics.lastError = reason;
    this.diagnostics.lastPresentedSequence = null;
    this.diagnostics.latestSkipReason = null;
    this.diagnostics.deviceRecoveries += 1;
    this.publishDiagnostics();
    if (sendImmediately) this.sendRecovery();
    return true;
  }

  private sendRecovery() {
    this.send({ type: "recover", ...this.commandLifecycle() });
  }

  private commandLifecycle(): RustRendererLifecycleR11 {
    return Object.freeze({
      epoch: this.diagnostics.epoch,
      surfaceGeneration: this.surfaceGeneration,
      recoveryGeneration: this.recoveryGeneration,
    });
  }

  private isCurrentSurfaceEvent(event: RustRendererLifecycleR11) {
    return event.epoch === this.surfaceEpoch
      && event.surfaceGeneration === this.surfaceGeneration
      && event.recoveryGeneration === this.surfaceRecoveryGeneration;
  }

  private markStaleLifecycleEvent() {
    this.diagnostics.staleLifecycleEvents += 1;
  }

  private updateReplayPressure() {
    this.diagnostics.replayPages = this.replayPages.size;
    const bytePressure = Math.floor(this.diagnostics.resourceBytes * 1_000 / this.replayLimits.maxBytes);
    const pagePressure = Math.floor(this.replayPages.size * 1_000 / this.replayLimits.maxPages);
    this.diagnostics.replayPressurePermille = Math.max(bytePressure, pagePressure);
  }

  private publishDiagnostics() {
    if (this.diagnosticsListeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.diagnosticsListeners) {
      try { listener(snapshot); }
      catch { /* Diagnostics observers cannot break renderer lifecycle. */ }
    }
  }

  private createReadyDeferred(): ReadyDeferredR11 {
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const deferred: ReadyDeferredR11 = {
      promise: new Promise<void>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; }),
      resolve: () => { if (!deferred.settled) { deferred.settled = true; resolvePromise(); } },
      reject: (error) => { if (!deferred.settled) { deferred.settled = true; rejectPromise(error); } },
      settled: false,
    };
    // Direct service users may rely only on diagnostics. Mark the promise as
    // observed while preserving rejection for callers that await ready().
    void deferred.promise.catch(() => undefined);
    return deferred;
  }

  private resolveReady() { this.readyDeferred?.resolve(); }
  private rejectReady(error: Error) { this.readyDeferred?.reject(error); }

  private errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : error == null ? fallback : String(error);
  }
}

export function supportsRustRendererWorkerR11(canvas: HTMLCanvasElement) {
  return typeof Worker !== "undefined" && typeof canvas.transferControlToOffscreen === "function" && typeof navigator !== "undefined" && "gpu" in navigator;
}
