import assert from "node:assert/strict";
import test from "node:test";
import type {
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeCommandReceiptV1,
  RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import {
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1,
  decodeRustIntegratedRuntimeDropPickupQueryV1,
  encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1,
  encodeRustIntegratedRuntimeDropPickupQueryV1,
  queryRustIntegratedRuntimeDropPickupReceiptV1,
  rustIntegratedRuntimeDropPickupReceiptHashV1,
  type RustIntegratedRuntimeDropPickupProjectionV1,
} from "../app/game/rust-integrated-runtime-drop-pickup.ts";
import { decodeRustIntegratedPlayerRespawnReceiptV1 } from "../app/game/rust-integrated-runtime-player-respawn.ts";
import {
  nativeDeathDropWireVector,
  resealNativeWirePacket,
} from "./helpers/rust-death-drop-wire-fixtures.ts";

function hash(value: number) { return value.toString(16).padStart(32, "0").slice(-32); }

function identity(tick = 20, state = 1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe-drop-pickup",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1, world: 3, entities: 4, gameplay: 5, persistence: 6, network: 7, simulation: tick,
    }),
    tick,
    stateHash: hash(state),
  });
}

const HIGH_U64 = (BigInt(1) << BigInt(63)) + BigInt(40);

function projection(sequence = 1): RustIntegratedRuntimeDropPickupProjectionV1 {
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: hash(11),
    installedRegistryHash: hash(12),
    catalogBlobHash: hash(13),
    actionReportHash: hash(14),
    rngSemanticsHash: hash(15),
    blockActionSequence: HIGH_U64,
    originInputSequence: 7,
    blockId: 2,
    position: Object.freeze({ x: 4, y: 43, z: -3 }),
    lootPlanHash: hash(16),
    groupOrdinal: 0,
  });
  const beforeGameplay = Object.freeze({
    epoch: 2,
    sequence: HIGH_U64,
    inventory: HIGH_U64 + BigInt(1),
    machines: HIGH_U64 + BigInt(2),
    combat: HIGH_U64 + BigInt(3),
    progression: HIGH_U64 + BigInt(4),
    cardforge: HIGH_U64 + BigInt(5),
  });
  const beforeWorldView = Object.freeze({
    epoch: 2,
    sequence: HIGH_U64 + BigInt(6),
    clock: HIGH_U64 + BigInt(7),
    machineAnchors: HIGH_U64 + BigInt(8),
    droppedItems: HIGH_U64 + BigInt(9),
    playerBindings: HIGH_U64 + BigInt(10),
    environment: HIGH_U64 + BigInt(11),
    atmosphereGravity: HIGH_U64 + BigInt(12),
    celestial: HIGH_U64 + BigInt(13),
  });
  const stack = Object.freeze({ itemCode: 2, count: 6, durabilityMillionths: null, metadataHash: hash(0) });
  const base = Object.freeze({
    schema: 1 as const,
    sequence,
    completionTick: 20,
    world: Object.freeze({
      universeId: "universe-drop-pickup",
      locationId: "surface",
      revision: Object.freeze({ epoch: 1, mutation: 9, residency: 3 }),
      canonicalStateHash: hash(17),
    }),
    player: Object.freeze({
      playerId: BigInt("4294967297"),
      entityId: BigInt("4294967298"),
      inventoryContainer: Object.freeze({ kind: "player" as const, id: "actor:test", ownerId: "actor:test" }),
      beforeRevision: HIGH_U64 + BigInt(20),
      afterRevision: HIGH_U64 + BigInt(22),
      affectedSlots: Object.freeze([
        Object.freeze({
          slot: 0,
          beforeStack: Object.freeze({ ...stack, count: 60 }),
          afterStack: Object.freeze({ ...stack, count: 64 }),
        }),
        Object.freeze({ slot: 1, beforeStack: null, afterStack: Object.freeze({ ...stack, count: 2 }) }),
      ]),
    }),
    generatedDrop: Object.freeze({
      dropId: `block-loot-v1:${HIGH_U64}:0`,
      entityId: BigInt("4294967299"),
      origin: Object.freeze({ kind: "generated-block-action" as const, provenance }),
      stack,
      custodyContainer: Object.freeze({
        kind: "container" as const,
        id: `block-loot-custody-v1:${HIGH_U64}:0`,
        ownerId: null,
      }),
      custodySlot: 0,
      custodyBeforeRevision: HIGH_U64 + BigInt(30),
      custodyEmptiedRevision: HIGH_U64 + BigInt(32),
      spatialRevision: HIGH_U64 + BigInt(33),
      position: Object.freeze({ xMilli: BigInt(4_100), yMilli: BigInt(43_350), zMilli: BigInt(-2_900) }),
      velocityMilliPerSecond: Object.freeze({ xMilli: BigInt(-40), yMilli: BigInt(1_250), zMilli: BigInt(80) }),
      rotation: Object.freeze({ yaw: 999_999, pitch: 0, roll: 0 }),
    }),
    removal: Object.freeze({
      gameplay: Object.freeze({
        before: Object.freeze({ revision: beforeGameplay, canonicalStateHash: hash(18) }),
        after: Object.freeze({
          revision: Object.freeze({
            ...beforeGameplay,
            sequence: beforeGameplay.sequence + BigInt(1),
            inventory: beforeGameplay.inventory + BigInt(1),
          }),
          canonicalStateHash: hash(19),
        }),
      }),
      entity: Object.freeze({
        before: Object.freeze({ revision: HIGH_U64 + BigInt(34), canonicalStateHash: hash(20) }),
        after: Object.freeze({ revision: HIGH_U64 + BigInt(35), canonicalStateHash: hash(21) }),
      }),
      worldView: Object.freeze({
        before: Object.freeze({ revision: beforeWorldView, canonicalStateHash: hash(22) }),
        after: Object.freeze({
          revision: Object.freeze({
            ...beforeWorldView,
            sequence: beforeWorldView.sequence + BigInt(1),
            droppedItems: beforeWorldView.droppedItems + BigInt(1),
          }),
          canonicalStateHash: hash(23),
        }),
      }),
    }),
    receiptHash: hash(24),
  });
  return Object.freeze({ ...base, receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(base) });
}

function outerReceiptHash(receipt: Omit<Extract<RustIntegratedRuntimeCommandReceiptV1, { status: "accepted" }>, "receiptHash">) {
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
    ...Buffer.from(receipt.commandHash, "hex"),
    ...Buffer.from(receipt.before.stateHash, "hex"),
    ...Buffer.from(receipt.after.stateHash, "hex"),
    ...receipt.domainReceipts.flatMap((operation) => [...Buffer.from(operation.payloadHash, "hex")]),
  ]));
}

function repeatedHash(byte: number) { return byte.toString(16).padStart(2, "0").repeat(16); }

function fixturePatternedHash(seed: number) {
  return Array.from(
    { length: 16 },
    (_, index) => ((seed + index * 17) & 0xff).toString(16).padStart(2, "0"),
  ).join("");
}

const NATIVE_CROSS_LANGUAGE_PICKUP_IDENTITY = Object.freeze({
  universeId: "universe:pickup:死亡🌠",
  locationId: "surface:神殿",
  revision: Object.freeze({
    epoch: 41,
    world: 801,
    entities: 802,
    gameplay: 803,
    persistence: 804,
    network: 805,
    simulation: 806,
  }),
  tick: 4_294_967_555,
  stateHash: fixturePatternedHash(0x91),
});

/** Exact mirror of runtime_domain_wire.rs::native_drop_pickup_projection_fixture_v1. */
function rustCrossLanguageProjectionFixture() {
  const sourceStack = Object.freeze({
    itemCode: 2, count: 5, durabilityMillionths: null, metadataHash: repeatedHash(0x33),
  });
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: repeatedHash(0x11),
    installedRegistryHash: repeatedHash(0x12),
    catalogBlobHash: repeatedHash(0x13),
    actionReportHash: repeatedHash(0x14),
    rngSemanticsHash: repeatedHash(0x15),
    blockActionSequence: BigInt(9),
    originInputSequence: 44,
    blockId: 2,
    position: Object.freeze({ x: -7, y: 64, z: 12 }),
    lootPlanHash: repeatedHash(0x16),
    groupOrdinal: 1,
  });
  const receiptBase = Object.freeze({
    schema: 1 as const,
    sequence: 17,
    completionTick: 99,
    world: Object.freeze({
      universeId: "universe:native-pickup",
      locationId: "surface",
      revision: Object.freeze({ epoch: 2, mutation: 19, residency: 5 }),
      canonicalStateHash: repeatedHash(0x21),
    }),
    player: Object.freeze({
      playerId: (BigInt(1) << BigInt(32)) | BigInt(3),
      entityId: (BigInt(4) << BigInt(32)) | BigInt(11),
      inventoryContainer: Object.freeze({
        kind: "player" as const, id: "player:fixture", ownerId: "player:fixture",
      }),
      beforeRevision: BigInt(50),
      afterRevision: BigInt(52),
      affectedSlots: Object.freeze([
        Object.freeze({
          slot: 0,
          beforeStack: Object.freeze({ ...sourceStack, count: 60 }),
          afterStack: Object.freeze({ ...sourceStack, count: 64 }),
        }),
        Object.freeze({
          slot: 4,
          beforeStack: null,
          afterStack: Object.freeze({ ...sourceStack, count: 1 }),
        }),
      ]),
    }),
    generatedDrop: Object.freeze({
      dropId: "block-loot-v1:9:1",
      entityId: (BigInt(5) << BigInt(32)) | BigInt(13),
      origin: Object.freeze({ kind: "generated-block-action" as const, provenance }),
      stack: sourceStack,
      custodyContainer: Object.freeze({
        kind: "container" as const, id: "block-loot-custody-v1:9:1", ownerId: null,
      }),
      custodySlot: 0,
      custodyBeforeRevision: BigInt(8),
      custodyEmptiedRevision: BigInt(10),
      spatialRevision: BigInt(15),
      position: Object.freeze({ xMilli: BigInt(-6_750), yMilli: BigInt(64_500), zMilli: BigInt(12_125) }),
      velocityMilliPerSecond: Object.freeze({
        xMilli: BigInt(-125), yMilli: BigInt(375), zMilli: BigInt(50),
      }),
      rotation: Object.freeze({ yaw: 750_000, pitch: 125_000, roll: 0 }),
    }),
    removal: Object.freeze({
      gameplay: Object.freeze({
        before: Object.freeze({
          revision: Object.freeze({
            epoch: 2, sequence: BigInt(70), inventory: BigInt(50), machines: BigInt(8),
            combat: BigInt(9), progression: BigInt(10), cardforge: BigInt(11),
          }),
          canonicalStateHash: repeatedHash(0x41),
        }),
        after: Object.freeze({
          revision: Object.freeze({
            epoch: 2, sequence: BigInt(71), inventory: BigInt(51), machines: BigInt(8),
            combat: BigInt(9), progression: BigInt(10), cardforge: BigInt(11),
          }),
          canonicalStateHash: repeatedHash(0x42),
        }),
      }),
      entity: Object.freeze({
        before: Object.freeze({ revision: BigInt(20), canonicalStateHash: repeatedHash(0x43) }),
        after: Object.freeze({ revision: BigInt(21), canonicalStateHash: repeatedHash(0x44) }),
      }),
      worldView: Object.freeze({
        before: Object.freeze({
          revision: Object.freeze({
            epoch: 3, sequence: BigInt(80), clock: BigInt(81), machineAnchors: BigInt(82),
            droppedItems: BigInt(83), playerBindings: BigInt(84), environment: BigInt(85),
            atmosphereGravity: BigInt(86), celestial: BigInt(87),
          }),
          canonicalStateHash: repeatedHash(0x45),
        }),
        after: Object.freeze({
          revision: Object.freeze({
            epoch: 3, sequence: BigInt(81), clock: BigInt(81), machineAnchors: BigInt(82),
            droppedItems: BigInt(84), playerBindings: BigInt(84), environment: BigInt(85),
            atmosphereGravity: BigInt(86), celestial: BigInt(87),
          }),
          canonicalStateHash: repeatedHash(0x46),
        }),
      }),
    }),
    receiptHash: "f0452e869a4a2ca36025b497d0aad864",
  });
  const receipt: RustIntegratedRuntimeDropPickupProjectionV1 = Object.freeze(receiptBase);
  return Object.freeze({
    requestPayloadHash: repeatedHash(0x51),
    identity: Object.freeze({
      universeId: "universe:native-pickup",
      locationId: "surface",
      revision: Object.freeze({
        epoch: 4, world: 19, entities: 21, gameplay: 71, persistence: 6, network: 7, simulation: 8,
      }),
      tick: 99,
      stateHash: repeatedHash(0xa1),
    }),
    cursorAfter: 17,
    receipt,
  });
}

test("Rust native-drop pickup vector matches the canonical TS hash and BWR8 round-trip", () => {
  const projection = rustCrossLanguageProjectionFixture();
  assert.equal(
    rustIntegratedRuntimeDropPickupReceiptHashV1(projection.receipt),
    "f0452e869a4a2ca36025b497d0aad864",
  );
  const query = encodeRustIntegratedRuntimeDropPickupQueryV1({
    expected: projection.identity,
    afterSequence: 16,
  });
  assert.equal(Buffer.from(query.subarray(0, 8)).toString("hex"), "4257513801000100");
  assert.deepEqual(decodeRustIntegratedRuntimeDropPickupQueryV1(query), {
    expected: projection.identity,
    afterSequence: 16,
  });
  const bytes = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(projection, 16);
  assert.equal(Buffer.from(bytes.subarray(0, 8)).toString("hex"), "4257523801000100");
  assert.deepEqual(
    decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(bytes, repeatedHash(0x51), 16),
    projection,
  );
});

test("checked Rust BWQ8/BWR8 fixtures preserve death-drop lineage, Unicode, opaque u64s, and fixed point", () => {
  const bwq8 = nativeDeathDropWireVector("bwq8-request");
  const query = Object.freeze({
    expected: NATIVE_CROSS_LANGUAGE_PICKUP_IDENTITY,
    afterSequence: 5_431,
  });
  assert.equal(bwq8.direction, "typescript-to-rust");
  assert.equal(Buffer.from(encodeRustIntegratedRuntimeDropPickupQueryV1(query)).toString("hex"), bwq8.hex);
  assert.deepEqual(decodeRustIntegratedRuntimeDropPickupQueryV1(bwq8.bytes), query);

  const bwr8 = nativeDeathDropWireVector("bwr8-receipt");
  assert.equal(bwr8.direction, "rust-to-typescript");
  const projection = decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
    bwr8.bytes,
    bwq8.wireChecksum,
    query.afterSequence,
  );
  const receipt = projection.receipt;
  assert.ok(receipt);
  assert.equal(receipt.world.universeId, "universe:pickup:死亡🌠");
  assert.equal(receipt.player.playerId, BigInt("0x80000001ffffff01"));
  assert.equal(receipt.player.entityId, BigInt("0x80000002ffffff02"));
  assert.equal(receipt.generatedDrop.entityId, BigInt("0x80000003ffffff03"));
  assert.equal(receipt.player.beforeRevision, BigInt("0xf00000000000022d"));
  assert.equal(receipt.generatedDrop.custodyBeforeRevision, BigInt("0xf000000000000237"));
  assert.equal(receipt.generatedDrop.position.xMilli, BigInt(33_554_431_983));
  assert.equal(receipt.generatedDrop.velocityMilliPerSecond.zMilli, BigInt(-4_095_989));
  assert.equal(receipt.generatedDrop.rotation.roll, 864_197);
  assert.equal(receipt.generatedDrop.dropId, "death-drop:死亡:🫐:5432");
  assert.equal(receipt.generatedDrop.origin?.kind, "player-death-drop");
  if (receipt.generatedDrop.origin?.kind !== "player-death-drop") {
    assert.fail("native BWR8 fixture did not decode its death-drop origin");
  }
  const bwe7Receipt = decodeRustIntegratedPlayerRespawnReceiptV1(
    nativeDeathDropWireVector("bwe7-receipt").bytes,
  );
  assert.equal(receipt.generatedDrop.origin.respawnSequence, 9_007_199_254_740_321);
  assert.equal(receipt.generatedDrop.origin.respawnReceiptHash, bwe7Receipt.receiptHash);
  assert.equal(receipt.generatedDrop.origin.sourceLane, "equipment");
  assert.equal(receipt.generatedDrop.origin.sourceSlot, 7);
  assert.equal(receipt.receiptHash, rustIntegratedRuntimeDropPickupReceiptHashV1(receipt));
  assert.equal(
    Buffer.from(encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
      projection,
      query.afterSequence,
    )).toString("hex"),
    bwr8.hex,
  );
});

test("checked BWQ8/BWR8 fixtures reject checksum-valid unsafe cursors and corrupt receipt hashes", () => {
  const bwq8 = nativeDeathDropWireVector("bwq8-request");
  const unsafeCursor = resealNativeWirePacket(bwq8.bytes, (bytes) => {
    bytes.fill(0xff, bytes.length - 8);
  });
  assert.throws(() => decodeRustIntegratedRuntimeDropPickupQueryV1(unsafeCursor), /safe|cursor|integer/u);

  const bwr8 = nativeDeathDropWireVector("bwr8-receipt");
  const invalidSeal = resealNativeWirePacket(bwr8.bytes, (bytes) => {
    bytes.fill(0, bytes.length - 16);
  });
  assert.throws(
    () => decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
      invalidSeal,
      bwq8.wireChecksum,
      5_431,
    ),
    /receipt hash/u,
  );
  assert.throws(() => decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
    bwr8.bytes.subarray(0, -1),
  ));
});

test("BWQ8/BWR8 preserve every pickup field and u64 losslessly", () => {
  const expected = identity();
  const query = encodeRustIntegratedRuntimeDropPickupQueryV1({ expected, afterSequence: 0 });
  assert.equal(Buffer.from(query.subarray(0, 4)).toString("ascii"), "BWQ8");
  assert.deepEqual(decodeRustIntegratedRuntimeDropPickupQueryV1(query), { expected, afterSequence: 0 });

  const receipt = Object.freeze({
    requestPayloadHash: hash(31), identity: expected, cursorAfter: 1, receipt: projection(),
  });
  const packet = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(receipt, 0);
  assert.equal(Buffer.from(packet.subarray(0, 4)).toString("ascii"), "BWR8");
  const decoded = decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
    packet,
    receipt.requestPayloadHash,
    0,
  );
  assert.deepEqual(decoded, receipt);
  assert.equal(
    decoded.receipt?.generatedDrop.origin?.kind === "generated-block-action"
      ? decoded.receipt.generatedDrop.origin.provenance.blockActionSequence
      : null,
    HIGH_U64,
  );
  assert.equal(decoded.receipt?.removal.gameplay.before.revision.sequence, HIGH_U64);
  assert.equal(decoded.receipt?.removal.entity.before.revision, HIGH_U64 + BigInt(34));
});

test("BWR8 rejects gaps, corrupt canonical receipts, and nonconserving pickup slots", () => {
  const expected = identity();
  assert.throws(() => encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
    requestPayloadHash: hash(31), identity: expected, cursorAfter: 2, receipt: projection(2),
  }, 0), /gapped|out of order/u);

  const valid = projection();
  assert.throws(() => encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
    requestPayloadHash: hash(31), identity: expected, cursorAfter: 1,
    receipt: Object.freeze({ ...valid, receiptHash: hash(99) }),
  }, 0), /canonical fields/u);

  const first = valid.player.affectedSlots[0]!;
  const nonconserving = Object.freeze({
    ...valid,
    player: Object.freeze({
      ...valid.player,
      affectedSlots: Object.freeze([
        Object.freeze({ ...first, afterStack: Object.freeze({ ...first.afterStack!, count: 63 }) }),
        valid.player.affectedSlots[1]!,
      ]),
    }),
  });
  assert.throws(() => encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
    requestPayloadHash: hash(31), identity: expected, cursorAfter: 1,
    receipt: Object.freeze({
      ...nonconserving,
      receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(nonconserving),
    }),
  }, 0), /conserve|increase/u);
});

test("BWR8 preserves and validates the exact player-drop source alternative", () => {
  const generated = projection();
  const playerOriginBase = Object.freeze({
    ...generated,
    generatedDrop: Object.freeze({
      ...generated.generatedDrop,
      origin: Object.freeze({
        kind: "player-drop" as const,
        playerDropSequence: 9,
        playerDropReceiptHash: hash(29),
      }),
    }),
  });
  const receipt = Object.freeze({
    ...playerOriginBase,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(playerOriginBase),
  });
  const response = Object.freeze({
    requestPayloadHash: hash(31),
    identity: identity(),
    cursorAfter: 1,
    receipt,
  });
  const packet = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(response, 0);
  assert.deepEqual(decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
    packet,
    response.requestPayloadHash,
    0,
  ), response);

  const invalidBase = Object.freeze({
    ...receipt,
    generatedDrop: Object.freeze({
      ...receipt.generatedDrop,
      origin: Object.freeze({
        kind: "player-drop" as const,
        playerDropSequence: 0,
        playerDropReceiptHash: hash(29),
      }),
    }),
  });
  const invalid = Object.freeze({
    ...invalidBase,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(invalidBase),
  });
  assert.throws(() => encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
    ...response,
    receipt: invalid,
  }, 0), /player-drop sequence/u);
});

test("BWR8 tag-2 death-drop origin matches the exact Rust vector, hash, and byte order", () => {
  const generatedResponse = rustCrossLanguageProjectionFixture();
  const generated = generatedResponse.receipt;
  const playerBase = Object.freeze({
    ...generated,
    generatedDrop: Object.freeze({
      ...generated.generatedDrop,
      origin: Object.freeze({
        kind: "player-drop" as const,
        playerDropSequence: 6,
        playerDropReceiptHash: repeatedHash(0xab),
      }),
    }),
  });
  const player = Object.freeze({
    ...playerBase,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(playerBase),
  });
  const deathBase = Object.freeze({
    ...player,
    generatedDrop: Object.freeze({
      ...player.generatedDrop,
      origin: Object.freeze({
        kind: "player-death-drop" as const,
        respawnSequence: 7,
        respawnReceiptHash: repeatedHash(0xac),
        sourceLane: "equipment" as const,
        sourceSlot: 3,
      }),
    }),
  });
  const death = Object.freeze({
    ...deathBase,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(deathBase),
  });
  const response = Object.freeze({ ...generatedResponse, receipt: death });
  const packet = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(response, 16);
  const originVector = Buffer.from(
    `02${"0700000000000000"}${"ac".repeat(16)}01000300`,
    "hex",
  );
  const originOffset = Buffer.from(packet).indexOf(originVector);
  assert.equal(originOffset, 453);
  assert.equal(death.receiptHash, "061e97176a587d2d6025b497d0aad864");
  assert.equal(rustIntegratedRuntimeWireChecksumV1(packet), "2fdc54a628d1a6f988dc984eeae922e3");
  assert.deepEqual(decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
    packet,
    response.requestPayloadHash,
    16,
  ), response);

  const generatedPacket = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(generatedResponse, 16);
  const playerPacket = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
    Object.freeze({ ...generatedResponse, receipt: player }),
    16,
  );
  assert.equal(rustIntegratedRuntimeWireChecksumV1(generatedPacket), "b8e841f83643f2a688dc982e00670701");
  assert.equal(rustIntegratedRuntimeWireChecksumV1(playerPacket), "6bd3bd22b511bd4a88dc98dec323f697");
  assert.equal(player.receiptHash, "b67292e7ed73c60e6025b497d0aad864");

  const corruptLane = Uint8Array.from(packet);
  corruptLane[originOffset + 25] = 2;
  corruptLane.set(Buffer.from(
    rustIntegratedRuntimeWireChecksumV1(corruptLane.subarray(28)),
    "hex",
  ), 12);
  assert.throws(() => decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
    corruptLane,
    response.requestPayloadHash,
    16,
  ), /unknown custody-lane tag/u);
});

test("BWR8 tag-2 death-drop origin rejects lane, slot, sequence, and parent-hash drift", () => {
  const generated = projection();
  function withOrigin(origin: RustIntegratedRuntimeDropPickupProjectionV1["generatedDrop"]["origin"]) {
    const base = Object.freeze({
      ...generated,
      generatedDrop: Object.freeze({ ...generated.generatedDrop, origin }),
    });
    return Object.freeze({ ...base, receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(base) });
  }
  const validOrigin = Object.freeze({
    kind: "player-death-drop" as const,
    respawnSequence: 7,
    respawnReceiptHash: hash(29),
    sourceLane: "equipment" as const,
    sourceSlot: 7,
  });
  const response = Object.freeze({
    requestPayloadHash: hash(31), identity: identity(), cursorAfter: 1, receipt: withOrigin(validOrigin),
  });
  assert.deepEqual(
    decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
      encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(response, 0),
      response.requestPayloadHash,
      0,
    ),
    response,
  );

  for (const origin of [
    Object.freeze({ ...validOrigin, respawnSequence: 0 }),
    Object.freeze({ ...validOrigin, respawnReceiptHash: hash(0) }),
    Object.freeze({ ...validOrigin, sourceSlot: 8 }),
    Object.freeze({ ...validOrigin, sourceLane: "unknown" as "equipment" }),
  ]) {
    assert.throws(() => encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
      ...response,
      receipt: withOrigin(origin),
    }, 0), /death|custody|hash|integer|lane|slot/u);
  }
});

test("legacy max-safe BWQ8 seeds latest without replay", () => {
  const expected = identity();
  const seeded = Object.freeze({ requestPayloadHash: hash(31), identity: expected, cursorAfter: 12, receipt: null });
  const packet = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
    seeded,
    RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1,
  );
  assert.deepEqual(decodeRustIntegratedRuntimeDropPickupProjectionReceiptV1(
    packet,
    seeded.requestPayloadHash,
    RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1,
  ), seeded);
  assert.throws(() => encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
    ...seeded, cursorAfter: 1, receipt: projection(),
  }, RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1), /seed-only/u);
});

test("read-only pickup BWRQ binds request, identity, cursor, and wire hashes", async () => {
  const expected = identity();
  let current = expected;
  let calls = 0;
  const service = {
    identity: () => current,
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      calls += 1;
      const operation = batch.operations[0]!;
      assert.equal(operation.domain, "gameplay");
      assert.equal(operation.typeId, RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1);
      assert.deepEqual(decodeRustIntegratedRuntimeDropPickupQueryV1(operation.payload), {
        expected, afterSequence: 0,
      });
      const payload = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
        requestPayloadHash: operation.payloadHash,
        identity: expected,
        cursorAfter: 1,
        receipt: projection(),
      }, 0);
      const accepted = {
        status: "accepted" as const,
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        before: expected,
        after: expected,
        domainReceipts: Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
          domain: "gameplay",
          typeId: RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1,
          schema: 1,
          payload,
        })]),
      };
      return Object.freeze({ ...accepted, receiptHash: outerReceiptHash(accepted) });
    },
  };
  const observed = await queryRustIntegratedRuntimeDropPickupReceiptV1(service, 0);
  assert.equal(calls, 1);
  assert.deepEqual(current, expected);
  assert.equal(observed.receipt?.receiptHash, projection().receiptHash);
  assert.equal(observed.cursorAfter, 1);
  assert.match(observed.projectionPayloadHash, /^[0-9a-f]{32}$/u);

  const driftingService = {
    identity: () => current,
    async command(batch: RustIntegratedRuntimeCommandBatchV1) {
      const receipt = await service.command(batch);
      current = identity(20, 2);
      return receipt;
    },
  };
  await assert.rejects(queryRustIntegratedRuntimeDropPickupReceiptV1(driftingService, 0), /identity|receipt/u);
});
