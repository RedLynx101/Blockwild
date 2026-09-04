import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  contentAddressForFiles,
  createRustEngineSourceSnapshot,
  describeArtifactFiles,
  summarizeSamples,
  validatePublishedArtifacts,
} from "../scripts/rust-engine-common.mjs";
import {
  parseTransferSizes,
  selectBrowserArtifact,
} from "../scripts/benchmark-rust-browser.mjs";
import {
  acquireRustEngineBuildLock,
  assertExpectedArtifactHashBeforePublication,
  releaseRustEngineBuildLock,
  stabilizeArtifactIndexTimestamp,
  stabilizeArtifactManifestTimestamp,
  validateExistingArtifactDestination,
} from "../scripts/build-rust-engine.mjs";
import {
  rewriteRustEngineCandidateRequestUrl,
  rustEngineCandidateAliasPlugin,
} from "../vite.config.ts";
import {
  resolveR3BrowserOutputPath,
  resolveR3BrowserPublicDirectory,
  selectR3BrowserArtifact,
} from "../scripts/verify-rust-generation-r3-browser.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const canonicalTemp = path.resolve(os.tmpdir());
    const canonicalDirectory = path.resolve(directory);
    assert.ok(canonicalDirectory.startsWith(`${canonicalTemp}${path.sep}`));
    rmSync(canonicalDirectory, { recursive: true, force: true });
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

function createPublishedFixture() {
  const root = temporaryDirectory("rust-artifacts");
  const staging = path.join(root, "staging");
  mkdirSync(staging);
  writeFileSync(path.join(staging, "engine.js"), "export default async () => {}; export const heartbeat = () => 1;\n");
  writeFileSync(path.join(staging, "engine_bg.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  const files = describeArtifactFiles(staging);
  const hash = contentAddressForFiles(files);
  const directory = path.join(root, hash);
  renameSync(staging, directory);
  writeJson(path.join(directory, "manifest.json"), {
    schema: 1,
    artifactHash: hash,
    variant: "compatibility",
    sourceSnapshot: {
      schema: 1,
      digest: "c".repeat(64),
      fileCount: 3,
    },
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
  return { root, hash, directory, files };
}

function createSourceSnapshotFixture(label, reverseCreationOrder = false) {
  const root = temporaryDirectory(label);
  const entries = [
    ["engine/Cargo.toml", "[workspace]\nmembers = []\n"],
    ["engine/src/lib.rs", "pub fn heartbeat() -> u32 { 1 }\n"],
    ["scripts/build-rust-engine.mjs", "export const build = true;\n"],
    ["scripts/rust-engine-common.mjs", "export const common = true;\n"],
  ];
  for (const [relativePath, contents] of reverseCreationOrder ? [...entries].reverse() : entries) {
    const absolute = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

test("content addresses are stable regardless of manifest ordering", () => {
  const files = [
    { path: "engine.js", sha256: "a".repeat(64), bytes: 12 },
    { path: "engine_bg.wasm", sha256: "b".repeat(64), bytes: 8 },
  ];
  assert.equal(contentAddressForFiles(files), contentAddressForFiles([...files].reverse()));
});

test("artifact validator accepts a complete content-addressed package", () => {
  const fixture = createPublishedFixture();
  const verification = validatePublishedArtifacts(fixture.root);
  assert.equal(verification.index.defaultVariant, "compatibility");
  assert.equal(verification.artifacts[0].hash, fixture.hash);
  assert.deepEqual(verification.artifacts[0].files.map((file) => file.role).sort(), ["glue", "wasm"]);
  const selected = selectBrowserArtifact(verification, null);
  assert.equal(selected.variant, "compatibility");
  assert.equal(selected.wasm.path, "engine_bg.wasm");
});

test("R3 browser selection validates the exact artifact hash and source provenance", () => {
  const fixture = createPublishedFixture();
  const selected = selectR3BrowserArtifact(fixture.root, fixture.hash);
  assert.equal(selected.hash, fixture.hash);
  assert.equal(selected.sourceSnapshot.digest, "c".repeat(64));
  assert.equal(selected.sourceSnapshot.fileCount, 3);
  assert.throws(
    () => selectR3BrowserArtifact(fixture.root, "d".repeat(64)),
    /artifact hash mismatch/,
  );

  const missingProvenance = createPublishedFixture();
  const manifestPath = path.join(missingProvenance.directory, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  delete manifest.sourceSnapshot;
  writeJson(manifestPath, manifest);
  assert.throws(
    () => selectR3BrowserArtifact(missingProvenance.root, missingProvenance.hash),
    /lacks a valid source snapshot/,
  );
});

test("artifact validator rejects checksum drift", () => {
  const fixture = createPublishedFixture();
  writeFileSync(path.join(fixture.directory, "engine_bg.wasm"), Buffer.from([1, 2, 3]));
  assert.throws(
    () => validatePublishedArtifacts(fixture.root),
    /checksum or size mismatch/,
  );
});

test("artifact validator rejects stale files and unreferenced directories", () => {
  const fixture = createPublishedFixture();
  writeFileSync(path.join(fixture.directory, "stale.tmp"), "stale");
  assert.throws(() => validatePublishedArtifacts(fixture.root), /stale unmanifested file/);
  rmSync(path.join(fixture.directory, "stale.tmp"));
  mkdirSync(path.join(fixture.root, "f".repeat(64)));
  assert.throws(() => validatePublishedArtifacts(fixture.root), /Stale unreferenced/);
});

test("Rust engine source snapshots are sorted, stable, and detect source changes", () => {
  const firstRoot = createSourceSnapshotFixture("rust-source-a");
  const secondRoot = createSourceSnapshotFixture("rust-source-b", true);
  const initial = createRustEngineSourceSnapshot(firstRoot);
  assert.deepEqual(initial, createRustEngineSourceSnapshot(firstRoot));
  assert.deepEqual(initial, createRustEngineSourceSnapshot(secondRoot));
  assert.equal(initial.fileCount, 4);

  for (const excluded of ["target", "work", ".sites-runtime"]) {
    const generated = path.join(firstRoot, "engine", excluded, "generated.bin");
    mkdirSync(path.dirname(generated), { recursive: true });
    writeFileSync(generated, `ignored ${excluded}`);
  }
  assert.deepEqual(createRustEngineSourceSnapshot(firstRoot), initial);

  writeFileSync(path.join(firstRoot, "engine", "src", "lib.rs"), "pub fn heartbeat() -> u32 { 2 }\n");
  assert.notEqual(createRustEngineSourceSnapshot(firstRoot).digest, initial.digest);
});

test("existing same-hash destinations require a complete byte-for-byte file list", () => {
  const complete = createPublishedFixture();
  assert.equal(
    validateExistingArtifactDestination(complete.directory, {
      artifactHash: complete.hash,
      files: complete.files,
    }).files.length,
    complete.files.length,
  );

  writeFileSync(path.join(complete.directory, "stale.tmp"), "stale");
  assert.throws(
    () => validateExistingArtifactDestination(complete.directory, {
      artifactHash: complete.hash,
      files: complete.files,
    }),
    /file list mismatch/,
  );

  const drifted = createPublishedFixture();
  writeFileSync(path.join(drifted.directory, "engine_bg.wasm"), Buffer.from([1, 2, 3, 4]));
  assert.throws(
    () => validateExistingArtifactDestination(drifted.directory, {
      artifactHash: drifted.hash,
      files: drifted.files,
    }),
    /mismatch for engine_bg\.wasm/,
  );
});

test("expected artifact mismatch is rejected by the pure pre-publication guard", () => {
  const root = temporaryDirectory("rust-artifact-hash-guard");
  const publicationRoot = path.join(root, "public", "engine");
  assert.throws(
    () => assertExpectedArtifactHashBeforePublication("a".repeat(64), "b".repeat(64)),
    /artifact hash mismatch before publication/,
  );
  assert.equal(existsSync(publicationRoot), false, "the pure hash guard cannot mutate a publication path");
  assert.equal(
    assertExpectedArtifactHashBeforePublication("a".repeat(64), "a".repeat(64)),
    "a".repeat(64),
  );
});

test("unchanged artifact and index identities preserve their publication timestamps", () => {
  const existingManifest = {
    schema: 1,
    artifactHash: "a".repeat(64),
    variant: "renderer-lab",
    cargoFeatures: ["renderer"],
    sourceSnapshot: { schema: 1, digest: "b".repeat(64), fileCount: 230 },
    files: [{ path: "engine_bg.wasm", bytes: 8, sha256: "c".repeat(64) }],
    createdAt: "2026-09-01T00:00:00.000Z",
  };
  const nextManifest = { ...structuredClone(existingManifest), createdAt: "2026-09-04T00:00:00.000Z" };
  assert.equal(stabilizeArtifactManifestTimestamp(nextManifest, existingManifest).createdAt, existingManifest.createdAt);

  const artifact = {
    hash: existingManifest.artifactHash,
    directory: existingManifest.artifactHash,
    manifest: `${existingManifest.artifactHash}/manifest.json`,
  };
  const existingIndex = {
    schema: 1,
    generatedAt: "2026-09-01T00:00:01.000Z",
    defaultVariant: "compatibility",
    artifacts: { compatibility: artifact, "renderer-lab": artifact },
  };
  const nextIndex = { ...structuredClone(existingIndex), generatedAt: "2026-09-04T00:00:01.000Z" };
  assert.equal(stabilizeArtifactIndexTimestamp(nextIndex, existingIndex).generatedAt, existingIndex.generatedAt);
});

test("changed artifact or index identities retain their new publication timestamps", () => {
  const oldCreatedAt = "2026-09-01T00:00:00.000Z";
  const newCreatedAt = "2026-09-04T00:00:00.000Z";
  const existingManifest = {
    schema: 1,
    artifactHash: "a".repeat(64),
    variant: "renderer-lab",
    sourceSnapshot: { schema: 1, digest: "b".repeat(64), fileCount: 229 },
    createdAt: oldCreatedAt,
  };
  const nextManifest = {
    ...structuredClone(existingManifest),
    sourceSnapshot: { ...existingManifest.sourceSnapshot, fileCount: 230 },
    createdAt: newCreatedAt,
  };
  assert.equal(stabilizeArtifactManifestTimestamp(nextManifest, existingManifest).createdAt, newCreatedAt);

  const oldGeneratedAt = "2026-09-01T00:00:01.000Z";
  const newGeneratedAt = "2026-09-04T00:00:01.000Z";
  const existingIndex = {
    schema: 1,
    generatedAt: oldGeneratedAt,
    defaultVariant: "compatibility",
    artifacts: { compatibility: { hash: "a".repeat(64) } },
  };
  const nextIndex = {
    ...structuredClone(existingIndex),
    generatedAt: newGeneratedAt,
    artifacts: { compatibility: { hash: "d".repeat(64) } },
  };
  assert.equal(stabilizeArtifactIndexTimestamp(nextIndex, existingIndex).generatedAt, newGeneratedAt);
});

test("browser benchmark inputs and summaries are deterministic", () => {
  assert.deepEqual(parseTransferSizes("4194304,65536,1048576,65536"), [65536, 1048576, 4194304]);
  assert.deepEqual(summarizeSamples([4, 1, 3, 2]), {
    count: 4,
    averageMilliseconds: 2.5,
    p50Milliseconds: 2,
    p95Milliseconds: 4,
    p99Milliseconds: 4,
    minimumMilliseconds: 1,
    maximumMilliseconds: 4,
  });
});

test("build fails clearly without an engine workspace and does not install tools", () => {
  const fixtureRoot = temporaryDirectory("rust-missing-workspace");
  mkdirSync(path.join(fixtureRoot, "docs"));
  mkdirSync(path.join(fixtureRoot, "engine"));
  mkdirSync(path.join(fixtureRoot, "scripts"));
  writeFileSync(path.join(fixtureRoot, "scripts", "build-rust-engine.mjs"), "export const build = true;\n");
  writeFileSync(path.join(fixtureRoot, "scripts", "rust-engine-common.mjs"), "export const common = true;\n");
  writeJson(path.join(fixtureRoot, "package.json"), { name: "fixture" });
  const result = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "build-rust-engine.mjs"),
    "--repo-root",
    fixtureRoot,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No Rust workspace was found/);
});

test("an expected source mismatch fails before Cargo or publication", () => {
  const fixtureRoot = createSourceSnapshotFixture("rust-source-mismatch");
  mkdirSync(path.join(fixtureRoot, "docs"));
  writeJson(path.join(fixtureRoot, "package.json"), { name: "fixture" });
  const result = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "build-rust-engine.mjs"),
    "--repo-root",
    fixtureRoot,
    "--expected-source-digest",
    "0".repeat(64),
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source digest mismatch before build/);
  assert.equal(existsSync(path.join(fixtureRoot, "public")), false, "a failed provenance check does not create a publication root");
});

test("R3 browser CLI rejects artifact roots outside the canonical and candidate paths", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    path.join(repositoryRoot, "scripts", "verify-rust-generation-r3-browser.ts"),
    "--public-dir",
    "public/engine-r5-candidate",
    "--expected-artifact-hash",
    "a".repeat(64),
    "--output",
    "work/r3-browser-path-rejection.json",
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must resolve to public\/engine or public\/engine-locator-candidate/);
});

test("R3 browser evidence output stays canonical, JSON, and non-symlinked beneath work", () => {
  const root = temporaryDirectory("r3-output-boundary");
  mkdirSync(path.join(root, "work"));
  const valid = path.join(root, "work", "r3", "evidence.json");
  assert.equal(resolveR3BrowserOutputPath("work/r3/evidence.json", root), valid);
  assert.throws(
    () => resolveR3BrowserOutputPath("outside/evidence.json", root),
    /strictly inside/,
  );
  assert.throws(
    () => resolveR3BrowserOutputPath("work/r3/evidence.txt", root),
    /lowercase \.json extension/,
  );

  const target = path.join(root, "symlink-target");
  mkdirSync(target);
  const linkedOutput = path.join(root, "work", "linked.json");
  symlinkSync(target, linkedOutput, process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => resolveR3BrowserOutputPath(linkedOutput, root),
    /may not traverse or replace a symlink/,
  );
});

test("R3 browser public roots must be real directories at the exact approved path", () => {
  const validRoot = temporaryDirectory("r3-public-valid");
  mkdirSync(path.join(validRoot, "public", "engine"), { recursive: true });
  assert.equal(
    resolveR3BrowserPublicDirectory("public/engine", validRoot),
    path.join(validRoot, "public", "engine"),
  );

  const linkedRoot = temporaryDirectory("r3-public-linked");
  const target = path.join(linkedRoot, "artifact-target");
  mkdirSync(path.join(linkedRoot, "public"));
  mkdirSync(target);
  symlinkSync(target, path.join(linkedRoot, "public", "engine"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => resolveR3BrowserPublicDirectory("public/engine", linkedRoot),
    /real non-symlink directory/,
  );
});

test("candidate alias is serve-only and rewrites only the /engine URL space", () => {
  assert.equal(rewriteRustEngineCandidateRequestUrl("/engine"), "/engine-locator-candidate");
  assert.equal(rewriteRustEngineCandidateRequestUrl("/engine?cache=off"), "/engine-locator-candidate?cache=off");
  assert.equal(
    rewriteRustEngineCandidateRequestUrl("/engine/abc/engine.js?cache=off"),
    "/engine-locator-candidate/abc/engine.js?cache=off",
  );
  for (const untouched of [
    "/engine-room",
    "/engine%2Fengine.js",
    "/api/audit?path=/engine/engine.js",
    "/public/engine/engine.js",
  ]) {
    assert.equal(rewriteRustEngineCandidateRequestUrl(untouched), untouched);
  }

  const plugin = rustEngineCandidateAliasPlugin(true);
  assert.equal(plugin.apply, "serve", "candidate alias cannot participate in build output");
  assert.equal(plugin.enforce, "pre");
  let middleware;
  plugin.configureServer({ middlewares: { use(handler) { middleware = handler; } } });
  assert.equal(typeof middleware, "function");
  const request = { url: "/engine/manifest.json?v=1" };
  let continued = false;
  middleware(request, {}, () => { continued = true; });
  assert.equal(request.url, "/engine-locator-candidate/manifest.json?v=1");
  assert.equal(continued, true);
});

test("publisher recovers only a verified stale lock and always releases its replacement", () => {
  const root = temporaryDirectory("rust-build-lock");
  const lockPath = path.join(root, ".build-lock");
  writeJson(lockPath, { pid: 424_242, startedAt: "2026-01-01T00:00:00.000Z" });
  const descriptor = acquireRustEngineBuildLock(lockPath, { isProcessAlive: (pid) => pid !== 424_242 });
  assert.match(String(readFileSync(lockPath)), new RegExp(`"pid":${process.pid}`));
  releaseRustEngineBuildLock(lockPath, descriptor);
  assert.equal(existsSync(lockPath), false);

  writeJson(lockPath, { pid: process.pid, startedAt: new Date().toISOString() });
  assert.throws(
    () => acquireRustEngineBuildLock(lockPath, { isProcessAlive: () => true }),
    /build may be active/,
  );
  assert.equal(existsSync(lockPath), true, "an active owner's lock is never removed");
});
