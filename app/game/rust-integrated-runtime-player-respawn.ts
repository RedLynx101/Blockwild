import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "./rust-integrated-runtime-codec.ts";
import {
  rustIntegratedRuntimeIdentityEqualsV1,
  type RustIntegratedRuntimeAcceptedReceiptV1,
  type RustIntegratedRuntimeCommandBatchV1,
  type RustIntegratedRuntimeCommandReceiptV1,
  type RustIntegratedRuntimeIdentityV1,
} from "./rust-integrated-runtime-contract.ts";
import {
  RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1,
  createRustIntegratedDomainWireDescriptorV1,
  unwrapRustIntegratedDomainPacketV1,
  wrapRustIntegratedDomainPacketV1,
  type RustIntegratedDomainWireFailureV1,
} from "./rust-integrated-runtime-domain-wire.ts";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated.ts";

const BWD7_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("player-respawn-v1");
const BWE7_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("player-respawn-receipt-v1");

export const RUST_INTEGRATED_PLAYER_RESPAWN_TYPE_V1 = BWD7_SCHEMA.typeId;
export const RUST_INTEGRATED_PLAYER_RESPAWN_RECEIPT_TYPE_V1 = BWE7_SCHEMA.typeId;

/** BWD7/BWE7 V1 accepts both retained-custody and atomic death-drop respawns. */
export const RUST_INTEGRATED_PLAYER_RESPAWN_POLICY_SUPPORT_V1 = Object.freeze({
  keepInventory: "accepted" as const,
  releaseInventory: "accepted" as const,
});

const BWD7_WIRE = createRustIntegratedDomainWireDescriptorV1({
  magic: BWD7_SCHEMA.magic,
  schema: BWD7_SCHEMA.innerSchema,
  label: "player respawn",
});
const BWE7_WIRE = createRustIntegratedDomainWireDescriptorV1({
  magic: BWE7_SCHEMA.magic,
  schema: BWE7_SCHEMA.innerSchema,
  label: "player respawn receipt",
});
const MAX_STRING_BYTES = 16 * 1024;
const MAX_CUSTODY_DROPS = 17;
const MAX_POSITION_MILLI = 33_554_432_000;
const HASH = /^[0-9a-f]{32}$/u;
const ZERO_HASH = "0".repeat(32);
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const MAX_SAFE_U64 = BigInt(Number.MAX_SAFE_INTEGER);
const U32_MAX = 0xffff_ffff;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type RustIntegratedFixedWorldVec3V1 = Readonly<{
  xMilli: number;
  yMilli: number;
  zMilli: number;
}>;

export type RustIntegratedPlayerRespawnV1 = Readonly<{
  expected: RustIntegratedRuntimeIdentityV1;
  externalEntityId: string;
  actorId: string;
  playerId: bigint;
  entityId: bigint;
  expectedEntityRevision: bigint;
  expectedGameplaySequence: bigint;
  expectedGameplayCombatRevision: bigint;
  expectedCombatantRevision: bigint;
  expectedDeathSequence: bigint;
  expectedMaxHealth: number;
  respawnPosition: RustIntegratedFixedWorldVec3V1;
  keepInventory: boolean;
}>;

export type RustIntegratedPlayerRespawnReceiptV1 = Readonly<{
  requestPayloadHash: string;
  before: RustIntegratedRuntimeIdentityV1;
  after: RustIntegratedRuntimeIdentityV1;
  externalEntityId: string;
  actorId: string;
  playerId: bigint;
  entityId: bigint;
  deathSequence: bigint;
  priorEntityRevision: bigint;
  resultingEntityRevision: bigint;
  priorGameplaySequence: bigint;
  resultingGameplaySequence: bigint;
  priorGameplayCombatRevision: bigint;
  resultingGameplayCombatRevision: bigint;
  priorCombatantRevision: bigint;
  resultingCombatantRevision: bigint;
  maximumHealth: number;
  priorHealth: number;
  resultingHealth: number;
  priorAlive: boolean;
  resultingAlive: boolean;
  respawnPosition: RustIntegratedFixedWorldVec3V1;
  resultingOxygenSeconds: number;
  keepInventory: boolean;
  inventoryBeforeRevision: bigint;
  inventoryAfterRevision: bigint;
  equipmentBeforeRevision: bigint;
  equipmentAfterRevision: bigint;
  custodyBeforeHash: string;
  custodyAfterHash: string;
  generatedDropCount: number;
  receiptHash: string;
}>;

/**
 * Fields that the durable native false-policy parent and BWE7 command receipt
 * both attest. Their receipt hashes are intentionally absent: the parent hash
 * seals native world/drop provenance, while the BWE7 hash seals its wire
 * receipt and integrated before/after identities. Those are separate domains.
 */
export type RustIntegratedPlayerRespawnParentEvidenceV1 = Readonly<{
  playerId: bigint;
  entityId: bigint;
  deathSequence: bigint;
  inventoryBeforeRevision: bigint;
  inventoryAfterRevision: bigint;
  equipmentBeforeRevision: bigint;
  equipmentAfterRevision: bigint;
  custodyAfterHash: string;
  generatedDropCount: number;
  drops: readonly unknown[];
}>;

export function rustIntegratedPlayerRespawnParentAttestsReceiptV1(
  parent: RustIntegratedPlayerRespawnParentEvidenceV1,
  receipt: RustIntegratedPlayerRespawnReceiptV1,
) {
  return !receipt.keepInventory
    && parent.playerId === receipt.playerId
    && parent.entityId === receipt.entityId
    && parent.deathSequence === receipt.deathSequence
    && parent.inventoryBeforeRevision === receipt.inventoryBeforeRevision
    && parent.inventoryAfterRevision === receipt.inventoryAfterRevision
    && parent.equipmentBeforeRevision === receipt.equipmentBeforeRevision
    && parent.equipmentAfterRevision === receipt.equipmentAfterRevision
    && parent.custodyAfterHash === receipt.custodyAfterHash
    && parent.generatedDropCount === receipt.generatedDropCount
    && parent.drops.length === receipt.generatedDropCount;
}

export type RustLivePlayerRespawnPlanV1 = Readonly<{
  batch: RustIntegratedRuntimeCommandBatchV1;
  request: RustIntegratedPlayerRespawnV1;
  requestPayloadHash: string;
  runtimePolicySupport: "accepted";
}>;

export type RustLivePlayerRespawnValidatedReceiptV1 = Readonly<{
  respawn: RustIntegratedPlayerRespawnReceiptV1;
  outer: RustIntegratedRuntimeAcceptedReceiptV1;
}>;

/**
 * JSON-safe exact command record for caller-retained same-byte retries. The
 * production service does not yet expose post-crash respawn receipt recovery.
 */
export type RustLivePlayerRespawnPlanRecordV1 = Readonly<{
  schema: 1;
  requestPayloadHex: string;
  requestPayloadHash: string;
  commandHash: string;
}>;

/**
 * Adapter-neutral post-command proof. Browser extraction/status wiring can
 * populate this later without weakening the wire/receipt boundary here.
 */
export type RustLivePlayerRespawnReadbackV1 = Readonly<{
  identity: RustIntegratedRuntimeIdentityV1;
  externalEntityId: string;
  actorId: string;
  playerId: bigint;
  entityId: bigint;
  entityRevision: bigint;
  gameplaySequence: bigint;
  gameplayCombatRevision: bigint;
  combatantRevision: bigint;
  deathSequence: bigint;
  lastRespawnSequence: bigint;
  health: number;
  maximumHealth: number;
  alive: boolean;
  position: RustIntegratedFixedWorldVec3V1;
  velocityMilliPerSecond: RustIntegratedFixedWorldVec3V1;
  oxygenSeconds: number;
  grounded: boolean;
  crouching: boolean;
  fallDistanceMilli: number;
  drowningAccumulatorMilli: number;
  buttons: number;
  flags: number;
  contactFlags: number;
  queuedInputsEmpty: boolean;
  pendingContextCommandsEmpty: boolean;
  pendingMovementResultEmpty: boolean;
  miningStateEmpty: boolean;
  inventoryRevision: bigint;
  equipmentRevision: bigint;
  custodyHash: string;
  projectedDropCount: number;
}>;

export interface RustIntegratedPlayerRespawnServiceV1 {
  identity(): RustIntegratedRuntimeIdentityV1;
  command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1>;
}

export class RustIntegratedPlayerRespawnErrorV1 extends Error {
  readonly name = "RustIntegratedPlayerRespawnErrorV1";

  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedPlayerRespawnErrorV1(code, message);
}

const failDomainWire: RustIntegratedDomainWireFailureV1 = (code, message) =>
  fail(`player-respawn-${code}`, message);

function integer(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("player-respawn-integer", `${label} is outside its canonical integer range`);
  }
  return value;
}

function boolean(value: boolean, label: string) {
  if (typeof value !== "boolean") {
    fail("player-respawn-flag", `${label} is not a canonical boolean`);
  }
  return value;
}

function visibleString(value: string, label: string, maximumBytes = MAX_STRING_BYTES) {
  if (typeof value !== "string"
    || value.length === 0
    || encoder.encode(value).byteLength > maximumBytes
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || /[\ud800-\udfff]/u.test(value)) {
    fail("player-respawn-identity", `${label} is not bounded visible UTF-8`);
  }
  return value;
}

function hash(value: string, label: string) {
  if (typeof value !== "string" || !HASH.test(value) || value === ZERO_HASH) {
    fail("player-respawn-hash", `${label} is not a canonical nonzero hash`);
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
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function nativeU64(value: bigint, label: string, allowZero = false) {
  if (typeof value !== "bigint" || value < BigInt(allowZero ? 0 : 1) || value > U64_MAX) {
    fail("player-respawn-u64", `${label} is outside its native u64 range`);
  }
  return value;
}

function safeCursor(value: bigint, label: string, allowZero = true) {
  nativeU64(value, label, allowZero);
  if (value > MAX_SAFE_U64) {
    fail("player-respawn-u64", `${label} exceeds the JavaScript-safe authority range`);
  }
  return value;
}

function safeIdentityInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("player-respawn-identity", `${label} exceeds the JavaScript-safe identity range`);
  }
  return value;
}

function fixedPosition(value: RustIntegratedFixedWorldVec3V1, label: string) {
  if (value === null || typeof value !== "object") {
    fail("player-respawn-position", `${label} is missing`);
  }
  for (const [axis, coordinate] of Object.entries(value)) {
    if (!Number.isSafeInteger(coordinate) || Math.abs(coordinate) > MAX_POSITION_MILLI) {
      fail("player-respawn-position", `${label} ${axis} exceeds the native fixed-point world bounds`);
    }
  }
  return value;
}

function samePosition(left: RustIntegratedFixedWorldVec3V1, right: RustIntegratedFixedWorldVec3V1) {
  return left.xMilli === right.xMilli
    && left.yMilli === right.yMilli
    && left.zMilli === right.zMilli;
}

class Writer {
  private readonly output: number[] = [];

  private view(bytes: number, write: (view: DataView) => void) {
    const buffer = new ArrayBuffer(bytes);
    const view = new DataView(buffer);
    write(view);
    this.raw(new Uint8Array(buffer));
  }

  u8(value: number) { this.output.push(integer(value, 0, 0xff, "u8")); }
  u16(value: number) { this.view(2, (view) => view.setUint16(0, integer(value, 0, 0xffff, "u16"), true)); }
  u32(value: number) { this.view(4, (view) => view.setUint32(0, integer(value, 0, U32_MAX, "u32"), true)); }
  u64(value: bigint) { this.view(8, (view) => view.setBigUint64(0, nativeU64(value, "u64", true), true)); }
  i64(value: number) {
    if (!Number.isSafeInteger(value)) fail("player-respawn-integer", "i64 is outside the browser-safe range");
    this.view(8, (view) => view.setBigInt64(0, BigInt(value), true));
  }
  f64(value: number) { this.view(8, (view) => view.setFloat64(0, value, true)); }
  raw(value: Uint8Array) { this.output.push(...value); }
  string(value: string, label: string) {
    const bytes = encoder.encode(visibleString(value, label));
    this.u32(bytes.byteLength);
    this.raw(bytes);
  }
  finish() { return Uint8Array.from(this.output); }
}

class Reader {
  private offset = 0;

  constructor(private readonly input: Uint8Array) {}

  take(length: number) {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.input.byteLength) {
      fail("player-respawn-truncated", "native player respawn payload is truncated");
    }
    const value = this.input.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  private view(length: number) {
    const bytes = this.take(length);
    return new DataView(bytes.buffer, bytes.byteOffset, length);
  }

  u8() { return this.take(1)[0]!; }
  u16() { return this.view(2).getUint16(0, true); }
  u32() { return this.view(4).getUint32(0, true); }
  u64() { return this.view(8).getBigUint64(0, true); }
  i64() {
    const value = this.view(8).getBigInt64(0, true);
    if (value < -MAX_SAFE_U64 || value > MAX_SAFE_U64) {
      fail("player-respawn-position", "native fixed-point coordinate exceeds the browser-safe range");
    }
    return Number(value);
  }
  f64() { return this.view(8).getFloat64(0, true); }
  flag(label: string) {
    const value = this.u8();
    if (value > 1) fail("player-respawn-flag", `${label} is not a canonical boolean`);
    return value === 1;
  }
  string(label: string) {
    const length = this.u32();
    if (length > MAX_STRING_BYTES) fail("player-respawn-size", `${label} exceeds its UTF-8 byte bound`);
    let value: string;
    try { value = decoder.decode(this.take(length)); }
    catch { return fail("player-respawn-utf8", `${label} is not canonical UTF-8`); }
    return visibleString(value, label);
  }
  finish() {
    if (this.offset !== this.input.byteLength) {
      fail("player-respawn-trailing", "native player respawn payload has trailing bytes");
    }
  }
}

function validateIdentity(value: RustIntegratedRuntimeIdentityV1, label: string) {
  visibleString(value.universeId, `${label} universe id`, 64);
  visibleString(value.locationId, `${label} location id`, 128);
  hash(value.stateHash, `${label} state hash`);
  for (const [key, revision] of Object.entries(value.revision)) {
    safeIdentityInteger(revision, `${label} ${key} revision`);
  }
  safeIdentityInteger(value.tick, `${label} tick`);
  return value;
}

function writeIdentity(writer: Writer, value: RustIntegratedRuntimeIdentityV1) {
  validateIdentity(value, "runtime identity");
  writer.u16(2);
  writer.string(value.universeId, "runtime universe id");
  writer.string(value.locationId, "runtime location id");
  for (const revision of [
    value.revision.epoch,
    value.revision.world,
    value.revision.entities,
    value.revision.gameplay,
    value.revision.persistence,
    value.revision.network,
    value.revision.simulation,
  ]) writer.u64(BigInt(revision));
  writer.u64(BigInt(value.tick));
  writer.raw(hashBytes(value.stateHash, "runtime state hash"));
}

function readIdentity(reader: Reader): RustIntegratedRuntimeIdentityV1 {
  if (reader.u16() !== 2) {
    fail("player-respawn-identity", "native player respawn identity schema is not V2");
  }
  const safeNumber = (label: string) => {
    const value = reader.u64();
    if (value > MAX_SAFE_U64) fail("player-respawn-identity", `${label} exceeds the browser identity range`);
    return Number(value);
  };
  const value = Object.freeze({
    universeId: reader.string("runtime universe id"),
    locationId: reader.string("runtime location id"),
    revision: Object.freeze({
      epoch: safeNumber("identity epoch"),
      world: safeNumber("world revision"),
      entities: safeNumber("entities revision"),
      gameplay: safeNumber("gameplay revision"),
      persistence: safeNumber("persistence revision"),
      network: safeNumber("network revision"),
      simulation: safeNumber("simulation revision"),
    }),
    tick: safeNumber("runtime tick"),
    stateHash: bytesHash(reader.take(16)),
  });
  return validateIdentity(value, "runtime identity");
}

function writePosition(writer: Writer, value: RustIntegratedFixedWorldVec3V1) {
  fixedPosition(value, "respawn position");
  writer.i64(value.xMilli);
  writer.i64(value.yMilli);
  writer.i64(value.zMilli);
}

function readPosition(reader: Reader) {
  return Object.freeze({
    xMilli: reader.i64(),
    yMilli: reader.i64(),
    zMilli: reader.i64(),
  });
}

function validateRequest(value: RustIntegratedPlayerRespawnV1) {
  validateIdentity(value.expected, "expected runtime identity");
  visibleString(value.externalEntityId, "external entity id", 512);
  visibleString(value.actorId, "actor id", 512);
  nativeU64(value.playerId, "player id");
  nativeU64(value.entityId, "entity id");
  safeCursor(value.expectedEntityRevision, "expected entity revision", false);
  safeCursor(value.expectedGameplaySequence, "expected gameplay sequence");
  safeCursor(value.expectedGameplayCombatRevision, "expected gameplay combat revision");
  safeCursor(value.expectedCombatantRevision, "expected combatant revision");
  safeCursor(value.expectedDeathSequence, "expected death sequence", false);
  integer(value.expectedMaxHealth, 1, U32_MAX, "expected maximum health");
  fixedPosition(value.respawnPosition, "respawn position");
  boolean(value.keepInventory, "keep inventory policy");
  return value;
}

export function encodeRustIntegratedPlayerRespawnV1(value: RustIntegratedPlayerRespawnV1) {
  validateRequest(value);
  const writer = new Writer();
  writeIdentity(writer, value.expected);
  writer.string(value.externalEntityId, "external entity id");
  writer.string(value.actorId, "actor id");
  writer.u64(value.playerId);
  writer.u64(value.entityId);
  writer.u64(value.expectedEntityRevision);
  writer.u64(value.expectedGameplaySequence);
  writer.u64(value.expectedGameplayCombatRevision);
  writer.u64(value.expectedCombatantRevision);
  writer.u64(value.expectedDeathSequence);
  writer.u32(value.expectedMaxHealth);
  writePosition(writer, value.respawnPosition);
  writer.u8(value.keepInventory ? 1 : 0);
  return wrapRustIntegratedDomainPacketV1(BWD7_WIRE, writer.finish(), failDomainWire);
}

export function decodeRustIntegratedPlayerRespawnV1(packet: Uint8Array) {
  const reader = new Reader(unwrapRustIntegratedDomainPacketV1(BWD7_WIRE, packet, failDomainWire));
  const value = Object.freeze({
    expected: readIdentity(reader),
    externalEntityId: reader.string("external entity id"),
    actorId: reader.string("actor id"),
    playerId: reader.u64(),
    entityId: reader.u64(),
    expectedEntityRevision: reader.u64(),
    expectedGameplaySequence: reader.u64(),
    expectedGameplayCombatRevision: reader.u64(),
    expectedCombatantRevision: reader.u64(),
    expectedDeathSequence: reader.u64(),
    expectedMaxHealth: reader.u32(),
    respawnPosition: readPosition(reader),
    keepInventory: reader.flag("keep inventory policy"),
  });
  reader.finish();
  return validateRequest(value);
}

function writeReceiptContents(
  writer: Writer,
  value: Omit<RustIntegratedPlayerRespawnReceiptV1, "receiptHash">
    | RustIntegratedPlayerRespawnReceiptV1,
) {
  writer.raw(hashBytes(value.requestPayloadHash, "request payload hash"));
  writeIdentity(writer, value.before);
  writeIdentity(writer, value.after);
  writer.string(value.externalEntityId, "external entity id");
  writer.string(value.actorId, "actor id");
  writer.u64(value.playerId);
  writer.u64(value.entityId);
  writer.u64(value.deathSequence);
  writer.u64(value.priorEntityRevision);
  writer.u64(value.resultingEntityRevision);
  writer.u64(value.priorGameplaySequence);
  writer.u64(value.resultingGameplaySequence);
  writer.u64(value.priorGameplayCombatRevision);
  writer.u64(value.resultingGameplayCombatRevision);
  writer.u64(value.priorCombatantRevision);
  writer.u64(value.resultingCombatantRevision);
  writer.u32(value.maximumHealth);
  writer.u32(value.priorHealth);
  writer.u32(value.resultingHealth);
  writer.u8(value.priorAlive ? 1 : 0);
  writer.u8(value.resultingAlive ? 1 : 0);
  writePosition(writer, value.respawnPosition);
  writer.f64(value.resultingOxygenSeconds);
  writer.u8(value.keepInventory ? 1 : 0);
  writer.u64(value.inventoryBeforeRevision);
  writer.u64(value.inventoryAfterRevision);
  writer.u64(value.equipmentBeforeRevision);
  writer.u64(value.equipmentAfterRevision);
  writer.raw(hashBytes(value.custodyBeforeHash, "custody before hash"));
  writer.raw(hashBytes(value.custodyAfterHash, "custody after hash"));
  writer.u32(value.generatedDropCount);
}

export function rustIntegratedPlayerRespawnReceiptHashV1(
  value: Omit<RustIntegratedPlayerRespawnReceiptV1, "receiptHash">
    | RustIntegratedPlayerRespawnReceiptV1,
) {
  const writer = new Writer();
  writeReceiptContents(writer, value);
  return rustIntegratedRuntimeWireChecksumV1(writer.finish());
}

function validateIdentityTransition(
  before: RustIntegratedRuntimeIdentityV1,
  after: RustIntegratedRuntimeIdentityV1,
  gameplayDelta: 1 | 2,
) {
  validateIdentity(before, "respawn before identity");
  validateIdentity(after, "respawn after identity");
  const revisionDelta: Readonly<Record<keyof RustIntegratedRuntimeIdentityV1["revision"], number>> = {
    epoch: 0,
    world: 0,
    entities: 1,
    gameplay: gameplayDelta,
    persistence: 0,
    network: 0,
    simulation: 1,
  };
  if (before.universeId !== after.universeId
    || before.locationId !== after.locationId
    || before.tick !== after.tick
    || Object.entries(revisionDelta).some(([key, delta]) =>
      after.revision[key as keyof typeof revisionDelta]
        !== before.revision[key as keyof typeof revisionDelta] + delta)
    || before.stateHash === after.stateHash) {
    fail("player-respawn-identity", "BWE7 does not attest one exact R5/R6/R7 authority transition");
  }
}

function integratedGameplayRevisionDelta(
  value: Pick<RustIntegratedPlayerRespawnReceiptV1, "keepInventory" | "generatedDropCount">,
): 1 | 2 {
  // Respawn always advances R7 once. A non-empty death release additionally
  // registers every generated drop in one WorldView batch, so only the
  // integrated gameplay identity receives the second increment.
  return !value.keepInventory && value.generatedDropCount > 0 ? 2 : 1;
}

function validateCustodyTransition(value: RustIntegratedPlayerRespawnReceiptV1) {
  const inventoryDelta = value.inventoryAfterRevision - value.inventoryBeforeRevision;
  const equipmentDelta = value.equipmentAfterRevision - value.equipmentBeforeRevision;
  const custodyChanged = value.custodyAfterHash !== value.custodyBeforeHash;

  if (value.keepInventory) {
    if (inventoryDelta !== BigInt(0)
      || equipmentDelta !== BigInt(0)
      || custodyChanged
      || value.generatedDropCount !== 0) {
      fail(
        "player-respawn-inventory-policy",
        "BWE7 keep-inventory custody must retain both container revisions and the exact custody hash",
      );
    }
    return;
  }

  if (value.generatedDropCount === 0) {
    if (inventoryDelta !== BigInt(0)
      || equipmentDelta !== BigInt(0)
      || custodyChanged) {
      fail(
        "player-respawn-inventory-policy",
        "BWE7 empty death custody must retain both container revisions and the exact custody hash",
      );
    }
    return;
  }

  const inventoryReleased = inventoryDelta === BigInt(1);
  const equipmentReleased = equipmentDelta === BigInt(1);
  if ((inventoryDelta !== BigInt(0) && !inventoryReleased)
    || (equipmentDelta !== BigInt(0) && !equipmentReleased)
    || (!inventoryReleased && !equipmentReleased)
    || !custodyChanged) {
    fail(
      "player-respawn-inventory-policy",
      "BWE7 death-drop custody requires one exact successor for each released lane and a changed custody hash",
    );
  }
}

function validateReceiptContents(value: RustIntegratedPlayerRespawnReceiptV1) {
  hash(value.requestPayloadHash, "request payload hash");
  visibleString(value.externalEntityId, "external entity id", 512);
  visibleString(value.actorId, "actor id", 512);
  nativeU64(value.playerId, "player id");
  nativeU64(value.entityId, "entity id");
  const cursorPairs = [
    [value.priorEntityRevision, value.resultingEntityRevision, "entity revision", false],
    [value.priorGameplaySequence, value.resultingGameplaySequence, "gameplay sequence", true],
    [value.priorGameplayCombatRevision, value.resultingGameplayCombatRevision, "gameplay combat revision", true],
    [value.priorCombatantRevision, value.resultingCombatantRevision, "combatant revision", true],
  ] as const;
  for (const [before, after, label, allowZero] of cursorPairs) {
    safeCursor(before, `prior ${label}`, allowZero);
    safeCursor(after, `resulting ${label}`, false);
    if (after !== before + BigInt(1)) {
      fail("player-respawn-result", `BWE7 ${label} is not one exact successor`);
    }
  }
  safeCursor(value.deathSequence, "death sequence", false);
  integer(value.maximumHealth, 1, U32_MAX, "maximum health");
  integer(value.priorHealth, 0, U32_MAX, "prior health");
  integer(value.resultingHealth, 0, U32_MAX, "resulting health");
  boolean(value.priorAlive, "prior alive");
  boolean(value.resultingAlive, "resulting alive");
  fixedPosition(value.respawnPosition, "respawn position");
  if (!Number.isFinite(value.resultingOxygenSeconds) || value.resultingOxygenSeconds <= 0) {
    fail("player-respawn-result", "BWE7 oxygen reset is not finite and positive");
  }
  boolean(value.keepInventory, "keep inventory policy");
  safeCursor(value.inventoryBeforeRevision, "inventory before revision");
  safeCursor(value.inventoryAfterRevision, "inventory after revision");
  safeCursor(value.equipmentBeforeRevision, "equipment before revision");
  safeCursor(value.equipmentAfterRevision, "equipment after revision");
  hash(value.custodyBeforeHash, "custody before hash");
  hash(value.custodyAfterHash, "custody after hash");
  integer(value.generatedDropCount, 0, MAX_CUSTODY_DROPS, "generated drop count");

  const request = Object.freeze({
    expected: value.before,
    externalEntityId: value.externalEntityId,
    actorId: value.actorId,
    playerId: value.playerId,
    entityId: value.entityId,
    expectedEntityRevision: value.priorEntityRevision,
    expectedGameplaySequence: value.priorGameplaySequence,
    expectedGameplayCombatRevision: value.priorGameplayCombatRevision,
    expectedCombatantRevision: value.priorCombatantRevision,
    expectedDeathSequence: value.deathSequence,
    expectedMaxHealth: value.maximumHealth,
    respawnPosition: value.respawnPosition,
    keepInventory: value.keepInventory,
  });
  const requestHash = rustIntegratedRuntimeWireChecksumV1(encodeRustIntegratedPlayerRespawnV1(request));
  if (value.requestPayloadHash !== requestHash) {
    fail("player-respawn-request-hash", "BWE7 request hash does not identify its canonical BWD7 request");
  }
  if (value.priorHealth !== 0
    || value.priorAlive
    || value.resultingHealth !== value.maximumHealth
    || !value.resultingAlive) {
    fail("player-respawn-result", "BWE7 contains contradictory dead/live vital state");
  }
  validateCustodyTransition(value);
  validateIdentityTransition(value.before, value.after, integratedGameplayRevisionDelta(value));
  if (rustIntegratedPlayerRespawnReceiptHashV1(value) !== hash(value.receiptHash, "receipt hash")) {
    fail("player-respawn-receipt-hash", "BWE7 receipt hash does not seal its canonical fields");
  }
  return value;
}

export function encodeRustIntegratedPlayerRespawnReceiptV1(
  value: RustIntegratedPlayerRespawnReceiptV1,
) {
  validateReceiptContents(value);
  const writer = new Writer();
  writeReceiptContents(writer, value);
  writer.raw(hashBytes(value.receiptHash, "receipt hash"));
  return wrapRustIntegratedDomainPacketV1(BWE7_WIRE, writer.finish(), failDomainWire);
}

export function decodeRustIntegratedPlayerRespawnReceiptV1(packet: Uint8Array) {
  const reader = new Reader(unwrapRustIntegratedDomainPacketV1(BWE7_WIRE, packet, failDomainWire));
  const value = Object.freeze({
    requestPayloadHash: bytesHash(reader.take(16)),
    before: readIdentity(reader),
    after: readIdentity(reader),
    externalEntityId: reader.string("external entity id"),
    actorId: reader.string("actor id"),
    playerId: reader.u64(),
    entityId: reader.u64(),
    deathSequence: reader.u64(),
    priorEntityRevision: reader.u64(),
    resultingEntityRevision: reader.u64(),
    priorGameplaySequence: reader.u64(),
    resultingGameplaySequence: reader.u64(),
    priorGameplayCombatRevision: reader.u64(),
    resultingGameplayCombatRevision: reader.u64(),
    priorCombatantRevision: reader.u64(),
    resultingCombatantRevision: reader.u64(),
    maximumHealth: reader.u32(),
    priorHealth: reader.u32(),
    resultingHealth: reader.u32(),
    priorAlive: reader.flag("prior alive"),
    resultingAlive: reader.flag("resulting alive"),
    respawnPosition: readPosition(reader),
    resultingOxygenSeconds: reader.f64(),
    keepInventory: reader.flag("keep inventory policy"),
    inventoryBeforeRevision: reader.u64(),
    inventoryAfterRevision: reader.u64(),
    equipmentBeforeRevision: reader.u64(),
    equipmentAfterRevision: reader.u64(),
    custodyBeforeHash: bytesHash(reader.take(16)),
    custodyAfterHash: bytesHash(reader.take(16)),
    generatedDropCount: reader.u32(),
    receiptHash: bytesHash(reader.take(16)),
  });
  reader.finish();
  return validateReceiptContents(value);
}

export function planRustLivePlayerRespawnV1(
  identity: RustIntegratedRuntimeIdentityV1,
  intent: RustIntegratedPlayerRespawnV1,
): RustLivePlayerRespawnPlanV1 {
  validateIdentity(identity, "current runtime identity");
  const request = decodeRustIntegratedPlayerRespawnV1(encodeRustIntegratedPlayerRespawnV1(intent));
  if (!rustIntegratedRuntimeIdentityEqualsV1(identity, request.expected)) {
    fail("player-respawn-stale", "BWD7 expected identity differs from the current runtime identity");
  }
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: RUST_INTEGRATED_PLAYER_RESPAWN_TYPE_V1,
    schema: BWD7_SCHEMA.operationSchema,
    payload: encodeRustIntegratedPlayerRespawnV1(request),
  });
  const key = `player-respawn:${operation.payloadHash}`;
  return Object.freeze({
    batch: createRustIntegratedRuntimeCommandBatchV1({
      commandId: key,
      idempotencyKey: key,
      actorId: request.actorId,
      expected: request.expected,
      operations: Object.freeze([operation]),
    }),
    request,
    requestPayloadHash: operation.payloadHash,
    runtimePolicySupport: "accepted",
  });
}

function validatePlanIntegrity(plan: RustLivePlayerRespawnPlanV1) {
  const canonical = planRustLivePlayerRespawnV1(plan.request.expected, plan.request);
  const operation = plan.batch.operations[0];
  const canonicalOperation = canonical.batch.operations[0]!;
  if (plan.batch.commandId !== canonical.batch.commandId
    || plan.batch.idempotencyKey !== canonical.batch.idempotencyKey
    || plan.batch.actorId !== canonical.batch.actorId
    || plan.batch.commandHash !== canonical.batch.commandHash
    || !rustIntegratedRuntimeIdentityEqualsV1(plan.batch.expected, canonical.batch.expected)
    || plan.batch.operations.length !== 1
    || !operation
    || operation.domain !== canonicalOperation.domain
    || operation.typeId !== canonicalOperation.typeId
    || operation.schema !== canonicalOperation.schema
    || operation.payloadHash !== canonicalOperation.payloadHash
    || !bytesEqual(operation.payload, canonicalOperation.payload)
    || plan.requestPayloadHash !== canonical.requestPayloadHash
    || plan.runtimePolicySupport !== canonical.runtimePolicySupport) {
    fail("player-respawn-plan", "respawn plan is not the exact canonical BWD7 command batch");
  }
  return canonical;
}

export function rustLivePlayerRespawnPlanRecordV1(
  plan: RustLivePlayerRespawnPlanV1,
): RustLivePlayerRespawnPlanRecordV1 {
  const canonical = validatePlanIntegrity(plan);
  return Object.freeze({
    schema: 1,
    requestPayloadHex: bytesHash(canonical.batch.operations[0]!.payload),
    requestPayloadHash: canonical.requestPayloadHash,
    commandHash: canonical.batch.commandHash,
  });
}

export function serializeRustLivePlayerRespawnPlanV1(plan: RustLivePlayerRespawnPlanV1) {
  return JSON.stringify(rustLivePlayerRespawnPlanRecordV1(plan));
}

export function rehydrateRustLivePlayerRespawnPlanV1(
  recordOrJson: RustLivePlayerRespawnPlanRecordV1 | string,
) {
  let parsed: unknown = recordOrJson;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); }
    catch { return fail("player-respawn-plan", "durable respawn plan is not valid JSON"); }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("player-respawn-plan", "durable respawn plan is malformed");
  }
  const source = parsed as Record<string, unknown>;
  if (Object.keys(source).sort().join(",") !== "commandHash,requestPayloadHash,requestPayloadHex,schema"
    || source.schema !== 1
    || typeof source.requestPayloadHex !== "string"
    || source.requestPayloadHex.length < RUST_INTEGRATED_DOMAIN_WIRE_HEADER_BYTES_V1 * 2
    || source.requestPayloadHex.length > BWD7_WIRE.maximumPacketBytes * 2
    || source.requestPayloadHex.length % 2 !== 0
    || !/^[0-9a-f]+$/u.test(source.requestPayloadHex)) {
    return fail("player-respawn-plan", "durable respawn plan fields are not exact canonical values");
  }
  const requestPayloadHex = source.requestPayloadHex;
  const payload = Uint8Array.from(
    { length: requestPayloadHex.length / 2 },
    (_, index) => Number.parseInt(requestPayloadHex.slice(index * 2, index * 2 + 2), 16),
  );
  const request = decodeRustIntegratedPlayerRespawnV1(payload);
  const plan = planRustLivePlayerRespawnV1(request.expected, request);
  if (bytesHash(plan.batch.operations[0]!.payload) !== requestPayloadHex
    || typeof source.requestPayloadHash !== "string"
    || hash(source.requestPayloadHash, "durable request payload hash") !== plan.requestPayloadHash
    || typeof source.commandHash !== "string"
    || hash(source.commandHash, "durable command hash") !== plan.batch.commandHash) {
    fail("player-respawn-plan", "durable respawn plan did not rehydrate byte-for-byte");
  }
  return plan;
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
    fail("player-respawn-command-receipt", "player respawn outer receipt hash is invalid");
  }
}

export function validateRustLivePlayerRespawnReceiptV1(
  plan: RustLivePlayerRespawnPlanV1,
  receipt: RustIntegratedRuntimeCommandReceiptV1,
): RustLivePlayerRespawnValidatedReceiptV1 {
  validatePlanIntegrity(plan);
  if (receipt.commandId !== plan.batch.commandId
    || receipt.idempotencyKey !== plan.batch.idempotencyKey
    || receipt.commandHash !== plan.batch.commandHash) {
    fail("player-respawn-command-receipt", "player respawn receipt does not identify the submitted batch");
  }
  validateOuterReceiptHash(receipt);
  if (receipt.status === "rejected") {
    validateIdentity(receipt.current, "rejected player respawn current identity");
    const currentMatchesExpected = rustIntegratedRuntimeIdentityEqualsV1(
      receipt.current,
      plan.batch.expected,
    );
    if (receipt.code === "stale-runtime") {
      if (currentMatchesExpected) {
        fail("player-respawn-command-receipt", "stale-runtime respawn rejection did not report a newer identity");
      }
    } else if (receipt.code !== "idempotency-conflict" && !currentMatchesExpected) {
      fail("player-respawn-command-receipt", "domain-rejected player respawn command moved runtime identity");
    }
    fail(receipt.code, receipt.message);
  }
  if (receipt.domainReceipts.length !== 1) {
    fail("player-respawn-command-receipt", "accepted player respawn command requires one domain receipt");
  }
  const operation = receipt.domainReceipts[0];
  if (!operation
    || operation.domain !== "simulation"
    || operation.typeId !== RUST_INTEGRATED_PLAYER_RESPAWN_RECEIPT_TYPE_V1
    || operation.schema !== BWE7_SCHEMA.operationSchema
    || operation.payloadHash !== rustIntegratedRuntimeWireChecksumV1(operation.payload)) {
    fail("player-respawn-command-receipt", "accepted player respawn command returned the wrong domain receipt");
  }
  const decoded = decodeRustIntegratedPlayerRespawnReceiptV1(operation.payload);
  if (decoded.requestPayloadHash !== plan.requestPayloadHash
    || decoded.externalEntityId !== plan.request.externalEntityId
    || decoded.actorId !== plan.request.actorId
    || decoded.playerId !== plan.request.playerId
    || decoded.entityId !== plan.request.entityId
    || decoded.deathSequence !== plan.request.expectedDeathSequence
    || decoded.priorEntityRevision !== plan.request.expectedEntityRevision
    || decoded.priorGameplaySequence !== plan.request.expectedGameplaySequence
    || decoded.priorGameplayCombatRevision !== plan.request.expectedGameplayCombatRevision
    || decoded.priorCombatantRevision !== plan.request.expectedCombatantRevision
    || decoded.maximumHealth !== plan.request.expectedMaxHealth
    || !samePosition(decoded.respawnPosition, plan.request.respawnPosition)
    || decoded.keepInventory !== plan.request.keepInventory) {
    fail("player-respawn-receipt", "BWE7 does not attest the exact submitted R5/R6/R7/death CAS");
  }
  if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.before, plan.batch.expected)
    || !rustIntegratedRuntimeIdentityEqualsV1(decoded.before, receipt.before)
    || !rustIntegratedRuntimeIdentityEqualsV1(decoded.after, receipt.after)) {
    fail("player-respawn-command-receipt", "BWE7 identities do not bind the submitted command receipt");
  }
  validateIdentityTransition(
    receipt.before,
    receipt.after,
    integratedGameplayRevisionDelta(decoded),
  );
  return Object.freeze({ respawn: decoded, outer: receipt });
}

function validateReadback(
  plan: RustLivePlayerRespawnPlanV1,
  validated: RustLivePlayerRespawnValidatedReceiptV1,
  readback: RustLivePlayerRespawnReadbackV1,
  expectedIdentity: RustIntegratedRuntimeIdentityV1,
) {
  const receipt = validated.respawn;
  const zeroVelocity = readback.velocityMilliPerSecond.xMilli === 0
    && readback.velocityMilliPerSecond.yMilli === 0
    && readback.velocityMilliPerSecond.zMilli === 0;
  if (!rustIntegratedRuntimeIdentityEqualsV1(readback.identity, expectedIdentity)
    || readback.externalEntityId !== plan.request.externalEntityId
    || readback.actorId !== plan.request.actorId
    || readback.playerId !== plan.request.playerId
    || readback.entityId !== plan.request.entityId
    || readback.entityRevision !== receipt.resultingEntityRevision
    || readback.gameplaySequence !== receipt.resultingGameplaySequence
    || readback.gameplayCombatRevision !== receipt.resultingGameplayCombatRevision
    || readback.combatantRevision !== receipt.resultingCombatantRevision
    || readback.deathSequence !== receipt.deathSequence
    || readback.lastRespawnSequence !== receipt.deathSequence
    || readback.health !== receipt.resultingHealth
    || readback.maximumHealth !== receipt.maximumHealth
    || readback.alive !== receipt.resultingAlive
    || !samePosition(readback.position, receipt.respawnPosition)
    || !zeroVelocity
    || !Object.is(readback.oxygenSeconds, receipt.resultingOxygenSeconds)
    || readback.grounded
    || readback.crouching
    || readback.fallDistanceMilli !== 0
    || readback.drowningAccumulatorMilli !== 0
    || readback.buttons !== 0
    || readback.flags !== 0
    || readback.contactFlags !== 0
    || !readback.queuedInputsEmpty
    || !readback.pendingContextCommandsEmpty
    || !readback.pendingMovementResultEmpty
    || !readback.miningStateEmpty
    || readback.inventoryRevision !== receipt.inventoryAfterRevision
    || readback.equipmentRevision !== receipt.equipmentAfterRevision
    || readback.custodyHash !== receipt.custodyAfterHash
    || readback.projectedDropCount !== receipt.generatedDropCount) {
    fail("player-respawn-readback", "native readback does not attest the exact BWE7 body, cursor, and custody result");
  }
  return readback;
}

export function validateRustLivePlayerRespawnAfterCommandV1(
  plan: RustLivePlayerRespawnPlanV1,
  validated: RustLivePlayerRespawnValidatedReceiptV1,
  readback: RustLivePlayerRespawnReadbackV1,
) {
  return validateReadback(plan, validated, readback, validated.outer.after);
}

export function validateRustLivePlayerRespawnRestoredStateV1(
  plan: RustLivePlayerRespawnPlanV1,
  validated: RustLivePlayerRespawnValidatedReceiptV1,
  readback: RustLivePlayerRespawnReadbackV1,
  expectedIdentity: RustIntegratedRuntimeIdentityV1,
) {
  validateIdentity(expectedIdentity, "restored player respawn identity");
  const accepted = validated.outer.after;
  const revisionKeys = Object.keys(accepted.revision) as Array<keyof typeof accepted.revision>;
  if (expectedIdentity.universeId !== accepted.universeId
    || expectedIdentity.locationId !== accepted.locationId
    || expectedIdentity.revision.epoch !== accepted.revision.epoch
    || expectedIdentity.tick < accepted.tick
    || revisionKeys.some((key) => expectedIdentity.revision[key] < accepted.revision[key])) {
    fail("player-respawn-readback", "restored identity is not a monotonic descendant of the accepted BWE7 authority");
  }
  return validateReadback(plan, validated, readback, expectedIdentity);
}

/** Submit one retained plan. Same-generation service retries reuse these exact bytes. */
export async function executeRustLivePlayerRespawnPlanV1(
  service: RustIntegratedPlayerRespawnServiceV1,
  plan: RustLivePlayerRespawnPlanV1,
) {
  const receipt = await service.command(plan.batch);
  if (receipt.status === "rejected"
    && !rustIntegratedRuntimeIdentityEqualsV1(service.identity(), receipt.current)) {
    fail("player-respawn-command-receipt", "runtime service identity differs from the rejected respawn receipt");
  }
  const validated = validateRustLivePlayerRespawnReceiptV1(plan, receipt);
  if (!rustIntegratedRuntimeIdentityEqualsV1(service.identity(), validated.outer.after)) {
    fail("player-respawn-command-receipt", "runtime service did not adopt the accepted BWE7 successor");
  }
  return Object.freeze({ plan, validated });
}

export async function executeRustLivePlayerRespawnV1(
  service: RustIntegratedPlayerRespawnServiceV1,
  intent: RustIntegratedPlayerRespawnV1,
) {
  const plan = planRustLivePlayerRespawnV1(service.identity(), intent);
  return executeRustLivePlayerRespawnPlanV1(service, plan);
}
