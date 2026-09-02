import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_FAMILIES_V1,
  rustIntegratedRuntimeDomainWireFamilyV1,
} from "../app/game/rust-integrated-runtime-domain-schema.generated.ts";
import { rustIntegratedRuntimeWireChecksumV1 } from "../app/game/rust-integrated-runtime-codec.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";
import {
  rustIntegratedPlayerInventoryMetadataHashV1,
  type RustIntegratedPlayerInventoryMetadataV1,
  type RustIntegratedPlayerInventoryStackV1,
} from "../app/game/rust-integrated-runtime-player-inventory.ts";
import {
  decodeRustIntegratedRuntimeContextContinuityQueryV2, decodeRustIntegratedRuntimeContextContinuityReceiptV2,
  encodeRustIntegratedRuntimeContextContinuityQueryV2, encodeRustIntegratedRuntimeContextContinuityReceiptV2,
} from "../app/game/rust-integrated-runtime-context-continuity-v2.ts";
import {
  decodeRustIntegratedPlayerBootstrapStatusQueryV1, decodeRustIntegratedPlayerBootstrapStatusReceiptV1,
  encodeRustIntegratedPlayerBootstrapStatusQueryV1, encodeRustIntegratedPlayerBootstrapStatusReceiptV1,
} from "../app/game/rust-integrated-runtime-player-status.ts";
import {
  decodeRustIntegratedPlayerCombatBootstrapStatusQueryV1, decodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1,
  encodeRustIntegratedPlayerCombatBootstrapStatusQueryV1, encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1,
} from "../app/game/rust-integrated-runtime-player-combat-status.ts";
import {
  decodeRustIntegratedPlayerGameModeSetV1, decodeRustIntegratedPlayerGameModeSetReceiptV1,
  encodeRustIntegratedPlayerGameModeSetV1, encodeRustIntegratedPlayerGameModeSetReceiptV1,
} from "../app/game/rust-integrated-runtime-player-game-mode.ts";
import {
  decodeRustIntegratedPlayerRespawnV1, decodeRustIntegratedPlayerRespawnReceiptV1,
  encodeRustIntegratedPlayerRespawnV1, encodeRustIntegratedPlayerRespawnReceiptV1,
} from "../app/game/rust-integrated-runtime-player-respawn.ts";
import {
  decodeRustIntegratedCameraConfigR10, decodeRustIntegratedCameraConfigReceiptR10,
  encodeRustIntegratedCameraConfigR10, encodeRustIntegratedCameraConfigReceiptR10,
} from "../app/game/rust-integrated-runtime-camera-r10.ts";
import {
  decodeRustIntegratedPlayerBindingV1, encodeRustIntegratedPlayerBindingV1,
} from "../app/game/rust-integrated-runtime-player.ts";
import {
  decodeRustIntegratedPlayerFinalBindReceiptV1, encodeRustIntegratedPlayerFinalBindReceiptV1,
} from "../app/game/rust-integrated-runtime-player-final-bind.ts";

type FamilyId = Parameters<typeof rustIntegratedRuntimeDomainWireFamilyV1>[0];
type Vector = Readonly<{
  id: FamilyId; direction: "request" | "receipt"; magic: string;
  operationSchema: number; innerSchema: number; checksum: string; hex: string;
}>;
const fixture = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/integrated-runtime-v1/r5-simulation-wire-v1.json", import.meta.url), "utf8")) as {
  schema: number; producer: string; families: Vector[];
};
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
function packet(id: FamilyId) {
  const value = fixture.families.find((entry) => entry.id === id);
  assert.ok(value, id); return bytes(value.hex);
}
function reseal(packet: Uint8Array) {
  packet.set(bytes(rustIntegratedRuntimeWireChecksumV1(packet.subarray(28))), 12);
  return packet;
}

function reencode(id: FamilyId, payload: Uint8Array): Uint8Array {
  switch (id) {
    case "context-command-continuity-v2": return encodeRustIntegratedRuntimeContextContinuityQueryV2(decodeRustIntegratedRuntimeContextContinuityQueryV2(payload).expected);
    case "context-command-continuity-receipt-v2": return encodeRustIntegratedRuntimeContextContinuityReceiptV2(decodeRustIntegratedRuntimeContextContinuityReceiptV2(payload));
    case "player-bootstrap-status-v1": return encodeRustIntegratedPlayerBootstrapStatusQueryV1(decodeRustIntegratedPlayerBootstrapStatusQueryV1(payload));
    case "player-bootstrap-status-receipt-v1": return encodeRustIntegratedPlayerBootstrapStatusReceiptV1(decodeRustIntegratedPlayerBootstrapStatusReceiptV1(payload));
    case "player-combat-bootstrap-status-v1": return encodeRustIntegratedPlayerCombatBootstrapStatusQueryV1(decodeRustIntegratedPlayerCombatBootstrapStatusQueryV1(payload));
    case "player-combat-bootstrap-status-receipt-v1": return encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(decodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(payload));
    case "player-game-mode-set-v1": return encodeRustIntegratedPlayerGameModeSetV1(decodeRustIntegratedPlayerGameModeSetV1(payload));
    case "player-game-mode-set-receipt-v1": return encodeRustIntegratedPlayerGameModeSetReceiptV1(decodeRustIntegratedPlayerGameModeSetReceiptV1(payload));
    case "player-respawn-v1": return encodeRustIntegratedPlayerRespawnV1(decodeRustIntegratedPlayerRespawnV1(payload));
    case "player-respawn-receipt-v1": return encodeRustIntegratedPlayerRespawnReceiptV1(decodeRustIntegratedPlayerRespawnReceiptV1(payload));
    case "simulation-camera-config-v1": return encodeRustIntegratedCameraConfigR10(decodeRustIntegratedCameraConfigR10(payload));
    case "simulation-camera-config-receipt-v1": return encodeRustIntegratedCameraConfigReceiptR10(decodeRustIntegratedCameraConfigReceiptR10(payload));
    case "simulation-player-bind-v2": case "simulation-player-bind-v3": case "simulation-player-bind-v4": case "simulation-player-bind-receipt-v2":
      return encodeRustIntegratedPlayerBindingV1(decodeRustIntegratedPlayerBindingV1(payload));
    case "simulation-player-bind-final-receipt-v3": return encodeRustIntegratedPlayerFinalBindReceiptV1(3, decodeRustIntegratedPlayerFinalBindReceiptV1(3, payload));
    case "simulation-player-bind-final-receipt-v4": return encodeRustIntegratedPlayerFinalBindReceiptV1(4, decodeRustIntegratedPlayerFinalBindReceiptV1(4, payload));
    default: throw new Error(`No explicit R5 codec for ${id}`);
  }
}

test("native R5 fixture exhausts the exact 9 request and 9 receipt registry families", () => {
  assert.equal(fixture.schema, 1);
  assert.equal(fixture.producer, "blockwild-engine/r5_simulation_wire_fixture");
  const expected = Object.entries(RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_FAMILIES_V1).filter(([, family]) => family.phase === "R5");
  assert.equal(fixture.families.length, 18);
  assert.deepEqual(fixture.families.map((family) => family.id).sort(), expected.map(([id]) => id).sort());
  for (const direction of ["request", "receipt"]) assert.equal(fixture.families.filter((family) => family.direction === direction).length, 9);
});

for (const vector of fixture.families) {
  test(`Rust-authored ${vector.id} decodes/re-encodes exactly and rejects malformed framing`, () => {
    const descriptor = rustIntegratedRuntimeDomainWireFamilyV1(vector.id);
    assert.equal(vector.magic, descriptor.magic);
    assert.equal(vector.direction, descriptor.direction);
    assert.equal(vector.operationSchema, descriptor.operationSchema);
    assert.equal(vector.innerSchema, descriptor.innerSchema);
    const payload = bytes(vector.hex);
    assert.equal(rustIntegratedRuntimeWireChecksumV1(payload), vector.checksum);
    assert.equal(hex(reencode(vector.id, payload)), vector.hex);
    // Decode a nonzero-offset view too; consumers must honor byteOffset.
    const padded = new Uint8Array(payload.length + 7); padded.set(payload, 3);
    assert.equal(hex(reencode(vector.id, padded.subarray(3, 3 + payload.length))), vector.hex);
    for (let length = 0; length < payload.byteLength; length += 1) {
      assert.throws(() => reencode(vector.id, payload.subarray(0, length)), `truncated at ${length}`);
    }
    assert.throws(() => reencode(vector.id, Uint8Array.from([...payload, 0])));
    const badMagic = payload.slice(); badMagic[0] ^= 1;
    assert.throws(() => reencode(vector.id, badMagic));
    const badSchema = payload.slice(); badSchema[vector.id.includes("final-receipt") ? 4 : 6] ^= 0x80;
    assert.throws(() => reencode(vector.id, badSchema));
    if (!vector.id.includes("final-receipt")) {
      const badVersion = payload.slice(); badVersion[4] ^= 0x80;
      assert.throws(() => reencode(vector.id, badVersion));
      const badLength = payload.slice(); badLength[8] ^= 1;
      assert.throws(() => reencode(vector.id, badLength));
      const badChecksum = payload.slice(); badChecksum[12] ^= 1;
      assert.throws(() => reencode(vector.id, badChecksum));
    }
  });
}

test("R5 vectors preserve safe-number endpoints, full u64 cursors, Unicode and bind schema aliases", () => {
  const continuity = decodeRustIntegratedRuntimeContextContinuityReceiptV2(packet("context-command-continuity-receipt-v2"));
  assert.equal(continuity.identity.tick, Number.MAX_SAFE_INTEGER);
  assert.equal(continuity.lastSequence, Number.MAX_SAFE_INTEGER);
  assert.equal(continuity.nextSequence, null);
  assert.equal(continuity.identity.universeId, "universe:水");
  const status = decodeRustIntegratedPlayerBootstrapStatusReceiptV1(packet("player-bootstrap-status-receipt-v1"));
  assert.equal(status.worldAuthorityRevision.epoch, BigInt("0xf000000000000100"));
  assert.equal(status.continuity.lastInputSequence, BigInt("0xffffffffffffffff"));
  assert.equal(status.continuity.nextInputSequence, null);
  assert.equal(status.continuity.lastAppliedInput?.moveX, -32767);
  assert.equal(status.continuity.lastAppliedInput?.selectedSlot, 8);
  assert.equal(status.runtimePlayer?.binding.actorId, "actor:雪");
  const camera = decodeRustIntegratedCameraConfigReceiptR10(packet("simulation-camera-config-receipt-v1"));
  assert.equal(camera.resultingCameraRevision, BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(camera.mode, "third-front");
  assert.equal(camera.profile.rearShoulderOffset, -0.375);
  assert.equal(camera.profile.far, 65536);
  const respawn = decodeRustIntegratedPlayerRespawnV1(packet("player-respawn-v1"));
  assert.equal(respawn.respawnPosition.xMilli, -33_554_432_000);
  assert.equal(respawn.respawnPosition.zMilli, 33_554_432_000);
  for (const id of ["simulation-player-bind-v3", "simulation-player-bind-v4", "simulation-player-bind-receipt-v2"] as const) {
    assert.deepEqual(packet(id), packet("simulation-player-bind-v2"));
    assert.equal(new DataView(packet(id).buffer).getUint16(6, true), 1);
  }
});

test("R5 rejects resealed discontinuity, invalid physics, camera overflow and forged state hashes", () => {
  const status = packet("player-bootstrap-status-receipt-v1");
  const flagOffset = 28 + 16 + 24 + 8 + 9 + 8 + 8 + 9 + 1 + 9 + 9;
  const flag = status.slice(); flag[flagOffset] = 0x80;
  assert.throws(() => decodeRustIntegratedPlayerBootstrapStatusReceiptV1(reseal(flag)), /flags/u);
  const selectedSlot = status.slice(); selectedSlot[flagOffset + 2 + 28] = 9;
  assert.throws(() => decodeRustIntegratedPlayerBootstrapStatusReceiptV1(reseal(selectedSlot)), /slot/u);
  const decodedStatus = decodeRustIntegratedPlayerBootstrapStatusReceiptV1(status);
  assert.throws(() => encodeRustIntegratedPlayerBootstrapStatusReceiptV1({ ...decodedStatus, continuity: { ...decodedStatus.continuity, nextInputSequence: BigInt(1) } }), /discontinuous/u);
  const binding = decodeRustIntegratedPlayerBindingV1(packet("simulation-player-bind-v2"));
  assert.throws(() => encodeRustIntegratedPlayerBindingV1({ ...binding, radius: NaN }));
  assert.throws(() => encodeRustIntegratedPlayerBindingV1({ ...binding, sprintSpeed: binding.walkSpeed - 0.5 }));
  const camera = packet("simulation-camera-config-v1");
  new DataView(camera.buffer).setBigUint64(28, BigInt("9007199254740992"), true);
  assert.throws(() => decodeRustIntegratedCameraConfigR10(reseal(camera)), /range/u);
  for (const id of ["simulation-camera-config-receipt-v1", "player-game-mode-set-receipt-v1", "player-respawn-receipt-v1"] as const) {
    const forged = packet(id); forged[forged.length - 1] ^= 1;
    assert.throws(() => reencode(id, reseal(forged)), /hash/u);
  }
});

test("native receipts attest their exact request hashes, including both fixed-width final bind formats", () => {
  const statusRequestHash = rustIntegratedRuntimeWireChecksumV1(packet("player-bootstrap-status-v1"));
  assert.doesNotThrow(() => decodeRustIntegratedPlayerBootstrapStatusReceiptV1(packet("player-bootstrap-status-receipt-v1"), statusRequestHash));
  assert.throws(() => decodeRustIntegratedPlayerBootstrapStatusReceiptV1(packet("player-bootstrap-status-receipt-v1"), "00".repeat(16)), /request/u);
  for (const version of [3, 4] as const) {
    const payload = packet(version === 3 ? "simulation-player-bind-final-receipt-v3" : "simulation-player-bind-final-receipt-v4");
    const expected = { requestPayloadHash: rustIntegratedRuntimeWireChecksumV1(packet("simulation-player-bind-v2")), terminalStateHash: "66778899aabbccddeeff102132435465" };
    assert.deepEqual(decodeRustIntegratedPlayerFinalBindReceiptV1(version, payload, expected), expected);
    for (const offset of [6, 22]) {
      const forged = payload.slice(); forged[offset] ^= 1;
      assert.throws(() => decodeRustIntegratedPlayerFinalBindReceiptV1(version, forged, expected), /attest/u);
    }
    assert.throws(() => decodeRustIntegratedPlayerFinalBindReceiptV1(version === 3 ? 4 : 3, payload));
    assert.throws(() => encodeRustIntegratedPlayerFinalBindReceiptV1(version, { ...expected, requestPayloadHash: "bad" }));
  }
});

test("production final-bind consumers call the canonical native and TypeScript codecs", () => {
  const native = readFileSync(new URL("../engine/crates/blockwild-wasm/src/integrated_runtime.rs", import.meta.url), "utf8");
  for (const name of ["final_bind_ack", "final_combat_bind_ack"]) {
    const start = native.indexOf(`fn ${name}(`); assert.notEqual(start, -1);
    assert.match(native.slice(start, native.indexOf("\n}", start)), /encode_runtime_player_final_bind_receipt_v1/u);
  }
  const bootstrap = readFileSync(new URL("../app/game/rust-integrated-runtime-player-bootstrap.ts", import.meta.url), "utf8");
  const start = bootstrap.indexOf("function validateBindReceipt(");
  assert.match(bootstrap.slice(start, bootstrap.indexOf("\n}", start)), /decodeRustIntegratedPlayerFinalBindReceiptV1\(4, operation.payload/u);
});

function metadata(index: number, extensionBytes: number): RustIntegratedPlayerInventoryMetadataV1 {
  const value = {
    typeId: `item:wire:${index}`, schemaId: "item:wire:schema", schemaVersion: 1, contentVersion: 0,
    canonicalJsonBytes: new TextEncoder().encode("{}"), unknownExtensionBytes: new Uint8Array(extensionBytes).fill(index),
  };
  return { ...value, hash: rustIntegratedPlayerInventoryMetadataHashV1(value) };
}

function statusWithMetadata(records: readonly RustIntegratedPlayerInventoryMetadataV1[]) {
  const ordered = [...records].sort((a, b) => a.hash.localeCompare(b.hash));
  const inventorySlots: (RustIntegratedPlayerInventoryStackV1 | null)[] = Array.from({ length: 9 }, () => null);
  ordered.forEach((record, index) => { inventorySlots[index] = { itemCode: 1, count: 1, durabilityMillionths: null, metadataHash: record.hash }; });
  return {
    ...decodeRustIntegratedPlayerBootstrapStatusReceiptV1(packet("player-bootstrap-status-receipt-v1")),
    custody: {
      status: "present" as const,
      inventoryContainer: { kind: "player" as const, id: "actor:雪", ownerId: "actor:雪" },
      inventoryRevision: BigInt(7), inventorySlots,
      equipmentContainer: { kind: "equipment" as const, id: "actor:雪:equipment", ownerId: "actor:雪" },
      equipmentRevision: BigInt(8), equipmentSlots: Array.from({ length: 8 }, () => null), metadata: ordered,
    },
  };
}

// Deliberately bypass the public metadata validator to forge independently
// rehashed invalid descriptors. Rejection must not rely only on stale hashes.
function rawMetadataHash(value: RustIntegratedPlayerInventoryMetadataV1) {
  return new TypeScriptCanonicalHasher("blockwild.gameplay.item-instance-metadata.v1")
    .writeU16(1).writeString(value.typeId).writeString(value.schemaId).writeU16(value.schemaVersion)
    .writeU32(value.contentVersion).writeBytes(value.canonicalJsonBytes).writeBytes(value.unknownExtensionBytes).finishHex();
}

function replaceHash(packet: Uint8Array, oldHash: string, newHash: string) {
  const oldBytes = bytes(oldHash); const newBytes = bytes(newHash);
  for (let offset = packet.length - 16; offset >= 0; offset -= 1) {
    if (oldBytes.every((byte, index) => packet[offset + index] === byte)) packet.set(newBytes, offset);
  }
}

test("BWO5 metadata accepts exactly 256 KiB and rejects a resealed one-byte aggregate overflow", () => {
  const records = [1, 2, 3, 4].map((index) => metadata(index, 65534));
  const status = statusWithMetadata(records);
  const encoded = encodeRustIntegratedPlayerBootstrapStatusReceiptV1(status);
  assert.deepEqual(decodeRustIntegratedPlayerBootstrapStatusReceiptV1(encoded), status);
  const last = status.custody.metadata.at(-1)!;
  const oversized = { ...last, unknownExtensionBytes: Uint8Array.from([...last.unknownExtensionBytes, 0]) };
  const replacement = { ...oversized, hash: rustIntegratedPlayerInventoryMetadataHashV1(oversized) };
  const overRecords = status.custody.metadata.map((record) => record === last ? replacement : record);
  assert.throws(() => encodeRustIntegratedPlayerBootstrapStatusReceiptV1(statusWithMetadata(overRecords)), /aggregate bound/u);
  const forged = new Uint8Array(encoded.length + 1); forged.set(encoded);
  replaceHash(forged, last.hash, replacement.hash);
  const view = new DataView(forged.buffer);
  view.setUint32(encoded.length - 65534 - 4, 65535, true);
  view.setUint32(8, forged.length - 28, true);
  assert.throws(() => decodeRustIntegratedPlayerBootstrapStatusReceiptV1(reseal(forged)), /aggregate bound/u);
});

test("BWO5 metadata rejects noncanonical JSON and schema zero even when descriptor hashes match", () => {
  const valid = metadata(1, 3);
  const encoded = encodeRustIntegratedPlayerBootstrapStatusReceiptV1(statusWithMetadata([valid]));
  const metadataOffset = Buffer.from(encoded).lastIndexOf(Buffer.from(valid.hash, "hex"));
  assert.ok(metadataOffset >= 0);
  const schemaOffset = metadataOffset + 16 + 4 + new TextEncoder().encode(valid.typeId).length + 4 + new TextEncoder().encode(valid.schemaId).length;
  const jsonOffset = schemaOffset + 2 + 4 + 4;
  for (const mutateSchema of [false, true]) {
    const invalid = mutateSchema
      ? { ...valid, schemaVersion: 0 }
      : { ...valid, canonicalJsonBytes: new TextEncoder().encode("{ ") };
    invalid.hash = rawMetadataHash(invalid);
    assert.throws(() => encodeRustIntegratedPlayerBootstrapStatusReceiptV1(statusWithMetadata([invalid])));
    const forged = encoded.slice(); replaceHash(forged, valid.hash, invalid.hash);
    if (mutateSchema) new DataView(forged.buffer).setUint16(schemaOffset, 0, true);
    else forged[jsonOffset + 1] = 0x20;
    assert.throws(() => decodeRustIntegratedPlayerBootstrapStatusReceiptV1(reseal(forged)), /schema version|JSON/u);
  }
});

test("BWO5 metadata type/schema IDs match native 160-byte UTF-8 limits on encode and decode", () => {
  const nativeContract = readFileSync(new URL("../engine/crates/blockwild-gameplay/src/contract.rs", import.meta.url), "utf8");
  assert.match(nativeContract, /pub const MAX_ID_LENGTH: usize = 160;/u);
  const encoder = new TextEncoder();
  const endpoint = `${"水".repeat(53)}a`;
  assert.equal(encoder.encode(endpoint).length, 160);
  assert.equal(endpoint.length, 54, "the boundary is bytes, not JavaScript string length");
  for (const field of ["typeId", "schemaId"] as const) {
    const value = { ...metadata(1, 3), [field]: endpoint };
    value.hash = rustIntegratedPlayerInventoryMetadataHashV1(value);
    const status = statusWithMetadata([value]);
    const encoded = encodeRustIntegratedPlayerBootstrapStatusReceiptV1(status);
    assert.deepEqual(decodeRustIntegratedPlayerBootstrapStatusReceiptV1(encoded), status);
    const tooLong = { ...value, [field]: `${endpoint}b` };
    // The shared generic helper is intentionally unchanged; BWO5 owns this cap.
    tooLong.hash = rustIntegratedPlayerInventoryMetadataHashV1(tooLong);
    assert.throws(() => encodeRustIntegratedPlayerBootstrapStatusReceiptV1(statusWithMetadata([tooLong])), /160-byte UTF-8 bound/u);

    const metadataOffset = Buffer.from(encoded).lastIndexOf(Buffer.from(value.hash, "hex"));
    assert.ok(metadataOffset >= 0);
    const lengthOffset = metadataOffset + 16 + (field === "schemaId" ? 4 + encoder.encode(value.typeId).length : 0);
    const insertionOffset = lengthOffset + 4 + 160;
    const forged = new Uint8Array(encoded.length + 1);
    forged.set(encoded.subarray(0, insertionOffset));
    forged[insertionOffset] = 0x62;
    forged.set(encoded.subarray(insertionOffset), insertionOffset + 1);
    const view = new DataView(forged.buffer);
    view.setUint32(lengthOffset, 161, true);
    view.setUint32(8, forged.length - 28, true);
    replaceHash(forged, value.hash, tooLong.hash);
    assert.throws(() => decodeRustIntegratedPlayerBootstrapStatusReceiptV1(reseal(forged)), /160-byte UTF-8 bound/u);
  }
});
