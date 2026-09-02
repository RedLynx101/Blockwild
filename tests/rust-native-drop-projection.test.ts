import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BlockId, Item } from "../app/game/data.ts";
import {
  VoxelEngine,
  rustDropSpawnOptionsFromSave,
  serializeWorldDropSave,
  type DropSpawnOptions,
  type WorldDropSave,
} from "../app/game/engine.ts";

const RUST_ENTITY_ID = "18446744073709551614";
const POSITION = Object.freeze({ x: 1.25, y: 4.5, z: -3.75 });
const VELOCITY = Object.freeze({ x: 0.125, y: 1.75, z: -0.625 });

function projectionEngine() {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  Object.assign(engine, {
    drops: [],
    dropGroup: new THREE.Group(),
    dropModelTemplates: new Map([[`${Item.Stick}:empty`, new THREE.Object3D()]]),
    nextDropId: 1,
  });
  return engine;
}

function exactOptions(overrides: Partial<DropSpawnOptions> = {}): DropSpawnOptions {
  return {
    allowMerge: false,
    exactPosition: true,
    rustEntityId: RUST_ENTITY_ID,
    rotationY: 1.125,
    velocity: VELOCITY,
    pickupDelay: 0.35,
    ...overrides,
  };
}

function structuralCloneRandomCalls(engine: VoxelEngine) {
  const template = engine.dropModelTemplates.get(`${Item.Stick}:empty`)!;
  let calls = 0;
  const originalRandom = Math.random;
  Math.random = () => { calls += 1; return 0.5; };
  try { template.clone(true); } finally { Math.random = originalRandom; }
  return calls;
}

test("native drop projection adds no gameplay randomness to exact identity and motion", () => {
  const engine = projectionEngine();
  const structuralCalls = structuralCloneRandomCalls(engine);
  let calls = 0;
  const originalRandom = Math.random;
  Math.random = () => { calls += 1; return 0.875; };
  try {
    const drop = engine.spawnDrop(Item.Stick, 7, new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z), undefined, undefined, exactOptions());
    assert.ok(drop);
    assert.equal(engine.drops.length, 1);
    assert.equal(drop.rustEntityId, RUST_ENTITY_ID);
    assert.equal(drop.count, 7);
    assert.deepEqual(drop.mesh.position.toArray(), [POSITION.x, POSITION.y, POSITION.z]);
    assert.equal(drop.mesh.rotation.y, 1.125);
    assert.deepEqual(drop.velocity.toArray(), [VELOCITY.x, VELOCITY.y, VELOCITY.z]);
    assert.equal(drop.pickupDelay, 0.35);
    assert.equal(calls, structuralCalls, "exact native state must add no random position or velocity samples beyond Three's UUID allocation");
  } finally {
    Math.random = originalRandom;
  }
});

test("native identities are unique and only exact explicit recovery is idempotent", () => {
  const engine = projectionEngine();
  const position = new THREE.Vector3(POSITION.x, POSITION.y, POSITION.z);
  const first = engine.spawnDrop(Item.Stick, 7, position, undefined, { provenance: "rust" }, exactOptions());
  assert.ok(first);

  assert.throws(
    () => engine.spawnDrop(Item.Stick, 7, position, undefined, { provenance: "rust" }, exactOptions()),
    /already projected/u,
  );
  const recovered = engine.spawnDrop(
    Item.Stick,
    7,
    position,
    undefined,
    { provenance: "rust" },
    exactOptions({ exactIdempotentRecovery: true }),
  );
  assert.equal(recovered, first);
  assert.equal(engine.drops.length, 1);

  assert.throws(() => engine.spawnDrop(
    Item.Stick,
    7,
    position,
    undefined,
    { provenance: "rust" },
    exactOptions({ rotationY: 1.126, exactIdempotentRecovery: true }),
  ), /different or unverified/u);
  assert.throws(() => engine.spawnDrop(
    Item.Stick,
    7,
    position,
    undefined,
    { provenance: "changed" },
    exactOptions({ exactIdempotentRecovery: true }),
  ), /different or unverified/u);
  assert.equal(engine.drops.length, 1);
});

test("one native identity cannot split, merge, or use a noncanonical id", () => {
  const engine = projectionEngine();
  assert.throws(() => engine.spawnDrop(
    Item.Stick,
    65,
    new THREE.Vector3(),
    undefined,
    undefined,
    exactOptions({ rustEntityId: "1" }),
  ), /one exact/u);
  assert.throws(() => engine.spawnDrop(
    Item.Stick,
    1,
    new THREE.Vector3(),
    undefined,
    undefined,
    exactOptions({ rustEntityId: "0" }),
  ), /positive u64/u);
  assert.equal(engine.drops.length, 0);

  const native = engine.spawnDrop(Item.Stick, 1, new THREE.Vector3(), undefined, undefined, exactOptions({ rustEntityId: "2" }));
  assert.ok(native);
  engine.spawnDrop(Item.Stick, 1, new THREE.Vector3());
  assert.equal(engine.drops.length, 2, "a normal browser drop must not merge into native custody");
  assert.deepEqual(engine.drops.map((drop) => drop.count), [1, 1]);
});

test("drop capacity pressure never evicts a native presentation", () => {
  const engine = projectionEngine();
  for (let index = 1; index <= 121; index += 1) {
    engine.spawnDrop(
      Item.Stick,
      1,
      new THREE.Vector3(index, 0, 0),
      undefined,
      undefined,
      exactOptions({ rustEntityId: String(index) }),
    );
  }
  assert.equal(engine.drops.length, 121);
  assert.equal(engine.drops.every((drop, index) => drop.rustEntityId === String(index + 1)), true);
});

test("legacy drops retain their random spawn behavior and compact save shape", () => {
  const engine = projectionEngine();
  const structuralCalls = structuralCloneRandomCalls(engine);
  const values = [0.75, 0.25, 0.5, 0.75, 0.25];
  let calls = 0;
  const originalRandom = Math.random;
  Math.random = () => {
    calls += 1;
    if (calls <= structuralCalls) return 0.5;
    return values[calls - structuralCalls - 1] ?? 0.5;
  };
  try {
    const drop = engine.spawnDrop(Item.Stick, 1, new THREE.Vector3());
    assert.ok(drop);
    assert.equal(calls, structuralCalls + 5);
    assert.deepEqual(drop.mesh.position.toArray(), [0.1125, 0.25, -0.1125]);
    assert.deepEqual(drop.velocity.toArray(), [0, 2.75, -0.35]);
    assert.equal(drop.rustEntityId, undefined);
  } finally {
    Math.random = originalRandom;
  }

  const legacy = serializeWorldDropSave({
    item: Item.Stick,
    count: 1,
    position: POSITION,
    rotationY: 2.5,
    velocity: VELOCITY,
    age: 8,
    pickupDelay: 0.2,
  });
  assert.deepEqual(legacy, { item: Item.Stick, count: 1, ...POSITION, age: 8 });
  assert.equal(rustDropSpawnOptionsFromSave(legacy), null);
});

test("native save rows round-trip exact identity, rotation, position, velocity, and pickup delay", () => {
  const saved = serializeWorldDropSave({
    item: Item.Stick,
    count: 7,
    metadata: { provenance: "rust" },
    position: POSITION,
    rotationY: 1.125,
    velocity: VELOCITY,
    age: 9.5,
    pickupDelay: 0.275,
    rustEntityId: RUST_ENTITY_ID,
  });
  assert.deepEqual(saved, {
    item: Item.Stick,
    count: 7,
    metadata: { provenance: "rust" },
    ...POSITION,
    age: 9.5,
    rustEntityId: RUST_ENTITY_ID,
    rotationY: 1.125,
    vx: VELOCITY.x,
    vy: VELOCITY.y,
    vz: VELOCITY.z,
    pickupDelay: 0.275,
  });
  assert.deepEqual(rustDropSpawnOptionsFromSave(saved), {
    allowMerge: false,
    exactPosition: true,
    rustEntityId: RUST_ENTITY_ID,
    rotationY: 1.125,
    velocity: VELOCITY,
    pickupDelay: 0.275,
  });
  assert.equal(Object.isFrozen(rustDropSpawnOptionsFromSave(saved)), true);

  const engine = projectionEngine();
  const restored = engine.spawnDrop(
    saved.item,
    saved.count,
    new THREE.Vector3(saved.x, saved.y, saved.z),
    undefined,
    saved.metadata,
    rustDropSpawnOptionsFromSave(saved)!,
  );
  assert.ok(restored);
  restored.age = saved.age;
  assert.deepEqual(serializeWorldDropSave({
    item: restored.item,
    count: restored.count,
    ...(restored.durability !== undefined ? { durability: restored.durability } : {}),
    ...(restored.metadata ? { metadata: restored.metadata } : {}),
    position: restored.mesh.position,
    rotationY: restored.mesh.rotation.y,
    velocity: restored.velocity,
    age: restored.age,
    pickupDelay: restored.pickupDelay,
    rustEntityId: restored.rustEntityId,
  }), saved);

  const incomplete = { ...saved } as Record<string, unknown>;
  delete incomplete.vx;
  assert.equal(rustDropSpawnOptionsFromSave(incomplete as unknown as WorldDropSave), null);
});

test("native presentation stays frozen for Rust hot transforms and never enters legacy custody", () => {
  const engine = projectionEngine();
  const legacy = engine.spawnDrop(Item.Stick, 1, new THREE.Vector3(50, 5, 0));
  const native = engine.spawnDrop(Item.Stick, 1, new THREE.Vector3(0, 5, 0), undefined, undefined, exactOptions({ rustEntityId: "7" }));
  assert.ok(legacy && native);
  legacy.velocity.set(0, 0, 0);
  legacy.pickupDelay = 10;

  let addItemCalls = 0;
  let questCalls = 0;
  let removeCalls = 0;
  Object.assign(engine, {
    position: new THREE.Vector3(0, 5, 0),
    world: { getBlock: () => BlockId.Air },
    worldOptions: { dayLengthMinutes: 20 },
    simulationInterestPoints: () => [
      { x: 0, y: 5, z: 0 },
      { x: 50, y: 5, z: 0 },
    ],
    ensureTerrainResidency: () => true,
    addItem: () => { addItemCalls += 1; return 0; },
    dispatchQuestEvent: () => { questCalls += 1; },
    removeDrop: () => { removeCalls += 1; },
  });

  const nativeRotationBefore = native.mesh.rotation.y;
  engine.updateDrops(0.5);
  assert.equal(native.age, 0, "native age advances only through an authoritative Rust hot transform");
  assert.equal(native.pickupDelay, 0.35, "native pickup custody marker remains stable until a native receipt exists");
  assert.equal(native.mesh.rotation.y, nativeRotationBefore,
    "native rotation advances only through an authoritative Rust hot transform");
  assert.equal(legacy.age, 0.5, "native custody uses continue so the remaining drop loop still advances");
  assert.equal(engine.drops.length, 2);
  assert.equal(addItemCalls, 0);
  assert.equal(questCalls, 0);
  assert.equal(removeCalls, 0);
});
