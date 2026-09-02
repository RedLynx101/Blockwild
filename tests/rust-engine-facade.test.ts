import assert from "node:assert/strict";
import test from "node:test";
import {
  EngineFacade,
  resolveEngineSelection,
  resolveRendererSelection,
  type EngineBackend,
  type EngineStepResult,
} from "../app/game/engine-facade.ts";

class StubBackend implements EngineBackend {
  starts = 0;
  ingests = 0;
  steps = 0;
  shutdowns = 0;

  constructor(
    readonly name: "typescript" | "rust",
    private readonly hash: string,
    private readonly startError?: Error,
  ) {}

  async start() { this.starts += 1; if (this.startError) throw this.startError; }
  async ingest() { this.ingests += 1; }
  async step(): Promise<EngineStepResult> {
    this.steps += 1;
    return { events: new Uint8Array([this.name === "typescript" ? 1 : 2]), stateHash: this.hash };
  }
  async shutdown() { this.shutdowns += 1; }
  diagnostics() { return { starts: this.starts, steps: this.steps }; }
}

test("facade defaults keep authority and both shadow policies closed", async () => {
  const typescript = new StubBackend("typescript", "same");
  const rust = new StubBackend("rust", "same");
  const facade = new EngineFacade({
    typescript,
    rust,
    engineSelection: "rust-shadow",
    rendererSelection: "wgpu-shadow",
    policy: { webGpuAvailable: true },
  });
  const result = await facade.step({ monotonicTimeUs: 1_000, budgetUs: 2_000 });
  assert.deepEqual([...result.events], [1]);
  assert.equal(typescript.starts, 1);
  assert.equal(rust.starts, 0);
  assert.equal(facade.diagnostics().engine.authorityMode, "typescript-authoritative");
  assert.match(facade.diagnostics().engine.fallbackReason ?? "", /shadow execution is disabled by policy/u);
  assert.equal(facade.diagnostics().renderer.effective, "three");
  assert.match(facade.diagnostics().renderer.fallbackReason ?? "", /shadow rendering is disabled by policy/u);
  await facade.shutdown();
});

test("missing Rust shadow falls back without preventing TypeScript play", async () => {
  const typescript = new StubBackend("typescript", "ts");
  const rust = new StubBackend("rust", "rust", new Error("artifact missing"));
  const facade = new EngineFacade({
    typescript,
    rust,
    engineSelection: "rust-shadow",
    policy: { allowRustShadow: true },
  });
  const result = await facade.step({ monotonicTimeUs: 1, budgetUs: 1 });
  assert.equal(result.stateHash, "ts");
  assert.equal(facade.diagnostics().engine.effective, "typescript");
  assert.match(facade.diagnostics().rustStartError ?? "", /artifact missing/);
  await facade.shutdown();
});

test("shadow mode returns TypeScript output and records bounded hash divergence", async () => {
  const facade = new EngineFacade({
    typescript: new StubBackend("typescript", "ts-hash"),
    rust: new StubBackend("rust", "rust-hash"),
    engineSelection: "rust-shadow",
    policy: { allowRustShadow: true },
    maximumDivergences: 2,
  });
  const result = await facade.step({ monotonicTimeUs: 1, budgetUs: 1 });
  assert.equal(result.stateHash, "ts-hash");
  assert.equal(facade.diagnostics().divergences.length, 1);
  assert.equal(facade.diagnostics().divergences[0].type, "state-hash");
  await facade.shutdown();
});

test("shadow selectors remain closed until their diagnostic policies are explicit", () => {
  const engineClosed = resolveEngineSelection("rust-shadow", {
    rustAvailable: true,
    allowRustShadow: false,
    allowRustAuthority: false,
  });
  const rendererClosed = resolveRendererSelection("wgpu-shadow", {
    webGpuAvailable: true,
    allowWgpuShadow: false,
    allowWgpuPrimary: false,
  });
  assert.equal(engineClosed.effective, "typescript");
  assert.equal(rendererClosed.effective, "three");

  const engineExplicit = resolveEngineSelection("rust-shadow", {
    rustAvailable: true,
    allowRustShadow: true,
    allowRustAuthority: false,
  });
  const rendererExplicit = resolveRendererSelection("wgpu-shadow", {
    webGpuAvailable: true,
    allowWgpuShadow: true,
    allowWgpuPrimary: false,
  });
  assert.equal(engineExplicit.effective, "rust-shadow");
  assert.equal(rendererExplicit.effective, "wgpu-shadow");
});
