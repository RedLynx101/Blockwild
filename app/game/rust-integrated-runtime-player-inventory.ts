import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import { rustIntegratedRuntimeWireChecksumV1 } from "./rust-integrated-runtime-codec";
import { RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES } from "./rust-integrated-runtime-contract";
import type { RustGameplayRevisionR7 } from "./rust-gameplay-contract-r7";

export const RUST_INTEGRATED_PLAYER_INVENTORY_IMPORT_TYPE_V1 = "blockwild.gameplay.player-inventory-import.r7.v1";
export const RUST_INTEGRATED_PLAYER_INVENTORY_IMPORT_RECEIPT_TYPE_V1 = "blockwild.gameplay.player-inventory-import-receipt.r7.v1";

const BWP7_MAGIC = Uint8Array.of(0x42, 0x57, 0x50, 0x37);
const BWI7_MAGIC = Uint8Array.of(0x42, 0x57, 0x49, 0x37);
const BIR7_MAGIC = Uint8Array.of(0x42, 0x49, 0x52, 0x37);
const HEADER_BYTES = 28;
const MAX_STRING_BYTES = 16 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_METADATA_TOTAL_BYTES = 256 * 1024;
export const RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1 = 9;
export const RUST_INTEGRATED_PLAYER_EQUIPMENT_SLOT_COUNT_V1 = 8;
const MAX_ITEM_STACK = 0x7fff_ffff;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const U32_MAX = 0xffff_ffff;
const ZERO_HASH = "00000000000000000000000000000000";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type RustIntegratedContainerKindV1 =
  | "player" | "equipment" | "container" | "machine" | "waygrid" | "cardforge-case";

export type RustIntegratedContainerKeyV1 = Readonly<{
  kind: RustIntegratedContainerKindV1;
  id: string;
  ownerId: string | null;
}>;

export type RustIntegratedPlayerInventoryMetadataV1 = Readonly<{
  hash: string;
  typeId: string;
  schemaId: string;
  schemaVersion: number;
  contentVersion: number;
  canonicalJsonBytes: Uint8Array;
  unknownExtensionBytes: Uint8Array;
}>;

export type RustIntegratedPlayerInventoryStackV1 = Readonly<{
  itemCode: number;
  count: number;
  durabilityMillionths: number | null;
  metadataHash: string;
}>;

export type RustIntegratedPlayerInventoryImportV1 = Readonly<{
  inventoryContainer: RustIntegratedContainerKeyV1;
  expectedRevision: bigint;
  selectedSlot: number;
  slots: readonly (RustIntegratedPlayerInventoryStackV1 | null)[];
  metadata: readonly RustIntegratedPlayerInventoryMetadataV1[];
}>;

export type RustIntegratedPlayerInventoryImportReceiptV1 = Readonly<{
  requestPayloadHash: string;
  before: RustIntegratedGameplayAuthorityIdentityV1;
  after: RustIntegratedGameplayAuthorityIdentityV1;
  acceptedReceiptHash: string;
  resultingInventoryRevision: bigint;
  selectedSlot: number;
  inventoryResultHash: string;
}>;

export type RustIntegratedGameplayAuthorityIdentityV1 = Readonly<{
  universe: string;
  location: string;
  revision: RustGameplayRevisionR7;
  stateHash: string;
}>;

export type RustIntegratedPlayerInventoryIntentStackV1 = null | Readonly<{
  itemCode: number;
  count: number;
  durabilityMillionths: number | null;
  metadata: RustIntegratedPlayerInventoryMetadataV1 | null;
}>;

export type RustIntegratedPlayerInventoryIntentV1 = Readonly<{
  selectedSlot: number;
  slots: readonly RustIntegratedPlayerInventoryIntentStackV1[];
  /** Native BWP7 accepts only a pristine revision-zero custody. */
  expectedPristineRevision: bigint;
  /** Durable BIR7 hash over the one-shot BWP7 result at revision one. */
  bootstrapImportHash: string;
  /** Exact positive revision expected when a durable native state was restored. */
  expectedRestoredRevision: bigint;
  /** BIR7 hash over the desired slots/metadata at expectedRestoredRevision. */
  restoredInventoryHash: string;
}>;

export class RustIntegratedPlayerInventoryWireErrorV1 extends Error {
  readonly name = "RustIntegratedPlayerInventoryWireErrorV1";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedPlayerInventoryWireErrorV1(code, message);
}

function checkedInteger(value: number, maximum: number, label: string, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail("inventory-integer", `${label} is outside its range`);
  return value;
}

function checkedU64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0) || value > U64_MAX) fail("inventory-u64", `${label} is outside the u64 range`);
  return value;
}

function checkedHash(value: string, label: string) {
  if (!/^[0-9a-f]{32}$/u.test(value)) fail("inventory-hash", `${label} is not a canonical 128-bit hash`);
  return value;
}

function hashBytes(value: string, label: string) {
  checkedHash(value, label);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function bytesHash(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function visibleString(value: string, label: string) {
  if (typeof value !== "string" || value.length === 0 || encoder.encode(value).byteLength > MAX_STRING_BYTES
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || /[\ud800-\udfff]/u.test(value)) {
    fail("inventory-string", `${label} is not bounded visible UTF-8`);
  }
  return value;
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

export class RustIntegratedPlayerInventoryWriterV1 {
  private readonly output: number[] = [];
  u8(value: number) { this.output.push(checkedInteger(value, 0xff, "u8")); }
  u16(value: number) { checkedInteger(value, 0xffff, "u16"); this.output.push(value & 0xff, value >>> 8 & 0xff); }
  i16(value: number) { if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff) fail("inventory-integer", "i16 is outside its range"); this.u16(value & 0xffff); }
  u32(value: number) { checkedInteger(value, U32_MAX, "u32"); this.output.push(value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff); }
  u64(value: bigint) { let remaining = checkedU64(value, "u64"); for (let index = 0; index < 8; index += 1) { this.output.push(Number(remaining & BigInt(0xff))); remaining >>= BigInt(8); } }
  raw(value: Uint8Array) { for (const byte of value) this.output.push(byte); }
  bytes(value: Uint8Array, maximum = RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES) { if (!(value instanceof Uint8Array) || value.byteLength > maximum) fail("inventory-size", "byte field exceeds its bound"); this.u32(value.byteLength); this.raw(value); }
  string(value: string, label = "string") { this.bytes(encoder.encode(visibleString(value, label)), MAX_STRING_BYTES); }
  option<T>(value: T | null, write: (value: T) => void) { this.u8(value === null ? 0 : 1); if (value !== null) write(value); }
  finish() { return Uint8Array.from(this.output); }
}

export class RustIntegratedPlayerInventoryReaderV1 {
  private offset = 0;
  constructor(private readonly input: Uint8Array) {}
  take(length: number) { if (!Number.isInteger(length) || length < 0 || this.offset + length > this.input.byteLength) fail("inventory-truncated", "native inventory payload is truncated"); const value = this.input.subarray(this.offset, this.offset + length); this.offset += length; return value; }
  u8() { return this.take(1)[0]!; }
  u16() { const value = this.take(2); return new DataView(value.buffer, value.byteOffset, 2).getUint16(0, true); }
  i16() { const value = this.take(2); return new DataView(value.buffer, value.byteOffset, 2).getInt16(0, true); }
  u32() { const value = this.take(4); return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, true); }
  u64() { const value = this.take(8); return new DataView(value.buffer, value.byteOffset, 8).getBigUint64(0, true); }
  bytes(maximum = RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES) { const length = this.u32(); if (length > maximum) fail("inventory-size", "byte field exceeds its bound"); return this.take(length); }
  string(label = "string") { let value: string; try { value = decoder.decode(this.bytes(MAX_STRING_BYTES)); } catch { return fail("inventory-utf8", `${label} is not UTF-8`); } return visibleString(value, label); }
  option<T>(read: () => T) { const tag = this.u8(); if (tag > 1) fail("inventory-option", "native inventory option tag is not boolean"); return tag === 1 ? read() : null; }
  finish() { if (this.offset !== this.input.byteLength) fail("inventory-trailing", "native inventory payload has trailing bytes"); }
}

const CONTAINER_KINDS = Object.freeze([
  "player", "equipment", "container", "machine", "waygrid", "cardforge-case",
] as const);

export function writeRustIntegratedContainerKeyV1(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedContainerKeyV1) {
  const kind = CONTAINER_KINDS.indexOf(value.kind);
  if (kind < 0) fail("inventory-container", "container kind is unknown");
  writer.u8(kind); writer.string(value.id, "container id"); writer.option(value.ownerId, (owner) => writer.string(owner, "container owner"));
}

export function readRustIntegratedContainerKeyV1(reader: RustIntegratedPlayerInventoryReaderV1) {
  const kind = CONTAINER_KINDS[reader.u8()];
  if (!kind) fail("inventory-container", "container kind tag is unknown");
  return Object.freeze({ kind, id: reader.string("container id"), ownerId: reader.option(() => reader.string("container owner")) });
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("inventory-metadata", "metadata JSON contains a non-finite number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail("inventory-metadata", "metadata JSON contains an unsupported value");
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function validateCanonicalJsonBytes(value: Uint8Array) {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_METADATA_BYTES) fail("inventory-metadata", "metadata JSON exceeds its byte bound");
  let source: string;
  try { source = decoder.decode(value); } catch { return fail("inventory-metadata", "metadata JSON is not UTF-8"); }
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { return fail("inventory-metadata", "metadata JSON is invalid"); }
  if (canonicalJson(parsed) !== source) fail("inventory-metadata", "metadata JSON is not canonical JSON V1");
}

export function rustIntegratedPlayerInventoryMetadataHashV1(value: Omit<RustIntegratedPlayerInventoryMetadataV1, "hash">) {
  visibleString(value.typeId, "metadata type"); visibleString(value.schemaId, "metadata schema");
  checkedInteger(value.schemaVersion, 0xffff, "metadata schema version", 1);
  checkedInteger(value.contentVersion, U32_MAX, "metadata content version");
  validateCanonicalJsonBytes(value.canonicalJsonBytes);
  if (!(value.unknownExtensionBytes instanceof Uint8Array) || value.unknownExtensionBytes.byteLength > MAX_METADATA_BYTES) fail("inventory-metadata", "metadata extension exceeds its byte bound");
  return new TypeScriptCanonicalHasher("blockwild.gameplay.item-instance-metadata.v1")
    .writeU16(1).writeString(value.typeId).writeString(value.schemaId).writeU16(value.schemaVersion)
    .writeU32(value.contentVersion).writeBytes(value.canonicalJsonBytes).writeBytes(value.unknownExtensionBytes).finishHex();
}

function validateMetadata(value: RustIntegratedPlayerInventoryMetadataV1) {
  checkedHash(value.hash, "metadata hash");
  if (value.hash === ZERO_HASH || rustIntegratedPlayerInventoryMetadataHashV1(value) !== value.hash) fail("inventory-metadata", "metadata hash does not attest its immutable descriptor");
  return value;
}

export function writeRustIntegratedPlayerInventoryMetadataV1(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedPlayerInventoryMetadataV1) {
  validateMetadata(value); writer.raw(hashBytes(value.hash, "metadata hash")); writer.string(value.typeId, "metadata type"); writer.string(value.schemaId, "metadata schema"); writer.u16(value.schemaVersion); writer.u32(value.contentVersion); writer.bytes(value.canonicalJsonBytes, MAX_METADATA_BYTES); writer.bytes(value.unknownExtensionBytes, MAX_METADATA_BYTES);
}

export function readRustIntegratedPlayerInventoryMetadataV1(reader: RustIntegratedPlayerInventoryReaderV1) {
  const value = Object.freeze({ hash: bytesHash(reader.take(16)), typeId: reader.string("metadata type"), schemaId: reader.string("metadata schema"), schemaVersion: reader.u16(), contentVersion: reader.u32(), canonicalJsonBytes: Uint8Array.from(reader.bytes(MAX_METADATA_BYTES)), unknownExtensionBytes: Uint8Array.from(reader.bytes(MAX_METADATA_BYTES)) });
  validateMetadata(value); return value;
}

export function writeRustIntegratedPlayerInventoryStackV1(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedPlayerInventoryStackV1) {
  checkedInteger(value.itemCode, U32_MAX, "item code"); checkedInteger(value.count, U32_MAX, "stack count");
  if (value.durabilityMillionths !== null) checkedInteger(value.durabilityMillionths, U32_MAX, "durability");
  writer.u32(value.itemCode); writer.u32(value.count); writer.option(value.durabilityMillionths, (durability) => writer.u32(durability)); writer.raw(hashBytes(value.metadataHash, "stack metadata hash"));
}

export function readRustIntegratedPlayerInventoryStackV1(reader: RustIntegratedPlayerInventoryReaderV1) {
  const value = Object.freeze({ itemCode: reader.u32(), count: reader.u32(), durabilityMillionths: reader.option(() => reader.u32()), metadataHash: bytesHash(reader.take(16)) });
  const writer = new RustIntegratedPlayerInventoryWriterV1(); writeRustIntegratedPlayerInventoryStackV1(writer, value); return value;
}

export function validateRustIntegratedPlayerInventoryContentsV1(slots: readonly (RustIntegratedPlayerInventoryStackV1 | null)[], metadata: readonly RustIntegratedPlayerInventoryMetadataV1[]) {
  if (slots.length !== RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1) fail("inventory-slots", "player inventory must contain exactly nine slots");
  if (metadata.length > RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1) fail("inventory-metadata", "player inventory metadata count exceeds nine");
  const referenced = new Set<string>();
  for (const stack of slots) if (stack) { const writer = new RustIntegratedPlayerInventoryWriterV1(); writeRustIntegratedPlayerInventoryStackV1(writer, stack); if (stack.metadataHash !== ZERO_HASH) referenced.add(stack.metadataHash); }
  let bytes = 0; let previous = ""; const supplied = new Set<string>();
  for (const record of metadata) {
    validateMetadata(record); bytes += record.canonicalJsonBytes.byteLength + record.unknownExtensionBytes.byteLength;
    if (record.hash <= previous || supplied.has(record.hash)) fail("inventory-metadata", "metadata records are not in unique canonical hash order");
    previous = record.hash; supplied.add(record.hash);
  }
  if (bytes > MAX_METADATA_TOTAL_BYTES) fail("inventory-metadata", "player inventory metadata exceeds its aggregate bound");
  if (referenced.size !== supplied.size || [...referenced].some((hash) => !supplied.has(hash))) fail("inventory-metadata", "metadata records do not exactly cover nonzero stack hashes");
}

export function writeRustIntegratedPlayerInventoryContentsV1(writer: RustIntegratedPlayerInventoryWriterV1, slots: readonly (RustIntegratedPlayerInventoryStackV1 | null)[], metadata: readonly RustIntegratedPlayerInventoryMetadataV1[]) {
  validateRustIntegratedPlayerInventoryContentsV1(slots, metadata); writer.u32(slots.length); for (const stack of slots) writer.option(stack, (entry) => writeRustIntegratedPlayerInventoryStackV1(writer, entry)); writer.u32(metadata.length); for (const record of metadata) writeRustIntegratedPlayerInventoryMetadataV1(writer, record);
}

export function readRustIntegratedPlayerInventoryContentsV1(reader: RustIntegratedPlayerInventoryReaderV1) {
  const slotCount = reader.u32(); if (slotCount !== RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1) fail("inventory-slots", "native player inventory does not contain exactly nine slots");
  const slots = Object.freeze(Array.from({ length: slotCount }, () => reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader))));
  const metadataCount = reader.u32(); if (metadataCount > RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1) fail("inventory-metadata", "native metadata count exceeds nine");
  const metadata = Object.freeze(Array.from({ length: metadataCount }, () => readRustIntegratedPlayerInventoryMetadataV1(reader)));
  validateRustIntegratedPlayerInventoryContentsV1(slots, metadata); return Object.freeze({ slots, metadata });
}

function wrap(magic: Uint8Array, body: Uint8Array) {
  if (body.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES - HEADER_BYTES) fail("inventory-size", "native inventory packet exceeds its byte budget");
  const output = new Uint8Array(HEADER_BYTES + body.byteLength); const view = new DataView(output.buffer);
  output.set(magic); view.setUint16(4, 1, true); view.setUint16(6, 1, true); view.setUint32(8, body.byteLength, true); output.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(body), "packet checksum"), 12); output.set(body, HEADER_BYTES); return output;
}

function unwrap(packet: Uint8Array, magic: Uint8Array) {
  if (!(packet instanceof Uint8Array) || packet.byteLength < HEADER_BYTES || packet.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES || !magic.every((byte, index) => packet[index] === byte)) fail("inventory-header", "native inventory packet header is malformed");
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength); if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 1 || view.getUint32(8, true) !== packet.byteLength - HEADER_BYTES) fail("inventory-header", "native inventory packet version or length is invalid");
  const body = packet.subarray(HEADER_BYTES); if (bytesHash(packet.subarray(12, 28)) !== rustIntegratedRuntimeWireChecksumV1(body)) fail("inventory-checksum", "native inventory packet checksum is invalid"); return body;
}

export function encodeRustIntegratedPlayerInventoryImportV1(value: RustIntegratedPlayerInventoryImportV1) {
  if (value.inventoryContainer.kind !== "player" || value.inventoryContainer.ownerId === null) fail("inventory-container", "inventory import requires an owned player container");
  if (value.expectedRevision !== BigInt(0)) fail("inventory-revision", "inventory import requires pristine revision zero");
  checkedInteger(value.selectedSlot, 8, "selected slot");
  const writer = new RustIntegratedPlayerInventoryWriterV1(); writeRustIntegratedContainerKeyV1(writer, value.inventoryContainer); writer.u64(value.expectedRevision); writer.u16(value.selectedSlot); writeRustIntegratedPlayerInventoryContentsV1(writer, value.slots, value.metadata); return wrap(BWP7_MAGIC, writer.finish());
}

export function decodeRustIntegratedPlayerInventoryImportV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWP7_MAGIC)); const inventoryContainer = readRustIntegratedContainerKeyV1(reader); const expectedRevision = reader.u64(); const selectedSlot = reader.u16(); const contents = readRustIntegratedPlayerInventoryContentsV1(reader); reader.finish(); const value = Object.freeze({ inventoryContainer, expectedRevision, selectedSlot, ...contents }); encodeRustIntegratedPlayerInventoryImportV1(value); return value;
}

function writeGameplayIdentity(writer: RustIntegratedPlayerInventoryWriterV1, value: RustIntegratedGameplayAuthorityIdentityV1) {
  writer.string(value.universe, "gameplay universe"); writer.string(value.location, "gameplay location"); writer.u32(value.revision.epoch); writer.u64(value.revision.sequence); writer.u64(value.revision.inventory); writer.u64(value.revision.machines); writer.u64(value.revision.combat); writer.u64(value.revision.progression); writer.u64(value.revision.cardforge); writer.raw(hashBytes(value.stateHash, "gameplay state hash"));
}

function readGameplayIdentity(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedGameplayAuthorityIdentityV1 {
  return Object.freeze({ universe: reader.string("gameplay universe"), location: reader.string("gameplay location"), revision: Object.freeze({ epoch: reader.u32(), sequence: reader.u64(), inventory: reader.u64(), machines: reader.u64(), combat: reader.u64(), progression: reader.u64(), cardforge: reader.u64() }), stateHash: bytesHash(reader.take(16)) });
}

export function rustIntegratedPlayerInventoryResultHashV1(value: Readonly<{ inventoryContainer: RustIntegratedContainerKeyV1; revision: bigint; slots: readonly (RustIntegratedPlayerInventoryStackV1 | null)[]; metadata: readonly RustIntegratedPlayerInventoryMetadataV1[] }>) {
  const writer = new RustIntegratedPlayerInventoryWriterV1(); writer.raw(BIR7_MAGIC); writer.u16(1); writeRustIntegratedContainerKeyV1(writer, value.inventoryContainer); writer.u64(value.revision); writeRustIntegratedPlayerInventoryContentsV1(writer, value.slots, value.metadata); return rustIntegratedRuntimeWireChecksumV1(writer.finish());
}

export function encodeRustIntegratedPlayerInventoryImportReceiptV1(value: RustIntegratedPlayerInventoryImportReceiptV1) {
  checkedInteger(value.selectedSlot, 8, "receipt selected slot"); const writer = new RustIntegratedPlayerInventoryWriterV1(); writer.raw(hashBytes(value.requestPayloadHash, "request payload hash")); writeGameplayIdentity(writer, value.before); writeGameplayIdentity(writer, value.after); writer.raw(hashBytes(value.acceptedReceiptHash, "accepted receipt hash")); writer.u64(value.resultingInventoryRevision); writer.u16(value.selectedSlot); writer.raw(hashBytes(value.inventoryResultHash, "inventory result hash")); return wrap(BWI7_MAGIC, writer.finish());
}

export function decodeRustIntegratedPlayerInventoryImportReceiptV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWI7_MAGIC)); const value = Object.freeze({ requestPayloadHash: bytesHash(reader.take(16)), before: readGameplayIdentity(reader), after: readGameplayIdentity(reader), acceptedReceiptHash: bytesHash(reader.take(16)), resultingInventoryRevision: reader.u64(), selectedSlot: reader.u16(), inventoryResultHash: bytesHash(reader.take(16)) }); reader.finish(); checkedInteger(value.selectedSlot, 8, "receipt selected slot"); return value;
}

export function normalizeRustIntegratedPlayerInventoryIntentV1(inventoryContainer: RustIntegratedContainerKeyV1, value: RustIntegratedPlayerInventoryIntentV1): RustIntegratedPlayerInventoryImportV1 {
  if (value.expectedPristineRevision !== BigInt(0) || typeof value.expectedRestoredRevision !== "bigint"
    || value.expectedRestoredRevision <= BigInt(0) || value.expectedRestoredRevision > U64_MAX) {
    fail("inventory-revision", "bootstrap inventory must declare pristine zero and an exact positive restored revision");
  }
  if (value.slots.length !== RUST_INTEGRATED_PLAYER_INVENTORY_SLOT_COUNT_V1) fail("inventory-slots", "bootstrap inventory must declare exactly nine slots");
  const records = new Map<string, RustIntegratedPlayerInventoryMetadataV1>();
  const slots = Object.freeze(value.slots.map((slot) => {
    if (!slot) return null;
    checkedInteger(slot.itemCode, U32_MAX, "intent item code", 1);
    checkedInteger(slot.count, MAX_ITEM_STACK, "intent stack count", 1);
    if (slot.durabilityMillionths !== null) checkedInteger(slot.durabilityMillionths, 1_000_000, "intent durability");
    const metadataHash = slot.metadata?.hash ?? ZERO_HASH;
    if (slot.metadata) {
      validateMetadata(slot.metadata); const prior = records.get(metadataHash);
      if (prior && (!bytesEqual(prior.canonicalJsonBytes, slot.metadata.canonicalJsonBytes) || !bytesEqual(prior.unknownExtensionBytes, slot.metadata.unknownExtensionBytes) || prior.typeId !== slot.metadata.typeId || prior.schemaId !== slot.metadata.schemaId || prior.schemaVersion !== slot.metadata.schemaVersion || prior.contentVersion !== slot.metadata.contentVersion)) fail("inventory-metadata", "one metadata hash has contradictory descriptors");
      records.set(metadataHash, slot.metadata);
    }
    return Object.freeze({ itemCode: slot.itemCode, count: slot.count, durabilityMillionths: slot.durabilityMillionths, metadataHash });
  }));
  const metadata = Object.freeze([...records.values()].sort((left, right) => left.hash.localeCompare(right.hash)));
  const request = Object.freeze({ inventoryContainer, expectedRevision: value.expectedPristineRevision, selectedSlot: value.selectedSlot, slots, metadata });
  encodeRustIntegratedPlayerInventoryImportV1(request);
  const bootstrapHash = rustIntegratedPlayerInventoryResultHashV1({ ...request, revision: BigInt(1) });
  if (checkedHash(value.bootstrapImportHash, "bootstrap import hash") !== bootstrapHash) fail("inventory-import-hash", "bootstrap import hash does not attest the revision-one BWP7 result");
  const restoredHash = rustIntegratedPlayerInventoryResultHashV1({ ...request, revision: value.expectedRestoredRevision });
  if (checkedHash(value.restoredInventoryHash, "restored inventory hash") !== restoredHash) fail("inventory-restored-hash", "restored inventory hash does not attest the desired durable inventory");
  return request;
}

export function validateRustIntegratedPlayerInventoryImportReceiptV1(receipt: RustIntegratedPlayerInventoryImportReceiptV1, request: RustIntegratedPlayerInventoryImportV1, requestPayloadHash: string) {
  if (receipt.requestPayloadHash !== checkedHash(requestPayloadHash, "request payload hash") || receipt.resultingInventoryRevision !== request.expectedRevision + BigInt(1) || receipt.selectedSlot !== request.selectedSlot) fail("inventory-receipt", "BWI7 does not attest the exact inventory request");
  const before = receipt.before; const after = receipt.after;
  if (before.universe !== after.universe || before.location !== after.location || before.revision.epoch !== after.revision.epoch || after.revision.sequence !== before.revision.sequence + BigInt(1) || after.revision.inventory !== before.revision.inventory + BigInt(1) || after.revision.machines !== before.revision.machines || after.revision.combat !== before.revision.combat || after.revision.progression !== before.revision.progression || after.revision.cardforge !== before.revision.cardforge || before.stateHash === after.stateHash) fail("inventory-receipt", "BWI7 gameplay authority transition is discontinuous");
  const expectedResult = rustIntegratedPlayerInventoryResultHashV1({ inventoryContainer: request.inventoryContainer, revision: receipt.resultingInventoryRevision, slots: request.slots, metadata: request.metadata });
  if (receipt.inventoryResultHash !== expectedResult) fail("inventory-receipt", "BWI7 result hash does not attest the imported inventory");
  return receipt;
}
