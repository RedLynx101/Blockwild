import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  contentAddressForFiles,
  describeArtifactFiles,
} from "../scripts/rust-engine-common.mjs";
import {
  R3_LANDSCAPE_HARNESS_HTML,
  R3_RENDERER_PARITY_MAX_MAE,
  R3_RENDERER_PARITY_MAX_RMSE,
  R3_THREE_ORACLE_BROWSER_ENTRY,
  buildThreeExtractionOracleBundleR3,
  isR3RendererPixelParityWithinBounds,
  linearRgb8FromSrgbHexR3,
  parseR3LandscapeConfiguration,
  resolveR3LandscapeMode,
  resolveR3LandscapeOutputDirectory,
  skyOnlyVertexLightsR3,
  validateR3LandscapeCases,
} from "../scripts/verify-rust-generation-landscapes-r3.ts";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const temporaryRoot = path.resolve(os.tmpdir());
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${temporaryRoot}${path.sep}`));
    rmSync(resolved, { recursive: true, force: true });
  }
});

function temporaryDirectory(label) {
  const directory = mkdtempSync(path.join(os.tmpdir(), `blockwild-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createArtifactRoot(repositoryRoot, relativeRoot = "public/engine") {
  const root = path.join(repositoryRoot, ...relativeRoot.split("/"));
  const staging = path.join(root, "staging");
  mkdirSync(staging, { recursive: true });
  writeFileSync(path.join(staging, "engine.js"), "export default async () => {};\n");
  writeFileSync(path.join(staging, "engine_bg.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  const files = describeArtifactFiles(staging);
  const hash = contentAddressForFiles(files);
  const directory = path.join(root, hash);
  renameSync(staging, directory);
  writeJson(path.join(directory, "manifest.json"), {
    schema: 1,
    artifactHash: hash,
    variant: "compatibility",
    sourceSnapshot: { schema: 1, digest: "c".repeat(64), fileCount: 4 },
    files,
  });
  writeJson(path.join(root, "manifest.json"), {
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
  return { root, hash };
}

test("landscape output directory is canonical beneath work and rejects escapes or symlinks", () => {
  const root = temporaryDirectory("landscape-output");
  mkdirSync(path.join(root, "work"));
  assert.equal(
    resolveR3LandscapeOutputDirectory("work/r3/landscapes", root),
    path.join(root, "work", "r3", "landscapes"),
  );
  assert.throws(
    () => resolveR3LandscapeOutputDirectory("outside/landscapes", root),
    /strictly inside/,
  );

  const target = path.join(root, "target");
  mkdirSync(target);
  const linked = path.join(root, "work", "linked");
  symlinkSync(target, linked, process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => resolveR3LandscapeOutputDirectory("work/linked", root),
    /may not traverse or replace a symlink/,
  );
});

test("landscape harness declares an inert favicon instead of causing an automatic 404", () => {
  assert.match(R3_LANDSCAPE_HARNESS_HTML, /<link rel=icon href=data:,>/);
  assert.doesNotMatch(R3_LANDSCAPE_HARNESS_HTML, /favicon\.ico/);
});

test("landscape environment converts authored sRGB colors to extraction linear bytes", () => {
  assert.deepEqual(linearRgb8FromSrgbHexR3(0x6ea0be), [40, 90, 131]);
  assert.deepEqual(linearRgb8FromSrgbHexR3(0x111a1d), [1, 3, 3]);
  assert.throws(() => linearRgb8FromSrgbHexR3(-1), /24-bit integer/);
  assert.throws(() => linearRgb8FromSrgbHexR3(0x1_00_00_00), /24-bit integer/);
});

test("landscape records carry explicit sky-only light bytes for every vertex", () => {
  assert.deepEqual(Array.from(skyOnlyVertexLightsR3(3)), [
    255, 0, 0, 0,
    255, 0, 0, 0,
    255, 0, 0, 0,
  ]);
  assert.equal(skyOnlyVertexLightsR3(0).byteLength, 0);
  assert.throws(() => skyOnlyVertexLightsR3(-1), /outside the supported range/);
  assert.throws(() => skyOnlyVertexLightsR3(1.5), /outside the supported range/);
});

test("landscape renderer pixel gate tolerates raster edges but rejects color-space drift", () => {
  assert.equal(isR3RendererPixelParityWithinBounds({
    comparable: true,
    meanAbsoluteError: R3_RENDERER_PARITY_MAX_MAE,
    rootMeanSquareError: R3_RENDERER_PARITY_MAX_RMSE,
  }), true);
  assert.equal(isR3RendererPixelParityWithinBounds({
    comparable: true,
    meanAbsoluteError: R3_RENDERER_PARITY_MAX_MAE + 0.001,
    rootMeanSquareError: 0,
  }), false);
  assert.equal(isR3RendererPixelParityWithinBounds({
    comparable: true,
    meanAbsoluteError: 0,
    rootMeanSquareError: R3_RENDERER_PARITY_MAX_RMSE + 0.001,
  }), false);
  assert.equal(isR3RendererPixelParityWithinBounds({ comparable: false }), false);
});

test("landscape Three browser path bundles the production extraction oracle and record decoders", async () => {
  assert.match(R3_THREE_ORACLE_BROWSER_ENTRY, /ThreeExtractionOracleR11/);
  assert.match(R3_THREE_ORACLE_BROWSER_ENTRY, /decodeRenderResourceBatchV2/);
  assert.match(R3_THREE_ORACLE_BROWSER_ENTRY, /decodeRenderFrameV2/);
  assert.doesNotMatch(R3_THREE_ORACLE_BROWSER_ENTRY, /MeshBasicMaterial|MeshStandardMaterial/);

  const bundle = await buildThreeExtractionOracleBundleR3(path.resolve(import.meta.dirname, ".."));
  assert.ok(bundle.length > 50_000, "the browser bundle should contain the extraction decoder and production oracle");
  assert.match(bundle, /ThreeExtractionOracleR11/);
  assert.match(bundle, /renderThreeExtractionRecordsR3/);
  const externalImports = [...bundle.matchAll(/^\s*import[^\n]*?from\s+["']([^"']+)["'];?/gm)].map((match) => match[1]);
  assert.deepEqual(externalImports, ["/three.module.js"], "the harness must depend only on the explicitly served Three module");
});

test("landscape mode is explicit and candidate roots can never update tracked fixtures", () => {
  const root = temporaryDirectory("landscape-mode");
  const canonical = path.join(root, "public", "engine");
  const candidate = path.join(root, "public", "engine-locator-candidate");
  assert.throws(
    () => resolveR3LandscapeMode({ check: false, updateTrackedFixtures: false }, canonical, root),
    /exactly one landscape mode/,
  );
  assert.throws(
    () => resolveR3LandscapeMode({ check: true, updateTrackedFixtures: true }, canonical, root),
    /exactly one landscape mode/,
  );
  assert.equal(
    resolveR3LandscapeMode({ check: true, updateTrackedFixtures: false }, candidate, root),
    "check",
  );
  assert.throws(
    () => resolveR3LandscapeMode({ check: false, updateTrackedFixtures: true }, candidate, root),
    /only with the exact canonical public\/engine root/,
  );
  assert.equal(
    resolveR3LandscapeMode({ check: false, updateTrackedFixtures: true }, canonical, root),
    "update-tracked-fixtures",
  );
});

test("landscape configuration requires and pins the exact selected artifact hash", () => {
  const root = temporaryDirectory("landscape-hash");
  mkdirSync(path.join(root, "work"));
  const fixture = createArtifactRoot(root, "public/engine-locator-candidate");
  const base = [
    "node",
    "verify-rust-generation-landscapes-r3.ts",
    "--check",
    "--public-dir",
    "public/engine-locator-candidate",
    "--output-dir",
    "work/landscapes",
  ];
  assert.throws(
    () => parseR3LandscapeConfiguration(base, root),
    /requires --expected-artifact-hash/,
  );
  assert.throws(
    () => parseR3LandscapeConfiguration([...base, "--expected-artifact-hash", "d".repeat(64)], root),
    /artifact hash mismatch/,
  );
  const configuration = parseR3LandscapeConfiguration(
    [...base, "--expected-artifact-hash", fixture.hash],
    root,
  );
  assert.equal(configuration.mode, "check");
  assert.equal(configuration.candidate, true);
  assert.equal(configuration.artifact.hash, fixture.hash);
  assert.equal(configuration.artifact.sourceSnapshot.digest, "c".repeat(64));
  assert.throws(
    () => parseR3LandscapeConfiguration([
      ...base,
      "--update-tracked-fixtures",
      "--expected-artifact-hash",
      fixture.hash,
    ], root),
    /exactly one landscape mode/,
  );
  assert.throws(
    () => parseR3LandscapeConfiguration([
      "node",
      "verify-rust-generation-landscapes-r3.ts",
      "--update-tracked-fixtures",
      "--public-dir",
      "public/engine-locator-candidate",
      "--output-dir",
      "work/landscapes",
      "--expected-artifact-hash",
      fixture.hash,
    ], root),
    /only with the exact canonical public\/engine root/,
  );
});

test("landscape corpus retains the exact five ordered case identities", () => {
  const cases = [
    "poi-negative-chunk",
    "connected-ocean-horizon",
    "deep-ocean-flora",
    "cave-aquifer-section",
    "biome-transition-negative-space",
  ].map((id) => ({ id }));
  assert.equal(validateR3LandscapeCases({ schema: 1, cases }).length, 5);
  assert.throws(
    () => validateR3LandscapeCases({ schema: 1, cases: [...cases].reverse() }),
    /case order changed/,
  );
  assert.throws(
    () => validateR3LandscapeCases({ schema: 1, cases: cases.slice(0, 4) }),
    /exactly five cases/,
  );
});
