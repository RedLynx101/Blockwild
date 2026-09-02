import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec.ts";
import {
  RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES,
  RUST_RUNTIME_INPUT_FLAG_MASK_V1,
  RUST_RUNTIME_INPUT_FLAG_V1,
  rustIntegratedRuntimeIdentityEqualsV1,
  type RustIntegratedRuntimeAcceptedReceiptV1,
  type RustIntegratedRuntimeCommandBatchV1,
  type RustIntegratedRuntimeCommandReceiptV1,
  type RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract.ts";
import type { RustIntegratedPlayerBootstrapObservationV1 } from "./rust-integrated-runtime-player-bootstrap.ts";
import {
  RustIntegratedPlayerInventoryReaderV1,
  RustIntegratedPlayerInventoryWriterV1,
} from "./rust-integrated-runtime-player-inventory.ts";
import {
  RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1,
  rustIntegratedRuntimeDomainWireFamilyV1,
} from "./rust-integrated-runtime-domain-schema.generated.ts";

const BWM7_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("player-game-mode-set-v1");
const BWN7_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("player-game-mode-set-receipt-v1");

export const RUST_INTEGRATED_PLAYER_GAME_MODE_SET_TYPE_V1 = BWM7_SCHEMA.typeId;
export const RUST_INTEGRATED_PLAYER_GAME_MODE_SET_RECEIPT_TYPE_V1 = BWN7_SCHEMA.typeId;

const HEADER_BYTES = 28;
const HASH = /^[0-9a-f]{32}$/u;
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const MAX_SAFE_U64 = Number.MAX_SAFE_INTEGER;
const encoder = new TextEncoder();
const BWM7_MAGIC = encoder.encode(BWM7_SCHEMA.magic);
const BWN7_MAGIC = encoder.encode(BWN7_SCHEMA.magic);

export type RustIntegratedPlayerGameModeSetV1 = Readonly<{
  externalEntityId: string;
  actorId: string;
  playerId: bigint;
  expectedCreativeMode: boolean;
  expectedFlags: number;
  requestedCreativeMode: boolean;
}>;

export type RustIntegratedPlayerGameModeSetReceiptV1 = Readonly<{
  requestPayloadHash: string;
  before: RustIntegratedRuntimeIdentityV1;
  after: RustIntegratedRuntimeIdentityV1;
  externalEntityId: string;
  actorId: string;
  playerId: bigint;
  priorCreativeMode: boolean;
  priorFlags: number;
  resultingCreativeMode: boolean;
  resultingFlags: number;
  receiptHash: string;
}>;

export type RustLivePlayerGameModeSetPlanV1 = Readonly<{
  batch: RustIntegratedRuntimeCommandBatchV1;
  request: RustIntegratedPlayerGameModeSetV1;
  requestPayloadHash: string;
}>;

export type RustLivePlayerGameModeSetValidatedReceiptV1 = Readonly<{
  gameMode: RustIntegratedPlayerGameModeSetReceiptV1;
  outer: RustIntegratedRuntimeAcceptedReceiptV1;
}>;

export interface RustIntegratedPlayerGameModeSetServiceV1 {
  identity(): RustIntegratedRuntimeIdentityV1;
  command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1>;
}

export class RustIntegratedPlayerGameModeSetErrorV1 extends Error {
  readonly name = "RustIntegratedPlayerGameModeSetErrorV1";

  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedPlayerGameModeSetErrorV1(code, message);
}

function hash(value: string, label: string) {
  if (typeof value !== "string" || !HASH.test(value) || /^0{32}$/u.test(value)) {
    fail("player-game-mode-hash", `${label} is not a canonical nonzero hash`);
  }
  return value;
}

function hashBytes(value: string, label: string) {
  hash(value, label);
  return Uint8Array.from(
    { length: 16 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function bytesHash(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bool(value: boolean, label: string) {
  if (typeof value !== "boolean") fail("player-game-mode-flag", `${label} is not boolean`);
  return value;
}

function visibleString(value: string, label: string, maximumBytes = 512) {
  if (typeof value !== "string"
    || value.length === 0
    || encoder.encode(value).byteLength > maximumBytes
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || /[\ud800-\udfff]/u.test(value)) {
    fail("player-game-mode-identity", `${label} is not bounded visible UTF-8`);
  }
  return value;
}

function readBool(reader: RustIntegratedPlayerInventoryReaderV1, label: string) {
  const value = reader.u8();
  if (value > 1) fail("player-game-mode-flag", `${label} is not a canonical boolean`);
  return value === 1;
}

function flags(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > RUST_RUNTIME_INPUT_FLAG_MASK_V1
    || (value & RUST_RUNTIME_INPUT_FLAG_V1.flying) !== 0
      && ((value & RUST_RUNTIME_INPUT_FLAG_V1.creative) === 0
        || (value & RUST_RUNTIME_INPUT_FLAG_V1.mounted) !== 0)) {
    fail("player-game-mode-flags", `${label} contains unsupported or internally inconsistent authority flags`);
  }
  return value;
}

function u64(value: bigint, label: string, allowZero = false) {
  if (typeof value !== "bigint" || value < BigInt(allowZero ? 0 : 1) || value > U64_MAX) {
    fail("player-game-mode-u64", `${label} is outside its authoritative u64 range`);
  }
  return value;
}

function safeU64(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_U64) {
    fail("player-game-mode-identity", `${label} is outside the browser identity range`);
  }
  return value;
}

function validateModeFlags(creativeMode: boolean, authoritativeFlags: number, label: string) {
  bool(creativeMode, `${label} mode`);
  flags(authoritativeFlags, `${label} flags`);
  if (creativeMode !== ((authoritativeFlags & RUST_RUNTIME_INPUT_FLAG_V1.creative) !== 0)) {
    fail("player-game-mode-flags", `${label} mode and Creative authority flag disagree`);
  }
}

export function rustIntegratedPlayerGameModeResultFlagsV1(
  priorFlags: number,
  requestedCreativeMode: boolean,
) {
  flags(priorFlags, "prior flags");
  bool(requestedCreativeMode, "requested mode");
  return requestedCreativeMode
    ? priorFlags | RUST_RUNTIME_INPUT_FLAG_V1.creative
    : priorFlags & ~(RUST_RUNTIME_INPUT_FLAG_V1.creative | RUST_RUNTIME_INPUT_FLAG_V1.flying);
}

function writeIdentity(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: RustIntegratedRuntimeIdentityV1,
) {
  visibleString(value.universeId, "game-mode universe id", 64);
  visibleString(value.locationId, "game-mode location id", 128);
  hash(value.stateHash, "runtime identity state hash");
  writer.u16(2);
  writer.string(value.universeId, "game-mode universe id");
  writer.string(value.locationId, "game-mode location id");
  for (const revision of [
    value.revision.epoch,
    value.revision.world,
    value.revision.entities,
    value.revision.gameplay,
    value.revision.persistence,
    value.revision.network,
    value.revision.simulation,
  ]) {
    writer.u64(BigInt(safeU64(revision, "runtime identity revision")));
  }
  writer.u64(BigInt(safeU64(value.tick, "runtime identity tick")));
  writer.raw(hashBytes(value.stateHash, "runtime identity state hash"));
}

function readIdentity(reader: RustIntegratedPlayerInventoryReaderV1): RustIntegratedRuntimeIdentityV1 {
  if (reader.u16() !== 2) {
    fail("player-game-mode-identity", "BWN7 integrated runtime identity schema is not V2");
  }
  const number = (label: string) => {
    const value = reader.u64();
    if (value > BigInt(MAX_SAFE_U64)) {
      fail("player-game-mode-identity", `${label} exceeds the browser identity range`);
    }
    return Number(value);
  };
  return Object.freeze({
    universeId: reader.string("game-mode universe id"),
    locationId: reader.string("game-mode location id"),
    revision: Object.freeze({
      epoch: number("identity epoch"),
      world: number("world revision"),
      entities: number("entities revision"),
      gameplay: number("gameplay revision"),
      persistence: number("persistence revision"),
      network: number("network revision"),
      simulation: number("simulation revision"),
    }),
    tick: number("runtime identity tick"),
    stateHash: bytesHash(reader.take(16)),
  });
}

function wrap(magic: Uint8Array, schema: number, body: Uint8Array) {
  if (body.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES - HEADER_BYTES) {
    fail("player-game-mode-size", "player game-mode packet exceeds its domain byte budget");
  }
  const output = new Uint8Array(HEADER_BYTES + body.byteLength);
  const view = new DataView(output.buffer);
  output.set(magic);
  view.setUint16(4, RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1, true);
  view.setUint16(6, schema, true);
  view.setUint32(8, body.byteLength, true);
  output.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(body), "packet checksum"), 12);
  output.set(body, HEADER_BYTES);
  return output;
}

function unwrap(packet: Uint8Array, magic: Uint8Array, schema: number) {
  if (!(packet instanceof Uint8Array)
    || packet.byteLength < HEADER_BYTES
    || packet.byteLength > RUST_INTEGRATED_RUNTIME_MAX_DOMAIN_PAYLOAD_BYTES
    || !magic.every((byte, index) => packet[index] === byte)) {
    fail("player-game-mode-header", "player game-mode packet header is malformed");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint16(4, true) !== RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1
    || view.getUint16(6, true) !== schema
    || view.getUint32(8, true) !== packet.byteLength - HEADER_BYTES) {
    fail("player-game-mode-header", "player game-mode packet version or length is invalid");
  }
  const body = packet.subarray(HEADER_BYTES);
  if (bytesHash(packet.subarray(12, HEADER_BYTES)) !== rustIntegratedRuntimeWireChecksumV1(body)) {
    fail("player-game-mode-checksum", "player game-mode packet checksum is invalid");
  }
  return body;
}

function validateRequest(value: RustIntegratedPlayerGameModeSetV1) {
  visibleString(value.externalEntityId, "external entity id");
  visibleString(value.actorId, "actor id");
  u64(value.playerId, "player id");
  validateModeFlags(value.expectedCreativeMode, value.expectedFlags, "expected");
  bool(value.requestedCreativeMode, "requested mode");
  if (value.expectedCreativeMode === value.requestedCreativeMode) {
    fail("player-game-mode-noop", "player game-mode CAS must change the restored mode");
  }
}

export function encodeRustIntegratedPlayerGameModeSetV1(value: RustIntegratedPlayerGameModeSetV1) {
  validateRequest(value);
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writer.string(value.externalEntityId, "external entity id");
  writer.string(value.actorId, "actor id");
  writer.u64(value.playerId);
  writer.u8(value.expectedCreativeMode ? 1 : 0);
  writer.u8(value.expectedFlags);
  writer.u8(value.requestedCreativeMode ? 1 : 0);
  return wrap(BWM7_MAGIC, BWM7_SCHEMA.innerSchema, writer.finish());
}

export function decodeRustIntegratedPlayerGameModeSetV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWM7_MAGIC, BWM7_SCHEMA.innerSchema));
  const value = Object.freeze({
    externalEntityId: reader.string("external entity id"),
    actorId: reader.string("actor id"),
    playerId: reader.u64(),
    expectedCreativeMode: readBool(reader, "expected mode"),
    expectedFlags: reader.u8(),
    requestedCreativeMode: readBool(reader, "requested mode"),
  });
  reader.finish();
  validateRequest(value);
  return value;
}

function writeReceiptContents(
  writer: RustIntegratedPlayerInventoryWriterV1,
  value: Omit<RustIntegratedPlayerGameModeSetReceiptV1, "receiptHash">
    | RustIntegratedPlayerGameModeSetReceiptV1,
) {
  writer.raw(hashBytes(value.requestPayloadHash, "request payload hash"));
  writeIdentity(writer, value.before);
  writeIdentity(writer, value.after);
  writer.string(value.externalEntityId, "external entity id");
  writer.string(value.actorId, "actor id");
  writer.u64(value.playerId);
  writer.u8(value.priorCreativeMode ? 1 : 0);
  writer.u8(value.priorFlags);
  writer.u8(value.resultingCreativeMode ? 1 : 0);
  writer.u8(value.resultingFlags);
}

export function rustIntegratedPlayerGameModeSetReceiptHashV1(
  value: Omit<RustIntegratedPlayerGameModeSetReceiptV1, "receiptHash">
    | RustIntegratedPlayerGameModeSetReceiptV1,
) {
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeReceiptContents(writer, value);
  return rustIntegratedRuntimeWireChecksumV1(writer.finish());
}

function validateReceiptContents(value: RustIntegratedPlayerGameModeSetReceiptV1) {
  hash(value.requestPayloadHash, "request payload hash");
  visibleString(value.externalEntityId, "external entity id");
  visibleString(value.actorId, "actor id");
  u64(value.playerId, "player id");
  validateModeFlags(value.priorCreativeMode, value.priorFlags, "prior");
  validateModeFlags(value.resultingCreativeMode, value.resultingFlags, "resulting");
  if (value.resultingFlags !== rustIntegratedPlayerGameModeResultFlagsV1(
    value.priorFlags,
    value.resultingCreativeMode,
  )) {
    fail("player-game-mode-receipt", "BWN7 resulting flags do not follow the exact mode-transition policy");
  }
  if (value.priorCreativeMode === value.resultingCreativeMode) {
    fail("player-game-mode-receipt", "BWN7 does not attest a game-mode change");
  }
  const canonicalRequest = encodeRustIntegratedPlayerGameModeSetV1(Object.freeze({
    externalEntityId: value.externalEntityId,
    actorId: value.actorId,
    playerId: value.playerId,
    expectedCreativeMode: value.priorCreativeMode,
    expectedFlags: value.priorFlags,
    requestedCreativeMode: value.resultingCreativeMode,
  }));
  if (rustIntegratedRuntimeWireChecksumV1(canonicalRequest) !== value.requestPayloadHash) {
    fail("player-game-mode-request-hash", "BWN7 request hash does not identify its canonical BWM7 request");
  }
  validateSimulationTransition(value.before, value.after);
  if (rustIntegratedPlayerGameModeSetReceiptHashV1(value) !== hash(value.receiptHash, "receipt hash")) {
    fail("player-game-mode-receipt-hash", "BWN7 receipt hash does not seal its canonical contents");
  }
}

export function encodeRustIntegratedPlayerGameModeSetReceiptV1(
  value: RustIntegratedPlayerGameModeSetReceiptV1,
) {
  validateReceiptContents(value);
  const writer = new RustIntegratedPlayerInventoryWriterV1();
  writeReceiptContents(writer, value);
  writer.raw(hashBytes(value.receiptHash, "receipt hash"));
  return wrap(BWN7_MAGIC, BWN7_SCHEMA.innerSchema, writer.finish());
}

export function decodeRustIntegratedPlayerGameModeSetReceiptV1(packet: Uint8Array) {
  const reader = new RustIntegratedPlayerInventoryReaderV1(unwrap(packet, BWN7_MAGIC, BWN7_SCHEMA.innerSchema));
  const value = Object.freeze({
    requestPayloadHash: bytesHash(reader.take(16)),
    before: readIdentity(reader),
    after: readIdentity(reader),
    externalEntityId: reader.string("external entity id"),
    actorId: reader.string("actor id"),
    playerId: reader.u64(),
    priorCreativeMode: readBool(reader, "prior mode"),
    priorFlags: reader.u8(),
    resultingCreativeMode: readBool(reader, "resulting mode"),
    resultingFlags: reader.u8(),
    receiptHash: bytesHash(reader.take(16)),
  });
  reader.finish();
  validateReceiptContents(value);
  return value;
}

export function planRustLivePlayerGameModeSetV1(
  identity: RustIntegratedRuntimeIdentityV1,
  intent: RustIntegratedPlayerGameModeSetV1,
): RustLivePlayerGameModeSetPlanV1 {
  const request = decodeRustIntegratedPlayerGameModeSetV1(
    encodeRustIntegratedPlayerGameModeSetV1(intent),
  );
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: RUST_INTEGRATED_PLAYER_GAME_MODE_SET_TYPE_V1,
    schema: BWM7_SCHEMA.operationSchema,
    payload: encodeRustIntegratedPlayerGameModeSetV1(request),
  });
  const expectedStateHash = hash(identity.stateHash, "expected identity state hash");
  const key = `player-game-mode-set:${expectedStateHash}:${operation.payloadHash}`;
  return Object.freeze({
    batch: createRustIntegratedRuntimeCommandBatchV1({
      commandId: key,
      idempotencyKey: key,
      actorId: request.actorId,
      expected: identity,
      operations: Object.freeze([operation]),
    }),
    request,
    requestPayloadHash: operation.payloadHash,
  });
}

function validateOuterReceiptHash(receipt: RustIntegratedRuntimeCommandReceiptV1) {
  const bytes = [...hashBytes(receipt.commandHash, "command hash")];
  if (receipt.status === "accepted") {
    bytes.push(
      ...hashBytes(receipt.before.stateHash, "before state hash"),
      ...hashBytes(receipt.after.stateHash, "after state hash"),
    );
    for (const operation of receipt.domainReceipts) {
      bytes.push(...hashBytes(operation.payloadHash, "domain receipt hash"));
    }
  } else {
    bytes.push(
      ...hashBytes(receipt.current.stateHash, "current state hash"),
      ...encoder.encode(receipt.code),
      ...encoder.encode(receipt.message),
    );
  }
  if (receipt.receiptHash !== rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes))) {
    fail("player-game-mode-command-receipt", "player game-mode command receipt hash is invalid");
  }
}

function validateSimulationTransition(
  before: RustIntegratedRuntimeIdentityV1,
  after: RustIntegratedRuntimeIdentityV1,
) {
  visibleString(before.universeId, "before universe id", 64);
  visibleString(before.locationId, "before location id", 128);
  visibleString(after.universeId, "after universe id", 64);
  visibleString(after.locationId, "after location id", 128);
  hash(before.stateHash, "before state hash");
  hash(after.stateHash, "after state hash");
  const keys = Object.keys(before.revision) as Array<keyof RustIntegratedRuntimeIdentityV1["revision"]>;
  if (after.universeId !== before.universeId
    || after.locationId !== before.locationId
    || after.tick !== before.tick
    || keys.some((key) => after.revision[key] !== before.revision[key] + (key === "simulation" ? 1 : 0))
    || after.stateHash === before.stateHash) {
    fail("player-game-mode-receipt", "BWN7 transition is not exactly one simulation authority mutation");
  }
}

export function validateRustLivePlayerGameModeSetReceiptV1(
  plan: RustLivePlayerGameModeSetPlanV1,
  receipt: RustIntegratedRuntimeCommandReceiptV1,
): RustLivePlayerGameModeSetValidatedReceiptV1 {
  if (receipt.commandId !== plan.batch.commandId
    || receipt.idempotencyKey !== plan.batch.idempotencyKey
    || receipt.commandHash !== plan.batch.commandHash) {
    fail("player-game-mode-command-receipt", "player game-mode receipt does not identify the submitted batch");
  }
  validateOuterReceiptHash(receipt);
  if (receipt.status === "rejected") {
    if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.current, plan.batch.expected)) {
      fail("player-game-mode-command-receipt", "rejected player game-mode command moved runtime identity");
    }
    fail(receipt.code, receipt.message);
  }
  if (receipt.domainReceipts.length !== 1) {
    fail("player-game-mode-command-receipt", "accepted player game-mode command requires one domain receipt");
  }
  const operation = receipt.domainReceipts[0];
  if (!operation
    || operation.domain !== "simulation"
    || operation.typeId !== RUST_INTEGRATED_PLAYER_GAME_MODE_SET_RECEIPT_TYPE_V1
    || operation.schema !== BWN7_SCHEMA.operationSchema
    || operation.payloadHash !== rustIntegratedRuntimeWireChecksumV1(operation.payload)) {
    fail("player-game-mode-command-receipt", "accepted player game-mode command returned the wrong domain receipt");
  }
  const decoded = decodeRustIntegratedPlayerGameModeSetReceiptV1(operation.payload);
  const expectedResultFlags = rustIntegratedPlayerGameModeResultFlagsV1(
    plan.request.expectedFlags,
    plan.request.requestedCreativeMode,
  );
  if (decoded.requestPayloadHash !== plan.requestPayloadHash
    || decoded.externalEntityId !== plan.request.externalEntityId
    || decoded.actorId !== plan.request.actorId
    || decoded.playerId !== plan.request.playerId
    || decoded.priorCreativeMode !== plan.request.expectedCreativeMode
    || decoded.priorFlags !== plan.request.expectedFlags
    || decoded.resultingCreativeMode !== plan.request.requestedCreativeMode
    || decoded.resultingFlags !== expectedResultFlags) {
    fail("player-game-mode-receipt", "BWN7 does not attest the exact restored-player mode CAS");
  }
  if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.before, plan.batch.expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(decoded.before, receipt.before)
    || !rustIntegratedRuntimeIdentityEqualsV1(decoded.after, receipt.after)) {
    fail("player-game-mode-command-receipt", "BWN7 identities do not bind the submitted command receipt");
  }
  validateSimulationTransition(receipt.before, receipt.after);
  return Object.freeze({ gameMode: decoded, outer: receipt });
}

function validateObservationState(
  plan: RustLivePlayerGameModeSetPlanV1,
  validated: RustLivePlayerGameModeSetValidatedReceiptV1,
  observation: RustIntegratedPlayerBootstrapObservationV1,
  expectedIdentity: RustIntegratedRuntimeIdentityV1,
) {
  const runtimePlayer = observation.runtimePlayer;
  const entity = observation.entity;
  if (!rustIntegratedRuntimeIdentityEqualsV1(observation.identity, expectedIdentity)
    || !runtimePlayer
    || !entity
    || runtimePlayer.entityId !== entity.entityId
    || runtimePlayer.binding.externalEntityId !== plan.request.externalEntityId
    || runtimePlayer.binding.actorId !== plan.request.actorId
    || runtimePlayer.binding.playerId !== plan.request.playerId
    || runtimePlayer.binding.creativeMode !== validated.gameMode.resultingCreativeMode
    || observation.continuity.authoritativeFlags !== validated.gameMode.resultingFlags) {
    fail("player-game-mode-readback", "native player status does not attest the exact BWN7 mode result");
  }
  return observation;
}

export function validateRustLivePlayerGameModeSetAfterCommandV1(
  plan: RustLivePlayerGameModeSetPlanV1,
  validated: RustLivePlayerGameModeSetValidatedReceiptV1,
  observation: RustIntegratedPlayerBootstrapObservationV1,
) {
  return validateObservationState(plan, validated, observation, validated.outer.after);
}

export function validateRustLivePlayerGameModeSetRestoredStateV1(
  plan: RustLivePlayerGameModeSetPlanV1,
  validated: RustLivePlayerGameModeSetValidatedReceiptV1,
  observation: RustIntegratedPlayerBootstrapObservationV1,
  expectedIdentity: RustIntegratedRuntimeIdentityV1,
) {
  return validateObservationState(plan, validated, observation, expectedIdentity);
}

export async function executeRustLivePlayerGameModeSetV1(
  service: RustIntegratedPlayerGameModeSetServiceV1,
  intent: RustIntegratedPlayerGameModeSetV1,
) {
  const plan = planRustLivePlayerGameModeSetV1(service.identity(), intent);
  const receipt = await service.command(plan.batch);
  const validated = validateRustLivePlayerGameModeSetReceiptV1(plan, receipt);
  if (!rustIntegratedRuntimeIdentityEqualsV1(service.identity(), validated.outer.after)) {
    fail("player-game-mode-command-receipt", "runtime service did not adopt the accepted BWN7 successor");
  }
  return Object.freeze({ plan, validated });
}
