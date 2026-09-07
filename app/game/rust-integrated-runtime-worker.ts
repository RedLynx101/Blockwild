import {
  RUST_INTEGRATED_RUNTIME_MAX_PENDING_REQUESTS,
  type RustIntegratedRuntimeRequestV1,
  type RustIntegratedRuntimeResponseV1,
  type RustIntegratedRuntimeStepRequestV2,
  type RustIntegratedRuntimeStepResultV2,
  type RustIntegratedRuntimeTransportV1,
} from "./rust-integrated-runtime-contract";
import {
  decodeRustIntegratedRuntimeRequestV1,
  decodeRustIntegratedRuntimeResponseV1,
  decodeRustIntegratedRuntimeStepRequestV2,
  decodeRustIntegratedRuntimeStepResultV2,
  encodeRustIntegratedRuntimeRequestV1,
  encodeRustIntegratedRuntimeResponseV1,
  encodeRustIntegratedRuntimeStepRequestV2,
  encodeRustIntegratedRuntimeStepResultV2,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec";
import {
  RUST_INTEGRATED_RUNTIME_BULK_MAX_PENDING_V1,
  RUST_INTEGRATED_RUNTIME_BULK_MAX_QUEUED_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1,
  decodeRustIntegratedRuntimeBulkRequestV1,
  decodeRustIntegratedRuntimeBulkResponseV1,
  encodeRustIntegratedRuntimeBulkRequestV1,
  encodeRustIntegratedRuntimeBulkResponseV1,
  type RustIntegratedRuntimeBulkRequestV1,
  type RustIntegratedRuntimeBulkResponseV1,
  type RustIntegratedRuntimeBulkTransportDiagnosticsV1,
} from "./rust-integrated-runtime-bulk-platform";
import { RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1 } from "./rust-persistence-runtime-contract";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated.ts";

export const RUST_INTEGRATED_RUNTIME_BULK_TIMEOUT_WORK_QUANTUM_BYTES_V1 = 4 * 1024 * 1024;
export const RUST_INTEGRATED_RUNTIME_BULK_TIMEOUT_MAX_MULTIPLIER_V1 = 24;
export const RUST_INTEGRATED_RUNTIME_BULK_TIMEOUT_MAX_MS_V1 = 120_000;
export const RUST_INTEGRATED_RUNTIME_BOOTSTRAP_TIMEOUT_MAX_MULTIPLIER_V1 = 12;
export const RUST_INTEGRATED_RUNTIME_BOOTSTRAP_TIMEOUT_MAX_MS_V1 = 60_000;
export const RUST_INTEGRATED_RUNTIME_CONTENT_INSTALL_TIMEOUT_MAX_MULTIPLIER_V1 = 24;
export const RUST_INTEGRATED_RUNTIME_CONTENT_INSTALL_TIMEOUT_MAX_MS_V1 = 120_000;

const RUST_CONTENT_INSTALL_PAGE_SCHEMA_V1 = rustIntegratedRuntimeDomainWireFamilyV1("content-install-page-v1");
const RUST_CONTENT_INSTALL_PAGE_TYPE_V1 = RUST_CONTENT_INSTALL_PAGE_SCHEMA_V1.typeId;
const RUST_CONTENT_INSTALL_PAGE_HEADER_BYTES_V1 = 28;
const RUST_CONTENT_INSTALL_PAGE_MAGIC_V1 = Object.freeze([
  ...new TextEncoder().encode(RUST_CONTENT_INSTALL_PAGE_SCHEMA_V1.magic),
]);
const RUST_CONTENT_INSTALL_PAGE_BUDGET_V1 = 768 * 1024;
const RUST_CONTENT_INSTALL_MAX_PAGES_V1 = 128;
const RUST_CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1 = 1_024;
const RUST_CONTENT_INSTALL_DOMAIN_COUNT_V1 = 11;
const RUST_CONTENT_INSTALL_MAX_ALIASES_V1 = 16;
const RUST_CONTENT_INSTALL_MAX_CANONICAL_BYTES_V1 = 256 * 1024;
const RUST_CONTENT_INSTALL_MAX_EXTENSION_BYTES_V1 = 64 * 1024;
const RUST_CONTENT_INSTALL_MAX_STRING_BYTES_V1 = 16 * 1024;

class RustContentInstallPageShapeReaderV1 {
  private offset = 0;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  constructor(private readonly bytes: Uint8Array) {}

  u8() { return this.take(1)[0]; }
  u16() {
    const bytes = this.take(2);
    return bytes[0] | (bytes[1] << 8);
  }
  u32() {
    const bytes = this.take(4);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  }
  hash() { this.take(16); }
  string() {
    const length = this.u32();
    if (length < 1 || length > RUST_CONTENT_INSTALL_MAX_STRING_BYTES_V1) throw new Error("content string is outside its bound");
    const value = this.decoder.decode(this.take(length));
    if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error("content string contains a control character");
  }
  boundedBytes(maximum: number) {
    const length = this.u32();
    if (length > maximum) throw new Error("content bytes exceed their bound");
    this.take(length);
  }
  finish() {
    if (this.offset !== this.bytes.byteLength) throw new Error("content page has trailing bytes");
  }

  private take(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.bytes.byteLength - this.offset) {
      throw new Error("content page is truncated");
    }
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
}

function bytesToHexV1(bytes: Uint8Array) {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function rustContentInstallPageShapeV1(
  body: Uint8Array,
): Readonly<{ pageIndex: number; pageCount: number }> | null {
  try {
    const reader = new RustContentInstallPageShapeReaderV1(body);
    reader.string();
    if (reader.u16() !== 1) return null;
    reader.string();
    reader.hash();
    if (reader.u16() !== RUST_CONTENT_INSTALL_DOMAIN_COUNT_V1) return null;
    for (let tag = 0; tag < RUST_CONTENT_INSTALL_DOMAIN_COUNT_V1; tag += 1) {
      if (reader.u8() !== tag) return null;
      reader.u32();
      reader.hash();
    }
    const pageIndex = reader.u32();
    const pageCount = reader.u32();
    const artifactCount = reader.u32();
    if (pageCount < 1 || pageCount > RUST_CONTENT_INSTALL_MAX_PAGES_V1
      || pageIndex >= pageCount || artifactCount < 1
      || artifactCount > RUST_CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1) return null;
    for (let index = 0; index < artifactCount; index += 1) {
      if (reader.u8() >= RUST_CONTENT_INSTALL_DOMAIN_COUNT_V1) return null;
      reader.string();
      reader.string();
      reader.u16();
      reader.u32();
      const aliasCount = reader.u32();
      if (aliasCount > RUST_CONTENT_INSTALL_MAX_ALIASES_V1) return null;
      for (let alias = 0; alias < aliasCount; alias += 1) reader.string();
      reader.boundedBytes(RUST_CONTENT_INSTALL_MAX_CANONICAL_BYTES_V1);
      reader.boundedBytes(RUST_CONTENT_INSTALL_MAX_EXTENSION_BYTES_V1);
    }
    reader.finish();
    return Object.freeze({ pageIndex, pageCount });
  } catch {
    return null;
  }
}

function isExactRustContentInstallPageRequestV1(request: RustIntegratedRuntimeRequestV1) {
  if (request.type !== "runtime-command-v1" || request.batch.operations.length !== 1) return false;
  const operation = request.batch.operations[0];
  const payload = operation.payload;
  if (operation.domain !== "gameplay"
    || operation.typeId !== RUST_CONTENT_INSTALL_PAGE_TYPE_V1
    || operation.schema !== RUST_CONTENT_INSTALL_PAGE_SCHEMA_V1.operationSchema
    || payload.byteLength < RUST_CONTENT_INSTALL_PAGE_HEADER_BYTES_V1
    || payload.byteLength > RUST_CONTENT_INSTALL_PAGE_BUDGET_V1
    || !RUST_CONTENT_INSTALL_PAGE_MAGIC_V1.every((byte, index) => payload[index] === byte)) return false;
  const header = new DataView(
    payload.buffer,
    payload.byteOffset,
    RUST_CONTENT_INSTALL_PAGE_HEADER_BYTES_V1,
  );
  const body = payload.subarray(RUST_CONTENT_INSTALL_PAGE_HEADER_BYTES_V1);
  if (header.getUint16(4, true) !== 1
    || header.getUint16(6, true) !== RUST_CONTENT_INSTALL_PAGE_SCHEMA_V1.innerSchema
    || header.getUint32(8, true) !== body.byteLength
    || bytesToHexV1(payload.subarray(12, RUST_CONTENT_INSTALL_PAGE_HEADER_BYTES_V1))
      !== rustIntegratedRuntimeWireChecksumV1(body)) return false;
  const shape = rustContentInstallPageShapeV1(body);
  return shape !== null;
}

/**
 * A fresh module worker must compile/instantiate Wasm before create or restore
 * can answer, and that bounded bootstrap can exceed the routine command
 * watchdog on slower browser/SwiftShader runs. Content-install pages likewise
 * materialize and hash bounded registry state on every page. Keep all other
 * requests on the routine deadline; only these named bootstrap operations or
 * an exact, fully validated, versioned BWC7 installer envelope receive a wider
 * bound.
 */
export function rustIntegratedRuntimeRequestTimeoutMsV1(
  request: RustIntegratedRuntimeRequestV1,
  routineTimeoutMs: number,
) {
  if (request.type === "runtime-create-v1" || request.type === "runtime-restore-v1") {
    return Math.max(
      routineTimeoutMs,
      Math.min(
        RUST_INTEGRATED_RUNTIME_BOOTSTRAP_TIMEOUT_MAX_MS_V1,
        routineTimeoutMs * RUST_INTEGRATED_RUNTIME_BOOTSTRAP_TIMEOUT_MAX_MULTIPLIER_V1,
      ),
    );
  }
  if (!isExactRustContentInstallPageRequestV1(request)) return routineTimeoutMs;
  return Math.max(
    routineTimeoutMs,
    Math.min(
      RUST_INTEGRATED_RUNTIME_CONTENT_INSTALL_TIMEOUT_MAX_MS_V1,
      routineTimeoutMs * RUST_INTEGRATED_RUNTIME_CONTENT_INSTALL_TIMEOUT_MAX_MULTIPLIER_V1,
    ),
  );
}

function rustIntegratedRuntimeBulkWorkBytesV1(
  request: RustIntegratedRuntimeBulkRequestV1,
  attachmentBytes: number,
): number {
  switch (request.type) {
    case "runtime-bulk-poll-v1":
      return Math.max(attachmentBytes, request.maxBytes);
    case "runtime-bulk-finalize-save-v1":
    case "runtime-bulk-hydrate-recovery-v1":
    case "runtime-bulk-initialize-native-save-v1":
    case "runtime-bulk-migrate-legacy-world-v1":
    case "runtime-bulk-migrate-historical-external-v2":
    case "runtime-bulk-finalize-historical-external-save-v2":
    case "runtime-bulk-hydrate-historical-external-v2":
    case "runtime-bulk-reconcile-historical-external-fallback-v2":
      return Math.max(attachmentBytes, RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1);
    case "runtime-bulk-persistence-status-v1":
      // The request is intentionally tiny, but producing BWT8 reconstructs
      // and hashes the complete terminal save set. Budget against the bounded
      // aggregate persistence custody rather than the inline request bytes.
      return Math.max(attachmentBytes, RUST_INTEGRATED_RUNTIME_BULK_MAX_QUEUED_BYTES_V1);
    case "runtime-bulk-read-hydrated-compatibility-v1":
      return Math.max(attachmentBytes, RUST_INTEGRATED_RUNTIME_BULK_SAVE_CHUNK_BYTES_V1);
    default:
      return attachmentBytes;
  }
}

/**
 * Keep the latency-sensitive lane tight while giving bounded recovery-scale
 * work enough time for repeated hashing, Wasm copies, and IndexedDB I/O.
 */
export function rustIntegratedRuntimeBulkTimeoutMsV1(
  request: RustIntegratedRuntimeBulkRequestV1,
  attachmentBytes: number,
  routineTimeoutMs: number,
): number {
  const workBytes = rustIntegratedRuntimeBulkWorkBytesV1(request, attachmentBytes);
  if (workBytes <= RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1) return routineTimeoutMs;
  const additionalQuanta = Math.ceil(
    (workBytes - RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1)
      / RUST_INTEGRATED_RUNTIME_BULK_TIMEOUT_WORK_QUANTUM_BYTES_V1,
  );
  const multiplier = Math.min(
    RUST_INTEGRATED_RUNTIME_BULK_TIMEOUT_MAX_MULTIPLIER_V1,
    1 + additionalQuanta,
  );
  return Math.max(
    routineTimeoutMs,
    Math.min(RUST_INTEGRATED_RUNTIME_BULK_TIMEOUT_MAX_MS_V1, routineTimeoutMs * multiplier),
  );
}

export type RustIntegratedRuntimeWorkerMessageV1 = Readonly<{
  type: "blockwild-integrated-runtime-wire-v1";
  bytes: ArrayBuffer;
}>;

export type RustIntegratedRuntimeStepWorkerMessageV2 = Readonly<{
  type: "blockwild-integrated-runtime-step-v2";
  bytes: ArrayBuffer;
}>;

export type RustIntegratedRuntimeBulkWorkerMessageV1 = Readonly<{
  type: "blockwild-integrated-runtime-bulk-v1";
  control: ArrayBuffer;
  attachment: ArrayBuffer;
}>;

export type RustIntegratedRuntimeAnyWorkerMessageV1 = RustIntegratedRuntimeWorkerMessageV1
  | RustIntegratedRuntimeStepWorkerMessageV2 | RustIntegratedRuntimeBulkWorkerMessageV1;

export type RustIntegratedRuntimeWorkerPortV1 = Readonly<{
  postMessage(message: RustIntegratedRuntimeAnyWorkerMessageV1, transfer?: readonly ArrayBuffer[]): void;
  addEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: Readonly<{ message?: string; error?: unknown }>) => void): void;
  removeEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: Readonly<{ message?: string; error?: unknown }>) => void): void;
  terminate(): void;
}>;

export type RustIntegratedRuntimeWorkerScopeV1 = Readonly<{
  postMessage(message: RustIntegratedRuntimeAnyWorkerMessageV1, transfer?: readonly ArrayBuffer[]): void;
  addEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
}>;

export interface RustIntegratedRuntimeWireKernelV1 {
  handle(request: RustIntegratedRuntimeRequestV1): Promise<RustIntegratedRuntimeResponseV1> | RustIntegratedRuntimeResponseV1;
  handleBulk?(request: RustIntegratedRuntimeBulkRequestV1): Promise<RustIntegratedRuntimeBulkResponseV1> | RustIntegratedRuntimeBulkResponseV1;
  handleStepV2?(
    request: RustIntegratedRuntimeStepRequestV2,
  ): Promise<RustIntegratedRuntimeStepResultV2 | Extract<RustIntegratedRuntimeResponseV1, { type: "runtime-error-v1" }>>
    | RustIntegratedRuntimeStepResultV2 | Extract<RustIntegratedRuntimeResponseV1, { type: "runtime-error-v1" }>;
  dispose?(): void;
}

export class RustIntegratedRuntimeWorkerError extends Error {
  readonly name = "RustIntegratedRuntimeWorkerError";

  constructor(readonly code: "capacity" | "crash" | "disposed" | "protocol" | "timeout", message: string, readonly cause?: unknown) {
    super(message);
  }
}

function asWireMessage(value: unknown): RustIntegratedRuntimeWorkerMessageV1 | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RustIntegratedRuntimeWorkerMessageV1>;
  return candidate.type === "blockwild-integrated-runtime-wire-v1" && candidate.bytes instanceof ArrayBuffer
    ? candidate as RustIntegratedRuntimeWorkerMessageV1
    : null;
}

function asStepWireMessage(value: unknown): RustIntegratedRuntimeStepWorkerMessageV2 | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RustIntegratedRuntimeStepWorkerMessageV2>;
  return candidate.type === "blockwild-integrated-runtime-step-v2" && candidate.bytes instanceof ArrayBuffer
    ? candidate as RustIntegratedRuntimeStepWorkerMessageV2
    : null;
}

function asBulkWireMessage(value: unknown): RustIntegratedRuntimeBulkWorkerMessageV1 | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RustIntegratedRuntimeBulkWorkerMessageV1>;
  return candidate.type === "blockwild-integrated-runtime-bulk-v1"
    && candidate.control instanceof ArrayBuffer
    && candidate.attachment instanceof ArrayBuffer
    ? candidate as RustIntegratedRuntimeBulkWorkerMessageV1
    : null;
}

function ownedTransferBuffer(bytes: Uint8Array) {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return Uint8Array.from(bytes).buffer;
}

/** Install one serial queue around the sole Wasm runtime instance in this Worker. */
export function installRustIntegratedRuntimeWorkerHandlerV1(
  scope: RustIntegratedRuntimeWorkerScopeV1,
  kernel: RustIntegratedRuntimeWireKernelV1,
) {
  let disposed = false;
  let active = false;
  const normalQueue: Array<() => Promise<void>> = [];
  const bulkQueue: Array<() => Promise<void>> = [];
  const fail = (error: unknown) => {
    disposed = true;
    kernel.dispose?.();
    queueMicrotask(() => { throw error; });
  };
  const drain = () => {
    if (active || disposed) return;
    // Fixed-step/input/command work always wins between bulk calls. A single
    // bulk call is non-preemptive, so routine persistence is additionally
    // chunked and bounded before entering this queue.
    const operation = normalQueue.shift() ?? bulkQueue.shift();
    if (!operation) return;
    active = true;
    void operation().catch(fail).finally(() => {
      active = false;
      if (!disposed) queueMicrotask(drain);
    });
  };
  const listener = (event: Readonly<{ data: unknown }>) => {
    const message = asWireMessage(event.data);
    const stepMessage = asStepWireMessage(event.data);
    const bulkMessage = asBulkWireMessage(event.data);
    if ((!message && !stepMessage && !bulkMessage) || disposed) return;
    if (message) normalQueue.push(async () => {
        const request = decodeRustIntegratedRuntimeRequestV1(message.bytes);
        const response = await kernel.handle(request);
        const encoded = encodeRustIntegratedRuntimeResponseV1(response);
        // The codec always returns a newly allocated full-buffer Uint8Array.
        // Transfer that ownership directly instead of copying the complete
        // BWRQ/BWRS envelope immediately before postMessage.
        const bytes = ownedTransferBuffer(encoded);
        scope.postMessage({ type: "blockwild-integrated-runtime-wire-v1", bytes }, [bytes]);
        if (request.type === "runtime-shutdown-v1") {
          disposed = true;
          kernel.dispose?.();
        }
      });
    else if (stepMessage) normalQueue.push(async () => {
      if (!kernel.handleStepV2) throw new RustIntegratedRuntimeWorkerError("protocol", "integrated runtime kernel does not implement StepV2");
      const request = decodeRustIntegratedRuntimeStepRequestV2(stepMessage.bytes);
      const response = await kernel.handleStepV2(request);
      const encoded = response.type === "runtime-step-result-v2"
        ? encodeRustIntegratedRuntimeStepResultV2(response)
        : encodeRustIntegratedRuntimeResponseV1(response);
      const bytes = ownedTransferBuffer(encoded);
      scope.postMessage({ type: "blockwild-integrated-runtime-step-v2", bytes }, [bytes]);
    });
    else if (bulkMessage) bulkQueue.push(async () => {
      if (!kernel.handleBulk) throw new RustIntegratedRuntimeWorkerError("protocol", "integrated runtime kernel does not implement the bulk platform lane");
      const request = decodeRustIntegratedRuntimeBulkRequestV1(bulkMessage.control, bulkMessage.attachment);
      const response = await kernel.handleBulk(request);
      const encoded = encodeRustIntegratedRuntimeBulkResponseV1(response);
      scope.postMessage({
        type: "blockwild-integrated-runtime-bulk-v1",
        control: encoded.control.buffer as ArrayBuffer,
        attachment: encoded.attachment.buffer as ArrayBuffer,
      }, encoded.transfer);
    });
    drain();
  };
  scope.addEventListener("message", listener);
  return Object.freeze({ dispose() { disposed = true; kernel.dispose?.(); } });
}

type PendingRequest = Readonly<{
  clientEpoch: number;
  resolve(response: RustIntegratedRuntimeResponseV1): void;
  reject(error: RustIntegratedRuntimeWorkerError): void;
  timeout: ReturnType<typeof setTimeout>;
}>;

type PendingStepV2 = Readonly<{
  clientEpoch: number;
  resolve(response: RustIntegratedRuntimeStepResultV2 | Extract<RustIntegratedRuntimeResponseV1, { type: "runtime-error-v1" }>): void;
  reject(error: RustIntegratedRuntimeWorkerError): void;
  timeout: ReturnType<typeof setTimeout>;
}>;

type PendingBulkRequest = Readonly<{
  clientEpoch: number;
  byteLength: number;
  resolve(response: RustIntegratedRuntimeBulkResponseV1): void;
  reject(error: RustIntegratedRuntimeWorkerError): void;
  timeout: ReturnType<typeof setTimeout>;
}>;

export class RustIntegratedRuntimeWorkerTransportV1 implements RustIntegratedRuntimeTransportV1 {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly pendingStepV2 = new Map<number, PendingStepV2>();
  private readonly pendingBulk = new Map<number, PendingBulkRequest>();
  private disposed = false;
  private bulkQueuedBytes = 0;
  private bulkPeakQueuedBytes = 0;
  private bulkRequests = 0;
  private bulkRoutineRequests = 0;
  private bulkRecoveryScaleRequests = 0;
  private bulkBackpressureRejects = 0;
  private bulkCopiedInputBytes = 0;
  private bulkTransferredInputBytes = 0;
  private bulkTransferredOutputBytes = 0;
  private readonly messageListener = (event: Readonly<{ data: unknown }>) => this.onMessage(event.data);
  private readonly errorListener = (event: Readonly<{ message?: string; error?: unknown }>) => {
    this.abort(new RustIntegratedRuntimeWorkerError("crash", event.message || "integrated runtime worker crashed", event.error));
  };

  constructor(private readonly worker: RustIntegratedRuntimeWorkerPortV1, private readonly timeoutMs = 5_000) {
    worker.addEventListener("message", this.messageListener);
    worker.addEventListener("error", this.errorListener);
    worker.addEventListener("messageerror", this.errorListener);
  }

  request(request: RustIntegratedRuntimeRequestV1) {
    if (this.disposed) return Promise.reject(new RustIntegratedRuntimeWorkerError("disposed", "integrated runtime transport is disposed"));
    if (this.pending.size + this.pendingStepV2.size >= RUST_INTEGRATED_RUNTIME_MAX_PENDING_REQUESTS) {
      return Promise.reject(new RustIntegratedRuntimeWorkerError("capacity", "integrated runtime pending request budget is full"));
    }
    if (this.pending.has(request.requestId) || this.pendingStepV2.has(request.requestId)) {
      return Promise.reject(new RustIntegratedRuntimeWorkerError("protocol", `request id ${request.requestId} is already outstanding`));
    }
    const encoded = encodeRustIntegratedRuntimeRequestV1(request);
    const bytes = ownedTransferBuffer(encoded);
    return new Promise<RustIntegratedRuntimeResponseV1>((resolve, reject) => {
      const timeoutMs = rustIntegratedRuntimeRequestTimeoutMsV1(request, this.timeoutMs);
      const timeout = setTimeout(() => {
        this.abort(new RustIntegratedRuntimeWorkerError("timeout", `request ${request.requestId} exceeded ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(request.requestId, {
        clientEpoch: request.clientEpoch,
        resolve,
        reject,
        timeout,
      });
      try {
        this.worker.postMessage({ type: "blockwild-integrated-runtime-wire-v1", bytes }, [bytes]);
      } catch (error) {
        this.abort(new RustIntegratedRuntimeWorkerError("crash", "integrated runtime worker rejected the request", error));
      }
    });
  }

  requestStepV2(request: RustIntegratedRuntimeStepRequestV2) {
    if (this.disposed) return Promise.reject(new RustIntegratedRuntimeWorkerError("disposed", "integrated runtime transport is disposed"));
    if (this.pending.size + this.pendingStepV2.size >= RUST_INTEGRATED_RUNTIME_MAX_PENDING_REQUESTS) {
      return Promise.reject(new RustIntegratedRuntimeWorkerError("capacity", "integrated runtime pending request budget is full"));
    }
    if (this.pending.has(request.requestId) || this.pendingStepV2.has(request.requestId)) {
      return Promise.reject(new RustIntegratedRuntimeWorkerError("protocol", `request id ${request.requestId} is already outstanding`));
    }
    const encoded = encodeRustIntegratedRuntimeStepRequestV2(request);
    const bytes = ownedTransferBuffer(encoded);
    return new Promise<RustIntegratedRuntimeStepResultV2 | Extract<RustIntegratedRuntimeResponseV1, { type: "runtime-error-v1" }>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.abort(new RustIntegratedRuntimeWorkerError("timeout", `StepV2 request ${request.requestId} exceeded ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pendingStepV2.set(request.requestId, { clientEpoch: request.clientEpoch, resolve, reject, timeout });
      try {
        this.worker.postMessage({ type: "blockwild-integrated-runtime-step-v2", bytes }, [bytes]);
      } catch (error) {
        this.abort(new RustIntegratedRuntimeWorkerError("crash", "integrated runtime worker rejected StepV2", error));
      }
    });
  }

  requestBulk(request: RustIntegratedRuntimeBulkRequestV1) {
    if (this.disposed) return Promise.reject(new RustIntegratedRuntimeWorkerError("disposed", "integrated runtime transport is disposed"));
    if (this.pendingBulk.size >= RUST_INTEGRATED_RUNTIME_BULK_MAX_PENDING_V1 || this.pendingBulk.has(request.requestId)) {
      this.bulkBackpressureRejects += 1;
      return Promise.reject(new RustIntegratedRuntimeWorkerError("capacity", "integrated runtime bulk request budget is full"));
    }
    const encoded = encodeRustIntegratedRuntimeBulkRequestV1(request);
    const byteLength = encoded.attachment.byteLength;
    if (this.bulkQueuedBytes + byteLength > RUST_INTEGRATED_RUNTIME_BULK_MAX_QUEUED_BYTES_V1) {
      this.bulkBackpressureRejects += 1;
      return Promise.reject(new RustIntegratedRuntimeWorkerError("capacity", "integrated runtime bulk byte budget is full"));
    }
    this.bulkQueuedBytes += byteLength;
    this.bulkPeakQueuedBytes = Math.max(this.bulkPeakQueuedBytes, this.bulkQueuedBytes);
    this.bulkRequests += 1;
    if (request.type === "runtime-bulk-migrate-legacy-world-v1"
      || request.type === "runtime-bulk-migrate-historical-external-v2"
      || request.type === "runtime-bulk-finalize-historical-external-save-v2"
      || request.type === "runtime-bulk-hydrate-historical-external-v2"
      || request.type === "runtime-bulk-reconcile-historical-external-fallback-v2"
      || byteLength > RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1) this.bulkRecoveryScaleRequests += 1;
    else this.bulkRoutineRequests += 1;
    this.bulkCopiedInputBytes += encoded.copiedInputBytes;
    this.bulkTransferredInputBytes += byteLength;
    return new Promise<RustIntegratedRuntimeBulkResponseV1>((resolve, reject) => {
      const timeoutMs = rustIntegratedRuntimeBulkTimeoutMsV1(request, byteLength, this.timeoutMs);
      const timeout = setTimeout(() => {
        this.abort(new RustIntegratedRuntimeWorkerError("timeout", `bulk request ${request.requestId} exceeded ${timeoutMs} ms`));
      }, timeoutMs);
      this.pendingBulk.set(request.requestId, { clientEpoch: request.clientEpoch, byteLength, resolve, reject, timeout });
      try {
        this.worker.postMessage({
          type: "blockwild-integrated-runtime-bulk-v1",
          control: encoded.control.buffer as ArrayBuffer,
          attachment: encoded.attachment.buffer as ArrayBuffer,
        }, encoded.transfer);
      } catch (error) {
        this.abort(new RustIntegratedRuntimeWorkerError("crash", "integrated runtime worker rejected the bulk request", error));
      }
    });
  }

  bulkDiagnostics(): RustIntegratedRuntimeBulkTransportDiagnosticsV1 {
    return Object.freeze({
      pending: this.pendingBulk.size,
      queuedBytes: this.bulkQueuedBytes,
      peakQueuedBytes: this.bulkPeakQueuedBytes,
      requests: this.bulkRequests,
      routineRequests: this.bulkRoutineRequests,
      recoveryScaleRequests: this.bulkRecoveryScaleRequests,
      backpressureRejects: this.bulkBackpressureRejects,
      copiedInputBytes: this.bulkCopiedInputBytes,
      transferredInputBytes: this.bulkTransferredInputBytes,
      transferredOutputBytes: this.bulkTransferredOutputBytes,
    });
  }

  private onMessage(value: unknown) {
    const stepMessage = asStepWireMessage(value);
    if (stepMessage) {
      this.onStepV2Message(stepMessage);
      return;
    }
    const bulkMessage = asBulkWireMessage(value);
    if (bulkMessage) {
      this.onBulkMessage(bulkMessage);
      return;
    }
    const message = asWireMessage(value);
    if (!message) {
      this.abort(new RustIntegratedRuntimeWorkerError("protocol", "integrated runtime worker sent a malformed message"));
      return;
    }
    let response: RustIntegratedRuntimeResponseV1;
    try {
      response = decodeRustIntegratedRuntimeResponseV1(message.bytes);
    } catch (error) {
      this.abort(new RustIntegratedRuntimeWorkerError("protocol", "integrated runtime worker response failed validation", error));
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      this.abort(new RustIntegratedRuntimeWorkerError("protocol", `integrated runtime worker returned unknown request ${response.requestId}`));
      return;
    }
    this.pending.delete(response.requestId);
    clearTimeout(pending.timeout);
    if (pending.clientEpoch !== response.clientEpoch) {
      const error = new RustIntegratedRuntimeWorkerError("protocol", "integrated runtime response belongs to another client epoch");
      pending.reject(error);
      this.abort(error);
      return;
    }
    pending.resolve(response);
  }

  private onStepV2Message(message: RustIntegratedRuntimeStepWorkerMessageV2) {
    let response: RustIntegratedRuntimeStepResultV2 | Extract<RustIntegratedRuntimeResponseV1, { type: "runtime-error-v1" }>;
    try {
      const bytes = new Uint8Array(message.bytes);
      const schema = bytes.byteLength >= 8 ? new DataView(bytes.buffer, bytes.byteOffset).getUint16(6, true) : 0;
      if (schema === 6) response = decodeRustIntegratedRuntimeStepResultV2(bytes);
      else {
        const legacy = decodeRustIntegratedRuntimeResponseV1(bytes);
        if (legacy.type !== "runtime-error-v1") throw new Error("StepV2 legacy response is not an error");
        response = legacy;
      }
    } catch (error) {
      this.abort(new RustIntegratedRuntimeWorkerError("protocol", "integrated runtime StepV2 response failed validation", error));
      return;
    }
    const pending = this.pendingStepV2.get(response.requestId);
    if (!pending) {
      this.abort(new RustIntegratedRuntimeWorkerError("protocol", `integrated runtime worker returned unknown StepV2 request ${response.requestId}`));
      return;
    }
    this.pendingStepV2.delete(response.requestId);
    clearTimeout(pending.timeout);
    if (pending.clientEpoch !== response.clientEpoch) {
      const error = new RustIntegratedRuntimeWorkerError("protocol", "integrated runtime StepV2 response belongs to another client epoch");
      pending.reject(error);
      this.abort(error);
      return;
    }
    pending.resolve(response);
  }

  private onBulkMessage(message: RustIntegratedRuntimeBulkWorkerMessageV1) {
    let response: RustIntegratedRuntimeBulkResponseV1;
    try {
      response = decodeRustIntegratedRuntimeBulkResponseV1(message.control, message.attachment);
    } catch (error) {
      this.abort(new RustIntegratedRuntimeWorkerError("protocol", "integrated runtime bulk response failed validation", error));
      return;
    }
    const pending = this.pendingBulk.get(response.requestId);
    if (!pending) {
      this.abort(new RustIntegratedRuntimeWorkerError("protocol", `integrated runtime worker returned unknown bulk request ${response.requestId}`));
      return;
    }
    this.pendingBulk.delete(response.requestId);
    this.bulkQueuedBytes = Math.max(0, this.bulkQueuedBytes - pending.byteLength);
    this.bulkTransferredOutputBytes += message.attachment.byteLength;
    clearTimeout(pending.timeout);
    if (pending.clientEpoch !== response.clientEpoch) {
      const error = new RustIntegratedRuntimeWorkerError("protocol", "integrated runtime bulk response belongs to another client epoch");
      pending.reject(error);
      this.abort(error);
      return;
    }
    pending.resolve(response);
  }

  private failAll(error: RustIntegratedRuntimeWorkerError) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const pending of this.pendingStepV2.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingStepV2.clear();
    for (const pending of this.pendingBulk.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingBulk.clear();
    this.bulkQueuedBytes = 0;
  }

  private abort(error: RustIntegratedRuntimeWorkerError) {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener("message", this.messageListener);
    this.worker.removeEventListener("error", this.errorListener);
    this.worker.removeEventListener("messageerror", this.errorListener);
    this.failAll(error);
    this.worker.terminate();
  }

  dispose() {
    this.abort(new RustIntegratedRuntimeWorkerError("disposed", "integrated runtime transport was disposed"));
  }
}
