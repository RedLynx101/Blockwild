import assert from "node:assert/strict";
import test from "node:test";
import {
  RustIntegratedTerrainResidencyPortV1,
  decodeRustIntegratedTerrainResidencyReceiptV1,
  decodeRustIntegratedTerrainResidencyReconcileReceiptV2,
  decodeRustIntegratedTerrainResidencyReconcileRequestV2,
  encodeRustIntegratedTerrainResidencyRequestV1,
  encodeRustIntegratedTerrainResidencyReconcileReceiptV2,
  encodeRustIntegratedTerrainResidencyReconcileRequestV2,
  type RustIntegratedTerrainResidencyReconcileReceiptV2,
  type RustIntegratedTerrainWorldRevisionV1,
} from "../app/game/rust-integrated-runtime-terrain-residency.ts";
import type { RustIntegratedRuntimeIdentityV1 } from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustIntegratedRuntimeServiceV1 } from "../app/game/rust-integrated-runtime-service.ts";
import { rustIntegratedRuntimeWireChecksumV1 } from "../app/game/rust-integrated-runtime-codec.ts";

const REQUEST_GOLDEN = "425754340100010088010000de1f6d729fdb3858b8c5c4571516987007000000000000000b000000000000000d00000000000000580100007b2262696f6d655363616c65223a312e33352c22636176654672657175656e6379223a312c22656e61626c656446616374696f6e73223a5b22686f6262697473222c22676f626c696e73222c2261746c616e7469616e73222c227375676172636f757274222c22776f6f642d656c766573222c2264776172766573225d2c226c61726765546f776e4672657175656e6379223a2262616c616e636564222c2270726f66696c65223a22776f726c642d62656c6f772d763135222c227265736f757263654162756e64616e6365223a312c22726f6164436f766572616765223a22726567696f6e616c222c22736574746c656d656e74436c7573746572696e67223a22726567696f6e616c222c22736574746c656d656e7444656e73697479223a312c22736574746c656d656e745061747465726e223a2268656172746c616e64732d7632222c2273747275637475726573223a747275657d02000000feffffff0300000004000000fbffffff";
const RECEIPT_GOLDEN = "42575534010001000001000060614df5f7d98929d8039275ae9f18b307000000000000000b000000000000000d0000000000000007000000000000000b000000000000002500000000000000020000000100000001000000020000001800000002000000feffffff03000000010c000100000011000000010101010101010101010101010101010202020202020202020202020202020203030303030303030303030303030303040404040404040404040404040404040004000000fbffffff000c000000000013000000050505050505050505050505050505050606060606060606060606060606060607070707070707070707070707070707080808080808080808080808080808080109090909090909090909090909090909";
const RECONCILE_REQUEST_GOLDEN = "4257543501000200880100009609110496e9e746b8c5c4571516987007000000000000000b000000000000002500000000000000580100007b2262696f6d655363616c65223a312e33352c22636176654672657175656e6379223a312c22656e61626c656446616374696f6e73223a5b22686f6262697473222c22676f626c696e73222c2261746c616e7469616e73222c227375676172636f757274222c22776f6f642d656c766573222c2264776172766573225d2c226c61726765546f776e4672657175656e6379223a2262616c616e636564222c2270726f66696c65223a22776f726c642d62656c6f772d763135222c227265736f757263654162756e64616e6365223a312c22726f6164436f766572616765223a22726567696f6e616c222c22736574746c656d656e74436c7573746572696e67223a22726567696f6e616c222c22736574746c656d656e7444656e73697479223a312c22736574746c656d656e745061747465726e223a2268656172746c616e64732d7632222c2273747275637475726573223a747275657d02000000feffffff0300000004000000fbffffff";
const DEFAULT_OPTIONS = "{\"biomeScale\":1.35,\"caveFrequency\":1,\"enabledFactions\":[\"hobbits\",\"goblins\",\"atlantians\",\"sugarcourt\",\"wood-elves\",\"dwarves\"],\"largeTownFrequency\":\"balanced\",\"profile\":\"world-below-v15\",\"resourceAbundance\":1,\"roadCoverage\":\"regional\",\"settlementClustering\":\"regional\",\"settlementDensity\":1,\"settlementPattern\":\"heartlands-v2\",\"structures\":true}";

function hex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function bytes(value: string) { return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16)); }

test("terrain residency request matches Rust golden and canonicalizes chunk order", () => {
  const encoded = encodeRustIntegratedTerrainResidencyRequestV1({
    expectedWorldRevision: { epoch: BigInt(7), mutation: BigInt(11), residency: BigInt(13) },
    generationOptionsJson: DEFAULT_OPTIONS,
    chunks: [{ chunkX: 4, chunkZ: -5 }, { chunkX: -2, chunkZ: 3 }],
  });
  assert.equal(hex(encoded), REQUEST_GOLDEN);
  assert.throws(() => encodeRustIntegratedTerrainResidencyRequestV1({
    expectedWorldRevision: { epoch: BigInt(7), mutation: BigInt(11), residency: BigInt(13) },
    generationOptionsJson: DEFAULT_OPTIONS,
    chunks: [{ chunkX: 1, chunkZ: 1 }, { chunkX: 1, chunkZ: 1 }],
  }), /unique/u);
});

test("terrain residency identity excludes origin and rejects non-normalized options", () => {
  const request = (generationOptionsJson: string) => encodeRustIntegratedTerrainResidencyRequestV1({
    expectedWorldRevision: { epoch: BigInt(1), mutation: BigInt(0), residency: BigInt(0) },
    generationOptionsJson,
    chunks: [{ chunkX: 0, chunkZ: 0 }],
  });
  assert.doesNotThrow(() => request(DEFAULT_OPTIONS));
  assert.equal(DEFAULT_OPTIONS.includes("origin"), false);
  assert.throws(
    () => request(DEFAULT_OPTIONS.replace("\"structures\":true", "\"structures\":true,\"origin\":{\"mode\":\"wilderness\"}")),
    /canonical field order/u,
  );
  assert.throws(
    () => request(DEFAULT_OPTIONS.replace("\"caveFrequency\":1", "\"caveFrequency\":1.001")),
    /unsupported or non-normalized/u,
  );
});

test("terrain residency receipt decodes Rust golden and fails closed on corruption", () => {
  const decoded = decodeRustIntegratedTerrainResidencyReceiptV1(bytes(RECEIPT_GOLDEN));
  assert.deepEqual(decoded.previousWorldRevision, { epoch: BigInt(7), mutation: BigInt(11), residency: BigInt(13) });
  assert.deepEqual(decoded.worldRevision, { epoch: BigInt(7), mutation: BigInt(11), residency: BigInt(37) });
  assert.equal(decoded.generatedChunks, 1);
  assert.equal(decoded.alreadyResidentChunks, 1);
  assert.deepEqual(decoded.chunks.map((chunk) => [chunk.chunkX, chunk.chunkZ, chunk.status]), [
    [-2, 3, "generated"],
    [4, -5, "already-resident"],
  ]);
  const corrupt = bytes(RECEIPT_GOLDEN); corrupt[corrupt.length - 1] ^= 0x80;
  assert.throws(() => decodeRustIntegratedTerrainResidencyReceiptV1(corrupt), /checksum/u);
});

function sortedChunks(centerX: number, centerZ: number) {
  return Array.from({ length: 25 }, (_, index) => ({
    chunkX: centerX - 2 + Math.floor(index / 5),
    chunkZ: centerZ - 2 + index % 5,
  }));
}

test("terrain residency reconcile v2 vectors are exact and corruption fails closed", () => {
  const request = {
    expectedWorldRevision: { epoch: BigInt(7), mutation: BigInt(11), residency: BigInt(37) },
    generationOptionsJson: DEFAULT_OPTIONS,
    desiredChunks: [{ chunkX: 4, chunkZ: -5 }, { chunkX: -2, chunkZ: 3 }],
  };
  const encoded = encodeRustIntegratedTerrainResidencyReconcileRequestV2(request);
  assert.equal(hex(encoded), RECONCILE_REQUEST_GOLDEN);
  assert.deepEqual(decodeRustIntegratedTerrainResidencyReconcileRequestV2(encoded), {
    ...request,
    desiredChunks: [{ chunkX: -2, chunkZ: 3 }, { chunkX: 4, chunkZ: -5 }],
  });
  const receipt: RustIntegratedTerrainResidencyReconcileReceiptV2 = {
    previousWorldRevision: request.expectedWorldRevision,
    worldRevision: { ...request.expectedWorldRevision, residency: BigInt(74) },
    desiredChunkCount: 2,
    generatedChunkCount: 1,
    retainedChunkCount: 1,
    evictedChunkCount: 2,
    residentSections: 24,
    desiredChunks: [{ chunkX: -2, chunkZ: 3 }, { chunkX: 4, chunkZ: -5 }],
    generatedChunks: [{ chunkX: -2, chunkZ: 3 }],
    retainedChunks: [{ chunkX: 4, chunkZ: -5 }],
    evictedChunks: [{ chunkX: -8, chunkZ: 1 }, { chunkX: 9, chunkZ: 2 }],
    stateHash: "09".repeat(16),
  };
  const receiptBytes = encodeRustIntegratedTerrainResidencyReconcileReceiptV2(receipt);
  assert.equal(hex(receiptBytes.subarray(0, 8)), "4257553501000200");
  assert.deepEqual(decodeRustIntegratedTerrainResidencyReconcileReceiptV2(receiptBytes), receipt);
  const corrupt = receiptBytes.slice(); corrupt[corrupt.length - 1] ^= 0x80;
  assert.throws(() => decodeRustIntegratedTerrainResidencyReconcileReceiptV2(corrupt), /checksum/u);
  assert.throws(() => encodeRustIntegratedTerrainResidencyReconcileReceiptV2({
    ...receipt,
    retainedChunks: receipt.generatedChunks,
  }), /inconsistent/u);
});

class FakeExactTerrainRuntime {
  private current: RustIntegratedRuntimeIdentityV1 = Object.freeze({
    universeId: "1",
    locationId: "surface",
    revision: Object.freeze({ epoch: 1, world: 0, entities: 0, gameplay: 0, persistence: 0, network: 0, simulation: 0 }),
    tick: 0,
    stateHash: "00".repeat(16),
  });
  private worldRevision: RustIntegratedTerrainWorldRevisionV1 = Object.freeze({ epoch: BigInt(1), mutation: BigInt(0), residency: BigInt(0) });
  readonly resident = new Set<string>();
  commands = 0;
  shutdowns = 0;
  corruption: "count" | "partition" | "previous-revision" | "state-hash" | null = null;

  identity() { return this.current; }
  async shutdown() { this.shutdowns += 1; }

  async command(batch: Parameters<RustIntegratedRuntimeServiceV1["command"]>[0]) {
    const request = decodeRustIntegratedTerrainResidencyReconcileRequestV2(batch.operations[0].payload);
    assert.deepEqual(request.expectedWorldRevision, this.worldRevision, "port forwards the caller-owned exact cursor");
    assert.equal(request.desiredChunks.length, 25, "every reconcile declares the complete 5x5 ring");
    const desiredKeys = new Set(request.desiredChunks.map((chunk) => `${chunk.chunkX},${chunk.chunkZ}`));
    const generatedChunks = request.desiredChunks.filter((chunk) => !this.resident.has(`${chunk.chunkX},${chunk.chunkZ}`));
    const retainedChunks = request.desiredChunks.filter((chunk) => this.resident.has(`${chunk.chunkX},${chunk.chunkZ}`));
    const evictedChunks = [...this.resident]
      .filter((key) => !desiredKeys.has(key))
      .map((key) => { const [chunkX, chunkZ] = key.split(",").map(Number); return { chunkX, chunkZ }; })
      .sort((left, right) => left.chunkX - right.chunkX || left.chunkZ - right.chunkZ);
    const residency = this.worldRevision.residency + BigInt(generatedChunks.length * 13 + evictedChunks.length);
    const worldRevision = Object.freeze({ ...this.worldRevision, residency });
    const stateHash = (this.commands + 1).toString(16).padStart(32, "0");
    const receiptPayload = encodeRustIntegratedTerrainResidencyReconcileReceiptV2({
      previousWorldRevision: this.corruption === "previous-revision"
        ? { ...this.worldRevision, residency: this.worldRevision.residency + BigInt(1) }
        : this.worldRevision,
      worldRevision,
      desiredChunkCount: 25,
      generatedChunkCount: generatedChunks.length,
      retainedChunkCount: retainedChunks.length,
      evictedChunkCount: evictedChunks.length,
      residentSections: 300,
      desiredChunks: request.desiredChunks,
      generatedChunks,
      retainedChunks,
      evictedChunks,
      stateHash: this.corruption === "state-hash" ? "ee".repeat(16) : stateHash,
    });
    if (this.corruption === "count") new DataView(receiptPayload.buffer, receiptPayload.byteOffset).setUint32(28 + 48, 24, true);
    if (this.corruption === "partition") new DataView(receiptPayload.buffer, receiptPayload.byteOffset).setInt32(28 + 288, request.desiredChunks[0].chunkZ, true);
    if (this.corruption === "count" || this.corruption === "partition") {
      const checksum = rustIntegratedRuntimeWireChecksumV1(receiptPayload.subarray(28));
      receiptPayload.set(Uint8Array.from(checksum.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16)), 12);
    }
    const before = this.current;
    const after = Object.freeze({
      ...before,
      revision: Object.freeze({ ...before.revision, world: Number(worldRevision.mutation + worldRevision.residency) }),
      stateHash,
    });
    this.resident.clear(); for (const key of desiredKeys) this.resident.add(key);
    this.worldRevision = worldRevision; this.current = after; this.commands += 1;
    return Object.freeze({
      status: "accepted" as const,
      commandId: batch.commandId,
      idempotencyKey: batch.idempotencyKey,
      commandHash: batch.commandHash,
      before,
      after,
      domainReceipts: Object.freeze([{ domain: "world" as const, typeId: "blockwild.world.terrain-residency-reconcile-receipt.r4.v2", schema: 2, payload: receiptPayload, payloadHash: "00".repeat(16) }]),
      receiptHash: "00".repeat(16),
    });
  }

  cursor() { return this.worldRevision; }
}

test("terrain residency reconcile port remains exactly bounded over 2,000 moves", async () => {
  const runtime = new FakeExactTerrainRuntime();
  const port = new RustIntegratedTerrainResidencyPortV1(runtime as unknown as RustIntegratedRuntimeServiceV1);
  let localResident = new Set<string>();
  for (let step = 0; step < 2_000; step += 1) {
    const desiredChunks = sortedChunks(step, -step);
    const receipt = await port.reconcile({
      expectedWorldRevision: runtime.cursor(),
      generationOptionsJson: DEFAULT_OPTIONS,
      desiredChunks,
    });
    localResident = new Set(receipt.desiredChunks.map((chunk) => `${chunk.chunkX},${chunk.chunkZ}`));
    assert.equal(localResident.size, 25);
    assert.equal(runtime.resident.size, 25);
    assert.equal(receipt.residentSections, 300);
  }
  assert.equal(runtime.commands, 2_000);
});

for (const corruption of ["count", "partition", "previous-revision", "state-hash"] as const) {
  test(`terrain residency reconcile rejects ${corruption} receipt before caller-local commit`, async () => {
    const runtime = new FakeExactTerrainRuntime(); runtime.corruption = corruption;
    const port = new RustIntegratedTerrainResidencyPortV1(runtime as unknown as RustIntegratedRuntimeServiceV1);
    const localResident = new Set(["sentinel"]);
    await assert.rejects(port.reconcile({
      expectedWorldRevision: runtime.cursor(),
      generationOptionsJson: DEFAULT_OPTIONS,
      desiredChunks: sortedChunks(0, 0),
    }), /terrain residenc|coordinate lists/u);
    assert.deepEqual([...localResident], ["sentinel"]);
    assert.equal(runtime.resident.size, 25, "accepted native authority may advance but caller-local state does not");
    assert.equal(runtime.commands, 1);
    assert.equal(runtime.shutdowns, 1, "an untrusted accepted receipt makes the port fail the service closed");
  });
}
