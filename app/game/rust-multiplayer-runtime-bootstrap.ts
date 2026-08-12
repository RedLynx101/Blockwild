import type { NetworkInterestSetSourceV1, NetworkInterestSetV1 } from "./network-authority-contract";
import type { MultiplayerRole, PeerIdentity } from "./multiplayer";
import type { RustIntegratedRuntimeIdentityV1 } from "./rust-integrated-runtime-contract";
import type { RustMultiplayerAuthorityV1 } from "./rust-multiplayer-authority";
import type { RustWorldRuntimeHostConfigV1 } from "./rust-world-runtime-host";
import type { RustWorldRuntimeManagedHostV1 } from "./rust-world-runtime-manager";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";

export const RUST_MULTIPLAYER_RUNTIME_DESCRIPTOR_SCHEMA_V2 = 2 as const;

const CANONICAL_HASH_PATTERN = /^[0-9a-f]{32}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_.-]{8,160}$/u;
const DESCRIPTOR_KEYS_V2 = Object.freeze([
  "schema",
  "worldSeed",
  "universeId",
  "locationId",
  "runtimeSessionId",
  "generatorHash",
  "contentHash",
  "terrainContentHash",
  "generationOptionsJson",
  "descriptorHash",
] as const);
const GENERATION_OPTION_KEYS = Object.freeze([
  "biomeScale",
  "caveFrequency",
  "enabledFactions",
  "largeTownFrequency",
  "profile",
  "resourceAbundance",
  "roadCoverage",
  "settlementClustering",
  "settlementDensity",
  "settlementPattern",
  "structures",
] as const);
const GENERATION_FACTIONS = Object.freeze([
  "hobbits",
  "goblins",
  "atlantians",
  "sugarcourt",
  "wood-elves",
  "dwarves",
] as const);
const MAX_GENERATION_OPTIONS_UTF8_BYTES = 16 * 1024;

export type RustMultiplayerRuntimeDescriptorV2 = Readonly<{
  schema: typeof RUST_MULTIPLAYER_RUNTIME_DESCRIPTOR_SCHEMA_V2;
  worldSeed: string;
  universeId: string;
  locationId: string;
  /** Must equal the surrounding WebRTC signal's sessionId. */
  runtimeSessionId: string;
  generatorHash: string;
  contentHash: string;
  /** Exact byte-affecting terrain registry fingerprint. */
  terrainContentHash: string;
  /** Canonical JSON containing every byte-affecting generation option. */
  generationOptionsJson: string;
  descriptorHash: string;
}>;

export type RustMultiplayerRuntimeDescriptorSourceV2 = Readonly<Omit<
  RustMultiplayerRuntimeDescriptorV2,
  "schema" | "descriptorHash"
>>;

export type RustMultiplayerAuthorityInterestInputV1 = Readonly<{
  sessionId: string;
  local: PeerIdentity;
  peer: PeerIdentity;
  role: MultiplayerRole;
}>;

export type RustMultiplayerAuthorityInterestV1 = (
  input: RustMultiplayerAuthorityInterestInputV1,
) => NetworkInterestSetV1;

export type RustMultiplayerAuthorityInterestSourceV1 = (
  input: RustMultiplayerAuthorityInterestInputV1,
) => NetworkInterestSetSourceV1;

/**
 * A guest factory returns an owned, already-started and attested runtime. The
 * caller must invoke shutdown on every terminal path, including validation or
 * signaling failure after the factory resolves.
 */
export type RustMultiplayerRuntimeBindingV2 = Readonly<{
  descriptor: RustMultiplayerRuntimeDescriptorV2;
  authority: RustMultiplayerAuthorityV1;
  interest: RustMultiplayerAuthorityInterestV1;
  shutdown: () => Promise<unknown>;
}>;

export type RustMultiplayerGuestAuthorityFactoryInputV2 = Readonly<{
  descriptor: RustMultiplayerRuntimeDescriptorV2;
  signal: AbortSignal;
}>;

export type RustMultiplayerGuestAuthorityFactoryV2 = (
  input: RustMultiplayerGuestAuthorityFactoryInputV2,
) => Promise<RustMultiplayerRuntimeBindingV2>;

export type RustMultiplayerRuntimeManagerPortV1 = Readonly<{
  activate(config: RustWorldRuntimeHostConfigV1): Promise<RustWorldRuntimeManagedHostV1>;
  shutdown(): Promise<unknown>;
}>;

export type RustMultiplayerGuestRuntimeBootstrapOptionsV2 = Readonly<{
  manager: RustMultiplayerRuntimeManagerPortV1;
  /** Local generator fingerprint. Offers naming another generator fail before startup. */
  generatorHash: string;
  /** Local terrain corpus fingerprint. Offers naming another corpus fail before startup. */
  terrainContentHash: string;
  waterBlockId: number;
  directionalBlockIds: readonly number[];
  waterloggedBlockIds: readonly number[];
  interest: RustMultiplayerAuthorityInterestSourceV1;
}>;

export class RustMultiplayerRuntimeBootstrapErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RustMultiplayerRuntimeBootstrapErrorV1";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length && actual.every((key, index) => key === canonical[index]);
}

function boundedUtf8(value: unknown, label: string, maximumBytes: number) {
  if (typeof value !== "string" || value.length === 0 || !value.isWellFormed()) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("invalid-descriptor", `${label} must be non-empty well-formed text`);
  }
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength > maximumBytes) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("invalid-descriptor", `${label} exceeds ${maximumBytes} UTF-8 bytes`);
  }
  return value;
}

function runtimeSessionId(value: unknown) {
  if (typeof value !== "string" || !SESSION_ID_PATTERN.test(value)) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("invalid-session", "runtimeSessionId must be a canonical multiplayer session ID");
  }
  return value;
}

function canonicalHash(value: unknown, label: string) {
  if (typeof value !== "string" || !CANONICAL_HASH_PATTERN.test(value)) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("invalid-fingerprint", `${label} must be a canonical lowercase 128-bit hash`);
  }
  return value;
}

function canonicalGenerationOptionsJson(value: unknown) {
  const generationOptionsJson = boundedUtf8(
    value,
    "generationOptionsJson",
    MAX_GENERATION_OPTIONS_UTF8_BYTES,
  );
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(generationOptionsJson)) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1(
      "invalid-generation-options",
      "generationOptionsJson contains control characters",
    );
  }
  let parsed: unknown;
  try { parsed = JSON.parse(generationOptionsJson); }
  catch {
    throw new RustMultiplayerRuntimeBootstrapErrorV1(
      "invalid-generation-options",
      "generationOptionsJson must be canonical JSON",
    );
  }
  const options = record(parsed);
  if (!options
    || !exactKeys(options, GENERATION_OPTION_KEYS)
    || JSON.stringify(Object.keys(options)) !== JSON.stringify(GENERATION_OPTION_KEYS)
    || JSON.stringify(options) !== generationOptionsJson) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1(
      "invalid-generation-options",
      "generationOptionsJson must have the exact canonical terrain option shape and order",
    );
  }
  const rounded = (candidate: unknown, minimum: number, maximum: number) => typeof candidate === "number"
    && Number.isFinite(candidate)
    && candidate >= minimum
    && candidate <= maximum
    && candidate === Math.round(candidate * 100) / 100;
  const factions = options.enabledFactions;
  if (!rounded(options.biomeScale, 0.25, 4)
    || !rounded(options.caveFrequency, 0, 3)
    || !rounded(options.resourceAbundance, 0.25, 4)
    || !rounded(options.settlementDensity, 0, 3)
    || (options.profile !== "legacy-v14" && options.profile !== "world-below-v15")
    || (options.settlementPattern !== "legacy-scattered-v1" && options.settlementPattern !== "heartlands-v2")
    || (options.settlementClustering !== "even" && options.settlementClustering !== "regional" && options.settlementClustering !== "strong")
    || (options.roadCoverage !== "none" && options.roadCoverage !== "local" && options.roadCoverage !== "regional" && options.roadCoverage !== "dense")
    || (options.largeTownFrequency !== "rare" && options.largeTownFrequency !== "balanced" && options.largeTownFrequency !== "frequent")
    || typeof options.structures !== "boolean"
    || !Array.isArray(factions)
    || factions.some((faction, index) => {
      if (typeof faction !== "string") return true;
      const position = GENERATION_FACTIONS.indexOf(faction as typeof GENERATION_FACTIONS[number]);
      const prior = index === 0
        ? -1
        : GENERATION_FACTIONS.indexOf(factions[index - 1] as typeof GENERATION_FACTIONS[number]);
      return position <= prior;
    })) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1(
      "invalid-generation-options",
      "generationOptionsJson contains unsupported or non-normalized terrain options",
    );
  }
  return generationOptionsJson;
}

function descriptorHashV2(source: RustMultiplayerRuntimeDescriptorSourceV2) {
  return new TypeScriptCanonicalHasher("blockwild-multiplayer-runtime-descriptor-v2")
    .writeU16(RUST_MULTIPLAYER_RUNTIME_DESCRIPTOR_SCHEMA_V2)
    .writeString(source.worldSeed)
    .writeString(source.universeId)
    .writeString(source.locationId)
    .writeString(source.runtimeSessionId)
    .writeString(source.generatorHash)
    .writeString(source.contentHash)
    .writeString(source.terrainContentHash)
    .writeString(source.generationOptionsJson)
    .finishHex();
}

export function createRustMultiplayerRuntimeDescriptorV2(
  source: RustMultiplayerRuntimeDescriptorSourceV2,
): RustMultiplayerRuntimeDescriptorV2 {
  const normalized: RustMultiplayerRuntimeDescriptorSourceV2 = Object.freeze({
    worldSeed: boundedUtf8(source.worldSeed, "worldSeed", 2_048),
    universeId: boundedUtf8(source.universeId, "universeId", 64),
    locationId: boundedUtf8(source.locationId, "locationId", 128),
    runtimeSessionId: runtimeSessionId(source.runtimeSessionId),
    generatorHash: canonicalHash(source.generatorHash, "generatorHash"),
    contentHash: canonicalHash(source.contentHash, "contentHash"),
    terrainContentHash: canonicalHash(source.terrainContentHash, "terrainContentHash"),
    generationOptionsJson: canonicalGenerationOptionsJson(source.generationOptionsJson),
  });
  return Object.freeze({
    schema: RUST_MULTIPLAYER_RUNTIME_DESCRIPTOR_SCHEMA_V2,
    ...normalized,
    descriptorHash: descriptorHashV2(normalized),
  });
}

export function parseRustMultiplayerRuntimeDescriptorV2(
  value: unknown,
): RustMultiplayerRuntimeDescriptorV2 {
  const source = record(value);
  if (!source || !exactKeys(source, DESCRIPTOR_KEYS_V2)
    || source.schema !== RUST_MULTIPLAYER_RUNTIME_DESCRIPTOR_SCHEMA_V2) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("invalid-descriptor", "Rust multiplayer runtime descriptor has a non-canonical shape");
  }
  const normalized = createRustMultiplayerRuntimeDescriptorV2({
    worldSeed: source.worldSeed as string,
    universeId: source.universeId as string,
    locationId: source.locationId as string,
    runtimeSessionId: source.runtimeSessionId as string,
    generatorHash: source.generatorHash as string,
    contentHash: source.contentHash as string,
    terrainContentHash: source.terrainContentHash as string,
    generationOptionsJson: source.generationOptionsJson as string,
  });
  if (source.descriptorHash !== normalized.descriptorHash) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("descriptor-hash", "Rust multiplayer runtime descriptor hash does not match its canonical fields");
  }
  return normalized;
}

export function validateRustMultiplayerRuntimeDescriptorV2(
  value: unknown,
): value is RustMultiplayerRuntimeDescriptorV2 {
  try { parseRustMultiplayerRuntimeDescriptorV2(value); return true; }
  catch { return false; }
}

export function rustMultiplayerRuntimeDescriptorEqualsV2(
  left: RustMultiplayerRuntimeDescriptorV2,
  right: RustMultiplayerRuntimeDescriptorV2,
) {
  return DESCRIPTOR_KEYS_V2.every((key) => left[key] === right[key]);
}

function requireAuthorityAddress(
  authority: RustMultiplayerAuthorityV1,
  descriptor: RustMultiplayerRuntimeDescriptorV2,
) {
  let identity: ReturnType<RustMultiplayerAuthorityV1["currentIdentity"]>;
  try { identity = authority.currentIdentity(); }
  catch (error) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1(
      "authority-not-ready",
      `Rust multiplayer authority identity is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (identity.address.universeId !== descriptor.universeId
    || identity.address.locationId !== descriptor.locationId) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("address-mismatch", "Rust authority address does not match the advertised runtime descriptor");
  }
}

export function canonicalizeRustMultiplayerRuntimeBindingV2(
  value: RustMultiplayerRuntimeBindingV2,
  expected?: RustMultiplayerRuntimeDescriptorV2,
): RustMultiplayerRuntimeBindingV2 {
  const descriptor = parseRustMultiplayerRuntimeDescriptorV2(value?.descriptor);
  if (expected && !rustMultiplayerRuntimeDescriptorEqualsV2(descriptor, expected)) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("runtime-mismatch", "Started Rust runtime does not match the host's advertised descriptor");
  }
  if (!value.authority || value.authority.backend !== "rust-wasm-worker"
    || typeof value.interest !== "function" || typeof value.shutdown !== "function") {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("invalid-binding", "Guest factory did not return a complete Rust authority binding");
  }
  requireAuthorityAddress(value.authority, descriptor);
  return Object.freeze({ descriptor, authority: value.authority, interest: value.interest, shutdown: value.shutdown });
}

function requireReadyIdentity(
  identity: RustIntegratedRuntimeIdentityV1 | null,
  config: RustWorldRuntimeHostConfigV1,
) {
  if (!identity || identity.universeId !== config.universeId || identity.locationId !== config.locationId) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("address-mismatch", "Ready Rust runtime identity does not match its configured world address");
  }
}

/** Builds the signal descriptor only from a fully attested managed host. */
export function describeReadyRustMultiplayerRuntimeV2(
  host: RustWorldRuntimeManagedHostV1,
): RustMultiplayerRuntimeDescriptorV2 {
  const diagnostics = host.diagnostics();
  if (diagnostics.state !== "ready" || !diagnostics.adapter?.authoritative || !diagnostics.adapter.contentReady) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("runtime-not-ready", "Rust world runtime is not authoritative and content-ready");
  }
  requireReadyIdentity(diagnostics.identity, host.config);
  const contentHash = canonicalHash(diagnostics.contentHash, "contentHash");
  const generatorHash = canonicalHash(diagnostics.generatorHash, "generatorHash");
  const terrainContentHash = canonicalHash(host.config.terrainContentHash, "terrainContentHash");
  const generationOptionsJson = canonicalGenerationOptionsJson(host.config.generationOptionsJson);
  if (generatorHash !== host.config.generatorHash
    || diagnostics.adapter.contentManifestHash !== contentHash) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("fingerprint-mismatch", "Rust runtime attestation does not match its configured fingerprints");
  }
  const descriptor = createRustMultiplayerRuntimeDescriptorV2({
    worldSeed: host.config.worldSeed,
    universeId: host.config.universeId,
    locationId: host.config.locationId,
    runtimeSessionId: host.config.sessionId,
    generatorHash,
    contentHash,
    terrainContentHash,
    generationOptionsJson,
  });
  requireAuthorityAddress(host.multiplayerAuthority(), descriptor);
  return descriptor;
}

function requireInterestAddress(
  interest: NetworkInterestSetV1,
  descriptor: RustMultiplayerRuntimeDescriptorV2,
) {
  for (const chunk of interest.chunks) {
    if (chunk.universeId !== descriptor.universeId || chunk.locationId !== descriptor.locationId) {
      throw new RustMultiplayerRuntimeBootstrapErrorV1("interest-address", "Rust multiplayer interest escaped the attested runtime address");
    }
  }
  return interest;
}

/** Converts an already-ready managed host into a checked multiplayer binding. */
export function bindReadyRustMultiplayerRuntimeV2(
  host: RustWorldRuntimeManagedHostV1,
  interestSource: RustMultiplayerAuthorityInterestSourceV1,
): RustMultiplayerRuntimeBindingV2 {
  const descriptor = describeReadyRustMultiplayerRuntimeV2(host);
  const authority = host.multiplayerAuthority();
  const interest: RustMultiplayerAuthorityInterestV1 = (input) => {
    if (input.sessionId !== descriptor.runtimeSessionId) {
      throw new RustMultiplayerRuntimeBootstrapErrorV1("session-mismatch", "Interest request belongs to another Rust runtime session");
    }
    return requireInterestAddress(host.authorityInterest(interestSource(input)), descriptor);
  };
  return canonicalizeRustMultiplayerRuntimeBindingV2({
    descriptor,
    authority,
    interest,
    shutdown: () => host.shutdown(),
  });
}

function normalizedBlockIds(values: readonly number[], label: string) {
  const normalized = [...new Set(values)];
  for (const value of normalized) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new RustMultiplayerRuntimeBootstrapErrorV1("invalid-runtime-config", `${label} contains an invalid block id`);
    }
  }
  return Object.freeze(normalized.sort((left, right) => left - right));
}

/**
 * Creates a single-owner guest bootstrap around the active runtime manager.
 * The local content attestation and generator fingerprint must exactly match
 * the host offer before the returned authority can negotiate a handshake.
 */
export function createRustMultiplayerGuestAuthorityFactoryV2(
  options: RustMultiplayerGuestRuntimeBootstrapOptionsV2,
): RustMultiplayerGuestAuthorityFactoryV2 {
  const generatorHash = canonicalHash(options.generatorHash, "generatorHash");
  const terrainContentHash = canonicalHash(options.terrainContentHash, "terrainContentHash");
  if (!Number.isInteger(options.waterBlockId) || options.waterBlockId < 0 || options.waterBlockId > 0xffff) {
    throw new RustMultiplayerRuntimeBootstrapErrorV1("invalid-runtime-config", "waterBlockId is invalid");
  }
  const directionalBlockIds = normalizedBlockIds(options.directionalBlockIds, "directionalBlockIds");
  const waterloggedBlockIds = normalizedBlockIds(options.waterloggedBlockIds, "waterloggedBlockIds");
  let starting = false;
  let active = false;

  return async ({ descriptor: offered, signal }) => {
    const descriptor = parseRustMultiplayerRuntimeDescriptorV2(offered);
    if (signal.aborted) throw new RustMultiplayerRuntimeBootstrapErrorV1("cancelled", "Rust guest runtime startup was cancelled");
    if (starting || active) throw new RustMultiplayerRuntimeBootstrapErrorV1("concurrent-start", "Rust guest runtime bootstrap already owns a runtime");
    if (descriptor.generatorHash !== generatorHash) {
      throw new RustMultiplayerRuntimeBootstrapErrorV1("generator-mismatch", "Host and guest generator fingerprints differ");
    }
    if (descriptor.terrainContentHash !== terrainContentHash) {
      throw new RustMultiplayerRuntimeBootstrapErrorV1("terrain-content-mismatch", "Host and guest terrain corpus fingerprints differ");
    }

    starting = true;
    let activated = false;
    try {
      const host = await options.manager.activate(Object.freeze({
        worldSeed: descriptor.worldSeed,
        universeId: descriptor.universeId,
        locationId: descriptor.locationId,
        sessionId: descriptor.runtimeSessionId,
        generatorHash,
        terrainContentHash,
        generationOptionsJson: descriptor.generationOptionsJson,
        waterBlockId: options.waterBlockId,
        directionalBlockIds,
        waterloggedBlockIds,
      }));
      activated = true;
      if (signal.aborted) throw new RustMultiplayerRuntimeBootstrapErrorV1("cancelled", "Rust guest runtime startup was cancelled");
      const ready = bindReadyRustMultiplayerRuntimeV2(host, options.interest);
      if (!rustMultiplayerRuntimeDescriptorEqualsV2(ready.descriptor, descriptor)) {
        throw new RustMultiplayerRuntimeBootstrapErrorV1("runtime-mismatch", "Guest Rust runtime attestation differs from the host offer");
      }
      active = true;
      let shutdown = false;
      return canonicalizeRustMultiplayerRuntimeBindingV2({
        descriptor: ready.descriptor,
        authority: ready.authority,
        interest: ready.interest,
        shutdown: async () => {
          if (shutdown) return;
          shutdown = true;
          active = false;
          await options.manager.shutdown();
        },
      }, descriptor);
    } catch (error) {
      if (activated) {
        try { await options.manager.shutdown(); }
        catch { /* Preserve the startup, cancellation, or attestation failure. */ }
      }
      throw error;
    } finally {
      starting = false;
    }
  };
}
