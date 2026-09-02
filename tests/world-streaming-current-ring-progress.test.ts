import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as THREE from "three";
import { BlockId } from "../app/game/data.ts";
import {
  ChunkWorld, RendererTerrainPageStoreR11, RendererTerrainRevisionClockR11,
  CHUNK_SIZE, MIN_Y, SECTION_COUNT, SECTION_HEIGHT, WORLD_HEIGHT, type Chunk,
} from "../app/game/world.ts";

const REQUIRED_SECTION = 1;
const PLAYER_SECTION = 2;
const activeMeshIdentity = (world: ChunkWorld) => [world.activeMeshTask?.key, world.activeMeshTask?.section];
function occupy(chunk: Chunk, section: number) {
  const index = CHUNK_SIZE * (8 + CHUNK_SIZE * (section * SECTION_HEIGHT + 8));
  chunk.blocks[index] = BlockId.Stone;
  chunk.sectionBlockCounts[section] = 1;
}
function addChunk(world: ChunkWorld, cx: number, cz: number) {
  const key = `${cx},${cz}`;
  const chunk: Chunk = {
    key, cx, cz, blocks: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT),
    heightmap: new Int16Array(CHUNK_SIZE * CHUNK_SIZE), biomes: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
    group: new THREE.Group(), presentationVisible: true, sections: new Map(), combinedMeshes: {},
    rendererTerrain: new RendererTerrainPageStoreR11(key, cx, cz, new RendererTerrainRevisionClockR11()),
    dirty: new Set(), sectionBlockCounts: new Uint16Array(SECTION_COUNT), skyTops: new Int16Array(CHUNK_SIZE * CHUNK_SIZE),
    light: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT), lightInitialized: true,
    lightIndices: new Set(), leafIndices: new Set(),
  };
  chunk.group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
  world.chunks.set(key, chunk); world.group.add(chunk.group);
  return chunk;
}
function fixture(context: TestContext, targetX = 1, missingPlayerSection = false,
  additionalMissing?: Readonly<{ key: string; section: number }>) {
  const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  context.after(() => world.dispose());
  world.reset("CURRENT-RING-PARTIAL-PROGRESS", undefined, { structures: false });
  world.playerChunkX = 0; world.playerChunkZ = 0; world.playerSection = PLAYER_SECTION;
  world.scheduledViewSector = world.streamingViewSector;
  world.streamingLookaheadChunkX = 0; world.streamingLookaheadChunkZ = 0;
  world.scheduledLookaheadChunkX = 0; world.scheduledLookaheadChunkZ = 0;
  for (let x = -1; x <= Math.max(1, targetX); x += 1) for (let z = -1; z <= 1; z += 1) {
    const chunk = addChunk(world, x, z);
    for (const section of [REQUIRED_SECTION, PLAYER_SECTION]) {
      occupy(chunk, section);
      if (chunk.key === `${targetX},0` && section === REQUIRED_SECTION) continue;
      if (missingPlayerSection && chunk.key === "0,0" && section === PLAYER_SECTION) continue;
      if (additionalMissing?.key === chunk.key && additionalMissing.section === section) continue;
      world.rebuildSection(chunk, section);
    }
  }
  const target = world.chunks.get(`${targetX},0`)!;
  const current = world.chunks.get("0,0")!;
  const budgets = [world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds];
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const rebuild = world.rebuildSection.bind(world);
  // Charge real mesh work a deterministic over-budget cost. This tests slice
  // reservations, not timing, and does not replace meshing or scheduling.
  context.mock.method(world, "rebuildSection", (...args: Parameters<ChunkWorld["rebuildSection"]>) => {
    rebuild(...args); now += 10;
  });
  world.queueMesh(target.key, REQUIRED_SECTION);
  assert.equal(world.processMesh(target.key, REQUIRED_SECTION), true);
  const active = world.activeMeshTask!;
  assert.equal(active.key, target.key); assert.equal(active.nextLocalX, 1);
  assert.ok(active.buckets.opaque.positions.length > 0, "real partial geometry must exist before the arrival");
  return { world, target, current, active, budgets,
    step: () => { now = 0; return world.update(8, 8, -18); } };
}
function queueBackground(world: ChunkWorld, current: Chunk, kind: "ordinary-deep" | "seam-deep" | "already-built-local") {
  const section = kind === "already-built-local" ? PLAYER_SECTION : 0;
  if (section === 0) occupy(current, section);
  const urgent = kind !== "ordinary-deep";
  if (urgent) {
    if (!current.sections.has(section)) world.rebuildSection(current, section);
    world.seamMeshRebuilds.add(`${current.key}:${section}`);
  }
  world.queueMesh(current.key, section, urgent);
  return section;
}
function completeArrivalLighting(world: ChunkWorld, z = 0) {
  const arrival = addChunk(world, 4, z); occupy(arrival, PLAYER_SECTION);
  const lighting = world as unknown as {
    queueLightReconciliation(chunk: Chunk): void;
    processLightReconciliation(preferredKey?: string): boolean;
  };
  const completed = world.streamingDiagnostics().throughput.lighting;
  lighting.queueLightReconciliation(arrival);
  // Real bounded reconciliation completes through prepareGeneratedChunk ->
  // queueChunkMeshesAndSeams -> preemptMeshForPlayer, not a direct guard call.
  for (let guard = 0; world.lightReconciliationQueued.has(arrival.key); guard += 1) {
    assert.ok(guard < 512, "arrival reconciliation must terminate");
    assert.equal(lighting.processLightReconciliation(arrival.key), true);
  }
  assert.equal(world.streamingDiagnostics().throughput.lighting, completed + 1);
  assert.ok(world.meshQueued.has(`${arrival.key}:${PLAYER_SECTION}`)
    || world.seamPresentationPending.has(`${arrival.key}:${PLAYER_SECTION}`));
}

for (const kind of ["ordinary-deep", "seam-deep", "already-built-local"] as const) {
  test(`lighting arrivals preserve and finish required neighbor progress ahead of ${kind} work before nine-of-nine readiness`, context => {
    const { world, current, target, active, budgets, step } = fixture(context);
    const section = queueBackground(world, current, kind);
    assert.equal(world.streamingDiagnostics().immediateRing.ready, 8);
    const buckets = active.buckets;
    const positions = buckets.opaque.positions;
    for (let arrival = 0; arrival < 3; arrival += 1) {
      const before = structuredClone(buckets);
      completeArrivalLighting(world, arrival - 1);
      assert.ok(world.activeMeshTask === active, "nearer background work must not discard required neighbor progress");
      assert.equal(active.buckets, buckets); assert.equal(active.buckets.opaque.positions, positions);
      assert.deepEqual(active.buckets, before, "lighting completion cannot replace or mutate partial mesh buckets");
      const progress = active.nextLocalX;
      const report = step();
      assert.ok(world.activeMeshTask === active); assert.equal(active.nextLocalX, progress + 1);
      assert.equal(report.meshSlices, 1, "preservation adds no beyond-budget background slice");
    }
    for (let guard = 0; !target.sections.has(REQUIRED_SECTION); guard += 1) {
      assert.ok(guard < CHUNK_SIZE, "repeated arrivals cannot restart the required section forever");
      step();
    }
    assert.ok(target.sections.get(REQUIRED_SECTION)?.opaque?.geometry.getAttribute("position").count);
    assert.equal(world.streamingDiagnostics().immediateRing.ready, 9);
    const queued = kind === "ordinary-deep" ? world.meshQueued : world.urgentMeshQueued;
    assert.equal(queued.has(`${current.key}:${section}`), true, "deferred work retains its queue ownership");
    assert.deepEqual([world.generationWorkPerFrame, world.meshWorkPerFrame, world.streamingFrameBudgetMilliseconds], budgets);
  });
}

test("stationary current-ring progress remains useful after movement direction reverses", context => {
  const { world, current, active } = fixture(context);
  queueBackground(world, current, "ordinary-deep");
  world.streamingLookaheadChunkX = 1;
  completeArrivalLighting(world, -1); assert.ok(world.activeMeshTask === active);
  world.streamingLookaheadChunkX = -1;
  completeArrivalLighting(world, 1); assert.ok(world.activeMeshTask === active);
});

test("missing occupied-chunk required work retains preemption even before it is queued", context => {
  const { world, current, target, active } = fixture(context, 1, true);
  queueBackground(world, current, "ordinary-deep");
  completeArrivalLighting(world);
  assert.equal(world.activeMeshTask, null);
  assert.equal(world.meshQueued.has(`${target.key}:${active.section}`), true);
});

for (const urgent of [false, true]) {
  test(`a higher-priority ${urgent ? "urgent" : "ordinary"} required neighbor is not hidden behind current-chunk background`, context => {
    const { world, current, target, active, step } = fixture(context, 1, false, { key: "0,1", section: REQUIRED_SECTION });
    queueBackground(world, current, "ordinary-deep");
    const competitor = { key: "0,1", section: REQUIRED_SECTION };
    world.queueMesh(competitor.key, competitor.section, urgent);
    const compare = world as unknown as { compareMeshPriority(left: typeof competitor, right: typeof competitor): number };
    assert.ok(compare.compareMeshPriority({ key: current.key, section: 0 }, competitor) < 0,
      "the background candidate must rank ahead of the required competitor");
    assert.ok(compare.compareMeshPriority(competitor, active) < 0,
      "the required competitor must rank ahead of the partial active task");
    completeArrivalLighting(world);
    assert.ok(world.activeMeshTask === null, "higher-priority required work must retain the old preemption boundary");
    assert.equal(world.meshQueued.has(`${target.key}:${REQUIRED_SECTION}`), true);
    assert.equal(step().meshSlices, 1);
    assert.deepEqual(activeMeshIdentity(world), [competitor.key, competitor.section]);
  });
}

test("lower-priority required neighbor work does not discard a useful higher-priority partial build", context => {
  const { world, current, active, step } = fixture(context, 1, false, { key: "0,-1", section: REQUIRED_SECTION });
  queueBackground(world, current, "ordinary-deep");
  const competitor = { key: "0,-1", section: REQUIRED_SECTION };
  world.queueMesh(competitor.key, competitor.section);
  const compare = world as unknown as { compareMeshPriority(left: typeof competitor, right: typeof competitor): number };
  assert.ok(compare.compareMeshPriority(active, competitor) < 0);
  completeArrivalLighting(world);
  assert.ok(world.activeMeshTask === active);
  assert.equal(step().meshSlices, 1);
  assert.ok(world.activeMeshTask === active); assert.equal(active.nextLocalX, 2);
  assert.equal(world.meshQueued.has(`${competitor.key}:${competitor.section}`), true);
});

test("without current-chunk candidates the existing immediate-ring dispatch still preempts for a higher-priority neighbor", context => {
  const { world, active, step } = fixture(context, 1, false, { key: "0,1", section: REQUIRED_SECTION });
  world.queueMesh("0,1", REQUIRED_SECTION);
  completeArrivalLighting(world);
  assert.ok(world.activeMeshTask === active, "the current-key-only lighting hook has no preemption candidate");
  assert.equal(step().meshSlices, 1);
  assert.deepEqual(activeMeshIdentity(world), ["0,1", REQUIRED_SECTION]);
});

for (const blocked of ["unqueued", "unlit", "seam-blocked"] as const) {
  test(`a higher-ranked ${blocked} neighbor is not treated as a runnable mesh competitor`, context => {
    const { world, current, active } = fixture(context, 1, false, { key: "0,1", section: REQUIRED_SECTION });
    queueBackground(world, current, "ordinary-deep");
    if (blocked !== "unqueued") world.queueMesh("0,1", REQUIRED_SECTION);
    if (blocked === "unlit") world.chunks.get("0,1")!.lightInitialized = false;
    if (blocked === "seam-blocked") world.seamPresentationPending.set(`0,1:${REQUIRED_SECTION}`, {
      key: "0,1", section: REQUIRED_SECTION, urgent: true, blockers: new Set(["0,2:1"]),
    });
    completeArrivalLighting(world);
    assert.ok(world.activeMeshTask === active);
  });
}

for (const urgent of ["edit", "coalesced-edit", "unknown"] as const) {
  test(`protected urgent ${urgent} work still preempts required neighbor progress`, context => {
    const { world, current, target } = fixture(context);
    queueBackground(world, current, urgent === "coalesced-edit" ? "seam-deep" : "ordinary-deep");
    if (urgent === "unknown") world.queueMesh(current.key, 0, true);
    else assert.equal(world.setBlock(8, MIN_Y + 8, 8, BlockId.Stone), true);
    completeArrivalLighting(world);
    assert.equal(world.activeMeshTask, null);
    assert.equal(world.meshQueued.has(`${target.key}:${REQUIRED_SECTION}`), true);
    assert.equal(world.urgentMeshQueued.has(`${current.key}:0`), true);
  });
}

test("a lower-ranked protected edit is not hidden by a nearer background candidate", context => {
  const { world, current } = fixture(context);
  queueBackground(world, current, "already-built-local");
  assert.equal(world.setBlock(8, MIN_Y + 8, 8, BlockId.Stone), true);
  completeArrivalLighting(world);
  assert.equal(world.activeMeshTask, null);
});

test("an already-built current candidate retains priority when it blocks another required immediate seam", context => {
  const { world, current } = fixture(context, 1, false, { key: "-1,0", section: PLAYER_SECTION });
  queueBackground(world, current, "already-built-local");
  const dependent = world.chunks.get("-1,0")!;
  world.seamPresentationPending.set(`${dependent.key}:${PLAYER_SECTION}`, {
    key: dependent.key, section: PLAYER_SECTION, urgent: true, blockers: new Set([`${current.key}:${PLAYER_SECTION}`]),
  });
  completeArrivalLighting(world);
  assert.equal(world.activeMeshTask, null, "a required seam dependency is not background work");
});

test("a lower-ranked required seam dependency is not hidden by the best background candidate", context => {
  const { world, current } = fixture(context, 1, false, { key: "-1,0", section: REQUIRED_SECTION });
  queueBackground(world, current, "already-built-local");
  world.queueMesh(current.key, REQUIRED_SECTION, true);
  world.seamMeshRebuilds.add(`${current.key}:${REQUIRED_SECTION}`);
  world.seamPresentationPending.set(`-1,0:${REQUIRED_SECTION}`, {
    key: "-1,0", section: REQUIRED_SECTION, urgent: true, blockers: new Set([`${current.key}:${REQUIRED_SECTION}`]),
  });
  completeArrivalLighting(world);
  assert.equal(world.activeMeshTask, null);
});

test("an active required seam dependency retains its existing protection", context => {
  const { world, current, target, active } = fixture(context, 1, false, { key: "1,1", section: REQUIRED_SECTION });
  queueBackground(world, current, "ordinary-deep");
  const dependent = world.chunks.get("1,1")!;
  world.seamPresentationPending.set(`${dependent.key}:${REQUIRED_SECTION}`, {
    key: dependent.key, section: REQUIRED_SECTION, urgent: true, blockers: new Set([`${target.key}:${REQUIRED_SECTION}`]),
  });
  completeArrivalLighting(world);
  assert.equal(world.activeMeshTask, active);
});

for (const stale of ["no-progress", "completed-progress", "already-built", "hidden", "unlit", "reconciling", "unoccupied", "section-changed", "seam-blocked"] as const) {
  test(`lighting arrival does not protect ${stale} neighbor work`, context => {
    const { world, current, target, active } = fixture(context);
    queueBackground(world, current, "ordinary-deep");
    if (stale === "no-progress") {
      active.nextLocalX = 0;
      for (const bucket of Object.values(active.buckets)) for (const stream of Object.values(bucket)) stream.length = 0;
    }
    if (stale === "completed-progress") active.nextLocalX = CHUNK_SIZE;
    if (stale === "already-built") world.rebuildSection(target, REQUIRED_SECTION);
    if (stale === "hidden") target.group.visible = false;
    if (stale === "unlit") target.lightInitialized = false;
    if (stale === "reconciling") world.lightReconciliationQueued.add(target.key);
    if (stale === "unoccupied") target.sectionBlockCounts[REQUIRED_SECTION] = 0;
    if (stale === "section-changed") {
      occupy(current, 3); world.rebuildSection(current, 3); world.playerSection = 3;
    }
    if (stale === "seam-blocked") world.seamPresentationPending.set(`${target.key}:${REQUIRED_SECTION}`, {
      key: target.key, section: REQUIRED_SECTION, urgent: true, blockers: new Set(["2,0:1"]),
    });
    completeArrivalLighting(world);
    assert.equal(world.activeMeshTask, null);
    assert.equal(world.meshQueued.has(`${target.key}:${REQUIRED_SECTION}`), stale !== "unoccupied");
  });
}

test("stationary work outside the current ring gains no preservation", context => {
  const { world, current, target } = fixture(context, 2);
  queueBackground(world, current, "ordinary-deep");
  completeArrivalLighting(world);
  assert.equal(world.activeMeshTask, null);
  assert.equal(world.meshQueued.has(`${target.key}:${REQUIRED_SECTION}`), true);
});
