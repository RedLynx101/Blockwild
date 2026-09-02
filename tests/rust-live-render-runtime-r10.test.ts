import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Item } from "../app/game/data.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";
import {
  compareCanonicalUtf8R10,
  decodeRustDomainBundleR10,
  type RustDomainValueR10,
} from "../app/game/rust-authoritative-extraction-r10.ts";
import { requireBlockwildProductionContent } from "../app/game/rust-integrated-runtime-content.ts";
import type { RustIntegratedRuntimeExtractionV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  PLAYER_RENDER_MODEL_ID_V1,
  PLAYER_RENDER_PROFILE_ID_V1,
  attestPlayerRenderProfileV1,
  type AttestedPlayerRenderProfileV1,
} from "../app/game/rust-player-render-profile.ts";
import {
  attestRenderPresentationCatalogV1,
  type AttestedRenderPresentationCatalogV1,
} from "../app/game/rust-render-presentation-profile.ts";
import { type RenderRuntimeFrameContextR10 } from "../app/game/rust-render-scene-composer-r10.ts";
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
const PRESENTATION_ARTIFACT = CONTENT.artifacts.find((artifact) =>
  artifact.domain === "machine-profile" && artifact.id === "render-presentations")!;
const IDENTITY_ROTATION = Object.freeze([0, 0, 0, 1] as const);
const CAMERA_VIEW = Object.freeze({ viewportWidth: 1_280, viewportHeight: 720, viewRevision: 11 });
const GOLDEN_BWX0 = Uint8Array.from(Buffer.from(readFileSync(
  new URL("./fixtures/rust-engine/r10-authoritative-extraction/bound-camera-view-bwx0-v1.hex", import.meta.url),
  "utf8",
).trim(), "hex"));
let profilePromise: Promise<AttestedPlayerRenderProfileV1> | null = null;
let presentationPromise: Promise<AttestedRenderPresentationCatalogV1> | null = null;

class DomainWriter {
  private bytes: number[] = [];
  raw(value: Uint8Array) { this.bytes.push(...value); return this; }
  u8(value: number) { this.bytes.push(value & 0xff); return this; }
  u16(value: number) { return this.number(value, 2); }
  u32(value: number) { return this.number(value, 4); }
  u64(value: bigint | number) {
    let remaining = BigInt(value);
    for (let index = 0; index < 8; index += 1) {
      this.bytes.push(Number(remaining & BigInt(0xff)));
      remaining >>= BigInt(8);
    }
    return this;
  }
  f64(value: number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    return this.raw(bytes);
  }
  string(value: string) {
    const bytes = new TextEncoder().encode(value);
    return this.u32(bytes.byteLength).raw(bytes);
  }
  finish() { return Uint8Array.from(this.bytes); }
  private number(value: number, byteLength: number) {
    let remaining = value >>> 0;
    for (let index = 0; index < byteLength; index += 1) {
      this.bytes.push(remaining & 0xff);
      remaining >>>= 8;
    }
    return this;
  }
}

function hex(value: string) {
  assert.match(value, /^[0-9a-f]{32}$/u);
  return Uint8Array.from(value.match(/../gu)!.map((part) => Number.parseInt(part, 16)));
}

function encodeDomainValue(value: RustDomainValueR10) {
  const writer = new DomainWriter();
  if (typeof value === "boolean") return writer.u8(0).u8(value ? 1 : 0).finish();
  if (typeof value === "bigint") return writer.u8(1).u64(value).finish();
  if (typeof value === "number") return writer.u8(3).f64(value).finish();
  if (typeof value === "string") return writer.u8(4).string(value).finish();
  return writer.u8(5).raw(value).finish();
}

function cameraPlayerDomain(revision: number, tick: number, itemCode?: number) {
  const source = decodeRustDomainBundleR10(GOLDEN_BWX0);
  const views = source.views.map((view) => view.rows.map((row) => ({
    kind: row.kind,
    key: row.key,
    fields: new Map(row.fields.map(([key, value]) => [
      key,
      value instanceof Uint8Array ? Uint8Array.from(value) : value,
    ])),
  })));
  const binding = views[1].find((row) => row.kind === 2)!;
  binding.fields.set("entityRevision", BigInt(revision));
  if (itemCode === undefined) {
    for (const key of [...binding.fields.keys()]) if (key.startsWith("held.")) binding.fields.delete(key);
    binding.fields.set("held.present", false);
  } else {
    binding.fields.set("held.present", true);
    binding.fields.set("held.itemCode", BigInt(itemCode));
    binding.fields.set("held.count", BigInt(1));
    binding.fields.set("held.durability.present", true);
    binding.fields.set("held.durability.value", BigInt(900_000));
    binding.fields.set("held.metadataHash", Uint8Array.from({ length: 16 }, () => 3));
  }

  const output = new DomainWriter().raw(new TextEncoder().encode("BWX0")).u16(1)
    .u64(revision).u64(tick).raw(source.stateHash).raw(hex(CONTENT_HASH)).u8(1).u16(source.views.length);
  source.views.forEach((view, index) => {
    const payloadWriter = new DomainWriter();
    for (const row of views[index]) {
      const fields = [...row.fields]
        .sort(([left], [right]) => compareCanonicalUtf8R10(left, right))
        .map(([name, value]) => [name, encodeDomainValue(value)] as const);
      const rowHasher = new TypeScriptCanonicalHasher("blockwild.r10.domain-row-revision.v1")
        .writeU16(row.kind).writeString(row.key).writeU16(fields.length);
      for (const [name, value] of fields) rowHasher.writeString(name).writeBytes(value);
      const rowHash = rowHasher.finish();
      const rowRevision = new DataView(rowHash.buffer, rowHash.byteOffset, 8).getBigUint64(0, true);
      payloadWriter.u16(row.kind).string(row.key).u64(rowRevision).u16(fields.length);
      for (const [name, value] of fields) payloadWriter.string(name).raw(value);
    }
    const payload = payloadWriter.finish();
    const payloadHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-view-payload.v1")
      .writeBytes(payload).finish();
    const status = view.status === "complete" ? 0 : view.status === "partial" ? 1 : 2;
    output.u8(view.domain).u16(view.schema).u8(status).u64(BigInt(revision))
      .u32(view.total).u32(view.selected).u32(view.omitted).u32(view.nextCursor).u16(view.blockers.length);
    for (const blocker of view.blockers) output.string(blocker);
    output.u32(payload.byteLength).raw(payloadHash).raw(payload);
  });
  return output.finish();
}

function loadFixtureProfile() {
  profilePromise ??= (async () => {
    const manifest = JSON.parse(await readFile(path.join(ROOT, "public", "renderer", "manifest.json"), "utf8")) as Record<string, unknown>;
    const bytes = new Uint8Array(await readFile(path.join(ROOT, "public", "renderer", String(manifest.current), "models.bwm2")));
    return attestPlayerRenderProfileV1(manifest, bytes);
  })();
  return profilePromise;
}

function loadFixturePresentations() {
  presentationPromise ??= (async () => {
    const manifest = JSON.parse(await readFile(path.join(ROOT, "public", "renderer", "manifest.json"), "utf8")) as Record<string, unknown>;
    const bytes = new Uint8Array(await readFile(path.join(ROOT, "public", "renderer", String(manifest.current), "models.bwm2")));
    return attestRenderPresentationCatalogV1(manifest, bytes);
  })();
  return presentationPromise;
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
    presentationLoader: async () => loadFixturePresentations(),
    contentFactory: () => CONTENT,
    ...overrides,
  } satisfies Parameters<typeof createRustLiveRenderRuntimeR10>[0];
}

function context(input: Readonly<{ epoch?: bigint; sequence?: bigint; tick?: bigint; time?: bigint }> = {}): RenderRuntimeFrameContextR10 {
  return Object.freeze({
    epoch: input.epoch ?? EPOCH,
    frameSequence: input.sequence ?? BigInt(1),
    simulationTick: input.tick ?? BigInt(0),
    animationTimeMicros: input.time ?? BigInt(500_000),
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

function terrainCamera() {
  return Object.freeze({
    position: [999, 999, 999] as const,
    orientation: IDENTITY_ROTATION,
    verticalFovRadians: 0.5,
    near: 0.5,
    far: 64,
    viewport: [1, 1] as const,
  });
}

function extraction(revision = 1, tick = 0, heldItemCode?: number): RustIntegratedRuntimeExtractionV1 {
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
      externalEntityId: "player:extraction",
      specimenId: "player:extraction",
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
    hud: cameraPlayerDomain(revision, tick, heldItemCode),
    audio: new Uint8Array(),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: "2".repeat(32),
  });
}

async function dispose(runtime: RustLiveRenderRuntimeR10 | null) {
  if (runtime) await runtime.dispose();
}

function arm(runtime: RustLiveRenderRuntimeR10) {
  return runtime.armRequiredView(GENERATION, "player:extraction", CAMERA_VIEW);
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
    assert.equal(arm(runtime), true);
    assert.equal(await runtime.submitRuntimeExtraction(GENERATION, extraction(), context()), true);
    assert.equal(runtime.terrain.resources(createRenderResourceBatchV2({ epoch: EPOCH, revision: BigInt(1), operations: [] })), true);
    assert.equal(runtime.terrain.frame(createRenderFrameV2({
      epoch: EPOCH,
      frameSequence: BigInt(1),
      simulationTick: BigInt(0),
      animationTimeMicros: BigInt(500_000),
      resourceRevision: BigInt(1),
      camera: terrainCamera(),
      environment: context().environment,
      instances: [],
      particles: [],
    })), true);
    const diagnostics = runtime.diagnostics();
    assert.equal(diagnostics.submittedExtractions, 1);
    assert.equal(diagnostics.heldEquipmentModels, 11);
    assert.deepEqual(diagnostics.presentation?.heldBlockers, []);
    assert.equal(diagnostics.presentation?.droppedBindings, 0);
    assert.deepEqual(diagnostics.presentation?.droppedBlockers, []);
    assert.equal(diagnostics.composer?.entityExtractionRevision, BigInt(1));
    assert.equal(diagnostics.composer?.terrainFrameSequence, BigInt(1));
    assert.equal(sink.framesSeen.length, 1);
    assert.equal(runtime.metadata(GENERATION).entity.extractionRevision, BigInt(1));
  } finally {
    await runtime.dispose();
  }
});

test("live runtime submits an exact same-envelope held model to the composed renderer", async () => {
  const sink = new CaptureSink();
  const runtime = await createRustLiveRenderRuntimeR10(options(sink));
  try {
    arm(runtime);
    assert.equal(await runtime.submitRuntimeExtraction(
      GENERATION,
      extraction(1, 0, Item.StonePickaxe),
      context(),
    ), true);
    const metadata = runtime.metadata(GENERATION);
    const held = metadata.entity.entries[0]?.equipment[0];
    assert.equal(held?.slotKey, "world-view-held-right-hand");
    assert.equal(held?.itemKey, String(Item.StonePickaxe));
    assert.equal(held?.instanceIds.length, 5);
    const diagnostics = runtime.diagnostics();
    assert.equal(diagnostics.presentation?.heldAttachments, 1);
    assert.deepEqual(diagnostics.presentation?.heldBlockers, []);
    assert.equal(diagnostics.presentationCoverage?.coverageHash, diagnostics.presentation?.coverageHash);
    assert.deepEqual(diagnostics.presentationCoverage?.families.map((family) => family.family), [
      "celestial", "dropped-item", "held-item", "machine", "particle", "projectile",
      "sky", "summon", "vehicle", "weather", "world-prop",
    ]);
    const exactHeld = metadata.presentation.frame?.bindings.find((binding) => binding.role === "held-item");
    assert.equal(exactHeld?.role, "held-item");
    assert.equal(exactHeld?.binding.profileId, "held:stone-pickaxe");
    assert.equal(exactHeld?.binding.modelId, "held-pickaxe");
    assert.equal(exactHeld?.binding.presentationCatalog.contentHashHex, PRESENTATION_ARTIFACT.blobHash);
    assert.deepEqual(exactHeld?.instanceIds, held?.instanceIds);
    assert.equal(metadata.presentation.promotion.ready, false);
    assert.ok(metadata.presentation.promotion.blockers.includes(
      "dropped-item-r6-model-binding-runtime",
    ));
  } finally {
    await runtime.dispose();
  }
});

test("stale and future generations, epochs, and authority contexts fail closed", async () => {
  const sink = new CaptureSink();
  const runtime = await createRustLiveRenderRuntimeR10(options(sink));
  try {
    arm(runtime);
    await assert.rejects(runtime.submitRuntimeExtraction(GENERATION - 1, extraction(), context()), /stale live render world generation/u);
    await assert.rejects(runtime.submitRuntimeExtraction(GENERATION + 1, extraction(), context()), /future live render world generation/u);
    await assert.rejects(runtime.submitRuntimeExtraction(GENERATION, extraction(), context({ epoch: EPOCH + BigInt(1) })), /context epoch/u);
    await assert.rejects(runtime.submitRuntimeExtraction(GENERATION, extraction(), context({ tick: BigInt(1) })), /context tick/u);
    assert.equal(await runtime.submitRuntimeExtraction(GENERATION, extraction(), context()), true);
    await assert.rejects(runtime.submitRuntimeExtraction(GENERATION, extraction(2, 0), context({ sequence: BigInt(1) })), /stale runtime extraction frame sequence/u);
  } finally {
    await runtime.dispose();
  }
});

test("recovery and store reset stay on the owned composer", async () => {
  const sink = new CaptureSink();
  const runtime = await createRustLiveRenderRuntimeR10(options(sink));
  try {
    arm(runtime);
    assert.equal(runtime.requestRecovery(GENERATION, "device lost"), true);
    assert.equal(runtime.resetRendererStore(GENERATION, "store replay"), true);
    runtime.resize(GENERATION, 900, 600);
    assert.deepEqual(sink.recoveries, ["device lost", "store replay"]);
    assert.deepEqual(sink.sizes, [[1_280, 720], [900, 600]]);
    assert.equal(runtime.diagnostics().composer?.recoveryRequests, 2);
    assert.deepEqual(runtime.diagnostics().composer?.requiredView, {
      expectedExternalEntityId: "player:extraction",
      viewportWidth: 900,
      viewportHeight: 600,
      viewRevision: 12,
    });
  } finally {
    await runtime.dispose();
  }
});

test("dispose drains accepted submissions, rejects new work, and releases ownership", async () => {
  const sink = new CaptureSink();
  const runtime = await createRustLiveRenderRuntimeR10(options(sink));
  arm(runtime);
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
    camera: terrainCamera(),
    environment: context().environment,
    instances: [],
    particles: [],
  })), /disposed/u);

  const replacement = await createRustLiveRenderRuntimeR10(options(sink));
  await dispose(replacement);
});
