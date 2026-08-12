import {
  requireBlockwildProductionContent,
  type RustContentArtifact,
} from "./rust-integrated-runtime-content.ts";
import type {
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
} from "./rust-integrated-runtime-contract.ts";
import {
  PLAYER_RENDER_MODEL_ID_V1,
  PLAYER_RENDER_PROFILE_ID_V1,
  loadAttestedPlayerRenderProfileV1,
  type AttestedPlayerRenderProfileV1,
} from "./rust-player-render-profile.ts";
import {
  RustEntityRenderExtractionR10,
  type RenderEntityModelAttestationR10,
} from "./rust-render-entity-extraction-r10.ts";
import {
  createProductionHeldEquipmentModelsR10,
  RustPresentationEntityExtractionR10,
  type RustPresentationExtractionDiagnosticsR10,
} from "./rust-render-presentation-extraction-r10.ts";
import {
  loadAttestedRenderPresentationCatalogV1,
  RENDER_PRESENTATION_CATALOG_ID_V1,
  RENDER_PRESENTATION_CATALOG_SCHEMA_ID_V1,
  RENDER_PRESENTATION_CATALOG_SCHEMA_V1,
  type AttestedRenderPresentationCatalogV1,
} from "./rust-render-presentation-profile.ts";
import {
  RustRenderSceneComposerR10,
  type RenderSceneExtractionSinkR10,
  type RenderRuntimeFrameContextR10,
  type RustRenderSceneComposerOptionsR10,
} from "./rust-render-scene-composer-r10.ts";

const U64_MAX = BigInt("0xffffffffffffffff");
const CONTENT_HASH = /^[0-9a-f]{32}$/u;

/** One live composer may feed a renderer sink at a time. */
const LIVE_SINK_LEASES_R10 = new WeakMap<object, symbol>();

export type RustLiveRenderRuntimeStateR10 = "starting" | "ready" | "disposed" | "failed";

export type RustLiveRenderRuntimeOptionsR10 = Readonly<{
  sink: RenderSceneExtractionSinkR10;
  epoch: bigint;
  worldGeneration: number;
  expectedContentManifestHash?: string;
  manifestUrl?: string;
  fetch?: typeof globalThis.fetch;
  profileLoader?: typeof loadAttestedPlayerRenderProfileV1;
  presentationLoader?: typeof loadAttestedRenderPresentationCatalogV1;
  contentFactory?: typeof requireBlockwildProductionContent;
  maxInstances?: RustRenderSceneComposerOptionsR10["maxInstances"];
  maxParticles?: RustRenderSceneComposerOptionsR10["maxParticles"];
  maxResourceOperations?: RustRenderSceneComposerOptionsR10["maxResourceOperations"];
  maxKnownResourcesPerSource?: RustRenderSceneComposerOptionsR10["maxKnownResourcesPerSource"];
  maxResidentResources?: RustRenderSceneComposerOptionsR10["maxResidentResources"];
  maxEntityTickLag?: RustRenderSceneComposerOptionsR10["maxEntityTickLag"];
}>;

export type RustLiveRenderRuntimeDiagnosticsR10 = Readonly<{
  schema: 1;
  state: RustLiveRenderRuntimeStateR10;
  epoch: bigint;
  worldGeneration: number;
  ownsSinkLease: boolean;
  accepting: boolean;
  inFlightSubmissions: number;
  submittedExtractions: number;
  rejectedExtractions: number;
  modelAttestations: number;
  heldEquipmentModels: number;
  contentManifestHash: string | null;
  modelCatalogHash: string | null;
  modelCatalogRevision: bigint | null;
  lastExtractionRevision: bigint | null;
  lastAuthorityTick: bigint | null;
  lastFrameSequence: bigint | null;
  lastError: string | null;
  presentation: RustPresentationExtractionDiagnosticsR10 | null;
  composer: ReturnType<RustRenderSceneComposerR10["diagnostics"]> | null;
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function exactEpoch(value: bigint) {
  invariant(value > BigInt(0) && value <= U64_MAX, "live render epoch is not a positive u64");
  return value;
}

function exactGeneration(value: number) {
  invariant(Number.isSafeInteger(value) && value >= 0, "live render world generation is invalid");
  return value;
}

function hex16(value: string, label: string) {
  invariant(CONTENT_HASH.test(value), `${label} is not a lowercase 128-bit hash`);
  return Uint8Array.from(value.match(/../gu)!.map((part) => Number.parseInt(part, 16)));
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    invariant(Number.isFinite(value), "presentation content contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  invariant(typeof value === "object", "presentation content contains an unsupported value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function contentArtifactKey(artifact: RustContentArtifact) {
  return `${artifact.domain}:${artifact.id}`;
}

/**
 * Derive only identities that both authorities publish: creature/player
 * models use their owning profiles, while dropped-item models use the distinct
 * attested render-presentation catalog. Unmatched roles receive no identity.
 */
export function createProductionRenderModelAttestationsR10(
  profile: AttestedPlayerRenderProfileV1,
  presentations: AttestedRenderPresentationCatalogV1,
  artifacts: readonly RustContentArtifact[],
) {
  const presentationArtifact = attestProductionRenderPresentationsR10(profile, presentations, artifacts);
  const models = new Set(profile.catalog.models.map((model) => model.modelId));
  const artifactKeys = new Set<string>();
  const attestations = new Map<string, RenderEntityModelAttestationR10>();
  let playerArtifact: RustContentArtifact | null = null;

  const installAttestation = (modelKey: string, artifact: RustContentArtifact) => {
    invariant(artifact.contentVersion > 0 && Number.isSafeInteger(artifact.contentVersion),
      `content revision for render model '${modelKey}' is invalid`);
    const candidate = Object.freeze({
      modelKey,
      revision: artifact.contentVersion,
      contentHash: hex16(artifact.blobHash, `content hash for render model '${modelKey}'`),
    });
    const existing = attestations.get(modelKey);
    invariant(existing === undefined || (existing.revision === candidate.revision
      && equalBytes(existing.contentHash, candidate.contentHash)),
    `render model '${modelKey}' has ambiguous content identities`);
    attestations.set(modelKey, candidate);
  };

  for (const artifact of artifacts) {
    const key = contentArtifactKey(artifact);
    invariant(!artifactKeys.has(key), `duplicate production content artifact '${key}'`);
    artifactKeys.add(key);
    if (artifact.domain !== "creature-profile") continue;
    if (artifact.id === PLAYER_RENDER_PROFILE_ID_V1) playerArtifact = artifact;
    if (!models.has(artifact.id)) continue;
    installAttestation(artifact.id, artifact);
  }

  invariant(playerArtifact !== null, "production content has no attested player render profile");
  invariant(models.has(PLAYER_RENDER_MODEL_ID_V1), "attested BWM2 has no production player model");
  invariant(playerArtifact.contentVersion > 0 && Number.isSafeInteger(playerArtifact.contentVersion),
    "production player render content revision is invalid");
  invariant(!attestations.has(PLAYER_RENDER_MODEL_ID_V1), "production player model attestation is ambiguous");
  installAttestation(PLAYER_RENDER_MODEL_ID_V1, playerArtifact);

  for (const presentation of presentations.profileCatalog.profiles) {
    if (presentation.role !== "dropped-item") continue;
    invariant(presentations.modelsByProfileId.get(presentation.id)?.modelId === presentation.model.id,
      `dropped presentation '${presentation.id}' has no exact attested BWM2 model`);
    invariant(models.has(presentation.model.id),
      `dropped presentation '${presentation.id}' references a model outside the attested BWM2 catalog`);
    installAttestation(presentation.model.id, presentationArtifact);
  }

  return Object.freeze([...attestations.values()].sort((left, right) => left.modelKey.localeCompare(right.modelKey)));
}

function attestProductionRenderPresentationsR10(
  profile: AttestedPlayerRenderProfileV1,
  presentations: AttestedRenderPresentationCatalogV1,
  artifacts: readonly RustContentArtifact[],
) {
  const left = profile.catalog;
  const right = presentations.modelCatalog;
  invariant(left.revision === right.revision
    && left.contentSha256 === right.contentSha256
    && left.catalogHashHex === right.catalogHashHex
    && left.byteLength === right.byteLength
    && left.nodeCount === right.nodeCount
    && left.models.length === right.models.length,
  "player and presentation loaders did not attest the same BWM2 catalog");
  const candidates = artifacts.filter((artifact) => artifact.domain === "machine-profile"
    && artifact.id === RENDER_PRESENTATION_CATALOG_ID_V1);
  invariant(candidates.length === 1, "production content has no unique render presentation catalog");
  const artifact = candidates[0];
  invariant(artifact.schemaId === RENDER_PRESENTATION_CATALOG_SCHEMA_ID_V1
    && artifact.schemaVersion === RENDER_PRESENTATION_CATALOG_SCHEMA_V1
    && artifact.contentVersion === 1,
  "production render presentation catalog schema is unsupported");
  let installed: unknown;
  try {
    installed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(artifact.canonicalBytes));
  } catch {
    throw new TypeError("production render presentation catalog bytes are not canonical JSON");
  }
  invariant(canonicalJson(installed) === canonicalJson(presentations.profileCatalog),
    "production render presentation content differs from the attested registry");
  return artifact;
}

/**
 * World-scoped owner for the verified BWM2 entity compiler and the one global
 * R10 scene composer that combines Rust runtime extraction with terrain.
 */
export class RustLiveRenderRuntimeR10 {
  readonly epoch: bigint;
  readonly worldGeneration: number;
  readonly terrain: RenderSceneExtractionSinkR10;

  private readonly sink: RenderSceneExtractionSinkR10;
  private readonly lease = Symbol("rust-live-render-runtime-r10");
  private readonly startup: Promise<void>;
  private submissionTail: Promise<unknown> = Promise.resolve();
  private disposePromise: Promise<void> | null = null;
  private stateValue: RustLiveRenderRuntimeStateR10 = "starting";
  private accepting = true;
  private leaseOwned = false;
  private composer: RustRenderSceneComposerR10 | null = null;
  private extractor: RustPresentationEntityExtractionR10 | null = null;
  private inFlightSubmissions = 0;
  private submittedExtractions = 0;
  private rejectedExtractions = 0;
  private modelAttestations = 0;
  private heldEquipmentModels = 0;
  private contentManifestHash: string | null = null;
  private modelCatalogHash: string | null = null;
  private modelCatalogRevision: bigint | null = null;
  private lastExtractionRevision: bigint | null = null;
  private lastAuthorityTick: bigint | null = null;
  private lastFrameSequence: bigint | null = null;
  private lastAnimationTimeMicros: bigint | null = null;
  private lastError: string | null = null;

  private constructor(private readonly options: RustLiveRenderRuntimeOptionsR10) {
    this.sink = options.sink;
    invariant(typeof this.sink === "object" && this.sink !== null, "live render sink is invalid");
    this.epoch = exactEpoch(options.epoch);
    this.worldGeneration = exactGeneration(options.worldGeneration);
    invariant(!LIVE_SINK_LEASES_R10.has(this.sink), "renderer sink already has an active Rust scene composer");
    LIVE_SINK_LEASES_R10.set(this.sink, this.lease);
    this.leaseOwned = true;

    this.terrain = this.createTerrainFacade();
    this.startup = this.initialize();
  }

  static async create(options: RustLiveRenderRuntimeOptionsR10) {
    const runtime = new RustLiveRenderRuntimeR10(options);
    await runtime.ready();
    return runtime;
  }

  get state() { return this.stateValue; }

  async ready() {
    await this.startup;
    invariant(this.stateValue === "ready", `live render runtime is ${this.stateValue}`);
    return this;
  }

  async submitRuntimeExtraction(
    worldGeneration: number,
    extraction: RustIntegratedRuntimeExtractionV1,
    context: RenderRuntimeFrameContextR10,
  ): Promise<boolean> {
    this.requireGeneration(worldGeneration);
    this.requireAccepting();
    this.inFlightSubmissions += 1;
    const operation = this.submissionTail.then(() => {
      const composer = this.requireComposerForAcceptedWork();
      this.validateAuthoritativeContext(extraction, context);
      const extractor = this.extractor;
      invariant(extractor !== null, "live render presentation extractor is unavailable");
      const token = extractor.prepareRuntimeExtraction(extraction);
      let accepted = false;
      try {
        accepted = composer.submitRuntimeExtraction(extraction, context);
      } finally {
        extractor.finishPreparedRuntimeExtraction(token, accepted);
      }
      if (accepted) {
        this.submittedExtractions += 1;
        this.lastExtractionRevision = BigInt(extraction.extractionRevision);
        this.lastAuthorityTick = context.simulationTick;
        this.lastFrameSequence = context.frameSequence;
        this.lastAnimationTimeMicros = context.animationTimeMicros;
      } else {
        this.rejectedExtractions += 1;
      }
      return accepted;
    });
    this.submissionTail = operation.then(
      () => { this.inFlightSubmissions -= 1; },
      (error) => {
        this.inFlightSubmissions -= 1;
        this.rejectedExtractions += 1;
        this.lastError = errorText(error);
      },
    );
    return operation;
  }

  resize(worldGeneration: number, width: number, height: number) {
    this.requireGeneration(worldGeneration);
    this.requireComposer().resize(width, height);
  }

  armRequiredView(
    worldGeneration: number,
    expectedExternalEntityId: string,
    view: RustIntegratedRuntimeExtractionViewV1,
  ) {
    this.requireGeneration(worldGeneration);
    return this.requireComposer().armRequiredView(expectedExternalEntityId, view);
  }

  requestRecovery(worldGeneration: number, reason?: string) {
    this.requireGeneration(worldGeneration);
    return this.requireComposer().requestRecovery(reason);
  }

  resetRendererStore(worldGeneration: number, reason?: string) {
    this.requireGeneration(worldGeneration);
    return this.requireComposer().resetRendererStore(reason);
  }

  metadata(worldGeneration: number) {
    this.requireGeneration(worldGeneration);
    const composer = this.requireComposer();
    return Object.freeze({
      entity: composer.entityMetadata(),
      authoritative: composer.authoritativeMetadata(),
    });
  }

  async drain() {
    await this.startup;
    await this.submissionTail;
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.accepting = false;
    this.disposePromise = (async () => {
      try { await this.startup; } catch { /* Initialization already recorded the failure and released its lease. */ }
      await this.submissionTail;
      this.composer = null;
      this.extractor = null;
      this.releaseLease();
      this.stateValue = "disposed";
    })();
    return this.disposePromise;
  }

  diagnostics(): RustLiveRenderRuntimeDiagnosticsR10 {
    return Object.freeze({
      schema: 1,
      state: this.stateValue,
      epoch: this.epoch,
      worldGeneration: this.worldGeneration,
      ownsSinkLease: this.leaseOwned,
      accepting: this.accepting,
      inFlightSubmissions: this.inFlightSubmissions,
      submittedExtractions: this.submittedExtractions,
      rejectedExtractions: this.rejectedExtractions,
      modelAttestations: this.modelAttestations,
      heldEquipmentModels: this.heldEquipmentModels,
      contentManifestHash: this.contentManifestHash,
      modelCatalogHash: this.modelCatalogHash,
      modelCatalogRevision: this.modelCatalogRevision,
      lastExtractionRevision: this.lastExtractionRevision,
      lastAuthorityTick: this.lastAuthorityTick,
      lastFrameSequence: this.lastFrameSequence,
      lastError: this.lastError,
      presentation: this.extractor?.diagnostics() ?? null,
      composer: this.composer?.diagnostics() ?? null,
    });
  }

  private async initialize() {
    try {
      const loader = this.options.profileLoader ?? loadAttestedPlayerRenderProfileV1;
      const presentationLoader = this.options.presentationLoader ?? loadAttestedRenderPresentationCatalogV1;
      const [profile, presentations] = await Promise.all([
        loader({ manifestUrl: this.options.manifestUrl, fetch: this.options.fetch }),
        presentationLoader({ manifestUrl: this.options.manifestUrl, fetch: this.options.fetch }),
      ]);
      const content = (this.options.contentFactory ?? requireBlockwildProductionContent)();
      invariant(content.report.ok, "production Rust content is not fully attested");
      const manifestHash = content.manifest.manifestHash;
      hex16(manifestHash, "production content manifest hash");
      if (this.options.expectedContentManifestHash !== undefined) {
        invariant(this.options.expectedContentManifestHash === manifestHash,
          "live renderer content manifest differs from the active Rust runtime");
      }
      const presentationArtifact = attestProductionRenderPresentationsR10(profile, presentations, content.artifacts);
      const attestations = createProductionRenderModelAttestationsR10(profile, presentations, content.artifacts);
      const equipmentModels = createProductionHeldEquipmentModelsR10(presentations);
      const entityExtractor = new RustEntityRenderExtractionR10({
        catalog: profile.catalog,
        expectedContentManifestHash: hex16(manifestHash, "production content manifest hash"),
        modelAttestations: attestations,
        equipmentModels,
        maxInstances: this.options.maxInstances,
        maxResourceOperations: this.options.maxResourceOperations,
      });
      const extractor = new RustPresentationEntityExtractionR10(entityExtractor, presentations, {
        contentVersion: presentationArtifact.contentVersion,
        contentHash: hex16(presentationArtifact.blobHash, "production render presentation content hash"),
      }, {
        maxInstances: this.options.maxInstances,
        maxResourceOperations: this.options.maxResourceOperations,
      });
      const composer = new RustRenderSceneComposerR10({
        sink: this.sink,
        epoch: this.epoch,
        trustedContentManifestHash: hex16(manifestHash, "production content manifest hash"),
        trustedModelCatalogHash: profile.catalog.catalogHashHex,
        trustedModelCatalogRevision: profile.catalog.revision,
        entityExtractor: extractor,
        maxInstances: this.options.maxInstances,
        maxParticles: this.options.maxParticles,
        maxResourceOperations: this.options.maxResourceOperations,
        maxKnownResourcesPerSource: this.options.maxKnownResourcesPerSource,
        maxResidentResources: this.options.maxResidentResources,
        maxEntityTickLag: this.options.maxEntityTickLag,
      });
      invariant(this.accepting, "live render runtime was disposed during startup");
      this.extractor = extractor;
      this.composer = composer;
      this.modelAttestations = attestations.length;
      this.heldEquipmentModels = equipmentModels.length;
      this.contentManifestHash = manifestHash;
      this.modelCatalogHash = profile.catalog.catalogHashHex;
      this.modelCatalogRevision = profile.catalog.revision;
      this.stateValue = "ready";
    } catch (error) {
      this.stateValue = "failed";
      this.accepting = false;
      this.lastError = errorText(error);
      this.releaseLease();
      throw error;
    }
  }

  private createTerrainFacade(): RenderSceneExtractionSinkR10 {
    return Object.freeze({
      resources: (batch) => this.requireComposer().resources(batch),
      frame: (frame) => this.requireComposer().frame(frame),
      resize: (width, height) => this.requireComposer().resize(width, height),
      requestRecovery: (reason) => this.requireComposer().requestRecovery(reason),
      diagnostics: () => this.diagnostics(),
    });
  }

  private requireGeneration(value: number) {
    exactGeneration(value);
    if (value < this.worldGeneration) throw new Error("stale live render world generation");
    if (value > this.worldGeneration) throw new Error("future live render world generation");
  }

  private requireAccepting() {
    if (!this.accepting || this.stateValue === "disposed") throw new Error("live render runtime is disposed");
    if (this.stateValue !== "ready") throw new Error(`live render runtime is ${this.stateValue}`);
    invariant(LIVE_SINK_LEASES_R10.get(this.sink) === this.lease, "live render runtime lost its renderer sink lease");
  }

  private requireComposer() {
    this.requireAccepting();
    invariant(this.composer !== null, "live render scene composer is unavailable");
    return this.composer;
  }

  /** Accepted queued work is allowed to finish after disposal stops new calls. */
  private requireComposerForAcceptedWork() {
    invariant(this.stateValue === "ready" && this.composer !== null,
      `live render runtime cannot finish accepted work while ${this.stateValue}`);
    invariant(LIVE_SINK_LEASES_R10.get(this.sink) === this.lease, "live render runtime lost its renderer sink lease");
    return this.composer;
  }

  private validateAuthoritativeContext(
    extraction: RustIntegratedRuntimeExtractionV1,
    context: RenderRuntimeFrameContextR10,
  ) {
    invariant(context.epoch === this.epoch, "runtime extraction context epoch does not match its world composer");
    invariant(Number.isSafeInteger(extraction.identity.tick) && extraction.identity.tick >= 0,
      "runtime extraction authority tick is invalid");
    invariant(context.simulationTick === BigInt(extraction.identity.tick),
      "runtime extraction context tick does not match Rust authority");
    invariant(Number.isSafeInteger(extraction.extractionRevision) && extraction.extractionRevision >= 0,
      "runtime extraction revision is invalid");
    invariant(context.frameSequence > BigInt(0) && context.frameSequence <= U64_MAX,
      "runtime extraction frame sequence is invalid");
    invariant(context.animationTimeMicros >= BigInt(0) && context.animationTimeMicros <= U64_MAX,
      "runtime extraction animation time is invalid");
    if (this.lastFrameSequence !== null) {
      invariant(context.frameSequence > this.lastFrameSequence, "stale runtime extraction frame sequence");
      invariant(context.simulationTick >= this.lastAuthorityTick!, "stale runtime extraction authority tick");
      invariant(context.animationTimeMicros >= this.lastAnimationTimeMicros!, "stale runtime extraction animation time");
      invariant(BigInt(extraction.extractionRevision) >= this.lastExtractionRevision!, "stale runtime extraction revision");
    }
  }

  private releaseLease() {
    if (!this.leaseOwned) return;
    if (LIVE_SINK_LEASES_R10.get(this.sink) === this.lease) LIVE_SINK_LEASES_R10.delete(this.sink);
    this.leaseOwned = false;
  }
}

export function createRustLiveRenderRuntimeR10(options: RustLiveRenderRuntimeOptionsR10) {
  return RustLiveRenderRuntimeR10.create(options);
}
