import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRustNativeBlockEditProjectionCursorV1 } from "../app/game/engine.ts";

test("native block-edit browser cursor distinguishes fresh, tracked, and legacy saves", () => {
  assert.equal(normalizeRustNativeBlockEditProjectionCursorV1(undefined), null);
  assert.equal(normalizeRustNativeBlockEditProjectionCursorV1(null), null);
  assert.deepEqual(normalizeRustNativeBlockEditProjectionCursorV1({
    schema: 1, cursor: 0, lastReceiptHash: null,
  }), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.deepEqual(normalizeRustNativeBlockEditProjectionCursorV1({
    schema: 1, cursor: 29, lastReceiptHash: "a".repeat(32),
  }), { schema: 1, cursor: 29, lastReceiptHash: "a".repeat(32) });
});

test("native block-edit browser cursor rejects malformed or contradictory records", () => {
  assert.throws(() => normalizeRustNativeBlockEditProjectionCursorV1({
    schema: 1, cursor: -1, lastReceiptHash: null,
  }), /malformed/u);
  assert.throws(() => normalizeRustNativeBlockEditProjectionCursorV1({
    schema: 1, cursor: 0.25, lastReceiptHash: null,
  }), /malformed/u);
  assert.throws(() => normalizeRustNativeBlockEditProjectionCursorV1({
    schema: 1, cursor: 1, lastReceiptHash: "A".repeat(32),
  }), /malformed/u);
  assert.throws(() => normalizeRustNativeBlockEditProjectionCursorV1({
    schema: 1, cursor: 0, lastReceiptHash: "b".repeat(32),
  }), /contradicts/u);
});
