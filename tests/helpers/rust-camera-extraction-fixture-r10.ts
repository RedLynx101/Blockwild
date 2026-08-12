import { readFileSync } from "node:fs";

import {
  compareCanonicalUtf8R10,
  decodeRustDomainBundleR10,
  type RustDomainValueR10,
  type RustDomainValueTypeR10,
} from "../../app/game/rust-authoritative-extraction-r10.ts";
import { encodeRustEntityExtractionR6V3 } from "../../app/game/rust-entity-authority-codec-r6.ts";
import type {
  RustEntityExtractionR6V3,
  RustEntityExtractionRecordR6V3,
} from "../../app/game/rust-entity-authority-contract-r6.ts";
import {
  rustIntegratedCameraStateHashR10,
  type RustIntegratedCameraModeR10,
  type RustIntegratedCameraProfileR10,
} from "../../app/game/rust-integrated-runtime-camera-r10.ts";
import type {
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
  RustIntegratedRuntimeIdentityV1,
} from "../../app/game/rust-integrated-runtime-contract.ts";
import { rustLiveCameraPoseHashR10 } from "../../app/game/rust-live-camera-view-r10.ts";
import { TypeScriptCanonicalHasher } from "../../app/game/rust-kernel-shadow.ts";

const encoder = new TextEncoder();
const ZERO = new Uint8Array(16);
const GOLDEN_BWX0 = Uint8Array.from(Buffer.from(readFileSync(
  new URL("../fixtures/rust-engine/r10-authoritative-extraction/bound-camera-view-bwx0-v1.hex", import.meta.url),
  "utf8",
).trim(), "hex"));
const GOLDEN = decodeRustDomainBundleR10(GOLDEN_BWX0);

export const RUST_CAMERA_FIXTURE_EXTERNAL_ENTITY_R10 = "player:extraction";
export const RUST_CAMERA_FIXTURE_PROFILE_R10: RustIntegratedCameraProfileR10 = Object.freeze({
  eyeHeight: 1.62,
  thirdPersonTargetHeight: 1.34,
  thirdPersonDistance: 4.35,
  thirdPersonPitchScale: 0.72,
  rearShoulderOffset: 0.22,
  collisionRadius: 0.18,
  collisionPadding: 0.16,
  minimumDistance: 0.28,
  baseVerticalFovRadians: 1.2566370614359172,
  aimVerticalFovRadians: 0.8545132017764238,
  near: 0.05,
  far: 512,
});

class Writer {
  readonly bytes: number[] = [];
  raw(value: Uint8Array | readonly number[]) { this.bytes.push(...value); return this; }
  u8(value: number) { this.bytes.push(value); return this; }
  u16(value: number) { this.bytes.push(value & 0xff, value >>> 8 & 0xff); return this; }
  u32(value: number) {
    this.bytes.push(value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff);
    return this;
  }
  u64(value: bigint | number) {
    let checked = BigInt(value);
    for (let index = 0; index < 8; index += 1) {
      this.bytes.push(Number(checked & BigInt(0xff)));
      checked >>= BigInt(8);
    }
    return this;
  }
  f64(value: number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    return this.raw(bytes);
  }
  string(value: string) {
    const bytes = encoder.encode(value);
    return this.u32(bytes.byteLength).raw(bytes);
  }
  finish() { return Uint8Array.from(this.bytes); }
}

type MutableField = { name: string; type: RustDomainValueTypeR10; value: RustDomainValueR10 };
type MutableRow = { kind: number; key: string; fields: MutableField[] };

function hexBytes(value: string) {
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function encodeValue(type: RustDomainValueTypeR10, value: RustDomainValueR10) {
  const writer = new Writer();
  if (type === "bool") return writer.u8(0).u8(value ? 1 : 0).finish();
  if (type === "u64") return writer.u8(1).u64(value as bigint).finish();
  if (type === "i64") return writer.u8(2).u64(BigInt.asUintN(64, value as bigint)).finish();
  if (type === "f64") return writer.u8(3).f64(value as number).finish();
  if (type === "string") return writer.u8(4).string(value as string).finish();
  if (type === "hash") return writer.u8(5).raw(value as Uint8Array).finish();
  const bytes = value as Uint8Array;
  return writer.u8(6).u32(bytes.byteLength).raw(bytes).finish();
}

function encodeRow(row: MutableRow) {
  const fields = [...row.fields].sort((left, right) => compareCanonicalUtf8R10(left.name, right.name));
  const encoded = fields.map((field) => Object.freeze({ ...field, bytes: encodeValue(field.type, field.value) }));
  const revisionHasher = new TypeScriptCanonicalHasher("blockwild.r10.domain-row-revision.v1")
    .writeU16(row.kind).writeString(row.key).writeU16(encoded.length);
  for (const field of encoded) revisionHasher.writeString(field.name).writeBytes(field.bytes);
  const revisionBytes = revisionHasher.finish();
  const revision = new DataView(revisionBytes.buffer, revisionBytes.byteOffset, 8).getBigUint64(0, true);
  const writer = new Writer().u16(row.kind).string(row.key).u64(revision).u16(encoded.length);
  for (const field of encoded) writer.string(field.name).raw(field.bytes);
  return writer.finish();
}

function cloneRows() {
  return GOLDEN.views.map((view) => view.rows.map((row) => ({
    kind: row.kind,
    key: row.key,
    fields: row.fields.map(([name, value], index) => ({
      name,
      type: row.fieldTypes![index],
      value: value instanceof Uint8Array ? Uint8Array.from(value) : value,
    })),
  })));
}

function setField(row: MutableRow, name: string, value: RustDomainValueR10) {
  const field = row.fields.find((candidate) => candidate.name === name);
  if (!field) throw new TypeError(`missing camera fixture field '${name}'`);
  field.value = value;
}

function encodeHud(
  identity: RustIntegratedRuntimeIdentityV1,
  extractionRevision: number,
  view: RustIntegratedRuntimeExtractionViewV1,
  cameraRevision: bigint,
  mode: RustIntegratedCameraModeR10,
  profile: RustIntegratedCameraProfileR10,
  aiming: boolean,
) {
  const rowsByDomain = cloneRows();
  const camera = rowsByDomain[1].find((row) => row.kind === 3)!;
  const collided = false;
  const resolvedDistance = mode === "first" ? 0 : profile.thirdPersonDistance;
  const position = Object.freeze({ x: 8, y: mode === "first" ? 65.62 : 65.34, z: mode === "third-front" ? 3.65 : 12.35 });
  const orientation = Object.freeze({ x: 0, y: 0, z: -0, w: 1 });
  const projection = Object.freeze({
    verticalFovRadians: aiming ? profile.aimVerticalFovRadians : profile.baseVerticalFovRadians,
    near: profile.near,
    far: profile.far,
  });
  for (const [name, value] of [
    ["cameraRevision", cameraRevision],
    ["cameraStateHash", hexBytes(rustIntegratedCameraStateHashR10(cameraRevision, mode, profile))],
    ["mode", mode],
    ["aiming", aiming],
    ["collided", collided],
    ["orientation.w", orientation.w], ["orientation.x", orientation.x],
    ["orientation.y", orientation.y], ["orientation.z", orientation.z],
    ["position.x", position.x], ["position.y", position.y], ["position.z", position.z],
    ["profile.eyeHeight", profile.eyeHeight],
    ["profile.thirdPersonTargetHeight", profile.thirdPersonTargetHeight],
    ["profile.thirdPersonDistance", profile.thirdPersonDistance],
    ["profile.thirdPersonPitchScale", profile.thirdPersonPitchScale],
    ["profile.rearShoulderOffset", profile.rearShoulderOffset],
    ["profile.collisionRadius", profile.collisionRadius],
    ["profile.collisionPadding", profile.collisionPadding],
    ["profile.minimumDistance", profile.minimumDistance],
    ["profile.baseVerticalFovRadians", profile.baseVerticalFovRadians],
    ["profile.aimVerticalFovRadians", profile.aimVerticalFovRadians],
    ["profile.near", profile.near], ["profile.far", profile.far],
    ["projection.verticalFovRadians", projection.verticalFovRadians],
    ["projection.near", projection.near], ["projection.far", projection.far],
    ["resolvedDistance", resolvedDistance],
    ["viewRevision", BigInt(view.viewRevision)],
    ["viewport.width", BigInt(view.viewportWidth)],
    ["viewport.height", BigInt(view.viewportHeight)],
  ] as const) setField(camera, name, value);
  setField(camera, "poseHash", hexBytes(rustLiveCameraPoseHashR10({
    mode, aiming, position, orientation, projection,
    viewport: Object.freeze({ width: view.viewportWidth, height: view.viewportHeight }),
    collided, resolvedDistance,
  })));

  const writer = new Writer().raw(encoder.encode("BWX0")).u16(1)
    .u64(extractionRevision).u64(identity.tick).raw(hexBytes(identity.stateHash))
    .raw(GOLDEN.contentManifestHash).u8(GOLDEN.contentReady ? 1 : 0).u16(GOLDEN.views.length);
  GOLDEN.views.forEach((domain, index) => {
    const payloadWriter = new Writer();
    for (const row of rowsByDomain[index]) payloadWriter.raw(encodeRow(row));
    const payload = payloadWriter.finish();
    const payloadHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-view-payload.v1").writeBytes(payload).finish();
    const status = domain.status === "complete" ? 0 : domain.status === "partial" ? 1 : 2;
    writer.u8(domain.domain).u16(1).u8(status).u64(domain.revision)
      .u32(domain.total).u32(domain.selected).u32(domain.omitted).u32(domain.nextCursor)
      .u16(domain.blockers.length);
    for (const blocker of domain.blockers) writer.string(blocker);
    writer.u32(payload.byteLength).raw(payloadHash).raw(payload);
  });
  return writer.finish();
}

function playerRecord(): RustEntityExtractionRecordR6V3 {
  return Object.freeze({
    entityId: BigInt("4294967297"), residency: "hot", class: "player", simulationTier: "hero",
    protection: BigInt(0), entityRevision: BigInt(1), externalEntityId: RUST_CAMERA_FIXTURE_EXTERNAL_ENTITY_R10,
    specimenId: RUST_CAMERA_FIXTURE_EXTERNAL_ENTITY_R10, kindKey: "player", variantKey: null,
    name: "Extraction Player", modelKey: "player-standing", modelRevision: 0, modelHash: ZERO,
    position: Object.freeze({ x: 8, y: 64, z: 8 }), yaw: 0,
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }), health: 20, maximumHealth: 20,
    tamed: false, ageTicks: BigInt(0), movementMode: "ground", grounded: false, submerged: false,
    lastDamageTick: BigInt(0),
    action: Object.freeze({ key: "idle", phase: 0, startedTick: BigInt(0), endsTick: BigInt(0), target: null }),
    equipment: Object.freeze([]),
    mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
    research: Object.freeze([]),
  });
}

export function cameraExtractionFixtureR10(value: Readonly<{
  identity: RustIntegratedRuntimeIdentityV1;
  extractionRevision: number;
  view: RustIntegratedRuntimeExtractionViewV1;
  cameraRevision: bigint;
  mode: RustIntegratedCameraModeR10;
  profile?: RustIntegratedCameraProfileR10;
  aiming?: boolean;
}>): RustIntegratedRuntimeExtractionV1 {
  const profile = value.profile ?? RUST_CAMERA_FIXTURE_PROFILE_R10;
  const entities: RustEntityExtractionR6V3 = Object.freeze({
    schema: 3,
    extractionRevision: BigInt(value.extractionRevision),
    authorityTick: BigInt(value.identity.tick),
    contentManifestHash: ZERO,
    contentReady: false,
    total: 1,
    selected: 1,
    omitted: 0,
    records: Object.freeze([playerRecord()]),
  });
  return Object.freeze({
    identity: value.identity,
    extractionRevision: value.extractionRevision,
    render: encodeRustEntityExtractionR6V3(entities),
    hud: encodeHud(
      value.identity,
      value.extractionRevision,
      value.view,
      value.cameraRevision,
      value.mode,
      profile,
      value.aiming ?? false,
    ),
    audio: new Uint8Array(),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: value.extractionRevision.toString(16).padStart(32, "0"),
  });
}
