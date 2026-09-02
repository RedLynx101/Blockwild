import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compareCanonicalUtf8R10,
  decodeRustDomainBundleR10,
  type RustDomainBundleR10,
  type RustDomainValueR10,
  type RustDomainValueTypeR10,
} from "../app/game/rust-authoritative-extraction-r10.ts";
import { encodeRustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-codec-r6.ts";
import type {
  RustEntityExtractionR6V3,
  RustEntityExtractionRecordR6V3,
} from "../app/game/rust-entity-authority-contract-r6.ts";
import type { RustIntegratedRuntimeExtractionV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import { rustIntegratedContainerViewKeyV1 } from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";
import {
  decodeRustLivePlayerViewR10,
  rustLivePlayerDeathRespawnLifecycleValidR10,
  rustLivePlayerEffectJournalContinuesR10,
  rustLivePlayerRespawnDiagnosticsR10,
  type RustLivePlayerEffectJournalR10,
} from "../app/game/rust-live-player-view-r10.ts";

const BWX0 = Uint8Array.from(Buffer.from(readFileSync(
  new URL("./fixtures/rust-engine/r10-authoritative-extraction/bound-world-view-bwx0-v1.hex", import.meta.url),
  "utf8",
).trim(), "hex"));
const ZERO = new Uint8Array(16);
const encoder = new TextEncoder();

class DomainWriter {
  readonly bytes: number[] = [];
  raw(value: Uint8Array | readonly number[]) { this.bytes.push(...value); return this; }
  u8(value: number) { this.bytes.push(value); return this; }
  u16(value: number) { this.bytes.push(value & 0xff, value >>> 8 & 0xff); return this; }
  u32(value: number) {
    this.bytes.push(value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff);
    return this;
  }
  u64(value: bigint | number) {
    let remaining = BigInt(value);
    for (let index = 0; index < 8; index += 1) {
      this.bytes.push(Number(remaining & BigInt(0xff)));
      remaining >>= BigInt(8);
    }
    return this;
  }
  f64(value: number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    return this.raw(bytes);
  }
  string(value: string) {
    const bytes = encoder.encode(value);
    return this.u32(bytes.byteLength).raw(bytes);
  }
  finish() { return Uint8Array.from(this.bytes); }
}

type MutableDomainRow = {
  kind: number;
  key: string;
  fields: Map<string, RustDomainValueR10>;
  types: Map<string, RustDomainValueTypeR10>;
};

function encodeDomainValue(value: RustDomainValueR10, type: RustDomainValueTypeR10) {
  const writer = new DomainWriter();
  if (type === "bool") return writer.u8(0).u8(value === true ? 1 : 0).finish();
  if (type === "u64") return writer.u8(1).u64(value as bigint).finish();
  if (type === "i64") return writer.u8(2).u64(BigInt.asUintN(64, value as bigint)).finish();
  if (type === "f64") return writer.u8(3).f64(value as number).finish();
  if (type === "string") return writer.u8(4).string(value as string).finish();
  if (type === "hash") return writer.u8(5).raw(value as Uint8Array).finish();
  return writer.u8(6).u32((value as Uint8Array).byteLength).raw(value as Uint8Array).finish();
}

function encodeDomainRow(row: MutableDomainRow) {
  const encoded = [...row.fields]
    .sort(([left], [right]) => compareCanonicalUtf8R10(left, right))
    .map(([name, value]) => {
      const type = row.types.get(name);
      assert.notEqual(type, undefined, `test row field '${name}' must retain its wire type`);
      return [name, encodeDomainValue(value, type!)] as const;
    });
  const revisionBytes = new TypeScriptCanonicalHasher("blockwild.r10.domain-row-revision.v1")
    .writeU16(row.kind).writeString(row.key).writeU16(encoded.length);
  for (const [name, value] of encoded) revisionBytes.writeString(name).writeBytes(value);
  const revisionHash = revisionBytes.finish();
  const revision = new DataView(
    revisionHash.buffer,
    revisionHash.byteOffset,
    8,
  ).getBigUint64(0, true);
  const writer = new DomainWriter().u16(row.kind).string(row.key).u64(revision).u16(encoded.length);
  for (const [name, value] of encoded) writer.string(name).raw(value);
  return writer.finish();
}

function reencodeDomainBundle(source: RustDomainBundleR10, rowsByDomain: readonly (readonly MutableDomainRow[])[]) {
  const writer = new DomainWriter().raw(encoder.encode("BWX0")).u16(1)
    .u64(source.extractionRevision).u64(source.authorityTick)
    .raw(source.stateHash).raw(source.contentManifestHash).u8(source.contentReady ? 1 : 0)
    .u16(source.views.length);
  source.views.forEach((view, index) => {
    const payloadWriter = new DomainWriter();
    for (const row of rowsByDomain[index]!) payloadWriter.raw(encodeDomainRow(row));
    const payload = payloadWriter.finish();
    const payloadHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-view-payload.v1")
      .writeBytes(payload).finish();
    const status = view.status === "complete" ? 0 : view.status === "partial" ? 1 : 2;
    writer.u8(view.domain).u16(1).u8(status).u64(view.revision)
      .u32(view.total).u32(view.selected).u32(view.omitted).u32(view.nextCursor)
      .u16(view.blockers.length);
    for (const blocker of view.blockers) writer.string(blocker);
    writer.u32(payload.byteLength).raw(payloadHash).raw(payload);
  });
  return writer.finish();
}

function mutatePlayerDomain(
  mutate: (rows: Readonly<{
    runtime: MutableDomainRow;
    binding: MutableDomainRow;
    combat: MutableDomainRow;
  }>) => void,
) {
  const decoded = decodeRustDomainBundleR10(BWX0);
  const rowsByDomain = decoded.views.map((view) => view.rows.map((row) => {
    assert.equal(row.fieldTypes?.length, row.fields.length);
    return {
      kind: row.kind,
      key: row.key,
      fields: new Map(row.fields.map(([name, value]) => [
        name,
        value instanceof Uint8Array ? Uint8Array.from(value) : value,
      ])),
      types: new Map(row.fields.map(([name], index) => [name, row.fieldTypes![index]!])),
    };
  }));
  const playerRows = rowsByDomain[decoded.views.findIndex((view) => view.domain === 2)]!;
  const combatRows = rowsByDomain[decoded.views.findIndex((view) => view.domain === 5)]!;
  const runtime = playerRows.find((row) => row.kind === 1 && row.key === "player:extraction")!;
  const binding = playerRows.find((row) => row.kind === 2)!;
  const combat = combatRows.find((row) => row.kind === 1 && row.key === "combatant:player:extraction")!;
  mutate({ runtime, binding, combat });
  return reencodeDomainBundle(decoded, rowsByDomain);
}

function setDomainField(
  row: MutableDomainRow,
  name: string,
  type: RustDomainValueTypeR10,
  value: RustDomainValueR10,
) {
  row.fields.set(name, value);
  row.types.set(name, type);
}

const DEATH_RESPAWN_PLAYER_ID = BigInt("18364758544493064720");
const DEATH_DROP_ID = `player-death-drop-v1:${DEATH_RESPAWN_PLAYER_ID}:1:0:0`;
const DEATH_DROP_ENTITY_ID = BigInt("18364758544493064721");

function fullDeathRespawnHud(
  mutate?: (rows: Readonly<{ runtime: MutableDomainRow; binding: MutableDomainRow }>) => void,
) {
  return mutatePlayerDomain(({ runtime, binding }) => {
    setDomainField(runtime, "deathSequence.present", "bool", true);
    setDomainField(runtime, "deathSequence.value", "u64", BigInt(1));
    setDomainField(runtime, "lastRespawnSequence.present", "bool", true);
    setDomainField(runtime, "lastRespawnSequence.value", "u64", BigInt(1));
    setDomainField(runtime, "latestDeathRespawn.present", "bool", true);
    setDomainField(runtime, "latestDeathRespawn.respawnSequence", "u64", BigInt(1));
    setDomainField(runtime, "latestDeathRespawn.receiptHash", "hash", Uint8Array.from({ length: 16 }, () => 0x12));
    setDomainField(runtime, "latestDeathRespawn.generatedDropCount", "u64", BigInt(1));
    setDomainField(binding, "playerId", "u64", DEATH_RESPAWN_PLAYER_ID);
    setDomainField(runtime, "latestDeathRespawn.playerId", "u64", DEATH_RESPAWN_PLAYER_ID);
    setDomainField(runtime, "latestDeathRespawn.entityId", "u64", BigInt("4294967297"));
    setDomainField(runtime, "latestDeathRespawn.deathSequence", "u64", BigInt(1));
    setDomainField(runtime, "latestDeathRespawn.inventoryContainer", "string",
      binding.fields.get("inventoryContainer")!);
    setDomainField(runtime, "latestDeathRespawn.inventoryBeforeRevision", "u64", BigInt(0));
    setDomainField(runtime, "latestDeathRespawn.inventoryAfterRevision", "u64", BigInt(1));
    setDomainField(runtime, "latestDeathRespawn.equipmentContainer", "string",
      binding.fields.get("equipmentContainer")!);
    setDomainField(runtime, "latestDeathRespawn.equipmentBeforeRevision", "u64", BigInt(0));
    setDomainField(runtime, "latestDeathRespawn.equipmentAfterRevision", "u64", BigInt(0));
    setDomainField(runtime, "latestDeathRespawn.custodyAfterHash", "hash",
      Uint8Array.from({ length: 16 }, () => 0x34));

    const prefix = "latestDeathRespawn.drop.0000";
    setDomainField(runtime, `${prefix}.sourceLane`, "u64", BigInt(0));
    setDomainField(runtime, `${prefix}.sourceSlot`, "u64", BigInt(0));
    setDomainField(runtime, `${prefix}.stack.itemCode`, "u64", BigInt(1));
    setDomainField(runtime, `${prefix}.stack.count`, "u64", BigInt(1));
    setDomainField(runtime, `${prefix}.stack.durability.present`, "bool", true);
    setDomainField(runtime, `${prefix}.stack.durability.value`, "u64", BigInt(750_000));
    setDomainField(runtime, `${prefix}.stack.metadataHash`, "hash", new Uint8Array(16));
    setDomainField(runtime, `${prefix}.dropId`, "string", DEATH_DROP_ID);
    setDomainField(runtime, `${prefix}.entityId`, "u64", DEATH_DROP_ENTITY_ID);
    setDomainField(runtime, `${prefix}.custodyContainer`, "string", rustIntegratedContainerViewKeyV1({
      kind: "container",
      id: `player-death-custody-v1:${DEATH_RESPAWN_PLAYER_ID}:1:inventory:0`,
      ownerId: null,
    }));
    setDomainField(runtime, `${prefix}.custodySlot`, "u64", BigInt(0));
    setDomainField(runtime, `${prefix}.custodyRevision`, "u64", BigInt(0));
    setDomainField(runtime, `${prefix}.spatialRevision`, "u64", BigInt(0));
    setDomainField(runtime, `${prefix}.position.xMilli`, "i64", BigInt(8_000));
    setDomainField(runtime, `${prefix}.position.yMilli`, "i64", BigInt(64_000));
    setDomainField(runtime, `${prefix}.position.zMilli`, "i64", BigInt(8_000));
    setDomainField(runtime, `${prefix}.velocity.xMilliPerSecond`, "i64", BigInt(0));
    setDomainField(runtime, `${prefix}.velocity.yMilliPerSecond`, "i64", BigInt(0));
    setDomainField(runtime, `${prefix}.velocity.zMilliPerSecond`, "i64", BigInt(0));
    setDomainField(runtime, `${prefix}.rotation.yaw`, "u64", BigInt(0));
    setDomainField(runtime, `${prefix}.rotation.pitch`, "u64", BigInt(0));
    setDomainField(runtime, `${prefix}.rotation.roll`, "u64", BigInt(0));
    setDomainField(runtime, `${prefix}.createdTick`, "u64", BigInt(0));
    setDomainField(runtime, `${prefix}.expiresTick.present`, "bool", false);
    setDomainField(runtime, `${prefix}.pickupLockActorId.present`, "bool", false);
    setDomainField(runtime, `${prefix}.pickupUnlockTick`, "u64", BigInt(7));
    setDomainField(runtime, `${prefix}.originHash`, "hash", Uint8Array.from({ length: 16 }, () => 0x56));
    setDomainField(runtime, `${prefix}.content.configuredManifestHash`, "hash",
      Uint8Array.from({ length: 16 }, () => 0x78));
    setDomainField(runtime, `${prefix}.content.installedManifestHash`, "hash",
      Uint8Array.from({ length: 16 }, () => 0x78));
    setDomainField(runtime, `${prefix}.content.installedRegistryHash`, "hash",
      Uint8Array.from({ length: 16 }, () => 0x9a));
    setDomainField(runtime, `${prefix}.content.itemContentHash`, "hash",
      Uint8Array.from({ length: 16 }, () => 0xbc));
    setDomainField(runtime, `${prefix}.content.itemContentVersion`, "u64", BigInt(1));
    mutate?.({ runtime, binding });
  });
}

function emptyAudio(authorityTick = BigInt(0)) {
  const bytes = new Uint8Array(4 + 2 + 8 + 4 + 4 + 4);
  bytes.set(new TextEncoder().encode("BWAU"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 2, true);
  view.setBigUint64(6, authorityTick, true);
  return bytes;
}

function effectJournal(firstSequence: bigint, count: number): RustLivePlayerEffectJournalR10 {
  const cues = Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
    sequence: firstSequence + BigInt(index),
    tick: BigInt(1),
    entityExternalId: "player:extraction",
    kind: "shore-exit" as const,
    amount: 0,
  })));
  return Object.freeze({
    schema: 1,
    producer: "rust-bwau-v2",
    playerExternalId: "player:extraction",
    authorityTick: BigInt(1),
    total: count,
    selected: count,
    omitted: 0,
    firstSequence: cues.at(0)?.sequence ?? null,
    lastSequence: cues.at(-1)?.sequence ?? null,
    contiguous: true,
    cues,
  });
}

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
    grounded: true,
    submerged: false,
    lastDamageTick: BigInt(0),
    action: Object.freeze({ key: "idle", phase: 0, startedTick: BigInt(0), endsTick: BigInt(0), target: null }),
    equipment: Object.freeze([]),
    mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
    research: Object.freeze([]),
    ...overrides,
  });
}

function extraction(
  entityRecords: readonly RustEntityExtractionRecordR6V3[],
  omitted = 0,
  hud: Uint8Array = BWX0,
): RustIntegratedRuntimeExtractionV1 {
  const entities: RustEntityExtractionR6V3 = Object.freeze({
    schema: 3,
    extractionRevision: BigInt(10),
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
      stateHash: "48333e062896d381c83a579e605472b4",
    }),
    extractionRevision: 10,
    render: encodeRustEntityExtractionR6V3(entities),
    hud,
    audio: emptyAudio(),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: "0".repeat(32),
  });
}

test("live player view joins exact Rust runtime, world-view, inventory, and entity authority", () => {
  const view = decodeRustLivePlayerViewR10(extraction([record()]), "player:extraction");
  assert.equal(view.extractionRevision, BigInt(10));
  assert.equal(view.authorityTick, BigInt(0));
  assert.equal(view.playerId, BigInt("12884901895"));
  assert.equal(view.entityId, BigInt("4294967297"));
  assert.equal(view.entityRevision, BigInt(1));
  assert.equal(view.actorId, "player:extraction");
  assert.match(view.inventoryContainer, /^container-key-v1\/[0-9a-f]+$/u);
  assert.notEqual(view.inventoryContainer, view.equipmentContainer);
  assert.equal(view.inventoryContainerRevision, BigInt(1));
  assert.equal(view.equipmentContainerRevision, BigInt(0));
  assert.equal(view.selectedSlot, 0);
  assert.equal(view.backSlot, 7);
  assert.equal(view.respawnAuthoritySchema, 1);
  assert.equal(view.gameplaySequence, BigInt(3));
  assert.equal(view.gameplayCombatRevision, BigInt(1));
  assert.equal(view.combat.combatantRevision, BigInt(0));
  assert.equal(view.deathSequence, null);
  assert.equal(view.lastRespawnSequence, null);
  assert.equal(view.queuedInputsEmpty, true);
  assert.equal(view.pendingContextCommandsEmpty, true);
  assert.equal(view.pendingMovementResultEmpty, true);
  assert.equal(view.miningStateEmpty, true);
  assert.equal(view.latestDeathRespawn, null);
  assert.deepEqual(rustLivePlayerRespawnDiagnosticsR10(view), {
    schema: 1,
    gameplaySequence: "3",
    gameplayCombatRevision: "1",
    combatantRevision: "0",
    deathSequence: null,
    lastRespawnSequence: null,
    queuedInputsEmpty: true,
    pendingContextCommandsEmpty: true,
    pendingMovementResultEmpty: true,
    miningStateEmpty: true,
    latestDeathRespawn: null,
  });
  assert.equal(view.lastInputSequence, BigInt(0));
  assert.equal(view.authoritativeFlags, 0);
  assert.equal(view.lookYaw, null);
  assert.equal(view.lookPitch, 0);
  assert.deepEqual(view.position, { x: 8, y: 64, z: 8 });
  assert.deepEqual(view.velocity, { x: 0, y: 0, z: 0 });
  assert.equal(view.grounded, true);
  assert.equal(view.health, 20);
  assert.deepEqual(view.effects, {
    schema: 1,
    producer: "rust-bwau-v2",
    playerExternalId: "player:extraction",
    authorityTick: BigInt(0),
    total: 0,
    selected: 0,
    omitted: 0,
    firstSequence: null,
    lastSequence: null,
    contiguous: true,
    cues: [],
  });
  assert.equal(view.held, null);
});

test("live player view decodes one full retained false-policy parent after its exact hot child advances", () => {
  const drop = record({
    entityId: DEATH_DROP_ENTITY_ID,
    // R6 revisions and transforms advance independently from the immutable
    // WorldView spatial genesis retained by the parent receipt.
    entityRevision: BigInt(2),
    externalEntityId: DEATH_DROP_ID,
    specimenId: DEATH_DROP_ID,
    class: "construct",
    kindKey: "dropped-item",
    name: null,
    position: Object.freeze({ x: 8.125, y: 63.5, z: 8.25 }),
    velocity: Object.freeze({ x: 0.125, y: -0.5, z: 0.25 }),
  });
  const view = decodeRustLivePlayerViewR10(
    extraction([record(), drop], 0, fullDeathRespawnHud()),
    "player:extraction",
  );
  assert.equal(view.deathSequence, BigInt(1));
  assert.equal(view.lastRespawnSequence, BigInt(1));
  const parent = view.latestDeathRespawn!;
  assert.equal(parent.respawnSequence, BigInt(1));
  assert.equal(parent.receiptHash, "12".repeat(16));
  assert.equal(parent.generatedDropCount, 1);
  assert.equal(parent.inventoryContainer, view.inventoryContainer);
  assert.equal(parent.equipmentContainer, view.equipmentContainer);
  assert.equal(parent.drops.length, 1);
  assert.deepEqual(parent.drops[0], {
    parentRespawnSequence: BigInt(1),
    parentReceiptHash: "12".repeat(16),
    sourceLane: "inventory",
    sourceSlot: 0,
    stack: { itemCode: 1, count: 1, durabilityMillionths: 750_000, metadataHash: "0".repeat(32) },
    dropId: DEATH_DROP_ID,
    entityId: DEATH_DROP_ENTITY_ID,
    custodyContainer: rustIntegratedContainerViewKeyV1({
      kind: "container",
      id: `player-death-custody-v1:${DEATH_RESPAWN_PLAYER_ID}:1:inventory:0`,
      ownerId: null,
    }),
    custodySlot: 0,
    custodyRevision: BigInt(0),
    spatialRevision: BigInt(0),
    position: { xMilli: 8_000, yMilli: 64_000, zMilli: 8_000 },
    velocityMilliPerSecond: { xMilli: 0, yMilli: 0, zMilli: 0 },
    rotation: { yaw: 0, pitch: 0, roll: 0 },
    createdTick: BigInt(0),
    expiresTick: null,
    pickupLockActorId: null,
    pickupUnlockTick: BigInt(7),
    originHash: "56".repeat(16),
    content: {
      configuredManifestHash: "78".repeat(16),
      installedManifestHash: "78".repeat(16),
      installedRegistryHash: "9a".repeat(16),
      itemContentHash: "bc".repeat(16),
      itemContentVersion: 1,
    },
    r6Linked: true,
  });
  const diagnostic = rustLivePlayerRespawnDiagnosticsR10(view)!;
  const diagnosticJson = JSON.stringify(diagnostic);
  assert.doesNotMatch(diagnosticJson, /BigInt/u);
  assert.equal(diagnostic.deathSequence, "1");
  assert.equal(diagnostic.lastRespawnSequence, "1");
  assert.equal(diagnostic.latestDeathRespawn?.respawnSequence, "1");
  assert.equal(diagnostic.latestDeathRespawn?.playerId, DEATH_RESPAWN_PLAYER_ID.toString(10));
  assert.equal(diagnostic.latestDeathRespawn?.entityId, "4294967297");
  assert.equal(diagnostic.latestDeathRespawn?.drops[0]?.parentRespawnSequence, "1");
  assert.equal(diagnostic.latestDeathRespawn?.drops[0]?.entityId, DEATH_DROP_ENTITY_ID.toString(10));
  assert.equal(diagnostic.latestDeathRespawn?.drops[0]?.createdTick, "0");
  assert.equal(diagnostic.latestDeathRespawn?.drops[0]?.expiresTick, null);
  assert.equal(diagnostic.latestDeathRespawn?.drops[0]?.pickupUnlockTick, "7");
  assert.deepEqual(diagnostic.latestDeathRespawn?.drops[0]?.position,
    { xMilli: 8_000, yMilli: 64_000, zMilli: 8_000 });
  assert.deepEqual(diagnostic.latestDeathRespawn?.drops[0]?.velocityMilliPerSecond,
    { xMilli: 0, yMilli: 0, zMilli: 0 });
  assert.equal(Object.isFrozen(diagnostic), true);
  assert.equal(Object.isFrozen(diagnostic.latestDeathRespawn), true);
  assert.equal(Object.isFrozen(diagnostic.latestDeathRespawn?.drops), true);
  assert.equal(Object.isFrozen(diagnostic.latestDeathRespawn?.drops[0]), true);
  assert.equal(Object.isFrozen(diagnostic.latestDeathRespawn?.drops[0]?.stack), true);
  assert.equal(Object.isFrozen(diagnostic.latestDeathRespawn?.drops[0]?.content), true);
  assert.equal(rustLivePlayerRespawnDiagnosticsR10({ ...view, respawnAuthoritySchema: 0 }), null);

  const wrongCustodyId = fullDeathRespawnHud(({ runtime }) => {
    setDomainField(runtime, "latestDeathRespawn.drop.0000.custodyContainer", "string",
      rustIntegratedContainerViewKeyV1({ kind: "container", id: "wrong", ownerId: null }));
  });
  assert.throws(
    () => decodeRustLivePlayerViewR10(extraction([record(), drop], 0, wrongCustodyId), "player:extraction"),
    /identity or custody container is invalid/u,
  );

  const oversizedStack = fullDeathRespawnHud(({ runtime }) => {
    setDomainField(runtime, "latestDeathRespawn.drop.0000.stack.count", "u64", BigInt(0x8000_0000));
  });
  assert.throws(
    () => decodeRustLivePlayerViewR10(extraction([record(), drop], 0, oversizedStack), "player:extraction"),
    /native stack bound/u,
  );

  const wrongPickupDelay = fullDeathRespawnHud(({ runtime }) => {
    setDomainField(runtime, "latestDeathRespawn.drop.0000.pickupUnlockTick", "u64", BigInt(8));
  });
  assert.throws(
    () => decodeRustLivePlayerViewR10(extraction([record(), drop], 0, wrongPickupDelay), "player:extraction"),
    /lifetime or pickup lock is invalid/u,
  );

  const wrongStableIdentity = record({ ...drop, specimenId: `${DEATH_DROP_ID}:wrong` });
  assert.throws(
    () => decodeRustLivePlayerViewR10(
      extraction([record(), wrongStableIdentity], 0, fullDeathRespawnHud()),
      "player:extraction",
    ),
    /disagrees with its exact BWR6 entity/u,
  );

  const impossibleR6Genesis = record({ ...drop, entityRevision: BigInt(0) });
  assert.throws(
    () => decodeRustLivePlayerViewR10(
      extraction([record(), impossibleR6Genesis], 0, fullDeathRespawnHud()),
      "player:extraction",
    ),
    /disagrees with its exact BWR6 entity/u,
  );

  const impossibleColdChild = record({ ...drop, residency: "cold" });
  assert.throws(
    () => decodeRustLivePlayerViewR10(
      extraction([record(), impossibleColdChild], 0, fullDeathRespawnHud()),
      "player:extraction",
    ),
    /disagrees with its exact BWR6 entity/u,
  );
});

test("live player death and respawn marker lifecycle rejects every impossible state", () => {
  assert.equal(rustLivePlayerDeathRespawnLifecycleValidR10(true, null, null), true);
  assert.equal(rustLivePlayerDeathRespawnLifecycleValidR10(false, BigInt(1), null), true);
  assert.equal(rustLivePlayerDeathRespawnLifecycleValidR10(false, BigInt(2), BigInt(1)), true);
  assert.equal(rustLivePlayerDeathRespawnLifecycleValidR10(true, BigInt(2), BigInt(2)), true);
  assert.equal(rustLivePlayerDeathRespawnLifecycleValidR10(true, null, BigInt(1)), false);
  assert.equal(rustLivePlayerDeathRespawnLifecycleValidR10(true, BigInt(2), null), false);
  assert.equal(rustLivePlayerDeathRespawnLifecycleValidR10(true, BigInt(2), BigInt(1)), false);
  assert.equal(rustLivePlayerDeathRespawnLifecycleValidR10(false, null, null), false);
  assert.equal(rustLivePlayerDeathRespawnLifecycleValidR10(false, BigInt(1), BigInt(1)), false);
  assert.equal(rustLivePlayerDeathRespawnLifecycleValidR10(false, BigInt(1), BigInt(2)), false);
});

test("live player decoder rejects noncanonical or partial native respawn authority fields", () => {
  const decode = (hud: Uint8Array) => decodeRustLivePlayerViewR10(extraction([record()], 0, hud), "player:extraction");
  const liveWithUnconsumedDeath = mutatePlayerDomain(({ runtime }) => {
    runtime.fields.set("deathSequence.present", true);
    runtime.fields.set("deathSequence.value", BigInt(1));
    runtime.types.set("deathSequence.value", "u64");
  });
  assert.throws(() => decode(liveWithUnconsumedDeath), /sequence lifecycle contradicts/u);

  const respawnWithoutDeath = mutatePlayerDomain(({ runtime }) => {
    runtime.fields.set("lastRespawnSequence.present", true);
    runtime.fields.set("lastRespawnSequence.value", BigInt(1));
    runtime.types.set("lastRespawnSequence.value", "u64");
  });
  assert.throws(() => decode(respawnWithoutDeath), /sequence lifecycle contradicts/u);

  const zeroDeathSequence = mutatePlayerDomain(({ runtime }) => {
    runtime.fields.set("deathSequence.present", true);
    runtime.fields.set("deathSequence.value", BigInt(0));
    runtime.types.set("deathSequence.value", "u64");
  });
  assert.throws(() => decode(zeroDeathSequence), /canonical browser authority range/u);

  const missingReadiness = mutatePlayerDomain(({ runtime }) => {
    runtime.fields.delete("pendingMovementResultEmpty");
  });
  assert.throws(() => decode(missingReadiness), /pendingMovementResultEmpty.*wrong wire type/u);

  const wrongReadinessWireType = mutatePlayerDomain(({ runtime }) => {
    runtime.fields.set("queuedInputsEmpty", BigInt(1));
    runtime.types.set("queuedInputsEmpty", "u64");
  });
  assert.throws(() => decode(wrongReadinessWireType), /queuedInputsEmpty.*wrong wire type/u);

  const absentParentWithTrailingField = mutatePlayerDomain(({ runtime }) => {
    runtime.fields.set("latestDeathRespawn.respawnSequence", BigInt(1));
    runtime.types.set("latestDeathRespawn.respawnSequence", "u64");
  });
  assert.throws(() => decode(absentParentWithTrailingField), /absent latest death-respawn parent retains child fields/u);

  const missingCombatantCursor = mutatePlayerDomain(({ combat }) => {
    combat.fields.delete("combatantRevision");
  });
  assert.throws(() => decode(missingCombatantCursor), /explicit native combatant revision/u);
});

test("live player view rejects divergent or incomplete authority instead of selecting a source", () => {
  assert.throws(
    () => decodeRustLivePlayerViewR10(extraction([record({ position: Object.freeze({ x: 9, y: 64, z: 8 }) })]), "player:extraction"),
    /positions disagree/u,
  );
  const ungroundedRuntime = mutatePlayerDomain(({ runtime }) => {
    setDomainField(runtime, "grounded", "bool", false);
  });
  assert.throws(
    () => decodeRustLivePlayerViewR10(extraction([record()], 0, ungroundedRuntime), "player:extraction"),
    /runtime and BWR6 grounded states disagree/u,
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
  assert.throws(
    () => decodeRustLivePlayerViewR10(Object.freeze({ ...extraction([record()]), audio: new Uint8Array() }), "player:extraction"),
    /same-envelope BWAU effect journal/u,
  );

  const previous = effectJournal(BigInt(100), 1);
  const empty = effectJournal(BigInt(1), 0);
  assert.equal(rustLivePlayerEffectJournalContinuesR10(empty, empty), true,
    "an accepted empty journal may remain empty");
  assert.equal(rustLivePlayerEffectJournalContinuesR10(empty, effectJournal(BigInt(1), 1)), true,
    "the first cue after an accepted empty journal begins at sequence one");
  assert.equal(rustLivePlayerEffectJournalContinuesR10(empty, effectJournal(BigInt(2), 1)), false,
    "an accepted empty journal cannot skip the first native cue");
  assert.equal(rustLivePlayerEffectJournalContinuesR10(previous, effectJournal(BigInt(101), 256)), true,
    "an exact full ring may roll to the immediate successor without overlap");
  assert.equal(rustLivePlayerEffectJournalContinuesR10(previous, effectJournal(BigInt(101), 255)), false,
    "a truncated successor journal cannot excuse missing overlap");
  assert.equal(rustLivePlayerEffectJournalContinuesR10(previous, effectJournal(BigInt(102), 256)), false,
    "a full journal cannot skip the immediate successor");
  const overlappingPrevious = effectJournal(BigInt(100), 3);
  const honestOverlap = effectJournal(BigInt(100), 4);
  assert.equal(rustLivePlayerEffectJournalContinuesR10(overlappingPrevious, honestOverlap), true,
    "an under-capacity append retains its accepted prefix and shared payloads");
  assert.equal(rustLivePlayerEffectJournalContinuesR10(
    effectJournal(BigInt(100), 256),
    effectJournal(BigInt(101), 256),
  ), true, "an exact full ring may roll its prefix while preserving every overlapping cue");
  assert.equal(rustLivePlayerEffectJournalContinuesR10(
    effectJournal(BigInt(100), 5),
    effectJournal(BigInt(104), 2),
  ), false, "an under-capacity overlap cannot silently discard an accepted prefix");
  const rewrittenOverlap = Object.freeze({
    ...honestOverlap,
    cues: Object.freeze(honestOverlap.cues.map((cue, index) => (
      index === 0 ? Object.freeze({ ...cue, amount: 1 }) : cue
    ))),
  });
  assert.equal(rustLivePlayerEffectJournalContinuesR10(overlappingPrevious, rewrittenOverlap), false,
    "an overlapping journal cannot rewrite an accepted cue payload");
  assert.equal(rustLivePlayerEffectJournalContinuesR10(overlappingPrevious, effectJournal(BigInt(99), 4)), false,
    "a later journal cannot move its bounded ring start backward");
});
