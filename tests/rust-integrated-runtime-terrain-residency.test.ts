import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeRustIntegratedTerrainResidencyReceiptV1,
  encodeRustIntegratedTerrainResidencyRequestV1,
} from "../app/game/rust-integrated-runtime-terrain-residency.ts";

const REQUEST_GOLDEN = "425754340100010088010000de1f6d729fdb3858b8c5c4571516987007000000000000000b000000000000000d00000000000000580100007b2262696f6d655363616c65223a312e33352c22636176654672657175656e6379223a312c22656e61626c656446616374696f6e73223a5b22686f6262697473222c22676f626c696e73222c2261746c616e7469616e73222c227375676172636f757274222c22776f6f642d656c766573222c2264776172766573225d2c226c61726765546f776e4672657175656e6379223a2262616c616e636564222c2270726f66696c65223a22776f726c642d62656c6f772d763135222c227265736f757263654162756e64616e6365223a312c22726f6164436f766572616765223a22726567696f6e616c222c22736574746c656d656e74436c7573746572696e67223a22726567696f6e616c222c22736574746c656d656e7444656e73697479223a312c22736574746c656d656e745061747465726e223a2268656172746c616e64732d7632222c2273747275637475726573223a747275657d02000000feffffff0300000004000000fbffffff";
const RECEIPT_GOLDEN = "42575534010001000001000060614df5f7d98929d8039275ae9f18b307000000000000000b000000000000000d0000000000000007000000000000000b000000000000002500000000000000020000000100000001000000020000001800000002000000feffffff03000000010c000100000011000000010101010101010101010101010101010202020202020202020202020202020203030303030303030303030303030303040404040404040404040404040404040004000000fbffffff000c000000000013000000050505050505050505050505050505050606060606060606060606060606060607070707070707070707070707070707080808080808080808080808080808080109090909090909090909090909090909";
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
