import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function gameSource(name: string) {
  return readFile(new URL(`../app/game/${name}`, import.meta.url), "utf8");
}

function method(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source interval ${startMarker}`);
  return source.slice(start, end);
}

test("React shell transfers the cutover sink and epoch without constructing a parallel publisher", async () => {
  const shell = await gameSource("VoxelGame.tsx");
  assert.match(shell, /rustRenderSink:\s*rendererCutover\.needsExtraction \? rendererCutover : undefined/u);
  assert.match(shell, /rustRenderEpoch:\s*rendererCutover\.needsExtraction \? rendererEpoch : undefined/u);
  assert.doesNotMatch(shell, /new RendererShellExtractionPublisherR11/u);
  assert.match(shell, /producer:\s*engine\.getRustLiveRenderDiagnosticsR10\(\)/u);
  assert.match(shell, /engine\.shutdown\(\).*\.finally\(\(\) => rendererCutover\.stop\(\)\)/u);
});

test("each activated world switches epoch before creating one composer and one terrain publisher", async () => {
  const engine = await gameSource("engine.ts");
  const acceptance = method(engine, "  private async acceptRustLiveRendererActivationR10(", "\n  private async activateRustLiveRendererR10");
  const activation = method(engine, "  private async activateRustLiveRendererR10(", "\n  private async closeMultiplayerForRustTransition");
  const epochSwitch = activation.indexOf("sink.switchEpoch(epoch)");
  const composer = activation.indexOf("runtime = await factory({");
  const publisher = acceptance.indexOf("new RendererShellExtractionPublisherR11(runtime.terrain, epoch)");
  assert.ok(epochSwitch >= 0 && epochSwitch < composer);
  assert.ok(publisher >= 0);
  assert.equal((activation.match(/runtime = await factory\(\{/gu) ?? []).length, 1);
  assert.equal((acceptance.match(/new RendererShellExtractionPublisherR11/gu) ?? []).length, 1);
  assert.match(activation, /expectedContentManifestHash:\s*contentHash/u);
  assert.match(activation, /worldGeneration:\s*generation/u);
  assert.match(activation, /assertRustLivePlayerViewContextR10\(generation, host, pump, "renderer runtime creation"\)/u);
  assert.match(acceptance, /for \(;;\)/u);
  assert.equal((acceptance.match(/publisher\.present\(snapshot\)/gu) ?? []).length, 1);
});

test("the input pump is the sole extraction producer and composer submission stays serialized", async () => {
  const engine = await gameSource("engine.ts");
  const poll = method(engine, "  private scheduleRustLiveInputExtractionPresentationR10(", "\n  private rustRendererShellSnapshotR11");
  assert.match(poll, /if \(this\.rustRenderExtractionPoll\) return/u);
  assert.match(poll, /simulationTick:\s*BigInt\(extraction\.identity\.tick\)/u);
  assert.match(poll, /runtime\.submitRuntimeExtraction\(generation, extraction/u);
  assert.match(poll, /this\.trackRustAuthorityOperation\(operation\)/u);
  assert.match(poll, /runtime !== this\.rustLiveRenderRuntime/u);
  assert.match(poll, /host !== this\.rustRuntimeHost/u);
  assert.match(poll, /this\.rustRuntimeOperationsBlocked/u);
  assert.match(poll, /this\.rustRenderFrameSequence \+ BigInt\(1\)/u);
  assert.doesNotMatch(engine, /runtimeService\(\)\.extract\(/u);
});

test("terrain cadence uses current Rust identity after queued camera extraction and reuses canonical environment", async () => {
  const engine = await gameSource("engine.ts");
  const publish = method(engine, "  publishRendererExtractionR11(now: number)", "\n  /** Holds presentation time");
  assert.match(publish, /BigInt\(host\.runtimeService\(\)\.identity\(\)\.tick\)/u);
  assert.match(publish, /const environment = sink\.diagnostics\(\)\.environment/u);
  assert.match(publish, /animationTimeMicros:\s*snapshot\.animationTimeMicros/u);
  assert.ok(publish.indexOf("this.scheduleRustLiveInputExtractionPresentationR10(runtime, pending")
    < publish.indexOf("if (!sink.present(snapshot))"));
  assert.doesNotMatch(publish, /camera:\s*snapshot\.camera/u);
  const snapshot = method(engine, "  private rustRendererShellSnapshotR11(", "\n  publishRendererExtractionR11(now: number)");
  assert.match(snapshot, /simulationTick,/u);
  assert.match(snapshot, /this\.world\.rendererTerrainSnapshotR11/u);
});

test("world transition, quit, and shutdown drain work then dispose the composer before the worker", async () => {
  const engine = await gameSource("engine.ts");
  const transition = method(engine, "  private async prepareRustWorldTransition", "\n  private async activateRustWorldRuntime");
  assert.ok(transition.indexOf("await this.drainRustAuthorityOperations()")
    < transition.indexOf("await this.disposeRustLiveRendererR10()"));

  const quit = method(engine, "  async quitToTitleAsync()", "\n  /** @deprecated UI callers");
  assert.ok(quit.indexOf("await this.drainRustAuthorityOperations()")
    < quit.indexOf("await this.disposeRustLiveRendererR10()"));
  assert.ok(quit.indexOf("await this.disposeRustLiveRendererR10()")
    < quit.indexOf("await this.rustRuntimeManager.shutdown()"));

  const shutdown = method(engine, "  async shutdown()", "\n  /** Compatibility teardown");
  assert.ok(shutdown.indexOf("await this.drainRustAuthorityOperations()")
    < shutdown.indexOf("await this.disposeRustLiveRendererR10()"));
  assert.ok(shutdown.indexOf("await this.disposeRustLiveRendererR10()")
    < shutdown.indexOf("await this.rustRuntimeManager.shutdown()"));
});
