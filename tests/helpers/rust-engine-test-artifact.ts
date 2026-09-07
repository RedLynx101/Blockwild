import assert from "node:assert/strict";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type RustEngineTestIndexRoot = Readonly<{
  directory: string;
  overridden: boolean;
}>;

export type RustEngineTestArtifact = RustEngineTestIndexRoot & Readonly<{
  artifactDirectory: string;
  hash: string;
  sourceDigest?: string;
  sourceFileCount?: number;
  wasmSha256?: string;
  wasmBytes?: number;
}>;

export const R11_LOCATOR_CANDIDATE_ARTIFACT_HASH = "3f96f761f9f8ced86faca776b0852222c5c800231ba3eb8b1b9374ba076759ed";
export const R11_LOCATOR_CANDIDATE_SOURCE_DIGEST = "b5821d1e8b0340c15e5b31f164258e982ec8b0a95eb8bdfa4370c0001ef82859";
export const R11_LOCATOR_CANDIDATE_SOURCE_FILE_COUNT = 231;
export const R11_LOCATOR_CANDIDATE_WASM_SHA256 = "993da56ceb1e940df62a2478fb373a62b52ae96ab00e748e94c893afb6a4c7fa";
export const R11_LOCATOR_CANDIDATE_WASM_BYTES = 7_675_588;

const R7_SCHEMA_CANDIDATE_ARTIFACT_HASH = "576917ff367f13bdbbca80ab2e15504020b79849356b91dc98a2ff9994f50f0a";
const R7_SCHEMA_CANDIDATE_SOURCE_DIGEST = "71248a6ce11eee9c54aef9f13b76a36978c26d7bb2e8c468d6629843aacb895c";
const R7_SCHEMA_CANDIDATE_SOURCE_FILE_COUNT = 231;
const R7_SCHEMA_CANDIDATE_WASM_SHA256 = "e5cddc46243ee987fc8bfcd5ec5e01a02f83f4697c42312b577f5a7cbedf53e4";
const R7_SCHEMA_CANDIDATE_WASM_BYTES = 7_675_060;

export const R13_BROWSER_CANDIDATE_ARTIFACT_HASH = "179849825480ef0f85ecae6fef5889e82997d53b6fd7dbb15a5a506642b8fd88";
export const R13_BROWSER_CANDIDATE_SOURCE_DIGEST = "6963c7e6a5c88b56692842c278021580bbc020ce0bc61fe75cd68992bd096df5";
export const R13_BROWSER_CANDIDATE_SOURCE_FILE_COUNT = 231;
export const R13_BROWSER_CANDIDATE_WASM_SHA256 = "d11163afdd9e98fcf3aba609a5c023498ac0a56f20c7bcb5b468fbb7bcf7e994";
export const R13_BROWSER_CANDIDATE_WASM_BYTES = 7_707_273;

type CandidatePins = Readonly<{
  artifactHash: string;
  sourceDigest: string;
  sourceFileCount: number;
  wasmSha256: string;
  wasmBytes: number;
}>;

const CANDIDATE_PINS: Readonly<Record<string, CandidatePins>> = Object.freeze({
  "engine-locator-candidate": Object.freeze({
    artifactHash: R11_LOCATOR_CANDIDATE_ARTIFACT_HASH,
    sourceDigest: R11_LOCATOR_CANDIDATE_SOURCE_DIGEST,
    sourceFileCount: R11_LOCATOR_CANDIDATE_SOURCE_FILE_COUNT,
    wasmSha256: R11_LOCATOR_CANDIDATE_WASM_SHA256,
    wasmBytes: R11_LOCATOR_CANDIDATE_WASM_BYTES,
  }),
  "engine-schema-candidate": Object.freeze({
    artifactHash: R7_SCHEMA_CANDIDATE_ARTIFACT_HASH,
    sourceDigest: R7_SCHEMA_CANDIDATE_SOURCE_DIGEST,
    sourceFileCount: R7_SCHEMA_CANDIDATE_SOURCE_FILE_COUNT,
    wasmSha256: R7_SCHEMA_CANDIDATE_WASM_SHA256,
    wasmBytes: R7_SCHEMA_CANDIDATE_WASM_BYTES,
  }),
  "engine-r11-browser-candidate": Object.freeze({
    artifactHash: R13_BROWSER_CANDIDATE_ARTIFACT_HASH,
    sourceDigest: R13_BROWSER_CANDIDATE_SOURCE_DIGEST,
    sourceFileCount: R13_BROWSER_CANDIDATE_SOURCE_FILE_COUNT,
    wasmSha256: R13_BROWSER_CANDIDATE_WASM_SHA256,
    wasmBytes: R13_BROWSER_CANDIDATE_WASM_BYTES,
  }),
});

const CANDIDATE_ROOT_NAMES = Object.freeze(Object.keys(CANDIDATE_PINS));
const CANDIDATE_ROOT_ERROR = CANDIDATE_ROOT_NAMES.map((name) => `public/${name}`).join(", ");

type EngineIndex = Readonly<{
  defaultVariant?: unknown;
  artifacts?: Record<string, Readonly<{
    hash?: unknown;
    directory?: unknown;
    manifest?: unknown;
  }>>;
}>;

function comparablePath(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isStrictSubdirectory(parent: string, candidate: string) {
  const relation = relative(parent, candidate);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

/**
 * Selects the checked-in engine index used by Wasm integration tests.
 *
 * The environment override admits only the isolated candidate
 * roots. This keeps candidate validation from silently reading or mutating the
 * canonical public/engine artifact tree, or following an arbitrary artifact path.
 */
export async function resolveRustEngineTestIndexRoot(
  repositoryRoot: string,
  override: string | null | undefined = process.env.BLOCKWILD_LOCATOR_ENGINE_DIR,
): Promise<RustEngineTestIndexRoot> {
  const publicRoot = await realpath(join(repositoryRoot, "public"));
  if (override === null || override === undefined) {
    return Object.freeze({ directory: join(publicRoot, "engine"), overridden: false });
  }
  if (override.trim() === "") {
    throw new Error("BLOCKWILD_LOCATOR_ENGINE_DIR must name a non-empty directory under public/");
  }

  const requested = resolve(repositoryRoot, override);
  const isolatedCandidateRoot = CANDIDATE_ROOT_NAMES
    .map((name) => join(publicRoot, name))
    .find((candidate) => comparablePath(requested) === comparablePath(candidate));
  if (isolatedCandidateRoot === undefined) {
    throw new Error(`BLOCKWILD_LOCATOR_ENGINE_DIR must resolve exactly to one of ${CANDIDATE_ROOT_ERROR}`);
  }

  let directory: string;
  try {
    directory = await realpath(requested);
  } catch {
    throw new Error("BLOCKWILD_LOCATOR_ENGINE_DIR does not resolve to an existing directory");
  }
  if (comparablePath(directory) !== comparablePath(isolatedCandidateRoot)) {
    throw new Error(`BLOCKWILD_LOCATOR_ENGINE_DIR must canonicalize exactly to its selected root (${CANDIDATE_ROOT_ERROR})`);
  }
  if (!isStrictSubdirectory(publicRoot, directory)) {
    throw new Error("BLOCKWILD_LOCATOR_ENGINE_DIR must resolve to a strict subdirectory of this repository's public/");
  }
  if (!(await stat(directory)).isDirectory()) {
    throw new Error("BLOCKWILD_LOCATOR_ENGINE_DIR must resolve to a directory");
  }

  const manifest = join(directory, "manifest.json");
  try {
    if (!(await stat(manifest)).isFile()) throw new Error();
    const canonicalManifest = await realpath(manifest);
    if (!isStrictSubdirectory(directory, canonicalManifest)) throw new Error();
  } catch {
    throw new Error("BLOCKWILD_LOCATOR_ENGINE_DIR must contain manifest.json");
  }
  return Object.freeze({ directory, overridden: true });
}

function candidatePinsForDirectory(publicRoot: string, directory: string) {
  const entry = CANDIDATE_ROOT_NAMES.find((name) => comparablePath(join(publicRoot, name)) === comparablePath(directory));
  return entry === undefined ? undefined : CANDIDATE_PINS[entry];
}

type EngineArtifactManifest = Readonly<{
  artifactHash?: unknown;
  sourceSnapshot?: Readonly<{ digest?: unknown; fileCount?: unknown }>;
  files?: Array<Readonly<{ role?: unknown; sha256?: unknown; bytes?: unknown }>>;
}>;

function assertCandidateArtifactPins(manifest: EngineArtifactManifest, pins: CandidatePins) {
  assert.equal(manifest.artifactHash, pins.artifactHash, "Rust engine candidate artifact hash does not match its immutable pin");
  assert.equal(manifest.sourceSnapshot?.digest, pins.sourceDigest, "Rust engine candidate source digest does not match its immutable pin");
  assert.equal(manifest.sourceSnapshot?.fileCount, pins.sourceFileCount, "Rust engine candidate source file count does not match its immutable pin");
  const wasm = manifest.files?.find((file) => file.role === "wasm");
  assert.ok(wasm, "Rust engine candidate manifest has no Wasm file");
  assert.equal(wasm.sha256, pins.wasmSha256, "Rust engine candidate Wasm SHA-256 does not match its immutable pin");
  assert.equal(wasm.bytes, pins.wasmBytes, "Rust engine candidate Wasm byte count does not match its immutable pin");
}

export async function resolveRustEngineTestDefaultArtifact(
  repositoryRoot: string,
  override: string | null | undefined = process.env.BLOCKWILD_LOCATOR_ENGINE_DIR,
): Promise<RustEngineTestArtifact> {
  const selected = await resolveRustEngineTestIndexRoot(repositoryRoot, override);
  const index = JSON.parse(await readFile(join(selected.directory, "manifest.json"), "utf8")) as EngineIndex;
  assert.equal(typeof index.defaultVariant, "string", "Rust engine index has no default variant");
  const defaultVariant = index.defaultVariant as string;
  const artifact = index.artifacts?.[defaultVariant];
  assert.ok(artifact, `Rust engine index has no ${defaultVariant} artifact`);
  assert.match(String(artifact.hash), /^[0-9a-f]{64}$/u, "Rust engine artifact has no canonical hash");
  assert.equal(artifact.directory, artifact.hash, "Rust engine artifact directory must equal its content hash");
  assert.equal(artifact.manifest, `${artifact.hash}/manifest.json`, "Rust engine artifact manifest path is not content-addressed");

  const hash = artifact.hash as string;
  let artifactDirectory: string;
  try {
    artifactDirectory = await realpath(join(selected.directory, hash));
  } catch {
    throw new Error(`Rust engine artifact ${hash} does not resolve to an existing directory`);
  }
  if (!isStrictSubdirectory(selected.directory, artifactDirectory)) {
    throw new Error("Rust engine artifact must resolve below its selected index root");
  }
  if (!(await stat(artifactDirectory)).isDirectory()) {
    throw new Error("Rust engine artifact must resolve to a directory");
  }
  const pins = candidatePinsForDirectory(await realpath(join(repositoryRoot, "public")), selected.directory);
  if (pins !== undefined) {
    const artifactManifest = JSON.parse(await readFile(join(artifactDirectory, "manifest.json"), "utf8")) as EngineArtifactManifest;
    assertCandidateArtifactPins(artifactManifest, pins);
    return Object.freeze({
      ...selected,
      artifactDirectory,
      hash,
      sourceDigest: pins.sourceDigest,
      sourceFileCount: pins.sourceFileCount,
      wasmSha256: pins.wasmSha256,
      wasmBytes: pins.wasmBytes,
    });
  }
  return Object.freeze({ ...selected, artifactDirectory, hash });
}
