import assert from "node:assert/strict";
import {
  lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import {
  artifactMimeType, artifactRole, contentAddressForFiles, createRustEngineSourceSnapshot,
  describeArtifactFiles, sha256,
} from "../../scripts/rust-engine-common.mjs";

const PREFIX = "blockwild-engine-selection-fixture-";
const CREATED_AT = "2026-01-01T00:00:00.000Z";

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Hermetic synthetic artifact: real file/content/source hashing, no browser build claim. */
export function createRustEngineCandidateFixture(t) {
  const temporaryParent = realpathSync(os.tmpdir());
  const root = mkdtempSync(path.join(temporaryParent, PREFIX));
  const createdName = path.basename(root);
  t.after(() => {
    assert.equal(lstatSync(root).isSymbolicLink(), false, "fixture root cannot become a symlink");
    const canonicalTarget = realpathSync(root);
    assert.equal(path.dirname(canonicalTarget), temporaryParent);
    assert.equal(canonicalTarget, path.join(temporaryParent, createdName));
    assert.ok(createdName.startsWith(PREFIX));
    assert.notEqual(canonicalTarget, temporaryParent);
    assert.notEqual(canonicalTarget, path.parse(canonicalTarget).root);
    rmSync(canonicalTarget, { recursive: true, force: true });
  });

  for (const [relative, contents] of [
    ["engine/Cargo.toml", "[workspace]\nmembers = []\n"],
    ["engine/src/lib.rs", "pub fn fixture_heartbeat() -> u32 { 1 }\n"],
    ["scripts/build-rust-engine.mjs", "export const syntheticBuildFixture = true;\n"],
    ["scripts/rust-engine-common.mjs", "export const syntheticSourceFixture = true;\n"],
  ]) {
    const destination = path.join(root, ...relative.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents, "utf8");
  }
  const sourceSnapshot = createRustEngineSourceSnapshot(root);
  const payloads = [
    ["engine.js", Buffer.from(`export default async () => {};\n${"// Synthetic artifact selection fixture, not a compiled game.\n".repeat(64)}`)],
    ["engine_bg.wasm", Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])],
  ];
  const declaredFiles = payloads.map(([relative, content]) => ({
    path: relative, role: artifactRole(relative), mimeType: artifactMimeType(relative),
    bytes: content.byteLength, sha256: sha256(content),
  }));
  const hash = contentAddressForFiles(declaredFiles);
  const candidateRoot = path.join(root, "public", "engine-locator-candidate");
  const artifactDirectory = path.join(candidateRoot, hash);
  mkdirSync(artifactDirectory, { recursive: true });
  for (const [relative, content] of payloads) writeFileSync(path.join(artifactDirectory, relative), content);
  const files = describeArtifactFiles(artifactDirectory);
  assert.equal(contentAddressForFiles(files), hash);
  const totals = payloads.reduce((sum, [, content]) => ({
    rawBytes: sum.rawBytes + content.byteLength,
    gzipBytes: sum.gzipBytes + gzipSync(content).byteLength,
    brotliBytes: sum.brotliBytes + brotliCompressSync(content).byteLength,
  }), { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 });
  const manifestPath = path.join(artifactDirectory, "manifest.json");
  writeJson(manifestPath, {
    schema: 1, artifactHash: hash, variant: "compatibility", package: "blockwild-wasm",
    packageVersion: "0.0.0-fixture", protocolVersion: 1, target: "wasm32-unknown-unknown",
    cargoProfile: "release", cargoFeatures: [], rustToolchain: "synthetic-fixture",
    cargoVersion: "synthetic-fixture", wasmBindgenVersion: "synthetic-fixture",
    createdAt: CREATED_AT, sourceSnapshot, totals, files,
  });
  const indexPath = path.join(candidateRoot, "manifest.json");
  writeJson(indexPath, {
    schema: 1, generatedAt: CREATED_AT, defaultVariant: "compatibility",
    artifacts: { compatibility: { hash, directory: hash, manifest: `${hash}/manifest.json` } },
  });
  return Object.freeze({
    root, candidateRoot, artifactDirectory, hash, sourceSnapshot, manifestPath, indexPath,
    sourcePath: path.join(root, "engine", "src", "lib.rs"),
    wasmPath: path.join(artifactDirectory, "engine_bg.wasm"),
  });
}
