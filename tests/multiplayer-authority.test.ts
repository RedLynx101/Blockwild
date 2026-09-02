import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BlockId, Item, type ItemCode } from "../app/game/data.ts";
import { VoxelEngine, applyAuthoritativeNetworkMode, shouldExpireWorldDrop } from "../app/game/engine.ts";
import { MultiplayerDiagnosticsRing } from "../app/game/multiplayer-diagnostics.ts";
import { applyContainerOperation } from "../app/game/multiplayer-inventory.ts";
import { createSkillState } from "../app/game/skills.ts";
import type { ContainerAction, DestructionTombstone, InventoryAction, ItemStackSnapshot, PlayerSessionSnapshot, SnapshotScope } from "../app/game/multiplayer.ts";

const PLAYER_ID = "player_authority_guest_001";

function playerState(overrides: Partial<PlayerSessionSnapshot> = {}): PlayerSessionSnapshot {
  return {
    playerId: PLAYER_ID,
    revision: 4,
    variant: "female",
    inventory: Array.from({ length: 36 }, () => null),
    equipment: { head: null, chest: null, legs: null, feet: null },
    selected: 0,
    health: 10,
    hunger: 10,
    xp: 0,
    level: 1,
    skills: createSkillState(),
    ...overrides,
  };
}

test("a survival host snapshot overrides a guest's previous builder mode", () => {
  const guest = { mode: "builder" as const } as { mode: "builder" | "survival" };
  assert.equal(applyAuthoritativeNetworkMode(guest, "survival"), "survival");
  assert.equal(guest.mode, "survival");
  guest.mode = "builder";
  assert.equal(applyAuthoritativeNetworkMode(guest, undefined), "survival", "legacy peers fail closed instead of exposing All Blocks");
});

test("semantic slot intents preserve exact metadata and furnace withdrawal rules", () => {
  const player = playerState();
  player.inventory[9] = { item: Item.Apple, count: 3, metadata: { provenance: { orchard: "authority", pickedDay: 7 } } };
  const deposited = applyContainerOperation(player, Array.from({ length: 27 }, () => null), {
    op: "click", target: { owner: "player", slot: 9 }, button: "left", shift: true,
  }, { containerKind: "chest" });
  assert.equal(deposited.applied, true);
  assert.equal(deposited.player.inventory[9], null);
  assert.deepEqual(deposited.slots[0], { item: Item.Apple, count: 3, metadata: { provenance: { orchard: "authority", pickedDay: 7 } } });

  const output: ItemStackSnapshot[] = [null, null, { item: Item.Apple, count: 4 }];
  const withdrawn = applyContainerOperation(playerState({ cursor: { item: Item.Apple, count: 2 } }), output, {
    op: "click", target: { owner: "container", slot: 2 }, button: "right", shift: false,
  }, { containerKind: "furnace" });
  assert.equal(withdrawn.applied, true);
  assert.equal(withdrawn.player.cursor?.count, 3);
  assert.equal(withdrawn.slots[2]?.count, 3);

  const blocked = applyContainerOperation(playerState({ cursor: { item: Item.Stick, count: 1 } }), output, {
    op: "click", target: { owner: "container", slot: 2 }, button: "left", shift: false,
  }, { containerKind: "furnace" });
  assert.equal(blocked.applied, false);
  assert.deepEqual(blocked.slots, output);

  const shielded = applyContainerOperation(playerState({ cursor: { item: Item.WoodenShield, count: 1, durability: 91 } }), [], {
    op: "click", target: { owner: "offhand", slot: 0 }, button: "left", shift: false,
  }, { containerKind: "chest", canUsePlayerTarget: (owner) => owner === "offhand" });
  assert.equal(shielded.applied, true);
  assert.equal(shielded.player.cursor, null);
  assert.deepEqual(shielded.player.offhand, { item: Item.WoodenShield, count: 1, durability: 91 });
  const packedShield = applyContainerOperation(shielded.player, [], {
    op: "click", target: { owner: "offhand", slot: 0 }, button: "left", shift: true,
  }, { containerKind: "chest", canUsePlayerTarget: (owner) => owner === "offhand" });
  assert.equal(packedShield.applied, true);
  assert.deepEqual(packedShield.player.inventory[9], { item: Item.WoodenShield, count: 1, durability: 91 });

  const distributed = applyContainerOperation(playerState({ cursor: { item: Item.Apple, count: 8, metadata: { orchard: "authority" } } }), [], {
    op: "distribute", targets: [9, 10, 11], button: "left",
  }, { containerKind: "chest" });
  assert.equal(distributed.applied, true);
  assert.deepEqual(distributed.player.inventory.slice(9, 12), [
    { item: Item.Apple, count: 2, metadata: { orchard: "authority" } },
    { item: Item.Apple, count: 2, metadata: { orchard: "authority" } },
    { item: Item.Apple, count: 2, metadata: { orchard: "authority" } },
  ]);
  assert.deepEqual(distributed.player.cursor, { item: Item.Apple, count: 2, metadata: { orchard: "authority" } });
});

test("optimistic rollback replays later non-conflicting intents without duplication", () => {
  const baseline = playerState();
  baseline.inventory[9] = { item: Item.Apple, count: 1 };
  baseline.inventory[10] = { item: Item.Stick, count: 2 };
  const emptyChest = Array.from({ length: 27 }, () => null) as ItemStackSnapshot[];
  const intentA = { op: "click", target: { owner: "player", slot: 9 }, button: "left", shift: true } as const;
  const intentB = { op: "click", target: { owner: "player", slot: 10 }, button: "left", shift: true } as const;
  const optimisticA = applyContainerOperation(baseline, emptyChest, intentA, { containerKind: "chest" });
  const optimisticAB = applyContainerOperation(optimisticA.player, optimisticA.slots, intentB, { containerKind: "chest" });
  const replayedB = applyContainerOperation(baseline, emptyChest, intentB, { containerKind: "chest" });
  assert.equal(replayedB.player.inventory[9]?.count, 1);
  assert.equal(replayedB.player.inventory[10], null);
  assert.equal(replayedB.slots.filter(Boolean).length, 1);
  assert.equal(replayedB.slots[0]?.item, Item.Stick);
  const replayedAfterCommit = applyContainerOperation(optimisticA.player, optimisticA.slots, intentB, { containerKind: "chest" });
  assert.deepEqual(replayedAfterCommit.player.inventory, optimisticAB.player.inventory);
  assert.deepEqual(replayedAfterCommit.slots, optimisticAB.slots);
});

test("a full player inventory rejects container transfer without losing the stack", () => {
  const inventory = Array.from({ length: 36 }, () => ({ item: Item.Stick, count: 64 })) as PlayerSessionSnapshot["inventory"];
  const player = playerState({ inventory });
  const chest: ItemStackSnapshot[] = [{ item: Item.Apple, count: 2 }];
  const result = applyContainerOperation(player, chest, {
    op: "click", target: { owner: "container", slot: 0 }, button: "left", shift: true,
  }, { containerKind: "chest" });
  assert.equal(result.applied, false);
  assert.deepEqual(result.player.inventory, player.inventory);
  assert.deepEqual(result.slots, chest);
});

test("a full host-owned pack rejects world pickup without deleting the drop", () => {
  const full = playerState({ inventory: Array.from({ length: 36 }, () => ({ item: Item.Stick, count: 64 })) });
  const responses: InventoryAction[] = [];
  const drop = { id: 52, item: Item.Apple, count: 2, mesh: { position: new THREE.Vector3(0, 1.8, 0) } };
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  Object.assign(engine, {
    multiplayer: { role: "host", sendInventoryAction: (action: InventoryAction) => { responses.push(action); return 1; } },
    remotePlayers: new Map([[PLAYER_ID, { target: { x: 0, y: 1, z: 0 } }]]),
    multiplayerPlayerStates: new Map([[PLAYER_ID, full]]), drops: [drop],
    ensureHostPlayerSession: () => full, multiplayerDiagnostics: new MultiplayerDiagnosticsRing(),
  });
  const request: InventoryAction = {
    requestId: "pickup_full_pack_001", actorId: PLAYER_ID, kind: "collect", dropId: drop.id,
    pickupAt: { x: 0, y: 1.8, z: 0 }, status: "request",
  };
  (engine as unknown as { handleRemoteInventoryAction(action: InventoryAction, peer: { identity: { id: string } }): void })
    .handleRemoteInventoryAction(request, { identity: { id: PLAYER_ID } });
  assert.equal(responses.at(-1)?.status, "rejected");
  assert.equal(engine.drops[0]?.count, 2);
  assert.equal(engine.multiplayerPlayerStates.get(PLAYER_ID)?.revision, full.revision);
});

test("world-drop cleanup uses the nearest active player rather than the host", () => {
  const host = { x: 0, y: 1, z: 0 };
  const distantGuest = { x: 140, y: 1, z: 0 };
  const guestDrop = { x: 140, y: 1.8, z: 0 };
  assert.equal(shouldExpireWorldDrop(10, guestDrop, [host]), true, "host-only cleanup would incorrectly delete the guest's loot");
  assert.equal(shouldExpireWorldDrop(10, guestDrop, [host, distantGuest]), false);
  assert.equal(shouldExpireWorldDrop(121, guestDrop, [host, distantGuest]), true, "age expiry remains authoritative");
});

test("two furnace viewers receive the same atomic semantic slot commit", () => {
  const actor = playerState();
  actor.inventory[9] = { item: Item.RawIron, count: 2, metadata: { batch: "shared" } };
  const containerId = "furnace:7,8,9";
  const deliveries: Array<{ peerId?: string; action: ContainerAction }> = [];
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  Object.assign(engine, {
    multiplayer: {
      role: "host", identity: { id: "player_host_authority_001" },
      getPeer: () => ({ identity: { id: PLAYER_ID } }),
      sendContainerAction: (action: ContainerAction, peerId?: string) => { deliveries.push({ action: structuredClone(action), peerId }); return 1; },
      sendPlayerState: () => 1,
    },
    chests: new Map(),
    furnaces: new Map([["7,8,9", { input: null, fuel: null, output: null, progress: 2, burn: 4, burnMax: 8 }]]), boats: new Map(), mobs: [],
    remotePlayers: new Map([[PLAYER_ID, { target: { x: 7, y: 8, z: 9 } }]]),
    world: { terrainGenerationAuthority: { mode: "typescript" }, getBlock: () => BlockId.Furnace },
    multiplayerContainerRevisions: new Map([[containerId, 0]]), multiplayerContainerSignatures: new Map(),
    multiplayerPeerActiveContainers: new Map([[PLAYER_ID, containerId], ["player_observer_002", containerId]]),
    multiplayerPeerContainerSignatures: new Map(), multiplayerPlayerStates: new Map([[PLAYER_ID, actor]]),
    multiplayerDiagnostics: new MultiplayerDiagnosticsRing(), pendingReliableRequests: new Map(),
    ensureHostPlayerSession: () => actor, sendAuthoritativePlayerState: () => undefined, saveSoon: () => undefined, emitHud: () => undefined,
  });
  const request: ContainerAction = {
    requestId: "container_two_viewers_001", actorId: PLAYER_ID, containerId, kind: "mutate",
    operation: { op: "click", target: { owner: "player", slot: 9 }, button: "left", shift: true },
    expectedRevision: 0, expectedPlayerRevision: actor.revision, status: "request",
  };
  (engine as unknown as { handleRemoteContainerAction(action: ContainerAction, peer: { identity: { id: string; name: string; color: string } }): void })
    .handleRemoteContainerAction(request, { identity: { id: PLAYER_ID, name: "Guest", color: "#ffffff" } });
  const actorDelivery = deliveries.find((entry) => entry.peerId === PLAYER_ID)?.action;
  const observerDelivery = deliveries.find((entry) => entry.peerId === "player_observer_002")?.action;
  assert.equal(actorDelivery?.status, "accepted");
  assert.equal(observerDelivery?.status, "accepted");
  assert.deepEqual(actorDelivery?.slots, observerDelivery?.slots);
  assert.deepEqual(actorDelivery?.slots?.[0], { item: Item.RawIron, count: 2, metadata: { batch: "shared" } });
  assert.equal(actorDelivery?.expectedRevision, 1);
  assert.equal(observerDelivery?.expectedRevision, 1);
});

test("snapshot scopes reject stale ticks and accept a fresh reconnect epoch", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  const drop = { id: 7, item: Item.Apple, count: 1, mesh: { position: new THREE.Vector3(0, 1, 0) }, velocity: new THREE.Vector3(), age: 0, pickupDelay: 0 };
  const outside = { id: 8, item: Item.Stick, count: 1, mesh: { position: new THREE.Vector3(100, 1, 0) }, velocity: new THREE.Vector3(), age: 0, pickupDelay: 0 };
  Object.assign(engine, {
    multiplayer: { identity: { id: PLAYER_ID } }, position: new THREE.Vector3(), drops: [drop, outside],
    pendingGuestDropRequests: new Map(), appliedMultiplayerTombstones: new Map(),
    lastNetworkDropSnapshotTick: -1, lastNetworkDropSnapshotScope: null, nextDropId: 8,
    removeDrop: (index: number) => { engine.drops.splice(index, 1); }, spawnDrop: () => null,
  });
  const firstScope: SnapshotScope = { centerPlayerId: PLAYER_ID, radius: 64, epoch: 1 };
  const apply = (engine as unknown as { applyNetworkDropSnapshot(entries: Array<{ id: number; item: ItemCode; count: number; x: number; y: number; z: number }>, tick: number, scope: SnapshotScope): void }).applyNetworkDropSnapshot.bind(engine);
  apply([{ id: 7, item: Item.Apple, count: 2, x: 2, y: 1, z: 0 }], 10, firstScope);
  assert.equal(drop.count, 2);
  assert.equal(engine.drops.some((entry) => entry.id === outside.id), true, "out-of-scope omission is not deletion authority");
  apply([{ id: 7, item: Item.Apple, count: 99, x: 9, y: 1, z: 0 }], 9, firstScope);
  assert.equal(drop.count, 2);
  apply([{ id: 7, item: Item.Apple, count: 3, x: 3, y: 1, z: 0 }], 1, { ...firstScope, epoch: 2 });
  assert.equal(drop.count, 3);
  apply([{ id: 7, item: Item.Apple, count: 8, x: 8, y: 1, z: 0 }], 2, { centerPlayerId: "player_someone_else", radius: 64, epoch: 2 });
  assert.equal(drop.count, 3);
});

test("mob snapshot reordering cannot roll back a newer scoped frame", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  const mob = {
    id: 21, kind: "peelop", group: new THREE.Group(), health: 8, state: "wander",
    networkTarget: null as THREE.Vector3 | null, networkSnapshotAt: undefined, networkVelocity: null, networkSnapshotAge: 0, networkYaw: 0,
    attunedOrbId: null, factionId: null, aligned: false, dragonState: null, shadeState: null, reedstriderBond: null,
    courserBond: null, leviathanGrowth: null, aetherbellMorph: null, careState: null, petState: null, apiaryBee: null,
  };
  Object.assign(engine, {
    multiplayer: { identity: { id: PLAYER_ID } }, position: new THREE.Vector3(), mobs: [mob],
    pendingNetworkMobDeaths: new Set(), appliedMultiplayerTombstones: new Map(), leadAnchors: new Map(), leadLines: new Map(),
    lastNetworkMobSnapshotTick: -1, lastNetworkMobSnapshotScope: null,
    removeMob: (index: number) => { engine.mobs.splice(index, 1); }, spawnMob: () => { throw new Error("existing mob should be updated"); },
    applyMobScale: () => undefined, mobBaseScale: () => 1, removeLead: () => undefined,
  });
  const scope: SnapshotScope = { centerPlayerId: PLAYER_ID, radius: 64, epoch: 3 };
  const apply = (engine as unknown as { applyNetworkMobSnapshot(entries: unknown[], tick: number, scope: SnapshotScope): void }).applyNetworkMobSnapshot.bind(engine);
  apply([{ id: 21, kind: "peelop", x: 2, y: 1, z: 0, yaw: 0.2, health: 3, state: "wander" }], 10, scope);
  assert.equal(mob.health, 3);
  assert.equal(mob.networkTarget?.x, 2);
  apply([{ id: 21, kind: "peelop", x: 9, y: 1, z: 0, yaw: 1, health: 8, state: "wander" }], 9, scope);
  assert.equal(mob.health, 3);
  assert.equal(mob.networkTarget?.x, 2);
});

test("destruction tombstones animate once and suppress stale mob/drop resurrection", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  const mob = { id: 11, group: { position: new THREE.Vector3(1, 1, 1) } };
  const drop = { id: 12, item: Item.Apple, count: 1, mesh: { position: new THREE.Vector3(1, 1, 1) } };
  let remains = 0;
  let spawnedMobs = 0;
  let spawnedDrops = 0;
  const setBlocks: Array<[number, number, number, BlockId]> = [];
  Object.assign(engine, {
    multiplayer: { identity: { id: PLAYER_ID } }, multiplayerTick: 8, position: new THREE.Vector3(), mobs: [mob], drops: [drop],
    pendingNetworkMobDeaths: new Set(), pendingGuestDropRequests: new Map(), appliedMultiplayerTombstones: new Map(),
    leadAnchors: new Map(), leadLines: new Map(), lastNetworkMobSnapshotTick: -1, lastNetworkMobSnapshotScope: null,
    lastNetworkDropSnapshotTick: -1, lastNetworkDropSnapshotScope: null,
    world: { setBlock: (x: number, y: number, z: number, type: BlockId) => { setBlocks.push([x, y, z, type]); } },
    spawnMobRemains: () => { remains += 1; }, removeMob: (index: number) => { engine.mobs.splice(index, 1); },
    removeDrop: (index: number) => { engine.drops.splice(index, 1); }, spawnMob: () => { spawnedMobs += 1; return mob; },
    spawnDrop: () => { spawnedDrops += 1; return null; },
  });
  const tombstones: DestructionTombstone[] = [
    { id: "block-1", kind: "block", tick: 8, block: { x: 4, y: 5, z: 6 }, cause: "broken" },
    { id: "mob-11", kind: "mob", tick: 8, entityId: 11, cause: "killed" },
    { id: "drop-12", kind: "drop", tick: 8, entityId: 12, cause: "collected" },
  ];
  (engine as unknown as { applyDestructionTombstones(batch: { tick: number; tombstones: DestructionTombstone[] }): void }).applyDestructionTombstones({ tick: 8, tombstones });
  assert.deepEqual(setBlocks, [[4, 5, 6, BlockId.Air]]);
  assert.equal(remains, 1);
  assert.equal(engine.mobs.length, 0);
  assert.equal(engine.drops.length, 0);
  const scope: SnapshotScope = { centerPlayerId: PLAYER_ID, radius: 64, epoch: 1 };
  (engine as unknown as { applyNetworkMobSnapshot(entries: unknown[], tick: number, scope: SnapshotScope): void }).applyNetworkMobSnapshot([
    { id: 11, kind: "peelop", x: 1, y: 1, z: 1, yaw: 0, health: 4, state: "wander" },
  ], 7, scope);
  (engine as unknown as { applyNetworkDropSnapshot(entries: unknown[], tick: number, scope: SnapshotScope): void }).applyNetworkDropSnapshot([
    { id: 12, item: Item.Apple, count: 1, x: 1, y: 1, z: 1 },
  ], 7, scope);
  (engine as unknown as { applyNetworkMobSnapshot(entries: unknown[], tick: number, scope: SnapshotScope): void }).applyNetworkMobSnapshot([], 9, scope);
  assert.equal(spawnedMobs, 0);
  assert.equal(spawnedDrops, 0);
  assert.equal(remains, 1);
  assert.equal(engine.pendingNetworkMobDeaths.has(11), false, "authoritative in-scope omission retires the presentation tombstone");
});

test("multiplayer diagnostics are bounded and redact names and full peer identifiers", () => {
  const diagnostics = new MultiplayerDiagnosticsRing(2);
  diagnostics.record({ requestId: "one", kind: "pickup", phase: "sent", peerId: "player_private_ABCDEFGHIJK" });
  diagnostics.record({ requestId: "one", kind: "pickup", phase: "response", peerId: "player_private_ABCDEFGHIJK", responseLatencyMs: 175.25 });
  diagnostics.record({ requestId: "two", kind: "container:click", phase: "rejected", peerId: "player_secret_123456789", rejectionCategory: "stale-revision" });
  const exported = diagnostics.export("guest", "connected", "blockwild-webrtc/2");
  assert.equal(exported.entryCount, 2);
  const serialized = JSON.stringify(exported);
  assert.doesNotMatch(serialized, /player_private|player_secret|ABCDEFGHIJK/u);
  assert.match(serialized, /23456789/u);
  assert.doesNotMatch(serialized, /name|invite|metadata/iu);
});
