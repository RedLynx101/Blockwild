import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as THREE from "three";
import { BlockId } from "../app/game/data.ts";
import {
  ChunkWorld, RendererTerrainPageStoreR11, RendererTerrainRevisionClockR11,
  CHUNK_SIZE, SECTION_COUNT, SECTION_HEIGHT, WORLD_HEIGHT, type Chunk,
} from "../app/game/world.ts";

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
function occupy(chunk: Chunk, section: number) {
  chunk.blocks[section * SECTION_HEIGHT * CHUNK_SIZE * CHUNK_SIZE] = BlockId.Stone;
  chunk.sectionBlockCounts[section] = 1;
}
function worldFixture(context: TestContext) {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  context.after(() => world.dispose());
  world.reset("SEAM-PRIORITY-UNIT", undefined, { structures: false });
  world.playerChunkX = 0; world.playerChunkZ = 0; world.playerSection = 6;
  world.scheduledViewSector = world.streamingViewSector;
  world.scheduledLookaheadChunkX = world.streamingLookaheadChunkX;
  world.scheduledLookaheadChunkZ = world.streamingLookaheadChunkZ;
  for (let x = -1; x <= 1; x += 1) for (let z = -1; z <= 1; z += 1) addChunk(world, x, z);
  return world;
}
function dependencyFixture(context: TestContext) {
  const world = worldFixture(context);
  const arriving = world.chunks.get("1,0")!;
  occupy(arriving, 5); arriving.dirty.add(5);
  const blocker = addChunk(world, 2, 0); occupy(blocker, 5); blocker.sections.set(5, {});
  // Section6 is nearer the camera height and deliberately competes in the same urgent
  // chunk queue. Only section5 unblocks the missing local-height section in the ring.
  world.queueMesh(blocker.key, 6, true); world.queueMesh(blocker.key, 5, true);
  world.seamMeshRebuilds.add(`${blocker.key}:5`);
  world.seamPresentationPending.set(`${arriving.key}:5`, {
    key: arriving.key, section: 5, urgent: true, blockers: new Set([`${blocker.key}:5`]),
  });
  return { world, arriving, blocker };
}

test("the reserved immediate-ring pass starts the exact queued seam dependency with an exhausted background budget", context => {
  const { world, arriving, blocker } = dependencyFixture(context);
  const budgets = [world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds];
  // Model earlier frame work using a deterministic clock, without changing production
  // budgets: the first timestamp starts the frame, then time exceeds its5ms allowance.
  let reads = 0; let now = 10;
  context.mock.method(performance, "now", () => ++reads === 1 ? 0 : (now += 0.001));
  const report = world.update(8, 8, 40);
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section, world.activeMeshTask?.nextLocalX], [blocker.key, 5, 1]);
  assert.equal(world.urgentMeshQueued.has(`${blocker.key}:6`), true, "unrelated urgent work must remain queued");
  assert.equal(arriving.sections.has(5), false, "starting the dependency must not invent a completed dependent section");
  assert.equal(report.meshSlices, 1); assert.equal(report.generationSlices, 0); assert.equal(report.lightingSlices, 0);
  assert.deepEqual([world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds], budgets);
});

test("dependency completion releases and then builds the arriving required section", context => {
  const { world, arriving, blocker } = dependencyFixture(context);
  for (let attempt = 0; attempt < 40 && !arriving.sections.has(5); attempt += 1) world.processMesh(arriving.key);
  assert.equal(arriving.sections.has(5), true);
  assert.equal(world.seamPresentationPending.has(`${arriving.key}:5`), false);
  assert.equal(world.seamMeshRebuilds.has(`${blocker.key}:5`), false);
  assert.equal(world.urgentMeshQueued.has(`${blocker.key}:6`), true, "dependency inheritance must not drain unrelated work first");
  assert.equal(world.streamingDiagnostics().immediateRing.ready, 9);
});

test("an unrelated active section of the dependency chunk yields to the exact inherited section", context => {
  const { world, arriving, blocker } = dependencyFixture(context);
  world.processMesh(blocker.key);
  assert.equal(world.activeMeshTask?.section, 6);
  world.processMesh(arriving.key);
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section, world.activeMeshTask?.nextLocalX], [blocker.key, 5, 1]);
  assert.equal(world.urgentMeshQueued.has(`${blocker.key}:6`), true);
});

test("an already-active critical seam dependency keeps its progress when another blocker becomes eligible", context => {
  const { world, arriving, blocker } = dependencyFixture(context);
  world.processMesh(arriving.key);
  assert.equal(world.activeMeshTask?.section, 5);
  const other = world.chunks.get("0,1")!; occupy(other, 5); other.sections.set(5, {});
  world.queueMesh(other.key, 5, true); world.seamMeshRebuilds.add(`${other.key}:5`);
  world.seamPresentationPending.get(`${arriving.key}:5`)!.blockers.add(`${other.key}:5`);
  world.processMesh(arriving.key);
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section, world.activeMeshTask?.nextLocalX], [blocker.key, 5, 2]);
  assert.equal(world.urgentMeshQueued.has(`${other.key}:5`), true);
});

test("runnable local required work is not displaced by a different blocked local section", context => {
  const { world, arriving } = dependencyFixture(context);
  arriving.sections.delete(6); world.queueMesh(arriving.key, 6);
  world.processMesh(arriving.key);
  assert.deepEqual([world.activeMeshTask?.key, world.activeMeshTask?.section], [arriving.key, 6]);
});

for (const reason of ["hidden", "unlit", "reconciling", "unowned", "itself-blocked"] as const) {
  test(`inherited seam dispatch does not run a ${reason} dependency`, context => {
    const { world, arriving, blocker } = dependencyFixture(context);
    if (reason === "hidden") blocker.group.visible = false;
    if (reason === "unlit") blocker.lightInitialized = false;
    if (reason === "reconciling") world.lightReconciliationQueued.add(blocker.key);
    if (reason === "unowned") { world.urgentMeshQueued.delete(`${blocker.key}:5`); world.seamMeshRebuilds.delete(`${blocker.key}:5`); }
    if (reason === "itself-blocked") world.seamPresentationPending.set(`${blocker.key}:5`, {
      key: blocker.key, section: 5, urgent: true, blockers: new Set([`${arriving.key}:5`]),
    });
    assert.equal(world.processMesh(arriving.key), false);
    assert.equal(world.activeMeshTask, null);
    assert.equal(arriving.sections.has(5), false);
    assert.equal(world.urgentMeshQueued.has(`${blocker.key}:6`), true);
  });
}

test("an occupied never-built section is not reported drawable merely because no source page exists yet", context => {
  const world = worldFixture(context); const arriving = world.chunks.get("1,0")!;
  arriving.sections.delete(6);
  const diagnostic = world.streamingDiagnostics();
  assert.equal(diagnostic.immediateRing.ready, 8);
  const presentation = diagnostic.playerTerrainPresentation.chunks.find(chunk => chunk.key === arriving.key)!;
  assert.deepEqual(presentation.requiredSections[0].requiredLayers, []);
  assert.equal(presentation.requiredSections[0].ready, false);
  assert.equal(presentation.ready, false);
  assert.equal(diagnostic.playerTerrainPresentation.ready, 8);
});

test("a completed section with no required render pages retains empty-layer readiness semantics", context => {
  const world = worldFixture(context);
  const diagnostic = world.streamingDiagnostics();
  assert.equal(diagnostic.immediateRing.ready, 9);
  assert.equal(diagnostic.playerTerrainPresentation.ready, 9);
  for (const chunk of diagnostic.playerTerrainPresentation.chunks) {
    assert.equal(chunk.ready, true);
    assert.deepEqual(chunk.requiredSections[0].requiredLayers, []);
    assert.equal(chunk.requiredSections[0].ready, true);
  }
});
