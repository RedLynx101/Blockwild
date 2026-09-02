import assert from "node:assert/strict";
import test from "node:test";
import {
  RUST_RUNTIME_INPUT_BUTTON_V1,
  type RustIntegratedRuntimeCommandBatchV1,
  type RustIntegratedRuntimeCommandReceiptV1,
  type RustIntegratedRuntimeExtractionV1,
  type RustIntegratedRuntimeIdentityV1,
  type RustIntegratedRuntimeInputActionReceiptV1,
  type RustIntegratedRuntimeInputFrameV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
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
  rustIntegratedRuntimeBasicDirtActionReceiptHashV1,
  rustIntegratedRuntimeBasicDirtContentSubsetHashV1,
  rustIntegratedRuntimeBasicDirtExpectedDropTransformV1,
  type RustIntegratedRuntimeBasicDirtActionContentBindingV1,
  type RustIntegratedRuntimeBasicDirtActionProjectionV1,
} from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";
import type { RustIntegratedPlayerRuntimeContinuityV1 } from "../app/game/rust-integrated-runtime-player-status.ts";
import {
  RustLiveInputPumpR5,
  type RustLiveInputIntentR5,
  type RustLiveInputPumpBasicDirtActionDeliveryV1,
  type RustLiveInputPumpServiceR5,
} from "../app/game/rust-live-input-pump-r5.ts";

const GENERATION = 19;

function hash(value: number) { return value.toString(16).padStart(32, "0").slice(-32); }

function identity(tick = 0, simulation = 0, persistence = 1, state = 1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe-live-dirt",
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

function intent(primaryAttack = false, secondaryUse = false): RustLiveInputIntentR5 {
  return Object.freeze({
    moveX: 0,
    moveZ: 0,
    yawRadians: 0,
    pitchRadians: 0,
    selectedSlot: 0,
    held: Object.freeze({ jump: false, crouch: false, sprint: false, ascend: false, descend: false }),
    actions: Object.freeze({
      primaryAttack, secondaryUse, interact: false, mountToggle: false,
      creativeFlightToggle: false, drop: false,
    }),
  });
}

function content(): RustIntegratedRuntimeBasicDirtActionContentBindingV1 {
  const base = Object.freeze({
    manifestHash: hash(11), installedRegistryHash: hash(12), catalogSchemaVersion: 2,
    catalogContentVersion: 9, catalogBlobHash: hash(13), actionReportHash: hash(14), subsetHash: hash(15),
  });
  return Object.freeze({ ...base, subsetHash: rustIntegratedRuntimeBasicDirtContentSubsetHashV1(base) });
}

function actionProjection(
  sequence: number,
  originInputSequence: number,
  completionTick: number,
  action: "mine" | "place",
): RustIntegratedRuntimeBasicDirtActionProjectionV1 {
  const binding = content();
  const position = Object.freeze({ x: 4, y: 43, z: -3 });
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: binding.manifestHash,
    installedRegistryHash: binding.installedRegistryHash,
    catalogBlobHash: binding.catalogBlobHash,
    actionReportHash: binding.actionReportHash,
    rngSemanticsHash: hash(16),
    blockActionSequence: BigInt(sequence + 30),
    originInputSequence,
    blockId: 2,
    position,
    lootPlanHash: hash(17 + sequence),
    groupOrdinal: 0,
  });
  const transform = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(provenance);
  const beforeStack = action === "place"
    ? Object.freeze({ itemCode: 2, count: 2, durabilityMillionths: null, metadataHash: hash(0) })
    : null;
  const afterStack = action === "place"
    ? Object.freeze({ itemCode: 2, count: 1, durabilityMillionths: null, metadataHash: hash(0) })
    : null;
  const base = Object.freeze({
    schema: 1 as const,
    sequence,
    originInputSequence,
    completionTick,
    action,
    position,
    priorBlockId: action === "mine" ? 2 : 0,
    replacementBlockId: action === "mine" ? 0 : 2,
    beforeWorldRevision: Object.freeze({ epoch: 1, mutation: sequence, residency: 3 }),
    afterWorldRevision: Object.freeze({ epoch: 1, mutation: sequence + 1, residency: 3 }),
    beforeWorldHash: hash(40 + sequence),
    afterWorldHash: hash(50 + sequence),
    creativeMode: false,
    inventory: Object.freeze({
      container: Object.freeze({ kind: "player" as const, id: "actor:test", ownerId: "actor:test" }),
      slot: 0,
      beforeRevision: BigInt(4 + sequence),
      afterRevision: BigInt(4 + sequence + (action === "place" ? 1 : 0)),
      beforeStack,
      afterStack,
    }),
    generatedDrops: action === "mine" ? Object.freeze([Object.freeze({
      provenance,
      entityId: BigInt(4_294_967_297 + sequence),
      stack: Object.freeze({ itemCode: 2, count: 1, durabilityMillionths: null, metadataHash: hash(0) }),
      ...transform,
    })]) : Object.freeze([]),
    content: binding,
    receiptHash: hash(60 + sequence),
  });
  return Object.freeze({ ...base, receiptHash: rustIntegratedRuntimeBasicDirtActionReceiptHashV1(base) });
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

class DirtRuntime implements RustLiveInputPumpServiceR5 {
  current = identity();
  lastButtons = 0;
  nextActionSequence = 1;
  extractionRevision = 1;
  steps = 0;
  extracts = 0;
  queryFault: QueryFault = "none";
  generateMineAtStep: number | null = null;
  readonly history: RustIntegratedRuntimeBasicDirtActionProjectionV1[] = [];
  readonly calls: string[] = [];
  commandBarrier: Promise<void> | null = null;
  commandStarted: (() => void) | null = null;

  identity() { return this.current; }

  async step(_time: number, _budget: number, inputs: readonly RustIntegratedRuntimeInputFrameV1[]) {
    this.calls.push("step");
    this.steps += 1;
    const frame = inputs[0]!;
    assert.equal(inputs.length, 1);
    const rising = frame.buttons & ~this.lastButtons;
    const actionReceipts: RustIntegratedRuntimeInputActionReceiptV1[] = [];
    for (const [bit, kind] of [
      [RUST_RUNTIME_INPUT_BUTTON_V1.primaryAttack, "primary-attack"],
      [RUST_RUNTIME_INPUT_BUTTON_V1.secondaryUse, "secondary-use"],
    ] as const) {
      if ((rising & bit) === 0) continue;
      actionReceipts.push(Object.freeze({
        sequence: this.nextActionSequence++,
        inputSequence: frame.sequence,
        tick: this.current.tick + 1,
        kind,
        outcome: "applied" as const,
        selectedSlot: frame.selectedSlot,
        authoritativeFlags: 0,
        targetEntityId: BigInt(0),
        effectHash: hash(80 + this.nextActionSequence),
      }));
    }
    this.lastButtons = frame.buttons;
    this.current = identity(
      this.current.tick + 1,
      this.current.revision.simulation + 1,
      this.current.revision.persistence,
      100 + this.steps + this.history.length,
    );
    if ((rising & RUST_RUNTIME_INPUT_BUTTON_V1.secondaryUse) !== 0) {
      this.history.push(actionProjection(this.history.length + 1, frame.sequence, this.current.tick, "place"));
    }
    if (this.generateMineAtStep === this.steps) {
      this.history.push(actionProjection(this.history.length + 1, 1, this.current.tick, "mine"));
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
      actionReceipts: Object.freeze(actionReceipts),
      replayHash: hash(200 + this.steps),
    });
  }

  async command(batch: RustIntegratedRuntimeCommandBatchV1) {
    this.calls.push("command");
    this.commandStarted?.();
    if (this.commandBarrier) await this.commandBarrier;
    const operation = batch.operations[0]!;
    assert.equal(operation.typeId, RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1);
    const query = decodeRustIntegratedRuntimeBasicDirtActionQueryV1(operation.payload);
    assert.deepEqual(query.expected, batch.expected);
    const latest = this.history.at(-1)?.sequence ?? 0;
    const seed = query.afterSequence === RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1;
    let receipt = seed ? null : this.history.find((entry) => entry.sequence === query.afterSequence + 1) ?? null;
    let cursorAfter = seed ? latest : receipt?.sequence ?? query.afterSequence;
    if (this.queryFault === "gap" && receipt !== null) {
      receipt = actionProjection(receipt.sequence + 1, receipt.originInputSequence, receipt.completionTick, receipt.action);
      cursorAfter = receipt.sequence;
    }
    let payload = encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1({
      requestPayloadHash: operation.payloadHash,
      identity: query.expected,
      cursorAfter,
      receipt,
    });
    if (this.queryFault === "corrupt-native-hash" && receipt !== null) {
      payload = Uint8Array.from(payload);
      payload[payload.length - 1] ^= 0xff;
      const checksum = Buffer.from(rustIntegratedRuntimeWireChecksumV1(payload.subarray(28)), "hex");
      payload.set(checksum, 12);
    }
    const response = createRustIntegratedRuntimeDomainOperationV1({
      domain: "gameplay",
      typeId: RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_PROJECTION_RECEIPT_TYPE_V1,
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

function pump(runtime: DirtRuntime, cursor: number | null) {
  let now = 50_000;
  return new RustLiveInputPumpR5({
    service: runtime,
    status: status(runtime.identity().tick),
    worldGeneration: GENERATION,
    initialBasicDirtActionCursor: cursor,
    nowUs: () => { now += 50_000; return now; },
  });
}

function conflictingDelivery(
  delivery: RustLiveInputPumpBasicDirtActionDeliveryV1,
): RustLiveInputPumpBasicDirtActionDeliveryV1 {
  const receiptBase = Object.freeze({
    ...delivery.receipt,
    beforeWorldHash: hash(988),
    receiptHash: hash(989),
  });
  const receipt = Object.freeze({
    ...receiptBase,
    receiptHash: rustIntegratedRuntimeBasicDirtActionReceiptHashV1(receiptBase),
  });
  const packet = encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1({
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

test("fresh cursor zero delivers immediate place, holds input, checkpoints, and acknowledges exactly once", async () => {
  const runtime = new DirtRuntime();
  const live = pump(runtime, 0);
  live.sample(GENERATION, intent(false, true));
  const first = await live.advance(GENERATION);
  const delivery = first.basicDirtAction!;
  assert.equal(delivery.receipt.action, "place");
  assert.equal(delivery.receipt.sequence, 1);
  assert.deepEqual(runtime.calls, ["step", "command", "extract"]);
  assert.equal(live.diagnostics().basicDirtActionCursor, 0, "delivery must not advance projection custody");
  assert.equal(live.diagnostics().pendingBasicDirtActionSequence, 1);

  const held = await live.advance(GENERATION);
  assert.equal(held.step, null);
  assert.equal(held.basicDirtAction, delivery);
  assert.equal(runtime.steps, 1, "unacknowledged projection must hold native input advance");

  const checkpoint = await live.checkpointNativePersistence(GENERATION, async () => {
    runtime.advancePersistence();
    return "saved";
  });
  assert.equal(checkpoint.value, "saved");
  assert.equal(live.diagnostics().pendingBasicDirtActionSequence, 1);
  assert.equal(live.acknowledgeBasicDirtAction(GENERATION, delivery), true);
  assert.equal(live.diagnostics().basicDirtActionCursor, 1);
  assert.equal(live.acknowledgeBasicDirtAction(GENERATION, delivery), false, "exact duplicate ack is idempotent");
  assert.throws(
    () => live.acknowledgeBasicDirtAction(GENERATION, conflictingDelivery(delivery)),
    /conflicting hash/u,
  );
  assert.equal(live.state, "failed");
});

test("legacy null cursor seeds latest without replay before delivering a new action", async () => {
  const runtime = new DirtRuntime();
  runtime.history.push(actionProjection(1, 1, 0, "place"));
  const live = pump(runtime, null);
  live.sample(GENERATION, intent());
  const seeded = await live.advance(GENERATION);
  assert.equal(seeded.basicDirtAction, null);
  assert.equal(live.diagnostics().basicDirtActionCursor, 1);
  assert.equal(live.diagnostics().basicDirtActionLegacySeedPending, false);

  live.sample(GENERATION, intent(false, true));
  const fresh = await live.advance(GENERATION);
  assert.equal(fresh.basicDirtAction?.receipt.sequence, 2);
  assert.equal(fresh.basicDirtAction?.receipt.action, "place");
});

test("generic primary press has no rich receipt; held mining completion arrives later from the durable tail", async () => {
  const runtime = new DirtRuntime();
  runtime.generateMineAtStep = 3;
  const live = pump(runtime, 0);
  live.sample(GENERATION, intent(true));
  const pressed = await live.advance(GENERATION);
  assert.equal(pressed.step?.actionReceipts.length, 1);
  assert.equal(pressed.basicDirtAction, null, "generic primary edge is not mining completion");

  live.sample(GENERATION, intent(true));
  assert.equal((await live.advance(GENERATION)).basicDirtAction, null);
  live.sample(GENERATION, intent(true));
  const completed = await live.advance(GENERATION);
  assert.equal(completed.step?.actionReceipts.length, 0);
  assert.equal(completed.basicDirtAction?.receipt.action, "mine");
  assert.equal(completed.basicDirtAction?.receipt.originInputSequence, 1);
  assert.equal(live.acknowledgeBasicDirtAction(GENERATION, completed.basicDirtAction!), true);
});

for (const fault of ["gap", "corrupt-native-hash", "identity-drift"] as const) {
  test(`${fault} basic Dirt query fails closed before extraction`, async () => {
    const runtime = new DirtRuntime();
    runtime.queryFault = fault;
    const live = pump(runtime, 0);
    live.sample(GENERATION, intent(false, true));
    await assert.rejects(live.advance(GENERATION), /basic Dirt|identity|canonical|gapped|out of order/u);
    assert.equal(runtime.extracts, 0);
    assert.deepEqual(runtime.calls, ["step", "command"]);
    assert.equal(live.state, "failed");
    assert.equal(live.diagnostics().pendingBasicDirtActionSequence, null);
  });
}

test("lifecycle generation stop discards an in-flight query and clears pending projection state", async () => {
  const runtime = new DirtRuntime();
  let release: () => void = () => undefined;
  runtime.commandBarrier = new Promise<void>((resolve) => { release = resolve; });
  let started: () => void = () => undefined;
  const commandStarted = new Promise<void>((resolve) => { started = resolve; });
  runtime.commandStarted = started;
  const live = pump(runtime, 0);
  live.sample(GENERATION, intent(false, true));
  const advancing = live.advance(GENERATION);
  await commandStarted;
  const stopping = live.stop();
  release();
  assert.deepEqual(await advancing, { discarded: true, step: null, extraction: null });
  await stopping;
  assert.equal(live.state, "stopped");
  assert.equal(live.diagnostics().pendingBasicDirtActionSequence, null);
  assert.equal(runtime.extracts, 0);
});
