import assert from "node:assert/strict";
import test from "node:test";
import { BasicWorldRenderer, disabledBasicWorldRendererStats } from "../app/game/basic-world-renderer.ts";
import { BiomeId, normalizeWorldGenerationOptions, type ChunkWorld, type ColumnSample } from "../app/game/world.ts";

const column: ColumnSample = { height: 42, waterline: 32, biome: BiomeId.Meadow, temperature: 0.5, moisture: 0.5, continental: 0.5, river: 0, mountain: 0 };
const world = {
  seed: 19,
  seedText: "BASIC-RENDERER",
  sampleColumn: () => column,
  terrainGenerationAuthority: { mode: "typescript" },
} as unknown as ChunkWorld;
const generationOptions = normalizeWorldGenerationOptions();

test("feature-gated basic rendering reports deliberate zero work", () => {
  assert.deepEqual(disabledBasicWorldRendererStats(), {
    enabled: false,
    reason: "feature-gated",
    supported: false,
    active: false,
    pausedForFramePressure: false,
    queued: 0,
    oldestJobMilliseconds: 0,
    requested: 0,
    submitted: 0,
    completed: 0,
    failed: 0,
    stale: 0,
    cancelled: 0,
    generationMilliseconds: 0,
    uploadMilliseconds: 0,
    triangles: 0,
    vertices: 0,
    drawCalls: 0,
    bytes: 0,
    ringCompleteness: 1,
    transitions: 0,
    adaptiveDowngrades: 0,
  });
});

test("basic renderer performs no proxy work when basic equals full distance", () => {
  const renderer = new BasicWorldRenderer();
  renderer.update({ world, seedText: world.seedText, generationOptions, x: 0, y: 48, z: 0, fullDistance: 10, basicDistance: 10, caveBlend: 0, framePressure: false, enabled: true, now: 1_000 });
  assert.equal(renderer.stats().active, false);
  assert.equal(renderer.stats().submitted, 0);
  renderer.dispose();
});

test("required Rust mode rejects the legacy proxy before any worker or sampler submission", () => {
  let sampled = 0;
  const rustWorld = {
    ...world,
    terrainGenerationAuthority: { mode: "rust" },
    sampleColumn: () => { sampled += 1; return column; },
  } as unknown as ChunkWorld;
  const renderer = new BasicWorldRenderer(false);
  renderer.update({ world: rustWorld, seedText: rustWorld.seedText, generationOptions, x: 0, y: 48, z: 0, fullDistance: 8, basicDistance: 12, caveBlend: 0, framePressure: false, enabled: true, now: 1_000 });
  const stats = renderer.stats();
  assert.equal(stats.submitted, 0);
  assert.equal(stats.completed, 0);
  assert.equal(stats.reason, "rust-authority-no-legacy-fallback");
  assert.equal(sampled, 0);
  renderer.dispose();
});

test("basic renderer installs two-call-capped geometry and pauses replacement under pressure", () => {
  const renderer = new BasicWorldRenderer();
  renderer.update({ world, seedText: world.seedText, generationOptions, x: 0, y: 48, z: 0, fullDistance: 8, basicDistance: 12, caveBlend: 0, framePressure: false, enabled: true, now: 1_000 });
  const installed = renderer.stats();
  assert.equal(installed.completed, 1);
  assert.equal(installed.ringCompleteness, 1);
  assert.ok(installed.drawCalls <= 2);
  assert.ok(installed.triangles < 180_000);
  assert.ok(installed.bytes < 16 * 1024 * 1024);

  renderer.update({ world, seedText: world.seedText, generationOptions, x: 96, y: 48, z: 0, fullDistance: 8, basicDistance: 12, caveBlend: 0, framePressure: true, enabled: true, now: 2_000 });
  const pressured = renderer.stats(true);
  assert.equal(pressured.submitted, 1, "frame pressure must not schedule replacement work");
  assert.equal(pressured.ringCompleteness, 0.5, "the last complete mesh remains while replacement is deferred");
  assert.equal(pressured.adaptiveDowngrades, 1);
  renderer.dispose();
});

