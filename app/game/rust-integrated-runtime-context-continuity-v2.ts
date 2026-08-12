import type {
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeCommandReceiptV1,
  RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract";
import { rustIntegratedRuntimeIdentityEqualsV1 } from "./rust-integrated-runtime-contract";
import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec";
import {
  RustIntegratedPlayerInventoryReaderV1,
  RustIntegratedPlayerInventoryWriterV1,
} from "./rust-integrated-runtime-player-inventory";

export const RUST_CONTEXT_COMMAND_CONTINUITY_TYPE_V2 =
  "blockwild.simulation.context-command-continuity.r5.v2";
export const RUST_CONTEXT_COMMAND_CONTINUITY_RECEIPT_TYPE_V2 =
  "blockwild.simulation.context-command-continuity-receipt.r5.v2";

const QUERY_MAGIC = Uint8Array.of(0x42, 0x57, 0x53, 0x36); // BWS6
const RECEIPT_MAGIC = Uint8Array.of(0x42, 0x57, 0x4f, 0x36); // BWO6
const HEADER_BYTES = 28;
const MAX_SAFE_U64 = Number.MAX_SAFE_INTEGER;

export type RustIntegratedRuntimeContextContinuityV2 = Readonly<{
  requestPayloadHash: string;
  identity: RustIntegratedRuntimeIdentityV1;
  lastSequence: number | null;
  nextSequence: number | null;
  queuedCommandsEmpty: boolean;
}>;

export interface RustIntegratedRuntimeContextContinuityServiceV2 {
  identity(): RustIntegratedRuntimeIdentityV1;
  command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1>;
}

export class RustIntegratedRuntimeContextContinuityErrorV2 extends Error {
  readonly name = "RustIntegratedRuntimeContextContinuityErrorV2";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedRuntimeContextContinuityErrorV2(code, message);
}

function hashBytes(value: string) {
  if (!/^[0-9a-f]{32}$/u.test(value)) fail("context-continuity-hash", "context continuity hash is invalid");
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function bytesHash(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function wrap(magic: Uint8Array, body: Uint8Array) {
  const output = new Uint8Array(HEADER_BYTES + body.byteLength);
  const view = new DataView(output.buffer);
  output.set(magic);
  view.setUint16(4, 1, true);
  view.setUint16(6, 2, true);
  view.setUint32(8, body.byteLength, true);
  output.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(body)), 12);
  output.set(body, HEADER_BYTES);
  return output;
}

function unwrap(packet: Uint8Array, magic: Uint8Array) {
  if (!(packet instanceof Uint8Array) || packet.byteLength < HEADER_BYTES
    || !magic.every((byte, index) => packet[index] === byte)) {
    fail("context-continuity-header", "context continuity packet header is malformed");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 2
    || view.getUint32(8, true) !== packet.byteLength - HEADER_BYTES) {
    fail("context-continuity-header", "context continuity packet version or length is invalid");
  }
  const body = packet.subarray(HEADER_BYTES);
  if (bytesHash(packet.subarray(12, 28)) !== rustIntegratedRuntimeWireChecksumV1(body)) {
    fail("context-continuity-checksum", "context continuity packet checksum is invalid");
  }
  return body;
}

function writeIdentity(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedRuntimeIdentityV1) {
  writer.u16(2);
  writer.string(value.universeId, "context universe id");
  writer.string(value.locationId, "context location id");
  for (const revision of [
    value.revision.epoch, value.revision.world, value.revision.entities, value.revision.gameplay,
    value.revision.persistence, value.revision.network, value.revision.simulation,
  ]) writer.u64(BigInt(safeInteger(revision, "identity revision")));
  writer.u64(BigInt(safeInteger(value.tick, "identity tick")));
  writer.raw(hashBytes(value.stateHash));
}

function safeNumber(value: bigint, label: string) {
  if (value > BigInt(MAX_SAFE_U64)) fail("context-continuity-u64", `${label} exceeds JavaScript safe range`);
  return Number(value);
}

function safeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_U64) {
    fail("context-continuity-u64", `${label} exceeds JavaScript safe range`);
  }
  return value;
}

function readIdentity(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedRuntimeIdentityV1 {
  if (reader.u16() !== 2) fail("context-continuity-identity", "context continuity runtime identity schema is invalid");
  return Object.freeze({
    universeId: reader.string("context universe id"),
    locationId: reader.string("context location id"),
    revision: Object.freeze({
      epoch: safeNumber(reader.u64(), "identity epoch"),
      world: safeNumber(reader.u64(), "world revision"),
      entities: safeNumber(reader.u64(), "entity revision"),
      gameplay: safeNumber(reader.u64(), "gameplay revision"),
      persistence: safeNumber(reader.u64(), "persistence revision"),
      network: safeNumber(reader.u64(), "network revision"),
      simulation: safeNumber(reader.u64(), "simulation revision"),
    }),
    tick: safeNumber(reader.u64(), "identity tick"),
    stateHash: bytesHash(reader.take(16)),
  });
}

function validateCursor(lastSequence: number | null, nextSequence: number | null) {
  if (lastSequence !== null) safeInteger(lastSequence, "last context sequence");
  if (nextSequence !== null) safeInteger(nextSequence, "next context sequence");
  const expected = lastSequence === null ? 1 : lastSequence === MAX_SAFE_U64 ? null : lastSequence + 1;
  if (lastSequence === 0 || nextSequence !== expected) {
    fail("context-continuity-cursor", "context command continuity cursor is discontinuous");
  }
}

export function encodeRustIntegratedRuntimeContextContinuityQueryV2(
  expected: RustIntegratedRuntimeIdentityV1,
) {
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeIdentity(writer, expected);
  return wrap(QUERY_MAGIC, writer.finish());
}

export function decodeRustIntegratedRuntimeContextContinuityQueryV2(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, QUERY_MAGIC));
  const expected = readIdentity(reader);
  reader.finish();
  return Object.freeze({ expected });
}

export function encodeRustIntegratedRuntimeContextContinuityReceiptV2(
  value: RustIntegratedRuntimeContextContinuityV2,
) {
  validateCursor(value.lastSequence, value.nextSequence);
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writer.raw(hashBytes(value.requestPayloadHash));
  writeIdentity(writer, value.identity);
  writer.option(value.lastSequence, (sequence) => writer.u64(BigInt(sequence)));
  writer.option(value.nextSequence, (sequence) => writer.u64(BigInt(sequence)));
  writer.u8(value.queuedCommandsEmpty ? 1 : 0);
  return wrap(RECEIPT_MAGIC, writer.finish());
}

export function decodeRustIntegratedRuntimeContextContinuityReceiptV2(
  packet: Uint8Array,
  expectedRequestPayloadHash?: string,
) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, RECEIPT_MAGIC));
  const requestPayloadHash = bytesHash(reader.take(16));
  const identity = readIdentity(reader);
  const lastSequence = reader.option(() => safeNumber(reader.u64(), "last context sequence"));
  const nextSequence = reader.option(() => safeNumber(reader.u64(), "next context sequence"));
  const queued = reader.u8();
  if (queued > 1) fail("context-continuity-flag", "queued context command flag is invalid");
  reader.finish();
  if (expectedRequestPayloadHash !== undefined && requestPayloadHash !== expectedRequestPayloadHash) {
    fail("context-continuity-request", "BWO6 does not attest the exact BWS6 request");
  }
  validateCursor(lastSequence, nextSequence);
  return Object.freeze({
    requestPayloadHash,
    identity,
    lastSequence,
    nextSequence,
    queuedCommandsEmpty: queued === 1,
  });
}

export async function queryRustIntegratedRuntimeContextContinuityV2(
  service: RustIntegratedRuntimeContextContinuityServiceV2,
) {
  const expected = service.identity();
  const payload = encodeRustIntegratedRuntimeContextContinuityQueryV2(expected);
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: RUST_CONTEXT_COMMAND_CONTINUITY_TYPE_V2,
    schema: 2,
    payload,
  });
  const id = `context-continuity:${expected.stateHash}`;
  const batch = createRustIntegratedRuntimeCommandBatchV1({
    commandId: id,
    idempotencyKey: id,
    actorId: "runtime:context-continuity",
    expected,
    operations: Object.freeze([operation]),
  });
  const receipt = await service.command(batch);
  if (receipt.status === "rejected") fail(receipt.code, receipt.message);
  const response = receipt.domainReceipts[0];
  if (receipt.domainReceipts.length !== 1 || !response || response.domain !== "simulation"
    || response.typeId !== RUST_CONTEXT_COMMAND_CONTINUITY_RECEIPT_TYPE_V2 || response.schema !== 2
    || !rustIntegratedRuntimeIdentityEqualsV1(receipt.before, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(receipt.after, expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), expected)) {
    fail("context-continuity-receipt", "BWS6 returned a mutating or incorrectly typed receipt");
  }
  const continuity = decodeRustIntegratedRuntimeContextContinuityReceiptV2(response.payload, operation.payloadHash);
  if (!rustIntegratedRuntimeIdentityEqualsV1(continuity.identity, expected)) {
    fail("context-continuity-identity", "BWO6 identity does not match the exact observed authority");
  }
  return continuity;
}
