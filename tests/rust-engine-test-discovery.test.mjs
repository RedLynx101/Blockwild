import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runRustEngineTests, selectRustEngineTestFiles } from "../scripts/run-rust-engine-tests.mjs";

const entry = (name, isFile = true) => ({ name, isFile: () => isFile });

test("Rust engine discovery includes all three test families in deterministic filename order", () => {
  const entries = [entry("rust-z.test.ts"), entry("renderer-b.test.mjs"), entry("r3-b.test.ts"),
    entry("rust-a.test.mjs"), entry("r3-a.test.mjs"), entry("renderer-a.test.ts")];
  const expected = ["tests/r3-a.test.mjs", "tests/r3-b.test.ts", "tests/renderer-a.test.ts",
    "tests/renderer-b.test.mjs", "tests/rust-a.test.mjs", "tests/rust-z.test.ts"];
  assert.deepEqual(selectRustEngineTestFiles(entries), expected);
  assert.deepEqual(selectRustEngineTestFiles([...entries].reverse()), expected);
  assert.deepEqual(entries.map(item => item.name), ["rust-z.test.ts", "renderer-b.test.mjs", "r3-b.test.ts",
    "rust-a.test.mjs", "r3-a.test.mjs", "renderer-a.test.ts"], "selection must not mutate discovery input");
});

test("Rust engine discovery excludes directories and unrelated or malformed test names", () => {
  const rejected = [entry("r3-directory.test.ts", false), entry("renderer-link.test.mjs", false),
    ...["r30-other.test.ts", "r3-.test.ts", "r3-case.ts", "r3-case.test.js", "r3-case.test.ts.bak",
      "R3-case.test.ts", "world-engine.test.ts", "rust-case.test.mjs.map", ".r3-hidden.test.ts"].map(name => entry(name))];
  assert.deepEqual(selectRustEngineTestFiles(rejected), []);
});

test("the checked-in R3 verifier and clock suites are discoverable without executing them", () => {
  const directory = resolve(import.meta.dirname);
  const entries = readdirSync(directory, { withFileTypes: true });
  const discovered = selectRustEngineTestFiles(entries);
  const r3 = entries.filter(item => item.isFile() && /^r3-.+\.test\.(?:mjs|ts)$/u.test(item.name))
    .map(item => `tests/${item.name}`).sort();
  assert(r3.length >= 3, "expected the checked-in R3 production/performance suites");
  assert.deepEqual(discovered.filter(name => name.startsWith("tests/r3-")), r3);
  assert(discovered.includes("tests/rust-engine-test-discovery.test.mjs"));
});

test("the runner forwards the complete selection once and propagates child status without spawning real tests", () => {
  const calls = []; const messages = []; const root = resolve("work/discovery-fixture");
  const status = runRustEngineTests({ root, entries: [entry("rust-b.test.ts"), entry("r3-a.test.mjs")],
    log: message => messages.push(message), spawn: (...args) => { calls.push(args); return { status: 7 }; } });
  assert.equal(status, 7); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [process.execPath, ["--import", "tsx", "--test", "tests/r3-a.test.mjs", "tests/rust-b.test.ts"],
    { cwd: root, env: process.env, stdio: "inherit", windowsHide: true }]);
  assert.deepEqual(messages, ["Running 2 Rust engine, renderer, and R3 test files."]);
});

test("discovery fails closed when empty and preserves spawn errors or missing child status", () => {
  const spawn = () => { assert.fail("empty discovery must not spawn a process"); };
  assert.throws(() => runRustEngineTests({ entries: [], spawn, log: () => {} }), /No Rust engine, renderer, or R3 tests/u);
  const error = new Error("synthetic spawn failure");
  assert.throws(() => runRustEngineTests({ entries: [entry("r3-a.test.ts")],
    spawn: () => ({ error }), log: () => {} }), value => value === error);
  assert.equal(runRustEngineTests({ entries: [entry("r3-a.test.ts")], spawn: () => ({ status: null }), log: () => {} }), 1);
});
