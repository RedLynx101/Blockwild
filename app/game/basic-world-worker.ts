import { buildBasicWorldGeometry, type BasicWorldGeometryRequest } from "./basic-world-geometry";
import { ChunkWorld, type WorldGenerationOptions } from "./world";

type WorkerRequest = Readonly<{
  id: number;
  seedText: string;
  generationOptions: Partial<WorldGenerationOptions>;
  request: BasicWorldGeometryRequest;
}>;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, seedText, generationOptions, request } = event.data;
  // Explicit opt-in compatibility oracle. These silhouettes are presentation
  // only and never attest or participate in production worldgen authority.
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  world.reset(seedText, undefined, generationOptions);
  const geometry = buildBasicWorldGeometry(request, (x, z) => world.sampleColumn(x, z));
  world.dispose();
  self.postMessage({ id, geometry }, { transfer: [
    geometry.surfacePositions.buffer,
    geometry.surfaceColors.buffer,
    geometry.surfaceIndices.buffer,
    geometry.cavePositions.buffer,
    geometry.caveColors.buffer,
    geometry.caveIndices.buffer,
  ] });
};
