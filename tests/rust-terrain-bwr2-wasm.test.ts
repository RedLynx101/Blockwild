import assert from "node:assert/strict";
import test from "node:test";
import { readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { BLOCKS, BlockId } from "../app/game/data.ts";
import {
  TERRAIN_SECTION_HALO_CELL_COUNT_V1,
  TERRAIN_SECTION_HALO_COLUMN_COUNT_V1,
  TerrainFluidFlagV1,
  createSectionSnapshotV1,
  haloCellIndexV1,
} from "../app/game/terrain-mesh-contract.ts";
import {
  decodeRustTerrainWireResponseV1,
  encodeSectionSnapshotWireV1,
  encodeTerrainMaterialRegistryWireV2,
} from "../app/game/rust-terrain-mesh-codec.ts";
import { canonicalTerrainMaterialRegistryV2 } from "../app/game/terrain-material-registry.ts";
import {
  resolveRustEngineTestDefaultArtifact,
  resolveRustEngineTestIndexRoot,
} from "./helpers/rust-engine-test-artifact.ts";

type WasmTerrainModule = Readonly<{
  default(input: { module_or_path: Uint8Array }): Promise<unknown>;
  blockwild_world_mesh_section_v1(snapshot: Uint8Array, registry: Uint8Array): Uint8Array;
}>;

async function loadPublishedTerrainWasm() {
  const root = resolve(import.meta.dirname, "..");
  const { artifactDirectory, hash } = await resolveRustEngineTestDefaultArtifact(root);
  const wasmModule = await import(`${pathToFileURL(resolve(artifactDirectory, "engine.js")).href}?test=${Date.now()}`) as WasmTerrainModule;
  await wasmModule.default({ module_or_path: new Uint8Array(await readFile(resolve(artifactDirectory, "engine_bg.wasm"))) });
  return { wasmModule, hash };
}

function currentContentSnapshot(contentHash: string) {
  const blocks = new Uint16Array(TERRAIN_SECTION_HALO_CELL_COUNT_V1);
  const light = new Uint16Array(TERRAIN_SECTION_HALO_CELL_COUNT_V1);
  const facing = new Uint8Array(TERRAIN_SECTION_HALO_CELL_COUNT_V1);
  const hidden = new Uint8Array(TERRAIN_SECTION_HALO_CELL_COUNT_V1);
  const fluidLevel = new Uint8Array(TERRAIN_SECTION_HALO_CELL_COUNT_V1);
  const fluidFlags = new Uint8Array(TERRAIN_SECTION_HALO_CELL_COUNT_V1);
  const biomes = new Uint8Array(TERRAIN_SECTION_HALO_COLUMN_COUNT_V1);
  const definitions = Object.values(BLOCKS).filter((definition) => definition.id !== BlockId.Air);
  for (const [ordinal, definition] of definitions.entries()) {
    const x = ordinal & 15;
    const z = (ordinal >>> 4) & 15;
    const y = ordinal >>> 8;
    const index = haloCellIndexV1(x, y, z);
    blocks[index] = definition.id;
    facing[index] = ordinal & 3;
    if (definition.liquid || definition.waterlogged) {
      fluidFlags[index] = TerrainFluidFlagV1.Present | TerrainFluidFlagV1.Source
        | (definition.waterlogged ? TerrainFluidFlagV1.Waterlogged : 0);
    }
  }
  return createSectionSnapshotV1({
    contentHash,
    address: { universeId: "r2", locationId: "seed:4276993775", chunkX: -1, chunkZ: 2, sectionY: -4 },
    revision: { section: 1, halo: 1, lighting: 1 },
    streams: { blocks, light, facing, hidden, fluidLevel, fluidFlags, biomes },
  });
}

test("published Wasm accepts one BWR2 section containing every current block and fails unknown IDs closed", async () => {
  const registry = canonicalTerrainMaterialRegistryV2();
  const registryBytes = encodeTerrainMaterialRegistryWireV2(registry);
  const { wasmModule, hash } = await loadPublishedTerrainWasm();
  const snapshot = currentContentSnapshot(registry.contentHash);
  const response = decodeRustTerrainWireResponseV1(wasmModule.blockwild_world_mesh_section_v1(
    encodeSectionSnapshotWireV1(snapshot), registryBytes,
  ));
  assert.equal(response.kind, "mesh", `artifact ${hash} did not accept current BWR2 content`);
  if (response.kind === "mesh") {
    assert.equal(response.packet.sourceSnapshotHash, snapshot.snapshotHash);
    assert.deepEqual(response.packet.layers.map((layer) => layer.layer), [
      "opaque", "cutout", "emissive", "translucentSolid", "water", "transparent", "glass",
    ]);
  }

  const unknown = currentContentSnapshot(registry.contentHash);
  unknown.streams.blocks[haloCellIndexV1(15, 15, 15)] = 601;
  const refreshed = createSectionSnapshotV1({
    contentHash: unknown.contentHash,
    address: unknown.address,
    revision: { section: 2, halo: 2, lighting: 2 },
    streams: unknown.streams,
  });
  const fallback = decodeRustTerrainWireResponseV1(wasmModule.blockwild_world_mesh_section_v1(
    encodeSectionSnapshotWireV1(refreshed), registryBytes,
  ));
  assert.equal(fallback.kind, "ineligible");
  if (fallback.kind === "ineligible") assert.equal(fallback.blockId, 601);
});

test("Wasm candidate override admits only the isolated locator and schema candidate indexes", async () => {
  const root = resolve(import.meta.dirname, "..");
  assert.deepEqual(await resolveRustEngineTestIndexRoot(root, null), {
    directory: await realpath(resolve(root, "public/engine")),
    overridden: false,
  });
  await assert.rejects(() => resolveRustEngineTestIndexRoot(root, ""), /non-empty directory/);
  await assert.rejects(() => resolveRustEngineTestIndexRoot(root, "public/engine"), /engine-locator-candidate/);
  await assert.rejects(() => resolveRustEngineTestIndexRoot(root, "public"), /engine-locator-candidate/);
  await assert.rejects(() => resolveRustEngineTestIndexRoot(root, "tests"), /engine-locator-candidate/);
  await assert.rejects(
    () => resolveRustEngineTestIndexRoot(root, "public/engine-locator-candidate/../engine"),
    /engine-locator-candidate/,
  );
  for (const rejected of ["public/engine-schema-candidate/../engine", "public/engine-schema-candidate/nested", "public/engine-unlisted-candidate"]) {
    await assert.rejects(() => resolveRustEngineTestIndexRoot(root, rejected), /engine-schema-candidate/);
  }
  for (const name of ["engine-locator-candidate", "engine-schema-candidate"]) {
    if (existsSync(resolve(root, "public", name))) {
      assert.deepEqual(await resolveRustEngineTestIndexRoot(root, `public/${name}`), {
        directory: await realpath(resolve(root, "public", name)), overridden: true,
      });
    } else {
      await assert.rejects(() => resolveRustEngineTestIndexRoot(root, `public/${name}`), /existing directory/);
    }
  }
});
