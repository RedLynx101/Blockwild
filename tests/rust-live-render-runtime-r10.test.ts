import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { requireBlockwildProductionContent } from "../app/game/rust-integrated-runtime-content.ts";
import type { RustIntegratedRuntimeExtractionV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  PLAYER_RENDER_MODEL_ID_V1,
  PLAYER_RENDER_PROFILE_ID_V1,
  attestPlayerRenderProfileV1,
  type AttestedPlayerRenderProfileV1,
} from "../app/game/rust-player-render-profile.ts";
import { type RenderEntityFrameContextR10 } from "../app/game/rust-render-entity-extraction-r10.ts";
import { encodeRustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-codec-r6.ts";
import type { RustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-contract-r6.ts";
import {
  createRustLiveRenderRuntimeR10,
  type RustLiveRenderRuntimeR10,
} from "../app/game/rust-live-render-runtime-r10.ts";
import {
  createRenderFrameV2,
  createRenderResourceBatchV2,
  type RenderFrameV2,
  type RenderResourceBatchV2,
} from "../app/game/rust-render-extraction-v2.ts";
import type { RenderSceneExtractionSinkR10 } from "../app/game/rust-render-scene-composer-r10.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const EPOCH = BigInt(41);
const GENERATION = 7;
const CONTENT = requireBlockwildProductionContent();
const CONTENT_HASH = CONTENT.manifest.manifestHash;
const PLAYER_ARTIFACT = CONTENT.artifacts.find((artifact) =>
  artifact.domain === "creature-profile" && artifact.id === PLAYER_RENDER_PROFILE_ID_V1)!;
const IDENTITY_ROTATION = Object.freeze([0, 0, 0, 1] as const);
let profilePromise: Promise<AttestedPlayerRenderProfileV1> | null = null;

function hex(value: string) {
  assert.match(value, /^[0-9a-f]{32}$/u);
  return Uint8Array.from(value.match(/../gu)!.map((part) => Number.parseInt(part, 16)));
}

function loadFixtureProfile() {
  profilePromise ??= (async () => {
    const manifest = JSON.parse(await readFile(path.join(ROOT, "public", "renderer", "manifest.json"), "utf8")) as Record<string, unknown>;
    const bytes = new Uint8Array(await readFile(path.join(ROOT, "public", "renderer", String(manifest.current), "models.bwm2")));
    return attestPlayerRenderProfileV1(manifest, bytes);
  })();
  return profilePromise;
}

class CaptureSink implements RenderSceneExtractionSinkR10 {
  readonly resourcesSeen: RenderResourceBatchV2[] = [];
  readonly framesSeen: RenderFrameV2[] = [];
  readonly sizes: Array<readonly [number, number]> = [];
  readonly recoveries: string[] = [];
  resources(batch: RenderResourceBatchV2) { this.resourcesSeen.push(batch); return true; }
  frame(frame: RenderFrameV2) { this.framesSeen.push(frame); return true; }
  resize(width: number, height: number) { this.sizes.push([width, height]); }
  requestRecovery(reason = "recovery") { this.recoveries.push(reason); return true; }
  diagnostics() { return Object.freeze({ state: "ready" }); }
}

function options(sink: CaptureSink, overrides: Partial<Parameters<typeof createRustLiveRenderRuntimeR10>[0]> = {}) {
  return {
    sink,
    epoch: EPOCH,
    worldGeneration: GENERATION,
    profileLoader: async () => loadFixtureProfile(),
    contentFactory: () => CONTENT,
    ...overrides,
  } satisfies Parameters<typeof createRustLiveRenderRuntimeR10>[0];
}

function context(input: Readonly<{ epoch?: bigint; sequence?: bigint; tick?: bigint; time?: bigint }> = {}): RenderEntityFrameContextR10 {
  return Object.freeze({
    epoch: input.epoch ?? EPOCH,
    frameSequence: input.sequence ?? BigInt(1),
    simulationTick: input.tick ?? BigInt(10),
    animationTimeMicros: input.time ?? BigInt(500_000),
    camera: Object.freeze({
      position: [0, 4, 12] as const,
      orientation: IDENTITY_ROTATION,
      verticalFovRadians: 1,
      near: 0.1,
      far: 512,
      viewport: [1280, 720] as const,
    }),
    environment: Object.freeze({
      clearRgba8: [80, 130, 170, 255] as const,
      ambientRgb8: [160, 170, 180] as const,
      ambientIntensity: 0.7,
      sunDirection: [0.2, 0.8, 0.4] as const,
      sunRgb8: [255, 238, 200] as const,
      sunIntensity: 0.9,
      fogRgb8: [80, 130, 170] as const,
      fogNear: 24,
      fogFar: 220,
      underwater: 0,
      caveOcclusion: 0,
    }),
  });
}

function extraction(revision = 1, tick = 10): RustIntegratedRuntimeExtractionV1 {
  const entities: RustEntityExtractionR6V3 = Object.freeze({
    schema: 3,
    extractionRevision: BigInt(revision),
    authorityTick: BigInt(tick),
    contentManifestHash: hex(CONTENT_HASH),
    contentReady: true,
    total: 1,
    selected: 1,
    omitted: 0,
    records: Object.freeze([Object.freeze({
      entityId: BigInt("4294967297"),
      residency: "hot" as const,
      class: "player" as const,
      simulationTier: "hero" as const,
      protection: BigInt(1),
      entityRevision: BigInt(revision),
      externalEntityId: "player-live-render-test",
      specimenId: "player-live-render-test",
      kindKey: PLAYER_RENDER_PROFILE_ID_V1,
      variantKey: null,
      name: "Renderer Test Player",
      modelKey: PLAYER_RENDER_MODEL_ID_V1,
      modelRevision: PLAYER_ARTIFACT.contentVersion,
      modelHash: hex(PLAYER_ARTIFACT.blobHash),
      position: Object.freeze({ x: 0, y: 4, z: 0 }),
      yaw: 0,
      velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
      health: 20,
      maximumHealth: 20,
      tamed: false,
      ageTicks: BigInt(0),
      movementMode: "ground" as const,
      grounded: true,
      submerged: false,
      lastDamageTick: BigInt(0),
      action: Object.freeze({ key: "idle", phase: 0, startedTick: BigInt(0), endsTick: BigInt(0), target: null }),
      equipment: Object.freeze([]),
      mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
      research: Object.freeze([]),
    })]),
  });
  return Object.freeze({
    identity: Object.freeze({
      universeId: "universe-live-render-test",
      locationId: "location-live-render-test",
      revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation: 1 }),
      tick,
      stateHash: "1".repeat(32),
    }),
    extractionRevision: revision,
    render: encodeRustEntityExtractionR6V3(entities),
    hud: new Uint8Array(),
    audio: new Uint8Array(),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: "2".repeat(32),
  });
}

async function dispose(runtime: RustLiveRenderRuntimeR10 | null) {
  if (runtime) await runtime.dispose();
}

test("attestation failure releases the renderer sink lease", async () => {
  const sink = new CaptureSink();
  await assert.rejects(createRustLiveRenderRuntimeR10(options(sink, {
    profileLoader: async () => { throw new Error("BWM2 attestation rejected"); },
  })), /BWM2 attestation rejected/u);

  const recovered = await createRustLiveRenderRuntimeR10(options(sink));
  assert.equal(recovered.state, "ready");
  await recovered.dispose();
});

test("one sink has exactly one starting or ready composer owner", async () => {
  const sink = new CaptureSink();
  let release!: (profile: AttestedPlayerRenderProfileV1) => void;
  const delayed = new Promise<AttestedPlayerRenderProfileV1>((resolve) => { release = resolve; });
  const firstPromise = createRustLiveRenderRuntimeR10(options(sink, { profileLoader: async () => delayed }));
  await assert.rejects(createRustLiveRenderRuntimeR10(options(sink)), /already has an active Rust scene composer/u);
  release(await loadFixtureProfile());
  const first = await firstPromise;
  assert.equal(first.diagnostics().ownsSinkLease, true);
  assert.equal(first.diagnostics().epoch, EPOCH);
  await first.dispose();
});

test("terrain and authoritative runtime extraction share the sole composer", async () => {
  const sink = new CaptureSink();
  const runtime = await createRustLiveRenderRuntimeR10(options(sink));
  try {
    assert.equal(await runtime.submitRuntimeExtraction(GENERATION, extraction(), context()), true);
    assert.equal(runtime.terrain.resources(createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(1), operations: [] })), true);
    assert.equal(runtime.terrain.frame(createRenderFrameV2({
      epoch: EPOCH,
      frameSequence: BigInt(1),
      simulationTick: BigInt(10),
      animationTimeMicros: BigInt(500_000),
      resourceRevision: BigInt(1),
      camera: context().camera,
      environment: context().environment,
      instances: [],
      particles: [],
    })), true);
    const diagnostics = runtime.diagnostics();
    assert.equal(diagnostics.submittedExtractions, 1);
    assert.equal(diagnostics.composer?.entityExtractionRevision, BigInt(1));
    assert.equal(diagnostics.composer?.terrainFrameSequence, BigInt(1));
    assert.equal(sink.framesSeen.length, 1);
    assert.equal(runtime.metadata(GENERATION).entity.extractionRevision, BigInt(1));
  } finally {
    await runtime.dispose();
  }
});

test("stale and future generations, epochs, and authority contexts fail closed", async () => {
  const sink = new CaptureSink();
  const runtime = await createRustLiveRenderRuntimeR10(options(sink));
  try {
    await assert.rejects(runtime.submitRuntimeExtraction(GENERATION - 1, extraction(), context()), /stale live render world generation/u);
    await assert.rejects(runtime.submitRuntimeExtraction(GENERATION + 1, extraction(), context()), /future live render world generation/u);
    await assert.rejects(runtime.submitRuntimeExtraction(GENERATION, extraction(), context({ epoch: EPOCH + BigInt(1) })), /context epoch/u);
    await assert.rejects(runtime.submitRuntimeExtraction(GENERATION, extraction(), context({ tick: BigInt(11) })), /context tick/u);
    assert.equal(await runtime.submitRuntimeExtraction(GENERATION, extraction(), context()), true);
    await assert.rejects(runtime.submitRuntimeExtraction(GENERATION, extraction(2, 10), context({ sequence: BigInt(1) })), /stale runtime extraction frame sequence/u);
  } finally {
    await runtime.dispose();
  }
});

test("recovery and store reset stay on the owned composer", async () => {
  const sink = new CaptureSink();
  const runtime = await createRustLiveRenderRuntimeR10(options(sink));
  try {
    assert.equal(runtime.requestRecovery(GENERATION, "device lost"), true);
    assert.equal(runtime.resetRendererStore(GENERATION, "store replay"), true);
    runtime.resize(GENERATION, 900, 600);
    assert.deepEqual(sink.recoveries, ["device lost", "store replay"]);
    assert.deepEqual(sink.sizes, [[900, 600]]);
    assert.equal(runtime.diagnostics().composer?.recoveryRequests, 2);
  } finally {
    await runtime.dispose();
  }
});

test("dispose drains accepted submissions, rejects new work, and releases ownership", async () => {
  const sink = new CaptureSink();
  const runtime = await createRustLiveRenderRuntimeR10(options(sink));
  const accepted = runtime.submitRuntimeExtraction(GENERATION, extraction(), context());
  const disposing = runtime.dispose();
  assert.equal(await accepted, true);
  await disposing;
  assert.equal(runtime.state, "disposed");
  assert.equal(runtime.diagnostics().ownsSinkLease, false);
  await assert.rejects(runtime.submitRuntimeExtraction(GENERATION, extraction(2), context({ sequence: BigInt(2) })), /disposed/u);
  assert.throws(() => runtime.terrain.frame(createRenderFrameV2({
    epoch: EPOCH,
    frameSequence: BigInt(1),
    simulationTick: BigInt(10),
    animationTimeMicros: BigInt(1),
    resourceRevision: BigInt(0),
    camera: context().camera,
    environment: context().environment,
    instances: [],
    particles: [],
  })), /disposed/u);

  const replacement = await createRustLiveRenderRuntimeR10(options(sink));
  await dispose(replacement);
});
