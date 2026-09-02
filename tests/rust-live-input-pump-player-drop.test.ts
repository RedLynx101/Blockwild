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
  RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1,
  decodeRustIntegratedRuntimeBasicDirtActionQueryV1,
  encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1,
} from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";
import {
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1,
  decodeRustIntegratedRuntimeDropPickupQueryV1,
  encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1,
} from "../app/game/rust-integrated-runtime-drop-pickup.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeNativePlayerDropQueryV1,
  encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1,
  rustIntegratedRuntimeNativePlayerDropReceiptHashV1,
  type RustIntegratedRuntimeNativePlayerDropProjectionV1,
} from "../app/game/rust-integrated-runtime-player-drop.ts";
import type { RustIntegratedPlayerRuntimeContinuityV1 } from "../app/game/rust-integrated-runtime-player-status.ts";
import {
  RustLiveInputPumpR5,
  type RustLiveInputIntentR5,
  type RustLiveInputPumpPlayerDropDeliveryV1,
  type RustLiveInputPumpServiceR5,
} from "../app/game/rust-live-input-pump-r5.ts";
import { plainNativePlayerDropProjection } from "./helpers/rust-native-player-drop-fixture.ts";

const GENERATION = 31;

function hash(value: number) { return value.toString(16).padStart(32, "0").slice(-32); }

function identity(tick = 0, simulation = 0, persistence = 1, state = 1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe:native-player-drop",
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
      playerId: BigInt(1),
      revision: BigInt(1),
      actorId: "actor:native-player-drop",
      entityId: BigInt("4294967297"),
      inventoryContainer: Object.freeze({
        kind: "player" as const,
        id: "actor:native-player-drop",
        ownerId: "actor:native-player-drop",
      }),
      equipmentContainer: Object.freeze({
        kind: "equipment" as const,
        id: "actor:native-player-drop:equipment",
        ownerId: "actor:native-player-drop",
      }),
      selectedSlot: 0,
      backSlot: 7,
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
      primaryAttack: false,
      secondaryUse: false,
      interact: false,
      mountToggle: false,
      creativeFlightToggle: false,
      drop: false,
    }),
  });
}

function outerReceiptHash(receipt: Omit<
  Extract<RustIntegratedRuntimeCommandReceiptV1, { status: "accepted" }>,
  "receiptHash"
>) {
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
    ...Buffer.from(receipt.commandHash, "hex"),
    ...Buffer.from(receipt.before.stateHash, "hex"),
    ...Buffer.from(receipt.after.stateHash, "hex"),
    ...receipt.domainReceipts.flatMap((operation) => [...Buffer.from(operation.payloadHash, "hex")]),
  ]));
}

type QueryFault = "none" | "gap" | "corrupt-native-hash" | "identity-drift";

class PlayerDropRuntime implements RustLiveInputPumpServiceR5 {
  current = identity();
  extractionRevision = 1;
  steps = 0;
  extracts = 0;
  queryFault: QueryFault = "none";
  generateAtStep: number | null = 1;
  emptyOtherQueries = false;
  readonly history: RustIntegratedRuntimeNativePlayerDropProjectionV1[] = [];
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
      this.history.push(plainNativePlayerDropProjection(this.history.length + 1, this.current.tick));
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
    let expected: RustIntegratedRuntimeIdentityV1;
    let responseTypeId: string;
    let payload: Uint8Array;
    if (this.emptyOtherQueries
      && operation.typeId === RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1) {
      const query = decodeRustIntegratedRuntimeBasicDirtActionQueryV1(operation.payload);
      expected = query.expected;
      responseTypeId = RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1;
      payload = encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1({
        requestPayloadHash: operation.payloadHash,
        identity: query.expected,
        cursorAfter: query.afterSequence,
        receipt: null,
      }, query.afterSequence);
    } else if (this.emptyOtherQueries
      && operation.typeId === RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1) {
      const query = decodeRustIntegratedRuntimeDropPickupQueryV1(operation.payload);
      expected = query.expected;
      responseTypeId = RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1;
      payload = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
        requestPayloadHash: operation.payloadHash,
        identity: query.expected,
        cursorAfter: query.afterSequence,
        receipt: null,
      }, query.afterSequence);
    } else {
      assert.equal(operation.typeId, RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1);
      const query = decodeRustIntegratedRuntimeNativePlayerDropQueryV1(operation.payload);
      expected = query.expected;
      responseTypeId = RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1;
      const latest = this.history.at(-1)?.sequence ?? 0;
      const seed = query.afterSequence === RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1;
      let receipt = seed ? null : this.history.find((entry) => entry.sequence === query.afterSequence + 1) ?? null;
      let cursorAfter = seed ? latest : receipt?.sequence ?? query.afterSequence;
      if (this.queryFault === "gap" && receipt !== null) {
        receipt = plainNativePlayerDropProjection(receipt.sequence + 1, receipt.completionTick);
        cursorAfter = receipt.sequence;
      }
      payload = encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
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
    }
    assert.deepEqual(expected, batch.expected);
    const response = createRustIntegratedRuntimeDomainOperationV1({
      domain: "gameplay",
      typeId: responseTypeId,
      schema: 1,
      payload,
    });
    const accepted = {
      status: "accepted" as const,
      commandId: batch.commandId,
      idempotencyKey: batch.idempotencyKey,
      commandHash: batch.commandHash,
      before: expected,
      after: expected,
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

function pump(runtime: PlayerDropRuntime, cursor: number | null) {
  let now = 50_000;
  return new RustLiveInputPumpR5({
    service: runtime,
    status: status(runtime.identity().tick),
    worldGeneration: GENERATION,
    initialNativePlayerDropCursor: cursor,
    nowUs: () => { now += 50_000; return now; },
  });
}

function conflictingDelivery(
  delivery: RustLiveInputPumpPlayerDropDeliveryV1,
): RustLiveInputPumpPlayerDropDeliveryV1 {
  const receiptBase = Object.freeze({
    ...delivery.receipt,
    authority: Object.freeze({
      ...delivery.receipt.authority,
      entity: Object.freeze({
        before: Object.freeze({
          ...delivery.receipt.authority.entity.before,
          canonicalStateHash: hash(988),
        }),
        after: delivery.receipt.authority.entity.after,
      }),
    }),
  });
  const receipt = Object.freeze({
    ...receiptBase,
    receiptHash: rustIntegratedRuntimeNativePlayerDropReceiptHashV1(receiptBase),
  });
  const packet = encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
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

test("fresh player-drop cursor delivers, holds all native input, checkpoints, and acknowledges once", async () => {
  const runtime = new PlayerDropRuntime();
  const live = pump(runtime, 0);
  live.sample(GENERATION, intent());
  const first = await live.advance(GENERATION);
  const delivery = first.playerDrop!;
  assert.equal(delivery.receipt.sequence, 1);
  assert.deepEqual(runtime.calls, ["step", "command", "extract"]);
  assert.equal(live.diagnostics().playerDropCursor, 0);
  assert.equal(live.diagnostics().pendingPlayerDropSequence, 1);

  const held = await live.advance(GENERATION);
  assert.equal(held.step, null);
  assert.equal(held.playerDrop, delivery);
  assert.equal(runtime.steps, 1, "an unacknowledged player drop must hold every native input lane");

  const checkpoint = await live.checkpointNativePersistence(GENERATION, async () => {
    runtime.advancePersistence();
    return "saved";
  });
  assert.equal(checkpoint.value, "saved");
  assert.equal(live.acknowledgePlayerDrop(GENERATION, delivery), true);
  assert.equal(live.diagnostics().playerDropCursor, 1);
  assert.equal(live.acknowledgePlayerDrop(GENERATION, delivery), false);
  assert.throws(() => live.acknowledgePlayerDrop(GENERATION, conflictingDelivery(delivery)), /conflicting hash/u);
  assert.equal(live.state, "failed");
});

test("pending player drop excludes Basic Dirt and pickup query lanes", async () => {
  const runtime = new PlayerDropRuntime();
  runtime.emptyOtherQueries = true;
  let now = 50_000;
  const live = new RustLiveInputPumpR5({
    service: runtime,
    status: status(),
    worldGeneration: GENERATION,
    initialBasicDirtActionCursor: 0,
    initialDropPickupCursor: 0,
    initialNativePlayerDropCursor: 0,
    nowUs: () => { now += 50_000; return now; },
  });
  live.sample(GENERATION, intent());
  const first = await live.advance(GENERATION);
  assert.equal(first.basicDirtAction, null);
  assert.equal(first.dropPickup, null);
  assert.equal(first.playerDrop?.receipt.sequence, 1);
  assert.deepEqual(runtime.calls, ["step", "command", "command", "command", "extract"]);
  assert.equal(live.diagnostics().basicDirtActionQueryCalls, 1);
  assert.equal(live.diagnostics().dropPickupQueryCalls, 1);
  assert.equal(live.diagnostics().playerDropQueryCalls, 1);

  runtime.calls.length = 0;
  const held = await live.advance(GENERATION);
  assert.equal(held.step, null);
  assert.equal(held.extraction, null);
  assert.equal(held.basicDirtAction, null);
  assert.equal(held.dropPickup, null);
  assert.equal(held.playerDrop, first.playerDrop);
  assert.deepEqual(runtime.calls, []);
  assert.equal(live.diagnostics().basicDirtActionQueryCalls, 1);
  assert.equal(live.diagnostics().dropPickupQueryCalls, 1);
  assert.equal(live.diagnostics().playerDropQueryCalls, 1);
});

test("legacy null player-drop cursor seeds latest before delivering a new receipt", async () => {
  const runtime = new PlayerDropRuntime();
  runtime.history.push(plainNativePlayerDropProjection(1, 0));
  runtime.generateAtStep = 2;
  const live = pump(runtime, null);
  live.sample(GENERATION, intent());
  const seeded = await live.advance(GENERATION);
  assert.equal(seeded.playerDrop, null);
  assert.equal(live.diagnostics().playerDropCursor, 1);
  assert.equal(live.diagnostics().playerDropLegacySeedPending, false);

  live.sample(GENERATION, intent());
  const fresh = await live.advance(GENERATION);
  assert.equal(fresh.playerDrop?.receipt.sequence, 2);
});

for (const fault of ["gap", "corrupt-native-hash", "identity-drift"] as const) {
  test(`${fault} player-drop query fails closed before extraction`, async () => {
    const runtime = new PlayerDropRuntime();
    runtime.queryFault = fault;
    const live = pump(runtime, 0);
    live.sample(GENERATION, intent());
    await assert.rejects(live.advance(GENERATION), /player-drop|identity|canonical|gapped|out of order/u);
    assert.equal(runtime.extracts, 0);
    assert.deepEqual(runtime.calls, ["step", "command"]);
    assert.equal(live.state, "failed");
    assert.equal(live.diagnostics().pendingPlayerDropSequence, null);
  });
}

test("generation stop discards an in-flight player-drop query and clears pending state", async () => {
  const runtime = new PlayerDropRuntime();
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
  assert.equal(live.diagnostics().pendingPlayerDropSequence, null);
  assert.equal(runtime.extracts, 0);
});
