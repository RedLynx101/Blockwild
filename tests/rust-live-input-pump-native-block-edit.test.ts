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
  RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1,
} from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";
import {
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1,
  decodeRustIntegratedRuntimeDropPickupQueryV1,
  encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1,
} from "../app/game/rust-integrated-runtime-drop-pickup.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_V2,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V2,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1,
  decodeRustIntegratedRuntimeNativeBlockEditQueryV1,
  decodeRustIntegratedRuntimeNativeBlockEditQueryV2,
  encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1,
  encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2,
  rustIntegratedRuntimeNativeBlockEditContentSubsetHashV1,
  rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2,
  rustIntegratedRuntimeNativeBlockEditReceiptHashV1,
  type RustIntegratedRuntimeNativeBlockEditContentBindingV1,
  type RustIntegratedRuntimeNativeBlockEditReceiptV1,
} from "../app/game/rust-integrated-runtime-native-block-edit.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1,
  decodeRustIntegratedRuntimeNativePlayerDropQueryV1,
  encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1,
} from "../app/game/rust-integrated-runtime-player-drop.ts";
import type { RustIntegratedPlayerRuntimeContinuityV1 } from "../app/game/rust-integrated-runtime-player-status.ts";
import {
  RustLiveInputPumpR5,
  type RustLiveInputIntentR5,
  type RustLiveInputPumpNativeBlockEditDeliveryV1,
  type RustLiveInputPumpServiceR5,
} from "../app/game/rust-live-input-pump-r5.ts";

const GENERATION = 41;

function hash(value: number) {
  return value.toString(16).padStart(32, "0").slice(-32);
}

function identity(tick = 0, simulation = 0, persistence = 1, state = 1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe-native-block-edit",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1,
      world: 1,
      entities: 1,
      gameplay: 1,
      persistence,
      network: 1,
      simulation,
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
      actorId: "actor:test",
      entityId: BigInt("4294967297"),
      inventoryContainer: Object.freeze({ kind: "player" as const, id: "actor:test", ownerId: "actor:test" }),
      equipmentContainer: Object.freeze({
        kind: "equipment" as const,
        id: "actor:test:equipment",
        ownerId: "actor:test",
      }),
      selectedSlot: 0,
      backSlot: 7,
    }),
  });
}

function intent(secondaryUse = false): RustLiveInputIntentR5 {
  return Object.freeze({
    moveX: 0,
    moveZ: 0,
    yawRadians: 0,
    pitchRadians: 0,
    selectedSlot: 0,
    held: Object.freeze({ jump: false, crouch: false, sprint: false, ascend: false, descend: false }),
    actions: Object.freeze({
      primaryAttack: false,
      secondaryUse,
      interact: false,
      mountToggle: false,
      creativeFlightToggle: false,
      drop: false,
    }),
  });
}

function content(): RustIntegratedRuntimeNativeBlockEditContentBindingV1 {
  const base = Object.freeze({
    blockId: 2,
    manifestHash: hash(11),
    installedRegistryHash: hash(12),
    catalogSchemaVersion: 2,
    catalogContentVersion: 9,
    catalogBlobHash: hash(13),
    actionReportHash: hash(14),
    subsetHash: hash(15),
  });
  return Object.freeze({ ...base, subsetHash: rustIntegratedRuntimeNativeBlockEditContentSubsetHashV1(base) });
}

function blockEditReceipt(
  sequence: number,
  originInputSequence: number,
  completionTick: number,
): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  const base = Object.freeze({
    schema: 1 as const,
    sequence,
    originInputSequence,
    completionTick,
    action: "place" as const,
    position: Object.freeze({ x: 4, y: 43, z: -3 }),
    priorBlockId: 0,
    priorFacing: 0,
    replacementBlockId: 2,
    replacementFacing: 0,
    beforeWorldRevision: Object.freeze({ epoch: 1, mutation: sequence, residency: 3 }),
    afterWorldRevision: Object.freeze({ epoch: 1, mutation: sequence + 1, residency: 3 }),
    beforeWorldHash: hash(40 + sequence),
    afterWorldHash: hash(50 + sequence),
    creativeMode: false,
    inventory: Object.freeze({
      container: Object.freeze({ kind: "player" as const, id: "actor:test", ownerId: "actor:test" }),
      selectedSlot: 0,
      beforeRevision: BigInt(4 + sequence),
      afterRevision: BigInt(5 + sequence),
      beforeStack: Object.freeze({
        itemCode: 2,
        count: 2,
        durabilityMillionths: null,
        metadataHash: hash(0),
      }),
      afterStack: Object.freeze({
        itemCode: 2,
        count: 1,
        durabilityMillionths: null,
        metadataHash: hash(0),
      }),
    }),
    generatedDrops: Object.freeze([]),
    content: content(),
    receiptHash: hash(60 + sequence),
  });
  return Object.freeze({ ...base, receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(base) });
}

function blockEditDirtyEvidence(receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1) {
  const base = Object.freeze({
    schema: 1 as const,
    sequence: receipt.sequence,
    receiptHash: receipt.receiptHash,
    sections: Object.freeze([Object.freeze({
      universeId: "universe-native-block-edit",
      locationId: "surface",
      chunkX: 0,
      chunkZ: -1,
      sectionY: 6,
    })]),
    columns: Object.freeze([Object.freeze({ x: 4, z: -3 })]),
    subsystemSeeds: Object.freeze(RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2
      .map((subsystem, index) => Object.freeze({ subsystem, seed: hash(500 + index) }))),
    evidenceHash: hash(0),
  });
  return Object.freeze({
    ...base,
    evidenceHash: rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2(base),
  });
}

function outerReceiptHash(
  receipt: Omit<Extract<RustIntegratedRuntimeCommandReceiptV1, { status: "accepted" }>, "receiptHash">,
) {
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
    ...Buffer.from(receipt.commandHash, "hex"),
    ...Buffer.from(receipt.before.stateHash, "hex"),
    ...Buffer.from(receipt.after.stateHash, "hex"),
    ...receipt.domainReceipts.flatMap((operation) => [...Buffer.from(operation.payloadHash, "hex")]),
  ]));
}

type QueryFault = "none" | "stale" | "future" | "malformed" | "missing-dirty";

class NativeBlockEditRuntime implements RustLiveInputPumpServiceR5 {
  current = identity();
  lastButtons = 0;
  nextActionSequence = 1;
  extractionRevision = 1;
  steps = 0;
  extracts = 0;
  queryFault: QueryFault = "none";
  supportsV2 = false;
  readonly legacyDirtySequences = new Set<number>();
  readonly history: RustIntegratedRuntimeNativeBlockEditReceiptV1[] = [];
  readonly queryTypes: string[] = [];

  identity() {
    return this.current;
  }

  diagnostics() {
    return Object.freeze({
      capabilities: Object.freeze(this.supportsV2
        ? [RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_V2]
        : []),
    });
  }

  async step(_time: number, _budget: number, inputs: readonly RustIntegratedRuntimeInputFrameV1[]) {
    this.steps += 1;
    const frame = inputs[0]!;
    assert.equal(inputs.length, 1);
    const rising = frame.buttons & ~this.lastButtons;
    const actionReceipts: RustIntegratedRuntimeInputActionReceiptV1[] = [];
    if ((rising & RUST_RUNTIME_INPUT_BUTTON_V1.secondaryUse) !== 0) {
      actionReceipts.push(Object.freeze({
        sequence: this.nextActionSequence++,
        inputSequence: frame.sequence,
        tick: this.current.tick + 1,
        kind: "secondary-use" as const,
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
      this.history.push(blockEditReceipt(this.history.length + 1, frame.sequence, this.current.tick));
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
    const operation = batch.operations[0]!;
    this.queryTypes.push(operation.typeId);
    if (operation.typeId === RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_RECEIPT_TYPE_V1) {
      throw new Error("suppressed Basic Dirt query was dispatched");
    }

    let response;
    let expected: RustIntegratedRuntimeIdentityV1;
    if (operation.typeId === RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1
      || operation.typeId === RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2) {
      const v2 = operation.typeId === RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2;
      assert.equal(operation.schema, v2 ? 2 : 1);
      const query = v2
        ? decodeRustIntegratedRuntimeNativeBlockEditQueryV2(operation.payload)
        : decodeRustIntegratedRuntimeNativeBlockEditQueryV1(operation.payload);
      expected = query.expected;
      const latest = this.history.at(-1)?.sequence ?? 0;
      const seed = query.afterSequence === RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1;
      let receipt = seed ? null : this.history.find((entry) => entry.sequence === query.afterSequence + 1) ?? null;
      let cursorAfter = seed ? latest : receipt?.sequence ?? query.afterSequence;
      if (this.queryFault === "stale") {
        receipt = null;
        cursorAfter = Math.max(0, query.afterSequence - 1);
      } else if (this.queryFault === "future" && receipt !== null) {
        receipt = blockEditReceipt(receipt.sequence + 1, receipt.originInputSequence, receipt.completionTick);
        cursorAfter = receipt.sequence;
      }
      let payload = v2
        ? encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2({
          requestPayloadHash: operation.payloadHash,
          identity: query.expected,
          cursorAfter,
          receipt,
          dirtyEvidence: receipt === null || this.queryFault === "missing-dirty"
            || this.legacyDirtySequences.has(receipt.sequence)
            ? null
            : blockEditDirtyEvidence(receipt),
        })
        : encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1({
          requestPayloadHash: operation.payloadHash,
          identity: query.expected,
          cursorAfter,
          receipt,
        });
      if (this.queryFault === "malformed") {
        payload = Uint8Array.from(payload);
        payload[payload.length - 1] ^= 0xff;
      }
      response = createRustIntegratedRuntimeDomainOperationV1({
        domain: "gameplay",
        typeId: v2
          ? RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V2
          : RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_PROJECTION_RECEIPT_TYPE_V1,
        schema: v2 ? 2 : 1,
        payload,
      });
    } else if (operation.typeId === RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1) {
      const query = decodeRustIntegratedRuntimeDropPickupQueryV1(operation.payload);
      expected = query.expected;
      const payload = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
        requestPayloadHash: operation.payloadHash,
        identity: query.expected,
        cursorAfter: query.afterSequence,
        receipt: null,
      }, query.afterSequence);
      response = createRustIntegratedRuntimeDomainOperationV1({
        domain: "gameplay",
        typeId: RUST_INTEGRATED_RUNTIME_DROP_PICKUP_PROJECTION_RECEIPT_TYPE_V1,
        schema: 1,
        payload,
      });
    } else if (operation.typeId === RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1) {
      const query = decodeRustIntegratedRuntimeNativePlayerDropQueryV1(operation.payload);
      expected = query.expected;
      const payload = encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
        requestPayloadHash: operation.payloadHash,
        identity: query.expected,
        cursorAfter: query.afterSequence,
        receipt: null,
      }, query.afterSequence);
      response = createRustIntegratedRuntimeDomainOperationV1({
        domain: "gameplay",
        typeId: RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_PROJECTION_RECEIPT_TYPE_V1,
        schema: 1,
        payload,
      });
    } else {
      throw new Error(`unexpected query type ${operation.typeId}`);
    }

    assert.deepEqual(expected, batch.expected);
    const accepted = {
      status: "accepted" as const,
      commandId: batch.commandId,
      idempotencyKey: batch.idempotencyKey,
      commandHash: batch.commandHash,
      before: expected,
      after: expected,
      domainReceipts: Object.freeze([response]),
    };
    return Object.freeze({ ...accepted, receiptHash: outerReceiptHash(accepted) });
  }

  async extract(): Promise<RustIntegratedRuntimeExtractionV1> {
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

function pump(
  runtime: NativeBlockEditRuntime,
  cursor: number | null,
  allDurableLanes = false,
) {
  let now = 50_000;
  return new RustLiveInputPumpR5({
    service: runtime,
    status: status(runtime.identity().tick),
    worldGeneration: GENERATION,
    initialNativeBlockEditCursor: cursor,
    ...(allDurableLanes ? {
      initialBasicDirtActionCursor: 0,
      initialDropPickupCursor: 0,
      initialNativePlayerDropCursor: 0,
    } : {}),
    nowUs: () => {
      now += 50_000;
      return now;
    },
  });
}

function conflictingDelivery(
  delivery: RustLiveInputPumpNativeBlockEditDeliveryV1,
): RustLiveInputPumpNativeBlockEditDeliveryV1 {
  const receiptBase = Object.freeze({
    ...delivery.receipt,
    beforeWorldHash: hash(988),
    receiptHash: hash(989),
  });
  const receipt = Object.freeze({
    ...receiptBase,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(receiptBase),
  });
  const packet = encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1({
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

test("generic block-edit custody is first, suppresses Basic Dirt, and serializes other durable tails", async () => {
  const runtime = new NativeBlockEditRuntime();
  const live = pump(runtime, 0, true);
  live.sample(GENERATION, intent(true));
  const first = await live.advance(GENERATION);
  const delivery = first.nativeBlockEdit!;
  assert.equal(delivery.protocolVersion, 1);
  assert.equal(delivery.legacyFallback, "v1-capability");
  assert.equal(delivery.dirty, null);
  assert.equal(delivery.receipt.action, "place");
  assert.equal(delivery.receipt.sequence, 1);
  assert.equal(first.basicDirtAction, null, "the compatibility Dirt lane cannot double-deliver the same edit");
  assert.deepEqual(runtime.queryTypes, [RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1]);
  assert.equal(live.diagnostics().basicDirtActionQuerySuppressedByNativeBlockEdit, true);
  assert.equal(live.diagnostics().basicDirtActionQueryCalls, 0);
  assert.equal(live.diagnostics().dropPickupQueryCalls, 0);
  assert.equal(live.diagnostics().playerDropQueryCalls, 0);

  assert.equal(live.acknowledgeNativeBlockEdit(GENERATION, delivery), true);
  live.sample(GENERATION, intent(true));
  const next = await live.advance(GENERATION);
  assert.equal(next.nativeBlockEdit, null);
  assert.equal(next.dropPickup, null);
  assert.equal(next.playerDrop, null);
  assert.deepEqual(runtime.queryTypes, [
    RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1,
    RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1,
    RUST_INTEGRATED_RUNTIME_DROP_PICKUP_RECEIPT_TYPE_V1,
    RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_RECEIPT_TYPE_V1,
  ]);
  assert.equal(live.diagnostics().basicDirtActionQueryCalls, 0);
});

test("V2 capability prefers exactly one BWZ8 query and delivers bound Rust dirty evidence", async () => {
  const runtime = new NativeBlockEditRuntime();
  runtime.supportsV2 = true;
  const live = pump(runtime, 0, true);
  assert.equal(live.diagnostics().nativeBlockEditProtocolVersion, 2);
  live.sample(GENERATION, intent(true));
  const first = await live.advance(GENERATION);
  const delivery = first.nativeBlockEdit!;
  assert.equal(delivery.protocolVersion, 2);
  assert.equal(delivery.legacyFallback, null);
  assert.equal(delivery.dirty?.sequence, delivery.receipt.sequence);
  assert.equal(delivery.dirty?.receiptHash, delivery.receipt.receiptHash);
  assert.deepEqual(delivery.dirty?.subsystemSeeds.map((entry) => entry.subsystem), [
    "lighting", "liquids", "topology", "meshing", "navigation", "maps", "persistence",
  ]);
  assert.deepEqual(runtime.queryTypes, [RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2]);
  assert.equal(live.diagnostics().pendingNativeBlockEditDirtyEvidenceHash, delivery.dirty?.evidenceHash);

  const held = await live.advance(GENERATION);
  assert.equal(held.nativeBlockEdit, delivery);
  assert.equal(runtime.queryTypes.length, 1, "pending V2 delivery must not re-query or fall back to BWZ7");
  assert.equal(live.acknowledgeNativeBlockEdit(GENERATION, delivery), true);
  assert.equal(live.acknowledgeNativeBlockEdit(GENERATION, delivery), false);
});

test("V2 tracked history labels absent evidence only as explicit pre-V14 legacy fallback", async () => {
  const runtime = new NativeBlockEditRuntime();
  runtime.supportsV2 = true;
  runtime.history.push(blockEditReceipt(1, 99, 0));
  runtime.legacyDirtySequences.add(1);
  const live = pump(runtime, 0);
  live.sample(GENERATION, intent());
  const delivery = (await live.advance(GENERATION)).nativeBlockEdit!;
  assert.equal(delivery.protocolVersion, 2);
  assert.equal(delivery.legacyFallback, "v2-pre-v14");
  assert.equal(delivery.dirty, null);
  assert.equal(live.diagnostics().pendingNativeBlockEditLegacyFallback, "v2-pre-v14");
  assert.deepEqual(runtime.queryTypes, [RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2]);
});

test("new V2 action without dirty evidence fails closed without a BWZ7 retry", async () => {
  const runtime = new NativeBlockEditRuntime();
  runtime.supportsV2 = true;
  runtime.queryFault = "missing-dirty";
  const live = pump(runtime, 0);
  live.sample(GENERATION, intent(true));
  await assert.rejects(live.advance(GENERATION), /new V2.*omitted|required Rust dirty evidence/u);
  assert.equal(live.state, "failed");
  assert.deepEqual(runtime.queryTypes, [RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V2]);
});

test("tracked generic cursor holds input, replays pending delivery, checkpoints, and acknowledges exactly once", async () => {
  const runtime = new NativeBlockEditRuntime();
  const live = pump(runtime, 0);
  live.sample(GENERATION, intent(true));
  const delivery = (await live.advance(GENERATION)).nativeBlockEdit!;
  assert.equal(live.diagnostics().nativeBlockEditCursor, 0);
  assert.equal(live.diagnostics().pendingNativeBlockEditSequence, 1);

  const held = await live.advance(GENERATION);
  assert.equal(held.step, null);
  assert.equal(held.nativeBlockEdit, delivery);
  assert.equal(runtime.steps, 1, "unacknowledged generic edit must hold native input");
  assert.equal(runtime.queryTypes.length, 1, "pending replay must not re-query Rust");

  const checkpoint = await live.checkpointNativePersistence(GENERATION, async () => {
    runtime.advancePersistence();
    return "saved";
  });
  assert.equal(checkpoint.value, "saved");
  assert.equal(live.diagnostics().pendingNativeBlockEditSequence, 1);
  assert.equal(live.acknowledgeNativeBlockEdit(GENERATION, delivery), true);
  assert.equal(live.diagnostics().nativeBlockEditCursor, 1);
  assert.equal(live.acknowledgeNativeBlockEdit(GENERATION, delivery), false);
  assert.throws(
    () => live.acknowledgeNativeBlockEdit(GENERATION, conflictingDelivery(delivery)),
    /conflicting hash/u,
  );
  assert.equal(live.state, "failed");
});

test("legacy null generic cursor seeds the latest receipt without replay", async () => {
  const runtime = new NativeBlockEditRuntime();
  runtime.history.push(blockEditReceipt(1, 1, 0));
  const live = pump(runtime, null);
  live.sample(GENERATION, intent());
  const seeded = await live.advance(GENERATION);
  assert.equal(seeded.nativeBlockEdit, null);
  assert.equal(live.diagnostics().nativeBlockEditCursor, 1);
  assert.equal(live.diagnostics().nativeBlockEditLegacySeedPending, false);

  live.sample(GENERATION, intent(true));
  const fresh = await live.advance(GENERATION);
  assert.equal(fresh.nativeBlockEdit?.receipt.sequence, 2);
});

for (const fault of ["stale", "future", "malformed"] as const) {
  test(`${fault} generic block-edit response fails closed before extraction`, async () => {
    const runtime = new NativeBlockEditRuntime();
    runtime.queryFault = fault;
    const live = pump(runtime, fault === "stale" ? 1 : 0);
    live.sample(GENERATION, intent(true));
    await assert.rejects(
      live.advance(GENERATION),
      /native block edit|native block-edit|cursor|gapped|stale|out of order|checksum|malformed/u,
    );
    assert.equal(runtime.extracts, 0);
    assert.equal(live.state, "failed");
    assert.equal(live.diagnostics().pendingNativeBlockEditSequence, null);
    assert.deepEqual(runtime.queryTypes, [RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_RECEIPT_TYPE_V1]);
  });
}
