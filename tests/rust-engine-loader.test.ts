import assert from "node:assert/strict";
import test from "node:test";
import {
  RustEngineLoader,
  RustEngineLoadError,
  type RustEngineWasmExports,
} from "../app/game/rust-engine-loader.ts";
import { encodeRustEngineEnvelope, RustEngineMessageKind } from "../app/game/rust-engine-protocol.ts";
import { RustEngineCodeCache } from "../app/game/rust-engine-code-cache.ts";
import { createHash } from "node:crypto";

const response = () => encodeRustEngineEnvelope({ kind: RustEngineMessageKind.CapabilityAck });
const fakeArtifact = { moduleUrl: "test://blockwild-engine.js", wasmUrl: "test://blockwild-engine.wasm", buildKind: "compatibility" as const };

function fakeExports(schemaVersion = 1): RustEngineWasmExports {
  return {
    blockwild_protocol_version: () => 1,
    blockwild_schema_version: () => schemaVersion,
    blockwild_engine_create: response,
    blockwild_engine_ingest: response,
    blockwild_engine_step: response,
    blockwild_engine_take_events: response,
    blockwild_engine_state_hash: response,
    blockwild_engine_destroy: response,
  };
}

test("Rust loader is lazy, initializes once, and deduplicates concurrent loads", async () => {
  let imports = 0;
  let initializes = 0;
  const loader = new RustEngineLoader({
    artifact: fakeArtifact,
    importer: async () => {
      imports += 1;
      return { default: async () => { initializes += 1; }, ...fakeExports() };
    },
    now: () => 12,
  });
  assert.equal(imports, 0, "constructing or importing the loader must not fetch Wasm");
  const [first, second] = await Promise.all([loader.load(), loader.load()]);
  assert.equal(first, second);
  assert.equal(imports, 1);
  assert.equal(initializes, 1);
  assert.equal(loader.diagnostics().state, "ready");
});

test("Rust loader reports an absent artifact without poisoning a TypeScript caller", async () => {
  const loader = new RustEngineLoader({ artifact: fakeArtifact, importer: async () => { throw new Error("404"); } });
  await assert.rejects(loader.load(), (error: unknown) => error instanceof RustEngineLoadError && error.code === "artifact-unavailable");
  assert.equal(loader.diagnostics().failures, 1);
  assert.equal(loader.diagnostics().lastError?.code, "artifact-unavailable");
});

test("Rust loader rejects schema drift before exposing exports", async () => {
  const loader = new RustEngineLoader({ artifact: fakeArtifact, importer: async () => fakeExports(7) });
  await assert.rejects(loader.load(), (error: unknown) => error instanceof RustEngineLoadError && error.code === "schema-mismatch");
  assert.equal(loader.diagnostics().state, "failed");
});

test("Rust loader rejects incomplete wasm-bindgen namespaces", async () => {
  const loader = new RustEngineLoader({ artifact: fakeArtifact, importer: async () => ({ blockwild_protocol_version: () => 1 }) });
  await assert.rejects(loader.load(), (error: unknown) => error instanceof RustEngineLoadError && error.code === "invalid-module");
});

test("Rust loader resolves the immutable artifact selected by the published manifest", async () => {
  const hash = "a".repeat(64);
  const responses = new Map<string, unknown>([
    ["https://blockwild.test/engine/manifest.json", {
      schema: 1,
      defaultVariant: "compatibility",
      artifacts: { compatibility: { hash, directory: hash, manifest: `${hash}/manifest.json` } },
    }],
    [`https://blockwild.test/engine/${hash}/manifest.json`, {
      schema: 1,
      artifactHash: hash,
      variant: "compatibility",
      files: [
        { path: "engine.js", role: "glue" },
        { path: "engine_bg.wasm", role: "wasm" },
      ],
    }],
  ]);
  const imported: Array<{ moduleUrl: string; wasmUrl: string; buildHash: string }> = [];
  const loader = new RustEngineLoader({
    artifact: { indexUrl: "https://blockwild.test/engine/manifest.json", buildKind: "compatibility" },
    fetcher: async (url) => ({ ok: responses.has(url), status: responses.has(url) ? 200 : 404, json: async () => responses.get(url) }),
    importer: async (artifact) => {
      imported.push(artifact);
      return fakeExports();
    },
  });
  const loaded = await loader.load();
  assert.equal(imported[0]?.moduleUrl, `https://blockwild.test/engine/${hash}/engine.js`);
  assert.equal(imported[0]?.wasmUrl, `https://blockwild.test/engine/${hash}/engine_bg.wasm`);
  assert.equal(loaded.artifact.buildHash, hash);
});

async function preparedFixture() {
  const hash = "a".repeat(64); const root = "https://blockwild.test/engine/";
  const glue = new TextEncoder().encode("export default async function init() {};");
  const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const assets = new Map<string, unknown>([
    [`${root}manifest.json`, { schema: 1, defaultVariant: "compatibility", artifacts: { compatibility: { hash, directory: hash, manifest: `${hash}/manifest.json` } } }],
    [`${root}${hash}/manifest.json`, { schema: 1, artifactHash: hash, variant: "compatibility", files: [
      { path: "engine.js", role: "glue", bytes: glue.length, sha256: sha(glue) },
      { path: "engine_bg.wasm", role: "wasm", bytes: wasm.length, sha256: sha(wasm) },
    ] }], [`${root}${hash}/engine.js`, glue], [`${root}${hash}/engine_bg.wasm`, wasm],
  ]);
  const cache = new RustEngineCodeCache({ fetcher: async url => {
    const value = assets.get(url); return new Response(value instanceof Uint8Array ? value.slice() : JSON.stringify(value));
  } });
  const code = await cache.prepare({ indexUrl: `${root}manifest.json`, variant: "compatibility", buildKind: "compatibility" });
  return { code, cache };
}

test("prepared code initializes fresh loader namespaces and instances from Module, never a Wasm URL", async () => {
  const { code, cache } = await preparedFixture(); const instances: WebAssembly.Instance[] = []; const namespaces: object[] = [];
  const importer = async (_artifact: unknown, verifiedGlue?: Uint8Array) => {
    assert.deepEqual(verifiedGlue, code.glueBytes);
    const namespace = { ...fakeExports(), default: async ({ module_or_path }: { module_or_path: unknown }) => {
      assert(module_or_path instanceof WebAssembly.Module); instances.push(await WebAssembly.instantiate(module_or_path));
    } };
    namespaces.push(namespace); return namespace;
  };
  const first = new RustEngineLoader({ artifact: code.artifact, preparedCode: code, importer });
  const second = new RustEngineLoader({ artifact: code.artifact, preparedCode: code, importer });
  const [a, b] = await Promise.all([first.load(), second.load()]);
  assert.notEqual(a.exports, b.exports); assert.equal(namespaces.length, 2); assert.equal(instances.length, 2); assert.notEqual(instances[0], instances[1]);
  cache.dispose();
});

test("prepared glue corruption and identity substitution reject before executing the importer", async () => {
  const { code, cache } = await preparedFixture(); let imports = 0;
  for (const changed of [{ ...code, glueBytes: code.glueBytes.slice(1) }, { ...code, identity: "f".repeat(64) }]) {
    const loader = new RustEngineLoader({ artifact: code.artifact, preparedCode: changed, importer: async () => { imports += 1; return fakeExports(); } });
    await assert.rejects(loader.load(), /length|identity/u);
  }
  assert.equal(imports, 0); cache.dispose();
});

test("prepared artifact cannot override a separately pinned selector/build identity", async () => {
  const { code, cache } = await preparedFixture();
  const loader = new RustEngineLoader({ preparedCode: code, artifact: { ...code.artifact, buildHash: "b".repeat(64) }, importer: async () => fakeExports() });
  await assert.rejects(loader.load(), /identity|pinned/u); cache.dispose();
});

test("loader reset does not republish exports from an earlier unresolved load", async () => {
  let finish!: (value: unknown) => void; let started!: () => void;
  const imported = new Promise<void>(resolve => { started = resolve; });
  const loader = new RustEngineLoader({ artifact: fakeArtifact, importer: () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  const old = loader.load(); await imported; loader.reset(); finish(fakeExports());
  await assert.rejects(old, /reset|superseded/u); assert.equal(loader.diagnostics().state, "idle");
});

test("default published loader owns an observable verified acquisition and reset aborts/releases it", async () => {
  const pending: { signal: AbortSignal; finish: (response: Response) => void }[] = [];
  const loader = new RustEngineLoader({ codeFetcher: (_url, init) => new Promise<Response>(finish => {
    assert(init?.signal); pending.push({ signal: init.signal, finish });
  }) });
  const old = loader.load(); const rejected = assert.rejects(old, /aborted|disposed/u);
  assert.equal(loader.diagnostics().codeCache?.pending, 1);
  assert.equal(loader.diagnostics().codeCache?.resolutions, 1);
  loader.reset(); assert(pending[0].signal.aborted); assert.equal(loader.diagnostics().codeCache, null);
  pending[0].finish(new Response("{}")); await rejected; assert.equal(loader.diagnostics().state, "idle");
  const next = loader.load(); const nextRejected = assert.rejects(next, /aborted|disposed/u);
  assert(!pending[1].signal.aborted); assert.equal(loader.diagnostics().codeCache?.resolutions, 1);
  loader.reset(); pending[1].finish(new Response("{}")); await nextRejected;
  assert.equal(loader.diagnostics().successes, 0); assert.equal(loader.diagnostics().failures, 0);
});
