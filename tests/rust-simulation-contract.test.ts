import assert from "node:assert/strict";
import test from "node:test";
import {
  AirLeakFaceV1,
  AirTopologyCellFlagV1,
  LIQUID_NEIGHBOR_ORDER_V1,
  PATH_ELEVATION_ORDER_V1,
  PATH_NEIGHBOR_ORDER_V1,
  PathCellFlagV1,
  PathResultCodeV1,
  PathTransitionV1,
  PhysicsContactFlagV1,
  PhysicsControlFlagV1,
  SIMULATION_SCHEMA_V1,
  SimulationContractError,
  airZoneResultTransferListV1,
  airZoneTopologyTransferListV1,
  createAirZoneTopologyJobV1,
  createAirZoneTopologyResultV1,
  createLiquidFrontierResultV1,
  createLiquidFrontierStepV1,
  createPathJobResultV1,
  createPathJobV1,
  createPhysicsStepInputV1,
  createPhysicsStepResultV1,
  liquidFrontierTransferListV1,
  liquidResultTransferListV1,
  pathJobTransferListV1,
  pathResultTransferListV1,
  physicsStepTransferListV1,
  simulationResultIsCurrentV1,
  type PhysicsStepInputV1Source,
} from "../app/game/simulation-step-contract.ts";
import {
  WORLD_UNLOADED_BLOCK_ID_V1,
  WorldBoundaryKindV1,
  WorldLiquidKindV1,
  createWorldAuthorityIdentityV1,
  createWorldReadWindowV1,
  type WorldAuthorityIdentityV1,
  type WorldReadWindowV1,
} from "../app/game/world-authority-contract.ts";

const address = Object.freeze({ universeId: "1", locationId: "overworld" });

function fixtureWorld(revision = 3): { identity: WorldAuthorityIdentityV1; window: WorldReadWindowV1 } {
  const identity = createWorldAuthorityIdentityV1(address, { epoch: 2, mutation: revision, residency: 7 });
  const cellCount = 4 * 4 * 4;
  const loadedMask = new Uint8Array(cellCount).fill(1);
  const boundary = new Uint8Array(cellCount).fill(WorldBoundaryKindV1.None);
  const blocks = new Uint16Array(cellCount);
  const facing = new Uint8Array(cellCount);
  const liquidKind = new Uint8Array(cellCount);
  const liquidLevel = new Uint8Array(cellCount);
  const flags = new Uint8Array(cellCount);
  loadedMask[cellCount - 1] = 0;
  blocks[cellCount - 1] = WORLD_UNLOADED_BLOCK_ID_V1;
  liquidKind[1] = WorldLiquidKindV1.Water;
  liquidLevel[1] = 1;
  const window = createWorldReadWindowV1({
    address,
    origin: { x: -2, y: 30, z: -2 },
    size: { x: 4, y: 4, z: 4 },
    identity,
    sectionRevisions: [{ address: { ...address, chunkX: -1, chunkZ: -1, sectionY: 5 }, blocks: revision, metadata: 1, halo: 2 }],
    streams: { loadedMask, boundary, blocks, facing, liquidKind, liquidLevel, flags },
  });
  return { identity, window };
}

function physicsSource(): PhysicsStepInputV1Source {
  const { identity, window } = fixtureWorld();
  return {
    identity: { jobId: "physics:player:17", sequence: 17, world: identity, sourceSnapshotHash: window.snapshotHash },
    fixedDeltaMicros: 16_667,
    window,
    body: {
      handle: "player:host",
      position: { x: 0.5, y: 31.5, z: 0.5 },
      velocity: { x: 0, y: -1.25, z: 0 },
      radius: 0.3,
      height: 1.8,
      mass: 1.15,
      grounded: false,
      crouching: false,
      fallDistance: 1.2,
      oxygenSeconds: 12,
      drowningAccumulator: 0,
      swimEntryMomentumSpeed: 0,
      swimSurfaceBreachReady: true,
      swimShoreExitReady: true,
      swimSurfaceBreachSeconds: 0,
      swimStrokeCooldownSeconds: 0,
      swimSurfaceBobActive: false,
    },
    controls: { flags: PhysicsControlFlagV1.Jump | PhysicsControlFlagV1.Sprint, forward: 1, strafe: 0, yaw: Math.PI / 3, desiredSpeed: 6.5 },
    gravity: { gravity: 24, terminalVelocity: 78, airDrag: 1.2, groundAcceleration: 18, airAcceleration: 7, jumpVelocity: 8.15, maximumSweepStep: 0.14 },
    swimming: {
      enabled: true,
      maxOxygenSeconds: 12,
      oxygenDrainPerSecond: 1,
      oxygenRecoveryPerSecond: 4,
      drowningIntervalSeconds: 1.5,
      drowningDamage: 1,
      buoyancyAcceleration: 3.2,
      passiveSinkAcceleration: 4.25,
      maximumSinkSpeed: 2.3,
      swimAcceleration: 11.6,
      waterDrag: 2.8,
      shoreExitVelocity: 8.15,
    },
    externalImpulses: [{ sourceHandle: "veinling:42", impulse: { x: 1.5, y: 0.8, z: -0.5 } }],
  };
}

test("physics jobs are coarse, revision-bound, deterministic, and transferable", () => {
  const input = createPhysicsStepInputV1(physicsSource());
  assert.equal(input.schemaVersion, SIMULATION_SCHEMA_V1);
  assert.match(input.inputHash, /^[0-9a-f]{32}$/u);
  assert.equal(physicsStepTransferListV1(input).length, 7, "one job transfers the complete immutable world window, not voxel callbacks");

  const reordered = physicsSource();
  const swimming = Object.fromEntries(Object.entries(reordered.swimming).reverse()) as unknown as typeof reordered.swimming;
  assert.equal(createPhysicsStepInputV1({ ...reordered, swimming }).inputHash, input.inputHash, "caller property insertion order cannot change the canonical hash");

  const result = createPhysicsStepResultV1({
    identity: input.identity,
    body: { ...input.body, position: { ...input.body.position, y: input.body.position.y + 0.04 }, velocity: { ...input.body.velocity, y: 1.1 } },
    contactFlags: PhysicsContactFlagV1.InLiquid | PhysicsContactFlagV1.HeadSubmerged,
    events: [{ kind: "liquid-enter", amount: 0 }],
  }, input);
  assert.ok(simulationResultIsCurrentV1(result, input.identity.world));
  const nextIdentity = createWorldAuthorityIdentityV1(address, { ...input.identity.world.revision, mutation: input.identity.world.revision.mutation + 1 });
  assert.equal(simulationResultIsCurrentV1(result, nextIdentity), false, "a world mutation makes the result stale");
});

test("physics jobs require the dedicated shore-exit press latch", () => {
  for (const value of [undefined, null, 0, "true"]) {
    const source = physicsSource();
    (source.body as unknown as Record<string, unknown>).swimShoreExitReady = value;
    assert.throws(
      () => createPhysicsStepInputV1(source),
      (error: unknown) => error instanceof SimulationContractError && error.code === "invalid-boolean",
    );
  }
});

test("tampered world snapshots are rejected before physics leaves TypeScript", () => {
  const source = physicsSource();
  source.window.streams.blocks[0] = 99;
  assert.throws(() => createPhysicsStepInputV1(source), (error: unknown) => error instanceof SimulationContractError && error.code === "world-hash");
});

test("liquid frontier jobs preserve FIFO ordering, operation budgets, and atomic result streams", () => {
  const { identity, window } = fixtureWorld();
  const input = createLiquidFrontierStepV1({
    identity: { jobId: "liquid:18", sequence: 18, world: identity, sourceSnapshotHash: window.snapshotHash },
    window,
    frontier: new Int32Array([0, 31, 0, 1, 31, 0, 1, 30, 0]),
    operationBudget: 2,
    spread: { water: 7, lava: 3, honey: 2, syrup: 4 },
  });
  assert.deepEqual(LIQUID_NEIGHBOR_ORDER_V1.map(({ x, y, z }) => [x, y, z]), [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]);
  assert.equal(liquidFrontierTransferListV1(input).length, 8);
  const result = createLiquidFrontierResultV1({
    identity: input.identity,
    positions: new Int32Array([0, 31, 0]),
    previousKinds: new Uint8Array([WorldLiquidKindV1.None]),
    previousLevels: new Uint8Array([0]),
    previousFlags: new Uint8Array([0]),
    nextKinds: new Uint8Array([WorldLiquidKindV1.Water]),
    nextLevels: new Uint8Array([1]),
    nextFlags: new Uint8Array([0]),
    remainingFrontier: new Int32Array([1, 31, 0, 1, 30, 0]),
    operations: 2,
  }, input);
  assert.equal(liquidResultTransferListV1(result).length, 8);
  assert.throws(() => createLiquidFrontierResultV1({ ...result, operations: 3 }, input), /operation budget/u);
});

test("path jobs use packed occupancy plus explicit deterministic neighbor and elevation order", () => {
  const { identity, window } = fixtureWorld();
  const cells = new Uint8Array(3 * 2 * 3).fill(PathCellFlagV1.Loaded | PathCellFlagV1.Passable | PathCellFlagV1.Support);
  const job = createPathJobV1({
    identity: { jobId: "path:19", sequence: 19, world: identity, sourceSnapshotHash: window.snapshotHash },
    occupancy: { origin: { x: 0, y: 30, z: 0 }, size: { x: 3, y: 2, z: 3 }, cells, snapshotHash: "00000000000000000000000000000000" },
    start: { x: 0, y: 30, z: 0 },
    goal: { x: 2, y: 30, z: 2 },
    maximumDistance: 96,
    maximumNodes: 4_096,
    bodyRadius: 0.3,
    bodyHeight: 1.8,
  });
  assert.equal(pathJobTransferListV1(job).length, 1);
  assert.deepEqual(PATH_NEIGHBOR_ORDER_V1.map(({ x, z }) => [x, z]), [[1, 0], [-1, 0], [0, 1], [0, -1]]);
  assert.deepEqual(PATH_ELEVATION_ORDER_V1, [0, 1, -1]);
  const result = createPathJobResultV1({
    identity: job.identity,
    code: PathResultCodeV1.Found,
    cells: new Int32Array([1, 30, 0, 2, 30, 0, 2, 30, 1, 2, 30, 2]),
    transitions: new Uint8Array([PathTransitionV1.Walk, PathTransitionV1.Walk, PathTransitionV1.Walk, PathTransitionV1.Walk]),
    visited: 12,
    nearest: { x: 2, y: 30, z: 2 },
  }, job);
  assert.equal(pathResultTransferListV1(result).length, 2);
  assert.throws(() => createPathJobResultV1({ ...result, transitions: new Uint8Array([9, 9, 9, 9]) }, job), /unknown transition/u);
});

test("air-zone V1 treats unloaded boundaries as visible leaks and rejects false sealed claims", () => {
  const { identity, window } = fixtureWorld();
  const cells = new Uint8Array(8).fill(AirTopologyCellFlagV1.Loaded | AirTopologyCellFlagV1.TraversableGas);
  cells[7] = AirTopologyCellFlagV1.TraversableGas;
  const job = createAirZoneTopologyJobV1({
    identity: { jobId: "air:20", sequence: 20, world: identity, sourceSnapshotHash: window.snapshotHash },
    topologyRevision: 4,
    origin: { x: 0, y: 64, z: 0 },
    size: { x: 2, y: 2, z: 2 },
    cells,
    maximumVisitedCells: 8,
  });
  assert.equal(job.unloadedBoundaryPolicy, "leak");
  assert.equal(airZoneTopologyTransferListV1(job).length, 1);
  const result = createAirZoneTopologyResultV1({
    identity: job.identity,
    topologyRevision: 4,
    zoneIds: new Uint32Array(8).fill(1),
    zones: [{ zoneId: 1, cellCount: 8, leakFaces: AirLeakFaceV1.UnknownBoundary, ventCount: 0, airlockDoorCount: 0, sealed: false }],
    visitedCells: 8,
    budgetExhausted: false,
  }, job);
  assert.equal(airZoneResultTransferListV1(result).length, 1);
  assert.throws(() => createAirZoneTopologyResultV1({ ...result, zones: [{ ...result.zones[0], sealed: true }] }, job), /unknown boundaries always leak|sealed exactly/u);
  assert.throws(() => createAirZoneTopologyJobV1({ ...job, unloadedBoundaryPolicy: "sealed" as never }), /only permits/u);
});
