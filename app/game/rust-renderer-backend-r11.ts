import type { RenderFrameV2, RenderResourceBatchV2 } from "./rust-render-extraction-v2.ts";
import type {
  RenderSceneExtractionSinkR10,
  RustRenderSceneComposerR10,
  RustRenderSceneComposerOptionsR10,
} from "./rust-render-scene-composer-r10.ts";
import {
  RustRendererServiceR11,
  supportsRustRendererWorkerR11,
  type RustRendererArtifactR11,
  type RustRendererDiagnosticsListenerR11,
} from "./rust-renderer-service-r11.ts";

export type RendererBackendR11 = Readonly<{
  kind: "rust-webgpu";
  /** Resolves only after the dedicated worker reports a live WebGPU surface. */
  ready?: () => Promise<void>;
  resources(batch: RenderResourceBatchV2 | Uint8Array): void;
  frame(frame: RenderFrameV2 | Uint8Array): boolean;
  resize(width: number, height: number): void;
  requestRecovery(reason?: string): void;
  switchEpoch(epoch: bigint): void;
  restartSurface?(canvas: OffscreenCanvas, width: number, height: number): Promise<void>;
  subscribe?(listener: RustRendererDiagnosticsListenerR11): () => void;
  dispose(): void;
  diagnostics(): ReturnType<RustRendererServiceR11["snapshot"]>;
}>;

export type RustRendererCapabilityR11 =
  | Readonly<{ supported: true }>
  | Readonly<{ supported: false; reason: "worker-unavailable" | "offscreen-canvas-unavailable" | "webgpu-unavailable" }>;

export function detectRustRendererCapabilityR11(canvas: Pick<HTMLCanvasElement, "transferControlToOffscreen">): RustRendererCapabilityR11 {
  if (typeof Worker === "undefined") return Object.freeze({ supported: false, reason: "worker-unavailable" });
  if (typeof canvas.transferControlToOffscreen !== "function") return Object.freeze({ supported: false, reason: "offscreen-canvas-unavailable" });
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return Object.freeze({ supported: false, reason: "webgpu-unavailable" });
  return Object.freeze({ supported: true });
}

/**
 * Explicit feature-gated production backend. The caller extracts renderer V2
 * DTOs directly from authoritative stores; this adapter never walks Three
 * objects and never reads individual voxels.
 */
export function createRustRendererBackendR11(options: Readonly<{
  canvas: HTMLCanvasElement;
  artifact: RustRendererArtifactR11;
  epoch: bigint;
  width: number;
  height: number;
  service?: RustRendererServiceR11;
}>): RendererBackendR11 | null {
  if (!detectRustRendererCapabilityR11(options.canvas).supported || !supportsRustRendererWorkerR11(options.canvas)) return null;
  const service = options.service ?? new RustRendererServiceR11();
  service.start(options.canvas.transferControlToOffscreen(), options.artifact, options.epoch, options.width, options.height);
  return Object.freeze({
    kind: "rust-webgpu" as const,
    ready: () => service.ready(),
    resources: (batch: RenderResourceBatchV2 | Uint8Array) => service.applyResources(batch),
    frame: (frame: RenderFrameV2 | Uint8Array) => service.present(frame),
    resize: (width: number, height: number) => service.resize(width, height),
    requestRecovery: (reason?: string) => service.requestRecovery(reason),
    switchEpoch: (epoch: bigint) => service.switchEpoch(epoch),
    restartSurface: async (canvas: OffscreenCanvas, width: number, height: number) => {
      service.restartSurface(canvas, width, height);
      await service.ready();
    },
    subscribe: (listener: RustRendererDiagnosticsListenerR11) => service.subscribe(listener),
    dispose: () => service.stop(),
    diagnostics: () => service.snapshot(),
  });
}

export type RustRendererComposedRuntimeR10 = Readonly<{
  backend: RendererBackendR11;
  composer: RustRenderSceneComposerR10;
  terrain: RenderSceneExtractionSinkR10;
}>;

/**
 * Constructs the renderer-neutral global scene stage above the worker backend.
 * Live engine ownership is deliberately left to the caller: terrain may be
 * connected immediately, while BWR6 entity snapshots remain an explicit
 * separately scheduled input until the authoritative runtime cutover.
 */
export async function createRustRendererComposedRuntimeR10(options: Readonly<{
  backend: RendererBackendR11;
  composer: Omit<RustRenderSceneComposerOptionsR10, "sink">;
}>): Promise<RustRendererComposedRuntimeR10> {
  const { RustRenderSceneComposerR10, rustRenderTerrainSinkR10 } = await import("./rust-render-scene-composer-r10.ts");
  const sink = Object.freeze({
    resources: (batch: RenderResourceBatchV2) => {
      options.backend.resources(batch);
      return options.backend.diagnostics().state !== "failed";
    },
    frame: (frame: RenderFrameV2) => options.backend.frame(frame),
    resize: (width: number, height: number) => options.backend.resize(width, height),
    requestRecovery: (reason?: string) => {
      options.backend.requestRecovery(reason);
      return options.backend.diagnostics().state !== "failed";
    },
    diagnostics: () => options.backend.diagnostics(),
  });
  const composer = new RustRenderSceneComposerR10({ ...options.composer, sink });
  return Object.freeze({ backend: options.backend, composer, terrain: rustRenderTerrainSinkR10(composer) });
}
