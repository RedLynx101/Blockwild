/**
 * Renderer-independent R10 scene composition.
 *
 * Terrain and entity extraction intentionally keep independent source
 * revisions. This composer is the only owner of the downstream BWRD/BWRF
 * sequence: it deduplicates resources, retains shared ownership, applies
 * deterministic removals, and emits one bounded scene without reading a live
 * world or renderer object.
 */

import {
  createRenderFrameV2,
  createRenderResourceBatchV2,
  decodeRenderFrameV2,
  decodeRenderResourceBatchV2,
  encodeRenderFrameV2,
  encodeRenderResourceBatchV2,
  RENDER_MAX_INSTANCES_V2,
  RENDER_MAX_PARTICLES_V2,
  RENDER_MAX_RESOURCE_OPERATIONS_V2,
  type RenderFrameV2,
  type RenderCameraV2,
  type RenderInstanceV2,
  type RenderResourceBatchV2,
  type RenderResourceOperationV2,
  type RenderTransformV2,
} from "./rust-render-extraction-v2.ts";
import {
  decodeRenderEntityAnimationFlagsR10,
  type RenderEntityExtractionResultR10,
  type RenderEntityFrameContextR10,
  type RenderEntityPresentationR10,
  type RustEntityRenderExtractionR10,
} from "./rust-render-entity-extraction-r10.ts";
import {
  decodeRustAuthoritativeExtractionR10,
  type RustAudioExtractionR10,
  type RustDomainBundleR10,
  type RustRuntimeDiagnosticsR10,
} from "./rust-authoritative-extraction-r10.ts";
import type {
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
} from "./rust-integrated-runtime-contract.ts";
import {
  decodeRustLiveCameraViewR10,
  type RustLiveCameraViewR10,
} from "./rust-live-camera-view-r10.ts";

const U64_MAX = BigInt("0xffffffffffffffff");
const RESOURCE_FINGERPRINT_EPOCH = BigInt(0);
const RESOURCE_FINGERPRINT_REVISION = BigInt(1);
const TIER_PRIORITY = Object.freeze({ hero: 0, nearby: 1, coarse: 2, dormant: 3 } as const);

type SceneSourceR10 = "terrain" | "entity";
type UpsertOperationR10 = Extract<RenderResourceOperationV2,
  { kind: "upsert-material" | "upsert-geometry" | "upsert-texture" }>;

export type RenderSceneExtractionSinkR10 = Readonly<{
  resources(batch: RenderResourceBatchV2): boolean;
  frame(frame: RenderFrameV2): boolean;
  resize(width: number, height: number): void;
  requestRecovery(reason?: string): boolean;
  diagnostics(): Readonly<Record<string, unknown>>;
}>;

export type RenderEntityPresentationViewR10 = Readonly<{
  entityId: bigint;
  entityRevision: bigint;
  externalEntityId: string;
  specimenId: string;
  kindKey: string;
  variantKey: string | null;
  name: string | null;
  modelKey: string;
  modelRevision: number;
  modelHashHex: string;
  residency: RenderEntityPresentationR10["residency"];
  tier: RenderEntityPresentationR10["tier"];
  protection: bigint;
  tamed: boolean;
  movementMode: RenderEntityPresentationR10["movementMode"];
  action: RenderEntityPresentationR10["action"];
  research: readonly (readonly [string, number])[];
  equipment: readonly Readonly<{
    slotKey: string;
    itemKey: string;
    count: number;
    durability: number;
    custom: readonly (readonly [string, string])[];
    instanceIds: readonly bigint[];
  }>[];
  mount: RenderEntityPresentationR10["mount"];
  instanceIds: readonly bigint[];
  visible: boolean;
  actionPhase: number;
}>;

/** Shell-owned frame fields. Camera authority is deliberately absent. */
export type RenderRuntimeFrameContextR10 = Readonly<{
  epoch: bigint;
  frameSequence: bigint;
  simulationTick: bigint;
  animationTimeMicros: bigint;
  environment: RenderEntityFrameContextR10["environment"];
}>;

/** Exact browser view requested from the Rust extraction authority. */
export type RustRenderRequiredViewR10 = Readonly<{
  expectedExternalEntityId: string;
  viewportWidth: number;
  viewportHeight: number;
  viewRevision: number;
}>;

export type RustRenderSceneComposerDiagnosticsR10 = Readonly<{
  schema: 1;
  epoch: bigint;
  globalResourceRevision: bigint;
  globalFrameSequence: bigint;
  terrainResourceRevision: bigint;
  terrainFrameSequence: bigint;
  entityResourceRevision: bigint;
  entityExtractionRevision: bigint | null;
  entityAuthorityTick: bigint | null;
  residentResources: number;
  knownTerrainResources: number;
  knownEntityResources: number;
  emittedResourceBatches: number;
  deduplicatedResourceOperations: number;
  removedResources: number;
  submittedFrames: number;
  rejectedFrames: number;
  staleTerrainFrames: number;
  heldTerrainFrames: number;
  supersededTerrainFrames: number;
  deduplicatedCompositions: number;
  staleEntityExtractions: number;
  futureEntityFrames: number;
  expiredEntityFrames: number;
  omittedEntityGroups: number;
  omittedEntityInstances: number;
  recoveryRequests: number;
  staleDomainExtractions: number;
  domainExtractionRevision: bigint | null;
  domainAuthorityTick: bigint | null;
  domainBlockers: number;
  audioLastSequence: bigint | null;
  metadataRevision: bigint;
  contentManifestHashHex: string;
  modelCatalogHash: string;
  modelCatalogRevision: bigint;
  requiredView: RustRenderRequiredViewR10 | null;
  cameraAuthorityTick: bigint | null;
  cameraPoseHash: string | null;
  pendingTerrainFrameSequence: bigint | null;
  sink: Readonly<Record<string, unknown>>;
}>;

export type RustRenderSceneComposerOptionsR10 = Readonly<{
  sink: RenderSceneExtractionSinkR10;
  epoch: bigint;
  trustedContentManifestHash: Uint8Array;
  trustedModelCatalogHash: string;
  trustedModelCatalogRevision: bigint;
  entityExtractor?: Pick<RustEntityRenderExtractionR10, "extractBytes" | "resetResourceReplay" | "resetRevisionGuard">;
  maxInstances?: number;
  maxParticles?: number;
  maxResourceOperations?: number;
  maxKnownResourcesPerSource?: number;
  maxResidentResources?: number;
  maxEntityTickLag?: bigint;
}>;

type KnownResourceR10 = Readonly<{
  key: string;
  id: bigint;
  resourceKind: "material" | "geometry" | "texture";
  operation: UpsertOperationR10;
  fingerprint: string;
}>;

type ResidentResourceR10 = Readonly<{
  record: KnownResourceR10;
  owners: ReadonlySet<SceneSourceR10>;
}>;

type SourceStateR10 = Readonly<{
  revision: bigint;
  lastBatchHash: string | null;
  known: ReadonlyMap<string, KnownResourceR10>;
  active: ReadonlySet<string>;
}>;

type MutableCountersR10 = {
  emittedResourceBatches: number;
  deduplicatedResourceOperations: number;
  removedResources: number;
  submittedFrames: number;
  rejectedFrames: number;
  staleTerrainFrames: number;
  heldTerrainFrames: number;
  supersededTerrainFrames: number;
  deduplicatedCompositions: number;
  staleEntityExtractions: number;
  futureEntityFrames: number;
  expiredEntityFrames: number;
  omittedEntityGroups: number;
  omittedEntityInstances: number;
  recoveryRequests: number;
  staleDomainExtractions: number;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function boundedPositiveInteger(value: number, maximum: number, label: string) {
  invariant(Number.isInteger(value) && value > 0 && value <= maximum, `${label} is outside its bound`);
  return value;
}

function u64(value: bigint, label: string) {
  invariant(typeof value === "bigint" && value >= BigInt(0) && value <= U64_MAX, `${label} is not u64`);
  return value;
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function checkedHash16(value: Uint8Array, label: string) {
  invariant(value instanceof Uint8Array && value.byteLength === 16, `${label} must be 16 bytes`);
  return Uint8Array.from(value);
}

function cloneOperation(operation: RenderResourceOperationV2): RenderResourceOperationV2 {
  if (operation.kind === "upsert-material") return Object.freeze({
    kind: operation.kind,
    material: Object.freeze({
      ...operation.material,
      baseColorRgba8: Object.freeze([...operation.material.baseColorRgba8] as [number, number, number, number]),
      emissiveRgb8: Object.freeze([...operation.material.emissiveRgb8] as [number, number, number]),
    }),
  });
  if (operation.kind === "upsert-geometry") return Object.freeze({
    kind: operation.kind,
    geometry: Object.freeze({
      ...operation.geometry,
      bounds: Object.freeze({
        minimum: Object.freeze([...operation.geometry.bounds.minimum] as [number, number, number]),
        maximum: Object.freeze([...operation.geometry.bounds.maximum] as [number, number, number]),
      }),
      positions: operation.geometry.positions.slice(),
      normals: operation.geometry.normals.slice(),
      colors: operation.geometry.colors.slice(),
      lights: operation.geometry.lights.slice(),
      emissions: operation.geometry.emissions.slice(),
      occlusions: operation.geometry.occlusions.slice(),
      uvs: operation.geometry.uvs.slice(),
      indices: operation.geometry.indices.slice(),
    }),
  });
  if (operation.kind === "upsert-texture") return Object.freeze({
    kind: operation.kind,
    texture: Object.freeze({ ...operation.texture, rgba8: operation.texture.rgba8.slice() }),
  });
  return Object.freeze({ kind: operation.kind, id: operation.id });
}

function resourceDescriptor(operation: RenderResourceOperationV2) {
  const resourceKind = operation.kind.endsWith("material") ? "material"
    : operation.kind.endsWith("geometry") ? "geometry" : "texture";
  const id = operation.kind === "upsert-material" ? operation.material.id
    : operation.kind === "upsert-geometry" ? operation.geometry.id
      : operation.kind === "upsert-texture" ? operation.texture.id : operation.id;
  return Object.freeze({ resourceKind, id, key: `${resourceKind}:${id}` } as const);
}

function removalFor(record: KnownResourceR10): RenderResourceOperationV2 {
  if (record.resourceKind === "material") return Object.freeze({ kind: "remove-material", id: record.id });
  if (record.resourceKind === "geometry") return Object.freeze({ kind: "remove-geometry", id: record.id });
  return Object.freeze({ kind: "remove-texture", id: record.id });
}

function fingerprintOperation(operation: UpsertOperationR10) {
  return hex(createRenderResourceBatchV2({
    epoch: RESOURCE_FINGERPRINT_EPOCH,
    revision: RESOURCE_FINGERPRINT_REVISION,
    operations: [operation],
  }).batchHash);
}

function knownFromOperation(operation: UpsertOperationR10): KnownResourceR10 {
  const cloned = cloneOperation(operation) as UpsertOperationR10;
  const descriptor = resourceDescriptor(cloned);
  return Object.freeze({ ...descriptor, operation: cloned, fingerprint: fingerprintOperation(cloned) });
}

function operationOrder(operation: RenderResourceOperationV2) {
  const descriptor = resourceDescriptor(operation);
  const kind = descriptor.resourceKind === "material" ? 0 : descriptor.resourceKind === "geometry" ? 1 : 2;
  const remove = operation.kind.startsWith("remove-") ? 1 : 0;
  return { ...descriptor, kind, remove };
}

function canonicalOperations(operations: readonly RenderResourceOperationV2[]) {
  return [...operations].sort((left, right) => {
    const a = operationOrder(left), b = operationOrder(right);
    return a.kind - b.kind || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.remove - b.remove;
  });
}

function canonicalResourceBatch(batch: RenderResourceBatchV2) {
  return decodeRenderResourceBatchV2(encodeRenderResourceBatchV2(batch));
}

function canonicalFrame(frame: RenderFrameV2) {
  return decodeRenderFrameV2(encodeRenderFrameV2(frame));
}

function exactRequiredView(
  expectedExternalEntityId: string,
  view: RustIntegratedRuntimeExtractionViewV1,
): RustRenderRequiredViewR10 {
  invariant(typeof expectedExternalEntityId === "string" && expectedExternalEntityId.length > 0,
    "required render camera identity is empty");
  invariant(Number.isInteger(view.viewportWidth) && view.viewportWidth >= 1 && view.viewportWidth <= 16_384
    && Number.isInteger(view.viewportHeight) && view.viewportHeight >= 1 && view.viewportHeight <= 16_384,
  "required render viewport is outside the camera contract");
  invariant(Number.isSafeInteger(view.viewRevision) && view.viewRevision > 0,
    "required render view revision must be a positive safe integer");
  return Object.freeze({ expectedExternalEntityId, ...view });
}

function sameRequiredView(left: RustRenderRequiredViewR10, right: RustRenderRequiredViewR10) {
  return left.expectedExternalEntityId === right.expectedExternalEntityId
    && left.viewportWidth === right.viewportWidth
    && left.viewportHeight === right.viewportHeight
    && left.viewRevision === right.viewRevision;
}

function renderCameraFromAuthority(camera: RustLiveCameraViewR10): RenderCameraV2 {
  return Object.freeze({
    position: Object.freeze([camera.position.x, camera.position.y, camera.position.z] as const),
    orientation: Object.freeze([
      camera.orientation.x,
      camera.orientation.y,
      camera.orientation.z,
      camera.orientation.w,
    ] as const),
    verticalFovRadians: camera.projection.verticalFovRadians,
    near: camera.projection.near,
    far: camera.projection.far,
    viewport: Object.freeze([camera.viewport.width, camera.viewport.height] as const),
  });
}

function cloneSourceState(state: SourceStateR10): SourceStateR10 {
  return {
    revision: state.revision,
    lastBatchHash: state.lastBatchHash,
    known: new Map(state.known),
    active: new Set(state.active),
  };
}

function cloneResident(source: ReadonlyMap<string, ResidentResourceR10>) {
  return new Map([...source].map(([key, value]) => [key, {
    record: value.record,
    owners: new Set(value.owners),
  }] as const));
}

function safePresentation(value: RenderEntityPresentationR10): RenderEntityPresentationViewR10 {
  return Object.freeze({
    entityId: value.entityId,
    entityRevision: value.entityRevision,
    externalEntityId: value.externalEntityId,
    specimenId: value.specimenId,
    kindKey: value.kindKey,
    variantKey: value.variantKey,
    name: value.name,
    modelKey: value.modelKey,
    modelRevision: value.modelRevision,
    modelHashHex: hex(value.modelHash),
    residency: value.residency,
    tier: value.tier,
    protection: value.protection,
    tamed: value.tamed,
    movementMode: value.movementMode,
    action: Object.freeze({ ...value.action }),
    research: Object.freeze(value.research.map(([key, score]) => Object.freeze([key, score] as const))),
    equipment: Object.freeze(value.equipment.map((equipment) => Object.freeze({
      slotKey: equipment.slotKey,
      itemKey: equipment.itemKey,
      count: equipment.count,
      durability: equipment.durability,
      custom: Object.freeze(equipment.custom.map(([key, bytes]) => Object.freeze([key, hex(bytes)] as const))),
      instanceIds: Object.freeze([...equipment.instanceIds]),
    }))),
    mount: Object.freeze({
      ...value.mount,
      seats: Object.freeze(value.mount.seats.map((seat) => Object.freeze({
        ...seat,
        offset: Object.freeze({ ...seat.offset }),
      }))),
    }),
    instanceIds: Object.freeze([...value.instanceIds]),
    visible: value.visible,
    actionPhase: value.action.phase,
  });
}

function referencedResourceKeys(frame: RenderFrameV2) {
  const keys = new Set<string>();
  for (const instance of frame.instances) {
    keys.add(`geometry:${instance.geometry}`);
    keys.add(`material:${instance.material}`);
  }
  for (const particle of frame.particles) keys.add(`material:${particle.material}`);
  return keys;
}

function multiplyQuaternion(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
) {
  const [lx, ly, lz, lw] = left, [rx, ry, rz, rw] = right;
  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ] as const;
}

function rotateVector(vector: readonly [number, number, number], rotation: readonly [number, number, number, number]) {
  const [x, y, z] = vector, [qx, qy, qz, qw] = rotation;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)] as const;
}

function composeTransform(parent: RenderTransformV2, child: RenderTransformV2): RenderTransformV2 {
  const scaled = child.translation.map((value, axis) => value * parent.scale[axis]) as [number, number, number];
  const rotated = rotateVector(scaled, parent.rotation);
  return Object.freeze({
    translation: Object.freeze(rotated.map((value, axis) => Math.fround(value + parent.translation[axis])) as [number, number, number]),
    rotation: Object.freeze(multiplyQuaternion(parent.rotation, child.rotation).map(Math.fround) as unknown as [number, number, number, number]),
    scale: Object.freeze(child.scale.map((value, axis) => Math.fround(value * parent.scale[axis])) as [number, number, number]),
  });
}

function worldTransforms(instances: readonly RenderInstanceV2[]) {
  const byId = new Map(instances.map((instance) => [instance.stableId, instance] as const));
  const result = new Map<bigint, RenderTransformV2>();
  const resolving = new Set<bigint>();
  const resolve = (id: bigint): RenderTransformV2 => {
    const cached = result.get(id);
    if (cached) return cached;
    invariant(!resolving.has(id), "render hierarchy contains a cycle during composition");
    const instance = byId.get(id);
    invariant(instance !== undefined, "render hierarchy references a missing instance during composition");
    resolving.add(id);
    const world = instance.parent === null ? instance.transform : composeTransform(resolve(instance.parent), instance.transform);
    resolving.delete(id);
    result.set(id, world);
    return world;
  };
  for (const id of byId.keys()) resolve(id);
  return result;
}

function sortedInstances(
  instances: readonly RenderInstanceV2[],
  resident: ReadonlyMap<string, ResidentResourceR10>,
  camera: RenderFrameV2["camera"],
) {
  const worlds = worldTransforms(instances);
  const opaque: RenderInstanceV2[] = [], transparent: RenderInstanceV2[] = [];
  for (const instance of instances) {
    const resource = resident.get(`material:${instance.material}`)?.record.operation;
    invariant(resource?.kind === "upsert-material", `instance ${instance.stableId} references a missing material`);
    if ([2, 3, 4].includes(resource.material.blend)) transparent.push(instance);
    else opaque.push(instance);
  }
  opaque.sort((left, right) => left.stableId < right.stableId ? -1 : left.stableId > right.stableId ? 1 : 0);
  const distanceSquared = (instance: RenderInstanceV2) => {
    const position = worlds.get(instance.stableId)!.translation;
    const dx = position[0] - camera.position[0], dy = position[1] - camera.position[1], dz = position[2] - camera.position[2];
    return dx * dx + dy * dy + dz * dz;
  };
  transparent.sort((left, right) => distanceSquared(right) - distanceSquared(left)
    || left.sortKey - right.sortKey
    || (left.stableId < right.stableId ? -1 : left.stableId > right.stableId ? 1 : 0));
  return [...opaque, ...transparent];
}

function selectedEntityInstances(
  frame: RenderFrameV2,
  presentations: readonly RenderEntityPresentationViewR10[],
  budget: number,
) {
  if (frame.instances.length <= budget) return { instances: [...frame.instances], omittedGroups: 0, omittedInstances: 0 };
  const byId = new Map(frame.instances.map((instance) => [instance.stableId, instance] as const));
  const adjacency = new Map<bigint, Set<bigint>>();
  for (const instance of frame.instances) {
    if (!adjacency.has(instance.stableId)) adjacency.set(instance.stableId, new Set());
    if (instance.parent !== null) {
      invariant(byId.has(instance.parent), "entity hierarchy references a missing parent");
      adjacency.get(instance.stableId)!.add(instance.parent);
      (adjacency.get(instance.parent) ?? (adjacency.set(instance.parent, new Set()), adjacency.get(instance.parent)!)).add(instance.stableId);
    }
  }
  const tierByInstance = new Map<bigint, number>();
  for (const presentation of presentations) {
    const priority = TIER_PRIORITY[presentation.tier];
    for (const id of [...presentation.instanceIds, ...presentation.equipment.flatMap((equipment) => equipment.instanceIds)]) {
      tierByInstance.set(id, Math.min(tierByInstance.get(id) ?? priority, priority));
    }
  }
  const visited = new Set<bigint>();
  const groups: Array<{ ids: bigint[]; priority: number; first: bigint }> = [];
  for (const start of [...byId.keys()].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
    if (visited.has(start)) continue;
    const pending = [start], ids: bigint[] = [];
    let priority = 3;
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id); ids.push(id); priority = Math.min(priority, tierByInstance.get(id) ?? 2);
      for (const neighbor of adjacency.get(id) ?? []) if (!visited.has(neighbor)) pending.push(neighbor);
    }
    ids.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    groups.push({ ids, priority, first: ids[0]! });
  }
  groups.sort((left, right) => left.priority - right.priority || (left.first < right.first ? -1 : left.first > right.first ? 1 : 0));
  const selected = new Set<bigint>();
  let omittedGroups = 0, omittedInstances = 0;
  for (const group of groups) {
    if (selected.size + group.ids.length > budget) {
      omittedGroups += 1; omittedInstances += group.ids.length; continue;
    }
    for (const id of group.ids) selected.add(id);
  }
  return {
    instances: frame.instances.filter((instance) => selected.has(instance.stableId)),
    omittedGroups,
    omittedInstances,
  };
}

export class RustRenderSceneComposerR10 implements RenderSceneExtractionSinkR10 {
  private readonly sink: RenderSceneExtractionSinkR10;
  private readonly trustedContentManifestHash: Uint8Array;
  private readonly trustedModelCatalogHash: string;
  private readonly trustedModelCatalogRevision: bigint;
  private readonly entityExtractor: RustRenderSceneComposerOptionsR10["entityExtractor"];
  private readonly maxInstances: number;
  private readonly maxParticles: number;
  private readonly maxResourceOperations: number;
  private readonly maxKnownResourcesPerSource: number;
  private readonly maxResidentResources: number;
  private readonly maxEntityTickLag: bigint;
  private terrain: SourceStateR10 = { revision: BigInt(0), lastBatchHash: null, known: new Map(), active: new Set() };
  private entity: SourceStateR10 = { revision: BigInt(0), lastBatchHash: null, known: new Map(), active: new Set() };
  private resident = new Map<string, ResidentResourceR10>();
  private globalResourceRevision = BigInt(0);
  private globalFrameSequence = BigInt(0);
  private terrainFrameSequence = BigInt(0);
  private acceptedTerrainFrameSequence = BigInt(0);
  private acceptedTerrainSimulationTick = BigInt(0);
  private latestTerrainFrame: RenderFrameV2 | null = null;
  private latestTerrainSignature: string | null = null;
  private lastCompositionKey: string | null = null;
  private requiredView: RustRenderRequiredViewR10 | null = null;
  private cameraView: RustLiveCameraViewR10 | null = null;
  private entityExtractionRevision: bigint | null = null;
  private entityExtractionSignature: string | null = null;
  private entityResult: RenderEntityExtractionResultR10 | null = null;
  private presentations: readonly RenderEntityPresentationViewR10[] = Object.freeze([]);
  private domainBundle: RustDomainBundleR10 | null = null;
  private audioExtraction: RustAudioExtractionR10 | null = null;
  private runtimeDiagnostics: RustRuntimeDiagnosticsR10 | null = null;
  private domainExtractionSignature: string | null = null;
  private metadataRevision = BigInt(0);
  private counters: MutableCountersR10 = {
    emittedResourceBatches: 0, deduplicatedResourceOperations: 0, removedResources: 0,
    submittedFrames: 0, rejectedFrames: 0, staleTerrainFrames: 0, staleEntityExtractions: 0,
    heldTerrainFrames: 0, supersededTerrainFrames: 0, deduplicatedCompositions: 0,
    futureEntityFrames: 0, expiredEntityFrames: 0, omittedEntityGroups: 0,
    omittedEntityInstances: 0, recoveryRequests: 0,
    staleDomainExtractions: 0,
  };

  readonly epoch: bigint;

  constructor(options: RustRenderSceneComposerOptionsR10) {
    this.sink = options.sink;
    this.epoch = u64(options.epoch, "scene epoch");
    invariant(this.epoch > BigInt(0), "scene epoch must be positive");
    this.trustedContentManifestHash = checkedHash16(options.trustedContentManifestHash, "trusted content manifest hash");
    invariant(/^[0-9a-f]{32}$/u.test(options.trustedModelCatalogHash), "trusted model catalog hash is invalid");
    this.trustedModelCatalogHash = options.trustedModelCatalogHash;
    this.trustedModelCatalogRevision = u64(options.trustedModelCatalogRevision, "trusted model catalog revision");
    invariant(this.trustedModelCatalogRevision > BigInt(0), "trusted model catalog revision must be positive");
    this.entityExtractor = options.entityExtractor;
    this.maxInstances = boundedPositiveInteger(options.maxInstances ?? RENDER_MAX_INSTANCES_V2, RENDER_MAX_INSTANCES_V2, "scene instance cap");
    this.maxParticles = boundedPositiveInteger(options.maxParticles ?? RENDER_MAX_PARTICLES_V2, RENDER_MAX_PARTICLES_V2, "scene particle cap");
    this.maxResourceOperations = boundedPositiveInteger(options.maxResourceOperations ?? RENDER_MAX_RESOURCE_OPERATIONS_V2, RENDER_MAX_RESOURCE_OPERATIONS_V2, "scene resource operation cap");
    this.maxKnownResourcesPerSource = boundedPositiveInteger(options.maxKnownResourcesPerSource ?? RENDER_MAX_RESOURCE_OPERATIONS_V2, RENDER_MAX_RESOURCE_OPERATIONS_V2, "known resource cap");
    this.maxResidentResources = boundedPositiveInteger(options.maxResidentResources ?? RENDER_MAX_RESOURCE_OPERATIONS_V2, RENDER_MAX_RESOURCE_OPERATIONS_V2, "resident resource cap");
    this.maxEntityTickLag = u64(options.maxEntityTickLag ?? BigInt(8), "entity tick lag");
  }

  /** Structural sink consumed by the existing terrain extraction publisher. */
  resources(batch: RenderResourceBatchV2) {
    return this.applySourceBatch("terrain", batch, null);
  }

  /**
   * Arm the exact view that the runtime must request from Rust. Changing the
   * view invalidates the old camera immediately, before any subsequent terrain
   * frame can reach the renderer.
   */
  armRequiredView(expectedExternalEntityId: string, view: RustIntegratedRuntimeExtractionViewV1) {
    const next = exactRequiredView(expectedExternalEntityId, view);
    const current = this.requiredView;
    if (current) {
      if (next.viewRevision < current.viewRevision) throw new Error("required render view revision regressed");
      if (next.viewRevision === current.viewRevision) {
        if (sameRequiredView(next, current)) return false;
        throw new Error("required render view revision conflicts with its existing viewport or identity");
      }
    }
    this.requiredView = next;
    this.sink.resize(next.viewportWidth, next.viewportHeight);
    return true;
  }

  requiredCameraView() { return this.requiredView; }

  /** Terrain frames cache one latest candidate and present only on an exact camera join. */
  frame(frame: RenderFrameV2) {
    const terrainFrame = canonicalFrame(frame);
    if (terrainFrame.epoch !== this.epoch) throw new Error("terrain frame epoch does not match the composed scene");
    if (terrainFrame.resourceRevision !== this.terrain.revision) throw new Error("terrain frame resource revision does not match its source stream");
    const signature = hex(terrainFrame.frameHash);
    if (terrainFrame.frameSequence < this.acceptedTerrainFrameSequence
      || terrainFrame.simulationTick < this.acceptedTerrainSimulationTick) {
      this.counters.staleTerrainFrames += 1; this.counters.rejectedFrames += 1; return false;
    }
    if (terrainFrame.frameSequence === this.acceptedTerrainFrameSequence) {
      if (signature !== this.latestTerrainSignature) throw new Error("terrain frame sequence conflicts with its cached source frame");
      return this.composeLatestTerrain();
    }
    // There is exactly one pending slot: replace/count only when the previous
    // cached source sequence has not already reached the sink.
    if (this.latestTerrainFrame && this.terrainFrameSequence < this.latestTerrainFrame.frameSequence) {
      this.counters.supersededTerrainFrames += 1;
    }
    this.latestTerrainFrame = terrainFrame;
    this.latestTerrainSignature = signature;
    this.acceptedTerrainFrameSequence = terrainFrame.frameSequence;
    this.acceptedTerrainSimulationTick = terrainFrame.simulationTick;
    return this.composeLatestTerrain();
  }

  private composeLatestTerrain(candidateCamera: RustLiveCameraViewR10 | null = this.cameraView) {
    const terrainFrame = this.latestTerrainFrame;
    if (!terrainFrame) return true;
    const required = this.requiredView;
    const cameraView = candidateCamera;
    if (!required || !cameraView
      || cameraView.authorityTick !== terrainFrame.simulationTick
      || cameraView.externalEntityId !== required.expectedExternalEntityId
      || cameraView.viewRevision !== BigInt(required.viewRevision)
      || cameraView.viewport.width !== required.viewportWidth
      || cameraView.viewport.height !== required.viewportHeight
      || terrainFrame.resourceRevision !== this.terrain.revision) {
      this.counters.heldTerrainFrames += 1;
      return true;
    }
    const camera = renderCameraFromAuthority(cameraView);
    const compositionKey = `${terrainFrame.frameSequence}:${cameraView.poseHash}:${cameraView.viewRevision}`;
    if (compositionKey === this.lastCompositionKey) {
      this.counters.deduplicatedCompositions += 1;
      return true;
    }

    let entityFrame: RenderFrameV2 | null = null;
    if (this.entityResult) {
      if (this.entityResult.authorityTick > terrainFrame.simulationTick) {
        this.counters.futureEntityFrames += 1; this.counters.rejectedFrames += 1; return false;
      }
      if (terrainFrame.simulationTick - this.entityResult.authorityTick <= this.maxEntityTickLag) entityFrame = this.entityResult.frame;
      else this.counters.expiredEntityFrames += 1;
    }

    const terrainInstances = [...terrainFrame.instances];
    invariant(terrainInstances.length <= this.maxInstances, "terrain instances alone exceed the composed scene cap");
    const selected = entityFrame ? selectedEntityInstances(entityFrame, this.presentations, this.maxInstances - terrainInstances.length)
      : { instances: [] as RenderInstanceV2[], omittedGroups: 0, omittedInstances: 0 };
    this.counters.omittedEntityGroups += selected.omittedGroups;
    this.counters.omittedEntityInstances += selected.omittedInstances;
    const instanceIds = new Set<bigint>();
    for (const instance of [...terrainInstances, ...selected.instances]) {
      invariant(!instanceIds.has(instance.stableId), `composed instance id collision at ${instance.stableId}`);
      instanceIds.add(instance.stableId);
      invariant(this.resident.has(`geometry:${instance.geometry}`), `instance ${instance.stableId} references non-resident geometry`);
      invariant(this.resident.has(`material:${instance.material}`), `instance ${instance.stableId} references non-resident material`);
    }
    const instances = sortedInstances([...terrainInstances, ...selected.instances], this.resident, camera);

    const particleIds = new Set<bigint>();
    const allParticles = [...terrainFrame.particles, ...(entityFrame?.particles ?? [])]
      .sort((left, right) => left.stableId < right.stableId ? -1 : left.stableId > right.stableId ? 1 : 0);
    invariant(allParticles.length <= this.maxParticles, "composed particles exceed the scene cap");
    for (const particle of allParticles) {
      invariant(!particleIds.has(particle.stableId), `composed particle id collision at ${particle.stableId}`);
      particleIds.add(particle.stableId);
      invariant(this.resident.has(`material:${particle.material}`), `particle ${particle.stableId} references non-resident material`);
    }

    const nextSequence = this.globalFrameSequence + BigInt(1);
    const composed = canonicalFrame(createRenderFrameV2({
      epoch: this.epoch,
      frameSequence: nextSequence,
      simulationTick: terrainFrame.simulationTick,
      animationTimeMicros: terrainFrame.animationTimeMicros,
      resourceRevision: this.globalResourceRevision,
      camera,
      environment: terrainFrame.environment,
      instances,
      particles: allParticles,
    }));
    if (!this.sink.frame(composed)) { this.counters.rejectedFrames += 1; return false; }
    this.globalFrameSequence = nextSequence;
    this.terrainFrameSequence = terrainFrame.frameSequence;
    this.lastCompositionKey = compositionKey;
    this.counters.submittedFrames += 1;
    return true;
  }

  submitEntityBytes(bytes: Uint8Array | ArrayBuffer, context: RenderEntityFrameContextR10) {
    invariant(this.entityExtractor !== undefined, "no trusted BWR6 entity extractor is installed");
    return this.submitEntities(this.entityExtractor.extractBytes(bytes, context));
  }

  /** Validate every R10 section before mutating the composed renderer state. */
  submitRuntimeExtraction(
    extraction: RustIntegratedRuntimeExtractionV1,
    context: RenderRuntimeFrameContextR10,
  ) {
    const required = this.requiredView;
    invariant(required !== null, "authoritative render camera view is not armed");
    const cameraView = decodeRustLiveCameraViewR10(extraction, required.expectedExternalEntityId, required);
    invariant(cameraView.authorityTick === context.simulationTick,
      "camera authority tick does not match render extraction context");
    const entityContext: RenderEntityFrameContextR10 = Object.freeze({
      epoch: context.epoch,
      frameSequence: context.frameSequence,
      simulationTick: context.simulationTick,
      animationTimeMicros: context.animationTimeMicros,
      camera: renderCameraFromAuthority(cameraView),
      environment: context.environment,
    });
    const decoded = decodeRustAuthoritativeExtractionR10(extraction);
    const staged = decoded.domains
      ? this.validateDomainExtraction(decoded.domains, decoded.audio, decoded.diagnostics, context)
      : null;
    // Resource uploads and the entity catalogue are intentionally recoverable
    // staging: a downstream sink may accept resources and then reject the
    // composed frame, so they cannot be rolled back truthfully. Camera/domain
    // metadata and presentation cursors commit only after the frame succeeds;
    // an exact retry deduplicates the staged entity result and resubmits it.
    if (extraction.render.byteLength > 0 && !this.submitEntityBytes(extraction.render, entityContext)) return false;
    if (!this.composeLatestTerrain(cameraView)) return false;
    if (staged) this.commitDomainExtraction(staged.bundle, staged.audio, staged.diagnostics, staged.signature);
    this.cameraView = cameraView;
    return true;
  }

  submitEntities(result: RenderEntityExtractionResultR10) {
    invariant(equalBytes(result.contentManifestHash, this.trustedContentManifestHash), "entity content manifest attestation mismatch");
    invariant(result.modelCatalogHash === this.trustedModelCatalogHash, "entity model catalog attestation mismatch");
    invariant(result.modelCatalogRevision === this.trustedModelCatalogRevision, "entity model catalog revision mismatch");
    invariant(result.frame.epoch === this.epoch, "entity frame epoch does not match the composed scene");
    invariant(result.frame.simulationTick === result.authorityTick, "entity frame tick does not match entity authority");
    const signature = `${hex(result.frame.frameHash)}:${result.resources ? hex(result.resources.batchHash) : "-"}`;
    if (this.entityExtractionRevision !== null && result.extractionRevision <= this.entityExtractionRevision) {
      if (result.extractionRevision === this.entityExtractionRevision && signature === this.entityExtractionSignature) return true;
      this.counters.staleEntityExtractions += 1;
      throw new Error("stale entity extraction revision");
    }
    const frame = canonicalFrame(result.frame);
    invariant(frame.resourceRevision === (result.resources?.revision ?? this.entity.revision), "entity frame resource revision does not match its source stream");
    const presentations = Object.freeze(result.presentations.map(safePresentation));
    this.validateEntityPhases(frame, presentations);
    const desired = referencedResourceKeys(frame);
    const accepted = result.resources
      ? this.applySourceBatch("entity", result.resources, desired)
      : this.reconcileEntityWithoutBatch(desired);
    if (!accepted) return false;
    this.entityResult = Object.freeze({
      ...result,
      contentManifestHash: Uint8Array.from(result.contentManifestHash),
      frame,
      presentations: Object.freeze([...result.presentations]),
    });
    this.presentations = presentations;
    this.entityExtractionRevision = result.extractionRevision;
    this.entityExtractionSignature = signature;
    this.metadataRevision += BigInt(1);
    return true;
  }

  resize(width: number, height: number) {
    invariant(Number.isInteger(width) && width >= 1 && width <= 16_384
      && Number.isInteger(height) && height >= 1 && height <= 16_384,
    "render viewport is outside the camera contract");
    const current = this.requiredView;
    if (!current) {
      this.sink.resize(width, height);
      return;
    }
    if (current.viewportWidth === width && current.viewportHeight === height) return;
    invariant(current.viewRevision < Number.MAX_SAFE_INTEGER, "required render view revision exhausted");
    this.armRequiredView(current.expectedExternalEntityId, {
      viewportWidth: width,
      viewportHeight: height,
      viewRevision: current.viewRevision + 1,
    });
  }

  requestRecovery(reason = "composed renderer device/store recovery") {
    const accepted = this.sink.requestRecovery(reason);
    if (accepted) this.counters.recoveryRequests += 1;
    return accepted;
  }

  /**
   * A new world must construct a new composer. This reset is intentionally for
   * a replacement renderer store in the same world epoch only.
   */
  resetRendererStore(reason = "composed renderer store reset") {
    return this.requestRecovery(reason);
  }

  entityMetadata() {
    return Object.freeze({
      schema: 1 as const,
      revision: this.metadataRevision,
      authorityTick: this.entityResult?.authorityTick ?? null,
      extractionRevision: this.entityExtractionRevision,
      contentManifestHashHex: hex(this.trustedContentManifestHash),
      modelCatalogHash: this.trustedModelCatalogHash,
      modelCatalogRevision: this.trustedModelCatalogRevision,
      entries: Object.freeze([...this.presentations]),
    });
  }

  authoritativeMetadata() {
    const bundle = this.domainBundle;
    return Object.freeze({
      schema: 1 as const,
      revision: this.metadataRevision,
      extractionRevision: bundle?.extractionRevision ?? null,
      authorityTick: bundle?.authorityTick ?? null,
      stateHashHex: bundle ? hex(bundle.stateHash) : null,
      promotion: bundle?.promotion ?? Object.freeze({
        ready: false,
        blockers: Object.freeze(["domain-extraction-not-submitted"]),
      }),
      views: Object.freeze((bundle?.views ?? []).map((view) => Object.freeze({
        domain: view.domain,
        status: view.status,
        revision: view.revision,
        total: view.total,
        selected: view.selected,
        omitted: view.omitted,
        nextCursor: view.nextCursor,
        blockers: Object.freeze([...view.blockers]),
        rows: Object.freeze(view.rows.map((row) => Object.freeze({
          kind: row.kind,
          key: row.key,
          revision: row.revision,
          fields: Object.freeze(row.fields.map(([key, value]) => Object.freeze([
            key,
            value instanceof Uint8Array ? hex(value) : value,
          ] as const))),
        }))),
      }))),
      audio: Object.freeze([...(this.audioExtraction?.cues ?? [])]),
      diagnostics: this.runtimeDiagnostics ? Object.freeze({
        authorityTick: this.runtimeDiagnostics.authorityTick,
        stateHashHex: hex(this.runtimeDiagnostics.stateHash),
        counters: this.runtimeDiagnostics.counters,
        flags: this.runtimeDiagnostics.flags,
        dispatcherHashHex: hex(this.runtimeDiagnostics.dispatcherHash),
        persistenceHashHex: hex(this.runtimeDiagnostics.persistenceHash),
      }) : null,
    });
  }

  diagnostics(): RustRenderSceneComposerDiagnosticsR10 {
    return Object.freeze({
      schema: 1,
      epoch: this.epoch,
      globalResourceRevision: this.globalResourceRevision,
      globalFrameSequence: this.globalFrameSequence,
      terrainResourceRevision: this.terrain.revision,
      terrainFrameSequence: this.terrainFrameSequence,
      entityResourceRevision: this.entity.revision,
      entityExtractionRevision: this.entityExtractionRevision,
      entityAuthorityTick: this.entityResult?.authorityTick ?? null,
      residentResources: this.resident.size,
      knownTerrainResources: this.terrain.known.size,
      knownEntityResources: this.entity.known.size,
      ...this.counters,
      domainExtractionRevision: this.domainBundle?.extractionRevision ?? null,
      domainAuthorityTick: this.domainBundle?.authorityTick ?? null,
      domainBlockers: this.domainBundle?.promotion.blockers.length ?? 0,
      audioLastSequence: this.audioExtraction?.cues.at(-1)?.sequence ?? null,
      metadataRevision: this.metadataRevision,
      contentManifestHashHex: hex(this.trustedContentManifestHash),
      modelCatalogHash: this.trustedModelCatalogHash,
      modelCatalogRevision: this.trustedModelCatalogRevision,
      requiredView: this.requiredView,
      cameraAuthorityTick: this.cameraView?.authorityTick ?? null,
      cameraPoseHash: this.cameraView?.poseHash ?? null,
      pendingTerrainFrameSequence: this.latestTerrainFrame !== null
        && this.terrainFrameSequence < this.latestTerrainFrame.frameSequence
        ? this.latestTerrainFrame.frameSequence
        : null,
      sink: this.sink.diagnostics(),
    });
  }

  private validateDomainExtraction(
    bundle: RustDomainBundleR10,
    audio: RustAudioExtractionR10 | null,
    diagnostics: RustRuntimeDiagnosticsR10 | null,
    context: Pick<RenderRuntimeFrameContextR10, "simulationTick">,
  ) {
    invariant(equalBytes(bundle.contentManifestHash, this.trustedContentManifestHash), "domain content manifest attestation mismatch");
    invariant(bundle.authorityTick === context.simulationTick, "domain authority tick does not match render extraction context");
    if (audio) invariant(audio.authorityTick === bundle.authorityTick, "audio authority tick does not match domain extraction");
    if (diagnostics) {
      invariant(diagnostics.authorityTick === bundle.authorityTick, "diagnostic authority tick does not match domain extraction");
      invariant(equalBytes(diagnostics.stateHash, bundle.stateHash), "diagnostic state hash does not match domain extraction");
    }
    const signature = [
      hex(bundle.stateHash),
      ...bundle.views.map((view) => hex(view.payloadHash)),
      audio?.cues.at(-1)?.sequence.toString() ?? "-",
      diagnostics ? hex(diagnostics.dispatcherHash) : "-",
      diagnostics ? hex(diagnostics.persistenceHash) : "-",
    ].join(":");
    const current = this.domainBundle?.extractionRevision ?? null;
    if (current !== null && bundle.extractionRevision <= current) {
      if (bundle.extractionRevision === current && signature === this.domainExtractionSignature) {
        return { bundle, audio, diagnostics, signature } as const;
      }
      this.counters.staleDomainExtractions += 1;
      throw new Error("stale authoritative domain extraction revision");
    }
    return { bundle, audio, diagnostics, signature } as const;
  }

  private commitDomainExtraction(
    bundle: RustDomainBundleR10,
    audio: RustAudioExtractionR10 | null,
    diagnostics: RustRuntimeDiagnosticsR10 | null,
    signature: string,
  ) {
    if (this.domainBundle?.extractionRevision === bundle.extractionRevision
      && this.domainExtractionSignature === signature) return;
    this.domainBundle = bundle;
    this.audioExtraction = audio;
    this.runtimeDiagnostics = diagnostics;
    this.domainExtractionSignature = signature;
    this.metadataRevision += BigInt(1);
  }

  private validateEntityPhases(frame: RenderFrameV2, presentations: readonly RenderEntityPresentationViewR10[]) {
    const instances = new Map(frame.instances.map((instance) => [instance.stableId, instance] as const));
    for (const presentation of presentations) {
      const ids = [...presentation.instanceIds, ...presentation.equipment.flatMap((equipment) => equipment.instanceIds)];
      for (const id of ids) {
        const instance = instances.get(id);
        invariant(instance !== undefined, `entity presentation references missing instance ${id}`);
        const decoded = decodeRenderEntityAnimationFlagsR10(instance.animationFlags);
        invariant(decoded.actionPhase === presentation.action.phase, `entity ${presentation.entityId} action phase was not preserved`);
      }
    }
  }

  private reconcileEntityWithoutBatch(desired: ReadonlySet<string>) {
    invariant(this.entityResult !== null || this.entity.known.size > 0, "entity frame arrived before its resource catalog");
    return this.applyResourceMutation("entity", cloneSourceState(this.entity), desired, this.entity.revision, this.entity.lastBatchHash);
  }

  private applySourceBatch(source: SceneSourceR10, input: RenderResourceBatchV2, desired: ReadonlySet<string> | null) {
    const batch = canonicalResourceBatch(input);
    invariant(batch.epoch === this.epoch, `${source} resource epoch does not match the composed scene`);
    const current = source === "terrain" ? this.terrain : this.entity;
    const batchHash = hex(batch.batchHash);
    if (batch.revision <= current.revision) {
      if (batch.revision === current.revision && batchHash === current.lastBatchHash) return true;
      throw new Error(`stale ${source} resource revision`);
    }
    invariant(batch.revision === current.revision + BigInt(1), `${source} resource revision gap`);
    const next = cloneSourceState(current);
    const known = next.known as Map<string, KnownResourceR10>;
    for (const operation of batch.operations) {
      const descriptor = resourceDescriptor(operation);
      if (operation.kind.startsWith("upsert-")) known.set(descriptor.key, knownFromOperation(operation as UpsertOperationR10));
      else {
        invariant(known.has(descriptor.key), `${source} removed unknown resource ${descriptor.key}`);
        known.delete(descriptor.key);
      }
    }
    invariant(known.size <= this.maxKnownResourcesPerSource, `${source} known resource cap exceeded`);
    return this.applyResourceMutation(source, next, desired ?? new Set(known.keys()), batch.revision, batchHash);
  }

  private applyResourceMutation(
    source: SceneSourceR10,
    stagedSource: SourceStateR10,
    desired: ReadonlySet<string>,
    sourceRevision: bigint,
    sourceBatchHash: string | null,
  ) {
    const resident = cloneResident(this.resident);
    const active = new Set(stagedSource.active);
    const operations: RenderResourceOperationV2[] = [];
    let deduplicated = 0, removed = 0;

    for (const key of [...active].sort()) {
      if (desired.has(key)) continue;
      const entry = resident.get(key);
      invariant(entry !== undefined && entry.owners.has(source), `${source} active resource ${key} lost ownership`);
      const owners = new Set(entry.owners); owners.delete(source); active.delete(key);
      if (owners.size === 0) { resident.delete(key); operations.push(removalFor(entry.record)); removed += 1; }
      else resident.set(key, { record: entry.record, owners });
    }

    for (const key of [...desired].sort()) {
      const sourceRecord = stagedSource.known.get(key);
      const existing = resident.get(key);
      const record = sourceRecord ?? existing?.record;
      invariant(record !== undefined, `${source} frame references unknown resource ${key}`);
      if (!existing) {
        resident.set(key, { record, owners: new Set([source]) });
        active.add(key); operations.push(record.operation); continue;
      }
      const owners = new Set(existing.owners);
      const alreadyOwned = owners.has(source);
      if (existing.record.fingerprint !== record.fingerprint) {
        invariant(owners.size === (alreadyOwned ? 1 : 0), `renderer resource collision at ${key}`);
        operations.push(record.operation);
        resident.set(key, { record, owners: new Set([source]) });
        active.add(key); continue;
      }
      owners.add(source); active.add(key); resident.set(key, { record: existing.record, owners });
      if (!alreadyOwned || sourceRecord !== undefined) deduplicated += 1;
    }

    const output = canonicalOperations(operations);
    invariant(resident.size <= this.maxResidentResources, "composed resident resource cap exceeded");
    invariant(output.length <= this.maxResourceOperations, "composed resource operation cap exceeded");
    const nextGlobalRevision = output.length > 0 ? this.globalResourceRevision + BigInt(1) : this.globalResourceRevision;
    if (output.length > 0) {
      const batch = createRenderResourceBatchV2({
        epoch: this.epoch,
        revision: nextGlobalRevision,
        operations: output.map(cloneOperation),
      });
      if (!this.sink.resources(batch)) return false;
    }
    const committed: SourceStateR10 = {
      revision: sourceRevision,
      lastBatchHash: sourceBatchHash,
      known: new Map(stagedSource.known),
      active,
    };
    if (source === "terrain") this.terrain = committed;
    else this.entity = committed;
    this.resident = resident;
    this.globalResourceRevision = nextGlobalRevision;
    if (output.length > 0) this.counters.emittedResourceBatches += 1;
    this.counters.deduplicatedResourceOperations += deduplicated;
    this.counters.removedResources += removed;
    return true;
  }
}

export function createRustRenderSceneComposerR10(options: RustRenderSceneComposerOptionsR10) {
  return new RustRenderSceneComposerR10(options);
}

/** Build a sink facade without granting access to mutable composer state. */
export function rustRenderTerrainSinkR10(composer: RustRenderSceneComposerR10): RenderSceneExtractionSinkR10 {
  return Object.freeze({
    resources: (batch: RenderResourceBatchV2) => composer.resources(batch),
    frame: (frame: RenderFrameV2) => composer.frame(frame),
    resize: (width: number, height: number) => composer.resize(width, height),
    requestRecovery: (reason?: string) => composer.requestRecovery(reason),
    diagnostics: () => composer.diagnostics(),
  });
}
