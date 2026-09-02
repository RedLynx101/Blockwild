import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build as buildWithEsbuild } from "esbuild";
import sharp from "sharp";
import * as THREE from "three";
import { BlockId } from "../app/game/data.ts";
import {
  LEGACY_TERRAIN_CONTENT_HASH_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
  createGenerateChunkRequestV2,
  legacyTerrainGeneratorHashV2,
  type GeneratedChunkV2,
} from "../app/game/terrain-generation-contract.ts";
import {
  createRenderFrameV2,
  createRenderResourceBatchV2,
  encodeRenderFrameV2,
  encodeRenderResourceBatchV2,
  type RenderGeometryV2,
} from "../app/game/rust-render-extraction-v2.ts";
import {
  decodeRustTerrainGenerationResultV2,
  encodeRustTerrainGenerationRequestV2,
  parseTerrainGenerationParityCertificateV2,
} from "../app/game/rust-terrain-generation-bridge.ts";
import {
  RustEngineToolError,
  isDirectInvocation,
  parseCommandLine,
} from "./rust-engine-common.mjs";
import {
  resolveR3BrowserOutputPath,
  resolveR3BrowserPublicDirectory,
  selectR3BrowserArtifact,
} from "./verify-rust-generation-r3-browser.ts";

type SceneCase = Readonly<{
  id: string;
  seed: string;
  chunk: readonly [number, number];
  focus: string;
  camera: Readonly<{ position: readonly [number, number, number]; lookAt: readonly [number, number, number]; fov: number }>;
}>;
type SceneData = Readonly<{
  entry: SceneCase;
  geometry: RenderGeometryV2;
  resources: Uint8Array;
  frame: Uint8Array;
  chunkHash: string;
  metadata: Readonly<Record<string, unknown>>;
  fixtureCheck: Readonly<Record<string, unknown>>;
}>;

type LandscapeMode = "check" | "update-tracked-fixtures";
type LandscapeConfiguration = Readonly<{
  mode: LandscapeMode;
  repositoryRoot: string;
  publicEngineDirectory: string;
  outputDirectory: string;
  candidate: boolean;
  artifact: Readonly<{
    variant: string;
    hash: string;
    directory: string;
    sourceSnapshot: Readonly<{ schema: number; digest: string; fileCount: number }>;
  }>;
}>;
type LandscapeReport = Readonly<{
  id: string;
  caseIdentity: Readonly<{ seed: string; chunk: readonly [number, number]; focus: string }>;
  chunkHash: string;
  sceneRecords: Readonly<Record<string, unknown>>;
  images: Readonly<{
    three: string;
    wgpu: string;
    metrics: Readonly<Record<string, unknown>>;
  }>;
  threeReport: unknown;
  wgpuReport: unknown;
  errors: string[];
}>;
type LandscapePage = {
  on: (event: string, callback: (value: unknown) => void) => void;
  goto: (url: string) => Promise<unknown>;
  evaluate: (source: string) => Promise<unknown>;
  waitForFunction: (source: string) => Promise<unknown>;
  locator: (selector: string) => { screenshot: (options: { path: string }) => Promise<unknown> };
  close: () => Promise<void>;
};
type LandscapeBrowser = {
  newPage: (options: { viewport: { width: number; height: number }; deviceScaleFactor: number }) => Promise<LandscapePage>;
  close: () => Promise<void>;
};

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "rust-engine", "r3", "landscape-scenes");
const WIDTH = 960, HEIGHT = 540, MIN_Y = -64, WORLD_HEIGHT = 192, CHUNK_SIZE = 16;
const SURFACE_BACKGROUND_SRGB_R3 = 0x6ea0be;
const CAVE_BACKGROUND_SRGB_R3 = 0x111a1d;
const SURFACE_AMBIENT_SRGB_R3 = 0xb9ccc3;
const CAVE_AMBIENT_SRGB_R3 = 0x7c918b;
const SUN_SRGB_R3 = 0xffeec6;
export const R3_RENDERER_PARITY_MAX_MAE = 1.5;
export const R3_RENDERER_PARITY_MAX_RMSE = 8;
const OPTIONS = {
  "public-dir": { type: "string", default: "public/engine" },
  "expected-artifact-hash": { type: "string", default: null },
  "output-dir": { type: "string", default: null },
  check: { type: "boolean", default: false },
  "update-tracked-fixtures": { type: "boolean", default: false },
};
const EXPECTED_SCENE_IDS = Object.freeze([
  "poi-negative-chunk",
  "connected-ocean-horizon",
  "deep-ocean-flora",
  "cave-aquifer-section",
  "biome-transition-negative-space",
]);
export const R3_LANDSCAPE_HARNESS_HTML = "<!doctype html><meta charset=utf-8><link rel=icon href=data:,><title>Blockwild R3 Landscape Audit</title><canvas width=960 height=540></canvas>";
export const R3_THREE_ORACLE_BROWSER_ENTRY = String.raw`
import { ThreeExtractionOracleR11 } from "./app/three-compat/renderer-extraction-oracle-r11.ts";
import {
  decodeRenderFrameV2,
  decodeRenderResourceBatchV2,
} from "./app/game/rust-render-extraction-v2.ts";

const activeOracles = new WeakMap();
const hex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

export function renderThreeExtractionRecordsR3(canvas, resourceBytes, frameBytes) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("R3 Three oracle requires an HTML canvas");
  if (!(resourceBytes instanceof Uint8Array) || !(frameBytes instanceof Uint8Array)) {
    throw new TypeError("R3 Three oracle requires exact Uint8Array extraction records");
  }
  const resources = decodeRenderResourceBatchV2(resourceBytes);
  const frame = decodeRenderFrameV2(frameBytes);
  activeOracles.get(canvas)?.dispose();
  const oracle = new ThreeExtractionOracleR11(canvas);
  activeOracles.set(canvas, oracle);
  oracle.applyResources(resources);
  oracle.render(frame);
  return Object.freeze({
    renderer: "ThreeExtractionOracleR11",
    resourceBytes: resourceBytes.byteLength,
    frameBytes: frameBytes.byteLength,
    batchHash: hex(resources.batchHash),
    frameHash: hex(frame.frameHash),
    operations: resources.operations.length,
    instances: frame.instances.length,
    resourceRevision: frame.resourceRevision.toString(),
    frameSequence: frame.frameSequence.toString(),
  });
}
`;

/**
 * Extraction V2 environment bytes are linear-light values. Both the app's
 * ThreeExtractionOracleR11 and the wgpu sRGB surface encode those bytes once
 * during presentation. Convert authored display colors before recording them.
 */
export function linearRgb8FromSrgbHexR3(value: number): readonly [number, number, number] {
  if (!Number.isInteger(value) || value < 0 || value > 0xff_ff_ff) {
    throw new RangeError("R3 landscape sRGB color must be a 24-bit integer");
  }
  const color = new THREE.Color(value);
  const byte = (component: number) => Math.round(THREE.MathUtils.clamp(component, 0, 1) * 255);
  return Object.freeze([byte(color.r), byte(color.g), byte(color.b)] as const);
}

export function skyOnlyVertexLightsR3(vertexCount: number) {
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 0 || vertexCount > 0x3fff_ffff) {
    throw new RangeError("R3 landscape vertex count is outside the supported range");
  }
  const lights = new Uint8Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) lights[vertex * 4] = 255;
  return lights;
}

export function isR3RendererPixelParityWithinBounds(value: unknown) {
  const comparison = value as {
    comparable?: unknown;
    meanAbsoluteError?: unknown;
    rootMeanSquareError?: unknown;
  } | null;
  return comparison?.comparable === true
    && typeof comparison.meanAbsoluteError === "number"
    && Number.isFinite(comparison.meanAbsoluteError)
    && comparison.meanAbsoluteError <= R3_RENDERER_PARITY_MAX_MAE
    && typeof comparison.rootMeanSquareError === "number"
    && Number.isFinite(comparison.rootMeanSquareError)
    && comparison.rootMeanSquareError <= R3_RENDERER_PARITY_MAX_RMSE;
}

export async function buildThreeExtractionOracleBundleR3(repositoryRoot = ROOT) {
  const canonicalRoot = path.resolve(repositoryRoot);
  const result = await buildWithEsbuild({
    stdin: {
      contents: R3_THREE_ORACLE_BROWSER_ENTRY,
      loader: "ts",
      resolveDir: repositoryRoot,
      sourcefile: "r3-three-extraction-oracle-browser.ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    write: false,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    tsconfigRaw: { compilerOptions: { target: "ES2022", useDefineForClassFields: true } },
    plugins: [{
      name: "r3-three-oracle-bounded-loader",
      setup(builder) {
        builder.onResolve({ filter: /^three$/ }, () => ({ path: "/three.module.js", external: true }));
        builder.onResolve({ filter: /^\./ }, (args) => {
          const base = args.resolveDir || (path.isAbsolute(args.importer) ? path.dirname(args.importer) : canonicalRoot);
          const target = path.resolve(base, args.path);
          if (target === canonicalRoot || !target.startsWith(`${canonicalRoot}${path.sep}`)) {
            return { errors: [{ text: `R3 Three oracle import escaped the repository root: ${args.path}` }] };
          }
          return { path: target, namespace: "r3-three-oracle-local" };
        });
        builder.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: "r3-three-oracle-local" }, async (args) => ({
          contents: await readFile(args.path, "utf8"),
          loader: args.path.endsWith("x") ? "tsx" : args.path.endsWith(".ts") ? "ts" : "js",
          resolveDir: path.dirname(args.path),
        }));
      },
    }],
  });
  if (result.outputFiles.length !== 1) {
    throw new RustEngineToolError(`R3 Three oracle bundle produced ${result.outputFiles.length} outputs instead of one.`);
  }
  return result.outputFiles[0].text;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativePath(root: string, target: string) {
  return path.relative(root, target).replaceAll(path.sep, "/");
}

export function resolveR3LandscapeOutputDirectory(requestedPath: string, repositoryRoot = ROOT) {
  const evidencePath = resolveR3BrowserOutputPath(path.join(requestedPath, "evidence.json"), repositoryRoot);
  return path.dirname(evidencePath);
}

export function resolveR3LandscapeMode(
  options: Readonly<{ check: boolean; updateTrackedFixtures: boolean }>,
  publicEngineDirectory: string,
  repositoryRoot = ROOT,
): LandscapeMode {
  if (options.check === options.updateTrackedFixtures) {
    throw new RustEngineToolError("Choose exactly one landscape mode: --check or --update-tracked-fixtures.");
  }
  const canonicalPublicDirectory = path.resolve(repositoryRoot, "public", "engine");
  if (options.updateTrackedFixtures && path.resolve(publicEngineDirectory) !== canonicalPublicDirectory) {
    throw new RustEngineToolError("--update-tracked-fixtures is allowed only with the exact canonical public/engine root.");
  }
  return options.updateTrackedFixtures ? "update-tracked-fixtures" : "check";
}

export function parseR3LandscapeConfiguration(argv = process.argv, repositoryRoot = ROOT): LandscapeConfiguration {
  const options = parseCommandLine(argv, OPTIONS);
  const publicEngineDirectory = resolveR3BrowserPublicDirectory(options["public-dir"], repositoryRoot);
  if (!options["expected-artifact-hash"]) {
    throw new RustEngineToolError("R3 landscape verification requires --expected-artifact-hash.");
  }
  if (!options["output-dir"]) {
    throw new RustEngineToolError("R3 landscape verification requires --output-dir beneath work/.");
  }
  const mode = resolveR3LandscapeMode({
    check: options.check,
    updateTrackedFixtures: options["update-tracked-fixtures"],
  }, publicEngineDirectory, repositoryRoot);
  const outputDirectory = resolveR3LandscapeOutputDirectory(options["output-dir"], repositoryRoot);
  const artifact = selectR3BrowserArtifact(publicEngineDirectory, options["expected-artifact-hash"]);
  const canonicalPublicDirectory = path.resolve(repositoryRoot, "public", "engine");
  const candidate = path.resolve(publicEngineDirectory) !== canonicalPublicDirectory;
  if (candidate && mode !== "check") {
    throw new RustEngineToolError("Candidate landscape verification is evidence-only and requires --check.");
  }
  return Object.freeze({
    mode,
    repositoryRoot: path.resolve(repositoryRoot),
    publicEngineDirectory,
    outputDirectory,
    candidate,
    artifact,
  });
}

export function validateR3LandscapeCases(value: unknown): readonly SceneCase[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RustEngineToolError("R3 landscape corpus must be an object.");
  }
  const manifest = value as { schema?: unknown; cases?: unknown };
  if (manifest.schema !== 1 || !Array.isArray(manifest.cases) || manifest.cases.length !== EXPECTED_SCENE_IDS.length) {
    throw new RustEngineToolError("R3 landscape corpus must retain schema 1 and exactly five cases.");
  }
  const ids = manifest.cases.map((entry) => (entry as { id?: unknown })?.id);
  if (ids.some((id, index) => id !== EXPECTED_SCENE_IDS[index])) {
    throw new RustEngineToolError(`R3 landscape case order changed: ${ids.join(", ")}.`);
  }
  return manifest.cases as SceneCase[];
}

function blockIndex(x: number, y: number, z: number) { return x + z * CHUNK_SIZE + (y - MIN_Y) * CHUNK_SIZE * CHUNK_SIZE; }
function blockAt(chunk: GeneratedChunkV2, x: number, y: number, z: number) {
  if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < MIN_Y || y >= MIN_Y + WORLD_HEIGHT) return BlockId.Air;
  return chunk.blocks[blockIndex(x, y, z)] ?? BlockId.Air;
}

const BIOME_COLORS: readonly (readonly [number, number, number])[] = [
  [88, 139, 72], [63, 119, 70], [51, 103, 82], [83, 130, 66], [111, 151, 76], [199, 171, 98],
  [104, 150, 132], [109, 98, 75], [151, 93, 64], [74, 113, 70], [136, 181, 174], [106, 87, 126],
  [211, 194, 145], [92, 129, 105], [66, 116, 102], [178, 113, 80], [122, 148, 160], [62, 109, 83],
  [92, 103, 83], [75, 124, 112], [178, 155, 105], [105, 133, 148], [104, 93, 129], [78, 125, 96],
];

function colorFor(block: number, biome: number): readonly [number, number, number] {
  if (block === BlockId.Water) return [42, 116, 176];
  if (block === BlockId.Ice) return [151, 215, 231];
  if (block === BlockId.Lava) return [238, 94, 34];
  if (block === BlockId.Sand) return [207, 185, 119];
  if (block === BlockId.RedSand) return [184, 103, 61];
  if (block === BlockId.Snow || block === BlockId.SnowyGrass) return [220, 235, 235];
  if (block === BlockId.Stone || block === BlockId.Bedrock) return [92, 96, 94];
  if (block === BlockId.Dirt || block === BlockId.Mud) return [101, 75, 51];
  if (block === BlockId.WildwoodLog || block === BlockId.PineLog || block === BlockId.BirchLog) return [83, 58, 38];
  if (block === BlockId.WildwoodLeaves || block === BlockId.PineLeaves || block === BlockId.BirchLeaves) return [39, 101, 60];
  return BIOME_COLORS[biome % BIOME_COLORS.length] ?? [110, 130, 92];
}

function buildGeometry(chunk: GeneratedChunkV2, cave: boolean, underwater: boolean, id: bigint): RenderGeometryV2 {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  const addQuad = (points: readonly (readonly [number, number, number])[], normal: readonly [number, number, number], color: readonly [number, number, number]) => {
    const start = positions.length / 3;
    for (const point of points) {
      positions.push(...point); normals.push(normal[0] * 127, normal[1] * 127, normal[2] * 127); colors.push(...color);
    }
    indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
  };
  const addFace = (x: number, y: number, z: number, side: number, color: readonly [number, number, number]) => {
    const faces = [
      [[[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], [0, 1, 0]],
      [[[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], [x, y, z]], [0, -1, 0]],
      [[[x + 1, y, z], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z]], [1, 0, 0]],
      [[[x, y, z + 1], [x, y, z], [x, y + 1, z], [x, y + 1, z + 1]], [-1, 0, 0]],
      [[[x + 1, y, z + 1], [x, y, z + 1], [x, y + 1, z + 1], [x + 1, y + 1, z + 1]], [0, 0, 1]],
      [[[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]], [0, 0, -1]],
    ] as const;
    addQuad(faces[side][0], faces[side][1], color);
  };
  if (cave) {
    const minimum = -38, maximum = 4;
    const directions = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const;
    for (let y = minimum; y <= maximum; y += 1) for (let z = 1; z < CHUNK_SIZE - 1; z += 1) for (let x = 1; x <= 8; x += 1) {
      const block = blockAt(chunk, x, y, z);
      if (block === BlockId.Air || block === BlockId.Water || block === BlockId.Lava) continue;
      const color = colorFor(block, chunk.biomes[x + z * CHUNK_SIZE]);
      directions.forEach(([dx, dy, dz], side) => {
        const neighbor = blockAt(chunk, x + dx, y + dy, z + dz);
        if (neighbor === BlockId.Air || neighbor === BlockId.Water || neighbor === BlockId.Lava) addFace(x, y, z, side, color);
      });
    }
  } else if (underwater) {
    const topAt = (x: number, z: number) => {
      for (let y = 34; y >= -16; y -= 1) { const block = blockAt(chunk, x, y, z); if (block !== BlockId.Air && block !== BlockId.Water) return y; }
      return -16;
    };
    for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) {
      const y = topAt(x, z), block = blockAt(chunk, x, y, z);
      const color = colorFor(block, chunk.biomes[x + z * CHUNK_SIZE]);
      addFace(x, y, z, 0, color);
      for (const [side, dx, dz] of [[2, 1, 0], [3, -1, 0], [4, 0, 1], [5, 0, -1]] as const) {
        const neighbor = x + dx < 0 || x + dx >= CHUNK_SIZE || z + dz < 0 || z + dz >= CHUNK_SIZE ? y - 3 : topAt(x + dx, z + dz);
        for (let faceY = Math.max(neighbor + 1, y - 7); faceY <= y; faceY += 1) addFace(x, faceY, z, side, color.map((value) => Math.round(value * 0.7)) as [number, number, number]);
      }
    }
  } else {
    const topAt = (x: number, z: number) => {
      for (let y = MIN_Y + WORLD_HEIGHT - 1; y >= MIN_Y; y -= 1) if (blockAt(chunk, x, y, z) !== BlockId.Air) return y;
      return MIN_Y;
    };
    for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) {
      const y = topAt(x, z);
      const block = blockAt(chunk, x, y, z);
      const color = colorFor(block, chunk.biomes[x + z * CHUNK_SIZE]);
      addFace(x, y, z, 0, color);
      for (const [side, dx, dz] of [[2, 1, 0], [3, -1, 0], [4, 0, 1], [5, 0, -1]] as const) {
        const neighbor = x + dx < 0 || x + dx >= CHUNK_SIZE || z + dz < 0 || z + dz >= CHUNK_SIZE
          ? y - 4 : topAt(x + dx, z + dz);
        for (let faceY = Math.max(neighbor + 1, y - 12); faceY <= y; faceY += 1) addFace(x, faceY, z, side, color.map((value) => Math.round(value * 0.74)) as [number, number, number]);
      }
    }
  }
  const bounds = new THREE.Box3().setFromBufferAttribute(new THREE.Float32BufferAttribute(positions, 3));
  return {
    id, revision: 1, kind: 0,
    bounds: { minimum: bounds.min.toArray() as [number, number, number], maximum: bounds.max.toArray() as [number, number, number] },
    positions: Float32Array.from(positions), normals: Int8Array.from(normals), colors: Uint8Array.from(colors),
    lights: skyOnlyVertexLightsR3(positions.length / 3), emissions: new Uint8Array(), occlusions: new Uint8Array(), uvs: new Uint16Array(), indices: Uint32Array.from(indices),
  };
}

function galleryCamera(entry: SceneCase, geometry: RenderGeometryV2) {
  const origin = new THREE.Vector3(entry.chunk[0] * CHUNK_SIZE, 0, entry.chunk[1] * CHUNK_SIZE);
  const minimum = new THREE.Vector3().fromArray(geometry.bounds.minimum).add(origin);
  const maximum = new THREE.Vector3().fromArray(geometry.bounds.maximum).add(origin);
  const center = minimum.clone().add(maximum).multiplyScalar(0.5);
  const cave = entry.id.includes("cave"), underwater = entry.id.includes("ocean-flora");
  const position = cave ? center.clone().add(new THREE.Vector3(18, 3, 0))
    : underwater ? center.clone().add(new THREE.Vector3(18, 10, 18))
      : center.clone().add(new THREE.Vector3(17, 14, 17));
  const lookAt = cave ? center.clone().add(new THREE.Vector3(0, -2, 0)) : center;
  const fov = cave ? 52 : underwater ? 56 : 48;
  const camera = new THREE.PerspectiveCamera(fov, WIDTH / HEIGHT, 0.1, 400);
  camera.position.copy(position);
  camera.lookAt(lookAt);
  return camera.quaternion.toArray() as [number, number, number, number];
}

async function generationModule(configuration: LandscapeConfiguration) {
  const { artifact } = configuration;
  const wasmModule = await import(`${pathToFileURL(path.join(artifact.directory, "engine.js")).href}?landscape=${artifact.hash}-${Date.now()}`);
  await wasmModule.default({ module_or_path: new Uint8Array(await readFile(path.join(artifact.directory, "engine_bg.wasm"))) });
  if (typeof wasmModule.blockwild_generation_parity_certificate_v2 !== "function") {
    throw new RustEngineToolError("Selected landscape artifact does not export the generation parity certificate.");
  }
  const certificate = parseTerrainGenerationParityCertificateV2(
    wasmModule.blockwild_generation_parity_certificate_v2(),
  );
  if (
    !certificate.byteEqual
    || certificate.corpusCases !== TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2
    || certificate.corpusHash !== TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2
  ) {
    throw new RustEngineToolError(
      `Selected landscape artifact does not carry the exact ${TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2}-case certificate ${TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2}.`,
    );
  }
  return { wasmModule, certificate };
}

async function compareTrackedScene(entry: SceneCase, resources: Uint8Array, frame: Uint8Array, metadata: Record<string, unknown>) {
  const resourcePath = path.join(FIXTURES, `${entry.id}.bwrd`);
  const framePath = path.join(FIXTURES, `${entry.id}.bwrf`);
  const metadataPath = path.join(FIXTURES, `${entry.id}.json`);
  if (![resourcePath, framePath, metadataPath].every(existsSync)) {
    return Object.freeze({ exact: false, error: "tracked scene record is missing" });
  }
  const [trackedResources, trackedFrame, trackedMetadataText] = await Promise.all([
    readFile(resourcePath),
    readFile(framePath),
    readFile(metadataPath, "utf8"),
  ]);
  let trackedMetadata: unknown;
  try {
    trackedMetadata = JSON.parse(trackedMetadataText);
  } catch (error) {
    return Object.freeze({ exact: false, error: `tracked metadata is invalid JSON: ${(error as Error).message}` });
  }
  const resourcesExact = Buffer.compare(trackedResources, Buffer.from(resources)) === 0;
  const frameExact = Buffer.compare(trackedFrame, Buffer.from(frame)) === 0;
  const metadataExact = JSON.stringify(trackedMetadata) === JSON.stringify(metadata);
  return Object.freeze({
    exact: resourcesExact && frameExact && metadataExact,
    resourcesExact,
    frameExact,
    metadataExact,
    tracked: {
      resourcesSha256: sha256(trackedResources),
      frameSha256: sha256(trackedFrame),
    },
  });
}

async function buildScenes(configuration: LandscapeConfiguration) {
  const manifestValue = JSON.parse(await readFile(path.join(ROOT, "tests", "fixtures", "rust-engine", "r3", "landscape-corpus.json"), "utf8"));
  const cases = validateR3LandscapeCases(manifestValue);
  const { wasmModule, certificate } = await generationModule(configuration);
  const workRecords = path.join(configuration.outputDirectory, "scene-records");
  await mkdir(workRecords, { recursive: true });
  if (configuration.mode === "update-tracked-fixtures") await mkdir(FIXTURES, { recursive: true });
  const scenes: SceneData[] = [];
  for (const [index, entry] of cases.entries()) {
    const [cx, cz] = entry.chunk;
    const namespace = `terrain-v5|g18|${entry.seed}|{}|${cx},${cz}|0`;
    const request = createGenerateChunkRequestV2({ epoch: 1, taskId: index + 1, revision: 1, namespace,
      contentHash: LEGACY_TERRAIN_CONTENT_HASH_V2, generatorHash: legacyTerrainGeneratorHashV2(namespace), seedText: entry.seed,
      generationOptions: {}, key: `${cx},${cz}`, cx, cz, edits: [] });
    const chunk = decodeRustTerrainGenerationResultV2(wasmModule.blockwild_generate_chunk_v2(encodeRustTerrainGenerationRequestV2(request)), request);
    const cave = entry.id.includes("cave"), underwater = entry.id.includes("ocean-flora");
    const backgroundSrgb = cave ? CAVE_BACKGROUND_SRGB_R3 : SURFACE_BACKGROUND_SRGB_R3;
    const backgroundLinear = linearRgb8FromSrgbHexR3(backgroundSrgb);
    const ambientLinear = linearRgb8FromSrgbHexR3(cave ? CAVE_AMBIENT_SRGB_R3 : SURFACE_AMBIENT_SRGB_R3);
    const sunLinear = linearRgb8FromSrgbHexR3(SUN_SRGB_R3);
    const geometry = buildGeometry(chunk, cave, underwater, BigInt(index * 10 + 2));
    const origin = new THREE.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    const minimum = new THREE.Vector3().fromArray(geometry.bounds.minimum).add(origin);
    const maximum = new THREE.Vector3().fromArray(geometry.bounds.maximum).add(origin);
    const center = minimum.clone().add(maximum).multiplyScalar(0.5);
    const cameraPosition = cave ? center.clone().add(new THREE.Vector3(18, 3, 0)) : underwater ? center.clone().add(new THREE.Vector3(18, 10, 18)) : center.clone().add(new THREE.Vector3(17, 14, 17));
    const cameraLookAt = cave ? center.clone().add(new THREE.Vector3(0, -2, 0)) : center;
    const cameraFov = cave ? 52 : underwater ? 56 : 48;
    const materialId = BigInt(index * 10 + 1), geometryId = geometry.id;
    const resources = createRenderResourceBatchV2({ epoch: BigInt(3), revision: BigInt(1), operations: [
      { kind: "upsert-material", material: { id: materialId, revision: 1, shading: 1, blend: 0, baseColorRgba8: [255, 255, 255, 255], emissiveRgb8: [0, 0, 0], emissiveStrength: 0, roughness: 0.92, metalness: 0, alphaCutoff: 0, atlasTile: null, doubleSided: false, depthWrite: true } },
      { kind: "upsert-geometry", geometry },
    ] });
    const frame = createRenderFrameV2({ epoch: BigInt(3), frameSequence: BigInt(index + 1), simulationTick: BigInt(0), animationTimeMicros: BigInt(0),
      resourceRevision: BigInt(1), camera: { position: cameraPosition.toArray() as [number, number, number], orientation: galleryCamera(entry, geometry), verticalFovRadians: THREE.MathUtils.degToRad(cameraFov), near: 0.1, far: 400, viewport: [WIDTH, HEIGHT] },
      environment: { clearRgba8: [...backgroundLinear, 255], ambientRgb8: ambientLinear, ambientIntensity: cave ? 0.34 : 0.72,
        sunDirection: [0.45, 0.8, 0.35], sunRgb8: sunLinear, sunIntensity: cave ? 0.22 : 1.05,
        fogRgb8: backgroundLinear, fogNear: entry.id.includes("cave") ? 18 : 70,
        fogFar: entry.id.includes("cave") ? 75 : 260, underwater: entry.id.includes("ocean-flora") ? 0.35 : 0, caveOcclusion: entry.id.includes("cave") ? 0.8 : 0 },
      instances: [{ stableId: BigInt(index + 1), domain: 0, geometry: geometryId, material: materialId, parent: null,
        transform: { translation: [cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, tintRgba8: [255, 255, 255, 255], visibilityMask: 0xffff_ffff, sortKey: 0, animationFlags: 0 }], particles: [] });
    const resourceBytes = encodeRenderResourceBatchV2(resources), frameBytes = encodeRenderFrameV2(frame);
    const metadata = { schema: 1, id: entry.id, focus: entry.focus, seed: entry.seed, chunk: entry.chunk,
      chunkHash: chunk.chunkHash, vertices: geometry.positions.length / 3, triangles: geometry.indices.length / 3,
      camera: { position: cameraPosition.toArray(), lookAt: cameraLookAt.toArray(), fov: cameraFov },
      resourceBytes: resourceBytes.byteLength, frameBytes: frameBytes.byteLength, source: "published Rust/Wasm generation -> renderer extraction V2" };
    await Promise.all([
      writeFile(path.join(workRecords, `${entry.id}.bwrd`), resourceBytes),
      writeFile(path.join(workRecords, `${entry.id}.bwrf`), frameBytes),
      writeFile(path.join(workRecords, `${entry.id}.json`), `${JSON.stringify(metadata, null, 2)}\n`),
    ]);
    let fixtureCheck: Readonly<Record<string, unknown>>;
    if (configuration.mode === "update-tracked-fixtures") {
      await Promise.all([
        writeFile(path.join(FIXTURES, `${entry.id}.bwrd`), resourceBytes),
        writeFile(path.join(FIXTURES, `${entry.id}.bwrf`), frameBytes),
        writeFile(path.join(FIXTURES, `${entry.id}.json`), `${JSON.stringify(metadata, null, 2)}\n`),
      ]);
      fixtureCheck = Object.freeze({ exact: true, updated: true });
    } else {
      fixtureCheck = await compareTrackedScene(entry, resourceBytes, frameBytes, metadata);
    }
    scenes.push({ entry, geometry, resources: resourceBytes, frame: frameBytes, chunkHash: chunk.chunkHash, metadata, fixtureCheck });
  }
  return { scenes, certificate, workRecords };
}

async function playwrightModule() {
  for (const candidate of ["playwright", path.join(os.homedir(), ".codex", "skills", "develop-web-game", "scripts", "node_modules", "playwright", "index.mjs")]) {
    try { return await import(candidate.startsWith("playwright") ? candidate : pathToFileURL(candidate).href); } catch { /* next */ }
  }
  throw new Error("Playwright is required for the R3 landscape gallery");
}

async function writeErrorPlaceholder(filePath: string, label: string) {
  const safeLabel = label.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const svg = Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#201416"/><text x="48" y="250" fill="#f2b8b5" font-family="monospace" font-size="22">${safeLabel}</text></svg>`);
  await sharp(svg).png().toFile(filePath);
}

async function imageMetrics(filePath: string) {
  const bytes = await readFile(filePath);
  const [metadata, stats] = await Promise.all([sharp(bytes).metadata(), sharp(bytes).stats()]);
  return Object.freeze({
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    channels: metadata.channels ?? null,
    entropy: stats.entropy,
    channelMeans: stats.channels.map((channel) => channel.mean),
  });
}

async function pixelComparison(leftPath: string, rightPath: string) {
  const [left, right] = await Promise.all([
    sharp(leftPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rightPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (left.info.width !== right.info.width || left.info.height !== right.info.height || left.info.channels !== right.info.channels) {
    return Object.freeze({
      comparable: false,
      left: left.info,
      right: right.info,
      error: "image dimensions or channel counts differ",
    });
  }
  let absolute = 0;
  let squared = 0;
  let maximum = 0;
  let changedPixels = 0;
  const channels = left.info.channels;
  const pixels = left.info.width * left.info.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    let changed = false;
    for (let channel = 0; channel < channels; channel += 1) {
      const index = pixel * channels + channel;
      const difference = Math.abs(left.data[index] - right.data[index]);
      absolute += difference;
      squared += difference * difference;
      maximum = Math.max(maximum, difference);
      changed ||= difference !== 0;
    }
    if (changed) changedPixels += 1;
  }
  const samples = pixels * channels;
  return Object.freeze({
    comparable: true,
    width: left.info.width,
    height: left.info.height,
    channels,
    meanAbsoluteError: absolute / Math.max(1, samples),
    rootMeanSquareError: Math.sqrt(squared / Math.max(1, samples)),
    maximumChannelError: maximum,
    changedPixels,
    changedPixelRatio: changedPixels / Math.max(1, pixels),
  });
}

function collectPageErrors(page: { on: (event: string, callback: (value: unknown) => void) => void }) {
  const errors: string[] = [];
  page.on("console", (value) => {
    const message = value as { type: () => string; text: () => string };
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (value) => errors.push(`pageerror: ${(value as Error).message}`));
  page.on("response", (value) => {
    const response = value as { status: () => number; url: () => string };
    if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
  });
  return errors;
}

export async function verifyRustGenerationLandscapesR3(argv = process.argv) {
  const configuration = parseR3LandscapeConfiguration(argv);
  const { scenes, certificate, workRecords } = await buildScenes(configuration);
  const threeOracleBundle = await buildThreeExtractionOracleBundleR3(configuration.repositoryRoot);
  await mkdir(configuration.outputDirectory, { recursive: true });
  const rendererManifest = JSON.parse(await readFile(path.join(ROOT, "public", "renderer", "manifest.json"), "utf8"));
  const runtime = rendererManifest.runtime;
  const sceneByPath = new Map<string, Uint8Array>();
  for (const scene of scenes) {
    sceneByPath.set(`/scene/${scene.entry.id}.bwrd`, scene.resources);
    sceneByPath.set(`/scene/${scene.entry.id}.bwrf`, scene.frame);
  }
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end(R3_LANDSCAPE_HARNESS_HTML); return; }
    if (pathname === "/three-extraction-oracle-r11.js") { response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }); response.end(threeOracleBundle); return; }
    if (pathname === "/three.module.js" || pathname === "/three.core.js") { const bytes = await readFile(path.join(ROOT, "node_modules", "three", "build", pathname.slice(1))); response.writeHead(200, { "content-type": "text/javascript" }); response.end(bytes); return; }
    const scene = sceneByPath.get(pathname); if (scene) { response.writeHead(200, { "content-type": "application/octet-stream" }); response.end(scene); return; }
    if (pathname.startsWith("/renderer/")) { const relative = pathname.slice("/renderer/".length); const rendererRoot = path.resolve(path.join(ROOT, "public", "renderer")); const target = path.resolve(rendererRoot, relative);
      if (target === rendererRoot || !target.startsWith(`${rendererRoot}${path.sep}`)) { response.writeHead(403).end(); return; }
      const bytes = await readFile(target); response.writeHead(200, { "content-type": target.endsWith(".wasm") ? "application/wasm" : target.endsWith(".js") ? "text/javascript" : "application/json" }); response.end(bytes); return; }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const reports: LandscapeReport[] = [];
  let browser: LandscapeBrowser | null = null;
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("gallery server failed to bind");
    const url = `http://127.0.0.1:${address.port}`;
    const playwright = await playwrightModule();
    const executable = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find(existsSync);
    browser = await playwright.chromium.launch({ headless: true, executablePath: executable, ignoreDefaultArgs: ["--disable-gpu"], args: ["--enable-gpu", "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--force-high-performance-gpu", "--use-angle=d3d11"] }) as LandscapeBrowser;
    for (const [index, scene] of scenes.entries()) {
      const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
      const errors = collectPageErrors(page);
      const threePath = path.join(configuration.outputDirectory, `${index + 1}-${scene.entry.id}-three.png`);
      let threeReport: unknown = null;
      try {
        await page.goto(url);
        threeReport = await page.evaluate(`(async()=>{ const m=await import('/three-extraction-oracle-r11.js');
          const canvas=document.querySelector('canvas');
          const resources=new Uint8Array(await (await fetch('/scene/${scene.entry.id}.bwrd')).arrayBuffer());
          const frame=new Uint8Array(await (await fetch('/scene/${scene.entry.id}.bwrf')).arrayBuffer());
          const report=m.renderThreeExtractionRecordsR3(canvas,resources,frame); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return report; })()`);
        await page.locator("canvas").screenshot({ path: threePath });
      } catch (error) {
        errors.push(`Three render: ${(error as Error).message}`);
        await writeErrorPlaceholder(threePath, `${scene.entry.id} Three render failed`);
      } finally {
        await page.close();
      }

      const wgpuPage = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
      const wgpuErrors = collectPageErrors(wgpuPage);
      const wgpuPath = path.join(configuration.outputDirectory, `${index + 1}-${scene.entry.id}-wgpu.png`);
      let wgpuReport: unknown = null;
      try {
        await wgpuPage.goto(url);
        wgpuReport = await wgpuPage.evaluate(`(async()=>{ if(!navigator.gpu)return {skipped:'navigator.gpu unavailable'}; const m=await import('/renderer/${runtime.module}'); await m.default({module_or_path:'/renderer/${runtime.wasm}'});
          const canvas=document.querySelector('canvas'); const surface=await m.create_blockwild_renderer(canvas.transferControlToOffscreen(),${WIDTH},${HEIGHT});
          const resources=new Uint8Array(await (await fetch('/scene/${scene.entry.id}.bwrd')).arrayBuffer()); const frame=new Uint8Array(await (await fetch('/scene/${scene.entry.id}.bwrf')).arrayBuffer());
          const applied=JSON.parse(surface.apply_resources(resources)); const rendered=JSON.parse(surface.render_frame(frame)); await new Promise(r=>setTimeout(r,120)); surface.shutdown(); surface.free(); return {applied,rendered}; })()`);
        if ((wgpuReport as { skipped?: string })?.skipped) errors.push(`wgpu: ${(wgpuReport as { skipped: string }).skipped}`);
        await wgpuPage.locator("canvas").screenshot({ path: wgpuPath });
      } catch (error) {
        errors.push(`wgpu render: ${(error as Error).message}`);
        await writeErrorPlaceholder(wgpuPath, `${scene.entry.id} wgpu render failed`);
      } finally {
        await wgpuPage.close();
      }
      errors.push(...wgpuErrors);
      if (scene.fixtureCheck.exact !== true) errors.push("generated scene record differs from the tracked fixture");
      const comparison = await pixelComparison(threePath, wgpuPath);
      if (!isR3RendererPixelParityWithinBounds(comparison)) {
        errors.push(`Three/wgpu pixel parity exceeded MAE ${R3_RENDERER_PARITY_MAX_MAE} or RMSE ${R3_RENDERER_PARITY_MAX_RMSE}`);
      }
      reports.push({
        id: scene.entry.id,
        caseIdentity: { seed: scene.entry.seed, chunk: scene.entry.chunk, focus: scene.entry.focus },
        chunkHash: scene.chunkHash,
        sceneRecords: {
          directory: relativePath(configuration.repositoryRoot, workRecords),
          resources: relativePath(configuration.repositoryRoot, path.join(workRecords, `${scene.entry.id}.bwrd`)),
          frame: relativePath(configuration.repositoryRoot, path.join(workRecords, `${scene.entry.id}.bwrf`)),
          metadata: relativePath(configuration.repositoryRoot, path.join(workRecords, `${scene.entry.id}.json`)),
          resourcesSha256: sha256(scene.resources),
          frameSha256: sha256(scene.frame),
          fixtureCheck: scene.fixtureCheck,
        },
        images: {
          three: relativePath(configuration.repositoryRoot, threePath),
          wgpu: relativePath(configuration.repositoryRoot, wgpuPath),
          metrics: {
            three: await imageMetrics(threePath),
            wgpu: await imageMetrics(wgpuPath),
            comparison,
          },
        },
        threeReport,
        wgpuReport,
        errors,
      });
    }
  } finally {
    if (browser) await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  const tiles: sharp.OverlayOptions[] = [];
  for (const [index, report] of reports.entries()) for (const [column, renderer] of (["three", "wgpu"] as const).entries()) {
    const imagePath = path.resolve(configuration.repositoryRoot, report.images[renderer]);
    const input = await sharp(imagePath).resize(600, 338).toBuffer();
    tiles.push({ input, left: column * 600, top: index * 382 });
    const label = Buffer.from(`<svg width="600" height="44"><rect width="100%" height="100%" fill="#0d1713"/><text x="18" y="18" fill="#eed17a" font-family="monospace" font-size="13">${scenes[index].entry.id} · ${renderer.toUpperCase()}</text><text x="18" y="35" fill="#a8bdb1" font-family="monospace" font-size="10">${scenes[index].entry.focus}</text></svg>`);
    tiles.push({ input: label, left: column * 600, top: index * 382 + 338 });
  }
  const contact = path.join(configuration.outputDirectory, "r3-landscape-three-wgpu-contact-sheet.png");
  await sharp({ create: { width: 1200, height: reports.length * 382, channels: 4, background: "#07100d" } }).composite(tiles).png().toFile(contact);
  const trackedContact = path.join(FIXTURES, "r3-landscape-three-wgpu-contact-sheet.png");
  const trackedContactComparison = configuration.mode === "check" && existsSync(trackedContact)
    ? await pixelComparison(trackedContact, contact)
    : null;
  const errors = reports.flatMap((report) => report.errors.map((error: string) => `${report.id}: ${error}`));
  const evidence = {
    schema: 2,
    createdAt: new Date().toISOString(),
    mode: configuration.mode,
    candidate: configuration.candidate,
    source: "validated content-addressed Rust/Wasm generation and shared BWRD/BWRF records",
    rendererContract: "RenderResourceBatchV2/RenderFrameV2",
    threeOracle: {
      implementation: "app/three-compat/renderer-extraction-oracle-r11.ts#ThreeExtractionOracleR11",
      browserBundleSha256: sha256(Buffer.from(threeOracleBundle)),
      input: "the same served BWRD/BWRF bytes used by wgpu",
    },
    artifact: {
      variant: configuration.artifact.variant,
      hash: configuration.artifact.hash,
      publicDirectory: relativePath(configuration.repositoryRoot, configuration.publicEngineDirectory),
      selectedPath: relativePath(configuration.repositoryRoot, configuration.artifact.directory),
      sourceSnapshot: configuration.artifact.sourceSnapshot,
    },
    certificate,
    caseIdentities: scenes.map((scene) => ({ id: scene.entry.id, seed: scene.entry.seed, chunk: scene.entry.chunk, focus: scene.entry.focus })),
    images: {
      contactSheet: relativePath(configuration.repositoryRoot, contact),
      contactSheetMetrics: await imageMetrics(contact),
      trackedContactComparison,
    },
    reports,
    errors,
    assertions: {
      completeArtifactAndSourceSnapshotValidated: true,
      exactArtifactHash: true,
      exact155CaseCertificate: true,
      exactFiveLandscapeCaseIdentities: true,
      threeUsesAppExtractionOracleR11: reports.every((report) => (report.threeReport as { renderer?: unknown })?.renderer === "ThreeExtractionOracleR11"),
      rendererPixelParityWithinBounds: reports.every((report) => isR3RendererPixelParityWithinBounds(report.images.metrics.comparison)),
      candidateEvidenceOnly: !configuration.candidate || configuration.mode === "check",
      trackedFixturesUpdated: configuration.mode === "update-tracked-fixtures",
    },
  };
  if (configuration.mode === "update-tracked-fixtures") {
    await writeFile(trackedContact, await readFile(contact));
    await writeFile(path.join(FIXTURES, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  await writeFile(path.join(configuration.outputDirectory, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ scenes: reports.length, contact, artifactHash: configuration.artifact.hash, sourceDigest: configuration.artifact.sourceSnapshot.digest, certificate, errors }, null, 2)}\n`);
  if (errors.length > 0) {
    throw new RustEngineToolError(`R3 landscape ${configuration.mode} recorded ${errors.length} error(s); inspect ${path.join(configuration.outputDirectory, "evidence.json")}.`);
  }
  return evidence;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await verifyRustGenerationLandscapesR3();
  } catch (error) {
    process.stderr.write(`R3 landscape verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
