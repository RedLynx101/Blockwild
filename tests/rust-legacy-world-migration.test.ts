import assert from "node:assert/strict";
import test from "node:test";
import {
  RUST_LEGACY_STATE_ENTITIES_V1,
  RUST_LEGACY_STATE_GAMEPLAY_V1,
  RUST_LEGACY_STATE_MACHINES_V1,
  RUST_LEGACY_STATE_MAP_V1,
  RUST_LEGACY_STATE_NETWORK_V1,
  RUST_LEGACY_STATE_PLAYER_V1,
  RUST_LEGACY_STATE_RUNTIME_CLOCKS_V1,
  RUST_LEGACY_STATE_UNKNOWN_V1,
  RustLegacyWorldMigrationError,
  classifyRustLegacyWorldSaveV1,
  encodeRustLegacyWorldProjectionV1,
  planRustLegacyWorldMigrationV1,
  requireRustLegacyWorldOnlyMigrationV1,
} from "../app/game/rust-legacy-world-migration.ts";

class Reader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  take(length: number) { const value = this.bytes.slice(this.offset, this.offset + length); this.offset += length; return value; }
  u8() { const value = this.view.getUint8(this.offset); this.offset += 1; return value; }
  u16() { const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32() { const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  i32() { const value = this.view.getInt32(this.offset, true); this.offset += 4; return value; }
  u64() { const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value; }
  string() { return new TextDecoder().decode(this.take(this.u16())); }
  hash() { return new TextDecoder().decode(this.take(32)); }
  done() { assert.equal(this.offset, this.bytes.byteLength); }
}

function decodeBwas(bytes: Uint8Array) {
  const reader = new Reader(bytes);
  assert.equal(new TextDecoder().decode(reader.take(4)), "BWAS");
  const schemaVersion = reader.u16();
  const universeId = reader.string();
  const locationId = reader.string();
  const revision = { epoch: reader.u64(), mutation: reader.u64(), residency: reader.u64() };
  const chunks = Array.from({ length: reader.u32() }, () => ({
    chunkX: reader.i32(),
    chunkZ: reader.i32(),
    entries: Array.from({ length: reader.u32() }, () => [reader.u32(), reader.u16()] as const),
  }));
  const facings = Array.from({ length: reader.u32() }, () => ({
    x: reader.i32(), y: reader.i32(), z: reader.i32(), facing: reader.u8(),
  }));
  const liquids = Array.from({ length: reader.u32() }, () => ({
    x: reader.i32(), y: reader.i32(), z: reader.i32(), kind: reader.u8(), level: reader.u8(), flags: reader.u8(),
  }));
  const compatibilityChecksum = reader.hash();
  const extensionChecksum = reader.hash();
  reader.done();
  return { schemaVersion, universeId, locationId, revision, chunks, facings, liquids, compatibilityChecksum, extensionChecksum };
}

function projectionSource() {
  return {
    edits: {
      "0,0": [[257, 2], [0, 3], [0, 31]],
      "-1,-2": [[49_151, 31], [5, 30]],
      "2,3": [],
    },
    blockFacings: {
      "-1,127,-17": 3,
      "-11,-64,-32": 1,
      "0,-64,0": 2,
    },
  } as const;
}

test("BWAS projection is binary, canonical, negative-coordinate safe, and last-write exact", () => {
  const projection = encodeRustLegacyWorldProjectionV1({
    save: projectionSource(),
    address: { universeId: "world:legacy fixture", locationId: "over/world" },
  });
  const decoded = decodeBwas(projection.bytes);

  assert.deepEqual(decoded, {
    schemaVersion: 1,
    universeId: "world:legacy fixture",
    locationId: "over/world",
    revision: { epoch: BigInt(1), mutation: BigInt(0), residency: BigInt(0) },
    chunks: [
      { chunkX: -1, chunkZ: -2, entries: [[5, 30], [49_151, 31]] },
      { chunkX: 0, chunkZ: 0, entries: [[0, 31], [257, 2]] },
    ],
    facings: [
      { x: -11, y: -64, z: -32, facing: 1 },
      { x: 0, y: -64, z: 0, facing: 2 },
      { x: -1, y: 127, z: -17, facing: 3 },
    ],
    liquids: [],
    compatibilityChecksum: projection.compatibilityChecksum,
    extensionChecksum: projection.extensionChecksum,
  });
  assert.equal(projection.chunkCount, 2);
  assert.equal(projection.editCount, 4);
  assert.equal(projection.facingCount, 3);
  assert.equal(projection.collapsedDuplicateEdits, 1);
  assert.equal(projection.ignoredOrphanFacings, 0);
  assert.match(projection.projectionHash, /^[0-9a-f]{32}$/u);
  assert.notEqual(new TextDecoder().decode(projection.bytes.slice(0, 1)), "{");

  const same = encodeRustLegacyWorldProjectionV1({
    save: {
      edits: {
        "-1,-2": [[5, 30], [49_151, 31]],
        "0,0": [[0, 31], [257, 2]],
      },
      blockFacings: {
        "0,-64,0": 2,
        "-1,127,-17": 3,
        "-11,-64,-32": 1,
      },
    },
    address: { universeId: "world:legacy fixture", locationId: "over/world" },
  });
  assert.deepEqual(same.bytes, projection.bytes, "equivalent final cells and facings produce one canonical BWAS record");
  assert.equal(same.projectionHash, projection.projectionHash);
});

test("orphan block facings fail closed until generated-block equivalence is proven", () => {
  const save = {
    edits: { "0,0": [[0, 31]] },
    blockFacings: { "0,-64,0": 2, "99,0,99": 1 },
  } as const;
  const state = classifyRustLegacyWorldSaveV1(save);
  assert.equal(state.flags, RUST_LEGACY_STATE_UNKNOWN_V1);
  assert.deepEqual(state.domains, ["unknown"]);
  assert.deepEqual(state.properties.unknown, ["blockFacings"]);

  const plan = planRustLegacyWorldMigrationV1({
    save,
    address: { universeId: "world:legacy fixture", locationId: "over/world" },
  });
  assert.equal(plan.status, "blocked");
  assert.equal(plan.projection.ignoredOrphanFacings, 1);
  assert.deepEqual(decodeBwas(plan.projection.bytes).facings, [
    { x: 0, y: -64, z: 0, facing: 2 },
  ], "matched facings remain exact even while an orphan makes the plan ineligible");
  assert.throws(
    () => requireRustLegacyWorldOnlyMigrationV1(plan),
    (error: unknown) => error instanceof RustLegacyWorldMigrationError && error.code === "legacy-migration-orphan-facing",
  );
});

test("fixed BWAS vector matches the Rust authority codec", () => {
  const projection = encodeRustLegacyWorldProjectionV1({
    save: { edits: { "-1,0": [[1, 1], [4, 2]] }, blockFacings: { "-15,-64,0": 1 } },
    address: { universeId: "1", locationId: "codec" },
    revision: { epoch: 1, mutation: 9, residency: 3 },
  });
  // Generated from blockwild_authority::encode_compatibility_save_binary_v1 for this exact record.
  const rustHex = "4257415301000100310500636f64656301000000000000000900000000000000030000000000000001000000ffffffff000000000200000001000000010004000000020001000000f1ffffffc0ffffff00000000010000000038376664363935653332383834373130353033343138333635346635373332626236303230333533323765666337343632303735313764656138363038623562";
  assert.equal(Buffer.from(projection.bytes).toString("hex"), rustHex);
});

test("classification uses exact u16 flags and never treats empty rich fields as safe", () => {
  const rich = {
    version: 2,
    generatorVersion: 18,
    seed: "legacy",
    savedAt: 1,
    edits: {},
    blockFacings: {},
    creatures: [],
    player: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
    inventory: [],
    time: 0,
    mode: "survival",
    furnaces: {},
    mapKnowledge: {},
    multiplayerPlayers: {},
    liquidLevels: [],
  } as const;
  const state = classifyRustLegacyWorldSaveV1(rich);
  assert.equal(state.flags,
    RUST_LEGACY_STATE_ENTITIES_V1
      | RUST_LEGACY_STATE_PLAYER_V1
      | RUST_LEGACY_STATE_RUNTIME_CLOCKS_V1
      | RUST_LEGACY_STATE_GAMEPLAY_V1
      | RUST_LEGACY_STATE_MACHINES_V1
      | RUST_LEGACY_STATE_MAP_V1
      | RUST_LEGACY_STATE_NETWORK_V1
      | RUST_LEGACY_STATE_UNKNOWN_V1);
  assert.deepEqual(state.domains, ["entities", "player", "runtime-clocks", "gameplay", "machines", "map", "network", "unknown"]);
  assert.deepEqual(state.properties.entities, ["creatures"]);
  assert.deepEqual(state.properties.player, ["inventory", "player"]);
  assert.deepEqual(state.properties["runtime-clocks"], ["time"]);
  assert.deepEqual(state.properties.gameplay, ["mode"]);
  assert.deepEqual(state.properties.machines, ["furnaces"]);
  assert.deepEqual(state.properties.map, ["mapKnowledge"]);
  assert.deepEqual(state.properties.network, ["multiplayerPlayers"]);
  assert.deepEqual(state.properties.unknown, ["liquidLevels"]);

  const plan = planRustLegacyWorldMigrationV1({ save: rich, address: { universeId: "world:legacy", locationId: "overworld" } });
  assert.equal(plan.status, "blocked");
  assert.equal(decodeBwas(plan.projection.bytes).liquids.length, 0, "liquidLevels are blocked, never silently projected as empty native liquids");
  assert.throws(() => requireRustLegacyWorldOnlyMigrationV1(plan), (error: unknown) =>
    error instanceof RustLegacyWorldMigrationError && error.code === "legacy-migration-rich-save");
});

test("inventory, equipment, machines, map, network, and unknown future fields fail closed", () => {
  const state = classifyRustLegacyWorldSaveV1({
    edits: {},
    inventory: [{ item: 2, count: 1, durability: 4, metadata: { name: "kept" } }],
    equipment: { head: { item: 3, count: 1 } },
    chests: { "0,0,0": { slots: [{ item: 4, count: 2 }] } },
    activatedStructureMarkers: ["old-keep"],
    multiplayerProgressions: { guest: { revision: 7 } },
    futureWorldDomain: { opaque: true },
  });
  assert.equal(state.flags,
    RUST_LEGACY_STATE_PLAYER_V1
      | RUST_LEGACY_STATE_MACHINES_V1
      | RUST_LEGACY_STATE_MAP_V1
      | RUST_LEGACY_STATE_NETWORK_V1
      | RUST_LEGACY_STATE_UNKNOWN_V1);
  assert.deepEqual(state.properties.player, ["equipment", "inventory"]);
  assert.deepEqual(state.properties.machines, ["chests"]);
  assert.deepEqual(state.properties.map, ["activatedStructureMarkers"]);
  assert.deepEqual(state.properties.network, ["multiplayerProgressions"]);
  assert.deepEqual(state.properties.unknown, ["futureWorldDomain"]);
});

test("world-only projection plans are deterministic and provenance-bound", () => {
  const left = {
    version: 2,
    generatorVersion: 18,
    generatorProfile: "world-below-v15",
    seed: "legacy",
    savedAt: 9,
    edits: { "0,0": [[0, 31]] },
    blockFacings: { "0,-64,0": 1 },
  } as const;
  const right = {
    blockFacings: { "0,-64,0": 1 },
    edits: { "0,0": [[0, 31]] },
    savedAt: 9,
    seed: "legacy",
    generatorProfile: "world-below-v15",
    generatorVersion: 18,
    version: 2,
  } as const;
  const first = planRustLegacyWorldMigrationV1({ save: left, address: { universeId: "world:legacy", locationId: "overworld" } });
  const second = planRustLegacyWorldMigrationV1({ save: right, address: { universeId: "world:legacy", locationId: "overworld" } });
  assert.equal(first.status, "world-only");
  assert.equal(first.state.flags, 0);
  assert.equal(requireRustLegacyWorldOnlyMigrationV1(first), first);
  assert.equal(first.sourceSemanticHash, second.sourceSemanticHash);
  assert.equal(first.projection.projectionHash, second.projection.projectionHash);
  assert.deepEqual(first.projection.bytes, second.projection.bytes);

  const changed = planRustLegacyWorldMigrationV1({ save: { ...left, savedAt: 10 }, address: { universeId: "world:legacy", locationId: "overworld" } });
  assert.notEqual(changed.sourceSemanticHash, first.sourceSemanticHash, "source provenance changes even when the world projection does not");
  assert.equal(changed.projection.projectionHash, first.projection.projectionHash);

  const corruptedBytes = Uint8Array.from(first.projection.bytes);
  corruptedBytes[0] ^= 1;
  assert.throws(
    () => requireRustLegacyWorldOnlyMigrationV1({ ...first, projection: { ...first.projection, bytes: corruptedBytes } }),
    (error: unknown) => error instanceof RustLegacyWorldMigrationError && error.code === "projection-hash",
  );
});

test("malformed edit, facing, address, revision, and source values are rejected before transport", () => {
  const address = { universeId: "world:test", locationId: "overworld" };
  const badProjectionCases: ReadonlyArray<readonly [unknown, RegExp]> = [
    [{ edits: { "01,0": [[0, 1]] } }, /canonical decimal/u],
    [{ edits: { "134217728,0": [[0, 1]] } }, /cell-addressable/u],
    [{ edits: { "0,0": [[49_152, 1]] } }, /0\.\.49151/u],
    [{ edits: { "0,0": [[0, 65_535]] } }, /0\.\.65534/u],
    [{ edits: { "0,0": [[0, 1, 2]] } }, /exact \[index, blockId\]/u],
    [{ edits: { "0,0": [[0, 1]] }, blockFacings: { "0,128,0": 1 } }, /outside -64\.\.127/u],
    [{ edits: { "0,0": [[0, 1]] }, blockFacings: { "0,-64,0": 4 } }, /0\.\.3/u],
    [{ edits: { "0,0": [[0, 0]] }, blockFacings: { "0,-64,0": 1 } }, /final air edit/u],
  ];
  for (const [save, pattern] of badProjectionCases) {
    assert.throws(() => encodeRustLegacyWorldProjectionV1({ save: save as Readonly<Record<string, unknown>>, address }), pattern);
  }
  assert.throws(() => encodeRustLegacyWorldProjectionV1({ save: { edits: {} }, address: { universeId: "", locationId: "overworld" } }), /1\.\.64/u);
  assert.throws(() => encodeRustLegacyWorldProjectionV1({ save: { edits: {} }, address: { universeId: "bad\ud800", locationId: "overworld" } }), /unpaired surrogate/u);
  assert.throws(() => encodeRustLegacyWorldProjectionV1({ save: { edits: {} }, address, revision: { epoch: Number.MAX_SAFE_INTEGER + 1, mutation: 0, residency: 0 } }), /revision\.epoch/u);

  const cyclic: Record<string, unknown> = { edits: {} };
  cyclic.self = cyclic;
  assert.throws(() => planRustLegacyWorldMigrationV1({ save: cyclic, address }), /cycle/u);
  assert.throws(() => planRustLegacyWorldMigrationV1({ save: { edits: {}, time: Number.NaN }, address }), /non-finite/u);
});
