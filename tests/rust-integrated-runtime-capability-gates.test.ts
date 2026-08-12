import assert from "node:assert/strict";
import test from "node:test";

import {
  RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
  type RustIntegratedRuntimeConfigV1,
  type RustIntegratedRuntimeIdentityV1,
  type RustIntegratedRuntimeResponseV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RustIntegratedRuntimeServiceError,
  RustIntegratedRuntimeServiceV1,
} from "../app/game/rust-integrated-runtime-service.ts";

const ARTIFACT_HASH = "a".repeat(64);
const ZERO_HASH = "0".repeat(32);

const identity: RustIntegratedRuntimeIdentityV1 = Object.freeze({
  universeId: "capability-test",
  locationId: "surface",
  revision: Object.freeze({ epoch: 1, world: 0, entities: 0, gameplay: 0, persistence: 0, network: 0, simulation: 0 }),
  tick: 0,
  stateHash: ZERO_HASH,
});

const config: RustIntegratedRuntimeConfigV1 = Object.freeze({
  worldSeed: "capability-test",
  universeId: identity.universeId,
  locationId: identity.locationId,
  sessionId: "capability-test-session",
  contentHash: ZERO_HASH,
  generatorHash: ZERO_HASH,
  ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
  waterBlockId: 7,
  directionalBlockIds: Object.freeze([]),
  waterloggedBlockIds: Object.freeze([]),
});

function service(capabilities: readonly string[]) {
  return new RustIntegratedRuntimeServiceV1({
    expectedArtifactHash: ARTIFACT_HASH,
    transportFactory: () => ({
      async request(request): Promise<RustIntegratedRuntimeResponseV1> {
        if (request.type === "runtime-create-v1") return {
          type: "runtime-ready-v1",
          requestId: request.requestId,
          clientEpoch: request.clientEpoch,
          workerEpoch: 1,
          runtimeHandle: 1,
          identity,
          artifactHash: ARTIFACT_HASH,
          instanceId: "capability-test",
          capabilities,
        };
        if (request.type === "runtime-extract-v1") return {
          type: "runtime-extraction-v1",
          requestId: request.requestId,
          clientEpoch: request.clientEpoch,
          workerEpoch: 1,
          extraction: Object.freeze({
            identity,
            extractionRevision: 1,
            render: new Uint8Array(),
            hud: new Uint8Array(),
            audio: new Uint8Array(),
            platformRequests: new Uint8Array(),
            diagnostics: new Uint8Array(),
            extractionHash: ZERO_HASH,
          }),
        };
        if (request.type === "runtime-shutdown-v1") return {
          type: "runtime-shutdown-v1",
          requestId: request.requestId,
          clientEpoch: request.clientEpoch,
          workerEpoch: 1,
        };
        throw new Error(`unexpected ${request.type}`);
      },
      dispose() {},
    }),
  });
}

test("pending live capabilities initialize base authority but keep fixed-step cutover closed", async () => {
  const runtime = service([
    "integrated-runtime-v1",
    "awaited-receipts-v1",
    "bounded-entity-extraction-v1",
    "bounded-extraction-blockers-v1",
    "bounded-extraction-v1-pending-live-domain-views",
    "fixed-step-input-v1-pending-live-cutover",
  ]);
  await runtime.start(config);

  const diagnostics = runtime.diagnostics();
  assert.equal(diagnostics.authoritative, true, "base command authority is separately attested");
  assert.equal(diagnostics.fixedStepInputReady, false);
  assert.equal(diagnostics.boundedExtractionAvailable, true);
  assert.equal(diagnostics.boundedExtractionReady, false);
  assert.equal(diagnostics.liveAuthorityReady, false);
  assert.throws(
    () => runtime.step(50_000, 8_000, []),
    (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "not-authoritative",
  );
  assert.equal((await runtime.extract(0)).extractionRevision, 1, "bounded blocker-bearing extraction remains available for shadow evidence");
  await runtime.shutdown();
});

test("complete input and extraction capabilities are reported independently", async () => {
  const runtime = service([
    "integrated-runtime-v1",
    "awaited-receipts-v1",
    "fixed-step-input-v1",
    "bounded-extraction-v1",
  ]);
  await runtime.start(config);
  const diagnostics = runtime.diagnostics();
  assert.equal(diagnostics.fixedStepInputReady, true);
  assert.equal(diagnostics.boundedExtractionAvailable, true);
  assert.equal(diagnostics.boundedExtractionReady, true);
  assert.equal(diagnostics.liveAuthorityReady, true);
  await runtime.shutdown();
});

test("base command authority still rejects an artifact without awaited receipts", async () => {
  const runtime = service(["integrated-runtime-v1", "bounded-extraction-v1"]);
  await assert.rejects(
    runtime.start(config),
    (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "invalid-response",
  );
  assert.equal(runtime.diagnostics().state, "failed");
});
