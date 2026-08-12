import {
  BLOCK_ATLAS_TEXTURE_ID_V2,
  createRenderFrameV2,
  createRenderResourceBatchV2,
  encodeRenderFrameV2,
  encodeRenderResourceBatchV2,
  type QuatV2,
  type RenderFrameV2,
  type RenderGeometryV2,
  type RenderInstanceV2,
  type RenderResourceBatchV2,
  type RenderResourceOperationV2,
  type Vec3V2,
} from "./rust-render-extraction-v2.ts";
import {
  createRustRendererBackendR11,
  detectRustRendererCapabilityR11,
  type RendererBackendR11,
  type RustRendererCapabilityR11,
} from "./rust-renderer-backend-r11.ts";
import { loadRustRendererArtifactR11, type RustRendererArtifactR11 } from "./rust-renderer-service-r11.ts";

export type RendererRequestR11 = "three" | "wgpu-shadow" | "wgpu";
export type RendererPromotionGatesR11 = Readonly<{
  hardwareBrowser: boolean;
  fullGameParity: boolean;
  supportedDeviceConformance: boolean;
  comparativePerformance: boolean;
  compatibilityBundleIsolated: boolean;
}>;

export const CLOSED_RENDERER_PROMOTION_GATES_R11: RendererPromotionGatesR11 = Object.freeze({
  hardwareBrowser: false,
  fullGameParity: false,
  supportedDeviceConformance: false,
  comparativePerformance: false,
  compatibilityBundleIsolated: false,
});

const PROMOTION_GATE_KEYS = Object.freeze(Object.keys(CLOSED_RENDERER_PROMOTION_GATES_R11) as Array<keyof RendererPromotionGatesR11>);

export type RendererCutoverDecisionR11 = Readonly<{
  requested: RendererRequestR11;
  primary: "three" | "wgpu";
  shadow: "wgpu" | null;
  compatibilityRole: "shipping-primary" | "oracle-with-explicit-shadow" | "isolated-fallback";
  fallback: Readonly<{ code: "capability" | "shadow-policy" | "primary-policy" | "promotion-gates"; message: string }> | null;
  openPromotionGates: readonly (keyof RendererPromotionGatesR11)[];
}>;

export function rendererRequestFromSearchR11(search: string): RendererRequestR11 {
  const value = new URLSearchParams(search).get("renderer");
  return value === "wgpu-shadow" ? value : value === "wgpu" ? value : "three";
}

export function resolveRendererCutoverR11(
  requested: RendererRequestR11,
  options: Readonly<{
    capability: RustRendererCapabilityR11;
    allowWgpuShadow: boolean;
    allowWgpuPrimary: boolean;
    promotionGates: RendererPromotionGatesR11;
  }>,
): RendererCutoverDecisionR11 {
  const openPromotionGates = PROMOTION_GATE_KEYS.filter((key) => options.promotionGates[key] !== true);
  if (requested === "three") return Object.freeze({
    requested, primary: "three", shadow: null, compatibilityRole: "shipping-primary", fallback: null, openPromotionGates,
  });
  if (!options.capability.supported) return Object.freeze({
    requested, primary: "three", shadow: null, compatibilityRole: "shipping-primary",
    fallback: { code: "capability" as const, message: `Rust WebGPU renderer unavailable: ${options.capability.reason}` }, openPromotionGates,
  });
  if (requested === "wgpu-shadow") {
    if (!options.allowWgpuShadow) return Object.freeze({
      requested, primary: "three", shadow: null, compatibilityRole: "shipping-primary",
      fallback: { code: "shadow-policy" as const, message: "Rust WebGPU shadow rendering is disabled by policy" }, openPromotionGates,
    });
    return Object.freeze({ requested, primary: "three", shadow: "wgpu", compatibilityRole: "oracle-with-explicit-shadow", fallback: null, openPromotionGates });
  }
  if (!options.allowWgpuPrimary) return Object.freeze({
    requested, primary: "three", shadow: null, compatibilityRole: "shipping-primary",
    fallback: { code: "primary-policy" as const, message: "Rust WebGPU primary rendering is blocked until the R11 release policy is enabled" }, openPromotionGates,
  });
  if (openPromotionGates.length > 0) return Object.freeze({
    requested, primary: "three", shadow: null, compatibilityRole: "shipping-primary",
    fallback: { code: "promotion-gates" as const, message: `Rust WebGPU primary rendering still has open gates: ${openPromotionGates.join(", ")}` }, openPromotionGates,
  });
  return Object.freeze({ requested, primary: "wgpu", shadow: null, compatibilityRole: "isolated-fallback", fallback: null, openPromotionGates });
}

export interface RendererExtractionSinkR11 {
  resources(batch: RenderResourceBatchV2): boolean;
  frame(frame: RenderFrameV2): boolean;
  resize(width: number, height: number): void;
  requestRecovery(reason?: string): boolean;
  diagnostics(): Readonly<Record<string, unknown>>;
}

export interface RendererWorldExtractionSinkR11 extends RendererExtractionSinkR11 {
  /** Starts an empty renderer store for a newly activated world. */
  switchEpoch(epoch: bigint): boolean;
}

type RendererRuntimeStateR11 = "compatibility" | "starting" | "ready" | "failed" | "stopped";

export class RendererCutoverRuntimeR11 implements RendererWorldExtractionSinkR11 {
  readonly decision: RendererCutoverDecisionR11;
  private backend: RendererBackendR11 | null = null;
  private state: RendererRuntimeStateR11 = "compatibility";
  private startError: string | null = null;
  private pendingResources: Uint8Array[] = [];
  private pendingFrame: Uint8Array | null = null;
  private width: number;
  private height: number;
  private artifactHash: string | null = null;
  private epoch: bigint;
  private readonly canvasRole: "primary" | "shadow";

  constructor(private readonly options: Readonly<{
    request: RendererRequestR11;
    canvas: HTMLCanvasElement;
    canvasRole: "primary" | "shadow";
    epoch: bigint;
    width: number;
    height: number;
    allowWgpuShadow?: boolean;
    allowWgpuPrimary?: boolean;
    promotionGates?: RendererPromotionGatesR11;
    capability?: RustRendererCapabilityR11;
    loadArtifact?: () => Promise<RustRendererArtifactR11>;
    createBackend?: (options: Readonly<{ canvas: HTMLCanvasElement; artifact: RustRendererArtifactR11; epoch: bigint; width: number; height: number }>) => RendererBackendR11 | null;
  }>) {
    this.epoch = checkedRendererEpoch(options.epoch);
    this.width = checkedDimension(options.width, "renderer width");
    this.height = checkedDimension(options.height, "renderer height");
    this.canvasRole = options.canvasRole;
    const capability = options.capability ?? detectRustRendererCapabilityR11(options.canvas);
    this.decision = resolveRendererCutoverR11(options.request, {
      capability,
      allowWgpuShadow: options.allowWgpuShadow === true,
      allowWgpuPrimary: options.allowWgpuPrimary === true,
      promotionGates: options.promotionGates ?? CLOSED_RENDERER_PROMOTION_GATES_R11,
    });
    if (this.decision.shadow === "wgpu" && this.canvasRole !== "shadow") throw new Error("wgpu shadow rendering requires a distinct shadow canvas");
    if (this.decision.primary === "wgpu" && this.canvasRole !== "primary") throw new Error("wgpu primary rendering requires an exclusively owned primary canvas");
  }

  get needsExtraction() { return this.decision.shadow === "wgpu" || this.decision.primary === "wgpu"; }

  async start() {
    if (!this.needsExtraction || this.state === "ready" || this.state === "starting") return;
    if (this.state === "stopped") throw new Error("renderer cutover runtime is stopped");
    this.state = "starting";
    try {
      const artifact = await (this.options.loadArtifact ?? (() => loadRustRendererArtifactR11()))();
      if (this.isStopped()) return;
      const backend = (this.options.createBackend ?? createRustRendererBackendR11)({
        canvas: this.options.canvas, artifact, epoch: this.epoch, width: this.width, height: this.height,
      });
      if (!backend) throw new Error("Rust WebGPU backend rejected the selected canvas capability");
      if (this.isStopped()) { backend.dispose(); return; }
      this.backend = backend; this.artifactHash = artifact.hash; this.state = "ready";
      for (const bytes of this.pendingResources) backend.resources(bytes);
      this.pendingResources.length = 0;
      if (this.pendingFrame) { backend.frame(this.pendingFrame); this.pendingFrame = null; }
      backend.resize(this.width, this.height);
    } catch (error) {
      if (this.isStopped()) return;
      this.startError = error instanceof Error ? error.message : String(error);
      this.state = "failed"; this.pendingResources.length = 0; this.pendingFrame = null;
    }
  }

  resources(batch: RenderResourceBatchV2) {
    if (!this.needsExtraction || this.state === "failed" || this.state === "stopped") return false;
    if (batch.epoch !== this.epoch) throw new Error("renderer extraction resource epoch does not match the active world");
    const bytes = encodeRenderResourceBatchV2(batch);
    if (this.backend) this.backend.resources(bytes);
    else {
      if (this.pendingResources.length >= 64) throw new RangeError("renderer cutover startup resource queue exceeded 64 pages");
      this.pendingResources.push(bytes);
    }
    return true;
  }

  frame(frame: RenderFrameV2) {
    if (!this.needsExtraction || this.state === "failed" || this.state === "stopped") return false;
    if (frame.epoch !== this.epoch) return false;
    const bytes = encodeRenderFrameV2(frame);
    if (this.backend) return this.backend.frame(bytes);
    this.pendingFrame = bytes;
    return true;
  }

  resize(width: number, height: number) {
    this.width = checkedDimension(width, "renderer width"); this.height = checkedDimension(height, "renderer height");
    this.backend?.resize(this.width, this.height);
  }

  requestRecovery(reason = "normal-path renderer recovery request") {
    if (!this.backend || this.state !== "ready") return false;
    this.backend.requestRecovery(reason); return true;
  }

  switchEpoch(epoch: bigint) {
    const next = checkedRendererEpoch(epoch);
    if (!this.needsExtraction || this.state === "failed" || this.state === "stopped") return false;
    this.backend?.switchEpoch(next);
    this.epoch = next;
    this.pendingResources.length = 0;
    this.pendingFrame = null;
    return true;
  }

  diagnostics() {
    const backend = this.backend?.diagnostics() ?? null;
    return Object.freeze({
      schema: 1,
      requested: this.decision.requested,
      selectedPrimary: this.decision.primary,
      activePrimary: this.state === "failed" ? "three" : this.decision.primary,
      shadow: this.decision.shadow,
      compatibilityRole: this.decision.compatibilityRole,
      fallback: this.decision.fallback,
      openPromotionGates: this.decision.openPromotionGates,
      state: this.state,
      epoch: this.epoch,
      artifactHash: this.artifactHash,
      startError: this.startError,
      canvasRole: this.canvasRole,
      extractionCoverage: "terrain-camera-environment",
      fullGameParity: false,
      backend,
    });
  }

  stop() {
    if (this.state === "stopped") return;
    this.backend?.dispose(); this.backend = null; this.pendingResources.length = 0; this.pendingFrame = null; this.state = "stopped";
  }

  private isStopped() { return this.state === "stopped"; }
}

export type RendererShellSnapshotR11 = Readonly<{
  simulationTick: bigint;
  animationTimeMicros: bigint;
  camera: Readonly<{
    position: Vec3V2;
    orientation: QuatV2;
    verticalFovRadians: number;
    near: number;
    far: number;
    viewport: readonly [number, number];
  }>;
  environment: Readonly<{
    daylight: number;
    worldTime: number;
    weather: string;
    underwater: number;
    caveOcclusion: number;
    /** Linear-light RGB authored alongside the compatibility presentation. */
    clearRgb8?: readonly [number, number, number];
    fogRgb8?: readonly [number, number, number];
    fogNear?: number;
    fogFar?: number;
  }>;
  terrain?: RendererTerrainSnapshotInputR11;
}>;

export type RendererTerrainSnapshotInputR11 = Readonly<{
  revision: number;
  atlas?: Readonly<{ revision: number; width: number; height: number; rgba8: Uint8Array }>;
  lighting?: Readonly<{
    skyRgb8: readonly [number, number, number]; skyIntensity: number;
    sunRgb8: readonly [number, number, number]; sunDirection: Vec3V2; sunIntensity: number;
    blockIntensity: number; minimumAmbient: number;
    waterPhase: number;
    held: Readonly<{ position: Vec3V2; colorRgb8: readonly [number, number, number]; intensity: number; radius: number }>;
    machine: Readonly<{ position: Vec3V2; colorRgb8: readonly [number, number, number]; intensity: number; radius: number }>;
  }>;
  pages: readonly Readonly<{
    key: string;
    revision: number;
    layer: "opaque" | "cutout" | "emissive" | "translucentSolid" | "water" | "transparent" | "glass";
    translation: Vec3V2;
    bounds: Readonly<{ minimum: Vec3V2; maximum: Vec3V2 }>;
    geometry: Readonly<{
      positions: Float32Array;
      normals: Int8Array;
      colors: Uint8Array;
      lights: Uint8Array;
      emissions: Uint8Array;
      occlusions: Uint8Array;
      uvs: Uint16Array;
      indices: Uint16Array | Uint32Array;
    }>;
  }>[];
  bytes: number;
  truncated: boolean;
}>;

/**
 * Normal-path Extraction V2 producer. Terrain arrives as immutable pages from
 * world mesh production; this code never traverses a Three scene or queries a
 * voxel/material to reconstruct renderer state.
 */
export class RendererShellExtractionPublisherR11 {
  private frameSequence = BigInt(0);
  private resourceRevision = BigInt(1);
  private submittedFrames = 0;
  private rejectedFrames = 0;
  private rejectedStaleTerrain = 0;
  private lastTerrainSnapshotRevision = -1;
  private lastAtlasRevision = 0;
  private terrainResourcePages = new Map<string, Readonly<{ revision: number; geometry: bigint }>>();
  private terrainPages = 0;
  private terrainBytes = 0;
  private terrainTruncated = false;
  private lastEnvironment: ReturnType<typeof rendererEnvironmentFromShellR11> | null = null;
  private lastLighting: RendererTerrainSnapshotInputR11["lighting"] | null = null;

  constructor(private readonly sink: RendererExtractionSinkR11, readonly epoch: bigint) {
    if (epoch <= BigInt(0)) throw new RangeError("renderer extraction epoch must be positive");
    if (!sink.resources(createRenderResourceBatchV2({ epoch, revision: this.resourceRevision, operations: terrainMaterialOperationsR11() }))) {
      throw new Error("renderer extraction sink rejected the initial terrain material page");
    }
  }

  present(snapshot: RendererShellSnapshotR11) {
    const instances = this.syncTerrain(snapshot.terrain);
    if (instances === null) { this.rejectedFrames += 1; return false; }
    this.frameSequence += BigInt(1);
    const environment = rendererEnvironmentFromShellR11(snapshot.environment, snapshot.terrain?.lighting);
    this.lastEnvironment = environment;
    this.lastLighting = snapshot.terrain?.lighting ?? null;
    const frame = createRenderFrameV2({
      epoch: this.epoch,
      frameSequence: this.frameSequence,
      simulationTick: snapshot.simulationTick,
      animationTimeMicros: snapshot.animationTimeMicros,
      resourceRevision: this.resourceRevision,
      camera: {
        position: [...snapshot.camera.position] as Vec3V2,
        orientation: [...snapshot.camera.orientation] as QuatV2,
        verticalFovRadians: snapshot.camera.verticalFovRadians,
        near: snapshot.camera.near,
        far: snapshot.camera.far,
        viewport: [checkedDimension(snapshot.camera.viewport[0], "viewport width"), checkedDimension(snapshot.camera.viewport[1], "viewport height")],
      },
      environment,
      instances,
      particles: [],
    });
    const accepted = this.sink.frame(frame);
    if (accepted) this.submittedFrames += 1; else this.rejectedFrames += 1;
    return accepted;
  }

  resize(width: number, height: number) { this.sink.resize(width, height); }
  requestRecovery(reason?: string) { return this.sink.requestRecovery(reason); }
  diagnostics() { return Object.freeze({
    schema: 1,
    coverage: "terrain-camera-environment",
    fullGameParity: false,
    submittedFrames: this.submittedFrames,
    rejectedFrames: this.rejectedFrames,
    rejectedStaleTerrain: this.rejectedStaleTerrain,
    terrainSnapshotRevision: this.lastTerrainSnapshotRevision,
    terrainPages: this.terrainPages,
    terrainBytes: this.terrainBytes,
    terrainTruncated: this.terrainTruncated,
    atlasRevision: this.lastAtlasRevision,
    lighting: this.lastLighting,
    environment: this.lastEnvironment,
    resourceRevision: this.resourceRevision,
    sink: this.sink.diagnostics(),
  }); }

  private syncTerrain(snapshot: RendererTerrainSnapshotInputR11 | undefined): RenderInstanceV2[] | null {
    const terrain = snapshot ?? { revision: 0, pages: [], bytes: 0, truncated: false };
    if (!Number.isSafeInteger(terrain.revision) || terrain.revision < 0) throw new RangeError("renderer terrain snapshot revision is invalid");
    if (terrain.revision < this.lastTerrainSnapshotRevision) {
      this.rejectedStaleTerrain += 1;
      return null;
    }
    const next = new Map<string, Readonly<{ revision: number; geometry: bigint }>>();
    const operations: RenderResourceOperationV2[] = [];
    const instances: RenderInstanceV2[] = [];
    if (terrain.atlas && terrain.atlas.revision !== this.lastAtlasRevision) {
      operations.push({
        kind: "upsert-texture",
        texture: Object.freeze({
          id: BLOCK_ATLAS_TEXTURE_ID_V2,
          revision: terrain.atlas.revision,
          width: terrain.atlas.width,
          height: terrain.atlas.height,
          colorSpace: 1,
          filter: 0,
          rgba8: terrain.atlas.rgba8.slice(),
        }),
      });
    }
    for (const page of terrain.pages) {
      if (!page.key || !Number.isInteger(page.revision) || page.revision <= 0 || page.revision > 0xffff_ffff) {
        throw new TypeError("renderer terrain page identity is invalid");
      }
      const geometry = rendererStableIdR11(`terrain-geometry:${page.key}`);
      const current = this.terrainResourcePages.get(page.key);
      if (!current || current.revision !== page.revision || current.geometry !== geometry) {
        operations.push({ kind: "upsert-geometry", geometry: rendererTerrainGeometryR11(page, geometry) });
      }
      next.set(page.key, Object.freeze({ revision: page.revision, geometry }));
      instances.push(Object.freeze({
        stableId: rendererStableIdR11(`terrain-instance:${page.key}`),
        domain: 0,
        geometry,
        material: terrainMaterialIdR11(page.layer),
        parent: null,
        transform: Object.freeze({
          translation: [...page.translation] as Vec3V2,
          rotation: [0, 0, 0, 1] as QuatV2,
          scale: [1, 1, 1] as Vec3V2,
        }),
        tintRgba8: [255, 255, 255, 255] as const,
        visibilityMask: 0xffff_ffff,
        sortKey: terrainSortKeyR11(page.layer),
        animationFlags: 0,
      }));
    }
    for (const [key, page] of this.terrainResourcePages) if (!next.has(key)) {
      operations.push({ kind: "remove-geometry", id: page.geometry });
    }
    if (operations.length > 0) {
      const revision = this.resourceRevision + BigInt(1);
      const accepted = this.sink.resources(createRenderResourceBatchV2({ epoch: this.epoch, revision, operations }));
      if (!accepted) return null;
      this.resourceRevision = revision;
    }
    if (terrain.atlas) this.lastAtlasRevision = terrain.atlas.revision;
    this.terrainResourcePages = next;
    this.lastTerrainSnapshotRevision = terrain.revision;
    this.terrainPages = terrain.pages.length;
    this.terrainBytes = terrain.bytes;
    this.terrainTruncated = terrain.truncated;
    return instances;
  }
}

const TERRAIN_LAYER_ORDINAL_R11 = Object.freeze({
  opaque: 0, cutout: 1, emissive: 2, translucentSolid: 3, water: 4, transparent: 5, glass: 6,
} as const);

type TerrainLayerR11 = keyof typeof TERRAIN_LAYER_ORDINAL_R11;

function terrainMaterialIdR11(layer: TerrainLayerR11) { return BigInt(4_096 + TERRAIN_LAYER_ORDINAL_R11[layer]); }
function terrainSortKeyR11(layer: TerrainLayerR11) { return TERRAIN_LAYER_ORDINAL_R11[layer]; }

function terrainMaterialOperationsR11(): RenderResourceOperationV2[] {
  return (Object.keys(TERRAIN_LAYER_ORDINAL_R11) as TerrainLayerR11[]).map((layer) => {
    const transparent = ["translucentSolid", "transparent", "glass"].includes(layer);
    const water = layer === "water";
    const emissive = layer === "emissive";
    return {
      kind: "upsert-material" as const,
      material: Object.freeze({
        id: terrainMaterialIdR11(layer), revision: 1, shading: 1 as const,
        blend: water ? 4 as const : layer === "cutout" ? 1 as const : transparent ? 2 as const : 0 as const,
        baseColorRgba8: [255, 255, 255, water ? 198 : transparent ? 176 : 255] as const,
        emissiveRgb8: emissive ? [255, 238, 182] as const : [0, 0, 0] as const,
        emissiveStrength: emissive ? 0.7 : 0,
        roughness: water || layer === "glass" ? 0.18 : 0.86,
        metalness: 0,
        alphaCutoff: layer === "cutout" ? 0.35 : 0,
        atlasTile: 0,
        doubleSided: layer !== "opaque",
        depthWrite: !transparent && !water,
      }),
    };
  });
}

function rendererTerrainGeometryR11(
  page: RendererTerrainSnapshotInputR11["pages"][number],
  id: bigint,
): RenderGeometryV2 {
  return Object.freeze({
    id,
    revision: page.revision,
    kind: 0,
    bounds: Object.freeze({ minimum: [...page.bounds.minimum] as Vec3V2, maximum: [...page.bounds.maximum] as Vec3V2 }),
    positions: page.geometry.positions.slice(),
    normals: page.geometry.normals.slice(),
    colors: page.geometry.colors.slice(),
    lights: page.geometry.lights.slice(),
    emissions: page.geometry.emissions.slice(),
    occlusions: page.geometry.occlusions.slice(),
    uvs: page.geometry.uvs.slice(),
    indices: Uint32Array.from(page.geometry.indices),
  });
}

function rendererStableIdR11(value: string) {
  let hash = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211"), mask = BigInt("0xffffffffffffffff");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = hash * prime & mask;
  }
  return hash === BigInt(0) ? BigInt(1) : hash;
}

function rendererEnvironmentFromShellR11(
  source: RendererShellSnapshotR11["environment"],
  lighting?: RendererTerrainSnapshotInputR11["lighting"],
) {
  const daylight = clamp01(source.daylight), underwater = clamp01(source.underwater), cave = clamp01(source.caveOcclusion);
  const storm = /rain|storm|thunder|snow|ash/u.test(source.weather) ? 0.68 : 1;
  const night = [6, 11, 27] as const, day = [103, 169, 213] as const;
  let clear = source.clearRgb8
    ? [...source.clearRgb8] as [number, number, number]
    : night.map((value, index) => Math.round((value + (day[index] - value) * daylight) * storm)) as [number, number, number];
  if (!source.clearRgb8) {
    if (cave > 0.55) clear = [18, 29, 25];
    if (underwater > 0.55) clear = [24, 83, 112];
  }
  const angle = (source.worldTime % 1) * Math.PI * 2;
  return {
    clearRgba8: [...clear, 255] as const,
    ambientRgb8: lighting ? [...lighting.skyRgb8] as [number, number, number]
      : underwater > 0.5 ? [76, 128, 148] as const : cave > 0.5 ? [83, 102, 90] as const : [166, 185, 181] as const,
    ambientIntensity: lighting?.skyIntensity ?? 0.22 + daylight * 0.78,
    sunDirection: lighting ? [...lighting.sunDirection] as Vec3V2 : [Math.cos(angle), Math.sin(angle), 0.34] as const,
    sunRgb8: lighting ? [...lighting.sunRgb8] as [number, number, number] : [255, 235, 188] as const,
    sunIntensity: lighting?.sunIntensity ?? daylight * storm,
    fogRgb8: source.fogRgb8 ? [...source.fogRgb8] as [number, number, number] : [...clear] as [number, number, number],
    fogNear: source.fogNear ?? (underwater > 0.5 ? 2 : cave > 0.5 ? 4 : 22),
    fogFar: source.fogFar ?? (underwater > 0.5 ? 46 : cave > 0.5 ? 64 : 192),
    underwater,
    caveOcclusion: cave,
    ...(lighting ? { lighting: {
      blockIntensity: lighting.blockIntensity,
      minimumAmbient: lighting.minimumAmbient,
      waterPhase: lighting.waterPhase,
      held: {
        position: [...lighting.held.position] as Vec3V2,
        colorRgb8: [...lighting.held.colorRgb8] as [number, number, number],
        intensity: lighting.held.intensity,
        radius: lighting.held.radius,
      },
      machine: {
        position: [...lighting.machine.position] as Vec3V2,
        colorRgb8: [...lighting.machine.colorRgb8] as [number, number, number],
        intensity: lighting.machine.intensity,
        radius: lighting.machine.radius,
      },
    } } : {}),
  };
}

function checkedDimension(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0 || value > 16_384) throw new RangeError(`${label} must be an integer in 1..16384`);
  return value;
}

const RENDERER_U64_MAX_R11 = BigInt("0xffffffffffffffff");

function checkedRendererEpoch(value: bigint) {
  if (value <= BigInt(0) || value > RENDERER_U64_MAX_R11) throw new RangeError("renderer epoch must be a positive u64");
  return value;
}

/** Stable, overflow-safe world epoch. Generation zero intentionally preserves the shell base epoch. */
export function rendererWorldEpochR11(baseEpoch: bigint, worldGeneration: number) {
  const base = checkedRendererEpoch(baseEpoch);
  if (!Number.isSafeInteger(worldGeneration) || worldGeneration < 0) throw new RangeError("renderer world generation is invalid");
  return (base - BigInt(1) + BigInt(worldGeneration)) % RENDERER_U64_MAX_R11 + BigInt(1);
}

function clamp01(value: number) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
