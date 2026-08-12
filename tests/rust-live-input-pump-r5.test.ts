import assert from "node:assert/strict";
import test from "node:test";
import {
  RUST_RUNTIME_INPUT_BUTTON_V1,
  RUST_RUNTIME_INPUT_FLAG_V1,
  type RustIntegratedRuntimeExtractionV1,
  type RustIntegratedRuntimeIdentityV1,
  type RustIntegratedRuntimeInputActionKindV1,
  type RustIntegratedRuntimeInputActionReceiptV1,
  type RustIntegratedRuntimeInputFrameV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustIntegratedPlayerRuntimeContinuityV1 } from "../app/game/rust-integrated-runtime-player-status.ts";
import {
  RUST_LIVE_INPUT_STEP_BUDGET_US_R5,
  RustLiveInputPumpR5,
  quantizeRustLiveInputAxisR5,
  quantizeRustLiveInputPitchR5,
  quantizeRustLiveInputYawR5,
  type RustLiveInputIntentR5,
  type RustLiveInputPumpServiceR5,
} from "../app/game/rust-live-input-pump-r5.ts";

const GENERATION = 5;
const ACTIONS = Object.freeze([
  [RUST_RUNTIME_INPUT_BUTTON_V1.primaryAttack, "primary-attack"],
  [RUST_RUNTIME_INPUT_BUTTON_V1.secondaryUse, "secondary-use"],
  [RUST_RUNTIME_INPUT_BUTTON_V1.interact, "interact"],
  [RUST_RUNTIME_INPUT_BUTTON_V1.mountToggle, "mount-toggle"],
  [RUST_RUNTIME_INPUT_BUTTON_V1.creativeFlightToggle, "creative-flight-toggle"],
  [RUST_RUNTIME_INPUT_BUTTON_V1.drop, "drop"],
] as const satisfies readonly (readonly [number, RustIntegratedRuntimeInputActionKindV1])[]);

function hash(value: number) { return value.toString(16).padStart(32, "0").slice(-32); }

function identity(tick = 0, simulation = 0, state = 1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe-input-pump-test",
    locationId: "location-input-pump-test",
    revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation }),
    tick,
    stateHash: hash(state),
  });
}

function continuity(overrides: Partial<RustIntegratedPlayerRuntimeContinuityV1> = {}): RustIntegratedPlayerRuntimeContinuityV1 {
  return Object.freeze({
    lastMonotonicTimeUs: BigInt(0),
    lastInputSequence: null,
    nextInputSequence: BigInt(1),
    lastActionSequence: null,
    nextActionSequence: BigInt(1),
    authoritativeFlags: 0,
    lastAppliedInput: null,
    queuedInputsEmpty: true,
    ...overrides,
  });
}

function status(value: RustIntegratedPlayerRuntimeContinuityV1, tick = 0) {
  return Object.freeze({
    entityAuthority: Object.freeze({ revision: BigInt(1), nextSequence: BigInt(1), tick: BigInt(tick) }),
    continuity: value,
    worldViewBinding: Object.freeze({
      playerId: BigInt(1), revision: BigInt(1), actorId: "actor:test", entityId: BigInt("4294967297"),
      inventoryContainer: Object.freeze({ kind: "player" as const, id: "actor:test", ownerId: "actor:test" }),
      equipmentContainer: Object.freeze({ kind: "equipment" as const, id: "actor:test:equipment", ownerId: "actor:test" }),
      selectedSlot: value.lastAppliedInput?.selectedSlot ?? 0, backSlot: 7,
    }),
  });
}

function intent(overrides: Partial<RustLiveInputIntentR5> = {}): RustLiveInputIntentR5 {
  return Object.freeze({
    moveX: 0,
    moveZ: 1,
    yawRadians: 0,
    pitchRadians: 0,
    selectedSlot: 0,
    held: Object.freeze({ jump: false, crouch: false, sprint: false, ascend: false, descend: false }),
    actions: Object.freeze({ primaryAttack: false, secondaryUse: false, interact: false, mountToggle: false, creativeFlightToggle: false, drop: false }),
    ...overrides,
  });
}

function withAction(source: RustLiveInputIntentR5, action: keyof RustLiveInputIntentR5["actions"], down: boolean) {
  return Object.freeze({ ...source, actions: Object.freeze({ ...source.actions, [action]: down }) });
}

class FakeRuntime implements RustLiveInputPumpServiceR5 {
  current: RustIntegratedRuntimeIdentityV1;
  lastMonotonicTimeUs: number;
  accumulatorUs = 0;
  pending: RustIntegratedRuntimeInputFrameV1 | null = null;
  lastApplied: RustIntegratedRuntimeInputFrameV1 | null = null;
  authoritativeFlags: number;
  nextActionSequence: number;
  extractionRevision: number;
  position = 0;
  readonly submitted: RustIntegratedRuntimeInputFrameV1[] = [];
  readonly calls: string[] = [];
  readonly stepArguments: Array<Readonly<{ monotonicTimeUs: number; budgetUs: number; inputs: readonly RustIntegratedRuntimeInputFrameV1[] }>> = [];
  concurrent = 0;
  maximumConcurrent = 0;
  throwStep: Error | null = null;
  throwExtract: Error | null = null;
  invalidInputsApplied: number | null = null;
  delayStep: (() => Promise<void>) | null = null;
  delayExtract: (() => Promise<void>) | null = null;

  constructor(input: Readonly<{
    tick?: number;
    simulation?: number;
    lastMonotonicTimeUs?: number;
    authoritativeFlags?: number;
    nextActionSequence?: number;
    extractionRevision?: number;
    lastApplied?: RustIntegratedRuntimeInputFrameV1 | null;
  }> = {}) {
    this.current = identity(input.tick ?? 0, input.simulation ?? 0);
    this.lastMonotonicTimeUs = input.lastMonotonicTimeUs ?? 0;
    this.authoritativeFlags = input.authoritativeFlags ?? 0;
    this.nextActionSequence = input.nextActionSequence ?? 1;
    this.extractionRevision = input.extractionRevision ?? 8;
    this.lastApplied = input.lastApplied ?? null;
  }

  identity() { return this.current; }

  async step(monotonicTimeUs: number, budgetUs: number, inputs: readonly RustIntegratedRuntimeInputFrameV1[]) {
    this.enter("step");
    try {
      if (this.delayStep) await this.delayStep();
      if (this.throwStep) throw this.throwStep;
      assert.equal(budgetUs, RUST_LIVE_INPUT_STEP_BUDGET_US_R5);
      assert.ok(inputs.length <= 1);
      if (inputs.length === 1) {
        assert.equal(this.pending, null, "pump must never add a second native queued input");
        this.pending = inputs[0];
        this.submitted.push(inputs[0]);
      }
      this.stepArguments.push(Object.freeze({ monotonicTimeUs, budgetUs, inputs: Object.freeze([...inputs]) }));
      const delta = this.lastMonotonicTimeUs === 0 ? 0 : Math.max(0, Math.min(250_000, monotonicTimeUs - this.lastMonotonicTimeUs));
      this.lastMonotonicTimeUs = monotonicTimeUs;
      this.accumulatorUs += delta;
      const fixedSteps = Math.min(8, Math.floor(this.accumulatorUs / 50_000));
      this.accumulatorUs -= fixedSteps * 50_000;
      let inputsApplied = 0;
      const actionReceipts: RustIntegratedRuntimeInputActionReceiptV1[] = [];
      for (let index = 0; index < fixedSteps; index += 1) {
        const tick = this.current.tick + index + 1;
        if (this.pending && this.pending.targetTick <= tick) {
          const previousButtons = this.lastApplied?.buttons ?? 0;
          for (const [bit, kind] of ACTIONS) {
            if ((this.pending.buttons & ~previousButtons & bit) === 0) continue;
            let outcome: RustIntegratedRuntimeInputActionReceiptV1["outcome"] = "no-target";
            if (kind === "creative-flight-toggle") {
              if ((this.authoritativeFlags & RUST_RUNTIME_INPUT_FLAG_V1.creative) !== 0
                && (this.authoritativeFlags & RUST_RUNTIME_INPUT_FLAG_V1.mounted) === 0) {
                outcome = "applied";
                this.authoritativeFlags ^= RUST_RUNTIME_INPUT_FLAG_V1.flying;
              } else outcome = "ineligible";
            } else if (kind === "mount-toggle") {
              outcome = "applied";
              this.authoritativeFlags ^= RUST_RUNTIME_INPUT_FLAG_V1.mounted;
              if ((this.authoritativeFlags & RUST_RUNTIME_INPUT_FLAG_V1.mounted) !== 0) {
                this.authoritativeFlags &= ~RUST_RUNTIME_INPUT_FLAG_V1.flying;
              }
            }
            actionReceipts.push(Object.freeze({
              sequence: this.nextActionSequence++, inputSequence: this.pending.sequence, tick, kind, outcome,
              selectedSlot: this.pending.selectedSlot, authoritativeFlags: this.authoritativeFlags,
              targetEntityId: BigInt(0), effectHash: hash(this.nextActionSequence + tick),
            }));
          }
          this.lastApplied = this.pending;
          this.pending = null;
          inputsApplied = 1;
        }
        this.position += (this.lastApplied?.moveZ ?? 0) / 32_767;
      }
      if (fixedSteps > 0) this.extractionRevision += fixedSteps * 2;
      this.current = identity(
        this.current.tick + fixedSteps,
        this.current.revision.simulation + fixedSteps,
        this.current.tick + fixedSteps + this.submitted.length + 10,
      );
      return Object.freeze({
        type: "runtime-step-result-v1" as const,
        requestId: this.stepArguments.length,
        clientEpoch: 1,
        workerEpoch: 1,
        identity: this.current,
        fixedSteps,
        inputsApplied: this.invalidInputsApplied ?? inputsApplied,
        commandsProcessed: 0,
        commandsAccepted: 0,
        actionReceipts: Object.freeze(actionReceipts),
        replayHash: hash(this.current.tick + 100),
      });
    } finally {
      this.leave();
    }
  }

  async extract(afterRevision: number): Promise<RustIntegratedRuntimeExtractionV1> {
    this.enter("extract");
    try {
      if (this.delayExtract) await this.delayExtract();
      if (this.throwExtract) throw this.throwExtract;
      const changed = this.extractionRevision > afterRevision;
      return Object.freeze({
        identity: this.current,
        extractionRevision: this.extractionRevision,
        render: changed ? Uint8Array.of(1) : new Uint8Array(),
        hud: new Uint8Array(), audio: new Uint8Array(), platformRequests: new Uint8Array(), diagnostics: new Uint8Array(),
        extractionHash: hash(this.extractionRevision + 200),
      });
    } finally {
      this.leave();
    }
  }

  private enter(kind: string) {
    this.calls.push(kind);
    this.concurrent += 1;
    this.maximumConcurrent = Math.max(this.maximumConcurrent, this.concurrent);
  }
  private leave() { this.concurrent -= 1; }
}

function pump(runtime: FakeRuntime, value = continuity(), nowUs: () => number = () => 1) {
  return new RustLiveInputPumpR5({
    service: runtime,
    status: status(value, runtime.identity().tick),
    worldGeneration: GENERATION,
    nowUs,
  });
}

test("axis and camera quantization match Rust's signed i16 divisor", () => {
  assert.equal(quantizeRustLiveInputAxisR5(1), 32_767);
  assert.equal(quantizeRustLiveInputAxisR5(-1), -32_767);
  assert.equal(quantizeRustLiveInputAxisR5(2), 32_767);
  assert.equal(quantizeRustLiveInputAxisR5(0.5), 16_384);
  assert.equal(quantizeRustLiveInputYawR5(Math.PI), -32_767);
  assert.equal(quantizeRustLiveInputYawR5(-Math.PI), -32_767);
  assert.equal(quantizeRustLiveInputYawR5(Math.PI / 2), 16_384);
  assert.equal(quantizeRustLiveInputPitchR5(Math.PI), 32_767);
  assert.equal(quantizeRustLiveInputPitchR5(-Math.PI), -32_767);
  assert.throws(() => quantizeRustLiveInputAxisR5(Number.NaN), /not finite/u);
});

test("30, 60, and 120 Hz browser sampling produce equal fixed-step held motion", async () => {
  const run = async (rate: number) => {
    let now = 0;
    const runtime = new FakeRuntime();
    const live = pump(runtime, continuity(), () => now);
    for (let index = 0; index <= rate; index += 1) {
      now = Math.round(index * 1_000_000 / rate);
      live.sample(GENERATION, intent({ moveX: 0.25, moveZ: 1, yawRadians: Math.PI / 4 }));
      await live.advance(GENERATION);
    }
    await live.stop();
    return Object.freeze({ tick: runtime.identity().tick, position: runtime.position, buttons: runtime.lastApplied?.buttons, moveX: runtime.lastApplied?.moveX });
  };
  const results = await Promise.all([run(30), run(60), run(120)]);
  assert.deepEqual(results, [results[0], results[0], results[0]]);
  assert.equal(results[0].tick, 19);
  assert.equal(results[0].position, 19);
  assert.equal(results[0].moveX, quantizeRustLiveInputAxisR5(0.25));
});

test("rapid press-release-repress is preserved as acknowledged 1,0,1 frames", async () => {
  let now = 1;
  const runtime = new FakeRuntime();
  const live = pump(runtime, continuity(), () => now);
  const base = intent();
  live.sample(GENERATION, withAction(base, "primaryAttack", true));
  assert.equal((await live.advance(GENERATION)).step?.inputsApplied, 0, "fresh monotonic clock must prime without rejecting input");
  live.sample(GENERATION, withAction(base, "primaryAttack", false));
  live.sample(GENERATION, withAction(base, "primaryAttack", true));
  now = 50_001;
  assert.equal((await live.advance(GENERATION)).step?.inputsApplied, 1);
  now = 100_001;
  assert.equal((await live.advance(GENERATION)).step?.inputsApplied, 1);
  now = 150_001;
  assert.equal((await live.advance(GENERATION)).step?.inputsApplied, 1);
  assert.deepEqual(runtime.stepArguments.slice(0, 2).map((entry) => entry.inputs.length), [1, 0], "pending native input must be stepped with an empty batch");
  assert.deepEqual(runtime.submitted.slice(0, 3).map((frame) => Boolean(frame.buttons & RUST_RUNTIME_INPUT_BUTTON_V1.primaryAttack)), [true, false, true]);
  assert.equal(live.diagnostics().latchedActionTransitions, 0);
  assert.equal(live.diagnostics().nextActionSequence, 3, "only two rising edges emit receipts");
  await live.stop();
});

test("held controls coalesce while an action edge remains native-pending", async () => {
  let now = 1;
  const runtime = new FakeRuntime();
  const live = pump(runtime, continuity(), () => now);
  live.sample(GENERATION, withAction(intent({ moveZ: 0.25 }), "interact", true));
  await live.advance(GENERATION);
  live.sample(GENERATION, withAction(intent({ moveZ: -1, selectedSlot: 6 }), "interact", true));
  now = 50_001;
  await live.advance(GENERATION);
  now = 50_002;
  await live.advance(GENERATION);
  assert.equal(runtime.submitted[0].moveZ, quantizeRustLiveInputAxisR5(0.25));
  assert.equal(runtime.submitted[1].moveZ, -32_767);
  assert.equal(runtime.submitted[1].selectedSlot, 6);
  assert.equal(runtime.submitted.filter((frame) => frame.buttons & RUST_RUNTIME_INPUT_BUTTON_V1.interact).length, 2);
  assert.equal(live.diagnostics().nextActionSequence, 2, "held action must not rearm without a release");
  await live.stop();
});

test("generation mismatches reject before I/O and stopped awaits discard stale continuations", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const runtime = new FakeRuntime();
  runtime.delayStep = () => blocked;
  const live = pump(runtime);
  assert.throws(() => live.sample(GENERATION - 1, intent()), /stale live input world generation/u);
  assert.throws(() => live.advance(GENERATION + 1), /future live input world generation/u);
  const advancing = live.advance(GENERATION, { initialSync: true });
  await Promise.resolve();
  const stopping = live.stop();
  release();
  assert.deepEqual(await advancing, { discarded: true, step: null, extraction: null });
  await stopping;
  assert.equal(runtime.calls.includes("extract"), false);
  assert.equal(live.diagnostics().discardedContinuations, 1);
});

test("rejections from stale step and extraction awaits are discarded during stop", async () => {
  let rejectStep!: (error: Error) => void;
  const blockedStep = new Promise<void>((_resolve, reject) => { rejectStep = reject; });
  const stepRuntime = new FakeRuntime();
  stepRuntime.delayStep = () => blockedStep;
  const stepPump = pump(stepRuntime);
  const advancingStep = stepPump.advance(GENERATION);
  await Promise.resolve();
  const stoppingStep = stepPump.stop();
  rejectStep(new Error("obsolete step rejection"));
  assert.deepEqual(await advancingStep, { discarded: true, step: null, extraction: null });
  await stoppingStep;
  assert.equal(stepPump.state, "stopped");

  let rejectExtraction!: (error: Error) => void;
  const blockedExtraction = new Promise<void>((_resolve, reject) => { rejectExtraction = reject; });
  const extractionRuntime = new FakeRuntime({ lastMonotonicTimeUs: 1 });
  extractionRuntime.delayExtract = () => blockedExtraction;
  const extractionPump = pump(
    extractionRuntime,
    continuity({ lastMonotonicTimeUs: BigInt(1) }),
    () => 50_001,
  );
  const advancingExtraction = extractionPump.advance(GENERATION);
  while (!extractionRuntime.calls.includes("extract")) await Promise.resolve();
  const stoppingExtraction = extractionPump.stop();
  rejectExtraction(new Error("obsolete extraction rejection"));
  assert.deepEqual(await advancingExtraction, { discarded: true, step: null, extraction: null });
  await stoppingExtraction;
  assert.equal(extractionPump.state, "stopped");
});

test("step failures and invalid applied counts are terminal with no fallback", async () => {
  const failedRuntime = new FakeRuntime();
  failedRuntime.throwStep = new Error("native step rejected");
  const failed = pump(failedRuntime);
  await assert.rejects(failed.advance(GENERATION), /native step rejected/u);
  await failed.drain();
  assert.equal(failed.state, "failed");
  assert.throws(() => failed.sample(GENERATION, intent()), /is failed/u);
  assert.deepEqual(failedRuntime.calls, ["step"]);

  const invalidRuntime = new FakeRuntime();
  invalidRuntime.invalidInputsApplied = 2;
  const invalid = pump(invalidRuntime);
  await assert.rejects(invalid.advance(GENERATION), /applied-input count/u);
  await invalid.drain();
  assert.equal(invalid.state, "failed");
  assert.equal(invalidRuntime.calls.includes("extract"), false);
});

test("restored sequence, clock, selected slot, and flags seed the next exact frame", async () => {
  const restoredFrame = Object.freeze({
    sequence: BigInt(41), targetTick: BigInt(70), moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0,
    buttons: RUST_RUNTIME_INPUT_BUTTON_V1.primaryAttack, selectedSlot: 4, flags: RUST_RUNTIME_INPUT_FLAG_V1.creative,
  });
  const value = continuity({
    lastMonotonicTimeUs: BigInt(9_000),
    lastInputSequence: BigInt(41), nextInputSequence: BigInt(42),
    lastActionSequence: BigInt(9), nextActionSequence: BigInt(10),
    authoritativeFlags: RUST_RUNTIME_INPUT_FLAG_V1.creative,
    lastAppliedInput: restoredFrame,
  });
  const runtime = new FakeRuntime({
    tick: 70, lastMonotonicTimeUs: 9_000, authoritativeFlags: RUST_RUNTIME_INPUT_FLAG_V1.creative,
    nextActionSequence: 10,
    lastApplied: Object.freeze({ ...restoredFrame, sequence: 41, targetTick: 70 }),
  });
  const live = pump(runtime, value, () => 9_000);
  live.sample(GENERATION, intent({ selectedSlot: 4, actions: Object.freeze({ ...intent().actions, primaryAttack: true }) }));
  await live.advance(GENERATION);
  const frame = runtime.submitted[0];
  assert.equal(runtime.stepArguments[0].monotonicTimeUs, 9_001);
  assert.equal(frame.sequence, 42);
  assert.equal(frame.targetTick, 71);
  assert.equal(frame.selectedSlot, 4);
  assert.equal(frame.flags, RUST_RUNTIME_INPUT_FLAG_V1.creative);
  assert.equal(live.diagnostics().nextActionSequence, 10, "restored held edge does not emit a second action");
  await live.stop();
});

test("authoritative action flags feed later frames and step/extract remain serialized", async () => {
  let now = 50_000;
  const initialFlags = RUST_RUNTIME_INPUT_FLAG_V1.creative;
  const runtime = new FakeRuntime({ lastMonotonicTimeUs: 1, authoritativeFlags: initialFlags });
  runtime.delayStep = async () => { await Promise.resolve(); };
  runtime.delayExtract = async () => { await Promise.resolve(); };
  const live = pump(runtime, continuity({ lastMonotonicTimeUs: BigInt(1), authoritativeFlags: initialFlags }), () => now);
  live.sample(GENERATION, withAction(intent(), "creativeFlightToggle", true));
  const first = live.advance(GENERATION);
  now = 100_000;
  const second = live.advance(GENERATION);
  const [firstResult] = await Promise.all([first, second]);
  assert.equal(firstResult.extraction !== null, true);
  assert.deepEqual(runtime.calls.slice(0, 4), ["step", "extract", "step", "extract"]);
  assert.equal(runtime.maximumConcurrent, 1);
  assert.equal(live.diagnostics().authoritativeFlags, initialFlags | RUST_RUNTIME_INPUT_FLAG_V1.flying);
  assert.equal(runtime.submitted[1].flags, initialFlags | RUST_RUNTIME_INPUT_FLAG_V1.flying);
  await live.stop();
});
