import { RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES } from "./rust-integrated-runtime-contract";
import { rustIntegratedRuntimeWireChecksumV1 } from "./rust-integrated-runtime-codec";
import { RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1 } from "./rust-integrated-runtime-domain-schema.generated";

export const RUST_INTEGRATED_DOMAIN_WIRE_PROTOCOL_V1 = RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1;
export const RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1 = 28 as const;

const MAGIC_PATTERN = /^[A-Z0-9]{4}$/u;
const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const encoder = new TextEncoder();

export type RustIntegratedDomainWireDescriptorV1 = Readonly<{
  magic: string;
  schema: number;
  label: string;
  maximumPacketBytes: number;
}>;

export type RustIntegratedDomainWireFailureV1 = (
  code: "checksum" | "header" | "size",
  message: string,
) => never;

export function createRustIntegratedDomainWireDescriptorV1(
  value: Readonly<{
    magic: string;
    schema: number;
    label: string;
    maximumPacketBytes?: number;
  }>,
): RustIntegratedDomainWireDescriptorV1 {
  if (!MAGIC_PATTERN.test(value.magic)) {
    throw new TypeError("integrated domain wire magic must be exactly four uppercase ASCII bytes");
  }
  if (!Number.isSafeInteger(value.schema) || value.schema < 1 || value.schema > 0xffff) {
    throw new RangeError("integrated domain wire schema is outside the u16 range");
  }
  if (!value.label || [...value.label].some((character) => character < " ")) {
    throw new TypeError("integrated domain wire label is empty or contains controls");
  }
  const maximumPacketBytes = value.maximumPacketBytes ?? RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES;
  if (!Number.isSafeInteger(maximumPacketBytes)
    || maximumPacketBytes < RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1
    || maximumPacketBytes > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES) {
    throw new RangeError("integrated domain wire packet budget is outside the runtime domain ceiling");
  }
  return Object.freeze({ ...value, maximumPacketBytes });
}

function checksumBytes(value: string) {
  if (!HASH_PATTERN.test(value)) throw new Error("integrated domain wire checksum is not canonical hexadecimal");
  return Uint8Array.from(
    { length: 16 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function checksumHex(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function wrapRustIntegratedDomainPacketV1(
  descriptor: RustIntegratedDomainWireDescriptorV1,
  body: Uint8Array,
  failure: RustIntegratedDomainWireFailureV1,
) {
  if (!(body instanceof Uint8Array)
    || body.byteLength > descriptor.maximumPacketBytes - RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1) {
    return failure("size", `${descriptor.label} packet exceeds its byte budget`);
  }
  const packet = new Uint8Array(RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1 + body.byteLength);
  const view = new DataView(packet.buffer);
  packet.set(encoder.encode(descriptor.magic), 0);
  view.setUint16(4, RUST_INTEGRATED_DOMAIN_WIRE_PROTOCOL_V1, true);
  view.setUint16(6, descriptor.schema, true);
  view.setUint32(8, body.byteLength, true);
  packet.set(checksumBytes(rustIntegratedRuntimeWireChecksumV1(body)), 12);
  packet.set(body, RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1);
  return packet;
}

export function unwrapRustIntegratedDomainPacketV1(
  descriptor: RustIntegratedDomainWireDescriptorV1,
  packet: Uint8Array,
  failure: RustIntegratedDomainWireFailureV1,
) {
  const magic = encoder.encode(descriptor.magic);
  if (!(packet instanceof Uint8Array)
    || packet.byteLength < RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1
    || packet.byteLength > descriptor.maximumPacketBytes
    || !magic.every((byte, index) => packet[index] === byte)) {
    return failure("header", `${descriptor.label} packet header is malformed`);
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint16(4, true) !== RUST_INTEGRATED_DOMAIN_WIRE_PROTOCOL_V1
    || view.getUint16(6, true) !== descriptor.schema
    || view.getUint32(8, true) !== packet.byteLength - RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1) {
    return failure("header", `${descriptor.label} packet version or length is invalid`);
  }
  const body = packet.subarray(RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1);
  if (checksumHex(packet.subarray(12, RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1))
    !== rustIntegratedRuntimeWireChecksumV1(body)) {
    return failure("checksum", `${descriptor.label} packet checksum is invalid`);
  }
  return body;
}
