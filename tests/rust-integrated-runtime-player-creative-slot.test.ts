import assert from "node:assert/strict";
import test from "node:test";
import { createRustIntegratedRuntimeDomainOperationV1, rustIntegratedRuntimeWireChecksumV1 } from "../app/game/rust-integrated-runtime-codec.ts";
import type { RustIntegratedRuntimeAcceptedReceiptV1, RustIntegratedRuntimeIdentityV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_TYPE_V1,
  decodeRustIntegratedPlayerCreativeSlotSetReceiptV1,
  decodeRustIntegratedPlayerCreativeSlotSetV1,
  encodeRustIntegratedPlayerCreativeSlotSetReceiptV1,
  encodeRustIntegratedPlayerCreativeSlotSetV1,
  planRustLiveCreativeSlotSetV1,
  rustIntegratedPlayerCreativeSlotSetReceiptHashV1,
  validateRustLiveCreativeSlotSetAfterCommandV1,
  validateRustLiveCreativeSlotSetReceiptV1,
  type RustIntegratedPlayerCreativeSlotSetReceiptV1,
  type RustIntegratedPlayerCreativeSlotSetV1,
} from "../app/game/rust-integrated-runtime-player-creative-slot.ts";
import { rustIntegratedContainerViewKeyV1 } from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import type { RustIntegratedGameplayAuthorityIdentityV1 } from "../app/game/rust-integrated-runtime-player-inventory.ts";
import type { RustLivePlayerViewR10 } from "../app/game/rust-live-player-view-r10.ts";

const inventory = Object.freeze({ kind: "player" as const, id: "player:creative", ownerId: "player:creative" });
const replacementStack = Object.freeze({ itemCode: 270, count: 64, durabilityMillionths: null, metadataHash: "12".repeat(16) });
const previousStack = Object.freeze({ itemCode: 3, count: 2, durabilityMillionths: null, metadataHash: "34".repeat(16) });
const request: RustIntegratedPlayerCreativeSlotSetV1 = Object.freeze({ inventory, selectedSlot: 2, expectedInventoryRevision: BigInt(9), expectedStack: previousStack, replacementStack });
const hashBytes = (value: string) => Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
function identity(gameplay = 7, state = "56".repeat(16)): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({ universeId: "world:creative", locationId: "surface", revision: Object.freeze({ epoch: 1, world: 3, entities: 5, gameplay, persistence: 2, network: 4, simulation: 6 }), tick: 41, stateHash: state });
}
function gameplayIdentity(sequence: bigint, revision: bigint, stateHash: string): RustIntegratedGameplayAuthorityIdentityV1 {
  return Object.freeze({ universe: "world:creative", location: "surface", revision: Object.freeze({ epoch: 1, sequence, inventory: revision, machines: BigInt(3), combat: BigInt(4), progression: BigInt(5), cardforge: BigInt(6) }), stateHash });
}
function outerHash(value: Omit<RustIntegratedRuntimeAcceptedReceiptV1, "receiptHash">) {
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([...hashBytes(value.commandHash), ...hashBytes(value.before.stateHash), ...hashBytes(value.after.stateHash), ...value.domainReceipts.flatMap((entry) => [...hashBytes(entry.payloadHash)])]));
}
function accepted(plan = planRustLiveCreativeSlotSetV1(identity(), "player:creative", request), overrides: Partial<RustIntegratedPlayerCreativeSlotSetReceiptV1> = {}) {
  const contents = Object.freeze({ requestPayloadHash: plan.requestPayloadHash, before: gameplayIdentity(BigInt(11), BigInt(20), "67".repeat(16)), after: gameplayIdentity(BigInt(12), BigInt(21), "78".repeat(16)),
    acceptedReceiptHash: "89".repeat(16), inventory, selectedSlot: 2, previousInventoryRevision: BigInt(9), resultingInventoryRevision: BigInt(10), previousStack,
    replacementStack, inventoryResultHash: "9a".repeat(16), ...overrides });
  const creativeSlot = Object.freeze({ ...contents, receiptHash: rustIntegratedPlayerCreativeSlotSetReceiptHashV1(contents) });
  const operation = createRustIntegratedRuntimeDomainOperationV1({ domain: "gameplay", typeId: RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_RECEIPT_TYPE_V1, schema: 1,
    payload: encodeRustIntegratedPlayerCreativeSlotSetReceiptV1(creativeSlot) });
  const source = Object.freeze({ status: "accepted" as const, commandId: plan.batch.commandId, idempotencyKey: plan.batch.idempotencyKey, commandHash: plan.batch.commandHash,
    before: plan.batch.expected, after: identity(8, "ab".repeat(16)), domainReceipts: Object.freeze([operation]) });
  return Object.freeze({ plan, creativeSlot, receipt: Object.freeze({ ...source, receiptHash: outerHash(source) }) });
}
function playerView(): RustLivePlayerViewR10 {
  return Object.freeze({ extractionRevision: BigInt(3), authorityTick: BigInt(41), externalEntityId: "player:creative", actorId: "player:creative", playerId: BigInt(1), entityId: BigInt(2), entityRevision: BigInt(4),
    inventoryContainer: rustIntegratedContainerViewKeyV1(inventory), inventoryContainerRevision: BigInt(10), equipmentContainer: "container-key-v1/00", equipmentContainerRevision: BigInt(1), selectedSlot: 2,
    backSlot: null, lastInputSequence: BigInt(0), buttons: 0, authoritativeFlags: 0, lookYaw: null, lookPitch: 0, position: Object.freeze({ x: 0, y: 64, z: 0 }), velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    radius: .3, height: 1.8, mass: 1, grounded: true, crouching: false, contactFlags: 0, inLiquid: false, headSubmerged: false,
    drowningAccumulator: 0, fallDistance: 0, oxygenSeconds: 10, maximumOxygenSeconds: 10, health: 20, maximumHealth: 20, lastDamageTick: BigInt(0),
    combat: Object.freeze({ domainRevision: BigInt(1), rowRevision: BigInt(1), recordId: "player:creative", ownerId: "player:creative", entityId: BigInt(2),
      vitalUnits: "millihearts-v1" as const, health: 20_000, maxHealth: 20_000, alive: true, crossDomainParity: true as const }),
    effects: Object.freeze({ schema: 1 as const, producer: "rust-bwau-v2" as const, playerExternalId: "player:creative", authorityTick: BigInt(41),
      total: 0, selected: 0, omitted: 0, firstSequence: null, lastSequence: null, contiguous: true, cues: Object.freeze([]) }),
    held: Object.freeze({ itemCode: replacementStack.itemCode, count: replacementStack.count, durabilityMillionths: null, metadataHash: hashBytes(replacementStack.metadataHash) }) });
}

test("BWF7/BWH7 round trip exact Creative selected-slot CAS bytes", () => {
  const encoded = encodeRustIntegratedPlayerCreativeSlotSetV1(request);
  assert.equal(Buffer.from(encoded.subarray(0, 4)).toString("ascii"), "BWF7");
  assert.deepEqual(decodeRustIntegratedPlayerCreativeSlotSetV1(encoded), request);
  const { creativeSlot } = accepted();
  const receipt = encodeRustIntegratedPlayerCreativeSlotSetReceiptV1(creativeSlot);
  assert.equal(Buffer.from(receipt.subarray(0, 4)).toString("ascii"), "BWH7");
  assert.deepEqual(decodeRustIntegratedPlayerCreativeSlotSetReceiptV1(receipt), creativeSlot);
  assert.equal(receipt.byteLength, encodeRustIntegratedPlayerCreativeSlotSetReceiptV1(creativeSlot).byteLength, "Rust-shaped BWH7 includes the trailing 16-byte receipt seal");
  const body = receipt.subarray(28);
  assert.equal(Buffer.from(body.subarray(-16)).toString("hex"), rustIntegratedRuntimeWireChecksumV1(body.subarray(0, -16)));
  const resealedPacketTamper = Uint8Array.from(receipt);
  resealedPacketTamper[40] ^= 1;
  resealedPacketTamper.set(hashBytes(rustIntegratedRuntimeWireChecksumV1(resealedPacketTamper.subarray(28))), 12);
  assert.throws(() => decodeRustIntegratedPlayerCreativeSlotSetReceiptV1(resealedPacketTamper), /canonical pre-hash contents/u);
  for (const packet of [encoded, receipt]) {
    const tampered = Uint8Array.from(packet); tampered[tampered.length - 1] ^= 1;
    assert.throws(() => packet === encoded ? decodeRustIntegratedPlayerCreativeSlotSetV1(tampered) : decodeRustIntegratedPlayerCreativeSlotSetReceiptV1(tampered), /checksum/u);
  }
});

test("Creative selected-slot plan, receipt, and immediate player readback preserve exact CAS custody", () => {
  const { plan, receipt } = accepted();
  assert.equal(plan.batch.operations[0].typeId, RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_TYPE_V1);
  assert.equal(plan.batch.commandId, `player-creative-slot-set:${plan.requestPayloadHash}`);
  const validated = validateRustLiveCreativeSlotSetReceiptV1(plan, receipt);
  assert.equal(validated.creativeSlot.resultingInventoryRevision, BigInt(10));
  const player = playerView();
  assert.equal(validateRustLiveCreativeSlotSetAfterCommandV1(plan, validated, player), player);
});

test("Creative selected-slot CAS rejects receipt, rejection, and extraction drift", () => {
  const baseline = accepted();
  for (const drift of [
    { previousStack: null }, { resultingInventoryRevision: BigInt(11) }, { replacementStack: { ...replacementStack, count: 63 } },
  ] satisfies Array<Partial<RustIntegratedPlayerCreativeSlotSetReceiptV1>>) {
    const forged = accepted(baseline.plan, drift);
    assert.throws(() => validateRustLiveCreativeSlotSetReceiptV1(forged.plan, forged.receipt), /exact selected-slot CAS/u);
  }
  const rejectedSource = Object.freeze({ status: "rejected" as const, commandId: baseline.plan.batch.commandId, idempotencyKey: baseline.plan.batch.idempotencyKey,
    commandHash: baseline.plan.batch.commandHash, current: baseline.plan.batch.expected, code: "stale-inventory", message: "stale" });
  const rejected = Object.freeze({ ...rejectedSource, receiptHash: rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
    ...hashBytes(rejectedSource.commandHash), ...hashBytes(rejectedSource.current.stateHash), ...new TextEncoder().encode(rejectedSource.code), ...new TextEncoder().encode(rejectedSource.message),
  ])) });
  assert.throws(() => validateRustLiveCreativeSlotSetReceiptV1(baseline.plan, rejected), /stale/u);
  const validated = validateRustLiveCreativeSlotSetReceiptV1(baseline.plan, baseline.receipt);
  assert.throws(() => validateRustLiveCreativeSlotSetAfterCommandV1(baseline.plan, validated, { ...playerView(), inventoryContainerRevision: BigInt(9) }), /post-command/u);

  assert.throws(() => encodeRustIntegratedPlayerCreativeSlotSetReceiptV1({
    ...baseline.creativeSlot,
    receiptHash: "ff".repeat(16),
  }), /canonical pre-hash contents/u);
});
