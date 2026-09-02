import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as production from "../app/game/terrain-generation-contract.ts";
import {
  assignStableCorpusOrdinals,
  expandFrozenPromotionCases,
  expandNormalizedOptionCases,
  loadFrozenPromotionCorpusV1,
  loadNormalizedOptionsExtensionV1,
  requestForPromotionCase,
} from "../scripts/lib/rust-worldgen-promotion-corpus.ts";
import { LegacyGenerationHasherReference } from "./helpers/legacy-generation-hasher-reference.ts";

type Writer = Pick<production.CanonicalGenerationHasher,
  "writeU8" | "writeU16" | "writeU32" | "writeI32" | "writeU64" | "writeI64" | "writeBytes" | "writeString" | "finish">;
type Operation =
  | readonly ["writeU8" | "writeU16" | "writeU32" | "writeI32", number]
  | readonly ["writeU64", number | bigint]
  | readonly ["writeI64", bigint]
  | readonly ["writeBytes", Uint8Array]
  | readonly ["writeString", string];

function apply(writer: Writer, operation: Operation) {
  switch (operation[0]) {
    case "writeU8": writer.writeU8(operation[1]); break;
    case "writeU16": writer.writeU16(operation[1]); break;
    case "writeU32": writer.writeU32(operation[1]); break;
    case "writeI32": writer.writeI32(operation[1]); break;
    case "writeU64": writer.writeU64(operation[1]); break;
    case "writeI64": writer.writeI64(operation[1]); break;
    case "writeBytes": writer.writeBytes(operation[1]); break;
    case "writeString": writer.writeString(operation[1]); break;
  }
}

function errorType(writer: Writer, operation: Operation) {
  try { apply(writer, operation); return null; }
  catch (error) {
    assert.ok(error instanceof Error);
    return error.constructor;
  }
}

function sequence(label: string, operations: readonly Operation[], domain = "blockwild-generated-chunk-v2") {
  const reference = new LegacyGenerationHasherReference(domain);
  const actual = new production.CanonicalGenerationHasher(domain);
  assert.equal(actual.finish(), reference.finish(), `${label}: domain length and bytes`);
  for (const [index, operation] of operations.entries()) {
    assert.equal(errorType(actual, operation), errorType(reference, operation), `${label}: ${index} error type`);
    assert.equal(actual.finish(), reference.finish(), `${label}: ${index} ${operation[0]}`);
    // Taking a digest must not mutate either lane; every subsequent operation
    // deliberately occurs after finish(), including after rejected scalars.
    assert.equal(actual.finish(), reference.finish(), `${label}: repeat finish`);
  }
  return actual.finish();
}

function randomGenerator(seed = 0x9e3779b9) {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function randomBytes(length: number, random: () => number) {
  return Uint8Array.from({ length }, () => random() & 255);
}

test("FNV limb byte core preserves both lanes across 40,000 carry and wrap cases", () => {
  // This implementation-level test is intentional: it proves the optimized
  // arithmetic at arbitrary states, rather than only reachable short prefixes.
  const state = new production.CanonicalGenerationHasher("") as unknown as {
    lowLo: number; lowHi: number; highLo: number; highHi: number;
    writeByte(byte: number, raw: boolean): void;
    finish(): string;
  };
  assert.equal(typeof state.writeByte, "function", "the payload core must use the proven limb implementation");
  const words = [0, 1, 0xff, 0xffff, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff];
  const random = randomGenerator();
  const shift = BigInt(32);
  const mask = BigInt("4294967295");
  for (let index = 0; index < 20_000; index += 1) {
    const lowLo = index < 64 ? words[index % 8] : random();
    const lowHi = index < 64 ? words[Math.floor(index / 8)] : random();
    const highLo = index < 64 ? words[7 - index % 8] : random();
    const highHi = index < 64 ? words[7 - Math.floor(index / 8)] : random();
    const byte = random() & 255;
    for (const raw of [false, true]) {
      Object.assign(state, { lowLo, lowHi, highLo, highHi });
      state.writeByte(byte, raw);
      const low = BigInt.asUintN(64,
        (((BigInt(lowHi) << shift) | BigInt(lowLo)) ^ BigInt(byte)) * BigInt("1099511628211"));
      const high = BigInt.asUintN(64,
        (((BigInt(highHi) << shift) | BigInt(highLo)) ^ BigInt((byte << 1) | (raw ? 1 : 0))) * BigInt("1099511627912"));
      assert.deepEqual([state.lowLo, state.lowHi, state.highLo, state.highHi],
        [Number(low & mask), Number(low >> shift), Number(high & mask), Number(high >> shift)], `${index}/${raw}`);
    }
  }
  Object.assign(state, { lowLo: 0x01234567, lowHi: 0x89abcdef, highLo: 0xfedcba98, highHi: 0x76543210 });
  assert.equal(state.finish(), "67452301efcdab8998badcfe10325476", "finish writes low lane then high lane, each little-endian");
  assert.equal(state.finish(), "67452301efcdab8998badcfe10325476", "finish is non-destructive");
});

test("frozen pre-limb golden digests preserve domains, scalar and bulk separation, UTF-8 and U64 wrapping", () => {
  assert.equal(sequence("empty", [], ""), "c5391a2832f8c7a8c83a5760f515ad47");
  assert.equal(sequence("domain", []), "4595e34c25d4fc3120de93be80c6ea8a");
  const raw = sequence("raw", [["writeU64", 2], ["writeU8", 2], ["writeU8", 1]], "golden");
  const bulk = sequence("bulk", [["writeBytes", Uint8Array.of(2, 1)]], "golden");
  assert.equal(raw, "d9e27b897c3ebd88d85c581ed780640d");
  assert.equal(bulk, "d9e27b897c3ebd881014581ed76f630d");
  assert.equal(raw.slice(0, 16), bulk.slice(0, 16), "equal encoded bytes retain the same low lane");
  assert.notEqual(raw.slice(16), bulk.slice(16), "raw odd XOR must not collapse into bulk even XOR");
  assert.equal(sequence("utf8", [["writeString", "A\0é🦊\ud800"]], "golden"), "b2d671381d7ce7685015b024e8c1a80f");
  assert.equal(sequence("scalars", [
    ["writeU8", -1], ["writeU16", 65537], ["writeU32", -2147483649],
    ["writeU64", BigInt("18446744073709551617")], ["writeI64", BigInt(-1)],
  ], "golden"), "cfd32bb1299230b5b8454454a1245bbe");
});

test("all 256 byte values, empty payloads, nonzero-offset views and byte length boundaries match BigInt", () => {
  for (let byte = 0; byte < 256; byte += 1) {
    sequence(`byte-${byte}`, [["writeBytes", Uint8Array.of(byte)], ["writeU8", byte]]);
  }
  const all = Uint8Array.from({ length: 256 }, (_, index) => index);
  sequence("all-byte-values", [["writeBytes", all], ["writeBytes", all.subarray(17, 239)]]);
  const random = randomGenerator();
  for (const length of [0, 1, 2, 3, 4, 7, 8, 15, 16, 31, 32, 255, 256, 257, 1023, 1024, 4095, 4096]) {
    sequence(`length-${length}`, [["writeBytes", randomBytes(length, random)]]);
  }
});

test("numeric scalar coercions and invalid U64 numbers retain exact pre-limb behavior", () => {
  const numbers = [0, -0, 1, -1, 255, 256, 257, 65535, 65536, 65537, 0x7fffffff, 0x80000000,
    0xffffffff, 0x100000000, 0x100000001, -0x80000000, -0x80000001,
    Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 1.5, -1.5, NaN, Infinity, -Infinity];
  for (const method of ["writeU8", "writeU16", "writeU32", "writeI32", "writeU64"] as const) {
    for (const [index, value] of numbers.entries()) {
      sequence(`${method}-${index}`, [[method, value], ["writeU8", 0x91]]);
    }
  }
});

test("signed, negative and oversized U64/I64 values preserve low-eight-byte semantics", () => {
  const one = BigInt(1);
  const bit = (shift: number) => one << BigInt(shift);
  const values = [BigInt(0), one, BigInt(255), BigInt(256), BigInt(65535), BigInt(65536),
    bit(32) - one, bit(32), bit(53) - one, bit(53), bit(63) - one, bit(63),
    bit(64) - one, bit(64), bit(64) + one, bit(128) - one, -one, -bit(63), -bit(64) - one];
  for (const method of ["writeU64", "writeI64"] as const) {
    for (const [index, value] of values.entries()) sequence(`${method}-${index}`, [[method, value]]);
  }
});

test("UTF-8, unpaired surrogates and domain length encoding match the frozen reference", () => {
  const strings = ["", "ASCII", "\0", "A\0B", "é", "e\u0301", "中文", "🦊🌊", "\ud800", "\udfff",
    "\ud800A\udfff", "line\r\nline\n", "ø".repeat(32768)];
  for (const [index, value] of strings.entries()) {
    sequence(`utf8-${index}`, [["writeString", value], ["writeBytes", new TextEncoder().encode(value)]], value.slice(0, 20));
  }
  assert.notEqual(sequence("joined", [["writeString", "ab"]]), sequence("split", [["writeString", "a"], ["writeString", "b"]]));
});

test("128 reproducible mixed-writer sequences remain equal after every write and digest", () => {
  const random = randomGenerator();
  for (let index = 0; index < 128; index += 1) {
    const operations: Operation[] = [];
    for (let operation = 0; operation < 16; operation += 1) {
      switch (random() % 6) {
        case 0: operations.push(["writeBytes", randomBytes(random() % 4097, random)]); break;
        case 1: operations.push(["writeU64", (BigInt(random()) << BigInt(32)) | BigInt(random())]); break;
        case 2: operations.push(["writeI64", -((BigInt(random()) << BigInt(32)) | BigInt(random()))]); break;
        case 3: operations.push(["writeU32", random()]); break;
        case 4: operations.push(["writeString", `domain-${random()}-\0-🦊`]); break;
        case 5: operations.push(["writeU16", random()]); break;
      }
    }
    sequence(`random-${index}`, operations);
  }
});

test("18 representative 198–250 KiB zero, all-ones and random payloads preserve exact digests", () => {
  const random = randomGenerator();
  for (const length of [198 * 1024, 198_822, 199_036, 201_257, 203_516, 250 * 1024]) {
    for (const [kind, bytes] of [
      ["zero", new Uint8Array(length)],
      ["ff", new Uint8Array(length).fill(255)],
      ["random", randomBytes(length, random)],
    ] as const) sequence(`${length}-${kind}`, [["writeBytes", bytes]]);
  }
});

async function contractWithIndependentHasher(): Promise<typeof production> {
  const source = await readFile(new URL("../app/game/terrain-generation-contract.ts", import.meta.url), "utf8");
  const reference = await readFile(new URL("./helpers/legacy-generation-hasher-reference.ts", import.meta.url), "utf8");
  const compileUrl = (input: string) => {
    const output = transpileModule(input, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  };
  const start = source.indexOf("export class CanonicalGenerationHasher {");
  const end = source.indexOf("\nconst SETTLEMENT_FACTIONS_V1", start);
  assert.ok(start > 0 && end > start, "canonical hasher class boundaries changed");
  // Reuse current protocol writers/validators, but all old hash arithmetic and
  // constants come from the independent frozen helper. No work/ or artifacts.
  const replaced = `${source.slice(0, start)}import { LegacyGenerationHasherReference as CanonicalGenerationHasher } from ${JSON.stringify(compileUrl(reference))};\nexport { CanonicalGenerationHasher };\n${source.slice(end)}`;
  return import(compileUrl(replaced)) as Promise<typeof production>;
}

test("all 155 current promotion request/content/generator hashes match the independent full-contract reference", async () => {
  const legacy = await contractWithIndependentHasher();
  const [frozen, extension] = await Promise.all([loadFrozenPromotionCorpusV1(), loadNormalizedOptionsExtensionV1()]);
  const cases = assignStableCorpusOrdinals(expandFrozenPromotionCases(frozen), expandNormalizedOptionCases(extension));
  assert.equal(cases.length, 155);
  assert.equal(production.LEGACY_TERRAIN_CONTENT_HASH_V2, legacy.LEGACY_TERRAIN_CONTENT_HASH_V2);
  for (const entry of cases) {
    const request = requestForPromotionCase(entry);
    assert.equal(request.generatorHash, legacy.legacyTerrainGeneratorHashV2(request.namespace), entry.id);
    assert.deepEqual(request, legacy.createGenerateChunkRequestV2(request), entry.id);
    assert.equal(request.requestHash, legacy.hashGenerateChunkRequestV2(request), entry.id);
  }
});

test("full GeneratedChunkV2 bytes/hash remain equal and all ten mutated streams fail closed", async () => {
  const legacy = await contractWithIndependentHasher();
  const namespace = "terrain-v5|g18|HASH-DIFFERENTIAL|{}|-8,-1|0";
  const request = production.createGenerateChunkRequestV2({
    epoch: 7, taskId: 42, revision: 11, namespace,
    contentHash: production.LEGACY_TERRAIN_CONTENT_HASH_V2,
    generatorHash: production.legacyTerrainGeneratorHashV2(namespace), seedText: "HASH-DIFFERENTIAL",
    generationOptions: { structures: true, nested: { z: 1, a: true } }, key: "-8,-1", cx: -8, cz: -1, edits: [[0, 7], [49151, 3]],
  });
  const payload: production.GeneratedChunkV2Payload = {
    key: request.key, cx: request.cx, cz: request.cz,
    blocks: new Uint16Array(49152), heightmap: new Int16Array(256).fill(-64),
    biomes: new Uint8Array(256), sectionBlockCounts: new Uint16Array(12),
    skyTops: new Int16Array(256).fill(127), light: new Uint16Array(49152),
    lightIndices: [1, 33], leafIndices: [77],
    structureMarkers: [["a-marker", { type: "landmark", id: "a", position: { x: -120, y: 40, z: -8 }, tag: "hash" }]],
  };
  const result = production.createGeneratedChunkV2(request, payload);
  assert.deepEqual(result, legacy.createGeneratedChunkV2(request, payload));
  assert.equal(production.generatedChunkTransferListV2(result).length, 10);
  const streams = ["blocks", "heightmap", "biomes", "sectionBlockCounts", "skyTops", "light", "lightIndices", "leafIndices"] as const;
  const mutations: production.GeneratedChunkV2[] = streams.map((field) => {
    const values = result[field].slice();
    values[0] ^= 1;
    return { ...result, [field]: values };
  });
  for (const field of ["offsets", "bytes"] as const) {
    const values = result.markerTable[field].slice();
    values[values.length - 1] ^= 1;
    mutations.push({ ...result, markerTable: { ...result.markerTable, [field]: values } });
  }
  assert.equal(mutations.length, 10);
  for (const [index, mutated] of mutations.entries()) {
    for (const contract of [production, legacy]) {
      assert.throws(() => contract.assertGeneratedChunkMatchesRequestV2(mutated, request), `stream ${index}`);
      assert.throws(() => contract.generatedChunkTransferListV2(mutated), `transfer stream ${index}`);
    }
  }
});
