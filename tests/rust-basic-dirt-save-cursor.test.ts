import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRustBasicDirtActionProjectionCursorV1 } from "../app/game/engine.ts";

test("native Dirt browser cursor distinguishes new, tracked, and legacy-seeded saves", () => {
  assert.equal(normalizeRustBasicDirtActionProjectionCursorV1(undefined), null);
  assert.equal(normalizeRustBasicDirtActionProjectionCursorV1(null), null);
  assert.deepEqual(normalizeRustBasicDirtActionProjectionCursorV1({
    schema: 1, cursor: 0, lastReceiptHash: null,
  }), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.deepEqual(normalizeRustBasicDirtActionProjectionCursorV1({
    schema: 1, cursor: 12, lastReceiptHash: null,
  }), { schema: 1, cursor: 12, lastReceiptHash: null });
  assert.deepEqual(normalizeRustBasicDirtActionProjectionCursorV1({
    schema: 1, cursor: 13, lastReceiptHash: "a".repeat(32),
  }), { schema: 1, cursor: 13, lastReceiptHash: "a".repeat(32) });
});

test("native Dirt browser cursor rejects malformed, inexact, or contradictory records", () => {
  assert.throws(() => normalizeRustBasicDirtActionProjectionCursorV1({
    schema: 1, cursor: -1, lastReceiptHash: null,
  }), /malformed/u);
  assert.throws(() => normalizeRustBasicDirtActionProjectionCursorV1({
    schema: 1, cursor: 0.5, lastReceiptHash: null,
  }), /malformed/u);
  assert.throws(() => normalizeRustBasicDirtActionProjectionCursorV1({
    schema: 1, cursor: 1, lastReceiptHash: "A".repeat(32),
  }), /malformed/u);
  assert.throws(() => normalizeRustBasicDirtActionProjectionCursorV1({
    schema: 1, cursor: 0, lastReceiptHash: "b".repeat(32),
  }), /contradicts/u);
});
