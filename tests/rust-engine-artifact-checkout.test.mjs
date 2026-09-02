import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createIsolatedGitEnvironment } from "../scripts/verify-rust-source-checkout.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ATTRIBUTES = readFileSync(path.join(ROOT, ".gitattributes"));
const PREFIX = "blockwild-engine-artifact-checkout-";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/** Read regular files directly from Git's ustar output, without an extraction tool. */
function readTarFiles(bytes) {
  assert.equal(bytes.length % 512, 0, "tar must contain complete blocks");
  const files = new Map();
  const text = field => field.toString("utf8").replace(/\0.*$/su, "");
  let offset = 0; let terminated = false;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) {
      assert(bytes.subarray(offset).every(byte => byte === 0), "data follows the tar terminator");
      terminated = true; break;
    }
    const checksum = Number.parseInt(text(header.subarray(148, 156)).trim(), 8);
    const observed = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(checksum, observed, "tar header checksum mismatch");
    const sizeText = text(header.subarray(124, 136)).trim();
    assert.match(sizeText, /^[0-7]+$/u, "unsupported tar size");
    const size = Number.parseInt(sizeText, 8);
    assert(Number.isSafeInteger(size) && size >= 0 && offset + size <= bytes.length, "tar payload is truncated");
    const prefix = text(header.subarray(345, 500));
    const name = `${prefix ? `${prefix}/` : ""}${text(header.subarray(0, 100))}`;
    assert(name && !name.startsWith("/") && !name.split("/").includes(".."), "unsafe tar path");
    const type = header[156];
    if (type === 0 || type === 48) {
      assert(!files.has(name), `duplicate tar file ${name}`);
      files.set(name, Buffer.from(bytes.subarray(offset, offset + size)));
    } else {
      // Git emits a global PAX header containing its commit ID, plus directories.
      assert(type === 103 || type === 53, `unexpected tar entry type ${type}`);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  assert(terminated, "tar terminator missing");
  return files;
}

function artifactFiles() {
  const files = new Map(); const artifacts = {};
  for (const variant of ["compatibility", "renderer-lab"]) {
    const hash = sha256(Buffer.from(`synthetic-${variant}-artifact`));
    const directory = `public/engine/${hash}`;
    // Both published variants live below the same content-addressed engine index.
    const payload = new Map([
      ["engine.js", Buffer.from(`export const variant = ${JSON.stringify(variant)};\nexport default async function init() { return variant; }\n`)],
      ["engine.d.ts", Buffer.from("export declare const variant: string;\nexport default function init(): Promise<string>;\n")],
      ["engine_bg.wasm.d.ts", Buffer.from("export const memory: WebAssembly.Memory;\nexport function example(): number;\n")],
      ["engine_bg.wasm", Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 13, 10, 255, 10])],
      // No NUL: this opaque artifact must not be treated as normalizable text.
      ["opaque-crlf.wasm", Buffer.from("opaque-by-published-route\r\npreserve-these-exact-bytes\r\n")],
    ]);
    const manifest = { schema: 1, artifactHash: hash, variant,
      files: [...payload].map(([file, bytes]) => ({ path: file, bytes: bytes.length, sha256: sha256(bytes) })) };
    for (const [file, bytes] of payload) files.set(`${directory}/${file}`, bytes);
    files.set(`${directory}/manifest.json`, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    artifacts[variant] = { hash, directory: hash, manifest: `${hash}/manifest.json` };
  }
  files.set("public/engine/manifest.json", Buffer.from(`${JSON.stringify({ schema: 1, defaultVariant: "compatibility", artifacts }, null, 2)}\n`));
  return files;
}

function isolatedFixture(context, attributes = ATTRIBUTES) {
  const trustedTemp = realpathSync(os.tmpdir());
  const owned = mkdtempSync(path.join(trustedTemp, PREFIX));
  const token = randomUUID(); const marker = ".owned-engine-artifact-test";
  writeFileSync(path.join(owned, marker), token, { flag: "wx" });
  context.after(() => {
    // Reconstruct the authorized destination from the trusted parent, independently
    // canonicalize the actual target, and require the unique ownership marker.
    const expected = path.join(realpathSync(os.tmpdir()), path.basename(owned));
    assert(path.basename(owned).startsWith(PREFIX) && path.dirname(expected) === trustedTemp);
    assert(!lstatSync(owned).isSymbolicLink() && realpathSync(owned) === expected);
    assert(![ROOT, realpathSync(os.homedir()), trustedTemp, path.parse(expected).root].includes(expected));
    assert.equal(readFileSync(path.join(expected, marker), "utf8"), token);
    rmSync(expected, { recursive: true, force: false, maxRetries: 2, retryDelay: 50 });
  });
  const source = path.join(owned, "source"); const checkout = path.join(owned, "checkout");
  const emptyConfig = path.join(owned, "empty-git-config"); const emptyHooks = path.join(owned, "empty-hooks");
  mkdirSync(source); mkdirSync(emptyHooks); writeFileSync(emptyConfig, "", { flag: "wx" });
  const environment = createIsolatedGitEnvironment(emptyConfig);
  function git(cwd, args) {
    const result = spawnSync("git", ["-c", "core.autocrlf=true", "-c", "core.eol=crlf",
      "-c", "core.safecrlf=false", "-c", `core.attributesFile=${emptyConfig}`, "-c", `core.hooksPath=${emptyHooks}`,
      "-c", "commit.gpgSign=false", "-c", "user.name=Artifact checkout test", "-c", "user.email=artifact-checkout@example.invalid",
      ...args], { cwd, env: environment, windowsHide: true, encoding: null, maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `isolated git ${args[0]} failed: ${result.stderr?.toString("utf8")}`);
    return result.stdout;
  }
  const original = artifactFiles();
  for (const [file, bytes] of new Map([[".gitattributes", attributes], ...original])) {
    const destination = path.join(source, ...file.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, bytes, { flag: "wx" });
  }
  git(source, ["init", "--quiet"]);
  git(source, ["add", "--", "."]);
  git(source, ["commit", "--quiet", "-m", "Artifact byte fixture"]);
  return { original, source,
    checkout() {
      git(owned, ["clone", "--quiet", "--no-checkout", "--no-local", source, checkout]);
      git(checkout, ["checkout", "--quiet", "--detach", "HEAD"]);
      assert.equal(git(checkout, ["status", "--porcelain"]).toString("utf8"), "", "checkout must be Git-clean");
      return new Map([...original.keys()].map(file => [file, readFileSync(path.join(checkout, ...file.split("/")))]));
    },
    archive() { return readTarFiles(git(source, ["archive", "--format=tar", "HEAD"])); },
  };
}

function differences(original, actual) {
  return [...original].filter(([file, bytes]) => !actual.has(file) || sha256(actual.get(file)) !== sha256(bytes)).map(([file]) => file);
}
function assertPreserved(original, actual) {
  assert.deepEqual(differences(original, actual), [], "published artifact bytes differ from their original SHA-256 digests");
  for (const [file, bytes] of original) assert.deepEqual(actual.get(file), bytes, `${file} changed`);
  const index = JSON.parse(actual.get("public/engine/manifest.json").toString("utf8"));
  assert.deepEqual(Object.keys(index.artifacts).sort(), ["compatibility", "renderer-lab"]);
  for (const artifact of Object.values(index.artifacts)) {
    const manifest = JSON.parse(actual.get(`public/engine/${artifact.manifest}`).toString("utf8"));
    for (const file of manifest.files) {
      const bytes = actual.get(`public/engine/${artifact.directory}/${file.path}`);
      assert.equal(bytes.length, file.bytes); assert.equal(sha256(bytes), file.sha256);
    }
  }
}

for (const transport of ["checkout", "archive"]) {
  test(`published compatibility and renderer-lab bytes survive real Git ${transport} with autocrlf=true`, context => {
    const fixture = isolatedFixture(context);
    assertPreserved(fixture.original, fixture[transport]());
    for (const [file, bytes] of fixture.original) assert.deepEqual(readFileSync(path.join(fixture.source, ...file.split("/"))), bytes);
    assert.deepEqual(readFileSync(path.join(ROOT, ".gitattributes")), ATTRIBUTES, "source attributes changed during the check");
  });
}

test("the round-trip verifier detects unpinned CRLF corruption in checkout and archive", context => {
  const fixture = isolatedFixture(context, Buffer.from("* text=auto\n"));
  for (const transport of ["checkout", "archive"]) {
    const actual = fixture[transport](); const changed = differences(fixture.original, actual);
    assert(changed.some(file => file.endsWith("/engine.js")), `${transport} must expose glue corruption`);
    assert(changed.some(file => file.endsWith(".d.ts")), `${transport} must expose declaration corruption`);
    assert(changed.some(file => file.endsWith("/manifest.json")), `${transport} must expose manifest corruption`);
    assert(!changed.some(file => file.endsWith(".wasm")), `${transport} must preserve NUL-containing Wasm`);
    assert.throws(() => assertPreserved(fixture.original, actual), /original SHA-256/u);
  }
});

test("LF normalization alone cannot preserve opaque text-like CRLF artifact bytes", context => {
  const fixture = isolatedFixture(context, Buffer.from("* text=auto\npublic/engine/** text=auto eol=lf\n"));
  for (const transport of ["checkout", "archive"]) {
    const actual = fixture[transport](); const changed = differences(fixture.original, actual);
    assert.equal(changed.length, 2, "only the two text-like opaque variant payloads should be normalized");
    assert(changed.every(file => file.endsWith("/opaque-crlf.wasm")));
    assert.throws(() => assertPreserved(fixture.original, actual), /original SHA-256/u);
  }
});
