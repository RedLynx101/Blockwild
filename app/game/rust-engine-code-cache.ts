import type { ResolvedRustEngineArtifact, RustEngineArtifact } from "./rust-engine-loader";

export type RustEngineCodeFile = Readonly<{ path: string; url: string; bytes: number; sha256: string }>;
export type PublishedRustEngineCodeArtifact = ResolvedRustEngineArtifact & Readonly<{
  selectorUrl: string; manifestUrl: string; manifestSha256: string; variant: string;
  glue: RustEngineCodeFile; wasm: RustEngineCodeFile;
}>;
/** Only immutable code crosses workers. No initialized namespace, instance, memory, or certificate. */
export type PreparedRustEngineCode = Readonly<{
  identity: string; artifact: PublishedRustEngineCodeArtifact; glueBytes: Uint8Array; wasmModule: WebAssembly.Module;
}>;
export type RustEngineCodeFetcher = (url: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "arrayBuffer"> & { readonly url?: string }>;
export type RustEngineCodeCacheOptions = Readonly<{
  fetcher?: RustEngineCodeFetcher;
  compile?: (bytes: Uint8Array) => Promise<WebAssembly.Module>;
  /** Bounds retained immutable entries, not concurrent selector/fetch work or already-started, unabortable compilation. */
  maximumEntries?: number;
}>;

const SHA256 = /^[a-f0-9]{64}$/u;
function requireCode(value: unknown, message: string): asserts value { if (!value) throw new Error(`Rust immutable code: ${message}`); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
async function sha256(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function active(signal: AbortSignal) { requireCode(!signal.aborted, "acquisition was aborted or disposed"); }
async function fetchBytes(fetcher: RustEngineCodeFetcher, url: string, signal: AbortSignal, maximum: number, mutable: boolean) {
  active(signal);
  const response = await fetcher(url, { signal, cache: mutable ? "no-store" : "default" });
  requireCode(response.ok, `HTTP ${response.status} at ${url}`);
  requireCode(!response.url || response.url === url, `redirected asset/manifest at ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer()); active(signal);
  requireCode(bytes.byteLength > 0 && bytes.byteLength <= maximum, `invalid response length at ${url}`);
  return bytes;
}
function fileDescriptor(files: unknown[], role: string, manifestUrl: string): RustEngineCodeFile {
  const matches = files.map(record).filter(file => file.role === role);
  requireCode(matches.length === 1, `exactly one ${role} file is required`);
  const file = matches[0]; const path = file.path;
  requireCode(typeof path === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u.test(path)
    && path.split("/").every(part => part !== "" && part !== "." && part !== ".."), `unsafe ${role} path`);
  requireCode(Number.isSafeInteger(file.bytes) && Number(file.bytes) > 0 && Number(file.bytes) <= 128 * 1024 * 1024, `invalid ${role} length`);
  requireCode(typeof file.sha256 === "string" && SHA256.test(file.sha256), `missing ${role} SHA-256`);
  const url = new URL(path, manifestUrl); const parent = new URL(".", manifestUrl);
  requireCode(url.origin === parent.origin && url.pathname.startsWith(parent.pathname), `${role} URL escaped the artifact directory`);
  return Object.freeze({ path, url: url.href, bytes: Number(file.bytes), sha256: file.sha256 });
}

/** Resolve the mutable selector anew. Never use an unversioned direct URL as a reusable code identity. */
export async function resolvePublishedRustCodeArtifact(artifact: RustEngineArtifact, fetcher: RustEngineCodeFetcher, signal: AbortSignal): Promise<PublishedRustEngineCodeArtifact> {
  requireCode(artifact.indexUrl && !artifact.moduleUrl && !artifact.wasmUrl, "verified code requires a published selector, not direct/unversioned URLs");
  const selectorUrl = new URL(artifact.indexUrl, typeof location === "undefined" ? "http://localhost/" : location.href);
  requireCode(["http:", "https:"].includes(selectorUrl.protocol) && !selectorUrl.username && !selectorUrl.password && !selectorUrl.hash, "invalid selector URL");
  const index = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await fetchBytes(fetcher, selectorUrl.href, signal, 512 * 1024, true))));
  requireCode(index.schema === 1 && typeof index.defaultVariant === "string", "unsupported selector schema");
  const variant = artifact.variant ?? index.defaultVariant;
  requireCode(/^[a-z0-9_-]{1,64}$/u.test(variant), "invalid selected variant");
  const entry = record(record(index.artifacts)[variant]); const hash = entry.hash;
  requireCode(typeof hash === "string" && SHA256.test(hash) && entry.directory === hash && entry.manifest === `${hash}/manifest.json`, "selected artifact is not content-addressed");
  requireCode(!artifact.buildHash || artifact.buildHash === hash, "selected artifact differs from the pinned build hash");
  const manifestUrl = new URL(`${hash}/manifest.json`, selectorUrl).href;
  const manifestBytes = await fetchBytes(fetcher, manifestUrl, signal, 512 * 1024, true);
  const manifest = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)));
  requireCode(manifest.schema === 1 && manifest.artifactHash === hash && manifest.variant === variant && Array.isArray(manifest.files), "manifest identity/schema mismatch");
  const glue = fileDescriptor(manifest.files, "glue", manifestUrl); const wasm = fileDescriptor(manifest.files, "wasm", manifestUrl);
  requireCode(glue.path !== wasm.path, "glue and Wasm paths alias");
  const manifestSha256 = await sha256(manifestBytes); active(signal);
  return Object.freeze({ ...artifact, selectorUrl: selectorUrl.href, indexUrl: selectorUrl.href, manifestUrl, manifestSha256, variant,
    buildHash: hash, buildKind: variant === "accelerated" ? "accelerated" : artifact.buildKind,
    moduleUrl: glue.url, wasmUrl: wasm.url, glue, wasm });
}

export async function rustEngineCodeIdentity(artifact: PublishedRustEngineCodeArtifact) {
  requireCode(SHA256.test(artifact.buildHash) && SHA256.test(artifact.manifestSha256), "invalid code identity hashes");
  return sha256(new TextEncoder().encode(JSON.stringify([artifact.selectorUrl, artifact.variant, artifact.buildKind, artifact.buildHash,
    artifact.manifestUrl, artifact.manifestSha256, artifact.moduleUrl, artifact.wasmUrl,
    artifact.glue.path, artifact.glue.url, artifact.glue.bytes, artifact.glue.sha256,
    artifact.wasm.path, artifact.wasm.url, artifact.wasm.bytes, artifact.wasm.sha256])));
}

/** Recheck the worker's cloned glue before importing it; Module provenance is the parent's verified compile. */
export async function snapshotPreparedRustCode(value: PreparedRustEngineCode): Promise<PreparedRustEngineCode> {
  requireCode(value && value.wasmModule instanceof WebAssembly.Module && value.glueBytes instanceof Uint8Array
    && value.glueBytes.buffer instanceof ArrayBuffer, "invalid prepared module/glue");
  // Snapshot before hashing yields so caller mutation cannot race verification/import.
  const glueBytes = value.glueBytes.slice(); const artifact = structuredClone(value.artifact);
  const identity = value.identity; const wasmModule = value.wasmModule;
  requireCode(identity === await rustEngineCodeIdentity(artifact), "prepared code identity mismatch");
  requireCode(glueBytes.byteLength === artifact.glue.bytes, "prepared glue length mismatch");
  requireCode(await sha256(glueBytes) === artifact.glue.sha256, "prepared glue SHA-256 mismatch");
  return Object.freeze({ identity, artifact, glueBytes, wasmModule });
}

type Entry = { controller: AbortController; promise: Promise<PreparedRustEngineCode>; pending: boolean };
export class RustEngineCodeCache {
  private readonly fetcher: RustEngineCodeFetcher;
  private readonly compile: (bytes: Uint8Array) => Promise<WebAssembly.Module>;
  private readonly maximumEntries: number;
  private readonly entries = new Map<string, Entry>();
  private readonly selectors = new Set<AbortController>();
  private disposed = false;
  private resolutions = 0;
  private cacheHits = 0;
  private assetFetches = 0;
  private verifiedBytes = 0;
  private compilations = 0;
  private failures = 0;

  constructor(options: RustEngineCodeCacheOptions = {}) {
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.compile = options.compile ?? (bytes => WebAssembly.compile(bytes.slice().buffer));
    this.maximumEntries = options.maximumEntries ?? 2;
    requireCode(Number.isSafeInteger(this.maximumEntries) && this.maximumEntries >= 1 && this.maximumEntries <= 4, "cache bound must be 1–4 entries");
  }

  async prepare(artifact: RustEngineArtifact): Promise<PreparedRustEngineCode> {
    requireCode(!this.disposed, "cache is disposed");
    const selector = new AbortController(); this.selectors.add(selector); this.resolutions += 1;
    let resolved: PublishedRustEngineCodeArtifact; let identity: string;
    try {
      resolved = await resolvePublishedRustCodeArtifact(artifact, this.fetcher, selector.signal);
      identity = await rustEngineCodeIdentity(resolved); active(selector.signal);
    } catch (error) { this.failures += 1; throw error; }
    finally { this.selectors.delete(selector); selector.abort(); }
    requireCode(!this.disposed, "cache is disposed");
    let entry = this.entries.get(identity);
    if (entry) {
      this.cacheHits += 1; this.entries.delete(identity); this.entries.set(identity, entry);
    } else {
      while (this.entries.size >= this.maximumEntries) {
        const oldest = this.entries.entries().next().value!; this.entries.delete(oldest[0]); oldest[1].controller.abort();
      }
      const controller = new AbortController();
      const owned: Entry = { controller, pending: true, promise: this.acquire(resolved, identity, controller.signal).then(code => {
        active(controller.signal); requireCode(!this.disposed, "cache is disposed"); owned.pending = false; return code;
      }).catch(error => {
        controller.abort(); this.failures += 1;
        if (this.entries.get(identity) === owned) this.entries.delete(identity);
        throw error;
      }) };
      entry = owned;
      this.entries.set(identity, entry);
    }
    const result = await entry.promise; active(entry.controller.signal); requireCode(!this.disposed, "cache is disposed");
    return Object.freeze({ ...result, glueBytes: result.glueBytes.slice() });
  }

  private async acquire(artifact: PublishedRustEngineCodeArtifact, identity: string, signal: AbortSignal): Promise<PreparedRustEngineCode> {
    const verified = async (file: RustEngineCodeFile) => {
      this.assetFetches += 1;
      const bytes = await fetchBytes(this.fetcher, file.url, signal, 128 * 1024 * 1024, false);
      requireCode(bytes.byteLength === file.bytes, `file length mismatch at ${file.url}`);
      requireCode(await sha256(bytes) === file.sha256, `file SHA-256 mismatch at ${file.url}`); active(signal);
      this.verifiedBytes += bytes.byteLength; return bytes;
    };
    const [glueBytes, wasmBytes] = await Promise.all([verified(artifact.glue), verified(artifact.wasm)]);
    active(signal); this.compilations += 1;
    const wasmModule = await this.compile(wasmBytes); active(signal);
    requireCode(wasmModule instanceof WebAssembly.Module, "compiler returned no Wasm module");
    return Object.freeze({ artifact, identity, glueBytes, wasmModule });
  }

  dispose() {
    this.disposed = true;
    for (const controller of this.selectors) controller.abort(); this.selectors.clear();
    for (const entry of this.entries.values()) entry.controller.abort(); this.entries.clear();
  }

  diagnostics() {
    return { disposed: this.disposed, maximumEntries: this.maximumEntries, entries: this.entries.size,
      pending: this.selectors.size + [...this.entries.values()].filter(entry => entry.pending).length,
      resolutions: this.resolutions, cacheHits: this.cacheHits, assetFetches: this.assetFetches,
      verifiedBytes: this.verifiedBytes, compilations: this.compilations, failures: this.failures } as const;
  }
}
