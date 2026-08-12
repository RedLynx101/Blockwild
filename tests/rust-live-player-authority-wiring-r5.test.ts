import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCharacterProfile } from "../app/game/character-profiles.ts";
import { Item } from "../app/game/data.ts";
import { VoxelEngine, type WorldSave } from "../app/game/engine.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
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
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeInputFrameV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RUST_RUNTIME_INPUT_BUTTON_V1,
} from "../app/game/rust-integrated-runtime-contract.ts";
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
import type { RustIntegratedRuntimeServiceV1 } from "../app/game/rust-integrated-runtime-service.ts";
import type { RustWorldRuntimeHostConfigV1 } from "../app/game/rust-world-runtime-host.ts";
import type { RustWorldRuntimeManagedHostV1 } from "../app/game/rust-world-runtime-manager.ts";
import { canonicalRustTerrainGenerationOptionsJsonV1 } from "../app/game/rust-world-runtime-live-config.ts";
import { RUST_LIVE_INPUT_AXIS_DIVISOR_R5 } from "../app/game/rust-live-input-pump-r5.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";

const ZERO_HASH = "0".repeat(32);
const ZERO_BYTES = new Uint8Array(16);
const PLAYER_ENTITY_ID = BigInt("4294967297");
const encoder = new TextEncoder();
const READY_CAPABILITIES = Object.freeze([
  "awaited-receipts-v1",
  "bounded-extraction-v1",
  "content-bundle-install-v1",
  "entity-compatibility-bridge-v1",
  "fixed-step-input-v1",
  "gameplay-command-v1",
  "integrated-runtime-v1",
  "terrain-residency-reconcile-v2",
]);

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
  oxygenSeconds: number;
  maximumOxygenSeconds: number;
  lastInputSequence: bigint;
  buttons: number;
  flags: number;
  selectedSlot: number;
  lookYaw: number | null;
  lookPitch: number;
};

function playerDomainBundle(
  state: Readonly<PlayerExtractionState>,
  authorityTick: number,
  externalEntityId: string,
  actorId: string,
  playerId: bigint,
  entityId: bigint,
) {
  const runtimeFields: DomainField[] = [
    ["buttons", u64Field(state.buttons)],
    ["crouching", boolField(state.crouching)],
    ["entityId", u64Field(entityId)],
    ["flags", u64Field(state.flags)],
    ["grounded", boolField(state.grounded)],
    ["height", f64Field(1.8)],
    ["lastInputSequence", u64Field(state.lastInputSequence)],
    ["lookPitch", i64Field(state.lookPitch)],
    ["mass", f64Field(1.15)],
    ["maximumOxygenSeconds", f64Field(state.maximumOxygenSeconds)],
    ["oxygenSeconds", f64Field(state.oxygenSeconds)],
    ["position.x", f64Field(Math.fround(state.position.x))],
    ["position.y", f64Field(Math.fround(state.position.y))],
    ["position.z", f64Field(Math.fround(state.position.z))],
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
    ])).finish();
  const writer = new Writer().raw(encoder.encode("BWX0")).u16(1)
    .u64(state.extractionRevision).u64(authorityTick).raw(ZERO_BYTES).raw(ZERO_BYTES).u8(0).u16(8);
  for (let domain = 1; domain <= 8; domain += 1) {
    const payload = domain === 2 ? rows : new Uint8Array();
    const count = domain === 2 ? 2 : 0;
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

class RestoredRuntimeService {
  current = identity();
  worldRevision = Object.freeze({ epoch: BigInt(1), mutation: BigInt(0), residency: BigInt(0) });
  readonly batches: RustIntegratedRuntimeCommandBatchV1[] = [];
  readonly submittedInputs: RustIntegratedRuntimeInputFrameV1[] = [];
  extractCalls = 0;
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
    oxygenSeconds: 12,
    maximumOxygenSeconds: 12,
    lastInputSequence: BigInt(0),
    buttons: 0,
    flags: 0,
    selectedSlot: 0,
    lookYaw: null,
    lookPitch: 0,
  };

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
        authoritativeFlags: 0,
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

  async command(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1> {
    this.batches.push(batch);
    const operation = batch.operations[0];
    const before = this.current;
    let response;
    if (operation.typeId === RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1) {
      response = createRustIntegratedRuntimeDomainOperationV1({
        domain: "simulation",
        typeId: RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_RECEIPT_TYPE_V1,
        schema: 1,
        payload: this.statusPayload(operation.payloadHash),
      });
    } else if (operation.typeId === RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2) {
      const request = decodeRustIntegratedTerrainResidencyReconcileRequestV2(operation.payload);
      this.worldRevision = Object.freeze({ ...request.expectedWorldRevision, residency: request.expectedWorldRevision.residency + BigInt(1) });
      this.current = identity({
        revision: Object.freeze({ ...before.revision, world: Number(this.worldRevision.mutation + this.worldRevision.residency) }),
        stateHash: "4".repeat(32),
      });
      response = createRustIntegratedRuntimeDomainOperationV1({
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
      });
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
      domainReceipts: Object.freeze([response]),
      receiptHash: ZERO_HASH,
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

  async extract(): Promise<RustIntegratedRuntimeExtractionV1> {
    this.extractCalls += 1;
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
      health: 10,
      maximumHealth: 10,
      tamed: false,
      ageTicks: BigInt(0),
      movementMode: "ground",
      grounded: this.presentation.grounded,
      submerged: false,
      lastDamageTick: BigInt(0),
      action: Object.freeze({ key: "idle", phase: 0, startedTick: BigInt(0), endsTick: BigInt(0), target: null }),
      equipment: Object.freeze([]),
      mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
      research: Object.freeze([]),
    });
    const entities: RustEntityExtractionR6V3 = Object.freeze({
      schema: 3,
      extractionRevision: BigInt(this.presentation.extractionRevision),
      authorityTick: BigInt(this.current.tick),
      contentManifestHash: ZERO_BYTES,
      contentReady: false,
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
      ),
      audio: new Uint8Array(),
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
    multiplayerAuthority: () => ({}) as ReturnType<RustWorldRuntimeManagedHostV1["multiplayerAuthority"]>,
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
    rustLivePlayerAuthorityState: "none",
    rustLivePlayerAuthorityGeneration: null,
    rustLivePlayerEntityId: null,
    rustLivePlayerTerrainChunkCount: 0,
    rustLivePlayerAuthorityLastError: null,
    rustLiveInputPump: null,
    rustLiveInputAdvance: null,
    rustLiveRendererExtractionQueue: [],
    rustLiveRenderRuntime: null,
    rustAuthorityOperations: new Set<Promise<unknown>>(),
    rustLivePlayerAttestationR10: null,
    rustLivePlayerPresentationViewR10: null,
    rustLivePlayerViewExtractionRevisionR10: null,
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
    RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
    RUST_INTEGRATED_PLAYER_BOOTSTRAP_STATUS_TYPE_V1,
  ], "a complete restored native graph must not receive BWI/BWF/entity-import overwrite operations");
  await (engine as unknown as { stopRustLivePlayerAuthorityR5(): Promise<void> }).stopRustLivePlayerAuthorityR5();
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
      applyRustLivePlayerExtractionR10(
        generation: number,
        host: RustWorldRuntimeManagedHostV1,
        pump: unknown,
        extraction: RustIntegratedRuntimeExtractionV1,
      ): void;
      rustLiveInputPump: unknown;
    }).applyRustLivePlayerExtractionR10(
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
    events: { onSelectedSlot: () => undefined },
    emitHud: () => undefined,
  });
  Object.defineProperties(engine, {
    target: { get: () => { throw new Error("legacy target read"); }, configurable: true },
    targetMob: { get: () => { throw new Error("legacy mob read"); }, configurable: true },
    magicState: { get: () => { throw new Error("legacy magic read"); }, configurable: true },
    inventory: { get: () => { throw new Error("legacy inventory read"); }, configurable: true },
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

test("engine source orders the exact player gate before composer and suppresses claimed legacy input mutations", async () => {
  const source = await readFile(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  const activation = source.slice(
    source.indexOf("  private async activateRustWorldRuntime("),
    source.indexOf("\n  /**\n   * Production world creation", source.indexOf("  private async activateRustWorldRuntime(")),
  );
  assert.ok(activation.indexOf("await this.rustWorldHydration")
    < activation.indexOf("await this.rustLivePlayerAuthorityActivation?."));
  assert.ok(activation.indexOf("await this.rustLivePlayerAuthorityActivation?.")
    < activation.indexOf("this.activateRustLiveRendererR10"));
  assert.match(source, /updateMining\(dt: number\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /updatePlayer\(dt: number\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /useSelected\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\)/u);
  assert.match(source, /dropSelectedItem\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\)/u);
  assert.match(source, /selectSlot\(slot: number\) \{\s*\n\s*const selected =[\s\S]*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\)/u);
  assert.match(source, /pickTarget\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /breakTarget\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /castSelectedMagicSpell\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return false;/u);
  assert.match(source, /startRangedReload\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return false;/u);
  assert.match(source, /private fireSelectedRangedWeapon\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return false;/u);
  assert.match(source, /attackTargetMob\(\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
  assert.match(source, /damagePlayer\([^\n]+\) \{\s*\n\s*if \(this\.rustLivePlayerAuthorityEnabledR5\(\)\) return;/u);
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
  assert.match(source, /else if \(!this\.rustLiveInputPump\) \{\s*\n\s*this\.scheduleRustRendererExtractionR10/u);
  assert.match(source, /\|\| this\.rustLiveInputAdvance\) return;/u);
  assert.match(source, /decodeRustLivePlayerViewR10\(extraction, attestation\.externalEntityId\)/u);
  const pumpAdvance = source.slice(
    source.indexOf("  private scheduleRustLiveInputAdvanceR5()"),
    source.indexOf("\n  private quarantineRustLivePlayerAuthorityR5", source.indexOf("  private scheduleRustLiveInputAdvanceR5()")),
  );
  assert.ok(pumpAdvance.indexOf("await pump.advance(generation)")
    < pumpAdvance.indexOf("this.applyRustLivePlayerExtractionR10(generation, host, pump, result.extraction)"));
  assert.ok(pumpAdvance.indexOf("this.applyRustLivePlayerExtractionR10(generation, host, pump, result.extraction)")
    < pumpAdvance.indexOf("this.enqueueRustLiveRendererExtractionR10({ generation, host, pump, extraction: result.extraction })"),
  "the player mirror must decode before the extraction can enter composer submission");
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
  assert.ok(playerActivation.indexOf("await pump.syncInitial(generation)")
    < playerActivation.indexOf("this.applyRustLivePlayerExtractionR10(generation, host, pump, initial.extraction)"));
  assert.ok(playerActivation.indexOf("this.assertRustLiveGenerationR5(generation, host, \"initial input synchronization\")")
    < playerActivation.indexOf("this.applyRustLivePlayerExtractionR10(generation, host, pump, initial.extraction)"));
  assert.ok(playerActivation.indexOf("this.applyRustLivePlayerExtractionR10(generation, host, pump, initial.extraction)")
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
  assert.match(playerProjection, /if \(!this\.rustLiveLookIntentPendingR5 \|\| lookAcknowledged\)/u);
  assert.match(playerProjection, /this\.creativeFlying = \(view\.authoritativeFlags/u);
  assert.match(playerProjection, /this\.oxygenSeconds = view\.oxygenSeconds/u);
  const wheel = source.slice(source.indexOf("  onWheel ="), source.indexOf("\n  onKeyDown =", source.indexOf("  onWheel =")));
  assert.match(wheel, /this\.rustLiveSelectedSlotIntentR5 \?\? this\.selected/u);
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
  const assertOrdered = (scope: string, stages: readonly string[]) => {
    let previous = -1;
    for (const stage of stages) {
      const next = scope.indexOf(stage);
      assert.ok(next > previous, `${stage} must follow the preceding shutdown stage`);
      previous = next;
    }
  };
  const transition = source.slice(source.indexOf("  private async prepareRustWorldTransition("), source.indexOf("\n  private async activateRustWorldRuntime(", source.indexOf("  private async prepareRustWorldTransition(")));
  assertOrdered(transition, [
    "await this.stopRustLivePlayerAuthorityR5()",
    "this.saveNow(false)",
    "await this.worldStorage.flushPersistence()",
    "await this.closeMultiplayerForRustTransition(reason)",
    "await this.drainRustAuthorityOperations()",
    "await this.disposeRustLiveRendererR10()",
    "await this.shutdownBoundNativePersistence()",
  ]);
  const quit = source.slice(source.indexOf("  async quitToTitleAsync()"), source.indexOf("\n  /** @deprecated", source.indexOf("  async quitToTitleAsync()")));
  assertOrdered(quit, [
    "await this.stopRustLivePlayerAuthorityR5()",
    "this.saveNow()",
    "await this.worldStorage.flushPersistence()",
    'await this.disconnectMultiplayer("quit-to-title")',
    "await this.drainRustAuthorityOperations()",
    "await this.disposeRustLiveRendererR10()",
    "await this.shutdownBoundNativePersistence()",
    "await this.rustRuntimeManager.shutdown()",
  ]);

  const keyStart = source.indexOf("  onKeyDown = (event: KeyboardEvent) => {");
  const keyEnd = source.indexOf("\n  onKeyUp =", keyStart);
  const keys = source.slice(keyStart, keyEnd);
  const liveStart = keys.indexOf("if (this.rustLivePlayerAuthorityEnabledR5()) {");
  const legacyInventory = keys.indexOf('if (event.code === "KeyE"');
  assert.ok(liveStart >= 0 && liveStart < legacyInventory, "the native gate must run before every legacy special key");
  const liveBranch = keys.slice(liveStart, legacyInventory);
  for (const forbidden of [
    "openOverlay(",
    "startRangedReload(",
    "performDragonAttack(",
    "triggerMountedCreatureMove(",
    "dismountBoat(",
    "dismountCreature(",
    "castSelectedMagicSpell(",
  ]) assert.doesNotMatch(liveBranch, new RegExp(forbidden.replace("(", "\\("), "u"));
  assert.match(liveBranch, /rustDropPulse = true/u);
  assert.match(liveBranch, /event\.code === "KeyF"\) event\.preventDefault\(\)/u);
  assert.match(liveBranch, /this\.keys\.add\(event\.code\)/u);
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
  assert.match(manual, /if \(rustLivePlayerAuthority\) this\.scheduleRustLiveInputAdvanceR5\(\)/u);

  const animate = source.slice(source.indexOf("  animate = (now: number)"), source.indexOf("\n  advanceSimulation(milliseconds: number)", source.indexOf("  animate = (now: number)")));
  assert.match(animate, /if \(this\.running && !this\.titleMode && !this\.paused && !rustLivePlayerAuthority\) \{\s*\n\s*this\.magicState = regenerateMana/u);
  assert.match(animate, /if \(!rustLivePlayerAuthority\) \{\s*\n\s*this\.updateRangedWeapon\(dt\);\s*\n\s*this\.updateFastTravelChannel\(\);\s*\n\s*this\.updateMapDiscovery\(dt\)/u);
});

test("the checked-in Wasm advertises pending input/extraction cutovers, never promoted capabilities", async () => {
  const source = await readFile(new URL("../engine/crates/blockwild-wasm/src/integrated_runtime.rs", import.meta.url), "utf8");
  const capabilities = source.slice(source.indexOf("const CAPABILITIES"), source.indexOf("];", source.indexOf("const CAPABILITIES")) + 2);
  assert.match(capabilities, /fixed-step-input-v1-pending-live-cutover/u);
  assert.doesNotMatch(capabilities, /"fixed-step-input-v1"/u);
  assert.match(capabilities, /bounded-extraction-v1-pending-live-domain-views/u);
  assert.doesNotMatch(capabilities, /"bounded-extraction-v1"/u);
});
