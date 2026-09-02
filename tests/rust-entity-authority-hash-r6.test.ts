import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { RustEntityAuthoritySnapshotR6V2 } from "../app/game/rust-entity-authority-contract-r6.ts";
import {
  decodeRustEntityAuthoritySnapshotR6V2, encodeRustEntityAuthoritySnapshotR6V2,
} from "../app/game/rust-entity-authority-codec-r6.ts";
import {
  assertRustEntityAuthorityHashR6V2, computeRustEntityAuthorityHashR6V2,
  decodeAndVerifyRustEntityAuthoritySnapshotR6V2,
} from "../app/game/rust-entity-authority-hash-r6.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1, rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import { rustIntegratedRuntimeDomainWireFamilyV1 } from "../app/game/rust-integrated-runtime-domain-schema.generated.ts";
import {
  decodeRustIntegratedEntityAuthorityImportV2, decodeRustIntegratedEntityAuthorityImportReceiptV1,
  encodeRustIntegratedEntityAuthorityImportV2, validateRustIntegratedEntityAuthorityImportReceiptV1,
} from "../app/game/rust-integrated-runtime-entities.ts";

type Vector = { name: string; hash: string; snapshotHex: string; requestHex: string; receiptHex: string };
type Mutable<T> = T extends Uint8Array ? Uint8Array : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const fixture = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/r6/entity-authority-hashes-v2.json", import.meta.url), "utf8")) as {
  schema: number; producer: string; domain: string; vectors: Vector[];
};
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const vector = (name: string) => fixture.vectors.find((entry) => entry.name === name)!;
const decoded = (name = "rich-mixed-residency") => decodeRustEntityAuthoritySnapshotR6V2(bytes(vector(name).snapshotHex));
const mutable = (name = "rich-mixed-residency") => structuredClone(decoded(name)) as Mutable<RustEntityAuthoritySnapshotR6V2>;
const u64Max = (BigInt(1) << BigInt(64)) - BigInt(1);

function reseal(packet: Uint8Array) {
  packet.set(bytes(rustIntegratedRuntimeWireChecksumV1(packet.subarray(28))), 12);
  return packet;
}

test("R6 independently recomputes every native semantic hash from complete decoded state", async (t) => {
  assert.equal(fixture.schema, 2);
  assert.equal(fixture.producer, "blockwild-engine/r6_entity_authority_hash_fixture");
  assert.equal(fixture.domain, "blockwild.entity.authority.v2");
  assert.equal(fixture.vectors.length, 6);
  for (const entry of fixture.vectors) await t.test(entry.name, () => {
    const snapshot = decodeAndVerifyRustEntityAuthoritySnapshotR6V2(bytes(entry.snapshotHex), entry.hash);
    assert.equal(computeRustEntityAuthorityHashR6V2(snapshot), entry.hash);
    assert.equal(hex(encodeRustEntityAuthoritySnapshotR6V2(snapshot)), entry.snapshotHex);
    assert.equal(assertRustEntityAuthorityHashR6V2(snapshot, entry.hash), entry.hash);
    const request = decodeRustIntegratedEntityAuthorityImportV2(bytes(entry.requestHex));
    const receipt = decodeRustIntegratedEntityAuthorityImportReceiptV1(bytes(entry.receiptHex), request);
    assert.equal(hex(request.snapshot), entry.snapshotHex);
    assert.equal(receipt.stateHash, entry.hash);
    assert.equal(receipt.revision, snapshot.revision);
    assert.equal(receipt.entityCount, snapshot.hot.length + snapshot.cold.length);
  });
});

test("rich native state covers all typed optionals, blackboard tags, residency and allocator generations", () => {
  const value = decoded();
  assert.equal(value.hot.length, 1); assert.equal(value.cold.length, 1);
  assert.equal(value.slots.length, 7); assert.deepEqual(value.free, [1, 3, 4, 5]);
  assert.equal(value.slots[4].generation, 3, "despawned slot retains bumped generation");
  assert.equal(value.slots[6].generation, 0xffff_ffff);
  const { record, components } = value.hot[0];
  assert.equal(decoded("plain-optionals-absent").hot[0].record.bondTier, "", "native bounded text may be empty");
  for (const key of ["care", "husbandry", "work", "dragon", "legendary", "summon", "sentient"] as const) {
    assert.notEqual(components[key], null, key);
    assert.equal(decoded("plain-optionals-absent").hot[0].components[key], null, `${key} absent vector`);
  }
  assert.deepEqual(components.ai.blackboard.map(([, item]) => item.type).sort(),
    ["bool", "bytes", "entity", "fixed-milli", "signed", "text", "unsigned"]);
  assert.equal(record.legacyNumericId, u64Max); assert.equal(record.locationId, u64Max);
  assert.equal(components.protection.flags, u64Max); assert.equal(components.protection.firstOwnedTick, BigInt(0));
  assert.equal(components.ai.blackboard.find(([, item]) => item.type === "signed")![1].value, -(BigInt(1) << BigInt(63)));
  assert.equal(components.ai.blackboard.find(([, item]) => item.type === "fixed-milli")![1].value, (BigInt(1) << BigInt(63)) - BigInt(1));
  assert.equal(decoded("rich-max-cursors").revision, u64Max);
  assert.equal(decoded("rich-max-cursors").lastSequence, u64Max);
  assert.notEqual(vector("empty-none").hash, vector("empty-some-zero").hash);
  assert.notEqual(vector("rich-mixed-residency").hash, vector("rich-no-sequence").hash);
});

test("native UTF8 map order, BOM characters, signed zero and subnormals survive decoding and hashing", () => {
  const value = mutable(); const { record, components } = value.hot[0];
  assert.equal(record.name, "\ufeff"); assert.equal(record.variantKey, "\ufeffvariant:🌿");
  assert.equal(record.custom.find(([key]) => key === "\ufeff")![1], "\ufeffsnow:雪");
  assert.deepEqual(record.research.map(([key]) => key), ["\ue000", "\u{10000}"]);
  assert.notDeepEqual(record.research.map(([key]) => key), record.research.map(([key]) => key).sort());
  assert.equal(Object.is(record.position.x, -0), true);
  assert.equal(Object.is(record.velocity.x, -0), true);
  assert.equal(Object.is(components.locomotion.velocity.x, 0), true);
  assert.equal(Object.is(components.locomotion.velocity.y, -0), true);
  assert.equal(record.position.y, 2 ** -149);
  assert.equal(components.locomotion.desiredVelocity.y, -(2 ** -149));
  record.research.reverse(); record.custom.reverse(); components.ai.blackboard.reverse();
  components.locomotion.cooldowns.reverse(); components.equipment[0][1].custom.reverse();
  components.legendary!.worldFlags.reverse(); components.sentient!.dialogueState.reverse();
  components.unknownExtensions.reverse();
  assert.equal(computeRustEntityAuthorityHashR6V2(value), vector("rich-mixed-residency").hash,
    "map insertion order does not change native BTreeMap semantics");
  record.position.x = 0;
  assert.notEqual(computeRustEntityAuthorityHashR6V2(value), vector("rich-mixed-residency").hash,
    "the canonical state still distinguishes signed-zero bits");
});

test("semantic verification canonicalizes accepted noncanonical free-set bytes instead of hashing input bytes", () => {
  const entry = vector("rich-mixed-residency"); const packet = bytes(entry.snapshotHex);
  const view = new DataView(packet.buffer);
  const slotsOffset = packet[14] === 1 ? 23 : 15;
  const freeOffset = slotsOffset + 4 + view.getUint32(slotsOffset, true) * 5;
  const count = view.getUint32(freeOffset, true);
  assert.ok(count > 1);
  const first = view.getUint32(freeOffset + 4, true);
  view.setUint32(freeOffset + 4, view.getUint32(freeOffset + count * 4, true), true);
  view.setUint32(freeOffset + count * 4, first, true);
  assert.notEqual(hex(packet), entry.snapshotHex);
  const state = decodeAndVerifyRustEntityAuthoritySnapshotR6V2(packet, entry.hash);
  assert.equal(hex(encodeRustEntityAuthoritySnapshotR6V2(state)), entry.snapshotHex);
  const request = { expectedRevision: BigInt(0), snapshot: packet };
  assert.equal(decodeRustIntegratedEntityAuthorityImportReceiptV1(bytes(entry.receiptHex), request).stateHash, entry.hash);
});

test("R6 receipt attestation rejects resealed state changes, forged hashes, cursors and outer operation metadata", () => {
  const entry = vector("rich-mixed-residency");
  const request = decodeRustIntegratedEntityAuthorityImportV2(bytes(entry.requestHex));
  const descriptor = rustIntegratedRuntimeDomainWireFamilyV1("entity-authority-import-receipt-v1");
  const operation = createRustIntegratedRuntimeDomainOperationV1({
    domain: "entities", typeId: descriptor.typeId, schema: descriptor.operationSchema, payload: bytes(entry.receiptHex),
  });
  assert.equal(validateRustIntegratedEntityAuthorityImportReceiptV1(operation, request).stateHash, entry.hash);
  const state = mutable(); state.hot[0].components.unknownExtensions[0][1][0] ^= 1;
  const forgedRequest = decodeRustIntegratedEntityAuthorityImportV2(encodeRustIntegratedEntityAuthorityImportV2({
    ...request, snapshot: encodeRustEntityAuthoritySnapshotR6V2(state),
  }));
  assert.throws(() => validateRustIntegratedEntityAuthorityImportReceiptV1(operation, forgedRequest), /semantic.*hash mismatch/u);
  for (const offset of [28, 36, 44, 48]) {
    const changed = bytes(entry.receiptHex); changed[offset] ^= 1; reseal(changed);
    assert.doesNotThrow(() => decodeRustIntegratedEntityAuthorityImportReceiptV1(changed), "wire-only decoding is not attestation");
    assert.throws(() => decodeRustIntegratedEntityAuthorityImportReceiptV1(changed, request), /attest|semantic.*hash mismatch/u);
    const forgedOperation = createRustIntegratedRuntimeDomainOperationV1({ ...operation, payload: changed });
    assert.throws(() => validateRustIntegratedEntityAuthorityImportReceiptV1(forgedOperation, request), /attest|semantic.*hash mismatch/u);
  }
  for (const changes of [{ domain: "world" as const }, { typeId: "wrong" }, { schema: 99 }, { payloadHash: "0".repeat(32) }]) {
    assert.throws(() => validateRustIntegratedEntityAuthorityImportReceiptV1({ ...operation, ...changes }, request), /wrong receipt/u);
  }
  operation.payload[48] ^= 1;
  assert.throws(() => validateRustIntegratedEntityAuthorityImportReceiptV1(operation, request), /payload hash/u);
});

test("every rich decoded semantic leaf is hash-sensitive or rejected by native-compatible state validation", (t) => {
  type Leaf = { path: string[]; value: unknown };
  const leaves: Leaf[] = [];
  const walk = (value: unknown, path: string[]) => {
    if (value instanceof Uint8Array || value === null || typeof value !== "object") { leaves.push({ path, value }); return; }
    for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
  };
  walk(decoded(), []);
  let changed = 0; let rejected = 0;
  for (const { path, value } of leaves) {
    const state = mutable(); let parent = state as unknown as Record<string, unknown>;
    for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
    const replacement = value instanceof Uint8Array ? (value.length ? Uint8Array.from(value, (byte, index) => index === 0 ? byte ^ 1 : byte) : Uint8Array.of(1))
      : typeof value === "bigint" ? (value === BigInt(0) ? BigInt(1) : BigInt(0))
        : typeof value === "number" ? (value === 0 ? 1 : 0)
          : typeof value === "boolean" ? !value : typeof value === "string" ? `${value}:changed` : undefined;
    parent[path.at(-1)!] = replacement;
    let hash: string;
    try { hash = computeRustEntityAuthorityHashR6V2(state); } catch { rejected += 1; continue; }
    assert.notEqual(hash, vector("rich-mixed-residency").hash, `uncovered semantic leaf ${path.join(".")}`);
    changed += 1;
  }
  assert.ok(leaves.length >= 400); assert.ok(changed >= 300); assert.ok(rejected > 0);
  t.diagnostic(`${leaves.length} decoded leaves checked: ${changed} change the hash, ${rejected} violate state invariants`);
});

test("optional presence, allocator history, dormant state and sequence are all semantically significant", () => {
  const cases: ((value: Mutable<RustEntityAuthoritySnapshotR6V2>) => void)[] = [
    (value) => { value.revision += BigInt(1); }, (value) => { value.lastSequence = null; },
    (value) => { value.slots[1].generation += 1; },
    (value) => { value.slots.push({ generation: 1, residency: null }); value.free.push(7); },
    (value) => { value.cold[0].summary.lastAdvancedTick -= BigInt(1); },
    (value) => { value.hot[0].components.protection.firstOwnedTick = null; },
    (value) => { value.hot[0].components.care = null; }, (value) => { value.hot[0].components.husbandry = null; },
    (value) => { value.hot[0].components.work = null; }, (value) => { value.hot[0].components.dragon = null; },
    (value) => { value.hot[0].components.legendary = null; }, (value) => { value.hot[0].components.summon = null; },
    (value) => { value.hot[0].components.sentient = null; },
    (value) => { value.hot[0].components.unknownExtensions.pop(); },
    (value) => { value.hot[0].components.mount.seats[0].occupant = BigInt("4294967297"); },
  ];
  for (const mutate of cases) {
    const state = mutable(); mutate(state);
    assert.notEqual(computeRustEntityAuthorityHashR6V2(state), vector("rich-mixed-residency").hash);
  }
});

test("invalid UTF8, unpaired UTF16, f32 overflow/underflow, slot drift and malformed expected hashes fail closed", () => {
  const entry = vector("rich-mixed-residency");
  for (const hash of ["", "0".repeat(32), entry.hash.toUpperCase(), "g".repeat(32), `${entry.hash}00`]) {
    assert.throws(() => assertRustEntityAuthorityHashR6V2(decoded(), hash), /hash/u);
  }
  const invalidUtf8 = bytes(entry.snapshotHex);
  const nameOffset = Buffer.from(invalidUtf8).indexOf(Buffer.from("\ufeffvariant:🌿"));
  assert.ok(nameOffset > 0); invalidUtf8[nameOffset] = 0xff;
  assert.throws(() => decodeAndVerifyRustEntityAuthoritySnapshotR6V2(invalidUtf8, entry.hash), /UTF-8/u);
  for (const invalid of [Number.MAX_VALUE, Infinity, NaN]) {
    const value = mutable(); value.hot[0].record.yaw = invalid;
    assert.throws(() => computeRustEntityAuthorityHashR6V2(value), /finite f32/u);
  }
  const underflow = mutable(); underflow.hot[0].components.locomotion.radius = 1e-300;
  assert.throws(() => computeRustEntityAuthorityHashR6V2(underflow), /radius|dimensions/u);
  const surrogate = mutable(); surrogate.hot[0].record.name = "\ud800";
  assert.throws(() => computeRustEntityAuthorityHashR6V2(surrogate), /surrogate/u);
  const slot = mutable(); slot.slots[6].generation -= 1;
  assert.throws(() => computeRustEntityAuthorityHashR6V2(slot), /slot/u);
  const duplicate = mutable(); duplicate.hot[0].record.custom.push(duplicate.hot[0].record.custom[0]);
  assert.throws(() => computeRustEntityAuthorityHashR6V2(duplicate), /duplicate/u);
  const wrongMirror = mutable(); wrongMirror.hot[0].components.vitals.health = 0;
  assert.throws(() => computeRustEntityAuthorityHashR6V2(wrongMirror), /diverged/u);
});
