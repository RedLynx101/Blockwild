import {
  RUST_INTEGRATED_RUNTIME_FIXED_STEP_US,
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
  rustIntegratedRuntimeWireChecksumV1,
  sealRustIntegratedRuntimeContextCommandV2,
} from "./rust-integrated-runtime-codec.ts";
import type {
  RustIntegratedPlayerBootstrapStatusReceiptV1,
  RustIntegratedPlayerRuntimeContinuityV1,
} from "./rust-integrated-runtime-player-status.ts";
import type { RustIntegratedRuntimeContextContinuityV2 } from "./rust-integrated-runtime-context-continuity-v2.ts";
import {
  RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1,
  encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1,
  queryRustIntegratedRuntimeBasicDirtActionReceiptV1,
  type RustIntegratedRuntimeBasicDirtActionProjectionV1,
} from "./rust-integrated-runtime-basic-dirt-action.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_V2,
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1,
  encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1,
  encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2,
  queryRustIntegratedRuntimeNativeBlockEditReceiptV1,
  queryRustIntegratedRuntimeNativeBlockEditReceiptV2,
  type RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2,
  type RustIntegratedRuntimeNativeBlockEditReceiptV1,
} from "./rust-integrated-runtime-native-block-edit.ts";
import {
  RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1,
  encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1,
  queryRustIntegratedRuntimeDropPickupReceiptV1,
  type RustIntegratedRuntimeDropPickupProjectionV1,
} from "./rust-integrated-runtime-drop-pickup.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1,
  encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1,
  queryRustIntegratedRuntimeNativePlayerDropReceiptV1,
  type RustIntegratedRuntimeNativePlayerDropProjectionV1,
} from "./rust-integrated-runtime-player-drop.ts";
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
import {
  decodeRustIntegratedPlayerLocatorItemConsumeV1,
  encodeRustIntegratedPlayerLocatorItemConsumeV1,
  planRustLiveLocatorItemConsumeV1,
  rehydrateRustLiveLocatorItemConsumePlanV1,
  rustIntegratedContainerViewKeyV1,
  rustLiveLocatorItemConsumePlanRecordV1,
  validateRustLiveLocatorItemConsumeAfterCommandV1,
  validateRustLiveLocatorItemConsumeReceiptV1,
  type RustIntegratedPlayerLocatorItemConsumeV1,
  type RustLiveLocatorItemConsumePlanV1,
  type RustLiveLocatorItemConsumeValidatedReceiptV1,
} from "./rust-integrated-runtime-player-locator-consume.ts";
import {
  decodeRustIntegratedPlayerCreativeSlotSetV1,
  encodeRustIntegratedPlayerCreativeSlotSetV1,
  planRustLiveCreativeSlotSetV1,
  validateRustLiveCreativeSlotSetAfterCommandV1,
  validateRustLiveCreativeSlotSetReceiptV1,
  type RustIntegratedPlayerCreativeSlotSetV1,
  type RustLiveCreativeSlotSetPlanV1,
  type RustLiveCreativeSlotSetValidatedReceiptV1,
} from "./rust-integrated-runtime-player-creative-slot.ts";
import {
  planRustLivePlayerRespawnV1,
  rehydrateRustLivePlayerRespawnPlanV1,
  rustIntegratedPlayerRespawnParentAttestsReceiptV1,
  rustLivePlayerRespawnPlanRecordV1,
  validateRustLivePlayerRespawnAfterCommandV1,
  validateRustLivePlayerRespawnReceiptV1,
  type RustIntegratedFixedWorldVec3V1,
  type RustIntegratedPlayerRespawnV1,
  type RustLivePlayerRespawnPlanV1,
  type RustLivePlayerRespawnReadbackV1,
  type RustLivePlayerRespawnValidatedReceiptV1,
} from "./rust-integrated-runtime-player-respawn.ts";
import {
  decodeRustLivePlayerViewR10,
  type RustLivePlayerDeathRespawnR10,
  type RustLivePlayerViewR10,
} from "./rust-live-player-view-r10.ts";

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
  /** Lookup-only exact command recovery after a durable browser plan outlives dispatch acknowledgement. */
  recoverCommand?(batch: RustIntegratedRuntimeCommandBatchV1): Promise<RustIntegratedRuntimeCommandReceiptV1>;
  /** Read-only artifact capability observation; the concrete integrated service already exposes this. */
  diagnostics?(): Readonly<{ capabilities: readonly string[] }>;
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
  /** Exact nonmutating BWO6 observation composed with BWO5 at activation. */
  contextContinuity?: RustIntegratedRuntimeContextContinuityV2;
  /**
   * Explicit browser projection cursor. A number (including zero) is a tracked
   * current-save cursor; null is a legacy/untracked restore that seeds to the
   * native latest cursor without replay. Absence keeps compatibility callers
   * outside this receipt lane until their save schema is wired.
   */
  initialBasicDirtActionCursor?: number | null;
  /** Generic R4 block-edit custody. When configured it supersedes the Basic Dirt query lane. */
  initialNativeBlockEditCursor?: number | null;
  /** Same tracked-versus-legacy custody rule as the Basic Dirt receipt lane. */
  initialDropPickupCursor?: number | null;
  /** Same tracked-versus-legacy custody rule as the other native receipt lanes. */
  initialNativePlayerDropCursor?: number | null;
  /** Full false-policy parent cursor. Null seeds to the newest native parent without replay. */
  initialNativeDeathRespawnCursor?: number | null;
}>;

export type RustLiveInputPumpAdvanceOptionsR5 = Readonly<{
  initialSync?: boolean;
  view?: RustIntegratedRuntimeExtractionViewV1;
}>;

export type RustLiveInputPumpExtractionCauseR5 = "initial" | "authority" | "viewport" | "camera-config" | "player-respawn";

export type RustLiveInputPumpAdvanceResultR5 = Readonly<{
  discarded: boolean;
  step: RustLiveRuntimeStepResultR5 | null;
  extraction: RustIntegratedRuntimeExtractionV1 | null;
  cause?: RustLiveInputPumpExtractionCauseR5 | null;
  camera?: RustLiveCameraViewR10 | null;
  nativeBlockEdit?: RustLiveInputPumpNativeBlockEditDeliveryV1 | null;
  basicDirtAction?: RustLiveInputPumpBasicDirtActionDeliveryV1 | null;
  dropPickup?: RustLiveInputPumpDropPickupDeliveryV1 | null;
  playerDrop?: RustLiveInputPumpPlayerDropDeliveryV1 | null;
  deathRespawn?: RustLiveInputPumpDeathRespawnDeliveryV1 | null;
}>;

export type RustLiveInputPumpNativeBlockEditDeliveryV1 = Readonly<{
  protocolVersion: 1 | 2;
  legacyFallback: "v1-capability" | "v2-pre-v14" | null;
  worldGeneration: number;
  queryIdentity: RustIntegratedRuntimeIdentityV1;
  cursorBefore: number;
  cursorAfter: number;
  requestPayloadHash: string;
  projectionPayloadHash: string;
  receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1;
  dirty: RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2 | null;
}>;

export type RustLiveInputPumpBasicDirtActionDeliveryV1 = Readonly<{
  worldGeneration: number;
  queryIdentity: RustIntegratedRuntimeIdentityV1;
  cursorBefore: number;
  cursorAfter: number;
  requestPayloadHash: string;
  projectionPayloadHash: string;
  receipt: RustIntegratedRuntimeBasicDirtActionProjectionV1;
}>;

export type RustLiveInputPumpDropPickupDeliveryV1 = Readonly<{
  worldGeneration: number;
  queryIdentity: RustIntegratedRuntimeIdentityV1;
  cursorBefore: number;
  cursorAfter: number;
  requestPayloadHash: string;
  projectionPayloadHash: string;
  receipt: RustIntegratedRuntimeDropPickupProjectionV1;
}>;

export type RustLiveInputPumpPlayerDropDeliveryV1 = Readonly<{
  worldGeneration: number;
  queryIdentity: RustIntegratedRuntimeIdentityV1;
  cursorBefore: number;
  cursorAfter: number;
  requestPayloadHash: string;
  projectionPayloadHash: string;
  receipt: RustIntegratedRuntimeNativePlayerDropProjectionV1;
}>;

export type RustLiveInputPumpDeathRespawnDeliveryV1 = Readonly<{
  worldGeneration: number;
  queryIdentity: RustIntegratedRuntimeIdentityV1;
  cursorBefore: number;
  cursorAfter: number;
  parent: RustLivePlayerDeathRespawnR10;
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

export type RustLiveInputPumpLocatorItemConsumeResultV1 = Readonly<{
  discarded: boolean;
  plan: RustLiveLocatorItemConsumePlanV1 | null;
  receipt: RustIntegratedRuntimeCommandReceiptV1 | null;
  validated: RustLiveLocatorItemConsumeValidatedReceiptV1 | null;
  extraction: RustIntegratedRuntimeExtractionV1 | null;
  player: RustLivePlayerViewR10 | null;
}>;

export type RustLiveInputPumpLocatorItemConsumeOptionsV1 = Readonly<{
  /** Must durably persist the exact plan. Rejection prevents native dispatch and fails the pump closed. */
  beforeDispatch?: (plan: RustLiveLocatorItemConsumePlanV1) => Promise<void>;
}>;

export type RustLiveInputPumpCreativeSlotSetResultV1 = Readonly<{
  discarded: boolean;
  plan: RustLiveCreativeSlotSetPlanV1 | null;
  receipt: RustIntegratedRuntimeCommandReceiptV1 | null;
  validated: RustLiveCreativeSlotSetValidatedReceiptV1 | null;
  extraction: RustIntegratedRuntimeExtractionV1 | null;
  player: RustLivePlayerViewR10 | null;
}>;

export type RustLiveInputPumpPlayerRespawnOptionsV1 = Readonly<{
  /** Must durably retain the exact canonical BWD7 plan before native dispatch. */
  beforeDispatch?: (plan: RustLivePlayerRespawnPlanV1) => Promise<void>;
}>;

export type RustLiveInputPumpPlayerRespawnResultV1 = Readonly<{
  discarded: boolean;
  plan: RustLivePlayerRespawnPlanV1 | null;
  receipt: RustIntegratedRuntimeCommandReceiptV1 | null;
  validated: RustLivePlayerRespawnValidatedReceiptV1 | null;
  extraction: RustIntegratedRuntimeExtractionV1 | null;
  player: RustLivePlayerViewR10 | null;
  camera: RustLiveCameraViewR10 | null;
  view: RustIntegratedRuntimeExtractionViewV1 | null;
  deathRespawn: RustLiveInputPumpDeathRespawnDeliveryV1 | null;
}>;

export type RustLiveInputPumpNativeCheckpointResultV1<T> = Readonly<{
  discarded: boolean;
  value: T | null;
  before: RustIntegratedRuntimeIdentityV1 | null;
  after: RustIntegratedRuntimeIdentityV1 | null;
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
  lastActionReceipt: RustIntegratedRuntimeInputActionReceiptV1 | null;
  nextContextCommandSequence: number | null;
  queuedContextCommands: number;
  lastMonotonicTimeUs: number;
  lastExtractionRevision: number;
  lastAuthorityTick: number;
  lastNetworkRevision: number;
  networkIdentityAdoptions: number;
  lastAppliedMoveX: number;
  lastAppliedMoveZ: number;
  lastAppliedButtons: number;
  selectedSlot: number;
  authoritativeFlags: number;
  latchedActionTransitions: number;
  samples: number;
  stepCalls: number;
  extractionCalls: number;
  commandCalls: number;
  creativeSlotSetCalls: number;
  viewExtractionCalls: number;
  lastView: RustIntegratedRuntimeExtractionViewV1 | null;
  cameraRevision: bigint | null;
  appliedInputs: number;
  discardedContinuations: number;
  nativeBlockEditQueryConfigured: boolean;
  nativeBlockEditProtocolVersion: 1 | 2;
  nativeBlockEditCursor: number | null;
  nativeBlockEditLegacySeedPending: boolean;
  nativeBlockEditQueryCalls: number;
  pendingNativeBlockEditSequence: number | null;
  pendingNativeBlockEditReceiptHash: string | null;
  pendingNativeBlockEditIdentityHash: string | null;
  pendingNativeBlockEditDirtyEvidenceHash: string | null;
  pendingNativeBlockEditLegacyFallback: "v1-capability" | "v2-pre-v14" | null;
  lastAcknowledgedNativeBlockEditSequence: number | null;
  lastAcknowledgedNativeBlockEditReceiptHash: string | null;
  basicDirtActionQueryConfigured: boolean;
  basicDirtActionQuerySuppressedByNativeBlockEdit: boolean;
  basicDirtActionCursor: number | null;
  basicDirtActionLegacySeedPending: boolean;
  basicDirtActionQueryCalls: number;
  pendingBasicDirtActionSequence: number | null;
  pendingBasicDirtActionReceiptHash: string | null;
  pendingBasicDirtActionIdentityHash: string | null;
  lastAcknowledgedBasicDirtActionSequence: number | null;
  lastAcknowledgedBasicDirtActionReceiptHash: string | null;
  dropPickupQueryConfigured: boolean;
  dropPickupCursor: number | null;
  dropPickupLegacySeedPending: boolean;
  dropPickupQueryCalls: number;
  pendingDropPickupSequence: number | null;
  pendingDropPickupReceiptHash: string | null;
  pendingDropPickupIdentityHash: string | null;
  lastAcknowledgedDropPickupSequence: number | null;
  lastAcknowledgedDropPickupReceiptHash: string | null;
  playerDropQueryConfigured: boolean;
  playerDropCursor: number | null;
  playerDropLegacySeedPending: boolean;
  playerDropQueryCalls: number;
  pendingPlayerDropSequence: number | null;
  pendingPlayerDropReceiptHash: string | null;
  pendingPlayerDropIdentityHash: string | null;
  lastAcknowledgedPlayerDropSequence: number | null;
  lastAcknowledgedPlayerDropReceiptHash: string | null;
  deathRespawnQueryConfigured: boolean;
  deathRespawnCursor: number | null;
  deathRespawnLegacySeedPending: boolean;
  pendingDeathRespawnSequence: number | null;
  pendingDeathRespawnReceiptHash: string | null;
  pendingDeathRespawnIdentityHash: string | null;
  lastAcknowledgedDeathRespawnSequence: number | null;
  lastAcknowledgedDeathRespawnReceiptHash: string | null;
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
  lastActionReceipt: RustIntegratedRuntimeInputActionReceiptV1 | null;
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

function exactEpochMicroseconds(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const microseconds = Math.floor(milliseconds * 1_000);
  return Number.isSafeInteger(microseconds) && microseconds <= U64_SAFE_MAX
    ? microseconds
    : null;
}

function defaultNowUs() {
  if (typeof performance !== "undefined") {
    try {
      const performanceMicroseconds = exactEpochMicroseconds(
        performance.timeOrigin + performance.now(),
      );
      if (performanceMicroseconds !== null) return performanceMicroseconds;
    } catch { /* Fall through to the epoch clock when Performance is unavailable or hostile. */ }
  }
  // Date.now is reload-stable and remains exactly representable in integer
  // microseconds for contemporary browser epochs. If neither epoch source is
  // exact, fail closed: zero would make restored continuity crawl by +1 us.
  const dateMicroseconds = exactEpochMicroseconds(Date.now());
  if (dateMicroseconds !== null) return dateMicroseconds;
  fail("monotonic-clock-unavailable", "browser epoch clocks cannot provide one exact safe microsecond timestamp");
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

function identityMatchesHydratedLocatorReceipt(
  receiptAfter: RustIntegratedRuntimeIdentityV1,
  current: RustIntegratedRuntimeIdentityV1,
) {
  if (receiptAfter.universeId !== current.universeId
    || receiptAfter.locationId !== current.locationId
    || receiptAfter.tick !== current.tick
    || receiptAfter.revision.epoch !== current.revision.epoch
    || receiptAfter.revision.world !== current.revision.world
    || receiptAfter.revision.entities !== current.revision.entities
    || receiptAfter.revision.gameplay !== current.revision.gameplay
    || receiptAfter.revision.network !== current.revision.network
    || receiptAfter.revision.simulation !== current.revision.simulation
    ) {
    return false;
  }
  return rustIntegratedRuntimeIdentityEqualsV1(current, receiptAfter)
    || current.stateHash !== receiptAfter.stateHash;
}

function identityIsExactNativePersistenceSuccessor(
  before: RustIntegratedRuntimeIdentityV1,
  after: RustIntegratedRuntimeIdentityV1,
) {
  return before.universeId === after.universeId
    && before.locationId === after.locationId
    && before.tick === after.tick
    && before.revision.epoch === after.revision.epoch
    && before.revision.world === after.revision.world
    && before.revision.entities === after.revision.entities
    && before.revision.gameplay === after.revision.gameplay
    && before.revision.network === after.revision.network
    && before.revision.simulation === after.revision.simulation
    && after.revision.persistence > before.revision.persistence
    && after.stateHash !== before.stateHash;
}

function identityIsExactExternalNetworkSuccessor(
  before: RustIntegratedRuntimeIdentityV1,
  after: RustIntegratedRuntimeIdentityV1,
) {
  return before.universeId === after.universeId
    && before.locationId === after.locationId
    && before.tick === after.tick
    && before.revision.epoch === after.revision.epoch
    && before.revision.world === after.revision.world
    && before.revision.entities === after.revision.entities
    && before.revision.gameplay === after.revision.gameplay
    && before.revision.persistence === after.revision.persistence
    && before.revision.simulation === after.revision.simulation
    && after.revision.network > before.revision.network
    && after.stateHash !== before.stateHash;
}

function frozenIdentity(value: RustIntegratedRuntimeIdentityV1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({ ...value, revision: Object.freeze({ ...value.revision }) });
}

function exactFixedMilli(value: number, label: string) {
  finite(value, label);
  const scaled = value * 1_000;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-6) {
    fail("player-respawn-readback", `${label} is not an exact native milli-unit value`);
  }
  return rounded;
}

function exactFixedVector(
  value: Readonly<{ x: number; y: number; z: number }>,
  label: string,
): RustIntegratedFixedWorldVec3V1 {
  return Object.freeze({
    xMilli: exactFixedMilli(value.x, `${label} x`),
    yMilli: exactFixedMilli(value.y, `${label} y`),
    zMilli: exactFixedMilli(value.z, `${label} z`),
  });
}

function invariantRespawnNeutral(moveX: number, moveZ: number, buttons: number) {
  if (moveX !== 0 || moveZ !== 0 || buttons !== 0) {
    fail("player-respawn-input", "committed player respawn neutral input retained movement or buttons");
  }
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
    lastAppliedMoveX: continuity.lastAppliedInput?.moveX ?? 0,
    lastAppliedMoveZ: continuity.lastAppliedInput?.moveZ ?? 0,
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
  private readonly playerActorId: string | null;
  private readonly playerInventoryViewKey: string | null;
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
  private lastAppliedMoveX = 0;
  private lastAppliedMoveZ = 0;
  private lastAppliedButtons: number;
  private selectedSlot: number;
  private authoritativeFlags: number;
  private nextInputSequence: number;
  private nextActionSequence: number;
  private lastActionReceipt: RustIntegratedRuntimeInputActionReceiptV1 | null = null;
  private nextContextCommandSequence: number | null;
  private readonly contextContinuityConfigured: boolean;
  private readonly nativeBlockEditQueryConfigured: boolean;
  private readonly nativeBlockEditProtocolVersion: 1 | 2;
  private readonly basicDirtActionQueryConfigured: boolean;
  private readonly dropPickupQueryConfigured: boolean;
  private readonly playerDropQueryConfigured: boolean;
  private readonly deathRespawnQueryConfigured: boolean;
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
  private creativeSlotSetCalls = 0;
  private viewExtractionCalls = 0;
  private appliedInputs = 0;
  private networkIdentityAdoptions = 0;
  private discardedContinuations = 0;
  private nativeBlockEditCursor: number | null = null;
  private nativeBlockEditLegacySeedPending = false;
  private nativeBlockEditQueryCalls = 0;
  private pendingNativeBlockEdit: RustLiveInputPumpNativeBlockEditDeliveryV1 | null = null;
  private lastAcknowledgedNativeBlockEdit: RustLiveInputPumpNativeBlockEditDeliveryV1 | null = null;
  private basicDirtActionCursor: number | null = null;
  private basicDirtActionLegacySeedPending = false;
  private basicDirtActionQueryCalls = 0;
  private pendingBasicDirtAction: RustLiveInputPumpBasicDirtActionDeliveryV1 | null = null;
  private lastAcknowledgedBasicDirtAction: RustLiveInputPumpBasicDirtActionDeliveryV1 | null = null;
  private dropPickupCursor: number | null = null;
  private dropPickupLegacySeedPending = false;
  private dropPickupQueryCalls = 0;
  private pendingDropPickup: RustLiveInputPumpDropPickupDeliveryV1 | null = null;
  private lastAcknowledgedDropPickup: RustLiveInputPumpDropPickupDeliveryV1 | null = null;
  private playerDropCursor: number | null = null;
  private playerDropLegacySeedPending = false;
  private playerDropQueryCalls = 0;
  private pendingPlayerDrop: RustLiveInputPumpPlayerDropDeliveryV1 | null = null;
  private lastAcknowledgedPlayerDrop: RustLiveInputPumpPlayerDropDeliveryV1 | null = null;
  private deathRespawnCursor: number | null = null;
  private deathRespawnLegacySeedPending = false;
  private pendingDeathRespawn: RustLiveInputPumpDeathRespawnDeliveryV1 | null = null;
  private lastAcknowledgedDeathRespawn: RustLiveInputPumpDeathRespawnDeliveryV1 | null = null;

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
    this.playerActorId = options.status.worldViewBinding?.actorId ?? null;
    this.playerInventoryViewKey = options.status.worldViewBinding === null
      ? null
      : rustIntegratedContainerViewKeyV1(options.status.worldViewBinding.inventoryContainer);
    const identity = frozenIdentity(this.service.identity());
    const continuity = validateContinuity(options.status, identity);
    this.lastIdentity = identity;
    this.nextInputSequence = continuity.nextInputSequence;
    this.nextActionSequence = continuity.nextActionSequence;
    const contextContinuity = options.contextContinuity;
    this.contextContinuityConfigured = contextContinuity !== undefined
      || options.nextContextCommandSequence !== undefined;
    if (contextContinuity && (!rustIntegratedRuntimeIdentityEqualsV1(contextContinuity.identity, identity)
      || !contextContinuity.queuedCommandsEmpty)) {
      fail("context-command-continuity", "BWO6 context continuity does not attest the exact idle runtime identity");
    }
    const observedContextSequence = contextContinuity
      ? contextContinuity.nextSequence
      : options.nextContextCommandSequence ?? null;
    if (contextContinuity && options.nextContextCommandSequence !== undefined
      && options.nextContextCommandSequence !== contextContinuity.nextSequence) {
      fail("context-command-continuity", "manual context cursor contradicts the BWO6 observation");
    }
    this.nextContextCommandSequence = observedContextSequence === null
      ? null
      : integer(observedContextSequence, 1, U64_SAFE_MAX, "next context command sequence");
    this.nativeBlockEditQueryConfigured = options.initialNativeBlockEditCursor !== undefined;
    this.nativeBlockEditProtocolVersion = this.service.diagnostics?.().capabilities
      .includes(RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_CAPABILITY_V2) ? 2 : 1;
    if (this.nativeBlockEditQueryConfigured && !this.service.command) {
      fail("native-block-edit-service", "Rust runtime does not expose the read-only native block-edit receipt query");
    }
    this.nativeBlockEditLegacySeedPending = options.initialNativeBlockEditCursor === null;
    this.nativeBlockEditCursor = typeof options.initialNativeBlockEditCursor === "number"
      ? integer(options.initialNativeBlockEditCursor, 0, U64_SAFE_MAX, "initial native block-edit cursor")
      : null;
    this.basicDirtActionQueryConfigured = options.initialBasicDirtActionCursor !== undefined;
    if (this.basicDirtActionQueryConfigured && !this.service.command) {
      fail("basic-dirt-action-service", "Rust runtime does not expose the read-only basic Dirt receipt query");
    }
    this.basicDirtActionLegacySeedPending = options.initialBasicDirtActionCursor === null;
    this.basicDirtActionCursor = typeof options.initialBasicDirtActionCursor === "number"
      ? integer(options.initialBasicDirtActionCursor, 0, U64_SAFE_MAX, "initial basic Dirt action cursor")
      : null;
    this.dropPickupQueryConfigured = options.initialDropPickupCursor !== undefined;
    if (this.dropPickupQueryConfigured && !this.service.command) {
      fail("drop-pickup-service", "Rust runtime does not expose the read-only native drop-pickup receipt query");
    }
    this.dropPickupLegacySeedPending = options.initialDropPickupCursor === null;
    this.dropPickupCursor = typeof options.initialDropPickupCursor === "number"
      ? integer(options.initialDropPickupCursor, 0, U64_SAFE_MAX, "initial native drop-pickup cursor")
      : null;
    this.playerDropQueryConfigured = options.initialNativePlayerDropCursor !== undefined;
    if (this.playerDropQueryConfigured && !this.service.command) {
      fail("player-drop-service", "Rust runtime does not expose the read-only native player-drop receipt query");
    }
    this.playerDropLegacySeedPending = options.initialNativePlayerDropCursor === null;
    this.playerDropCursor = typeof options.initialNativePlayerDropCursor === "number"
      ? integer(options.initialNativePlayerDropCursor, 0, U64_SAFE_MAX, "initial native player-drop cursor")
      : null;
    this.deathRespawnQueryConfigured = options.initialNativeDeathRespawnCursor !== undefined;
    if (this.deathRespawnQueryConfigured && this.playerExternalEntityId === null) {
      fail("death-respawn-binding", "tracked native death-respawn projection requires an external player identity");
    }
    this.deathRespawnLegacySeedPending = options.initialNativeDeathRespawnCursor === null;
    this.deathRespawnCursor = typeof options.initialNativeDeathRespawnCursor === "number"
      ? integer(options.initialNativeDeathRespawnCursor, 0, U64_SAFE_MAX, "initial native death-respawn cursor")
      : null;
    this.lastMonotonicTimeUs = continuity.lastMonotonicTimeUs;
    this.lastAppliedMoveX = continuity.lastAppliedMoveX;
    this.lastAppliedMoveZ = continuity.lastAppliedMoveZ;
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
      fail("context-command-continuity", this.contextContinuityConfigured
        ? "Rust context command sequence is exhausted"
        : "Rust status does not attest the next context command sequence");
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

  /**
   * Adopts the one identity axis that Rust multiplayer legitimately advances
   * outside the player pump. The caller must hold the integrated multiplayer
   * authority's exclusive queue until its following pump operation settles;
   * otherwise another network mutation could land between this CAS and step.
   */
  adoptExternalNetworkSuccessor(worldGeneration: number) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    const lifecycle = this.lifecycle;
    return this.enqueueOperation(async () => {
      if (!this.continuationIsLive(worldGeneration, lifecycle)) {
        this.discardedContinuations += 1;
        return false;
      }
      const before = this.lastIdentity;
      const after = frozenIdentity(this.service.identity());
      if (rustIntegratedRuntimeIdentityEqualsV1(before, after)) return false;
      if (this.pendingNativeBlockEdit !== null
        || this.pendingBasicDirtAction !== null
        || this.pendingDropPickup !== null
        || this.pendingPlayerDrop !== null
        || this.pendingDeathRespawn !== null) {
        fail("identity-drift", "Rust network identity advanced while a durable player receipt awaited projection");
      }
      if (!identityIsExactExternalNetworkSuccessor(before, after)) {
        fail("identity-drift", "Rust runtime identity moved outside the live input pump on a non-network axis");
      }
      this.lastIdentity = after;
      this.networkIdentityAdoptions += 1;
      return true;
    });
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

  /**
   * Advances generic native block-edit projection custody only after the exact
   * BWY7 receipt has been projected and durably checkpointed by the caller.
   */
  acknowledgeNativeBlockEdit(
    worldGeneration: number,
    delivery: RustLiveInputPumpNativeBlockEditDeliveryV1,
  ) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    try {
      this.validateNativeBlockEditDelivery(delivery);
      const pending = this.pendingNativeBlockEdit;
      if (pending !== null) {
        if (!this.nativeBlockEditDeliveriesEqual(delivery, pending)) {
          fail("native-block-edit-acknowledgement", "native block-edit acknowledgement does not match the pending exact receipt");
        }
        this.nativeBlockEditCursor = pending.cursorAfter;
        this.lastAcknowledgedNativeBlockEdit = pending;
        this.pendingNativeBlockEdit = null;
        return true;
      }
      const acknowledged = this.lastAcknowledgedNativeBlockEdit;
      if (acknowledged !== null && this.nativeBlockEditDeliveriesEqual(delivery, acknowledged)) return false;
      if (acknowledged !== null && delivery.receipt.sequence === acknowledged.receipt.sequence) {
        fail("native-block-edit-acknowledgement-conflict", "native block-edit receipt sequence was acknowledged with a conflicting hash");
      }
      fail("native-block-edit-acknowledgement", "there is no matching pending native block-edit receipt");
    } catch (error) {
      this.failClosed(error);
      throw error;
    }
  }

  /**
   * Advances browser projection custody only after the exact delivered BWR7
   * receipt has been projected and durably checkpointed by the caller. The
   * first exact acknowledgement returns true; a byte-identical duplicate is
   * idempotent and returns false. Every mismatch fails the pump closed.
   */
  acknowledgeBasicDirtAction(
    worldGeneration: number,
    delivery: RustLiveInputPumpBasicDirtActionDeliveryV1,
  ) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    try {
      this.validateBasicDirtActionDelivery(delivery);
      const pending = this.pendingBasicDirtAction;
      if (pending !== null) {
        if (!this.basicDirtActionDeliveriesEqual(delivery, pending)) {
          fail("basic-dirt-action-acknowledgement", "basic Dirt acknowledgement does not match the pending exact receipt");
        }
        this.basicDirtActionCursor = pending.cursorAfter;
        this.lastAcknowledgedBasicDirtAction = pending;
        this.pendingBasicDirtAction = null;
        return true;
      }
      const acknowledged = this.lastAcknowledgedBasicDirtAction;
      if (acknowledged !== null && this.basicDirtActionDeliveriesEqual(delivery, acknowledged)) return false;
      if (acknowledged !== null && delivery.receipt.sequence === acknowledged.receipt.sequence) {
        fail("basic-dirt-action-acknowledgement-conflict", "basic Dirt receipt sequence was acknowledged with a conflicting hash");
      }
      fail("basic-dirt-action-acknowledgement", "there is no matching pending basic Dirt receipt");
    } catch (error) {
      this.failClosed(error);
      throw error;
    }
  }

  /**
   * Releases one exact BWR8 native pickup only after the browser has projected
   * and durably checkpointed its inventory/drop removal transaction.
   */
  acknowledgeDropPickup(
    worldGeneration: number,
    delivery: RustLiveInputPumpDropPickupDeliveryV1,
  ) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    try {
      this.validateDropPickupDelivery(delivery);
      const pending = this.pendingDropPickup;
      if (pending !== null) {
        if (!this.dropPickupDeliveriesEqual(delivery, pending)) {
          fail("drop-pickup-acknowledgement", "drop-pickup acknowledgement does not match the pending exact receipt");
        }
        this.dropPickupCursor = pending.cursorAfter;
        this.lastAcknowledgedDropPickup = pending;
        this.pendingDropPickup = null;
        return true;
      }
      const acknowledged = this.lastAcknowledgedDropPickup;
      if (acknowledged !== null && this.dropPickupDeliveriesEqual(delivery, acknowledged)) return false;
      if (acknowledged !== null && delivery.receipt.sequence === acknowledged.receipt.sequence) {
        fail("drop-pickup-acknowledgement-conflict", "drop-pickup receipt sequence was acknowledged with a conflicting hash");
      }
      fail("drop-pickup-acknowledgement", "there is no matching pending drop-pickup receipt");
    } catch (error) {
      this.failClosed(error);
      throw error;
    }
  }

  /**
   * Releases one exact BWS9 native player drop only after its inventory/spawn
   * transaction and browser projection cursor are durably checkpointed.
   */
  acknowledgePlayerDrop(
    worldGeneration: number,
    delivery: RustLiveInputPumpPlayerDropDeliveryV1,
  ) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    try {
      this.validatePlayerDropDelivery(delivery);
      const pending = this.pendingPlayerDrop;
      if (pending !== null) {
        if (!this.playerDropDeliveriesEqual(delivery, pending)) {
          fail("player-drop-acknowledgement", "player-drop acknowledgement does not match the pending exact receipt");
        }
        this.playerDropCursor = pending.cursorAfter;
        this.lastAcknowledgedPlayerDrop = pending;
        this.pendingPlayerDrop = null;
        return true;
      }
      const acknowledged = this.lastAcknowledgedPlayerDrop;
      if (acknowledged !== null && this.playerDropDeliveriesEqual(delivery, acknowledged)) return false;
      if (acknowledged !== null && delivery.receipt.sequence === acknowledged.receipt.sequence) {
        fail("player-drop-acknowledgement-conflict", "player-drop receipt sequence was acknowledged with a conflicting hash");
      }
      fail("player-drop-acknowledgement", "there is no matching pending player-drop receipt");
    } catch (error) {
      this.failClosed(error);
      throw error;
    }
  }

  /** Advances the persisted false-policy parent cursor only after exact projection/checkpoint. */
  acknowledgeDeathRespawn(
    worldGeneration: number,
    delivery: RustLiveInputPumpDeathRespawnDeliveryV1,
  ) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    try {
      this.validateDeathRespawnDelivery(delivery);
      const pending = this.pendingDeathRespawn;
      if (pending !== null) {
        if (!this.deathRespawnDeliveriesEqual(delivery, pending)) {
          fail("death-respawn-acknowledgement", "death-respawn acknowledgement does not match the pending exact parent");
        }
        this.deathRespawnCursor = pending.cursorAfter;
        this.lastAcknowledgedDeathRespawn = pending;
        this.pendingDeathRespawn = null;
        return true;
      }
      const acknowledged = this.lastAcknowledgedDeathRespawn;
      if (acknowledged !== null && this.deathRespawnDeliveriesEqual(delivery, acknowledged)) return false;
      if (acknowledged !== null && delivery.cursorAfter === acknowledged.cursorAfter) {
        fail("death-respawn-acknowledgement-conflict", "death-respawn parent sequence was acknowledged with a conflicting hash");
      }
      fail("death-respawn-acknowledgement", "there is no matching pending death-respawn parent");
    } catch (error) {
      this.failClosed(error);
      throw error;
    }
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

  consumeLocatorItem(
    worldGeneration: number,
    intent: RustIntegratedPlayerLocatorItemConsumeV1,
    options: RustLiveInputPumpLocatorItemConsumeOptionsV1 = {},
  ) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    const request = decodeRustIntegratedPlayerLocatorItemConsumeV1(
      encodeRustIntegratedPlayerLocatorItemConsumeV1(intent),
    );
    const lifecycle = this.lifecycle;
    return this.enqueueOperation(() => this.runNewLocatorItemConsume(
      worldGeneration,
      lifecycle,
      request,
      options.beforeDispatch,
    ));
  }

  setCreativeSlot(worldGeneration: number, intent: RustIntegratedPlayerCreativeSlotSetV1) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    const request = decodeRustIntegratedPlayerCreativeSlotSetV1(encodeRustIntegratedPlayerCreativeSlotSetV1(intent));
    const lifecycle = this.lifecycle;
    return this.enqueueOperation(() => this.runCreativeSlotSet(worldGeneration, lifecycle, request));
  }

  respawnPlayer(
    worldGeneration: number,
    intent: RustIntegratedPlayerRespawnV1,
    options: RustLiveInputPumpPlayerRespawnOptionsV1 = {},
  ) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    const lifecycle = this.lifecycle;
    return this.enqueueOperation(() => this.runNewPlayerRespawn(
      worldGeneration,
      lifecycle,
      intent,
      options.beforeDispatch,
    ));
  }

  /** Same-byte retry for a plan retained before dispatch acknowledgement. */
  retryPlayerRespawn(worldGeneration: number, durablePlan: RustLivePlayerRespawnPlanV1) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    const plan = rehydrateRustLivePlayerRespawnPlanV1(rustLivePlayerRespawnPlanRecordV1(durablePlan));
    const lifecycle = this.lifecycle;
    return this.enqueueOperation(() => this.runRetainedPlayerRespawn(worldGeneration, lifecycle, plan));
  }

  recoverLocatorItem(
    worldGeneration: number,
    durablePlan: RustLiveLocatorItemConsumePlanV1,
  ) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    const plan = rehydrateRustLiveLocatorItemConsumePlanV1(
      rustLiveLocatorItemConsumePlanRecordV1(durablePlan),
    );
    const lifecycle = this.lifecycle;
    return this.enqueueOperation(() => this.runRecoveredLocatorItemConsume(worldGeneration, lifecycle, plan));
  }

  /**
   * Runs one explicitly awaited native checkpoint behind every live input and
   * command, then adopts only its persistence-only authority successor.
   * Detached native saves are forbidden because they would move the worker
   * identity without moving this pump's serialized continuity cursor.
   */
  checkpointNativePersistence<T>(
    worldGeneration: number,
    checkpoint: () => Promise<T>,
  ) {
    this.requireGeneration(worldGeneration);
    this.requireReady();
    const lifecycle = this.lifecycle;
    return this.enqueueOperation(() => this.runNativePersistenceCheckpoint(
      worldGeneration,
      lifecycle,
      checkpoint,
    ));
  }

  async drain() {
    await this.tail;
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    if (this.stateValue === "stopped") return Promise.resolve();
    if (this.stateValue !== "failed") this.stateValue = "stopping";
    this.lifecycle += 1;
    this.pendingNativeBlockEdit = null;
    this.lastAcknowledgedNativeBlockEdit = null;
    this.pendingBasicDirtAction = null;
    this.lastAcknowledgedBasicDirtAction = null;
    this.pendingDropPickup = null;
    this.lastAcknowledgedDropPickup = null;
    this.pendingPlayerDrop = null;
    this.lastAcknowledgedPlayerDrop = null;
    this.pendingDeathRespawn = null;
    this.lastAcknowledgedDeathRespawn = null;
    this.stopPromise = (async () => {
      await this.tail;
      this.pendingInput = null;
      for (const queue of this.actionTransitions.values()) queue.length = 0;
      this.contextCommandIntents.length = 0;
      this.nativeBlockEditCursor = null;
      this.nativeBlockEditLegacySeedPending = false;
      this.basicDirtActionCursor = null;
      this.basicDirtActionLegacySeedPending = false;
      this.dropPickupCursor = null;
      this.dropPickupLegacySeedPending = false;
      this.playerDropCursor = null;
      this.playerDropLegacySeedPending = false;
      this.deathRespawnCursor = null;
      this.deathRespawnLegacySeedPending = false;
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
      lastActionReceipt: this.lastActionReceipt,
      nextContextCommandSequence: this.nextContextCommandSequence,
      queuedContextCommands: this.contextCommandIntents.length,
      lastMonotonicTimeUs: this.lastMonotonicTimeUs,
      lastExtractionRevision: this.lastExtractionRevision,
      lastAuthorityTick: this.lastIdentity.tick,
      lastNetworkRevision: this.lastIdentity.revision.network,
      networkIdentityAdoptions: this.networkIdentityAdoptions,
      lastAppliedMoveX: this.lastAppliedMoveX,
      lastAppliedMoveZ: this.lastAppliedMoveZ,
      lastAppliedButtons: this.lastAppliedButtons,
      selectedSlot: this.selectedSlot,
      authoritativeFlags: this.authoritativeFlags,
      latchedActionTransitions: transitions,
      samples: this.samples,
      stepCalls: this.stepCalls,
      extractionCalls: this.extractionCalls,
      commandCalls: this.commandCalls,
      creativeSlotSetCalls: this.creativeSlotSetCalls,
      viewExtractionCalls: this.viewExtractionCalls,
      lastView: this.lastView,
      cameraRevision: this.camera?.cameraRevision ?? null,
      appliedInputs: this.appliedInputs,
      discardedContinuations: this.discardedContinuations,
      nativeBlockEditQueryConfigured: this.nativeBlockEditQueryConfigured,
      nativeBlockEditProtocolVersion: this.nativeBlockEditProtocolVersion,
      nativeBlockEditCursor: this.nativeBlockEditCursor,
      nativeBlockEditLegacySeedPending: this.nativeBlockEditLegacySeedPending,
      nativeBlockEditQueryCalls: this.nativeBlockEditQueryCalls,
      pendingNativeBlockEditSequence: this.pendingNativeBlockEdit?.receipt.sequence ?? null,
      pendingNativeBlockEditReceiptHash: this.pendingNativeBlockEdit?.receipt.receiptHash ?? null,
      pendingNativeBlockEditIdentityHash: this.pendingNativeBlockEdit?.queryIdentity.stateHash ?? null,
      pendingNativeBlockEditDirtyEvidenceHash: this.pendingNativeBlockEdit?.dirty?.evidenceHash ?? null,
      pendingNativeBlockEditLegacyFallback: this.pendingNativeBlockEdit?.legacyFallback ?? null,
      lastAcknowledgedNativeBlockEditSequence: this.lastAcknowledgedNativeBlockEdit?.receipt.sequence ?? null,
      lastAcknowledgedNativeBlockEditReceiptHash: this.lastAcknowledgedNativeBlockEdit?.receipt.receiptHash ?? null,
      basicDirtActionQueryConfigured: this.basicDirtActionQueryConfigured,
      basicDirtActionQuerySuppressedByNativeBlockEdit:
        this.nativeBlockEditQueryConfigured && this.basicDirtActionQueryConfigured,
      basicDirtActionCursor: this.basicDirtActionCursor,
      basicDirtActionLegacySeedPending: this.basicDirtActionLegacySeedPending,
      basicDirtActionQueryCalls: this.basicDirtActionQueryCalls,
      pendingBasicDirtActionSequence: this.pendingBasicDirtAction?.receipt.sequence ?? null,
      pendingBasicDirtActionReceiptHash: this.pendingBasicDirtAction?.receipt.receiptHash ?? null,
      pendingBasicDirtActionIdentityHash: this.pendingBasicDirtAction?.queryIdentity.stateHash ?? null,
      lastAcknowledgedBasicDirtActionSequence: this.lastAcknowledgedBasicDirtAction?.receipt.sequence ?? null,
      lastAcknowledgedBasicDirtActionReceiptHash: this.lastAcknowledgedBasicDirtAction?.receipt.receiptHash ?? null,
      dropPickupQueryConfigured: this.dropPickupQueryConfigured,
      dropPickupCursor: this.dropPickupCursor,
      dropPickupLegacySeedPending: this.dropPickupLegacySeedPending,
      dropPickupQueryCalls: this.dropPickupQueryCalls,
      pendingDropPickupSequence: this.pendingDropPickup?.receipt.sequence ?? null,
      pendingDropPickupReceiptHash: this.pendingDropPickup?.receipt.receiptHash ?? null,
      pendingDropPickupIdentityHash: this.pendingDropPickup?.queryIdentity.stateHash ?? null,
      lastAcknowledgedDropPickupSequence: this.lastAcknowledgedDropPickup?.receipt.sequence ?? null,
      lastAcknowledgedDropPickupReceiptHash: this.lastAcknowledgedDropPickup?.receipt.receiptHash ?? null,
      playerDropQueryConfigured: this.playerDropQueryConfigured,
      playerDropCursor: this.playerDropCursor,
      playerDropLegacySeedPending: this.playerDropLegacySeedPending,
      playerDropQueryCalls: this.playerDropQueryCalls,
      pendingPlayerDropSequence: this.pendingPlayerDrop?.receipt.sequence ?? null,
      pendingPlayerDropReceiptHash: this.pendingPlayerDrop?.receipt.receiptHash ?? null,
      pendingPlayerDropIdentityHash: this.pendingPlayerDrop?.queryIdentity.stateHash ?? null,
      lastAcknowledgedPlayerDropSequence: this.lastAcknowledgedPlayerDrop?.receipt.sequence ?? null,
      lastAcknowledgedPlayerDropReceiptHash: this.lastAcknowledgedPlayerDrop?.receipt.receiptHash ?? null,
      deathRespawnQueryConfigured: this.deathRespawnQueryConfigured,
      deathRespawnCursor: this.deathRespawnCursor,
      deathRespawnLegacySeedPending: this.deathRespawnLegacySeedPending,
      pendingDeathRespawnSequence: this.pendingDeathRespawn?.cursorAfter ?? null,
      pendingDeathRespawnReceiptHash: this.pendingDeathRespawn?.parent.receiptHash ?? null,
      pendingDeathRespawnIdentityHash: this.pendingDeathRespawn?.queryIdentity.stateHash ?? null,
      lastAcknowledgedDeathRespawnSequence: this.lastAcknowledgedDeathRespawn?.cursorAfter ?? null,
      lastAcknowledgedDeathRespawnReceiptHash: this.lastAcknowledgedDeathRespawn?.parent.receiptHash ?? null,
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
    if (this.pendingNativeBlockEdit !== null
      || this.pendingBasicDirtAction !== null
      || this.pendingDropPickup !== null
      || this.pendingPlayerDrop !== null
      || this.pendingDeathRespawn !== null) {
      return Object.freeze({
        discarded: false,
        step: null,
        extraction: null,
        ...(this.nativeBlockEditQueryConfigured ? { nativeBlockEdit: this.pendingNativeBlockEdit } : {}),
        ...(this.basicDirtActionQueryConfigured ? { basicDirtAction: this.pendingBasicDirtAction } : {}),
        ...(this.dropPickupQueryConfigured ? { dropPickup: this.pendingDropPickup } : {}),
        ...(this.playerDropQueryConfigured ? { playerDrop: this.pendingPlayerDrop } : {}),
        ...(this.deathRespawnQueryConfigured ? { deathRespawn: this.pendingDeathRespawn } : {}),
      });
    }
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

    let nativeBlockEdit: RustLiveInputPumpNativeBlockEditDeliveryV1 | null = null;
    if (this.nativeBlockEditQueryConfigured) {
      this.inFlight = true;
      this.commandCalls += 1;
      this.nativeBlockEditQueryCalls += 1;
      try {
        nativeBlockEdit = await this.queryNativeBlockEditAfterStep(
          worldGeneration,
          step.inputsApplied === 1 ? pending.frame.sequence : null,
        );
      }
      catch (error) { if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded(); throw error; }
      finally { this.inFlight = false; }
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded();
    }
    let basicDirtAction: RustLiveInputPumpBasicDirtActionDeliveryV1 | null = null;
    if (this.basicDirtActionQueryConfigured && !this.nativeBlockEditQueryConfigured) {
      this.inFlight = true;
      this.commandCalls += 1;
      this.basicDirtActionQueryCalls += 1;
      try { basicDirtAction = await this.queryBasicDirtActionAfterStep(worldGeneration); }
      catch (error) { if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded(); throw error; }
      finally { this.inFlight = false; }
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded();
    }
    let dropPickup: RustLiveInputPumpDropPickupDeliveryV1 | null = null;
    if (this.dropPickupQueryConfigured && nativeBlockEdit === null && basicDirtAction === null) {
      this.inFlight = true;
      this.commandCalls += 1;
      this.dropPickupQueryCalls += 1;
      try { dropPickup = await this.queryDropPickupAfterStep(worldGeneration); }
      catch (error) { if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded(); throw error; }
      finally { this.inFlight = false; }
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded();
    }
    let playerDrop: RustLiveInputPumpPlayerDropDeliveryV1 | null = null;
    if (this.playerDropQueryConfigured
      && nativeBlockEdit === null
      && basicDirtAction === null
      && dropPickup === null) {
      this.inFlight = true;
      this.commandCalls += 1;
      this.playerDropQueryCalls += 1;
      try { playerDrop = await this.queryPlayerDropAfterStep(worldGeneration); }
      catch (error) { if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded(); throw error; }
      finally { this.inFlight = false; }
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discarded();
    }

    const authorityChanged = step.fixedSteps > 0 || step.inputsApplied === 1;
    const viewChanged = view !== null && !sameView(this.lastView, view);
    if (!authorityChanged && !initialSync && !viewChanged) {
      return Object.freeze({
        discarded: false,
        step,
        extraction: null,
        ...(this.nativeBlockEditQueryConfigured ? { nativeBlockEdit } : {}),
        ...(this.basicDirtActionQueryConfigured ? { basicDirtAction } : {}),
        ...(this.dropPickupQueryConfigured ? { dropPickup } : {}),
        ...(this.playerDropQueryConfigured ? { playerDrop } : {}),
        ...(this.deathRespawnQueryConfigured ? { deathRespawn: null } : {}),
      });
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
    const deathRespawn = this.deathRespawnQueryConfigured
      ? this.observeDeathRespawnAfterExtraction(
        worldGeneration,
        extraction.identity,
        decodeRustLivePlayerViewR10(extraction, this.serviceExternalEntityId()),
      )
      : null;
    this.commitExtraction(extraction, view, camera);
    return Object.freeze({
      discarded: false,
      step,
      extraction,
      cause: initialSync ? "initial" : authorityChanged ? "authority" : "viewport",
      camera,
      ...(this.nativeBlockEditQueryConfigured ? { nativeBlockEdit } : {}),
      ...(this.basicDirtActionQueryConfigured ? { basicDirtAction } : {}),
      ...(this.dropPickupQueryConfigured ? { dropPickup } : {}),
      ...(this.playerDropQueryConfigured ? { playerDrop } : {}),
      ...(this.deathRespawnQueryConfigured ? { deathRespawn } : {}),
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

  private async runNewLocatorItemConsume(
    worldGeneration: number,
    lifecycle: number,
    intent: RustIntegratedPlayerLocatorItemConsumeV1,
    beforeDispatch?: (plan: RustLiveLocatorItemConsumePlanV1) => Promise<void>,
  ): Promise<RustLiveInputPumpLocatorItemConsumeResultV1> {
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedLocatorItemConsume();
    const actorId = this.playerActorId;
    const inventoryViewKey = this.playerInventoryViewKey;
    if (actorId === null || inventoryViewKey === null) {
      fail("locator-consume-binding", "live input status has no authoritative player inventory binding");
    }
    if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), this.lastIdentity)) {
      fail("identity-drift", "Rust runtime identity moved outside the live input pump");
    }
    const plan = planRustLiveLocatorItemConsumeV1(this.lastIdentity, actorId, intent);
    if (plan.inventoryViewKey !== inventoryViewKey) {
      fail("locator-consume-binding", "locator command inventory is not the pump's authoritative player inventory");
    }
    if (beforeDispatch) {
      await beforeDispatch(plan);
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedLocatorItemConsume(plan);
      if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), plan.batch.expected)) {
        fail("identity-drift", "Rust runtime identity moved while the locator command plan was persisted");
      }
    }
    return this.dispatchLocatorItemPlan(worldGeneration, lifecycle, plan, false);
  }

  private assertPlayerRespawnLaneClear() {
    if (this.pendingNativeBlockEdit !== null
      || this.pendingBasicDirtAction !== null
      || this.pendingDropPickup !== null
      || this.pendingPlayerDrop !== null
      || this.pendingDeathRespawn !== null) {
      fail("player-respawn-projection", "native player respawn cannot cross an unacknowledged browser projection");
    }
    if (this.pendingInput !== null || this.contextCommandIntents.length > 0
      || [...this.actionTransitions.values()].some((queue) => queue.length > 0)) {
      fail("player-respawn-input", "native player respawn cannot cross pending input, action, or context-command custody");
    }
  }

  private async runNewPlayerRespawn(
    worldGeneration: number,
    lifecycle: number,
    intent: RustIntegratedPlayerRespawnV1,
    beforeDispatch?: (plan: RustLivePlayerRespawnPlanV1) => Promise<void>,
  ): Promise<RustLiveInputPumpPlayerRespawnResultV1> {
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedPlayerRespawn();
    this.assertPlayerRespawnLaneClear();
    const initialIdentity = this.lastIdentity;
    if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), initialIdentity)
      || !rustIntegratedRuntimeIdentityEqualsV1(intent.expected, initialIdentity)) {
      fail("identity-drift", "player respawn intent does not bind the pump's exact current identity");
    }
    if (intent.externalEntityId !== this.playerExternalEntityId || intent.actorId !== this.playerActorId) {
      fail("player-respawn-binding", "player respawn intent does not match the pump's authoritative player binding");
    }
    if (!intent.keepInventory && (!this.deathRespawnQueryConfigured || this.deathRespawnLegacySeedPending)) {
      fail("death-respawn-cursor", "false-policy respawn requires a seeded durable parent cursor");
    }
    if (!this.service.command) {
      fail("player-respawn-service", "live input service does not expose integrated player respawn commands");
    }
    let currentIntent = intent;
    if (this.lastAppliedMoveX !== 0 || this.lastAppliedMoveZ !== 0 || this.lastAppliedButtons !== 0) {
      const neutralized = await this.neutralizePlayerRespawnInput(worldGeneration, lifecycle);
      if (!neutralized) return this.discardedPlayerRespawn();
      const rebound = await this.rebindPlayerRespawnAfterNeutralInput(
        worldGeneration,
        lifecycle,
        intent,
      );
      if (rebound === null) return this.discardedPlayerRespawn();
      currentIntent = rebound;
    }
    const plan = planRustLivePlayerRespawnV1(this.lastIdentity, Object.freeze({
      ...currentIntent,
      expected: this.lastIdentity,
    }));
    if (beforeDispatch) {
      await beforeDispatch(plan);
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedPlayerRespawn(plan);
      if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), plan.batch.expected)) {
        fail("identity-drift", "Rust runtime identity moved while the respawn command plan was persisted");
      }
    }
    return this.dispatchPlayerRespawnPlan(worldGeneration, lifecycle, plan);
  }

  private async runRetainedPlayerRespawn(
    worldGeneration: number,
    lifecycle: number,
    plan: RustLivePlayerRespawnPlanV1,
  ): Promise<RustLiveInputPumpPlayerRespawnResultV1> {
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedPlayerRespawn(plan);
    this.assertPlayerRespawnLaneClear();
    if (plan.request.externalEntityId !== this.playerExternalEntityId
      || plan.request.actorId !== this.playerActorId) {
      fail("player-respawn-binding", "retained player respawn plan does not match the pump's authoritative binding");
    }
    if (!plan.request.keepInventory && (!this.deathRespawnQueryConfigured || this.deathRespawnLegacySeedPending)) {
      fail("death-respawn-cursor", "retained false-policy respawn requires a seeded durable parent cursor");
    }
    if (!this.service.command) {
      fail("player-respawn-service", "live input service does not expose integrated player respawn commands");
    }
    const current = this.service.identity();
    if (!rustIntegratedRuntimeIdentityEqualsV1(current, this.lastIdentity)) {
      fail("identity-drift", "Rust runtime identity moved outside the live input pump");
    }
    if (rustIntegratedRuntimeIdentityEqualsV1(current, plan.batch.expected)
      && (this.lastAppliedMoveX !== 0 || this.lastAppliedMoveZ !== 0 || this.lastAppliedButtons !== 0)) {
      fail("player-respawn-input", "retained pre-dispatch respawn plan is no longer input-neutral");
    }
    return this.dispatchPlayerRespawnPlan(worldGeneration, lifecycle, plan);
  }

  private async neutralizePlayerRespawnInput(worldGeneration: number, lifecycle: number) {
    integer(this.lastIdentity.tick, 0, U64_SAFE_MAX - 1, "Rust authority tick");
    const pending = Object.freeze({
      frame: frozenFrame({
        sequence: this.nextInputSequence,
        targetTick: this.lastIdentity.tick + 1,
        moveX: 0,
        moveZ: 0,
        lookYaw: this.latest.lookYaw,
        lookPitch: this.latest.lookPitch,
        buttons: 0,
        selectedSlot: this.selectedSlot,
        flags: this.authoritativeFlags,
      }),
      submitted: false,
      consumedTransitions: Object.freeze([]),
      expectedActions: Object.freeze([]),
      contextCommands: Object.freeze([]),
      contextIntentCount: 0,
    } satisfies PendingInputR5);
    let submitted = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = this.lastIdentity;
      const minimum = integer(
        this.lastMonotonicTimeUs + RUST_INTEGRATED_RUNTIME_FIXED_STEP_US,
        1,
        U64_SAFE_MAX,
        "player respawn neutral input time",
      );
      const monotonicTimeUs = Math.max(this.nextMonotonicTime(), minimum);
      this.inFlight = true;
      this.stepCalls += 1;
      let step: RustLiveRuntimeStepResultR5;
      try {
        step = await this.service.step(
          monotonicTimeUs,
          RUST_LIVE_INPUT_STEP_BUDGET_US_R5,
          submitted ? Object.freeze([]) : Object.freeze([pending.frame]),
        );
      } catch (error) {
        if (!this.continuationIsLive(worldGeneration, lifecycle)) return false;
        throw error;
      } finally {
        this.inFlight = false;
      }
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return false;
      const staged = this.validateStep(before, pending, step);
      this.lastMonotonicTimeUs = monotonicTimeUs;
      this.lastIdentity = frozenIdentity(step.identity);
      submitted = true;
      this.pendingInput = step.inputsApplied === 0 ? Object.freeze({ ...pending, submitted: true }) : null;
      if (staged) {
        this.commitAppliedInput(staged);
        invariantRespawnNeutral(this.lastAppliedMoveX, this.lastAppliedMoveZ, this.lastAppliedButtons);
        return true;
      }
    }
    fail("player-respawn-input", "neutral native input did not apply within two exact fixed-step attempts");
  }

  /**
   * Neutral input advances R5/R6/R7 before a new respawn plan exists. Re-read
   * all explicit BWD7 compare-and-swap cursors from one successor extraction so
   * the persisted bytes cannot combine the new outer identity with stale
   * entity/gameplay cursors from the pre-neutral death view.
   */
  private async rebindPlayerRespawnAfterNeutralInput(
    worldGeneration: number,
    lifecycle: number,
    intent: RustIntegratedPlayerRespawnV1,
  ): Promise<RustIntegratedPlayerRespawnV1 | null> {
    const identity = this.lastIdentity;
    this.inFlight = true;
    this.extractionCalls += 1;
    let extraction: RustIntegratedRuntimeExtractionV1;
    try {
      extraction = await this.service.extract(
        this.lastExtractionRevision,
        undefined,
        this.lastView ?? undefined,
      );
    } catch (error) {
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return null;
      throw error;
    } finally {
      this.inFlight = false;
    }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return null;
    this.validateExtraction(extraction, identity, true);

    const player = decodeRustLivePlayerViewR10(extraction, this.serviceExternalEntityId());
    const gameplaySequence = player.gameplaySequence;
    const gameplayCombatRevision = player.gameplayCombatRevision;
    const combatantRevision = player.combat.combatantRevision;
    const deathSequence = player.deathSequence;
    const lastRespawnSequence = player.lastRespawnSequence;
    if (player.extractionRevision !== BigInt(extraction.extractionRevision)
      || player.authorityTick !== BigInt(identity.tick)
      || player.respawnAuthoritySchema !== 1
      || typeof gameplaySequence !== "bigint"
      || typeof gameplayCombatRevision !== "bigint"
      || typeof combatantRevision !== "bigint"
      || typeof deathSequence !== "bigint"
      || lastRespawnSequence !== null && typeof lastRespawnSequence !== "bigint") {
      fail("player-respawn-rebind", "post-neutral extraction omits the exact current R5/R6/R7 respawn authority envelope");
    }
    if (player.externalEntityId !== intent.externalEntityId
      || player.externalEntityId !== this.playerExternalEntityId
      || player.actorId !== intent.actorId
      || player.actorId !== this.playerActorId
      || player.playerId !== intent.playerId
      || player.entityId !== intent.entityId
      || deathSequence !== intent.expectedDeathSequence) {
      fail("player-respawn-rebind", "post-neutral extraction changed player, entity, actor, or death custody");
    }
    if (player.health !== 0
      || player.combat.health !== 0
      || player.combat.alive
      || player.combat.maxHealth !== intent.expectedMaxHealth
      || lastRespawnSequence !== null && lastRespawnSequence >= deathSequence) {
      fail("player-respawn-rebind", "post-neutral extraction is not the same dead player with unchanged maximum health");
    }
    if (player.queuedInputsEmpty !== true
      || player.pendingContextCommandsEmpty !== true
      || player.pendingMovementResultEmpty !== true
      || player.miningStateEmpty !== true
      || player.buttons !== 0) {
      fail("player-respawn-rebind", "post-neutral extraction is not ready for one exact native respawn command");
    }

    const rebound = Object.freeze({
      ...intent,
      expected: frozenIdentity(extraction.identity),
      expectedEntityRevision: player.entityRevision,
      expectedGameplaySequence: gameplaySequence,
      expectedGameplayCombatRevision: gameplayCombatRevision,
      expectedCombatantRevision: combatantRevision,
    });
    const view = this.lastView;
    const camera = view === null ? null : this.decodeCamera(extraction, view);
    this.commitExtraction(extraction, view, camera);
    return rebound;
  }

  private async dispatchPlayerRespawnPlan(
    worldGeneration: number,
    lifecycle: number,
    plan: RustLivePlayerRespawnPlanV1,
  ): Promise<RustLiveInputPumpPlayerRespawnResultV1> {
    const command = this.service.command;
    if (!command) fail("player-respawn-service", "live input service does not expose integrated player respawn commands");
    this.inFlight = true;
    this.commandCalls += 1;
    let receipt: RustIntegratedRuntimeCommandReceiptV1;
    try { receipt = await command.call(this.service, plan.batch); }
    catch (error) {
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedPlayerRespawn(plan);
      throw error;
    } finally { this.inFlight = false; }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedPlayerRespawn(plan);
    const validated = validateRustLivePlayerRespawnReceiptV1(plan, receipt);
    if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), validated.outer.after)) {
      fail("player-respawn-command-receipt", "service identity disagrees with accepted player respawn receipt");
    }
    this.lastIdentity = frozenIdentity(validated.outer.after);

    this.inFlight = true;
    this.extractionCalls += 1;
    let extraction: RustIntegratedRuntimeExtractionV1;
    try { extraction = await this.service.extract(this.lastExtractionRevision, undefined, this.lastView ?? undefined); }
    catch (error) {
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedPlayerRespawn(plan);
      throw error;
    } finally { this.inFlight = false; }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedPlayerRespawn(plan);
    this.validateExtraction(extraction, this.lastIdentity, true);
    const player = decodeRustLivePlayerViewR10(extraction, this.serviceExternalEntityId());
    const deathRespawn = this.deathRespawnQueryConfigured
      ? this.observeDeathRespawnAfterExtraction(worldGeneration, extraction.identity, player)
      : null;
    const readback = this.playerRespawnReadback(validated, player, extraction.identity);
    validateRustLivePlayerRespawnAfterCommandV1(plan, validated, readback);
    if (!plan.request.keepInventory) {
      const extractedParent = player.latestDeathRespawn ?? null;
      // Both values below are native-parent identities. BWE7 owns a separate
      // receipt-hash domain and is joined to this parent by shared fields in
      // playerRespawnReadback, never by comparing the two receipt hashes.
      if (deathRespawn === null || extractedParent === null
        || deathRespawn.parent.respawnSequence !== extractedParent.respawnSequence
        || deathRespawn.parent.receiptHash !== extractedParent.receiptHash
        || deathRespawn.parent.drops.some((drop) => !drop.r6Linked)) {
        fail("player-respawn-readback", "false-policy BWE7 is not linked to one exact pending BWX0/BWR6 parent");
      }
    }
    const view = this.lastView;
    const camera = view === null ? null : this.decodeCamera(extraction, view);
    this.commitExtraction(extraction, view, camera);
    return Object.freeze({
      discarded: false,
      plan,
      receipt,
      validated,
      extraction,
      player,
      camera,
      view,
      deathRespawn,
    });
  }

  private playerRespawnReadback(
    validated: RustLivePlayerRespawnValidatedReceiptV1,
    player: RustLivePlayerViewR10,
    identity: RustIntegratedRuntimeIdentityV1,
  ): RustLivePlayerRespawnReadbackV1 {
    if (player.respawnAuthoritySchema !== 1
      || player.gameplaySequence === null || player.gameplaySequence === undefined
      || player.gameplayCombatRevision === null || player.gameplayCombatRevision === undefined
      || player.deathSequence === null || player.deathSequence === undefined
      || player.lastRespawnSequence === null || player.lastRespawnSequence === undefined
      || player.queuedInputsEmpty === null || player.queuedInputsEmpty === undefined
      || player.pendingContextCommandsEmpty === null || player.pendingContextCommandsEmpty === undefined
      || player.pendingMovementResultEmpty === null || player.pendingMovementResultEmpty === undefined
      || player.miningStateEmpty === null || player.miningStateEmpty === undefined) {
      fail("player-respawn-readback", "BWX0 player row does not expose the complete respawn authority schema");
    }
    if (player.combat.combatantRevision === null || player.combat.combatantRevision === undefined) {
      fail("player-respawn-readback", "BWX0 combat row omits the explicit native combatant revision");
    }
    const receipt = validated.respawn;
    const parent = player.latestDeathRespawn ?? null;
    if (!receipt.keepInventory) {
      if (parent === null
        || !rustIntegratedPlayerRespawnParentAttestsReceiptV1(parent, receipt)) {
        fail("player-respawn-readback", "latest BWX0 death-respawn parent does not attest the exact false-policy BWE7");
      }
    }
    return Object.freeze({
      identity,
      externalEntityId: player.externalEntityId,
      actorId: player.actorId,
      playerId: player.playerId,
      entityId: player.entityId,
      entityRevision: player.entityRevision,
      gameplaySequence: player.gameplaySequence,
      gameplayCombatRevision: player.gameplayCombatRevision,
      combatantRevision: player.combat.combatantRevision,
      deathSequence: player.deathSequence,
      lastRespawnSequence: player.lastRespawnSequence,
      health: player.combat.health,
      maximumHealth: player.combat.maxHealth,
      alive: player.combat.alive,
      position: exactFixedVector(player.position, "player respawn position"),
      velocityMilliPerSecond: exactFixedVector(player.velocity, "player respawn velocity"),
      oxygenSeconds: player.oxygenSeconds,
      grounded: player.grounded,
      crouching: player.crouching,
      fallDistanceMilli: exactFixedMilli(player.fallDistance, "player respawn fall distance"),
      drowningAccumulatorMilli: exactFixedMilli(
        player.drowningAccumulator,
        "player respawn drowning accumulator",
      ),
      buttons: player.buttons,
      flags: player.authoritativeFlags,
      contactFlags: player.contactFlags,
      queuedInputsEmpty: player.queuedInputsEmpty,
      pendingContextCommandsEmpty: player.pendingContextCommandsEmpty,
      pendingMovementResultEmpty: player.pendingMovementResultEmpty,
      miningStateEmpty: player.miningStateEmpty,
      inventoryRevision: player.inventoryContainerRevision,
      equipmentRevision: player.equipmentContainerRevision,
      custodyHash: receipt.keepInventory ? receipt.custodyAfterHash : parent!.custodyAfterHash,
      projectedDropCount: receipt.keepInventory ? 0 : parent!.generatedDropCount,
    });
  }

  private observeDeathRespawnAfterExtraction(
    worldGeneration: number,
    identity: RustIntegratedRuntimeIdentityV1,
    player: RustLivePlayerViewR10,
  ) {
    if (player.respawnAuthoritySchema !== 1) {
      fail("death-respawn-projection", "tracked death-respawn cursor requires the updated BWX0 authority row");
    }
    const parent = player.latestDeathRespawn ?? null;
    if (this.deathRespawnLegacySeedPending) {
      this.deathRespawnCursor = parent === null
        ? 0
        : integer(Number(parent.respawnSequence), 1, U64_SAFE_MAX, "legacy native death-respawn seed cursor");
      this.deathRespawnLegacySeedPending = false;
      return null;
    }
    const cursorBefore = this.deathRespawnCursor;
    if (cursorBefore === null) {
      fail("death-respawn-cursor", "tracked native death-respawn projection has no browser cursor");
    }
    if (parent === null) return null;
    const cursorAfter = integer(
      Number(parent.respawnSequence),
      1,
      U64_SAFE_MAX,
      "native death-respawn parent sequence",
    );
    if (cursorAfter < cursorBefore) {
      fail("death-respawn-cursor", "native death-respawn parent sequence regressed behind the browser cursor");
    }
    if (cursorAfter === cursorBefore) return null;
    if (cursorBefore === U64_SAFE_MAX || cursorAfter !== cursorBefore + 1) {
      fail("death-respawn-cursor", "native death-respawn parent skipped the browser's exact next cursor");
    }
    const delivery = Object.freeze({
      worldGeneration,
      queryIdentity: frozenIdentity(identity),
      cursorBefore,
      cursorAfter,
      parent,
    });
    this.validateDeathRespawnDelivery(delivery);
    if (this.pendingDeathRespawn !== null
      && !this.deathRespawnDeliveriesEqual(this.pendingDeathRespawn, delivery)) {
      fail("death-respawn-projection", "native death-respawn parent changed while awaiting browser acknowledgement");
    }
    this.pendingDeathRespawn = delivery;
    return delivery;
  }

  private validateDeathRespawnDelivery(delivery: RustLiveInputPumpDeathRespawnDeliveryV1) {
    if (delivery.worldGeneration !== this.worldGeneration) {
      fail("death-respawn-acknowledgement", "death-respawn parent belongs to another world generation");
    }
    integer(delivery.cursorBefore, 0, U64_SAFE_MAX, "death-respawn delivery cursor before");
    integer(delivery.cursorAfter, 1, U64_SAFE_MAX, "death-respawn delivery cursor after");
    if (delivery.cursorBefore === U64_SAFE_MAX
      || delivery.cursorAfter !== delivery.cursorBefore + 1
      || delivery.parent.respawnSequence !== BigInt(delivery.cursorAfter)
      || !/^[0-9a-f]{32}$/u.test(delivery.parent.receiptHash)
      || delivery.parent.receiptHash === "0".repeat(32)) {
      fail("death-respawn-acknowledgement", "death-respawn delivery does not bind one exact contiguous parent");
    }
  }

  private deathRespawnDeliveriesEqual(
    left: RustLiveInputPumpDeathRespawnDeliveryV1,
    right: RustLiveInputPumpDeathRespawnDeliveryV1,
  ) {
    return left.worldGeneration === right.worldGeneration
      && left.cursorBefore === right.cursorBefore
      && left.cursorAfter === right.cursorAfter
      && left.parent.receiptHash === right.parent.receiptHash
      && rustIntegratedRuntimeIdentityEqualsV1(left.queryIdentity, right.queryIdentity);
  }

  private async runCreativeSlotSet(
    worldGeneration: number,
    lifecycle: number,
    intent: RustIntegratedPlayerCreativeSlotSetV1,
  ): Promise<RustLiveInputPumpCreativeSlotSetResultV1> {
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedCreativeSlotSet();
    const actorId = this.playerActorId;
    const inventoryViewKey = this.playerInventoryViewKey;
    if (actorId === null || inventoryViewKey === null) fail("creative-slot-binding", "live input status has no authoritative player inventory binding");
    if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), this.lastIdentity)) fail("identity-drift", "Rust runtime identity moved outside the live input pump");
    const plan = planRustLiveCreativeSlotSetV1(this.lastIdentity, actorId, intent);
    if (plan.inventoryViewKey !== inventoryViewKey) fail("creative-slot-binding", "creative slot command inventory is not the pump's authoritative player inventory");
    if (!this.service.command) fail("creative-slot-service", "live input service does not expose integrated creative slot commands");
    this.inFlight = true;
    this.commandCalls += 1;
    this.creativeSlotSetCalls += 1;
    let receipt: RustIntegratedRuntimeCommandReceiptV1;
    try { receipt = await this.service.command(plan.batch); }
    catch (error) { if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedCreativeSlotSet(plan); throw error; }
    finally { this.inFlight = false; }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedCreativeSlotSet(plan);
    const validated = validateRustLiveCreativeSlotSetReceiptV1(plan, receipt);
    if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), validated.outer.after)) fail("creative-slot-command-receipt", "service identity disagrees with accepted creative slot receipt");
    this.lastIdentity = frozenIdentity(validated.outer.after);
    this.inFlight = true;
    this.extractionCalls += 1;
    let extraction: RustIntegratedRuntimeExtractionV1;
    try { extraction = await this.service.extract(this.lastExtractionRevision, undefined, this.lastView ?? undefined); }
    catch (error) { if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedCreativeSlotSet(plan); throw error; }
    finally { this.inFlight = false; }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedCreativeSlotSet(plan);
    this.validateExtraction(extraction, this.lastIdentity, true);
    const player = decodeRustLivePlayerViewR10(extraction, this.serviceExternalEntityId());
    validateRustLiveCreativeSlotSetAfterCommandV1(plan, validated, player);
    const camera = this.lastView === null ? null : this.decodeCamera(extraction, this.lastView);
    this.commitExtraction(extraction, this.lastView, camera);
    return Object.freeze({ discarded: false, plan, receipt, validated, extraction, player });
  }

  private async runRecoveredLocatorItemConsume(
    worldGeneration: number,
    lifecycle: number,
    plan: RustLiveLocatorItemConsumePlanV1,
  ): Promise<RustLiveInputPumpLocatorItemConsumeResultV1> {
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedLocatorItemConsume(plan);
    if (plan.batch.actorId !== this.playerActorId || plan.inventoryViewKey !== this.playerInventoryViewKey) {
      fail("locator-consume-binding", "durable locator plan does not match the pump's authoritative player binding");
    }
    const current = this.service.identity();
    if (!rustIntegratedRuntimeIdentityEqualsV1(current, this.lastIdentity)) {
      fail("identity-drift", "Rust runtime identity moved outside the live input pump");
    }
    const alreadyDispatched = !rustIntegratedRuntimeIdentityEqualsV1(current, plan.batch.expected);
    return this.dispatchLocatorItemPlan(worldGeneration, lifecycle, plan, alreadyDispatched);
  }

  private async dispatchLocatorItemPlan(
    worldGeneration: number,
    lifecycle: number,
    plan: RustLiveLocatorItemConsumePlanV1,
    recoverOnly: boolean,
  ): Promise<RustLiveInputPumpLocatorItemConsumeResultV1> {
    const terminalIdentity = this.lastIdentity;
    const dispatch = recoverOnly ? this.service.recoverCommand : this.service.command;
    if (!dispatch) fail("locator-consume-service", recoverOnly
      ? "post-debit locator recovery requires lookup-only integrated command recovery"
      : "live input service does not expose integrated locator item commands");
    this.inFlight = true;
    this.commandCalls += 1;
    let receipt: RustIntegratedRuntimeCommandReceiptV1;
    try { receipt = await dispatch.call(this.service, plan.batch); }
    catch (error) {
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedLocatorItemConsume(plan);
      throw error;
    } finally { this.inFlight = false; }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedLocatorItemConsume(plan);
    const validated = validateRustLiveLocatorItemConsumeReceiptV1(plan, receipt);
    const serviceIdentity = this.service.identity();
    if (recoverOnly) {
      if (!rustIntegratedRuntimeIdentityEqualsV1(serviceIdentity, terminalIdentity)
        || !identityMatchesHydratedLocatorReceipt(validated.outer.after, terminalIdentity)) {
        fail("locator-consume-recovery", "lookup-only locator receipt does not match the exact post-hydration authority axes");
      }
    } else if (!rustIntegratedRuntimeIdentityEqualsV1(serviceIdentity, validated.outer.after)) {
      fail("locator-consume-command-receipt", "service identity disagrees with accepted locator command receipt");
    }
    this.lastIdentity = frozenIdentity(recoverOnly ? terminalIdentity : validated.outer.after);

    this.inFlight = true;
    this.extractionCalls += 1;
    let extraction: RustIntegratedRuntimeExtractionV1;
    try {
      extraction = await this.service.extract(
        recoverOnly && this.lastExtractionRevision > 0
          ? this.lastExtractionRevision - 1
          : this.lastExtractionRevision,
        undefined,
        this.lastView ?? undefined,
      );
    } catch (error) {
      if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedLocatorItemConsume(plan);
      throw error;
    } finally { this.inFlight = false; }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) return this.discardedLocatorItemConsume(plan);
    // This command deliberately mutates gameplay custody without advancing the fixed-step tick.
    // Ordinary advance still proves all tick movement in validateStep before reaching this path.
    this.validateExtraction(extraction, this.lastIdentity, !recoverOnly);
    const player = decodeRustLivePlayerViewR10(extraction, this.serviceExternalEntityId());
    validateRustLiveLocatorItemConsumeAfterCommandV1(plan, validated, player);
    const camera = this.lastView === null ? null : this.decodeCamera(extraction, this.lastView);
    this.commitExtraction(extraction, this.lastView, camera);
    return Object.freeze({ discarded: false, plan, receipt, validated, extraction, player });
  }

  private async runNativePersistenceCheckpoint<T>(
    worldGeneration: number,
    lifecycle: number,
    checkpoint: () => Promise<T>,
  ): Promise<RustLiveInputPumpNativeCheckpointResultV1<T>> {
    if (!this.continuationIsLive(worldGeneration, lifecycle)) {
      return this.discardedNativeCheckpoint();
    }
    if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), this.lastIdentity)) {
      fail("identity-drift", "Rust runtime identity moved before the serialized native checkpoint");
    }
    const before = frozenIdentity(this.lastIdentity);
    let value: T;
    try {
      value = await checkpoint();
    } catch (error) {
      if (!rustIntegratedRuntimeIdentityEqualsV1(this.service.identity(), before)) {
        const cause = error instanceof Error ? error.message : String(error);
        fail(
          "native-checkpoint-indeterminate",
          `native checkpoint failed after moving the authoritative runtime identity: ${cause}`,
        );
      }
      throw error;
    }
    const after = frozenIdentity(this.service.identity());
    if (!identityIsExactNativePersistenceSuccessor(before, after)) {
      fail("native-checkpoint-identity", "native checkpoint did not return the exact persistence-only authority successor");
    }
    if (!this.continuationIsLive(worldGeneration, lifecycle)) {
      return this.discardedNativeCheckpoint(before, after);
    }
    this.lastIdentity = after;
    return Object.freeze({ discarded: false, value, before, after });
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

  private async queryNativeBlockEditAfterStep(
    worldGeneration: number,
    newlyAppliedInputSequence: number | null,
  ) {
    const command = this.service.command;
    if (!command) fail("native-block-edit-service", "Rust runtime lost the read-only native block-edit receipt query");
    const legacySeed = this.nativeBlockEditLegacySeedPending;
    const cursorBefore = legacySeed
      ? RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1
      : this.nativeBlockEditCursor;
    if (cursorBefore === null) {
      fail("native-block-edit-cursor", "tracked native block-edit receipt query has no browser cursor");
    }
    const queryService = {
      identity: () => this.service.identity(),
      command: (batch: RustIntegratedRuntimeCommandBatchV1) => command.call(this.service, batch),
    };
    const observedV2 = this.nativeBlockEditProtocolVersion === 2
      ? await queryRustIntegratedRuntimeNativeBlockEditReceiptV2(queryService, cursorBefore)
      : null;
    const observed = observedV2
      ?? await queryRustIntegratedRuntimeNativeBlockEditReceiptV1(queryService, cursorBefore);
    if (this.stateValue !== "ready" || worldGeneration !== this.worldGeneration) return null;
    if (!rustIntegratedRuntimeIdentityEqualsV1(observed.identity, this.lastIdentity)) {
      fail("native-block-edit-identity", "native block-edit receipt query moved or changed the post-step identity");
    }
    if (legacySeed) {
      if (observed.receipt !== null) {
        fail("native-block-edit-cursor", "legacy native block-edit cursor seed replayed a receipt");
      }
      this.nativeBlockEditCursor = observed.cursorAfter;
      this.nativeBlockEditLegacySeedPending = false;
      return null;
    }
    if (observed.receipt === null) return null;
    const dirty = observedV2?.dirtyEvidence ?? null;
    if (this.nativeBlockEditProtocolVersion === 2 && dirty === null
      && observed.receipt.originInputSequence === newlyAppliedInputSequence) {
      fail("native-block-edit-dirty-missing", "new V2 native block-edit action omitted required Rust dirty evidence");
    }
    if (this.pendingNativeBlockEdit !== null
      || this.pendingBasicDirtAction !== null
      || this.pendingDropPickup !== null
      || this.pendingPlayerDrop !== null) {
      fail("native-block-edit-acknowledgement", "native block-edit query collided with an unacknowledged durable receipt");
    }
    const delivery = Object.freeze({
      protocolVersion: this.nativeBlockEditProtocolVersion,
      legacyFallback: this.nativeBlockEditProtocolVersion === 1
        ? "v1-capability" as const
        : dirty === null ? "v2-pre-v14" as const : null,
      worldGeneration,
      queryIdentity: frozenIdentity(observed.identity),
      cursorBefore,
      cursorAfter: observed.cursorAfter,
      requestPayloadHash: observed.requestPayloadHash,
      projectionPayloadHash: observed.projectionPayloadHash,
      receipt: observed.receipt,
      dirty,
    });
    this.validateNativeBlockEditDelivery(delivery);
    this.pendingNativeBlockEdit = delivery;
    return delivery;
  }

  private validateNativeBlockEditDelivery(delivery: RustLiveInputPumpNativeBlockEditDeliveryV1) {
    if (delivery.worldGeneration !== this.worldGeneration) {
      fail("native-block-edit-acknowledgement", "native block-edit delivery belongs to another world generation");
    }
    integer(delivery.cursorBefore, 0, U64_SAFE_MAX, "native block-edit delivery cursor before");
    integer(delivery.cursorAfter, 1, U64_SAFE_MAX, "native block-edit delivery cursor after");
    if (delivery.cursorBefore === RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_SEED_CURSOR_V1
      || delivery.cursorBefore === U64_SAFE_MAX
      || delivery.cursorAfter !== delivery.cursorBefore + 1
      || delivery.receipt.sequence !== delivery.cursorAfter) {
      fail("native-block-edit-acknowledgement", "native block-edit delivery cursor is not exactly contiguous");
    }
    if (delivery.protocolVersion === 1) {
      if (delivery.legacyFallback !== "v1-capability" || delivery.dirty !== null) {
        fail("native-block-edit-dirty-fallback", "V1 native block-edit delivery has contradictory dirty-evidence custody");
      }
    } else if (delivery.dirty === null) {
      if (delivery.legacyFallback !== "v2-pre-v14") {
        fail("native-block-edit-dirty-fallback", "V2 legacy receipt does not explicitly identify pre-V14 fallback");
      }
    } else if (delivery.legacyFallback !== null) {
      fail("native-block-edit-dirty-fallback", "V2 dirty evidence is mislabeled as a legacy fallback");
    }
    const packet = delivery.protocolVersion === 2
      ? encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV2({
        requestPayloadHash: delivery.requestPayloadHash,
        identity: delivery.queryIdentity,
        cursorAfter: delivery.cursorAfter,
        receipt: delivery.receipt,
        dirtyEvidence: delivery.dirty,
      }, delivery.cursorBefore)
      : encodeRustIntegratedRuntimeNativeBlockEditProjectionReceiptV1({
        requestPayloadHash: delivery.requestPayloadHash,
        identity: delivery.queryIdentity,
        cursorAfter: delivery.cursorAfter,
        receipt: delivery.receipt,
      }, delivery.cursorBefore);
    if (rustIntegratedRuntimeWireChecksumV1(packet) !== delivery.projectionPayloadHash) {
      fail("native-block-edit-acknowledgement", "native block-edit delivery payload hash is not exact");
    }
  }

  private nativeBlockEditDeliveriesEqual(
    left: RustLiveInputPumpNativeBlockEditDeliveryV1,
    right: RustLiveInputPumpNativeBlockEditDeliveryV1,
  ) {
    return left.worldGeneration === right.worldGeneration
      && left.protocolVersion === right.protocolVersion
      && left.legacyFallback === right.legacyFallback
      && left.cursorBefore === right.cursorBefore
      && left.cursorAfter === right.cursorAfter
      && left.requestPayloadHash === right.requestPayloadHash
      && left.projectionPayloadHash === right.projectionPayloadHash
      && left.receipt.sequence === right.receipt.sequence
      && left.receipt.receiptHash === right.receipt.receiptHash
      && left.dirty?.evidenceHash === right.dirty?.evidenceHash
      && rustIntegratedRuntimeIdentityEqualsV1(left.queryIdentity, right.queryIdentity);
  }

  private async queryBasicDirtActionAfterStep(worldGeneration: number) {
    const command = this.service.command;
    if (!command) fail("basic-dirt-action-service", "Rust runtime lost the read-only basic Dirt receipt query");
    const legacySeed = this.basicDirtActionLegacySeedPending;
    const cursorBefore = legacySeed
      ? RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1
      : this.basicDirtActionCursor;
    if (cursorBefore === null) {
      fail("basic-dirt-action-cursor", "tracked basic Dirt receipt query has no browser cursor");
    }
    const observed = await queryRustIntegratedRuntimeBasicDirtActionReceiptV1({
      identity: () => this.service.identity(),
      command: (batch) => command.call(this.service, batch),
    }, cursorBefore);
    if (this.stateValue !== "ready" || worldGeneration !== this.worldGeneration) return null;
    if (!rustIntegratedRuntimeIdentityEqualsV1(observed.identity, this.lastIdentity)) {
      fail("basic-dirt-action-identity", "basic Dirt receipt query moved or changed the post-step identity");
    }
    if (legacySeed) {
      if (observed.receipt !== null) {
        fail("basic-dirt-action-cursor", "legacy basic Dirt cursor seed replayed a native receipt");
      }
      this.basicDirtActionCursor = observed.cursorAfter;
      this.basicDirtActionLegacySeedPending = false;
      return null;
    }
    if (observed.receipt === null) return null;
    if (this.pendingBasicDirtAction !== null) {
      fail("basic-dirt-action-acknowledgement", "basic Dirt query attempted to replace an unacknowledged receipt");
    }
    const delivery = Object.freeze({
      worldGeneration,
      queryIdentity: frozenIdentity(observed.identity),
      cursorBefore,
      cursorAfter: observed.cursorAfter,
      requestPayloadHash: observed.requestPayloadHash,
      projectionPayloadHash: observed.projectionPayloadHash,
      receipt: observed.receipt,
    });
    this.validateBasicDirtActionDelivery(delivery);
    this.pendingBasicDirtAction = delivery;
    return delivery;
  }

  private validateBasicDirtActionDelivery(delivery: RustLiveInputPumpBasicDirtActionDeliveryV1) {
    if (delivery.worldGeneration !== this.worldGeneration) {
      fail("basic-dirt-action-acknowledgement", "basic Dirt delivery belongs to another world generation");
    }
    integer(delivery.cursorBefore, 0, U64_SAFE_MAX, "basic Dirt delivery cursor before");
    integer(delivery.cursorAfter, 1, U64_SAFE_MAX, "basic Dirt delivery cursor after");
    if (delivery.cursorBefore === RUST_INTEGRATED_RUNTIME_BASIC_DIRT_ACTION_SEED_CURSOR_V1
      || delivery.cursorBefore === U64_SAFE_MAX
      || delivery.cursorAfter !== delivery.cursorBefore + 1
      || delivery.receipt.sequence !== delivery.cursorAfter) {
      fail("basic-dirt-action-acknowledgement", "basic Dirt delivery cursor is not exactly contiguous");
    }
    const packet = encodeRustIntegratedRuntimeBasicDirtActionProjectionReceiptV1({
      requestPayloadHash: delivery.requestPayloadHash,
      identity: delivery.queryIdentity,
      cursorAfter: delivery.cursorAfter,
      receipt: delivery.receipt,
    }, delivery.cursorBefore);
    if (rustIntegratedRuntimeWireChecksumV1(packet) !== delivery.projectionPayloadHash) {
      fail("basic-dirt-action-acknowledgement", "basic Dirt delivery payload hash is not exact");
    }
  }

  private basicDirtActionDeliveriesEqual(
    left: RustLiveInputPumpBasicDirtActionDeliveryV1,
    right: RustLiveInputPumpBasicDirtActionDeliveryV1,
  ) {
    return left.worldGeneration === right.worldGeneration
      && left.cursorBefore === right.cursorBefore
      && left.cursorAfter === right.cursorAfter
      && left.requestPayloadHash === right.requestPayloadHash
      && left.projectionPayloadHash === right.projectionPayloadHash
      && left.receipt.sequence === right.receipt.sequence
      && left.receipt.receiptHash === right.receipt.receiptHash
      && rustIntegratedRuntimeIdentityEqualsV1(left.queryIdentity, right.queryIdentity);
  }

  private async queryDropPickupAfterStep(worldGeneration: number) {
    const command = this.service.command;
    if (!command) fail("drop-pickup-service", "Rust runtime lost the read-only native drop-pickup receipt query");
    const legacySeed = this.dropPickupLegacySeedPending;
    const cursorBefore = legacySeed
      ? RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1
      : this.dropPickupCursor;
    if (cursorBefore === null) {
      fail("drop-pickup-cursor", "tracked native drop-pickup receipt query has no browser cursor");
    }
    const observed = await queryRustIntegratedRuntimeDropPickupReceiptV1({
      identity: () => this.service.identity(),
      command: (batch) => command.call(this.service, batch),
    }, cursorBefore);
    if (this.stateValue !== "ready" || worldGeneration !== this.worldGeneration) return null;
    if (!rustIntegratedRuntimeIdentityEqualsV1(observed.identity, this.lastIdentity)) {
      fail("drop-pickup-identity", "drop-pickup receipt query moved or changed the post-step identity");
    }
    if (legacySeed) {
      if (observed.receipt !== null) {
        fail("drop-pickup-cursor", "legacy drop-pickup cursor seed replayed a native receipt");
      }
      this.dropPickupCursor = observed.cursorAfter;
      this.dropPickupLegacySeedPending = false;
      return null;
    }
    if (observed.receipt === null) return null;
    if (this.pendingDropPickup !== null) {
      fail("drop-pickup-acknowledgement", "drop-pickup query attempted to replace an unacknowledged receipt");
    }
    const delivery = Object.freeze({
      worldGeneration,
      queryIdentity: frozenIdentity(observed.identity),
      cursorBefore,
      cursorAfter: observed.cursorAfter,
      requestPayloadHash: observed.requestPayloadHash,
      projectionPayloadHash: observed.projectionPayloadHash,
      receipt: observed.receipt,
    });
    this.validateDropPickupDelivery(delivery);
    this.pendingDropPickup = delivery;
    return delivery;
  }

  private validateDropPickupDelivery(delivery: RustLiveInputPumpDropPickupDeliveryV1) {
    if (delivery.worldGeneration !== this.worldGeneration) {
      fail("drop-pickup-acknowledgement", "drop-pickup delivery belongs to another world generation");
    }
    integer(delivery.cursorBefore, 0, U64_SAFE_MAX, "drop-pickup delivery cursor before");
    integer(delivery.cursorAfter, 1, U64_SAFE_MAX, "drop-pickup delivery cursor after");
    if (delivery.cursorBefore === RUST_INTEGRATED_RUNTIME_DROP_PICKUP_SEED_CURSOR_V1
      || delivery.cursorBefore === U64_SAFE_MAX
      || delivery.cursorAfter !== delivery.cursorBefore + 1
      || delivery.receipt.sequence !== delivery.cursorAfter) {
      fail("drop-pickup-acknowledgement", "drop-pickup delivery cursor is not exactly contiguous");
    }
    const packet = encodeRustIntegratedRuntimeDropPickupProjectionReceiptV1({
      requestPayloadHash: delivery.requestPayloadHash,
      identity: delivery.queryIdentity,
      cursorAfter: delivery.cursorAfter,
      receipt: delivery.receipt,
    }, delivery.cursorBefore);
    if (rustIntegratedRuntimeWireChecksumV1(packet) !== delivery.projectionPayloadHash) {
      fail("drop-pickup-acknowledgement", "drop-pickup delivery payload hash is not exact");
    }
  }

  private dropPickupDeliveriesEqual(
    left: RustLiveInputPumpDropPickupDeliveryV1,
    right: RustLiveInputPumpDropPickupDeliveryV1,
  ) {
    return left.worldGeneration === right.worldGeneration
      && left.cursorBefore === right.cursorBefore
      && left.cursorAfter === right.cursorAfter
      && left.requestPayloadHash === right.requestPayloadHash
      && left.projectionPayloadHash === right.projectionPayloadHash
      && left.receipt.sequence === right.receipt.sequence
      && left.receipt.receiptHash === right.receipt.receiptHash
      && rustIntegratedRuntimeIdentityEqualsV1(left.queryIdentity, right.queryIdentity);
  }

  private async queryPlayerDropAfterStep(worldGeneration: number) {
    const command = this.service.command;
    if (!command) fail("player-drop-service", "Rust runtime lost the read-only native player-drop receipt query");
    const legacySeed = this.playerDropLegacySeedPending;
    const cursorBefore = legacySeed
      ? RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1
      : this.playerDropCursor;
    if (cursorBefore === null) {
      fail("player-drop-cursor", "tracked native player-drop receipt query has no browser cursor");
    }
    const observed = await queryRustIntegratedRuntimeNativePlayerDropReceiptV1({
      identity: () => this.service.identity(),
      command: (batch) => command.call(this.service, batch),
    }, cursorBefore);
    if (this.stateValue !== "ready" || worldGeneration !== this.worldGeneration) return null;
    if (!rustIntegratedRuntimeIdentityEqualsV1(observed.identity, this.lastIdentity)) {
      fail("player-drop-identity", "player-drop receipt query moved or changed the post-step identity");
    }
    if (legacySeed) {
      if (observed.receipt !== null) {
        fail("player-drop-cursor", "legacy player-drop cursor seed replayed a native receipt");
      }
      this.playerDropCursor = observed.cursorAfter;
      this.playerDropLegacySeedPending = false;
      return null;
    }
    if (observed.receipt === null) return null;
    if (this.pendingNativeBlockEdit !== null
      || this.pendingBasicDirtAction !== null
      || this.pendingDropPickup !== null
      || this.pendingPlayerDrop !== null) {
      fail("player-drop-acknowledgement", "player-drop query collided with an unacknowledged native receipt");
    }
    const delivery = Object.freeze({
      worldGeneration,
      queryIdentity: frozenIdentity(observed.identity),
      cursorBefore,
      cursorAfter: observed.cursorAfter,
      requestPayloadHash: observed.requestPayloadHash,
      projectionPayloadHash: observed.projectionPayloadHash,
      receipt: observed.receipt,
    });
    this.validatePlayerDropDelivery(delivery);
    this.pendingPlayerDrop = delivery;
    return delivery;
  }

  private validatePlayerDropDelivery(delivery: RustLiveInputPumpPlayerDropDeliveryV1) {
    if (delivery.worldGeneration !== this.worldGeneration) {
      fail("player-drop-acknowledgement", "player-drop delivery belongs to another world generation");
    }
    integer(delivery.cursorBefore, 0, U64_SAFE_MAX, "player-drop delivery cursor before");
    integer(delivery.cursorAfter, 1, U64_SAFE_MAX, "player-drop delivery cursor after");
    if (delivery.cursorBefore === RUST_INTEGRATED_RUNTIME_NATIVE_PLAYER_DROP_SEED_CURSOR_V1
      || delivery.cursorBefore === U64_SAFE_MAX
      || delivery.cursorAfter !== delivery.cursorBefore + 1
      || delivery.receipt.sequence !== delivery.cursorAfter) {
      fail("player-drop-acknowledgement", "player-drop delivery cursor is not exactly contiguous");
    }
    const packet = encodeRustIntegratedRuntimeNativePlayerDropProjectionReceiptV1({
      requestPayloadHash: delivery.requestPayloadHash,
      identity: delivery.queryIdentity,
      cursorAfter: delivery.cursorAfter,
      receipt: delivery.receipt,
    }, delivery.cursorBefore);
    if (rustIntegratedRuntimeWireChecksumV1(packet) !== delivery.projectionPayloadHash) {
      fail("player-drop-acknowledgement", "player-drop delivery payload hash is not exact");
    }
  }

  private playerDropDeliveriesEqual(
    left: RustLiveInputPumpPlayerDropDeliveryV1,
    right: RustLiveInputPumpPlayerDropDeliveryV1,
  ) {
    return left.worldGeneration === right.worldGeneration
      && left.cursorBefore === right.cursorBefore
      && left.cursorAfter === right.cursorAfter
      && left.requestPayloadHash === right.requestPayloadHash
      && left.projectionPayloadHash === right.projectionPayloadHash
      && left.receipt.sequence === right.receipt.sequence
      && left.receipt.receiptHash === right.receipt.receiptHash
      && rustIntegratedRuntimeIdentityEqualsV1(left.queryIdentity, right.queryIdentity);
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
    const lastActionReceipt = step.actionReceipts.length === 0
      ? null
      : Object.freeze({ ...step.actionReceipts[step.actionReceipts.length - 1] });
    return Object.freeze({
      pending,
      authoritativeFlags: flags,
      nextActionSequence: actionSequence,
      lastActionReceipt,
    });
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
    this.nextContextCommandSequence = last.sequence === U64_SAFE_MAX
      ? null
      : integer(last.sequence + 1, 1, U64_SAFE_MAX, "next context command sequence");
  }

  private commitAppliedInput(staged: StagedAppliedInputR5) {
    for (const transition of staged.pending.consumedTransitions) {
      const queue = this.actionTransitions.get(transition.bit)!;
      if (queue[0] !== transition.value) fail("input-transition", "latched action transition changed while input was pending");
      queue.shift();
    }
    this.lastAppliedMoveX = staged.pending.frame.moveX;
    this.lastAppliedMoveZ = staged.pending.frame.moveZ;
    this.lastAppliedButtons = staged.pending.frame.buttons;
    this.selectedSlot = staged.pending.frame.selectedSlot;
    this.authoritativeFlags = staged.authoritativeFlags;
    this.nextActionSequence = staged.nextActionSequence;
    if (staged.lastActionReceipt !== null) this.lastActionReceipt = staged.lastActionReceipt;
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

  private discardedLocatorItemConsume(
    plan: RustLiveLocatorItemConsumePlanV1 | null = null,
  ): RustLiveInputPumpLocatorItemConsumeResultV1 {
    this.discardedContinuations += 1;
    return Object.freeze({ discarded: true, plan, receipt: null, validated: null, extraction: null, player: null });
  }

  private discardedCreativeSlotSet(
    plan: RustLiveCreativeSlotSetPlanV1 | null = null,
  ): RustLiveInputPumpCreativeSlotSetResultV1 {
    this.discardedContinuations += 1;
    return Object.freeze({ discarded: true, plan, receipt: null, validated: null, extraction: null, player: null });
  }

  private discardedPlayerRespawn(
    plan: RustLivePlayerRespawnPlanV1 | null = null,
  ): RustLiveInputPumpPlayerRespawnResultV1 {
    this.discardedContinuations += 1;
    return Object.freeze({
      discarded: true,
      plan,
      receipt: null,
      validated: null,
      extraction: null,
      player: null,
      camera: null,
      view: this.lastView,
      deathRespawn: null,
    });
  }

  private discardedNativeCheckpoint<T>(
    before: RustIntegratedRuntimeIdentityV1 | null = null,
    after: RustIntegratedRuntimeIdentityV1 | null = null,
  ): RustLiveInputPumpNativeCheckpointResultV1<T> {
    this.discardedContinuations += 1;
    return Object.freeze({ discarded: true, value: null, before, after });
  }

  private failClosed(error: unknown) {
    if (this.stateValue !== "ready") return;
    this.stateValue = "failed";
    this.lifecycle += 1;
    this.lastError = errorText(error);
    this.pendingInput = null;
    this.pendingNativeBlockEdit = null;
    this.lastAcknowledgedNativeBlockEdit = null;
    this.pendingBasicDirtAction = null;
    this.lastAcknowledgedBasicDirtAction = null;
    this.pendingDropPickup = null;
    this.lastAcknowledgedDropPickup = null;
    this.pendingPlayerDrop = null;
    this.lastAcknowledgedPlayerDrop = null;
    this.pendingDeathRespawn = null;
    this.lastAcknowledgedDeathRespawn = null;
    this.contextCommandIntents.length = 0;
    for (const queue of this.actionTransitions.values()) queue.length = 0;
  }
}

export function createRustLiveInputPumpR5(options: RustLiveInputPumpOptionsR5) {
  return new RustLiveInputPumpR5(options);
}
