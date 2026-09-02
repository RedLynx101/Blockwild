#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUNTIME_ROOT = path.join(ROOT, ".sites-runtime");
const VALIDATE_ONLY = process.argv.slice(2).includes("--validate-only");

function durationMilliseconds(value, fallback, label) {
  if (value === undefined || value === "") return fallback;
  const match = /^(\d+)(ms|s|m)$/u.exec(value);
  if (!match) throw new Error(`${label} must be a positive integer followed by ms, s, or m.`);
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`${label} must be positive.`);
  const multiplier = match[2] === "m" ? 60_000 : match[2] === "s" ? 1_000 : 1;
  const milliseconds = amount * multiplier;
  if (!Number.isSafeInteger(milliseconds)) throw new Error(`${label} is too large.`);
  return milliseconds;
}

function runNode(args, label, timeoutMilliseconds, environment) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: environment,
    stdio: "inherit",
    timeout: timeoutMilliseconds,
    killSignal: "SIGTERM",
    windowsHide: true,
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`${label} exceeded its ${timeoutMilliseconds} ms deadline.`);
    }
    throw result.error;
  }
  if (result.signal) throw new Error(`${label} exited on signal ${result.signal}.`);
  if (result.status !== 0) throw new Error(`${label} exited with code ${String(result.status)}.`);
}

async function requireRegularFile(filePath, label) {
  const file = await stat(filePath);
  if (!file.isFile()) throw new Error(`${label} is not a regular file: ${filePath}`);
}

async function validateArtifact() {
  const workerPath = path.join(ROOT, "dist", "server", "index.js");
  const hostingPath = path.join(ROOT, "dist", ".openai", "hosting.json");
  await requireRegularFile(workerPath, "Sites Worker entry");
  await requireRegularFile(hostingPath, "Sites hosting manifest");
  JSON.parse(await readFile(hostingPath, "utf8"));

  const workerUrl = pathToFileURL(workerPath);
  workerUrl.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
  const worker = await import(workerUrl.href);
  if (!worker.default || typeof worker.default.fetch !== "function") {
    throw new Error("dist/server/index.js must have an ESM default export with fetch(request, env, ctx)");
  }
  process.stdout.write("Validated Sites artifact: ESM Worker default.fetch and hosting manifest are present.\n");
}

async function main() {
  const directories = [
    path.join(RUNTIME_ROOT, "npm-cache"),
    path.join(RUNTIME_ROOT, "xdg-config"),
    path.join(RUNTIME_ROOT, "tmp"),
    path.join(RUNTIME_ROOT, "wrangler", "logs"),
  ];
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));

  const environment = {
    ...process.env,
    SITES_ENV_READY: "1",
    SITES_PROJECT_ROOT: ROOT,
    XDG_CONFIG_HOME: path.join(RUNTIME_ROOT, "xdg-config"),
    TMPDIR: path.join(RUNTIME_ROOT, "tmp"),
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: path.join(RUNTIME_ROOT, "wrangler", "logs"),
    MINIFLARE_REGISTRY_PATH: path.join(RUNTIME_ROOT, "wrangler", "registry"),
  };

  if (!VALIDATE_ONLY) {
    const wikiTimeout = durationMilliseconds(process.env.SITES_WIKI_BUILD_TIMEOUT, 120_000, "SITES_WIKI_BUILD_TIMEOUT");
    const buildTimeout = durationMilliseconds(process.env.SITES_BUILD_TIMEOUT, 480_000, "SITES_BUILD_TIMEOUT");
    const vinextCli = path.join(ROOT, "node_modules", "vinext", "dist", "cli.js");
    await requireRegularFile(vinextCli, "Vinext CLI");
    process.stdout.write("Running bounded Vinext build...\n");
    runNode(["--import", "tsx", path.join(ROOT, "scripts", "build-wiki-content.ts")], "wiki content build", wikiTimeout, environment);
    runNode([vinextCli, "build"], "Vinext build", buildTimeout, environment);
  }

  await validateArtifact();
}

await main();
