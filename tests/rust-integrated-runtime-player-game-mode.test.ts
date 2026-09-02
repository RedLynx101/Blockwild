import assert from "node:assert/strict";
import test from "node:test";

import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import {
  RUST_RUNTIME_INPUT_FLAG_V1,
  type RustIntegratedRuntimeAcceptedReceiptV1,
  type RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RUST_INTEGRATED_PLAYER_GAME_MODE_SET_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_GAME_MODE_SET_TYPE_V1,
  decodeRustIntegratedPlayerGameModeSetReceiptV1,
  decodeRustIntegratedPlayerGameModeSetV1,
  encodeRustIntegratedPlayerGameModeSetReceiptV1,
  encodeRustIntegratedPlayerGameModeSetV1,
  planRustLivePlayerGameModeSetV1,
  rustIntegratedPlayerGameModeSetReceiptHashV1,
  validateRustLivePlayerGameModeSetAfterCommandV1,
  validateRustLivePlayerGameModeSetReceiptV1,
  validateRustLivePlayerGameModeSetRestoredStateV1,
  type RustIntegratedPlayerGameModeSetReceiptV1,
  type RustIntegratedPlayerGameModeSetV1,
} from "../app/game/rust-integrated-runtime-player-game-mode.ts";
import type { RustIntegratedPlayerBootstrapObservationV1 } from "../app/game/rust-integrated-runtime-player-bootstrap.ts";

const encoder = new TextEncoder();
const EXTERNAL_ENTITY_ID = "player:mode-cas";
const ACTOR_ID = "actor:mode-cas";
const PLAYER_ID = BigInt(41);

function hashBytes(value: string) {
  return Uint8Array.from(
    { length: 16 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function bytesHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexBytes(value: string) {
  return Uint8Array.from(
    { length: value.length / 2 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function identity(
  overrides: Partial<RustIntegratedRuntimeIdentityV1> = {},
): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "world:mode-cas",
    locationId: "overworld",
    revision: Object.freeze({
      epoch: 1,
      world: 2,
      entities: 3,
      gameplay: 4,
      persistence: 5,
      network: 6,
      simulation: 7,
    }),
    tick: 11,
    stateHash: "1".repeat(32),
    ...overrides,
  });
}

function acceptedReceiptHash(
  commandHash: string,
  before: RustIntegratedRuntimeIdentityV1,
  after: RustIntegratedRuntimeIdentityV1,
  payloadHash: string,
) {
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
    ...hashBytes(commandHash),
    ...hashBytes(before.stateHash),
    ...hashBytes(after.stateHash),
    ...hashBytes(payloadHash),
  ]));
}

const survivalToBuilder: RustIntegratedPlayerGameModeSetV1 = Object.freeze({
  externalEntityId: EXTERNAL_ENTITY_ID,
  actorId: ACTOR_ID,
  playerId: PLAYER_ID,
  expectedCreativeMode: false,
  expectedFlags: RUST_RUNTIME_INPUT_FLAG_V1.mounted,
  requestedCreativeMode: true,
});

function accepted(
  request: RustIntegratedPlayerGameModeSetV1 = survivalToBuilder,
  receiptOverrides: Partial<RustIntegratedPlayerGameModeSetReceiptV1> = {},
) {
  const before = identity();
  const plan = planRustLivePlayerGameModeSetV1(before, request);
  const after = identity({
    revision: Object.freeze({ ...before.revision, simulation: before.revision.simulation + 1 }),
    stateHash: "2".repeat(32),
  });
  const contents = Object.freeze({
    requestPayloadHash: plan.requestPayloadHash,
    before,
    after,
    externalEntityId: request.externalEntityId,
    actorId: request.actorId,
    playerId: request.playerId,
    priorCreativeMode: request.expectedCreativeMode,
    priorFlags: request.expectedFlags,
    resultingCreativeMode: request.requestedCreativeMode,
    resultingFlags: request.requestedCreativeMode
      ? request.expectedFlags | RUST_RUNTIME_INPUT_FLAG_V1.creative
      : request.expectedFlags & ~(RUST_RUNTIME_INPUT_FLAG_V1.creative | RUST_RUNTIME_INPUT_FLAG_V1.flying),
    ...receiptOverrides,
  });
  const gameMode = Object.freeze({
    ...contents,
    receiptHash: rustIntegratedPlayerGameModeSetReceiptHashV1(contents),
  });
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: RUST_INTEGRATED_PLAYER_GAME_MODE_SET_RECEIPT_TYPE_V1,
    schema: 1,
    payload: encodeRustIntegratedPlayerGameModeSetReceiptV1(gameMode),
  });
  const outer = Object.freeze({
    status: "accepted" as const,
    commandId: plan.batch.commandId,
    idempotencyKey: plan.batch.idempotencyKey,
    commandHash: plan.batch.commandHash,
    before,
    after,
    domainReceipts: Object.freeze([operation]),
    receiptHash: acceptedReceiptHash(plan.batch.commandHash, before, after, operation.payloadHash),
  }) satisfies RustIntegratedRuntimeAcceptedReceiptV1;
  return { plan, outer, gameMode };
}

function observation(
  currentIdentity: RustIntegratedRuntimeIdentityV1,
  creativeMode: boolean,
  authoritativeFlags: number,
) {
  return Object.freeze({
    identity: currentIdentity,
    runtimePlayer: Object.freeze({
      entityId: BigInt(9),
      binding: Object.freeze({
        externalEntityId: EXTERNAL_ENTITY_ID,
        actorId: ACTOR_ID,
        playerId: PLAYER_ID,
        creativeMode,
      }),
    }),
    entity: Object.freeze({ entityId: BigInt(9) }),
    continuity: Object.freeze({ authoritativeFlags }),
  }) as unknown as RustIntegratedPlayerBootstrapObservationV1;
}

test("BWM7 round-trips exact custody and plans one Simulation-domain operation", () => {
  const decoded = decodeRustIntegratedPlayerGameModeSetV1(
    encodeRustIntegratedPlayerGameModeSetV1(survivalToBuilder),
  );
  assert.deepEqual(decoded, survivalToBuilder);
  const plan = planRustLivePlayerGameModeSetV1(identity(), survivalToBuilder);
  assert.equal(plan.batch.actorId, ACTOR_ID);
  assert.equal(plan.batch.operations.length, 1);
  assert.equal(plan.batch.operations[0]?.domain, "simulation");
  assert.equal(plan.batch.operations[0]?.typeId, RUST_INTEGRATED_PLAYER_GAME_MODE_SET_TYPE_V1);
  assert.equal(plan.batch.operations[0]?.schema, 1);
});

test("BWM7 and BWN7 match the Rust Unicode wire fixtures byte-for-byte", () => {
  const requestFixture = "42574d37010001004a000000b57a7093040e3de848b06533c046532d1c000000706c617965723a6d6f64652d776972653ae6a8a1e5bc8f3af09f98801b0000006163746f723a6d6f64652d776972653ae6a8a1e5bc8f3af09f98800700000003000000010300";
  const receiptFixture = "42574e37010001003d0100003c886b916defc58cd8d81f07a7c0e3a6f3e3a2d7fab0d6e348b06533c046532d020008000000756e69766572736507000000737572666163650200000000000000030000000000000004000000000000000500000000000000060000000000000007000000000000000800000000000000090000000000000031313131313131313131313131313131020008000000756e697665727365070000007375726661636502000000000000000300000000000000040000000000000005000000000000000600000000000000070000000000000009000000000000000900000000000000323232323232323232323232323232321c000000706c617965723a6d6f64652d776972653ae6a8a1e5bc8f3af09f98801b0000006163746f723a6d6f64652d776972653ae6a8a1e5bc8f3af09f98800700000003000000010300009877b7d906acee50c8a6054e1bdfed79";
  const request = Object.freeze({
    externalEntityId: "player:mode-wire:模式:😀",
    actorId: "actor:mode-wire:模式:😀",
    playerId: (BigInt(3) << BigInt(32)) | BigInt(7),
    expectedCreativeMode: true,
    expectedFlags: RUST_RUNTIME_INPUT_FLAG_V1.creative | RUST_RUNTIME_INPUT_FLAG_V1.flying,
    requestedCreativeMode: false,
  });
  assert.equal(bytesHex(encodeRustIntegratedPlayerGameModeSetV1(request)), requestFixture);
  assert.deepEqual(decodeRustIntegratedPlayerGameModeSetV1(hexBytes(requestFixture)), request);

  const receipt = decodeRustIntegratedPlayerGameModeSetReceiptV1(hexBytes(receiptFixture));
  assert.deepEqual(receipt, Object.freeze({
    requestPayloadHash: "f3e3a2d7fab0d6e348b06533c046532d",
    before: Object.freeze({
      universeId: "universe",
      locationId: "surface",
      revision: Object.freeze({
        epoch: 2,
        world: 3,
        entities: 4,
        gameplay: 5,
        persistence: 6,
        network: 7,
        simulation: 8,
      }),
      tick: 9,
      stateHash: "31".repeat(16),
    }),
    after: Object.freeze({
      universeId: "universe",
      locationId: "surface",
      revision: Object.freeze({
        epoch: 2,
        world: 3,
        entities: 4,
        gameplay: 5,
        persistence: 6,
        network: 7,
        simulation: 9,
      }),
      tick: 9,
      stateHash: "32".repeat(16),
    }),
    externalEntityId: request.externalEntityId,
    actorId: request.actorId,
    playerId: request.playerId,
    priorCreativeMode: true,
    priorFlags: RUST_RUNTIME_INPUT_FLAG_V1.creative | RUST_RUNTIME_INPUT_FLAG_V1.flying,
    resultingCreativeMode: false,
    resultingFlags: 0,
    receiptHash: "9877b7d906acee50c8a6054e1bdfed79",
  }));
  assert.equal(bytesHex(encodeRustIntegratedPlayerGameModeSetReceiptV1(receipt)), receiptFixture);
});

test("repeated mode toggles bind idempotency to the advancing native identity", () => {
  const initial = identity();
  const firstBuilder = planRustLivePlayerGameModeSetV1(initial, survivalToBuilder);
  const exactRetry = planRustLivePlayerGameModeSetV1(initial, survivalToBuilder);
  const builderIdentity = identity({
    revision: Object.freeze({ ...initial.revision, simulation: initial.revision.simulation + 1 }),
    stateHash: "2".repeat(32),
  });
  const survival = planRustLivePlayerGameModeSetV1(builderIdentity, Object.freeze({
    ...survivalToBuilder,
    expectedCreativeMode: true,
    expectedFlags: RUST_RUNTIME_INPUT_FLAG_V1.creative,
    requestedCreativeMode: false,
  }));
  const restoredSurvivalIdentity = identity({
    revision: Object.freeze({ ...initial.revision, simulation: initial.revision.simulation + 2 }),
    stateHash: "3".repeat(32),
  });
  const secondBuilder = planRustLivePlayerGameModeSetV1(
    restoredSurvivalIdentity,
    survivalToBuilder,
  );

  assert.equal(firstBuilder.requestPayloadHash, secondBuilder.requestPayloadHash);
  assert.equal(firstBuilder.batch.idempotencyKey, exactRetry.batch.idempotencyKey);
  assert.equal(firstBuilder.batch.commandHash, exactRetry.batch.commandHash);
  assert.notEqual(firstBuilder.batch.commandHash, secondBuilder.batch.commandHash);
  assert.notEqual(firstBuilder.batch.idempotencyKey, secondBuilder.batch.idempotencyKey);
  assert.match(firstBuilder.batch.idempotencyKey, new RegExp(initial.stateHash, "u"));
  assert.match(secondBuilder.batch.idempotencyKey, new RegExp(restoredSurvivalIdentity.stateHash, "u"));

  const durableCache = new Map<string, string>();
  for (const plan of [firstBuilder, survival, secondBuilder]) {
    const cachedHash = durableCache.get(plan.batch.idempotencyKey);
    assert.ok(cachedHash === undefined || cachedHash === plan.batch.commandHash);
    durableCache.set(plan.batch.idempotencyKey, plan.batch.commandHash);
  }
  assert.equal(durableCache.size, 3);
  assert.throws(
    () => planRustLivePlayerGameModeSetV1(identity({ stateHash: "A".repeat(32) }), survivalToBuilder),
    /canonical nonzero hash/u,
  );
});

test("BWN7 accepts survival-to-builder without inventing flight and validates immediate readback", () => {
  const { plan, outer } = accepted();
  const validated = validateRustLivePlayerGameModeSetReceiptV1(plan, outer);
  assert.equal(validated.gameMode.priorFlags, RUST_RUNTIME_INPUT_FLAG_V1.mounted);
  assert.equal(
    validated.gameMode.resultingFlags,
    RUST_RUNTIME_INPUT_FLAG_V1.mounted | RUST_RUNTIME_INPUT_FLAG_V1.creative,
  );
  const readback = observation(outer.after, true, validated.gameMode.resultingFlags);
  assert.equal(validateRustLivePlayerGameModeSetAfterCommandV1(plan, validated, readback), readback);

  const postCheckpoint = identity({
    revision: Object.freeze({ ...outer.after.revision, persistence: outer.after.revision.persistence + 2 }),
    stateHash: "3".repeat(32),
  });
  const durableReadback = observation(postCheckpoint, true, validated.gameMode.resultingFlags);
  assert.equal(
    validateRustLivePlayerGameModeSetRestoredStateV1(plan, validated, durableReadback, postCheckpoint),
    durableReadback,
  );
});

test("BWN7 builder-to-survival clears Creative and Flying while preserving unrelated flags", () => {
  const request = Object.freeze({
    ...survivalToBuilder,
    expectedCreativeMode: true,
    expectedFlags: RUST_RUNTIME_INPUT_FLAG_V1.creative | RUST_RUNTIME_INPUT_FLAG_V1.flying,
    requestedCreativeMode: false,
  });
  const { plan, outer } = accepted(request);
  const validated = validateRustLivePlayerGameModeSetReceiptV1(plan, outer);
  assert.equal(validated.gameMode.resultingCreativeMode, false);
  assert.equal(validated.gameMode.resultingFlags, 0);
});

test("BWM7 rejects malformed custody, no-op requests, and Flying-plus-Mounted parity drift", () => {
  for (const request of [
    { ...survivalToBuilder, externalEntityId: "" },
    { ...survivalToBuilder, actorId: "actor:\u0001mode" },
    { ...survivalToBuilder, actorId: "x".repeat(513) },
    {
      ...survivalToBuilder,
      expectedCreativeMode: true,
      expectedFlags: RUST_RUNTIME_INPUT_FLAG_V1.creative,
      requestedCreativeMode: true,
    },
    {
      ...survivalToBuilder,
      expectedCreativeMode: true,
      expectedFlags: RUST_RUNTIME_INPUT_FLAG_V1.creative
        | RUST_RUNTIME_INPUT_FLAG_V1.flying
        | RUST_RUNTIME_INPUT_FLAG_V1.mounted,
    },
  ]) {
    assert.throws(
      () => encodeRustIntegratedPlayerGameModeSetV1(request),
      /bounded|game-mode|flag/u,
    );
  }
});

class PacketWriter {
  readonly bytes: number[] = [];
  raw(value: Uint8Array | readonly number[]) { this.bytes.push(...value); return this; }
  u8(value: number) { this.bytes.push(value); return this; }
  u16(value: number) { this.bytes.push(value & 0xff, value >>> 8 & 0xff); return this; }
  u32(value: number) {
    this.bytes.push(value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff);
    return this;
  }
  u64(value: bigint | number) {
    let remaining = BigInt(value);
    for (let index = 0; index < 8; index += 1) {
      this.bytes.push(Number(remaining & BigInt(0xff)));
      remaining >>= BigInt(8);
    }
    return this;
  }
  string(value: string) {
    const encoded = encoder.encode(value);
    return this.u32(encoded.byteLength).raw(encoded);
  }
  finish() { return Uint8Array.from(this.bytes); }
}

function writeIdentity(writer: PacketWriter, value: RustIntegratedRuntimeIdentityV1) {
  writer.u16(2).string(value.universeId).string(value.locationId);
  for (const revision of [
    value.revision.epoch,
    value.revision.world,
    value.revision.entities,
    value.revision.gameplay,
    value.revision.persistence,
    value.revision.network,
    value.revision.simulation,
  ]) writer.u64(revision);
  writer.u64(value.tick).raw(hashBytes(value.stateHash));
}

function sealedMalformedTransitionPacket() {
  const before = identity();
  const after = identity({
    revision: Object.freeze({
      ...before.revision,
      world: before.revision.world + 1,
      simulation: before.revision.simulation + 1,
    }),
    stateHash: "4".repeat(32),
  });
  const requestHash = rustIntegratedRuntimeWireChecksumV1(encodeRustIntegratedPlayerGameModeSetV1({
    externalEntityId: EXTERNAL_ENTITY_ID,
    actorId: ACTOR_ID,
    playerId: PLAYER_ID,
    expectedCreativeMode: false,
    expectedFlags: 0,
    requestedCreativeMode: true,
  }));
  const contents = new PacketWriter().raw(hashBytes(requestHash));
  writeIdentity(contents, before);
  writeIdentity(contents, after);
  contents.string(EXTERNAL_ENTITY_ID).string(ACTOR_ID).u64(PLAYER_ID)
    .u8(0).u8(0).u8(1).u8(RUST_RUNTIME_INPUT_FLAG_V1.creative);
  const prehash = contents.finish();
  const body = new PacketWriter().raw(prehash)
    .raw(hashBytes(rustIntegratedRuntimeWireChecksumV1(prehash))).finish();
  const packet = new Uint8Array(28 + body.byteLength);
  packet.set(encoder.encode("BWN7"));
  const header = new DataView(packet.buffer);
  header.setUint16(4, 1, true);
  header.setUint16(6, 1, true);
  header.setUint32(8, body.byteLength, true);
  packet.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(body)), 12);
  packet.set(body, 28);
  return packet;
}

test("standalone BWN7 decode rejects a correctly sealed discontinuous identity transition", () => {
  assert.throws(
    () => decodeRustIntegratedPlayerGameModeSetReceiptV1(sealedMalformedTransitionPacket()),
    /exactly one simulation authority mutation/u,
  );
});

test("receipt validation fails closed on stale custody and mismatched native readback", () => {
  const { plan, outer } = accepted();
  const validated = validateRustLivePlayerGameModeSetReceiptV1(plan, outer);
  assert.throws(
    () => validateRustLivePlayerGameModeSetAfterCommandV1(
      plan,
      validated,
      observation(outer.after, false, 0),
    ),
    /does not attest/u,
  );
  const rejected = Object.freeze({
    status: "rejected" as const,
    commandId: plan.batch.commandId,
    idempotencyKey: plan.batch.idempotencyKey,
    commandHash: plan.batch.commandHash,
    code: "stale-player-game-mode",
    message: "stale native mode",
    current: plan.batch.expected,
    receiptHash: rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
      ...hashBytes(plan.batch.commandHash),
      ...hashBytes(plan.batch.expected.stateHash),
      ...encoder.encode("stale-player-game-mode"),
      ...encoder.encode("stale native mode"),
    ])),
  });
  assert.throws(
    () => validateRustLivePlayerGameModeSetReceiptV1(plan, rejected),
    /stale native mode/u,
  );
});
