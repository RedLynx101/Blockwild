import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { acquireManagedBrowserGateMutex, assertR5ArtifactCurrentSource } from "./verify-rust-r5-player-browser.mjs";
import { createRustEngineSourceSnapshot, validatePublishedArtifacts } from "./rust-engine-common.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "work/hybrid-rust-migration/schema-browser", new Date().toISOString().replaceAll(/[:.]/gu, "-"));
const client = path.join(process.env.USERPROFILE, ".codex/skills/develop-web-game/scripts/web_game_playwright_client.js");
const validation = validatePublishedArtifacts(path.join(root, "public/engine-schema-candidate"));
const artifact = validation.artifacts.find(entry => entry.variant === "compatibility");
assert(artifact, "isolated candidate has no compatibility artifact");
const source = assertR5ArtifactCurrentSource(artifact, createRustEngineSourceSnapshot(root));
const canonicalBefore = JSON.stringify(validatePublishedArtifacts(path.join(root, "public/engine")));
const mutex = await acquireManagedBrowserGateMutex(root);
let server;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    configFile: false, root, logLevel: "warn", resolve: { alias: { "@": root } },
    server: { host: "127.0.0.1", port: 0, strictPort: false, fs: { allow: [root] } },
    optimizeDeps: { noDiscovery: true },
  });
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/tests/fixtures/rust-schema-convergence-browser.html`;
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [client, "--url", url, "--click-selector", "#run", "--actions-json", JSON.stringify({ steps: [{ buttons: [], frames: 2 }] }), "--iterations", "1", "--screenshot-dir", output], { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(exitCode, 0, "browser client failed");
  const state = JSON.parse(await readFile(path.join(output, "state-0.json"), "utf8"));
  assert.equal(state.status, "passed", JSON.stringify(state));
  assert.equal(state.runtimeDestroyed, true);
  assert.equal(state.checks.length, 9);
  assert.equal(state.artifactHash, artifact.hash);
  assert(!(await readdir(output)).some(name => name.startsWith("errors-")), "browser console/page errors were recorded");
  console.log(JSON.stringify({ output, ...state }, null, 2));
} finally {
  await server?.close();
  await mutex.release();
  const sourceUnchanged = createRustEngineSourceSnapshot(root).digest === source.digest;
  const canonicalUnchanged = JSON.stringify(validatePublishedArtifacts(path.join(root, "public/engine"))) === canonicalBefore;
  await writeFile(path.join(output, "cleanup.json"), JSON.stringify({ serverClosed: !server?.httpServer?.listening, sourceUnchanged, canonicalUnchanged, mutex: mutex.evidence }, null, 2));
  assert(sourceUnchanged && canonicalUnchanged, "source or canonical artifact changed during browser validation");
}
