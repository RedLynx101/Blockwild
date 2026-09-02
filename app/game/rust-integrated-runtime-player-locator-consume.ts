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
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated.ts";
import type { RustLivePlayerViewR10 } from "./rust-live-player-view-r10.ts";

const REQUEST_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("player-locator-item-consume-v1");
const RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("player-locator-item-consume-receipt-v1");

export const RUST_INTEGRATED_PLAYER_LOCATOR_ITEM_CONSUME_TYPE_V1 = REQUEST_SCHEMA.typeId;
export const RUST_INTEGRATED_PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_TYPE_V1 = RECEIPT_SCHEMA.typeId;

const BWV7_MAGIC = new TextEncoder().encode(REQUEST_SCHEMA.magic);
const BWX7_MAGIC = new TextEncoder().encode(RECEIPT_SCHEMA.magic);
const HEADER_BYTES = 28;
const MAX_PACKET_BYTES = RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const HASH = /^[0-9a-f]{32}$/u;
const encoder = new TextEncoder();

export type RustIntegratedPlayerLocatorItemConsumePurposeV1 = "chart" | "lair";

export type RustIntegratedPlayerLocatorItemConsumeV1 = Readonly<{
  inventory: RustIntegratedContainerKeyV1;
  selectedSlot: number;
  expectedInventoryRevision: bigint;
  expectedStack: RustIntegratedPlayerInventoryStackV1;
  purpose: RustIntegratedPlayerLocatorItemConsumePurposeV1;
  locatorResultHash: string;
}>;

export type RustIntegratedPlayerLocatorItemConsumeReceiptV1 = Readonly<{
  requestPayloadHash: string;
  purpose: RustIntegratedPlayerLocatorItemConsumePurposeV1;
  locatorResultHash: string;
  before: RustIntegratedGameplayAuthorityIdentityV1;
  after: RustIntegratedGameplayAuthorityIdentityV1;
  acceptedReceiptHash: string;
  inventory: RustIntegratedContainerKeyV1;
  selectedSlot: number;
  previousInventoryRevision: bigint;
  resultingInventoryRevision: bigint;
  consumedStack: RustIntegratedPlayerInventoryStackV1;
  remainingStack: RustIntegratedPlayerInventoryStackV1 | null;
  inventoryResultHash: string;
}>;

export type RustLiveLocatorItemConsumePlanV1 = Readonly<{
  batch: RustIntegratedRuntimeCommandBatchV1;
  request: RustIntegratedPlayerLocatorItemConsumeV1;
  requestPayloadHash: string;
  expectedRemainingStack: RustIntegratedPlayerInventoryStackV1 | null;
  inventoryViewKey: string;
}>;

export type RustLiveLocatorItemConsumeValidatedReceiptV1 = Readonly<{
  locator: RustIntegratedPlayerLocatorItemConsumeReceiptV1;
  outer: RustIntegratedRuntimeAcceptedReceiptV1;
  remainingStack: RustIntegratedPlayerInventoryStackV1 | null;
}>;

export type RustLiveLocatorItemConsumePlanRecordV1 = Readonly<{
  schema: 1;
  actorId: string;
  expected: RustIntegratedRuntimeIdentityV1;
  requestPayloadHex: string;
  requestPayloadHash: string;
  commandHash: string;
}>;

export class RustIntegratedPlayerLocatorItemConsumeErrorV1 extends Error {
  readonly name = "RustIntegratedPlayerLocatorItemConsumeErrorV1";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedPlayerLocatorItemConsumeErrorV1(code, message);
}

function checkedHash(value: string, label: string) {
  if (typeof value !== "string" || !HASH.test(value)) fail("locator-consume-hash", `${label} is not a canonical hash`);
  return value;
}

function checkedNonzeroHash(value: string, label: string) {
  checkedHash(value, label);
  if (/^0{32}$/u.test(value)) fail("locator-consume-hash", `${label} must be non-zero`);
  return value;
}

function hashBytes(value: string, label: string) {
  checkedHash(value, label);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function bytesHash(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function checkedSlot(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 8) {
    fail("locator-consume-slot", "selected locator inventory slot is outside the player hotbar");
  }
  return value;
}

function checkedU64(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0) || value > U64_MAX) {
    fail("locator-consume-u64", `${label} is outside the u64 range`);
  }
  return value;
}

function checkedStack(value: RustIntegratedPlayerInventoryStackV1, label: string) {
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeRustIntegratedPlayerInventoryStackV1(writer, value);
  if (value.itemCode < 1 || value.count < 1 || value.count > 0x7fff_ffff
    || value.durabilityMillionths !== null && value.durabilityMillionths > 1_000_000) {
    fail("locator-consume-stack", `${label} is not a consumable gameplay item stack`);
  }
  return value;
}

function purposeTag(value: RustIntegratedPlayerLocatorItemConsumePurposeV1) {
  if (value === "chart") return 0;
  if (value === "lair") return 1;
  return fail("locator-consume-purpose", "locator item purpose is unknown");
}

function readPurpose(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedPlayerLocatorItemConsumePurposeV1 {
  const tag = reader.u8();
  if (tag === 0) return "chart";
  if (tag === 1) return "lair";
  return fail("locator-consume-purpose", "native locator item purpose tag is unknown");
}

function wrap(magic: Uint8Array, schema: number, body: Uint8Array) {
  if (body.byteLength > MAX_PACKET_BYTES - HEADER_BYTES) {
    fail("locator-consume-size", "locator item packet exceeds its byte budget");
  }
  const output = new Uint8Array(HEADER_BYTES + body.byteLength);
  const view = new DataView(output.buffer);
  output.set(magic);
  view.setUint16(4, 1, true);
  view.setUint16(6, schema, true);
  view.setUint32(8, body.byteLength, true);
  output.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(body), "packet checksum"), 12);
  output.set(body, HEADER_BYTES);
  return output;
}

function unwrap(packet: Uint8Array, magic: Uint8Array, schema: number) {
  if (!(packet instanceof Uint8Array) || packet.byteLength < HEADER_BYTES || packet.byteLength > MAX_PACKET_BYTES
    || !magic.every((byte, index) => packet[index] === byte)) {
    fail("locator-consume-header", "locator item packet header is malformed");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== schema
    || view.getUint32(8, true) !== packet.byteLength - HEADER_BYTES) {
    fail("locator-consume-header", "locator item packet version or length is invalid");
  }
  const body = packet.subarray(HEADER_BYTES);
  if (bytesHash(packet.subarray(12, HEADER_BYTES)) !== rustIntegratedRuntimeWireChecksumV1(body)) {
    fail("locator-consume-checksum", "locator item packet checksum is invalid");
  }
  return body;
}

function writeGameplayIdentity(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedGameplayAuthorityIdentityV1,
) {
  writer.string(value.universe, "gameplay universe");
  writer.string(value.location, "gameplay location");
  writer.u32(value.revision.epoch);
  writer.u64(value.revision.sequence);
  writer.u64(value.revision.inventory);
  writer.u64(value.revision.machines);
  writer.u64(value.revision.combat);
  writer.u64(value.revision.progression);
  writer.u64(value.revision.cardforge);
  writer.raw(hashBytes(value.stateHash, "gameplay state hash"));
}

function readGameplayIdentity(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedGameplayAuthorityIdentityV1 {
  return Object.freeze({
    universe: reader.string("gameplay universe"),
    location: reader.string("gameplay location"),
    revision: Object.freeze({
      epoch: reader.u32(),
      sequence: reader.u64(),
      inventory: reader.u64(),
      machines: reader.u64(),
      combat: reader.u64(),
      progression: reader.u64(),
      cardforge: reader.u64(),
    }),
    stateHash: bytesHash(reader.take(16)),
  });
}

function sameContainer(left: RustIntegratedContainerKeyV1, right: RustIntegratedContainerKeyV1) {
  return left.kind === right.kind && left.id === right.id && left.ownerId === right.ownerId;
}

export function rustIntegratedPlayerInventoryStacksEqualV1(
  left: RustIntegratedPlayerInventoryStackV1 | null,
  right: RustIntegratedPlayerInventoryStackV1 | null,
) {
  return left === null || right === null
    ? left === right
    : left.itemCode === right.itemCode
      && left.count === right.count
      && left.durabilityMillionths === right.durabilityMillionths
      && left.metadataHash === right.metadataHash;
}

export function rustIntegratedContainerViewKeyV1(value: RustIntegratedContainerKeyV1) {
  const validation = new RustIntegratedPlayerInventoryWriterV1();
  writeRustIntegratedContainerKeyV1(validation, value);
  const kinds = ["player", "equipment", "container", "machine", "waygrid", "cardforge-case"] as const;
  const kind = kinds.indexOf(value.kind);
  if (kind < 0) fail("locator-consume-container", "locator inventory container kind is unknown");
  const owner = value.ownerId === null ? null : encoder.encode(value.ownerId);
  const id = encoder.encode(value.id);
  const bytes = new RustIntegratedPlayerInventoryWriterV1();
  bytes.u8(1);
  bytes.u16(kind);
  bytes.u8(owner === null ? 0 : 1);
  if (owner !== null) { bytes.u32(owner.byteLength); bytes.raw(owner); }
  bytes.u32(id.byteLength);
  bytes.raw(id);
  return `container-key-v1/${bytesHash(bytes.finish())}`;
}

export function encodeRustIntegratedPlayerLocatorItemConsumeV1(
  value: RustIntegratedPlayerLocatorItemConsumeV1,
) {
  if (value.inventory.kind !== "player" || value.inventory.ownerId === null) {
    fail("locator-consume-container", "locator item consumption requires an owned player inventory");
  }
  checkedSlot(value.selectedSlot);
  checkedU64(value.expectedInventoryRevision, "expected inventory revision");
  checkedStack(value.expectedStack, "expected locator stack");
  checkedNonzeroHash(value.locatorResultHash, "locator result hash");
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeRustIntegratedContainerKeyV1(writer, value.inventory);
  writer.u16(value.selectedSlot);
  writer.u64(value.expectedInventoryRevision);
  writeRustIntegratedPlayerInventoryStackV1(writer, value.expectedStack);
  writer.u8(purposeTag(value.purpose));
  writer.raw(hashBytes(value.locatorResultHash, "locator result hash"));
  return wrap(BWV7_MAGIC, REQUEST_SCHEMA.innerSchema, writer.finish());
}

export function decodeRustIntegratedPlayerLocatorItemConsumeV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWV7_MAGIC, REQUEST_SCHEMA.innerSchema));
  const value = Object.freeze({
    inventory: readRustIntegratedContainerKeyV1(reader),
    selectedSlot: reader.u16(),
    expectedInventoryRevision: reader.u64(),
    expectedStack: readRustIntegratedPlayerInventoryStackV1(reader),
    purpose: readPurpose(reader),
    locatorResultHash: bytesHash(reader.take(16)),
  });
  reader.finish();
  encodeRustIntegratedPlayerLocatorItemConsumeV1(value);
  return value;
}

export function encodeRustIntegratedPlayerLocatorItemConsumeReceiptV1(
  value: RustIntegratedPlayerLocatorItemConsumeReceiptV1,
) {
  checkedSlot(value.selectedSlot);
  checkedU64(value.previousInventoryRevision, "previous inventory revision");
  checkedU64(value.resultingInventoryRevision, "resulting inventory revision");
  checkedStack(value.consumedStack, "consumed locator stack");
  if (value.remainingStack !== null) checkedStack(value.remainingStack, "remaining locator stack");
  checkedNonzeroHash(value.requestPayloadHash, "request payload hash");
  checkedNonzeroHash(value.locatorResultHash, "locator result hash");
  checkedNonzeroHash(value.acceptedReceiptHash, "accepted gameplay receipt hash");
  checkedNonzeroHash(value.inventoryResultHash, "inventory result hash");
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writer.raw(hashBytes(value.requestPayloadHash, "request payload hash"));
  writer.u8(purposeTag(value.purpose));
  writer.raw(hashBytes(value.locatorResultHash, "locator result hash"));
  writeGameplayIdentity(writer, value.before);
  writeGameplayIdentity(writer, value.after);
  writer.raw(hashBytes(value.acceptedReceiptHash, "accepted gameplay receipt hash"));
  writeRustIntegratedContainerKeyV1(writer, value.inventory);
  writer.u16(value.selectedSlot);
  writer.u64(value.previousInventoryRevision);
  writer.u64(value.resultingInventoryRevision);
  writeRustIntegratedPlayerInventoryStackV1(writer, value.consumedStack);
  writer.option(value.remainingStack, (stack) => writeRustIntegratedPlayerInventoryStackV1(writer, stack));
  writer.raw(hashBytes(value.inventoryResultHash, "inventory result hash"));
  return wrap(BWX7_MAGIC, RECEIPT_SCHEMA.innerSchema, writer.finish());
}

export function decodeRustIntegratedPlayerLocatorItemConsumeReceiptV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWX7_MAGIC, RECEIPT_SCHEMA.innerSchema));
  const value = Object.freeze({
    requestPayloadHash: bytesHash(reader.take(16)),
    purpose: readPurpose(reader),
    locatorResultHash: bytesHash(reader.take(16)),
    before: readGameplayIdentity(reader),
    after: readGameplayIdentity(reader),
    acceptedReceiptHash: bytesHash(reader.take(16)),
    inventory: readRustIntegratedContainerKeyV1(reader),
    selectedSlot: reader.u16(),
    previousInventoryRevision: reader.u64(),
    resultingInventoryRevision: reader.u64(),
    consumedStack: readRustIntegratedPlayerInventoryStackV1(reader),
    remainingStack: reader.option(() => readRustIntegratedPlayerInventoryStackV1(reader)),
    inventoryResultHash: bytesHash(reader.take(16)),
  });
  reader.finish();
  encodeRustIntegratedPlayerLocatorItemConsumeReceiptV1(value);
  return value;
}

export function planRustLiveLocatorItemConsumeV1(
  identity: RustIntegratedRuntimeIdentityV1,
  actorId: string,
  intent: RustIntegratedPlayerLocatorItemConsumeV1,
): RustLiveLocatorItemConsumePlanV1 {
  const request = decodeRustIntegratedPlayerLocatorItemConsumeV1(
    encodeRustIntegratedPlayerLocatorItemConsumeV1(intent),
  );
  if (request.inventory.ownerId !== actorId) {
    fail("locator-consume-actor", "locator inventory owner does not match the authoritative player actor");
  }
  const payload = encodeRustIntegratedPlayerLocatorItemConsumeV1(request);
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "gameplay",
    typeId: RUST_INTEGRATED_PLAYER_LOCATOR_ITEM_CONSUME_TYPE_V1,
    schema: REQUEST_SCHEMA.operationSchema,
    payload,
  });
  const key = `player-locator-item-consume:${operation.payloadHash}`;
  const expectedRemainingStack = request.expectedStack.count === 1
    ? null
    : Object.freeze({ ...request.expectedStack, count: request.expectedStack.count - 1 });
  return Object.freeze({
    batch: createRustIntegratedRuntimeCommandBatchV1({
      commandId: key,
      idempotencyKey: key,
      actorId,
      expected: identity,
      operations: Object.freeze([operation]),
    }),
    request,
    requestPayloadHash: operation.payloadHash,
    expectedRemainingStack,
    inventoryViewKey: rustIntegratedContainerViewKeyV1(request.inventory),
  });
}

function checkedSafeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("locator-consume-plan", `${label} is not a nonnegative safe integer`);
  }
  return value;
}

function checkedPlanIdentity(value: unknown): RustIntegratedRuntimeIdentityV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("locator-consume-plan", "durable locator plan identity is malformed");
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).sort().join(",") !== "locationId,revision,stateHash,tick,universeId"
    || typeof source.universeId !== "string" || source.universeId.length === 0
    || typeof source.locationId !== "string" || source.locationId.length === 0
    || source.revision === null || typeof source.revision !== "object" || Array.isArray(source.revision)) {
    return fail("locator-consume-plan", "durable locator plan identity fields are malformed");
  }
  const revision = source.revision as Record<string, unknown>;
  const expectedKeys = ["epoch", "world", "entities", "gameplay", "persistence", "network", "simulation"] as const;
  if (Object.keys(revision).sort().join(",") !== [...expectedKeys].sort().join(",")) {
    return fail("locator-consume-plan", "durable locator plan revision fields are not exact");
  }
  const result = Object.freeze({
    universeId: source.universeId,
    locationId: source.locationId,
    revision: Object.freeze(Object.fromEntries(expectedKeys.map((key) => [
      key,
      checkedSafeInteger(revision[key], `durable locator plan ${key} revision`),
    ])) as unknown as RustIntegratedRuntimeIdentityV1["revision"]),
    tick: checkedSafeInteger(source.tick, "durable locator plan tick"),
    stateHash: typeof source.stateHash === "string"
      ? checkedHash(source.stateHash, "durable locator plan state hash")
      : fail("locator-consume-plan", "durable locator plan state hash is malformed"),
  });
  return result;
}

function checkedPayloadHex(value: unknown) {
  if (typeof value !== "string" || value.length % 2 !== 0 || value.length === 0
    || value.length > MAX_PACKET_BYTES * 2 || !/^[0-9a-f]+$/u.test(value)) {
    return fail("locator-consume-plan", "durable locator plan payload is not bounded lowercase hex");
  }
  return value;
}

/** Exact, JSON-safe crash journal record. Rehydration derives and revalidates every command hash. */
export function rustLiveLocatorItemConsumePlanRecordV1(
  plan: RustLiveLocatorItemConsumePlanV1,
): RustLiveLocatorItemConsumePlanRecordV1 {
  const canonical = planRustLiveLocatorItemConsumeV1(
    plan.batch.expected,
    plan.batch.actorId,
    plan.request,
  );
  if (canonical.batch.commandHash !== plan.batch.commandHash
    || canonical.requestPayloadHash !== plan.requestPayloadHash) {
    fail("locator-consume-plan", "locator plan no longer derives its exact command hash");
  }
  return Object.freeze({
    schema: 1,
    actorId: canonical.batch.actorId,
    expected: canonical.batch.expected,
    requestPayloadHex: bytesHash(canonical.batch.operations[0].payload),
    requestPayloadHash: canonical.requestPayloadHash,
    commandHash: canonical.batch.commandHash,
  });
}

export function serializeRustLiveLocatorItemConsumePlanV1(plan: RustLiveLocatorItemConsumePlanV1) {
  return JSON.stringify(rustLiveLocatorItemConsumePlanRecordV1(plan));
}

export function rehydrateRustLiveLocatorItemConsumePlanV1(
  recordOrJson: RustLiveLocatorItemConsumePlanRecordV1 | string,
) {
  let parsed: unknown = recordOrJson;
  if (typeof recordOrJson === "string") {
    try { parsed = JSON.parse(recordOrJson); }
    catch { return fail("locator-consume-plan", "durable locator plan is not valid JSON"); }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("locator-consume-plan", "durable locator plan record is malformed");
  }
  const source = parsed as Record<string, unknown>;
  if (Object.keys(source).sort().join(",") !== "actorId,commandHash,expected,requestPayloadHash,requestPayloadHex,schema"
    || source.schema !== 1 || typeof source.actorId !== "string" || source.actorId.length === 0) {
    return fail("locator-consume-plan", "durable locator plan record fields are not exact");
  }
  const expected = checkedPlanIdentity(source.expected);
  const payloadHex = checkedPayloadHex(source.requestPayloadHex);
  const payload = Uint8Array.from({ length: payloadHex.length / 2 }, (_, index) =>
    Number.parseInt(payloadHex.slice(index * 2, index * 2 + 2), 16));
  const request = decodeRustIntegratedPlayerLocatorItemConsumeV1(payload);
  const plan = planRustLiveLocatorItemConsumeV1(expected, source.actorId, request);
  if (bytesHash(plan.batch.operations[0].payload) !== payloadHex
    || typeof source.requestPayloadHash !== "string"
    || checkedHash(source.requestPayloadHash, "durable locator request payload hash") !== plan.requestPayloadHash
    || typeof source.commandHash !== "string"
    || checkedHash(source.commandHash, "durable locator command hash") !== plan.batch.commandHash) {
    fail("locator-consume-plan", "durable locator plan did not rehydrate byte-for-byte with its exact hashes");
  }
  return plan;
}

function validateOuterReceiptHash(receipt: RustIntegratedRuntimeCommandReceiptV1) {
  const bytes: number[] = [...hashBytes(receipt.commandHash, "locator command hash")];
  if (receipt.status === "accepted") {
    bytes.push(...hashBytes(receipt.before.stateHash, "locator before state hash"));
    bytes.push(...hashBytes(receipt.after.stateHash, "locator after state hash"));
    for (const operation of receipt.domainReceipts) {
      bytes.push(...hashBytes(operation.payloadHash, "locator domain receipt payload hash"));
    }
  } else {
    bytes.push(...hashBytes(receipt.current.stateHash, "locator current state hash"));
    bytes.push(...encoder.encode(receipt.code), ...encoder.encode(receipt.message));
  }
  if (receipt.receiptHash !== rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes))) {
    fail("locator-consume-command-receipt", "locator command receipt hash is invalid");
  }
}

function validateOuterTransition(plan: RustLiveLocatorItemConsumePlanV1, receipt: RustIntegratedRuntimeAcceptedReceiptV1) {
  if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.before, plan.batch.expected)) {
    fail("locator-consume-command-receipt", "locator command before-identity does not match its request");
  }
  const keys = Object.keys(receipt.before.revision) as Array<keyof RustIntegratedRuntimeIdentityV1["revision"]>;
  for (const key of keys) {
    const expected = key === "gameplay" ? receipt.before.revision[key] + 1 : receipt.before.revision[key];
    if (receipt.after.revision[key] !== expected) {
      fail("locator-consume-command-receipt", "locator command changed an unexpected outer authority revision");
    }
  }
  if (receipt.after.tick !== receipt.before.tick || receipt.after.universeId !== receipt.before.universeId
    || receipt.after.locationId !== receipt.before.locationId || receipt.after.stateHash === receipt.before.stateHash) {
    fail("locator-consume-command-receipt", "locator command outer identity does not attest one same-tick gameplay mutation");
  }
}

function validateGameplayTransition(
  plan: RustLiveLocatorItemConsumePlanV1,
  before: RustIntegratedGameplayAuthorityIdentityV1,
  after: RustIntegratedGameplayAuthorityIdentityV1,
) {
  if (before.universe !== plan.batch.expected.universeId || before.location !== plan.batch.expected.locationId
    || after.universe !== before.universe || after.location !== before.location
    || after.revision.epoch !== before.revision.epoch
    || after.revision.sequence !== before.revision.sequence + BigInt(1)
    || after.revision.inventory !== before.revision.inventory + BigInt(1)
    || after.revision.machines !== before.revision.machines
    || after.revision.combat !== before.revision.combat
    || after.revision.progression !== before.revision.progression
    || after.revision.cardforge !== before.revision.cardforge
    || after.stateHash === before.stateHash) {
    fail("locator-consume-receipt", "BWX7 gameplay authority transition is discontinuous");
  }
}

export function validateRustLiveLocatorItemConsumeReceiptV1(
  plan: RustLiveLocatorItemConsumePlanV1,
  receipt: RustIntegratedRuntimeCommandReceiptV1,
): RustLiveLocatorItemConsumeValidatedReceiptV1 {
  if (receipt.commandId !== plan.batch.commandId || receipt.idempotencyKey !== plan.batch.idempotencyKey
    || receipt.commandHash !== plan.batch.commandHash) {
    fail("locator-consume-command-receipt", "locator command receipt does not identify the submitted batch");
  }
  validateOuterReceiptHash(receipt);
  if (receipt.status === "rejected") {
    if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.current, plan.batch.expected)) {
      fail("locator-consume-command-receipt", "rejected locator command moved the integrated runtime identity");
    }
    fail(receipt.code, receipt.message);
  }
  if (receipt.domainReceipts.length !== 1) {
    fail("locator-consume-command-receipt", "accepted locator command must contain exactly one domain receipt");
  }
  const operation = receipt.domainReceipts[0];
  if (operation.domain !== "gameplay"
    || operation.typeId !== RUST_INTEGRATED_PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_TYPE_V1
    || operation.schema !== RECEIPT_SCHEMA.operationSchema
    || operation.payloadHash !== rustIntegratedRuntimeWireChecksumV1(operation.payload)) {
    fail("locator-consume-command-receipt", "accepted locator command returned the wrong domain receipt");
  }
  const decoded = decodeRustIntegratedPlayerLocatorItemConsumeReceiptV1(operation.payload);
  const expectedConsumed = Object.freeze({ ...plan.request.expectedStack, count: 1 });
  if (decoded.requestPayloadHash !== plan.requestPayloadHash
    || decoded.purpose !== plan.request.purpose
    || decoded.locatorResultHash !== plan.request.locatorResultHash
    || !sameContainer(decoded.inventory, plan.request.inventory)
    || decoded.selectedSlot !== plan.request.selectedSlot
    || decoded.previousInventoryRevision !== plan.request.expectedInventoryRevision
    || decoded.resultingInventoryRevision !== plan.request.expectedInventoryRevision + BigInt(1)
    || !rustIntegratedPlayerInventoryStacksEqualV1(decoded.consumedStack, expectedConsumed)
    || !rustIntegratedPlayerInventoryStacksEqualV1(decoded.remainingStack, plan.expectedRemainingStack)) {
    fail("locator-consume-receipt", "BWX7 does not attest the exact locator-bound one-unit debit");
  }
  checkedNonzeroHash(decoded.acceptedReceiptHash, "accepted gameplay receipt hash");
  checkedNonzeroHash(decoded.inventoryResultHash, "inventory result hash");
  validateGameplayTransition(plan, decoded.before, decoded.after);
  validateOuterTransition(plan, receipt);
  return Object.freeze({ locator: decoded, outer: receipt, remainingStack: plan.expectedRemainingStack });
}

export function validateRustLiveLocatorItemConsumeAfterCommandV1(
  plan: RustLiveLocatorItemConsumePlanV1,
  validated: RustLiveLocatorItemConsumeValidatedReceiptV1,
  player: RustLivePlayerViewR10,
) {
  const held = player.held === null ? null : Object.freeze({
    itemCode: player.held.itemCode,
    count: player.held.count,
    durabilityMillionths: player.held.durabilityMillionths,
    metadataHash: bytesHash(player.held.metadataHash),
  });
  if (player.authorityTick !== BigInt(validated.outer.after.tick)
    || player.actorId !== plan.batch.actorId
    || player.inventoryContainer !== plan.inventoryViewKey
    || player.selectedSlot !== plan.request.selectedSlot
    || player.inventoryContainerRevision !== validated.locator.resultingInventoryRevision
    || !rustIntegratedPlayerInventoryStacksEqualV1(held, validated.remainingStack)) {
    fail("locator-consume-extraction", "post-command player row does not attest the exact BWX7 inventory debit");
  }
  return player;
}
