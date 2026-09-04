import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDirectInvocation } from "./rust-engine-common.mjs";
import {
  assertRustTerrainCheckpoint, assertTerrainEditBrowserErrorStreams, assertTerrainEditCleanupEvidence,
  canonicalSavedEdits, parseTerrainEditBrowserOptions, proveReloadedTerrainRay, REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH,
  runManagedRustTerrainBrowserScenario, terrainRayCells,
} from "./verify-rust-terrain-edit-reload-browser.mjs";
import { assessRustMultiplayerVisualTerrainReadiness, waitForRustMultiplayerVisualTerrainReadiness } from "./verify-rust-multiplayer-browser.mjs";

export const R3_OLD_SAVE_GATE = "blockwild-rust-r3-old-save-browser-v1";
export const R3_OLD_SAVE_AUTHORITY = "rust-terrain-generation-plus-typescript-historical-save-compatibility-only";
export const R3_OLD_SAVE_FIXTURES = Object.freeze([
  Object.freeze({ id: "g16-omitted-settlement-pattern", filename: "g16-omitted-settlement-pattern.blockwild.json", generatorVersion: 16,
    bytes: 2136, sha256: "e9541ff6ff649d9b22b8c5641c93072a0e6729bf71aa5125bece9ab67b08926b" }),
  Object.freeze({ id: "g17-modern-control", filename: "g17-modern-control.blockwild.json", generatorVersion: 17,
    bytes: 2324, sha256: "5699215fb8fc2cf0219a672874644c4e79d48e4a95fca2d285cb6bf2c2ca148a" }),
]);
const FIXTURE_DIRECTORY = "tests/fixtures/rust-engine/r3/historical-saves";
const SENTINEL = Object.freeze([-120, 42, -10]);
const AIR_WITNESS = Object.freeze([-120, 42, -9]);
const CURRENT_GENERATOR_VERSION = 18;
const SOURCE_GUARD_FILES = Object.freeze([
  "app/game/world-storage.ts", "app/game/world-save-normalization.ts", "app/game/world.ts",
  "app/game/rust-historical-save-compatibility.ts", "app/game/rust-historical-save-persistence.ts",
  "app/game/rust-native-world-persistence.ts", "app/game/rust-integrated-runtime-bulk-platform.ts",
  "app/game/rust-integrated-runtime-service.ts", "app/game/rust-integrated-runtime-browser-worker.ts",
  "app/game/rust-integrated-runtime-worker.ts", "app/game/rust-integrated-runtime-adapter.ts",
  "engine/crates/blockwild-persistence/src/historical_external_descriptor.rs",
  "engine/crates/blockwild-engine/src/runtime.rs", "engine/crates/blockwild-wasm/src/integrated_runtime.rs",
  "app/game/engine.ts", "app/game/VoxelGame.tsx",
  "scripts/verify-rust-terrain-edit-reload-browser.mjs", "scripts/verify-rust-r3-old-save-browser.mjs",
]);
// Frozen current-generation identity constants, independently pinned by the R3 155-case certificate.
const CONTENT_HASH = "cc59903be77dfe30109d15bfaf0e3022";
const GENERATOR_HASH = "161eef7e34381d450067b7ebedbcb4e1";

function invariant(value, message) {
  if (!value) throw new Error(`R3 historical-save acceptance: ${message}`);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function equal(actual, expected, message) {
  invariant(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), message);
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function sourceSnapshot(repositoryRoot) {
  return SOURCE_GUARD_FILES.map(relativePath => {
    const bytes = readFileSync(path.join(repositoryRoot, relativePath));
    return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

/** Literal expectations deliberately do not call the production migration/normalization code. */
export function expectedHistoricalWorldOptions(generatorVersion) {
  invariant(generatorVersion === 16 || generatorVersion === 17, "unsupported historical fixture version");
  return {
    difficulty: "peaceful", dayLengthMinutes: 20, mobDensity: 0, butterflyDensity: 0,
    caveFrequency: 1, biomeScale: 1.35, resourceAbundance: 1, structures: true, weather: false,
    keepInventory: true, friendlyFire: false, sleepRule: "percentage", sleepPercentage: 50,
    enabledFactions: ["hobbits", "dwarves"],
    settlementPattern: generatorVersion === 16 ? "legacy-scattered-v1" : "heartlands-v2",
    settlementDensity: generatorVersion === 16 ? 1 : 1.25,
    settlementClustering: generatorVersion === 16 ? "regional" : "strong",
    roadCoverage: generatorVersion === 16 ? "regional" : "local",
    largeTownFrequency: generatorVersion === 16 ? "balanced" : "frequent", origin: { mode: "wilderness" },
  };
}
export function expectedHistoricalGenerationOptions(generatorVersion) {
  const options = expectedHistoricalWorldOptions(generatorVersion);
  return { profile: "world-below-v15", ...Object.fromEntries([
    "caveFrequency", "biomeScale", "resourceAbundance", "structures", "enabledFactions", "settlementPattern",
    "settlementDensity", "settlementClustering", "roadCoverage", "largeTownFrequency", "origin",
  ].map(key => [key, options[key]])) };
}
export function expectedHistoricalGenerationIdentity(generatorVersion) {
  const behavior = expectedHistoricalGenerationOptions(generatorVersion);
  delete behavior.origin;
  return { schemaVersion: 1, terrainContentHash: CONTENT_HASH, generatorHash: GENERATOR_HASH,
    generationOptionsJson: JSON.stringify(canonical(behavior)) };
}

export function readHistoricalSaveFixture(repositoryRoot, descriptor) {
  invariant(R3_OLD_SAVE_FIXTURES.includes(descriptor), "fixture is not from the fixed two-case acceptance set");
  const directory = path.join(repositoryRoot, FIXTURE_DIRECTORY); const filename = path.join(directory, descriptor.filename);
  for (const item of [directory, filename]) invariant(!lstatSync(item).isSymbolicLink(), "fixture path may not be a symbolic link");
  const relativeDirectory = path.relative(realpathSync(repositoryRoot), realpathSync(directory));
  invariant(relativeDirectory && !relativeDirectory.startsWith(`..${path.sep}`) && relativeDirectory !== ".."
    && !path.isAbsolute(relativeDirectory), "frozen fixture directory escaped the repository");
  invariant(path.dirname(realpathSync(filename)) === realpathSync(directory), "fixture escaped its frozen directory");
  const bytes = readFileSync(filename);
  invariant(bytes.length === descriptor.bytes && sha256(bytes) === descriptor.sha256, `${descriptor.id}: frozen source bytes changed`);
  const document = JSON.parse(bytes.toString("utf8")); const save = document.world?.save;
  invariant(document.format === "blockwild-world" && document.version === 1 && document.world?.version === 1,
    `${descriptor.id}: not the historical public export format`);
  invariant(save?.version === 2 && save.generatorVersion === descriptor.generatorVersion && save.generatorVersion < CURRENT_GENERATOR_VERSION,
    `${descriptor.id}: source is not genuinely older than the current generator`);
  invariant(save.generatorProfile === "world-below-v15" && save.seed === "WILDERNESS" && save.mode === "builder", "frozen source identity changed");
  if (descriptor.generatorVersion === 16) invariant(!Object.hasOwn(document.world.options, "settlementPattern"), "g16 must omit settlementPattern");
  else invariant(document.world.options.settlementPattern === "heartlands-v2", "g17 must retain its modern control");
  const edits = canonicalSavedEdits({ save });
  invariant(edits.count === 39 && edits.entries.some(entry => entry.type === 0) && edits.entries.some(entry => entry.type === 13),
    "historical edit witness is vacuous or incomplete");
  return Object.freeze({ descriptor, filename, document, edits,
    provenance: Object.freeze({ id: descriptor.id, path: `${FIXTURE_DIRECTORY}/${descriptor.filename}`,
      classification: "synthetic-historical-format-not-archived-user-save", sourceGeneratorVersion: save.generatorVersion,
      bytes: bytes.length, sha256: descriptor.sha256, editCount: edits.count, editSha256: edits.sha256 }) });
}

export function assertHistoricalStorageCheckpoint(snapshot, fixture, expectedWorldId, expectedMode = "builder") {
  const storage = snapshot?.historicalStorage; const document = storage?.document;
  invariant(storage?.catalogWorldCount === 1 && storage.activeWorldId === expectedWorldId && document?.metadata?.id === expectedWorldId,
    "world was reimported, duplicated, or replaced during the lifecycle");
  const save = document?.save;
  invariant(save?.version === 2 && save.generatorVersion === CURRENT_GENERATOR_VERSION
    && save.generatorProfile === "world-below-v15" && save.seed === "WILDERNESS" && save.mode === expectedMode
    && document.metadata.mode === expectedMode,
  "migrated save identity/profile/version mismatch");
  equal(document.options, expectedHistoricalWorldOptions(fixture.descriptor.generatorVersion), "migrated world options differ from the independent expectation");
  const identity = expectedHistoricalGenerationIdentity(fixture.descriptor.generatorVersion);
  equal(document.metadata.generationIdentity, identity, "stored generation identity was not freshly derived from the migrated inputs");
  equal(storage.catalogGenerationIdentity, identity, "catalog and document generation identities disagree");
  equal(document.importSource, {
    schemaVersion: 1,
    provenance: "uploaded-file-bytes",
    sourceFormat: "blockwild-world-export-v1",
    encoding: "utf-8",
    archiveWorldId: "blockwild-original-import-sources-v1",
    objectId: `sha256-${fixture.descriptor.sha256}`,
    rawSha256: fixture.descriptor.sha256,
    byteLength: fixture.descriptor.bytes,
  }, "local mirror lost its exact original-file archive identity");
  invariant(Number.isSafeInteger(storage.documentCanonicalByteLength) && storage.documentCanonicalByteLength > 0
    && /^[0-9a-f]{64}$/u.test(storage.documentCanonicalSha256),
  "local historical StoredWorld has no canonical byte/SHA-256 identity");
  const edits = canonicalSavedEdits({ save });
  invariant(edits.count === fixture.edits.count && edits.sha256 === fixture.edits.sha256, "old-save edit bytes were moved, dropped, added, or changed");
  equal(edits.entries, fixture.edits.entries, "canonical old-save edit records differ");
  return { generatorVersion: save.generatorVersion, generatorProfile: save.generatorProfile,
    mode: save.mode, options: document.options, generationIdentity: identity, editCount: edits.count, editSha256: edits.sha256 };
}

export function assertHistoricalNativeCheckpoint(snapshot, fixture, phase) {
  const persistence = snapshot?.runtime?.manager?.host?.nativePersistence;
  const head = persistence?.historicalHead;
  invariant(persistence?.state === "open" && head, `${phase}: exact native historical head is absent`);
  invariant(head.authorityClaim === R3_OLD_SAVE_AUTHORITY
    && head.authorityProfile === "typescript-historical-save-compatibility-v1"
    && head.nativePlayer === "off" && head.nativeRichState === "not-adopted",
  `${phase}: historical head drifted into R5/player or native-rich authority`);
  invariant(head.sourceSha256 === fixture.descriptor.sha256
    && head.sourceByteLength === fixture.descriptor.bytes,
  `${phase}: native descriptor lost the frozen raw archive identity`);
  invariant(head.documentSha256 === snapshot.historicalStorage.documentCanonicalSha256
    && head.documentByteLength === snapshot.historicalStorage.documentCanonicalByteLength,
  `${phase}: native external document differs from the canonical local mirror`);
  invariant(Number.isSafeInteger(head.documentRevision) && head.documentRevision >= 1
    && head.chunks === Math.ceil(head.documentByteLength / (4 * 1024 * 1024)),
  `${phase}: external document revision/chunk identity is invalid`);
  invariant(/^[0-9a-f]{32}$/u.test(head.descriptorHash)
    && /^[0-9a-f]{32}$/u.test(head.documentHash)
    && /^[0-9a-f]{32}$/u.test(head.chunkSetHash)
    && /^[0-9a-f]{32}$/u.test(head.projectionHash)
    && /^[0-9a-f]{32}$/u.test(head.checkpointHash)
    && typeof head.checkpointId === "string" && head.checkpointId.length > 0
    && Number.isSafeInteger(head.journalSequence) && head.journalSequence >= 1,
  `${phase}: native descriptor/checkpoint fingerprints are incomplete`);
  invariant(head.nativeWorldSemanticHash === head.projectionHash
    && head.projectionEditCount === fixture.edits.count
    && head.projectionFacingCount === Object.keys(fixture.document.world.save.blockFacings ?? {}).length,
  `${phase}: restarted Rust R4 readback differs from the admitted BWAS projection`);
  return {
    descriptorHash: head.descriptorHash,
    documentHash: head.documentHash,
    documentSha256: head.documentSha256,
    documentByteLength: head.documentByteLength,
    documentRevision: head.documentRevision,
    chunks: head.chunks,
    chunkSetHash: head.chunkSetHash,
    projectionHash: head.projectionHash,
    projectionEditCount: head.projectionEditCount,
    projectionFacingCount: head.projectionFacingCount,
    nativeWorldSemanticHash: head.nativeWorldSemanticHash,
    checkpointId: head.checkpointId,
    checkpointHash: head.checkpointHash,
    journalSequence: head.journalSequence,
    historicalMigrations: persistence.historicalMigrations,
    historicalSaves: persistence.historicalSaves,
    historicalRecoveries: persistence.historicalRecoveries,
  };
}

export function assertHistoricalWorkerInputs(snapshot, fixture) {
  const audit = snapshot?.audit; const requests = audit?.generationRequests; const results = audit?.generatedEdits;
  invariant(Array.isArray(requests) && Array.isArray(results), "real-worker historical observations are absent");
  const proof = [];
  for (const [key, entries] of Object.entries(fixture.document.world.save.edits)) {
    const edits = [...entries].sort((left, right) => left[0] - right[0]); const flat = edits.flat();
    const matches = requests.filter(request => request.seedText === "WILDERNESS" && request.key === key
      && JSON.stringify(request.edits) === JSON.stringify(flat));
    invariant(matches.length > 0, `no real Rust request carried the exact old edits for ${key}`);
    for (const request of matches) equal(request.generationOptions,
      expectedHistoricalGenerationOptions(fixture.descriptor.generatorVersion), "real worker received wrong migrated options/profile");
    const result = results.find(result => result.key === key && result.resultKey === key && result.seedText === "WILDERNESS"
      && result.requestHash === result.resultRequestHash && matches.some(request => request.requestHash === result.requestHash));
    invariant(result, `no real Rust result carries the matching edited request for ${key}`);
    equal(result.appliedEdits, edits, `Rust regenerated over a historical edit in ${key}`);
    proof.push({ key, requestHash: result.requestHash, editedCells: edits.length, exactAppliedEdits: true });
  }
  return proof;
}

function assertLiveHistoricalTerrain(snapshot) {
  assertRustTerrainCheckpoint(snapshot, REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH, "historical-live");
  const presentation = assessRustMultiplayerVisualTerrainReadiness(snapshot, "historical-live");
  invariant(presentation.ready, `historical live terrain is not drawable: ${JSON.stringify(presentation.reasons)}`);
  equal(snapshot.state?.target?.position, SENTINEL, "saved placed sentinel is not the actual live block target");
  invariant(snapshot.state.target.type === "block" && snapshot.state.target.name === "Glowstone", "live sentinel type changed");
  const ray = terrainRayCells(snapshot.state);
  const air = ray.cells.findIndex(cell => JSON.stringify(cell) === JSON.stringify(AIR_WITNESS));
  const solid = ray.cells.findIndex(cell => JSON.stringify(cell) === JSON.stringify(SENTINEL));
  invariant(air >= 0 && solid > air, "live ray did not traverse the historical Air cell before the placed sentinel");
}

export function assertHistoricalSaveScenarioEvidence(value, fixture) {
  const { emptyTitle, imported, firstPlaying, titleAfterSave, worldsAfterModeChange, titleAfterReload, continued } = value.checkpoints ?? {};
  invariant(emptyTitle?.historicalStorage?.catalogWorldCount === 0 && emptyTitle.historicalStorage.activeWorldId === null,
    "historical acceptance did not start in an empty isolated catalog");
  const worldId = fixture.document.world.metadata.id;
  const storage = [
    [imported, "builder"], [firstPlaying, "builder"], [titleAfterSave, "builder"],
    [worldsAfterModeChange, "survival"], [titleAfterReload, "survival"], [continued, "survival"],
  ].map(([snapshot, mode]) => assertHistoricalStorageCheckpoint(snapshot, fixture, worldId, mode));
  const firstToken = imported?.audit?.documentToken; const secondToken = titleAfterReload?.audit?.documentToken;
  invariant(typeof firstToken === "string" && firstToken.length > 0 && typeof secondToken === "string"
    && firstToken !== secondToken && emptyTitle.audit.documentToken === firstToken
    && firstPlaying.audit.documentToken === firstToken && titleAfterSave.audit.documentToken === firstToken
    && worldsAfterModeChange.audit.documentToken === firstToken
    && continued.audit.documentToken === secondToken, "hard reload/new document boundary is absent or inconsistent");
  for (const snapshot of [imported, firstPlaying, titleAfterSave, worldsAfterModeChange]) {
    equal(snapshot.audit.importClicks, [{ trusted: true }], "public IMPORT was not clicked exactly once");
    equal(snapshot.audit.imports, [{ name: fixture.descriptor.filename, bytes: fixture.descriptor.bytes, sha256: fixture.descriptor.sha256, error: null }],
      "public file upload differs from the frozen source or was repeated");
  }
  for (const snapshot of [emptyTitle, titleAfterReload, continued]) {
    equal(snapshot.audit.importClicks, [], "unexpected IMPORT click before import or after hard reload");
    equal(snapshot.audit.imports, [], "fixture was reseeded or reimported after hard reload");
  }
  invariant(titleAfterSave.state?.state === "title" && titleAfterReload.state?.state === "title", "save/reload did not pass through the real title");
  const expectedDialog = `Change “${fixture.document.world.metadata.name}” to Survival before its next load? World edits and inventory are preserved.`;
  const expectedNotice = `${fixture.document.world.metadata.name} will load in Survival. Inventory and world progress were preserved.`;
  invariant(value.modeEditorEvidence?.schema === 1
    && value.modeEditorEvidence.worldName === fixture.document.world.metadata.name
    && value.modeEditorEvidence.fromMode === "builder" && value.modeEditorEvidence.toMode === "survival"
    && value.modeEditorEvidence.dialogType === "confirm" && value.modeEditorEvidence.dialogMessage === expectedDialog
    && value.modeEditorEvidence.accepted === true && value.modeEditorEvidence.notice === expectedNotice,
  "historical offline mode edit lacks exact visible Worlds confirmation evidence");
  assertLiveHistoricalTerrain(firstPlaying); assertLiveHistoricalTerrain(continued);
  const firstNative = assertHistoricalNativeCheckpoint(firstPlaying, fixture, "historical-first-playing");
  const continuedNative = assertHistoricalNativeCheckpoint(continued, fixture, "historical-fresh-continue");
  invariant(firstNative.documentRevision === 1 && firstNative.historicalMigrations === 1
    && firstNative.historicalSaves === 0 && firstNative.historicalRecoveries === 0,
  "initial browser session did not establish exactly one Rust-bound historical migration head");
  invariant(continuedNative.documentRevision > firstNative.documentRevision
    && continuedNative.historicalMigrations === 0 && continuedNative.historicalSaves === 1
    && continuedNative.historicalRecoveries === 1
    && continuedNative.checkpointId !== firstNative.checkpointId,
  "fresh browser session did not recover the post-save native historical successor");
  invariant(titleAfterSave.historicalStorage.documentCanonicalSha256
    !== worldsAfterModeChange.historicalStorage.documentCanonicalSha256
    && worldsAfterModeChange.historicalStorage.documentCanonicalSha256
    === titleAfterReload.historicalStorage.documentCanonicalSha256
    && continuedNative.documentSha256 === titleAfterReload.historicalStorage.documentCanonicalSha256,
  "offline mode edit, hard reload, and Rust recovery do not agree on one external StoredWorld head");
  const workerInputs = assertHistoricalWorkerInputs(firstPlaying, fixture);
  const ray = proveReloadedTerrainRay(firstPlaying, continued, AIR_WITNESS);
  return { worldId, source: fixture.provenance, storage, native: { first: firstNative, continued: continuedNative }, workerInputs, ray,
    modeEdit: { from: "builder", to: "survival", persistedAcrossRestart: true },
    importCount: 1, hardReload: true, reimportedAfterReload: false, exactEditSetPreserved: true };
}

async function historicalSnapshot(harness, label, expectedState = null) {
  const snapshot = await harness.readAndRecord(label, expectedState);
  const historicalStorage = await harness.page.evaluate(async () => {
    const catalog = JSON.parse(localStorage.getItem("blockwild-world-catalog-v1") ?? "null");
    const activeWorldId = typeof catalog?.activeWorldId === "string" ? catalog.activeWorldId : null;
    const document = activeWorldId ? JSON.parse(localStorage.getItem(`blockwild-world-data-v1:${activeWorldId}`) ?? "null") : null;
    const metadata = catalog?.worlds?.find(world => world.id === activeWorldId);
    const canonical = value => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
      return value;
    };
    const canonicalBytes = document ? new TextEncoder().encode(JSON.stringify(canonical(document))) : null;
    const documentCanonicalSha256 = canonicalBytes
      ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", canonicalBytes)), value => value.toString(16).padStart(2, "0")).join("")
      : null;
    return { activeWorldId, catalogWorldCount: catalog?.worlds?.length ?? 0,
      catalogGenerationIdentity: metadata?.generationIdentity ?? null,
      documentCanonicalByteLength: canonicalBytes?.byteLength ?? null,
      documentCanonicalSha256,
      document: document ? { metadata: document.metadata, options: document.options, importSource: document.importSource, save: {
        version: document.save?.version, generatorVersion: document.save?.generatorVersion, generatorProfile: document.save?.generatorProfile,
        seed: document.save?.seed, mode: document.save?.mode, player: document.save?.player, edits: document.save?.edits,
      } } : null };
  });
  return { ...snapshot, historicalStorage };
}

export function assertHistoricalContinueNotRefused(observation) {
  const refusal = observation.notices.find(notice => /not eligible for world-only native migration|Native Rust recovery was blocked|protected browser world was not opened|rich save does not attest|rich save did not persist/u.test(notice));
  invariant(!refusal, `Historical Continue was refused by production: ${refusal}`);
}

async function waitForHistoricalGameplay(harness, label) {
  const deadline = Date.now() + harness.timeoutMilliseconds;
  while (Date.now() < deadline) {
    const snapshot = await harness.readAndRecord(label);
    // Enrich only the retained observation, never browser state or save bytes.
    snapshot.historicalContinue = { notices: await harness.page.getByRole("alert").allTextContents() };
    assertHistoricalContinueNotRefused(snapshot.historicalContinue);
    if (snapshot.state?.state === "playing") return harness.waitForGameplay(label);
    await harness.page.waitForTimeout(350);
  }
  throw new Error(`${label} did not enter gameplay; no historical acceptance was established.`);
}

async function runHistoricalScenario(harness, fixture) {
  const { page, timeoutMilliseconds } = harness; const checkpoints = {}; let modeEditorEvidence = null;
  const waitForTerrain = label => waitForRustMultiplayerVisualTerrainReadiness(page, timeoutMilliseconds, {
    label, failureStage: label, readSnapshot: () => harness.readAndRecord(label, "playing"),
  });
  await page.goto(`${harness.baseUrl}/`, { waitUntil: "domcontentloaded", timeout: timeoutMilliseconds });
  await harness.waitForHarness();
  // The empty catalog correctly disables Continue, unlike the post-save title.
  await page.getByRole("button", { name: /^Worlds\b/u }).waitFor();
  checkpoints.emptyTitle = await historicalSnapshot(harness, "empty-historical-title");
  invariant(checkpoints.emptyTitle.historicalStorage.catalogWorldCount === 0, "dedicated profile was not empty");
  await page.getByRole("button", { name: /^Worlds\b/u }).click();
  await page.getByRole("heading", { name: "Worlds", exact: true }).waitFor();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "IMPORT", exact: true }).click();
  await (await chooser).setFiles(fixture.filename);
  await page.getByRole("status").filter({ hasText: `Imported ${fixture.document.world.metadata.name} into this browser.` }).waitFor();
  await page.waitForFunction(hash => window.__blockwildTerrainEditReloadAudit?.imports?.[0]?.sha256 === hash,
    fixture.descriptor.sha256, { timeout: timeoutMilliseconds });
  checkpoints.imported = await historicalSnapshot(harness, "historical-imported");
  assertHistoricalStorageCheckpoint(checkpoints.imported, fixture, fixture.document.world.metadata.id);
  await page.getByRole("button", { name: /Main Menu$/u }).click();
  await page.getByRole("button", { name: /^Continue/u }).click({ noWaitAfter: true });
  await waitForHistoricalGameplay(harness, "historical-first-playing");
  const firstTerrainReadiness = await waitForTerrain("historical-first-drawable");
  await page.waitForFunction(position => {
    const state = JSON.parse(window.render_game_to_text());
    return state.target?.type === "block" && state.target.name === "Glowstone" && JSON.stringify(state.target.position) === JSON.stringify(position);
  }, SENTINEL, { timeout: timeoutMilliseconds });
  checkpoints.firstPlaying = await historicalSnapshot(harness, "historical-first-playing-settled", "playing");
  assertHistoricalWorkerInputs(checkpoints.firstPlaying, fixture);
  await harness.captureScreenshot("01-historical-imported-live");
  await page.getByRole("button", { name: "Pause game", exact: true }).click();
  await page.getByRole("heading", { name: "Game Paused" }).waitFor();
  await page.getByRole("button", { name: "Save & Quit to Title" }).click({ noWaitAfter: true });
  await harness.waitForTitleVisualReadiness();
  checkpoints.titleAfterSave = await historicalSnapshot(harness, "historical-title-after-save");
  await harness.captureScreenshot("02-historical-saved-title");
  await page.getByRole("button", { name: /^Worlds\b/u }).click();
  await page.getByRole("heading", { name: "Worlds", exact: true }).waitFor();
  const worldCard = page.locator("button.world-catalog-card").filter({ hasText: fixture.document.world.metadata.name });
  invariant(await worldCard.count() === 1, "Worlds UI did not expose the one imported historical world");
  await worldCard.click();
  const modeEditor = page.getByRole("region", { name: `Game mode for ${fixture.document.world.metadata.name}` });
  await modeEditor.waitFor({ state: "visible" });
  const survivalButton = modeEditor.getByRole("button", { name: /^SURVIVAL\b/u });
  invariant(await survivalButton.getAttribute("aria-pressed") === "false", "historical world did not begin in Builder mode");
  const dialogPromise = page.waitForEvent("dialog");
  const modeClickPromise = survivalButton.click({ noWaitAfter: true });
  const dialog = await dialogPromise;
  modeEditorEvidence = {
    schema: 1,
    worldName: fixture.document.world.metadata.name,
    fromMode: "builder",
    toMode: "survival",
    dialogType: dialog.type(),
    dialogMessage: dialog.message(),
    accepted: true,
    notice: `${fixture.document.world.metadata.name} will load in Survival. Inventory and world progress were preserved.`,
  };
  await dialog.accept();
  await modeClickPromise;
  await page.locator(".world-catalog-notice").filter({ hasText: modeEditorEvidence.notice }).waitFor({ state: "visible" });
  checkpoints.worldsAfterModeChange = await historicalSnapshot(harness, "historical-worlds-after-survival-mode");
  assertHistoricalStorageCheckpoint(checkpoints.worldsAfterModeChange, fixture, fixture.document.world.metadata.id, "survival");
  invariant(await survivalButton.getAttribute("aria-pressed") === "true", "Worlds UI did not retain the confirmed Survival mode");
  await harness.captureScreenshot("03-historical-offline-survival-mode");
  await page.getByRole("button", { name: /Main Menu$/u }).click();
  await harness.waitForTitleVisualReadiness();
  await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMilliseconds });
  await harness.waitForHarness();
  const titleVisualReadiness = await harness.waitForTitleVisualReadiness();
  checkpoints.titleAfterReload = await historicalSnapshot(harness, "historical-title-after-hard-reload");
  await harness.captureScreenshot("04-historical-fresh-title");
  await page.getByRole("button", { name: /^Continue/u }).click({ noWaitAfter: true });
  await waitForHistoricalGameplay(harness, "historical-fresh-continue");
  const continuedTerrainReadiness = await waitForTerrain("historical-continued-drawable");
  await page.waitForFunction(position => {
    const state = JSON.parse(window.render_game_to_text());
    return state.target?.type === "block" && state.target.name === "Glowstone" && JSON.stringify(state.target.position) === JSON.stringify(position);
  }, SENTINEL, { timeout: timeoutMilliseconds });
  checkpoints.continued = await historicalSnapshot(harness, "historical-fresh-continue-settled", "playing");
  const proof = assertHistoricalSaveScenarioEvidence({ checkpoints, modeEditorEvidence }, fixture);
  await harness.captureScreenshot("05-historical-continued-live");
  return { fixture: fixture.provenance, proof, checkpoints, titleVisualReadiness,
    terrainReadiness: { firstPlaying: firstTerrainReadiness, continued: continuedTerrainReadiness },
    exclusions: { fixture: "Synthetic historical-format fixture, not an archived user save.",
      authority: "No R5 player or R8 native persistence authority promotion.",
      remaining: "Generator-2 raw-key migration, rich-save native adoption, and formal R3 promotion review remain separate gates.",
      coveredSeparately: "Live terrain-cache eviction and IndexedDB rehydration are covered by the accepted canonical persistent-cache gate.",
      mutationSurface: "Public IMPORT, Save/Quit, Worlds mode editing with exact confirmation, hard reload, and Continue only; no engine/world mutation hooks or save seeding." } };
}

export function parseOldSaveBrowserOptions(argv = process.argv, context = {}) {
  const options = parseTerrainEditBrowserOptions(argv, context);
  if (!options.help) invariant(path.resolve(options.engineDirectory) === path.join(options.repositoryRoot, "public", "engine"),
    "historical-save acceptance requires canonical public/engine, never an alias candidate");
  return options;
}
function laneArguments(options, id) {
  const args = [process.execPath, "verify-rust-r3-old-save-browser.mjs", "--repo-root", options.repositoryRoot,
    "--engine-dir", "public/engine", "--expected-artifact-hash", REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH,
    "--output", path.join(options.outputDirectory, id), "--timeout-ms", String(options.timeoutMilliseconds)];
  if (!options.headless) args.push("--headed");
  if (options.playwrightModule) args.push("--playwright-module", options.playwrightModule);
  if (options.browserExecutable) args.push("--browser-executable", options.browserExecutable);
  return args;
}
export async function runOldSaveBrowser(argv = process.argv) {
  const options = parseOldSaveBrowserOptions(argv);
  if (options.help) return { help: true, usage: usage() };
  const fixtures = R3_OLD_SAVE_FIXTURES.map(descriptor => readHistoricalSaveFixture(options.repositoryRoot, descriptor));
  const sources = sourceSnapshot(options.repositoryRoot);
  if (existsSync(options.outputDirectory)) invariant(!lstatSync(options.outputDirectory).isSymbolicLink()
    && readdirSync(options.outputDirectory).length === 0, "output must be absent or empty");
  mkdirSync(options.outputDirectory, { recursive: true });
  const lanes = []; let error = null; let sourceFixturesUnchanged = false; let guardedSourcesUnchanged = false;
  try {
    for (const fixture of fixtures) {
      const result = await runManagedRustTerrainBrowserScenario(laneArguments(options, fixture.descriptor.id), {
        gate: R3_OLD_SAVE_GATE, authorityClaim: R3_OLD_SAVE_AUTHORITY, observeHistoricalSave: true,
        run: harness => runHistoricalScenario(harness, fixture),
      });
      lanes.push(result);
      assertTerrainEditCleanupEvidence(result.cleanup);
      assertTerrainEditBrowserErrorStreams(result.errors);
    }
  } catch (failure) { error = failure instanceof Error ? failure.stack ?? failure.message : String(failure); }
  try {
    for (const descriptor of R3_OLD_SAVE_FIXTURES) readHistoricalSaveFixture(options.repositoryRoot, descriptor);
    sourceFixturesUnchanged = true;
  } catch (failure) { error ??= failure instanceof Error ? failure.message : String(failure); }
  try {
    equal(sourceSnapshot(options.repositoryRoot), sources, "guarded application/verifier sources changed during acceptance");
    guardedSourcesUnchanged = true;
  } catch (failure) { error ??= failure instanceof Error ? failure.message : String(failure); }
  const passed = error === null && sourceFixturesUnchanged && guardedSourcesUnchanged
    && lanes.length === fixtures.length && lanes.every(lane => lane.status === "passed");
  const result = { schema: 1, gate: R3_OLD_SAVE_GATE, status: passed ? "passed" : "failed", createdAt: new Date().toISOString(),
    authorityClaim: passed ? R3_OLD_SAVE_AUTHORITY : "none", sourceFixturesUnchanged, guardedSourcesUnchanged, guardedSources: sources,
    fixtures: fixtures.map(fixture => fixture.provenance),
    lanes, error,
    coveredBySeparateGate: ["live-persistent-terrain-cache-evict-rehydrate"],
    remaining: ["g2-raw-key-migration", "rich-save-native-adoption", "formal-R3-promotion-review"] };
  const outputPath = path.join(options.outputDirectory, "result.json");
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return { ...result, outputPath };
}
export function usage() {
  return `Usage: node scripts/verify-rust-r3-old-save-browser.mjs --engine-dir public/engine --expected-artifact-hash ${REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH} --output work/rust-r3-old-saves [--repo-root .] [--timeout-ms 300000] [--headed]\nRuns both frozen synthetic g16/g17 exports through public Import, canonical Rust workers, Save/Quit, a confirmed offline Builder-to-Survival edit, hard reload and Continue. No R8 authority claim.\n`;
}
if (isDirectInvocation(import.meta.url)) {
  runOldSaveBrowser().then(result => {
    if (result.help) process.stdout.write(result.usage);
    else { process.stdout.write(`${JSON.stringify({ status: result.status, outputPath: result.outputPath })}\n`); if (result.status !== "passed") process.exitCode = 1; }
  }).catch(error => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
}
