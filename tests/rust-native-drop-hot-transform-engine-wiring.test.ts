import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BlockId } from "../app/game/data.ts";
import { VoxelEngine } from "../app/game/engine.ts";
import type { RustDroppedHotTransformFrameR10 } from "../app/game/rust-authoritative-extraction-r10.ts";

type DropMirror = Readonly<{
  id: number;
  rustEntityId: string;
  item: number;
  count: number;
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  age: number;
  pickupDelay: number;
}>;

type HotTransformHarness = Readonly<{
  drops: DropMirror[];
  prepareRustDroppedHotTransformCommitR10(
    frame: RustDroppedHotTransformFrameR10,
    authorityTick: bigint,
  ): readonly unknown[];
  projectRustDroppedHotTransformsR10(prepared: readonly unknown[]): void;
  updateDrops(dt: number): void;
}>;

function frame(entityId = BigInt("4294967298")): RustDroppedHotTransformFrameR10 {
  return Object.freeze({
    schema: 1,
    source: Object.freeze({
      identity: Object.freeze({
        universeId: "world:test",
        locationId: "runtime:test",
        revision: Object.freeze({
          epoch: 1,
          world: 2,
          entities: 3,
          gameplay: 4,
          persistence: 5,
          network: 6,
          simulation: 7,
        }),
        tick: 41,
        stateHash: "1".repeat(32),
      }),
      extractionRevision: BigInt(9),
      authorityTick: BigInt(41),
      inventoryDomainRevision: BigInt(8),
      extractionHash: "2".repeat(32),
    }),
    transforms: Object.freeze([Object.freeze({
      schema: 1,
      dropId: "drop:test",
      entityId,
      entityRevision: BigInt(12),
      rowRevision: BigInt(13),
      custodyContainer: "container:drop:test",
      custodySlot: 0,
      boundContainerRevision: BigInt(0),
      itemCode: BlockId.Dirt,
      count: 1,
      durabilityMillionths: null,
      metadataHash: new Uint8Array(16),
      position: Object.freeze({ x: 1.25, y: 35.5, z: -3.75 }),
      velocity: Object.freeze({ x: 0.125, y: -0.75, z: -0.25 }),
      rotationMicroturns: Object.freeze({ yaw: 250_000, pitch: 0, roll: 0 }),
      yawRadians: Math.PI / 2,
      createdTick: BigInt(18),
      ageTicks: BigInt(23),
      expiresTick: null,
      pickupLockActorId: null,
    })]),
  });
}

function harness() {
  const mesh = new THREE.Object3D();
  mesh.position.set(99, 98, 97);
  mesh.rotation.y = -1;
  const drop = {
    id: 1,
    rustEntityId: "4294967298",
    item: BlockId.Dirt,
    count: 1,
    mesh,
    velocity: new THREE.Vector3(9, 8, 7),
    age: 500,
    pickupDelay: 0.35,
  };
  const engine = Object.create(VoxelEngine.prototype) as HotTransformHarness & {
    simulationInterestPoints(): readonly THREE.Vector3[];
  };
  Object.assign(engine, {
    drops: [drop],
    simulationInterestPoints: () => Object.freeze([]),
  });
  return { engine, drop };
}

test("native hot transforms atomically replace the compatibility root and legacy frames leave it untouched", () => {
  const { engine, drop } = harness();
  const prepared = engine.prepareRustDroppedHotTransformCommitR10(frame(), BigInt(41));
  engine.projectRustDroppedHotTransformsR10(prepared);
  assert.deepEqual(drop.mesh.position.toArray(), [1.25, 35.5, -3.75]);
  assert.deepEqual(drop.velocity.toArray(), [0.125, -0.75, -0.25]);
  assert.equal(drop.mesh.rotation.y, Math.PI / 2);
  assert.equal(drop.age, 23 * 0.05);
  assert.equal(drop.pickupDelay, 0.35);

  engine.updateDrops(2);
  assert.deepEqual(drop.mesh.position.toArray(), [1.25, 35.5, -3.75]);
  assert.deepEqual(drop.velocity.toArray(), [0.125, -0.75, -0.25]);
  assert.equal(drop.mesh.rotation.y, Math.PI / 2);
  assert.equal(drop.age, 23 * 0.05);
  assert.equal(drop.pickupDelay, 0.35);
});

test("native hot-transform commit rejects authority-tick and entity coverage mismatches before mutation", () => {
  const { engine, drop } = harness();
  assert.throws(
    () => engine.prepareRustDroppedHotTransformCommitR10(frame(), BigInt(42)),
    /authority tick/u,
  );
  assert.throws(
    () => engine.prepareRustDroppedHotTransformCommitR10(frame(BigInt("4294967299")), BigInt(41)),
    /stack or entity identity/u,
  );
  assert.deepEqual(drop.mesh.position.toArray(), [99, 98, 97]);
  assert.deepEqual(drop.velocity.toArray(), [9, 8, 7]);
  assert.equal(drop.age, 500);
});
