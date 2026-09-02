import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";

import { VoxelEngine } from "../app/game/engine.ts";
import type { RustLiveCameraViewR10 } from "../app/game/rust-live-camera-view-r10.ts";
import type { RustIntegratedRuntimeExtractionV1 } from "../app/game/rust-integrated-runtime-contract.ts";

const engineUrl = new URL("../app/game/engine.ts", import.meta.url);

function interval(source: string, startMarker: string, endMarker: string) {
  // This is semantic source-structure inspection, not a raw-byte artifact check.
  source = source.replace(/\r\n/g, "\n");
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing engine interval '${startMarker}'`);
  return source.slice(start, end);
}

test("source-structure intervals preserve the same guards in LF and CRLF checkouts", () => {
  const source = "before\n  start() {\n    requiredGuard();\n  }\n  /**\n   * next\n";
  const expected = "  start() {\n    requiredGuard();\n  }";
  for (const text of [source, source.replace(/\n/g, "\r\n")]) {
    assert.equal(interval(text, "  start() {", "\n  /**\n   * next"), expected);
    assert.throws(() => interval(text, "missing()", "\n  /**"), /missing engine interval/);
  }
});

test("native camera projection is an exact Three presentation mirror", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const camera = new THREE.PerspectiveCamera();
  const localPlayerModel = { group: new THREE.Group() };
  const heldRoot = new THREE.Group();
  const offhandRoot = new THREE.Group();
  Object.assign(engine, { camera, localPlayerModel, heldRoot, offhandRoot, titleMode: false });
  const view = {
    mode: "third-front",
    position: { x: 4.25, y: 7.5, z: -3.75 },
    orientation: { x: 0, y: 0.6, z: 0, w: 0.8 },
    projection: { verticalFovRadians: Math.PI / 3, near: 0.075, far: 713 },
    viewport: { width: 1920, height: 1080 },
  } as RustLiveCameraViewR10;

  (engine as unknown as { projectRustLiveCameraViewR10(value: RustLiveCameraViewR10): void })
    .projectRustLiveCameraViewR10(view);

  assert.deepEqual(camera.position.toArray(), [4.25, 7.5, -3.75]);
  assert.deepEqual(camera.quaternion.toArray(), [0, 0.6, 0, 0.8]);
  assert.ok(Math.abs(camera.fov - 60) < 1e-12);
  assert.equal(camera.near, 0.075);
  assert.equal(camera.far, 713);
  assert.equal(camera.aspect, 1920 / 1080);
  assert.equal(engine.cameraMode, "third-front");
  assert.equal(localPlayerModel.group.visible, true);
  assert.equal(heldRoot.visible, false);
  assert.equal(offhandRoot.visible, false);
});

test("drawing-buffer views are positive monotonic and resize arms before serialized refresh", async () => {
  const source = await readFile(engineUrl, "utf8");
  const resize = interval(source, "  resize = () => {", "\n  private rustLivePlayerAuthorityEnabledR5");
  const view = interval(source, "  private ensureRustLiveRenderViewR10(", "\n  private rustLivePlayerAuthorityEnabledR5");
  const refresh = interval(source, "  private scheduleRustLiveViewRefreshR10(", "\n  private scheduleRustLiveCameraModeCycleR10");

  assert.ok(resize.indexOf("this.renderer.setSize(width, height, false)") < resize.indexOf("this.ensureRustLiveRenderViewR10()"));
  assert.match(view, /Math\.floor\(this\.canvas\.width\)/u);
  assert.match(view, /Math\.floor\(this\.canvas\.height\)/u);
  assert.match(view, /this\.rustLiveRenderViewRevisionR10 \+ 1/u);
  assert.match(view, /viewRevision <= 0/u);
  assert.doesNotMatch(resize, /renderExtraction\?\.resize/u);
  assert.ok(refresh.indexOf("this.armRustLiveRenderViewR10(view)") < refresh.indexOf("pump.refreshView(generation, requested)"));
  assert.match(refresh, /for \(;;\)/u);
  assert.match(refresh, /pump\.diagnostics\(\)\.lastView/u);
});

test("initial activation validates player and camera before arming and attaching terrain", async () => {
  const source = await readFile(engineUrl, "utf8");
  const player = interval(source, "  private async activateRustLivePlayerAuthorityR5(", "\n  private async stopRustLivePlayerAuthorityR5");
  const rejection = interval(source, "  private rejectRustLiveCameraActivationR10(", "\n  /**\n   * Activation owns no resize callback yet");
  const acceptance = interval(source, "  private async acceptRustLiveRendererActivationR10(", "\n  private async activateRustLiveRendererR10");
  const renderer = interval(source, "  private async activateRustLiveRendererR10(", "\n  private async closeMultiplayerForRustTransition");

  assert.ok(player.indexOf("this.ensureRustLiveRenderViewR10()") < player.indexOf("await pump.syncInitial(generation, requestedView)"));
  assert.ok(player.indexOf("await pump.syncInitial(generation, requestedView)") < player.indexOf("this.applyRustLiveAuthorityExtractionR10("));
  assert.ok(player.indexOf("this.applyRustLiveAuthorityExtractionR10(") < player.indexOf("this.enqueueRustLiveRendererExtractionR10({"));
  const arm = acceptance.indexOf("runtime.armRequiredView(generation, externalEntityId, view)");
  const publisher = acceptance.indexOf("new RendererShellExtractionPublisherR11(runtime.terrain, epoch)");
  const heldTerrain = acceptance.indexOf("publisher.present(snapshot)");
  const submit = acceptance.indexOf("await runtime.submitRuntimeExtraction(generation, pending.extraction");
  assert.ok(arm >= 0 && arm < publisher && publisher < heldTerrain && heldTerrain < submit);
  assert.match(renderer, /this\.renderExtraction = accepted\.publisher/u);
  assert.equal((acceptance.match(/publisher\.present\(snapshot\)/gu) ?? []).length, 1);
  assert.match(acceptance, /for \(;;\)/u);
  assert.match(acceptance,
    /refreshed = await this\.runRustLivePumpNetworkExclusiveR5\(\s*generation,\s*host,\s*pump,\s*"renderer activation refresh",\s*\(\) => pump\.refreshView\(generation, view\),\s*\)/u);
  assert.match(acceptance, /currentRustLiveRenderViewR10\(\)\?\.viewRevision !== view\.viewRevision\) continue/u);
  assert.match(acceptance, /rejectRustLiveCameraActivationR10\(error, generation, host, pump\)/u);
  assert.match(rejection, /this\.quarantineRustLivePlayerAuthorityR5\(error, pump\)/u);
  assert.match(renderer, /this\.rustLivePlayerAuthorityState === "blocked"\) throw error/u);
  assert.match(renderer, /assertRustLivePlayerViewContextR10\(generation, host, pump, "renderer runtime creation"\)/u);
  const guard = interval(source, "  private assertRustLivePlayerViewContextR10(", "\n  private projectRustLivePlayerViewR10");
  assert.match(guard, /pump !== this\.rustLiveInputPump \|\| pump\.state !== "ready"/u);
});

test("renderer activation coalesces resizes across creation and submission without republishing terrain", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const view1 = Object.freeze({ viewportWidth: 800, viewportHeight: 600, viewRevision: 1 });
  const view2 = Object.freeze({ viewportWidth: 1600, viewportHeight: 900, viewRevision: 2 });
  const view3 = Object.freeze({ viewportWidth: 1920, viewportHeight: 1080, viewRevision: 3 });
  const extraction = (revision: number) => Object.freeze({
    identity: Object.freeze({ tick: 17 }), extractionRevision: revision,
  }) as unknown as RustIntegratedRuntimeExtractionV1;
  const camera = (revision: number) => Object.freeze({ viewRevision: BigInt(revision) }) as RustLiveCameraViewR10;
  const refreshed = new Map([
    [2, Object.freeze({ extraction: extraction(11), camera: camera(2) })],
    [3, Object.freeze({ extraction: extraction(12), camera: camera(3) })],
  ]);
  let releaseCreation!: () => void;
  let markCreationStarted!: () => void;
  const creationGate = new Promise<void>((resolve) => { releaseCreation = resolve; });
  const creationStarted = new Promise<void>((resolve) => { markCreationStarted = resolve; });
  let releaseFirstSubmission!: () => void;
  let markFirstSubmissionStarted!: () => void;
  const firstSubmissionGate = new Promise<void>((resolve) => { releaseFirstSubmission = resolve; });
  const firstSubmissionStarted = new Promise<void>((resolve) => { markFirstSubmissionStarted = resolve; });
  const refreshViews: number[] = [];
  const armedViews: number[] = [];
  const submitted: Array<Readonly<{ revision: number; frameSequence: bigint }>> = [];
  const projectedViews: number[] = [];
  let terrainResourceBatches = 0;
  let terrainFrames = 0;
  const host = {
    diagnostics: () => ({ state: "ready", contentHash: "a".repeat(64) }),
    multiplayerAuthority: () => ({
      runExclusiveMutation: async <T>(operation: () => Promise<T>) => operation(),
    }),
  };
  const pump = {
    state: "ready",
    adoptExternalNetworkSuccessor: async () => false,
    refreshView: async (_generation: number, view: { viewRevision: number }) => {
      refreshViews.push(view.viewRevision);
      const result = refreshed.get(view.viewRevision);
      if (!result) throw new Error(`unexpected activation refresh ${view.viewRevision}`);
      return Object.freeze({ discarded: false, cause: "viewport" as const, ...result });
    },
  };
  const terrain = {
    resources: () => { terrainResourceBatches += 1; return true; },
    frame: () => { terrainFrames += 1; return true; },
    resize: () => undefined,
    requestRecovery: () => true,
    diagnostics: () => Object.freeze({ state: "ready" }),
  };
  const runtime = {
    state: "ready",
    epoch: BigInt(0),
    terrain,
    armRequiredView: (_generation: number, _externalEntityId: string, view: { viewRevision: number }) => {
      armedViews.push(view.viewRevision);
      return true;
    },
    submitRuntimeExtraction: async (
      _generation: number,
      value: RustIntegratedRuntimeExtractionV1,
      context: { frameSequence: bigint },
    ) => {
      submitted.push({ revision: value.extractionRevision, frameSequence: context.frameSequence });
      if (submitted.length === 1) {
        markFirstSubmissionStarted();
        await firstSubmissionGate;
      }
      return true;
    },
    dispose: async () => undefined,
  };
  const sink = {
    switchEpoch: () => true,
    resources: () => true,
    frame: () => true,
    resize: () => undefined,
    requestRecovery: () => true,
    diagnostics: () => Object.freeze({ state: "ready" }),
  };
  Object.assign(engine, {
    rustRenderSink: sink,
    rustRenderBaseEpoch: BigInt(40),
    rustLiveRenderRuntime: null,
    renderExtraction: null,
    rustRuntimeTransitionGeneration: 5,
    rustRuntimeHost: host,
    rustLiveInputPump: pump,
    rustLivePlayerAttestationR10: Object.freeze({ externalEntityId: "player:activation" }),
    rustLiveRenderViewR10: view1,
    rustLiveRendererExtractionQueue: [{
      generation: 5, host, pump, viewRevision: 1, extraction: extraction(10),
    }],
    disposed: false,
    rustRenderExtractionRevision: 0,
    rustRenderFrameSequence: BigInt(0),
    renderExtractionNextAt: 0,
    renderExtractionLastError: null,
    applyRustLiveCameraExtractionR10: (
      _generation: number,
      _host: unknown,
      _pump: unknown,
      _extraction: RustIntegratedRuntimeExtractionV1,
      view: { viewRevision: number },
    ) => { projectedViews.push(view.viewRevision); },
    rustRendererShellSnapshotR11: (_now: number, simulationTick: bigint) => Object.freeze({
      simulationTick,
      animationTimeMicros: BigInt(500),
      camera: Object.freeze({
        position: [0, 0, 0] as const,
        orientation: [0, 0, 0, 1] as const,
        verticalFovRadians: 1,
        near: 0.05,
        far: 512,
        viewport: [1600, 900] as const,
      }),
      environment: Object.freeze({
        daylight: 0.8, worldTime: 0.3, weather: "clear" as const, underwater: 0, caveOcclusion: 0,
      }),
    }),
    quarantineRustLivePlayerAuthorityR5: (error: unknown) => { throw error; },
    quarantineRustLiveRendererR10: (error: unknown) => { throw error; },
  });
  const state = engine as unknown as { rustLiveRenderViewR10: typeof view1 | typeof view2 | typeof view3 };
  const factory = async (options: { epoch: bigint }) => {
    markCreationStarted();
    await creationGate;
    runtime.epoch = options.epoch;
    return runtime;
  };
  const activation = (engine as unknown as {
    activateRustLiveRendererR10(
      generation: number,
      host: unknown,
      factory: (options: { epoch: bigint }) => Promise<unknown>,
    ): Promise<void>;
  }).activateRustLiveRendererR10(5, host, factory);

  await creationStarted;
  state.rustLiveRenderViewR10 = view2;
  releaseCreation();
  await firstSubmissionStarted;
  state.rustLiveRenderViewR10 = view3;
  releaseFirstSubmission();
  await activation;

  assert.deepEqual(refreshViews, [2, 3]);
  assert.deepEqual(projectedViews, [2, 3]);
  assert.deepEqual(armedViews, [2, 3]);
  assert.deepEqual(submitted, [
    { revision: 11, frameSequence: BigInt(1) },
    { revision: 12, frameSequence: BigInt(2) },
  ]);
  assert.equal(terrainResourceBatches, 1);
  assert.equal(terrainFrames, 1);
  assert.equal((engine as unknown as { rustLiveRendererExtractionQueue: unknown[] })
    .rustLiveRendererExtractionQueue.length, 0);
  assert.equal((engine as unknown as { rustLiveRenderRuntime: unknown }).rustLiveRenderRuntime, runtime);
  assert.equal((engine as unknown as { rustRenderExtractionRevision: number }).rustRenderExtractionRevision, 12);
  assert.equal((engine as unknown as { rustRenderFrameSequence: bigint }).rustRenderFrameSequence, BigInt(2));
});

test("ordinary, viewport, and camera-command results preserve one serialized authority path", async () => {
  const source = await readFile(engineUrl, "utf8");
  const advance = interval(source, "  private scheduleRustLiveInputAdvanceR5()", "\n  private armRustLiveRenderViewR10");
  const refresh = interval(source, "  private scheduleRustLiveViewRefreshR10(", "\n  private scheduleRustLiveCameraModeCycleR10");
  const cameraConfig = interval(source, "  private scheduleRustLiveCameraModeCycleR10(", "\n  private quarantineRustLivePlayerAuthorityR5");
  const keyDown = interval(source, "  onKeyDown = (event: KeyboardEvent) => {", "\n  onKeyUp =");
  const liveKeyDown = keyDown.slice(
    keyDown.indexOf("if (this.rustLivePlayerAuthorityEnabledR5()) {"),
    keyDown.indexOf('if (event.code === "KeyQ"'),
  );

  assert.match(advance, /await pump\.advance\(generation, \{ view: requestedView \}\)/u);
  assert.match(advance, /result\.cause === "authority" \|\| result\.cause === "initial"/u);
  assert.ok(advance.indexOf("this.applyRustLiveAuthorityExtractionR10(") < advance.indexOf("this.enqueueRustLiveRendererExtractionR10("));
  assert.match(refresh, /this\.applyRustLiveCameraExtractionR10\(/u);
  assert.doesNotMatch(refresh, /applyRustLiveAuthorityExtractionR10/u);
  assert.match(cameraConfig, /await pump\.applyCameraConfig\(generation, \(current\) => \(\{/u);
  assert.match(cameraConfig, /current\.mode === "first" \? "third-rear"/u);
  assert.doesNotMatch(cameraConfig, /this\.cameraMode\s*=/u);
  assert.match(liveKeyDown, /event\.code === "KeyV"[\s\S]*this\.scheduleRustLiveCameraModeCycleR10\(\)/u);
  assert.doesNotMatch(liveKeyDown, /this\.cycleCameraMode\(\)/u);
});

test("resize during an awaited step commits refreshed player-camera authority and never queues the old view", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const firstView = Object.freeze({ viewportWidth: 800, viewportHeight: 600, viewRevision: 1 });
  const latestView = Object.freeze({ viewportWidth: 1600, viewportHeight: 900, viewRevision: 2 });
  const oldExtraction = Object.freeze({ extractionRevision: 10 }) as RustIntegratedRuntimeExtractionV1;
  const latestExtraction = Object.freeze({
    extractionRevision: 11,
    playerMarker: "accepted-post-step-player-row",
  }) as unknown as RustIntegratedRuntimeExtractionV1;
  const oldCamera = Object.freeze({ viewRevision: BigInt(1) }) as RustLiveCameraViewR10;
  const latestCamera = Object.freeze({ viewRevision: BigInt(2) }) as RustLiveCameraViewR10;
  let releaseAdvance!: (value: unknown) => void;
  const advance = new Promise((resolve) => { releaseAdvance = resolve; });
  const applied: Array<Readonly<{ extraction: RustIntegratedRuntimeExtractionV1; viewRevision: number }>> = [];
  const queued: number[] = [];
  let committedPlayerMarker: string | null = null;
  const host = {
    diagnostics: () => ({ state: "ready" }),
    multiplayerAuthority: () => ({
      runExclusiveMutation: async <T>(operation: () => Promise<T>) => operation(),
    }),
  };
  const pump = {
    state: "ready",
    sample() {},
    advance: () => advance,
    adoptExternalNetworkSuccessor: async () => false,
    refreshView: async () => Object.freeze({
      discarded: false, extraction: latestExtraction, camera: latestCamera, cause: "viewport" as const,
    }),
    diagnostics: () => Object.freeze({ lastView: latestView }),
  };
  Object.assign(engine, {
    rustLiveInputPump: pump,
    rustLivePlayerAttestationR10: Object.freeze({ externalEntityId: "player:camera" }),
    rustRuntimeHost: host,
    rustLivePlayerAuthorityGeneration: 3,
    rustRuntimeTransitionGeneration: 3,
    rustLiveRenderViewR10: firstView,
    rustLiveInputAdvance: null,
    rustLiveViewRefresh: null,
    rustLiveRenderRuntime: {},
    disposed: false,
    rustLivePlayerAuthorityEnabledR5: () => true,
    rustLiveInputIntentR5: () => ({}),
    applyRustLiveAuthorityExtractionR10: (
      _generation: number,
      _host: unknown,
      _pump: unknown,
      extraction: RustIntegratedRuntimeExtractionV1,
      view: { viewRevision: number },
    ) => {
      committedPlayerMarker = (extraction as unknown as { playerMarker?: string }).playerMarker ?? null;
      applied.push({ extraction, viewRevision: view.viewRevision });
    },
    applyRustLiveCameraExtractionR10: () => { throw new Error("camera-only path used for accepted step"); },
    enqueueRustLiveRendererExtractionR10: (entry: { viewRevision: number }) => { queued.push(entry.viewRevision); },
    trackRustAuthorityOperation: <T>(operation: Promise<T>) => operation,
    quarantineRustLivePlayerAuthorityR5: (error: unknown) => { throw error; },
  });
  const state = engine as unknown as { rustLiveRenderViewR10: typeof firstView | typeof latestView };

  (engine as unknown as { scheduleRustLiveInputAdvanceR5(): void }).scheduleRustLiveInputAdvanceR5();
  state.rustLiveRenderViewR10 = latestView;
  releaseAdvance(Object.freeze({
    discarded: false,
    step: Object.freeze({}),
    extraction: oldExtraction,
    cause: "authority" as const,
    camera: oldCamera,
  }));
  await (engine as unknown as { rustLiveInputAdvance: Promise<void> }).rustLiveInputAdvance;

  assert.deepEqual(applied, [{ extraction: latestExtraction, viewRevision: 2 }]);
  assert.equal(committedPlayerMarker, "accepted-post-step-player-row");
  assert.deepEqual(queued, [2]);
});

test("resize refresh carries its viewport cause when the awaited step had no extraction", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const firstView = Object.freeze({ viewportWidth: 800, viewportHeight: 600, viewRevision: 1 });
  const latestView = Object.freeze({ viewportWidth: 1600, viewportHeight: 900, viewRevision: 2 });
  const latestExtraction = Object.freeze({ extractionRevision: 11 }) as RustIntegratedRuntimeExtractionV1;
  const latestCamera = Object.freeze({ viewRevision: BigInt(2) }) as RustLiveCameraViewR10;
  let releaseAdvance!: (value: unknown) => void;
  const advance = new Promise((resolve) => { releaseAdvance = resolve; });
  const cameraViews: number[] = [];
  const queued: number[] = [];
  let authorityApplications = 0;
  const host = {
    diagnostics: () => ({ state: "ready" }),
    multiplayerAuthority: () => ({
      runExclusiveMutation: async <T>(operation: () => Promise<T>) => operation(),
    }),
  };
  const pump = {
    state: "ready",
    sample() {},
    advance: () => advance,
    adoptExternalNetworkSuccessor: async () => false,
    refreshView: async () => Object.freeze({
      discarded: false,
      extraction: latestExtraction,
      camera: latestCamera,
      cause: "viewport" as const,
    }),
    diagnostics: () => Object.freeze({ lastView: latestView }),
  };
  Object.assign(engine, {
    rustLiveInputPump: pump,
    rustLivePlayerAttestationR10: Object.freeze({ externalEntityId: "player:camera" }),
    rustRuntimeHost: host,
    rustLivePlayerAuthorityGeneration: 3,
    rustRuntimeTransitionGeneration: 3,
    rustLiveRenderViewR10: firstView,
    rustLiveInputAdvance: null,
    rustLiveViewRefresh: null,
    rustLiveRenderRuntime: {},
    disposed: false,
    rustLivePlayerAuthorityEnabledR5: () => true,
    rustLiveInputIntentR5: () => ({}),
    applyRustLiveAuthorityExtractionR10: () => { authorityApplications += 1; },
    applyRustLiveCameraExtractionR10: (
      _generation: number,
      _host: unknown,
      _pump: unknown,
      _extraction: RustIntegratedRuntimeExtractionV1,
      view: { viewRevision: number },
    ) => { cameraViews.push(view.viewRevision); },
    enqueueRustLiveRendererExtractionR10: (entry: { viewRevision: number }) => { queued.push(entry.viewRevision); },
    trackRustAuthorityOperation: <T>(operation: Promise<T>) => operation,
    quarantineRustLivePlayerAuthorityR5: (error: unknown) => { throw error; },
  });
  const state = engine as unknown as { rustLiveRenderViewR10: typeof firstView | typeof latestView };

  (engine as unknown as { scheduleRustLiveInputAdvanceR5(): void }).scheduleRustLiveInputAdvanceR5();
  state.rustLiveRenderViewR10 = latestView;
  releaseAdvance(Object.freeze({ discarded: false, step: Object.freeze({}), extraction: null }));
  await (engine as unknown as { rustLiveInputAdvance: Promise<void> }).rustLiveInputAdvance;

  assert.equal(authorityApplications, 0);
  assert.deepEqual(cameraViews, [2]);
  assert.deepEqual(queued, [2]);
});

test("live rendering bypasses legacy camera mutation and has no second extraction producer", async () => {
  const source = await readFile(engineUrl, "utf8");
  const animate = interval(source, "  animate = (now: number) => {", "\n  advanceSimulation(milliseconds: number)");
  const manual = interval(source, "  advanceSimulation(milliseconds: number)", "\n  emitHud(");
  const publish = interval(source, "  publishRendererExtractionR11(now: number)", "\n  /** Holds presentation time");

  assert.match(animate, /if \(!rustLivePlayerAuthority\) this\.updateGameplayCamera\(dt\)/u);
  assert.match(manual, /if \(!rustLivePlayerAuthority\) this\.updateGameplayCamera\(Math\.min\(duration, 0\.1\)\)/u);
  assert.doesNotMatch(source, /runtimeService\(\)\.extract\(/u);
  assert.ok(publish.indexOf("this.scheduleRustLiveInputExtractionPresentationR10(runtime, pending")
    < publish.indexOf("if (!sink.present(snapshot))"));
  assert.match(publish, /scheduleRustLiveInputExtractionPresentationR10[\s\S]*return;/u);
  assert.doesNotMatch(publish, /camera:\s*snapshot\.camera/u);
});

test("teardown invalidates and drains the pump before clearing camera operation handles", async () => {
  const source = await readFile(engineUrl, "utf8");
  const stop = interval(source, "  private async stopRustLivePlayerAuthorityR5()", "\n  private async shutdownBoundNativePersistence");
  assert.ok(stop.indexOf("this.rustLiveInputPump = null") < stop.indexOf("await pump.stop()"));
  assert.match(stop, /this\.rustLiveCameraPresentationViewR10 = null/u);
  assert.match(stop, /this\.rustLiveCameraExtractionRevisionR10 = null/u);
  assert.match(stop, /this\.rustLiveRenderViewR10 = null/u);
  assert.match(stop, /this\.rustLiveRenderViewRevisionR10 = 0/u);
  assert.ok(stop.indexOf("await pump.stop()") < stop.indexOf("this.rustLiveViewRefresh = null"));
});
