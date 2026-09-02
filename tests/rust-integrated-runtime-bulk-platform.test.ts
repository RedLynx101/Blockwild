import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUST_INTEGRATED_PERSISTENCE_COMPATIBILITY_HYDRATION_CHUNK_TYPE_V1,
  RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1,
  RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1,
  RUST_INTEGRATED_PERSISTENCE_STATUS_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PERSISTENCE_STATUS_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_MAX_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
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
import { encodeRustIntegratedPersistenceStatusQueryV1 } from "../app/game/rust-integrated-runtime-persistence.ts";

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

test("BWS8/BWT8 use an identity-neutral bulk query and never enter command caching", async () => {
  const before = identity();
  const query = encodeRustIntegratedPersistenceStatusQueryV1();
  const request: RustIntegratedRuntimeBulkRequestV1 = {
    type: "runtime-bulk-persistence-status-v1",
    requestId: 41,
    clientEpoch: 2,
    expected: rustIntegratedRuntimeBulkStateV1(before),
    typeId: RUST_INTEGRATED_PERSISTENCE_STATUS_TYPE_V1,
    payload: query,
  };
  const encoded = encodeRustIntegratedRuntimeBulkRequestV1(request);
  assert.equal(encoded.attachment.byteLength, 0);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkRequestV1(encoded.control), request);

  const terminalReceipt = Uint8Array.of(0x42, 0x57, 0x54, 0x38, 1);
  const wireResponse: RustIntegratedRuntimeBulkResponseV1 = {
    type: "runtime-bulk-persistence-status-v1",
    requestId: request.requestId,
    clientEpoch: request.clientEpoch,
    workerEpoch: 3,
    current: request.expected,
    typeId: RUST_INTEGRATED_PERSISTENCE_STATUS_RECEIPT_TYPE_V1,
    payload: terminalReceipt,
  };
  const encodedResponse = encodeRustIntegratedRuntimeBulkResponseV1(wireResponse);
  assert.equal(encodedResponse.attachment.byteLength, 0);
  assert.deepEqual(decodeRustIntegratedRuntimeBulkResponseV1(encodedResponse.control), wireResponse);

  const requestKinds: string[] = [];
  const service = new RustIntegratedRuntimeServiceV1({
    mode: "protocol-test",
    transportFactory: () => ({
      async request(normal): Promise<RustIntegratedRuntimeResponseV1> {
        requestKinds.push(normal.type);
        if (normal.type !== "runtime-create-v1") throw new Error(`unexpected ${normal.type}`);
        return {
          ...normalReady(normal),
          capabilities: ["awaited-receipts-v1", "bounded-extraction-v1", "bulk-platform-v1", "fixed-step-input-v1", "integrated-runtime-v1"],
        };
      },
      async requestBulk(bulk: RustIntegratedRuntimeBulkRequestV1): Promise<RustIntegratedRuntimeBulkResponseV1> {
        requestKinds.push(bulk.type);
        assert.equal(bulk.type, "runtime-bulk-persistence-status-v1");
        return { ...wireResponse, requestId: bulk.requestId, clientEpoch: bulk.clientEpoch };
      },
      bulkDiagnostics: () => Object.freeze({ pending: 0, queuedBytes: 0, peakQueuedBytes: 0, requests: 1, routineRequests: 1, recoveryScaleRequests: 0, backpressureRejects: 0, copiedInputBytes: 0, transferredInputBytes: 0, transferredOutputBytes: 0 }),
      dispose() {},
    }),
  });
  await service.start(config());
  const serviceBefore = service.identity();
  assert.deepEqual(await service.persistenceStatus(query), terminalReceipt);
  assert.deepEqual(service.identity(), serviceBefore);
  assert.deepEqual(requestKinds, ["runtime-create-v1", "runtime-bulk-persistence-status-v1"]);
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

test("world-only legacy migration owns one bounded typed projection attachment", () => {
  const backing = Uint8Array.of(0xaa, 0x42, 0x57, 0x41, 0x53, 0x80, 0xff, 0xbb);
  const request: RustIntegratedRuntimeBulkRequestV1 = {
    type: "runtime-bulk-migrate-legacy-world-v1",
    requestId: 11,
    clientEpoch: 2,
    expected: rustIntegratedRuntimeBulkStateV1(identity()),
    stageId: "legacy.world-only.1",
    createdAt: 101,
    sourceKey: "blockwild-world-data-v1:fixture",
    sourceFormat: "blockwild-world-save-canonical-v1",
    legacyNonWorldStateFlags: 0,
    typeId: RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
    worldProjection: backing.subarray(1, 7),
  };
  const encoded = encodeRustIntegratedRuntimeBulkRequestV1(request);
  assert.equal(encoded.copiedInputBytes, 6, "a BWAS subview becomes one exactly owned transferable attachment");
  assert.deepEqual(
    decodeRustIntegratedRuntimeBulkRequestV1(encoded.control, encoded.attachment),
    { ...request, worldProjection: Uint8Array.of(0x42, 0x57, 0x41, 0x53, 0x80, 0xff) },
  );
  assert.throws(
    () => decodeRustIntegratedRuntimeBulkRequestV1(encoded.control),
    /attachment length is invalid/u,
    "the projection can never disappear while its control survives",
  );
  for (const legacyNonWorldStateFlags of [-1, 0.5, 0x1_0000]) {
    assert.throws(
      () => encodeRustIntegratedRuntimeBulkRequestV1({ ...request, legacyNonWorldStateFlags }),
      /non-world state flags/u,
    );
  }
  assert.throws(
    () => encodeRustIntegratedRuntimeBulkRequestV1({
      ...request,
      typeId: "blockwild.runtime.legacy-world-projection.r8.v2" as typeof request.typeId,
    }),
    /legacy-world-projection.r8.v1/u,
  );
  assert.throws(
    () => encodeRustIntegratedRuntimeBulkRequestV1({ ...request, worldProjection: new Uint8Array() }),
    /32 MiB/u,
  );
  assert.throws(
    () => encodeRustIntegratedRuntimeBulkRequestV1({
      ...request,
      worldProjection: new Uint8Array(RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_MAX_BYTES_V1 + 1),
    }),
    /32 MiB/u,
  );
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

test("worker client transfers world-only migration bytes once and preserves the typed operation", async () => {
  const link = new LinkedBulkWorker();
  const received: Array<Extract<RustIntegratedRuntimeBulkRequestV1, { type: "runtime-bulk-migrate-legacy-world-v1" }>> = [];
  installRustIntegratedRuntimeWorkerHandlerV1(link.scope, {
    handle: normalReady,
    handleBulk(request) {
      assert.equal(request.type, "runtime-bulk-migrate-legacy-world-v1");
      if (request.type !== "runtime-bulk-migrate-legacy-world-v1") throw new Error("wrong bulk operation");
      received.push(request);
      return {
        type: "runtime-bulk-save-progress-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 3,
        current: Object.freeze({
          ...request.expected,
          revision: Object.freeze({ ...request.expected.revision, persistence: request.expected.revision.persistence + 1 }),
          stateHash: "9".repeat(32),
        }),
        stageId: request.stageId,
        state: "finalized",
        receivedChunks: 1,
        chunkCount: 1,
        receivedBytes: request.worldProjection.byteLength,
        setHash: "2".repeat(32),
        manifestHash: "3".repeat(32),
        dispatcherRequestId: 1,
        remainingDirtyRecords: 5,
      };
    },
  });
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 2_000);
  const projection = Uint8Array.of(0x42, 0x57, 0x41, 0x53, 0x80, 0xff);
  const response = await transport.requestBulk({
    type: "runtime-bulk-migrate-legacy-world-v1",
    requestId: 12,
    clientEpoch: 2,
    expected: rustIntegratedRuntimeBulkStateV1(identity()),
    stageId: "legacy.worker.1",
    createdAt: 102,
    sourceKey: "blockwild-world-data-v1:fixture",
    sourceFormat: "blockwild-world-save-canonical-v1",
    legacyNonWorldStateFlags: 0,
    typeId: RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
    worldProjection: projection,
  });
  assert.equal(projection.byteLength, 0, "the caller relinquishes its exactly owned projection buffer");
  assert.equal(response.type, "runtime-bulk-save-progress-v1");
  assert.equal(received.length, 1);
  assert.equal(received[0].stageId, "legacy.worker.1");
  assert.deepEqual(received[0].worldProjection, Uint8Array.of(0x42, 0x57, 0x41, 0x53, 0x80, 0xff));
  assert.equal(link.transfers[0].length, 2, "control and projection each transfer exactly once");
  assert.equal(transport.bulkDiagnostics().transferredInputBytes, 6);
  assert.equal(transport.bulkDiagnostics().copiedInputBytes, 0);
  assert.equal(transport.bulkDiagnostics().routineRequests, 0);
  assert.equal(transport.bulkDiagnostics().recoveryScaleRequests, 1, "migration is recovery-scale even for a tiny fixture projection");
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
      if (request.type === "runtime-bulk-poll-v1") {
        current = Object.freeze({ ...current, stateHash: "8".repeat(32) });
        return {
          type: "runtime-bulk-platform-request-v1",
          requestId: request.requestId,
          clientEpoch: request.clientEpoch,
          workerEpoch: 3,
          current: rustIntegratedRuntimeBulkStateV1(current),
          transferToken: 77,
          typeId: RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1,
          payload: Uint8Array.of(0x42, 0x57, 0x50, 0x52, 0x80, 0xff),
        };
      }
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
  assert.equal(service.identity().stateHash, "8".repeat(32), "poll adopts Rust's pending-to-in-flight custody identity");
  assert.equal(service.identity().revision.persistence, 5, "poll custody does not invent a durable persistence revision");
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

test("bulk service probes at the routine bound and widens only after Rust proves a queued packet is larger", async () => {
  const createService = (
    requests: RustIntegratedRuntimeBulkRequestV1[],
    handleBulk: (request: RustIntegratedRuntimeBulkRequestV1) => Promise<RustIntegratedRuntimeBulkResponseV1> | RustIntegratedRuntimeBulkResponseV1,
  ) => new RustIntegratedRuntimeServiceV1({
    mode: "protocol-test",
    transportFactory: () => ({
      async request(request: RustIntegratedRuntimeRequestV1): Promise<RustIntegratedRuntimeResponseV1> {
        if (request.type !== "runtime-create-v1") throw new Error(`unexpected ${request.type}`);
        return {
          ...normalReady(request),
          capabilities: ["awaited-receipts-v1", "bounded-extraction-v1", "bulk-platform-v1", "fixed-step-input-v1", "integrated-runtime-v1"],
        };
      },
      async requestBulk(request: RustIntegratedRuntimeBulkRequestV1) {
        requests.push(request);
        return handleBulk(request);
      },
      bulkDiagnostics: () => Object.freeze({ pending: 0, queuedBytes: 0, peakQueuedBytes: 0, requests: requests.length, routineRequests: 1, recoveryScaleRequests: Math.max(0, requests.length - 1), backpressureRejects: 0, copiedInputBytes: 0, transferredInputBytes: 0, transferredOutputBytes: 0 }),
      dispose() {},
    }),
  });

  const emptyRequests: RustIntegratedRuntimeBulkRequestV1[] = [];
  const emptyService = createService(emptyRequests, (request) => ({
    type: "runtime-bulk-empty-v1",
    requestId: request.requestId,
    clientEpoch: request.clientEpoch,
    workerEpoch: 3,
    current: request.expected,
  }));
  await emptyService.start(config());
  assert.equal((await emptyService.pollBulkPlatform(RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1)).type, "runtime-bulk-empty-v1");
  assert.deepEqual(
    emptyRequests.map((request) => request.type === "runtime-bulk-poll-v1" ? request.maxBytes : null),
    [RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1],
    "an empty poll never advertises the caller's 128 MiB capacity to the routine watchdog",
  );

  const largeRequests: RustIntegratedRuntimeBulkRequestV1[] = [];
  const largeService = createService(largeRequests, (request) => {
    assert.equal(request.type, "runtime-bulk-poll-v1");
    if (largeRequests.length === 1) {
      return {
        type: "runtime-bulk-error-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 3,
        code: "persistence-dispatch-error",
        message: `dispatch-packet-too-large: next BWPR requires ${RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1 + 1} bytes`,
        current: request.expected,
      };
    }
    return {
      type: "runtime-bulk-platform-request-v1",
      requestId: request.requestId,
      clientEpoch: request.clientEpoch,
      workerEpoch: 3,
      current: Object.freeze({ ...request.expected, stateHash: "8".repeat(32) }),
      transferToken: 77,
      typeId: RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1,
      payload: new Uint8Array(RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1 + 1),
    };
  });
  await largeService.start(config());
  const large = await largeService.pollBulkPlatform(RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1);
  assert.equal(large.type, "runtime-bulk-platform-request-v1");
  assert.deepEqual(
    largeRequests.map((request) => request.type === "runtime-bulk-poll-v1" ? request.maxBytes : null),
    [RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1, RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1],
  );
  assert.notEqual(largeRequests[0].requestId, largeRequests[1].requestId, "the bounded retry is a distinct awaited request");
});

test("bulk capacity probe retries only an exact same-generation no-mutation rejection", async () => {
  const createRejectedService = (
    response: (request: Extract<RustIntegratedRuntimeBulkRequestV1, { type: "runtime-bulk-poll-v1" }>) => RustIntegratedRuntimeBulkResponseV1,
    calls: number[],
  ) => new RustIntegratedRuntimeServiceV1({
    mode: "protocol-test",
    transportFactory: () => ({
      async request(request: RustIntegratedRuntimeRequestV1): Promise<RustIntegratedRuntimeResponseV1> {
        if (request.type !== "runtime-create-v1") throw new Error(`unexpected ${request.type}`);
        return {
          ...normalReady(request),
          capabilities: ["awaited-receipts-v1", "bounded-extraction-v1", "bulk-platform-v1", "fixed-step-input-v1", "integrated-runtime-v1"],
        };
      },
      async requestBulk(request: RustIntegratedRuntimeBulkRequestV1) {
        assert.equal(request.type, "runtime-bulk-poll-v1");
        calls.push(request.maxBytes);
        return response(request);
      },
      bulkDiagnostics: () => Object.freeze({ pending: 0, queuedBytes: 0, peakQueuedBytes: 0, requests: calls.length, routineRequests: calls.length, recoveryScaleRequests: 0, backpressureRejects: 0, copiedInputBytes: 0, transferredInputBytes: 0, transferredOutputBytes: 0 }),
      dispose() {},
    }),
  });
  const error = (
    request: Extract<RustIntegratedRuntimeBulkRequestV1, { type: "runtime-bulk-poll-v1" }>,
    changes: Partial<Extract<RustIntegratedRuntimeBulkResponseV1, { type: "runtime-bulk-error-v1" }>> = {},
  ): Extract<RustIntegratedRuntimeBulkResponseV1, { type: "runtime-bulk-error-v1" }> => ({
    type: "runtime-bulk-error-v1",
    requestId: request.requestId,
    clientEpoch: request.clientEpoch,
    workerEpoch: 3,
    code: "persistence-dispatch-error",
    message: `dispatch-packet-too-large: next BWPR requires ${RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1 + 1} bytes`,
    current: request.expected,
    ...changes,
  });

  const otherCalls: number[] = [];
  const other = createRejectedService((request) => error(request, { code: "quota-denied" }), otherCalls);
  await other.start(config());
  await assert.rejects(
    other.pollBulkPlatform(RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1),
    (failure: unknown) => failure instanceof RustIntegratedRuntimeServiceError && failure.code === "bulk-platform",
  );
  assert.deepEqual(otherCalls, [RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1]);
  assert.equal(other.diagnostics().state, "ready", "an ordinary explicit rejection retains the existing usable-generation contract");

  const malformedCalls: number[] = [];
  const malformed = createRejectedService((request) => error(request, {
    message: "dispatch-packet-too-large: next BWPR requires unknown bytes",
  }), malformedCalls);
  await malformed.start(config());
  await assert.rejects(
    malformed.pollBulkPlatform(RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1),
    (failure: unknown) => failure instanceof RustIntegratedRuntimeServiceError && failure.code === "bulk-platform",
  );
  assert.deepEqual(malformedCalls, [RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1], "a lookalike nested error cannot widen the poll");

  const invalid = [
    {
      name: "missing authority evidence",
      changes: { current: null },
    },
    {
      name: "mutated authority evidence",
      changes: { current: Object.freeze({ ...rustIntegratedRuntimeBulkStateV1(identity()), stateHash: "9".repeat(32) }) },
    },
    {
      name: "another client generation",
      changes: { clientEpoch: 99 },
    },
  ] as const;
  for (const entry of invalid) {
    const calls: number[] = [];
    const service = createRejectedService((request) => error(request, entry.changes), calls);
    await service.start(config());
    await assert.rejects(
      service.pollBulkPlatform(RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1),
      (failure: unknown) => failure instanceof RustIntegratedRuntimeServiceError && failure.code === "invalid-response",
      entry.name,
    );
    assert.deepEqual(calls, [RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1], `${entry.name} cannot authorize a retry`);
    assert.equal(service.diagnostics().state, "failed", `${entry.name} fails the generation closed`);
  }
});

test("bulk platform poll accepts only a state-hash-only dispatcher custody transition", async () => {
  const cases = [
    {
      name: "unchanged state hash",
      mutate: (current: RustIntegratedRuntimeIdentityV1) => current,
    },
    {
      name: "tick advance",
      mutate: (current: RustIntegratedRuntimeIdentityV1) => Object.freeze({ ...current, tick: current.tick + 1, stateHash: "8".repeat(32) }),
    },
    {
      name: "revision advance",
      mutate: (current: RustIntegratedRuntimeIdentityV1) => Object.freeze({
        ...current,
        revision: Object.freeze({ ...current.revision, persistence: current.revision.persistence + 1 }),
        stateHash: "8".repeat(32),
      }),
    },
  ] as const;

  for (const entry of cases) {
    const service = new RustIntegratedRuntimeServiceV1({
      mode: "protocol-test",
      transportFactory: () => ({
        async request(request: RustIntegratedRuntimeRequestV1): Promise<RustIntegratedRuntimeResponseV1> {
          if (request.type !== "runtime-create-v1") throw new Error(`unexpected ${request.type}`);
          return {
            ...normalReady(request),
            capabilities: ["awaited-receipts-v1", "bounded-extraction-v1", "bulk-platform-v1", "fixed-step-input-v1", "integrated-runtime-v1"],
          };
        },
        async requestBulk(request: RustIntegratedRuntimeBulkRequestV1): Promise<RustIntegratedRuntimeBulkResponseV1> {
          return {
            type: "runtime-bulk-platform-request-v1",
            requestId: request.requestId,
            clientEpoch: request.clientEpoch,
            workerEpoch: 3,
            current: rustIntegratedRuntimeBulkStateV1(entry.mutate(identity())),
            transferToken: 77,
            typeId: RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1,
            payload: Uint8Array.of(0x42, 0x57, 0x50, 0x52),
          };
        },
        bulkDiagnostics: () => Object.freeze({ pending: 0, queuedBytes: 0, peakQueuedBytes: 4, requests: 1, routineRequests: 1, recoveryScaleRequests: 0, backpressureRejects: 0, copiedInputBytes: 0, transferredInputBytes: 0, transferredOutputBytes: 4 }),
        dispose() {},
      }),
    });
    await service.start(config());
    await assert.rejects(
      service.pollBulkPlatform(),
      (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "invalid-response",
      entry.name,
    );
    assert.equal(service.diagnostics().state, "failed", `${entry.name} fails the authority generation closed`);
  }
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

test("production service exposes only the dedicated world-only migration and rejects stale authority evidence", async () => {
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
      if (request.type !== "runtime-bulk-migrate-legacy-world-v1") throw new Error(`unexpected ${request.type}`);
      if (request.legacyNonWorldStateFlags !== 0) return {
        type: "runtime-bulk-error-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 3,
        code: "legacy-migration-rich-save",
        message: "legacy save retains unsupported native domains: player",
        current: request.expected,
      };
      return {
        type: "runtime-bulk-save-progress-v1",
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 3,
        current: Object.freeze({
          ...request.expected,
          revision: Object.freeze({ ...request.expected.revision, persistence: request.expected.revision.persistence + 1 }),
          stateHash: "9".repeat(32),
        }),
        stageId: request.stageId,
        state: "finalized",
        receivedChunks: 1,
        chunkCount: 1,
        receivedBytes: 6,
        setHash: "2".repeat(32),
        manifestHash: "3".repeat(32),
        dispatcherRequestId: 1,
        remainingDirtyRecords: 5,
      };
    },
    bulkDiagnostics: () => Object.freeze({ pending: 0, queuedBytes: 0, peakQueuedBytes: 6, requests: seen.length, routineRequests: 0, recoveryScaleRequests: seen.length, backpressureRejects: 0, copiedInputBytes: 0, transferredInputBytes: 6, transferredOutputBytes: 0 }),
    dispose() {},
  };
  const service = new RustIntegratedRuntimeServiceV1({
    expectedArtifactHash: "fixture",
    transportFactory: () => transport,
  });
  await service.start(config());
  const projection = Uint8Array.of(0x42, 0x57, 0x41, 0x53, 0x80, 0xff);
  for (const malformedFlags of [-1, 0.5, 0x1_0000]) {
    await assert.rejects(
      service.migrateLegacyWorldOnly(
        "legacy.world-only.1",
        101,
        malformedFlags,
        "blockwild-world-data-v1:fixture",
        "blockwild-world-save-canonical-v1",
        projection,
      ),
      (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "bulk-platform",
    );
  }
  await assert.rejects(
    service.migrateLegacyWorldOnly(
      "legacy.world-only.1",
      101,
      0,
      "blockwild-world-data-v1:fixture",
      "blockwild-world-save-canonical-v1",
      new Uint8Array(),
    ),
    (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "capacity",
  );
  assert.equal(seen.length, 0, "invalid host input cannot reach the worker");

  await assert.rejects(
    service.migrateLegacyWorldOnly(
      "legacy.world-only.1",
      101,
      2,
      "blockwild-world-data-v1:fixture",
      "blockwild-world-save-canonical-v1",
      projection,
    ),
    (error: unknown) => error instanceof RustIntegratedRuntimeServiceError
      && error.code === "bulk-platform"
      && /legacy-migration-rich-save/u.test(error.message),
  );
  assert.equal(service.diagnostics().state, "ready", "Rust's exact no-mutation rich-save rejection preserves the staged source generation");

  const progress = await service.migrateLegacyWorldOnly(
    "legacy.world-only.1",
    101,
    0,
    "blockwild-world-data-v1:fixture",
    "blockwild-world-save-canonical-v1",
    projection,
  );
  assert.equal(progress.stageId, "legacy.world-only.1");
  assert.equal(service.identity().revision.persistence, identity().revision.persistence + 1);
  assert.equal(seen.length, 2);
  const request = seen[1];
  assert.equal(request.type, "runtime-bulk-migrate-legacy-world-v1");
  if (request.type === "runtime-bulk-migrate-legacy-world-v1") {
    assert.equal(request.typeId, RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1);
    assert.equal(request.stageId, "legacy.world-only.1");
    assert.equal(request.createdAt, 101);
    assert.equal(request.sourceKey, "blockwild-world-data-v1:fixture");
    assert.equal(request.sourceFormat, "blockwild-world-save-canonical-v1");
    assert.equal(request.legacyNonWorldStateFlags, 0);
    assert.deepEqual(request.worldProjection, projection);
  }

  const invalidAuthorityCases = [
    {
      name: "missing",
      current: (request: RustIntegratedRuntimeBulkRequestV1) => {
        void request;
        return null;
      },
    },
    {
      name: "stale",
      current: (request: RustIntegratedRuntimeBulkRequestV1) => Object.freeze({ ...request.expected, stateHash: "8".repeat(32) }),
    },
  ] as const;
  for (const authorityCase of invalidAuthorityCases) {
    const stale = new RustIntegratedRuntimeServiceV1({
      expectedArtifactHash: "fixture",
      transportFactory: () => ({
        request: transport.request,
        async requestBulk(request: RustIntegratedRuntimeBulkRequestV1): Promise<RustIntegratedRuntimeBulkResponseV1> {
          return {
            type: "runtime-bulk-error-v1",
            requestId: request.requestId,
            clientEpoch: request.clientEpoch,
            workerEpoch: 3,
            code: "legacy-migration-rich-save",
            message: `fixture ${authorityCase.name} rejection`,
            current: authorityCase.current(request),
          };
        },
        bulkDiagnostics: transport.bulkDiagnostics,
        dispose() {},
      }),
    });
    await stale.start(config());
    await assert.rejects(
      stale.migrateLegacyWorldOnly(
        `legacy.${authorityCase.name}.1`,
        102,
        0,
        "blockwild-world-data-v1:fixture",
        "blockwild-world-save-canonical-v1",
        projection,
      ),
      (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "invalid-response",
    );
    assert.equal(stale.diagnostics().state, "failed", `${authorityCase.name} migration authority evidence poisons the worker generation`);
  }
});
