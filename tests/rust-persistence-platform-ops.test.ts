import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MemoryPersistenceAdapterV1 } from "../app/game/indexeddb-persistence-adapter.ts";
import { PERSISTENCE_MAX_RECORD_BYTES_V1 } from "../app/game/persistence-journal-contract.ts";
import { RUST_INTEGRATED_RUNTIME_BULK_PERSISTENCE_MAX_PACKET_BYTES_V1 } from "../app/game/rust-integrated-runtime-bulk-platform.ts";
import { RustPersistenceBrowserRuntimeV1 } from "../app/game/rust-persistence-runtime-adapter.ts";
import {
  RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1,
  RUST_PERSISTENCE_BROWSER_HEADER_BYTES_V1,
  RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1,
  RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_OVERHEAD_BYTES_V1,
  decodeRustPersistenceResponseV1,
  encodeRustPersistencePlatformRequestV1,
  rustPersistencePlatformPayloadHashV1,
  type RustPersistencePlatformOperationV1,
  type RustPersistencePlatformRequestV1,
} from "../app/game/rust-persistence-runtime-contract.ts";

test("recovery-only page capacity matches one maximum record plus bounded overhead below the bulk packet", () => {
  assert.equal(
    RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1,
    PERSISTENCE_MAX_RECORD_BYTES_V1 + RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_OVERHEAD_BYTES_V1,
  );
  assert.equal(RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_OVERHEAD_BYTES_V1, 64 * 1024);
  assert.equal(RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1, 4 * 1024 * 1024, "ordinary import/export chunks remain unchanged");
  const maximumDecodedBwpaEnvelope = RUST_PERSISTENCE_BROWSER_HEADER_BYTES_V1
    + 2 + 1 + 8 + 16 + 1 + 8 + 4 + 4 + 4_096;
  assert.ok(
    RUST_PERSISTENCE_PLATFORM_RECOVERY_PAGE_BYTES_V1 + maximumDecodedBwpaEnvelope
      < RUST_INTEGRATED_RUNTIME_BULK_PERSISTENCE_MAX_PACKET_BYTES_V1,
  );
});

function commitFixture() {
  const path = fileURLToPath(new URL("./fixtures/rust-engine/r8-r9/persistence-browser-runtime-v1.hex", import.meta.url));
  const hex = readFileSync(path, "utf8").trim();
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function platformRequest(
  operation: RustPersistencePlatformOperationV1,
  input: Partial<Omit<RustPersistencePlatformRequestV1, "kind" | "operation" | "payloadHash">> = {},
) {
  const payload = Uint8Array.from(input.payload ?? []);
  return Object.freeze({
    kind: "platform", operation, requestId: input.requestId ?? 10, worldId: input.worldId ?? "world:browser",
    objectId: input.objectId ?? "", expectedHeadHash: input.expectedHeadHash ?? null, cursor: input.cursor ?? 0,
    limit: input.limit ?? 0, totalBytes: input.totalBytes ?? 0, payloadHash: rustPersistencePlatformPayloadHashV1(payload), payload,
  }) satisfies RustPersistencePlatformRequestV1;
}

async function execute(runtime: RustPersistenceBrowserRuntimeV1, request: RustPersistencePlatformRequestV1) {
  const response = decodeRustPersistenceResponseV1(await runtime.execute(encodeRustPersistencePlatformRequestV1(request)));
  assert.equal(response.kind, "platform");
  if (response.kind !== "platform") throw new Error("platform response expected");
  assert.equal(response.operation, request.operation);
  assert.equal(response.requestId, request.requestId);
  return response;
}

test("additive BWPR operations expose exact paged recovery and bounded estimates", async () => {
  const runtime = new RustPersistenceBrowserRuntimeV1(new MemoryPersistenceAdapterV1());
  const committed = decodeRustPersistenceResponseV1(await runtime.execute(commitFixture()));
  assert.equal(committed.kind === "commit" && committed.code, "committed");

  const head = await execute(runtime, platformRequest("recover-head"));
  assert.equal(head.code, "accepted");
  assert.equal(new TextDecoder().decode(head.payload.subarray(0, 4)), "BWRH");

  const page = await execute(runtime, platformRequest("read-recovery-page", {
    requestId: 11, objectId: "checkpoint:one", limit: 64, totalBytes: RUST_PERSISTENCE_PLATFORM_CHUNK_BYTES_V1,
  }));
  assert.equal(page.code, "accepted");
  assert.equal(new TextDecoder().decode(page.payload.subarray(0, 4)), "BWRP");
  assert.equal(page.nextCursor, null);
  assert.ok(page.payload.includes(0x80));

  const estimate = await execute(runtime, platformRequest("estimate", { requestId: 12 }));
  assert.equal(estimate.code, "accepted");
  assert.equal(new TextDecoder().decode(estimate.payload.subarray(0, 4)), "BWPE");
});

test("chunk receipts are idempotent and delete tombstones prevent stale resurrection", async () => {
  const adapter = new MemoryPersistenceAdapterV1();
  const runtime = new RustPersistenceBrowserRuntimeV1(adapter);
  const committed = decodeRustPersistenceResponseV1(await runtime.execute(commitFixture()));
  assert.equal(committed.kind === "commit" && committed.code, "committed");

  const chunk = platformRequest("import-chunk", { requestId: 20, objectId: "import:one", totalBytes: 4, payload: Uint8Array.of(0, 0x7f, 0x80, 0xff) });
  const first = await execute(runtime, chunk);
  const duplicate = await execute(runtime, Object.freeze({ ...chunk, requestId: 21 }));
  assert.equal(first.code, "accepted");
  assert.equal(duplicate.code, "accepted");

  const finalized = await execute(runtime, platformRequest("finalize-import", {
    requestId: 22, objectId: "import:one", expectedHeadHash: "34".repeat(16), totalBytes: 4,
  }));
  assert.equal(finalized.code, "accepted");
  assert.notEqual(finalized.durableHash, "0".repeat(32));

  const deleted = await execute(runtime, platformRequest("delete-world", {
    requestId: 23, objectId: "56".repeat(16), expectedHeadHash: committed.kind === "commit" ? committed.checkpointHash : null,
  }));
  assert.equal(deleted.code, "accepted");
  assert.equal(deleted.durableHash, "56".repeat(16));

  const stale = decodeRustPersistenceResponseV1(await runtime.execute(commitFixture()));
  assert.equal(stale.kind === "commit" && stale.code, "record-conflict");
});
