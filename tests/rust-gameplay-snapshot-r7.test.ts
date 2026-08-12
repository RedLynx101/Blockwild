import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7,
  RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1,
  RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V2,
  RustGameplaySnapshotEnvelopeErrorR7,
  cloneValidatedRustGameplaySnapshotR7,
  cloneValidatedRustGameplaySnapshotR7V1,
  inspectRustGameplaySnapshotEnvelopeR7,
  inspectRustGameplaySnapshotEnvelopeR7V1,
  rustGameplaySnapshotFileHashR7,
  rustGameplaySnapshotFileHashR7V1,
} from "../app/game/rust-gameplay-snapshot-r7.ts";

const FIXTURE_ROOT = new URL("./fixtures/rust-engine/r7/gameplay/", import.meta.url);

type FixtureExpectation = Readonly<{
  schema: number;
  bytes: number;
  opaqueExtensionHex: string;
  stateHash: string;
  replayHash: string;
  payloadHash: string;
  snapshotHash: string;
}>;

async function fixtureV1() {
  const [encoded, expectedText] = await Promise.all([
    readFile(new URL("gameplay-snapshot-v1-unicode.b64", FIXTURE_ROOT), "utf8"),
    readFile(new URL("gameplay-snapshot-v1-unicode.json", FIXTURE_ROOT), "utf8"),
  ]);
  return {
    bytes: Uint8Array.from(Buffer.from(encoded.trim(), "base64")),
    expected: JSON.parse(expectedText) as FixtureExpectation,
  };
}

async function fixtureV2() {
  const [encoded, expectedText] = await Promise.all([
    readFile(new URL("gameplay-snapshot-v2-unicode.b64", FIXTURE_ROOT), "utf8"),
    readFile(new URL("gameplay-snapshot-v2-unicode.json", FIXTURE_ROOT), "utf8"),
  ]);
  return {
    bytes: Uint8Array.from(Buffer.from(encoded.trim(), "base64")),
    expected: JSON.parse(expectedText) as FixtureExpectation,
  };
}

function assertFixtureParity(bytes: Uint8Array, expected: FixtureExpectation) {
  const envelope = inspectRustGameplaySnapshotEnvelopeR7(bytes);
  assert.equal(envelope.schema, expected.schema);
  assert.equal(envelope.flags, 0);
  assert.equal(envelope.bytes.byteLength, expected.bytes);
  assert.equal(envelope.payloadLength, bytes.byteLength - RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7);
  assert.equal(envelope.stateHash, expected.stateHash);
  assert.equal(envelope.replayHash, expected.replayHash);
  assert.equal(envelope.payloadHash, expected.payloadHash);
  assert.equal(envelope.snapshotHash, expected.snapshotHash);
  assert.equal(rustGameplaySnapshotFileHashR7(bytes), expected.snapshotHash);

  const extension = Uint8Array.from(Buffer.from(expected.opaqueExtensionHex, "hex"));
  assert.deepEqual(envelope.payload.subarray(-extension.byteLength), extension, "unknown high-byte extensions remain byte-identical");
  const declaredExtensionLength = new DataView(
    envelope.payload.buffer,
    envelope.payload.byteOffset + envelope.payload.byteLength - extension.byteLength - 4,
    4,
  ).getUint32(0, true);
  assert.equal(declaredExtensionLength, extension.byteLength);
  assert.deepEqual(cloneValidatedRustGameplaySnapshotR7(bytes), bytes);
}

test("Rust legacy V1 gameplay fixture retains exact browser envelope parity", async () => {
  const { bytes, expected } = await fixtureV1();
  assert.equal(expected.schema, RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1);
  assertFixtureParity(bytes, expected);

  // Compatibility exports remain byte-identical while accepting the supported
  // R7 schema range rather than freezing browser persistence at schema 1.
  assert.equal(inspectRustGameplaySnapshotEnvelopeR7V1(bytes).schema, RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1);
  assert.equal(rustGameplaySnapshotFileHashR7V1(bytes), expected.snapshotHash);
  assert.deepEqual(cloneValidatedRustGameplaySnapshotR7V1(bytes), bytes);
});

test("Rust current V2 gameplay fixture has exact native browser envelope parity", async () => {
  const { bytes, expected } = await fixtureV2();
  assert.equal(expected.schema, RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V2);
  assertFixtureParity(bytes, expected);
  assert.equal(inspectRustGameplaySnapshotEnvelopeR7V1(bytes).schema, RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V2);
});

test("snapshot preflight rejects every outer-envelope corruption class for V1 and V2", async () => {
  const fixtures = await Promise.all([fixtureV1(), fixtureV2()]);
  for (const { bytes } of fixtures) {
    for (const cut of [0, 7, 8, 10, 12, 20, 36, 52, 67, 68, bytes.byteLength - 1]) {
      assert.throws(() => inspectRustGameplaySnapshotEnvelopeR7(bytes.subarray(0, cut)), RustGameplaySnapshotEnvelopeErrorR7);
    }

    const magic = bytes.slice(); magic[0] ^= 0xff;
    assert.throws(() => inspectRustGameplaySnapshotEnvelopeR7(magic), (error: unknown) => error instanceof RustGameplaySnapshotEnvelopeErrorR7 && error.code === "magic");
    for (const unsupported of [0, 3, 0xffff]) {
      const schema = bytes.slice(); new DataView(schema.buffer).setUint16(8, unsupported, true);
      assert.throws(() => inspectRustGameplaySnapshotEnvelopeR7(schema), (error: unknown) => error instanceof RustGameplaySnapshotEnvelopeErrorR7 && error.code === "schema");
    }
    const flags = bytes.slice(); new DataView(flags.buffer).setUint16(10, 1, true);
    assert.throws(() => inspectRustGameplaySnapshotEnvelopeR7(flags), (error: unknown) => error instanceof RustGameplaySnapshotEnvelopeErrorR7 && error.code === "flags");
    const length = bytes.slice(); new DataView(length.buffer).setBigUint64(12, BigInt(bytes.byteLength), true);
    assert.throws(() => inspectRustGameplaySnapshotEnvelopeR7(length), (error: unknown) => error instanceof RustGameplaySnapshotEnvelopeErrorR7 && error.code === "length");
    const highLength = bytes.slice(); new DataView(highLength.buffer).setBigUint64(12, BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), true);
    assert.throws(() => inspectRustGameplaySnapshotEnvelopeR7(highLength), (error: unknown) => error instanceof RustGameplaySnapshotEnvelopeErrorR7 && error.code === "capacity");
    const payload = bytes.slice(); payload[payload.byteLength - 1] ^= 0xff;
    assert.throws(() => inspectRustGameplaySnapshotEnvelopeR7(payload), (error: unknown) => error instanceof RustGameplaySnapshotEnvelopeErrorR7 && error.code === "payload-hash");

    const crossSchema = bytes.slice();
    new DataView(crossSchema.buffer).setUint16(
      8,
      bytes[8] === RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1
        ? RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V2
        : RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1,
      true,
    );
    assert.throws(
      () => inspectRustGameplaySnapshotEnvelopeR7(crossSchema),
      (error: unknown) => error instanceof RustGameplaySnapshotEnvelopeErrorR7 && error.code === "payload-hash",
      "payload hashes are bound to the declared schema",
    );
  }
});

test("snapshot inspection owns buffers and cannot alias later mutation", async () => {
  for (const { bytes } of await Promise.all([fixtureV1(), fixtureV2()])) {
    const envelope = inspectRustGameplaySnapshotEnvelopeR7(bytes);
    const original = envelope.bytes[0];
    bytes[0] ^= 0xff;
    assert.equal(envelope.bytes[0], original);
    envelope.payload[0] ^= 0xff;
    assert.notEqual(envelope.payload[0], envelope.bytes[RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7], "payload and complete file are separately owned immutable-boundary copies");
  }
});
