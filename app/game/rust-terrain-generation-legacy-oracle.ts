import {
  decodeTerrainGenerationEditsV2,
  legacyTerrainGeneratorHashV2,
  type GeneratedChunkV2Payload,
  type GenerateChunkRequestV2,
} from "./terrain-generation-contract";
import { CHUNK_SIZE, ChunkWorld, GENERATOR_VERSION, type WorldGenerationOptions } from "./world";

/**
 * Temporary byte-exact R3 compatibility oracle.
 *
 * Promotion constraint: world.ts still couples generation state to ChunkWorld,
 * whose constructor owns Three.js scene objects. The worker and backend
 * contracts are renderer-free, but this isolated adapter cannot be removed
 * until the generator implementation itself is extracted. Keeping the legacy
 * construction here preserves current blocks, light and POI bytes meanwhile.
 */
export function generateChunkWithLegacyOracleV2(request: GenerateChunkRequestV2): GeneratedChunkV2Payload {
  const expectedGeneratorHash = legacyTerrainGeneratorHashV2(`g${GENERATOR_VERSION}`);
  if (request.generatorHash !== expectedGeneratorHash) {
    throw new Error(`Generator hash does not match TypeScript generator v${GENERATOR_VERSION}`);
  }
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  try {
    const edits = decodeTerrainGenerationEditsV2(request.edits);
    const savedEdits = edits.length
      ? { [request.key]: edits.map(([index, type]) => [index, type] as [number, number]) }
      : undefined;
    world.reset(request.seedText, savedEdits, request.generationOptions as Partial<WorldGenerationOptions>);
    const chunk = world.generateChunk(request.cx, request.cz);
    const structureMarkers = [...world.structureMarkers.entries()].filter(([, marker]) => (
      Math.floor(marker.position.x / CHUNK_SIZE) === chunk.cx
      && Math.floor(marker.position.z / CHUNK_SIZE) === chunk.cz
    ));
    return {
      key: chunk.key,
      cx: chunk.cx,
      cz: chunk.cz,
      blocks: chunk.blocks,
      heightmap: chunk.heightmap,
      biomes: chunk.biomes,
      sectionBlockCounts: chunk.sectionBlockCounts,
      skyTops: chunk.skyTops,
      light: chunk.light,
      lightIndices: [...chunk.lightIndices],
      leafIndices: [...chunk.leafIndices],
      structureMarkers,
    };
  } finally {
    world.dispose();
  }
}
