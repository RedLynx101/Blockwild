import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import {
  WORLD_AUTHORITY_SCHEMA_V1,
  WorldLiquidKindV1,
  hashWorldReadWindowV1,
  sameWorldAddressV1,
  sameWorldRevisionV1,
  type WorldAddressV1,
  type WorldAuthorityIdentityV1,
  type WorldReadWindowV1,
} from "./world-authority-contract";

/**
 * Coarse, transferable simulation jobs for the R5 Rust migration.
 *
 * Every job owns one immutable world window and names the exact world revision
 * it sampled. Results are useful only while that identity is still current.
 * This deliberately forbids per-voxel callbacks across Worker/Wasm boundaries.
 */
export const SIMULATION_PROTOCOL_V1 = 1 as const;
export const SIMULATION_SCHEMA_V1 = 1 as const;
export const SIMULATION_MAX_FIXED_DELTA_MICROS_V1 = 100_000;
export const SIMULATION_MAX_EXTERNAL_IMPULSES_V1 = 64;
export const LIQUID_FRONTIER_MAX_CELLS_V1 = 16_384;
export const PATH_WINDOW_MAX_CELLS_V1 = 128 * 1024;
export const PATH_MAX_NODES_V1 = 65_536;
export const AIR_ZONE_MAX_CELLS_V1 = 256 * 1024;

const HASH_PATTERN = /^[0-9a-f]{32}$/u;
const floatScratch = new ArrayBuffer(8);
const floatScratchView = new DataView(floatScratch);

export type SimulationVector3V1 = Readonly<{ x: number; y: number; z: number }>;

export type SimulationJobIdentityV1 = Readonly<{
  jobId: string;
  sequence: number;
  world: WorldAuthorityIdentityV1;
  sourceSnapshotHash: string;
}>;

export const enum PhysicsControlFlagV1 {
  Jump = 1 << 0,
  Crouch = 1 << 1,
  Sprint = 1 << 2,
  Ascend = 1 << 3,
  Descend = 1 << 4,
}

export const enum PhysicsContactFlagV1 {
  Grounded = 1 << 0,
  Ceiling = 1 << 1,
  NegativeX = 1 << 2,
  PositiveX = 1 << 3,
  NegativeZ = 1 << 4,
  PositiveZ = 1 << 5,
  InLiquid = 1 << 6,
  HeadSubmerged = 1 << 7,
  ShoreBoosted = 1 << 8,
  UnknownBoundary = 1 << 9,
}

export type PhysicsBodyV1 = Readonly<{
  handle: string;
  position: SimulationVector3V1;
  velocity: SimulationVector3V1;
  radius: number;
  height: number;
  mass: number;
  grounded: boolean;
  crouching: boolean;
  fallDistance: number;
  oxygenSeconds: number;
  drowningAccumulator: number;
  swimEntryMomentumSpeed: number;
  swimSurfaceBreachReady: boolean;
  swimShoreExitReady: boolean;
  swimSurfaceBreachSeconds: number;
  swimStrokeCooldownSeconds: number;
  swimSurfaceBobActive: boolean;
}>;

export type PhysicsGravityProfileV1 = Readonly<{
  gravity: number;
  terminalVelocity: number;
  airDrag: number;
  groundAcceleration: number;
  airAcceleration: number;
  jumpVelocity: number;
  maximumSweepStep: number;
}>;

export type PhysicsSwimProfileV1 = Readonly<{
  enabled: boolean;
  maxOxygenSeconds: number;
  oxygenDrainPerSecond: number;
  oxygenRecoveryPerSecond: number;
  drowningIntervalSeconds: number;
  drowningDamage: number;
  buoyancyAcceleration: number;
  passiveSinkAcceleration: number;
  maximumSinkSpeed: number;
  swimAcceleration: number;
  waterDrag: number;
  shoreExitVelocity: number;
}>;

export type PhysicsExternalImpulseV1 = Readonly<{
  sourceHandle: string;
  impulse: SimulationVector3V1;
}>;

export type PhysicsStepInputV1 = Readonly<{
  schemaVersion: typeof SIMULATION_SCHEMA_V1;
  identity: SimulationJobIdentityV1;
  fixedDeltaMicros: number;
  window: WorldReadWindowV1;
  body: PhysicsBodyV1;
  controls: Readonly<{
    flags: number;
    forward: number;
    strafe: number;
    yaw: number;
    desiredSpeed: number;
  }>;
  gravity: PhysicsGravityProfileV1;
  swimming: PhysicsSwimProfileV1;
  externalImpulses: readonly PhysicsExternalImpulseV1[];
  inputHash: string;
}>;

export type PhysicsStepInputV1Source = Omit<PhysicsStepInputV1, "schemaVersion" | "inputHash">;

export type PhysicsDiscreteEventV1 = Readonly<{
  kind: "jump" | "land" | "fall-damage" | "drown-damage" | "liquid-enter" | "liquid-exit" | "shore-exit";
  amount: number;
}>;

export type PhysicsStepResultV1 = Readonly<{
  schemaVersion: typeof SIMULATION_SCHEMA_V1;
  identity: SimulationJobIdentityV1;
  body: PhysicsBodyV1;
  contactFlags: number;
  events: readonly PhysicsDiscreteEventV1[];
  resultHash: string;
}>;

export const enum LiquidCellFlagV1 {
  Source = 1 << 0,
  Falling = 1 << 1,
  Renewable = 1 << 2,
  Waterlogged = 1 << 3,
}

export type LiquidFrontierStepV1 = Readonly<{
  schemaVersion: typeof SIMULATION_SCHEMA_V1;
  identity: SimulationJobIdentityV1;
  window: WorldReadWindowV1;
  /** Packed world-space xyz triples in exact FIFO order. */
  frontier: Int32Array;
  operationBudget: number;
  spread: Readonly<{ water: number; lava: number; honey: number; syrup: number }>;
  inputHash: string;
}>;

export type LiquidFrontierStepV1Source = Omit<LiquidFrontierStepV1, "schemaVersion" | "inputHash" | "frontier"> & Readonly<{ frontier: Int32Array }>;

export type LiquidFrontierResultV1 = Readonly<{
  schemaVersion: typeof SIMULATION_SCHEMA_V1;
  identity: SimulationJobIdentityV1;
  /** Packed world-space xyz triples in commit order. */
  positions: Int32Array;
  previousKinds: Uint8Array;
  previousLevels: Uint8Array;
  previousFlags: Uint8Array;
  nextKinds: Uint8Array;
  nextLevels: Uint8Array;
  nextFlags: Uint8Array;
  /** Remaining FIFO frontier after this bounded step. */
  remainingFrontier: Int32Array;
  operations: number;
  resultHash: string;
}>;

export const enum PathCellFlagV1 {
  Loaded = 1 << 0,
  Passable = 1 << 1,
  Support = 1 << 2,
  Liquid = 1 << 3,
  DoorOrGate = 1 << 4,
}

export const enum PathTransitionV1 {
  Walk = 0,
  Step = 1,
  Jump = 2,
  Swim = 3,
  Door = 4,
}

export const enum PathResultCodeV1 {
  Found = 0,
  Unloaded = 1,
  TooFar = 2,
  Blocked = 3,
  BudgetExhausted = 4,
  Stale = 5,
}

export type PathOccupancyWindowV1 = Readonly<{
  origin: Readonly<{ x: number; y: number; z: number }>;
  size: Readonly<{ x: number; y: number; z: number }>;
  /** PathCellFlagV1, x-fastest then z then y. */
  cells: Uint8Array;
  snapshotHash: string;
}>;

export type PathJobV1 = Readonly<{
  schemaVersion: typeof SIMULATION_SCHEMA_V1;
  identity: SimulationJobIdentityV1;
  occupancy: PathOccupancyWindowV1;
  start: SimulationVector3V1;
  goal: SimulationVector3V1;
  maximumDistance: number;
  maximumNodes: number;
  bodyRadius: number;
  bodyHeight: number;
  inputHash: string;
}>;

export type PathJobV1Source = Omit<PathJobV1, "schemaVersion" | "inputHash">;

export type PathJobResultV1 = Readonly<{
  schemaVersion: typeof SIMULATION_SCHEMA_V1;
  identity: SimulationJobIdentityV1;
  code: PathResultCodeV1;
  /** Packed world-space xyz triples in traversal order. */
  cells: Int32Array;
  transitions: Uint8Array;
  visited: number;
  nearest: SimulationVector3V1;
  resultHash: string;
}>;

export const enum AirTopologyCellFlagV1 {
  Loaded = 1 << 0,
  TraversableGas = 1 << 1,
  Solid = 1 << 2,
  Sealable = 1 << 3,
  Vent = 1 << 4,
  AirlockDoor = 1 << 5,
  OpenAirlockDoor = 1 << 6,
}

export const enum AirLeakFaceV1 {
  NegativeX = 1 << 0,
  PositiveX = 1 << 1,
  NegativeY = 1 << 2,
  PositiveY = 1 << 3,
  NegativeZ = 1 << 4,
  PositiveZ = 1 << 5,
  UnknownBoundary = 1 << 6,
}

export type AirZoneTopologyJobV1 = Readonly<{
  schemaVersion: typeof SIMULATION_SCHEMA_V1;
  identity: SimulationJobIdentityV1;
  topologyRevision: number;
  origin: Readonly<{ x: number; y: number; z: number }>;
  size: Readonly<{ x: number; y: number; z: number }>;
  cells: Uint8Array;
  /** V1 is intentionally safety-biased: an unavailable neighbor is a leak. */
  unloadedBoundaryPolicy: "leak";
  maximumVisitedCells: number;
  inputHash: string;
}>;

export type AirZoneTopologyJobV1Source = Omit<AirZoneTopologyJobV1, "schemaVersion" | "inputHash" | "cells" | "unloadedBoundaryPolicy"> & Readonly<{
  cells: Uint8Array;
  unloadedBoundaryPolicy?: "leak";
}>;

export type AirZoneSummaryV1 = Readonly<{
  zoneId: number;
  cellCount: number;
  leakFaces: number;
  ventCount: number;
  airlockDoorCount: number;
  sealed: boolean;
}>;

export type AirZoneTopologyResultV1 = Readonly<{
  schemaVersion: typeof SIMULATION_SCHEMA_V1;
  identity: SimulationJobIdentityV1;
  topologyRevision: number;
  /** One zone id per input cell; zero is solid/unassigned. */
  zoneIds: Uint32Array;
  zones: readonly AirZoneSummaryV1[];
  visitedCells: number;
  budgetExhausted: boolean;
  resultHash: string;
}>;

export type PhysicsStepResultV1Source = Omit<PhysicsStepResultV1, "schemaVersion" | "resultHash">;
export type LiquidFrontierResultV1Source = Omit<LiquidFrontierResultV1, "schemaVersion" | "resultHash">;
export type PathJobResultV1Source = Omit<PathJobResultV1, "schemaVersion" | "resultHash">;
export type AirZoneTopologyResultV1Source = Omit<AirZoneTopologyResultV1, "schemaVersion" | "resultHash" | "zoneIds"> & Readonly<{ zoneIds: Uint32Array }>;

export class SimulationContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SimulationContractError";
  }
}

function requireInteger(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new SimulationContractError("invalid-integer", `${label} must be an integer in ${minimum}..${maximum}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireFinite(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new SimulationContractError("invalid-number", `${label} must be finite and in ${minimum}..${maximum}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireBoolean(value: boolean, label: string) {
  if (typeof value !== "boolean") {
    throw new SimulationContractError("invalid-boolean", `${label} must be a boolean`);
  }
  return value;
}

function requireLabel(value: string, label: string, maximum = 128) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new SimulationContractError("invalid-label", `${label} must be a non-empty string no longer than ${maximum} code units`);
  }
  return value;
}

function requireHash(value: string, label: string) {
  if (!HASH_PATTERN.test(value)) throw new SimulationContractError("invalid-hash", `${label} must be a canonical 128-bit lowercase hash`);
  return value;
}

function writeFloat(hasher: TypeScriptCanonicalHasher, value: number) {
  floatScratchView.setFloat64(0, requireFinite(value, -Number.MAX_VALUE, Number.MAX_VALUE, "float"), true);
  hasher.writeBytes(new Uint8Array(floatScratch));
  return hasher;
}

function writeVector(hasher: TypeScriptCanonicalHasher, value: SimulationVector3V1) {
  writeFloat(hasher, value.x);
  writeFloat(hasher, value.y);
  writeFloat(hasher, value.z);
}

function bytes(view: ArrayBufferView) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function assertWorldWindow(window: WorldReadWindowV1) {
  if (window.schemaVersion !== WORLD_AUTHORITY_SCHEMA_V1) throw new SimulationContractError("world-schema", "world read window has an unsupported schema");
  requireHash(window.snapshotHash, "window.snapshotHash");
  if (hashWorldReadWindowV1(window) !== window.snapshotHash) throw new SimulationContractError("world-hash", "world read window hash does not match its content");
}

function assertJobIdentity(identity: SimulationJobIdentityV1, window?: WorldReadWindowV1) {
  requireLabel(identity.jobId, "jobId", 160);
  requireInteger(identity.sequence, 0, 0xffff_ffff, "sequence");
  requireHash(identity.world.stateHash, "world.stateHash");
  requireHash(identity.sourceSnapshotHash, "sourceSnapshotHash");
  if (window) {
    if (!sameWorldAddressV1(identity.world.address, window.address)) throw new SimulationContractError("world-address", "job and window belong to different world addresses");
    if (!sameWorldRevisionV1(identity.world.revision, window.identity.revision)) throw new SimulationContractError("world-revision", "job and window use different world revisions");
    if (identity.world.stateHash !== window.identity.stateHash) throw new SimulationContractError("world-state-hash", "job and window use different world state hashes");
    if (identity.sourceSnapshotHash !== window.snapshotHash) throw new SimulationContractError("source-snapshot", "job source hash does not identify its world window");
  }
}

function writeIdentity(hasher: TypeScriptCanonicalHasher, identity: SimulationJobIdentityV1) {
  hasher.writeString(identity.jobId).writeU32(identity.sequence);
  hasher.writeString(identity.world.address.universeId).writeString(identity.world.address.locationId);
  hasher.writeU64(identity.world.revision.epoch).writeU64(identity.world.revision.mutation).writeU64(identity.world.revision.residency);
  hasher.writeString(identity.world.stateHash).writeString(identity.sourceSnapshotHash);
}

function normalizeVector(value: SimulationVector3V1, label: string): SimulationVector3V1 {
  return Object.freeze({
    x: requireFinite(value.x, -0x8000_0000, 0x7fff_ffff, `${label}.x`),
    y: requireFinite(value.y, -0x8000_0000, 0x7fff_ffff, `${label}.y`),
    z: requireFinite(value.z, -0x8000_0000, 0x7fff_ffff, `${label}.z`),
  });
}

function normalizeBody(body: PhysicsBodyV1): PhysicsBodyV1 {
  return Object.freeze({
    ...body,
    handle: requireLabel(body.handle, "body.handle", 160),
    position: normalizeVector(body.position, "body.position"),
    velocity: normalizeVector(body.velocity, "body.velocity"),
    radius: requireFinite(body.radius, 0.01, 64, "body.radius"),
    height: requireFinite(body.height, 0.01, 128, "body.height"),
    mass: requireFinite(body.mass, 0.001, 1_000_000, "body.mass"),
    fallDistance: requireFinite(body.fallDistance, 0, 1_000_000, "body.fallDistance"),
    oxygenSeconds: requireFinite(body.oxygenSeconds, 0, 86_400, "body.oxygenSeconds"),
    drowningAccumulator: requireFinite(body.drowningAccumulator, 0, 86_400, "body.drowningAccumulator"),
    swimEntryMomentumSpeed: requireFinite(body.swimEntryMomentumSpeed, 0, 1_000_000, "body.swimEntryMomentumSpeed"),
    swimShoreExitReady: requireBoolean(body.swimShoreExitReady, "body.swimShoreExitReady"),
    swimSurfaceBreachSeconds: requireFinite(body.swimSurfaceBreachSeconds, 0, 86_400, "body.swimSurfaceBreachSeconds"),
    swimStrokeCooldownSeconds: requireFinite(body.swimStrokeCooldownSeconds, 0, 86_400, "body.swimStrokeCooldownSeconds"),
  });
}

function writeBody(hasher: TypeScriptCanonicalHasher, body: PhysicsBodyV1) {
  hasher.writeString(body.handle);
  writeVector(hasher, body.position);
  writeVector(hasher, body.velocity);
  for (const value of [body.radius, body.height, body.mass, body.fallDistance, body.oxygenSeconds, body.drowningAccumulator,
    body.swimEntryMomentumSpeed, body.swimSurfaceBreachSeconds, body.swimStrokeCooldownSeconds]) writeFloat(hasher, value);
  hasher.writeU16(body.grounded ? 1 : 0).writeU16(body.crouching ? 1 : 0)
    .writeU16(body.swimSurfaceBreachReady ? 1 : 0).writeU16(body.swimSurfaceBobActive ? 1 : 0)
    .writeU16(body.swimShoreExitReady ? 1 : 0);
}

export function hashPhysicsStepInputV1(input: Omit<PhysicsStepInputV1, "inputHash">) {
  const hasher = new TypeScriptCanonicalHasher("blockwild-physics-step-input-v1");
  hasher.writeU16(input.schemaVersion);
  writeIdentity(hasher, input.identity);
  hasher.writeU32(input.fixedDeltaMicros).writeString(input.window.snapshotHash);
  writeBody(hasher, input.body);
  hasher.writeU16(input.controls.flags).writeU32(input.externalImpulses.length);
  for (const value of [input.controls.forward, input.controls.strafe, input.controls.yaw, input.controls.desiredSpeed]) writeFloat(hasher, value);
  for (const value of Object.values(input.gravity)) writeFloat(hasher, value);
  hasher.writeU16(input.swimming.enabled ? 1 : 0);
  for (const value of [input.swimming.maxOxygenSeconds, input.swimming.oxygenDrainPerSecond,
    input.swimming.oxygenRecoveryPerSecond, input.swimming.drowningIntervalSeconds, input.swimming.drowningDamage,
    input.swimming.buoyancyAcceleration, input.swimming.passiveSinkAcceleration, input.swimming.maximumSinkSpeed,
    input.swimming.swimAcceleration, input.swimming.waterDrag, input.swimming.shoreExitVelocity]) writeFloat(hasher, value);
  for (const impulse of input.externalImpulses) { hasher.writeString(impulse.sourceHandle); writeVector(hasher, impulse.impulse); }
  return hasher.finishHex();
}

export function createPhysicsStepInputV1(source: PhysicsStepInputV1Source): PhysicsStepInputV1 {
  assertWorldWindow(source.window);
  assertJobIdentity(source.identity, source.window);
  const body = normalizeBody(source.body);
  const fixedDeltaMicros = requireInteger(source.fixedDeltaMicros, 1, SIMULATION_MAX_FIXED_DELTA_MICROS_V1, "fixedDeltaMicros");
  if (source.externalImpulses.length > SIMULATION_MAX_EXTERNAL_IMPULSES_V1) throw new SimulationContractError("impulse-budget", "too many external impulses for one fixed step");
  const externalImpulses = Object.freeze(source.externalImpulses.map((impulse) => Object.freeze({
    sourceHandle: requireLabel(impulse.sourceHandle, "impulse.sourceHandle", 160),
    impulse: normalizeVector(impulse.impulse, "impulse.vector"),
  })));
  const controls = Object.freeze({
    flags: requireInteger(source.controls.flags, 0, 0x1f, "controls.flags"),
    forward: requireFinite(source.controls.forward, -1, 1, "controls.forward"),
    strafe: requireFinite(source.controls.strafe, -1, 1, "controls.strafe"),
    yaw: requireFinite(source.controls.yaw, -Math.PI * 2 ** 20, Math.PI * 2 ** 20, "controls.yaw"),
    desiredSpeed: requireFinite(source.controls.desiredSpeed, 0, 1_000, "controls.desiredSpeed"),
  });
  const gravity = Object.freeze({
    gravity: requireFinite(source.gravity.gravity, -1_000, 1_000, "gravity.gravity"),
    terminalVelocity: requireFinite(source.gravity.terminalVelocity, 0, 10_000, "gravity.terminalVelocity"),
    airDrag: requireFinite(source.gravity.airDrag, 0, 1_000, "gravity.airDrag"),
    groundAcceleration: requireFinite(source.gravity.groundAcceleration, 0, 10_000, "gravity.groundAcceleration"),
    airAcceleration: requireFinite(source.gravity.airAcceleration, 0, 10_000, "gravity.airAcceleration"),
    jumpVelocity: requireFinite(source.gravity.jumpVelocity, 0, 10_000, "gravity.jumpVelocity"),
    maximumSweepStep: requireFinite(source.gravity.maximumSweepStep, 0.01, 1, "gravity.maximumSweepStep"),
  });
  const swimming = Object.freeze({
    ...source.swimming,
    maxOxygenSeconds: requireFinite(source.swimming.maxOxygenSeconds, 0, 86_400, "swimming.maxOxygenSeconds"),
    oxygenDrainPerSecond: requireFinite(source.swimming.oxygenDrainPerSecond, 0, 10_000, "swimming.oxygenDrainPerSecond"),
    oxygenRecoveryPerSecond: requireFinite(source.swimming.oxygenRecoveryPerSecond, 0, 10_000, "swimming.oxygenRecoveryPerSecond"),
    drowningIntervalSeconds: requireFinite(source.swimming.drowningIntervalSeconds, 0.001, 86_400, "swimming.drowningIntervalSeconds"),
    drowningDamage: requireFinite(source.swimming.drowningDamage, 0, 1_000_000, "swimming.drowningDamage"),
    buoyancyAcceleration: requireFinite(source.swimming.buoyancyAcceleration, -10_000, 10_000, "swimming.buoyancyAcceleration"),
    passiveSinkAcceleration: requireFinite(source.swimming.passiveSinkAcceleration, 0, 10_000, "swimming.passiveSinkAcceleration"),
    maximumSinkSpeed: requireFinite(source.swimming.maximumSinkSpeed, 0, 10_000, "swimming.maximumSinkSpeed"),
    swimAcceleration: requireFinite(source.swimming.swimAcceleration, 0, 10_000, "swimming.swimAcceleration"),
    waterDrag: requireFinite(source.swimming.waterDrag, 0, 10_000, "swimming.waterDrag"),
    shoreExitVelocity: requireFinite(source.swimming.shoreExitVelocity, 0, 10_000, "swimming.shoreExitVelocity"),
  });
  const withoutHash = Object.freeze({
    schemaVersion: SIMULATION_SCHEMA_V1,
    identity: source.identity,
    fixedDeltaMicros,
    window: source.window,
    body,
    controls,
    gravity,
    swimming,
    externalImpulses,
  });
  return Object.freeze({ ...withoutHash, inputHash: hashPhysicsStepInputV1(withoutHash) });
}

export function hashLiquidFrontierStepV1(input: Omit<LiquidFrontierStepV1, "inputHash">) {
  const hasher = new TypeScriptCanonicalHasher("blockwild-liquid-frontier-input-v1");
  hasher.writeU16(input.schemaVersion);
  writeIdentity(hasher, input.identity);
  hasher.writeString(input.window.snapshotHash).writeBytes(bytes(input.frontier)).writeU32(input.operationBudget);
  hasher.writeU16(input.spread.water).writeU16(input.spread.lava).writeU16(input.spread.honey).writeU16(input.spread.syrup);
  return hasher.finishHex();
}

export function createLiquidFrontierStepV1(source: LiquidFrontierStepV1Source): LiquidFrontierStepV1 {
  assertWorldWindow(source.window);
  assertJobIdentity(source.identity, source.window);
  if (!(source.frontier instanceof Int32Array) || source.frontier.length % 3 !== 0) throw new SimulationContractError("liquid-frontier", "liquid frontier must be an Int32Array of xyz triples");
  if (source.frontier.length / 3 > LIQUID_FRONTIER_MAX_CELLS_V1) throw new SimulationContractError("liquid-frontier-budget", "liquid frontier exceeds the V1 cell budget");
  const spread = Object.freeze({
    water: requireInteger(source.spread.water, 0, 255, "spread.water"),
    lava: requireInteger(source.spread.lava, 0, 255, "spread.lava"),
    honey: requireInteger(source.spread.honey, 0, 255, "spread.honey"),
    syrup: requireInteger(source.spread.syrup, 0, 255, "spread.syrup"),
  });
  const withoutHash = Object.freeze({
    schemaVersion: SIMULATION_SCHEMA_V1,
    identity: source.identity,
    window: source.window,
    frontier: Int32Array.from(source.frontier),
    operationBudget: requireInteger(source.operationBudget, 1, LIQUID_FRONTIER_MAX_CELLS_V1, "operationBudget"),
    spread,
  });
  return Object.freeze({ ...withoutHash, inputHash: hashLiquidFrontierStepV1(withoutHash) });
}

function requireWindowShape(origin: SimulationVector3V1, size: SimulationVector3V1, maximumCells: number, label: string) {
  const normalizedOrigin = Object.freeze({
    x: requireInteger(origin.x, -0x8000_0000, 0x7fff_ffff, `${label}.origin.x`),
    y: requireInteger(origin.y, -0x8000_0000, 0x7fff_ffff, `${label}.origin.y`),
    z: requireInteger(origin.z, -0x8000_0000, 0x7fff_ffff, `${label}.origin.z`),
  });
  const normalizedSize = Object.freeze({
    x: requireInteger(size.x, 1, 512, `${label}.size.x`),
    y: requireInteger(size.y, 1, 512, `${label}.size.y`),
    z: requireInteger(size.z, 1, 512, `${label}.size.z`),
  });
  const cellCount = normalizedSize.x * normalizedSize.y * normalizedSize.z;
  if (cellCount > maximumCells) throw new SimulationContractError(`${label}-budget`, `${label} exceeds ${maximumCells} cells`);
  return { origin: normalizedOrigin, size: normalizedSize, cellCount } as const;
}

function hashOccupancyV1(origin: SimulationVector3V1, size: SimulationVector3V1, cells: Uint8Array) {
  const hasher = new TypeScriptCanonicalHasher("blockwild-path-occupancy-v1");
  hasher.writeI32(origin.x).writeI32(origin.y).writeI32(origin.z);
  hasher.writeU32(size.x).writeU32(size.y).writeU32(size.z).writeBytes(cells);
  return hasher.finishHex();
}

export function createPathJobV1(source: PathJobV1Source): PathJobV1 {
  assertJobIdentity(source.identity);
  const shape = requireWindowShape(source.occupancy.origin, source.occupancy.size, PATH_WINDOW_MAX_CELLS_V1, "path-window");
  if (!(source.occupancy.cells instanceof Uint8Array) || source.occupancy.cells.length !== shape.cellCount) throw new SimulationContractError("path-cells", "path occupancy stream length does not match its window");
  const cells = Uint8Array.from(source.occupancy.cells);
  for (const cell of cells) if ((cell & ~0x1f) !== 0) throw new SimulationContractError("path-cell-flags", "path occupancy contains unknown required bits");
  const occupancy = Object.freeze({ origin: shape.origin, size: shape.size, cells, snapshotHash: hashOccupancyV1(shape.origin, shape.size, cells) });
  const withoutHash = Object.freeze({
    schemaVersion: SIMULATION_SCHEMA_V1,
    identity: source.identity,
    occupancy,
    start: normalizeVector(source.start, "path.start"),
    goal: normalizeVector(source.goal, "path.goal"),
    maximumDistance: requireFinite(source.maximumDistance, 0, 4_096, "path.maximumDistance"),
    maximumNodes: requireInteger(source.maximumNodes, 1, PATH_MAX_NODES_V1, "path.maximumNodes"),
    bodyRadius: requireFinite(source.bodyRadius, 0.01, 64, "path.bodyRadius"),
    bodyHeight: requireFinite(source.bodyHeight, 0.01, 128, "path.bodyHeight"),
  });
  const hasher = new TypeScriptCanonicalHasher("blockwild-path-job-v1");
  hasher.writeU16(withoutHash.schemaVersion); writeIdentity(hasher, withoutHash.identity);
  hasher.writeString(occupancy.snapshotHash); writeVector(hasher, withoutHash.start); writeVector(hasher, withoutHash.goal);
  writeFloat(hasher, withoutHash.maximumDistance); hasher.writeU32(withoutHash.maximumNodes); writeFloat(hasher, withoutHash.bodyRadius); writeFloat(hasher, withoutHash.bodyHeight);
  return Object.freeze({ ...withoutHash, inputHash: hasher.finishHex() });
}

export function createAirZoneTopologyJobV1(source: AirZoneTopologyJobV1Source): AirZoneTopologyJobV1 {
  assertJobIdentity(source.identity);
  if (source.unloadedBoundaryPolicy !== undefined && source.unloadedBoundaryPolicy !== "leak") {
    throw new SimulationContractError("air-boundary-policy", "V1 only permits the safety-biased unloaded-boundary policy: leak");
  }
  const shape = requireWindowShape(source.origin, source.size, AIR_ZONE_MAX_CELLS_V1, "air-zone-window");
  if (!(source.cells instanceof Uint8Array) || source.cells.length !== shape.cellCount) throw new SimulationContractError("air-zone-cells", "air topology stream length does not match its window");
  const cells = Uint8Array.from(source.cells);
  for (const cell of cells) if ((cell & ~0x7f) !== 0) throw new SimulationContractError("air-zone-flags", "air topology contains unknown required bits");
  const withoutHash = Object.freeze({
    schemaVersion: SIMULATION_SCHEMA_V1,
    identity: source.identity,
    topologyRevision: requireInteger(source.topologyRevision, 0, Number.MAX_SAFE_INTEGER, "topologyRevision"),
    origin: shape.origin,
    size: shape.size,
    cells,
    unloadedBoundaryPolicy: "leak" as const,
    maximumVisitedCells: requireInteger(source.maximumVisitedCells, 1, AIR_ZONE_MAX_CELLS_V1, "maximumVisitedCells"),
  });
  const hasher = new TypeScriptCanonicalHasher("blockwild-air-zone-topology-v1");
  hasher.writeU16(withoutHash.schemaVersion); writeIdentity(hasher, withoutHash.identity);
  hasher.writeU64(withoutHash.topologyRevision).writeI32(shape.origin.x).writeI32(shape.origin.y).writeI32(shape.origin.z)
    .writeU32(shape.size.x).writeU32(shape.size.y).writeU32(shape.size.z).writeBytes(cells).writeString("leak").writeU32(withoutHash.maximumVisitedCells);
  return Object.freeze({ ...withoutHash, inputHash: hasher.finishHex() });
}

function assertResultIdentity(result: SimulationJobIdentityV1, expected?: SimulationJobIdentityV1) {
  assertJobIdentity(result);
  if (expected && (result.jobId !== expected.jobId || result.sequence !== expected.sequence
    || result.sourceSnapshotHash !== expected.sourceSnapshotHash
    || !sameWorldAddressV1(result.world.address, expected.world.address)
    || !sameWorldRevisionV1(result.world.revision, expected.world.revision)
    || result.world.stateHash !== expected.world.stateHash)) {
    throw new SimulationContractError("result-identity", "simulation result does not belong to the submitted job");
  }
}

export function createPhysicsStepResultV1(source: PhysicsStepResultV1Source, expected?: PhysicsStepInputV1): PhysicsStepResultV1 {
  assertResultIdentity(source.identity, expected?.identity);
  const body = normalizeBody(source.body);
  const contactFlags = requireInteger(source.contactFlags, 0, 0x3ff, "contactFlags");
  const events = Object.freeze(source.events.map((event) => {
    if (!["jump", "land", "fall-damage", "drown-damage", "liquid-enter", "liquid-exit", "shore-exit"].includes(event.kind)) {
      throw new SimulationContractError("physics-event", `unknown physics event ${String(event.kind)}`);
    }
    return Object.freeze({ kind: event.kind, amount: requireFinite(event.amount, 0, 1_000_000, "event.amount") });
  }));
  const withoutHash = Object.freeze({ schemaVersion: SIMULATION_SCHEMA_V1, identity: source.identity, body, contactFlags, events });
  const hasher = new TypeScriptCanonicalHasher("blockwild-physics-step-result-v1");
  hasher.writeU16(withoutHash.schemaVersion); writeIdentity(hasher, withoutHash.identity); writeBody(hasher, body); hasher.writeU16(contactFlags).writeU32(events.length);
  for (const event of events) { hasher.writeString(event.kind); writeFloat(hasher, event.amount); }
  return Object.freeze({ ...withoutHash, resultHash: hasher.finishHex() });
}

export function createLiquidFrontierResultV1(source: LiquidFrontierResultV1Source, expected?: LiquidFrontierStepV1): LiquidFrontierResultV1 {
  assertResultIdentity(source.identity, expected?.identity);
  if (!(source.positions instanceof Int32Array) || source.positions.length % 3 !== 0) throw new SimulationContractError("liquid-result-positions", "liquid result positions must be Int32 xyz triples");
  if (!(source.remainingFrontier instanceof Int32Array) || source.remainingFrontier.length % 3 !== 0) throw new SimulationContractError("liquid-result-frontier", "remaining liquid frontier must be Int32 xyz triples");
  const count = source.positions.length / 3;
  const streams = [source.previousKinds, source.previousLevels, source.previousFlags, source.nextKinds, source.nextLevels, source.nextFlags] as const;
  for (const stream of streams) if (!(stream instanceof Uint8Array) || stream.length !== count) throw new SimulationContractError("liquid-result-stream", "every liquid result stream must match its change count");
  for (let index = 0; index < count; index += 1) {
    if (!liquidKindIsValidV1(source.previousKinds[index]) || !liquidKindIsValidV1(source.nextKinds[index])) throw new SimulationContractError("liquid-result-kind", "liquid result contains an unknown kind");
    if (source.previousLevels[index] > 8 || source.nextLevels[index] > 8) throw new SimulationContractError("liquid-result-level", "liquid result levels must be in 0..8");
    if ((source.previousFlags[index] & ~0x0f) !== 0 || (source.nextFlags[index] & ~0x0f) !== 0) throw new SimulationContractError("liquid-result-flags", "liquid result contains unknown flags");
  }
  const withoutHash = Object.freeze({
    schemaVersion: SIMULATION_SCHEMA_V1,
    identity: source.identity,
    positions: Int32Array.from(source.positions),
    previousKinds: Uint8Array.from(source.previousKinds),
    previousLevels: Uint8Array.from(source.previousLevels),
    previousFlags: Uint8Array.from(source.previousFlags),
    nextKinds: Uint8Array.from(source.nextKinds),
    nextLevels: Uint8Array.from(source.nextLevels),
    nextFlags: Uint8Array.from(source.nextFlags),
    remainingFrontier: Int32Array.from(source.remainingFrontier),
    operations: requireInteger(source.operations, 0, LIQUID_FRONTIER_MAX_CELLS_V1, "liquid.operations"),
  });
  if (expected && withoutHash.operations > expected.operationBudget) throw new SimulationContractError("liquid-operation-budget", "liquid result exceeds its submitted operation budget");
  const hasher = new TypeScriptCanonicalHasher("blockwild-liquid-frontier-result-v1");
  hasher.writeU16(withoutHash.schemaVersion); writeIdentity(hasher, withoutHash.identity); hasher.writeU32(withoutHash.operations);
  for (const stream of [withoutHash.positions, withoutHash.previousKinds, withoutHash.previousLevels, withoutHash.previousFlags,
    withoutHash.nextKinds, withoutHash.nextLevels, withoutHash.nextFlags, withoutHash.remainingFrontier]) hasher.writeBytes(bytes(stream));
  return Object.freeze({ ...withoutHash, resultHash: hasher.finishHex() });
}

export function createPathJobResultV1(source: PathJobResultV1Source, expected?: PathJobV1): PathJobResultV1 {
  assertResultIdentity(source.identity, expected?.identity);
  if (!(source.cells instanceof Int32Array) || source.cells.length % 3 !== 0) throw new SimulationContractError("path-result-cells", "path result cells must be Int32 xyz triples");
  const count = source.cells.length / 3;
  if (!(source.transitions instanceof Uint8Array) || source.transitions.length !== count) throw new SimulationContractError("path-result-transitions", "path transitions must match the path cell count");
  for (const transition of source.transitions) if (transition > PathTransitionV1.Door) throw new SimulationContractError("path-transition", "path result contains an unknown transition");
  const code = requireInteger(source.code, PathResultCodeV1.Found, PathResultCodeV1.Stale, "path.code") as PathResultCodeV1;
  if ((code === PathResultCodeV1.Found) !== (count > 0)) throw new SimulationContractError("path-result-shape", "only a found path may contain traversal cells");
  const withoutHash = Object.freeze({
    schemaVersion: SIMULATION_SCHEMA_V1,
    identity: source.identity,
    code,
    cells: Int32Array.from(source.cells),
    transitions: Uint8Array.from(source.transitions),
    visited: requireInteger(source.visited, 0, PATH_MAX_NODES_V1, "path.visited"),
    nearest: normalizeVector(source.nearest, "path.nearest"),
  });
  if (expected && withoutHash.visited > expected.maximumNodes) throw new SimulationContractError("path-node-budget", "path result exceeds its submitted node budget");
  const hasher = new TypeScriptCanonicalHasher("blockwild-path-result-v1");
  hasher.writeU16(withoutHash.schemaVersion); writeIdentity(hasher, withoutHash.identity); hasher.writeU16(code)
    .writeBytes(bytes(withoutHash.cells)).writeBytes(withoutHash.transitions).writeU32(withoutHash.visited); writeVector(hasher, withoutHash.nearest);
  return Object.freeze({ ...withoutHash, resultHash: hasher.finishHex() });
}

export function createAirZoneTopologyResultV1(source: AirZoneTopologyResultV1Source, expected: AirZoneTopologyJobV1): AirZoneTopologyResultV1 {
  assertResultIdentity(source.identity, expected.identity);
  const cellCount = expected.size.x * expected.size.y * expected.size.z;
  if (!(source.zoneIds instanceof Uint32Array) || source.zoneIds.length !== cellCount) throw new SimulationContractError("air-zone-result-cells", "air-zone labels must match the submitted topology window");
  if (source.topologyRevision !== expected.topologyRevision) throw new SimulationContractError("air-zone-topology-revision", "air-zone result was produced from a stale topology revision");
  const zones = [...source.zones].map((zone) => Object.freeze({
    zoneId: requireInteger(zone.zoneId, 1, 0xffff_ffff, "air-zone.zoneId"),
    cellCount: requireInteger(zone.cellCount, 1, cellCount, "air-zone.cellCount"),
    leakFaces: requireInteger(zone.leakFaces, 0, 0x7f, "air-zone.leakFaces"),
    ventCount: requireInteger(zone.ventCount, 0, cellCount, "air-zone.ventCount"),
    airlockDoorCount: requireInteger(zone.airlockDoorCount, 0, cellCount, "air-zone.airlockDoorCount"),
    sealed: zone.sealed,
  })).sort((left, right) => left.zoneId - right.zoneId);
  for (let index = 1; index < zones.length; index += 1) if (zones[index - 1].zoneId === zones[index].zoneId) throw new SimulationContractError("air-zone-duplicate", "air-zone summaries must have unique ids");
  for (const zone of zones) {
    const unknownLeak = (zone.leakFaces & AirLeakFaceV1.UnknownBoundary) !== 0;
    if (zone.sealed !== (zone.leakFaces === 0) || (unknownLeak && zone.sealed)) throw new SimulationContractError("air-zone-seal", "a zone is sealed exactly when it has no leak faces; unknown boundaries always leak");
  }
  const zoneIds = Uint32Array.from(source.zoneIds);
  const known = new Set(zones.map((zone) => zone.zoneId));
  for (const zoneId of zoneIds) if (zoneId !== 0 && !known.has(zoneId)) throw new SimulationContractError("air-zone-missing-summary", "air-zone labels reference an unknown summary");
  const withoutHash = Object.freeze({
    schemaVersion: SIMULATION_SCHEMA_V1,
    identity: source.identity,
    topologyRevision: source.topologyRevision,
    zoneIds,
    zones: Object.freeze(zones),
    visitedCells: requireInteger(source.visitedCells, 0, expected.maximumVisitedCells, "air-zone.visitedCells"),
    budgetExhausted: source.budgetExhausted,
  });
  const hasher = new TypeScriptCanonicalHasher("blockwild-air-zone-result-v1");
  hasher.writeU16(withoutHash.schemaVersion); writeIdentity(hasher, withoutHash.identity); hasher.writeU64(withoutHash.topologyRevision)
    .writeBytes(bytes(zoneIds)).writeU32(zones.length);
  for (const zone of zones) hasher.writeU32(zone.zoneId).writeU32(zone.cellCount).writeU16(zone.leakFaces).writeU32(zone.ventCount)
    .writeU32(zone.airlockDoorCount).writeU16(zone.sealed ? 1 : 0);
  hasher.writeU32(withoutHash.visitedCells).writeU16(withoutHash.budgetExhausted ? 1 : 0);
  return Object.freeze({ ...withoutHash, resultHash: hasher.finishHex() });
}

export function simulationResultIsCurrentV1(result: Pick<PhysicsStepResultV1 | LiquidFrontierResultV1 | PathJobResultV1 | AirZoneTopologyResultV1, "identity">, current: WorldAuthorityIdentityV1) {
  return sameWorldAddressV1(result.identity.world.address, current.address)
    && sameWorldRevisionV1(result.identity.world.revision, current.revision)
    && result.identity.world.stateHash === current.stateHash;
}

function uniqueTransferBuffers(views: readonly ArrayBufferView[]) {
  const result: ArrayBuffer[] = [];
  const seen = new Set<ArrayBuffer>();
  for (const view of views) {
    if (!(view.buffer instanceof ArrayBuffer)) throw new SimulationContractError("shared-buffer", "V1 compatibility jobs require transferable ArrayBuffers");
    if (!seen.has(view.buffer)) { seen.add(view.buffer); result.push(view.buffer); }
  }
  return result;
}

function worldWindowViews(window: WorldReadWindowV1) {
  return [window.streams.loadedMask, window.streams.boundary, window.streams.blocks, window.streams.facing,
    window.streams.liquidKind, window.streams.liquidLevel, window.streams.flags] as const;
}

export function physicsStepTransferListV1(input: PhysicsStepInputV1) {
  return uniqueTransferBuffers(worldWindowViews(input.window));
}

export function liquidFrontierTransferListV1(input: LiquidFrontierStepV1) {
  return uniqueTransferBuffers([...worldWindowViews(input.window), input.frontier]);
}

export function pathJobTransferListV1(input: PathJobV1) {
  return uniqueTransferBuffers([input.occupancy.cells]);
}

export function airZoneTopologyTransferListV1(input: AirZoneTopologyJobV1) {
  return uniqueTransferBuffers([input.cells]);
}

export function liquidResultTransferListV1(result: LiquidFrontierResultV1) {
  return uniqueTransferBuffers([result.positions, result.previousKinds, result.previousLevels, result.previousFlags,
    result.nextKinds, result.nextLevels, result.nextFlags, result.remainingFrontier]);
}

export function pathResultTransferListV1(result: PathJobResultV1) {
  return uniqueTransferBuffers([result.cells, result.transitions]);
}

export function airZoneResultTransferListV1(result: AirZoneTopologyResultV1) {
  return uniqueTransferBuffers([result.zoneIds]);
}

export function simulationWorldAddressV1(identity: SimulationJobIdentityV1): WorldAddressV1 {
  return identity.world.address;
}

/** Existing Blockwild liquid ordering is wire-stable and must be preserved in Rust. */
export const LIQUID_NEIGHBOR_ORDER_V1 = Object.freeze([
  Object.freeze({ x: 1, y: 0, z: 0 }),
  Object.freeze({ x: -1, y: 0, z: 0 }),
  Object.freeze({ x: 0, y: 0, z: 1 }),
  Object.freeze({ x: 0, y: 0, z: -1 }),
  Object.freeze({ x: 0, y: 1, z: 0 }),
  Object.freeze({ x: 0, y: -1, z: 0 }),
]);

/** Existing A* tie order: cardinal direction first, then same/up/down elevation. */
export const PATH_NEIGHBOR_ORDER_V1 = Object.freeze([
  Object.freeze({ x: 1, z: 0 }),
  Object.freeze({ x: -1, z: 0 }),
  Object.freeze({ x: 0, z: 1 }),
  Object.freeze({ x: 0, z: -1 }),
]);

export const PATH_ELEVATION_ORDER_V1 = Object.freeze([0, 1, -1]);

export function liquidKindIsValidV1(kind: number) {
  return Number.isInteger(kind) && kind >= WorldLiquidKindV1.None && kind <= WorldLiquidKindV1.Syrup;
}
