import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { BlockId } from "../app/game/data.ts";
import { ChunkWorld, CHUNK_SIZE, SECTION_COUNT, SECTION_HEIGHT } from "../app/game/world.ts";
import { TerrainGenerationPipeline, type TerrainGenerationWorkerLike } from "../app/game/terrain-generation-pipeline.ts";
import { explicitTerrainGenerationAuthorityV2 } from "../app/game/terrain-generation-authority.ts";
import {
  createGeneratedChunkV2, legacyTerrainGeneratorHashV2, LEGACY_TERRAIN_CONTENT_HASH_V2,
  TERRAIN_GENERATION_PROTOCOL_V2, GENERATE_CHUNK_REQUEST_SCHEMA_V2, GENERATED_CHUNK_SCHEMA_V2,
  TERRAIN_GENERATION_CELL_COUNT_V2, TERRAIN_GENERATION_COLUMN_COUNT_V2, TERRAIN_GENERATION_SECTION_COUNT_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2, TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1, TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1, TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1,
  type GenerateChunkRequestV2, type TerrainGenerationWorkerRequestV2, type TerrainGenerationWorkerResponseV2,
} from "../app/game/terrain-generation-contract.ts";

/** Controlled replies, but real queue admission, pipeline validation, installs, and lighting. */
class ControlledWorker implements TerrainGenerationWorkerLike {
  onmessage: TerrainGenerationWorkerLike["onmessage"] = null;
  onerror: TerrainGenerationWorkerLike["onerror"] = null;
  onmessageerror: TerrainGenerationWorkerLike["onmessageerror"] = null;
  requests: GenerateChunkRequestV2[] = [];
  terminated = false;
  postMessage(message: TerrainGenerationWorkerRequestV2, transfer: Transferable[] = []) {
    if (message.type === "generate-chunk-v2") this.requests.push(structuredClone(message.request, { transfer }));
  }
  terminate() { this.terminated = true; }
  respond(data: TerrainGenerationWorkerResponseV2) { this.onmessage?.({ data } as MessageEvent<TerrainGenerationWorkerResponseV2>); }
  ready() {
    this.respond({ type: "terrain-generation-ready-v2", protocolVersion: TERRAIN_GENERATION_PROTOCOL_V2,
      requestSchemaVersion: GENERATE_CHUNK_REQUEST_SCHEMA_V2, resultSchemaVersion: GENERATED_CHUNK_SCHEMA_V2,
      backend: "rust-wasm-authoritative",
      certificate: { generatorVersion: 18, generatorHash: legacyTerrainGeneratorHashV2("g18"), contentHash: LEGACY_TERRAIN_CONTENT_HASH_V2,
        corpusHash: TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2, corpusCases: TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2, byteEqual: true },
      locatorCertificate: { schemaVersion: 1, corpusHash: TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1,
        settlementCases: TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1, lairCases: TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1, byteEqual: true },
    });
  }
  complete(request = this.requests.at(-1)!) {
    const result = createGeneratedChunkV2(request, { key: request.key, cx: request.cx, cz: request.cz,
      blocks: new Uint16Array(TERRAIN_GENERATION_CELL_COUNT_V2), heightmap: new Int16Array(TERRAIN_GENERATION_COLUMN_COUNT_V2),
      biomes: new Uint8Array(TERRAIN_GENERATION_COLUMN_COUNT_V2), sectionBlockCounts: new Uint16Array(TERRAIN_GENERATION_SECTION_COUNT_V2),
      skyTops: new Int16Array(TERRAIN_GENERATION_COLUMN_COUNT_V2), light: new Uint16Array(TERRAIN_GENERATION_CELL_COUNT_V2),
      lightIndices: [], leafIndices: [], structureMarkers: [],
    });
    this.respond({ type: "generated-chunk-v2", epoch: request.epoch, taskId: request.taskId, result });
  }
}

function fixture(context: TestContext) {
  // Deterministic priority aging and frame budgets; no generation/light/mesh method is replaced.
  context.mock.method(performance, "now", () => 1_000);
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  context.after(() => world.dispose());
  world.terrainGenerationPipeline.dispose();
  const workers: ControlledWorker[] = [];
  const pipeline = new TerrainGenerationPipeline(2, 0, {
    authoritySelection: explicitTerrainGenerationAuthorityV2("rust", "test"),
    workerFactory: () => { const worker = new ControlledWorker(); workers.push(worker); return worker; },
  });
  world.terrainGenerationPipeline = pipeline;
  world.reset("PREDICTIVE-GENERATION-ADMISSION", undefined, { structures: false });
  workers.filter(worker => !worker.terminated).forEach(worker => worker.ready());
  const center = { cx: -7, cz: -1 }; const position = { x: -104, y: 38, z: -8 };
  const key = (dx: number, dz: number) => `${center.cx + dx},${center.cz + dz}`;
  world.scheduleAround(position.x, position.z, true, position.y);
  const complete = (chunkKey: string) => {
    const worker = workers.findLast(candidate => !candidate.terminated && candidate.requests.at(-1)?.key === chunkKey);
    assert(worker, `worker owns ${chunkKey}`); worker.complete();
  };
  // Drawable current ring, plus resident background chunks and the already-present
  // third leading chunk from the negative-coordinate browser regression.
  for (let dx = -3; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
    assert(world.processGenerationSlice(key(dx, dz))); complete(key(dx, dz)); assert(world.processGenerationSlice(key(dx, dz)));
  }
  assert(world.processGenerationSlice(key(2, 1))); complete(key(2, 1)); assert(world.processGenerationSlice(key(2, 1)));
  const internals = world as unknown as { processLightReconciliation(): boolean; sortGenerationQueue(): void };
  for (let guard = 0; world.lightReconciliationQueued.size; guard += 1) {
    assert(guard < 1_024, "real light reconciliation finishes"); assert(internals.processLightReconciliation());
  }
  for (const chunk of world.chunks.values()) for (let section = 0; section < SECTION_COUNT; section += 1) {
    if (section === world.playerSection || section === world.playerSection - 1) continue;
    chunk.blocks[section * SECTION_HEIGHT * CHUNK_SIZE * CHUNK_SIZE] = BlockId.Stone;
    chunk.sectionBlockCounts[section] = 1;
    world.queueMesh(chunk.key, section);
  }
  assert.equal(world.streamingDiagnostics().immediateRing.ready, 9);
  assert(world.meshQueued.size + world.urgentMeshQueued.size >= 128, "real nonempty background sections exceed the debt threshold");
  assert.equal(pipeline.availableSlots, 2);
  const queued = (...offsets: readonly (readonly [number, number])[]) => {
    world.generationQueue = offsets.map(([dx, dz]) => ({ cx: center.cx + dx, cz: center.cz + dz, distance: Math.max(Math.abs(dx), Math.abs(dz)) }));
    world.generationQueued = new Set([...world.generationQueue.map(entry => `${entry.cx},${entry.cz}`), ...world.pendingWorkerGeneration]);
    world.generationEnqueuedAt = new Map(world.generationQueue.map(entry => [`${entry.cx},${entry.cz}`, performance.now()]));
    internals.sortGenerationQueue();
  };
  const lookahead = (x = 1, z = 0) => { world.streamingLookaheadChunkX = x; world.streamingLookaheadChunkZ = z; internals.sortGenerationQueue(); };
  const submissions = () => workers.flatMap(worker => worker.requests).map(request => request.key);
  const budgets = () => [world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds];
  return { world, pipeline, workers, key, center, position, queued, lookahead, submissions, complete, budgets };
}

test("ordinary update submits leading-ring terrain before the negative chunk boundary despite background debt", context => {
  const { world, pipeline, key, center, position, submissions, budgets } = fixture(context);
  const before = submissions().length; const limits = budgets();
  const report = world.update(position.x, position.z, position.y, 8, 0);
  assert.deepEqual([world.playerChunkX, world.playerChunkZ], [center.cx, center.cz], "no chunk crossing is used to grant priority");
  assert.deepEqual([world.streamingLookaheadChunkX, world.streamingLookaheadChunkZ], [1, 0]);
  assert.equal(submissions().length, before + 1, "prediction uses one existing discretionary generation turn");
  assert([key(2, -1), key(2, 0)].includes(submissions().at(-1)!));
  assert.equal(report.generationSlices, 1); assert.equal(pipeline.availableSlots, 1, "the correctness reserve remains free");
  assert.deepEqual(budgets(), limits); assert.equal(world.generationTasks.size, 0, "no TypeScript generation fallback");
});

test("prediction scans existing deterministic order past unrelated higher-ranked far work", context => {
  const { world, key, queued, lookahead, submissions } = fixture(context);
  lookahead(); queued([2, -1], [0, 2]);
  assert.equal(`${world.generationQueue.at(-1)!.cx},${world.generationQueue.at(-1)!.cz}`, key(0, 2));
  const unrelated = world.generationQueue.at(-1); const enqueuedAt = world.generationEnqueuedAt.get(key(0, 2));
  assert(world.processGenerationSlice()); assert.equal(submissions().at(-1), key(2, -1));
  assert.equal(world.generationQueue.at(-1), unrelated); assert.equal(world.generationEnqueuedAt.get(key(0, 2)), enqueuedAt);
});

test("a rejected predictive admission restores queue order, objects and age before its next retry", context => {
  const { world, pipeline, workers, key, queued, lookahead, submissions } = fixture(context);
  lookahead(); queued([2, -1], [0, 2]);
  const before = [...world.generationQueue]; const times = new Map(world.generationEnqueuedAt);
  // Exercise the real pipeline's u32 task-id rollover rejection/restart, not a
  // replaced submit method. The world must return the middle candidate intact.
  (pipeline as unknown as { nextId: number }).nextId = 0x1_0000_0000;
  assert.equal(world.processGenerationSlice(), false);
  assert.deepEqual(world.generationQueue, before); before.forEach((entry, index) => assert.equal(world.generationQueue[index], entry));
  assert.deepEqual(world.generationEnqueuedAt, times); assert.equal(world.pendingWorkerGeneration.size, 0);
  workers.filter(worker => !worker.terminated).forEach(worker => worker.ready());
  assert(world.processGenerationSlice()); assert.equal(submissions().at(-1), key(2, -1));
});

test("multiple predictive candidates preserve queue ordering and skip already resident entries", context => {
  const { world, key, queued, lookahead, submissions } = fixture(context);
  lookahead(); queued([2, -1], [2, 0], [2, 1]);
  const expected = [...world.generationQueue].reverse().find(entry => !world.chunks.has(`${entry.cx},${entry.cz}`))!;
  assert(world.processGenerationSlice()); assert.equal(submissions().at(-1), `${expected.cx},${expected.cz}`);
  assert.notEqual(submissions().at(-1), key(2, 1));
});

for (const condition of ["stationary", "reversed", "nonpredicted", "unqueued"] as const) {
  test(`${condition} work cannot bypass ordinary far-field debt throttling`, context => {
    const { world, queued, lookahead, submissions } = fixture(context);
    lookahead(condition === "stationary" ? 0 : condition === "reversed" ? -1 : 1);
    if (condition === "nonpredicted") queued([0, 2]); else if (condition === "unqueued") queued(); else queued([2, 0]);
    const before = submissions().length; const queue = [...world.generationQueue];
    assert.equal(world.processGenerationSlice(), false); assert.equal(submissions().length, before);
    assert.deepEqual(world.generationQueue, queue);
  });
}

for (const stage of ["lighting", "mesh"] as const) {
  test(`an incomplete current-ring ${stage} boundary blocks predicted generation`, context => {
    const { world, key, queued, lookahead, submissions } = fixture(context);
    lookahead(); queued([2, 0]); const chunk = world.chunks.get(key(1, 0))!;
    if (stage === "lighting") chunk.lightInitialized = false;
    else { chunk.blocks[world.playerSection * SECTION_HEIGHT * CHUNK_SIZE * CHUNK_SIZE] = BlockId.Stone; chunk.sectionBlockCounts[world.playerSection] = 1; }
    assert.equal(world.streamingDiagnostics().immediateRing.ready, 8);
    const before = submissions().length; assert.equal(world.processGenerationSlice(), false); assert.equal(submissions().length, before);
  });
}

test("missing current-ring terrain retains priority over queued prediction", context => {
  const { world, key, queued, lookahead, submissions } = fixture(context);
  world.unloadChunk(key(1, 0)); lookahead(); queued([2, 0], [1, 0]);
  assert(world.processGenerationSlice()); assert.equal(submissions().at(-1), key(1, 0));
});

test("prediction cannot consume the last free worker slot", context => {
  const { world, pipeline, key, queued, lookahead, submissions } = fixture(context);
  lookahead(); queued([2, 0], [2, -1]); assert(world.processGenerationSlice(key(2, -1)));
  assert.equal(pipeline.availableSlots, 1); const before = submissions().length;
  assert.equal(world.processGenerationSlice(), false); assert.equal(submissions().length, before);
});

test("completed authoritative output installs before another predictive admission", context => {
  const { world, pipeline, key, queued, lookahead, submissions, complete } = fixture(context);
  lookahead(); queued([2, 0], [2, -1]); assert(world.processGenerationSlice(key(2, -1))); complete(key(2, -1));
  assert.equal(pipeline.availableSlots, 2); assert(!world.chunks.has(key(2, -1)));
  const before = submissions().length; assert(world.processGenerationSlice());
  assert(world.chunks.has(key(2, -1))); assert.equal(submissions().length, before);
});

test("reversing prediction selects the new leading ring rather than a stale eastward candidate", context => {
  const { world, key, queued, lookahead, submissions } = fixture(context);
  world.unloadChunk(key(-2, 0)); lookahead(1); queued([2, 0], [-2, 0]); lookahead(-1);
  assert(world.processGenerationSlice()); assert.equal(submissions().at(-1), key(-2, 0));
});
