import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  decodeRenderEntityModelCatalogR10,
  type RenderEntityModelCatalogManifestR10,
} from "../app/game/rust-render-entity-catalog-r10.ts";
import { decodeRustDomainBundleR10 } from "../app/game/rust-authoritative-extraction-r10.ts";
import { rustIntegratedRuntimeExtractionChecksumV1 } from "../app/game/rust-integrated-runtime-codec.ts";
import {
  RustEntityRenderExtractionR10,
  type RenderEntityExtractionResultR10,
  type RenderEntityPresentationR10,
} from "../app/game/rust-render-entity-extraction-r10.ts";
import {
  decodeRustEntityExtractionR6V3,
  encodeRustEntityExtractionR6V3,
} from "../app/game/rust-entity-authority-codec-r6.ts";
import type { RustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-contract-r6.ts";
import {
  createRenderFrameV2,
  createRenderResourceBatchV2,
  decodeRenderFrameV2,
  decodeRenderResourceBatchV2,
  encodeRenderFrameV2,
  type RenderFrameV2,
  type RenderGeometryV2,
  type RenderInstanceV2,
  type RenderMaterialV2,
  type RenderResourceBatchV2,
} from "../app/game/rust-render-extraction-v2.ts";
import {
  BLOCKWILD_RENDER_PRESENTATION_COVERAGE_R10,
  RENDER_PRESENTATION_CATALOG_ID_V1,
  RENDER_PRESENTATION_CATALOG_REVISION_V1,
} from "../app/game/rust-render-presentation-profile.ts";
import type {
  RustMachinePresentationR10,
  RustPresentationFrameR10,
} from "../app/game/rust-render-presentation-extraction-r10.ts";
import {
  RustRenderSceneComposerR10,
  type RenderSceneExtractionSinkR10,
  type RustRenderSceneComposerOptionsR10,
} from "../app/game/rust-render-scene-composer-r10.ts";
import { createRustRendererComposedRuntimeR10, type RendererBackendR11 } from "../app/game/rust-renderer-backend-r11.ts";
import {
  cameraExtractionFixtureR10,
  RUST_CAMERA_FIXTURE_EXTERNAL_ENTITY_R10,
} from "./helpers/rust-camera-extraction-fixture-r10.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const EPOCH = BigInt(7);
const CONTENT_HASH = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const CATALOG_HASH = "a".repeat(32);
const CATALOG_REVISION = BigInt(1);
const IDENTITY = Object.freeze([0, 0, 0, 1] as const);
const UNIT = Object.freeze([1, 1, 1] as const);
const CAMERA_VIEW_REVISION = 1;
const BWX0_CONTENT_MANIFEST_HASH_OFFSET = 4 + 2 + 8 + 8 + 16;

class CaptureSink implements RenderSceneExtractionSinkR10 {
  readonly resourceBatches: RenderResourceBatchV2[] = [];
  readonly frames: RenderFrameV2[] = [];
  readonly sizes: Array<readonly [number, number]> = [];
  readonly recoveries: string[] = [];
  failed = false;
  resources(batch: RenderResourceBatchV2) { if (this.failed) return false; this.resourceBatches.push(batch); return true; }
  frame(frame: RenderFrameV2) { if (this.failed) return false; this.frames.push(frame); return true; }
  resize(width: number, height: number) { this.sizes.push([width, height]); }
  requestRecovery(reason = "recovery") { if (this.failed) return false; this.recoveries.push(reason); return true; }
  diagnostics() { return Object.freeze({ state: this.failed ? "failed" : "ready" }); }
}

function material(id: bigint, blend: RenderMaterialV2["blend"] = 0): RenderMaterialV2 {
  return Object.freeze({
    id, revision: 1, shading: 2, blend,
    baseColorRgba8: [180, 210, 230, blend === 0 ? 255 : 176] as const,
    emissiveRgb8: [0, 0, 0] as const, emissiveStrength: 0, roughness: 0.72, metalness: 0,
    alphaCutoff: 0, atlasTile: null, doubleSided: blend !== 0, depthWrite: blend === 0,
  });
}

function geometry(id: bigint): RenderGeometryV2 {
  return Object.freeze({
    id, revision: 1, kind: 1,
    bounds: Object.freeze({ minimum: [-0.5, -0.5, -0.5] as const, maximum: [0.5, 0.5, 0.5] as const }),
    positions: Float32Array.of(-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0),
    normals: Int8Array.of(0, 0, 127, 0, 0, 127, 0, 0, 127),
    colors: Uint8Array.of(255, 255, 255, 255, 255, 255, 255, 255, 255),
    lights: new Uint8Array(12), emissions: new Uint8Array(3), occlusions: new Uint8Array(3),
    uvs: Uint16Array.of(0, 0, 65535, 0, 32768, 65535), indices: Uint32Array.of(0, 1, 2),
  });
}

function instance(
  stableId: bigint,
  geometryId: bigint,
  materialId: bigint,
  options: Readonly<{ parent?: bigint | null; x?: number; y?: number; z?: number; flags?: number; domain?: RenderInstanceV2["domain"] }> = {},
): RenderInstanceV2 {
  return Object.freeze({
    stableId, domain: options.domain ?? 1, geometry: geometryId, material: materialId,
    parent: options.parent ?? null,
    transform: Object.freeze({
      translation: Object.freeze([options.x ?? 0, options.y ?? 0, options.z ?? 0] as const),
      rotation: IDENTITY, scale: UNIT,
    }),
    tintRgba8: [255, 255, 255, 255] as const, visibilityMask: 0xffff_ffff, sortKey: 0,
    animationFlags: options.flags ?? 0,
  });
}

function baseFrame(options: Readonly<{
  sequence?: bigint; tick?: bigint; resourceRevision?: bigint; instances?: readonly RenderInstanceV2[];
  environment?: RenderFrameV2["environment"];
}> = {}) {
  return createRenderFrameV2({
    epoch: EPOCH,
    frameSequence: options.sequence ?? BigInt(1),
    simulationTick: options.tick ?? BigInt(10),
    animationTimeMicros: BigInt(500_000),
    resourceRevision: options.resourceRevision ?? BigInt(1),
    camera: Object.freeze({ position: [0, 4, 12] as const, orientation: IDENTITY, verticalFovRadians: 1, near: 0.1, far: 512, viewport: [1280, 720] as const }),
    environment: options.environment ?? Object.freeze({
      clearRgba8: [80, 130, 170, 255] as const, ambientRgb8: [160, 170, 180] as const, ambientIntensity: 0.7,
      sunDirection: [0.2, 0.8, 0.4] as const, sunRgb8: [255, 238, 200] as const, sunIntensity: 0.9,
      fogRgb8: [80, 130, 170] as const, fogNear: 24, fogFar: 220, underwater: 0, caveOcclusion: 0,
    }),
    instances: options.instances ?? [], particles: [],
  });
}

function composer(sink: CaptureSink, options: Readonly<{
  maxInstances?: number;
  extractor?: RustRenderSceneComposerOptionsR10["entityExtractor"];
}> = {}) {
  return new RustRenderSceneComposerR10({
    sink, epoch: EPOCH, trustedContentManifestHash: CONTENT_HASH,
    trustedModelCatalogHash: CATALOG_HASH, trustedModelCatalogRevision: CATALOG_REVISION,
    entityExtractor: options.extractor, maxInstances: options.maxInstances,
  });
}

class EmptyCameraEntityExtractor implements NonNullable<RustRenderSceneComposerOptionsR10["entityExtractor"]> {
  private resourceRevision = BigInt(0);

  constructor(
    private readonly modelCatalogHash: string,
    private readonly modelCatalogRevision: bigint,
    private readonly presentationCoverageHash?: string,
  ) {}

  setResourceRevision(revision: bigint) { this.resourceRevision = revision; }

  extractBytes(bytes: Uint8Array | ArrayBuffer, context: Parameters<RustEntityRenderExtractionR10["extractBytes"]>[1]) {
    const source = decodeRustEntityExtractionR6V3(bytes);
    const resources = this.resourceRevision === BigInt(0)
      ? createRenderResourceBatchV2({ epoch: context.epoch, revision: BigInt(1), operations: [] })
      : null;
    if (resources) this.resourceRevision = resources.revision;
    const result = Object.freeze({
      extractionRevision: source.extractionRevision,
      authorityTick: source.authorityTick,
      contentManifestHash: Uint8Array.from(source.contentManifestHash),
      modelCatalogHash: this.modelCatalogHash,
      modelCatalogRevision: this.modelCatalogRevision,
      resources,
      frame: createRenderFrameV2({
        epoch: context.epoch,
        frameSequence: context.frameSequence,
        simulationTick: context.simulationTick,
        animationTimeMicros: context.animationTimeMicros,
        resourceRevision: this.resourceRevision,
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
    if (this.presentationCoverageHash === undefined) return result;
    return Object.freeze({
      ...result,
      presentationFrame: Object.freeze({
        schema: 1 as const,
        extractionRevision: source.extractionRevision,
        authorityTick: source.authorityTick,
        coverageHash: this.presentationCoverageHash,
        bindings: Object.freeze([]),
        heldBlockers: Object.freeze([]),
        droppedBlockers: Object.freeze([]),
        machineBlockers: Object.freeze([]),
        combatBlockers: Object.freeze([]),
        runtimeBlockers: Object.freeze([]),
      }),
    });
  }

  resetResourceReplay() {}
  resetRevisionGuard() {}
}

class CameraPlayerFilteringExtractor implements NonNullable<RustRenderSceneComposerOptionsR10["entityExtractor"]> {
  constructor(private readonly delegate: RustEntityRenderExtractionR10) {}

  extractBytes(bytes: Uint8Array | ArrayBuffer, context: Parameters<RustEntityRenderExtractionR10["extractBytes"]>[1]) {
    const source = decodeRustEntityExtractionR6V3(bytes);
    const records = source.records.filter((record) => record.externalEntityId !== RUST_CAMERA_FIXTURE_EXTERNAL_ENTITY_R10);
    assert.equal(records.length + 1, source.records.length, "camera-bound extraction must contain one fixture player");
    return this.delegate.extractBytes(encodeRustEntityExtractionR6V3(Object.freeze({
      ...source,
      total: records.length,
      selected: records.length,
      records: Object.freeze(records),
    })), context);
  }

  resetResourceReplay() { this.delegate.resetResourceReplay(); }
  resetRevisionGuard() { this.delegate.resetRevisionGuard(); }
}

function authoritativeCameraView(frame: RenderFrameV2) {
  return Object.freeze({
    viewportWidth: frame.camera.viewport[0],
    viewportHeight: frame.camera.viewport[1],
    viewRevision: CAMERA_VIEW_REVISION,
  });
}

function armAuthoritativeCamera(runtime: RustRenderSceneComposerR10, frame: RenderFrameV2) {
  return runtime.armRequiredView(
    RUST_CAMERA_FIXTURE_EXTERNAL_ENTITY_R10,
    authoritativeCameraView(frame),
  );
}

function submitAuthoritativeCamera(
  runtime: RustRenderSceneComposerR10,
  frame: RenderFrameV2,
  contentManifestHash: Uint8Array,
  extractionRevision: number,
  renderBytes?: Uint8Array,
) {
  assert.equal(contentManifestHash.byteLength, 16);
  assert.equal(Number.isSafeInteger(Number(frame.simulationTick)), true);
  const fixture = cameraExtractionFixtureR10({
    identity: Object.freeze({
      universeId: "scene-composer-fixture",
      locationId: "surface",
      revision: Object.freeze({
        epoch: 1,
        world: 1,
        entities: 1,
        gameplay: 1,
        persistence: 1,
        network: 1,
        simulation: 1,
      }),
      tick: Number(frame.simulationTick),
      stateHash: extractionRevision.toString(16).padStart(32, "0"),
    }),
    extractionRevision,
    view: authoritativeCameraView(frame),
    cameraRevision: BigInt(extractionRevision),
    mode: "first",
  });
  const hud = Uint8Array.from(fixture.hud);
  assert.equal(new TextDecoder().decode(hud.subarray(0, 4)), "BWX0");
  assert.equal(new DataView(hud.buffer, hud.byteOffset + 4, 2).getUint16(0, true), 1);
  // BWX0 has no aggregate envelope checksum: this fixed header field is the
  // content attestation, while each unchanged domain payload carries its own
  // hash. Re-attest the fixture, decode it again, and recompute the outer
  // integrated-runtime extraction checksum below.
  hud.set(contentManifestHash, BWX0_CONTENT_MANIFEST_HASH_OFFSET);
  assert.deepEqual(decodeRustDomainBundleR10(hud).contentManifestHash, contentManifestHash);
  const cameraEntities = decodeRustEntityExtractionR6V3(fixture.render);
  const supplied = renderBytes ? decodeRustEntityExtractionR6V3(renderBytes) : null;
  if (supplied) {
    assert.equal(supplied.extractionRevision, cameraEntities.extractionRevision);
    assert.equal(supplied.authorityTick, cameraEntities.authorityTick);
    assert.equal(supplied.omitted, 0, "camera-bound extraction cannot omit authoritative entities");
  }
  const records = supplied
    ? Object.freeze([...cameraEntities.records, ...supplied.records]
      .sort((left, right) => left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0))
    : cameraEntities.records;
  assert.equal(new Set(records.map((record) => record.entityId)).size, records.length,
    "camera-bound extraction entity ids must be unique");
  const render = encodeRustEntityExtractionR6V3(Object.freeze({
    ...(supplied ?? cameraEntities),
    contentManifestHash: Uint8Array.from(contentManifestHash),
    total: records.length,
    selected: records.length,
    omitted: 0,
    records,
  }));
  const extraction = Object.freeze({
    ...fixture,
    render,
    hud,
    extractionHash: rustIntegratedRuntimeExtractionChecksumV1({
      ...fixture,
      render,
      hud,
    }),
  });
  return runtime.submitRuntimeExtraction(extraction, Object.freeze({
    epoch: frame.epoch,
    frameSequence: BigInt(extractionRevision),
    simulationTick: frame.simulationTick,
    animationTimeMicros: frame.animationTimeMicros,
    environment: frame.environment,
  }));
}

function presentation(
  entityId: bigint,
  instanceIds: readonly bigint[],
  options: Readonly<{
    tier?: RenderEntityPresentationR10["tier"];
    parentMount?: bigint | null;
    occupiedSeat?: number | null;
    seats?: RenderEntityPresentationR10["mount"]["seats"];
    equipmentIds?: readonly bigint[];
  }> = {},
): RenderEntityPresentationR10 {
  return Object.freeze({
    entityId, entityRevision: BigInt(4), class: "creature", externalEntityId: `external-${entityId}`, specimenId: `specimen-${entityId}`,
    kindKey: "test-creature", variantKey: "aurora", name: "Ægir 🐉", modelKey: "test-model", modelRevision: 1,
    modelHash: Uint8Array.from({ length: 16 }, (_, index) => 0xf0 - index), residency: "hot", tier: options.tier ?? "hero",
    protection: BigInt(9), tamed: true, movementMode: options.parentMount ? "mounted" : "ground",
    action: Object.freeze({ key: "stride", phase: 3, startedTick: BigInt(8), endsTick: BigInt(20), target: null }),
    research: Object.freeze([["ecology", 2], ["identity", 4]] as const),
    equipment: Object.freeze(options.equipmentIds ? [Object.freeze({
      slotKey: "main_hand", itemKey: "iron_sword", count: 1, durability: 200,
      custom: Object.freeze([["inscription", Uint8Array.from([0, 0x80, 0xff])] as const]),
      instanceIds: Object.freeze([...options.equipmentIds]),
    })] : []),
    mount: Object.freeze({
      parentMount: options.parentMount ?? null, occupiedSeat: options.occupiedSeat ?? null,
      acceptsRiders: (options.seats?.length ?? 0) > 0, saddleKey: options.seats?.length ? "saddle" : null,
      seats: options.seats ?? Object.freeze([]),
    }),
    instanceIds: Object.freeze([...instanceIds]), visible: true,
  });
}

function syntheticEntityResult(options: Readonly<{
  extractionRevision?: bigint;
  tick?: bigint;
  resourceRevision?: bigint;
  resources?: RenderResourceBatchV2 | null;
  instances: readonly RenderInstanceV2[];
  presentations: readonly RenderEntityPresentationR10[];
  catalogHash?: string;
}>): RenderEntityExtractionResultR10 {
  const resources = options.resources === undefined ? createRenderResourceBatchV2({
    epoch: EPOCH, revision: BigInt(1), operations: [
      { kind: "upsert-material", material: material(BigInt(30), 2) },
      { kind: "upsert-geometry", geometry: geometry(BigInt(40)) },
    ],
  }) : options.resources;
  const tick = options.tick ?? BigInt(10);
  return Object.freeze({
    extractionRevision: options.extractionRevision ?? BigInt(1), authorityTick: tick,
    contentManifestHash: Uint8Array.from(CONTENT_HASH), modelCatalogHash: options.catalogHash ?? CATALOG_HASH,
    modelCatalogRevision: CATALOG_REVISION, resources,
    frame: baseFrame({
      sequence: options.extractionRevision ?? BigInt(1),
      tick,
      resourceRevision: options.resourceRevision ?? resources?.revision ?? BigInt(1),
      instances: options.instances,
    }),
    presentations: Object.freeze([...options.presentations]),
    stats: Object.freeze({ sourceRecords: options.presentations.length, resourceOperations: resources?.operations.length ?? 0,
      instances: options.instances.length, hiddenDormant: 0, tiers: Object.freeze({ hero: options.presentations.length, nearby: 0, coarse: 0, dormant: 0 }) }),
  });
}

function litEnvironment(): RenderFrameV2["environment"] {
  return Object.freeze({
    ...baseFrame().environment,
    lighting: Object.freeze({
      blockIntensity: 1.35,
      minimumAmbient: 0.026,
      waterPhase: 0.375,
      held: Object.freeze({
        position: Object.freeze([1, 2, 3] as const),
        colorRgb8: Object.freeze([255, 116, 40] as const),
        intensity: 0.72,
        radius: 9,
      }),
      machine: Object.freeze({
        position: Object.freeze([777, 778, 779] as const),
        colorRgb8: Object.freeze([1, 2, 3] as const),
        intensity: 99,
        radius: 98,
      }),
    }),
  });
}

function exactMachinePresentation(instanceId: bigint): RustMachinePresentationR10 {
  const contract = BLOCKWILD_RENDER_PRESENTATION_COVERAGE_R10.entries.find((entry) =>
    entry.family === "machine" && entry.profileId === "machine:apiary");
  assert.ok(contract?.status === "exact-contract" && contract.modelId !== null);
  const profileId = contract.profileId;
  const modelId = contract.modelId;
  assert.ok(profileId !== null && modelId !== null);
  const contentHash = Uint8Array.from({ length: 16 }, (_, index) => 0x40 + index);
  return Object.freeze({
    id: "machine:anchor:machine:apiary:test:profile:machine:apiary",
    role: "machine",
    machineId: "machine:apiary:test",
    anchorRevision: BigInt(9),
    presentationId: profileId,
    profileId,
    modelId,
    contentVersion: 2,
    contentHash,
    positionMilli: Object.freeze([BigInt(4_000), BigInt(65_000), BigInt(-8_000)] as const),
    rotationMicroturns: Object.freeze([250_000, 0, 0] as const),
    halfExtentsMilli: Object.freeze([500, 1_000, 750] as const),
    gameplayRevision: BigInt(12),
    gameplayActive: true,
    light: Object.freeze({
      kind: 0,
      colorMillionths: Object.freeze([1_000_000, 700_000, 300_000] as const),
      luminousFluxMillilumens: BigInt(900_000),
      rangeMilli: 12_000,
      innerConeMicroturns: 0,
      outerConeMicroturns: 0,
      castsShadows: false,
      enabled: true,
    }),
    binding: Object.freeze({
      role: "machine",
      primaryContentRef: Object.freeze({ domain: "machine-profile", id: "apiary" }),
      profileId,
      modelId,
      presentationCatalog: Object.freeze({
        id: RENDER_PRESENTATION_CATALOG_ID_V1,
        schema: BLOCKWILD_RENDER_PRESENTATION_COVERAGE_R10.profileCatalogSchema,
        revision: RENDER_PRESENTATION_CATALOG_REVISION_V1,
        contentVersion: 2,
        contentHash: Uint8Array.from(contentHash),
      }),
      modelCatalog: Object.freeze({
        revision: CATALOG_REVISION,
        canonicalHash: BLOCKWILD_RENDER_PRESENTATION_COVERAGE_R10.modelCatalogHash,
        sha256: "b".repeat(64),
      }),
    }),
    instanceIds: Object.freeze([instanceId]),
  });
}

function presentationFrame(
  extractionRevision: bigint,
  bindings: RustPresentationFrameR10["bindings"],
): RustPresentationFrameR10 {
  return Object.freeze({
    schema: 1,
    extractionRevision,
    authorityTick: BigInt(10),
    coverageHash: BLOCKWILD_RENDER_PRESENTATION_COVERAGE_R10.coverageHash,
    bindings: Object.freeze([...bindings]),
    heldBlockers: Object.freeze([]),
    droppedBlockers: Object.freeze([]),
    machineBlockers: Object.freeze([]),
    combatBlockers: Object.freeze([]),
    runtimeBlockers: Object.freeze([]),
  });
}

test("R10 replaces and clears the shell machine slot from exact same-envelope machine revisions", () => {
  const sink = new CaptureSink();
  const coverage = BLOCKWILD_RENDER_PRESENTATION_COVERAGE_R10;
  const cameraExtractor = new EmptyCameraEntityExtractor(
    coverage.modelCatalogHash,
    CATALOG_REVISION,
    coverage.coverageHash,
  );
  const runtime = new RustRenderSceneComposerR10({
    sink,
    epoch: EPOCH,
    trustedContentManifestHash: CONTENT_HASH,
    trustedModelCatalogHash: coverage.modelCatalogHash,
    trustedModelCatalogRevision: CATALOG_REVISION,
    entityExtractor: cameraExtractor,
    presentationCoverage: coverage,
  });
  const terrain = instance(BigInt(11), BigInt(20), BigInt(10), { domain: 0 });
  const terrainFrame = baseFrame({ instances: [terrain], environment: litEnvironment() });
  assert.equal(armAuthoritativeCamera(runtime, terrainFrame), true);
  assert.equal(runtime.resources(createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(1), operations: [
    { kind: "upsert-material", material: material(BigInt(10)) },
    { kind: "upsert-geometry", geometry: geometry(BigInt(20)) },
  ] })), true);
  assert.equal(submitAuthoritativeCamera(runtime, terrainFrame, CONTENT_HASH, 1), true);

  const machineInstance = instance(BigInt(501), BigInt(40), BigInt(30), { domain: 5 });
  const machine = exactMachinePresentation(machineInstance.stableId);
  const machineResources = createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(2), operations: [
    { kind: "upsert-material", material: material(BigInt(30)) },
    { kind: "upsert-geometry", geometry: geometry(BigInt(40)) },
  ] });
  const machineResult = Object.freeze({
    ...syntheticEntityResult({
      extractionRevision: BigInt(2),
      resources: machineResources,
      instances: [machineInstance],
      presentations: [],
      catalogHash: coverage.modelCatalogHash,
    }),
    presentationFrame: presentationFrame(BigInt(2), [machine]),
  });
  assert.equal(runtime.submitEntities(machineResult), true);
  assert.equal(runtime.frame(terrainFrame), true);
  assert.deepEqual(sink.frames[0]?.environment.lighting?.machine, {
    position: [4, 65, -8],
    colorRgb8: [255, 179, 77],
    intensity: Math.fround(0.9),
    radius: 12,
  });
  assert.deepEqual(runtime.diagnostics().machineLight, {
    schema: 1,
    status: "selected",
    sourcePresentations: 1,
    exactLightProfiles: 1,
    eligiblePointLights: 1,
    selectedMachineId: "machine:apiary:test",
    selectedAnchorRevision: BigInt(9),
    selectedGameplayRevision: BigInt(12),
    selectedCastsShadows: false,
    omitted: [],
  });

  const removed = Object.freeze({
    ...syntheticEntityResult({
      extractionRevision: BigInt(3),
      resourceRevision: BigInt(2),
      resources: null,
      instances: [],
      presentations: [],
      catalogHash: coverage.modelCatalogHash,
    }),
    presentationFrame: presentationFrame(BigInt(3), []),
  });
  assert.equal(runtime.submitEntities(removed), true);
  sink.failed = true;
  assert.equal(runtime.frame(terrainFrame), false,
    "a rejected downstream frame must not claim that the machine slot cleared");
  assert.equal(runtime.diagnostics().machineLight.status, "selected");
  const conflictingRetry = Object.freeze({
    ...removed,
    presentationFrame: presentationFrame(BigInt(3), [machine]),
  });
  assert.throws(() => runtime.submitEntities(conflictingRetry), /stale entity extraction revision/u,
    "one BWR6 revision cannot retry with a different BWX0 presentation frame");
  sink.failed = false;
  assert.equal(runtime.frame(terrainFrame), true,
    "a new entity revision must recompose even when terrain and camera are unchanged");
  assert.deepEqual(sink.frames[1]?.environment.lighting?.machine, {
    position: [0, 0, 0], colorRgb8: [0, 0, 0], intensity: 0, radius: 0,
  });
  assert.equal(runtime.diagnostics().machineLight.status, "cleared");
  assert.equal(runtime.diagnostics().machineLight.sourcePresentations, 0);
  assert.equal(runtime.submitEntities(removed), true);
  assert.equal(runtime.frame(terrainFrame), true);
  assert.equal(sink.frames.length, 2, "an exact machine-removal retry must deduplicate");
});

test("R10 snapshots one data-only ordinary presentation envelope before retry deduplication", () => {
  const coverage = BLOCKWILD_RENDER_PRESENTATION_COVERAGE_R10;
  const runtime = new RustRenderSceneComposerR10({
    sink: new CaptureSink(),
    epoch: EPOCH,
    trustedContentManifestHash: CONTENT_HASH,
    trustedModelCatalogHash: coverage.modelCatalogHash,
    trustedModelCatalogRevision: CATALOG_REVISION,
    entityExtractor: new EmptyCameraEntityExtractor(
      coverage.modelCatalogHash,
      CATALOG_REVISION,
      coverage.coverageHash,
    ),
    presentationCoverage: coverage,
  });
  const base = syntheticEntityResult({
    extractionRevision: BigInt(1),
    instances: [],
    presentations: [],
    catalogHash: coverage.modelCatalogHash,
  });
  const envelope = (frame: unknown) => Object.freeze({
    ...base,
    presentationFrame: frame,
  }) as RenderEntityExtractionResultR10;

  let getterCalls = 0;
  const accessorEnvelope = { ...base } as RenderEntityExtractionResultR10;
  Object.defineProperty(accessorEnvelope, "presentationFrame", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return presentationFrame(BigInt(1), []);
    },
  });
  Object.freeze(accessorEnvelope);
  assert.throws(() => runtime.submitEntities(accessorEnvelope),
    /presentation frame must be an enumerable data property/u);
  assert.equal(getterCalls, 0, "the injected presentation getter must never execute");

  const hiddenFieldFrame = { ...presentationFrame(BigInt(1), []) };
  Object.defineProperty(hiddenFieldFrame, "bindings", {
    value: Object.freeze([]),
    enumerable: false,
  });
  Object.freeze(hiddenFieldFrame);
  assert.throws(() => runtime.submitEntities(envelope(hiddenFieldFrame)),
    /presentation frame identity contains a non-enumerable field/u);

  const symbolFrame = { ...presentationFrame(BigInt(1), []) };
  Object.defineProperty(symbolFrame, Symbol("hidden-presentation-field"), {
    value: true,
    enumerable: true,
  });
  Object.freeze(symbolFrame);
  assert.throws(() => runtime.submitEntities(envelope(symbolFrame)),
    /presentation frame identity record contains a symbol property/u);

  let arrayHookCalls = 0;
  const hostileBindings: RustPresentationFrameR10["bindings"][number][] = [];
  const hostileArrayPrototype = Object.create(Array.prototype) as Record<PropertyKey, unknown>;
  Object.defineProperty(hostileArrayPrototype, "map", {
    value() { arrayHookCalls += 1; return []; },
  });
  Object.defineProperty(hostileArrayPrototype, Symbol.iterator, {
    value() { arrayHookCalls += 1; return [][Symbol.iterator](); },
  });
  Object.setPrototypeOf(hostileBindings, hostileArrayPrototype);
  Object.freeze(hostileBindings);
  assert.throws(() => runtime.submitEntities(envelope(Object.freeze({
    ...presentationFrame(BigInt(1), []),
    bindings: hostileBindings,
  }))), /presentation frame identity contains a non-ordinary array/u);
  assert.equal(arrayHookCalls, 0, "array subclass hooks must not execute");

  let byteIteratorCalls = 0;
  const machine = exactMachinePresentation(BigInt(501));
  const hostileContentHash = Uint8Array.from(machine.contentHash);
  const hostileBytesPrototype = Object.create(Uint8Array.prototype) as Record<PropertyKey, unknown>;
  Object.defineProperty(hostileBytesPrototype, Symbol.iterator, {
    value() { byteIteratorCalls += 1; return [][Symbol.iterator](); },
  });
  Object.setPrototypeOf(hostileContentHash, hostileBytesPrototype);
  const hostileMachine = Object.freeze({ ...machine, contentHash: hostileContentHash });
  assert.throws(() => runtime.submitEntities(envelope(presentationFrame(BigInt(1), [hostileMachine]))),
    /presentation frame identity contains a non-ordinary byte array/u);
  assert.equal(byteIteratorCalls, 0, "typed-array subclass hooks must not execute");
});

test("R10 composes terrain, articulated mounts, equipment, transparency, and immutable UI metadata", () => {
  const sink = new CaptureSink();
  const cameraExtractor = new EmptyCameraEntityExtractor(CATALOG_HASH, CATALOG_REVISION);
  const runtime = composer(sink, { extractor: cameraExtractor });
  const terrainResources = createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(1), operations: [
    { kind: "upsert-material", material: material(BigInt(10)) },
    { kind: "upsert-geometry", geometry: geometry(BigInt(20)) },
  ] });
  const terrainInstance = instance(BigInt(11), BigInt(20), BigInt(10), { x: -2, domain: 0 });
  const terrainFrame = baseFrame({ instances: [terrainInstance] });
  assert.equal(armAuthoritativeCamera(runtime, terrainFrame), true);
  assert.equal(runtime.resources(terrainResources), true);
  assert.equal(submitAuthoritativeCamera(runtime, terrainFrame, CONTENT_HASH, 1), true);
  assert.equal(runtime.diagnostics().entityResourceRevision, BigInt(1),
    "camera extraction establishes a valid empty entity resource catalogue");
  const phaseFlags = (3 << 16) | 5;
  const entities = [
    instance(BigInt(1001), BigInt(40), BigInt(30), { x: 1, flags: phaseFlags }),
    instance(BigInt(1002), BigInt(40), BigInt(30), { parent: BigInt(1001), y: 1.8, flags: 0 }),
    instance(BigInt(1003), BigInt(40), BigInt(30), { parent: BigInt(1002), z: -0.2, flags: phaseFlags, domain: 2 }),
    instance(BigInt(1004), BigInt(40), BigInt(30), { parent: BigInt(1003), x: 0.5, flags: 0, domain: 3 }),
    instance(BigInt(1005), BigInt(40), BigInt(30), { parent: BigInt(1004), flags: phaseFlags, domain: 3 }),
  ];
  const entityResources = createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(2), operations: [
    { kind: "upsert-material", material: material(BigInt(30), 2) },
    { kind: "upsert-geometry", geometry: geometry(BigInt(40)) },
  ] });
  const seat = Object.freeze({ index: 0, role: "rider", offset: Object.freeze({ x: 0, y: 1.8, z: -0.2 }), occupant: BigInt(2), controlWeightMilli: 1_000 });
  assert.equal(runtime.submitEntities(syntheticEntityResult({
    extractionRevision: BigInt(2),
    resources: entityResources,
    instances: entities,
    presentations: [
      presentation(BigInt(1), [BigInt(1001)], { seats: Object.freeze([seat]) }),
      presentation(BigInt(2), [BigInt(1003)], { parentMount: BigInt(1), occupiedSeat: 0, equipmentIds: [BigInt(1005)] }),
    ],
  })), true);
  assert.equal(runtime.frame(terrainFrame), true);
  assert.deepEqual(sink.resourceBatches.map((batch) => batch.revision), [BigInt(1), BigInt(2)]);
  const output = sink.frames[0]!;
  assert.equal(output.resourceRevision, BigInt(2));
  assert.equal(output.frameSequence, BigInt(1));
  assert.equal(output.instances.length, 6);
  assert.equal(output.instances.find((value) => value.stableId === BigInt(1003))?.parent, BigInt(1002));
  assert.deepEqual(output.instances.find((value) => value.stableId === BigInt(1005))?.transform, entities[4]!.transform);
  assert.equal(output.instances.at(-1)?.material, BigInt(30), "transparent entity material must remain in the transparent tail");

  const metadata = runtime.entityMetadata();
  assert.equal(metadata.entries[1]?.name, "Ægir 🐉");
  assert.equal(metadata.entries[1]?.actionPhase, 3);
  assert.equal(metadata.entries[1]?.equipment[0]?.custom[0]?.[1], "0080ff");
  assert.equal(Object.isFrozen(metadata.entries), true);
  assert.equal(Object.isFrozen(metadata.entries[1]?.mount.seats), true);
  assert.throws(() => (metadata.entries as unknown as RenderEntityPresentationViewForMutation[]).push({} as never), /extensible|read only|frozen|object is not extensible/iu);
  assert.equal(runtime.requestRecovery("synthetic device reset"), true);
  assert.deepEqual(sink.recoveries, ["synthetic device reset"]);
  assert.equal(runtime.diagnostics().recoveryRequests, 1);
});

type RenderEntityPresentationViewForMutation = { entityId: bigint };

test("R10 deduplicates shared resources, removes only the final owner, and resurrects cached entity resources", () => {
  const sink = new CaptureSink(), runtime = composer(sink);
  const sharedMaterial = material(BigInt(10));
  runtime.resources(createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(1), operations: [
    { kind: "upsert-material", material: sharedMaterial },
    { kind: "upsert-geometry", geometry: geometry(BigInt(20)) },
  ] }));
  const entityResources = createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(1), operations: [
    { kind: "upsert-material", material: sharedMaterial },
    { kind: "upsert-geometry", geometry: geometry(BigInt(40)) },
  ] });
  const visible = instance(BigInt(100), BigInt(40), BigInt(10), { flags: 3 << 16 });
  runtime.submitEntities(syntheticEntityResult({ resources: entityResources, instances: [visible], presentations: [presentation(BigInt(1), [BigInt(100)])] }));
  assert.equal(sink.resourceBatches[1]?.operations.length, 1, "the shared material must not upload twice");
  assert.equal(sink.resourceBatches[1]?.operations[0]?.kind, "upsert-geometry");

  runtime.submitEntities(syntheticEntityResult({ extractionRevision: BigInt(2), resources: null, instances: [], presentations: [] }));
  assert.equal(sink.resourceBatches[2]?.operations[0]?.kind, "remove-geometry");
  assert.equal(runtime.diagnostics().residentResources, 2, "terrain still owns the shared material and geometry");

  runtime.resources(createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(2), operations: [
    { kind: "remove-material", id: BigInt(10) },
  ] }));
  assert.equal(sink.resourceBatches[3]?.operations[0]?.kind, "remove-material");
  runtime.submitEntities(syntheticEntityResult({ extractionRevision: BigInt(3), resources: null, instances: [visible], presentations: [presentation(BigInt(1), [BigInt(100)])] }));
  assert.deepEqual(sink.resourceBatches[4]?.operations.map((operation) => operation.kind), ["upsert-material", "upsert-geometry"]);
  assert.equal(runtime.diagnostics().deduplicatedResourceOperations > 0, true);
  assert.equal(runtime.diagnostics().removedResources, 2);
});

test("R10 keeps priority groups whole and rejects stale, future, and unattested source records", () => {
  const sink = new CaptureSink();
  const cameraExtractor = new EmptyCameraEntityExtractor(CATALOG_HASH, CATALOG_REVISION);
  const runtime = composer(sink, { maxInstances: 5, extractor: cameraExtractor });
  const terrain = instance(BigInt(1), BigInt(20), BigInt(10), { domain: 0 });
  const firstTerrainFrame = baseFrame({ instances: [terrain] });
  assert.equal(armAuthoritativeCamera(runtime, firstTerrainFrame), true);
  runtime.resources(createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(1), operations: [
    { kind: "upsert-material", material: material(BigInt(10)) },
    { kind: "upsert-geometry", geometry: geometry(BigInt(20)) },
  ] }));
  const entityResources = createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(2), operations: [
    { kind: "upsert-material", material: material(BigInt(30)) },
    { kind: "upsert-geometry", geometry: geometry(BigInt(40)) },
  ] });
  const flags = 3 << 16;
  const groups = [
    instance(BigInt(101), BigInt(40), BigInt(30), { flags }), instance(BigInt(102), BigInt(40), BigInt(30), { parent: BigInt(101), flags }),
    instance(BigInt(201), BigInt(40), BigInt(30), { flags }), instance(BigInt(202), BigInt(40), BigInt(30), { parent: BigInt(201), flags }),
    instance(BigInt(301), BigInt(40), BigInt(30), { flags }), instance(BigInt(302), BigInt(40), BigInt(30), { parent: BigInt(301), flags }),
  ];
  assert.equal(submitAuthoritativeCamera(runtime, firstTerrainFrame, CONTENT_HASH, 1), true);
  runtime.submitEntities(syntheticEntityResult({ resources: entityResources, instances: groups, presentations: [
    presentation(BigInt(1), [BigInt(101), BigInt(102)], { tier: "hero" }),
    presentation(BigInt(2), [BigInt(201), BigInt(202)], { tier: "nearby" }),
    presentation(BigInt(3), [BigInt(301), BigInt(302)], { tier: "coarse" }),
  ], extractionRevision: BigInt(2) }));
  cameraExtractor.setResourceRevision(BigInt(2));
  assert.equal(runtime.frame(firstTerrainFrame), true);
  assert.deepEqual(sink.frames[0]?.instances.map((value) => value.stableId).sort(), [BigInt(1), BigInt(101), BigInt(102), BigInt(201), BigInt(202)]);
  assert.equal(runtime.diagnostics().omittedEntityGroups, 1);
  assert.equal(runtime.diagnostics().omittedEntityInstances, 2);
  assert.equal(runtime.frame(firstTerrainFrame), true, "an exact terrain/camera retry is idempotent");
  assert.equal(sink.frames.length, 1, "an exact retry must not emit a duplicate composed frame");
  assert.throws(() => runtime.resources(createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(3), operations: [] })), /revision gap/u);
  assert.throws(() => runtime.submitEntities(syntheticEntityResult({ extractionRevision: BigInt(3), tick: BigInt(11), resourceRevision: BigInt(2), resources: null, instances: groups, presentations: [
    presentation(BigInt(1), [BigInt(101), BigInt(102)]), presentation(BigInt(2), [BigInt(201), BigInt(202)]), presentation(BigInt(3), [BigInt(301), BigInt(302)]),
  ], catalogHash: "b".repeat(32) })), /catalog attestation/u);

  const futureEntityFrame = baseFrame({ sequence: BigInt(2), tick: BigInt(11), instances: [terrain] });
  assert.equal(submitAuthoritativeCamera(runtime, futureEntityFrame, CONTENT_HASH, 3), true);
  runtime.submitEntities(syntheticEntityResult({ extractionRevision: BigInt(4), tick: BigInt(12), resourceRevision: BigInt(2), resources: null, instances: groups, presentations: [
    presentation(BigInt(1), [BigInt(101), BigInt(102)]), presentation(BigInt(2), [BigInt(201), BigInt(202)]), presentation(BigInt(3), [BigInt(301), BigInt(302)]),
  ] }));
  assert.equal(runtime.frame(futureEntityFrame), false, "terrain older than entity authority must wait");
  const currentFrame = baseFrame({ sequence: BigInt(3), tick: BigInt(12), instances: [terrain] });
  assert.equal(submitAuthoritativeCamera(runtime, currentFrame, CONTENT_HASH, 5), true);
  runtime.submitEntities(syntheticEntityResult({ extractionRevision: BigInt(6), tick: BigInt(12), resourceRevision: BigInt(2), resources: null, instances: groups, presentations: [
    presentation(BigInt(1), [BigInt(101), BigInt(102)]), presentation(BigInt(2), [BigInt(201), BigInt(202)]), presentation(BigInt(3), [BigInt(301), BigInt(302)]),
  ] }));
  assert.equal(runtime.frame(currentFrame), true);
  assert.equal(runtime.frame(futureEntityFrame), false, "a superseded terrain sequence remains stale");
});

test("dense canonical BWR6 v3 bytes compose deterministically with terrain and trusted BWM2", async () => {
  const manifestSource = JSON.parse(await readFile(path.join(ROOT, "public", "renderer", "manifest.json"), "utf8")) as Record<string, unknown>;
  const current = String(manifestSource.current);
  const manifest: RenderEntityModelCatalogManifestR10 = {
    schema: 2, format: "blockwild-compiled-model-catalog-v2", revision: BigInt(1), current,
    sha256: String(manifestSource.sha256), catalogHash: String(manifestSource.catalogHash),
    byteLength: Number(manifestSource.byteLength), modelCount: Number(manifestSource.modelCount), nodeCount: Number(manifestSource.nodeCount),
  };
  const catalog = await decodeRenderEntityModelCatalogR10(
    new Uint8Array(await readFile(path.join(ROOT, "public", "renderer", current, "models.bwm2"))), manifest,
  );
  const runtimeManifest = manifestSource.runtime as { artifactHash: string };
  const fixtureRoot = path.join(ROOT, "public", "renderer", runtimeManifest.artifactHash);
  const terrainResources = decodeRenderResourceBatchV2(new Uint8Array(await readFile(path.join(fixtureRoot, "canonical-resources.bwrd"))));
  const terrainFrameSource = decodeRenderFrameV2(new Uint8Array(await readFile(path.join(fixtureRoot, "canonical-frame.bwrf"))));
  const epoch = terrainFrameSource.epoch;
  const modelHash = Uint8Array.from({ length: 16 }, (_, index) => 0x20 + index);
  const contentHash = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  assert.notDeepEqual(contentHash, new Uint8Array(16), "dense fixture keeps a resolved nonzero content attestation");
  const source: RustEntityExtractionR6V3 = Object.freeze({
    schema: 3, extractionRevision: BigInt(1), authorityTick: terrainFrameSource.simulationTick,
    contentManifestHash: contentHash, contentReady: true, total: 1, selected: 1, omitted: 0,
    records: Object.freeze([Object.freeze({
      entityId: BigInt("4294967298"), residency: "hot", class: "creature", simulationTier: "hero", protection: BigInt(1), entityRevision: BigInt(1),
      externalEntityId: "dense-asterjaw", specimenId: "標本-asterjaw", kindKey: "asterjaw", variantKey: null, name: "Asterjaw",
      modelKey: "asterjaw", modelRevision: 7, modelHash,
      position: Object.freeze({ x: 2, y: 4, z: -3 }), yaw: 0.25, velocity: Object.freeze({ x: 0.1, y: 0, z: 0 }),
      health: 20, maximumHealth: 20, tamed: false, ageTicks: BigInt(200), movementMode: "ground", grounded: true, submerged: false,
      lastDamageTick: BigInt(0), action: Object.freeze({ key: "stride", phase: 4, startedTick: BigInt(0), endsTick: BigInt(50), target: null }),
      equipment: Object.freeze([]), mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
      research: Object.freeze([["identity", 1]] as const),
    })]),
  });
  const entityExtractor = new RustEntityRenderExtractionR10({ catalog, expectedContentManifestHash: contentHash,
    modelAttestations: [{ modelKey: "asterjaw", revision: 7, contentHash: modelHash }] });
  const extractor = new CameraPlayerFilteringExtractor(entityExtractor);
  const run = () => {
    const sink = new CaptureSink();
    const composed = new RustRenderSceneComposerR10({ sink, epoch, trustedContentManifestHash: contentHash,
      trustedModelCatalogHash: catalog.catalogHashHex, trustedModelCatalogRevision: catalog.revision, entityExtractor: extractor });
    assert.equal(armAuthoritativeCamera(composed, terrainFrameSource), true);
    composed.resources(terrainResources);
    assert.equal(submitAuthoritativeCamera(
      composed,
      terrainFrameSource,
      contentHash,
      1,
      encodeRustEntityExtractionR6V3(source),
    ), true);
    assert.equal(composed.frame(terrainFrameSource), true);
    return { sink, composed };
  };
  const first = run();
  extractor.resetResourceReplay(); extractor.resetRevisionGuard();
  const second = run();
  assert.equal(first.composed.diagnostics().contentManifestHashHex, Buffer.from(contentHash).toString("hex"));
  assert.equal(first.sink.frames[0]!.instances.length > terrainFrameSource.instances.length + 40, true, "dense authored Asterjaw parts must join terrain");
  assert.deepEqual(first.sink.resourceBatches.map((batch) => Buffer.from(batch.batchHash).toString("hex")),
    second.sink.resourceBatches.map((batch) => Buffer.from(batch.batchHash).toString("hex")));
  assert.deepEqual(encodeRenderFrameV2(first.sink.frames[0]!), encodeRenderFrameV2(second.sink.frames[0]!));
  assert.equal(first.composed.entityMetadata().entries[0]?.specimenId, "標本-asterjaw");
});

test("backend integration exposes one lazy global composer without taking live engine ownership", async () => {
  const resources: RenderResourceBatchV2[] = [], frames: RenderFrameV2[] = [];
  const backend: RendererBackendR11 = Object.freeze({
    kind: "rust-webgpu" as const,
    resources: (value: RenderResourceBatchV2 | Uint8Array) => { assert.equal(value instanceof Uint8Array, false); resources.push(value as RenderResourceBatchV2); },
    frame: (value: RenderFrameV2 | Uint8Array) => { assert.equal(value instanceof Uint8Array, false); frames.push(value as RenderFrameV2); return true; },
    resize: () => undefined,
    requestRecovery: () => undefined,
    switchEpoch: () => undefined,
    dispose: () => undefined,
    diagnostics: () => ({ state: "ready" }) as never,
  });
  const cameraExtractor = new EmptyCameraEntityExtractor(CATALOG_HASH, CATALOG_REVISION);
  const runtime = await createRustRendererComposedRuntimeR10({
    backend,
    composer: { epoch: EPOCH, trustedContentManifestHash: CONTENT_HASH,
      trustedModelCatalogHash: CATALOG_HASH, trustedModelCatalogRevision: CATALOG_REVISION,
      entityExtractor: cameraExtractor },
  });
  runtime.terrain.resources(createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(1), operations: [
    { kind: "upsert-material", material: material(BigInt(10)) },
    { kind: "upsert-geometry", geometry: geometry(BigInt(20)) },
  ] }));
  const terrainFrame = baseFrame({ instances: [instance(BigInt(1), BigInt(20), BigInt(10), { domain: 0 })] });
  assert.equal(armAuthoritativeCamera(runtime.composer, terrainFrame), true);
  assert.equal(submitAuthoritativeCamera(runtime.composer, terrainFrame, CONTENT_HASH, 1), true);
  runtime.terrain.frame(terrainFrame);
  assert.equal(resources.length, 1);
  assert.equal(frames.length, 1);
  assert.equal(runtime.backend, backend);
  assert.equal(runtime.composer.diagnostics().globalFrameSequence, BigInt(1));
});

test("production composition stays renderer-independent and lazy on the compatibility path", async () => {
  const composerSource = await readFile(path.join(ROOT, "app", "game", "rust-render-scene-composer-r10.ts"), "utf8");
  const backendSource = await readFile(path.join(ROOT, "app", "game", "rust-renderer-backend-r11.ts"), "utf8");
  assert.doesNotMatch(composerSource, /from\s+["']three["']/u);
  assert.match(backendSource, /await import\("\.\/rust-render-scene-composer-r10\.ts"\)/u);
  assert.doesNotMatch(backendSource, /^import\s+\{[^}]*RustRenderSceneComposerR10/mu);
});
