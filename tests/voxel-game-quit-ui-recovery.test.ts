import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatQuitToTitleFailure,
  runQuitToTitleWithUiRecovery,
} from "../app/game/VoxelGame.tsx";

test("quit UI recovery consumes a current-engine rejection and reports its exact cause", async () => {
  const events: string[] = [];
  const failure = "commit-record-capacity: native checkpoint 42 was rejected";

  const result = await runQuitToTitleWithUiRecovery({
    quitToTitle: async () => { throw new Error(failure); },
    isCurrentEngine: () => true,
    restoreHeldPresentation: () => { events.push("restore-held"); },
    reportFailure: (message) => { events.push(`failure:${message}`); },
  });

  assert.equal(result, "failed");
  assert.deepEqual(events, ["restore-held", `failure:${failure}`]);
});

test("quit UI recovery does not mutate the replacement engine after a rejected stale quit", async () => {
  let restored = false;
  let reported = false;

  const result = await runQuitToTitleWithUiRecovery({
    quitToTitle: async () => { throw new Error("stale runtime failed"); },
    isCurrentEngine: () => false,
    restoreHeldPresentation: () => { restored = true; },
    reportFailure: () => { reported = true; },
  });

  assert.equal(result, "superseded");
  assert.equal(restored, false);
  assert.equal(reported, false);
});

test("quit UI recovery only reports completion while the same engine remains current", async () => {
  assert.equal(await runQuitToTitleWithUiRecovery({
    quitToTitle: async () => undefined,
    isCurrentEngine: () => true,
    restoreHeldPresentation: () => assert.fail("successful quit must not restore held presentation"),
    reportFailure: () => assert.fail("successful quit must not report a failure"),
  }), "completed");

  assert.equal(await runQuitToTitleWithUiRecovery({
    quitToTitle: async () => undefined,
    isCurrentEngine: () => false,
    restoreHeldPresentation: () => assert.fail("superseded quit must not restore held presentation"),
    reportFailure: () => assert.fail("superseded quit must not report a failure"),
  }), "superseded");
});

test("quit UI recovery has a stable user-visible fallback for non-diagnostic failures", () => {
  assert.equal(formatQuitToTitleFailure(new Error("")), "Save & Quit could not finish the native checkpoint.");
  assert.equal(formatQuitToTitleFailure("native status receipt did not attest the checkpoint"), "native status receipt did not attest the checkpoint");
});

test("multiplayer-ended and guest-disconnect title exits share the guarded recovery path", () => {
  const source = readFileSync(new URL("../app/game/VoxelGame.tsx", import.meta.url), "utf8");
  const endedStart = source.indexOf("onMultiplayerEnded: (reason) => {");
  const endedEnd = source.indexOf("onRendererState:", endedStart);
  const ended = source.slice(endedStart, endedEnd);
  assert.ok(endedStart >= 0 && endedEnd > endedStart);
  assert.match(ended, /clearFirstPersonHeldPresentation\(engine\);[\s\S]*runQuitToTitleWithUiRecovery\(\{[\s\S]*restoreHeldPresentation: \(\) => prepareFirstPersonHeldPresentation\(engine\),[\s\S]*reportFailure: showToast,[\s\S]*if \(quitResult !== "completed"\) return;[\s\S]*engine\.previewWorld\("WILDERNESS"\)/u);

  const disconnectStart = source.indexOf("const disconnectMultiplayer = async () => {");
  const disconnectEnd = source.indexOf("const copyMultiplayerCode = async", disconnectStart);
  const disconnect = source.slice(disconnectStart, disconnectEnd);
  assert.ok(disconnectStart >= 0 && disconnectEnd > disconnectStart);
  assert.match(disconnect, /setMultiplayerState\(EMPTY_MULTIPLAYER_STATE\);[\s\S]*clearFirstPersonHeldPresentation\(engineRef\.current\);[\s\S]*runQuitToTitleWithUiRecovery\(\{[\s\S]*restoreHeldPresentation: \(\) => prepareFirstPersonHeldPresentation\(engine\),[\s\S]*setMultiplayerState\(\(current\) => \(\{ \.\.\.current, error: message \}\)\);[\s\S]*showToast\(message\);[\s\S]*if \(quitResult !== "completed"\) return;[\s\S]*engine\.previewWorld\("WILDERNESS"\)/u);
});
