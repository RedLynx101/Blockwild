import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MemoryPersistenceAdapterV1 } from "../app/game/indexeddb-persistence-adapter.ts";
import { RustPersistenceBrowserRuntimeV1 } from "../app/game/rust-persistence-runtime-adapter.ts";
import {
  decodeRustPersistenceRequestV1,
  decodeRustPersistenceResponseV1,
  encodeRustPersistenceResponseV1,
  encodeRustPersistenceReadCheckpointRequestV1,
  encodeRustPersistenceRecoverLatestRequestV1,
} from "../app/game/rust-persistence-runtime-contract.ts";

function fixtureBytes() {
  const path = fileURLToPath(new URL("./fixtures/rust-engine/r8-r9/persistence-browser-runtime-v1.hex", import.meta.url));
  const hex = readFileSync(path, "utf8").trim();
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function recoveryFixtureBytes() {
  const path = fileURLToPath(new URL(
    "./fixtures/rust-engine/r8-r9/persistence-browser-recovery-response-v1.hex",
    import.meta.url,
  ));
  const hex = readFileSync(path, "utf8").trim();
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

test("native Rust persistence request decodes byte-exactly in TypeScript including >=0x80 payloads", () => {
  const request = decodeRustPersistenceRequestV1(fixtureBytes());
  assert.equal(request.kind, "commit");
  if (request.kind !== "commit") return;
  assert.equal(request.requestId, 0x0012_0304_0506_0708);
  assert.equal(request.transaction.transactionId, "transaction:browser");
  assert.equal(request.checkpoint.checkpointId, "checkpoint:one");
  const mutation = request.transaction.mutations[0];
  assert.equal(mutation.operation, "put");
  if (mutation.operation === "put") assert.deepEqual([...mutation.payload], [0x00, 0x7f, 0x80, 0xff, 0xc3, 0xb1]);
});

test("native Rust recovery response decodes and re-encodes byte-exactly in TypeScript", () => {
  const bytes = recoveryFixtureBytes();
  const response = decodeRustPersistenceResponseV1(bytes);
  assert.equal(response.kind, "recovery");
  if (response.kind !== "recovery") return;
  assert.equal(response.requestId, 9);
  assert.equal(response.code, "ready");
  assert.equal(response.worldId, "world:browser");
  assert.equal(response.checkpoint?.checkpointId, "checkpoint:one");
  assert.equal(response.checkpoint?.records[0]?.address.recordId, "creature:Ã±");
  assert.deepEqual(response.recordPayloads.map((payload) => payload && [...payload]), [
    [0x00, 0x7f, 0x80, 0xff, 0xc3, 0xb1],
  ]);
  assert.deepEqual(response.missingRecordKeys, []);
  assert.deepEqual(response.corruptRecordKeys, []);
  assert.equal(response.message, "ready");
  assert.deepEqual([...encodeRustPersistenceResponseV1(response)], [...bytes]);

  const corrupted = Uint8Array.from(bytes);
  corrupted[corrupted.length - 1] ^= 0x80;
  assert.throws(() => decodeRustPersistenceResponseV1(corrupted), /checksum/u);
});

test("Rust browser runtime commits, verifies, and hydrates through one async platform adapter", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const runtime = new RustPersistenceBrowserRuntimeV1(adapter);
  const committed = decodeRustPersistenceResponseV1(await runtime.execute(fixtureBytes()));
  assert.equal(committed.kind, "commit");
  if (committed.kind !== "commit") return;
  assert.equal(committed.code, "committed");
  assert.equal(committed.verifiedReadback, true);

  const recovery = decodeRustPersistenceResponseV1(await runtime.execute(encodeRustPersistenceRecoverLatestRequestV1(2, "world:browser")));
  assert.equal(recovery.kind, "recovery");
  if (recovery.kind !== "recovery") return;
  assert.equal(recovery.code, "ready");
  assert.equal(recovery.checkpoint?.checkpointHash, committed.checkpointHash);
  assert.deepEqual(recovery.recordPayloads[0] && [...recovery.recordPayloads[0]], [0x00, 0x7f, 0x80, 0xff, 0xc3, 0xb1]);

  const exact = decodeRustPersistenceResponseV1(await runtime.execute(encodeRustPersistenceReadCheckpointRequestV1(3, "world:browser", "checkpoint:one")));
  assert.equal(exact.kind === "recovery" && exact.code, "ready");
});

test("duplicate stale commit and corrupt recovery fail closed without fabricated readiness", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const runtime = new RustPersistenceBrowserRuntimeV1(adapter);
  await runtime.execute(fixtureBytes());
  const duplicate = decodeRustPersistenceResponseV1(await runtime.execute(fixtureBytes()));
  assert.equal(duplicate.kind === "commit" && duplicate.code, "stale-sequence");

  const corruptingAdapter = {
    commit: adapter.commit.bind(adapter),
    readLatestCheckpoint: adapter.readLatestCheckpoint.bind(adapter),
    readCheckpoint: adapter.readCheckpoint.bind(adapter),
    async readRecord(...args: Parameters<typeof adapter.readRecord>) {
      const value = await adapter.readRecord(...args);
      if (value) value[value.length - 1] ^= 0x80;
      return value;
    },
  };
  const corruptRuntime = new RustPersistenceBrowserRuntimeV1(corruptingAdapter);
  const recovery = decodeRustPersistenceResponseV1(await corruptRuntime.execute(encodeRustPersistenceRecoverLatestRequestV1(4, "world:browser")));
  assert.equal(recovery.kind === "recovery" && recovery.code, "corrupt");
  if (recovery.kind === "recovery") assert.equal(recovery.corruptRecordKeys.length, 1);
});

test("checksum corruption is rejected before any platform transaction runs", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const runtime = new RustPersistenceBrowserRuntimeV1(adapter);
  const corrupted = fixtureBytes(); corrupted[corrupted.length - 1] ^= 0x80;
  const response = decodeRustPersistenceResponseV1(await runtime.execute(corrupted));
  assert.equal(response.kind, "error");
  assert.equal(await adapter.readLatestCheckpoint("world:browser"), null);
});

test("same-world Rust browser operations remain serialized across async platform work", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  let activeCommits = 0;
  let maximumActiveCommits = 0;
  const delayed = {
    readLatestCheckpoint: adapter.readLatestCheckpoint.bind(adapter),
    readCheckpoint: adapter.readCheckpoint.bind(adapter),
    readRecord: adapter.readRecord.bind(adapter),
    async commit(...args: Parameters<typeof adapter.commit>) {
      activeCommits += 1;
      maximumActiveCommits = Math.max(maximumActiveCommits, activeCommits);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try { return await adapter.commit(...args); }
      finally { activeCommits -= 1; }
    },
  };
  const runtime = new RustPersistenceBrowserRuntimeV1(delayed);
  const [first, second] = await Promise.all([runtime.execute(fixtureBytes()), runtime.execute(fixtureBytes())]);
  const codes = [decodeRustPersistenceResponseV1(first), decodeRustPersistenceResponseV1(second)]
    .map((response) => response.kind === "commit" ? response.code : response.kind);
  assert.deepEqual(codes, ["committed", "stale-sequence"]);
  assert.equal(maximumActiveCommits, 1);
});
