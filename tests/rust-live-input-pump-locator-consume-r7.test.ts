import assert from "node:assert/strict";
import test from "node:test";

import { encodeRustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-codec-r6.ts";
import type { RustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-contract-r6.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import type {
  RustIntegratedRuntimeAcceptedReceiptV1,
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeInputFrameV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import {
  RUST_INTEGRATED_PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_TYPE_V1,
  decodeRustIntegratedPlayerLocatorItemConsumeV1,
  encodeRustIntegratedPlayerLocatorItemConsumeReceiptV1,
  planRustLiveLocatorItemConsumeV1,
  rustIntegratedContainerViewKeyV1,
  type RustIntegratedPlayerLocatorItemConsumeV1,
  type RustLiveLocatorItemConsumePlanV1,
} from "../app/game/rust-integrated-runtime-player-locator-consume.ts";
import type { RustIntegratedGameplayAuthorityIdentityV1 } from "../app/game/rust-integrated-runtime-player-inventory.ts";
import {
  RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_RECEIPT_TYPE_V1,
  RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_TYPE_V1,
  decodeRustIntegratedPlayerCreativeSlotSetV1,
  encodeRustIntegratedPlayerCreativeSlotSetReceiptV1,
  rustIntegratedPlayerCreativeSlotSetReceiptHashV1,
  type RustIntegratedPlayerCreativeSlotSetV1,
} from "../app/game/rust-integrated-runtime-player-creative-slot.ts";
import {
  RustLiveInputPumpR5,
  type RustLiveInputPumpServiceR5,
} from "../app/game/rust-live-input-pump-r5.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";

const GENERATION = 73;
const EXTERNAL_ID = "player:locator";
const ENTITY_ID = BigInt("4294967297");
const PLAYER_ID = BigInt("12884901895");
const inventory = Object.freeze({ kind: "player" as const, id: EXTERNAL_ID, ownerId: EXTERNAL_ID });
const equipment = Object.freeze({ kind: "equipment" as const, id: `${EXTERNAL_ID}:equipment`, ownerId: EXTERNAL_ID });
const stack = Object.freeze({ itemCode: 701, count: 2, durabilityMillionths: null, metadataHash: "12".repeat(16) });
const intent: RustIntegratedPlayerLocatorItemConsumeV1 = Object.freeze({
  inventory,
  selectedSlot: 3,
  expectedInventoryRevision: BigInt(9),
  expectedStack: stack,
  purpose: "chart",
  locatorResultHash: "34".repeat(16),
});
const creativeIntent: RustIntegratedPlayerCreativeSlotSetV1 = Object.freeze({
  inventory,
  selectedSlot: 3,
  expectedInventoryRevision: BigInt(9),
  expectedStack: stack,
  replacementStack: Object.freeze({ ...stack, count: 64 }),
});
const encoder = new TextEncoder();
const ZERO = new Uint8Array(16);

function hash(seed: number) { return seed.toString(16).padStart(32, "0").slice(-32); }

function identity(
  gameplay = 1,
  simulation = 1,
  tick = 0,
  state = hash(100),
  overrides: Partial<RustIntegratedRuntimeIdentityV1["revision"]> = {},
): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "world:locator",
    locationId: "surface",
    revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay, persistence: 1, network: 1, simulation, ...overrides }),
    tick,
    stateHash: state,
  });
}

function gameplayIdentity(sequence: bigint, inventoryRevision: bigint, stateHash: string): RustIntegratedGameplayAuthorityIdentityV1 {
  return Object.freeze({
    universe: "world:locator",
    location: "surface",
    revision: Object.freeze({ epoch: 1, sequence, inventory: inventoryRevision, machines: BigInt(1), combat: BigInt(1), progression: BigInt(1), cardforge: BigInt(1) }),
    stateHash,
  });
}

function hashBytes(value: string) {
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function emptyAudioExtraction(authorityTick: number) {
  return new Writer().raw(encoder.encode("BWAU")).u16(2).u64(authorityTick)
    .u32(0).u32(0).u32(0).finish();
}

class Writer {
  readonly output: number[] = [];
  raw(value: Uint8Array | readonly number[]) { this.output.push(...value); return this; }
  u8(value: number) { this.output.push(value); return this; }
  u16(value: number) { this.output.push(value & 0xff, value >>> 8 & 0xff); return this; }
  u32(value: number) { this.output.push(value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff); return this; }
  u64(value: bigint | number) { let remaining = BigInt.asUintN(64, BigInt(value)); for (let index = 0; index < 8; index += 1) { this.output.push(Number(remaining & BigInt(0xff))); remaining >>= BigInt(8); } return this; }
  f64(value: number) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); return this.raw(bytes); }
  string(value: string) { const bytes = encoder.encode(value); return this.u32(bytes.byteLength).raw(bytes); }
  finish() { return Uint8Array.from(this.output); }
}

type Field = readonly [string, Uint8Array];
const boolField = (value: boolean) => new Writer().u8(0).u8(value ? 1 : 0).finish();
const u64Field = (value: bigint | number) => new Writer().u8(1).u64(value).finish();
const i64Field = (value: bigint | number) => new Writer().u8(2).u64(value).finish();
const f64Field = (value: number) => new Writer().u8(3).f64(value).finish();
const stringField = (value: string) => new Writer().u8(4).string(value).finish();
const hashField = (value: string) => new Writer().u8(5).raw(hashBytes(value)).finish();

function row(kind: number, key: string, fields: readonly Field[]) {
  const ordered = [...fields].sort(([left], [right]) => left.localeCompare(right, "en"));
  const revision = new TypeScriptCanonicalHasher("blockwild.r10.domain-row-revision.v1")
    .writeU16(kind).writeString(key).writeU16(ordered.length);
  for (const [name, value] of ordered) revision.writeString(name).writeBytes(value);
  const revisionBytes = revision.finish();
  const revisionNumber = new DataView(revisionBytes.buffer, revisionBytes.byteOffset, 8).getBigUint64(0, true);
  const writer = new Writer().u16(kind).string(key).u64(revisionNumber).u16(ordered.length);
  for (const [name, value] of ordered) writer.string(name).raw(value);
  return writer.finish();
}

function playerDomainPayload(inventoryRevision: bigint, heldCount: number | null) {
  const runtime = row(1, EXTERNAL_ID, [
    ["buttons", u64Field(0)],
    ["contactFlags", u64Field(0)],
    ["crouching", boolField(false)],
    ["drowningAccumulator", f64Field(0)],
    ["entityId", u64Field(ENTITY_ID)],
    ["fallDistance", f64Field(0)],
    ["flags", u64Field(0)],
    ["grounded", boolField(true)],
    ["height", f64Field(1.8)],
    ["lastInputSequence", u64Field(0)],
    ["lookPitch", i64Field(0)],
    ["mass", f64Field(1)],
    ["maximumOxygenSeconds", f64Field(10)],
    ["oxygenSeconds", f64Field(10)],
    ["position.x", f64Field(8)], ["position.y", f64Field(64)], ["position.z", f64Field(8)],
    ["radius", f64Field(0.3)],
    ["selectedSlot", u64Field(3)],
    ["velocity.x", f64Field(0)], ["velocity.y", f64Field(0)], ["velocity.z", f64Field(0)],
  ]);
  const bindingFields: Field[] = [
    ["actorId", stringField(EXTERNAL_ID)],
    ["backSlot.present", boolField(false)],
    ["entityId", u64Field(ENTITY_ID)],
    ["entityRevision", u64Field(1)],
    ["equipmentContainer", stringField(rustIntegratedContainerViewKeyV1(equipment))],
    ["equipmentContainerRevision", u64Field(0)],
    ["held.present", boolField(heldCount !== null)],
    ["inventoryContainer", stringField(rustIntegratedContainerViewKeyV1(inventory))],
    ["inventoryContainerRevision", u64Field(inventoryRevision)],
    ["playerId", u64Field(PLAYER_ID)],
    ["selectedSlot", u64Field(3)],
  ];
  if (heldCount !== null) {
    bindingFields.push(
      ["held.count", u64Field(heldCount)],
      ["held.durability.present", boolField(false)],
      ["held.itemCode", u64Field(stack.itemCode)],
      ["held.metadataHash", hashField(stack.metadataHash)],
    );
  }
  const binding = row(2, `binding:${PLAYER_ID}`, bindingFields);
  return new Writer().raw(runtime).raw(binding).finish();
}

function domainBundle(extractionRevision: number, authorityTick: number, inventoryRevision: bigint, heldCount: number | null) {
  const playerPayload = playerDomainPayload(inventoryRevision, heldCount);
  const combatPayload = row(1, `combatant:${EXTERNAL_ID}`, [
    ["alive", boolField(true)],
    ["combatantRevision", u64Field(1)],
    ["crossDomainParity", boolField(true)],
    ["entityId", u64Field(ENTITY_ID)],
    ["health", u64Field(20_000)],
    ["maxHealth", u64Field(20_000)],
    ["ownerId.present", boolField(true)],
    ["ownerId.value", stringField(EXTERNAL_ID)],
    ["vitalUnits", stringField("millihearts-v1")],
  ]);
  const writer = new Writer().raw(encoder.encode("BWX0")).u16(1).u64(extractionRevision).u64(authorityTick)
    .raw(hashBytes(hash(200))).raw(ZERO).u8(0).u16(8);
  for (let domain = 1; domain <= 8; domain += 1) {
    const payload = domain === 2 ? playerPayload : domain === 5 ? combatPayload : new Uint8Array();
    const count = domain === 2 ? 2 : domain === 5 ? 1 : 0;
    const payloadHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-view-payload.v1").writeBytes(payload).finish();
    writer.u8(domain).u16(1).u8(0).u64(domain === 2 ? inventoryRevision : domain === 5 ? 1 : 0)
      .u32(count).u32(count).u32(0).u32(count).u16(0)
      .u32(payload.byteLength).raw(payloadHash).raw(payload);
  }
  return writer.finish();
}

function entityExtraction(extractionRevision: number, authorityTick: number) {
  const entities: RustEntityExtractionR6V3 = Object.freeze({
    schema: 3,
    extractionRevision: BigInt(extractionRevision),
    authorityTick: BigInt(authorityTick),
    contentManifestHash: ZERO,
    contentReady: false,
    total: 1,
    selected: 1,
    omitted: 0,
    records: Object.freeze([Object.freeze({
      entityId: ENTITY_ID,
      residency: "hot" as const,
      class: "player" as const,
      simulationTier: "hero" as const,
      protection: BigInt(0),
      entityRevision: BigInt(1),
      externalEntityId: EXTERNAL_ID,
      specimenId: EXTERNAL_ID,
      kindKey: "player",
      variantKey: null,
      name: "Locator Player",
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
      movementMode: "ground" as const,
      grounded: true,
      submerged: false,
      lastDamageTick: BigInt(0),
      action: Object.freeze({ key: "idle", phase: 0, startedTick: BigInt(0), endsTick: BigInt(0), target: null }),
      equipment: Object.freeze([]),
      mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
      research: Object.freeze([]),
    })]),
  });
  return encodeRustEntityExtractionR6V3(entities);
}

function outerReceiptHash(value: Omit<RustIntegratedRuntimeAcceptedReceiptV1, "receiptHash">) {
  const bytes = [
    ...hashBytes(value.commandHash), ...hashBytes(value.before.stateHash), ...hashBytes(value.after.stateHash),
    ...value.domainReceipts.flatMap((operation) => [...hashBytes(operation.payloadHash)]),
  ];
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes));
}

function continuity() {
  return Object.freeze({
    lastMonotonicTimeUs: BigInt(0), lastInputSequence: null, nextInputSequence: BigInt(1),
    lastActionSequence: null, nextActionSequence: BigInt(1), authoritativeFlags: 0,
    lastAppliedInput: null, queuedInputsEmpty: true,
  });
}

function status(tick = 0) {
  return Object.freeze({
    entityAuthority: Object.freeze({ revision: BigInt(1), nextSequence: BigInt(1), tick: BigInt(tick) }),
    continuity: continuity(),
    worldViewBinding: Object.freeze({
      playerId: PLAYER_ID, revision: BigInt(1), actorId: EXTERNAL_ID, entityId: ENTITY_ID,
      inventoryContainer: inventory, equipmentContainer: equipment, selectedSlot: 3, backSlot: null,
    }),
  });
}

class LocatorRuntime implements RustLiveInputPumpServiceR5 {
  current = identity();
  extractionRevision = 0;
  inventoryRevision = BigInt(9);
  heldCount: number | null = 2;
  gameplaySequence = BigInt(11);
  gameplayInventoryRevision = BigInt(20);
  fixedStepsRemaining = 0;
  nativeInputPending = false;
  staleReadback = false;
  rejectCommand = false;
  delayCommand: (() => Promise<void>) | null = null;
  readonly calls: string[] = [];
  concurrent = 0;
  maximumConcurrent = 0;
  lastAcceptedReceipt: RustIntegratedRuntimeAcceptedReceiptV1 | null = null;

  identity() { return this.current; }

  async step(_monotonicTimeUs: number, _budgetUs: number, inputs: readonly RustIntegratedRuntimeInputFrameV1[]) {
    this.enter("step");
    try {
      if (inputs.length === 1) this.nativeInputPending = true;
      const fixedSteps = this.fixedStepsRemaining > 0 ? 1 : 0;
      if (fixedSteps) {
        this.fixedStepsRemaining -= 1;
        this.current = identity(
          this.current.revision.gameplay,
          this.current.revision.simulation + 1,
          this.current.tick + 1,
          hash(300 + this.current.tick),
        );
      }
      const inputsApplied = fixedSteps > 0 && this.nativeInputPending ? 1 : 0;
      if (inputsApplied === 1) this.nativeInputPending = false;
      return Object.freeze({
        type: "runtime-step-result-v1" as const, requestId: this.calls.length, clientEpoch: 1, workerEpoch: 1,
        identity: this.current, fixedSteps, inputsApplied, commandsProcessed: 0, commandsAccepted: 0,
        actionReceipts: Object.freeze([]), replayHash: hash(400 + this.current.tick),
      });
    } finally { this.leave(); }
  }

  async extract(afterRevision: number): Promise<RustIntegratedRuntimeExtractionV1> {
    this.enter("extract");
    try {
      assert.ok(afterRevision <= this.extractionRevision);
      this.extractionRevision += 1;
      return Object.freeze({
        identity: this.current,
        extractionRevision: this.extractionRevision,
        render: entityExtraction(this.extractionRevision, this.current.tick),
        hud: domainBundle(
          this.extractionRevision,
          this.current.tick,
          this.staleReadback ? this.inventoryRevision - BigInt(1) : this.inventoryRevision,
          this.staleReadback ? 2 : this.heldCount,
        ),
        audio: emptyAudioExtraction(this.current.tick),
        platformRequests: new Uint8Array(), diagnostics: new Uint8Array(),
        extractionHash: hash(500 + this.extractionRevision),
      });
    } finally { this.leave(); }
  }

  async command(batch: RustIntegratedRuntimeCommandBatchV1) {
    this.enter("command");
    try {
      if (this.delayCommand) await this.delayCommand();
      assert.equal(batch.operations.length, 1);
      if (this.rejectCommand) {
        const source = Object.freeze({ status: "rejected" as const, commandId: batch.commandId, idempotencyKey: batch.idempotencyKey,
          commandHash: batch.commandHash, current: this.current, code: "stale-inventory", message: "stale selected-slot CAS" });
        const receiptHash = rustIntegratedRuntimeWireChecksumV1(Uint8Array.from([
          ...hashBytes(source.commandHash), ...hashBytes(source.current.stateHash), ...encoder.encode(source.code), ...encoder.encode(source.message),
        ]));
        return Object.freeze({ ...source, receiptHash });
      }
      const operation = batch.operations[0];
      if (operation.typeId === RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_TYPE_V1) {
        return this.acceptCreativeSlot(batch, operation);
      }
      const decoded = decodeRustIntegratedPlayerLocatorItemConsumeV1(operation.payload);
      assert.deepEqual(decoded, intent);
      const before = this.current;
      const gameplayBefore = gameplayIdentity(this.gameplaySequence, this.gameplayInventoryRevision, hash(600));
      this.inventoryRevision += BigInt(1);
      this.heldCount = 1;
      this.gameplaySequence += BigInt(1);
      this.gameplayInventoryRevision += BigInt(1);
      this.current = identity(before.revision.gameplay + 1, before.revision.simulation, before.tick, hash(601));
      const gameplayAfter = gameplayIdentity(this.gameplaySequence, this.gameplayInventoryRevision, hash(602));
      const payload = encodeRustIntegratedPlayerLocatorItemConsumeReceiptV1({
        requestPayloadHash: operation.payloadHash,
        purpose: decoded.purpose,
        locatorResultHash: decoded.locatorResultHash,
        before: gameplayBefore,
        after: gameplayAfter,
        acceptedReceiptHash: hash(603),
        inventory,
        selectedSlot: decoded.selectedSlot,
        previousInventoryRevision: decoded.expectedInventoryRevision,
        resultingInventoryRevision: this.inventoryRevision,
        consumedStack: Object.freeze({ ...stack, count: 1 }),
        remainingStack: Object.freeze({ ...stack, count: 1 }),
        inventoryResultHash: hash(604),
      });
      const domainReceipt = createRustIntegratedRuntimeDomainOperationV1({
        domain: "gameplay",
        typeId: RUST_INTEGRATED_PLAYER_LOCATOR_ITEM_CONSUME_RECEIPT_TYPE_V1,
        schema: 1,
        payload,
      });
      const source = Object.freeze({
        status: "accepted" as const, commandId: batch.commandId, idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash, before, after: this.current, domainReceipts: Object.freeze([domainReceipt]),
      });
      this.lastAcceptedReceipt = Object.freeze({ ...source, receiptHash: outerReceiptHash(source) });
      return this.lastAcceptedReceipt;
    } finally { this.leave(); }
  }

  async recoverCommand(batch: RustIntegratedRuntimeCommandBatchV1) {
    this.enter("recover");
    try {
      const receipt = this.lastAcceptedReceipt;
      assert.ok(receipt, "test recovery requires one cached accepted receipt");
      assert.equal(receipt.commandHash, batch.commandHash);
      return receipt;
    } finally { this.leave(); }
  }

  private acceptCreativeSlot(
    batch: RustIntegratedRuntimeCommandBatchV1,
    operation: RustIntegratedRuntimeCommandBatchV1["operations"][number],
  ) {
    const decoded = decodeRustIntegratedPlayerCreativeSlotSetV1(operation.payload);
    assert.deepEqual(decoded, creativeIntent);
    const before = this.current;
    const gameplayBefore = gameplayIdentity(this.gameplaySequence, this.gameplayInventoryRevision, hash(650));
    this.inventoryRevision += BigInt(1);
    this.heldCount = decoded.replacementStack.count;
    this.gameplaySequence += BigInt(1);
    this.gameplayInventoryRevision += BigInt(1);
    this.current = identity(before.revision.gameplay + 1, before.revision.simulation, before.tick, hash(651));
    const receiptContents = {
      requestPayloadHash: operation.payloadHash,
      before: gameplayBefore,
      after: gameplayIdentity(this.gameplaySequence, this.gameplayInventoryRevision, hash(652)),
      acceptedReceiptHash: hash(653),
      inventory,
      selectedSlot: decoded.selectedSlot,
      previousInventoryRevision: decoded.expectedInventoryRevision,
      resultingInventoryRevision: this.inventoryRevision,
      previousStack: decoded.expectedStack,
      replacementStack: decoded.replacementStack,
      inventoryResultHash: hash(654),
    };
    const payload = encodeRustIntegratedPlayerCreativeSlotSetReceiptV1({
      ...receiptContents,
      receiptHash: rustIntegratedPlayerCreativeSlotSetReceiptHashV1(receiptContents),
    });
    const domainReceipt = createRustIntegratedRuntimeDomainOperationV1({
      domain: "gameplay",
      typeId: RUST_INTEGRATED_PLAYER_CREATIVE_SLOT_SET_RECEIPT_TYPE_V1,
      schema: 1,
      payload,
    });
    const source = Object.freeze({ status: "accepted" as const, commandId: batch.commandId, idempotencyKey: batch.idempotencyKey,
      commandHash: batch.commandHash, before, after: this.current, domainReceipts: Object.freeze([domainReceipt]) });
    this.lastAcceptedReceipt = Object.freeze({ ...source, receiptHash: outerReceiptHash(source) });
    return this.lastAcceptedReceipt;
  }

  private enter(kind: string) { this.calls.push(kind); this.concurrent += 1; this.maximumConcurrent = Math.max(this.maximumConcurrent, this.concurrent); }
  private leave() { this.concurrent -= 1; }
}

function pump(runtime: LocatorRuntime) {
  return new RustLiveInputPumpR5({
    service: runtime,
    status: status(runtime.identity().tick),
    worldGeneration: GENERATION,
    externalEntityId: EXTERNAL_ID,
    nowUs: () => 1,
  });
}

test("Creative selected-slot CAS is tail-serialized and publishes only after receipt plus extraction", async () => {
  const runtime = new LocatorRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  runtime.delayCommand = () => blocked;
  let published = false;
  const setting = live.setCreativeSlot(GENERATION, creativeIntent).then((result) => { published = true; return result; });
  while (!runtime.calls.includes("command")) await Promise.resolve();
  const following = live.advance(GENERATION);
  await Promise.resolve();
  assert.equal(published, false);
  assert.deepEqual(runtime.calls, ["step", "extract", "command"]);
  runtime.delayCommand = null;
  release();
  const [result] = await Promise.all([setting, following]);
  assert.equal(result.discarded, false);
  assert.equal(result.validated?.creativeSlot.replacementStack.count, 64);
  assert.equal(result.player?.held?.count, 64);
  assert.deepEqual(runtime.calls, ["step", "extract", "command", "extract", "step"]);
  assert.equal(runtime.maximumConcurrent, 1);
  await live.stop();
});

test("Creative selected-slot CAS fails closed on stale immediate readback", async () => {
  const runtime = new LocatorRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  runtime.staleReadback = true;
  await assert.rejects(live.setCreativeSlot(GENERATION, creativeIntent), /post-command player row/u);
  await live.drain();
  assert.equal(live.state, "failed");
  assert.deepEqual(runtime.calls, ["step", "extract", "command", "extract"]);
});

test("Creative selected-slot CAS rejection publishes no extraction", async () => {
  const runtime = new LocatorRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  runtime.rejectCommand = true;
  await assert.rejects(live.setCreativeSlot(GENERATION, creativeIntent), /stale selected-slot CAS/u);
  await live.drain();
  assert.equal(live.state, "failed");
  assert.deepEqual(runtime.calls, ["step", "extract", "command"]);
});

test("locator debit is serialized on the pump tail and permits only its command-specific same-tick extraction", async () => {
  const runtime = new LocatorRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  runtime.delayCommand = () => blocked;
  let persistedPlan: RustLiveLocatorItemConsumePlanV1 | null = null;
  const consuming = live.consumeLocatorItem(GENERATION, intent, {
    beforeDispatch: async (plan) => {
      assert.equal(runtime.calls.includes("command"), false, "durable plan callback must precede dispatch");
      persistedPlan = plan;
    },
  });
  while (!runtime.calls.includes("command")) await Promise.resolve();
  const followingAdvance = live.advance(GENERATION);
  await Promise.resolve();
  assert.deepEqual(runtime.calls, ["step", "extract", "command"]);
  runtime.delayCommand = null;
  release();
  const [consumed, idle] = await Promise.all([consuming, followingAdvance]);
  assert.equal(consumed.discarded, false);
  assert.equal(consumed.plan, persistedPlan);
  assert.equal(consumed.receipt?.status, "accepted");
  assert.equal(consumed.validated?.outer.before.tick, consumed.validated?.outer.after.tick);
  assert.equal(consumed.player?.inventoryContainerRevision, BigInt(10));
  assert.equal(consumed.player?.held?.count, 1);
  assert.equal(idle.step?.fixedSteps, 0);
  assert.deepEqual(runtime.calls, ["step", "extract", "command", "extract", "step"]);
  assert.equal(runtime.maximumConcurrent, 1);

  runtime.fixedStepsRemaining = 1;
  const stepped = await live.advance(GENERATION);
  assert.equal(stepped.step?.identity.tick, 1);
  assert.equal(stepped.cause, "authority");
  assert.deepEqual(runtime.calls.slice(-2), ["step", "extract"]);
  await live.stop();
});

test("durable locator plan rejection sends no command and fails closed", async () => {
  const runtime = new LocatorRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  await assert.rejects(
    live.consumeLocatorItem(GENERATION, intent, {
      beforeDispatch: async (plan) => {
        assert.deepEqual(plan.batch.expected, runtime.identity());
        assert.deepEqual(runtime.calls, ["step", "extract"]);
        throw new Error("journal unavailable");
      },
    }),
    /journal unavailable/u,
  );
  await live.drain();
  assert.equal(live.state, "failed");
  assert.deepEqual(runtime.calls, ["step", "extract"], "failed persistence cannot send native authority");
});

test("pre-debit durable recovery uses ordinary command dispatch", async () => {
  const runtime = new LocatorRuntime();
  const plan = planRustLiveLocatorItemConsumeV1(runtime.identity(), EXTERNAL_ID, intent);
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  const result = await live.recoverLocatorItem(GENERATION, plan);
  assert.equal(result.discarded, false);
  assert.equal(result.plan?.batch.commandHash, plan.batch.commandHash);
  assert.equal(runtime.calls.includes("recover"), false);
  assert.deepEqual(runtime.calls, ["step", "extract", "command", "extract"]);
  await live.stop();
});

test("post-debit durable recovery is lookup-only and binds the current terminal identity", async () => {
  const runtime = new LocatorRuntime();
  const plan = planRustLiveLocatorItemConsumeV1(runtime.identity(), EXTERNAL_ID, intent);
  await runtime.command(plan.batch);
  runtime.current = identity(2, 1, 0, hash(777), { persistence: 2 });
  runtime.calls.length = 0;
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  const result = await live.recoverLocatorItem(GENERATION, plan);
  assert.equal(result.discarded, false);
  assert.notEqual(result.validated?.outer.after.stateHash, runtime.identity().stateHash);
  assert.equal(result.extraction?.identity.stateHash, runtime.identity().stateHash);
  assert.deepEqual(runtime.calls, ["step", "extract", "recover", "extract"]);
  assert.equal(runtime.calls.filter((call) => call === "command").length, 0);
  await live.stop();
});

test("post-debit recovery rejects every non-persistence authority or tick drift", async (context) => {
  const cases: ReadonlyArray<readonly [string, (after: RustIntegratedRuntimeIdentityV1) => RustIntegratedRuntimeIdentityV1]> = [
    ["world", (after) => Object.freeze({ ...after, revision: Object.freeze({ ...after.revision, world: after.revision.world + 1 }), stateHash: hash(801) })],
    ["entities", (after) => Object.freeze({ ...after, revision: Object.freeze({ ...after.revision, entities: after.revision.entities + 1 }), stateHash: hash(802) })],
    ["gameplay", (after) => Object.freeze({ ...after, revision: Object.freeze({ ...after.revision, gameplay: after.revision.gameplay + 1 }), stateHash: hash(803) })],
    ["network", (after) => Object.freeze({ ...after, revision: Object.freeze({ ...after.revision, network: after.revision.network + 1 }), stateHash: hash(804) })],
    ["simulation", (after) => Object.freeze({ ...after, revision: Object.freeze({ ...after.revision, simulation: after.revision.simulation + 1 }), stateHash: hash(805) })],
    ["tick", (after) => Object.freeze({ ...after, tick: after.tick + 1, stateHash: hash(806) })],
  ];
  for (const [label, mutate] of cases) await context.test(label, async () => {
    const runtime = new LocatorRuntime();
    const plan = planRustLiveLocatorItemConsumeV1(runtime.identity(), EXTERNAL_ID, intent);
    await runtime.command(plan.batch);
    runtime.current = mutate(runtime.current);
    runtime.calls.length = 0;
    const live = pump(runtime);
    await live.syncInitial(GENERATION);
    await assert.rejects(
      live.recoverLocatorItem(GENERATION, plan),
      /exact post-hydration authority axes/u,
    );
    await live.drain();
    assert.equal(live.state, "failed");
    assert.deepEqual(runtime.calls, ["step", "extract", "recover"]);
  });
});

test("locator debit fails the pump closed when immediate authoritative custody readback is stale", async () => {
  const runtime = new LocatorRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  runtime.staleReadback = true;
  await assert.rejects(
    live.consumeLocatorItem(GENERATION, intent),
    /post-command player row/u,
  );
  await live.drain();
  assert.equal(live.state, "failed");
  assert.deepEqual(runtime.calls, ["step", "extract", "command", "extract"]);
  assert.throws(() => live.consumeLocatorItem(GENERATION, intent), /pump is failed/u);
});

test("stop discards an awaited locator receipt without issuing post-stop extraction", async () => {
  const runtime = new LocatorRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  runtime.delayCommand = () => blocked;
  const consuming = live.consumeLocatorItem(GENERATION, intent);
  while (!runtime.calls.includes("command")) await Promise.resolve();
  const stopping = live.stop();
  runtime.delayCommand = null;
  release();
  const discarded = await consuming;
  assert.equal(discarded.discarded, true);
  assert.ok(discarded.plan);
  assert.equal(discarded.receipt, null);
  assert.equal(discarded.extraction, null);
  await stopping;
  assert.equal(live.state, "stopped");
  assert.deepEqual(runtime.calls, ["step", "extract", "command"]);
});

test("native checkpoint waits behind the locator debit and adopts only its persistence successor", async () => {
  const runtime = new LocatorRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  let releaseCommand!: () => void;
  const commandGate = new Promise<void>((resolve) => { releaseCommand = resolve; });
  runtime.delayCommand = () => commandGate;
  const consuming = live.consumeLocatorItem(GENERATION, intent);
  while (!runtime.calls.includes("command")) await Promise.resolve();
  let checkpointEntered = false;
  const checkpoint = live.checkpointNativePersistence(GENERATION, async () => {
    checkpointEntered = true;
    const before = runtime.current;
    runtime.current = Object.freeze({
      ...before,
      revision: Object.freeze({ ...before.revision, persistence: before.revision.persistence + 1 }),
      stateHash: hash(901),
    });
    return "checkpoint-1";
  });
  await Promise.resolve();
  assert.equal(checkpointEntered, false, "checkpoint must stay behind the in-flight locator command");
  runtime.delayCommand = null;
  releaseCommand();
  const [consumed, saved] = await Promise.all([consuming, checkpoint]);
  assert.equal(consumed.discarded, false);
  assert.equal(saved.discarded, false);
  assert.equal(saved.value, "checkpoint-1");
  assert.equal(saved.after?.revision.persistence, saved.before!.revision.persistence + 1);
  assert.equal(saved.after?.stateHash, hash(901));
  const idle = await live.advance(GENERATION);
  assert.equal(idle.discarded, false, "the adopted checkpoint identity must keep the pump usable");
  await live.stop();
});

test("native checkpoint rejects every non-persistence drift and incomplete successor", async (context) => {
  const cases: ReadonlyArray<readonly [string, (before: RustIntegratedRuntimeIdentityV1) => RustIntegratedRuntimeIdentityV1]> = [
    ["universe", (before) => Object.freeze({ ...before, universeId: "world:other", revision: Object.freeze({ ...before.revision, persistence: before.revision.persistence + 1 }), stateHash: hash(910) })],
    ["location", (before) => Object.freeze({ ...before, locationId: "below", revision: Object.freeze({ ...before.revision, persistence: before.revision.persistence + 1 }), stateHash: hash(911) })],
    ["tick", (before) => Object.freeze({ ...before, tick: before.tick + 1, revision: Object.freeze({ ...before.revision, persistence: before.revision.persistence + 1 }), stateHash: hash(912) })],
    ...(["epoch", "world", "entities", "gameplay", "network", "simulation"] as const).map((key, index) => [
      key,
      (before: RustIntegratedRuntimeIdentityV1) => Object.freeze({
        ...before,
        revision: Object.freeze({ ...before.revision, [key]: before.revision[key] + 1, persistence: before.revision.persistence + 1 }),
        stateHash: hash(920 + index),
      }),
    ] as const),
    ["no persistence advance", (before) => Object.freeze({ ...before, stateHash: hash(930) })],
    ["unchanged state hash", (before) => Object.freeze({ ...before, revision: Object.freeze({ ...before.revision, persistence: before.revision.persistence + 1 }) })],
  ];
  for (const [label, mutate] of cases) await context.test(label, async () => {
    const runtime = new LocatorRuntime();
    const live = pump(runtime);
    await live.syncInitial(GENERATION);
    await assert.rejects(
      live.checkpointNativePersistence(GENERATION, async () => {
        runtime.current = mutate(runtime.current);
        return label;
      }),
      /exact persistence-only authority successor/u,
    );
    await live.drain();
    assert.equal(live.state, "failed");
  });
});

test("native checkpoint distinguishes pre-mutation failure from an indeterminate moved identity", async () => {
  const beforeRuntime = new LocatorRuntime();
  const beforeLive = pump(beforeRuntime);
  await beforeLive.syncInitial(GENERATION);
  await assert.rejects(
    beforeLive.checkpointNativePersistence(GENERATION, async () => { throw new Error("storage unavailable"); }),
    /storage unavailable/u,
  );
  await beforeLive.drain();
  assert.equal(beforeLive.state, "failed");

  const afterRuntime = new LocatorRuntime();
  const afterLive = pump(afterRuntime);
  await afterLive.syncInitial(GENERATION);
  await assert.rejects(
    afterLive.checkpointNativePersistence(GENERATION, async () => {
      const before = afterRuntime.current;
      afterRuntime.current = Object.freeze({
        ...before,
        revision: Object.freeze({ ...before.revision, persistence: before.revision.persistence + 1 }),
        stateHash: hash(940),
      });
      throw new Error("platform acknowledgement lost");
    }),
    /failed after moving the authoritative runtime identity/u,
  );
  await afterLive.drain();
  assert.equal(afterLive.state, "failed");
});

test("stop discards a native checkpoint that became durable after lifecycle supersession", async () => {
  const runtime = new LocatorRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const saving = live.checkpointNativePersistence(GENERATION, async () => {
    const before = runtime.current;
    runtime.current = Object.freeze({
      ...before,
      revision: Object.freeze({ ...before.revision, persistence: before.revision.persistence + 1 }),
      stateHash: hash(950),
    });
    entered();
    await gate;
    return "durable";
  });
  await started;
  const stopping = live.stop();
  release();
  const discarded = await saving;
  assert.equal(discarded.discarded, true);
  assert.equal(discarded.value, null);
  assert.equal(discarded.after?.stateHash, hash(950));
  await stopping;
  assert.equal(live.state, "stopped");
});
