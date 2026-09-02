import assert from "node:assert/strict";
import test from "node:test";
import { BlockId } from "../app/game/data.ts";
import {
  CHUNK_SIZE,
  MIN_Y,
  SECTION_HEIGHT,
  ChunkWorld,
  blockIndex,
  chunkKey,
} from "../app/game/world.ts";

const CELL = Object.freeze({ x: 3, y: 0, z: 4 });

function createProjectionWorld(initialBlockId = BlockId.Dirt) {
  const world = new ChunkWorld({
    rustTerrainMode: "off",
    rustWorldAuthorityMode: "off",
    terrainGenerationAuthorityMode: "typescript",
  });
  world.reset("RUST-CELL-PROJECTION", undefined, { structures: false });
  const chunk = world.generateChunk(0, 0);
  chunk.blocks.fill(BlockId.Air);
  chunk.sectionBlockCounts.fill(0);
  chunk.lightIndices.clear();
  chunk.leafIndices.clear();
  world.lightEngine.initializeChunk(chunk);
  const section = Math.floor((CELL.y - MIN_Y) / SECTION_HEIGHT);
  world.rebuildSection(chunk, section);
  world.setBlock(CELL.x, CELL.y, CELL.z, initialBlockId, false, true);
  world.edits.clear();
  return { world, chunk, section };
}

function installR4MutationSpy(world: ChunkWorld) {
  let mutateCalls = 0;
  const internal = world as unknown as {
    applyingRustWorldAuthorityEvent: boolean;
    rustWorldAuthority: {
      mode(): "off" | "shadow" | "authoritative";
      mutate(...args: unknown[]): Promise<null>;
    };
  };
  internal.rustWorldAuthority.mode = () => "authoritative";
  internal.rustWorldAuthority.mutate = async () => {
    mutateCalls += 1;
    return null;
  };
  return {
    calls: () => mutateCalls,
    guard: () => internal.applyingRustWorldAuthorityEvent,
  };
}

test("validated Rust cell projection records one exact edit without resubmitting to R4", () => {
  const { world, chunk, section } = createProjectionWorld();
  try {
    const r4 = installR4MutationSpy(world);
    const mutationRevisionBefore = world.mutationRevision;
    const result = world.applyValidatedRustCellProjectionV1({
      ...CELL,
      expectedBlockId: BlockId.Dirt,
      replacementBlockId: BlockId.Air,
      immediate: true,
    });

    assert.deepEqual(result, {
      schemaVersion: 1,
      status: "applied",
      ...CELL,
      expectedBlockId: BlockId.Dirt,
      replacementBlockId: BlockId.Air,
      immediate: true,
      mutationRevisionBefore,
      mutationRevisionAfter: mutationRevisionBefore + 1,
      recordedEdit: true,
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(world.getBlock(CELL.x, CELL.y, CELL.z), BlockId.Air);
    assert.equal(world.mutationRevision, mutationRevisionBefore + 1);
    assert.deepEqual(world.serializeEdits()[chunkKey(0, 0)], [
      [blockIndex(CELL.x, CELL.y, CELL.z), BlockId.Air],
    ]);
    assert.equal(r4.calls(), 0, "projection must not submit a second world-authority mutation");
    assert.equal(r4.guard(), false, "projection restores the authority-event recursion guard");
    assert.equal(chunk.sections.get(section)?.opaque, undefined, "the immediate mesh removes the projected Dirt cell synchronously");
  } finally {
    world.dispose();
  }
});

test("malformed, unloaded, and stale Rust cell projections reject without mutation", () => {
  const { world, chunk, section } = createProjectionWorld();
  try {
    const r4 = installR4MutationSpy(world);
    const mutationRevisionBefore = world.mutationRevision;
    const assertUnchanged = () => {
      assert.equal(world.mutationRevision, mutationRevisionBefore);
      assert.equal(world.getBlock(CELL.x, CELL.y, CELL.z), BlockId.Dirt);
      assert.deepEqual(world.serializeEdits(), {});
      assert.equal(r4.calls(), 0);
      assert.equal(chunk.sections.get(section)?.opaque?.geometry.getAttribute("position").count, 24);
    };
    const base = {
      ...CELL,
      expectedBlockId: BlockId.Dirt,
      replacementBlockId: BlockId.Air,
      immediate: true,
    } as const;

    assert.throws(() => world.applyValidatedRustCellProjectionV1({ ...base, x: 3.5 }), /coordinates/u);
    assertUnchanged();
    assert.throws(() => world.applyValidatedRustCellProjectionV1({ ...base, y: MIN_Y - 1 }), /coordinates/u);
    assertUnchanged();
    assert.throws(() => world.applyValidatedRustCellProjectionV1({ ...base, x: CHUNK_SIZE }), /unloaded/u);
    assertUnchanged();
    assert.throws(() => world.applyValidatedRustCellProjectionV1({ ...base, expectedBlockId: BlockId.Stone }), /expected block/u);
    assertUnchanged();
    assert.throws(() => world.applyValidatedRustCellProjectionV1({ ...base, replacementBlockId: 0xffff as BlockId }), /unknown block/u);
    assertUnchanged();
  } finally {
    world.dispose();
  }
});

test("replayed Rust cell receipts cannot duplicate a recorded edit", () => {
  const { world } = createProjectionWorld();
  try {
    const input = {
      ...CELL,
      expectedBlockId: BlockId.Dirt,
      replacementBlockId: BlockId.Air,
      immediate: false,
    } as const;
    const applied = world.applyValidatedRustCellProjectionV1(input);
    const revisionAfterApply = world.mutationRevision;
    const editsAfterApply = world.serializeEdits();

    assert.equal(applied.status, "applied");
    assert.throws(() => world.applyValidatedRustCellProjectionV1(input), /expected block/u);
    assert.equal(world.mutationRevision, revisionAfterApply);
    assert.deepEqual(world.serializeEdits(), editsAfterApply);

    const recovered = world.applyValidatedRustCellProjectionV1({ ...input, allowAlreadyApplied: true });
    assert.deepEqual(recovered, {
      schemaVersion: 1,
      status: "already-applied",
      ...CELL,
      expectedBlockId: BlockId.Dirt,
      replacementBlockId: BlockId.Air,
      immediate: false,
      mutationRevisionBefore: revisionAfterApply,
      mutationRevisionAfter: revisionAfterApply,
      recordedEdit: false,
    });
    assert.equal(Object.isFrozen(recovered), true);
    assert.equal(world.mutationRevision, revisionAfterApply);
    assert.deepEqual(world.serializeEdits(), editsAfterApply);
  } finally {
    world.dispose();
  }
});

test("explicit recovery rejects no-op receipts and conflicting local state", () => {
  const { world } = createProjectionWorld();
  try {
    const mutationRevisionBefore = world.mutationRevision;
    assert.throws(() => world.applyValidatedRustCellProjectionV1({
      ...CELL,
      expectedBlockId: BlockId.Dirt,
      replacementBlockId: BlockId.Dirt,
      immediate: false,
      allowAlreadyApplied: true,
    }), /non-noop/u);
    assert.throws(() => world.applyValidatedRustCellProjectionV1({
      ...CELL,
      expectedBlockId: BlockId.Stone,
      replacementBlockId: BlockId.Air,
      immediate: false,
      allowAlreadyApplied: true,
    }), /expected block/u);
    assert.equal(world.mutationRevision, mutationRevisionBefore);
    assert.deepEqual(world.serializeEdits(), {});
    assert.equal(world.getBlock(CELL.x, CELL.y, CELL.z), BlockId.Dirt);
  } finally {
    world.dispose();
  }
});

test("explicit recovery requires a matching recorded projection, not merely matching generated state", () => {
  const { world } = createProjectionWorld(BlockId.Air);
  try {
    const mutationRevisionBefore = world.mutationRevision;
    assert.throws(() => world.applyValidatedRustCellProjectionV1({
      ...CELL,
      expectedBlockId: BlockId.Dirt,
      replacementBlockId: BlockId.Air,
      immediate: false,
      allowAlreadyApplied: true,
    }), /expected block/u);
    assert.equal(world.mutationRevision, mutationRevisionBefore);
    assert.deepEqual(world.serializeEdits(), {});
  } finally {
    world.dispose();
  }
});
