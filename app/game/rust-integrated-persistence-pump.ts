import {
  RUST_INTEGRATED_RUNTIME_BULK_PERSISTENCE_MAX_PACKET_BYTES_V1,
  RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1,
  type RustIntegratedRuntimeBulkResponseV1,
} from "./rust-integrated-runtime-bulk-platform";
import { RustPersistenceBrowserRuntimeV1 } from "./rust-persistence-runtime-adapter";

export const RUST_INTEGRATED_PERSISTENCE_PUMP_DEFAULT_MAX_BYTES_V1 = RUST_INTEGRATED_RUNTIME_BULK_PERSISTENCE_MAX_PACKET_BYTES_V1;
export const RUST_INTEGRATED_PERSISTENCE_PUMP_DEFAULT_MAX_OPERATIONS_V1 = 256;

export interface RustIntegratedPersistenceBulkServiceV1 {
  pollBulkPlatform(maxBytes?: number): Promise<RustIntegratedRuntimeBulkResponseV1>;
  completeBulkPlatform(transferToken: number, response: Uint8Array): Promise<RustIntegratedRuntimeBulkResponseV1>;
  shutdown?(): Promise<void>;
}

export type RustIntegratedPersistenceDrainResultV1 = Readonly<{
  operations: number;
  requestBytes: number;
  responseBytes: number;
  idle: boolean;
}>;

/**
 * Policy-free browser execution loop for Rust-issued persistence work.
 *
 * BWPR and BWPA remain opaque here. Rust chooses journal, recovery, retry,
 * compaction, migration, export/import, and delete policy. This loop only
 * transfers one bounded request into the browser adapter and returns the exact
 * encoded response under the same Rust-issued transfer token.
 */
export class RustIntegratedPersistencePumpV1 {
  private active: Promise<RustIntegratedPersistenceDrainResultV1> | null = null;
  private wakeRequested = false;
  private closing = false;
  private closed = false;

  constructor(
    private readonly service: RustIntegratedPersistenceBulkServiceV1,
    private readonly browserRuntime: RustPersistenceBrowserRuntimeV1,
    private readonly maxBytes = RUST_INTEGRATED_PERSISTENCE_PUMP_DEFAULT_MAX_BYTES_V1,
    private readonly maxOperations = RUST_INTEGRATED_PERSISTENCE_PUMP_DEFAULT_MAX_OPERATIONS_V1,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("persistence pump maxBytes must be a positive safe integer");
    if (!Number.isSafeInteger(maxOperations) || maxOperations < 1) throw new RangeError("persistence pump maxOperations must be a positive safe integer");
  }

  wake() {
    this.requireOpen();
    this.wakeRequested = true;
    return this.ensureDrain();
  }

  async drainUntilIdle() {
    this.requireOpen();
    return this.drainToIdle();
  }

  async flush() {
    this.requireOpen();
    return this.drainToIdle();
  }

  private async drainToIdle() {
    let total: RustIntegratedPersistenceDrainResultV1 = Object.freeze({ operations: 0, requestBytes: 0, responseBytes: 0, idle: false });
    do {
      this.wakeRequested = true;
      const result = await this.ensureDrain();
      total = Object.freeze({
        operations: total.operations + result.operations,
        requestBytes: total.requestBytes + result.requestBytes,
        responseBytes: total.responseBytes + result.responseBytes,
        idle: result.idle,
      });
    } while (!total.idle);
    return total;
  }

  async shutdown(options: Readonly<{ shutdownService?: boolean }> = {}) {
    if (this.closed) return;
    if (this.closing) {
      await this.active;
      return;
    }
    this.closing = true;
    try {
      await this.drainToIdle();
      if (options.shutdownService) await this.service.shutdown?.();
    } finally {
      this.closed = true;
      this.closing = false;
      this.wakeRequested = false;
    }
  }

  isClosed() { return this.closed; }

  private async ensureDrain() {
    if (this.active) return this.active;
    const drain = this.runDrain();
    this.active = drain;
    try { return await drain; }
    finally { if (this.active === drain) this.active = null; }
  }

  private async runDrain(): Promise<RustIntegratedPersistenceDrainResultV1> {
    let operations = 0;
    let requestBytes = 0;
    let responseBytes = 0;
    let idle = false;
    this.wakeRequested = false;
    while (operations < this.maxOperations) {
      const request = await this.service.pollBulkPlatform(this.maxBytes);
      if (request.type === "runtime-bulk-empty-v1") {
        idle = !this.wakeRequested;
        if (idle) break;
        this.wakeRequested = false;
        continue;
      }
      if (request.type !== "runtime-bulk-platform-request-v1"
        || request.typeId !== RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1) {
        throw new Error("integrated persistence pump received a non-persistence bulk request");
      }
      requestBytes += request.payload.byteLength;
      const response = await this.browserRuntime.execute(request.payload);
      responseBytes += response.byteLength;
      await this.service.completeBulkPlatform(request.transferToken, response);
      operations += 1;
    }
    return Object.freeze({ operations, requestBytes, responseBytes, idle });
  }

  private requireOpen() {
    if (this.closed || this.closing) throw new Error("integrated persistence pump is closed");
  }
}
