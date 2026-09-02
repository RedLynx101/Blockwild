import assert from "node:assert/strict";
import test from "node:test";

import { Item } from "../app/game/data.ts";
import type { RustIntegratedRuntimeIdentityV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  planRustLiveLocatorItemConsumeV1,
  type RustIntegratedPlayerLocatorItemConsumePurposeV1,
} from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import {
  RUST_TERRAIN_LOCATOR_APPLIED_EFFECT_IDS_MAX_V1,
  RUST_TERRAIN_LOCATOR_EFFECT_JOURNAL_MAX_JSON_BYTES_V1,
  RustTerrainLocatorEffectJournalErrorV1,
  appendRustTerrainLocatorAppliedEffectIdV1,
  createRustTerrainDragonLairEffectV1,
  createRustTerrainLocatorEffectJournalV1,
  createRustTerrainSettlementChartEffectV1,
  normalizeRustTerrainLocatorAppliedEffectIdsV1,
  rehydrateRustTerrainLocatorEffectJournalV1,
  rustTerrainLocatorEffectIdV1,
  rustTerrainLocatorEffectWasAppliedV1,
  serializeRustTerrainLocatorEffectJournalV1,
  type RustTerrainLocatorEffectJournalV1,
} from "../app/game/rust-terrain-locator-effect-journal.ts";
import {
  CanonicalGenerationHasher,
  type DragonLairLocatorResultV1,
  type SettlementLocatorResultV1,
} from "../app/game/terrain-generation-contract.ts";

const ACTOR = "player:locator-journal";
const ZERO_HASH = "0".repeat(32);
const REQUEST_HASH = "12".repeat(16);
const DISCOVERED_AT = 1_786_000_000_123;

function identity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "world:locator-journal",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1,
      world: 2,
      entities: 3,
      gameplay: 4,
      persistence: 5,
      network: 6,
      simulation: 7,
    }),
    tick: 41,
    stateHash: "34".repeat(16),
  });
}

const settlementEntries: SettlementLocatorResultV1["entries"] = Object.freeze([
  Object.freeze({
    id: "settlement:wood-elves:1:2:0",
    factionId: "wood-elves" as const,
    size: "village" as const,
    environment: "surface" as const,
    biome: "forest" as const,
    regionX: 1,
    regionZ: 2,
    x: 712,
    z: 1_224,
    floorY: 66,
    distanceSquaredMillis: BigInt("1000000"),
    publicArrival: Object.freeze({ x: 708, yMillis: 66_000, z: 1_220, anchorKind: "public-approach" }),
  }),
  Object.freeze({
    id: "settlement:dwarves:2:2:0",
    factionId: "dwarves" as const,
    size: "town" as const,
    environment: "underground" as const,
    biome: "highlands" as const,
    regionX: 2,
    regionZ: 2,
    x: 1_204,
    z: 1_216,
    floorY: -24,
    distanceSquaredMillis: BigInt("4000000"),
    publicArrival: Object.freeze({ x: 1_200, yMillis: 67_000, z: 1_212, anchorKind: "surface-entry" }),
  }),
]);

function settlementHash(entries: SettlementLocatorResultV1["entries"], requestHash = REQUEST_HASH) {
  const hasher = new CanonicalGenerationHasher("blockwild-settlement-query-result-v1");
  hasher.writeString(requestHash);
  hasher.writeU16(entries.length);
  for (const entry of entries) {
    hasher.writeString(entry.id);
    hasher.writeString(entry.factionId);
    hasher.writeString(entry.size);
    hasher.writeString(entry.environment);
    hasher.writeString(entry.biome);
    hasher.writeI32(entry.regionX);
    hasher.writeI32(entry.regionZ);
    hasher.writeI32(entry.x);
    hasher.writeI32(entry.z);
    hasher.writeU16(entry.floorY === null ? 0 : 1);
    if (entry.floorY !== null) hasher.writeI32(entry.floorY);
    hasher.writeU64(entry.distanceSquaredMillis);
    assert.ok(entry.publicArrival);
    hasher.writeI32(entry.publicArrival.x);
    hasher.writeI32(entry.publicArrival.yMillis);
    hasher.writeI32(entry.publicArrival.z);
    hasher.writeString(entry.publicArrival.anchorKind);
  }
  return hasher.finish();
}

function settlementResult(entries = settlementEntries): SettlementLocatorResultV1 {
  return Object.freeze({
    schemaVersion: 1,
    epoch: 7,
    taskId: 19,
    requestHash: REQUEST_HASH,
    entries,
    resultHash: settlementHash(entries),
  });
}

const lairEntry = Object.freeze({
  id: "dragon-lair:fire:3:4",
  dragonType: "fire" as const,
  stage: 4 as const,
  sex: "female" as const,
  x: 2_304,
  y: -31,
  z: 3_008,
  distanceSquaredMillis: BigInt("9000000"),
});

function lairHash(entry: NonNullable<DragonLairLocatorResultV1["entry"]>, requestHash = REQUEST_HASH) {
  const hasher = new CanonicalGenerationHasher("blockwild-lair-query-result-v1");
  hasher.writeString(requestHash);
  hasher.writeU16(1);
  hasher.writeString(entry.id);
  hasher.writeString(entry.dragonType);
  hasher.writeU16(entry.stage);
  hasher.writeString(entry.sex);
  hasher.writeI32(entry.x);
  hasher.writeI32(entry.y);
  hasher.writeI32(entry.z);
  hasher.writeU64(entry.distanceSquaredMillis);
  return hasher.finish();
}

function lairResult(entry: DragonLairLocatorResultV1["entry"] = lairEntry): DragonLairLocatorResultV1 {
  assert.ok(entry);
  return Object.freeze({
    schemaVersion: 1,
    epoch: 8,
    taskId: 20,
    requestHash: REQUEST_HASH,
    entry,
    resultHash: lairHash(entry),
  });
}

function consumePlan(
  purpose: RustIntegratedPlayerLocatorItemConsumePurposeV1,
  locatorResultHash: string,
  itemCode = purpose === "chart" ? Item.HearthroadsGazetteer : Item.FireLairSurvey,
  selectedSlot = 3,
) {
  return planRustLiveLocatorItemConsumeV1(identity(), ACTOR, Object.freeze({
    inventory: Object.freeze({ kind: "player" as const, id: ACTOR, ownerId: ACTOR }),
    selectedSlot,
    expectedInventoryRevision: BigInt(9),
    expectedStack: Object.freeze({
      itemCode,
      count: 2,
      durabilityMillionths: null,
      metadataHash: ZERO_HASH,
    }),
    purpose,
    locatorResultHash,
  }));
}

function world() {
  return Object.freeze({
    saveId: "save:locator-journal",
    terrainNamespace: "terrain-locator-v1|g18|journal-seed|{}",
    runtimeUniverseId: identity().universeId,
    runtimeLocationId: identity().locationId,
  });
}

function chartJournal(): RustTerrainLocatorEffectJournalV1 {
  const result = settlementResult();
  const plan = consumePlan("chart", result.resultHash);
  return createRustTerrainLocatorEffectJournalV1({
    world: world(),
    actorId: ACTOR,
    position: Object.freeze({ x: 8.25, y: 64, z: -12.5 }),
    selectedSlot: 3,
    compatibilityStack: Object.freeze({ item: Item.HearthroadsGazetteer, count: 2 }),
    plan,
    effect: createRustTerrainSettlementChartEffectV1(
      result,
      settlementEntries.map((entry) => entry.id),
      DISCOVERED_AT,
    ),
  });
}

type MutableJournalJsonV1 = {
  unexpected?: unknown;
  phase: string;
  actorId: string;
  selectedSlot: number;
  effectHash: string;
  world: { runtimeUniverseId: string };
  plan: { commandHash: string };
  position: { x: number };
  compatibilityStack: { count: number; metadata?: unknown };
  effect: {
    result: { entries: Array<{ x: number; distanceSquaredMillis: string }> };
    applyEntryIds: string[];
  };
};

function plain(journal = chartJournal()) {
  return JSON.parse(serializeRustTerrainLocatorEffectJournalV1(journal)) as MutableJournalJsonV1;
}

function expectCode(value: unknown, code: string) {
  assert.throws(
    () => rehydrateRustTerrainLocatorEffectJournalV1(value),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1 && error.code === code,
  );
}

test("prepared settlement chart journal round-trips deterministically without BigInt JSON", () => {
  const journal = chartJournal();
  const json = serializeRustTerrainLocatorEffectJournalV1(journal);
  const restored = rehydrateRustTerrainLocatorEffectJournalV1(json);

  assert.deepEqual(restored, journal);
  assert.equal(serializeRustTerrainLocatorEffectJournalV1(restored), json);
  assert.equal(restored.effect.kind, "chart");
  if (restored.effect.kind !== "chart") assert.fail("expected chart effect");
  assert.equal(restored.effect.result.entries[0].distanceSquaredMillis, "1000000");
  assert.deepEqual(restored.effect.applyEntryIds, settlementEntries.map((entry) => entry.id));
  assert.equal(typeof restored.effect.result.entries[0].distanceSquaredMillis, "string");
  assert.ok(Object.isFrozen(restored));
  assert.ok(Object.isFrozen(restored.world));
  assert.ok(Object.isFrozen(restored.effect));
  assert.ok(Object.isFrozen(restored.effect.result.entries));
  assert.ok(Object.isFrozen(restored.effect.result.entries[0].publicArrival));
  assert.doesNotThrow(() => JSON.parse(json));
  assert.equal(rustTerrainLocatorEffectIdV1(restored), restored.plan.commandHash);
});

test("prepared dragon-lair journal preserves the complete result and exact survey binding", () => {
  const result = lairResult();
  const plan = consumePlan("lair", result.resultHash);
  const journal = createRustTerrainLocatorEffectJournalV1({
    world: world(),
    actorId: ACTOR,
    position: { x: 1, y: 65, z: 2 },
    selectedSlot: 3,
    compatibilityStack: { item: Item.FireLairSurvey, count: 2 },
    plan,
    effect: createRustTerrainDragonLairEffectV1(result, DISCOVERED_AT),
  });
  const restored = rehydrateRustTerrainLocatorEffectJournalV1(
    serializeRustTerrainLocatorEffectJournalV1(journal),
  );

  assert.equal(restored.effect.kind, "lair");
  if (restored.effect.kind !== "lair") assert.fail("expected lair effect");
  assert.deepEqual(restored.effect.result.entry, {
    ...lairEntry,
    distanceSquaredMillis: lairEntry.distanceSquaredMillis.toString(10),
  });
  assert.equal(restored.effect.result.resultHash, plan.request.locatorResultHash);
});

test("rehydration rejects structural, plan, actor, world, slot, stack, and effect-hash corruption", () => {
  const cases: readonly [string, (value: MutableJournalJsonV1) => void][] = [
    ["locator-journal-shape", (value) => { value.unexpected = true; }],
    ["locator-journal-version", (value) => { value.phase = "applied"; }],
    ["locator-journal-plan", (value) => { value.plan.commandHash = "ab".repeat(16); }],
    ["locator-journal-actor", (value) => { value.actorId = "player:other"; }],
    ["locator-journal-world", (value) => { value.world.runtimeUniverseId = "world:other"; }],
    ["locator-journal-slot", (value) => { value.selectedSlot = 2; }],
    ["locator-journal-stack", (value) => { value.compatibilityStack.count = 3; }],
    ["locator-journal-effect-hash", (value) => { value.effectHash = "cd".repeat(16); }],
  ];

  for (const [code, mutate] of cases) {
    const value = plain();
    mutate(value);
    expectCode(value, code);
  }
});

test("result DTO corruption, duplicates, noncanonical decimals, and invalid chart subsets fail closed", () => {
  const coordinate = plain();
  coordinate.effect.result.entries[0].x += 1;
  expectCode(coordinate, "locator-journal-result-hash");

  const decimal = plain();
  decimal.effect.result.entries[0].distanceSquaredMillis = "01";
  expectCode(decimal, "locator-journal-u64");

  const duplicateApply = plain();
  duplicateApply.effect.applyEntryIds = [
    duplicateApply.effect.applyEntryIds[0],
    duplicateApply.effect.applyEntryIds[0],
  ];
  expectCode(duplicateApply, "locator-journal-duplicate");

  const foreignApply = plain();
  foreignApply.effect.applyEntryIds = ["settlement:foreign:9:9:0"];
  expectCode(foreignApply, "locator-journal-chart-effect");

  const reversedApply = plain();
  reversedApply.effect.applyEntryIds.reverse();
  expectCode(reversedApply, "locator-journal-chart-effect");

  const duplicatedEntries = Object.freeze([settlementEntries[0], settlementEntries[0]]);
  const duplicatedResult: SettlementLocatorResultV1 = Object.freeze({
    ...settlementResult(),
    entries: duplicatedEntries,
    resultHash: settlementHash(duplicatedEntries),
  });
  assert.throws(
    () => createRustTerrainSettlementChartEffectV1(
      duplicatedResult,
      [duplicatedEntries[0].id],
      DISCOVERED_AT,
    ),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1
      && error.code === "locator-journal-order",
  );
});

test("cross-purpose, cross-item, cross-slot, and mismatched locator hashes are rejected", () => {
  const chartResult = settlementResult();
  const chartEffect = createRustTerrainSettlementChartEffectV1(
    chartResult,
    [chartResult.entries[0].id],
    DISCOVERED_AT,
  );
  const lair = lairResult();
  const lairEffect = createRustTerrainDragonLairEffectV1(lair, DISCOVERED_AT);

  const base = {
    world: world(),
    actorId: ACTOR,
    position: { x: 0, y: 64, z: 0 },
    selectedSlot: 3,
  } as const;
  assert.throws(
    () => createRustTerrainLocatorEffectJournalV1({
      ...base,
      compatibilityStack: { item: Item.HearthroadsGazetteer, count: 2 },
      plan: consumePlan("chart", chartResult.resultHash),
      effect: lairEffect,
    }),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1
      && error.code === "locator-journal-purpose",
  );
  assert.throws(
    () => createRustTerrainLocatorEffectJournalV1({
      ...base,
      compatibilityStack: { item: Item.FireLairSurvey, count: 2 },
      plan: consumePlan("chart", chartResult.resultHash, Item.FireLairSurvey),
      effect: chartEffect,
    }),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1
      && error.code === "locator-journal-item-purpose",
  );
  assert.throws(
    () => createRustTerrainLocatorEffectJournalV1({
      ...base,
      compatibilityStack: { item: Item.HearthroadsGazetteer, count: 2 },
      plan: consumePlan("chart", chartResult.resultHash, Item.HearthroadsGazetteer, 4),
      effect: chartEffect,
    }),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1
      && error.code === "locator-journal-slot",
  );
  assert.throws(
    () => createRustTerrainLocatorEffectJournalV1({
      ...base,
      compatibilityStack: { item: Item.HearthroadsGazetteer, count: 2 },
      plan: consumePlan("chart", lair.resultHash),
      effect: chartEffect,
    }),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1
      && error.code === "locator-journal-purpose",
  );
});

test("journal byte, collection, numeric, and compatibility-stack bounds are enforced", () => {
  expectCode(" ".repeat(RUST_TERRAIN_LOCATOR_EFFECT_JOURNAL_MAX_JSON_BYTES_V1 + 1), "locator-journal-size");

  const baseline = chartJournal();
  assert.throws(
    () => createRustTerrainLocatorEffectJournalV1({
      actorId: baseline.actorId,
      position: baseline.position,
      selectedSlot: baseline.selectedSlot,
      compatibilityStack: baseline.compatibilityStack,
      plan: baseline.plan,
      effect: baseline.effect,
      world: { ...world(), terrainNamespace: `terrain-locator-v1|${"x".repeat(16 * 1_024)}` },
    }),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1
      && error.code === "locator-journal-text",
  );

  const nonFinite = plain();
  nonFinite.position.x = Number.POSITIVE_INFINITY;
  expectCode(nonFinite, "locator-journal-position");

  const metadata = plain();
  metadata.compatibilityStack.metadata = { forged: true };
  expectCode(metadata, "locator-journal-shape");

  const fiveEntries = Object.freeze(Array.from({ length: 5 }, (_, index) => Object.freeze({
    ...settlementEntries[0],
    id: `settlement:wood-elves:${index + 10}:2:0`,
    x: 10_000 + index,
    distanceSquaredMillis: BigInt(10_000 + index),
  })));
  const oversizedResult: SettlementLocatorResultV1 = Object.freeze({
    ...settlementResult(),
    entries: fiveEntries,
    resultHash: settlementHash(fiveEntries),
  });
  assert.throws(
    () => createRustTerrainSettlementChartEffectV1(
      oversizedResult,
      [fiveEntries[0].id],
      DISCOVERED_AT,
    ),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1
      && error.code === "locator-journal-settlement-result",
  );

  const noLair: DragonLairLocatorResultV1 = Object.freeze({
    ...lairResult(),
    entry: null,
    resultHash: "56".repeat(16),
  });
  assert.throws(
    () => createRustTerrainDragonLairEffectV1(noLair, DISCOVERED_AT),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1
      && error.code === "locator-journal-lair-result",
  );
});

test("bounded applied-effect ledger is unique, idempotent, and evicts only the oldest IDs", () => {
  let ledger: readonly string[] = normalizeRustTerrainLocatorAppliedEffectIdsV1([]);
  const ids = Array.from(
    { length: RUST_TERRAIN_LOCATOR_APPLIED_EFFECT_IDS_MAX_V1 + 3 },
    (_, index) => (index + 1).toString(16).padStart(32, "0"),
  );
  for (const id of ids) ledger = appendRustTerrainLocatorAppliedEffectIdV1(ledger, id);

  assert.equal(ledger.length, RUST_TERRAIN_LOCATOR_APPLIED_EFFECT_IDS_MAX_V1);
  assert.deepEqual(ledger, ids.slice(-RUST_TERRAIN_LOCATOR_APPLIED_EFFECT_IDS_MAX_V1));
  assert.equal(rustTerrainLocatorEffectWasAppliedV1(ledger, ids.at(-1)!), true);
  assert.equal(rustTerrainLocatorEffectWasAppliedV1(ledger, ids[0]), false);
  assert.deepEqual(appendRustTerrainLocatorAppliedEffectIdV1(ledger, ids.at(-1)!), ledger);
  assert.throws(
    () => normalizeRustTerrainLocatorAppliedEffectIdsV1([ids[0], ids[0]]),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1
      && error.code === "locator-journal-duplicate",
  );
  assert.throws(
    () => normalizeRustTerrainLocatorAppliedEffectIdsV1(["not-a-hash"]),
    (error: unknown) => error instanceof RustTerrainLocatorEffectJournalErrorV1
      && error.code === "locator-journal-hash",
  );
});
