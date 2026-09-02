import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDirectionallyPlacedBlock } from "../app/game/block-facing.ts";
import { BLOCKS, BlockId } from "../app/game/data.ts";
import { canonicalTerrainMaterialRegistryV2 } from "../app/game/terrain-material-registry.ts";
import {
  decodeRustTerrainWireResponseV1,
  encodeSectionSnapshotWireV1,
  encodeTerrainMaterialRegistryWireV2,
} from "../app/game/rust-terrain-mesh-codec.ts";
import { CHUNK_SIZE, ChunkWorld, MIN_Y, SECTION_HEIGHT, blockIndex } from "../app/game/world.ts";
import type { MeshPacketV1, SectionSnapshotV1 } from "../app/game/terrain-mesh-contract.ts";

type Bucket = Record<"positions" | "normals" | "colors" | "lights" | "emissions" | "occlusions" | "uvs" | "indices", number[]>;
type Buckets = Record<"opaque" | "cutout" | "emissive" | "translucentSolid" | "water" | "transparent" | "glass", Bucket>;
type Chunk = ReturnType<ChunkWorld["generateChunk"]>;
type WorldHarness = {
  generateChunk(cx: number, cz: number): Chunk;
  rebuildSection(chunk: Chunk, section: number, slice: { buckets: Buckets; startLocalX: number; endLocalX: number; finalize: boolean }): void;
  createRustTerrainSnapshot(chunk: Chunk, section: number): SectionSnapshotV1;
  createTypeScriptTerrainPacket(snapshot: SectionSnapshotV1, buckets: Buckets): MeshPacketV1;
  firstRustTerrainPacketDifference(reference: MeshPacketV1, rust: MeshPacketV1): unknown;
  blockFacings: Map<string, number>;
  setBlockFacing(x: number, y: number, z: number, facing: 0 | 1 | 2 | 3): unknown;
  setLiquidCellProvider(provider: ((x: number, y: number, z: number) => Readonly<{ level: number; source?: boolean; falling?: boolean }> | undefined) | undefined): void;
  dispose(): void;
};
type WasmModule = Readonly<{
  default(input: { module_or_path: Uint8Array }): Promise<unknown>;
  blockwild_world_mesh_section_v1(snapshot: Uint8Array, registry: Uint8Array): Uint8Array;
}>;

const layers = ["opaque", "cutout", "emissive", "translucentSolid", "water", "transparent", "glass"] as const;
const emptyBuckets = () => Object.fromEntries(layers.map((layer) => [layer, {
  positions: [], normals: [], colors: [], lights: [], emissions: [], occlusions: [], uvs: [], indices: [],
}])) as unknown as Buckets;

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function publishedWasm() {
  const root = resolve(import.meta.dirname, "..");
  const index = JSON.parse(await readFile(resolve(root, "public/engine/manifest.json"), "utf8"));
  const hash = index.artifacts[index.defaultVariant].hash as string;
  const directory = resolve(root, "public/engine", hash);
  const wasmModule = await import(`${pathToFileURL(resolve(directory, "engine.js")).href}?r2=${Date.now()}`) as WasmModule;
  await wasmModule.default({ module_or_path: new Uint8Array(await readFile(resolve(directory, "engine_bg.wasm"))) });
  return { wasmModule, hash };
}

async function main() {
  const started = performance.now();
  const registry = canonicalTerrainMaterialRegistryV2();
  const registryBytes = encodeTerrainMaterialRegistryWireV2(registry);
  const { wasmModule, hash } = await publishedWasm();
  // R2 differential reference oracle. This verifier compares Rust meshing to
  // an explicitly named TypeScript terrain source; it is not worldgen proof.
  const world = new ChunkWorld({
    rustTerrainMode: "off",
    terrainGenerationAuthorityMode: "typescript",
  }) as unknown as WorldHarness;
  const chunk = world.generateChunk(0, 0);
  const section = Math.floor((0 - MIN_Y) / SECTION_HEIGHT);
  const mismatches: unknown[] = [];
  const wasmDurations: number[] = [];
  let exact = 0;
  let scenarioExact = 0;
  let scenarioCount = 0;
  const resetChunk = (target: typeof chunk) => {
    target.blocks.fill(BlockId.Air);
    target.light.fill(0);
    target.biomes.fill(0);
    target.sectionBlockCounts.fill(0);
  };
  const comparePrepared = (label: string, target: typeof chunk, targetSection: number) => {
    const buckets = emptyBuckets();
    world.rebuildSection(target, targetSection, { buckets, startLocalX: 0, endLocalX: CHUNK_SIZE, finalize: false });
    const snapshot = world.createRustTerrainSnapshot(target, targetSection);
    const reference = world.createTypeScriptTerrainPacket(snapshot, buckets);
    const wasmStarted = performance.now();
    const response = decodeRustTerrainWireResponseV1(wasmModule.blockwild_world_mesh_section_v1(
      encodeSectionSnapshotWireV1(snapshot), registryBytes,
    ));
    wasmDurations.push(performance.now() - wasmStarted);
    if (response.kind !== "mesh") return { label, response };
    if (response.packet.packetHash === reference.packetHash) return null;
    const difference = world.firstRustTerrainPacketDifference(reference, response.packet) as Readonly<{
      field?: string;
      index?: number;
    }> | null;
    const vertexIndex = difference?.field === "streams.occlusions" || difference?.field === "streams.emissions"
      || difference?.field === "streams.lights" ? difference.index : undefined;
    return {
      label,
      reference: reference.packetHash,
      rust: response.packet.packetHash,
      difference,
      ...(vertexIndex === undefined || vertexIndex < 0 ? {} : {
        vertexContext: {
          index: vertexIndex,
          position: Array.from(reference.streams.positions.slice(vertexIndex * 3, vertexIndex * 3 + 3)),
          normal: Array.from(reference.streams.normals.slice(vertexIndex * 3, vertexIndex * 3 + 3)),
          color: Array.from(reference.streams.colors.slice(vertexIndex * 3, vertexIndex * 3 + 3)),
          uv: Array.from(reference.streams.uvs.slice(vertexIndex * 2, vertexIndex * 2 + 2)),
          nearbyPositions: Array.from({ length: 17 }, (_, offset) => {
            const index = Math.max(0, vertexIndex - 8) + offset;
            return Array.from(reference.streams.positions.slice(index * 3, index * 3 + 3));
          }),
          referenceOcclusions: Array.from(reference.streams.occlusions.slice(Math.max(0, vertexIndex - 8), vertexIndex + 9)),
          rustOcclusions: Array.from(response.packet.streams.occlusions.slice(Math.max(0, vertexIndex - 8), vertexIndex + 9)),
        },
      }),
    };
  };
  try {
    for (let naturalSection = 0; naturalSection < chunk.sectionBlockCounts.length; naturalSection += 1) {
      if (chunk.sectionBlockCounts[naturalSection] === 0) continue;
      scenarioCount += 1;
      const mismatch = comparePrepared(`natural-generated-section:${naturalSection}`, chunk, naturalSection);
      if (mismatch) mismatches.push(mismatch); else scenarioExact += 1;
    }
    for (const definition of Object.values(BLOCKS).sort((left, right) => left.id - right.id)) {
      if (definition.id === BlockId.Air) continue;
      resetChunk(chunk);
      chunk.blocks[blockIndex(8, 0, 8)] = definition.id;
      chunk.sectionBlockCounts[section] = 1;
      world.blockFacings.clear();
      if (isDirectionallyPlacedBlock(definition.id)) world.setBlockFacing(8, 0, 8, (definition.id & 3) as 0 | 1 | 2 | 3);
      const mismatch = comparePrepared(`block:${definition.id}:${definition.name}`, chunk, section);
      if (mismatch) mismatches.push(mismatch);
      else exact += 1;
    }

    resetChunk(chunk);
    for (const [ordinal, definition] of Object.values(BLOCKS)
      .filter((value) => value.id !== BlockId.Air)
      .sort((left, right) => left.id - right.id)
      .entries()) {
      const x = ordinal & 15;
      const z = (ordinal >>> 4) & 15;
      const y = ordinal >>> 8;
      chunk.blocks[blockIndex(x, y, z)] = definition.id;
      chunk.sectionBlockCounts[section] += 1;
      chunk.light[blockIndex(x, y, z)] = ((ordinal & 15) << 12) | ((ordinal * 13) & 0x0fff);
      chunk.biomes[x + z * CHUNK_SIZE] = ordinal % 24;
      if (isDirectionallyPlacedBlock(definition.id)) world.setBlockFacing(x, y, z, (ordinal & 3) as 0 | 1 | 2 | 3);
    }
    scenarioCount += 1;
    const denseMismatch = comparePrepared("dense-all-current-gallery", chunk, section);
    if (denseMismatch) mismatches.push(denseMismatch); else scenarioExact += 1;

    const right = world.generateChunk(1, 0);
    resetChunk(chunk);
    resetChunk(right);
    for (const [y, block] of [[0, BlockId.Water], [1, BlockId.Glass], [2, BlockId.WildwoodLeaves], [3, BlockId.WildwoodFence]] as const) {
      chunk.blocks[blockIndex(15, y, 8)] = block;
      right.blocks[blockIndex(0, y, 8)] = block;
      chunk.sectionBlockCounts[section] += 1;
      right.sectionBlockCounts[section] += 1;
    }
    for (const [label, target] of [["cross-chunk-left", chunk], ["cross-chunk-right", right]] as const) {
      scenarioCount += 1;
      const mismatch = comparePrepared(label, target, section);
      if (mismatch) mismatches.push(mismatch); else scenarioExact += 1;
    }

    resetChunk(chunk);
    const upperSection = section + 1;
    for (const [x, block] of [[5, BlockId.Water], [7, BlockId.Glass], [9, BlockId.LumenKelp], [11, BlockId.CaptureOrbRack]] as const) {
      chunk.blocks[blockIndex(x, 15, 8)] = block;
      chunk.blocks[blockIndex(x, 16, 8)] = block;
      chunk.sectionBlockCounts[section] += 1;
      chunk.sectionBlockCounts[upperSection] += 1;
    }
    for (const [label, targetSection] of [["cross-section-lower", section], ["cross-section-upper", upperSection]] as const) {
      scenarioCount += 1;
      const mismatch = comparePrepared(label, chunk, targetSection);
      if (mismatch) mismatches.push(mismatch); else scenarioExact += 1;
    }

    resetChunk(chunk);
    const fluidLevels = new Map<string, Readonly<{ level: number; source?: boolean; falling?: boolean }>>();
    for (const [x, level, falling] of [[4, 0, false], [5, 3, false], [6, 7, false], [7, 7, true]] as const) {
      chunk.blocks[blockIndex(x, 0, 8)] = BlockId.Water;
      chunk.sectionBlockCounts[section] += 1;
      fluidLevels.set(`${x},0,8`, { level, source: level === 0, falling });
    }
    world.setLiquidCellProvider((x, y, z) => fluidLevels.get(`${x},${y},${z}`));
    scenarioCount += 1;
    const fluidMismatch = comparePrepared("flowing-fluid-levels", chunk, section);
    if (fluidMismatch) mismatches.push(fluidMismatch); else scenarioExact += 1;
    world.setLiquidCellProvider(undefined);
  } finally {
    world.dispose();
  }
  wasmDurations.sort((left, right) => left - right);
  const percentile = (fraction: number) => wasmDurations[
    Math.min(wasmDurations.length - 1, Math.max(0, Math.ceil(wasmDurations.length * fraction) - 1))
  ] ?? 0;
  const result = {
    schema: 1,
    artifactHash: hash,
    registryHash: registry.contentHash,
    currentDefinitions: Object.keys(BLOCKS).length,
    testedVisibleDefinitions: Object.keys(BLOCKS).length - 1,
    exact,
    scenarioExact,
    scenarioCount,
    mismatchCount: mismatches.length,
    mismatches,
    wasmTimingMilliseconds: {
      samples: wasmDurations.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      maximum: wasmDurations.at(-1) ?? 0,
    },
    elapsedMilliseconds: performance.now() - started,
  };
  const output = argument("--output");
  if (output) {
    const path = resolve(output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (mismatches.length) process.exitCode = 1;
}

await main();
