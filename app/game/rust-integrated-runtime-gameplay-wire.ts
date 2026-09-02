/** Native R7 BWK7/BWG7/BWA7 codecs. These are distinct from the older structured browser contract.
 * BWG7 exposes every native generic gameplay command; dedicated-only creative commands fail closed.
 * BWA7 supports both outcomes and every event/resource/stat field without interpreting opaque events.
 */
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated";
import { createRustIntegratedDomainWireDescriptorV1, unwrapRustIntegratedDomainPacketV1, wrapRustIntegratedDomainPacketV1 } from "./rust-integrated-runtime-domain-wire";
import {
  RustIntegratedPlayerInventoryReaderV1 as Reader,
  RustIntegratedPlayerInventoryWriterV1 as Writer,
  type RustIntegratedGameplayAuthorityIdentityV1 as Identity,
} from "./rust-integrated-runtime-player-inventory";
import {
  readRustIntegratedGameplayCommandV1, writeRustIntegratedGameplayCommandV1, rustIntegratedGameplayCommandHashV1,
  type RustIntegratedGameplayCommandV1, type RustIntegratedGameplayScheduleCommandV1,
} from "./rust-integrated-gameplay-command-wire";
export { rustIntegratedGameplayCommandHashV1 } from "./rust-integrated-gameplay-command-wire";
export type { RustIntegratedGameplayCommandV1, RustIntegratedGameplayScheduleCommandV1, RustIntegratedGameplayInventoryCommandV1, RustIntegratedGameplayMachineCommandV1, RustIntegratedGameplayCombatCommandV1, RustIntegratedGameplayProgressionCommandV1, RustIntegratedGameplayCardforgeCommandV1 } from "./rust-integrated-gameplay-command-wire";

const GRANT = rustIntegratedRuntimeDomainWireFamilyV1("gameplay-actor-grant-v1");
const ACK = rustIntegratedRuntimeDomainWireFamilyV1("gameplay-actor-grant-receipt-v1");
const COMMAND = rustIntegratedRuntimeDomainWireFamilyV1("gameplay-command-v1");
const RECEIPT = rustIntegratedRuntimeDomainWireFamilyV1("gameplay-receipt-v1");
const descriptor = (family: typeof GRANT | typeof COMMAND | typeof RECEIPT) => createRustIntegratedDomainWireDescriptorV1({
  magic: family.magic, schema: family.innerSchema, label: family.typeId,
});
const GRANT_WIRE = descriptor(GRANT);
const COMMAND_WIRE = descriptor(COMMAND);
const RECEIPT_WIRE = descriptor(RECEIPT);
const ROLES = ["host", "guest", "agent", "system"] as const;
const SCOPES = ["inventory-self", "inventory-any", "machines", "combat-self", "combat-any", "progression-self", "progression-any", "cardforge-self", "cardforge-any", "system"] as const;
const DOMAINS = ["inventory", "machines", "combat", "progression", "cardforge"] as const;
const REJECTIONS = ["wrong-world", "stale-revision", "duplicate", "unauthorized", "invalid-command", "insufficient-resource", "invalid-target", "cooldown", "rules-rejected", "capacity", "conflict"] as const;
const REVISION_FIELDS = ["sequence", "inventory", "machines", "combat", "progression", "cardforge"] as const;
const MAX_COLLECTION = 65_536;
const MAX_PAYLOAD = 256 * 1024;

export type RustIntegratedGameplayActorV1 = Readonly<{
  actorId: string; playerId: bigint | null; entityId: bigint | null; role: typeof ROLES[number];
}>;
export type RustIntegratedGameplayActorGrantV1 = RustIntegratedGameplayActorV1 & Readonly<{ scopes: readonly typeof SCOPES[number][] }>;
export type RustIntegratedGameplayActorGrantReceiptV1 = Readonly<{ requestPayloadHash: string; resultingStateHash: string }>;
export type RustIntegratedGameplayBatchWireV1 = Readonly<{
  batchId: string; idempotencyKey: string; actor: RustIntegratedGameplayActorV1; identity: Identity;
  commands: readonly RustIntegratedGameplayCommandV1[]; commandHash: string;
}>;
export type RustIntegratedGameplayScheduleBatchWireV1 = Omit<RustIntegratedGameplayBatchWireV1, "commands"> & Readonly<{ commands: readonly RustIntegratedGameplayScheduleCommandV1[] }>;
export type RustIntegratedGameplayResourceDeltaV1 = Readonly<{ itemCode: number; metadataHash: string; amount: bigint; reason: string }>;
export type RustIntegratedGameplayStatDeltaV1 = Readonly<{ recordId: string; statId: string; amount: bigint }>;
export type RustIntegratedGameplayEventV1 = Readonly<{
  eventId: string; kind: string; actorId: string; recordId: string | null;
  payload: Readonly<{ typeId: string; schema: number; bytes: Uint8Array }>;
}>;
export type RustIntegratedGameplayAcceptedReceiptV1 = Readonly<{
  status: "accepted"; batchId: string; before: Identity; after: Identity;
  touchedDomains: readonly typeof DOMAINS[number][]; resourceDeltas: readonly RustIntegratedGameplayResourceDeltaV1[];
  statDeltas: readonly RustIntegratedGameplayStatDeltaV1[]; events: readonly RustIntegratedGameplayEventV1[]; receiptHash: string;
}>;
export type RustIntegratedGameplayReceiptWireV1 = RustIntegratedGameplayAcceptedReceiptV1 | Readonly<{
  status: "rejected"; batchId: string; identity: Identity; code: typeof REJECTIONS[number]; message: string;
}>;

function fail(code: string, message: string): never { throw new Error(`gameplay-wire-${code}: ${message}`); }
function hashBytes(value: string) {
  if (!/^[0-9a-f]{32}$/u.test(value)) fail("hash", "expected a canonical 128-bit hash");
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}
function readHash(reader: Reader) { return [...reader.take(16)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function tag<T extends string>(values: readonly T[], value: T) { const index = values.indexOf(value); if (index < 0) fail("tag", "unknown enum value"); return index; }
function readTag<T extends string>(reader: Reader, values: readonly T[]): T { const value = values[reader.u8()]; if (value === undefined) fail("tag", "unknown enum tag"); return value; }
function count(reader: Reader, maximum: number) { const value = reader.u32(); if (value > maximum) fail("count", `collection exceeds ${maximum}`); return value; }
function writeCount(writer: Writer, value: number, maximum: number) { if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail("count", `collection exceeds ${maximum}`); writer.u32(value); }
function orderedTags<T extends string>(values: readonly T[], selected: readonly T[]) {
  let previous = -1;
  for (const value of selected) { const index = tag(values, value); if (index <= previous) fail("set", "set members must be unique and canonically ordered"); previous = index; }
}
function writeActor(writer: Writer, value: RustIntegratedGameplayActorV1) {
  writer.string(value.actorId); writer.option(value.playerId, (id) => writer.u64(id));
  writer.option(value.entityId, (id) => writer.u64(id)); writer.u8(tag(ROLES, value.role));
}
function readActor(reader: Reader): RustIntegratedGameplayActorV1 {
  // Native optional actor IDs preserve Some(0), unlike mandatory linked-combat entity IDs.
  return { actorId: reader.string(), playerId: reader.option(() => reader.u64()), entityId: reader.option(() => reader.u64()), role: readTag(reader, ROLES) };
}
function writeIdentity(writer: Writer, value: Identity) {
  writer.string(value.universe); writer.string(value.location); writer.u32(value.revision.epoch);
  for (const field of REVISION_FIELDS) writer.u64(value.revision[field]);
  writer.raw(hashBytes(value.stateHash));
}
function readIdentity(reader: Reader): Identity {
  return { universe: reader.string(), location: reader.string(), revision: {
    epoch: reader.u32(), sequence: reader.u64(), inventory: reader.u64(), machines: reader.u64(), combat: reader.u64(), progression: reader.u64(), cardforge: reader.u64(),
  }, stateHash: readHash(reader) };
}
function writeI64(writer: Writer, value: bigint) {
  if (typeof value !== "bigint" || value < -(BigInt(1) << BigInt(63)) || value >= (BigInt(1) << BigInt(63))) fail("i64", "signed delta exceeds i64");
  writer.u64(BigInt.asUintN(64, value));
}
function readI64(reader: Reader) { return BigInt.asIntN(64, reader.u64()); }

export function encodeRustIntegratedGameplayActorGrantV1(value: RustIntegratedGameplayActorGrantV1) {
  orderedTags(SCOPES, value.scopes);
  const writer = new Writer(); writeActor(writer, value); writeCount(writer, value.scopes.length, 16);
  for (const scope of value.scopes) writer.u8(tag(SCOPES, scope));
  return wrapRustIntegratedDomainPacketV1(GRANT_WIRE, writer.finish(), fail);
}
export function decodeRustIntegratedGameplayActorGrantV1(packet: Uint8Array): RustIntegratedGameplayActorGrantV1 {
  const reader = new Reader(unwrapRustIntegratedDomainPacketV1(GRANT_WIRE, packet, fail));
  const value = { ...readActor(reader), scopes: Array.from({ length: count(reader, 16) }, () => readTag(reader, SCOPES)) };
  reader.finish(); orderedTags(SCOPES, value.scopes); return value;
}

/** Compact BWK7 acknowledgement has no self-checksum: bind both expected hashes at the call site. */
export function encodeRustIntegratedGameplayActorGrantReceiptV1(value: RustIntegratedGameplayActorGrantReceiptV1) {
  const writer = new Writer(); writer.raw(new TextEncoder().encode(ACK.magic)); writer.u16(ACK.innerSchema);
  writer.raw(hashBytes(value.requestPayloadHash)); writer.raw(hashBytes(value.resultingStateHash)); return writer.finish();
}
export function decodeRustIntegratedGameplayActorGrantReceiptV1(packet: Uint8Array, expectedRequestHash?: string, expectedStateHash?: string): RustIntegratedGameplayActorGrantReceiptV1 {
  if (!(packet instanceof Uint8Array) || packet.length !== 38) fail("ack-size", "grant acknowledgement must be exactly 38 bytes");
  const reader = new Reader(packet);
  if (new TextDecoder().decode(reader.take(4)) !== ACK.magic || reader.u16() !== ACK.innerSchema) fail("ack-schema", "grant acknowledgement schema mismatch");
  const value = { requestPayloadHash: readHash(reader), resultingStateHash: readHash(reader) }; reader.finish();
  if (expectedRequestHash !== undefined && value.requestPayloadHash !== expectedRequestHash) fail("ack-request", "grant request hash mismatch");
  if (expectedStateHash !== undefined && value.resultingStateHash !== expectedStateHash) fail("ack-state", "grant resulting state hash mismatch");
  return value;
}

export function rustIntegratedGameplayScheduleCommandHashV1(commands: readonly RustIntegratedGameplayScheduleCommandV1[]) {
  scheduleCommands(commands);
  return rustIntegratedGameplayCommandHashV1(commands);
}
/** Full BWG7 encoder. Successful encoding is not GameplayAuthority acceptance. */
export function encodeRustIntegratedGameplayBatchWireV1(value: RustIntegratedGameplayBatchWireV1) {
  if (value.commandHash !== rustIntegratedGameplayCommandHashV1(value.commands)) fail("command-hash", "command hash mismatch");
  const writer = new Writer(); writer.string(value.batchId); writer.string(value.idempotencyKey);
  writeActor(writer, value.actor); writeIdentity(writer, value.identity); writeCount(writer, value.commands.length, 256);
  for (const command of value.commands) writeRustIntegratedGameplayCommandV1(writer, command);
  writer.raw(hashBytes(value.commandHash)); return wrapRustIntegratedDomainPacketV1(COMMAND_WIRE, writer.finish(), fail);
}
export function decodeRustIntegratedGameplayBatchWireV1(packet: Uint8Array): RustIntegratedGameplayBatchWireV1 {
  const reader = new Reader(unwrapRustIntegratedDomainPacketV1(COMMAND_WIRE, packet, fail));
  const batchId = reader.string(); const idempotencyKey = reader.string(); const actor = readActor(reader); const identity = readIdentity(reader);
  const commands = Array.from({ length: count(reader, 256) }, () => readRustIntegratedGameplayCommandV1(reader));
  const commandHash = readHash(reader); reader.finish();
  if (commandHash !== rustIntegratedGameplayCommandHashV1(commands)) fail("command-hash", "command hash mismatch");
  return { batchId, idempotencyKey, actor, identity, commands, commandHash };
}
function scheduleCommands(commands: readonly RustIntegratedGameplayCommandV1[]): asserts commands is readonly RustIntegratedGameplayScheduleCommandV1[] {
  for (const command of commands) {
    if (command.kind !== "advance-schedule") fail("unsupported-command", "schedule-only codec requires advance-schedule commands");
    if (!Number.isInteger(command.machineBudget) || command.machineBudget < 0 || command.machineBudget > 64) fail("schedule-budget", "machine budget exceeds 64");
  }
}
/** Backward-compatible schedule-only wrapper; rejects every non-schedule command. */
export function encodeRustIntegratedGameplayScheduleBatchWireV1(value: RustIntegratedGameplayScheduleBatchWireV1) {
  scheduleCommands(value.commands); return encodeRustIntegratedGameplayBatchWireV1(value);
}
/** Backward-compatible restricted decoder. Use the generic decoder for full BWG7. */
export function decodeRustIntegratedGameplayScheduleBatchWireV1(packet: Uint8Array): RustIntegratedGameplayScheduleBatchWireV1 {
  const value = decodeRustIntegratedGameplayBatchWireV1(packet); const commands = value.commands;
  scheduleCommands(commands); return { ...value, commands };
}

export function rustIntegratedGameplayReceiptHashV1(value: Omit<RustIntegratedGameplayAcceptedReceiptV1, "receiptHash">) {
  orderedTags(DOMAINS, value.touchedDomains);
  const h = new TypeScriptCanonicalHasher("blockwild.gameplay.receipt.v1").writeString(value.batchId)
    .writeBytes(hashBytes(value.before.stateHash)).writeBytes(hashBytes(value.after.stateHash));
  for (const domain of value.touchedDomains) h.writeU16(tag(DOMAINS, domain));
  for (const delta of value.resourceDeltas) h.writeU32(delta.itemCode).writeBytes(hashBytes(delta.metadataHash)).writeU64(BigInt.asUintN(64, delta.amount)).writeString(delta.reason);
  for (const delta of value.statDeltas) h.writeString(delta.recordId).writeString(delta.statId).writeU64(BigInt.asUintN(64, delta.amount));
  for (const event of value.events) {
    h.writeString(event.eventId).writeString(event.kind).writeString(event.actorId).writeU16(event.recordId === null ? 0 : 1);
    if (event.recordId !== null) h.writeString(event.recordId);
    h.writeString(event.payload.typeId).writeU16(event.payload.schema).writeBytes(event.payload.bytes);
  }
  return h.finishHex();
}
export function encodeRustIntegratedGameplayReceiptWireV1(value: RustIntegratedGameplayReceiptWireV1) {
  const writer = new Writer(); writer.u8(value.status === "accepted" ? 1 : 0); writer.string(value.batchId);
  if (value.status === "rejected") {
    writeIdentity(writer, value.identity); writer.u8(tag(REJECTIONS, value.code)); writer.string(value.message);
  } else {
    if (value.receiptHash !== rustIntegratedGameplayReceiptHashV1(value)) fail("receipt-hash", "canonical receipt hash mismatch");
    writeIdentity(writer, value.before); writeIdentity(writer, value.after);
    writeCount(writer, value.touchedDomains.length, 5); for (const domain of value.touchedDomains) writer.u8(tag(DOMAINS, domain));
    writeCount(writer, value.resourceDeltas.length, MAX_COLLECTION);
    for (const delta of value.resourceDeltas) { writer.u32(delta.itemCode); writer.raw(hashBytes(delta.metadataHash)); writeI64(writer, delta.amount); writer.string(delta.reason); }
    writeCount(writer, value.statDeltas.length, MAX_COLLECTION);
    for (const delta of value.statDeltas) { writer.string(delta.recordId); writer.string(delta.statId); writeI64(writer, delta.amount); }
    writeCount(writer, value.events.length, MAX_COLLECTION);
    for (const event of value.events) {
      writer.string(event.eventId); writer.string(event.kind); writer.string(event.actorId); writer.option(event.recordId, (record) => writer.string(record));
      writer.string(event.payload.typeId); writer.u16(event.payload.schema); writer.bytes(event.payload.bytes, MAX_PAYLOAD);
    }
    writer.raw(hashBytes(value.receiptHash));
  }
  return wrapRustIntegratedDomainPacketV1(RECEIPT_WIRE, writer.finish(), fail);
}
export function decodeRustIntegratedGameplayReceiptWireV1(packet: Uint8Array): RustIntegratedGameplayReceiptWireV1 {
  const reader = new Reader(unwrapRustIntegratedDomainPacketV1(RECEIPT_WIRE, packet, fail));
  const outcome = reader.u8(); const batchId = reader.string();
  if (outcome === 0) {
    const value = { status: "rejected" as const, batchId, identity: readIdentity(reader), code: readTag(reader, REJECTIONS), message: reader.string() };
    reader.finish(); return value;
  }
  if (outcome !== 1) fail("outcome", "unknown gameplay receipt outcome");
  const before = readIdentity(reader); const after = readIdentity(reader);
  const touchedDomains = Array.from({ length: count(reader, 5) }, () => readTag(reader, DOMAINS));
  const resourceDeltas = Array.from({ length: count(reader, MAX_COLLECTION) }, () => ({ itemCode: reader.u32(), metadataHash: readHash(reader), amount: readI64(reader), reason: reader.string() }));
  const statDeltas = Array.from({ length: count(reader, MAX_COLLECTION) }, () => ({ recordId: reader.string(), statId: reader.string(), amount: readI64(reader) }));
  const events = Array.from({ length: count(reader, MAX_COLLECTION) }, () => ({
    eventId: reader.string(), kind: reader.string(), actorId: reader.string(), recordId: reader.option(() => reader.string()),
    payload: { typeId: reader.string(), schema: reader.u16(), bytes: Uint8Array.from(reader.bytes(MAX_PAYLOAD)) },
  }));
  const receiptHash = readHash(reader); reader.finish();
  const value = { status: "accepted" as const, batchId, before, after, touchedDomains, resourceDeltas, statDeltas, events, receiptHash };
  if (receiptHash !== rustIntegratedGameplayReceiptHashV1(value)) fail("receipt-hash", "canonical receipt hash mismatch");
  return value;
}
