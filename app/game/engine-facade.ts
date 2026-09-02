import { RustEngineService, type RustEngineServiceState } from "./rust-engine-service";

export type EngineBackendSelection =
  | "typescript"
  | "rust-shadow"
  | "rust-authoritative-typescript-shadow"
  | "rust";

export type RendererBackendSelection = "three" | "wgpu-shadow" | "wgpu";

export type EngineAuthorityMode =
  | "typescript-authoritative"
  | "rust-shadow"
  | "rust-authoritative-typescript-shadow"
  | "rust-authoritative"
  | "retired-typescript";

export type EngineStepRequest = Readonly<{
  monotonicTimeUs: number;
  budgetUs: number;
}>;

export type EngineStepResult = Readonly<{
  events: Uint8Array;
  stateHash: string | null;
  tick?: number;
}>;

export interface EngineBackend {
  readonly name: "typescript" | "rust";
  start(): Promise<void>;
  ingest(batch: Uint8Array): Promise<void>;
  step(request: EngineStepRequest): Promise<EngineStepResult>;
  shutdown(): Promise<void>;
  diagnostics(): Readonly<Record<string, unknown>>;
}

export type TypeScriptEngineAdapter = Readonly<{
  start?: () => void | Promise<void>;
  ingest: (batch: Uint8Array) => void | Promise<void>;
  step: (request: EngineStepRequest) => EngineStepResult | Promise<EngineStepResult>;
  shutdown?: () => void | Promise<void>;
  diagnostics?: () => Readonly<Record<string, unknown>>;
}>;

export class TypeScriptEngineBackend implements EngineBackend {
  readonly name = "typescript" as const;

  constructor(private readonly adapter: TypeScriptEngineAdapter) {}

  async start() { await this.adapter.start?.(); }
  async ingest(batch: Uint8Array) { await this.adapter.ingest(batch); }
  async step(request: EngineStepRequest) { return this.adapter.step(request); }
  async shutdown() { await this.adapter.shutdown?.(); }
  diagnostics() { return this.adapter.diagnostics?.() ?? {}; }
}

export class RustWorkerEngineBackend implements EngineBackend {
  readonly name = "rust" as const;

  constructor(readonly service: RustEngineService) {}

  async start() { await this.service.start(); }

  async ingest(batch: Uint8Array) {
    const response = await this.service.ingest(batch);
    response.release();
  }

  async step(request: EngineStepRequest): Promise<EngineStepResult> {
    const stepResponse = await this.service.step(request.monotonicTimeUs, request.budgetUs);
    const stepSummary = stepResponse.copyPayload();
    stepResponse.release();
    const eventResponse = await this.service.takeEvents();
    const events = eventResponse.copyPayload();
    eventResponse.release();
    let tick: number | undefined;
    let stateHash: string | null = null;
    if (stepSummary.byteLength >= 32) {
      const view = new DataView(stepSummary.buffer, stepSummary.byteOffset, stepSummary.byteLength);
      const rawTick = view.getBigUint64(0, true);
      if (rawTick <= BigInt(Number.MAX_SAFE_INTEGER)) tick = Number(rawTick);
      stateHash = [...stepSummary.subarray(16, 32)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } else {
      const hashResponse = await this.service.stateHash();
      const hashBytes = hashResponse.copyPayload();
      hashResponse.release();
      if (hashBytes.byteLength === 16) stateHash = [...hashBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return { events, stateHash, tick };
  }

  async shutdown() { await this.service.shutdown(); }
  diagnostics() { return this.service.diagnostics(); }
}

export type EngineFacadePolicy = Readonly<{
  /** R0 deliberately keeps this false; Rust authority is promoted by later phase gates. */
  allowRustAuthority?: boolean;
  /** Shadow execution is inert unless a caller explicitly opens this diagnostic policy. */
  allowRustShadow?: boolean;
  /** wgpu extraction is likewise opt-in; selecting a backend alone is insufficient. */
  allowWgpuShadow?: boolean;
  allowWgpuPrimary?: boolean;
  webGpuAvailable?: boolean;
}>;

export type ResolvedEngineSelection = Readonly<{
  requested: EngineBackendSelection;
  effective: EngineBackendSelection;
  authorityMode: EngineAuthorityMode;
  fallbackReason: string | null;
}>;

export type ResolvedRendererSelection = Readonly<{
  requested: RendererBackendSelection;
  effective: RendererBackendSelection;
  fallbackReason: string | null;
}>;

export function resolveEngineSelection(
  requested: EngineBackendSelection,
  options: Readonly<{ rustAvailable: boolean; allowRustShadow: boolean; allowRustAuthority: boolean }>,
): ResolvedEngineSelection {
  if (requested === "typescript") {
    return { requested, effective: "typescript", authorityMode: "typescript-authoritative", fallbackReason: null };
  }
  if (requested === "rust-shadow") {
    if (!options.allowRustShadow) {
      return { requested, effective: "typescript", authorityMode: "typescript-authoritative", fallbackReason: "Rust shadow execution is disabled by policy" };
    }
    if (!options.rustAvailable) {
      return { requested, effective: "typescript", authorityMode: "typescript-authoritative", fallbackReason: "Rust worker or artifact is unavailable" };
    }
    return { requested, effective: requested, authorityMode: "rust-shadow", fallbackReason: null };
  }
  if (!options.allowRustAuthority) {
    return { requested, effective: "typescript", authorityMode: "typescript-authoritative", fallbackReason: "R0 policy keeps TypeScript authoritative until Rust promotion gates pass" };
  }
  if (!options.rustAvailable) {
    return { requested, effective: "typescript", authorityMode: "typescript-authoritative", fallbackReason: "Rust worker or artifact is unavailable" };
  }
  return {
    requested,
    effective: requested,
    authorityMode: requested === "rust" ? "rust-authoritative" : "rust-authoritative-typescript-shadow",
    fallbackReason: null,
  };
}

export function resolveRendererSelection(
  requested: RendererBackendSelection,
  options: Readonly<{ webGpuAvailable: boolean; allowWgpuShadow: boolean; allowWgpuPrimary: boolean }>,
): ResolvedRendererSelection {
  if (requested === "three") return { requested, effective: "three", fallbackReason: null };
  if (!options.webGpuAvailable) return { requested, effective: "three", fallbackReason: "WebGPU is unavailable" };
  if (requested === "wgpu-shadow") {
    return options.allowWgpuShadow
      ? { requested, effective: requested, fallbackReason: null }
      : { requested, effective: "three", fallbackReason: "wgpu shadow rendering is disabled by policy" };
  }
  return options.allowWgpuPrimary
    ? { requested, effective: requested, fallbackReason: null }
    : { requested, effective: "three", fallbackReason: "R0 policy keeps Three.js primary until wgpu promotion gates pass" };
}

type Divergence = Readonly<{
  at: number;
  type: "state-hash" | "shadow-failure";
  typescriptHash: string | null;
  rustHash: string | null;
  message: string;
}>;

export type EngineFacadeOptions = Readonly<{
  typescript: EngineBackend;
  rust?: EngineBackend;
  engineSelection?: EngineBackendSelection;
  rendererSelection?: RendererBackendSelection;
  policy?: EngineFacadePolicy;
  now?: () => number;
  maximumDivergences?: number;
}>;

/**
 * Strangler facade for R0. It is intentionally not wired into VoxelGame yet:
 * consumers opt in one domain at a time while TypeScript remains authoritative.
 */
export class EngineFacade {
  private readonly typescript: EngineBackend;
  private readonly rust: EngineBackend | null;
  private readonly policy: Required<EngineFacadePolicy>;
  private readonly now: () => number;
  private readonly maximumDivergences: number;
  private requestedEngine: EngineBackendSelection;
  private requestedRenderer: RendererBackendSelection;
  private engineResolution: ResolvedEngineSelection;
  private rendererResolution: ResolvedRendererSelection;
  private divergences: Divergence[] = [];
  private started = false;
  private rustStartError: string | null = null;

  constructor(options: EngineFacadeOptions) {
    this.typescript = options.typescript;
    this.rust = options.rust ?? null;
    this.requestedEngine = options.engineSelection ?? "typescript";
    this.requestedRenderer = options.rendererSelection ?? "three";
    this.policy = {
      allowRustAuthority: options.policy?.allowRustAuthority ?? false,
      allowRustShadow: options.policy?.allowRustShadow ?? false,
      allowWgpuShadow: options.policy?.allowWgpuShadow ?? false,
      allowWgpuPrimary: options.policy?.allowWgpuPrimary ?? false,
      webGpuAvailable: options.policy?.webGpuAvailable ?? (typeof navigator !== "undefined" && "gpu" in navigator),
    };
    this.now = options.now ?? Date.now;
    this.maximumDivergences = Math.max(1, options.maximumDivergences ?? 32);
    this.engineResolution = resolveEngineSelection(this.requestedEngine, {
      rustAvailable: Boolean(this.rust),
      allowRustShadow: this.policy.allowRustShadow,
      allowRustAuthority: this.policy.allowRustAuthority,
    });
    this.rendererResolution = resolveRendererSelection(this.requestedRenderer, this.policy);
  }

  async start() {
    if (this.started) return;
    await this.typescript.start();
    if (this.engineResolution.effective !== "typescript" && this.rust) {
      try {
        await this.rust.start();
      } catch (error) {
        this.rustStartError = error instanceof Error ? error.message : String(error);
        this.engineResolution = resolveEngineSelection(this.requestedEngine, {
          rustAvailable: false,
          allowRustShadow: this.policy.allowRustShadow,
          allowRustAuthority: this.policy.allowRustAuthority,
        });
      }
    }
    this.started = true;
  }

  setRendererSelection(selection: RendererBackendSelection) {
    this.requestedRenderer = selection;
    this.rendererResolution = resolveRendererSelection(selection, this.policy);
    return this.rendererResolution;
  }

  async ingest(batch: Uint8Array) {
    await this.ensureStarted();
    const mode = this.engineResolution.effective;
    if (mode === "typescript") return this.typescript.ingest(batch);
    if (!this.rust) return this.typescript.ingest(batch);
    if (mode === "rust-shadow") {
      await this.typescript.ingest(batch);
      try { await this.rust.ingest(batch); }
      catch (error) { this.recordShadowFailure(error); }
      return;
    }
    if (mode === "rust-authoritative-typescript-shadow") {
      await this.rust.ingest(batch);
      try { await this.typescript.ingest(batch); }
      catch (error) { this.recordShadowFailure(error); }
      return;
    }
    await this.rust.ingest(batch);
  }

  async step(request: EngineStepRequest) {
    await this.ensureStarted();
    const mode = this.engineResolution.effective;
    if (mode === "typescript" || !this.rust) return this.typescript.step(request);
    if (mode === "rust-shadow") {
      const authoritative = await this.typescript.step(request);
      try {
        const shadow = await this.rust.step(request);
        this.compareHashes(authoritative, shadow);
      } catch (error) {
        this.recordShadowFailure(error);
      }
      return authoritative;
    }
    if (mode === "rust-authoritative-typescript-shadow") {
      const authoritative = await this.rust.step(request);
      try {
        const shadow = await this.typescript.step(request);
        this.compareHashes(shadow, authoritative);
      } catch (error) {
        this.recordShadowFailure(error);
      }
      return authoritative;
    }
    return this.rust.step(request);
  }

  private compareHashes(typescript: EngineStepResult, rust: EngineStepResult) {
    if (!typescript.stateHash || !rust.stateHash || typescript.stateHash === rust.stateHash) return;
    this.recordDivergence({
      at: this.now(),
      type: "state-hash",
      typescriptHash: typescript.stateHash,
      rustHash: rust.stateHash,
      message: `State hash diverged: TypeScript ${typescript.stateHash}, Rust ${rust.stateHash}`,
    });
  }

  private recordShadowFailure(error: unknown) {
    this.recordDivergence({
      at: this.now(),
      type: "shadow-failure",
      typescriptHash: null,
      rustHash: null,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private recordDivergence(divergence: Divergence) {
    this.divergences.push(divergence);
    if (this.divergences.length > this.maximumDivergences) this.divergences.splice(0, this.divergences.length - this.maximumDivergences);
  }

  private async ensureStarted() {
    if (!this.started) await this.start();
  }

  async shutdown() {
    const shutdowns: Promise<void>[] = [this.typescript.shutdown()];
    if (this.rust) shutdowns.push(this.rust.shutdown());
    await Promise.allSettled(shutdowns);
    this.started = false;
  }

  diagnostics() {
    return {
      started: this.started,
      engine: this.engineResolution,
      renderer: this.rendererResolution,
      rustStartError: this.rustStartError,
      divergences: [...this.divergences],
      typescript: this.typescript.diagnostics(),
      rust: this.rust?.diagnostics() ?? null,
    } as const;
  }
}

export function rustServiceStateFromBackend(backend: EngineBackend | null): RustEngineServiceState | null {
  return backend instanceof RustWorkerEngineBackend ? backend.service.lifecycleState : null;
}
