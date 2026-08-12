import {
  decodeRustAuthoritativeExtractionR10,
  type RustAuthoritativeExtractionR10,
  type RustDomainRowR10,
  type RustDomainValueR10,
  type RustDomainValueTypeR10,
} from "./rust-authoritative-extraction-r10.ts";
import {
  rustIntegratedCameraStateHashR10,
  type RustIntegratedCameraModeR10,
  type RustIntegratedCameraProfileR10,
} from "./rust-integrated-runtime-camera-r10.ts";
import type {
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
} from "./rust-integrated-runtime-contract.ts";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow.ts";

const CAMERA_MAX_VIEWPORT_R10 = 16_384;
const MAX_SAFE_U64 = BigInt(Number.MAX_SAFE_INTEGER);
const QUATERNION_UNIT_TOLERANCE = 1e-12;

const CAMERA_FIELDS = Object.freeze([
  "actorId",
  "aiming",
  "cameraRevision",
  "cameraStateHash",
  "collided",
  "entityId",
  "externalEntityId",
  "mode",
  "orientation.w",
  "orientation.x",
  "orientation.y",
  "orientation.z",
  "playerId",
  "poseHash",
  "position.x",
  "position.y",
  "position.z",
  "profile.aimVerticalFovRadians",
  "profile.baseVerticalFovRadians",
  "profile.collisionPadding",
  "profile.collisionRadius",
  "profile.eyeHeight",
  "profile.far",
  "profile.minimumDistance",
  "profile.near",
  "profile.rearShoulderOffset",
  "profile.thirdPersonDistance",
  "profile.thirdPersonPitchScale",
  "profile.thirdPersonTargetHeight",
  "projection.far",
  "projection.near",
  "projection.verticalFovRadians",
  "resolvedDistance",
  "viewRevision",
  "viewport.height",
  "viewport.width",
] as const);

const CAMERA_FIELD_TYPES: readonly RustDomainValueTypeR10[] = Object.freeze([
  "string", "bool", "u64", "hash", "bool", "u64", "string", "string",
  "f64", "f64", "f64", "f64", "u64", "hash", "f64", "f64", "f64",
  "f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64",
  "f64", "f64", "f64", "f64", "f64", "f64", "f64", "u64", "u64", "u64",
]);

export type RustLiveCameraVec3R10 = Readonly<{ x: number; y: number; z: number }>;
export type RustLiveCameraQuaternionR10 = Readonly<{ x: number; y: number; z: number; w: number }>;
export type RustLiveCameraProjectionR10 = Readonly<{
  verticalFovRadians: number;
  near: number;
  far: number;
}>;
export type RustLiveCameraViewportR10 = Readonly<{ width: number; height: number }>;

export type RustLiveCameraPoseHashInputR10 = Readonly<{
  mode: RustIntegratedCameraModeR10;
  aiming: boolean;
  position: RustLiveCameraVec3R10;
  orientation: RustLiveCameraQuaternionR10;
  projection: RustLiveCameraProjectionR10;
  viewport: RustLiveCameraViewportR10;
  collided: boolean;
  resolvedDistance: number;
}>;

export type RustLiveCameraViewR10 = Readonly<{
  extractionRevision: bigint;
  authorityTick: bigint;
  rowRevision: bigint;
  actorId: string;
  externalEntityId: string;
  entityId: bigint;
  playerId: bigint;
  cameraRevision: bigint;
  cameraStateHash: string;
  mode: RustIntegratedCameraModeR10;
  profile: RustIntegratedCameraProfileR10;
  aiming: boolean;
  position: RustLiveCameraVec3R10;
  orientation: RustLiveCameraQuaternionR10;
  projection: RustLiveCameraProjectionR10;
  viewport: RustLiveCameraViewportR10;
  viewRevision: bigint;
  collided: boolean;
  resolvedDistance: number;
  poseHash: string;
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function bytesHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function f64Bytes(value: number) {
  invariant(Number.isFinite(value), "live camera pose hash contains a non-finite f64");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return bytes;
}

function modeTag(value: RustIntegratedCameraModeR10) {
  if (value === "first") return 0;
  if (value === "third-rear") return 1;
  if (value === "third-front") return 2;
  throw new TypeError("live camera mode is unknown");
}

/** Exact browser mirror of simulation `pose_hash` in camera.rs. */
export function rustLiveCameraPoseHashR10(value: RustLiveCameraPoseHashInputR10) {
  invariant(typeof value.aiming === "boolean" && typeof value.collided === "boolean",
    "live camera pose hash flags are invalid");
  invariant(Number.isInteger(value.viewport.width) && value.viewport.width >= 1
    && value.viewport.width <= CAMERA_MAX_VIEWPORT_R10
    && Number.isInteger(value.viewport.height) && value.viewport.height >= 1
    && value.viewport.height <= CAMERA_MAX_VIEWPORT_R10,
  "live camera pose hash viewport is outside the simulation contract");

  const hasher = new TypeScriptCanonicalHasher("blockwild-camera-pose-v1")
    .writeU16(1)
    .writeU16(modeTag(value.mode))
    .writeU16(value.aiming ? 1 : 0);
  for (const field of [value.position.x, value.position.y, value.position.z]) {
    hasher.writeBytes(f64Bytes(field));
  }
  for (const field of [value.orientation.x, value.orientation.y, value.orientation.z, value.orientation.w]) {
    hasher.writeBytes(f64Bytes(field));
  }
  for (const field of [value.projection.verticalFovRadians, value.projection.near, value.projection.far]) {
    hasher.writeBytes(f64Bytes(field));
  }
  hasher.writeU32(value.viewport.width)
    .writeU32(value.viewport.height)
    .writeU16(value.collided ? 1 : 0)
    .writeBytes(f64Bytes(value.resolvedDistance));
  return hasher.finishHex();
}

function fields(row: RustDomainRowR10) {
  return new Map<string, RustDomainValueR10>(row.fields);
}

function field<T extends RustDomainValueR10>(
  values: ReadonlyMap<string, RustDomainValueR10>,
  key: string,
  guard: (value: RustDomainValueR10) => value is T,
) {
  const value = values.get(key);
  invariant(value !== undefined && guard(value), `live camera field '${key}' is absent or has the wrong type`);
  return value;
}

const isBigint = (value: RustDomainValueR10): value is bigint => typeof value === "bigint";
const isNumber = (value: RustDomainValueR10): value is number => typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: RustDomainValueR10): value is boolean => typeof value === "boolean";
const isString = (value: RustDomainValueR10): value is string => typeof value === "string";
const isHash = (value: RustDomainValueR10): value is Uint8Array => value instanceof Uint8Array && value.byteLength === 16;

function exactRow(
  rows: readonly RustDomainRowR10[],
  kind: number,
  predicate: (row: RustDomainRowR10) => boolean,
  label: string,
) {
  const matches = rows.filter((row) => row.kind === kind && predicate(row));
  invariant(matches.length === 1, `live camera ${label} must resolve exactly one authoritative row`);
  return matches[0];
}

function validateRequestedView(value: RustIntegratedRuntimeExtractionViewV1) {
  invariant(Number.isInteger(value.viewportWidth) && value.viewportWidth >= 1
    && value.viewportWidth <= CAMERA_MAX_VIEWPORT_R10
    && Number.isInteger(value.viewportHeight) && value.viewportHeight >= 1
    && value.viewportHeight <= CAMERA_MAX_VIEWPORT_R10,
  "live camera requested viewport is outside the simulation contract");
  invariant(Number.isSafeInteger(value.viewRevision) && value.viewRevision >= 0,
    "live camera requested view revision exceeds JavaScript's safe integer range");
}

function validateExactCameraFields(row: RustDomainRowR10) {
  invariant(row.fields.length === CAMERA_FIELDS.length
    && row.fields.every(([name], index) => name === CAMERA_FIELDS[index]),
  "live camera row does not contain the exact canonical field set");
  invariant(row.fieldTypes?.length === CAMERA_FIELD_TYPES.length
    && row.fieldTypes.every((type, index) => type === CAMERA_FIELD_TYPES[index]),
  "live camera row does not contain the exact canonical field types");
}

function cameraFromDecoded(
  decoded: RustAuthoritativeExtractionR10,
  expectedExternalEntityId: string,
  requestedView: RustIntegratedRuntimeExtractionViewV1,
): RustLiveCameraViewR10 {
  invariant(decoded.entities !== null && decoded.domains !== null,
    "live camera view requires both BWR6 and BWX0 extraction");
  invariant(decoded.entities.omitted === 0,
    "live camera view cannot attest a player from an omitted entity extraction");
  const playerView = decoded.domains.views.find((view) => view.domain === 2);
  invariant(playerView !== undefined && playerView.status === "complete" && playerView.omitted === 0
    && playerView.blockers.length === 0,
  "live camera BWX0 player view is not complete");
  invariant(playerView.rows.length === 3
    && playerView.rows[0].kind === 1
    && playerView.rows[1].kind === 2
    && playerView.rows[2].kind === 3,
  "live camera BWX0 player view does not contain the frozen runtime, binding, and camera row set");

  const cameraRows = playerView.rows.filter((row) => row.kind === 3);
  invariant(cameraRows.length === 1 && cameraRows[0].key === "camera",
    "live camera row must be the sole kind-3 player row");
  const cameraRow = cameraRows[0];
  validateExactCameraFields(cameraRow);
  const camera = fields(cameraRow);

  const externalEntityId = field(camera, "externalEntityId", isString);
  invariant(externalEntityId.length > 0 && externalEntityId === expectedExternalEntityId,
    "live camera external player identity does not match the expected binding");
  const entityId = field(camera, "entityId", isBigint);
  const playerId = field(camera, "playerId", isBigint);
  const actorId = field(camera, "actorId", isString);
  invariant(entityId > BigInt(0) && playerId > BigInt(0) && actorId.length > 0,
    "live camera bound identity is empty");

  const runtimeRow = exactRow(playerView.rows, 1, (row) => row.key === externalEntityId, "runtime player row");
  invariant(field(fields(runtimeRow), "entityId", isBigint) === entityId,
    "live camera and runtime player entity identities disagree");
  const bindingRow = exactRow(
    playerView.rows,
    2,
    (row) => fields(row).get("entityId") === entityId,
    "world-view binding row",
  );
  const binding = fields(bindingRow);
  invariant(field(binding, "actorId", isString) === actorId,
    "live camera and world-view actor identities disagree");
  invariant(field(binding, "playerId", isBigint) === playerId,
    "live camera and world-view player identities disagree");

  const entityMatches = decoded.entities.records.filter((record) => record.entityId === entityId
    && record.externalEntityId === externalEntityId
    && record.class === "player"
    && record.residency === "hot");
  invariant(entityMatches.length === 1,
    "live camera binding does not match exactly one hot BWR6 player entity");
  invariant(field(binding, "entityRevision", isBigint) === entityMatches[0].entityRevision,
    "live camera world-view and entity revisions disagree");

  const cameraRevision = field(camera, "cameraRevision", isBigint);
  invariant(cameraRevision <= MAX_SAFE_U64,
    "live camera revision exceeds JavaScript's safe integer range");
  const modeValue = field(camera, "mode", isString);
  invariant(modeValue === "first" || modeValue === "third-rear" || modeValue === "third-front",
    "live camera mode is unknown");
  const mode: RustIntegratedCameraModeR10 = modeValue;
  const aiming = field(camera, "aiming", isBoolean);
  const collided = field(camera, "collided", isBoolean);

  const readNumber = (key: string) => field(camera, key, isNumber);
  const profile: RustIntegratedCameraProfileR10 = Object.freeze({
    eyeHeight: readNumber("profile.eyeHeight"),
    thirdPersonTargetHeight: readNumber("profile.thirdPersonTargetHeight"),
    thirdPersonDistance: readNumber("profile.thirdPersonDistance"),
    thirdPersonPitchScale: readNumber("profile.thirdPersonPitchScale"),
    rearShoulderOffset: readNumber("profile.rearShoulderOffset"),
    collisionRadius: readNumber("profile.collisionRadius"),
    collisionPadding: readNumber("profile.collisionPadding"),
    minimumDistance: readNumber("profile.minimumDistance"),
    baseVerticalFovRadians: readNumber("profile.baseVerticalFovRadians"),
    aimVerticalFovRadians: readNumber("profile.aimVerticalFovRadians"),
    near: readNumber("profile.near"),
    far: readNumber("profile.far"),
  });
  const cameraStateHash = bytesHex(field(camera, "cameraStateHash", isHash));
  let expectedCameraStateHash: string;
  try {
    expectedCameraStateHash = rustIntegratedCameraStateHashR10(cameraRevision, mode, profile);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new TypeError(`live camera profile is outside the simulation contract${detail}`);
  }
  invariant(cameraStateHash === expectedCameraStateHash,
    "live camera state hash does not attest revision, mode, and profile");

  const position = Object.freeze({
    x: readNumber("position.x"),
    y: readNumber("position.y"),
    z: readNumber("position.z"),
  });
  const orientation = Object.freeze({
    x: readNumber("orientation.x"),
    y: readNumber("orientation.y"),
    z: readNumber("orientation.z"),
    w: readNumber("orientation.w"),
  });
  const quaternionLengthSquared = orientation.x * orientation.x + orientation.y * orientation.y
    + orientation.z * orientation.z + orientation.w * orientation.w;
  invariant(Math.abs(quaternionLengthSquared - 1) <= QUATERNION_UNIT_TOLERANCE,
    "live camera orientation is not a unit quaternion");

  const projection = Object.freeze({
    verticalFovRadians: readNumber("projection.verticalFovRadians"),
    near: readNumber("projection.near"),
    far: readNumber("projection.far"),
  });
  invariant(Object.is(projection.near, profile.near) && Object.is(projection.far, profile.far),
    "live camera projection clip planes disagree with its profile");
  const expectedFov = aiming ? profile.aimVerticalFovRadians : profile.baseVerticalFovRadians;
  invariant(Object.is(projection.verticalFovRadians, expectedFov),
    "live camera projection FOV disagrees with authoritative aiming");

  const viewRevision = field(camera, "viewRevision", isBigint);
  const viewportWidth = field(camera, "viewport.width", isBigint);
  const viewportHeight = field(camera, "viewport.height", isBigint);
  invariant(viewRevision === BigInt(requestedView.viewRevision)
    && viewportWidth === BigInt(requestedView.viewportWidth)
    && viewportHeight === BigInt(requestedView.viewportHeight),
  "live camera row does not echo the requested view exactly");
  const viewport = Object.freeze({ width: requestedView.viewportWidth, height: requestedView.viewportHeight });

  const resolvedDistance = readNumber("resolvedDistance");
  invariant(resolvedDistance >= 0, "live camera resolved distance is negative");
  if (mode === "first") {
    invariant(!collided && Object.is(resolvedDistance, 0),
      "live first-person camera carries impossible collision state");
  } else {
    const maximumDistance = Math.hypot(
      profile.thirdPersonDistance,
      mode === "third-rear" ? profile.rearShoulderOffset : 0,
    );
    invariant(resolvedDistance <= maximumDistance + Number.EPSILON * Math.max(1, maximumDistance) * 8,
      "live third-person camera resolved distance exceeds its profile");
    invariant(!collided || resolvedDistance < maximumDistance,
      "live collided camera did not shorten its requested distance");
  }

  const poseHash = bytesHex(field(camera, "poseHash", isHash));
  const expectedPoseHash = rustLiveCameraPoseHashR10({
    mode,
    aiming,
    position,
    orientation,
    projection,
    viewport,
    collided,
    resolvedDistance,
  });
  invariant(poseHash === expectedPoseHash,
    "live camera pose hash does not attest its complete renderer-neutral pose");

  return Object.freeze({
    extractionRevision: decoded.extractionRevision,
    authorityTick: decoded.domains.authorityTick,
    rowRevision: cameraRow.revision,
    actorId,
    externalEntityId,
    entityId,
    playerId,
    cameraRevision,
    cameraStateHash,
    mode,
    profile,
    aiming,
    position,
    orientation,
    projection,
    viewport,
    viewRevision,
    collided,
    resolvedDistance,
    poseHash,
  });
}

/** Strict renderer-neutral camera mirror; no identity or pose field is inferred. */
export function decodeRustLiveCameraViewR10(
  extraction: RustIntegratedRuntimeExtractionV1,
  expectedExternalEntityId: string,
  requestedView: RustIntegratedRuntimeExtractionViewV1,
) {
  invariant(typeof expectedExternalEntityId === "string" && expectedExternalEntityId.length > 0,
    "live camera expected external identity is empty");
  validateRequestedView(requestedView);
  return cameraFromDecoded(
    decodeRustAuthoritativeExtractionR10(extraction),
    expectedExternalEntityId,
    requestedView,
  );
}
