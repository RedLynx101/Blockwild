import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated";

export type RustIntegratedPlayerFinalBindVersionV1 = 3 | 4;
export type RustIntegratedPlayerFinalBindReceiptV1 = Readonly<{
  requestPayloadHash: string;
  terminalStateHash: string;
}>;

const RECEIPT_BYTES = 38;
const encoder = new TextEncoder();

function descriptor(version: RustIntegratedPlayerFinalBindVersionV1) {
  if (version !== 3 && version !== 4) throw new Error("final bind operation version must be 3 or 4");
  return rustIntegratedRuntimeDomainWireFamilyV1(
    version === 3 ? "simulation-player-bind-final-receipt-v3" : "simulation-player-bind-final-receipt-v4",
  );
}

function hashBytes(value: string) {
  if (!/^[0-9a-f]{32}$/u.test(value)) throw new Error("final bind acknowledgement hash is not canonical");
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

function hex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function encodeRustIntegratedPlayerFinalBindReceiptV1(
  version: RustIntegratedPlayerFinalBindVersionV1,
  value: RustIntegratedPlayerFinalBindReceiptV1,
) {
  const schema = descriptor(version);
  const packet = new Uint8Array(RECEIPT_BYTES);
  packet.set(encoder.encode(schema.magic));
  new DataView(packet.buffer).setUint16(4, schema.innerSchema, true);
  packet.set(hashBytes(value.requestPayloadHash), 6);
  packet.set(hashBytes(value.terminalStateHash), 22);
  return packet;
}

/** These fixed-width acknowledgements have no inner checksum: the enclosing
 * response seals them. Supply both expected hashes at the authority boundary. */
export function decodeRustIntegratedPlayerFinalBindReceiptV1(
  version: RustIntegratedPlayerFinalBindVersionV1,
  packet: Uint8Array,
  expected?: RustIntegratedPlayerFinalBindReceiptV1,
): RustIntegratedPlayerFinalBindReceiptV1 {
  const schema = descriptor(version);
  if (!(packet instanceof Uint8Array) || packet.byteLength !== RECEIPT_BYTES
    || !encoder.encode(schema.magic).every((byte, index) => packet[index] === byte)
    || new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint16(4, true) !== schema.innerSchema) {
    throw new Error("final bind acknowledgement has the wrong size, magic, or inner schema");
  }
  const value = Object.freeze({
    requestPayloadHash: hex(packet.subarray(6, 22)),
    terminalStateHash: hex(packet.subarray(22, 38)),
  });
  if (expected) {
    hashBytes(expected.requestPayloadHash);
    hashBytes(expected.terminalStateHash);
    if (value.requestPayloadHash !== expected.requestPayloadHash
      || value.terminalStateHash !== expected.terminalStateHash) {
      throw new Error("final bind acknowledgement does not attest the request and terminal runtime state");
    }
  }
  return value;
}
