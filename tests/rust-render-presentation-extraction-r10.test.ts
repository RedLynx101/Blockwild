import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Item } from "../app/game/data.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";
import { requireBlockwildProductionContent } from "../app/game/rust-integrated-runtime-content.ts";
import type { RustIntegratedRuntimeExtractionV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  PLAYER_RENDER_MODEL_ID_V1,
  PLAYER_RENDER_PROFILE_ID_V1,
  attestPlayerRenderProfileV1,
  type AttestedPlayerRenderProfileV1,
} from "../app/game/rust-player-render-profile.ts";
import {
  RustEntityRenderExtractionR10,
  type RenderEntityFrameContextR10,
} from "../app/game/rust-render-entity-extraction-r10.ts";
import {
  createProductionHeldEquipmentModelsR10,
  RUST_HELD_PRESENTATION_SLOT_R10,
  RustPresentationEntityExtractionR10,
} from "../app/game/rust-render-presentation-extraction-r10.ts";
import {
  attestRenderPresentationCatalogV1,
  type AttestedRenderPresentationCatalogV1,
} from "../app/game/rust-render-presentation-profile.ts";
import { encodeRustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-codec-r6.ts";
import type { RustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-contract-r6.ts";
import { createProductionRenderModelAttestationsR10 } from "../app/game/rust-live-render-runtime-r10.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONTENT = requireBlockwildProductionContent();
const CONTENT_HASH = CONTENT.manifest.manifestHash;
const PLAYER_ARTIFACT = CONTENT.artifacts.find((artifact) =>
  artifact.domain === "creature-profile" && artifact.id === PLAYER_RENDER_PROFILE_ID_V1)!;
const PRESENTATION_ARTIFACT = CONTENT.artifacts.find((artifact) =>
  artifact.domain === "machine-profile" && artifact.id === "render-presentations")!;
const ENTITY_ID = BigInt("4294967297");
const PLAYER_ID = BigInt("8589934593");
const DROP_ENTITY_ID = BigInt("4294967298");
const EPOCH = BigInt(31);
let catalogsPromise: Promise<readonly [AttestedPlayerRenderProfileV1, AttestedRenderPresentationCatalogV1]> | null = null;

class Writer {
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
  i64(value: bigint | number) { return this.u64(BigInt.asUintN(64, BigInt(value))); }
  string(value: string) {
    const encoded = new TextEncoder().encode(value);
    return this.u32(encoded.byteLength).raw(encoded);
  }
  finish() { return Uint8Array.from(this.bytes); }
  private number(value: number, length: number) {
    let remaining = value >>> 0;
    for (let index = 0; index < length; index += 1) {
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

function boolField(value: boolean) { return new Writer().u8(0).u8(value ? 1 : 0).finish(); }
function u64Field(value: bigint | number) { return new Writer().u8(1).u64(value).finish(); }
function i64Field(value: bigint | number) { return new Writer().u8(2).i64(value).finish(); }
function stringField(value: string) { return new Writer().u8(4).string(value).finish(); }
function hashField(value: Uint8Array) { assert.equal(value.byteLength, 16); return new Writer().u8(5).raw(value).finish(); }

function domainRow(kind: number, key: string, fields: readonly (readonly [string, Uint8Array])[]) {
  const canonical = [...fields].sort(([left], [right]) => left.localeCompare(right));
  const hasher = new TypeScriptCanonicalHasher("blockwild.r10.domain-row-revision.v1")
    .writeU16(kind).writeString(key).writeU16(canonical.length);
  for (const [name, value] of canonical) hasher.writeString(name).writeBytes(value);
  const hash = hasher.finish();
  const revision = new DataView(hash.buffer, hash.byteOffset, 8).getBigUint64(0, true);
  const writer = new Writer().u16(kind).string(key).u64(revision).u16(canonical.length);
  for (const [name, value] of canonical) writer.string(name).raw(value);
  return writer.finish();
}

function domainBundle(
  extractionRevision: number,
  authorityTick: number,
  rowsByDomain: ReadonlyMap<number, readonly Uint8Array[]>,
  blockersByDomain: ReadonlyMap<number, readonly string[]> = new Map(),
) {
  const writer = new Writer().raw(new TextEncoder().encode("BWX0")).u16(1)
    .u64(extractionRevision).u64(authorityTick)
    .raw(Uint8Array.from({ length: 16 }, () => 7)).raw(hex(CONTENT_HASH)).u8(1).u16(8);
  for (let domain = 1; domain <= 8; domain += 1) {
    const rows = rowsByDomain.get(domain) ?? [];
    const payload = new Writer();
    for (const row of rows) payload.raw(row);
    const payloadBytes = payload.finish();
    const blockers = blockersByDomain.get(domain) ?? [];
    const payloadHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-view-payload.v1")
      .writeBytes(payloadBytes).finish();
    writer.u8(domain).u16(1).u8(blockers.length === 0 ? 0 : 1).u64(extractionRevision)
      .u32(rows.length).u32(rows.length).u32(0).u32(rows.length).u16(blockers.length);
    for (const blocker of blockers) writer.string(blocker);
    writer.u32(payloadBytes.byteLength).raw(payloadHash).raw(payloadBytes);
  }
  return writer.finish();
}

function playerRow(
  entityRevision: bigint,
  itemCode: number,
  options: Readonly<{ count?: number; durability?: number | null; metadataHash?: Uint8Array }> = {},
) {
  const durability = options.durability === undefined ? 750_000 : options.durability;
  const fields: Array<readonly [string, Uint8Array]> = [
    ["entityId", u64Field(ENTITY_ID)],
    ["entityRevision", u64Field(entityRevision)],
    ["held.count", u64Field(options.count ?? 1)],
    ["held.durability.present", boolField(durability !== null)],
    ["held.itemCode", u64Field(itemCode)],
    ["held.metadataHash", hashField(options.metadataHash ?? Uint8Array.from({ length: 16 }, (_, index) => index + 1))],
    ["held.present", boolField(true)],
    ["playerId", u64Field(PLAYER_ID)],
  ];
  if (durability !== null) fields.push(["held.durability.value", u64Field(durability)]);
  return domainRow(2, `binding:${PLAYER_ID}`, fields);
}

function playerDomain(extractionRevision: number, authorityTick: number, entityRevision: bigint, itemCode: number) {
  return domainBundle(extractionRevision, authorityTick, new Map([[2, [playerRow(entityRevision, itemCode)]]]));
}

function dropRow(input: Readonly<{
  itemCode: number;
  entityRevision: bigint;
  status: "exact" | "missing" | "unmapped";
  profileId?: string;
  modelId?: string;
  blockerId?: string;
}>) {
  const dropId = "drop:presentation-test";
  const fields: Array<readonly [string, Uint8Array]> = [
    ["dropId", stringField(dropId)],
    ["entityId", u64Field(DROP_ENTITY_ID)],
    ["entityRevision", u64Field(input.entityRevision)],
    ["stack.itemCode", u64Field(input.itemCode)],
    ["presentation.role", stringField("dropped-item")],
    ["presentation.contentDomain", stringField("item")],
    ["presentation.contentId", stringField(String(input.itemCode))],
    ["presentation.status", stringField(input.status)],
  ];
  if (input.profileId !== undefined) fields.push(["presentation.profileId", stringField(input.profileId)]);
  if (input.modelId !== undefined) fields.push(["presentation.modelId", stringField(input.modelId)]);
  if (input.blockerId !== undefined) fields.push(["presentation.blockerId", stringField(input.blockerId)]);
  if (input.status === "exact") {
    fields.push(["presentation.contentVersion", u64Field(PRESENTATION_ARTIFACT.contentVersion)]);
    fields.push(["presentation.contentHash", hashField(hex(PRESENTATION_ARTIFACT.blobHash))]);
  }
  return domainRow(6, `drop:${dropId}`, fields);
}

function machineRow(input: Readonly<{
  machineId: string;
  presentationId: string;
  status: "exact" | "missing" | "unmapped";
  profileId?: string;
  modelId?: string;
  blockerId?: string;
  anchorRevision?: bigint;
  xMilli?: bigint;
  halfExtentXMilli?: number;
  withLight?: boolean;
}>) {
  const fields: Array<readonly [string, Uint8Array]> = [
    ["anchorRevision", u64Field(input.anchorRevision ?? BigInt(9))],
    ["gameplayActive", boolField(true)],
    ["gameplayRevision", u64Field(12)],
    ["halfExtents.xMilli", u64Field(input.halfExtentXMilli ?? 500)],
    ["halfExtents.yMilli", u64Field(1_000)],
    ["halfExtents.zMilli", u64Field(750)],
    ["light.present", boolField(input.withLight ?? false)],
    ["machineId", stringField(input.machineId)],
    ["position.xMilli", i64Field(input.xMilli ?? BigInt(4_000))],
    ["position.yMilli", i64Field(65_000)],
    ["position.zMilli", i64Field(-8_000)],
    ["presentation.role", stringField("machine")],
    ["presentation.status", stringField(input.status)],
    ["presentationId", stringField(input.presentationId)],
    ["rotation.pitchMicroturns", u64Field(0)],
    ["rotation.rollMicroturns", u64Field(0)],
    ["rotation.yawMicroturns", u64Field(250_000)],
  ];
  if (input.withLight) fields.push(
    ["light.castsShadows", boolField(true)],
    ["light.color.blueMillionths", u64Field(300_000)],
    ["light.color.greenMillionths", u64Field(700_000)],
    ["light.color.redMillionths", u64Field(1_000_000)],
    ["light.enabled", boolField(true)],
    ["light.innerConeMicroturns", u64Field(0)],
    ["light.kind", u64Field(0)],
    ["light.luminousFluxMillilumens", u64Field(900_000)],
    ["light.outerConeMicroturns", u64Field(0)],
    ["light.rangeMilli", u64Field(12_000)],
  );
  if (input.profileId !== undefined) fields.push(["presentation.profileId", stringField(input.profileId)]);
  if (input.modelId !== undefined) fields.push(["presentation.modelId", stringField(input.modelId)]);
  if (input.blockerId !== undefined) fields.push(["presentation.blockerId", stringField(input.blockerId)]);
  if (input.status === "exact") {
    fields.push(["presentation.contentVersion", u64Field(PRESENTATION_ARTIFACT.contentVersion)]);
    fields.push(["presentation.contentHash", hashField(hex(PRESENTATION_ARTIFACT.blobHash))]);
  }
  return domainRow(5, `anchor:${input.machineId}`, fields);
}

async function catalogs() {
  catalogsPromise ??= (async () => {
    const manifest = JSON.parse(await readFile(path.join(ROOT, "public", "renderer", "manifest.json"), "utf8")) as Record<string, unknown>;
    const bytes = new Uint8Array(await readFile(path.join(ROOT, "public", "renderer", String(manifest.current), "models.bwm2")));
    return Object.freeze([
      await attestPlayerRenderProfileV1(manifest, bytes),
      await attestRenderPresentationCatalogV1(manifest, bytes),
    ] as const);
  })();
  return catalogsPromise;
}

function entityRecord(
  revision: number,
  equipment: RustEntityExtractionR6V3["records"][number]["equipment"] = [],
): RustEntityExtractionR6V3["records"][number] {
  return Object.freeze({
    entityId: ENTITY_ID,
    residency: "hot" as const,
    class: "player" as const,
    simulationTier: "hero" as const,
    protection: BigInt(1),
    entityRevision: BigInt(revision),
    externalEntityId: "presentation-player",
    specimenId: "presentation-player",
    kindKey: PLAYER_RENDER_PROFILE_ID_V1,
    variantKey: null,
    name: "Presentation Player",
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
    equipment: Object.freeze(equipment),
    mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
    research: Object.freeze([]),
  });
}

function entityExtraction(
  revision = 1,
  tick = 10,
  equipment: RustEntityExtractionR6V3["records"][number]["equipment"] = [],
  extraRecords: readonly RustEntityExtractionR6V3["records"][number][] = [],
) {
  const records = Object.freeze([entityRecord(revision, equipment), ...extraRecords]);
  return Object.freeze({
    schema: 3 as const,
    extractionRevision: BigInt(revision),
    authorityTick: BigInt(tick),
    contentManifestHash: hex(CONTENT_HASH),
    contentReady: true,
    total: records.length,
    selected: records.length,
    omitted: 0,
    records,
  } satisfies RustEntityExtractionR6V3);
}

function envelope(
  itemCode: number,
  options: Readonly<{ revision?: number; entityRevision?: bigint; hud?: Uint8Array; equipment?: RustEntityExtractionR6V3["records"][number]["equipment"] }> = {},
): RustIntegratedRuntimeExtractionV1 {
  const revision = options.revision ?? 1;
  const entities = entityExtraction(revision, 10, options.equipment);
  return Object.freeze({
    identity: Object.freeze({
      universeId: "presentation-universe",
      locationId: "presentation-location",
      revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation: 1 }),
      tick: 10,
      stateHash: "1".repeat(32),
    }),
    extractionRevision: revision,
    render: encodeRustEntityExtractionR6V3(entities),
    hud: options.hud ?? playerDomain(revision, 10, options.entityRevision ?? BigInt(revision), itemCode),
    audio: new Uint8Array(),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: "2".repeat(32),
  });
}

function dropRecord(
  revision: number,
  modelKey: string,
  modelRevision: number,
  modelHash: Uint8Array,
): RustEntityExtractionR6V3["records"][number] {
  return Object.freeze({
    ...entityRecord(revision),
    entityId: DROP_ENTITY_ID,
    class: "construct" as const,
    externalEntityId: "drop:presentation-test",
    specimenId: "drop:presentation-test",
    kindKey: "dropped-item",
    name: null,
    modelKey,
    modelRevision,
    modelHash,
    position: Object.freeze({ x: 2, y: 4, z: 0 }),
    equipment: Object.freeze([]),
  });
}

function dropEnvelope(input: Readonly<{
  itemCode: number;
  status: "exact" | "missing" | "unmapped";
  profileId?: string;
  modelId?: string;
  blockerId?: string;
  entityRevision?: bigint;
  recordEntityRevision?: bigint;
  modelKey: string;
  modelRevision: number;
  modelHash: Uint8Array;
  blockers?: readonly string[];
}>) {
  const revision = 1;
  const entityRevision = input.entityRevision ?? BigInt(revision);
  const entities = entityExtraction(revision, 10, [], [
    dropRecord(Number(input.recordEntityRevision ?? entityRevision), input.modelKey, input.modelRevision, input.modelHash),
  ]);
  const hud = domainBundle(revision, 10, new Map([
    [2, [playerRow(BigInt(revision), Item.StonePickaxe)]],
    [3, [dropRow({ ...input, entityRevision })]],
  ]), new Map(input.blockers === undefined ? [] : [[3, input.blockers]]));
  return Object.freeze({
    identity: Object.freeze({
      universeId: "presentation-universe",
      locationId: "presentation-location",
      revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation: 1 }),
      tick: 10,
      stateHash: "1".repeat(32),
    }),
    extractionRevision: revision,
    render: encodeRustEntityExtractionR6V3(entities),
    hud,
    audio: new Uint8Array(),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: "2".repeat(32),
  } satisfies RustIntegratedRuntimeExtractionV1);
}

function machineEnvelope(
  rows: readonly Uint8Array[],
  blockers: readonly string[] = ["world-prop-presentation-not-authoritative"],
  revision = 1,
) {
  const entities = entityExtraction(revision, 10);
  const hud = domainBundle(revision, 10, new Map([
    [2, [playerRow(BigInt(revision), Item.StonePickaxe)]],
    [4, rows],
  ]), new Map([[4, blockers]]));
  return Object.freeze({
    identity: Object.freeze({
      universeId: "presentation-universe",
      locationId: "presentation-location",
      revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation: 1 }),
      tick: 10,
      stateHash: "1".repeat(32),
    }),
    extractionRevision: revision,
    render: encodeRustEntityExtractionR6V3(entities),
    hud,
    audio: new Uint8Array(),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: "2".repeat(32),
  } satisfies RustIntegratedRuntimeExtractionV1);
}

function context(frameSequence = 1, epoch = EPOCH): RenderEntityFrameContextR10 {
  return Object.freeze({
    epoch,
    frameSequence: BigInt(frameSequence),
    simulationTick: BigInt(10),
    animationTimeMicros: BigInt(500_000),
    camera: Object.freeze({
      position: [0, 4, 12] as const,
      orientation: [0, 0, 0, 1] as const,
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

async function createAdapter(limits: Readonly<{ maxInstances?: number; maxResourceOperations?: number }> = {}) {
  const [profile, presentations] = await catalogs();
  const base = new RustEntityRenderExtractionR10({
    catalog: profile.catalog,
    expectedContentManifestHash: hex(CONTENT_HASH),
    modelAttestations: createProductionRenderModelAttestationsR10(profile, presentations, CONTENT.artifacts),
    equipmentModels: createProductionHeldEquipmentModelsR10(presentations),
  });
  return {
    adapter: new RustPresentationEntityExtractionR10(base, presentations, {
      contentVersion: PRESENTATION_ARTIFACT.contentVersion,
      contentHash: hex(PRESENTATION_ARTIFACT.blobHash),
    }, limits),
    presentations,
  };
}

test("same-envelope held item joins one exact BWM2 attachment into the R6 player", async () => {
  const { adapter, presentations } = await createAdapter();
  const source = envelope(Item.StonePickaxe);
  const token = adapter.prepareRuntimeExtraction(source);
  const result = adapter.extractBytes(source.render, context());
  adapter.finishPreparedRuntimeExtraction(token, true);

  const heldProfile = presentations.registry.resolve("held-item", { domain: "item", id: String(Item.StonePickaxe) });
  assert.equal(heldProfile.status, "exact");
  assert.equal(result.presentations[0]?.equipment.length, 1);
  const held = result.presentations[0]?.equipment[0];
  assert.equal(held?.slotKey, RUST_HELD_PRESENTATION_SLOT_R10);
  assert.equal(held?.itemKey, String(Item.StonePickaxe));
  assert.equal(held?.count, 1);
  assert.equal(held?.durability, 750_000);
  assert.deepEqual(held?.custom.map(([key, value]) => [key, [...value]]), [
    ["world-view.durability-present", [1]],
    ["world-view.metadata-hash", Array.from({ length: 16 }, (_, index) => index + 1)],
  ]);
  assert.equal(adapter.diagnostics().heldAttachments, 1);
  assert.deepEqual(adapter.diagnostics().heldBlockers, []);
  if (heldProfile.status === "exact") assert.equal(held?.instanceIds.length, heldProfile.profile.model.nodeCount);
});

test("explicit missing held profile emits a sorted blocker and never fabricates equipment", async () => {
  const { adapter, presentations } = await createAdapter();
  const missing = presentations.profileCatalog.missingProfiles.find((candidate) =>
    candidate.role === "held-item" && candidate.contentRefs.length > 0);
  assert.ok(missing);
  const itemId = missing.contentRefs[0]?.id;
  assert.ok(itemId);
  const source = envelope(Number(itemId));
  const token = adapter.prepareRuntimeExtraction(source);
  const result = adapter.extractBytes(source.render, context());
  adapter.finishPreparedRuntimeExtraction(token, true);

  assert.deepEqual(result.presentations[0]?.equipment, []);
  assert.equal(adapter.diagnostics().heldAttachments, 0);
  assert.deepEqual(adapter.diagnostics().heldBlockers, [{
    id: `held-item:missing:item:${itemId}:entity:${ENTITY_ID}:${missing.id}`,
    status: "missing",
    entityId: ENTITY_ID,
    itemId,
    blockerId: missing.id,
  }]);
});

test("same-envelope dropped item keeps exact presentation identity on its R6 entity", async () => {
  const { adapter, presentations } = await createAdapter();
  const exact = presentations.registry.resolve("dropped-item", { domain: "item", id: String(Item.CaptureOrb) });
  assert.equal(exact.status, "exact");
  assert.ok(exact.status === "exact");
  const source = dropEnvelope({
    itemCode: Item.CaptureOrb,
    status: "exact",
    profileId: exact.profile.id,
    modelId: exact.profile.model.id,
    modelKey: exact.profile.model.id,
    modelRevision: PRESENTATION_ARTIFACT.contentVersion,
    modelHash: hex(PRESENTATION_ARTIFACT.blobHash),
  });
  const token = adapter.prepareRuntimeExtraction(source);
  const result = adapter.extractBytes(source.render, context());
  adapter.finishPreparedRuntimeExtraction(token, true);

  assert.equal(result.presentations.find((value) => value.entityId === DROP_ENTITY_ID)?.modelKey,
    exact.profile.model.id);
  assert.equal(adapter.diagnostics().droppedBindings, 1);
  assert.deepEqual(adapter.diagnostics().droppedBlockers, []);
});

test("same-envelope exact machine anchor compiles stable machine resources and instances without an R6 entity", async () => {
  const { adapter, presentations } = await createAdapter();
  const exact = presentations.registry.resolveProfileId("machine", "machine:apiary");
  assert.equal(exact.status, "exact");
  assert.ok(exact.status === "exact");
  const row = machineRow({
    machineId: "machine:apiary:alpha",
    presentationId: exact.profile.id,
    status: "exact",
    profileId: exact.profile.id,
    modelId: exact.profile.model.id,
    withLight: true,
  });
  const source = machineEnvelope([row]);
  const token = adapter.prepareRuntimeExtraction(source);
  const result = adapter.extractBytes(source.render, context());
  adapter.finishPreparedRuntimeExtraction(token, true);

  assert.equal(result.presentations.some((value) => value.kindKey === "machine"), false,
    "machine anchors must not invent BWR6 entities");
  assert.equal(result.machinePresentations.length, 1);
  const machine = result.machinePresentations[0]!;
  assert.equal(machine.machineId, "machine:apiary:alpha");
  assert.equal(machine.profileId, exact.profile.id);
  assert.equal(machine.modelId, exact.profile.model.id);
  assert.equal(machine.anchorRevision, BigInt(9));
  assert.equal(machine.contentVersion, PRESENTATION_ARTIFACT.contentVersion);
  assert.deepEqual(machine.contentHash, hex(PRESENTATION_ARTIFACT.blobHash));
  assert.deepEqual(machine.positionMilli, [BigInt(4_000), BigInt(65_000), BigInt(-8_000)]);
  assert.deepEqual(machine.rotationMicroturns, [250_000, 0, 0]);
  assert.deepEqual(machine.halfExtentsMilli, [500, 1_000, 750]);
  assert.equal(machine.gameplayRevision, BigInt(12));
  assert.equal(machine.gameplayActive, true);
  assert.deepEqual(machine.light, {
    kind: 0,
    colorMillionths: [1_000_000, 700_000, 300_000],
    luminousFluxMillilumens: BigInt(900_000),
    rangeMilli: 12_000,
    innerConeMicroturns: 0,
    outerConeMicroturns: 0,
    castsShadows: true,
    enabled: true,
  });
  assert.equal(machine.instanceIds.length, exact.profile.model.nodeCount);
  const machineInstances = result.frame.instances.filter((instance) => instance.domain === 5);
  assert.equal(machineInstances.length, exact.profile.model.nodeCount);
  assert.deepEqual(machineInstances.map((instance) => instance.stableId).sort((a, b) => a < b ? -1 : 1),
    [...machine.instanceIds].sort((a, b) => a < b ? -1 : 1));
  const entityIds = new Set(result.frame.instances.filter((instance) => instance.domain !== 5).map((instance) => instance.stableId));
  assert.ok(machine.instanceIds.every((id) => !entityIds.has(id)), "machine ids collided with the entity namespace");
  const resourceIds = (result.resources?.operations ?? []).map((operation) => operation.kind === "upsert-geometry"
    ? operation.geometry.id : operation.kind === "upsert-material" ? operation.material.id
      : operation.kind === "upsert-texture" ? operation.texture.id : operation.id);
  assert.equal(new Set(resourceIds).size, resourceIds.length);
  assert.equal(adapter.diagnostics().machineBindings, 1);
  assert.deepEqual(adapter.diagnostics().machineBlockers, []);
  assert.deepEqual(adapter.diagnostics().machines[0]?.instanceIds, machine.instanceIds);
});

test("machine presentation resource replay is stable, ordered, and resets by epoch", async () => {
  const { adapter, presentations } = await createAdapter();
  const apiary = presentations.registry.resolveProfileId("machine", "machine:apiary");
  const rack = presentations.registry.resolveProfileId("machine", "machine:capture-orb-rack");
  assert.ok(apiary.status === "exact" && rack.status === "exact");
  const rows = [
    machineRow({ machineId: "machine:a", presentationId: rack.profile.id, status: "exact",
      profileId: rack.profile.id, modelId: rack.profile.model.id, xMilli: BigInt(1_000) }),
    machineRow({ machineId: "machine:z", presentationId: apiary.profile.id, status: "exact",
      profileId: apiary.profile.id, modelId: apiary.profile.model.id, xMilli: BigInt(2_000) }),
  ];
  const first = machineEnvelope(rows);
  const firstToken = adapter.prepareRuntimeExtraction(first);
  const firstResult = adapter.extractBytes(first.render, context(1));
  adapter.finishPreparedRuntimeExtraction(firstToken, true);
  assert.ok(firstResult.resources && firstResult.resources.operations.length > 0);
  assert.deepEqual(firstResult.machinePresentations.map((machine) => machine.machineId), ["machine:a", "machine:z"]);

  const second = machineEnvelope(rows, ["world-prop-presentation-not-authoritative"], 2);
  const secondToken = adapter.prepareRuntimeExtraction(second);
  const secondResult = adapter.extractBytes(second.render, context(2));
  adapter.finishPreparedRuntimeExtraction(secondToken, true);
  assert.equal(secondResult.resources, null, "unchanged catalog-owned machine resources should not replay");
  assert.equal(secondResult.frame.resourceRevision, firstResult.frame.resourceRevision);
  assert.deepEqual(secondResult.machinePresentations.map((machine) => machine.instanceIds),
    firstResult.machinePresentations.map((machine) => machine.instanceIds));

  adapter.resetRevisionGuard();
  adapter.resetResourceReplay();
  const third = machineEnvelope(rows, ["world-prop-presentation-not-authoritative"], 3);
  const thirdToken = adapter.prepareRuntimeExtraction(third);
  const thirdResult = adapter.extractBytes(third.render, context(3, EPOCH + BigInt(1)));
  adapter.finishPreparedRuntimeExtraction(thirdToken, true);
  assert.ok(thirdResult.resources && thirdResult.resources.operations.length > 0,
    "new renderer epoch must replay exact machine resources");
});

test("missing and unmapped machine anchors stay loadable blockers and emit no instances", async () => {
  const [, presentations] = await catalogs();
  const missing = presentations.profileCatalog.missingProfiles.find((candidate) => candidate.role === "machine");
  assert.ok(missing);
  for (const [presentationId, status, blockerId] of [
    [missing.id, "missing", missing.id],
    ["machine.legacy.unmapped.v1", "unmapped", "machine-presentation-profile-unmapped"],
  ] as const) {
    const { adapter } = await createAdapter();
    const source = machineEnvelope([machineRow({
      machineId: `machine:${status}`,
      presentationId,
      status,
      blockerId,
    })], [`machine-presentation-${status}`, "world-prop-presentation-not-authoritative"]);
    const token = adapter.prepareRuntimeExtraction(source);
    const result = adapter.extractBytes(source.render, context());
    adapter.finishPreparedRuntimeExtraction(token, true);
    assert.equal(result.frame.instances.some((instance) => instance.domain === 5), false);
    assert.deepEqual(result.machinePresentations, []);
    assert.deepEqual(adapter.diagnostics().machineBlockers, [{
      id: `machine:${status}:anchor:machine:${status}:presentation:${presentationId}:${blockerId}`,
      status,
      machineId: `machine:${status}`,
      presentationId,
      blockerId,
    }]);
  }
});

test("machine anchor duplicate identity, extent capacity, and configured instance capacity fail closed", async () => {
  const { presentations } = await createAdapter();
  const exact = presentations.registry.resolveProfileId("machine", "machine:apiary");
  assert.ok(exact.status === "exact");
  const exactRow = machineRow({ machineId: "machine:collision", presentationId: exact.profile.id,
    status: "exact", profileId: exact.profile.id, modelId: exact.profile.model.id });
  const duplicate = await createAdapter();
  assert.throws(() => duplicate.adapter.prepareRuntimeExtraction(machineEnvelope([exactRow, exactRow])),
    /domain rows are not canonical and unique|duplicated/u);

  const oversized = await createAdapter();
  assert.throws(() => oversized.adapter.prepareRuntimeExtraction(machineEnvelope([machineRow({
    machineId: "machine:oversized",
    presentationId: exact.profile.id,
    status: "exact",
    profileId: exact.profile.id,
    modelId: exact.profile.model.id,
    halfExtentXMilli: 1_024_001,
  })])), /extents exceed authority bounds/u);
  const capped = await createAdapter({ maxInstances: 1 });
  const cappedSource = machineEnvelope([exactRow]);
  const token = capped.adapter.prepareRuntimeExtraction(cappedSource);
  assert.throws(() => capped.adapter.extractBytes(cappedSource.render, context()), /configured presentation frame instance cap/u);
  capped.adapter.finishPreparedRuntimeExtraction(token, false);
});

test("production model attestations include every exact dropped BWM2 identity under catalog ownership", async () => {
  const [profile, presentations] = await catalogs();
  const attestations = createProductionRenderModelAttestationsR10(profile, presentations, CONTENT.artifacts);
  const byModel = new Map(attestations.map((attestation) => [attestation.modelKey, attestation]));
  const exactModels = [...new Set(presentations.profileCatalog.profiles
    .filter((candidate) => candidate.role === "dropped-item")
    .map((candidate) => candidate.model.id))].sort();
  assert.equal(exactModels.length, 7);
  for (const modelId of exactModels) {
    const attestation = byModel.get(modelId);
    assert.ok(attestation, modelId);
    assert.equal(attestation.revision, PRESENTATION_ARTIFACT.contentVersion);
    assert.deepEqual(attestation.contentHash, hex(PRESENTATION_ARTIFACT.blobHash));
  }
});

test("dropped model attestation rejects a conflicting creature-profile identity", async () => {
  const [profile, presentations] = await catalogs();
  const droppedModel = presentations.profileCatalog.profiles.find((candidate) =>
    candidate.role === "dropped-item")?.model.id;
  assert.ok(droppedModel);
  const conflict = Object.freeze({
    ...PLAYER_ARTIFACT,
    id: droppedModel,
    aliases: Object.freeze([`creature-profile:${droppedModel}`]),
    blobHash: "f".repeat(32),
  });
  assert.throws(
    () => createProductionRenderModelAttestationsR10(
      profile,
      presentations,
      [...CONTENT.artifacts, conflict],
    ),
    /ambiguous content identities/u,
  );
});

test("dropped item missing and unmapped bindings stay explicit and never borrow a model", async () => {
  const [, presentations] = await catalogs();
  const missing = presentations.profileCatalog.missingProfiles.find((candidate) =>
    candidate.role === "dropped-item" && candidate.contentRefs.length > 0);
  assert.ok(missing);
  const missingId = missing.contentRefs[0]?.id;
  assert.ok(missingId);

  for (const [itemId, status, blockerId] of [
    [missingId, "missing", missing.id],
    ["4294967295", "unmapped", undefined],
  ] as const) {
    const { adapter } = await createAdapter();
    const source = dropEnvelope({
      itemCode: Number(itemId),
      status,
      blockerId,
      modelKey: "unresolved:dropped-item",
      modelRevision: 0,
      modelHash: new Uint8Array(16),
      blockers: [`dropped-item-presentation-${status}`],
    });
    const token = adapter.prepareRuntimeExtraction(source);
    assert.throws(() => adapter.extractBytes(source.render, context()), /BWR6 extraction is not promotable/u);
    adapter.finishPreparedRuntimeExtraction(token, true);
    assert.equal(adapter.diagnostics().droppedBindings, 0);
    assert.deepEqual(adapter.diagnostics().droppedBlockers, [{
      id: `dropped-item:${status}:item:${itemId}:drop:drop:presentation-test:entity:${DROP_ENTITY_ID}${blockerId === undefined ? "" : `:${blockerId}`}`,
      status,
      dropId: "drop:presentation-test",
      entityId: DROP_ENTITY_ID,
      itemId,
      blockerId: blockerId ?? null,
    }]);
  }
});

test("dropped item entity revision and model identity mismatches reject the prepared envelope", async () => {
  const { adapter, presentations } = await createAdapter();
  const exact = presentations.registry.resolve("dropped-item", { domain: "item", id: String(Item.CaptureOrb) });
  assert.ok(exact.status === "exact");
  const mismatch = (overrides: Partial<Parameters<typeof dropEnvelope>[0]> = {}) => dropEnvelope({
    itemCode: Item.CaptureOrb,
    status: "exact",
    profileId: exact.profile.id,
    modelId: exact.profile.model.id,
    modelKey: exact.profile.model.id,
    modelRevision: PRESENTATION_ARTIFACT.contentVersion,
    modelHash: hex(PRESENTATION_ARTIFACT.blobHash),
    ...overrides,
  });
  assert.throws(() => adapter.prepareRuntimeExtraction(mismatch({ entityRevision: BigInt(2), recordEntityRevision: BigInt(1) })),
    /entity revision differs from BWR6/u);

  const other = await createAdapter();
  assert.throws(() => other.adapter.prepareRuntimeExtraction(mismatch({ modelKey: "wrong-drop-model" })),
    /model key differs from its presentation profile/u);
});

test("same-envelope revision mismatch, reserved-slot collision, and byte substitution fail closed", async () => {
  const first = await createAdapter();
  assert.throws(() => first.adapter.prepareRuntimeExtraction(envelope(Item.StonePickaxe, {
    entityRevision: BigInt(2),
  })), /entity revision differs from BWR6/u);

  const second = await createAdapter();
  const occupied = Object.freeze([Object.freeze([
    RUST_HELD_PRESENTATION_SLOT_R10,
    Object.freeze({ itemKey: String(Item.StonePickaxe), count: 1, durability: 0, custom: Object.freeze([]) }),
  ] as const)]);
  assert.throws(() => second.adapter.prepareRuntimeExtraction(envelope(Item.StonePickaxe, {
    equipment: occupied,
  })), /already owns reserved held presentation slot/u);

  const third = await createAdapter();
  const source = envelope(Item.StonePickaxe);
  const token = third.adapter.prepareRuntimeExtraction(source);
  const substituted = Uint8Array.from(source.render);
  substituted[substituted.byteLength - 1] ^= 1;
  assert.throws(() => third.adapter.extractBytes(substituted, context()), /differ from the prepared Worker envelope/u);
  third.adapter.finishPreparedRuntimeExtraction(token, false);
});
