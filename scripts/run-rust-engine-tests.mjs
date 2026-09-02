import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectInvocation } from "./rust-engine-common.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Pure selection keeps discovery testable without launching the complete suite. */
export function selectRustEngineTestFiles(entries) {
  return entries
    // R3's production seams predate the Rust-prefixed suites. Keep their
    // scheduler, worker lifecycle and original-file regressions in this gate.
    .filter((entry) => entry.isFile() && /^(?:(?:rust|renderer|r3|terrain-generation|world-streaming)-.+|world-import-source)\.test\.(?:mjs|ts)$/u.test(entry.name))
    .map((entry) => `tests/${entry.name}`)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function runRustEngineTests({
  root = repositoryRoot,
  entries = readdirSync(resolve(root, "tests"), { withFileTypes: true }),
  spawn = spawnSync,
  log = console.log,
} = {}) {
  const rustTests = selectRustEngineTestFiles(entries);
  if (rustTests.length === 0) throw new Error("No Rust engine, renderer, or R3 tests were discovered under tests/.");
  log(`Running ${rustTests.length} Rust engine, renderer, and R3 test files.`);
  const result = spawn(process.execPath, ["--import", "tsx", "--test", ...rustTests], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (isDirectInvocation(import.meta.url)) process.exit(runRustEngineTests());
