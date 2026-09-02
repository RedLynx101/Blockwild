import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRenderFrameV2, createRenderResourceBatchV2, decodeRenderFrameV2, decodeRenderResourceBatchV2 } from "../app/game/rust-render-extraction-v2.ts";
import { RustRendererServiceR11, loadRustRendererArtifactR11 } from "../app/game/rust-renderer-service-r11.ts";
import type { RustRendererWorkerCommandR11, RustRendererWorkerEventR11 } from "../app/game/rust-renderer-worker-r11.ts";

class FakeWorker {
  onmessage: ((event: MessageEvent<RustRendererWorkerEventR11>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly commands: RustRendererWorkerCommandR11[] = [];
  terminated = false;
  constructor(private readonly initializeTransferError: Error | null = null) {}
  postMessage(command: RustRendererWorkerCommandR11) {
    if (command.type === "initialize" && this.initializeTransferError) throw this.initializeTransferError;
    this.commands.push(command);
  }
  terminate() { this.terminated = true; }
  emit(value: RustRendererWorkerEventR11) { this.onmessage?.({ data: value } as MessageEvent<RustRendererWorkerEventR11>); }
  crash(message = "synthetic worker crash") { this.onerror?.({ message } as ErrorEvent); }
}

type WorkerLifecycle = Readonly<{ epoch: bigint; surfaceGeneration: number; recoveryGeneration: number }>;

function lifecycle(command: RustRendererWorkerCommandR11 | undefined): WorkerLifecycle {
  assert.ok(command, "expected a worker command with lifecycle metadata");
  return {
    epoch: command.epoch,
    surfaceGeneration: command.surfaceGeneration,
    recoveryGeneration: command.recoveryGeneration,
  };
}

function initializeLifecycle(worker: FakeWorker) {
  return lifecycle(worker.commands.find((command) => command.type === "initialize"));
}

function recoveryLifecycle(worker: FakeWorker) {
  return lifecycle(worker.commands.findLast((command) => command.type === "recover"));
}

function frameLifecycle(worker: FakeWorker) {
  return lifecycle(worker.commands.findLast((command) => command.type === "frame"));
}

function emitReady(worker: FakeWorker, overrides: Partial<WorkerLifecycle> & Readonly<{ backend?: string; adapter?: string; timestampQuerySupported?: boolean }> = {}) {
  worker.emit({
    type: "ready",
    backend: overrides.backend ?? "wgpu",
    adapter: overrides.adapter ?? "test",
    timestampQuerySupported: overrides.timestampQuerySupported ?? false,
    ...initializeLifecycle(worker),
    ...overrides,
  });
}

function emitReplayRequired(worker: FakeWorker, reason = "device recreated", overrides: Partial<WorkerLifecycle> = {}) {
  worker.emit({ type: "replay-required", reason, ...recoveryLifecycle(worker), ...overrides });
}

function framePresented(sequence: bigint, lifecycleValue: WorkerLifecycle, overrides: Partial<Extract<RustRendererWorkerEventR11, { type: "frame-presented" }>> = {}): Extract<RustRendererWorkerEventR11, { type: "frame-presented" }> {
  return {
    type: "frame-presented", sequence, cpuMicros: 1, gpuMicros: null,
    visibleInstances: 1, culledInstances: 0, drawCalls: 1, transparentDrawCalls: 0,
    geometryBytes: 1, instanceBytes: 1, residentInstanceBytes: 1,
    instanceBufferReallocations: 0, skippedReason: null, bytes: 1,
    ...lifecycleValue,
    ...overrides,
  };
}

async function fixture(name: string) {
  return new Uint8Array(await readFile(new URL(`fixtures/rust-engine/r11-renderer/${name}`, import.meta.url)));
}

test("renderer service bounds backpressure to one in-flight and one latest frame", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  emitReady(fake, { timestampQuerySupported: true });
  service.applyResources(resources);
  service.present(frame);
  service.present(createRenderFrameV2({ ...frame, frameSequence: frame.frameSequence + BigInt(1) }));
  service.present(createRenderFrameV2({ ...frame, frameSequence: frame.frameSequence + BigInt(2) }));
  assert.equal(fake.commands.filter((command) => command.type === "frame").length, 1);
  assert.equal(service.snapshot().droppedFrames, 1);
  fake.emit(framePresented(frame.frameSequence, frameLifecycle(fake), {
    cpuMicros: 400, gpuMicros: 900, visibleInstances: 3, culledInstances: 1,
    drawCalls: 3, transparentDrawCalls: 1, geometryBytes: 680,
    instanceBytes: 240, residentInstanceBytes: 512, instanceBufferReallocations: 1,
    bytes: 537,
  }));
  assert.equal(fake.commands.filter((command) => command.type === "frame").length, 2);
  assert.equal((fake.commands.at(-1) as Extract<RustRendererWorkerCommandR11, { type: "frame" }>).sequence, frame.frameSequence + BigInt(2));
  assert.equal(service.snapshot().latestGpuMicros, 900);
  assert.equal(service.snapshot().transparentDrawCalls, 1);
  assert.equal(service.snapshot().residentInstanceBytes, 512);
  assert.equal(service.snapshot().timestampQuerySupported, true);
  service.stop();
  assert.equal(fake.terminated, true);
});

test("device recovery replays durable resource pages and not stale frame history", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  const observedStates: string[] = [];
  const unsubscribe = service.subscribe((diagnostics) => { observedStates.push(diagnostics.state); });
  emitReady(fake);
  service.applyResources(resources);
  service.present(frame);
  fake.emit(framePresented(frame.frameSequence, frameLifecycle(fake)));
  assert.equal(service.snapshot().lastPresentedSequence, frame.frameSequence);
  fake.emit({ type: "device-lost", reason: "synthetic reset", ...initializeLifecycle(fake) });
  assert.equal(fake.commands.at(-1)?.type, "recover");
  assert.equal(service.snapshot().lastPresentedSequence, null, "a lost surface cannot retain a visibility-ready frame marker");
  emitReplayRequired(fake);
  assert.equal(fake.commands.filter((command) => command.type === "resources").length, 2);
  assert.equal(service.snapshot().replayedResourceBytes, 1097);
  assert.equal(service.snapshot().lastError, null);
  assert.ok(observedStates.includes("recovering"));
  unsubscribe();
});

test("explicit recovery and resize commands preserve one deterministic replay source", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  service.resize(1280, 720);
  assert.equal(fake.commands.length, 1, "resize remains queued until the worker surface exists");
  emitReady(fake);
  service.applyResources(resources);
  assert.deepEqual(fake.commands[1], { type: "resize", width: 1280, height: 720, ...initializeLifecycle(fake) });
  service.requestRecovery("test recreate");
  assert.equal(service.snapshot().state, "recovering");
  assert.deepEqual(fake.commands.at(-1), { type: "recover", ...recoveryLifecycle(fake) });
  emitReplayRequired(fake);
  assert.equal(fake.commands.filter((command) => command.type === "resources").length, 2);
});

test("manual and device-loss recovery requests coalesce into one generation", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  emitReady(fake);

  assert.equal(service.requestRecovery("manual one"), true);
  assert.equal(service.requestRecovery("manual duplicate"), true);
  fake.emit({ type: "device-lost", reason: "late loss notification", ...initializeLifecycle(fake) });
  fake.emit({ type: "error", operation: "frame", message: "late old-surface error", ...initializeLifecycle(fake) });
  assert.equal(fake.commands.filter((command) => command.type === "recover").length, 1);
  assert.equal(service.snapshot().coalescedRecoveryRequests, 2);
  assert.equal(service.snapshot().deviceRecoveries, 1);
  assert.equal(service.snapshot().state, "recovering", "a pre-recovery error generation is inert");

  emitReplayRequired(fake);
  const staleBefore = service.snapshot().staleLifecycleEvents;
  emitReplayRequired(fake, "duplicate completion");
  assert.equal(service.snapshot().state, "ready");
  assert.equal(service.snapshot().staleLifecycleEvents, staleBefore + 1);
});

test("duplicate device-loss notifications start only one recovery command", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  emitReady(fake);
  const activeLifecycle = initializeLifecycle(fake);
  fake.emit({ type: "device-lost", reason: "loss one", ...activeLifecycle });
  fake.emit({ type: "device-lost", reason: "loss duplicate", ...activeLifecycle });
  assert.equal(fake.commands.filter((command) => command.type === "recover").length, 1);
  assert.equal(service.snapshot().coalescedRecoveryRequests, 1);
});

test("world epoch switch clears replay history so source revisions restart at one", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  emitReady(fake);
  const observedStates: string[] = [];
  const unsubscribe = service.subscribe((diagnostics) => { observedStates.push(diagnostics.state); });
  assert.equal(service.applyResources(resources), true);
  assert.equal(service.present(frame), true);
  const priorFrameLifecycle = frameLifecycle(fake);
  const nextEpoch = frame.epoch + BigInt(1);
  service.switchEpoch(nextEpoch);
  assert.equal(observedStates.at(-1), "recovering", "the shell observes fallback before recovery is sent");
  assert.equal(service.snapshot().epoch, nextEpoch);
  assert.equal(service.snapshot().resourceRevision, BigInt(0));
  assert.deepEqual(fake.commands.at(-1), { type: "recover", ...recoveryLifecycle(fake) });
  fake.emit(framePresented(frame.frameSequence, priorFrameLifecycle, { visibleInstances: 9, drawCalls: 9 }));
  assert.equal(service.snapshot().lastPresentedSequence, null, "a prior-world frame acknowledgement cannot mutate the new epoch");
  const nextResources = createRenderResourceBatchV2({ epoch: nextEpoch, revision: BigInt(1), operations: resources.operations });
  assert.equal(service.applyResources(nextResources), true);
  assert.equal(service.snapshot().resourceRevision, BigInt(1));
  emitReplayRequired(fake, "world switch");
  assert.equal(fake.commands.filter((command) => command.type === "resources").length, 2);
  const nextFrame = createRenderFrameV2({
    ...frame,
    epoch: nextEpoch,
    frameSequence: frame.frameSequence,
    resourceRevision: BigInt(1),
  });
  assert.equal(service.present(nextFrame), true);
  fake.emit(framePresented(nextFrame.frameSequence, priorFrameLifecycle, { visibleInstances: 9, drawCalls: 9 }));
  assert.equal(service.snapshot().lastPresentedSequence, null, "a late prior-world acknowledgement cannot complete a new-world frame");
  fake.emit(framePresented(nextFrame.frameSequence, frameLifecycle(fake), { cpuMicros: 2 }));
  assert.equal(service.snapshot().lastPresentedSequence, frame.frameSequence);
  assert.throws(() => service.switchEpoch(BigInt(0)), /positive u64/u);
  unsubscribe();
});

test("stale epoch and surface-generation acknowledgements are inert", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  emitReady(fake);
  service.applyResources(resources);
  service.present(frame);
  const active = frameLifecycle(fake);

  fake.emit(framePresented(frame.frameSequence, { ...active, epoch: active.epoch + BigInt(1) }));
  fake.emit(framePresented(frame.frameSequence, { ...active, surfaceGeneration: active.surfaceGeneration + 1 }));
  assert.equal(service.snapshot().presentedFrames, 0);
  assert.equal(service.snapshot().state, "ready");
  assert.equal(service.snapshot().staleLifecycleEvents, 2);

  fake.emit(framePresented(frame.frameSequence, active));
  assert.equal(service.snapshot().presentedFrames, 1);
});

test("epoch switch during worker startup waits for the old surface before recovering the new world", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  const nextEpoch = frame.epoch + BigInt(1);
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  service.switchEpoch(nextEpoch);
  assert.equal(fake.commands.length, 1, "recover cannot race the still-initializing surface");
  assert.equal(service.applyResources(createRenderResourceBatchV2({
    epoch: nextEpoch,
    revision: BigInt(1),
    operations: resources.operations,
  })), true);
  emitReady(fake);
  assert.deepEqual(fake.commands.at(-1), { type: "recover", ...recoveryLifecycle(fake) });
  assert.equal(service.snapshot().state, "recovering");
  emitReplayRequired(fake, "startup world switch");
  assert.equal(service.snapshot().state, "ready");
  assert.equal(fake.commands.filter((command) => command.type === "resources").length, 1);
});

test("published renderer selection is content-addressed and rejects path substitution", async () => {
  const hash = "a".repeat(64);
  const manifest = {
    runtime: {
      schema: 1, backend: "wgpu-webgpu", artifactHash: hash,
      module: `${hash}/renderer.js`, wasm: `${hash}/renderer_bg.wasm`,
      resourceFixture: `${hash}/canonical-resources.bwrd`, frameFixture: `${hash}/canonical-frame.bwrf`,
      liveResourceFixture: `${hash}/live-resources.bwrd`, liveFrameFixture: `${hash}/live-frame.bwrf`,
      visualMatrix: {
        manifest: `${hash}/matrix.json`,
        scenes: Array.from({ length: 7 }, (_, index) => ({
          name: `scene-${index}`,
          purpose: `Scene ${index}`,
          resourceFixture: `${hash}/scene-${index}-resources.bwrd`,
          frameFixture: `${hash}/scene-${index}-frame.bwrf`,
        })),
      },
    },
  };
  const selected = await loadRustRendererArtifactR11({ fetcher: async () => Response.json(manifest) });
  assert.equal(selected.moduleUrl, `/renderer/${hash}/renderer.js`);
  assert.equal(selected.visualMatrixScenes.length, 7);
  await assert.rejects(
    loadRustRendererArtifactR11({ fetcher: async () => Response.json({ ...manifest, runtime: { ...manifest.runtime, wasm: "../evil.wasm" } }) }),
    /content-addressed safely/,
  );
  const duplicatedScenes = manifest.runtime.visualMatrix.scenes.map((scene, index) => index === 6
    ? { ...scene, name: manifest.runtime.visualMatrix.scenes[0]!.name }
    : scene);
  await assert.rejects(
    loadRustRendererArtifactR11({ fetcher: async () => Response.json({
      ...manifest,
      runtime: { ...manifest.runtime, visualMatrix: { ...manifest.runtime.visualMatrix, scenes: duplicatedScenes } },
    }) }),
    /duplicated/,
  );
});

test("failed capability fallback does not keep encoding or queueing animation frames", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  fake.emit({ type: "error", operation: "initialize", message: "WebGPU adapter unavailable", ...initializeLifecycle(fake) });
  assert.equal(service.present(frame), false);
  assert.equal(service.snapshot().frameBytes, 0);
  assert.equal(fake.commands.filter((command) => command.type === "frame").length, 0);
});

test("startup transfer failure stays failed and requires an explicit replacement surface", async () => {
  const fake = new FakeWorker(new DOMException("OffscreenCanvas transfer failed", "DataCloneError"));
  const service = new RustRendererServiceR11(() => fake as never);
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, BigInt(1), 640, 360);
  await assert.rejects(service.ready(), /transfer failed/u);
  assert.equal(service.snapshot().state, "failed");
  assert.equal(service.snapshot().replacementSurfaceRequired, true);
  assert.equal(fake.commands.length, 0);
});

test("replay pressure and overflow diagnostics are integer-deterministic", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never, { maxPages: 1, maxBytes: Number.MAX_SAFE_INTEGER });
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  emitReady(fake);
  assert.equal(service.applyResources(resources), true);
  assert.equal(service.snapshot().replayPressurePermille, 1_000);
  const second = createRenderResourceBatchV2({ epoch: frame.epoch, revision: BigInt(2), operations: resources.operations });
  assert.throws(() => service.applyResources(second), /page-limit exceeded/u);
  assert.deepEqual(service.snapshot().lastReplayOverflow, {
    code: "page-limit",
    attemptedBytes: 2_194,
    attemptedPages: 2,
    maxBytes: Number.MAX_SAFE_INTEGER,
    maxPages: 1,
  });
  assert.equal(service.snapshot().replayOverflowCount, 1);
  assert.equal(service.snapshot().resourceRevision, BigInt(1), "overflow cannot partially advance durable replay state");
});

test("worker crash replacement replays exact resource bytes once and in revision order", async () => {
  const first = new FakeWorker(), replacement = new FakeWorker();
  const workers = [first, replacement];
  const service = new RustRendererServiceR11(() => workers.shift() as never);
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  emitReady(first, { adapter: "first" });
  assert.equal(service.applyResources(resources), true);
  assert.equal(service.applyResources(createRenderResourceBatchV2({
    epoch: frame.epoch,
    revision: BigInt(2),
    operations: resources.operations,
  })), true);
  const originalReplay = first.commands
    .filter((command): command is Extract<RustRendererWorkerCommandR11, { type: "resources" }> => command.type === "resources")
    .map((command) => new Uint8Array(command.bytes).slice());
  assert.equal(service.present(frame), true);
  first.crash("GPU process exited");
  assert.equal(service.snapshot().state, "failed");
  assert.equal(service.snapshot().lastError, "worker: GPU process exited");
  assert.equal(service.present(frame), false);

  service.restartSurface({} as OffscreenCanvas, 800, 450);
  assert.equal(first.terminated, true);
  assert.equal(replacement.commands[0]?.type, "initialize");
  emitReady(replacement, { adapter: "replacement", timestampQuerySupported: true });
  const replacementReplay = replacement.commands
    .filter((command): command is Extract<RustRendererWorkerCommandR11, { type: "resources" }> => command.type === "resources")
    .map((command) => new Uint8Array(command.bytes).slice());
  assert.deepEqual(replacementReplay, originalReplay);
  emitReady(replacement, { adapter: "duplicate-ready" });
  assert.equal(replacement.commands.filter((command) => command.type === "resources").length, 2, "duplicate ready cannot replay history twice");
  assert.equal(replacement.commands.filter((command) => command.type === "frame").length, 0, "a crash must not replay stale presentation history");
  assert.equal(service.snapshot().workerRestarts, 1);
  assert.equal(service.snapshot().replayedResourceBytes, 2_194, "surface replacement must account for its full durable replay");
  assert.equal(service.snapshot().adapter, "replacement");
  assert.equal(service.present(createRenderFrameV2({ ...frame, frameSequence: frame.frameSequence + BigInt(1) })), true);
  assert.equal(replacement.commands.filter((command) => command.type === "frame").length, 1);
});

test("worker recovery rejects an epoch substitution before replay", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  emitReady(fake, { epoch: frame.epoch + BigInt(1) });
  assert.equal(service.snapshot().state, "failed");
  assert.match(service.snapshot().lastError ?? "", /epoch.*mismatch|lifecycle mismatch/u);
});
