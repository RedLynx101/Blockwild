import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the compile-time TypeScript rollback lifecycle never enters Rust ownership", () => {
  const fixture = fileURLToPath(new URL(
    "./fixtures/worldgen-typescript-rollback-lifecycle.fixture.ts",
    import.meta.url,
  ));
  const child = spawnSync(process.execPath, ["--import", "tsx", fixture], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE: "typescript-rollback",
    },
    timeout: 30_000,
    windowsHide: true,
  });

  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  assert.deepEqual(JSON.parse(child.stdout), {
    profile: "typescript-rollback",
    create: {
      sameMetadata: true,
      events: ["compatibility-create"],
      generationIdentity: null,
    },
    load: {
      sameResult: true,
      events: [
        "catalog-lookup",
        "touched-load:rollback-world:true",
        "engine-load:rollback-world",
      ],
      resultKeys: ["ok", "value", "warnings"],
      warnings: [{
        code: "corrupt",
        message: "Recovered the compatibility mirror after a stale optional snapshot.",
        key: "rollback-world",
      }],
      generationIdentity: null,
    },
    quit: {
      events: [
        "origin-preflight-cancel",
        "locator-consumers-cancel",
        "terrain-readiness-abort",
        "input-clear",
        "authority-drain",
        "authority-drain",
        "container-close",
        "native-binding-check:Save & Quit",
        "save",
        "authority-drain",
        "persistence-flush",
        "multiplayer-disconnect:quit-to-title",
        "authority-drain",
        "player-authority-dispose",
        "renderer-dispose",
      ],
      warnings: [
        "World saved, but native shutdown needs recovery (multiplayer disconnect: rollback network close failed)",
      ],
      hydration: "blocked",
    },
    shutdown: {
      events: [
        "origin-preflight-cancel",
        "locator-consumers-cancel",
        "terrain-readiness-abort",
        "input-clear",
        "animation-cancel:41",
        "events-unbind",
        "authority-drain",
        "authority-drain",
        "native-binding-check:Engine shutdown",
        "save:false",
        "authority-drain",
        "persistence-flush",
        "multiplayer-disconnect:engine-shutdown",
        "authority-drain",
        "player-authority-dispose",
        "renderer-dispose",
        "browser-resources-dispose",
      ],
      hydration: "none",
    },
    forbiddenRustCalls: [],
  });
});
