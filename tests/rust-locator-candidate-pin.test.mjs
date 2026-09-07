import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  R11_LOCATOR_CANDIDATE_ARTIFACT_HASH,
  R11_LOCATOR_CANDIDATE_SOURCE_DIGEST,
  R11_LOCATOR_CANDIDATE_SOURCE_FILE_COUNT,
  R11_LOCATOR_CANDIDATE_WASM_BYTES,
  R11_LOCATOR_CANDIDATE_WASM_SHA256,
  R13_BROWSER_CANDIDATE_ARTIFACT_HASH,
  R13_BROWSER_CANDIDATE_SOURCE_DIGEST,
  R13_BROWSER_CANDIDATE_SOURCE_FILE_COUNT,
  R13_BROWSER_CANDIDATE_WASM_BYTES,
  R13_BROWSER_CANDIDATE_WASM_SHA256,
  REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH,
  REQUIRED_TERRAIN_EDIT_SOURCE_DIGEST,
  REQUIRED_TERRAIN_EDIT_SOURCE_FILE_COUNT,
  REQUIRED_TERRAIN_EDIT_WASM_BYTES,
  REQUIRED_TERRAIN_EDIT_WASM_SHA256,
  R7_SCHEMA_CANDIDATE_ARTIFACT_HASH,
  assertTerrainEditCandidateExactPins,
  selectTerrainEditCandidate,
} from "../scripts/verify-rust-terrain-edit-reload-browser.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

test("R11 locator pin remains exact but is stale after the R13 post-freeze source", () => {
  assert.throws(
    () => selectTerrainEditCandidate(
      repositoryRoot,
      "public/engine-locator-candidate",
      R11_LOCATOR_CANDIDATE_ARTIFACT_HASH,
    ),
    /Selected artifact is not current-source/u,
  );
  assert.deepEqual({
    sourceDigest: R11_LOCATOR_CANDIDATE_SOURCE_DIGEST,
    sourceFileCount: R11_LOCATOR_CANDIDATE_SOURCE_FILE_COUNT,
    wasmBytes: R11_LOCATOR_CANDIDATE_WASM_BYTES,
    wasmSha256: R11_LOCATOR_CANDIDATE_WASM_SHA256,
  }, {
    sourceDigest: "b5821d1e8b0340c15e5b31f164258e982ec8b0a95eb8bdfa4370c0001ef82859",
    sourceFileCount: 231,
    wasmBytes: 7_675_588,
    wasmSha256: "993da56ceb1e940df62a2478fb373a62b52ae96ab00e748e94c893afb6a4c7fa",
  });
});

test("locator candidate rejects a canonical or schema artifact hash", () => {
  assert.throws(
    () => selectTerrainEditCandidate(repositoryRoot, "public/engine-locator-candidate", REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH),
    new RegExp(`requires exact artifact ${R11_LOCATOR_CANDIDATE_ARTIFACT_HASH}`),
  );
  assert.throws(
    () => selectTerrainEditCandidate(repositoryRoot, "public/engine-locator-candidate", R7_SCHEMA_CANDIDATE_ARTIFACT_HASH),
    new RegExp(`requires exact artifact ${R11_LOCATOR_CANDIDATE_ARTIFACT_HASH}`),
  );
});

test("locator candidate rejects wrong source provenance and wrong Wasm metadata", () => {
  const base = {
    relativeDirectory: "public/engine-locator-candidate",
    expectedArtifactHash: R11_LOCATOR_CANDIDATE_ARTIFACT_HASH,
    currentSourceSnapshot: {
      schema: 1,
      digest: R11_LOCATOR_CANDIDATE_SOURCE_DIGEST,
      fileCount: R11_LOCATOR_CANDIDATE_SOURCE_FILE_COUNT,
    },
    manifest: {
      artifactHash: R11_LOCATOR_CANDIDATE_ARTIFACT_HASH,
      variant: "compatibility",
      package: "blockwild-wasm",
      target: "wasm32-unknown-unknown",
      cargoProfile: "release",
      files: [{
        path: "engine_bg.wasm",
        role: "wasm",
        bytes: R11_LOCATOR_CANDIDATE_WASM_BYTES,
        sha256: R11_LOCATOR_CANDIDATE_WASM_SHA256,
      }],
    },
  };
  assert.throws(() => assertTerrainEditCandidateExactPins({
    ...base,
    sourceSnapshot: {
      schema: 1,
      digest: REQUIRED_TERRAIN_EDIT_SOURCE_DIGEST,
      fileCount: REQUIRED_TERRAIN_EDIT_SOURCE_FILE_COUNT,
    },
  }), /Selected artifact is not current-source/u);
  assert.throws(() => assertTerrainEditCandidateExactPins({
    ...base,
    sourceSnapshot: base.currentSourceSnapshot,
    manifest: {
      ...base.manifest,
      files: [{ ...base.manifest.files[0], sha256: REQUIRED_TERRAIN_EDIT_WASM_SHA256, bytes: REQUIRED_TERRAIN_EDIT_WASM_BYTES }],
    },
  }), new RegExp(`exact required Wasm ${R11_LOCATOR_CANDIDATE_WASM_SHA256}/${R11_LOCATOR_CANDIDATE_WASM_BYTES}`));
});

test("R13 browser candidate selects its exact post-freeze pin", () => {
  const selection = selectTerrainEditCandidate(
    repositoryRoot,
    "public/engine-r11-browser-candidate",
    R13_BROWSER_CANDIDATE_ARTIFACT_HASH,
  );
  assert.equal(selection.relativeDirectory, "public/engine-r11-browser-candidate");
  assert.equal(selection.hash, R13_BROWSER_CANDIDATE_ARTIFACT_HASH);
  assert.deepEqual(selection.sourceSnapshot, {
    schema: 1,
    digest: R13_BROWSER_CANDIDATE_SOURCE_DIGEST,
    fileCount: R13_BROWSER_CANDIDATE_SOURCE_FILE_COUNT,
  });
  assert.deepEqual(selection.wasm, {
    path: "engine_bg.wasm",
    bytes: R13_BROWSER_CANDIDATE_WASM_BYTES,
    sha256: R13_BROWSER_CANDIDATE_WASM_SHA256,
  });
});

test("R13 browser candidate rejects wrong artifact, source, and Wasm pins", () => {
  assert.throws(
    () => selectTerrainEditCandidate(repositoryRoot, "public/engine-r11-browser-candidate", R11_LOCATOR_CANDIDATE_ARTIFACT_HASH),
    new RegExp(`requires exact artifact ${R13_BROWSER_CANDIDATE_ARTIFACT_HASH}`),
  );
  const base = {
    relativeDirectory: "public/engine-r11-browser-candidate",
    expectedArtifactHash: R13_BROWSER_CANDIDATE_ARTIFACT_HASH,
    currentSourceSnapshot: {
      schema: 1,
      digest: R13_BROWSER_CANDIDATE_SOURCE_DIGEST,
      fileCount: R13_BROWSER_CANDIDATE_SOURCE_FILE_COUNT,
    },
    sourceSnapshot: {
      schema: 1,
      digest: R13_BROWSER_CANDIDATE_SOURCE_DIGEST,
      fileCount: R13_BROWSER_CANDIDATE_SOURCE_FILE_COUNT,
    },
    manifest: {
      artifactHash: R13_BROWSER_CANDIDATE_ARTIFACT_HASH,
      variant: "compatibility",
      package: "blockwild-wasm",
      target: "wasm32-unknown-unknown",
      cargoProfile: "release",
      files: [{
        path: "engine_bg.wasm",
        role: "wasm",
        bytes: R13_BROWSER_CANDIDATE_WASM_BYTES,
        sha256: R13_BROWSER_CANDIDATE_WASM_SHA256,
      }],
    },
  };
  assert.throws(() => assertTerrainEditCandidateExactPins({
    ...base,
    sourceSnapshot: { schema: 1, digest: R11_LOCATOR_CANDIDATE_SOURCE_DIGEST, fileCount: R11_LOCATOR_CANDIDATE_SOURCE_FILE_COUNT },
  }), /Selected artifact is not current-source/u);
  assert.throws(() => assertTerrainEditCandidateExactPins({
    ...base,
    manifest: {
      ...base.manifest,
      files: [{ ...base.manifest.files[0], bytes: R11_LOCATOR_CANDIDATE_WASM_BYTES, sha256: R11_LOCATOR_CANDIDATE_WASM_SHA256 }],
    },
  }), new RegExp(`exact required Wasm ${R13_BROWSER_CANDIDATE_WASM_SHA256}/${R13_BROWSER_CANDIDATE_WASM_BYTES}`));
  for (const directory of [
    "public/engine-r11-browser-candidate-other",
    "public/engine-r11-browser-candidate/../engine",
    "public",
  ]) {
    assert.throws(
      () => selectTerrainEditCandidate(repositoryRoot, directory, R13_BROWSER_CANDIDATE_ARTIFACT_HASH),
      directory.includes("..") ? /traversal segments/u : /must resolve exactly/u,
    );
  }
});
