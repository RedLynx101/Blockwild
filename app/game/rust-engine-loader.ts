import {
  RUST_ENGINE_PROTOCOL_VERSION,
  RUST_ENGINE_SCHEMA_VERSION,
} from "./rust-engine-protocol";
import { RustEngineCodeCache, snapshotPreparedRustCode, type PreparedRustEngineCode, type RustEngineCodeFetcher } from "./rust-engine-code-cache";

export type RustEngineBytes = Uint8Array | ArrayBuffer;

export interface RustEngineWasmExports {
  blockwild_protocol_version(): number;
  blockwild_schema_version(): number;
  blockwild_engine_create(configEnvelope: Uint8Array): RustEngineBytes;
  blockwild_engine_ingest(handle: number, batch: Uint8Array): RustEngineBytes;
  blockwild_engine_step(handle: number, monotonicTimeUs: number, budgetUs: number): RustEngineBytes;
  blockwild_engine_take_events(handle: number): RustEngineBytes;
  blockwild_engine_state_hash(handle: number): RustEngineBytes;
  blockwild_engine_destroy(handle: number): RustEngineBytes;
  /** Certified pure generator queries required by Rust worldgen authority. */
  blockwild_generate_chunk_v2?(request: Uint8Array): RustEngineBytes;
  blockwild_query_settlements_v1?(request: Uint8Array): RustEngineBytes;
  blockwild_query_dragon_lair_v1?(request: Uint8Array): RustEngineBytes;
  blockwild_generation_parity_certificate_v2?(): RustEngineBytes;
  blockwild_locator_parity_certificate_v1?(): RustEngineBytes;
  /** Coarse R2 whole-section kernels. Older artifacts may omit them. */
  blockwild_world_mesh_section_v1?(snapshot: Uint8Array, registry: Uint8Array): RustEngineBytes;
  blockwild_world_light_section_v1?(snapshot: Uint8Array, registry: Uint8Array, directSkyAbove: Uint8Array): RustEngineBytes;
  /** Coarse R4 world-authority lifecycle. Older rollback artifacts omit it. */
  blockwild_world_authority_create_r4?(request: Uint8Array): RustEngineBytes;
  blockwild_world_authority_request_r4?(handle: number, request: Uint8Array): RustEngineBytes;
  blockwild_world_authority_destroy_r4?(handle: number, request: Uint8Array): RustEngineBytes;
}

export type RustTerrainWasmExports = RustEngineWasmExports & Required<Pick<
  RustEngineWasmExports,
  "blockwild_world_mesh_section_v1" | "blockwild_world_light_section_v1"
>>;

export function assertRustTerrainWasmExports(exports: RustEngineWasmExports): asserts exports is RustTerrainWasmExports {
  for (const name of ["blockwild_world_mesh_section_v1", "blockwild_world_light_section_v1"] as const) {
    if (typeof exports[name] !== "function") {
      throw new RustEngineLoadError("invalid-module", `Rust engine artifact is missing export ${name}`);
    }
  }
}

export type RustWorldAuthorityWasmExportsR4V1 = RustEngineWasmExports & Required<Pick<
  RustEngineWasmExports,
  "blockwild_world_authority_create_r4" | "blockwild_world_authority_request_r4" | "blockwild_world_authority_destroy_r4"
>>;

export function assertRustWorldAuthorityWasmExportsR4V1(
  exports: RustEngineWasmExports,
): asserts exports is RustWorldAuthorityWasmExportsR4V1 {
  for (const name of [
    "blockwild_world_authority_create_r4",
    "blockwild_world_authority_request_r4",
    "blockwild_world_authority_destroy_r4",
  ] as const) {
    if (typeof exports[name] !== "function") {
      throw new RustEngineLoadError("invalid-module", `Rust engine artifact is missing export ${name}`);
    }
  }
}

export type RustEngineArtifact = Readonly<{
  moduleUrl?: string;
  wasmUrl?: string;
  /** Mutable selector for immutable, content-addressed browser artifacts. */
  indexUrl?: string;
  variant?: string;
  buildKind: "compatibility" | "accelerated";
  buildHash?: string;
}>;

export type ResolvedRustEngineArtifact = RustEngineArtifact & Readonly<{
  moduleUrl: string;
  wasmUrl: string;
  buildHash: string;
}>;

export const DEFAULT_RUST_ENGINE_ARTIFACT: RustEngineArtifact = {
  indexUrl: "/engine/manifest.json",
  variant: "compatibility",
  buildKind: "compatibility",
};

export type RustEngineLoadErrorCode =
  | "artifact-unavailable"
  | "initialization-failed"
  | "invalid-module"
  | "protocol-mismatch"
  | "schema-mismatch";

export class RustEngineLoadError extends Error {
  readonly name = "RustEngineLoadError";

  constructor(
    readonly code: RustEngineLoadErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export type LoadedRustEngine = Readonly<{
  exports: RustEngineWasmExports;
  artifact: ResolvedRustEngineArtifact;
  protocolVersion: number;
  schemaVersion: number;
  loadDurationMs: number;
}>;

export type RustEngineModuleImporter = (artifact: ResolvedRustEngineArtifact, verifiedGlue?: Uint8Array) => Promise<unknown>;
export type RustEngineManifestFetcher = (url: string) => Promise<Readonly<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>>;

export type RustEngineLoaderOptions = Readonly<{
  artifact?: RustEngineArtifact;
  importer?: RustEngineModuleImporter;
  fetcher?: RustEngineManifestFetcher;
  now?: () => number;
  protocolVersion?: number;
  schemaVersion?: number;
  /** Parent-verified immutable code only; each loader still imports/initializes its own namespace and instance. */
  preparedCode?: PreparedRustEngineCode;
  codeFetcher?: RustEngineCodeFetcher;
}>;

export type RustEngineLoaderDiagnostics = Readonly<{
  state: "idle" | "loading" | "ready" | "failed";
  attempts: number;
  successes: number;
  failures: number;
  lastDurationMs: number | null;
  lastError: Readonly<{ code: RustEngineLoadErrorCode; message: string }> | null;
  artifact: RustEngineArtifact;
  /** Only a standalone default published loader owns this cache; worker code is pipeline-owned. */
  codeCache: ReturnType<RustEngineCodeCache["diagnostics"]> | null;
}>;

const requiredExports: readonly (keyof RustEngineWasmExports)[] = [
  "blockwild_protocol_version",
  "blockwild_schema_version",
  "blockwild_engine_create",
  "blockwild_engine_ingest",
  "blockwild_engine_step",
  "blockwild_engine_take_events",
  "blockwild_engine_state_hash",
  "blockwild_engine_destroy",
];

/**
 * Load published Wasm glue without asking Vite/Next to resolve a `/public`
 * module as application source. The artifact is immutable and its URL was
 * selected from the content-addressed manifest, so fetching it and importing a
 * short-lived module Blob preserves native ESM while keeping bundlers out of
 * the runtime path.
 */
async function importUnbundledRustModule(artifact: ResolvedRustEngineArtifact, verifiedGlue?: Uint8Array) {
  if (typeof fetch !== "function" || typeof URL?.createObjectURL !== "function" || typeof Blob === "undefined") {
    throw new RustEngineLoadError("artifact-unavailable", "Published Rust modules require browser fetch and Blob URL support");
  }
  let source: string | ArrayBuffer;
  if (verifiedGlue) source = verifiedGlue.slice().buffer;
  else {
    const response = await fetch(artifact.moduleUrl, { cache: "no-store" });
    if (!response.ok) throw new RustEngineLoadError("artifact-unavailable", `Rust engine module returned HTTP ${response.status}`);
    source = await response.text();
  }
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ /* webpackIgnore: true */ moduleUrl) as unknown;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return {};
  return value as Record<string, unknown>;
}

function validateExports(value: unknown): RustEngineWasmExports {
  const candidate = asRecord(value);
  for (const name of requiredExports) {
    if (typeof candidate[name] !== "function") {
      throw new RustEngineLoadError("invalid-module", `Rust engine artifact is missing export ${name}`);
    }
  }
  return candidate as unknown as RustEngineWasmExports;
}

export class RustEngineLoader {
  private readonly artifact: RustEngineArtifact;
  private readonly importer: RustEngineModuleImporter;
  private readonly fetcher: RustEngineManifestFetcher | null;
  private readonly now: () => number;
  private readonly protocolVersion: number;
  private readonly schemaVersion: number;
  private readonly preparedCode?: PreparedRustEngineCode;
  private readonly customImporter: boolean;
  private readonly codeFetcher?: RustEngineCodeFetcher;
  private ownedCodeCache: RustEngineCodeCache | null = null;
  private loadGeneration = 0;
  private inFlight: Promise<LoadedRustEngine> | null = null;
  private loaded: LoadedRustEngine | null = null;
  private state: RustEngineLoaderDiagnostics["state"] = "idle";
  private attempts = 0;
  private successes = 0;
  private failures = 0;
  private lastDurationMs: number | null = null;
  private lastError: RustEngineLoaderDiagnostics["lastError"] = null;

  constructor(options: RustEngineLoaderOptions = {}) {
    this.artifact = options.artifact ?? options.preparedCode?.artifact ?? DEFAULT_RUST_ENGINE_ARTIFACT;
    this.importer = options.importer ?? importUnbundledRustModule;
    this.fetcher = options.fetcher ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    this.now = options.now ?? (() => typeof performance === "undefined" ? Date.now() : performance.now());
    this.protocolVersion = options.protocolVersion ?? RUST_ENGINE_PROTOCOL_VERSION;
    this.schemaVersion = options.schemaVersion ?? RUST_ENGINE_SCHEMA_VERSION;
    this.preparedCode = options.preparedCode;
    this.customImporter = Boolean(options.importer);
    this.codeFetcher = options.codeFetcher;
  }

  load(): Promise<LoadedRustEngine> {
    if (this.loaded) return Promise.resolve(this.loaded);
    if (this.inFlight) return this.inFlight;
    this.state = "loading";
    this.attempts += 1;
    const startedAt = this.now();
    const generation = this.loadGeneration;
    const pending = this.loadOnce(startedAt, generation).then((loaded) => {
      this.assertLoadGeneration(generation);
      this.loaded = loaded;
      this.state = "ready";
      this.successes += 1;
      this.lastDurationMs = loaded.loadDurationMs;
      this.lastError = null;
      return loaded;
    }).catch((error: unknown) => {
      const normalized = error instanceof RustEngineLoadError
        ? error
        : new RustEngineLoadError("artifact-unavailable", `Rust engine artifact could not be loaded: ${error instanceof Error ? error.message : String(error)}`, error);
      if (generation === this.loadGeneration) {
        this.state = "failed";
        this.failures += 1;
        this.lastDurationMs = Math.max(0, this.now() - startedAt);
        this.lastError = { code: normalized.code, message: normalized.message };
      }
      throw normalized;
    }).finally(() => {
      if (this.inFlight === pending) this.inFlight = null;
    });
    this.inFlight = pending;
    return pending;
  }

  private assertLoadGeneration(generation: number) {
    if (generation !== this.loadGeneration) throw new RustEngineLoadError("initialization-failed", "Rust engine load was superseded by reset");
  }

  private async loadOnce(startedAt: number, generation: number): Promise<LoadedRustEngine> {
    let prepared = this.preparedCode ? await snapshotPreparedRustCode(this.preparedCode) : null;
    if (!prepared && !this.customImporter && this.artifact.indexUrl && !this.artifact.moduleUrl && !this.artifact.wasmUrl) {
      this.ownedCodeCache ??= new RustEngineCodeCache({ fetcher: this.codeFetcher });
      prepared = await this.ownedCodeCache.prepare(this.artifact);
    }
    this.assertLoadGeneration(generation);
    if (prepared) {
      const selected = prepared.artifact;
      const base = typeof location === "undefined" ? "http://localhost/" : location.href;
      if ((this.artifact.buildHash && this.artifact.buildHash !== selected.buildHash)
        || (this.artifact.variant && this.artifact.variant !== selected.variant)
        || this.artifact.buildKind !== selected.buildKind
        || (this.artifact.indexUrl && new URL(this.artifact.indexUrl, base).href !== selected.selectorUrl)
        || (this.artifact.moduleUrl && this.artifact.moduleUrl !== selected.moduleUrl)
        || (this.artifact.wasmUrl && this.artifact.wasmUrl !== selected.wasmUrl)) {
        throw new RustEngineLoadError("invalid-module", "Prepared code differs from pinned artifact identity");
      }
    }
    const artifact = prepared?.artifact ?? await this.resolveArtifact();
    this.assertLoadGeneration(generation);
    let namespace: Record<string, unknown>;
    try {
      namespace = asRecord(await this.importer(artifact, prepared?.glueBytes));
    } catch (error) {
      throw new RustEngineLoadError("artifact-unavailable", `Rust engine artifact is unavailable at ${artifact.moduleUrl}`, error);
    }
    this.assertLoadGeneration(generation);
    const initializer = namespace.default;
    if (typeof initializer === "function") {
      try {
        await (initializer as (options?: { module_or_path: string | WebAssembly.Module }) => unknown)({
          module_or_path: prepared?.wasmModule ?? artifact.wasmUrl,
        });
      } catch (error) {
        throw new RustEngineLoadError("initialization-failed", `Rust engine Wasm initialization failed for ${artifact.wasmUrl}`, error);
      }
    }
    this.assertLoadGeneration(generation);
    const exports = validateExports(namespace);
    const protocolVersion = exports.blockwild_protocol_version();
    if (protocolVersion !== this.protocolVersion) {
      throw new RustEngineLoadError("protocol-mismatch", `Rust engine protocol ${protocolVersion} is incompatible with browser protocol ${this.protocolVersion}`);
    }
    const schemaVersion = exports.blockwild_schema_version();
    if (schemaVersion !== this.schemaVersion) {
      throw new RustEngineLoadError("schema-mismatch", `Rust engine schema ${schemaVersion} is incompatible with browser schema ${this.schemaVersion}`);
    }
    return {
      exports,
      artifact,
      protocolVersion,
      schemaVersion,
      loadDurationMs: Math.max(0, this.now() - startedAt),
    };
  }

  private async resolveArtifact(): Promise<ResolvedRustEngineArtifact> {
    if (this.artifact.moduleUrl && this.artifact.wasmUrl) {
      return {
        ...this.artifact,
        moduleUrl: this.artifact.moduleUrl,
        wasmUrl: this.artifact.wasmUrl,
        buildHash: this.artifact.buildHash ?? "unversioned",
      };
    }
    if (!this.artifact.indexUrl || !this.fetcher) {
      throw new RustEngineLoadError("artifact-unavailable", "Rust engine manifest resolution is unavailable in this environment");
    }
    const base = typeof location === "undefined" ? "http://localhost/" : location.href;
    const indexUrl = new URL(this.artifact.indexUrl, base).href;
    const indexResponse = await this.fetcher(indexUrl);
    if (!indexResponse.ok) {
      throw new RustEngineLoadError("artifact-unavailable", `Rust engine artifact index returned HTTP ${indexResponse.status} at ${indexUrl}`);
    }
    const index = asRecord(await indexResponse.json());
    if (index.schema !== 1 || typeof index.defaultVariant !== "string") {
      throw new RustEngineLoadError("invalid-module", "Rust engine artifact index has an unsupported schema");
    }
    const variant = this.artifact.variant ?? index.defaultVariant;
    const artifacts = asRecord(index.artifacts);
    const entry = asRecord(artifacts[variant]);
    const hash = typeof entry.hash === "string" ? entry.hash : "";
    if (!/^[a-f0-9]{64}$/.test(hash) || entry.directory !== hash || entry.manifest !== `${hash}/manifest.json`) {
      throw new RustEngineLoadError("invalid-module", `Rust engine artifact entry ${variant} is not content-addressed`);
    }
    const manifestUrl = new URL(`${hash}/manifest.json`, indexUrl).href;
    const manifestResponse = await this.fetcher(manifestUrl);
    if (!manifestResponse.ok) {
      throw new RustEngineLoadError("artifact-unavailable", `Rust engine artifact manifest returned HTTP ${manifestResponse.status} at ${manifestUrl}`);
    }
    const manifest = asRecord(await manifestResponse.json());
    const files = manifest.files;
    if (manifest.schema !== 1 || manifest.artifactHash !== hash || manifest.variant !== variant || !Array.isArray(files)) {
      throw new RustEngineLoadError("invalid-module", `Rust engine artifact manifest ${variant} is malformed or mismatched`);
    }
    const safeFile = (role: string) => files.find((value: unknown) => {
      const file = asRecord(value);
      return file.role === role && typeof file.path === "string" && !file.path.includes("..") && !file.path.startsWith("/");
    });
    const glue = asRecord(safeFile("glue"));
    const wasm = asRecord(safeFile("wasm"));
    if (typeof glue.path !== "string" || typeof wasm.path !== "string") {
      throw new RustEngineLoadError("invalid-module", `Rust engine artifact ${variant} is missing glue or Wasm files`);
    }
    return {
      ...this.artifact,
      moduleUrl: new URL(glue.path, manifestUrl).href,
      wasmUrl: new URL(wasm.path, manifestUrl).href,
      buildKind: variant === "accelerated" ? "accelerated" : this.artifact.buildKind,
      buildHash: hash,
      variant,
    };
  }

  reset() {
    this.loadGeneration += 1;
    this.ownedCodeCache?.dispose(); this.ownedCodeCache = null;
    this.loaded = null;
    this.inFlight = null;
    this.state = "idle";
    this.lastError = null;
    this.lastDurationMs = null;
  }

  diagnostics(): RustEngineLoaderDiagnostics {
    return {
      state: this.state,
      attempts: this.attempts,
      successes: this.successes,
      failures: this.failures,
      lastDurationMs: this.lastDurationMs,
      lastError: this.lastError,
      artifact: this.artifact,
      codeCache: this.ownedCodeCache?.diagnostics() ?? null,
    };
  }
}
