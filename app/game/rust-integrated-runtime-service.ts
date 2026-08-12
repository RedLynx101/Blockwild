import {
  RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES,
  RUST_INTEGRATED_RUNTIME_MAX_IDEMPOTENCY_RECEIPTS,
  RUST_INTEGRATED_RUNTIME_MAX_INPUT_FRAMES,
  rustIntegratedRuntimeIdentityEqualsV1,
  type RustIntegratedRuntimeCommandBatchV1,
  type RustIntegratedRuntimeCommandReceiptV1,
  type RustIntegratedRuntimeConfigV1,
  type RustIntegratedRuntimeExtractionV1,
  type RustIntegratedRuntimeIdentityV1,
  type RustIntegratedRuntimeInputFrameV1,
  type RustIntegratedRuntimeRequestV1,
  type RustIntegratedRuntimeResponseV1,
  type RustIntegratedRuntimeTransportV1,
} from "./rust-integrated-runtime-contract";
import {
  RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1,
  rustIntegratedRuntimeBulkStateV1,
  type RustIntegratedRuntimeBulkResponseV1,
  type RustIntegratedRuntimeBulkStateV1,
  type RustIntegratedRuntimeBulkTransportDiagnosticsV1,
  type RustIntegratedRuntimeBulkTransportV1,
} from "./rust-integrated-runtime-bulk-platform";
import {
  RUST_CONTENT_AUTHORITY_CAPABILITY_V1,
  RUST_CONTENT_INSTALL_CAPABILITY_V1,
  RUST_CONTENT_INSTALL_PAGE_TYPE_V1,
  RUST_CONTENT_INSTALL_RECEIPT_TYPE_V1,
  createRustContentInstallPlanV1,
  decodeRustContentInstallReceiptV1,
  type RustContentInstallReceiptV1,
  type RustProductionContentBundle,
} from "./rust-integrated-runtime-content";
import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
} from "./rust-integrated-runtime-codec";

export const RUST_INTEGRATED_RUNTIME_COMMAND_P95_BUDGET_MS = 50;
export const RUST_INTEGRATED_RUNTIME_STEP_P95_BUDGET_MS = 8;
export const RUST_INTEGRATED_RUNTIME_EXTRACT_P95_BUDGET_MS = 8;

const REQUIRED_BASE_CAPABILITIES = Object.freeze([
  "integrated-runtime-v1",
  "awaited-receipts-v1",
]);

const FIXED_STEP_INPUT_CAPABILITY = "fixed-step-input-v1";
const BOUNDED_EXTRACTION_CAPABILITY = "bounded-extraction-v1";
const BOUNDED_ENTITY_EXTRACTION_CAPABILITY = "bounded-entity-extraction-v1";
const BOUNDED_EXTRACTION_BLOCKERS_CAPABILITY = "bounded-extraction-blockers-v1";

export type RustIntegratedRuntimeServiceStateV1 = "idle" | "starting" | "ready" | "failed" | "recovering" | "stopping" | "stopped";

export class RustIntegratedRuntimeServiceError extends Error {
  readonly name = "RustIntegratedRuntimeServiceError";

  constructor(
    readonly code:
      | "artifact-mismatch"
      | "bulk-platform"
      | "capacity"
      | "content-install"
      | "disposed"
      | "idempotency-conflict"
      | "indeterminate-command"
      | "invalid-response"
      | "not-authoritative"
      | "not-ready"
      | "stale-command"
      | "worker-failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export type RustIntegratedRuntimeServiceOptionsV1 = Readonly<{
  transportFactory(): RustIntegratedRuntimeTransportV1;
  /** Exact content-addressed Wasm artifact expected from the loader. Required in production mode. */
  expectedArtifactHash?: string;
  mode?: "production" | "protocol-test";
  now?: () => number;
}>;

type IdempotencyEntry =
  | Readonly<{ commandHash: string; state: "pending"; promise: Promise<RustIntegratedRuntimeCommandReceiptV1> }>
  | Readonly<{ commandHash: string; state: "settled"; receipt: RustIntegratedRuntimeCommandReceiptV1 }>
  | Readonly<{ commandHash: string; state: "indeterminate"; batch: RustIntegratedRuntimeCommandBatchV1 }>;

type MetricKind = "command" | "step" | "extract";

export type RustIntegratedRuntimeServiceDiagnosticsV1 = Readonly<{
  state: RustIntegratedRuntimeServiceStateV1;
  authoritative: boolean;
  verification: "content-addressed-wasm" | "protocol-test" | "unverified";
  clientEpoch: number;
  workerEpoch: number;
  requests: number;
  acceptedCommands: number;
  rejectedCommands: number;
  cachedReceipts: number;
  indeterminateCommands: number;
  staleResponses: number;
  failures: number;
  commandP95Ms: number;
  stepP95Ms: number;
  extractP95Ms: number;
  commandBudgetMet: boolean;
  stepBudgetMet: boolean;
  extractBudgetMet: boolean;
  lastError: Readonly<{ code: string; message: string }> | null;
  contentReady: boolean;
  contentManifestHash: string | null;
  fixedStepInputReady: boolean;
  boundedExtractionAvailable: boolean;
  boundedExtractionReady: boolean;
  liveAuthorityReady: boolean;
  capabilities: readonly string[];
}>;

function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function validateInputs(inputs: readonly RustIntegratedRuntimeInputFrameV1[]) {
  if (inputs.length > RUST_INTEGRATED_RUNTIME_MAX_INPUT_FRAMES) {
    throw new RustIntegratedRuntimeServiceError("capacity", "fixed-step input batch exceeds 128 frames");
  }
  for (let index = 1; index < inputs.length; index += 1) {
    if (inputs[index - 1].sequence >= inputs[index].sequence) {
      throw new RustIntegratedRuntimeServiceError("invalid-response", "fixed-step input sequences must be strictly increasing");
    }
  }
}

function identityDoesNotRegress(
  before: RustIntegratedRuntimeIdentityV1,
  after: RustIntegratedRuntimeIdentityV1,
) {
  const sameAddress = before.universeId === after.universeId && before.locationId === after.locationId;
  if (!sameAddress) return after.revision.epoch > before.revision.epoch;
  if (after.tick < before.tick) return false;
  return (Object.keys(before.revision) as Array<keyof RustIntegratedRuntimeIdentityV1["revision"]>)
    .every((key) => after.revision[key] >= before.revision[key]);
}

export class RustIntegratedRuntimeServiceV1 {
  private transport: RustIntegratedRuntimeTransportV1 | null = null;
  private state: RustIntegratedRuntimeServiceStateV1 = "idle";
  private clientEpoch = 0;
  private workerEpoch = 0;
  private nextRequestId = 1;
  private currentIdentity: RustIntegratedRuntimeIdentityV1 | null = null;
  private authoritative = false;
  private verification: RustIntegratedRuntimeServiceDiagnosticsV1["verification"] = "unverified";
  private verifiedCapabilities = new Set<string>();
  private serial = Promise.resolve<unknown>(undefined);
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly idempotencyOrder: string[] = [];
  private readonly metrics: Record<MetricKind, number[]> = { command: [], step: [], extract: [] };
  private requests = 0;
  private acceptedCommands = 0;
  private rejectedCommands = 0;
  private staleResponses = 0;
  private failures = 0;
  private lastError: RustIntegratedRuntimeServiceDiagnosticsV1["lastError"] = null;
  private configuredContentHash: string | null = null;
  private contentRequired = false;
  private contentAttestation: RustContentInstallReceiptV1 | null = null;
  private contentInstallPromise: Promise<RustContentInstallReceiptV1> | null = null;
  private readonly mode: "production" | "protocol-test";
  private readonly now: () => number;

  constructor(private readonly options: RustIntegratedRuntimeServiceOptionsV1) {
    this.mode = options.mode ?? "production";
    this.now = options.now ?? (() => performance.now());
    if (this.mode === "production" && !options.expectedArtifactHash) {
      throw new RustIntegratedRuntimeServiceError("artifact-mismatch", "production integrated runtime requires an exact content-addressed Wasm hash");
    }
  }

  async start(config: RustIntegratedRuntimeConfigV1) {
    if (this.state !== "idle" && this.state !== "stopped") throw new RustIntegratedRuntimeServiceError("not-ready", `cannot start runtime from ${this.state}`);
    this.state = "starting";
    this.clientEpoch += 1;
    this.workerEpoch = 0;
    this.currentIdentity = null;
    this.authoritative = false;
    this.verification = "unverified";
    this.configuredContentHash = config.contentHash;
    this.contentRequired = false;
    this.contentAttestation = null;
    this.contentInstallPromise = null;
    this.verifiedCapabilities.clear();
    this.transport = this.options.transportFactory();
    try {
      const response = await this.send({
        type: "runtime-create-v1",
        requestId: this.requestId(),
        clientEpoch: this.clientEpoch,
        config,
      });
      if (response.type !== "runtime-ready-v1") throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime create did not return ready");
      this.acceptWorkerEpoch(response);
      this.verifyReady(response);
      if (response.identity.universeId !== config.universeId || response.identity.locationId !== config.locationId) {
        throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime ready identity does not match the requested world address");
      }
      this.currentIdentity = response.identity;
      this.state = "ready";
      return response.identity;
    } catch (error) {
      this.failClosed(error);
      throw error;
    }
  }

  identity() {
    return this.requireIdentity();
  }

  isAuthoritative() {
    return this.authoritative;
  }

  command(batch: RustIntegratedRuntimeCommandBatchV1) {
    return this.dispatchCommand(batch, false);
  }

  private dispatchCommand(batch: RustIntegratedRuntimeCommandBatchV1, allowContentPending: boolean) {
    this.requireReady(allowContentPending);
    const key = `${batch.actorId}\u0000${batch.idempotencyKey}`;
    const replay = this.idempotency.get(key);
    if (replay) {
      if (replay.commandHash !== batch.commandHash) {
        return Promise.reject(new RustIntegratedRuntimeServiceError("idempotency-conflict", "idempotency key was reused for different command bytes"));
      }
      if (replay.state === "pending") return replay.promise;
      if (replay.state === "settled") return Promise.resolve(replay.receipt);
      return Promise.reject(new RustIntegratedRuntimeServiceError("indeterminate-command", "worker failed after dispatch; restore an attested synchronized checkpoint before retrying"));
    }
    const promise = this.enqueue(async () => {
      const started = this.now();
      let dispatched = false;
      try {
        // The identity must be checked when this batch reaches the head of the
        // serial authority queue, not when command() is called. Two browser
        // callers may author against the same snapshot before the first
        // awaited receipt advances it. The later batch is safely stale, but it
        // was never indeterminate and must not poison the worker generation.
        if (!rustIntegratedRuntimeIdentityEqualsV1(batch.expected, this.requireIdentity())) {
          this.idempotency.delete(key);
          throw new RustIntegratedRuntimeServiceError("stale-command", "command was authored against a stale integrated runtime identity");
        }
        dispatched = true;
        const response = await this.send({
          type: "runtime-command-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          batch,
        });
        this.acceptWorkerEpoch(response);
        if (response.type !== "runtime-command-receipt-v1") throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime command did not return an awaited receipt");
        const receipt = response.receipt;
        if (receipt.commandId !== batch.commandId || receipt.idempotencyKey !== batch.idempotencyKey || receipt.commandHash !== batch.commandHash) {
          throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime receipt does not identify the dispatched command bytes");
        }
        if (receipt.status === "accepted") {
          if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.before, batch.expected)) throw new RustIntegratedRuntimeServiceError("invalid-response", "accepted receipt before-identity does not match the command");
          if (!identityDoesNotRegress(receipt.before, receipt.after)) throw new RustIntegratedRuntimeServiceError("invalid-response", "accepted receipt regressed the authoritative identity");
          this.currentIdentity = receipt.after;
          this.acceptedCommands += 1;
        } else {
          if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.current, batch.expected)) throw new RustIntegratedRuntimeServiceError("invalid-response", "rejected receipt attempted to move the authoritative identity");
          this.currentIdentity = receipt.current;
          this.rejectedCommands += 1;
        }
        this.idempotency.set(key, Object.freeze({ commandHash: batch.commandHash, state: "settled", receipt }));
        this.retainIdempotencyKey(key);
        return receipt;
      } catch (error) {
        if (!dispatched && error instanceof RustIntegratedRuntimeServiceError && error.code === "stale-command") {
          throw error;
        }
        this.idempotency.set(key, Object.freeze({
          commandHash: batch.commandHash,
          state: "indeterminate",
          batch,
        }));
        this.retainIdempotencyKey(key);
        this.failClosed(error);
        throw error;
      } finally {
        this.recordMetric("command", this.now() - started);
      }
    });
    this.idempotency.set(key, Object.freeze({ commandHash: batch.commandHash, state: "pending", promise }));
    return promise;
  }

  private async reconcileIndeterminateCommand(batch: RustIntegratedRuntimeCommandBatchV1, key: string) {
    const started = this.now();
    try {
        const terminal = this.requireIdentity();
        const response = await this.send({
          type: "runtime-recover-command-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          batch,
        }, true);
        this.acceptWorkerEpoch(response);
        if (response.type === "runtime-error-v1") {
          if (response.code === "idempotency-conflict") {
            throw new RustIntegratedRuntimeServiceError("idempotency-conflict", response.message);
          }
          if (response.code === "idempotency-recovery-miss" || response.code === "idempotency-recovery-stale") {
            throw new RustIntegratedRuntimeServiceError("indeterminate-command", response.message);
          }
          throw new RustIntegratedRuntimeServiceError("invalid-response", `${response.code}: ${response.message}`);
        }
        if (response.type !== "runtime-command-receipt-v1") {
          throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime recovery command did not return an awaited receipt");
        }
        const receipt = response.receipt;
        if (receipt.commandId !== batch.commandId || receipt.idempotencyKey !== batch.idempotencyKey || receipt.commandHash !== batch.commandHash) {
          throw new RustIntegratedRuntimeServiceError("invalid-response", "recovered receipt does not identify the original command bytes");
        }
        const receiptTerminal = receipt.status === "accepted" ? receipt.after : receipt.current;
        if (!rustIntegratedRuntimeIdentityEqualsV1(receiptTerminal, terminal)) {
          throw new RustIntegratedRuntimeServiceError("invalid-response", "recovered receipt is not terminal at the restored authority identity");
        }
        this.idempotency.set(key, Object.freeze({ commandHash: batch.commandHash, state: "settled", receipt }));
        this.retainIdempotencyKey(key);
        if (receipt.status === "accepted") this.acceptedCommands += 1;
        else this.rejectedCommands += 1;
        return receipt;
    } catch (error) {
      const current = this.idempotency.get(key);
      if (current?.state !== "settled") {
        this.idempotency.set(key, Object.freeze({
          commandHash: batch.commandHash,
          state: "indeterminate",
          batch,
        }));
        this.retainIdempotencyKey(key);
      }
      throw error;
    } finally {
      this.recordMetric("command", this.now() - started);
    }
  }

  installContent(bundle: RustProductionContentBundle) {
    this.requireReady(true);
    if (!this.contentRequired || !this.verifiedCapabilities.has(RUST_CONTENT_INSTALL_CAPABILITY_V1)) {
      return Promise.reject(new RustIntegratedRuntimeServiceError("content-install", "runtime artifact does not expose the coarse content installer"));
    }
    const plan = createRustContentInstallPlanV1(bundle);
    if (plan.manifestHash !== this.configuredContentHash) {
      return Promise.reject(new RustIntegratedRuntimeServiceError("content-install", "compiled content manifest does not match runtime configuration"));
    }
    if (this.contentAttestation) {
      return this.contentAttestation.manifestHash === plan.manifestHash
        ? Promise.resolve(this.contentAttestation)
        : Promise.reject(new RustIntegratedRuntimeServiceError("content-install", "runtime already attested another immutable content manifest"));
    }
    if (this.contentInstallPromise) return this.contentInstallPromise;
    const operation = async () => {
      let finalReceipt: RustContentInstallReceiptV1 | null = null;
      try {
        for (const { page, payload } of plan.pages) {
          const batch = createRustIntegratedRuntimeCommandBatchV1({
            commandId: `content:${page.pageIndex}`,
            idempotencyKey: `${plan.installId}:${page.pageIndex}`,
            actorId: "runtime-content-installer",
            expected: this.requireIdentity(),
            operations: [createRustIntegratedRuntimeDomainOperationV1({
              domain: "gameplay",
              typeId: RUST_CONTENT_INSTALL_PAGE_TYPE_V1,
              schema: 1,
              payload,
            })],
          });
          const result = await this.dispatchCommand(batch, true);
          if (result.status !== "accepted" || result.domainReceipts.length !== 1) {
            throw new RustIntegratedRuntimeServiceError("content-install", result.status === "rejected" ? `${result.code}: ${result.message}` : "content page returned no native receipt");
          }
          const domainReceipt = result.domainReceipts[0];
          if (domainReceipt.domain !== "gameplay" || domainReceipt.typeId !== RUST_CONTENT_INSTALL_RECEIPT_TYPE_V1 || domainReceipt.schema !== 1) {
            throw new RustIntegratedRuntimeServiceError("content-install", "content page returned the wrong native receipt type");
          }
          const receipt = decodeRustContentInstallReceiptV1(domainReceipt.payload);
          if (receipt.installId !== plan.installId || receipt.manifestHash !== plan.manifestHash
            || !contentDomainDigestsEqual(receipt.domains, page.domains)
            || receipt.pageCount !== plan.pages.length || receipt.acceptedPages !== page.pageIndex + 1
            || (page.pageIndex + 1 < plan.pages.length && receipt.status !== "staged")
            || (page.pageIndex + 1 === plan.pages.length && receipt.status !== "installed")) {
            throw new RustIntegratedRuntimeServiceError("content-install", "content receipt does not attest the dispatched page sequence");
          }
          finalReceipt = receipt;
        }
        if (!finalReceipt || finalReceipt.status !== "installed") throw new RustIntegratedRuntimeServiceError("content-install", "content installation ended without a final attestation");
        if (finalReceipt.installedEntries !== bundle.artifacts.length) throw new RustIntegratedRuntimeServiceError("content-install", "final content receipt omitted authored artifacts");
        this.contentAttestation = finalReceipt;
        this.verifiedCapabilities.add(RUST_CONTENT_AUTHORITY_CAPABILITY_V1);
        this.authoritative = this.mode === "production" && this.verification === "content-addressed-wasm";
        return finalReceipt;
      } catch (error) {
        this.failClosed(error);
        throw error;
      }
    };
    this.contentInstallPromise = operation();
    return this.contentInstallPromise;
  }

  step(monotonicTimeUs: number, budgetUs: number, inputs: readonly RustIntegratedRuntimeInputFrameV1[]) {
    this.requireReady();
    this.requireCapability(
      FIXED_STEP_INPUT_CAPABILITY,
      "fixed-step input remains unavailable until the live browser cutover gate is complete",
    );
    validateInputs(inputs);
    return this.enqueue(async () => {
      const started = this.now();
      try {
        const expected = this.requireIdentity();
        const response = await this.send({
          type: "runtime-step-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected,
          monotonicTimeUs,
          budgetUs,
          inputs,
        });
        this.acceptWorkerEpoch(response);
        if (response.type !== "runtime-step-result-v1") throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime step did not return a fixed-step result");
        if (!identityDoesNotRegress(expected, response.identity)) throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime step regressed the authoritative identity");
        this.currentIdentity = response.identity;
        return response;
      } catch (error) {
        this.failClosed(error);
        throw error;
      } finally {
        this.recordMetric("step", this.now() - started);
      }
    });
  }

  extract(afterRevision: number, maxBytes = RUST_INTEGRATED_RUNTIME_MAX_EXTRACTION_BYTES): Promise<RustIntegratedRuntimeExtractionV1> {
    this.requireReady();
    this.requireBoundedExtractionAvailable();
    return this.enqueue(async () => {
      const started = this.now();
      try {
        const expected = this.requireIdentity();
        const response = await this.send({
          type: "runtime-extract-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected,
          afterRevision,
          maxBytes,
        });
        this.acceptWorkerEpoch(response);
        if (response.type !== "runtime-extraction-v1") throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime extract did not return an extraction batch");
        if (!rustIntegratedRuntimeIdentityEqualsV1(response.extraction.identity, expected)) {
          this.staleResponses += 1;
          throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime extraction is stale relative to authoritative state");
        }
        return response.extraction;
      } catch (error) {
        this.failClosed(error);
        throw error;
      } finally {
        this.recordMetric("extract", this.now() - started);
      }
    });
  }

  /**
   * Polls one Rust-owned platform request. The returned BWPR payload is one
   * transferred attachment; browser code may execute it but must not decode it
   * to make persistence policy decisions.
   */
  pollBulkPlatform(maxBytes = RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1) {
    this.requireReady();
    this.requireBulkCapability();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1) {
      return Promise.reject(new RustIntegratedRuntimeServiceError("capacity", "bulk platform poll exceeds its byte budget"));
    }
    return this.enqueue(async () => {
      const expected = this.requireIdentity();
      try {
        const response = await this.sendBulk({
          type: "runtime-bulk-poll-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected: rustIntegratedRuntimeBulkStateV1(expected),
          maxBytes,
        });
        this.acceptBulkWorkerEpoch(response);
        if (response.type === "runtime-bulk-error-v1") return this.rejectBulkError(response, expected);
        if (response.type !== "runtime-bulk-empty-v1" && response.type !== "runtime-bulk-platform-request-v1") {
          throw this.failBulkProtocol("bulk poll returned the wrong operation");
        }
        if (!bulkStateEqualsIdentity(response.current, expected)) throw this.failBulkProtocol("bulk poll changed or regressed authority state");
        return response;
      } catch (error) {
        if (error instanceof RustIntegratedRuntimeServiceError && error.code === "bulk-platform") throw error;
        this.failClosed(error);
        throw error;
      }
    });
  }

  /**
   * Completes one Rust-issued platform token with a complete opaque BWPA.
   * The caller relinquishes the supplied ArrayBuffer when this queued call is
   * dispatched. A crash after dispatch is indeterminate and fails closed.
   */
  completeBulkPlatform(transferToken: number, payload: Uint8Array) {
    this.requireReady();
    this.requireBulkCapability();
    if (!Number.isSafeInteger(transferToken) || transferToken < 1) {
      return Promise.reject(new RustIntegratedRuntimeServiceError("bulk-platform", "bulk platform transfer token is invalid"));
    }
    if (!(payload instanceof Uint8Array) || payload.byteLength > RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1) {
      return Promise.reject(new RustIntegratedRuntimeServiceError("capacity", "bulk platform response exceeds its byte budget"));
    }
    return this.enqueue(async () => {
      const expected = this.requireIdentity();
      try {
        const response = await this.sendBulk({
          type: "runtime-bulk-complete-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected: rustIntegratedRuntimeBulkStateV1(expected),
          transferToken,
          typeId: RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1,
          payload,
        });
        this.acceptBulkWorkerEpoch(response);
        if (response.type === "runtime-bulk-error-v1") return this.rejectBulkError(response, expected);
        if (response.type !== "runtime-bulk-completed-v1") throw this.failBulkProtocol("bulk completion returned the wrong operation");
        const after = identityFromBulkState(expected, response.current);
        if (!identityDoesNotRegress(expected, after)) throw this.failBulkProtocol("bulk completion regressed authoritative state");
        this.currentIdentity = after;
        return response;
      } catch (error) {
        if (error instanceof RustIntegratedRuntimeServiceError && error.code === "bulk-platform") throw error;
        this.failClosed(error);
        throw error;
      }
    });
  }

  /** Stages one bounded canonical compatibility-save chunk inside Rust. */
  stageCompatibilitySaveChunk(
    stageId: string,
    chunkIndex: number,
    chunkCount: number,
    totalBytes: number,
    payload: Uint8Array,
  ) {
    this.requireReady();
    this.requireNativeSaveCapability();
    if (!(payload instanceof Uint8Array) || payload.byteLength < 1 || payload.byteLength > RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1) {
      return Promise.reject(new RustIntegratedRuntimeServiceError("capacity", "compatibility save chunk exceeds its 4 MiB byte budget"));
    }
    return this.enqueue(async () => {
      const expected = this.requireIdentity();
      try {
        const response = await this.sendBulk({
          type: "runtime-bulk-stage-save-chunk-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected: rustIntegratedRuntimeBulkStateV1(expected),
          stageId,
          chunkIndex,
          chunkCount,
          totalBytes,
          payload,
        });
        this.acceptBulkWorkerEpoch(response);
        if (response.type === "runtime-bulk-error-v1") return this.rejectBulkError(response, expected);
        if (response.type !== "runtime-bulk-save-progress-v1" || response.state !== "staged" || response.stageId !== stageId) {
          throw this.failBulkProtocol("bulk save stage returned the wrong receipt");
        }
        this.acceptBulkAuthorityAdvance(expected, response.current, "bulk save stage");
        return response;
      } catch (error) {
        if (error instanceof RustIntegratedRuntimeServiceError && error.code === "bulk-platform") throw error;
        this.failClosed(error);
        throw error;
      }
    });
  }

  /** Finalizes the staged save set and lets Rust enqueue its own commit. */
  finalizeCompatibilitySave(stageId: string, createdAt: number) {
    this.requireReady();
    this.requireNativeSaveCapability();
    return this.enqueue(async () => {
      const expected = this.requireIdentity();
      try {
        const response = await this.sendBulk({
          type: "runtime-bulk-finalize-save-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected: rustIntegratedRuntimeBulkStateV1(expected),
          stageId,
          createdAt,
        });
        this.acceptBulkWorkerEpoch(response);
        if (response.type === "runtime-bulk-error-v1") return this.rejectBulkError(response, expected);
        if (response.type !== "runtime-bulk-save-progress-v1" || response.state !== "finalized" || response.stageId !== stageId) {
          throw this.failBulkProtocol("bulk save finalize returned the wrong receipt");
        }
        this.acceptBulkAuthorityAdvance(expected, response.current, "bulk save finalize");
        return response;
      } catch (error) {
        if (error instanceof RustIntegratedRuntimeServiceError && error.code === "bulk-platform") throw error;
        this.failClosed(error);
        throw error;
      }
    });
  }

  /** Creates or advances a native-only save set through its dedicated Wasm gate. */
  initializeNativeSave(saveId: string, createdAt: number) {
    this.requireReady();
    this.requireNativeSaveCapability();
    return this.enqueue(async () => {
      const expected = this.requireIdentity();
      try {
        const response = await this.sendBulk({
          type: "runtime-bulk-initialize-native-save-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected: rustIntegratedRuntimeBulkStateV1(expected),
          saveId,
          createdAt,
        });
        this.acceptBulkWorkerEpoch(response);
        if (response.type === "runtime-bulk-error-v1") return this.rejectBulkError(response, expected);
        if (response.type !== "runtime-bulk-save-progress-v1" || response.state !== "finalized" || response.stageId !== saveId) {
          throw this.failBulkProtocol("bulk native save initialization returned the wrong receipt");
        }
        this.acceptBulkAuthorityAdvance(expected, response.current, "bulk native save initialization");
        return response;
      } catch (error) {
        if (error instanceof RustIntegratedRuntimeServiceError && error.code === "bulk-platform") throw error;
        this.failClosed(error);
        throw error;
      }
    });
  }

  /** Hydrates every required native domain atomically from an assembled recovery. */
  hydrateCompatibilityRecovery(recoveryId: string) {
    this.requireReady();
    this.requireNativeSaveCapability();
    return this.enqueue(async () => {
      const expected = this.requireIdentity();
      try {
        const response = await this.sendBulk({
          type: "runtime-bulk-hydrate-recovery-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected: rustIntegratedRuntimeBulkStateV1(expected),
          recoveryId,
        });
        this.acceptBulkWorkerEpoch(response);
        if (response.type === "runtime-bulk-error-v1") return this.rejectBulkError(response, expected);
        if (response.type !== "runtime-bulk-hydration-v1" || response.recoveryId !== recoveryId) {
          throw this.failBulkProtocol("bulk recovery hydration returned the wrong receipt");
        }
        this.acceptBulkAuthorityAdvance(expected, response.current, "bulk recovery hydration");
        return response;
      } catch (error) {
        if (error instanceof RustIntegratedRuntimeServiceError && error.code === "bulk-platform") throw error;
        this.failClosed(error);
        throw error;
      }
    });
  }

  /** Reads one compatibility shell chunk; these bytes are never runtime authority. */
  readHydratedCompatibility(recoveryId: string, chunkIndex: number) {
    this.requireReady();
    this.requireNativeSaveCapability();
    return this.enqueue(async () => {
      const expected = this.requireIdentity();
      try {
        const response = await this.sendBulk({
          type: "runtime-bulk-read-hydrated-compatibility-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected: rustIntegratedRuntimeBulkStateV1(expected),
          recoveryId,
          chunkIndex,
        });
        this.acceptBulkWorkerEpoch(response);
        if (response.type === "runtime-bulk-error-v1") return this.rejectBulkError(response, expected);
        if (response.type !== "runtime-bulk-data-v1" || response.chunkIndex !== chunkIndex) {
          throw this.failBulkProtocol("bulk compatibility read returned the wrong chunk");
        }
        if (!bulkStateEqualsIdentity(response.current, expected)) throw this.failBulkProtocol("bulk compatibility read changed authority state");
        return response;
      } catch (error) {
        if (error instanceof RustIntegratedRuntimeServiceError && error.code === "bulk-platform") throw error;
        this.failClosed(error);
        throw error;
      }
    });
  }

  /** Explicitly discards a staged save after cancellation or shutdown recovery. */
  cancelCompatibilitySaveStage(stageId: string) {
    this.requireReady();
    this.requireNativeSaveCapability();
    return this.enqueue(async () => {
      const expected = this.requireIdentity();
      try {
        const response = await this.sendBulk({
          type: "runtime-bulk-cancel-save-stage-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected: rustIntegratedRuntimeBulkStateV1(expected),
          stageId,
        });
        this.acceptBulkWorkerEpoch(response);
        if (response.type === "runtime-bulk-error-v1") return this.rejectBulkError(response, expected);
        if (response.type !== "runtime-bulk-save-progress-v1" || response.state !== "cancelled" || response.stageId !== stageId) {
          throw this.failBulkProtocol("bulk save cancellation returned the wrong receipt");
        }
        this.acceptBulkAuthorityAdvance(expected, response.current, "bulk save cancellation");
        return response;
      } catch (error) {
        if (error instanceof RustIntegratedRuntimeServiceError && error.code === "bulk-platform") throw error;
        this.failClosed(error);
        throw error;
      }
    });
  }

  bulkDiagnostics(): RustIntegratedRuntimeBulkTransportDiagnosticsV1 | null {
    const transport = this.transport;
    return transport && isBulkTransport(transport) ? transport.bulkDiagnostics() : null;
  }

  /**
   * Explicit recovery only. Reliable commands are never replayed across a
   * crash because the browser cannot know whether the old worker committed.
   */
  async restore(expectedCheckpointHash: string, checkpoint: Uint8Array) {
    if (this.state !== "failed") throw new RustIntegratedRuntimeServiceError("not-ready", "runtime restore is allowed only after a failed worker generation");
    this.state = "recovering";
    this.clientEpoch += 1;
    this.workerEpoch = 0;
    this.transport?.dispose();
    this.transport = this.options.transportFactory();
    try {
      const response = await this.send({
        type: "runtime-restore-v1",
        requestId: this.requestId(),
        clientEpoch: this.clientEpoch,
        expectedCheckpointHash,
        checkpoint: Uint8Array.from(checkpoint),
      });
      if (response.type !== "runtime-restored-v1" || response.checkpointHash !== expectedCheckpointHash) {
        throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime restore did not prove the supplied checkpoint hash");
      }
      this.acceptWorkerEpoch(response);
      this.verifyAttestation(response);
      this.currentIdentity = response.identity;
      const indeterminate = [...this.idempotency.entries()]
        .filter((entry): entry is [string, Extract<IdempotencyEntry, { state: "indeterminate" }>] => entry[1].state === "indeterminate");
      for (const [key, entry] of indeterminate) {
        await this.reconcileIndeterminateCommand(entry.batch, key);
      }
      this.state = "ready";
      return response.identity;
    } catch (error) {
      this.failClosed(error);
      throw error;
    }
  }

  checkpoint() {
    this.requireReady();
    return this.enqueue(async () => {
      try {
        const expected = this.requireIdentity();
        const response = await this.send({
          type: "runtime-checkpoint-v1",
          requestId: this.requestId(),
          clientEpoch: this.clientEpoch,
          expected,
        });
        this.acceptWorkerEpoch(response);
        if (response.type !== "runtime-checkpoint-v1") throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime checkpoint was not returned");
        if (!rustIntegratedRuntimeIdentityEqualsV1(response.identity, expected)) throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime checkpoint is stale");
        return Object.freeze({ checkpoint: response.checkpoint, checkpointHash: response.checkpointHash, identity: response.identity });
      } catch (error) {
        this.failClosed(error);
        throw error;
      }
    });
  }

  async shutdown() {
    if (this.state === "stopped") return;
    if (this.state === "failed" || this.state === "idle") {
      this.transport?.dispose();
      this.transport = null;
      this.state = "stopped";
      return;
    }
    this.state = "stopping";
    await this.serial.catch(() => undefined);
    try {
      const response = await this.send({
        type: "runtime-shutdown-v1",
        requestId: this.requestId(),
        clientEpoch: this.clientEpoch,
        expected: this.currentIdentity,
      });
      this.acceptWorkerEpoch(response);
      if (response.type !== "runtime-shutdown-v1") throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime shutdown was not acknowledged");
    } finally {
      this.transport?.dispose();
      this.transport = null;
      this.currentIdentity = null;
      this.authoritative = false;
      this.verifiedCapabilities.clear();
      this.configuredContentHash = null;
      this.contentRequired = false;
      this.contentAttestation = null;
      this.contentInstallPromise = null;
      this.state = "stopped";
    }
  }

  diagnostics(): RustIntegratedRuntimeServiceDiagnosticsV1 {
    const commandP95Ms = percentile(this.metrics.command, 0.95);
    const stepP95Ms = percentile(this.metrics.step, 0.95);
    const extractP95Ms = percentile(this.metrics.extract, 0.95);
    const fixedStepInputReady = this.verifiedCapabilities.has(FIXED_STEP_INPUT_CAPABILITY);
    const boundedExtractionReady = this.verifiedCapabilities.has(BOUNDED_EXTRACTION_CAPABILITY);
    return Object.freeze({
      state: this.state,
      authoritative: this.authoritative,
      verification: this.verification,
      clientEpoch: this.clientEpoch,
      workerEpoch: this.workerEpoch,
      requests: this.requests,
      acceptedCommands: this.acceptedCommands,
      rejectedCommands: this.rejectedCommands,
      cachedReceipts: [...this.idempotency.values()].filter((entry) => entry.state === "settled").length,
      indeterminateCommands: [...this.idempotency.values()].filter((entry) => entry.state === "indeterminate").length,
      staleResponses: this.staleResponses,
      failures: this.failures,
      commandP95Ms,
      stepP95Ms,
      extractP95Ms,
      commandBudgetMet: commandP95Ms <= RUST_INTEGRATED_RUNTIME_COMMAND_P95_BUDGET_MS,
      stepBudgetMet: stepP95Ms <= RUST_INTEGRATED_RUNTIME_STEP_P95_BUDGET_MS,
      extractBudgetMet: extractP95Ms <= RUST_INTEGRATED_RUNTIME_EXTRACT_P95_BUDGET_MS,
      lastError: this.lastError,
      contentReady: this.contentAttestation?.status === "installed",
      contentManifestHash: this.contentAttestation?.manifestHash ?? null,
      fixedStepInputReady,
      boundedExtractionAvailable: this.hasBoundedExtractionAvailable(),
      boundedExtractionReady,
      liveAuthorityReady: this.authoritative && fixedStepInputReady && boundedExtractionReady,
      capabilities: Object.freeze([...this.verifiedCapabilities].sort()),
    });
  }

  private verifyReady(response: Extract<RustIntegratedRuntimeResponseV1, { type: "runtime-ready-v1" }>) {
    this.verifyAttestation(response);
  }

  private verifyAttestation(response: Extract<RustIntegratedRuntimeResponseV1, { type: "runtime-ready-v1" | "runtime-restored-v1" }>) {
    if (response.runtimeHandle < 1) throw new RustIntegratedRuntimeServiceError("invalid-response", "runtime did not provide a live generational handle");
    for (const capability of REQUIRED_BASE_CAPABILITIES) {
      if (!response.capabilities.includes(capability)) throw new RustIntegratedRuntimeServiceError("invalid-response", `runtime artifact lacks ${capability}`);
    }
    this.verifiedCapabilities = new Set(response.capabilities);
    this.contentRequired = response.capabilities.includes(RUST_CONTENT_INSTALL_CAPABILITY_V1);
    if (this.mode === "production") {
      if (response.artifactHash !== this.options.expectedArtifactHash) {
        throw new RustIntegratedRuntimeServiceError("artifact-mismatch", "runtime ready hash does not match the content-addressed artifact selected by the loader");
      }
      this.authoritative = !this.contentRequired;
      this.verification = "content-addressed-wasm";
    } else {
      this.authoritative = false;
      this.verification = "protocol-test";
    }
  }

  private requestId() {
    const value = this.nextRequestId;
    this.nextRequestId = this.nextRequestId >= 0xffff_ffff ? 1 : this.nextRequestId + 1;
    return value;
  }

  private async send(
    request: RustIntegratedRuntimeRequestV1,
    allowRuntimeError?: false,
  ): Promise<Exclude<RustIntegratedRuntimeResponseV1, { type: "runtime-error-v1" }>>;
  private async send(
    request: RustIntegratedRuntimeRequestV1,
    allowRuntimeError: true,
  ): Promise<RustIntegratedRuntimeResponseV1>;
  private async send(request: RustIntegratedRuntimeRequestV1, allowRuntimeError = false) {
    const transport = this.transport;
    if (!transport) throw new RustIntegratedRuntimeServiceError("disposed", "integrated runtime transport is absent");
    this.requests += 1;
    let response: RustIntegratedRuntimeResponseV1;
    try {
      response = await transport.request(request);
    } catch (error) {
      throw new RustIntegratedRuntimeServiceError("worker-failed", "integrated runtime worker request failed", error);
    }
    if (response.clientEpoch !== this.clientEpoch || response.requestId !== request.requestId) {
      this.staleResponses += 1;
      throw new RustIntegratedRuntimeServiceError("invalid-response", "integrated runtime response has a stale epoch or request id");
    }
    if (response.type === "runtime-error-v1" && !allowRuntimeError) {
      throw new RustIntegratedRuntimeServiceError("worker-failed", `${response.code}: ${response.message}`);
    }
    return response;
  }

  private sendBulk(request: Parameters<RustIntegratedRuntimeBulkTransportV1["requestBulk"]>[0]) {
    const transport = this.transport;
    if (!transport || !isBulkTransport(transport)) throw new RustIntegratedRuntimeServiceError("not-ready", "integrated runtime bulk transport is absent");
    this.requests += 1;
    return transport.requestBulk(request).catch((error) => {
      throw new RustIntegratedRuntimeServiceError("worker-failed", "integrated runtime bulk worker request failed", error);
    });
  }

  private acceptBulkWorkerEpoch(response: RustIntegratedRuntimeBulkResponseV1) {
    if (response.clientEpoch !== this.clientEpoch || response.workerEpoch < 1 || response.workerEpoch !== this.workerEpoch) {
      this.staleResponses += 1;
      throw this.failBulkProtocol("bulk response belongs to another client or worker generation");
    }
  }

  private rejectBulkError(
    response: Extract<RustIntegratedRuntimeBulkResponseV1, { type: "runtime-bulk-error-v1" }>,
    expected: RustIntegratedRuntimeIdentityV1,
  ): never {
    if (response.current && !bulkStateEqualsIdentity(response.current, expected)) {
      throw this.failBulkProtocol("bulk rejection returned unexpected authority state");
    }
    throw new RustIntegratedRuntimeServiceError("bulk-platform", `${response.code}: ${response.message}`);
  }

  private failBulkProtocol(message: string) {
    return new RustIntegratedRuntimeServiceError("invalid-response", message);
  }

  private acceptBulkAuthorityAdvance(
    before: RustIntegratedRuntimeIdentityV1,
    state: RustIntegratedRuntimeBulkStateV1,
    operation: string,
  ) {
    const after = identityFromBulkState(before, state);
    if (!identityDoesNotRegress(before, after)) throw this.failBulkProtocol(`${operation} regressed authoritative state`);
    this.currentIdentity = after;
  }

  private acceptWorkerEpoch(response: RustIntegratedRuntimeResponseV1) {
    if (response.workerEpoch < 1) {
      this.staleResponses += 1;
      throw new RustIntegratedRuntimeServiceError("invalid-response", "integrated runtime response has an invalid worker generation");
    }
    if (this.workerEpoch === 0) this.workerEpoch = response.workerEpoch;
    else if (response.workerEpoch !== this.workerEpoch) {
      this.staleResponses += 1;
      throw new RustIntegratedRuntimeServiceError("invalid-response", "integrated runtime response belongs to another worker generation");
    }
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const result = this.serial.then(operation, operation);
    this.serial = result.then(() => undefined, () => undefined);
    return result;
  }

  private retainIdempotencyKey(key: string) {
    if (!this.idempotencyOrder.includes(key)) this.idempotencyOrder.push(key);
    while (this.idempotencyOrder.length > RUST_INTEGRATED_RUNTIME_MAX_IDEMPOTENCY_RECEIPTS) {
      const expired = this.idempotencyOrder.shift();
      if (expired) this.idempotency.delete(expired);
    }
  }

  private recordMetric(kind: MetricKind, durationMs: number) {
    const values = this.metrics[kind];
    values.push(Math.max(0, durationMs));
    if (values.length > 512) values.shift();
  }

  private failClosed(error: unknown) {
    this.failures += 1;
    const normalized = error instanceof RustIntegratedRuntimeServiceError
      ? error
      : new RustIntegratedRuntimeServiceError("worker-failed", error instanceof Error ? error.message : String(error), error);
    this.lastError = Object.freeze({ code: normalized.code, message: normalized.message });
    this.authoritative = false;
    this.verifiedCapabilities.clear();
    this.contentAttestation = null;
    this.contentInstallPromise = null;
    this.state = "failed";
    this.transport?.dispose();
    this.transport = null;
  }

  private requireIdentity() {
    if (!this.currentIdentity) throw new RustIntegratedRuntimeServiceError("not-ready", "integrated runtime has no current authority identity");
    return this.currentIdentity;
  }

  private requireReady(allowContentPending = false) {
    if (this.state !== "ready") throw new RustIntegratedRuntimeServiceError("not-ready", `integrated runtime is ${this.state}`);
    if (this.mode === "production" && !this.authoritative
      && !(allowContentPending && this.contentRequired && this.verification === "content-addressed-wasm")) {
      throw new RustIntegratedRuntimeServiceError("not-authoritative", this.contentRequired
        ? "integrated runtime has not installed and attested its production content bundle"
        : "integrated runtime has not verified an exact Wasm artifact");
    }
  }

  private requireBulkCapability() {
    if (!this.verifiedCapabilities.has("bulk-platform-v1")) {
      throw new RustIntegratedRuntimeServiceError("not-authoritative", "integrated runtime artifact has not registered the bulk platform dispatcher");
    }
  }

  private requireNativeSaveCapability() {
    this.requireBulkCapability();
    if (!this.verifiedCapabilities.has("native-save-hydration-v1")) {
      throw new RustIntegratedRuntimeServiceError(
        "not-authoritative",
        "native save hydration remains pending until every registered durable domain has a canonical Rust record",
      );
    }
  }

  private requireCapability(capability: string, message: string) {
    if (!this.verifiedCapabilities.has(capability)) {
      throw new RustIntegratedRuntimeServiceError("not-authoritative", message);
    }
  }

  private hasBoundedExtractionAvailable() {
    return this.verifiedCapabilities.has(BOUNDED_EXTRACTION_CAPABILITY)
      || this.verifiedCapabilities.has(BOUNDED_ENTITY_EXTRACTION_CAPABILITY)
        && this.verifiedCapabilities.has(BOUNDED_EXTRACTION_BLOCKERS_CAPABILITY);
  }

  private requireBoundedExtractionAvailable() {
    if (!this.hasBoundedExtractionAvailable()) {
      throw new RustIntegratedRuntimeServiceError(
        "not-authoritative",
        "runtime artifact exposes neither complete extraction nor the bounded shadow extraction contract",
      );
    }
  }
}

function isBulkTransport(value: RustIntegratedRuntimeTransportV1): value is RustIntegratedRuntimeTransportV1 & RustIntegratedRuntimeBulkTransportV1 {
  const candidate = value as Partial<RustIntegratedRuntimeBulkTransportV1>;
  return typeof candidate.requestBulk === "function" && typeof candidate.bulkDiagnostics === "function";
}

function contentDomainDigestsEqual(
  left: RustContentInstallReceiptV1["domains"],
  right: RustContentInstallReceiptV1["domains"],
) {
  const keys = Object.keys(right) as Array<keyof typeof right>;
  return keys.length === Object.keys(left).length
    && keys.every((key) => left[key]?.count === right[key].count && left[key]?.hash === right[key].hash);
}

function bulkStateEqualsIdentity(state: RustIntegratedRuntimeBulkStateV1, identity: RustIntegratedRuntimeIdentityV1) {
  return state.tick === identity.tick
    && state.stateHash === identity.stateHash
    && (Object.keys(state.revision) as Array<keyof RustIntegratedRuntimeIdentityV1["revision"]>)
      .every((key) => state.revision[key] === identity.revision[key]);
}

function identityFromBulkState(
  identity: RustIntegratedRuntimeIdentityV1,
  state: RustIntegratedRuntimeBulkStateV1,
): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: identity.universeId,
    locationId: identity.locationId,
    revision: state.revision,
    tick: state.tick,
    stateHash: state.stateHash,
  });
}
