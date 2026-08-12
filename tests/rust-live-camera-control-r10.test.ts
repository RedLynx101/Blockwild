import assert from "node:assert/strict";
import test from "node:test";

import {
  RUST_INTEGRATED_CAMERA_CONFIG_RECEIPT_TYPE_V1,
  decodeRustIntegratedCameraConfigR10,
  encodeRustIntegratedCameraConfigReceiptR10,
  rustIntegratedCameraStateHashR10,
  type RustIntegratedCameraModeR10,
  type RustIntegratedCameraProfileR10,
} from "../app/game/rust-integrated-runtime-camera-r10.ts";
import {
  createRustIntegratedRuntimeDomainOperationV1,
  rustIntegratedRuntimeWireChecksumV1,
} from "../app/game/rust-integrated-runtime-codec.ts";
import type {
  RustIntegratedRuntimeAcceptedReceiptV1,
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeInputFrameV1,
  RustIntegratedRuntimeRejectedReceiptV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustIntegratedPlayerRuntimeContinuityV1 } from "../app/game/rust-integrated-runtime-player-status.ts";
import { rustLiveCameraProfilesEqualR10 } from "../app/game/rust-live-camera-control-r10.ts";
import {
  RustLiveInputPumpR5,
  type RustLiveInputPumpServiceR5,
} from "../app/game/rust-live-input-pump-r5.ts";
import {
  RUST_CAMERA_FIXTURE_EXTERNAL_ENTITY_R10,
  RUST_CAMERA_FIXTURE_PROFILE_R10,
  cameraExtractionFixtureR10,
} from "./helpers/rust-camera-extraction-fixture-r10.ts";

const GENERATION = 17;
const VIEW_ONE = Object.freeze({ viewportWidth: 1_280, viewportHeight: 720, viewRevision: 1 });
const encoder = new TextEncoder();

function hash(value: number) { return value.toString(16).padStart(32, "0").slice(-32); }
function hexBytes(value: string) {
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function identity(tick = 0, simulation = 0, state = 1): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "camera-pump-test",
    locationId: "surface",
    revision: Object.freeze({ epoch: 1, world: 1, entities: 1, gameplay: 1, persistence: 1, network: 1, simulation }),
    tick,
    stateHash: hash(state),
  });
}

type ReceiptWithoutHash = Omit<RustIntegratedRuntimeAcceptedReceiptV1, "receiptHash">
  | Omit<RustIntegratedRuntimeRejectedReceiptV1, "receiptHash">;

function receiptHash(receipt: ReceiptWithoutHash) {
  const bytes: number[] = [...hexBytes(receipt.commandHash)];
  if (receipt.status === "accepted") {
    bytes.push(...hexBytes(receipt.before.stateHash), ...hexBytes(receipt.after.stateHash));
    for (const operation of receipt.domainReceipts) bytes.push(...hexBytes(operation.payloadHash));
  } else {
    bytes.push(...hexBytes(receipt.current.stateHash), ...encoder.encode(receipt.code), ...encoder.encode(receipt.message));
  }
  return rustIntegratedRuntimeWireChecksumV1(Uint8Array.from(bytes));
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

function status() {
  return Object.freeze({
    entityAuthority: Object.freeze({ revision: BigInt(1), nextSequence: BigInt(1), tick: BigInt(0) }),
    continuity: continuity(),
    worldViewBinding: Object.freeze({
      playerId: BigInt("12884901895"),
      revision: BigInt(1),
      actorId: "player:extraction",
      entityId: BigInt("4294967297"),
      inventoryContainer: Object.freeze({ kind: "player" as const, id: "player:extraction", ownerId: "player:extraction" }),
      equipmentContainer: Object.freeze({ kind: "equipment" as const, id: "player:extraction:equipment", ownerId: "player:extraction" }),
      selectedSlot: 0,
      backSlot: 7,
    }),
  });
}

function sameView(left: RustIntegratedRuntimeExtractionViewV1 | null, right: RustIntegratedRuntimeExtractionViewV1) {
  return left !== null && left.viewportWidth === right.viewportWidth
    && left.viewportHeight === right.viewportHeight && left.viewRevision === right.viewRevision;
}

class CameraRuntime implements RustLiveInputPumpServiceR5 {
  current = identity();
  cameraRevision = BigInt(0);
  mode: RustIntegratedCameraModeR10 = "first";
  profile: RustIntegratedCameraProfileR10 = RUST_CAMERA_FIXTURE_PROFILE_R10;
  extractionRevision = 0;
  authorityVersion = 0;
  extractedAuthorityVersion = -1;
  extractedView: RustIntegratedRuntimeExtractionViewV1 | null = null;
  cachedExtraction: RustIntegratedRuntimeExtractionV1 | null = null;
  fixedStepsRemaining = 0;
  nativeInputPending = false;
  readonly calls: string[] = [];
  readonly extractViews: Array<RustIntegratedRuntimeExtractionViewV1 | undefined> = [];
  readonly batches: RustIntegratedRuntimeCommandBatchV1[] = [];
  concurrent = 0;
  maximumConcurrent = 0;
  delayStep: (() => Promise<void>) | null = null;
  delayExtract: (() => Promise<void>) | null = null;
  delayCommand: (() => Promise<void>) | null = null;
  staleCameraCommand = false;
  tamperReceiptMode: RustIntegratedCameraModeR10 | null = null;
  tamperReceiptHash = false;
  extractionModeOverride: RustIntegratedCameraModeR10 | null = null;

  identity() { return this.current; }

  async step(_monotonicTimeUs: number, _budgetUs: number, inputs: readonly RustIntegratedRuntimeInputFrameV1[]) {
    this.enter("step");
    try {
      if (this.delayStep) await this.delayStep();
      if (inputs.length === 1) {
        assert.equal(this.nativeInputPending, false);
        this.nativeInputPending = true;
      }
      const fixedSteps = this.fixedStepsRemaining > 0 ? 1 : 0;
      if (fixedSteps > 0) {
        this.fixedStepsRemaining -= 1;
        this.authorityVersion += 1;
        this.current = identity(this.current.tick + 1, this.current.revision.simulation + 1, 100 + this.authorityVersion);
      }
      const inputsApplied = fixedSteps > 0 && this.nativeInputPending ? 1 : 0;
      if (inputsApplied === 1) this.nativeInputPending = false;
      return Object.freeze({
        type: "runtime-step-result-v1" as const,
        requestId: this.calls.length,
        clientEpoch: 1,
        workerEpoch: 1,
        identity: this.current,
        fixedSteps,
        inputsApplied,
        commandsProcessed: 0,
        commandsAccepted: 0,
        actionReceipts: Object.freeze([]),
        replayHash: hash(900 + this.authorityVersion),
      });
    } finally { this.leave(); }
  }

  async extract(
    afterRevision: number,
    _maxBytes?: number,
    view?: RustIntegratedRuntimeExtractionViewV1,
  ) {
    this.enter("extract");
    this.extractViews.push(view);
    try {
      if (this.delayExtract) await this.delayExtract();
      assert.ok(view, "camera pump must always provide a schema-5 view");
      const changed = this.authorityVersion !== this.extractedAuthorityVersion || !sameView(this.extractedView, view);
      if (changed) {
        this.extractionRevision += 1;
        this.extractedAuthorityVersion = this.authorityVersion;
        this.extractedView = Object.freeze({ ...view });
        this.cachedExtraction = cameraExtractionFixtureR10({
          identity: this.current,
          extractionRevision: this.extractionRevision,
          view,
          cameraRevision: this.cameraRevision,
          mode: this.extractionModeOverride ?? this.mode,
          profile: this.profile,
        });
      }
      assert.ok(this.cachedExtraction);
      if (afterRevision < this.extractionRevision) return this.cachedExtraction;
      return Object.freeze({
        ...this.cachedExtraction,
        render: new Uint8Array(), hud: new Uint8Array(), audio: new Uint8Array(),
        platformRequests: new Uint8Array(), diagnostics: new Uint8Array(),
      });
    } finally { this.leave(); }
  }

  async command(batch: RustIntegratedRuntimeCommandBatchV1) {
    this.enter("command");
    this.batches.push(batch);
    try {
      if (this.delayCommand) await this.delayCommand();
      assert.equal(batch.operations.length, 1);
      const requestOperation = batch.operations[0];
      const request = decodeRustIntegratedCameraConfigR10(requestOperation.payload);
      if (this.staleCameraCommand || request.expectedCameraRevision !== this.cameraRevision) {
        const source = Object.freeze({
          status: "rejected" as const,
          commandId: batch.commandId,
          idempotencyKey: batch.idempotencyKey,
          commandHash: batch.commandHash,
          code: "camera-revision-conflict",
          message: "camera configuration expected revision is stale",
          current: this.current,
        });
        return Object.freeze({ ...source, receiptHash: receiptHash(source) });
      }
      const before = this.current;
      const changed = request.mode !== this.mode || !rustLiveCameraProfilesEqualR10(request.profile, this.profile);
      if (changed) {
        this.cameraRevision += BigInt(1);
        this.mode = request.mode;
        this.profile = request.profile;
        this.authorityVersion += 1;
        this.current = identity(before.tick, before.revision.simulation + 1, 100 + this.authorityVersion);
      }
      const receiptMode = this.tamperReceiptMode ?? this.mode;
      const receiptProfile = this.profile;
      const cameraReceipt = encodeRustIntegratedCameraConfigReceiptR10({
        requestPayloadHash: requestOperation.payloadHash,
        previousCameraRevision: request.expectedCameraRevision,
        resultingCameraRevision: this.cameraRevision,
        mode: receiptMode,
        profile: receiptProfile,
        cameraStateHash: rustIntegratedCameraStateHashR10(this.cameraRevision, receiptMode, receiptProfile),
      });
      const domainReceipt = createRustIntegratedRuntimeDomainOperationV1({
        domain: "simulation",
        typeId: RUST_INTEGRATED_CAMERA_CONFIG_RECEIPT_TYPE_V1,
        schema: 1,
        payload: cameraReceipt,
      });
      const source: Omit<RustIntegratedRuntimeAcceptedReceiptV1, "receiptHash"> = Object.freeze({
        status: "accepted",
        commandId: batch.commandId,
        idempotencyKey: batch.idempotencyKey,
        commandHash: batch.commandHash,
        before,
        after: this.current,
        domainReceipts: Object.freeze([domainReceipt]),
      });
      const validReceiptHash = receiptHash(source);
      return Object.freeze({
        ...source,
        receiptHash: this.tamperReceiptHash ? `${validReceiptHash.slice(0, -1)}${validReceiptHash.endsWith("0") ? "1" : "0"}` : validReceiptHash,
      });
    } finally { this.leave(); }
  }

  private enter(kind: string) {
    this.calls.push(kind);
    this.concurrent += 1;
    this.maximumConcurrent = Math.max(this.maximumConcurrent, this.concurrent);
  }
  private leave() { this.concurrent -= 1; }
}

function pump(runtime: CameraRuntime) {
  return new RustLiveInputPumpR5({
    service: runtime,
    status: status(),
    worldGeneration: GENERATION,
    externalEntityId: RUST_CAMERA_FIXTURE_EXTERNAL_ENTITY_R10,
    nowUs: () => 1,
  });
}

function nextMode(current: RustIntegratedCameraModeR10): RustIntegratedCameraModeR10 {
  return current === "first" ? "third-rear" : current === "third-rear" ? "third-front" : "first";
}

test("view-aware initial sync, step extraction, camera mutation extraction, and next step are one pump tail", async () => {
  const runtime = new CameraRuntime();
  const live = pump(runtime);
  const initial = await live.syncInitial(GENERATION, VIEW_ONE);
  assert.equal(initial.cause, "initial");
  assert.equal(initial.camera?.mode, "first");

  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  runtime.fixedStepsRemaining = 2;
  runtime.delayStep = () => blocked;
  const stepped = live.advance(GENERATION, { view: VIEW_ONE });
  while (runtime.calls.filter((call) => call === "step").length < 2) await Promise.resolve();
  const configured = live.applyCameraConfig(GENERATION, (camera) => ({ mode: nextMode(camera.mode) }), VIEW_ONE);
  const next = live.advance(GENERATION, { view: VIEW_ONE });
  await Promise.resolve();
  assert.equal(runtime.calls.includes("command"), false, "camera command cannot enter between step and extraction");
  runtime.delayStep = null;
  release();
  const [stepResult, cameraResult, nextResult] = await Promise.all([stepped, configured, next]);
  assert.equal(stepResult.cause, "authority");
  assert.equal(cameraResult.changed, true);
  assert.equal(cameraResult.camera?.mode, "third-rear");
  assert.equal(nextResult.cause, "authority");
  assert.deepEqual(runtime.calls, ["step", "extract", "step", "extract", "command", "extract", "step", "extract"]);
  assert.equal(runtime.maximumConcurrent, 1);
  assert.deepEqual(runtime.extractViews, [VIEW_ONE, VIEW_ONE, VIEW_ONE, VIEW_ONE]);
  await live.stop();
});

test("rapid camera transitions author absolute CAS commands from the latest extracted row", async () => {
  const runtime = new CameraRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION, VIEW_ONE);
  const first = live.applyCameraConfig(GENERATION, (camera) => ({ mode: nextMode(camera.mode) }), VIEW_ONE);
  const second = live.applyCameraConfig(GENERATION, (camera) => ({ mode: nextMode(camera.mode) }), VIEW_ONE);
  const [rear, front] = await Promise.all([first, second]);
  assert.equal(rear.camera?.mode, "third-rear");
  assert.equal(front.camera?.mode, "third-front");
  assert.deepEqual(runtime.batches.map((batch) => decodeRustIntegratedCameraConfigR10(batch.operations[0].payload).expectedCameraRevision), [BigInt(0), BigInt(1)]);
  for (const batch of runtime.batches) {
    assert.equal(batch.actorId, "platform:camera");
    assert.equal(batch.commandId, `camera-config:${batch.operations[0].payloadHash}`);
    assert.equal(batch.idempotencyKey, batch.commandId);
    assert.equal(batch.operations[0].domain, "simulation");
    assert.equal(batch.operations[0].typeId, "blockwild.simulation.camera-config.r5.v1");
    assert.equal(batch.operations[0].schema, 1);
    assert.equal(batch.operations[0].payloadHash, rustIntegratedRuntimeWireChecksumV1(batch.operations[0].payload));
  }
  assert.deepEqual(runtime.calls, ["step", "extract", "command", "extract", "command", "extract"]);
  assert.equal(live.diagnostics().cameraRevision, BigInt(2));
  await live.stop();
});

test("same absolute camera state is locally idempotent with no command or extraction", async () => {
  const runtime = new CameraRuntime();
  const live = pump(runtime);
  const initial = await live.syncInitial(GENERATION, VIEW_ONE);
  const beforeCalls = [...runtime.calls];
  const result = await live.applyCameraConfig(GENERATION, {
    mode: initial.camera!.mode,
    profile: initial.camera!.profile,
  }, VIEW_ONE);
  assert.equal(result.changed, false);
  assert.equal(result.receipt, null);
  assert.equal(result.extraction, null);
  assert.deepEqual(runtime.calls, beforeCalls);
  assert.equal(live.diagnostics().commandCalls, 0);
  await live.stop();
});

test("same camera config with a newer view performs only viewport extraction", async () => {
  const runtime = new CameraRuntime();
  const live = pump(runtime);
  const initial = await live.syncInitial(GENERATION, VIEW_ONE);
  const newerView = Object.freeze({ viewportWidth: 1_600, viewportHeight: 900, viewRevision: 2 });
  const result = await live.applyCameraConfig(GENERATION, {
    mode: initial.camera!.mode,
    profile: initial.camera!.profile,
  }, newerView);
  assert.equal(result.changed, false);
  assert.equal(result.receipt, null);
  assert.ok(result.extraction);
  assert.equal(result.camera?.viewRevision, BigInt(2));
  assert.deepEqual(result.camera?.viewport, { width: 1_600, height: 900 });
  assert.deepEqual(runtime.calls, ["step", "extract", "extract"]);
  assert.equal(live.diagnostics().commandCalls, 0);
  assert.equal(live.diagnostics().viewExtractionCalls, 1);
  await live.stop();
});

test("stale camera CAS rejects once, never retries, and fails the pump closed", async () => {
  const runtime = new CameraRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION, VIEW_ONE);
  runtime.staleCameraCommand = true;
  await assert.rejects(
    live.applyCameraConfig(GENERATION, { mode: "third-rear" }, VIEW_ONE),
    (error: unknown) => error instanceof Error && error.message.includes("expected revision is stale"),
  );
  await live.drain();
  assert.equal(live.state, "failed");
  assert.equal(runtime.calls.filter((call) => call === "command").length, 1);
  assert.equal(runtime.calls.filter((call) => call === "extract").length, 1, "rejected CAS must not re-extract");
  assert.throws(() => live.applyCameraConfig(GENERATION, { mode: "third-front" }, VIEW_ONE), /pump is failed/u);
});

test("accepted camera receipt and immediate row must both attest the requested terminal state", async () => {
  const runtime = new CameraRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION, VIEW_ONE);
  runtime.tamperReceiptMode = "third-front";
  await assert.rejects(
    live.applyCameraConfig(GENERATION, { mode: "third-rear" }, VIEW_ONE),
    /does not attest the exact requested absolute camera state/u,
  );
  await live.drain();
  assert.equal(live.state, "failed");
  assert.deepEqual(runtime.calls, ["step", "extract", "command"], "invalid receipt fails before extraction");

  const badHashRuntime = new CameraRuntime();
  const badHashPump = pump(badHashRuntime);
  await badHashPump.syncInitial(GENERATION, VIEW_ONE);
  badHashRuntime.tamperReceiptHash = true;
  await assert.rejects(
    badHashPump.applyCameraConfig(GENERATION, { mode: "third-rear" }, VIEW_ONE),
    /receipt hash is invalid/u,
  );
  await badHashPump.drain();
  assert.equal(badHashPump.state, "failed");
  assert.deepEqual(badHashRuntime.calls, ["step", "extract", "command"]);

  const badRowRuntime = new CameraRuntime();
  const badRowPump = pump(badRowRuntime);
  await badRowPump.syncInitial(GENERATION, VIEW_ONE);
  badRowRuntime.extractionModeOverride = "third-front";
  await assert.rejects(
    badRowPump.applyCameraConfig(GENERATION, { mode: "third-rear" }, VIEW_ONE),
    /post-command camera row does not match/u,
  );
  await badRowPump.drain();
  assert.equal(badRowPump.state, "failed");
  assert.deepEqual(badRowRuntime.calls, ["step", "extract", "command", "extract"]);
});

test("viewport refresh is serialized, monotonic, idempotent, and permits coalesced revision skips", async () => {
  const runtime = new CameraRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION, VIEW_ONE);
  const calls = runtime.calls.length;
  const same = await live.refreshView(GENERATION, VIEW_ONE);
  assert.equal(same.cause, null);
  assert.equal(runtime.calls.length, calls);

  const viewThree = Object.freeze({ viewportWidth: 1_440, viewportHeight: 900, viewRevision: 3 });
  const refreshed = await live.refreshView(GENERATION, viewThree);
  assert.equal(refreshed.cause, "viewport");
  assert.equal(refreshed.camera?.authorityTick, BigInt(0));
  assert.equal(refreshed.camera?.viewRevision, BigInt(3));
  assert.deepEqual(refreshed.camera?.viewport, { width: 1_440, height: 900 });
  assert.equal(refreshed.extraction?.identity, runtime.identity());

  const viewEight = Object.freeze({ viewportWidth: 1_920, viewportHeight: 1_080, viewRevision: 8 });
  await live.refreshView(GENERATION, viewEight);
  const beforeRejected = runtime.calls.length;
  assert.throws(
    () => live.refreshView(GENERATION, { ...viewEight, viewportWidth: 1_921 }),
    /revision was reused/u,
  );
  assert.throws(
    () => live.refreshView(GENERATION, { viewportWidth: 800, viewportHeight: 600, viewRevision: 7 }),
    /revision regressed/u,
  );
  assert.equal(runtime.calls.length, beforeRejected, "conflicts reject before service I/O");
  assert.equal(live.diagnostics().viewExtractionCalls, 2);
  assert.deepEqual(live.diagnostics().lastView, viewEight);
  await live.stop();
});

test("ordinary advance refreshes a changed view even when authority does not step", async () => {
  const runtime = new CameraRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION, VIEW_ONE);
  const viewTwo = Object.freeze({ viewportWidth: 1_360, viewportHeight: 768, viewRevision: 2 });
  const result = await live.advance(GENERATION, { view: viewTwo });
  assert.equal(result.step?.fixedSteps, 0);
  assert.equal(result.cause, "viewport");
  assert.equal(result.camera?.authorityTick, BigInt(0));
  assert.equal(result.camera?.viewRevision, BigInt(2));
  assert.deepEqual(result.camera?.viewport, { width: 1_360, height: 768 });
  assert.deepEqual(runtime.calls, ["step", "extract", "step", "extract"]);
  assert.equal(live.diagnostics().viewExtractionCalls, 1);
  await live.stop();
});

test("queued viewport high-water rejects regressions before I/O while allowing skipped revisions", async () => {
  const runtime = new CameraRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION, VIEW_ONE);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  runtime.delayExtract = () => blocked;
  const viewFour = Object.freeze({ viewportWidth: 1_000, viewportHeight: 700, viewRevision: 4 });
  const viewNine = Object.freeze({ viewportWidth: 1_600, viewportHeight: 900, viewRevision: 9 });
  const four = live.refreshView(GENERATION, viewFour);
  while (runtime.calls.filter((call) => call === "extract").length < 2) await Promise.resolve();
  const nine = live.refreshView(GENERATION, viewNine);
  assert.throws(
    () => live.refreshView(GENERATION, { viewportWidth: 1_200, viewportHeight: 800, viewRevision: 8 }),
    /revision regressed/u,
  );
  runtime.delayExtract = null;
  release();
  const [fourResult, nineResult] = await Promise.all([four, nine]);
  assert.equal(fourResult.camera?.viewRevision, BigInt(4));
  assert.equal(nineResult.camera?.viewRevision, BigInt(9));
  assert.equal(runtime.maximumConcurrent, 1);
  await live.stop();
});

test("stop discards an awaited camera command continuation without post-stop extraction", async () => {
  const runtime = new CameraRuntime();
  const live = pump(runtime);
  await live.syncInitial(GENERATION, VIEW_ONE);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  runtime.delayCommand = () => blocked;
  const configuring = live.applyCameraConfig(GENERATION, { mode: "third-rear" }, VIEW_ONE);
  while (!runtime.calls.includes("command")) await Promise.resolve();
  const stopping = live.stop();
  runtime.delayCommand = null;
  release();
  assert.deepEqual(await configuring, { discarded: true, changed: false, receipt: null, extraction: null, camera: null });
  await stopping;
  assert.equal(live.state, "stopped");
  assert.deepEqual(runtime.calls, ["step", "extract", "command"]);
});
