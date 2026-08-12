import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(name: string) { return readFile(new URL(`../app/game/${name}`, import.meta.url), "utf8"); }

test("normal path gives Three and wgpu shadow distinct canvases", async () => {
  const voxelGame = await source("VoxelGame.tsx");
  assert.match(voxelGame, /new VoxelEngine\(canvas,/u);
  assert.match(voxelGame, /canvas:\s*rendererShadowCanvas,/u);
  assert.match(voxelGame, /canvasRole:\s*"shadow"/u);
  assert.match(voxelGame, /<canvas ref=\{rendererShadowCanvasRef\} hidden aria-hidden="true"/u);
  assert.doesNotMatch(voxelGame, /new VoxelEngine\(rendererShadowCanvas/u);
  assert.doesNotMatch(voxelGame, /canvas:\s*canvas,\s*canvasRole:\s*"shadow"/u);
});

test("shipping runtime keeps wgpu primary policy closed and shadow opt-in explicit", async () => {
  const voxelGame = await source("VoxelGame.tsx");
  assert.match(voxelGame, /allowWgpuShadow:\s*rendererRequest === "wgpu-shadow"/u);
  assert.match(voxelGame, /allowWgpuPrimary:\s*false/u);
  assert.match(voxelGame, /promotionGates:\s*CLOSED_RENDERER_PROMOTION_GATES_R11/u);
  assert.match(voxelGame, /render_renderer_cutover_to_text/u);
  assert.match(voxelGame, /request_renderer_recovery/u);
});

test("avatar previews lazy-load Three behind a deterministic no-WebGL fallback", async () => {
  const [voxelGame, runtime, fallback, compatibility] = await Promise.all([
    source("VoxelGame.tsx"),
    source("avatar-preview-runtime.ts"),
    source("AvatarPreviewFallback.tsx"),
    readFile(new URL("../app/three-compat/PlayerAvatarPreviewThree.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(voxelGame, /(?:from\s+["']three["']|import\s*\(\s*["']three["'])/u);
  assert.doesNotMatch(voxelGame, /from\s+["']\.\/(?:held-items|player-model|world)["']/u);
  assert.doesNotMatch(runtime, /(?:from\s+["']three["']|three-compat)/u);
  assert.doesNotMatch(fallback, /(?:from\s+["']three["']|three-compat|player-model|held-items|createBlockAtlas)/u);
  assert.match(voxelGame, /avatarPreviewCompatibilityPromise \?\?= import\("\.\.\/three-compat\/PlayerAvatarPreviewThree"\)/u);
  assert.match(voxelGame, /useEffect\(\(\) => \{[\s\S]*?void loadAvatarPreviewCompatibility\(\)/u);
  assert.match(voxelGame, /if \(!CompatibilityPreview \|\| compatibilityUnavailable\) \{\s*return <AvatarPreviewFallback/u);
  assert.match(compatibility, /import \* as THREE from "three"/u);
  assert.match(compatibility, /new BlockPlayerModel/u);
  assert.match(compatibility, /createAvatarHeldItemModel/u);
  assert.match(compatibility, /createBlockAtlas/u);
  assert.match(compatibility, /if \(!renderer\)[\s\S]*?onUnavailable/u);
  assert.match(compatibility, /isContextLost\(\)[\s\S]*?fail\(/u);
});

test("engine extraction copies coarse records plus renderer-neutral terrain pages", async () => {
  const engine = await source("engine.ts");
  const snapshotStart = engine.indexOf("  private rustRendererShellSnapshotR11(");
  const snapshotEnd = engine.indexOf("\n  publishRendererExtractionR11(now: number)", snapshotStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart, "renderer-neutral shell snapshot method is present");
  const snapshot = engine.slice(snapshotStart, snapshotEnd);
  const start = engine.indexOf("  publishRendererExtractionR11(now: number)");
  const end = engine.indexOf("\n  updateAdaptiveResolution", start);
  assert.ok(start >= 0 && end > start, "normal-path extraction method is present");
  const extraction = engine.slice(start, end);
  for (const forbidden of ["this.scene", ".traverse(", "this.world.getBlock", "this.mobs", "this.renderer.info"]) {
    assert.ok(!snapshot.includes(forbidden) && !extraction.includes(forbidden), `extraction must not scrape ${forbidden}`);
  }
  for (const required of ["this.camera.position", "this.camera.quaternion", "this.daylightAmount()", "this.weatherState.kind", "this.cameraEnvironment.caveBackdropBlend", "this.world.rendererTerrainSnapshotR11"]) {
    assert.ok(snapshot.includes(required), `renderer-neutral snapshot omitted ${required}`);
  }
  assert.match(extraction, /this\.rustRendererShellSnapshotR11\(now, authoritativeTick\)/u);
});

test("world extraction reads the immutable page registry, never Three, voxel, or material state", async () => {
  const world = await source("world.ts");
  const start = world.indexOf("  rendererTerrainSnapshotR11(");
  const end = world.indexOf("\n  private installRustTerrainR2BrowserHarness", start);
  assert.ok(start >= 0 && end > start, "world terrain extraction method is present");
  const extraction = world.slice(start, end);
  assert.match(extraction, /chunk\.rendererTerrain\.pages\(\)/u);
  for (const forbidden of ["chunk.group", "this.scene", "getBlock(", "BLOCKS[", ".material", ".geometry"]) {
    assert.ok(!extraction.includes(forbidden), `terrain extraction must not traverse ${forbidden}`);
  }
  assert.doesNotMatch(world, /terrainSectionGeometry\(geometry: THREE\.BufferGeometry/u, "consolidation must not copy Three geometry into extraction");
  assert.match(world, /chunk\.rendererTerrain\.sectionPages\(next\.layer\)/u);
});

test("shadow extraction is bounded to 30 Hz and failure cannot interrupt Three", async () => {
  const engine = await source("engine.ts");
  assert.match(engine, /this\.renderExtractionNextAt = now \+ 1000 \/ 30/u);
  assert.match(engine, /Shadow presentation is diagnostic-only and must never interrupt/u);
  assert.match(engine, /this\.renderExtractionErrors \+= 1/u);
});

test("renderer lab compares one immutable record through an isolated lazy Three oracle", async () => {
  const lab = await readFile(new URL("../app/renderer-lab/RendererLabClient.tsx", import.meta.url), "utf8");
  const oracle = await readFile(new URL("../app/three-compat/renderer-extraction-oracle-r11.ts", import.meta.url), "utf8");
  assert.match(lab, /decodeRenderResourceBatchV2\(resourceBytes\)/u);
  assert.match(lab, /decodeRenderFrameV2/u);
  assert.match(lab, /await import\("\.\.\/three-compat\/renderer-extraction-oracle-r11\.ts"\)/u);
  assert.match(lab, /oracle\.applyResources\(resourceBatch\)/u);
  assert.match(lab, /oracle\.render\(createSizedFrame/u);
  assert.match(lab, /Rust wgpu candidate/u);
  assert.doesNotMatch(lab, /(?:from|import\()\s*["']three["']/u);
  assert.match(oracle, /import \* as THREE from "three"/u);
  assert.match(oracle, /syncParticles\(frame\.particles\)/u);
  assert.match(oracle, /base\.rgb \*= 1\.1/u);
  assert.match(oracle, /localUv\.x = fract\(localUv\.x \+ waterPhase\)/u);
  assert.match(oracle, /#include <colorspace_fragment>/u);
});
