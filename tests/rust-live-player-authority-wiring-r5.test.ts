import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";

import { createCharacterProfile } from "../app/game/character-profiles.ts";
import { Item } from "../app/game/data.ts";
import { VoxelEngine, type WorldSave } from "../app/game/engine.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import {
  RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeBasicDirtActionQueryV1,
  encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1,
} from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeNativeBlockEditQueryV1,
  encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1,
} from "../app/game/rust-integrated-runtime-native-block-edit.ts";
import {
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeDropPickupQueryV1,
  encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1,
} from "../app/game/rust-integrated-runtime-drop-pickup.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeNativePlayerDropQueryV1,
  encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1,
} from "../app/game/rust-integrated-runtime-player-drop.ts";
import { encodeRustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-codec-r6.ts";
import type {
  RustEntityExtractionR6V3,
  RustEntityExtractionRecordR6V3,
} from "../app/game/rust-entity-authority-contract-r6.ts";
import type {
  RustIntegratedRuntimeAcceptedReceiptV1,
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeCommandReceiptV1,
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeInputFrameV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RUST_RUNTIME_INPUT_BUTTON_V1,
  RUST_RUNTIME_INPUT_FLAG_V1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RUST_INTEGRATED_PLAYER_GAME_MODE_SET_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_GAME_MODE_SET_TYPE_V1,
  decodeRustIntegratedPlayerGameModeSetV1,
  encodeRustIntegratedPlayerGameModeSetReceiptV1,
  rustIntegratedPlayerGameModeSetReceiptHashV1,
} from "../app/game/rust-integrated-runtime-player-game-mode.ts";
import {
  decodeRustIntegratedTerrainResidencyReconcileRequestV2,
  encodeRustIntegratedTerrainResidencyReconcileReceiptV2,
  RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_RECEIPT_TYPE_V2,
  RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
} from "../app/game/rust-integrated-runtime-terrain-residency.ts";
import {
  createRustPlayerBootstrapNewWorldCompatibilityV1,
} from "../app/game/rust-player-bootstrap-compatibility.ts";
import {
  encodeRustIntegratedPlayerBootstrapStatusReceiptV1,
  RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
} from "../app/game/rust-integrated-runtime-player-status.ts";
import {
  encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1,
  RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1,
} from "../app/game/rust-integrated-runtime-player-combat-status.ts";
import type { RustIntegratedRuntimeServiceV1 } from "../app/game/rust-integrated-runtime-service.ts";
import {
  RUST_CONTEXT_COMMAND_CONTINUITY_RECEIPT_TYPE_V2,
  RUST_CONTEXT_COMMAND_CONTINUITY_TYPE_V2,
  decodeRustIntegratedRuntimeContextContinuityQueryV2,
  encodeRustIntegratedRuntimeContextContinuityReceiptV2,
} from "../app/game/rust-integrated-runtime-context-continuity-v2.ts";
import type { RustWorldRuntimeHostConfigV1 } from "../app/game/rust-world-runtime-host.ts";
import type { RustWorldRuntimeManagedHostV1 } from "../app/game/rust-world-runtime-manager.ts";
import { canonicalRustTerrainGenerationOptionsJsonV1 } from "../app/game/rust-world-runtime-live-config.ts";
import { RUST_LIVE_INPUT_AXIS_DIVISOR_R5 } from "../app/game/rust-live-input-pump-r5.ts";
import {
  rustIntegratedCameraStateHashR10,
  type RustIntegratedCameraProfileR10,
} from "../app/game/rust-integrated-runtime-camera-r10.ts";
import { rustLiveCameraPoseHashR10 } from "../app/game/rust-live-camera-view-r10.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";

const ZERO_HASH = "0".repeat(32);
const ZERO_BYTES = new Uint8Array(16);
const CONTENT_HASH = "c".repeat(32);
const CONTENT_BYTES = hashBytes(CONTENT_HASH);
const PLAYER_ENTITY_ID = BigInt("4294967297");
const encoder = new TextEncoder();
const READY_CAPABILITIES = Object.freeze([
  "awaited-receipts-v1",
  "basic-dirt-action-receipt-v1",
  "bounded-extraction-v1",
  "content-bundle-install-v1",
  "entity-compatibility-bridge-v1",
  "fixed-step-input-v1",
  "gameplay-command-v1",
  "creative-inventory-slot-v1",
  "player-game-mode-set-v1",
  "integrated-runtime-v1",
  "native-block-edit-receipt-v1",
  "native-drop-pickup-receipt-v1",
  "native-player-drop-receipt-v1",
  "player-respawn-v1",
  "terrain-residency-reconcile-v2",
]);

function hashBytes(value: string) {
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function emptyAudioExtraction(authorityTick: number | bigint) {
  const bytes = new Uint8Array(4 + 2 + 8 + 4 + 4 + 4);
  bytes.set(encoder.encode("BWAU"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 2, true);
  view.setBigUint64(6, BigInt(authorityTick), true);
  return bytes;
}

function acceptedReceiptHash(
  commandHash: string,
  before: RustIntegratedRuntimeIdentityV1,
  after: RustIntegratedRuntimeIdentityV1,
  responses: readonly Readonly<{ payloadHash: string }>[],
) {
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
    ...hashBytes(commandHash),
    ...hashBytes(before.stateHash),
    ...hashBytes(after.stateHash),
    ...responses.flatMap((response) => [...hashBytes(response.payloadHash)]),
  ]));
}

class Writer {
  readonly bytes: number[] = [];
  raw(value: Uint8Array | readonly number[]) { this.bytes.push(...value); return this; }
  u8(value: number) { this.bytes.push(value); return this; }
  u16(value: number) { this.bytes.push(value & 0xff, value >>> 8 & 0xff); return this; }
  u32(value: number) {
    this.bytes.push(value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff);
    return this;
  }
  u64(value: bigint | number) {
    let checked = BigInt(value);
    for (let index = 0; index < 8; index += 1) {
      this.bytes.push(Number(checked & BigInt(0xff)));
      checked >>= BigInt(8);
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

type DomainField = readonly [name: string, value: Uint8Array];

const u64Field = (value: bigint | number) => new Writer().u8(1).u64(value).finish();
const i64Field = (value: bigint | number) => new Writer().u8(2).u64(BigInt.asUintN(64, BigInt(value))).finish();
const f64Field = (value: number) => new Writer().u8(3).f64(value).finish();
const stringField = (value: string) => new Writer().u8(4).string(value).finish();
const boolField = (value: boolean) => new Writer().u8(0).u8(value ? 1 : 0).finish();
const hashField = (value: string) => new Writer().u8(5).raw(Uint8Array.from(
  value.match(/../gu)!.map((part) => Number.parseInt(part, 16)),
)).finish();
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function domainRow(kind: number, key: string, unorderedFields: readonly DomainField[]) {
  const fields = [...unorderedFields].sort((left, right) => compareText(left[0], right[0]));
  const revisionHasher = new TypeScriptCanonicalHasher("blockwild.r10.domain-row-revision.v1")
    .writeU16(kind).writeString(key).writeU16(fields.length);
  for (const [name, value] of fields) revisionHasher.writeString(name).writeBytes(value);
  const revisionBytes = revisionHasher.finish();
  const revision = new DataView(revisionBytes.buffer, revisionBytes.byteOffset, 8).getBigUint64(0, true);
  const writer = new Writer().u16(kind).string(key).u64(revision).u16(fields.length);
  for (const [name, value] of fields) writer.string(name).raw(value);
  return writer.finish();
}

type PlayerExtractionState = {
  extractionRevision: number;
  entityRevision: bigint;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  grounded: boolean;
  crouching: boolean;
  contactFlags: number;
  drowningAccumulator: number;
  fallDistance: number;
  oxygenSeconds: number;
  maximumOxygenSeconds: number;
  health: number;
  maximumHealth: number;
  submerged: boolean;
  lastDamageTick: bigint;
  lastInputSequence: bigint;
  buttons: number;
  flags: number;
  selectedSlot: number;
  lookYaw: number | null;
  lookPitch: number;
};

const CAMERA_PROFILE: RustIntegratedCameraProfileR10 = Object.freeze({
  eyeHeight: 1.62,
  thirdPersonTargetHeight: 1.34,
  thirdPersonDistance: 4.35,
  thirdPersonPitchScale: 0.72,
  rearShoulderOffset: 0.22,
  collisionRadius: 0.18,
  collisionPadding: 0.16,
  minimumDistance: 0.28,
  baseVerticalFovRadians: Math.PI * 0.4,
  aimVerticalFovRadians: Math.PI * 0.272,
  near: 0.05,
  far: 512,
});

function playerDomainBundle(
  state: Readonly<PlayerExtractionState>,
  authorityTick: number,
  externalEntityId: string,
  actorId: string,
  playerId: bigint,
  entityId: bigint,
  view: RustIntegratedRuntimeExtractionViewV1,
  stateHash: string,
) {
  const runtimeFields: DomainField[] = [
    ["buttons", u64Field(state.buttons)],
    ["contactFlags", u64Field(state.contactFlags)],
    ["crouching", boolField(state.crouching)],
    ["drowningAccumulator", f64Field(state.drowningAccumulator)],
    ["entityId", u64Field(entityId)],
    ["fallDistance", f64Field(state.fallDistance)],
    ["flags", u64Field(state.flags)],
    ["grounded", boolField(state.grounded)],
    ["gameplayCombatRevision", u64Field(1)],
    ["gameplaySequence", u64Field(1)],
    ["height", f64Field(1.8)],
    ["lastInputSequence", u64Field(state.lastInputSequence)],
    ["deathSequence.present", boolField(false)],
    ["lastRespawnSequence.present", boolField(false)],
    ["latestDeathRespawn.present", boolField(false)],
    ["lookPitch", i64Field(state.lookPitch)],
    ["mass", f64Field(1.15)],
    ["maximumOxygenSeconds", f64Field(state.maximumOxygenSeconds)],
    ["miningStateEmpty", boolField(true)],
    ["oxygenSeconds", f64Field(state.oxygenSeconds)],
    ["pendingContextCommandsEmpty", boolField(true)],
    ["pendingMovementResultEmpty", boolField(true)],
    ["position.x", f64Field(Math.fround(state.position.x))],
    ["position.y", f64Field(Math.fround(state.position.y))],
    ["position.z", f64Field(Math.fround(state.position.z))],
    ["queuedInputsEmpty", boolField(true)],
    ["radius", f64Field(0.3)],
    ["selectedSlot", u64Field(state.selectedSlot)],
    ["velocity.x", f64Field(Math.fround(state.velocity.x))],
    ["velocity.y", f64Field(Math.fround(state.velocity.y))],
    ["velocity.z", f64Field(Math.fround(state.velocity.z))],
  ];
  if (state.lookYaw !== null) {
    runtimeFields.push(["input.lookYaw", i64Field(state.lookYaw)]);
  }
  const inventoryContainer = "container-key-v1/00";
  const equipmentContainer = "container-key-v1/01";
  const cameraPosition = Object.freeze({
    x: Math.fround(state.position.x),
    y: Math.fround(state.position.y) + CAMERA_PROFILE.eyeHeight,
    z: Math.fround(state.position.z),
  });
  const cameraOrientation = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
  const cameraProjection = Object.freeze({
    verticalFovRadians: CAMERA_PROFILE.baseVerticalFovRadians,
    near: CAMERA_PROFILE.near,
    far: CAMERA_PROFILE.far,
  });
  const cameraRevision = BigInt(1);
  const cameraFields: DomainField[] = [
    ["actorId", stringField(actorId)],
    ["aiming", boolField(false)],
    ["cameraRevision", u64Field(cameraRevision)],
    ["cameraStateHash", hashField(rustIntegratedCameraStateHashR10(cameraRevision, "first", CAMERA_PROFILE))],
    ["collided", boolField(false)],
    ["entityId", u64Field(entityId)],
    ["externalEntityId", stringField(externalEntityId)],
    ["mode", stringField("first")],
    ["orientation.w", f64Field(cameraOrientation.w)],
    ["orientation.x", f64Field(cameraOrientation.x)],
    ["orientation.y", f64Field(cameraOrientation.y)],
    ["orientation.z", f64Field(cameraOrientation.z)],
    ["playerId", u64Field(playerId)],
    ["poseHash", hashField(rustLiveCameraPoseHashR10({
      mode: "first",
      aiming: false,
      position: cameraPosition,
      orientation: cameraOrientation,
      projection: cameraProjection,
      viewport: Object.freeze({ width: view.viewportWidth, height: view.viewportHeight }),
      collided: false,
      resolvedDistance: 0,
    }))],
    ["position.x", f64Field(cameraPosition.x)],
    ["position.y", f64Field(cameraPosition.y)],
    ["position.z", f64Field(cameraPosition.z)],
    ["profile.aimVerticalFovRadians", f64Field(CAMERA_PROFILE.aimVerticalFovRadians)],
    ["profile.baseVerticalFovRadians", f64Field(CAMERA_PROFILE.baseVerticalFovRadians)],
    ["profile.collisionPadding", f64Field(CAMERA_PROFILE.collisionPadding)],
    ["profile.collisionRadius", f64Field(CAMERA_PROFILE.collisionRadius)],
    ["profile.eyeHeight", f64Field(CAMERA_PROFILE.eyeHeight)],
    ["profile.far", f64Field(CAMERA_PROFILE.far)],
    ["profile.minimumDistance", f64Field(CAMERA_PROFILE.minimumDistance)],
    ["profile.near", f64Field(CAMERA_PROFILE.near)],
    ["profile.rearShoulderOffset", f64Field(CAMERA_PROFILE.rearShoulderOffset)],
    ["profile.thirdPersonDistance", f64Field(CAMERA_PROFILE.thirdPersonDistance)],
    ["profile.thirdPersonPitchScale", f64Field(CAMERA_PROFILE.thirdPersonPitchScale)],
    ["profile.thirdPersonTargetHeight", f64Field(CAMERA_PROFILE.thirdPersonTargetHeight)],
    ["projection.far", f64Field(cameraProjection.far)],
    ["projection.near", f64Field(cameraProjection.near)],
    ["projection.verticalFovRadians", f64Field(cameraProjection.verticalFovRadians)],
    ["resolvedDistance", f64Field(0)],
    ["viewRevision", u64Field(view.viewRevision)],
    ["viewport.height", u64Field(view.viewportHeight)],
    ["viewport.width", u64Field(view.viewportWidth)],
  ];
  const rows = new Writer()
    .raw(domainRow(1, externalEntityId, runtimeFields))
    .raw(domainRow(2, `binding:${playerId}`, [
      ["actorId", stringField(actorId)],
      ["backSlot.present", boolField(true)],
      ["backSlot.value", u64Field(7)],
      ["entityId", u64Field(entityId)],
      ["entityRevision", u64Field(state.entityRevision)],
      ["equipmentContainer", stringField(equipmentContainer)],
      ["equipmentContainerRevision", u64Field(0)],
      ["held.present", boolField(false)],
      ["inventoryContainer", stringField(inventoryContainer)],
      ["inventoryContainerRevision", u64Field(1)],
      ["playerId", u64Field(playerId)],
      ["selectedSlot", u64Field(state.selectedSlot)],
    ]))
    .raw(domainRow(3, "camera", cameraFields)).finish();
  const combatRows = domainRow(1, `combatant:${actorId}`, [
    ["alive", boolField(state.health > 0)],
    ["combatantRevision", u64Field(0)],
    ["crossDomainParity", boolField(true)],
    ["entityId", u64Field(entityId)],
    ["health", u64Field(Math.round(state.health * 1_000))],
    ["maxHealth", u64Field(Math.round(state.maximumHealth * 1_000))],
    ["ownerId.present", boolField(true)],
    ["ownerId.value", stringField(actorId)],
    ["vitalUnits", stringField("millihearts-v1")],
  ]);
  const writer = new Writer().raw(encoder.encode("BWX0")).u16(1)
    .u64(state.extractionRevision).u64(authorityTick).raw(hashBytes(stateHash)).raw(CONTENT_BYTES).u8(1).u16(8);
  for (let domain = 1; domain <= 8; domain += 1) {
    const payload = domain === 2 ? rows : domain === 5 ? combatRows : new Uint8Array();
    const count = domain === 2 ? 3 : domain === 5 ? 1 : 0;
    const payloadHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-view-payload.v1")
      .writeBytes(payload).finish();
    writer.u8(domain).u16(1).u8(0).u64(state.entityRevision)
      .u32(count).u32(count).u32(0).u32(count).u16(0)
      .u32(payload.byteLength).raw(payloadHash).raw(payload);
  }
  return writer.finish();
}

function profile() {
  return createCharacterProfile("live-authority-browser", {
    id: "live-authority-character",
    name: "Noah",
    createdAt: 1,
    updatedAt: 1,
  }, 1);
}

function config(): RustWorldRuntimeHostConfigV1 {
  return Object.freeze({
    worldSeed: "LIVE-AUTHORITY",
    universeId: "world:live-authority",
    locationId: "overworld",
    sessionId: "runtime.live-authority",
    catalogWorldId: "live-authority",
    generatorHash: "1".repeat(32),
    terrainContentHash: "2".repeat(32),
    generationOptionsJson: canonicalRustTerrainGenerationOptionsJsonV1(),
    waterBlockId: 7,
    directionalBlockIds: Object.freeze([]),
    waterloggedBlockIds: Object.freeze([]),
  });
}

function identity(overrides: Partial<RustIntegratedRuntimeIdentityV1> = {}): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "world:live-authority",
    locationId: "overworld",
    revision: Object.freeze({ epoch: 1, world: 0, entities: 1, gameplay: 1, persistence: 0, network: 0, simulation: 1 }),
    tick: 0,
    stateHash: "3".repeat(32),
    ...overrides,
  });
}

type CombatStatusMode = "exact" | "absent" | "legacy" | "blocked" | "vitals-drift";

class RestoredRuntimeService {
  current = identity();
  worldRevision = Object.freeze({ epoch: BigInt(1), mutation: BigInt(0), residency: BigInt(0) });
  nativeCreativeMode = false;
  nativeFlags = 0;
  rejectGameModeSet = false;
  readonly batches: RustIntegratedRuntimeCommandBatchV1[] = [];
  readonly submittedInputs: RustIntegratedRuntimeInputFrameV1[] = [];
  extractCalls = 0;
  private combatQueryCount = 0;
  readonly activeProfile = profile();
  readonly desired = createRustPlayerBootstrapNewWorldCompatibilityV1(this.activeProfile, Object.freeze({
    schema: 1 as const,
    kind: "new-world" as const,
    universeKey: "world:live-authority",
    locationKey: "overworld",
    commandActorId: "runtime:bootstrap",
    mode: "survival" as const,
    position: Object.freeze({ x: 8, y: 70.5, z: -8 }),
    yaw: 0,
    inventory: Object.freeze({
      slots: Object.freeze([{ item: Item.Berry, count: 3 }, ...Array.from({ length: 35 }, () => null)]),
      selectedSlot: 0,
      equipment: Object.freeze({ head: null, chest: null, legs: null, feet: null }),
      offhand: null,
      cursor: null,
      trash: null,
      craftGrid: Object.freeze(Array.from({ length: 9 }, () => null)),
    }),
  }));
  readonly presentation: PlayerExtractionState = {
    extractionRevision: 0,
    entityRevision: BigInt(1),
    position: { ...this.desired.intent.entity.position },
    velocity: { x: 0, y: 0, z: 0 },
    grounded: false,
    crouching: false,
    contactFlags: 0,
    drowningAccumulator: 0,
    fallDistance: 0,
    oxygenSeconds: 12,
    maximumOxygenSeconds: 12,
    health: 10,
    maximumHealth: 10,
    submerged: false,
    lastDamageTick: BigInt(0),
    lastInputSequence: BigInt(0),
    buttons: 0,
    flags: 0,
    selectedSlot: 0,
    lookYaw: null,
    lookPitch: 0,
  };

  constructor(private readonly combatModes: readonly CombatStatusMode[] = Object.freeze(["exact"])) {}

  diagnostics(): Readonly<{
    authoritative: boolean;
    contentReady: boolean;
    liveAuthorityReady: boolean;
    capabilities: readonly string[];
  }> {
    return Object.freeze({
      authoritative: true,
      contentReady: true,
      liveAuthorityReady: true,
      capabilities: READY_CAPABILITIES,
    });
  }

  identity() { return this.current; }

  private statusPayload(requestPayloadHash: string) {
    const actorId = this.desired.identity.actorId;
    const inventoryContainer = Object.freeze({ kind: "player" as const, id: actorId, ownerId: actorId });
    const equipmentContainer = Object.freeze({ kind: "equipment" as const, id: `${actorId}:equipment`, ownerId: actorId });
    const binding = Object.freeze({
      ...this.desired.intent.binding,
      externalEntityId: this.desired.identity.externalEntityId,
      playerId: this.desired.identity.playerId,
      creativeMode: this.nativeCreativeMode,
    });
    const inventorySlots = Object.freeze(this.desired.intent.inventory.slots.map((slot) => slot && Object.freeze({
      itemCode: slot.itemCode,
      count: slot.count,
      durabilityMillionths: slot.durabilityMillionths,
      metadataHash: slot.metadata?.hash ?? ZERO_HASH,
    })));
    return encodeRustIntegratedPlayerBootstrapStatusReceiptV1({
      requestPayloadHash,
      worldAuthorityRevision: this.worldRevision,
      entityAuthority: Object.freeze({ revision: BigInt(this.current.revision.entities), nextSequence: BigInt(2), tick: BigInt(this.current.tick) }),
      continuity: Object.freeze({
        lastMonotonicTimeUs: BigInt(0),
        lastInputSequence: null,
        nextInputSequence: BigInt(1),
        lastActionSequence: null,
        nextActionSequence: BigInt(1),
        authoritativeFlags: this.nativeFlags,
        lastAppliedInput: null,
        queuedInputsEmpty: true,
      }),
      entity: Object.freeze({
        entityId: PLAYER_ENTITY_ID,
        entityRevision: BigInt(1),
        residency: "hot" as const,
        record: Object.freeze({ ...this.desired.intent.entity, class: "player" as const, locationId: this.desired.identity.locationId }),
      }),
      runtimePlayer: Object.freeze({ entityId: PLAYER_ENTITY_ID, binding }),
      worldViewBinding: Object.freeze({
        playerId: this.desired.identity.playerId,
        revision: BigInt(1),
        actorId,
        entityId: PLAYER_ENTITY_ID,
        inventoryContainer,
        equipmentContainer,
        selectedSlot: 0,
        backSlot: 7,
      }),
      custody: Object.freeze({
        status: "present" as const,
        inventoryContainer,
        inventoryRevision: BigInt(1),
        inventorySlots,
        equipmentContainer,
        equipmentRevision: BigInt(0),
        equipmentSlots: Object.freeze(Array.from({ length: 8 }, () => null)),
        metadata: Object.freeze([]),
      }),
    });
  }

  private combatStatusPayload(requestPayloadHash: string, mode: CombatStatusMode) {
    const actorId = this.desired.identity.actorId;
    if (mode === "absent") {
      return encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1({
        requestPayloadHash,
        entityAuthorityRevision: BigInt(this.current.revision.entities),
        gameplaySequence: BigInt(0),
        gameplayCombatRevision: BigInt(0),
        gameplayStateHash: "6".repeat(32),
        status: "absent",
        blocker: null,
        combatant: null,
      });
    }
    const legacy = mode === "legacy";
    const blocked = mode === "blocked";
    return encodeRustIntegratedPlayerCombatBootstrapStatusReceiptV1({
      requestPayloadHash,
      entityAuthorityRevision: BigInt(this.current.revision.entities),
      gameplaySequence: BigInt(1),
      gameplayCombatRevision: BigInt(1),
      gameplayStateHash: "6".repeat(32),
      status: legacy ? "legacy-unlinked" : blocked ? "blocked" : "exact-linked",
      blocker: legacy
        ? "legacy-unlinked-requires-explicit-migration"
        : blocked
          ? "vital-parity-conflict"
          : null,
      combatant: Object.freeze({
        recordId: actorId,
        ownerId: actorId,
        revision: BigInt(0),
        entityId: legacy ? null : PLAYER_ENTITY_ID,
        vitalUnits: legacy ? "legacy-whole-hearts-v1" : "millihearts-v1",
        health: legacy
          ? Math.round(this.desired.intent.entity.health)
          : Math.round(this.desired.intent.entity.health * 1_000) - (mode === "vitals-drift" ? 1 : 0),
        maxHealth: legacy
          ? Math.round(this.desired.intent.entity.maximumHealth)
          : Math.round(this.desired.intent.entity.maximumHealth * 1_000),
        alive: this.desired.intent.entity.health > 0,
        crossDomainParity: !legacy && !blocked,
      }),
    });
  }

  async command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1> {
    this.batches.push(batch);
    const operation = batch.operations[0];
    const before = this.current;
    let responses;
    if (operation.typeId === RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1) {
      const combatOperation = batch.operations[1];
      assert.equal(combatOperation?.typeId, RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1);
      const combatMode = this.combatModes[Math.min(this.combatQueryCount, this.combatModes.length - 1)]!;
      this.combatQueryCount += 1;
      responses = Object.freeze([
        createRustIntegratedRuntimeDomainOperationV1({
          domain: "simulation",
          typeId: RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
          schema: 1,
          payload: this.statusPayload(operation.payloadHash),
        }),
        createRustIntegratedRuntimeDomainOperationV1({
          domain: "simulation",
          typeId: RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
          schema: 1,
          payload: this.combatStatusPayload(combatOperation.payloadHash, combatMode),
        }),
      ]);
    } else if (operation.typeId === RUST_INTEGRATED_PLAYER_GAME_MODE_SET_TYPE_V1) {
      const request = decodeRustIntegratedPlayerGameModeSetV1(operation.payload);
      assert.equal(operation.domain, "simulation");
      assert.equal(batch.actorId, request.actorId);
      assert.equal(request.externalEntityId, this.desired.identity.externalEntityId);
      assert.equal(request.actorId, this.desired.identity.actorId);
      assert.equal(request.playerId, this.desired.identity.playerId);
      if (this.rejectGameModeSet) {
        const code = "stale-player-game-mode";
        const message = "synthetic stale restored player mode";
        return Object.freeze({
          status: "rejected" as const,
          commandId: batch.commandId,
          idempotencyKey: batch.idempotencyKey,
          commandHash: batch.commandHash,
          code,
          message,
          current: before,
          receiptHash: rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
            ...hashBytes(batch.commandHash),
            ...hashBytes(before.stateHash),
            ...encoder.encode(code),
            ...encoder.encode(message),
          ])),
        });
      }
      assert.equal(request.expectedCreativeMode, this.nativeCreativeMode);
      assert.equal(request.expectedFlags, this.nativeFlags);
      const priorCreativeMode = this.nativeCreativeMode;
      const priorFlags = this.nativeFlags;
      const resultingFlags = request.requestedCreativeMode
        ? priorFlags | RUST_RUNTIME_INPUT_FLAG_V1.creative
        : priorFlags & ~(RUST_RUNTIME_INPUT_FLAG_V1.creative | RUST_RUNTIME_INPUT_FLAG_V1.flying);
      this.nativeCreativeMode = request.requestedCreativeMode;
      this.nativeFlags = resultingFlags;
      this.presentation.flags = resultingFlags;
      this.current = identity({
        revision: Object.freeze({
          ...before.revision,
          simulation: before.revision.simulation + 1,
        }),
        stateHash: "a".repeat(32),
      });
      const contents = Object.freeze({
        requestPayloadHash: operation.payloadHash,
        before,
        after: this.current,
        externalEntityId: request.externalEntityId,
        actorId: request.actorId,
        playerId: request.playerId,
        priorCreativeMode,
        priorFlags,
        resultingCreativeMode: this.nativeCreativeMode,
        resultingFlags,
      });
      const receipt = Object.freeze({
        ...contents,
        receiptHash: rustIntegratedPlayerGameModeSetReceiptHashV1(contents),
      });
      responses = Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
        domain: "simulation",
        typeId: RUST_INTEGRATED_PLAYER_GAME_MODE_SET_RECEIPT_TYPE_V1,
        schema: 1,
        payload: encodeRustIntegratedPlayerGameModeSetReceiptV1(receipt),
      })]);
    } else if (operation.typeId === RUST_CONTEXT_COMMAND_CONTINUITY_TYPE_V2) {
      assert.deepEqual(decodeRustIntegratedRuntimeContextContinuityQueryV2(operation.payload), { expected: before });
      responses = Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
        domain: "simulation",
        typeId: RUST_CONTEXT_COMMAND_CONTINUITY_RECEIPT_TYPE_V2,
        schema: 2,
        payload: encodeRustIntegratedRuntimeContextContinuityReceiptV2({
          requestPayloadHash: operation.payloadHash,
          identity: before,
          lastSequence: null,
          nextSequence: 1,
          queuedCommandsEmpty: true,
        }),
      })]);
    } else if (operation.typeId === RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2) {
      const request = decodeRustIntegratedTerrainResidencyReconcileRequestV2(operation.payload);
      this.worldRevision = Object.freeze({ ...request.expectedWorldRevision, residency: request.expectedWorldRevision.residency + BigInt(1) });
      this.current = identity({
        revision: Object.freeze({ ...before.revision, world: Number(this.worldRevision.mutation + this.worldRevision.residency) }),
        stateHash: "4".repeat(32),
      });
      responses = Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
        domain: "world",
        typeId: RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_RECEIPT_TYPE_V2,
        schema: 2,
        payload: encodeRustIntegratedTerrainResidencyReconcileReceiptV2({
          previousWorldRevision: request.expectedWorldRevision,
          worldRevision: this.worldRevision,
          desiredChunkCount: request.desiredChunks.length,
          generatedChunkCount: request.desiredChunks.length,
          retainedChunkCount: 0,
          evictedChunkCount: 0,
          residentSections: request.desiredChunks.length * 12,
          desiredChunks: request.desiredChunks,
          generatedChunks: request.desiredChunks,
          retainedChunks: Object.freeze([]),
          evictedChunks: Object.freeze([]),
          stateHash: this.current.stateHash,
        }),
      })]);
    } else if (operation.typeId === RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1) {
      const request = decodeRustIntegratedRuntimeNativeBlockEditQueryV1(operation.payload);
      assert.deepEqual(request.expected, before);
      const cursorAfter = request.afterSequence === RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1
        ? 0
        : request.afterSequence;
      responses = Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
        domain: "gameplay",
        typeId: RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1,
        schema: 1,
        payload: encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1({
          requestPayloadHash: operation.payloadHash,
          identity: before,
          cursorAfter,
          receipt: null,
        }, request.afterSequence),
      })]);
    } else if (operation.typeId === RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1) {
      const request = decodeRustIntegratedRuntimeBasicDirtActionQueryV1(operation.payload);
      assert.deepEqual(request.expected, before);
      const cursorAfter = request.afterSequence === RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1
        ? 0
        : request.afterSequence;
      responses = Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
        domain: "gameplay",
        typeId: RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1,
        schema: 1,
        payload: encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1({
          requestPayloadHash: operation.payloadHash,
          identity: before,
          cursorAfter,
          receipt: null,
        }, request.afterSequence),
      })]);
    } else if (operation.typeId === RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1) {
      const request = decodeRustIntegratedRuntimeDropPickupQueryV1(operation.payload);
      assert.deepEqual(request.expected, before);
      const cursorAfter = request.afterSequence === RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1
        ? 0
        : request.afterSequence;
      responses = Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
        domain: "gameplay",
        typeId: RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1,
        schema: 1,
        payload: encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
          requestPayloadHash: operation.payloadHash,
          identity: before,
          cursorAfter,
          receipt: null,
        }, request.afterSequence),
      })]);
    } else if (operation.typeId === RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1) {
      const request = decodeRustIntegratedRuntimeNativePlayerDropQueryV1(operation.payload);
      assert.deepEqual(request.expected, before);
      const cursorAfter = request.afterSequence === RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1
        ? 0
        : request.afterSequence;
      responses = Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
        domain: "gameplay",
        typeId: RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1,
        schema: 1,
        payload: encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
          requestPayloadHash: operation.payloadHash,
          identity: before,
          cursorAfter,
          receipt: null,
        }, request.afterSequence),
      })]);
    } else {
      throw new Error(`unexpected mutating bootstrap operation ${operation.typeId}`);
    }
    return Object.freeze({
      status: "accepted",
      commandId: batch.commandId,
      idempotencyKey: batch.idempotencyKey,
      commandHash: batch.commandHash,
      before,
      after: this.current,
      domainReceipts: responses,
      receiptHash: acceptedReceiptHash(batch.commandHash, before, this.current, responses),
    }) satisfies RustIntegratedRuntimeAcceptedReceiptV1;
  }

  async step(_monotonicTimeUs: number, _budgetUs: number, inputs: readonly RustIntegratedRuntimeInputFrameV1[]) {
    this.submittedInputs.push(...inputs);
    const input = inputs[0];
    if (input) {
      const moveX = input.moveX / RUST_LIVE_INPUT_AXIS_DIVISOR_R5;
      const moveZ = input.moveZ / RUST_LIVE_INPUT_AXIS_DIVISOR_R5;
      this.presentation.velocity = { x: moveX, y: 0, z: moveZ };
      this.presentation.position = {
        x: Math.fround(this.presentation.position.x + moveX),
        y: Math.fround(this.presentation.position.y),
        z: Math.fround(this.presentation.position.z + moveZ),
      };
      this.presentation.lastInputSequence = BigInt(input.sequence);
      this.presentation.buttons = input.buttons;
      this.presentation.flags = input.flags;
      this.presentation.selectedSlot = input.selectedSlot;
      this.presentation.lookYaw = input.lookYaw;
      this.presentation.lookPitch = input.lookPitch;
      this.presentation.grounded = true;
      this.presentation.crouching = (input.buttons & RUST_RUNTIME_INPUT_BUTTON_V1.crouch) !== 0;
      this.presentation.oxygenSeconds = Math.max(0, this.presentation.oxygenSeconds - 0.25);
      this.presentation.entityRevision += BigInt(1);
    }
    this.presentation.extractionRevision += 1;
    this.current = identity({
      revision: Object.freeze({
        ...this.current.revision,
        entities: this.current.revision.entities + 1,
        simulation: this.current.revision.simulation + 1,
      }),
      tick: this.current.tick + 1,
      stateHash: "5".repeat(32),
    });
    return Object.freeze({
      type: "runtime-step-result-v1" as const,
      requestId: 1,
      clientEpoch: 1,
      workerEpoch: 1,
      identity: this.current,
      fixedSteps: 1,
      inputsApplied: inputs.length,
      commandsProcessed: 0,
      commandsAccepted: 0,
      actionReceipts: Object.freeze([]),
      replayHash: ZERO_HASH,
    });
  }

  async extract(
    _afterRevision?: number,
    _maxBytes?: number,
    view?: RustIntegratedRuntimeExtractionViewV1,
  ): Promise<RustIntegratedRuntimeExtractionV1> {
    this.extractCalls += 1;
    if (!view) throw new Error("test runtime requires the engine drawing-buffer view");
    const actorId = this.desired.identity.actorId;
    const externalEntityId = this.desired.identity.externalEntityId;
    const entityId = PLAYER_ENTITY_ID;
    const record: RustEntityExtractionRecordR6V3 = Object.freeze({
      entityId,
      residency: "hot",
      class: "player",
      simulationTier: "hero",
      protection: BigInt(0),
      entityRevision: this.presentation.entityRevision,
      externalEntityId,
      specimenId: externalEntityId,
      kindKey: "player",
      variantKey: null,
      name: "Noah",
      modelKey: "player-standing",
      modelRevision: 0,
      modelHash: ZERO_BYTES,
      position: Object.freeze({
        x: Math.fround(this.presentation.position.x),
        y: Math.fround(this.presentation.position.y),
        z: Math.fround(this.presentation.position.z),
      }),
      yaw: Math.fround((this.presentation.lookYaw ?? 0) / RUST_LIVE_INPUT_AXIS_DIVISOR_R5 * Math.PI),
      velocity: Object.freeze({
        x: Math.fround(this.presentation.velocity.x),
        y: Math.fround(this.presentation.velocity.y),
        z: Math.fround(this.presentation.velocity.z),
      }),
      health: this.presentation.health,
      maximumHealth: this.presentation.maximumHealth,
      tamed: false,
      ageTicks: BigInt(0),
      movementMode: "ground",
      grounded: this.presentation.grounded,
      submerged: this.presentation.submerged,
      lastDamageTick: this.presentation.lastDamageTick,
      action: Object.freeze({ key: "idle", phase: 0, startedTick: BigInt(0), endsTick: BigInt(0), target: null }),
      equipment: Object.freeze([]),
      mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
      research: Object.freeze([]),
    });
    const entities: RustEntityExtractionR6V3 = Object.freeze({
      schema: 3,
      extractionRevision: BigInt(this.presentation.extractionRevision),
      authorityTick: BigInt(this.current.tick),
      contentManifestHash: CONTENT_BYTES,
      contentReady: true,
      total: 1,
      selected: 1,
      omitted: 0,
      records: Object.freeze([record]),
    });
    return Object.freeze({
      identity: this.current,
      extractionRevision: this.presentation.extractionRevision,
      render: encodeRustEntityExtractionR6V3(entities),
      hud: playerDomainBundle(
        this.presentation,
        this.current.tick,
        externalEntityId,
        actorId,
        this.desired.identity.playerId,
        entityId,
        view,
        this.current.stateHash,
      ),
      audio: emptyAudioExtraction(this.current.tick),
      platformRequests: new Uint8Array(),
      diagnostics: new Uint8Array(),
      extractionHash: this.presentation.extractionRevision.toString(16).padStart(32, "0"),
    });
  }
}

function host(service: RestoredRuntimeService): RustWorldRuntimeManagedHostV1 {
  const hostConfig = config();
  return {
    config: hostConfig,
    async start() {},
    async shutdown() {},
    multiplayerAuthority: () => ({
      runExclusiveMutation: async <T>(operation: () => Promise<T>) => operation(),
    }) as ReturnType<RustWorldRuntimeManagedHostV1["multiplayerAuthority"]>,
    authorityInterest: () => ({}) as ReturnType<RustWorldRuntimeManagedHostV1["authorityInterest"]>,
    runtimeAdapter: () => ({}) as ReturnType<RustWorldRuntimeManagedHostV1["runtimeAdapter"]>,
    runtimeService: () => service as unknown as RustIntegratedRuntimeServiceV1,
    nativePersistenceSession: () => null,
    diagnostics: () => Object.freeze({
      state: "ready" as const,
      artifactHash: "a".repeat(64),
      contentHash: "b".repeat(32),
      generatorHash: hostConfig.generatorHash,
      identity: service.identity(),
      adapter: Object.freeze({ authoritative: true, contentReady: true, contentManifestHash: "b".repeat(32) }),
      lastError: null,
    }),
  };
}

function engineHarness(service: RestoredRuntimeService) {
  const activeHost = host(service);
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const vector = (x: number, y: number, z: number) => ({
    x, y, z,
    set(nextX: number, nextY: number, nextZ: number) {
      this.x = nextX;
      this.y = nextY;
      this.z = nextZ;
      return this;
    },
  });
  Object.assign(engine, {
    activeCharacterProfile: service.activeProfile,
    rustRuntimeHost: activeHost,
    rustRuntimeTransitionGeneration: 7,
    rustRuntimeOperationsBlocked: true,
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "none",
    rustLivePlayerAuthorityGeneration: null,
    rustLivePlayerEntityId: null,
    rustLivePlayerTerrainChunkCount: 0,
    rustLivePlayerAuthorityLastError: null,
    rustLiveInputPump: null,
    rustLiveInputAdvance: null,
    rustBasicDirtActionProjection: null,
    rustNativeBlockEditProjection: Object.freeze({ schema: 1, cursor: 0, lastReceiptHash: null }),
    rustNativeBlockEditCheckpoint: null,
    rustNativeDropPickupProjection: Object.freeze({ schema: 1, cursor: 0, lastReceiptHash: null }),
    rustNativePlayerDropProjection: Object.freeze({ schema: 1, cursor: 0, lastReceiptHash: null }),
    rustNativePlayerDeathRespawnProjection: Object.freeze({ schema: 1, cursor: 0, lastReceiptHash: null }),
    rustLiveRendererExtractionQueue: [],
    rustLiveRenderRuntime: null,
    rustAuthorityOperations: new Set<Promise<unknown>>(),
    rustLivePlayerAttestationR10: null,
    rustLivePlayerPresentationViewR10: null,
    rustLivePlayerViewExtractionRevisionR10: null,
    rustLiveCameraPresentationViewR10: null,
    rustLiveCameraExtractionRevisionR10: null,
    rustDroppedHotTransformFrameR10: null,
    rustLiveRenderViewR10: null,
    rustLiveRenderViewRevisionR10: 0,
    rustLivePlayerInitialYawRadiansR10: null,
    rustLiveSelectedSlotIntentR5: null,
    rustLiveSelectedSlotIntentPendingR5: false,
    rustLiveLookIntentR5: null,
    rustLiveLookIntentPendingR5: false,
    position: vector(-20, -20, -20),
    velocity: vector(99, 99, 99),
    grounded: false,
    crouching: true,
    oxygenSeconds: 1,
    health: 1,
    creativeFlying: true,
    sprinting: false,
    selected: 8,
    drops: [],
    yaw: 1,
    pitch: 0.5,
    keys: new Set<string>(),
    mineHeld: false,
    miningProgress: 0,
    sprintLatched: false,
    rustSecondaryUseHeld: false,
    rustCreativeFlightTogglePulse: false,
    rustDropPulse: false,
    lookDeltaXThisFrame: 0,
    lookDeltaYThisFrame: 0,
    settings: { sensitivity: 0.0024 },
    canvas: { width: 1280, height: 720 },
    camera: new THREE.PerspectiveCamera(),
    cameraMode: "first",
    localPlayerModel: { group: new THREE.Group() },
    heldRoot: new THREE.Group(),
    offhandRoot: new THREE.Group(),
    titleMode: false,
    events: { onSelectedSlot: () => undefined },
    emitHud: () => undefined,
    running: true,
    paused: false,
    disposed: false,
  });
  return { engine, activeHost };
}

test("complete restored native player status is accepted without a browser inventory overwrite", async () => {
  const service = new RestoredRuntimeService();
  const { engine, activeHost } = engineHarness(service);
  await (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
    .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "load", save: null, host: activeHost });
  const state = engine as unknown as {
    rustLivePlayerAuthorityState: string;
    rustLivePlayerEntityId: bigint | null;
    rustLivePlayerTerrainChunkCount: number;
    rustLiveInputPump: { diagnostics(): Readonly<{ stepCalls: number }> } | null;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    grounded: boolean;
    crouching: boolean;
    oxygenSeconds: number;
    health: number;
    selected: number;
    yaw: number;
    pitch: number;
  };
  assert.equal(state.rustLivePlayerAuthorityState, "ready");
  assert.equal(state.rustLivePlayerEntityId, PLAYER_ENTITY_ID);
  assert.equal(state.rustLivePlayerTerrainChunkCount, 25);
  assert.equal(state.rustLiveInputPump?.diagnostics().stepCalls, 1);
  assert.equal(service.submittedInputs.length, 1);
  assert.equal(service.extractCalls, 1, "initial sync must have exactly one pump-owned extraction");
  assert.deepEqual(
    { x: state.position.x, y: state.position.y, z: state.position.z },
    service.presentation.position,
    "the accepted native extraction must move the browser presentation",
  );
  assert.deepEqual({ x: state.velocity.x, y: state.velocity.y, z: state.velocity.z }, service.presentation.velocity);
  assert.equal(state.grounded, true);
  assert.equal(state.crouching, false);
  assert.equal(state.oxygenSeconds, 11.75);
  assert.equal(state.health, 10, "native 10-heart health is mirrored without a unit conversion");
  assert.equal(state.selected, 0);
  assert.equal(state.yaw, 0);
  assert.equal(state.pitch, 0);
  assert.deepEqual(service.batches.flatMap((batch) => batch.operations.map((operation) => operation.typeId)), [
    RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
    RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1,
    RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
    RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
    RUST_INTEGRATED_PLAYER_COMBAT_BOOTSTRAP_STATUS_TYPE_V1,
    RUST_CONTEXT_COMMAND_CONTINUITY_TYPE_V2,
    RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1,
    RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1,
    RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1,
  ], "a complete restored native graph receives only attestation/tail reads, never BWI/BWF/entity-import overwrites");
  await (engine as unknown as { stopRustLivePlayerAuthorityR5(): Promise<void> }).stopRustLivePlayerAuthorityR5();
});

function installModePersistenceHarness(
  engine: VoxelEngine & Record<string, unknown>,
  activeHost: RustWorldRuntimeManagedHostV1,
  service: RestoredRuntimeService,
) {
  const nativeWorldId = "world:live-authority@overworld";
  let saves = 0;
  let platformOperations = 0;
  let lastCheckpointId: string | null = null;
  const session = Object.freeze({
    worldId: nativeWorldId,
    diagnostics: () => Object.freeze({
      worldId: nativeWorldId,
      state: "open" as const,
      saves,
      recoveries: 1,
      legacyMigrations: 0,
      legacyMigrationRetries: 0,
      parentFallbacks: 0,
      platformOperations,
      requestBytes: 0,
      responseBytes: 0,
      lastCheckpointId,
      lastError: null,
    }),
  });
  Object.assign(activeHost, {
    nativePersistenceSession: () => session,
  });
  const checkpoints: string[] = [];
  Object.assign(engine, {
    activeWorldId: "live-authority",
    rustNativePersistenceWorldId: "live-authority",
    worldStorage: {
      async saveNativeWorld(worldId: string) {
        assert.equal(worldId, "live-authority");
        saves += 1;
        const commits = 2;
        platformOperations += commits;
        lastCheckpointId = `checkpoint:mode:${saves}`;
        checkpoints.push(lastCheckpointId);
        const before = service.current;
        service.current = identity({
          revision: Object.freeze({
            ...before.revision,
            persistence: before.revision.persistence + commits,
          }),
          tick: before.tick,
          stateHash: "b".repeat(32),
        });
        return Object.freeze({
          ok: true as const,
          value: Object.freeze({
            worldId: nativeWorldId,
            saveId: `save:mode:${saves}`,
            checkpointId: lastCheckpointId,
            checkpointHash: "c".repeat(32),
            journalSequence: saves,
            records: 8,
            commits,
            requestBytes: 100,
            responseBytes: 200,
          }),
        });
      },
    },
  });
  return checkpoints;
}

test("restored Survival-to-Creative reconciliation is native, durable, and precedes terrain/input", async () => {
  const service = new RestoredRuntimeService();
  const { engine, activeHost } = engineHarness(service);
  const checkpoints = installModePersistenceHarness(engine, activeHost, service);
  await (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
    .activateRustLivePlayerAuthorityR5({
      generation: 7,
      kind: "load",
      save: { mode: "builder" } as WorldSave,
      host: activeHost,
    });

  const state = engine as unknown as {
    rustLivePlayerGameModeSetCalls: number;
    rustLivePlayerLastGameModeSet: Readonly<{
      schema: 1;
      priorMode: string;
      resultingMode: string;
      priorFlags: number;
      resultingFlags: number;
      identityBefore: Readonly<{ simulationRevision: number; stateHash: string }>;
      identityAfter: Readonly<{ simulationRevision: number; stateHash: string }>;
      checkpoint: Readonly<{
        checkpointId: string;
        commits: number;
        savesBefore: number;
        savesAfter: number;
        platformOperationsBefore: number;
        platformOperationsAfter: number;
        persistenceRevisionBefore: number;
        persistenceRevisionAfter: number;
      }>;
    }>;
    rustLivePlayerAuthorityState: string;
    rustLiveInputPump: { diagnostics(): Readonly<{ stepCalls: number }> } | null;
  };
  assert.equal(state.rustLivePlayerAuthorityState, "ready");
  assert.equal(state.rustLivePlayerGameModeSetCalls, 1);
  assert.equal(state.rustLivePlayerLastGameModeSet.schema, 1);
  assert.equal(state.rustLivePlayerLastGameModeSet.priorMode, "survival");
  assert.equal(state.rustLivePlayerLastGameModeSet.resultingMode, "builder");
  assert.equal(state.rustLivePlayerLastGameModeSet.priorFlags, 0);
  assert.equal(state.rustLivePlayerLastGameModeSet.resultingFlags, RUST_RUNTIME_INPUT_FLAG_V1.creative);
  assert.equal(
    state.rustLivePlayerLastGameModeSet.identityAfter.simulationRevision,
    state.rustLivePlayerLastGameModeSet.identityBefore.simulationRevision + 1,
  );
  assert.notEqual(
    state.rustLivePlayerLastGameModeSet.identityAfter.stateHash,
    state.rustLivePlayerLastGameModeSet.identityBefore.stateHash,
  );
  assert.deepEqual(checkpoints, ["checkpoint:mode:1"]);
  assert.deepEqual(state.rustLivePlayerLastGameModeSet.checkpoint, {
    checkpointId: "checkpoint:mode:1",
    checkpointHash: "c".repeat(32),
    commits: 2,
    savesBefore: 0,
    savesAfter: 1,
    platformOperationsBefore: 0,
    platformOperationsAfter: 2,
    persistenceRevisionBefore: 0,
    persistenceRevisionAfter: 2,
  });
  const operations = service.batches.flatMap((batch) => batch.operations.map((operation) => operation.typeId));
  assert.ok(operations.indexOf(RUST_INTEGRATED_PLAYER_GAME_MODE_SET_TYPE_V1)
    < operations.indexOf(RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2));
  assert.equal(state.rustLiveInputPump?.diagnostics().stepCalls, 1);
  assert.equal(service.nativeCreativeMode, true);
  assert.equal(service.nativeFlags, RUST_RUNTIME_INPUT_FLAG_V1.creative);
  await (engine as unknown as { stopRustLivePlayerAuthorityR5(): Promise<void> }).stopRustLivePlayerAuthorityR5();
});

test("restored Creative-to-Survival reconciliation clears native flight before checkpoint", async () => {
  const service = new RestoredRuntimeService();
  service.nativeCreativeMode = true;
  service.nativeFlags = RUST_RUNTIME_INPUT_FLAG_V1.creative | RUST_RUNTIME_INPUT_FLAG_V1.flying;
  service.presentation.flags = service.nativeFlags;
  const { engine, activeHost } = engineHarness(service);
  const checkpoints = installModePersistenceHarness(engine, activeHost, service);
  await (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
    .activateRustLivePlayerAuthorityR5({
      generation: 7,
      kind: "load",
      save: { mode: "survival" } as WorldSave,
      host: activeHost,
    });
  const state = engine as unknown as {
    rustLivePlayerGameModeSetCalls: number;
    rustLivePlayerLastGameModeSet: Readonly<{
      priorFlags: number;
      resultingFlags: number;
      priorMode: string;
      resultingMode: string;
    }>;
    creativeFlying: boolean;
  };
  assert.deepEqual(checkpoints, ["checkpoint:mode:1"]);
  assert.equal(state.rustLivePlayerGameModeSetCalls, 1);
  assert.equal(
    state.rustLivePlayerLastGameModeSet.priorFlags,
    RUST_RUNTIME_INPUT_FLAG_V1.creative | RUST_RUNTIME_INPUT_FLAG_V1.flying,
  );
  assert.equal(state.rustLivePlayerLastGameModeSet.resultingFlags, 0);
  assert.equal(state.rustLivePlayerLastGameModeSet.priorMode, "builder");
  assert.equal(state.rustLivePlayerLastGameModeSet.resultingMode, "survival");
  assert.equal(service.nativeCreativeMode, false);
  assert.equal(service.nativeFlags, 0);
  assert.equal(state.creativeFlying, false);
  await (engine as unknown as { stopRustLivePlayerAuthorityR5(): Promise<void> }).stopRustLivePlayerAuthorityR5();
});

test("same-mode restored loads do not mutate or checkpoint for reconciliation", async () => {
  const service = new RestoredRuntimeService();
  const { engine, activeHost } = engineHarness(service);
  await (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
    .activateRustLivePlayerAuthorityR5({
      generation: 7,
      kind: "load",
      save: { mode: "survival" } as WorldSave,
      host: activeHost,
    });
  const state = engine as unknown as {
    rustLivePlayerGameModeSetCalls: number;
    rustLivePlayerLastGameModeSet: unknown;
  };
  assert.equal(state.rustLivePlayerGameModeSetCalls, 0);
  assert.equal(state.rustLivePlayerLastGameModeSet, null);
  assert.equal(service.batches.some((batch) => batch.operations.some(
    (operation) => operation.typeId === RUST_INTEGRATED_PLAYER_GAME_MODE_SET_TYPE_V1,
  )), false);
  await (engine as unknown as { stopRustLivePlayerAuthorityR5(): Promise<void> }).stopRustLivePlayerAuthorityR5();
});

test("stale restored mode CAS fails closed before checkpoint, terrain, or input", async () => {
  const service = new RestoredRuntimeService();
  service.rejectGameModeSet = true;
  const { engine, activeHost } = engineHarness(service);
  const checkpoints = installModePersistenceHarness(engine, activeHost, service);
  await assert.rejects(
    (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
      .activateRustLivePlayerAuthorityR5({
        generation: 7,
        kind: "load",
        save: { mode: "builder" } as WorldSave,
        host: activeHost,
      }),
    /synthetic stale restored player mode/u,
  );
  assert.deepEqual(checkpoints, []);
  assert.equal(service.batches.some((batch) => batch.operations.some(
    (operation) => operation.typeId === RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
  )), false);
  assert.equal(service.submittedInputs.length, 0);
  const state = engine as unknown as {
    rustLivePlayerGameModeSetCalls: number;
    rustLivePlayerLastGameModeSet: unknown;
    rustLiveInputPump: unknown;
  };
  assert.equal(state.rustLivePlayerGameModeSetCalls, 0);
  assert.equal(state.rustLivePlayerLastGameModeSet, null);
  assert.equal(state.rustLiveInputPump, null);
});

test("legacy native receipt cursors are durably baselined before live input opens", async () => {
  const service = new RestoredRuntimeService();
  const { engine, activeHost } = engineHarness(service);
  const stored: unknown[] = [];
  const state = engine as unknown as Record<string, unknown> & {
    rustNativeBlockEditProjection: unknown;
    rustNativeDropPickupProjection: unknown;
    rustNativePlayerDropProjection: unknown;
    rustNativePlayerDeathRespawnProjection: unknown;
    rustLivePlayerAuthorityState: string;
  };
  state.rustNativeBlockEditProjection = null;
  state.rustNativeDropPickupProjection = null;
  state.rustNativePlayerDropProjection = null;
  state.rustNativePlayerDeathRespawnProjection = null;
  Object.assign(state, {
    persistent: true,
    activeWorldId: "live-authority",
    worldSessionStartedAt: Date.now(),
    serialize() {
      return Object.freeze({
        rustNativeBlockEditProjection: state.rustNativeBlockEditProjection,
        rustNativeDropPickupProjection: state.rustNativeDropPickupProjection,
        rustNativePlayerDropProjection: state.rustNativePlayerDropProjection,
        rustNativePlayerDeathRespawnProjection: state.rustNativePlayerDeathRespawnProjection,
      });
    },
    worldStorage: {
      saveWorldLocalOnly(worldId: string, document: unknown) {
        assert.equal(worldId, "live-authority");
        stored.push(document);
        return Object.freeze({ ok: true as const, value: Object.freeze({ worldId }) });
      },
    },
  });

  await (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
    .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "load", save: null, host: activeHost });
  assert.equal(state.rustLivePlayerAuthorityState, "ready");
  assert.deepEqual(state.rustNativeBlockEditProjection, { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.deepEqual(state.rustNativeDropPickupProjection, { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.deepEqual(state.rustNativePlayerDropProjection, { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.deepEqual(state.rustNativePlayerDeathRespawnProjection, { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.equal(stored.length, 1, "all legacy native cursors must share one durable browser baseline");
  assert.deepEqual((stored[0] as Readonly<{ save: unknown }>).save, {
    rustNativeBlockEditProjection: state.rustNativeBlockEditProjection,
    rustNativeDropPickupProjection: state.rustNativeDropPickupProjection,
    rustNativePlayerDropProjection: state.rustNativePlayerDropProjection,
    rustNativePlayerDeathRespawnProjection: state.rustNativePlayerDeathRespawnProjection,
  });
  await (engine as unknown as { stopRustLivePlayerAuthorityR5(): Promise<void> }).stopRustLivePlayerAuthorityR5();
});

test("scheduled R5 input adopts only the shared runtime's external network successor", async () => {
  const service = new RestoredRuntimeService();
  const { engine, activeHost } = engineHarness(service);
  await (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
    .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "multiplayer-guest", save: null, host: activeHost });
  const state = engine as unknown as {
    rustRuntimeOperationsBlocked: boolean;
    rustLiveInputAdvance: Promise<void> | null;
    rustLiveInputPump: Readonly<{ diagnostics(): Readonly<{
      state: string;
      lastNetworkRevision: number;
      networkIdentityAdoptions: number;
    }> }>;
    keys: Set<string>;
    position: { x: number; y: number; z: number };
  };
  state.rustRuntimeOperationsBlocked = false;
  const beforePosition = state.position.x;
  const before = service.current;
  service.current = identity({
    ...before,
    revision: Object.freeze({ ...before.revision, network: before.revision.network + 3 }),
    stateHash: "9".repeat(32),
  });

  state.keys.add("KeyD");
  (engine as unknown as { scheduleRustLiveInputAdvanceR5(): void }).scheduleRustLiveInputAdvanceR5();
  assert.ok(state.rustLiveInputAdvance);
  await state.rustLiveInputAdvance;

  const diagnostics = state.rustLiveInputPump.diagnostics();
  assert.equal(diagnostics.state, "ready");
  assert.equal(diagnostics.lastNetworkRevision, before.revision.network + 3);
  assert.equal(diagnostics.networkIdentityAdoptions, 1);
  assert.ok(state.position.x > beforePosition, "the first post-keyframe native input must still move the guest");
  await (engine as unknown as { stopRustLivePlayerAuthorityR5(): Promise<void> }).stopRustLivePlayerAuthorityR5();
});

test("durable locator recovery completes before terrain residency and the first fixed step", async () => {
  const service = new RestoredRuntimeService();
  service.presentation.extractionRevision = 1;
  const { engine, activeHost } = engineHarness(service);
  const journalSentinel = Object.freeze({ sentinel: "durable-locator-journal" });
  const state = engine as unknown as {
    rustRuntimeOperationsBlocked: boolean;
    rustLivePlayerAuthorityState: string;
    rustLiveInputPump: unknown;
    rustTerrainLocatorEffectJournal: unknown;
    recoverPreparedRustTerrainLocatorEffect(
      generation: number,
      host: RustWorldRuntimeManagedHostV1,
    ): Promise<void>;
    stopRustLivePlayerAuthorityR5(): Promise<void>;
  };
  state.rustTerrainLocatorEffectJournal = journalSentinel;
  let recoveryCalls = 0;
  state.recoverPreparedRustTerrainLocatorEffect = async (generation, recoveredHost) => {
    recoveryCalls += 1;
    assert.equal(generation, 7);
    assert.equal(recoveredHost, activeHost);
    assert.equal(state.rustRuntimeOperationsBlocked, true, "world operations remain blocked during recovery");
    assert.equal(state.rustLivePlayerAuthorityState, "ready", "only the temporary attested pump opens recovery");
    assert.equal(service.batches.filter((batch) => batch.operations.some(
      (operation) => operation.typeId === RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
    )).length, 0, "terrain residency cannot advance before recovery clears the journal");
    assert.equal(service.submittedInputs.length, 0, "the temporary recovery pump cannot submit a fixed step");
    state.rustTerrainLocatorEffectJournal = null;
  };

  await (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
    .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "load", save: null, host: activeHost });

  assert.equal(recoveryCalls, 1);
  assert.equal(state.rustTerrainLocatorEffectJournal, null);
  assert.equal(service.batches.filter((batch) => batch.operations.some(
    (operation) => operation.typeId === RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
  )).length, 1, "activation performs exactly one terrain reconcile after recovery");
  assert.equal(service.submittedInputs.length, 1, "activation performs exactly one initial fixed step after recovery");
  assert.equal(state.rustLivePlayerAuthorityState, "ready");
  assert.notEqual(state.rustLiveInputPump, null, "the temporary pump is stopped and a live pump is reinstalled");
  await state.stopRustLivePlayerAuthorityR5();
});

test("failed durable locator recovery rejects activation before terrain residency or fixed-step mutation", async () => {
  const service = new RestoredRuntimeService();
  service.presentation.extractionRevision = 1;
  const { engine, activeHost } = engineHarness(service);
  const journalSentinel = Object.freeze({ sentinel: "failed-durable-locator-journal" });
  const recoveryFailure = new Error("synthetic locator recovery failure");
  const state = engine as unknown as {
    rustRuntimeOperationsBlocked: boolean;
    rustLivePlayerAuthorityState: string;
    rustLiveInputPump: unknown;
    rustTerrainLocatorEffectJournal: unknown;
    recoverPreparedRustTerrainLocatorEffect(): Promise<void>;
  };
  state.rustTerrainLocatorEffectJournal = journalSentinel;
  state.recoverPreparedRustTerrainLocatorEffect = async () => {
    assert.equal(state.rustRuntimeOperationsBlocked, true);
    assert.equal(state.rustLivePlayerAuthorityState, "ready");
    assert.equal(service.batches.some((batch) => batch.operations.some(
      (operation) => operation.typeId === RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
    )), false);
    assert.equal(service.submittedInputs.length, 0);
    throw recoveryFailure;
  };

  await assert.rejects(
    (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
      .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "load", save: null, host: activeHost }),
    (error) => error === recoveryFailure,
  );

  assert.equal(service.batches.some((batch) => batch.operations.some(
    (operation) => operation.typeId === RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
  )), false, "failed recovery cannot mutate terrain residency");
  assert.equal(service.submittedInputs.length, 0, "failed recovery cannot submit a fixed step");
  assert.equal(state.rustLiveInputPump, null, "the temporary recovery pump is stopped on failure");
  assert.equal(state.rustTerrainLocatorEffectJournal, journalSentinel, "the durable journal remains available to retry");
});

test("live activation rejects absent, legacy, blocked, and drifted combat before terrain readiness", async () => {
  const cases = Object.freeze([
    Object.freeze({ mode: "absent" as const, message: /linked combat/u }),
    Object.freeze({ mode: "legacy" as const, message: /explicit-migration/u }),
    Object.freeze({ mode: "blocked" as const, message: /vital-parity-conflict/u }),
    Object.freeze({ mode: "vitals-drift" as const, message: /do not match/u }),
  ]);
  for (const { mode, message } of cases) {
    const service = new RestoredRuntimeService(Object.freeze([mode]));
    const { engine, activeHost } = engineHarness(service);
    await assert.rejects(
      (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
        .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "load", save: null, host: activeHost }),
      message,
    );
    assert.equal(
      service.batches.some((batch) => batch.operations.some(
        (operation) => operation.typeId === RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
      )),
      false,
      `${mode} combat must fail before terrain can contribute to readiness`,
    );
  }
});

test("post-terrain status requery rejects newly drifted combat before the player pump opens", async () => {
  const service = new RestoredRuntimeService(Object.freeze(["exact", "vitals-drift"]));
  const { engine, activeHost } = engineHarness(service);
  await assert.rejects(
    (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
      .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "load", save: null, host: activeHost }),
    /do not match/u,
  );
  assert.equal(service.batches.filter((batch) => batch.operations.some(
    (operation) => operation.typeId === RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
  )).length, 1, "the mutation is followed by an exact BWS5/BWS7 readiness requery");
  assert.equal(service.batches.some((batch) => batch.operations.some(
    (operation) => operation.typeId === RUST_CONTEXT_COMMAND_CONTINUITY_TYPE_V2,
  )), false, "drifted post-mutation combat must fail before the native input pump is created");
});

test("accepted pump extraction advances only the native presentation mirror and stale generations cannot", async () => {
  const service = new RestoredRuntimeService();
  const { engine, activeHost } = engineHarness(service);
  await (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
    .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "load", save: null, host: activeHost });
  const state = engine as unknown as {
    rustRuntimeOperationsBlocked: boolean;
    rustLiveRendererExtractionQueue: Array<Readonly<{ extraction: RustIntegratedRuntimeExtractionV1 }>>;
    rustLiveRenderRuntime: unknown;
    rustLiveInputPump: unknown;
    rustLivePlayerAuthorityState: string;
    rustLiveInputAdvance: Promise<void> | null;
    rustLiveSelectedSlotIntentR5: number | null;
    rustLiveSelectedSlotIntentPendingR5: boolean;
    rustLiveLookIntentPendingR5: boolean;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    selected: number;
    yaw: number;
    pitch: number;
    grounded: boolean;
    oxygenSeconds: number;
    health: number;
    sprinting: boolean;
    keys: Set<string>;
    rustLivePlayerPresentationViewR10: Readonly<Record<string, unknown>>;
  };
  state.rustRuntimeOperationsBlocked = false;
  assert.equal(state.rustLiveRendererExtractionQueue.length, 1, "initial sync queues one ordered composer handoff");
  state.rustLiveRenderRuntime = Object.freeze({ dispose: async () => undefined });

  engine.selectSlot(4);
  engine.look(-40, 20);
  const pendingYaw = state.yaw;
  const pendingPitch = state.pitch;
  assert.equal(state.selected, 4, "slot intent is an immediate presentation while Rust retains gameplay authority");
  assert.notEqual(pendingYaw, 0, "look intent is an immediate camera presentation while Rust retains gameplay authority");
  (engine as unknown as { reapplyRustLivePlayerViewR10(generation: number, host: RustWorldRuntimeManagedHostV1): void })
    .reapplyRustLivePlayerViewR10(7, activeHost);
  assert.equal(state.rustLiveSelectedSlotIntentR5, 4, "an older native mirror must preserve the newer slot intent");
  assert.equal(state.rustLiveSelectedSlotIntentPendingR5, true);
  assert.equal(state.rustLiveLookIntentPendingR5, true);
  assert.equal(state.selected, 4, "an older extraction cannot erase the pending visible slot intent");
  assert.equal(state.yaw, pendingYaw, "an older extraction cannot erase the pending visible yaw intent");
  assert.equal(state.pitch, pendingPitch, "an older extraction cannot erase the pending visible pitch intent");

  state.keys.add("KeyD");
  state.keys.add("ControlLeft");
  (engine as unknown as { scheduleRustLiveInputAdvanceR5(): void }).scheduleRustLiveInputAdvanceR5();
  assert.ok(state.rustLiveInputAdvance);
  await state.rustLiveInputAdvance;
  assert.deepEqual(state.rustLiveRendererExtractionQueue.map((entry) => entry.extraction.extractionRevision), [1, 2],
    "a stalled renderer retains ordered bounded handoffs without stalling the player pump");
  const submitted = service.submittedInputs.at(-1)!;
  assert.equal(submitted.selectedSlot, 4);
  assert.equal(state.selected, 4);
  assert.equal(state.rustLiveSelectedSlotIntentPendingR5, false);
  assert.equal(state.rustLiveLookIntentPendingR5, false);
  assert.equal(state.position.x, 9);
  assert.equal(state.position.y, 70.5);
  assert.equal(state.position.z, -8);
  assert.equal(state.velocity.x, 1);
  assert.equal(state.grounded, true);
  assert.equal(state.oxygenSeconds, 11.5);
  assert.equal(state.health, 10);
  assert.equal(state.sprinting, true);
  assert.equal(state.yaw, submitted.lookYaw / RUST_LIVE_INPUT_AXIS_DIVISOR_R5 * Math.PI);
  assert.equal(state.pitch, submitted.lookPitch / RUST_LIVE_INPUT_AXIS_DIVISOR_R5 * (Math.PI / 2));

  const queued = state.rustLiveRendererExtractionQueue.at(-1)!;
  const enqueue = (engine as unknown as {
    enqueueRustLiveRendererExtractionR10(entry: unknown): boolean;
  }).enqueueRustLiveRendererExtractionR10.bind(engine);
  assert.equal(enqueue({ generation: 7, host: activeHost, pump: state.rustLiveInputPump, extraction: queued.extraction }), true);
  assert.equal(enqueue({ generation: 7, host: activeHost, pump: state.rustLiveInputPump, extraction: queued.extraction }), true);
  assert.equal(state.rustLiveRendererExtractionQueue.length, 4);
  assert.equal(enqueue({ generation: 7, host: activeHost, pump: state.rustLiveInputPump, extraction: queued.extraction }), false);
  assert.equal(state.rustLiveRendererExtractionQueue.length, 0, "renderer overflow is isolated by clearing its bounded queue");
  assert.equal(state.rustLiveRenderRuntime, null);
  assert.equal(state.rustRuntimeOperationsBlocked, false, "renderer overflow cannot block native simulation");
  assert.equal(state.rustLivePlayerAuthorityState, "ready", "renderer overflow cannot quarantine player authority");

  const authoritativeView = state.rustLivePlayerPresentationViewR10;
  assert.throws(
    () => (engine as unknown as { projectRustLivePlayerViewR10(view: unknown): void })
      .projectRustLivePlayerViewR10(Object.freeze({ ...authoritativeView, maximumHealth: 20, health: 20 })),
    /10-heart/u,
  );
  assert.equal(state.health, 10, "an ungrounded 20-to-10 conversion must fail before presentation mutation");

  const beforeStale = { x: state.position.x, y: state.position.y, z: state.position.z };
  assert.throws(
    () => (engine as unknown as {
      stageRustLivePlayerExtractionR10(
        generation: number,
        host: RustWorldRuntimeManagedHostV1,
        pump: unknown,
        extraction: RustIntegratedRuntimeExtractionV1,
      ): void;
      rustLiveInputPump: unknown;
    }).stageRustLivePlayerExtractionR10(
      6,
      activeHost,
      (engine as unknown as { rustLiveInputPump: unknown }).rustLiveInputPump,
      {} as RustIntegratedRuntimeExtractionV1,
    ),
    /superseded/u,
  );
  assert.deepEqual({ x: state.position.x, y: state.position.y, z: state.position.z }, beforeStale);
  await (engine as unknown as { stopRustLivePlayerAuthorityR5(): Promise<void> }).stopRustLivePlayerAuthorityR5();
});

test("native autosave defers across a pending selected-slot intent and resumes after Rust acknowledges it", async () => {
  const service = new RestoredRuntimeService();
  const { engine, activeHost } = engineHarness(service);
  await (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
    .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "load", save: null, host: activeHost });

  let nativeSaves = 0;
  Object.assign(activeHost, {
    multiplayerAuthority: () => ({
      runExclusiveMutation: async <T>(operation: () => Promise<T>) => operation(),
    }),
  });
  const state = engine as unknown as {
    activeWorldId: string;
    rustNativePersistenceWorldId: string;
    rustRuntimeOperationsBlocked: boolean;
    rustNativeSaveOperation: Promise<void> | null;
    rustNativeSaveQueued: boolean;
    rustLiveSelectedSlotIntentPendingR5: boolean;
    rustLivePlayerAuthorityState: string;
    rustLivePlayerAuthorityLastError: string | null;
    selected: number;
    rustLivePlayerPresentationViewR10: Readonly<{ selectedSlot: number; actorId: string; inventoryContainer: string }>;
    rustLiveInputAdvance: Promise<void> | null;
    rustLiveInputPump: unknown;
    worldStorage: Readonly<{ saveNativeWorld(worldId: string): Promise<Readonly<{ ok: true; value: unknown }>> }>;
  };
  state.activeWorldId = "world:save-selection-race";
  state.rustNativePersistenceWorldId = state.activeWorldId;
  state.rustRuntimeOperationsBlocked = false;
  state.rustNativeSaveQueued = false;
  state.rustNativeSaveOperation = null;
  Object.assign(engine, { clearInput: () => undefined });
  const contextSelections: Array<readonly [compatibility: number, native: number]> = [];
  Object.assign(engine, {
    rustTerrainLocatorRuntimeContext() {
      const nativeSelected = state.rustLivePlayerPresentationViewR10.selectedSlot;
      contextSelections.push([state.selected, nativeSelected]);
      if (nativeSelected !== state.selected) {
        throw new Error("The Rust locator inventory binding disagrees with the attested selected slot");
      }
      return Object.freeze({ generation: 7, host: activeHost, pump: state.rustLiveInputPump });
    },
  });
  state.worldStorage = {
    async saveNativeWorld(worldId: string) {
      assert.equal(worldId, state.activeWorldId);
      nativeSaves += 1;
      const before = service.current;
      service.current = Object.freeze({
        ...before,
        revision: Object.freeze({
          ...before.revision,
          persistence: before.revision.persistence + 1,
        }),
        stateHash: nativeSaves.toString(16).padStart(32, "d"),
      });
      return Object.freeze({ ok: true as const, value: Object.freeze({ worldId }) });
    },
  };
  assert.doesNotThrow(
    () => (engine as unknown as { rustTerrainLocatorRuntimeContext(allowBlocked: boolean): unknown })
      .rustTerrainLocatorRuntimeContext(true),
  );

  engine.selectSlot(4);
  assert.equal(state.rustLiveSelectedSlotIntentPendingR5, true);
  assert.throws(
    () => (engine as unknown as { rustTerrainLocatorRuntimeContext(allowBlocked: boolean): unknown })
      .rustTerrainLocatorRuntimeContext(true),
    /disagrees with the attested selected slot/u,
    "the strict custody comparison remains fail-closed during the presentation-only intent window",
  );
  (engine as unknown as { scheduleRustNativeSaveCheckpoint(): void }).scheduleRustNativeSaveCheckpoint();
  assert.equal(nativeSaves, 0, "autosave must not checkpoint mismatched native and compatibility custody");
  assert.equal(state.rustNativeSaveOperation, null, "the deferred save must not open a native operation prematurely");
  assert.equal(state.rustNativeSaveQueued, true, "the deferred save remains queued for the acknowledgement edge");
  assert.equal(state.rustLivePlayerAuthorityState, "ready", "a normal selection race must not quarantine authority");

  (engine as unknown as { scheduleRustLiveInputAdvanceR5(): void }).scheduleRustLiveInputAdvanceR5();
  assert.ok(state.rustLiveInputAdvance);
  await state.rustLiveInputAdvance;
  assert.equal(state.rustLivePlayerPresentationViewR10.selectedSlot, 4);
  assert.equal(state.selected, 4);
  assert.equal(state.rustLivePlayerAuthorityLastError, null);
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (state.rustNativeSaveOperation) await state.rustNativeSaveOperation;
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(state.rustLiveSelectedSlotIntentPendingR5, false, "the accepted extraction acknowledges the selected slot");
  assert.deepEqual(contextSelections, [[0, 0], [4, 0], [4, 4]]);
  assert.equal(state.rustLivePlayerAuthorityLastError, null);
  assert.equal(nativeSaves, 1, "the queued autosave resumes exactly once after acknowledgement");
  assert.equal(state.rustNativeSaveQueued, false);
  assert.equal(state.rustLivePlayerAuthorityState, "ready");
  await (engine as unknown as { stopRustLivePlayerAuthorityR5(): Promise<void> }).stopRustLivePlayerAuthorityR5();
});

test("pending fixed-step capability blocks before status, terrain, or controls can flip live", async () => {
  const service = new RestoredRuntimeService();
  service.diagnostics = () => Object.freeze({
    authoritative: true,
    contentReady: true,
    liveAuthorityReady: false,
    capabilities: Object.freeze(READY_CAPABILITIES
      .filter((capability) => capability !== "fixed-step-input-v1")
      .concat("fixed-step-input-v1-pending-live-cutover")),
  });
  const { engine, activeHost } = engineHarness(service);
  await assert.rejects(
    (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
      .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "load", save: {} as WorldSave, host: activeHost }),
    /pending-live-cutover/u,
  );
  assert.equal(service.batches.length, 0);
  assert.notEqual((engine as unknown as { rustLivePlayerAuthorityState: string }).rustLivePlayerAuthorityState, "ready");
});

test("missing player-respawn capability blocks before status, terrain, or controls can flip live", async () => {
  const service = new RestoredRuntimeService();
  service.diagnostics = () => Object.freeze({
    authoritative: true,
    contentReady: true,
    liveAuthorityReady: true,
    capabilities: Object.freeze(READY_CAPABILITIES
      .filter((capability) => capability !== "player-respawn-v1")),
  });
  const { engine, activeHost } = engineHarness(service);
  await assert.rejects(
    (engine as unknown as { activateRustLivePlayerAuthorityR5(input: unknown): Promise<void> })
      .activateRustLivePlayerAuthorityR5({ generation: 7, kind: "load", save: {} as WorldSave, host: activeHost }),
    /capabilities are not promotion-ready/u,
  );
  assert.equal(service.batches.length, 0);
  assert.notEqual((engine as unknown as { rustLivePlayerAuthorityState: string }).rustLivePlayerAuthorityState, "ready");
});

test("runtime player gate routes R5 actions and does not execute direct legacy mutation methods", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  Object.assign(engine, {
    rustLivePlayerAuthorityEnabledR5: () => true,
    rustDropPulse: false,
    rustSecondaryUseHeld: false,
    rustCreativeFlightTogglePulse: false,
    mineHeld: false,
    miningProgress: 0.75,
    keys: new Set<string>(),
    yaw: 0,
    pitch: 0,
    selected: 0,
    sprintLatched: false,
    rustLiveSelectedSlotIntentR5: 0,
    rustLiveSelectedSlotIntentPendingR5: false,
    mode: "survival",
    multiplayer: null,
    rustNativeSaveSuppressedForMultiplayerRuntime: false,
    inventory: Array.from({ length: 36 }, (_, index) => index === 0 || index === 4
      ? { item: Item.Berry, count: 3 }
      : null),
    events: { onSelectedSlot: () => undefined, onToast: () => undefined },
    emitHud: () => undefined,
  });
  Object.defineProperties(engine, {
    target: { get: () => { throw new Error("legacy target read"); }, configurable: true },
    targetMob: { get: () => { throw new Error("legacy mob read"); }, configurable: true },
    magicState: { get: () => { throw new Error("legacy magic read"); }, configurable: true },
    audio: { get: () => { throw new Error("legacy audio read"); }, configurable: true },
  });

  assert.doesNotThrow(() => engine.pickTarget());
  assert.doesNotThrow(() => engine.breakTarget());
  assert.doesNotThrow(() => engine.attackTargetMob());
  assert.equal(engine.castSelectedMagicSpell(), false);
  assert.equal(engine.startRangedReload(), false);
  assert.equal((engine as unknown as { fireSelectedRangedWeapon(): boolean }).fireSelectedRangedWeapon(), false);
  assert.doesNotThrow(() => engine.updateMining(1));
  assert.doesNotThrow(() => engine.updatePlayer(1));
  assert.doesNotThrow(() => engine.respawn(true));
  assert.doesNotThrow(() => engine.damagePlayer(5, "legacy mob"));
  assert.equal(engine.applyPlayerKnockback({ x: 0, z: 0 }, 5), 0);
  assert.equal((engine as unknown as { applyCombatEventToLocalPlayer(event: unknown, source: string): boolean })
    .applyCombatEventToLocalPlayer(null, "legacy combat"), false);
  assert.doesNotThrow(() => engine.dismountBoat());
  assert.equal(engine.packTargetBoat(), false);
  assert.doesNotThrow(() => engine.dismountCreature());
  assert.equal((engine as unknown as { beginLocalCreatureRide(mob: unknown): boolean }).beginLocalCreatureRide(null), false);
  assert.equal((engine as unknown as { triggerMountedCreatureMove(mob: unknown, key: "KeyZ"): boolean })
    .triggerMountedCreatureMove(null, "KeyZ"), false);
  const intent = (engine as unknown as {
    rustLiveInputIntentR5(pump: { diagnostics(): Readonly<{ authoritativeFlags: number }> }): Readonly<{
      actions: Readonly<{ interact: boolean; mountToggle: boolean }>;
    }>;
  }).rustLiveInputIntentR5({ diagnostics: () => Object.freeze({ authoritativeFlags: 0 }) });
  assert.equal(intent.actions.interact, false, "unsupported standalone interact has no invented browser binding");
  assert.equal(intent.actions.mountToggle, false, "mount remains inert until extraction identifies its exact target");
  assert.doesNotThrow(() => engine.selectSlot(4));
  assert.equal((engine as unknown as { selected: number }).selected, 4);
  assert.equal((engine as unknown as { rustLiveSelectedSlotIntentPendingR5: boolean })
    .rustLiveSelectedSlotIntentPendingR5, true);

  assert.equal(engine.useSelected(), true);
  engine.dropSelectedItem();
  engine.setMining(true);
  engine.setOffhandUse(true);
  const routed = engine as unknown as {
    rustDropPulse: boolean;
    rustSecondaryUseHeld: boolean;
    mineHeld: boolean;
    miningProgress: number;
  };
  assert.equal(routed.rustDropPulse, true);
  assert.equal(routed.rustSecondaryUseHeld, true);
  assert.equal(routed.mineHeld, true);
  assert.equal(routed.miningProgress, 0.75, "the legacy mining accumulator must stay untouched while live");
});

function creativeCatalogAuthorityHarness() {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const inventory = Array.from({ length: 36 }, () => null) as Array<null | { item: number; count: number }>;
  const before = {
    selectedSlot: 0,
    inventoryContainerRevision: BigInt(1),
    held: null,
    extractionRevision: BigInt(4),
  };
  const after = {
    ...before,
    inventoryContainerRevision: BigInt(2),
    extractionRevision: BigInt(5),
    held: {
      itemCode: Item.WildwoodShelfItem,
      count: 64,
      durabilityMillionths: null,
      metadataHash: new Uint8Array(16),
    },
  };
  let resolveNative!: (value: unknown) => void;
  let rejectNative!: (reason?: unknown) => void;
  const native = new Promise((resolve, reject) => {
    resolveNative = resolve;
    rejectNative = reject;
  });
  let tracked: Promise<unknown> | null = null;
  const effects = {
    projected: 0,
    saved: 0,
    audio: 0,
    hud: 0,
    quarantined: 0,
    toast: 0,
  };
  const inventoryContainer = Object.freeze({ kind: "player" as const, id: "player:creative", ownerId: "player:creative" });
  const pump = {
    setCreativeSlot: (_generation: number, intent: {
      selectedSlot: number;
      expectedInventoryRevision: bigint;
      expectedStack: unknown;
      replacementStack: { itemCode: number; count: number };
    }) => {
      assert.equal(intent.selectedSlot, 0);
      assert.equal(intent.expectedInventoryRevision, BigInt(1));
      assert.equal(intent.expectedStack, null);
      assert.deepEqual(
        { itemCode: intent.replacementStack.itemCode, count: intent.replacementStack.count },
        { itemCode: Item.WildwoodShelfItem, count: 64 },
      );
      return native;
    },
  };
  Object.assign(engine, {
    mode: "builder",
    selected: 0,
    inventory,
    rustLivePlayerAuthorityRequestedR5: true,
    rustTerrainLocatorCommitLocked: false,
    rustLiveInputPump: pump,
    rustLivePlayerAuthorityEnabledR5: () => true,
    withRustTerrainLocatorCommitLock: async (operation: () => Promise<unknown>) => operation(),
    rustTerrainLocatorRuntimeContext: () => ({
      generation: 7,
      host: {},
      pump,
      attestation: { creativeMode: true, inventoryContainer },
      player: before,
    }),
    rustTerrainLocatorPlayerContinuityMatches: () => true,
    assertRustLivePlayerViewContextR10: () => undefined,
    projectRustLivePlayerViewR10: () => { effects.projected += 1; },
    rustLivePlayerPresentationViewR10: before,
    rustLivePlayerViewExtractionRevisionR10: before.extractionRevision,
    trackRustAuthorityOperation: (operation: Promise<unknown>) => {
      tracked = operation;
      return operation;
    },
    quarantineRustLivePlayerAuthorityR5: () => { effects.quarantined += 1; },
    audio: { play: () => { effects.audio += 1; } },
    saveSoon: () => { effects.saved += 1; },
    emitHud: () => { effects.hud += 1; },
    events: { onToast: () => { effects.toast += 1; } },
  });

  return {
    engine,
    inventory,
    before,
    after,
    effects,
    pump,
    inventoryContainer,
    resolveNative,
    rejectNative,
    tracked: () => {
      assert.ok(tracked, "the catalog click must enter the tracked native authority queue");
      return tracked;
    },
  };
}

function acceptedCreativeCatalogResult(
  before: ReturnType<typeof creativeCatalogAuthorityHarness>["before"],
  after: ReturnType<typeof creativeCatalogAuthorityHarness>["after"],
) {
  return {
    discarded: false,
    plan: {},
    receipt: {},
    validated: {
      creativeSlot: {
        previousInventoryRevision: before.inventoryContainerRevision,
        resultingInventoryRevision: after.inventoryContainerRevision,
      },
    },
    extraction: {},
    player: after,
  };
}

function assertCreativeCatalogFailedClosed(
  harness: ReturnType<typeof creativeCatalogAuthorityHarness>,
) {
  assert.equal(harness.inventory[0], null, "a failed native command cannot publish compatibility inventory");
  assert.equal(harness.effects.projected, 0, "a failed native command cannot project its player readback");
  assert.equal(harness.effects.saved, 0, "a failed native command cannot schedule a browser save");
  assert.equal(harness.effects.audio, 0, "a failed native command cannot play the selection sound");
  assert.equal(harness.effects.hud, 0, "a failed native command cannot publish a HUD update");
  assert.equal(harness.effects.quarantined, 1, "the failed native command must quarantine exactly once");
  assert.equal(harness.effects.toast, 1, "the failed native command must explain the quarantine once");
}

test("Creative catalog custody publishes only after the native CAS receipt and player readback", async () => {
  const harness = creativeCatalogAuthorityHarness();

  harness.engine.setCreativeItem(Item.WildwoodShelfItem);
  const operation = harness.tracked();
  assert.equal(harness.inventory[0], null, "the compatibility slot cannot publish before native acknowledgement");
  assert.equal(harness.effects.projected, 0);

  harness.resolveNative(acceptedCreativeCatalogResult(harness.before, harness.after));
  await operation;

  assert.deepEqual(harness.inventory[0], { item: Item.WildwoodShelfItem, count: 64 });
  assert.equal(harness.effects.projected, 1, "the accepted readback must become the native presentation row");
  assert.equal(harness.effects.saved, 1);
  assert.equal(harness.effects.audio, 1);
  assert.equal(harness.effects.hud, 1);
  assert.equal(harness.effects.quarantined, 0);
  assert.equal(harness.effects.toast, 0);
});

test("Creative catalog receipt rejection publishes no browser side effects and quarantines once", async () => {
  const harness = creativeCatalogAuthorityHarness();
  harness.engine.setCreativeItem(Item.WildwoodShelfItem);
  const operation = harness.tracked();

  harness.rejectNative(new Error("native Creative receipt rejected"));
  await assert.rejects(operation, /native Creative receipt rejected/);
  await Promise.resolve();

  assertCreativeCatalogFailedClosed(harness);
});

test("Creative catalog discarded result publishes no browser side effects and quarantines once", async () => {
  const harness = creativeCatalogAuthorityHarness();
  harness.engine.setCreativeItem(Item.WildwoodShelfItem);
  const operation = harness.tracked();

  harness.resolveNative({ discarded: true, plan: null, receipt: null, validated: null, extraction: null, player: null });
  await assert.rejects(operation, /superseded before its exact readback/);
  await Promise.resolve();

  assertCreativeCatalogFailedClosed(harness);
});

test("Creative catalog post-command readback drift publishes no browser side effects and quarantines once", async () => {
  const harness = creativeCatalogAuthorityHarness();
  harness.engine.setCreativeItem(Item.WildwoodShelfItem);
  const operation = harness.tracked();
  const driftedAfter = {
    ...harness.after,
    inventoryContainerRevision: harness.after.inventoryContainerRevision + BigInt(1),
  };

  harness.resolveNative({
    ...acceptedCreativeCatalogResult(harness.before, harness.after),
    player: driftedAfter,
  });
  await assert.rejects(operation, /changed state outside its exact selected-slot CAS/);
  await Promise.resolve();

  assertCreativeCatalogFailedClosed(harness);
});

test("Creative catalog shared-runtime lock drains and adopts a network successor before planning its native CAS", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const inventory = Array.from({ length: 36 }, () => null) as Array<null | { item: number; count: number }>;
  const inventoryContainer = Object.freeze({ kind: "player" as const, id: "player:creative", ownerId: "player:creative" });
  const staleBefore = {
    selectedSlot: 0,
    inventoryContainerRevision: BigInt(1),
    held: null,
    extractionRevision: BigInt(4),
  };
  const adoptedBefore = {
    ...staleBefore,
    inventoryContainerRevision: BigInt(2),
    extractionRevision: BigInt(5),
  };
  const after = {
    ...adoptedBefore,
    inventoryContainerRevision: BigInt(3),
    extractionRevision: BigInt(6),
    held: {
      itemCode: Item.WildwoodShelfItem,
      count: 64,
      durabilityMillionths: null,
      metadataHash: new Uint8Array(16),
    },
  };
  const order: string[] = [];
  let currentPlayer = staleBefore;
  let tracked: Promise<unknown> | null = null;
  let quarantined = 0;
  const pump = {
    state: "ready",
    drain: async () => { order.push("pump:drain"); },
    adoptExternalNetworkSuccessor: async (generation: number) => {
      order.push(`pump:adopt:${generation}`);
      currentPlayer = adoptedBefore;
    },
    setCreativeSlot: async (generation: number, intent: {
      expectedInventoryRevision: bigint;
      expectedStack: unknown;
      replacementStack: { itemCode: number; count: number };
    }) => {
      order.push(`pump:set:${intent.expectedInventoryRevision}`);
      assert.equal(generation, 7);
      assert.equal(intent.expectedInventoryRevision, adoptedBefore.inventoryContainerRevision);
      assert.equal(intent.expectedStack, null);
      assert.deepEqual(
        { itemCode: intent.replacementStack.itemCode, count: intent.replacementStack.count },
        { itemCode: Item.WildwoodShelfItem, count: 64 },
      );
      return {
        discarded: false,
        plan: {},
        receipt: {},
        validated: {
          creativeSlot: {
            previousInventoryRevision: adoptedBefore.inventoryContainerRevision,
            resultingInventoryRevision: after.inventoryContainerRevision,
          },
        },
        extraction: {},
        player: after,
      };
    },
  };
  const multiplayerAuthority = {
    runExclusiveMutation: async <T>(operation: () => Promise<T>) => {
      order.push("network-exclusive:start");
      const result = await operation();
      order.push("network-exclusive:end");
      return result;
    },
  };
  const host = {
    diagnostics: () => ({ state: "ready" }),
    multiplayerAuthority: () => multiplayerAuthority,
  };
  Object.assign(engine, {
    mode: "builder",
    selected: 0,
    inventory,
    rustLivePlayerAuthorityRequestedR5: true,
    rustTerrainLocatorCommitLocked: false,
    rustLiveInputAdvance: null,
    rustLiveViewRefresh: null,
    rustRuntimeHost: host,
    rustLiveInputPump: pump,
    rustLivePlayerAuthorityGeneration: 7,
    rustLivePlayerAuthorityEnabledR5: () => true,
    rustTerrainLocatorRuntimeContext: () => {
      order.push(`context:${currentPlayer.inventoryContainerRevision}`);
      return {
        generation: 7,
        host,
        pump,
        attestation: { creativeMode: true, inventoryContainer },
        player: currentPlayer,
      };
    },
    rustTerrainLocatorPlayerContinuityMatches: () => true,
    assertRustLivePlayerViewContextR10: () => undefined,
    projectRustLivePlayerViewR10: () => { order.push("project"); },
    rustLivePlayerPresentationViewR10: staleBefore,
    rustLivePlayerViewExtractionRevisionR10: staleBefore.extractionRevision,
    trackRustAuthorityOperation: (operation: Promise<unknown>) => {
      tracked = operation;
      return operation;
    },
    quarantineRustLivePlayerAuthorityR5: () => { quarantined += 1; },
    audio: { play: () => { order.push("audio"); } },
    saveSoon: () => { order.push("save"); },
    emitHud: () => { order.push("hud"); },
    events: { onToast: () => undefined },
  });

  engine.setCreativeItem(Item.WildwoodShelfItem);
  assert.ok(tracked);
  await tracked;

  assert.deepEqual(order, [
    "network-exclusive:start",
    "pump:drain",
    "pump:adopt:7",
    "context:2",
    "pump:set:2",
    "project",
    "audio",
    "save",
    "hud",
    "network-exclusive:end",
  ]);
  assert.deepEqual(inventory[0], { item: Item.WildwoodShelfItem, count: 64 });
  assert.equal(quarantined, 0);
  assert.equal((engine as unknown as { rustTerrainLocatorCommitLocked: boolean }).rustTerrainLocatorCommitLocked, false);
});

test("live player key routing opens shell overlays once and leaves unsupported gameplay keys inert", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const overlays: Array<readonly [string, string | undefined]> = [];
  const forbiddenMutations: string[] = [];
  Object.assign(engine, {
    rustDropPulse: false,
    keys: new Set<string>(),
    targetMob: { kind: "ridgeback" },
    openOverlay: (kind: string, key?: string) => overlays.push([kind, key]),
    startRangedReload: () => { forbiddenMutations.push("reload"); },
    castSelectedMagicSpell: () => { forbiddenMutations.push("cast"); },
    dismountCreature: () => { forbiddenMutations.push("dismount"); },
    triggerMountedCreatureMove: () => { forbiddenMutations.push("mounted-move"); },
    performDragonAttack: () => { forbiddenMutations.push("dragon-attack"); },
  });
  Object.defineProperties(engine, {
    spellKeyState: { get: () => { throw new Error("legacy spell state read"); }, configurable: true },
    mountedCreatureId: { get: () => { throw new Error("legacy mount state read"); }, configurable: true },
    mobs: { get: () => { throw new Error("legacy creature list read"); }, configurable: true },
  });
  const route = (engine as unknown as {
    openShellOverlayForKey(event: KeyboardEvent): boolean;
  }).openShellOverlayForKey.bind(engine);
  const prevented: string[] = [];
  const keyEvent = (code: string, repeat = false) => ({
    code,
    repeat,
    preventDefault: () => { prevented.push(code); },
  }) as unknown as KeyboardEvent;

  for (const code of ["KeyE", "KeyM", "KeyJ", "KeyK", "KeyL", "KeyB"]) {
    assert.equal(route(keyEvent(code)), true);
    assert.equal(route(keyEvent(code, true)), true);
  }
  assert.deepEqual(overlays, [
    ["inventory", undefined],
    ["map", undefined],
    ["quests", undefined],
    ["magic", undefined],
    ["skills", undefined],
    ["bestiary", "creature:ridgeback"],
  ]);
  assert.deepEqual(prevented, [], "shell shortcuts retain their existing browser-default behavior");

  for (const code of ["KeyQ", "KeyR", "KeyF", "KeyZ", "KeyX", "KeyC"]) {
    assert.equal(route(keyEvent(code)), false);
  }
  assert.equal(overlays.length, 6);
  assert.deepEqual(forbiddenMutations, []);
  assert.equal((engine as unknown as { rustDropPulse: boolean }).rustDropPulse, false);
  assert.deepEqual([...(engine as unknown as { keys: Set<string> }).keys], []);
  assert.deepEqual(prevented, [], "the shell router cannot consume gameplay-key browser defaults");
});

test("legacy boat stepping cannot drive or overwrite the live native player mirror", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const visualUpdates: string[] = [];
  const save = { id: "legacy-boat", x: 4, y: 70, z: 8, yaw: 0, passengers: ["local"] };
  Object.assign(engine, {
    rustLivePlayerAuthorityEnabledR5: () => true,
    localPlayerId: () => "local",
    multiplayer: null,
    multiplayerBoatInputs: new Map(),
    keys: new Set(["KeyW", "KeyD"]),
    mountedBoatId: "legacy-boat",
    boats: new Map([["legacy-boat", {
      save,
      group: {
        position: { set: () => visualUpdates.push("position") },
        rotation: { set: () => visualUpdates.push("rotation") },
      },
    }]]),
  });
  Object.defineProperties(engine, {
    position: { get: () => { throw new Error("legacy player position mutation"); }, configurable: true },
    velocity: { get: () => { throw new Error("legacy player velocity mutation"); }, configurable: true },
  });

  assert.doesNotThrow(() => engine.updateBoats(1));
  assert.equal(save.x, 4);
  assert.equal(save.z, 8);
  assert.deepEqual(visualUpdates, ["position", "rotation"], "legacy boat presentation/world simulation remains explicit");
});

test("manual simulation preserves legacy world stepping but never duplicates live player/action authority", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const worldSteps: string[] = [];
  const forbidden: string[] = [];
  Object.assign(engine, {
    running: true,
    paused: false,
    titleMode: false,
    rustLivePlayerAuthorityEnabledR5: () => true,
    updateBoats: () => worldSteps.push("boats"),
    updatePlayer: () => forbidden.push("player"),
    updateMobs: () => worldSteps.push("mobs"),
    updateProjectiles: () => worldSteps.push("projectiles"),
    updateLiquids: () => worldSteps.push("liquids"),
    updateDynamicWeather: () => worldSteps.push("weather"),
    updatePersistentMachines: () => worldSteps.push("machines"),
    updateRangedWeapon: () => forbidden.push("ranged"),
    updateFastTravelChannel: () => forbidden.push("fast-travel"),
    updateMapDiscovery: () => forbidden.push("map"),
    updateHearthroadsSimulation: () => worldSteps.push("hearthroads"),
    updateGameplayCamera: () => worldSteps.push("camera"),
    updateTarget: () => worldSteps.push("target"),
    scheduleRustLiveInputAdvanceR5: () => worldSteps.push("rust-pump"),
    renderer: { render: () => worldSteps.push("render") },
    scene: {},
    camera: {},
    publishRendererExtractionR11: () => worldSteps.push("publish"),
    resetLookFrameBudget: () => worldSteps.push("look-reset"),
  });

  engine.advanceSimulation(20);
  assert.deepEqual(forbidden, []);
  for (const expected of ["boats", "mobs", "projectiles", "liquids", "weather", "machines", "hearthroads", "rust-pump"]) {
    assert.ok(worldSteps.includes(expected), `${expected} should remain in the explicitly legacy world/presentation seam`);
  }
  assert.equal(worldSteps.filter((step) => step === "rust-pump").length, 1);
});

test("browser movement automation samples exact native frames and releases the key before every await", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const sampledKeys: string[][] = [];
  let pendingKeys: string[] | null = null;
  let pendingAttempts = 0;
  let diagnostics = {
    state: "ready" as const,
    nextInputSequence: 1,
    lastAppliedMoveX: 0,
    lastAppliedMoveZ: 0,
    lastAppliedButtons: 0,
    authoritativeFlags: 0,
    latchedActionTransitions: 0,
    nativeInputPending: false,
    pendingInputSequence: null as number | null,
    lastError: null as string | null,
  };
  const pump = { diagnostics: () => ({ ...diagnostics }) };
  Object.assign(engine, {
    running: true,
    paused: false,
    titleMode: false,
    keys: new Set<string>(),
    rustLiveAutomationPulseR5: false,
    rustLiveInputPump: pump,
    rustLivePlayerAuthorityGeneration: 7,
    rustLiveInputAdvance: null,
    rustLivePlayerAuthorityEnabledR5: () => true,
    scheduleRustLiveInputAdvanceR5: () => {
      const keys = [...(engine as unknown as { keys: Set<string> }).keys];
      sampledKeys.push(keys);
      if (pendingKeys === null) {
        pendingKeys = keys;
        pendingAttempts = 0;
      }
      pendingAttempts += 1;
      const operation = Promise.resolve().then(() => {
        if (pendingAttempts < 2) {
          diagnostics = {
            ...diagnostics,
            nativeInputPending: true,
            pendingInputSequence: diagnostics.nextInputSequence,
          };
          return;
        }
        const appliedKeys = pendingKeys ?? [];
        pendingKeys = null;
        diagnostics = {
          ...diagnostics,
          nextInputSequence: diagnostics.nextInputSequence + 1,
          lastAppliedMoveX: appliedKeys.includes("KeyD") ? RUST_LIVE_INPUT_AXIS_DIVISOR_R5 : 0,
          lastAppliedMoveZ: 0,
          nativeInputPending: false,
          pendingInputSequence: null,
        };
      });
      (engine as unknown as { rustLiveInputAdvance: Promise<void> | null }).rustLiveInputAdvance = operation;
      void operation.finally(() => {
        const owner = engine as unknown as { rustLiveInputAdvance: Promise<void> | null };
        if (owner.rustLiveInputAdvance === operation) owner.rustLiveInputAdvance = null;
      });
    },
  });

  const result = await engine.pulseRustLiveMovementForAutomationR5("KeyD", 3);

  assert.deepEqual(sampledKeys, [["KeyD"], [], ["KeyD"], [], ["KeyD"], [], [], []]);
  assert.deepEqual(result.frames.map(({ sequence, moveX, moveZ, buttons, attempts }) => ({
    sequence, moveX, moveZ, buttons, attempts,
  })), [1, 2, 3].map((sequence) => ({
    sequence,
    moveX: RUST_LIVE_INPUT_AXIS_DIVISOR_R5,
    moveZ: 0,
    buttons: 0,
    attempts: 2,
  })));
  assert.ok(result.frames.every((frame) => frame.elapsedMilliseconds >= 0));
  assert.equal(result.inputSequenceBefore, 1);
  assert.deepEqual({
    sequence: result.release.sequence,
    moveX: result.release.moveX,
    moveZ: result.release.moveZ,
    buttons: result.release.buttons,
    attempts: result.release.attempts,
  }, { sequence: 4, moveX: 0, moveZ: 0, buttons: 0, attempts: 2 });
  assert.deepEqual([...(engine as unknown as { keys: Set<string> }).keys], []);
  assert.equal((engine as unknown as { rustLiveAutomationPulseR5: boolean }).rustLiveAutomationPulseR5, false);
});

test("browser movement automation commits a zero native release after a post-movement witness failure", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const sampledKeys: string[][] = [];
  let diagnostics = {
    state: "ready" as const,
    nextInputSequence: 1,
    lastAppliedMoveX: 0,
    lastAppliedMoveZ: 0,
    lastAppliedButtons: 0,
    authoritativeFlags: 0,
    latchedActionTransitions: 0,
    nativeInputPending: false,
    pendingInputSequence: null as number | null,
    lastError: null as string | null,
  };
  const pump = { diagnostics: () => ({ ...diagnostics }) };
  Object.assign(engine, {
    running: true,
    paused: false,
    titleMode: false,
    keys: new Set<string>(),
    rustLiveAutomationPulseR5: false,
    rustLiveInputPump: pump,
    rustLivePlayerAuthorityGeneration: 7,
    rustLiveInputAdvance: null,
    rustLivePlayerAuthorityEnabledR5: () => true,
    quarantineRustLivePlayerAuthorityR5: () => assert.fail("safe release should not quarantine the live generation"),
    scheduleRustLiveInputAdvanceR5: () => {
      const keys = [...(engine as unknown as { keys: Set<string> }).keys];
      sampledKeys.push(keys);
      const operation = Promise.resolve().then(() => {
        const movementOrdinal = sampledKeys.filter((sample) => sample.includes("KeyD")).length;
        diagnostics = {
          ...diagnostics,
          nextInputSequence: diagnostics.nextInputSequence + 1,
          lastAppliedMoveX: keys.includes("KeyD")
            ? movementOrdinal === 2 ? -RUST_LIVE_INPUT_AXIS_DIVISOR_R5 : RUST_LIVE_INPUT_AXIS_DIVISOR_R5
            : 0,
          lastAppliedMoveZ: 0,
          lastAppliedButtons: 0,
          nativeInputPending: false,
          pendingInputSequence: null,
        };
      });
      (engine as unknown as { rustLiveInputAdvance: Promise<void> | null }).rustLiveInputAdvance = operation;
      void operation.finally(() => {
        const owner = engine as unknown as { rustLiveInputAdvance: Promise<void> | null };
        if (owner.rustLiveInputAdvance === operation) owner.rustLiveInputAdvance = null;
      });
    },
  });

  await assert.rejects(
    engine.pulseRustLiveMovementForAutomationR5("KeyD", 3),
    /did not apply its exact native movement frame/u,
  );

  assert.deepEqual(sampledKeys, [["KeyD"], ["KeyD"], []]);
  assert.equal(diagnostics.nextInputSequence, 4);
  assert.equal(diagnostics.lastAppliedMoveX, 0);
  assert.equal(diagnostics.lastAppliedMoveZ, 0);
  assert.equal(diagnostics.lastAppliedButtons, 0);
  assert.deepEqual([...(engine as unknown as { keys: Set<string> }).keys], []);
  assert.equal((engine as unknown as { rustLiveAutomationPulseR5: boolean }).rustLiveAutomationPulseR5, false);
});

test("browser movement automation rejects contaminated modifier input before native sampling", async () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  let schedules = 0;
  const pump = {
    diagnostics: () => ({
      state: "ready" as const,
      nextInputSequence: 1,
      lastAppliedMoveX: 0,
      lastAppliedMoveZ: 0,
      lastAppliedButtons: 0,
      authoritativeFlags: 0,
      latchedActionTransitions: 0,
      nativeInputPending: false,
      pendingInputSequence: null,
      lastError: null,
    }),
  };
  Object.assign(engine, {
    running: true,
    paused: false,
    titleMode: false,
    keys: new Set<string>(["ShiftLeft"]),
    sprintLatched: false,
    mineHeld: false,
    rustSecondaryUseHeld: false,
    rustCreativeFlightTogglePulse: false,
    rustDropPulse: false,
    rustLiveAutomationPulseR5: false,
    rustLiveInputPump: pump,
    rustLivePlayerAuthorityGeneration: 7,
    rustLiveInputAdvance: null,
    rustLivePlayerAuthorityEnabledR5: () => true,
    scheduleRustLiveInputAdvanceR5: () => { schedules += 1; },
  });

  await assert.rejects(
    engine.pulseRustLiveMovementForAutomationR5("KeyD", 1),
    /requires an exact neutral non-movement\/action state/u,
  );

  assert.equal(schedules, 0);
  assert.deepEqual([...(engine as unknown as { keys: Set<string> }).keys], ["ShiftLeft"]);
  assert.equal((engine as unknown as { rustLiveAutomationPulseR5: boolean }).rustLiveAutomationPulseR5, false);
});

test("engine source orders the exact player gate before composer and suppresses claimed legacy input mutations", async () => {
  const source = await readFile(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  const activation = source.slice(
    source.indexOf("  private async activateRustWorldRuntime("),
    source.indexOf("\n  /**\n   * Production world creation", source.indexOf("  private async activateRustWorldRuntime(")),
  );
  const playerPolicy = activation.indexOf("if (this.rustLivePlayerAuthorityRequestedR5)");
  const playerActivationIndex = activation.indexOf("await this.rustLivePlayerAuthorityActivation({");
  const rendererActivation = activation.indexOf("this.activateRustLiveRendererR10");
  assert.ok(activation.indexOf("await this.rustWorldHydration") < playerPolicy);
  assert.ok(playerPolicy >= 0 && playerActivationIndex > playerPolicy && rendererActivation > playerActivationIndex);
  assert.match(source, /updateMining\(dt: number\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /updatePlayer\(dt: number\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  const selectedUse = source.slice(
    source.indexOf("  useSelected() {"),
    source.indexOf("\n  private performSelectedUse()", source.indexOf("  useSelected() {")),
  );
  const locatorIntercept = selectedUse.indexOf("if (this.interceptRustTerrainLocatorSelectedUse()) return true;");
  const liveSecondaryUseGate = selectedUse.indexOf("if (this.rustLivePlayerAuthorityEnabledR5()) {");
  const liveSecondaryUseDispatch = selectedUse.indexOf("this.rustSecondaryUseHeld = true;");
  assert.ok(locatorIntercept >= 0 && locatorIntercept < liveSecondaryUseGate,
    "locator chart/lair interception must return before the generic native secondary-use gate");
  assert.ok(liveSecondaryUseGate < liveSecondaryUseDispatch,
    "only a non-locator live use may dispatch the generic native secondary-use pulse");
  assert.equal(selectedUse.match(/rustSecondaryUseHeld = true;/gu)?.length, 1,
    "locator interception cannot fall through into a duplicate native secondary-use dispatch");
  assert.match(source, /dropSelectedItem\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\)/u);
  assert.match(source, /selectSlot\(slot: number\) \{\s*\n\s*const selected =[\s\S]*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\)/u);
  assert.match(source, /pickTarget\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /breakTarget\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /castSelectedMagicSpell\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return false;/u);
  assert.match(source, /startRangedReload\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return false;/u);
  assert.match(source, /private fireSelectedRangedWeapon\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return false;/u);
  assert.match(source, /attackTargetMob\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /damagePlayer\([^\n]+\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) \{\s*\n\s*this\.rustLiveSuppressedLegacyDamageCallsR5 \+= 1;\s*\n\s*return;\s*\n\s*\}/u);
  assert.match(source, /private applyCombatEventToLocalPlayer\([^\n]+\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return false;/u);
  assert.match(source, /applyPlayerKnockback\([^\n]+\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return 0;/u);
  assert.match(source, /respawn\(announce: boolean\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /dismountBoat\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /packTargetBoat\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return false;/u);
  assert.match(source, /private beginLocalCreatureRide\([^\n]+\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return false;/u);
  assert.match(source, /dismountCreature\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /private triggerMountedCreatureMove\([^\n]+\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return false;/u);
  assert.match(source, /performDragonAttack\([^\n]+\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\) && mob\.id === this\.mountedCreatureId\) return false;/u);
  assert.match(source, /updateBoats\(dt: number\) \{\s*\n\s*const rustLivePlayerAuthority = this\.rustLivePlayerAuthorityEnabledR5\(\)/u);
  assert.match(source, /const localDriver = !rustLivePlayerAuthority && localSeat === 0/u);
  assert.match(source, /if \(localSeat >= 0 && !rustLivePlayerAuthority\)/u);
  assert.match(source, /updateMobs\(dt: number\) \{\s*\n\s*const rustLivePlayerAuthority = this\.rustLivePlayerAuthorityEnabledR5\(\);\s*\n\s*if \(!rustLivePlayerAuthority\) this\.updateTemporaryMagic\(\)/u);
  assert.match(source, /if \(!this\.rustLivePlayerAuthorityEnabledR5\(\)\) \{\s*\n\s*const now = this\.worldSimulationSeconds\(\);\s*\n\s*const ironwake = consumeIronwakeFragment/u);
  assert.doesNotMatch(source, /scheduleRustRendererExtractionR10|runtimeService\(\)\.extract\(/u);
  assert.match(source, /\|\| this\.rustLiveInputAdvance\) return;/u);
  assert.match(source, /decodeRustLivePlayerViewR10\(extraction, attestation\.externalEntityId\)/u);
  const networkExclusive = source.slice(
    source.indexOf("  private runRustLivePumpNetworkExclusiveR5"),
    source.indexOf("\n  private projectRustLivePlayerViewR10", source.indexOf("  private runRustLivePumpNetworkExclusiveR5")),
  );
  assert.match(networkExclusive, /host\.multiplayerAuthority\(\)\.runExclusiveMutation/u);
  assert.ok(networkExclusive.indexOf("await pump.adoptExternalNetworkSuccessor(generation)")
    < networkExclusive.indexOf("return await operation()"),
  "the shared R9 queue must adopt the exact network successor before the dependent pump operation");
  const pumpAdvance = source.slice(
    source.indexOf("  private scheduleRustLiveInputAdvanceR5()"),
    source.indexOf("\n  private quarantineRustLivePlayerAuthorityR5", source.indexOf("  private scheduleRustLiveInputAdvanceR5()")),
  );
  assert.ok(pumpAdvance.indexOf("this.runRustLivePumpNetworkExclusiveR5(")
    < pumpAdvance.indexOf("await pump.advance(generation, { view: requestedView })"));
  assert.ok(pumpAdvance.indexOf("await pump.advance(generation, { view: requestedView })")
    < pumpAdvance.indexOf("this.applyRustLiveAuthorityExtractionR10("));
  assert.ok(pumpAdvance.indexOf("this.applyRustLiveAuthorityExtractionR10(")
    < pumpAdvance.indexOf("this.enqueueRustLiveRendererExtractionR10({"),
  "the player and camera mirrors must decode before extraction enters composer submission");
  assert.doesNotMatch(pumpAdvance, /rustLiveRendererExtractionQueue[^\n]*return/u,
    "renderer backpressure cannot stop the fixed-step player pump");
  const rendererQueue = source.slice(
    source.indexOf("  private enqueueRustLiveRendererExtractionR10("),
    source.indexOf("\n  private scheduleRustLiveInputAdvanceR5", source.indexOf("  private enqueueRustLiveRendererExtractionR10(")),
  );
  assert.match(rendererQueue, /RUST_LIVE_RENDER_EXTRACTION_QUEUE_CAP_R10/u);
  assert.match(rendererQueue, /this\.quarantineRustLiveRendererR10\(/u);
  const rendererSubmit = source.slice(
    source.indexOf("  private scheduleRustLiveInputExtractionPresentationR10("),
    source.indexOf("\n  publishRendererExtractionR11", source.indexOf("  private scheduleRustLiveInputExtractionPresentationR10(")),
  );
  assert.match(rendererSubmit, /this\.rustLiveRendererExtractionQueue\.shift\(\)/u);
  assert.match(rendererSubmit, /this\.quarantineRustLiveRendererR10\(error, runtime\)/u);
  assert.doesNotMatch(rendererSubmit, /quarantineRustLivePlayerAuthorityR5/u);
  const playerActivation = source.slice(
    source.indexOf("  private async activateRustLivePlayerAuthorityR5("),
    source.indexOf("\n  private async stopRustLivePlayerAuthorityR5", source.indexOf("  private async activateRustLivePlayerAuthorityR5(")),
  );
  assert.ok(playerActivation.indexOf("this.runRustLivePumpNetworkExclusiveR5(")
    < playerActivation.indexOf("await pump.syncInitial(generation, requestedView)"));
  assert.ok(playerActivation.indexOf("await pump.syncInitial(generation, requestedView)")
    < playerActivation.indexOf("this.applyRustLiveAuthorityExtractionR10("));
  assert.ok(playerActivation.indexOf("this.assertRustLiveGenerationR5(generation, host, \"initial input synchronization\")")
    < playerActivation.indexOf("this.applyRustLiveAuthorityExtractionR10("));
  assert.ok(playerActivation.indexOf("this.applyRustLiveAuthorityExtractionR10(")
    < playerActivation.indexOf("this.enqueueRustLiveRendererExtractionR10({"));
  const playerProjection = source.slice(
    source.indexOf("  private projectRustLivePlayerViewR10("),
    source.indexOf("\n  private applyRustLivePlayerExtractionR10", source.indexOf("  private projectRustLivePlayerViewR10(")),
  );
  assert.match(playerProjection, /attestation\.maximumHealth !== 10 \|\| view\.maximumHealth !== attestation\.maximumHealth/u);
  assert.match(playerProjection, /this\.health = view\.health/u);
  assert.doesNotMatch(playerProjection, /view\.health\s*\/|view\.health\s*\*/u);
  assert.match(playerProjection, /view\.lookYaw \/ RUST_LIVE_INPUT_AXIS_DIVISOR_R5 \* Math\.PI/u);
  assert.match(playerProjection, /view\.lookPitch \/ RUST_LIVE_INPUT_AXIS_DIVISOR_R5 \* \(Math\.PI \/ 2\)/u);
  assert.match(playerProjection, /this\.selected = view\.selectedSlot/u);
  assert.match(playerProjection, /if \(!this\.rustLiveSelectedSlotIntentPendingR5 \|\| selectedAcknowledged\)/u);
  assert.match(playerProjection, /selectedAcknowledged && this\.rustNativeSaveQueued && !this\.rustNativeSaveOperation/u);
  assert.match(playerProjection, /if \(!this\.rustLiveLookIntentPendingR5 \|\| lookAcknowledged\)/u);
  assert.match(playerProjection, /this\.creativeFlying = \(view\.authoritativeFlags/u);
  assert.match(playerProjection, /this\.oxygenSeconds = view\.oxygenSeconds/u);
  assert.match(playerProjection, /view\.combat\.vitalUnits !== "millihearts-v1"/u);
  assert.match(playerProjection, /view\.combat\.recordId !== view\.actorId/u);
  assert.match(playerProjection, /view\.health !== Math\.fround\(view\.combat\.health \/ 1_000\)/u);
  assert.match(playerProjection, /this\.headSubmerged = view\.headSubmerged/u);
  assert.match(playerProjection, /this\.drowningAccumulator = view\.drowningAccumulator/u);
  assert.match(playerProjection, /this\.audio\.play\("hurt"\)/u);
  assert.match(playerProjection, /this\.events\.onDeath\(\)/u);
  const wheel = source.slice(source.indexOf("  onWheel ="), source.indexOf("\n  onKeyDown =", source.indexOf("  onWheel =")));
  assert.match(wheel, /this\.rustLiveSelectedSlotIntentR5 \?\? this\.selected/u);
  const locatorContext = source.slice(
    source.indexOf("  private rustTerrainLocatorRuntimeContext("),
    source.indexOf("\n  private rustTerrainLocatorIntent(", source.indexOf("  private rustTerrainLocatorRuntimeContext(")),
  );
  assert.match(locatorContext, /player\.selectedSlot !== this\.selected/u,
    "autosave deferral must not weaken the strict native/browser selected-slot equality");
  const nativeSave = source.slice(
    source.indexOf("  private scheduleRustNativeSaveCheckpoint("),
    source.indexOf("\n  private requireRustNativePlayerSaveBinding(", source.indexOf("  private scheduleRustNativeSaveCheckpoint(")),
  );
  assert.match(nativeSave, /if \(this\.rustLiveSelectedSlotIntentPendingR5\)[\s\S]*this\.rustNativeSaveQueued = true;[\s\S]*return;/u);
  assert.match(nativeSave, /&& !this\.rustLiveSelectedSlotIntentPendingR5/u,
    "a deferred save must not self-reschedule until Rust acknowledges the intent");
  const loadWrapper = source.slice(
    source.indexOf("  async loadWorldWithRustRuntime("),
    source.indexOf("\n  async loadStoredWorldWithRustRuntime", source.indexOf("  async loadWorldWithRustRuntime(")),
  );
  assert.ok(loadWrapper.indexOf("this.loadWorld(save, options, worldId)")
    < loadWrapper.indexOf("this.reapplyRustLivePlayerViewR10(generation, host)"));
  assert.ok(loadWrapper.indexOf("this.reapplyRustLivePlayerViewR10(generation, host)")
    < loadWrapper.indexOf("this.rustRuntimeOperationsBlocked = false"));
  const storedLoadWrapper = source.slice(
    source.indexOf("  async loadStoredWorldWithRustRuntime("),
    source.indexOf("\n  /**\n   * Synchronous catalog deletion", source.indexOf("  async loadStoredWorldWithRustRuntime(")),
  );
  assert.ok(storedLoadWrapper.indexOf("this.loadWorld(loaded.value.save, loaded.value.options, id)")
    < storedLoadWrapper.indexOf("this.reapplyRustLivePlayerViewR10(generation, host)"));
  assert.ok(storedLoadWrapper.indexOf("this.reapplyRustLivePlayerViewR10(generation, host)")
    < storedLoadWrapper.indexOf("this.rustRuntimeOperationsBlocked = false"));
  const finalizer = source.slice(
    source.indexOf("  private async finalizeRustWorldRuntime("),
    source.indexOf("\n  private async cleanupFailedRustWorldTransition(", source.indexOf("  private async finalizeRustWorldRuntime(")),
  );
  assert.ok(finalizer.indexOf("await this.rustLivePlayerAuthorityActivation")
    < finalizer.indexOf("await this.checkpointRustLivePlayerNative(generation, pump)"));
  assert.ok(finalizer.indexOf("await this.checkpointRustLivePlayerNative(generation, pump)")
    < finalizer.indexOf("this.activateRustLiveRendererR10(generation, host)"));
  assert.match(finalizer, /if \(kind === "create" && this\.rustLivePlayerAuthorityRequestedR5\)/u);
  const assertOrdered = (scope: string, stages: readonly string[]) => {
    let previous = -1;
    for (const stage of stages) {
      const next = scope.indexOf(stage);
      assert.ok(next > previous, `${stage} must follow the preceding shutdown stage`);
      previous = next;
    }
  };
  const transition = source.slice(source.indexOf("  private async prepareRustWorldTransition("), source.indexOf("\n  private async activateRustWorldRuntime(", source.indexOf("  private async prepareRustWorldTransition(")));
  const transitionDrains = [...transition.matchAll(/await this\.drainRustAuthorityOperations\(\)/gu)]
    .map((match) => match.index);
  assert.equal(transitionDrains.length, 2, "transition drains both prepared locator work and save-triggered checkpoints");
  assertOrdered(transition, [
    "this.cancelTerrainLocatorConsumerOperations()",
    "await this.drainRustAuthorityOperations()",
    "this.saveNow(false, preserveMultiplayerSession)",
    "await this.worldStorage.flushPersistence()",
    "await attemptTeardown(() => this.closeMultiplayerForRustTransition(reason))",
    "await attemptTeardown(() => this.stopRustLivePlayerAuthorityR5())",
    "await attemptTeardown(() => this.disposeRustLiveRendererR10())",
    "await attemptTeardown(() => this.shutdownBoundNativePersistence())",
  ]);
  assert.match(transition, /throw new AggregateError\(teardownFailures,/u,
    "transition teardown must attempt every owner before reporting aggregated cleanup failure");
  assert.ok(transitionDrains[0]! < transition.indexOf("this.saveNow(false, preserveMultiplayerSession)")
    && transition.indexOf("this.saveNow(false, preserveMultiplayerSession)") < transitionDrains[1]!
    && transitionDrains[1]! < transition.indexOf("await this.worldStorage.flushPersistence()"),
  "the second transition drain must settle the checkpoint scheduled by save before persistence flushes");
  const quit = source.slice(source.indexOf("  async quitToTitleAsync()"), source.indexOf("\n  /** @deprecated", source.indexOf("  async quitToTitleAsync()")));
  const quitDrains = [...quit.matchAll(/await this\.drainRustAuthorityOperations\(\)/gu)]
    .map((match) => match.index);
  assert.equal(quitDrains.length, 2, "quit directly drains locator work and save-triggered checkpoints");
  const postMultiplayerDrain = quit.indexOf('await attemptCleanup("authority drain", () => this.drainRustAuthorityOperations())');
  assert.ok(postMultiplayerDrain >= 0, "quit must attempt an additional authority drain after multiplayer disconnect");
  assertOrdered(quit, [
    "this.cancelTerrainLocatorConsumerOperations()",
    "await this.drainRustAuthorityOperations()",
    "this.saveNow()",
    "await this.worldStorage.flushPersistence()",
    'await attemptCleanup("multiplayer disconnect", () => this.disconnectMultiplayer("quit-to-title"))',
    'await attemptCleanup("authority drain", () => this.drainRustAuthorityOperations())',
    'await attemptCleanup("player authority stop", () => this.stopRustLivePlayerAuthorityR5())',
    'await attemptCleanup("renderer disposal", () => this.disposeRustLiveRendererR10())',
    'await attemptCleanup("native persistence shutdown", () => this.shutdownBoundNativePersistence())',
    'await attemptCleanup("runtime manager shutdown", () => this.rustRuntimeManager.shutdown())',
  ]);
  const quitCheckpoint = "const checkpointAttestation = nativeCheckpoint ? await nativeCheckpoint : null";
  assert.ok(quitDrains[0]! < quit.indexOf("this.saveNow()")
    && quit.indexOf("this.saveNow()") < quit.indexOf(quitCheckpoint)
    && quit.indexOf(quitCheckpoint) < quitDrains[1]!
    && quitDrains[1]! < quit.indexOf("await this.worldStorage.flushPersistence()")
    && quit.indexOf('await attemptCleanup("multiplayer disconnect"') < postMultiplayerDrain
    && postMultiplayerDrain < quit.indexOf('await attemptCleanup("player authority stop"'),
  "quit must settle every authority producer before stopping the player pump");
  assert.match(quit, /if \(nativeCheckpointRequired && !nativeCheckpoint\)[\s\S]*required authoritative Rust checkpoint/u);
  assert.ok(quit.indexOf("} catch (error) {") < quit.indexOf('await attemptCleanup("multiplayer disconnect"'));

  const keyStart = source.indexOf("  onKeyDown = (event: KeyboardEvent) => {");
  const keyEnd = source.indexOf("\n  onKeyUp =", keyStart);
  const keys = source.slice(keyStart, keyEnd);
  const shellRoute = keys.indexOf("if (this.openShellOverlayForKey(event)) return;");
  const liveStart = keys.indexOf("if (this.rustLivePlayerAuthorityEnabledR5()) {");
  const legacySpell = keys.indexOf('if (event.code === "KeyQ"');
  assert.ok(shellRoute >= 0 && shellRoute < liveStart, "shell-only keys must route before the native gameplay gate");
  assert.ok(liveStart >= 0 && liveStart < legacySpell, "the native gate must run before every legacy gameplay key");
  const liveBranch = keys.slice(liveStart, legacySpell);
  const shellKeyRouter = source.slice(
    source.indexOf("  private openShellOverlayForKey("),
    source.indexOf("\n  onKeyDown =", source.indexOf("  private openShellOverlayForKey(")),
  );
  for (const forbidden of [
    "startRangedReload(",
    "performDragonAttack(",
    "triggerMountedCreatureMove(",
    "dismountBoat(",
    "dismountCreature(",
    "castSelectedMagicSpell(",
  ]) assert.doesNotMatch(liveBranch, new RegExp(forbidden.replace("(", "\\("), "u"));
  assert.match(liveBranch, /this\.dropSelectedItem\(\)/u);
  const playerDrop = source.slice(
    source.indexOf("  dropSelectedItem() {"),
    source.indexOf("\n  clearEntities()", source.indexOf("  dropSelectedItem() {")),
  );
  assert.match(playerDrop, /rustDropPulse = true/u);
  assert.match(liveBranch, /event\.code === "KeyF"\) event\.preventDefault\(\)/u);
  assert.match(liveBranch, /this\.keys\.add\(event\.code\)/u);
  for (const [code, overlay] of [["KeyE", "inventory"], ["KeyM", "map"], ["KeyJ", "quests"], ["KeyK", "magic"], ["KeyL", "skills"], ["KeyB", "bestiary"]]) {
    assert.match(shellKeyRouter, new RegExp(`case "${code}": overlay = "${overlay}"`, "u"));
  }
  assert.match(shellKeyRouter, /if \(event\.repeat\) return true/u);
  assert.match(shellKeyRouter, /this\.openOverlay\("bestiary", `creature:\$\{this\.targetMob\.kind\}`\)/u);
  assert.doesNotMatch(shellKeyRouter, /rustDropPulse|startRangedReload|castSelectedMagicSpell|dismount|triggerMounted|performDragon/u);
  assert.doesNotMatch(source, /rustInteractPulse/u);
  assert.doesNotMatch(source, /rustMountTogglePulse/u);
  assert.match(source, /interact: false,/u);
  assert.match(source, /mountToggle: false,/u);

  const mouseStart = source.indexOf("  onMouseDown = (event: MouseEvent) => {");
  const mouseEnd = source.indexOf("\n  onMouseUp =", mouseStart);
  const mouse = source.slice(mouseStart, mouseEnd);
  assert.match(mouse, /this\.mineHeld = true;\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(mouse, /event\.button === 2[\s\S]*rustSecondaryUseHeld = true;\s*\n\s*return;/u);
  assert.match(mouse, /event\.button === 1 && !this\.rustLivePlayerAuthorityEnabledR5\(\)/u);

  const keyUp = source.slice(source.indexOf("  onKeyUp ="), source.indexOf("\n  clearInput =", source.indexOf("  onKeyUp =")));
  assert.ok(keyUp.indexOf("if (this.rustLivePlayerAuthorityEnabledR5())") < keyUp.indexOf('if (event.code === "KeyQ")'));
  const jump = source.slice(source.indexOf("  jump() {"), source.indexOf("\n  private recordCreativeFlightTap", source.indexOf("  jump() {")));
  assert.ok(jump.indexOf("if (this.rustLivePlayerAuthorityEnabledR5())") < jump.indexOf("this.dismountCreature()"));

  const manual = source.slice(source.indexOf("  advanceSimulation(milliseconds: number)"), source.indexOf("\n  emitHud(", source.indexOf("  advanceSimulation(milliseconds: number)")));
  assert.match(manual, /if \(!rustLivePlayerAuthority\) this\.updatePlayer\(dt\)/u);
  assert.match(manual, /if \(!rustLivePlayerAuthority\) \{\s*\n\s*this\.updateRangedWeapon\(dt\);\s*\n\s*this\.updateFastTravelChannel\(\);\s*\n\s*this\.updateMapDiscovery\(dt\);\s*\n\s*this\.magicState = regenerateMana/u);
  assert.match(manual, /if \(rustLivePlayerAuthority && !this\.rustLiveAutomationPulseR5\) this\.scheduleRustLiveInputAdvanceR5\(\)/u);

  const animate = source.slice(source.indexOf("  animate = (now: number)"), source.indexOf("\n  advanceSimulation(milliseconds: number)", source.indexOf("  animate = (now: number)")));
  assert.match(animate, /if \(this\.running && !this\.titleMode && !this\.paused && !rustLivePlayerAuthority\) \{\s*\n\s*this\.magicState = regenerateMana/u);
  assert.match(animate, /if \(!rustLivePlayerAuthority\) \{\s*\n\s*this\.updateRangedWeapon\(dt\);\s*\n\s*this\.updateFastTravelChannel\(\);\s*\n\s*this\.updateMapDiscovery\(dt\)/u);
  assert.match(animate, /if \(rustLivePlayerAuthority && !this\.rustLiveAutomationPulseR5\) \{\s*\n\s*this\.scheduleRustLiveInputAdvanceR5\(\)/u);
});

test("the checked-in Wasm advertises final fixed-step protocol support without enabling product policy", async () => {
  const source = await readFile(new URL("../engine/crates/blockwild-wasm/src/integrated_runtime.rs", import.meta.url), "utf8");
  const capabilities = source.slice(source.indexOf("const CAPABILITIES"), source.indexOf("];", source.indexOf("const CAPABILITIES")) + 2);
  assert.match(capabilities, /"fixed-step-input-v1"/u);
  assert.doesNotMatch(capabilities, /fixed-step-input-v1-pending-live-cutover/u);
  assert.match(capabilities, /"bounded-extraction-v1"/u);
  assert.match(capabilities, /bounded-extraction-blockers-v1/u);
  assert.match(capabilities, /"player-respawn-v1"/u);
  assert.doesNotMatch(capabilities, /bounded-extraction-v1-pending-live-domain-views/u);
  assert.doesNotMatch(source, /fn extraction_promotion_ready/u);
});
