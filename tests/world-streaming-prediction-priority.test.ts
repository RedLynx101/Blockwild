import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as THREE from "three";
import { BlockId } from "../app/game/data.ts";
import {
  ChunkWorld, RendererTerrainPageStoreR11, RendererTerrainRevisionClockR11,
  CHUNK_SIZE, MIN_Y, SECTION_COUNT, SECTION_HEIGHT, WORLD_HEIGHT, type Chunk,
} from "../app/game/world.ts";

const ownership = (world: ChunkWorld) => (world as unknown as { pendingEditMeshes: Set<string> }).pendingEditMeshes;
const activeMeshIdentity = (world: ChunkWorld) => [world.activeMeshTask?.key, world.activeMeshTask?.section];
function occupy(chunk: Chunk, section: number) {
  chunk.blocks[section * SECTION_HEIGHT * CHUNK_SIZE * CHUNK_SIZE] = BlockId.Stone;
  chunk.sectionBlockCounts[section] = 1;
}
function addChunk(world: ChunkWorld, cx: number, cz: number) {
  const key = `${cx},${cz}`;
  const chunk: Chunk = {
    key, cx, cz, blocks: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT),
    heightmap: new Int16Array(CHUNK_SIZE * CHUNK_SIZE), biomes: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
    group: new THREE.Group(), presentationVisible: true, sections: new Map([[6, {}]]), combinedMeshes: {},
    rendererTerrain: new RendererTerrainPageStoreR11(key, cx, cz, new RendererTerrainRevisionClockR11()),
    dirty: new Set(), sectionBlockCounts: new Uint16Array(SECTION_COUNT), skyTops: new Int16Array(CHUNK_SIZE * CHUNK_SIZE),
    light: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT), lightInitialized: true,
    lightIndices: new Set(), leafIndices: new Set(),
  };
  occupy(chunk, 6); world.chunks.set(key, chunk); world.group.add(chunk.group);
  return chunk;
}
function fixture(context: TestContext, meshCost = 10) {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  context.after(() => world.dispose());
  world.reset("PREDICTED-MESH-PRIORITY", undefined, { structures: false });
  world.playerChunkX = 0; world.playerChunkZ = 0; world.playerSection = 6;
  world.streamingLookaheadChunkX = 1; world.streamingLookaheadChunkZ = 0;
  world.scheduledViewSector = world.streamingViewSector;
  world.scheduledLookaheadChunkX = 1; world.scheduledLookaheadChunkZ = 0;
  for (let x = -1; x <= 1; x += 1) for (let z = -1; z <= 1; z += 1) addChunk(world, x, z);
  // Keep genuine update/category/meshing behavior, but no unrelated terrain or light work.
  Object.assign(world, { processGenerationSlice: () => false, processLightingSlice: () => false,
    processConsolidation: () => false });
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const rebuild = world.rebuildSection.bind(world);
  context.mock.method(world, "rebuildSection", (...args: Parameters<ChunkWorld["rebuildSection"]>) => {
    rebuild(...args); now += meshCost;
  });
  return { world, elapsed: (value: number) => { now = value; },
    step: (velocityX = 4, velocityZ = 0) => { now = 0; return world.update(8, 8, 40, velocityX, velocityZ); } };
}
function prediction(context: TestContext, meshCost = 10, targetZ = 0) {
  const setup = fixture(context, meshCost); const { world } = setup;
  const target = addChunk(world, 2, targetZ); occupy(target, 5); world.queueMesh(target.key, 5);
  const background = world.chunks.get("0,0")!; occupy(background, 3); background.sections.set(3, {});
  world.queueMesh(background.key, 3, true); world.seamMeshRebuilds.add(`${background.key}:3`);
  return { ...setup, target, background };
}
function edit(world: ChunkWorld, chunk: Chunk, section = 3) {
  // An actual edit admission path, deliberately away from vertical/chunk boundaries.
  world.refreshEditedBlock(chunk.cx, chunk.cz, 8, MIN_Y + section * SECTION_HEIGHT + 8, 8, false);
}

function completeArrivalLighting(world: ChunkWorld, cx = 4, cz = 0) {
  const arrival = addChunk(world, cx, cz); arrival.sections.clear();
  const lighting = world as unknown as {
    queueLightReconciliation(chunk: Chunk): void;
    processLightReconciliation(preferredKey?: string): boolean;
  };
  const completed = world.streamingDiagnostics().throughput.lighting;
  // Exercise the real bounded light completion -> prepareGeneratedChunk ->
  // queueChunkMeshesAndSeams -> preemptMeshForPlayer path, not a direct preempt call.
  lighting.queueLightReconciliation(arrival);
  for (let guard = 0; world.lightReconciliationQueued.has(arrival.key); guard += 1) {
    assert.ok(guard < 512, "the arriving chunk must finish real seam-light reconciliation");
    assert.equal(lighting.processLightReconciliation(arrival.key), true);
  }
  assert.equal(world.streamingDiagnostics().throughput.lighting, completed + 1);
  assert.ok(world.meshQueued.has(`${arrival.key}:6`) || world.seamPresentationPending.has(`${arrival.key}:6`),
    "the completion must reach real mesh/seam admission");
}

for (const backgroundKind of ["seam", "ordinary"] as const) {
  test(`real lighting arrivals preserve and finish useful partial prediction ahead of nearer deep ${backgroundKind} work`, context => {
    const { world, target, background, step } = prediction(context);
    if (backgroundKind === "ordinary") {
      world.cancelQueuedMesh(background.key, 3); world.queueMesh(background.key, 3);
    }
    const budgets = [world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds];
    step(); const active = world.activeMeshTask;
    assert.ok(active); assert.equal(active.nextLocalX, 1);
    for (let arrival = 0; arrival < 3; arrival += 1) {
      completeArrivalLighting(world, 4, arrival - 1);
      assert.ok(world.activeMeshTask === active, "ordinary current-chunk depth must not discard predictive buckets");
      const before: number = active.nextLocalX; const report = step();
      assert.equal(world.activeMeshTask, active); assert.equal(active.nextLocalX, before + 1);
      assert.equal(report.meshSlices, 1);
    }
    for (let attempt = 0; attempt < CHUNK_SIZE && !target.sections.has(5); attempt += 1) step();
    assert.equal(target.sections.has(5), true, "repeated arrivals must not restart the same local section forever");
    assert.equal((backgroundKind === "seam" ? world.urgentMeshQueued : world.meshQueued).has(`${background.key}:3`), true);
    assert.deepEqual([world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds], budgets);
  });
}

test("real lighting completion preserves a useful active predictive seam dependency", context => {
  const { world, target, step } = prediction(context);
  world.cancelQueuedMesh(target.key, 5);
  const blocker = addChunk(world, 3, 0); occupy(blocker, 5); blocker.sections.set(5, {});
  world.queueMesh(blocker.key, 5, true); world.seamMeshRebuilds.add(`${blocker.key}:5`);
  world.seamPresentationPending.set(`${target.key}:5`, { key: target.key, section: 5, urgent: false,
    blockers: new Set([`${blocker.key}:5`]) });
  step(); const active = world.activeMeshTask;
  assert.equal(active?.key, blocker.key);
  completeArrivalLighting(world, 5, 0);
  assert.ok(world.activeMeshTask === active, "lighting completion must preserve the active dependency");
  step(); assert.equal(world.activeMeshTask?.nextLocalX, 2);
  for (let attempt = 0; attempt < CHUNK_SIZE * 2 && !target.sections.has(5); attempt += 1) step();
  assert.equal(target.sections.has(5), true);
});

for (const urgent of ["edit", "coalesced-edit", "unknown"] as const) {
  test(`real lighting completion still preempts prediction for protected urgent ${urgent}`, context => {
    const { world, background, target, step } = prediction(context);
    step(); assert.equal(world.activeMeshTask?.key, target.key);
    if (urgent !== "coalesced-edit") world.seamMeshRebuilds.delete(`${background.key}:3`);
    if (urgent !== "unknown") edit(world, background);
    completeArrivalLighting(world);
    assert.equal(world.activeMeshTask, null, "the urgent current-chunk work must retain preemption");
    assert.equal(world.meshQueued.has(`${target.key}:5`), true);
    step(); assert.deepEqual(activeMeshIdentity(world), [background.key, 3]);
  });
}

test("real lighting completion does not hide a protected urgent edit behind the best-ranked seam", context => {
  const { world, background, target, step } = prediction(context);
  step(); assert.equal(world.activeMeshTask?.key, target.key);
  occupy(background, 2); background.sections.set(2, {}); edit(world, background, 2);
  assert.equal(ownership(world).has(`${background.key}:2`), true);
  completeArrivalLighting(world);
  assert.equal(world.activeMeshTask, null, "a lower-ranked protected urgent candidate still permits preemption");
  assert.equal(world.meshQueued.has(`${target.key}:5`), true);
  step(); assert.deepEqual(activeMeshIdentity(world), [background.key, 2]);
});

for (const currentKey of ["0,0", "1,0"]) {
  test(`real lighting completion does not preserve prediction over missing current-ring ${currentKey}`, context => {
    const { world, target, step } = prediction(context);
    step(); assert.equal(world.activeMeshTask?.key, target.key);
    const missing = world.chunks.get(currentKey)!; missing.sections.delete(6); world.queueMesh(missing.key, 6, true);
    completeArrivalLighting(world);
    assert.equal(world.activeMeshTask, null);
    step(); assert.deepEqual(activeMeshIdentity(world), [missing.key, 6]);
  });
}

for (const obsolete of ["stopped", "reversed", "already-built"] as const) {
  test(`real lighting completion does not preserve ${obsolete} predictive work`, context => {
    const { world, target, step } = prediction(context);
    step(); assert.equal(world.activeMeshTask?.key, target.key);
    if (obsolete === "stopped") world.streamingLookaheadChunkX = 0;
    if (obsolete === "reversed") world.streamingLookaheadChunkX = -1;
    if (obsolete === "already-built") target.sections.set(5, {});
    completeArrivalLighting(world);
    assert.equal(world.activeMeshTask, null);
    assert.equal(world.meshQueued.has(`${target.key}:5`), true);
  });
}

test("an existing background turn builds the predicted missing local section before nearer deep seam work", context => {
  const { world, target, background, step } = prediction(context);
  world.queueMesh(target.key, 6, true); world.seamMeshRebuilds.add(`${target.key}:6`);
  const report = step();
  assert.equal(world.streamingDiagnostics().immediateRing.ready, 9);
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section, world.activeMeshTask?.nextLocalX], [target.key, 5, 1]);
  assert.equal(world.urgentMeshQueued.has(`${background.key}:3`), true);
  assert.equal(world.urgentMeshQueued.has(`${target.key}:6`), true, "prediction must select an exact section");
  assert.equal(report.meshSlices, 1); assert.equal(report.generationSlices, 0); assert.equal(report.lightingSlices, 0);
  assert.deepEqual([world.playerChunkX, world.playerChunkZ], [0, 0], "prediction acts before crossing");
});

test("predicted local presentation inherits the exact direct runnable seam dependency", context => {
  const { world, target, step } = prediction(context);
  world.cancelQueuedMesh(target.key, 5);
  const blocker = addChunk(world, 3, 0); occupy(blocker, 5); blocker.sections.set(5, {});
  world.queueMesh(blocker.key, 6, true); world.seamMeshRebuilds.add(`${blocker.key}:6`);
  world.queueMesh(blocker.key, 5, true); world.seamMeshRebuilds.add(`${blocker.key}:5`);
  world.seamPresentationPending.set(`${target.key}:5`, { key: target.key, section: 5, urgent: false,
    blockers: new Set([`${blocker.key}:5`]) });
  step();
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section], [blocker.key, 5]);
  for (let attempt = 0; attempt < 40 && !target.sections.has(5); attempt += 1) step();
  assert.equal(target.sections.has(5), true);
  assert.equal(world.seamPresentationPending.has(`${target.key}:5`), false);
  assert.equal(world.urgentMeshQueued.has(`${blocker.key}:6`), true);
});

test("current-ring repair retains its existing correctness reservation ahead of prediction", context => {
  const { world, target, step } = prediction(context);
  const immediate = world.chunks.get("1,0")!; immediate.sections.delete(6); world.queueMesh(immediate.key, 6);
  const report = step();
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section], [immediate.key, 6]);
  assert.equal(world.meshQueued.has(`${target.key}:5`), true);
  assert.equal(report.meshSlices, 1);
});

for (const coalesced of [false, true]) {
  test(`urgent edit ownership precedes prediction${coalesced ? " when coalesced with a seam" : ""}`, context => {
    const { world, background, target, step } = prediction(context);
    if (!coalesced) world.seamMeshRebuilds.delete(`${background.key}:3`);
    edit(world, background);
    assert.equal(ownership(world)?.has(`${background.key}:3`), true);
    step();
    assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section], [background.key, 3]);
    assert.equal(world.meshQueued.has(`${target.key}:5`), true);
    assert.equal(ownership(world)?.has(`${background.key}:3`), true, "ownership persists during partial work");
  });
}

test("unclassified urgent non-seam work conservatively keeps precedence", context => {
  const { world, background, target, step } = prediction(context);
  world.seamMeshRebuilds.delete(`${background.key}:3`);
  step();
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section], [background.key, 3]);
  assert.equal(world.meshQueued.has(`${target.key}:5`), true);
});

test("a new coalesced edit preempts predictive work without losing its queued ownership", context => {
  const { world, background, target, step } = prediction(context);
  step(); assert.equal(world.activeMeshTask?.key, target.key);
  edit(world, background); step();
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section], [background.key, 3]);
  assert.equal(world.meshQueued.has(`${target.key}:5`), true);
});

test("useful active predictive work keeps progress when a better-ranked predicted section arrives", context => {
  const { world, target, step } = prediction(context, 10, -1);
  step();
  const newer = addChunk(world, 2, 0); newer.sections.delete(6); world.queueMesh(newer.key, 6);
  step();
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section, world.activeMeshTask?.nextLocalX], [target.key, 5, 2]);
  assert.equal(world.meshQueued.has(`${newer.key}:6`), true);
});

test("an active direct predictive dependency retains partial work until it releases its target", context => {
  const { world, target, step } = prediction(context);
  world.cancelQueuedMesh(target.key, 5);
  const blocker = addChunk(world, 3, 0); occupy(blocker, 5); blocker.sections.set(5, {});
  world.queueMesh(blocker.key, 5, true); world.seamMeshRebuilds.add(`${blocker.key}:5`);
  world.seamPresentationPending.set(`${target.key}:5`, { key: target.key, section: 5, urgent: false,
    blockers: new Set([`${blocker.key}:5`]) });
  step();
  const newer = addChunk(world, 2, 1); newer.sections.delete(6); world.queueMesh(newer.key, 6);
  step();
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section, world.activeMeshTask?.nextLocalX], [blocker.key, 5, 2]);
});

test("direction reversal changes predictive selection before crossing and requeues obsolete active work", context => {
  const { world, target, step } = prediction(context);
  const west = addChunk(world, -2, 0); occupy(west, 5); world.queueMesh(west.key, 5);
  step(); assert.equal(world.activeMeshTask?.key, target.key);
  step(-4);
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section], [west.key, 5]);
  assert.equal(world.meshQueued.has(`${target.key}:5`), true);
  assert.deepEqual([world.playerChunkX, world.playerChunkZ], [0, 0]);
});

test("stopping removes predicted priority and restores ordinary background ordering", context => {
  const { world, background, target, step } = prediction(context);
  step(0);
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section], [background.key, 3]);
  assert.equal(world.meshQueued.has(`${target.key}:5`), true);
});

for (const invalid of ["hidden", "unlit", "reconciling", "unoccupied", "already-built"] as const) {
  test(`prediction does not dispatch a ${invalid} target`, context => {
    const { world, target, background, step } = prediction(context);
    if (invalid === "hidden") target.group.visible = false;
    if (invalid === "unlit") target.lightInitialized = false;
    if (invalid === "reconciling") world.lightReconciliationQueued.add(target.key);
    if (invalid === "unoccupied") target.sectionBlockCounts[5] = 0;
    if (invalid === "already-built") target.sections.set(5, {});
    step(); assert.equal(world.activeMeshTask?.key, background.key);
  });
}

test("prediction does not add a beyond-budget reserved mesh turn", context => {
  const { world, target, step, elapsed } = prediction(context);
  world.frame = 3; // Category0 is next; simulate generation consuming the normal allowance.
  world.processGenerationSlice = () => { elapsed(10); return true; };
  const budgets = [world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds];
  const report = step();
  assert.equal(report.generationSlices, 1); assert.equal(report.meshSlices, 0);
  assert.equal(world.activeMeshTask, null); assert.equal(world.meshQueued.has(`${target.key}:5`), true);
  assert.deepEqual([world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds], budgets);
});

test("prediction consumes no more than the existing background mesh slice count", context => {
  const { world, step } = prediction(context, 0);
  const report = step();
  assert.equal(report.meshSlices, world.meshWorkPerFrame * 2);
  assert.equal(world.activeMeshTask?.nextLocalX, report.meshSlices);
  assert.equal(report.generationSlices, 0); assert.equal(report.lightingSlices, 0);
});

test("edit ownership survives requeue during an active seam build and retires only after final installation", context => {
  const { world, background } = prediction(context);
  edit(world, background); world.processMesh(background.key, 3);
  edit(world, background);
  for (let i = 0; i < 15; i += 1) world.processMesh(background.key, 3);
  assert.equal(ownership(world)?.has(`${background.key}:3`), true, "a later edit requires another complete pass");
  for (let i = 0; i < 16; i += 1) world.processMesh(background.key, 3);
  assert.equal(ownership(world)?.has(`${background.key}:3`), false);
});

for (const action of ["cancel", "reset", "unload", "dispose", "schedule-prune", "active-schedule-prune"] as const) {
  test(`pending edit ownership is removed by ${action}`, context => {
    const { world, background } = prediction(context);
    edit(world, background); assert.equal(ownership(world)?.has(`${background.key}:3`), true);
    if (action === "cancel") world.cancelQueuedMesh(background.key, 3);
    if (action === "reset") world.reset("PREDICTION-CLEANUP", undefined, { structures: false });
    if (action === "unload") world.unloadChunk(background.key);
    if (action === "dispose") world.dispose();
    if (action === "active-schedule-prune") world.processMesh(background.key, 3);
    if (action === "schedule-prune" || action === "active-schedule-prune") world.scheduleAround(11 * CHUNK_SIZE + 8, 8, true, 40);
    assert.equal(ownership(world)?.has(`${background.key}:3`), false);
  });
}

test("deferred batch edits and hidden chest visual changes record explicit edit ownership", context => {
  const { world, background } = prediction(context);
  context.mock.method(world.lightEngine, "rebuildAround", () => {});
  world.setBlocksBatch([{ x: 8, y: MIN_Y + 3 * SECTION_HEIGHT + 8, z: 8, type: BlockId.Stone }], true, false);
  assert.equal(ownership(world)?.has(`${background.key}:3`), true);
  world.cancelQueuedMesh(background.key, 3); background.group.visible = false;
  world.setChestVisualHidden(8, MIN_Y + 3 * SECTION_HEIGHT + 8, 8, true);
  assert.equal(ownership(world)?.has(`${background.key}:3`), true);
});

test("the native dirty-section projection also retains coalesced edit ownership", context => {
  const { world, background, step } = prediction(context);
  // Focus on the post-validation dirty-section admission seam. The separate R4
  // awaited-mutation suite verifies receipt/world/hash validation before this call.
  const projection = world as unknown as {
    applyRustWorldProjectionChangesR4V2(changes: readonly never[], dirty: {
      sections: { chunkX: number; chunkZ: number; sectionY: number }[];
    }, immediate: boolean, deferLighting: boolean): void;
  };
  projection.applyRustWorldProjectionChangesR4V2([], {
    sections: [{ chunkX: background.cx, chunkZ: background.cz, sectionY: 3 }],
  }, false, false);
  assert.equal(ownership(world)?.has(`${background.key}:3`), true);
  step(); assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section], [background.key, 3]);
});

test("empty no-op edit admission does not create pending ownership", context => {
  const { world, background } = prediction(context);
  edit(world, background, 2);
  assert.equal(ownership(world)?.has(`${background.key}:2`), false);
});
