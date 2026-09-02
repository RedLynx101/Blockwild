import assert from "node:assert/strict";
import test from "node:test";
import { BlockId } from "../app/game/data.ts";
import { BLOCK_FACING_EAST, BLOCK_FACING_NORTH } from "../app/game/block-facing.ts";
import { createWorldAuthorityIdentityV1, type WorldAuthorityIdentityV1 } from "../app/game/world-authority-contract.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2,
  rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2,
  type RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2,
} from "../app/game/rust-integrated-runtime-native-block-edit.ts";
import {
  MIN_Y,
  SECTION_HEIGHT,
  ChunkWorld,
  type RustWorldAwaitedProjectedChangeR4V1,
  type RustWorldValidatedMutationProjectionInputR4V2,
} from "../app/game/world.ts";

const FIRST = Object.freeze({ x: 3, y: 0, z: 4 });
const SECOND = Object.freeze({ x: 5, y: 0, z: 4 });
const BOUNDARY = Object.freeze({ x: 15, y: 1, z: 4 });

type MutableRuntime = {
  mode(): "off" | "shadow" | "canary" | "authority";
  isRustAuthoritative(): boolean;
  diagnostics(): Readonly<{ state: string; lastFallbackReason: string | null }>;
  identity(): WorldAuthorityIdentityV1 | null;
  mutate(batchId: string, authorityId: string, commands: readonly unknown[]): Promise<unknown>;
};

function createFixture(first = BlockId.Dirt, second = BlockId.Stone) {
  const world = new ChunkWorld({
    rustTerrainMode: "off",
    rustWorldAuthorityMode: "off",
    terrainGenerationAuthorityMode: "typescript",
  });
  world.reset("R4-AWAITED-WORLD", undefined, { structures: false });
  const chunk = world.generateChunk(0, 0);
  chunk.blocks.fill(BlockId.Air);
  chunk.sectionBlockCounts.fill(0);
  chunk.lightIndices.clear();
  chunk.leafIndices.clear();
  world.lightEngine.initializeChunk(chunk);
  const section = Math.floor((FIRST.y - MIN_Y) / SECTION_HEIGHT);
  world.rebuildSection(chunk, section);
  world.setBlock(FIRST.x, FIRST.y, FIRST.z, first, false, true);
  world.setBlock(SECOND.x, SECOND.y, SECOND.z, second, false, true);
  world.edits.clear();
  world.mutationRevision = 0;
  chunk.dirty.clear();
  world.meshQueue = [];
  world.meshQueued.clear();
  world.urgentMeshQueue = [];
  world.urgentMeshQueued.clear();
  return { world, chunk, section };
}

function identity(locationId = "R4-AWAITED-WORLD", epoch = 1, mutation = 0, residency = 0) {
  return createWorldAuthorityIdentityV1(
    { universeId: "1", locationId },
    { epoch, mutation, residency },
  );
}

function nativeDirtyEvidence(
  after: WorldAuthorityIdentityV1,
  changes: readonly RustWorldAwaitedProjectedChangeR4V1[],
  overrides: Partial<Omit<RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2, "evidenceHash">> = {},
): RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2 {
  const sections = changes.flatMap((change) => {
    const chunkX = Math.floor(change.x / 16);
    const chunkZ = Math.floor(change.z / 16);
    const sectionY = Math.floor((change.y - MIN_Y) / SECTION_HEIGHT);
    const localX = change.x - chunkX * 16;
    const localZ = change.z - chunkZ * 16;
    const localY = change.y - (MIN_Y + sectionY * SECTION_HEIGHT);
    const addresses = [
      { ...after.address, chunkX, chunkZ, sectionY },
      ...(localY === 0 ? [{ ...after.address, chunkX, chunkZ, sectionY: sectionY - 1 }] : []),
      ...(localY === SECTION_HEIGHT - 1 ? [{ ...after.address, chunkX, chunkZ, sectionY: sectionY + 1 }] : []),
      ...(localX === 0 ? [{ ...after.address, chunkX: chunkX - 1, chunkZ, sectionY }] : []),
      ...(localX === 15 ? [{ ...after.address, chunkX: chunkX + 1, chunkZ, sectionY }] : []),
      ...(localZ === 0 ? [{ ...after.address, chunkX, chunkZ: chunkZ - 1, sectionY }] : []),
      ...(localZ === 15 ? [{ ...after.address, chunkX, chunkZ: chunkZ + 1, sectionY }] : []),
    ];
    return addresses.filter((section) => section.sectionY >= 0 && section.sectionY < 12);
  });
  const sectionByKey = new Map(sections.map((section) => [
    `${encodeURIComponent(section.universeId)}@${encodeURIComponent(section.locationId)}:${section.chunkX},${section.chunkZ}:${section.sectionY}`,
    section,
  ]));
  const defaultSections = [...sectionByKey.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, section]) => Object.freeze(section));
  const columnByKey = new Map(changes.map((change) => [`${change.x},${change.z}`, { x: change.x, z: change.z }]));
  const defaultColumns = [...columnByKey.values()].sort((left, right) => left.x - right.x || left.z - right.z);
  const raw = Object.freeze({
    schema: 1 as const,
    sequence: 1,
    receiptHash: "a".repeat(32),
    sections: Object.freeze(defaultSections),
    columns: Object.freeze(defaultColumns),
    subsystemSeeds: Object.freeze(RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2.map((subsystem, index) => Object.freeze({
      subsystem,
      seed: (index + 1).toString(16).repeat(32),
    }))),
    ...overrides,
    evidenceHash: "0".repeat(32),
  }) as RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2;
  return Object.freeze({ ...raw, evidenceHash: rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2(raw) });
}

function nativeProjectionV2(
  before: WorldAuthorityIdentityV1,
  after: WorldAuthorityIdentityV1,
  changes: readonly RustWorldAwaitedProjectedChangeR4V1[],
  dirty = nativeDirtyEvidence(after, changes),
): RustWorldValidatedMutationProjectionInputR4V2 {
  return Object.freeze({
    batchId: "integrated-receipt-v2",
    authorityIdentityBefore: before,
    authorityIdentityAfter: after,
    changes: Object.freeze(changes),
    dirty,
    immediate: false,
    allowAlreadyApplied: true,
  });
}

function clearCompatibilityTopology(world: ChunkWorld, ...chunks: ReturnType<ChunkWorld["generateChunk"]>[]) {
  for (const chunk of chunks) chunk.dirty.clear();
  world.meshQueue = [];
  world.meshQueued.clear();
  world.urgentMeshQueue = [];
  world.urgentMeshQueued.clear();
}

function installRuntime(
  world: ChunkWorld,
  initial: WorldAuthorityIdentityV1,
  mutate: (batchId: string, authorityId: string, commands: readonly unknown[]) => Promise<unknown>,
) {
  let current: WorldAuthorityIdentityV1 | null = initial;
  let state = "ready";
  let fallback: string | null = null;
  const runtime = (world as unknown as { rustWorldAuthority: MutableRuntime }).rustWorldAuthority;
  runtime.mode = () => "authority";
  runtime.isRustAuthoritative = () => true;
  runtime.diagnostics = () => ({ state, lastFallbackReason: fallback });
  runtime.identity = () => current;
  runtime.mutate = async (...args) => {
    const response = await mutate(...args);
    if (response && typeof response === "object" && "identity" in response) {
      current = (response as { identity: WorldAuthorityIdentityV1 }).identity;
    }
    return response;
  };
  return {
    setIdentity(value: WorldAuthorityIdentityV1 | null) { current = value; },
    setState(value: string, reason: string | null = null) { state = value; fallback = reason; },
  };
}

function acceptedResponse(
  batchId: string,
  after: WorldAuthorityIdentityV1,
  changes: readonly RustWorldAwaitedProjectedChangeR4V1[],
) {
  return {
    type: "authority-mutation-result-r4-v1",
    identity: after,
    status: "accepted",
    mutated: changes.length > 0,
    ...(changes.length ? {
      immediateEvent: {
        sequence: 1,
        address: after.address,
        batchId,
        identity: after,
        changes: changes.map((change) => ({
          ...change,
          previousLiquid: { kind: 0, level: 0, flags: 0 },
          liquid: { kind: 0, level: 0, flags: 0 },
        })),
        dirtySectionKeys: [],
      },
    } : {}),
  };
}

function rejectedResponse(current: WorldAuthorityIdentityV1, code: string, message: string) {
  return {
    type: "authority-mutation-result-r4-v1",
    identity: current,
    status: "rejected",
    mutated: false,
    rejectionCode: code,
    message,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function compatibilitySnapshot(world: ChunkWorld, chunk: ReturnType<ChunkWorld["generateChunk"]>) {
  return {
    first: world.getBlock(FIRST.x, FIRST.y, FIRST.z),
    second: world.getBlock(SECOND.x, SECOND.y, SECOND.z),
    firstFacing: world.blockFacingAt(FIRST.x, FIRST.y, FIRST.z),
    secondFacing: world.blockFacingAt(SECOND.x, SECOND.y, SECOND.z),
    mutationRevision: world.mutationRevision,
    edits: world.serializeEdits(),
    facings: world.serializeBlockFacings(),
    dirty: [...chunk.dirty].sort((left, right) => left - right),
    meshQueue: world.meshQueue.map((entry) => ({ ...entry })),
    urgentMeshQueue: world.urgentMeshQueue.map((entry) => ({ ...entry })),
  };
}

test("awaited single set has no optimistic projection and resolves after the exact accepted receipt", async () => {
  const { world, chunk } = createFixture();
  try {
    const before = identity();
    const after = identity("R4-AWAITED-WORLD", 1, 1);
    const receipt = deferred<unknown>();
    const runtime = installRuntime(world, before, async () => receipt.promise);
    const snapshot = compatibilitySnapshot(world, chunk);
    const pending = world.setBlockAwaitedR4V1(FIRST.x, FIRST.y, FIRST.z, BlockId.Air, { immediate: true });
    await Promise.resolve();
    assert.deepEqual(compatibilitySnapshot(world, chunk), snapshot, "enqueuing Rust work must not dirty or project TypeScript state");

    runtime.setIdentity(after);
    receipt.resolve(acceptedResponse("browser-awaited-1", after, [{
      ...FIRST,
      previousBlockId: BlockId.Dirt,
      blockId: BlockId.Air,
      previousFacing: BLOCK_FACING_NORTH,
      facing: BLOCK_FACING_NORTH,
    }]));
    const result = await pending;
    assert.equal(result.status, "accepted");
    if (result.status !== "accepted") return;
    assert.equal(result.projectionStatus, "applied");
    assert.equal(result.mutated, true);
    assert.equal(result.authorityIdentityBefore?.stateHash, before.stateHash);
    assert.equal(result.authorityIdentityAfter?.stateHash, after.stateHash);
    assert.equal(world.getBlock(FIRST.x, FIRST.y, FIRST.z), BlockId.Air);
    assert.equal(world.mutationRevision, 1);
  } finally {
    world.dispose();
  }
});

test("awaited batch validates one exact receipt and projects all cells only after acceptance", async () => {
  const { world, chunk } = createFixture();
  try {
    const before = identity();
    const after = identity("R4-AWAITED-WORLD", 1, 1);
    installRuntime(world, before, async (batchId) => acceptedResponse(batchId, after, [
        { ...FIRST, previousBlockId: BlockId.Dirt, blockId: BlockId.Stone, previousFacing: 0, facing: 0 },
        { ...SECOND, previousBlockId: BlockId.Stone, blockId: BlockId.Dirt, previousFacing: 0, facing: 0 },
      ]));
    const result = await world.setBlocksBatchAwaitedR4V1([
      { ...FIRST, type: BlockId.Stone },
      { ...SECOND, type: BlockId.Dirt },
    ]);
    assert.equal(result.status, "accepted");
    assert.equal(world.getBlock(FIRST.x, FIRST.y, FIRST.z), BlockId.Stone);
    assert.equal(world.getBlock(SECOND.x, SECOND.y, SECOND.z), BlockId.Dirt);
    assert.equal(world.mutationRevision, 1, "one compatibility batch revision covers both block transitions");
    assert.ok(chunk.dirty.size > 0 || world.meshQueue.length > 0 || world.urgentMeshQueue.length > 0);
  } finally {
    world.dispose();
  }
});

test("awaited mixed block and facing receipt projects blocks before exact facing", async () => {
  const { world } = createFixture();
  try {
    const before = identity();
    const after = identity("R4-AWAITED-WORLD", 1, 1);
    const order: string[] = [];
    const originalBatch = world.setBlocksBatch.bind(world);
    const originalFacing = world.setBlockFacing.bind(world);
    world.setBlocksBatch = (...args) => { order.push("blocks"); return originalBatch(...args); };
    world.setBlockFacing = (...args) => { order.push("facing"); return originalFacing(...args); };
    installRuntime(world, before, async (batchId) => {
      order.push("receipt");
      return acceptedResponse(batchId, after, [{
        ...FIRST,
        previousBlockId: BlockId.Dirt,
        blockId: BlockId.Chest,
        previousFacing: BLOCK_FACING_NORTH,
        facing: BLOCK_FACING_EAST,
      }]);
    });
    const result = await world.mutateRustWorldAwaitedR4V1([
      { kind: "set-block", ...FIRST, blockId: BlockId.Chest },
      { kind: "set-facing", ...FIRST, facing: BLOCK_FACING_EAST },
    ], { immediate: true });
    assert.equal(result.status, "accepted");
    assert.deepEqual(order.slice(0, 3), ["receipt", "blocks", "facing"]);
    assert.equal(world.getBlock(FIRST.x, FIRST.y, FIRST.z), BlockId.Chest);
    assert.equal(world.blockFacingAt(FIRST.x, FIRST.y, FIRST.z), BLOCK_FACING_EAST);
  } finally {
    world.dispose();
  }
});

test("stale revision and explicit rejection leave compatibility and dirty state unchanged", async () => {
  for (const rejection of [
    { code: "stale-revision", expectedStatus: "stale" },
    { code: "invalid-command", expectedStatus: "rejected" },
  ] as const) {
    const { world, chunk } = createFixture();
    try {
      const before = identity();
      installRuntime(world, before, async () => rejectedResponse(before, rejection.code, rejection.code));
      const snapshot = compatibilitySnapshot(world, chunk);
      const result = await world.setBlockAwaitedR4V1(FIRST.x, FIRST.y, FIRST.z, BlockId.Air, { immediate: true });
      assert.equal(result.status, rejection.expectedStatus);
      assert.deepEqual(compatibilitySnapshot(world, chunk), snapshot);
    } finally {
      world.dispose();
    }
  }
});

test("missing timeout receipt rejects without optimistic compatibility or dirty propagation", async () => {
  const { world, chunk } = createFixture();
  try {
    const before = identity();
    const receipt = deferred<unknown>();
    const runtime = installRuntime(world, before, async () => receipt.promise);
    const snapshot = compatibilitySnapshot(world, chunk);
    const pending = world.setBlockAwaitedR4V1(FIRST.x, FIRST.y, FIRST.z, BlockId.Air, { immediate: true });
    await Promise.resolve();
    runtime.setState("fallback", "mutation: Rust world authority request timed out");
    receipt.resolve(null);
    const result = await pending;
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "authority-no-receipt");
    assert.match(result.detail, /timed out/u);
    assert.deepEqual(compatibilitySnapshot(world, chunk), snapshot);
  } finally {
    world.dispose();
  }
});

test("receipt mismatch leaves compatibility and mesh propagation unchanged", async () => {
  const { world, chunk } = createFixture();
  try {
    const before = identity();
    const after = identity("R4-AWAITED-WORLD", 1, 1);
    const snapshot = compatibilitySnapshot(world, chunk);
    installRuntime(world, before, async (batchId) => acceptedResponse(batchId, after, [{
        ...FIRST,
        previousBlockId: BlockId.Dirt,
        blockId: BlockId.Air,
        previousFacing: BLOCK_FACING_NORTH,
        facing: BLOCK_FACING_EAST,
      }]));
    const result = await world.setBlockAwaitedR4V1(FIRST.x, FIRST.y, FIRST.z, BlockId.Air, { immediate: true });
    assert.equal(result.status, "stale");
    assert.equal(result.reason, "receipt-mismatch");
    assert.deepEqual(compatibilitySnapshot(world, chunk), snapshot);
  } finally {
    world.dispose();
  }
});

test("worker replacement and world-generation replacement stale pending mutations without projection", async () => {
  {
    const { world, chunk } = createFixture();
    try {
      const before = identity();
      const replacement = identity("R4-AWAITED-WORLD", 2, 0);
      const receipt = deferred<unknown>();
      const runtime = installRuntime(world, before, async () => receipt.promise);
      const snapshot = compatibilitySnapshot(world, chunk);
      const pending = world.setBlockAwaitedR4V1(FIRST.x, FIRST.y, FIRST.z, BlockId.Air);
      await Promise.resolve();
      runtime.setIdentity(replacement);
      receipt.resolve(null);
      const result = await pending;
      assert.equal(result.status, "stale");
      assert.equal(result.reason, "authority-replaced");
      assert.deepEqual(compatibilitySnapshot(world, chunk), snapshot);
    } finally {
      world.dispose();
    }
  }

  {
    const { world } = createFixture();
    try {
      const before = identity();
      const after = identity("R4-AWAITED-WORLD", 1, 1);
      const receipt = deferred<unknown>();
      const runtime = installRuntime(world, before, async () => receipt.promise);
      const pending = world.setBlockAwaitedR4V1(FIRST.x, FIRST.y, FIRST.z, BlockId.Air);
      await Promise.resolve();
      world.reset("R4-REPLACEMENT-WORLD", undefined, { structures: false });
      const replacementChunk = world.generateChunk(0, 0);
      replacementChunk.dirty.clear();
      world.meshQueue = [];
      world.urgentMeshQueue = [];
      const replacementSnapshot = compatibilitySnapshot(world, replacementChunk);
      runtime.setIdentity(after);
      receipt.resolve(acceptedResponse("browser-awaited-1", after, [{
        ...FIRST,
        previousBlockId: BlockId.Dirt,
        blockId: BlockId.Air,
        previousFacing: 0,
        facing: 0,
      }]));
      const result = await pending;
      assert.equal(result.status, "stale");
      assert.equal(result.reason, "world-generation-replaced");
      assert.deepEqual(compatibilitySnapshot(world, replacementChunk), replacementSnapshot);
    } finally {
      world.dispose();
    }
  }
});

test("already-accepted native receipt projects exact facing without resubmission and recovers idempotently", async () => {
  const { world } = createFixture();
  try {
    // Integrated-runtime identities intentionally differ from ChunkWorld's
    // standalone R4 address; this seam validates the source transition without
    // pretending the two authority instances share one identity.
    const before = Object.freeze({
      ...identity("overworld", 7, 20, 3),
      address: Object.freeze({ universeId: "world:browser-id", locationId: "overworld" }),
    });
    const after = Object.freeze({
      ...identity("overworld", 7, 21, 3),
      address: Object.freeze({ universeId: "world:browser-id", locationId: "overworld" }),
    });
    const change = Object.freeze({
      ...FIRST,
      previousBlockId: BlockId.Dirt,
      blockId: BlockId.Chest,
      previousFacing: BLOCK_FACING_NORTH,
      facing: BLOCK_FACING_EAST,
    });
    const input = {
      batchId: "integrated-receipt-1",
      authorityIdentityBefore: before,
      authorityIdentityAfter: after,
      changes: [change],
      immediate: true,
      allowAlreadyApplied: true,
    } as const;
    const first = await world.applyValidatedRustWorldMutationProjectionR4V1(input);
    assert.equal(first.status, "accepted");
    if (first.status !== "accepted") return;
    assert.equal(first.projectionStatus, "applied");
    assert.equal(world.getBlock(FIRST.x, FIRST.y, FIRST.z), BlockId.Chest);
    assert.equal(world.blockFacingAt(FIRST.x, FIRST.y, FIRST.z), BLOCK_FACING_EAST);
    const revisionAfterApply = world.mutationRevision;

    const recovered = await world.applyValidatedRustWorldMutationProjectionR4V1(input);
    assert.equal(recovered.status, "accepted");
    if (recovered.status !== "accepted") return;
    assert.equal(recovered.projectionStatus, "already-applied");
    assert.equal(world.mutationRevision, revisionAfterApply);
    assert.equal(world.serializeBlockFacings()[`${FIRST.x},${FIRST.y},${FIRST.z}`], BLOCK_FACING_EAST);

    const mismatchedAddress = await world.applyValidatedRustWorldMutationProjectionR4V1({
      ...input,
      authorityIdentityAfter: Object.freeze({
        ...after,
        address: Object.freeze({ universeId: "world:other", locationId: "overworld" }),
      }),
    });
    assert.equal(mismatchedAddress.status, "stale");
    assert.equal(mismatchedAddress.reason, "receipt-mismatch");
    assert.equal(world.mutationRevision, revisionAfterApply);
  } finally {
    world.dispose();
  }
});

test("native receipt recovery rejects an unrecorded replacement or mismatched facing without mutation", async () => {
  const { world, chunk } = createFixture(BlockId.Chest);
  try {
    world.setBlockFacing(FIRST.x, FIRST.y, FIRST.z, BLOCK_FACING_EAST, true);
    world.edits.clear();
    world.mutationRevision = 0;
    chunk.dirty.clear();
    world.meshQueue = [];
    world.urgentMeshQueue = [];
    const before = identity("R4-AWAITED-WORLD", 8, 4, 1);
    const after = identity("R4-AWAITED-WORLD", 8, 5, 1);
    const snapshot = compatibilitySnapshot(world, chunk);
    const result = await world.applyValidatedRustWorldMutationProjectionR4V1({
      batchId: "integrated-receipt-unrecorded",
      authorityIdentityBefore: before,
      authorityIdentityAfter: after,
      changes: [{
        ...FIRST,
        previousBlockId: BlockId.Dirt,
        blockId: BlockId.Chest,
        previousFacing: BLOCK_FACING_NORTH,
        facing: BLOCK_FACING_EAST,
      }],
      immediate: true,
      allowAlreadyApplied: true,
    });
    assert.equal(result.status, "stale");
    assert.equal(result.reason, "compatibility-state-changed");
    assert.deepEqual(compatibilitySnapshot(world, chunk), snapshot);
  } finally {
    world.dispose();
  }
});

test("V2 consumes only the bounded Rust dirty sections for a chunk-boundary mutation", async () => {
  const { world, chunk, section } = createFixture();
  const neighbor = world.generateChunk(1, 0);
  try {
    world.setBlock(BOUNDARY.x, BOUNDARY.y, BOUNDARY.z, BlockId.Dirt, false, true);
    world.setBlock(16, BOUNDARY.y, BOUNDARY.z, BlockId.Stone, false, true);
    world.edits.clear();
    world.mutationRevision = 0;
    clearCompatibilityTopology(world, chunk, neighbor);

    const before = identity("R4-AWAITED-WORLD", 9, 30, 2);
    const after = identity("R4-AWAITED-WORLD", 9, 31, 2);
    const change = Object.freeze({
      ...BOUNDARY,
      previousBlockId: BlockId.Dirt,
      blockId: BlockId.Stone,
      previousFacing: BLOCK_FACING_NORTH,
      facing: BLOCK_FACING_NORTH,
    });
    const input = nativeProjectionV2(before, after, [change]);
    assert.deepEqual(input.dirty.sections.map((entry) => [entry.chunkX, entry.chunkZ, entry.sectionY]), [
      [0, 0, section],
      [1, 0, section],
    ], "the valid native boundary evidence is exactly bounded to the direct and east-neighbor sections");

    const result = await world.applyValidatedRustWorldMutationProjectionR4V2(input);
    assert.equal(result.status, "accepted");
    assert.equal(world.getBlock(BOUNDARY.x, BOUNDARY.y, BOUNDARY.z), BlockId.Stone);
    assert.deepEqual(world.urgentMeshQueue, [
      { key: "0,0", section },
      { key: "1,0", section },
    ], "compatibility projection consumes the supplied Rust sections without adding a TypeScript halo");
    assert.deepEqual([...chunk.dirty], [section]);
    assert.deepEqual([...neighbor.dirty], [section]);
    assert.deepEqual(world.meshQueue, []);
  } finally {
    world.dispose();
  }
});

test("V2 applies directional facing before one per-chunk immediate invalidation", async () => {
  const { world, chunk } = createFixture();
  try {
    const before = identity("R4-AWAITED-WORLD", 10, 40, 3);
    const after = identity("R4-AWAITED-WORLD", 10, 41, 3);
    const change = Object.freeze({
      ...FIRST,
      previousBlockId: BlockId.Dirt,
      blockId: BlockId.Chest,
      previousFacing: BLOCK_FACING_NORTH,
      facing: BLOCK_FACING_EAST,
    });
    const observations: Array<Readonly<{ kind: "invalidate" | "rebuild"; facing: number; section?: number }>> = [];
    const internals = world as unknown as {
      invalidateCombinedMeshesForImmediateEdit(target: typeof chunk, layers: Iterable<unknown>): void;
    };
    internals.invalidateCombinedMeshesForImmediateEdit = () => {
      observations.push({ kind: "invalidate", facing: world.blockFacingAt(FIRST.x, FIRST.y, FIRST.z) });
    };
    world.rebuildSection = ((_target: typeof chunk, rebuiltSection: number) => {
      observations.push({ kind: "rebuild", section: rebuiltSection, facing: world.blockFacingAt(FIRST.x, FIRST.y, FIRST.z) });
    }) as typeof world.rebuildSection;
    world.setBlockFacing = (() => {
      throw new Error("V2 must not invoke the topology-recomputing setBlockFacing compatibility route");
    }) as typeof world.setBlockFacing;

    const result = await world.applyValidatedRustWorldMutationProjectionR4V2({
      ...nativeProjectionV2(before, after, [change]),
      immediate: true,
    });
    assert.equal(result.status, "accepted");
    assert.equal(world.getBlock(FIRST.x, FIRST.y, FIRST.z), BlockId.Chest);
    assert.equal(world.blockFacingAt(FIRST.x, FIRST.y, FIRST.z), BLOCK_FACING_EAST);
    assert.equal(observations.filter((entry) => entry.kind === "invalidate").length, 1);
    assert.ok(observations.length >= 2, "the direct and vertical-boundary Rust sections are rebuilt after invalidation");
    assert.ok(observations.every((entry) => entry.facing === BLOCK_FACING_EAST), "facing is installed before every invalidation and rebuild");
  } finally {
    world.dispose();
  }
});

test("V2 malformed, duplicate, wrong-world, and missing-direct dirty evidence is mutation-free", async () => {
  const rehash = (value: RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2) => {
    const raw = { ...value, evidenceHash: "0".repeat(32) } as RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2;
    return Object.freeze({ ...raw, evidenceHash: rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2(raw) });
  };
  for (const variant of ["malformed", "duplicate", "wrong-world", "missing-direct"] as const) {
    const { world, chunk } = createFixture();
    try {
      const before = identity("R4-AWAITED-WORLD", 11, 50, 4);
      const after = identity("R4-AWAITED-WORLD", 11, 51, 4);
      const change = Object.freeze({
        ...FIRST,
        previousBlockId: BlockId.Dirt,
        blockId: BlockId.Stone,
        previousFacing: BLOCK_FACING_NORTH,
        facing: BLOCK_FACING_NORTH,
      });
      const valid = nativeDirtyEvidence(after, [change]);
      const dirty = variant === "malformed"
        ? rehash({ ...valid, schema: 2 } as unknown as RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2)
        : variant === "duplicate"
          ? rehash({ ...valid, sections: Object.freeze([valid.sections[0]!, valid.sections[0]!]) })
          : variant === "wrong-world"
            ? rehash({
              ...valid,
              sections: Object.freeze(valid.sections.map((entry) => Object.freeze({ ...entry, universeId: "wrong-world" }))),
            })
            : rehash({
              ...valid,
              sections: Object.freeze(valid.sections.filter((entry) => entry.sectionY !== Math.floor((FIRST.y - MIN_Y) / SECTION_HEIGHT))),
            });
      const snapshot = compatibilitySnapshot(world, chunk);
      const result = await world.applyValidatedRustWorldMutationProjectionR4V2(nativeProjectionV2(before, after, [change], dirty));
      assert.notEqual(result.status, "accepted", `${variant} evidence must fail closed`);
      assert.deepEqual(compatibilitySnapshot(world, chunk), snapshot, `${variant} evidence must not mutate or queue compatibility state`);
    } finally {
      world.dispose();
    }
  }
});

test("V2 already-applied recovery adds no revision, dirt, or topology work", async () => {
  const { world, chunk } = createFixture();
  try {
    const before = identity("R4-AWAITED-WORLD", 12, 60, 5);
    const after = identity("R4-AWAITED-WORLD", 12, 61, 5);
    const change = Object.freeze({
      ...FIRST,
      previousBlockId: BlockId.Dirt,
      blockId: BlockId.Chest,
      previousFacing: BLOCK_FACING_NORTH,
      facing: BLOCK_FACING_EAST,
    });
    const input = nativeProjectionV2(before, after, [change]);
    const applied = await world.applyValidatedRustWorldMutationProjectionR4V2(input);
    assert.equal(applied.status, "accepted");
    clearCompatibilityTopology(world, chunk);
    const snapshot = compatibilitySnapshot(world, chunk);

    const recovered = await world.applyValidatedRustWorldMutationProjectionR4V2(input);
    assert.equal(recovered.status, "accepted");
    if (recovered.status !== "accepted") return;
    assert.equal(recovered.projectionStatus, "already-applied");
    assert.deepEqual(compatibilitySnapshot(world, chunk), snapshot);
  } finally {
    world.dispose();
  }
});

test("V2 facing-only receipt advances once and recovers from its exact facing record", async () => {
  const { world, chunk } = createFixture(BlockId.Chest);
  try {
    const before = identity("R4-AWAITED-WORLD", 13, 70, 6);
    const after = identity("R4-AWAITED-WORLD", 13, 71, 6);
    const change = Object.freeze({
      ...FIRST,
      previousBlockId: BlockId.Chest,
      blockId: BlockId.Chest,
      previousFacing: BLOCK_FACING_NORTH,
      facing: BLOCK_FACING_EAST,
    });
    const input = nativeProjectionV2(before, after, [change]);
    const applied = await world.applyValidatedRustWorldMutationProjectionR4V2(input);
    assert.equal(applied.status, "accepted");
    assert.equal(world.mutationRevision, 1, "one facing-only native mutation advances the compatibility revision exactly once");
    assert.equal(world.blockFacingAt(FIRST.x, FIRST.y, FIRST.z), BLOCK_FACING_EAST);
    clearCompatibilityTopology(world, chunk);
    const snapshot = compatibilitySnapshot(world, chunk);

    const recovered = await world.applyValidatedRustWorldMutationProjectionR4V2(input);
    assert.equal(recovered.status, "accepted");
    if (recovered.status !== "accepted") return;
    assert.equal(recovered.projectionStatus, "already-applied");
    assert.deepEqual(compatibilitySnapshot(world, chunk), snapshot);
  } finally {
    world.dispose();
  }
});
