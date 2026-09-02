import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { RustEngineCodeCache, snapshotPreparedRustCode } from "../app/game/rust-engine-code-cache.ts";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const text = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0);

function fixture() {
  const origin = "https://blockwild.test/engine/"; let selected = "a".repeat(64);
  const artifact = { indexUrl: `${origin}manifest.json`, variant: "compatibility", buildKind: "compatibility" as const };
  const assets = new Map<string, Uint8Array>(); const calls: { url: string; signal?: AbortSignal | null }[] = [];
  let compilations = 0;
  function publish(hash: string) {
    const glue = text(`// immutable ${hash}\nexport default function init() {}`);
    const manifest = { schema: 1, artifactHash: hash, variant: "compatibility", files: [
      { role: "glue", path: "engine.js", bytes: glue.length, sha256: digest(glue) },
      { role: "wasm", path: "engine_bg.wasm", bytes: wasm.length, sha256: digest(wasm) },
    ] };
    assets.set(`${origin}${hash}/manifest.json`, text(manifest)); assets.set(`${origin}${hash}/engine.js`, glue);
    assets.set(`${origin}${hash}/engine_bg.wasm`, wasm.slice()); return manifest;
  }
  publish(selected);
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, signal: init?.signal });
    const bytes = url === artifact.indexUrl ? text({ schema: 1, defaultVariant: "compatibility",
      artifacts: { compatibility: { hash: selected, directory: selected, manifest: `${selected}/manifest.json` } } }) : assets.get(url);
    return new Response(bytes?.slice(), { status: bytes ? 200 : 404 });
  };
  const compile = async (bytes: Uint8Array) => { compilations += 1; return WebAssembly.compile(bytes.slice().buffer); };
  return { artifact, assets, calls, fetcher, compile, publish, origin, hash: selected,
    select(hash: string) { selected = hash; }, compilations: () => compilations };
}

test("verified code cache deduplicates concurrent bytes/compile but resolves every selector acquisition", async () => {
  const f = fixture(); const cache = new RustEngineCodeCache({ fetcher: f.fetcher, compile: f.compile });
  const values = await Promise.all(Array.from({ length: 3 }, () => cache.prepare(f.artifact)));
  assert.equal(f.compilations(), 1); assert.equal(f.calls.filter(call => call.url.endsWith("engine.js")).length, 1);
  assert.equal(f.calls.filter(call => call.url.endsWith("engine_bg.wasm")).length, 1);
  assert.equal(f.calls.filter(call => call.url === f.artifact.indexUrl).length, 3);
  assert.equal(new Set(values.map(value => value.identity)).size, 1);
  assert(values.every(value => value.wasmModule instanceof WebAssembly.Module));
  values[0].glueBytes.fill(0); assert.notDeepEqual(values[0].glueBytes, values[1].glueBytes);
  const fourth = await cache.prepare(f.artifact); assert.deepEqual(fourth.glueBytes, values[1].glueBytes);
  assert.equal(cache.diagnostics().entries, 1); cache.dispose(); assert.equal(cache.diagnostics().entries, 0);
});

for (const role of ["glue", "wasm"] as const) for (const damage of ["checksum", "truncated"] as const) {
  test(`${role} ${damage} fails before compilation and is evicted for a verified retry`, async () => {
    const f = fixture(); const path = `${f.origin}${f.hash}/${role === "glue" ? "engine.js" : "engine_bg.wasm"}`;
    const original = f.assets.get(path)!; const changed = original.slice(); changed[changed.length - 1] ^= 1;
    f.assets.set(path, damage === "checksum" ? changed : original.slice(1));
    const cache = new RustEngineCodeCache({ fetcher: f.fetcher, compile: f.compile });
    await assert.rejects(cache.prepare(f.artifact), /SHA-256|length/u);
    assert.equal(f.compilations(), 0); assert.equal(cache.diagnostics().entries, 0);
    f.assets.set(path, original); await cache.prepare(f.artifact); assert.equal(f.compilations(), 1); cache.dispose();
  });
}

test("selector and full manifest identity changes cannot reuse the wrong immutable code", async () => {
  const f = fixture(); const cache = new RustEngineCodeCache({ fetcher: f.fetcher, compile: f.compile, maximumEntries: 1 });
  const first = await cache.prepare(f.artifact);
  const secondHash = "b".repeat(64); f.publish(secondHash); f.select(secondHash);
  const second = await cache.prepare(f.artifact); assert.notEqual(first.identity, second.identity);
  assert.equal(second.artifact.buildHash, secondHash); assert.equal(cache.diagnostics().entries, 1);
  f.select(f.hash); await cache.prepare(f.artifact); assert.equal(f.compilations(), 3, "bounded eviction must not retain every published artifact");
  const manifestUrl = `${f.origin}${f.hash}/manifest.json`;
  f.assets.set(manifestUrl, text({ ...JSON.parse(new TextDecoder().decode(f.assets.get(manifestUrl))), note: "same files, changed manifest bytes" }));
  const changed = await cache.prepare(f.artifact); assert.notEqual(first.identity, changed.identity); assert.equal(f.compilations(), 4);
  cache.dispose();
});

test("duplicate roles, missing integrity metadata, and escaping asset paths fail closed", async () => {
  for (const mutate of [
    (value: ReturnType<ReturnType<typeof fixture>["publish"]>) => { value.files.push({ ...value.files[0] }); },
    (value: ReturnType<ReturnType<typeof fixture>["publish"]>) => { value.files[0].sha256 = ""; },
    (value: ReturnType<ReturnType<typeof fixture>["publish"]>) => { value.files[1].bytes = 0; },
    (value: ReturnType<ReturnType<typeof fixture>["publish"]>) => { value.files[0].path = "https://elsewhere.test/evil.js"; },
    (value: ReturnType<ReturnType<typeof fixture>["publish"]>) => { value.files[0].path = "../evil.js"; },
    (value: ReturnType<ReturnType<typeof fixture>["publish"]>) => { value.files[0].path = "%2e%2e/evil.js"; },
    (value: ReturnType<ReturnType<typeof fixture>["publish"]>) => { value.files[0].path = "folder\\evil.js"; },
  ]) {
    const f = fixture(); const manifest = f.publish(f.hash); mutate(manifest);
    f.assets.set(`${f.origin}${f.hash}/manifest.json`, text(manifest));
    const cache = new RustEngineCodeCache({ fetcher: f.fetcher, compile: f.compile });
    await assert.rejects(cache.prepare(f.artifact)); assert.equal(f.compilations(), 0); cache.dispose();
  }
});

test("disposal aborts owned acquisition and rejects late compile completion without repopulating cache", async () => {
  const f = fixture(); let started!: () => void; let finish!: (value: WebAssembly.Module) => void;
  const compiling = new Promise<void>(resolve => { started = resolve; });
  const cache = new RustEngineCodeCache({ fetcher: f.fetcher, compile: () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  const pending = cache.prepare(f.artifact); await compiling; cache.dispose();
  assert(f.calls.every(call => call.signal?.aborted), "every owned selector/asset acquisition signal must be aborted on dispose");
  finish(await WebAssembly.compile(wasm)); await assert.rejects(pending, /disposed|aborted/u);
  assert.equal(cache.diagnostics().entries, 0); await assert.rejects(cache.prepare(f.artifact), /disposed/u);
});

test("failed compilation is not cached and modules create independent instance memories", async () => {
  const f = fixture(); let first = true;
  const cache = new RustEngineCodeCache({ fetcher: f.fetcher, compile: async bytes => {
    if (first) { first = false; throw new Error("compile refused"); } return WebAssembly.compile(bytes.slice().buffer);
  } });
  await assert.rejects(cache.prepare(f.artifact), /compile refused/u); assert.equal(cache.diagnostics().entries, 0);
  const prepared = await cache.prepare(f.artifact); const a = await WebAssembly.instantiate(prepared.wasmModule); const b = await WebAssembly.instantiate(prepared.wasmModule);
  const left = a.exports.memory as WebAssembly.Memory; const right = b.exports.memory as WebAssembly.Memory;
  assert.notEqual(left, right); new Uint8Array(left.buffer)[0] = 79; assert.equal(new Uint8Array(right.buffer)[0], 0);
  const cloned = structuredClone(prepared); assert(cloned.wasmModule instanceof WebAssembly.Module); assert.notEqual(cloned.glueBytes.buffer, prepared.glueBytes.buffer);
  cache.dispose();
});

test("prepared-code verification snapshots module and identity before asynchronous hashing yields", async () => {
  const f = fixture(); const cache = new RustEngineCodeCache({ fetcher: f.fetcher });
  const prepared = await cache.prepare(f.artifact); const mutable = { ...prepared, glueBytes: prepared.glueBytes.slice() };
  const alternate = await WebAssembly.compile(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
  const pending = snapshotPreparedRustCode(mutable);
  mutable.identity = "f".repeat(64); mutable.wasmModule = alternate; mutable.glueBytes.fill(0);
  const result = await pending;
  assert.equal(result.identity, prepared.identity); assert.equal(result.wasmModule, prepared.wasmModule);
  assert.deepEqual(result.glueBytes, prepared.glueBytes); cache.dispose();
});

test("late failure from an evicted acquisition cannot remove a newer entry with the same identity", async () => {
  const f = fixture(); let began!: () => void; let finish!: (value: WebAssembly.Module) => void; let calls = 0;
  const firstCompile = new Promise<void>(resolve => { began = resolve; });
  const cache = new RustEngineCodeCache({ maximumEntries: 1, fetcher: f.fetcher, compile: bytes => {
    calls += 1;
    if (calls === 1) { began(); return new Promise(resolve => { finish = resolve; }); }
    return WebAssembly.compile(bytes.slice().buffer);
  } });
  const old = cache.prepare(f.artifact); const rejected = assert.rejects(old, /aborted/u); await firstCompile;
  const second = "b".repeat(64); f.publish(second); f.select(second); await cache.prepare(f.artifact);
  f.select(f.hash); const replacement = await cache.prepare(f.artifact);
  finish(await WebAssembly.compile(wasm)); await rejected;
  assert.equal(cache.diagnostics().entries, 1); assert.equal((await cache.prepare(f.artifact)).identity, replacement.identity);
  assert.equal(calls, 3); cache.dispose();
});
