import { GAME_VERSION } from "./version";
import {
  createNetworkAuthorityIdentityV1,
  createNetworkInterestSetV1,
  type NetworkAuthorityIdentityV1,
  type NetworkInterestSetV1,
  type NetworkInterestSetSourceV1,
} from "./network-authority-contract";
import {
  RustIntegratedRuntimeBrowserAdapterV1,
  type RustIntegratedRuntimeBrowserAdapterOptionsV1,
} from "./rust-integrated-runtime-adapter";
import { RustIntegratedPersistencePumpV1 } from "./rust-integrated-persistence-pump";
import { RustIntegratedPersistenceRuntimePortV1 } from "./rust-integrated-runtime-persistence";
import { RustNativeWorldPersistenceSessionV1 } from "./rust-native-world-persistence";
import { IndexedDbPersistenceAdapterV1 } from "./indexeddb-persistence-adapter";
import { RustPersistenceBrowserRuntimeV1 } from "./rust-persistence-runtime-adapter";
import type { RustIntegratedRuntimeServiceV1 } from "./rust-integrated-runtime-service";
import {
  requireBlockwildProductionContent,
  type RustContentInstallReceiptV1,
  type RustProductionContentBundle,
} from "./rust-integrated-runtime-content";
import { RustIntegratedNetworkRuntimePortV1 } from "./rust-integrated-runtime-domain-adapters";
import type {
  RustIntegratedRuntimeConfigV1,
  RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract";
import {
  IntegratedRustMultiplayerAuthorityV1,
  type RustMultiplayerAuthorityV1,
} from "./rust-multiplayer-authority";
import { RustNetworkRuntimeServiceV1 } from "./rust-network-runtime-service";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CANONICAL_HASH_PATTERN = /^[0-9a-f]{32}$/u;
const ENGINE_MANIFEST_SCHEMA = 1;

export type RustWorldRuntimeHostStateV1 = "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export type RustWorldRuntimeHostConfigV1 = Readonly<{
  worldSeed: string;
  universeId: string;
  locationId: string;
  sessionId: string;
  /** Browser catalog identity. Multiplayer guests intentionally omit it. */
  catalogWorldId?: string | null;
  generatorHash: string;
  terrainContentHash: string;
  generationOptionsJson: string;
  waterBlockId: number;
  directionalBlockIds: readonly number[];
  waterloggedBlockIds: readonly number[];
}>;

export interface RustWorldRuntimeAdapterV1 {
  start(config: RustIntegratedRuntimeConfigV1): Promise<RustIntegratedRuntimeIdentityV1>;
  installContent(bundle: RustProductionContentBundle): Promise<RustContentInstallReceiptV1>;
  shutdown(): Promise<unknown>;
  identity(): RustIntegratedRuntimeIdentityV1;
  diagnostics(): Readonly<{
    authoritative: boolean;
    contentReady: boolean;
    contentManifestHash: string | null;
    [key: string]: unknown;
  }>;
}

export type RustWorldRuntimeHostDependenciesV1 = Readonly<{
  fetch?: typeof globalThis.fetch;
  manifestUrl?: string;
  artifactHash?: string;
  contentFactory?: () => RustProductionContentBundle;
  adapterFactory?: (options: RustIntegratedRuntimeBrowserAdapterOptionsV1) => RustWorldRuntimeAdapterV1;
  authorityFactory?: (
    adapter: RustWorldRuntimeAdapterV1,
    identity: () => NetworkAuthorityIdentityV1,
    contentHash: string,
    generatorHash: string,
  ) => RustMultiplayerAuthorityV1;
  persistenceFactory?: (input: Readonly<{
    worldId: string;
    adapter: RustWorldRuntimeAdapterV1;
  }>) => RustWorldNativePersistenceBindingV1;
}>;

export type RustWorldNativePersistenceBindingV1 = Readonly<{
  session: RustNativeWorldPersistenceSessionV1;
  closePlatform(): Promise<void>;
}>;

export type RustWorldRuntimeHostDiagnosticsV1 = Readonly<{
  state: RustWorldRuntimeHostStateV1;
  artifactHash: string | null;
  contentHash: string | null;
  generatorHash: string;
  identity: RustIntegratedRuntimeIdentityV1 | null;
  adapter: ReturnType<RustWorldRuntimeAdapterV1["diagnostics"]> | null;
  nativePersistence?: ReturnType<RustNativeWorldPersistenceSessionV1["diagnostics"]> | null;
  lastError: string | null;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireArtifactHash(value: string, label: string) {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256 hash`);
  return value;
}

function requireCanonicalHash(value: string, label: string) {
  if (!CANONICAL_HASH_PATTERN.test(value)) throw new Error(`${label} must be a lowercase 128-bit canonical hash`);
  return value;
}

/** Resolves the exact compatibility artifact selected by the content-addressed engine index. */
export async function resolveRustEngineArtifactHashV1(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  manifestUrl = "/engine/manifest.json",
) {
  if (typeof fetchImpl !== "function") throw new Error("Rust engine manifest fetch is unavailable");
  const response = await fetchImpl(manifestUrl, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error(`Rust engine manifest request failed with HTTP ${response.status}`);
  const root = record(await response.json());
  const artifacts = record(root?.artifacts);
  const compatibility = record(artifacts?.compatibility);
  if (root?.schema !== ENGINE_MANIFEST_SCHEMA || root?.defaultVariant !== "compatibility" || !compatibility) {
    throw new Error("Rust engine manifest does not select the compatibility artifact");
  }
  const hash = requireArtifactHash(String(compatibility.hash ?? ""), "Rust engine artifact hash");
  if (compatibility.directory !== hash || compatibility.manifest !== `${hash}/manifest.json`) {
    throw new Error("Rust engine manifest is not content-addressed by its selected hash");
  }
  return hash;
}

function productionContentBundle(): RustProductionContentBundle {
  const compiled = requireBlockwildProductionContent();
  return Object.freeze({
    manifest: compiled.manifest,
    artifacts: compiled.artifacts,
    blockers: Object.freeze([]),
  });
}

function runtimeConfig(
  input: RustWorldRuntimeHostConfigV1,
  contentHash: string,
): RustIntegratedRuntimeConfigV1 {
  return Object.freeze({
    worldSeed: input.worldSeed,
    universeId: input.universeId,
    locationId: input.locationId,
    sessionId: input.sessionId,
    contentHash,
    generatorHash: requireCanonicalHash(input.generatorHash, "Rust generator hash"),
    terrainContentHash: requireCanonicalHash(input.terrainContentHash, "Rust terrain content hash"),
    generationOptionsJson: input.generationOptionsJson,
    waterBlockId: input.waterBlockId,
    directionalBlockIds: Object.freeze([...input.directionalBlockIds]),
    waterloggedBlockIds: Object.freeze([...input.waterloggedBlockIds]),
  });
}

function networkIdentity(identity: RustIntegratedRuntimeIdentityV1): NetworkAuthorityIdentityV1 {
  return createNetworkAuthorityIdentityV1(
    { universeId: identity.universeId, locationId: identity.locationId },
    {
      epoch: identity.revision.epoch,
      world: identity.revision.world,
      entities: identity.revision.entities,
      gameplay: identity.revision.gameplay,
      persistence: identity.revision.persistence,
    },
  );
}

function productionAuthority(
  adapter: RustWorldRuntimeAdapterV1,
  identity: () => NetworkAuthorityIdentityV1,
  contentHash: string,
  generatorHash: string,
) {
  const service = (adapter as RustIntegratedRuntimeBrowserAdapterV1).service;
  if (!service) throw new Error("Production Rust runtime adapter does not expose its sole worker service");
  const lifecycle = new RustIntegratedNetworkRuntimePortV1(service);
  return new IntegratedRustMultiplayerAuthorityV1({
    network: new RustNetworkRuntimeServiceV1(lifecycle),
    lifecycle,
    identity,
    engineVersion: GAME_VERSION,
    contentHash,
    generatorHash,
  });
}

function productionRuntimeService(adapter: RustWorldRuntimeAdapterV1) {
  const service = (adapter as RustWorldRuntimeAdapterV1 & { service?: RustIntegratedRuntimeServiceV1 }).service;
  if (!service) throw new Error("Production Rust runtime adapter does not expose its sole worker service");
  return service;
}

/**
 * Builds the browser half of R8 around the service already owned by the sole
 * integrated runtime adapter. This function must never construct a worker.
 */
function productionNativePersistence(
  input: Readonly<{ worldId: string; adapter: RustWorldRuntimeAdapterV1 }>,
): RustWorldNativePersistenceBindingV1 {
  const service = productionRuntimeService(input.adapter);
  const platform = new IndexedDbPersistenceAdapterV1();
  const browserRuntime = new RustPersistenceBrowserRuntimeV1(platform);
  const port = new RustIntegratedPersistenceRuntimePortV1(service);
  const pump = new RustIntegratedPersistencePumpV1(service, browserRuntime);
  const session = new RustNativeWorldPersistenceSessionV1({
    worldId: input.worldId,
    runtime: service,
    port,
    pump,
    checkpoints: platform,
  });
  return Object.freeze({ session, closePlatform: () => platform.close() });
}

/**
 * Owns exactly one integrated Rust worker for one active world/session.
 * Consumers receive only awaited authority and renderer/persistence ports; no
 * second multiplayer, entity, or gameplay worker may be created beside it.
 */
export class RustWorldRuntimeHostV1 {
  private state: RustWorldRuntimeHostStateV1 = "idle";
  private adapter: RustWorldRuntimeAdapterV1 | null = null;
  private authority: RustMultiplayerAuthorityV1 | null = null;
  private nativePersistence: RustWorldNativePersistenceBindingV1 | null = null;
  private artifactHash: string | null = null;
  private contentHash: string | null = null;
  private identityValue: RustIntegratedRuntimeIdentityV1 | null = null;
  private lastError: string | null = null;
  private lifecycle = Promise.resolve<unknown>(undefined);

  constructor(
    readonly config: RustWorldRuntimeHostConfigV1,
    private readonly dependencies: RustWorldRuntimeHostDependenciesV1 = {},
  ) {}

  start() {
    return this.enqueue(async () => {
      if (this.state === "ready") return this.identity();
      if (this.state !== "idle" && this.state !== "stopped" && this.state !== "failed") {
        throw new Error(`Cannot start Rust world runtime from ${this.state}`);
      }
      this.state = "starting";
      this.lastError = null;
      let adapter: RustWorldRuntimeAdapterV1 | null = null;
      let nativePersistence: RustWorldNativePersistenceBindingV1 | null = null;
      try {
        const bundle = (this.dependencies.contentFactory ?? productionContentBundle)();
        if (!bundle.manifest || bundle.blockers.length) throw new Error("Rust production content contains unresolved blockers");
        const artifactHash = this.dependencies.artifactHash
          ? requireArtifactHash(this.dependencies.artifactHash, "Rust engine artifact hash")
          : await resolveRustEngineArtifactHashV1(this.dependencies.fetch, this.dependencies.manifestUrl);
        const adapterFactory = this.dependencies.adapterFactory
          ?? ((options: RustIntegratedRuntimeBrowserAdapterOptionsV1) => new RustIntegratedRuntimeBrowserAdapterV1(options));
        adapter = adapterFactory({ artifactHash });
        const created = await adapter.start(runtimeConfig(this.config, bundle.manifest.manifestHash));
        const installed = await adapter.installContent(bundle);
        if (installed.status !== "installed" || installed.manifestHash !== bundle.manifest.manifestHash) {
          throw new Error("Rust runtime did not attest the complete authored-content bundle");
        }
        const diagnostics = adapter.diagnostics();
        if (!diagnostics.authoritative || !diagnostics.contentReady
          || diagnostics.contentManifestHash !== bundle.manifest.manifestHash) {
          throw new Error("Rust runtime remained non-authoritative after content installation");
        }
        nativePersistence = this.config.catalogWorldId
          ? (this.dependencies.persistenceFactory ?? productionNativePersistence)({
            worldId: this.config.catalogWorldId,
            adapter,
          })
          : null;
        if (nativePersistence && nativePersistence.session.worldId !== this.config.catalogWorldId) {
          throw new Error("Rust native persistence session does not match its browser catalog world");
        }
        this.adapter = adapter;
        this.nativePersistence = nativePersistence;
        this.artifactHash = artifactHash;
        this.contentHash = bundle.manifest.manifestHash;
        this.identityValue = created;
        const activeAdapter = adapter;
        const identity = () => networkIdentity(activeAdapter.identity());
        this.authority = (this.dependencies.authorityFactory ?? productionAuthority)(
          adapter,
          identity,
          bundle.manifest.manifestHash,
          this.config.generatorHash,
        );
        this.identityValue = adapter.identity();
        this.state = "ready";
        return this.identity();
      } catch (error) {
        this.state = "failed";
        this.lastError = error instanceof Error ? error.message : String(error);
        const failedPersistence = this.nativePersistence ?? nativePersistence;
        if (failedPersistence) {
          try { await failedPersistence.session.shutdown(); } catch { /* Preserve the primary startup failure. */ }
          try { await failedPersistence.closePlatform(); } catch { /* Preserve the primary startup failure. */ }
        }
        if (adapter) {
          try { await adapter.shutdown(); } catch { /* Preserve the primary startup failure. */ }
        }
        this.adapter = null;
        this.nativePersistence = null;
        this.authority = null;
        this.identityValue = null;
        throw error;
      }
    });
  }

  shutdown() {
    return this.enqueue(async () => {
      if (this.state === "idle" || this.state === "stopped") return;
      this.state = "stopping";
      const authority = this.authority;
      const adapter = this.adapter;
      const nativePersistence = this.nativePersistence;
      this.authority = null;
      this.adapter = null;
      this.nativePersistence = null;
      let failure: unknown = null;
      try { await authority?.drain(); }
      catch (error) { failure = error; }
      try { await nativePersistence?.session.shutdown(); }
      catch (error) { failure ??= error; }
      try { await nativePersistence?.closePlatform(); }
      catch (error) { failure ??= error; }
      try { await adapter?.shutdown(); }
      catch (error) { failure ??= error; }
      if (failure) {
        this.state = "failed";
        this.lastError = failure instanceof Error ? failure.message : String(failure);
        throw failure;
      }
      this.state = "stopped";
    });
  }

  identity() {
    const value = this.requireAdapter().identity();
    this.identityValue = value;
    return value;
  }

  networkIdentity() { return networkIdentity(this.identity()); }

  multiplayerAuthority() {
    if (this.state !== "ready" || !this.authority) throw new Error("Rust multiplayer authority is not ready");
    return this.authority;
  }

  authorityInterest(source: NetworkInterestSetSourceV1): NetworkInterestSetV1 {
    if (this.state !== "ready") throw new Error("Rust world authority is not ready");
    return createNetworkInterestSetV1(source);
  }

  runtimeAdapter() { return this.requireAdapter(); }

  runtimeService(): RustIntegratedRuntimeServiceV1 {
    return productionRuntimeService(this.requireAdapter());
  }

  nativePersistenceSession() {
    if (this.state !== "ready") throw new Error("Rust world runtime is not ready");
    return this.nativePersistence?.session ?? null;
  }

  diagnostics(): RustWorldRuntimeHostDiagnosticsV1 {
    return Object.freeze({
      state: this.state,
      artifactHash: this.artifactHash,
      contentHash: this.contentHash,
      generatorHash: this.config.generatorHash,
      identity: this.identityValue,
      adapter: this.adapter?.diagnostics() ?? null,
      nativePersistence: this.nativePersistence?.session.diagnostics() ?? null,
      lastError: this.lastError,
    });
  }

  private requireAdapter() {
    if (this.state !== "ready" || !this.adapter) throw new Error("Rust world runtime is not ready");
    return this.adapter;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.catch(() => undefined).then(operation);
    this.lifecycle = next;
    return next;
  }
}
