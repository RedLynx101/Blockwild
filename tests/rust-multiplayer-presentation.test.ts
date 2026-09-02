import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORLD_OPTIONS,
  VoxelEngine,
  encodePlayerProgressionChunks,
  normalizeMultiplayerPlayerProgression,
  type WorldSave,
} from "../app/game/engine.ts";
import { createGuildBook } from "../app/game/guilds.ts";
import {
  MultiplayerPeerTransportUnavailableError,
  type MultiplayerEvent,
  type PeerIdentity,
  type PlayerPose,
  type PlayerProgressAction,
  type PlayerProgressionSnapshot,
  type PlayerSessionSnapshot,
  type WorldSnapshot,
} from "../app/game/multiplayer.ts";
import { createNetworkAuthorityIdentityV1, createNetworkDeltaV1 } from "../app/game/network-authority-contract.ts";
import {
  RUST_MULTIPLAYER_PRESENTATION_KIND_V2,
  RUST_MULTIPLAYER_PRESENTATION_SCHEMA_V2,
  RustMultiplayerPresentationError,
  decodeRustMultiplayerWorldPresentationV2,
  encodeRustMultiplayerWorldPresentationV2,
  rustMultiplayerPresentationRecordIdV2,
  type RustMultiplayerProgressionReceiptV2,
  type RustMultiplayerWorldPresentationV2,
} from "../app/game/rust-multiplayer-presentation.ts";
import { createSkillState } from "../app/game/skills.ts";
import { GENERATOR_VERSION } from "../app/game/world.ts";

const SESSION_ID = "session_presentation_001";
const HOST: PeerIdentity = { id: "player_host_presentation_001", name: "Host", color: "#55aaff" };
const GUEST: PeerIdentity = { id: "browser_guest_presentation.character_guest_01", name: "Guest", color: "#ffaa55" };
const IDENTITY = createNetworkAuthorityIdentityV1(
  { universeId: "blockwild", locationId: "world-presentation" },
  { epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5 },
);

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function playerState(): PlayerSessionSnapshot {
  return {
    playerId: GUEST.id,
    revision: 3,
    variant: "female",
    sex: "female",
    inventory: Array.from({ length: 36 }, () => null),
    equipment: { head: null, chest: null, legs: null, feet: null },
    selected: 0,
    health: 10,
    hunger: 10,
    xp: 0,
    level: 1,
    skills: createSkillState(),
  };
}

function worldSnapshot(): WorldSnapshot {
  const scope = { centerPlayerId: GUEST.id, radius: 96, epoch: 1 };
  return {
    tick: 41,
    seed: "presentation-seed",
    mode: "survival",
    generatorVersion: 15,
    generatorProfile: "world-below-v15",
    players: [{
      playerId: HOST.id,
      tick: 41,
      x: 4,
      y: 71,
      z: -8,
      yaw: 0.5,
      pitch: -0.1,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      action: "none",
    }],
    blockEdits: [{ x: 1, y: 70, z: 2, type: 1, facing: 3 }],
    mobs: [],
    mobScope: { ...scope },
    drops: [],
    dropScope: { ...scope },
    tombstones: [],
    boats: [],
    time: {
      tick: 41,
      worldTime: 0.35,
      day: 2,
      weather: "clear",
      weatherState: {
        kind: "clear",
        cycle: 1,
        elapsedSeconds: 10,
        durationSeconds: 180,
        intensity: 0,
        windAngle: 0.2,
        windSpeed: 1,
      },
    },
    worldOptions: { ...DEFAULT_WORLD_OPTIONS, enabledFactions: [...DEFAULT_WORLD_OPTIONS.enabledFactions] },
    containers: [],
    guildBook: createGuildBook(),
    playerState: playerState(),
  };
}

function presentation(sequence = 1): RustMultiplayerWorldPresentationV2 {
  return {
    schema: RUST_MULTIPLAYER_PRESENTATION_SCHEMA_V2,
    kind: RUST_MULTIPLAYER_PRESENTATION_KIND_V2,
    sessionId: SESSION_ID,
    hostPeerId: HOST.id,
    targetPeerId: GUEST.id,
    targetPeerKind: "human",
    deltaSequence: sequence,
    snapshot: worldSnapshot(),
    playerProgression: {
      revision: 7,
      state: normalizeMultiplayerPlayerProgression(null, GUEST.id, "presentation-world"),
    },
    progressionReceipt: null,
  };
}

function deltaFor(value: RustMultiplayerWorldPresentationV2, extraRecords: Array<{
  kind: "player";
  recordId: string;
  revision: number;
  payload: Uint8Array;
}> = []) {
  const payload = encodeRustMultiplayerWorldPresentationV2(value);
  return createNetworkDeltaV1({
    sessionId: SESSION_ID,
    deltaId: `delta_presentation_${value.deltaSequence}`,
    peerId: GUEST.id,
    keyframe: true,
    sequence: value.deltaSequence,
    acknowledgedCommandSequence: 0,
    from: IDENTITY,
    to: IDENTITY,
    interestHash: "a".repeat(32),
    records: [{
      kind: "player",
      recordId: rustMultiplayerPresentationRecordIdV2(GUEST.id),
      revision: value.deltaSequence,
      payload,
    }, ...extraRecords],
  });
}

function presentationAtProgressionRevision(sequence: number, revision: number) {
  const source = presentation(sequence);
  return {
    ...source,
    snapshot: { ...source.snapshot, generatorVersion: GENERATOR_VERSION },
    playerProgression: {
      ...source.playerProgression!,
      revision,
      state: {
        ...source.playerProgression!.state,
        mapKnowledge: { ...source.playerProgression!.state.mapKnowledge, revision },
      },
    },
  } satisfies RustMultiplayerWorldPresentationV2;
}

function progressionAtRevision(revision: number) {
  return structuredClone(presentationAtProgressionRevision(revision + 1, revision).playerProgression!.state);
}

type PendingProgressionView = {
  revision: number;
  signature: string;
  transferId: string;
  transportComplete: boolean;
  baseState: PlayerProgressionSnapshot;
  requestState: PlayerProgressionSnapshot;
};

function pendingProgressionGuestFixture(outgoing: Array<{ action: PlayerProgressAction }>) {
  const hostPeer = {
    token: "invite_pending_progression_001",
    identity: HOST,
    state: "connected" as const,
    connectedAt: 1,
    lastSeenAt: 1,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  };
  const sent: PlayerProgressAction[] = [];
  const appliedMapRevisions: number[] = [];
  const confirmations: number[] = [];
  const disconnects: string[] = [];
  const confirmedProgression = structuredClone(presentationAtProgressionRevision(7, 7).playerProgression!.state);
  const requestedProgression = structuredClone(presentationAtProgressionRevision(8, 8).playerProgression!.state);
  let localProgression = structuredClone(requestedProgression);
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: {
      role: "guest",
      state: "connected",
      sessionId: SESSION_ID,
      identity: GUEST,
      getPeer: (peerId: string) => peerId === HOST.id ? hostPeer : undefined,
      sendPlayerProgress: (action: PlayerProgressAction) => { sent.push(structuredClone(action)); return 1; },
      confirmRustGuestPresentationApplied: (sequence: number) => { confirmations.push(sequence); return true; },
    },
    world: { seedText: "presentation-seed" },
    multiplayerReceivedSnapshot: true,
    multiplayerProgressionReceived: true,
    multiplayerProgressionRevision: 7,
    multiplayerProgressionSignature: "progression-7",
    multiplayerProgressionConfirmedState: confirmedProgression,
    multiplayerPendingProgressionTransfer: {
      revision: 8,
      signature: "progression-8",
      transferId: "progress_pending_8",
      transportComplete: false,
      baseState: confirmedProgression,
      requestState: requestedProgression,
    } satisfies PendingProgressionView,
    multiplayerProgressOutgoing: outgoing,
    rustGuestPresentationQueue: Promise.resolve(),
    rustAuthorityDeltaApplied: 0,
    rustAuthorityLastStateHash: null,
    rustAuthorityLastError: null,
    multiplayerState: { error: "" },
    running: true,
    paused: false,
    events: { onMultiplayerEnded: () => undefined },
    applyIncrementalWorldSnapshot: () => undefined,
    applyLocalPlayerProgression: (state: PlayerProgressionSnapshot) => {
      localProgression = structuredClone(state);
      appliedMapRevisions.push(state.mapKnowledge.revision);
    },
    localPlayerProgressionSnapshot: () => structuredClone(localProgression),
    playerProgressionSignature: (state: PlayerProgressionSnapshot) => `progression-${state.mapKnowledge.revision}`,
    localPlayerProgressionSignature: () => `progression-${localProgression.mapKnowledge.revision}`,
    trackRustAuthorityOperation: (operation: Promise<unknown>) => operation,
    disconnectMultiplayer: async (reason: string) => { disconnects.push(reason); },
  });
  const access = engine as unknown as {
    multiplayerPendingProgressionTransfer: PendingProgressionView | null;
    rustGuestPresentationQueue: Promise<void>;
    flushPlayerProgressionTransfers(limit?: number): { sent: number; requestChunksRemaining: number };
    queueRustAuthorityPresentation(event: Extract<MultiplayerEvent, { type: "authority-delta" }>): void;
  };
  const applyPresentation = async (
    revision: number,
    sequence: number,
    progressionReceipt: RustMultiplayerProgressionReceiptV2 | null = null,
    progressionState?: PlayerProgressionSnapshot,
  ) => {
    const initial = presentationAtProgressionRevision(sequence, revision);
    const source = {
      ...initial,
      progressionReceipt,
      ...(progressionState ? {
        playerProgression: { ...initial.playerProgression!, state: structuredClone(progressionState) },
      } : {}),
    } satisfies RustMultiplayerWorldPresentationV2;
    const delta = deltaFor(source);
    access.queueRustAuthorityPresentation({
      type: "authority-delta",
      peer: hostPeer,
      keyframe: true,
      sequence: delta.sequence,
      stateHash: "f".repeat(32),
      packet: new Uint8Array(),
      delta,
    });
    await access.rustGuestPresentationQueue;
    await Promise.resolve();
  };
  const setLocalRevision = (revision: number) => {
    localProgression = {
      ...localProgression,
      mapKnowledge: { ...localProgression.mapKnowledge, revision },
    };
  };
  const localRevision = () => localProgression.mapKnowledge.revision;
  const localState = () => structuredClone(localProgression);
  return { engine, access, sent, appliedMapRevisions, confirmations, disconnects, applyPresentation, setLocalRevision, localRevision, localState };
}

function teardownReadyGuestFixture(options: Readonly<{
  onDispose?: (engine: VoxelEngine & Record<string, unknown>, reason: string) => void;
  onAuthorityDrain?: (engine: VoxelEngine & Record<string, unknown>) => Promise<void> | void;
  onRuntimeShutdown?: (engine: VoxelEngine & Record<string, unknown>) => Promise<void> | void;
}> = {}) {
  const events: string[] = [];
  let disposeCalls = 0;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const session = {
    role: "guest",
    state: "connected",
    dispose: (reason: string) => {
      disposeCalls += 1;
      events.push(`dispose:${reason}`);
      options.onDispose?.(engine, reason);
    },
    drainAuthority: async () => {
      events.push("authority-drain");
      await options.onAuthorityDrain?.(engine);
    },
  };
  Object.assign(engine, {
    paused: false,
    running: true,
    multiplayer: session,
    multiplayerProgressionReceived: false,
    multiplayerTerrainReadinessGeneration: 0,
    multiplayerTerrainReadinessAbort: null,
    hostRendezvous: null,
    removeAllRemotePlayers: () => { events.push("remote-players-cleared"); },
    clearAgentWorkRuntime: () => undefined,
    agentVoicePending: [],
    latestAgentObservation: null,
    latestAgentResult: null,
    pendingAgentCommandReceipts: new Map(),
    sleepVotes: new Set(),
    multiplayerContainerAwaiting: new Set(),
    multiplayerOptimisticContainers: new Map(),
    pendingGuestCreatureInventoryRequests: new Map(),
    pendingGuestPlacementRequests: new Map(),
    deferredRemoteBlockActions: new Map(),
    multiplayerPeerActiveContainers: new Map(),
    multiplayerPeerContainerSignatures: new Map(),
    pendingReliableRequests: new Map(),
    multiplayerBoatInputs: new Map(),
    resetMultiplayerProgressionState: () => { events.push("progression-reset"); },
    titleMode: true,
    disposed: true,
    rustRuntimeManager: {
      shutdown: async () => {
        events.push("runtime-shutdown");
        await options.onRuntimeShutdown?.(engine);
      },
    },
    rustRuntimeHost: { fixture: true },
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "ready",
  });
  return { engine, session, events, disposeCalls: () => disposeCalls };
}

test("Rust presentation round-trips every targeted snapshot and progression field", () => {
  const source = {
    ...presentation(),
    progressionReceipt: {
      transferId: "progress_receipt_roundtrip_7",
      status: "accepted",
      committedRevision: 7,
    },
  } satisfies RustMultiplayerWorldPresentationV2;
  const decoded = decodeRustMultiplayerWorldPresentationV2({
    delta: deltaFor(source),
    sessionId: SESSION_ID,
    host: HOST,
    target: GUEST,
  });
  assert.deepEqual(decoded.snapshot, source.snapshot);
  assert.deepEqual(decoded.playerProgression, source.playerProgression);
  assert.deepEqual(decoded.progressionReceipt, source.progressionReceipt);
  assert.equal(decoded.snapshot.blockEdits[0]?.facing, 3);
  assert.equal(decoded.snapshot.time.weatherState?.kind, "clear");
  assert.equal(decoded.snapshot.playerState?.playerId, GUEST.id);
  assert.equal(decoded.playerProgression?.state.mapKnowledge.playerId, GUEST.id,
    "fresh private progression preserves the exact dotted browser/profile network identity");
});

test("Rust presentation V2 rejects V1 records and malformed progression receipts", () => {
  const source = presentation();
  assert.throws(() => encodeRustMultiplayerWorldPresentationV2({
    ...source,
    progressionReceipt: {
      transferId: "progress_bad_receipt_7",
      status: "accepted",
      committedRevision: 8,
    },
  }), /exceeds/iu);

  const legacyPresentation = structuredClone(source) as unknown as Record<string, unknown>;
  delete legacyPresentation.progressionReceipt;
  legacyPresentation.schema = 1;
  legacyPresentation.kind = "blockwild.multiplayer.world-presentation.v1";
  const legacyPayload = new TextEncoder().encode(JSON.stringify(legacyPresentation));
  const legacyDelta = createNetworkDeltaV1({
    sessionId: SESSION_ID,
    deltaId: "delta_presentation_v1_rejected",
    peerId: GUEST.id,
    keyframe: true,
    sequence: source.deltaSequence,
    acknowledgedCommandSequence: 0,
    from: IDENTITY,
    to: IDENTITY,
    interestHash: "a".repeat(32),
    records: [{
      kind: "player",
      recordId: `blockwild:presentation:snapshot:${GUEST.id}`,
      revision: source.deltaSequence,
      payload: legacyPayload,
    }],
  });
  assert.throws(() => decodeRustMultiplayerWorldPresentationV2({
    delta: legacyDelta,
    sessionId: SESSION_ID,
    host: HOST,
    target: GUEST,
  }), /missing, duplicate, or mistargeted/iu);
});

test("Rust presentation V2 rejects omitted and unknown fields throughout private progression", () => {
  const malformedQuest = structuredClone(presentation()) as unknown as Record<string, unknown>;
  const questState = (malformedQuest.playerProgression as { state: Record<string, unknown> }).state;
  delete (questState.questBook as Record<string, unknown>).active;
  assert.throws(() => encodeRustMultiplayerWorldPresentationV2(
    malformedQuest as unknown as RustMultiplayerWorldPresentationV2,
  ), /questBook/iu);

  const malformedBestiary = structuredClone(presentation()) as unknown as Record<string, unknown>;
  const bestiaryState = (malformedBestiary.playerProgression as { state: Record<string, unknown> }).state;
  const firstEntry = Object.values(bestiaryState.bestiary as Record<string, Record<string, unknown>>)[0];
  assert.ok(firstEntry);
  delete firstEntry.research;
  assert.throws(() => encodeRustMultiplayerWorldPresentationV2(
    malformedBestiary as unknown as RustMultiplayerWorldPresentationV2,
  ), /bestiary/iu);

  const unknownStockField = structuredClone(presentation()) as unknown as Record<string, unknown>;
  const stockState = (unknownStockField.playerProgression as { state: Record<string, unknown> }).state;
  const quotes = (stockState.stockMarket as { quotes: Record<string, Record<string, unknown>> }).quotes;
  quotes.BURR!.uncommitted = true;
  assert.throws(() => encodeRustMultiplayerWorldPresentationV2(
    unknownStockField as unknown as RustMultiplayerWorldPresentationV2,
  ), /stockMarket\.quotes\.BURR/iu);
});

test("legacy progression migration rebinds private map custody to the exact presentation target", () => {
  const browserId = "browser_guest_presentation_01";
  const stale = {
    revision: 9,
    state: normalizeMultiplayerPlayerProgression(null, HOST.id, "presentation-world"),
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayerPlayerProgressions: new Map([[browserId, stale]]),
  });
  const rebound = (engine as unknown as {
    ensureHostPlayerProgression(identity: PeerIdentity): typeof stale;
  }).ensureHostPlayerProgression({ ...GUEST, browserId });

  assert.equal(rebound.revision, stale.revision);
  assert.equal(rebound.state.mapKnowledge.playerId, GUEST.id);
  assert.equal(rebound.state.mapKnowledge.worldId, "presentation-world");
  assert.equal((engine as unknown as { multiplayerPlayerProgressions: Map<string, unknown> })
    .multiplayerPlayerProgressions.has(browserId), false);
  assert.doesNotThrow(() => encodeRustMultiplayerWorldPresentationV2({
    ...presentation(),
    playerProgression: rebound,
  }));
});

test("Rust presentation fails closed on missing fields, mismatched targets, and duplicate projection records", () => {
  const source = presentation();
  const missingWeather = structuredClone(source) as unknown as Record<string, unknown>;
  delete (missingWeather.snapshot as { time: Record<string, unknown> }).time.weatherState;
  assert.throws(() => encodeRustMultiplayerWorldPresentationV2(
    missingWeather as unknown as RustMultiplayerWorldPresentationV2,
  ), RustMultiplayerPresentationError);

  assert.throws(() => decodeRustMultiplayerWorldPresentationV2({
    delta: deltaFor(source),
    sessionId: SESSION_ID,
    host: HOST,
    target: { ...GUEST, id: "player_other_target_001" },
  }), /mistargeted/iu);

  const duplicatePayload = encodeRustMultiplayerWorldPresentationV2({
    ...source,
    targetPeerId: "player_other_target_001",
    snapshot: {
      ...source.snapshot,
      mobScope: { ...source.snapshot.mobScope, centerPlayerId: "player_other_target_001" },
      dropScope: { ...source.snapshot.dropScope, centerPlayerId: "player_other_target_001" },
      playerState: { ...source.snapshot.playerState!, playerId: "player_other_target_001" },
    },
    playerProgression: {
      ...source.playerProgression!,
      state: normalizeMultiplayerPlayerProgression(null, "player_other_target_001", "presentation-world"),
    },
  });
  assert.throws(() => decodeRustMultiplayerWorldPresentationV2({
    delta: deltaFor(source, [{
      kind: "player",
      recordId: rustMultiplayerPresentationRecordIdV2("player_other_target_001"),
      revision: 1,
      payload: duplicatePayload,
    }]),
    sessionId: SESSION_ID,
    host: HOST,
    target: GUEST,
  }), /missing, duplicate, or mistargeted/iu);
});

test("engine readiness opens only after the accepted projection and progression are applied", async () => {
  const source = presentation();
  const delta = deltaFor(source);
  const receiverProjectionHash = "f".repeat(32);
  const confirmations: Array<[number, string]> = [];
  const applications: string[] = [];
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: {
      role: "guest",
      sessionId: SESSION_ID,
      identity: GUEST,
      getPeer: () => ({
        token: "invite_presentation_001",
        identity: HOST,
        state: "connected",
      }),
      confirmRustGuestPresentationApplied: (sequence: number, hash: string) => confirmations.push([sequence, hash]),
    },
    multiplayerReceivedSnapshot: false,
    multiplayerProgressionReceived: false,
    multiplayerProgressionRevision: 0,
    multiplayerProgressionSignature: "",
    rustGuestPresentationQueue: Promise.resolve(),
    rustAuthorityOperations: new Set(),
    rustAuthorityDeltaApplied: 0,
    rustAuthorityLastStateHash: null,
    rustAuthorityLastError: null,
    multiplayerState: { error: "" },
    events: {},
    applyInitialWorldSnapshot: async () => {
      applications.push("snapshot");
      engine.multiplayerReceivedSnapshot = true;
    },
    applyLocalPlayerProgression: () => applications.push("progression"),
    localPlayerProgressionSignature: () => "applied-progression",
  });
  const event: Extract<MultiplayerEvent, { type: "authority-delta" }> = {
    type: "authority-delta",
    peer: {
      token: "invite_presentation_001",
      identity: HOST,
      state: "connected",
      connectedAt: 1,
      lastSeenAt: 1,
      latencyMs: 0,
      reliableOpen: true,
      movementOpen: true,
      voiceOpen: true,
    },
    keyframe: true,
    sequence: delta.sequence,
    stateHash: receiverProjectionHash,
    packet: new Uint8Array(),
    delta,
  };
  (engine as unknown as { queueRustAuthorityPresentation(value: typeof event): void })
    .queueRustAuthorityPresentation(event);
  await (engine as unknown as { rustGuestPresentationQueue: Promise<void> }).rustGuestPresentationQueue;
  assert.deepEqual(applications, ["snapshot", "progression"]);
  assert.deepEqual(confirmations, [[delta.sequence, receiverProjectionHash]]);
  assert.equal(engine.multiplayerReceivedSnapshot, true);
  assert.equal(engine.multiplayerProgressionReceived, true);
  assert.equal((engine as unknown as { rustAuthorityDeltaApplied: number }).rustAuthorityDeltaApplied, 1);
});

test("a presentation finishing after its exact host peer closes stays stale without a false protocol failure", async () => {
  const source = presentation();
  const delta = deltaFor(source);
  const hostPeer = {
    token: "invite_stale_presentation_001",
    identity: HOST,
    state: "connected" as const,
    connectedAt: 1,
    lastSeenAt: 1,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  };
  let peerConnected = true;
  let entered!: () => void;
  let release!: () => void;
  const applicationEntered = new Promise<void>((resolve) => { entered = resolve; });
  const applicationGate = new Promise<void>((resolve) => { release = resolve; });
  let confirmed = false;
  let progressionApplied = false;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: {
      role: "guest",
      sessionId: SESSION_ID,
      identity: GUEST,
      getPeer: () => peerConnected ? hostPeer : undefined,
      confirmRustGuestPresentationApplied: () => { confirmed = true; return true; },
    },
    multiplayerReceivedSnapshot: false,
    multiplayerProgressionReceived: false,
    multiplayerProgressionRevision: 0,
    multiplayerProgressionSignature: "",
    rustGuestPresentationQueue: Promise.resolve(),
    rustAuthorityOperations: new Set(),
    rustAuthorityDeltaApplied: 0,
    rustAuthorityLastStateHash: null,
    rustAuthorityLastError: null,
    multiplayerState: { error: "" },
    events: {},
    applyInitialWorldSnapshot: async () => {
      entered();
      await applicationGate;
      engine.multiplayerReceivedSnapshot = true;
    },
    applyLocalPlayerProgression: () => { progressionApplied = true; },
    localPlayerProgressionSignature: () => "must-not-run",
  });
  const event: Extract<MultiplayerEvent, { type: "authority-delta" }> = {
    type: "authority-delta",
    peer: hostPeer,
    keyframe: true,
    sequence: delta.sequence,
    stateHash: "f".repeat(32),
    packet: new Uint8Array(),
    delta,
  };

  (engine as unknown as { queueRustAuthorityPresentation(value: typeof event): void })
    .queueRustAuthorityPresentation(event);
  await applicationEntered;
  peerConnected = false;
  release();
  await (engine as unknown as { rustGuestPresentationQueue: Promise<void> }).rustGuestPresentationQueue;

  assert.equal(progressionApplied, false);
  assert.equal(confirmed, false);
  assert.equal((engine as unknown as { rustAuthorityDeltaApplied: number }).rustAuthorityDeltaApplied, 0);
  assert.equal((engine as unknown as { rustAuthorityLastError: string | null }).rustAuthorityLastError, null);
});

test("Rust host connection orders one keyframe without legacy snapshot or progression sends", async () => {
  const calls: string[] = [];
  const peer = {
    token: "invite_ordering_001",
    identity: GUEST,
    state: "connected" as const,
    connectedAt: 1,
    lastSeenAt: 1,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: {
      role: "host",
      authorityMode: "rust-authoritative",
      getPeers: () => [peer],
    },
    multiplayerState: { peers: [] },
    multiplayerSnapshotTimer: 0,
    multiplayerPeerScopeEpochs: new Map(),
    rustPeerDeltaSequences: new Map(),
    ensureHostPlayerSession: () => { calls.push("ensure-player"); return playerState(); },
    sendHostWorldSnapshot: () => calls.push("legacy-snapshot"),
    sendAuthoritativePlayerProgression: () => calls.push("legacy-progression"),
    publishRustAuthorityKeyframe: async () => { calls.push("rust-keyframe"); },
    trackRustAuthorityOperation: (operation: Promise<unknown>) => operation,
    events: { onToast: () => calls.push("toast") },
    emitHud: () => undefined,
  });
  (engine as unknown as { handleMultiplayerEvent(value: MultiplayerEvent): void }).handleMultiplayerEvent({
    type: "peer",
    peer,
    reason: "connected",
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["ensure-player", "rust-keyframe", "toast"]);
  assert.equal(engine.multiplayerSnapshotTimer, 10);
});

test("Rust host applies only receipt-derived native pose state and ignores raw pose JSON", () => {
  const peer = {
    token: "invite_native_pose_001",
    identity: GUEST,
    state: "connected" as const,
    connectedAt: 1,
    lastSeenAt: 1,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  };
  let applied: { pose: Record<string, unknown>; custody: Record<string, unknown> } | null = null;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { role: "host", authorityMode: "rust-authoritative" },
    multiplayerPlayerStates: new Map(),
    ensureHostPlayerSession: () => playerState(),
    upsertRemotePlayer: (pose: Record<string, unknown>, _peer: unknown, custody: Record<string, unknown>) => {
      applied = { pose, custody };
    },
  });
  const rawPose = {
    playerId: GUEST.id, tick: 99, x: 999, y: 999, z: 999, yaw: 9, pitch: 1,
    vx: 99, vy: 99, vz: 99, grounded: false, selected: 8, action: "mine" as const,
  };
  (engine as unknown as { handleMultiplayerEvent(value: MultiplayerEvent): void }).handleMultiplayerEvent({
    type: "message",
    peer,
    channel: "movement",
    envelope: {
      version: 3,
      sessionId: SESSION_ID,
      type: "player-pose",
      sequence: 1,
      sentAt: 1,
      from: GUEST.id,
      payload: rawPose,
    },
  });
  assert.equal(applied, null, "raw pose JSON cannot enter Rust-authoritative remote state");
  assert.equal((engine.multiplayerPlayerStates as Map<string, PlayerSessionSnapshot>).size, 0);

  const hash = (digit: string) => digit.repeat(32);
  (engine as unknown as { handleMultiplayerEvent(value: MultiplayerEvent): void }).handleMultiplayerEvent({
    type: "native-player-pose",
    peer,
    channel: "reliable",
    connectionGeneration: 1,
    receipt: Object.freeze({
      schema: 1,
      sessionId: SESSION_ID,
      peerId: GUEST.id,
      connectionId: peer.token,
      commandId: `player-pose:${GUEST.id}:0`,
      commandSequence: 0,
      commandHash: hash("1"),
      authorityReceiptHash: hash("2"),
      presentedDeltaSequence: 1,
      presentedIdentityHash: IDENTITY.stateHash,
      recordRevision: 1,
      previousRecordHash: hash("0"),
      recordHash: hash("3"),
      pose: Object.freeze({
        schema: 1,
        playerId: GUEST.id,
        tick: 7,
        x: 4.25,
        y: 48.5,
        z: -3.75,
        yaw: 0.25,
        pitch: -0.1,
        vx: 1,
        vy: 0,
        vz: -0.5,
        grounded: true,
        selected: 2,
        shieldRaised: true,
        crouching: false,
        sprinting: true,
        action: "none",
        poseHash: hash("4"),
      }),
      receiptHash: hash("5"),
    }),
  });
  assert.ok(applied);
  const captured = applied as unknown as { pose: Record<string, unknown>; custody: Record<string, unknown> };
  assert.deepEqual(
    [captured.pose.x, captured.pose.y, captured.pose.z, captured.pose.tick],
    [4.25, 48.5, -3.75, 7],
  );
  assert.equal(captured.pose.variant, "female", "appearance comes from the host player session");
  assert.equal(captured.pose.selected, 2, "the native selected-slot intent is committed into host-owned state");
  assert.equal(captured.custody.receiptHash, hash("5"));
  assert.equal(captured.custody.recordHash, hash("3"));
});

test("Rust host reconnect installs a new-token zero cursor before its bootstrap keyframe", async () => {
  const peer = {
    token: "invite_reconnect_sequence_002",
    identity: GUEST,
    state: "connected" as const,
    connectedAt: 2,
    lastSeenAt: 2,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  };
  const previousToken = "invite_reconnect_sequence_001";
  let cursorAtBootstrap: Readonly<{ connectionToken: string; sequence: number }> | undefined;
  let recordRevisionAtBootstrap: number | undefined;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: {
      role: "host",
      authorityMode: "rust-authoritative",
      getPeers: () => [peer],
    },
    multiplayerState: { peers: [] },
    multiplayerSnapshotTimer: 0,
    multiplayerPeerScopeEpochs: new Map(),
    rustPeerDeltaSequences: new Map([[GUEST.id, Object.freeze({
      connectionToken: previousToken,
      sequence: 34,
    })]]),
    rustPeerPresentationRecordRevisions: new Map([[GUEST.id, 51]]),
    purgeIncompletePlayerProgressTransfersForPeer: () => undefined,
    clearRustPlayerProgressionReceiptForPeer: () => undefined,
    removeRemotePlayer: () => undefined,
    multiplayerBoatInputs: new Map(),
    boats: new Map(),
    sleepVotes: new Map(),
    multiplayerPeerActiveContainers: new Map(),
    multiplayerPeerActiveFacilities: new Map(),
    multiplayerPeerActiveMerchants: new Map(),
    hostRendezvous: null,
    evaluateSleepVotes: () => undefined,
    ensureHostPlayerSession: () => playerState(),
    publishRustAuthorityKeyframe: async () => {
      cursorAtBootstrap = (engine as unknown as {
        rustPeerDeltaSequences: Map<string, Readonly<{ connectionToken: string; sequence: number }>>;
      }).rustPeerDeltaSequences.get(GUEST.id);
      recordRevisionAtBootstrap = (engine as unknown as {
        rustPeerPresentationRecordRevisions: Map<string, number>;
      }).rustPeerPresentationRecordRevisions.get(GUEST.id);
    },
    trackRustAuthorityOperation: (operation: Promise<unknown>) => operation,
    events: { onToast: () => undefined },
    emitHud: () => undefined,
  });

  (engine as unknown as { handleMultiplayerEvent(value: MultiplayerEvent): void }).handleMultiplayerEvent({
    type: "peer",
    peer,
    reason: "connected",
  });
  await Promise.resolve();

  assert.deepEqual(cursorAtBootstrap, {
    connectionToken: peer.token,
    sequence: 0,
  }, "a fresh native receiver must start from connection-local sequence zero before bootstrap");
  assert.equal(recordRevisionAtBootstrap, 51,
    "the Rust replication record revision must remain stable across transport replacement");
  assert.deepEqual((engine as unknown as {
    rustPeerDeltaSequences: Map<string, Readonly<{ connectionToken: string; sequence: number }>>;
  }).rustPeerDeltaSequences.get(GUEST.id), {
    connectionToken: peer.token,
    sequence: 0,
  });

  const cursorAccess = engine as unknown as {
    rustPeerDeltaSequences: Map<string, Readonly<{ connectionToken: string; sequence: number }>>;
  };
  cursorAccess.rustPeerDeltaSequences.set(GUEST.id, Object.freeze({
    connectionToken: peer.token,
    sequence: 1,
  }));
  (engine as unknown as { handleMultiplayerEvent(value: MultiplayerEvent): void }).handleMultiplayerEvent({
    type: "peer",
    peer,
    reason: "hello-verified",
  });
  assert.deepEqual(cursorAccess.rustPeerDeltaSequences.get(GUEST.id), {
    connectionToken: peer.token,
    sequence: 1,
  }, "connected metadata events must not reuse the first delta sequence");

  (engine as unknown as { handleMultiplayerEvent(value: MultiplayerEvent): void }).handleMultiplayerEvent({
    type: "peer",
    peer: { ...peer, state: "stale" },
    reason: "connection-interrupted",
  });
  assert.deepEqual((engine as unknown as {
    rustPeerDeltaSequences: Map<string, Readonly<{ connectionToken: string; sequence: number }>>;
  }).rustPeerDeltaSequences.get(GUEST.id), {
    connectionToken: peer.token,
    sequence: 1,
  }, "a transient WebRTC interruption must retain the same native receiver cursor");

  (engine as unknown as { handleMultiplayerEvent(value: MultiplayerEvent): void }).handleMultiplayerEvent({
    type: "peer",
    peer: { ...peer, token: previousToken, state: "disconnected" },
    reason: "replaced-connection-closed",
  });
  assert.deepEqual((engine as unknown as {
    rustPeerDeltaSequences: Map<string, Readonly<{ connectionToken: string; sequence: number }>>;
  }).rustPeerDeltaSequences.get(GUEST.id), {
    connectionToken: peer.token,
    sequence: 1,
  }, "a late terminal event from the replaced token must not delete the new receiver cursor");
});

test("late old-token presentation work cannot advance the reconnect cursor and seq1 is a forced keyframe", async () => {
  const oldToken = "invite_reconnect_race_old_001";
  const newToken = "invite_reconnect_race_new_002";
  const peerFor = (token: string) => ({
    token,
    identity: GUEST,
    state: "connected" as const,
    connectedAt: token === oldToken ? 1 : 2,
    lastSeenAt: token === oldToken ? 1 : 2,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  });
  let activePeer = peerFor(oldToken);
  let secondDrainEntered!: () => void;
  let releaseSecondDrain!: () => void;
  const enteredSecondDrain = new Promise<void>((resolve) => { secondDrainEntered = resolve; });
  const secondDrainGate = new Promise<void>((resolve) => { releaseSecondDrain = resolve; });
  let drainCalls = 0;
  const records: Array<Readonly<{ recordId: string; revision: number; payload: Uint8Array }>> = [];
  const sent: Array<Readonly<{
    token: string;
    delta: Readonly<{ keyframe: boolean; sequence: number; deltaId: string }>;
  }>> = [];
  const disconnects: Array<readonly [string, string]> = [];
  const authority = {
    currentIdentity: () => IDENTITY,
    drain: async () => {
      drainCalls += 1;
      if (drainCalls === 2) {
        secondDrainEntered();
        await secondDrainGate;
      }
    },
    upsertReplicationRecord: async (command: {
      record: Readonly<{ recordId: string; revision: number; payload: Uint8Array }>;
    }) => { records.push(command.record); },
  };
  const session = {
    role: "host",
    authorityMode: "rust-authoritative",
    sessionId: SESSION_ID,
    identity: HOST,
    getPeers: () => [activePeer],
    getPeer: (peerId: string) => peerId === GUEST.id ? activePeer : undefined,
    freezeRustGuestCommands: async () => undefined,
    disconnectPeer: (peerOrToken: string, reason: string) => { disconnects.push([peerOrToken, reason]); },
    sendRustAuthorityDelta: async (
      delta: Readonly<{ keyframe: boolean; sequence: number; deltaId: string }>,
      token: string,
    ) => { sent.push(Object.freeze({ token, delta })); return 1; },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: session,
    rustRuntimeManager: {
      requireReady: () => ({ multiplayerAuthority: () => authority }),
    },
    rustPeerDeltaSequences: new Map([[GUEST.id, Object.freeze({
      connectionToken: oldToken,
      sequence: 34,
    })]]),
    rustPeerPresentationRecordRevisions: new Map([[GUEST.id, 51]]),
    rustPlayerProgressionReceipts: new Map(),
    rustAuthorityLastError: null,
    hostWorldSnapshot: () => worldSnapshot(),
    ensureHostPlayerProgression: () => structuredClone(presentation().playerProgression),
  });
  const access = engine as unknown as {
    rustPeerDeltaSequences: Map<string, Readonly<{ connectionToken: string; sequence: number }>>;
    rustPeerPresentationRecordRevisions: Map<string, number>;
    publishRustAuthorityPresentationNow(peerIds: readonly string[], keyframe: boolean): Promise<void>;
  };

  const oldWork = access.publishRustAuthorityPresentationNow([GUEST.id], false);
  await enteredSecondDrain;
  assert.equal(records.length, 1, "old-token work must have written its stable Rust record before the race");
  assert.equal(records[0]!.revision, 52);

  activePeer = peerFor(newToken);
  access.rustPeerDeltaSequences.set(GUEST.id, Object.freeze({
    connectionToken: newToken,
    sequence: 0,
  }));
  releaseSecondDrain();
  await oldWork;

  assert.equal(sent.length, 0, "work bound to the replaced token must never reach the new receiver");
  assert.deepEqual(access.rustPeerDeltaSequences.get(GUEST.id), {
    connectionToken: newToken,
    sequence: 0,
  }, "late old-token completion must not consume the new receiver's first sequence");
  assert.equal(access.rustPeerPresentationRecordRevisions.get(GUEST.id), 52,
    "the authority record remains globally monotonic even when an old transport send is skipped");

  await access.publishRustAuthorityPresentationNow([GUEST.id], false);

  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.revision), [52, 53],
    "record revisions must continue across reconnect even while transport sequence restarts");
  const reconnectDelta = createNetworkDeltaV1({
    sessionId: SESSION_ID,
    deltaId: "delta_reconnect_record_53_transport_1",
    peerId: GUEST.id,
    keyframe: true,
    sequence: 1,
    acknowledgedCommandSequence: 0,
    from: IDENTITY,
    to: IDENTITY,
    interestHash: "b".repeat(32),
    records: [{
      kind: "player",
      recordId: records[1]!.recordId,
      revision: records[1]!.revision,
      payload: records[1]!.payload,
    }],
  });
  const reconnectPresentation = decodeRustMultiplayerWorldPresentationV2({
    delta: reconnectDelta,
    sessionId: SESSION_ID,
    host: HOST,
    target: GUEST,
  });
  assert.equal(reconnectDelta.records[0]!.revision, 53);
  assert.equal(reconnectPresentation.deltaSequence, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.token, newToken);
  assert.equal(sent[0]!.delta.keyframe, true,
    "the first connection-local delta must be a keyframe even for a non-keyframe refresh request");
  assert.equal(sent[0]!.delta.sequence, 1);
  assert.match(sent[0]!.delta.deltaId, /_53_1$/u);
  assert.deepEqual(access.rustPeerDeltaSequences.get(GUEST.id), {
    connectionToken: newToken,
    sequence: 1,
  });
  assert.deepEqual(disconnects, []);
});

test("a reliable-channel close during presentation send cancels only that peer delivery", async () => {
  const token = "invite_transport_close_001";
  const peer = {
    token,
    identity: GUEST,
    state: "connected" as const,
    connectedAt: 1,
    lastSeenAt: 1,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  };
  let activePeer: typeof peer | undefined = peer;
  const disconnects: Array<readonly [string, string]> = [];
  const authority = {
    currentIdentity: () => IDENTITY,
    drain: async () => undefined,
    upsertReplicationRecord: async () => undefined,
  };
  const session = {
    role: "host",
    authorityMode: "rust-authoritative",
    sessionId: SESSION_ID,
    identity: HOST,
    getPeers: () => activePeer ? [activePeer] : [],
    getPeer: (peerId: string) => peerId === GUEST.id ? activePeer : undefined,
    freezeRustGuestCommands: async () => undefined,
    disconnectPeer: (peerOrToken: string, reason: string) => {
      disconnects.push([peerOrToken, reason]);
      activePeer = undefined;
    },
    sendRustAuthorityDelta: async () => {
      activePeer = undefined;
      throw new MultiplayerPeerTransportUnavailableError(0, 2);
    },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: session,
    rustRuntimeManager: {
      requireReady: () => ({ multiplayerAuthority: () => authority }),
    },
    rustPeerDeltaSequences: new Map([[GUEST.id, Object.freeze({
      connectionToken: token,
      sequence: 7,
    })]]),
    rustPeerPresentationRecordRevisions: new Map([[GUEST.id, 12]]),
    rustPlayerProgressionReceipts: new Map(),
    rustAuthorityLastError: "older settled diagnostic",
    hostWorldSnapshot: () => worldSnapshot(),
    ensureHostPlayerProgression: () => structuredClone(presentation().playerProgression),
    rustAuthorityPresentationInFlight: 0,
    rustNativeSaveQueued: false,
    rustNativeSaveOperation: null,
  });
  const access = engine as unknown as {
    rustPeerDeltaSequences: Map<string, Readonly<{ connectionToken: string; sequence: number }>>;
    rustPeerPresentationRecordRevisions: Map<string, number>;
    rustAuthorityLastError: string | null;
    publishRustAuthorityPresentationNow(peerIds: readonly string[], keyframe: boolean): Promise<void>;
  };

  await access.publishRustAuthorityPresentationNow([GUEST.id], false);

  assert.deepEqual(disconnects, []);
  assert.equal(access.rustAuthorityLastError, "older settled diagnostic",
    "an all-cancelled batch must neither add an error nor clear unrelated prior evidence");
  assert.deepEqual(access.rustPeerDeltaSequences.get(GUEST.id), {
    connectionToken: token,
    sequence: 7,
  }, "an undelivered connection-scoped delta must not advance the receiver cursor");
  assert.equal(access.rustPeerPresentationRecordRevisions.get(GUEST.id), 13,
    "the globally monotonic Rust record revision remains consumed after authority mutation");
});

test("a current-peer presentation send failure remains fail-closed", async () => {
  const token = "invite_active_transport_failure_001";
  const peer = {
    token,
    identity: GUEST,
    state: "connected" as const,
    connectedAt: 1,
    lastSeenAt: 1,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  };
  let activePeer: typeof peer | undefined = peer;
  const disconnects: Array<readonly [string, string]> = [];
  const authority = {
    currentIdentity: () => IDENTITY,
    drain: async () => undefined,
    upsertReplicationRecord: async () => undefined,
  };
  const session = {
    role: "host",
    authorityMode: "rust-authoritative",
    sessionId: SESSION_ID,
    identity: HOST,
    getPeers: () => activePeer ? [activePeer] : [],
    getPeer: (peerId: string) => peerId === GUEST.id ? activePeer : undefined,
    freezeRustGuestCommands: async () => undefined,
    disconnectPeer: (peerOrToken: string, reason: string) => {
      disconnects.push([peerOrToken, reason]);
      activePeer = undefined;
    },
    sendRustAuthorityDelta: async () => { throw new Error("active reliable send failed"); },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: session,
    rustRuntimeManager: {
      requireReady: () => ({ multiplayerAuthority: () => authority }),
    },
    rustPeerDeltaSequences: new Map([[GUEST.id, Object.freeze({
      connectionToken: token,
      sequence: 4,
    })]]),
    rustPeerPresentationRecordRevisions: new Map([[GUEST.id, 8]]),
    rustPlayerProgressionReceipts: new Map(),
    rustAuthorityLastError: null,
    hostWorldSnapshot: () => worldSnapshot(),
    ensureHostPlayerProgression: () => structuredClone(presentation().playerProgression),
    rustAuthorityPresentationInFlight: 0,
    rustNativeSaveQueued: false,
    rustNativeSaveOperation: null,
  });
  const access = engine as unknown as {
    rustPeerDeltaSequences: Map<string, Readonly<{ connectionToken: string; sequence: number }>>;
    rustAuthorityLastError: string | null;
    publishRustAuthorityPresentationNow(peerIds: readonly string[], keyframe: boolean): Promise<void>;
  };

  await assert.rejects(
    access.publishRustAuthorityPresentationNow([GUEST.id], false),
    /active reliable send failed/u,
  );

  assert.deepEqual(disconnects, [[token, "rust-presentation-send-failed"]]);
  assert.equal(access.rustAuthorityLastError, "active reliable send failed");
  assert.deepEqual(access.rustPeerDeltaSequences.get(GUEST.id), {
    connectionToken: token,
    sequence: 4,
  });
});

test("periodic Rust keyframes wait for the human guest's first post-presentation pose", async () => {
  const peer = {
    token: "invite_periodic_presentation_001",
    identity: GUEST,
    state: "connected" as const,
    connectedAt: 1,
    lastSeenAt: 1,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  };
  const keyframes: string[] = [];
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: {
      role: "host",
      state: "connected",
      authorityMode: "rust-authoritative",
      getPeers: () => [peer],
    },
    multiplayerTick: 0,
    multiplayerPoseTimer: 1,
    multiplayerWorldTimer: 1,
    multiplayerSnapshotTimer: 0,
    multiplayerPlayerStateTimer: 1,
    multiplayerProgressionTimer: 1,
    multiplayerContainerTimer: 1,
    agentObservationTimer: 1,
    agentMode: false,
    agentVoiceAssembler: { prune: () => 0 },
    agentDiagnostics: null,
    agentVoicePending: [],
    multiplayerCombatCooldowns: new Map(),
    remotePlayers: new Map(),
    flushDeferredRemoteBlockActions: () => undefined,
    retryCriticalReliableRequests: () => undefined,
    updateGuestContainerIntentRetries: () => undefined,
    flushPlayerProgressionTransfers: () => undefined,
    updateAgentRuntime: () => undefined,
    updateAgentBuildJobs: () => undefined,
    publishRustAuthorityKeyframe: async (peerId: string) => { keyframes.push(peerId); },
    trackRustAuthorityOperation: (operation: Promise<unknown>) => operation,
  });

  (engine as unknown as { updateMultiplayer(dt: number): void }).updateMultiplayer(0.016);
  await Promise.resolve();
  assert.deepEqual(keyframes, [], "the zero timer must not duplicate the connected bootstrap keyframe");

  (engine as unknown as { remotePlayers: Map<string, unknown> }).remotePlayers.set(GUEST.id, {});
  engine.multiplayerSnapshotTimer = 0;
  (engine as unknown as { updateMultiplayer(dt: number): void }).updateMultiplayer(0.016);
  await Promise.resolve();
  assert.deepEqual(keyframes, [GUEST.id]);
});

test("host interest rollover installs the refreshed grant before publishing its keyframe", async () => {
  const calls: string[] = [];
  let tracked: Promise<unknown> | null = null;
  const peer = {
    token: "invite_interest_rollover_001",
    identity: GUEST,
    state: "connected" as const,
    connectedAt: 1,
    lastSeenAt: 1,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: {
      role: "host",
      sessionId: SESSION_ID,
      identity: HOST,
      refreshRustPeerGrant: async (peerId: string) => {
        calls.push(`refresh:${peerId}:start`);
        await Promise.resolve();
        calls.push(`refresh:${peerId}:complete`);
      },
      disconnectPeer: () => assert.fail("a successful rollover must not disconnect the peer"),
    },
    rustPeerInterestCenters: new Map<string, string>(),
    rustInterestCenter: () => ({ centerX: 16, centerZ: 0, localChunkX: 0, localChunkZ: 0 }),
    publishRustAuthorityKeyframe: async (peerId: string) => { calls.push(`keyframe:${peerId}`); },
    trackRustAuthorityOperation: (operation: Promise<unknown>) => {
      tracked = operation;
      return operation;
    },
    rustAuthorityLastError: null,
  });

  (engine as unknown as { refreshRustPeerInterestIfMoved(peerInfo: typeof peer): void })
    .refreshRustPeerInterestIfMoved(peer);
  assert.ok(tracked, "the rollover must be tracked as a serialized Rust authority operation");
  await tracked;

  assert.deepEqual(calls, [
    `refresh:${GUEST.id}:start`,
    `refresh:${GUEST.id}:complete`,
    `keyframe:${GUEST.id}`,
  ]);
  assert.equal((engine as unknown as { rustAuthorityLastError: string | null }).rustAuthorityLastError, null);
});

test("Rust guest queues overdue progression before state and holds state through transport completion", () => {
  const calls: string[] = [];
  const sentStates: PlayerSessionSnapshot[] = [];
  const outgoing: Array<{ action: { status: "request" } }> = [];
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: {
      role: "guest",
      state: "connected",
      authorityMode: "rust-authoritative",
      identity: GUEST,
      isRustGuestPresentationReady: () => true,
      sendPlayerState: (action: { state: PlayerSessionSnapshot }) => {
        calls.push("state");
        sentStates.push(structuredClone(action.state));
        return 1;
      },
    },
    multiplayerReceivedSnapshot: true,
    multiplayerProgressionReceived: true,
    multiplayerProgressOutgoing: outgoing,
    multiplayerTick: 0,
    multiplayerPoseTimer: 1,
    multiplayerPoseHeartbeatTimer: 1,
    multiplayerWorldTimer: 1,
    multiplayerSnapshotTimer: 1,
    multiplayerPlayerStateTimer: 0,
    multiplayerProgressionTimer: 0,
    multiplayerContainerTimer: 1,
    agentObservationTimer: 1,
    agentMode: false,
    agentVoiceAssembler: { prune: () => 0 },
    agentDiagnostics: null,
    agentVoicePending: [],
    multiplayerCombatCooldowns: new Map(),
    pendingGuestPlacementRequests: new Map(),
    pendingGuestCreatureInventoryRequests: new Map(),
    activeNetworkContainerId: null,
    activeNetworkFacilityId: null,
    multiplayerPlayerStateRevision: 3,
    multiplayerPlayerStateSignature: "host-baseline",
    flushDeferredRemoteBlockActions: () => undefined,
    retryCriticalReliableRequests: () => undefined,
    updateGuestContainerIntentRetries: () => undefined,
    flushPlayerProgressionTransfers: () => {
      if (!outgoing.length) return;
      calls.push("flush-progression");
      outgoing.length = 0;
      const pending = (engine as unknown as {
        multiplayerPendingProgressionTransfer: { transportComplete: boolean };
      }).multiplayerPendingProgressionTransfer;
      (engine as unknown as { multiplayerPendingProgressionTransfer: unknown }).multiplayerPendingProgressionTransfer = {
        ...pending,
        transportComplete: true,
      };
    },
    syncMultiplayerPlayerProgression: () => {
      calls.push("progression");
      outgoing.push({ action: { status: "request" } });
      (engine as unknown as { multiplayerPendingProgressionTransfer: unknown }).multiplayerPendingProgressionTransfer = {
        revision: 8,
        signature: "pending-progression",
        transferId: "progress_pending_order",
        transportComplete: false,
      };
    },
    localPlayerSessionSnapshot: () => playerState(),
  });

  const update = () => (engine as unknown as { updateMultiplayer(dt: number): void }).updateMultiplayer(0.016);
  update();
  assert.deepEqual(calls, ["progression"], "a newly queued progression transfer must suppress state publication");
  assert.equal(sentStates.length, 0);

  engine.multiplayerPlayerStateTimer = 0;
  update();
  assert.deepEqual(calls, ["progression", "flush-progression"]);
  assert.equal(sentStates.length, 0, "transport completion alone is not host acceptance");

  (engine as unknown as { multiplayerPendingProgressionTransfer: unknown }).multiplayerPendingProgressionTransfer = null;
  engine.multiplayerPlayerStateTimer = 0;
  update();
  assert.deepEqual(calls, ["progression", "flush-progression", "state"]);
  assert.equal(sentStates.length, 1, "state may publish only after authority settles the pending progression");
});

test("Rust guest retains a partially transported progression across an old keyframe and accepts its committed revision", async () => {
  const chunks: Array<{ action: PlayerProgressAction }> = [0, 1].map((chunkIndex) => ({
    action: {
      transferId: "progress_pending_8",
      actorId: GUEST.id,
      revision: 8,
      chunkIndex,
      chunkCount: 2,
      data: `chunk-${chunkIndex}`,
      status: "request",
    },
  }));
  const fixture = pendingProgressionGuestFixture(chunks);

  fixture.access.flushPlayerProgressionTransfers(1);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer?.transportComplete, false);

  await fixture.applyPresentation(7, 20);
  assert.deepEqual(fixture.disconnects, []);
  assert.equal(fixture.engine.multiplayerProgressionRevision, 7, "the old keyframe is equal to confirmed authority, not a regression");
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer?.revision, 8, "unsent chunks keep their pending claim");
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer?.transportComplete, false);

  fixture.access.flushPlayerProgressionTransfers(1);
  assert.equal(fixture.sent.length, 2);
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer?.transportComplete, true);

  await fixture.applyPresentation(8, 21, {
    transferId: "progress_pending_8",
    status: "accepted",
    committedRevision: 8,
  });
  assert.deepEqual(fixture.disconnects, []);
  assert.equal(fixture.engine.multiplayerProgressionRevision, 8);
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer, null);
  assert.deepEqual(fixture.appliedMapRevisions, [8, 8], "each host image applies one reconciled local result");
  assert.equal(fixture.localRevision(), 8);
  assert.deepEqual(fixture.confirmations, [20, 21]);
});

test("same-confirmed Rust presentation preserves dirty local progression and queues it before state can race", async () => {
  const fixture = pendingProgressionGuestFixture([]);
  fixture.access.multiplayerPendingProgressionTransfer = null;

  await fixture.applyPresentation(7, 22);

  assert.deepEqual(fixture.disconnects, []);
  assert.equal(fixture.engine.multiplayerProgressionRevision, 7);
  assert.equal(fixture.engine.multiplayerProgressionSignature, "progression-7");
  assert.equal(fixture.localRevision(), 8, "the same-confirmed echo must not erase an unqueued local mutation");
  const pending = (fixture.engine as unknown as {
    multiplayerPendingProgressionTransfer: PendingProgressionView | null;
  }).multiplayerPendingProgressionTransfer;
  assert.equal(pending?.revision, 8);
  assert.equal(pending?.signature, "progression-8");
  assert.equal(pending?.transportComplete, false);
  assert.ok((fixture.engine as unknown as { multiplayerProgressOutgoing: unknown[] }).multiplayerProgressOutgoing.length > 0);
  assert.deepEqual(fixture.appliedMapRevisions, [8]);
  assert.deepEqual(fixture.confirmations, [22]);
});

test("accepted Rust progression preserves its newer local tail and purges unsent settled chunks", async () => {
  const oldChunks: Array<{ action: PlayerProgressAction }> = [0, 1].map((chunkIndex) => ({
    action: {
      transferId: "progress_pending_8",
      actorId: GUEST.id,
      revision: 8,
      chunkIndex,
      chunkCount: 2,
      data: `old-${chunkIndex}`,
      status: "request",
    },
  }));
  const fixture = pendingProgressionGuestFixture(oldChunks);
  fixture.setLocalRevision(9);
  fixture.access.multiplayerPendingProgressionTransfer = {
    ...fixture.access.multiplayerPendingProgressionTransfer!,
    transportComplete: true,
  };

  await fixture.applyPresentation(8, 23, {
    transferId: "progress_pending_8",
    status: "accepted",
    committedRevision: 8,
  });

  assert.deepEqual(fixture.disconnects, []);
  assert.equal(fixture.engine.multiplayerProgressionRevision, 8);
  assert.equal(fixture.engine.multiplayerProgressionSignature, "progression-8");
  assert.equal(fixture.localRevision(), 9, "mutations made after the pending snapshot must survive its acceptance");
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer?.revision, 9);
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer?.signature, "progression-9");
  const remaining = (fixture.engine as unknown as {
    multiplayerProgressOutgoing: Array<{ action: PlayerProgressAction }>;
  }).multiplayerProgressOutgoing;
  assert.ok(remaining.length > 0, "the preserved tail must queue immediately as the next confirmed revision");
  assert.equal(remaining.some((entry) => entry.action.transferId === "progress_pending_8"), false,
    "settlement must purge every unsent chunk from the superseded transfer");
  assert.ok(remaining.every((entry) => entry.action.transferId === fixture.access.multiplayerPendingProgressionTransfer?.transferId));
  assert.deepEqual(fixture.appliedMapRevisions, [9]);
  assert.deepEqual(fixture.confirmations, [23]);
});

test("Rust guest rebases an exactly rejected transfer onto the returned host image", async () => {
  const finalChunk: Array<{ action: PlayerProgressAction }> = [{
    action: {
      transferId: "progress_pending_8",
      actorId: GUEST.id,
      revision: 8,
      chunkIndex: 1,
      chunkCount: 2,
      data: "final-chunk",
      status: "request",
    },
  }];
  const fixture = pendingProgressionGuestFixture(finalChunk);

  fixture.access.flushPlayerProgressionTransfers(1);
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer?.transportComplete, true);
  await fixture.applyPresentation(7, 30, {
    transferId: "progress_pending_8",
    status: "rejected",
    committedRevision: 7,
  });

  assert.deepEqual(fixture.disconnects, []);
  assert.equal(fixture.engine.multiplayerProgressionRevision, 7);
  assert.notEqual(fixture.access.multiplayerPendingProgressionTransfer?.transferId, "progress_pending_8");
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer?.revision, 8,
    "the rejected change is retried on the exact current host revision");
  assert.deepEqual(fixture.appliedMapRevisions, [8]);
  assert.equal(fixture.engine.multiplayerProgressionSignature, "progression-7");
  assert.deepEqual(fixture.confirmations, [30]);
});

test("accepted Rust progression three-way merges an independent concurrent host change", async () => {
  const fixture = pendingProgressionGuestFixture([]);
  fixture.access.multiplayerPendingProgressionTransfer = {
    ...fixture.access.multiplayerPendingProgressionTransfer!,
    transportComplete: true,
  };
  const authoritative = progressionAtRevision(8);
  authoritative.bankAccount = {
    ...authoritative.bankAccount,
    revision: authoritative.bankAccount.revision + 1,
    balanceMicroGold: "5000000",
  };

  await fixture.applyPresentation(8, 31, {
    transferId: "progress_pending_8",
    status: "accepted",
    committedRevision: 8,
  }, authoritative);

  assert.deepEqual(fixture.disconnects, []);
  assert.equal(fixture.localRevision(), 8);
  assert.equal(fixture.localState().bankAccount.balanceMicroGold, "5000000");
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer, null);
});

test("newer Rust authority three-way merges around dirty unqueued local progression", async () => {
  const fixture = pendingProgressionGuestFixture([]);
  fixture.access.multiplayerPendingProgressionTransfer = null;
  const authoritative = progressionAtRevision(7);
  authoritative.bankAccount = {
    ...authoritative.bankAccount,
    revision: authoritative.bankAccount.revision + 1,
    balanceMicroGold: "7000000",
  };

  await fixture.applyPresentation(8, 32, null, authoritative);

  assert.deepEqual(fixture.disconnects, []);
  assert.equal(fixture.localRevision(), 8, "the unqueued local map edit survives a disjoint host change");
  assert.equal(fixture.localState().bankAccount.balanceMicroGold, "7000000");
  assert.equal((fixture.engine as unknown as {
    multiplayerPendingProgressionTransfer: PendingProgressionView | null;
  }).multiplayerPendingProgressionTransfer?.revision, 9,
    "the preserved local edit is queued on top of the newer host revision");
});

test("a true Rust progression merge conflict fails before progression mutation", async () => {
  const fixture = pendingProgressionGuestFixture([]);
  fixture.access.multiplayerPendingProgressionTransfer = null;

  await fixture.applyPresentation(8, 33, null, progressionAtRevision(9));

  assert.deepEqual(fixture.disconnects, ["rust-presentation-invalid"]);
  assert.equal(fixture.localRevision(), 8);
  assert.equal(fixture.engine.multiplayerProgressionRevision, 7);
  assert.deepEqual(fixture.appliedMapRevisions, []);
  assert.match((fixture.engine as unknown as { rustAuthorityLastError: string }).rustAuthorityLastError, /conflicting/iu);
});

test("wrong and repeated Rust receipts never settle a different pending transfer", async () => {
  const fixture = pendingProgressionGuestFixture([]);
  fixture.access.multiplayerPendingProgressionTransfer = {
    ...fixture.access.multiplayerPendingProgressionTransfer!,
    transportComplete: true,
  };

  await fixture.applyPresentation(7, 34, {
    transferId: "progress_unrelated_8",
    status: "rejected",
    committedRevision: 7,
  });
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer?.transferId, "progress_pending_8");

  await fixture.applyPresentation(8, 35, {
    transferId: "progress_pending_8",
    status: "accepted",
    committedRevision: 8,
  });
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer, null);

  fixture.setLocalRevision(9);
  await fixture.applyPresentation(8, 36);
  const nextTransferId = (fixture.engine as unknown as {
    multiplayerPendingProgressionTransfer: PendingProgressionView | null;
  }).multiplayerPendingProgressionTransfer?.transferId;
  assert.ok(nextTransferId && nextTransferId !== "progress_pending_8");

  await fixture.applyPresentation(8, 37, {
    transferId: "progress_pending_8",
    status: "accepted",
    committedRevision: 8,
  });
  assert.equal((fixture.engine as unknown as {
    multiplayerPendingProgressionTransfer: PendingProgressionView | null;
  }).multiplayerPendingProgressionTransfer?.transferId, nextTransferId);
  assert.deepEqual(fixture.disconnects, []);
});

test("an exact Rust collision rejection rebases the request over disjoint host authority", async () => {
  const fixture = pendingProgressionGuestFixture([]);
  fixture.access.multiplayerPendingProgressionTransfer = {
    ...fixture.access.multiplayerPendingProgressionTransfer!,
    transportComplete: true,
  };
  const authoritative = progressionAtRevision(7);
  authoritative.bankAccount = {
    ...authoritative.bankAccount,
    revision: authoritative.bankAccount.revision + 1,
    balanceMicroGold: "9000000",
  };

  await fixture.applyPresentation(8, 38, {
    transferId: "progress_pending_8",
    status: "rejected",
    committedRevision: 8,
  }, authoritative);

  assert.deepEqual(fixture.disconnects, []);
  assert.equal(fixture.localRevision(), 8);
  assert.equal(fixture.localState().bankAccount.balanceMicroGold, "9000000");
  assert.equal(fixture.access.multiplayerPendingProgressionTransfer?.revision, 9);
  assert.notEqual(fixture.access.multiplayerPendingProgressionTransfer?.transferId, "progress_pending_8");
});

test("Rust guest still fails closed when a presentation regresses confirmed progression", async () => {
  const fixture = pendingProgressionGuestFixture([]);
  fixture.access.multiplayerPendingProgressionTransfer = null;

  await fixture.applyPresentation(6, 40);

  assert.deepEqual(fixture.disconnects, ["rust-presentation-invalid"]);
  assert.equal(fixture.engine.multiplayerProgressionRevision, 7);
  assert.equal(fixture.engine.multiplayerReceivedSnapshot, false);
  assert.match((fixture.engine as unknown as { rustAuthorityLastError: string }).rustAuthorityLastError, /regressed/iu);
});

test("Rust host publishes progression authority after final reassembly instead of a legacy ack", () => {
  const current = normalizeMultiplayerPlayerProgression(null, GUEST.id, "presentation-world");
  const next = {
    ...current,
    mapKnowledge: { ...current.mapKnowledge, revision: current.mapKnowledge.revision + 1 },
  };
  const chunks = encodePlayerProgressionChunks(next);
  const published: string[] = [];
  const legacyAcks: PlayerProgressAction[] = [];
  const stored = new Map([[GUEST.id, { revision: 7, state: current }]]);
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: {
      role: "host",
      authorityMode: "rust-authoritative",
      sendPlayerProgress: (action: PlayerProgressAction) => { legacyAcks.push(action); return 1; },
    },
    multiplayerProgressTransfers: new Map(),
    multiplayerProgressOutgoing: [],
    multiplayerPlayerProgressions: stored,
    ensureHostPlayerProgression: () => stored.get(GUEST.id)!,
    saveSoon: () => undefined,
    sendAuthoritativePlayerProgression: (identity: PeerIdentity) => { published.push(identity.id); },
  });
  const receive = engine as unknown as {
    handleRemotePlayerProgress(action: PlayerProgressAction, peer: { token: string; identity: PeerIdentity }): void;
  };
  chunks.forEach((data, chunkIndex) => receive.handleRemotePlayerProgress({
    transferId: "progress_host_commit_8",
    actorId: GUEST.id,
    revision: 8,
    chunkIndex,
    chunkCount: chunks.length,
    data,
    status: "request",
  }, { token: "peer_host_commit_001", identity: GUEST }));

  assert.equal(stored.get(GUEST.id)?.revision, 8);
  assert.deepEqual(published, [GUEST.id]);
  assert.deepEqual(legacyAcks, []);
  assert.deepEqual((engine as unknown as {
    rustPlayerProgressionReceipts: Map<string, { connectionToken: string; receipt: RustMultiplayerProgressionReceiptV2 }>;
  }).rustPlayerProgressionReceipts.get(GUEST.id)?.receipt, {
    transferId: "progress_host_commit_8",
    status: "accepted",
    committedRevision: 8,
  });
});

test("Rust host rejects an exact revision collision with a transfer-specific receipt", () => {
  const current = progressionAtRevision(7);
  const colliding = { ...current, mapKnowledge: { ...current.mapKnowledge, revision: 8 } };
  const chunks = encodePlayerProgressionChunks(colliding);
  const stored = new Map([[GUEST.id, { revision: 8, state: current }]]);
  const published: string[] = [];
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { role: "host", authorityMode: "rust-authoritative" },
    multiplayerProgressTransfers: new Map(),
    multiplayerProgressOutgoing: [],
    multiplayerPlayerProgressions: stored,
    ensureHostPlayerProgression: () => stored.get(GUEST.id)!,
    sendAuthoritativePlayerProgression: (identity: PeerIdentity) => { published.push(identity.id); },
  });
  const receive = engine as unknown as {
    handleRemotePlayerProgress(action: PlayerProgressAction, peer: { token: string; identity: PeerIdentity }): void;
  };
  chunks.forEach((data, chunkIndex) => receive.handleRemotePlayerProgress({
    transferId: "progress_host_collision_8",
    actorId: GUEST.id,
    revision: 8,
    chunkIndex,
    chunkCount: chunks.length,
    data,
    status: "request",
  }, { token: "peer_host_collision_001", identity: GUEST }));

  assert.equal(stored.get(GUEST.id)?.state.mapKnowledge.revision, 7, "a colliding request must not replace host state");
  assert.deepEqual(published, [GUEST.id]);
  assert.deepEqual((engine as unknown as {
    rustPlayerProgressionReceipts: Map<string, { connectionToken: string; receipt: RustMultiplayerProgressionReceiptV2 }>;
  }).rustPlayerProgressionReceipts.get(GUEST.id)?.receipt, {
    transferId: "progress_host_collision_8",
    status: "rejected",
    committedRevision: 8,
  });
});

test("legacy acknowledgement cannot invent authority and settles only the exact completed pending transfer", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { role: "guest", authorityMode: "legacy-compatibility", identity: GUEST },
    multiplayerProgressTransfers: new Map(),
    multiplayerProgressOutgoing: [{
      action: {
        transferId: "progress_legacy_8",
        actorId: GUEST.id,
        revision: 8,
        chunkIndex: 1,
        chunkCount: 2,
        data: "unsent",
        status: "request",
      },
    }],
    multiplayerProgressionRevision: 7,
    multiplayerProgressionReceived: true,
    multiplayerProgressionSignature: "host-7",
    multiplayerProgressionConfirmedState: progressionAtRevision(7),
    multiplayerPendingProgressionTransfer: null,
    localPlayerProgressionSignature: () => "local-8",
  });
  const receive = engine as unknown as {
    handleRemotePlayerProgress(action: PlayerProgressAction, peer: { identity: PeerIdentity }): void;
    multiplayerPendingProgressionTransfer: PendingProgressionView | null;
  };

  receive.handleRemotePlayerProgress({
    transferId: "progress_unsolicited_99",
    actorId: GUEST.id,
    revision: 99,
    status: "accepted",
  }, { identity: HOST });
  assert.equal(engine.multiplayerProgressionRevision, 7, "an unsolicited bodyless ack carries no authority");

  receive.multiplayerPendingProgressionTransfer = {
    revision: 8,
    signature: "local-8",
    transferId: "progress_legacy_8",
    transportComplete: false,
    baseState: progressionAtRevision(7),
    requestState: progressionAtRevision(8),
  };
  receive.handleRemotePlayerProgress({
    transferId: "progress_legacy_8",
    actorId: GUEST.id,
    revision: 8,
    status: "accepted",
  }, { identity: HOST });
  assert.equal(engine.multiplayerProgressionRevision, 7, "an ack cannot overtake the final local transport send");
  assert.equal(receive.multiplayerPendingProgressionTransfer?.transportComplete, false);

  receive.multiplayerPendingProgressionTransfer = {
    ...receive.multiplayerPendingProgressionTransfer!,
    transportComplete: true,
  };
  receive.handleRemotePlayerProgress({
    transferId: "progress_wrong_transfer",
    actorId: GUEST.id,
    revision: 8,
    status: "accepted",
  }, { identity: HOST });
  assert.equal(engine.multiplayerProgressionRevision, 7);
  assert.notEqual(receive.multiplayerPendingProgressionTransfer, null);

  receive.handleRemotePlayerProgress({
    transferId: "progress_legacy_8",
    actorId: GUEST.id,
    revision: 8,
    status: "accepted",
  }, { identity: HOST });

  assert.equal(engine.multiplayerProgressionRevision, 8);
  assert.equal(engine.multiplayerProgressionSignature, "local-8");
  assert.equal(receive.multiplayerPendingProgressionTransfer, null);
  assert.deepEqual((engine as unknown as { multiplayerProgressOutgoing: unknown[] }).multiplayerProgressOutgoing, [],
    "settlement removes any exact-transfer chunks left in the local queue");
});

test("Rust mode ignores a bodyless legacy acknowledgement even when its transfer id matches", () => {
  const pending = {
    revision: 8,
    signature: "local-8",
    transferId: "progress_rust_exact_8",
    transportComplete: true,
    baseState: progressionAtRevision(7),
    requestState: progressionAtRevision(8),
  } satisfies PendingProgressionView;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { role: "guest", authorityMode: "rust-authoritative", identity: GUEST },
    multiplayerProgressTransfers: new Map(),
    multiplayerProgressOutgoing: [],
    multiplayerPendingProgressionTransfer: pending,
    multiplayerProgressionRevision: 7,
  });
  (engine as unknown as {
    handleRemotePlayerProgress(action: PlayerProgressAction, peer: { identity: PeerIdentity }): void;
  }).handleRemotePlayerProgress({
    transferId: pending.transferId,
    actorId: GUEST.id,
    revision: pending.revision,
    status: "accepted",
  }, { identity: HOST });

  assert.equal((engine as unknown as {
    multiplayerPendingProgressionTransfer: PendingProgressionView | null;
  }).multiplayerPendingProgressionTransfer, pending);
  assert.equal(engine.multiplayerProgressionRevision, 7);
});

test("legacy authoritative progression image settles and rolls back a completed rejected transfer", () => {
  const authoritative = normalizeMultiplayerPlayerProgression(null, GUEST.id, "presentation-world");
  const chunks = encodePlayerProgressionChunks(authoritative);
  const applied: PlayerProgressionSnapshot[] = [];
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { role: "guest", authorityMode: "legacy-compatibility", identity: GUEST },
    multiplayerProgressTransfers: new Map(),
    multiplayerProgressOutgoing: [],
    multiplayerProgressionRevision: 7,
    multiplayerProgressionReceived: true,
    multiplayerProgressionSignature: "host-7",
    multiplayerProgressionConfirmedState: progressionAtRevision(7),
    multiplayerPendingProgressionTransfer: {
      revision: 8,
      signature: "local-8",
      transferId: "progress_legacy_request_8",
      transportComplete: true,
      baseState: progressionAtRevision(7),
      requestState: progressionAtRevision(8),
    } satisfies PendingProgressionView,
    applyLocalPlayerProgression: (state: PlayerProgressionSnapshot) => { applied.push(state); },
    localPlayerProgressionSnapshot: () => progressionAtRevision(8),
    playerProgressionSignature: () => "host-7-restored",
    localPlayerProgressionSignature: () => "host-7-restored",
  });
  const receive = engine as unknown as {
    handleRemotePlayerProgress(action: PlayerProgressAction, peer: { identity: PeerIdentity }): void;
  };
  chunks.forEach((data, chunkIndex) => receive.handleRemotePlayerProgress({
    transferId: "progress_legacy_host_7",
    actorId: GUEST.id,
    revision: 7,
    chunkIndex,
    chunkCount: chunks.length,
    data,
    status: "accepted",
  }, { identity: HOST }));

  assert.equal(engine.multiplayerProgressionRevision, 7);
  assert.equal(engine.multiplayerProgressionSignature, "host-7-restored");
  assert.equal((engine as unknown as { multiplayerPendingProgressionTransfer: unknown }).multiplayerPendingProgressionTransfer, null);
  assert.equal(applied.length, 1);
});

test("progression state reset clears confirmed metadata and transport for every lifecycle boundary", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayerProgressTransfers: new Map([["inbound", {}]]),
    multiplayerProgressOutgoing: [{ action: { status: "request" } }],
    multiplayerProgressionRevision: 7,
    multiplayerProgressionReceived: true,
    multiplayerProgressionTimer: 5,
    multiplayerProgressionSignature: "host-7",
    multiplayerProgressionConfirmedState: progressionAtRevision(7),
    rustPlayerProgressionReceipts: new Map([[GUEST.id, {
      transferId: "progress_reset_8",
      status: "accepted",
      committedRevision: 8,
    }]]),
    multiplayerProgressionTransferSequence: 9,
    multiplayerPendingProgressionTransfer: {
      revision: 8,
      signature: "local-8",
      transferId: "progress_reset_8",
      transportComplete: false,
      baseState: progressionAtRevision(7),
      requestState: progressionAtRevision(8),
    } satisfies PendingProgressionView,
  });
  (engine as unknown as { resetMultiplayerProgressionState(timer?: number): void }).resetMultiplayerProgressionState(1);

  assert.equal((engine as unknown as { multiplayerProgressTransfers: Map<string, unknown> }).multiplayerProgressTransfers.size, 0);
  assert.deepEqual((engine as unknown as { multiplayerProgressOutgoing: unknown[] }).multiplayerProgressOutgoing, []);
  assert.equal((engine as unknown as { multiplayerPendingProgressionTransfer: unknown }).multiplayerPendingProgressionTransfer, null);
  assert.equal((engine as unknown as { multiplayerProgressionConfirmedState: unknown }).multiplayerProgressionConfirmedState, null);
  assert.equal((engine as unknown as { rustPlayerProgressionReceipts: Map<string, unknown> }).rustPlayerProgressionReceipts.size, 0);
  assert.equal((engine as unknown as { multiplayerProgressionTransferSequence: number }).multiplayerProgressionTransferSequence, 0);
  assert.equal(engine.multiplayerProgressionRevision, 0);
  assert.equal(engine.multiplayerProgressionReceived, false);
  assert.equal(engine.multiplayerProgressionTimer, 1);
  assert.equal(engine.multiplayerProgressionSignature, "");
});

test("progression and presentation diagnostics stay bounded without exposing private progression", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const pending = {
    revision: 8,
    signature: "private-local-signature",
    transferId: "progress_diagnostics_8",
    transportComplete: true,
    baseState: progressionAtRevision(7),
    requestState: progressionAtRevision(8),
  } satisfies PendingProgressionView;
  Object.assign(engine, {
    multiplayer: {
      getPeer: (peerId: string) => peerId === HOST.id ? { token: "peer_diagnostics_001" } : null,
    },
    multiplayerPendingProgressionTransfer: pending,
    multiplayerProgressOutgoing: [
      { action: { transferId: pending.transferId, status: "request" } },
      { action: { transferId: pending.transferId, status: "request" } },
      { action: { transferId: "accepted", status: "accepted" } },
    ],
    multiplayerProgressionReceived: true,
    multiplayerProgressionRevision: 7,
    multiplayerProgressionConfirmedState: progressionAtRevision(7),
    multiplayerProgressionSignature: "confirmed-signature",
    localPlayerProgressionSignature: () => "private-local-signature",
    multiplayerLatestProgressionReceipt: {
      direction: "guest-observed",
      peerId: HOST.id,
      connectionToken: "peer_diagnostics_001",
      transferId: pending.transferId,
      status: "accepted",
      committedRevision: 8,
      observedAt: 1234,
    },
    rustGuestPresentationQueueDepth: 2,
    rustGuestPresentationInFlight: 1,
    rustAuthorityPresentationRequests: new Map([[GUEST.id, {}]]),
    rustAuthorityPresentationPump: Promise.resolve(),
    rustAuthorityOperations: new Set([Promise.resolve()]),
  });
  const diagnostics = engine as unknown as {
    multiplayerProgressionDiagnosticsSnapshot(): {
      pending: { transferId: string; revision: number; transportComplete: boolean } | null;
      outgoingRequestChunks: number;
      outgoingRequestTransfers: number;
      confirmed: boolean;
      confirmedRevision: number | null;
      localDirty: boolean | null;
      latestReceipt: { connectionCurrent: boolean | null; status: string; committedRevision: number } | null;
    };
    multiplayerPresentationDiagnosticsSnapshot(): {
      guestQueued: number;
      guestInFlight: number;
      hostQueuedPeers: number;
      hostPumpActive: boolean;
      authorityOperations: number;
    };
  };

  const progression = diagnostics.multiplayerProgressionDiagnosticsSnapshot();
  assert.deepEqual(progression.pending, {
    transferId: pending.transferId,
    revision: 8,
    transportComplete: true,
  });
  assert.equal(progression.outgoingRequestChunks, 2);
  assert.equal(progression.outgoingRequestTransfers, 1);
  assert.equal(progression.confirmed, true);
  assert.equal(progression.confirmedRevision, 7);
  assert.equal(progression.localDirty, true);
  assert.equal(progression.latestReceipt?.connectionCurrent, true);
  assert.equal(progression.latestReceipt?.status, "accepted");
  assert.equal(progression.latestReceipt?.committedRevision, 8);
  assert.doesNotMatch(JSON.stringify(progression), /questBook|mapKnowledge|baseState|requestState|private-local-signature/u);
  assert.deepEqual(diagnostics.multiplayerPresentationDiagnosticsSnapshot(), {
    guestQueued: 2,
    guestInFlight: 1,
    hostQueuedPeers: 1,
    hostPumpActive: true,
    authorityOperations: 1,
  });
});

test("progression gameplay freeze leases are nested, idempotent, and never reopen gameplay on release", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  engine.paused = false;
  const access = engine as unknown as {
    acquireMultiplayerProgressionGameplayFreeze(): (restorePriorPause?: boolean) => void;
    multiplayerProgressionGameplayFrozen(): boolean;
    multiplayerProgressionDrainDepth: number;
  };

  const releaseOuter = access.acquireMultiplayerProgressionGameplayFreeze();
  const releaseInner = access.acquireMultiplayerProgressionGameplayFreeze();
  assert.equal(access.multiplayerProgressionGameplayFrozen(), true);
  assert.equal(access.multiplayerProgressionDrainDepth, 2);
  assert.equal(engine.paused, true);

  releaseOuter();
  assert.equal(access.multiplayerProgressionDrainDepth, 1);
  assert.equal(engine.paused, true, "an inner lease still owns the gameplay freeze");
  releaseOuter();
  assert.equal(access.multiplayerProgressionDrainDepth, 1, "a lease release is idempotent");

  releaseInner();
  assert.equal(access.multiplayerProgressionGameplayFrozen(), false);
  assert.equal(access.multiplayerProgressionDrainDepth, 0);
  assert.equal(engine.paused, true, "the final release cannot overwrite a concurrent fail-closed pause");

  engine.paused = false;
  const retainPause = access.acquireMultiplayerProgressionGameplayFreeze();
  retainPause();
  assert.equal(access.multiplayerProgressionGameplayFrozen(), false);
  assert.equal(engine.paused, true, "every acquired drain establishes an irreversible pause boundary");
});

test("activate and pause cannot reopen gameplay or request pointer lock during a progression freeze", () => {
  let pointerLockRequests = 0;
  let inputClears = 0;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    paused: false,
    multiplayer: { state: "connected" },
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHost: { diagnostics: () => ({ state: "ready" }) },
    audio: { unlock: async () => undefined },
    touchMode: false,
    agentMode: false,
    requestPointerLockSafely: () => { pointerLockRequests += 1; },
    clearInput: () => { inputClears += 1; },
    spellKeyState: false,
    spellWheelOpen: false,
    mineHeld: true,
  });
  const access = engine as unknown as {
    acquireMultiplayerProgressionGameplayFreeze(): () => void;
  };
  const release = access.acquireMultiplayerProgressionGameplayFreeze();

  engine.paused = false; // Simulate a late UI callback attempting to reopen gameplay.
  engine.activate();
  assert.equal(engine.paused, true);
  assert.equal(pointerLockRequests, 0, "activation must not arm a pointer-lock callback while frozen");

  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { pointerLockElement: null },
  });
  try {
    engine.paused = false;
    engine.pause();
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
  assert.equal(engine.paused, true);
  assert.equal(inputClears, 1);

  release();
  assert.equal(engine.paused, true);
});

test("successful local guest disconnect stays frozen through disposal and Rust runtime shutdown", async () => {
  const events: string[] = [];
  let releaseRuntimeShutdown!: () => void;
  let enterRuntimeShutdown!: () => void;
  const runtimeShutdownEntered = new Promise<void>((resolve) => { enterRuntimeShutdown = resolve; });
  const runtimeShutdownGate = new Promise<void>((resolve) => { releaseRuntimeShutdown = resolve; });
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const session = {
    role: "guest",
    state: "connected",
    dispose: (reason: string) => {
      assert.equal(engine.paused, true);
      events.push(`dispose:${reason}`);
    },
    drainAuthority: async () => {
      assert.equal(engine.paused, true);
      events.push("authority-drain");
    },
  };
  Object.assign(engine, {
    paused: false,
    multiplayer: session,
    multiplayerTerrainReadinessGeneration: 0,
    multiplayerTerrainReadinessAbort: null,
    hostRendezvous: null,
    drainGuestProgressionForGracefulDisconnect: async () => {
      assert.equal(engine.paused, true);
      events.push("progression-drain");
    },
    removeAllRemotePlayers: () => { events.push("remote-players-cleared"); },
    clearAgentWorkRuntime: () => undefined,
    agentVoicePending: [],
    latestAgentObservation: null,
    latestAgentResult: null,
    pendingAgentCommandReceipts: new Map(),
    sleepVotes: new Set(),
    multiplayerContainerAwaiting: new Set(),
    multiplayerOptimisticContainers: new Map(),
    pendingGuestCreatureInventoryRequests: new Map(),
    pendingGuestPlacementRequests: new Map(),
    deferredRemoteBlockActions: new Map(),
    multiplayerPeerActiveContainers: new Map(),
    multiplayerPeerContainerSignatures: new Map(),
    pendingReliableRequests: new Map(),
    multiplayerBoatInputs: new Map(),
    resetMultiplayerProgressionState: () => { events.push("progression-reset"); },
    titleMode: true,
    disposed: true,
    rustRuntimeManager: {
      shutdown: async () => {
        assert.equal(engine.paused, true);
        events.push("runtime-shutdown-enter");
        enterRuntimeShutdown();
        await runtimeShutdownGate;
        assert.equal(engine.paused, true);
        events.push("runtime-shutdown-exit");
      },
    },
    rustRuntimeHost: { fixture: true },
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "ready",
  });

  const disconnect = engine.disconnectMultiplayer();
  await runtimeShutdownEntered;
  assert.equal(engine.multiplayer, null);
  assert.equal(engine.paused, true, "the outer lease remains held across asynchronous shutdown");
  releaseRuntimeShutdown();
  await disconnect;

  assert.equal(engine.paused, true, "a disposed guest world must not briefly resume after completion");
  assert.deepEqual(events, [
    "progression-drain",
    "dispose:local-disconnect",
    "remote-players-cleared",
    "progression-reset",
    "authority-drain",
    "runtime-shutdown-enter",
    "runtime-shutdown-exit",
  ]);
});

test("concurrent local guest disconnects share preflight and dispose the session exactly once", async () => {
  let enterRuntimeShutdown!: () => void;
  let releaseRuntimeShutdown!: () => void;
  const runtimeShutdownEntered = new Promise<void>((resolve) => { enterRuntimeShutdown = resolve; });
  const runtimeShutdownGate = new Promise<void>((resolve) => { releaseRuntimeShutdown = resolve; });
  const fixture = teardownReadyGuestFixture({
    onDispose: (engine) => { assert.equal(engine.paused, true); },
    onAuthorityDrain: (engine) => { assert.equal(engine.paused, true); },
    onRuntimeShutdown: async (engine) => {
      assert.equal(engine.paused, true);
      enterRuntimeShutdown();
      await runtimeShutdownGate;
      assert.equal(engine.paused, true);
    },
  });

  const first = fixture.engine.disconnectMultiplayer();
  const second = fixture.engine.disconnectMultiplayer();
  await runtimeShutdownEntered;

  assert.equal(fixture.disposeCalls(), 1);
  assert.equal(fixture.engine.multiplayer, null);
  assert.equal(fixture.engine.paused, true);
  releaseRuntimeShutdown();
  await Promise.all([first, second]);

  assert.equal(fixture.disposeCalls(), 1);
  assert.equal(fixture.events.filter((event) => event === "authority-drain").length, 1);
  assert.equal(fixture.events.filter((event) => event === "runtime-shutdown").length, 1);
  assert.equal((fixture.engine as unknown as { multiplayerProgressionDrainDepth: number }).multiplayerProgressionDrainDepth, 0);
  assert.equal(fixture.engine.running, false);
  assert.equal(fixture.engine.paused, true);
});

test("local disconnect with no requested session cannot detach a new session that appears across preflight", async () => {
  let releasePreflight!: () => void;
  let enterPreflight!: () => void;
  const preflightEntered = new Promise<void>((resolve) => { enterPreflight = resolve; });
  const preflightGate = new Promise<void>((resolve) => { releasePreflight = resolve; });
  let newSessionDisposed = false;
  const newSession = {
    role: "host",
    state: "connected",
    dispose: () => { newSessionDisposed = true; },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: null,
    drainGuestProgressionForGracefulDisconnect: async () => {
      enterPreflight();
      await preflightGate;
    },
  });

  const disconnect = engine.disconnectMultiplayer();
  await preflightEntered;
  engine.multiplayer = newSession as never;
  releasePreflight();
  await disconnect;

  assert.equal(engine.multiplayer, newSession);
  assert.equal(newSessionDisposed, false);
});

test("a throwing guest dispose still completes teardown and never reopens gameplay", async () => {
  const disposeFailure = new Error("fixture dispose failed");
  const fixture = teardownReadyGuestFixture({
    onDispose: () => { throw disposeFailure; },
    onAuthorityDrain: (engine) => { assert.equal(engine.paused, true); },
    onRuntimeShutdown: (engine) => { assert.equal(engine.paused, true); },
  });

  await assert.rejects(fixture.engine.disconnectMultiplayer(), (error) => error === disposeFailure);

  assert.equal(fixture.disposeCalls(), 1);
  assert.equal(fixture.engine.multiplayer, null);
  assert.equal(fixture.engine.running, false);
  assert.equal(fixture.engine.paused, true);
  assert.equal((fixture.engine as unknown as { multiplayerProgressionDrainDepth: number }).multiplayerProgressionDrainDepth, 0);
  assert.equal((fixture.engine as unknown as { rustRuntimeHost: unknown }).rustRuntimeHost, null);
  assert.equal((fixture.engine as unknown as { rustRuntimeOperationsBlocked: boolean }).rustRuntimeOperationsBlocked, true);
  assert.deepEqual(fixture.events, [
    "dispose:local-disconnect",
    "remote-players-cleared",
    "progression-reset",
    "authority-drain",
    "runtime-shutdown",
  ]);
});

test("updateTarget keeps visual targeting live but suppresses bestiary progression while frozen", () => {
  const mob = {
    id: 42,
    specimenId: "specimen-freeze-42",
    kind: "puddlehopper",
    age: 3,
    visual: {},
  };
  let rarityObservations = 0;
  let guildObservations = 0;
  let saveRequests = 0;
  const origin = { set: () => origin };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    running: true,
    titleMode: false,
    cameraMode: "third-rear",
    yaw: 0,
    pitch: 0,
    position: { x: 0, y: 64, z: 0 },
    cameraEyeHeight: 1.62,
    cameraCollisionOrigin: origin,
    selectedSlot: () => null,
    castVoxel: () => null,
    castMob: () => ({ distance: 1, mob }),
    castRemotePlayer: () => null,
    castBoat: () => null,
    castLeviathanEgg: () => null,
    target: null,
    targetMob: null,
    targetRemotePlayerId: null,
    targetBoat: null,
    targetEggDrop: null,
    targetKey: "",
    miningProgress: 0,
    selection: { visible: false },
    breakingCrackMesh: null,
    bestiary: { puddlehopper: { seen: false, kills: 0, captures: 0 } },
    observeCreatureRarity: () => { rarityObservations += 1; return false; },
    dispatchGuildEvent: () => { guildObservations += 1; },
    saveSoon: () => { saveRequests += 1; },
  });
  const access = engine as unknown as {
    acquireMultiplayerProgressionGameplayFreeze(): () => void;
  };
  const release = access.acquireMultiplayerProgressionGameplayFreeze();

  engine.updateTarget();
  assert.equal(engine.targetMob, mob, "target presentation still updates while local progression is frozen");
  assert.equal((engine.bestiary as unknown as { puddlehopper: { seen: boolean } }).puddlehopper.seen, false);
  assert.equal(rarityObservations, 0);
  assert.equal(guildObservations, 0);
  assert.equal(saveRequests, 0);

  release();
  engine.updateTarget();
  assert.equal((engine.bestiary as unknown as { puddlehopper: { seen: boolean } }).puddlehopper.seen, true);
  assert.equal(rarityObservations, 1);
  assert.equal(guildObservations, 1);
  assert.equal(saveRequests, 1);
});

test("graceful progression drain waits for queued and in-flight Rust presentations before declaring clean", async () => {
  const fixture = pendingProgressionGuestFixture([]);
  Object.assign(fixture.engine, {
    multiplayerPendingProgressionTransfer: null,
    multiplayerProgressionSignature: "progression-8",
    rustGuestPresentationQueueDepth: 1,
    rustGuestPresentationInFlight: 1,
  });
  const access = fixture.engine as unknown as {
    multiplayerProgressionDrainWait(milliseconds: number): Promise<void>;
    drainGuestProgressionForGracefulDisconnect(session: unknown, timeoutMs: number): Promise<void>;
    rustGuestPresentationQueueDepth: number;
    rustGuestPresentationInFlight: number;
    multiplayerLastGracefulProgressionDrain: unknown;
  };
  let waits = 0;
  access.multiplayerProgressionDrainWait = async () => {
    waits += 1;
    assert.equal(fixture.engine.paused, true);
    if (waits === 1) {
      assert.equal(access.rustGuestPresentationQueueDepth, 1);
      assert.equal(access.rustGuestPresentationInFlight, 1);
      access.rustGuestPresentationQueueDepth = 0;
    } else if (waits === 2) {
      assert.equal(access.rustGuestPresentationQueueDepth, 0);
      assert.equal(access.rustGuestPresentationInFlight, 1,
        "an already-dequeued presentation still blocks clean resolution while applying");
      access.rustGuestPresentationInFlight = 0;
    }
  };

  await access.drainGuestProgressionForGracefulDisconnect(fixture.engine.multiplayer, 2_000);

  assert.equal(waits, 2);
  assert.equal(fixture.engine.paused, true);
  assert.ok(access.multiplayerLastGracefulProgressionDrain,
    "clean resolution records bounded pre-disposal evidence only after presentation work settles");
});

test("same-session graceful drains share one in-flight operation and one freeze lease", async () => {
  const fixture = pendingProgressionGuestFixture([]);
  Object.assign(fixture.engine, {
    multiplayerPendingProgressionTransfer: null,
    multiplayerProgressionSignature: "progression-8",
    rustGuestPresentationQueueDepth: 1,
    rustGuestPresentationInFlight: 0,
  });
  const access = fixture.engine as unknown as {
    multiplayerProgressionDrainWait(milliseconds: number): Promise<void>;
    drainGuestProgressionForGracefulDisconnect(session: unknown, timeoutMs: number): Promise<void>;
    multiplayerProgressionDrainDepth: number;
    multiplayerProgressionDrainOperation: unknown;
    rustGuestPresentationQueueDepth: number;
  };
  let releaseWait!: () => void;
  let enterWait!: () => void;
  const waitEntered = new Promise<void>((resolve) => { enterWait = resolve; });
  const waitGate = new Promise<void>((resolve) => { releaseWait = resolve; });
  let waits = 0;
  access.multiplayerProgressionDrainWait = async () => {
    waits += 1;
    enterWait();
    await waitGate;
  };

  const first = access.drainGuestProgressionForGracefulDisconnect(fixture.engine.multiplayer, 2_000);
  const second = access.drainGuestProgressionForGracefulDisconnect(fixture.engine.multiplayer, 2_000);
  assert.equal(first, second, "same-session callers receive the exact shared promise");
  await waitEntered;
  assert.equal(access.multiplayerProgressionDrainDepth, 1, "sharing a drain must not acquire a second lease");

  access.rustGuestPresentationQueueDepth = 0;
  releaseWait();
  await Promise.all([first, second]);

  assert.equal(waits, 1);
  assert.equal(access.multiplayerProgressionDrainDepth, 0);
  assert.equal(access.multiplayerProgressionDrainOperation, null);
  assert.equal(fixture.engine.paused, true);
});

test("strict drain rejects an already-closed guest session and clears stale graceful evidence", async () => {
  const fixture = pendingProgressionGuestFixture([]);
  const session = fixture.engine.multiplayer as unknown as { state: string };
  session.state = "disconnected";
  Object.assign(fixture.engine, {
    multiplayerLastGracefulProgressionDrain: { schema: 1, observedAt: 1, exactReceiptCurrent: true },
  });
  const access = fixture.engine as unknown as {
    drainGuestProgressionForGracefulDisconnect(session: unknown, timeoutMs: number): Promise<void>;
    multiplayerLastGracefulProgressionDrain: unknown;
    multiplayerProgressionDrainOperation: unknown;
  };

  await assert.rejects(
    access.drainGuestProgressionForGracefulDisconnect(fixture.engine.multiplayer, 2_000),
    /cannot confirm an exact transfer after the host connection closes/iu,
  );

  assert.equal(access.multiplayerLastGracefulProgressionDrain, null);
  assert.equal(access.multiplayerProgressionDrainOperation ?? null, null);
});

test("connection loss during an in-flight strict drain rejects exact-unconfirmed and clears stale evidence", async () => {
  const fixture = pendingProgressionGuestFixture([{
    action: {
      transferId: "progress_pending_8",
      actorId: GUEST.id,
      revision: 8,
      chunkIndex: 0,
      chunkCount: 1,
      data: "final",
      status: "request",
    },
  }]);
  Object.assign(fixture.engine, {
    multiplayerLastGracefulProgressionDrain: { schema: 1, observedAt: 1, exactReceiptCurrent: true },
  });
  const access = fixture.engine as unknown as {
    multiplayerProgressionDrainWait(milliseconds: number): Promise<void>;
    drainGuestProgressionForGracefulDisconnect(session: unknown, timeoutMs: number): Promise<void>;
    multiplayerLastGracefulProgressionDrain: unknown;
    multiplayerProgressionDrainOperation: unknown;
    multiplayerPendingProgressionTransfer: PendingProgressionView | null;
  };
  let waits = 0;
  access.multiplayerProgressionDrainWait = async () => {
    waits += 1;
    (fixture.engine.multiplayer as unknown as { state: string }).state = "disconnected";
  };

  await assert.rejects(
    access.drainGuestProgressionForGracefulDisconnect(fixture.engine.multiplayer, 2_000),
    /lost its host connection before the exact transfer was confirmed/iu,
  );

  assert.equal(waits, 1);
  assert.ok(access.multiplayerPendingProgressionTransfer,
    "transport completion without a host receipt remains exact-unconfirmed");
  assert.equal(access.multiplayerLastGracefulProgressionDrain, null);
  assert.equal(access.multiplayerProgressionDrainOperation, null);
  assert.equal(fixture.engine.paused, true);
});

test("graceful progression drain retries send-zero and waits for exact receipts including a later local tail", async () => {
  const fixture = pendingProgressionGuestFixture([{
    action: {
      transferId: "progress_pending_8",
      actorId: GUEST.id,
      revision: 8,
      chunkIndex: 0,
      chunkCount: 1,
      data: "final",
      status: "request",
    },
  }]);
  let transportOpen = false;
  (fixture.engine.multiplayer as unknown as { sendPlayerProgress(action: PlayerProgressAction): number }).sendPlayerProgress = (
    action,
  ) => {
    fixture.sent.push(structuredClone(action));
    return transportOpen ? 1 : 0;
  };
  const access = fixture.engine as unknown as {
    drainGuestProgressionForGracefulDisconnect(session: unknown, timeoutMs: number): Promise<void>;
    applyAuthoritativeGuestPlayerProgression(
      record: { revision: number; state: PlayerProgressionSnapshot },
      actorId: string,
      failOnConfirmedRegression: boolean,
      receipt: RustMultiplayerProgressionReceiptV2,
    ): boolean;
    multiplayerPendingProgressionTransfer: PendingProgressionView | null;
  };
  let drained = false;
  const drain = access.drainGuestProgressionForGracefulDisconnect(fixture.engine.multiplayer, 2_000)
    .then(() => { drained = true; });

  assert.equal(fixture.engine.paused, true, "the receipt drain must freeze local gameplay producers");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(drained, false);
  assert.equal(access.multiplayerPendingProgressionTransfer?.transportComplete, false);
  transportOpen = true;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(access.multiplayerPendingProgressionTransfer?.transportComplete, true);
  assert.equal(drained, false, "transport completion is not host commitment");

  fixture.setLocalRevision(9);
  access.applyAuthoritativeGuestPlayerProgression(
    { revision: 8, state: progressionAtRevision(8) },
    GUEST.id,
    true,
    { transferId: "progress_pending_8", status: "accepted", committedRevision: 8 },
  );
  const tailTransferId = access.multiplayerPendingProgressionTransfer?.transferId;
  assert.ok(tailTransferId && tailTransferId !== "progress_pending_8");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(access.multiplayerPendingProgressionTransfer?.transportComplete, true);
  assert.equal(drained, false, "the later local tail needs its own exact receipt");

  access.applyAuthoritativeGuestPlayerProgression(
    { revision: 9, state: progressionAtRevision(9) },
    GUEST.id,
    true,
    { transferId: tailTransferId, status: "accepted", committedRevision: 9 },
  );
  await drain;
  assert.equal(drained, true);
  assert.equal(fixture.engine.paused, true, "a completed drain never reopens gameplay implicitly");
});

test("graceful progression drain freezes a gameplay tail at one exact snapshot while transport keeps advancing", async () => {
  const fixture = pendingProgressionGuestFixture([{
    action: {
      transferId: "progress_pending_8",
      actorId: GUEST.id,
      revision: 8,
      chunkIndex: 0,
      chunkCount: 1,
      data: "final",
      status: "request",
    },
  }]);
  const access = fixture.engine as unknown as {
    multiplayerProgressionDrainWait(milliseconds: number): Promise<void>;
    drainGuestProgressionForGracefulDisconnect(session: unknown, timeoutMs: number): Promise<void>;
    applyAuthoritativeGuestPlayerProgression(
      record: { revision: number; state: PlayerProgressionSnapshot },
      actorId: string,
      failOnConfirmedRegression: boolean,
      receipt: RustMultiplayerProgressionReceiptV2,
    ): boolean;
  };
  let transportSteps = 0;
  access.multiplayerProgressionDrainWait = async () => {
    transportSteps += 1;
    assert.equal(fixture.engine.paused, true);
    // This mirrors animation-loop progression producers such as map discovery:
    // transport runs while paused, but the producer cannot create revision 9.
    if (!fixture.engine.paused) fixture.setLocalRevision(9);
    access.applyAuthoritativeGuestPlayerProgression(
      { revision: 8, state: progressionAtRevision(8) },
      GUEST.id,
      true,
      { transferId: "progress_pending_8", status: "accepted", committedRevision: 8 },
    );
  };

  await access.drainGuestProgressionForGracefulDisconnect(fixture.engine.multiplayer, 2_000);

  assert.equal(transportSteps, 1);
  assert.equal(fixture.localRevision(), 8);
  assert.equal(fixture.engine.paused, true);
});

test("graceful progression drain shares the authority deadline beyond the former twelve-second cutoff", async () => {
  const fixture = pendingProgressionGuestFixture([{
    action: {
      transferId: "progress_pending_8",
      actorId: GUEST.id,
      revision: 8,
      chunkIndex: 0,
      chunkCount: 1,
      data: "final",
      status: "request",
    },
  }]);
  const session = fixture.engine.multiplayer as unknown as { authorityTimeoutMs: number };
  session.authorityTimeoutMs = 60_000;
  const access = fixture.engine as unknown as {
    multiplayerPendingProgressionTransfer: PendingProgressionView | null;
    multiplayerProgressionDrainBudgetMs(session: unknown, timeoutMs?: number): number;
    multiplayerProgressionDrainNow(): number;
    multiplayerProgressionDrainWait(milliseconds: number): Promise<void>;
    drainGuestProgressionForGracefulDisconnect(session: unknown): Promise<void>;
    applyAuthoritativeGuestPlayerProgression(
      record: { revision: number; state: PlayerProgressionSnapshot },
      actorId: string,
      failOnConfirmedRegression: boolean,
      receipt: RustMultiplayerProgressionReceiptV2,
    ): boolean;
  };
  let fakeNow = 0;
  let waits = 0;
  access.multiplayerProgressionDrainNow = () => fakeNow;
  access.multiplayerProgressionDrainWait = async () => {
    waits += 1;
    fakeNow += 13_000;
    if (waits === 2) {
      access.applyAuthoritativeGuestPlayerProgression(
        { revision: 8, state: progressionAtRevision(8) },
        GUEST.id,
        true,
        { transferId: "progress_pending_8", status: "accepted", committedRevision: 8 },
      );
    }
  };

  assert.equal(access.multiplayerProgressionDrainBudgetMs(session), 65_000);
  await access.drainGuestProgressionForGracefulDisconnect(fixture.engine.multiplayer);
  assert.equal(fakeNow, 26_000, "the test crosses the old twelve-second deadline without wall-clock waiting");
  assert.equal(waits, 2);
  assert.equal(access.multiplayerPendingProgressionTransfer, null);
});

test("graceful disconnect timeout leaves the live guest session intact", async () => {
  let disposed = false;
  const session = {
    role: "guest",
    state: "connected",
    sendPlayerProgress: () => 0,
    dispose: () => { disposed = true; },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: session,
    multiplayerReceivedSnapshot: true,
    multiplayerProgressionReceived: true,
    multiplayerProgressionRevision: 7,
    multiplayerProgressionSignature: "local-8",
    multiplayerProgressionDrainTimeoutMs: 20,
    multiplayerProgressTransfers: new Map(),
    multiplayerProgressOutgoing: [{ action: {
      transferId: "progress_leave_8", actorId: GUEST.id, revision: 8,
      chunkIndex: 0, chunkCount: 1, data: "final", status: "request",
    } satisfies PlayerProgressAction }],
    multiplayerPendingProgressionTransfer: {
      revision: 8,
      signature: "local-8",
      transferId: "progress_leave_8",
      transportComplete: false,
      baseState: progressionAtRevision(7),
      requestState: progressionAtRevision(8),
    } satisfies PendingProgressionView,
    localPlayerProgressionSignature: () => "local-8",
  });

  await assert.rejects(engine.disconnectMultiplayer(), /did not confirm the exact transfer/iu);
  assert.equal(engine.multiplayer, session);
  assert.equal(disposed, false);
  assert.equal(engine.paused, true, "a failed preflight retains the explicit pause boundary");
  assert.equal((engine as unknown as { multiplayerProgressOutgoing: unknown[] }).multiplayerProgressOutgoing.length, 1);
});

test("forced teardown best-effort flushes but cannot retain a dead guest session", async () => {
  const events: string[] = [];
  const session = {
    role: "guest",
    state: "disconnected",
    dispose: (reason: string) => { events.push(`dispose:${reason}`); },
    drainAuthority: async () => { events.push("transport-drain"); },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: session,
    multiplayerTerrainReadinessGeneration: 0,
    multiplayerTerrainReadinessAbort: null,
    multiplayerProgressionReceived: true,
    hostRendezvous: null,
    syncMultiplayerPlayerProgression: () => { events.push("best-effort-sync"); throw new Error("dead transport"); },
    flushPlayerProgressionTransfers: () => { events.push("best-effort-flush"); throw new Error("closed channel"); },
    removeAllRemotePlayers: () => { events.push("remote-players-cleared"); },
    clearAgentWorkRuntime: () => undefined,
    agentVoicePending: [],
    latestAgentObservation: null,
    latestAgentResult: null,
    pendingAgentCommandReceipts: new Map(),
    sleepVotes: new Set(),
    multiplayerContainerAwaiting: new Map(),
    multiplayerOptimisticContainers: new Map(),
    pendingGuestCreatureInventoryRequests: new Map(),
    pendingGuestPlacementRequests: new Map(),
    deferredRemoteBlockActions: new Map(),
    multiplayerPeerActiveContainers: new Map(),
    multiplayerPeerContainerSignatures: new Map(),
    pendingReliableRequests: new Map(),
    multiplayerBoatInputs: new Map(),
    resetMultiplayerProgressionState: () => { events.push("progression-reset"); },
    titleMode: true,
    disposed: true,
    rustRuntimeManager: { shutdown: async () => { events.push("runtime-shutdown"); } },
    rustRuntimeHost: { fixture: true },
    rustRuntimeOperationsBlocked: false,
    rustRuntimeHydrationState: "ready",
  });

  await engine.disconnectMultiplayer("remote-disconnect");

  assert.equal(engine.multiplayer, null);
  assert.deepEqual(events.slice(0, 3), ["best-effort-sync", "best-effort-flush", "dispose:remote-disconnect"]);
  assert.ok(events.includes("progression-reset"));
  assert.ok(events.includes("runtime-shutdown"));
});

test("quit-to-title strictly drains a progression tail created during authority drain before disposal", async () => {
  const events: string[] = [];
  let authorityDrains = 0;
  let progressionDrains = 0;
  let tailPending = false;
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { role: "guest", state: "connected" },
    rustRuntimeOperationsBlocked: false,
    rustLivePlayerAuthorityRequestedR5: false,
    running: true,
    paused: false,
    titleMode: false,
    persistent: true,
    cancelRustOriginPreflight: () => undefined,
    cancelTerrainLocatorConsumerOperations: () => undefined,
    terrainGenerationReadinessAbort: null,
    clearInput: () => undefined,
    drainGuestProgressionForGracefulDisconnect: async () => {
      progressionDrains += 1;
      events.push(`progression-drain:${progressionDrains}`);
      if (progressionDrains === 1) assert.equal(tailPending, false);
      else {
        assert.equal(tailPending, true, "the final strict drain must observe the authority-created tail");
        tailPending = false;
      }
    },
    drainRustAuthorityOperations: async () => {
      authorityDrains += 1;
      events.push(`authority-drain:${authorityDrains}`);
      if (authorityDrains === 1) tailPending = true;
    },
    closeContainer: () => undefined,
    requireRustNativePlayerSaveBinding: () => false,
    saveNow: () => true,
    rustNativeSaveOperation: null,
    worldStorage: { flushPersistence: async () => { events.push("persistence-flush"); } },
    disconnectMultiplayer: async (reason: string) => {
      assert.equal(progressionDrains, 2);
      assert.equal(tailPending, false);
      events.push(`dispose:${reason}`);
      engine.multiplayer = null;
    },
    rustRuntimeTransitionGeneration: 0,
    stopRustLivePlayerAuthorityR5: async () => undefined,
    disposeRustLiveRendererR10: async () => undefined,
    shutdownBoundNativePersistence: async () => undefined,
    rustRuntimeManager: { shutdown: async () => undefined },
    rustRuntimeHost: null,
    rustRuntimeHydrationState: "ready",
    events: { onToast: () => undefined },
  });
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { pointerLockElement: null },
  });
  try {
    await engine.quitToTitleAsync();
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }

  const finalDrain = events.indexOf("progression-drain:2");
  const disposal = events.indexOf("dispose:quit-to-title");
  assert.ok(finalDrain > events.indexOf("persistence-flush"));
  assert.equal(disposal, finalDrain + 1, "no asynchronous work may open a new progression tail before disposal");
});

test("quit-to-title progression preflight fails before teardown while retaining the pause boundary", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { role: "guest", state: "connected", sendPlayerProgress: () => 0 },
    multiplayerReceivedSnapshot: true,
    multiplayerProgressionReceived: true,
    multiplayerProgressionRevision: 7,
    multiplayerProgressionSignature: "host-7",
    multiplayerProgressionDrainTimeoutMs: 20,
    multiplayerProgressTransfers: new Map(),
    multiplayerProgressOutgoing: [{
      action: {
        transferId: "progress_quit_8",
        actorId: GUEST.id,
        revision: 8,
        chunkIndex: 1,
        chunkCount: 2,
        data: "final",
        status: "request",
      },
    }],
    multiplayerPendingProgressionTransfer: {
      revision: 8,
      signature: "local-8",
      transferId: "progress_quit_8",
      transportComplete: false,
      baseState: progressionAtRevision(7),
      requestState: progressionAtRevision(8),
    } satisfies PendingProgressionView,
    localPlayerProgressionSignature: () => "local-8",
    rustRuntimeOperationsBlocked: false,
    running: true,
    paused: false,
    titleMode: false,
  });

  await assert.rejects(engine.quitToTitleAsync(), /still synchronizing/iu);
  assert.equal((engine as unknown as { rustRuntimeOperationsBlocked: boolean }).rustRuntimeOperationsBlocked, false);
  assert.equal(engine.running, true);
  assert.equal(engine.paused, true);
  assert.equal(engine.titleMode, false);
  assert.equal((engine as unknown as { multiplayerProgressOutgoing: unknown[] }).multiplayerProgressOutgoing.length, 1);
});

test("starting a replacement session cannot bypass the exact progression drain", async () => {
  let disposed = false;
  let rendezvousClosed = false;
  const prior = {
    role: "guest",
    state: "connected",
    sendPlayerProgress: () => 0,
    dispose: () => { disposed = true; },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: prior,
    multiplayerReceivedSnapshot: true,
    multiplayerProgressionReceived: true,
    multiplayerProgressionSignature: "local-8",
    multiplayerProgressionDrainTimeoutMs: 20,
    multiplayerProgressTransfers: new Map(),
    multiplayerProgressOutgoing: [{ action: {
      transferId: "progress_replace_8", actorId: GUEST.id, revision: 8,
      chunkIndex: 0, chunkCount: 1, data: "final", status: "request",
    } satisfies PlayerProgressAction }],
    multiplayerPendingProgressionTransfer: {
      revision: 8,
      signature: "local-8",
      transferId: "progress_replace_8",
      transportComplete: false,
      baseState: progressionAtRevision(7),
      requestState: progressionAtRevision(8),
    } satisfies PendingProgressionView,
    localPlayerProgressionSignature: () => "local-8",
    closeHostRendezvous: async () => { rendezvousClosed = true; },
  });

  await assert.rejects(
    (engine as unknown as { beginMultiplayerSession(name: string, role: "host" | "guest"): Promise<unknown> })
      .beginMultiplayerSession("Replacement", "guest"),
    /did not confirm the exact transfer/iu,
  );
  assert.equal(engine.multiplayer, prior);
  assert.equal(disposed, false);
  assert.equal(rendezvousClosed, false, "replacement preflight runs before any existing session surface is closed");
});

test("Rust preview and synchronous world load reset the complete progression authority state", () => {
  const dirtyState = () => ({
    multiplayerPlayerProgressions: new Map([[GUEST.id, { revision: 7, state: {} }]]),
    multiplayerProgressTransfers: new Map([["inbound", {}]]),
    multiplayerProgressOutgoing: [{ action: { status: "request", transferId: "dirty" } }],
    multiplayerPendingProgressionTransfer: {
      revision: 8,
      signature: "local-8",
      transferId: "dirty",
      transportComplete: false,
      baseState: progressionAtRevision(7),
      requestState: progressionAtRevision(8),
    } satisfies PendingProgressionView,
    multiplayerProgressionRevision: 7,
    multiplayerProgressionReceived: true,
    multiplayerProgressionTimer: 5,
    multiplayerProgressionSignature: "host-7",
  });
  const assertReset = (engine: VoxelEngine & Record<string, unknown>) => {
    assert.equal((engine as unknown as { multiplayerPlayerProgressions: Map<string, unknown> }).multiplayerPlayerProgressions.size, 0);
    assert.equal((engine as unknown as { multiplayerProgressTransfers: Map<string, unknown> }).multiplayerProgressTransfers.size, 0);
    assert.deepEqual((engine as unknown as { multiplayerProgressOutgoing: unknown[] }).multiplayerProgressOutgoing, []);
    assert.equal((engine as unknown as { multiplayerPendingProgressionTransfer: unknown }).multiplayerPendingProgressionTransfer, null);
    assert.equal(engine.multiplayerProgressionRevision, 0);
    assert.equal(engine.multiplayerProgressionReceived, false);
    assert.equal(engine.multiplayerProgressionTimer, 0);
    assert.equal(engine.multiplayerProgressionSignature, "");
  };

  const preview = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(preview, dirtyState(), {
    terrainGenerationMode: () => "rust",
    terrainGenerationReadinessAbort: { abort: () => undefined },
    world: { reset: () => undefined, initializeAround: () => undefined },
    spawn: { set: () => undefined },
    position: { copy: () => undefined },
    emitHud: () => undefined,
  });
  preview.previewWorld("rust-preview-reset");
  assertReset(preview);

  const load = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const sentinel = new Error("stop after progression reset");
  Object.assign(load, dirtyState(), {
    terrainGenerationMode: () => "typescript",
    recordLegacyCaptureMigration: () => { throw sentinel; },
  });
  assert.throws(() => load.loadWorld({ seed: "load-reset" } as WorldSave, {}, "world-load-reset"), sentinel);
  assertReset(load);
});

test("Rust guest pose publication suppresses idle authorization backlog without delaying changes", () => {
  const sent: PlayerPose[] = [];
  let pose: PlayerPose = {
    playerId: GUEST.id,
    tick: 0,
    x: 1,
    y: 43.5,
    z: 0,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    action: "none",
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: {
      role: "guest",
      state: "connected",
      authorityMode: "rust-authoritative",
      isRustGuestPresentationReady: () => true,
      sendPlayerPose: (value: PlayerPose) => { sent.push(structuredClone(value)); return 1; },
    },
    multiplayerReceivedSnapshot: true,
    multiplayerTick: 0,
    multiplayerPoseTimer: 0,
    multiplayerPoseHeartbeatTimer: 0,
    multiplayerPoseSignature: null,
    multiplayerWorldTimer: 1,
    multiplayerSnapshotTimer: 1,
    multiplayerPlayerStateTimer: 1,
    multiplayerProgressionTimer: 1,
    multiplayerContainerTimer: 1,
    agentObservationTimer: 1,
    agentMode: false,
    agentVoiceAssembler: { prune: () => 0 },
    agentDiagnostics: null,
    agentVoicePending: [],
    multiplayerCombatCooldowns: new Map(),
    flushDeferredRemoteBlockActions: () => undefined,
    retryCriticalReliableRequests: () => undefined,
    updateGuestContainerIntentRetries: () => undefined,
    flushPlayerProgressionTransfers: () => undefined,
    localNetworkPose: () => ({ ...pose, tick: engine.multiplayerTick }),
  });

  const update = () => (engine as unknown as { updateMultiplayer(dt: number): void }).updateMultiplayer(0.016);
  update();
  assert.equal(sent.length, 1, "the first ready guest pose must be published");
  assert.equal((engine as unknown as { multiplayerLastOutboundPose: { producer: string } }).multiplayerLastOutboundPose.producer,
    "typescript-compatibility");

  engine.multiplayerPoseTimer = 0;
  update();
  assert.equal(sent.length, 1, "a tick-only change must not enqueue another Rust authorization");

  pose = { ...pose, x: 2 };
  engine.multiplayerPoseTimer = 0;
  update();
  assert.equal(sent.length, 2, "a changed pose must publish on the next 20 Hz opportunity");
  assert.equal(sent.at(-1)?.x, 2);

  engine.multiplayerPoseTimer = 0;
  engine.multiplayerPoseHeartbeatTimer = 0;
  update();
  assert.equal(sent.length, 3, "an unchanged pose must still refresh the remote before its stale timeout");
});

test("R9 guest pose kinematics come directly from the ready R5 native player view", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { identity: GUEST },
    multiplayerTick: 77,
    rustLivePlayerAuthorityEnabledR5: () => true,
    rustLivePlayerInitialYawRadiansR10: -0.25,
    rustLivePlayerPresentationViewR10: Object.freeze({
      extractionRevision: BigInt(91),
      authorityTick: BigInt(84),
      entityRevision: BigInt(13),
      lastInputSequence: BigInt(29),
      lookYaw: 16_384,
      lookPitch: -8_192,
      position: Object.freeze({ x: 8.25, y: 43.5, z: -6.75 }),
      velocity: Object.freeze({ x: 1.5, y: -0.25, z: 2.75 }),
      grounded: false,
      crouching: true,
      buttons: 1 << 2,
      selectedSlot: 4,
    }),
    position: { x: -100, y: -100, z: -100 },
    velocity: { x: -9, y: -9, z: -9 },
    yaw: -2,
    pitch: 1,
    grounded: true,
    crouching: false,
    sprinting: false,
    selected: 1,
    inventory: Array.from({ length: 9 }, () => null),
    boats: new Map(),
    mountedBoatId: null,
    mountedCreatureId: null,
    mountedCreatureSeat: null,
    offhand: null,
    offhandUseHeld: false,
    mineHeld: false,
    attackCooldown: 0,
    heldUse: 0,
    headSubmerged: false,
    seatedAt: null,
    playerVariant: "male",
    equipment: {},
    world: { getBlock: () => 0 },
  });

  const pose = (engine as unknown as { localNetworkPose(): PlayerPose }).localNetworkPose();
  assert.deepEqual([pose.x, pose.y, pose.z], [8.25, 43.5, -6.75]);
  assert.deepEqual([pose.vx, pose.vy, pose.vz], [1.5, -0.25, 2.75]);
  assert.equal(pose.yaw, 16_384 / 32_767 * Math.PI);
  assert.equal(pose.pitch, -8_192 / 32_767 * (Math.PI / 2));
  assert.equal(pose.grounded, false);
  assert.equal(pose.crouching, true);
  assert.equal(pose.sprinting, true);
  assert.equal(pose.selected, 4);

  const diagnostics = (engine as unknown as {
    outboundPoseDiagnostics(value: PlayerPose): {
      producer: string;
      nativeSource: Record<string, string> | null;
      position: { x: number; y: number; z: number };
    };
  }).outboundPoseDiagnostics(pose);
  assert.equal(diagnostics.producer, "rust-live-player-view-r10-kinematics");
  assert.deepEqual(diagnostics.nativeSource, {
    extractionRevision: "91",
    authorityTick: "84",
    entityRevision: "13",
    lastInputSequence: "29",
  });
  assert.deepEqual(diagnostics.position, { x: 8.25, y: 43.5, z: -6.75 });
  assert.equal(Object.isFrozen(diagnostics), true);
  assert.equal(Object.isFrozen(diagnostics.nativeSource), true);
});

test("Rust presentation publication retains one trailing update while a batch is in flight", async () => {
  const calls: string[][] = [];
  let entered!: () => void;
  let release!: () => void;
  const enteredFirst = new Promise<void>((resolve) => { entered = resolve; });
  const firstGate = new Promise<void>((resolve) => { release = resolve; });
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: { role: "host", authorityMode: "rust-authoritative" },
    rustAuthorityPresentationRequests: new Map(),
    rustAuthorityPresentationPump: null,
    publishRustAuthorityPresentationNow: async (peerIds: readonly string[]) => {
      calls.push([...peerIds]);
      if (calls.length === 1) {
        entered();
        await firstGate;
      }
    },
  });
  const publisher = engine as unknown as {
    publishRustAuthorityPresentation(peerId: string, keyframe: boolean): Promise<void>;
  };
  const first = publisher.publishRustAuthorityPresentation(GUEST.id, true);
  await enteredFirst;
  const second = publisher.publishRustAuthorityPresentation(GUEST.id, true);
  assert.deepEqual(calls, [[GUEST.id]]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, [[GUEST.id], [GUEST.id]]);
});

function presentationNativeSaveRaceHarness(hooks: Readonly<{
  freeze?: () => Promise<void>;
  send?: () => Promise<void>;
  save?: () => Promise<void>;
  activeMultiplayer?: boolean;
  multiplayerSaveSuppressed?: boolean;
  unboundGuestTransition?: boolean;
}> = {}) {
  const events: string[] = [];
  const firstPresentationDrain = deferred<void>();
  let drainCount = 0;
  let authorityTail = Promise.resolve<unknown>(undefined);
  const trackAuthority = <T>(operation: () => Promise<T>) => {
    const next = authorityTail.then(operation, operation);
    authorityTail = next.then(() => undefined, () => undefined);
    return next;
  };
  const authority = {
    backend: "rust-wasm-worker" as const,
    currentIdentity: () => IDENTITY,
    nextCommandSequence: () => 0,
    runExclusiveMutation<T>(operation: () => Promise<T>) {
      return trackAuthority(async () => {
        events.push("save:exclusive-enter");
        try {
          return await operation();
        } finally {
          events.push("save:exclusive-exit");
        }
      });
    },
    async drain() {
      events.push("presentation:drain-wait");
      drainCount += 1;
      if (drainCount === 1) firstPresentationDrain.resolve(undefined);
      const head = authorityTail;
      await head;
      events.push("presentation:drain-complete");
    },
    upsertReplicationRecord: () => trackAuthority(async () => {
      events.push("presentation:upsert");
    }),
  };
  const peer = {
    token: "invite_presentation_save_race_001",
    identity: GUEST,
    state: "connected" as const,
    connectedAt: 1,
    lastSeenAt: 1,
    latencyMs: 0,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: true,
  };
  const session = {
    role: hooks.unboundGuestTransition ? null : "host" as const,
    authorityMode: "rust-authoritative" as const,
    sessionId: SESSION_ID,
    identity: HOST,
    getPeer: (peerId: string) => !hooks.unboundGuestTransition && peerId === GUEST.id ? peer : undefined,
    getPeers: () => hooks.unboundGuestTransition ? [] : [peer],
    freezeRustGuestCommands: async () => {
      events.push("presentation:freeze-start");
      await hooks.freeze?.();
      events.push("presentation:freeze-end");
    },
    sendRustAuthorityDelta: async () => {
      events.push("presentation:send-start");
      await hooks.send?.();
      events.push("presentation:send-end");
      return 1;
    },
    disconnectPeer: (_peerId: string, reason: string) => {
      events.push(`presentation:disconnect:${reason}`);
    },
  };
  const host = {
    diagnostics: () => ({ state: "ready" as const }),
    multiplayerAuthority: () => authority,
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: hooks.activeMultiplayer === false ? null : session,
    persistent: true,
    rustRuntimeManager: { requireReady: () => host },
    rustRuntimeHost: host,
    rustRuntimeOperationsBlocked: false,
    rustTerrainLocatorEffectJournal: null,
    rustTerrainLocatorCommitLocked: false,
    rustNativePersistenceWorldId: "world-presentation-save-race",
    activeWorldId: "world-presentation-save-race",
    rustNativeSaveOperation: null,
    rustNativeSaveQueued: false,
    rustNativeSaveSuppressedForMultiplayerRuntime: hooks.multiplayerSaveSuppressed ?? hooks.activeMultiplayer !== false,
    rustPristineGuestTransitionCheckpointAdmitted: hooks.unboundGuestTransition ?? false,
    rustLivePlayerAuthorityRequestedR5: false,
    rustLivePlayerAuthorityState: "none",
    rustLiveInputPump: null,
    rustAuthorityPresentationInFlight: 0,
    rustPeerDeltaSequences: new Map([[GUEST.id, {
      connectionToken: peer.token,
      sequence: 0,
    }]]),
    rustPeerPresentationRecordRevisions: new Map<string, number>(),
    rustPlayerProgressionReceipts: new Map(),
    rustAuthorityLastError: null,
    saveTimer: 0,
    autoSaveIdleHandle: 0,
    autoSaveUsesIdleCallback: false,
    fallingTrees: [],
    worldSessionStartedAt: Date.now(),
    serialize: () => ({ seed: "PRESENTATION-SAVE-RACE" }),
    hostWorldSnapshot: () => worldSnapshot(),
    ensureHostPlayerProgression: () => structuredClone(presentation().playerProgression),
    trackRustAuthorityOperation: (operation: Promise<unknown>) => operation,
    worldStorage: {
      saveWorldLocalOnly: (worldId: string) => {
        events.push("save:local-document");
        return { ok: true as const, value: { id: worldId } };
      },
      saveNativeWorld: async (worldId: string) => {
        events.push("save:start");
        await hooks.save?.();
        events.push("save:end");
        return { ok: true as const, value: { id: worldId } };
      },
    },
    events: {
      onSave: () => { events.push("save:notification"); },
      onToast: (message: string) => { events.push(`save:error:${message}`); },
    },
  });
  const access = engine as unknown as {
    publishRustAuthorityPresentationNow(peerIds: readonly string[], keyframe: boolean): Promise<void>;
    scheduleRustNativeSaveCheckpoint(allowPristineGuestTransition?: boolean): void;
    rustNativeSaveOperation: Promise<void> | null;
    rustNativeSaveQueued: boolean;
    rustNativeSaveSuppressedForMultiplayerRuntime: boolean;
    rustPristineGuestTransitionCheckpointAdmitted: boolean;
  };
  return { engine, access, events, firstPresentationDrain: firstPresentationDrain.promise };
}

test("active Rust multiplayer autosave commits only the browser compatibility document", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout: () => undefined,
      localStorage: { removeItem: () => undefined, setItem: () => undefined },
    },
    writable: true,
  });
  try {
    const harness = presentationNativeSaveRaceHarness();

    assert.equal(harness.engine.saveNow(false), true);
    assert.equal((harness.engine as unknown as { rustLivePlayerAuthorityState: string }).rustLivePlayerAuthorityState, "none",
      "the regression covers integrated persistence with R5 disabled");
    assert.equal(harness.events.filter((event) => event === "save:local-document").length, 1,
      "autosave must still durably commit the browser compatibility document");
    assert.equal(harness.events.includes("save:start"), false,
      "a network-active Rust runtime must never attempt a native checkpoint");
    assert.equal(harness.events.some((event) => event.startsWith("save:error:")), false);
    assert.equal(harness.access.rustNativeSaveOperation, null);
    assert.equal(harness.access.rustNativeSaveQueued, false);

    (harness.engine as unknown as { multiplayer: null }).multiplayer = null;
    harness.access.scheduleRustNativeSaveCheckpoint();
    assert.equal(harness.events.includes("save:start"), false,
      "the runtime-lifetime latch remains closed after all peers and the session leave");
    assert.equal(harness.access.rustNativeSaveSuppressedForMultiplayerRuntime, true);
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow, writable: true });
  }
});

test("one unbound pristine guest transition may checkpoint before runtime handoff", async () => {
  const harness = presentationNativeSaveRaceHarness({
    unboundGuestTransition: true,
    multiplayerSaveSuppressed: true,
  });

  harness.access.scheduleRustNativeSaveCheckpoint(true);
  const checkpoint = harness.access.rustNativeSaveOperation;
  assert.ok(checkpoint, "the admitted unbound guest transition must start its final local checkpoint");
  await checkpoint;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.events.filter((event) => event === "save:start").length, 1);
  assert.equal(harness.access.rustPristineGuestTransitionCheckpointAdmitted, false,
    "the network-pristine admission is consumed by the first checkpoint");

  harness.access.scheduleRustNativeSaveCheckpoint(true);
  assert.equal(harness.events.filter((event) => event === "save:start").length, 1,
    "the multiplayer runtime-lifetime latch must suppress every later checkpoint");
  assert.equal(harness.access.rustNativeSaveOperation, null);
});

test("single-player R5-off native checkpoints remain enabled on a pristine Rust runtime", async () => {
  const saveEntered = deferred<void>();
  const releaseSave = deferred<void>();
  const harness = presentationNativeSaveRaceHarness({
    activeMultiplayer: false,
    multiplayerSaveSuppressed: false,
    save: async () => {
      saveEntered.resolve(undefined);
      await releaseSave.promise;
    },
  });

  harness.access.scheduleRustNativeSaveCheckpoint();
  await saveEntered.promise;
  const checkpoint = harness.access.rustNativeSaveOperation;
  assert.ok(checkpoint);
  assert.equal(harness.events.includes("save:start"), true);

  releaseSave.resolve(undefined);
  await checkpoint;

  assert.ok(harness.events.indexOf("save:exclusive-enter") < harness.events.indexOf("save:start"));
  assert.ok(harness.events.indexOf("save:end") < harness.events.indexOf("save:exclusive-exit"));
  assert.equal(harness.events.some((event) => event.startsWith("save:error:")), false);
});

test("multiplayer startup awaits a pre-existing native checkpoint before session side effects", async () => {
  const nativeSave = deferred<void>();
  const events: string[] = [];
  const sentinel = new Error("session setup reached after native checkpoint");
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    multiplayer: null,
    rustNativeSaveOperation: nativeSave.promise,
    rustNativeSaveSuppressedForMultiplayerRuntime: false,
    closeHostRendezvous: async () => { events.push("rendezvous-closed"); },
    removeAllRemotePlayers: () => {
      events.push("session-side-effect");
      throw sentinel;
    },
  });

  const startup = (engine as unknown as {
    beginMultiplayerSession(name: string, role: "host" | "guest"): Promise<unknown>;
  }).beginMultiplayerSession("Native Save Barrier", "host");
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(events, ["rendezvous-closed"]);
  assert.equal((engine as unknown as {
    rustNativeSaveSuppressedForMultiplayerRuntime: boolean;
  }).rustNativeSaveSuppressedForMultiplayerRuntime, true,
  "checkpoint admission closes before startup waits on the already-running save");

  nativeSave.resolve(undefined);
  await assert.rejects(startup, (error: unknown) => error === sentinel);
  assert.deepEqual(events, ["rendezvous-closed", "session-side-effect"]);
});
