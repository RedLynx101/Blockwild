import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7,
  RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1,
  RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V2,
  RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V3,
  RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V4,
  RustGameplaySnapshotEnvelopeErrorR7,
  cloneValidatedRustGameplaySnapshotR7,
  cloneValidatedRustGameplaySnapshotR7V1,
  inspectRustGameplaySnapshotEnvelopeR7,
  inspectRustGameplaySnapshotEnvelopeR7V1,
  rustGameplaySnapshotFileHashR7,
  rustGameplaySnapshotFileHashR7V1,
} from "../app/game/rust-gameplay-snapshot-r7.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";

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

type FixtureV4Expectation = FixtureExpectation & Readonly<{
  snapshotHex: string;
  combatantId: string;
  entityIdPacked: string;
  vitalUnits: "millihearts-v1";
  health: number;
  maximumHealth: number;
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

async function syntheticFixtureV3() {
  const { bytes: v2 } = await fixtureV2();
  const bytes = v2.slice();
  new DataView(bytes.buffer).setUint16(8, RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V3, true);
  const payload = bytes.subarray(RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7);
  const payloadHash = new TypeScriptCanonicalHasher("blockwild.gameplay.snapshot.payload.v1")
    .writeU16(RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V3)
    .writeBytes(payload)
    .finishHex();
  bytes.set(Uint8Array.from(Buffer.from(payloadHash, "hex")), 52);
  return { bytes };
}

async function fixtureV4() {
  const expected = JSON.parse(
    await readFile(new URL("gameplay-snapshot-v4-combat.json", FIXTURE_ROOT), "utf8"),
  ) as FixtureV4Expectation;
  return {
    bytes: Uint8Array.from(Buffer.from(expected.snapshotHex, "hex")),
    expected,
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

test("legacy V3 gameplay envelope remains schema-bound while its native payload stays opaque", async () => {
  const { bytes } = await syntheticFixtureV3();
  const envelope = inspectRustGameplaySnapshotEnvelopeR7(bytes);
  assert.equal(envelope.schema, RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V3);
  assert.deepEqual(envelope.payload, bytes.subarray(RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7));
  assert.deepEqual(cloneValidatedRustGameplaySnapshotR7(bytes), bytes);
});

test("Rust current V4 combat fixture has exact native browser envelope parity", async () => {
  const { bytes, expected } = await fixtureV4();
  assert.equal(expected.schema, RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V4);
  assert.equal(expected.combatantId, "hero-é");
  assert.equal(expected.entityIdPacked, "18446744073709551608");
  assert.equal(expected.vitalUnits, "millihearts-v1");
  assert.equal(expected.health, 19_500);
  assert.equal(expected.maximumHealth, 20_000);
  assertFixtureParity(bytes, expected);
  const envelope = inspectRustGameplaySnapshotEnvelopeR7(bytes);
  assert.deepEqual(envelope.payload, bytes.subarray(RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7));
  assert.deepEqual(cloneValidatedRustGameplaySnapshotR7(bytes), bytes);
});

test("snapshot preflight rejects every outer-envelope corruption class for V1, V2, V3, and V4", async () => {
  const fixtures = await Promise.all([fixtureV1(), fixtureV2(), syntheticFixtureV3(), fixtureV4()]);
  for (const { bytes } of fixtures) {
    for (const cut of [0, 7, 8, 10, 12, 20, 36, 52, 67, 68, bytes.byteLength - 1]) {
      assert.throws(() => inspectRustGameplaySnapshotEnvelopeR7(bytes.subarray(0, cut)), RustGameplaySnapshotEnvelopeErrorR7);
    }

    const magic = bytes.slice(); magic[0] ^= 0xff;
    assert.throws(() => inspectRustGameplaySnapshotEnvelopeR7(magic), (error: unknown) => error instanceof RustGameplaySnapshotEnvelopeErrorR7 && error.code === "magic");
    for (const unsupported of [0, 5, 0xffff]) {
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
    const schema = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(8, true);
    const crossSchemaValue = schema === RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V4 ? RUST_GAMEPLAY_SNAPSHOT_SCHEMA_R7_V1 : schema + 1;
    new DataView(crossSchema.buffer).setUint16(8, crossSchemaValue, true);
    assert.throws(
      () => inspectRustGameplaySnapshotEnvelopeR7(crossSchema),
      (error: unknown) => error instanceof RustGameplaySnapshotEnvelopeErrorR7 && error.code === "payload-hash",
      "payload hashes are bound to the declared schema",
    );
  }
});

test("snapshot inspection owns buffers and cannot alias later mutation", async () => {
  for (const { bytes } of await Promise.all([fixtureV1(), fixtureV2(), syntheticFixtureV3(), fixtureV4()])) {
    const envelope = inspectRustGameplaySnapshotEnvelopeR7(bytes);
    const original = envelope.bytes[0];
    bytes[0] ^= 0xff;
    assert.equal(envelope.bytes[0], original);
    envelope.payload[0] ^= 0xff;
    assert.notEqual(envelope.payload[0], envelope.bytes[RUST_GAMEPLAY_SNAPSHOT_HEADER_BYTES_R7], "payload and complete file are separately owned immutable-boundary copies");
  }
});
