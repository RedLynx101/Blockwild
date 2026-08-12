import assert from "node:assert/strict";
import test from "node:test";

import {
  RustWorldRuntimeManagerV1,
  RustWorldRuntimeSupersededErrorV1,
  rustWorldRuntimeFingerprintV1,
  type RustWorldRuntimeManagedHostV1,
} from "../app/game/rust-world-runtime-manager";
import type {
  RustWorldRuntimeAdapterV1,
  RustWorldRuntimeHostConfigV1,
  RustWorldRuntimeHostDiagnosticsV1,
} from "../app/game/rust-world-runtime-host";
import type { RustMultiplayerAuthorityV1 } from "../app/game/rust-multiplayer-authority";
import type { RustIntegratedRuntimeServiceV1 } from "../app/game/rust-integrated-runtime-service";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1 } from "../app/game/rust-integrated-runtime-contract";

const config = (locationId: string): RustWorldRuntimeHostConfigV1 => Object.freeze({
  worldSeed: `seed:${locationId}`,
  universeId: "universe:test",
  locationId,
  sessionId: `session:${locationId}`,
  generatorHash: "a".repeat(32),
  ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
  waterBlockId: 7,
  directionalBlockIds: Object.freeze([9, 2, 9]),
  waterloggedBlockIds: Object.freeze([18]),
});

type Deferred = Readonly<{ promise: Promise<void>; resolve: () => void }>;
function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

class FakeHost implements RustWorldRuntimeManagedHostV1 {
  readonly calls: string[] = [];
  readonly service = Object.freeze({ fixture: "managed-runtime-service" }) as unknown as RustIntegratedRuntimeServiceV1;
  startGate: Deferred | null = null;
  state: RustWorldRuntimeHostDiagnosticsV1["state"] = "idle";

  constructor(readonly config: RustWorldRuntimeHostConfigV1) {}

  async start() {
    this.calls.push("start");
    this.state = "starting";
    await this.startGate?.promise;
    this.state = "ready";
  }

  async shutdown() {
    this.calls.push("shutdown");
    this.state = "stopped";
  }

  multiplayerAuthority() { return {} as RustMultiplayerAuthorityV1; }
  authorityInterest() { return {} as ReturnType<RustWorldRuntimeManagedHostV1["authorityInterest"]>; }
  runtimeAdapter() { return {} as RustWorldRuntimeAdapterV1; }
  runtimeService() { return this.service; }

  diagnostics(): RustWorldRuntimeHostDiagnosticsV1 {
    return Object.freeze({
      state: this.state,
      artifactHash: null,
      contentHash: null,
      generatorHash: this.config.generatorHash,
      identity: null,
      adapter: null,
      lastError: null,
    });
  }
}

test("fingerprint canonicalizes catalog sets without hiding world identity", () => {
  assert.equal(
    rustWorldRuntimeFingerprintV1(config("surface")),
    rustWorldRuntimeFingerprintV1({ ...config("surface"), directionalBlockIds: [2, 9] }),
  );
  assert.notEqual(rustWorldRuntimeFingerprintV1(config("surface")), rustWorldRuntimeFingerprintV1(config("moon")));
});

test("an exact active world is reused while a different world drains first", async () => {
  const hosts: FakeHost[] = [];
  const manager = new RustWorldRuntimeManagerV1({ hostFactory: (value) => {
    const host = new FakeHost(value); hosts.push(host); return host;
  } });
  const surface = await manager.activate(config("surface"));
  assert.equal(await manager.activate({ ...config("surface"), directionalBlockIds: [2, 9] }), surface);
  const moon = await manager.activate(config("moon"));
  assert.notEqual(surface, moon);
  assert.deepEqual(hosts[0].calls, ["start", "shutdown"]);
  assert.deepEqual(hosts[1].calls, ["start"]);
  assert.equal(manager.diagnostics().state, "ready");
  await manager.shutdown();
  assert.deepEqual(hosts[1].calls, ["start", "shutdown"]);
});

test("a newer activation can never expose a superseded worker", async () => {
  const hosts: FakeHost[] = [];
  const gate = deferred();
  const manager = new RustWorldRuntimeManagerV1({ hostFactory: (value) => {
    const host = new FakeHost(value);
    if (hosts.length === 0) host.startGate = gate;
    hosts.push(host);
    return host;
  } });
  const first = manager.activate(config("surface"));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const second = manager.activate(config("moon"));
  gate.resolve();
  await assert.rejects(first, RustWorldRuntimeSupersededErrorV1);
  const current = await second;
  assert.equal(current.config.locationId, "moon");
  assert.deepEqual(hosts[0].calls, ["start", "shutdown"]);
  assert.equal(manager.requireReady(), current);
});

test("readiness fails closed before activation and after shutdown", async () => {
  const hosts: FakeHost[] = [];
  const manager = new RustWorldRuntimeManagerV1({ hostFactory: (value) => {
    const host = new FakeHost(value);
    hosts.push(host);
    return host;
  } });
  assert.throws(() => manager.requireReady(), /not ready/u);
  assert.throws(() => manager.runtimeService(), /not ready/u);
  await manager.activate(config("surface"));
  assert.equal(manager.requireReady().config.locationId, "surface");
  assert.equal(manager.runtimeService(), hosts[0].service, "manager forwards the active host's exact service");
  await manager.shutdown();
  assert.throws(() => manager.requireReady(), /not ready/u);
  assert.throws(() => manager.runtimeService(), /not ready/u);
});
