import assert from "node:assert/strict";
import test from "node:test";

import { VoxelEngine } from "../app/game/engine.ts";
import { encodeRustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-codec-r6.ts";
import type {
  RustEntityExtractionR6V3,
  RustEntityExtractionRecordR6V3,
} from "../app/game/rust-entity-authority-contract-r6.ts";
import type { RustIntegratedRuntimeExtractionV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";
import {
  decodeRustLivePlayerViewR10,
  type RustLivePlayerViewR10,
} from "../app/game/rust-live-player-view-r10.ts";

const encoder = new TextEncoder();
const ZERO = new Uint8Array(16);
const ENTITY_ID = BigInt("4294967297");
const PLAYER_ID = BigInt("12884901895");
const ACTOR = "player:environmental";

class Writer {
  private readonly bytes: number[] = [];
  raw(value: Uint8Array) { this.bytes.push(...value); return this; }
  u8(value: number) { this.bytes.push(value & 0xff); return this; }
  u16(value: number) { this.bytes.push(value & 0xff, value >>> 8 & 0xff); return this; }
  u32(value: number) {
    this.bytes.push(value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff);
    return this;
  }
  u64(value: bigint | number) {
    let checked = BigInt.asUintN(64, BigInt(value));
    for (let index = 0; index < 8; index += 1) {
      this.bytes.push(Number(checked & BigInt(0xff)));
      checked >>= BigInt(8);
    }
    return this;
  }
  f64(value: number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    return this.raw(bytes);
  }
  string(value: string) {
    const bytes = encoder.encode(value);
    return this.u32(bytes.byteLength).raw(bytes);
  }
  finish() { return Uint8Array.from(this.bytes); }
}

type Field = readonly [string, Uint8Array];
const bool = (value: boolean) => new Writer().u8(0).u8(value ? 1 : 0).finish();
const u64 = (value: bigint | number) => new Writer().u8(1).u64(value).finish();
const i64 = (value: bigint | number) => new Writer().u8(2).u64(value).finish();
const f64 = (value: number) => new Writer().u8(3).f64(value).finish();
const string = (value: string) => new Writer().u8(4).string(value).finish();
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function row(kind: number, key: string, unordered: readonly Field[]) {
  const fields = [...unordered].sort((left, right) => compare(left[0], right[0]));
  const hasher = new TypeScriptCanonicalHasher("blockwild.r10.domain-row-revision.v1")
    .writeU16(kind).writeString(key).writeU16(fields.length);
  for (const [name, value] of fields) hasher.writeString(name).writeBytes(value);
  const hash = hasher.finish();
  const revision = new DataView(hash.buffer, hash.byteOffset, 8).getBigUint64(0, true);
  const output = new Writer().u16(kind).string(key).u64(revision).u16(fields.length);
  for (const [name, value] of fields) output.string(name).raw(value);
  return output.finish();
}

type Options = Readonly<{
  health?: number;
  maxHealth?: number;
  combatHealth?: number;
  combatMaxHealth?: number;
  combatAlive?: boolean;
  combatRecordId?: string;
  combatOwner?: string;
  combatEntityId?: bigint;
  combatantRevision?: bigint;
  gameplaySequence?: bigint;
  gameplayCombatRevision?: bigint;
  vitalUnits?: string;
  crossDomainParity?: boolean;
  combatEntityWire?: "u64" | "i64";
  contactFlags?: number;
  submerged?: boolean;
  oxygenSeconds?: number;
  drowningAccumulator?: number;
  fallDistance?: number;
  lastDamageTick?: bigint;
  combatOmitted?: number;
  effectCues?: readonly Readonly<{
    sequence: bigint;
    tick: bigint;
    entityExternalId: string;
    kind: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    amount: number;
  }>[];
  effectOmitted?: number;
}>;

function effectBundle(options: Options) {
  const cues = options.effectCues ?? [];
  const omitted = options.effectOmitted ?? 0;
  const writer = new Writer().raw(encoder.encode("BWAU")).u16(2).u64(41)
    .u32(cues.length + omitted).u32(cues.length).u32(omitted);
  for (const cue of cues) {
    writer.u64(cue.sequence).u64(cue.tick).string(cue.entityExternalId).u8(cue.kind).f64(cue.amount);
  }
  return writer.finish();
}

function domainBundle(options: Options) {
  const contactFlags = options.contactFlags ?? 0;
  const combatHealth = options.combatHealth ?? 9_500;
  const combatAlive = options.combatAlive ?? combatHealth > 0;
  const runtime = row(1, ACTOR, [
    ["buttons", u64(0)],
    ["contactFlags", u64(contactFlags)],
    ["crouching", bool(false)],
    ["drowningAccumulator", f64(options.drowningAccumulator ?? 0)],
    ["entityId", u64(ENTITY_ID)],
    ["fallDistance", f64(options.fallDistance ?? 0)],
    ["flags", u64(0)],
    ["gameplayCombatRevision", u64(options.gameplayCombatRevision ?? 1)],
    ["gameplaySequence", u64(options.gameplaySequence ?? 4)],
    ["grounded", bool(true)],
    ["height", f64(1.8)],
    ["lastInputSequence", u64(0)],
    ["lookPitch", i64(0)],
    ["mass", f64(80)],
    ["maximumOxygenSeconds", f64(15)],
    ["miningStateEmpty", bool(true)],
    ["oxygenSeconds", f64(options.oxygenSeconds ?? 15)],
    ["pendingContextCommandsEmpty", bool(true)],
    ["pendingMovementResultEmpty", bool(true)],
    ["position.x", f64(8)], ["position.y", f64(64)], ["position.z", f64(8)],
    ["queuedInputsEmpty", bool(true)],
    ["radius", f64(0.35)],
    ["selectedSlot", u64(0)],
    ["velocity.x", f64(0)], ["velocity.y", f64(0)], ["velocity.z", f64(0)],
    ["deathSequence.present", bool(!combatAlive)],
    ...(!combatAlive ? [["deathSequence.value", u64(1)] as Field] : []),
    ["lastRespawnSequence.present", bool(false)],
    ["latestDeathRespawn.present", bool(false)],
  ]);
  const binding = row(2, `binding:${PLAYER_ID}`, [
    ["actorId", string(ACTOR)],
    ["backSlot.present", bool(false)],
    ["entityId", u64(ENTITY_ID)],
    ["entityRevision", u64(2)],
    ["equipmentContainer", string("container-key-v1/01")],
    ["equipmentContainerRevision", u64(0)],
    ["held.present", bool(false)],
    ["inventoryContainer", string("container-key-v1/00")],
    ["inventoryContainerRevision", u64(0)],
    ["playerId", u64(PLAYER_ID)],
    ["selectedSlot", u64(0)],
  ]);
  const combatEntity = options.combatEntityId ?? ENTITY_ID;
  const combat = row(1, `combatant:${options.combatRecordId ?? ACTOR}`, [
    ["alive", bool(combatAlive)],
    ["combatantRevision", u64(options.combatantRevision ?? 0)],
    ["crossDomainParity", bool(options.crossDomainParity ?? true)],
    ["entityId", options.combatEntityWire === "i64" ? i64(combatEntity) : u64(combatEntity)],
    ["health", u64(combatHealth)],
    ["maxHealth", u64(options.combatMaxHealth ?? 10_000)],
    ["ownerId.present", bool(true)],
    ["ownerId.value", string(options.combatOwner ?? ACTOR)],
    ["vitalUnits", string(options.vitalUnits ?? "millihearts-v1")],
  ]);
  const playerRows = new Writer().raw(runtime).raw(binding).finish();
  const writer = new Writer().raw(encoder.encode("BWX0")).u16(1)
    .u64(7).u64(41).raw(Uint8Array.from({ length: 16 }, () => 5)).raw(ZERO).u8(1).u16(8);
  for (let domain = 1; domain <= 8; domain += 1) {
    const payload = domain === 2 ? playerRows : domain === 5 ? combat : new Uint8Array();
    const selected = domain === 2 ? 2 : domain === 5 ? 1 : 0;
    const omitted = domain === 5 ? options.combatOmitted ?? 0 : 0;
    const total = selected + omitted;
    const payloadHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-view-payload.v1")
      .writeBytes(payload).finish();
    writer.u8(domain).u16(1).u8(domain === 5 && omitted > 0 ? 1 : 0).u64(domain === 5 ? 4 : 2)
      .u32(total).u32(selected).u32(omitted).u32(selected).u16(0)
      .u32(payload.byteLength).raw(payloadHash).raw(payload);
  }
  return writer.finish();
}

function entityRecord(options: Options): RustEntityExtractionRecordR6V3 {
  return Object.freeze({
    entityId: ENTITY_ID,
    residency: "hot",
    class: "player",
    simulationTier: "hero",
    protection: BigInt(0),
    entityRevision: BigInt(2),
    externalEntityId: ACTOR,
    specimenId: ACTOR,
    kindKey: "player",
    variantKey: null,
    name: "Environmental Player",
    modelKey: "player-standing",
    modelRevision: 0,
    modelHash: ZERO,
    position: Object.freeze({ x: 8, y: 64, z: 8 }),
    yaw: 0,
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    health: options.health ?? 9.5,
    maximumHealth: options.maxHealth ?? 10,
    tamed: false,
    ageTicks: BigInt(41),
    movementMode: options.submerged ? "swim" : "ground",
    grounded: true,
    submerged: options.submerged ?? false,
    lastDamageTick: options.lastDamageTick ?? BigInt(40),
    action: Object.freeze({ key: "idle", phase: 0, startedTick: BigInt(0), endsTick: BigInt(0), target: null }),
    equipment: Object.freeze([]),
    mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
    research: Object.freeze([]),
  });
}

function extraction(options: Options = {}): RustIntegratedRuntimeExtractionV1 {
  const entities: RustEntityExtractionR6V3 = Object.freeze({
    schema: 3,
    extractionRevision: BigInt(7),
    authorityTick: BigInt(41),
    contentManifestHash: ZERO,
    contentReady: true,
    total: 1,
    selected: 1,
    omitted: 0,
    records: Object.freeze([entityRecord(options)]),
  });
  return Object.freeze({
    identity: Object.freeze({
      universeId: "world:environmental",
      locationId: "surface",
      revision: Object.freeze({ epoch: 1, world: 1, entities: 2, gameplay: 4, persistence: 1, network: 0, simulation: 5 }),
      tick: 41,
      stateHash: "05".repeat(16),
    }),
    extractionRevision: 7,
    render: encodeRustEntityExtractionR6V3(entities),
    hud: domainBundle(options),
    audio: effectBundle(options),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: "07".repeat(16),
  });
}

test("live player environmental view joins oxygen/contact state with exact R6/R7 milliheart custody", () => {
  const view = decodeRustLivePlayerViewR10(extraction({
    contactFlags: (1 << 6) | (1 << 7),
    submerged: true,
    oxygenSeconds: 2.25,
    drowningAccumulator: 0.75,
    fallDistance: 6.5,
    lastDamageTick: BigInt(40),
    effectCues: [
      { sequence: BigInt(1), tick: BigInt(40), entityExternalId: ACTOR, kind: 3, amount: 0.5 },
      { sequence: BigInt(2), tick: BigInt(41), entityExternalId: ACTOR, kind: 6, amount: 0 },
    ],
  }), ACTOR);
  assert.deepEqual({
    contactFlags: view.contactFlags,
    inLiquid: view.inLiquid,
    headSubmerged: view.headSubmerged,
    drowningAccumulator: view.drowningAccumulator,
    fallDistance: view.fallDistance,
    oxygenSeconds: view.oxygenSeconds,
    lastDamageTick: view.lastDamageTick,
  }, {
    contactFlags: 192,
    inLiquid: true,
    headSubmerged: true,
    drowningAccumulator: 0.75,
    fallDistance: 6.5,
    oxygenSeconds: 2.25,
    lastDamageTick: BigInt(40),
  });
  assert.deepEqual(view.combat, {
    domainRevision: BigInt(4),
    rowRevision: view.combat.rowRevision,
    combatantRevision: BigInt(0),
    recordId: ACTOR,
    ownerId: ACTOR,
    entityId: ENTITY_ID,
    vitalUnits: "millihearts-v1",
    health: 9_500,
    maxHealth: 10_000,
    alive: true,
    crossDomainParity: true,
  });
  assert.deepEqual({
    schema: view.respawnAuthoritySchema,
    gameplaySequence: view.gameplaySequence,
    gameplayCombatRevision: view.gameplayCombatRevision,
    deathSequence: view.deathSequence,
    lastRespawnSequence: view.lastRespawnSequence,
    queuedInputsEmpty: view.queuedInputsEmpty,
    pendingContextCommandsEmpty: view.pendingContextCommandsEmpty,
    pendingMovementResultEmpty: view.pendingMovementResultEmpty,
    miningStateEmpty: view.miningStateEmpty,
    latestDeathRespawn: view.latestDeathRespawn,
  }, {
    schema: 1,
    gameplaySequence: BigInt(4),
    gameplayCombatRevision: BigInt(1),
    deathSequence: null,
    lastRespawnSequence: null,
    queuedInputsEmpty: true,
    pendingContextCommandsEmpty: true,
    pendingMovementResultEmpty: true,
    miningStateEmpty: true,
    latestDeathRespawn: null,
  });
  assert.deepEqual({
    producer: view.effects.producer,
    playerExternalId: view.effects.playerExternalId,
    authorityTick: view.effects.authorityTick,
    total: view.effects.total,
    selected: view.effects.selected,
    omitted: view.effects.omitted,
    firstSequence: view.effects.firstSequence,
    lastSequence: view.effects.lastSequence,
    contiguous: view.effects.contiguous,
    cues: view.effects.cues.map((cue) => ({ ...cue })),
  }, {
    producer: "rust-bwau-v2",
    playerExternalId: ACTOR,
    authorityTick: BigInt(41),
    total: 2,
    selected: 2,
    omitted: 0,
    firstSequence: BigInt(1),
    lastSequence: BigInt(2),
    contiguous: true,
    cues: [
      { sequence: BigInt(1), tick: BigInt(40), entityExternalId: ACTOR, kind: "drown-damage", amount: 0.5 },
      { sequence: BigInt(2), tick: BigInt(41), entityExternalId: ACTOR, kind: "shore-exit", amount: 0 },
    ],
  });
});

test("live player environmental decoder preserves BWAU coverage and linked cue identity fail-closed", () => {
  const incomplete = decodeRustLivePlayerViewR10(extraction({
    effectOmitted: 1,
    effectCues: [
      { sequence: BigInt(2), tick: BigInt(39), entityExternalId: "player:other", kind: 6, amount: 1 },
      { sequence: BigInt(4), tick: BigInt(41), entityExternalId: ACTOR, kind: 6, amount: 0 },
    ],
  }), ACTOR);
  assert.equal(incomplete.effects.omitted, 1);
  assert.equal(incomplete.effects.contiguous, false);
  assert.equal(incomplete.effects.cues[0]?.entityExternalId, "player:other");
  assert.equal(incomplete.effects.cues[0]?.amount, 1);
});

test("live player environmental view fails closed on every R6/R7 link, vital, and contact drift", () => {
  for (const [options, message] of [
    [{ combatHealth: 9_499 }, /R6 and R7 health/u],
    [{ combatMaxHealth: 9_999 }, /R6 and R7 health/u],
    [{ combatAlive: false }, /R6 and R7 health/u],
    [{ combatRecordId: "player:other" }, /combat record or owner/u],
    [{ combatOwner: "player:other" }, /combat record or owner/u],
    [{ combatEntityId: BigInt(99) }, /exactly one R7 row/u],
    [{ vitalUnits: "legacy-whole-hearts-v1" }, /exact-linked milliheart/u],
    [{ crossDomainParity: false }, /exact-linked milliheart/u],
    [{ combatEntityWire: "i64" }, /wrong wire type/u],
    [{ combatOmitted: 1 }, /missing or truncated/u],
    [{ contactFlags: 1 << 6, submerged: false }, /contacts and BWR6 submerged/u],
    [{ contactFlags: 1 << 7, submerged: false }, /contacts and BWR6 submerged/u],
  ] as const) {
    assert.throws(() => decodeRustLivePlayerViewR10(extraction(options), ACTOR), message);
  }
});

function projectedView(overrides: Partial<RustLivePlayerViewR10> = {}): RustLivePlayerViewR10 {
  const health = overrides.health ?? 10;
  const authorityTick = overrides.authorityTick ?? BigInt(1);
  const combat = overrides.combat ?? Object.freeze({
    domainRevision: BigInt(1), rowRevision: BigInt(1), combatantRevision: BigInt(1),
    recordId: ACTOR, ownerId: ACTOR, entityId: ENTITY_ID,
    vitalUnits: "millihearts-v1" as const, health: Math.round(health * 1_000), maxHealth: 10_000,
    alive: health > 0, crossDomainParity: true as const,
  });
  const effects = overrides.effects ?? Object.freeze({
    schema: 1 as const,
    producer: "rust-bwau-v2" as const,
    playerExternalId: ACTOR,
    authorityTick,
    total: 0,
    selected: 0,
    omitted: 0,
    firstSequence: null,
    lastSequence: null,
    contiguous: true,
    cues: Object.freeze([]),
  });
  return Object.freeze({
    extractionRevision: BigInt(1), authorityTick, externalEntityId: ACTOR, actorId: ACTOR,
    playerId: PLAYER_ID, entityId: ENTITY_ID, entityRevision: BigInt(1), inventoryContainer: "container-key-v1/00",
    inventoryContainerRevision: BigInt(0), equipmentContainer: "container-key-v1/01", equipmentContainerRevision: BigInt(0),
    selectedSlot: 0, backSlot: null, respawnAuthoritySchema: 1, gameplaySequence: BigInt(1),
    gameplayCombatRevision: BigInt(1), deathSequence: null, lastRespawnSequence: null, queuedInputsEmpty: true,
    pendingContextCommandsEmpty: true, pendingMovementResultEmpty: true, miningStateEmpty: true,
    latestDeathRespawn: null, lastInputSequence: BigInt(0), buttons: 0, authoritativeFlags: 0, lookYaw: null,
    lookPitch: 0, position: Object.freeze({ x: 8, y: 64, z: 8 }), velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    radius: 0.35, height: 1.8, mass: 80, grounded: true, crouching: false, contactFlags: 0, inLiquid: false,
    headSubmerged: false, drowningAccumulator: 0, fallDistance: 0, oxygenSeconds: 15, maximumOxygenSeconds: 15,
    health, maximumHealth: 10, lastDamageTick: BigInt(0), combat, effects, held: null,
    ...overrides,
  });
}

function projectionHarness() {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const vector = (x: number, y: number, z: number) => ({ x, y, z, set(nx: number, ny: number, nz: number) { this.x = nx; this.y = ny; this.z = nz; } });
  const effects = { audio: 0, deaths: 0 };
  const authority = { inputClears: 0, respawnSchedules: 0 };
  const previous = projectedView();
  Object.assign(engine, {
    rustLivePlayerAttestationR10: Object.freeze({ externalEntityId: ACTOR, actorId: ACTOR, playerId: PLAYER_ID,
      entityId: ENTITY_ID, creativeMode: false, maximumOxygenSeconds: 15, maximumHealth: 10,
      inventoryContainer: Object.freeze({ kind: "player", id: ACTOR, ownerId: ACTOR }), radius: 0.35,
      standingHeight: 1.8, crouchingHeight: 1.2, mass: 80 }),
    rustLivePlayerInitialYawRadiansR10: 0,
    rustLivePlayerPresentationViewR10: previous,
    rustLiveSelectedSlotIntentR5: 0,
    rustLiveSelectedSlotIntentPendingR5: false,
    rustLiveLookIntentR5: Object.freeze({ yawRadians: 0, pitchRadians: 0 }),
    rustLiveLookIntentPendingR5: false,
    rustLiveProjectedDamageEventsR10: 0,
    rustLiveProjectedDeathEventsR10: 0,
    rustLiveTypeScriptDamageAuthoringCallsR5: 0,
    rustLiveSuppressedLegacyDamageCallsR5: 0,
    rustLivePlayerRespawnPendingR5: null,
    rustNativeSaveQueued: false,
    rustNativeSaveOperation: null,
    position: vector(0, 0, 0), velocity: vector(0, 0, 0), selected: 0, health: 10, oxygenSeconds: 15,
    mode: "survival", mountedBoatId: null, mountedCreatureId: null, mountedCreatureSeat: null, seatedAt: null,
    audio: { play: (kind: string) => { if (kind === "hurt") effects.audio += 1; } },
    events: { onDeath: () => { effects.deaths += 1; }, onSelectedSlot: () => undefined },
    clearInput: () => { authority.inputClears += 1; },
    scheduleRustLiveInputAdvanceR5: () => { authority.respawnSchedules += 1; },
  });
  return { engine, effects, authority };
}

test("native environmental projection emits presentation once per authoritative health/death edge", () => {
  const { engine, effects } = projectionHarness();
  const project = (view: RustLivePlayerViewR10) => (engine as unknown as {
    projectRustLivePlayerViewR10(value: RustLivePlayerViewR10): void;
  }).projectRustLivePlayerViewR10(view);
  const damaged = projectedView({
    extractionRevision: BigInt(2), authorityTick: BigInt(2), entityRevision: BigInt(2), health: 8.5,
    oxygenSeconds: 2, inLiquid: true, headSubmerged: true, contactFlags: 192, drowningAccumulator: 0.5,
    lastDamageTick: BigInt(2), combat: Object.freeze({ ...projectedView().combat, domainRevision: BigInt(2),
      rowRevision: BigInt(2), health: 8_500 }),
  });
  project(damaged);
  assert.equal((engine as unknown as { health: number }).health, 8.5);
  assert.equal((engine as unknown as { headSubmerged: boolean }).headSubmerged, true);
  assert.deepEqual(effects, { audio: 1, deaths: 0 });
  (engine as unknown as { rustLivePlayerPresentationViewR10: RustLivePlayerViewR10 }).rustLivePlayerPresentationViewR10 = damaged;
  project(damaged);
  assert.deepEqual(effects, { audio: 1, deaths: 0 }, "reapplying one extraction cannot duplicate feedback");

  const dead = projectedView({
    extractionRevision: BigInt(3), authorityTick: BigInt(3), entityRevision: BigInt(3), health: 0,
    deathSequence: BigInt(1), lastDamageTick: BigInt(3),
    combat: Object.freeze({ ...damaged.combat, domainRevision: BigInt(3), rowRevision: BigInt(3),
      health: 0, alive: false }),
  });
  project(dead);
  assert.deepEqual(effects, { audio: 2, deaths: 1 });
  (engine as unknown as { rustLivePlayerPresentationViewR10: RustLivePlayerViewR10 }).rustLivePlayerPresentationViewR10 = dead;
  project(dead);
  assert.deepEqual(effects, { audio: 2, deaths: 1 }, "death presentation is an edge, not a repeated authoring loop");
});

test("native environmental death queues the exact complete authority view for respawn after input neutralization", async () => {
  const { engine, authority } = projectionHarness();
  const dead = projectedView({
    extractionRevision: BigInt(2), authorityTick: BigInt(2), entityRevision: BigInt(2), health: 0,
    gameplaySequence: BigInt(2), gameplayCombatRevision: BigInt(2), deathSequence: BigInt(1),
    lastDamageTick: BigInt(2), combat: Object.freeze({ ...projectedView().combat,
      domainRevision: BigInt(2), rowRevision: BigInt(2), combatantRevision: BigInt(2), health: 0, alive: false }),
  });
  (engine as unknown as { projectRustLivePlayerViewR10(value: RustLivePlayerViewR10): void })
    .projectRustLivePlayerViewR10(dead);
  assert.equal(authority.inputClears, 1, "native death must neutralize browser input before respawn dispatch");
  assert.equal(
    (engine as unknown as { rustLivePlayerRespawnPendingR5: RustLivePlayerViewR10 | null })
      .rustLivePlayerRespawnPendingR5,
    dead,
    "the full dead-player R5/R6/R7 CAS source must remain the pending respawn authority",
  );
  await Promise.resolve();
  assert.equal(authority.respawnSchedules, 1, "the native respawn scheduler must be queued exactly once for this death view");
});

test("native environmental projection rejects omitted or discontinuous BWAU journal coverage", () => {
  const { engine } = projectionHarness();
  const project = (view: RustLivePlayerViewR10) => (engine as unknown as {
    projectRustLivePlayerViewR10(value: RustLivePlayerViewR10): void;
  }).projectRustLivePlayerViewR10(view);
  const cue = Object.freeze({
    sequence: BigInt(2), tick: BigInt(1), entityExternalId: ACTOR,
    kind: "shore-exit" as const, amount: 0,
  });
  assert.throws(() => project(projectedView({
    effects: Object.freeze({
      schema: 1, producer: "rust-bwau-v2", playerExternalId: ACTOR, authorityTick: BigInt(1),
      total: 2, selected: 1, omitted: 1, firstSequence: BigInt(2), lastSequence: BigInt(2),
      contiguous: true, cues: Object.freeze([cue]),
    }),
  })), /incomplete or inconsistent native BWAU/u);
  assert.throws(() => project(projectedView({
    effects: Object.freeze({
      schema: 1, producer: "rust-bwau-v2", playerExternalId: ACTOR, authorityTick: BigInt(1),
      total: 2, selected: 2, omitted: 0, firstSequence: BigInt(1), lastSequence: BigInt(3),
      contiguous: true,
      cues: Object.freeze([
        Object.freeze({ ...cue, sequence: BigInt(1) }),
        Object.freeze({ ...cue, sequence: BigInt(3) }),
      ]),
    }),
  })), /malformed or discontinuous native BWAU/u);
});

test("native environmental diagnostics expose an immutable linked BWAU cue journal", () => {
  const { engine } = projectionHarness();
  const cue = Object.freeze({
    sequence: BigInt(7), tick: BigInt(5), entityExternalId: ACTOR,
    kind: "shore-exit" as const, amount: 0,
  });
  const view = projectedView({
    authorityTick: BigInt(5),
    extractionRevision: BigInt(5),
    effects: Object.freeze({
      schema: 1, producer: "rust-bwau-v2", playerExternalId: ACTOR, authorityTick: BigInt(5),
      total: 1, selected: 1, omitted: 0, firstSequence: BigInt(7), lastSequence: BigInt(7),
      contiguous: true, cues: Object.freeze([cue]),
    }),
  });
  (engine as unknown as { rustLivePlayerPresentationViewR10: RustLivePlayerViewR10 }).rustLivePlayerPresentationViewR10 = view;
  const diagnostics = (engine as unknown as {
    rustLiveEnvironmentalSurvivalDiagnosticsSnapshotR10(): {
      effects: { playerExternalId: string; firstSequence: string | null; lastSequence: string | null;
        contiguous: boolean; cues: readonly { sequence: string; tick: string; kind: string; amount: number }[] };
    } | null;
  }).rustLiveEnvironmentalSurvivalDiagnosticsSnapshotR10();
  assert.deepEqual(diagnostics?.effects, {
    schema: 1,
    producer: "rust-bwau-v2",
    playerExternalId: ACTOR,
    authorityTick: "5",
    total: 1,
    selected: 1,
    omitted: 0,
    firstSequence: "7",
    lastSequence: "7",
    contiguous: true,
    cues: [{ sequence: "7", tick: "5", entityExternalId: ACTOR, kind: "shore-exit", amount: 0 }],
  });
  assert.equal(Object.isFrozen(diagnostics?.effects), true);
  assert.equal(Object.isFrozen(diagnostics?.effects.cues), true);
});

test("native player custody suppresses legacy damage authoring before any compatibility state is read", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    health: 10,
    rustLiveSuppressedLegacyDamageCallsR5: 0,
    rustLiveTypeScriptDamageAuthoringCallsR5: 0,
    rustLivePlayerAuthorityEnabledR5: () => true,
  });
  assert.doesNotThrow(() => engine.damagePlayer(5, "legacy environmental source"));
  assert.equal((engine as unknown as { health: number }).health, 10);
  assert.equal((engine as unknown as { rustLiveSuppressedLegacyDamageCallsR5: number }).rustLiveSuppressedLegacyDamageCallsR5, 1);
  assert.equal((engine as unknown as { rustLiveTypeScriptDamageAuthoringCallsR5: number }).rustLiveTypeScriptDamageAuthoringCallsR5, 0);
});
