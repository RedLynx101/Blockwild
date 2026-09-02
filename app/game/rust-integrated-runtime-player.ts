import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec";
import {
  RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1,
  rustIntegratedRuntimeDomainWireFamilyV1,
} from "./rust-integrated-runtime-domain-schema.generated";
import { RustIntegratedRuntimeServiceV1 } from "./rust-integrated-runtime-service";

const BIND_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("simulation-player-bind-v2");
const BIND_RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("simulation-player-bind-receipt-v2");

export const RUST_INTEGRATED_PLAYER_BIND_TYPE_V2 = BIND_SCHEMA.typeId;
export const RUST_INTEGRATED_PLAYER_BIND_RECEIPT_TYPE_V2 = BIND_RECEIPT_SCHEMA.typeId;

const HEADER_BYTES = 28;
const MAX_U64 = (BigInt(1) << BigInt(64)) - BigInt(1);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const MAGIC = textEncoder.encode(BIND_SCHEMA.magic);

export type RustIntegratedPlayerBindingV1 = Readonly<{
  externalEntityId: string;
  actorId: string;
  playerId: bigint;
  creativeMode: boolean;
  radius: number;
  standingHeight: number;
  crouchingHeight: number;
  mass: number;
  walkSpeed: number;
  sprintSpeed: number;
  creativeFlightSpeed: number;
  maximumOxygenSeconds: number;
}>;

export class RustIntegratedPlayerContractError extends Error {
  readonly name = "RustIntegratedPlayerContractError";

  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function validate(value: RustIntegratedPlayerBindingV1) {
  const identity = value.externalEntityId;
  const malformed = (candidate: unknown) => typeof candidate !== "string"
    || candidate.length === 0
    || textEncoder.encode(candidate).byteLength > 512
    || /[\u0000-\u001f\u007f-\u009f]/u.test(candidate)
    || /[\ud800-\udfff]/u.test(candidate);
  const values = [
    value.radius,
    value.standingHeight,
    value.crouchingHeight,
    value.mass,
    value.walkSpeed,
    value.sprintSpeed,
    value.creativeFlightSpeed,
    value.maximumOxygenSeconds,
  ];
  if (malformed(identity)
    || malformed(value.actorId)
    || typeof value.playerId !== "bigint"
    || value.playerId < BigInt(1)
    || value.playerId > MAX_U64
    || typeof value.creativeMode !== "boolean"
    || values.some((number) => !Number.isFinite(number) || number <= 0)
    || value.radius < 0.1 || value.radius > 4
    || value.standingHeight < 0.5 || value.standingHeight > 8
    || value.crouchingHeight > value.standingHeight
    || value.mass < 0.1 || value.mass > 100_000
    || value.walkSpeed < 0.1 || value.walkSpeed > 128
    || value.sprintSpeed < value.walkSpeed || value.sprintSpeed > 192
    || value.creativeFlightSpeed < 0.1 || value.creativeFlightSpeed > 256
    || value.maximumOxygenSeconds > 3_600) {
    throw new RustIntegratedPlayerContractError("player-binding", "player binding contains an invalid identity or physical profile");
  }
}

function checksumBytes(bytes: Uint8Array) {
  const hash = rustIntegratedRuntimeWireChecksumV1(bytes);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16));
}

export function encodeRustIntegratedPlayerBindingV1(value: RustIntegratedPlayerBindingV1) {
  validate(value);
  const identity = textEncoder.encode(value.externalEntityId);
  const actor = textEncoder.encode(value.actorId);
  const body = new Uint8Array(4 + identity.byteLength + 4 + actor.byteLength + 8 + 1 + 8 * 8);
  const view = new DataView(body.buffer);
  view.setUint32(0, identity.byteLength, true);
  body.set(identity, 4);
  let offset = 4 + identity.byteLength;
  view.setUint32(offset, actor.byteLength, true);
  offset += 4;
  body.set(actor, offset);
  offset += actor.byteLength;
  view.setBigUint64(offset, value.playerId, true);
  offset += 8;
  view.setUint8(offset, value.creativeMode ? 1 : 0);
  offset += 1;
  for (const number of [
    value.radius,
    value.standingHeight,
    value.crouchingHeight,
    value.mass,
    value.walkSpeed,
    value.sprintSpeed,
    value.creativeFlightSpeed,
    value.maximumOxygenSeconds,
  ]) {
    view.setFloat64(offset, number, true);
    offset += 8;
  }
  const packet = new Uint8Array(HEADER_BYTES + body.byteLength);
  const header = new DataView(packet.buffer);
  packet.set(MAGIC, 0);
  header.setUint16(4, RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1, true);
  header.setUint16(6, BIND_SCHEMA.innerSchema, true);
  header.setUint32(8, body.byteLength, true);
  packet.set(checksumBytes(body), 12);
  packet.set(body, HEADER_BYTES);
  return packet;
}

export function decodeRustIntegratedPlayerBindingV1(packet: Uint8Array): RustIntegratedPlayerBindingV1 {
  if (!(packet instanceof Uint8Array) || packet.byteLength < HEADER_BYTES || !MAGIC.every((byte, index) => packet[index] === byte)) {
    throw new RustIntegratedPlayerContractError("player-binding", "player binding packet header is malformed");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const length = view.getUint32(8, true);
  if (view.getUint16(4, true) !== RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_VERSION_V1
    || view.getUint16(6, true) !== BIND_SCHEMA.innerSchema
    || length !== packet.byteLength - HEADER_BYTES) {
    throw new RustIntegratedPlayerContractError("player-binding", "player binding packet version or length is invalid");
  }
  const body = packet.subarray(HEADER_BYTES);
  if (!checksumBytes(body).every((byte, index) => packet[12 + index] === byte)) {
    throw new RustIntegratedPlayerContractError("player-binding", "player binding packet checksum is invalid");
  }
  const bodyView = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const identityLength = bodyView.getUint32(0, true);
  if (identityLength === 0 || 4 + identityLength + 4 + 8 + 1 + 64 > body.byteLength) {
    throw new RustIntegratedPlayerContractError("player-binding", "player binding body is truncated or has trailing bytes");
  }
  let offset = 4 + identityLength;
  const actorLength = bodyView.getUint32(offset, true);
  offset += 4;
  if (actorLength === 0 || offset + actorLength + 8 + 1 + 64 !== body.byteLength) {
    throw new RustIntegratedPlayerContractError("player-binding", "player binding authority identity is truncated or has trailing bytes");
  }
  let actorId: string;
  try {
    actorId = textDecoder.decode(body.subarray(offset, offset + actorLength));
  } catch {
    throw new RustIntegratedPlayerContractError("player-binding", "player binding actor identity is not UTF-8");
  }
  offset += actorLength;
  const playerId = bodyView.getBigUint64(offset, true);
  offset += 8;
  const creativeFlag = bodyView.getUint8(offset);
  if (creativeFlag > 1) throw new RustIntegratedPlayerContractError("player-binding", "creative mode flag is not boolean");
  const creativeMode = creativeFlag === 1;
  offset += 1;
  const numbers = Array.from({ length: 8 }, () => {
    const number = bodyView.getFloat64(offset, true);
    offset += 8;
    return number;
  });
  let externalEntityId: string;
  try {
    externalEntityId = textDecoder.decode(body.subarray(4, 4 + identityLength));
  } catch {
    throw new RustIntegratedPlayerContractError("player-binding", "player binding identity is not UTF-8");
  }
  const value = Object.freeze({
    externalEntityId,
    actorId,
    playerId,
    creativeMode,
    radius: numbers[0],
    standingHeight: numbers[1],
    crouchingHeight: numbers[2],
    mass: numbers[3],
    walkSpeed: numbers[4],
    sprintSpeed: numbers[5],
    creativeFlightSpeed: numbers[6],
    maximumOxygenSeconds: numbers[7],
  });
  validate(value);
  return value;
}

/** Coarse awaited installation into the sole Rust runtime. */
export class RustIntegratedPlayerRuntimePortV1 {
  private serial = Promise.resolve<unknown>(undefined);

  constructor(
    private readonly runtime: RustIntegratedRuntimeServiceV1,
    private readonly actorId = "platform:player",
  ) {}

  bind(binding: RustIntegratedPlayerBindingV1) {
    const payload = encodeRustIntegratedPlayerBindingV1(binding);
    const payloadHash = rustIntegratedRuntimeWireChecksumV1(payload);
    const operation = () => this.runtime.command(createRustIntegratedRuntimeCommandBatchV1({
      commandId: `player-bind:${binding.externalEntityId}:${payloadHash}`,
      idempotencyKey: `player-bind:${binding.externalEntityId}:${payloadHash}`,
      actorId: this.actorId,
      expected: this.runtime.identity(),
      operations: [createRustIntegratedRuntimeDomainOperationV1({
        domain: "simulation",
        typeId: RUST_INTEGRATED_PLAYER_BIND_TYPE_V2,
        schema: BIND_SCHEMA.operationSchema,
        payload,
      })],
    })).then((receipt) => {
      if (receipt.status === "rejected") throw new RustIntegratedPlayerContractError(receipt.code, receipt.message);
      const response = receipt.domainReceipts[0];
      if (receipt.domainReceipts.length !== 1
        || response.domain !== "simulation"
        || response.typeId !== RUST_INTEGRATED_PLAYER_BIND_RECEIPT_TYPE_V2
        || response.schema !== BIND_RECEIPT_SCHEMA.operationSchema) {
        throw new RustIntegratedPlayerContractError("player-binding-receipt", "player binding returned an unexpected native receipt");
      }
    });
    const next = this.serial.then(operation, operation);
    this.serial = next.then(() => undefined, () => undefined);
    return next;
  }
}
