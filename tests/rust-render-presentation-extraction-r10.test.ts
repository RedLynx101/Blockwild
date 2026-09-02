import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Item } from "../app/game/data.ts";
import { planRustDroppedHotTransformsR10 } from "../app/game/rust-authoritative-extraction-r10.ts";
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
  type RustPresentationBindingIdentityR10,
  type RustPresentationEntityExtractionResultR10,
} from "../app/game/rust-render-presentation-extraction-r10.ts";
import {
  attestRenderPresentationCatalogV1,
  createRenderPresentationCoverageInventoryR10,
  createRenderPresentationRegistryV1,
  RENDER_PRESENTATION_CATALOG_ID_V1,
  RENDER_PRESENTATION_CATALOG_REVISION_V1,
  type AttestedRenderPresentationCatalogV1,
} from "../app/game/rust-render-presentation-profile.ts";
import { RustRenderSceneComposerR10 } from "../app/game/rust-render-scene-composer-r10.ts";
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
const COMBAT_ENTITY_ID = BigInt("18446744073709551614");
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
    .raw(hex("1".repeat(32))).raw(hex(CONTENT_HASH)).u8(1).u16(8);
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
  dropId?: string;
  entityId?: bigint;
  positionMilli?: Readonly<{ x: bigint; y: bigint; z: bigint }>;
  velocityMilliPerSecond?: Readonly<{ x: bigint; y: bigint; z: bigint }>;
  yawMicroturns?: number;
  createdTick?: bigint;
}>) {
  const dropId = input.dropId ?? "drop:presentation-test";
  const position = input.positionMilli ?? Object.freeze({ x: BigInt(2_000), y: BigInt(4_000), z: BigInt(0) });
  const velocity = input.velocityMilliPerSecond ?? Object.freeze({ x: BigInt(0), y: BigInt(0), z: BigInt(0) });
  const fields: Array<readonly [string, Uint8Array]> = [
    ["boundContainerRevision", u64Field(1)],
    ["createdTick", u64Field(input.createdTick ?? BigInt(10))],
    ["custodyContainer", stringField("container-key-v1/010203")],
    ["custodySlot", u64Field(0)],
    ["dropId", stringField(dropId)],
    ["entityId", u64Field(input.entityId ?? DROP_ENTITY_ID)],
    ["entityRevision", u64Field(input.entityRevision)],
    ["expiresTick.present", boolField(false)],
    ["pickupLockActorId.present", boolField(false)],
    ["position.xMilli", i64Field(position.x)],
    ["position.yMilli", i64Field(position.y)],
    ["position.zMilli", i64Field(position.z)],
    ["stack.itemCode", u64Field(input.itemCode)],
    ["stack.count", u64Field(1)],
    ["stack.durability.present", boolField(false)],
    ["stack.metadataHash", hashField(new Uint8Array(16))],
    ["presentation.role", stringField("dropped-item")],
    ["presentation.contentDomain", stringField("item")],
    ["presentation.contentId", stringField(String(input.itemCode))],
    ["presentation.status", stringField(input.status)],
    ["rotation.pitchMicroturns", u64Field(0)],
    ["rotation.rollMicroturns", u64Field(0)],
    ["rotation.yawMicroturns", u64Field(input.yawMicroturns ?? 0)],
    ["velocity.xMilliPerSecond", i64Field(velocity.x)],
    ["velocity.yMilliPerSecond", i64Field(velocity.y)],
    ["velocity.zMilliPerSecond", i64Field(velocity.z)],
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

function combatRow(input: Readonly<{
  role: "projectile" | "summon";
  recordId: string;
  entityRevision?: bigint;
  status: "exact" | "missing" | "unmapped" | "unlinked";
  contentId?: string;
  presentationId?: string;
  profileId?: string;
  modelId?: string;
  blockerId?: string;
}>) {
  const fields: Array<readonly [string, Uint8Array]> = [
    ["authorityRevision", u64Field(0)],
    ["presentation.role", stringField(input.role)],
    ["presentation.status", stringField(input.status)],
  ];
  if (input.role === "summon" && input.contentId !== undefined) fields.push(["contentId", stringField(input.contentId)]);
  if (input.status !== "unlinked") fields.push(
    ["entityId", u64Field(COMBAT_ENTITY_ID)],
    ["entityRevision", u64Field(input.entityRevision ?? BigInt(9))],
    ["presentation.contentDomain", stringField(input.role === "projectile" ? "item" : "creature-profile")],
    ["presentation.contentId", stringField(input.contentId!)],
    ["presentation.presentationId", stringField(input.presentationId!)],
  );
  if (input.profileId !== undefined) fields.push(["presentation.profileId", stringField(input.profileId)]);
  if (input.modelId !== undefined) fields.push(["presentation.modelId", stringField(input.modelId)]);
  if (input.blockerId !== undefined) fields.push(["presentation.blockerId", stringField(input.blockerId)]);
  if (input.status === "exact") fields.push(
    ["presentation.contentVersion", u64Field(PRESENTATION_ARTIFACT.contentVersion)],
    ["presentation.contentHash", hashField(hex(PRESENTATION_ARTIFACT.blobHash))],
  );
  return domainRow(input.role === "projectile" ? 3 : 5, `${input.role}:${input.recordId}`, fields);
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
  revision?: number;
  authorityTick?: number;
  dropId?: string;
  entityId?: bigint;
  positionMilli?: Readonly<{ x: bigint; y: bigint; z: bigint }>;
  velocityMilliPerSecond?: Readonly<{ x: bigint; y: bigint; z: bigint }>;
  yawMicroturns?: number;
  createdTick?: bigint;
}>) {
  const revision = input.revision ?? 1;
  const authorityTick = input.authorityTick ?? 10;
  const entityRevision = input.entityRevision ?? BigInt(revision);
  const record = Object.freeze({
    ...dropRecord(Number(input.recordEntityRevision ?? entityRevision), input.modelKey, input.modelRevision, input.modelHash),
    ...(input.dropId === undefined ? {} : { externalEntityId: input.dropId, specimenId: input.dropId }),
    ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
    ...(input.positionMilli === undefined ? {} : { position: Object.freeze({
      x: Number(input.positionMilli.x) / 1_000,
      y: Number(input.positionMilli.y) / 1_000,
      z: Number(input.positionMilli.z) / 1_000,
    }) }),
    ...(input.velocityMilliPerSecond === undefined ? {} : { velocity: Object.freeze({
      x: Number(input.velocityMilliPerSecond.x) / 1_000,
      y: Number(input.velocityMilliPerSecond.y) / 1_000,
      z: Number(input.velocityMilliPerSecond.z) / 1_000,
    }) }),
    ...(input.yawMicroturns === undefined ? {} : { yaw: Math.fround(input.yawMicroturns / 1_000_000 * Math.PI * 2) }),
  });
  const entities = entityExtraction(revision, authorityTick, [], [
    record,
  ]);
  const hud = domainBundle(revision, authorityTick, new Map([
    [2, [playerRow(BigInt(revision), Item.StonePickaxe)]],
    [3, [dropRow({ ...input, entityRevision })]],
  ]), new Map(input.blockers === undefined ? [] : [[3, input.blockers]]));
  return Object.freeze({
    identity: Object.freeze({
      universeId: "presentation-universe",
      locationId: "presentation-location",
      revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation: 1 }),
      tick: authorityTick,
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

function combatRecord(input: Readonly<{
  role: "projectile" | "summon";
  recordId: string;
  modelKey: string;
  modelRevision: number;
  modelHash: Uint8Array;
  entityRevision?: number;
}>) {
  return Object.freeze({
    ...entityRecord(input.entityRevision ?? 9),
    entityId: COMBAT_ENTITY_ID,
    class: input.role === "projectile" ? "projectile" as const : "creature" as const,
    externalEntityId: input.recordId,
    specimenId: input.recordId,
    kindKey: input.role === "projectile" ? "202" : "asterjaw",
    name: input.recordId,
    modelKey: input.modelKey,
    modelRevision: input.modelRevision,
    modelHash: input.modelHash,
    equipment: Object.freeze([]),
  });
}

function combatEnvelope(
  row: Uint8Array,
  record: RustEntityExtractionR6V3["records"][number],
  blockers: readonly string[] = ["combat-projectile-and-summon-render-presentation-not-authoritative"],
  revision = 1,
) {
  const entities = entityExtraction(revision, 10, [], [record]);
  const hud = domainBundle(revision, 10, new Map([
    [2, [playerRow(BigInt(revision), Item.StonePickaxe)]],
    [5, [row]],
  ]), new Map([[5, blockers]]));
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

function orphanEntityEnvelope(record: RustEntityExtractionR6V3["records"][number]) {
  const source = envelope(Item.StonePickaxe);
  const entities = entityExtraction(1, 10, [], [record]);
  return Object.freeze({
    ...source,
    render: encodeRustEntityExtractionR6V3(entities),
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

async function createAdapter(
  limits: Readonly<{ maxInstances?: number; maxResourceOperations?: number }> = {},
  presentationOverride?: AttestedRenderPresentationCatalogV1,
) {
  const [profile, productionPresentations] = await catalogs();
  const presentations = presentationOverride ?? productionPresentations;
  const base = new RustEntityRenderExtractionR10({
    catalog: profile.catalog,
    expectedContentManifestHash: hex(CONTENT_HASH),
    modelAttestations: createProductionRenderModelAttestationsR10(
      profile,
      productionPresentations,
      CONTENT.artifacts,
    ),
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

function assertExactBindingIdentity(
  binding: RustPresentationBindingIdentityR10,
  expected: Readonly<{
    role: RustPresentationBindingIdentityR10["role"];
    profileId: string;
    modelId: string;
    primaryContentRef: RustPresentationBindingIdentityR10["primaryContentRef"];
  }>,
  presentations: AttestedRenderPresentationCatalogV1,
) {
  assert.equal(binding.role, expected.role);
  assert.equal(binding.profileId, expected.profileId);
  assert.equal(binding.modelId, expected.modelId);
  assert.deepEqual(binding.primaryContentRef, expected.primaryContentRef);
  assert.deepEqual(binding.presentationCatalog, {
    id: RENDER_PRESENTATION_CATALOG_ID_V1,
    schema: presentations.profileCatalog.schema,
    revision: RENDER_PRESENTATION_CATALOG_REVISION_V1,
    contentVersion: PRESENTATION_ARTIFACT.contentVersion,
    contentHash: hex(PRESENTATION_ARTIFACT.blobHash),
  });
  assert.deepEqual(binding.modelCatalog, {
    revision: presentations.modelCatalog.revision,
    canonicalHash: presentations.modelCatalog.catalogHashHex,
    sha256: presentations.modelCatalog.contentSha256,
  });
}

function presentationComposer(
  presentations: AttestedRenderPresentationCatalogV1,
) {
  const resourceRevisions: bigint[] = [];
  const coverage = createRenderPresentationCoverageInventoryR10(presentations.profileCatalog);
  const composer = new RustRenderSceneComposerR10({
    sink: {
      resources(batch) { resourceRevisions.push(batch.revision); return true; },
      frame() { return true; },
      resize() {},
      requestRecovery() { return true; },
      diagnostics() { return Object.freeze({ schema: 1 }); },
    },
    epoch: EPOCH,
    trustedContentManifestHash: hex(CONTENT_HASH),
    trustedModelCatalogHash: presentations.modelCatalog.catalogHashHex,
    trustedModelCatalogRevision: presentations.modelCatalog.revision,
    presentationCoverage: coverage,
  });
  return { composer, coverage, resourceRevisions } as const;
}

function composeExactPresentationFrame(
  result: RustPresentationEntityExtractionResultR10,
  presentations: AttestedRenderPresentationCatalogV1,
) {
  const { composer, coverage, resourceRevisions } = presentationComposer(presentations);
  assert.equal(composer.submitEntities(result), true);
  const metadata = composer.presentationMetadata();
  assert.equal(metadata.coverage, coverage);
  assert.equal(metadata.frame?.coverageHash, coverage.coverageHash);
  assert.deepEqual(metadata.frame?.bindings.map((binding) => binding.id),
    result.presentationFrame.bindings.map((binding) => binding.id));
  assert.equal(metadata.promotion.ready, false, "static source/schema blockers keep the wgpu promotion gate closed");
  assert.ok(metadata.promotion.blockers.length > 0);
  assert.equal(composer.diagnostics().presentationBindings, result.presentationFrame.bindings.length);
  assert.equal(resourceRevisions.length, result.resources === null ? 0 : 1);
  return composer;
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
  const exactHeld = result.presentationFrame.bindings.find((binding) => binding.role === "held-item");
  assert.ok(exactHeld?.role === "held-item");
  assert.equal(exactHeld.playerId, PLAYER_ID);
  assert.equal(exactHeld.entityId, ENTITY_ID);
  assert.equal(exactHeld.itemId, String(Item.StonePickaxe));
  assert.deepEqual(exactHeld.instanceIds, held?.instanceIds);
  assert.ok(heldProfile.status === "exact");
  assertExactBindingIdentity(exactHeld.binding, {
    role: "held-item",
    profileId: heldProfile.profile.id,
    modelId: heldProfile.profile.model.id,
    primaryContentRef: { domain: "item", id: String(Item.StonePickaxe) },
  }, presentations);
  assert.deepEqual(adapter.diagnostics().heldPresentations, [exactHeld]);
  composeExactPresentationFrame(result, presentations);
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
    velocityMilliPerSecond: Object.freeze({ x: BigInt(-125), y: BigInt(875), z: BigInt(-250) }),
    yawMicroturns: 250_000,
    createdTick: BigInt(7),
  });
  const hot = planRustDroppedHotTransformsR10(source);
  assert.equal(hot.transforms.length, 1);
  assert.deepEqual(hot.transforms[0], {
    schema: 1,
    dropId: "drop:presentation-test",
    entityId: DROP_ENTITY_ID,
    entityRevision: BigInt(1),
    rowRevision: hot.transforms[0]?.rowRevision,
    custodyContainer: "container-key-v1/010203",
    custodySlot: 0,
    boundContainerRevision: BigInt(1),
    itemCode: Item.CaptureOrb,
    count: 1,
    durabilityMillionths: null,
    metadataHash: new Uint8Array(16),
    position: { x: 2, y: 4, z: 0 },
    velocity: { x: -0.125, y: 0.875, z: -0.25 },
    rotationMicroturns: { yaw: 250_000, pitch: 0, roll: 0 },
    yawRadians: Math.PI / 2,
    createdTick: BigInt(7),
    ageTicks: BigInt(0),
    expiresTick: null,
    pickupLockActorId: null,
  });
  assert.equal(hot.source.extractionRevision, BigInt(1));
  assert.equal(hot.source.authorityTick, BigInt(10));
  const token = adapter.prepareRuntimeExtraction(source);
  const result = adapter.extractBytes(source.render, context());
  adapter.finishPreparedRuntimeExtraction(token, true);

  assert.equal(result.presentations.find((value) => value.entityId === DROP_ENTITY_ID)?.modelKey,
    exact.profile.model.id);
  assert.equal(adapter.diagnostics().droppedBindings, 1);
  assert.deepEqual(adapter.diagnostics().droppedBlockers, []);
  const dropped = result.presentationFrame.bindings.find((binding) => binding.role === "dropped-item");
  assert.ok(dropped?.role === "dropped-item");
  assert.equal(dropped.dropId, "drop:presentation-test");
  assert.equal(dropped.entityId, DROP_ENTITY_ID);
  assert.equal(dropped.itemId, String(Item.CaptureOrb));
  assertExactBindingIdentity(dropped.binding, {
    role: "dropped-item",
    profileId: exact.profile.id,
    modelId: exact.profile.model.id,
    primaryContentRef: { domain: "item", id: String(Item.CaptureOrb) },
  }, presentations);
  assert.deepEqual(adapter.diagnostics().droppedPresentations, [dropped]);
  composeExactPresentationFrame(result, presentations);
});

test("exact high-u64 Unicode projectile joins one stable BWR6 model across envelopes", async () => {
  const { adapter, presentations } = await createAdapter();
  const exact = presentations.registry.resolveProfileId("projectile", "projectile:arrow");
  assert.equal(exact.status, "exact");
  assert.ok(exact.status === "exact");
  const itemId = exact.profile.contentRefs.find((reference) => reference.domain === "item")?.id;
  assert.ok(itemId);
  const recordId = "projectile:水:🏹";
  const row = combatRow({
    role: "projectile", recordId, status: "exact", contentId: itemId,
    presentationId: exact.profile.id, profileId: exact.profile.id, modelId: exact.profile.model.id,
  });
  const record = combatRecord({
    role: "projectile", recordId, modelKey: exact.profile.model.id,
    modelRevision: PRESENTATION_ARTIFACT.contentVersion, modelHash: hex(PRESENTATION_ARTIFACT.blobHash),
  });
  const first = combatEnvelope(row, record);
  const firstToken = adapter.prepareRuntimeExtraction(first);
  const firstResult = adapter.extractBytes(first.render, context(1));
  adapter.finishPreparedRuntimeExtraction(firstToken, true);
  const firstPresentation = firstResult.presentations.find((value) => value.entityId === COMBAT_ENTITY_ID);
  assert.equal(firstPresentation?.modelKey, exact.profile.model.id);
  assert.equal(firstPresentation?.instanceIds.length, exact.profile.model.nodeCount);
  assert.equal(adapter.diagnostics().combatBindings, 1);
  assert.deepEqual(adapter.diagnostics().combatBlockers, []);
  const projectile = firstResult.presentationFrame.bindings.find((binding) => binding.role === "projectile");
  assert.ok(projectile?.role === "projectile");
  assert.equal(projectile.recordId, recordId);
  assert.equal(projectile.entityId, COMBAT_ENTITY_ID);
  assert.equal(projectile.contentId, itemId);
  assertExactBindingIdentity(projectile.binding, {
    role: "projectile",
    profileId: exact.profile.id,
    modelId: exact.profile.model.id,
    primaryContentRef: { domain: "item", id: itemId },
  }, presentations);
  assert.deepEqual(adapter.diagnostics().combatPresentations, [projectile]);
  composeExactPresentationFrame(firstResult, presentations);

  const second = combatEnvelope(row, record, [
    "combat-projectile-and-summon-render-presentation-not-authoritative",
  ], 2);
  const secondToken = adapter.prepareRuntimeExtraction(second);
  const secondResult = adapter.extractBytes(second.render, context(2));
  adapter.finishPreparedRuntimeExtraction(secondToken, true);
  assert.deepEqual(
    secondResult.presentations.find((value) => value.entityId === COMBAT_ENTITY_ID)?.instanceIds,
    firstPresentation?.instanceIds,
  );
});

test("exact summon requires its creature primary ref and paired spell profile", async () => {
  const { adapter, presentations } = await createAdapter();
  const exact = presentations.registry.resolveProfileId("summon", "summon:asterjaw");
  assert.equal(exact.status, "exact");
  assert.ok(exact.status === "exact");
  const creatureId = exact.profile.contentRefs.find((reference) => reference.domain === "creature-profile")?.id;
  assert.ok(creatureId);
  assert.ok(exact.profile.contentRefs.some((reference) => reference.domain === "ability-spell"));
  const recordId = "summon:水";
  const row = combatRow({
    role: "summon", recordId, status: "exact", contentId: creatureId,
    presentationId: exact.profile.id, profileId: exact.profile.id, modelId: exact.profile.model.id,
  });
  const source = combatEnvelope(row, combatRecord({
    role: "summon", recordId, modelKey: exact.profile.model.id,
    modelRevision: PRESENTATION_ARTIFACT.contentVersion, modelHash: hex(PRESENTATION_ARTIFACT.blobHash),
  }));
  const token = adapter.prepareRuntimeExtraction(source);
  const result = adapter.extractBytes(source.render, context());
  adapter.finishPreparedRuntimeExtraction(token, true);
  assert.equal(result.presentations.find((value) => value.entityId === COMBAT_ENTITY_ID)?.modelKey,
    exact.profile.model.id);
  assert.equal(adapter.diagnostics().combatBindings, 1);
  const summon = result.presentationFrame.bindings.find((binding) => binding.role === "summon");
  assert.ok(summon?.role === "summon");
  assert.equal(summon.recordId, recordId);
  assert.equal(summon.entityId, COMBAT_ENTITY_ID);
  assert.equal(summon.contentId, creatureId);
  assertExactBindingIdentity(summon.binding, {
    role: "summon",
    profileId: exact.profile.id,
    modelId: exact.profile.model.id,
    primaryContentRef: { domain: "creature-profile", id: creatureId },
  }, presentations);
  assert.deepEqual(adapter.diagnostics().combatPresentations, [summon]);
  composeExactPresentationFrame(result, presentations);
});

test("unjoined dropped, projectile, summon, and vehicle records fail closed with stable runtime blockers", async () => {
  const [, presentations] = await catalogs();
  const dropped = presentations.registry.resolve("dropped-item", { domain: "item", id: String(Item.CaptureOrb) });
  const projectile = presentations.registry.resolveProfileId("projectile", "projectile:arrow");
  const summon = presentations.registry.resolveProfileId("summon", "summon:asterjaw");
  const vehicle = presentations.registry.resolveProfileId("vehicle", "vehicle:sailboat");
  assert.ok(dropped.status === "exact");
  assert.ok(projectile.status === "exact");
  assert.ok(summon.status === "exact");
  assert.ok(vehicle.status === "exact");
  const vehicleEntityId = BigInt("4294967299");
  const cases = [
    {
      family: "dropped-item" as const,
      entityId: DROP_ENTITY_ID,
      sourceId: "drop:presentation-test",
      blockerId: "dropped-item-semantic-binding-row-missing",
      record: dropRecord(1, dropped.profile.model.id, PRESENTATION_ARTIFACT.contentVersion,
        hex(PRESENTATION_ARTIFACT.blobHash)),
    },
    {
      family: "projectile" as const,
      entityId: COMBAT_ENTITY_ID,
      sourceId: "orphan:projectile",
      blockerId: "projectile-semantic-binding-row-missing",
      record: combatRecord({
        role: "projectile", recordId: "orphan:projectile", modelKey: projectile.profile.model.id,
        modelRevision: PRESENTATION_ARTIFACT.contentVersion, modelHash: hex(PRESENTATION_ARTIFACT.blobHash),
      }),
    },
    {
      family: "summon" as const,
      entityId: COMBAT_ENTITY_ID,
      sourceId: "orphan:summon",
      blockerId: "summon-semantic-binding-row-missing",
      record: combatRecord({
        role: "summon", recordId: "orphan:summon", modelKey: summon.profile.model.id,
        modelRevision: PRESENTATION_ARTIFACT.contentVersion, modelHash: hex(PRESENTATION_ARTIFACT.blobHash),
      }),
    },
    {
      family: "vehicle" as const,
      entityId: vehicleEntityId,
      sourceId: "vehicle:sailboat:orphan",
      blockerId: "vehicle-semantic-presentation-binding-not-exported",
      record: Object.freeze({
        ...entityRecord(1),
        entityId: vehicleEntityId,
        class: "vehicle" as const,
        externalEntityId: "vehicle:sailboat:orphan",
        specimenId: "vehicle:sailboat:orphan",
        kindKey: "sailboat",
        name: "Orphan Sailboat",
        modelKey: vehicle.profile.model.id,
        modelRevision: PRESENTATION_ARTIFACT.contentVersion,
        modelHash: hex(PRESENTATION_ARTIFACT.blobHash),
        equipment: Object.freeze([]),
      }),
    },
  ];

  for (const entry of cases) {
    const { adapter } = await createAdapter();
    const source = orphanEntityEnvelope(entry.record);
    const token = adapter.prepareRuntimeExtraction(source);
    const result = adapter.extractBytes(source.render, context());
    adapter.finishPreparedRuntimeExtraction(token, true);
    assert.equal(result.presentations.some((presentation) => presentation.entityId === entry.entityId), false,
      entry.family);
    assert.equal(result.presentationFrame.bindings.some((binding) => binding.role === entry.family), false,
      entry.family);
    assert.deepEqual(result.presentationFrame.runtimeBlockers, [{
      id: `runtime:${entry.family}:source:${entry.sourceId}:entity:${entry.entityId}:${entry.blockerId}`,
      family: entry.family,
      status: "unavailable",
      sourceId: entry.sourceId,
      entityId: entry.entityId,
      blockerId: entry.blockerId,
    }]);
    assert.deepEqual(adapter.diagnostics().runtimeBlockers, result.presentationFrame.runtimeBlockers);
    composeExactPresentationFrame(result, presentations);
  }

  const { adapter } = await createAdapter();
  const orphan = orphanEntityEnvelope(combatRecord({
    role: "summon", recordId: "orphan:summon:no-domain", modelKey: summon.profile.model.id,
    modelRevision: PRESENTATION_ARTIFACT.contentVersion, modelHash: hex(PRESENTATION_ARTIFACT.blobHash),
  }));
  const source = Object.freeze({ ...orphan, hud: new Uint8Array() });
  const token = adapter.prepareRuntimeExtraction(source);
  const result = adapter.extractBytes(source.render, context());
  adapter.finishPreparedRuntimeExtraction(token, true);
  assert.equal(result.presentations.some((presentation) => presentation.entityId === COMBAT_ENTITY_ID), false);
  assert.equal(result.presentationFrame.bindings.length, 0);
  assert.deepEqual(result.presentationFrame.runtimeBlockers, [{
    id: `runtime:summon:source:orphan:summon:no-domain:entity:${COMBAT_ENTITY_ID}:summon-semantic-binding-row-missing`,
    family: "summon",
    status: "unavailable",
    sourceId: "orphan:summon:no-domain",
    entityId: COMBAT_ENTITY_ID,
    blockerId: "summon-semantic-binding-row-missing",
  }]);
  assert.equal(result.presentationFrame.combatBlockers[0]?.blockerId, "domain-extraction-not-submitted");
  composeExactPresentationFrame(result, presentations);
});

test("unmapped and legacy-unlinked combat entities are suppressed without creature fallback", async () => {
  for (const [role, status, modelKey, blockerId] of [
    ["projectile", "unmapped", "unresolved:combat-presentation", "combat-projectile-presentation-unmapped"],
    ["summon", "unlinked", PLAYER_RENDER_MODEL_ID_V1, "combat-summon-r6-link-missing"],
  ] as const) {
    const { adapter } = await createAdapter();
    const recordId = `${role}:水:legacy`;
    const row = combatRow({
      role, recordId, status,
      contentId: status === "unlinked" ? undefined : role === "projectile" ? "202" : "asterjaw",
      presentationId: status === "unlinked" ? undefined : `${role}:unmapped:水`,
      blockerId,
    });
    const source = combatEnvelope(row, combatRecord({
      role, recordId, modelKey, modelRevision: 0,
      modelHash: new Uint8Array(16),
    }), ["combat-projectile-and-summon-render-presentation-not-authoritative", blockerId]);
    const token = adapter.prepareRuntimeExtraction(source);
    const result = adapter.extractBytes(source.render, context());
    adapter.finishPreparedRuntimeExtraction(token, true);
    assert.equal(result.presentations.some((value) => value.entityId === COMBAT_ENTITY_ID), false);
    assert.equal(adapter.diagnostics().combatBindings, 0);
    assert.equal(adapter.diagnostics().combatBlockers.length, 1);
    assert.equal(adapter.diagnostics().combatBlockers[0]?.status,
      status === "unmapped" ? "unmapped" : "unavailable");
  }
});

test("missing linked combat presentation stays suppressed with its exact bounded blocker", async () => {
  const { presentations: production } = await createAdapter();
  const blocker = Object.freeze({
    id: "missing:projectile:linked-test",
    role: "projectile" as const,
    sourcePresentationIds: Object.freeze(["fixture:linked-projectile-missing"]),
    contentRefs: Object.freeze([Object.freeze({ domain: "item" as const, id: "missing-item-水" })]),
    reason: "The linked projectile fixture intentionally has no exact BWM2 identity.",
  });
  const profileCatalog = Object.freeze({
    ...production.profileCatalog,
    missingProfiles: Object.freeze([...production.profileCatalog.missingProfiles, blocker]
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  });
  const presentations = Object.freeze({
    ...production,
    profileCatalog,
    registry: createRenderPresentationRegistryV1(profileCatalog),
  });
  const { adapter } = await createAdapter({}, presentations);
  const recordId = "projectile:missing:水";
  const row = combatRow({
    role: "projectile",
    recordId,
    status: "missing",
    contentId: "missing-item-水",
    presentationId: blocker.id,
    blockerId: blocker.id,
  });
  const source = combatEnvelope(row, combatRecord({
    role: "projectile",
    recordId,
    modelKey: "unresolved:combat-presentation",
    modelRevision: 0,
    modelHash: new Uint8Array(16),
  }), ["combat-projectile-and-summon-render-presentation-not-authoritative", blocker.id]);
  const token = adapter.prepareRuntimeExtraction(source);
  const result = adapter.extractBytes(source.render, context());
  adapter.finishPreparedRuntimeExtraction(token, true);
  assert.equal(result.presentations.some((value) => value.entityId === COMBAT_ENTITY_ID), false);
  assert.deepEqual(adapter.diagnostics().combatBlockers, [{
    id: `combat:missing:projectile:${recordId}:${COMBAT_ENTITY_ID}:${blocker.id}`,
    status: "missing",
    role: "projectile",
    recordId,
    entityId: COMBAT_ENTITY_ID,
    contentId: "missing-item-水",
    presentationId: blocker.id,
    blockerId: blocker.id,
  }]);
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
  const boundMachine = result.presentationFrame.bindings.find((binding) => binding.role === "machine");
  assert.ok(boundMachine?.role === "machine");
  assert.equal(boundMachine.id, machine.id);
  assert.deepEqual(boundMachine.instanceIds, machine.instanceIds);
  assertExactBindingIdentity(boundMachine.binding, {
    role: "machine",
    profileId: exact.profile.id,
    modelId: exact.profile.model.id,
    primaryContentRef: { domain: "machine-profile", id: "apiary" },
  }, presentations);
  composeExactPresentationFrame(result, presentations);
});

test("composer rejects presentation coverage, profile, and instance tampering before touching its sink", async () => {
  const { adapter, presentations } = await createAdapter();
  const source = envelope(Item.StonePickaxe);
  const token = adapter.prepareRuntimeExtraction(source);
  const result = adapter.extractBytes(source.render, context());
  adapter.finishPreparedRuntimeExtraction(token, true);
  const binding = result.presentationFrame.bindings[0];
  assert.ok(binding);
  const cases = [
    {
      name: "coverage",
      pattern: /presentation frame coverage identity differs/u,
      frame: Object.freeze({ ...result.presentationFrame, coverageHash: "0".repeat(32) }),
    },
    {
      name: "profile",
      pattern: /has no exact coverage contract/u,
      frame: Object.freeze({
        ...result.presentationFrame,
        bindings: Object.freeze([Object.freeze({
          ...binding,
          binding: Object.freeze({ ...binding.binding, profileId: "held:forged-profile" }),
        })]),
      }),
    },
    {
      name: "instance",
      pattern: /references a missing instance/u,
      frame: Object.freeze({
        ...result.presentationFrame,
        bindings: Object.freeze([Object.freeze({ ...binding, instanceIds: Object.freeze([BigInt(0)]) })]),
      }),
    },
  ];
  for (const entry of cases) {
    const { composer, resourceRevisions } = presentationComposer(presentations);
    const tampered = Object.freeze({ ...result, presentationFrame: entry.frame });
    assert.throws(() => composer.submitEntities(tampered), entry.pattern, entry.name);
    assert.deepEqual(resourceRevisions, [], `${entry.name} reached the renderer sink`);
    assert.equal(composer.diagnostics().presentationBindings, 0);
  }
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

test("model identity sets dedupe exact tuples, stay bounded and match one deterministic tuple", async () => {
  const [profile, presentations] = await catalogs();
  const exact = presentations.registry.resolveProfileId("summon", "summon:asterjaw");
  assert.ok(exact.status === "exact");
  const modelKey = exact.profile.model.id;
  const matching = Object.freeze({
    modelKey,
    revision: PRESENTATION_ARTIFACT.contentVersion,
    contentHash: hex(PRESENTATION_ARTIFACT.blobHash),
  });
  const baseAttestations = createProductionRenderModelAttestationsR10(
    profile,
    presentations,
    CONTENT.artifacts,
  ).filter((attestation) => attestation.modelKey !== modelKey);
  const source = combatEnvelope(combatRow({
    role: "summon",
    recordId: "summon:attestation",
    status: "exact",
    contentId: exact.profile.contentRefs.find((reference) => reference.domain === "creature-profile")!.id,
    presentationId: exact.profile.id,
    profileId: exact.profile.id,
    modelId: modelKey,
  }), combatRecord({
    role: "summon",
    recordId: "summon:attestation",
    modelKey,
    modelRevision: matching.revision,
    modelHash: matching.contentHash,
  }));
  const extractor = (modelAttestations: ConstructorParameters<typeof RustEntityRenderExtractionR10>[0]["modelAttestations"]) =>
    new RustEntityRenderExtractionR10({
      catalog: profile.catalog,
      expectedContentManifestHash: hex(CONTENT_HASH),
      modelAttestations,
    });

  const deduped = extractor([...baseAttestations, matching, matching]);
  assert.equal(deduped.extractBytes(source.render, context()).presentations
    .filter((presentation) => presentation.entityId === COMBAT_ENTITY_ID).length, 1);

  const alternate = Object.freeze({ modelKey, revision: matching.revision + 1, contentHash: new Uint8Array(16).fill(0x33) });
  const ordered = extractor([...baseAttestations, alternate, matching]).extractBytes(source.render, context());
  const reversed = extractor([...baseAttestations, matching, alternate]).extractBytes(source.render, context());
  assert.deepEqual(reversed, ordered);

  const noMatch = extractor([...baseAttestations, {
    ...matching,
    contentHash: new Uint8Array(16).fill(0x55),
  }]);
  assert.throws(() => noMatch.extractBytes(source.render, context()), /model content hash mismatch/u);

  assert.throws(() => extractor([
    ...baseAttestations,
    ...Array.from({ length: 9 }, (_, index) => Object.freeze({
      modelKey,
      revision: index + 1,
      contentHash: new Uint8Array(16).fill(index + 1),
    })),
  ]), /model attestation identity cap exceeded/u);
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
    const hot = planRustDroppedHotTransformsR10(source);
    assert.equal(hot.transforms.length, 1,
      "native hot transform admission must not depend on an exact visual presentation profile");
    assert.equal(hot.transforms[0]?.dropId, "drop:presentation-test");
    assert.equal(hot.transforms[0]?.entityId, DROP_ENTITY_ID);
    const token = adapter.prepareRuntimeExtraction(source);
    const result = adapter.extractBytes(source.render, context());
    adapter.finishPreparedRuntimeExtraction(token, true);
    assert.equal(result.presentations.some((presentation) => presentation.entityId === DROP_ENTITY_ID), false);
    assert.equal(result.presentationFrame.bindings.some((binding) => binding.role === "dropped-item"), false);
    assert.deepEqual(result.presentationFrame.droppedBlockers, adapter.diagnostics().droppedBlockers);
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

test("dropped hot transform planner rejects missing, duplicate, cross-envelope, stale, and mismatched records", async () => {
  const { presentations } = await createAdapter();
  const exact = presentations.registry.resolve("dropped-item", { domain: "item", id: String(Item.CaptureOrb) });
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

  const missingRecord = Object.freeze({
    ...source,
    render: encodeRustEntityExtractionR6V3(entityExtraction()),
  });
  assert.throws(() => planRustDroppedHotTransformsR10(missingRecord), /no same-envelope BWR6 entity/u);

  const orphan = Object.freeze({
    ...dropRecord(1, exact.profile.model.id, PRESENTATION_ARTIFACT.contentVersion, hex(PRESENTATION_ARTIFACT.blobHash)),
    entityId: BigInt("4294967299"),
    externalEntityId: "drop:orphan",
    specimenId: "drop:orphan",
  });
  const duplicateRecord = Object.freeze({
    ...source,
    render: encodeRustEntityExtractionR6V3(entityExtraction(1, 10, [], [
      dropRecord(1, exact.profile.model.id, PRESENTATION_ARTIFACT.contentVersion, hex(PRESENTATION_ARTIFACT.blobHash)),
      orphan,
    ])),
  });
  assert.throws(() => planRustDroppedHotTransformsR10(duplicateRecord), /has no same-envelope BWX0 row/u);

  const duplicateRow = Object.freeze({
    ...source,
    hud: domainBundle(1, 10, new Map([
      [2, [playerRow(BigInt(1), Item.StonePickaxe)]],
      [3, [
        dropRow({
          itemCode: Item.CaptureOrb,
          entityRevision: BigInt(1),
          status: "exact",
          profileId: exact.profile.id,
          modelId: exact.profile.model.id,
        }),
        dropRow({
          itemCode: Item.CaptureOrb,
          entityRevision: BigInt(1),
          status: "exact",
          profileId: exact.profile.id,
          modelId: exact.profile.model.id,
          dropId: "drop:z-duplicate",
        }),
      ]],
    ])),
  });
  assert.throws(() => planRustDroppedHotTransformsR10(duplicateRow), /duplicate or empty entity identity/u);

  const crossEnvelope = Object.freeze({
    ...source,
    hud: domainBundle(2, 10, new Map([
      [2, [playerRow(BigInt(1), Item.StonePickaxe)]],
      [3, [dropRow({
        itemCode: Item.CaptureOrb,
        entityRevision: BigInt(1),
        status: "exact",
        profileId: exact.profile.id,
        modelId: exact.profile.model.id,
      })]],
    ])),
  });
  assert.throws(() => planRustDroppedHotTransformsR10(crossEnvelope), /inner extraction revision/u);

  const crossIdentity = Object.freeze({
    ...source,
    identity: Object.freeze({ ...source.identity, stateHash: "4".repeat(32) }),
  });
  assert.throws(() => planRustDroppedHotTransformsR10(crossIdentity), /BWX0 state hash differs/u);

  const mismatchedPosition = Object.freeze({
    ...source,
    render: encodeRustEntityExtractionR6V3(entityExtraction(1, 10, [], [Object.freeze({
      ...dropRecord(1, exact.profile.model.id, PRESENTATION_ARTIFACT.contentVersion, hex(PRESENTATION_ARTIFACT.blobHash)),
      position: Object.freeze({ x: 2.001, y: 4, z: 0 }),
    })])),
  });
  assert.throws(() => planRustDroppedHotTransformsR10(mismatchedPosition), /position differs from BWR6/u);

  const newer = dropEnvelope({
    itemCode: Item.CaptureOrb,
    status: "exact",
    profileId: exact.profile.id,
    modelId: exact.profile.model.id,
    modelKey: exact.profile.model.id,
    modelRevision: PRESENTATION_ARTIFACT.contentVersion,
    modelHash: hex(PRESENTATION_ARTIFACT.blobHash),
    revision: 2,
    authorityTick: 11,
    createdTick: BigInt(10),
  });
  const newerFrame = planRustDroppedHotTransformsR10(newer);
  assert.throws(() => planRustDroppedHotTransformsR10(source, newerFrame), /regressed its monotonic source revision/u);

  const staleEntity = dropEnvelope({
    itemCode: Item.CaptureOrb,
    status: "exact",
    profileId: exact.profile.id,
    modelId: exact.profile.model.id,
    modelKey: exact.profile.model.id,
    modelRevision: PRESENTATION_ARTIFACT.contentVersion,
    modelHash: hex(PRESENTATION_ARTIFACT.blobHash),
    revision: 3,
    authorityTick: 12,
    entityRevision: BigInt(1),
    createdTick: BigInt(10),
  });
  assert.throws(() => planRustDroppedHotTransformsR10(staleEntity, newerFrame), /native entity revision or age/u);

  const reusedRevision = Object.freeze({ ...newer, extractionHash: "3".repeat(32) });
  assert.throws(() => planRustDroppedHotTransformsR10(reusedRevision, newerFrame), /revision was reused for different state/u);
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
