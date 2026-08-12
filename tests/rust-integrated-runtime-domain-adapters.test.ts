import assert from "node:assert/strict";
import test from "node:test";
import {
  RUST_INTEGRATED_NETWORK_REQUEST_TYPE_V1,
  RUST_INTEGRATED_NETWORK_RESPONSE_TYPE_V1,
  RustIntegratedNetworkRuntimePortV1,
} from "../app/game/rust-integrated-runtime-domain-adapters.ts";
import {
  RUST_INTEGRATED_NETWORK_COMMAND_RELEASE_TYPE_V1,
  decodeRustIntegratedNetworkCommandReleaseV1,
} from "../app/game/rust-integrated-runtime-network-lifecycle.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import type {
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeResponseV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1 } from "../app/game/rust-integrated-runtime-contract.ts";
import { RustIntegratedRuntimeServiceV1 } from "../app/game/rust-integrated-runtime-service.ts";

const ZERO_HASH = "0".repeat(32);
const CAPABILITIES = Object.freeze([
  "awaited-receipts-v1",
  "bounded-extraction-v1",
  "fixed-step-input-v1",
  "integrated-runtime-v1",
]);

function identity(tick = 0): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "1",
    locationId: "surface",
    revision: Object.freeze({ epoch: 1, world: 0, entities: 0, gameplay: 0, persistence: 0, network: tick, simulation: 0 }),
    tick,
    stateHash: tick.toString(16).padStart(32, "0"),
  });
}

test("network port keeps complete BWRN/BWNA packets opaque and idempotent", async () => {
  let current = identity();
  let commandCalls = 0;
  const expectedResponse = Uint8Array.from([0x42, 0x57, 0x4e, 0x41, 0x80, 0xff]);
  const service = new RustIntegratedRuntimeServiceV1({
    mode: "protocol-test",
    transportFactory: () => ({
      async request(request): Promise<RustIntegratedRuntimeResponseV1> {
        if (request.type === "runtime-create-v1") return {
          type: "runtime-ready-v1", requestId: request.requestId, clientEpoch: request.clientEpoch, workerEpoch: 1,
          runtimeHandle: 1, identity: current, artifactHash: "fixture", instanceId: "fixture", capabilities: CAPABILITIES,
        };
        if (request.type !== "runtime-command-v1") throw new Error(`unexpected ${request.type}`);
        commandCalls += 1;
        assert.equal(request.batch.operations.length, 1);
        assert.equal(request.batch.operations[0].typeId, RUST_INTEGRATED_NETWORK_REQUEST_TYPE_V1);
        assert.deepEqual([...request.batch.operations[0].payload], [0x42, 0x57, 0x52, 0x4e, 0x80, 0xff]);
        const before = current;
        current = identity(current.tick + 1);
        return {
          type: "runtime-command-receipt-v1", requestId: request.requestId, clientEpoch: request.clientEpoch, workerEpoch: 1,
          receipt: {
            status: "accepted", commandId: request.batch.commandId, idempotencyKey: request.batch.idempotencyKey,
            commandHash: request.batch.commandHash, before, after: current,
            domainReceipts: [createRustIntegratedRuntimeDomainOperationV1({
              domain: "network", typeId: RUST_INTEGRATED_NETWORK_RESPONSE_TYPE_V1, schema: 1, payload: expectedResponse,
            })],
            receiptHash: ZERO_HASH,
          },
        };
      },
      dispose() {},
    }),
  });
  await service.start({
    worldSeed: "fixture", universeId: "1", locationId: "surface", sessionId: "fixture",
    contentHash: ZERO_HASH, generatorHash: ZERO_HASH, waterBlockId: 7, directionalBlockIds: [], waterloggedBlockIds: [],
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
  });
  const port = new RustIntegratedNetworkRuntimePortV1(service);
  const request = Uint8Array.from([0x42, 0x57, 0x52, 0x4e, 0x80, 0xff]);
  assert.deepEqual([...await port.request(request, [request.buffer])], [...expectedResponse]);
  assert.deepEqual([...await port.request(request, [request.buffer])], [...expectedResponse]);
  assert.equal(commandCalls, 1, "an exact BWRN retry reuses its awaited integrated receipt");
});

test("network port awaits Rust command-lease release before resolving", async () => {
  let current = identity();
  let releases = 0;
  const service = new RustIntegratedRuntimeServiceV1({
    mode: "protocol-test",
    transportFactory: () => ({
      async request(request): Promise<RustIntegratedRuntimeResponseV1> {
        if (request.type === "runtime-create-v1") return {
          type: "runtime-ready-v1", requestId: request.requestId, clientEpoch: request.clientEpoch, workerEpoch: 1,
          runtimeHandle: 1, identity: current, artifactHash: "fixture", instanceId: "fixture", capabilities: CAPABILITIES,
        };
        if (request.type !== "runtime-command-v1") throw new Error(`unexpected ${request.type}`);
        const operation = request.batch.operations[0];
        assert.equal(operation.typeId, RUST_INTEGRATED_NETWORK_COMMAND_RELEASE_TYPE_V1);
        assert.equal(decodeRustIntegratedNetworkCommandReleaseV1(operation.payload), "command:🌿");
        releases += 1;
        const before = current;
        current = identity(current.tick + 1);
        return {
          type: "runtime-command-receipt-v1", requestId: request.requestId, clientEpoch: request.clientEpoch, workerEpoch: 1,
          receipt: {
            status: "accepted", commandId: request.batch.commandId, idempotencyKey: request.batch.idempotencyKey,
            commandHash: request.batch.commandHash, before, after: current,
            domainReceipts: [createRustIntegratedRuntimeDomainOperationV1({
              domain: "network", typeId: "blockwild.network.command.release-receipt.v1", schema: 1, payload: new Uint8Array(),
            })],
            receiptHash: ZERO_HASH,
          },
        };
      },
      dispose() {},
    }),
  });
  await service.start({
    worldSeed: "fixture", universeId: "1", locationId: "surface", sessionId: "fixture",
    contentHash: ZERO_HASH, generatorHash: ZERO_HASH, waterBlockId: 7, directionalBlockIds: [], waterloggedBlockIds: [],
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
  });
  const port = new RustIntegratedNetworkRuntimePortV1(service);
  await port.releaseCommand("command:🌿");
  assert.equal(releases, 1);
});
