import assert from "node:assert/strict";
import test from "node:test";
import {
  RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1,
  RUST_INTEGRATED_DOMAIN_WIRE_PROTOCOL_V1,
  createRustIntegratedDomainWireDescriptorV1,
  unwrapRustIntegratedDomainPacketV1,
  wrapRustIntegratedDomainPacketV1,
  type RustIntegratedDomainWireFailureV1,
} from "../app/game/rust-integrated-runtime-domain-wire";

class FixtureWireError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const failure: RustIntegratedDomainWireFailureV1 = (code, message) => {
  throw new FixtureWireError(code, message);
};

const descriptor = createRustIntegratedDomainWireDescriptorV1({
  magic: "BWT5",
  schema: 2,
  label: "fixture reconcile",
  maximumPacketBytes: 64,
});

test("shared integrated-domain envelope is exact for nonzero schemas and high bytes", () => {
  const body = Uint8Array.of(0, 0x7f, 0x80, 0xff);
  const packet = wrapRustIntegratedDomainPacketV1(descriptor, body, failure);
  assert.equal(packet.byteLength, RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1 + body.byteLength);
  assert.equal(new TextDecoder().decode(packet.subarray(0, 4)), "BWT5");
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  assert.equal(view.getUint16(4, true), RUST_INTEGRATED_DOMAIN_WIRE_PROTOCOL_V1);
  assert.equal(view.getUint16(6, true), 2);
  assert.equal(view.getUint32(8, true), body.byteLength);
  assert.deepEqual(unwrapRustIntegratedDomainPacketV1(descriptor, packet, failure), body);

  const padded = new Uint8Array(packet.byteLength + 7);
  padded.set(packet, 3);
  assert.deepEqual(
    unwrapRustIntegratedDomainPacketV1(descriptor, padded.subarray(3, 3 + packet.byteLength), failure),
    body,
    "the shared decoder must honor a Uint8Array byte offset",
  );
});

test("shared integrated-domain envelope rejects checksum, header, length, and size drift", () => {
  const packet = wrapRustIntegratedDomainPacketV1(descriptor, Uint8Array.of(1, 2, 3), failure);
  const cases = [
    ["magic", 0, 0x00, "header"],
    ["protocol", 4, 0x02, "header"],
    ["schema", 6, 0x01, "header"],
    ["declared length", 8, 0xff, "header"],
    ["checksum", 12, packet[12]! ^ 0xff, "checksum"],
    ["body", packet.byteLength - 1, packet.at(-1)! ^ 0xff, "checksum"],
  ] as const;
  for (const [label, offset, replacement, code] of cases) {
    const changed = Uint8Array.from(packet);
    changed[offset] = replacement;
    assert.throws(
      () => unwrapRustIntegratedDomainPacketV1(descriptor, changed, failure),
      (error: unknown) => error instanceof FixtureWireError && error.code === code,
      label,
    );
  }
  assert.throws(
    () => unwrapRustIntegratedDomainPacketV1(descriptor, packet.subarray(0, -1), failure),
    (error: unknown) => error instanceof FixtureWireError && error.code === "header",
  );
  assert.throws(
    () => wrapRustIntegratedDomainPacketV1(descriptor, new Uint8Array(37), failure),
    (error: unknown) => error instanceof FixtureWireError && error.code === "size",
  );
});

test("integrated-domain descriptors are closed and bounded", () => {
  assert.throws(() => createRustIntegratedDomainWireDescriptorV1({ magic: "abc5", schema: 1, label: "bad" }), /magic/u);
  assert.throws(() => createRustIntegratedDomainWireDescriptorV1({ magic: "BWC5", schema: 0, label: "bad" }), /schema/u);
  assert.throws(() => createRustIntegratedDomainWireDescriptorV1({ magic: "BWC5", schema: 1, label: "" }), /label/u);
  assert.throws(
    () => createRustIntegratedDomainWireDescriptorV1({ magic: "BWC5", schema: 1, label: "bad", maximumPacketBytes: 27 }),
    /budget/u,
  );
});
