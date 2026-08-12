import {
  RUST_RUNTIME_INPUT_BUTTON_MASK_V1,
  RUST_RUNTIME_INPUT_BUTTON_V1,
  RUST_RUNTIME_INPUT_FLAG_MASK_V1,
  RUST_RUNTIME_INPUT_FLAG_V1,
  rustIntegratedRuntimeIdentityEqualsV1,
  type RustIntegratedRuntimeExtractionV1,
  type RustIntegratedRuntimeExtractionViewV1,
  type RustIntegratedRuntimeCommandBatchV1,
  type RustIntegratedRuntimeCommandReceiptV1,
  type RustIntegratedRuntimeIdentityV1,
  type RustIntegratedRuntimeInputActionKindV1,
  type RustIntegratedRuntimeInputActionReceiptV1,
  type RustIntegratedRuntimeInputFrameV1,
  type RustIntegratedRuntimeContextCommandActionV2,
  type RustIntegratedRuntimeContextCommandV2,
  type RustIntegratedRuntimeStepResultV2,
  type RustIntegratedRuntimeResponseV1,
} from "./rust-integrated-runtime-contract.ts";
import {
  rustIntegratedRuntimeSemanticActionReceiptHashV2,
  sealRustIntegratedRuntimeContextCommandV2,
} from "./rust-integrated-runtime-codec.ts";
import type {
  RustIntegratedPlayerBootstrapStatusReceiptV1,
  RustIntegratedPlayerRuntimeContinuityV1,
} from "./rust-integrated-runtime-player-status.ts";
import {
  planRustLiveCameraConfigR10,
  rustLiveCameraConfigMatchesR10,
  validateRustLiveCameraAfterCommandR10,
  validateRustLiveCameraConfigReceiptR10,
  type RustLiveCameraConfigIntentR10,
} from "./rust-live-camera-control-r10.ts";
import {
  decodeRustLiveCameraViewR10,
  type RustLiveCameraViewR10,
} from "./rust-live-camera-view-r10.ts";

export const RUST_LIVE_INPUT_STEP_BUDGET_US_R5 = 8_000;
export const RUST_LIVE_INPUT_AXIS_DIVISOR_R5 = 32_767;
export const RUST_LIVE_INPUT_MAX_LATCHED_TRANSITIONS_R5 = 128;
export const RUST_LIVE_CONTEXT_COMMAND_QUEUE_MAX_V2 = 128;

const U64_SAFE_MAX = Number.MAX_SAFE_INTEGER;
const TWO_PI = Math.PI * 2;
const CONTINUOUS_BUTTON_MASK = RUST_RUNTIME_INPUT_BUTTON_V1.jump
  | RUST_RUNTIME_INPUT_BUTTON_V1.crouch
  | RUST_RUNTIME_INPUT_BUTTON_V1.sprint
  | RUST_RUNTIME_INPUT_BUTTON_V1.ascend
  | RUST_RUNTIME_INPUT_BUTTON_V1.descend;

const ACTION_BUTTONS = Object.freeze([
  Object.freeze({ intent: "primaryAttack", bit: RUST_RUNTIME_INPUT_BUTTON_V1.primaryAttack, kind: "primary-attack" }),
  Object.freeze({ intent: "secondaryUse", bit: RUST_RUNTIME_INPUT_BUTTON_V1.secondaryUse, kind: "secondary-use" }),
  Object.freeze({ intent: "interact", bit: RUST_RUNTIME_INPUT_BUTTON_V1.interact, kind: "interact" }),
  Object.freeze({ intent: "mountToggle", bit: RUST_RUNTIME_INPUT_BUTTON_V1.mountToggle, kind: "mount-toggle" }),
  Object.freeze({ intent: "creativeFlightToggle", bit: RUST_RUNTIME_INPUT_BUTTON_V1.creativeFlightToggle, kind: "creative-flight-toggle" }),
  Object.freeze({ intent: "drop", bit: RUST_RUNTIME_INPUT_BUTTON_V1.drop, kind: "drop" }),
] as const satisfies readonly Readonly<{
  intent: keyof RustLiveInputActionIntentR5;
  bit: number;
  kind: RustIntegratedRuntimeInputActionKindV1;
}>[]);

const ACTION_BUTTON_MASK = ACTION_BUTTONS.reduce((mask, action) => mask | action.bit, 0);

type RustIntegratedRuntimeStepResultR5 = Extract<
  RustIntegratedRuntimeResponseV1,
  { type: "runtime-step-result-v1" }
>;

type RustLiveRuntimeStepResultR5 = RustIntegratedRuntimeStepResultR5 | RustIntegratedRuntimeStepResultV2;

export type RustLiveInputHeldIntentR5 = Readonly<{
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  ascend: boolean;
  descend: boolean;
}>;

export type RustLiveInputActionIntentR5 = Readonly<{
  primaryAttack: boolean;
  secondaryUse: boolean;
  interact: boolean;
  mountToggle: boolean;
  creativeFlightToggle: boolean;
  drop: boolean;
}>;

export type RustLiveInputIntentR5 = Readonly<{
  moveX: number;
  moveZ: number;
  yawRadians: number;
  pitchRadians: number;
  selectedSlot: number;
  held: RustLiveInputHeldIntentR5;
  actions: RustLiveInputActionIntentR5;
}>;

export type RustLiveContextCommandIntentV2 = RustIntegratedRuntimeContextCommandActionV2;

export interface RustLiveInputPumpServiceR5 {
  identity(): RustIntegratedRuntimeIdentityV1;
  step(
    monotonicTimeUs: number,
    budgetUs: number,
    inputs: readonly RustIntegratedRuntimeInputFrameV1[],
  ): Promise<RustIntegratedRuntimeStepResultR5>;
  /** Optional until the native schema-6 dispatcher/capability is installed. */
  stepV2?(
    monotonicTimeUs: number,
    budgetUs: number,
    inputs: readonly RustIntegratedRuntimeInputFrameV1[],
    contextCommands: readonly RustIntegratedRuntimeContextCommandV2[],
  ): Promise<RustIntegratedRuntimeStepResultV2>;
  extract(
    afterRevision: number,
    maxBytes?: number,
    view?: RustIntegratedRuntimeExtractionViewV1,
  ): Promise<RustIntegratedRuntimeExtractionV1>;
  command?(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1>;
}

export type RustLiveInputPumpOptionsR5 = Readonly<{
  service: RustLiveInputPumpServiceR5;
  status: Pick<RustIntegratedPlayerBootstrapStatusReceiptV1,
    "entityAuthority" | "continuity" | "worldViewBinding">
    & Partial<Pick<RustIntegratedPlayerBootstrapStatusReceiptV1, "entity" | "runtimePlayer">>;
  worldGeneration: number;
  afterExtractionRevision?: number;
  externalEntityId?: string;
  nowUs?: () => number;
  /** Explicit restore/status seam; absence disables semantic command queueing. */
  nextContextCommandSequence?: number | null;
}>;

export type RustLiveInputPumpAdvanceOptionsR5 = Readonly<{
  initialSync?: boolean;
  view?: RustIntegratedRuntimeExtractionViewV1;
}>;

export type RustLiveInputPumpExtractionCauseR5 = "initial" | "authority" | "viewport" | "camera-config";

export type RustLiveInputPumpAdvanceResultR5 = Readonly<{
  discarded: boolean;
  step: RustLiveRuntimeStepResultR5 | null;
  extraction: RustIntegratedRuntimeExtractionV1 | null;
  cause?: RustLiveInputPumpExtractionCauseR5 | null;
  camera?: RustLiveCameraViewR10 | null;
}>;

export type RustLiveInputPumpViewResultR5 = Readonly<{
  discarded: boolean;
  extraction: RustIntegratedRuntimeExtractionV1 | null;
  cause: "viewport" | null;
  camera: RustLiveCameraViewR10 | null;
}>;

export type RustLiveInputPumpCameraConfigResultR10 = Readonly<{
  discarded: boolean;
  changed: boolean;
  receipt: RustIntegratedRuntimeCommandReceiptV1 | null;
  extraction: RustIntegratedRuntimeExtractionV1 | null;
  camera: RustLiveCameraViewR10 | null;
}>;

export type RustLiveCameraConfigUpdateR10 = RustLiveCameraConfigIntentR10
  | ((current: RustLiveCameraViewR10) => RustLiveCameraConfigIntentR10);

export type RustLiveInputPumpStateR5 = "ready" | "failed" | "stopping" | "stopped";

export type RustLiveInputPumpDiagnosticsR5 = Readonly<{
  schema: 1;
  state: RustLiveInputPumpStateR5;
  worldGeneration: number;
  queuedAdvances: number;
  inFlight: boolean;
  nativeInputPending: boolean;
  pendingInputSequence: number | null;
  nextInputSequence: number;
  nextActionSequence: number;
  nextContextCommandSequence: number | null;
  queuedContextCommands: number;
  lastMonotonicTimeUs: number;
  lastExtractionRevision: number;
  lastAuthorityTick: number;
  lastAppliedButtons: number;
  selectedSlot: number;
  authoritativeFlags: number;
  latchedActionTransitions: number;
  samples: number;
  stepCalls: number;
  extractionCalls: number;
  commandCalls: number;
  viewExtractionCalls: number;
  lastView: RustIntegratedRuntimeExtractionViewV1 | null;
  cameraRevision: bigint | null;
  appliedInputs: number;
  discardedContinuations: number;
  lastError: string | null;
}>;

type QuantizedIntentR5 = Readonly<{
  moveX: number;
  moveZ: number;
  lookYaw: number;
  lookPitch: number;
  continuousButtons: number;
  selectedSlot: number;
}>;

type PendingInputR5 = Readonly<{
  frame: RustIntegratedRuntimeInputFrameV1;
  submitted: boolean;
  consumedTransitions: readonly Readonly<{ bit: number; value: boolean }>[];
  expectedActions: readonly Readonly<{
    bit: number;
    kind: RustIntegratedRuntimeInputActionKindV1;
  }>[];
  contextCommands: readonly RustIntegratedRuntimeContextCommandV2[];
  contextIntentCount: number;
}>;

type StagedAppliedInputR5 = Readonly<{
  pending: PendingInputR5;
  authoritativeFlags: number;
  nextActionSequence: number;
}>;

export class RustLiveInputPumpErrorR5 extends Error {
  readonly name = "RustLiveInputPumpErrorR5";
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new RustLiveInputPumpErrorR5(code, message);
}

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) fail("input-number", `${label} is not finite`);
  return value;
}

function integer(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("input-integer", `${label} is outside its exact integer range`);
  }
  return value;
}

function safeU64(value: bigint, label: string, allowZero = true) {
  if (value < BigInt(allowZero ? 0 : 1) || value > BigInt(U64_SAFE_MAX)) {
    fail("continuity-range", `${label} cannot be represented exactly by the browser runtime protocol`);
  }
  return Number(value);
}

function assertBoolean(value: boolean, label: string) {
  if (typeof value !== "boolean") fail("input-boolean", `${label} is not boolean`);
  return value;
}

function defaultNowUs() {
  const milliseconds = typeof performance !== "undefined" ? performance.now() : Date.now();
  return Math.floor(milliseconds * 1_000);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function identityDoesNotRegress(before: RustIntegratedRuntimeIdentityV1, after: RustIntegratedRuntimeIdentityV1) {
  if (before.universeId !== after.universeId || before.locationId !== after.locationId) return false;
  if (after.tick < before.tick) return false;
  return (Object.keys(before.revision) as Array<keyof RustIntegratedRuntimeIdentityV1["revision"]>)
    .every((key) => after.revision[key] >= before.revision[key]);
}

function frozenIdentity(value: RustIntegratedRuntimeIdentityV1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({ ...value, revision: Object.freeze({ ...value.revision }) });
}

function frozenFrame(value: RustIntegratedRuntimeInputFrameV1): RustIntegratedRuntimeInputFrameV1 {
  return Object.freeze({ ...value });
}

function checkedView(value: RustIntegratedRuntimeExtractionViewV1) {
  return Object.freeze({
    viewportWidth: integer(value.viewportWidth, 1, 16_384, "camera viewport width"),
    viewportHeight: integer(value.viewportHeight, 1, 16_384, "camera viewport height"),
    viewRevision: integer(value.viewRevision, 0, U64_SAFE_MAX, "camera view revision"),
  });
}

function sameView(
  left: RustIntegratedRuntimeExtractionViewV1 | null,
  right: RustIntegratedRuntimeExtractionViewV1,
) {
  return left !== null
    && left.viewportWidth === right.viewportWidth
    && left.viewportHeight === right.viewportHeight
    && left.viewRevision === right.viewRevision;
}

export function quantizeRustLiveInputAxisR5(value: number) {
  const quantized = Math.round(Math.max(-1, Math.min(1, finite(value, "input axis")))
    * RUST_LIVE_INPUT_AXIS_DIVISOR_R5);
  return Object.is(quantized, -0) ? 0 : quantized;
}

export function quantizeRustLiveInputYawR5(value: number) {
  const angle = finite(value, "input yaw");
  const wrapped = ((angle + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  const quantized = Math.round((wrapped / Math.PI) * RUST_LIVE_INPUT_AXIS_DIVISOR_R5);
  return Object.is(quantized, -0) ? 0 : quantized;
}

export function quantizeRustLiveInputPitchR5(value: number) {
  const angle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, finite(value, "input pitch")));
  const quantized = Math.round((angle / (Math.PI / 2)) * RUST_LIVE_INPUT_AXIS_DIVISOR_R5);
  return Object.is(quantized, -0) ? 0 : quantized;
}

function continuousButtons(value: RustLiveInputHeldIntentR5) {
  let buttons = 0;
  for (const [key, bit] of [
    ["jump", RUST_RUNTIME_INPUT_BUTTON_V1.jump],
    ["crouch", RUST_RUNTIME_INPUT_BUTTON_V1.crouch],
    ["sprint", RUST_RUNTIME_INPUT_BUTTON_V1.sprint],
    ["ascend", RUST_RUNTIME_INPUT_BUTTON_V1.ascend],
    ["descend", RUST_RUNTIME_INPUT_BUTTON_V1.descend],
  ] as const) {
    if (assertBoolean(value[key], `held input '${key}'`)) buttons |= bit;
  }
  return buttons;
}

function actionButtons(value: RustLiveInputActionIntentR5) {
  let buttons = 0;
  for (const action of ACTION_BUTTONS) {
    if (assertBoolean(value[action.intent], `action input '${action.intent}'`)) buttons |= action.bit;
  }
  return buttons;
}

function quantizedIntent(value: RustLiveInputIntentR5): QuantizedIntentR5 {
  return Object.freeze({
    moveX: quantizeRustLiveInputAxisR5(value.moveX),
    moveZ: quantizeRustLiveInputAxisR5(value.moveZ),
    lookYaw: quantizeRustLiveInputYawR5(value.yawRadians),
    lookPitch: quantizeRustLiveInputPitchR5(value.pitchRadians),
    continuousButtons: continuousButtons(value.held),
    selectedSlot: integer(value.selectedSlot, 0, 8, "selected slot"),
  });
}

function initialIntent(
  continuity: RustIntegratedPlayerRuntimeContinuityV1,
  selectedSlot: number,
): QuantizedIntentR5 {
  const input = continuity.lastAppliedInput;
  return Object.freeze({
    moveX: input?.moveX ?? 0,
    moveZ: input?.moveZ ?? 0,
    lookYaw: input?.lookYaw ?? 0,
    lookPitch: input?.lookPitch ?? 0,
    continuousButtons: (input?.buttons ?? 0) & CONTINUOUS_BUTTON_MASK,
    selectedSlot,
  });
}

function checkedContextCommandIntentV2(value: RustLiveContextCommandIntentV2): RustLiveContextCommandIntentV2 {
  const sealed = sealRustIntegratedRuntimeContextCommandV2({ sequence: 1, targetTick: 0, action: value });
  switch (sealed.action.kind) {
    case "cast": return Object.freeze({ ...sealed.action });
    case "reload": return Object.freeze({
      ...sealed.action,
      container: Object.freeze({ ...sealed.action.container }),
    });
    case "mounted-ability": return Object.freeze({ ...sealed.action });
  }
}

function validateContinuity(
  status: RustLiveInputPumpOptionsR5["status"],
  identity: RustIntegratedRuntimeIdentityV1,
) {
  const continuity = status.continuity;
  if (!continuity.queuedInputsEmpty) fail("continuity-queued", "live input cannot start while Rust has a queued input");
  if (status.entityAuthority.tick !== BigInt(identity.tick)) {
    fail("continuity-tick", "player status tick does not match the active Rust runtime identity");
  }
  if (continuity.nextInputSequence === null) fail("continuity-exhausted", "Rust input sequence is exhausted");
  if (continuity.nextActionSequence === null) fail("continuity-exhausted", "Rust action receipt sequence is exhausted");
  const nextInputSequence = safeU64(continuity.nextInputSequence, "next input sequence", false);
  const nextActionSequence = safeU64(continuity.nextActionSequence, "next action sequence", false);
  const lastInputSequence = continuity.lastInputSequence === null
    ? null : safeU64(continuity.lastInputSequence, "last input sequence", false);
  const lastActionSequence = continuity.lastActionSequence === null
    ? null : safeU64(continuity.lastActionSequence, "last action sequence", false);
  if (nextInputSequence !== (lastInputSequence === null ? 1 : lastInputSequence + 1)) {
    fail("continuity-input", "Rust input sequence continuation is not exact");
  }
  if (nextActionSequence !== (lastActionSequence === null ? 1 : lastActionSequence + 1)) {
    fail("continuity-action", "Rust action receipt continuation is not exact");
  }
  if ((continuity.lastAppliedInput?.sequence ?? null) !== continuity.lastInputSequence) {
    fail("continuity-input", "Rust last-applied input does not attest the input cursor");
  }
  if (continuity.authoritativeFlags & ~RUST_RUNTIME_INPUT_FLAG_MASK_V1) {
    fail("continuity-flags", "Rust player status contains unsupported authoritative flags");
  }
  if (continuity.lastAppliedInput !== null) {
    if (continuity.lastAppliedInput.buttons & ~RUST_RUNTIME_INPUT_BUTTON_MASK_V1) {
      fail("continuity-buttons", "Rust last-applied input contains unsupported button bits");
    }
    integer(continuity.lastAppliedInput.selectedSlot, 0, 8, "last-applied selected slot");
    if (continuity.lastAppliedInput.flags & ~RUST_RUNTIME_INPUT_FLAG_MASK_V1) {
      fail("continuity-flags", "Rust last-applied input contains unsupported flag bits");
    }
    if (status.worldViewBinding !== null
      && continuity.lastAppliedInput.selectedSlot !== status.worldViewBinding.selectedSlot) {
      fail("continuity-slot", "Rust last-applied input and world-view binding disagree on selected slot");
    }
  }
  const selectedSlot = continuity.lastAppliedInput?.selectedSlot ?? status.worldViewBinding?.selectedSlot;
  if (selectedSlot === undefined) fail("continuity-slot", "Rust player status has no authoritative selected slot");
  integer(selectedSlot, 0, 8, "authoritative selected slot");
  return Object.freeze({
    nextInputSequence,
    nextActionSequence,
    lastMonotonicTimeUs: safeU64(continuity.lastMonotonicTimeUs, "last monotonic time"),
    lastAppliedButtons: continuity.lastAppliedInput?.buttons ?? 0,
    selectedSlot,
  });
}

function validateFlagTransition(
  before: number,
  receipt: RustIntegratedRuntimeInputActionReceiptV1,
) {
  let expected = before;
  if (receipt.outcome === "applied" && receipt.kind === "creative-flight-toggle") {
    if ((before & RUST_RUNTIME_INPUT_FLAG_V1.creative) === 0
      || (before & RUST_RUNTIME_INPUT_FLAG_V1.mounted) !== 0) {
      fail("receipt-flags", "Rust applied an ineligible creative-flight transition");
    }
    expected ^= RUST_RUNTIME_INPUT_FLAG_V1.flying;
  } else if (receipt.outcome === "applied" && receipt.kind === "mount-toggle") {
    expected ^= RUST_RUNTIME_INPUT_FLAG_V1.mounted;
    if ((expected & RUST_RUNTIME_INPUT_FLAG_V1.mounted) !== 0) {
      expected &= ~RUST_RUNTIME_INPUT_FLAG_V1.flying;
    }
  }
  if (receipt.authoritativeFlags !== expected) {
    fail("receipt-flags", `Rust action receipt '${receipt.kind}' returned contradictory authoritative flags`);
  }
  return expected;
}

export class RustLiveInputPumpR5 {
  readonly worldGeneration: number;

  private readonly service: RustLiveInputPumpServiceR5;
  private readonly nowUs: () => number;
  private readonly playerExternalEntityId: string | null;
  private readonly actionTransitions = new Map<number, boolean[]>();
  private tail: Promise<unknown> = Promise.resolve();
  private stopPromise: Promise<void> | null = null;
  private lifecycle = 0;
  private stateValue: RustLiveInputPumpStateR5 = "ready";
  private lastError: string | null = null;
  private queuedAdvances = 0;
  private inFlight = false;
  private latest: QuantizedIntentR5;
  private physicalActionButtons: number;
  private lastAppliedButtons: number;
  private selectedSlot: number;
  private authoritativeFlags: number;
  private nextInputSequence: number;
  private nextActionSequence: number;
  private nextContextCommandSequence: number | null;
  private readonly contextCommandIntents: RustLiveContextCommandIntentV2[] = [];
  private lastMonotonicTimeUs: number;
  private lastIdentity: RustIntegratedRuntimeIdentityV1;
  private lastExtractionRevision: number;
  private lastExtractionHash: string | null = null;
  private lastView: RustIntegratedRuntimeExtractionViewV1 | null = null;
  private scheduledView: RustIntegratedRuntimeExtractionViewV1 | null = null;
  private camera: RustLiveCameraViewR10 | null = null;
  private pendingInput: PendingInputR5 | null = null;
  private samples = 0;
  private stepCalls = 0;
  private extractionCalls = 0;
  private commandCalls = 0;
  private viewExtractionCalls = 0;
  private appliedInputs = 0;
  private discardedContinuations = 0;

  constructor(options: RustLiveInputPumpOptionsR5) {
    this.service = options.service;
    this.worldGeneration = integer(options.worldGeneration, 0, U64_SAFE_MAX, "world generation");
    this.nowUs = options.nowUs ?? defaultNowUs;
    this.playerExternalEntityId = options.externalEntityId
      ?? options.status.runtimePlayer?.binding.externalEntityId
      ?? options.status.entity?.record.externalEntityId
      ?? null;
    if (this.playerExternalEntityId !== null
      && (typeof this.playerExternalEntityId !== "string" || this.playerExternalEntityId.length === 0)) {
      fail("camera-binding", "live input pump external player identity is empty");
    }
    const identity = frozenIdentity(this.service.identity());
    const continuity = validateContinuity(options.status, identity);
    this.lastIdentity = identity;
    this.nextInputSequence = continuity.nextInputSequence;
    this.nextActionSequence = continuity.nextActionSequence;
    this.nextContextCommandSequence = options.nextContextCommandSequence === undefined
      || options.nextContextCommandSequence === null
      ? null
      : integer(options.nextContextCommandSequence, 1, U64_SAFE_MAX, "next context command sequence");
    this.lastMonotonicTimeUs = continuity.lastMonotonicTimeUs;
    this.lastAppliedButtons = continuity.lastAppliedButtons;
    this.physicalActionButtons = continuity.lastAppliedButtons & ACTION_BUTTON_MASK;
    this.selectedSlot = continuity.selectedSlot;
    this.authoritativeFlags = options.status.continuity.authoritativeFlags;
    this.latest = initialIntent(options.status.continuity, continuity.selectedSlot);
    this.lastExtractionRevision = integer(options.afterExtractionRevision ?? 0, 0, U64_SAFE_MAX,
      "initial extraction revision");
    for (const action of ACTION_BUTTONS) this.actionTransitions.set(action.bit, []);
  }

  get state() { return this.stateValue; }

  sample(worldGeneration: number, intent: RustLiveInputIntentR5) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    try {
      const next = quantizedIntent(intent);
      const nextActions = actionButtons(intent.actions);
      for (const action of ACTION_BUTTONS) {
        const wasDown = (this.physicalActionButtons & action.bit) !== 0;
        const isDown = (nextActions & action.bit) !== 0;
        if (wasDown === isDown) continue;
        const queue = this.actionTransitions.get(action.bit)!;
        if (queue.length >= RUST_LIVE_INPUT_MAX_LATCHED_TRANSITIONS_R5) {
          fail("input-transition-capacity", `latched '${action.intent}' transitions exceed their bound`);
        }
        queue.push(isDown);
      }
      this.physicalActionButtons = nextActions;
      this.latest = next;
      this.samples += 1;
    } catch (error) {
      this.failClosed(error);
      throw error;
    }
  }

  queueContextCommand(worldGeneration: number, intent: RustLiveContextCommandIntentV2) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    if (this.nextContextCommandSequence === null) {
      fail("context-command-continuity", "Rust status does not attest the next context command sequence");
    }
    if (!this.service.stepV2) {
      fail("context-command-service", "Rust runtime does not expose the schema-6 StepV2 dispatcher");
    }
    if (this.contextCommandIntents.length >= RUST_LIVE_CONTEXT_COMMAND_QUEUE_MAX_V2) {
      fail("context-command-capacity", "live context command queue exceeds 128 commands");
    }
    try {
      this.contextCommandIntents.push(checkedContextCommandIntentV2(intent));
    } catch (error) {
      this.failClosed(error);
      throw error;
    }
  }

  advance(
    worldGeneration: number,
    options: RustLiveInputPumpAdvanceOptionsR5 = {},
  ): Promise<RustLiveInputPumpAdvanceResultR5> {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    const lifecycle = this.lifecycle;
    const view = options.view ? checkedView(options.view) : this.scheduledView ?? this.lastView;
    if (view !== null) this.reserveView(view);
    this.queuedAdvances += 1;
    const operation = this.enqueueOperation(() => this.runAdvance(
      worldGeneration,
      lifecycle,
      Boolean(options.initialSync),
      view,
    ));
    operation.finally(() => { this.queuedAdvances -= 1; }).catch(() => undefined);
    return operation;
  }

  syncInitial(worldGeneration: number, view?: RustIntegratedRuntimeExtractionViewV1) {
    return this.advance(worldGeneration, { initialSync: true, ...(view ? { view } : {}) });
  }

  refreshView(worldGeneration: number, view: RustIntegratedRuntimeExtractionViewV1) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    const requested = checkedView(view);
    this.reserveView(requested);
    const lifecycle = this.lifecycle;
    return this.enqueueOperation(() => this.runRefreshView(worldGeneration, lifecycle, requested));
  }

  applyCameraConfig(
    worldGeneration: number,
    desired: RustLiveCameraConfigUpdateR10,
    view?: RustIntegratedRuntimeExtractionViewV1,
  ) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    const requested = view ? checkedView(view) : this.scheduledView ?? this.lastView;
    if (requested === null) fail("camera-view", "camera configuration requires an accepted view context");
    this.reserveView(requested);
    const lifecycle = this.lifecycle;
    return this.enqueueOperation(() => this.runCameraConfig(worldGeneration, lifecycle, desired, requested));
  }

  async drain() {
    await this.tail;
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    if (this.stateValue === "stopped") return Promise.resolve();
    if (this.stateValue !== "failed") this.stateValue = "stopping";
    this.lifecycle += 1;
    this.stopPromise = (async () => {
      await this.tail;
      this.pendingInput = null;
      for (const queue of this.actionTransitions.values()) queue.length = 0;
      this.contextCommandIntents.length = 0;
      this.stateValue = "stopped";
    })();
    return this.stopPromise;
  }

  diagnostics(): RustLiveInputPumpDiagnosticsR5 {
    let transitions = 0;
    for (const queue of this.actionTransitions.values()) transitions += queue.length;
    return Object.freeze({
      schema: 1,
      state: this.stateValue,
      worldGeneration: this.worldGeneration,
      queuedAdvances: this.queuedAdvances,
      inFlight: this.inFlight,
      nativeInputPending: this.pendingInput?.submitted ?? false,
      pendingInputSequence: this.pendingInput?.frame.sequence ?? null,
      nextInputSequence: this.nextInputSequence,
      nextActionSequence: this.nextActionSequence,
      nextContextCommandSequence: this.nextContextCommandSequence,
      queuedContextCommands: this.contextCommandIntents.length,
      lastMonotonicTimeUs: this.lastMonotonicTimeUs,
      lastExtractionRevision: this.lastExtractionRevision,
      lastAuthorityTick: this.lastIdentity.tick,
      lastAppliedButtons: this.lastAppliedButtons,
      selectedSlot: this.selectedSlot,
      authoritativeFlags: this.authoritativeFlags,
      latchedActionTransitions: transitions,
      samples: this.samples,
      stepCalls: this.stepCalls,
      extractionCalls: this.extractionCalls,
      commandCalls: this.commandCalls,
      viewExtractionCalls: this.viewExtractionCalls,
      lastView: this.lastView,
      cameraRevision: this.camera?.cameraRevision ?? null,
      appliedInputs: this.appliedInputs,
      discardedContinuations: this.discardedContinuations,
      lastError: this.lastError,
    });
  }

  private async runAdvance(
    worldGeneration: number,
    lifecycle: number,
    initialSync: boolean,
    view: RustIntegratedRuntimeExtractionViewV1 | null,
  ): Promise<RustLiveInputPumpAdvanceResultR5> {
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded();
    this.requireReady();
    if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), this.lastIdentity)) {
      fail("identity-drift", "Rust runtime identity moved outside the live input pump");
    }
    const before = this.lastIdentity;
    const monotonicTimeUs = this.nextMonotonicTime();
    const created = this.pendingInput === null;
    const pending = this.pendingInput ?? this.createPendingInput(before);
    const inputs = created ? Object.freeze([pending.frame]) : Object.freeze([]);
    const contextCommands = created ? pending.contextCommands : Object.freeze([]);
    this.inFlight = true;
    this.stepCalls += 1;
    let step: RustLiveRuntimeStepResultR5;
    try {
      if (pending.contextCommands.length > 0) {
        const stepV2 = this.service.stepV2;
        if (!stepV2) fail("context-command-service", "Rust runtime lost its schema-6 StepV2 dispatcher");
        step = await stepV2.call(
          this.service,
          monotonicTimeUs,
          RUST_LIVE_INPUT_STEP_BUDGET_US_R5,
          inputs,
          contextCommands,
        );
      } else {
        step = await this.service.step(monotonicTimeUs, RUST_LIVE_INPUT_STEP_BUDGET_US_R5, inputs);
      }
    } catch (error) {
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded();
      throw error;
    } finally {
      this.inFlight = false;
    }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded();

    const staged = this.validateStep(before, pending, step);
    const contextApplied = this.validateContextReceipts(pending, step);
    this.lastMonotonicTimeUs = monotonicTimeUs;
    this.lastIdentity = frozenIdentity(step.identity);
    this.pendingInput = step.inputsApplied === 0 ? Object.freeze({
      ...pending,
      submitted: true,
      ...(contextApplied ? { contextCommands: Object.freeze([]), contextIntentCount: 0 } : {}),
    }) : null;
    if (staged) this.commitAppliedInput(staged);
    if (contextApplied) this.commitContextCommands(pending);

    const authorityChanged = step.fixedSteps > 0 || step.inputsApplied === 1;
    const viewChanged = view !== null && !sameView(this.lastView, view);
    if (!authorityChanged && !initialSync && !viewChanged) {
      return Object.freeze({ discarded: false, step, extraction: null });
    }

    this.inFlight = true;
    this.extractionCalls += 1;
    if (viewChanged && !initialSync) this.viewExtractionCalls += 1;
    let extraction: RustIntegratedRuntimeExtractionV1;
    try { extraction = await this.service.extract(this.lastExtractionRevision, undefined, view ?? undefined); }
    catch (error) { if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded(); throw error; }
    finally { this.inFlight = false; }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded();
    this.validateExtraction(extraction, step.identity, authorityChanged || viewChanged);
    const camera = view ? this.decodeCamera(extraction, view) : null;
    this.commitExtraction(extraction, view, camera);
    return Object.freeze({
      discarded: false,
      step,
      extraction,
      cause: initialSync ? "initial" : authorityChanged ? "authority" : "viewport",
      camera,
    });
  }

  private async runRefreshView(
    worldGeneration: number,
    lifecycle: number,
    requested: RustIntegratedRuntimeExtractionViewV1,
  ): Promise<RustLiveInputPumpViewResultR5> {
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedView();
    if (sameView(this.lastView, requested)) {
      return Object.freeze({ discarded: false, extraction: null, cause: null, camera: this.camera });
    }
    this.validateCurrentView(requested);
    const identity = this.lastIdentity;
    this.inFlight = true;
    this.extractionCalls += 1;
    this.viewExtractionCalls += 1;
    let extraction: RustIntegratedRuntimeExtractionV1;
    try { extraction = await this.service.extract(this.lastExtractionRevision, undefined, requested); }
    catch (error) { if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedView(); throw error; }
    finally { this.inFlight = false; }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedView();
    this.validateExtraction(extraction, identity, true);
    const camera = this.decodeCamera(extraction, requested);
    this.commitExtraction(extraction, requested, camera);
    return Object.freeze({ discarded: false, extraction, cause: "viewport", camera });
  }

  private async runCameraConfig(
    worldGeneration: number,
    lifecycle: number,
    desired: RustLiveCameraConfigUpdateR10,
    requested: RustIntegratedRuntimeExtractionViewV1,
  ): Promise<RustLiveInputPumpCameraConfigResultR10> {
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedCamera();
    this.validateCurrentView(requested);
    const current = this.camera;
    if (current === null) fail("camera-state", "camera configuration requires a decoded authoritative camera row");
    const resolvedDesired = typeof desired === "function" ? desired(current) : desired;
    if (rustLiveCameraConfigMatchesR10(current, resolvedDesired)) {
      if (!sameView(this.lastView, requested)) {
        const refreshed = await this.runRefreshView(worldGeneration, lifecycle, requested);
        return Object.freeze({
          discarded: refreshed.discarded,
          changed: false,
          receipt: null,
          extraction: refreshed.extraction,
          camera: refreshed.camera,
        });
      }
      return Object.freeze({ discarded: false, changed: false, receipt: null, extraction: null, camera: current });
    }
    const command = this.service.command;
    if (!command) fail("camera-service", "live input service does not expose integrated camera commands");
    if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), this.lastIdentity)) {
      fail("identity-drift", "Rust runtime identity moved outside the live input pump");
    }
    const plan = planRustLiveCameraConfigR10(this.lastIdentity, current, resolvedDesired);
    this.inFlight = true;
    this.commandCalls += 1;
    let receipt: RustIntegratedRuntimeCommandReceiptV1;
    try { receipt = await command.call(this.service, plan.batch); }
    catch (error) { if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedCamera(); throw error; }
    finally { this.inFlight = false; }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedCamera();
    const validated = validateRustLiveCameraConfigReceiptR10(plan, receipt);
    if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), validated.outer.after)) {
      fail("camera-command-receipt", "service identity disagrees with accepted camera command receipt");
    }
    if (!validated.changed) {
      fail("camera-command-receipt", "accepted camera command was idempotent despite differing from the extracted camera row");
    }
    this.lastIdentity = frozenIdentity(validated.outer.after);
    this.inFlight = true;
    this.extractionCalls += 1;
    let extraction: RustIntegratedRuntimeExtractionV1;
    try { extraction = await this.service.extract(this.lastExtractionRevision, undefined, requested); }
    catch (error) { if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedCamera(); throw error; }
    finally { this.inFlight = false; }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedCamera();
    this.validateExtraction(extraction, validated.outer.after, true);
    const camera = this.decodeCamera(extraction, requested);
    validateRustLiveCameraAfterCommandR10(validated, camera);
    this.commitExtraction(extraction, requested, camera);
    return Object.freeze({ discarded: false, changed: true, receipt, extraction, camera });
  }

  private createPendingInput(identity: RustIntegratedRuntimeIdentityV1): PendingInputR5 {
    integer(identity.tick, 0, U64_SAFE_MAX - 1, "Rust authority tick");
    integer(this.nextInputSequence, 1, U64_SAFE_MAX, "next input sequence");
    let actionState = this.lastAppliedButtons & ACTION_BUTTON_MASK;
    const consumedTransitions: Array<Readonly<{ bit: number; value: boolean }>> = [];
    for (const action of ACTION_BUTTONS) {
      const transition = this.actionTransitions.get(action.bit)![0];
      if (transition === undefined) continue;
      consumedTransitions.push(Object.freeze({ bit: action.bit, value: transition }));
      actionState = transition ? actionState | action.bit : actionState & ~action.bit;
    }
    const buttons = this.latest.continuousButtons | actionState;
    if (buttons & ~RUST_RUNTIME_INPUT_BUTTON_MASK_V1) fail("input-buttons", "live input contains unsupported button bits");
    const expectedActions = ACTION_BUTTONS
      .filter((action) => (buttons & ~this.lastAppliedButtons & action.bit) !== 0)
      .map((action) => Object.freeze({ bit: action.bit, kind: action.kind }));
    const frame = frozenFrame({
      sequence: this.nextInputSequence,
      targetTick: identity.tick + 1,
      moveX: this.latest.moveX,
      moveZ: this.latest.moveZ,
      lookYaw: this.latest.lookYaw,
      lookPitch: this.latest.lookPitch,
      buttons,
      selectedSlot: this.latest.selectedSlot,
      flags: this.authoritativeFlags,
    });
    const contextIntentCount = this.contextCommandIntents.length;
    const contextCommands: RustIntegratedRuntimeContextCommandV2[] = [];
    if (contextIntentCount > 0) {
      const firstSequence = this.nextContextCommandSequence;
      if (firstSequence === null) fail("context-command-continuity", "context command sequence continuity is unavailable");
      for (let index = 0; index < contextIntentCount; index += 1) {
        contextCommands.push(sealRustIntegratedRuntimeContextCommandV2({
          sequence: integer(firstSequence + index, 1, U64_SAFE_MAX, "context command sequence"),
          targetTick: frame.targetTick,
          action: this.contextCommandIntents[index],
        }));
      }
    }
    return Object.freeze({
      frame,
      submitted: false,
      consumedTransitions: Object.freeze(consumedTransitions),
      expectedActions: Object.freeze(expectedActions),
      contextCommands: Object.freeze(contextCommands),
      contextIntentCount,
    });
  }

  private validateStep(
    before: RustIntegratedRuntimeIdentityV1,
    pending: PendingInputR5,
    step: RustLiveRuntimeStepResultR5,
  ): StagedAppliedInputR5 | null {
    if (step.type !== "runtime-step-result-v1" && step.type !== "runtime-step-result-v2") {
      fail("step-response", "Rust step returned the wrong response type");
    }
    integer(step.fixedSteps, 0, 8, "Rust fixed-step count");
    integer(step.inputsApplied, 0, 1, "Rust applied-input count");
    if (!identityDoesNotRegress(before, step.identity)
      || step.identity.tick !== before.tick + step.fixedSteps
      || !rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), step.identity)) {
      fail("step-identity", "Rust step identity is not the exact monotonic service identity");
    }
    if (step.inputsApplied === 0) {
      if (step.actionReceipts.length !== 0) fail("step-receipts", "Rust returned actions without applying the pending input");
      if (step.identity.tick >= pending.frame.targetTick) {
        fail("step-pending", "Rust advanced through a pending input target without applying it");
      }
      return null;
    }
    if (step.fixedSteps === 0 || step.identity.tick < pending.frame.targetTick) {
      fail("step-applied", "Rust applied an input before its authoritative fixed step");
    }
    if (step.actionReceipts.length !== pending.expectedActions.length) {
      fail("step-receipts", "Rust action receipts do not match the predicted rising edges");
    }
    let flags = this.authoritativeFlags;
    let actionSequence = this.nextActionSequence;
    for (let index = 0; index < pending.expectedActions.length; index += 1) {
      const expected = pending.expectedActions[index];
      const receipt = step.actionReceipts[index];
      if (receipt.kind !== expected.kind
        || receipt.sequence !== actionSequence
        || receipt.inputSequence !== pending.frame.sequence
        || receipt.tick !== pending.frame.targetTick
        || receipt.selectedSlot !== pending.frame.selectedSlot) {
        fail("step-receipts", "Rust action receipt order or authoritative cursor is inconsistent");
      }
      flags = validateFlagTransition(flags, receipt);
      actionSequence = integer(actionSequence + 1, 1, U64_SAFE_MAX, "next action sequence");
    }
    return Object.freeze({ pending, authoritativeFlags: flags, nextActionSequence: actionSequence });
  }

  private validateContextReceipts(pending: PendingInputR5, step: RustLiveRuntimeStepResultR5) {
    const receipts = step.type === "runtime-step-result-v2" ? step.semanticReceipts : Object.freeze([]);
    const due = pending.contextCommands.filter((command) => command.targetTick <= step.identity.tick);
    if (receipts.length !== due.length) {
      fail("context-command-receipts", "Rust omitted, duplicated, or added a semantic command receipt");
    }
    if (due.length === 0) return false;
    if (step.type !== "runtime-step-result-v2") {
      fail("context-command-response", "Rust crossed a context command target without a schema-6 response");
    }
    for (let index = 0; index < due.length; index += 1) {
      const command = due[index];
      const receipt = receipts[index];
      if (receipt.commandSequence !== command.sequence
        || receipt.targetTick !== command.targetTick
        || receipt.commandHash !== command.commandHash
        || receipt.resolution.kind !== command.action.kind
        || receipt.appliedTick < command.targetTick
        || receipt.appliedTick > step.identity.tick) {
        fail("context-command-receipts", "Rust semantic receipt does not bind the exact due command");
      }
      let expectedHash: string;
      try {
        expectedHash = rustIntegratedRuntimeSemanticActionReceiptHashV2(receipt, step.identity, step.replayHash);
      } catch (error) {
        fail("context-command-receipts", `Rust semantic receipt is malformed: ${errorText(error)}`);
      }
      if (expectedHash !== receipt.receiptHash) {
        fail("context-command-receipts", "Rust semantic receipt hash does not bind the post-step replay state");
      }
    }
    return true;
  }

  private commitContextCommands(pending: PendingInputR5) {
    if (pending.contextIntentCount !== pending.contextCommands.length || pending.contextIntentCount < 1) {
      fail("context-command-commit", "semantic command commit count is inconsistent");
    }
    if (this.contextCommandIntents.length < pending.contextIntentCount) {
      fail("context-command-commit", "semantic command queue changed while commands were pending");
    }
    const last = pending.contextCommands[pending.contextCommands.length - 1];
    this.contextCommandIntents.splice(0, pending.contextIntentCount);
    this.nextContextCommandSequence = integer(last.sequence + 1, 1, U64_SAFE_MAX, "next context command sequence");
  }

  private commitAppliedInput(staged: StagedAppliedInputR5) {
    for (const transition of staged.pending.consumedTransitions) {
      const queue = this.actionTransitions.get(transition.bit)!;
      if (queue[0] !== transition.value) fail("input-transition", "latched action transition changed while input was pending");
      queue.shift();
    }
    this.lastAppliedButtons = staged.pending.frame.buttons;
    this.selectedSlot = staged.pending.frame.selectedSlot;
    this.authoritativeFlags = staged.authoritativeFlags;
    this.nextActionSequence = staged.nextActionSequence;
    this.nextInputSequence = integer(staged.pending.frame.sequence + 1, 1, U64_SAFE_MAX, "next input sequence");
    this.appliedInputs += 1;
  }

  private validateExtraction(
    extraction: RustIntegratedRuntimeExtractionV1,
    identity: RustIntegratedRuntimeIdentityV1,
    authorityChanged: boolean,
  ) {
    if (!rustIntegratedRuntimeIdentityEqualsV1(extraction.identity, identity)
      || !rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), identity)) {
      fail("extraction-identity", "Rust extraction does not match the exact stepped authority identity");
    }
    integer(extraction.extractionRevision, 0, U64_SAFE_MAX, "Rust extraction revision");
    if (extraction.extractionRevision < this.lastExtractionRevision) {
      fail("extraction-revision", "Rust extraction revision regressed");
    }
    if (authorityChanged && extraction.extractionRevision <= this.lastExtractionRevision) {
      fail("extraction-revision", "changed Rust authority did not advance extraction revision");
    }
    if (extraction.extractionRevision === this.lastExtractionRevision
      && this.lastExtractionHash !== null
      && extraction.extractionHash !== this.lastExtractionHash) {
      fail("extraction-revision", "repeated Rust extraction revision changed its hash");
    }
  }

  private decodeCamera(
    extraction: RustIntegratedRuntimeExtractionV1,
    view: RustIntegratedRuntimeExtractionViewV1,
  ) {
    const externalEntityId = this.serviceExternalEntityId();
    return decodeRustLiveCameraViewR10(extraction, externalEntityId, view);
  }

  private serviceExternalEntityId() {
    const value = this.playerExternalEntityId;
    if (!value) fail("camera-binding", "live input pump has no authoritative external player identity");
    return value;
  }

  private commitExtraction(
    extraction: RustIntegratedRuntimeExtractionV1,
    view: RustIntegratedRuntimeExtractionViewV1 | null,
    camera: RustLiveCameraViewR10 | null,
  ) {
    this.lastExtractionRevision = extraction.extractionRevision;
    this.lastExtractionHash = extraction.extractionHash;
    if (view !== null) this.lastView = view;
    if (camera !== null) this.camera = camera;
  }

  private validateQueuedView(requested: RustIntegratedRuntimeExtractionViewV1) {
    const reference = this.scheduledView ?? this.lastView;
    if (reference !== null && requested.viewRevision < reference.viewRevision) {
      fail("view-revision-regression", "camera view revision regressed");
    }
    if (reference !== null && requested.viewRevision === reference.viewRevision && !sameView(reference, requested)) {
      fail("view-revision-conflict", "camera view revision was reused for different viewport dimensions");
    }
  }

  private reserveView(requested: RustIntegratedRuntimeExtractionViewV1) {
    this.validateQueuedView(requested);
    if (this.scheduledView === null || requested.viewRevision > this.scheduledView.viewRevision) {
      this.scheduledView = requested;
    }
  }

  private validateCurrentView(requested: RustIntegratedRuntimeExtractionViewV1) {
    if (this.lastView !== null && requested.viewRevision < this.lastView.viewRevision) {
      fail("view-revision-regression", "camera view revision regressed");
    }
    if (this.lastView !== null && requested.viewRevision === this.lastView.viewRevision && !sameView(this.lastView, requested)) {
      fail("view-revision-conflict", "camera view revision was reused for different viewport dimensions");
    }
  }

  private enqueueOperation<T>(run: () => Promise<T>) {
    const operation = this.tail.then(run);
    this.tail = operation.then(
      () => undefined,
      (error) => { if (this.stateValue === "ready") this.failClosed(error); },
    );
    return operation;
  }

  private nextMonotonicTime() {
    const candidate = integer(Math.floor(finite(this.nowUs(), "monotonic clock")), 0, U64_SAFE_MAX,
      "monotonic clock");
    return integer(Math.max(candidate, this.lastMonotonicTimeUs + 1), 1, U64_SAFE_MAX,
      "next monotonic time");
  }

  private requireGeneration(value: number) {
    integer(value, 0, U64_SAFE_MAX, "world generation");
    if (value < this.worldGeneration) fail("stale-generation", "stale live input world generation");
    if (value > this.worldGeneration) fail("future-generation", "future live input world generation");
  }

  private continuationIsLive(worldGeneration: number, lifecycle: number) {
    return worldGeneration === this.worldGeneration && lifecycle === this.lifecycle && this.stateValue === "ready";
  }

  private requireReady() {
    if (this.stateValue !== "ready") fail("pump-state", `live input pump is ${this.stateValue}`);
  }

  private discarded(): RustLiveInputPumpAdvanceResultR5 {
    this.discardedContinuations += 1;
    return Object.freeze({ discarded: true, step: null, extraction: null });
  }

  private discardedView(): RustLiveInputPumpViewResultR5 {
    this.discardedContinuations += 1;
    return Object.freeze({ discarded: true, extraction: null, cause: null, camera: null });
  }

  private discardedCamera(): RustLiveInputPumpCameraConfigResultR10 {
    this.discardedContinuations += 1;
    return Object.freeze({ discarded: true, changed: false, receipt: null, extraction: null, camera: null });
  }

  private failClosed(error: unknown) {
    if (this.stateValue !== "ready") return;
    this.stateValue = "failed";
    this.lifecycle += 1;
    this.lastError = errorText(error);
    this.pendingInput = null;
    this.contextCommandIntents.length = 0;
    for (const queue of this.actionTransitions.values()) queue.length = 0;
  }
}

export function createRustLiveInputPumpR5(options: RustLiveInputPumpOptionsR5) {
  return new RustLiveInputPumpR5(options);
}
