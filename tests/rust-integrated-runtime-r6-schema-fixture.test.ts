import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decodeRustEntityAuthoritySnapshotR6V2, decodeRustEntityCompatibilityRecordR6V1,
  encodeRustEntityAuthoritySnapshotR6V2, encodeRustEntityCompatibilityRecordR6V1,
} from "../app/game/rust-entity-authority-codec-r6.ts";
import { computeRustEntityAuthorityHashR6V2 } from "../app/game/rust-entity-authority-hash-r6.ts";
import {
  decodeRustIntegratedEntityAuthorityExportV1, decodeRustIntegratedEntityAuthorityImportV2,
  decodeRustIntegratedEntityAuthorityImportReceiptV1, decodeRustIntegratedEntityCompatibilityExportV1,
  decodeRustIntegratedEntityCompatibilityImportV1, decodeRustIntegratedEntityCommandBatchV1,
  decodeRustIntegratedEntityEventBatchReceiptV1,
  encodeRustIntegratedEntityAuthorityExportV1, encodeRustIntegratedEntityAuthorityImportV2,
  encodeRustIntegratedEntityAuthorityImportReceiptV1, encodeRustIntegratedEntityCompatibilityExportV1,
  encodeRustIntegratedEntityCompatibilityImportV1, encodeRustIntegratedEntityCommandBatchV1,
  encodeRustIntegratedEntityEventBatchReceiptV1,
} from "../app/game/rust-integrated-runtime-entities.ts";
import {
  RUST_INTEGRATED_RUNTIME_DOMAIN_SCHEMA_FINGERPRINT_V1,
  RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_FAMILIES_V1,
  rustIntegratedRuntimeDomainWireFamilyV1,
  type RustIntegratedRuntimeDomainWireFamilyIdV1,
} from "../app/game/rust-integrated-runtime-domain-schema.generated.ts";
import {
  createRustIntegratedRuntimeCommandBatchV1, createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";

type Family = Readonly<{
  id: RustIntegratedRuntimeDomainWireFamilyIdV1; direction: "request" | "receipt"; typeId: string;
  operationSchema: number; innerSchema: number; payloadHash: string; hex: string;
}>;
const fixture = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/integrated-runtime-v1/r6-entity-domain-wire-v1.json", import.meta.url), "utf8")) as {
  schema: number; producer: string; schemaFingerprint: string; nativeAuthorityHash: string;
  commandTags: number; eventTags: number; hashAssurance: string; families: Family[];
};
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const family = (id: Family["id"]) => fixture.families.find((entry) => entry.id === id)!;
const packet = (id: Family["id"]) => bytes(family(id).hex);
const u64Max = (BigInt(1) << BigInt(64)) - BigInt(1);

function roundTrip<T>(decode: (value: Uint8Array) => T, encode: (value: T) => Uint8Array) {
  return (value: Uint8Array) => encode(decode(value));
}
const codecs: Readonly<Record<string, (value: Uint8Array) => Uint8Array>> = {
  "entity-authority-export-v1": roundTrip(decodeRustIntegratedEntityAuthorityExportV1, encodeRustIntegratedEntityAuthorityExportV1),
  "entity-authority-import-v2": roundTrip(decodeRustIntegratedEntityAuthorityImportV2, encodeRustIntegratedEntityAuthorityImportV2),
  "entity-compatibility-export-v1": roundTrip(decodeRustIntegratedEntityCompatibilityExportV1, encodeRustIntegratedEntityCompatibilityExportV1),
  "entity-compatibility-import-v1": roundTrip(decodeRustIntegratedEntityCompatibilityImportV1, encodeRustIntegratedEntityCompatibilityImportV1),
  "entity-command-v1": roundTrip(decodeRustIntegratedEntityCommandBatchV1, encodeRustIntegratedEntityCommandBatchV1),
  "entity-authority-import-receipt-v1": roundTrip(decodeRustIntegratedEntityAuthorityImportReceiptV1, encodeRustIntegratedEntityAuthorityImportReceiptV1),
  "entity-authority-snapshot-v2": roundTrip(decodeRustEntityAuthoritySnapshotR6V2, encodeRustEntityAuthoritySnapshotR6V2),
  "entity-compatibility-record-v1": roundTrip(decodeRustEntityCompatibilityRecordR6V1, encodeRustEntityCompatibilityRecordR6V1),
  "entity-receipt-v1": roundTrip(decodeRustIntegratedEntityEventBatchReceiptV1, encodeRustIntegratedEntityEventBatchReceiptV1),
};

function reseal(value: Uint8Array) {
  new DataView(value.buffer, value.byteOffset, value.byteLength).setUint32(8, value.byteLength - 28, true);
  value.set(bytes(rustIntegratedRuntimeWireChecksumV1(value.subarray(28))), 12);
  return value;
}

test("native R6 vectors close all 5 request and 4 receipt families against generated descriptors", async (t) => {
  assert.equal(fixture.schema, 1);
  assert.equal(fixture.producer, "blockwild-engine/r6_entity_domain_wire_fixture");
  assert.equal(fixture.schemaFingerprint, RUST_INTEGRATED_RUNTIME_DOMAIN_SCHEMA_FINGERPRINT_V1);
  const expected = Object.entries(RUST_INTEGRATED_RUNTIME_DOMAIN_WIRE_FAMILIES_V1).filter(([, entry]) => entry.phase === "R6");
  assert.deepEqual(fixture.families.map((entry) => entry.id).sort(), expected.map(([id]) => id).sort());
  assert.equal(fixture.families.filter((entry) => entry.direction === "request").length, 5);
  assert.equal(fixture.families.filter((entry) => entry.direction === "receipt").length, 4);
  for (const entry of fixture.families) await t.test(entry.id, () => {
    const descriptor = rustIntegratedRuntimeDomainWireFamilyV1(entry.id);
    assert.equal(entry.typeId, descriptor.typeId); assert.equal(entry.direction, descriptor.direction);
    assert.equal(entry.operationSchema, descriptor.operationSchema); assert.equal(entry.innerSchema, descriptor.innerSchema);
    const value = bytes(entry.hex);
    assert.equal(new TextDecoder().decode(value.subarray(0, 4)), descriptor.magic);
    assert.equal(rustIntegratedRuntimeWireChecksumV1(value), entry.payloadHash, "native payload checksum matches TS independently");
    assert.equal(hex(codecs[entry.id](value)), entry.hex, "native payload must decode and re-encode byte-exactly");
  });
});

test("native R6 vectors retain all command/event tags, full u64 ids, Unicode and opaque extensions", () => {
  const command = decodeRustIntegratedEntityCommandBatchV1(packet("entity-command-v1"));
  assert.equal(command.commands.length, fixture.commandTags); assert.equal(fixture.commandTags, 29);
  assert.equal(new Set(command.commands.map((entry) => entry.type)).size, 29);
  assert.equal(command.sequence, u64Max); assert.equal(command.expectedRevision, u64Max - BigInt(1));
  const spawn = command.commands[0]; assert.equal(spawn.type, "spawn");
  if (spawn.type !== "spawn") throw new Error("fixture spawn missing");
  assert.equal(spawn.record.externalEntityId, "entity:雪:🦀"); assert.equal(spawn.record.legacyNumericId, u64Max);
  assert.equal(spawn.record.locationId, u64Max); assert.equal(spawn.record.research[0][1], 0xffff_ffff);
  const typed = command.commands[8]; assert.equal(typed.type, "spawn-typed");
  if (!("componentsSnapshot" in typed)) throw new Error("typed fixture missing");
  assert.deepEqual([...decodeRustEntityAuthoritySnapshotR6V2(typed.componentsSnapshot).hot[0].components.unknownExtensions[0][1]], [0, 128, 255]);
  const receipt = decodeRustIntegratedEntityEventBatchReceiptV1(packet("entity-receipt-v1"));
  assert.equal(receipt.events.length, fixture.eventTags); assert.equal(fixture.eventTags, 24);
  assert.equal(new Set(receipt.events.map((entry) => entry.kind.type)).size, 24);
  assert.equal(receipt.revision, u64Max);
  assert.equal(decodeRustIntegratedEntityCompatibilityExportV1(packet("entity-compatibility-export-v1")).entityId, u64Max);
});

test("every native R6 packet rejects header/schema/truncation/trailing tamper", async (t) => {
  for (const entry of fixture.families) await t.test(entry.id, () => {
    const raw = entry.id === "entity-authority-snapshot-v2" || entry.id === "entity-compatibility-record-v1";
    for (const offset of [0, raw ? 4 : 6]) {
      const value = bytes(entry.hex); value[offset] ^= 0x7f;
      assert.throws(() => codecs[entry.id](value));
    }
    const value = bytes(entry.hex);
    assert.throws(() => codecs[entry.id](value.subarray(0, value.length - 1)));
    assert.throws(() => codecs[entry.id](Uint8Array.from([...value, 0])));
    if (!raw) for (const offset of [4, 8, 12, value.length - 1]) {
      const corrupt = Uint8Array.from(value); corrupt[offset] ^= 1;
      assert.throws(() => codecs[entry.id](corrupt));
    }
  });
});

test("R6 rejects oversized counts, invalid tags and nested schema even after outer checksum reseal", () => {
  for (const id of ["entity-command-v1", "entity-receipt-v1"] as const) {
    const value = packet(id); new DataView(value.buffer).setUint32(52, 257, true); reseal(value);
    assert.throws(() => codecs[id](value), /count|bound/u);
  }
  const command = packet("entity-command-v1"); command[56] = 255; reseal(command);
  assert.throws(() => decodeRustIntegratedEntityCommandBatchV1(command), /command tag/u);
  const nested = packet("entity-authority-import-v2"); new DataView(nested.buffer).setUint16(44, 3, true); reseal(nested);
  assert.throws(() => decodeRustIntegratedEntityAuthorityImportV2(nested), /schema/u);
  const nestedLength = packet("entity-authority-import-v2"); new DataView(nestedLength.buffer).setUint32(36, 0xffff_ffff, true); reseal(nestedLength);
  assert.throws(() => decodeRustIntegratedEntityAuthorityImportV2(nestedLength), /budget/u);
  const record = packet("entity-compatibility-record-v1"); new DataView(record.buffer).setUint32(6, 4097, true);
  assert.throws(() => decodeRustEntityCompatibilityRecordR6V1(record), /bound/u);
  const snapshot = packet("entity-authority-snapshot-v2"); new DataView(snapshot.buffer).setUint32(23, 65537, true);
  assert.throws(() => decodeRustEntityAuthoritySnapshotR6V2(snapshot), /bound/u);
});

test("R6 command/event batch limits accept 256 and reject 257 on both encoder and decoder boundaries", () => {
  const batch = decodeRustIntegratedEntityCommandBatchV1(packet("entity-command-v1"));
  const command = batch.commands[3];
  const maximum = { ...batch, commands: Array.from({ length: 256 }, () => command) };
  assert.equal(decodeRustIntegratedEntityCommandBatchV1(encodeRustIntegratedEntityCommandBatchV1(maximum)).commands.length, 256);
  assert.throws(() => encodeRustIntegratedEntityCommandBatchV1({ ...maximum, commands: [...maximum.commands, command] }), /bound/u);
  const batchEvents = decodeRustIntegratedEntityEventBatchReceiptV1(packet("entity-receipt-v1"));
  const event = batchEvents.events[0]; const maximumEvents = { ...batchEvents, events: Array.from({ length: 256 }, () => event) };
  assert.equal(decodeRustIntegratedEntityEventBatchReceiptV1(encodeRustIntegratedEntityEventBatchReceiptV1(maximumEvents)).events.length, 256);
  assert.throws(() => encodeRustIntegratedEntityEventBatchReceiptV1({ ...maximumEvents, events: [...maximumEvents.events, event] }), /invalid/u);
  assert.throws(() => encodeRustIntegratedEntityAuthorityExportV1({ expectedRevision: u64Max + BigInt(1) }), /u64/u);
  assert.throws(() => encodeRustIntegratedEntityCompatibilityExportV1({ entityId: BigInt(0), expectedEntityRevision: BigInt(0) }), /reserved/u);
});

test("R6 typed command projections validate their nested authority snapshot and required residency", () => {
  const batch = decodeRustIntegratedEntityCommandBatchV1(packet("entity-command-v1"));
  const typed = batch.commands[8]; const dormant = batch.commands[28];
  if (!("componentsSnapshot" in typed) || !("dormantSnapshot" in dormant)) throw new Error("fixture projections missing");
  const invalid = Uint8Array.from(typed.componentsSnapshot); invalid[4] = 3;
  assert.throws(() => encodeRustIntegratedEntityCommandBatchV1({ ...batch, commands: [{ ...typed, componentsSnapshot: invalid }] }), /schema/u);
  assert.throws(() => encodeRustIntegratedEntityCommandBatchV1({ ...batch, commands: [{ ...typed, componentsSnapshot: dormant.dormantSnapshot }] }), /one hot/u);
  assert.throws(() => encodeRustIntegratedEntityCommandBatchV1({ ...batch, commands: [{ ...dormant, dormantSnapshot: typed.componentsSnapshot }] }), /one cold/u);
});

test("BWE6 preserves stricter integrated string and finite-f32 validation than the raw save format", () => {
  const batch = decodeRustIntegratedEntityCommandBatchV1(packet("entity-command-v1"));
  const spawn = batch.commands[0];
  if (spawn.type !== "spawn") throw new Error("fixture spawn missing");
  for (const name of ["", "line\nbreak", "control:\u0080"]) {
    assert.throws(() => encodeRustIntegratedEntityCommandBatchV1({
      ...batch, commands: [{ ...spawn, record: { ...spawn.record, name } }],
    }), /nonempty|controls/u);
  }
  const control = packet("entity-command-v1"); control[61] = 0; reseal(control);
  assert.throws(() => decodeRustIntegratedEntityCommandBatchV1(control), /controls/u);
  assert.throws(() => encodeRustIntegratedEntityCommandBatchV1({
    ...batch, commands: [{ ...spawn, record: { ...spawn.record, yaw: Number.MAX_VALUE } }],
  }), /finite f32/u);
  const motion = batch.commands[5];
  if (motion.type !== "update-motion") throw new Error("fixture motion missing");
  const nonfinite = encodeRustIntegratedEntityCommandBatchV1({ ...batch, commands: [motion] });
  new DataView(nonfinite.buffer).setUint32(65, 0x7f80_0000, true); reseal(nonfinite);
  assert.throws(() => decodeRustIntegratedEntityCommandBatchV1(nonfinite), /finite/u);
});

test("R6 native authority hash is independently recomputed and binds the import receipt", () => {
  const imported = decodeRustIntegratedEntityAuthorityImportV2(packet("entity-authority-import-v2"));
  assert.equal(hex(imported.snapshot), family("entity-authority-snapshot-v2").hex);
  const snapshot = decodeRustEntityAuthoritySnapshotR6V2(imported.snapshot);
  const receipt = decodeRustIntegratedEntityAuthorityImportReceiptV1(packet("entity-authority-import-receipt-v1"), imported);
  assert.equal(receipt.stateHash, fixture.nativeAuthorityHash); assert.equal(receipt.revision, snapshot.revision);
  assert.equal(receipt.entityCount, snapshot.hot.length + snapshot.cold.length);
  assert.equal(computeRustEntityAuthorityHashR6V2(snapshot), fixture.nativeAuthorityHash);
  assert.match(fixture.hashAssurance, /independently recomputed/u);
  const changed = packet("entity-authority-import-receipt-v1"); changed[48] ^= 1; reseal(changed);
  assert.notEqual(decodeRustIntegratedEntityAuthorityImportReceiptV1(changed).stateHash, fixture.nativeAuthorityHash,
    "unattested wire decoding alone is not state validation");
  assert.throws(() => decodeRustIntegratedEntityAuthorityImportReceiptV1(changed, imported), /semantic.*hash mismatch/u);
});

test("outer integrated payload hashes protect raw BWEA/BWEC receipts as well as wrapped families", () => {
  const zero = "0".repeat(32);
  const expected = { universeId: "1", locationId: "surface", tick: 0, stateHash: zero,
    revision: { epoch: 1, world: 0, entities: 0, gameplay: 0, persistence: 0, network: 0, simulation: 0 } };
  for (const entry of fixture.families) {
    const payload = bytes(entry.hex);
    const operation = createRustIntegratedRuntimeDomainOperationV1({ domain: "entities", typeId: entry.typeId, schema: entry.operationSchema, payload });
    assert.equal(operation.payloadHash, entry.payloadHash);
    operation.payload[operation.payload.length - 1] ^= 1;
    assert.throws(() => createRustIntegratedRuntimeCommandBatchV1({
      commandId: "r6-fixture", idempotencyKey: "r6-fixture", actorId: "fixture", expected, operations: [operation],
    }), /payload hash/u);
  }
});
