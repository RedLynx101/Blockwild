import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  compareCanonicalUtf8R10,
  decodeRustDomainBundleR10,
  type RustDomainValueR10,
  type RustDomainValueTypeR10,
} from "../app/game/rust-authoritative-extraction-r10.ts";
import { encodeRustEntityExtractionR6V3 } from "../app/game/rust-entity-authority-codec-r6.ts";
import type {
  RustEntityExtractionR6V3,
  RustEntityExtractionRecordR6V3,
} from "../app/game/rust-entity-authority-contract-r6.ts";
import {
  RUST_RUNTIME_INPUT_BUTTON_V1,
  RUST_RUNTIME_INPUT_FLAG_V1,
  type RustIntegratedRuntimeExtractionV1,
  type RustIntegratedRuntimeIdentityV1,
  type RustIntegratedRuntimeInputActionKindV1,
  type RustIntegratedRuntimeInputActionReceiptV1,
  type RustIntegratedRuntimeInputFrameV1,
  type RustIntegratedRuntimeContextCommandV2,
  type RustIntegratedRuntimeSemanticActionResolutionV2,
} from "../app/game/rust-integrated-runtime-contract.ts";
import { sealRustIntegratedRuntimeSemanticActionReceiptV2 } from "../app/game/rust-integrated-runtime-codec.ts";
import type { RustIntegratedPlayerRuntimeContinuityV1 } from "../app/game/rust-integrated-runtime-player-status.ts";
import {
  planRustLivePlayerRespawnV1,
  type RustIntegratedPlayerRespawnV1,
  type RustLivePlayerRespawnPlanV1,
} from "../app/game/rust-integrated-runtime-player-respawn.ts";
import {
  RUST_LIVE_INPUT_STEP_BUDGET_US_R5,
  RustLiveInputPumpErrorR5,
  RustLiveInputPumpR5,
  quantizeRustLiveInputAxisR5,
  quantizeRustLiveInputPitchR5,
  quantizeRustLiveInputYawR5,
  type RustLiveInputIntentR5,
  type RustLiveInputPumpServiceR5,
} from "../app/game/rust-live-input-pump-r5.ts";
import type { RustLivePlayerDeathRespawnR10, RustLivePlayerViewR10 } from "../app/game/rust-live-player-view-r10.ts";
import { TypeScriptCanonicalHasher } from "../app/game/rust-kernel-shadow.ts";

const GENERATION = 5;
const PLAYER_VIEW_BWX0 = Uint8Array.from(Buffer.from(readFileSync(
  new URL("./fixtures/rust-engine/r10-authoritative-extraction/bound-world-view-bwx0-v1.hex", import.meta.url),
  "utf8",
).trim(), "hex"));
const ZERO_HASH_BYTES = new Uint8Array(16);
const textEncoder = new TextEncoder();
const ACTIONS = Object.freeze([
  [RUST_RUNTIME_INPUT_BUTTON_V1.primaryAttack, "primary-attack"],
  [RUST_RUNTIME_INPUT_BUTTON_V1.secondaryUse, "secondary-use"],
  [RUST_RUNTIME_INPUT_BUTTON_V1.interact, "interact"],
  [RUST_RUNTIME_INPUT_BUTTON_V1.mountToggle, "mount-toggle"],
  [RUST_RUNTIME_INPUT_BUTTON_V1.creativeFlightToggle, "creative-flight-toggle"],
  [RUST_RUNTIME_INPUT_BUTTON_V1.drop, "drop"],
] as const satisfies readonly (readonly [number, RustIntegratedRuntimeInputActionKindV1])[]);

function hash(value: number) { return value.toString(16).padStart(32, "0").slice(-32); }

class RespawnFixtureWriter {
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
    const bytes = textEncoder.encode(value);
    return this.u32(bytes.byteLength).raw(bytes);
  }
  finish() { return Uint8Array.from(this.bytes); }
}

type RespawnFixtureRow = Readonly<{
  kind: number;
  key: string;
  fields: Map<string, RustDomainValueR10>;
  types: Map<string, RustDomainValueTypeR10>;
}>;

function respawnFixtureValue(value: RustDomainValueR10, type: RustDomainValueTypeR10) {
  const writer = new RespawnFixtureWriter();
  if (type === "bool") return writer.u8(0).u8(value === true ? 1 : 0).finish();
  if (type === "u64") return writer.u8(1).u64(value as bigint).finish();
  if (type === "i64") return writer.u8(2).u64(BigInt.asUintN(64, value as bigint)).finish();
  if (type === "f64") return writer.u8(3).f64(value as number).finish();
  if (type === "string") return writer.u8(4).string(value as string).finish();
  if (type === "hash") return writer.u8(5).raw(value as Uint8Array).finish();
  const bytes = value as Uint8Array;
  return writer.u8(6).u32(bytes.byteLength).raw(bytes).finish();
}

function respawnFixtureRow(row: RespawnFixtureRow) {
  const encoded = [...row.fields]
    .sort(([left], [right]) => compareCanonicalUtf8R10(left, right))
    .map(([name, value]) => {
      const type = row.types.get(name);
      assert.notEqual(type, undefined, `respawn fixture field '${name}' must retain its wire type`);
      return [name, respawnFixtureValue(value, type!)] as const;
    });
  const revisionHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-row-revision.v1")
    .writeU16(row.kind).writeString(row.key).writeU16(encoded.length);
  for (const [name, value] of encoded) revisionHash.writeString(name).writeBytes(value);
  const bytes = revisionHash.finish();
  const revision = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
  const writer = new RespawnFixtureWriter().u16(row.kind).string(row.key).u64(revision).u16(encoded.length);
  for (const [name, value] of encoded) writer.string(name).raw(value);
  return writer.finish();
}

function setRespawnFixtureField(
  row: RespawnFixtureRow,
  name: string,
  type: RustDomainValueTypeR10,
  value: RustDomainValueR10,
) {
  row.fields.set(name, value);
  row.types.set(name, type);
}

function bytesFromHash(value: string) {
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function emptyAudioExtraction(authorityTick: number) {
  const bytes = new Uint8Array(4 + 2 + 8 + 4 + 4 + 4);
  bytes.set(textEncoder.encode("BWAU"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 2, true);
  view.setBigUint64(6, BigInt(authorityTick), true);
  return bytes;
}

function freshDeadRespawnExtraction(
  current: RustIntegratedRuntimeIdentityV1,
  extractionRevision: number,
  cursors: Readonly<{
    entityRevision: bigint;
    gameplaySequence: bigint;
    gameplayCombatRevision: bigint;
    combatantRevision: bigint;
  }>,
): RustIntegratedRuntimeExtractionV1 {
  const decoded = decodeRustDomainBundleR10(PLAYER_VIEW_BWX0);
  const rowsByDomain: RespawnFixtureRow[][] = decoded.views.map((domain) => domain.rows.map((row) => ({
    kind: row.kind,
    key: row.key,
    fields: new Map(row.fields.map(([name, value]) => [
      name,
      value instanceof Uint8Array ? Uint8Array.from(value) : value,
    ])),
    types: new Map(row.fields.map(([name], index) => [name, row.fieldTypes![index]!])),
  })));
  const playerRows = rowsByDomain[decoded.views.findIndex((view) => view.domain === 2)]!;
  const combatRows = rowsByDomain[decoded.views.findIndex((view) => view.domain === 5)]!;
  const runtime = playerRows.find((row) => row.kind === 1 && row.key === "player:extraction")!;
  const binding = playerRows.find((row) => row.kind === 2)!;
  const combat = combatRows.find((row) => row.kind === 1 && row.key === "combatant:player:extraction")!;
  setRespawnFixtureField(runtime, "gameplaySequence", "u64", cursors.gameplaySequence);
  setRespawnFixtureField(runtime, "gameplayCombatRevision", "u64", cursors.gameplayCombatRevision);
  setRespawnFixtureField(runtime, "deathSequence.present", "bool", true);
  setRespawnFixtureField(runtime, "deathSequence.value", "u64", BigInt(1));
  setRespawnFixtureField(runtime, "lastRespawnSequence.present", "bool", false);
  runtime.fields.delete("lastRespawnSequence.value");
  runtime.types.delete("lastRespawnSequence.value");
  setRespawnFixtureField(runtime, "queuedInputsEmpty", "bool", true);
  setRespawnFixtureField(runtime, "pendingContextCommandsEmpty", "bool", true);
  setRespawnFixtureField(runtime, "pendingMovementResultEmpty", "bool", true);
  setRespawnFixtureField(runtime, "miningStateEmpty", "bool", true);
  setRespawnFixtureField(runtime, "latestDeathRespawn.present", "bool", false);
  setRespawnFixtureField(runtime, "lastInputSequence", "u64", BigInt(2));
  setRespawnFixtureField(runtime, "buttons", "u64", BigInt(0));
  setRespawnFixtureField(runtime, "crouching", "bool", false);
  setRespawnFixtureField(binding, "entityRevision", "u64", cursors.entityRevision);
  setRespawnFixtureField(combat, "combatantRevision", "u64", cursors.combatantRevision);
  setRespawnFixtureField(combat, "health", "u64", BigInt(0));
  setRespawnFixtureField(combat, "alive", "bool", false);

  const hud = new RespawnFixtureWriter().raw(textEncoder.encode("BWX0")).u16(1)
    .u64(extractionRevision).u64(current.tick).raw(bytesFromHash(current.stateHash))
    .raw(decoded.contentManifestHash).u8(decoded.contentReady ? 1 : 0).u16(decoded.views.length);
  decoded.views.forEach((domain, index) => {
    const payloadWriter = new RespawnFixtureWriter();
    for (const row of rowsByDomain[index]!) payloadWriter.raw(respawnFixtureRow(row));
    const payload = payloadWriter.finish();
    const payloadHash = new TypeScriptCanonicalHasher("blockwild.r10.domain-view-payload.v1")
      .writeBytes(payload).finish();
    const statusCode = domain.status === "complete" ? 0 : domain.status === "partial" ? 1 : 2;
    hud.u8(domain.domain).u16(1).u8(statusCode).u64(domain.revision)
      .u32(domain.total).u32(domain.selected).u32(domain.omitted).u32(domain.nextCursor)
      .u16(domain.blockers.length);
    for (const blocker of domain.blockers) hud.string(blocker);
    hud.u32(payload.byteLength).raw(payloadHash).raw(payload);
  });

  const playerRecord: RustEntityExtractionRecordR6V3 = Object.freeze({
    entityId: BigInt("4294967297"), residency: "hot", class: "player", simulationTier: "hero",
    protection: BigInt(0), entityRevision: cursors.entityRevision, externalEntityId: "player:extraction",
    specimenId: "player:extraction", kindKey: "player", variantKey: null,
    name: "Extraction Player", modelKey: "player-standing", modelRevision: 0, modelHash: ZERO_HASH_BYTES,
    position: Object.freeze({ x: 8, y: 64, z: 8 }), yaw: 0,
    velocity: Object.freeze({ x: 0, y: 0, z: 0 }), health: 0, maximumHealth: 20,
    tamed: false, ageTicks: BigInt(current.tick), movementMode: "ground", grounded: true, submerged: false,
    lastDamageTick: BigInt(current.tick),
    action: Object.freeze({ key: "idle", phase: 0, startedTick: BigInt(0), endsTick: BigInt(0), target: null }),
    equipment: Object.freeze([]),
    mount: Object.freeze({ parentMount: null, occupiedSeat: null, acceptsRiders: false, saddleKey: null, seats: Object.freeze([]) }),
    research: Object.freeze([]),
  });
  const entities: RustEntityExtractionR6V3 = Object.freeze({
    schema: 3,
    extractionRevision: BigInt(extractionRevision),
    authorityTick: BigInt(current.tick),
    contentManifestHash: ZERO_HASH_BYTES,
    contentReady: false,
    total: 1,
    selected: 1,
    omitted: 0,
    records: Object.freeze([playerRecord]),
  });
  return Object.freeze({
    identity: current,
    extractionRevision,
    render: encodeRustEntityExtractionR6V3(entities),
    hud: hud.finish(),
    audio: emptyAudioExtraction(current.tick),
    platformRequests: new Uint8Array(),
    diagnostics: new Uint8Array(),
    extractionHash: hash(extractionRevision + 500),
  });
}

function identity(tick = 0, simulation = 0, state = 1, network = 1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "universe-input-pump-test",
    locationId: "location-input-pump-test",
    revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network, simulation }),
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
  readonly contextArguments: Array<readonly RustIntegratedRuntimeContextCommandV2[]> = [];
  pendingContextCommands: readonly RustIntegratedRuntimeContextCommandV2[] = Object.freeze([]);
  omitSemanticReceipt = false;
  rejectSemanticReceipt = false;
  readonly calls: string[] = [];
  readonly stepArguments: Array<Readonly<{ monotonicTimeUs: number; budgetUs: number; inputs: readonly RustIntegratedRuntimeInputFrameV1[] }>> = [];
  concurrent = 0;
  maximumConcurrent = 0;
  throwStep: Error | null = null;
  throwExtract: Error | null = null;
  invalidInputsApplied: number | null = null;
  delayStep: (() => Promise<void>) | null = null;
  delayExtract: (() => Promise<void>) | null = null;
  extractionFactory: ((afterRevision: number) => RustIntegratedRuntimeExtractionV1) | null = null;

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
        this.current.revision.network,
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

  async stepV2(
    monotonicTimeUs: number,
    budgetUs: number,
    inputs: readonly RustIntegratedRuntimeInputFrameV1[],
    contextCommands: readonly RustIntegratedRuntimeContextCommandV2[],
  ) {
    this.calls.push("step-v2");
    if (contextCommands.length > 0) {
      assert.equal(this.pendingContextCommands.length, 0, "pump must submit each context command only once");
      this.pendingContextCommands = Object.freeze([...contextCommands]);
    }
    this.contextArguments.push(Object.freeze([...contextCommands]));
    const base = await this.step(monotonicTimeUs, budgetUs, inputs);
    const due = this.pendingContextCommands.filter((command) => command.targetTick <= base.identity.tick);
    const semanticReceipts = due.map((command) => {
      let resolution: RustIntegratedRuntimeSemanticActionResolutionV2;
      switch (command.action.kind) {
        case "cast": resolution = Object.freeze({
          kind: "cast", loadoutRevision: command.action.loadoutRevision, learnedRevision: command.action.learnedRevision,
        }); break;
        case "reload": resolution = Object.freeze({
          kind: "reload", containerRevision: command.action.containerRevision,
        }); break;
        case "mounted-ability": resolution = Object.freeze({
          kind: "mounted-ability", mountEntityRevision: command.action.mountEntityRevision,
        }); break;
      }
      return sealRustIntegratedRuntimeSemanticActionReceiptV2({
        commandSequence: command.sequence,
        targetTick: command.targetTick,
        appliedTick: command.targetTick,
        commandHash: command.commandHash,
        outcome: this.rejectSemanticReceipt ? "rejected" : "applied",
        reason: this.rejectSemanticReceipt ? "ineligible" : "applied",
        resolvedEntity: command.action.kind === "mounted-ability"
          ? Object.freeze({ entityId: command.action.mountEntityId, entityRevision: command.action.mountEntityRevision })
          : null,
        resolvedBlock: null,
        session: null,
        effect: null,
        resolution,
      }, base.identity, base.replayHash);
    });
    if (due.length > 0) this.pendingContextCommands = Object.freeze([]);
    if (this.omitSemanticReceipt && semanticReceipts.length > 0) semanticReceipts.pop();
    return Object.freeze({
      ...base,
      type: "runtime-step-result-v2" as const,
      semanticReceipts: Object.freeze(semanticReceipts),
    });
  }

  async extract(afterRevision: number): Promise<RustIntegratedRuntimeExtractionV1> {
    this.enter("extract");
    try {
      if (this.delayExtract) await this.delayExtract();
      if (this.throwExtract) throw this.throwExtract;
      if (this.extractionFactory) return this.extractionFactory(afterRevision);
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

function pump(
  runtime: FakeRuntime,
  value = continuity(),
  nowUs: () => number = () => 1,
  nextContextCommandSequence?: number | null,
) {
  return new RustLiveInputPumpR5({
    service: runtime,
    status: status(value, runtime.identity().tick),
    worldGeneration: GENERATION,
    nowUs,
    ...(nextContextCommandSequence === undefined ? {} : { nextContextCommandSequence }),
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

test("diagnostics retain the last validated native action receipt across no-action inputs", async () => {
  let now = 1;
  const runtime = new FakeRuntime();
  const live = pump(runtime, continuity(), () => now);
  live.sample(GENERATION, withAction(intent({ selectedSlot: 4 }), "secondaryUse", true));
  assert.equal((await live.advance(GENERATION)).step?.inputsApplied, 0);
  now = 50_001;
  assert.equal((await live.advance(GENERATION)).step?.inputsApplied, 1);

  const receipt = live.diagnostics().lastActionReceipt;
  assert.deepEqual(receipt, {
    sequence: 1,
    inputSequence: 1,
    tick: 1,
    kind: "secondary-use",
    outcome: "no-target",
    selectedSlot: 4,
    authoritativeFlags: 0,
    targetEntityId: BigInt(0),
    effectHash: hash(3),
  });
  assert.equal(Object.isFrozen(receipt), true);

  live.sample(GENERATION, withAction(intent({ selectedSlot: 4 }), "secondaryUse", false));
  now = 100_001;
  assert.equal((await live.advance(GENERATION)).step?.inputsApplied, 1);
  assert.equal(live.diagnostics().lastActionReceipt, receipt,
    "an acknowledged no-action input must not erase the last semantic outcome");
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

test("an exact external network successor preserves a pending native input and contiguous authority", async () => {
  let now = 1;
  const runtime = new FakeRuntime();
  const live = pump(runtime, continuity(), () => now);
  live.sample(GENERATION, intent({ moveX: 1, moveZ: 0 }));
  const pending = await live.advance(GENERATION);
  assert.equal(pending.step?.fixedSteps, 0);
  assert.equal(live.diagnostics().nativeInputPending, true);

  runtime.current = identity(0, 0, 22, 4);
  assert.equal(await live.adoptExternalNetworkSuccessor(GENERATION), true);
  assert.equal(await live.adoptExternalNetworkSuccessor(GENERATION), false,
    "an unchanged integrated identity must remain idempotent");
  assert.equal(live.diagnostics().lastNetworkRevision, 4);
  assert.equal(live.diagnostics().networkIdentityAdoptions, 1);

  now = 100_001;
  const moved = await live.advance(GENERATION);
  assert.equal(moved.step?.inputsApplied, 1);
  assert.equal(runtime.submitted.length, 1, "network adoption must not resubmit the pending input");
  assert.equal(live.diagnostics().nextInputSequence, 2);
  assert.equal(live.diagnostics().lastAuthorityTick, 2);
  assert.equal(live.diagnostics().lastAppliedMoveX, 32_767);
  assert.equal(live.diagnostics().lastAppliedMoveZ, 0);
  live.sample(GENERATION, intent({ moveX: 0, moveZ: 0 }));
  now = 150_001;
  await live.advance(GENERATION);
  assert.equal(live.diagnostics().lastAppliedMoveX, 0);
  assert.equal(live.diagnostics().lastAppliedMoveZ, 0,
    "diagnostics must distinguish the exact applied movement frame from its release frame");
  assert.equal(live.state, "ready");
  await live.stop();
});

test("external network adoption rejects every non-network drift, regression, and hash contradiction", async () => {
  const cases: ReadonlyArray<readonly [string, (
    before: RustIntegratedRuntimeIdentityV1,
  ) => RustIntegratedRuntimeIdentityV1]> = [
    ["universe", (before) => Object.freeze({ ...before, universeId: "other-universe", stateHash: hash(2) })],
    ["location", (before) => Object.freeze({ ...before, locationId: "other-location", stateHash: hash(2) })],
    ["tick", (before) => Object.freeze({ ...before, tick: 1, stateHash: hash(2) })],
    ...(["epoch", "world", "entities", "gameplay", "persistence", "simulation"] as const).map((axis) => [
      axis,
      (before: RustIntegratedRuntimeIdentityV1) => Object.freeze({
        ...before,
        revision: Object.freeze({ ...before.revision, [axis]: before.revision[axis] + 1, network: 3 }),
        stateHash: hash(2),
      }),
    ] as const),
    ["network regression", (before) => Object.freeze({
      ...before,
      revision: Object.freeze({ ...before.revision, network: 1 }),
      stateHash: hash(2),
    })],
    ["same network with changed hash", (before) => Object.freeze({ ...before, stateHash: hash(2) })],
    ["advanced network with unchanged hash", (before) => Object.freeze({
      ...before,
      revision: Object.freeze({ ...before.revision, network: 3 }),
    })],
  ];

  for (const [label, mutate] of cases) {
    const runtime = new FakeRuntime();
    runtime.current = identity(0, 0, 1, 2);
    const live = pump(runtime);
    runtime.current = mutate(runtime.current);
    await assert.rejects(live.adoptExternalNetworkSuccessor(GENERATION), /non-network axis/u, label);
    await live.drain();
    assert.equal(live.state, "failed", label);
  }
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
    sequence: BigInt(41), targetTick: BigInt(70), moveX: 123, moveZ: -456, lookYaw: 0, lookPitch: 0,
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
  assert.equal(live.diagnostics().lastAppliedMoveX, 123);
  assert.equal(live.diagnostics().lastAppliedMoveZ, -456);
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

test("default epoch clock clears a restored page-relative lead and applies pending input after a realistic increment", async (t) => {
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
  const timeOriginMilliseconds = 1_700_000_000_000;
  let elapsedMilliseconds = 1;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: Object.freeze({
      timeOrigin: timeOriginMilliseconds,
      now: () => elapsedMilliseconds,
    }) as Performance,
  });
  t.after(() => {
    if (originalPerformance) Object.defineProperty(globalThis, "performance", originalPerformance);
    else Reflect.deleteProperty(globalThis, "performance");
  });

  const restoredMonotonicTimeUs = timeOriginMilliseconds * 1_000;
  assert.ok(restoredMonotonicTimeUs > elapsedMilliseconds * 1_000,
    "fixture must reproduce a restored clock ahead of fresh page-relative performance.now");
  const runtime = new FakeRuntime({ lastMonotonicTimeUs: restoredMonotonicTimeUs });
  const live = new RustLiveInputPumpR5({
    service: runtime,
    status: status(continuity({ lastMonotonicTimeUs: BigInt(restoredMonotonicTimeUs) })),
    worldGeneration: GENERATION,
  });
  live.sample(GENERATION, intent());

  const first = await live.advance(GENERATION);
  assert.equal(first.step?.inputsApplied, 0);
  assert.equal(live.diagnostics().nativeInputPending, true);
  assert.equal(runtime.stepArguments[0].monotonicTimeUs, restoredMonotonicTimeUs + 1_000);

  elapsedMilliseconds += 50;
  const second = await live.advance(GENERATION);
  assert.equal(runtime.stepArguments[1].monotonicTimeUs, restoredMonotonicTimeUs + 51_000);
  assert.equal(second.step?.inputsApplied, 1,
    "one realistic 50 ms increment must advance a fixed step instead of crawling one microsecond per call");
  assert.equal(runtime.submitted.length, 1, "the pending input remains single-custody across both advances");
  assert.equal(live.diagnostics().nativeInputPending, false);
  assert.equal(live.diagnostics().appliedInputs, 1);
  await live.stop();
});

test("default epoch clock rejects unsafe Performance values and falls back to Date.now", async (t) => {
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
  const originalDateNow = Date.now;
  let dateMilliseconds = 1_700_000_100_000;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: Object.freeze({ timeOrigin: Number.POSITIVE_INFINITY, now: () => Number.NaN }) as Performance,
  });
  Date.now = () => dateMilliseconds;
  t.after(() => {
    Date.now = originalDateNow;
    if (originalPerformance) Object.defineProperty(globalThis, "performance", originalPerformance);
    else Reflect.deleteProperty(globalThis, "performance");
  });

  const restoredMonotonicTimeUs = dateMilliseconds * 1_000 - 1_000;
  const runtime = new FakeRuntime({ lastMonotonicTimeUs: restoredMonotonicTimeUs });
  const live = new RustLiveInputPumpR5({
    service: runtime,
    status: status(continuity({ lastMonotonicTimeUs: BigInt(restoredMonotonicTimeUs) })),
    worldGeneration: GENERATION,
  });
  live.sample(GENERATION, intent());
  assert.equal((await live.advance(GENERATION)).step?.inputsApplied, 0);
  assert.equal(runtime.stepArguments[0].monotonicTimeUs, dateMilliseconds * 1_000);
  dateMilliseconds += 50;
  assert.equal((await live.advance(GENERATION)).step?.inputsApplied, 1);
  await live.stop();
});

test("default epoch clock fails closed when Performance and Date.now are both unusable", async (t) => {
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
  const originalDateNow = Date.now;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: Object.freeze({
      timeOrigin: Number.MAX_SAFE_INTEGER,
      now: () => Number.MAX_SAFE_INTEGER,
    }) as Performance,
  });
  Date.now = () => Number.NaN;
  t.after(() => {
    Date.now = originalDateNow;
    if (originalPerformance) Object.defineProperty(globalThis, "performance", originalPerformance);
    else Reflect.deleteProperty(globalThis, "performance");
  });

  const runtime = new FakeRuntime({ lastMonotonicTimeUs: 9_000 });
  const live = new RustLiveInputPumpR5({
    service: runtime,
    status: status(continuity({ lastMonotonicTimeUs: BigInt(9_000) })),
    worldGeneration: GENERATION,
  });
  live.sample(GENERATION, intent());
  await assert.rejects(live.advance(GENERATION), (error: unknown) => {
    assert.ok(error instanceof RustLiveInputPumpErrorR5);
    assert.equal(error.code, "monotonic-clock-unavailable");
    assert.match(error.message, /cannot provide one exact safe microsecond timestamp/u);
    return true;
  });
  await live.drain();
  assert.equal(live.state, "failed");
  assert.equal(live.diagnostics().lastError,
    "browser epoch clocks cannot provide one exact safe microsecond timestamp");
  assert.equal(runtime.calls.length, 0, "invalid clocks must fail before any native fixed-step I/O");
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

test("context commands require explicit continuity and submit once until exact receipt", async () => {
  const unavailableRuntime = new FakeRuntime();
  const unavailable = pump(unavailableRuntime);
  assert.throws(
    () => unavailable.queueContextCommand(GENERATION, Object.freeze({
      kind: "cast", spellId: "spell:test", loadoutRevision: 1, learnedRevision: 2,
    })),
    /does not attest the next context command sequence/u,
  );
  assert.equal(unavailable.state, "ready", "missing optional continuity rejects queueing without corrupting V1 input");
  await unavailable.stop();

  let now = 1;
  const runtime = new FakeRuntime();
  const live = pump(runtime, continuity(), () => now, 7);
  live.queueContextCommand(GENERATION, Object.freeze({
    kind: "cast", spellId: "spell:test", loadoutRevision: 1, learnedRevision: 2,
  }));
  assert.equal((await live.advance(GENERATION)).step?.inputsApplied, 0);
  assert.equal(runtime.contextArguments[0].length, 1);
  assert.equal(runtime.contextArguments[0][0].sequence, 7);
  assert.equal(runtime.contextArguments[0][0].targetTick, 1);
  now = 50_001;
  const applied = await live.advance(GENERATION);
  assert.equal(applied.step?.type, "runtime-step-result-v2");
  assert.equal(applied.step?.type === "runtime-step-result-v2" ? applied.step.semanticReceipts.length : -1, 1);
  assert.equal(runtime.contextArguments[1].length, 0, "native-pending context commands must never be resubmitted");
  assert.equal(live.diagnostics().queuedContextCommands, 0);
  assert.equal(live.diagnostics().nextContextCommandSequence, 8);
  await live.stop();
});

test("BWO6 activation rejects queued custody or an identity mismatch before stepping", () => {
  const runtime = new FakeRuntime();
  const current = runtime.identity();
  const create = (identityValue = current, queuedCommandsEmpty = true) => new RustLiveInputPumpR5({
    service: runtime,
    status: status(continuity(), current.tick),
    worldGeneration: GENERATION,
    contextContinuity: Object.freeze({
      requestPayloadHash: hash(99),
      identity: identityValue,
      lastSequence: null,
      nextSequence: 1,
      queuedCommandsEmpty,
    }),
  });
  assert.throws(() => create(current, false), /exact idle runtime identity/u);
  assert.throws(
    () => create(Object.freeze({ ...current, stateHash: hash(100) })),
    /exact idle runtime identity/u,
  );
  assert.equal(runtime.stepArguments.length, 0);
});

test("terminal context sequence is accepted once and remains distinguishable from unavailable continuity", async () => {
  const exhausted = pump(new FakeRuntime(), continuity(), () => 1, null);
  assert.throws(
    () => exhausted.queueContextCommand(GENERATION, Object.freeze({
      kind: "cast", spellId: "spell:after-terminal", loadoutRevision: 1, learnedRevision: 1,
    })),
    /sequence is exhausted/u,
  );
  await exhausted.stop();

  let now = 1;
  const runtime = new FakeRuntime();
  const live = pump(runtime, continuity(), () => now, Number.MAX_SAFE_INTEGER);
  live.queueContextCommand(GENERATION, Object.freeze({
    kind: "mounted-ability",
    mountEntityId: BigInt("0xfedcba9876543210"),
    mountEntityRevision: 9,
    seatIndex: 1,
    abilitySlot: 2,
  }));
  await live.advance(GENERATION);
  now = 50_001;
  await live.advance(GENERATION);
  assert.deepEqual(runtime.contextArguments.map((commands) => commands.length), [1, 0]);
  assert.equal(live.diagnostics().nextContextCommandSequence, null);
  assert.throws(
    () => live.queueContextCommand(GENERATION, Object.freeze({
      kind: "cast", spellId: "spell:after-terminal", loadoutRevision: 1, learnedRevision: 1,
    })),
    /sequence is exhausted/u,
  );
  await live.stop();
});

test("rejected semantic receipts consume sequence and omissions fail closed", async () => {
  let now = 1;
  const rejectedRuntime = new FakeRuntime();
  rejectedRuntime.rejectSemanticReceipt = true;
  const rejected = pump(rejectedRuntime, continuity(), () => now, 11);
  rejected.queueContextCommand(GENERATION, Object.freeze({
    kind: "reload",
    container: Object.freeze({ kind: "equipment", id: "actor:test:equipment", ownerId: "actor:test" }),
    selectedSlot: 0,
    containerRevision: 4,
  }));
  await rejected.advance(GENERATION);
  now = 50_001;
  const result = await rejected.advance(GENERATION);
  assert.equal(result.step?.type === "runtime-step-result-v2" ? result.step.semanticReceipts[0].outcome : null, "rejected");
  assert.equal(rejected.diagnostics().queuedContextCommands, 0);
  assert.equal(rejected.diagnostics().nextContextCommandSequence, 12, "deterministic rejection consumes its sequence");
  await rejected.stop();

  now = 1;
  const omittedRuntime = new FakeRuntime();
  omittedRuntime.omitSemanticReceipt = true;
  const omitted = pump(omittedRuntime, continuity(), () => now, 21);
  omitted.queueContextCommand(GENERATION, Object.freeze({
    kind: "mounted-ability", mountEntityId: BigInt(91), mountEntityRevision: 3, seatIndex: 0, abilitySlot: 1,
  }));
  await omitted.advance(GENERATION);
  now = 50_001;
  await assert.rejects(omitted.advance(GENERATION), /omitted, duplicated, or added/u);
  await omitted.drain();
  assert.equal(omitted.state, "failed");
  assert.equal(omitted.diagnostics().queuedContextCommands, 0, "terminal failure clears semantic intent custody");
});

test("right click remains one V1 secondary-use action per press", async () => {
  let now = 1;
  const runtime = new FakeRuntime();
  const live = pump(runtime, continuity(), () => now);
  const base = intent();
  live.sample(GENERATION, withAction(base, "secondaryUse", true));
  await live.advance(GENERATION);
  now = 50_001;
  const first = await live.advance(GENERATION);
  assert.equal(first.step?.actionReceipts.filter((entry) => entry.kind === "secondary-use").length, 1);
  now = 100_001;
  const held = await live.advance(GENERATION);
  assert.equal(held.step?.actionReceipts.filter((entry) => entry.kind === "secondary-use").length, 0);
  live.sample(GENERATION, withAction(base, "secondaryUse", false));
  now = 150_001;
  await live.advance(GENERATION);
  live.sample(GENERATION, withAction(base, "secondaryUse", true));
  now = 200_001;
  const second = await live.advance(GENERATION);
  assert.equal(second.step?.actionReceipts.filter((entry) => entry.kind === "secondary-use").length, 1);
  await live.stop();
});

test("stop clears queued semantic intent before any native call", async () => {
  const runtime = new FakeRuntime();
  const live = pump(runtime, continuity(), () => 1, 31);
  live.queueContextCommand(GENERATION, Object.freeze({
    kind: "cast", spellId: "spell:stopped", loadoutRevision: 2, learnedRevision: 5,
  }));
  assert.equal(live.diagnostics().queuedContextCommands, 1);
  await live.stop();
  assert.equal(live.state, "stopped");
  assert.equal(live.diagnostics().queuedContextCommands, 0);
  assert.deepEqual(runtime.calls, []);
  assert.throws(
    () => live.queueContextCommand(GENERATION, Object.freeze({
      kind: "cast", spellId: "spell:too-late", loadoutRevision: 2, learnedRevision: 5,
    })),
    /is stopped/u,
  );
});

function respawnIntent(expected: RustIntegratedRuntimeIdentityV1): RustIntegratedPlayerRespawnV1 {
  return Object.freeze({
    expected,
    externalEntityId: "player:test",
    actorId: "actor:test",
    playerId: BigInt(1),
    entityId: BigInt("4294967297"),
    expectedEntityRevision: BigInt(1),
    expectedGameplaySequence: BigInt(3),
    expectedGameplayCombatRevision: BigInt(1),
    expectedCombatantRevision: BigInt(1),
    expectedDeathSequence: BigInt(1),
    expectedMaxHealth: 20_000,
    respawnPosition: Object.freeze({ xMilli: 8_000, yMilli: 64_000, zMilli: 8_000 }),
    keepInventory: false,
  });
}

test("serialized respawn rebinds every BWD7 CAS cursor from one post-neutral extraction before persistence", async () => {
  const applied = Object.freeze({
    sequence: BigInt(1), targetTick: BigInt(0), moveX: 12_345, moveZ: -7_654,
    lookYaw: 11, lookPitch: -22, buttons: RUST_RUNTIME_INPUT_BUTTON_V1.sprint,
    selectedSlot: 0, flags: 0,
  });
  const continuityValue = continuity({
    lastMonotonicTimeUs: BigInt(1),
    lastInputSequence: BigInt(1),
    nextInputSequence: BigInt(2),
    lastAppliedInput: applied,
  });
  const runtime = new FakeRuntime({
    lastMonotonicTimeUs: 1,
    lastApplied: Object.freeze({ ...applied, sequence: 1, targetTick: 0 }),
  });
  const freshCursors = Object.freeze({
    entityRevision: BigInt(7),
    gameplaySequence: BigInt(11),
    gameplayCombatRevision: BigInt(4),
    combatantRevision: BigInt(3),
  });
  const baseStep = runtime.step.bind(runtime);
  runtime.step = async (...args) => {
    const result = await baseStep(...args);
    if (result.inputsApplied !== 1) return result;
    const successor = Object.freeze({
      ...result.identity,
      revision: Object.freeze({
        ...result.identity.revision,
        entities: result.identity.revision.entities + 1,
        gameplay: result.identity.revision.gameplay + 1,
      }),
      stateHash: hash(901),
    });
    runtime.current = successor;
    return Object.freeze({ ...result, identity: successor });
  };
  let freshExtractions = 0;
  runtime.extractionFactory = (afterRevision) => {
    freshExtractions += 1;
    assert.equal(afterRevision, 0, "post-neutral rebind must use the pump's committed extraction cursor");
    return freshDeadRespawnExtraction(runtime.identity(), runtime.extractionRevision, freshCursors);
  };
  (runtime as FakeRuntime & { command: NonNullable<RustLiveInputPumpServiceR5["command"]> }).command = async () => {
    throw new Error("respawn orchestration test replaces the private dispatch seam");
  };
  const baseStatus = status(continuityValue);
  const live = new RustLiveInputPumpR5({
    service: runtime,
    status: Object.freeze({
      ...baseStatus,
      worldViewBinding: Object.freeze({
        ...baseStatus.worldViewBinding!,
        playerId: BigInt("12884901895"),
        actorId: "player:extraction",
        inventoryContainer: Object.freeze({
          kind: "player" as const,
          id: "player:extraction",
          ownerId: "player:extraction",
        }),
        equipmentContainer: Object.freeze({
          kind: "equipment" as const,
          id: "player:extraction:equipment",
          ownerId: "player:extraction",
        }),
      }),
    }),
    worldGeneration: GENERATION,
    externalEntityId: "player:extraction",
    initialNativeDeathRespawnCursor: 0,
    nowUs: () => 1,
  });
  let dispatched: RustLivePlayerRespawnPlanV1 | null = null;
  let retained: RustLivePlayerRespawnPlanV1 | null = null;
  const dispatchOwner = live as unknown as {
    dispatchPlayerRespawnPlan(
      worldGeneration: number,
      lifecycle: number,
      plan: RustLivePlayerRespawnPlanV1,
    ): Promise<unknown>;
  };
  dispatchOwner.dispatchPlayerRespawnPlan = async (_worldGeneration, _lifecycle, plan) => {
    dispatched = plan;
    return Object.freeze({ discarded: false, plan });
  };

  const staleIntent = Object.freeze({
    ...respawnIntent(runtime.identity()),
    externalEntityId: "player:extraction",
    actorId: "player:extraction",
    playerId: BigInt("12884901895"),
    expectedCombatantRevision: BigInt(0),
  });
  const result = await live.respawnPlayer(GENERATION, staleIntent, {
    beforeDispatch: async (plan) => { retained = plan; },
  });
  assert.equal((result as { discarded: boolean }).discarded, false);
  assert.equal(dispatched, retained, "the persisted plan must be the exact object dispatched after neutralization");
  assert.equal(freshExtractions, 1, "a new non-neutral respawn must take exactly one fresh extraction");
  assert.deepEqual(runtime.calls, ["step", "extract"], "neutralization and its exact rebind extraction remain serialized");
  assert.equal(runtime.submitted.length, 1);
  assert.deepEqual(runtime.submitted[0], {
    sequence: 2,
    targetTick: 1,
    moveX: 0,
    moveZ: 0,
    lookYaw: 11,
    lookPitch: -22,
    buttons: 0,
    selectedSlot: 0,
    flags: 0,
  });
  assert.equal(dispatched!.batch.expected.tick, 1);
  assert.equal(dispatched!.batch.expected.revision.simulation, 1);
  assert.equal(dispatched!.batch.expected.revision.entities, 2);
  assert.equal(dispatched!.batch.expected.revision.gameplay, 2);
  assert.equal(dispatched!.request.expected, dispatched!.batch.expected);
  assert.equal(dispatched!.request.expectedEntityRevision, freshCursors.entityRevision);
  assert.equal(dispatched!.request.expectedGameplaySequence, freshCursors.gameplaySequence);
  assert.equal(dispatched!.request.expectedGameplayCombatRevision, freshCursors.gameplayCombatRevision);
  assert.equal(dispatched!.request.expectedCombatantRevision, freshCursors.combatantRevision);
  assert.notEqual(dispatched!.request.expectedEntityRevision, staleIntent.expectedEntityRevision);
  assert.notEqual(dispatched!.request.expectedGameplaySequence, staleIntent.expectedGameplaySequence);
  assert.notEqual(dispatched!.request.expectedGameplayCombatRevision, staleIntent.expectedGameplayCombatRevision);
  assert.notEqual(dispatched!.request.expectedCombatantRevision, staleIntent.expectedCombatantRevision);
  assert.equal(live.diagnostics().nextInputSequence, 3);
  assert.equal(live.diagnostics().lastExtractionRevision, runtime.extractionRevision);
  assert.equal(live.diagnostics().lastAppliedMoveX, 0);
  assert.equal(live.diagnostics().lastAppliedMoveZ, 0);
  assert.equal(live.diagnostics().lastAppliedButtons, 0);

  const canonical = planRustLivePlayerRespawnV1(dispatched!.batch.expected, dispatched!.request);
  assert.deepEqual(dispatched!.batch.operations[0]!.payload, canonical.batch.operations[0]!.payload);
  let retried: RustLivePlayerRespawnPlanV1 | null = null;
  dispatchOwner.dispatchPlayerRespawnPlan = async (_worldGeneration, _lifecycle, plan) => {
    retried = plan;
    return Object.freeze({ discarded: false, plan });
  };
  await live.retryPlayerRespawn(GENERATION, dispatched!);
  assert.deepEqual(retried!.batch.operations[0]!.payload, dispatched!.batch.operations[0]!.payload,
    "retained retry must rehydrate the exact same BWD7 bytes");
  assert.equal(retried!.batch.commandHash, dispatched!.batch.commandHash);
  assert.equal(freshExtractions, 1, "retained retry must not neutralize or rebind its durable bytes");
  await live.stop();
});

test("death-respawn cursor holds one exact full parent until an idempotent acknowledgement", async () => {
  const runtime = new FakeRuntime();
  const live = new RustLiveInputPumpR5({
    service: runtime,
    status: status(continuity()),
    worldGeneration: GENERATION,
    externalEntityId: "player:test",
    initialNativeDeathRespawnCursor: 0,
  });
  const parent: RustLivePlayerDeathRespawnR10 = Object.freeze({
    respawnSequence: BigInt(1),
    receiptHash: "12".repeat(16),
    generatedDropCount: 0,
    playerId: BigInt(1),
    entityId: BigInt("4294967297"),
    deathSequence: BigInt(1),
    inventoryContainer: "container-key-v1/01",
    inventoryBeforeRevision: BigInt(1),
    inventoryAfterRevision: BigInt(1),
    equipmentContainer: "container-key-v1/02",
    equipmentBeforeRevision: BigInt(0),
    equipmentAfterRevision: BigInt(0),
    custodyAfterHash: "34".repeat(16),
    drops: Object.freeze([]),
  });
  const observer = live as unknown as {
    observeDeathRespawnAfterExtraction(
      worldGeneration: number,
      identityValue: RustIntegratedRuntimeIdentityV1,
      player: Pick<RustLivePlayerViewR10, "respawnAuthoritySchema" | "latestDeathRespawn">,
    ): unknown;
  };
  const delivery = observer.observeDeathRespawnAfterExtraction(
    GENERATION,
    runtime.identity(),
    Object.freeze({ respawnAuthoritySchema: 1, latestDeathRespawn: parent }),
  ) as Parameters<RustLiveInputPumpR5["acknowledgeDeathRespawn"]>[1];
  assert.equal(delivery.cursorBefore, 0);
  assert.equal(delivery.cursorAfter, 1);
  assert.equal(delivery.parent, parent, "the full decoded parent remains intact for projection/checkpoint");
  assert.equal(live.diagnostics().pendingDeathRespawnReceiptHash, parent.receiptHash);
  assert.equal(live.acknowledgeDeathRespawn(GENERATION, delivery), true);
  assert.equal(live.diagnostics().deathRespawnCursor, 1);
  assert.equal(live.diagnostics().pendingDeathRespawnSequence, null);
  assert.equal(live.acknowledgeDeathRespawn(GENERATION, delivery), false,
    "a byte-identical acknowledgement is idempotent");
  await live.stop();
});

test("legacy death-respawn cursor seeds to native latest without replay, then delivers the exact successor", async () => {
  const runtime = new FakeRuntime();
  const live = new RustLiveInputPumpR5({
    service: runtime,
    status: status(continuity()),
    worldGeneration: GENERATION,
    externalEntityId: "player:test",
    initialNativeDeathRespawnCursor: null,
  });
  const parent = (sequence: number): RustLivePlayerDeathRespawnR10 => Object.freeze({
    respawnSequence: BigInt(sequence),
    receiptHash: sequence.toString(16).padStart(2, "0").repeat(16),
    generatedDropCount: 0,
    playerId: BigInt(1),
    entityId: BigInt("4294967297"),
    deathSequence: BigInt(sequence),
    inventoryContainer: "container-key-v1/01",
    inventoryBeforeRevision: BigInt(1),
    inventoryAfterRevision: BigInt(1),
    equipmentContainer: "container-key-v1/02",
    equipmentBeforeRevision: BigInt(0),
    equipmentAfterRevision: BigInt(0),
    custodyAfterHash: "34".repeat(16),
    drops: Object.freeze([]),
  });
  const observer = live as unknown as {
    observeDeathRespawnAfterExtraction(
      worldGeneration: number,
      identityValue: RustIntegratedRuntimeIdentityV1,
      player: Pick<RustLivePlayerViewR10, "respawnAuthoritySchema" | "latestDeathRespawn">,
    ): unknown;
  };
  const first = observer.observeDeathRespawnAfterExtraction(
    GENERATION,
    runtime.identity(),
    Object.freeze({ respawnAuthoritySchema: 1, latestDeathRespawn: parent(5) }),
  );
  assert.equal(first, null);
  assert.equal(live.diagnostics().deathRespawnLegacySeedPending, false);
  assert.equal(live.diagnostics().deathRespawnCursor, 5);
  assert.equal(live.diagnostics().pendingDeathRespawnSequence, null);

  const next = observer.observeDeathRespawnAfterExtraction(
    GENERATION,
    runtime.identity(),
    Object.freeze({ respawnAuthoritySchema: 1, latestDeathRespawn: parent(6) }),
  ) as Parameters<RustLiveInputPumpR5["acknowledgeDeathRespawn"]>[1];
  assert.equal(next.cursorBefore, 5);
  assert.equal(next.cursorAfter, 6);
  assert.equal(next.parent.deathSequence, BigInt(6));
  assert.equal(live.acknowledgeDeathRespawn(GENERATION, next), true);
  assert.equal(live.diagnostics().deathRespawnCursor, 6);
  await live.stop();
});

test("false-policy respawn rejects an unseeded legacy cursor before neutral input or command I/O", async () => {
  const runtime = new FakeRuntime();
  const live = new RustLiveInputPumpR5({
    service: runtime,
    status: status(continuity()),
    worldGeneration: GENERATION,
    externalEntityId: "player:test",
    initialNativeDeathRespawnCursor: null,
  });
  await assert.rejects(
    live.respawnPlayer(GENERATION, respawnIntent(runtime.identity())),
    /requires a seeded durable parent cursor/u,
  );
  await live.drain();
  assert.equal(live.state, "failed");
  assert.deepEqual(runtime.calls, []);
});

test("respawn requires the native command service before neutralizing retained movement", async () => {
  const applied = Object.freeze({
    sequence: BigInt(1), targetTick: BigInt(0), moveX: 1, moveZ: 0,
    lookYaw: 0, lookPitch: 0, buttons: 0, selectedSlot: 0, flags: 0,
  });
  const runtime = new FakeRuntime({
    lastMonotonicTimeUs: 1,
    lastApplied: Object.freeze({ ...applied, sequence: 1, targetTick: 0 }),
  });
  const live = new RustLiveInputPumpR5({
    service: runtime,
    status: status(continuity({
      lastMonotonicTimeUs: BigInt(1),
      lastInputSequence: BigInt(1),
      nextInputSequence: BigInt(2),
      lastAppliedInput: applied,
    })),
    worldGeneration: GENERATION,
    externalEntityId: "player:test",
    initialNativeDeathRespawnCursor: 0,
  });
  await assert.rejects(
    live.respawnPlayer(GENERATION, respawnIntent(runtime.identity())),
    /does not expose integrated player respawn commands/u,
  );
  await live.drain();
  assert.equal(live.state, "failed");
  assert.deepEqual(runtime.calls, []);
  assert.deepEqual(runtime.submitted, []);
});

test("respawn rejects a latched pre-death action edge before command I/O", async () => {
  const runtime = new FakeRuntime();
  (runtime as FakeRuntime & { command: NonNullable<RustLiveInputPumpServiceR5["command"]> }).command = async () => {
    throw new Error("pending action precondition must reject before native command I/O");
  };
  const live = new RustLiveInputPumpR5({
    service: runtime,
    status: status(continuity()),
    worldGeneration: GENERATION,
    externalEntityId: "player:test",
    initialNativeDeathRespawnCursor: 0,
  });
  live.sample(GENERATION, withAction(intent({ moveZ: 0 }), "primaryAttack", true));
  await assert.rejects(
    live.respawnPlayer(GENERATION, respawnIntent(runtime.identity())),
    /cannot cross pending input, action, or context-command custody/u,
  );
  await live.drain();
  assert.equal(live.state, "failed");
  assert.deepEqual(runtime.calls, []);
});
