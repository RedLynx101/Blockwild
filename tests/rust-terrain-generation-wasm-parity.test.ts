import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";
import {
  createGeneratedChunkV2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2,
  TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2,
} from "../app/game/terrain-generation-contract.ts";
import { terrainGenerationChunksByteEqualV2 } from "../app/game/rust-terrain-generation-backend.ts";
import {
  decodeRustTerrainGenerationResultV2,
  encodeRustTerrainGenerationRequestV2,
  parseTerrainGenerationParityCertificateV2,
} from "../app/game/rust-terrain-generation-bridge.ts";
import { generateChunkWithLegacyOracleV2 } from "../app/game/rust-terrain-generation-legacy-oracle.ts";
import {
  COMPOSED_PROMOTION_CASES_V2,
  assignStableCorpusOrdinals,
  expandFrozenPromotionCases,
  expandNormalizedOptionCases,
  loadFrozenPromotionCorpusV1,
  loadNormalizedOptionsExtensionV1,
  promotionCorpusHashV2,
  requestForPromotionCase,
  type PromotionParityHashRowV2,
} from "../scripts/lib/rust-worldgen-promotion-corpus.ts";
import { resolveRustEngineTestDefaultArtifact } from "./helpers/rust-engine-test-artifact.ts";

type GenerationWasm = Readonly<{
  default(input: { module_or_path: Uint8Array }): Promise<unknown>;
  blockwild_generate_chunk_v2(request: Uint8Array): Uint8Array;
  blockwild_generation_parity_certificate_v2(): Uint8Array;
}>;

const ROOT = resolve(import.meta.dirname, "..");

test("published Wasm is exact on the complete R3 v2 promotion corpus", async () => {
  const [frozenManifest, extensionManifest] = await Promise.all([
    loadFrozenPromotionCorpusV1(),
    loadNormalizedOptionsExtensionV1(),
  ]);
  const cases = assignStableCorpusOrdinals(
    expandFrozenPromotionCases(frozenManifest),
    expandNormalizedOptionCases(extensionManifest),
  );
  const { artifactDirectory, hash } = await resolveRustEngineTestDefaultArtifact(ROOT);
  const wasmModule = await import(`${pathToFileURL(resolve(artifactDirectory, "engine.js")).href}?r3=${Date.now()}`) as GenerationWasm;
  await wasmModule.default({ module_or_path: new Uint8Array(await readFile(resolve(artifactDirectory, "engine_bg.wasm"))) });

  const parityRows: PromotionParityHashRowV2[] = [];
  for (const entry of cases) {
    const request = requestForPromotionCase(entry);
    const reference = createGeneratedChunkV2(request, generateChunkWithLegacyOracleV2(request));
    const candidate = decodeRustTerrainGenerationResultV2(
      wasmModule.blockwild_generate_chunk_v2(encodeRustTerrainGenerationRequestV2(request)),
      request,
    );
    assert.equal(terrainGenerationChunksByteEqualV2(reference, candidate), true,
      `${entry.id}: published Wasm artifact ${hash} differs from the TypeScript v18 oracle`);
    parityRows.push(Object.freeze({
      id: entry.id,
      referenceChunkHash: reference.chunkHash,
      candidateChunkHash: candidate.chunkHash,
    }));
  }

  const corpusHash = promotionCorpusHashV2(frozenManifest, extensionManifest, parityRows);
  const certificate = parseTerrainGenerationParityCertificateV2(wasmModule.blockwild_generation_parity_certificate_v2());
  assert.equal(certificate.byteEqual, true);
  assert.equal(cases.length, COMPOSED_PROMOTION_CASES_V2);
  assert.equal(certificate.corpusCases, TERRAIN_GENERATION_PROMOTION_CORPUS_CASES_V2);
  assert.equal(certificate.corpusHash, TERRAIN_GENERATION_PROMOTION_CORPUS_HASH_V2);
  assert.equal(certificate.corpusHash, corpusHash);
});
