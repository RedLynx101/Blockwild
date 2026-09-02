import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertNearLimitSelectionUnchanged,
  createNearLimitEngineRoutePlugin,
  NEAR_LIMIT_ENGINE_DIRECTORY_ENV,
  NEAR_LIMIT_EXPECTED_ARTIFACT_HASH_ENV,
  REQUIRED_NEAR_LIMIT_ARTIFACT_HASH,
  selectNearLimitRustEngineArtifact,
  selectNearLimitRustEngineCandidate,
  selectedNearLimitEngineRoute,
} from "./helpers/rust-native-persistence-near-limit-selection.mjs";
import { createRustEngineCandidateFixture } from "./helpers/rust-engine-candidate-fixture.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const VALID_ENVIRONMENT = Object.freeze({
  [NEAR_LIMIT_ENGINE_DIRECTORY_ENV]: "public/engine-locator-candidate",
  [NEAR_LIMIT_EXPECTED_ARTIFACT_HASH_ENV]: REQUIRED_NEAR_LIMIT_ARTIFACT_HASH,
});

test("near-limit browser acceptance requires an explicit isolated engine selection and exact hash", () => {
  assert.throws(
    () => selectNearLimitRustEngineArtifact(ROOT, {}),
    new RegExp(`${NEAR_LIMIT_ENGINE_DIRECTORY_ENV} is required`, "u"),
  );
  assert.throws(
    () => selectNearLimitRustEngineArtifact(ROOT, {
      [NEAR_LIMIT_ENGINE_DIRECTORY_ENV]: VALID_ENVIRONMENT[NEAR_LIMIT_ENGINE_DIRECTORY_ENV],
      [NEAR_LIMIT_EXPECTED_ARTIFACT_HASH_ENV]: "0".repeat(64),
    }),
    new RegExp(`${NEAR_LIMIT_EXPECTED_ARTIFACT_HASH_ENV} must explicitly equal ${REQUIRED_NEAR_LIMIT_ARTIFACT_HASH}`, "u"),
  );
  assert.throws(
    () => selectNearLimitRustEngineArtifact(ROOT, {
      ...VALID_ENVIRONMENT,
      [NEAR_LIMIT_ENGINE_DIRECTORY_ENV]: "public/engine",
    }),
    /must resolve exactly to public\/engine-locator-candidate/u,
  );
});

test("near-limit selection validates current-source provenance and exposes only immutable candidate routes", (t) => {
  const fixture = createRustEngineCandidateFixture(t);
  const selection = selectNearLimitRustEngineCandidate(fixture.root, "public/engine-locator-candidate", fixture.hash);
  assert.equal(selection.relativeDirectory, "public/engine-locator-candidate");
  assert.equal(selection.variant, "compatibility");
  assert.equal(selection.hash, fixture.hash);
  assert.deepEqual(selection.provenance.sourceSnapshot, selection.sourceSnapshot);
  assert.deepEqual(selection.sourceSnapshot, fixture.sourceSnapshot);
  assert.ok(selection.provenance.fileCount >= 2);
  assert.ok(selection.provenance.rawBytes > 0);
  assert.equal(selection.treeSnapshot.fileCount, selection.provenance.fileCount + 2);
  assert.equal(selection.treeSnapshot.directoryCount, 1);

  const index = selectedNearLimitEngineRoute(selection, "/engine/manifest.json");
  const wasm = selectedNearLimitEngineRoute(
    selection,
    `/engine/${fixture.hash}/engine_bg.wasm?cache=ignored`,
  );
  assert.ok(index);
  assert.equal(index.contentType, "application/json; charset=utf-8");
  assert.equal(index.immutable, false);
  assert.ok(wasm);
  assert.equal(wasm.contentType, "application/wasm");
  assert.equal(wasm.immutable, true);
  assert.equal(selectedNearLimitEngineRoute(selection, "/engine/not-selected/engine.js"), null);
  assert.equal(selectedNearLimitEngineRoute(selection, "/engine/%2e%2e/manifest.json"), null);
  assert.equal(selectedNearLimitEngineRoute(selection, "/engine/hash/../manifest.json"), null);

  const unchanged = assertNearLimitSelectionUnchanged(selection);
  assert.deepEqual(unchanged.treeSnapshot, selection.treeSnapshot);
  assert.deepEqual(unchanged.sourceSnapshot, selection.sourceSnapshot);
  const plugin = createNearLimitEngineRoutePlugin(selection);
  assert.equal(plugin.name, "blockwild-near-limit-selected-engine");
  assert.equal(plugin.enforce, "pre");
  assert.equal(typeof plugin.configureServer, "function");
});

test("near-limit route middleware serves the candidate at /engine and fails closed elsewhere", async (t) => {
  const fixture = createRustEngineCandidateFixture(t);
  const selection = selectNearLimitRustEngineCandidate(fixture.root, "public/engine-locator-candidate", fixture.hash);
  const records = [];
  const plugin = createNearLimitEngineRoutePlugin(selection, (record) => records.push(record));
  let middleware;
  plugin.configureServer({ middlewares: { use: (candidate) => { middleware = candidate; } } });
  assert.equal(typeof middleware, "function");

  const invoke = (url, method = "HEAD") => new Promise((resolve, reject) => {
    const headers = new Map();
    let nextCalled = false;
    const response = {
      statusCode: 0,
      setHeader: (name, value) => headers.set(name.toLowerCase(), String(value)),
      end: () => resolve({ status: response.statusCode, headers, nextCalled }),
      destroy: reject,
    };
    middleware({ url, method }, response, () => {
      nextCalled = true;
      resolve({ status: null, headers, nextCalled });
    });
  });

  const index = await invoke("/engine/manifest.json");
  assert.equal(index.status, 200);
  assert.equal(index.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(index.headers.get("cache-control"), "no-store");
  const unknown = await invoke("/engine/not-the-selected-hash/engine.js");
  assert.equal(unknown.status, 404);
  const traversal = await invoke("/engine/%2e%2e/manifest.json");
  assert.equal(traversal.status, 400);
  const application = await invoke("/app/game/world.ts");
  assert.equal(application.nextCalled, true);
  const corrupted = readFileSync(fixture.wasmPath); corrupted[0] ^= 1; writeFileSync(fixture.wasmPath, corrupted);
  const changedArtifact = await invoke(`/engine/${fixture.hash}/engine_bg.wasm`);
  assert.equal(changedArtifact.status, 500, "same-size byte corruption must fail route integrity checks");
  assert.deepEqual(records.map(({ status }) => status), [200, 404, 400, 500]);
});

test("near-limit reusable selection rejects hash mismatch while the environment wrapper retains its historical pin", (t) => {
  const fixture = createRustEngineCandidateFixture(t);
  assert.throws(() => selectNearLimitRustEngineCandidate(fixture.root, "public/engine-locator-candidate", "0".repeat(64)), /does not equal required hash/u);
  assert.throws(() => selectNearLimitRustEngineCandidate(fixture.root, "public/engine", fixture.hash), /must resolve exactly/u);
  for (const invalid of [undefined, "", "A".repeat(64), "0".repeat(63), { toString: () => fixture.hash }]) {
    assert.throws(() => selectNearLimitRustEngineCandidate(fixture.root, "public/engine-locator-candidate", invalid), /explicit lowercase SHA-256/u);
  }
  assert.throws(() => selectNearLimitRustEngineArtifact(fixture.root, {
    [NEAR_LIMIT_ENGINE_DIRECTORY_ENV]: "public/engine-locator-candidate",
    [NEAR_LIMIT_EXPECTED_ARTIFACT_HASH_ENV]: fixture.hash,
  }), /must explicitly equal/u);
});

test("near-limit selection rejects source drift, corrupted files and invalid provenance", async (t) => {
  for (const [name, mutate, pattern] of [
    ["source drift", (fixture) => writeFileSync(fixture.sourcePath, "pub fn changed_source() {}\n"), /not current-source/u],
    ["payload corruption", (fixture) => {
      const bytes = readFileSync(fixture.wasmPath); bytes[0] ^= 1; writeFileSync(fixture.wasmPath, bytes);
    }, /checksum or size mismatch/u],
    ["build provenance", (fixture) => {
      const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")); manifest.cargoProfile = "debug";
      writeFileSync(fixture.manifestPath, JSON.stringify(manifest));
    }, /build provenance/u],
    ["source provenance", (fixture) => {
      const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")); manifest.sourceSnapshot.digest = "0".repeat(64);
      writeFileSync(fixture.manifestPath, JSON.stringify(manifest));
    }, /not current-source/u],
  ]) await t.test(name, (child) => {
    const fixture = createRustEngineCandidateFixture(child); mutate(fixture);
    assert.throws(() => selectNearLimitRustEngineCandidate(fixture.root, "public/engine-locator-candidate", fixture.hash), pattern);
  });
});

test("near-limit unchanged guard rejects source and artifact-tree mutation after selection", async (t) => {
  for (const [name, mutate, pattern] of [
    ["source", (fixture) => writeFileSync(fixture.sourcePath, "pub fn changed_source() {}\n"), /source changed/u],
    ["artifact tree", (fixture) => writeFileSync(path.join(fixture.artifactDirectory, "unexpected.bin"), "unexpected"), /artifact tree changed/u],
  ]) await t.test(name, (child) => {
    const fixture = createRustEngineCandidateFixture(child);
    const selection = selectNearLimitRustEngineCandidate(fixture.root, "public/engine-locator-candidate", fixture.hash);
    mutate(fixture);
    assert.throws(() => assertNearLimitSelectionUnchanged(selection), pattern);
  });
});
