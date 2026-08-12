import {
  RustWorldRuntimeHostV1,
  type RustWorldRuntimeAdapterV1,
  type RustWorldRuntimeHostConfigV1,
  type RustWorldRuntimeHostDiagnosticsV1,
} from "./rust-world-runtime-host";
import type { NetworkInterestSetSourceV1, NetworkInterestSetV1 } from "./network-authority-contract";
import type { RustMultiplayerAuthorityV1 } from "./rust-multiplayer-authority";
import type { RustNativeWorldPersistenceSessionV1 } from "./rust-native-world-persistence";
import type { RustIntegratedRuntimeServiceV1 } from "./rust-integrated-runtime-service";

export type RustWorldRuntimeManagerStateV1 =
  | "idle"
  | "starting"
  | "ready"
  | "switching"
  | "stopping"
  | "stopped"
  | "failed";

export interface RustWorldRuntimeManagedHostV1 {
  readonly config: RustWorldRuntimeHostConfigV1;
  start(): Promise<unknown>;
  shutdown(): Promise<unknown>;
  multiplayerAuthority(): RustMultiplayerAuthorityV1;
  authorityInterest(source: NetworkInterestSetSourceV1): NetworkInterestSetV1;
  runtimeAdapter(): RustWorldRuntimeAdapterV1;
  runtimeService(): RustIntegratedRuntimeServiceV1;
  nativePersistenceSession?(): RustNativeWorldPersistenceSessionV1 | null;
  diagnostics(): RustWorldRuntimeHostDiagnosticsV1;
}

export type RustWorldRuntimeManagerDependenciesV1 = Readonly<{
  hostFactory?: (config: RustWorldRuntimeHostConfigV1) => RustWorldRuntimeManagedHostV1;
}>;

export type RustWorldRuntimeManagerDiagnosticsV1 = Readonly<{
  state: RustWorldRuntimeManagerStateV1;
  requestedGeneration: number;
  activeGeneration: number | null;
  activeFingerprint: string | null;
  host: RustWorldRuntimeHostDiagnosticsV1 | null;
  lastError: string | null;
}>;

export class RustWorldRuntimeSupersededErrorV1 extends Error {
  constructor() {
    super("Rust world runtime activation was superseded by a newer world request");
    this.name = "RustWorldRuntimeSupersededErrorV1";
  }
}

function normalizedIds(values: readonly number[]) {
  const result = [...new Set(values)];
  result.sort((left, right) => left - right);
  return result;
}

/**
 * The fingerprint is deliberately a complete, readable identity rather than a
 * lossy hash. Reuse is allowed only when every runtime-defining input matches.
 */
export function rustWorldRuntimeFingerprintV1(config: RustWorldRuntimeHostConfigV1) {
  return JSON.stringify({
    worldSeed: config.worldSeed,
    universeId: config.universeId,
    locationId: config.locationId,
    sessionId: config.sessionId,
    catalogWorldId: config.catalogWorldId ?? null,
    generatorHash: config.generatorHash,
    terrainContentHash: config.terrainContentHash,
    generationOptionsJson: config.generationOptionsJson,
    waterBlockId: config.waterBlockId,
    directionalBlockIds: normalizedIds(config.directionalBlockIds),
    waterloggedBlockIds: normalizedIds(config.waterloggedBlockIds),
  });
}

/**
 * Serial owner for the sole Rust worker belonging to the active game world.
 * A different world is always a drain/destroy/create transition. Concurrent
 * requests are generational: an older start may finish, but it can never be
 * exposed after a newer request has superseded it.
 */
export class RustWorldRuntimeManagerV1 {
  private state: RustWorldRuntimeManagerStateV1 = "idle";
  private host: RustWorldRuntimeManagedHostV1 | null = null;
  private activeFingerprint: string | null = null;
  private activeGeneration: number | null = null;
  private requestedGeneration = 0;
  private lastError: string | null = null;
  private lifecycle = Promise.resolve<unknown>(undefined);
  private readonly hostFactory: (config: RustWorldRuntimeHostConfigV1) => RustWorldRuntimeManagedHostV1;

  constructor(dependencies: RustWorldRuntimeManagerDependenciesV1 = {}) {
    this.hostFactory = dependencies.hostFactory ?? ((config) => new RustWorldRuntimeHostV1(config));
  }

  activate(config: RustWorldRuntimeHostConfigV1): Promise<RustWorldRuntimeManagedHostV1> {
    const generation = ++this.requestedGeneration;
    const fingerprint = rustWorldRuntimeFingerprintV1(config);
    return this.enqueue(async () => {
      this.requireLatest(generation);
      if (this.host && this.activeFingerprint === fingerprint && this.state === "ready") return this.host;

      const prior = this.host;
      if (prior) {
        this.state = "switching";
        this.host = null;
        this.activeFingerprint = null;
        this.activeGeneration = null;
        await prior.shutdown();
        this.requireLatest(generation);
      }

      const candidate = this.hostFactory(config);
      this.host = candidate;
      this.activeFingerprint = fingerprint;
      this.activeGeneration = generation;
      this.state = "starting";
      this.lastError = null;
      try {
        await candidate.start();
        if (generation !== this.requestedGeneration) {
          await candidate.shutdown();
          if (this.host === candidate) this.clearActive();
          throw new RustWorldRuntimeSupersededErrorV1();
        }
        this.state = "ready";
        return candidate;
      } catch (error) {
        if (this.host === candidate) this.clearActive();
        if (generation === this.requestedGeneration) {
          this.state = "failed";
          this.lastError = error instanceof Error ? error.message : String(error);
        }
        throw error;
      }
    });
  }

  shutdown() {
    const generation = ++this.requestedGeneration;
    return this.enqueue(async () => {
      this.state = "stopping";
      const host = this.host;
      this.clearActive();
      try {
        await host?.shutdown();
        if (generation === this.requestedGeneration) this.state = "stopped";
      } catch (error) {
        if (generation === this.requestedGeneration) {
          this.state = "failed";
          this.lastError = error instanceof Error ? error.message : String(error);
        }
        throw error;
      }
    });
  }

  requireReady() {
    if (this.state !== "ready" || !this.host) throw new Error("Rust world runtime is not ready");
    return this.host;
  }

  runtimeService(): RustIntegratedRuntimeServiceV1 {
    return this.requireReady().runtimeService();
  }

  diagnostics(): RustWorldRuntimeManagerDiagnosticsV1 {
    return Object.freeze({
      state: this.state,
      requestedGeneration: this.requestedGeneration,
      activeGeneration: this.activeGeneration,
      activeFingerprint: this.activeFingerprint,
      host: this.host?.diagnostics() ?? null,
      lastError: this.lastError,
    });
  }

  private clearActive() {
    this.host = null;
    this.activeFingerprint = null;
    this.activeGeneration = null;
  }

  private requireLatest(generation: number) {
    if (generation !== this.requestedGeneration) throw new RustWorldRuntimeSupersededErrorV1();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.catch(() => undefined).then(operation);
    this.lifecycle = next;
    return next;
  }
}
