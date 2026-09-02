import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  createRustIntegratedRuntimeCommandBatchV1,
  createRustIntegratedRuntimeDomainOperationV1,
  decodeRustIntegratedRuntimeResponseV1,
  encodeRustIntegratedRuntimeRequestV1,
} from "../app/game/rust-integrated-runtime-codec";
import {
  RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
  type RustIntegratedRuntimeRequestV1,
} from "../app/game/rust-integrated-runtime-contract";
import {
  RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_RECEIPT_TYPE_V2,
  RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
  decodeRustIntegratedTerrainResidencyReconcileReceiptV2,
  encodeRustIntegratedTerrainResidencyReconcileRequestV2,
} from "../app/game/rust-integrated-runtime-terrain-residency";
import { resolveRustEngineTestDefaultArtifact } from "./helpers/rust-engine-test-artifact.ts";

type CandidateRuntimeWasm = Readonly<{
  default(input: { module_or_path: Uint8Array }): Promise<unknown>;
  blockwild_runtime_create_v2(request: Uint8Array): Uint8Array;
  blockwild_runtime_command_v2(handle: number, request: Uint8Array): Uint8Array;
  blockwild_runtime_destroy_v2(handle: number, request: Uint8Array): Uint8Array;
}>;

type CandidateIndex = Readonly<{
  defaultVariant?: unknown;
  artifacts?: Record<string, Readonly<{ hash?: unknown; directory?: unknown }>>;
}>;

type CandidateArtifactManifest = Readonly<{
  artifactHash?: unknown;
  files?: readonly Readonly<{ path?: unknown; sha256?: unknown }>[];
}>;

const ROOT = resolve(import.meta.dirname, "..");
const PUBLISHED_ROOT = join(ROOT, "public", "engine");
const FINAL_FIXED_STEP_CAPABILITY = "fixed-step-input-v1";
const PENDING_FIXED_STEP_CAPABILITY = "fixed-step-input-v1-pending-live-cutover";
const BASIC_DIRT_ACTION_RECEIPT_CAPABILITY = "basic-dirt-action-receipt-v1";
const NATIVE_BLOCK_EDIT_RECEIPT_CAPABILITY = "native-block-edit-receipt-v1";
const NATIVE_BLOCK_EDIT_RECEIPT_CAPABILITY_V2 = "native-block-edit-receipt-v2";
const NATIVE_DROP_PICKUP_RECEIPT_CAPABILITY = "native-drop-pickup-receipt-v1";
const NATIVE_PLAYER_DROP_RECEIPT_CAPABILITY = "native-player-drop-receipt-v1";
const CREATIVE_INVENTORY_SLOT_CAPABILITY = "creative-inventory-slot-v1";
const PLAYER_GAME_MODE_SET_CAPABILITY = "player-game-mode-set-v1";

function asBytes(value: Uint8Array | ArrayBuffer) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function createRequest(): Extract<RustIntegratedRuntimeRequestV1, { type: "runtime-create-v1" }> {
  return Object.freeze({
    type: "runtime-create-v1",
    requestId: 1,
    clientEpoch: 1,
    config: Object.freeze({
      worldSeed: "candidate-fixed-step-capability",
      universeId: "candidate-runtime",
      locationId: "surface",
      sessionId: "candidate-capability-test",
      contentHash: "1".repeat(32),
      generatorHash: "2".repeat(32),
      ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
      waterBlockId: 7,
      directionalBlockIds: Object.freeze([]),
      waterloggedBlockIds: Object.freeze([]),
    }),
  });
}

async function verifyRuntimeArtifact(override: string | null | undefined, label: string, requiredAdditionalCapabilities: readonly string[] = []) {
  const selected = await resolveRustEngineTestDefaultArtifact(ROOT, override);
  const indexRoot = selected.directory;
  const index = JSON.parse(await readFile(join(indexRoot, "manifest.json"), "utf8")) as CandidateIndex;
  assert.equal(index.defaultVariant, "compatibility", `${label} index must select the compatibility artifact`);
  const artifact = index.artifacts?.compatibility;
  assert.ok(artifact, `${label} index is missing its compatibility artifact`);
  assert.match(String(artifact.hash), /^[0-9a-f]{64}$/u, `${label} artifact hash is not content-addressed`);
  assert.equal(artifact.directory, artifact.hash, `${label} artifact directory must equal its content hash`);

  const candidateRoot = await realpath(indexRoot);
  const artifactDirectory = await realpath(join(candidateRoot, String(artifact.directory)));
  const artifactRelative = relative(candidateRoot, artifactDirectory);
  assert.ok(
    artifactRelative.length > 0 && artifactRelative !== ".." && !artifactRelative.startsWith(`..${sep}`) && !isAbsolute(artifactRelative),
    `${label} artifact must resolve strictly below its selected index`,
  );
  assert.equal(artifactDirectory, selected.artifactDirectory, `${label} artifact selection changed during validation`);
  assert.equal(artifact.hash, selected.hash, `${label} artifact hash changed during validation`);

  const artifactManifest = JSON.parse(
    await readFile(join(artifactDirectory, "manifest.json"), "utf8"),
  ) as CandidateArtifactManifest;
  assert.equal(artifactManifest.artifactHash, artifact.hash, `${label} artifact manifest hash does not match its index`);
  const wasmEntry = artifactManifest.files?.find(({ path }) => path === "engine_bg.wasm");
  assert.match(String(wasmEntry?.sha256), /^[0-9a-f]{64}$/u, `${label} manifest has no Wasm digest`);
  const wasmBytes = new Uint8Array(await readFile(join(artifactDirectory, "engine_bg.wasm")));
  assert.equal(
    createHash("sha256").update(wasmBytes).digest("hex"),
    wasmEntry?.sha256,
    `${label} Wasm bytes do not match the artifact manifest`,
  );

  const moduleUrl = `${pathToFileURL(join(artifactDirectory, "engine.js")).href}?${label}-capability=${Date.now()}`;
  const candidate = await import(moduleUrl) as CandidateRuntimeWasm;
  assert.equal(typeof candidate.blockwild_runtime_create_v2, "function", `${label} is missing blockwild_runtime_create_v2`);
  assert.equal(typeof candidate.blockwild_runtime_command_v2, "function", `${label} is missing blockwild_runtime_command_v2`);
  assert.equal(typeof candidate.blockwild_runtime_destroy_v2, "function", `${label} is missing blockwild_runtime_destroy_v2`);
  await candidate.default({ module_or_path: wasmBytes });

  const create = createRequest();
  const ready = decodeRustIntegratedRuntimeResponseV1(asBytes(
    candidate.blockwild_runtime_create_v2(encodeRustIntegratedRuntimeRequestV1(create)),
  ));
  if (ready.type !== "runtime-ready-v1") {
    assert.fail(`${label} runtime create returned ${ready.type}`);
  }

  let destroyed = false;
  let terminalIdentity = ready.identity;
  try {
    assert.equal(ready.requestId, create.requestId);
    assert.equal(ready.clientEpoch, create.clientEpoch);
    assert.ok(ready.runtimeHandle > 0, `${label} Ready response has no live generational handle`);
    assert.equal(
      ready.capabilities.filter((capability) => capability === FINAL_FIXED_STEP_CAPABILITY).length,
      1,
      `${label} Ready response must advertise the final fixed-step capability exactly once`,
    );
    assert.equal(
      ready.capabilities.includes(PENDING_FIXED_STEP_CAPABILITY),
      false,
      `${label} Ready response still advertises the pending fixed-step marker`,
    );
    for (const capability of requiredAdditionalCapabilities) {
      assert.equal(
        ready.capabilities.filter((candidateCapability) => candidateCapability === capability).length,
        1,
        `${label} Ready response must advertise ${capability} exactly once`,
      );
    }

    const terrainPayload = encodeRustIntegratedTerrainResidencyReconcileRequestV2({
      expectedWorldRevision: Object.freeze({ epoch: BigInt(1), mutation: BigInt(0), residency: BigInt(0) }),
      generationOptionsJson: create.config.generationOptionsJson,
      desiredChunks: Object.freeze([{ chunkX: 0, chunkZ: 0 }]),
    });
    const terrainBatch = createRustIntegratedRuntimeCommandBatchV1({
      commandId: "candidate-terrain-residency-reconcile",
      idempotencyKey: "candidate-terrain-residency-reconcile",
      actorId: "platform:terrain",
      expected: ready.identity,
      operations: Object.freeze([createRustIntegratedRuntimeDomainOperationV1({
        domain: "world",
        typeId: RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_TYPE_V2,
        schema: 2,
        payload: terrainPayload,
      })]),
    });
    const terrainRequest: Extract<RustIntegratedRuntimeRequestV1, { type: "runtime-command-v1" }> = Object.freeze({
      type: "runtime-command-v1",
      requestId: 2,
      clientEpoch: create.clientEpoch,
      batch: terrainBatch,
    });
    const terrainResponse = decodeRustIntegratedRuntimeResponseV1(asBytes(
      candidate.blockwild_runtime_command_v2(
        ready.runtimeHandle,
        encodeRustIntegratedRuntimeRequestV1(terrainRequest),
      ),
    ));
    if (terrainResponse.type !== "runtime-command-receipt-v1") {
      assert.fail(`${label} terrain reconcile returned ${terrainResponse.type}`);
    }
    if (terrainResponse.receipt.status !== "accepted") {
      assert.fail(`${label} rejected its one-chunk terrain reconcile: ${terrainResponse.receipt.message}`);
    }
    assert.equal(terrainResponse.receipt.domainReceipts.length, 1);
    const terrainDomainReceipt = terrainResponse.receipt.domainReceipts[0];
    assert.equal(terrainDomainReceipt.domain, "world");
    assert.equal(terrainDomainReceipt.typeId, RUST_INTEGRATED_TERRAIN_RESIDENCY_RECONCILE_RECEIPT_TYPE_V2);
    assert.equal(terrainDomainReceipt.schema, 2);
    const terrainReceipt = decodeRustIntegratedTerrainResidencyReconcileReceiptV2(terrainDomainReceipt.payload);
    assert.equal(terrainReceipt.desiredChunkCount, 1);
    assert.equal(terrainReceipt.generatedChunkCount, 1);
    assert.equal(terrainReceipt.residentSections, 12);
    assert.deepEqual(terrainReceipt.desiredChunks, [{ chunkX: 0, chunkZ: 0 }]);
    terminalIdentity = terrainResponse.receipt.after;

    const shutdown: Extract<RustIntegratedRuntimeRequestV1, { type: "runtime-shutdown-v1" }> = Object.freeze({
      type: "runtime-shutdown-v1",
      requestId: 3,
      clientEpoch: create.clientEpoch,
      expected: terminalIdentity,
    });
    const stopped = decodeRustIntegratedRuntimeResponseV1(asBytes(
      candidate.blockwild_runtime_destroy_v2(
        ready.runtimeHandle,
        encodeRustIntegratedRuntimeRequestV1(shutdown),
      ),
    ));
    assert.deepEqual(stopped, {
      type: "runtime-shutdown-v1",
      requestId: shutdown.requestId,
      clientEpoch: shutdown.clientEpoch,
      workerEpoch: ready.workerEpoch,
    });
    destroyed = true;
  } finally {
    if (!destroyed) {
      const cleanup: Extract<RustIntegratedRuntimeRequestV1, { type: "runtime-shutdown-v1" }> = Object.freeze({
        type: "runtime-shutdown-v1",
        requestId: 4,
        clientEpoch: create.clientEpoch,
        expected: null,
      });
      candidate.blockwild_runtime_destroy_v2(
        ready.runtimeHandle,
        encodeRustIntegratedRuntimeRequestV1(cleanup),
      );
    }
  }
  return selected;
}

test("selected Wasm advertises every required capability and destroys its runtime", async (context) => {
  const selected = await verifyRuntimeArtifact(undefined, "selected", [
    BASIC_DIRT_ACTION_RECEIPT_CAPABILITY,
    NATIVE_BLOCK_EDIT_RECEIPT_CAPABILITY,
    NATIVE_BLOCK_EDIT_RECEIPT_CAPABILITY_V2,
    NATIVE_DROP_PICKUP_RECEIPT_CAPABILITY,
    NATIVE_PLAYER_DROP_RECEIPT_CAPABILITY,
    CREATIVE_INVENTORY_SLOT_CAPABILITY,
    PLAYER_GAME_MODE_SET_CAPABILITY,
  ]);
  context.diagnostic(`Verified ${selected.overridden ? "explicit isolated candidate" : "canonical published"} artifact ${selected.hash}`);
});

test("canonical published Wasm advertises final fixed-step capability and destroys its runtime", async () => {
  const published = await verifyRuntimeArtifact(null, "canonical published");
  assert.equal(published.directory, await realpath(PUBLISHED_ROOT));
  assert.equal(published.overridden, false, "canonical verification must ignore any candidate override");
});

test("runtime artifact selection defaults to canonical and rejects unapproved override roots", async () => {
  const canonical = await resolveRustEngineTestDefaultArtifact(ROOT, null);
  assert.equal(canonical.directory, await realpath(PUBLISHED_ROOT));
  assert.equal(canonical.overridden, false);
  for (const override of ["", "public/engine", "tests", "public/engine-locator-candidate/nested",
    "public/engine-schema-candidate/../engine", "public/engine-unlisted-candidate"]) {
    await assert.rejects(() => resolveRustEngineTestDefaultArtifact(ROOT, override), /BLOCKWILD_LOCATOR_ENGINE_DIR/u);
  }
});
