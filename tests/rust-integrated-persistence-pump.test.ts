import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryPersistenceAdapterV1 } from "../app/game/indexeddb-persistence-adapter.ts";
import {
  RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1,
  RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1,
  type RustIntegratedRuntimeBulkResponseV1,
} from "../app/game/rust-integrated-runtime-bulk-platform.ts";
import {
  RUST_INTEGRATED_PERSISTENCE_PUMP_DEFAULT_MAX_BYTES_V1,
  RustIntegratedPersistencePumpV1,
  type RustIntegratedPersistenceBulkServiceV1,
} from "../app/game/rust-integrated-persistence-pump.ts";
import { RustPersistenceBrowserRuntimeV1 } from "../app/game/rust-persistence-runtime-adapter.ts";
import { decodeRustPersistenceResponseV1 } from "../app/game/rust-persistence-runtime-contract.ts";

const BWPR = Uint8Array.from(Buffer.from(readFileSync(new URL("./fixtures/rust-engine/r8-r9/persistence-browser-runtime-v1.hex", import.meta.url), "utf8").trim(), "hex"));
const STATE = Object.freeze({ revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation: 1 }), tick: 1, stateHash: "1".repeat(32) });

test("policy-free persistence pump drains opaque BWPR and returns exact BWPA token", async () => {
  const queue = [Uint8Array.from(BWPR)];
  const completions: Array<Readonly<{ token: number; payload: Uint8Array }>> = [];
  const pollByteBounds: number[] = [];
  const empty = (): RustIntegratedRuntimeBulkResponseV1 => ({ type: "runtime-bulk-empty-v1", requestId: 1, clientEpoch: 1, workerEpoch: 1, current: STATE });
  const service: RustIntegratedPersistenceBulkServiceV1 = {
    async pollBulkPlatform(maxBytes) {
      pollByteBounds.push(maxBytes ?? 0);
      const payload = queue.shift();
      return payload ? { type: "runtime-bulk-platform-request-v1", requestId: 1, clientEpoch: 1, workerEpoch: 1, current: STATE, transferToken: 77, typeId: RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1, payload } : empty();
    },
    async completeBulkPlatform(token, payload) {
      completions.push({ token, payload: Uint8Array.from(payload) });
      return { type: "runtime-bulk-completed-v1", requestId: 2, clientEpoch: 1, workerEpoch: 1, current: STATE, transferToken: token, resultHash: "2".repeat(32) };
    },
  };
  const pump = new RustIntegratedPersistencePumpV1(service, new RustPersistenceBrowserRuntimeV1(new MemoryPersistenceAdapterV1()));
  const result = await pump.flush();
  assert.equal(result.operations, 1);
  assert.equal(result.idle, true);
  assert.equal(completions[0].token, 77);
  assert.deepEqual(pollByteBounds, [
    RUST_INTEGRATED_PERSISTENCE_PUMP_DEFAULT_MAX_BYTES_V1,
    RUST_INTEGRATED_PERSISTENCE_PUMP_DEFAULT_MAX_BYTES_V1,
  ]);
  assert.equal(decodeRustPersistenceResponseV1(completions[0].payload).kind, "commit");
  assert.notEqual(RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1, RUST_INTEGRATED_PERSISTENCE_RESPONSE_TYPE_V1);
  await pump.shutdown();
  assert.equal(pump.isClosed(), true);
});

test("shutdown drains more than one bounded batch before closing", async () => {
  const queue = Array.from({ length: 5 }, () => Uint8Array.from(BWPR));
  let completions = 0;
  const service: RustIntegratedPersistenceBulkServiceV1 = {
    async pollBulkPlatform() {
      const payload = queue.shift();
      return payload ? { type: "runtime-bulk-platform-request-v1", requestId: completions + 1, clientEpoch: 1, workerEpoch: 1, current: STATE, transferToken: completions + 1, typeId: RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1, payload } : { type: "runtime-bulk-empty-v1", requestId: completions + 1, clientEpoch: 1, workerEpoch: 1, current: STATE };
    },
    async completeBulkPlatform(token) {
      completions += 1;
      return { type: "runtime-bulk-completed-v1", requestId: completions, clientEpoch: 1, workerEpoch: 1, current: STATE, transferToken: token, resultHash: "2".repeat(32) };
    },
  };
  const pump = new RustIntegratedPersistencePumpV1(service, new RustPersistenceBrowserRuntimeV1(new MemoryPersistenceAdapterV1()), 8 * 1024 * 1024, 2);
  await pump.shutdown();
  assert.equal(completions, 5);
  assert.equal(queue.length, 0);
  assert.equal(pump.isClosed(), true);
});

test("rejected browser receipt is returned to Rust without a pump-side authority advance", async () => {
  const memory = new MemoryPersistenceAdapterV1();
  const quotaAdapter = {
    readLatestCheckpoint: memory.readLatestCheckpoint.bind(memory),
    readCheckpoint: memory.readCheckpoint.bind(memory),
    readRecord: memory.readRecord.bind(memory),
    async commit(transaction: Parameters<typeof memory.commit>[0]) { return Object.freeze({ status: "rejected" as const, transactionId: transaction.transactionId, code: "quota" as const, message: "quota fixture" }); },
  };
  let pending = Uint8Array.from(BWPR);
  let persistenceRevision = 10;
  const service: RustIntegratedPersistenceBulkServiceV1 = {
    async pollBulkPlatform() {
      if (pending.byteLength === 0) return { type: "runtime-bulk-empty-v1", requestId: 2, clientEpoch: 1, workerEpoch: 1, current: STATE };
      const payload = pending; pending = new Uint8Array();
      return { type: "runtime-bulk-platform-request-v1", requestId: 1, clientEpoch: 1, workerEpoch: 1, current: STATE, transferToken: 1, typeId: RUST_INTEGRATED_PERSISTENCE_REQUEST_TYPE_V1, payload };
    },
    async completeBulkPlatform(token, payload) {
      const receipt = decodeRustPersistenceResponseV1(payload);
      if (receipt.kind === "commit" && receipt.code === "committed") persistenceRevision += 1;
      assert.equal(receipt.kind === "commit" && receipt.code, "quota");
      return { type: "runtime-bulk-completed-v1", requestId: 1, clientEpoch: 1, workerEpoch: 1, current: STATE, transferToken: token, resultHash: "2".repeat(32) };
    },
  };
  const pump = new RustIntegratedPersistencePumpV1(service, new RustPersistenceBrowserRuntimeV1(quotaAdapter));
  await pump.drainUntilIdle();
  assert.equal(persistenceRevision, 10);
});
