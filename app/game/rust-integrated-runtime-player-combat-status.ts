import { rustIntegratedRuntimeWireChecksumV1 } from "./rust-integrated-runtime-codec";
import { RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES } from "./rust-integrated-runtime-contract";
import {
  RustIntegratedPlayerInventoryReaderV1,
  RustIntegratedPlayerInventoryWriterV1,
} from "./rust-integrated-runtime-player-inventory";

export const RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1 =
  "blockwild.simulation.player-combat-bootstrap-status.r7.v1";
export const RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1 =
  "blockwild.simulation.player-combat-bootstrap-status-receipt.r7.v1";

const BWS7_MAGIC = Uint8Array.of(0x42, 0x57, 0x53, 0x37);
const BWO7_MAGIC = Uint8Array.of(0x42, 0x57, 0x4f, 0x37);
const HEADER_BYTES = 28;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

export type RustIntegratedPlayerCombatBootstrapStatusV1 =
  | "absent"
  | "legacy-unlinked"
  | "exact-linked"
  | "blocked";

export type RustIntegratedPlayerCombatBootstrapBlockerV1 =
  | "legacy-unlinked-requires-explicit-migration"
  | "duplicate-combat-claim"
  | "missing-player-entity"
  | "incomplete-player-binding"
  | "record-identity-conflict"
  | "entity-link-conflict"
  | "owner-conflict"
  | "vital-unit-conflict"
  | "vital-parity-conflict"
  | "invalid-entity-vitals";

export type RustIntegratedPlayerCombatantBootstrapAttestationV1 = Readonly<{
  recordId: string;
  ownerId: string | null;
  revision: bigint;
  entityId: bigint | null;
  vitalUnits: "legacy-whole-hearts-v1" | "millihearts-v1";
  health: number;
  maxHealth: number;
  alive: boolean;
  crossDomainParity: boolean;
}>;

export type RustIntegratedPlayerCombatBootstrapStatusQueryV1 = Readonly<{
  externalEntityId: string;
  actorId: string;
  playerId: bigint;
}>;

export type RustIntegratedPlayerCombatBootstrapStatusReceiptV1 = Readonly<{
  requestPayloadHash: string;
  entityAuthorityRevision: bigint;
  gameplaySequence: bigint;
  gameplayCombatRevision: bigint;
  gameplayStateHash: string;
  status: RustIntegratedPlayerCombatBootstrapStatusV1;
  blocker: RustIntegratedPlayerCombatBootstrapBlockerV1 | null;
  combatant: RustIntegratedPlayerCombatantBootstrapAttestationV1 | null;
}>;

export class RustIntegratedPlayerCombatStatusWireErrorV1 extends Error {
  readonly name = "RustIntegratedPlayerCombatStatusWireErrorV1";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedPlayerCombatStatusWireErrorV1(code, message);
}

function checkedHash(value: string, label: string) {
  if (!/^[0-9a-f]{32}$/u.test(value)) {
    fail("player-combat-status-hash", `${label} is not a canonical 128-bit hash`);
  }
  return value;
}

function hashBytes(value: string, label: string) {
  checkedHash(value, label);
  return Uint8Array.from(
    { length: 16 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function bytesHash(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function wrap(magic: Uint8Array, body: Uint8Array) {
  if (body.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES - HEADER_BYTES) {
    fail("player-combat-status-size", "player combat status packet exceeds its byte budget");
  }
  const packet = new Uint8Array(HEADER_BYTES + body.byteLength);
  const view = new DataView(packet.buffer);
  packet.set(magic);
  view.setUint16(4, 1, true);
  view.setUint16(6, 1, true);
  view.setUint32(8, body.byteLength, true);
  packet.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(body), "combat status checksum"), 12);
  packet.set(body, HEADER_BYTES);
  return packet;
}

function unwrap(packet: Uint8Array, magic: Uint8Array) {
  if (!(packet instanceof Uint8Array)
    || packet.byteLength < HEADER_BYTES
    || packet.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES
    || !magic.every((byte, index) => packet[index] === byte)) {
    fail("player-combat-status-header", "player combat status packet header is malformed");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint16(4, true) !== 1
    || view.getUint16(6, true) !== 1
    || view.getUint32(8, true) !== packet.byteLength - HEADER_BYTES) {
    fail("player-combat-status-header", "player combat status packet version or length is invalid");
  }
  const body = packet.subarray(HEADER_BYTES);
  if (bytesHash(packet.subarray(12, 28)) !== rustIntegratedRuntimeWireChecksumV1(body)) {
    fail("player-combat-status-checksum", "player combat status packet checksum is invalid");
  }
  return body;
}

function bool(reader: RustIntegratedPlayerInventoryReaderV1) {
  const value = reader.u8();
  if (value > 1) fail("player-combat-status-flag", "player combat status flag is not boolean");
  return value === 1;
}

const STATUS_TAGS = Object.freeze([
  "absent",
  "legacy-unlinked",
  "exact-linked",
  "blocked",
] as const);

const BLOCKER_TAGS = Object.freeze([
  null,
  "legacy-unlinked-requires-explicit-migration",
  "duplicate-combat-claim",
  "missing-player-entity",
  "incomplete-player-binding",
  "record-identity-conflict",
  "entity-link-conflict",
  "owner-conflict",
  "vital-unit-conflict",
  "vital-parity-conflict",
  "invalid-entity-vitals",
] as const);

function statusTag(value: RustIntegratedPlayerCombatBootstrapStatusV1) {
  const tag = STATUS_TAGS.indexOf(value);
  if (tag < 0) fail("player-combat-status", "unknown player combat bootstrap status");
  return tag;
}

function blockerTag(value: RustIntegratedPlayerCombatBootstrapBlockerV1) {
  const tag = BLOCKER_TAGS.indexOf(value);
  if (tag < 1) fail("player-combat-status", "unknown player combat bootstrap blocker");
  return tag;
}

function validateCombatant(value: RustIntegratedPlayerCombatantBootstrapAttestationV1) {
  if (value.entityId !== null && (value.entityId <= BigInt(0) || value.entityId > U64_MAX)) {
    fail("player-combat-status-entity", "combatant entity id is outside its native range");
  }
  if (!Number.isInteger(value.health)
    || !Number.isInteger(value.maxHealth)
    || value.health < 0
    || value.health > 0xffff_ffff
    || value.maxHealth <= 0
    || value.maxHealth > 0xffff_ffff
    || value.health > value.maxHealth) {
    fail("player-combat-status-vitals", "combatant vitals are outside their native bounds");
  }
  if ((value.vitalUnits !== "legacy-whole-hearts-v1" || value.entityId !== null)
    && value.alive !== (value.health > 0)) {
    fail("player-combat-status-vitals", "linked or precision combatant alive state disagrees with health");
  }
  if (value.crossDomainParity
    && (value.entityId === null || value.vitalUnits !== "millihearts-v1")) {
    fail("player-combat-status-parity", "cross-domain parity requires a linked milliheart record");
  }
}

function validateStatus(value: RustIntegratedPlayerCombatBootstrapStatusReceiptV1) {
  checkedHash(value.requestPayloadHash, "request payload hash");
  checkedHash(value.gameplayStateHash, "gameplay state hash");
  if (value.status === "absent") {
    if (value.blocker !== null || value.combatant !== null) fail("player-combat-status", "absent status carries combat data");
  } else if (value.status === "legacy-unlinked") {
    if (value.blocker !== "legacy-unlinked-requires-explicit-migration"
      || value.combatant === null
      || value.combatant.entityId !== null
      || value.combatant.vitalUnits !== "legacy-whole-hearts-v1"
      || value.combatant.crossDomainParity) {
      fail("player-combat-status", "legacy-unlinked status is inconsistent");
    }
  } else if (value.status === "exact-linked") {
    if (value.blocker !== null
      || value.combatant === null
      || value.combatant.entityId === null
      || value.combatant.vitalUnits !== "millihearts-v1"
      || !value.combatant.crossDomainParity) {
      fail("player-combat-status", "exact-linked status is inconsistent");
    }
  } else if (value.status === "blocked") {
    if (value.blocker === null) fail("player-combat-status", "blocked status has no deterministic blocker");
  } else {
    fail("player-combat-status", "unknown player combat bootstrap status");
  }
  if (value.combatant !== null) validateCombatant(value.combatant);
}

export function encodeRustIntegratedPlayerCombatBootstrapStatusQueryV1(
  value: RustIntegratedPlayerCombatBootstrapStatusQueryV1,
) {
  if (value.playerId <= BigInt(0) || value.playerId > U64_MAX) {
    fail("player-combat-status-player", "player id is outside its native range");
  }
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writer.string(value.externalEntityId, "external entity id");
  writer.string(value.actorId, "actor id");
  writer.u64(value.playerId);
  return wrap(BWS7_MAGIC, writer.finish());
}

export function decodeRustIntegratedPlayerCombatBootstrapStatusQueryV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWS7_MAGIC));
  const value = Object.freeze({
    externalEntityId: reader.string("external entity id"),
    actorId: reader.string("actor id"),
    playerId: reader.u64(),
  });
  reader.finish();
  encodeRustIntegratedPlayerCombatBootstrapStatusQueryV1(value);
  return value;
}

export function encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(
  value: RustIntegratedPlayerCombatBootstrapStatusReceiptV1,
) {
  validateStatus(value);
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writer.raw(hashBytes(value.requestPayloadHash, "request payload hash"));
  writer.u64(value.entityAuthorityRevision);
  writer.u64(value.gameplaySequence);
  writer.u64(value.gameplayCombatRevision);
  writer.raw(hashBytes(value.gameplayStateHash, "gameplay state hash"));
  writer.u8(statusTag(value.status));
  writer.option(value.blocker, (blocker) => writer.u8(blockerTag(blocker)));
  writer.option(value.combatant, (combatant) => {
    writer.string(combatant.recordId, "combat record id");
    writer.option(combatant.ownerId, (ownerId) => writer.string(ownerId, "combat owner id"));
    writer.u64(combatant.revision);
    writer.option(combatant.entityId, (entityId) => writer.u64(entityId));
    writer.u8(combatant.vitalUnits === "legacy-whole-hearts-v1" ? 0 : 1);
    writer.u32(combatant.health);
    writer.u32(combatant.maxHealth);
    writer.u8(combatant.alive ? 1 : 0);
    writer.u8(combatant.crossDomainParity ? 1 : 0);
  });
  return wrap(BWO7_MAGIC, writer.finish());
}

export function decodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(
  packet: Uint8Array,
  expectedRequestPayloadHash?: string,
) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWO7_MAGIC));
  const requestPayloadHash = bytesHash(reader.take(16));
  if (expectedRequestPayloadHash !== undefined
    && requestPayloadHash !== checkedHash(expectedRequestPayloadHash, "expected request payload hash")) {
    fail("player-combat-status-request", "BWO7 does not attest the exact BWS7 request");
  }
  const entityAuthorityRevision = reader.u64();
  const gameplaySequence = reader.u64();
  const gameplayCombatRevision = reader.u64();
  const gameplayStateHash = bytesHash(reader.take(16));
  const status = STATUS_TAGS[reader.u8()];
  if (status === undefined) fail("player-combat-status", "unknown player combat bootstrap status");
  const blocker = reader.option(() => {
    const value = BLOCKER_TAGS[reader.u8()];
    if (value === undefined || value === null) fail("player-combat-status", "unknown player combat bootstrap blocker");
    return value;
  });
  const combatant = reader.option(() => {
    const recordId = reader.string("combat record id");
    const ownerId = reader.option(() => reader.string("combat owner id"));
    const revision = reader.u64();
    const entityId = reader.option(() => reader.u64());
    const unitTag = reader.u8();
    const vitalUnits = unitTag === 0
      ? "legacy-whole-hearts-v1" as const
      : unitTag === 1
        ? "millihearts-v1" as const
        : fail("player-combat-status", "unknown combat vital unit");
    return Object.freeze({
      recordId,
      ownerId,
      revision,
      entityId,
      vitalUnits,
      health: reader.u32(),
      maxHealth: reader.u32(),
      alive: bool(reader),
      crossDomainParity: bool(reader),
    });
  });
  reader.finish();
  const value = Object.freeze({
    requestPayloadHash,
    entityAuthorityRevision,
    gameplaySequence,
    gameplayCombatRevision,
    gameplayStateHash,
    status,
    blocker,
    combatant,
  });
  validateStatus(value);
  return value;
}
