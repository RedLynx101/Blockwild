import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as contract from "../app/game/terrain-generation-contract.ts";

// Execute the production message handler. Only the bridge/backend boundaries are
// synthetic here; immutable byte verification and real browser readiness have
// separate tests/gates. No fake worker implementation substitutes for this code.
const source = ts.transpileModule(readFileSync(new URL("../app/game/terrain-generation-worker.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function handler(certificates = true) {
  const sent: contract.TerrainGenerationWorkerResponseV2[] = [];
  const constructions: unknown[] = [];
  let initialize!: () => void; let reject!: (error: Error) => void;
  const initialization = new Promise<void>((resolve, fail) => { initialize = resolve; reject = fail; });
  const certificate = { freshlyRead: "generator" }; const locatorCertificate = { freshlyRead: "locator" };
  const surface = { onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (value: contract.TerrainGenerationWorkerResponseV2) => sent.push(value) };
  const dependencies: Record<string, unknown> = {
    "./terrain-generation-contract": contract,
    "./rust-terrain-generation-bridge": { RustTerrainGenerationBridgeV2: class {
      constructor(options: unknown) { constructions.push(options); }
      initialize() { return initialization; }
      diagnostics() { return certificates ? { certificate, locatorCertificate } : {}; }
    } },
    "./rust-terrain-generation-backend": { InjectedTerrainGenerationBackendV2: class {} },
  };
  runInNewContext(source, { exports: {}, self: surface, AbortController, DOMException, Error,
    require: (name: string) => { assert(name in dependencies, `unexpected worker import ${name}`); return dependencies[name]; } });
  return { sent, constructions, initialize, reject, certificate, locatorCertificate,
    send: (data: unknown) => { assert(surface.onmessage); surface.onmessage({ data }); } };
}
const bootstrap = () => ({ type: "initialize-terrain-generation-v2", bootstrapId: 7, code: { identity: "a".repeat(64) } });

test("production handler waits for explicit code and freshly initialized certificates before ready", async () => {
  const worker = handler(); await tick(); assert.equal(worker.constructions.length, 0); assert.equal(worker.sent.length, 0);
  const message = bootstrap(); worker.send(message); await tick(); assert.equal(worker.constructions.length, 1);
  assert.equal((worker.constructions[0] as { preparedCode: unknown }).preparedCode, message.code); assert.equal(worker.sent.length, 0);
  worker.initialize(); await tick(); const ready = worker.sent[0]; assert.equal(ready?.type, "terrain-generation-ready-v2");
  assert(ready.type === "terrain-generation-ready-v2"); assert.equal(ready.bootstrapId, 7); assert.equal(ready.codeIdentity, message.code.identity);
  assert.equal(ready.certificate, worker.certificate); assert.equal(ready.locatorCertificate, worker.locatorCertificate);
});

test("invalid bootstrap is terminal and cannot be followed by an executable bootstrap", async () => {
  const worker = handler(); worker.send({ ...bootstrap(), bootstrapId: 0 }); worker.send(bootstrap()); await tick();
  assert.equal(worker.constructions.length, 0); assert(worker.sent.every(message => message.type === "terrain-generation-startup-error-v2"));
});

test("duplicate bootstrap while initializing never publishes a ready certificate", async () => {
  const worker = handler(); worker.send(bootstrap()); await tick(); worker.send(bootstrap()); worker.initialize(); await tick();
  assert.equal(worker.constructions.length, 1); assert(worker.sent.length >= 1);
  assert(worker.sent.every(message => message.type === "terrain-generation-startup-error-v2"));
});

test("pre-startup tasks, missing certificates and initializer rejection cannot publish ready", async () => {
  const early = handler(); early.send({ type: "generate-chunk-v2", request: {} }); assert.equal(early.constructions.length, 0);
  assert.equal(early.sent[0]?.type, "terrain-generation-startup-error-v2");
  const missing = handler(false); missing.send(bootstrap()); missing.initialize(); await tick();
  assert.equal(missing.sent[0]?.type, "terrain-generation-startup-error-v2");
  const failed = handler(); failed.send(bootstrap()); await tick(); failed.reject(new Error("verification failed")); await tick();
  assert.equal(failed.sent[0]?.type, "terrain-generation-startup-error-v2");
});
