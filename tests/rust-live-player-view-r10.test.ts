import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { encodeRustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-codec-r6.ts";
import type {
  RustEntityExtractionR6V3,
  RustEntityExtractionRecordR6V3,
} from "../app/game/rust-entity-authority-contract-r6.ts";
import type { RustIntegratedRuntimeExtractionV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import { decodeRustLivePlayerViewR10 } from "../app/game/rust-live-player-view-r10.ts";

const BWX0 = Uint8Array.from(Buffer.from(readFileSync(
  new URL("./fixtures/rust-engine/r10-authoritative-extraction/bound-world-view-bwx0-v1.hex", import.meta.url),
  "utf8",
).trim(), "hex"));
const ZERO = new Uint8Array(16);

function record(overrides: Partial<RustEntityExtractionRecordR6V3> = {}): RustEntityExtractionRecordR6V3 {
  return Object.freeze({
    entityId: BigInt("4294967297"),
    residency: "hot",
    class: "player",
    simulationTier: "hero",
    protection: BigInt(0),
    entityRevision: BigInt(1),
    externalEntityId: "player:extraction",
    specimenId: "player:extraction",
    kindKey: "player",
    variantKey: null,
    name: "Extraction Player",
    modelKey: "player-standing",
    modelRevision: 0,
    modelHash: ZERO,
    position: Object.freeze({ x: 8, y: 64, z: 8 }),
    yaw: 0,
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
    health: 20,
    maximumHealth: 20,
    tamed: false,
    ageTicks: BigInt(0),
    movementMode: "ground",
    grounded: false,
    submerged: false,
    lastDamageTick: BigInt(0),
    action: Object.freeze({ key: "idle", phase: 0, startedTick: BigInt(0), endsTick: BigInt(0), target: null }),
    equipment: Object.freeze([]),
    mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
    research: Object.freeze([]),
    ...overrides,
  });
}

function extraction(entityRecords: readonly RustEntityExtractionRecordR6V3[], omitted = 0): RustIntegratedRuntimeExtractionV1 {
  const entities: RustEntityExtractionR6V3 = Object.freeze({
    schema: 3,
    extractionRevision: BigInt(6),
    authorityTick: BigInt(0),
    contentManifestHash: ZERO,
    contentReady: false,
    total: entityRecords.length + omitted,
    selected: entityRecords.length,
    omitted,
    records: Object.freeze([...entityRecords]),
  });
  return Object.freeze({
    identity: Object.freeze({
      universeId: "1",
      locationId: "surface",
      revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation: 1 }),
      tick: 0,
      stateHash: "f87984009a0457cbc83a5720c9106506",
    }),
    extractionRevision: 6,
    render: encodeRustEntityExtractionR6V3(entities),
    hud: BWX0,
    audio: new Uint8Array(),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: "0".repeat(32),
  });
}

test("live player view joins exact Rust runtime, world-view, inventory, and entity authority", () => {
  const view = decodeRustLivePlayerViewR10(extraction([record()]), "player:extraction");
  assert.equal(view.extractionRevision, BigInt(6));
  assert.equal(view.authorityTick, BigInt(0));
  assert.equal(view.playerId, BigInt("12884901895"));
  assert.equal(view.entityId, BigInt("4294967297"));
  assert.equal(view.entityRevision, BigInt(1));
  assert.equal(view.actorId, "player:extraction");
  assert.match(view.inventoryContainer, /^container-key-v1\/[0-9a-f]+$/u);
  assert.notEqual(view.inventoryContainer, view.equipmentContainer);
  assert.equal(view.inventoryContainerRevision, BigInt(0));
  assert.equal(view.equipmentContainerRevision, BigInt(0));
  assert.equal(view.selectedSlot, 0);
  assert.equal(view.backSlot, 7);
  assert.equal(view.lastInputSequence, BigInt(0));
  assert.equal(view.authoritativeFlags, 0);
  assert.equal(view.lookYaw, null);
  assert.equal(view.lookPitch, 0);
  assert.deepEqual(view.position, { x: 8, y: 64, z: 8 });
  assert.deepEqual(view.velocity, { x: 0, y: 0, z: 0 });
  assert.equal(view.health, 20);
  assert.equal(view.held, null);
});

test("live player view rejects divergent or incomplete authority instead of selecting a source", () => {
  assert.throws(
    () => decodeRustLivePlayerViewR10(extraction([record({ position: Object.freeze({ x: 9, y: 64, z: 8 }) })]), "player:extraction"),
    /positions disagree/u,
  );
  assert.throws(
    () => decodeRustLivePlayerViewR10(extraction([], 1), "player:extraction"),
    /omitted entity extraction/u,
  );
  assert.throws(
    () => decodeRustLivePlayerViewR10(extraction([record()]), "player:other"),
    /exactly one authoritative row/u,
  );
  assert.throws(
    () => decodeRustLivePlayerViewR10(extraction([record(), record({ name: "Duplicate Player" })]), "player:extraction"),
    /not canonical|exactly one BWR6/u,
  );
});
