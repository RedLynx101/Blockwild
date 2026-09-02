import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH,
  REQUIRED_TERRAIN_EDIT_SOURCE_DIGEST,
  REQUIRED_TERRAIN_EDIT_SOURCE_FILE_COUNT,
  TERRAIN_EDIT_TITLE_MENU_LABELS,
  TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES,
  TERRAIN_EDIT_ENGINE_DIRECTORIES,
  REQUIRED_TERRAIN_EDIT_WASM_BYTES,
  REQUIRED_TERRAIN_EDIT_WASM_SHA256,
  acquireTerrainEditBrowserMutex,
  assertTerrainEditBrowserErrorStreams,
  assertTerrainEditCleanupEvidence,
  assertTerrainEditCandidateUnchanged,
  assertTerrainEditEngineIndex,
  assertTerrainEditPersistenceEvidence,
  assertTerrainEditReloadTitleVisualReadiness,
  canonicalSavedEdits,
  proveReloadedTerrainRay,
  parseTerrainEditBrowserOptions,
  rustTerrainGenerationIsReadyAndAuthoritative,
  safeRemoveTerrainEditOwnedDirectory,
  savedEditAt,
  selectTerrainBreakTarget,
  selectTerrainEditCandidate,
  terrainEditAddress,
  terrainRayCells,
  usage,
} from "../scripts/verify-rust-terrain-edit-reload-browser.mjs";
import { assessRustMultiplayerVisualTerrainReadiness } from "../scripts/verify-rust-multiplayer-browser.mjs";

const PLAYER_EDIT_ZERO = Object.freeze({
  total: 0,
  byKind: Object.freeze({ break: 0, place: 0, "tree-fell": 0 }),
  pendingConsolidationTransactions: 0,
  mutationToLocalMeshVisible: Object.freeze({ count: 0 }),
  last: null,
});

const PLAYER_EDIT_ONE = Object.freeze({
  total: 1,
  byKind: Object.freeze({ break: 1, place: 0, "tree-fell": 0 }),
  pendingConsolidationTransactions: 0,
  mutationToLocalMeshVisible: Object.freeze({ count: 1 }),
  last: Object.freeze({ kind: "break", pendingConsolidations: 0 }),
});

function state({ target, edits = PLAYER_EDIT_ZERO, phase = "playing" } = {}) {
  return {
    state: phase,
    player: { position: [4, 43.51, 0], yaw: 0, pitch: -0.48, mode: "survival" },
    world: { seed: "MOON-FIELD-505" },
    target: target ?? { type: "block", name: "Grass", position: [4, 44, -2] },
    performance: { streaming: { playerEdits: edits } },
  };
}

function storage(edits, activeWorldId = "world_terrain_edit") {
  return {
    activeWorldId,
    catalogWorldCount: 1,
    save: {
      seed: "MOON-FIELD-505",
      mode: "survival",
      player: { x: 4, y: 43.51, z: 0, yaw: 0, pitch: -0.48 },
      edits,
    },
  };
}

function visualTerrainSnapshot() {
  const presentations = () => ({
    opaque: {
      required: true,
      mode: "source",
      source: true,
      sourceVisible: true,
      combined: false,
      combinedVisible: false,
    },
    cutout: {
      required: true,
      mode: "source",
      source: true,
      sourceVisible: true,
      combined: false,
      combinedVisible: false,
    },
  });
  const chunks = [];
  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
      chunks.push({
        key: `${offsetX},${offsetZ}`,
        offset: { x: offsetX, z: offsetZ },
        present: true,
        visible: true,
        lightReady: true,
        ready: true,
        requiredSections: [{
          section: 0,
          ready: true,
          requiredLayers: ["opaque", "cutout"],
          presentations: presentations(),
        }],
      });
    }
  }
  return {
    state: {
      performance: {
        streaming: {
          playerChunk: "0,0",
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
            epoch: 1,
          },
          terrainWorker: { supported: true, ready: true },
          playerTerrainPresentation: {
            schema: 1,
            epoch: 1,
            centerKey: "0,0",
            desired: 9,
            ready: 9,
            chunks,
          },
        },
      },
    },
    runtime: {},
  };
}

function titleVisualElement(x, y, width, height, overrides = {}) {
  return {
    visible: true,
    inViewport: true,
    unoccluded: true,
    bounds: { x, y, width, height },
    ...overrides,
  };
}

function titleVisualObservation() {
  return {
    documentVisibility: "visible",
    fontsStatus: "loaded",
    overlay: titleVisualElement(0, 0, 1280, 720),
    menu: titleVisualElement(455, 275, 370, 398),
    logo: {
      text: "BLOCKWILD",
      ...titleVisualElement(360, 72, 560, 110),
      fontReady: true,
      colorVisible: true,
    },
    buttons: TERRAIN_EDIT_TITLE_MENU_LABELS.map((label, index) => ({
      label,
      disabled: false,
      activeAnimations: 0,
      button: titleVisualElement(455, 275 + index * 58, 370, 50),
      text: {
        ...titleVisualElement(520, 291 + index * 58, 240, 16),
        fontReady: true,
        colorVisible: true,
      },
    })),
  };
}

function titleVisualEvidence(observations = null) {
  const samples = observations ?? Array.from(
    { length: TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES },
    () => structuredClone(titleVisualObservation()),
  );
  return { schema: 1, samples };
}

test("Rust terrain authority accepts available capacity or coherent full saturation", () => {
  const healthy = {
    mode: "rust",
    selectionSource: "build-rust-primary",
    authorityRequired: true,
    state: "ready",
    supported: true,
    workers: 3,
    ready: 3,
  };
  assert.equal(rustTerrainGenerationIsReadyAndAuthoritative({
    ...healthy,
    acceptingRequests: true,
    busy: 2,
  }), true);
  assert.equal(rustTerrainGenerationIsReadyAndAuthoritative({
    ...healthy,
    acceptingRequests: false,
    busy: 3,
  }), true);
  assert.equal(rustTerrainGenerationIsReadyAndAuthoritative({
    ...healthy,
    acceptingRequests: false,
    busy: 2,
  }), false, "an unexplained admission refusal must fail closed");
  assert.equal(rustTerrainGenerationIsReadyAndAuthoritative({
    ...healthy,
    acceptingRequests: true,
    busy: 3,
  }), false, "reported capacity cannot coexist with a fully busy pool");
  assert.equal(rustTerrainGenerationIsReadyAndAuthoritative({
    ...healthy,
    state: "recovering",
    acceptingRequests: false,
    busy: 3,
  }), false);
});

test("terrain edit address preserves floor-based negative chunk semantics", () => {
  assert.deepEqual(terrainEditAddress([-1, 43, -17]), {
    coordinate: [-1, 43, -17],
    chunkX: -1,
    chunkZ: -2,
    localX: 15,
    localZ: 15,
    chunkKey: "-1,-2",
    index: 27_647,
  });
  assert.throws(() => terrainEditAddress([0, -65, 0]), /outside -64\.\.127/u);
  assert.throws(() => terrainEditAddress([0.5, 0, 0]), /safe integer/u);
});

test("saved edit lookup and canonical digest reject ambiguous or malformed edits", () => {
  const coordinate = [4, 44, -2];
  const address = terrainEditAddress(coordinate);
  const snapshot = storage({ [address.chunkKey]: [[address.index, 0]] });
  assert.deepEqual(savedEditAt(snapshot, coordinate), { address, found: true, type: 0 });
  const canonical = canonicalSavedEdits(snapshot);
  assert.equal(canonical.count, 1);
  assert.match(canonical.sha256, /^[a-f0-9]{64}$/u);
  assert.throws(() => canonicalSavedEdits(storage({
    [address.chunkKey]: [[address.index, 0], [address.index, 3]],
  })), /duplicate index/u);
  assert.throws(() => canonicalSavedEdits(storage({ nope: [] })), /chunk key is invalid/u);
});

test("target selection accepts only robust safe single-cell blocks on the public ray", () => {
  const snapshot = { state: state() };
  const selected = selectTerrainBreakTarget(snapshot);
  assert.equal(selected.name, "Grass");
  assert.deepEqual(selected.position, [4, 44, -2]);
  assert.equal(selected.rayOrdinal, 3);
  assert.ok(selected.rayCellSpan > 1);
  assert.equal(selectTerrainBreakTarget({ state: state({
    target: { type: "block", name: "Sunstep Grass", position: [4, 44, -2] },
  }) }).name, "Sunstep Grass");
  assert.equal(selectTerrainBreakTarget({ state: state({
    target: { type: "block", name: "Wildwood Shelf", position: [4, 44, -2] },
  }) }).name, "Wildwood Shelf");
  assert.equal(selectTerrainBreakTarget({ state: state({
    target: { type: "block", name: "Wildwood Log", position: [4, 44, -2] },
  }) }), null);
  assert.equal(selectTerrainBreakTarget({ state: state({
    target: { type: "block", name: "Grass", position: [4, 43, 0] },
  }) }), null);
  assert.equal(selectTerrainBreakTarget({ state: state({
    target: { type: "mob", name: "Pebbletortoise", position: [4, 44, -2] },
  }) }), null);
  const ray = terrainRayCells(snapshot.state);
  assert.deepEqual(ray.cells.slice(0, 6), [
    [4, 45, 0],
    [4, 45, -1],
    [4, 44, -1],
    [4, 44, -2],
    [4, 44, -3],
    [4, 43, -3],
  ]);
});

test("reload ray proof requires identical pose and the edited cell to stay untargetable", () => {
  const before = { state: state() };
  const continued = { state: state({ target: { type: "block", name: "Dirt", position: [4, 43, -3] } }) };
  const proof = proveReloadedTerrainRay(before, continued, [4, 44, -2]);
  assert.equal(proof.exactRoundedPosePreserved, true);
  assert.equal(proof.editedCoordinateRayOrdinal, 3);
  assert.equal(proof.reloadedTargetRayOrdinal, 5);
  assert.throws(() => proveReloadedTerrainRay(before, {
    state: state({ target: { type: "block", name: "Grass", position: [4, 44, -2] } }),
  }, [4, 44, -2]), /still targets/u);
  const moved = structuredClone(continued);
  moved.state.player.yaw = 0.01;
  assert.throws(() => proveReloadedTerrainRay(before, moved, [4, 44, -2]), /changed the exact rounded player pose/u);
});

test("persistence proof binds one trusted break to exact Air bytes through Save, reload, and Continue", () => {
  const selection = selectTerrainBreakTarget({ state: state() });
  const address = selection.address;
  const edits = { [address.chunkKey]: [[address.index, 0]] };
  const beforeEdit = { state: state(), storage: storage({}) };
  const afterGesture = { state: state({
    edits: PLAYER_EDIT_ONE,
    target: { type: "block", name: "Dirt", position: [4, 43, -3] },
  }), storage: storage({}) };
  const titleAfterSave = { state: state({ phase: "title" }), storage: storage(edits) };
  const titleAfterReload = { state: state({ phase: "title" }), storage: storage(edits) };
  const continued = {
    state: state({ target: { type: "block", name: "Dirt", position: [4, 43, -3] } }),
    storage: storage(edits),
  };
  const proof = assertTerrainEditPersistenceEvidence({
    beforeEdit,
    afterGesture,
    titleAfterSave,
    titleAfterReload,
    continued,
    selection,
  });
  assert.deepEqual(proof.coordinate, [4, 44, -2]);
  assert.equal(proof.replacementBlockId, 0);
  assert.equal(proof.canonicalBeforeMining.count, 0);
  assert.equal(proof.canonicalEditCount, 1);
  assert.match(proof.canonicalEditSha256, /^[a-f0-9]{64}$/u);

  const wrong = structuredClone(titleAfterReload);
  wrong.storage.save.edits[address.chunkKey][0][1] = 3;
  assert.throws(() => assertTerrainEditPersistenceEvidence({
    beforeEdit,
    afterGesture,
    titleAfterSave,
    titleAfterReload: wrong,
    continued,
    selection,
  }), /did not retain Air/u);

  const synthetic = structuredClone(afterGesture);
  synthetic.state.performance.streaming.playerEdits.byKind.place = 1;
  assert.throws(() => assertTerrainEditPersistenceEvidence({
    beforeEdit,
    afterGesture: synthetic,
    titleAfterSave,
    titleAfterReload,
    continued,
    selection,
  }), /exactly one single-cell break/u);

  const preexisting = structuredClone(beforeEdit);
  const extraAddress = terrainEditAddress([5, 44, -2]);
  preexisting.storage.save.edits = { [extraAddress.chunkKey]: [[extraAddress.index, 3]] };
  assert.throws(() => assertTerrainEditPersistenceEvidence({
    beforeEdit: preexisting,
    afterGesture,
    titleAfterSave,
    titleAfterReload,
    continued,
    selection,
  }), /canonical saved edit\(s\) immediately before mining/u);

  const extraAfterSave = structuredClone(titleAfterSave);
  extraAfterSave.storage.save.edits[extraAddress.chunkKey].push([extraAddress.index, 3]);
  assert.throws(() => assertTerrainEditPersistenceEvidence({
    beforeEdit,
    afterGesture,
    titleAfterSave: extraAfterSave,
    titleAfterReload,
    continued,
    selection,
  }), /Save & Quit retained 2 canonical saved edits instead of exactly one/u);

  const extraAfterReload = structuredClone(titleAfterReload);
  extraAfterReload.storage.save.edits[extraAddress.chunkKey].push([extraAddress.index, 3]);
  assert.throws(() => assertTerrainEditPersistenceEvidence({
    beforeEdit,
    afterGesture,
    titleAfterSave,
    titleAfterReload: extraAfterReload,
    continued,
    selection,
  }), /fresh page reload retained 2 canonical saved edits instead of exactly one/u);
});

test("post-reload title visual proof rejects incomplete, hidden, or staggered menu paint", () => {
  const accepted = assertTerrainEditReloadTitleVisualReadiness(titleVisualEvidence());
  assert.deepEqual(accepted.expectedLabels, TERRAIN_EDIT_TITLE_MENU_LABELS);
  assert.equal(accepted.stableSamples, TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES);

  const incomplete = titleVisualObservation();
  incomplete.buttons.pop();
  assert.throws(() => assertTerrainEditReloadTitleVisualReadiness(titleVisualEvidence(
    Array.from({ length: TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES }, () => structuredClone(incomplete)),
  )), /rendered 6 title choices instead of 7/u);

  const hidden = titleVisualObservation();
  hidden.buttons[3].text.visible = false;
  assert.throws(() => assertTerrainEditReloadTitleVisualReadiness(titleVisualEvidence(
    Array.from({ length: TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES }, () => structuredClone(hidden)),
  )), /Characters text is not visibly rendered/u);

  const staggered = Array.from(
    { length: TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES },
    (_, index) => {
      const observation = titleVisualObservation();
      observation.buttons[index].text.bounds.x += index + 1;
      return observation;
    },
  );
  assert.throws(() => assertTerrainEditReloadTitleVisualReadiness(titleVisualEvidence(staggered)),
    /did not remain visually stable across compositor observations/u);
});

test("post-reload title visual wait precedes read, retained screenshot, and Continue click", () => {
  const source = readFileSync(new URL("../scripts/verify-rust-terrain-edit-reload-browser.mjs", import.meta.url), "utf8");
  const reload = source.indexOf("await page.reload(");
  const visualReady = source.indexOf(
    "titleVisualReadiness = await waitForTerrainEditReloadTitleVisualReadiness(",
    reload,
  );
  const read = source.indexOf('titleAfterReload = await readAndRecord("title-after-full-reload");', visualReady);
  const screenshot = source.indexOf('"06-title-after-full-reload"', read);
  const click = source.indexOf("await freshContinue.click({ noWaitAfter: true });", screenshot);
  assert.ok(reload >= 0 && visualReady > reload && read > visualReady && screenshot > read && click > screenshot);
});

test("error and cleanup assertions fail closed", () => {
  const emptyStreams = {
    consoleErrors: [], pageErrors: [], runtimeErrors: [], routeErrors: [],
    httpErrors: [], requestFailures: [], externalRequests: [], webSockets: [],
  };
  assert.equal(assertTerrainEditBrowserErrorStreams(emptyStreams), true);
  assert.throws(() => assertTerrainEditBrowserErrorStreams({
    ...emptyStreams,
    pageErrors: [{ message: "boom" }],
  }), /pageErrors contains 1/u);

  const cleanup = {
    browserStarted: true,
    browserClosed: true,
    browserDisconnected: true,
    serverStarted: true,
    serverClosed: true,
    serverPortRefused: true,
    environmentRestored: true,
    profileRemoved: true,
    profileRootRemoved: true,
    databasePathsRemoved: true,
    viteRuntimeRemoved: true,
    candidateUnchanged: true,
    eventsDrained: true,
    browserMutexReleased: true,
    trackedChildPids: [123],
    aliveChildPidsAfterCleanup: [],
    databasePathsAfterCleanup: [],
  };
  assert.equal(assertTerrainEditCleanupEvidence(cleanup), true);
  assert.throws(() => assertTerrainEditCleanupEvidence({ ...cleanup, profileRemoved: false }),
    /profileRemoved is not true/u);
  assert.throws(() => assertTerrainEditCleanupEvidence({ ...cleanup, aliveChildPidsAfterCleanup: [123] }),
    /process remains alive/u);
  assert.throws(() => assertTerrainEditCleanupEvidence({ ...cleanup, browserMutexReleased: false }),
    /browserMutexReleased is not true/u);
});

test("terrain edit browser mutex rejects overlap and releases the exact OS listener", async () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "blockwild-terrain-edit-mutex-test-"));
  let first = null;
  let replacement = null;
  try {
    first = await acquireTerrainEditBrowserMutex(repositoryRoot, { port: 0 });
    assert.equal(first.evidence.status, "acquired");
    assert.ok(first.evidence.port > 0);
    await assert.rejects(
      acquireTerrainEditBrowserMutex(repositoryRoot, { port: first.evidence.port }),
      (error) => error.code === "BLOCKWILD_BROWSER_GATE_OVERLAP"
        && error.browserGateMutex?.status === "contended",
    );
    assert.equal(await first.release(), true);
    assert.equal(first.evidence.released, true);
    assert.equal(first.evidence.status, "released");
    replacement = await acquireTerrainEditBrowserMutex(repositoryRoot, { port: first.evidence.port });
    assert.equal(replacement.evidence.status, "acquired");
  } finally {
    await replacement?.release().catch(() => undefined);
    await first?.release().catch(() => undefined);
    safeRemoveTerrainEditOwnedDirectory(
      os.tmpdir(),
      repositoryRoot,
      "blockwild-terrain-edit-mutex-test-",
    );
  }
  const source = readFileSync(new URL("../scripts/verify-rust-terrain-edit-reload-browser.mjs", import.meta.url), "utf8");
  const acquire = source.indexOf("browserMutex = await acquireTerrainEditBrowserMutex(options.repositoryRoot);");
  const serverStart = source.indexOf("managedServer = await startManagedViteServer(", acquire);
  const finalizer = source.indexOf("} finally {", serverStart);
  const release = source.indexOf("cleanup.browserMutexReleased = await browserMutex.release();", finalizer);
  const cleanupAssertion = source.indexOf("assertTerrainEditCleanupEvidence(cleanup);", release);
  assert.ok(acquire >= 0 && serverStart > acquire,
    "the shared mutex must be acquired before the managed browser server starts");
  assert.ok(finalizer > serverStart && release > finalizer && cleanupAssertion > release,
    "the shared mutex must be released in final cleanup before cleanup acceptance");
  assert.match(source, /return acquireManagedBrowserGateMutex\(repositoryRoot, options\);/u);
});

test("terrain edit visual phases use stable current-player opaque and applicable cutout readiness", () => {
  const ready = visualTerrainSnapshot();
  assert.equal(assessRustMultiplayerVisualTerrainReadiness(ready, "terrain-edit").ready, true);
  const missingOpaque = structuredClone(ready);
  missingOpaque.state.performance.streaming.playerTerrainPresentation.chunks[0]
    .requiredSections[0].presentations.opaque.sourceVisible = false;
  assert.equal(assessRustMultiplayerVisualTerrainReadiness(missingOpaque).ready, false);
  const missingCutout = structuredClone(ready);
  missingCutout.state.performance.streaming.playerTerrainPresentation.chunks[0]
    .requiredSections[0].presentations.cutout.sourceVisible = false;
  assert.equal(assessRustMultiplayerVisualTerrainReadiness(missingCutout).ready, false);

  const source = readFileSync(new URL("../scripts/verify-rust-terrain-edit-reload-browser.mjs", import.meta.url), "utf8");
  const created = source.indexOf('const created = await waitForGameplay("create-ready");');
  const freshCreate = source.indexOf("terrainReadiness.freshCreate = await waitForRustMultiplayerVisualTerrainReadiness(", created);
  const createdScreenshot = source.indexOf('"01-created-rust-terrain"', freshCreate);
  assert.ok(created >= 0 && freshCreate > created && createdScreenshot > freshCreate);
  const afterGesture = source.indexOf('assertRustTerrainCheckpoint(afterGesture, options.expectedArtifactHash, "after-gesture");');
  const afterEdit = source.indexOf("terrainReadiness.afterEdit = await waitForRustMultiplayerVisualTerrainReadiness(", afterGesture);
  const editScreenshot = source.indexOf('"03-after-trusted-break"', afterEdit);
  assert.ok(afterGesture >= 0 && afterEdit > afterGesture && editScreenshot > afterEdit);
  const continued = source.indexOf('continued = await waitForGameplay("fresh-continue-ready");');
  const freshContinue = source.indexOf("terrainReadiness.freshContinue = await waitForRustMultiplayerVisualTerrainReadiness(", continued);
  const continuedScreenshot = source.indexOf('"07-continued-edited-terrain"', freshContinue);
  assert.ok(continued >= 0 && freshContinue > continued && continuedScreenshot > freshContinue);
  assert.equal((source.match(/waitForRustMultiplayerVisualTerrainReadiness\(/gu) ?? []).length, 3);
  for (const phase of ["fresh-create", "after-edit", "fresh-continue"]) {
    assert.match(source, new RegExp(`failureStage: "terrain-readiness-${phase}"`, "u"));
  }
});

test("owned directory cleanup refuses siblings and removes only a direct prefixed child", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "blockwild-terrain-edit-test-"));
  const owned = path.join(parent, "owned-run");
  mkdirSync(owned);
  writeFileSync(path.join(owned, "marker.txt"), "owned", "utf8");
  assert.throws(() => safeRemoveTerrainEditOwnedDirectory(parent, owned, "wrong-"), /Refusing unsafe/u);
  assert.equal(existsSync(owned), true);
  assert.equal(safeRemoveTerrainEditOwnedDirectory(parent, owned, "owned-"), true);
  assert.equal(existsSync(owned), false);
  safeRemoveTerrainEditOwnedDirectory(os.tmpdir(), parent, "blockwild-terrain-edit-test-");
});

test("verifier source uses real UI and trusted player input without a mutation hook", () => {
  const source = readFileSync(new URL("../scripts/verify-rust-terrain-edit-reload-browser.mjs", import.meta.url), "utf8");
  assert.match(source, /page\.mouse\.down\(\{ button: "left" \}\)/u);
  assert.match(source, /page\.mouse\.up\(\{ button: "left" \}\)/u);
  assert.match(source, /Input\.dispatchTouchEvent/u);
  assert.match(source, /\.touch-look-zone/u);
  assert.match(source, /name: "Harvest or attack"/u);
  assert.match(source, /name: \/Create New World/u);
  assert.match(source, /name: "Save & Quit to Title"/u);
  assert.match(source, /page\.reload\(/u);
  assert.doesNotMatch(source, /\.setBlock\s*\(/u);
  assert.doesNotMatch(source, /\.setBlocksBatch\s*\(/u);
  assert.doesNotMatch(source, /\.setMining\s*\(/u);
  assert.doesNotMatch(source, /exerciseImmediateEdit/u);
  assert.match(usage(), new RegExp(REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH, "u"));
  assert.equal(REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH,
    "c7bfb66cb842b08ea722f3be306d85cbf2d018794a86944b153b9764d4d1e20b");
  assert.equal(REQUIRED_TERRAIN_EDIT_SOURCE_DIGEST,
    "e4fcec5a5762968647960f41e5c18ee7688c81c4c56fa833cb3d476b7f2a0cda");
  assert.equal(REQUIRED_TERRAIN_EDIT_SOURCE_FILE_COUNT, 222);
  assert.equal(REQUIRED_TERRAIN_EDIT_WASM_SHA256,
    "27581732bb4b6ac744b31ca870211b9656036b6f949b78f875f65c0fb54c1d30");
  assert.equal(REQUIRED_TERRAIN_EDIT_WASM_BYTES, 7_377_970);
  assert.match(usage(), /--engine-dir public\/engine /u);
});

test("terrain edit options allow only the explicit canonical or locator roots and exact current pin", () => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const options = (directory, hash = REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH) => parseTerrainEditBrowserOptions([
    "node", "verifier", "--engine-dir", directory, "--expected-artifact-hash", hash,
    "--output", "work/hybrid-rust-migration/terrain-edit-options-test",
  ], { cwd: repositoryRoot });
  assert.deepEqual(TERRAIN_EDIT_ENGINE_DIRECTORIES, ["public/engine", "public/engine-locator-candidate"]);
  for (const directory of TERRAIN_EDIT_ENGINE_DIRECTORIES) {
    assert.equal(options(directory).engineDirectory, path.resolve(repositoryRoot, directory));
    assert.equal(options(directory).expectedArtifactHash, REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH);
  }
  for (const directory of ["public", "public/engine-other", "public/engine-schema-candidate", `public/engine/${REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH}`, "../engine"]) {
    assert.throws(() => options(directory), /must resolve exactly/u, directory);
  }
  assert.throws(() => options("public/engine", "f06f7d1349a7e74daac130e381b2c9d19762963b44e9b7dc546b534bb50c2139"), /requires exact artifact/u);
  assert.throws(() => parseTerrainEditBrowserOptions([
    "node", "verifier", "--expected-artifact-hash", REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH,
  ], { cwd: repositoryRoot }), /--engine-dir is required/u);
});

test("canonical index permits only retained renderer-lab while isolated index stays compatibility-only", () => {
  const single = { defaultVariant: "compatibility", artifacts: { compatibility: {} } };
  const published = { defaultVariant: "compatibility", artifacts: { compatibility: {}, "renderer-lab": {} } };
  assert.equal(assertTerrainEditEngineIndex(single, "public/engine"), true);
  assert.equal(assertTerrainEditEngineIndex(published, "public/engine"), true);
  assert.equal(assertTerrainEditEngineIndex(single, "public/engine-locator-candidate"), true);
  assert.throws(() => assertTerrainEditEngineIndex(published, "public/engine-locator-candidate"), /only the default compatibility/u);
  assert.throws(() => assertTerrainEditEngineIndex({ ...published, defaultVariant: "renderer-lab" }, "public/engine"), /default to compatibility/u);
  assert.throws(() => assertTerrainEditEngineIndex({ defaultVariant: "compatibility", artifacts: { compatibility: {}, unknown: {} } }, "public/engine"), /may only also contain renderer-lab/u);
  assert.throws(() => assertTerrainEditEngineIndex({ defaultVariant: "compatibility", artifacts: {} }, "public/engine"), /default to compatibility/u);
  assert.throws(() => assertTerrainEditEngineIndex(single, "public/engine-other"), /Unknown terrain-edit engine root/u);
});

test("canonical terrain package preflight verifies real files, exact current source and immutable root without a browser", () => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const selection = selectTerrainEditCandidate(repositoryRoot, "public/engine", REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH);
  assert.equal(selection.packageKind, "canonical");
  assert.equal(selection.relativeDirectory, "public/engine");
  assert.equal(selection.hash, REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH);
  assert.equal(selection.sourceSnapshot.digest, REQUIRED_TERRAIN_EDIT_SOURCE_DIGEST);
  assert.equal(selection.sourceSnapshot.fileCount, REQUIRED_TERRAIN_EDIT_SOURCE_FILE_COUNT);
  assert.equal(selection.wasm.sha256, REQUIRED_TERRAIN_EDIT_WASM_SHA256);
  assert.equal(selection.wasm.bytes, REQUIRED_TERRAIN_EDIT_WASM_BYTES);
  assert.ok(selection.routes.has("/engine/manifest.json"));
  assert.ok(selection.routes.has(`/engine/${REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH}/engine_bg.wasm`));
  for (const route of selection.routes.keys()) {
    assert.ok(route === "/engine/manifest.json" || route.startsWith(`/engine/${REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH}/`), route);
  }
  assert.ok(assertTerrainEditCandidateUnchanged(selection));
  assert.throws(() => assertTerrainEditCandidateUnchanged({ ...selection, treeSnapshot: { ...selection.treeSnapshot, digest: "0".repeat(64) } }), /engine tree changed/u);
  assert.throws(() => assertTerrainEditCandidateUnchanged({ ...selection, sourceSnapshot: { ...selection.sourceSnapshot, digest: "0".repeat(64) } }), /Rust engine source changed/u);
  assert.throws(() => selectTerrainEditCandidate(repositoryRoot, "public/engine-other", REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH), /must resolve exactly/u);
  assert.throws(() => selectTerrainEditCandidate(repositoryRoot, "public/engine", "0".repeat(64)), /requires exact artifact/u);
});
