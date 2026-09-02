import assert from "node:assert/strict";
import test from "node:test";
import {
  TerrainGenerationPipeline,
  type TerrainGenerationWorkerLike,
} from "../app/game/terrain-generation-pipeline.ts";
import {
  GENERATED_CHUNK_SCHEMA_V2,
  GENERATE_CHUNK_REQUEST_SCHEMA_V2,
  TERRAIN_GENERATION_CELL_COUNT_V2,
  TERRAIN_GENERATION_COLUMN_COUNT_V2,
  TERRAIN_GENERATION_PROTOCOL_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
  TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1,
  TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1,
  TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1,
  LEGACY_TERRAIN_CONTENT_HASH_V2,
  TERRAIN_GENERATION_SECTION_COUNT_V2,
  createGeneratedChunkV2,
  type GenerateChunkRequestV2,
  type DragonLairLocatorRequestV1,
  type SettlementLocatorRequestV1,
  type TerrainGenerationWorkerRequestV2,
  type TerrainGenerationWorkerResponseV2,
  legacyTerrainGeneratorHashV2,
} from "../app/game/terrain-generation-contract.ts";
import { ChunkWorld, MIN_Y } from "../app/game/world.ts";
import {
  explicitTerrainGenerationAuthorityV2,
  resolveTerrainGenerationAuthorityV2,
} from "../app/game/terrain-generation-authority.ts";

const rustAuthority = explicitTerrainGenerationAuthorityV2("rust", "test");
const authoritativeCertificate = Object.freeze({
  generatorVersion: 18,
  generatorHash: legacyTerrainGeneratorHashV2("g18"),
  contentHash: LEGACY_TERRAIN_CONTENT_HASH_V2,
  corpusHash: TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
  corpusCases: TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  byteEqual: true,
});
const authoritativeLocatorCertificate = Object.freeze({
  schemaVersion: 1 as const,
  corpusHash: TERRAIN_LOCATOR_PROMOTION_CORPUS_HASH_V1,
  settlementCases: TERRAIN_LOCATOR_PROMOTION_SETTLEMENT_CASES_V1,
  lairCases: TERRAIN_LOCATOR_PROMOTION_LAIR_CASES_V1,
  byteEqual: true,
});

class FailingWorker {
  static instances: FailingWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() { FailingWorker.instances.push(this); }
  postMessage() {}
  terminate() {}
  ready() {
    this.onmessage?.({ data: {
      type: "terrain-generation-ready-v2",
      protocolVersion: TERRAIN_GENERATION_PROTOCOL_V2,
      requestSchemaVersion: GENERATE_CHUNK_REQUEST_SCHEMA_V2,
      resultSchemaVersion: GENERATED_CHUNK_SCHEMA_V2,
      backend: "rust-wasm-authoritative",
      certificate: authoritativeCertificate,
      locatorCertificate: authoritativeLocatorCertificate,
    } } as MessageEvent);
  }
  fail() { this.onerror?.({} as ErrorEvent); }
}

const withFakeBrowserWorker = (run: () => void) => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  FailingWorker.instances = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FailingWorker });
  try {
    run();
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else delete (globalThis as { document?: unknown }).document;
    if (workerDescriptor) Object.defineProperty(globalThis, "Worker", workerDescriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
  }
};

test("a failed required generation worker installs nothing and reports terminal authority unavailable", () => {
  withFakeBrowserWorker(() => {
    const pipeline = new TerrainGenerationPipeline(1, 0, { authoritySelection: rustAuthority, workerFactory: () => new FailingWorker() });
    FailingWorker.instances[0].ready();
    let failed = 0;
    assert.equal(pipeline.submit({
      namespace: "test",
      seedText: "seed",
      generationOptions: {},
      key: "0,0",
      cx: 0,
      cz: 0,
      edits: [],
    }, () => assert.fail("failed worker must not complete"), () => { failed += 1; }), true);
    FailingWorker.instances[0].fail();
    assert.equal(failed, 1);
    assert.equal(pipeline.supported, false);
    assert.equal(pipeline.state, "authority-unavailable");
    assert.equal(pipeline.diagnostics().failed, 1);
    pipeline.dispose();
  });
});

class ControlledWorker implements TerrainGenerationWorkerLike {
  onmessage: ((event: MessageEvent<TerrainGenerationWorkerResponseV2>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  requests: GenerateChunkRequestV2[] = [];
  settlementRequests: SettlementLocatorRequestV1[] = [];
  lairRequests: DragonLairLocatorRequestV1[] = [];
  transferCounts: number[] = [];
  terminated = false;

  postMessage(message: TerrainGenerationWorkerRequestV2, transfer: Transferable[] = []) {
    if (message.type === "query-settlements-v1") { this.settlementRequests.push(message.request); return; }
    if (message.type === "query-dragon-lair-v1") { this.lairRequests.push(message.request); return; }
    if (message.type !== "generate-chunk-v2") return;
    this.requests.push(structuredClone(message.request, { transfer }));
    this.transferCounts.push(transfer.length);
  }

  terminate() { this.terminated = true; }

  ready(overrides: Partial<Extract<TerrainGenerationWorkerResponseV2, { type: "terrain-generation-ready-v2" }>> = {}) {
    this.respond({
      type: "terrain-generation-ready-v2",
      protocolVersion: TERRAIN_GENERATION_PROTOCOL_V2,
      requestSchemaVersion: GENERATE_CHUNK_REQUEST_SCHEMA_V2,
      resultSchemaVersion: GENERATED_CHUNK_SCHEMA_V2,
      backend: "rust-wasm-authoritative",
      certificate: authoritativeCertificate,
      locatorCertificate: authoritativeLocatorCertificate,
      ...overrides,
    });
  }

  respond(message: TerrainGenerationWorkerResponseV2) {
    this.onmessage?.({ data: message } as MessageEvent<TerrainGenerationWorkerResponseV2>);
  }

  complete(request = this.requests.at(-1)!) {
    const result = createGeneratedChunkV2(request, {
      key: request.key,
      cx: request.cx,
      cz: request.cz,
      blocks: new Uint16Array(TERRAIN_GENERATION_CELL_COUNT_V2),
      heightmap: new Int16Array(TERRAIN_GENERATION_COLUMN_COUNT_V2),
      biomes: new Uint8Array(TERRAIN_GENERATION_COLUMN_COUNT_V2),
      sectionBlockCounts: new Uint16Array(TERRAIN_GENERATION_SECTION_COUNT_V2),
      skyTops: new Int16Array(TERRAIN_GENERATION_COLUMN_COUNT_V2),
      light: new Uint16Array(TERRAIN_GENERATION_CELL_COUNT_V2),
      lightIndices: [],
      leafIndices: [],
      structureMarkers: [],
    });
    this.respond({ type: "generated-chunk-v2", epoch: request.epoch, taskId: request.taskId, result });
  }

  fail(message = "worker exploded") { this.onerror?.({ message } as ErrorEvent); }
}

const withControlledPerformanceNow = async <T>(
  readNow: () => number,
  run: () => Promise<T>,
) => {
  const descriptor = Object.getOwnPropertyDescriptor(performance, "now");
  Object.defineProperty(performance, "now", { configurable: true, value: readNow });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(performance, "now", descriptor);
    else delete (performance as unknown as Record<string, unknown>).now;
  }
};

const yieldReadinessTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const generationRequest = (namespace = "terrain-v5|g18|seed|{}|0,0|0") => ({
  namespace,
  seedText: "seed",
  generationOptions: {},
  key: "0,0",
  cx: 0,
  cz: 0,
  edits: [] as const,
});

test("V2 requests transfer canonical edits and results preserve the exact authority metadata", () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
  worker.ready();
  let completed = 0;
  const submission = pipeline.submitWithHandle({ ...generationRequest(), edits: [[9, 3], [2, 7]] }, (result) => {
    completed += 1;
    assert.equal(result.epoch, submission!.epoch);
    assert.equal(result.revision, submission!.revision);
    assert.equal(result.chunkHash.length, 32);
  });
  assert.ok(submission);
  assert.deepEqual([...worker.requests[0].edits], [2, 7, 9, 3]);
  assert.deepEqual(worker.transferCounts, [1]);
  worker.complete();
  assert.equal(completed, 1);
  assert.equal(pipeline.diagnostics().completed, 1);
  assert.ok(pipeline.diagnostics().transferBytes > 0);
  pipeline.dispose();
});

test("cold Rust initialization rejects work until the exact certificate arrives", () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
  assert.equal(pipeline.state, "starting");
  assert.equal(pipeline.submit(generationRequest(), () => assert.fail()), false);
  assert.equal(worker.requests.length, 0);
  worker.ready();
  assert.equal(pipeline.state, "ready");
  assert.equal(pipeline.submit(generationRequest(), () => {}), true);
  pipeline.dispose();
});

test("TypeScript and shadow readiness certificates are rejected without fallback", () => {
  for (const backend of ["typescript-compatibility-oracle", "rust-wasm-shadow"] as const) {
    const worker = new ControlledWorker();
    const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
    worker.ready({ backend });
    assert.equal(pipeline.state, "authority-unavailable");
    assert.equal(pipeline.diagnostics().ready, 0);
    assert.equal(pipeline.submit(generationRequest(), () => assert.fail()), false);
    pipeline.dispose();
  }
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
  worker.ready({ certificate: { ...authoritativeCertificate, corpusHash: "0".repeat(32) } });
  assert.equal(pipeline.state, "authority-unavailable");
  pipeline.dispose();

  for (const locatorCertificate of [
    undefined,
    { ...authoritativeLocatorCertificate, corpusHash: "0".repeat(32), settlementCases: 0, lairCases: 0 },
    { ...authoritativeLocatorCertificate, byteEqual: false },
  ]) {
    const locatorWorker = new ControlledWorker();
    const locatorPipeline = new TerrainGenerationPipeline(1, 0, {
      workerFactory: () => locatorWorker, authoritySelection: rustAuthority,
    });
    locatorWorker.ready({ locatorCertificate });
    assert.equal(locatorPipeline.state, "authority-unavailable", "locator parity is an independent startup gate");
    locatorPipeline.dispose();
  }

  const productionWorker = new ControlledWorker();
  const productionPipeline = new TerrainGenerationPipeline(1, 0, {
    workerFactory: () => productionWorker,
    authoritySelection: explicitTerrainGenerationAuthorityV2("rust", "constructor"),
  });
  productionWorker.ready({ locatorCertificate: { ...authoritativeLocatorCertificate, corpusHash: "f".repeat(32) } });
  assert.equal(productionPipeline.state, "authority-unavailable", "production constructor authority rejects test-only locator identity");
  productionPipeline.dispose();
});

test("settlement and lair locator requests share bounded worker slots, validate identity, and cancel", async () => {
  const workers = [new ControlledWorker(), new ControlledWorker()];
  let workerIndex = 0;
  const pipeline = new TerrainGenerationPipeline(2, 0, {
    workerFactory: () => workers[workerIndex++], authoritySelection: rustAuthority,
  });
  workers.forEach((worker) => worker.ready());
  const authority = {
    namespace: "terrain-v5|g18|locator|{}|0,0|0",
    seedText: "LOCATOR-WORKER",
    generationOptions: {},
  } as const;
  const settlements = pipeline.querySettlements({
    ...authority, origin: { x: -12.25, z: 18.75 }, factionIds: [], limit: 4, maxRegionRadius: 18,
  });
  assert.equal(workers[0].settlementRequests.length, 1);
  assert.equal(pipeline.submit({ ...generationRequest(authority.namespace), seedText: authority.seedText,
    generationOptions: authority.generationOptions }, () => {}), true,
    "a second worker remains available for ordinary chunk generation");
  const settlementRequest = workers[0].settlementRequests[0];
  workers[0].respond({
    type: "settlement-locator-result-v1", epoch: settlementRequest.epoch, taskId: settlementRequest.taskId,
    result: { schemaVersion: 1, epoch: settlementRequest.epoch, taskId: settlementRequest.taskId,
      requestHash: settlementRequest.requestHash, entries: [], resultHash: "0".repeat(32) },
  });
  assert.deepEqual((await settlements).entries, []);
  workers[1].complete();

  const controller = new AbortController();
  const lair = pipeline.queryDragonLair({
    ...authority, origin: { x: 0, z: 0 }, dragonType: "sea", minimumStage: 3, maxRegionRadius: 64,
  }, controller.signal);
  assert.equal(workers[0].lairRequests.length, 1);
  controller.abort();
  await assert.rejects(lair, /cancelled/);
  assert.equal(pipeline.diagnostics().canceled, 1);
  pipeline.dispose();
});

test("locator admission waits behind chunk streaming and reset cancels queued work", async () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
  worker.ready();
  assert.equal(pipeline.submit(generationRequest(), () => {}), true);
  const query = pipeline.querySettlements({
    namespace: "terrain-locator-v1|g18|queue",
    seedText: "LOCATOR-QUEUE",
    generationOptions: {},
    origin: { x: 0, z: 0 },
  });
  assert.equal(worker.settlementRequests.length, 0, "busy authority queues locator admission instead of failing");
  worker.complete();
  assert.equal(worker.settlementRequests.length, 1, "locator receives the next released worker slot");
  const request = worker.settlementRequests[0];
  worker.respond({ type: "settlement-locator-result-v1", epoch: request.epoch, taskId: request.taskId,
    result: { schemaVersion: 1, epoch: request.epoch, taskId: request.taskId, requestHash: request.requestHash,
      entries: [], resultHash: "1".repeat(32) } });
  assert.deepEqual((await query).entries, []);

  assert.equal(pipeline.submit(generationRequest("terrain-v5|g18|queue-reset|{}|0,0|0"), () => {}), true);
  const queued = pipeline.queryDragonLair({
    namespace: "terrain-locator-v1|g18|queue-reset", seedText: "LOCATOR-QUEUE-RESET", generationOptions: {},
    origin: { x: 0, z: 0 }, dragonType: "fire", minimumStage: 3,
  });
  pipeline.resetAuthorityEpoch();
  await assert.rejects(queued, /world reset/);
  pipeline.dispose();
});

test("zero slots and startup timeout surface terminal authority unavailable", () => {
  const noSlots = new TerrainGenerationPipeline(0, 2, { workerFactory: () => new ControlledWorker(), authoritySelection: rustAuthority });
  assert.equal(noSlots.state, "authority-unavailable");
  assert.match(noSlots.diagnostics().lastError?.message ?? "", /no configured worker slots/);
  noSlots.dispose();

  const timers: Array<() => void> = [];
  const worker = new ControlledWorker();
  const timed = new TerrainGenerationPipeline(1, 0, {
    workerFactory: () => worker,
    authoritySelection: rustAuthority,
    startupTimeoutMilliseconds: 5,
    setTimeout: ((callback: TimerHandler) => { timers.push(callback as () => void); return 1; }) as typeof globalThis.setTimeout,
    clearTimeout: (() => {}) as typeof globalThis.clearTimeout,
  });
  timers.shift()?.();
  assert.equal(timed.state, "authority-unavailable");
  assert.match(timed.diagnostics().lastError?.message ?? "", /startup timed out/);
  timed.dispose();
});

test("the TypeScript rollback build creates no Rust workers or manifest-request lane and remains reload-bound", () => {
  let factories = 0;
  const pipeline = new TerrainGenerationPipeline(3, 2, {
    authoritySelection: resolveTerrainGenerationAuthorityV2({ buildProfile: "typescript-rollback" }),
    workerFactory: () => { factories += 1; return new ControlledWorker(); },
  });
  assert.equal(factories, 0);
  assert.equal(pipeline.state, "typescript-rollback");
  assert.equal(pipeline.supported, false);
  assert.deepEqual(
    {
      selectionSource: pipeline.diagnostics().selectionSource,
      workers: pipeline.diagnostics().workers,
      rollbackRequiresWorldReload: pipeline.diagnostics().rollbackRequiresWorldReload,
    },
    {
      selectionSource: "build-typescript-rollback",
      workers: 0,
      rollbackRequiresWorldReload: true,
    },
  );
  pipeline.dispose();
});

test("out-of-order chunk results reject stale task and revision lanes", () => {
  const workers = [new ControlledWorker(), new ControlledWorker()];
  let cursor = 0;
  const pipeline = new TerrainGenerationPipeline(2, 0, { workerFactory: () => workers[cursor++], authoritySelection: rustAuthority });
  for (const worker of workers) worker.ready();
  let oldFailed = 0;
  let newCompleted = 0;
  assert.ok(pipeline.submitWithHandle(generationRequest("terrain-v5|g18|seed|{}|0,0|old"), () => assert.fail("old task must be stale"), () => { oldFailed += 1; }));
  assert.ok(pipeline.submitWithHandle(generationRequest("terrain-v5|g18|seed|{}|0,0|new"), () => { newCompleted += 1; }));
  workers[1].complete();
  workers[0].complete();
  assert.equal(newCompleted, 1);
  assert.equal(oldFailed, 1);
  assert.equal(pipeline.diagnostics().stale, 1);
  pipeline.dispose();
});

test("a crashed generation worker restarts and the next V2 task completes", () => {
  const workers: ControlledWorker[] = [];
  const pipeline = new TerrainGenerationPipeline(1, 1, { workerFactory: () => {
    const worker = new ControlledWorker();
    workers.push(worker);
    return worker;
  }, authoritySelection: rustAuthority });
  workers[0].ready();
  let fallback = 0;
  assert.equal(pipeline.submit(generationRequest(), () => assert.fail("crashed task must not complete"), () => { fallback += 1; }), true);
  workers[0].fail("simulated panic");
  assert.equal(fallback, 1);
  assert.equal(workers.length, 2);
  workers[1].ready();
  let completed = 0;
  assert.equal(pipeline.submit(generationRequest(), () => { completed += 1; }), true);
  workers[1].complete();
  assert.equal(completed, 1);
  assert.equal(pipeline.diagnostics().restarts, 1);
  pipeline.dispose();
});

test("a partial worker crash restores configured long-travel capacity within the bounded restart budget", () => {
  const workers: ControlledWorker[] = [];
  const pipeline = new TerrainGenerationPipeline(3, 2, {
    workerFactory: () => {
      const worker = new ControlledWorker();
      workers.push(worker);
      return worker;
    },
    authoritySelection: rustAuthority,
  });
  workers.slice(0, 3).forEach((worker) => worker.ready());
  assert.equal(pipeline.availableSlots, 3);
  workers[1].fail("one slot crashed");
  assert.equal(workers.length, 4, "partial failure must replace capacity, not degrade 3 to 2 forever");
  assert.equal(pipeline.availableSlots, 2);
  workers[3].ready();
  assert.equal(pipeline.availableSlots, 3);
  assert.equal(pipeline.diagnostics().workers, 3);
  assert.equal(pipeline.diagnostics().restarts, 1);
  pipeline.dispose();
});

test("a timed-out Rust task installs nothing and enters bounded terminal recovery", async () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, {
    workerFactory: () => worker,
    authoritySelection: rustAuthority,
    taskTimeoutMilliseconds: 5,
  });
  worker.ready();
  let failed = 0;
  assert.equal(pipeline.submit(generationRequest(), () => assert.fail("timed-out result must not install"), () => { failed += 1; }), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(failed, 1);
  assert.equal(pipeline.state, "authority-unavailable");
  assert.equal(pipeline.diagnostics().completed, 0);
  pipeline.dispose();
});

test("explicit cancellation rejects delivery and releases the worker on acknowledgement", () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
  worker.ready();
  let failed = 0;
  const submission = pipeline.submitWithHandle(generationRequest(), () => assert.fail("cancelled task must not complete"), () => { failed += 1; });
  assert.ok(submission);
  assert.equal(submission.cancel(), true);
  assert.equal(failed, 1);
  assert.equal(pipeline.availableSlots, 0, "ownership remains with the worker until it acknowledges cancellation");
  worker.respond({ type: "generate-chunk-cancelled-v2", epoch: submission.epoch, taskId: submission.taskId });
  assert.equal(pipeline.availableSlots, 1);
  assert.equal(pipeline.diagnostics().canceled, 1);
  assert.equal(pipeline.diagnostics().stale, 0);
  pipeline.dispose();
});

test("missing cancellation acknowledgement triggers bounded worker recovery", async () => {
  const workers: ControlledWorker[] = [];
  const pipeline = new TerrainGenerationPipeline(1, 1, {
    workerFactory: () => {
      const worker = new ControlledWorker();
      workers.push(worker);
      return worker;
    },
    authoritySelection: rustAuthority,
    taskTimeoutMilliseconds: 5,
  });
  workers[0].ready();
  let failed = 0;
  const submission = pipeline.submitWithHandle(
    generationRequest(),
    () => assert.fail("cancelled task must never install"),
    () => { failed += 1; },
  );
  assert.ok(submission);
  assert.equal(submission.cancel(), true);
  assert.equal(failed, 1, "callers receive cancellation immediately");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(workers[0].terminated, true, "a worker that keeps ownership past the bound is terminated");
  assert.equal(workers.length, 2, "bounded recovery creates one replacement slot");
  assert.equal(pipeline.state, "recovering");
  workers[1].ready();
  assert.equal(pipeline.state, "ready");
  assert.equal(pipeline.diagnostics().canceled, 1);
  assert.equal(failed, 1, "timeout recovery cannot fail the cancelled caller twice");
  pipeline.dispose();
});

test("Rust startup and long travel share one worker lane and accepted installs preserve edits, cache, and markers", () => {
  const workers: ControlledWorker[] = [];
  const pipeline = new TerrainGenerationPipeline(1, 1, {
    workerFactory: () => {
      const worker = new ControlledWorker();
      workers.push(worker);
      return worker;
    },
    authoritySelection: rustAuthority,
  });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  world.setRenderDistance(2);
  world.reset("RUST-INSTALL-PARITY", undefined, { structures: false });
  const worker = workers.at(-1)!;
  worker.ready();
  world.scheduleAround(0, 0, true, 10);
  assert.equal(world.setBlock(1, 10, 1, 3), true, "unloaded edit must join the generation request without a fallback chunk");
  assert.equal(world.chunks.size, 0);
  assert.equal(world.generationTasks.size, 0);
  assert.equal(world.processGenerationSlice(), true);
  const request = worker.requests.at(-1)!;
  assert.equal(request.key, "0,0");
  assert.deepEqual([...request.edits], [(10 - MIN_Y) * 256 + 1 * 16 + 1, 3]);

  const reference = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  reference.reset("RUST-INSTALL-PARITY", world.serializeEdits(), { structures: false });
  const expected = reference.generateChunk(0, 0);
  const marker = ["audit:rust-install", {
    type: "landmark" as const,
    id: "audit:rust-install",
    position: { x: 2, y: 11, z: 2 },
    tag: "rust-worldgen-install",
  }] as const;
  const result = createGeneratedChunkV2(request, {
    key: request.key,
    cx: request.cx,
    cz: request.cz,
    blocks: expected.blocks.slice(),
    heightmap: expected.heightmap.slice(),
    biomes: expected.biomes.slice(),
    sectionBlockCounts: expected.sectionBlockCounts.slice(),
    skyTops: expected.skyTops.slice(),
    light: expected.light.slice(),
    lightIndices: [...expected.lightIndices],
    leafIndices: [...expected.leafIndices],
    structureMarkers: [marker],
  });
  worker.respond({ type: "generated-chunk-v2", epoch: request.epoch, taskId: request.taskId, result });
  assert.equal(world.processGenerationSlice(), true);
  assert.equal(world.getBlock(1, 10, 1), 3);
  assert.ok(world.structureMarkerAt(2, 11, 2, "landmark"));
  assert.equal(world.generationTasks.size, 0, "Rust acceptance must never construct a TypeScript task");

  world.unloadChunk("0,0");
  assert.equal(world.chunks.size, 0);
  world.scheduleAround(0, 0, true, 10);
  assert.equal(world.getBlock(1, 10, 1), 3, "shared memory-cache restore must preserve installed Rust bytes");
  assert.ok(world.structureMarkerAt(2, 11, 2, "landmark"));

  world.scheduleAround(16 * 20, 16 * -20, true, 10);
  assert.equal(world.processGenerationSlice(), true);
  const travelled = worker.requests.at(-1)!;
  assert.ok(Math.abs(travelled.cx) >= 18 && Math.abs(travelled.cz) >= 18, "long travel must submit through the same Rust worker");
  assert.equal(world.generationTasks.size, 0);
  reference.dispose();
  world.dispose();
});

test("preferred Rust residency bypasses presentation debt after the immediate ring", () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, {
    workerFactory: () => worker,
    authoritySelection: rustAuthority,
  });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  world.setRenderDistance(2);
  world.reset("RUST-STARTUP-DEBT", undefined, { structures: false });
  worker.ready();
  world.scheduleAround(0, 0, true, 10);

  assert.equal(world.processGenerationSlice("0,0"), true);
  worker.complete();
  assert.equal(world.processGenerationSlice("0,0"), true);
  assert.equal(world.chunks.has("0,0"), true);

  const internals = world as unknown as {
    generationQueue: Array<{ cx: number; cz: number; distance: number }>;
    generationQueued: Set<string>;
    generationEnqueuedAt: Map<string, number>;
    lightReconciliationQueued: Set<string>;
  };
  internals.generationQueue = [{ cx: 2, cz: 0, distance: 2 }];
  internals.generationQueued = new Set(["2,0"]);
  internals.generationEnqueuedAt = new Map([["2,0", performance.now()]]);
  for (let index = 0; index < 32; index += 1) internals.lightReconciliationQueued.add(`debt-${index}`);

  assert.equal(
    world.processGenerationSlice("2,0"),
    true,
    "a required startup/teleport key must reach the idle Rust lane even while presentation work is backlogged",
  );
  assert.equal(worker.requests.at(-1)?.key, "2,0");
  world.dispose();
});

const startupBackpressureWorld = (context: test.TestContext) => {
  const workers: ControlledWorker[] = [];
  const pipeline = new TerrainGenerationPipeline(2, 0, {
    workerFactory: () => { const worker = new ControlledWorker(); workers.push(worker); return worker; },
    authoritySelection: rustAuthority,
  });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  context.after(() => world.dispose());
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  world.reset("RUST-STARTUP-BACKPRESSURE", undefined, { structures: false });
  workers.slice(-2).forEach(worker => worker.ready());
  world.scheduleAround(0, 0, true, 10);
  const complete = (key: string) => {
    const worker = workers.findLast(candidate => candidate.requests.at(-1)?.key === key);
    assert.ok(worker, `a real controlled worker must own ${key}`);
    worker.complete();
  };
  for (let cx = -1; cx <= 1; cx += 1) for (let cz = -1; cz <= 1; cz += 1) {
    const key = `${cx},${cz}`;
    assert.equal(world.processGenerationSlice(key), true);
    complete(key);
    assert.equal(world.processGenerationSlice(key), true);
  }
  const internals = world as unknown as { processLightReconciliation: () => boolean };
  const reconcile = () => {
    for (let guard = 0; world.lightReconciliationQueued.size; guard += 1) {
      assert.ok(guard < 512, "the installed ring must finish its real bounded seam-light tasks");
      assert.equal(internals.processLightReconciliation(), true);
    }
  };
  const queueOnly = (cx: number, cz: number, distance = Math.max(Math.abs(cx), Math.abs(cz))) => {
    const key = `${cx},${cz}`;
    world.generationQueue = [{ cx, cz, distance }];
    world.generationQueued = new Set([key]);
    world.generationEnqueuedAt = new Map([[key, performance.now()]]);
  };
  const missingRequiredSection = () => {
    reconcile();
    const chunk = world.chunks.get("1,0")!;
    chunk.blocks[(10 - MIN_Y) * 16 * 16] = 3;
    chunk.sectionBlockCounts[world.playerSection] = 1;
    assert.equal(world.streamingDiagnostics().immediateRing.ready, 8);
    return chunk;
  };
  return { world, workers, complete, reconcile, queueOnly, missingRequiredSection };
};

test("startup backpressure holds ordinary far work below the debt limit until all nine chunks are drawable", context => {
  const { world, workers, queueOnly, missingRequiredSection } = startupBackpressureWorld(context);
  queueOnly(2, 0);
  const queued = world.generationQueue[0]; const enqueuedAt = world.generationEnqueuedAt.get("2,0");
  const submitted = workers.reduce((count, worker) => count + worker.requests.length, 0);
  const budgets = [world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds];
  assert.equal(world.lightReconciliationQueued.size, 9, "debt is below the old threshold of 32");
  assert.equal(world.processGenerationSlice(), false, "new far work must wait for local lighting");
  assert.equal(world.generationQueue[0], queued, "deferred admission must not dequeue or recreate the request");
  assert.equal(world.generationEnqueuedAt.get("2,0"), enqueuedAt);
  assert.equal(workers.reduce((count, worker) => count + worker.requests.length, 0), submitted);

  const chunk = missingRequiredSection();
  assert.equal(world.lightReconciliationQueued.size, 0);
  assert.equal(world.processGenerationSlice(), false, "light-ready is not drawable without the occupied section");
  world.rebuildSection(chunk, world.playerSection);
  assert.equal(world.streamingDiagnostics().immediateRing.ready, 9);
  assert.equal(world.processGenerationSlice(), true, "ordinary far admission resumes without a latch or refresh");
  assert.deepEqual(budgets, [world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds]);
});

for (const [cx, cz, distance] of [[2, 0, 0], [-2, -1, 1], [1, 2, 0]] as const) {
  test(`startup backpressure uses actual coordinates for far request ${cx},${cz}, not cached distance ${distance}`, context => {
    const { world, queueOnly } = startupBackpressureWorld(context);
    queueOnly(cx, cz, distance);
    assert.equal(world.processGenerationSlice(), false);
    assert.equal(world.generationQueue.length, 1);
    assert.equal(world.pendingWorkerGeneration.size, 0);
  });
}

test("startup backpressure permits an ordinary diagonal immediate-ring request", context => {
  const { world, queueOnly } = startupBackpressureWorld(context);
  world.unloadChunk("1,1");
  queueOnly(1, 1, 2);
  assert.equal(world.processGenerationSlice(), true, "Chebyshev radius one includes a diagonal with a larger sort distance");
  assert.equal(world.pendingWorkerGeneration.has("1,1"), true);
});

test("startup backpressure permits explicit far residency at eight of nine drawable chunks", context => {
  const { world, queueOnly, missingRequiredSection } = startupBackpressureWorld(context);
  missingRequiredSection(); queueOnly(2, 0);
  assert.equal(world.processGenerationSlice("2,0"), true);
  assert.equal(world.pendingWorkerGeneration.has("2,0"), true);
});

test("startup backpressure retains pending far work and installs its authoritative completion", context => {
  const { world, workers, complete, queueOnly } = startupBackpressureWorld(context);
  queueOnly(2, 0); assert.equal(world.processGenerationSlice("2,0"), true);
  queueOnly(3, 0);
  assert.equal(world.processGenerationSlice(), false);
  assert.equal(world.pendingWorkerGeneration.has("2,0"), true);
  assert.equal(world.terrainGenerationPipeline.diagnostics().canceled, 0);
  assert.equal(workers.slice(-2).every(worker => !worker.terminated), true);
  complete("2,0");
  assert.equal(world.processGenerationSlice(), true, "completion installation must precede new-work backpressure");
  assert.equal(world.chunks.has("2,0"), true);
  assert.equal(world.pendingWorkerGeneration.has("2,0"), false);
  assert.equal(world.generationQueue[0].cx, 3);
});

test("startup backpressure adds no reset state and old pending results remain invalidated", context => {
  const { world, workers, queueOnly } = startupBackpressureWorld(context);
  queueOnly(2, 0); assert.equal(world.processGenerationSlice("2,0"), true);
  const oldWorkers = workers.slice(-2); const old = oldWorkers.find(worker => worker.requests.at(-1)?.key === "2,0")!;
  world.reset("RUST-STARTUP-BACKPRESSURE-NEXT", undefined, { structures: false });
  old.complete();
  assert.equal(oldWorkers.every(worker => worker.terminated), true);
  assert.equal(world.chunks.size, 0);
  assert.equal(world.pendingWorkerGeneration.size, 0);
  workers.slice(-2).forEach(worker => worker.ready());
  world.scheduleAround(0, 0, true, 10);
  queueOnly(2, 0);
  assert.equal(world.processGenerationSlice("2,0"), true, "explicit readiness works immediately in the replacement epoch");
  assert.equal(world.terrainGenerationPipeline.diagnostics().stale, 0);
});

test("startup backpressure does not restrict the explicit TypeScript rollback generation path", context => {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  context.after(() => world.dispose());
  world.reset("TS-STARTUP-BACKPRESSURE", undefined, { structures: false });
  world.scheduleAround(0, 0, true, 10);
  world.generationQueue = [{ cx: 2, cz: 0, distance: 2 }];
  world.generationQueued = new Set(["2,0"]);
  assert.equal(world.processGenerationSlice(), true);
  assert.equal(world.activeGenerationTask?.key, "2,0");
  assert.equal(world.terrainGenerationPipeline.diagnostics().submitted, 0);
});

test("an edit arriving during Rust generation invalidates the result and immediately requeues the new namespace", () => {
  const workers: ControlledWorker[] = [];
  const pipeline = new TerrainGenerationPipeline(1, 1, {
    workerFactory: () => {
      const worker = new ControlledWorker();
      workers.push(worker);
      return worker;
    },
    authoritySelection: rustAuthority,
  });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  world.setRenderDistance(2);
  world.reset("EDIT-DURING-RUST-FLIGHT", undefined, { structures: false });
  const worker = workers.at(-1)!;
  worker.ready();
  world.scheduleAround(0, 0, true, 10);
  assert.equal(world.processGenerationSlice("0,0"), true);
  const staleRequest = worker.requests.at(-1)!;
  assert.deepEqual([...staleRequest.edits], []);
  assert.equal(world.setBlock(1, 10, 1, 3), true);

  worker.complete(staleRequest);
  assert.equal(world.processGenerationSlice("0,0"), true);
  assert.equal(world.chunks.has("0,0"), false, "old namespace must install nothing");
  assert.equal(world.generationQueued.has("0,0"), true, "edited lane must be requeued without waiting for readiness timeout");
  assert.equal(world.processGenerationSlice("0,0"), true);
  const replacement = worker.requests.at(-1)!;
  assert.notEqual(replacement.taskId, staleRequest.taskId);
  assert.deepEqual([...replacement.edits], [(10 - MIN_Y) * 256 + 1 * 16 + 1, 3]);
  assert.equal(world.generationTasks.size, 0);
  world.dispose();
});

test("world reset terminates in-flight authority work and stale callbacks cannot enter the new world", async () => {
  const workers: ControlledWorker[] = [];
  const pipeline = new TerrainGenerationPipeline(1, 1, {
    workerFactory: () => {
      const worker = new ControlledWorker();
      workers.push(worker);
      return worker;
    },
    authoritySelection: rustAuthority,
  });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  world.setRenderDistance(2);
  world.reset("RESET-A", undefined, { structures: false });
  const first = workers.at(-1)!;
  first.ready();
  const readiness = world.awaitGenerationRing(0, 0, 0, 1_000);
  assert.equal(first.requests.length, 1);

  world.reset("RESET-B", undefined, { structures: false });
  assert.equal(first.terminated, true);
  first.complete(first.requests[0]);
  await assert.rejects(readiness, /superseded by a world reset/);
  assert.equal(world.chunks.size, 0);
  assert.equal((world as unknown as { completedWorkerGeneration: unknown[] }).completedWorkerGeneration.length, 0);
  assert.equal(world.pendingWorkerGeneration.size, 0);

  const second = workers.at(-1)!;
  second.ready();
  world.scheduleAround(0, 0, true, 10);
  assert.equal(world.processGenerationSlice("0,0"), true);
  assert.equal(second.requests.at(-1)?.seedText, "RESET-B");
  world.dispose();
});

test("disposing a world cancels a pending Rust readiness wait", async () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  worker.ready();
  const readiness = world.awaitGenerationRing(0, 0, 0, 1_000);
  world.dispose();
  await assert.rejects(readiness, /disposed before readiness/);
});

test("Rust readiness fills every worker slot before yielding", async () => {
  const workers: ControlledWorker[] = [];
  const pipeline = new TerrainGenerationPipeline(2, 0, {
    workerFactory: () => {
      const worker = new ControlledWorker();
      workers.push(worker);
      return worker;
    },
    authoritySelection: rustAuthority,
  });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  world.setRenderDistance(2);
  world.reset("RUST-READINESS-CAPACITY", undefined, { structures: false });
  for (const worker of workers) worker.ready();

  const readiness = world.awaitGenerationRing(0, 0, 1, 1_000);
  assert.equal(
    workers.reduce((total, worker) => total + worker.requests.length, 0),
    2,
    "both configured Rust lanes must be occupied before the readiness loop yields",
  );
  world.dispose();
  await assert.rejects(readiness, /disposed before readiness/);
});

test("Rust readiness installs the complete radius-two startup ring through the real worker lane", async () => {
  const workers: ControlledWorker[] = [];
  const pipeline = new TerrainGenerationPipeline(1, 0, {
    workerFactory: () => {
      const worker = new ControlledWorker();
      workers.push(worker);
      return worker;
    },
    authoritySelection: rustAuthority,
  });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  world.setRenderDistance(2);
  world.reset("RUST-READINESS-RADIUS-TWO", undefined, { structures: false });
  const worker = workers.at(-1)!;
  worker.ready();

  const readiness = world.awaitGenerationRing(0, 0, 2, 5_000);
  for (let requestIndex = 0; requestIndex < 25; requestIndex += 1) {
    for (let attempts = 0; worker.requests.length <= requestIndex && attempts < 100; attempts += 1) {
      await yieldReadinessTurn();
    }
    assert.ok(worker.requests[requestIndex], `startup ring request ${requestIndex + 1} must reach the Rust lane`);
    worker.complete(worker.requests[requestIndex]);
    await yieldReadinessTurn();
  }

  const result = await readiness;
  assert.equal(result.mode, "rust");
  assert.equal(result.keys.length, 25);
  assert.equal(new Set(result.keys).size, 25);
  assert.equal(result.keys.every((key) => world.chunks.has(key)), true);
  world.dispose();
});

test("Rust readiness accepts a final authoritative install exactly at its deadline", async () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  worker.ready();
  let now = 100;

  await withControlledPerformanceNow(() => now, async () => {
    const readiness = world.awaitGenerationRing(0, 0, 0, 10);
    assert.equal(worker.requests.length, 1);
    worker.complete(worker.requests[0]);
    now = 110;
    const result = await readiness;
    assert.deepEqual(result.keys, ["0,0"]);
    assert.equal(world.chunks.has("0,0"), true);
  });
  world.dispose();
});

test("Rust readiness rejects an incomplete ring exactly at its deadline", async () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  worker.ready();
  let now = 200;

  await withControlledPerformanceNow(() => now, async () => {
    const readiness = world.awaitGenerationRing(0, 0, 0, 10);
    assert.equal(worker.requests.length, 1);
    now = 210;
    await assert.rejects(readiness, /did not install the 1-chunk startup ring before timeout/);
    assert.equal(world.chunks.has("0,0"), false);
  });
  world.dispose();
});

test("AbortSignal cancels an in-flight Rust readiness wait without installing a chunk", async () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  worker.ready();
  const controller = new AbortController();

  const readiness = world.awaitGenerationRing(0, 0, 0, 1_000, controller.signal);
  assert.equal(worker.requests.length, 1);
  controller.abort();
  await assert.rejects(readiness, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AbortError");
    assert.match(error.message, /readiness was cancelled/);
    return true;
  });
  assert.equal(world.chunks.has("0,0"), false);
  world.dispose();
});

test("awaited far residency is renewed beyond the ordinary 15-second lease and accepted", () => {
  const worker = new ControlledWorker();
  const pipeline = new TerrainGenerationPipeline(1, 0, { workerFactory: () => worker, authoritySelection: rustAuthority });
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "rust" });
  world.terrainGenerationPipeline.dispose();
  world.terrainGenerationPipeline = pipeline;
  world.setRenderDistance(2);
  world.reset("SLOW-FAR-RESIDENCY", undefined, { structures: false });
  worker.ready();
  const now = performance.now();
  world.requestChunkForResidency(20, -20, 15_000);
  assert.equal(worker.requests.length, 1, "residency request prioritizes the far chunk onto the sole Rust lane");
  const request = worker.requests.at(-1)!;
  const leases = (world as unknown as { generationResidencyLeases: Map<string, number> }).generationResidencyLeases;
  leases.set("20,-20", now - 1);
  leases.set("20,-20", performance.now() + 61_000);
  worker.complete(request);
  assert.equal(world.processGenerationSlice("20,-20"), true);
  assert.ok(world.chunks.has("20,-20"), "renewed far authority result must not be discarded by local-camera retention");
  world.dispose();
});

test("worker terrain entry point is byte-exact before neighbor-sensitive lighting", () => {
  const full = new ChunkWorld();
  const worker = new ChunkWorld();
  full.reset("WORKER-PARITY", undefined, { structures: false });
  worker.reset("WORKER-PARITY", undefined, { structures: false });
  const expected = full.generateChunk(2, -3);
  const actual = worker.generateChunkTerrainOnly(2, -3);
  assert.deepEqual(actual.blocks, expected.blocks);
  assert.deepEqual(actual.heightmap, expected.heightmap);
  assert.deepEqual(actual.biomes, expected.biomes);
  assert.deepEqual(actual.sectionBlockCounts, expected.sectionBlockCounts);
  assert.deepEqual(actual.skyTops, expected.skyTops);
  assert.deepEqual([...actual.lightIndices], [...expected.lightIndices]);
  assert.deepEqual([...actual.leafIndices], [...expected.leafIndices]);
  assert.equal(actual.lightInitialized, false, "lighting remains ordered on the main world after installation");
  full.dispose();
  worker.dispose();
});

test("isolated worker lighting reconciles to the sequential cross-chunk solution", () => {
  const reference = new ChunkWorld();
  const isolatedLeft = new ChunkWorld();
  const isolatedRight = new ChunkWorld();
  const installed = new ChunkWorld();
  for (const world of [reference, isolatedLeft, isolatedRight, installed]) {
    world.reset("WORKER-LIGHT-SEAM", undefined, { structures: false });
  }
  const expectedLeft = reference.generateChunk(0, 0);
  const expectedRight = reference.generateChunk(1, 0);
  const leftLight = isolatedLeft.generateChunk(0, 0).light.slice();
  const rightLight = isolatedRight.generateChunk(1, 0).light.slice();
  const actualLeft = installed.generateChunkTerrainOnly(0, 0);
  const actualRight = installed.generateChunkTerrainOnly(1, 0);
  actualLeft.light.set(leftLight);
  actualRight.light.set(rightLight);
  actualLeft.lightInitialized = true;
  actualRight.lightInitialized = true;
  let slices = 0;
  for (const chunk of [actualLeft, actualRight]) {
    const task = installed.lightEngine.beginChunkBoundaryReconciliation(chunk);
    while (!installed.lightEngine.stepChunkInitialization(task, 2_048)) slices += 1;
  }
  assert.ok(slices > 2, "seam reconciliation must remain resumable instead of becoming a hidden frame spike");
  assert.deepEqual(actualLeft.light, expectedLeft.light);
  assert.deepEqual(actualRight.light, expectedRight.light);
  for (const world of [reference, isolatedLeft, isolatedRight, installed]) world.dispose();
});
