import assert from "node:assert/strict";
import test from "node:test";
import type {
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeCommandReceiptV1,
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeInputFrameV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import {
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeDropPickupQueryV1,
  encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1,
  rustIntegratedRuntimeDropPickupReceiptHashV1,
  type RustIntegratedRuntimeDropPickupProjectionV1,
} from "../app/game/rust-integrated-runtime-drop-pickup.ts";
import type { RustIntegratedPlayerRuntimeContinuityV1 } from "../app/game/rust-integrated-runtime-player-status.ts";
import {
  RustLiveInputPumpR5,
  type RustLiveInputIntentR5,
  type RustLiveInputPumpDropPickupDeliveryV1,
  type RustLiveInputPumpServiceR5,
} from "../app/game/rust-live-input-pump-r5.ts";

const GENERATION = 23;

function hash(value: number) { return value.toString(16).padStart(32, "0").slice(-32); }

function identity(tick = 0, simulation = 0, persistence = 1, state = 1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe-live-pickup",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1, world: 1, entities: 1, gameplay: 1, persistence, network: 1, simulation,
    }),
    tick,
    stateHash: hash(state),
  });
}

function continuity(): RustIntegratedPlayerRuntimeContinuityV1 {
  return Object.freeze({
    lastMonotonicTimeUs: BigInt(0),
    lastInputSequence: null,
    nextInputSequence: BigInt(1),
    lastActionSequence: null,
    nextActionSequence: BigInt(1),
    authoritativeFlags: 0,
    lastAppliedInput: null,
    queuedInputsEmpty: true,
  });
}

function status(tick = 0) {
  return Object.freeze({
    entityAuthority: Object.freeze({ revision: BigInt(1), nextSequence: BigInt(1), tick: BigInt(tick) }),
    continuity: continuity(),
    worldViewBinding: Object.freeze({
      playerId: BigInt(1), revision: BigInt(1), actorId: "actor:test", entityId: BigInt("4294967297"),
      inventoryContainer: Object.freeze({ kind: "player" as const, id: "actor:test", ownerId: "actor:test" }),
      equipmentContainer: Object.freeze({
        kind: "equipment" as const, id: "actor:test:equipment", ownerId: "actor:test",
      }),
      selectedSlot: 0, backSlot: 7,
    }),
  });
}

function intent(): RustLiveInputIntentR5 {
  return Object.freeze({
    moveX: 0,
    moveZ: 0,
    yawRadians: 0,
    pitchRadians: 0,
    selectedSlot: 0,
    held: Object.freeze({ jump: false, crouch: false, sprint: false, ascend: false, descend: false }),
    actions: Object.freeze({
      primaryAttack: false, secondaryUse: false, interact: false, mountToggle: false,
      creativeFlightToggle: false, drop: false,
    }),
  });
}

function pickupProjection(sequence: number, completionTick: number): RustIntegratedRuntimeDropPickupProjectionV1 {
  const blockActionSequence = BigInt(30 + sequence);
  const stack = Object.freeze({ itemCode: 2, count: 1, durabilityMillionths: null, metadataHash: hash(0) });
  const gameplayBefore = Object.freeze({
    epoch: 1, sequence: BigInt(10 + sequence), inventory: BigInt(20 + sequence), machines: BigInt(2),
    combat: BigInt(3), progression: BigInt(4), cardforge: BigInt(5),
  });
  const worldViewBefore = Object.freeze({
    epoch: 1, sequence: BigInt(30 + sequence), clock: BigInt(4), machineAnchors: BigInt(5),
    droppedItems: BigInt(6 + sequence), playerBindings: BigInt(7), environment: BigInt(8),
    atmosphereGravity: BigInt(9), celestial: BigInt(10),
  });
  const base = Object.freeze({
    schema: 1 as const,
    sequence,
    completionTick,
    world: Object.freeze({
      universeId: "universe-live-pickup", locationId: "surface",
      revision: Object.freeze({ epoch: 1, mutation: 2, residency: 3 }), canonicalStateHash: hash(40),
    }),
    player: Object.freeze({
      playerId: BigInt(1), entityId: BigInt("4294967297"),
      inventoryContainer: Object.freeze({ kind: "player" as const, id: "actor:test", ownerId: "actor:test" }),
      beforeRevision: BigInt(50 + sequence), afterRevision: BigInt(51 + sequence),
      affectedSlots: Object.freeze([Object.freeze({ slot: 0, beforeStack: null, afterStack: stack })]),
    }),
    generatedDrop: Object.freeze({
      dropId: `block-loot-v1:${blockActionSequence}:0`, entityId: BigInt(100 + sequence),
      origin: Object.freeze({
        kind: "generated-block-action" as const,
        provenance: Object.freeze({
          schema: 1 as const, manifestHash: hash(11), installedRegistryHash: hash(12), catalogBlobHash: hash(13),
          actionReportHash: hash(14), rngSemanticsHash: hash(15), blockActionSequence,
          originInputSequence: 1, blockId: 2, position: Object.freeze({ x: 4, y: 43, z: -3 }),
          lootPlanHash: hash(16 + sequence), groupOrdinal: 0,
        }),
      }),
      stack,
      custodyContainer: Object.freeze({
        kind: "container" as const, id: `block-loot-custody-v1:${blockActionSequence}:0`, ownerId: null,
      }),
      custodySlot: 0,
      custodyBeforeRevision: BigInt(60 + sequence),
      custodyEmptiedRevision: BigInt(61 + sequence),
      spatialRevision: BigInt(70 + sequence),
      position: Object.freeze({ xMilli: BigInt(4_000), yMilli: BigInt(43_350), zMilli: BigInt(-3_000) }),
      velocityMilliPerSecond: Object.freeze({ xMilli: BigInt(0), yMilli: BigInt(0), zMilli: BigInt(0) }),
      rotation: Object.freeze({ yaw: 20, pitch: 0, roll: 0 }),
    }),
    removal: Object.freeze({
      gameplay: Object.freeze({
        before: Object.freeze({ revision: gameplayBefore, canonicalStateHash: hash(80 + sequence) }),
        after: Object.freeze({
          revision: Object.freeze({
            ...gameplayBefore,
            sequence: gameplayBefore.sequence + BigInt(1),
            inventory: gameplayBefore.inventory + BigInt(1),
          }),
          canonicalStateHash: hash(90 + sequence),
        }),
      }),
      entity: Object.freeze({
        before: Object.freeze({ revision: BigInt(100 + sequence), canonicalStateHash: hash(100 + sequence) }),
        after: Object.freeze({ revision: BigInt(101 + sequence), canonicalStateHash: hash(110 + sequence) }),
      }),
      worldView: Object.freeze({
        before: Object.freeze({ revision: worldViewBefore, canonicalStateHash: hash(120 + sequence) }),
        after: Object.freeze({
          revision: Object.freeze({
            ...worldViewBefore,
            sequence: worldViewBefore.sequence + BigInt(1),
            droppedItems: worldViewBefore.droppedItems + BigInt(1),
          }),
          canonicalStateHash: hash(130 + sequence),
        }),
      }),
    }),
    receiptHash: hash(140 + sequence),
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

type QueryFault = "none" | "gap" | "corrupt-native-hash" | "identity-drift";

class PickupRuntime implements RustLiveInputPumpServiceR5 {
  current = identity();
  extractionRevision = 1;
  steps = 0;
  extracts = 0;
  queryFault: QueryFault = "none";
  generateAtStep: number | null = 1;
  readonly history: RustIntegratedRuntimeDropPickupProjectionV1[] = [];
  readonly calls: string[] = [];
  commandBarrier: Promise<void> | null = null;
  commandStarted: (() => void) | null = null;

  identity() { return this.current; }

  async step(_time: number, _budget: number, inputs: readonly RustIntegratedRuntimeInputFrameV1[]) {
    this.calls.push("step");
    this.steps += 1;
    assert.equal(inputs.length, 1);
    const frame = inputs[0]!;
    this.current = identity(
      this.current.tick + 1,
      this.current.revision.simulation + 1,
      this.current.revision.persistence,
      200 + this.steps + this.history.length,
    );
    if (this.generateAtStep === this.steps) {
      this.history.push(pickupProjection(this.history.length + 1, this.current.tick));
    }
    this.extractionRevision += 1;
    return Object.freeze({
      type: "runtime-step-result-v1" as const,
      requestId: this.steps,
      clientEpoch: 1,
      workerEpoch: 1,
      identity: this.current,
      fixedSteps: 1,
      inputsApplied: 1,
      commandsProcessed: 0,
      commandsAccepted: 0,
      actionReceipts: Object.freeze([]),
      replayHash: hash(210 + frame.sequence),
    });
  }

  async command(batch: RustIntegratedRuntimeCommandBatchV1) {
    this.calls.push("command");
    this.commandStarted?.();
    if (this.commandBarrier) await this.commandBarrier;
    const operation = batch.operations[0]!;
    assert.equal(operation.typeId, RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1);
    const query = decodeRustIntegratedRuntimeDropPickupQueryV1(operation.payload);
    assert.deepEqual(query.expected, batch.expected);
    const latest = this.history.at(-1)?.sequence ?? 0;
    const seed = query.afterSequence === RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1;
    let receipt = seed ? null : this.history.find((entry) => entry.sequence === query.afterSequence + 1) ?? null;
    let cursorAfter = seed ? latest : receipt?.sequence ?? query.afterSequence;
    if (this.queryFault === "gap" && receipt !== null) {
      receipt = pickupProjection(receipt.sequence + 1, receipt.completionTick);
      cursorAfter = receipt.sequence;
    }
    let payload = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
      requestPayloadHash: operation.payloadHash,
      identity: query.expected,
      cursorAfter,
      receipt,
    });
    if (this.queryFault === "corrupt-native-hash" && receipt !== null) {
      payload = Uint8Array.from(payload);
      payload[payload.length - 1] ^= 0xff;
      payload.set(Buffer.from(rustIntegratedRuntimeWireChecksumV1(payload.subarray(28)), "hex"), 12);
    }
    const response = createRustIntegratedRuntimeDomainOperationV1({
      domain: "gameplay",
      typeId: RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1,
      schema: 1,
      payload,
    });
    const accepted = {
      status: "accepted" as const,
      commandId: batch.commandId,
      idempotencyKey: batch.idempotencyKey,
      commandHash: batch.commandHash,
      before: query.expected,
      after: query.expected,
      domainReceipts: Object.freeze([response]),
    };
    if (this.queryFault === "identity-drift") {
      this.current = identity(
        this.current.tick,
        this.current.revision.simulation,
        this.current.revision.persistence,
        999,
      );
    }
    return Object.freeze({ ...accepted, receiptHash: outerReceiptHash(accepted) });
  }

  async extract(): Promise<RustIntegratedRuntimeExtractionV1> {
    this.calls.push("extract");
    this.extracts += 1;
    return Object.freeze({
      identity: this.current,
      extractionRevision: this.extractionRevision,
      render: Uint8Array.of(1),
      hud: new Uint8Array(),
      audio: new Uint8Array(),
      platformRequests: new Uint8Array(),
      diagnostics: new Uint8Array(),
      extractionHash: hash(300 + this.extractionRevision),
    });
  }

  advancePersistence() {
    this.current = identity(
      this.current.tick,
      this.current.revision.simulation,
      this.current.revision.persistence + 1,
      700 + this.current.revision.persistence,
    );
  }
}

function pump(runtime: PickupRuntime, cursor: number | null) {
  let now = 50_000;
  return new RustLiveInputPumpR5({
    service: runtime,
    status: status(runtime.identity().tick),
    worldGeneration: GENERATION,
    initialDropPickupCursor: cursor,
    nowUs: () => { now += 50_000; return now; },
  });
}

function conflictingDelivery(
  delivery: RustLiveInputPumpDropPickupDeliveryV1,
): RustLiveInputPumpDropPickupDeliveryV1 {
  const receiptBase = Object.freeze({
    ...delivery.receipt,
    world: Object.freeze({ ...delivery.receipt.world, canonicalStateHash: hash(988) }),
    receiptHash: hash(989),
  });
  const receipt = Object.freeze({
    ...receiptBase,
    receiptHash: rustIntegratedRuntimeDropPickupReceiptHashV1(receiptBase),
  });
  const packet = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
    requestPayloadHash: delivery.requestPayloadHash,
    identity: delivery.queryIdentity,
    cursorAfter: delivery.cursorAfter,
    receipt,
  }, delivery.cursorBefore);
  return Object.freeze({
    ...delivery,
    receipt,
    projectionPayloadHash: rustIntegratedRuntimeWireChecksumV1(packet),
  });
}

test("fresh pickup cursor delivers, holds native input, checkpoints, and acknowledges once", async () => {
  const runtime = new PickupRuntime();
  const live = pump(runtime, 0);
  live.sample(GENERATION, intent());
  const first = await live.advance(GENERATION);
  const delivery = first.dropPickup!;
  assert.equal(delivery.receipt.sequence, 1);
  assert.deepEqual(runtime.calls, ["step", "command", "extract"]);
  assert.equal(live.diagnostics().dropPickupCursor, 0, "delivery cannot advance browser custody");
  assert.equal(live.diagnostics().pendingDropPickupSequence, 1);

  const held = await live.advance(GENERATION);
  assert.equal(held.step, null);
  assert.equal(held.dropPickup, delivery);
  assert.equal(runtime.steps, 1, "unacknowledged pickup must hold native input advance");

  const checkpoint = await live.checkpointNativePersistence(GENERATION, async () => {
    runtime.advancePersistence();
    return "saved";
  });
  assert.equal(checkpoint.value, "saved");
  assert.equal(live.diagnostics().pendingDropPickupSequence, 1);
  assert.equal(live.acknowledgeDropPickup(GENERATION, delivery), true);
  assert.equal(live.diagnostics().dropPickupCursor, 1);
  assert.equal(live.acknowledgeDropPickup(GENERATION, delivery), false, "exact duplicate ack is idempotent");
  assert.throws(() => live.acknowledgeDropPickup(GENERATION, conflictingDelivery(delivery)), /conflicting hash/u);
  assert.equal(live.state, "failed");
});

test("legacy null pickup cursor seeds latest before delivering a new receipt", async () => {
  const runtime = new PickupRuntime();
  runtime.history.push(pickupProjection(1, 0));
  runtime.generateAtStep = 2;
  const live = pump(runtime, null);
  live.sample(GENERATION, intent());
  const seeded = await live.advance(GENERATION);
  assert.equal(seeded.dropPickup, null);
  assert.equal(live.diagnostics().dropPickupCursor, 1);
  assert.equal(live.diagnostics().dropPickupLegacySeedPending, false);

  live.sample(GENERATION, intent());
  const fresh = await live.advance(GENERATION);
  assert.equal(fresh.dropPickup?.receipt.sequence, 2);
});

for (const fault of ["gap", "corrupt-native-hash", "identity-drift"] as const) {
  test(`${fault} pickup query fails closed before extraction`, async () => {
    const runtime = new PickupRuntime();
    runtime.queryFault = fault;
    const live = pump(runtime, 0);
    live.sample(GENERATION, intent());
    await assert.rejects(live.advance(GENERATION), /drop-pickup|identity|canonical|gapped|out of order/u);
    assert.equal(runtime.extracts, 0);
    assert.deepEqual(runtime.calls, ["step", "command"]);
    assert.equal(live.state, "failed");
    assert.equal(live.diagnostics().pendingDropPickupSequence, null);
  });
}

test("generation stop discards an in-flight pickup query and clears pending state", async () => {
  const runtime = new PickupRuntime();
  let release: () => void = () => undefined;
  runtime.commandBarrier = new Promise<void>((resolve) => { release = resolve; });
  let started: () => void = () => undefined;
  const commandStarted = new Promise<void>((resolve) => { started = resolve; });
  runtime.commandStarted = started;
  const live = pump(runtime, 0);
  live.sample(GENERATION, intent());
  const advancing = live.advance(GENERATION);
  await commandStarted;
  const stopping = live.stop();
  release();
  assert.deepEqual(await advancing, { discarded: true, step: null, extraction: null });
  await stopping;
  assert.equal(live.state, "stopped");
  assert.equal(live.diagnostics().pendingDropPickupSequence, null);
  assert.equal(runtime.extracts, 0);
});
