import assert from "node:assert/strict";
import test from "node:test";
import {
  RUST_INTEGRATED_NETWORK_REQUEST_TYPE_V1,
  RUST_INTEGRATED_NETWORK_RESPONSE_TYPE_V1,
  RustIntegratedNetworkRuntimePortV1,
} from "../app/game/rust-integrated-runtime-domain-adapters.ts";
import {
  RUST_INTEGRATED_NETWORK_COMMAND_RELEASE_TYPE_V1,
  RUST_INTEGRATED_NETWORK_DELTA_BUILD_TYPE_V1,
  RUST_INTEGRATED_NETWORK_RECONNECT_RESPONSE_TYPE_V1,
  RUST_INTEGRATED_NETWORK_RECONNECT_TYPE_V1,
  RUST_INTEGRATED_NETWORK_REPLICATION_UPSERT_TYPE_V1,
  decodeRustIntegratedNetworkCommandReleaseV1,
} from "../app/game/rust-integrated-runtime-network-lifecycle.ts";
import {
  createNetworkAuthorityIdentityV1,
  createNetworkInterestSetV1,
} from "../app/game/network-authority-contract.ts";
import { RustNetworkRuntimeContractError } from "../app/game/rust-network-runtime-contract.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import type {
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeResponseV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RustIntegratedRuntimeServiceError,
  RustIntegratedRuntimeServiceV1,
} from "../app/game/rust-integrated-runtime-service.ts";

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

function acknowledgement(magic: string, requestPayload: Uint8Array, stateHash: string) {
  const packet = new Uint8Array(38);
  packet.set(new TextEncoder().encode(magic), 0);
  new DataView(packet.buffer).setUint16(4, 1, true);
  for (const [hash, offset] of [
    [rustIntegratedRuntimeWireChecksumV1(requestPayload), 6],
    [stateHash, 22],
  ] as const) {
    packet.set(Uint8Array.from(
      { length: 16 },
      (_, index) => Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16),
    ), offset);
  }
  return packet;
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
              domain: "network", typeId: "blockwild.network.command.release-receipt.v1", schema: 1,
              payload: acknowledgement("BWM9", operation.payload, current.stateHash),
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

test("network port rejects native acknowledgements that do not attest request and resulting state", async (t) => {
  for (const [name, byteOffset, code] of [
    ["request payload", 6, "response-request-hash"],
    ["resulting state", 22, "response-state-hash"],
  ] as const) {
    await t.test(name, async () => {
      let current = identity();
      const runtime = {
        identity() { return current; },
        async command(batch: RustIntegratedRuntimeCommandBatchV1) {
          const before = current;
          current = identity(1);
          const operation = batch.operations[0]!;
          const payload = acknowledgement("BWM9", operation.payload, current.stateHash);
          payload[byteOffset] ^= 1;
          return {
            status: "accepted" as const,
            commandId: batch.commandId,
            idempotencyKey: batch.idempotencyKey,
            commandHash: batch.commandHash,
            before,
            after: current,
            domainReceipts: [createRustIntegratedRuntimeDomainOperationV1({
              domain: "network",
              typeId: "blockwild.network.command.release-receipt.v1",
              schema: 1,
              payload,
            })],
            receiptHash: ZERO_HASH,
          };
        },
      } as unknown as RustIntegratedRuntimeServiceV1;
      const port = new RustIntegratedNetworkRuntimePortV1(runtime);

      await assert.rejects(port.releaseCommand("command:attestation"), (error: unknown) => (
        error instanceof RustNetworkRuntimeContractError && error.code === code
      ));
    });
  }
});

test("network lifecycle re-authors only a pre-dispatch stale integrated command", async () => {
  let current = identity();
  let calls = 0;
  const expectedIdentities: RustIntegratedRuntimeIdentityV1[] = [];
  const runtime = {
    identity() { return current; },
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      calls += 1;
      expectedIdentities.push(batch.expected);
      if (calls === 1) {
        current = identity(1);
        throw new RustIntegratedRuntimeServiceError(
          "stale-command",
          "a competing native domain advanced before network dispatch",
        );
      }
      assert.deepEqual(batch.expected, current);
      const before = current;
      current = identity(2);
      const operation = batch.operations[0]!;
      return {
        status: "accepted" as const,
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        before,
        after: current,
        domainReceipts: [createRustIntegratedRuntimeDomainOperationV1({
          domain: "network",
          typeId: "blockwild.network.command.release-receipt.v1",
          schema: 1,
          payload: acknowledgement("BWM9", operation.payload, current.stateHash),
        })],
        receiptHash: ZERO_HASH,
      };
    },
  } as unknown as RustIntegratedRuntimeServiceV1;
  const port = new RustIntegratedNetworkRuntimePortV1(runtime);

  await port.releaseCommand("command:race");

  assert.equal(calls, 2);
  assert.deepEqual(expectedIdentities, [identity(0), identity(1)]);
});

test("delta construction preserves its authored authority identities instead of blanket re-authoring", async () => {
  let current = identity();
  let calls = 0;
  const stale = new RustIntegratedRuntimeServiceError(
    "stale-command",
    "the requested from/to delta identities are no longer the current authority interval",
  );
  const runtime = {
    identity() { return current; },
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      calls += 1;
      assert.equal(batch.operations.length, 1);
      assert.equal(batch.operations[0]!.typeId, RUST_INTEGRATED_NETWORK_DELTA_BUILD_TYPE_V1);
      current = identity(1);
      throw stale;
    },
  } as unknown as RustIntegratedRuntimeServiceV1;
  const port = new RustIntegratedNetworkRuntimePortV1(runtime);
  const from = createNetworkAuthorityIdentityV1(
    { universeId: "blockwild", locationId: "surface" },
    { epoch: 1, world: 2, entities: 3, gameplay: 4, persistence: 5 },
  );
  const interest = createNetworkInterestSetV1({
    sequence: 1,
    chunks: [{ universeId: "blockwild", locationId: "surface", chunkX: 0, chunkZ: 0 }],
    entityIds: ["player:guest"],
  });

  await assert.rejects(port.buildDelta({
    sessionId: "session:delta",
    deltaId: "delta:authored-interval",
    peerId: "player:guest",
    keyframe: false,
    sequence: 7,
    acknowledgedCommandSequence: 3,
    from,
    to: from,
    interest,
  }), (error: unknown) => error === stale);

  assert.equal(calls, 1, "a stale delta interval must be returned to its caller without a new outer identity");
});

test("identity-independent replication upsert may re-author after a pre-dispatch stale command", async () => {
  let current = identity();
  let calls = 0;
  const expectedIdentities: RustIntegratedRuntimeIdentityV1[] = [];
  const commandIds: string[] = [];
  const runtime = {
    identity() { return current; },
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      calls += 1;
      expectedIdentities.push(batch.expected);
      commandIds.push(batch.commandId);
      assert.equal(batch.operations.length, 1);
      assert.equal(batch.operations[0]!.typeId, RUST_INTEGRATED_NETWORK_REPLICATION_UPSERT_TYPE_V1);
      if (calls === 1) {
        current = identity(1);
        throw new RustIntegratedRuntimeServiceError(
          "stale-command",
          "a native persistence checkpoint won the integrated queue before dispatch",
        );
      }
      const before = current;
      current = identity(2);
      const operation = batch.operations[0]!;
      return {
        status: "accepted" as const,
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        before,
        after: current,
        domainReceipts: [createRustIntegratedRuntimeDomainOperationV1({
          domain: "network",
          typeId: "blockwild.network.replication-record-receipt.v1",
          schema: 1,
          payload: acknowledgement("BWI9", operation.payload, current.stateHash),
        })],
        receiptHash: ZERO_HASH,
      };
    },
  } as unknown as RustIntegratedRuntimeServiceV1;
  const port = new RustIntegratedNetworkRuntimePortV1(runtime);

  await port.upsertReplicationRecord({
    scope: { kind: "entity", entityId: "player:guest" },
    record: {
      kind: "player",
      recordId: "blockwild:presentation:guest",
      revision: 4,
      payload: Uint8Array.from([0x42, 0x57, 0x50, 0x32]),
      payloadHash: "a".repeat(32),
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(expectedIdentities, [identity(0), identity(1)]);
  assert.notEqual(commandIds[0], commandIds[1], "the retry must use an idempotency scope bound to the new identity");
});

test("repeated reconnect reads bind idempotency to the advanced integrated identity", async () => {
  let current = identity();
  const idempotencyKeys: string[] = [];
  const service = new RustIntegratedRuntimeServiceV1({
    mode: "protocol-test",
    transportFactory: () => ({
      async request(request): Promise<RustIntegratedRuntimeResponseV1> {
        if (request.type === "runtime-create-v1") return {
          type: "runtime-ready-v1", requestId: request.requestId, clientEpoch: request.clientEpoch, workerEpoch: 1,
          runtimeHandle: 1, identity: current, artifactHash: "fixture", instanceId: "fixture", capabilities: CAPABILITIES,
        };
        if (request.type !== "runtime-command-v1") throw new Error(`unexpected ${request.type}`);
        assert.equal(request.batch.operations.length, 1);
        assert.equal(request.batch.operations[0].typeId, RUST_INTEGRATED_NETWORK_RECONNECT_TYPE_V1);
        idempotencyKeys.push(request.batch.idempotencyKey);
        const before = current;
        current = identity(current.tick + 1);
        return {
          type: "runtime-command-receipt-v1", requestId: request.requestId, clientEpoch: request.clientEpoch, workerEpoch: 1,
          receipt: {
            status: "accepted", commandId: request.batch.commandId, idempotencyKey: request.batch.idempotencyKey,
            commandHash: request.batch.commandHash, before, after: current,
            domainReceipts: [createRustIntegratedRuntimeDomainOperationV1({
              domain: "network", typeId: RUST_INTEGRATED_NETWORK_RECONNECT_RESPONSE_TYPE_V1, schema: 1,
              payload: Uint8Array.from([0x42, 0x57, 0x43, 0x39, 0x01, 0x00, 0x00]),
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
  assert.equal(await port.reconnectCheckpoint("session", "peer", 1), null);
  assert.equal(await port.reconnectCheckpoint("session", "peer", 1), null);
  assert.equal(idempotencyKeys.length, 2, "the repeated lifecycle call reaches Rust after authority advances");
  assert.notEqual(idempotencyKeys[0], idempotencyKeys[1], "the outer keys bind the complete expected identities");
});
