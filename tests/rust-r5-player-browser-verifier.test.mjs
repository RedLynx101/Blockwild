import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";
import {
  contentAddressForFiles,
  createRustEngineSourceSnapshot,
  describeArtifactFiles,
} from "../scripts/rust-engine-common.mjs";
import {
  R5_GENERATION_CERTIFICATE,
  R5_JUMP_TRAJECTORY_THRESHOLDS,
  R5_NATIVE_SURVIVAL_CONTACT,
  R5_NATIVE_SURVIVAL_WORLD_FIXTURE,
  R5_PLAYER_BROWSER_SCENARIOS,
  acquireManagedBrowserGateMutex,
  assertExactR5Reload,
  assertR5BrowserErrorStreams,
  assertR5AuthorityDiagnostics,
  assertR5CandidateSourceUnchanged,
  assertR5JumpTrajectoryEvidence,
  assertR5NativeSurvivalDeathRespawnSequence,
  assertR5NativeSurvivalDeathRespawnTerminalGate,
  assertR5NativeSurvivalEnvironmentSequence,
  assertR5NativeSurvivalEnvironmentTerminalGate,
  collectR5RuntimeErrors,
  exactProcessIsAlive,
  parseR5BrowserOptions,
  prepareCandidateRoute,
  r5HorizontalMovementEngaged,
  r5JumpTrajectorySample,
  r5ManagedViteInlineConfig,
  r5MovementSampleEvidence,
  r5NativeSurvivalCheckpointEvidence,
  r5NativeSurvivalDeathRespawnSample,
  r5NativeSurvivalEnvironmentSample,
  r5NativeSurvivalProjectionSettled,
  r5NativeSurvivalShoreExitCueEvidence,
  r5NativeSurvivalShoreExitJournalTransportEvidence,
  r5PersistencePoseEvidence,
  r5SteadyMovementPair,
  r5TerminalPersistencePair,
  resolveManagedCanonicalAsset,
  resolveWorkOutputDirectory,
  recordR5TerminalSourceCleanup,
  r5CleanupGatePassed,
  stopOwnedProcess,
  summarizeR5JumpTrajectory,
  taskkillCommandSucceeded,
} from "../scripts/verify-rust-r5-player-browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_HASH = "a".repeat(64);

// Output-path validation intentionally requires an existing work directory.
before(() => { mkdirSync(path.join(ROOT, "work"), { recursive: true }); });

function argv(...options) {
  return ["node", "scripts/verify-rust-r5-player-browser.mjs", ...options];
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createCurrentSourceCandidateFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "blockwild-r5-current-source-"));
  t.after(() => {
    const temporaryRoot = realpathSync(os.tmpdir());
    const resolved = path.resolve(root);
    assert.notEqual(resolved, temporaryRoot);
    assert.equal(resolved.startsWith(`${temporaryRoot}${path.sep}`), true);
    rmSync(resolved, { recursive: true, force: true });
  });

  for (const [relativePath, contents] of [
    ["engine/Cargo.toml", "[workspace]\nmembers = []\n"],
    ["engine/src/lib.rs", "pub fn heartbeat() -> u32 { 1 }\n"],
    ["scripts/build-rust-engine.mjs", "export const build = true;\n"],
    ["scripts/rust-engine-common.mjs", "export const common = true;\n"],
  ]) {
    const absolute = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  const sourceSnapshot = createRustEngineSourceSnapshot(root);

  const candidateRoot = path.join(root, "public", "engine-locator-candidate");
  const staging = path.join(candidateRoot, "staging");
  mkdirSync(staging, { recursive: true });
  writeFileSync(path.join(staging, "engine.js"), "export default async () => {};\n", "utf8");
  writeFileSync(path.join(staging, "engine_bg.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  const files = describeArtifactFiles(staging);
  const hash = contentAddressForFiles(files);
  const artifactDirectory = path.join(candidateRoot, hash);
  renameSync(staging, artifactDirectory);
  writeJson(path.join(artifactDirectory, "manifest.json"), {
    schema: 1,
    artifactHash: hash,
    variant: "compatibility",
    sourceSnapshot,
    files,
  });
  writeJson(path.join(candidateRoot, "manifest.json"), {
    schema: 1,
    defaultVariant: "compatibility",
    artifacts: {
      compatibility: {
        hash,
        directory: hash,
        manifest: `${hash}/manifest.json`,
      },
    },
  });
  return Object.freeze({ root, candidateRoot, hash, sourceSnapshot });
}

function certificate() {
  return {
    generatorVersion: 18,
    generatorHash: "1".repeat(32),
    contentHash: "2".repeat(32),
    corpusHash: R5_GENERATION_CERTIFICATE.corpusHash,
    corpusCases: R5_GENERATION_CERTIFICATE.corpusCases,
    byteEqual: true,
  };
}

function healthySnapshot() {
  return {
    buildDiagnostics: { worldgenBuildProfile: "rust-primary" },
    state: {
      state: "playing",
      player: { position: [4, 43.51, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0, mode: "survival", sprinting: false },
      world: { seed: "MOON-FIELD-505" },
      performance: {
        streaming: {
          generationWorker: {
            mode: "rust",
            selectionSource: "build-rust-primary",
            state: "ready",
            authorityRequired: true,
            rollbackRequiresWorldReload: true,
            supported: true,
            workers: 2,
            ready: 2,
            failed: 0,
            restarts: 0,
            rejected: 0,
            lastError: null,
          },
          terrainWorker: { failed: 0, restarts: 0, lastError: null },
          rustTerrain: { fallback: 0, parityMismatches: 0, installFailures: 0, lastMismatch: null },
          rustWorldAuthority: { failures: 0, restarts: 0, lastFallbackReason: null },
          immediateRing: { desired: 9, ready: 9 },
        },
      },
    },
    runtime: {
      ready: true,
      operationsBlocked: false,
      transitionGeneration: 3,
      activeWorldId: "world-1",
      activeUniverseId: "universe-1",
      activeLocationId: "overworld",
      activeSessionId: "runtime-session-1",
      nativePersistenceWorldId: "world-1",
      manager: {
        state: "ready",
        requestedGeneration: 3,
        activeGeneration: 3,
        lastError: null,
        host: {
          state: "ready",
          artifactHash: ARTIFACT_HASH,
          lastError: null,
          adapter: {
            state: "ready",
            authoritative: true,
            verification: "content-addressed-wasm",
            liveAuthorityReady: true,
            failures: 0,
            rejectedCommands: 0,
            indeterminateCommands: 0,
            staleResponses: 0,
            lastError: null,
          },
          nativePersistence: { parentFallbacks: 0, lastError: null },
        },
      },
      playerAuthority: {
        state: "ready",
        worldGeneration: 3,
        runtimeSessionId: "runtime-session-1",
        entityId: "4294967297",
        terrainChunkCount: 25,
        advanceInFlight: false,
        lastError: null,
        pump: {
          state: "ready",
          worldGeneration: 3,
          queuedAdvances: 0,
          inFlight: false,
          nativeInputPending: false,
          pendingInputSequence: null,
          authoritativeFlags: 0,
          lastExtractionRevision: 10,
          lastAuthorityTick: 10,
          lastAppliedButtons: 0,
          nextInputSequence: 11,
          nextActionSequence: 1,
          queuedContextCommands: 0,
          appliedInputs: 10,
          samples: 10,
          stepCalls: 10,
          lastError: null,
        },
      },
      renderer: { lastError: null, runtime: null, publisher: null },
      multiplayer: { lastError: null },
    },
    generationCertificates: [certificate(), certificate()],
  };
}

function nativeEnvironmentSnapshot(overrides = {}) {
  const snapshot = healthySnapshot();
  if (overrides.position !== undefined) snapshot.state.player.position = structuredClone(overrides.position);
  if (overrides.velocity !== undefined) snapshot.state.player.velocity = structuredClone(overrides.velocity);
  const contactFlags = overrides.contactFlags ?? R5_NATIVE_SURVIVAL_CONTACT.grounded;
  const health = overrides.health ?? 10;
  const maximumHealth = overrides.maximumHealth ?? 10;
  const oxygenSeconds = overrides.oxygenSeconds ?? 12;
  const maximumOxygenSeconds = overrides.maximumOxygenSeconds ?? 12;
  const entityId = overrides.entityId ?? "4294967297";
  const playerExternalId = overrides.playerExternalId ?? overrides.recordId ?? "actor:player-1";
  const effectCues = structuredClone(overrides.effectCues ?? []);
  const effectOmitted = overrides.effectOmitted ?? 0;
  const evidence = {
    schema: 1,
    producer: "rust-r5-r6-r7",
    typescriptDamageAuthoringCalls: overrides.typescriptDamageAuthoringCalls ?? 0,
    suppressedLegacyDamageCalls: overrides.suppressedLegacyDamageCalls ?? 0,
    projectedDamageEvents: overrides.projectedDamageEvents ?? 0,
    projectedDeathEvents: overrides.projectedDeathEvents ?? 0,
    extractionRevision: overrides.extractionRevision ?? "100",
    authorityTick: overrides.authorityTick ?? "100",
    effects: {
      schema: 1,
      producer: "rust-bwau-v2",
      playerExternalId,
      authorityTick: overrides.authorityTick ?? "100",
      total: overrides.effectTotal ?? effectCues.length + effectOmitted,
      selected: overrides.effectSelected ?? effectCues.length,
      omitted: effectOmitted,
      firstSequence: overrides.effectFirstSequence ?? effectCues.at(0)?.sequence ?? null,
      lastSequence: overrides.effectLastSequence ?? effectCues.at(-1)?.sequence ?? null,
      contiguous: overrides.effectContiguous ?? true,
      cues: effectCues,
    },
    r6: {
      entityId,
      entityRevision: overrides.entityRevision ?? "1",
      health,
      maximumHealth,
      oxygenSeconds,
      maximumOxygenSeconds,
      inLiquid: Boolean(contactFlags & R5_NATIVE_SURVIVAL_CONTACT.inLiquid),
      headSubmerged: Boolean(contactFlags & R5_NATIVE_SURVIVAL_CONTACT.headSubmerged),
      contactFlags,
      drowningAccumulator: overrides.drowningAccumulator ?? 0,
      fallDistance: overrides.fallDistance ?? 0,
      lastDamageTick: overrides.lastDamageTick ?? "0",
    },
    r7: {
      entityId,
      recordId: overrides.recordId ?? "actor:player-1",
      rowRevision: overrides.rowRevision ?? "1",
      combatDomainRevision: overrides.combatDomainRevision ?? "1",
      vitalUnits: "millihearts-v1",
      health: Math.round(health * 1_000),
      maxHealth: Math.round(maximumHealth * 1_000),
      alive: health > 0,
      crossDomainParity: true,
    },
  };
  snapshot.state.state = overrides.gameState ?? "playing";
  snapshot.state.player = {
    ...snapshot.state.player,
    health,
    oxygen: Number(oxygenSeconds.toFixed(2)),
    crouching: overrides.crouching ?? false,
    sprinting: overrides.sprinting ?? false,
    submerged: evidence.r6.headSubmerged,
    inLiquid: evidence.r6.inLiquid,
    alive: evidence.r7.alive,
    input: {
      jumpHeld: overrides.jumpHeld ?? false,
      forwardHeld: overrides.forwardHeld ?? false,
    },
    nativeEnvironmental: structuredClone(evidence),
  };
  snapshot.runtime.hydration = overrides.hydration ?? "new-world";
  snapshot.runtime.operationsBlocked = overrides.operationsBlocked ?? false;
  snapshot.runtime.playerAuthority.entityId = entityId;
  snapshot.runtime.playerAuthority.environmentalSurvival = evidence;
  snapshot.runtime.playerAuthority.advanceInFlight = overrides.advanceInFlight ?? false;
  snapshot.runtime.playerAuthority.pendingRendererExtraction = overrides.pendingRendererExtraction ?? false;
  snapshot.runtime.playerAuthority.nativeInventory = {
    extractionRevision: overrides.nativeInventoryExtractionRevision ?? evidence.extractionRevision,
    inventoryContainer: "container-key-v1/player-inventory",
    inventoryContainerRevision: "1",
    selectedSlot: 0,
    held: null,
  };
  snapshot.runtime.playerAuthority.nativeDropTransforms = {
    extractionRevision: overrides.nativeDropExtractionRevision ?? evidence.extractionRevision,
    authorityTick: overrides.nativeDropAuthorityTick ?? evidence.authorityTick,
    inventoryDomainRevision: "1",
    transforms: [],
  };
  snapshot.runtime.playerAuthority.pump.inFlight = overrides.pumpInFlight ?? false;
  snapshot.runtime.playerAuthority.pump.queuedAdvances = overrides.queuedAdvances ?? 0;
  snapshot.runtime.playerAuthority.pump.nativeInputPending = overrides.nativeInputPending ?? false;
  snapshot.runtime.playerAuthority.pump.pendingInputSequence = overrides.pendingInputSequence ?? null;
  snapshot.runtime.playerAuthority.pump.lastAuthorityTick = overrides.pumpAuthorityTick
    ?? Number(evidence.authorityTick);
  snapshot.runtime.playerAuthority.pump.lastExtractionRevision = overrides.pumpExtractionRevision
    ?? Number(evidence.extractionRevision);
  snapshot.runtime.playerAuthority.pump.lastAppliedButtons = overrides.lastAppliedButtons ?? 0;
  snapshot.runtime.playerAuthority.pump.lastAppliedMoveX = overrides.lastAppliedMoveX ?? 0;
  snapshot.runtime.playerAuthority.pump.lastAppliedMoveZ = overrides.lastAppliedMoveZ ?? 0;
  snapshot.runtime.manager.host.nativePersistence = {
    worldId: "world:world-1@overworld",
    state: "open",
    saves: overrides.saves ?? 1,
    recoveries: overrides.recoveries ?? 0,
    legacyMigrations: 0,
    legacyMigrationRetries: 0,
    parentFallbacks: 0,
    platformOperations: overrides.platformOperations ?? 3,
    requestBytes: 128,
    responseBytes: 64,
    lastCheckpointId: overrides.lastCheckpointId ?? "checkpoint-0",
    lastError: null,
  };
  return snapshot;
}

function completedNativeCheckpointTitle(before) {
  const title = structuredClone(before);
  const beforePersistence = before.runtime.manager.host.nativePersistence;
  const checkpoint = {
    worldId: beforePersistence.worldId,
    saveId: "save-2",
    checkpointId: "checkpoint-1",
    checkpointHash: "ab".repeat(16),
    journalSequence: 2,
    records: 9,
    commits: 1,
    requestBytes: 32,
    responseBytes: 16,
  };
  const afterPersistence = {
    ...structuredClone(beforePersistence),
    saves: beforePersistence.saves + 1,
    platformOperations: beforePersistence.platformOperations + checkpoint.commits,
    requestBytes: beforePersistence.requestBytes + checkpoint.requestBytes,
    responseBytes: beforePersistence.responseBytes + checkpoint.responseBytes,
    lastCheckpointId: checkpoint.checkpointId,
  };
  title.state.state = "title";
  title.runtime.operationsBlocked = true;
  title.runtime.lastCompletedSaveAndQuitNativeCheckpoint = {
    schema: 1,
    binding: {
      catalogWorldId: before.runtime.activeWorldId,
      nativeWorldId: beforePersistence.worldId,
      universeId: before.runtime.activeUniverseId,
      locationId: before.runtime.activeLocationId,
      runtimeSessionId: before.runtime.activeSessionId,
    },
    checkpoint,
    persistence: {
      before: structuredClone(beforePersistence),
      after: afterPersistence,
    },
    terminalEnvironmentalSurvival: structuredClone(
      before.runtime.playerAuthority.environmentalSurvival,
    ),
  };
  title.runtime.manager.host = null;
  title.runtime.activeUniverseId = null;
  title.runtime.activeLocationId = null;
  title.runtime.activeSessionId = null;
  title.runtime.nativePersistenceWorldId = null;
  title.runtime.playerAuthority.runtimeSessionId = null;
  title.runtime.playerAuthority.environmentalSurvival = null;
  title.state.player.nativeEnvironmental = null;
  return title;
}

function syncNativeEnvironmentPresentation(snapshot) {
  const evidence = snapshot.runtime.playerAuthority.environmentalSurvival;
  snapshot.state.player.health = evidence.r6.health;
  snapshot.state.player.oxygen = Number(evidence.r6.oxygenSeconds.toFixed(2));
  snapshot.state.player.submerged = evidence.r6.headSubmerged;
  snapshot.state.player.inLiquid = evidence.r6.inLiquid;
  snapshot.state.player.alive = evidence.r7.alive;
  snapshot.state.player.nativeEnvironmental = structuredClone(evidence);
  return snapshot;
}

function healthyNativeEnvironmentSequence() {
  const liquidEffects = [
    { sequence: "1", tick: "101", entityExternalId: "actor:player-1", kind: "liquid-enter", amount: 0 },
  ];
  const damagedEffects = [
    ...liquidEffects,
    { sequence: "2", tick: "130", entityExternalId: "actor:player-1", kind: "drown-damage", amount: 1 },
  ];
  const shoreCueEffects = [
    ...damagedEffects,
    { sequence: "3", tick: "132", entityExternalId: "actor:player-1", kind: "shore-exit", amount: 0 },
  ];
  const dryEffects = [
    ...shoreCueEffects,
    { sequence: "4", tick: "133", entityExternalId: "actor:player-1", kind: "liquid-exit", amount: 0 },
  ];
  const landedEffects = [
    ...dryEffects,
    { sequence: "5", tick: "134", entityExternalId: "actor:player-1", kind: "land", amount: 0 },
  ];
  const dryBaseline = nativeEnvironmentSnapshot({ authorityTick: "100", extractionRevision: "100", oxygenSeconds: 12 });
  const submergedEntry = nativeEnvironmentSnapshot({
    authorityTick: "101", extractionRevision: "101", entityRevision: "2",
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.inLiquid | R5_NATIVE_SURVIVAL_CONTACT.headSubmerged,
    oxygenSeconds: 11.95, combatDomainRevision: "2", effectCues: liquidEffects,
  });
  const oxygenDrained = nativeEnvironmentSnapshot({
    authorityTick: "120", extractionRevision: "120", entityRevision: "3",
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.inLiquid | R5_NATIVE_SURVIVAL_CONTACT.headSubmerged,
    oxygenSeconds: 0.05, combatDomainRevision: "3", effectCues: liquidEffects,
  });
  const ascentWindow = nativeEnvironmentSnapshot({
    authorityTick: "121", extractionRevision: "121", entityRevision: "4",
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.inLiquid | R5_NATIVE_SURVIVAL_CONTACT.headSubmerged,
    oxygenSeconds: 0, drowningAccumulator: 0.9, combatDomainRevision: "4", effectCues: liquidEffects,
  });
  const ascentArmed = nativeEnvironmentSnapshot({
    authorityTick: "122", extractionRevision: "122", entityRevision: "5",
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.inLiquid | R5_NATIVE_SURVIVAL_CONTACT.headSubmerged,
    oxygenSeconds: 0, drowningAccumulator: 1.1,
    jumpHeld: true, sprinting: true, lastAppliedButtons: 5, combatDomainRevision: "5", effectCues: liquidEffects,
  });
  const damaged = nativeEnvironmentSnapshot({
    authorityTick: "130", extractionRevision: "130", entityRevision: "6",
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.inLiquid | R5_NATIVE_SURVIVAL_CONTACT.headSubmerged,
    oxygenSeconds: 0, health: 9, drowningAccumulator: 0.05, lastDamageTick: "130",
    rowRevision: "2", combatDomainRevision: "6", projectedDamageEvents: 1,
    jumpHeld: true, sprinting: true, lastAppliedButtons: 5, effectCues: damagedEffects,
  });
  const surfaced = nativeEnvironmentSnapshot({
    authorityTick: "131", extractionRevision: "131", entityRevision: "7",
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.inLiquid,
    oxygenSeconds: 0.2, health: 9, rowRevision: "2", combatDomainRevision: "7",
    lastDamageTick: "130", projectedDamageEvents: 1, effectCues: damagedEffects,
  });
  const shoreExitCue = nativeEnvironmentSnapshot({
    authorityTick: "132", extractionRevision: "132", entityRevision: "8",
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.inLiquid,
    oxygenSeconds: 0.4, health: 9, rowRevision: "2", combatDomainRevision: "8",
    lastDamageTick: "130", projectedDamageEvents: 1, effectCues: shoreCueEffects,
  });
  const shoreExit = nativeEnvironmentSnapshot({
    authorityTick: "134", extractionRevision: "134", entityRevision: "9",
    contactFlags: 0,
    oxygenSeconds: 0.6, health: 9, rowRevision: "2", combatDomainRevision: "9",
    lastDamageTick: "130", projectedDamageEvents: 1, effectCues: landedEffects,
    position: [4, 34.25, -6], velocity: [0, 4, 0],
    jumpHeld: true, forwardHeld: true, lastAppliedButtons: 1, lastAppliedMoveZ: 32_767,
  });
  const shoreSettled = nativeEnvironmentSnapshot({
    authorityTick: "135", extractionRevision: "135", entityRevision: "10",
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.grounded,
    oxygenSeconds: 1, health: 9, rowRevision: "2", combatDomainRevision: "10",
    lastDamageTick: "130", projectedDamageEvents: 1, effectCues: landedEffects,
    position: [4, 33.51, -6],
  });
  const preSave = nativeEnvironmentSnapshot({
    authorityTick: "355", extractionRevision: "355", entityRevision: "11",
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.grounded,
    oxygenSeconds: 6.0000000000000036, health: 9, rowRevision: "2", combatDomainRevision: "11",
    lastDamageTick: "130", projectedDamageEvents: 1, gameState: "paused", effectCues: landedEffects,
    position: [4, 33.51, -6],
  });
  const checkpointed = completedNativeCheckpointTitle(preSave);
  const restored = structuredClone(preSave);
  restored.state.state = "playing";
  restored.runtime.hydration = "restored";
  const restoredDiagnostic = restored.runtime.playerAuthority.environmentalSurvival;
  restoredDiagnostic.authorityTick = "360";
  restoredDiagnostic.extractionRevision = "3";
  restoredDiagnostic.effects.authorityTick = "360";
  restoredDiagnostic.r6.entityRevision = "14";
  restoredDiagnostic.r6.oxygenSeconds = 7.0000000000000036;
  restoredDiagnostic.r7.rowRevision = "4";
  restoredDiagnostic.r7.combatDomainRevision = "12";
  restoredDiagnostic.projectedDamageEvents = 0;
  restored.runtime.playerAuthority.pump.lastAuthorityTick = 360;
  restored.runtime.playerAuthority.pump.lastExtractionRevision = 3;
  syncNativeEnvironmentPresentation(restored);
  return {
    dryBaseline,
    submergedEntry,
    oxygenDrained,
    ascentWindow,
    ascentArmed,
    damaged,
    surfaced,
    shoreExitCue,
    shoreExit,
    shoreSettled,
    preSave,
    checkpointed,
    restored,
    lifecycle: {
      saveAndQuitCompleted: true,
      freshPageReloadBeforeContinue: true,
      freshContinueCompleted: true,
      r5SelectorPreserved: true,
    },
  };
}

const NATIVE_DEATH_RECEIPT_HASH = "12".repeat(16);
const NATIVE_DEATH_QUERY_HASH = "23".repeat(16);
const NATIVE_DEATH_DROP_ID = "player-death-drop-v1:12884901895:1:0:0";
const NATIVE_DEATH_DROP_ENTITY_ID = "4294967298";
const NATIVE_BERRY_METADATA_HASH = "0".repeat(32);

function nativeBerryDeathParent() {
  return {
    respawnSequence: "1",
    receiptHash: NATIVE_DEATH_RECEIPT_HASH,
    generatedDropCount: 1,
    playerId: "12884901895",
    entityId: "4294967297",
    deathSequence: "1",
    inventoryContainer: "container-key-v1/player-inventory",
    inventoryBeforeRevision: "0",
    inventoryAfterRevision: "1",
    equipmentContainer: "container-key-v1/player-equipment",
    equipmentBeforeRevision: "0",
    equipmentAfterRevision: "0",
    custodyAfterHash: "34".repeat(16),
    drops: [{
      parentRespawnSequence: "1",
      parentReceiptHash: NATIVE_DEATH_RECEIPT_HASH,
      sourceLane: "inventory",
      sourceSlot: 0,
      stack: {
        itemCode: 124,
        count: 3,
        durabilityMillionths: null,
        metadataHash: NATIVE_BERRY_METADATA_HASH,
      },
      dropId: NATIVE_DEATH_DROP_ID,
      entityId: NATIVE_DEATH_DROP_ENTITY_ID,
      custodyContainer: "container-key-v1/player-death-custody",
      custodySlot: 0,
      custodyRevision: "0",
      spatialRevision: "0",
      position: { xMilli: 4_000, yMilli: 33_502, zMilli: -7_235 },
      velocityMilliPerSecond: { xMilli: 1_000, yMilli: 2_000, zMilli: -500 },
      rotation: { yaw: 100_000, pitch: 0, roll: 0 },
      createdTick: "150",
      expiresTick: null,
      pickupLockActorId: null,
      pickupUnlockTick: "157",
      originHash: "56".repeat(16),
      content: {
        configuredManifestHash: "78".repeat(16),
        installedManifestHash: "78".repeat(16),
        installedRegistryHash: "9a".repeat(16),
        itemContentHash: "bc".repeat(16),
        itemContentVersion: 1,
      },
      r6Linked: true,
    }],
  };
}

function nativeDeathDropTransform({
  authorityTick,
  extractionRevision,
  entityRevision,
  ageTicks,
  position,
  velocity,
  yawMicroturns,
}) {
  return {
    extractionRevision: String(extractionRevision),
    authorityTick: String(authorityTick),
    inventoryDomainRevision: "1",
    transforms: [{
      dropId: NATIVE_DEATH_DROP_ID,
      entityId: NATIVE_DEATH_DROP_ENTITY_ID,
      entityRevision: String(entityRevision),
      position: { x: position[0], y: position[1], z: position[2] },
      velocity: { x: velocity[0], y: velocity[1], z: velocity[2] },
      yawRadians: yawMicroturns / 1_000_000 * Math.PI * 2,
      ageTicks: String(ageTicks),
    }],
  };
}

function syncNativeDeathDropPresentation(snapshot) {
  const transforms = snapshot.runtime.playerAuthority.nativeDropTransforms?.transforms ?? [];
  snapshot.state.drops = transforms.map((native) => ({
    item: 124,
    count: 3,
    position: [native.position.x, native.position.y, native.position.z]
      .map((value) => Number(value.toFixed(3))),
    velocity: [native.velocity.x, native.velocity.y, native.velocity.z]
      .map((value) => Number(value.toFixed(3))),
    rotationY: Number(native.yawRadians.toFixed(6)),
    age: Number((Number(native.ageTicks) * 0.05).toFixed(3)),
    rustEntityId: native.entityId,
    pickupDelay: 0,
  }));
  return snapshot;
}

function nativeDeathRespawnSnapshot({
  authorityTick,
  extractionRevision = authorityTick,
  position = R5_NATIVE_SURVIVAL_WORLD_FIXTURE.expectedSpawn,
  health = 10,
  contactFlags = R5_NATIVE_SURVIVAL_CONTACT.grounded,
  projectedDamageEvents = 0,
  projectedDeathEvents = 0,
  gameState = "playing",
  hydration = "new-world",
  held = true,
  parent = null,
  transform = null,
  checkpoint = null,
  crouching = false,
}) {
  const snapshot = nativeEnvironmentSnapshot({
    authorityTick: String(authorityTick),
    extractionRevision: String(extractionRevision),
    entityRevision: String(Math.max(1, authorityTick - 98)),
    combatDomainRevision: String(Math.max(1, authorityTick - 98)),
    health,
    contactFlags,
    projectedDamageEvents,
    projectedDeathEvents,
    gameState,
    hydration,
    position,
    crouching,
  });
  snapshot.state.world.seed = R5_NATIVE_SURVIVAL_WORLD_FIXTURE.seed;
  snapshot.state.inventory = {
    selectedSlot: 0,
    held: held ? { item: 124, count: 3 } : null,
  };
  snapshot.state.drops = [];
  const authority = snapshot.runtime.playerAuthority;
  authority.nativeRespawn = {
    schema: 1,
    gameplaySequence: parent === null ? "3" : "10",
    gameplayCombatRevision: parent === null ? "1" : "2",
    combatantRevision: parent === null ? "0" : "1",
    deathSequence: parent === null ? null : "1",
    lastRespawnSequence: parent === null ? null : "1",
    queuedInputsEmpty: true,
    pendingContextCommandsEmpty: true,
    pendingMovementResultEmpty: true,
    miningStateEmpty: true,
    latestDeathRespawn: parent === null ? null : structuredClone(parent),
  };
  authority.playerDeathRespawnProjection = {
    schema: 1,
    cursor: parent === null ? 0 : 1,
    lastReceiptHash: parent === null ? null : NATIVE_DEATH_RECEIPT_HASH,
  };
  authority.playerDeathRespawnCheckpoint = checkpoint === null ? null : structuredClone(checkpoint);
  authority.playerDeathRespawnFinalize = null;
  authority.playerRespawnPlanPending = false;
  authority.nativeInventory = {
    extractionRevision: String(extractionRevision),
    inventoryContainer: "container-key-v1/player-inventory",
    inventoryContainerRevision: parent === null ? "0" : "1",
    selectedSlot: 0,
    held: held ? {
      itemCode: 124,
      count: 3,
      durabilityMillionths: null,
      metadataHash: NATIVE_BERRY_METADATA_HASH,
    } : null,
  };
  authority.nativeDropTransforms = transform === null ? {
    extractionRevision: String(extractionRevision),
    authorityTick: String(authorityTick),
    inventoryDomainRevision: parent === null ? "0" : "1",
    transforms: [],
  } : structuredClone(transform);
  syncNativeDeathDropPresentation(snapshot);
  Object.assign(authority.pump, {
    deathRespawnQueryConfigured: true,
    deathRespawnCursor: parent === null ? 0 : 1,
    deathRespawnLegacySeedPending: false,
    pendingDeathRespawnSequence: null,
    pendingDeathRespawnReceiptHash: null,
    pendingDeathRespawnIdentityHash: null,
    lastAcknowledgedDeathRespawnSequence: parent === null ? null : 1,
    lastAcknowledgedDeathRespawnReceiptHash: parent === null ? null : NATIVE_DEATH_RECEIPT_HASH,
  });
  return snapshot;
}

function nativeDeathDropStateAtAge(ageTicks) {
  const position = [4, 33.502, -7.235];
  const velocity = [1, 2, -0.5];
  for (let tick = 0; tick < ageTicks; tick += 1) {
    velocity[1] -= 0.6;
    position[0] += velocity[0] / 20;
    position[1] += velocity[1] / 20;
    position[2] += velocity[2] / 20;
  }
  return {
    position,
    velocity,
    yawMicroturns: (100_000 + ageTicks * 19_894) % 1_000_000,
  };
}

function nativeDeathDropTransformAtAge(ageTicks, { extractionRevision = 150 + ageTicks } = {}) {
  const state = nativeDeathDropStateAtAge(ageTicks);
  return nativeDeathDropTransform({
    authorityTick: 150 + ageTicks,
    extractionRevision,
    entityRevision: ageTicks + 1,
    ageTicks,
    ...state,
  });
}

function healthyNativeDeathRespawnSequence({ firstObservationAge = 0, restoredAdvanceTicks = 0 } = {}) {
  const parent = nativeBerryDeathParent();
  const checkpoint = {
    schema: 1,
    cursorBefore: 0,
    cursorAfter: 1,
    receiptHash: NATIVE_DEATH_RECEIPT_HASH,
    queryIdentityHash: NATIVE_DEATH_QUERY_HASH,
    deathSequence: "1",
    generatedDropCount: 1,
  };
  const createdAge = firstObservationAge;
  const firstMotionAge = createdAge + 1;
  const secondMotionAge = createdAge + 2;
  const frozenAge = createdAge + 10;
  const restoredAge = frozenAge + restoredAdvanceTicks;
  const createdTransform = nativeDeathDropTransformAtAge(createdAge);
  const firstMotionTransform = nativeDeathDropTransformAtAge(firstMotionAge);
  const secondMotionTransform = nativeDeathDropTransformAtAge(secondMotionAge);
  const frozenTransform = nativeDeathDropTransformAtAge(frozenAge);
  const baseline = nativeDeathRespawnSnapshot({ authorityTick: 100 });
  const lastAliveSubmerged = nativeDeathRespawnSnapshot({
    authorityTick: 149,
    position: [4, 33, -7],
    health: 1,
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.inLiquid | R5_NATIVE_SURVIVAL_CONTACT.headSubmerged,
    projectedDamageEvents: 9,
    crouching: true,
  });
  const createdProjection = nativeDeathRespawnSnapshot({
    authorityTick: 150 + createdAge,
    parent,
    transform: createdTransform,
    checkpoint,
    held: false,
    projectedDamageEvents: 10,
    projectedDeathEvents: 1,
  });
  const dropSettledStart = nativeDeathRespawnSnapshot({
    authorityTick: 150 + firstMotionAge,
    parent,
    transform: firstMotionTransform,
    checkpoint,
    held: false,
    projectedDamageEvents: 10,
    projectedDeathEvents: 1,
  });
  const respawned = nativeDeathRespawnSnapshot({
    authorityTick: 150 + secondMotionAge,
    parent,
    transform: secondMotionTransform,
    checkpoint,
    held: false,
    projectedDamageEvents: 10,
    projectedDeathEvents: 1,
  });
  const pausedFreezeStart = nativeDeathRespawnSnapshot({
    authorityTick: 150 + frozenAge,
    parent,
    transform: frozenTransform,
    checkpoint,
    held: false,
    projectedDamageEvents: 10,
    projectedDeathEvents: 1,
    gameState: "paused",
  });
  const preSave = structuredClone(pausedFreezeStart);
  const checkpointed = completedNativeCheckpointTitle(preSave);
  const restoredTransform = nativeDeathDropTransformAtAge(restoredAge, { extractionRevision: 1 });
  restoredTransform.extractionRevision = "1";
  const restored = nativeDeathRespawnSnapshot({
    authorityTick: 150 + restoredAge,
    extractionRevision: 1,
    parent,
    transform: restoredTransform,
    checkpoint: null,
    held: false,
    projectedDamageEvents: 0,
    projectedDeathEvents: 0,
    hydration: "restored",
  });
  return {
    baseline,
    lastAliveSubmerged,
    createdProjection,
    dropSettledStart,
    respawned,
    pausedFreezeStart,
    preSave,
    checkpointed,
    restored,
    lifecycle: {
      saveAndQuitCompleted: true,
      freshPageReloadBeforeContinue: true,
      freshContinueCompleted: true,
      r5SelectorPreserved: true,
    },
  };
}

function retainedCheckpointTitlePair() {
  const input = healthyNativeEnvironmentSequence();
  const before = structuredClone(input.preSave);
  const title = completedNativeCheckpointTitle(before);
  return { before, title };
}

function rolloverShoreCueSnapshot(firstSequence, count, { authorityTick = "500", cueTick = "132" } = {}) {
  const effectCues = Array.from({ length: count }, (_, index) => ({
    sequence: String(firstSequence + index),
    tick: cueTick,
    entityExternalId: "actor:player-1",
    kind: "shore-exit",
    amount: 0,
  }));
  return nativeEnvironmentSnapshot({
    authorityTick,
    extractionRevision: authorityTick,
    entityRevision: "12",
    contactFlags: R5_NATIVE_SURVIVAL_CONTACT.inLiquid,
    oxygenSeconds: 0.4,
    health: 9,
    rowRevision: "2",
    combatDomainRevision: "2",
    lastDamageTick: "130",
    projectedDamageEvents: 1,
    effectCues,
  });
}

test("native Survival environment sample requires one exact public R5/R6/R7 projection", () => {
  const snapshot = nativeEnvironmentSnapshot();
  const sample = r5NativeSurvivalEnvironmentSample(snapshot, { phase: "dry", ordinal: 4 });
  assert.equal(sample.phase, "dry");
  assert.equal(sample.ordinal, 4);
  assert.equal(sample.r6.health, 10);
  assert.equal(sample.r7.health, 10_000);
  assert.equal(sample.r7.vitalUnits, "millihearts-v1");
  assert.equal(sample.typescriptDamageAuthoringCalls, 0);

  const mutations = [
    ["TypeScript damage authoring", (value) => {
      value.runtime.playerAuthority.environmentalSurvival.typescriptDamageAuthoringCalls = 1;
      value.state.player.nativeEnvironmental.typescriptDamageAuthoringCalls = 1;
    }, /TypeScript authored 1 damage calls/u],
    ["R6-R7 milliheart drift", (value) => {
      value.runtime.playerAuthority.environmentalSurvival.r7.health = 9_999;
      value.state.player.nativeEnvironmental.r7.health = 9_999;
    }, /R6-heart\/R7-milliheart parity failed/u],
    ["contact bit drift", (value) => {
      value.runtime.playerAuthority.environmentalSurvival.r6.inLiquid = true;
      value.state.player.nativeEnvironmental.r6.inLiquid = true;
    }, /in-liquid flag disagrees/u],
    ["presentation drift", (value) => {
      value.state.player.oxygen = 11.99;
    }, /browser oxygen disagrees/u],
    ["unknown terrain boundary", (value) => {
      const diagnostic = value.runtime.playerAuthority.environmentalSurvival;
      diagnostic.r6.contactFlags |= R5_NATIVE_SURVIVAL_CONTACT.unknownBoundary;
      value.state.player.nativeEnvironmental = structuredClone(diagnostic);
    }, /unknown terrain boundary/u],
    ["missing public mirror", (value) => {
      value.state.player.nativeEnvironmental = null;
    }, /native evidence disagrees/u],
  ];
  for (const [label, mutate, pattern] of mutations) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.throws(
      () => r5NativeSurvivalEnvironmentSample(changed, { phase: label, ordinal: 0 }),
      pattern,
      label,
    );
  }
});

test("native Survival projection settlement accepts camera-only cursor lead and rejects split authority", () => {
  const snapshot = nativeEnvironmentSnapshot({
    authorityTick: "605",
    extractionRevision: "1",
    pumpAuthorityTick: 605,
    pumpExtractionRevision: 3,
  });
  Object.assign(snapshot.runtime.playerAuthority.pump, {
    extractionCalls: 3,
    viewExtractionCalls: 2,
  });
  assert.equal(r5NativeSurvivalProjectionSettled(snapshot), true,
    "two later camera-only viewport extractions may lead the last full-authority projection cursor");
  for (const [label, mutate] of [
    ["authority advance in flight", (value) => { value.runtime.playerAuthority.advanceInFlight = true; }],
    ["renderer extraction pending", (value) => {
      value.runtime.playerAuthority.pendingRendererExtraction = true;
    }],
    ["pump in flight", (value) => { value.runtime.playerAuthority.pump.inFlight = true; }],
    ["queued advance", (value) => { value.runtime.playerAuthority.pump.queuedAdvances = 1; }],
    ["pending native input", (value) => {
      value.runtime.playerAuthority.pump.nativeInputPending = true;
      value.runtime.playerAuthority.pump.pendingInputSequence = 11;
    }],
    ["authority projection lag", (value) => { value.runtime.playerAuthority.pump.lastAuthorityTick += 5; }],
    ["negative authority tick", (value) => {
      value.runtime.playerAuthority.environmentalSurvival.authorityTick = "-1";
      value.runtime.playerAuthority.nativeDropTransforms.authorityTick = "-1";
      value.runtime.playerAuthority.pump.lastAuthorityTick = -1;
    }],
    ["drop authority tick mismatch", (value) => {
      value.runtime.playerAuthority.nativeDropTransforms.authorityTick = "604";
    }],
    ["full-authority projection ahead of pump", (value) => {
      value.runtime.playerAuthority.environmentalSurvival.extractionRevision = "4";
      value.runtime.playerAuthority.nativeInventory.extractionRevision = "4";
      value.runtime.playerAuthority.nativeDropTransforms.extractionRevision = "4";
    }],
    ["environment and drop revision mismatch", (value) => {
      value.runtime.playerAuthority.nativeDropTransforms.extractionRevision = "2";
    }],
    ["environment and inventory revision mismatch", (value) => {
      value.runtime.playerAuthority.nativeInventory.extractionRevision = "2";
    }],
  ]) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.equal(r5NativeSurvivalProjectionSettled(changed), false, label);
  }
});

test("native Survival environment sequence seals submerge, drowning damage, shore exit, checkpoint, and reload", () => {
  const input = healthyNativeEnvironmentSequence();
  const shoreCue = r5NativeSurvivalShoreExitCueEvidence(input.damaged, input.shoreExitCue);
  const evidence = assertR5NativeSurvivalEnvironmentSequence(input);
  assert.equal(evidence.complete, true);
  assert.equal(evidence.samples.oxygenDrained.r6.oxygenSeconds, 0.05);
  assert.equal(evidence.samples.ascentWindow.r6.drowningAccumulator, 0.9);
  assert.equal(evidence.samples.ascentArmed.r6.drowningAccumulator, 1.1);
  assert.equal(evidence.samples.damaged.r6.health, 9);
  assert.equal(evidence.samples.damaged.r7.health, 9_000);
  assert.equal(evidence.samples.damaged.projectedDamageEvents, 1);
  assert.equal(evidence.samples.surfaced.r6.headSubmerged, false);
  assert.equal(evidence.samples.shoreExitCue.effects.cues.at(-1)?.kind, "shore-exit");
  assert.equal(evidence.samples.shoreExitCue.effects.cues.at(-1)?.amount, 0);
  assert.equal(shoreCue.shoreExitCount, 1);
  assert.equal(evidence.shoreExit.observedCueCount, 1);
  assert.equal(evidence.shoreExit.firstObservedPhase, "shore-exit-cue");
  assert.equal(evidence.shoreExit.acceptedLiquidExit.kind, "liquid-exit");
  assert.equal(evidence.shoreExit.acceptedLiquidExit.sequence, "4");
  assert.equal(evidence.shoreExit.acceptedLanding.kind, "land");
  assert.equal(evidence.shoreExit.acceptedLanding.sequence, "5");
  assert.deepEqual(shoreCue.earliestCue, evidence.samples.shoreExitCue.effects.cues.at(-1));
  assert.deepEqual(shoreCue.latestCue, evidence.samples.shoreExitCue.effects.cues.at(-1));
  assert.equal(Boolean(evidence.samples.shoreExitCue.r6.contactFlags & R5_NATIVE_SURVIVAL_CONTACT.shoreBoosted), false,
    "persistent BWAU proof must not depend on retaining the transient contact bit");
  assert.equal(evidence.samples.shoreExit.r6.inLiquid, false);
  assert.equal(Boolean(evidence.samples.shoreExit.r6.contactFlags & R5_NATIVE_SURVIVAL_CONTACT.grounded), false,
    "held Space may already have auto-jumped after the durable post-exit landing");
  assert.ok(evidence.samples.shoreExit.browser.position[1] > R5_NATIVE_SURVIVAL_WORLD_FIXTURE.shoreMantleBounds.maximumY,
    "the held-input handoff must not depend on sampling below the neutral settlement ceiling");
  assert.equal(evidence.checkpoint.savesAfter, evidence.checkpoint.savesBefore + 1);
  assert.equal(evidence.checkpoint.retainedAfterTeardown, true);
  assert.equal(evidence.restoredDrySuccessor.tickDelta, "5");
  assert.equal(evidence.restoredDrySuccessor.actualOxygen, 7.0000000000000036);
  assert.equal(evidence.samples.restored.hydration, "restored");
  assert.equal(evidence.samples.restored.r6.health, evidence.samples.preSave.r6.health);
  assert.equal(evidence.samples.restored.r7.health, evidence.samples.preSave.r7.health);
  assert.equal(evidence.samples.restored.r6.entityRevision, "14");
  assert.equal(evidence.samples.restored.r7.rowRevision, "4");
  assert.equal(evidence.samples.restored.extractionRevision, "3",
    "fresh runtime extraction revision may restart while persisted authority stays monotonic");
  assert.deepEqual(evidence.samples.restored.effects.cues, evidence.samples.preSave.effects.cues);

  const fullRollover = r5NativeSurvivalShoreExitJournalTransportEvidence(
    input.surfaced,
    rolloverShoreCueSnapshot(3, 256),
  );
  assert.equal(fullRollover.shoreExitCount, 256,
    "an exact full native ring may begin at the immediate successor without overlap");
  assert.throws(
    () => r5NativeSurvivalShoreExitJournalTransportEvidence(input.surfaced, rolloverShoreCueSnapshot(3, 255)),
    /before reaching exact full-ring capacity/u,
    "a truncated non-overlapping successor ring must fail closed",
  );
  assert.throws(
    () => r5NativeSurvivalShoreExitJournalTransportEvidence(input.surfaced, rolloverShoreCueSnapshot(4, 256)),
    /without an exact full-ring successor/u,
    "a full ring beginning after the immediate successor must fail closed",
  );
  assert.throws(
    () => r5NativeSurvivalShoreExitJournalTransportEvidence(
      rolloverShoreCueSnapshot(100, 2, { authorityTick: "131", cueTick: "130" }),
      rolloverShoreCueSnapshot(99, 4),
    ),
    /first sequence moved backward/u,
    "a later journal cannot reintroduce sequences older than its accepted ring start",
  );
  assert.throws(
    () => r5NativeSurvivalShoreExitJournalTransportEvidence(
      rolloverShoreCueSnapshot(1, 5, { authorityTick: "131", cueTick: "130" }),
      rolloverShoreCueSnapshot(5, 2, { cueTick: "130" }),
    ),
    /discarded an accepted prefix before reaching exact full-ring capacity/u,
    "an under-capacity overlap cannot silently discard an accepted prefix",
  );
  const fullOverlapBaseline = rolloverShoreCueSnapshot(1, 256, { authorityTick: "131", cueTick: "130" });
  const fullOverlapCandidate = rolloverShoreCueSnapshot(2, 256, { cueTick: "130" });
  fullOverlapCandidate.runtime.playerAuthority.environmentalSurvival.effects.cues.at(-1).tick = "132";
  syncNativeEnvironmentPresentation(fullOverlapCandidate);
  assert.equal(r5NativeSurvivalShoreExitJournalTransportEvidence(fullOverlapBaseline, fullOverlapCandidate).shoreExitCount, 1,
    "an exact full ring may roll its prefix while preserving all overlapping cue payloads");
});

test("native surface recovery accepts and records a shore cue from the same public extraction", () => {
  const input = healthyNativeEnvironmentSequence();
  const combined = structuredClone(input.shoreExitCue);
  input.surfaced = combined;
  input.shoreExitCue = structuredClone(combined);

  const evidence = assertR5NativeSurvivalEnvironmentSequence(input);
  assert.equal(evidence.shoreExit.observedCueCount, 1);
  assert.equal(evidence.shoreExit.firstObservedPhase, "surface-recovery");
  assert.equal(evidence.shoreExit.earliestCue.kind, "shore-exit");
  assert.equal(evidence.shoreExit.earliestCue.sequence, "3");
});

test("native surface recovery accepts one fast-batched dry extraction with complete shore landing journal", () => {
  const input = healthyNativeEnvironmentSequence();
  const batchedRecovery = structuredClone(input.shoreExit);
  const batchedDiagnostic = batchedRecovery.runtime.playerAuthority.environmentalSurvival;
  // The global combat domain advances on ordinary fixed steps, while the
  // semantic row hash may move in either numeric direction as non-vital
  // combat fields evolve. Neither is a no-damage equality token.
  batchedDiagnostic.r7.rowRevision = "18446744073709551614";
  batchedDiagnostic.r7.combatDomainRevision = "17";
  syncNativeEnvironmentPresentation(batchedRecovery);
  input.surfaced = batchedRecovery;
  input.shoreExitCue = structuredClone(batchedRecovery);

  const heldHandoff = structuredClone(batchedRecovery);
  const heldDiagnostic = heldHandoff.runtime.playerAuthority.environmentalSurvival;
  heldDiagnostic.authorityTick = "135";
  heldDiagnostic.extractionRevision = "135";
  heldDiagnostic.effects.authorityTick = "135";
  heldDiagnostic.r7.combatDomainRevision = "18";
  heldHandoff.runtime.playerAuthority.nativeInventory.extractionRevision = "135";
  heldHandoff.runtime.playerAuthority.nativeDropTransforms.extractionRevision = "135";
  heldHandoff.runtime.playerAuthority.nativeDropTransforms.authorityTick = "135";
  heldHandoff.runtime.playerAuthority.pump.lastAuthorityTick = 135;
  heldHandoff.runtime.playerAuthority.pump.lastExtractionRevision = 135;
  syncNativeEnvironmentPresentation(heldHandoff);
  input.shoreExit = heldHandoff;

  const settledDiagnostic = input.shoreSettled.runtime.playerAuthority.environmentalSurvival;
  settledDiagnostic.authorityTick = "136";
  settledDiagnostic.extractionRevision = "136";
  settledDiagnostic.effects.authorityTick = "136";
  settledDiagnostic.r7.rowRevision = "17";
  settledDiagnostic.r7.combatDomainRevision = "19";
  input.shoreSettled.runtime.playerAuthority.nativeInventory.extractionRevision = "136";
  input.shoreSettled.runtime.playerAuthority.nativeDropTransforms.extractionRevision = "136";
  input.shoreSettled.runtime.playerAuthority.nativeDropTransforms.authorityTick = "136";
  input.shoreSettled.runtime.playerAuthority.pump.lastAuthorityTick = 136;
  input.shoreSettled.runtime.playerAuthority.pump.lastExtractionRevision = 136;
  syncNativeEnvironmentPresentation(input.shoreSettled);

  for (const [snapshot, rowRevision, combatDomainRevision] of [
    [input.preSave, "19", "20"],
    [input.restored, "5", "21"],
  ]) {
    const diagnostic = snapshot.runtime.playerAuthority.environmentalSurvival;
    diagnostic.r7.rowRevision = rowRevision;
    diagnostic.r7.combatDomainRevision = combatDomainRevision;
    syncNativeEnvironmentPresentation(snapshot);
  }
  input.checkpointed.runtime.lastCompletedSaveAndQuitNativeCheckpoint.terminalEnvironmentalSurvival = structuredClone(
    input.preSave.runtime.playerAuthority.environmentalSurvival,
  );

  const evidence = assertR5NativeSurvivalEnvironmentSequence(input);
  assert.equal(evidence.samples.surfaced.r6.inLiquid, false);
  assert.equal(evidence.samples.surfaced.r6.headSubmerged, false);
  assert.equal(evidence.samples.surfaced.r7.rowRevision, "18446744073709551614");
  assert.equal(evidence.samples.restored.r7.rowRevision, "5");
  assert.equal(evidence.samples.restored.r7.combatDomainRevision, "21");
  assert.equal(evidence.shoreExit.firstObservedPhase, "surface-recovery");
  assert.deepEqual(
    evidence.samples.surfaced.effects.cues.slice(-3).map((cue) => cue.kind),
    ["shore-exit", "liquid-exit", "land"],
  );
  assert.equal(evidence.shoreExit.acceptedLiquidExit.sequence, "4");
  assert.equal(evidence.shoreExit.acceptedLanding.sequence, "5");
});

test("native Survival environment sequence rejects every weaker transition and lifecycle claim", () => {
  const cases = [
    ["pre-baseline damage", (value) => {
      const diagnostic = value.dryBaseline.runtime.playerAuthority.environmentalSurvival;
      diagnostic.r6.health = 9;
      diagnostic.r6.lastDamageTick = "95";
      diagnostic.r7.health = 9_000;
      diagnostic.r7.alive = true;
      diagnostic.projectedDamageEvents = 1;
      syncNativeEnvironmentPresentation(value.dryBaseline);
    }, /baseline is not pristine/u],
    ["no oxygen drain", (value) => {
      const entry = value.submergedEntry.runtime.playerAuthority.environmentalSurvival.r6.oxygenSeconds;
      value.oxygenDrained.runtime.playerAuthority.environmentalSurvival.r6.oxygenSeconds = entry;
      syncNativeEnvironmentPresentation(value.oxygenDrained);
    }, /did not drain native oxygen/u],
    ["two-heart damage", (value) => {
      const diagnostic = value.damaged.runtime.playerAuthority.environmentalSurvival;
      diagnostic.r6.health = 8;
      diagnostic.r7.health = 8_000;
      diagnostic.r7.alive = true;
      syncNativeEnvironmentPresentation(value.damaged);
    }, /exactly one heart/u],
    ["late ascent arm", (value) => {
      value.ascentWindow.runtime.playerAuthority.environmentalSurvival.r6.drowningAccumulator = 1.25;
      syncNativeEnvironmentPresentation(value.ascentWindow);
    }, /0\.8-1\.0 drowning accumulation/u],
    ["unacknowledged ascent input", (value) => {
      value.ascentArmed.state.player.input.jumpHeld = false;
      value.ascentArmed.state.player.sprinting = false;
      value.ascentArmed.runtime.playerAuthority.pump.lastAppliedButtons = 0;
    }, /ascent controls were not acknowledged/u],
    ["stale ascent projection", (value) => {
      value.ascentArmed.runtime.playerAuthority.pump.lastAuthorityTick += 5;
    }, /ascent controls were not acknowledged/u],
    ["second damage event", (value) => {
      value.damaged.runtime.playerAuthority.environmentalSurvival.projectedDamageEvents = 2;
      syncNativeEnvironmentPresentation(value.damaged);
    }, /exactly the first native damage event/u],
    ["missing drowning damage cue", (value) => {
      const baseline = value.ascentArmed.runtime.playerAuthority.environmentalSurvival.effects;
      value.damaged.runtime.playerAuthority.environmentalSurvival.effects = structuredClone(baseline);
      value.damaged.runtime.playerAuthority.environmentalSurvival.effects.authorityTick = "130";
      syncNativeEnvironmentPresentation(value.damaged);
    }, /exactly one new player-linked damage cue/u],
    ["fall damage mislabeled as drowning", (value) => {
      value.damaged.runtime.playerAuthority.environmentalSurvival.effects.cues.at(-1).kind = "fall-damage";
      syncNativeEnvironmentPresentation(value.damaged);
    }, /damage cue was not drown-damage/u],
    ["wrong-entity drowning damage cue", (value) => {
      value.damaged.runtime.playerAuthority.environmentalSurvival.effects.cues.at(-1).entityExternalId = "actor:other";
      syncNativeEnvironmentPresentation(value.damaged);
    }, /exactly one new player-linked damage cue/u],
    ["wrong drowning damage amount", (value) => {
      value.damaged.runtime.playerAuthority.environmentalSurvival.effects.cues.at(-1).amount = 0.5;
      syncNativeEnvironmentPresentation(value.damaged);
    }, /amount was not exactly one heart/u],
    ["duplicate batched drowning damage cues", (value) => {
      const effects = value.damaged.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues.at(-1).amount = 0.5;
      effects.cues.push({
        sequence: "3", tick: "130", entityExternalId: effects.playerExternalId, kind: "drown-damage", amount: 0.5,
      });
      effects.total = 3;
      effects.selected = 3;
      effects.lastSequence = "3";
      syncNativeEnvironmentPresentation(value.damaged);
    }, /exactly one new player-linked damage cue/u],
    ["drowning damage cue tick mismatch", (value) => {
      value.damaged.runtime.playerAuthority.environmentalSurvival.effects.cues.at(-1).tick = "129";
      syncNativeEnvironmentPresentation(value.damaged);
    }, /cue tick did not equal R6 lastDamageTick/u],
    ["no R7 damage revision", (value) => {
      const diagnostic = value.damaged.runtime.playerAuthority.environmentalSurvival;
      diagnostic.r7.rowRevision = value.oxygenDrained.runtime.playerAuthority.environmentalSurvival.r7.rowRevision;
      syncNativeEnvironmentPresentation(value.damaged);
    }, /R7 combat row semantic revision did not change/u],
    ["no surface recovery", (value) => {
      value.surfaced.runtime.playerAuthority.environmentalSurvival.r6.oxygenSeconds = 0;
      syncNativeEnvironmentPresentation(value.surfaced);
    }, /recover native oxygen/u],
    ["surface recovery combat domain did not advance", (value) => {
      const diagnostic = value.surfaced.runtime.playerAuthority.environmentalSurvival;
      diagnostic.r7.combatDomainRevision = value.damaged.runtime.playerAuthority.environmentalSurvival.r7.combatDomainRevision;
      syncNativeEnvironmentPresentation(value.surfaced);
    }, /R7 combat-domain revision during surface recovery.*did not advance/u],
    ["stale shore cue", (value) => {
      const baseline = value.surfaced.runtime.playerAuthority.environmentalSurvival.effects;
      value.shoreExitCue.runtime.playerAuthority.environmentalSurvival.effects = structuredClone(baseline);
      value.shoreExitCue.runtime.playerAuthority.environmentalSurvival.effects.authorityTick = "132";
      syncNativeEnvironmentPresentation(value.shoreExitCue);
    }, /new linked native shore-exit/u],
    ["repeated shore boost during one held attempt", (value) => {
      const effects = value.shoreExitCue.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues.push({
        sequence: "4", tick: "132", entityExternalId: effects.playerExternalId, kind: "shore-exit", amount: 0,
      });
      effects.total = 4;
      effects.selected = 4;
      effects.lastSequence = "4";
      syncNativeEnvironmentPresentation(value.shoreExitCue);
    }, /did not emit exactly one linked native BWAU cue/u],
    ["Space released before accepted dry shore exit", (value) => {
      value.shoreExit.state.player.input.jumpHeld = false;
      value.shoreExit.runtime.playerAuthority.pump.lastAppliedButtons = 0;
    }, /exact acknowledged forward-swim egress input/u],
    ["wrong native forward axis at accepted dry shore exit", (value) => {
      value.shoreExit.runtime.playerAuthority.pump.lastAppliedMoveZ = 1;
    }, /exact acknowledged forward-swim egress input/u],
    ["sprint still applied at accepted dry shore exit", (value) => {
      value.shoreExit.state.player.sprinting = true;
      value.shoreExit.runtime.playerAuthority.pump.lastAppliedButtons = 5;
    }, /exact acknowledged forward-swim egress input/u],
    ["late repeated shore boost after first cue extraction", (value) => {
      const effects = value.preSave.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues.push({
        sequence: "6", tick: "139", entityExternalId: effects.playerExternalId, kind: "shore-exit", amount: 0,
      });
      effects.total = 6;
      effects.selected = 6;
      effects.lastSequence = "6";
      syncNativeEnvironmentPresentation(value.preSave);
    }, /did not emit exactly one linked native BWAU cue/u],
    ["liquid re-entry after accepted dry shore exit", (value) => {
      const effects = value.preSave.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues.push({
        sequence: "6", tick: "139", entityExternalId: effects.playerExternalId, kind: "liquid-enter", amount: 0,
      });
      effects.total = 6;
      effects.selected = 6;
      effects.lastSequence = "6";
      syncNativeEnvironmentPresentation(value.preSave);
    }, /liquid re-entry occurred during or after the accepted shore mantle/u],
    ["multiple liquid exits during one accepted shore mantle", (value) => {
      const effects = value.preSave.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues.push({
        sequence: "6", tick: "139", entityExternalId: effects.playerExternalId, kind: "liquid-exit", amount: 0,
      });
      effects.total = 6;
      effects.selected = 6;
      effects.lastSequence = "6";
      syncNativeEnvironmentPresentation(value.preSave);
    }, /exactly one linked native liquid-exit/u],
    ["wrong-entity shore evidence", (value) => {
      const effects = value.shoreExitCue.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues.at(-1).entityExternalId = "actor:other";
      syncNativeEnvironmentPresentation(value.shoreExitCue);
    }, /new linked native shore-exit/u],
    ["omitted BWAU journal", (value) => {
      const effects = value.shoreExitCue.runtime.playerAuthority.environmentalSurvival.effects;
      effects.omitted = 1;
      effects.total += 1;
      syncNativeEnvironmentPresentation(value.shoreExitCue);
    }, /omitted effect history/u],
    ["gapped BWAU journal", (value) => {
      const effects = value.shoreExitCue.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues.at(-1).sequence = "5";
      effects.lastSequence = "5";
      syncNativeEnvironmentPresentation(value.shoreExitCue);
    }, /cue sequence has a gap/u],
    ["stale shore cue tick", (value) => {
      value.shoreExitCue.runtime.playerAuthority.environmentalSurvival.effects.cues.at(-1).tick = "130";
      syncNativeEnvironmentPresentation(value.shoreExitCue);
    }, /cue tick is stale/u],
    ["nonzero shore cue amount", (value) => {
      value.shoreExitCue.runtime.playerAuthority.environmentalSurvival.effects.cues.at(-1).amount = 1;
      syncNativeEnvironmentPresentation(value.shoreExitCue);
    }, /amount is not exactly zero/u],
    ["rewritten overlapping BWAU cue", (value) => {
      value.shoreExitCue.runtime.playerAuthority.environmentalSurvival.effects.cues[1].amount = 0.5;
      syncNativeEnvironmentPresentation(value.shoreExitCue);
    }, /overlap rewrote an append-only cue/u],
    ["post-cue damage effect", (value) => {
      const effects = value.shoreExitCue.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues.push({
        sequence: "4", tick: "132", entityExternalId: effects.playerExternalId, kind: "fall-damage", amount: 4,
      });
      effects.total = 4;
      effects.selected = 4;
      effects.lastSequence = "4";
      syncNativeEnvironmentPresentation(value.shoreExitCue);
    }, /native damage effect occurred after surface recovery/u],
    ["dry exit still in water", (value) => {
      const diagnostic = value.shoreExit.runtime.playerAuthority.environmentalSurvival;
      diagnostic.r6.contactFlags = R5_NATIVE_SURVIVAL_CONTACT.inLiquid | R5_NATIVE_SURVIVAL_CONTACT.shoreBoosted;
      diagnostic.r6.inLiquid = true;
      diagnostic.r6.headSubmerged = false;
      syncNativeEnvironmentPresentation(value.shoreExit);
    }, /shore handoff did not become dry and head-clear/u],
    ["missing post-exit landing proof at held-input handoff", (value) => {
      const effects = value.shoreExit.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues.pop();
      effects.total = 4;
      effects.selected = 4;
      effects.lastSequence = "4";
      syncNativeEnvironmentPresentation(value.shoreExit);
    }, /no durable linked native land cue occurred strictly after liquid-exit/u],
    ["landing proof precedes liquid exit", (value) => {
      const effects = value.shoreExit.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues[3] = {
        sequence: "4", tick: "133", entityExternalId: effects.playerExternalId, kind: "land", amount: 0,
      };
      effects.cues[4] = {
        sequence: "5", tick: "134", entityExternalId: effects.playerExternalId, kind: "liquid-exit", amount: 0,
      };
      syncNativeEnvironmentPresentation(value.shoreExit);
    }, /no durable linked native land cue occurred strictly after liquid-exit/u],
    ["dry exit footprint has not cleared the bank face", (value) => {
      value.shoreExit.state.player.position = [4, 33.51, -5.79];
    }, /clear the deterministic bank footprint and minimum support height/u],
    ["dry exit landed at the wrong support height", (value) => {
      value.shoreExit.state.player.position = [4, 32.51, -6];
    }, /clear the deterministic bank footprint and minimum support height/u],
    ["dry exit drifted outside the three-wide bank", (value) => {
      value.shoreExit.state.player.position = [4.51, 33.51, -6];
    }, /clear the deterministic bank footprint and minimum support height/u],
    ["cue reused as dry exit", (value) => {
      value.shoreExit = structuredClone(value.shoreExitCue);
    }, /shoreExit authority tick.*did not advance/u],
    ["forward input still applied at shore settlement", (value) => {
      value.shoreSettled.state.player.input.forwardHeld = true;
      value.shoreSettled.runtime.playerAuthority.pump.lastAppliedMoveZ = 32_767;
    }, /shore settlement did not acknowledge fully neutral input/u],
    ["neutral settlement left the accepted bank", (value) => {
      value.shoreSettled.state.player.position = [4, 33.51, -5.79];
    }, /neutral shore settlement left the deterministic bank footprint/u],
    ["neutral settlement remained above the accepted bank", (value) => {
      value.shoreSettled.state.player.position = [4, 34.25, -6];
    }, /neutral shore settlement left the deterministic bank footprint/u],
    ["neutral settlement remained airborne", (value) => {
      const diagnostic = value.shoreSettled.runtime.playerAuthority.environmentalSurvival;
      diagnostic.r6.contactFlags = 0;
      diagnostic.r6.inLiquid = false;
      diagnostic.r6.headSubmerged = false;
      syncNativeEnvironmentPresentation(value.shoreSettled);
    }, /shore settlement is not dry and grounded/u],
    ["neutral settlement retained motion", (value) => {
      value.shoreSettled.state.player.velocity = [0, 0.09, 0];
    }, /neutral shore settlement retained material velocity/u],
    ["post-cue health damage", (value) => {
      const diagnostic = value.shoreExit.runtime.playerAuthority.environmentalSurvival;
      diagnostic.r6.health = 5;
      diagnostic.r6.lastDamageTick = "135";
      diagnostic.r7.health = 5_000;
      diagnostic.r7.rowRevision = "3";
      diagnostic.r7.combatDomainRevision = "9";
      diagnostic.projectedDamageEvents = 2;
      syncNativeEnvironmentPresentation(value.shoreExit);
    }, /damage continued after surfacing/u],
    ["checkpoint save count unchanged", (value) => {
      const witness = value.checkpointed.runtime.lastCompletedSaveAndQuitNativeCheckpoint;
      witness.persistence.after.saves = witness.persistence.before.saves;
    }, /exactly one native save/u],
    ["retained checkpoint persistence closed", (value) => {
      value.checkpointed.runtime.lastCompletedSaveAndQuitNativeCheckpoint.persistence.after.state = "closed";
    }, /one open persistence session/u],
    ["restored oxygen under-recovery", (value) => {
      value.restored.runtime.playerAuthority.environmentalSurvival.r6.oxygenSeconds = 6.8;
      syncNativeEnvironmentPresentation(value.restored);
    }, /oxygen recovery is not the lawful fixed-step successor/u],
    ["restored oxygen over-recovery", (value) => {
      value.restored.runtime.playerAuthority.environmentalSurvival.r6.oxygenSeconds = 7.2;
      syncNativeEnvironmentPresentation(value.restored);
    }, /oxygen recovery is not the lawful fixed-step successor/u],
    ["restored oxygen reset to maximum", (value) => {
      value.restored.runtime.playerAuthority.environmentalSurvival.r6.oxygenSeconds = 12;
      syncNativeEnvironmentPresentation(value.restored);
    }, /oxygen recovery is not the lawful fixed-step successor/u],
    ["restored body position drift", (value) => {
      value.restored.state.player.position[0] += 0.25;
    }, /did not restore exact native body/u],
    ["restored body velocity drift", (value) => {
      value.restored.state.player.velocity[1] = -0.1;
    }, /did not restore exact native body/u],
    ["restored health drift", (value) => {
      const diagnostic = value.restored.runtime.playerAuthority.environmentalSurvival;
      diagnostic.r6.health = 8;
      diagnostic.r7.health = 8_000;
      syncNativeEnvironmentPresentation(value.restored);
    }, /did not restore exact native body, health, R7 vitals/u],
    ["restored duplicate BWAU cue", (value) => {
      const effects = value.restored.runtime.playerAuthority.environmentalSurvival.effects;
      effects.cues.push({
        sequence: "6", tick: "141", entityExternalId: effects.playerExternalId, kind: "shore-exit", amount: 0,
      });
      effects.total = 6;
      effects.selected = 6;
      effects.lastSequence = "6";
      syncNativeEnvironmentPresentation(value.restored);
    }, /did not restore exact native body, health, R7 vitals, and effect-journal state/u],
    ["restored authority tick regression", (value) => {
      const diagnostic = value.restored.runtime.playerAuthority.environmentalSurvival;
      diagnostic.authorityTick = "354";
      diagnostic.effects.authorityTick = "354";
      value.restored.runtime.playerAuthority.pump.lastAuthorityTick = 354;
      syncNativeEnvironmentPresentation(value.restored);
    }, /first dry authority advance exceeded its bounded restoration window/u],
    ["restored authority advance beyond first-window bound", (value) => {
      const diagnostic = value.restored.runtime.playerAuthority.environmentalSurvival;
      diagnostic.authorityTick = "364";
      diagnostic.effects.authorityTick = "364";
      value.restored.runtime.playerAuthority.pump.lastAuthorityTick = 364;
      syncNativeEnvironmentPresentation(value.restored);
    }, /first dry authority advance exceeded its bounded restoration window/u],
    ["restored R6 entity revision regression", (value) => {
      value.restored.runtime.playerAuthority.environmentalSurvival.r6.entityRevision = "10";
      syncNativeEnvironmentPresentation(value.restored);
    }, /restored R6 entity revision versus pre-save regressed/u],
    ["restored R7 domain revision regression", (value) => {
      value.restored.runtime.playerAuthority.environmentalSurvival.r7.combatDomainRevision = "1";
      syncNativeEnvironmentPresentation(value.restored);
    }, /restored R7 combat-domain revision versus pre-save regressed/u],
    ["restored hurt presentation replay", (value) => {
      value.restored.runtime.playerAuthority.environmentalSurvival.projectedDamageEvents = 1;
      syncNativeEnvironmentPresentation(value.restored);
    }, /replayed native hurt or death presentation counters/u],
    ["restored death presentation replay", (value) => {
      value.restored.runtime.playerAuthority.environmentalSurvival.projectedDamageEvents = 1;
      value.restored.runtime.playerAuthority.environmentalSurvival.projectedDeathEvents = 1;
      syncNativeEnvironmentPresentation(value.restored);
    }, /replayed native hurt or death presentation counters/u],
    ["reload skipped", (value) => {
      value.lifecycle.freshPageReloadBeforeContinue = false;
    }, /fresh page reload/u],
  ];
  for (const [label, mutate, pattern] of cases) {
    const changed = healthyNativeEnvironmentSequence();
    mutate(changed);
    assert.throws(() => assertR5NativeSurvivalEnvironmentSequence(changed), pattern, label);
  }
});

test("native Survival death/respawn sequence seals one Berry custody transfer and reload without replay", () => {
  const input = healthyNativeDeathRespawnSequence();
  const baseline = r5NativeSurvivalDeathRespawnSample(input.baseline, { phase: "baseline", ordinal: 0 });
  const evidence = assertR5NativeSurvivalDeathRespawnSequence(input);
  assert.equal(baseline.respawn.combatantRevision, "0",
    "a fresh native combatant revision of zero is valid evidence");
  assert.equal(evidence.complete, true);
  assert.equal(evidence.parent.generatedDropCount, 1);
  assert.equal(evidence.child.sourceLane, "inventory");
  assert.equal(evidence.child.sourceSlot, 0);
  assert.equal(evidence.child.stack.itemCode, 124);
  assert.equal(evidence.child.stack.count, 3);
  assert.deepEqual(evidence.firstDropObservation, { kind: "creation", ageTicks: "0" });
  assert.equal(evidence.createdProjection.projection.cursor, 1);
  assert.equal(evidence.createdProjection.pump.lastAcknowledgedDeathRespawnSequence, 1);
  assert.equal(evidence.createdProjection.nativeInventory.held, null);
  assert.equal(evidence.respawned.environment.browser.alive, true);
  assert.deepEqual(evidence.createdProjection.environment.browser.position,
    R5_NATIVE_SURVIVAL_WORLD_FIXTURE.expectedSpawn);
  assert.deepEqual(evidence.pausedFreezeStart.dropProjections[0], evidence.preSave.dropProjections[0]);
  assert.equal(evidence.checkpoint.retainedAfterTeardown, true);
  assert.equal(evidence.restored.environment.hydration, "restored");
  assert.equal(evidence.restored.environment.projectedDeathEvents, 0);
  assert.equal(evidence.restored.dropProjections[0].native.extractionRevision, "1",
    "a fresh runtime may restart extraction while preserving the durable drop identity and transform");
  assert.deepEqual(evidence.restoredDropSuccessor, { tickDelta: "0", kind: "exact" });
  assert.deepEqual(evidence.restored.respawn.latestDeathRespawn, evidence.parent);

  const cameraOnlyRestoredCursorLead = healthyNativeDeathRespawnSequence();
  Object.assign(cameraOnlyRestoredCursorLead.restored.runtime.playerAuthority.pump, {
    lastExtractionRevision: 3,
    extractionCalls: 3,
    viewExtractionCalls: 2,
  });
  const cursorLeadEvidence = assertR5NativeSurvivalDeathRespawnSequence(cameraOnlyRestoredCursorLead);
  assert.equal(cursorLeadEvidence.restored.environment.extractionRevision, "1");
  assert.equal(cursorLeadEvidence.restored.nativeInventory.extractionRevision, "1");
  assert.equal(cursorLeadEvidence.restored.dropProjections[0].native.extractionRevision, "1");
  assert.equal(cursorLeadEvidence.restored.pump.lastExtractionRevision, 3,
    "fresh Continue may publish later camera-only view cursors without replaying player/drop authority");

  const descendant = assertR5NativeSurvivalDeathRespawnSequence(
    healthyNativeDeathRespawnSequence({ firstObservationAge: 2 }),
  );
  assert.deepEqual(descendant.firstDropObservation, { kind: "descendant", ageTicks: "2" },
    "an async first BWR6 observation may be a bounded lawful descendant of immutable BWE7 creation");

  const restoredSuccessor = assertR5NativeSurvivalDeathRespawnSequence(
    healthyNativeDeathRespawnSequence({ restoredAdvanceTicks: 3 }),
  );
  assert.deepEqual(restoredSuccessor.restoredDropSuccessor, { tickDelta: "3", kind: "successor" },
    "fresh Continue may lawfully advance a bounded number of fixed steps");
});

test("native Survival death/respawn sequence rejects custody, motion, freeze, and replay weakening", () => {
  const cases = [
    ["wrong starter count", (value) => {
      value.baseline.state.inventory.held.count = 2;
    }, /exact native Berry x3 starter stack/u],
    ["wrong native starter count", (value) => {
      value.baseline.runtime.playerAuthority.nativeInventory.held.count = 2;
    }, /exact native Berry x3 starter stack/u],
    ["legacy browser drop at baseline", (value) => {
      value.baseline.state.drops.push({ item: 1, count: 1, rustEntityId: null });
    }, /baseline already contains native death\/respawn history/u],
    ["extra legacy browser drop at creation", (value) => {
      value.createdProjection.state.drops.push({ item: 1, count: 1, rustEntityId: null });
    }, /browser or native drop outside the sole BWE7 Berry child/u],
    ["parent child cardinality mismatch", (value) => {
      value.createdProjection.runtime.playerAuthority.nativeRespawn.latestDeathRespawn.generatedDropCount = 2;
    }, /child cardinality disagrees/u],
    ["wrong Berry count in native child", (value) => {
      value.createdProjection.runtime.playerAuthority.nativeRespawn.latestDeathRespawn.drops[0].stack.count = 2;
    }, /browser death drop changed the exact native stack/u],
    ["creation transform no longer joins BWE7", (value) => {
      value.createdProjection.runtime.playerAuthority.nativeDropTransforms.transforms[0].velocity.x = 1.25;
      syncNativeDeathDropPresentation(value.createdProjection);
    }, /strict R6 descendant at the exact BWE7 creation transform/u],
    ["creation entity uses impossible R6 revision zero", (value) => {
      value.createdProjection.runtime.playerAuthority.nativeDropTransforms.transforms[0].entityRevision = "0";
    }, /strict R6 descendant at the exact BWE7 creation transform/u],
    ["stale drop-frame authority envelope", (value) => {
      value.createdProjection.runtime.playerAuthority.nativeDropTransforms.authorityTick = "149";
    }, /drop frame is stale versus its BWX0\/environment\/pump envelope/u],
    ["stale drop-frame extraction envelope", (value) => {
      value.createdProjection.runtime.playerAuthority.nativeDropTransforms.extractionRevision = "149";
    }, /drop frame is stale versus its BWX0\/environment\/pump envelope/u],
    ["drop age differs from creation tick", (value) => {
      value.createdProjection.runtime.playerAuthority.nativeDropTransforms.transforms[0].ageTicks = "1";
      syncNativeDeathDropPresentation(value.createdProjection);
    }, /age does not equal authority tick minus immutable creation tick/u],
    ["death drop far from predecessor", (value) => {
      value.lastAliveSubmerged.state.player.position = [12, 33, -7];
    }, /not near the last alive submerged/u],
    ["respawn off frozen spawn", (value) => {
      value.createdProjection.state.player.position[0] += 0.25;
    }, /frozen RUST-SWIM-002 spawn/u],
    ["second projected death", (value) => {
      const diagnostic = value.createdProjection.runtime.playerAuthority.environmentalSurvival;
      diagnostic.projectedDeathEvents = 2;
      syncNativeEnvironmentPresentation(value.createdProjection);
    }, /exactly one projected death/u],
    ["incomplete native respawn marker", (value) => {
      value.createdProjection.runtime.playerAuthority.nativeRespawn.lastRespawnSequence = null;
    }, /lifecycle contradicts public combat state/u],
    ["forward input survives death", (value) => {
      value.dropSettledStart.state.player.input.forwardHeld = true;
    }, /input fully neutral/u],
    ["native movement survives death", (value) => {
      value.dropSettledStart.runtime.playerAuthority.pump.lastAppliedMoveZ = 1;
    }, /input fully neutral/u],
    ["projection cursor skips", (value) => {
      value.createdProjection.runtime.playerAuthority.playerDeathRespawnProjection.cursor = 2;
    }, /one contiguous browser cursor/u],
    ["checkpoint absent", (value) => {
      value.createdProjection.runtime.playerAuthority.playerDeathRespawnCheckpoint = null;
    }, /one exact native checkpoint witness/u],
    ["finalize remains pending", (value) => {
      value.createdProjection.runtime.playerAuthority.playerDeathRespawnFinalize = { schema: 1 };
    }, /drain its plan\/finalize/u],
    ["respawn plan remains pending", (value) => {
      value.createdProjection.runtime.playerAuthority.playerRespawnPlanPending = true;
    }, /drain its plan\/finalize/u],
    ["pump acknowledgement mismatches", (value) => {
      value.createdProjection.runtime.playerAuthority.pump.lastAcknowledgedDeathRespawnSequence = 0;
    }, /one exact pump acknowledgement/u],
    ["slot zero not cleared", (value) => {
      value.createdProjection.state.inventory.held = { item: 124, count: 3 };
    }, /clear exact starter slot zero/u],
    ["native child not projected", (value) => {
      value.createdProjection.state.drops = [];
    }, /not represented once in the browser drop projection/u],
    ["playing age does not advance", (value) => {
      const transform = value.respawned.runtime.playerAuthority.nativeDropTransforms.transforms[0];
      const previous = value.dropSettledStart.runtime.playerAuthority.nativeDropTransforms.transforms[0];
      transform.ageTicks = previous.ageTicks;
      syncNativeDeathDropPresentation(value.respawned);
    }, /age does not equal authority tick minus immutable creation tick/u],
    ["playing motion teleports", (value) => {
      value.respawned.runtime.playerAuthority.nativeDropTransforms.transforms[0].position.x = 20;
      syncNativeDeathDropPresentation(value.respawned);
    }, /bounded fixed-step motion envelope/u],
    ["playing yaw is not fixed-step", (value) => {
      value.respawned.runtime.playerAuthority.nativeDropTransforms.transforms[0].yawRadians += 0.1;
      syncNativeDeathDropPresentation(value.respawned);
    }, /bounded fixed-step rotation/u],
    ["playing tick and age deltas disagree", (value) => {
      const frame = value.respawned.runtime.playerAuthority.nativeDropTransforms;
      frame.authorityTick = String(Number(frame.authorityTick) + 1);
      const environment = value.respawned.runtime.playerAuthority.environmentalSurvival;
      environment.authorityTick = frame.authorityTick;
      environment.effects.authorityTick = frame.authorityTick;
      value.respawned.runtime.playerAuthority.pump.lastAuthorityTick = Number(frame.authorityTick);
      syncNativeEnvironmentPresentation(value.respawned);
    }, /age does not equal authority tick minus immutable creation tick/u],
    ["first freeze witness is not paused", (value) => {
      value.pausedFreezeStart.state.state = "playing";
    }, /two paused, pump-drained/u],
    ["first freeze witness pump is queued", (value) => {
      value.pausedFreezeStart.runtime.playerAuthority.pump.queuedAdvances = 1;
    }, /two paused, pump-drained/u],
    ["paused drop transform changes", (value) => {
      value.preSave.runtime.playerAuthority.nativeDropTransforms.transforms[0].position.x += 0.001;
      syncNativeDeathDropPresentation(value.preSave);
    }, /paused no-simulation snapshots did not freeze/u],
    ["reload replays death presentation", (value) => {
      const diagnostic = value.restored.runtime.playerAuthority.environmentalSurvival;
      diagnostic.projectedDamageEvents = 1;
      diagnostic.projectedDeathEvents = 1;
      syncNativeEnvironmentPresentation(value.restored);
    }, /replayed native hurt or death presentation/u],
    ["reload cursor advances", (value) => {
      value.restored.runtime.playerAuthority.playerDeathRespawnProjection.cursor = 2;
    }, /preserve the exact death cursor/u],
    ["reload drop transform changes", (value) => {
      value.restored.runtime.playerAuthority.nativeDropTransforms.transforms[0].position.z -= 0.01;
      syncNativeDeathDropPresentation(value.restored);
    }, /zero-step restored native drop changed/u],
    ["reload yaw advances without ticks", (value) => {
      value.restored.runtime.playerAuthority.nativeDropTransforms.transforms[0].yawRadians += 0.1;
      syncNativeDeathDropPresentation(value.restored);
    }, /zero-step restored native drop changed/u],
    ["reload authority tick regresses", (value) => {
      const diagnostic = value.restored.runtime.playerAuthority.environmentalSurvival;
      diagnostic.authorityTick = "159";
      diagnostic.effects.authorityTick = "159";
      value.restored.runtime.playerAuthority.pump.lastAuthorityTick = 159;
      value.restored.runtime.playerAuthority.nativeDropTransforms.authorityTick = "159";
      syncNativeEnvironmentPresentation(value.restored);
    }, /age does not equal authority tick minus immutable creation tick/u],
    ["reload drop entity revision regresses", (value) => {
      value.restored.runtime.playerAuthority.nativeDropTransforms.transforms[0].entityRevision = "9";
    }, /restored death drop.*entityRevision regressed/u],
    ["reload extraction restarts at zero", (value) => {
      value.restored.runtime.playerAuthority.nativeDropTransforms.extractionRevision = "0";
    }, /native drop extraction revision must be positive/u],
    ["drop age exceeds exact browser range", (value) => {
      value.createdProjection.runtime.playerAuthority.nativeDropTransforms.transforms[0].ageTicks =
        String(Number.MAX_SAFE_INTEGER + 1);
    }, /age exceeds exact browser-number range/u],
    ["hard reload skipped", (value) => {
      value.lifecycle.freshPageReloadBeforeContinue = false;
    }, /hard reload/u],
  ];
  for (const [label, mutate, pattern] of cases) {
    const changed = healthyNativeDeathRespawnSequence();
    mutate(changed);
    assert.throws(() => assertR5NativeSurvivalDeathRespawnSequence(changed), pattern, label);
  }

  const staleDescendantRevision = healthyNativeDeathRespawnSequence({ firstObservationAge: 2 });
  staleDescendantRevision.createdProjection.runtime.playerAuthority.nativeDropTransforms
    .transforms[0].entityRevision = "0";
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnSequence(staleDescendantRevision),
    /not a strict descendant of the BWE7 spatial revision/u,
  );
  const descendantYawDrift = healthyNativeDeathRespawnSequence({ firstObservationAge: 2 });
  descendantYawDrift.createdProjection.runtime.playerAuthority.nativeDropTransforms
    .transforms[0].yawRadians += 0.1;
  syncNativeDeathDropPresentation(descendantYawDrift.createdProjection);
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnSequence(descendantYawDrift),
    /bounded fixed-step rotation/u,
  );
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnSequence(
      healthyNativeDeathRespawnSequence({ firstObservationAge: 9 }),
    ),
    /short positive fixed-step interval/u,
    "the first async BWR6 descendant must remain within a tight observation window",
  );

  const advancedReloadTeleport = healthyNativeDeathRespawnSequence({ restoredAdvanceTicks: 3 });
  advancedReloadTeleport.restored.runtime.playerAuthority.nativeDropTransforms.transforms[0].position.x = 20;
  syncNativeDeathDropPresentation(advancedReloadTeleport.restored);
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnSequence(advancedReloadTeleport),
    /bounded fixed-step motion envelope/u,
  );
  const advancedReloadYawDrift = healthyNativeDeathRespawnSequence({ restoredAdvanceTicks: 3 });
  advancedReloadYawDrift.restored.runtime.playerAuthority.nativeDropTransforms.transforms[0].yawRadians += 0.1;
  syncNativeDeathDropPresentation(advancedReloadYawDrift.restored);
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnSequence(advancedReloadYawDrift),
    /bounded fixed-step rotation/u,
  );
  const advancedReloadTickDrift = healthyNativeDeathRespawnSequence({ restoredAdvanceTicks: 3 });
  const driftFrame = advancedReloadTickDrift.restored.runtime.playerAuthority.nativeDropTransforms;
  driftFrame.authorityTick = String(Number(driftFrame.authorityTick) + 1);
  const driftEnvironment = advancedReloadTickDrift.restored.runtime.playerAuthority.environmentalSurvival;
  driftEnvironment.authorityTick = driftFrame.authorityTick;
  driftEnvironment.effects.authorityTick = driftFrame.authorityTick;
  advancedReloadTickDrift.restored.runtime.playerAuthority.pump.lastAuthorityTick = Number(driftFrame.authorityTick);
  syncNativeEnvironmentPresentation(advancedReloadTickDrift.restored);
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnSequence(advancedReloadTickDrift),
    /age does not equal authority tick minus immutable creation tick/u,
  );
});

test("native Survival checkpoint evidence rejects transient live-host and witnessless title observations", () => {
  const input = healthyNativeEnvironmentSequence();
  const transientLiveHost = structuredClone(input.preSave);
  transientLiveHost.state.state = "title";
  transientLiveHost.runtime.operationsBlocked = true;
  transientLiveHost.runtime.manager.host.nativePersistence.saves += 1;
  transientLiveHost.runtime.manager.host.nativePersistence.platformOperations += 1;
  transientLiveHost.runtime.manager.host.nativePersistence.lastCheckpointId = "checkpoint-1";
  assert.throws(
    () => r5NativeSurvivalCheckpointEvidence(input.preSave, transientLiveHost),
    /completed blocked title teardown/u,
    "the former transient live-host fallback must not satisfy checkpoint acceptance",
  );

  const witnesslessTeardown = structuredClone(transientLiveHost);
  witnesslessTeardown.runtime.manager.host = null;
  assert.throws(
    () => r5NativeSurvivalCheckpointEvidence(input.preSave, witnesslessTeardown),
    /retained no exact checkpoint witness/u,
    "a completed teardown without its immutable witness must fail closed",
  );

  const retainedBeforeTeardown = structuredClone(input.checkpointed);
  retainedBeforeTeardown.runtime.manager.host = structuredClone(input.preSave.runtime.manager.host);
  assert.throws(
    () => r5NativeSurvivalCheckpointEvidence(input.preSave, retainedBeforeTeardown),
    /completed blocked title teardown/u,
    "the retained witness must not be treated as post-teardown while the manager host remains live",
  );
});

test("native Survival checkpoint evidence survives exact runtime teardown through one retained witness", () => {
  const { before, title } = retainedCheckpointTitlePair();
  const evidence = r5NativeSurvivalCheckpointEvidence(before, title);
  assert.equal(title.runtime.manager.host, null);
  assert.equal(title.runtime.playerAuthority.environmentalSurvival, null);
  assert.equal(evidence.retainedAfterTeardown, true);
  assert.equal(evidence.worldId, "world-1");
  assert.equal(evidence.checkpointId, "checkpoint-1");
  assert.equal(evidence.checkpointHash, "ab".repeat(16));
  assert.equal(evidence.savesAfter, evidence.savesBefore + 1);
  assert.equal(evidence.platformOperationsAfter, evidence.platformOperationsBefore + 1);
  assert.deepEqual(evidence.checkpointed.r6, evidence.before.r6);
  assert.deepEqual(evidence.checkpointed.r7, evidence.before.r7);

  const autosaveSuccessor = retainedCheckpointTitlePair();
  const autosaveWitness = autosaveSuccessor.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint;
  const sampledPersistence = autosaveSuccessor.before.runtime.manager.host.nativePersistence;
  autosaveWitness.persistence.before.saves += 1;
  autosaveWitness.persistence.before.platformOperations += 1;
  autosaveWitness.persistence.before.requestBytes += 40;
  autosaveWitness.persistence.before.responseBytes += 20;
  autosaveWitness.persistence.before.lastCheckpointId = "checkpoint-autosave";
  autosaveWitness.persistence.after.saves = autosaveWitness.persistence.before.saves + 1;
  autosaveWitness.persistence.after.platformOperations = autosaveWitness.persistence.before.platformOperations
    + autosaveWitness.checkpoint.commits;
  autosaveWitness.persistence.after.requestBytes = autosaveWitness.persistence.before.requestBytes
    + autosaveWitness.checkpoint.requestBytes;
  autosaveWitness.persistence.after.responseBytes = autosaveWitness.persistence.before.responseBytes
    + autosaveWitness.checkpoint.responseBytes;
  assert.equal(sampledPersistence.saves + 1, autosaveWitness.persistence.before.saves);
  const autosaveEvidence = r5NativeSurvivalCheckpointEvidence(
    autosaveSuccessor.before,
    autosaveSuccessor.title,
  );
  assert.equal(autosaveEvidence.savesBefore, sampledPersistence.saves + 1);

  for (const [label, mutate, pattern] of [
    ["stale catalog binding", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.binding.catalogWorldId = "world-stale";
    }, /changed catalog, native-world.*runtime-session custody/u],
    ["wrong active universe", (value) => {
      value.before.runtime.activeUniverseId = "universe-other";
    }, /changed catalog, native-world.*runtime-session custody/u],
    ["wrong active location", (value) => {
      value.before.runtime.activeLocationId = "the-world-below";
    }, /changed catalog, native-world.*runtime-session custody/u],
    ["wrong active session", (value) => {
      value.before.runtime.activeSessionId = "runtime-session-other";
      value.before.runtime.playerAuthority.runtimeSessionId = "runtime-session-other";
    }, /changed catalog, native-world.*runtime-session custody/u],
    ["split player/runtime session", (value) => {
      value.before.runtime.playerAuthority.runtimeSessionId = "runtime-session-other";
    }, /does not expose one exact active world, universe, location, and session binding/u],
    ["wrong pre-save session", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.persistence.before.saves -= 1;
    }, /does not bind a lawful predecessor.*pre-save persistence session/u],
    ["pre-save platform counter regression", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.persistence.before.platformOperations -= 1;
    }, /does not bind a lawful predecessor.*pre-save persistence session/u],
    ["same save count with rewritten checkpoint head", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.persistence.before.lastCheckpointId = "checkpoint-rewritten";
    }, /does not bind a lawful predecessor.*pre-save persistence session/u],
    ["recovery between sampled pause and checkpoint", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.persistence.before.recoveries += 1;
    }, /does not bind a lawful predecessor.*pre-save persistence session/u],
    ["migration retry between sampled pause and checkpoint", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.persistence.before.legacyMigrationRetries += 1;
    }, /does not bind a lawful predecessor.*pre-save persistence session/u],
    ["persistence error between sampled pause and checkpoint", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.persistence.before.lastError = {
        code: "platform",
        message: "intervening autosave failed",
      };
    }, /does not bind a lawful predecessor.*pre-save persistence session/u],
    ["rewritten terminal authority", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.terminalEnvironmentalSurvival.r6.oxygenSeconds -= 0.25;
    }, /environmental state changed.*retained checkpoint witness/u],
    ["checkpoint id mismatch", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.checkpoint.checkpointId = "checkpoint-other";
    }, /does not prove its exact durable commit deltas/u],
    ["platform operation mismatch", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.persistence.after.platformOperations += 1;
    }, /does not prove its exact durable commit deltas/u],
    ["request byte mismatch", (value) => {
      value.title.runtime.lastCompletedSaveAndQuitNativeCheckpoint.persistence.after.requestBytes += 1;
    }, /does not prove its exact durable commit deltas/u],
  ]) {
    const changed = retainedCheckpointTitlePair();
    mutate(changed);
    assert.throws(
      () => r5NativeSurvivalCheckpointEvidence(changed.before, changed.title),
      pattern,
      label,
    );
  }
});

test("native Survival terminal gate includes errors and owned-process cleanup", () => {
  const environmentEvidence = assertR5NativeSurvivalEnvironmentSequence(healthyNativeEnvironmentSequence());
  const result = {
    status: "passed",
    environmentEvidence,
    coverage: {
      exactSubmergeAndOxygenDrain: "passed",
      exactNativeHealthReduction: "passed",
      noTypeScriptDamageAuthoring: "passed",
      surfaceAndShoreExit: "passed",
      nativeCheckpointBeforeSave: "passed",
      saveQuitReloadContinueRestoration: "passed",
      r6R7Parity: "passed",
    },
    routeErrors: [],
    consoleErrors: [],
    pageErrors: [],
    runtimeErrors: [],
    cleanup: {
      browserClosed: true,
      serverStopped: true,
      profileRemoved: true,
      browserMutexReleased: true,
      sourceUnchanged: true,
    },
  };
  assert.equal(assertR5NativeSurvivalEnvironmentTerminalGate(result), true);
  const error = structuredClone(result);
  error.runtimeErrors.push("native parity failure");
  assert.throws(() => assertR5NativeSurvivalEnvironmentTerminalGate(error), /Runtime emitted 1 errors/u);
  const leaked = structuredClone(result);
  leaked.cleanup.profileRemoved = false;
  assert.throws(() => assertR5NativeSurvivalEnvironmentTerminalGate(leaked), /cleanup gate failed/u);
  const missing = structuredClone(result);
  missing.coverage.r6R7Parity = "not-exercised";
  assert.throws(() => assertR5NativeSurvivalEnvironmentTerminalGate(missing), /r6R7Parity.*did not pass/u);
  const missingCueAudit = structuredClone(result);
  delete missingCueAudit.environmentEvidence.shoreExit.observedCueCount;
  assert.throws(() => assertR5NativeSurvivalEnvironmentTerminalGate(missingCueAudit), /did not retain exactly one observed shore-exit cue/u);
  const missingTeardownWitness = structuredClone(result);
  missingTeardownWitness.environmentEvidence.checkpoint.retainedAfterTeardown = false;
  assert.throws(
    () => assertR5NativeSurvivalEnvironmentTerminalGate(missingTeardownWitness),
    /did not prove its checkpoint after completed runtime teardown/u,
  );
  const missingLandingAudit = structuredClone(result);
  delete missingLandingAudit.environmentEvidence.shoreExit.acceptedLanding;
  assert.throws(
    () => assertR5NativeSurvivalEnvironmentTerminalGate(missingLandingAudit),
    /did not retain the accepted liquid-exit and post-exit land cues/u,
  );
});

test("native Survival death/respawn terminal gate retains exact child, coverage, and cleanup", () => {
  const deathRespawnEvidence = assertR5NativeSurvivalDeathRespawnSequence(
    healthyNativeDeathRespawnSequence(),
  );
  const result = {
    status: "passed",
    deathRespawnEvidence,
    coverage: {
      lethalNativeDrowning: "passed",
      exactlyOneProjectedDeath: "passed",
      automaticNativeRespawnAtFrozenSpawn: "passed",
      neutralInputAfterDeath: "passed",
      exactBwe7CheckpointProjectionAndAck: "passed",
      slotZeroCleared: "passed",
      exactBerryDeathDrop: "passed",
      saveQuitReloadContinueRestoration: "passed",
      noDeathReplayAfterReload: "passed",
      deathDropPickup: "not-exercised-not-claimed",
    },
    routeErrors: [],
    consoleErrors: [],
    pageErrors: [],
    runtimeErrors: [],
    cleanup: {
      browserClosed: true,
      serverStopped: true,
      profileRemoved: true,
      browserMutexReleased: true,
      sourceUnchanged: true,
    },
  };
  assert.equal(assertR5NativeSurvivalDeathRespawnTerminalGate(result), true);
  assert.equal(result.coverage.deathDropPickup, "not-exercised-not-claimed");

  const runtimeError = structuredClone(result);
  runtimeError.runtimeErrors.push("native death projection failure");
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnTerminalGate(runtimeError),
    /Runtime emitted 1 errors/u,
  );
  const leaked = structuredClone(result);
  leaked.cleanup.browserMutexReleased = false;
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnTerminalGate(leaked),
    /cleanup gate failed/u,
  );
  const missingCoverage = structuredClone(result);
  missingCoverage.coverage.noDeathReplayAfterReload = "not-exercised";
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnTerminalGate(missingCoverage),
    /noDeathReplayAfterReload.*did not pass/u,
  );
  const pickupOverclaim = structuredClone(result);
  pickupOverclaim.coverage.deathDropPickup = "passed";
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnTerminalGate(pickupOverclaim),
    /overclaims death-drop pickup/u,
  );
  const wrongChild = structuredClone(result);
  wrongChild.deathRespawnEvidence.child.stack.count = 2;
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnTerminalGate(wrongChild),
    /exact Berry x3 death child/u,
  );
  const missingCheckpoint = structuredClone(result);
  missingCheckpoint.deathRespawnEvidence.checkpoint.retainedAfterTeardown = false;
  assert.throws(
    () => assertR5NativeSurvivalDeathRespawnTerminalGate(missingCheckpoint),
    /checkpoint after runtime teardown/u,
  );
});

test("native Survival browser scenario is runnable through natural terrain and public controls only", () => {
  const source = readFileSync(path.join(ROOT, "scripts", "verify-rust-r5-player-browser.mjs"), "utf8");
  assert.match(source, /options\.scenario === "native-survival-environment"/u);
  assert.match(source, /seed: "RUST-SWIM-002"/u);
  assert.match(source, /await keyDown\(R5_NATIVE_SURVIVAL_WORLD_FIXTURE\.waterApproach\)/u);
  assert.match(source, /await keyDown\("Shift"\)/u);
  assert.match(
    source,
    /native-pre-hit-ascent-window[\s\S]*await keyUp\("Shift"\)[\s\S]*await keyDown\("Control"\)[\s\S]*await keyDown\("Space"\)[\s\S]*native-pre-hit-ascent-acknowledged[\s\S]*native-first-drowning-damage[\s\S]*await keyDown\(R5_NATIVE_SURVIVAL_WORLD_FIXTURE\.shoreReturn\)[\s\S]*native-surface-recovery/u,
  );
  assert.match(
    source,
    /awaitEnvironmentalAuthority\("native-surface-recovery"[\s\S]{0,1600}return !sample\.r6\.headSubmerged[\s\S]*sample\.r6\.oxygenSeconds > damaged\.r6\.oxygenSeconds[\s\S]*sample\.r6\.lastDamageTick === damaged\.r6\.lastDamageTick[\s\S]*sample\.r7\.health === damaged\.r7\.health[\s\S]*sample\.projectedDeathEvents === damaged\.projectedDeathEvents/u,
  );
  assert.doesNotMatch(
    source,
    /awaitEnvironmentalAuthority\("native-surface-recovery"[\s\S]{0,300}sample\.r6\.inLiquid/u,
    "surface recovery must accept a public extraction that batches directly from submerged to dry",
  );
  assert.match(
    source,
    /native-shore-exit-cue[\s\S]*r5NativeSurvivalShoreExitCueEvidence[\s\S]*await keyUp\("Control"\)[\s\S]*native-shore-exit",[\s\S]*r5NativeSurvivalShoreLandingJournal\(damaged, sample[\s\S]*postExitLandings[\s\S]*shoreY >= mantleBounds\.minimumY[\s\S]*await keyUp\(R5_NATIVE_SURVIVAL_WORLD_FIXTURE\.shoreReturn\)[\s\S]*await keyUp\("Space"\)[\s\S]*native-shore-settled[\s\S]*R5_NATIVE_SURVIVAL_CONTACT\.grounded[\s\S]*settledY >= mantleBounds\.minimumY && settledY <= mantleBounds\.maximumY[\s\S]*Math\.hypot/u,
  );
  assert.match(
    source,
    /shoreCueObservedAtSurface[\s\S]*r5NativeSurvivalShoreExitCueEvidence\(environmentSnapshots\.damaged, environmentSnapshots\.surfaced\)[\s\S]*await keyUp\("Control"\)[\s\S]*if \(shoreCueObservedAtSurface\) await capture\("native-surface-recovery"\)/u,
    "a shore cue batched into surface recovery must release sprint before screenshot latency",
  );
  assert.doesNotMatch(
    source,
    /native-shore-exit-cue[\s\S]{0,1200}R5_NATIVE_SURVIVAL_CONTACT\.shoreBoosted/u,
  );
  assert.match(
    source,
    /if \(shouldAdvance\) await advanceAuthority\(advanceMilliseconds\);[\s\S]*if \(!r5NativeSurvivalProjectionSettled\(snapshot\)\)/u,
  );
  assert.match(source, /observeNativeSaveCheckpoint\(paused\)[\s\S]*Save & Quit to Title/u);
  assert.match(
    source,
    /lastCompletedSaveAndQuitNativeCheckpoint[\s\S]*r5NativeSurvivalCheckpointEvidence\(beforeSaveSnapshot, observed\)/u,
    "Save & Quit acceptance must use the retained post-teardown native checkpoint witness",
  );
  assert.match(
    source,
    /completedTeardown = observed[\s\S]{0,500}manager\?\.host === null[\s\S]{0,500}!completedTeardown \|\| retained === null/u,
    "the live observer must wait for title, blocking, host teardown, and the retained witness",
  );
  assert.doesNotMatch(
    source,
    /persistence\?\.state === "open" && persistence\?\.saves/u,
    "the transient live-host checkpoint fallback must remain removed",
  );
  assert.match(
    source,
    /let reloaded = await assertAuthority\("fresh-continue-reload-ready"\);[\s\S]*environmentSnapshots\.restored = reloaded;/u,
  );
  assert.doesNotMatch(source, /environmentSnapshots\.restored = resumed/u);
  assert.match(source, /assertR5NativeSurvivalEnvironmentSequence\(\{/u);
  assert.match(source, /assertR5NativeSurvivalEnvironmentTerminalGate\(result\)/u);
  assert.doesNotMatch(source, /synthetic-water-hook|setBlock.*RUST-SWIM-002|terrain.*mutation.*RUST-SWIM-002/iu);
});

test("native Survival lethal scenario uses public controls, frozen pause evidence, and no pickup claim", () => {
  // Normalize only this structural inspection, never artifact/checksum bytes.
  const source = readFileSync(path.join(ROOT, "scripts", "verify-rust-r5-player-browser.mjs"), "utf8").replace(/\r\n/gu, "\n");
  const scenarioMatch = source.match(
    /\} else if \(options\.scenario === "native-survival-death-respawn"\) \{([\s\S]*?)\n    \} else \{\n      await assertAuthority\("walk-baseline"\)/u,
  );
  assert.ok(scenarioMatch, "the native death/respawn branch must remain a runnable third scenario");
  const scenario = scenarioMatch[1];
  assert.match(
    scenario,
    /await keyDown\(R5_NATIVE_SURVIVAL_WORLD_FIXTURE\.waterApproach\)[\s\S]*native-death-water-entry[\s\S]*await keyDown\("Shift"\)[\s\S]*native-death-head-submerged[\s\S]*await keyUp\(R5_NATIVE_SURVIVAL_WORLD_FIXTURE\.waterApproach\)/u,
  );
  assert.match(
    scenario,
    /native-lethal-drowning-respawn[\s\S]*sample\.projectedDeathEvents === 1[\s\S]*lastAcknowledgedDeathRespawnReceiptHash === parent\.receiptHash/u,
  );
  assert.match(scenario, /await capture\("native-death-submerged"\)/u);
  assert.match(scenario, /await capture\("native-death-respawn-created-drop"\)/u);
  assert.match(scenario, /nativeDeathDropProjectionEvolves[\s\S]*native-death-respawn-drop-motion/u);
  assert.match(
    scenario,
    /let shouldAdvanceDropMotion = true;[\s\S]*if \(shouldAdvanceDropMotion\) await advanceAuthority\(\);[\s\S]*if \(!r5NativeSurvivalProjectionSettled\(snapshot\)\) \{[\s\S]*shouldAdvanceDropMotion = false;[\s\S]*continue;[\s\S]*shouldAdvanceDropMotion = true;/u,
    "the drop-motion loop must drain an unsettled extraction before issuing another fixed step",
  );
  assert.doesNotMatch(scenario, /sameNativeDeathDropIdentityAndTransform|velocity[^\n]*<= 0\.001/u,
    "playing-state motion must not pretend a rotating native drop is frozen");
  assert.doesNotMatch(
    scenario,
    /setBlock|setHealth|applyDamage|projectedDeathEvents\s*=(?!=)|latestDeathRespawn\s*=(?!=)/iu,
    "the lethal path must observe native drowning without synthetic state authorship",
  );
  assert.match(
    source,
    /deathRespawnSnapshots\.pausedFreezeStart = paused;[\s\S]*awaitPausedTerminalPose\("paused-death-drop-freeze"/u,
    "the save witness must contain two distinct paused, pump-drained reads",
  );
  assert.match(
    source,
    /if \(deathRespawnSnapshots && !r5NativeSurvivalProjectionSettled\(reloaded\)\)[\s\S]*fresh-continue-death-drop-drain[\s\S]*did not drain its BWX0\/environment\/pump\/drop-frame extraction envelope/u,
    "fresh Continue must poll its restored extraction envelope without issuing another advance",
  );
  assert.match(source, /deathRespawnSnapshots\.restored = reloaded;[\s\S]*assertR5NativeSurvivalDeathRespawnSequence/u);
  assert.match(source, /assertR5NativeSurvivalDeathRespawnTerminalGate\(result\)/u);
  assert.match(source, /deathDropPickup: "not-exercised-not-claimed"/u);
  assert.match(source, /Death-drop pickup[^\n]*remain outside the claim/u);
  assert.doesNotMatch(source, /deathDropPickup: "passed"/u);
  assert.match(source, /native-survival-environment\|native-survival-death-respawn/u);
});

test("R5 verifier CLI requires an exact 32-byte lowercase artifact hash and work output", (t) => {
  const fixture = createCurrentSourceCandidateFixture(t);
  // CLI root discovery and output validation use real fixture directories.
  writeJson(path.join(fixture.root, "package.json"), { name: "blockwild-r5-cli-fixture", private: true });
  mkdirSync(path.join(fixture.root, "docs"), { recursive: true });
  mkdirSync(path.join(fixture.root, "work"), { recursive: true });
  const parsed = parseR5BrowserOptions(argv(
    "--expected-artifact-hash", fixture.hash,
    "--output", "work/r5-verifier-unit",
    "--engine-dir", "public/engine-locator-candidate",
    "--base-url", "http://127.0.0.1:5173/",
    "--timeout-ms", "30000",
  ), { cwd: fixture.root });
  assert.equal(parsed.repositoryRoot, realpathSync(fixture.root));
  assert.equal(parsed.engineDirectory, fixture.candidateRoot);
  assert.equal(parsed.expectedArtifactHash, fixture.hash);
  assert.equal(parsed.outputDirectory, path.join(fixture.root, "work", "r5-verifier-unit"));
  assert.equal(parsed.baseUrl, "http://127.0.0.1:5173");
  assert.equal(parsed.timeoutMilliseconds, 30_000);
  assert.equal(parsed.scenario, "movement-persistence");

  const environment = parseR5BrowserOptions(argv(
    "--expected-artifact-hash", fixture.hash,
    "--output", "work/r5-verifier-environment-unit",
    "--engine-dir", "public/engine-locator-candidate",
    "--scenario", "native-survival-environment",
  ), { cwd: fixture.root });
  assert.equal(environment.scenario, "native-survival-environment");
  const deathRespawn = parseR5BrowserOptions(argv(
    "--expected-artifact-hash", fixture.hash,
    "--output", "work/r5-verifier-death-respawn-unit",
    "--engine-dir", "public/engine-locator-candidate",
    "--scenario", "native-survival-death-respawn",
  ), { cwd: fixture.root });
  assert.equal(deathRespawn.scenario, "native-survival-death-respawn");
  assert.deepEqual(R5_PLAYER_BROWSER_SCENARIOS, [
    "movement-persistence",
    "native-survival-environment",
    "native-survival-death-respawn",
  ]);
  assert.deepEqual(R5_NATIVE_SURVIVAL_WORLD_FIXTURE, {
    name: "R5 Native Survival Environment Acceptance",
    seed: "RUST-SWIM-002",
    mode: "survival",
    expectedSpawn: [4, 38.51, -10],
    waterApproach: "s",
    shoreReturn: "w",
    shoreMantleBounds: {
      minimumX: 3.5,
      maximumX: 4.5,
      minimumY: 33.49,
      maximumY: 33.7,
      minimumZ: -6.2,
      maximumZ: -5.8,
    },
  });
  assert.throws(() => parseR5BrowserOptions(argv(
    "--expected-artifact-hash", fixture.hash,
    "--output", "work/r5-verifier-environment-unit",
    "--engine-dir", "public/engine-locator-candidate",
    "--scenario", "synthetic-water-hook",
  ), { cwd: fixture.root }), /scenario must be one of/u);

  for (const invalid of ["a".repeat(32), "A".repeat(64), "g".repeat(64), `${"a".repeat(64)}0`]) {
    assert.throws(() => parseR5BrowserOptions(argv(
      "--expected-artifact-hash", invalid,
      "--output", "work/r5-verifier-unit",
    ), { cwd: fixture.root }), /lowercase 32-byte SHA-256 digest/u);
  }
  assert.throws(() => parseR5BrowserOptions(argv("--output", "work/r5-verifier-unit"), { cwd: fixture.root }), /expected-artifact-hash/u);
});

test("R5 verifier CLI rejects duplicate, malformed, and expansive paths", () => {
  assert.throws(() => parseR5BrowserOptions(argv(
    "--expected-artifact-hash", ARTIFACT_HASH,
    "--expected-artifact-hash", ARTIFACT_HASH,
    "--output", "work/r5-verifier-unit",
  ), { cwd: ROOT }), /may only be provided once/u);
  assert.throws(() => parseR5BrowserOptions(argv(
    "--expected-artifact-hash", ARTIFACT_HASH,
    "--output", "outside-work",
  ), { cwd: ROOT }), /strictly beneath/u);
  assert.throws(() => resolveWorkOutputDirectory(ROOT, "work"), /strictly beneath/u);
  assert.throws(() => parseR5BrowserOptions(argv(
    "--expected-artifact-hash", ARTIFACT_HASH,
    "--output", "work/r5-verifier-unit",
    "--base-url", "file:///tmp/blockwild",
  ), { cwd: ROOT }), /http or https/u);
  assert.throws(() => parseR5BrowserOptions(argv(
    "--expected-artifact-hash", ARTIFACT_HASH,
    "--output", "work/r5-verifier-unit",
    "--engine-dir", "work",
  ), { cwd: ROOT }), /must resolve exactly/u);
  assert.throws(() => parseR5BrowserOptions(argv(
    "--expected-artifact-hash", ARTIFACT_HASH,
    "--output", "work/r5-verifier-unit",
    "--engine-dir", "public/engine",
  ), { cwd: ROOT }), /must resolve exactly/u);
  assert.throws(() => parseR5BrowserOptions(argv(
    "--expected-artifact-hash", ARTIFACT_HASH,
    "--output", "work/r5-verifier-unit",
    "--timeout-ms", "30000ms",
  ), { cwd: ROOT }), /base-10 integer/u);
});

test("R5 current-source CLI rejects an omitted isolated candidate directory", () => {
  assert.throws(() => parseR5BrowserOptions(argv(
    "--expected-artifact-hash", ARTIFACT_HASH,
    "--output", "work/r5-verifier-unit",
  ), { cwd: ROOT }), /--engine-dir is required/u);
  assert.throws(
    () => prepareCandidateRoute(ROOT, null, ARTIFACT_HASH),
    /--engine-dir is required/u,
  );
});

test("R5 candidate selection records a fresh source snapshot matching artifact provenance", (t) => {
  const fixture = createCurrentSourceCandidateFixture(t);
  const candidate = prepareCandidateRoute(fixture.root, fixture.candidateRoot, fixture.hash);
  assert.deepEqual(candidate.sourceSnapshot, fixture.sourceSnapshot);
  assert.deepEqual(candidate.artifact.manifest.sourceSnapshot, fixture.sourceSnapshot);
  assert.deepEqual(assertR5CandidateSourceUnchanged(candidate), fixture.sourceSnapshot);
});

test("R5 candidate selection fails closed on Rust source drift before browser startup", (t) => {
  const fixture = createCurrentSourceCandidateFixture(t);
  writeFileSync(
    path.join(fixture.root, "engine", "src", "lib.rs"),
    "pub fn heartbeat() -> u32 { 2 }\n",
    "utf8",
  );
  assert.throws(
    () => prepareCandidateRoute(fixture.root, fixture.candidateRoot, fixture.hash),
    /not current-source: artifact [a-f0-9]{64}\/4, current [a-f0-9]{64}\/4/u,
  );
});

test("R5 terminal cleanup rejects source drift introduced after candidate preparation", (t) => {
  const fixture = createCurrentSourceCandidateFixture(t);
  const candidate = prepareCandidateRoute(fixture.root, fixture.candidateRoot, fixture.hash);
  writeFileSync(
    path.join(fixture.root, "engine", "src", "lib.rs"),
    "pub fn heartbeat() -> u32 { 3 }\n",
    "utf8",
  );
  const cleanup = {
    browserClosed: true,
    serverStopped: true,
    profileRemoved: true,
    browserMutexReleased: true,
    sourceUnchanged: true,
  };
  const runtimeErrors = [];
  assert.equal(recordR5TerminalSourceCleanup(candidate, cleanup, runtimeErrors), null);
  assert.equal(cleanup.sourceUnchanged, false);
  assert.match(runtimeErrors[0], /terminal source cleanup: Rust engine source changed during R5 browser acceptance/u);
  assert.equal(r5CleanupGatePassed(cleanup), false);
});

test("managed R5 Vite configuration loads the repository config with HMR and watching disabled", () => {
  const config = r5ManagedViteInlineConfig(ROOT, 51_731);
  assert.equal(Object.isExtensible(config), true);
  assert.equal(Object.isExtensible(config.server), true);
  assert.equal(config.root, realpathSync(ROOT));
  assert.equal(config.configFile, path.join(realpathSync(ROOT), "vite.config.ts"));
  assert.deepEqual({ ...config.server, watch: undefined }, {
    host: "127.0.0.1",
    port: 51_731,
    strictPort: true,
    hmr: false,
    watch: undefined,
  });
  assert.equal(typeof config.server.watch.ignored, "function");
  assert.equal(config.server.watch.ignored(path.join(ROOT, "app", "page.tsx")), true);
  assert.equal(config.server.watch.ignored(path.join(ROOT, "vite.config.ts")), true);
  config.build = { emptyOutDir: false };
  config.server.open = false;
  assert.deepEqual(config.build, { emptyOutDir: false });
  assert.equal(config.server.open, false);
  assert.throws(() => r5ManagedViteInlineConfig(ROOT, 0), /port must be an integer/u);
  assert.throws(() => r5ManagedViteInlineConfig(ROOT, 65_536), /port must be an integer/u);
});

test("browser page errors remain unfiltered and fail the final audit", () => {
  const pageErrors = Array.from({ length: 8 }, () => Object.freeze({
    name: "ReferenceError",
    message: "document is not defined",
    stack: "ReferenceError: document is not defined at /@vite/client:946",
  }));
  assert.throws(() => assertR5BrowserErrorStreams({
    routeErrors: [],
    consoleErrors: [],
    pageErrors,
    runtimeErrors: [],
  }), /Browser emitted 8 page errors/u);
  assert.equal(pageErrors.length, 8);
  assert.equal(pageErrors.every((error) => error.stack.includes("/@vite/client:946")), true);
  assert.equal(assertR5BrowserErrorStreams({
    routeErrors: [],
    consoleErrors: [],
    pageErrors: [],
    runtimeErrors: [],
  }), true);
});

test("R5 diagnostic assertion accepts only exact artifact, authority, generation, and certificate state", () => {
  const snapshot = healthySnapshot();
  const report = assertR5AuthorityDiagnostics(snapshot, ARTIFACT_HASH, "healthy");
  assert.equal(report.artifactHash, ARTIFACT_HASH);
  assert.equal(report.generationCertificate.corpusCases, 155);
  assert.equal(report.generationCertificate.corpusHash, R5_GENERATION_CERTIFICATE.corpusHash);
  assert.deepEqual(report.runtimeErrors, []);
  const withoutExposedBuildProfile = structuredClone(snapshot);
  delete withoutExposedBuildProfile.buildDiagnostics;
  assert.doesNotThrow(() => assertR5AuthorityDiagnostics(withoutExposedBuildProfile, ARTIFACT_HASH, "profile-not-exposed"));

  const mutations = [
    ["artifact mismatch", (value) => { value.runtime.manager.host.artifactHash = "b".repeat(64); }, /expected artifact/u],
    ["wrong generation mode", (value) => { value.state.performance.streaming.generationWorker.mode = "typescript"; }, /generation worker mode/u],
    ["obsolete default selection", (value) => { value.state.performance.streaming.generationWorker.selectionSource = "default-rust"; }, /generation selection source/u],
    ["TypeScript rollback selection", (value) => { value.state.performance.streaming.generationWorker.selectionSource = "build-typescript-rollback"; }, /generation selection source/u],
    ["TypeScript rollback build profile", (value) => { value.buildDiagnostics.worldgenBuildProfile = "typescript-rollback"; }, /worldgen build profile/u],
    ["not live ready", (value) => { value.runtime.manager.host.adapter.liveAuthorityReady = false; }, /liveAuthorityReady/u],
    ["worker restart", (value) => { value.state.performance.streaming.generationWorker.restarts = 1; }, /generation worker restarts/u],
    ["fallback", (value) => { value.state.performance.streaming.rustTerrain.fallback = 1; }, /Rust terrain fallbacks/u],
    ["wrong corpus count", (value) => { value.generationCertificates[0].corpusCases = 154; }, /exact 155-case/u],
    ["wrong corpus hash", (value) => { value.generationCertificates[0].corpusHash = "f".repeat(32); }, /exact 155-case/u],
    ["missing certificate", (value) => { value.generationCertificates = []; }, /no generation worker startup certificate/u],
  ];
  for (const [label, mutate, pattern] of mutations) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.throws(() => assertR5AuthorityDiagnostics(changed, ARTIFACT_HASH, label), pattern);
  }
});

test("R5 runtime error collection and reload comparison fail closed", () => {
  const snapshot = healthySnapshot();
  snapshot.runtime.operationsBlocked = true;
  snapshot.runtime.manager.host.adapter.lastError = "worker command failed";
  snapshot.state.performance.streaming.terrainWorker.restarts = 1;
  assert.deepEqual(collectR5RuntimeErrors(snapshot.state, snapshot.runtime), [
    "runtime.manager.host.adapter.lastError: worker command failed",
    "terrain worker restarts: 1",
  ]);
  assert.deepEqual(collectR5RuntimeErrors(snapshot.state, snapshot.runtime, { authorityCheckpoint: true }), [
    "runtime.manager.host.adapter.lastError: worker command failed",
    "runtime operations are blocked",
    "terrain worker restarts: 1",
  ]);
  assert.throws(() => assertR5AuthorityDiagnostics(snapshot, ARTIFACT_HASH, "ready-blocked"), /operations are blocked/u);

  const before = healthySnapshot();
  const after = structuredClone(before);
  assert.deepEqual(assertExactR5Reload(before, after, { seed: "MOON-FIELD-505", mode: "survival" }), {
    seed: "MOON-FIELD-505",
    mode: "survival",
    pose: { position: [4, 43.51, 0], yaw: 0, pitch: 0 },
  });
  after.state.player.position[0] = 4.01;
  assert.throws(() => assertExactR5Reload(before, after), /changed the exact authoritative pose/u);
});

test("walk sampling waits for observed non-sprint authority movement", () => {
  const waiting = healthySnapshot();
  waiting.state.player.velocity = [0, 0, 0];
  assert.equal(r5HorizontalMovementEngaged(waiting, false), false);

  const walking = healthySnapshot();
  walking.state.player.velocity = [4.44, 0, 0];
  assert.equal(r5HorizontalMovementEngaged(walking, false), true);
  assert.equal(r5HorizontalMovementEngaged(walking, true), false);

  const sprinting = healthySnapshot();
  sprinting.state.player.velocity = [6.48, 0, 0];
  sprinting.state.player.sprinting = true;
  assert.equal(r5HorizontalMovementEngaged(sprinting, true), true);
  assert.equal(r5HorizontalMovementEngaged(sprinting, false), false);

  const malformed = healthySnapshot();
  malformed.state.player.velocity = [Number.NaN, 0, 0];
  assert.throws(() => r5HorizontalMovementEngaged(malformed, false), /velocity x is not finite/u);
});

test("steady movement evidence requires quiescent projections from distinct applied inputs", () => {
  const walkStart = healthySnapshot();
  walkStart.state.player.velocity = [4.44, 0, 0];
  const walkEnd = structuredClone(walkStart);
  walkEnd.state.player.position[0] = 5.11;
  walkEnd.runtime.playerAuthority.pump.lastAuthorityTick = 15;
  walkEnd.runtime.playerAuthority.pump.lastExtractionRevision = 11;
  walkEnd.runtime.playerAuthority.pump.nextInputSequence = 12;
  walkEnd.runtime.playerAuthority.pump.appliedInputs = 11;
  walkEnd.runtime.playerAuthority.pump.samples = 11;
  walkEnd.runtime.playerAuthority.pump.stepCalls = 11;
  const walkStartEvidence = r5MovementSampleEvidence(walkStart);
  const walkEndEvidence = r5MovementSampleEvidence(walkEnd);
  assert.equal(walkStartEvidence.presentationSettled, true);
  assert.equal(walkStartEvidence.horizontalSpeed, 4.44);
  assert.equal(r5SteadyMovementPair(walkStartEvidence, walkEndEvidence, false), true);

  const inFlight = structuredClone(walkEnd);
  inFlight.runtime.playerAuthority.advanceInFlight = true;
  inFlight.runtime.playerAuthority.pump.queuedAdvances = 1;
  inFlight.runtime.playerAuthority.pump.inFlight = true;
  const inFlightEvidence = r5MovementSampleEvidence(inFlight);
  assert.equal(inFlightEvidence.presentationSettled, false);
  assert.equal(r5SteadyMovementPair(walkStartEvidence, inFlightEvidence, false), false);

  const unchangedInput = structuredClone(walkEndEvidence);
  unchangedInput.appliedInputSequence = walkStartEvidence.appliedInputSequence;
  assert.equal(r5SteadyMovementPair(walkStartEvidence, unchangedInput, false), false);
  const accelerating = structuredClone(walkEndEvidence);
  accelerating.velocity[0] = 4.43;
  accelerating.horizontalSpeed = 4.43;
  assert.equal(r5SteadyMovementPair(walkStartEvidence, accelerating, false), false);

  const sprintStart = structuredClone(walkStart);
  sprintStart.state.player.sprinting = true;
  sprintStart.state.player.velocity = [6.48, 0, 0];
  sprintStart.runtime.playerAuthority.pump.lastAppliedButtons = 4;
  const sprintEnd = structuredClone(walkEnd);
  sprintEnd.state.player.sprinting = true;
  sprintEnd.state.player.velocity = [6.48, 0, 0];
  sprintEnd.runtime.playerAuthority.pump.lastAppliedButtons = 4;
  const sprintStartEvidence = r5MovementSampleEvidence(sprintStart);
  const sprintEndEvidence = r5MovementSampleEvidence(sprintEnd);
  assert.equal(r5SteadyMovementPair(sprintStartEvidence, sprintEndEvidence, true), true);
  const steadyVelocityRatio = sprintEndEvidence.horizontalSpeed / walkEndEvidence.horizontalSpeed;
  assert.ok(steadyVelocityRatio > 1.18 && steadyVelocityRatio < 1.85);
  assert.equal(r5SteadyMovementPair(
    sprintStartEvidence,
    sprintEndEvidence,
    false,
  ), false);
});

test("jump trajectory preserves height, descending, and landing proof when the apex sample is skipped", () => {
  const baseY = 43.51;
  const samples = [
    [10, 10, baseY, 0, 0, "grounded"],
    [15, 11, baseY + 0.12, 3.4, 1, "takeoff"],
    [20, 12, baseY + 0.25, 1.2, 0, "high-ascent"],
    [25, 13, baseY + 0.17, -2.1, 0, "descending-below-height-threshold"],
    [30, 14, baseY + 0.03, -1.1, 0, "falling"],
    [35, 15, baseY, 0, 0, "landing-1"],
    [40, 16, baseY, 0, 0, "landing-2"],
    [45, 17, baseY, 0, 0, "landing-3"],
  ].map(([tick, revision, y, velocityY, buttons, phase], ordinal) => {
    const snapshot = healthySnapshot();
    snapshot.state.player.position[1] = y;
    snapshot.state.player.velocity[1] = velocityY;
    snapshot.runtime.playerAuthority.pump.lastAuthorityTick = tick;
    snapshot.runtime.playerAuthority.pump.lastExtractionRevision = revision;
    snapshot.runtime.playerAuthority.pump.nextInputSequence = ordinal + 1;
    snapshot.runtime.playerAuthority.pump.lastAppliedButtons = buttons;
    return r5JumpTrajectorySample(snapshot, { phase, ordinal });
  });
  assert.equal(samples.some((sample) => (
    sample.positionY > baseY + R5_JUMP_TRAJECTORY_THRESHOLDS.minimumPeakRise
      && sample.velocityY <= 0
  )), false, "fixture must reproduce the old one-sample apex blind spot");
  const evidence = summarizeR5JumpTrajectory(baseY, samples);
  assert.equal(evidence.complete, true);
  assert.equal(evidence.takeoff.phase, "takeoff");
  assert.equal(evidence.peak.phase, "high-ascent");
  assert.ok(evidence.peakRise > R5_JUMP_TRAJECTORY_THRESHOLDS.minimumPeakRise);
  assert.equal(evidence.descending.phase, "descending-below-height-threshold");
  assert.ok(evidence.descending.velocityY < R5_JUMP_TRAJECTORY_THRESHOLDS.maximumDescentVelocity);
  assert.deepEqual(evidence.landingSamples.map((sample) => sample.phase), ["landing-1", "landing-2", "landing-3"]);
  assert.equal(assertR5JumpTrajectoryEvidence(evidence), evidence);

  const sameTickPresentationRevision = {
    ...samples[5],
    extractionRevision: samples[5].extractionRevision + 1,
    phase: "landing-1-presentation-refresh",
    ordinal: samples[5].ordinal + 1,
  };
  const withSameTickRefresh = summarizeR5JumpTrajectory(baseY, [
    ...samples.slice(0, 6),
    sameTickPresentationRevision,
    ...samples.slice(6),
  ]);
  assert.equal(withSameTickRefresh.complete, true);
  assert.deepEqual(
    withSameTickRefresh.landingSamples.map((sample) => sample.phase),
    ["landing-1", "landing-2", "landing-3"],
    "same-tick extraction refreshes must not reset or inflate distinct landing ticks",
  );

  const insufficientHeight = samples.map((sample) => ({ ...sample }));
  insufficientHeight[2].positionY = baseY + 0.19;
  assert.throws(
    () => assertR5JumpTrajectoryEvidence(summarizeR5JumpTrajectory(baseY, insufficientHeight)),
    /peak rise.*did not exceed/u,
  );
  const noDescent = samples.map((sample) => ({ ...sample, velocityY: Math.max(0, sample.velocityY) }));
  assert.throws(
    () => assertR5JumpTrajectoryEvidence(summarizeR5JumpTrajectory(baseY, noDescent)),
    /descending phase/u,
  );
  const repeatedLanding = [...samples.slice(0, 5), samples[5], samples[5], samples[5]];
  assert.throws(
    () => assertR5JumpTrajectoryEvidence(summarizeR5JumpTrajectory(baseY, repeatedLanding)),
    /stable authoritative landing/u,
  );
});

test("managed browser mutex rejects overlap and becomes reusable immediately after exact release", async () => {
  const first = await acquireManagedBrowserGateMutex(ROOT, { port: 0 });
  const port = first.evidence.port;
  assert.equal(first.evidence.status, "acquired");
  await assert.rejects(
    acquireManagedBrowserGateMutex(ROOT, { port }),
    (error) => error.code === "BLOCKWILD_BROWSER_GATE_OVERLAP"
      && error.browserGateMutex?.status === "contended",
  );
  assert.equal(await first.release(), true);
  assert.equal(first.evidence.released, true);
  assert.equal(await first.release(), true, "release is idempotent");
  const next = await acquireManagedBrowserGateMutex(ROOT, { port });
  assert.equal(next.evidence.port, port);
  assert.equal(await next.release(), true);
});

test("terminal persistence evidence requires two exact zero-velocity drained authority steps", () => {
  const first = healthySnapshot();
  const firstEvidence = r5PersistencePoseEvidence(first);
  assert.equal(firstEvidence.zeroVelocity, true);
  assert.equal(firstEvidence.pumpDrained, true);
  assert.equal(firstEvidence.terminal, true);

  const second = structuredClone(first);
  second.runtime.playerAuthority.pump.lastAuthorityTick += 5;
  second.runtime.playerAuthority.pump.lastExtractionRevision += 1;
  second.runtime.playerAuthority.pump.nextInputSequence += 1;
  second.runtime.playerAuthority.pump.appliedInputs += 1;
  const secondEvidence = r5PersistencePoseEvidence(second);
  assert.equal(r5TerminalPersistencePair(firstEvidence, secondEvidence), true);

  const moving = structuredClone(second);
  moving.state.player.velocity = [0.03, -0.05, 0];
  assert.equal(r5PersistencePoseEvidence(moving).terminal, false);

  const inFlight = structuredClone(second);
  inFlight.runtime.playerAuthority.advanceInFlight = true;
  inFlight.runtime.playerAuthority.pump.inFlight = true;
  inFlight.runtime.playerAuthority.pump.queuedAdvances = 1;
  assert.equal(r5PersistencePoseEvidence(inFlight).pumpDrained, false);

  const pending = structuredClone(second);
  pending.runtime.playerAuthority.pump.nativeInputPending = true;
  pending.runtime.playerAuthority.pump.pendingInputSequence = 11;
  assert.equal(r5PersistencePoseEvidence(pending).terminal, false);

  const shifted = structuredClone(secondEvidence);
  shifted.pose = { ...shifted.pose, position: [4.03, 43.46, 0] };
  assert.equal(r5TerminalPersistencePair(firstEvidence, shifted), false);
});

test("managed-local canonical asset routing is an exact six-URL non-symlink allowlist", () => {
  const exactAssets = new Map([
    ["https://blockwild.app/manifest.webmanifest", "manifest.webmanifest"],
    ["https://blockwild.app/brand/blockwild-icon-16.png", "brand/blockwild-icon-16.png"],
    ["https://blockwild.app/brand/blockwild-icon-32.png", "brand/blockwild-icon-32.png"],
    ["https://blockwild.app/brand/blockwild-icon-64.png", "brand/blockwild-icon-64.png"],
    ["https://blockwild.app/brand/blockwild-icon-192.png", "brand/blockwild-icon-192.png"],
    ["https://blockwild.app/brand/blockwild-icon-512.png", "brand/blockwild-icon-512.png"],
  ]);
  const canonicalPublic = realpathSync(path.join(ROOT, "public"));
  for (const [requestUrl, relativeAssetPath] of exactAssets) {
    const asset = resolveManagedCanonicalAsset(ROOT, requestUrl);
    assert.equal(asset.requestUrl, requestUrl);
    assert.equal(asset.relativeAssetPath, relativeAssetPath);
    assert.equal(lstatSync(asset.filePath).isSymbolicLink(), false);
    assert.equal(path.relative(canonicalPublic, asset.filePath), relativeAssetPath.replaceAll("/", path.sep));
  }
  for (const requestUrl of [
    "http://blockwild.app/manifest.webmanifest",
    "https://www.blockwild.app/manifest.webmanifest",
    "https://blockwild.app:444/manifest.webmanifest",
    "https://blockwild.app/manifest.webmanifest?cache=1",
    "https://blockwild.app/brand/blockwild-icon-180.png",
    "https://blockwild.app/engine/manifest.json",
    "https://blockwild.app/brand/../manifest.webmanifest",
  ]) {
    assert.equal(resolveManagedCanonicalAsset(ROOT, requestUrl), null, requestUrl);
  }
});

test("owned process cleanup escalates only the exact PID and trusts observed exit, not taskkill status alone", async () => {
  assert.equal(exactProcessIsAlive(41, () => undefined), true);
  assert.equal(exactProcessIsAlive(41, () => { const error = new Error("gone"); error.code = "ESRCH"; throw error; }), false);
  assert.equal(exactProcessIsAlive(41, () => { const error = new Error("denied"); error.code = "EPERM"; throw error; }), true);
  assert.equal(taskkillCommandSucceeded({ status: 0 }), true);
  assert.equal(taskkillCommandSucceeded({ status: 1 }), false);
  assert.equal(taskkillCommandSucceeded({ status: 0, error: new Error("spawn") }), false);

  let alive = true;
  const killSignals = [];
  const taskkillCalls = [];
  const diagnostics = {};
  const child = {
    pid: 31_756,
    exitCode: null,
    signalCode: null,
    kill(signal) { killSignals.push(signal); return true; },
  };
  const stopped = await stopOwnedProcess(child, {
    platform: "win32",
    processAlive: (pid) => { assert.equal(pid, 31_756); return alive; },
    spawnSync: (command, args) => {
      taskkillCalls.push([command, args]);
      alive = false;
      return { status: 0, signal: null, stdout: "SUCCESS", stderr: "" };
    },
    sleep: async () => {},
    normalWaitMilliseconds: 0,
    forcedWaitMilliseconds: 0,
    diagnostics,
  });
  assert.equal(stopped, true);
  assert.deepEqual(killSignals, ["SIGTERM"]);
  assert.deepEqual(taskkillCalls, [["taskkill", ["/PID", "31756", "/T", "/F"]]]);
  assert.equal(diagnostics.forcedTerminationCommandSucceeded, true);
  assert.equal(diagnostics.exactPidAliveAfterStop, false);

  alive = true;
  let unexpectedTaskkill = false;
  const normallyStopped = await stopOwnedProcess({
    ...child,
    kill(signal) { killSignals.push(signal); alive = false; return true; },
  }, {
    platform: "win32",
    processAlive: () => alive,
    spawnSync: () => { unexpectedTaskkill = true; return { status: 0 }; },
    sleep: async () => {},
    normalWaitMilliseconds: 0,
  });
  assert.equal(normallyStopped, true);
  assert.equal(unexpectedTaskkill, false);

  alive = true;
  const stillAlive = await stopOwnedProcess(child, {
    platform: "win32",
    processAlive: () => alive,
    spawnSync: () => ({ status: 1, signal: null, stdout: "", stderr: "not stopped" }),
    sleep: async () => {},
    normalWaitMilliseconds: 0,
    forcedWaitMilliseconds: 0,
  });
  assert.equal(stillAlive, false);

  alive = true;
  const goneDespiteTaskkillStatus = await stopOwnedProcess(child, {
    platform: "win32",
    processAlive: () => alive,
    spawnSync: () => { alive = false; return { status: 1, signal: null, stdout: "", stderr: "already gone" }; },
    sleep: async () => {},
    normalWaitMilliseconds: 0,
    forcedWaitMilliseconds: 0,
  });
  assert.equal(goneDespiteTaskkillStatus, true);
});
