import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test, { before } from "node:test";
import {
  assertHistoricalContinueNotRefused, assertHistoricalSaveScenarioEvidence, assertHistoricalStorageCheckpoint, assertHistoricalWorkerInputs,
  expectedHistoricalGenerationIdentity, expectedHistoricalGenerationOptions, expectedHistoricalWorldOptions,
  parseOldSaveBrowserOptions, R3_OLD_SAVE_FIXTURES, readHistoricalSaveFixture,
} from "../scripts/verify-rust-r3-old-save-browser.mjs";
import {
  REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH, runManagedRustTerrainBrowserScenario, TERRAIN_EDIT_GENERATION_CERTIFICATE,
} from "../scripts/verify-rust-terrain-edit-reload-browser.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtures = R3_OLD_SAVE_FIXTURES.map(descriptor => readHistoricalSaveFixture(repositoryRoot, descriptor));

// Output-path validation intentionally requires an existing work directory.
before(() => { mkdirSync(path.join(repositoryRoot, "work"), { recursive: true }); });

/** Synthetic validator data only. This never substitutes for browser execution. */
function snapshot(fixture, phase = "playing", documentToken = "first-document", imported = true) {
  const worldId = fixture.document.world.metadata.id;
  const options = expectedHistoricalWorldOptions(fixture.descriptor.generatorVersion);
  const identity = expectedHistoricalGenerationIdentity(fixture.descriptor.generatorVersion);
  const chunks = [-1, 0, 1].flatMap(x => [-1, 0, 1].map(z => ({ key: `${-8 + x},${-1 + z}`,
    offset: { x, z }, present: true, visible: true, lightReady: true, ready: true,
    requiredSections: [{ section: 6, ready: true, requiredLayers: ["opaque"], presentations: {
      opaque: { required: true, mode: "source", source: true, sourceVisible: true, combined: false, combinedVisible: false },
      cutout: { required: false, mode: null, source: false, sourceVisible: false, combined: false, combinedVisible: false },
    } }],
  })));
  const requests = Object.entries(fixture.document.world.save.edits).map(([key, entries], index) => ({
    epoch: 2, taskId: index + 1, key, seedText: "WILDERNESS", namespace: "synthetic-validator-only",
    requestHash: String(index + 1).repeat(32), generationOptions: expectedHistoricalGenerationOptions(fixture.descriptor.generatorVersion),
    edits: [...entries].sort((left, right) => left[0] - right[0]).flat(),
  }));
  return {
    state: { state: phase, player: { position: [-120, 40.51, -8], yaw: 0, pitch: 0, mode: "builder" },
      target: { type: "block", name: "Glowstone", position: [-120, 42, -10] },
      performance: { streaming: {
        playerChunk: "-8,-1", playerChunkReady: true, playerChunkStage: "ready", immediateRing: { desired: 9, ready: 9, ratio: 1 },
        generationWorker: { mode: "rust", selectionSource: "build-rust-primary", authorityRequired: true, state: "ready", supported: true,
          workers: 2, ready: 2, busy: 0, acceptingRequests: true, failed: 0, restarts: 0, rejected: 0 },
        terrainWorker: { supported: true, ready: true },
        playerTerrainPresentation: { schema: 1, epoch: 2, centerKey: "-8,-1", desired: 9, ready: 9, chunks },
      } } },
    runtime: { ready: true, activeWorldId: worldId, manager: { state: "ready", host: {
      artifactHash: REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH, adapter: { liveAuthorityReady: true },
    } } },
    storage: { activeWorldId: worldId },
    historicalStorage: { activeWorldId: worldId, catalogWorldCount: 1, catalogGenerationIdentity: identity,
      document: { metadata: { ...fixture.document.world.metadata, generationIdentity: identity }, options,
        save: { ...structuredClone(fixture.document.world.save), generatorVersion: 18 } } },
    audit: { documentToken,
      importClicks: imported ? [{ trusted: true }] : [],
      imports: imported ? [{ name: fixture.descriptor.filename, bytes: fixture.descriptor.bytes, sha256: fixture.descriptor.sha256, error: null }] : [],
      generationCertificates: [{ ...TERRAIN_EDIT_GENERATION_CERTIFICATE, byteEqual: true }],
      generationRequests: requests,
      generatedEdits: requests.map(request => ({ ...request, resultKey: request.key, resultRequestHash: request.requestHash,
        appliedEdits: request.edits.filter((_, index) => index % 2 === 0).map((cell, index) => [cell, request.edits[index * 2 + 1]]) })),
    },
  };
}
function evidence(fixture) {
  const empty = snapshot(fixture, "title", "first-document", false);
  empty.historicalStorage = { activeWorldId: null, catalogWorldCount: 0, catalogGenerationIdentity: null, document: null };
  return { checkpoints: {
    emptyTitle: empty, imported: snapshot(fixture, "title"), firstPlaying: snapshot(fixture), titleAfterSave: snapshot(fixture, "title"),
    titleAfterReload: snapshot(fixture, "title", "fresh-document", false), continued: snapshot(fixture, "playing", "fresh-document", false),
  } };
}

test("both frozen fixtures are genuinely old, nonvacuously edited, and explicitly synthetic", () => {
  assert.deepEqual(fixtures.map(fixture => fixture.document.world.save.generatorVersion), [16, 17]);
  for (const fixture of fixtures) {
    assert.equal(fixture.edits.count, 39);
    assert.match(fixture.provenance.classification, /synthetic.*not-archived/);
    assert.deepEqual([...new Set(fixture.edits.entries.map(entry => entry.chunkKey))].sort(), ["-8,-1", "-9,-1"]);
    assert.throws(() => readHistoricalSaveFixture(repositoryRoot, { ...fixture.descriptor, sha256: "0".repeat(64) }), /fixed two-case/);
  }
});

test("literal migration expectations distinguish omitted-g16 behavior from modern-g17 preservation", () => {
  assert.equal(Object.hasOwn(fixtures[0].document.world.options, "settlementPattern"), false);
  assert.equal(expectedHistoricalWorldOptions(16).settlementPattern, "legacy-scattered-v1");
  assert.equal(expectedHistoricalWorldOptions(17).settlementPattern, "heartlands-v2");
  assert.equal(expectedHistoricalWorldOptions(17).settlementDensity, 1.25);
  assert.equal(expectedHistoricalWorldOptions(17).roadCoverage, "local");
  assert.equal(Object.hasOwn(JSON.parse(expectedHistoricalGenerationIdentity(16).generationOptionsJson), "origin"), false);
  assert.throws(() => expectedHistoricalWorldOptions(18), /unsupported/);
});

for (const fixture of fixtures) test(`${fixture.descriptor.id}: complete synthetic lifecycle validates every checkpoint and real-worker witness`, () => {
  const proof = assertHistoricalSaveScenarioEvidence(evidence(fixture), fixture);
  assert.equal(proof.storage.length, 5); assert.equal(proof.importCount, 1); assert.equal(proof.hardReload, true);
  assert.equal(proof.workerInputs.reduce((sum, result) => sum + result.editedCells, 0), 39);
  assert.equal(proof.exactEditSetPreserved, true);
});

const mutations = [
  ["nonempty initial profile", value => { value.checkpoints.emptyTitle.historicalStorage.catalogWorldCount = 1; }],
  ["same-version fixture substitution", value => { value.checkpoints.imported.historicalStorage.document.save.generatorVersion = 17; }],
  ["legacy terrain profile misdispatch", value => { value.checkpoints.firstPlaying.historicalStorage.document.save.generatorProfile = "legacy-v14"; }],
  ["pre17 modern settlement default", value => { value.checkpoints.imported.historicalStorage.document.options.settlementPattern = "heartlands-v2"; }],
  ["catalog identity drift", value => { value.checkpoints.continued.historicalStorage.catalogGenerationIdentity.generatorHash = "0".repeat(32); }],
  ["missing preserved edit", value => { value.checkpoints.titleAfterSave.historicalStorage.document.save.edits["-8,-1"].pop(); }],
  ["regenerated edit value", value => { value.checkpoints.continued.historicalStorage.document.save.edits["-8,-1"][0][1] = 0; }],
  ["moved old edit index", value => { value.checkpoints.firstPlaying.historicalStorage.document.save.edits["-9,-1"][0][0] += 1; }],
  ["reimported world", value => { value.checkpoints.continued.historicalStorage.activeWorldId += "-2"; }],
  ["no hard reload", value => { value.checkpoints.titleAfterReload.audit.documentToken = "first-document"; }],
  ["reimport after reload", value => { value.checkpoints.continued.audit.importClicks.push({ trusted: true }); }],
  ["untrusted import click", value => { value.checkpoints.imported.audit.importClicks[0].trusted = false; }],
  ["changed uploaded file", value => { value.checkpoints.imported.audit.imports[0].sha256 = "0".repeat(64); }],
  ["duplicate upload", value => { value.checkpoints.firstPlaying.audit.imports.push(value.checkpoints.firstPlaying.audit.imports[0]); }],
  ["wrong worker generation options", value => { value.checkpoints.firstPlaying.audit.generationRequests[0].generationOptions.settlementPattern = "heartlands-v2"; }],
  ["no worker edit request", value => { value.checkpoints.firstPlaying.audit.generationRequests = []; }],
  ["worker silently regenerated edit", value => { value.checkpoints.firstPlaying.audit.generatedEdits[0].appliedEdits[0][1] = 0; }],
  ["worker result request mismatch", value => { value.checkpoints.firstPlaying.audit.generatedEdits[0].resultRequestHash = "0".repeat(32); }],
  ["TypeScript fallback", value => { value.checkpoints.continued.state.performance.streaming.generationWorker.mode = "typescript"; }],
  ["worker recovery", value => { value.checkpoints.firstPlaying.state.performance.streaming.generationWorker.restarts = 1; }],
  ["wrong canonical artifact", value => { value.checkpoints.continued.runtime.manager.host.artifactHash = "0".repeat(64); }],
  ["unready immediate ring", value => { value.checkpoints.continued.state.performance.streaming.immediateRing.ready = 8; }],
  ["missing drawable source", value => { value.checkpoints.continued.state.performance.streaming.playerTerrainPresentation.chunks[0].requiredSections[0].presentations.opaque.sourceVisible = false; }],
  ["live placed edit missing", value => { value.checkpoints.continued.state.target.position[2] = -11; }],
  ["wrong live block type", value => { value.checkpoints.firstPlaying.state.target.name = "Stone"; }],
  ["pose discontinuity", value => { value.checkpoints.continued.state.player.position[0] += 0.1; }],
];
for (const [name, mutate] of mutations) test(`historical evidence rejects ${name}`, () => {
  const fixture = fixtures[0]; const value = evidence(fixture); mutate(value);
  assert.throws(() => assertHistoricalSaveScenarioEvidence(value, fixture));
});

test("g17 control rejects unwanted migration to legacy settlement options", () => {
  const fixture = fixtures[1]; const value = snapshot(fixture);
  value.historicalStorage.document.options.settlementPattern = "legacy-scattered-v1";
  assert.throws(() => assertHistoricalStorageCheckpoint(value, fixture, fixture.document.world.metadata.id), /world options/);
});

test("worker request and applied result comparison is exact, not only a cell count", () => {
  const fixture = fixtures[0]; const value = snapshot(fixture);
  value.audit.generationRequests[1].edits[0] += 256;
  assert.throws(() => assertHistoricalWorkerInputs(value, fixture), /exact old edits/);
});

test("historical runner requires canonical artifact and has no arbitrary scenario CLI selector", async () => {
  const args = [process.execPath, "old-save", "--repo-root", repositoryRoot, "--engine-dir", "public/engine",
    "--expected-artifact-hash", REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH, "--output", "work/old-save-validator-only"];
  assert.equal(parseOldSaveBrowserOptions(args).engineDirectory, path.join(repositoryRoot, "public", "engine"));
  const alternate = [...args]; alternate[5] = "public/engine-locator-candidate";
  assert.throws(() => parseOldSaveBrowserOptions(alternate), /canonical/);
  assert.throws(() => parseOldSaveBrowserOptions([...args, "--scenario", "untrusted.mjs"]), /Unknown option/);
  await assert.rejects(runManagedRustTerrainBrowserScenario(args, { gate: "invalid", run() {} }), /explicit gate/);
});

test("historical Continue captures production migration refusals as failures, never acceptance", () => {
  for (const notice of [
    "This protected compatibility save is not eligible for world-only native migration: player, runtime-clocks, gameplay, machines",
    "Native Rust recovery was blocked: no checkpoint could hydrate",
    "The live Rust worker has no native browser persistence session; the protected browser world was not opened.",
    "rich save does not attest the stable character actor that owns it",
    "rich save did not persist native player velocity",
  ]) assert.throws(() => assertHistoricalContinueNotRefused({ notices: [notice] }),
    error => error.message.includes("Continue was refused by production") && error.message.includes(notice));
  assert.doesNotThrow(() => assertHistoricalContinueNotRefused({ notices: [] }));
  assert.doesNotThrow(() => assertHistoricalContinueNotRefused({ notices: ["Imported R3 Synthetic Generator 16 into this browser."] }));
});

test("historical UI locator includes the Worlds saved-count accessible description", () => {
  const source = readFileSync(new URL("../scripts/verify-rust-r3-old-save-browser.mjs", import.meta.url), "utf8");
  assert.equal(source.split('getByRole("button", { name: /^Worlds\\b/u })').length - 1, 2);
  assert.ok(!source.includes('getByRole("button", { name: "Worlds", exact: true })'));
  assert.match(source, /snapshot\.historicalContinue = \{ notices: await harness\.page\.getByRole\("alert"\)\.allTextContents\(\) \}/);
  assert.match(source, /if \(snapshot\.state\?\.state === "playing"\) return harness\.waitForGameplay\(label\)/);
});

test("shared managed seam preserves default flow and mandatory final cleanup/provenance", () => {
  const shared = readFileSync(new URL("../scripts/verify-rust-terrain-edit-reload-browser.mjs", import.meta.url), "utf8");
  assert.match(shared, /function installBrowserAudit\(context, observeHistoricalSave = false\)/);
  assert.match(shared, /runTerrainEditReloadBrowser\(argv = process\.argv, scenario = null\)/);
  assert.match(shared, /const payload = await scenario\.run\(/);
  assert.match(shared, /assertRustTerrainCheckpoint\(lastSnapshot, options\.expectedArtifactHash, "managed-scenario-complete"\)/);
  assert.match(shared, /return postMessage\(\.\.\.arguments_\)/);
  assert.match(shared, /const created = await waitForGameplay\("create-ready"\)/);
  assert.match(shared, /const persistence = assertTerrainEditPersistenceEvidence\(/);
  assert.match(shared, /assertTerrainEditCandidateUnchanged\(selection\)/);
  assert.match(shared, /assertTerrainEditCleanupEvidence\(cleanup\)/);
  assert.match(shared, /assertTerrainEditBrowserErrorStreams\(streams\)/);
  const source = readFileSync(new URL("../scripts/verify-rust-r3-old-save-browser.mjs", import.meta.url), "utf8");
  assert.match(source, /waitForEvent\("filechooser"\)/); assert.match(source, /\.setFiles\(fixture\.filename\)/);
  assert.match(source, /await page\.reload\(/); assert.match(source, /runManagedRustTerrainBrowserScenario\(/);
  assert.doesNotMatch(source, /localStorage\.setItem|sessionStorage\.setItem|migrateLegacyWorldSave|new ChunkWorld|prime.*Audit|advanceTime\(/);
});

test("optional historical worker observer delegates unchanged and snapshots transferred inputs", () => {
  const source = readFileSync(new URL("../scripts/verify-rust-terrain-edit-reload-browser.mjs", import.meta.url), "utf8");
  const observer = source.slice(source.indexOf("function installBrowserAudit("), source.indexOf("function assertTrustedPlayerGesture("));
  class NativeWorker {
    listeners = [];
    addEventListener(type, listener) { if (type === "message") this.listeners.push(listener); }
    postMessage(...args) { this.sent = args; return "native-delegation"; }
    emit(data) { for (const listener of this.listeners) listener({ data }); }
  }
  const create = historical => {
    const window = { Worker: NativeWorker };
    runInNewContext(`${observer}; installBrowserAudit({ addInitScript: (callback, flag) => callback(flag) }, historical);`, {
      window, historical, document: { addEventListener() {} }, crypto: { randomUUID: () => "synthetic-document" }, structuredClone,
    });
    return window;
  };
  const ordinary = create(false); const ordinaryWorker = new ordinary.Worker();
  assert.equal(Object.hasOwn(ordinaryWorker, "postMessage"), false, "default verifier must retain the original worker postMessage");
  assert.equal(Object.hasOwn(ordinary.__blockwildTerrainEditReloadAudit, "generationRequests"), false);
  const observed = create(true); const worker = new observed.Worker();
  const request = { epoch: 2, taskId: 3, key: "-8,-1", seedText: "WILDERNESS", namespace: "synthetic-unit-only", requestHash: "x",
    generationOptions: { profile: "world-below-v15", settlementPattern: "legacy-scattered-v1" }, edits: new Uint32Array([3, 0, 9, 13]) };
  const message = { type: "generate-chunk-v2", request }; const transfer = [request.edits.buffer];
  assert.equal(worker.postMessage(message, transfer), "native-delegation");
  assert.equal(worker.sent[0], message); assert.equal(worker.sent[1], transfer);
  request.edits.fill(999);
  const blocks = new Uint16Array(10); blocks[9] = 13;
  const response = { type: "generated-chunk-v2", epoch: 2, taskId: 3, result: { key: "-8,-1", requestHash: "x", blocks } };
  worker.emit(response);
  const audit = JSON.parse(JSON.stringify(observed.__blockwildTerrainEditReloadAudit));
  assert.deepEqual(audit.generationRequests[0].edits, [3, 0, 9, 13]);
  assert.deepEqual(audit.generatedEdits[0].appliedEdits, [[3, 0], [9, 13]]);
  assert.equal(response.result.blocks, blocks); assert.equal(response.result.blocks[9], 13);
});
