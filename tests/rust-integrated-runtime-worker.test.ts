import assert from "node:assert/strict";
import test from "node:test";
import type {
  RustIntegratedRuntimeConfigV1,
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeRequestV1,
  RustIntegratedRuntimeResponseV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  encodeRustIntegratedRuntimeResponseV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import {
  installRustIntegratedRuntimeWorkerHandlerV1,
  RustIntegratedRuntimeWorkerError,
  RustIntegratedRuntimeWorkerTransportV1,
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

test("one authoritative timeout aborts the entire worker generation", async () => {
  const link = new LinkedWorker();
  installRustIntegratedRuntimeWorkerHandlerV1(link.scope, { handle: () => new Promise<RustIntegratedRuntimeResponseV1>(() => undefined) });
  const transport = new RustIntegratedRuntimeWorkerTransportV1(link.port, 5);
  const first = transport.request({ type: "runtime-create-v1", requestId: 1, clientEpoch: 1, config: config() });
  const second = transport.request({ type: "runtime-create-v1", requestId: 2, clientEpoch: 1, config: config() });
  await assert.rejects(first, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "timeout");
  await assert.rejects(second, (error: unknown) => error instanceof RustIntegratedRuntimeWorkerError && error.code === "timeout");
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
