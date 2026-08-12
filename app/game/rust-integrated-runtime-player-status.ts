import {
  RUST_RUNTIME_INPUT_FLAG_MASK_V1,
  RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES,
} from "./rust-integrated-runtime-contract";
import { rustIntegratedRuntimeWireChecksumV1 } from "./rust-integrated-runtime-codec";
import {
  decodeRustEntityCompatibilityRecordR6V1,
  encodeRustEntityCompatibilityRecordR6V1,
} from "./rust-entity-authority-codec-r6";
import type {
  RustEntityCompatibilityRecordR6,
  RustEntityResidencyR6,
} from "./rust-entity-authority-contract-r6";
import {
  RUST_INTEGRATED_PLAYER_EQUIPMENT_SLOT_COUNT_V1,
  RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1,
  RustIntegratedPlayerInventoryReaderV1,
  RustIntegratedPlayerInventoryWriterV1,
  readRustIntegratedContainerKeyV1,
  readRustIntegratedPlayerInventoryMetadataV1,
  readRustIntegratedPlayerInventoryStackV1,
  validateRustIntegratedPlayerInventoryContentsV1,
  writeRustIntegratedContainerKeyV1,
  writeRustIntegratedPlayerInventoryMetadataV1,
  writeRustIntegratedPlayerInventoryStackV1,
  type RustIntegratedContainerKeyV1,
  type RustIntegratedPlayerInventoryMetadataV1,
  type RustIntegratedPlayerInventoryStackV1,
} from "./rust-integrated-runtime-player-inventory";
import {
  decodeRustIntegratedPlayerBindingV1,
  encodeRustIntegratedPlayerBindingV1,
  type RustIntegratedPlayerBindingV1,
} from "./rust-integrated-runtime-player";

export const RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1 = "blockwild.simulation.player-bootstrap-status.r5.v1";
export const RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1 = "blockwild.simulation.player-bootstrap-status-receipt.r5.v1";

const BWS5_MAGIC = Uint8Array.of(0x42, 0x57, 0x53, 0x35);
const BWO5_MAGIC = Uint8Array.of(0x42, 0x57, 0x4f, 0x35);
const HEADER_BYTES = 28;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

export type RustIntegratedPlayerBootstrapStatusQueryV1 = Readonly<{
  externalEntityId: string;
  actorId: string;
  playerId: bigint;
}>;

export type RustIntegratedPlayerStatusInputFrameV1 = Readonly<{
  sequence: bigint;
  targetTick: bigint;
  moveX: number;
  moveZ: number;
  lookYaw: number;
  lookPitch: number;
  buttons: number;
  selectedSlot: number;
  flags: number;
}>;

export type RustIntegratedPlayerRuntimeContinuityV1 = Readonly<{
  lastMonotonicTimeUs: bigint;
  lastInputSequence: bigint | null;
  nextInputSequence: bigint | null;
  lastActionSequence: bigint | null;
  nextActionSequence: bigint | null;
  authoritativeFlags: number;
  lastAppliedInput: RustIntegratedPlayerStatusInputFrameV1 | null;
  queuedInputsEmpty: boolean;
}>;

export type RustIntegratedPlayerInventoryBindingAttestationV1 = Readonly<{
  playerId: bigint;
  revision: bigint;
  actorId: string;
  entityId: bigint;
  inventoryContainer: RustIntegratedContainerKeyV1;
  equipmentContainer: RustIntegratedContainerKeyV1;
  selectedSlot: number;
  backSlot: number | null;
}>;

export type RustIntegratedPlayerCustodyAttestationV1 =
  | Readonly<{ status: "absent" }>
  | Readonly<{
    status: "present";
    inventoryContainer: RustIntegratedContainerKeyV1;
    inventoryRevision: bigint;
    inventorySlots: readonly (RustIntegratedPlayerInventoryStackV1 | null)[];
    equipmentContainer: RustIntegratedContainerKeyV1;
    equipmentRevision: bigint;
    equipmentSlots: readonly (RustIntegratedPlayerInventoryStackV1 | null)[];
    metadata: readonly RustIntegratedPlayerInventoryMetadataV1[];
  }>;

export type RustIntegratedPlayerBootstrapStatusReceiptV1 = Readonly<{
  requestPayloadHash: string;
  worldAuthorityRevision: Readonly<{
    epoch: bigint;
    mutation: bigint;
    residency: bigint;
  }>;
  entityAuthority: Readonly<{
    revision: bigint;
    nextSequence: bigint | null;
    tick: bigint;
  }>;
  continuity: RustIntegratedPlayerRuntimeContinuityV1;
  entity: Readonly<{
    entityId: bigint;
    entityRevision: bigint;
    residency: RustEntityResidencyR6;
    record: RustEntityCompatibilityRecordR6;
  }> | null;
  runtimePlayer: Readonly<{
    entityId: bigint;
    binding: RustIntegratedPlayerBindingV1;
  }> | null;
  worldViewBinding: RustIntegratedPlayerInventoryBindingAttestationV1 | null;
  custody: RustIntegratedPlayerCustodyAttestationV1;
}>;

export class RustIntegratedPlayerStatusWireErrorV1 extends Error {
  readonly name = "RustIntegratedPlayerStatusWireErrorV1";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never { throw new RustIntegratedPlayerStatusWireErrorV1(code, message); }

function checkedHash(value: string, label: string) {
  if (!/^[0-9a-f]{32}$/u.test(value)) fail("player-status-hash", `${label} is not a canonical 128-bit hash`);
  return value;
}

function hashBytes(value: string, label: string) {
  checkedHash(value, label); return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function bytesHash(value: Uint8Array) { return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

function wrap(magic: Uint8Array, body: Uint8Array) {
  if (body.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES - HEADER_BYTES) fail("player-status-size", "player status packet exceeds its byte budget");
  const packet = new Uint8Array(HEADER_BYTES + body.byteLength); const view = new DataView(packet.buffer);
  packet.set(magic); view.setUint16(4, 1, true); view.setUint16(6, 1, true); view.setUint32(8, body.byteLength, true); packet.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(body), "status checksum"), 12); packet.set(body, HEADER_BYTES); return packet;
}

function unwrap(packet: Uint8Array, magic: Uint8Array) {
  if (!(packet instanceof Uint8Array) || packet.byteLength < HEADER_BYTES || packet.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES || !magic.every((byte, index) => packet[index] === byte)) fail("player-status-header", "player status packet header is malformed");
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength); if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 1 || view.getUint32(8, true) !== packet.byteLength - HEADER_BYTES) fail("player-status-header", "player status packet version or length is invalid");
  const body = packet.subarray(HEADER_BYTES); if (bytesHash(packet.subarray(12, 28)) !== rustIntegratedRuntimeWireChecksumV1(body)) fail("player-status-checksum", "player status packet checksum is invalid"); return body;
}

function bool(reader: RustIntegratedPlayerInventoryReaderV1) { const value = reader.u8(); if (value > 1) fail("player-status-flag", "player status flag is not boolean"); return value === 1; }

function writeFrame(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedPlayerStatusInputFrameV1) {
  writer.u64(value.sequence); writer.u64(value.targetTick); writer.i16(value.moveX); writer.i16(value.moveZ); writer.i16(value.lookYaw); writer.i16(value.lookPitch);
  if (!Number.isInteger(value.buttons) || value.buttons < 0 || value.buttons > 0xffff_ffff) fail("player-status-input", "input buttons are outside u32");
  if (!Number.isInteger(value.selectedSlot) || value.selectedSlot < 0 || value.selectedSlot >= RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1) fail("player-status-input", "input selected slot is outside its range");
  if (!Number.isInteger(value.flags) || value.flags < 0 || value.flags > 0xff) fail("player-status-input", "input flags are outside u8");
  writer.u32(value.buttons); writer.u8(value.selectedSlot); writer.u8(value.flags); writer.u16(0);
}

function readFrame(reader: RustIntegratedPlayerInventoryReaderV1) {
  const value = Object.freeze({ sequence: reader.u64(), targetTick: reader.u64(), moveX: reader.i16(), moveZ: reader.i16(), lookYaw: reader.i16(), lookPitch: reader.i16(), buttons: reader.u32(), selectedSlot: reader.u8(), flags: reader.u8() });
  if (reader.u16() !== 0) fail("player-status-input", "input frame reserved bits are nonzero"); const check = new RustIntegratedPlayerInventoryWriterV1(); writeFrame(check, value); return value;
}

function checkedSuccessor(previous: bigint | null, next: bigint | null, label: string) {
  const expected = previous === null ? BigInt(1) : previous === U64_MAX ? null : previous + BigInt(1);
  if (next !== expected) fail("player-status-cursor", `${label} continuation is discontinuous`);
}

function validateContinuity(value: RustIntegratedPlayerRuntimeContinuityV1) {
  checkedSuccessor(value.lastInputSequence, value.nextInputSequence, "input sequence"); checkedSuccessor(value.lastActionSequence, value.nextActionSequence, "action sequence");
  if (value.lastActionSequence !== null && value.lastActionSequence === BigInt(0)) fail("player-status-cursor", "last action sequence uses reserved zero");
  if (!Number.isInteger(value.authoritativeFlags) || value.authoritativeFlags < 0 || value.authoritativeFlags > RUST_RUNTIME_INPUT_FLAG_MASK_V1) fail("player-status-input", "authoritative flags contain unsupported bits");
  const appliedSequence = value.lastAppliedInput?.sequence ?? null;
  if (value.queuedInputsEmpty && appliedSequence !== value.lastInputSequence) fail("player-status-cursor", "last applied input does not attest the empty-queue input cursor");
  if (!value.queuedInputsEmpty && appliedSequence !== null
    && (value.lastInputSequence === null || appliedSequence > value.lastInputSequence)) {
    fail("player-status-cursor", "last applied input is ahead of the accepted input cursor");
  }
}

function writeContinuity(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedPlayerRuntimeContinuityV1) {
  validateContinuity(value); writer.u64(value.lastMonotonicTimeUs); writer.option(value.lastInputSequence, (entry) => writer.u64(entry)); writer.option(value.nextInputSequence, (entry) => writer.u64(entry)); writer.option(value.lastActionSequence, (entry) => writer.u64(entry)); writer.option(value.nextActionSequence, (entry) => writer.u64(entry)); writer.u8(value.authoritativeFlags); writer.option(value.lastAppliedInput, (entry) => writeFrame(writer, entry)); writer.u8(value.queuedInputsEmpty ? 1 : 0);
}

function readContinuity(reader: RustIntegratedPlayerInventoryReaderV1) {
  const value = Object.freeze({ lastMonotonicTimeUs: reader.u64(), lastInputSequence: reader.option(() => reader.u64()), nextInputSequence: reader.option(() => reader.u64()), lastActionSequence: reader.option(() => reader.u64()), nextActionSequence: reader.option(() => reader.u64()), authoritativeFlags: reader.u8(), lastAppliedInput: reader.option(() => readFrame(reader)), queuedInputsEmpty: bool(reader) }); validateContinuity(value); return value;
}

function writeEntity(writer: RustIntegratedPlayerInventoryWriterV1, value: NonNullable<RustIntegratedPlayerBootstrapStatusReceiptV1["entity"]>) {
  if (value.entityId === BigInt(0)) fail("player-status-entity", "entity id uses reserved zero"); writer.u64(value.entityId); writer.u64(value.entityRevision); writer.u8(value.residency === "hot" ? 0 : value.residency === "cold" ? 1 : fail("player-status-entity", "entity residency is unknown")); writer.bytes(encodeRustEntityCompatibilityRecordR6V1(value.record));
}

function readEntity(reader: RustIntegratedPlayerInventoryReaderV1) {
  const entityId = reader.u64(); if (entityId === BigInt(0)) fail("player-status-entity", "entity id uses reserved zero"); const entityRevision = reader.u64(); const tag = reader.u8(); const residency = tag === 0 ? "hot" : tag === 1 ? "cold" : fail("player-status-entity", "entity residency is unknown"); const record = decodeRustEntityCompatibilityRecordR6V1(reader.bytes()); return Object.freeze({ entityId, entityRevision, residency, record });
}

function writeRuntimePlayer(writer: RustIntegratedPlayerInventoryWriterV1, value: NonNullable<RustIntegratedPlayerBootstrapStatusReceiptV1["runtimePlayer"]>) { if (value.entityId === BigInt(0)) fail("player-status-player", "runtime player entity id uses reserved zero"); writer.u64(value.entityId); writer.bytes(encodeRustIntegratedPlayerBindingV1(value.binding)); }
function readRuntimePlayer(reader: RustIntegratedPlayerInventoryReaderV1) { const entityId = reader.u64(); if (entityId === BigInt(0)) fail("player-status-player", "runtime player entity id uses reserved zero"); return Object.freeze({ entityId, binding: decodeRustIntegratedPlayerBindingV1(reader.bytes()) }); }

function writeWorldViewBinding(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedPlayerInventoryBindingAttestationV1) {
  if (value.playerId === BigInt(0) || value.entityId === BigInt(0) || !Number.isInteger(value.selectedSlot) || value.selectedSlot < 0 || value.selectedSlot > 8 || (value.backSlot !== null && (!Number.isInteger(value.backSlot) || value.backSlot < 0 || value.backSlot >= RUST_INTEGRATED_PLAYER_EQUIPMENT_SLOT_COUNT_V1))) fail("player-status-binding", "world-view binding is outside its native bounds");
  writer.u64(value.playerId); writer.u64(value.revision); writer.string(value.actorId, "binding actor"); writer.u64(value.entityId); writeRustIntegratedContainerKeyV1(writer, value.inventoryContainer); writeRustIntegratedContainerKeyV1(writer, value.equipmentContainer); writer.u16(value.selectedSlot); writer.option(value.backSlot, (entry) => writer.u16(entry));
}

function readWorldViewBinding(reader: RustIntegratedPlayerInventoryReaderV1) {
  const value = Object.freeze({ playerId: reader.u64(), revision: reader.u64(), actorId: reader.string("binding actor"), entityId: reader.u64(), inventoryContainer: readRustIntegratedContainerKeyV1(reader), equipmentContainer: readRustIntegratedContainerKeyV1(reader), selectedSlot: reader.u16(), backSlot: reader.option(() => reader.u16()) }); const check = new RustIntegratedPlayerInventoryWriterV1(); writeWorldViewBinding(check, value); return value;
}

function writeCustody(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedPlayerCustodyAttestationV1) {
  writer.u8(value.status === "absent" ? 0 : 1); if (value.status === "absent") return;
  writeRustIntegratedContainerKeyV1(writer, value.inventoryContainer); writer.u64(value.inventoryRevision); writer.u32(RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1);
  validateRustIntegratedPlayerInventoryContentsV1(value.inventorySlots, value.metadata);
  for (const stack of value.inventorySlots) writer.option(stack, (entry) => writeRustIntegratedPlayerInventoryStackV1(writer, entry));
  if (value.equipmentSlots.length !== RUST_INTEGRATED_PLAYER_EQUIPMENT_SLOT_COUNT_V1) fail("player-status-custody", "custody equipment does not have eight slots");
  writeRustIntegratedContainerKeyV1(writer, value.equipmentContainer); writer.u64(value.equipmentRevision); writer.u32(value.equipmentSlots.length);
  for (const stack of value.equipmentSlots) writer.option(stack, (entry) => writeRustIntegratedPlayerInventoryStackV1(writer, entry));
  writer.u32(value.metadata.length);
  for (const record of value.metadata) writeRustIntegratedPlayerInventoryMetadataV1(writer, record);
}

function readCustody(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedPlayerCustodyAttestationV1 {
  const tag = reader.u8(); if (tag === 0) return Object.freeze({ status: "absent" as const }); if (tag !== 1) fail("player-status-custody", "custody tag is unknown");
  const inventoryContainer = readRustIntegratedContainerKeyV1(reader); const inventoryRevision = reader.u64(); const slotCount = reader.u32(); if (slotCount !== RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1) fail("player-status-custody", "custody inventory does not have nine slots");
  const inventorySlots = Object.freeze(Array.from({ length: slotCount }, () => reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader))));
  const equipmentContainer = readRustIntegratedContainerKeyV1(reader); const equipmentRevision = reader.u64(); const equipmentSlotCount = reader.u32(); if (equipmentSlotCount !== RUST_INTEGRATED_PLAYER_EQUIPMENT_SLOT_COUNT_V1) fail("player-status-custody", "custody equipment does not have eight slots");
  const equipmentSlots = Object.freeze(Array.from({ length: equipmentSlotCount }, () => reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader))));
  const metadataCount = reader.u32(); if (metadataCount > 9) fail("player-status-custody", "custody metadata exceeds nine records");
  const metadata = Object.freeze(Array.from({ length: metadataCount }, () => readRustIntegratedPlayerInventoryMetadataV1(reader)));
  validateRustIntegratedPlayerInventoryContentsV1(inventorySlots, metadata);
  return Object.freeze({ status: "present" as const, inventoryContainer, inventoryRevision, inventorySlots, equipmentContainer, equipmentRevision, equipmentSlots, metadata });
}

export function encodeRustIntegratedPlayerBootstrapStatusQueryV1(value: RustIntegratedPlayerBootstrapStatusQueryV1) {
  if (value.playerId <= BigInt(0) || value.playerId > U64_MAX) fail("player-status-player", "player id is outside its native range"); const writer = new RustIntegratedPlayerInventoryWriterV1(); writer.string(value.externalEntityId, "external entity id"); writer.string(value.actorId, "actor id"); writer.u64(value.playerId); return wrap(BWS5_MAGIC, writer.finish());
}

export function decodeRustIntegratedPlayerBootstrapStatusQueryV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWS5_MAGIC)); const value = Object.freeze({ externalEntityId: reader.string("external entity id"), actorId: reader.string("actor id"), playerId: reader.u64() }); reader.finish(); encodeRustIntegratedPlayerBootstrapStatusQueryV1(value); return value;
}

export function encodeRustIntegratedPlayerBootstrapStatusReceiptV1(value: RustIntegratedPlayerBootstrapStatusReceiptV1) {
  const writer = new RustIntegratedPlayerInventoryWriterV1(); writer.raw(hashBytes(value.requestPayloadHash, "request payload hash")); writer.u64(value.worldAuthorityRevision.epoch); writer.u64(value.worldAuthorityRevision.mutation); writer.u64(value.worldAuthorityRevision.residency); writer.u64(value.entityAuthority.revision); writer.option(value.entityAuthority.nextSequence, (entry) => writer.u64(entry)); writer.u64(value.entityAuthority.tick); writeContinuity(writer, value.continuity); writer.option(value.entity, (entry) => writeEntity(writer, entry)); writer.option(value.runtimePlayer, (entry) => writeRuntimePlayer(writer, entry)); writer.option(value.worldViewBinding, (entry) => writeWorldViewBinding(writer, entry)); writeCustody(writer, value.custody); return wrap(BWO5_MAGIC, writer.finish());
}

export function decodeRustIntegratedPlayerBootstrapStatusReceiptV1(packet: Uint8Array, expectedRequestPayloadHash?: string) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWO5_MAGIC)); const requestPayloadHash = bytesHash(reader.take(16)); if (expectedRequestPayloadHash !== undefined && requestPayloadHash !== checkedHash(expectedRequestPayloadHash, "expected request payload hash")) fail("player-status-request", "BWO5 does not attest the exact BWS5 request");
  const value = Object.freeze({ requestPayloadHash, worldAuthorityRevision: Object.freeze({ epoch: reader.u64(), mutation: reader.u64(), residency: reader.u64() }), entityAuthority: Object.freeze({ revision: reader.u64(), nextSequence: reader.option(() => reader.u64()), tick: reader.u64() }), continuity: readContinuity(reader), entity: reader.option(() => readEntity(reader)), runtimePlayer: reader.option(() => readRuntimePlayer(reader)), worldViewBinding: reader.option(() => readWorldViewBinding(reader)), custody: readCustody(reader) }); reader.finish(); return value;
}
