import assert from "node:assert/strict";
import test from "node:test";
import {
  RustIntegratedPlayerInventoryReaderV1 as Reader,
  RustIntegratedPlayerInventoryWriterV1 as Writer,
  rustIntegratedPlayerInventoryMetadataHashV1,
} from "../app/game/rust-integrated-runtime-player-inventory";
import {
  encodeRustIntegratedGameplayActorGrantV1,
  decodeRustIntegratedGameplayActorGrantV1,
} from "../app/game/rust-integrated-runtime-gameplay-wire";

test("shared native inventory text preserves leading, interior and BOM-only UTF-8 identifiers", () => {
  for (const value of ["\uFEFF", "\uFEFFplayer:水", "player:\uFEFF", "player:🦊"]) {
    const writer = new Writer();
    writer.string(value);
    const packet = writer.finish();
    const expected = new TextEncoder().encode(value);
    assert.equal(new DataView(packet.buffer).getUint32(0, true), expected.length);
    assert.deepEqual(packet.subarray(4), expected);
    const reader = new Reader(packet);
    assert.equal(reader.string(), value);
    reader.finish();
  }
});

test("R7 actor grants retain BOM-prefixed IDs without changing their native packet bytes", () => {
  const value = { actorId: "\uFEFF", playerId: null, entityId: null, role: "system" as const, scopes: ["system"] as const };
  const packet = encodeRustIntegratedGameplayActorGrantV1(value);
  assert.deepEqual(decodeRustIntegratedGameplayActorGrantV1(packet), value);
  assert.deepEqual(encodeRustIntegratedGameplayActorGrantV1(decodeRustIntegratedGameplayActorGrantV1(packet)), packet);
});

test("metadata JSON rejects a leading BOM rather than silently normalizing its hashed bytes", () => {
  const value = {
    typeId: "item-instance", schemaId: "item-instance-v1", schemaVersion: 1, contentVersion: 1,
    canonicalJsonBytes: new TextEncoder().encode("{}"), unknownExtensionBytes: new Uint8Array(),
  };
  assert.match(rustIntegratedPlayerInventoryMetadataHashV1(value), /^[a-f0-9]{32}$/u);
  assert.throws(() => rustIntegratedPlayerInventoryMetadataHashV1({
    ...value, canonicalJsonBytes: new TextEncoder().encode("\uFEFF{}"),
  }), /JSON is invalid/u);
});
