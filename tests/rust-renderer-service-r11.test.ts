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
  postMessage(command: RustRendererWorkerCommandR11) { this.commands.push(command); }
  terminate() { this.terminated = true; }
  emit(value: RustRendererWorkerEventR11) { this.onmessage?.({ data: value } as MessageEvent<RustRendererWorkerEventR11>); }
  crash(message = "synthetic worker crash") { this.onerror?.({ message } as ErrorEvent); }
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
  fake.emit({ type: "ready", backend: "wgpu", adapter: "test", timestampQuerySupported: true, epoch: frame.epoch });
  service.applyResources(resources);
  service.present(frame);
  service.present(createRenderFrameV2({ ...frame, frameSequence: frame.frameSequence + BigInt(1) }));
  service.present(createRenderFrameV2({ ...frame, frameSequence: frame.frameSequence + BigInt(2) }));
  assert.equal(fake.commands.filter((command) => command.type === "frame").length, 1);
  assert.equal(service.snapshot().droppedFrames, 1);
  fake.emit({ type: "frame-presented", sequence: frame.frameSequence, cpuMicros: 400, gpuMicros: 900, visibleInstances: 3, culledInstances: 1, drawCalls: 3, transparentDrawCalls: 1, geometryBytes: 680, instanceBytes: 240, residentInstanceBytes: 512, instanceBufferReallocations: 1, skippedReason: null, bytes: 537 });
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
  fake.emit({ type: "ready", backend: "wgpu", adapter: "test", timestampQuerySupported: false, epoch: frame.epoch });
  service.applyResources(resources);
  fake.emit({ type: "device-lost", reason: "synthetic reset" });
  assert.equal(fake.commands.at(-1)?.type, "recover");
  fake.emit({ type: "replay-required", epoch: frame.epoch, reason: "device recreated" });
  assert.equal(fake.commands.filter((command) => command.type === "resources").length, 2);
  assert.equal(service.snapshot().replayedResourceBytes, 1097);
  assert.equal(service.snapshot().lastError, null);
});

test("explicit recovery and resize commands preserve one deterministic replay source", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  service.resize(1280, 720);
  assert.equal(fake.commands.length, 1, "resize remains queued until the worker surface exists");
  fake.emit({ type: "ready", backend: "wgpu", adapter: "test", timestampQuerySupported: false, epoch: frame.epoch });
  service.applyResources(resources);
  assert.deepEqual(fake.commands[1], { type: "resize", width: 1280, height: 720 });
  service.requestRecovery("test recreate");
  assert.equal(service.snapshot().state, "recovering");
  assert.deepEqual(fake.commands.at(-1), { type: "recover", epoch: frame.epoch });
  fake.emit({ type: "replay-required", epoch: frame.epoch, reason: "device recreated" });
  assert.equal(fake.commands.filter((command) => command.type === "resources").length, 2);
});

test("world epoch switch clears replay history so source revisions restart at one", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  fake.emit({ type: "ready", backend: "wgpu", adapter: "test", timestampQuerySupported: false, epoch: frame.epoch });
  assert.equal(service.applyResources(resources), true);
  const nextEpoch = frame.epoch + BigInt(1);
  service.switchEpoch(nextEpoch);
  assert.equal(service.snapshot().epoch, nextEpoch);
  assert.equal(service.snapshot().resourceRevision, BigInt(0));
  assert.deepEqual(fake.commands.at(-1), { type: "recover", epoch: nextEpoch });
  fake.emit({ type: "frame-presented", sequence: BigInt(99), cpuMicros: 1, gpuMicros: null, visibleInstances: 9, culledInstances: 0, drawCalls: 9, transparentDrawCalls: 0, geometryBytes: 9, instanceBytes: 9, residentInstanceBytes: 9, instanceBufferReallocations: 9, skippedReason: null, bytes: 9 });
  assert.equal(service.snapshot().lastPresentedSequence, null, "a prior-world frame acknowledgement cannot mutate the new epoch");
  const nextResources = createRenderResourceBatchV2({ epoch: nextEpoch, revision: BigInt(1), operations: resources.operations });
  assert.equal(service.applyResources(nextResources), true);
  assert.equal(service.snapshot().resourceRevision, BigInt(1));
  fake.emit({ type: "replay-required", epoch: nextEpoch, reason: "world switch" });
  assert.equal(fake.commands.filter((command) => command.type === "resources").length, 2);
  const nextFrame = createRenderFrameV2({
    ...frame,
    epoch: nextEpoch,
    frameSequence: BigInt(100),
    resourceRevision: BigInt(1),
  });
  assert.equal(service.present(nextFrame), true);
  fake.emit({ type: "frame-presented", sequence: BigInt(99), cpuMicros: 1, gpuMicros: null, visibleInstances: 9, culledInstances: 0, drawCalls: 9, transparentDrawCalls: 0, geometryBytes: 9, instanceBytes: 9, residentInstanceBytes: 9, instanceBufferReallocations: 9, skippedReason: null, bytes: 9 });
  assert.equal(service.snapshot().lastPresentedSequence, null, "a late prior-world acknowledgement cannot complete a new-world frame");
  fake.emit({ type: "frame-presented", sequence: BigInt(100), cpuMicros: 2, gpuMicros: null, visibleInstances: 1, culledInstances: 0, drawCalls: 1, transparentDrawCalls: 0, geometryBytes: 1, instanceBytes: 1, residentInstanceBytes: 1, instanceBufferReallocations: 0, skippedReason: null, bytes: 1 });
  assert.equal(service.snapshot().lastPresentedSequence, BigInt(100));
  assert.throws(() => service.switchEpoch(BigInt(0)), /positive u64/u);
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
  fake.emit({ type: "ready", backend: "wgpu", adapter: "test", timestampQuerySupported: false, epoch: frame.epoch });
  assert.deepEqual(fake.commands.at(-1), { type: "recover", epoch: nextEpoch });
  assert.equal(service.snapshot().state, "recovering");
  fake.emit({ type: "replay-required", epoch: nextEpoch, reason: "startup world switch" });
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
  fake.emit({ type: "error", operation: "initialize", message: "WebGPU adapter unavailable" });
  assert.equal(service.present(frame), false);
  assert.equal(service.snapshot().frameBytes, 0);
  assert.equal(fake.commands.filter((command) => command.type === "frame").length, 0);
});

test("worker crash replacement replays resources but never stale frame history", async () => {
  const first = new FakeWorker(), replacement = new FakeWorker();
  const workers = [first, replacement];
  const service = new RustRendererServiceR11(() => workers.shift() as never);
  const resources = decodeRenderResourceBatchV2(await fixture("canonical-resources.bwrd"));
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  first.emit({ type: "ready", backend: "wgpu", adapter: "first", timestampQuerySupported: false, epoch: frame.epoch });
  assert.equal(service.applyResources(resources), true);
  assert.equal(service.present(frame), true);
  first.crash("GPU process exited");
  assert.equal(service.snapshot().state, "failed");
  assert.equal(service.snapshot().lastError, "worker: GPU process exited");
  assert.equal(service.present(frame), false);

  service.restartSurface({} as OffscreenCanvas, 800, 450);
  assert.equal(first.terminated, true);
  assert.equal(replacement.commands[0]?.type, "initialize");
  replacement.emit({ type: "ready", backend: "wgpu", adapter: "replacement", timestampQuerySupported: true, epoch: frame.epoch });
  assert.equal(replacement.commands.filter((command) => command.type === "resources").length, 1);
  assert.equal(replacement.commands.filter((command) => command.type === "frame").length, 0, "a crash must not replay stale presentation history");
  assert.equal(service.snapshot().workerRestarts, 1);
  assert.equal(service.snapshot().replayedResourceBytes, 1097, "surface replacement must account for its full durable replay");
  assert.equal(service.snapshot().adapter, "replacement");
  assert.equal(service.present(createRenderFrameV2({ ...frame, frameSequence: frame.frameSequence + BigInt(1) })), true);
  assert.equal(replacement.commands.filter((command) => command.type === "frame").length, 1);
});

test("worker recovery rejects an epoch substitution before replay", async () => {
  const fake = new FakeWorker();
  const service = new RustRendererServiceR11(() => fake as never);
  const frame = decodeRenderFrameV2(await fixture("canonical-frame.bwrf"));
  service.start({} as OffscreenCanvas, { moduleUrl: "/renderer.js", wasmUrl: "/renderer.wasm" }, frame.epoch, 640, 360);
  fake.emit({ type: "ready", backend: "wgpu", adapter: "test", timestampQuerySupported: false, epoch: frame.epoch + BigInt(1) });
  assert.equal(service.snapshot().state, "failed");
  assert.match(service.snapshot().lastError ?? "", /epoch mismatch/u);
});
