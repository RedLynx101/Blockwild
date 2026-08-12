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
} from "./rust-integrated-runtime-codec";
import {
  RUST_INTEGRATED_RUNTIME_BULK_MAX_PENDING_V1,
  RUST_INTEGRATED_RUNTIME_BULK_MAX_QUEUED_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1,
  decodeRustIntegratedRuntimeBulkRequestV1,
  decodeRustIntegratedRuntimeBulkResponseV1,
  encodeRustIntegratedRuntimeBulkRequestV1,
  encodeRustIntegratedRuntimeBulkResponseV1,
  type RustIntegratedRuntimeBulkRequestV1,
  type RustIntegratedRuntimeBulkResponseV1,
  type RustIntegratedRuntimeBulkTransportDiagnosticsV1,
} from "./rust-integrated-runtime-bulk-platform";

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
      const timeout = setTimeout(() => {
        this.abort(new RustIntegratedRuntimeWorkerError("timeout", `request ${request.requestId} exceeded ${this.timeoutMs} ms`));
      }, this.timeoutMs);
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
    if (byteLength <= RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1) this.bulkRoutineRequests += 1;
    else this.bulkRecoveryScaleRequests += 1;
    this.bulkCopiedInputBytes += encoded.copiedInputBytes;
    this.bulkTransferredInputBytes += byteLength;
    return new Promise<RustIntegratedRuntimeBulkResponseV1>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.abort(new RustIntegratedRuntimeWorkerError("timeout", `bulk request ${request.requestId} exceeded ${this.timeoutMs} ms`));
      }, this.timeoutMs);
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
