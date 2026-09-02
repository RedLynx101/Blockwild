import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compareCanonicalUtf8R10,
  decodeRustDomainBundleR10,
  type RustDomainBundleR10,
  type RustDomainValueR10,
} from "../app/game/rust-authoritative-extraction-r10.ts";
import { encodeRustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-codec-r6.ts";
import { decodeRustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-codec-r6.ts";
import type {
  RustEntityExtractionR6V3,
  RustEntityExtractionRecordR6V3,
} from "../app/game/rust-entity-authority-contract-r6.ts";
import type { RenderEntityFrameContextR10 } from "../app/game/rust-render-entity-extraction-r10.ts";
import {
  rustIntegratedCameraStateHashR10,
  type RustIntegratedCameraModeR10,
  type RustIntegratedCameraProfileR10,
} from "../app/game/rust-integrated-runtime-camera-r10.ts";
import type {
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  decodeRustLiveCameraViewR10,
  rustLiveCameraPoseHashR10,
} from "../app/game/rust-live-camera-view-r10.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";
import {
  createRenderFrameV2,
  createRenderResourceBatchV2,
  type RenderFrameV2,
  type RenderResourceBatchV2,
} from "../app/game/rust-render-extraction-v2.ts";
import {
  RustRenderSceneComposerR10,
  type RenderSceneExtractionSinkR10,
  type RenderRuntimeFrameContextR10,
} from "../app/game/rust-render-scene-composer-r10.ts";

const encoder = new TextEncoder();
const ZERO = new Uint8Array(16);
const VIEW = Object.freeze({ viewportWidth: 1_280, viewportHeight: 720, viewRevision: 11 });
const GOLDEN_BWX0 = Uint8Array.from(Buffer.from(readFileSync(
  new URL("./fixtures/rust-engine/r10-authoritative-extraction/bound-camera-view-bwx0-v1.hex", import.meta.url),
  "utf8",
).trim(), "hex"));

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

function hashBytes(value: string) {
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function encodeValue(value: RustDomainValueR10) {
  const writer = new Writer();
  if (typeof value === "boolean") return writer.u8(0).u8(value ? 1 : 0).finish();
  if (typeof value === "bigint") return writer.u8(1).u64(value).finish();
  if (typeof value === "number") return writer.u8(3).f64(value).finish();
  if (typeof value === "string") return writer.u8(4).string(value).finish();
  return writer.u8(5).raw(value).finish();
}

type MutableRow = {
  kind: number;
  key: string;
  fields: Map<string, RustDomainValueR10>;
  bytesFields: Set<string>;
  signedFields: Set<string>;
};

function encodeRow(row: MutableRow) {
  const encodedFields = [...row.fields]
    .sort(([left], [right]) => compareCanonicalUtf8R10(left, right))
    .map(([name, value]) => {
      let encoded = encodeValue(value);
      if (row.bytesFields.has(name)) encoded = new Writer().u8(6).u32((value as Uint8Array).byteLength).raw(value as Uint8Array).finish();
      if (row.signedFields.has(name)) encoded = new Writer().u8(2).u64(BigInt.asUintN(64, value as bigint)).finish();
      return [name, encoded] as const;
    });
  const revisionHasher = new TypeScriptCanonicalHasher("blockwild.r10.domain-row-revision.v1")
    .writeU16(row.kind).writeString(row.key).writeU16(encodedFields.length);
  for (const [name, value] of encodedFields) revisionHasher.writeString(name).writeBytes(value);
  const revisionBytes = revisionHasher.finish();
  const revision = new DataView(revisionBytes.buffer, revisionBytes.byteOffset, 8).getBigUint64(0, true);
  const writer = new Writer().u16(row.kind).string(row.key).u64(revision).u16(encodedFields.length);
  for (const [name, value] of encodedFields) writer.string(name).raw(value);
  return writer.finish();
}

function reencodeBundle(
  source: RustDomainBundleR10,
  rowsByDomain: readonly (readonly MutableRow[])[],
) {
  const writer = new Writer().raw(encoder.encode("BWX0")).u16(1)
    .u64(source.extractionRevision).u64(source.authorityTick)
    .raw(source.stateHash).raw(source.contentManifestHash).u8(source.contentReady ? 1 : 0)
    .u16(source.views.length);
  source.views.forEach((view, index) => {
    const rows = rowsByDomain[index];
    const payloadWriter = new Writer();
    for (const row of rows) payloadWriter.raw(encodeRow(row));
    const payload = payloadWriter.finish();
    const payloadHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-view-payload.v1")
      .writeBytes(payload).finish();
    const status = view.status === "complete" ? 0 : view.status === "partial" ? 1 : 2;
    writer.u8(view.domain).u16(1).u8(status).u64(view.revision)
      .u32(view.total).u32(view.selected).u32(view.omitted).u32(view.nextCursor)
      .u16(view.blockers.length);
    for (const blocker of view.blockers) writer.string(blocker);
    writer.u32(payload.byteLength).raw(payloadHash).raw(payload);
  });
  return writer.finish();
}

function mutateBundle(mutate: (rows: {
  runtime: MutableRow;
  binding: MutableRow;
  camera: MutableRow;
}) => void, overrides: Readonly<{ extractionRevision?: bigint; authorityTick?: bigint }> = {}) {
  const decoded = decodeRustDomainBundleR10(GOLDEN_BWX0);
  const rowsByDomain = decoded.views.map((view) => view.rows.map((row) => ({
    kind: row.kind,
    key: row.key,
    bytesFields: new Set<string>(),
    signedFields: new Set<string>(),
    fields: new Map(row.fields.map(([key, value]) => [
      key,
      value instanceof Uint8Array ? Uint8Array.from(value) : value,
    ])),
  })));
  const playerRows = rowsByDomain[1];
  const runtime = playerRows.find((row) => row.kind === 1)!;
  const binding = playerRows.find((row) => row.kind === 2)!;
  const camera = playerRows.find((row) => row.kind === 3)!;
  mutate({ runtime, binding, camera });
  return reencodeBundle(Object.freeze({
    ...decoded,
    extractionRevision: overrides.extractionRevision ?? decoded.extractionRevision,
    authorityTick: overrides.authorityTick ?? decoded.authorityTick,
  }), rowsByDomain);
}

function record(overrides: Partial<RustEntityExtractionRecordR6V3> = {}): RustEntityExtractionRecordR6V3 {
  return Object.freeze({
    entityId: BigInt("4294967297"),
    residency: "hot",
    class: "player",
    simulationTier: "hero",
    protection: BigInt(0),
    entityRevision: BigInt(1),
    externalEntityId: "player:extraction",
    specimenId: "player:extraction",
    kindKey: "player",
    variantKey: null,
    name: "Extraction Player",
    modelKey: "player-standing",
    modelRevision: 0,
    modelHash: ZERO,
    position: Object.freeze({ x: 8, y: 64, z: 8 }),
    yaw: 0,
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    health: 20,
    maximumHealth: 20,
    tamed: false,
    ageTicks: BigInt(0),
    movementMode: "ground",
    grounded: true,
    submerged: false,
    lastDamageTick: BigInt(0),
    action: Object.freeze({ key: "idle", phase: 0, startedTick: BigInt(0), endsTick: BigInt(0), target: null }),
    equipment: Object.freeze([]),
    mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
    research: Object.freeze([]),
    ...overrides,
  });
}

function extraction(
  hud = GOLDEN_BWX0,
  entityRecords: readonly RustEntityExtractionRecordR6V3[] = [record()],
  omitted = 0,
  extractionRevision = 1,
  authorityTick = 0,
): RustIntegratedRuntimeExtractionV1 {
  const entities: RustEntityExtractionR6V3 = Object.freeze({
    schema: 3,
    extractionRevision: BigInt(extractionRevision),
    authorityTick: BigInt(authorityTick),
    contentManifestHash: ZERO,
    contentReady: false,
    total: entityRecords.length + omitted,
    selected: entityRecords.length,
    omitted,
    records: Object.freeze([...entityRecords]),
  });
  return Object.freeze({
    identity: Object.freeze({
      universeId: "1",
      locationId: "surface",
      revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation: 1 }),
      tick: authorityTick,
      stateHash: "b7e3adc7018facd8c83a579e605472b4",
    }),
    extractionRevision,
    render: encodeRustEntityExtractionR6V3(entities),
    hud,
    audio: new Uint8Array(),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: "0".repeat(32),
  });
}

function numberField(fields: ReadonlyMap<string, RustDomainValueR10>, key: string) {
  const value = fields.get(key);
  assert.equal(typeof value, "number");
  return value as number;
}

function profile(fields: ReadonlyMap<string, RustDomainValueR10>): RustIntegratedCameraProfileR10 {
  return Object.freeze({
    eyeHeight: numberField(fields, "profile.eyeHeight"),
    thirdPersonTargetHeight: numberField(fields, "profile.thirdPersonTargetHeight"),
    thirdPersonDistance: numberField(fields, "profile.thirdPersonDistance"),
    thirdPersonPitchScale: numberField(fields, "profile.thirdPersonPitchScale"),
    rearShoulderOffset: numberField(fields, "profile.rearShoulderOffset"),
    collisionRadius: numberField(fields, "profile.collisionRadius"),
    collisionPadding: numberField(fields, "profile.collisionPadding"),
    minimumDistance: numberField(fields, "profile.minimumDistance"),
    baseVerticalFovRadians: numberField(fields, "profile.baseVerticalFovRadians"),
    aimVerticalFovRadians: numberField(fields, "profile.aimVerticalFovRadians"),
    near: numberField(fields, "profile.near"),
    far: numberField(fields, "profile.far"),
  });
}

function refreshCameraHashes(fields: Map<string, RustDomainValueR10>) {
  const mode = fields.get("mode") as RustIntegratedCameraModeR10;
  const aiming = fields.get("aiming") as boolean;
  const cameraProfile = profile(fields);
  fields.set("cameraStateHash", hashBytes(rustIntegratedCameraStateHashR10(
    fields.get("cameraRevision") as bigint,
    mode,
    cameraProfile,
  )));
  fields.set("poseHash", hashBytes(rustLiveCameraPoseHashR10({
    mode,
    aiming,
    position: Object.freeze({
      x: numberField(fields, "position.x"),
      y: numberField(fields, "position.y"),
      z: numberField(fields, "position.z"),
    }),
    orientation: Object.freeze({
      x: numberField(fields, "orientation.x"),
      y: numberField(fields, "orientation.y"),
      z: numberField(fields, "orientation.z"),
      w: numberField(fields, "orientation.w"),
    }),
    projection: Object.freeze({
      verticalFovRadians: numberField(fields, "projection.verticalFovRadians"),
      near: numberField(fields, "projection.near"),
      far: numberField(fields, "projection.far"),
    }),
    viewport: Object.freeze({
      width: Number(fields.get("viewport.width") as bigint),
      height: Number(fields.get("viewport.height") as bigint),
    }),
    collided: fields.get("collided") as boolean,
    resolvedDistance: numberField(fields, "resolvedDistance"),
  })));
}

function decode(hud = GOLDEN_BWX0, requestedView: RustIntegratedRuntimeExtractionViewV1 = VIEW) {
  return decodeRustLiveCameraViewR10(extraction(hud), "player:extraction", requestedView);
}

test("live camera decoder matches the native BWX fixture and preserves negative zero", () => {
  const camera = decode();
  assert.equal(camera.extractionRevision, BigInt(1));
  assert.equal(camera.authorityTick, BigInt(0));
  assert.equal(camera.actorId, "player:extraction");
  assert.equal(camera.externalEntityId, "player:extraction");
  assert.equal(camera.entityId, BigInt("4294967297"));
  assert.equal(camera.playerId, BigInt("12884901895"));
  assert.equal(camera.cameraRevision, BigInt(0));
  assert.equal(camera.mode, "first");
  assert.equal(camera.aiming, false);
  assert.equal(camera.cameraStateHash, "ad97051066840225008448c87e4e7914");
  assert.equal(camera.poseHash, "0128044296a5ae7b000000c87ecee073");
  assert.equal(Object.is(camera.orientation.z, -0), true, "native -0 quaternion component must retain its IEEE sign bit");
  assert.deepEqual(camera.viewport, { width: 1_280, height: 720 });
  assert.equal(camera.viewRevision, BigInt(11));
});

test("camera actor and external entity identities remain independent attested joins", () => {
  const hud = mutateBundle(({ binding, camera }) => {
    binding.fields.set("actorId", "actor:camera-owner");
    camera.fields.set("actorId", "actor:camera-owner");
  });
  const camera = decode(hud);
  assert.equal(camera.actorId, "actor:camera-owner");
  assert.equal(camera.externalEntityId, "player:extraction");
  assert.notEqual(camera.actorId, camera.externalEntityId);
});

test("all frozen camera modes, aiming, collision, and maximum viewport decode exactly", () => {
  const cases = [
    { mode: "first", aiming: true, collided: false, resolvedDistance: 0 },
    { mode: "third-rear", aiming: true, collided: true, resolvedDistance: 3 },
    { mode: "third-front", aiming: false, collided: false, resolvedDistance: 4.35 },
  ] as const;
  for (const expected of cases) {
    const requestedView = Object.freeze({ viewportWidth: 16_384, viewportHeight: 16_384, viewRevision: Number.MAX_SAFE_INTEGER });
    const hud = mutateBundle(({ camera }) => {
      camera.fields.set("mode", expected.mode);
      camera.fields.set("aiming", expected.aiming);
      camera.fields.set("collided", expected.collided);
      camera.fields.set("resolvedDistance", expected.resolvedDistance);
      camera.fields.set("cameraRevision", BigInt(2));
      camera.fields.set("projection.verticalFovRadians", expected.aiming
        ? camera.fields.get("profile.aimVerticalFovRadians")!
        : camera.fields.get("profile.baseVerticalFovRadians")!);
      camera.fields.set("viewport.width", BigInt(requestedView.viewportWidth));
      camera.fields.set("viewport.height", BigInt(requestedView.viewportHeight));
      camera.fields.set("viewRevision", BigInt(requestedView.viewRevision));
      refreshCameraHashes(camera.fields);
    });
    const camera = decode(hud, requestedView);
    assert.equal(camera.mode, expected.mode);
    assert.equal(camera.aiming, expected.aiming);
    assert.equal(camera.collided, expected.collided);
    assert.equal(camera.resolvedDistance, expected.resolvedDistance);
    assert.deepEqual(camera.viewport, { width: 16_384, height: 16_384 });
  }
});

test("camera decoder rejects non-canonical fields, types, views, and viewport bounds", () => {
  const missing = mutateBundle(({ camera }) => { camera.fields.delete("poseHash"); });
  assert.throws(() => decode(missing), /exact canonical field set/u);
  const extra = mutateBundle(({ camera }) => { camera.fields.set("unexpected", BigInt(0)); });
  assert.throws(() => decode(extra), /exact canonical field set/u);
  const wrongType = mutateBundle(({ camera }) => { camera.fields.set("cameraRevision", "0"); });
  assert.throws(() => decode(wrongType), /canonical field types/u);
  const hashEncodedAsBytes = mutateBundle(({ camera }) => { camera.bytesFields.add("poseHash"); });
  assert.throws(() => decode(hashEncodedAsBytes), /canonical field types/u);
  const u64EncodedAsI64 = mutateBundle(({ camera }) => { camera.signedFields.add("cameraRevision"); });
  assert.throws(() => decode(u64EncodedAsI64), /canonical field types/u);
  const extraRow = mutateBundle(({ runtime }) => { runtime.kind = 0; });
  assert.throws(() => decode(extraRow), /frozen runtime, binding, and camera row set/u);
  assert.throws(() => decode(GOLDEN_BWX0, { ...VIEW, viewRevision: 12 }), /echo the requested view/u);
  assert.throws(() => decode(GOLDEN_BWX0, { ...VIEW, viewportWidth: 1_281 }), /echo the requested view/u);
  assert.throws(() => decode(GOLDEN_BWX0, { ...VIEW, viewportWidth: 0 }), /viewport is outside/u);
  assert.throws(() => decode(GOLDEN_BWX0, { ...VIEW, viewportHeight: 16_385 }), /viewport is outside/u);
  assert.throws(() => decode(GOLDEN_BWX0, { ...VIEW, viewRevision: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/u);
});

test("camera decoder rejects every independent identity attestation mismatch", () => {
  const actorMismatch = mutateBundle(({ camera }) => { camera.fields.set("actorId", "actor:wrong"); });
  assert.throws(() => decode(actorMismatch), /actor identities disagree/u);
  const externalMismatch = mutateBundle(({ camera }) => { camera.fields.set("externalEntityId", "player:other"); });
  assert.throws(() => decode(externalMismatch), /external player identity/u);
  const entityMismatch = mutateBundle(({ camera }) => { camera.fields.set("entityId", BigInt(9)); });
  assert.throws(() => decode(entityMismatch), /runtime player entity identities disagree/u);
  const playerMismatch = mutateBundle(({ camera }) => { camera.fields.set("playerId", BigInt(9)); });
  assert.throws(() => decode(playerMismatch), /player identities disagree/u);
  const cold = record({ residency: "cold" });
  assert.throws(
    () => decodeRustLiveCameraViewR10(extraction(GOLDEN_BWX0, [cold]), "player:extraction", VIEW),
    /hot BWR6 player/u,
  );
  assert.throws(
    () => decodeRustLiveCameraViewR10(extraction(GOLDEN_BWX0, [], 1), "player:extraction", VIEW),
    /omitted entity extraction/u,
  );
});

test("camera decoder recomputes state and pose hashes and validates pose semantics", () => {
  const stateHashMismatch = mutateBundle(({ camera }) => {
    const hash = Uint8Array.from(camera.fields.get("cameraStateHash") as Uint8Array);
    hash[0] ^= 0xff;
    camera.fields.set("cameraStateHash", hash);
  });
  assert.throws(() => decode(stateHashMismatch), /state hash does not attest/u);

  const poseHashMismatch = mutateBundle(({ camera }) => {
    const hash = Uint8Array.from(camera.fields.get("poseHash") as Uint8Array);
    hash[15] ^= 0xff;
    camera.fields.set("poseHash", hash);
  });
  assert.throws(() => decode(poseHashMismatch), /pose hash does not attest/u);

  const invalidProfile = mutateBundle(({ camera }) => { camera.fields.set("profile.eyeHeight", 17); });
  assert.throws(() => decode(invalidProfile), /profile is outside/u);

  const invalidFov = mutateBundle(({ camera }) => {
    camera.fields.set("projection.verticalFovRadians", camera.fields.get("profile.aimVerticalFovRadians")!);
  });
  assert.throws(() => decode(invalidFov), /FOV disagrees/u);

  const invalidClip = mutateBundle(({ camera }) => { camera.fields.set("projection.near", 0.06); });
  assert.throws(() => decode(invalidClip), /clip planes disagree/u);

  const invalidQuaternion = mutateBundle(({ camera }) => { camera.fields.set("orientation.w", 2); });
  assert.throws(() => decode(invalidQuaternion), /unit quaternion/u);

  const negativeDistance = mutateBundle(({ camera }) => { camera.fields.set("resolvedDistance", -1); });
  assert.throws(() => decode(negativeDistance), /resolved distance is negative/u);

  const impossibleFirstPersonCollision = mutateBundle(({ camera }) => {
    camera.fields.set("collided", true);
    refreshCameraHashes(camera.fields);
  });
  assert.throws(() => decode(impossibleFirstPersonCollision), /impossible collision state/u);
});

const COMPOSER_EPOCH = BigInt(31);
const COMPOSER_MODEL_HASH = "ab".repeat(16);
const COMPOSER_ENVIRONMENT = Object.freeze({
  clearRgba8: [40, 80, 120, 255] as const,
  ambientRgb8: [120, 130, 140] as const,
  ambientIntensity: 0.6,
  sunDirection: [0.1, 0.9, 0.3] as const,
  sunRgb8: [255, 240, 210] as const,
  sunIntensity: 0.8,
  fogRgb8: [50, 90, 120] as const,
  fogNear: 20,
  fogFar: 240,
  underwater: 0,
  caveOcclusion: 0,
});

class ComposerSink implements RenderSceneExtractionSinkR10 {
  readonly resourcesSeen: RenderResourceBatchV2[] = [];
  readonly framesSeen: RenderFrameV2[] = [];
  readonly sizes: Array<readonly [number, number]> = [];
  rejectNextFrame = false;
  resources(batch: RenderResourceBatchV2) { this.resourcesSeen.push(batch); return true; }
  frame(frame: RenderFrameV2) {
    if (this.rejectNextFrame) { this.rejectNextFrame = false; return false; }
    this.framesSeen.push(frame); return true;
  }
  resize(width: number, height: number) { this.sizes.push([width, height]); }
  requestRecovery() { return true; }
  diagnostics() { return Object.freeze({ state: "ready" }); }
}

class EmptyEntityExtractor {
  extractBytes(bytes: Uint8Array | ArrayBuffer, context: RenderEntityFrameContextR10) {
    const source = decodeRustEntityExtractionR6V3(bytes);
    const revision = source.extractionRevision;
    return Object.freeze({
      extractionRevision: revision,
      authorityTick: source.authorityTick,
      contentManifestHash: Uint8Array.from(source.contentManifestHash),
      modelCatalogHash: COMPOSER_MODEL_HASH,
      modelCatalogRevision: BigInt(1),
      resources: createRenderResourceBatchV2({
        epoch: context.epoch,
        revision,
        operations: [],
      }),
      frame: createRenderFrameV2({
        epoch: context.epoch,
        frameSequence: context.frameSequence,
        simulationTick: context.simulationTick,
        animationTimeMicros: context.animationTimeMicros,
        resourceRevision: revision,
        camera: context.camera,
        environment: context.environment,
        instances: [],
        particles: [],
      }),
      presentations: Object.freeze([]),
      stats: Object.freeze({
        sourceRecords: source.records.length,
        resourceOperations: 0,
        instances: 0,
        hiddenDormant: 0,
        tiers: Object.freeze({ hero: 0, nearby: 0, coarse: 0, dormant: 0 }),
      }),
    });
  }
  resetResourceReplay() { /* No resources in this focused fixture. */ }
  resetRevisionGuard() { /* The source revision itself is canonical. */ }
}

function composerContext(frameSequence: bigint, simulationTick: bigint): RenderRuntimeFrameContextR10 {
  return Object.freeze({
    epoch: COMPOSER_EPOCH,
    frameSequence,
    simulationTick,
    animationTimeMicros: simulationTick * BigInt(16_667),
    environment: COMPOSER_ENVIRONMENT,
  });
}

function terrainFrame(frameSequence: bigint, simulationTick: bigint) {
  return createRenderFrameV2({
    epoch: COMPOSER_EPOCH,
    frameSequence,
    simulationTick,
    animationTimeMicros: simulationTick * BigInt(16_667),
    resourceRevision: BigInt(1),
    camera: Object.freeze({
      position: [999, 998, 997] as const,
      orientation: [0, 1, 0, 0] as const,
      verticalFovRadians: 0.25,
      near: 4,
      far: 8,
      viewport: [1, 1] as const,
    }),
    environment: COMPOSER_ENVIRONMENT,
    instances: [],
    particles: [],
  });
}

function composerExtraction(hud: Uint8Array, revision: number, tick: number) {
  return extraction(Uint8Array.from(hud), [record()], 0, revision, tick);
}

function cameraHud(
  extractionRevision: number,
  authorityTick: number,
  view: RustIntegratedRuntimeExtractionViewV1,
) {
  return mutateBundle(({ camera }) => {
    camera.fields.set("viewport.width", BigInt(view.viewportWidth));
    camera.fields.set("viewport.height", BigInt(view.viewportHeight));
    camera.fields.set("viewRevision", BigInt(view.viewRevision));
    refreshCameraHashes(camera.fields);
  }, { extractionRevision: BigInt(extractionRevision), authorityTick: BigInt(authorityTick) });
}

test("scene composition waits for exact camera authority, ignores terrain camera, and deduplicates", () => {
  const sink = new ComposerSink();
  const composer = new RustRenderSceneComposerR10({
    sink,
    epoch: COMPOSER_EPOCH,
    trustedContentManifestHash: ZERO,
    trustedModelCatalogHash: COMPOSER_MODEL_HASH,
    trustedModelCatalogRevision: BigInt(1),
    entityExtractor: new EmptyEntityExtractor(),
  });
  assert.equal(composer.armRequiredView("player:extraction", VIEW), true);
  assert.equal(composer.resources(createRenderResourceBatchV2({
    epoch: COMPOSER_EPOCH,
    revision: BigInt(1),
    operations: [],
  })), true);

  const firstTerrain = terrainFrame(BigInt(1), BigInt(0));
  assert.equal(composer.frame(firstTerrain), true);
  assert.equal(sink.framesSeen.length, 0, "terrain must remain held before its camera extraction");
  assert.equal(composer.submitRuntimeExtraction(
    composerExtraction(GOLDEN_BWX0, 1, 0),
    composerContext(BigInt(1), BigInt(0)),
  ), true);
  assert.equal(sink.framesSeen.length, 1);
  const authoritative = decodeRustLiveCameraViewR10(composerExtraction(GOLDEN_BWX0, 1, 0), "player:extraction", VIEW);
  assert.deepEqual(sink.framesSeen[0].camera.position, [
    Math.fround(authoritative.position.x),
    Math.fround(authoritative.position.y),
    Math.fround(authoritative.position.z),
  ]);
  assert.notDeepEqual(sink.framesSeen[0].camera.position, firstTerrain.camera.position,
    "the untrusted terrain camera must never reach the composed frame");
  assert.equal(composer.frame(firstTerrain), true);
  assert.equal(sink.framesSeen.length, 1, "same terrain sequence and camera pose must deduplicate");
  assert.equal(composer.diagnostics().deduplicatedCompositions, 1);
});

test("resize gates the old view, view-only extraction recomposes, and only the latest terrain waits", () => {
  const sink = new ComposerSink();
  const composer = new RustRenderSceneComposerR10({
    sink,
    epoch: COMPOSER_EPOCH,
    trustedContentManifestHash: ZERO,
    trustedModelCatalogHash: COMPOSER_MODEL_HASH,
    trustedModelCatalogRevision: BigInt(1),
    entityExtractor: new EmptyEntityExtractor(),
  });
  composer.armRequiredView("player:extraction", VIEW);
  composer.resources(createRenderResourceBatchV2({ epoch: COMPOSER_EPOCH, revision: BigInt(1), operations: [] }));
  composer.frame(terrainFrame(BigInt(1), BigInt(0)));
  composer.submitRuntimeExtraction(
    composerExtraction(GOLDEN_BWX0, 1, 0),
    composerContext(BigInt(1), BigInt(0)),
  );
  assert.equal(sink.framesSeen.length, 1);

  const resizedView = Object.freeze({ viewportWidth: 800, viewportHeight: 600, viewRevision: 12 });
  assert.equal(composer.armRequiredView("player:extraction", resizedView), true);
  assert.deepEqual(sink.sizes, [[1_280, 720], [800, 600]]);
  assert.equal(sink.framesSeen.length, 1, "arming resize must gate the previous camera immediately");
  assert.throws(() => composer.submitRuntimeExtraction(
    composerExtraction(GOLDEN_BWX0, 1, 0),
    composerContext(BigInt(2), BigInt(0)),
  ), /does not echo the requested view/u);

  const resizedHud = cameraHud(2, 0, resizedView);
  assert.equal(composer.submitRuntimeExtraction(
    composerExtraction(resizedHud, 2, 0),
    composerContext(BigInt(2), BigInt(0)),
  ), true);
  assert.equal(sink.framesSeen.length, 2, "view-only camera authority must recompose cached terrain");
  assert.deepEqual(sink.framesSeen[1].camera.viewport, [800, 600]);
  assert.equal(sink.framesSeen[1].frameSequence, BigInt(2), "composed output owns an independent sequence");

  composer.frame(terrainFrame(BigInt(2), BigInt(1)));
  composer.frame(terrainFrame(BigInt(3), BigInt(1)));
  assert.equal(sink.framesSeen.length, 2, "terrain at the wrong camera tick remains held");
  assert.equal(composer.diagnostics().supersededTerrainFrames, 1);
  assert.equal(composer.diagnostics().pendingTerrainFrameSequence, BigInt(3));

  const tickOneHud = cameraHud(3, 1, resizedView);
  const tickOneExtraction = composerExtraction(tickOneHud, 3, 1);
  sink.rejectNextFrame = true;
  assert.equal(composer.submitRuntimeExtraction(
    tickOneExtraction,
    composerContext(BigInt(3), BigInt(1)),
  ), false);
  assert.equal(sink.framesSeen.length, 2);
  assert.equal(composer.diagnostics().cameraAuthorityTick, BigInt(0),
    "a rejected sink frame cannot advance the authoritative camera cursor");
  assert.equal(composer.diagnostics().domainExtractionRevision, BigInt(2),
    "a rejected sink frame cannot advance domain metadata");
  assert.equal(composer.diagnostics().entityExtractionRevision, BigInt(3),
    "entity resources remain recoverably staged after the sink accepted their upload");
  assert.equal(composer.diagnostics().pendingTerrainFrameSequence, BigInt(3));

  assert.equal(composer.submitRuntimeExtraction(
    tickOneExtraction,
    composerContext(BigInt(3), BigInt(1)),
  ), true);
  assert.equal(sink.framesSeen.length, 3);
  assert.equal(sink.framesSeen[2].simulationTick, BigInt(1));
  assert.equal(composer.diagnostics().entityExtractionRevision, BigInt(3),
    "an exact retry deduplicates the staged entity extraction");
  assert.equal(composer.diagnostics().pendingTerrainFrameSequence, null);
});
