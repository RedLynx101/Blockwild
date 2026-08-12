import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeRustIntegratedPlayerCombatBootstrapStatusQueryV1,
  decodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1,
  encodeRustIntegratedPlayerCombatBootstrapStatusQueryV1,
  encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1,
} from "../app/game/rust-integrated-runtime-player-combat-status.ts";

const BWS7_HEX =
  "425753370100010023000000561cf3bf7e4449d32832401580cdddef0a000000706c617965723ae6b0b4090000006163746f723ae6b0b4efcdab8998badcfe";
const BWO7_HEX =
  "42574f370100010072000000490f1e0fa01d246758cc66aa3975fa289090909090909090909090909090909007000000000000000800000000000000090000000000000091919191919191919191919191919191020001090000006163746f723ae6b0b401090000006163746f723ae6b0b40400000000000000010500000002000000011c250000102700000101";

function hex(value: Uint8Array) {
  return Buffer.from(value).toString("hex");
}

test("BWS7 query matches the native high-byte fixture and fails closed", () => {
  const query = Object.freeze({
    externalEntityId: "player:水",
    actorId: "actor:水",
    playerId: (BigInt(0xfedc_ba98) << BigInt(32)) | BigInt(0x89ab_cdef),
  });
  const encoded = encodeRustIntegratedPlayerCombatBootstrapStatusQueryV1(query);
  assert.equal(hex(encoded), BWS7_HEX);
  assert.deepEqual(decodeRustIntegratedPlayerCombatBootstrapStatusQueryV1(encoded), query);
  const corrupt = encoded.slice();
  corrupt[corrupt.length - 1] ^= 0x80;
  assert.throws(
    () => decodeRustIntegratedPlayerCombatBootstrapStatusQueryV1(corrupt),
    /checksum/u,
  );
});

test("BWO7 exact-linked receipt matches native bytes and attests all parity fields", () => {
  const receipt = Object.freeze({
    requestPayloadHash: "90".repeat(16),
    entityAuthorityRevision: BigInt(7),
    gameplaySequence: BigInt(8),
    gameplayCombatRevision: BigInt(9),
    gameplayStateHash: "91".repeat(16),
    status: "exact-linked" as const,
    blocker: null,
    combatant: Object.freeze({
      recordId: "actor:水",
      ownerId: "actor:水",
      revision: BigInt(4),
      entityId: (BigInt(2) << BigInt(32)) | BigInt(5),
      vitalUnits: "millihearts-v1" as const,
      health: 9_500,
      maxHealth: 10_000,
      alive: true,
      crossDomainParity: true,
    }),
  });
  const encoded = encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(receipt);
  assert.equal(hex(encoded), BWO7_HEX);
  assert.deepEqual(
    decodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(encoded, receipt.requestPayloadHash),
    receipt,
  );
  assert.throws(
    () => decodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(encoded, "92".repeat(16)),
    /exact BWS7 request/u,
  );
});

test("BWO7 explicitly separates absent, legacy-unlinked, and deterministic blockers", () => {
  const base = Object.freeze({
    requestPayloadHash: "11".repeat(16),
    entityAuthorityRevision: BigInt(2),
    gameplaySequence: BigInt(3),
    gameplayCombatRevision: BigInt(4),
    gameplayStateHash: "12".repeat(16),
  });
  const absent = Object.freeze({ ...base, status: "absent" as const, blocker: null, combatant: null });
  assert.deepEqual(
    decodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(
      encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(absent),
    ),
    absent,
  );
  const legacy = Object.freeze({
    ...base,
    status: "legacy-unlinked" as const,
    blocker: "legacy-unlinked-requires-explicit-migration" as const,
    combatant: Object.freeze({
      recordId: "actor:legacy",
      ownerId: null,
      revision: BigInt(0),
      entityId: null,
      vitalUnits: "legacy-whole-hearts-v1" as const,
      health: 10,
      maxHealth: 10,
      alive: true,
      crossDomainParity: false,
    }),
  });
  assert.deepEqual(
    decodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(
      encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1(legacy),
    ),
    legacy,
  );
  assert.throws(
    () => encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1({
      ...legacy,
      status: "exact-linked",
      blocker: "vital-parity-conflict",
    }),
    /exact-linked status is inconsistent/u,
  );
});
