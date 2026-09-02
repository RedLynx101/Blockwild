import assert from "node:assert/strict";
import test from "node:test";
import { ChunkMemoryCache, type CachedChunkData } from "../app/game/chunk-cache.ts";

const fixture = (cacheKey: string, cells: number): CachedChunkData => ({
  cacheKey,
  key: cacheKey,
  cx: 0,
  cz: 0,
  blocks: new Uint16Array(cells),
  heightmap: new Int16Array([47]),
  biomes: new Uint8Array([6]),
  sectionBlockCounts: new Uint16Array(1),
  skyTops: new Int16Array(1),
  light: new Uint16Array(cells),
  lightInitialized: true,
  lightIndices: [],
  leafIndices: [],
  structureMarkers: [["poi:test", {
    type: "landmark",
    id: "poi:test",
    position: { x: 1, y: 40, z: 1 },
    tag: "adventure-poi:test",
    mapLayer: "surface",
  }]],
});

test("column peeks are namespace-exact, bounded, and do not transfer cache ownership", () => {
  const cache = new ChunkMemoryCache();
  assert.equal(cache.set(fixture("terrain-v5|exact", 4)), true);
  assert.deepEqual(cache.peekColumn("terrain-v5|exact", 0), { height: 47, biome: 6 });
  assert.equal(cache.peekColumn("terrain-v5|stale", 0), undefined);
  assert.equal(cache.peekColumn("terrain-v5|exact", -1), undefined);
  assert.equal(cache.peekColumn("terrain-v5|exact", 1), undefined);
  assert.equal(cache.size, 1);
  assert.deepEqual(cache.diagnostics(), { entries: 1, bytes: cache.byteLength, hits: 0, misses: 0, evictions: 0 });
  assert.equal(cache.take("terrain-v5|exact")?.heightmap[0], 47, "take must still transfer the original record exactly once");
  assert.equal(cache.take("terrain-v5|exact"), undefined);
  assert.equal(cache.size, 0);
});

test("chunk memory cache is byte bounded, LRU ordered, and ownership transferring", () => {
  const cache = new ChunkMemoryCache(350);
  assert.equal(cache.set(fixture("a", 4)), true);
  assert.equal(cache.set(fixture("b", 4)), true);
  assert.equal(cache.size, 1, "the least-recent entry is evicted when the byte budget is exceeded");
  assert.equal(cache.take("a"), undefined);
  const restored = cache.take("b");
  assert.equal(restored?.cacheKey, "b");
  assert.equal(restored?.structureMarkers[0]?.[1].type, "landmark");
  assert.equal(cache.size, 0);
  assert.deepEqual(cache.diagnostics(), { entries: 0, bytes: 0, hits: 1, misses: 1, evictions: 1 });
});
