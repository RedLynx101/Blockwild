import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_RUST_LIVE_PLAYER_AUTHORITY_MODE_R5,
  RUST_LIVE_PLAYER_AUTHORITY_EXPERIMENT_ENV_R5,
  RUST_LIVE_PLAYER_AUTHORITY_EXPERIMENT_QUERY_R5,
  configuredRustLivePlayerAuthoritySelectionR5,
  resolveRustLivePlayerAuthoritySelectionR5,
} from "../app/game/rust-live-player-authority-selection-r5.ts";

test("live Rust player authority is off by default and during SSR", () => {
  assert.equal(DEFAULT_RUST_LIVE_PLAYER_AUTHORITY_MODE_R5, "off");
  assert.deepEqual(resolveRustLivePlayerAuthoritySelectionR5(), {
    mode: "off",
    source: "default-off",
  });
  assert.deepEqual(configuredRustLivePlayerAuthoritySelectionR5(), {
    mode: "off",
    source: "default-off",
  });
});

test("only the exact experimental query key and r5 value opt in", () => {
  assert.equal(RUST_LIVE_PLAYER_AUTHORITY_EXPERIMENT_QUERY_R5, "experimental.rust-live-player-authority");
  assert.deepEqual(resolveRustLivePlayerAuthoritySelectionR5({
    search: "?experimental.rust-live-player-authority=r5",
  }), {
    mode: "experimental-r5",
    source: "query-experimental-r5",
  });
  for (const search of [
    "?experimental.rust-live-player-authority=R5",
    "?experimental.rust-live-player-authority=r5%20",
    "?experimental.rust-live-player-authority=true",
    "?experimental.rust-live-player-authority-r5=r5",
    "?experimental.rust-live-player-authority.extra=r5",
    "?rust-live-player-authority=r5",
  ]) {
    assert.equal(resolveRustLivePlayerAuthoritySelectionR5({ search }).mode, "off", search);
  }
});

test("only the exact narrowly named environment value opts in", () => {
  assert.equal(RUST_LIVE_PLAYER_AUTHORITY_EXPERIMENT_ENV_R5, "NEXT_PUBLIC_BLOCKWILD_EXPERIMENTAL_RUST_LIVE_PLAYER_AUTHORITY_R5");
  assert.deepEqual(resolveRustLivePlayerAuthoritySelectionR5({ experimentalEnvironment: "1" }), {
    mode: "experimental-r5",
    source: "environment-experimental-r5",
  });
  for (const experimentalEnvironment of ["", "0", "01", "true", "TRUE", "1 "]) {
    assert.equal(resolveRustLivePlayerAuthoritySelectionR5({ experimentalEnvironment }).mode, "off", experimentalEnvironment);
  }
});

test("VoxelGame snapshots the selection and passes only its mode into one engine", () => {
  const source = readFileSync(new URL("../app/game/VoxelGame.tsx", import.meta.url), "utf8");
  assert.match(source, /const rustLivePlayerAuthoritySelection = configuredRustLivePlayerAuthoritySelectionR5\(\);/u);
  assert.match(source, /new VoxelEngine\(canvas, \{[\s\S]*?\}, settings, \{[\s\S]*?rustLivePlayerAuthorityMode: rustLivePlayerAuthoritySelection\.mode,/u);
  assert.equal(source.match(/configuredRustLivePlayerAuthoritySelectionR5\(\)/gu)?.length, 1);
  assert.doesNotMatch(source, /new URLSearchParams\(window\.location\.search\)\.get\("experimental\.rust-live-player-authority"\)/u);
});
