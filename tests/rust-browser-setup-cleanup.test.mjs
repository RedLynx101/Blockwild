import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createTerrainEditOwnedSetup,
  createTerrainEditProfileRoot,
  safeRemoveTerrainEditOwnedDirectory,
} from "../scripts/verify-rust-terrain-edit-reload-browser.mjs";

const OWNED_PROFILE_ROOT_PATTERN = /^bw-terrain-/u;
const OWNED_PROFILE_PATTERN = /^browser-/u;
const OWNED_VITE_PATTERN = /^\.terrain-edit-vite-/u;

function assertNoOwnedResidue(directory, retainedProfile = null) {
  const entries = readdirSync(directory);
  assert.equal(entries.some((entry) => OWNED_PROFILE_ROOT_PATTERN.test(entry)
    && path.join(directory, entry) !== retainedProfile), false,
    `profile-root residue remained: ${entries.join(", ")}`);
  const output = path.join(directory, "output");
  if (existsSync(output)) {
    assert.equal(readdirSync(output).some((entry) => OWNED_VITE_PATTERN.test(entry)), false,
      `Vite-temp residue remained: ${readdirSync(output).join(", ")}`);
  }
}

test("owned browser setup fails closed at every creation stage without deleting unrelated profiles", () => {
  const temporaryParent = mkdtempSync(path.join(os.tmpdir(), "blockwild-setup-fault-test-"));
  const outputDirectory = path.join(temporaryParent, "output");
  mkdirSync(outputDirectory);
  const unrelatedProfile = mkdtempSync(path.join(temporaryParent, "bw-terrain-unrelated-"));
  writeFileSync(path.join(unrelatedProfile, "keep.txt"), "unrelated", "utf8");

  try {
    const failures = [
      ["profile-root", {
        createProfileRoot: () => { throw new Error("fault: profile-root"); },
      }],
      ["profile-child", {
        createProfileRoot: () => createTerrainEditProfileRoot(temporaryParent),
        createProfileDirectory: () => { throw new Error("fault: profile-child"); },
      }],
      ["Vite-temp", {
        createProfileRoot: () => createTerrainEditProfileRoot(temporaryParent),
        createViteRuntimeDirectory: () => { throw new Error("fault: Vite-temp"); },
      }],
    ];
    for (const [label, injection] of failures) {
      assert.throws(
        () => createTerrainEditOwnedSetup({
          outputDirectory,
          tempDirectory: temporaryParent,
          ...injection,
        }),
        new RegExp(`fault: ${label}`, "u"),
      );
      assert.equal(existsSync(unrelatedProfile), true, `${label} fault deleted unrelated profile`);
      assert.equal(existsSync(path.join(unrelatedProfile, "keep.txt")), true,
        `${label} fault deleted unrelated profile contents`);
      assertNoOwnedResidue(temporaryParent, unrelatedProfile);
    }
  } finally {
    safeRemoveTerrainEditOwnedDirectory(os.tmpdir(), temporaryParent, "blockwild-setup-fault-test-");
  }
});

test("owned browser setup returns three contained directories and cleans exact paths", () => {
  const temporaryParent = mkdtempSync(path.join(os.tmpdir(), "blockwild-setup-success-test-"));
  const outputDirectory = path.join(temporaryParent, "output");
  mkdirSync(outputDirectory);
  try {
    const setup = createTerrainEditOwnedSetup({ outputDirectory, tempDirectory: temporaryParent });
    assert.equal(path.dirname(setup.profileRoot), temporaryParent);
    assert.equal(path.dirname(setup.profileDirectory), setup.profileRoot);
    assert.equal(path.dirname(setup.viteRuntimeDirectory), outputDirectory);
    assert.match(path.basename(setup.profileRoot), OWNED_PROFILE_ROOT_PATTERN);
    assert.match(path.basename(setup.profileDirectory), OWNED_PROFILE_PATTERN);
    assert.match(path.basename(setup.viteRuntimeDirectory), OWNED_VITE_PATTERN);
    assert.equal(safeRemoveTerrainEditOwnedDirectory(setup.profileRoot, setup.profileDirectory, "browser-"), true);
    assert.equal(safeRemoveTerrainEditOwnedDirectory(temporaryParent, setup.profileRoot, "bw-terrain-"), true);
    assert.equal(safeRemoveTerrainEditOwnedDirectory(outputDirectory, setup.viteRuntimeDirectory, ".terrain-edit-vite-"), true);
    assertNoOwnedResidue(temporaryParent);
  } finally {
    safeRemoveTerrainEditOwnedDirectory(os.tmpdir(), temporaryParent, "blockwild-setup-success-test-");
  }
});
