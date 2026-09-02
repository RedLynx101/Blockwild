import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_WORLD_OPTIONS,
  VoxelEngine,
  isMultiplayerGuestWorldReady,
} from "../app/game/engine.ts";
import { createGuildBook } from "../app/game/guilds.ts";
import type { PeerInfo, WorldSnapshot } from "../app/game/multiplayer.ts";
import { GENERATOR_VERSION } from "../app/game/world.ts";
import {
  runTitleGuestCleanup,
  titleGuestWorldDisposition,
} from "../app/game/VoxelGame.tsx";

test("guest world readiness requires both the guest role and an applied host snapshot", () => {
  for (const [role, receivedSnapshot, expected] of [
    [null, false, false],
    [null, true, false],
    ["host", false, false],
    ["host", true, false],
    ["guest", false, false],
    ["guest", true, true],
  ] as const) {
    assert.equal(isMultiplayerGuestWorldReady(role, receivedSnapshot), expected);
  }
});

test("the title transition ignores transport state and waits for exact guest world readiness", () => {
  assert.equal(titleGuestWorldDisposition("pause", { role: "guest", guestWorldReady: true, error: null }), "inactive");
  assert.equal(titleGuestWorldDisposition("title", { role: "host", guestWorldReady: true, error: null }), "inactive");
  assert.equal(titleGuestWorldDisposition("title", { role: "guest", guestWorldReady: false, error: null }), "pending");
  assert.equal(titleGuestWorldDisposition("title", { role: "guest", guestWorldReady: true, error: null }), "ready");
  assert.equal(titleGuestWorldDisposition("title", { role: "guest", guestWorldReady: false, error: "transport failed" }), "failed");
});

test("abandoning a title guest attempt resets only after disconnect succeeds", async () => {
  const success: string[] = [];
  assert.equal(await runTitleGuestCleanup({
    disconnect: async () => { success.push("disconnect"); },
    reset: () => { success.push("reset"); },
    reportFailure: (message) => { success.push(`error:${message}`); },
  }), true);
  assert.deepEqual(success, ["disconnect", "reset"]);

  const failure: string[] = [];
  assert.equal(await runTitleGuestCleanup({
    disconnect: async () => { failure.push("disconnect"); throw new Error("network teardown exploded"); },
    reset: () => { failure.push("reset"); },
    reportFailure: (message) => { failure.push(`error:${message}`); },
  }), false);
  assert.deepEqual(failure, ["disconnect", "error:network teardown exploded"]);
});

test("title multiplayer renders direct guest exchange but keeps direct hosting in-world only", async () => {
  const source = await readFile(new URL("../app/game/VoxelGame.tsx", import.meta.url), "utf8");
  assert.match(source, /Advanced direct guest connection/u);
  assert.match(source, /multiplayerReturn === "pause" && <section>\s*<span className="panel-eyebrow">HOST OFFER<\/span>/u);
  assert.match(source, /<span className="panel-eyebrow">JOIN OFFER<\/span>/u);
  assert.match(source, /disconnectMultiplayer!\("title-guest-abandoned"\)/u);
  assert.match(source, /onClick=\{closeMultiplayerPanel\}>Back<\/PixelButton>/u);
});

test("text diagnostics retain exact multiplayer status after the title guest panel closes", async () => {
  const source = await readFile(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  assert.match(source, /status: this\.multiplayer\?\.state \?\? this\.multiplayerState\.status/u);
  assert.match(source, /error: this\.multiplayerState\.error \|\| null/u);
});

test("guest snapshot mutation detaches the former local save before async terrain readiness", async () => {
  let enterTerrainWait!: () => void;
  let rejectTerrainWait!: (error: Error) => void;
  const terrainWaitEntered = new Promise<void>((resolve) => { enterTerrainWait = resolve; });
  const terrainWait = new Promise<void>((_resolve, reject) => { rejectTerrainWait = reject; });
  let resetSeed = "";
  let catalogWrites = 0;
  const world = {
    seedText: "LOCAL-SAVE-SEED",
    reset(seed: string) { resetSeed = seed; this.seedText = seed; },
    initializeAround() {},
    async awaitGenerationRing() {
      enterTerrainWait();
      await terrainWait;
    },
  };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    persistent: true,
    activeWorldId: "local-world-123",
    running: true,
    paused: false,
    multiplayerReceivedSnapshot: false,
    multiplayerTerrainReadinessGeneration: 0,
    multiplayerTerrainReadinessAbort: null,
    multiplayerState: { error: "" },
    multiplayer: { identity: { id: "guest-player" } },
    world,
    worldOptions: { ...DEFAULT_WORLD_OPTIONS, enabledFactions: [...DEFAULT_WORLD_OPTIONS.enabledFactions] },
    agentMode: false,
    pendingNetworkMobDeaths: new Set(),
    liquidCells: new Set(),
    chests: new Map(),
    multiplayerContainerRevisions: new Map(),
    multiplayerContainerSignatures: new Map(),
    multiplayerContainerAwaiting: new Set(),
    mapSurfaceSurveyedThisSession: new Set(),
    legendaryEncounters: new Set(),
    primeEncounters: new Set(),
    cardforgeLastPackReveals: new Map(),
    rangedLoaded: new Set(),
    clearEntities() {},
    localPlayerId: () => "guest-player",
    terrainGenerationMode: () => "rust",
    worldStorage: { updateWorld: () => { catalogWrites += 1; } },
  });
  const snapshot: WorldSnapshot = {
    tick: 1,
    seed: "HOST-WORLD-SEED",
    mode: "survival",
    generatorVersion: GENERATOR_VERSION,
    generatorProfile: "world-below-v15",
    players: [{
      playerId: "host-player", tick: 1, x: 0, y: 48, z: 0,
      yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, grounded: true, action: "none",
    }],
    blockEdits: [],
    mobs: [],
    mobScope: { centerPlayerId: "guest-player", radius: 96, epoch: 1 },
    drops: [],
    dropScope: { centerPlayerId: "guest-player", radius: 96, epoch: 1 },
    tombstones: [], boats: [], containers: [],
    time: { tick: 1, worldTime: 0.25, day: 1, weather: "clear" },
    worldOptions: { ...DEFAULT_WORLD_OPTIONS, enabledFactions: [...DEFAULT_WORLD_OPTIONS.enabledFactions] },
    guildBook: createGuildBook(),
  };
  const hostPeer: PeerInfo = {
    token: "host-token",
    identity: { id: "host-player", name: "Host", color: "#55aaff" },
    state: "connected",
    connectedAt: 1,
    lastSeenAt: 1,
    latencyMs: 1,
    reliableOpen: true,
    movementOpen: true,
    voiceOpen: false,
  };
  const applyInitialWorldSnapshot = (engine as unknown as {
    applyInitialWorldSnapshot(snapshot: WorldSnapshot, peer: PeerInfo): Promise<void>;
  }).applyInitialWorldSnapshot.bind(engine);
  const applying = applyInitialWorldSnapshot(snapshot, hostPeer);
  await terrainWaitEntered;

  assert.equal(resetSeed, "HOST-WORLD-SEED", "the regression must pause after host identity mutation");
  assert.equal(engine.persistent, false);
  assert.equal(engine.activeWorldId, null);
  assert.equal(engine.saveNow(false), true, "an already queued autosave becomes a no-op");
  assert.equal(catalogWrites, 0, "host state must not reach the former local catalog row");

  rejectTerrainWait(new Error("stop after persistence-ownership assertion"));
  await assert.rejects(applying, /stop after persistence-ownership assertion/u);
});
