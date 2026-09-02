import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeRustNetworkPlayerPoseV1,
  decodeRustNetworkPlayerPoseProjectionV1,
  encodeRustNetworkPlayerPoseV1,
  encodeRustNetworkPlayerPoseProjectionV1,
  RUST_NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1,
  RUST_NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1,
} from "../app/game/rust-network-player-pose-v1.ts";

const allFieldsPose = Object.freeze({
  playerId: "peer-1",
  tick: 42,
  x: 12.387,
  y: 64.5,
  z: -9.876,
  yaw: 1.571,
  pitch: -0.314,
  vx: 4.35,
  vy: -0.125,
  vz: 0.75,
  grounded: true,
  selected: 3,
  shieldRaised: true,
  crouching: false,
  sprinting: true,
  action: "mine" as const,
  swimming: 0.25,
  seated: 1,
  boatId: "boat:cedar-1",
  boatSeat: 0,
  boatForward: 0.875,
  boatTurn: -0.25,
  mountedCreatureId: 42,
  mountedCreatureSeat: 1,
});

test("native player pose wire matches the Rust all-fields hash vector", () => {
  const bytes = encodeRustNetworkPlayerPoseV1(allFieldsPose);
  const decoded = decodeRustNetworkPlayerPoseV1(bytes);
  assert.equal(decoded.poseHash, "4f75838a9217204c90910000d1e2b543");
  assert.deepEqual(decoded, { schema: 1, ...allFieldsPose, poseHash: decoded.poseHash });
});

test("native player pose omits raw appearance and inventory authority", () => {
  const canonical = encodeRustNetworkPlayerPoseV1(allFieldsPose);
  const withUntrustedPresentation = encodeRustNetworkPlayerPoseV1({
    ...allFieldsPose,
    heldItem: 65_535,
    heldItemFilled: true,
    offhandItem: 65_535,
    variant: "male",
    sex: "male",
    profileId: "forged_profile",
    equipment: { head: 65_535 },
    colors: { skin: "#000000" },
  });
  assert.deepEqual(withUntrustedPresentation, canonical);
});

test("native player pose projection matches the Rust custody hash vector", () => {
  const pose = decodeRustNetworkPlayerPoseV1(encodeRustNetworkPlayerPoseV1(allFieldsPose));
  const projection = Object.freeze({
    schema: 1 as const,
    sessionId: "session-r9",
    peerId: "peer-1",
    connectionId: "conn-human-1",
    playerId: "peer-1",
    commandId: "pose:42",
    commandSequence: 7,
    commandHash: "1".repeat(32),
    authorityReceiptHash: "2".repeat(32),
    presentedDeltaSequence: 9,
    presentedIdentityHash: "3".repeat(32),
    recordRevision: 3,
    previousRecordHash: "4".repeat(32),
    pose,
    recordHash: "51987a01efaa8790b089bb6f605af956",
    projectionHash: "8d3d9d01fbda1c00e077e7654e4135d2",
  });
  assert.deepEqual(
    decodeRustNetworkPlayerPoseProjectionV1(encodeRustNetworkPlayerPoseProjectionV1(projection)),
    projection,
  );
});

test("native player pose wire fails closed on tampering, nonfinite input, and incoherent vehicle fields", () => {
  const tampered = encodeRustNetworkPlayerPoseV1(allFieldsPose);
  tampered[24] ^= 0x40;
  assert.throws(() => decodeRustNetworkPlayerPoseV1(tampered), /hash|canonical/u);
  assert.throws(() => encodeRustNetworkPlayerPoseV1({ ...allFieldsPose, x: Number.NaN }), /native bound/u);
  assert.throws(() => encodeRustNetworkPlayerPoseV1({ ...allFieldsPose, x: 2_000_001 }), /native bound/u);
  assert.throws(() => encodeRustNetworkPlayerPoseV1({ ...allFieldsPose, boatId: undefined, boatSeat: 0 }), /require boatId/u);
  assert.throws(() => encodeRustNetworkPlayerPoseV1({ ...allFieldsPose, mountedCreatureId: undefined, mountedCreatureSeat: 1 }), /requires mountedCreatureId/u);
});

test("native pose projection enforces Rust identity, ancestry, and whole-wire bounds", () => {
  const pose = decodeRustNetworkPlayerPoseV1(encodeRustNetworkPlayerPoseV1(allFieldsPose));
  const projection = {
    schema: 1 as const,
    sessionId: "session-r9",
    peerId: "peer-1",
    connectionId: "conn-human-1",
    playerId: "peer-1",
    commandId: "pose:42",
    commandSequence: 7,
    commandHash: "1".repeat(32),
    authorityReceiptHash: "2".repeat(32),
    presentedDeltaSequence: 9,
    presentedIdentityHash: "3".repeat(32),
    recordRevision: 3,
    previousRecordHash: "4".repeat(32),
    pose,
    recordHash: "51987a01efaa8790b089bb6f605af956",
    projectionHash: "8d3d9d01fbda1c00e077e7654e4135d2",
  };
  assert.throws(() => encodeRustNetworkPlayerPoseProjectionV1({ ...projection, playerId: "peer-other" }), /does not match/u);
  assert.throws(() => encodeRustNetworkPlayerPoseProjectionV1({ ...projection, recordRevision: 0 }), /recordRevision/u);
  assert.throws(() => encodeRustNetworkPlayerPoseProjectionV1({ ...projection, sessionId: "s".repeat(181) }), /sessionId/u);
  assert.throws(() => encodeRustNetworkPlayerPoseProjectionV1({ ...projection, recordRevision: 1 }), /predecessor/u);
  assert.throws(() => encodeRustNetworkPlayerPoseProjectionV1({ ...projection, recordRevision: 2, previousRecordHash: "0".repeat(32) }), /predecessor/u);
  assert.throws(() => decodeRustNetworkPlayerPoseV1(new Uint8Array(RUST_NETWORK_PLAYER_POSE_MAX_WIRE_BYTES_V1 + 1)), /wire budget/u);
  assert.throws(() => decodeRustNetworkPlayerPoseProjectionV1(new Uint8Array(RUST_NETWORK_PLAYER_POSE_PROJECTION_MAX_WIRE_BYTES_V1 + 1)), /wire budget/u);
});
