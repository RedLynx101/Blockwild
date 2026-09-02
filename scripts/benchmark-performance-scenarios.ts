import { performance } from "node:perf_hooks";
import { BlockId } from "../app/game/data.ts";
import { CreatureArticulatedBatcher, type ArticulatedCreatureInstance } from "../app/game/creature-articulated-batcher.ts";
import { CreatureLodBatcher, type CreatureLodInstance } from "../app/game/creature-lod-batcher.ts";
import { CreatureRenderAdmissionController } from "../app/game/creature-render-admission.ts";
import { XZSpatialIndex } from "../app/game/spatial-index.ts";
import { ChunkWorld } from "../app/game/world.ts";
import { PERFORMANCE_BACKEND_IDENTITY, assertBenchmarkStreamingReady } from "./autoresearch/blockwild-performance-evaluator.mjs";

const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0;
};

const measure = (label: string, iterations: number, operation: (index: number) => void) => {
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    operation(index);
    samples.push(performance.now() - startedAt);
  }
  return {
    label,
    iterations,
    averageMilliseconds: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50Milliseconds: percentile(samples, 0.5),
    p95Milliseconds: percentile(samples, 0.95),
    p99Milliseconds: percentile(samples, 0.99),
    maximumMilliseconds: Math.max(...samples),
  };
};

const world = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
const cleanup: Array<() => void> = [() => world.dispose()];
try {
  const streamingCheckpoints: Record<string, ReturnType<ChunkWorld["streamingDiagnostics"]>> = {};
  const checkpoint = (name: string, target = world) => {
    const streaming = target.streamingDiagnostics();
    assertBenchmarkStreamingReady(streaming, name);
    streamingCheckpoints[name] = streaming;
    return streaming;
  };
  world.reset("PERFORMANCE-SCENARIOS", undefined, { structures: false });
  world.setRenderDistance(2);
  world.setStreamingBudgets(1, 3, 5);
  for (let frame = 0; frame < 240; frame += 1) world.update(0, 0, 32, 0, 0);
  checkpoint("main-warmup");

  const stationary = measure("stationary-settled", 180, () => world.update(0, 0, 32, 0, 0));
  const walking = measure("continuous-walk", 240, (frame) => world.update(frame * 0.07, Math.sin(frame / 30) * 2, 32, 4.2, 0));
  const sprinting = measure("continuous-sprint", 240, (frame) => world.update(18 + frame * 0.14, Math.sin(frame / 18) * 5, 32, 8.4, 0));
  const denseTurn = measure("dense-360-turn-streaming-proxy", 180, (frame) => {
    const angle = frame / 180 * Math.PI * 2;
    world.update(52 + Math.cos(angle) * 2, Math.sin(angle) * 2, 32, Math.cos(angle) * 3, Math.sin(angle) * 3);
  });

  const frozenChanges: Array<{ x: number; y: number; z: number; type: BlockId }> = [];
  for (let z = 0; z < 12; z += 1) for (let x = 0; x < 12; x += 1) {
    frozenChanges.push({ x, y: 0, z, type: (x + z) % 3 === 0 ? BlockId.Ice : BlockId.Water });
  }
  checkpoint("frozen-edit-before");
  const frozenLake = measure("frozen-lake-water-boundary-edit", 24, (pass) => {
    world.setBlocksBatch(frozenChanges.map((change) => ({ ...change, type: pass % 2 === 0 ? change.type : change.type === BlockId.Ice ? BlockId.Water : BlockId.Ice })), false, false, true);
    for (let slice = 0; slice < 10; slice += 1) world.processMesh();
  });
  checkpoint("frozen-edit-after");

  const lodBatcher = new CreatureLodBatcher();
  cleanup.push(() => lodBatcher.dispose());
  const spatial = new XZSpatialIndex<number>(8);
  const creatures: CreatureLodInstance[] = Array.from({ length: 100 }, (_, id) => ({
    kind: "ridgeback",
    color: 0x8d5733,
    position: { x: (id % 10) * 3, y: 1, z: Math.floor(id / 10) * 3 },
    yaw: id * 0.37,
    width: 1.1,
    height: 0.9,
    depth: 1,
  }));
  spatial.rebuild(creatures.map((entry, id) => ({ id, value: id, x: entry.position.x, z: entry.position.z, radius: 0.55, order: id })));
  const hundredCreatures = measure("one-hundred-creature-lod-and-broadphase", 240, (frame) => {
    lodBatcher.update(creatures);
    spatial.queryOverlappingCircle((frame % 10) * 3, Math.floor(frame / 10) % 10 * 3, 8);
  });

  const admission = new CreatureRenderAdmissionController();
  const articulatedBatcher = new CreatureArticulatedBatcher();
  cleanup.push(() => articulatedBatcher.dispose());
  const articulatedCreatures: ArticulatedCreatureInstance[] = creatures.map((creature, id) => ({
    ...creature,
    id,
    accentColor: id % 3 === 0 ? 0xd5c38c : 0x442a1c,
    movement: id % 12 === 0 ? "flying" : id % 15 === 0 ? "aquatic" : "ground",
    gait: id * 0.21,
    age: 4,
  }));
  const admittedArticulation = measure("one-hundred-creature-admission-and-articulation", 240, (frame) => {
    const now = frame * (1_000 / 60);
    admission.evaluate(articulatedCreatures.map((creature, id) => {
      const distance = 8 + id * 1.35;
      return {
        id,
        distance,
        projectedSize: Math.min(1, creature.height / Math.max(1, distance)),
        inFrustum: id % 5 !== 4,
        critical: id < 2,
        important: id >= 2 && id < 6,
        engaged: id >= 6 && id < 10,
      };
    }), { averageFrameMilliseconds: 32, drawCalls: 520 }, now);
    articulatedBatcher.update(articulatedCreatures.filter((creature) => admission.tierFor(creature.id) === "articulated"));
  });

  const settlementWorld = new ChunkWorld({ terrainGenerationAuthorityMode: "typescript" });
  cleanup.push(() => settlementWorld.dispose());
  settlementWorld.reset("PERFORMANCE-SETTLEMENT", undefined, { structures: true });
  settlementWorld.setRenderDistance(2);
  const settlement = measure("settlement-traversal", 240, (frame) => settlementWorld.update(frame * 0.1, 0, 32, 6, 0));
  checkpoint("settlement-traversal-after", settlementWorld);
  const cavern = measure("large-cavern-traversal", 240, (frame) => world.update(80 + frame * 0.08, -32 + Math.sin(frame / 20) * 5, -36, 4.8, 0));
  // Always enter the existing settle loop once so readiness refers to the edit location,
  // not the previous cavern location. This remains outside every measured workload.
  for (let frame = 0; frame < 480 && (frame === 0 || !world.streamingDiagnostics().playerChunkReady); frame += 1) world.update(100, 0, 16, 0, 0);
  checkpoint("player-edit-before");
  const editBurst = measure("player-edit-burst", 40, (pass) => {
    const changes = Array.from({ length: 64 }, (_, index) => ({
      x: 96 + index % 8,
      y: 12 + Math.floor(index / 8),
      z: 0,
      type: pass % 2 === 0 ? BlockId.Stone : BlockId.Air,
    }));
    world.setBlocksBatch(changes, false, false, true);
    world.update(100, 0, 16, 0, 0);
  });
  for (let frame = 0; frame < 480 && !world.streamingDiagnostics().playerChunkReady; frame += 1) world.update(100, 0, 16, 0, 0);
  const finalStreaming = checkpoint("main-final");
  const settlementFinalStreaming = checkpoint("settlement-final", settlementWorld);

  console.log(JSON.stringify({
    benchmark: "blockwild-performance-scenarios-v2",
    backendIdentity: PERFORMANCE_BACKEND_IDENTITY,
    environment: { node: process.version, renderDistance: 2, note: "Explicit legacy TypeScript CPU baseline, not a Rust performance measurement. Browser capture owns GPU and presentation acceptance." },
    scenarios: [stationary, walking, sprinting, denseTurn, frozenLake, hundredCreatures, admittedArticulation, settlement, cavern, editBurst],
    finalStreaming,
    settlementFinalStreaming,
    streamingCheckpoints,
    creatureLod: lodBatcher.diagnostics(),
    creatureAdmission: admission.diagnostics(),
    creatureArticulation: articulatedBatcher.diagnostics(),
  }, null, 2));

} finally {
  // All successfully constructed resources are released even when a checkpoint fails.
  const errors: unknown[] = [];
  for (const dispose of cleanup.reverse()) { try { dispose(); } catch (error) { errors.push(error); } }
  if (errors.length) throw new AggregateError(errors, "Performance benchmark cleanup failed");
}
