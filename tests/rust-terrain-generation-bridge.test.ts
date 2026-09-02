import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LEGACY_TERRAIN_CONTENT_HASH_V2,
  TERRAIN_GENERATION_CELL_COUNT_V2,
  TERRAIN_GENERATION_COLUMN_COUNT_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
  TERRAIN_GENERATION_SECTION_COUNT_V2,
  createGenerateChunkRequestV2,
  createGeneratedChunkV2,
  legacyTerrainGeneratorHashV2,
} from "../app/game/terrain-generation-contract.ts";
import {
  encodeRustTerrainGenerationRequestV2,
  parseTerrainGenerationParityCertificateV2,
  terrainGenerationCertificatePromotesV2,
} from "../app/game/rust-terrain-generation-bridge.ts";
import {
  TerrainGenerationParityLedgerV2,
  terrainGenerationChunksByteEqualV2,
} from "../app/game/rust-terrain-generation-backend.ts";

function request() {
  const namespace = "terrain-v5|g18|bridge|{}|-2000000000,2000000000|0";
  return createGenerateChunkRequestV2({
    epoch: 0xffff_fffe,
    taskId: 71,
    revision: 91,
    namespace,
    contentHash: LEGACY_TERRAIN_CONTENT_HASH_V2,
    generatorHash: legacyTerrainGeneratorHashV2(namespace),
    seedText: "large-negative-🌿-9007199254740991",
    generationOptions: { profile: "world-below-v15", structures: true, biomeScale: 1.35 },
    key: "-2000000000,2000000000",
    cx: -2_000_000_000,
    cz: 2_000_000_000,
    edits: [[0, 7], [49_151, 289]],
  });
}

test("Rust generation wire preserves negative i32 coordinates, UTF-8 seed text and u32 authority lanes", () => {
  const encoded = encodeRustTerrainGenerationRequestV2(request());
  assert.deepEqual([...encoded.subarray(0, 4)], [0x42, 0x57, 0x47, 0x32]);
  assert.ok(encoded.byteLength > 200);
  assert.ok(new TextDecoder().decode(encoded).includes("large-negative-🌿-9007199254740991"));
});

test("promotion is fail-closed on corpus size, identities, and byte equality", () => {
  const source = request();
  const certificate = parseTerrainGenerationParityCertificateV2(new TextEncoder().encode(JSON.stringify({
    generatorVersion: 18,
    generatorHash: source.generatorHash,
    contentHash: source.contentHash,
    corpusHash: TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
    corpusCases: TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
    byteEqual: true,
  })));
  assert.equal(terrainGenerationCertificatePromotesV2(certificate, source), true);
  assert.equal(terrainGenerationCertificatePromotesV2({ ...certificate, byteEqual: false }, source), false);
  assert.equal(terrainGenerationCertificatePromotesV2({ ...certificate, corpusCases: 154 }, source), false);
  assert.equal(terrainGenerationCertificatePromotesV2({ ...certificate, corpusCases: 156 }, source), false);
  assert.equal(terrainGenerationCertificatePromotesV2({ ...certificate, corpusHash: "0".repeat(32) }, source), false);
  assert.equal(terrainGenerationCertificatePromotesV2({
    ...certificate,
    corpusHash: "4d4e6b1445b00f3430164d1a8093d8dc",
  }, source), false);
  assert.equal(terrainGenerationCertificatePromotesV2({ ...certificate, generatorHash: "f".repeat(32) }, source), false);
});

test("the production generation worker has no world, Three, or compatibility-oracle dependency", async () => {
  const worker = await readFile(new URL("../app/game/terrain-generation-worker.ts", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../app/game/rust-terrain-generation-bridge.ts", import.meta.url), "utf8");
  for (const source of [worker, bridge]) {
    assert.doesNotMatch(source, /from\s+["']three["']/);
    assert.doesNotMatch(source, /ChunkWorld/);
    assert.doesNotMatch(source, /rust-terrain-generation-legacy-oracle/);
    assert.doesNotMatch(source, /from\s+["'].\/world["']/);
  }
  assert.match(worker, /rust-wasm-authoritative/);
  assert.match(bridge, /shadow-only until generator v18 byte parity is certified/);
});

test("the parity ledger compares every transferred byte and records mismatches", () => {
  const source = request();
  const payload = {
    key: source.key,
    cx: source.cx,
    cz: source.cz,
    blocks: new Uint16Array(TERRAIN_GENERATION_CELL_COUNT_V2),
    heightmap: new Int16Array(TERRAIN_GENERATION_COLUMN_COUNT_V2),
    biomes: new Uint8Array(TERRAIN_GENERATION_COLUMN_COUNT_V2),
    sectionBlockCounts: new Uint16Array(TERRAIN_GENERATION_SECTION_COUNT_V2),
    skyTops: new Int16Array(TERRAIN_GENERATION_COLUMN_COUNT_V2),
    light: new Uint16Array(TERRAIN_GENERATION_CELL_COUNT_V2),
    lightIndices: [] as number[],
    leafIndices: [] as number[],
    structureMarkers: [] as const,
  };
  const reference = createGeneratedChunkV2(source, payload);
  const changedBlocks = payload.blocks.slice();
  changedBlocks[49_151] = 3;
  const candidate = createGeneratedChunkV2(source, { ...payload, blocks: changedBlocks });
  assert.equal(terrainGenerationChunksByteEqualV2(reference, reference), true);
  assert.equal(terrainGenerationChunksByteEqualV2(reference, candidate), false);
  const ledger = new TerrainGenerationParityLedgerV2();
  ledger.record(source, reference, candidate);
  assert.equal(ledger.certificate().byteEqual, false);
  assert.equal(ledger.certificate().mismatches.length, 1);
});
