import assert from "node:assert/strict";
import test from "node:test";
import type {
  RustIntegratedRuntimeConfigV1,
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeRequestV1,
  RustIntegratedRuntimeResponseV1,
  RustIntegratedRuntimeStepRequestV2,
} from "../app/game/rust-integrated-runtime-contract.ts";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  encodeRustIntegratedRuntimeResponseV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import {
  RUST_CONTENT_INSTALL_PAGE_BUDGET_V1,
  RUST_CONTENT_INSTALL_PAGE_TYPE_V1,
  compileRustProductionContent,
  createRustContentInstallPlanV1,
  decodeRustContentInstallPageV1,
  encodeRustContentInstallPageV1,
} from "../app/game/rust-integrated-runtime-content.ts";
import {
  RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1,
  RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
  type RustIntegratedRuntimeBulkRequestV1,
} from "../app/game/rust-integrated-runtime-bulk-platform.ts";
import { RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1 } from "../app/game/rust-persistence-runtime-contract.ts";
import {
  installRustIntegratedRuntimeWorkerHandlerV1,
  RUST_INTEGRATED_RUNTIME_BOOTSTRAP_TIMEOUT_MAX_MS_V1,
  RUST_INTEGRATED_RUNTIME_BOOTSTRAP_TIMEOUT_MAX_MULTIPLIER_V1,
  RUST_INTEGRATED_RUNTIME_BULK_TIMEOUT_MAX_MS_V1,
  RUST_INTEGRATED_RUNTIME_CONTENT_INSTALL_TIMEOUT_MAX_MS_V1,
  RustIntegratedRuntimeWorkerError,
  RustIntegratedRuntimeWorkerTransportV1,
  rustIntegratedRuntimeBulkTimeoutMsV1,
  rustIntegratedRuntimeRequestTimeoutMsV1,
  type RustIntegratedRuntimeWorkerPortV1,
  type RustIntegratedRuntimeWorkerScopeV1,
} from "../app/game/rust-integrated-runtime-worker.ts";

const ZERO_HASH = "0".repeat(32);
const CAPABILITIES = Object.freeze([
  "awaited-receipts-v1",
  "bounded-extraction-v1",
  "fixed-step-input-v1",
  "integrated-runtime-v1",
]);

function identity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "1",
    locationId: "surface",
    revision: Object.freeze({ epoch: 1, world: 0, entities: 0, gameplay: 0, persistence: 0, network: 0, simulation: 0 }),
    tick: 0,
    stateHash: ZERO_HASH,
  });
}

function config(): RustIntegratedRuntimeConfigV1 {
  return Object.freeze({
    worldSeed: "worker-fixture",
    universeId: "1",
    locationId: "surface",
    sessionId: "test",
    contentHash: ZERO_HASH,
    generatorHash: ZERO_HASH,
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
    waterBlockId: 7,
    directionalBlockIds: Object.freeze([]),
    waterloggedBlockIds: Object.freeze([]),
  });
}

function ready(request: RustIntegratedRuntimeRequestV1): RustIntegratedRuntimeResponseV1 {
  return Object.freeze({
    type: "runtime-ready-v1",
    requestId: request.requestId,
    clientEpoch: request.clientEpoch,
    workerEpoch: 3,
    runtimeHandle: 1,
    identity: identity(),
    artifactHash: "artifact",
    instanceId: "worker-fixture",
    capabilities: CAPABILITIES,
  });
}

function restored(
  request: Extract<RustIntegratedRuntimeRequestV1, { type: "runtime-restore-v1" }>,
): RustIntegratedRuntimeResponseV1 {
  return Object.freeze({
    type: "runtime-restored-v1",
    requestId: request.requestId,
    clientEpoch: request.clientEpoch,
    workerEpoch: 3,
    runtimeHandle: 1,
    identity: identity(),
    checkpointHash: request.expectedCheckpointHash,
    artifactHash: "artifact",
    instanceId: "worker-fixture",
    capabilities: CAPABILITIES,
  });
}

function contentInstallPayload() {
  const bundle = compileRustProductionContent("worker-timeout-fixture-v1", [{
    domain: "item",
    id: "worker-timeout-item",
    schemaId: "worker-timeout-item-v1",
    schemaVersion: 1,
    contentVersion: 1,
    value: Object.freeze({ label: "Worker timeout fixture" }),
  }]);
  const page = createRustContentInstallPlanV1(bundle).pages[0];
  assert.deepEqual(decodeRustContentInstallPageV1(page.payload), page.page, "positive BWC7 timeout fixture must canonically decode");
  return Uint8Array.from(page.payload);
}

function contentInstallPacket(body: Uint8Array) {
  const payload = new Uint8Array(28 + body.byteLength);
  payload.set([0x42, 0x57, 0x43, 0x37]);
  const header = new DataView(payload.buffer);
  header.setUint16(4, 1, true);
  header.setUint16(6, 1, true);
  header.setUint32(8, body.byteLength, true);
  payload.set(Buffer.from(rustIntegratedRuntimeWireChecksumV1(body), "hex"), 12);
  payload.set(body, 28);
  return payload;
}

function commandRequest(
  requestId: number,
  operations = [createRustIntegratedRuntimeDomainOperationV1({
    domain: "gameplay",
    typeId: RUST_CONTENT_INSTALL_PAGE_TYPE_V1,
    schema: 1,
    payload: contentInstallPayload(),
  })],
  type: "runtime-command-v1" | "runtime-recover-command-v1" = "runtime-command-v1",
): RustIntegratedRuntimeRequestV1 {
  return Object.freeze({
    type,
    requestId,
    clientEpoch: 1,
    batch: createRustIntegratedRuntimeCommandBatchV1({
      commandId: `content:${requestId}`,
      idempotencyKey: `content:${requestId}`,
      actorId: "runtime-content-installer",
      expected: identity(),
      operations,
    }),
  });
}

class LinkedWorker {
  private readonly mainMessage = new Set<(event: Readonly<{ data: unknown }>) => void>();
  private readonly workerMessage = new Set<(event: Readonly<{ data: unknown }>) => void>();
  private readonly errors = new Set<(event: Readonly<{ message?: string; error?: unknown }>) => void>();
  private readonly messageErrors = new Set<(event: Readonly<{ message?: string; error?: unknown }>) => void>();
  terminated = false;

  readonly port: RustIntegratedRuntimeWorkerPortV1 = {
    postMessage: (message) => {
      if (this.terminated) throw new Error("worker terminated");
      queueMicrotask(() => { for (const listener of this.workerMessage) listener({ data: message }); });
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
    postMessage: (message) => {
      if (this.terminated) throw new Error("worker terminated");
      queueMicrotask(() => { for (const listener of this.mainMessage) listener({ data: message }); });
    },
    addEventListener: (_type, listener) => { this.workerMessage.add(listener); },
  };

  crash(message: string): void {
    for (const listener of this.errors) listener({ message, error: new Error(message) });
  }

  respond(response: RustIntegratedRuntimeResponseV1): void {
    const encoded = encodeRustIntegratedRuntimeResponseV1(response);
    const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    for (const listener of this.mainMessage) listener({ data: { type: "blockwild-integrated-runtime-wire-v1", bytes } });
  }

  respondStepWithLegacy(response: RustIntegratedRuntimeResponseV1): void {
    const encoded = encodeRustIntegratedRuntimeResponseV1(response);
    const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    for (const listener of this.mainMessage) listener({ data: { type: "blockwild-integrated-runtime-step-v2", bytes } });
  }
}

test("real worker handler serializes coarse requests through one runtime instance", async () => {
  const link = new LinkedWorker();
  let active = 0;
  let maximumActive = 0;
  let handled = 0;
  installRustIntegratedRuntimeWorkerHandlerV1(link.scope, {
    async handle(request) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
      handled += 1;
      active -= 1;
      return ready(request);
    },
  });
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 2_000);
  const results = await Promise.all(Array.from({ length: 100 }, (_, index) => transport.request({
    type: "runtime-create-v1",
    requestId: index + 1,
    clientEpoch: 1,
    config: config(),
  })));
  assert.equal(results.length, 100);
  assert.equal(handled, 100);
  assert.equal(maximumActive, 1, "the sole Wasm runtime may never be entered concurrently");
  transport.dispose();
  assert.equal(link.terminated, true);
});

test("dedicated StepV2 worker message round-trips without entering the generic decoder", async () => {
  const link = new LinkedWorker();
  let received: RustIntegratedRuntimeStepRequestV2 | null = null;
  installRustIntegratedRuntimeWorkerHandlerV1(link.scope, {
    handle: ready,
    handleStepV2(request) {
      received = request;
      return Object.freeze({
        type: "runtime-step-result-v2" as const,
        requestId: request.requestId,
        clientEpoch: request.clientEpoch,
        workerEpoch: 3,
        identity: identity(),
        fixedSteps: 0,
        inputsApplied: 0,
        commandsProcessed: 0,
        commandsAccepted: 0,
        actionReceipts: Object.freeze([]),
        replayHash: ZERO_HASH,
        semanticReceipts: Object.freeze([]),
      });
    },
  });
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 2_000);
  const request = Object.freeze({
    type: "runtime-step-v2" as const,
    requestId: 41,
    clientEpoch: 7,
    expected: identity(),
    monotonicTimeUs: 1_000_000,
    budgetUs: 8_000,
    inputs: Object.freeze([]),
    contextCommands: Object.freeze([]),
  });
  const response = await transport.requestStepV2(request);
  assert.deepEqual(received, request);
  assert.equal(response.type, "runtime-step-result-v2");
  assert.equal(response.requestId, 41);
  transport.dispose();
});

test("StepV2 worker transport rejects a generic success response and closes the generation", async () => {
  const link = new LinkedWorker();
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 2_000);
  const pending = transport.requestStepV2({
    type: "runtime-step-v2",
    requestId: 42,
    clientEpoch: 7,
    expected: identity(),
    monotonicTimeUs: 1,
    budgetUs: 8_000,
    inputs: [],
    contextCommands: [],
  });
  link.respondStepWithLegacy({
    type: "runtime-step-result-v1",
    requestId: 42,
    clientEpoch: 7,
    workerEpoch: 3,
    identity: identity(),
    fixedSteps: 0,
    inputsApplied: 0,
    commandsProcessed: 0,
    commandsAccepted: 0,
    actionReceipts: [],
    replayHash: ZERO_HASH,
  });
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "protocol",
  );
  assert.equal(link.terminated, true);
});

test("worker crash rejects every outstanding request and permanently closes the generation", async () => {
  const link = new LinkedWorker();
  installRustIntegratedRuntimeWorkerHandlerV1(link.scope, { handle: () => new Promise<RustIntegratedRuntimeResponseV1>(() => undefined) });
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 2_000);
  const first = transport.request({ type: "runtime-create-v1", requestId: 1, clientEpoch: 1, config: config() });
  const second = transport.request({ type: "runtime-create-v1", requestId: 2, clientEpoch: 1, config: config() });
  link.crash("fixture crash");
  await assert.rejects(first, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "crash");
  await assert.rejects(second, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "crash");
  await assert.rejects(
    transport.request({ type: "runtime-create-v1", requestId: 3, clientEpoch: 1, config: config() }),
    (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "disposed",
  );
  assert.equal(link.terminated, true);
});

test("one bounded bootstrap timeout aborts the entire worker generation", async () => {
  const link = new LinkedWorker();
  installRustIntegratedRuntimeWorkerHandlerV1(link.scope, { handle: () => new Promise<RustIntegratedRuntimeResponseV1>(() => undefined) });
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 1);
  const first = transport.request({ type: "runtime-create-v1", requestId: 1, clientEpoch: 1, config: config() });
  const second = transport.request({
    type: "runtime-restore-v1",
    requestId: 2,
    clientEpoch: 1,
    expectedCheckpointHash: ZERO_HASH,
    checkpoint: new Uint8Array(),
  });
  await Promise.all([
    assert.rejects(first, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError
      && error.code === "timeout"
      && error.message.includes("exceeded 12 ms")),
    assert.rejects(second, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "timeout"),
  ]);
  await assert.rejects(
    transport.request({ type: "runtime-create-v1", requestId: 3, clientEpoch: 1, config: config() }),
    (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "disposed",
  );
  assert.equal(link.terminated, true);
});

test("create and restore receive a bounded bootstrap deadline while routine requests stay tight", () => {
  const create = Object.freeze({
    type: "runtime-create-v1" as const,
    requestId: 21,
    clientEpoch: 1,
    config: config(),
  });
  const restore = Object.freeze({
    type: "runtime-restore-v1" as const,
    requestId: 22,
    clientEpoch: 1,
    expectedCheckpointHash: ZERO_HASH,
    checkpoint: new Uint8Array(),
  });
  assert.equal(RUST_INTEGRATED_RUNTIME_BOOTSTRAP_TIMEOUT_MAX_MULTIPLIER_V1, 12);
  for (const request of [create, restore]) {
    assert.equal(
      rustIntegratedRuntimeRequestTimeoutMsV1(request, 5_000),
      RUST_INTEGRATED_RUNTIME_BOOTSTRAP_TIMEOUT_MAX_MS_V1,
      `${request.type} receives the bounded production bootstrap deadline`,
    );
    assert.equal(
      rustIntegratedRuntimeRequestTimeoutMsV1(request, 5),
      60,
      `${request.type} keeps tiny fixture deadlines fast`,
    );
    assert.equal(
      rustIntegratedRuntimeRequestTimeoutMsV1(request, 10_000),
      RUST_INTEGRATED_RUNTIME_BOOTSTRAP_TIMEOUT_MAX_MS_V1,
      `${request.type} cannot extend beyond the bootstrap cap`,
    );
  }
  assert.equal(
    rustIntegratedRuntimeRequestTimeoutMsV1(
      { type: "runtime-shutdown-v1", requestId: 23, clientEpoch: 1, expected: null },
      5_000,
    ),
    5_000,
    "ordinary lifecycle work keeps the latency-sensitive routine deadline",
  );
});

test("delayed create and restore succeed beyond the routine deadline", async () => {
  const requests: readonly RustIntegratedRuntimeRequestV1[] = Object.freeze([
    Object.freeze({ type: "runtime-create-v1", requestId: 24, clientEpoch: 1, config: config() }),
    Object.freeze({
      type: "runtime-restore-v1",
      requestId: 25,
      clientEpoch: 1,
      expectedCheckpointHash: ZERO_HASH,
      checkpoint: new Uint8Array(),
    }),
  ]);
  for (const bootstrap of requests) {
    const link = new LinkedWorker();
    installRustIntegratedRuntimeWorkerHandlerV1(link.scope, {
      async handle(request) {
        await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
        return request.type === "runtime-restore-v1" ? restored(request) : ready(request);
      },
    });
    const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 5);
    const response = await transport.request(bootstrap);
    assert.equal(response.requestId, bootstrap.requestId);
    assert.equal(link.terminated, false, `${bootstrap.type} remains live after exceeding the 5 ms routine deadline`);
    transport.dispose();
    assert.equal(link.terminated, true);
  }
});

test("every exact BWC7 gameplay content-install page receives the bounded wider timeout", () => {
  const routineTimeoutMs = 5_000;
  const exact = commandRequest(31);
  assert.equal(RUST_CONTENT_INSTALL_PAGE_TYPE_V1, "blockwild.gameplay.content-install-page.v1");
  assert.equal(
    rustIntegratedRuntimeRequestTimeoutMsV1(exact, routineTimeoutMs),
    RUST_INTEGRATED_RUNTIME_CONTENT_INSTALL_TIMEOUT_MAX_MS_V1,
  );

  const operation = exact.type === "runtime-command-v1" ? exact.batch.operations[0] : null;
  assert.ok(operation);
  const variant = (domain: typeof operation.domain, typeId: string, payload = operation.payload) => createRustIntegratedRuntimeDomainOperationV1({
    domain,
    typeId,
    schema: 1,
    payload,
  });
  const malformed = Uint8Array.from(operation.payload);
  malformed[0] = 0;
  const badChecksum = Uint8Array.from(operation.payload);
  badChecksum[12] ^= 0xff;
  const truncatedBody = operation.payload.subarray(28, operation.payload.byteLength - 1);
  const structurallyTruncated = contentInstallPacket(truncatedBody);
  const oversized = contentInstallPacket(new Uint8Array(
    RUST_CONTENT_INSTALL_PAGE_BUDGET_V1 - 28 + 1,
  ));
  const terminalPage = decodeRustContentInstallPageV1(operation.payload);
  const nonterminalPage = Object.freeze({ ...terminalPage, pageIndex: 2, pageCount: 4 });
  const nonterminal = encodeRustContentInstallPageV1(nonterminalPage);
  assert.deepEqual(decodeRustContentInstallPageV1(nonterminal), nonterminalPage, "nonterminal fixture must remain a valid BWC7 page");
  assert.equal(
    rustIntegratedRuntimeRequestTimeoutMsV1(
      commandRequest(48, [variant(operation.domain, operation.typeId, nonterminal)]),
      routineTimeoutMs,
    ),
    RUST_INTEGRATED_RUNTIME_CONTENT_INSTALL_TIMEOUT_MAX_MS_V1,
    "an exact nonterminal page receives the same bounded installer deadline",
  );
  const routine = [
    commandRequest(32, [variant("world", operation.typeId)]),
    commandRequest(33, [variant(operation.domain, "blockwild.gameplay.not-content-install.v1")]),
    commandRequest(34, [variant(operation.domain, operation.typeId, malformed)]),
    commandRequest(35, [operation, variant(operation.domain, "blockwild.gameplay.other.v1")]),
    commandRequest(36, [operation], "runtime-recover-command-v1"),
    commandRequest(38, [variant(operation.domain, operation.typeId, badChecksum)]),
    commandRequest(39, [variant(operation.domain, operation.typeId, structurallyTruncated)]),
    commandRequest(40, [variant(operation.domain, operation.typeId, oversized)]),
  ];
  for (const request of routine) {
    assert.equal(rustIntegratedRuntimeRequestTimeoutMsV1(request, routineTimeoutMs), routineTimeoutMs);
  }
});

test("content-install transport applies extended deadlines only to exact pages", async () => {
  const terminal = commandRequest(41);
  const operation = terminal.type === "runtime-command-v1" ? terminal.batch.operations[0] : null;
  assert.ok(operation);
  const page = decodeRustContentInstallPageV1(operation.payload);
  const nonterminalPayload = encodeRustContentInstallPageV1(Object.freeze({
    ...page,
    pageIndex: 2,
    pageCount: 4,
  }));
  const nonterminal = commandRequest(42, [createRustIntegratedRuntimeDomainOperationV1({
    domain: operation.domain,
    typeId: operation.typeId,
    schema: operation.schema,
    payload: nonterminalPayload,
  })]);
  const malformedPayload = Uint8Array.from(operation.payload);
  malformedPayload[12] ^= 0xff;
  const malformed = commandRequest(43, [createRustIntegratedRuntimeDomainOperationV1({
    domain: operation.domain,
    typeId: operation.typeId,
    schema: operation.schema,
    payload: malformedPayload,
  })]);

  for (const [request, expectedTimeoutMs] of [
    [terminal, 24],
    [nonterminal, 24],
    [malformed, 1],
  ] as const) {
    const link = new LinkedWorker();
    const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 1);
    await assert.rejects(
      transport.request(request),
      (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError
        && error.code === "timeout"
        && error.message.includes(`exceeded ${expectedTimeoutMs} ms`),
    );
    await assert.rejects(
      transport.request({
        type: "runtime-create-v1",
        requestId: request.requestId + 100,
        clientEpoch: 1,
        config: config(),
      }),
      (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "disposed",
    );
    assert.equal(link.terminated, true);
  }
});

test("a delayed nonterminal content page succeeds without retiring the worker generation", async () => {
  const terminal = commandRequest(44);
  const operation = terminal.type === "runtime-command-v1" ? terminal.batch.operations[0] : null;
  assert.ok(operation);
  const page = decodeRustContentInstallPageV1(operation.payload);
  const nonterminal = commandRequest(44, [createRustIntegratedRuntimeDomainOperationV1({
    domain: operation.domain,
    typeId: operation.typeId,
    schema: operation.schema,
    payload: encodeRustContentInstallPageV1(Object.freeze({
      ...page,
      pageIndex: 2,
      pageCount: 4,
    })),
  })]);
  const routineTimeoutMs = 5;
  assert.equal(
    rustIntegratedRuntimeRequestTimeoutMsV1(nonterminal, routineTimeoutMs),
    120,
    "the exact nonterminal page receives a deadline beyond the delayed response",
  );

  const link = new LinkedWorker();
  installRustIntegratedRuntimeWorkerHandlerV1(link.scope, {
    async handle(request) {
      if (request.requestId === nonterminal.requestId) {
        await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
      }
      return ready(request);
    },
  });
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, routineTimeoutMs);
  const installed = await transport.request(nonterminal);
  assert.equal(installed.requestId, nonterminal.requestId);
  assert.equal(link.terminated, false, "success after the routine deadline keeps the worker alive");

  const followUp = await transport.request({
    type: "runtime-create-v1",
    requestId: 45,
    clientEpoch: 1,
    config: config(),
  });
  assert.equal(followUp.requestId, 45, "an ordinary follow-up still succeeds on the same worker generation");
  assert.equal(link.terminated, false);
  transport.dispose();
  assert.equal(link.terminated, true);
});

test("bulk timeout policy preserves routine latency and bounds recovery-scale work", () => {
  const routineTimeoutMs = 5_000;
  const routine = Object.freeze({
    type: "runtime-bulk-poll-v1" as const,
    requestId: 51,
    clientEpoch: 7,
    expected: identity(),
    maxBytes: RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1,
  });
  assert.equal(
    rustIntegratedRuntimeBulkTimeoutMsV1(routine, 0, routineTimeoutMs),
    routineTimeoutMs,
    "a routine poll keeps the existing tight timeout",
  );

  const recovery = Object.freeze({
    ...routine,
    requestId: 52,
    maxBytes: RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1,
  });
  const recoveryTimeoutMs = rustIntegratedRuntimeBulkTimeoutMsV1(recovery, 0, routineTimeoutMs);
  assert.ok(recoveryTimeoutMs > routineTimeoutMs);
  assert.ok(recoveryTimeoutMs <= RUST_INTEGRATED_RUNTIME_BULK_TIMEOUT_MAX_MS_V1);
  assert.equal(recoveryTimeoutMs, 85_000, "the 64 MiB + 64 KiB contract has a deterministic budget");

  assert.equal(
    rustIntegratedRuntimeBulkTimeoutMsV1(
      Object.freeze({ ...routine, requestId: 56, maxBytes: RUST_INTEGRATED_RUNTIME_BULK_MAX_ATTACHMENT_BYTES_V1 }),
      0,
      routineTimeoutMs,
    ),
    RUST_INTEGRATED_RUNTIME_BULK_TIMEOUT_MAX_MS_V1,
    "a proven 128 MiB retry receives the bounded maximum watchdog",
  );

  const hydrateRecovery = Object.freeze({
    type: "runtime-bulk-hydrate-recovery-v1" as const,
    requestId: 53,
    clientEpoch: 7,
    expected: identity(),
    recoveryId: "checkpoint.1",
  });
  assert.equal(
    rustIntegratedRuntimeBulkTimeoutMsV1(hydrateRecovery, 0, routineTimeoutMs),
    recoveryTimeoutMs,
    "a recovery operation receives the same budget without a large input attachment",
  );

  const legacyMigration = Object.freeze({
    type: "runtime-bulk-migrate-legacy-world-v1" as const,
    requestId: 57,
    clientEpoch: 7,
    expected: identity(),
    stageId: "legacy.world-only.1",
    createdAt: 101,
    sourceKey: "blockwild-world-data-v1:fixture",
    sourceFormat: "blockwild-world-save-canonical-v1",
    legacyNonWorldStateFlags: 0,
    typeId: RUST_INTEGRATED_RUNTIME_LEGACY_WORLD_PROJECTION_TYPE_V1,
    worldProjection: Uint8Array.of(0x42, 0x57, 0x41, 0x53),
  });
  assert.equal(
    rustIntegratedRuntimeBulkTimeoutMsV1(legacyMigration, legacyMigration.worldProjection.byteLength, routineTimeoutMs),
    recoveryTimeoutMs,
    "world-only migration receives the recovery-scale bound even for a tiny BWAS fixture",
  );

  const terminalStatus = Object.freeze({
    type: "runtime-bulk-persistence-status-v1" as const,
    requestId: 54,
    clientEpoch: 7,
    expected: identity(),
    typeId: "blockwild.persistence.status.r8.v1" as const,
    payload: new Uint8Array([1]),
  });
  assert.equal(
    rustIntegratedRuntimeBulkTimeoutMsV1(terminalStatus, 0, routineTimeoutMs),
    RUST_INTEGRATED_RUNTIME_BULK_TIMEOUT_MAX_MS_V1,
    "terminal attestation gets the bounded aggregate-save hashing budget despite its tiny request",
  );

  const syntheticAttachmentRequest = Object.freeze({
    type: "runtime-bulk-complete-v1" as const,
    requestId: 55,
    clientEpoch: 7,
    expected: identity(),
    transferToken: 1,
    typeId: "blockwild.persistence.browser-response.r8.v1" as const,
    payload: new Uint8Array(),
  });
  assert.equal(
    rustIntegratedRuntimeBulkTimeoutMsV1(
      syntheticAttachmentRequest,
      RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1,
      routineTimeoutMs,
    ),
    recoveryTimeoutMs,
    "a synthetic attachment length proves the large input policy without allocating it",
  );
});

test("one extended bulk timeout still aborts and rejects the entire worker generation", async () => {
  const link = new LinkedWorker();
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 4);
  const request = (requestId: number): RustIntegratedRuntimeBulkRequestV1 => Object.freeze({
    type: "runtime-bulk-poll-v1",
    requestId,
    clientEpoch: 7,
    expected: identity(),
    maxBytes: RUST_INTEGRATED_RUNTIME_BULK_ROUTINE_BYTES_V1 + 1,
  });
  const first = transport.requestBulk(request(61));
  const second = transport.requestBulk(request(62));
  await Promise.all([
    assert.rejects(first, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError
      && error.code === "timeout"
      && error.message.includes("exceeded 8 ms")),
    assert.rejects(second, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError
      && error.code === "timeout"),
  ]);
  await assert.rejects(
    transport.requestBulk(request(63)),
    (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "disposed",
  );
  assert.equal(link.terminated, true);
});

test("one stale response epoch aborts every outstanding request", async () => {
  const link = new LinkedWorker();
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 2_000);
  const first = transport.request({ type: "runtime-create-v1", requestId: 1, clientEpoch: 7, config: config() });
  const second = transport.request({ type: "runtime-create-v1", requestId: 2, clientEpoch: 7, config: config() });
  link.respond({ ...ready({ type: "runtime-create-v1", requestId: 1, clientEpoch: 6, config: config() }), clientEpoch: 6 });
  await assert.rejects(first, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "protocol");
  await assert.rejects(second, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "protocol");
  assert.equal(link.terminated, true);
});
