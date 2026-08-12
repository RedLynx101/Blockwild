/// <reference lib="webworker" />

/** Dedicated renderer worker. It never imports Three.js or authoritative game state. */

export type RustRendererLifecycleR11 = Readonly<{
  epoch: bigint;
  surfaceGeneration: number;
  recoveryGeneration: number;
}>;

export type RustRendererWorkerCommandR11 =
  | Readonly<{ type: "initialize"; canvas: OffscreenCanvas; width: number; height: number; moduleUrl: string; wasmUrl: string } & RustRendererLifecycleR11>
  | Readonly<{ type: "resources"; bytes: ArrayBuffer } & RustRendererLifecycleR11>
  | Readonly<{ type: "frame"; bytes: ArrayBuffer; sequence: bigint } & RustRendererLifecycleR11>
  | Readonly<{ type: "resize"; width: number; height: number } & RustRendererLifecycleR11>
  | Readonly<{ type: "recover" } & RustRendererLifecycleR11>
  | Readonly<{ type: "shutdown" } & RustRendererLifecycleR11>;

export type RustRendererWorkerEventR11 =
  | Readonly<{ type: "ready"; backend: string; adapter: string; timestampQuerySupported: boolean } & RustRendererLifecycleR11>
  | Readonly<{ type: "resource-applied"; revision: bigint; bytes: number } & RustRendererLifecycleR11>
  | Readonly<{ type: "frame-presented"; sequence: bigint; cpuMicros: number; gpuMicros: number | null; visibleInstances: number; culledInstances: number; drawCalls: number; transparentDrawCalls: number; geometryBytes: number; instanceBytes: number; residentInstanceBytes: number; instanceBufferReallocations: number; skippedReason: string | null; bytes: number } & RustRendererLifecycleR11>
  | Readonly<{ type: "replay-required"; reason: string } & RustRendererLifecycleR11>
  | Readonly<{ type: "device-lost"; reason: string } & RustRendererLifecycleR11>
  | Readonly<{ type: "error"; operation: string; message: string } & RustRendererLifecycleR11>;

type RustSurfaceR11 = {
  capabilities(): string | Record<string, unknown>;
  apply_resources(bytes: Uint8Array): string | Record<string, unknown>;
  render_frame(bytes: Uint8Array): string | Record<string, unknown>;
  resize(width: number, height: number): void;
  recover?(): Promise<string | Record<string, unknown>>;
  shutdown?(): void;
};

type RustRendererNamespaceR11 = {
  default(options?: unknown): Promise<unknown>;
  create_blockwild_renderer(canvas: OffscreenCanvas, width: number, height: number): Promise<RustSurfaceR11>;
};

const scope = self as unknown as DedicatedWorkerGlobalScope;
let surface: RustSurfaceR11 | null = null;
let epoch = BigInt(0);
let surfaceGeneration = 0;
let recoveryGeneration = 0;
let stopped = false;

function message(value: RustRendererWorkerEventR11) {
  if (!stopped) scope.postMessage(value);
}

function detail(value: string | Record<string, unknown>) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as Record<string, unknown>; }
  catch { return { message: value }; }
}

function numberField(value: Record<string, unknown>, key: string, fallback = 0) {
  return typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : fallback;
}

async function initialize(command: Extract<RustRendererWorkerCommandR11, { type: "initialize" }>) {
  if (surface) throw new Error("renderer worker is already initialized");
  const gpu = (scope.navigator as WorkerNavigator & {
    gpu?: { requestAdapter(options?: { powerPreference?: string; forceFallbackAdapter?: boolean }): Promise<unknown | null> };
  }).gpu;
  if (!gpu) throw new Error("WebGPU is unavailable in this dedicated worker");
  // wgpu's browser backend assumes requestAdapter produced a real adapter;
  // probe first so an unavailable/blocked GPU becomes an explicit capability
  // fallback instead of a null-handle exception inside generated Wasm glue.
  const adapterProbe = await gpu.requestAdapter({ powerPreference: "high-performance" })
    ?? await gpu.requestAdapter({ powerPreference: "low-power" })
    ?? await gpu.requestAdapter({ forceFallbackAdapter: true });
  if (!adapterProbe) throw new Error("WebGPU did not provide a hardware or fallback adapter");
  // Vite deliberately rejects source-level imports from /public. Fetching the
  // already-published, content-addressed glue as a module blob keeps it outside
  // bundler transforms in both Vite and Next while retaining native ESM.
  const response = await fetch(command.moduleUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`renderer module returned HTTP ${response.status}`);
  const moduleUrl = URL.createObjectURL(new Blob([await response.text()], { type: "text/javascript" }));
  let namespace: RustRendererNamespaceR11;
  try {
    namespace = await import(/* @vite-ignore */ /* webpackIgnore: true */ moduleUrl) as RustRendererNamespaceR11;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  if (typeof namespace.default !== "function" || typeof namespace.create_blockwild_renderer !== "function") {
    throw new TypeError("renderer artifact does not expose its initializer and surface factory");
  }
  await namespace.default({ module_or_path: command.wasmUrl });
  surface = await namespace.create_blockwild_renderer(command.canvas, command.width, command.height);
  epoch = command.epoch;
  surfaceGeneration = command.surfaceGeneration;
  recoveryGeneration = command.recoveryGeneration;
  const capabilities = detail(surface.capabilities());
  message({
    type: "ready",
    backend: typeof capabilities.backend === "string" ? capabilities.backend : "WebGPU",
    adapter: typeof capabilities.adapter === "string" ? capabilities.adapter : "browser-webgpu",
    timestampQuerySupported: capabilities.timestampQuerySupported === true,
    epoch,
    surfaceGeneration,
    recoveryGeneration,
  });
}

function commandLifecycle(command: RustRendererWorkerCommandR11): RustRendererLifecycleR11 {
  return {
    epoch: command.epoch,
    surfaceGeneration: command.surfaceGeneration,
    recoveryGeneration: command.recoveryGeneration,
  };
}

function isCurrent(command: Exclude<RustRendererWorkerCommandR11, { type: "initialize" | "shutdown" }>) {
  return command.epoch === epoch
    && command.surfaceGeneration === surfaceGeneration
    && command.recoveryGeneration === recoveryGeneration;
}

async function execute(command: RustRendererWorkerCommandR11) {
  try {
    if (command.type === "initialize") { await initialize(command); return; }
    if (command.type === "shutdown") {
      stopped = true;
      surface?.shutdown?.();
      surface = null;
      scope.close();
      return;
    }
    if (!surface) throw new Error("renderer worker is not initialized");
    if (command.surfaceGeneration !== surfaceGeneration) return;
    if (command.type === "recover") {
      if (command.recoveryGeneration <= recoveryGeneration && command.epoch === epoch) return;
      if (typeof surface.recover !== "function") throw new Error("renderer artifact cannot recover its device");
      await surface.recover();
      epoch = command.epoch;
      recoveryGeneration = command.recoveryGeneration;
      message({ type: "replay-required", reason: "WebGPU device recreated", ...commandLifecycle(command) });
      return;
    }
    if (!isCurrent(command)) return;
    if (command.type === "resources") {
      const report = detail(surface.apply_resources(new Uint8Array(command.bytes)));
      message({
        type: "resource-applied",
        revision: BigInt(String(report.revision ?? 0)),
        bytes: command.bytes.byteLength,
        ...commandLifecycle(command),
      });
    } else if (command.type === "frame") {
      const report = detail(surface.render_frame(new Uint8Array(command.bytes)));
      message({
        type: "frame-presented",
        sequence: command.sequence,
        cpuMicros: numberField(report, "cpuMicros"),
        gpuMicros: typeof report.gpuMicros === "number" ? report.gpuMicros : null,
        visibleInstances: numberField(report, "visibleInstances"),
        culledInstances: numberField(report, "culledInstances"),
        drawCalls: numberField(report, "drawCalls"),
        transparentDrawCalls: numberField(report, "transparentDrawCalls"),
        geometryBytes: numberField(report, "geometryBytes"),
        instanceBytes: numberField(report, "instanceBytes"),
        residentInstanceBytes: numberField(report, "residentInstanceBytes"),
        instanceBufferReallocations: numberField(report, "instanceBufferReallocations"),
        skippedReason: typeof report.skipped === "string" ? report.skipped : null,
        bytes: command.bytes.byteLength,
        ...commandLifecycle(command),
      });
    } else if (command.type === "resize") {
      surface.resize(command.width, command.height);
    }
  } catch (error) {
    const operation = command.type;
    const value = error instanceof Error ? error.message : String(error);
    const lifecycle = commandLifecycle(command);
    if (operation !== "initialize" && operation !== "recover" && /device.?lost/i.test(value)) message({ type: "device-lost", reason: value, ...lifecycle });
    else message({ type: "error", operation, message: value, ...lifecycle });
  }
}

// Every command is processed in postMessage order. In particular, recovery
// cannot overtake a resource upload or allow a later frame to touch the old
// surface while an asynchronous device recreation is still running.
let commandQueue = Promise.resolve();
scope.onmessage = (event: MessageEvent<RustRendererWorkerCommandR11>) => {
  const command = event.data;
  commandQueue = commandQueue.then(() => execute(command));
};

export {};
