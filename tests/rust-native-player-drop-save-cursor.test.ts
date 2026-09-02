import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRustNativePlayerDropProjectionCursorV1 } from "../app/game/engine.ts";

test("native player-drop projection cursor normalizes legacy absence and exact saved custody", () => {
  assert.equal(normalizeRustNativePlayerDropProjectionCursorV1(undefined), null);
  assert.equal(normalizeRustNativePlayerDropProjectionCursorV1(null), null);
  assert.deepEqual(normalizeRustNativePlayerDropProjectionCursorV1({
    schema: 1,
    cursor: 0,
    lastReceiptHash: null,
  }), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.deepEqual(normalizeRustNativePlayerDropProjectionCursorV1({
    schema: 1,
    cursor: Number.MAX_SAFE_INTEGER,
    lastReceiptHash: "a".repeat(32),
  }), { schema: 1, cursor: Number.MAX_SAFE_INTEGER, lastReceiptHash: "a".repeat(32) });
});

test("native player-drop projection cursor rejects malformed or contradictory saves", () => {
  assert.throws(() => normalizeRustNativePlayerDropProjectionCursorV1({
    schema: 1,
    cursor: -1,
    lastReceiptHash: null,
  }), /malformed/u);
  assert.throws(() => normalizeRustNativePlayerDropProjectionCursorV1({
    schema: 1,
    cursor: Number.MAX_SAFE_INTEGER + 1,
    lastReceiptHash: null,
  }), /malformed/u);
  assert.throws(() => normalizeRustNativePlayerDropProjectionCursorV1({
    schema: 1,
    cursor: 1,
    lastReceiptHash: "not-a-hash",
  }), /malformed/u);
  assert.throws(() => normalizeRustNativePlayerDropProjectionCursorV1({
    schema: 1,
    cursor: 0,
    lastReceiptHash: "b".repeat(32),
  }), /contradicts/u);
});
