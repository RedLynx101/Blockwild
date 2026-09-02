import assert from "node:assert/strict";
import test from "node:test";

import { Item } from "../app/game/data.ts";
import { VoxelEngine } from "../app/game/engine.ts";
import type { RustLivePlayerViewR10 } from "../app/game/rust-live-player-view-r10.ts";

type ContinuityHarness = Readonly<{
  rustTerrainLocatorPlayerContinuityMatches(
    before: RustLivePlayerViewR10,
    after: RustLivePlayerViewR10,
  ): boolean;
}>;

const ACTOR = "player:same-tick-continuity";
const ENTITY_ID = BigInt(2);

function view(): RustLivePlayerViewR10 {
  return Object.freeze({
    extractionRevision: BigInt(4),
    authorityTick: BigInt(41),
    externalEntityId: ACTOR,
    actorId: ACTOR,
    playerId: BigInt(1),
    entityId: ENTITY_ID,
    entityRevision: BigInt(3),
    inventoryContainer: "container-key-v1/01020304",
    inventoryContainerRevision: BigInt(10),
    equipmentContainer: "container-key-v1/05060708",
    equipmentContainerRevision: BigInt(4),
    selectedSlot: 0,
    backSlot: null,
    lastInputSequence: BigInt(8),
    buttons: 0,
    authoritativeFlags: 0,
    lookYaw: null,
    lookPitch: 0,
    position: Object.freeze({ x: 12, y: 44, z: -8 }),
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    radius: 0.35,
    height: 1.8,
    mass: 1,
    grounded: true,
    crouching: false,
    contactFlags: 1,
    inLiquid: false,
    headSubmerged: false,
    drowningAccumulator: 0,
    fallDistance: 0,
    oxygenSeconds: 15,
    maximumOxygenSeconds: 15,
    health: 10,
    maximumHealth: 10,
    lastDamageTick: BigInt(0),
    combat: Object.freeze({
      domainRevision: BigInt(11),
      rowRevision: BigInt(12),
      recordId: ACTOR,
      ownerId: ACTOR,
      entityId: ENTITY_ID,
      vitalUnits: "millihearts-v1" as const,
      health: 10_000,
      maxHealth: 10_000,
      alive: true,
      crossDomainParity: true as const,
    }),
    effects: Object.freeze({
      schema: 1 as const,
      producer: "rust-bwau-v2" as const,
      playerExternalId: ACTOR,
      authorityTick: BigInt(41),
      total: 2,
      selected: 2,
      omitted: 0,
      firstSequence: BigInt(7),
      lastSequence: BigInt(8),
      contiguous: true,
      cues: Object.freeze([
        Object.freeze({
          sequence: BigInt(7), tick: BigInt(39), entityExternalId: ACTOR,
          kind: "liquid-enter" as const, amount: 0,
        }),
        Object.freeze({
          sequence: BigInt(8), tick: BigInt(40), entityExternalId: ACTOR,
          kind: "liquid-exit" as const, amount: 0,
        }),
      ]),
    }),
    held: null,
  });
}

function directCommitSuccessor(before: RustLivePlayerViewR10): RustLivePlayerViewR10 {
  return Object.freeze({
    ...before,
    extractionRevision: before.extractionRevision + BigInt(1),
    inventoryContainerRevision: before.inventoryContainerRevision + BigInt(1),
    position: Object.freeze({ ...before.position }),
    velocity: Object.freeze({ ...before.velocity }),
    combat: Object.freeze({ ...before.combat }),
    effects: Object.freeze({
      ...before.effects,
      cues: Object.freeze(before.effects.cues.map((cue) => Object.freeze({ ...cue }))),
    }),
    held: Object.freeze({
      itemCode: Item.WildwoodShelfItem,
      count: 64,
      durabilityMillionths: null,
      metadataHash: new Uint8Array(16),
    }),
  });
}

const matcher = Object.create(VoxelEngine.prototype) as ContinuityHarness;

function matches(before: RustLivePlayerViewR10, after: RustLivePlayerViewR10) {
  return matcher.rustTerrainLocatorPlayerContinuityMatches(before, after);
}

test("same-tick Creative and locator direct commits permit only extraction and inventory custody changes", () => {
  const before = view();
  const after = directCommitSuccessor(before);

  assert.equal(matches(before, after), true,
    "the shared direct-commit matcher must accept an exact same-tick view with only inventory custody advanced");
});

test("same-tick direct commits reject one-field environmental and R7 combat drift", async (context) => {
  const before = view();
  const baseline = directCommitSuccessor(before);
  const combat = (overrides: Record<string, unknown>) => Object.freeze({
    ...baseline,
    combat: Object.freeze({ ...baseline.combat, ...overrides }),
  }) as RustLivePlayerViewR10;
  const cases: readonly (readonly [string, RustLivePlayerViewR10])[] = [
    ["contact flags", Object.freeze({ ...baseline, contactFlags: baseline.contactFlags + 1 })],
    ["liquid contact", Object.freeze({ ...baseline, inLiquid: !baseline.inLiquid })],
    ["head submersion", Object.freeze({ ...baseline, headSubmerged: !baseline.headSubmerged })],
    ["drowning accumulator", Object.freeze({ ...baseline, drowningAccumulator: 0.25 })],
    ["fall distance", Object.freeze({ ...baseline, fallDistance: 3 })],
    ["oxygen", Object.freeze({ ...baseline, oxygenSeconds: 14 })],
    ["maximum oxygen", Object.freeze({ ...baseline, maximumOxygenSeconds: 16 })],
    ["health", Object.freeze({ ...baseline, health: 9 })],
    ["maximum health", Object.freeze({ ...baseline, maximumHealth: 11 })],
    ["last damage tick", Object.freeze({ ...baseline, lastDamageTick: BigInt(40) })],
    ["combat domain revision", combat({ domainRevision: baseline.combat.domainRevision + BigInt(1) })],
    ["combat row revision", combat({ rowRevision: baseline.combat.rowRevision + BigInt(1) })],
    ["combat record identity", combat({ recordId: "player:other" })],
    ["combat owner identity", combat({ ownerId: "player:other" })],
    ["combat entity identity", combat({ entityId: baseline.combat.entityId + BigInt(1) })],
    ["combat vital units", combat({ vitalUnits: "hearts" })],
    ["combat health", combat({ health: baseline.combat.health - 1 })],
    ["combat maximum health", combat({ maxHealth: baseline.combat.maxHealth + 1 })],
    ["combat alive", combat({ alive: false })],
    ["combat cross-domain parity", combat({ crossDomainParity: false })],
  ];

  for (const [label, after] of cases) {
    await context.test(label, () => {
      assert.equal(matches(before, after), false, `${label} must fail the shared same-tick commit gate`);
    });
  }
});

test("same-tick direct commits require an exact immutable BWAU effect journal", async (context) => {
  const before = view();
  const baseline = directCommitSuccessor(before);
  const effects = (overrides: Record<string, unknown>) => Object.freeze({
    ...baseline,
    effects: Object.freeze({ ...baseline.effects, ...overrides }),
  }) as RustLivePlayerViewR10;
  const cue = (index: number, overrides: Record<string, unknown>) => {
    const cues = baseline.effects.cues.map((value, cueIndex) => Object.freeze({
      ...value,
      ...(cueIndex === index ? overrides : {}),
    }));
    return effects({ cues: Object.freeze(cues) });
  };
  const appendedCue = Object.freeze({
    sequence: BigInt(9), tick: baseline.authorityTick, entityExternalId: ACTOR,
    kind: "shore-exit" as const, amount: 0,
  });
  const cases: readonly (readonly [string, RustLivePlayerViewR10])[] = [
    ["schema", effects({ schema: 2 })],
    ["producer", effects({ producer: "other" })],
    ["player identity", effects({ playerExternalId: "player:other" })],
    ["journal authority tick", effects({ authorityTick: baseline.effects.authorityTick + BigInt(1) })],
    ["total", effects({ total: baseline.effects.total + 1 })],
    ["selected", effects({ selected: baseline.effects.selected - 1 })],
    ["omitted", effects({ omitted: 1 })],
    ["first sequence", effects({ firstSequence: BigInt(6) })],
    ["last sequence", effects({ lastSequence: BigInt(9) })],
    ["contiguity", effects({ contiguous: false })],
    ["appended same-tick cue", effects({
      total: 3, selected: 3, lastSequence: BigInt(9),
      cues: Object.freeze([...baseline.effects.cues, appendedCue]),
    })],
    ["cue sequence", cue(0, { sequence: BigInt(6) })],
    ["cue tick", cue(0, { tick: BigInt(38) })],
    ["cue player identity", cue(0, { entityExternalId: "player:other" })],
    ["cue kind", cue(0, { kind: "land" })],
    ["cue amount", cue(0, { amount: 0.5 })],
    ["cue order", effects({ cues: Object.freeze([...baseline.effects.cues].reverse()) })],
  ];

  for (const [label, after] of cases) {
    await context.test(label, () => {
      assert.equal(matches(before, after), false, `${label} must fail the shared same-tick commit gate`);
    });
  }
});
