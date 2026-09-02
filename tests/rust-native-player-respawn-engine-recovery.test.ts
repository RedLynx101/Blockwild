import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { VoxelEngine } from "../app/game/engine.ts";
import type {
  RustIntegratedPlayerRespawnV1,
  RustLivePlayerRespawnPlanRecordV1,
  RustLivePlayerRespawnPlanV1,
} from "../app/game/rust-integrated-runtime-player-respawn.ts";
import {
  planRustLivePlayerRespawnV1,
  rehydrateRustLivePlayerRespawnPlanV1,
  rustLivePlayerRespawnPlanRecordV1,
} from "../app/game/rust-integrated-runtime-player-respawn.ts";
import type { RustIntegratedRuntimeIdentityV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import type {
  RustLiveInputPumpPlayerRespawnOptionsV1,
  RustLiveInputPumpPlayerRespawnResultV1,
} from "../app/game/rust-live-input-pump-r5.ts";
import type { RustLivePlayerViewR10 } from "../app/game/rust-live-player-view-r10.ts";

const GENERATION = 47;
const PLAYER_ID = BigInt(401);
const ENTITY_ID = BigInt(402);
const DEAD_ENTITY_REVISION = BigInt(51);
const GAMEPLAY_SEQUENCE = BigInt(61);
const GAMEPLAY_COMBAT_REVISION = BigInt(62);
const COMBATANT_REVISION = BigInt(63);
const SEMANTIC_ROW_REVISION = BigInt(9_999);
const DEATH_SEQUENCE = BigInt(7);

function identity(overrides: Partial<RustIntegratedRuntimeIdentityV1> = {}): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe-respawn-recovery",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1,
      world: 20,
      entities: 21,
      gameplay: 22,
      persistence: 23,
      network: 24,
      simulation: 25,
    }),
    tick: 100,
    stateHash: "1".repeat(32),
    ...overrides,
  });
}

function emptyEffects(externalEntityId: string, authorityTick: bigint): RustLivePlayerViewR10["effects"] {
  return Object.freeze({
    schema: 1,
    producer: "rust-bwau-v2",
    playerExternalId: externalEntityId,
    authorityTick,
    total: 0,
    selected: 0,
    omitted: 0,
    firstSequence: null,
    lastSequence: null,
    contiguous: true,
    cues: Object.freeze([]),
  });
}

function deadPlayerView(overrides: Partial<RustLivePlayerViewR10> = {}): RustLivePlayerViewR10 {
  const externalEntityId = "player:respawn-recovery";
  const authorityTick = BigInt(100);
  return Object.freeze({
    extractionRevision: BigInt(30),
    authorityTick,
    externalEntityId,
    actorId: "actor:noah",
    playerId: PLAYER_ID,
    entityId: ENTITY_ID,
    entityRevision: DEAD_ENTITY_REVISION,
    inventoryContainer: "container-key-v1/01",
    inventoryContainerRevision: BigInt(70),
    equipmentContainer: "container-key-v1/02",
    equipmentContainerRevision: BigInt(71),
    selectedSlot: 0,
    backSlot: 7,
    respawnAuthoritySchema: 1,
    gameplaySequence: GAMEPLAY_SEQUENCE,
    gameplayCombatRevision: GAMEPLAY_COMBAT_REVISION,
    deathSequence: DEATH_SEQUENCE,
    lastRespawnSequence: BigInt(6),
    queuedInputsEmpty: true,
    pendingContextCommandsEmpty: true,
    pendingMovementResultEmpty: true,
    miningStateEmpty: true,
    latestDeathRespawn: null,
    lastInputSequence: BigInt(10),
    buttons: 0,
    authoritativeFlags: 0,
    lookYaw: 0,
    lookPitch: 0,
    position: Object.freeze({ x: 8, y: 60, z: -4 }),
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    radius: 0.3,
    height: 1.8,
    mass: 80,
    grounded: true,
    crouching: false,
    contactFlags: 1,
    inLiquid: false,
    headSubmerged: false,
    drowningAccumulator: 0,
    fallDistance: 0,
    oxygenSeconds: 10,
    maximumOxygenSeconds: 10,
    health: 0,
    maximumHealth: 10,
    lastDamageTick: BigInt(99),
    combat: Object.freeze({
      domainRevision: BigInt(72),
      rowRevision: SEMANTIC_ROW_REVISION,
      combatantRevision: COMBATANT_REVISION,
      recordId: "combat:player:respawn-recovery",
      ownerId: "actor:noah",
      entityId: ENTITY_ID,
      vitalUnits: "millihearts-v1",
      health: 0,
      maxHealth: 10,
      alive: false,
      crossDomainParity: true,
    }),
    effects: emptyEffects(externalEntityId, authorityTick),
    held: null,
    ...overrides,
  });
}

function respawnIntent(
  expected: RustIntegratedRuntimeIdentityV1,
  keepInventory = true,
): RustIntegratedPlayerRespawnV1 {
  return Object.freeze({
    expected,
    externalEntityId: "player:respawn-recovery",
    actorId: "actor:noah",
    playerId: PLAYER_ID,
    entityId: ENTITY_ID,
    expectedEntityRevision: DEAD_ENTITY_REVISION,
    expectedGameplaySequence: GAMEPLAY_SEQUENCE,
    expectedGameplayCombatRevision: GAMEPLAY_COMBAT_REVISION,
    expectedCombatantRevision: COMBATANT_REVISION,
    expectedDeathSequence: DEATH_SEQUENCE,
    expectedMaxHealth: 10,
    respawnPosition: Object.freeze({ xMilli: 1_250, yMilli: 64_000, zMilli: -3_500 }),
    keepInventory,
  });
}

type RespawnEngineAccess = Readonly<{
  rustLivePlayerRespawnIntentR5(
    view: RustLivePlayerViewR10,
    expected: RustIntegratedRuntimeIdentityV1,
  ): RustIntegratedPlayerRespawnV1;
  retainedRustKeepInventoryRespawnMatchesR5(
    plan: RustLivePlayerRespawnPlanV1,
    view: RustLivePlayerViewR10,
    current: RustIntegratedRuntimeIdentityV1,
  ): boolean;
  startRustLivePlayerRespawnR5(): Promise<void> | null;
  withRustTerrainLocatorCommitLock<T>(operation: () => Promise<T>): Promise<T>;
}>;

type HarnessOptions = Readonly<{
  checkpointGate?: Promise<void>;
  projectionCommitGate?: Promise<void>;
  localSaveError?: Error;
  retainedPlan?: RustLivePlayerRespawnPlanRecordV1;
}>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

function createStartHarness(options: HarnessOptions = {}) {
  const runtimeIdentity = identity();
  const pending = deadPlayerView();
  const calls: string[] = [];
  const checkpointStarted = deferred();
  const projectionCommitStarted = deferred();
  let dispatchedPlan: RustLivePlayerRespawnPlanV1 | null = null;
  let retainedRetry: RustLivePlayerRespawnPlanV1 | null = null;
  let planRecordAtDispatch: RustLivePlayerRespawnPlanRecordV1 | null = null;
  let checkpointIdentity: RustIntegratedRuntimeIdentityV1 | null = null;
  let checkpointDeadView: RustLivePlayerViewR10 | null = null;
  let projectionCommitAuthorityAccess: "acquire" | "already-exclusive" | null = null;
  let projectionCommitResult: RustLiveInputPumpPlayerRespawnResultV1 | null = null;

  const result = Object.freeze({ discarded: false }) as RustLiveInputPumpPlayerRespawnResultV1;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const privateState = engine as unknown as {
    rustNativePlayerRespawnPlan: RustLivePlayerRespawnPlanRecordV1 | null;
    rustLivePlayerRespawnPendingR5: RustLivePlayerViewR10 | null;
    rustLivePlayerRespawnTransactionR5: unknown | null;
    rustTerrainLocatorCommitLocked: boolean;
  };
  const service = Object.freeze({ identity: () => runtimeIdentity });
  const pump = Object.freeze({
    state: "ready" as const,
    async drain() {},
    async adoptExternalNetworkSuccessor(generation: number) {
      assert.equal(generation, GENERATION);
    },
    async respawnPlayer(
      generation: number,
      intent: RustIntegratedPlayerRespawnV1,
      dispatchOptions: RustLiveInputPumpPlayerRespawnOptionsV1,
    ) {
      assert.equal(generation, GENERATION);
      calls.push("pump:new-plan");
      const plan = planRustLivePlayerRespawnV1(runtimeIdentity, intent);
      dispatchedPlan = plan;
      assert.ok(dispatchOptions.beforeDispatch);
      await dispatchOptions.beforeDispatch(plan);
      planRecordAtDispatch = privateState.rustNativePlayerRespawnPlan;
      calls.push("service:command");
      return result;
    },
    async retryPlayerRespawn(generation: number, plan: RustLivePlayerRespawnPlanV1) {
      assert.equal(generation, GENERATION);
      calls.push("pump:retry-plan");
      retainedRetry = plan;
      planRecordAtDispatch = privateState.rustNativePlayerRespawnPlan;
      calls.push("service:command");
      return result;
    },
  });
  const authority = Object.freeze({
    async runExclusiveMutation<T>(operation: () => Promise<T>) {
      return await operation();
    },
  });
  const host = Object.freeze({
    runtimeService: () => service,
    diagnostics: () => Object.freeze({ state: "ready" as const }),
    multiplayerAuthority: () => authority,
  });

  Object.assign(engine, {
    activeWorldId: "world-respawn-recovery",
    persistent: true,
    rustNativePlayerRespawnPlan: options.retainedPlan ?? null,
    rustLivePlayerRespawnPendingR5: pending,
    rustLivePlayerRespawnTransactionR5: null,
    rustTerrainLocatorCommitLocked: false,
    rustLiveInputPump: pump,
    rustRuntimeHost: host,
    rustLivePlayerAuthorityGeneration: GENERATION,
    rustLiveInputAdvance: null,
    rustLiveViewRefresh: null,
    spawn: Object.freeze({ x: 1.25, y: 64, z: -3.5 }),
    worldOptions: Object.freeze({ keepInventory: true }),
    rustLivePlayerAuthorityEnabledR5: () => true,
    runRustLivePumpNetworkExclusiveR5: async (
      checkedGeneration: number,
      checkedHost: typeof host,
      checkedPump: typeof pump,
      label: string,
      operation: () => Promise<RustLiveInputPumpPlayerRespawnResultV1>,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.equal(label, "player respawn");
      calls.push("authority:enter");
      try {
        return await operation();
      } finally {
        calls.push("authority:exit");
      }
    },
    checkpointRustLivePlayerNativeWitness: async (
      checkedGeneration: number,
      checkedHost: typeof host,
      checkedPump: typeof pump,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      checkpointIdentity = service.identity();
      checkpointDeadView = privateState.rustLivePlayerRespawnPendingR5;
      calls.push("checkpoint:dead:start");
      checkpointStarted.resolve();
      if (options.checkpointGate) await options.checkpointGate;
      calls.push("checkpoint:dead:end");
      return Object.freeze({ checkpointId: "native-checkpoint-dead" });
    },
    saveRustCompatibilityDocumentLocalOnly: (purpose: string) => {
      assert.equal(purpose, "a native player respawn command plan");
      const record = privateState.rustNativePlayerRespawnPlan;
      assert.ok(record, "the exact JSON-safe plan must be installed before its browser save");
      assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
      calls.push("browser:save-plan");
      return options.localSaveError
        ? Object.freeze({ ok: false as const, error: options.localSaveError })
        : Object.freeze({ ok: true as const, value: Object.freeze({ worldId: "world-respawn-recovery" }) });
    },
    commitRustLivePlayerRespawnResultR5: async (
      input: Readonly<{
        generation: number;
        host: typeof host;
        pump: typeof pump;
        result: RustLiveInputPumpPlayerRespawnResultV1;
      }>,
      authorityAccess: "acquire" | "already-exclusive" = "acquire",
    ) => {
      assert.equal(input.generation, GENERATION);
      assert.equal(input.host, host);
      assert.equal(input.pump, pump);
      projectionCommitAuthorityAccess = authorityAccess;
      projectionCommitResult = input.result;
      // This gate stands in for the complete browser projection commit,
      // including its awaited durable native checkpoint.
      calls.push("browser:commit-result:start");
      projectionCommitStarted.resolve();
      if (options.projectionCommitGate) await options.projectionCommitGate;
      calls.push("browser:commit-result");
    },
    trackRustAuthorityOperation: () => undefined,
    quarantineRustLivePlayerAuthorityR5: (error: unknown) => {
      assert.ok(error instanceof Error);
      calls.push("authority:quarantine");
    },
    scheduleRustLiveInputAdvanceR5: () => { calls.push("scheduler:retry"); },
  });

  const access = engine as unknown as RespawnEngineAccess;
  const start = () => access.startRustLivePlayerRespawnR5();
  return {
    calls,
    pending,
    pumpResult: result,
    runtimeIdentity,
    checkpointStarted: checkpointStarted.promise,
    projectionCommitStarted: projectionCommitStarted.promise,
    checkpointIdentity: () => checkpointIdentity,
    checkpointDeadView: () => checkpointDeadView,
    projectionCommitAuthorityAccess: () => projectionCommitAuthorityAccess,
    projectionCommitResult: () => projectionCommitResult,
    dispatchedPlan: () => dispatchedPlan,
    retainedRetry: () => retainedRetry,
    planRecord: () => privateState.rustNativePlayerRespawnPlan,
    planRecordAtDispatch: () => planRecordAtDispatch,
    respawnTransaction: () => privateState.rustLivePlayerRespawnTransactionR5,
    locatorCommitLocked: () => privateState.rustTerrainLocatorCommitLocked,
    withLocatorCommit: <T>(operation: () => Promise<T>) =>
      access.withRustTerrainLocatorCommitLock(operation),
    start,
  };
}

test("respawn intent binds explicit R7 combatant revision rather than the semantic row revision", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    spawn: Object.freeze({ x: 1.25, y: 64, z: -3.5 }),
    worldOptions: Object.freeze({ keepInventory: true }),
  });
  const view = deadPlayerView();
  const current = identity();
  const intent = (engine as unknown as RespawnEngineAccess).rustLivePlayerRespawnIntentR5(view, current);

  assert.equal(intent.expectedCombatantRevision, COMBATANT_REVISION);
  assert.notEqual(intent.expectedCombatantRevision, SEMANTIC_ROW_REVISION);
  assert.equal(intent.expectedGameplayCombatRevision, GAMEPLAY_COMBAT_REVISION);
  assert.equal(intent.expectedDeathSequence, DEATH_SEQUENCE);
  assert.equal(intent.expected, current);
});

test("fresh engine respawn reserves shared browser admission and commits projection inside one authority interval", async () => {
  const checkpointGate = deferred();
  const projectionCommitGate = deferred();
  const harness = createStartHarness({
    checkpointGate: checkpointGate.promise,
    projectionCommitGate: projectionCommitGate.promise,
  });
  const operation = harness.start();
  assert.ok(operation);
  await harness.checkpointStarted;

  assert.deepEqual(harness.calls, ["authority:enter", "checkpoint:dead:start"]);
  assert.equal(harness.checkpointIdentity(), harness.runtimeIdentity);
  assert.equal(harness.checkpointDeadView(), harness.pending);
  assert.equal(harness.dispatchedPlan(), null);
  assert.equal(harness.planRecord(), null);
  const transaction = harness.respawnTransaction();
  assert.ok(transaction, "respawn must reserve browser-transaction admission before its first await");
  let locatorEntries = 0;
  await assert.rejects(
    harness.withLocatorCommit(async () => { locatorEntries += 1; }),
    /native player respawn transaction is already committing/u,
  );
  assert.equal(locatorEntries, 0, "locator work must not enter during the pre-dispatch checkpoint");

  checkpointGate.resolve();
  await harness.projectionCommitStarted;

  assert.deepEqual(harness.calls, [
    "authority:enter",
    "checkpoint:dead:start",
    "checkpoint:dead:end",
    "pump:new-plan",
    "browser:save-plan",
    "service:command",
    "browser:commit-result:start",
  ]);
  assert.equal(harness.projectionCommitAuthorityAccess(), "already-exclusive");
  assert.equal(harness.projectionCommitResult(), harness.pumpResult);
  assert.equal(harness.calls.includes("authority:exit"), false);
  assert.equal(
    harness.respawnTransaction(),
    transaction,
    "one reservation must span command dispatch and the complete browser projection commit",
  );
  await assert.rejects(
    harness.withLocatorCommit(async () => { locatorEntries += 1; }),
    /native player respawn transaction is already committing/u,
  );
  assert.equal(locatorEntries, 0, "locator work must not enter during the projection checkpoint/save gate");

  projectionCommitGate.resolve();
  await operation;
  assert.equal(harness.respawnTransaction(), null, "successful respawn must release its exact token");

  assert.deepEqual(harness.calls.slice(0, 9), [
    "authority:enter",
    "checkpoint:dead:start",
    "checkpoint:dead:end",
    "pump:new-plan",
    "browser:save-plan",
    "service:command",
    "browser:commit-result:start",
    "browser:commit-result",
    "authority:exit",
  ]);
  assert.ok(
    harness.calls.indexOf("browser:commit-result") < harness.calls.indexOf("authority:exit"),
    "the complete durable browser projection commit must finish before authority exclusion exits",
  );
  const plan = harness.dispatchedPlan();
  const record = harness.planRecord();
  assert.ok(plan);
  assert.ok(record);
  assert.deepEqual(record, rustLivePlayerRespawnPlanRecordV1(plan));
  assert.deepEqual(harness.planRecordAtDispatch(), record);
  assert.deepEqual(rehydrateRustLivePlayerRespawnPlanV1(record), plan);
  assert.deepEqual(plan.batch.expected, harness.checkpointIdentity());
  assert.equal(plan.request.expectedEntityRevision, harness.pending.entityRevision);
  assert.equal(plan.request.expectedCombatantRevision, harness.pending.combat.combatantRevision);
  assert.equal(plan.request.expectedDeathSequence, harness.pending.deathSequence);
});

test("failure to persist the exact plan prevents native respawn dispatch and rolls the plan back", async () => {
  const harness = createStartHarness({ localSaveError: new Error("disk full") });
  const operation = harness.start();
  assert.ok(operation);
  await assert.rejects(operation, /command plan could not be stored.*disk full/u);

  assert.equal(harness.calls.includes("checkpoint:dead:end"), true);
  assert.equal(harness.calls.includes("pump:new-plan"), true);
  assert.equal(harness.calls.includes("browser:save-plan"), true);
  assert.equal(harness.calls.includes("service:command"), false);
  assert.equal(harness.calls.includes("browser:commit-result"), false);
  assert.ok(
    harness.calls.indexOf("authority:exit") > harness.calls.indexOf("browser:save-plan"),
    "failed plan persistence must still release its authority interval",
  );
  assert.equal(harness.planRecord(), null);
  assert.equal(harness.planRecordAtDispatch(), null);
  assert.equal(harness.respawnTransaction(), null, "failed respawn must release its exact token");
});

test("locator-first admission defers respawn until the shared lock releases, then retry succeeds", async () => {
  const harness = createStartHarness();
  const locatorGate = deferred();
  const locatorStarted = deferred();
  let locatorEntries = 0;
  const locatorOperation = harness.withLocatorCommit(async () => {
    locatorEntries += 1;
    locatorStarted.resolve();
    await locatorGate.promise;
  });
  await locatorStarted.promise;

  assert.equal(harness.locatorCommitLocked(), true);
  assert.equal(harness.start(), null, "respawn must defer while locator or Creative custody is committing");
  assert.equal(harness.respawnTransaction(), null, "a deferred start must not reserve a respawn token");
  assert.equal(harness.calls.length, 0, "a deferred start must not enter the respawn authority interval");

  locatorGate.resolve();
  await locatorOperation;
  assert.equal(locatorEntries, 1);
  assert.equal(harness.locatorCommitLocked(), false);

  const retry = harness.start();
  assert.ok(retry, "the scheduler's later retry must be admitted after locator release");
  await retry;
  assert.equal(harness.calls[0], "authority:enter");
  assert.equal(harness.calls.includes("service:command"), true);
  assert.equal(harness.calls.includes("browser:commit-result"), true);
  assert.equal(harness.respawnTransaction(), null);
});

test("retained engine respawn retries the same exact bytes without checkpointing or mutating the plan", async () => {
  const canonicalPlan = planRustLivePlayerRespawnV1(identity(), respawnIntent(identity()));
  const retainedRecord = rustLivePlayerRespawnPlanRecordV1(canonicalPlan);
  const harness = createStartHarness({ retainedPlan: retainedRecord });
  const before = harness.planRecord();
  const operation = harness.start();
  assert.ok(operation);
  await operation;

  assert.equal(harness.calls.includes("checkpoint:dead:start"), false);
  assert.equal(harness.calls.includes("pump:new-plan"), false);
  assert.equal(harness.calls.includes("browser:save-plan"), false);
  assert.deepEqual(harness.calls.slice(0, 6), [
    "authority:enter",
    "pump:retry-plan",
    "service:command",
    "browser:commit-result:start",
    "browser:commit-result",
    "authority:exit",
  ]);
  assert.equal(harness.projectionCommitAuthorityAccess(), "already-exclusive");
  assert.equal(harness.projectionCommitResult(), harness.pumpResult);
  assert.equal(harness.planRecord(), before, "retry must not replace the retained durable record");
  assert.equal(harness.planRecordAtDispatch(), before);
  assert.deepEqual(rustLivePlayerRespawnPlanRecordV1(harness.retainedRetry()!), retainedRecord);
});

test("already-live retained reconciliation accepts only an exact keep-inventory successor", () => {
  const expected = identity();
  const keepPlan = planRustLivePlayerRespawnV1(expected, respawnIntent(expected, true));
  const successorIdentity = identity({
    revision: Object.freeze({
      ...expected.revision,
      world: expected.revision.world + 1,
      entities: expected.revision.entities + 1,
      gameplay: expected.revision.gameplay + 1,
      persistence: expected.revision.persistence + 1,
      simulation: expected.revision.simulation + 1,
    }),
    tick: expected.tick + 1,
    stateHash: "2".repeat(32),
  });
  const live = deadPlayerView({
    entityRevision: DEAD_ENTITY_REVISION + BigInt(1),
    gameplaySequence: GAMEPLAY_SEQUENCE + BigInt(1),
    gameplayCombatRevision: GAMEPLAY_COMBAT_REVISION + BigInt(1),
    lastRespawnSequence: DEATH_SEQUENCE,
    position: Object.freeze({ x: Math.fround(1.25), y: Math.fround(64), z: Math.fround(-3.5) }),
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    grounded: false,
    contactFlags: 0,
    oxygenSeconds: 10,
    health: 10,
    combat: Object.freeze({
      ...deadPlayerView().combat,
      combatantRevision: COMBATANT_REVISION + BigInt(1),
      health: 10,
      alive: true,
    }),
  });
  const engine = Object.create(VoxelEngine.prototype) as RespawnEngineAccess;

  assert.equal(engine.retainedRustKeepInventoryRespawnMatchesR5(keepPlan, live, successorIdentity), true);
  const falsePolicyPlan = planRustLivePlayerRespawnV1(expected, respawnIntent(expected, false));
  assert.equal(
    engine.retainedRustKeepInventoryRespawnMatchesR5(falsePolicyPlan, live, successorIdentity),
    false,
    "false-policy plans must survive for their retained death-drop parent projection",
  );
  assert.equal(
    engine.retainedRustKeepInventoryRespawnMatchesR5(
      keepPlan,
      Object.freeze({ ...live, entityRevision: live.entityRevision + BigInt(1) }),
      successorIdentity,
    ),
    false,
    "an already-live successor must still match every exact CAS field",
  );
});

const engineSourcePath = fileURLToPath(new URL("../app/game/engine.ts", import.meta.url));
const engineSourceText = readFileSync(engineSourcePath, "utf8");
const engineSource = ts.createSourceFile(
  engineSourcePath,
  engineSourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function engineMethodSource(methodName: string) {
  const matches: ts.MethodDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === methodName) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(engineSource);
  const match = matches[0];
  assert.ok(match, `engine method ${methodName} must exist`);
  return engineSourceText.slice(match.getStart(engineSource), match.end);
}

function ordered(source: string, needles: readonly string[]) {
  let cursor = -1;
  for (const needle of needles) {
    const index = source.indexOf(needle, cursor + 1);
    assert.ok(index > cursor, `expected '${needle}' after source offset ${cursor}`);
    cursor = index;
  }
}

test("respawn token is identity-cleared and locator plus Creative mutations retain the shared lock", () => {
  const start = engineMethodSource("startRustLivePlayerRespawnR5");
  ordered(start, [
    "this.rustTerrainLocatorCommitLocked || this.rustLivePlayerRespawnTransactionR5",
    "this.rustLivePlayerRespawnTransactionR5 = transaction",
    "if (this.rustLivePlayerRespawnTransactionR5 === transaction)",
    "this.rustLivePlayerRespawnTransactionR5 = null",
    "if (this.rustLiveInputAdvance !== operation) return",
  ]);

  const sharedLock = "this.withRustTerrainLocatorCommitLock(async () =>";
  assert.equal(engineMethodSource("setRustCreativeItem").includes(sharedLock), true);
  assert.equal(engineMethodSource("runRustTerrainLocatorNewDebit").includes(sharedLock), true);
  assert.equal(engineMethodSource("recoverPreparedRustTerrainLocatorEffect").includes(sharedLock), true);
  const lock = engineMethodSource("withRustTerrainLocatorCommitLock");
  ordered(lock, [
    "if (this.rustLivePlayerRespawnTransactionR5)",
    "if (this.rustTerrainLocatorCommitLocked)",
    "this.rustTerrainLocatorCommitLocked = true",
  ]);
});

test("activation recovery is dead-only, identity-bound, checkpointed before terrain, and reconciles projection last", () => {
  // A complete activation harness would duplicate the engine's bootstrap, mode,
  // terrain, camera, and pump systems. Isolate the real method through the TS AST
  // and assert only the recovery branch and its custody-sensitive source order.
  const source = engineMethodSource("activateRustLivePlayerAuthorityR5");
  const deadGuard = "if (this.rustNativePlayerRespawnPlan && entity.record.health <= 0)";
  const identityGuard = "!rustIntegratedRuntimeIdentityEqualsV1(service.identity(), retainedPlan.batch.expected)";
  const execute = "await executeRustLivePlayerRespawnPlanV1(service, retainedPlan)";
  const checkpoint = "await this.worldStorage.saveNativeWorld(catalogWorldId)";
  const terrain = "const terrain = new RustIntegratedTerrainResidencyPortV1(service)";

  ordered(source, [deadGuard, identityGuard, execute, checkpoint, terrain]);
  assert.equal(source.match(/executeRustLivePlayerRespawnPlanV1\(service, retainedPlan\)/gu)?.length, 1);
  assert.match(
    source.slice(source.indexOf(identityGuard), source.indexOf(execute)),
    /throw new Error\("Durable native player respawn plan no longer matches the restored dead runtime identity"\)/u,
  );

  ordered(source, [
    execute,
    checkpoint,
    terrain,
    "const initial = await pump.syncInitial(generation, requestedView)",
    "await this.commitRustNativePlayerDeathRespawnProjectionR5({",
    "const retainedPlan = rehydrateRustLivePlayerRespawnPlanV1(this.rustNativePlayerRespawnPlan)",
    "this.retainedRustKeepInventoryRespawnMatchesR5(",
    "this.rustNativePlayerRespawnPlan = null",
  ]);
  const firstPlanClear = source.indexOf("this.rustNativePlayerRespawnPlan = null");
  assert.ok(
    firstPlanClear > source.indexOf("await this.commitRustNativePlayerDeathRespawnProjectionR5({"),
    "activation must leave false-policy custody retained through initial parent projection",
  );
});
