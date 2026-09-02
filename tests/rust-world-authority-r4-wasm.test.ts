import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RustEngineBytes } from "../app/game/rust-engine-loader.ts";
import {
  decodeRustWorldAuthorityResponseR4V1,
  encodeRustWorldAuthorityRequestR4V1,
} from "../app/game/rust-world-authority-codec-r4.ts";
import {
  type RustWorldAuthorityRequestR4V1,
  type RustWorldAuthorityTransportR4V1,
} from "../app/game/rust-world-authority-bridge-r4.ts";
import { RustWorldAuthorityServiceR4V1 } from "../app/game/rust-world-authority-service-r4.ts";
import { currentRustWorldBlockCatalogR4V1 } from "../app/game/rust-world-authority-runtime-r4.ts";
import { resolveRustEngineTestDefaultArtifact } from "./helpers/rust-engine-test-artifact.ts";

type WasmAuthorityModule = Readonly<{
  default(input: { module_or_path: Uint8Array }): Promise<unknown>;
  blockwild_world_authority_create_r4(request: Uint8Array): RustEngineBytes;
  blockwild_world_authority_request_r4(handle: number, request: Uint8Array): RustEngineBytes;
  blockwild_world_authority_destroy_r4(handle: number, request: Uint8Array): RustEngineBytes;
}>;

async function loadPublishedAuthorityWasm() {
  const root = resolve(import.meta.dirname, "..");
  const { artifactDirectory, hash } = await resolveRustEngineTestDefaultArtifact(root);
  const wasmModule = await import(`${pathToFileURL(resolve(artifactDirectory, "engine.js")).href}?r4=${Date.now()}`) as WasmAuthorityModule;
  await wasmModule.default({ module_or_path: new Uint8Array(await readFile(resolve(artifactDirectory, "engine_bg.wasm"))) });
  return { wasmModule, hash };
}

class DirectWasmTransport implements RustWorldAuthorityTransportR4V1 {
  private handle: number | null = null;
  constructor(private readonly wasmModule: WasmAuthorityModule) {}
  async request(request: RustWorldAuthorityRequestR4V1) {
    const encoded = encodeRustWorldAuthorityRequestR4V1(request);
    if (request.type === "authority-init-r4-v1") {
      const decoded = decodeRustWorldAuthorityResponseR4V1(request, this.wasmModule.blockwild_world_authority_create_r4(encoded));
      this.handle = decoded.handle ?? null;
      return decoded.response;
    }
    assert.notEqual(this.handle, null);
    const bytes = request.type === "authority-dispose-r4-v1"
      ? this.wasmModule.blockwild_world_authority_destroy_r4(this.handle!, encoded)
      : this.wasmModule.blockwild_world_authority_request_r4(this.handle!, encoded);
    const response = decodeRustWorldAuthorityResponseR4V1(request, bytes).response;
    if (request.type === "authority-dispose-r4-v1") this.handle = null;
    return response;
  }
}

test("published R4 Wasm owns all 12 sections, auxiliaries, reads, edits, saves, eviction, and location lifecycle", async () => {
  const { wasmModule, hash } = await loadPublishedAuthorityWasm();
  const service = new RustWorldAuthorityServiceR4V1(new DirectWasmTransport(wasmModule));
  const address = { universeId: "1", locationId: "r4-published-test" } as const;
  const ready = await service.initialize(address, currentRustWorldBlockCatalogR4V1());
  assert.equal(ready.revision.epoch, 1, `artifact ${hash}`);
  const sections = Array.from({ length: 12 }, (_, sectionY) => ({
    address: { ...address, chunkX: -2, chunkZ: 3, sectionY },
    sourceRevision: 18,
    sourceHash: `${sectionY.toString(16).padStart(2, "0")}${"1".repeat(30)}`,
    blocks: new Uint16Array(4_096),
    facing: new Uint8Array(4_096),
    liquidKind: new Uint8Array(4_096),
    liquidLevel: new Uint8Array(4_096),
    flags: new Uint8Array(4_096),
  }));
  sections[0].blocks[0] = 1;
  const installed = await service.installSections(sections, [{
    address: { ...address, chunkX: -2, chunkZ: 3 },
    sourceRevision: 18,
    sourceHash: "22222222222222222222222222222222",
    heightmap: new Int16Array(256).fill(-64),
    biomes: new Uint8Array(256),
    sectionBlockCounts: Uint16Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    skyTops: new Int16Array(256).fill(-65),
    light: new Uint16Array(49_152),
    lightIndices: new Uint32Array(),
    leafIndices: new Uint32Array(),
    markers: [{ key: "poi:test", canonicalJson: "{\"kind\":\"test\"}" }],
  }]);
  assert.deepEqual({ accepted: installed.accepted, stale: installed.stale, auxiliary: installed.auxiliaryAccepted, markers: installed.markerRows }, {
    accepted: 12, stale: 0, auxiliary: 1, markers: 1,
  });
  const lightSection = new Uint16Array(4_096);
  lightSection[17] = 0xf321;
  const patched = await service.patchAuxiliary([{
    address: { ...address, chunkX: -2, chunkZ: 3 },
    expectedSourceRevision: 18,
    expectedSourceHash: "2".repeat(32),
    sourceRevision: 19,
    sourceHash: "3".repeat(32),
    lightSections: [{ sectionY: 10, light: lightSection }],
    sectionBlockCounts: [{ index: 10, value: 1 }],
    skyTops: [{ index: 255, value: 42 }],
    lightIndices: Uint32Array.from([17]),
  }]);
  assert.deepEqual(
    { accepted: patched.accepted, lightSections: patched.lightSections, lightCells: patched.lightCells },
    { accepted: 1, lightSections: 1, lightCells: 4_096 },
    "published Wasm commits one revisioned 8 KiB light section rather than a whole chunk auxiliary",
  );
  await assert.rejects(service.patchAuxiliary([{
    address: { ...address, chunkX: -2, chunkZ: 3 },
    expectedSourceRevision: 18,
    expectedSourceHash: "2".repeat(32),
    sourceRevision: 20,
    sourceHash: "4".repeat(32),
    lightSections: [{ sectionY: 0, light: new Uint16Array(4_096) }],
    sectionBlockCounts: [],
    skyTops: [],
  }]), (error: unknown) => error instanceof Error && error.message.includes("does not extend the resident source identity"));
  const origin = { x: -32, y: -64, z: 48 };
  const page = await service.readPage(origin, { x: 16, y: 192, z: 16 });
  assert.equal(page.sectionRevisions.length, 12);
  assert.equal(page.streams.loadedMask.every((value) => value === 1), true);
  assert.equal(page.streams.blocks[0], 1);
  assert.equal(page.streams.blocks[1], 0, "loaded Air remains distinct from the unloaded sentinel");

  const mutated = await service.mutate("published-edit", "test", [{ kind: "set-block", ...origin, blockId: 31, facing: 2 }]);
  assert.equal(mutated.status, "accepted");
  assert.equal(mutated.immediateEvent?.changes[0]?.blockId, 31);
  const stale = await service.exerciseStaleMutationForDiagnostics("published-stale", [{ kind: "set-block", ...origin, blockId: 1 }]);
  assert.equal(stale.rejectionCode, "stale-revision");
  const rejected = await service.exerciseRejectedBatchForDiagnostics("published-rollback", [
    { kind: "set-block", ...origin, blockId: 1 },
    { kind: "set-block", x: origin.x + 1, y: 128, z: origin.z, blockId: 1 },
  ]);
  assert.equal(rejected.status, "rejected");
  assert.equal((await service.readPage(origin, { x: 1, y: 1, z: 1 })).streams.blocks[0], 31, "rejected multi-edit is atomic");

  const save = await service.exportSave();
  assert.equal(save.rustExtension.slice(0, 4).toString(), "66,87,65,83");
  const preImportIdentity = service.identity();
  await service.importCompatibilitySave(save.compatibilityJson, save.rustExtension);
  assert.equal(service.identity().revision.epoch > preImportIdentity.revision.epoch, true);
  assert.equal(service.identity().revision.mutation, preImportIdentity.revision.mutation);
  assert.equal(service.identity().revision.residency, 0);
  const reinstalled = await service.installSections(sections);
  assert.equal(reinstalled.accepted, 12, "save replacement invalidates resident sections before rehydration");
  assert.equal((await service.evictSections(sections.map((section) => section.address))).evicted, 12);
  const switched = await service.switchLocation({ universeId: "1", locationId: "r4-published-next" });
  assert.equal(switched.address.locationId, "r4-published-next");
  await service.dispose();
  assert.equal(service.diagnostics().disposed, true);
});
