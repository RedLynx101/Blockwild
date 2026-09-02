import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUST_INTEGRATED_PERSISTENCE_CONTROL_MAX_BYTES_V1,
  decodeRustIntegratedPersistenceDispatchV1,
  decodeRustIntegratedPersistenceDispatchReceiptV1,
  decodeRustIntegratedPersistenceStatusReceiptV1,
  encodeRustIntegratedPersistenceDispatchV1,
  encodeRustIntegratedPersistenceDispatchReceiptV1,
  encodeRustIntegratedPersistenceStatusQueryV1,
} from "../app/game/rust-integrated-runtime-persistence.ts";
import type { RustIntegratedPersistenceDispatchV1 } from "../app/game/rust-integrated-runtime-persistence.ts";
import { RUST_INTEGRATED_RUNTIME_DOMAIN_SCHEMA_FINGERPRINT_V1 } from "../app/game/rust-integrated-runtime-domain-schema.generated.ts";
import { rustIntegratedRuntimeWireChecksumV1 } from "../app/game/rust-integrated-runtime-codec.ts";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const NATIVE_DISPATCH_FIXTURE = JSON.parse(readFileSync(new URL(
  "./fixtures/rust-engine/integrated-runtime-v1/r8-persistence-dispatch-wire-v1.json",
  import.meta.url,
), "utf8")) as Readonly<{
  schema: number; producer: string; requestHex: string; receiptHex: string;
  schemaFingerprint: string; requests: readonly { name: string; hex: string }[]; noRequestReceiptHex: string;
}>;

const bytes = (value: string) => Uint8Array.from(Buffer.from(value, "hex"));
function checkedBody(packet: Uint8Array, body: Uint8Array) {
  const result = new Uint8Array(28 + body.length);
  result.set(packet.subarray(0, 28));
  new DataView(result.buffer).setUint32(8, body.length, true);
  result.set(bytes(rustIntegratedRuntimeWireChecksumV1(body)), 12);
  result.set(body, 28);
  return result;
}

test("persistence dispatch estimate is byte-identical to the native high-UTF8 fixture", () => {
  assert.equal(
    hex(encodeRustIntegratedPersistenceDispatchV1({ kind: "estimate", worldId: "wørld" })),
    "42574438010001000b0000005df174d7207aef3588f6935cac2b6c8e060600000077c3b8726c64",
  );
});

test("checked Rust BWD8/BWA8 fixture round-trips the complete domain-dispatch family", () => {
  assert.equal(NATIVE_DISPATCH_FIXTURE.schema, 1);
  assert.equal(NATIVE_DISPATCH_FIXTURE.producer, "blockwild-engine/r8_persistence_dispatch_wire_fixture");
  assert.equal(
    hex(encodeRustIntegratedPersistenceDispatchV1({ kind: "estimate", worldId: "wørld:水" })),
    NATIVE_DISPATCH_FIXTURE.requestHex,
  );
  assert.deepEqual(
    decodeRustIntegratedPersistenceDispatchReceiptV1(
      Uint8Array.from(Buffer.from(NATIVE_DISPATCH_FIXTURE.receiptHex, "hex")),
    ),
    {
      requestId: 9_007_199_254_740_987,
      persistenceRevision: 9_007_199_254_740_986,
      pending: 65_535,
      queuedBytes: 9_007_199_254_740_985,
      stateHash: "8091a2b3c4d5e6f708192a3b4c5d6e7f",
      closed: true,
    },
  );

  const corrupted = Uint8Array.from(Buffer.from(NATIVE_DISPATCH_FIXTURE.receiptHex, "hex"));
  corrupted[corrupted.length - 1] ^= 0x80;
  assert.throws(() => decodeRustIntegratedPersistenceDispatchReceiptV1(corrupted), /checksum/u);
});

test("persistence terminal status uses an append-only query and exact native receipt fixture", () => {
  assert.equal(
    hex(encodeRustIntegratedPersistenceStatusQueryV1()),
    "4257533801000100000000006c67ea101eecc9abc83a579ee0deda86",
  );
  const fixture = Uint8Array.from(Buffer.from(
    "425754380100010084000000f3e4b66006cdcf7c18da4b682f8cb46a0900000000000000000000000000000000000000010101010101010101010101010101010202020202020202020202020202020200010e000000636865636b706f696e743ae6b0b4030303030303030303030303030303030700000000000000060000000404040404040404040404040404040405050505050505050505050505050505",
    "hex",
  ));
  assert.deepEqual(decodeRustIntegratedPersistenceStatusReceiptV1(fixture), {
    persistenceRevision: 9,
    pending: 0,
    queuedBytes: 0,
    dispatcherStateHash: "01".repeat(16),
    authorityStateHash: "02".repeat(16),
    closed: false,
    terminal: true,
    terminalCheckpoint: {
      checkpointId: "checkpoint:水",
      checkpointHash: "03".repeat(16),
      journalSequence: 7,
      recordCount: 6,
      saveSetHash: "04".repeat(16),
      manifestHash: "05".repeat(16),
    },
  });
});

test("persistence dispatch rejects lone surrogates and normal-lane overflow before encoding", () => {
  assert.throws(
    () => encodeRustIntegratedPersistenceDispatchV1({ kind: "estimate", worldId: "world\ud800" }),
    /unpaired surrogate/u,
  );
  assert.throws(
    () => encodeRustIntegratedPersistenceDispatchV1({
      kind: "import-chunk",
      worldId: "world",
      importId: "import",
      offset: 0,
      totalBytes: RUST_INTEGRATED_PERSISTENCE_CONTROL_MAX_BYTES_V1 + 1,
      bytes: new Uint8Array(RUST_INTEGRATED_PERSISTENCE_CONTROL_MAX_BYTES_V1 + 1),
    }),
    /normal BWRQ byte ceiling/u,
  );
});

test("all twelve R8 dispatch variants and both optional branches match independent native bytes", () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const worldId = "wørld:水";
  const checkpointId = "checkpoint:水";
  const hash = "81".repeat(16);
  const binary = Uint8Array.of(0, 0x7f, 0x80, 0xff);
  const expected: Record<string, RustIntegratedPersistenceDispatchV1> = {
    commit: { kind: "commit", browserRequest: binary },
    "recover-latest": { kind: "recover", worldId },
    "recover-checkpoint": { kind: "recover", worldId, checkpointId },
    "read-recovery-page": { kind: "read-recovery-page", worldId, checkpointId, startRecord: maximum, maxRecords: 0xffff_ffff, maxBytes: 0xffff_ffff },
    estimate: { kind: "estimate", worldId },
    compact: { kind: "compact", worldId, checkpointId, expectedHeadHash: hash, retainParentCount: 0xffff },
    "delete-unconditional": { kind: "delete", worldId, tombstone: hash },
    "delete-conditional": { kind: "delete", worldId, expectedHeadHash: hash, tombstone: hash },
    "preserve-legacy-backup-chunk": { kind: "preserve-legacy-backup-chunk", worldId, backupId: "backup:水", offset: maximum - 4, totalBytes: maximum, bytes: binary },
    "export-page": { kind: "export-page", worldId, checkpointId, cursor: maximum, maxBytes: 0xffff_ffff },
    "import-chunk": { kind: "import-chunk", worldId, importId: "import:水", offset: maximum - 4, totalBytes: maximum, bytes: binary },
    "finalize-import": { kind: "finalize-import", worldId, importId: "import:水", archiveHash: hash, totalBytes: maximum },
    retry: { kind: "retry", previousRequestId: maximum },
    close: { kind: "close" },
  };
  assert.equal(NATIVE_DISPATCH_FIXTURE.schemaFingerprint, RUST_INTEGRATED_RUNTIME_DOMAIN_SCHEMA_FINGERPRINT_V1);
  assert.deepEqual(NATIVE_DISPATCH_FIXTURE.requests.map(({ name }) => name).sort(), Object.keys(expected).sort());
  for (const vector of NATIVE_DISPATCH_FIXTURE.requests) {
    const packet = bytes(vector.hex);
    assert.deepEqual(decodeRustIntegratedPersistenceDispatchV1(packet), expected[vector.name], vector.name);
    assert.equal(hex(encodeRustIntegratedPersistenceDispatchV1(expected[vector.name])), vector.hex, vector.name);
    assert.equal(hex(encodeRustIntegratedPersistenceDispatchV1(decodeRustIntegratedPersistenceDispatchV1(packet))), vector.hex);
    const corrupt = packet.slice(); corrupt[corrupt.length - 1] ^= 0x80;
    assert.throws(() => decodeRustIntegratedPersistenceDispatchV1(corrupt), /checksum/u);
    for (const offset of [0, 4, 6, 8]) {
      const invalidHeader = packet.slice(); invalidHeader[offset] ^= 0x80;
      assert.throws(() => decodeRustIntegratedPersistenceDispatchV1(invalidHeader), /header|version|length/u);
    }
    assert.throws(() => decodeRustIntegratedPersistenceDispatchV1(packet.subarray(0, packet.length - 1)));
    assert.throws(() => decodeRustIntegratedPersistenceDispatchV1(checkedBody(packet, Uint8Array.from([...packet.subarray(28), 0]))), /trailing/u);
  }
  for (const receiptHex of [NATIVE_DISPATCH_FIXTURE.receiptHex, NATIVE_DISPATCH_FIXTURE.noRequestReceiptHex]) {
    assert.equal(hex(encodeRustIntegratedPersistenceDispatchReceiptV1(decodeRustIntegratedPersistenceDispatchReceiptV1(bytes(receiptHex)))), receiptHex);
  }
});

test("R8 dispatch rejects rechecksummed invalid tags, flags, unsafe integers and Unicode controls", () => {
  const close = encodeRustIntegratedPersistenceDispatchV1({ kind: "close" });
  for (const tag of [0, 2, 3, 15, 255]) {
    assert.throws(() => decodeRustIntegratedPersistenceDispatchV1(checkedBody(close, Uint8Array.of(tag))), /unknown/u);
  }
  assert.throws(() => encodeRustIntegratedPersistenceDispatchV1({ kind: "unknown" } as unknown as RustIntegratedPersistenceDispatchV1), /unknown/u);
  const recover = encodeRustIntegratedPersistenceDispatchV1({ kind: "recover", worldId: "w" });
  const invalidFlag = recover.slice(28); invalidFlag[invalidFlag.length - 1] = 2;
  assert.throws(() => decodeRustIntegratedPersistenceDispatchV1(checkedBody(recover, invalidFlag)), /boolean/u);
  const retry = encodeRustIntegratedPersistenceDispatchV1({ kind: "retry", previousRequestId: 0 });
  const unsafe = retry.slice(28);
  new DataView(unsafe.buffer).setBigUint64(1, BigInt("9007199254740992"), true);
  assert.throws(() => decodeRustIntegratedPersistenceDispatchV1(checkedBody(retry, unsafe)), /exact range/u);
  for (const control of ["\u0000", "\u001f", "\u007f", "\u0085", "\u009f"]) {
    assert.throws(() => encodeRustIntegratedPersistenceDispatchV1({ kind: "estimate", worldId: `w${control}` }), /controls/u);
    const source = encodeRustIntegratedPersistenceDispatchV1({ kind: "estimate", worldId: "w" });
    const stringBytes = new TextEncoder().encode(`w${control}`);
    const body = new Uint8Array(5 + stringBytes.length); body[0] = 6;
    new DataView(body.buffer).setUint32(1, stringBytes.length, true); body.set(stringBytes, 5);
    assert.throws(() => decodeRustIntegratedPersistenceDispatchV1(checkedBody(source, body)), /controls/u);
  }
});

test("R8 enforces aggregate packet bounds and copies decoded binary data", () => {
  const largestCommit = { kind: "commit", browserRequest: new Uint8Array(1024 * 1024 - 28 - 5) } as const;
  const largestPacket = encodeRustIntegratedPersistenceDispatchV1(largestCommit);
  assert.equal(largestPacket.length, 1024 * 1024);
  assert.deepEqual(decodeRustIntegratedPersistenceDispatchV1(largestPacket), largestCommit);
  assert.throws(() => encodeRustIntegratedPersistenceDispatchV1({ kind: "commit", browserRequest: new Uint8Array(largestCommit.browserRequest.length + 1) }), /byte budget/u);
  const request = { kind: "import-chunk", worldId: "w".repeat(16 * 1024), importId: "i".repeat(16 * 1024), offset: 0, totalBytes: 2 ** 20, bytes: new Uint8Array(RUST_INTEGRATED_PERSISTENCE_CONTROL_MAX_BYTES_V1) } as const;
  assert.throws(() => encodeRustIntegratedPersistenceDispatchV1(request), /byte budget/u);
  assert.throws(() => encodeRustIntegratedPersistenceDispatchV1({ kind: "estimate", worldId: "é".repeat(8193) }), /UTF-8 byte budget/u);
  const packet = encodeRustIntegratedPersistenceDispatchV1({ kind: "commit", browserRequest: Uint8Array.of(1, 2, 3) });
  const decoded = decodeRustIntegratedPersistenceDispatchV1(packet);
  assert.equal(decoded.kind, "commit");
  packet.fill(0);
  if (decoded.kind === "commit") assert.deepEqual(decoded.browserRequest, Uint8Array.of(1, 2, 3));
});

test("R8 preserves leading-BOM and BOM-only identifiers exactly like native UTF-8 strings", () => {
  for (const identifier of ["\ufeffworld", "\ufeff"]) {
    const requests: RustIntegratedPersistenceDispatchV1[] = [
      { kind: "estimate", worldId: identifier },
      { kind: "recover", worldId: "world", checkpointId: identifier },
      { kind: "preserve-legacy-backup-chunk", worldId: "world", backupId: identifier, offset: 0, totalBytes: 1, bytes: Uint8Array.of(7) },
      { kind: "import-chunk", worldId: "world", importId: identifier, offset: 0, totalBytes: 1, bytes: Uint8Array.of(7) },
    ];
    for (const request of requests) {
      const packet = encodeRustIntegratedPersistenceDispatchV1(request);
      const decoded = decodeRustIntegratedPersistenceDispatchV1(packet);
      assert.deepEqual(decoded, request);
      assert.deepEqual(encodeRustIntegratedPersistenceDispatchV1(decoded), packet);
    }
    // Build the estimate body independently; this also locks the exact leading
    // EF BB BF bytes rather than accepting a symmetric encoder/decoder rewrite.
    const identifierBytes = new TextEncoder().encode(identifier);
    const body = new Uint8Array(5 + identifierBytes.length); body[0] = 6;
    new DataView(body.buffer).setUint32(1, identifierBytes.length, true);
    body.set(identifierBytes, 5);
    assert.deepEqual(body.subarray(5, 8), Uint8Array.of(0xef, 0xbb, 0xbf));
    const nativeShape = checkedBody(encodeRustIntegratedPersistenceDispatchV1({ kind: "estimate", worldId: "world" }), body);
    assert.deepEqual(decodeRustIntegratedPersistenceDispatchV1(nativeShape), { kind: "estimate", worldId: identifier });
    assert.deepEqual(encodeRustIntegratedPersistenceDispatchV1({ kind: "estimate", worldId: identifier }), nativeShape);
  }
});
