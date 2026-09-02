import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRustNativeDropPickupProjectionCursorV1 } from "../app/game/engine.ts";

test("native drop pickup projection cursor normalizes legacy absence and exact saved custody", () => {
  assert.equal(normalizeRustNativeDropPickupProjectionCursorV1(undefined), null);
  assert.equal(normalizeRustNativeDropPickupProjectionCursorV1(null), null);
  assert.deepEqual(normalizeRustNativeDropPickupProjectionCursorV1({
    schema: 1,
    cursor: 0,
    lastReceiptHash: null,
  }), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.deepEqual(normalizeRustNativeDropPickupProjectionCursorV1({
    schema: 1,
    cursor: Number.MAX_SAFE_INTEGER,
    lastReceiptHash: "a".repeat(32),
  }), { schema: 1, cursor: Number.MAX_SAFE_INTEGER, lastReceiptHash: "a".repeat(32) });
});

test("native drop pickup projection cursor rejects malformed or contradictory saves", () => {
  assert.throws(() => normalizeRustNativeDropPickupProjectionCursorV1({
    schema: 1,
    cursor: -1,
    lastReceiptHash: null,
  }), /malformed/u);
  assert.throws(() => normalizeRustNativeDropPickupProjectionCursorV1({
    schema: 1,
    cursor: Number.MAX_SAFE_INTEGER + 1,
    lastReceiptHash: null,
  }), /malformed/u);
  assert.throws(() => normalizeRustNativeDropPickupProjectionCursorV1({
    schema: 1,
    cursor: 1,
    lastReceiptHash: "not-a-hash",
  }), /malformed/u);
  assert.throws(() => normalizeRustNativeDropPickupProjectionCursorV1({
    schema: 1,
    cursor: 0,
    lastReceiptHash: "b".repeat(32),
  }), /contradicts/u);
});
