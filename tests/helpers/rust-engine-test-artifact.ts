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
}>;

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
 * The environment override admits only the isolated locator and schema candidate
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
  const isolatedCandidateRoot = ["engine-locator-candidate", "engine-schema-candidate"]
    .map((name) => join(publicRoot, name))
    .find((candidate) => comparablePath(requested) === comparablePath(candidate));
  if (isolatedCandidateRoot === undefined) {
    throw new Error("BLOCKWILD_LOCATOR_ENGINE_DIR must resolve to public/engine-locator-candidate or public/engine-schema-candidate");
  }

  let directory: string;
  try {
    directory = await realpath(requested);
  } catch {
    throw new Error("BLOCKWILD_LOCATOR_ENGINE_DIR does not resolve to an existing directory");
  }
  if (comparablePath(directory) !== comparablePath(isolatedCandidateRoot)) {
    throw new Error("BLOCKWILD_LOCATOR_ENGINE_DIR must canonicalize exactly to its selected public/engine-locator-candidate or public/engine-schema-candidate root");
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
  return Object.freeze({ ...selected, artifactDirectory, hash });
}
