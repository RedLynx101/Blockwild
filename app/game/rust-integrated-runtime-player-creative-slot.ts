import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec.ts";
import {
  RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES,
  rustIntegratedRuntimeIdentityEqualsV1,
  type RustIntegratedRuntimeAcceptedReceiptV1,
  type RustIntegratedRuntimeCommandBatchV1,
  type RustIntegratedRuntimeCommandReceiptV1,
  type RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract.ts";
import {
  RustIntegratedPlayerInventoryReaderV1,
  RustIntegratedPlayerInventoryWriterV1,
  readRustIntegratedContainerKeyV1,
  readRustIntegratedPlayerInventoryStackV1,
  writeRustIntegratedContainerKeyV1,
  writeRustIntegratedPlayerInventoryStackV1,
  type RustIntegratedContainerKeyV1,
  type RustIntegratedGameplayAuthorityIdentityV1,
  type RustIntegratedPlayerInventoryStackV1,
} from "./rust-integrated-runtime-player-inventory.ts";
import { rustIntegratedContainerViewKeyV1, rustIntegratedPlayerInventoryStacksEqualV1 } from "./rust-integrated-runtime-player-locator-consume.ts";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated.ts";
import type { RustLivePlayerViewR10 } from "./rust-live-player-view-r10.ts";

const REQUEST_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("player-creative-slot-set-v1");
const RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("player-creative-slot-set-receipt-v1");

export const RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_TYPE_V1 = REQUEST_SCHEMA.typeId;
export const RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_RECEIPT_TYPE_V1 = RECEIPT_SCHEMA.typeId;

const BWF7_MAGIC = new TextEncoder().encode(REQUEST_SCHEMA.magic);
const BWH7_MAGIC = new TextEncoder().encode(RECEIPT_SCHEMA.magic);
const HEADER_BYTES = 28;
const HASH = /^[0-9a-f]{32}$/u;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const encoder = new TextEncoder();

export type RustIntegratedPlayerCreativeSlotSetV1 = Readonly<{
  inventory: RustIntegratedContainerKeyV1;
  selectedSlot: number;
  expectedInventoryRevision: bigint;
  expectedStack: RustIntegratedPlayerInventoryStackV1 | null;
  replacementStack: RustIntegratedPlayerInventoryStackV1;
}>;

export type RustIntegratedPlayerCreativeSlotSetReceiptV1 = Readonly<{
  requestPayloadHash: string;
  before: RustIntegratedGameplayAuthorityIdentityV1;
  after: RustIntegratedGameplayAuthorityIdentityV1;
  acceptedReceiptHash: string;
  inventory: RustIntegratedContainerKeyV1;
  selectedSlot: number;
  previousInventoryRevision: bigint;
  resultingInventoryRevision: bigint;
  previousStack: RustIntegratedPlayerInventoryStackV1 | null;
  replacementStack: RustIntegratedPlayerInventoryStackV1;
  inventoryResultHash: string;
  receiptHash: string;
}>;

export type RustLiveCreativeSlotSetPlanV1 = Readonly<{
  batch: RustIntegratedRuntimeCommandBatchV1;
  request: RustIntegratedPlayerCreativeSlotSetV1;
  requestPayloadHash: string;
  inventoryViewKey: string;
}>;

export type RustLiveCreativeSlotSetValidatedReceiptV1 = Readonly<{
  creativeSlot: RustIntegratedPlayerCreativeSlotSetReceiptV1;
  outer: RustIntegratedRuntimeAcceptedReceiptV1;
}>;

export class RustIntegratedPlayerCreativeSlotSetErrorV1 extends Error {
  readonly name = "RustIntegratedPlayerCreativeSlotSetErrorV1";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never { throw new RustIntegratedPlayerCreativeSlotSetErrorV1(code, message); }
function hash(value: string, label: string) {
  if (typeof value !== "string" || !HASH.test(value) || /^0{32}$/u.test(value)) fail("creative-slot-hash", `${label} is not a canonical nonzero hash`);
  return value;
}
function hashBytes(value: string, label: string) {
  hash(value, label);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}
function bytesHash(value: Uint8Array) { return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function slot(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 8) fail("creative-slot-slot", "selected creative inventory slot is outside the player hotbar");
  return value;
}
function u64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0) || value > U64_MAX) fail("creative-slot-u64", `${label} is outside u64`);
  return value;
}
function stack(value: RustIntegratedPlayerInventoryStackV1, label: string) {
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeRustIntegratedPlayerInventoryStackV1(writer, value);
  if (value.itemCode < 1 || value.count < 1 || value.count > 0x7fff_ffff
    || value.durabilityMillionths !== null && value.durabilityMillionths > 1_000_000) fail("creative-slot-stack", `${label} is not a nonempty inventory stack`);
  return value;
}
function sameContainer(left: RustIntegratedContainerKeyV1, right: RustIntegratedContainerKeyV1) {
  return left.kind === right.kind && left.id === right.id && left.ownerId === right.ownerId;
}
function wrap(magic: Uint8Array, schema: number, body: Uint8Array) {
  if (body.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES - HEADER_BYTES) fail("creative-slot-size", "creative slot packet exceeds byte budget");
  const output = new Uint8Array(HEADER_BYTES + body.byteLength);
  const view = new DataView(output.buffer);
  output.set(magic); view.setUint16(4, 1, true); view.setUint16(6, schema, true); view.setUint32(8, body.byteLength, true);
  output.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(body), "packet checksum"), 12); output.set(body, HEADER_BYTES);
  return output;
}
function unwrap(packet: Uint8Array, magic: Uint8Array, schema: number) {
  if (!(packet instanceof Uint8Array) || packet.byteLength < HEADER_BYTES
    || packet.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES
    || !magic.every((byte, index) => packet[index] === byte)) fail("creative-slot-header", "creative slot packet header is malformed");
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== schema || view.getUint32(8, true) !== packet.byteLength - HEADER_BYTES) fail("creative-slot-header", "creative slot packet version or length is invalid");
  const body = packet.subarray(HEADER_BYTES);
  if (bytesHash(packet.subarray(12, HEADER_BYTES)) !== rustIntegratedRuntimeWireChecksumV1(body)) fail("creative-slot-checksum", "creative slot packet checksum is invalid");
  return body;
}
function writeGameplayIdentity(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedGameplayAuthorityIdentityV1) {
  writer.string(value.universe, "gameplay universe"); writer.string(value.location, "gameplay location"); writer.u32(value.revision.epoch);
  writer.u64(value.revision.sequence); writer.u64(value.revision.inventory); writer.u64(value.revision.machines); writer.u64(value.revision.combat);
  writer.u64(value.revision.progression); writer.u64(value.revision.cardforge); writer.raw(hashBytes(value.stateHash, "gameplay state hash"));
}
function readGameplayIdentity(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedGameplayAuthorityIdentityV1 {
  return Object.freeze({ universe: reader.string("gameplay universe"), location: reader.string("gameplay location"), revision: Object.freeze({
    epoch: reader.u32(), sequence: reader.u64(), inventory: reader.u64(), machines: reader.u64(), combat: reader.u64(), progression: reader.u64(), cardforge: reader.u64(),
  }), stateHash: bytesHash(reader.take(16)) });
}

export function encodeRustIntegratedPlayerCreativeSlotSetV1(value: RustIntegratedPlayerCreativeSlotSetV1) {
  if (value.inventory.kind !== "player" || value.inventory.ownerId === null) fail("creative-slot-container", "creative slot CAS requires an owned player inventory");
  slot(value.selectedSlot); u64(value.expectedInventoryRevision, "expected inventory revision");
  if (value.expectedStack !== null) stack(value.expectedStack, "expected stack"); stack(value.replacementStack, "replacement stack");
  const writer = new RustIntegratedPlayerInventoryWriterV1(); writeRustIntegratedContainerKeyV1(writer, value.inventory); writer.u16(value.selectedSlot);
  writer.u64(value.expectedInventoryRevision); writer.option(value.expectedStack, (entry) => writeRustIntegratedPlayerInventoryStackV1(writer, entry));
  writeRustIntegratedPlayerInventoryStackV1(writer, value.replacementStack); return wrap(BWF7_MAGIC, REQUEST_SCHEMA.innerSchema, writer.finish());
}
export function decodeRustIntegratedPlayerCreativeSlotSetV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWF7_MAGIC, REQUEST_SCHEMA.innerSchema));
  const value = Object.freeze({ inventory: readRustIntegratedContainerKeyV1(reader), selectedSlot: reader.u16(), expectedInventoryRevision: reader.u64(),
    expectedStack: reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader)), replacementStack: readRustIntegratedPlayerInventoryStackV1(reader) });
  reader.finish(); encodeRustIntegratedPlayerCreativeSlotSetV1(value); return value;
}
function writeCreativeSlotReceiptContentsV1(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: Omit<RustIntegratedPlayerCreativeSlotSetReceiptV1, "receiptHash"> | RustIntegratedPlayerCreativeSlotSetReceiptV1,
) {
  writer.raw(hashBytes(value.requestPayloadHash, "request payload hash")); writeGameplayIdentity(writer, value.before);
  writeGameplayIdentity(writer, value.after); writer.raw(hashBytes(value.acceptedReceiptHash, "accepted receipt hash")); writeRustIntegratedContainerKeyV1(writer, value.inventory);
  writer.u16(value.selectedSlot); writer.u64(value.previousInventoryRevision); writer.u64(value.resultingInventoryRevision);
  writer.option(value.previousStack, (entry) => writeRustIntegratedPlayerInventoryStackV1(writer, entry)); writeRustIntegratedPlayerInventoryStackV1(writer, value.replacementStack);
  writer.raw(hashBytes(value.inventoryResultHash, "inventory result hash"));
}

export function rustIntegratedPlayerCreativeSlotSetReceiptHashV1(
  value: Omit<RustIntegratedPlayerCreativeSlotSetReceiptV1, "receiptHash"> | RustIntegratedPlayerCreativeSlotSetReceiptV1,
) {
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeCreativeSlotReceiptContentsV1(writer, value);
  return rustIntegratedRuntimeWireChecksumV1(writer.finish());
}

export function encodeRustIntegratedPlayerCreativeSlotSetReceiptV1(value: RustIntegratedPlayerCreativeSlotSetReceiptV1) {
  hash(value.requestPayloadHash, "request payload hash"); hash(value.acceptedReceiptHash, "accepted receipt hash"); hash(value.inventoryResultHash, "inventory result hash"); hash(value.receiptHash, "receipt hash");
  slot(value.selectedSlot); u64(value.previousInventoryRevision, "previous inventory revision"); u64(value.resultingInventoryRevision, "resulting inventory revision");
  if (value.previousStack !== null) stack(value.previousStack, "previous stack"); stack(value.replacementStack, "replacement stack");
  if (rustIntegratedPlayerCreativeSlotSetReceiptHashV1(value) !== value.receiptHash) fail("creative-slot-receipt-hash", "BWH7 receipt hash does not match its canonical pre-hash contents");
  const writer = new RustIntegratedPlayerInventoryWriterV1(); writeCreativeSlotReceiptContentsV1(writer, value);
  writer.raw(hashBytes(value.receiptHash, "receipt hash")); return wrap(BWH7_MAGIC, RECEIPT_SCHEMA.innerSchema, writer.finish());
}
export function decodeRustIntegratedPlayerCreativeSlotSetReceiptV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWH7_MAGIC, RECEIPT_SCHEMA.innerSchema));
  const value = Object.freeze({ requestPayloadHash: bytesHash(reader.take(16)), before: readGameplayIdentity(reader), after: readGameplayIdentity(reader),
    acceptedReceiptHash: bytesHash(reader.take(16)), inventory: readRustIntegratedContainerKeyV1(reader), selectedSlot: reader.u16(),
    previousInventoryRevision: reader.u64(), resultingInventoryRevision: reader.u64(), previousStack: reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader)),
    replacementStack: readRustIntegratedPlayerInventoryStackV1(reader), inventoryResultHash: bytesHash(reader.take(16)), receiptHash: bytesHash(reader.take(16)) });
  reader.finish(); encodeRustIntegratedPlayerCreativeSlotSetReceiptV1(value); return value;
}

export function planRustLiveCreativeSlotSetV1(identity: RustIntegratedRuntimeIdentityV1, actorId: string, intent: RustIntegratedPlayerCreativeSlotSetV1): RustLiveCreativeSlotSetPlanV1 {
  const request = decodeRustIntegratedPlayerCreativeSlotSetV1(encodeRustIntegratedPlayerCreativeSlotSetV1(intent));
  if (request.inventory.ownerId !== actorId) fail("creative-slot-actor", "creative slot inventory owner does not match authoritative actor");
  const operation = createRustIntegratedRuntimeDomainOperationV1({ domain: "gameplay", typeId: RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_TYPE_V1, schema: REQUEST_SCHEMA.operationSchema,
    payload: encodeRustIntegratedPlayerCreativeSlotSetV1(request) });
  const key = `player-creative-slot-set:${operation.payloadHash}`;
  return Object.freeze({ batch: createRustIntegratedRuntimeCommandBatchV1({ commandId: key, idempotencyKey: key, actorId, expected: identity, operations: Object.freeze([operation]) }),
    request, requestPayloadHash: operation.payloadHash, inventoryViewKey: rustIntegratedContainerViewKeyV1(request.inventory) });
}
function validateOuterHash(receipt: RustIntegratedRuntimeCommandReceiptV1) {
  const bytes = [...hashBytes(receipt.commandHash, "command hash")];
  if (receipt.status === "accepted") { bytes.push(...hashBytes(receipt.before.stateHash, "before hash"), ...hashBytes(receipt.after.stateHash, "after hash"));
    for (const operation of receipt.domainReceipts) bytes.push(...hashBytes(operation.payloadHash, "domain receipt hash"));
  } else bytes.push(...hashBytes(receipt.current.stateHash, "current hash"), ...encoder.encode(receipt.code), ...encoder.encode(receipt.message));
  if (receipt.receiptHash !== rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes))) fail("creative-slot-command-receipt", "creative slot command receipt hash is invalid");
}
function validateGameplayTransition(before: RustIntegratedGameplayAuthorityIdentityV1, after: RustIntegratedGameplayAuthorityIdentityV1, plan: RustLiveCreativeSlotSetPlanV1) {
  if (before.universe !== plan.batch.expected.universeId || before.location !== plan.batch.expected.locationId || after.universe !== before.universe || after.location !== before.location
    || after.revision.epoch !== before.revision.epoch || after.revision.sequence !== before.revision.sequence + BigInt(1)
    || after.revision.inventory !== before.revision.inventory + BigInt(1) || after.revision.machines !== before.revision.machines
    || after.revision.combat !== before.revision.combat || after.revision.progression !== before.revision.progression || after.revision.cardforge !== before.revision.cardforge
    || after.stateHash === before.stateHash) fail("creative-slot-receipt", "BWH7 gameplay authority transition is discontinuous");
}
export function validateRustLiveCreativeSlotSetReceiptV1(plan: RustLiveCreativeSlotSetPlanV1, receipt: RustIntegratedRuntimeCommandReceiptV1): RustLiveCreativeSlotSetValidatedReceiptV1 {
  if (receipt.commandId !== plan.batch.commandId || receipt.idempotencyKey !== plan.batch.idempotencyKey || receipt.commandHash !== plan.batch.commandHash) fail("creative-slot-command-receipt", "creative slot receipt does not identify submitted batch");
  validateOuterHash(receipt);
  if (receipt.status === "rejected") { if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.current, plan.batch.expected)) fail("creative-slot-command-receipt", "rejected creative slot command moved identity"); fail(receipt.code, receipt.message); }
  if (receipt.domainReceipts.length !== 1) fail("creative-slot-command-receipt", "accepted creative slot command requires one domain receipt");
  const operation = receipt.domainReceipts[0];
  if (operation.domain !== "gameplay" || operation.typeId !== RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_RECEIPT_TYPE_V1
    || operation.schema !== RECEIPT_SCHEMA.operationSchema
    || operation.payloadHash !== rustIntegratedRuntimeWireChecksumV1(operation.payload)) fail("creative-slot-command-receipt", "accepted creative slot command returned wrong domain receipt");
  const decoded = decodeRustIntegratedPlayerCreativeSlotSetReceiptV1(operation.payload);
  if (decoded.requestPayloadHash !== plan.requestPayloadHash || !sameContainer(decoded.inventory, plan.request.inventory) || decoded.selectedSlot !== plan.request.selectedSlot
    || decoded.previousInventoryRevision !== plan.request.expectedInventoryRevision || decoded.resultingInventoryRevision !== plan.request.expectedInventoryRevision + BigInt(1)
    || !rustIntegratedPlayerInventoryStacksEqualV1(decoded.previousStack, plan.request.expectedStack)
    || !rustIntegratedPlayerInventoryStacksEqualV1(decoded.replacementStack, plan.request.replacementStack)) fail("creative-slot-receipt", "BWH7 does not attest exact selected-slot CAS");
  validateGameplayTransition(decoded.before, decoded.after, plan);
  if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.before, plan.batch.expected)) fail("creative-slot-command-receipt", "creative slot before identity differs from request");
  const keys = Object.keys(receipt.before.revision) as Array<keyof RustIntegratedRuntimeIdentityV1["revision"]>;
  if (keys.some((key) => receipt.after.revision[key] !== receipt.before.revision[key] + (key === "gameplay" ? 1 : 0))
    || receipt.after.tick !== receipt.before.tick
    || receipt.after.universeId !== receipt.before.universeId
    || receipt.after.locationId !== receipt.before.locationId
    || receipt.after.stateHash === receipt.before.stateHash) fail("creative-slot-command-receipt", "creative slot outer transition is not one gameplay mutation");
  return Object.freeze({ creativeSlot: decoded, outer: receipt });
}
export function validateRustLiveCreativeSlotSetAfterCommandV1(plan: RustLiveCreativeSlotSetPlanV1, validated: RustLiveCreativeSlotSetValidatedReceiptV1, player: RustLivePlayerViewR10) {
  const held = player.held === null ? null : Object.freeze({ itemCode: player.held.itemCode, count: player.held.count,
    durabilityMillionths: player.held.durabilityMillionths, metadataHash: bytesHash(player.held.metadataHash) });
  if (player.authorityTick !== BigInt(validated.outer.after.tick) || player.actorId !== plan.batch.actorId || player.inventoryContainer !== plan.inventoryViewKey
    || player.selectedSlot !== plan.request.selectedSlot || player.inventoryContainerRevision !== validated.creativeSlot.resultingInventoryRevision
    || !rustIntegratedPlayerInventoryStacksEqualV1(held, plan.request.replacementStack)) fail("creative-slot-extraction", "post-command player row does not attest exact BWH7 selected-slot result");
  return player;
}
