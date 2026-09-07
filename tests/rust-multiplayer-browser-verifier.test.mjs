import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
  REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE,
  REQUIRED_LOCAL_WEBRTC_BROWSER_ARGUMENT,
  RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR,
  RUST_MULTIPLAYER_CONTINUE_ROUTE_TIMEOUT_MS,
  RUST_MULTIPLAYER_HOST_PEER_DRAIN_TIMEOUT_MS,
  acquireManagedBrowserGateMutex,
  assessRustMultiplayerConnectedSurface,
  assessRustMultiplayerVisualTerrainReadiness,
  assessRustMultiplayerAuthorityPair,
  assertLocalOnlyRtcConfigurations,
  assertRustMultiplayerBrowserErrorStreams,
  assertRustMultiplayerCleanupEvidence,
  assertRustMultiplayerCandidateUnchanged,
  assertRustMultiplayerGuestDisconnectProgressionDrain,
  assertRustMultiplayerGenerationAudit,
  assertRustMultiplayerLocalWorldCatalogInvariant,
  assertRustMultiplayerMovementProof,
  assertRustMultiplayerR5PlayerAuthorityDiagnostics,
  assertRustMultiplayerR5PlayerAuthorityPair,
  assertRustMultiplayerR5OutboundPoseDiagnostics,
  assertRustMultiplayerR5RouteSelector,
  assertRustMultiplayerReconnectPanelRouting,
  assertRustMultiplayerReconnectCommandContinuity,
  assertRustMultiplayerReconnectProof,
  assertRustMultiplayerRuntimePair,
  assertRustMultiplayerSignalPair,
  changedInputValue,
  assertRustMultiplayerStateTransfer,
  cleanupRustMultiplayerViteStartupAttempt,
  classifyRustMultiplayerFailure,
  classifyRustMultiplayerHarnessDiagnostics,
  compactRustMultiplayerGuestDisconnectSnapshot,
  compactRustMultiplayerAuthorityCommandEvidence,
  compactRustMultiplayerMovementDiagnostics,
  collectRustMultiplayerRuntimeErrors,
  decodeRustMultiplayerManualSignal,
  ensureRustMultiplayerPanel,
  installRustMultiplayerViteEnvironment,
  isExpectedLocalMusicCancellation,
  isExpectedManagedViteWebSocket,
  managedBrowserGateMutexPort,
  parseRustMultiplayerBrowserOptions,
  resolveRustMultiplayerCandidateRoute,
  rustMultiplayerMapPinConverged,
  rustMultiplayerHostDisconnectDrained,
  rustMultiplayerPanelRoute,
  performRustMultiplayerPanelAction,
  rustMultiplayerManagedViteInlineConfig,
  rustMultiplayerManagedViteWrapperSource,
  rustMultiplayerNavigationUrl,
  rustMultiplayerViteEnvironment,
  selectRustMultiplayerCandidate,
  summarizeRustMultiplayerManualSignal,
  waitForHarness,
  waitForAuthorityPair,
  waitForRustMultiplayerGuestDisconnect,
  waitForRustMultiplayerHostPeerDrain,
  waitForRustMultiplayerVisualTerrainReadiness,
  waitForRustMultiplayerMapPinConvergence,
  waitForRustMultiplayerMovementEndpoint,
  waitForRustMultiplayerNativePoseConvergence,
  waitForRustMultiplayerPortRefusal,
} from "../scripts/verify-rust-multiplayer-browser.mjs";
import { managedBrowserGateMutexPort as r5ManagedBrowserGateMutexPort } from "../scripts/verify-rust-r5-player-browser.mjs";
import { createRustEngineCandidateFixture } from "./helpers/rust-engine-candidate-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST_ID = "browser_acceptance_host.character_acceptance_host";
const GUEST_ID = "browser_acceptance_guest.character_acceptance_guest";
const CONTENT_HASH = "2".repeat(32);
const WORLD_SEED = "MOON-FIELD-505";

// Output-path validation intentionally requires an existing work directory.
before(() => { mkdirSync(path.join(ROOT, "work"), { recursive: true }); });

function argv(...options) {
  return ["node", "scripts/verify-rust-multiplayer-browser.mjs", ...options];
}

function cleanErrorStreams() {
  return {
    consoleErrors: [],
    pageErrors: [],
    runtimeErrors: [],
    httpErrors: [],
    externalRequests: [],
    webSockets: [],
    expectedRequestCancellations: [],
    managedViteWebSockets: [],
  };
}

function healthyHarnessDiagnostics() {
  return {
    schema: 1,
    label: "host",
    evaluationError: null,
    expectedBuildProfile: "rust-primary",
    navigation: { status: 200, ok: true, url: "http://127.0.0.1:5173/" },
    browser: { isClosed: false, crashed: false, lifecycle: { closed: false } },
    streams: {
      consoleErrors: [], pageErrors: [], httpErrors: [], externalRequests: [], webSockets: [],
    },
    document: {
      readyState: "complete",
      visibleAlerts: [],
      errorOverlays: [],
    },
    globals: {
      ready: true,
      types: {
        render_game_to_text: "function",
        render_rust_runtime_to_text: "function",
        set_game_key: "function",
        pulse_game_key: "function",
        advanceTime: "function",
      },
    },
    build: { domProfile: "rust-primary", stateProfile: null, runtimeProfile: null },
    webgl: {
      probe: { attempted: true, available: true, kind: "webgl2", error: null },
      descriptor: { configurable: false, enumerable: false, writable: false },
    },
  };
}

function runtimeDescriptor() {
  return {
    schema: 2,
    worldSeed: WORLD_SEED,
    universeId: "universe_acceptance_001",
    locationId: "location_acceptance_001",
    runtimeSessionId: "session_acceptance_001",
    generatorHash: "1".repeat(32),
    contentHash: CONTENT_HASH,
    terrainContentHash: "3".repeat(32),
    generationOptionsJson: "{\"profile\":\"rust-primary\"}",
    descriptorHash: "4".repeat(32),
  };
}

function manualSignal(kind, identity, overrides = {}) {
  const runtime = runtimeDescriptor();
  const signal = {
    version: 3,
    protocol: "blockwild-webrtc",
    kind,
    sessionId: runtime.runtimeSessionId,
    token: "invite_acceptance_001",
    identity: {
      id: identity,
      name: identity === HOST_ID ? "Rust Host" : "Rust Guest",
      color: "#3f7fba",
      variant: "male",
      sex: "male",
      profileId: identity === HOST_ID ? "character_acceptance_host" : "character_acceptance_guest",
      browserId: identity === HOST_ID ? "browser_acceptance_host" : "browser_acceptance_guest",
      peerKind: "human",
    },
    description: {
      type: kind,
      sdp: `v=0\r\na=candidate:1 1 UDP 2122260223 127.0.0.1 ${kind === "offer" ? 51001 : 51002} typ host\r\n`,
    },
    authority: { schema: 1, packet: Buffer.from(`${kind}-authority`).toString("base64url") },
    runtime,
    ...overrides,
  };
  return `BW1.${Buffer.from(JSON.stringify(signal)).toString("base64url")}`;
}

function runtime(role) {
  return {
    ready: true,
    operationsBlocked: false,
    activeUniverseId: "universe_acceptance_001",
    activeLocationId: "location_acceptance_001",
    activeSessionId: "session_acceptance_001",
    hydration: role === "host" ? "new-world" : "guest-bootstrap",
    manager: {
      state: "ready",
      host: {
        state: "ready",
        artifactHash: REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
        contentHash: CONTENT_HASH,
        adapter: {
          state: "ready",
          authoritative: true,
          verification: "content-addressed-wasm",
          liveAuthorityReady: true,
        },
      },
    },
    multiplayer: {
      authorityDeltaSequence: role === "host" ? 1 : 0,
      authorityDeltaApplied: role === "guest" ? 1 : 0,
      authorityResyncs: 0,
      authorityRejections: 0,
      recordProducer: "coarse-legacy-projection",
      pendingNativeProducer: true,
      lastStateHash: role === "guest" ? "5".repeat(32) : null,
      lastError: null,
    },
  };
}

function generationCertificate() {
  return {
    generatorVersion: REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.generatorVersion,
    generatorHash: REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.generatorHash,
    contentHash: REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.contentHash,
    corpusHash: REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.corpusHash,
    corpusCases: REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.corpusCases,
    byteEqual: REQUIRED_MULTIPLAYER_GENERATION_CERTIFICATE.byteEqual,
  };
}

function generationAuditSnapshot() {
  return {
    state: {
      performance: {
        streaming: {
          generationWorker: {
            mode: "rust",
            selectionSource: "build-rust-primary",
            workers: 2,
            ready: 2,
          },
        },
      },
    },
    runtime: { manager: { host: { artifactHash: REQUIRED_MULTIPLAYER_ARTIFACT_HASH } } },
    generationAuditDescriptor: { configurable: false, writable: false, enumerable: false },
    generationAudit: {
      schema: 1,
      sentinel: "blockwild-rust-multiplayer-generation-audit-v1",
      workerInstrumentation: true,
      dataChannelSendInstrumentation: true,
      workerStillInstalled: true,
      dataChannelSendStillInstalled: true,
      generationWorkerCreations: [1, 2].map((ordinal) => ({
        ordinal,
        url: `http://127.0.0.1/app/game/terrain-generation-worker.ts?worker=${ordinal}`,
        type: "module",
        name: null,
      })),
      generationReadyMessages: [1, 2].map((ordinal) => ({
        ordinal,
        workerUrl: `http://127.0.0.1/app/game/terrain-generation-worker.ts?worker=${ordinal}`,
        type: "terrain-generation-ready-v2",
        protocolVersion: 2,
        requestSchemaVersion: 2,
        resultSchemaVersion: 2,
        backend: "rust-wasm-authoritative",
        certificate: generationCertificate(),
      })),
      generationWorkerTerminations: [],
      generationStartupErrors: [],
      outboundAuthorityCommands: [],
      outboundPlayerPoses: [],
    },
  };
}

function authorityPairSnapshot(role, overrides = {}) {
  const snapshot = generationAuditSnapshot();
  const runtimeState = runtime(role);
  const hostSequence = overrides.hostSequence ?? (role === "host" ? 1 : 0);
  const guestApplied = overrides.guestApplied ?? (role === "guest" ? 1 : 0);
  const keyframeAccepted = overrides.keyframeAccepted ?? role === "guest";
  const presentationReady = overrides.presentationReady ?? role === "guest";
  const acceptedDeltaCount = overrides.acceptedDeltaCount ?? (role === "guest" ? 1 : 0);
  const remotePeerId = role === "host" ? GUEST_ID : HOST_ID;
  runtimeState.multiplayer.authorityDeltaSequence = hostSequence;
  runtimeState.multiplayer.authorityDeltaApplied = guestApplied;
  runtimeState.multiplayer.lastStateHash = role === "guest" && guestApplied >= 1 ? "5".repeat(32) : null;
  runtimeState.multiplayer.transport = {
    schema: 1,
    state: "connected",
    role,
    authorityMode: "rust-authoritative",
    guest: { keyframeAccepted, presentationReady, presentationGeneration: role === "guest" ? 1 : 0, acceptedDeltaCount },
    authorityOperations: 0,
    peers: [{
      peerId: remotePeerId,
      state: "connected",
      reliableState: "open",
      protocolStrikes: 0,
      authorityRejected: 0,
      authorityErrors: 0,
    }],
  };
  snapshot.runtime = runtimeState;
  snapshot.state.world = { seed: role === "guest" && guestApplied < 1 ? "WILDERNESS" : WORLD_SEED };
  snapshot.state.multiplayer = { role, status: "connected", error: null };
  return snapshot;
}

function withR5PlayerAuthority(snapshot, role, position = [6, 43.5, 0]) {
  const value = structuredClone(snapshot);
  value.state.state = "playing";
  value.runtime.transitionGeneration = 3;
  value.runtime.manager.requestedGeneration = 3;
  value.runtime.manager.activeGeneration = 3;
  value.runtime.playerAuthority = {
    state: "ready",
    worldGeneration: 3,
    runtimeSessionId: value.runtime.activeSessionId,
    entityId: role === "host" ? "4294967297" : "4294967298",
    terrainChunkCount: 25,
    lastError: null,
    pump: {
      state: "ready",
      worldGeneration: 3,
      authoritativeFlags: 0,
      lastAuthorityTick: 42,
      nextInputSequence: 12,
      lastError: null,
    },
  };
  value.runtime.multiplayer.lastOutboundPose = {
    producer: "rust-live-player-view-r10-kinematics",
    playerId: role === "host" ? HOST_ID : GUEST_ID,
    tick: 300,
    position: { x: position[0], y: position[1], z: position[2] },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    grounded: true,
    crouching: false,
    sprinting: false,
    selected: 0,
    nativeSource: {
      extractionRevision: "11",
      authorityTick: "42",
      entityRevision: "9",
      lastInputSequence: "11",
    },
  };
  return value;
}

function visualTerrainSnapshot(mode = "source") {
  const centerKey = "0,0";
  const chunks = [];
  for (let x = -1; x <= 1; x += 1) for (let z = -1; z <= 1; z += 1) {
    const hasCutout = x === 0 && z === 0;
    const presented = (required) => ({
      required,
      source: mode === "source",
      sourceVisible: mode === "source",
      combined: mode === "combined",
      combinedVisible: mode === "combined",
      mode: required ? mode : null,
    });
    chunks.push({
      key: `${x},${z}`,
      offset: { x, z },
      present: true,
      visible: true,
      lightReady: true,
      ready: true,
      requiredSections: [{
        section: 6,
        requiredLayers: hasCutout ? ["opaque", "cutout"] : ["opaque"],
        presentations: {
          opaque: presented(true),
          cutout: presented(hasCutout),
        },
        ready: true,
      }],
    });
  }
  return {
    state: {
      performance: {
        streaming: {
          playerChunk: centerKey,
          playerChunkReady: true,
          playerChunkStage: "ready",
          immediateRing: { desired: 9, ready: 9, ratio: 1 },
          generationWorker: {
            mode: "rust",
            selectionSource: "build-rust-primary",
            state: "ready",
            supported: true,
            workers: 2,
            ready: 2,
            epoch: 4,
            failed: 0,
            rejected: 0,
            restarts: 0,
            lastError: null,
          },
          terrainWorker: {
            supported: true,
            ready: true,
            failed: 0,
            restarts: 0,
            lastError: null,
          },
          terrainSubmission: { submittedMeshes: 999 },
          playerTerrainPresentation: {
            schema: 1,
            epoch: 7,
            centerKey,
            desired: 9,
            ready: 9,
            chunks,
          },
        },
      },
    },
    runtime: runtime("host"),
  };
}

function deltaSnapshot(authorityDeltaSequence, authorityDeltaApplied, lastStateHash = null) {
  return {
    runtime: {
      multiplayer: {
        authorityDeltaSequence,
        authorityDeltaApplied,
        lastStateHash,
        recordProducer: "coarse-legacy-projection",
        pendingNativeProducer: true,
      },
    },
  };
}

function nativePoseConvergenceSnapshots(sequence, position, overrides = {}) {
  const generation = overrides.generation ?? 1;
  const recordRevision = overrides.recordRevision ?? sequence + 1;
  const receiptHash = overrides.receiptHash ?? "a".repeat(32);
  const recordHash = overrides.recordHash ?? "b".repeat(32);
  const tick = overrides.tick ?? sequence * 10;
  const custody = {
    connectionGeneration: generation,
    commandSequence: sequence,
    recordRevision,
    receiptHash,
    recordHash,
  };
  const pose = {
    sequence: sequence + 100,
    authoritySequence: sequence,
    from: GUEST_ID,
    playerId: GUEST_ID,
    tick,
    position: [...position],
    yaw: 0,
    pitch: 0,
  };
  const host = authorityPairSnapshot("host", { hostSequence: 2 });
  host.state.state = "playing";
  host.state.multiplayer.remotePlayers = [{
    id: GUEST_ID,
    name: "Rust Guest",
    position: [...position],
    tick,
    ageMilliseconds: 20,
    nativePoseCustody: custody,
  }];
  host.runtime.multiplayer.transport.authorityOperations = overrides.authorityOperations ?? 1;
  host.runtime.multiplayer.transport.peers = [{
    peerId: GUEST_ID,
    state: overrides.peerState ?? "connected",
    authorityQueued: overrides.authorityQueued ?? sequence + 4,
    authorityInFlight: overrides.authorityInFlight ?? 1,
    authorityAccepted: overrides.authorityAccepted ?? sequence + 1,
    authorityRejected: overrides.authorityRejected ?? 0,
    authorityErrors: overrides.authorityErrors ?? 0,
    protocolStrikes: overrides.protocolStrikes ?? 0,
    authorityGeneration: generation,
    nativePoseAccepted: overrides.nativePoseAccepted ?? 3,
    nativePoseDelivered: overrides.nativePoseDelivered ?? 3,
    nativePoseStaleGenerationDrops: overrides.nativePoseStaleGenerationDrops ?? 0,
    lastNativePoseCommandSequence: sequence,
    lastNativePoseRecordRevision: recordRevision,
    lastNativePoseReceiptHash: receiptHash,
    lastNativePoseRecordHash: recordHash,
    lastInboundType: "player-pose",
    lastInboundAuthoritySequence: overrides.lastInboundAuthoritySequence ?? sequence,
  }];
  const guest = authorityPairSnapshot("guest", { guestApplied: 2 });
  guest.state.state = "playing";
  guest.generationAudit.outboundPlayerPoses = overrides.outboundPlayerPoses ?? [pose];
  return { host, guest, custody, pose };
}

test("multiplayer verifier CLI requires the exact isolated candidate, artifact, and work output", () => {
  assert.equal(REQUIRED_LOCAL_WEBRTC_BROWSER_ARGUMENT, "--disable-features=WebRtcHideLocalIpsWithMdns");
  const parsed = parseRustMultiplayerBrowserOptions(argv(
    "--engine-dir", "public/engine-locator-candidate",
    "--expected-artifact-hash", REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
    "--output", "work/rust-multiplayer-browser-unit",
    "--timeout-ms", "60000",
  ), { cwd: ROOT });
  assert.equal(parsed.repositoryRoot, realpathSync(ROOT));
  assert.equal(parsed.engineDirectory, path.join(ROOT, "public", "engine-locator-candidate"));
  assert.equal(parsed.expectedArtifactHash, REQUIRED_MULTIPLAYER_ARTIFACT_HASH);
  assert.equal(parsed.outputDirectory, path.join(ROOT, "work", "rust-multiplayer-browser-unit"));
  assert.equal(parsed.timeoutMilliseconds, 60_000);
  assert.equal(parsed.requireR5PlayerAuthority, false);
  const combined = parseRustMultiplayerBrowserOptions(argv(
    "--engine-dir", "public/engine-locator-candidate",
    "--expected-artifact-hash", REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
    "--output", "work/rust-multiplayer-browser-unit",
    "--require-r5-player-authority",
  ), { cwd: ROOT });
  assert.equal(combined.requireR5PlayerAuthority, true);

  assert.throws(() => parseRustMultiplayerBrowserOptions(argv(
    "--engine-dir", "public/engine-locator-candidate",
    "--expected-artifact-hash", "a".repeat(64),
    "--output", "work/rust-multiplayer-browser-unit",
  ), { cwd: ROOT }), /must explicitly equal/u);
  assert.throws(() => parseRustMultiplayerBrowserOptions(argv(
    "--engine-dir", "public/engine",
    "--expected-artifact-hash", REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
    "--output", "work/rust-multiplayer-browser-unit",
  ), { cwd: ROOT }), /exactly to public\/engine-locator-candidate/u);
  assert.throws(() => parseRustMultiplayerBrowserOptions(argv(
    "--engine-dir", "public/engine-locator-candidate",
    "--expected-artifact-hash", REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
    "--output", "outside-work",
  ), { cwd: ROOT }), /strictly beneath/u);
  assert.throws(() => parseRustMultiplayerBrowserOptions(argv(
    "--engine-dir", "public/engine-locator-candidate",
    "--expected-artifact-hash", REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
    "--output", "work/rust-multiplayer-browser-unit",
    "--timeout-ms", "59999",
  ), { cwd: ROOT }), /60000 through 900000/u);
});

test("combined R9+R5 navigation adds one exact selector to both roles and fails closed if it is lost", () => {
  assert.deepEqual(RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR, {
    parameter: "experimental.rust-live-player-authority",
    value: "r5",
    claim: "experimental.rust-live-player-authority=r5",
  });
  for (const role of ["host", "guest"]) {
    const combined = rustMultiplayerNavigationUrl("http://127.0.0.1:5173", role, {
      requireR5PlayerAuthority: true,
    });
    const parsed = new URL(combined);
    assert.equal(parsed.searchParams.get("rust-multiplayer-acceptance"), role);
    assert.equal(assertRustMultiplayerR5RouteSelector(combined, role), true);
    const ordinary = new URL(rustMultiplayerNavigationUrl("http://127.0.0.1:5173", role));
    assert.equal(ordinary.searchParams.has("experimental.rust-live-player-authority"), false);
  }
  assert.throws(() => assertRustMultiplayerR5RouteSelector(
    "http://127.0.0.1:5173/?rust-multiplayer-acceptance=guest",
    "guest title reconnect",
  ), /lost the exact experimental\.rust-live-player-authority=r5 selector/u);
  assert.throws(() => assertRustMultiplayerR5RouteSelector(
    "http://127.0.0.1:5173/?experimental.rust-live-player-authority=r5&experimental.rust-live-player-authority=r5",
  ));
});

test("combined R9+R5 lane retains the selector across title reconnect and reports bounded candidate evidence", () => {
  const source = readFileSync(path.join(ROOT, "scripts", "verify-rust-multiplayer-browser.mjs"), "utf8");
  for (const phase of [
    "initial navigation",
    "local fixture",
    "initial connected session",
    "post-movement",
    "disconnect title return",
    "title reconnect",
    "final reconnected gameplay",
  ]) {
    assert.match(source, new RegExp(`assertOptionalR5PlayerAuthorityRoutes\\(options, "${phase}"`, "u"));
  }
  assert.match(source, /rust-r5-native-player-simulation-with-rust-native-guest-pose-custody-and-compatibility-world-keyframes/u);
  assert.match(source, /Periodic world keyframes still report coarse-legacy-projection with pendingNativeProducer=true/u);
  assert.match(source, /does not mutate or promote canonical public\/engine/u);
  assert.match(source, /assertRustMultiplayerR5OutboundPoseDiagnostics\(postInputGuest/u);
  assert.match(source, /assertRustMultiplayerR5OutboundPoseDiagnostics\(\s*reconnectAuthority\.guestSnapshot/u);
});

test("candidate selection is current-source, exact-hash, and routed only through production engine aliases", (t) => {
  const fixture = createRustEngineCandidateFixture(t);
  const selection = selectRustMultiplayerCandidate(
    fixture.root,
    "public/engine-locator-candidate",
    fixture.hash,
  );
  assert.equal(selection.hash, fixture.hash);
  assert.equal(selection.variant, "compatibility");
  assert.equal(selection.sourceSnapshot.digest, selection.manifest.sourceSnapshot.digest);
  assert.deepEqual(selection.sourceSnapshot, fixture.sourceSnapshot);
  assert.ok(resolveRustMultiplayerCandidateRoute(selection, "/engine/manifest.json"));
  assert.ok(resolveRustMultiplayerCandidateRoute(selection, `/engine/${fixture.hash}/manifest.json`));
  assert.equal(resolveRustMultiplayerCandidateRoute(selection, "/engine/../manifest.json"), null);
  assert.equal(resolveRustMultiplayerCandidateRoute(selection, "/engine/%2e%2e/manifest.json"), null);
  assert.equal(resolveRustMultiplayerCandidateRoute(selection, "/engine/not-the-artifact/file.wasm"), null);
  assert.throws(() => selectRustMultiplayerCandidate(fixture.root, "public/engine", fixture.hash), /exactly public\/engine-locator-candidate/u);
  assert.ok(assertRustMultiplayerCandidateUnchanged(selection));
});

test("candidate selection rejects explicit hash mismatch without weakening the CLI acceptance pin", (t) => {
  const fixture = createRustEngineCandidateFixture(t);
  assert.throws(() => selectRustMultiplayerCandidate(fixture.root, "public/engine-locator-candidate", "0".repeat(64)), /Selected compatibility artifact is not/u);
  for (const invalid of [undefined, "", "A".repeat(64), "0".repeat(63), { toString: () => fixture.hash }]) {
    assert.throws(() => selectRustMultiplayerCandidate(fixture.root, "public/engine-locator-candidate", invalid), /explicit lowercase SHA-256/u);
  }
  assert.throws(() => parseRustMultiplayerBrowserOptions(argv(
    "--engine-dir", "public/engine-locator-candidate", "--expected-artifact-hash", fixture.hash,
    "--output", "work/rust-multiplayer-browser-unit",
  ), { cwd: ROOT }), /must explicitly equal/u);
});

test("candidate selection fails closed on source drift, payload corruption and incomplete build provenance", async (t) => {
  for (const [name, mutate, pattern] of [
    ["source drift", (fixture) => writeFileSync(fixture.sourcePath, "pub fn changed_source() {}\n"), /not current-source/u],
    ["payload corruption", (fixture) => {
      const bytes = readFileSync(fixture.wasmPath); bytes[0] ^= 1; writeFileSync(fixture.wasmPath, bytes);
    }, /checksum or size mismatch/u],
    ["build provenance", (fixture) => {
      const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")); manifest.target = "not-wasm";
      writeFileSync(fixture.manifestPath, JSON.stringify(manifest));
    }, /build provenance/u],
  ]) await t.test(name, (child) => {
    const fixture = createRustEngineCandidateFixture(child); mutate(fixture);
    assert.throws(() => selectRustMultiplayerCandidate(fixture.root, "public/engine-locator-candidate", fixture.hash), pattern);
  });
});

test("candidate unchanged guard detects both source and artifact-tree mutation after selection", async (t) => {
  for (const [name, mutate, pattern] of [
    ["source", (fixture) => writeFileSync(fixture.sourcePath, "pub fn changed_source() {}\n"), /source changed/u],
    ["artifact tree", (fixture) => writeFileSync(path.join(fixture.artifactDirectory, "unexpected.bin"), "unexpected"), /engine tree changed/u],
  ]) await t.test(name, (child) => {
    const fixture = createRustEngineCandidateFixture(child);
    const selection = selectRustMultiplayerCandidate(fixture.root, "public/engine-locator-candidate", fixture.hash);
    mutate(fixture);
    assert.throws(() => assertRustMultiplayerCandidateUnchanged(selection), pattern);
  });
});

test("combined lane requires exact R5 player authority, pump, and native outbound-pose provenance", () => {
  const host = withR5PlayerAuthority(authorityPairSnapshot("host"), "host");
  const guest = withR5PlayerAuthority(authorityPairSnapshot("guest"), "guest");
  const pair = assertRustMultiplayerR5PlayerAuthorityPair(host, guest, "combined fixture");
  assert.equal(pair.host.playerAuthority.state, "ready");
  assert.equal(pair.guest.pump.state, "ready");
  assert.equal(pair.guest.operationsBlocked, false);
  assert.equal(assertRustMultiplayerR5PlayerAuthorityDiagnostics(
    guest,
    REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
    "guest fixture",
  ).pump.lastAuthorityTick, 42);
  const outbound = assertRustMultiplayerR5OutboundPoseDiagnostics(guest, {
    playerId: GUEST_ID,
    transportTick: 300,
    position: [6, 43.5, 0],
  }, "guest fixture");
  assert.equal(outbound.producer, "rust-live-player-view-r10-kinematics");
  assert.deepEqual(outbound.position, [6, 43.5, 0]);
  assert.equal(outbound.nativeSource.authorityTick, "42");

  for (const mutate of [
    (value) => { value.runtime.operationsBlocked = true; },
    (value) => { value.runtime.manager.requestedGeneration = 0; },
    (value) => { value.runtime.manager.activeGeneration = 4; },
    (value) => { value.runtime.playerAuthority.state = "blocked"; },
    (value) => { value.runtime.playerAuthority.worldGeneration = 2; },
    (value) => { value.runtime.playerAuthority.runtimeSessionId = "stale-local-runtime"; },
    (value) => { value.runtime.playerAuthority.terrainChunkCount = 0; },
    (value) => { value.runtime.playerAuthority.pump.state = "blocked"; },
    (value) => { value.runtime.playerAuthority.pump.lastError = "pump-failure"; },
  ]) {
    const changed = structuredClone(guest);
    mutate(changed);
    assert.throws(() => assertRustMultiplayerR5PlayerAuthorityDiagnostics(
      changed,
      REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
      "mutated guest",
    ));
  }
  for (const mutate of [
    (value) => { value.runtime.multiplayer.lastOutboundPose.producer = "typescript-compatibility"; },
    (value) => { value.runtime.multiplayer.lastOutboundPose.nativeSource = null; },
    (value) => { value.runtime.multiplayer.lastOutboundPose.nativeSource.authorityTick = "41"; },
    (value) => { value.runtime.multiplayer.lastOutboundPose.position.x = 6.5; },
  ]) {
    const changed = structuredClone(guest);
    mutate(changed);
    assert.throws(() => assertRustMultiplayerR5OutboundPoseDiagnostics(changed, {
      playerId: GUEST_ID,
      transportTick: 300,
      position: [6, 43.5, 0],
    }, "mutated guest"));
  }
});

test("managed Vite owns cache, filters Cloudflare, environment, HMR, and watch lifecycle", () => {
  const plugin = { name: "blockwild-rust-multiplayer-exact-engine" };
  const runtimeDirectory = path.join(ROOT, "work", "rust-multiplayer-browser-unit-runtime");
  const config = rustMultiplayerManagedViteInlineConfig(ROOT, 51_739, runtimeDirectory, plugin);
  assert.equal(config.root, realpathSync(ROOT));
  assert.equal(config.configFile, path.join(runtimeDirectory, "vite.config.mjs"));
  assert.equal(config.configLoader, "runner");
  assert.equal(config.cacheDir, path.join(runtimeDirectory, "node_modules", ".vite"));
  assert.deepEqual(config.plugins, [plugin]);
  assert.equal(config.server.hmr, false);
  assert.equal(config.server.strictPort, true);
  assert.equal(config.server.watch.ignored(path.join(ROOT, "app", "page.tsx")), true);
  const wrapper = rustMultiplayerManagedViteWrapperSource(ROOT, runtimeDirectory);
  assert.match(wrapper, /\.filter\(\(plugin\) => !cloudflarePlugin\(plugin\)\)/u);
  assert.match(wrapper, /plugins: productionPlugins/u);
  assert.doesNotMatch(wrapper, /import \{ cloudflare \}/u);
  assert.doesNotMatch(wrapper, /persistState:/u);
  assert.equal(wrapper.includes(JSON.stringify(path.join(runtimeDirectory, "node_modules", ".vite"))), true);
  assert.match(wrapper, /const resolvedBaseConfig = typeof baseConfig === "function"/u);
  assert.match(wrapper, /\? await baseConfig\(multiplayerConfigEnvironment\)/u);
  assert.match(wrapper, /export default \{/u);
  assert.doesNotMatch(wrapper, /export default async function/u);
  const original = {
    KEEP_ME: "yes",
    BLOCKWILD_WORLDGEN_BUILD_PROFILE: "typescript-rollback",
    BLOCKWILD_RUST_ENGINE_CANDIDATE_ALIAS: "1",
    NEXT_PUBLIC_BLOCKWILD_EXPERIMENTAL_RUST_LIVE_PLAYER_AUTHORITY_R5: "1",
  };
  const configured = rustMultiplayerViteEnvironment(original, runtimeDirectory);
  assert.equal(configured.KEEP_ME, "yes");
  assert.equal(configured.BLOCKWILD_WORLDGEN_BUILD_PROFILE, "rust-primary");
  assert.equal(Object.hasOwn(configured, "BLOCKWILD_RUST_ENGINE_CANDIDATE_ALIAS"), false);
  assert.equal(Object.hasOwn(configured, "NEXT_PUBLIC_BLOCKWILD_EXPERIMENTAL_RUST_LIVE_PLAYER_AUTHORITY_R5"), false);
  assert.equal(configured.WRANGLER_LOG_PATH, path.join(runtimeDirectory, "wrangler", "wrangler.log"));
  assert.equal(configured.MINIFLARE_REGISTRY_PATH, path.join(runtimeDirectory, "miniflare", "registry"));
  assert.equal(configured.XDG_CACHE_HOME, path.join(runtimeDirectory, "xdg-cache"));
  const mutableEnvironment = { ...original };
  const restore = installRustMultiplayerViteEnvironment(runtimeDirectory, mutableEnvironment);
  mutableEnvironment.CREATED_DURING_VITE = "remove-me";
  assert.equal(mutableEnvironment.BLOCKWILD_WORLDGEN_BUILD_PROFILE, "rust-primary");
  assert.equal(restore(), true);
  assert.deepEqual(mutableEnvironment, original);
  assert.equal(restore(), true, "exact restoration is idempotent");
  assert.throws(() => rustMultiplayerManagedViteInlineConfig(ROOT, 0, runtimeDirectory, plugin), /port must be an integer/u);
});

test("post-close port proof requires actual loopback refusal", async () => {
  const observations = [true, true, false];
  assert.equal(await waitForRustMultiplayerPortRefusal(51_739, {
    probe: async () => observations.shift(),
    sleep: async () => undefined,
    timeoutMilliseconds: 1_000,
  }), true);
  await assert.rejects(waitForRustMultiplayerPortRefusal(51_739, {
    probe: async () => true,
    timeoutMilliseconds: 0,
  }), /still accepts connections after close/u);
});

test("managed browser mutex is shared with R5, rejects overlap, and has no stale filesystem lock", async () => {
  assert.equal(managedBrowserGateMutexPort(ROOT), r5ManagedBrowserGateMutexPort(ROOT));
  const first = await acquireManagedBrowserGateMutex(ROOT, { port: 0 });
  const port = first.evidence.port;
  assert.equal(first.evidence.mechanism, "exclusive-loopback-listener-os-released");
  await assert.rejects(
    acquireManagedBrowserGateMutex(ROOT, { port }),
    (error) => error.code === "BLOCKWILD_BROWSER_GATE_OVERLAP"
      && error.browserGateMutex?.status === "contended",
  );
  assert.equal(await first.release(), true);
  assert.equal(await first.release(), true);
  const next = await acquireManagedBrowserGateMutex(ROOT, { port });
  assert.equal(next.evidence.port, port);
  assert.equal(await next.release(), true);
});

test("harness diagnostics fail early and classify resource, bootstrap, and signaling separately", async () => {
  const healthy = healthyHarnessDiagnostics();
  assert.deepEqual(classifyRustMultiplayerHarnessDiagnostics(healthy), {
    status: "ready",
    stage: "bootstrap",
    reason: "required-globals-and-runtime-surface-ready",
  });
  const pending = structuredClone(healthy);
  pending.globals.ready = false;
  pending.globals.types.render_game_to_text = "undefined";
  assert.equal(classifyRustMultiplayerHarnessDiagnostics(pending).status, "pending");

  const resourceFailure = structuredClone(pending);
  resourceFailure.streams.httpErrors.push({ label: "host", status: 503 });
  assert.deepEqual(classifyRustMultiplayerHarnessDiagnostics(resourceFailure), {
    status: "failed", stage: "resource", reason: "resource-request-failure",
  });
  const webglFailure = structuredClone(pending);
  webglFailure.webgl.probe.available = false;
  assert.deepEqual(classifyRustMultiplayerHarnessDiagnostics(webglFailure), {
    status: "failed", stage: "bootstrap", reason: "webgl-unavailable",
  });
  const buildMismatch = structuredClone(healthy);
  buildMismatch.build.domProfile = "typescript-rollback";
  assert.deepEqual(classifyRustMultiplayerHarnessDiagnostics(buildMismatch), {
    status: "failed", stage: "bootstrap", reason: "build-profile-mismatch",
  });

  let reads = 0;
  await assert.rejects(waitForHarness({}, 60_000, {
    label: "host",
    now: () => 0,
    sleep: async () => { throw new Error("terminal diagnostics must not sleep"); },
    readDiagnostics: async () => { reads += 1; return webglFailure; },
  }), (error) => error.code === "BLOCKWILD_HARNESS_FAILURE"
    && error.failureStage === "bootstrap"
    && error.harnessDiagnostics === webglFailure);
  assert.equal(reads, 1);

  const bootstrapError = new Error("WebGL unavailable");
  bootstrapError.failureStage = "bootstrap";
  bootstrapError.harnessClassification = { reason: "webgl-unavailable" };
  assert.equal(classifyRustMultiplayerFailure(bootstrapError, "bootstrap").family, "bootstrap");
  const resourceError = new Error("HTTP 503");
  resourceError.failureStage = "resource";
  assert.equal(classifyRustMultiplayerFailure(resourceError, "bootstrap").family, "resource");
  assert.deepEqual(classifyRustMultiplayerFailure(new Error("offer timed out"), "signaling", {
    initial: false,
    reconnect: false,
  }), {
    family: "signaling",
    stage: "signaling",
    code: null,
    reason: null,
    signalingStarted: true,
    initialSignalCompleted: false,
    reconnectSignalCompleted: false,
  });
  const overlap = new Error("occupied");
  overlap.code = "BLOCKWILD_BROWSER_GATE_OVERLAP";
  assert.equal(classifyRustMultiplayerFailure(overlap, "setup").family, "concurrency");
  assert.equal(classifyRustMultiplayerFailure(new Error("pin lag"), "movement").family, "movement");
  assert.equal(classifyRustMultiplayerFailure(new Error("ack timeout"), "disconnect").family, "disconnect");
  assert.equal(classifyRustMultiplayerFailure(new Error("terrain missing"), "terrain-readiness-initial-session").family, "terrain-readiness");
});

test("current-player visual terrain gate requires a stable exact 3x3 opaque and applicable cutout presentation", async () => {
  const source = visualTerrainSnapshot("source");
  const sourceAssessment = assessRustMultiplayerVisualTerrainReadiness(source, "host");
  assert.equal(sourceAssessment.ready, true);
  assert.equal(sourceAssessment.terminal, false);

  const missingOpaque = structuredClone(source);
  const center = missingOpaque.state.performance.streaming.playerTerrainPresentation.chunks
    .find((chunk) => chunk.offset.x === 0 && chunk.offset.z === 0);
  center.requiredSections[0].presentations.opaque.mode = null;
  center.requiredSections[0].presentations.opaque.sourceVisible = false;
  assert.equal(assessRustMultiplayerVisualTerrainReadiness(missingOpaque).ready, false,
    "a distant/global submitted count cannot substitute for the current center's opaque presentation");

  const missingCutout = structuredClone(source);
  const cutout = missingCutout.state.performance.streaming.playerTerrainPresentation.chunks
    .find((chunk) => chunk.offset.x === 0 && chunk.offset.z === 0)
    .requiredSections[0].presentations.cutout;
  cutout.mode = null;
  cutout.sourceVisible = false;
  assert.equal(assessRustMultiplayerVisualTerrainReadiness(missingCutout).ready, false);

  const unhealthyWorker = structuredClone(source);
  unhealthyWorker.state.performance.streaming.terrainWorker.failed = 1;
  unhealthyWorker.state.performance.streaming.terrainWorker.lastError = "opaque merge failed";
  const unhealthyAssessment = assessRustMultiplayerVisualTerrainReadiness(unhealthyWorker);
  assert.equal(unhealthyAssessment.ready, false);
  assert.equal(unhealthyAssessment.terminal, true);

  const rejectedAuthority = structuredClone(source);
  rejectedAuthority.runtime.multiplayer.authorityRejections = 1;
  rejectedAuthority.runtime.multiplayer.lastError = "stale-revision:state_exact_1";
  rejectedAuthority.runtime.multiplayer.lastRejection = {
    messageType: "player-state",
    commandId: "state_exact_1",
    code: "stale-revision",
    expected: {
      revision: { epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5 },
      stateHash: "6".repeat(32),
    },
    current: {
      revision: { epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 6 },
      stateHash: "7".repeat(32),
    },
  };
  const rejectedAssessment = assessRustMultiplayerVisualTerrainReadiness(rejectedAuthority);
  assert.equal(rejectedAssessment.terminal, true);
  assert.deepEqual(rejectedAssessment.authorityLastRejection, rejectedAuthority.runtime.multiplayer.lastRejection,
    "terminal readiness evidence must retain the exact expected/current native authority identities");

  let clock = 0;
  const snapshots = [
    missingOpaque,
    source,
    visualTerrainSnapshot("combined"),
    visualTerrainSnapshot("combined"),
    visualTerrainSnapshot("combined"),
  ];
  const evidence = await waitForRustMultiplayerVisualTerrainReadiness({}, 1_000, {
    label: "guest",
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readSnapshot: async () => snapshots.shift() ?? visualTerrainSnapshot("combined"),
    pollMilliseconds: 10,
    stablePolls: 3,
  });
  assert.equal(evidence.attempts, 5);
  assert.equal(evidence.stablePolls, 3);
  assert.equal(evidence.assessment.ready, true);
  assert.notEqual(sourceAssessment.fingerprint, evidence.assessment.fingerprint,
    "source-to-combined transitions must restart the stable-poll window");

  let terminalSleeps = 0;
  await assert.rejects(waitForRustMultiplayerVisualTerrainReadiness({}, 1_000, {
    now: () => 0,
    sleep: async () => { terminalSleeps += 1; },
    readSnapshot: async () => unhealthyWorker,
    failureStage: "terrain-readiness-reconnect-session",
  }), (error) => error.code === "BLOCKWILD_VISUAL_TERRAIN_FAILURE"
    && error.failureStage === "terrain-readiness-reconnect-session"
    && error.terrainReadinessEvidence.phase === "terrain-readiness-reconnect-session"
    && error.terrainReadinessEvidence.assessment.terminal === true);
  assert.equal(terminalSleeps, 0, "a worker failure must end the gate on its first observation");
});

test("post-movement evidence screenshots require stable host and guest visual terrain", () => {
  const source = readFileSync(new URL("../scripts/verify-rust-multiplayer-browser.mjs", import.meta.url), "utf8");
  const movementStart = source.indexOf("movement = await exerciseGuestMovement(");
  const readinessStart = source.indexOf('acceptanceStage = "terrain-readiness-post-movement";', movementStart);
  const screenshotStart = source.indexOf('const movementHostScreenshot = path.join(options.outputDirectory, "05-host-observed-guest-movement.png");', readinessStart);
  assert.ok(movementStart >= 0 && readinessStart > movementStart && screenshotStart > readinessStart,
    "post-movement terrain readiness must run after movement and before screenshots 05/06");
  const readiness = source.slice(readinessStart, screenshotStart);
  assert.equal((readiness.match(/waitForRustMultiplayerVisualTerrainReadiness\(/gu) ?? []).length, 2,
    "post-movement readiness must independently stabilize both browser views");
  assert.match(readiness, /terrainReadiness\.postMovement\.host = await waitForRustMultiplayerVisualTerrainReadiness\(\s*hostPage,/u);
  assert.match(readiness, /terrainReadiness\.postMovement\.guest = await waitForRustMultiplayerVisualTerrainReadiness\(\s*guestPage,/u);
  assert.match(readiness, /label: "host-post-movement"/u);
  assert.match(readiness, /label: "guest-post-movement"/u);
  assert.match(source, /postMovement: \{ host: null, guest: null \}/u,
    "result and failure evidence must retain the post-movement readiness phase");
});

test("guest disconnect snapshots retain bounded lifecycle, persistence, and exact-receipt evidence only", () => {
  const progression = {
    pending: { transferId: "transfer-7", revision: 7, transportComplete: true, privatePayload: "do-not-retain" },
    outgoingRequestChunks: 2,
    outgoingRequestTransfers: 1,
    confirmed: true,
    confirmedRevision: 6,
    localDirty: false,
    latestReceipt: {
      direction: "guest-to-host",
      peerId: "peer-guest",
      transferId: "transfer-6",
      status: "committed",
      committedRevision: 6,
      observedAt: 1234,
      connectionCurrent: true,
      privatePayload: "do-not-retain",
    },
    privateProgressionBody: { inventory: ["secret"] },
  };
  const snapshot = compactRustMultiplayerGuestDisconnectSnapshot({
    ui: {
      titleVisible: false,
      multiplayerHeading: "  Multiplayer   Session  ",
      multiplayerStatus: "CONNECTED",
      visibleErrors: Array.from({ length: 10 }, (_, index) => `error ${index}`),
    },
    state: { name: "paused", multiplayerRole: "guest", multiplayerRemotePlayers: 1, worldBody: "do-not-retain" },
    runtime: {
      ready: true,
      operationsBlocked: false,
      activeWorldId: "world-guest",
      nativePersistenceWorldId: null,
      hydration: "guest-bootstrap",
      privateWorldBody: { blocks: [1, 2, 3] },
      lastError: null,
      manager: {
        state: "ready",
        lastError: null,
        host: {
          state: "ready",
          lastError: null,
          adapter: { lastError: null },
          nativePersistence: {
            worldId: "must-not-be-duplicated",
            state: "open",
            saves: 3,
            recoveries: 1,
            platformOperations: 14,
            requestBytes: 999_999,
            lastCheckpointId: "checkpoint-3",
            lastError: { code: "durability", message: `  ${"failure ".repeat(100)}  `, privateDetails: "do-not-retain" },
          },
        },
      },
      playerAuthority: { lastError: null },
      multiplayer: {
        lastError: null,
        lastRejection: {
          messageType: "player-state",
          commandId: "command-7",
          code: "stale-revision",
          expected: {
            revision: { epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5, private: 6 },
            stateHash: "a".repeat(32),
            privatePayload: "do-not-retain",
          },
          current: {
            revision: { epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 6 },
            stateHash: "b".repeat(32),
          },
          privatePayload: "do-not-retain",
        },
        progression,
        lastGracefulProgressionDrain: {
          schema: 1,
          observedAt: 1400,
          exactReceiptCurrent: true,
          progression,
          privatePayload: "do-not-retain",
        },
        presentation: {
          guestQueued: 0,
          guestInFlight: 0,
          hostQueuedPeers: 0,
          hostPumpActive: false,
          authorityOperations: 0,
          privatePayload: "do-not-retain",
        },
        transport: { role: "guest", state: "connected", privatePayload: "do-not-retain" },
        privatePayload: "do-not-retain",
      },
    },
  });

  assert.equal(snapshot.ui.multiplayerHeading, "Multiplayer Session");
  assert.equal(snapshot.ui.visibleErrors.length, 8);
  assert.equal(snapshot.runtime.ready, true);
  assert.equal(snapshot.runtime.operationsBlocked, false);
  assert.equal(snapshot.runtime.activeWorldId, "world-guest");
  assert.equal(snapshot.runtime.nativePersistenceWorldId, null);
  assert.equal(snapshot.runtime.hydration, "guest-bootstrap");
  assert.equal(snapshot.runtime.managerState, "ready");
  assert.equal(snapshot.runtime.hostState, "ready");
  assert.deepEqual(snapshot.runtime.nativePersistence, {
    state: "open",
    saves: 3,
    recoveries: 1,
    platformOperations: 14,
    lastCheckpointId: "checkpoint-3",
    lastError: {
      code: "durability",
      message: snapshot.runtime.nativePersistence.lastError.message,
    },
  });
  assert.equal(snapshot.runtime.nativePersistence.lastError.message.length, 512);
  assert.equal("worldId" in snapshot.runtime.nativePersistence, false);
  assert.equal("requestBytes" in snapshot.runtime.nativePersistence, false);
  assert.equal(snapshot.runtime.multiplayerLastRejection.expected.revision.persistence, 5);
  assert.equal("private" in snapshot.runtime.multiplayerLastRejection.expected.revision, false);
  assert.equal(snapshot.runtime.multiplayerProgression.latestReceipt.connectionCurrent, true);
  assert.equal("privateProgressionBody" in snapshot.runtime.multiplayerProgression, false);
  assert.equal(snapshot.runtime.multiplayerLastGracefulProgressionDrain.exactReceiptCurrent, true);
  assert.equal(snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.confirmedRevision, 6);
  assert.deepEqual(snapshot.runtime.multiplayerPresentation, {
    guestQueued: 0,
    guestInFlight: 0,
    hostQueuedPeers: 0,
    hostPumpActive: false,
    authorityOperations: 0,
  });
  assert.deepEqual(snapshot.runtime.multiplayerTransport, { role: "guest", state: "connected" });
  assert.equal("privateWorldBody" in snapshot.runtime, false);
});

function exactGuestProgressionDrain(confirmedRevision = 12) {
  return {
    schema: 1,
    observedAt: 1400,
    exactReceiptCurrent: true,
    progression: {
      pending: null,
      outgoingRequestChunks: 0,
      outgoingRequestTransfers: 0,
      confirmed: true,
      confirmedRevision,
      localDirty: false,
      latestReceipt: {
        direction: "guest-observed",
        peerId: "peer-host",
        transferId: `transfer-${confirmedRevision}`,
        status: "accepted",
        committedRevision: confirmedRevision,
        observedAt: 1300,
        connectionCurrent: true,
      },
    },
  };
}

test("guest disconnect progression gate requires the exact accepted current receipt and an empty drain", () => {
  const validSnapshot = () => ({
    runtime: { multiplayerLastGracefulProgressionDrain: exactGuestProgressionDrain() },
  });
  const valid = validSnapshot();
  assert.equal(assertRustMultiplayerGuestDisconnectProgressionDrain(valid),
    valid.runtime.multiplayerLastGracefulProgressionDrain);

  const invalidCases = [
    ["retained drain schema is not 1", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.schema = 2; }],
    ["observation time is missing", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.observedAt = null; }],
    ["exactReceiptCurrent is not true", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.exactReceiptCurrent = false; }],
    ["transfer remains pending", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.pending = { transferId: "tail" }; }],
    ["request chunks remain", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.outgoingRequestChunks = 1; }],
    ["request transfers remain", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.outgoingRequestTransfers = 1; }],
    ["local progression is not clean", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.localDirty = true; }],
    ["progression is not confirmed", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.confirmed = false; }],
    ["confirmed progression revision is missing", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.confirmedRevision = null; }],
    ["latest progression receipt is missing", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.latestReceipt = null; }],
    ["receipt was not guest-observed", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.latestReceipt.direction = "host-issued"; }],
    ["receipt was not accepted", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.latestReceipt.status = "rejected"; }],
    ["receipt is not from the current connection", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.latestReceipt.connectionCurrent = false; }],
    ["receipt revision does not match", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.latestReceipt.committedRevision = 11; }],
    ["receipt transfer is missing", (snapshot) => { snapshot.runtime.multiplayerLastGracefulProgressionDrain.progression.latestReceipt.transferId = ""; }],
  ];
  for (const [message, mutate] of invalidCases) {
    const snapshot = validSnapshot();
    mutate(snapshot);
    assert.throws(() => assertRustMultiplayerGuestDisconnectProgressionDrain(snapshot),
      (error) => error.code === "BLOCKWILD_GUEST_DISCONNECT_DRAIN_INVALID" && error.message.includes(message),
      message);
  }
});

test("guest disconnect wait requires a stable title with no role and races visible or runtime errors", async () => {
  let clock = 0;
  const snapshot = (overrides = {}) => ({
    ui: { titleVisible: false, multiplayerHeading: "Multiplayer Session", multiplayerStatus: "CONNECTED", visibleErrors: [] },
    state: { name: "paused", multiplayerRole: "guest", multiplayerRemotePlayers: 1 },
    runtime: {
      lastError: null,
      managerLastError: null,
      hostLastError: null,
      adapterLastError: null,
      playerAuthorityLastError: null,
      multiplayerLastError: null,
      multiplayerTransport: { role: "guest", state: "connected" },
    },
    ...overrides,
  });
  const reads = [
    snapshot(),
    snapshot({
      ui: { titleVisible: true, multiplayerHeading: null, multiplayerStatus: null, visibleErrors: [] },
      state: { name: "title", multiplayerRole: null, multiplayerRemotePlayers: 0 },
    }),
    snapshot({
      ui: { titleVisible: true, multiplayerHeading: null, multiplayerStatus: null, visibleErrors: [] },
      state: { name: "title", multiplayerRole: null, multiplayerRemotePlayers: 0 },
      runtime: {
        lastError: null,
        managerLastError: null,
        hostLastError: null,
        adapterLastError: null,
        playerAuthorityLastError: null,
        multiplayerLastError: null,
        multiplayerLastGracefulProgressionDrain: exactGuestProgressionDrain(),
        multiplayerTransport: null,
      },
    }),
  ];
  const preDisconnectSnapshot = snapshot({
    runtime: {
      lastError: null,
      managerLastError: null,
      hostLastError: null,
      adapterLastError: null,
      playerAuthorityLastError: null,
      multiplayerLastError: null,
      multiplayerProgression: { confirmedRevision: 12 },
      multiplayerLastGracefulProgressionDrain: null,
      multiplayerTransport: { role: "guest", state: "connected" },
    },
  });
  const evidence = await waitForRustMultiplayerGuestDisconnect({}, 1_000, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readSnapshot: async () => reads.shift(),
    pollMilliseconds: 10,
    preDisconnectSnapshot,
  });
  assert.equal(evidence.attempts, 3);
  assert.equal(evidence.stableReads, 2);
  assert.equal(evidence.finalSnapshot.state.name, "title");
  assert.equal(evidence.finalSnapshot.state.multiplayerRole, null);
  assert.notEqual(evidence.preDisconnectSnapshot, preDisconnectSnapshot);
  assert.equal(evidence.preDisconnectSnapshot.runtime.multiplayerProgression.confirmedRevision, 12);
  assert.equal(evidence.progressionDrain.exactReceiptCurrent, true);
  assert.equal(evidence.progressionDrain.progression.latestReceipt.status, "accepted");

  let invalidDrainError = null;
  await assert.rejects(waitForRustMultiplayerGuestDisconnect({}, 1_000, {
    now: () => 0,
    sleep: async () => { throw new Error("a terminal invalid drain must not sleep"); },
    requiredStableReads: 1,
    preDisconnectSnapshot,
    readSnapshot: async () => snapshot({
      ui: { titleVisible: true, multiplayerHeading: null, multiplayerStatus: null, visibleErrors: [] },
      state: { name: "title", multiplayerRole: null, multiplayerRemotePlayers: 0 },
      runtime: {
        lastError: null,
        managerLastError: null,
        hostLastError: null,
        adapterLastError: null,
        playerAuthorityLastError: null,
        multiplayerLastError: null,
        multiplayerLastGracefulProgressionDrain: {
          ...exactGuestProgressionDrain(),
          exactReceiptCurrent: false,
        },
        multiplayerTransport: null,
      },
    }),
  }), (error) => {
    invalidDrainError = error;
    return error.code === "BLOCKWILD_GUEST_DISCONNECT_DRAIN_INVALID"
      && error.failureStage === "disconnect";
  });
  assert.equal(invalidDrainError.disconnectEvidence.progressionDrain.exactReceiptCurrent, false);
  assert.equal(invalidDrainError.disconnectEvidence.finalSnapshot.state.name, "title");
  assert.equal(invalidDrainError.disconnectEvidence.preDisconnectSnapshot.runtime.multiplayerProgression.confirmedRevision, 12);

  const source = readFileSync(path.join(ROOT, "scripts", "verify-rust-multiplayer-browser.mjs"), "utf8");
  const disconnectStart = source.indexOf("async function disconnectGuestThroughUi");
  const disconnectEnd = source.indexOf("function relativeEvidencePath", disconnectStart);
  const disconnectSource = source.slice(disconnectStart, disconnectEnd);
  assert.ok(disconnectSource.indexOf("const preDisconnectSnapshot = await readRustMultiplayerGuestDisconnectSnapshot(guestPage)")
    < disconnectSource.indexOf("Disconnect Session"), "the full bounded snapshot must be captured before the UI click");
  assert.match(disconnectSource,
    /waitForRustMultiplayerGuestDisconnect\(guestPage, timeoutMilliseconds, \{ preDisconnectSnapshot \}\)/u,
    "success and failure evidence must retain the pre-disconnect snapshot");

  let errorReads = 0;
  let errorSleeps = 0;
  await assert.rejects(waitForRustMultiplayerGuestDisconnect({}, 1_000, {
    now: () => 0,
    sleep: async () => { errorSleeps += 1; },
    readSnapshot: async () => {
      errorReads += 1;
      return snapshot({
        ui: {
          titleVisible: false,
          multiplayerHeading: "Multiplayer Session",
          multiplayerStatus: "CONNECTED",
          visibleErrors: ["Player progression is still synchronizing"],
        },
      });
    },
  }), (error) => error.code === "BLOCKWILD_GUEST_DISCONNECT_ERROR"
    && error.failureStage === "disconnect"
    && error.disconnectEvidence.errors[0] === "Player progression is still synchronizing");
  assert.equal(errorReads, 1, "a visible error must end the wait on its first observation");
  assert.equal(errorSleeps, 0, "a visible error must not consume another poll interval");

  let runtimeErrorReads = 0;
  let runtimeDisconnectError = null;
  await assert.rejects(waitForRustMultiplayerGuestDisconnect({}, 1_000, {
    now: () => 0,
    sleep: async () => { throw new Error("a runtime error must not sleep"); },
    preDisconnectSnapshot,
    readSnapshot: async () => {
      runtimeErrorReads += 1;
      return snapshot({
        runtime: {
          lastError: null,
          managerLastError: null,
          hostLastError: null,
          adapterLastError: null,
          playerAuthorityLastError: null,
          multiplayerLastError: "Rust disconnect receipt failed",
          multiplayerTransport: { role: "guest", state: "connected" },
        },
      });
    },
  }), (error) => {
    runtimeDisconnectError = error;
    return error.code === "BLOCKWILD_GUEST_DISCONNECT_ERROR"
      && error.disconnectEvidence.errors[0] === "Rust disconnect receipt failed";
  });
  assert.equal(runtimeErrorReads, 1, "a Rust runtime error must end the wait on its first observation");
  assert.equal(runtimeDisconnectError.disconnectEvidence.preDisconnectSnapshot.runtime.multiplayerProgression.confirmedRevision, 12,
    "failure evidence must retain the same pre-click lifecycle receipt as success evidence");

  let timeoutClock = 0;
  await assert.rejects(waitForRustMultiplayerGuestDisconnect({}, 20, {
    now: () => timeoutClock,
    sleep: async (milliseconds) => { timeoutClock += milliseconds; },
    readSnapshot: async () => snapshot(),
    pollMilliseconds: 10,
  }), (error) => error.code === "BLOCKWILD_GUEST_DISCONNECT_TIMEOUT"
    && error.failureStage === "disconnect"
    && error.disconnectEvidence.timeoutMilliseconds === 20
    && error.disconnectEvidence.finalSnapshot.state.multiplayerRole === "guest");
});

function hostPeerDrainSnapshot(overrides = {}) {
  const base = {
    ui: { peerListAvailable: false, peerCount: null, visibleErrors: [] },
    state: {
      name: "paused",
      multiplayerStatus: null,
      multiplayerRole: "host",
      multiplayerRemotePlayers: 0,
      multiplayerError: null,
    },
    runtime: {
      ready: true,
      operationsBlocked: false,
      managerState: "ready",
      hostState: "ready",
      lastError: null,
      managerLastError: null,
      hostLastError: null,
      adapterLastError: null,
      playerAuthorityLastError: null,
      multiplayerLastError: null,
      transport: {
        schema: 1,
        state: "hosting",
        role: "host",
        authorityMode: "rust-authoritative",
        authorityOperations: 0,
        peerCount: 0,
        peers: [],
      },
    },
  };
  return {
    ...base,
    ...overrides,
    ui: { ...base.ui, ...overrides.ui },
    state: { ...base.state, ...overrides.state },
    runtime: {
      ...base.runtime,
      ...overrides.runtime,
      transport: { ...base.runtime.transport, ...overrides.runtime?.transport },
    },
  };
}

test("host post-disconnect proof uses bounded authority state and never depends on a visible multiplayer panel", async () => {
  assert.equal(RUST_MULTIPLAYER_HOST_PEER_DRAIN_TIMEOUT_MS, 30_000);
  const clean = hostPeerDrainSnapshot();
  assert.equal(rustMultiplayerHostDisconnectDrained(clean), true);
  for (const mutate of [
    (value) => { value.state.multiplayerRole = "guest"; },
    (value) => { value.state.multiplayerRemotePlayers = 1; },
    (value) => { value.runtime.ready = false; },
    (value) => { value.runtime.operationsBlocked = true; },
    (value) => { value.runtime.transport.schema = 2; },
    (value) => { value.runtime.transport.role = "guest"; },
    (value) => { value.runtime.transport.state = "connected"; },
    (value) => { value.runtime.transport.authorityOperations = 1; },
    (value) => { value.runtime.transport.peerCount = 1; },
    (value) => { value.runtime.transport.peers.push({ peerId: "guest" }); },
    (value) => { value.ui.peerListAvailable = true; value.ui.peerCount = 1; },
  ]) {
    const changed = structuredClone(clean);
    mutate(changed);
    assert.equal(rustMultiplayerHostDisconnectDrained(changed), false);
  }

  const connectedPeer = hostPeerDrainSnapshot({
    state: { multiplayerRemotePlayers: 1 },
    runtime: {
      transport: {
        state: "connected",
        peerCount: 1,
        peers: [{ peerId: GUEST_ID, state: "connected", authorityQueued: 0, authorityInFlight: 0, authorityErrors: 0 }],
      },
    },
  });
  const staleUi = hostPeerDrainSnapshot({ ui: { peerListAvailable: true, peerCount: 1 } });
  const reads = [connectedPeer, staleUi, clean, clean];
  let clock = 0;
  const evidence = await waitForRustMultiplayerHostPeerDrain({}, 1_000, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readSnapshot: async () => reads.shift(),
    pollMilliseconds: 10,
  });
  assert.equal(evidence.attempts, 4);
  assert.equal(evidence.stableReads, 2);
  assert.equal(evidence.finalSnapshot.state.multiplayerRole, "host");
  assert.equal(evidence.finalSnapshot.runtime.transport.state, "hosting");
  assert.equal(evidence.finalSnapshot.runtime.transport.peerCount, 0);

  let hostError = null;
  await assert.rejects(waitForRustMultiplayerHostPeerDrain({}, 1_000, {
    now: () => 0,
    sleep: async () => { throw new Error("a host runtime error must not sleep"); },
    readSnapshot: async () => hostPeerDrainSnapshot({ runtime: { multiplayerLastError: "peer release failed" } }),
  }), (error) => {
    hostError = error;
    return error.code === "BLOCKWILD_HOST_DISCONNECT_ERROR" && error.failureStage === "disconnect";
  });
  assert.equal(hostError.hostDisconnectEvidence.errors[0], "peer release failed");

  let timeoutClock = 0;
  let timeoutError = null;
  await assert.rejects(waitForRustMultiplayerHostPeerDrain({}, 20, {
    now: () => timeoutClock,
    sleep: async (milliseconds) => { timeoutClock += milliseconds; },
    readSnapshot: async () => connectedPeer,
    pollMilliseconds: 10,
  }), (error) => {
    timeoutError = error;
    return error.code === "BLOCKWILD_HOST_DISCONNECT_TIMEOUT" && error.failureStage === "disconnect";
  });
  assert.equal(timeoutError.hostDisconnectEvidence.timeoutMilliseconds, 20);
  assert.equal(timeoutError.hostDisconnectEvidence.finalSnapshot.runtime.transport.peerCount, 1);

  const source = readFileSync(path.join(ROOT, "scripts", "verify-rust-multiplayer-browser.mjs"), "utf8");
  const disconnectStart = source.indexOf("async function disconnectGuestThroughUi");
  const disconnectEnd = source.indexOf("function relativeEvidencePath", disconnectStart);
  const disconnectSource = source.slice(disconnectStart, disconnectEnd);
  assert.doesNotMatch(disconnectSource, /ensureRustMultiplayerPanel\(hostPage/u,
    "host peer-drain proof must not require a visible multiplayer UI route");
  assert.match(disconnectSource,
    /Math\.min\(timeoutMilliseconds, RUST_MULTIPLAYER_HOST_PEER_DRAIN_TIMEOUT_MS\)/u,
    "host cleanup must use its dedicated short timeout instead of the full browser budget");
});

test("multiplayer panel routing preserves the in-world direct session route", async () => {
  assert.deepEqual(rustMultiplayerPanelRoute({ titleMultiplayerVisible: true }), { status: "ready", kind: "title" });
  assert.deepEqual(rustMultiplayerPanelRoute({ sessionMultiplayerVisible: true }, true), { status: "ready", kind: "session" });
  assert.deepEqual(rustMultiplayerPanelRoute({ stateName: "paused", menuOverlayVisible: false }),
    { status: "transition", action: "open-pause-menu" });
  assert.deepEqual(rustMultiplayerPanelRoute({ stateName: "paused", menuOverlayVisible: true }),
    { status: "pending", action: null }, "an unknown visible paused overlay must not be escaped ambiguously");
  assert.deepEqual(rustMultiplayerPanelRoute({ stateName: "paused", menuOverlayVisible: true, pauseVisible: true }),
    { status: "transition", action: "open-session-multiplayer" });
  assert.deepEqual(rustMultiplayerPanelRoute({ stateName: "paused", menuOverlayVisible: true, mapVisible: true }),
    { status: "transition", action: "close-map" });

  const surfaces = [
    { stateName: "title", titleMultiplayerVisible: true },
    { stateName: "title", titleMainVisible: true },
    { stateName: "paused", menuOverlayVisible: false },
    { stateName: "paused", pauseVisible: true },
    { stateName: "paused", sessionMultiplayerVisible: true },
  ];
  const actions = [];
  const panel = await ensureRustMultiplayerPanel({}, {
    requireDirectFallback: true,
    timeoutMilliseconds: 1_000,
    now: () => 0,
    sleep: async () => undefined,
    readSurface: async () => surfaces.shift(),
    performAction: async (action) => { actions.push(action); },
  });
  assert.equal(panel.kind, "session");
  assert.deepEqual(actions, [
    "leave-title-multiplayer",
    "continue-local-world",
    "open-pause-menu",
    "open-session-multiplayer",
  ]);
});

test("direct reconnect routes the guest from title main to the title JOIN OFFER without Continue", async () => {
  assert.deepEqual(rustMultiplayerPanelRoute({ titleMainVisible: true }, true, "title"),
    { status: "transition", action: "open-title-multiplayer" });
  assert.deepEqual(rustMultiplayerPanelRoute({ titleMultiplayerVisible: true }, true, "title"),
    { status: "ready", kind: "title" });
  assert.deepEqual(rustMultiplayerPanelRoute({ sessionMultiplayerVisible: true }, true, "title"),
    { status: "pending", action: null });

  const surfaces = [
    { stateName: "title", titleMainVisible: true },
    { stateName: "title", titleMultiplayerVisible: true },
  ];
  const actions = [];
  const panel = await ensureRustMultiplayerPanel({}, {
    requireDirectFallback: true,
    directPanelKind: "title",
    timeoutMilliseconds: 1_000,
    now: () => 0,
    sleep: async () => undefined,
    readSurface: async () => surfaces.shift(),
    performAction: async (action) => { actions.push(action); },
  });
  assert.equal(panel.kind, "title");
  assert.deepEqual(actions, ["open-title-multiplayer"]);
  assert.equal(actions.includes("continue-local-world"), false);

  const source = readFileSync(path.join(ROOT, "scripts", "verify-rust-multiplayer-browser.mjs"), "utf8");
  const diagnosticsStart = source.indexOf("async function readConnectionDiagnostics");
  const diagnosticsEnd = source.indexOf("async function manualDirectConnect", diagnosticsStart);
  const diagnosticsSource = source.slice(diagnosticsStart, diagnosticsEnd);
  assert.match(diagnosticsSource,
    /transportState:\s*runtime\?\.multiplayer\?\.transport\?\.state \?\? null/u,
    "connection diagnostics must report the actual Rust transport state");
  assert.doesNotMatch(diagnosticsSource, /runtime\?\.multiplayer\?\.state/u,
    "connection diagnostics must not read the nonexistent direct multiplayer state");
  const manualStart = source.indexOf("async function manualDirectConnect");
  const manualEnd = source.indexOf("function authorityPairRoleAssessment", manualStart);
  const manualSource = source.slice(manualStart, manualEnd);
  assert.match(manualSource, /requestedKind: reconnect \? "title" : "session"/u,
    "the real reconnect path must request the title panel only for the guest");
  assert.match(manualSource, /openDirectPanel\(hostPage[^\n]+requestedKind: "session"/u,
    "the real reconnect path must retain the host in-world session panel");
  assert.match(manualSource, /requireGameplayRuntimeConnected: reconnect/u,
    "the reconnect wait must require the title panel to close into exact gameplay/runtime state");
  assert.doesNotMatch(manualSource, /getByLabel\("(?:Host offer|Guest answer) code"\)\.inputValue/u,
    "conditionally rendered signal outputs must not be read before their generation action");
  assert.match(manualSource, /changedInputValue\(\s*guestPage,\s*'textarea\[aria-label="Guest answer code"\]'/u,
    "guest answer polling must use a stable selector without first resolving the conditional textarea");
});

test("conditional guest answer polling fails immediately with the visible multiplayer error", async () => {
  const signalingPayload = "signal-payload-must-not-appear-in-error-evidence";
  const outcomes = [
    { status: "pending" },
    { status: "failed", uiError: "Guest Rust runtime rejected the host descriptor." },
  ];
  let clock = 0;
  let reads = 0;
  await assert.rejects(
    changedInputValue(
      { isClosed: () => false },
      'textarea[aria-label="Guest answer code"]',
      signalingPayload,
      60_000,
      {
        label: "guest answer",
        now: () => clock,
        sleep: async (milliseconds) => { clock += milliseconds; },
        pollMilliseconds: 25,
        readOutcome: async () => outcomes[reads++],
      },
    ),
    (error) => {
      assert.equal(error.code, "BLOCKWILD_MULTIPLAYER_SIGNAL_UI_ERROR");
      assert.equal(error.failureReason, "visible-multiplayer-error");
      assert.equal(error.failureStage, "signaling");
      assert.match(error.message, /Guest Rust runtime rejected the host descriptor\./u);
      assert.equal(clock, 25, "the visible error should win without consuming the 60-second timeout");
      assert.equal(reads, 2);
      assert.equal(JSON.stringify({
        message: error.message,
        evidence: error.signalOutputEvidence,
      }).includes(signalingPayload), false, "error output must not expose signaling payloads");
      return true;
    },
  );
});

test("conditional signal polling reports page closure without waiting for the output locator", async () => {
  await assert.rejects(
    changedInputValue(
      { isClosed: () => true },
      'textarea[aria-label="Guest answer code"]',
      "",
      60_000,
      { label: "guest answer" },
    ),
    (error) => {
      assert.equal(error.code, "BLOCKWILD_MULTIPLAYER_SIGNAL_PAGE_CLOSED");
      assert.equal(error.failureReason, "page-closed");
      assert.equal(error.failureStage, "signaling");
      return true;
    },
  );
});

test("guest connection readiness accepts a closed title panel only after exact gameplay/runtime connection", () => {
  const expected = {
    role: "guest",
    peerId: HOST_ID,
    sessionId: "session_acceptance_001",
    requireGameplayRuntimeConnected: true,
  };
  const surface = {
    panelVisible: false,
    panelStatus: null,
    panelPeerCount: 0,
    state: { name: "playing", multiplayerRole: "guest", multiplayerStatus: "connected" },
    runtime: {
      ready: true,
      operationsBlocked: false,
      activeSessionId: "session_acceptance_001",
      hydration: "guest-bootstrap",
      managerState: "ready",
      hostState: "ready",
      transitionGeneration: 5,
      managerRequestedGeneration: 4,
      managerActiveGeneration: 4,
      playerAuthorityState: "ready",
      playerAuthorityGeneration: 5,
      playerAuthorityEntityId: "4294967298",
      playerAuthorityTerrainChunkCount: 25,
      playerAuthorityLastError: null,
      playerAuthorityPumpState: "ready",
      playerAuthorityPumpGeneration: 5,
      playerAuthorityPumpLastError: null,
      transportRole: "guest",
      transportState: "connected",
      transportPeerCount: 1,
      transportPeerIds: [HOST_ID],
    },
  };
  assert.deepEqual(assessRustMultiplayerConnectedSurface(surface, expected), {
    status: "ready",
    kind: "gameplay-runtime-connected",
    panelReady: false,
    gameplayRuntimeReady: true,
  });
  assert.deepEqual(assessRustMultiplayerConnectedSurface(surface, {
    ...expected,
    requireGameplayRuntimeConnected: false,
  }), {
    status: "pending",
    kind: null,
    panelReady: false,
    gameplayRuntimeReady: true,
  });
  assert.equal(assessRustMultiplayerConnectedSurface(surface, {
    ...expected,
    requireR5PlayerAuthority: true,
  }).status, "ready");
  const independentlyAdvancedManager = structuredClone(surface);
  independentlyAdvancedManager.runtime.managerRequestedGeneration = 2;
  independentlyAdvancedManager.runtime.managerActiveGeneration = 2;
  assert.equal(assessRustMultiplayerConnectedSurface(independentlyAdvancedManager, {
    ...expected,
    requireR5PlayerAuthority: true,
  }).status, "ready", "manager and engine generations are exact only within their independent lifecycle domains");
  for (const mutate of [
    (value) => { value.runtime.managerActiveGeneration = 3; },
    (value) => { value.runtime.managerRequestedGeneration = 5; },
    (value) => { value.runtime.playerAuthorityState = "blocked"; },
    (value) => { value.runtime.playerAuthorityGeneration = 4; },
    (value) => { value.runtime.playerAuthorityTerrainChunkCount = 0; },
    (value) => { value.runtime.playerAuthorityPumpState = "blocked"; },
    (value) => { value.runtime.playerAuthorityPumpGeneration = 4; },
    (value) => { value.runtime.playerAuthorityPumpLastError = "pump-failure"; },
  ]) {
    const changed = structuredClone(surface);
    mutate(changed);
    assert.equal(assessRustMultiplayerConnectedSurface(changed, {
      ...expected,
      requireR5PlayerAuthority: true,
    }).status, "pending");
  }
  for (const mutate of [
    (value) => { value.state.name = "title"; },
    (value) => { value.state.multiplayerRole = "host"; },
    (value) => { value.state.multiplayerStatus = null; },
    (value) => { value.runtime.ready = false; },
    (value) => { value.runtime.operationsBlocked = true; },
    (value) => { value.runtime.activeSessionId = "wrong-session"; },
    (value) => { value.runtime.hydration = "restored"; },
    (value) => { value.runtime.managerState = "blocked"; },
    (value) => { value.runtime.hostState = "blocked"; },
    (value) => { value.runtime.transportRole = "host"; },
    (value) => { value.runtime.transportState = "connecting"; },
    (value) => { value.runtime.transportPeerCount = 0; },
    (value) => { value.runtime.transportPeerIds = ["wrong-peer"]; },
    (value) => { value.panelVisible = true; value.panelStatus = "CONNECTED"; value.panelPeerCount = 1; },
  ]) {
    const changed = structuredClone(surface);
    mutate(changed);
    assert.equal(assessRustMultiplayerConnectedSurface(changed, expected).status, "pending");
  }
  assert.equal(assessRustMultiplayerConnectedSurface({
    ...surface,
    panelVisible: true,
    panelStatus: "CONNECTED",
    panelPeerCount: 1,
  }, { ...expected, requireGameplayRuntimeConnected: false }).kind, "panel-connected");
});

test("guest local catalog identity remains exact across initial session teardown and title return", () => {
  const generationIdentity = {
    schemaVersion: 1,
    terrainContentHash: "1".repeat(32),
    generatorHash: "2".repeat(32),
    generationOptionsJson: JSON.stringify({ settlementDensity: 0 }),
  };
  const metadata = {
    id: "world-guest-local",
    ownership: "host-device",
    name: "Rust Multiplayer Guest Local",
    seed: "RUST-RTC-GUEST-LOCAL",
    mode: "builder",
    generationIdentity,
  };
  const snapshot = {
    catalog: {
      version: 1,
      ownership: "host-device",
      activeWorldId: "world-guest-local",
      worldCount: 1,
      matchingWorldIds: ["world-guest-local"],
    },
    catalogEntry: metadata,
    document: {
      key: "blockwild-world-data-v1:world-guest-local",
      present: true,
      version: 1,
      metadata,
      save: { seed: "RUST-RTC-GUEST-LOCAL", mode: "builder", generatorVersion: 15, generatorProfile: "world-below-v15" },
    },
  };
  assert.equal(assertRustMultiplayerLocalWorldCatalogInvariant({ before: snapshot, after: structuredClone(snapshot) }), true);
  for (const mutate of [
    (value) => { value.after.catalogEntry.seed = WORLD_SEED; },
    (value) => { value.after.document.metadata.generationIdentity.generatorHash = "3".repeat(32); },
    (value) => { value.after.document.save.seed = WORLD_SEED; },
    (value) => { value.after.catalog.matchingWorldIds.push("duplicate-world"); },
  ]) {
    const changed = { before: structuredClone(snapshot), after: structuredClone(snapshot) };
    mutate(changed);
    assert.throws(() => assertRustMultiplayerLocalWorldCatalogInvariant(changed));
  }

  const source = readFileSync(path.join(ROOT, "scripts", "verify-rust-multiplayer-browser.mjs"), "utf8");
  const runStart = source.indexOf("export async function runRustMultiplayerBrowser");
  const runSource = source.slice(runStart);
  const beforeCapture = runSource.indexOf("status: \"pending-title-return\"");
  const initialJoin = runSource.indexOf("initialConnection = await manualDirectConnect");
  const initialDisconnect = runSource.indexOf("disconnect = await disconnectGuestThroughUi");
  const afterCapture = runSource.indexOf("const guestLocalCatalogAfterTitleReturn");
  const reconnectJoin = runSource.indexOf("reconnectConnection = await manualDirectConnect");
  assert.ok(beforeCapture >= 0 && beforeCapture < initialJoin,
    "catalog identity must be captured before the initial host join");
  assert.ok(initialDisconnect >= 0 && initialDisconnect < afterCapture && afterCapture < reconnectJoin,
    "catalog identity must be rechecked after title return and before title reconnect");
});

test("closing the map waits only for the map to disappear before panel routing continues", async () => {
  const calls = [];
  const page = {
    keyboard: {
      press: async (key) => { calls.push(["press", key]); },
    },
    getByRole: (role, options) => {
      calls.push(["locator", role, options]);
      return {
        waitFor: async (waitOptions) => { calls.push(["waitFor", waitOptions]); },
      };
    },
  };

  await performRustMultiplayerPanelAction(page, "close-map", 12_345);

  assert.deepEqual(calls, [
    ["press", "Escape"],
    ["locator", "heading", { name: "Known Roads", exact: true }],
    ["waitFor", { state: "hidden", timeout: 12_345 }],
  ]);
});

test("continue-local-world keeps the successful playing transition and polls only until it is observed", async () => {
  const calls = [];
  const page = {
    getByRole: (role, options) => {
      calls.push(["locator", role, options]);
      return {
        click: async (clickOptions) => { calls.push(["click", clickOptions]); },
      };
    },
  };
  let clock = 0;
  const outcomes = [
    {
      stateName: "title",
      titleVisible: true,
      visibleAlerts: [],
      stateError: null,
      runtime: { managerState: "starting", managerLastError: null },
    },
    {
      stateName: "playing",
      titleVisible: false,
      visibleAlerts: [],
      stateError: null,
      runtime: { ready: true, managerState: "ready", managerLastError: null },
    },
  ];

  await performRustMultiplayerPanelAction(page, "continue-local-world", 900_000, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readContinueOutcome: async () => outcomes.shift(),
    pollMilliseconds: 25,
  });

  assert.equal(clock, 25);
  assert.deepEqual(calls, [
    ["locator", "button", { name: /^Continue\b/u }],
    ["click", { noWaitAfter: true }],
  ]);
});

test("continue-local-world fails promptly with exact visible and manager bootstrap errors", async () => {
  const runtimeError = "runtime-create-v1 worker request failed: request 1 exceeded 5000 ms";
  const page = {
    getByRole: () => ({ click: async () => undefined }),
  };
  let clock = 0;
  let observedError = null;
  const outcomes = [
    {
      stateName: "title",
      titleVisible: true,
      visibleAlerts: [],
      stateError: null,
      runtime: { managerState: "starting", managerLastError: null },
    },
    {
      stateName: "title",
      titleVisible: true,
      visibleAlerts: [`Could not load world. ${runtimeError}`],
      stateError: null,
      runtime: { managerState: "stopped", managerLastError: runtimeError },
    },
  ];

  await assert.rejects(performRustMultiplayerPanelAction(page, "continue-local-world", 900_000, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readContinueOutcome: async () => outcomes.shift(),
    pollMilliseconds: 25,
  }), (error) => {
    observedError = error;
    return error.code === "BLOCKWILD_MULTIPLAYER_CONTINUE_BOOTSTRAP_ERROR"
      && error.failureReason === "continue-runtime-bootstrap-error";
  });

  assert.equal(clock, 25, "the visible runtime failure must not consume the remaining gate budget");
  assert.equal(observedError.panelAction, "continue-local-world");
  assert.equal(observedError.panelRoutingEvidence.requestedTimeoutMilliseconds, 900_000);
  assert.equal(observedError.panelRoutingEvidence.timeoutMilliseconds, RUST_MULTIPLAYER_CONTINUE_ROUTE_TIMEOUT_MS);
  assert.deepEqual(observedError.panelRoutingEvidence.errors, [
    { source: "visible-alert", message: `Could not load world. ${runtimeError}` },
    { source: "runtime.manager.lastError", message: runtimeError },
  ]);
  assert.match(observedError.message, new RegExp(runtimeError.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.deepEqual(classifyRustMultiplayerFailure(observedError, "signaling-reconnect", { initial: true }), {
    family: "signaling",
    stage: "signaling-reconnect",
    code: "BLOCKWILD_MULTIPLAYER_CONTINUE_BOOTSTRAP_ERROR",
    reason: "continue-runtime-bootstrap-error",
    signalingStarted: true,
    initialSignalCompleted: true,
    reconnectSignalCompleted: false,
  });
});

test("continue-local-world preserves a realistic bounded route budget independently of a larger global budget", async () => {
  const page = {
    getByRole: () => ({ click: async () => undefined }),
  };
  let clock = 0;
  const pending = {
    stateName: "title",
    titleVisible: true,
    visibleAlerts: [],
    stateError: null,
    runtime: { managerState: "starting", managerLastError: null },
  };
  let observedError = null;

  await assert.rejects(performRustMultiplayerPanelAction(page, "continue-local-world", 900_000, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readContinueOutcome: async () => pending,
    pollMilliseconds: RUST_MULTIPLAYER_CONTINUE_ROUTE_TIMEOUT_MS,
  }), (error) => {
    observedError = error;
    return error.code === "BLOCKWILD_MULTIPLAYER_CONTINUE_TIMEOUT"
      && error.failureReason === "continue-runtime-bootstrap-timeout";
  });

  assert.equal(clock, RUST_MULTIPLAYER_CONTINUE_ROUTE_TIMEOUT_MS);
  assert.equal(observedError.panelRoutingEvidence.requestedTimeoutMilliseconds, 900_000);
  assert.equal(observedError.panelRoutingEvidence.timeoutMilliseconds, RUST_MULTIPLAYER_CONTINUE_ROUTE_TIMEOUT_MS);
  assert.equal(observedError.panelRoutingEvidence.attempts, 2);
});

test("every managed Vite startup failure path closes its exact server, proves port refusal, and restores environment", async () => {
  const server = { exact: "owned" };
  const attempt = {
    server,
    port: 51_739,
    serverClosed: false,
    portRefused: false,
    environmentRestored: false,
  };
  const calls = [];
  assert.equal(await cleanupRustMultiplayerViteStartupAttempt(attempt, () => {
    calls.push("environment");
    return true;
  }, {
    closeServer: async (value) => { assert.equal(value, server); calls.push("server"); return true; },
    waitForPortRefusal: async (port) => { assert.equal(port, 51_739); calls.push("port"); return true; },
  }), true);
  assert.deepEqual(calls, ["server", "port", "environment"]);
  assert.deepEqual({
    serverClosed: attempt.serverClosed,
    portRefused: attempt.portRefused,
    environmentRestored: attempt.environmentRestored,
  }, { serverClosed: true, portRefused: true, environmentRestored: true });

  const failedAttempt = { ...attempt, serverClosed: false };
  await assert.rejects(cleanupRustMultiplayerViteStartupAttempt(failedAttempt, () => true, {
    closeServer: async () => { throw new Error("close failed"); },
    waitForPortRefusal: async () => true,
  }), /startup cleanup was incomplete.*close failed/u);
});

test("both browser contexts require a non-configurable exact Worker certificate bound to the candidate", () => {
  const snapshot = generationAuditSnapshot();
  const evidence = assertRustMultiplayerGenerationAudit(snapshot, REQUIRED_MULTIPLAYER_ARTIFACT_HASH, "host");
  assert.equal(evidence.artifactHash, REQUIRED_MULTIPLAYER_ARTIFACT_HASH);
  assert.equal(evidence.workerCount, 2);
  assert.deepEqual(evidence.propertyDescriptor, { configurable: false, writable: false, enumerable: false });
  assert.deepEqual(evidence.certificate, generationCertificate());
  assert.equal(evidence.canceledBeforeReadyCount, 0);
  const mutations = [
    (value) => { value.generationAuditDescriptor.configurable = true; },
    (value) => { value.generationAudit.schema = 0; },
    (value) => { value.generationAudit.workerInstrumentation = false; },
    (value) => { value.generationAudit.dataChannelSendInstrumentation = false; },
    (value) => { value.generationAudit.workerStillInstalled = false; },
    (value) => { value.generationAudit.generationReadyMessages = []; },
    (value) => { value.generationAudit.generationReadyMessages[0].certificate.generatorVersion = 17; },
    (value) => { value.generationAudit.generationReadyMessages[0].certificate.generatorHash = "f".repeat(32); },
    (value) => { value.generationAudit.generationReadyMessages[0].certificate.contentHash = "e".repeat(32); },
    (value) => { value.generationAudit.generationReadyMessages[0].certificate.corpusCases = 154; },
    (value) => { value.generationAudit.generationReadyMessages[0].certificate.extra = true; },
    (value) => { value.generationAudit.generationReadyMessages.pop(); },
    (value) => { value.state.performance.streaming.generationWorker.workers = 3; value.state.performance.streaming.generationWorker.ready = 3; },
    (value) => { value.runtime.manager.host.artifactHash = "f".repeat(64); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.throws(() => assertRustMultiplayerGenerationAudit(changed, REQUIRED_MULTIPLAYER_ARTIFACT_HASH, "mutated"));
  }

  const resetDuringStartup = generationAuditSnapshot();
  resetDuringStartup.generationAudit.generationWorkerCreations.unshift({
    ordinal: 3,
    url: "http://127.0.0.1/app/game/terrain-generation-worker.ts?worker=reset",
    type: "module",
    name: null,
  });
  resetDuringStartup.generationAudit.generationWorkerTerminations.push({
    ordinal: 3,
    ready: false,
    postedMessages: 0,
  });
  const resetEvidence = assertRustMultiplayerGenerationAudit(
    resetDuringStartup,
    REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
    "reset-during-startup",
  );
  assert.equal(resetEvidence.workerCount, 2);
  assert.equal(resetEvidence.canceledBeforeReadyCount, 1);
  resetDuringStartup.generationAudit.generationWorkerTerminations[0].postedMessages = 1;
  assert.throws(() => assertRustMultiplayerGenerationAudit(
    resetDuringStartup,
    REQUIRED_MULTIPLAYER_ARTIFACT_HASH,
    "used-uncertified-worker",
  ), /uncertified Worker/iu);
});

test("manual offer and answer summaries prove exact identities, Rust descriptor, handshake packets, and local ICE", () => {
  const offerCode = manualSignal("offer", HOST_ID);
  const answerCode = manualSignal("answer", GUEST_ID);
  const decoded = decodeRustMultiplayerManualSignal(offerCode);
  assert.equal(decoded.identity.id, HOST_ID);
  const offer = summarizeRustMultiplayerManualSignal(offerCode);
  const answer = summarizeRustMultiplayerManualSignal(answerCode);
  const pair = assertRustMultiplayerSignalPair(offer, answer, { hostId: HOST_ID, guestId: GUEST_ID, worldSeed: WORLD_SEED });
  assert.equal(pair.sessionId, "session_acceptance_001");
  assert.equal(pair.contentHash, CONTENT_HASH);
  assert.deepEqual(offer.sdp.candidateTypes, ["host"]);
  assert.ok(offer.authority.bytes > 0);
  assert.equal(Object.hasOwn(offer, "code"), false, "evidence must not retain ephemeral SDP envelopes");

  const productionAddress = {
    ...runtimeDescriptor(),
    universeId: "world:11f0d960-456b-4fd5-839a-235e4bd438fd",
    locationId: "overworld",
  };
  assert.equal(decodeRustMultiplayerManualSignal(manualSignal("offer", HOST_ID, { runtime: productionAddress })).runtime.universeId,
    productionAddress.universeId);
  for (const runtime of [
    { ...productionAddress, universeId: "" },
    { ...productionAddress, universeId: "é".repeat(33) },
    { ...productionAddress, locationId: "a".repeat(129) },
    { ...productionAddress, locationId: "bad\ud800text" },
  ]) assert.throws(() => decodeRustMultiplayerManualSignal(manualSignal("offer", HOST_ID, { runtime })), /universe\/location identity is invalid/u);

  const relayOffer = manualSignal("offer", HOST_ID, {
    description: { type: "offer", sdp: "v=0\r\na=candidate:1 1 UDP 1 203.0.113.1 5000 typ srflx\r\n" },
  });
  assert.throws(() => summarizeRustMultiplayerManualSignal(relayOffer), /non-local ICE candidate/u);
  const missingAuthority = manualSignal("offer", HOST_ID, { authority: undefined });
  assert.throws(() => summarizeRustMultiplayerManualSignal(missingAuthority), /authority packet is absent/u);
  const changed = structuredClone(answer);
  changed.runtime = { ...changed.runtime, contentHash: "f".repeat(32) };
  assert.throws(() => assertRustMultiplayerSignalPair(offer, changed), /different Rust runtime descriptors/u);
});

test("runtime pair requires exact content-addressed Rust authority and current bounded producer claim", () => {
  const signalPair = {
    sessionId: "session_acceptance_001",
    contentHash: CONTENT_HASH,
    runtime: runtimeDescriptor(),
  };
  const proof = assertRustMultiplayerRuntimePair(runtime("host"), runtime("guest"), signalPair, {
    minimumHostSequence: 1,
    minimumGuestApplied: 1,
    universeId: "universe_acceptance_001",
    locationId: "location_acceptance_001",
  });
  assert.equal(proof.host.artifactHash, REQUIRED_MULTIPLAYER_ARTIFACT_HASH);
  assert.equal(proof.guest.multiplayer.lastStateHash, "5".repeat(32));

  const mismatched = structuredClone(runtime("guest"));
  mismatched.manager.host.contentHash = "f".repeat(32);
  assert.throws(() => assertRustMultiplayerRuntimePair(runtime("host"), mismatched, signalPair), /content hash differs/u);
  const rejected = structuredClone(runtime("guest"));
  rejected.multiplayer.authorityRejections = 1;
  assert.throws(() => assertRustMultiplayerRuntimePair(runtime("host"), rejected, signalPair), /authority rejection/u);
  const inflatedClaim = structuredClone(runtime("host"));
  inflatedClaim.multiplayer.recordProducer = "native";
  assert.throws(() => assertRustMultiplayerRuntimePair(inflatedClaim, runtime("guest"), signalPair), /bounded current multiplayer producer claim/u);

  const errored = runtime("guest");
  errored.manager.host.adapter.lastError = "authority command failed";
  errored.multiplayer.authorityResyncs = 1;
  assert.deepEqual(collectRustMultiplayerRuntimeErrors(null, errored), [
    "runtime.manager.host.adapter.lastError: authority command failed",
    "Rust multiplayer authority resyncs: 1",
  ]);
});

test("authority-pair wait proves a fresh connection-local keyframe and retains bounded poll evidence", async () => {
  const pair = {
    sessionId: "session_acceptance_001",
    contentHash: CONTENT_HASH,
    hostId: HOST_ID,
    guestId: GUEST_ID,
    runtime: runtimeDescriptor(),
  };
  const pendingHost = authorityPairSnapshot("host", { hostSequence: 0 });
  const pendingGuest = authorityPairSnapshot("guest", {
    guestApplied: 0,
    keyframeAccepted: false,
    presentationReady: false,
    acceptedDeltaCount: 0,
  });
  const bootstrappingGuest = structuredClone(pendingGuest);
  bootstrappingGuest.runtime.ready = false;
  bootstrappingGuest.runtime.operationsBlocked = true;
  assert.equal(assessRustMultiplayerAuthorityPair(pendingHost, bootstrappingGuest, pair, { host: 1, guest: 1 }).status, "pending",
    "an exact manager-ready guest-bootstrap block is expected until the first host keyframe installs R5");
  const readyHost = authorityPairSnapshot("host", { hostSequence: 1 });
  const readyGuest = authorityPairSnapshot("guest", { guestApplied: 1 });
  const reads = { host: [pendingHost, readyHost], guest: [bootstrappingGuest, readyGuest] };
  let clock = 0;
  const evidence = await waitForAuthorityPair({ label: "host" }, { label: "guest" }, pair, { host: 1, guest: 1 }, 1_000, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readSnapshot: async (_page, label) => reads[label].shift(),
    readDiagnostics: async (_page, label) => ({ label }),
    pollMilliseconds: 10,
  });
  assert.equal(evidence.authorityWait.attempts, 2);
  assert.equal(evidence.authorityWait.assessment.status, "ready");
  assert.equal(evidence.authorityWait.assessment.observed.hostSequence, 1);
  assert.equal(evidence.authorityWait.assessment.observed.guestApplied, 1);
  assert.equal(evidence.authorityWait.assessment.observed.guestKeyframeAccepted, true);
});

test("authority-pair wait fails immediately on runtime desync or role and transport loss", async () => {
  const pair = {
    sessionId: "session_acceptance_001",
    contentHash: CONTENT_HASH,
    hostId: HOST_ID,
    guestId: GUEST_ID,
    runtime: runtimeDescriptor(),
  };
  const failures = [
    {
      pattern: /sequence-gap/u,
      mutate: (snapshot) => { snapshot.runtime.multiplayer.lastError = "sequence-gap"; },
    },
    {
      pattern: /guest-state-role:missing|guest-transport-state:disconnected/u,
      mutate: (snapshot) => {
        snapshot.state.multiplayer.role = null;
        snapshot.runtime.multiplayer.transport.state = "disconnected";
      },
    },
    {
      pattern: /adapter\.lastError: native receiver failed/u,
      mutate: (snapshot) => { snapshot.runtime.manager.host.adapter.lastError = "native receiver failed"; },
    },
    {
      pattern: /guest-runtime-not-ready/u,
      mutate: (snapshot) => {
        snapshot.runtime.ready = false;
        snapshot.runtime.operationsBlocked = true;
        snapshot.runtime.hydration = "blocked";
      },
    },
  ];
  for (const failure of failures) {
    const host = authorityPairSnapshot("host");
    const guest = authorityPairSnapshot("guest");
    failure.mutate(guest);
    let slept = false;
    await assert.rejects(waitForAuthorityPair({ label: "host" }, { label: "guest" }, pair, { host: 1, guest: 1 }, 300_000, {
      now: () => 0,
      sleep: async () => { slept = true; },
      readSnapshot: async (_page, label) => label === "host" ? host : guest,
      readDiagnostics: async (_page, label) => ({ label }),
    }), (error) => error.code === "BLOCKWILD_AUTHORITY_PAIR_TERMINAL"
      && error.authorityDiagnostics.assessment.terminalReasons.some((reason) => failure.pattern.test(reason)));
    assert.equal(slept, false, "terminal authority evidence must not enter the long poll sleep");
  }
});

test("movement failure diagnostics retain bounded pose and authority evidence", () => {
  const snapshot = generationAuditSnapshot();
  snapshot.state.state = "playing";
  snapshot.state.player = { position: [1, 2, 3] };
  snapshot.state.multiplayer = {
    remotePlayers: Array.from({ length: 20 }, (_, sequence) => ({
      id: `remote_${sequence}`,
      name: `Remote ${sequence}`,
      position: [sequence, 2, 3],
      tick: sequence,
      ageMilliseconds: sequence * 10,
      nativePoseCustody: {
        connectionGeneration: 1,
        commandSequence: sequence,
        recordRevision: sequence + 1,
        receiptHash: "a".repeat(32),
        recordHash: "b".repeat(32),
      },
    })),
  };
  snapshot.runtime.playerAuthority = { state: "ready", advanceInFlight: false, lastError: null };
  snapshot.runtime.ready = true;
  snapshot.runtime.operationsBlocked = false;
  snapshot.runtime.transitionGeneration = 2;
  snapshot.runtime.activeSessionId = "session.fixture";
  snapshot.runtime.hydration = "guest-bootstrap";
  snapshot.runtime.manager = { state: "ready", host: { state: "ready" } };
  snapshot.runtime.playerAuthority = {
    state: "ready",
    worldGeneration: 2,
    runtimeSessionId: "runtime.fixture",
    advanceInFlight: false,
    lastError: null,
    pump: {
      state: "ready",
      worldGeneration: 2,
      lastAuthorityTick: 7,
      lastNetworkRevision: 11,
      networkIdentityAdoptions: 3,
      nextInputSequence: 8,
      inFlight: false,
      queuedAdvances: 0,
      nativeInputPending: false,
      pendingInputSequence: null,
      lastAppliedButtons: 0,
      lastError: null,
    },
  };
  snapshot.generationAudit.outboundPlayerPoses = Array.from({ length: 20 }, (_, sequence) => ({
    sequence,
    authoritySequence: sequence,
    from: GUEST_ID,
    playerId: GUEST_ID,
    position: [sequence, 2, 3],
  }));
  const diagnostics = compactRustMultiplayerMovementDiagnostics(snapshot);
  assert.equal(diagnostics.gameState, "playing");
  assert.deepEqual(diagnostics.playerPosition, [1, 2, 3]);
  assert.equal(diagnostics.playerAuthority.state, "ready");
  assert.equal(diagnostics.runtime.operationsBlocked, false);
  assert.equal(diagnostics.runtime.hydration, "guest-bootstrap");
  assert.equal(diagnostics.runtime.managerState, "ready");
  assert.equal(diagnostics.runtime.hostState, "ready");
  assert.equal(diagnostics.playerAuthority.runtimeSessionId, "runtime.fixture");
  assert.equal(diagnostics.playerAuthority.pump.lastAuthorityTick, 7);
  assert.equal(diagnostics.playerAuthority.pump.lastNetworkRevision, 11);
  assert.equal(diagnostics.playerAuthority.pump.networkIdentityAdoptions, 3);
  assert.equal(Object.isFrozen(diagnostics.playerAuthority.pump), true);
  assert.equal(diagnostics.remotePlayers.length, 16);
  assert.equal(diagnostics.remotePlayers[0].id, "remote_0");
  assert.equal(diagnostics.remotePlayers.at(-1).id, "remote_15");
  assert.equal(diagnostics.outboundPlayerPoses.length, 16);
  assert.equal(diagnostics.outboundPlayerPoses[0].authoritySequence, 4);
  assert.equal(diagnostics.outboundPlayerPoses.at(-1).authoritySequence, 19);
  assert.equal(Object.isFrozen(diagnostics), true);
  assert.equal(Object.isFrozen(diagnostics.remotePlayers), true);
  assert.equal(Object.isFrozen(diagnostics.remotePlayers[0]), true);
  assert.equal(Object.isFrozen(diagnostics.remotePlayers[0].nativePoseCustody), true);
  assert.equal(diagnostics.remotePlayers[0].nativePoseCustody.receiptHash, "a".repeat(32));
  assert.equal(Object.isFrozen(diagnostics.outboundPlayerPoses), true);
});

test("movement map-pin wait requires the exact singleton pin to converge on the final guest position", () => {
  const priorLabel = "Rust Guest at 4, 0";
  const expected = [6.4, 43.5, -1.6];
  assert.equal(rustMultiplayerMapPinConverged([
    { name: "Rust Guest", x: 6, z: -2, label: "Rust Guest at 6, -2" },
  ], priorLabel, expected), true);
  assert.equal(rustMultiplayerMapPinConverged([
    { name: "Rust Guest", x: 4, z: 0, label: priorLabel },
  ], priorLabel, expected), false, "a merely present pre-input pin must not satisfy convergence");
  assert.equal(rustMultiplayerMapPinConverged([
    { name: "Rust Guest", x: 9, z: -2, label: "Rust Guest at 9, -2" },
  ], priorLabel, expected), false, "a changed but still stale pin must not end the wait early");
  assert.equal(rustMultiplayerMapPinConverged([], priorLabel, expected), false);
  assert.equal(rustMultiplayerMapPinConverged([
    { name: "Rust Guest", x: 6, z: -2, label: "Rust Guest at 6, -2" },
    { name: "Duplicate", x: 6, z: -2, label: "Duplicate at 6, -2" },
  ], priorLabel, expected), false);
});

test("movement endpoint and map-pin polls retry deterministically and retain terminal evidence", async () => {
  let clock = 0;
  const start = [4, 43.5, 0];
  const pose = (position, authoritySequence) => ({
    authoritySequence,
    from: GUEST_ID,
    playerId: GUEST_ID,
    position,
  });
  const snapshots = [
    { state: { player: { position: [5.2, 43.5, 0] } }, generationAudit: { outboundPlayerPoses: [pose([5.0, 43.5, 0], 42)] } },
    { state: { player: { position: [6.1, 43.5, 0] } }, generationAudit: { outboundPlayerPoses: [pose([6.0, 43.5, 0], 43)] } },
    { state: { player: { position: [6.1, 43.5, 0] } }, generationAudit: { outboundPlayerPoses: [pose([6.1, 43.5, 0], 44)] } },
    { state: { player: { position: [6.1, 43.5, 0] } }, generationAudit: { outboundPlayerPoses: [pose([6.1, 43.5, 0], 44)] } },
  ];
  const endpoint = await waitForRustMultiplayerMovementEndpoint({}, start, 41, 1_000, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readSnapshot: async () => snapshots.shift() ?? snapshots.at(-1),
    pollMilliseconds: 10,
  });
  assert.deepEqual(endpoint.position, [6.1, 43.5, 0]);
  assert.equal(endpoint.authorityPose.authoritySequence, 44);

  const pinReads = [
    [{ name: "Rust Guest", x: 4, z: 0, label: "Rust Guest at 4, 0" }],
    [{ name: "Rust Guest", x: 9, z: 0, label: "Rust Guest at 9, 0" }],
    [{ name: "Rust Guest", x: 6, z: 0, label: "Rust Guest at 6, 0" }],
  ];
  const pins = await waitForRustMultiplayerMapPinConvergence({}, "Rust Guest at 4, 0", endpoint.position, 1_000, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readPins: async () => pinReads.shift() ?? [],
    pollMilliseconds: 10,
  });
  assert.equal(pins[0].label, "Rust Guest at 6, 0");

  let timeoutClock = 0;
  await assert.rejects(waitForRustMultiplayerMapPinConvergence({}, "Rust Guest at 4, 0", endpoint.position, 20, {
    now: () => timeoutClock,
    sleep: async (milliseconds) => { timeoutClock += milliseconds; },
    readPins: async () => [{ name: "Rust Guest", x: 9, z: 0, label: "Rust Guest at 9, 0" }],
    pollMilliseconds: 10,
  }), (error) => error.mapPinEvidence?.finalPins?.[0]?.x === 9);

  await assert.rejects(waitForRustMultiplayerMapPinConvergence({}, "Rust Guest at 4, 0", endpoint.position, 20, {
    now: () => 0,
    sleep: async () => undefined,
    readPins: async () => { throw new Error("malformed pin label"); },
  }), (error) => error.mapPinEvidence?.readError === "malformed pin label");
});

test("native pose convergence waits for the host Rust queue to reach the captured guest endpoint", async () => {
  let clock = 0;
  const reads = [];
  const hostPage = { label: "host" };
  const guestPage = { label: "guest" };
  const endpoint = [10.674063, 42.896667, 0];
  const lagging = nativePoseConvergenceSnapshots(39, [9.397408, 43.503333, 0]);
  const converged = nativePoseConvergenceSnapshots(41, endpoint, {
    authorityQueued: 44,
    authorityAccepted: 42,
    authorityInFlight: 1,
  });
  const guestAudit = {
    ...converged.guest,
    generationAudit: {
      ...converged.guest.generationAudit,
      outboundPlayerPoses: [lagging.pose, converged.pose],
    },
  };
  const hostReads = [lagging.host, converged.host, converged.host];
  const result = await waitForRustMultiplayerNativePoseConvergence(
    hostPage,
    guestPage,
    endpoint,
    41,
    1_000,
    {
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      readSnapshot: async (page) => {
        reads.push(page.label);
        return page === hostPage ? (hostReads.shift() ?? converged.host) : guestAudit;
      },
      pollMilliseconds: 10,
      priorNativePoseCustody: {
        connectionGeneration: 1,
        commandSequence: 32,
        recordRevision: 12,
        receiptHash: "1".repeat(32),
        recordHash: "2".repeat(32),
      },
    },
  );
  assert.deepEqual(reads, ["host", "guest", "host", "guest", "host", "guest"]);
  assert.equal(result.nativePoseCustody.commandSequence, 41);
  assert.equal(result.nativeAuthorityPose.authoritySequence, 41);
  assert.deepEqual(result.remotePlayer.position, endpoint);
  assert.equal(result.hostTransport.peer.authorityInFlight, 1,
    "a clean in-flight stationary heartbeat must not block endpoint proof");
  assert.equal(result.hostTransport.peer.authorityQueued > result.hostTransport.peer.authorityAccepted, true,
    "the convergence oracle must not require global queue drain");
  assert.equal(result.stableIntervals, 2);
});

test("native pose convergence timeout retains the last lagging custody and endpoint evidence", async () => {
  let clock = 0;
  const endpoint = [10.674063, 42.896667, 0];
  const lagging = nativePoseConvergenceSnapshots(39, [9.397408, 43.503333, 0]);
  await assert.rejects(waitForRustMultiplayerNativePoseConvergence(
    { label: "host" },
    { label: "guest" },
    endpoint,
    41,
    20,
    {
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      readSnapshot: async (page) => page.label === "host" ? lagging.host : lagging.guest,
      pollMilliseconds: 10,
    },
  ), (error) => {
    assert.equal(error.nativePoseConvergenceEvidence?.minimumAuthoritySequence, 41);
    assert.deepEqual(error.nativePoseConvergenceEvidence?.expectedPosition, endpoint);
    assert.equal(error.nativePoseConvergenceEvidence?.nativePoseCustody?.commandSequence, 39);
    assert.equal(error.nativePoseConvergenceEvidence?.endpointDistance > 1, true);
    return true;
  });
});

test("native pose convergence rejects missing or duplicate guest audit envelopes", async () => {
  const endpoint = [10.674063, 42.896667, 0];
  for (const outboundPlayerPoses of [[], null]) {
    let clock = 0;
    const fixture = nativePoseConvergenceSnapshots(41, endpoint);
    fixture.guest.generationAudit.outboundPlayerPoses = outboundPlayerPoses ?? [fixture.pose, { ...fixture.pose }];
    await assert.rejects(waitForRustMultiplayerNativePoseConvergence(
      { label: "host" },
      { label: "guest" },
      endpoint,
      41,
      10,
      {
        now: () => clock,
        sleep: async (milliseconds) => { clock += milliseconds; },
        readSnapshot: async (page) => page.label === "host" ? fixture.host : fixture.guest,
        pollMilliseconds: 5,
        requiredStableIntervals: 1,
      },
    ), (error) => {
      assert.equal(error.nativePoseConvergenceEvidence?.nativeAuthorityPoseCount,
        outboundPlayerPoses === null ? 2 : 0);
      return true;
    });
  }
});

test("native pose convergence fails promptly on dirty transport custody counters", async () => {
  const endpoint = [10.674063, 42.896667, 0];
  for (const dirty of [
    { authorityRejected: 1 },
    { authorityErrors: 1 },
    { protocolStrikes: 1 },
    { nativePoseStaleGenerationDrops: 1 },
  ]) {
    const fixture = nativePoseConvergenceSnapshots(41, endpoint, dirty);
    await assert.rejects(waitForRustMultiplayerNativePoseConvergence(
      { label: "host" },
      { label: "guest" },
      endpoint,
      41,
      1_000,
      {
        readSnapshot: async (page) => page.label === "host" ? fixture.host : fixture.guest,
        requiredStableIntervals: 1,
      },
    ), (error) => Array.isArray(error.nativePoseConvergenceEvidence?.terminalReasons)
      && error.nativePoseConvergenceEvidence.terminalReasons.length >= 1);
  }
});

test("movement workflow keeps R5 native sampling selector-bound and proves custody before the coarser map pin", () => {
  const source = readFileSync(path.join(ROOT, "scripts", "verify-rust-multiplayer-browser.mjs"), "utf8");
  const nativePulseStart = source.indexOf("async function pulseGuestRustLiveMovement(");
  const legacyPulseStart = source.indexOf("async function pulseGuestLegacyMovement(", nativePulseStart);
  const reconnectStart = source.indexOf("async function waitForReconnectDenseCommandStream(", legacyPulseStart);
  const movementStart = source.indexOf("async function exerciseGuestMovement(");
  const movementEnd = source.indexOf("function compactRustMultiplayerDisconnectText(", movementStart);
  const endpointStart = source.indexOf("endpoint = await waitForRustMultiplayerMovementEndpoint(", movementStart);
  const nativeStart = source.indexOf("nativeConvergence = await waitForRustMultiplayerNativePoseConvergence(", endpointStart);
  const mapPinStart = source.indexOf("movedPins = await waitForRustMultiplayerMapPinConvergence(", nativeStart);
  const proofStart = source.indexOf("assertRustMultiplayerMovementProof(proof);", mapPinStart);
  assert.equal(nativePulseStart >= 0 && legacyPulseStart > nativePulseStart && reconnectStart > legacyPulseStart, true);
  const nativePulseSource = source.slice(nativePulseStart, legacyPulseStart);
  const legacyPulseSource = source.slice(legacyPulseStart, reconnectStart);
  const movementSource = source.slice(movementStart, movementEnd);
  assert.match(nativePulseSource, /window\.pulse_game_key\("KeyD", frames\)/u);
  assert.doesNotMatch(legacyPulseSource, /pulse_game_key/u);
  assert.match(legacyPulseSource, /window\.set_game_key\("KeyD", true\)/u);
  assert.match(legacyPulseSource, /window\.requestAnimationFrame/u);
  assert.match(legacyPulseSource, /finally \{\s*window\.set_game_key\("KeyD", false\)/u);
  assert.match(movementSource, /requireR5PlayerAuthority\s*\? await pulseGuestRustLiveMovement[\s\S]*: await pulseGuestLegacyMovement/u);
  assert.equal(movementStart >= 0, true);
  assert.equal(endpointStart > movementStart, true);
  assert.equal(nativeStart > endpointStart, true);
  assert.equal(mapPinStart > nativeStart, true);
  assert.equal(proofStart > mapPinStart, true);
});

test("legacy and R5 movement proofs keep distinct bounded sampling and native-custody evidence", () => {
  const proof = {
    schema: 1,
    command: {
      kind: "virtual-key",
      key: "KeyD",
      down: true,
      released: true,
      clock: "browser-request-animation-frame",
      sampling: "request-animation-frame-bounded-typescript-key-hold",
      framesPerPulse: 16,
      maximumPulses: 16,
      pulses: [{
        index: 1,
        schema: 1,
        key: "KeyD",
        frameCount: 16,
        completedFrames: 16,
        elapsedMilliseconds: 250,
        released: true,
      }],
      chunkSize: 16,
      startChunkX: 0,
      endChunkX: 1,
      crossedChunkBoundary: true,
      authoritySequenceBefore: 41,
      authorityPose: {
        sequence: 90,
        authoritySequence: 45,
        sentAt: 12_345,
        from: GUEST_ID,
        playerId: GUEST_ID,
        tick: 300,
        position: [18, 43.5, 0],
        yaw: 0,
        pitch: 0,
      },
    },
    receipt: {
      kind: "rust-native-guest-pose-projection",
      guestId: GUEST_ID,
      priorNativeProjection: {
        connectionGeneration: 2,
        commandSequence: 40,
        recordRevision: 7,
        receiptHash: "1".repeat(32),
        recordHash: "2".repeat(32),
      },
      nativeProjection: {
        connectionGeneration: 2,
        commandSequence: 45,
        recordRevision: 9,
        receiptHash: "3".repeat(32),
        recordHash: "4".repeat(32),
      },
      remotePlayer: {
        id: GUEST_ID,
        name: "Rust Guest",
        position: [18, 43.5, 0],
        tick: 300,
        ageMilliseconds: 5,
        nativePoseCustody: {
          connectionGeneration: 2,
          commandSequence: 45,
          recordRevision: 9,
          receiptHash: "3".repeat(32),
          recordHash: "4".repeat(32),
        },
      },
      transportPeer: {
        peerId: GUEST_ID,
        state: "connected",
        authorityGeneration: 2,
        nativePoseAccepted: 9,
        nativePoseDelivered: 9,
        nativePoseStaleGenerationDrops: 0,
        lastNativePoseCommandSequence: 45,
        lastNativePoseRecordRevision: 9,
        lastNativePoseReceiptHash: "3".repeat(32),
        lastNativePoseRecordHash: "4".repeat(32),
        authorityRejected: 0,
        authorityErrors: 0,
        protocolStrikes: 0,
      },
      guestStart: [4, 43.5, 0],
      guestEnd: [18, 43.5, 0],
      guestDistance: 14,
      hostPinDisplacement: 14,
      hostPinConvergence: 0,
      hostPinCountBefore: 1,
      hostPinCountAfter: 1,
    },
    delta: {
      before: { host: deltaSnapshot(3, 0), guest: deltaSnapshot(0, 3, "8".repeat(32)) },
      after: { host: deltaSnapshot(4, 0), guest: deltaSnapshot(0, 4, "9".repeat(32)) },
      capturedAfterInputRelease: true,
    },
    attribution: {
      level: "typescript-legacy-player-simulation-with-native-guest-pose-custody-plus-post-input-keyframe",
      poseCustody: "rust-native",
      playerMovementSimulation: "typescript",
      playerAuthoritySelector: null,
      worldKeyframeProducer: "coarse-legacy-projection",
    },
    r5PlayerAuthority: null,
  };
  assert.doesNotThrow(() => assertRustMultiplayerMovementProof(proof));
  const combined = structuredClone(proof);
  const r5Pair = assertRustMultiplayerR5PlayerAuthorityPair(
    withR5PlayerAuthority(authorityPairSnapshot("host"), "host", [18, 43.5, 0]),
    withR5PlayerAuthority(authorityPairSnapshot("guest"), "guest", [18, 43.5, 0]),
    "combined movement",
  );
  const r5Guest = withR5PlayerAuthority(authorityPairSnapshot("guest"), "guest", [18, 43.5, 0]);
  const nativeFrame = (sequence, moveX, elapsedMilliseconds = 2.5) => ({
    sequence,
    moveX,
    moveZ: 0,
    buttons: 0,
    attempts: 1,
    elapsedMilliseconds,
  });
  combined.command = {
    ...combined.command,
    clock: "native-monotonic-live",
    sampling: "engine-serialized-native-frames-immediate-release",
    framesPerPulse: 8,
    pulses: [{
      index: 1,
      schema: 1,
      key: "KeyD",
      frameCount: 8,
      inputSequenceBefore: 42,
      frames: Array.from({ length: 8 }, (_, index) => nativeFrame(42 + index, 32_767)),
      release: nativeFrame(50, 0),
    }, {
      index: 2,
      schema: 1,
      key: "KeyD",
      frameCount: 8,
      inputSequenceBefore: 53,
      frames: Array.from({ length: 8 }, (_, index) => nativeFrame(53 + index, 32_767)),
      release: nativeFrame(61, 0),
    }],
  };
  combined.command.pulses[0].frames[7].attempts = 32;
  combined.command.pulses[0].frames[7].elapsedMilliseconds = 10_000;
  combined.command.pulses[1].release.attempts = 32;
  combined.command.pulses[1].release.elapsedMilliseconds = 10_000;
  combined.attribution = {
    level: "rust-r5-native-player-simulation-with-native-guest-pose-custody-plus-post-input-keyframe",
    poseCustody: "rust-native",
    playerMovementSimulation: "rust-r5-native-authority",
    playerAuthoritySelector: "experimental.rust-live-player-authority=r5",
    worldKeyframeProducer: "coarse-legacy-projection",
  };
  combined.r5PlayerAuthority = {
    initial: r5Pair,
    postInput: r5Pair,
    postInputGuestOutboundPose: assertRustMultiplayerR5OutboundPoseDiagnostics(r5Guest, {
      playerId: GUEST_ID,
      transportTick: 300,
      position: [18, 43.5, 0],
    }, "combined movement guest"),
  };
  assert.doesNotThrow(() => assertRustMultiplayerMovementProof(combined));
  for (const mutate of [
    (value) => { value.command.key = "KeyW"; },
    (value) => { value.command.endChunkX = 2; },
    (value) => { value.command.authorityPose.authoritySequence = value.command.authoritySequenceBefore; },
    (value) => { value.command.authorityPose.from = HOST_ID; },
    (value) => { value.receipt.guestDistance = 1; },
    (value) => { value.receipt.hostPinDisplacement = 0; },
    (value) => { value.receipt.nativeProjection.receiptHash = null; },
    (value) => { value.receipt.nativeProjection.commandSequence = 46; },
    (value) => { value.receipt.priorNativeProjection.recordRevision = 9; },
    (value) => { value.receipt.remotePlayer.nativePoseCustody.recordHash = "5".repeat(32); },
    (value) => { value.receipt.remotePlayer.tick = 301; },
    (value) => { value.receipt.transportPeer.lastNativePoseCommandSequence = 44; },
    (value) => { value.receipt.transportPeer.nativePoseStaleGenerationDrops = 1; },
    (value) => { value.delta.after.host.runtime.multiplayer.authorityDeltaSequence = 3; },
    (value) => { value.delta.after.guest.runtime.multiplayer.authorityDeltaApplied = 3; },
    (value) => { value.delta.after.guest.runtime.multiplayer.lastStateHash = "8".repeat(32); },
    (value) => { value.delta.after.guest.runtime.multiplayer.recordProducer = "native"; },
  ]) {
    const changed = structuredClone(proof);
    mutate(changed);
    assert.throws(() => assertRustMultiplayerMovementProof(changed));
  }
  for (const mutate of [
    (value) => { value.command.clock = "native-monotonic-live"; },
    (value) => { value.command.sampling = "engine-serialized-native-frames-immediate-release"; },
    (value) => { value.command.framesPerPulse = 8; },
    (value) => { value.command.pulses[0].completedFrames = 15; },
    (value) => { value.command.pulses[0].elapsedMilliseconds = 10_001; },
    (value) => { value.command.pulses[0].released = false; },
    (value) => { value.command.pulses[0].inputSequenceBefore = 42; },
    (value) => { value.command.pulses[0].frames = []; },
    (value) => { value.command.pulses[0].appliedSequences = [42]; },
    (value) => { value.r5PlayerAuthority = {}; },
    (value) => { value.attribution.playerMovementSimulation = "rust-r5-native-authority"; },
    (value) => { value.attribution.playerAuthoritySelector = RUST_MULTIPLAYER_R5_PLAYER_AUTHORITY_SELECTOR.claim; },
  ]) {
    const changed = structuredClone(proof);
    mutate(changed);
    assert.throws(() => assertRustMultiplayerMovementProof(changed));
  }
  for (const mutate of [
    (value) => { value.attribution.playerAuthoritySelector = null; },
    (value) => { value.r5PlayerAuthority.postInput.guest.pump.state = "blocked"; },
    (value) => { value.r5PlayerAuthority.postInputGuestOutboundPose.producer = "typescript-compatibility"; },
    (value) => { value.r5PlayerAuthority.postInputGuestOutboundPose.position[0] += 1; },
    (value) => { value.r5PlayerAuthority.postInputGuestOutboundPose.nativeSource.authorityTick = "41"; },
    (value) => { value.command.clock = "browser-request-animation-frame"; },
    (value) => { value.command.sampling = "request-animation-frame-bounded-typescript-key-hold"; },
    (value) => { value.command.pulses[0].appliedSequences = [42]; },
    (value) => { value.command.pulses[0].frames[3].sequence = 99; },
    (value) => { value.command.pulses[0].frames[3].moveX = 32_766; },
    (value) => { value.command.pulses[0].frames[3].moveZ = 1; },
    (value) => { value.command.pulses[0].frames[3].buttons = 1; },
    (value) => { value.command.pulses[0].frames[3].attempts = 0; },
    (value) => { value.command.pulses[0].frames[3].attempts = 33; },
    (value) => { value.command.pulses[0].frames[3].elapsedMilliseconds = 10_001; },
    (value) => { value.command.pulses[0].frames[3].unexpected = true; },
    (value) => { value.command.pulses[0].release.sequence = 51; },
    (value) => { value.command.pulses[0].release.moveX = 1; },
    (value) => { value.command.pulses[0].release.buttons = 1; },
    (value) => { value.command.pulses[0].release.attempts = 0; },
    (value) => { value.command.pulses[0].release.elapsedMilliseconds = 10_001; },
    (value) => { value.command.pulses[1].inputSequenceBefore = 50; },
  ]) {
    const changed = structuredClone(combined);
    mutate(changed);
    assert.throws(() => assertRustMultiplayerMovementProof(changed));
  }
});

function reconnectCommandEvidence(role, peerId, overrides = {}) {
  return {
    transportState: "connected",
    transportRole: role,
    authorityMode: "rust-authoritative",
    authorityOperations: 0,
    outboundAuthorityCommandSequence: role === "guest" ? 45 : 0,
    guestPresentationReady: role === "guest" ? true : null,
    peer: {
      peerId,
      state: "connected",
      authorityQueued: 0,
      authorityInFlight: 0,
      authorityAccepted: 0,
      authorityRejected: 0,
      authorityErrors: 0,
      protocolStrikes: 0,
      lastInboundType: null,
      lastInboundAuthoritySequence: null,
    },
    ...overrides,
  };
}

function reconnectCommandContinuity() {
  const initialHostObserved = reconnectCommandEvidence("host", GUEST_ID, {
    outboundAuthorityCommandSequence: 0,
    finalAcceptedAuthoritySequence: 44,
    peer: {
      ...reconnectCommandEvidence("host", GUEST_ID).peer,
      authorityQueued: 45,
      authorityAccepted: 45,
      lastInboundType: "player-pose",
      lastInboundAuthoritySequence: 44,
    },
  });
  const reconnectHostObserved = reconnectCommandEvidence("host", GUEST_ID, {
    peer: {
      ...reconnectCommandEvidence("host", GUEST_ID).peer,
      authorityQueued: 4,
      authorityAccepted: 4,
      lastInboundType: "player-pose",
      lastInboundAuthoritySequence: 48,
    },
  });
  const outbound = (type, authoritySequence) => ({
    type,
    sequence: authoritySequence + 100,
    authoritySequence,
    from: GUEST_ID,
    transportRole: "guest",
    guestPresentationReady: true,
  });
  return {
    schema: 1,
    initialHostObserved,
    initialCommandBoundary: {
      auditCount: 47,
      lastAuthoritySequence: 46,
      tail: [
        outbound("player-pose", 43),
        outbound("player-pose", 44),
        outbound("player-progress", 45),
        outbound("player-progress", 46),
      ],
    },
    reconnectCursor: 47,
    commands: [
      outbound("player-state", 47),
      outbound("player-progress", 48),
      outbound("player-pose", 49),
      outbound("player-pose", 50),
    ],
    poseAuthoritySequences: [49, 50],
    reconnectHostObserved,
    guestFinalAuthorityCommandSequence: 51,
  };
}

function reconnectPanelRoutingEvidence() {
  return {
    mode: "title-guest-reconnect",
    continueLocalWorldUsed: false,
    host: {
      requestedKind: "session",
      resolvedKind: "session",
      actions: ["close-map", "open-pause-menu", "open-session-multiplayer"],
      observedTitleMain: false,
      observedTitleMultiplayer: false,
      observedSessionMultiplayer: true,
      joinOfferVisible: true,
    },
    guest: {
      requestedKind: "title",
      resolvedKind: "title",
      actions: ["open-title-multiplayer"],
      observedTitleMain: true,
      observedTitleMultiplayer: true,
      observedSessionMultiplayer: false,
      joinOfferVisible: true,
    },
    connected: {
      host: { kind: "panel-connected" },
      guest: {
        kind: "gameplay-runtime-connected",
        surface: { panelVisible: false, runtime: { hydration: "guest-bootstrap" } },
      },
    },
  };
}

test("reconnect command continuity permits legitimate commands while retaining two dense accepted poses", () => {
  const continuity = reconnectCommandContinuity();
  assert.equal(assertRustMultiplayerReconnectCommandContinuity(continuity), true);
  for (const mutate of [
    (value) => { value.schema = 2; },
    (value) => { value.initialHostObserved.finalAcceptedAuthoritySequence = null; },
    (value) => { value.initialHostObserved.peer.authorityAccepted = 44; },
    (value) => { value.initialHostObserved.peer.authorityRejected = 1; },
    (value) => { value.initialCommandBoundary.auditCount = 0; },
    (value) => { value.initialCommandBoundary.lastAuthoritySequence = 43; },
    (value) => { value.initialCommandBoundary.tail[1].authoritySequence = 45; },
    (value) => { value.initialCommandBoundary.tail[2].from = HOST_ID; },
    (value) => { value.initialCommandBoundary.tail[2].guestPresentationReady = false; },
    (value) => { value.reconnectCursor = 46; },
    (value) => { value.commands[0].authoritySequence = 46; },
    (value) => { value.commands[1].authoritySequence = 49; },
    (value) => { value.commands[2].from = HOST_ID; },
    (value) => { value.commands[2].transportRole = "host"; },
    (value) => { value.commands[2].guestPresentationReady = false; },
    (value) => { value.commands[2].type = ""; },
    (value) => { value.commands.pop(); },
    (value) => { value.poseAuthoritySequences = [49, 51]; },
    (value) => { value.reconnectHostObserved.authorityOperations = 1; },
    (value) => { value.reconnectHostObserved.peer.authorityQueued = 3; },
    (value) => { value.reconnectHostObserved.peer.authorityAccepted = 3; },
    (value) => { value.reconnectHostObserved.peer.authorityInFlight = 1; },
    (value) => { value.reconnectHostObserved.peer.authorityRejected = 1; },
    (value) => { value.reconnectHostObserved.peer.authorityErrors = 1; },
    (value) => { value.reconnectHostObserved.peer.protocolStrikes = 1; },
    (value) => { value.guestFinalAuthorityCommandSequence = 50; },
  ]) {
    const changed = structuredClone(continuity);
    mutate(changed);
    assert.throws(() => assertRustMultiplayerReconnectCommandContinuity(changed));
  }
});

test("authority command evidence compacts the exact transport peer and stable cursor", () => {
  const snapshot = {
    runtime: {
      multiplayer: {
        transport: {
          state: "connected",
          role: "guest",
          authorityMode: "rust-authoritative",
          authorityOperations: 0,
          outbound: { authorityCommandSequence: 45 },
          guest: { presentationReady: true },
          peers: [
            { peerId: "unrelated", authorityAccepted: 99 },
            {
              peerId: HOST_ID,
              state: "connected",
              authorityQueued: 2,
              authorityInFlight: 0,
              authorityAccepted: 2,
              authorityRejected: 0,
              authorityErrors: 0,
              protocolStrikes: 0,
              authorityGeneration: 3,
              nativePoseAccepted: 8,
              nativePoseDelivered: 8,
              nativePoseStaleGenerationDrops: 0,
              lastNativePoseCommandSequence: 44,
              lastNativePoseRecordRevision: 8,
              lastNativePoseReceiptHash: "a".repeat(32),
              lastNativePoseRecordHash: "b".repeat(32),
              lastInboundType: "rust-authority-delta",
              lastInboundAuthoritySequence: null,
            },
          ],
        },
      },
    },
  };
  const evidence = compactRustMultiplayerAuthorityCommandEvidence(snapshot, HOST_ID);
  assert.equal(evidence.outboundAuthorityCommandSequence, 45);
  assert.equal(evidence.guestPresentationReady, true);
  assert.equal(evidence.peer.peerId, HOST_ID);
  assert.equal(evidence.peer.authorityAccepted, 2);
  assert.equal(evidence.peer.authorityGeneration, 3);
  assert.equal(evidence.peer.nativePoseAccepted, 8);
  assert.equal(evidence.peer.nativePoseDelivered, 8);
  assert.equal(evidence.peer.nativePoseStaleGenerationDrops, 0);
  assert.equal(evidence.peer.lastNativePoseCommandSequence, 44);
  assert.equal(evidence.peer.lastNativePoseRecordRevision, 8);
  assert.equal(evidence.peer.lastNativePoseReceiptHash, "a".repeat(32));
  assert.equal(evidence.peer.lastNativePoseRecordHash, "b".repeat(32));
  assert.equal(evidence.peer.lastInboundAuthoritySequence, null);
});

test("reconnect proof requires stable identity/session/world, connection-local deltas, and stable command continuity", () => {
  const initial = {
    signals: { sessionId: "session_acceptance_001", token: "invite_initial_001", hostId: HOST_ID, guestId: GUEST_ID, contentHash: CONTENT_HASH },
    world: { seed: WORLD_SEED, mode: "builder", player: { health: 20, hunger: 20 } },
    hostAuthoritySequence: 29,
    guestAuthorityApplied: 23,
  };
  const reconnected = {
    signals: { sessionId: "session_acceptance_001", token: "invite_reconnect_002", hostId: HOST_ID, guestId: GUEST_ID, contentHash: CONTENT_HASH },
    world: { seed: WORLD_SEED, mode: "builder", player: { health: 20, hunger: 20 } },
    hostPeerCount: 1,
    hostMapPins: 1,
    hostAuthoritySequence: 1,
    guestAuthorityApplied: 1,
    guestKeyframeAccepted: true,
    guestPresentationReady: true,
    guestAcceptedDeltaCount: 1,
    guestAuthorityStateHash: "5".repeat(32),
    panelRouting: reconnectPanelRoutingEvidence(),
    commandContinuity: reconnectCommandContinuity(),
  };
  assert.equal(assertRustMultiplayerReconnectProof(initial, reconnected), true);
  for (const mutate of [
    (value) => { value.signals.hostId = "browser_other.character_host"; },
    (value) => { value.signals.guestId = "browser_other.character_other"; },
    (value) => { value.signals.token = initial.signals.token; },
    (value) => { value.hostPeerCount = 2; },
    (value) => { value.hostAuthoritySequence = 0; },
    (value) => { value.guestAuthorityApplied = 0; },
    (value) => { value.guestKeyframeAccepted = false; },
    (value) => { value.guestPresentationReady = false; },
    (value) => { value.guestAcceptedDeltaCount = 0; },
    (value) => { value.guestAuthorityStateHash = "not-a-hash"; },
    (value) => { value.panelRouting.continueLocalWorldUsed = true; },
    (value) => { value.panelRouting.guest.actions = ["continue-local-world"]; },
    (value) => { value.panelRouting.connected.guest.surface.runtime.hydration = "restored"; },
    (value) => { value.commandContinuity.reconnectCursor = 44; },
    (value) => { value.world.player.health = 19; },
  ]) {
    const changed = structuredClone(reconnected);
    mutate(changed);
    assert.throws(() => assertRustMultiplayerReconnectProof(initial, changed));
  }
});

test("reconnect panel proof binds the host session panel to a title-only guest bootstrap", () => {
  const evidence = reconnectPanelRoutingEvidence();
  assert.equal(assertRustMultiplayerReconnectPanelRouting(evidence), true);
  for (const mutate of [
    (value) => { value.mode = "in-world-initial"; },
    (value) => { value.host.resolvedKind = "title"; },
    (value) => { value.guest.observedTitleMain = false; },
    (value) => { value.guest.observedTitleMultiplayer = false; },
    (value) => { value.guest.joinOfferVisible = false; },
    (value) => { value.guest.actions.push("leave-title-multiplayer"); },
    (value) => { value.connected.guest.kind = "panel-connected"; },
  ]) {
    const changed = structuredClone(evidence);
    mutate(changed);
    assert.throws(() => assertRustMultiplayerReconnectPanelRouting(changed));
  }
});

test("state transfer requires a distinct guest origin and the exact host seed, mode, and weather", () => {
  const host = { seed: WORLD_SEED, mode: "builder", weather: "clear" };
  const guest = { seed: WORLD_SEED, mode: "builder", weather: "clear" };
  const local = { seed: "RUST-RTC-GUEST-LOCAL", mode: "builder", weather: "rain" };
  assert.equal(assertRustMultiplayerStateTransfer(host, guest, local), true);
  for (const mutate of [
    (value) => { value.guest.seed = "wrong"; },
    (value) => { value.guest.mode = "survival"; },
    (value) => { value.guest.weather = "rain"; },
    (value) => { value.local.seed = WORLD_SEED; },
  ]) {
    const changed = structuredClone({ host, guest, local });
    mutate(changed);
    assert.throws(() => assertRustMultiplayerStateTransfer(changed.host, changed.guest, changed.local));
  }
});

test("local RTC and browser error gates fail closed", () => {
  assert.equal(assertLocalOnlyRtcConfigurations([{ iceServers: [] }, { iceServers: [] }], "two contexts"), true);
  assert.throws(() => assertLocalOnlyRtcConfigurations([{ iceServers: [{ urls: "stun:example.test" }] }]), /retained an external ICE server/u);
  const clean = cleanErrorStreams();
  assert.equal(assertRustMultiplayerBrowserErrorStreams(clean), true);
  for (const key of Object.keys(clean)) {
    const changed = structuredClone(clean);
    changed[key].push({ message: "failure" });
    assert.throws(() => assertRustMultiplayerBrowserErrorStreams(changed));
  }
});

test("only exact loopback MP3 aborts and Vite control sockets are classified as expected", () => {
  const managedOrigin = "http://127.0.0.1:5173";
  const musicCancellation = {
    label: "guest",
    managedOrigin,
    url: `${managedOrigin}/music/blockwild-theme.mp3`,
    method: "GET",
    resourceType: "media",
    failure: "net::ERR_ABORTED",
  };
  assert.equal(isExpectedLocalMusicCancellation(musicCancellation, managedOrigin), true);
  for (const mutate of [
    (value) => { value.url = "http://localhost:5173/music/blockwild-theme.mp3"; },
    (value) => { value.url = `${managedOrigin}/music/blockwild-theme.mp3?retry=1`; },
    (value) => { value.url = `${managedOrigin}/audio/blockwild-theme.mp3`; },
    (value) => { value.url = `${managedOrigin}/music/blockwild-theme.wav`; },
    (value) => { value.method = "POST"; },
    (value) => { value.resourceType = "fetch"; },
    (value) => { value.failure = "net::ERR_FAILED"; },
  ]) {
    const changed = structuredClone(musicCancellation);
    mutate(changed);
    assert.equal(isExpectedLocalMusicCancellation(changed, managedOrigin), false);
  }

  const viteSocket = {
    label: "host",
    managedOrigin,
    url: "ws://127.0.0.1:5173/?token=EAL_mV11PtUV",
  };
  assert.equal(isExpectedManagedViteWebSocket(viteSocket, managedOrigin), true);
  for (const url of [
    "wss://127.0.0.1:5173/?token=EAL_mV11PtUV",
    "ws://localhost:5173/?token=EAL_mV11PtUV",
    "ws://127.0.0.1:5174/?token=EAL_mV11PtUV",
    "ws://127.0.0.1:5173/multiplayer?token=EAL_mV11PtUV",
    "ws://127.0.0.1:5173/?room=EAL_mV11PtUV",
    "ws://127.0.0.1:5173/?token=short",
    "ws://127.0.0.1:5173/?token=EAL_mV11PtUV&room=extra",
  ]) assert.equal(isExpectedManagedViteWebSocket({ ...viteSocket, url }, managedOrigin), false);

  assert.equal(assertRustMultiplayerBrowserErrorStreams({
    ...cleanErrorStreams(),
    expectedRequestCancellations: [musicCancellation],
    managedViteWebSockets: [viteSocket],
  }), true);
});

test("cleanup gate requires disconnected browsers, refused port, restored environment, drained errors, and removed owned state", () => {
  const cleanup = {
    hostContextStarted: true,
    guestContextStarted: true,
    hostContextClosed: true,
    guestContextClosed: true,
    hostBrowserDisconnected: true,
    guestBrowserDisconnected: true,
    serverStarted: true,
    serverClosed: true,
    serverPortRefused: true,
    environmentRestored: true,
    viteRuntimeRemoved: true,
    hostProfileRemoved: true,
    guestProfileRemoved: true,
    profileRootRemoved: true,
    candidateUnchanged: true,
    eventsDrained: true,
    browserMutexReleased: true,
    trackedChildPids: [],
    aliveChildPidsAfterCleanup: [],
    processTracking: {
      vite: "in-process-no-child",
      browser: "playwright-browser-handle-with-public-pid-if-exposed",
    },
  };
  assert.equal(assertRustMultiplayerCleanupEvidence(cleanup), true);
  for (const mutate of [
    (value) => { value.serverPortRefused = false; },
    (value) => { value.environmentRestored = false; },
    (value) => { value.hostBrowserDisconnected = false; },
    (value) => { value.viteRuntimeRemoved = false; },
    (value) => { value.eventsDrained = false; },
    (value) => { value.browserMutexReleased = false; },
    (value) => { value.aliveChildPidsAfterCleanup = [31_756]; },
  ]) {
    const changed = structuredClone(cleanup);
    mutate(changed);
    assert.throws(() => assertRustMultiplayerCleanupEvidence(changed));
  }
});
