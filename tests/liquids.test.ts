import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SWIM_RULES,
  LIQUID_SIMULATION_STEP_SECONDS,
  LiquidSimulator,
  SHORE_MANTLE_SUSTAIN_SECONDS,
  loadedBodyCollisionAt,
  loadedLiquidSurfaceY,
  loadedLowBankShoreLedgeHeight,
  projectBodyOntoForwardMotion,
  stepSwimming,
  waterAnimationPhase,
  waterSurfaceSample,
  type LiquidCell,
  type LiquidPosition,
  type LiquidWorldAdapter,
  type SwimmerState,
} from "../app/game/liquids.ts";
import { BlockId } from "../app/game/data.ts";
import { ChunkWorld, voxelInterfaceFaceOwner } from "../app/game/world.ts";

const key = (position: LiquidPosition) => `${position.x},${position.y},${position.z}`;

class TestLiquidWorld implements LiquidWorldAdapter {
  readonly liquids = new Map<string, LiquidCell>();
  readonly solids = new Set<string>();
  minY = 0;
  maxY = 12;

  getLiquid(position: LiquidPosition) {
    return this.liquids.get(key(position));
  }

  setLiquid(position: LiquidPosition, liquid: LiquidCell | undefined) {
    if (liquid) this.liquids.set(key(position), liquid);
    else this.liquids.delete(key(position));
  }

  isSolid(position: LiquidPosition) {
    return this.solids.has(key(position));
  }
}

function settle(simulator: LiquidSimulator, maxTicks = 200) {
  for (let tick = 0; tick < maxTicks && simulator.pendingCount > 0; tick += 1) simulator.process(256);
  assert.equal(simulator.pendingCount, 0, "liquid frontier should settle under the test bound");
}

test("liquid flow propagates down and sideways while respecting solid cells", () => {
  const world = new TestLiquidWorld();
  for (let z = -8; z <= 8; z += 1) for (let x = -8; x <= 8; x += 1) world.solids.add(`${x},0,${z}`);
  const simulator = new LiquidSimulator(world);
  assert.equal(simulator.addSource({ x: 0, y: 3, z: 0 }), true);
  simulator.process(1);
  assert.deepEqual(world.getLiquid({ x: 0, y: 2, z: 0 }), { kind: "water", level: 1, source: false, falling: true });
  settle(simulator);
  assert.equal(world.getLiquid({ x: 0, y: 1, z: 0 })?.falling, true);
  assert.equal(world.getLiquid({ x: 1, y: 3, z: 0 })?.level, 1);
  assert.equal(world.getLiquid({ x: 8, y: 3, z: 0 }), undefined, "horizontal spread is finite");
  assert.equal(world.getLiquid({ x: 0, y: 0, z: 0 }), undefined, "water never replaces support blocks");
});

test("each liquid tick advances only one horizontal frontier level", () => {
  const world = new TestLiquidWorld();
  for (let z = -8; z <= 8; z += 1) for (let x = -8; x <= 8; x += 1) world.solids.add(`${x},0,${z}`);
  const simulator = new LiquidSimulator(world);
  simulator.addSource({ x: 0, y: 1, z: 0 });

  simulator.process(256);
  assert.equal(world.getLiquid({ x: 1, y: 1, z: 0 })?.level, 1);
  assert.equal(world.getLiquid({ x: 2, y: 1, z: 0 }), undefined, "one update may not drain multiple frontier levels");

  simulator.process(256);
  assert.equal(world.getLiquid({ x: 2, y: 1, z: 0 })?.level, 2);
  assert.equal(LIQUID_SIMULATION_STEP_SECONDS, 0.2);
});

test("two supported water sources renew the cell between them", () => {
  const world = new TestLiquidWorld();
  for (let x = -2; x <= 2; x += 1) world.solids.add(`${x},0,0`);
  const simulator = new LiquidSimulator(world);
  simulator.addSource({ x: -1, y: 1, z: 0 });
  simulator.addSource({ x: 1, y: 1, z: 0 });
  settle(simulator);
  assert.deepEqual(world.getLiquid({ x: 0, y: 1, z: 0 }), { kind: "water", level: 0, source: true, falling: false });
});

test("the liquid queue is deduplicated and work is capped per call", () => {
  const world = new TestLiquidWorld();
  const simulator = new LiquidSimulator(world, { maxOperationsPerTick: 1 });
  simulator.addSource({ x: 0, y: 8, z: 0 });
  const pending = simulator.pendingCount;
  assert.equal(simulator.enqueue({ x: 0, y: 8, z: 0 }), false);
  assert.equal(simulator.pendingCount, pending);
  const changes = simulator.process();
  assert.ok(changes.length <= 5, "one processed cell can affect at most down plus four sides");
  assert.ok(simulator.pendingCount > 0);
});

test("water animation is periodic, spatially varied, and seam-safe", () => {
  const phase = waterAnimationPhase(1250, 4, -9);
  const repeated = waterAnimationPhase(1250 + 1000 / 0.11, 4, -9);
  assert.ok(Math.abs(phase - repeated) < 1e-9);
  assert.notEqual(phase, waterAnimationPhase(1250, 5, -9));
  const sample = waterSurfaceSample(5000, 12, 8);
  assert.ok(Math.abs(sample.heightOffset) < 0.04);
  assert.ok(Math.abs(sample.uvOffset.u) <= 0.018);
  assert.ok(Math.abs(sample.uvOffset.v) <= 0.014);
});

test("ice and water share one deterministic interface owner", () => {
  assert.equal(voxelInterfaceFaceOwner(BlockId.Ice, BlockId.Water), "current");
  assert.equal(voxelInterfaceFaceOwner(BlockId.Water, BlockId.Ice), "neighbor");
  assert.equal(voxelInterfaceFaceOwner(BlockId.Water, BlockId.Water), "none");
  assert.equal(voxelInterfaceFaceOwner(BlockId.Ice, BlockId.Ice), "none");
});

test("water animation advances without re-uploading the block atlas", () => {
  const world = new ChunkWorld();
  const atlasVersion = world.atlas.version;
  world.updateWaterAnimation(120);
  world.updateWaterAnimation(240);
  assert.equal(world.atlas.version, atlasVersion);
  world.dispose();
});

test("swimming drains oxygen, applies drowning ticks, and boosts a same-level shore exit", () => {
  const shore = stepSwimming(
    { velocityY: -0.4, oxygenSeconds: 8, drowningAccumulator: 0 },
    { jumpHeld: true, movingForward: true },
    { submersion: 0.75, headSubmerged: false, horizontalCollision: true, shoreLedgeHeight: 1, surfaceGap: 0.3 },
    1 / 60,
  );
  assert.equal(shore.shoreBoosted, true);
  assert.ok(shore.state.velocityY >= 7.4);
  assert.ok(shore.horizontalSpeedScale < 1);
  assert.equal(shore.state.surfaceBreachReady, false);
  assert.equal(shore.state.shoreExitReady, false);
  assert.equal(shore.state.surfaceBreachSeconds, SHORE_MANTLE_SUSTAIN_SECONDS);
  assert.equal(shore.state.surfaceStrokeCooldownSeconds, 0);
  assert.equal(shore.state.surfaceBobActive, false);

  const drowning = stepSwimming(
    { velocityY: 0, oxygenSeconds: 0, drowningAccumulator: 1.4 },
    { jumpHeld: false, movingForward: false },
    { submersion: 1, headSubmerged: true, horizontalCollision: false },
    0.2,
  );
  assert.equal(drowning.damage, 1);
  assert.ok(drowning.state.drowningAccumulator < 0.2);
});

test("a held shore attempt emits once and sustains one bounded mantle", () => {
  const input = { jumpHeld: true, movingForward: true };
  const shore = {
    submersion: 0.75,
    headSubmerged: false,
    horizontalCollision: true,
    shoreLedgeHeight: 1,
    surfaceGap: 0.3,
    surfaceClearance: 0.1,
  };
  let state: SwimmerState = {
    velocityY: -0.4,
    oxygenSeconds: DEFAULT_SWIM_RULES.maxOxygenSeconds,
    drowningAccumulator: 0,
    entryMomentumSpeed: 0,
    surfaceBreachReady: true,
    shoreExitReady: true,
    surfaceBreachSeconds: 0,
    surfaceStrokeCooldownSeconds: 0,
    surfaceBobActive: false,
  };
  const dt = 1 / 60;
  const accepted = stepSwimming(state, input, shore, dt);
  assert.equal(accepted.shoreBoosted, true);
  assert.equal(accepted.state.velocityY, DEFAULT_SWIM_RULES.shoreExitVelocity);
  assert.equal(accepted.state.surfaceBreachSeconds, SHORE_MANTLE_SUSTAIN_SECONDS);
  assert.equal(accepted.state.surfaceStrokeCooldownSeconds, 0);
  assert.equal(accepted.state.surfaceBobActive, false);
  state = accepted.state;

  let sustainedFrames = 0;
  while ((state.surfaceBreachSeconds ?? 0) > 0 && sustainedFrames < 30) {
    const priorSeconds = state.surfaceBreachSeconds ?? 0;
    const continued = stepSwimming(state, input, { ...shore, horizontalCollision: false }, dt);
    assert.equal(continued.shoreBoosted, false, "sustaining a consumed attempt must not emit another cue");
    assert.ok(continued.state.velocityY >= DEFAULT_SWIM_RULES.shoreExitVelocity);
    assert.ok((continued.state.surfaceBreachSeconds ?? 0) < priorSeconds);
    assert.equal(continued.state.surfaceBreachReady, false, "ordinary surface breach cannot rearm the active mantle");
    assert.equal(continued.state.surfaceStrokeCooldownSeconds, 0);
    assert.equal(continued.state.surfaceBobActive, false);
    state = continued.state;
    sustainedFrames += 1;
  }

  assert.ok(sustainedFrames >= 12 && sustainedFrames <= 13, `0.20s mantle lasted ${sustainedFrames} fixed steps`);
  assert.equal(state.surfaceBreachSeconds, 0);
  assert.equal(state.shoreExitReady, false);

  const exhausted = stepSwimming(state, input, shore, dt);
  assert.equal(exhausted.shoreBoosted, false, "a held press must stay consumed after the sustain timer expires");
  assert.equal(exhausted.state.shoreExitReady, false);
});

test("releasing W aborts a mantle without rearming, while releasing Space rearms", () => {
  const input = { jumpHeld: true, movingForward: true };
  const shore = {
    submersion: 0.75,
    headSubmerged: false,
    horizontalCollision: true,
    shoreLedgeHeight: 1,
    surfaceGap: 0.3,
    surfaceClearance: 0.1,
  };
  const initial = stepSwimming(
    { velocityY: -0.4, oxygenSeconds: 12, drowningAccumulator: 0 },
    input,
    shore,
    1 / 60,
  );
  const forwardReleased = stepSwimming(
    initial.state,
    { jumpHeld: true, movingForward: false },
    shore,
    1 / 60,
  );
  assert.equal(forwardReleased.shoreBoosted, false);
  assert.equal(forwardReleased.state.surfaceBreachSeconds, 0);
  assert.equal(forwardReleased.state.shoreExitReady, false, "W release must not rearm the attempt latch");

  const sameSpacePress = stepSwimming(forwardReleased.state, input, shore, 1 / 60);
  assert.equal(sameSpacePress.shoreBoosted, false, "W re-press under the same Space press must remain consumed");
  assert.equal(sameSpacePress.state.shoreExitReady, false);

  const released = stepSwimming(sameSpacePress.state, { jumpHeld: false, movingForward: true }, shore, 1 / 60);
  assert.deepEqual(
    {
      surfaceBreachReady: released.state.surfaceBreachReady,
      shoreExitReady: released.state.shoreExitReady,
      surfaceBreachSeconds: released.state.surfaceBreachSeconds,
      surfaceStrokeCooldownSeconds: released.state.surfaceStrokeCooldownSeconds,
      surfaceBobActive: released.state.surfaceBobActive,
    },
    {
      surfaceBreachReady: true,
      shoreExitReady: true,
      surfaceBreachSeconds: 0,
      surfaceStrokeCooldownSeconds: 0,
      surfaceBobActive: false,
    },
  );
  const repressed = stepSwimming(released.state, input, shore, 1 / 60);
  assert.equal(repressed.shoreBoosted, true, "release and re-press must start a new shore attempt");
  assert.equal(repressed.state.surfaceBreachReady, false);
  assert.equal(repressed.state.shoreExitReady, false);
});

test("shore qualification checks the complete loaded standing capsule", () => {
  const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const supportKey = cellKey(0, 1, 0);
  const probe = (
    overrides: ReadonlyMap<string, BlockId | undefined> = new Map(),
    radius = 0.3,
  ) => loadedLowBankShoreLedgeHeight({
    surfaceY: 0.5,
    forwardX: 0.38,
    forwardZ: 0,
    radius,
    height: 1.8,
    getBlock: (x, y, z) => {
      const key = cellKey(x, y, z);
      if (overrides.has(key)) return overrides.get(key);
      return key === supportKey ? BlockId.Dirt : BlockId.Air;
    },
  });

  assert.equal(probe(), 1);
  assert.equal(probe(new Map([[cellKey(0, 2, 0), BlockId.Stone]])), undefined, "tall wall");
  assert.equal(probe(new Map([[cellKey(0, 3, 0), BlockId.Stone]])), undefined, "blocked upper headroom");
  assert.equal(probe(new Map([[cellKey(1, 2, 0), BlockId.Stone]]), 0.6), undefined, "intersecting adjacent overhang");
  assert.equal(probe(new Map([[cellKey(1, 2, 0), BlockId.WildwoodTable]]), 0.6), undefined, "partial-shape solids remain native full cells");
  assert.equal(probe(new Map([[cellKey(1, 2, 0), undefined]]), 0.6), undefined, "intersecting adjacent unloaded clearance");
  assert.equal(probe(new Map([[supportKey, undefined]])), undefined, "unknown support");
  assert.equal(probe(new Map([[supportKey, BlockId.Air]])), undefined, "no bank");
});

test("actual projected-body collision is loaded, full-cell, and separate from ledge selection", () => {
  const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const collision = (overrides: ReadonlyMap<string, BlockId | undefined> = new Map()) => loadedBodyCollisionAt({
    x: 0,
    y: 0.51,
    z: 0,
    radius: 0.3,
    height: 1.8,
    getBlock: (x, y, z) => {
      const key = cellKey(x, y, z);
      return overrides.has(key) ? overrides.get(key) : BlockId.Air;
    },
  });
  assert.equal(collision(), "clear", "a bank probe ahead cannot substitute for collision this tick");
  assert.equal(collision(new Map([[cellKey(0, 1, 0), BlockId.Stone]])), "solid");
  assert.equal(collision(new Map([[cellKey(0, 1, 0), BlockId.WildwoodTable]])), "solid", "native treats solid shapes as full cells");
  assert.equal(collision(new Map([[cellKey(0, 2, 0), undefined]])), "unknown");
  assert.equal(collision(new Map([
    [cellKey(0, 1, 0), BlockId.Stone],
    [cellKey(0, 2, 0), undefined],
  ])), "unknown", "unknown clearance wins over a coincident solid hit");
});

test("projected shore collision strips strafe and backward motion", () => {
  const forward = projectBodyOntoForwardMotion(4, -5, 5, -3, 0, 0.1);
  assert.equal(forward.x, 4);
  assert.ok(Math.abs(forward.z - -5.3) <= 1e-12);
  assert.ok(Math.abs(forward.attemptedDistance - 0.3) <= 1e-12);
  assert.deepEqual(projectBodyOntoForwardMotion(4, -5, 5, 0, 0, 0.1), {
    x: 4,
    z: -5,
    attemptedDistance: 0,
  });
  assert.deepEqual(projectBodyOntoForwardMotion(4, -5, 0, 3, 0, 0.1), {
    x: 4,
    z: -5,
    attemptedDistance: 0,
  });
});

test("bounded liquid-surface probes fail closed unless they reach loaded open clearance", () => {
  const column = (...blocks: Array<BlockId | undefined>) => loadedLiquidSurfaceY(0, 4, (y) => blocks[y]);
  assert.equal(column(BlockId.Water, BlockId.Air), 0.5);
  assert.equal(column(BlockId.Water, BlockId.Water, BlockId.Water, BlockId.Air), 2.5);
  assert.equal(column(BlockId.Water, BlockId.Honey, BlockId.Air), 1.5, "all contiguous liquid kinds remain submerged");
  assert.equal(column(BlockId.Water, BlockId.Stone), undefined, "solid ceiling");
  assert.equal(column(BlockId.Water, BlockId.Water, undefined), undefined, "unloaded boundary");
  let invalidLimitReads = 0;
  assert.equal(loadedLiquidSurfaceY(0, Number.POSITIVE_INFINITY, () => {
    invalidLimitReads += 1;
    return BlockId.Water;
  }), undefined, "an unbounded request fails closed");
  assert.equal(invalidLimitReads, 0);
  let boundedReads = 0;
  assert.equal(loadedLiquidSurfaceY(0, Number.MAX_SAFE_INTEGER, () => {
    boundedReads += 1;
    return BlockId.Water;
  }), undefined);
  assert.equal(boundedReads, 513, "even a huge finite request is capped at 512 cells above the start");
  const cappedSurface = column(
    BlockId.Water,
    BlockId.Water,
    BlockId.Water,
    BlockId.Water,
    BlockId.Water,
    BlockId.Air,
  );
  assert.equal(cappedSurface, undefined, "open air beyond the four-cell cap is not authoritative");
  assert.equal(loadedLowBankShoreLedgeHeight({
    surfaceY: cappedSurface,
    forwardX: 0,
    forwardZ: 0,
    radius: 0.3,
    height: 1.8,
    getBlock: () => BlockId.Air,
  }), undefined, "a capped liquid stack cannot qualify a shore ledge");
});

test("shore boost rejects tall cliffs, head submersion, and unclassified collision", () => {

  const state = { velocityY: -0.4, oxygenSeconds: 12, drowningAccumulator: 0 };
  const input = { jumpHeld: true, movingForward: true };
  const lowBank = {
    submersion: 0.75,
    headSubmerged: false,
    horizontalCollision: true,
    shoreLedgeHeight: 1,
    surfaceGap: 0.3,
    surfaceClearance: 0.1,
  };
  for (const [label, environment] of [
    ["tall cliff", { ...lowBank, shoreLedgeHeight: 2 }],
    ["head submerged", { ...lowBank, submersion: 1, headSubmerged: true }],
    ["no classified collision", { ...lowBank, horizontalCollision: false, shoreLedgeHeight: undefined }],
  ] as const) {
    const rejected = stepSwimming(state, input, environment, 1 / 60);
    assert.equal(rejected.shoreBoosted, false, label);
    assert.equal(rejected.state.shoreExitReady, true, label);
  }
});

test("reaching dry ground clears mantle state without rearming a held Space press", () => {
  const input = { jumpHeld: true, movingForward: true };
  const shore = {
    submersion: 0.75,
    headSubmerged: false,
    horizontalCollision: true,
    shoreLedgeHeight: 1,
    surfaceGap: 0.3,
    surfaceClearance: 0.1,
  };
  const accepted = stepSwimming(
    { velocityY: 0, oxygenSeconds: 12, drowningAccumulator: 0 },
    input,
    shore,
    1 / 60,
  );
  const dry = stepSwimming(
    accepted.state,
    input,
    { ...shore, submersion: 0, horizontalCollision: false, shoreLedgeHeight: undefined },
    1 / 60,
  );
  assert.equal(dry.shoreBoosted, false);
  assert.equal(dry.state.surfaceBreachSeconds, 0);
  assert.equal(dry.state.surfaceStrokeCooldownSeconds, 0);
  assert.equal(dry.state.surfaceBobActive, false);
  assert.equal(dry.state.surfaceBreachReady, false);
  assert.equal(dry.state.shoreExitReady, false, "dry contact alone must not rearm the held press");
});

test("alternating liquid, head, and bank contact cannot re-arm a held shore exit", () => {
  const input = { jumpHeld: true, movingForward: true };
  const bank = {
    submersion: 0.75,
    headSubmerged: false,
    horizontalCollision: true,
    shoreLedgeHeight: 1,
    surfaceGap: 0.3,
    surfaceClearance: 0.1,
  };
  const environments = [
    bank,
    { ...bank, horizontalCollision: false },
    { ...bank, submersion: 1, headSubmerged: true, horizontalCollision: false, surfaceClearance: -0.2 },
    bank,
    { ...bank, submersion: 0, horizontalCollision: false },
    { ...bank, submersion: 1, headSubmerged: true, surfaceClearance: -0.2 },
    bank,
  ];
  let state: SwimmerState = {
    velocityY: -0.4,
    oxygenSeconds: DEFAULT_SWIM_RULES.maxOxygenSeconds,
    drowningAccumulator: 0,
    shoreExitReady: true,
  };
  let boosts = 0;
  for (const environment of environments) {
    const step = stepSwimming(state, input, environment, 1 / 60);
    boosts += Number(step.shoreBoosted);
    assert.equal(step.state.surfaceBreachReady, false, "contact oscillation must not rearm surface breach during mantle");
    state = step.state;
  }
  assert.equal(boosts, 1);
  assert.equal(state.shoreExitReady, false);
  assert.equal(
    stepSwimming(state, { ...input, jumpHeld: false }, bank, 1 / 60).state.shoreExitReady,
    true,
    "only a sampled Space release rearms the press latch",
  );
});

test("an idle swimmer settles downward while an intentional swim stroke rises", () => {
  let idle = { velocityY: 0, oxygenSeconds: 12, drowningAccumulator: 0 };
  let rising = { ...idle };
  for (let frame = 0; frame < 120; frame += 1) {
    idle = stepSwimming(
      idle,
      { jumpHeld: false, movingForward: false },
      { submersion: 1, headSubmerged: true, horizontalCollision: false },
      1 / 60,
    ).state;
    rising = stepSwimming(
      rising,
      { jumpHeld: true, movingForward: false },
      { submersion: 1, headSubmerged: true, horizontalCollision: false },
      1 / 60,
    ).state;
  }
  assert.ok(idle.velocityY < -0.75 && idle.velocityY >= -2.3, `idle sink velocity was ${idle.velocityY}`);
  assert.ok(rising.velocityY > 1.5, `jump-held swim velocity was ${rising.velocityY}`);
});

test("sprint-swimming adds exactly twenty percent to vertical stroke acceleration", () => {
  const state = { velocityY: 0, oxygenSeconds: 12, drowningAccumulator: 0 };
  const environment = { submersion: 1, headSubmerged: true, horizontalCollision: false };
  const isolatedStrokeRules = {
    ...DEFAULT_SWIM_RULES,
    buoyancyAcceleration: 0,
    passiveSinkAcceleration: 0,
    waterDrag: 0,
  };
  const ordinary = stepSwimming(state, { jumpHeld: true, movingForward: true }, environment, 0.1, isolatedStrokeRules);
  const sprinting = stepSwimming(state, { jumpHeld: true, movingForward: true, sprinting: true }, environment, 0.1, isolatedStrokeRules);
  assert.ok(Math.abs(sprinting.state.velocityY / ordinary.state.velocityY - 1.2) < 1e-9);
});

test("held swim input produces repeatable breathing bobs without walking on the surface", () => {
  let swimmer: SwimmerState = { velocityY: 0, oxygenSeconds: 12, drowningAccumulator: 0, entryMomentumSpeed: 0 };
  for (const fps of [30, 60, 120]) {
    // Begin roughly the same 0.68 blocks below eye-level breathing depth as
    // the production audit, rather than giving the first stroke a head start.
    let feetY = -2.18;
    swimmer = { velocityY: 0, oxygenSeconds: 12, drowningAccumulator: 0, entryMomentumSpeed: 0 };
    let firstBreathFrame = -1;
    let highestFeetY = feetY;
    let stableLowestFeetY = Number.POSITIVE_INFINITY;
    let stableHighestFeetY = Number.NEGATIVE_INFINITY;
    let stableSubmergedFrames = 0;
    let minimumStableOxygen = 12;
    let strokeStarts = 0;
    const strokeTimes: number[] = [];
    for (let frame = 0; frame < fps * 15; frame += 1) {
      const headSubmerged = feetY + 1.5 < 0;
      const priorCooldown = swimmer.surfaceStrokeCooldownSeconds ?? 0;
      const next = stepSwimming(
        swimmer,
        { jumpHeld: true, movingForward: true },
        { submersion: headSubmerged ? 1 : 0.68, headSubmerged, horizontalCollision: false, surfaceClearance: feetY + 1.5 },
        1 / fps,
      ).state;
      if (priorCooldown <= 0 && (next.surfaceStrokeCooldownSeconds ?? 0) > 0) {
        strokeStarts += 1;
        strokeTimes.push(frame / fps);
      }
      swimmer = next;
      feetY += swimmer.velocityY / fps;
      highestFeetY = Math.max(highestFeetY, feetY);
      if (feetY + 1.5 >= 0 && firstBreathFrame < 0) firstBreathFrame = frame;
      if (firstBreathFrame >= 0 && frame > firstBreathFrame + fps) {
        stableLowestFeetY = Math.min(stableLowestFeetY, feetY);
        stableHighestFeetY = Math.max(stableHighestFeetY, feetY);
        if (feetY + 1.5 < 0) stableSubmergedFrames += 1;
        minimumStableOxygen = Math.min(minimumStableOxygen, swimmer.oxygenSeconds);
      }
    }
    const stableIntervals = strokeTimes.slice(2).map((time, index) => time - strokeTimes[index + 1]);
    const averageInterval = stableIntervals.reduce((sum, interval) => sum + interval, 0) / stableIntervals.length;
    assert.ok(strokeStarts >= 10 && strokeStarts <= 14, `${fps} FPS held Space produced ${strokeStarts} strokes instead of the slower cadence`);
    assert.ok(averageInterval >= 1.05 && averageInterval <= 1.32, `${fps} FPS breathing cycle averaged ${averageInterval}s`);
    assert.ok(highestFeetY > -0.7, `${fps} FPS feet only rose to ${highestFeetY}, which cannot clear the water sample`);
    assert.ok(highestFeetY < -0.25, `${fps} FPS feet rose to ${highestFeetY}, which would become a water-walking launch`);
    assert.ok(stableLowestFeetY > -1.28, `${fps} FPS breathing bob fell too low: ${stableLowestFeetY}`);
    assert.ok(stableHighestFeetY < -0.75, `${fps} FPS breathing bob lifted the body too far: ${stableHighestFeetY}`);
    assert.equal(stableSubmergedFrames, 0, `${fps} FPS held swimming dipped the breathing point underwater`);
    assert.equal(minimumStableOxygen, 12, `${fps} FPS held swimming consumed oxygen after reaching the surface`);
  }

  const released = stepSwimming(
    swimmer,
    { jumpHeld: false, movingForward: false },
    { submersion: 1, headSubmerged: true, horizontalCollision: false },
    1 / 60,
  ).state;
  assert.equal(released.surfaceBreachReady, true, "releasing Space should arm the next intentional breach");
  assert.equal(released.surfaceStrokeCooldownSeconds, 0, "releasing Space should clear the held-stroke recovery timer");
});

test("a real fall carries moderated momentum through the water surface", () => {
  let entered = stepSwimming(
    { velocityY: -16, oxygenSeconds: 12, drowningAccumulator: 0 },
    { jumpHeld: false, movingForward: true },
    { submersion: 0.68, headSubmerged: false, horizontalCollision: false, enteredFromAir: true },
    1 / 60,
  );
  assert.ok(entered.state.velocityY < -3, `entry velocity ${entered.state.velocityY} should not stop at the surface`);
  assert.ok(entered.state.velocityY > -10, "water must still absorb most of a dangerous fall");
  let depth = -entered.state.velocityY / 60;
  for (let frame = 0; frame < 18; frame += 1) {
    entered = stepSwimming(
      entered.state,
      { jumpHeld: false, movingForward: true },
      { submersion: 1, headSubmerged: true, horizontalCollision: false },
      1 / 60,
    );
    depth += -entered.state.velocityY / 60;
    if (frame === 0) assert.ok(entered.state.velocityY < -3, "entry momentum must survive beyond the first submerged frame");
  }
  assert.ok(depth > 1.2, `a long fall should carry the player meaningfully underwater, reached ${depth}`);
});

test("crouching produces a deliberate faster dive without changing jump ascent", () => {
  let idle = { velocityY: 0, oxygenSeconds: 12, drowningAccumulator: 0 };
  let crouched = { ...idle };
  for (let frame = 0; frame < 60; frame += 1) {
    const environment = { submersion: 1, headSubmerged: true, horizontalCollision: false };
    idle = stepSwimming(idle, { jumpHeld: false, movingForward: false }, environment, 1 / 60).state;
    crouched = stepSwimming(crouched, { jumpHeld: false, movingForward: false, crouching: true }, environment, 1 / 60).state;
  }
  assert.ok(crouched.velocityY < idle.velocityY - 1, `${crouched.velocityY} should dive faster than ${idle.velocityY}`);
  assert.ok(crouched.velocityY >= -4.2);
});
