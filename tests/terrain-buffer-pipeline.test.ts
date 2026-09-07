import assert from "node:assert/strict";
import test from "node:test";
import { mergeTerrainGeometry, TerrainBufferPipeline, type TerrainSectionGeometry } from "../app/game/terrain-buffer-pipeline.ts";

class FailingWorker {
  static instance: FailingWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() { FailingWorker.instance = this; }
  postMessage() {}
  terminate() {}
  ready() { this.onmessage?.({ data: { type: "ready", protocol: 1 } } as MessageEvent); }
  fail() { this.onerror?.({} as ErrorEvent); }
}

const withFakeBrowserWorker = (run: () => void) => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  FailingWorker.instance = null;
  Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FailingWorker });
  try {
    run();
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else delete (globalThis as { document?: unknown }).document;
    if (workerDescriptor) Object.defineProperty(globalThis, "Worker", workerDescriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
  }
};

const triangle = (offset: number): TerrainSectionGeometry => ({
  positions: new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0]),
  normals: new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]),
  colors: new Uint8Array(9).fill(255),
  lights: new Uint8Array(12).fill(128),
  emissions: new Uint8Array(3),
  occlusions: new Uint8Array(3).fill(255),
  uvs: new Uint16Array([0, 0, 65535, 0, 0, 65535]),
  indices: new Uint16Array([0, 1, 2]),
});

test("terrain buffer worker kernel preserves attributes and rebases section indices", () => {
  const merged = mergeTerrainGeometry([triangle(0), triangle(2)]);
  assert.ok(merged);
  assert.deepEqual([...merged.indices], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual([...merged.positions], [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0]);
  assert.equal(merged.lights.length, 24);
  assert.equal(merged.uvs.length, 12);
});

test("a failed buffer worker clears pending work and degrades to the exact synchronous kernel", () => {
  withFakeBrowserWorker(() => {
    const pipeline = new TerrainBufferPipeline();
    let failed = 0;
    assert.ok(FailingWorker.instance);
    FailingWorker.instance.ready();
    pipeline.submit([triangle(0)], () => assert.fail("failed worker must not complete"), () => { failed += 1; });
    FailingWorker.instance.fail();
    assert.equal(failed, 1);
    assert.equal(pipeline.diagnostics().pending, 0);
    assert.equal(pipeline.diagnostics().failed, 1);
    let fallbackIndices: number[] = [];
    pipeline.submit([triangle(2)], (geometry) => { fallbackIndices = [...(geometry?.indices ?? [])]; });
    assert.deepEqual(fallbackIndices, [0, 1, 2]);
    pipeline.dispose();
  });
});
