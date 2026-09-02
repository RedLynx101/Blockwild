import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import { Item, VoxelEngine, type ItemCode } from "../app/game/engine.ts";
import { createMapKnowledge } from "../app/game/map-system.ts";
import {
  acceptQuest,
  createQuestBook,
  type QuestDefinition,
} from "../app/game/quests.ts";
import type { RustIntegratedRuntimeIdentityV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  planRustLiveLocatorItemConsumeV1,
  rustIntegratedContainerViewKeyV1,
  type RustLiveLocatorItemConsumePlanV1,
} from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import type { RustLiveInputPumpLocatorItemConsumeResultV1 } from "../app/game/rust-live-input-pump-r5.ts";
import type { RustLivePlayerViewR10 } from "../app/game/rust-live-player-view-r10.ts";
import { rustTerrainLocatorEffectIdV1, type RustTerrainLocatorEffectJournalV1 } from "../app/game/rust-terrain-locator-effect-journal.ts";
import { createSkillState } from "../app/game/skills.ts";
import {
  CanonicalGenerationHasher,
  type DragonLairLocatorResultV1,
  type SettlementLocatorResultV1,
} from "../app/game/terrain-generation-contract.ts";

type Deferred<T> = Readonly<{ promise: Promise<T>; resolve: (value: T) => void }>;
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function locatorEngine(item: ItemCode = Item.HearthroadsGazetteer) {
  const toasts: string[] = [];
  let saves = 0;
  let huds = 0;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    rustRuntimeTransitionGeneration: 3,
    terrainLocatorConsumerAbort: new AbortController(),
    pendingSettlementChart: null,
    pendingDragonLairSurvey: null,
    pendingFactionGuide: null,
    rustRuntimeOperationsBlocked: true,
    rustLivePlayerAuthorityRequestedR5: false,
    rustLivePlayerAuthorityState: "none",
    rustLivePlayerAuthorityGeneration: null,
    rustLiveInputPump: null,
    rustRuntimeHost: null,
    position: new THREE.Vector3(12, 44, -8),
    selected: 0,
    inventory: [{ item, count: 2 }, null, null, null, null, null, null, null, null],
    mode: "survival",
    mapKnowledge: createMapKnowledge("world:consumer", "local"),
    skillState: createSkillState(),
    questBook: createQuestBook(),
    sideQuestDefinitions: [LAIR_QUEST],
    activeCharacterProfile: null,
    multiplayer: null,
    placeCooldown: 0,
    heldUse: 0,
    events: { onToast: (message: string) => { toasts.push(message); } },
    audio: { play() {}, unlock: async () => undefined },
    saveSoon: () => { saves += 1; },
    emitHud: () => { huds += 1; },
    gainSkillExperience: () => undefined,
    dispatchQuestEvent: () => undefined,
    allQuestDefinitions: () => [LAIR_QUEST],
  });
  return { engine, toasts, saves: () => saves, huds: () => huds };
}

const SETTLEMENT_ENTRY = Object.freeze({
  id: "freehold-consumer", factionId: "hobbits" as const, size: "village" as const,
  environment: "surface" as const, biome: "flower-meadow" as const,
  regionX: 1, regionZ: 2, x: 640, z: 1_120, floorY: null,
  distanceSquaredMillis: BigInt(1_000_000),
  publicArrival: Object.freeze({ x: 644, yMillis: 44_510, z: 1_122, anchorKind: "public-approach" }),
});

const ACTOR = "local";
const REQUEST_HASH = "12".repeat(16);
const ZERO_HASH = "0".repeat(32);
const WORLD_ID = "world:consumer";
const RUNTIME_LOCATION = "surface";
const INVENTORY_CONTAINER = Object.freeze({ kind: "player" as const, id: ACTOR, ownerId: ACTOR });

const LAIR_ENTRY = Object.freeze({
  id: "dragon-lair:fire:1",
  dragonType: "fire" as const,
  stage: 4 as const,
  sex: "female" as const,
  x: 500,
  y: 24,
  z: 600,
  distanceSquaredMillis: BigInt(4_000_000),
});

function settlementHash(entries: SettlementLocatorResultV1["entries"]) {
  const hasher = new CanonicalGenerationHasher("blockwild-settlement-query-result-v1");
  hasher.writeString(REQUEST_HASH);
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

function settlementResult(): SettlementLocatorResultV1 {
  const entries = Object.freeze([SETTLEMENT_ENTRY]);
  return Object.freeze({
    schemaVersion: 1,
    epoch: 7,
    taskId: 19,
    requestHash: REQUEST_HASH,
    entries,
    resultHash: settlementHash(entries),
  });
}

function lairHash(entry: NonNullable<DragonLairLocatorResultV1["entry"]>) {
  const hasher = new CanonicalGenerationHasher("blockwild-lair-query-result-v1");
  hasher.writeString(REQUEST_HASH);
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

function lairResult(): DragonLairLocatorResultV1 {
  return Object.freeze({
    schemaVersion: 1,
    epoch: 8,
    taskId: 20,
    requestHash: REQUEST_HASH,
    entry: LAIR_ENTRY,
    resultHash: lairHash(LAIR_ENTRY),
  });
}

const LAIR_QUEST: QuestDefinition = Object.freeze({
  id: "consumer-lair-record",
  questlineId: "consumer-locator",
  kind: "side",
  name: "Record a Fire Lair",
  summary: "Harness quest for the authoritative locator transaction.",
  objectives: Object.freeze([Object.freeze({
    id: "record-fire-lair",
    label: "Record a Fire Dragon lair",
    kind: "custom" as const,
    eventId: "fire-dragon-lair-recorded",
    count: 1,
  })]),
  rewards: Object.freeze({ gold: 0, items: Object.freeze([]), blueprints: Object.freeze([]), factionAlignment: Object.freeze({}) }),
});

type LiveLocatorKind = "chart" | "lair";
type LiveLocatorFailure = "prepared-local-save" | "command" | "post-native-checkpoint" | "final-local-save"
  | "local-storage-cleanup" | null;

type LiveLocatorHarness = Readonly<{
  engine: VoxelEngine & Record<string, unknown>;
  events: string[];
  toasts: string[];
  audio: string[];
  huds: () => number;
  durableSave: () => Record<string, unknown> | null;
  preparedJournal: () => RustTerrainLocatorEffectJournalV1 | null;
  consumeResult: () => RustLiveInputPumpLocatorItemConsumeResultV1 | null;
}>;

function runtimeIdentity(): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: WORLD_ID,
    locationId: RUNTIME_LOCATION,
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

function livePlayerView(item: ItemCode, count: number, inventoryRevision: bigint, extractionRevision: bigint): RustLivePlayerViewR10 {
  return Object.freeze({
    extractionRevision,
    authorityTick: BigInt(41),
    externalEntityId: "player:consumer",
    actorId: ACTOR,
    playerId: BigInt(1),
    entityId: BigInt(2),
    entityRevision: BigInt(3),
    inventoryContainer: rustIntegratedContainerViewKeyV1(INVENTORY_CONTAINER),
    inventoryContainerRevision: inventoryRevision,
    equipmentContainer: "container-key-v1/01020304",
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
    contactFlags: 0,
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
      domainRevision: BigInt(1), rowRevision: BigInt(1), recordId: "player:consumer", ownerId: ACTOR, entityId: BigInt(2),
      vitalUnits: "millihearts-v1" as const, health: 10_000, maxHealth: 10_000, alive: true, crossDomainParity: true as const,
    }),
    effects: Object.freeze({
      schema: 1 as const, producer: "rust-bwau-v2" as const, playerExternalId: "player:consumer", authorityTick: BigInt(41),
      total: 0, selected: 0, omitted: 0, firstSequence: null, lastSequence: null, contiguous: true, cues: Object.freeze([]),
    }),
    held: Object.freeze({
      itemCode: item,
      count,
      durabilityMillionths: null,
      metadataHash: Uint8Array.from({ length: 16 }, () => 0),
    }),
  });
}

function installWindowStorageStub(removeItem: () => void = () => undefined) {
  const localStorage = Object.freeze({
    removeItem,
    setItem() {},
    getItem() { return null; },
  });
  const browserWindow = {
    localStorage,
    clearTimeout: (handle: number | undefined) => globalThis.clearTimeout(handle),
  };
  if (!("window" in globalThis)) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: browserWindow,
      writable: true,
    });
    return;
  }
  Object.assign(globalThis.window, browserWindow);
}

function liveLocatorHarness(kind: LiveLocatorKind, fail: LiveLocatorFailure = null): LiveLocatorHarness {
  const item = kind === "chart" ? Item.HearthroadsGazetteer : Item.FireLairSurvey;
  const queryResult = kind === "chart" ? settlementResult() : lairResult();
  const events: string[] = [];
  installWindowStorageStub(fail === "local-storage-cleanup"
    ? () => { events.push("compatibility-cleanup:throw"); throw new Error("compatibility cleanup failed"); }
    : undefined);
  const toasts: string[] = [];
  const audio: string[] = [];
  let huds = 0;
  let nativeSaveCount = 0;
  let durableSave: Record<string, unknown> | null = null;
  let preparedJournal: RustTerrainLocatorEffectJournalV1 | null = null;
  let consumeResult: RustLiveInputPumpLocatorItemConsumeResultV1 | null = null;
  let pumpTail: Promise<unknown> = Promise.resolve();

  const accepted = acceptQuest(createQuestBook(), [LAIR_QUEST], LAIR_QUEST.id, 1);
  assert.equal(accepted.ok, true);
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;

  const assertEffectNotProjected = () => {
    assert.equal(engine.inventory[0]?.count, 2, "compatibility inventory changed before durable native receipt");
    assert.equal(engine.mapKnowledge.markers.length, 0, "map changed before durable native receipt");
    assert.equal((engine as unknown as { skillState: ReturnType<typeof createSkillState> }).skillState.skills.exploration.xp, 0,
      "exploration XP changed before durable native receipt");
    assert.equal((engine as unknown as { questBook: ReturnType<typeof createQuestBook> }).questBook.active[0]?.objectiveProgress["record-fire-lair"], 0,
      "quest progress changed before durable native receipt");
    assert.deepEqual((engine as unknown as { rustTerrainLocatorAppliedEffectIds: readonly string[] }).rustTerrainLocatorAppliedEffectIds, [],
      "effect ledger changed before durable native receipt");
  };

  const serialize = () => ({
    inventory: engine.inventory.map((slot) => slot ? { ...slot } : null),
    mapKnowledge: engine.mapKnowledge,
    skillState: (engine as unknown as { skillState: unknown }).skillState,
    questBook: (engine as unknown as { questBook: unknown }).questBook,
    rustTerrainLocatorEffectJournal:
      (engine as unknown as { rustTerrainLocatorEffectJournal: RustTerrainLocatorEffectJournalV1 | null }).rustTerrainLocatorEffectJournal,
    rustTerrainLocatorAppliedEffectIds:
      [...(engine as unknown as { rustTerrainLocatorAppliedEffectIds: readonly string[] }).rustTerrainLocatorAppliedEffectIds],
  });

  const worldStorage = {
    saveNativeWorld: async () => {
      nativeSaveCount += 1;
      const phase = nativeSaveCount === 1 ? "pre" : nativeSaveCount === 2 ? "post" : "background";
      events.push(`native-checkpoint:${phase}`);
      if (nativeSaveCount <= 2) assertEffectNotProjected();
      if (fail === "post-native-checkpoint" && phase === "post") {
        return { ok: false as const, error: { message: "post-debit native checkpoint failed" } };
      }
      return { ok: true as const, value: { id: WORLD_ID } };
    },
    saveWorldLocalOnly: (_worldId: string, document: Readonly<{ save: Record<string, unknown> }>) => {
      const journal = document.save.rustTerrainLocatorEffectJournal as RustTerrainLocatorEffectJournalV1 | null;
      const phase = journal ? "prepared" : "final";
      events.push(`local-save:${phase}`);
      if (phase === "prepared") {
        assertEffectNotProjected();
        preparedJournal = journal;
        if (fail === "prepared-local-save") {
          return { ok: false as const, error: { message: "prepared browser journal failed" } };
        }
      } else if (fail === "final-local-save") {
        return { ok: false as const, error: { message: "final browser effect failed" } };
      }
      durableSave = document.save;
      return { ok: true as const, value: { id: WORLD_ID } };
    },
    loadWorld: () => durableSave
      ? { ok: true as const, value: { save: durableSave } }
      : { ok: false as const, error: { message: "no durable save" } },
  };

  const beforePlayer = livePlayerView(item, 2, BigInt(9), BigInt(1));
  const afterPlayer = livePlayerView(item, 1, BigInt(10), BigInt(2));
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const current = pumpTail.then(operation, operation);
    pumpTail = current.catch(() => undefined);
    return current;
  };
  const pump = {
    state: "ready",
    drain: async () => { await pumpTail; },
    adoptExternalNetworkSuccessor: async () => false,
    checkpointNativePersistence: <T>(_generation: number, checkpoint: () => Promise<T>) => enqueue(async () => ({
      discarded: false,
      value: await checkpoint(),
      before: runtimeIdentity(),
      after: runtimeIdentity(),
    })),
    consumeLocatorItem: (
      _generation: number,
      intent: Parameters<typeof planRustLiveLocatorItemConsumeV1>[2],
      options: Readonly<{ beforeDispatch?: (plan: RustLiveLocatorItemConsumePlanV1) => Promise<void> }>,
    ) => enqueue(async () => {
      const plan = planRustLiveLocatorItemConsumeV1(runtimeIdentity(), ACTOR, intent);
      await options.beforeDispatch?.(plan);
      events.push("native-consume:receipt-readback");
      assertEffectNotProjected();
      if (fail === "command") throw new Error("native locator command failed");
      consumeResult = Object.freeze({
        discarded: false,
        plan,
        receipt: Object.freeze({}) as RustLiveInputPumpLocatorItemConsumeResultV1["receipt"],
        validated: Object.freeze({
          locator: Object.freeze({
            previousInventoryRevision: BigInt(9),
            resultingInventoryRevision: BigInt(10),
          }),
          remainingStack: Object.freeze({
            itemCode: item,
            count: 1,
            durabilityMillionths: null,
            metadataHash: ZERO_HASH,
          }),
        }) as RustLiveInputPumpLocatorItemConsumeResultV1["validated"],
        extraction: Object.freeze({}) as RustLiveInputPumpLocatorItemConsumeResultV1["extraction"],
        player: afterPlayer,
      });
      return consumeResult;
    }),
  };

  Object.assign(engine, {
    rustRuntimeTransitionGeneration: 3,
    terrainLocatorConsumerAbort: new AbortController(),
    pendingSettlementChart: null,
    pendingDragonLairSurvey: null,
    pendingFactionGuide: null,
    rustRuntimeOperationsBlocked: false,
    rustLivePlayerAuthorityState: "ready",
    rustLivePlayerAuthorityGeneration: 3,
    rustLiveInputPump: pump,
    rustRuntimeHost: {
      config: { universeId: WORLD_ID, locationId: RUNTIME_LOCATION },
      diagnostics: () => ({ state: "ready" }),
      multiplayerAuthority: () => ({
        runExclusiveMutation: async <T>(operation: () => Promise<T>): Promise<T> => {
          events.push("runtime-barrier:enter");
          try {
            return await operation();
          } finally {
            events.push("runtime-barrier:exit");
          }
        },
      }),
    },
    rustLivePlayerAttestationR10: {
      externalEntityId: beforePlayer.externalEntityId,
      actorId: ACTOR,
      playerId: beforePlayer.playerId,
      entityId: beforePlayer.entityId,
      inventoryContainer: INVENTORY_CONTAINER,
    },
    rustLivePlayerPresentationViewR10: beforePlayer,
    rustLivePlayerViewExtractionRevisionR10: beforePlayer.extractionRevision,
    rustLiveInputAdvance: null,
    rustLiveViewRefresh: null,
    rustTerrainLocatorCommitLocked: false,
    rustTerrainLocatorEffectJournal: null,
    rustTerrainLocatorAppliedEffectIds: Object.freeze([]),
    rustNativePersistenceWorldId: WORLD_ID,
    rustAuthorityOperations: new Set<Promise<unknown>>(),
    persistent: true,
    activeWorldId: WORLD_ID,
    worldSessionStartedAt: Date.now(),
    saveTimer: 0,
    autoSaveIdleHandle: 0,
    autoSaveUsesIdleCallback: false,
    fallingTrees: [],
    rustNativeSaveOperation: null,
    rustNativeSaveQueued: false,
    worldStorage,
    position: new THREE.Vector3(12, 44, -8),
    selected: 0,
    inventory: [{ item, count: 2 }, null, null, null, null, null, null, null, null],
    mode: "survival",
    mapKnowledge: createMapKnowledge(WORLD_ID, ACTOR),
    skillState: createSkillState(),
    questBook: accepted.book,
    sideQuestDefinitions: [LAIR_QUEST],
    activeCharacterProfile: null,
    multiplayer: null,
    placeCooldown: 0,
    heldUse: 0,
    events: {
      onToast: (message: string) => { events.push("announce:toast"); toasts.push(message); },
    },
    audio: {
      play: (name: string) => { events.push("announce:audio"); audio.push(name); },
      unlock: async () => undefined,
    },
    emitHud: () => { events.push("announce:hud"); huds += 1; },
    saveSoon: () => { throw new Error("live locator commit must not schedule the legacy save path"); },
    serialize,
    localPlayerId: () => ACTOR,
    allQuestDefinitions: () => [LAIR_QUEST],
    assertRustLivePlayerViewContextR10: () => undefined,
    projectRustLivePlayerViewR10: () => undefined,
    rustLivePlayerAuthorityEnabledR5: () => true,
    rustLivePlayerAuthorityRequestedR5: true,
    quarantineRustLivePlayerAuthorityR5: () => { events.push("quarantine"); },
    world: {
      terrainGenerationAuthority: { mode: "rust" },
      terrainLocatorAuthorityIdentity: () => ({ namespace: "locator:consumer", lifecycleRevision: 7 }),
      queryNearestSettlementsAuthoritative: async () => {
        events.push("query:chart");
        assertEffectNotProjected();
        return queryResult as SettlementLocatorResultV1;
      },
      queryNearestDragonLairAuthoritative: async () => {
        events.push("query:lair");
        assertEffectNotProjected();
        return queryResult as DragonLairLocatorResultV1;
      },
    },
  });

  return Object.freeze({
    engine,
    events,
    toasts,
    audio,
    huds: () => huds,
    durableSave: () => durableSave,
    preparedJournal: () => preparedJournal,
    consumeResult: () => consumeResult,
  });
}

async function waitForLiveLocator(engine: LiveLocatorHarness["engine"], kind: LiveLocatorKind) {
  assert.equal(engine.useSelected(), true);
  const pending = kind === "chart"
    ? (engine as unknown as { pendingSettlementChart: Promise<void> | null }).pendingSettlementChart
    : (engine as unknown as { pendingDragonLairSurvey: Promise<void> | null }).pendingDragonLairSurvey;
  assert.ok(pending);
  await pending;
}

test("authoritative preview aborts without advancing the runtime generation", async () => {
  const { engine } = locatorEngine();
  const controller = new AbortController();
  const baseline = (engine as unknown as { rustRuntimeTransitionGeneration: number }).rustRuntimeTransitionGeneration;
  Object.assign(engine, {
    world: {
      terrainGenerationAuthority: { mode: "rust" },
      queryNearestSettlementsForGenerationAuthoritative(
        _seed: string,
        _options: unknown,
        _query: unknown,
        signal: AbortSignal,
      ) {
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
          const error = new Error("aborted"); error.name = "AbortError"; reject(error);
        }, { once: true }));
      },
    },
  });
  const pending = engine.previewWorldOriginAuthoritative("PREVIEW", { origin: { mode: "near-any-settlement" } }, 18, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal((engine as unknown as { rustRuntimeTransitionGeneration: number }).rustRuntimeTransitionGeneration, baseline);
});

for (const kind of ["chart", "lair"] as const) {
  test(`live Rust ${kind} transaction commits only after its receipt and post-debit checkpoint`, async () => {
    const harness = liveLocatorHarness(kind);
    await waitForLiveLocator(harness.engine, kind);

    assert.deepEqual(harness.events.slice(0, 8), [
      `query:${kind}`,
      "runtime-barrier:enter",
      "native-checkpoint:pre",
      "local-save:prepared",
      "native-consume:receipt-readback",
      "native-checkpoint:post",
      "local-save:final",
      "runtime-barrier:exit",
    ]);
    assert.ok(harness.events.indexOf("runtime-barrier:enter") < harness.events.indexOf("native-checkpoint:pre"));
    assert.ok(harness.events.indexOf("local-save:final") < harness.events.indexOf("runtime-barrier:exit"));
    assert.ok(harness.events.indexOf("runtime-barrier:exit") < harness.events.indexOf("announce:audio"));
    assert.ok(harness.events.indexOf("local-save:final") < harness.events.indexOf("announce:audio"));
    assert.ok(harness.events.indexOf("local-save:final") < harness.events.indexOf("announce:toast"));
    assert.ok(harness.events.indexOf("local-save:final") < harness.events.indexOf("announce:hud"));
    assert.equal(harness.engine.inventory[0]?.count, 1);
    assert.equal(harness.audio.length, 1);
    assert.equal(harness.audio[0], "craft");
    assert.equal(harness.huds(), 1);
    assert.equal(harness.toasts.length, 1);

    const journal = harness.preparedJournal();
    assert.ok(journal);
    const ledger = (harness.engine as unknown as { rustTerrainLocatorAppliedEffectIds: readonly string[] })
      .rustTerrainLocatorAppliedEffectIds;
    assert.deepEqual(ledger, [rustTerrainLocatorEffectIdV1(journal)]);
    assert.equal((harness.engine as unknown as { rustTerrainLocatorEffectJournal: unknown }).rustTerrainLocatorEffectJournal, null);
    assert.equal((harness.durableSave()?.rustTerrainLocatorEffectJournal ?? null), null);
    assert.deepEqual(harness.durableSave()?.rustTerrainLocatorAppliedEffectIds, ledger);
    assert.equal((harness.engine as unknown as { skillState: ReturnType<typeof createSkillState> })
      .skillState.skills.exploration.xp, kind === "chart" ? 15 : 40);

    if (kind === "chart") {
      assert.equal(harness.engine.mapKnowledge.markers.filter((marker) => marker.id === `settlement:${SETTLEMENT_ENTRY.id}`).length, 1);
      assert.equal((harness.engine as unknown as { questBook: ReturnType<typeof createQuestBook> })
        .questBook.active[0]?.objectiveProgress["record-fire-lair"], 0);
    } else {
      assert.equal(harness.engine.mapKnowledge.markers.filter((marker) => marker.id === LAIR_ENTRY.id).length, 1);
      assert.equal((harness.engine as unknown as { questBook: ReturnType<typeof createQuestBook> })
        .questBook.active[0]?.objectiveProgress["record-fire-lair"], 1);
    }

    const beforeReplay = Object.freeze({
      markers: harness.engine.mapKnowledge.markers,
      skills: (harness.engine as unknown as { skillState: unknown }).skillState,
      quests: (harness.engine as unknown as { questBook: unknown }).questBook,
      ledger,
      toasts: harness.toasts.length,
      audio: harness.audio.length,
      huds: harness.huds(),
    });
    const result = harness.consumeResult();
    assert.ok(result);
    const replay = (harness.engine as unknown as {
      commitRustTerrainLocatorEffect(
        prepared: RustTerrainLocatorEffectJournalV1,
        receipt: RustLiveInputPumpLocatorItemConsumeResultV1,
      ): Readonly<{ applied: boolean }>;
      announceRustTerrainLocatorEffect(value: Readonly<{ applied: boolean }>): void;
    }).commitRustTerrainLocatorEffect(journal, result);
    (harness.engine as unknown as {
      announceRustTerrainLocatorEffect(value: Readonly<{ applied: boolean }>): void;
    }).announceRustTerrainLocatorEffect(replay);

    assert.equal(replay.applied, false);
    assert.strictEqual(harness.engine.mapKnowledge.markers, beforeReplay.markers);
    assert.strictEqual((harness.engine as unknown as { skillState: unknown }).skillState, beforeReplay.skills);
    assert.strictEqual((harness.engine as unknown as { questBook: unknown }).questBook, beforeReplay.quests);
    assert.strictEqual((harness.engine as unknown as { rustTerrainLocatorAppliedEffectIds: readonly string[] })
      .rustTerrainLocatorAppliedEffectIds, beforeReplay.ledger);
    assert.equal(harness.toasts.length, beforeReplay.toasts);
    assert.equal(harness.audio.length, beforeReplay.audio);
    assert.equal(harness.huds(), beforeReplay.huds);
  });
}

test("compatibility-key cleanup failure cannot roll back or duplicate a durable locator commit", async () => {
  const harness = liveLocatorHarness("chart", "local-storage-cleanup");
  await waitForLiveLocator(harness.engine, "chart");

  assert.equal(harness.events.filter((entry) => entry === "compatibility-cleanup:throw").length, 2);
  assert.equal(harness.events.includes("quarantine"), false);
  assert.equal(harness.engine.inventory[0]?.count, 1);
  assert.equal(harness.engine.mapKnowledge.markers.filter(
    (marker) => marker.id === `settlement:${SETTLEMENT_ENTRY.id}`,
  ).length, 1);
  assert.equal((harness.engine as unknown as { skillState: ReturnType<typeof createSkillState> })
    .skillState.skills.exploration.xp, 15);
  assert.equal((harness.engine as unknown as { rustTerrainLocatorEffectJournal: unknown })
    .rustTerrainLocatorEffectJournal, null);
  const journal = harness.preparedJournal();
  assert.ok(journal);
  assert.deepEqual((harness.engine as unknown as { rustTerrainLocatorAppliedEffectIds: readonly string[] })
    .rustTerrainLocatorAppliedEffectIds, [rustTerrainLocatorEffectIdV1(journal)]);
  assert.equal(harness.toasts.length, 1);
  assert.equal(harness.audio.length, 1);
  assert.equal(harness.huds(), 1);
  assert.equal(harness.durableSave()?.rustTerrainLocatorEffectJournal, null);

  harness.engine.saveNow(false);
  const scheduled = (harness.engine as unknown as { rustNativeSaveOperation: Promise<void> | null })
    .rustNativeSaveOperation;
  assert.ok(scheduled, "cleanup failure must not suppress the native checkpoint scheduled by saveNow");
  await scheduled;
  assert.equal(harness.events.filter((entry) => entry === "compatibility-cleanup:throw").length, 3);
  assert.equal(harness.events.filter((entry) => entry === "native-checkpoint:background").length, 1);
  assert.equal(harness.engine.inventory[0]?.count, 1);
  assert.equal(harness.engine.mapKnowledge.markers.filter(
    (marker) => marker.id === `settlement:${SETTLEMENT_ENTRY.id}`,
  ).length, 1);
  assert.equal((harness.engine as unknown as { skillState: ReturnType<typeof createSkillState> })
    .skillState.skills.exploration.xp, 15);
});

for (const failure of [
  "prepared-local-save",
  "command",
  "post-native-checkpoint",
  "final-local-save",
] as const) {
  test(`live Rust chart fails closed when ${failure} fails`, async () => {
    const harness = liveLocatorHarness("chart", failure);
    await waitForLiveLocator(harness.engine, "chart");

    assert.equal(harness.engine.inventory[0]?.count, 2);
    assert.equal(harness.engine.mapKnowledge.markers.length, 0);
    assert.equal((harness.engine as unknown as { skillState: ReturnType<typeof createSkillState> })
      .skillState.skills.exploration.xp, 0);
    assert.equal((harness.engine as unknown as { questBook: ReturnType<typeof createQuestBook> })
      .questBook.active[0]?.objectiveProgress["record-fire-lair"], 0);
    assert.deepEqual((harness.engine as unknown as { rustTerrainLocatorAppliedEffectIds: readonly string[] })
      .rustTerrainLocatorAppliedEffectIds, []);
    assert.equal(harness.events.includes("announce:audio"), false);
    assert.equal(harness.events.includes("announce:hud"), false);

    const journal = (harness.engine as unknown as {
      rustTerrainLocatorEffectJournal: RustTerrainLocatorEffectJournalV1 | null;
    }).rustTerrainLocatorEffectJournal;
    if (failure === "prepared-local-save") {
      assert.equal(journal, null);
      assert.ok(harness.preparedJournal(), "the prepared journal should have reached the failing storage port");
      assert.equal(harness.durableSave(), null);
    } else {
      assert.ok(journal);
      assert.equal(journal, harness.preparedJournal());
    }
    if (failure === "command" || failure === "post-native-checkpoint" || failure === "final-local-save") {
      assert.equal(harness.events.includes("quarantine"), true);
    }
  });
}

for (const [kind, item] of [
  ["chart", Item.HearthroadsGazetteer],
  ["lair", Item.FireLairSurvey],
] as const) {
  test(`default mixed Rust ${kind} uses authoritative terrain with TypeScript inventory and no native pulse`, async () => {
    const { engine, toasts, saves, huds } = locatorEngine(item);
    let queries = 0;
    let nativePulses = 0;
    Object.assign(engine, {
      rustRuntimeHost: {
        diagnostics: () => ({ state: "ready" }),
        multiplayerAuthority: () => ({
          runExclusiveMutation: async <T>(operation: () => Promise<T>): Promise<T> => {
            nativePulses += 1;
            return operation();
          },
        }),
      },
      rustLiveInputPump: {
        drain: async () => { nativePulses += 1; },
        checkpointNativePersistence: async () => { nativePulses += 1; },
        consumeLocatorItem: async () => { nativePulses += 1; },
      },
      world: {
        terrainGenerationAuthority: { mode: "rust" },
        terrainLocatorAuthorityIdentity: () => ({ namespace: `locator:${kind}`, lifecycleRevision: 7 }),
        queryNearestSettlementsAuthoritative: async () => { queries += 1; return settlementResult(); },
        queryNearestDragonLairAuthoritative: async () => { queries += 1; return lairResult(); },
      },
    });
    (engine as unknown as { rustLivePlayerAuthorityEnabledR5(): boolean }).rustLivePlayerAuthorityEnabledR5 = () => false;

    assert.equal(engine.useSelected(), true);
    const pending = kind === "chart"
      ? (engine as unknown as { pendingSettlementChart: Promise<void> | null }).pendingSettlementChart
      : (engine as unknown as { pendingDragonLairSurvey: Promise<void> | null }).pendingDragonLairSurvey;
    assert.ok(pending);
    await pending;
    assert.equal(queries, 1);
    assert.equal(nativePulses, 0);
    assert.deepEqual(engine.inventory[0], { item, count: 1 });
    assert.equal(engine.mapKnowledge.markers.length, 1);
    assert.equal(saves(), 0);
    assert.equal(huds(), 1);
    assert.equal(toasts.length >= 1, true);
    assert.equal((engine as unknown as { pendingSettlementChart: Promise<void> | null }).pendingSettlementChart, null);
    assert.equal((engine as unknown as { pendingDragonLairSurvey: Promise<void> | null }).pendingDragonLairSurvey, null);
  });

  test(`explicit experimental Rust ${kind} fails closed when native custody is unavailable`, () => {
    const { engine, toasts, saves, huds } = locatorEngine(item);
    let queries = 0;
    let nativePulses = 0;
    Object.assign(engine, {
      rustLivePlayerAuthorityRequestedR5: true,
      rustRuntimeHost: {
        diagnostics: () => ({ state: "ready" }),
        multiplayerAuthority: () => ({
          runExclusiveMutation: async <T>(operation: () => Promise<T>): Promise<T> => {
            nativePulses += 1;
            return operation();
          },
        }),
      },
      rustLiveInputPump: {
        drain: async () => { nativePulses += 1; },
        checkpointNativePersistence: async () => { nativePulses += 1; },
        consumeLocatorItem: async () => { nativePulses += 1; },
      },
      world: {
        terrainGenerationAuthority: { mode: "rust" },
        terrainLocatorAuthorityIdentity: () => ({ namespace: `locator:${kind}`, lifecycleRevision: 7 }),
        queryNearestSettlementsAuthoritative: async () => { queries += 1; return settlementResult(); },
        queryNearestDragonLairAuthoritative: async () => { queries += 1; return lairResult(); },
      },
    });
    (engine as unknown as { rustLivePlayerAuthorityEnabledR5(): boolean }).rustLivePlayerAuthorityEnabledR5 = () => false;

    assert.equal(engine.useSelected(), true);
    assert.equal(queries, 0);
    assert.equal(nativePulses, 0);
    assert.deepEqual(engine.inventory[0], { item, count: 2 });
    assert.equal(engine.mapKnowledge.markers.length, 0);
    assert.equal(saves(), 0);
    assert.equal(huds(), 0);
    assert.deepEqual(toasts, ["Authoritative Rust player custody is unavailable, so the locator item was not used."]);
  });
}

test("Rust faction guide rejects stale state and commits the exact current result", async () => {
  const guide = locatorEngine();
  const guideGate = deferred<{ entries: readonly [typeof SETTLEMENT_ENTRY] }>();
  Object.assign(guide.engine, {
    activeSentient: { id: 44, factionId: "hobbits", name: "Mara" },
    world: {
      terrainGenerationAuthority: { mode: "rust" },
      terrainLocatorAuthorityIdentity: () => ({ namespace: "locator:guide", lifecycleRevision: 4 }),
      queryNearestSettlementsAuthoritative: () => guideGate.promise,
    },
  });
  const pending = guide.engine.setNearestFactionTownWaypointAuthoritative();
  (guide.engine as unknown as { activeSentient: null }).activeSentient = null;
  guideGate.resolve({ entries: [SETTLEMENT_ENTRY] });
  assert.equal(await pending, null);
  assert.equal(guide.engine.mapKnowledge.markers.length, 0);
  assert.equal(guide.saves(), 0);

  (guide.engine as unknown as { activeSentient: unknown }).activeSentient = { id: 44, factionId: "hobbits", name: "Mara" };
  const success = guide.engine.setNearestFactionTownWaypointAuthoritative();
  // A new immediate query is required after the stale operation clears.
  assert.equal(await success, `settlement:${SETTLEMENT_ENTRY.id}`);
  assert.equal(guide.engine.mapKnowledge.markers.some((marker) => marker.id === `settlement:${SETTLEMENT_ENTRY.id}`), true);
});
