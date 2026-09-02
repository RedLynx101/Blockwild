import {
  RUST_INTEGRATED_CAMERA_CONFIG_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_CAMERA_CONFIG_TYPE_V1,
  decodeRustIntegratedCameraConfigReceiptR10,
  encodeRustIntegratedCameraConfigR10,
  rustIntegratedCameraStateHashR10,
  type RustIntegratedCameraModeR10,
  type RustIntegratedCameraProfileR10,
} from "./rust-integrated-runtime-camera-r10.ts";
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
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "./rust-integrated-runtime-domain-schema.generated.ts";
import type { RustLiveCameraViewR10 } from "./rust-live-camera-view-r10.ts";

export const RUST_LIVE_CAMERA_COMMAND_ACTOR_R10 = "platform:camera";

const CONFIG_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("simulation-camera-config-v1");
const RECEIPT_SCHEMA = rustIntegratedRuntimeDomainWireFamilyV1("simulation-camera-config-receipt-v1");

export type RustLiveCameraConfigIntentR10 = Readonly<{
  mode: RustIntegratedCameraModeR10;
  profile?: RustIntegratedCameraProfileR10;
}>;

export type RustLiveCameraConfigPlanR10 = Readonly<{
  batch: RustIntegratedRuntimeCommandBatchV1;
  desiredMode: RustIntegratedCameraModeR10;
  desiredProfile: RustIntegratedCameraProfileR10;
  previousCameraRevision: bigint;
  requestPayloadHash: string;
}>;

export type RustLiveCameraValidatedReceiptR10 = Readonly<{
  changed: boolean;
  cameraRevision: bigint;
  cameraStateHash: string;
  mode: RustIntegratedCameraModeR10;
  profile: RustIntegratedCameraProfileR10;
  outer: RustIntegratedRuntimeAcceptedReceiptV1;
}>;

export class RustLiveCameraControlErrorR10 extends Error {
  readonly name = "RustLiveCameraControlErrorR10";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustLiveCameraControlErrorR10(code, message);
}

function hexBytes(value: string, label: string) {
  if (!/^[0-9a-f]{32}$/u.test(value)) fail("camera-command-receipt", `${label} is not a canonical hash`);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function validateReceiptHash(receipt: RustIntegratedRuntimeCommandReceiptV1) {
  const bytes: number[] = [
    ...hexBytes(receipt.commandHash, "camera command hash"),
  ];
  if (receipt.status === "accepted") {
    bytes.push(...hexBytes(receipt.before.stateHash, "camera before state hash"));
    bytes.push(...hexBytes(receipt.after.stateHash, "camera after state hash"));
    for (const operation of receipt.domainReceipts) {
      bytes.push(...hexBytes(operation.payloadHash, "camera domain receipt payload hash"));
    }
  } else {
    bytes.push(...hexBytes(receipt.current.stateHash, "camera current state hash"));
    bytes.push(...new TextEncoder().encode(receipt.code));
    bytes.push(...new TextEncoder().encode(receipt.message));
  }
  if (receipt.receiptHash !== rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes))) {
    fail("camera-command-receipt", "camera command receipt hash is invalid");
  }
}

function sameFloat(left: number, right: number) {
  return Object.is(left, right);
}

export function rustLiveCameraProfilesEqualR10(
  left: RustIntegratedCameraProfileR10,
  right: RustIntegratedCameraProfileR10,
) {
  return sameFloat(left.eyeHeight, right.eyeHeight)
    && sameFloat(left.thirdPersonTargetHeight, right.thirdPersonTargetHeight)
    && sameFloat(left.thirdPersonDistance, right.thirdPersonDistance)
    && sameFloat(left.thirdPersonPitchScale, right.thirdPersonPitchScale)
    && sameFloat(left.rearShoulderOffset, right.rearShoulderOffset)
    && sameFloat(left.collisionRadius, right.collisionRadius)
    && sameFloat(left.collisionPadding, right.collisionPadding)
    && sameFloat(left.minimumDistance, right.minimumDistance)
    && sameFloat(left.baseVerticalFovRadians, right.baseVerticalFovRadians)
    && sameFloat(left.aimVerticalFovRadians, right.aimVerticalFovRadians)
    && sameFloat(left.near, right.near)
    && sameFloat(left.far, right.far);
}

export function rustLiveCameraConfigMatchesR10(
  current: RustLiveCameraViewR10,
  desired: RustLiveCameraConfigIntentR10,
) {
  return current.mode === desired.mode
    && rustLiveCameraProfilesEqualR10(current.profile, desired.profile ?? current.profile);
}

export function planRustLiveCameraConfigR10(
  identity: RustIntegratedRuntimeIdentityV1,
  current: RustLiveCameraViewR10,
  desired: RustLiveCameraConfigIntentR10,
): RustLiveCameraConfigPlanR10 {
  const desiredProfile = desired.profile ?? current.profile;
  const payload = encodeRustIntegratedCameraConfigR10({
    expectedCameraRevision: current.cameraRevision,
    mode: desired.mode,
    profile: desiredProfile,
  });
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: RUST_INTEGRATED_CAMERA_CONFIG_TYPE_V1,
    schema: CONFIG_SCHEMA.operationSchema,
    payload,
  });
  const key = `camera-config:${operation.payloadHash}`;
  return Object.freeze({
    batch: createRustIntegratedRuntimeCommandBatchV1({
      commandId: key,
      idempotencyKey: key,
      actorId: RUST_LIVE_CAMERA_COMMAND_ACTOR_R10,
      expected: identity,
      operations: Object.freeze([operation]),
    }),
    desiredMode: desired.mode,
    desiredProfile,
    previousCameraRevision: current.cameraRevision,
    requestPayloadHash: operation.payloadHash,
  });
}

function validateOuterIdentity(
  plan: RustLiveCameraConfigPlanR10,
  receipt: RustIntegratedRuntimeAcceptedReceiptV1,
  decodedRevision: bigint,
) {
  if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.before, plan.batch.expected)) {
    fail("camera-command-receipt", "camera command receipt before-identity does not match its request");
  }
  const changed = decodedRevision === plan.previousCameraRevision + BigInt(1);
  const keys = Object.keys(receipt.before.revision) as Array<keyof RustIntegratedRuntimeIdentityV1["revision"]>;
  for (const key of keys) {
    const expected = key === "simulation" && changed
      ? receipt.before.revision[key] + 1
      : receipt.before.revision[key];
    if (receipt.after.revision[key] !== expected) {
      fail("camera-command-receipt", "camera command changed an unexpected outer authority revision");
    }
  }
  if (receipt.after.tick !== receipt.before.tick
    || receipt.after.universeId !== receipt.before.universeId
    || receipt.after.locationId !== receipt.before.locationId
    || changed === rustIntegratedRuntimeIdentityEqualsV1(receipt.before, receipt.after)) {
    fail("camera-command-receipt", "camera command outer identity does not match its mutation result");
  }
  if (changed === (receipt.after.stateHash === receipt.before.stateHash)) {
    fail("camera-command-receipt", "camera command outer state hash does not match its mutation result");
  }
  return changed;
}

export function validateRustLiveCameraConfigReceiptR10(
  plan: RustLiveCameraConfigPlanR10,
  receipt: RustIntegratedRuntimeCommandReceiptV1,
): RustLiveCameraValidatedReceiptR10 {
  if (receipt.commandId !== plan.batch.commandId
    || receipt.idempotencyKey !== plan.batch.idempotencyKey
    || receipt.commandHash !== plan.batch.commandHash) {
    fail("camera-command-receipt", "camera command receipt does not identify the exact submitted batch");
  }
  validateReceiptHash(receipt);
  if (receipt.status === "rejected") {
    if (!rustIntegratedRuntimeIdentityEqualsV1(receipt.current, plan.batch.expected)) {
      fail("camera-command-receipt", "rejected camera command moved the integrated runtime identity");
    }
    fail(receipt.code, receipt.message);
  }
  if (receipt.domainReceipts.length !== 1) {
    fail("camera-command-receipt", "accepted camera command must contain exactly one domain receipt");
  }
  const operation = receipt.domainReceipts[0];
  if (operation.domain !== "simulation"
    || operation.typeId !== RUST_INTEGRATED_CAMERA_CONFIG_RECEIPT_TYPE_V1
    || operation.schema !== RECEIPT_SCHEMA.operationSchema
    || operation.payloadHash !== rustIntegratedRuntimeWireChecksumV1(operation.payload)) {
    fail("camera-command-receipt", "accepted camera command returned the wrong domain receipt");
  }
  const decoded = decodeRustIntegratedCameraConfigReceiptR10(operation.payload);
  if (decoded.requestPayloadHash !== plan.requestPayloadHash
    || decoded.previousCameraRevision !== plan.previousCameraRevision
    || decoded.mode !== plan.desiredMode
    || !rustLiveCameraProfilesEqualR10(decoded.profile, plan.desiredProfile)) {
    fail("camera-command-receipt", "BWR5 does not attest the exact requested absolute camera state");
  }
  const changed = validateOuterIdentity(plan, receipt, decoded.resultingCameraRevision);
  if (changed !== (decoded.resultingCameraRevision !== decoded.previousCameraRevision)) {
    fail("camera-command-receipt", "BWR5 and outer identity disagree on whether camera authority changed");
  }
  const cameraStateHash = rustIntegratedCameraStateHashR10(
    decoded.resultingCameraRevision,
    decoded.mode,
    decoded.profile,
  );
  if (decoded.cameraStateHash !== cameraStateHash) {
    fail("camera-command-receipt", "BWR5 camera state hash is invalid");
  }
  return Object.freeze({
    changed,
    cameraRevision: decoded.resultingCameraRevision,
    cameraStateHash,
    mode: decoded.mode,
    profile: decoded.profile,
    outer: receipt,
  });
}

export function validateRustLiveCameraAfterCommandR10(
  result: RustLiveCameraValidatedReceiptR10,
  camera: RustLiveCameraViewR10,
) {
  if (camera.cameraRevision !== result.cameraRevision
    || camera.cameraStateHash !== result.cameraStateHash
    || camera.mode !== result.mode
    || !rustLiveCameraProfilesEqualR10(camera.profile, result.profile)
    || camera.authorityTick !== BigInt(result.outer.after.tick)) {
    fail("camera-command-extraction", "post-command camera row does not match the accepted BWR5 receipt");
  }
}
