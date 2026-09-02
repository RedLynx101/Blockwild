import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as dirt from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";
import * as content from "../app/game/rust-integrated-runtime-content.ts";
import * as gameplay from "../app/game/rust-integrated-runtime-gameplay-wire.ts";
import * as edit from "../app/game/rust-integrated-runtime-native-block-edit.ts";
import * as pickup from "../app/game/rust-integrated-runtime-drop-pickup.ts";
import * as drop from "../app/game/rust-integrated-runtime-player-drop.ts";
import * as creative from "../app/game/rust-integrated-runtime-player-creative-slot.ts";
import * as inventory from "../app/game/rust-integrated-runtime-player-inventory.ts";
import * as locator from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import { RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_FAMILIES_V1 as families } from "../app/game/rust-integrated-runtime-domain-schema.generated.ts";
import { rustIntegratedRuntimeWireChecksumV1 } from "../app/game/rust-integrated-runtime-codec.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/integrated-runtime-v1/r7-gameplay-wire-v1.json", import.meta.url), "utf8")) as {
  producer: string; vectors: { family: string; hex: string }[]; rejectedReceipts: string[];
};
const bytes = (family: string) => {
  const vector = fixture.vectors.find((value) => value.family === family);
  assert.ok(vector, family); return Uint8Array.from(Buffer.from(vector.hex, "hex"));
};
const codec = <T>(decode: (bytes: Uint8Array) => T, encode: (value: T) => Uint8Array) => ({ decode, roundTrip: (bytes: Uint8Array) => encode(decode(bytes)) });
const codecs = {
  "basic-dirt-action-receipt-v1": codec(dirt.decodeRustIntegratedRuntimeBasicDirtActionQueryV1, dirt.encodeRustIntegratedRuntimeBasicDirtActionQueryV1),
  "basic-dirt-action-projection-receipt-v1": codec(dirt.decodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1, dirt.encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1),
  "content-install-page-v1": codec(content.decodeRustContentInstallPageV1, content.encodeRustContentInstallPageV1),
  "content-install-receipt-v1": codec(content.decodeRustContentInstallReceiptV1, content.encodeRustContentInstallReceiptV1),
  "gameplay-actor-grant-v1": codec(gameplay.decodeRustIntegratedGameplayActorGrantV1, gameplay.encodeRustIntegratedGameplayActorGrantV1),
  "gameplay-actor-grant-receipt-v1": codec(gameplay.decodeRustIntegratedGameplayActorGrantReceiptV1, gameplay.encodeRustIntegratedGameplayActorGrantReceiptV1),
  "gameplay-command-v1": codec(gameplay.decodeRustIntegratedGameplayScheduleBatchWireV1, gameplay.encodeRustIntegratedGameplayScheduleBatchWireV1),
  "gameplay-receipt-v1": codec(gameplay.decodeRustIntegratedGameplayReceiptWireV1, gameplay.encodeRustIntegratedGameplayReceiptWireV1),
  "native-block-edit-receipt-v1": codec(edit.decodeRustIntegratedRuntimeNativeBlockEditQueryV1, edit.encodeRustIntegratedRuntimeNativeBlockEditQueryV1),
  "native-block-edit-projection-receipt-v1": codec(edit.decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1, edit.encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1),
  "native-block-edit-receipt-v2": codec(edit.decodeRustIntegratedRuntimeNativeBlockEditQueryV2, edit.encodeRustIntegratedRuntimeNativeBlockEditQueryV2),
  "native-block-edit-projection-receipt-v2": codec(edit.decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2, edit.encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2),
  "native-drop-pickup-receipt-v1": codec(pickup.decodeRustIntegratedRuntimeDropPickupQueryV1, pickup.encodeRustIntegratedRuntimeDropPickupQueryV1),
  "native-drop-pickup-projection-receipt-v1": codec(pickup.decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1, pickup.encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1),
  "native-player-drop-receipt-v1": codec(drop.decodeRustIntegratedRuntimeNativePlayerDropQueryV1, drop.encodeRustIntegratedRuntimeNativePlayerDropQueryV1),
  "native-player-drop-projection-receipt-v1": codec(drop.decodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1, drop.encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1),
  "player-creative-slot-set-v1": codec(creative.decodeRustIntegratedPlayerCreativeSlotSetV1, creative.encodeRustIntegratedPlayerCreativeSlotSetV1),
  "player-creative-slot-set-receipt-v1": codec(creative.decodeRustIntegratedPlayerCreativeSlotSetReceiptV1, creative.encodeRustIntegratedPlayerCreativeSlotSetReceiptV1),
  "player-inventory-import-v1": codec(inventory.decodeRustIntegratedPlayerInventoryImportV1, inventory.encodeRustIntegratedPlayerInventoryImportV1),
  "player-inventory-import-receipt-v1": codec(inventory.decodeRustIntegratedPlayerInventoryImportReceiptV1, inventory.encodeRustIntegratedPlayerInventoryImportReceiptV1),
  "player-locator-item-consume-v1": codec(locator.decodeRustIntegratedPlayerLocatorItemConsumeV1, locator.encodeRustIntegratedPlayerLocatorItemConsumeV1),
  "player-locator-item-consume-receipt-v1": codec(locator.decodeRustIntegratedPlayerLocatorItemConsumeReceiptV1, locator.encodeRustIntegratedPlayerLocatorItemConsumeReceiptV1),
};

function reseal(packet: Uint8Array) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  view.setUint32(8, packet.byteLength - 28, true);
  packet.set(Buffer.from(rustIntegratedRuntimeWireChecksumV1(packet.subarray(28)), "hex"), 12);
  return packet;
}

test("Rust-authored R7 matrix exactly covers the 22 generated families and public TS codecs", () => {
  assert.equal(fixture.producer, "blockwild-engine/r7_gameplay_wire_fixture");
  const registered = Object.entries(families).filter(([, value]) => value.phase === "R7").map(([key]) => key).sort();
  assert.equal(registered.length, 22);
  assert.deepEqual(fixture.vectors.map((value) => value.family).sort(), registered);
  assert.deepEqual(Object.keys(codecs).sort(), registered);
});

for (const [family, contract] of Object.entries(codecs)) {
  test(`R7 ${family}: native bytes decode and re-encode exactly with header/hash/truncation guards`, () => {
    const source = bytes(family);
    assert.deepEqual(contract.roundTrip(source), source);
    const padded = new Uint8Array(source.length + 9); padded.set(source, 5);
    assert.deepEqual(contract.roundTrip(padded.subarray(5, source.length + 5)), source);
    for (const length of [0, 5, source.length - 1]) assert.throws(() => contract.decode(source.subarray(0, length)), `truncated ${family}`);
    const ack = family === "gameplay-actor-grant-receipt-v1";
    const badSchema = source.slice(); badSchema[ack ? 4 : 6] = 0xff;
    assert.throws(() => contract.decode(badSchema));
    const trailing = new Uint8Array(source.length + 1); trailing.set(source);
    assert.throws(() => contract.decode(ack ? trailing : reseal(trailing)));
    if (!ack) {
      const corrupt = source.slice(); corrupt[corrupt.length - 1] = corrupt.at(-1)! ^ 1;
      assert.throws(() => contract.decode(corrupt), /checksum/u);
    }
  });
}

test("R7 native receipts preserve high-u64 custody, i64 deltas, opaque bytes, and nonempty projections", () => {
  const receipt = gameplay.decodeRustIntegratedGameplayReceiptWireV1(bytes("gameplay-receipt-v1"));
  assert.equal(receipt.status, "accepted");
  if (receipt.status !== "accepted") return;
  assert.equal(receipt.before.revision.sequence, BigInt("18446744073709551611"));
  assert.equal(receipt.resourceDeltas[0]!.amount, BigInt("-9223372036854775805"));
  assert.equal(receipt.statDeltas[0]!.amount, BigInt("9223372036854775804"));
  assert.deepEqual(receipt.events[0]!.payload.bytes, Uint8Array.of(0, 128, 255));
  assert.equal(receipt.receiptHash, gameplay.rustIntegratedGameplayReceiptHashV1(receipt));
  assert.ok(dirt.decodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1(bytes("basic-dirt-action-projection-receipt-v1")).receipt);
  assert.ok(edit.decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1(bytes("native-block-edit-projection-receipt-v1")).receipt);
  assert.ok(edit.decodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2(bytes("native-block-edit-projection-receipt-v2")).dirtyEvidence);
  assert.ok(pickup.decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(bytes("native-drop-pickup-projection-receipt-v1")).receipt);
  assert.ok(drop.decodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1(bytes("native-player-drop-projection-receipt-v1")).receipt);
});

test("R7 compact acknowledgement requires caller-bound request and terminal-state hashes", () => {
  const source = bytes("gameplay-actor-grant-receipt-v1");
  const expected = gameplay.decodeRustIntegratedGameplayActorGrantReceiptV1(source);
  assert.equal(expected.requestPayloadHash, rustIntegratedRuntimeWireChecksumV1(bytes("gameplay-actor-grant-v1")));
  for (const offset of [6, 22]) {
    const corrupt = source.slice(); corrupt[offset] = corrupt[offset]! ^ 1;
    assert.throws(() => gameplay.decodeRustIntegratedGameplayActorGrantReceiptV1(corrupt, expected.requestPayloadHash, expected.resultingStateHash), /hash mismatch/u);
  }
});

test("R7 every Rust rejection tag decodes/re-encodes and unknown tags fail closed", () => {
  const codes = ["wrong-world", "stale-revision", "duplicate", "unauthorized", "invalid-command", "insufficient-resource", "invalid-target", "cooldown", "rules-rejected", "capacity", "conflict"];
  assert.equal(fixture.rejectedReceipts.length, codes.length);
  for (const [index, hex] of fixture.rejectedReceipts.entries()) {
    const source = Uint8Array.from(Buffer.from(hex, "hex"));
    const value = gameplay.decodeRustIntegratedGameplayReceiptWireV1(source);
    assert.equal(value.status, "rejected");
    if (value.status !== "rejected") continue;
    assert.equal(value.code, codes[index]); assert.equal(value.message, "blocked:雪");
    assert.deepEqual(gameplay.encodeRustIntegratedGameplayReceiptWireV1(value), source);
    const invalid = source.slice(); invalid[invalid.length - 16] = 255;
    assert.throws(() => gameplay.decodeRustIntegratedGameplayReceiptWireV1(reseal(invalid)), /enum tag/u);
  }
});

test("R7 resealed semantic hashes and native request bindings reject tampering", () => {
  for (const family of ["gameplay-command-v1", "gameplay-receipt-v1", "basic-dirt-action-projection-receipt-v1", "native-block-edit-projection-receipt-v1", "native-block-edit-projection-receipt-v2", "native-drop-pickup-projection-receipt-v1", "native-player-drop-projection-receipt-v1", "player-creative-slot-set-receipt-v1"] as const) {
    const corrupt = bytes(family); corrupt[corrupt.length - 1] = corrupt.at(-1)! ^ 1;
    assert.throws(() => codecs[family].decode(reseal(corrupt)), family);
  }
});

test("R7 bounded strings, grant sets, command tags, and schedule budgets fail closed", () => {
  for (const family of ["content-install-page-v1", "gameplay-actor-grant-v1", "gameplay-command-v1"] as const) {
    const oversized = bytes(family); new DataView(oversized.buffer).setUint32(28, 0xffff_ffff, true);
    assert.throws(() => codecs[family].decode(reseal(oversized)));
  }
  const grant = gameplay.decodeRustIntegratedGameplayActorGrantV1(bytes("gameplay-actor-grant-v1"));
  assert.throws(() => gameplay.encodeRustIntegratedGameplayActorGrantV1({ ...grant, scopes: ["inventory-self", "inventory-self"] }), /unique/u);
  assert.throws(() => gameplay.encodeRustIntegratedGameplayActorGrantV1({ ...grant, role: "unknown" as "host" }), /enum/u);
  const batch = gameplay.decodeRustIntegratedGameplayScheduleBatchWireV1(bytes("gameplay-command-v1"));
  assert.throws(() => gameplay.rustIntegratedGameplayScheduleCommandHashV1([]), /count/u);
  assert.throws(() => gameplay.rustIntegratedGameplayScheduleCommandHashV1(Array(257).fill(batch.commands[0]!)), /count/u);
  assert.throws(() => gameplay.rustIntegratedGameplayScheduleCommandHashV1([{ ...batch.commands[0]!, machineBudget: 65 }]), /budget/u);
  const unsupported = bytes("gameplay-command-v1"); unsupported[unsupported.length - 35] = 255;
  assert.throws(() => gameplay.decodeRustIntegratedGameplayScheduleBatchWireV1(reseal(unsupported)), /unknown command tag/u);
});

test("R7 resealed collection counts and query cursors reject unsafe ranges before allocation", () => {
  for (const [family, trailerSize] of [["gameplay-actor-grant-v1", 9], ["gameplay-command-v1", 39]] as const) {
    const oversized = bytes(family); new DataView(oversized.buffer).setUint32(oversized.length - trailerSize, 0xffff_ffff, true);
    assert.throws(() => codecs[family].decode(reseal(oversized)), /collection/u);
  }
  for (const family of ["basic-dirt-action-receipt-v1", "native-block-edit-receipt-v1", "native-block-edit-receipt-v2", "native-drop-pickup-receipt-v1", "native-player-drop-receipt-v1"] as const) {
    const oversized = bytes(family); new DataView(oversized.buffer).setBigUint64(oversized.length - 8, BigInt(1) << BigInt(53), true);
    assert.throws(() => codecs[family].decode(reseal(oversized)), family);
  }
  const selected = creative.decodeRustIntegratedPlayerCreativeSlotSetV1(bytes("player-creative-slot-set-v1"));
  assert.throws(() => creative.encodeRustIntegratedPlayerCreativeSlotSetV1({ ...selected, selectedSlot: 9 }), /outside the player hotbar/u);
});
