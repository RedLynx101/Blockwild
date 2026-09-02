import assert from "node:assert/strict";
import test from "node:test";

import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import type {
  RustIntegratedRuntimeAcceptedReceiptV1,
  RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RUST_INTEGRATED_PLAYER_RESPAWN_POLICY_SUPPORT_V1,
  RUST_INTEGRATED_PLAYER_RESPAWN_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_RESPAWN_TYPE_V1,
  RustIntegratedPlayerRespawnErrorV1,
  decodeRustIntegratedPlayerRespawnReceiptV1,
  decodeRustIntegratedPlayerRespawnV1,
  encodeRustIntegratedPlayerRespawnReceiptV1,
  encodeRustIntegratedPlayerRespawnV1,
  executeRustLivePlayerRespawnPlanV1,
  planRustLivePlayerRespawnV1,
  rehydrateRustLivePlayerRespawnPlanV1,
  rustIntegratedPlayerRespawnParentAttestsReceiptV1,
  rustIntegratedPlayerRespawnReceiptHashV1,
  serializeRustLivePlayerRespawnPlanV1,
  validateRustLivePlayerRespawnAfterCommandV1,
  validateRustLivePlayerRespawnReceiptV1,
  validateRustLivePlayerRespawnRestoredStateV1,
  type RustIntegratedPlayerRespawnReceiptV1,
  type RustIntegratedPlayerRespawnV1,
  type RustLivePlayerRespawnPlanV1,
  type RustLivePlayerRespawnReadbackV1,
} from "../app/game/rust-integrated-runtime-player-respawn.ts";
import {
  nativeDeathDropWireVector,
  resealNativeWirePacket,
} from "./helpers/rust-death-drop-wire-fixtures.ts";

const encoder = new TextEncoder();
const PLAYER_ID = (BigInt(3) << BigInt(32)) | BigInt(7);
const ENTITY_ID = (BigInt(4) << BigInt(32)) | BigInt(8);

function patternedHash(seed: number) {
  return Array.from(
    { length: 16 },
    (_, index) => ((seed + index * 17) & 0xff).toString(16).padStart(2, "0"),
  ).join("");
}

function hashBytes(value: string) {
  return Uint8Array.from(
    { length: 16 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function hex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  return Uint8Array.from(
    { length: value.length / 2 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function identity(
  stateHash = "41".repeat(16),
  revision: Partial<RustIntegratedRuntimeIdentityV1["revision"]> = {},
): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe:respawn",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 2,
      world: 3,
      entities: 20,
      gameplay: 30,
      persistence: 6,
      network: 7,
      simulation: 40,
      ...revision,
    }),
    tick: 55,
    stateHash,
  });
}

const REQUEST = Object.freeze({
  expected: identity(),
  externalEntityId: "player:respawn:水",
  actorId: "actor:respawn:水",
  playerId: PLAYER_ID,
  entityId: ENTITY_ID,
  expectedEntityRevision: BigInt(12),
  expectedGameplaySequence: BigInt(28),
  expectedGameplayCombatRevision: BigInt(9),
  expectedCombatantRevision: BigInt(6),
  expectedDeathSequence: BigInt(3),
  expectedMaxHealth: 20_000,
  respawnPosition: Object.freeze({ xMilli: -12_500, yMilli: 64_250, zMilli: 8_000 }),
  keepInventory: true,
}) satisfies RustIntegratedPlayerRespawnV1;

const NATIVE_CROSS_LANGUAGE_REQUEST = Object.freeze({
  expected: Object.freeze({
    universeId: "universe:wire:死亡🌍",
    locationId: "surface:雪",
    revision: Object.freeze({
      epoch: 17,
      world: 101,
      entities: 202,
      gameplay: 303,
      persistence: 404,
      network: 505,
      simulation: 606,
    }),
    tick: 4_294_967_299,
    stateHash: patternedHash(0x11),
  }),
  externalEntityId: "player:opaque:水:🦊",
  actorId: "actor:opaque:雪:🧭",
  playerId: BigInt("0xfedcba9889abcdef"),
  entityId: BigInt("0xedcba98776543210"),
  expectedEntityRevision: BigInt("9007199254740901"),
  expectedGameplaySequence: BigInt("9007199254740801"),
  expectedGameplayCombatRevision: BigInt("9007199254740701"),
  expectedCombatantRevision: BigInt("9007199254740601"),
  expectedDeathSequence: BigInt("9007199254740501"),
  expectedMaxHealth: 1_234_567,
  respawnPosition: Object.freeze({
    xMilli: -33_554_431_999,
    yMilli: 12_345_678,
    zMilli: 33_554_431_997,
  }),
  keepInventory: false,
}) satisfies RustIntegratedPlayerRespawnV1;

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

function accepted(
  plan = planRustLivePlayerRespawnV1(REQUEST.expected, REQUEST),
  receiptOverrides: Partial<RustIntegratedPlayerRespawnReceiptV1> = {},
) {
  const before = plan.request.expected;
  const keepInventory = receiptOverrides.keepInventory ?? plan.request.keepInventory;
  const generatedDropCount = receiptOverrides.generatedDropCount ?? 0;
  const gameplayDelta = !keepInventory && generatedDropCount > 0 ? 2 : 1;
  const after = receiptOverrides.after ?? identity("42".repeat(16), {
    entities: before.revision.entities + 1,
    gameplay: before.revision.gameplay + gameplayDelta,
    simulation: before.revision.simulation + 1,
  });
  const contents = Object.freeze({
    requestPayloadHash: plan.requestPayloadHash,
    before,
    after,
    externalEntityId: plan.request.externalEntityId,
    actorId: plan.request.actorId,
    playerId: plan.request.playerId,
    entityId: plan.request.entityId,
    deathSequence: plan.request.expectedDeathSequence,
    priorEntityRevision: plan.request.expectedEntityRevision,
    resultingEntityRevision: plan.request.expectedEntityRevision + BigInt(1),
    priorGameplaySequence: plan.request.expectedGameplaySequence,
    resultingGameplaySequence: plan.request.expectedGameplaySequence + BigInt(1),
    priorGameplayCombatRevision: plan.request.expectedGameplayCombatRevision,
    resultingGameplayCombatRevision: plan.request.expectedGameplayCombatRevision + BigInt(1),
    priorCombatantRevision: plan.request.expectedCombatantRevision,
    resultingCombatantRevision: plan.request.expectedCombatantRevision + BigInt(1),
    maximumHealth: plan.request.expectedMaxHealth,
    priorHealth: 0,
    resultingHealth: plan.request.expectedMaxHealth,
    priorAlive: false,
    resultingAlive: true,
    respawnPosition: plan.request.respawnPosition,
    resultingOxygenSeconds: 15,
    keepInventory,
    inventoryBeforeRevision: BigInt(4),
    inventoryAfterRevision: BigInt(4),
    equipmentBeforeRevision: BigInt(2),
    equipmentAfterRevision: BigInt(2),
    custodyBeforeHash: "43".repeat(16),
    custodyAfterHash: "43".repeat(16),
    generatedDropCount,
    ...receiptOverrides,
  });
  const respawn = Object.freeze({
    ...contents,
    receiptHash: rustIntegratedPlayerRespawnReceiptHashV1(contents),
  });
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: RUST_INTEGRATED_PLAYER_RESPAWN_RECEIPT_TYPE_V1,
    schema: 1,
    payload: encodeRustIntegratedPlayerRespawnReceiptV1(respawn),
  });
  const outerSource = Object.freeze({
    status: "accepted" as const,
    commandId: plan.batch.commandId,
    idempotencyKey: plan.batch.idempotencyKey,
    commandHash: plan.batch.commandHash,
    before,
    after,
    domainReceipts: Object.freeze([operation]),
  });
  const outer = Object.freeze({
    ...outerSource,
    receiptHash: acceptedReceiptHash(plan.batch.commandHash, before, after, operation.payloadHash),
  }) satisfies RustIntegratedRuntimeAcceptedReceiptV1;
  return Object.freeze({ plan, respawn, outer });
}

function resealedRespawn(
  baseline: RustIntegratedPlayerRespawnReceiptV1,
  overrides: Partial<RustIntegratedPlayerRespawnReceiptV1>,
) {
  const contents = Object.freeze({ ...baseline, ...overrides });
  return Object.freeze({
    ...contents,
    receiptHash: rustIntegratedPlayerRespawnReceiptHashV1(contents),
  });
}

function rejected(
  plan: RustLivePlayerRespawnPlanV1,
  code: string,
  message: string,
  current = plan.batch.expected,
) {
  return Object.freeze({
    status: "rejected" as const,
    commandId: plan.batch.commandId,
    idempotencyKey: plan.batch.idempotencyKey,
    commandHash: plan.batch.commandHash,
    code,
    message,
    current,
    receiptHash: rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
      ...hashBytes(plan.batch.commandHash),
      ...hashBytes(current.stateHash),
      ...encoder.encode(code),
      ...encoder.encode(message),
    ])),
  });
}

function readback(
  acceptedValue: ReturnType<typeof accepted>,
  currentIdentity = acceptedValue.outer.after,
): RustLivePlayerRespawnReadbackV1 {
  const receipt = acceptedValue.respawn;
  return Object.freeze({
    identity: currentIdentity,
    externalEntityId: receipt.externalEntityId,
    actorId: receipt.actorId,
    playerId: receipt.playerId,
    entityId: receipt.entityId,
    entityRevision: receipt.resultingEntityRevision,
    gameplaySequence: receipt.resultingGameplaySequence,
    gameplayCombatRevision: receipt.resultingGameplayCombatRevision,
    combatantRevision: receipt.resultingCombatantRevision,
    deathSequence: receipt.deathSequence,
    lastRespawnSequence: receipt.deathSequence,
    health: receipt.resultingHealth,
    maximumHealth: receipt.maximumHealth,
    alive: receipt.resultingAlive,
    position: receipt.respawnPosition,
    velocityMilliPerSecond: Object.freeze({ xMilli: 0, yMilli: 0, zMilli: 0 }),
    oxygenSeconds: receipt.resultingOxygenSeconds,
    grounded: false,
    crouching: false,
    fallDistanceMilli: 0,
    drowningAccumulatorMilli: 0,
    buttons: 0,
    flags: 0,
    contactFlags: 0,
    queuedInputsEmpty: true,
    pendingContextCommandsEmpty: true,
    pendingMovementResultEmpty: true,
    miningStateEmpty: true,
    inventoryRevision: receipt.inventoryAfterRevision,
    equipmentRevision: receipt.equipmentAfterRevision,
    custodyHash: receipt.custodyAfterHash,
    projectedDropCount: receipt.generatedDropCount,
  });
}

function resealPacket(packet: Uint8Array) {
  const output = Uint8Array.from(packet);
  output.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(output.subarray(28))), 12);
  return output;
}

function appendCanonicalBodyByte(packet: Uint8Array, byte: number) {
  const output = new Uint8Array(packet.byteLength + 1);
  output.set(packet);
  output[output.length - 1] = byte;
  new DataView(output.buffer).setUint32(8, output.byteLength - 28, true);
  return resealPacket(output);
}

test("BWD7 and BWE7 match the Rust native Unicode vectors byte-for-byte", () => {
  const requestFixture = "4257443701000100f1000000fb969843157824d7d83b574c6b27a29e020010000000756e6976657273653a7265737061776e07000000737572666163650200000000000000030000000000000014000000000000001e0000000000000006000000000000000700000000000000280000000000000037000000000000004141414141414141414141414141414112000000706c617965723a7265737061776e3ae6b0b4110000006163746f723a7265737061776e3ae6b0b4070000000300000008000000040000000c000000000000001c00000000000000090000000000000006000000000000000300000000000000204e00002ccffffffffffffffafa000000000000401f00000000000001";
  const receiptFixture = "4257453701000100f8010000c82a9f06b6e61d4dd840e16b5c8503e9a3feba0a4586c490d83b574c6b27a29e020010000000756e6976657273653a7265737061776e07000000737572666163650200000000000000030000000000000014000000000000001e00000000000000060000000000000007000000000000002800000000000000370000000000000041414141414141414141414141414141020010000000756e6976657273653a7265737061776e07000000737572666163650200000000000000030000000000000015000000000000001f0000000000000006000000000000000700000000000000290000000000000037000000000000004242424242424242424242424242424212000000706c617965723a7265737061776e3ae6b0b4110000006163746f723a7265737061776e3ae6b0b40700000003000000080000000400000003000000000000000c000000000000000d000000000000001c000000000000001d0000000000000009000000000000000a0000000000000006000000000000000700000000000000204e000000000000204e000000012ccffffffffffffffafa000000000000401f0000000000000000000000002e40010400000000000000040000000000000002000000000000000200000000000000434343434343434343434343434343434343434343434343434343434343434300000000f0d241472f17a149c83a623ff5d091d9";

  assert.equal(hex(encodeRustIntegratedPlayerRespawnV1(REQUEST)), requestFixture);
  assert.deepEqual(decodeRustIntegratedPlayerRespawnV1(fromHex(requestFixture)), REQUEST);

  const fixtureReceipt = decodeRustIntegratedPlayerRespawnReceiptV1(fromHex(receiptFixture));
  assert.equal(fixtureReceipt.requestPayloadHash, rustIntegratedRuntimeWireChecksumV1(fromHex(requestFixture)));
  assert.equal(fixtureReceipt.receiptHash, "f0d241472f17a149c83a623ff5d091d9");
  assert.deepEqual(fixtureReceipt.respawnPosition, REQUEST.respawnPosition);
  assert.equal(hex(encodeRustIntegratedPlayerRespawnReceiptV1(fixtureReceipt)), receiptFixture);
});

test("checked Rust BWD7/BWE7 fixtures cover full-width opaque IDs, Unicode, fixed point, and f32-derived oxygen", () => {
  const bwd7 = nativeDeathDropWireVector("bwd7-request");
  assert.equal(bwd7.direction, "typescript-to-rust");
  assert.equal(hex(encodeRustIntegratedPlayerRespawnV1(NATIVE_CROSS_LANGUAGE_REQUEST)), bwd7.hex);
  assert.deepEqual(decodeRustIntegratedPlayerRespawnV1(bwd7.bytes), NATIVE_CROSS_LANGUAGE_REQUEST);

  const bwe7 = nativeDeathDropWireVector("bwe7-receipt");
  assert.equal(bwe7.direction, "rust-to-typescript");
  const receipt = decodeRustIntegratedPlayerRespawnReceiptV1(bwe7.bytes);
  assert.equal(receipt.requestPayloadHash, bwd7.wireChecksum);
  assert.equal(receipt.playerId, BigInt("0xfedcba9889abcdef"));
  assert.equal(receipt.entityId, BigInt("0xedcba98776543210"));
  assert.equal(receipt.resultingOxygenSeconds, Math.fround(12.34));
  assert.equal(receipt.inventoryBeforeRevision, BigInt("9007199254740400"));
  assert.equal(receipt.inventoryAfterRevision, BigInt("9007199254740401"));
  assert.equal(receipt.equipmentBeforeRevision, BigInt("9007199254740300"));
  assert.equal(receipt.equipmentAfterRevision, BigInt("9007199254740301"));
  assert.equal(receipt.generatedDropCount, 2);
  assert.equal(receipt.after.revision.gameplay, receipt.before.revision.gameplay + 2);
  assert.equal(receipt.receiptHash, rustIntegratedPlayerRespawnReceiptHashV1(receipt));
  assert.equal(hex(encodeRustIntegratedPlayerRespawnReceiptV1(receipt)), bwe7.hex);
});

test("checked BWD7/BWE7 fixtures reject checksum-valid malformed flags and receipt seals", () => {
  const bwd7 = nativeDeathDropWireVector("bwd7-request");
  const invalidFlag = resealNativeWirePacket(bwd7.bytes, (bytes) => {
    bytes[bytes.length - 1] = 2;
  });
  assert.throws(() => decodeRustIntegratedPlayerRespawnV1(invalidFlag), /flag|boolean/u);

  const bwe7 = nativeDeathDropWireVector("bwe7-receipt");
  const invalidSeal = resealNativeWirePacket(bwe7.bytes, (bytes) => {
    bytes.fill(0, bytes.length - 16);
  });
  assert.throws(() => decodeRustIntegratedPlayerRespawnReceiptV1(invalidSeal), /receipt hash/u);
  assert.throws(() => decodeRustIntegratedPlayerRespawnReceiptV1(bwe7.bytes.subarray(0, -1)));
});

test("respawn plan binds exact BWD7 bytes, actor, type, identity, and durable retry record", () => {
  const plan = planRustLivePlayerRespawnV1(REQUEST.expected, REQUEST);
  assert.equal(plan.batch.actorId, REQUEST.actorId);
  assert.equal(plan.batch.operations.length, 1);
  assert.equal(plan.batch.operations[0]?.domain, "simulation");
  assert.equal(plan.batch.operations[0]?.typeId, RUST_INTEGRATED_PLAYER_RESPAWN_TYPE_V1);
  assert.equal(plan.batch.operations[0]?.schema, 1);
  assert.equal(plan.batch.commandId, `player-respawn:${plan.requestPayloadHash}`);
  assert.equal(plan.batch.idempotencyKey, plan.batch.commandId);
  assert.equal(plan.runtimePolicySupport, "accepted");

  const exactRetry = planRustLivePlayerRespawnV1(REQUEST.expected, REQUEST);
  assert.equal(exactRetry.batch.commandHash, plan.batch.commandHash);
  assert.equal(exactRetry.batch.idempotencyKey, plan.batch.idempotencyKey);
  assert.deepEqual(rehydrateRustLivePlayerRespawnPlanV1(serializeRustLivePlayerRespawnPlanV1(plan)), plan);

  const successor = identity("52".repeat(16), { simulation: 41 });
  const successorPlan = planRustLivePlayerRespawnV1(successor, { ...REQUEST, expected: successor });
  assert.notEqual(successorPlan.requestPayloadHash, plan.requestPayloadHash);
  assert.notEqual(successorPlan.batch.commandHash, plan.batch.commandHash);
  assert.throws(
    () => planRustLivePlayerRespawnV1(successor, REQUEST),
    (error: unknown) => error instanceof RustIntegratedPlayerRespawnErrorV1 && error.code === "player-respawn-stale",
  );

  const record = JSON.parse(serializeRustLivePlayerRespawnPlanV1(plan)) as Record<string, unknown>;
  assert.throws(
    () => serializeRustLivePlayerRespawnPlanV1({
      ...plan,
      batch: { ...plan.batch, commandId: `${plan.batch.commandId}:tampered` },
    }),
    /exact canonical BWD7/u,
  );
  assert.throws(
    () => rehydrateRustLivePlayerRespawnPlanV1({ ...record, commandHash: "ff".repeat(16) } as never),
    /byte-for-byte/u,
  );
  const payloadHex = String(record.requestPayloadHex);
  assert.throws(
    () => rehydrateRustLivePlayerRespawnPlanV1({
      ...record,
      requestPayloadHex: `${payloadHex.slice(0, -2)}00`,
    } as never),
    /checksum|canonical/u,
  );
});

test("keepInventory=false is an accepted BWD7/BWE7 policy with an exact empty-custody lane", () => {
  const releaseRequest = Object.freeze({ ...REQUEST, keepInventory: false });
  const decoded = decodeRustIntegratedPlayerRespawnV1(encodeRustIntegratedPlayerRespawnV1(releaseRequest));
  assert.equal(decoded.keepInventory, false);
  const plan = planRustLivePlayerRespawnV1(releaseRequest.expected, releaseRequest);
  assert.equal(plan.runtimePolicySupport, "accepted");
  assert.deepEqual(RUST_INTEGRATED_PLAYER_RESPAWN_POLICY_SUPPORT_V1, {
    keepInventory: "accepted",
    releaseInventory: "accepted",
  });

  const empty = accepted(plan);
  assert.equal(empty.respawn.keepInventory, false);
  assert.equal(empty.respawn.generatedDropCount, 0);
  assert.equal(empty.respawn.inventoryAfterRevision, empty.respawn.inventoryBeforeRevision);
  assert.equal(empty.respawn.equipmentAfterRevision, empty.respawn.equipmentBeforeRevision);
  assert.equal(empty.respawn.custodyAfterHash, empty.respawn.custodyBeforeHash);
  assert.equal(empty.outer.after.revision.gameplay, empty.outer.before.revision.gameplay + 1);
  assert.deepEqual(
    decodeRustIntegratedPlayerRespawnReceiptV1(
      encodeRustIntegratedPlayerRespawnReceiptV1(empty.respawn),
    ),
    empty.respawn,
  );
  const validated = validateRustLivePlayerRespawnReceiptV1(plan, empty.outer);
  const immediate = readback(empty);
  assert.equal(
    validateRustLivePlayerRespawnAfterCommandV1(plan, validated, immediate),
    immediate,
  );
  assert.deepEqual(rehydrateRustLivePlayerRespawnPlanV1(serializeRustLivePlayerRespawnPlanV1(plan)), plan);
});

test("release policy accepts inventory-only, equipment-only, and combined death-drop custody", () => {
  const releaseRequest = Object.freeze({ ...REQUEST, keepInventory: false });
  const plan = planRustLivePlayerRespawnV1(releaseRequest.expected, releaseRequest);
  const variants = [
    { inventoryAfterRevision: BigInt(5), generatedDropCount: 3 },
    { equipmentAfterRevision: BigInt(3), generatedDropCount: 2 },
    {
      inventoryAfterRevision: BigInt(5),
      equipmentAfterRevision: BigInt(3),
      generatedDropCount: 17,
    },
  ] satisfies Array<Partial<RustIntegratedPlayerRespawnReceiptV1>>;

  for (const variant of variants) {
    const result = accepted(plan, {
      ...variant,
      custodyAfterHash: "44".repeat(16),
    });
    const decodedReceipt = decodeRustIntegratedPlayerRespawnReceiptV1(
      encodeRustIntegratedPlayerRespawnReceiptV1(result.respawn),
    );
    assert.deepEqual(decodedReceipt, result.respawn);
    assert.equal(result.outer.after.revision.entities, result.outer.before.revision.entities + 1);
    assert.equal(result.outer.after.revision.simulation, result.outer.before.revision.simulation + 1);
    assert.equal(result.outer.after.revision.gameplay, result.outer.before.revision.gameplay + 2);
    assert.equal(
      result.respawn.resultingGameplaySequence,
      result.respawn.priorGameplaySequence + BigInt(1),
    );
    const validated = validateRustLivePlayerRespawnReceiptV1(plan, result.outer);
    const immediate = readback(result);
    assert.equal(validateRustLivePlayerRespawnAfterCommandV1(plan, validated, immediate), immediate);
    const restoredIdentity = Object.freeze({
      ...result.outer.after,
      revision: Object.freeze({
        ...result.outer.after.revision,
        persistence: result.outer.after.revision.persistence + 1,
      }),
      stateHash: "55".repeat(16),
    });
    const restored = readback(result, restoredIdentity);
    assert.equal(
      validateRustLivePlayerRespawnRestoredStateV1(
        plan,
        validated,
        restored,
        restoredIdentity,
      ),
      restored,
    );
  }
});

test("native false-policy parent joins BWE7 by shared evidence, not its distinct receipt hash", () => {
  const request = Object.freeze({ ...REQUEST, keepInventory: false });
  const plan = planRustLivePlayerRespawnV1(request.expected, request);
  const baseline = accepted(plan, {
    inventoryAfterRevision: BigInt(5),
    equipmentAfterRevision: BigInt(3),
    custodyAfterHash: "44".repeat(16),
    generatedDropCount: 2,
  }).respawn;
  const parent = Object.freeze({
    receiptHash: "12".repeat(16),
    playerId: baseline.playerId,
    entityId: baseline.entityId,
    deathSequence: baseline.deathSequence,
    inventoryBeforeRevision: baseline.inventoryBeforeRevision,
    inventoryAfterRevision: baseline.inventoryAfterRevision,
    equipmentBeforeRevision: baseline.equipmentBeforeRevision,
    equipmentAfterRevision: baseline.equipmentAfterRevision,
    custodyAfterHash: baseline.custodyAfterHash,
    generatedDropCount: baseline.generatedDropCount,
    drops: Object.freeze([Object.freeze({}), Object.freeze({})]),
  });

  assert.notEqual(parent.receiptHash, baseline.receiptHash,
    "the native parent and BWE7 receipt deliberately use different hash domains");
  assert.equal(rustIntegratedPlayerRespawnParentAttestsReceiptV1(parent, baseline), true);

  for (const drift of [
    { playerId: parent.playerId + BigInt(1) },
    { entityId: parent.entityId + BigInt(1) },
    { deathSequence: parent.deathSequence + BigInt(1) },
    { inventoryBeforeRevision: parent.inventoryBeforeRevision + BigInt(1) },
    { inventoryAfterRevision: parent.inventoryAfterRevision + BigInt(1) },
    { equipmentBeforeRevision: parent.equipmentBeforeRevision + BigInt(1) },
    { equipmentAfterRevision: parent.equipmentAfterRevision + BigInt(1) },
    { custodyAfterHash: "45".repeat(16) },
    { generatedDropCount: parent.generatedDropCount - 1 },
    { drops: Object.freeze([Object.freeze({})]) },
  ]) {
    assert.equal(
      rustIntegratedPlayerRespawnParentAttestsReceiptV1({ ...parent, ...drift }, baseline),
      false,
    );
  }
  assert.equal(
    rustIntegratedPlayerRespawnParentAttestsReceiptV1(parent, accepted().respawn),
    false,
    "a keep-inventory BWE7 cannot attest a durable false-policy parent",
  );
});

test("release policy rejects bad +1/+2 identity, lane revision, hash, and count combinations", () => {
  const releaseRequest = Object.freeze({ ...REQUEST, keepInventory: false });
  const plan = planRustLivePlayerRespawnV1(releaseRequest.expected, releaseRequest);
  const empty = accepted(plan);
  const dropped = accepted(plan, {
    inventoryAfterRevision: BigInt(5),
    custodyAfterHash: "44".repeat(16),
    generatedDropCount: 1,
  });
  const before = plan.request.expected;
  const after = (gameplayDelta: number) => identity("46".repeat(16), {
    entities: before.revision.entities + 1,
    gameplay: before.revision.gameplay + gameplayDelta,
    simulation: before.revision.simulation + 1,
  });
  const invalid: ReadonlyArray<readonly [
    RustIntegratedPlayerRespawnReceiptV1,
    Partial<RustIntegratedPlayerRespawnReceiptV1>,
    string,
  ]> = [
    [empty.respawn, { after: after(2) }, "player-respawn-identity"],
    [empty.respawn, { inventoryAfterRevision: BigInt(5) }, "player-respawn-inventory-policy"],
    [empty.respawn, { equipmentAfterRevision: BigInt(3) }, "player-respawn-inventory-policy"],
    [empty.respawn, { custodyAfterHash: "44".repeat(16) }, "player-respawn-inventory-policy"],
    [dropped.respawn, { after: after(1) }, "player-respawn-identity"],
    [dropped.respawn, { after: after(3) }, "player-respawn-identity"],
    [dropped.respawn, { inventoryAfterRevision: BigInt(6) }, "player-respawn-inventory-policy"],
    [dropped.respawn, { equipmentAfterRevision: BigInt(4) }, "player-respawn-inventory-policy"],
    [dropped.respawn, { inventoryAfterRevision: BigInt(4) }, "player-respawn-inventory-policy"],
    [dropped.respawn, { custodyAfterHash: dropped.respawn.custodyBeforeHash }, "player-respawn-inventory-policy"],
    [dropped.respawn, { generatedDropCount: 0 }, "player-respawn-inventory-policy"],
    [dropped.respawn, { generatedDropCount: 18 }, "player-respawn-integer"],
  ];

  for (const [baseline, overrides, expectedCode] of invalid) {
    assert.throws(
      () => encodeRustIntegratedPlayerRespawnReceiptV1(
        resealedRespawn(baseline, overrides),
      ),
      (error: unknown) => error instanceof RustIntegratedPlayerRespawnErrorV1
        && error.code === expectedCode,
    );
  }
});

test("BWD7 rejects malformed, trailing, noncanonical, out-of-bounds, and unsafe authority input", () => {
  const encoded = encodeRustIntegratedPlayerRespawnV1(REQUEST);
  assert.throws(() => decodeRustIntegratedPlayerRespawnV1(encoded.subarray(0, encoded.length - 1)), /length/u);
  assert.throws(() => decodeRustIntegratedPlayerRespawnV1(appendCanonicalBodyByte(encoded, 0)), /trailing/u);

  const nonBoolean = Uint8Array.from(encoded);
  nonBoolean[nonBoolean.length - 1] = 2;
  assert.throws(() => decodeRustIntegratedPlayerRespawnV1(resealPacket(nonBoolean)), /canonical boolean/u);

  const badChecksum = Uint8Array.from(encoded);
  badChecksum[badChecksum.length - 2] ^= 1;
  assert.throws(() => decodeRustIntegratedPlayerRespawnV1(badChecksum), /checksum/u);

  for (const request of [
    { ...REQUEST, externalEntityId: "" },
    { ...REQUEST, actorId: "actor:\u0001bad" },
    { ...REQUEST, playerId: BigInt(0) },
    { ...REQUEST, expectedEntityRevision: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1) },
    { ...REQUEST, expectedDeathSequence: BigInt(0) },
    { ...REQUEST, expectedMaxHealth: 0 },
    { ...REQUEST, respawnPosition: { ...REQUEST.respawnPosition, xMilli: 33_554_432_001 } },
    { ...REQUEST, respawnPosition: { ...REQUEST.respawnPosition, yMilli: 0.5 } },
  ]) {
    assert.throws(
      () => encodeRustIntegratedPlayerRespawnV1(request),
      (error: unknown) => error instanceof RustIntegratedPlayerRespawnErrorV1,
    );
  }

  const highNativeId = Object.freeze({ ...REQUEST, playerId: (BigInt(1) << BigInt(64)) - BigInt(1) });
  assert.equal(decodeRustIntegratedPlayerRespawnV1(encodeRustIntegratedPlayerRespawnV1(highNativeId)).playerId, highNativeId.playerId);
});

test("BWE7 enforces exact three-lane identity, cursor, vital, and keep-custody transitions", () => {
  const baseline = accepted();
  const decoded = decodeRustIntegratedPlayerRespawnReceiptV1(
    encodeRustIntegratedPlayerRespawnReceiptV1(baseline.respawn),
  );
  assert.deepEqual(decoded, baseline.respawn);
  assert.deepEqual(validateRustLivePlayerRespawnReceiptV1(baseline.plan, baseline.outer).respawn, decoded);

  for (const drift of [
    { resultingEntityRevision: BigInt(14) },
    { resultingGameplaySequence: BigInt(30) },
    { priorHealth: 1 },
    { resultingHealth: 19_999 },
    { resultingAlive: false },
    { resultingOxygenSeconds: Number.NaN },
    { inventoryAfterRevision: BigInt(5) },
    { equipmentAfterRevision: BigInt(3) },
    { custodyAfterHash: "44".repeat(16) },
    { generatedDropCount: 1 },
    { inventoryBeforeRevision: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1) },
  ] satisfies Array<Partial<RustIntegratedPlayerRespawnReceiptV1>>) {
    const contents = { ...baseline.respawn, ...drift };
    const receipt = { ...contents, receiptHash: rustIntegratedPlayerRespawnReceiptHashV1(contents) };
    assert.throws(() => encodeRustIntegratedPlayerRespawnReceiptV1(receipt), /BWE7|respawn|custody|authority/u);
  }

  const trailing = appendCanonicalBodyByte(encodeRustIntegratedPlayerRespawnReceiptV1(baseline.respawn), 0);
  assert.throws(() => decodeRustIntegratedPlayerRespawnReceiptV1(trailing), /trailing/u);
});

test("outer receipt validation rejects wrong domain, receipt seal, plan, and moved rejection identity", () => {
  const baseline = accepted();
  const wrongDomainOperation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "simulation",
    typeId: "blockwild.simulation.not-respawn.v1",
    schema: 1,
    payload: baseline.outer.domainReceipts[0]!.payload,
  });
  const wrongDomainSource = {
    ...baseline.outer,
    domainReceipts: Object.freeze([wrongDomainOperation]),
  };
  const wrongDomain = {
    ...wrongDomainSource,
    receiptHash: acceptedReceiptHash(
      wrongDomainSource.commandHash,
      wrongDomainSource.before,
      wrongDomainSource.after,
      wrongDomainOperation.payloadHash,
    ),
  };
  assert.throws(() => validateRustLivePlayerRespawnReceiptV1(baseline.plan, wrongDomain), /wrong domain receipt/u);
  assert.throws(
    () => validateRustLivePlayerRespawnReceiptV1(baseline.plan, { ...baseline.outer, receiptHash: "ff".repeat(16) }),
    /outer receipt hash/u,
  );

  const otherRequest = Object.freeze({ ...REQUEST, expectedDeathSequence: BigInt(4) });
  const otherPlan = planRustLivePlayerRespawnV1(otherRequest.expected, otherRequest);
  assert.throws(() => validateRustLivePlayerRespawnReceiptV1(otherPlan, baseline.outer), /submitted batch/u);

  const nativeRejection = rejected(baseline.plan, "player-respawn-stale", "dead state changed");
  assert.throws(
    () => validateRustLivePlayerRespawnReceiptV1(baseline.plan, nativeRejection),
    (error: unknown) => error instanceof RustIntegratedPlayerRespawnErrorV1
      && error.code === "player-respawn-stale",
  );
  const moved = identity("77".repeat(16), { simulation: 41 });
  const movedRejection = rejected(baseline.plan, "player-respawn-stale", "dead state changed", moved);
  assert.throws(() => validateRustLivePlayerRespawnReceiptV1(baseline.plan, movedRejection), /moved runtime identity/u);

  const staleRuntime = rejected(
    baseline.plan,
    "stale-runtime",
    "command was authored against an obsolete integrated authority identity",
    moved,
  );
  assert.throws(
    () => validateRustLivePlayerRespawnReceiptV1(baseline.plan, staleRuntime),
    (error: unknown) => error instanceof RustIntegratedPlayerRespawnErrorV1
      && error.code === "stale-runtime",
  );

  const conflict = rejected(baseline.plan, "idempotency-conflict", "different command bytes", moved);
  assert.throws(
    () => validateRustLivePlayerRespawnReceiptV1(baseline.plan, conflict),
    (error: unknown) => error instanceof RustIntegratedPlayerRespawnErrorV1
      && error.code === "idempotency-conflict",
  );
});

test("immediate and restored readback require exact body reset, R6/R7 cursors, and custody", () => {
  const baseline = accepted();
  const validated = validateRustLivePlayerRespawnReceiptV1(baseline.plan, baseline.outer);
  const immediate = readback(baseline);
  assert.equal(validateRustLivePlayerRespawnAfterCommandV1(baseline.plan, validated, immediate), immediate);

  const restoredIdentity = Object.freeze({
    ...baseline.outer.after,
    revision: Object.freeze({
      ...baseline.outer.after.revision,
      persistence: baseline.outer.after.revision.persistence + 1,
    }),
    stateHash: "55".repeat(16),
  });
  const restored = readback(baseline, restoredIdentity);
  assert.equal(
    validateRustLivePlayerRespawnRestoredStateV1(
      baseline.plan,
      validated,
      restored,
      restoredIdentity,
    ),
    restored,
  );
  assert.throws(
    () => validateRustLivePlayerRespawnRestoredStateV1(
      baseline.plan,
      validated,
      { ...restored, identity: baseline.outer.before },
      baseline.outer.before,
    ),
    /monotonic descendant/u,
  );
  const wrongUniverse = { ...restoredIdentity, universeId: "another-universe" };
  assert.throws(
    () => validateRustLivePlayerRespawnRestoredStateV1(
      baseline.plan,
      validated,
      { ...restored, identity: wrongUniverse },
      wrongUniverse,
    ),
    /monotonic descendant/u,
  );

  for (const drift of [
    { entityRevision: BigInt(12) },
    { combatantRevision: BigInt(6) },
    { lastRespawnSequence: BigInt(2) },
    { health: 0 },
    { position: { ...immediate.position, yMilli: immediate.position.yMilli + 1 } },
    { velocityMilliPerSecond: { xMilli: 0, yMilli: 1, zMilli: 0 } },
    { oxygenSeconds: 14.999 },
    { queuedInputsEmpty: false },
    { pendingContextCommandsEmpty: false },
    { miningStateEmpty: false },
    { inventoryRevision: BigInt(5) },
    { custodyHash: "44".repeat(16) },
    { projectedDropCount: 1 },
  ] satisfies Array<Partial<RustLivePlayerRespawnReadbackV1>>) {
    assert.throws(
      () => validateRustLivePlayerRespawnAfterCommandV1(
        baseline.plan,
        validated,
        { ...immediate, ...drift },
      ),
      /exact BWE7/u,
    );
  }
});

test("retained plan execution retries identical bytes and rejects a conflicting response", async () => {
  const baseline = accepted();
  let current = baseline.plan.batch.expected;
  const submitted: RustLivePlayerRespawnPlanV1["batch"][] = [];
  const service = {
    identity: () => current,
    command: async (batch: RustLivePlayerRespawnPlanV1["batch"]) => {
      submitted.push(batch);
      if (submitted.length === 1) current = baseline.outer.after;
      else assert.deepEqual(current, baseline.outer.after, "same-generation retry uses the settled service cache");
      return baseline.outer;
    },
  };
  const first = await executeRustLivePlayerRespawnPlanV1(service, baseline.plan);
  const retry = await executeRustLivePlayerRespawnPlanV1(service, baseline.plan);
  assert.equal(first.validated.respawn.receiptHash, retry.validated.respawn.receiptHash);
  assert.equal(submitted.length, 2);
  assert.equal(submitted[0]?.commandHash, submitted[1]?.commandHash);
  assert.equal(submitted[0]?.idempotencyKey, submitted[1]?.idempotencyKey);

  const conflictService = {
    identity: () => baseline.plan.batch.expected,
    command: async () => rejected(baseline.plan, "idempotency-conflict", "different bytes reused the key"),
  };
  await assert.rejects(
    executeRustLivePlayerRespawnPlanV1(conflictService, baseline.plan),
    (error: unknown) => error instanceof RustIntegratedPlayerRespawnErrorV1
      && error.code === "idempotency-conflict",
  );

  const advanced = identity("77".repeat(16), { simulation: 41 });
  const staleReceipt = rejected(
    baseline.plan,
    "stale-runtime",
    "command was authored against an obsolete integrated authority identity",
    advanced,
  );
  const staleService = {
    identity: () => advanced,
    command: async () => staleReceipt,
  };
  await assert.rejects(
    executeRustLivePlayerRespawnPlanV1(staleService, baseline.plan),
    (error: unknown) => error instanceof RustIntegratedPlayerRespawnErrorV1
      && error.code === "stale-runtime",
  );

  const dishonestService = {
    identity: () => baseline.plan.batch.expected,
    command: async () => staleReceipt,
  };
  await assert.rejects(
    executeRustLivePlayerRespawnPlanV1(dishonestService, baseline.plan),
    /service identity differs/u,
  );
});
