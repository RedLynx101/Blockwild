import type { StructureMarker } from "./structures";
import {
  GENERATED_CHUNK_SCHEMA_V2,
  GENERATE_CHUNK_REQUEST_SCHEMA_V2,
  LEGACY_TERRAIN_CONTENT_HASH_V2,
  TERRAIN_GENERATION_PROTOCOL_V2,
  TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1,
  TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1,
  TERRAIN_LOCATOR_PROMOTION_MINIMUM_LAIR_CASES_V1,
  TERRAIN_LOCATOR_PROMOTION_MINIMUM_SETTLEMENT_CASES_V1,
  TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1,
  TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
  assertGeneratedChunkMatchesRequestV2,
  createDragonLairLocatorRequestV1,
  createGenerateChunkRequestV2,
  createSettlementLocatorRequestV1,
  decodeTerrainGenerationMarkerTableV2,
  generateChunkRequestTransferListV2,
  generatedChunkTransferListV2,
  hashTerrainGenerationIdentityV2,
  legacyTerrainGeneratorHashV2,
  stableTerrainGenerationJsonV2,
  type GeneratedChunkV2,
  type DragonLairLocatorRequestV1,
  type DragonLairLocatorResultV1,
  type GenerateChunkRequestV2,
  type SettlementLocatorRequestV1,
  type SettlementLocatorResultV1,
  type TerrainDragonSurveyTypeV1,
  type TerrainSettlementEnvironmentV1,
  type TerrainSettlementFactionV1,
  type TerrainSettlementSizeV1,
  type TerrainGenerationEditPair,
  type TerrainGenerationWorkerRequestV2,
  type TerrainGenerationWorkerResponseV2,
} from "./terrain-generation-contract";
import {
  configuredTerrainGenerationAuthorityV2,
  type TerrainGenerationAuthoritySelectionV2,
} from "./terrain-generation-authority";

export type TerrainGenerationRequest = Readonly<{
  namespace: string;
  seedText: string;
  generationOptions: Readonly<Record<string, unknown>>;
  key: string;
  cx: number;
  cz: number;
  edits: readonly TerrainGenerationEditPair[];
  /** Future Rust callers may supply explicit authority metadata. */
  epoch?: number;
  revision?: number;
  contentHash?: string;
  generatorHash?: string;
}>;

/** Compatibility view consumed by ChunkWorld's exact installation seam. */
export type TerrainGenerationResult = GeneratedChunkV2 & Readonly<{
  structureMarkers: readonly (readonly [string, StructureMarker])[];
}>;

export interface TerrainGenerationWorkerLike {
  onmessage: ((event: MessageEvent<TerrainGenerationWorkerResponseV2>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  postMessage(message: TerrainGenerationWorkerRequestV2, transfer?: Transferable[]): void;
  terminate(): void;
}

export type TerrainGenerationPipelineOptions = Readonly<{
  workerFactory?: () => TerrainGenerationWorkerLike;
  taskTimeoutMilliseconds?: number;
  startupTimeoutMilliseconds?: number;
  authoritySelection?: TerrainGenerationAuthoritySelectionV2;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}>;

type WorkerCallback = Readonly<{
  kind: "chunk";
  request: GenerateChunkRequestV2;
  complete: (result: TerrainGenerationResult) => void;
  fail: (error?: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> | Readonly<{
  kind: "settlement";
  request: SettlementLocatorRequestV1;
  complete: (result: SettlementLocatorResultV1) => void;
  fail: (error?: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> | Readonly<{
  kind: "lair";
  request: DragonLairLocatorRequestV1;
  complete: (result: DragonLairLocatorResultV1) => void;
  fail: (error?: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>;

type TerrainLocatorAuthorityRequest = Readonly<{
  namespace: string;
  seedText: string;
  generationOptions: Readonly<Record<string, unknown>>;
  contentHash?: string;
  generatorHash?: string;
}>;

export type TerrainSettlementLocatorQuery = TerrainLocatorAuthorityRequest & Readonly<{
  origin: Readonly<{ x: number; z: number }>;
  factionIds?: readonly TerrainSettlementFactionV1[];
  sizes?: readonly TerrainSettlementSizeV1[];
  environments?: readonly TerrainSettlementEnvironmentV1[];
  excludeIds?: ReadonlySet<string> | readonly string[];
  maxRegionRadius?: number;
  limit?: number;
  breathesWater?: boolean;
}>;

export type TerrainDragonLairLocatorQuery = TerrainLocatorAuthorityRequest & Readonly<{
  origin: Readonly<{ x: number; z: number }>;
  dragonType: TerrainDragonSurveyTypeV1;
  minimumStage: 3 | 4 | 5;
  excludeIds?: ReadonlySet<string> | readonly string[];
  maxRegionRadius?: number;
}>;

type Slot = {
  worker: TerrainGenerationWorkerLike;
  ready: boolean;
  busy: boolean;
  currentId: number | null;
  generation: number;
  startupTimer: ReturnType<typeof setTimeout>;
};

type LocatorAdmission = {
  start: () => boolean;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort: () => void;
  timer: ReturnType<typeof setTimeout>;
};

export type TerrainGenerationAuthorityStateV2 =
  | "typescript-rollback"
  | "starting"
  | "ready"
  | "recovering"
  | "authority-unavailable"
  | "disposed";

export type TerrainGenerationSubmission = Readonly<{
  epoch: number;
  taskId: number;
  revision: number;
  cancel: () => boolean;
}>;

export type TerrainLocatorSubmission = Readonly<{
  epoch: number;
  taskId: number;
  cancel: () => boolean;
}>;

class TerrainGenerationPipelineError extends Error {
  readonly name = "TerrainGenerationPipelineError";
}

/** Reserves one of a bounded 2-4 worker graph for whole-chunk generation. */
export function recommendedTerrainWorkerCount(
  logicalProcessors = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4,
  deviceMemoryGiB = typeof navigator === "undefined" ? 4 : Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4),
) {
  if (logicalProcessors <= 4 || deviceMemoryGiB <= 4) return 1;
  if (logicalProcessors <= 8 || deviceMemoryGiB <= 8) return 2;
  return 3;
}

/**
 * V2 transfer pipeline. Certified Rust/Wasm is required in Rust mode: bad,
 * stale, timed out or crashed tasks install nothing and enter bounded recovery.
 * TypeScript generation exists only behind the separately selected rollback.
 */
export class TerrainGenerationPipeline {
  private slots: Slot[] = [];
  private nextId = 1;
  private workerGeneration = 0;
  private authorityEpoch = 0;
  private authorityIdentity: string | null = null;
  private latestTaskByLane = new Map<string, number>();
  private canceledTasks = new Set<number>();
  private canceledTaskTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private callbacks = new Map<number, WorkerCallback>();
  private readonly locatorAdmissions: LocatorAdmission[] = [];
  private readonly workerFactory?: () => TerrainGenerationWorkerLike;
  private readonly taskTimeoutMilliseconds: number;
  private readonly startupTimeoutMilliseconds: number;
  private readonly configuredWorkerCount: number;
  private readonly authoritySelection: TerrainGenerationAuthoritySelectionV2;
  private readonly scheduleTimeout: typeof globalThis.setTimeout;
  private readonly cancelTimeout: typeof globalThis.clearTimeout;
  private authorityStateValue: TerrainGenerationAuthorityStateV2;
  submitted = 0;
  completed = 0;
  failed = 0;
  stale = 0;
  canceled = 0;
  rejected = 0;
  transferBytes = 0;
  restarts = 0;
  lastError: Readonly<{
    message: string;
    filename: string | null;
    line: number | null;
    column: number | null;
    phase: "startup" | "task";
  }> | null = null;

  constructor(
    workerCount = recommendedTerrainWorkerCount(),
    private readonly maximumRestarts = 2,
    options: TerrainGenerationPipelineOptions = {},
  ) {
    this.configuredWorkerCount = Math.max(0, workerCount);
    this.workerFactory = options.workerFactory;
    this.taskTimeoutMilliseconds = Math.max(1, options.taskTimeoutMilliseconds ?? 30_000);
    this.startupTimeoutMilliseconds = Math.max(1, options.startupTimeoutMilliseconds ?? 30_000);
    this.authoritySelection = options.authoritySelection ?? configuredTerrainGenerationAuthorityV2();
    this.authorityStateValue = this.authoritySelection.mode === "typescript" ? "typescript-rollback" : "starting";
    this.scheduleTimeout = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.cancelTimeout = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
    if (this.authoritySelection.mode === "typescript") return;
    const browserWorkerAvailable = this.workerFactory || typeof Worker !== "undefined";
    if (!browserWorkerAvailable || this.configuredWorkerCount <= 0) {
      this.lastError = {
        message: browserWorkerAvailable ? "Rust terrain generation has no configured worker slots" : "Web Workers are unavailable for required Rust terrain generation",
        filename: null, line: null, column: null, phase: "startup",
      };
      this.authorityStateValue = "authority-unavailable";
      return;
    }
    for (let index = 0; index < this.configuredWorkerCount; index += 1) this.addWorker();
  }

  private createWorker() {
    return this.workerFactory
      ? this.workerFactory()
      : new Worker(new URL("./terrain-generation-worker.ts", import.meta.url), { type: "module" });
  }


  private addWorker() {
    try {
      const slot = {
        worker: this.createWorker(),
        ready: false,
        busy: false,
        currentId: null,
        generation: ++this.workerGeneration,
        startupTimer: 0 as unknown as ReturnType<typeof setTimeout>,
      } satisfies Slot;
      slot.worker.onmessage = (event) => this.handleMessage(slot, event.data);
      slot.worker.onerror = (event) => this.failSlot(slot, event);
      slot.worker.onmessageerror = (event) => this.failSlot(slot, new Error(`Terrain generation worker message error: ${event.type}`));
      this.slots.push(slot);
      slot.startupTimer = this.scheduleTimeout(() => this.failSlot(
        slot,
        new Error(`Rust terrain generation worker startup timed out after ${this.startupTimeoutMilliseconds} ms`),
      ), this.startupTimeoutMilliseconds);
      if (this.authorityStateValue !== "recovering") this.authorityStateValue = "starting";
    } catch (error) {
      this.lastError = {
        message: error instanceof Error ? error.message : String(error),
        filename: null,
        line: null,
        column: null,
        phase: "startup",
      };
      this.restartFailedAuthority();
    }
  }

  private restartFailedAuthority() {
    if (this.authoritySelection.mode !== "rust" || this.authorityStateValue === "disposed") return;
    if (this.restarts < this.maximumRestarts) {
      this.restarts += 1;
      this.authorityStateValue = "recovering";
      this.addWorker();
      return;
    }
    // A surviving slot may still be completing Wasm startup. Do not declare
    // terminal loss until every slot has actually failed and been removed.
    this.authorityStateValue = this.slots.some((slot) => slot.ready)
      ? "ready"
      : this.slots.length > 0 ? "recovering" : "authority-unavailable";
    if (this.authorityStateValue === "authority-unavailable") {
      this.rejectLocatorAdmissions("Required Rust terrain locator authority is unavailable");
    }
  }

  private clearStartupTimer(slot: Slot) {
    this.cancelTimeout(slot.startupTimer);
  }

  private drainLocatorAdmissions() {
    while (this.availableSlots > 0 && this.locatorAdmissions.length > 0) {
      const admission = this.locatorAdmissions.shift()!;
      this.cancelTimeout(admission.timer);
      admission.signal?.removeEventListener("abort", admission.abort);
      if (admission.signal?.aborted) {
        admission.reject(new TerrainGenerationPipelineError("Terrain locator admission was cancelled"));
        continue;
      }
      if (!admission.start()) {
        admission.reject(new TerrainGenerationPipelineError("Authoritative Rust locator admission failed"));
      }
    }
  }

  private rejectLocatorAdmissions(message: string) {
    for (const admission of this.locatorAdmissions.splice(0)) {
      this.cancelTimeout(admission.timer);
      admission.signal?.removeEventListener("abort", admission.abort);
      admission.reject(new TerrainGenerationPipelineError(message));
    }
  }

  private enqueueLocatorAdmission(start: () => boolean, reject: (error: Error) => void, signal?: AbortSignal) {
    if (this.locatorAdmissions.length >= 16) {
      reject(new TerrainGenerationPipelineError("Authoritative Rust locator admission queue is full"));
      return;
    }
    const admission: LocatorAdmission = {
      start,
      reject,
      signal,
      abort: () => {
        const index = this.locatorAdmissions.indexOf(admission);
        if (index >= 0) this.locatorAdmissions.splice(index, 1);
        this.cancelTimeout(admission.timer);
        signal?.removeEventListener("abort", admission.abort);
        reject(new TerrainGenerationPipelineError("Terrain locator admission was cancelled"));
      },
      timer: this.scheduleTimeout(() => {
        const index = this.locatorAdmissions.indexOf(admission);
        if (index >= 0) this.locatorAdmissions.splice(index, 1);
        signal?.removeEventListener("abort", admission.abort);
        reject(new TerrainGenerationPipelineError(`Terrain locator admission timed out after ${this.taskTimeoutMilliseconds} ms`));
      }, this.taskTimeoutMilliseconds),
    };
    this.locatorAdmissions.push(admission);
    signal?.addEventListener("abort", admission.abort, { once: true });
  }

  private exactRustCertificate(message: Extract<TerrainGenerationWorkerResponseV2, { type: "terrain-generation-ready-v2" }>) {
    const certificate = message.certificate;
    const locatorCertificate = message.locatorCertificate;
    const locatorEvidence = locatorCertificate?.schemaVersion === 1
      && locatorCertificate.corpusHash !== "0".repeat(32)
      && locatorCertificate.settlementCases >= TERRAIN_LOCATOR_PROMOTION_MINIMUM_SETTLEMENT_CASES_V1
      && locatorCertificate.lairCases >= TERRAIN_LOCATOR_PROMOTION_MINIMUM_LAIR_CASES_V1
      && locatorCertificate.byteEqual === true;
    const locatorIdentity = this.authoritySelection.source === "test" || (
      locatorCertificate?.corpusHash === TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1
      && locatorCertificate.settlementCases === TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1
      && locatorCertificate.lairCases === TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1
    );
    return message.backend === "rust-wasm-authoritative"
      && certificate?.generatorVersion === 18
      && certificate.generatorHash === legacyTerrainGeneratorHashV2("g18")
      && certificate.contentHash === LEGACY_TERRAIN_CONTENT_HASH_V2
      && certificate.corpusHash === TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2
      && certificate.corpusCases === TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2
      && certificate.byteEqual === true
      && locatorEvidence && locatorIdentity;
  }

  private handleMessage(slot: Slot, message: TerrainGenerationWorkerResponseV2) {
    if (!this.slots.includes(slot)) { this.stale += 1; return; }
    if (message.type === "terrain-generation-startup-error-v2") {
      this.failSlot(slot, new Error(message.message));
      return;
    }
    if (message.type === "terrain-generation-ready-v2") {
      const valid = message.protocolVersion === TERRAIN_GENERATION_PROTOCOL_V2
        && message.requestSchemaVersion === GENERATE_CHUNK_REQUEST_SCHEMA_V2
        && message.resultSchemaVersion === GENERATED_CHUNK_SCHEMA_V2
        && this.exactRustCertificate(message);
      if (!valid) {
        this.failSlot(slot, new Error("Terrain generation worker did not present the exact authoritative Rust V2 certificate"));
        return;
      }
      this.clearStartupTimer(slot);
      slot.ready = true;
      this.authorityStateValue = "ready";
      this.lastError = null;
      this.drainLocatorAdmissions();
      return;
    }
    if (slot.currentId !== message.taskId) {
      this.stale += 1;
      return;
    }
    const callback = this.callbacks.get(message.taskId);
    slot.busy = false;
    slot.currentId = null;
    if (!callback) {
      if (this.canceledTasks.delete(message.taskId)) {
        const timer = this.canceledTaskTimers.get(message.taskId);
        if (timer !== undefined) this.cancelTimeout(timer);
        this.canceledTaskTimers.delete(message.taskId);
        this.drainLocatorAdmissions();
        return;
      }
      this.stale += 1;
      this.drainLocatorAdmissions();
      return;
    }
    this.callbacks.delete(message.taskId);
    this.finishCallback(callback);
    if (message.type === "generate-chunk-error-v2") {
      this.failed += 1;
      this.lastError = { message: message.message, filename: null, line: null, column: null, phase: "task" };
      callback.fail(new TerrainGenerationPipelineError(message.message));
      this.failSlot(slot, new Error(message.message));
      return;
    }
    if (message.type === "generate-chunk-cancelled-v2") {
      this.canceled += 1;
      callback.fail(new TerrainGenerationPipelineError("Terrain generation task was cancelled"));
      this.drainLocatorAdmissions();
      return;
    }
    if (callback.kind === "settlement") {
      if (message.type !== "settlement-locator-result-v1"
        || message.epoch !== callback.request.epoch || message.taskId !== callback.request.taskId
        || message.result.schemaVersion !== callback.request.schemaVersion
        || message.result.epoch !== callback.request.epoch || message.result.taskId !== callback.request.taskId
        || message.result.requestHash !== callback.request.requestHash
        || !/^[0-9a-f]{32}$/.test(message.result.resultHash)
        || callback.request.epoch !== this.authorityEpoch) {
        this.stale += 1;
        callback.fail(new TerrainGenerationPipelineError("Settlement locator result is stale or mismatched"));
        this.drainLocatorAdmissions();
        return;
      }
      this.completed += 1;
      this.lastError = null;
      callback.complete(message.result);
      this.drainLocatorAdmissions();
      return;
    }
    if (callback.kind === "lair") {
      if (message.type !== "dragon-lair-locator-result-v1"
        || message.epoch !== callback.request.epoch || message.taskId !== callback.request.taskId
        || message.result.schemaVersion !== callback.request.schemaVersion
        || message.result.epoch !== callback.request.epoch || message.result.taskId !== callback.request.taskId
        || message.result.requestHash !== callback.request.requestHash
        || !/^[0-9a-f]{32}$/.test(message.result.resultHash)
        || callback.request.epoch !== this.authorityEpoch) {
        this.stale += 1;
        callback.fail(new TerrainGenerationPipelineError("Dragon-lair locator result is stale or mismatched"));
        this.drainLocatorAdmissions();
        return;
      }
      this.completed += 1;
      this.lastError = null;
      callback.complete(message.result);
      this.drainLocatorAdmissions();
      return;
    }
    if (message.type !== "generated-chunk-v2") {
      this.rejected += 1;
      callback.fail(new TerrainGenerationPipelineError("Terrain generation worker returned the wrong result kind"));
      this.failSlot(slot, new Error("Terrain generation worker returned the wrong result kind"));
      return;
    }
    const lane = `${callback.request.epoch}:${callback.request.key}`;
    const stale = message.epoch !== callback.request.epoch
      || message.taskId !== callback.request.taskId
      || callback.request.epoch !== this.authorityEpoch
      || this.latestTaskByLane.get(lane) !== callback.request.taskId;
    if (stale) {
      this.stale += 1;
      callback.fail(new TerrainGenerationPipelineError("Terrain generation result is stale"));
      this.drainLocatorAdmissions();
      return;
    }
    try {
      assertGeneratedChunkMatchesRequestV2(message.result, callback.request);
      const structureMarkers = decodeTerrainGenerationMarkerTableV2(message.result.markerTable);
      this.transferBytes += generatedChunkTransferListV2(message.result).reduce((total, buffer) => total + buffer.byteLength, 0);
      this.completed += 1;
      this.lastError = null;
      callback.complete({ ...message.result, structureMarkers });
      this.drainLocatorAdmissions();
    } catch (error) {
      this.rejected += 1;
      this.failed += 1;
      this.lastError = {
        message: error instanceof Error ? error.message : String(error),
        filename: null,
        line: null,
        column: null,
        phase: "task",
      };
      callback.fail(error instanceof Error ? error : new TerrainGenerationPipelineError(String(error)));
      this.failSlot(slot, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private finishCallback(callback: WorkerCallback) { this.cancelTimeout(callback.timer); }

  private failSlot(slot: Slot, event: ErrorEvent | Error) {
    if (!this.slots.includes(slot)) return;
    const failedId = slot.currentId;
    this.lastError = {
      message: event.message || "Terrain generation worker failed without an error message",
      filename: "filename" in event ? event.filename || null : null,
      line: "lineno" in event ? event.lineno || null : null,
      column: "colno" in event ? event.colno || null : null,
      phase: slot.ready ? "task" : "startup",
    };
    slot.busy = false;
    slot.currentId = null;
    this.clearStartupTimer(slot);
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.onmessageerror = null;
    slot.worker.terminate();
    this.slots = this.slots.filter((candidate) => candidate !== slot);
    if (failedId !== null) {
      this.canceledTasks.delete(failedId);
      const canceledTimer = this.canceledTaskTimers.get(failedId);
      if (canceledTimer !== undefined) this.cancelTimeout(canceledTimer);
      this.canceledTaskTimers.delete(failedId);
      const callback = this.callbacks.get(failedId);
      this.callbacks.delete(failedId);
      if (callback) {
        this.finishCallback(callback);
        this.failed += 1;
        callback.fail(new TerrainGenerationPipelineError(this.lastError.message));
      }
    }
    // Restore configured capacity under the same bounded global restart
    // budget. A surviving slot keeps authority usable, but must not make every
    // partial crash permanently shrink the long-travel worker graph.
    if (this.slots.length < this.configuredWorkerCount && this.restarts < this.maximumRestarts) {
      this.restarts += 1;
      this.authorityStateValue = this.slots.some((candidate) => candidate.ready) ? "ready" : "recovering";
      this.addWorker();
    } else if (this.slots.some((candidate) => candidate.ready)) this.authorityStateValue = "ready";
    else this.restartFailedAuthority();
  }

  private authorityFor(request: TerrainGenerationRequest) {
    const contentHash = request.contentHash ?? LEGACY_TERRAIN_CONTENT_HASH_V2;
    const generatorHash = request.generatorHash ?? legacyTerrainGeneratorHashV2(request.namespace);
    const identity = hashTerrainGenerationIdentityV2(
      "blockwild-terrain-authority-epoch-v2",
      request.seedText,
      stableTerrainGenerationJsonV2(request.generationOptions),
      contentHash,
      generatorHash,
    );
    if (request.epoch !== undefined) {
      if (this.authorityIdentity === null && this.callbacks.size === 0) {
        this.authorityEpoch = request.epoch;
        this.authorityIdentity = identity;
      } else if (request.epoch !== this.authorityEpoch || identity !== this.authorityIdentity) {
        throw new TerrainGenerationPipelineError("Explicit terrain authority epoch does not match the snapshotted world authority");
      }
    } else if (identity !== this.authorityIdentity) {
      this.authorityIdentity = identity;
      this.authorityEpoch = (this.authorityEpoch + 1) >>> 0;
      if (this.authorityEpoch === 0) this.authorityEpoch = 1;
    }
    return { epoch: this.authorityEpoch, contentHash, generatorHash };
  }

  private allocateTaskId() {
    if (this.nextId <= 0xffffffff) return this.nextId++;
    // A u32 wrap is an authority lifecycle boundary. Atomically invalidate
    // callbacks and restart workers; the caller retries only after readiness.
    this.nextId = 1;
    this.resetAuthorityEpoch();
    return null;
  }

  private revisionFor(request: TerrainGenerationRequest) {
    if (request.revision !== undefined) return request.revision;
    const hash = hashTerrainGenerationIdentityV2(
      "blockwild-terrain-revision-v2",
      request.namespace,
      stableTerrainGenerationJsonV2(request.edits),
    );
    return Number.parseInt(hash.slice(0, 8), 16) >>> 0;
  }

  get mode() { return this.authoritySelection.mode; }
  get state() { return this.authorityStateValue; }
  get supported() { return this.authoritySelection.mode === "rust" && this.slots.some((slot) => slot.ready); }
  get authorityUnavailable() { return this.authorityStateValue === "authority-unavailable"; }
  get availableSlots() { return this.slots.filter((slot) => slot.ready && !slot.busy).length; }

  submitWithHandle(
    request: TerrainGenerationRequest,
    complete: (result: TerrainGenerationResult) => void,
    fail: (error?: Error) => void = () => {},
  ): TerrainGenerationSubmission | null {
    const taskId = this.allocateTaskId();
    if (taskId === null) return null;
    const slot = this.slots.find((candidate) => candidate.ready && !candidate.busy);
    if (!slot) return null;
    let canonical: GenerateChunkRequestV2;
    try {
      const authority = this.authorityFor(request);
      canonical = createGenerateChunkRequestV2({
        epoch: authority.epoch,
        taskId,
        revision: this.revisionFor(request),
        namespace: request.namespace,
        contentHash: authority.contentHash,
        generatorHash: authority.generatorHash,
        seedText: request.seedText,
        generationOptions: request.generationOptions,
        key: request.key,
        cx: request.cx,
        cz: request.cz,
        edits: request.edits,
      });
    } catch (error) {
      this.rejected += 1;
      this.lastError = {
        message: error instanceof Error ? error.message : String(error),
        filename: null,
        line: null,
        column: null,
        phase: "task",
      };
      return null;
    }
    const lane = `${canonical.epoch}:${canonical.key}`;
    this.latestTaskByLane.set(lane, canonical.taskId);
    slot.busy = true;
    slot.currentId = canonical.taskId;
    const timer = this.scheduleTimeout(() => this.failSlot(
      slot,
      new Error(`Terrain generation task ${canonical.taskId} timed out after ${this.taskTimeoutMilliseconds} ms`),
    ), this.taskTimeoutMilliseconds);
    this.callbacks.set(canonical.taskId, { kind: "chunk", request: canonical, complete, fail, timer });
    this.submitted += 1;
    try {
      // Keep one authoritative copy for response validation. Only the worker
      // copy is detached; transferring gameplay-owned input would make its
      // request checksum unverifiable when the result returns.
      const workerRequest: GenerateChunkRequestV2 = { ...canonical, edits: canonical.edits.slice() };
      const transfer = generateChunkRequestTransferListV2(workerRequest);
      this.transferBytes += transfer.reduce((total, buffer) => total + buffer.byteLength, 0);
      slot.worker.postMessage({ type: "generate-chunk-v2", request: workerRequest }, transfer);
    } catch (error) {
      this.failSlot(slot, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
    return {
      epoch: canonical.epoch,
      taskId: canonical.taskId,
      revision: canonical.revision,
      cancel: () => this.cancel(canonical.taskId),
    };
  }

  submit(
    request: TerrainGenerationRequest,
    complete: (result: TerrainGenerationResult) => void,
    fail: (error?: Error) => void = () => {},
  ) { return this.submitWithHandle(request, complete, fail) !== null; }

  private locatorAuthority(request: TerrainLocatorAuthorityRequest) {
    return this.authorityFor({
      ...request,
      key: "locator-authority",
      cx: 0,
      cz: 0,
      edits: [],
    });
  }

  submitSettlementQueryWithHandle(
    query: TerrainSettlementLocatorQuery,
    complete: (result: SettlementLocatorResultV1) => void,
    fail: (error?: Error) => void = () => {},
  ): TerrainLocatorSubmission | null {
    const taskId = this.allocateTaskId();
    if (taskId === null) return null;
    const slot = this.slots.find((candidate) => candidate.ready && !candidate.busy);
    if (!slot) return null;
    let request: SettlementLocatorRequestV1;
    try {
      const authority = this.locatorAuthority(query);
      request = createSettlementLocatorRequestV1({
        epoch: authority.epoch, taskId, seedText: query.seedText, generationOptions: query.generationOptions,
        origin: query.origin, factionIds: query.factionIds, sizes: query.sizes, environments: query.environments,
        excludeIds: query.excludeIds, maxRegionRadius: query.maxRegionRadius, limit: query.limit,
        breathesWater: query.breathesWater,
      });
    } catch (error) {
      this.rejected += 1;
      fail(error instanceof Error ? error : new TerrainGenerationPipelineError(String(error)));
      return null;
    }
    slot.busy = true;
    slot.currentId = request.taskId;
    const timer = this.scheduleTimeout(() => this.failSlot(slot,
      new Error(`Settlement locator task ${request.taskId} timed out after ${this.taskTimeoutMilliseconds} ms`)),
    this.taskTimeoutMilliseconds);
    this.callbacks.set(request.taskId, { kind: "settlement", request, complete, fail, timer });
    this.submitted += 1;
    try {
      slot.worker.postMessage({ type: "query-settlements-v1", request });
    } catch (error) {
      this.failSlot(slot, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
    return { epoch: request.epoch, taskId: request.taskId, cancel: () => this.cancel(request.taskId) };
  }

  submitDragonLairQueryWithHandle(
    query: TerrainDragonLairLocatorQuery,
    complete: (result: DragonLairLocatorResultV1) => void,
    fail: (error?: Error) => void = () => {},
  ): TerrainLocatorSubmission | null {
    const taskId = this.allocateTaskId();
    if (taskId === null) return null;
    const slot = this.slots.find((candidate) => candidate.ready && !candidate.busy);
    if (!slot) return null;
    let request: DragonLairLocatorRequestV1;
    try {
      const authority = this.locatorAuthority(query);
      request = createDragonLairLocatorRequestV1({
        epoch: authority.epoch, taskId, seedText: query.seedText, generationOptions: query.generationOptions,
        origin: query.origin, dragonType: query.dragonType, minimumStage: query.minimumStage,
        excludeIds: query.excludeIds, maxRegionRadius: query.maxRegionRadius,
      });
    } catch (error) {
      this.rejected += 1;
      fail(error instanceof Error ? error : new TerrainGenerationPipelineError(String(error)));
      return null;
    }
    slot.busy = true;
    slot.currentId = request.taskId;
    const timer = this.scheduleTimeout(() => this.failSlot(slot,
      new Error(`Dragon-lair locator task ${request.taskId} timed out after ${this.taskTimeoutMilliseconds} ms`)),
    this.taskTimeoutMilliseconds);
    this.callbacks.set(request.taskId, { kind: "lair", request, complete, fail, timer });
    this.submitted += 1;
    try {
      slot.worker.postMessage({ type: "query-dragon-lair-v1", request });
    } catch (error) {
      this.failSlot(slot, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
    return { epoch: request.epoch, taskId: request.taskId, cancel: () => this.cancel(request.taskId) };
  }

  querySettlements(query: TerrainSettlementLocatorQuery, signal?: AbortSignal) {
    return new Promise<SettlementLocatorResultV1>((resolve, reject) => {
      if (signal?.aborted) { reject(new TerrainGenerationPipelineError("Settlement locator task was cancelled")); return; }
      let submission: TerrainLocatorSubmission | null = null;
      let settled = false;
      const abort = () => submission?.cancel();
      const done = (result: SettlementLocatorResultV1) => { settled = true; signal?.removeEventListener("abort", abort); resolve(result); };
      const failed = (error?: Error) => { settled = true; signal?.removeEventListener("abort", abort); reject(error ?? new TerrainGenerationPipelineError("Settlement locator failed")); };
      const launch = () => {
        submission = this.submitSettlementQueryWithHandle(query, done, failed);
        if (submission) signal?.addEventListener("abort", abort, { once: true });
        return Boolean(submission);
      };
      if (!launch() && !settled) {
        if (this.authorityUnavailable || this.authorityStateValue === "disposed") {
          failed(new TerrainGenerationPipelineError("Authoritative Rust settlement locator is unavailable"));
        } else this.enqueueLocatorAdmission(launch, failed, signal);
      }
    });
  }

  queryDragonLair(query: TerrainDragonLairLocatorQuery, signal?: AbortSignal) {
    return new Promise<DragonLairLocatorResultV1>((resolve, reject) => {
      if (signal?.aborted) { reject(new TerrainGenerationPipelineError("Dragon-lair locator task was cancelled")); return; }
      let submission: TerrainLocatorSubmission | null = null;
      let settled = false;
      const abort = () => submission?.cancel();
      const done = (result: DragonLairLocatorResultV1) => { settled = true; signal?.removeEventListener("abort", abort); resolve(result); };
      const failed = (error?: Error) => { settled = true; signal?.removeEventListener("abort", abort); reject(error ?? new TerrainGenerationPipelineError("Dragon-lair locator failed")); };
      const launch = () => {
        submission = this.submitDragonLairQueryWithHandle(query, done, failed);
        if (submission) signal?.addEventListener("abort", abort, { once: true });
        return Boolean(submission);
      };
      if (!launch() && !settled) {
        if (this.authorityUnavailable || this.authorityStateValue === "disposed") {
          failed(new TerrainGenerationPipelineError("Authoritative Rust dragon-lair locator is unavailable"));
        } else this.enqueueLocatorAdmission(launch, failed, signal);
      }
    });
  }

  cancel(taskId: number) {
    const callback = this.callbacks.get(taskId);
    if (!callback) return false;
    this.callbacks.delete(taskId);
    // The original bounded task timeout becomes the cancel-ack timeout.  A
    // worker that never acknowledges cancellation cannot retain a slot until
    // reload; timeout recovery terminates and replaces it fail-closed.
    this.canceledTaskTimers.set(taskId, callback.timer);
    this.canceledTasks.add(taskId);
    const slot = this.slots.find((candidate) => candidate.currentId === taskId);
    try {
      slot?.worker.postMessage({ type: "cancel-generate-chunk-v2", epoch: callback.request.epoch, taskId });
    } catch { /* worker failure/result will clear the occupied slot */ }
    this.canceled += 1;
    callback.fail(new TerrainGenerationPipelineError("Terrain generation task was cancelled"));
    return true;
  }

  diagnostics() {
    return {
      mode: this.authoritySelection.mode,
      selectionSource: this.authoritySelection.source,
      state: this.authorityStateValue,
      authorityRequired: this.authoritySelection.mode === "rust",
      acceptingRequests: this.availableSlots > 0,
      rollbackRequiresWorldReload: this.authoritySelection.rollbackRequiresWorldReload,
      supported: this.supported,
      workers: this.slots.length,
      busy: this.slots.filter((slot) => slot.busy).length,
      submitted: this.submitted,
      completed: this.completed,
      failed: this.failed,
      stale: this.stale,
      canceled: this.canceled,
      rejected: this.rejected,
      transferBytes: this.transferBytes,
      ready: this.slots.filter((slot) => slot.ready).length,
      restarts: this.restarts,
      epoch: this.authorityEpoch,
      lastError: this.lastError,
    } as const;
  }

  /** Narrow browser-audit seam; never changes the selected authority mode. */
  simulateWorkerCrashForDiagnostics() {
    const slot = this.slots.find((candidate) => candidate.ready) ?? this.slots[0];
    if (!slot) return false;
    this.failSlot(slot, new Error("Simulated Rust terrain generation worker crash"));
    return true;
  }

  /**
   * Invalidates every in-flight lane before a ChunkWorld reset. Rust workers
   * are restarted so detached old-world results cannot retain capacity or
   * enter the next world's callback queue.
   */
  resetAuthorityEpoch() {
    this.authorityEpoch = (this.authorityEpoch + 1) >>> 0 || 1;
    this.authorityIdentity = null;
    this.latestTaskByLane.clear();
    for (const timer of this.canceledTaskTimers.values()) this.cancelTimeout(timer);
    this.canceledTaskTimers.clear();
    this.canceledTasks.clear();
    this.rejectLocatorAdmissions("Terrain locator request was invalidated by a world reset");
    for (const callback of this.callbacks.values()) {
      this.finishCallback(callback);
      callback.fail(new TerrainGenerationPipelineError("Terrain generation task was invalidated by a world reset"));
    }
    this.callbacks.clear();
    if (this.authoritySelection.mode !== "rust" || this.authorityStateValue === "disposed") return;
    const workerCount = this.configuredWorkerCount;
    for (const slot of this.slots) {
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.onmessageerror = null;
      this.clearStartupTimer(slot);
      slot.worker.terminate();
    }
    this.slots = [];
    this.restarts = 0;
    this.authorityStateValue = "starting";
    for (let index = 0; index < workerCount; index += 1) this.addWorker();
  }

  dispose() {
    for (const slot of this.slots) {
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.onmessageerror = null;
      this.clearStartupTimer(slot);
      slot.worker.terminate();
    }
    for (const callback of this.callbacks.values()) this.finishCallback(callback);
    for (const timer of this.canceledTaskTimers.values()) this.cancelTimeout(timer);
    this.slots = [];
    this.callbacks.clear();
    this.latestTaskByLane.clear();
    this.canceledTaskTimers.clear();
    this.canceledTasks.clear();
    this.rejectLocatorAdmissions("Terrain locator request was invalidated by disposal");
    this.authorityStateValue = "disposed";
  }
}
