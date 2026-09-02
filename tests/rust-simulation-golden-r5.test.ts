import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { integrateSailboat } from "../app/game/boats.ts";
import { SHORE_MANTLE_SUSTAIN_SECONDS, stepSwimming } from "../app/game/liquids.ts";

type GoldenRow = Readonly<Record<string, unknown>>;

const rows = readFileSync(new URL("./fixtures/rust-engine/r5/simulation-golden-v2.jsonl", import.meta.url), "utf8")
  .trim()
  .split(/\r?\n/u)
  .map((line) => JSON.parse(line) as GoldenRow);

function scenario(name: string, predicate: (row: GoldenRow) => boolean = () => true) {
  const row = rows.find((candidate) => candidate.scenario === name && predicate(candidate));
  assert.ok(row, `missing ${name} golden row`);
  return row;
}

function close(actual: number, expected: unknown, label: string, tolerance = 1e-9) {
  if (typeof expected !== "number") throw new TypeError(`${label} fixture must be numeric`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}

function assertSwimmingGolden(
  result: ReturnType<typeof stepSwimming>,
  golden: GoldenRow,
  label: string,
) {
  close(result.state.velocityY, golden.velocityY, `${label} velocity`);
  close(result.state.oxygenSeconds, golden.oxygen, `${label} oxygen`);
  close(result.state.drowningAccumulator, golden.drowningAccumulator, `${label} drowning accumulator`);
  close(result.state.entryMomentumSpeed ?? Number.NaN, golden.entryMomentumSpeed, `${label} entry momentum`);
  assert.equal(result.state.surfaceBreachReady, golden.surfaceBreachReady, `${label} breach latch`);
  assert.equal(result.state.shoreExitReady, golden.shoreExitReady, `${label} shore latch`);
  close(result.state.surfaceBreachSeconds ?? Number.NaN, golden.surfaceBreachSeconds, `${label} mantle timer`);
  close(
    result.state.surfaceStrokeCooldownSeconds ?? Number.NaN,
    golden.surfaceStrokeCooldownSeconds,
    `${label} stroke cooldown`,
  );
  assert.equal(result.state.surfaceBobActive, golden.surfaceBobActive, `${label} bob state`);
  assert.equal(result.shoreBoosted, golden.shoreBoosted, `${label} cue`);
  close(result.damage, golden.damage, `${label} damage`);
  close(result.horizontalSpeedScale, golden.horizontalSpeedScale, `${label} horizontal scale`);
}

function legacyFlightStep(
  velocity: readonly [number, number, number],
  dt: number,
): [number, number, number] {
  const forward = 1;
  const strafe = 0.25;
  const length = Math.max(1, Math.hypot(forward, strafe));
  const f = forward / length;
  const r = strafe / length;
  const yaw = 0.35;
  const desiredX = (-Math.sin(yaw) * f + Math.cos(yaw) * r) * 15.5;
  const desiredZ = (-Math.cos(yaw) * f - Math.sin(yaw) * r) * 15.5;
  const blend = Math.min(1, 16 * dt);
  const x = velocity[0] + (desiredX - velocity[0]) * blend;
  const z = velocity[2] + (desiredZ - velocity[2]) * blend;
  const y = velocity[1] + (12 - velocity[1]) * Math.min(1, dt * 18);
  return [x, y, z];
}

test("Rust flight replays match an independent legacy TypeScript oracle at 30/60/120 Hz", () => {
  for (const hz of [30, 60, 120]) {
    const row = scenario("flight-replay", (candidate) => candidate.hz === hz);
    const dt = 1 / hz;
    let position: [number, number, number] = [-16.25, 40, 0.5];
    let velocity: [number, number, number] = [0, 0, 0];
    for (let tick = 0; tick < hz; tick += 1) {
      velocity = legacyFlightStep(velocity, dt);
      position = [
        position[0] + velocity[0] * dt,
        position[1] + velocity[1] * dt,
        position[2] + velocity[2] * dt,
      ];
    }
    const expectedPosition = row.position as unknown[];
    const expectedVelocity = row.velocity as unknown[];
    for (let axis = 0; axis < 3; axis += 1) {
      close(position[axis], expectedPosition[axis], `${hz} Hz position ${axis}`);
      close(velocity[axis], expectedVelocity[axis], `${hz} Hz velocity ${axis}`);
    }
  }
});

test("Rust shore exit golden matches the shipping TypeScript swimming oracle", () => {
  const result = stepSwimming(
    {
      velocityY: 0,
      oxygenSeconds: 12,
      drowningAccumulator: 0,
      entryMomentumSpeed: 0,
      surfaceBreachReady: true,
      shoreExitReady: true,
      surfaceBreachSeconds: 0,
      surfaceStrokeCooldownSeconds: 0,
      surfaceBobActive: false,
    },
    { jumpHeld: true, movingForward: true, crouching: false, sprinting: true },
    {
      submersion: 0.68,
      headSubmerged: false,
      horizontalCollision: true,
      shoreLedgeHeight: 1,
      surfaceGap: 0.72,
      surfaceClearance: 0.1,
      enteredFromAir: false,
    },
    1 / 60,
  );
  const golden = scenario("shore-exit");
  assertSwimmingGolden(result, golden, "shore exit");
  close(SHORE_MANTLE_SUSTAIN_SECONDS, golden.surfaceBreachSeconds, "shore mantle constant");

  const sustained = stepSwimming(
    result.state,
    { jumpHeld: true, movingForward: true, crouching: false, sprinting: true },
    {
      submersion: 0.68,
      headSubmerged: false,
      horizontalCollision: false,
      surfaceGap: 0.72,
      surfaceClearance: 0.1,
      enteredFromAir: false,
    },
    1 / 60,
  );
  assertSwimmingGolden(sustained, scenario("shore-exit-sustain"), "shore sustain");
});

test("Rust boat golden matches the shipping TypeScript low-frequency integrator", () => {
  const boat = integrateSailboat(
    { x: -16.25, y: 32.5, z: 0, yaw: 0.25, velocity: 1.2 },
    { forward: 1, turn: -0.4 },
    0.05,
    () => true,
  );
  const golden = scenario("boat");
  const expected = golden.position as unknown[];
  close(boat.x, expected[0], "boat x");
  close(boat.y, expected[1], "boat y");
  close(boat.z, expected[2], "boat z");
  close(boat.yaw, golden.yaw, "boat yaw");
  close(boat.velocity, golden.velocity, "boat velocity");
});

test("golden manifest freezes chunk, shape, frontier, navigation, and atmosphere safety cases", () => {
  assert.deepEqual(scenario("negative-chunk-ray").cell, [-15, 1, 0]);
  assert.deepEqual(scenario("negative-chunk-ray").normal, [-1, 0, 0]);
  assert.deepEqual(scenario("doors-and-unloaded"), {
    scenario: "doors-and-unloaded",
    closed: true,
    open: false,
    unloadedSolid: true,
  });
  assert.equal(scenario("stairs").stepped, true);
  assert.equal(scenario("stairs").blocked, false);
  assert.deepEqual(scenario("liquid-order").changes, [[2, 1, 3], [3, 1, 2]]);
  assert.deepEqual(scenario("path-tie").cells, [[2, 1, 1], [3, 1, 1], [4, 1, 1], [5, 1, 1], [6, 1, 1]]);
  const atmosphere = scenario("atmosphere-unknown");
  assert.equal(atmosphere.sealed, false);
  assert.equal((atmosphere.leakFaces as number) & 64, 64, "unknown boundary leak bit must remain set");
  assert.deepEqual(scenario("fixed-gas"), {
    scenario: "fixed-gas",
    zone1Pressure: 900_000_000_000,
    zone2Pressure: 100_000_000_000,
    transferred: 100_000_000,
  });
});

test("legacy hit-hop golden preserves horizontal cap and grounded vertical impulse", () => {
  const golden = scenario("hit-hop");
  assert.equal(golden.speed, 4.7);
  assert.deepEqual(golden.velocity, [4.9, 3.8, 0.1]);
  assert.equal(golden.grounded, false);
});
