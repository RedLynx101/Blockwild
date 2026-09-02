/**
 * Isolated R10 bridge from the Rust R6 entity extraction into Extraction V2.
 *
 * This is deliberately not a live cutover. It consumes one already-decoded,
 * bounded BWR6 schema-3 snapshot, verifies content/model identity, and emits
 * renderer-independent resource/frame records. No Three.js scene is queried.
 */

import {
  compileRenderEntityModelResourcesR10,
  findRenderEntityCompiledModelR10,
  renderEntityAttachmentStableIdR10,
  renderEntityPaletteKeyR10,
  renderEntityStableIdR10,
  type RenderEntityCompiledModelCatalogR10,
  type RenderEntityCompiledModelNodeR10,
  type RenderEntityCompiledModelR10,
  type RenderEntityModelResourcesR10,
} from "./rust-render-entity-catalog-r10.ts";
import {
  createRenderFrameV2,
  createRenderResourceBatchV2,
  RENDER_MAX_INSTANCES_V2,
  RENDER_MAX_RESOURCE_OPERATIONS_V2,
  type RenderCameraV2,
  type RenderEnvironmentV2,
  type RenderFrameV2,
  type RenderInstanceV2,
  type RenderResourceBatchV2,
  type RenderTransformV2,
} from "./rust-render-extraction-v2.ts";
import {
  decodeRustEntityExtractionR6V3,
  rustEntityExtractionPromotionStateR6V3,
} from "./rust-entity-authority-codec-r6.ts";
import type {
  RustEntityClassR6,
  RustEntityExtractionR6V3,
  RustEntityExtractionRecordR6V3,
  RustEntityMovementModeR6,
  RustEntityResidencyR6,
  RustEntitySimulationTierR6,
} from "./rust-entity-authority-contract-r6.ts";

export const RENDER_ENTITY_EXTRACTION_SCHEMA_R10 = 3 as const;
export const RENDER_ENTITY_MAX_SOURCE_RECORDS_R10 = 4_096;
export const RENDER_ENTITY_MAX_EQUIPMENT_R10 = 128;
export const RENDER_ENTITY_MAX_EQUIPMENT_CUSTOM_R10 = 128;
export const RENDER_ENTITY_MAX_MOUNT_SEATS_R10 = 32;
export const RENDER_ENTITY_MAX_RESEARCH_R10 = 512;
export const RENDER_ENTITY_ACTION_PHASE_SHIFT_R10 = 16;

const U64_MAX = BigInt("0xffffffffffffffff");
const ZERO_HASH = new Uint8Array(16);
const WHITE = Object.freeze([255, 255, 255, 255] as const);
const IDENTITY_ROTATION = Object.freeze([0, 0, 0, 1] as const);
const UNIT_SCALE = Object.freeze([1, 1, 1] as const);

export type RenderEntityResidencyR10 = RustEntityResidencyR6;
export type RenderEntityClassR10 = RustEntityClassR6;
export type RenderEntityTierR10 = RustEntitySimulationTierR6;
export type RenderEntityMovementModeR10 = RustEntityMovementModeR6;
export type RenderEntityAuthoritativeRecordR10 = RustEntityExtractionRecordR6V3;
export type RenderEntityAuthoritativeExtractionR10 = RustEntityExtractionR6V3;

export type RenderEntityModelAttestationR10 = Readonly<{
  modelKey: string;
  revision: number;
  contentHash: Uint8Array;
}>;

export type RenderEntityEquipmentModelR10 = Readonly<{
  itemKey: string;
  modelKey: string;
}>;

export type RenderEntityFrameContextR10 = Readonly<{
  epoch: bigint;
  frameSequence: bigint;
  simulationTick: bigint;
  animationTimeMicros: bigint;
  camera: RenderCameraV2;
  environment: RenderEnvironmentV2;
}>;

export type RenderEntityPresentationR10 = Readonly<{
  entityId: bigint;
  entityRevision: bigint;
  class: RenderEntityClassR10;
  externalEntityId: string;
  specimenId: string;
  kindKey: string;
  variantKey: string | null;
  name: string | null;
  modelKey: string;
  modelRevision: number;
  modelHash: Uint8Array;
  residency: RenderEntityResidencyR10;
  tier: RenderEntityTierR10;
  protection: bigint;
  tamed: boolean;
  movementMode: RenderEntityMovementModeR10;
  action: RenderEntityAuthoritativeRecordR10["action"];
  research: readonly (readonly [string, number])[];
  equipment: readonly Readonly<{
    slotKey: string;
    itemKey: string;
    count: number;
    durability: number;
    custom: readonly (readonly [string, Uint8Array])[];
    instanceIds: readonly bigint[];
  }>[];
  mount: RenderEntityAuthoritativeRecordR10["mount"];
  instanceIds: readonly bigint[];
  visible: boolean;
}>;

export type RenderEntityExtractionResultR10 = Readonly<{
  extractionRevision: bigint;
  authorityTick: bigint;
  contentManifestHash: Uint8Array;
  /** Canonical BWM2 identity verified before any model resources are compiled. */
  modelCatalogHash: string;
  modelCatalogRevision: bigint;
  /** Null when this frame references only resources already emitted in the epoch. */
  resources: RenderResourceBatchV2 | null;
  frame: RenderFrameV2;
  presentations: readonly RenderEntityPresentationR10[];
  stats: Readonly<{
    sourceRecords: number;
    resourceOperations: number;
    instances: number;
    hiddenDormant: number;
    tiers: Readonly<Record<RenderEntityTierR10, number>>;
  }>;
}>;

export type RustEntityRenderExtractionOptionsR10 = Readonly<{
  catalog: RenderEntityCompiledModelCatalogR10;
  expectedContentManifestHash: Uint8Array;
  modelAttestations: readonly RenderEntityModelAttestationR10[];
  equipmentModels?: readonly RenderEntityEquipmentModelR10[];
  maxInstances?: number;
  maxResourceOperations?: number;
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function compareBytes(left: Uint8Array, right: Uint8Array) {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.byteLength - right.byteLength;
}

function finite(value: number, label: string) {
  invariant(Number.isFinite(value), `${label} is not finite`);
  return Math.fround(value);
}

function u32(value: number, label: string) {
  invariant(Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff, `${label} is not u32`);
  return value;
}

function u64(value: bigint, label: string, allowZero = true) {
  invariant(value >= BigInt(allowZero ? 0 : 1) && value <= U64_MAX, `${label} is not u64`);
  return value;
}

function entityId(value: bigint, label: string) {
  u64(value, label, false);
  invariant((value & BigInt(0xffff_ffff)) !== BigInt(0) && (value >> BigInt(32)) !== BigInt(0),
    `${label} contains a reserved component`);
  return value;
}

function nonEmpty(value: string, label: string, maximum = 4_096) {
  const length = new TextEncoder().encode(value).byteLength;
  invariant(length > 0 && length <= maximum && !/\p{Cc}/u.test(value), `${label} is invalid`);
  return value;
}

function hash16(value: Uint8Array, label: string, allowZero = false) {
  invariant(value instanceof Uint8Array && value.byteLength === 16, `${label} is not a 128-bit hash`);
  invariant(allowZero || !equalBytes(value, ZERO_HASH), `${label} is unresolved`);
  return value;
}

function validateCanonicalMap<T>(
  entries: readonly (readonly [string, T])[],
  maximum: number,
  label: string,
) {
  invariant(entries.length <= maximum, `${label} exceeds its bound`);
  let previous: string | null = null;
  for (const [key] of entries) {
    nonEmpty(key, `${label} key`);
    invariant(previous === null || previous < key, `${label} is not canonical and unique`);
    previous = key;
  }
}

function validateRecord(record: RenderEntityAuthoritativeRecordR10) {
  entityId(record.entityId, "entity id");
  invariant(record.residency === "hot" || record.residency === "cold", "entity residency is invalid");
  invariant(["creature", "player", "sentient", "construct", "projectile", "vehicle"].includes(record.class), "entity class is invalid");
  invariant(["hero", "nearby", "coarse", "dormant"].includes(record.simulationTier), "entity tier is invalid");
  invariant(record.residency !== "cold" || record.simulationTier === "dormant", "cold entity is not dormant");
  u64(record.protection, "entity protection");
  u64(record.entityRevision, "entity revision", false);
  for (const [label, value] of [
    ["external entity id", record.externalEntityId], ["specimen id", record.specimenId],
    ["kind key", record.kindKey], ["model key", record.modelKey], ["action key", record.action.key],
  ] as const) nonEmpty(value, label);
  if (record.variantKey !== null) nonEmpty(record.variantKey, "variant key");
  if (record.name !== null) nonEmpty(record.name, "entity name");
  u32(record.modelRevision, "model revision");
  invariant(record.modelRevision > 0, "model revision is unresolved");
  hash16(record.modelHash, "model hash");
  for (const [label, value] of [
    ["position x", record.position.x], ["position y", record.position.y], ["position z", record.position.z],
    ["yaw", record.yaw], ["velocity x", record.velocity.x], ["velocity y", record.velocity.y],
    ["velocity z", record.velocity.z], ["health", record.health], ["maximum health", record.maximumHealth],
  ] as const) finite(value, label);
  invariant(record.maximumHealth > 0 && record.health >= 0 && record.health <= record.maximumHealth, "entity health is invalid");
  u64(record.ageTicks, "entity age");
  invariant(["ground", "swim", "fly", "burrow", "climb", "mounted", "knocked-back", "disabled"].includes(record.movementMode), "movement mode is invalid");
  u64(record.lastDamageTick, "last damage tick");
  u32(record.action.phase, "action phase");
  invariant(record.action.phase <= 0xffff, "action phase exceeds u16");
  u64(record.action.startedTick, "action start tick");
  u64(record.action.endsTick, "action end tick");
  invariant(record.action.endsTick >= record.action.startedTick, "action interval is reversed");
  if (record.action.target !== null) entityId(record.action.target, "action target");
  validateCanonicalMap(record.equipment, RENDER_ENTITY_MAX_EQUIPMENT_R10, "equipment map");
  for (const [slotKey, slot] of record.equipment) {
    nonEmpty(slotKey, "equipment slot");
    nonEmpty(slot.itemKey, "equipment item");
    u32(slot.count, "equipment count");
    invariant(slot.count > 0, "equipment count is zero");
    u32(slot.durability, "equipment durability");
    validateCanonicalMap(slot.custom, RENDER_ENTITY_MAX_EQUIPMENT_CUSTOM_R10, "equipment custom map");
    for (const [, value] of slot.custom) invariant(value instanceof Uint8Array && value.byteLength <= 1_048_576, "equipment custom bytes exceed bounds");
  }
  if (record.mount.parentMount !== null) entityId(record.mount.parentMount, "parent mount");
  if (record.mount.occupiedSeat !== null) invariant(Number.isInteger(record.mount.occupiedSeat) && record.mount.occupiedSeat >= 0 && record.mount.occupiedSeat <= 0xff, "occupied seat is invalid");
  invariant((record.mount.parentMount === null) === (record.mount.occupiedSeat === null),
    "parent mount and occupied seat must be present together");
  invariant(record.mount.parentMount !== record.entityId, "entity cannot mount itself");
  if (record.mount.saddleKey !== null) nonEmpty(record.mount.saddleKey, "saddle key");
  invariant(record.mount.seats.length <= RENDER_ENTITY_MAX_MOUNT_SEATS_R10, "mount seats exceed bounds");
  let previousSeat = -1;
  for (const seat of record.mount.seats) {
    invariant(Number.isInteger(seat.index) && seat.index > previousSeat && seat.index <= 0xff, "mount seats are not canonical");
    previousSeat = seat.index;
    nonEmpty(seat.role, "mount seat role");
    finite(seat.offset.x, "mount seat x"); finite(seat.offset.y, "mount seat y"); finite(seat.offset.z, "mount seat z");
    if (seat.occupant !== null) entityId(seat.occupant, "mount occupant");
    u32(seat.controlWeightMilli, "mount control weight");
    invariant(seat.controlWeightMilli <= 0xffff, "mount control weight exceeds u16");
  }
  validateCanonicalMap(record.research, RENDER_ENTITY_MAX_RESEARCH_R10, "research map");
  for (const [, value] of record.research) u32(value, "research value");
}

function validateSource(source: RenderEntityAuthoritativeExtractionR10, expectedContentManifestHash: Uint8Array) {
  invariant(source.schema === RENDER_ENTITY_EXTRACTION_SCHEMA_R10, "BWR6 extraction schema is unsupported");
  const promotion = rustEntityExtractionPromotionStateR6V3(source);
  invariant(promotion.ready, `BWR6 extraction is not promotable: ${promotion.blockers.join(",")}`);
  u64(source.extractionRevision, "extraction revision");
  u64(source.authorityTick, "authority tick");
  hash16(source.contentManifestHash, "content manifest hash");
  invariant(source.contentReady, "entity content is not installed and attested");
  invariant(equalBytes(source.contentManifestHash, expectedContentManifestHash), "entity content manifest hash mismatch");
  for (const [label, value] of [["total", source.total], ["selected", source.selected], ["omitted", source.omitted]] as const) u32(value, label);
  invariant(source.selected === source.records.length && source.selected + source.omitted === source.total, "entity extraction counts are inconsistent");
  invariant(source.total <= RENDER_ENTITY_MAX_SOURCE_RECORDS_R10, "entity extraction exceeds its record cap");
  invariant(source.omitted === 0, "entity extraction is incomplete; omitted records cannot be rendered safely");
  let previousHot = BigInt(-1);
  let previousCold = BigInt(-1);
  let coldStarted = false;
  for (const record of source.records) {
    validateRecord(record);
    if (record.residency === "hot") {
      invariant(!coldStarted && record.entityId > previousHot, "hot entities are not canonical");
      previousHot = record.entityId;
    } else {
      coldStarted = true;
      invariant(record.entityId > previousCold, "cold entities are not canonical");
      previousCold = record.entityId;
    }
  }
}

function multiplyQuaternion(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
) {
  const [lx, ly, lz, lw] = left;
  const [rx, ry, rz, rw] = right;
  return Object.freeze([
    Math.fround(lw * rx + lx * rw + ly * rz - lz * ry),
    Math.fround(lw * ry - lx * rz + ly * rw + lz * rx),
    Math.fround(lw * rz + lx * ry - ly * rx + lz * rw),
    Math.fround(lw * rw - lx * rx - ly * ry - lz * rz),
  ] as const);
}

function yawQuaternion(yaw: number) {
  const half = yaw / 2;
  return Object.freeze([0, Math.fround(Math.sin(half)), 0, Math.fround(Math.cos(half))] as const);
}

function worldRootTransform(record: RenderEntityAuthoritativeRecordR10, local: RenderTransformV2): RenderTransformV2 {
  const sine = Math.sin(record.yaw);
  const cosine = Math.cos(record.yaw);
  const [x, y, z] = local.translation;
  return Object.freeze({
    translation: Object.freeze([
      Math.fround(record.position.x + x * cosine + z * sine),
      Math.fround(record.position.y + y),
      Math.fround(record.position.z - x * sine + z * cosine),
    ] as const),
    rotation: multiplyQuaternion(yawQuaternion(record.yaw), local.rotation),
    scale: local.scale,
  });
}

function mountedRootTransform(
  rider: RenderEntityAuthoritativeRecordR10,
  mount: RenderEntityAuthoritativeRecordR10,
  local: RenderTransformV2,
): RenderTransformV2 {
  return Object.freeze({
    translation: local.translation,
    rotation: multiplyQuaternion(yawQuaternion(rider.yaw - mount.yaw), local.rotation),
    scale: local.scale,
  });
}

function tierNodeIds(model: RenderEntityCompiledModelR10, tier: RenderEntityTierR10) {
  if (tier === "dormant") return new Set<number>();
  if (tier === "hero" || tier === "nearby") return new Set(model.nodes.map((node) => node.nodeId));
  const byId = new Map(model.nodes.map((node) => [node.nodeId, node] as const));
  const visible = model.nodes.filter((node) => node.colorRgba8[3] > 0)
    .sort((left, right) => {
      const leftVolume = left.transform.scale[0] * left.transform.scale[1] * left.transform.scale[2];
      const rightVolume = right.transform.scale[0] * right.transform.scale[1] * right.transform.scale[2];
      return rightVolume - leftVolume || left.nodeId - right.nodeId;
    })
    .slice(0, 32);
  const selected = new Set<number>();
  for (const node of visible) {
    let cursor: RenderEntityCompiledModelNodeR10 | undefined = node;
    while (cursor && !selected.has(cursor.nodeId)) {
      selected.add(cursor.nodeId);
      cursor = cursor.parentNodeId === null ? undefined : byId.get(cursor.parentNodeId);
    }
  }
  if (selected.size === 0) selected.add(model.nodes[0].nodeId);
  return selected;
}

function domainForClass(value: RenderEntityClassR10): RenderInstanceV2["domain"] {
  if (value === "player" || value === "sentient") return 2;
  if (value === "projectile") return 6;
  if (value === "vehicle") return 7;
  return 1;
}

function attachmentAnchorTransform(slotKey: string): RenderTransformV2 {
  const semantic = slotKey.toLowerCase();
  const translation = /head|helmet|horn/u.test(semantic) ? [0, 1.45, 0] as const
    : /off|left/u.test(semantic) ? [-0.58, 0.72, -0.08] as const
      : /hand|main|right|weapon|tool/u.test(semantic) ? [0.58, 0.72, -0.08] as const
        : /back|cloak|pack/u.test(semantic) ? [0, 0.72, 0.36] as const
          : [0, 0.55, 0] as const;
  return Object.freeze({ translation: Object.freeze(translation), rotation: IDENTITY_ROTATION, scale: UNIT_SCALE });
}

function cloneResearch(entries: readonly (readonly [string, number])[]) {
  return Object.freeze(entries.map(([key, value]) => Object.freeze([key, value] as const)));
}

function cloneCustom(entries: readonly (readonly [string, Uint8Array])[]) {
  return Object.freeze(entries.map(([key, value]) => Object.freeze([key, Uint8Array.from(value)] as const)));
}

function animationFlags(record: RenderEntityAuthoritativeRecordR10, node: RenderEntityCompiledModelNodeR10) {
  const authored = record.simulationTier === "coarse" ? 0 : node.animationFlags & 0xffff;
  return (authored | record.action.phase << RENDER_ENTITY_ACTION_PHASE_SHIFT_R10) >>> 0;
}

export function decodeRenderEntityAnimationFlagsR10(value: number) {
  invariant(Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff, "entity animation flags are not u32");
  return Object.freeze({
    authoredFlags: value & 0xffff,
    actionPhase: value >>> RENDER_ENTITY_ACTION_PHASE_SHIFT_R10,
  });
}

function cloneAction(action: RenderEntityAuthoritativeRecordR10["action"]) {
  return Object.freeze({ ...action });
}

function cloneMount(mount: RenderEntityAuthoritativeRecordR10["mount"]): RenderEntityAuthoritativeRecordR10["mount"] {
  return Object.freeze({
    ...mount,
    seats: Object.freeze(mount.seats.map((seat) => Object.freeze({
      ...seat,
      offset: Object.freeze({ ...seat.offset }),
    }))),
  });
}

export class RustEntityRenderExtractionR10 {
  private readonly catalog: RenderEntityCompiledModelCatalogR10;
  private readonly expectedContentManifestHash: Uint8Array;
  private readonly modelAttestations = new Map<string, RenderEntityModelAttestationR10[]>();
  private readonly equipmentModels = new Map<string, string>();
  private readonly modelResourceCache = new Map<string, RenderEntityModelResourcesR10>();
  private readonly emittedModelIds = new Set<string>();
  private readonly emittedResourceIds = new Set<bigint>();
  private readonly maxInstances: number;
  private readonly maxResourceOperations: number;
  private lastExtractionRevision: bigint | null = null;
  private resourceEpoch: bigint | null = null;
  private resourceRevision = BigInt(0);

  constructor(options: RustEntityRenderExtractionOptionsR10) {
    this.catalog = options.catalog;
    this.expectedContentManifestHash = Uint8Array.from(hash16(options.expectedContentManifestHash, "expected content manifest hash"));
    for (const attestation of options.modelAttestations) {
      nonEmpty(attestation.modelKey, "attested model key");
      u32(attestation.revision, "attested model revision");
      invariant(attestation.revision > 0, "attested model revision is unresolved");
      hash16(attestation.contentHash, "attested model hash");
      const owned = Object.freeze({
        ...attestation,
        contentHash: Uint8Array.from(attestation.contentHash),
      });
      const candidates = this.modelAttestations.get(attestation.modelKey) ?? [];
      if (candidates.some((candidate) => candidate.revision === owned.revision
        && equalBytes(candidate.contentHash, owned.contentHash))) continue;
      invariant(candidates.length < 8, "model attestation identity cap exceeded");
      candidates.push(owned);
      candidates.sort((left, right) => left.revision - right.revision
        || compareBytes(left.contentHash, right.contentHash));
      this.modelAttestations.set(attestation.modelKey, candidates);
    }
    invariant(this.modelAttestations.size > 0, "no model attestations were supplied");
    for (const mapping of options.equipmentModels ?? []) {
      nonEmpty(mapping.itemKey, "equipment item key");
      nonEmpty(mapping.modelKey, "equipment model key");
      invariant(!this.equipmentModels.has(mapping.itemKey), "duplicate equipment model mapping");
      invariant(findRenderEntityCompiledModelR10(this.catalog, mapping.modelKey) !== null, `missing equipment model '${mapping.modelKey}'`);
      this.equipmentModels.set(mapping.itemKey, mapping.modelKey);
    }
    this.maxInstances = options.maxInstances ?? RENDER_MAX_INSTANCES_V2;
    this.maxResourceOperations = options.maxResourceOperations ?? RENDER_MAX_RESOURCE_OPERATIONS_V2;
    invariant(Number.isInteger(this.maxInstances) && this.maxInstances > 0 && this.maxInstances <= RENDER_MAX_INSTANCES_V2, "entity instance cap is invalid");
    invariant(Number.isInteger(this.maxResourceOperations) && this.maxResourceOperations > 0 && this.maxResourceOperations <= RENDER_MAX_RESOURCE_OPERATIONS_V2, "entity resource cap is invalid");
  }

  resetRevisionGuard() {
    this.lastExtractionRevision = null;
  }

  resetResourceReplay() {
    this.emittedModelIds.clear();
    this.emittedResourceIds.clear();
    this.resourceEpoch = null;
    this.resourceRevision = BigInt(0);
  }

  extractBytes(bytes: Uint8Array | ArrayBuffer, context: RenderEntityFrameContextR10) {
    return this.extract(decodeRustEntityExtractionR6V3(bytes), context);
  }

  extract(source: RenderEntityAuthoritativeExtractionR10, context: RenderEntityFrameContextR10): RenderEntityExtractionResultR10 {
    validateSource(source, this.expectedContentManifestHash);
    invariant(this.lastExtractionRevision === null || source.extractionRevision >= this.lastExtractionRevision,
      "stale entity extraction revision");
    invariant(context.simulationTick === source.authorityTick, "entity frame tick does not match authority");
    u64(context.epoch, "render epoch"); u64(context.frameSequence, "frame sequence");
    u64(context.simulationTick, "simulation tick"); u64(context.animationTimeMicros, "animation time");
    invariant(this.resourceEpoch === null || context.epoch >= this.resourceEpoch, "stale entity resource epoch");
    const epochChanged = this.resourceEpoch === null || context.epoch > this.resourceEpoch;
    const alreadyEmitted = epochChanged ? new Set<string>() : this.emittedModelIds;
    const alreadyEmittedResources = epochChanged ? new Set<bigint>() : this.emittedResourceIds;
    const currentResourceRevision = epochChanged ? BigInt(0) : this.resourceRevision;

    const recordsById = new Map<bigint, RenderEntityAuthoritativeRecordR10>();
    for (const record of source.records) {
      invariant(!recordsById.has(record.entityId), "duplicate authoritative entity id");
      recordsById.set(record.entityId, record);
      const model = findRenderEntityCompiledModelR10(this.catalog, record.modelKey);
      invariant(model !== null, `missing compiled entity model '${record.modelKey}'`);
      const attestations = this.modelAttestations.get(record.modelKey);
      invariant(attestations !== undefined, `missing content attestation for model '${record.modelKey}'`);
      const revisionAttestations = attestations.filter((attestation) => record.modelRevision === attestation.revision);
      invariant(revisionAttestations.length > 0, `model revision mismatch for '${record.modelKey}'`);
      invariant(revisionAttestations.some((attestation) => equalBytes(record.modelHash, attestation.contentHash)),
        `model content hash mismatch for '${record.modelKey}'`);
      for (const [, equipment] of record.equipment) {
        invariant(this.equipmentModels.has(equipment.itemKey), `missing equipment model mapping for '${equipment.itemKey}'`);
      }
    }

    const riderAnchors = new Map<bigint, { anchorId: bigint; mount: RenderEntityAuthoritativeRecordR10 }>();
    for (const mount of source.records) {
      for (const seat of mount.mount.seats) {
        if (seat.occupant === null) continue;
        const occupant = recordsById.get(seat.occupant);
        invariant(occupant !== undefined, `mount seat ${mount.entityId}:${seat.index} references a missing occupant`);
        invariant(seat.occupant !== mount.entityId, "entity cannot occupy its own mount seat");
        invariant(occupant.mount.parentMount === mount.entityId && occupant.mount.occupiedSeat === seat.index,
          "mount and rider authority disagree");
        invariant(!riderAnchors.has(seat.occupant), "rider occupies multiple mount seats");
        riderAnchors.set(seat.occupant, {
          anchorId: renderEntityAttachmentStableIdR10(mount.entityId, `seat:${seat.index}`, 0),
          mount,
        });
      }
    }
    for (const record of source.records) {
      if (record.mount.parentMount === null) continue;
      const riderAnchor = riderAnchors.get(record.entityId);
      invariant(riderAnchor !== undefined, "rider has no matching authoritative mount seat");
      invariant((record.simulationTier === "dormant") === (riderAnchor.mount.simulationTier === "dormant"),
        "mount and rider visibility tiers disagree");
      const visited = new Set<bigint>([record.entityId]);
      let cursor: RenderEntityAuthoritativeRecordR10 | undefined = riderAnchor.mount;
      while (cursor.mount.parentMount !== null) {
        invariant(!visited.has(cursor.entityId), "mount parent cycle detected");
        visited.add(cursor.entityId);
        cursor = recordsById.get(cursor.mount.parentMount);
        invariant(cursor !== undefined, "mount parent chain references a missing entity");
      }
    }

    const requiredModelIds = new Set<string>();
    for (const record of source.records) {
      if (record.simulationTier === "dormant") continue;
      requiredModelIds.add(record.modelKey);
      for (const [, equipment] of record.equipment) requiredModelIds.add(this.equipmentModels.get(equipment.itemKey)!);
    }
    const resourcesByModel = new Map<string, RenderEntityModelResourcesR10>();
    const operations: RenderResourceBatchV2["operations"][number][] = [];
    const resourceIds = new Set<bigint>();
    for (const modelId of [...requiredModelIds].sort()) {
      const model = findRenderEntityCompiledModelR10(this.catalog, modelId);
      invariant(model !== null, `missing compiled attachment model '${modelId}'`);
      const resources = this.modelResourceCache.get(modelId) ?? compileRenderEntityModelResourcesR10(this.catalog, model);
      this.modelResourceCache.set(modelId, resources);
      if (!alreadyEmitted.has(modelId)) {
        for (const operation of resources.operations) {
          const id = operation.kind === "upsert-geometry" ? operation.geometry.id
            : operation.kind === "upsert-material" ? operation.material.id
              : operation.kind === "upsert-texture" ? operation.texture.id : operation.id;
          invariant(!alreadyEmittedResources.has(id) && !resourceIds.has(id), `renderer resource id collision at ${id}`);
          resourceIds.add(id);
          operations.push(operation);
        }
      }
      resourcesByModel.set(modelId, resources);
    }
    invariant(operations.length <= this.maxResourceOperations, "entity render resource cap exceeded");

    const instances: RenderInstanceV2[] = [];
    const instanceIds = new Set<bigint>();
    const presentations: RenderEntityPresentationR10[] = [];
    const primaryRootByEntity = new Map<bigint, bigint>();
    const mainInstanceIdsByEntity = new Map<bigint, bigint[]>();
    const append = (instance: RenderInstanceV2) => {
      invariant(!instanceIds.has(instance.stableId), `renderer instance id collision at ${instance.stableId}`);
      invariant(instances.length < this.maxInstances, "entity render instance cap exceeded");
      instanceIds.add(instance.stableId);
      instances.push(Object.freeze(instance));
    };

    for (const record of source.records) {
      if (record.simulationTier === "dormant") continue;
      const model = findRenderEntityCompiledModelR10(this.catalog, record.modelKey)!;
      const resources = resourcesByModel.get(record.modelKey)!;
      const selected = tierNodeIds(model, record.simulationTier);
      const visibleNodes = model.nodes.filter((node) => selected.has(node.nodeId));
      invariant(visibleNodes.length > 0, `entity model '${record.modelKey}' has no selected nodes`);
      const selectedIds = new Set(visibleNodes.map((node) => node.nodeId));
      const firstRoot = visibleNodes.find((node) => node.parentNodeId === null || !selectedIds.has(node.parentNodeId));
      invariant(firstRoot !== undefined, `entity model '${record.modelKey}' has no root`);
      primaryRootByEntity.set(record.entityId, renderEntityStableIdR10(record.entityId, firstRoot.nodeId));
      const mainInstanceIds: bigint[] = [];
      mainInstanceIdsByEntity.set(record.entityId, mainInstanceIds);
      const rider = riderAnchors.get(record.entityId);
      for (const node of visibleNodes) {
        const paletteKey = renderEntityPaletteKeyR10(node.colorRgba8, node.emissive);
        const material = resources.materialByPaletteKey.get(paletteKey);
        invariant(material !== undefined, "compiled entity palette is incomplete");
        const isRoot = node.parentNodeId === null || !selectedIds.has(node.parentNodeId);
        const stableId = renderEntityStableIdR10(record.entityId, node.nodeId);
        append({
          stableId,
          domain: domainForClass(record.class),
          geometry: resources.geometryId,
          material,
          parent: isRoot ? rider?.anchorId ?? null : renderEntityStableIdR10(record.entityId, node.parentNodeId!),
          transform: isRoot
            ? rider ? mountedRootTransform(record, rider.mount, node.transform) : worldRootTransform(record, node.transform)
            : node.transform,
          tintRgba8: WHITE,
          visibilityMask: node.colorRgba8[3] === 0 ? 0 : 0xffff_ffff,
          sortKey: node.partTag,
          // Extraction V2 reserves the low bits for authored animation kinds.
          // R10 carries the exact authoritative u16 action phase losslessly in
          // the high bits; current wgpu animation ignores those high bits.
          animationFlags: animationFlags(record, node),
        });
        mainInstanceIds.push(stableId);
      }
    }

    for (const mount of source.records) {
      if (mount.simulationTier === "dormant") continue;
      const parent = primaryRootByEntity.get(mount.entityId);
      if (parent === undefined) continue;
      const resources = resourcesByModel.get(mount.modelKey)!;
      const anchorMaterial = resources.materialByPaletteKey.values().next().value as bigint | undefined;
      invariant(anchorMaterial !== undefined, "mount model has no material");
      for (const seat of mount.mount.seats) {
        if (seat.occupant === null) continue;
        append({
          stableId: riderAnchors.get(seat.occupant)!.anchorId,
          domain: domainForClass(mount.class),
          geometry: resources.geometryId,
          material: anchorMaterial,
          parent,
          transform: Object.freeze({
            translation: Object.freeze([Math.fround(seat.offset.x), Math.fround(seat.offset.y), Math.fround(seat.offset.z)] as const),
            rotation: IDENTITY_ROTATION,
            scale: UNIT_SCALE,
          }),
          tintRgba8: WHITE,
          visibilityMask: 0,
          sortKey: seat.index,
          animationFlags: 0,
        });
      }
    }

    for (const record of source.records) {
      const entityInstanceIds = mainInstanceIdsByEntity.get(record.entityId) ?? [];
      const equipmentPresentation: RenderEntityPresentationR10["equipment"][number][] = [];
      if (record.simulationTier !== "dormant") {
        const hostParent = primaryRootByEntity.get(record.entityId)!;
        const hostResources = resourcesByModel.get(record.modelKey)!;
        const hostMaterial = hostResources.materialByPaletteKey.values().next().value as bigint | undefined;
        invariant(hostMaterial !== undefined, "entity model has no material");
        for (const [slotKey, equipment] of record.equipment) {
          const attachmentKey = `equipment:${slotKey}:${equipment.itemKey}`;
          const anchorId = renderEntityAttachmentStableIdR10(record.entityId, attachmentKey, 0);
          append({
            stableId: anchorId,
            domain: 3,
            geometry: hostResources.geometryId,
            material: hostMaterial,
            parent: hostParent,
            transform: attachmentAnchorTransform(slotKey),
            tintRgba8: WHITE,
            visibilityMask: 0,
            sortKey: 0,
            animationFlags: 0,
          });
          const modelKey = this.equipmentModels.get(equipment.itemKey)!;
          const model = findRenderEntityCompiledModelR10(this.catalog, modelKey)!;
          const resources = resourcesByModel.get(modelKey)!;
          const attachmentIds: bigint[] = [];
          for (const node of model.nodes) {
            const stableId = renderEntityAttachmentStableIdR10(record.entityId, attachmentKey, node.nodeId);
            const material = resources.materialByPaletteKey.get(renderEntityPaletteKeyR10(node.colorRgba8, node.emissive));
            invariant(material !== undefined, "compiled equipment palette is incomplete");
            append({
              stableId,
              domain: 3,
              geometry: resources.geometryId,
              material,
              parent: node.parentNodeId === null ? anchorId
                : renderEntityAttachmentStableIdR10(record.entityId, attachmentKey, node.parentNodeId),
              transform: node.transform,
              tintRgba8: WHITE,
              visibilityMask: node.colorRgba8[3] === 0 ? 0 : 0xffff_ffff,
              sortKey: node.partTag,
              animationFlags: animationFlags(record, node),
            });
            attachmentIds.push(stableId);
          }
          equipmentPresentation.push(Object.freeze({
            slotKey,
            itemKey: equipment.itemKey,
            count: equipment.count,
            durability: equipment.durability,
            custom: cloneCustom(equipment.custom),
            instanceIds: Object.freeze(attachmentIds),
          }));
        }
      } else {
        for (const [slotKey, equipment] of record.equipment) equipmentPresentation.push(Object.freeze({
          slotKey, itemKey: equipment.itemKey, count: equipment.count, durability: equipment.durability,
          custom: cloneCustom(equipment.custom),
          instanceIds: Object.freeze([]),
        }));
      }
      presentations.push(Object.freeze({
        entityId: record.entityId,
        entityRevision: record.entityRevision,
        class: record.class,
        externalEntityId: record.externalEntityId,
        specimenId: record.specimenId,
        kindKey: record.kindKey,
        variantKey: record.variantKey,
        name: record.name,
        modelKey: record.modelKey,
        modelRevision: record.modelRevision,
        modelHash: Uint8Array.from(record.modelHash),
        residency: record.residency,
        tier: record.simulationTier,
        protection: record.protection,
        tamed: record.tamed,
        movementMode: record.movementMode,
        action: cloneAction(record.action),
        research: cloneResearch(record.research),
        equipment: Object.freeze(equipmentPresentation),
        mount: cloneMount(record.mount),
        instanceIds: Object.freeze(entityInstanceIds),
        visible: record.simulationTier !== "dormant",
      }));
    }

    instances.sort((left, right) => left.stableId < right.stableId ? -1 : left.stableId > right.stableId ? 1 : 0);
    const nextResourceRevision = operations.length > 0 ? currentResourceRevision + BigInt(1) : currentResourceRevision;
    const resources = operations.length > 0 ? createRenderResourceBatchV2({
      epoch: context.epoch,
      revision: nextResourceRevision,
      operations,
    }) : null;
    const frame = createRenderFrameV2({
      epoch: context.epoch,
      frameSequence: context.frameSequence,
      simulationTick: context.simulationTick,
      animationTimeMicros: context.animationTimeMicros,
      resourceRevision: nextResourceRevision,
      camera: context.camera,
      environment: context.environment,
      instances,
      particles: [],
    });
    this.lastExtractionRevision = source.extractionRevision;
    this.resourceEpoch = context.epoch;
    this.resourceRevision = nextResourceRevision;
    if (epochChanged) {
      this.emittedModelIds.clear();
      this.emittedResourceIds.clear();
    }
    for (const modelId of requiredModelIds) this.emittedModelIds.add(modelId);
    for (const id of resourceIds) this.emittedResourceIds.add(id);
    const tiers = { hero: 0, nearby: 0, coarse: 0, dormant: 0 } satisfies Record<RenderEntityTierR10, number>;
    for (const record of source.records) tiers[record.simulationTier] += 1;
    return Object.freeze({
      extractionRevision: source.extractionRevision,
      authorityTick: source.authorityTick,
      contentManifestHash: Uint8Array.from(source.contentManifestHash),
      modelCatalogHash: this.catalog.catalogHashHex,
      modelCatalogRevision: this.catalog.revision,
      resources,
      frame,
      presentations: Object.freeze(presentations),
      stats: Object.freeze({
        sourceRecords: source.records.length,
        resourceOperations: operations.length,
        instances: instances.length,
        hiddenDormant: tiers.dormant,
        tiers: Object.freeze(tiers),
      }),
    });
  }
}
