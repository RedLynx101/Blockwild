import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import {
  createRustIntegratedDomainWireDescriptorV1,
  unwrapRustIntegratedDomainPacketV1,
  wrapRustIntegratedDomainPacketV1,
  type RustIntegratedDomainWireFailureV1,
} from "./rust-integrated-runtime-domain-wire";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated";

const CONFIG_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("simulation-camera-config-v1");
const RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("simulation-camera-config-receipt-v1");

export const RUST_INTEGRATED_CAMERA_CONFIG_TYPE_V1 = CONFIG_SCHEMA.typeId;
export const RUST_INTEGRATED_CAMERA_CONFIG_RECEIPT_TYPE_V1 = RECEIPT_SCHEMA.typeId;

const CONFIG_WIRE = createRustIntegratedDomainWireDescriptorV1({
  magic: CONFIG_SCHEMA.magic,
  schema: CONFIG_SCHEMA.innerSchema,
  label: "camera configuration",
});
const RECEIPT_WIRE = createRustIntegratedDomainWireDescriptorV1({
  magic: RECEIPT_SCHEMA.magic,
  schema: RECEIPT_SCHEMA.innerSchema,
  label: "camera configuration receipt",
});
const MAX_SAFE_U64 = BigInt(Number.MAX_SAFE_INTEGER);
const HASH_PATTERN = /^[0-9a-f]{32}$/u;

export type RustIntegratedCameraModeR10 = "first" | "third-rear" | "third-front";

export type RustIntegratedCameraProfileR10 = Readonly<{
  eyeHeight: number;
  thirdPersonTargetHeight: number;
  thirdPersonDistance: number;
  thirdPersonPitchScale: number;
  rearShoulderOffset: number;
  collisionRadius: number;
  collisionPadding: number;
  minimumDistance: number;
  baseVerticalFovRadians: number;
  aimVerticalFovRadians: number;
  near: number;
  far: number;
}>;

export type RustIntegratedCameraConfigR10 = Readonly<{
  expectedCameraRevision: bigint;
  mode: RustIntegratedCameraModeR10;
  profile: RustIntegratedCameraProfileR10;
}>;

export type RustIntegratedCameraConfigReceiptR10 = Readonly<{
  requestPayloadHash: string;
  previousCameraRevision: bigint;
  resultingCameraRevision: bigint;
  mode: RustIntegratedCameraModeR10;
  profile: RustIntegratedCameraProfileR10;
  cameraStateHash: string;
}>;

export class RustIntegratedCameraWireErrorR10 extends Error {
  readonly name = "RustIntegratedCameraWireErrorR10";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustIntegratedCameraWireErrorR10(code, message);
}

const failDomainWire: RustIntegratedDomainWireFailureV1 = (code, message) => fail(`camera-${code}`, message);

function hashBytes(value: string) {
  if (!HASH_PATTERN.test(value)) fail("camera-hash", "camera hash is not a canonical 128-bit hash");
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function bytesHash(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function checkedRevision(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0) || value > MAX_SAFE_U64) {
    fail("camera-revision", `${label} exceeds JavaScript's safe integer range`);
  }
  return value;
}

function modeTag(value: RustIntegratedCameraModeR10) {
  if (value === "first") return 0;
  if (value === "third-rear") return 1;
  if (value === "third-front") return 2;
  return fail("camera-mode", "camera configuration mode is unknown");
}

function readMode(value: number): RustIntegratedCameraModeR10 {
  if (value === 0) return "first";
  if (value === 1) return "third-rear";
  if (value === 2) return "third-front";
  return fail("camera-mode", "camera configuration mode is unknown");
}

function profileValues(value: RustIntegratedCameraProfileR10) {
  return [
    value.eyeHeight,
    value.thirdPersonTargetHeight,
    value.thirdPersonDistance,
    value.thirdPersonPitchScale,
    value.rearShoulderOffset,
    value.collisionRadius,
    value.collisionPadding,
    value.minimumDistance,
    value.baseVerticalFovRadians,
    value.aimVerticalFovRadians,
    value.near,
    value.far,
  ] as const;
}

function validateProfile(value: RustIntegratedCameraProfileR10) {
  const limits = [
    [value.eyeHeight, 0, 16],
    [value.thirdPersonTargetHeight, 0, 16],
    [value.thirdPersonDistance, 0.05, 64],
    [value.thirdPersonPitchScale, 0, 4],
    [value.rearShoulderOffset, -4, 4],
    [value.collisionRadius, 0, 4],
    [value.collisionPadding, 0, 4],
    [value.minimumDistance, 0, 16],
    [value.baseVerticalFovRadians, 0.1, Math.PI - 0.1],
    [value.aimVerticalFovRadians, 0.1, Math.PI - 0.1],
    [value.near, 0.001, 65_536],
    [value.far, 0.002, 65_536],
  ] as const;
  if (limits.some(([field, minimum, maximum]) => !Number.isFinite(field) || field < minimum || field > maximum)
    || value.far <= value.near
    || value.minimumDistance > value.thirdPersonDistance) {
    fail("camera-profile", "camera configuration profile is outside the simulation contract");
  }
  return value;
}

function bodyConfig(value: RustIntegratedCameraConfigR10) {
  checkedRevision(value.expectedCameraRevision, "expected camera revision");
  validateProfile(value.profile);
  const body = new Uint8Array(8 + 1 + 12 * 8);
  const view = new DataView(body.buffer);
  view.setBigUint64(0, value.expectedCameraRevision, true);
  view.setUint8(8, modeTag(value.mode));
  profileValues(value.profile).forEach((field, index) => view.setFloat64(9 + index * 8, field, true));
  return body;
}

function readProfile(view: DataView, offset: number): RustIntegratedCameraProfileR10 {
  const fields = Array.from({ length: 12 }, (_, index) => view.getFloat64(offset + index * 8, true));
  return validateProfile(Object.freeze({
    eyeHeight: fields[0]!,
    thirdPersonTargetHeight: fields[1]!,
    thirdPersonDistance: fields[2]!,
    thirdPersonPitchScale: fields[3]!,
    rearShoulderOffset: fields[4]!,
    collisionRadius: fields[5]!,
    collisionPadding: fields[6]!,
    minimumDistance: fields[7]!,
    baseVerticalFovRadians: fields[8]!,
    aimVerticalFovRadians: fields[9]!,
    near: fields[10]!,
    far: fields[11]!,
  }));
}

export function rustIntegratedCameraStateHashR10(
  cameraRevision: bigint,
  mode: RustIntegratedCameraModeR10,
  profile: RustIntegratedCameraProfileR10,
) {
  checkedRevision(cameraRevision, "camera revision");
  validateProfile(profile);
  const hasher = new TypeScriptCanonicalHasher("blockwild-camera-config-state-v1")
    .writeU16(1)
    .writeU64(cameraRevision)
    .writeU16(modeTag(mode));
  for (const field of profileValues(profile)) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, field, true);
    hasher.writeBytes(bytes);
  }
  return hasher.finishHex();
}

export function encodeRustIntegratedCameraConfigR10(value: RustIntegratedCameraConfigR10) {
  return wrapRustIntegratedDomainPacketV1(CONFIG_WIRE, bodyConfig(value), failDomainWire);
}

export function decodeRustIntegratedCameraConfigR10(packet: Uint8Array): RustIntegratedCameraConfigR10 {
  const body = unwrapRustIntegratedDomainPacketV1(CONFIG_WIRE, packet, failDomainWire);
  if (body.byteLength !== 8 + 1 + 12 * 8) fail("camera-trailing", "camera configuration body is truncated or has trailing bytes");
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const value = Object.freeze({
    expectedCameraRevision: checkedRevision(view.getBigUint64(0, true), "expected camera revision"),
    mode: readMode(view.getUint8(8)),
    profile: readProfile(view, 9),
  });
  return value;
}

function validateReceipt(value: RustIntegratedCameraConfigReceiptR10) {
  checkedRevision(value.previousCameraRevision, "previous camera revision");
  checkedRevision(value.resultingCameraRevision, "resulting camera revision");
  if (value.resultingCameraRevision !== value.previousCameraRevision
    && value.resultingCameraRevision !== value.previousCameraRevision + BigInt(1)) {
    fail("camera-revision", "camera receipt revision must stay unchanged or advance exactly once");
  }
  validateProfile(value.profile);
  if (!HASH_PATTERN.test(value.requestPayloadHash)) fail("camera-hash", "camera request payload hash is invalid");
  if (value.cameraStateHash !== rustIntegratedCameraStateHashR10(value.resultingCameraRevision, value.mode, value.profile)) {
    fail("camera-state-hash", "camera receipt state hash is invalid");
  }
}

export function encodeRustIntegratedCameraConfigReceiptR10(value: RustIntegratedCameraConfigReceiptR10) {
  validateReceipt(value);
  const body = new Uint8Array(16 + 8 + 8 + 1 + 12 * 8 + 16);
  const view = new DataView(body.buffer);
  body.set(hashBytes(value.requestPayloadHash), 0);
  view.setBigUint64(16, value.previousCameraRevision, true);
  view.setBigUint64(24, value.resultingCameraRevision, true);
  view.setUint8(32, modeTag(value.mode));
  profileValues(value.profile).forEach((field, index) => view.setFloat64(33 + index * 8, field, true));
  body.set(hashBytes(value.cameraStateHash), 33 + 12 * 8);
  return wrapRustIntegratedDomainPacketV1(RECEIPT_WIRE, body, failDomainWire);
}

export function decodeRustIntegratedCameraConfigReceiptR10(packet: Uint8Array): RustIntegratedCameraConfigReceiptR10 {
  const body = unwrapRustIntegratedDomainPacketV1(RECEIPT_WIRE, packet, failDomainWire);
  if (body.byteLength !== 16 + 8 + 8 + 1 + 12 * 8 + 16) fail("camera-trailing", "camera receipt body is truncated or has trailing bytes");
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const value = Object.freeze({
    requestPayloadHash: bytesHash(body.subarray(0, 16)),
    previousCameraRevision: checkedRevision(view.getBigUint64(16, true), "previous camera revision"),
    resultingCameraRevision: checkedRevision(view.getBigUint64(24, true), "resulting camera revision"),
    mode: readMode(view.getUint8(32)),
    profile: readProfile(view, 33),
    cameraStateHash: bytesHash(body.subarray(33 + 12 * 8)),
  });
  validateReceipt(value);
  return value;
}
