import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ChunkWorld, type Chunk } from "../app/game/world.ts";

type ScheduledLookahead = { scheduledLookaheadChunkX: number; scheduledLookaheadChunkZ: number };
const scheduled = (world: ChunkWorld) => world as unknown as ScheduledLookahead;
const queueKeys = (world: ChunkWorld) => world.generationQueue.map(entry => `${entry.cx},${entry.cz}`);

/** Exercise the real scheduler and comparator without generating, lighting, or meshing terrain. */
function schedulerWorld(context: TestContext) {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  context.after(() => world.dispose());
  world.reset("STREAMING-LOOKAHEAD-REGRESSION", undefined, { structures: false });
  Object.assign(world, {
    releaseOrphanedSeamPresentationBlockers: () => {},
    playerChunkStreamingState: () => ({ playerChunkStage: "ready" }),
    immediateRingWorkState: () => null,
    processGenerationSlice: () => false,
    processLightingSlice: () => false,
    processMesh: () => false,
    processConsolidation: () => false,
    recordPlayerReadiness: () => {},
  });
  world.scheduleAround(8, 8, true, 40);
  const original = world.scheduleAround.bind(world);
  let calls = 0;
  world.scheduleAround = (...args: Parameters<ChunkWorld["scheduleAround"]>) => { calls += 1; return original(...args); };
  return { world, calls: () => calls };
}

function assertEastFirst(world: ChunkWorld, east: boolean) {
  const eastIndex = world.generationQueue.findIndex(entry => entry.cx === 2 && entry.cz === 0);
  const westIndex = world.generationQueue.findIndex(entry => entry.cx === -2 && entry.cz === 0);
  assert(eastIndex >= 0 && westIndex >= 0, "symmetric pending chunks must remain in the generation queue");
  // The production generation worker pops from the end of the sorted queue.
  assert.equal(eastIndex > westIndex, east, "lookahead must change real pending-work priority before a chunk crossing");
}

test("starting movement inside the same chunk immediately reschedules toward the discrete lookahead", context => {
  const { world, calls } = schedulerWorld(context);
  const stationaryQueue = world.generationQueue;
  world.update(8.25, 8, 40, 4, 0);
  assert.equal(calls(), 1);
  assert.notEqual(world.generationQueue, stationaryQueue, "the scheduleAround guard must admit the new lookahead");
  assert.deepEqual([world.playerChunkX, world.playerChunkZ], [0, 0]);
  assert.deepEqual([world.streamingLookaheadChunkX, world.streamingLookaheadChunkZ], [1, 0]);
  assert.deepEqual([scheduled(world).scheduledLookaheadChunkX, scheduled(world).scheduledLookaheadChunkZ], [1, 0]);
  assertEastFirst(world, true);
  assert.equal(world.chunks.size, 0, "regression test must not generate terrain");
});

test("same-cell speed and subpixel direction changes do not repeatedly sort pending work", context => {
  const { world, calls } = schedulerWorld(context);
  world.update(8.25, 8, 40, 4, 0);
  const movingQueue = world.generationQueue; const order = queueKeys(world);
  world.update(8.5, 8, 40, 8, 0);
  world.update(8.75, 8.1, 40, 4, 0.1);
  assert.equal(calls(), 1, "raw velocity changes inside the same rounded lookahead cell are not invalidations");
  assert.equal(world.generationQueue, movingQueue);
  assert.deepEqual(queueKeys(world), order);
  assert.deepEqual([scheduled(world).scheduledLookaheadChunkX, scheduled(world).scheduledLookaheadChunkZ], [1, 0]);
});

test("direction reversal reprioritizes pending work before crossing a chunk boundary", context => {
  const { world, calls } = schedulerWorld(context);
  world.update(8.25, 8, 40, 4, 0); assertEastFirst(world, true);
  const eastQueue = world.generationQueue;
  world.update(8.2, 8, 40, -4, 0);
  assert.equal(calls(), 2);
  assert.notEqual(world.generationQueue, eastQueue);
  assert.deepEqual([world.playerChunkX, world.playerChunkZ], [0, 0]);
  assert.deepEqual([scheduled(world).scheduledLookaheadChunkX, scheduled(world).scheduledLookaheadChunkZ], [-1, 0]);
  assertEastFirst(world, false);
  const westQueue = world.generationQueue;
  world.update(8.1, 8, 40, -8, 0);
  assert.equal(calls(), 2); assert.equal(world.generationQueue, westQueue);
});

test("stopping movement restores stationary ordering once without waiting for periodic scheduling", context => {
  const { world, calls } = schedulerWorld(context);
  const stationaryOrder = queueKeys(world);
  world.update(8.1, 8, 40, 4, 0);
  world.update(8.1, 8, 40, 0, 0);
  assert.equal(calls(), 2);
  assert.deepEqual([scheduled(world).scheduledLookaheadChunkX, scheduled(world).scheduledLookaheadChunkZ], [0, 0]);
  assert.deepEqual(queueKeys(world), stationaryOrder);
  const stoppedQueue = world.generationQueue;
  world.update(8.1, 8, 40, 0.2, 0.1);
  assert.equal(calls(), 2, "below-threshold velocity remains the stationary bucket");
  assert.equal(world.generationQueue, stoppedQueue);
});

test("changing lookahead reach and its Z component invalidates the same-chunk schedule", context => {
  const { world, calls } = schedulerWorld(context);
  world.update(8, 8, 40, 4, 0);
  world.update(8, 8, 40, 10, 0);
  assert.equal(calls(), 2);
  assert.deepEqual([scheduled(world).scheduledLookaheadChunkX, scheduled(world).scheduledLookaheadChunkZ], [2, 0]);
  world.update(8, 8, 40, 0, 4);
  assert.equal(calls(), 3);
  assert.deepEqual([scheduled(world).scheduledLookaheadChunkX, scheduled(world).scheduledLookaheadChunkZ], [0, 1]);
  world.update(8, 8, 40, 0, -4);
  assert.equal(calls(), 4);
  assert.deepEqual([scheduled(world).scheduledLookaheadChunkX, scheduled(world).scheduledLookaheadChunkZ], [0, -1]);
});

test("scheduleAround independently admits changed lookahead and snapshots only effective schedules", context => {
  const { world } = schedulerWorld(context);
  const stationaryQueue = world.generationQueue;
  world.streamingLookaheadChunkX = 1;
  world.scheduleAround(8, 8, false, 40);
  assert.notEqual(world.generationQueue, stationaryQueue, "the schedule guard must not discard an invalidated lookahead");
  assertEastFirst(world, true);
  const movingQueue = world.generationQueue;
  world.scheduleAround(8.25, 8.25, false, 40);
  assert.equal(world.generationQueue, movingQueue, "unchanged anchor must retain the fast path");
});

test("reset clears prior-world velocity lookahead and invalidates both scheduled anchors", context => {
  const { world } = schedulerWorld(context);
  world.update(8, 8, 40, 4, -4);
  world.reset("STREAMING-LOOKAHEAD-NEXT-WORLD", undefined, { structures: false });
  assert.deepEqual([world.streamingLookaheadChunkX, world.streamingLookaheadChunkZ], [0, 0]);
  assert(Number.isNaN(scheduled(world).scheduledLookaheadChunkX));
  assert(Number.isNaN(scheduled(world).scheduledLookaheadChunkZ));
  world.scheduleAround(8, 8, false, 40);
  assert.deepEqual([scheduled(world).scheduledLookaheadChunkX, scheduled(world).scheduledLookaheadChunkZ], [0, 0]);
});

test("lookahead anchors preserve chunk, height, and camera-sector invalidations", context => {
  const { world, calls } = schedulerWorld(context);
  world.update(8, 8, 40, 0, 0);
  assert.equal(calls(), 0);
  world.update(8, 8, 56, 0, 0); assert.equal(calls(), 1);
  world.streamingViewSector += 1;
  world.update(8, 8, 56, 0, 0); assert.equal(calls(), 2);
  world.update(16.25, 8, 56, 0, 0); assert.equal(calls(), 3);
  assert.deepEqual([world.playerChunkX, world.playerChunkZ], [1, 0]);
});

test("the existing 180-frame refresh rebuilds unchanged scheduling and applies bounded aging", context => {
  const { world, calls } = schedulerWorld(context);
  const oldQueue = world.generationQueue;
  world.generationEnqueuedAt.set("4,0", performance.now() - 100_000);
  world.frame = 179;
  world.update(8, 8, 40, 0, 0);
  assert.equal(calls(), 1);
  assert.notEqual(world.generationQueue, oldQueue, "periodic refresh must bypass the unchanged-anchor guard");
  const agedIndex = world.generationQueue.findIndex(entry => entry.cx === 4 && entry.cz === 0);
  const freshIndex = world.generationQueue.findIndex(entry => entry.cx === 2 && entry.cz === 0);
  assert(agedIndex > freshIndex, "the bounded periodic refresh must recompute aging priority");
  assert.equal(world.generationQueue.at(-1)?.cx, 0, "aging must not overtake the occupied chunk");
  assert.equal(world.generationQueue.at(-1)?.cz, 0);
  const refreshedQueue = world.generationQueue;
  world.update(8, 8, 40, 0, 0);
  assert.equal(calls(), 1); assert.equal(world.generationQueue, refreshedQueue);
});

function deferPersistentRead(world: ChunkWorld) {
  let resolve!: (value: undefined) => void; let reject!: (error: Error) => void;
  const pending = new Promise<undefined>((done, fail) => { resolve = done; reject = fail; });
  Object.assign(world.chunkPersistentCache, { supported: true, get: () => pending });
  const seam = world as unknown as { requestPersistentChunk(key: string, cx: number, cz: number, distance: number): boolean };
  world.generationQueue = world.generationQueue.filter(entry => entry.cx !== 0 || entry.cz !== 2);
  world.generationQueued.delete("0,2"); world.generationEnqueuedAt.delete("0,2");
  assert.equal(seam.requestPersistentChunk("0,2", 0, 2, 2), true);
  return { resolve, reject, settle: () => new Promise<void>(done => setImmediate(done)) };
}

for (const failure of [false, true]) test(`deferred persistent-cache ${failure ? "rejection" : "miss"} preserves lookahead and aging order`, async context => {
  const { world } = schedulerWorld(context);
  world.update(8, 8, 40, 4, 0); assertEastFirst(world, true);
  const deferred = deferPersistentRead(world);
  world.generationEnqueuedAt.set("4,0", performance.now() - 100_000);
  if (failure) deferred.reject(new Error("synthetic cache read failure")); else deferred.resolve(undefined);
  await deferred.settle();
  assert.equal(world.generationQueued.has("0,2"), true);
  assert.equal(world.generationQueue.filter(entry => entry.cx === 0 && entry.cz === 2).length, 1);
  assertEastFirst(world, true);
  assert(world.generationQueue.findIndex(entry => entry.cx === 4 && entry.cz === 0)
    > world.generationQueue.findIndex(entry => entry.cx === 2 && entry.cz === 0), "late cache fallback must retain bounded aging");
  assert.equal(world.chunks.size, 0);
});

test("a persistent miss after a world reset cannot enqueue an old namespace", async context => {
  const { world } = schedulerWorld(context);
  const deferred = deferPersistentRead(world);
  world.reset("STREAMING-CACHE-NAMESPACE-CHANGED", undefined, { structures: false });
  deferred.resolve(undefined); await deferred.settle();
  assert.equal(world.generationQueue.length, 0);
  assert.equal(world.generationQueued.size, 0);
});

test("direct Rust residency admission cannot undo lookahead ordering established by the scheduler", context => {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  context.after(() => world.dispose());
  world.reset("STREAMING-DIRECT-RUST-REQUEST", undefined, { structures: false });
  world.streamingLookaheadChunkX = 1;
  world.scheduleAround(8, 8, true, 40); assertEastFirst(world, true);
  world.generationQueue = world.generationQueue.filter(entry => entry.cx !== 0 || entry.cz !== 2);
  world.generationQueued.delete("0,2"); world.generationEnqueuedAt.delete("0,2");
  assert.equal(world.requestChunk(0, 2), undefined);
  assert.equal(world.generationQueued.has("0,2"), true);
  assertEastFirst(world, true);
  assert.equal(world.chunks.size, 0, "the Rust request remains asynchronous admission only");
});

test("radius-zero Rust acceptance can queue before a player schedule establishes coordinates", async context => {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  context.after(() => { world.chunks.clear(); world.dispose(); });
  world.reset("STREAMING-COLD-SINGLETON-REQUEST", undefined, { structures: false });
  assert(Number.isNaN(world.playerChunkX) && Number.isNaN(world.playerChunkZ));
  // This is an admission/ordering unit seam only; the separate full155 browser gate
  // verifies real worker-produced payloads at exactly this public acceptance boundary.
  Object.defineProperties(world.terrainGenerationPipeline, {
    authorityUnavailable: { get: () => false }, availableSlots: { get: () => 1 },
  });
  const admitted: string[] = [];
  world.processGenerationSlice = preferredKey => {
    assert.equal(preferredKey, "-3,7");
    assert.deepEqual(world.generationQueue, [{ cx: -3, cz: 7, distance: 0 }]);
    admitted.push(preferredKey!);
    world.generationQueue.pop(); world.generationQueued.delete(preferredKey!);
    world.chunks.set(preferredKey!, { key: preferredKey, cx: -3, cz: 7 } as Chunk);
    return true;
  };
  const result = await world.awaitGenerationRing(-3 * 16 + 0.5, 7 * 16 + 0.5, 0, 100);
  assert.deepEqual(result, { mode: "rust", keys: ["-3,7"] });
  assert.deepEqual(admitted, ["-3,7"]); assert.equal(world.chunks.size, 1);
  assert(Number.isNaN(world.playerChunkX) && Number.isNaN(world.playerChunkZ), "admission must not invent a camera anchor");
});
