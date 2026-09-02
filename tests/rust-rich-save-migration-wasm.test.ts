import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createRichSaveMigrationEnvelopeV1,
  encodeRichSaveMigrationEnvelopeV1,
} from "../app/game/rust-rich-save-migration.ts";
import { encodeCanonicalWorldSaveValueV1 } from "../app/game/world-save-sharding.ts";

type RichMigrationWasm = Readonly<{
  default(input: { module_or_path: Uint8Array }): Promise<unknown>;
  blockwild_rich_save_migration_roundtrip_v1(envelope: Uint8Array, expectedRoot: Uint8Array): Uint8Array;
  blockwild_rich_save_migration_root_v1(envelope: Uint8Array): Uint8Array;
}>;

const HASH_A = "0123456789abcdef0123456789abcdef";
const HASH_B = "fedcba9876543210fedcba9876543210";
const EXPECTED_ROOT = "2b8ba716658e2110c83a5732cadf32f6";
const artifactDirectory = process.env.BLOCKWILD_RICH_MIGRATION_WASM_DIR;

function canonicalSource() {
  return encodeCanonicalWorldSaveValueV1({
    version: 2,
    generatorVersion: 18,
    seed: "rich-save-fixture",
    edits: { "0,0": [[0, 31]] },
    blockFacings: { "0,-64,0": 1 },
    liquidLevels: [["0,-64,0", { kind: "water", level: 0, source: true, falling: false }]],
  });
}

function fixedEnvelope() {
  return createRichSaveMigrationEnvelopeV1({
    source: {
      sourceKey: "blockwild-world-data-v1:rich-save-fixture",
      sourceFormat: "blockwild-world-save-canonical-v1",
      saveVersion: 2,
      payload: canonicalSource(),
    },
    target: {
      universeId: "world:rich-save-fixture",
      locationId: "overworld",
      generatorHash: HASH_A,
      contentHash: HASH_B,
    },
    domains: [
      {
        domainId: "world",
        codecVersion: 4,
        properties: ["edits", "blockFacings"],
        pages: [
          { pageIndex: 1, itemStart: 2, itemCount: 1, payload: Uint8Array.of(0x20, 0x21) },
          { pageIndex: 0, itemStart: 0, itemCount: 2, payload: Uint8Array.of(0x10, 0x11, 0x12) },
        ],
      },
      {
        domainId: "metadata",
        codecVersion: 1,
        properties: ["version", "seed", "generatorVersion"],
        pages: [{ pageIndex: 0, itemStart: 0, itemCount: 3, payload: Uint8Array.of(0x01) }],
      },
      {
        domainId: "liquids",
        codecVersion: 1,
        properties: ["liquidLevels"],
        pages: [{
          pageIndex: 0,
          itemStart: 0,
          itemCount: 1,
          payload: Uint8Array.of(0x77, 0x00, 0x80, 0xff),
        }],
      },
    ],
  });
}

function hexBytes(value: string) {
  assert.match(value, /^[0-9a-f]{32}$/u);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function bytesHex(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("isolated Wasm validates and round-trips the frozen TypeScript BWRM V1 envelope", {
  skip: artifactDirectory ? false : "set BLOCKWILD_RICH_MIGRATION_WASM_DIR to an isolated wasm-bindgen output directory",
}, async () => {
  assert.ok(artifactDirectory);
  const directory = resolve(artifactDirectory);
  const wasm = await import(`${pathToFileURL(resolve(directory, "engine.js")).href}?bwrm=${Date.now()}`) as RichMigrationWasm;
  await wasm.default({ module_or_path: new Uint8Array(await readFile(resolve(directory, "engine_bg.wasm"))) });

  const envelope = fixedEnvelope();
  assert.equal(envelope.envelopeRoot, EXPECTED_ROOT);
  const encoded = encodeRichSaveMigrationEnvelopeV1(envelope);
  const expectedRoot = hexBytes(EXPECTED_ROOT);
  assert.equal(bytesHex(wasm.blockwild_rich_save_migration_root_v1(encoded)), EXPECTED_ROOT);
  assert.deepEqual(wasm.blockwild_rich_save_migration_roundtrip_v1(encoded, expectedRoot), encoded);

  const wrongRoot = Uint8Array.from(expectedRoot);
  wrongRoot[0] ^= 0xff;
  assert.equal(wasm.blockwild_rich_save_migration_roundtrip_v1(encoded, wrongRoot).byteLength, 0);
  assert.equal(wasm.blockwild_rich_save_migration_roundtrip_v1(encoded, expectedRoot.slice(0, -1)).byteLength, 0);
  assert.equal(wasm.blockwild_rich_save_migration_roundtrip_v1(encoded.slice(0, -1), expectedRoot).byteLength, 0);

  const corruptPayload = Uint8Array.from(encoded);
  const marker = Uint8Array.of(0x77, 0x00, 0x80, 0xff);
  const markerOffset = corruptPayload.findIndex((_, index) =>
    index <= corruptPayload.length - marker.length
    && marker.every((byte, offset) => corruptPayload[index + offset] === byte));
  assert.notEqual(markerOffset, -1);
  corruptPayload[markerOffset] ^= 0x40;
  assert.equal(wasm.blockwild_rich_save_migration_root_v1(corruptPayload).byteLength, 0);
  assert.equal(wasm.blockwild_rich_save_migration_roundtrip_v1(corruptPayload, expectedRoot).byteLength, 0);
});
