import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1,
  RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1,
  RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1,
  decodeRustIntegratedRuntimeBulkRequestV1,
  decodeRustIntegratedRuntimeBulkResponseV1,
  encodeRustIntegratedRuntimeBulkRequestV1,
  encodeRustIntegratedRuntimeBulkResponseV1,
  rustIntegratedRuntimeBulkStateV1,
  type RustIntegratedRuntimeBulkRequestV1,
  type RustIntegratedRuntimeBulkResponseV1,
} from "../app/game/rust-integrated-runtime-bulk-platform.ts";
import type {
  RustIntegratedRuntimeConfigV1,
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeRequestV1,
  RustIntegratedRuntimeResponseV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  installRustIntegratedRuntimeWorkerHandlerV1,
  RustIntegratedRuntimeWorkerError,
  RustIntegratedRuntimeWorkerTransportV1,
  type RustIntegratedRuntimeAnyWorkerMessageV1,
  type RustIntegratedRuntimeWorkerPortV1,
  type RustIntegratedRuntimeWorkerScopeV1,
} from "../app/game/rust-integrated-runtime-worker.ts";
import {
  RustIntegratedRuntimeServiceError,
  RustIntegratedRuntimeServiceV1,
} from "../app/game/rust-integrated-runtime-service.ts";

const ZERO_HASH = "0".repeat(32);
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/integrated-runtime-v1/wire-fixtures.json", import.meta.url), "utf8")) as {
  bulkEnvelopes: readonly { name: string; direction: "request" | "response"; controlHex: string; attachmentHex: string }[];
};

function hex(bytes: Uint8Array) { return Buffer.from(bytes).toString("hex"); }

function bulkFixture(name: string) {
  const result = FIXTURE.bulkEnvelopes.find((entry) => entry.name === name);
  assert.ok(result, `missing bulk fixture ${name}`);
  return result;
}

function identity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "1",
    locationId: "surface",
    revision: Object.freeze({ epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5, network: 6, simulation: 7 }),
    tick: 8,
    stateHash: "1".repeat(32),
  });
}

function config(): RustIntegratedRuntimeConfigV1 {
  return Object.freeze({
    worldSeed: "bulk-fixture",
    universeId: "1",
    locationId: "surface",
    sessionId: "fixture",
    contentHash: ZERO_HASH,
    generatorHash: ZERO_HASH,
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
    waterBlockId: 7,
    directionalBlockIds: Object.freeze([]),
    waterloggedBlockIds: Object.freeze([]),
  });
}

function normalReady(request: RustIntegratedRuntimeRequestV1): Extract<RustIntegratedRuntimeResponseV1, { type: "runtime-ready-v1" }> {
  return Object.freeze({
    type: "runtime-ready-v1",
    requestId: request.requestId,
    clientEpoch: request.clientEpoch,
    workerEpoch: 3,
    runtimeHandle: 1,
    identity: identity(),
    artifactHash: "fixture",
    instanceId: "bulk-worker",
    capabilities: Object.freeze(["integrated-runtime-v1"]),
  });
}

function poll(requestId: number): RustIntegratedRuntimeBulkRequestV1 {
  return Object.freeze({ type: "runtime-bulk-poll-v1", requestId, clientEpoch: 2, expected: rustIntegratedRuntimeBulkStateV1(identity()), maxBytes: 1024 * 1024 });
}

function empty(request: RustIntegratedRuntimeBulkRequestV1): RustIntegratedRuntimeBulkResponseV1 {
  return Object.freeze({ type: "runtime-bulk-empty-v1", requestId: request.requestId, clientEpoch: request.clientEpoch, workerEpoch: 3, current: rustIntegratedRuntimeBulkStateV1(identity()) });
}

class LinkedBulkWorker {
  private readonly mainMessage = new Set<(event: Readonly<{ data: unknown }>) => void>();
  private readonly workerMessage = new Set<(event: Readonly<{ data: unknown }>) => void>();
  private readonly errors = new Set<(event: Readonly<{ message?: string; error?: unknown }>) => void>();
  private readonly messageErrors = new Set<(event: Readonly<{ message?: string; error?: unknown }>) => void>();
  readonly transfers: Array<readonly ArrayBuffer[]> = [];
  terminated = false;

  readonly port: RustIntegratedRuntimeWorkerPortV1 = {
    postMessage: (message, transfer = []) => {
      if (this.terminated) throw new Error("worker terminated");
      this.transfers.push([...transfer]);
      const cloned = structuredClone(message, { transfer: [...transfer] }) as RustIntegratedRuntimeAnyWorkerMessageV1;
      queueMicrotask(() => { for (const listener of this.workerMessage) listener({ data: cloned }); });
    },
    addEventListener: (type, listener) => {
      if (type === "message") this.mainMessage.add(listener as (event: Readonly<{ data: unknown }>) => void);
      else if (type === "error") this.errors.add(listener as (event: Readonly<{ message?: string; error?: unknown }>) => void);
      else this.messageErrors.add(listener as (event: Readonly<{ message?: string; error?: unknown }>) => void);
    },
    removeEventListener: (type, listener) => {
      if (type === "message") this.mainMessage.delete(listener as (event: Readonly<{ data: unknown }>) => void);
      else if (type === "error") this.errors.delete(listener as (event: Readonly<{ message?: string; error?: unknown }>) => void);
      else this.messageErrors.delete(listener as (event: Readonly<{ message?: string; error?: unknown }>) => void);
    },
    terminate: () => { this.terminated = true; },
  };

  readonly scope: RustIntegratedRuntimeWorkerScopeV1 = {
    postMessage: (message, transfer = []) => {
      if (this.terminated) throw new Error("worker terminated");
      const cloned = structuredClone(message, { transfer: [...transfer] }) as RustIntegratedRuntimeAnyWorkerMessageV1;
      queueMicrotask(() => { for (const listener of this.mainMessage) listener({ data: cloned }); });
    },
    addEventListener: (_type, listener) => { this.workerMessage.add(listener); },
  };

  crash(message: string) {
    for (const listener of this.errors) listener({ message, error: new Error(message) });
  }
}

test("bulk control and detached BWPR/BWPA attachment round-trip exact high bytes", () => {
  const backing = Uint8Array.of(0xaa, 0x00, 0x7f, 0x80, 0xff, 0xbb);
  const request: RustIntegratedRuntimeBulkRequestV1 = {
    type: "runtime-bulk-complete-v1",
    requestId: 7,
    clientEpoch: 2,
    expected: rustIntegratedRuntimeBulkStateV1(identity()),
    transferToken: 91,
    typeId: RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1,
    payload: backing.subarray(1, 5),
  };
  const encoded = encodeRustIntegratedRuntimeBulkRequestV1(request);
  assert.equal(encoded.copiedInputBytes, 4, "a subview is copied once into an exactly owned transferable attachment");
  assert.equal(encoded.control.buffer === encoded.attachment.buffer, false);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkRequestV1(encoded.control, encoded.attachment), { ...request, payload: Uint8Array.of(0x00, 0x7f, 0x80, 0xff) });
  assert.equal(hex(encoded.control), bulkFixture("complete-bwpa-high-binary").controlHex);
  assert.equal(hex(encoded.attachment), bulkFixture("complete-bwpa-high-binary").attachmentHex);

  const response: RustIntegratedRuntimeBulkResponseV1 = {
    type: "runtime-bulk-platform-request-v1",
    requestId: 8,
    clientEpoch: 2,
    workerEpoch: 3,
    current: rustIntegratedRuntimeBulkStateV1(identity()),
    transferToken: 92,
    typeId: RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1,
    payload: Uint8Array.of(0x80, 0xff),
  };
  const responseBytes = encodeRustIntegratedRuntimeBulkResponseV1(response);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkResponseV1(responseBytes.control, responseBytes.attachment), response);
  assert.equal(hex(responseBytes.control), bulkFixture("platform-bwpr-high-binary").controlHex);
  assert.equal(hex(responseBytes.attachment), bulkFixture("platform-bwpr-high-binary").attachmentHex);
  const damaged = Uint8Array.from(responseBytes.attachment); damaged[0] ^= 0xff;
  assert.throws(() => decodeRustIntegratedRuntimeBulkResponseV1(responseBytes.control, damaged));
});

test("compatibility staging and hydrated readback match Rust for Unicode ids and high bytes", () => {
  const request: RustIntegratedRuntimeBulkRequestV1 = {
    type: "runtime-bulk-stage-save-chunk-v1",
    requestId: 9,
    clientEpoch: 2,
    expected: rustIntegratedRuntimeBulkStateV1(identity()),
    stageId: "sävë-一-🌿",
    chunkIndex: 0,
    chunkCount: 1,
    totalBytes: 4,
    payload: Uint8Array.of(0, 0x80, 0xff, 0x7f),
  };
  const encoded = encodeRustIntegratedRuntimeBulkRequestV1(request);
  assert.equal(hex(encoded.control), bulkFixture("stage-save-unicode-high-binary").controlHex);
  assert.equal(hex(encoded.attachment), bulkFixture("stage-save-unicode-high-binary").attachmentHex);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkRequestV1(encoded.control, encoded.attachment), request);

  const response: RustIntegratedRuntimeBulkResponseV1 = {
    type: "runtime-bulk-data-v1",
    requestId: 10,
    clientEpoch: 2,
    workerEpoch: 3,
    current: rustIntegratedRuntimeBulkStateV1(identity()),
    transferToken: 93,
    typeId: RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1,
    chunkIndex: 0,
    chunkCount: 1,
    payload: Uint8Array.of(0x80, 0xff, 0xf0, 0x9f),
  };
  const responseBytes = encodeRustIntegratedRuntimeBulkResponseV1(response);
  assert.equal(hex(responseBytes.control), bulkFixture("hydrated-data-high-binary").controlHex);
  assert.equal(hex(responseBytes.attachment), bulkFixture("hydrated-data-high-binary").attachmentHex);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkResponseV1(responseBytes.control, responseBytes.attachment), response);

  assert.throws(() => encodeRustIntegratedRuntimeBulkRequestV1({ ...request, stageId: `bad${String.fromCharCode(0xd800)}` }));
  const damaged = Uint8Array.from(responseBytes.attachment);
  damaged[0] ^= 0x01;
  assert.throws(() => decodeRustIntegratedRuntimeBulkResponseV1(responseBytes.control, damaged));
});

test("normal authority work wins between serialized bulk calls and transferred buffers have one owner", async () => {
  const link = new LinkedBulkWorker();
  const order: string[] = [];
  installRustIntegratedRuntimeWorkerHandlerV1(link.scope, {
    async handle(request) { order.push(`normal:${request.requestId}`); return normalReady(request); },
    async handleBulk(request) {
      order.push(`bulk-start:${request.requestId}`);
      await new Promise<void>((resolve) => { setTimeout(resolve, 2); });
      order.push(`bulk-end:${request.requestId}`);
      return empty(request);
    },
  });
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 2_000);
  const first = transport.requestBulk(poll(1));
  const second = transport.requestBulk(poll(2));
  const normal = transport.request({ type: "runtime-create-v1", requestId: 50, clientEpoch: 2, config: config() });
  await Promise.all([first, second, normal]);
  assert.deepEqual(order, ["bulk-start:1", "bulk-end:1", "normal:50", "bulk-start:2", "bulk-end:2"]);
  assert.equal(link.transfers[0].length, 1, "empty poll transfers only its control ownership");
  assert.equal(transport.bulkDiagnostics().pending, 0);
  assert.equal(transport.bulkDiagnostics().requests, 2);
});

test("bulk lane applies bounded backpressure without rejecting normal work", async () => {
  const link = new LinkedBulkWorker();
  const releases: Array<() => void> = [];
  installRustIntegratedRuntimeWorkerHandlerV1(link.scope, {
    handle: normalReady,
    handleBulk: (request) => new Promise<RustIntegratedRuntimeBulkResponseV1>((resolve) => { releases.push(() => resolve(empty(request))); }),
  });
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 2_000);
  const first = transport.requestBulk(poll(1));
  const second = transport.requestBulk(poll(2));
  await assert.rejects(transport.requestBulk(poll(3)), (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "capacity");
  const normal = transport.request({ type: "runtime-create-v1", requestId: 9, clientEpoch: 2, config: config() });
  while (releases.length < 1) await new Promise<void>((resolve) => { setImmediate(resolve); });
  releases.shift()?.();
  await normal;
  while (releases.length < 1) await new Promise<void>((resolve) => { setImmediate(resolve); });
  releases.shift()?.();
  await Promise.all([first, second]);
  assert.equal(transport.bulkDiagnostics().backpressureRejects, 1);
});

test("bulk timeout or crash invalidates normal and bulk requests in the same authority generation", async () => {
  const link = new LinkedBulkWorker();
  installRustIntegratedRuntimeWorkerHandlerV1(link.scope, {
    handle: () => new Promise<RustIntegratedRuntimeResponseV1>(() => undefined),
    handleBulk: () => new Promise<RustIntegratedRuntimeBulkResponseV1>(() => undefined),
  });
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 5);
  const bulk = transport.requestBulk(poll(1));
  const normal = transport.request({ type: "runtime-create-v1", requestId: 2, clientEpoch: 2, config: config() });
  await assert.rejects(bulk, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "timeout");
  await assert.rejects(normal, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "timeout");
  assert.equal(link.terminated, true);

  const crashedLink = new LinkedBulkWorker();
  installRustIntegratedRuntimeWorkerHandlerV1(crashedLink.scope, {
    handle: () => new Promise<RustIntegratedRuntimeResponseV1>(() => undefined),
    handleBulk: () => new Promise<RustIntegratedRuntimeBulkResponseV1>(() => undefined),
  });
  const crashedTransport = new RustIntegratedRuntimeWorkerTransportV1(crashedLink.port, 2_000);
  const crashedBulk = crashedTransport.requestBulk(poll(11));
  const crashedNormal = crashedTransport.request({ type: "runtime-create-v1", requestId: 12, clientEpoch: 2, config: config() });
  crashedLink.crash("fixture worker panic");
  await assert.rejects(crashedBulk, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "crash");
  await assert.rejects(crashedNormal, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "crash");
  assert.equal(crashedLink.terminated, true);
});

test("bulk service accepts only an explicitly capable worker and never upgrades a protocol fake to authority", async () => {
  let current = identity();
  const transport = {
    async request(request: RustIntegratedRuntimeRequestV1): Promise<RustIntegratedRuntimeResponseV1> {
      if (request.type !== "runtime-create-v1") throw new Error(`unexpected ${request.type}`);
      return {
        ...normalReady(request),
        capabilities: ["awaited-receipts-v1", "bounded-extraction-v1", "bulk-platform-v1", "fixed-step-input-v1", "integrated-runtime-v1"],
      };
    },
    async requestBulk(request: RustIntegratedRuntimeBulkRequestV1): Promise<RustIntegratedRuntimeBulkResponseV1> {
      if (request.type === "runtime-bulk-poll-v1") return {
        type: "runtime-bulk-platform-request-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 3,
        current: rustIntegratedRuntimeBulkStateV1(current),
        transferToken: 77,
        typeId: RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1,
        payload: Uint8Array.of(0x42, 0x57, 0x50, 0x52, 0x80, 0xff),
      };
      if (request.type !== "runtime-bulk-complete-v1") throw new Error(`unexpected ${request.type}`);
      current = Object.freeze({
        ...current,
        revision: Object.freeze({ ...current.revision, persistence: current.revision.persistence + 1 }),
        stateHash: "2".repeat(32),
      });
      return {
        type: "runtime-bulk-completed-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 3,
        current: rustIntegratedRuntimeBulkStateV1(current),
        transferToken: request.transferToken,
        resultHash: "3".repeat(32),
      };
    },
    bulkDiagnostics: () => Object.freeze({ pending: 0, queuedBytes: 0, peakQueuedBytes: 6, requests: 2, routineRequests: 2, recoveryScaleRequests: 0, backpressureRejects: 0, copiedInputBytes: 0, transferredInputBytes: 6, transferredOutputBytes: 6 }),
    dispose() {},
  };
  const service = new RustIntegratedRuntimeServiceV1({ mode: "protocol-test", transportFactory: () => transport });
  await service.start(config());
  assert.equal(service.isAuthoritative(), false, "an injected transport remains protocol-only even with a bulk capability string");
  assert.throws(
    () => service.stageCompatibilitySaveChunk("pending", 0, 1, 1, Uint8Array.of(1)),
    (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "not-authoritative",
    "partial R4-only save hydration must not be promoted as complete native authority",
  );
  const platform = await service.pollBulkPlatform();
  assert.equal(platform.type, "runtime-bulk-platform-request-v1");
  assert.deepEqual(platform.type === "runtime-bulk-platform-request-v1" ? platform.payload : null, Uint8Array.of(0x42, 0x57, 0x50, 0x52, 0x80, 0xff));
  const completed = await service.completeBulkPlatform(77, Uint8Array.of(0x42, 0x57, 0x50, 0x41));
  assert.equal(completed.type, "runtime-bulk-completed-v1");
  assert.equal(service.identity().revision.persistence, 6);
  assert.equal(service.bulkDiagnostics()?.requests, 2);

  const incapable = new RustIntegratedRuntimeServiceV1({
    mode: "protocol-test",
    transportFactory: () => ({
      request: (request) => transport.request(request).then((response) => response.type === "runtime-ready-v1" ? { ...response, capabilities: response.capabilities.filter((capability) => capability !== "bulk-platform-v1") } : response),
      dispose() {},
    }),
  });
  await incapable.start(config());
  assert.throws(() => incapable.pollBulkPlatform(), (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "not-authoritative");
});

test("bulk authority rejection stays usable only when it proves the expected state", async () => {
  const createTransport = (mutateState: boolean) => ({
    async request(request: RustIntegratedRuntimeRequestV1): Promise<RustIntegratedRuntimeResponseV1> {
      if (request.type !== "runtime-create-v1") throw new Error(`unexpected ${request.type}`);
      return {
        ...normalReady(request),
        capabilities: ["awaited-receipts-v1", "bounded-extraction-v1", "bulk-platform-v1", "fixed-step-input-v1", "integrated-runtime-v1"],
      };
    },
    async requestBulk(request: RustIntegratedRuntimeBulkRequestV1): Promise<RustIntegratedRuntimeBulkResponseV1> {
      const current = mutateState
        ? Object.freeze({ ...identity(), stateHash: "9".repeat(32) })
        : identity();
      return {
        type: "runtime-bulk-error-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 3,
        code: "quota-denied",
        message: "browser storage rejected the transaction",
        current: rustIntegratedRuntimeBulkStateV1(current),
      };
    },
    bulkDiagnostics: () => Object.freeze({ pending: 0, queuedBytes: 0, peakQueuedBytes: 0, requests: 1, routineRequests: 1, recoveryScaleRequests: 0, backpressureRejects: 0, copiedInputBytes: 0, transferredInputBytes: 0, transferredOutputBytes: 0 }),
    dispose() {},
  });

  const rejected = new RustIntegratedRuntimeServiceV1({ mode: "protocol-test", transportFactory: () => createTransport(false) });
  await rejected.start(config());
  await assert.rejects(
    rejected.pollBulkPlatform(),
    (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "bulk-platform",
  );
  assert.equal(rejected.diagnostics().state, "ready", "an explicit no-mutation rejection does not poison the authority generation");

  const stale = new RustIntegratedRuntimeServiceV1({ mode: "protocol-test", transportFactory: () => createTransport(true) });
  await stale.start(config());
  await assert.rejects(
    stale.pollBulkPlatform(),
    (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "invalid-response",
  );
  assert.equal(stale.diagnostics().state, "failed", "a rejection that lies about current authority fails closed");
});

test("production service routes native save initialization through the dedicated bulk operation", async () => {
  const seen: RustIntegratedRuntimeBulkRequestV1[] = [];
  const transport = {
    async request(request: RustIntegratedRuntimeRequestV1): Promise<RustIntegratedRuntimeResponseV1> {
      if (request.type !== "runtime-create-v1") throw new Error(`unexpected ${request.type}`);
      return {
        ...normalReady(request),
        artifactHash: "fixture",
        capabilities: [
          "awaited-receipts-v1", "bounded-extraction-v1", "bulk-platform-v1",
          "fixed-step-input-v1", "integrated-runtime-v1", "native-save-hydration-v1",
        ],
      };
    },
    async requestBulk(request: RustIntegratedRuntimeBulkRequestV1): Promise<RustIntegratedRuntimeBulkResponseV1> {
      seen.push(request);
      if (request.type !== "runtime-bulk-initialize-native-save-v1") throw new Error(`unexpected ${request.type}`);
      return {
        type: "runtime-bulk-save-progress-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 3,
        current: request.expected,
        stageId: request.saveId,
        state: "finalized",
        receivedChunks: 0,
        chunkCount: 0,
        receivedBytes: 0,
        setHash: "2".repeat(32),
        manifestHash: "3".repeat(32),
        dispatcherRequestId: 1,
        remainingDirtyRecords: 5,
      };
    },
    bulkDiagnostics: () => Object.freeze({ pending: 0, queuedBytes: 0, peakQueuedBytes: 0, requests: seen.length, routineRequests: seen.length, recoveryScaleRequests: 0, backpressureRejects: 0, copiedInputBytes: 0, transferredInputBytes: 0, transferredOutputBytes: 0 }),
    dispose() {},
  };
  const service = new RustIntegratedRuntimeServiceV1({
    expectedArtifactHash: "fixture",
    transportFactory: () => transport,
  });
  await service.start(config());
  assert.equal(service.isAuthoritative(), true);
  const progress = await service.initializeNativeSave("native.new.fixture", 101);
  assert.equal(progress.stageId, "native.new.fixture");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "runtime-bulk-initialize-native-save-v1");
});
