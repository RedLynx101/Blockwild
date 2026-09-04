import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1,
  RUST_HISTORICAL_SAVE_COMPATIBILITY_SCHEMA_V1,
  RustHistoricalSaveCompatibilityError,
  assertRustHistoricalSaveCompatibilityPlanV1,
  assertRustHistoricalSaveCompatibilityReadbackV1,
  planRustHistoricalSaveCompatibilityV1,
  type RustHistoricalSaveCompatibilityInputV1,
} from "../app/game/rust-historical-save-compatibility.ts";
import { persistencePayloadHashV1 } from "../app/game/persistence-journal-contract.ts";
import { requireRustLegacyWorldOnlyMigrationV1, planRustLegacyWorldMigrationV1 } from "../app/game/rust-legacy-world-migration.ts";
import { encodeCanonicalWorldSaveValueV1 } from "../app/game/world-save-sharding.ts";
import {
  deriveWorldGenerationIdentityV1,
  migrateLegacyWorldSave,
  normalizeWorldOptions,
  type WorldOptions,
} from "../app/game/world-storage.ts";

const CONTENT_HASH = "ab".repeat(16);
const FIXTURE = new URL("fixtures/rust-engine/r3/historical-saves/", import.meta.url);

type MutableJsonRecord = Record<string, unknown>;
type HistoricalFixtureDocument = MutableJsonRecord & {
  world: MutableJsonRecord & {
    metadata: MutableJsonRecord;
    options: MutableJsonRecord;
    save: MutableJsonRecord & {
      generatorVersion: number;
      edits: Record<string, unknown[]>;
      mode: string;
      player: MutableJsonRecord & { x: number };
      spawn: MutableJsonRecord;
      seed: string;
    };
  };
};
type DeepMutable<T> = T extends Uint8Array
  ? Uint8Array
  : T extends readonly (infer Item)[]
    ? DeepMutable<Item>[]
    : T extends object
      ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
      : T;

function jsonBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function rawSha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function importedFingerprint(version: 16 | 17) { return `worldfp_import_historical-g${version}_fixture`; }

function sourceFixtureBytes(version: 16 | 17) {
  return Uint8Array.from(readFileSync(new URL(
    `g${version}-${version === 16 ? "omitted-settlement-pattern" : "modern-control"}.blockwild.json`,
    FIXTURE,
  )));
}

function sourceDocument(bytes: Uint8Array) {
  return JSON.parse(new TextDecoder().decode(bytes)) as HistoricalFixtureDocument;
}

function sourceInput(
  version: 16 | 17 = 16,
  mutate?: (document: HistoricalFixtureDocument) => void,
): RustHistoricalSaveCompatibilityInputV1 {
  const originalBytes = sourceFixtureBytes(version);
  const document = sourceDocument(originalBytes);
  mutate?.(document);
  const bytes = mutate ? jsonBytes(document) : originalBytes;
  const normalizedSave = migrateLegacyWorldSave(document.world.save)!;
  const save = { ...normalizedSave, agentWorldFingerprint: importedFingerprint(version) };
  const sourceOptions = version === 16
    ? { ...document.world.options, settlementPattern: "legacy-scattered-v1" }
    : document.world.options;
  const options = normalizeWorldOptions(sourceOptions) as WorldOptions;
  const generationIdentity = deriveWorldGenerationIdentityV1(save, options);
  const catalogWorldId = `historical-g${version}`;
  const rawSha = rawSha256(bytes);
  return {
    schemaVersion: 1,
    authority: {
      claim: RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1,
      nativePlayer: "off",
      nativeRichState: "not-adopted",
    },
    originalSource: {
      schemaVersion: 1,
      provenance: "uploaded-file-bytes",
      sourceFormat: "blockwild-world-export-v1",
      encoding: "utf-8",
      archiveWorldId: "blockwild-original-import-sources-v1",
      objectId: `sha256-${rawSha}`,
      rawSha256: rawSha,
      byteLength: bytes.byteLength,
    },
    sourceBytes: bytes,
    normalizedSource: { save, options },
    target: {
      catalogWorldId,
      universeId: `world:${catalogWorldId}`,
      locationId: "overworld",
      worldSeed: save.seed,
      contentHash: CONTENT_HASH,
      generationIdentity,
    },
  };
}

function cloneInput(input: RustHistoricalSaveCompatibilityInputV1): DeepMutable<RustHistoricalSaveCompatibilityInputV1> {
  return structuredClone(input) as unknown as DeepMutable<RustHistoricalSaveCompatibilityInputV1>;
}

test("g16 and g17 produce exhaustive external-custody plans without R5/R8 claims", async () => {
  for (const version of [16, 17] as const) {
    const input = sourceInput(version);
    const plan = await planRustHistoricalSaveCompatibilityV1(input);
    assert.equal(plan.schemaVersion, RUST_HISTORICAL_SAVE_COMPATIBILITY_SCHEMA_V1);
    assert.equal(plan.status, "external-custody-planned");
    assert.equal(plan.authority.claim, RUST_HISTORICAL_SAVE_COMPATIBILITY_AUTHORITY_V1);
    assert.equal(plan.authority.nativePlayer, "off");
    assert.equal(plan.authority.nativeRichState, "not-adopted");
    assert.equal(plan.nativeExecutionScope, "world-r4-projection-only");
    assert.equal(plan.source.raw.generatorVersion, version);
    assert.equal(plan.source.raw.rawSha256, input.originalSource.rawSha256);
    assert.match(plan.source.normalized.semanticHash, /^[0-9a-f]{32}$/u);
    assert.equal(
      plan.source.normalized.semanticHash,
      persistencePayloadHashV1(encodeCanonicalWorldSaveValueV1(input.normalizedSource.save)),
    );
    assert.deepEqual(plan.target.options, input.normalizedSource.options);
    assert.equal(plan.target.options.settlementPattern, version === 16 ? "legacy-scattered-v1" : "heartlands-v2");
    assert.deepEqual(plan.target.generationIdentity, input.target.generationIdentity);
    const sourceProperties = Object.keys(input.normalizedSource.save).sort();
    assert.deepEqual(plan.sourceProperties, sourceProperties);
    const assigned = plan.domains.flatMap(domain => domain.properties).sort();
    assert.deepEqual(assigned, sourceProperties);
    assert.deepEqual(plan.domains.find(domain => domain.id === "native-world-r4")?.properties, ["edits"]);
    assert.ok(plan.domains.find(domain => domain.id === "typescript-player")?.properties.includes("player"));
    assert.ok(plan.domains.find(domain => domain.id === "typescript-runtime-clocks")?.properties.includes("time"));
    assert.ok(plan.domains.find(domain => domain.id === "typescript-machines")?.properties.includes("chests"));
    assert.equal(plan.nativeWorld.expectedReadback.nativeWorldSemanticHash, plan.nativeWorld.projectionHash);
    assert.equal(plan.nativeWorld.expectedReadback.editCount, 39);
    assert.equal(plan.nativeWorld.expectedReadback.facingCount, 0);
    assert.ok(Object.isFrozen(plan));
    assert.ok(Object.isFrozen(plan.domains));
    assert.ok(plan.domains.every(domain => Object.isFrozen(domain) && Object.isFrozen(domain.properties)));
    await assert.doesNotReject(() => assertRustHistoricalSaveCompatibilityPlanV1(plan, input));
  }
});

test("the legacy world-only guard remains closed for the same rich saves", async () => {
  const input = sourceInput();
  const plan = planRustLegacyWorldMigrationV1({ save: input.normalizedSource.save, address: {
    universeId: input.target.universeId, locationId: input.target.locationId,
  } });
  assert.throws(() => requireRustLegacyWorldOnlyMigrationV1(plan), /unsupported native domains/u);
  await assert.doesNotReject(() => planRustHistoricalSaveCompatibilityV1(input));
});

test("raw provenance, exact bytes, UTF-8 and duplicate JSON keys fail closed", async () => {
  const base = sourceInput();
  for (const changed of [
    { ...base, originalSource: undefined },
    { ...base, originalSource: { ...base.originalSource, provenance: "decoded-text" } },
    { ...base, originalSource: { ...base.originalSource, byteLength: base.originalSource.byteLength + 1 } },
    { ...base, originalSource: { ...base.originalSource, rawSha256: "0".repeat(63), objectId: `sha256-${"0".repeat(63)}` } },
    { ...base, originalSource: { ...base.originalSource, rawSha256: "0".repeat(64), objectId: `sha256-${"0".repeat(64)}` } },
    { ...base, sourceBytes: Uint8Array.of(0xff) },
  ]) await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(changed), RustHistoricalSaveCompatibilityError);
  const raw = new TextDecoder().decode(base.sourceBytes).replace('"health": 10', '"health": 9, "health": 10');
  const bytes = new TextEncoder().encode(raw);
  const duplicate = cloneInput(base);
  duplicate.sourceBytes = bytes;
  duplicate.originalSource = { ...duplicate.originalSource, rawSha256: rawSha256(bytes), objectId: `sha256-${rawSha256(bytes)}`, byteLength: bytes.length };
  await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(duplicate), /duplicate/i);
});

test("normalization, options, target, address and content drift reject before a plan exists", async () => {
  const base = sourceInput(16);
  const mutations: Array<(input: DeepMutable<RustHistoricalSaveCompatibilityInputV1>) => void> = [
    input => { input.normalizedSource.save.player.x += 1; },
    input => { input.normalizedSource.options.settlementPattern = "heartlands-v2"; },
    input => { input.target.worldSeed += "-wrong"; },
    input => { input.target.catalogWorldId += "-wrong"; },
    input => { input.normalizedSource.save.agentWorldFingerprint = "worldfp_import_another-world_fixture"; },
    input => { input.target.generationIdentity.generatorHash = "0".repeat(32); },
    input => { input.target.generationIdentity.terrainContentHash = "0".repeat(32); },
    input => { input.target.generationIdentity.generationOptionsJson = "{}"; },
    input => { input.target.contentHash = "0".repeat(31); },
  ];
  for (const mutate of mutations) {
    const changed = cloneInput(base);
    mutate(changed);
    await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(changed), RustHistoricalSaveCompatibilityError);
  }
});

test("unknown, unassigned, liquid and orphan-facing state cannot be relabeled external", async () => {
  await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(sourceInput(16, document => {
    document.world.save.futureCustody = { opaque: true };
  })), /unknown|unassigned/i);
  await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(sourceInput(16, document => {
    document.world.save.liquidLevels = [];
  })), /liquid/i);
  await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(sourceInput(16, document => {
    document.world.save.blockFacings = { "0,0,0": 1 };
  })), /orphan|facing/i);
  await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(sourceInput(16, document => {
    document.world.options.futureOption = true;
  })), /option|unknown/i);
  await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(sourceInput(16, document => {
    Object.defineProperty(document.world.save, "__proto__", {
      value: null,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  })), /unknown|unassigned/i);
  for (const { mutate, code } of [
    { mutate: (document: HistoricalFixtureDocument) => { document.world.save.player.velocity = { x: 1, y: 2, z: 3 }; }, code: "lossy-normalization" },
    { mutate: (document: HistoricalFixtureDocument) => { document.world.save.spawn.worldId = "lost-world"; }, code: "lossy-normalization" },
    { mutate: (document: HistoricalFixtureDocument) => { document.world.save.edits["-08,-1"] = [[1, 3]]; }, code: "invalid-projection" },
    { mutate: (document: HistoricalFixtureDocument) => { document.world.save.edits["-8,-1"].push([1, 3, 99]); }, code: "lossy-normalization" },
  ]) {
    await assert.rejects(
      () => planRustHistoricalSaveCompatibilityV1(sourceInput(16, mutate)),
      error => error instanceof RustHistoricalSaveCompatibilityError && error.code === code,
    );
  }
});

test("R5 and native-rich authority requests are rejected rather than silently narrowed", async () => {
  const base = sourceInput();
  for (const authority of [
    { ...base.authority, nativePlayer: "experimental-r5" },
    { ...base.authority, nativeRichState: "adopt" },
    { ...base.authority, claim: "rust-native-rich-save" },
  ]) await assert.rejects(() => planRustHistoricalSaveCompatibilityV1({ ...base, authority }), /authority|R5|rich/i);
});

test("native BWAS readback is exact and rejects hash, count, byte and target substitutions", async () => {
  const input = sourceInput();
  const plan = await planRustHistoricalSaveCompatibilityV1(input);
  const expected = plan.nativeWorld.expectedReadback;
  assert.deepEqual(assertRustHistoricalSaveCompatibilityReadbackV1(plan, expected), expected);
  for (const changed of [
    { ...expected, nativeWorldSemanticHash: "0".repeat(32) },
    { ...expected, projectionHash: "0".repeat(32) },
    { ...expected, editCount: expected.editCount + 1 },
    { ...expected, facingCount: expected.facingCount + 1 },
    { ...expected, projectionByteLength: expected.projectionByteLength + 1 },
    { ...expected, universeId: `${expected.universeId}-wrong` },
  ]) assert.throws(() => assertRustHistoricalSaveCompatibilityReadbackV1(plan, changed), RustHistoricalSaveCompatibilityError);
});

test("revalidation catches resealed mutations, duplicate ownership and mutable byte drift", async () => {
  const input = sourceInput();
  const plan = await planRustHistoricalSaveCompatibilityV1(input);
  const variants: unknown[] = [
    { ...plan, planHash: "0".repeat(32) },
    { ...plan, target: { ...plan.target, contentHash: "1".repeat(32) } },
    { ...plan, authority: { ...plan.authority, nativePlayer: "experimental-r5" } },
    { ...plan, unassignedEnvelopeField: true },
    {
      ...plan,
      source: {
        ...plan.source,
        normalized: { ...plan.source.normalized, unassignedNormalizedField: true },
      },
    },
  ];
  const duplicate = structuredClone(plan) as DeepMutable<typeof plan>;
  duplicate.domains[2].properties.push(plan.domains[1].properties[0]);
  variants.push(duplicate);
  const changedBytes = structuredClone(plan) as DeepMutable<typeof plan>;
  changedBytes.source.normalized.canonicalBytes[0] ^= 1;
  variants.push(changedBytes);
  const changedProjection = structuredClone(plan) as DeepMutable<typeof plan>;
  changedProjection.nativeWorld.projectionBytes[0] ^= 1;
  variants.push(changedProjection);
  for (const candidate of variants) {
    await assert.rejects(() => assertRustHistoricalSaveCompatibilityPlanV1(candidate, input), RustHistoricalSaveCompatibilityError);
  }
  const changedReference = cloneInput(input);
  changedReference.originalSource.rawSha256 = "0".repeat(64);
  changedReference.originalSource.objectId = `sha256-${changedReference.originalSource.rawSha256}`;
  await assert.rejects(
    () => assertRustHistoricalSaveCompatibilityPlanV1(plan, changedReference),
    RustHistoricalSaveCompatibilityError,
  );
});

test("planner owns its source, normalized and target snapshots before caller mutation", async () => {
  const input = sourceInput();
  const expectedBytes = Uint8Array.from(input.sourceBytes);
  const expectedSave = structuredClone(input.normalizedSource.save);
  const pending = planRustHistoricalSaveCompatibilityV1(input);
  input.sourceBytes.fill(0);
  (input.normalizedSource.save.player as { x: number }).x = 999;
  (input.target as { contentHash: string }).contentHash = "0".repeat(32);
  const plan = await pending;
  assert.equal(plan.source.raw.rawSha256, rawSha256(expectedBytes));
  assert.deepEqual(plan.source.normalized.canonicalBytes, encodeCanonicalWorldSaveValueV1(expectedSave));
  assert.equal(plan.target.contentHash, CONTENT_HASH);
  await assert.rejects(
    () => assertRustHistoricalSaveCompatibilityPlanV1(plan, input),
    RustHistoricalSaveCompatibilityError,
  );
});

test("custom accessors, array subclasses and byte hooks are never invoked", async () => {
  const base = sourceInput();
  let calls = 0;
  Object.defineProperty(base.sourceBytes, "byteLength", { get() { calls += 1; throw new Error("byte hook"); } });
  await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(base), /byte|shape|hook/i);
  assert.equal(calls, 0);
  const arrayInput = cloneInput(sourceInput());
  const factions = [...arrayInput.normalizedSource.options.enabledFactions];
  Object.setPrototypeOf(factions, Object.create(Array.prototype, {
    [Symbol.iterator]: { get() { calls += 1; throw new Error("array hook"); } },
  }));
  arrayInput.normalizedSource.options.enabledFactions = factions;
  await assert.rejects(() => planRustHistoricalSaveCompatibilityV1(arrayInput), /array|prototype|JSON/i);
  assert.equal(calls, 0);
});

test("canonical domain ordering is independent of normalized source insertion order", async () => {
  const firstInput = sourceInput();
  const secondInput = cloneInput(firstInput);
  secondInput.normalizedSource.save = Object.fromEntries(
    Object.entries(secondInput.normalizedSource.save).reverse(),
  ) as DeepMutable<typeof secondInput.normalizedSource.save>;
  const first = await planRustHistoricalSaveCompatibilityV1(firstInput);
  const second = await planRustHistoricalSaveCompatibilityV1(secondInput);
  assert.equal(first.planHash, second.planHash);
  assert.deepEqual(first.domains, second.domains);
  assert.deepEqual(first.source.normalized.canonicalBytes, second.source.normalized.canonicalBytes);
});

test("frozen g16/g17 interoperability vectors pin external custody and BWAS identity", async () => {
  const vectors = [];
  for (const version of [16, 17] as const) {
    const plan = await planRustHistoricalSaveCompatibilityV1(sourceInput(version));
    vectors.push({
      version,
      rawSha256: plan.source.raw.rawSha256,
      normalizedHash: plan.source.normalized.semanticHash,
      optionsHash: plan.target.optionsSemanticHash,
      projectionHash: plan.nativeWorld.projectionHash,
      custodyRoot: plan.custodyRoot,
      planHash: plan.planHash,
      projectionBytes: Buffer.from(plan.nativeWorld.projectionBytes).toString("hex"),
    });
  }
  assert.deepEqual(vectors, [
    {
      version: 16,
      rawSha256: "e9541ff6ff649d9b22b8c5641c93072a0e6729bf71aa5125bece9ab67b08926b",
      normalizedHash: "8de0f922bcf7965dd0b499c0f9a9cd94",
      optionsHash: "ac7b5c7bcc4a71f75036906fd66f99b6",
      projectionHash: "d723bbdd75384b05a09ba1cde30cc5d1",
      custodyRoot: "2d9a7050bc59c9fa501eba5d1bd608e9",
      planHash: "4ce8b6ee9bd7137e504ed79269c5196b",
      projectionBytes: "4257415301001400776f726c643a686973746f726963616c2d67313609006f766572776f726c6401000000000000000000000000000000000000000000000002000000f7ffffffffffffff020000008f68000003008f6900000000f8ffffffffffffff25000000776800000300786800000300796800000300876800000300886800000300896800000300976800000300986800000300996800000300776900000000786900000000796900000000876900000000886900000000896900000000976900000000986900000000996900000000686a00000d00776a00000000786a00000000796a00000000876a00000000886a00000000896a00000000976a00000000986a00000000996a00000000776b00000000786b00000000796b00000000876b00000000886b00000000896b00000000976b00000000986b00000000996b00000000000000000000000061313330396432636161666434653363353033343138333635346635373332623132663831663765323330633331663332303735313764656138363037626532",
    },
    {
      version: 17,
      rawSha256: "5699215fb8fc2cf0219a672874644c4e79d48e4a95fca2d285cb6bf2c2ca148a",
      normalizedHash: "cf2cf5498757b217d0b499c0f9a9cd94",
      optionsHash: "3df217b5e6fc05095036906fd66f99b6",
      projectionHash: "e420b06d76da26b90063190ce4e820dd",
      custodyRoot: "1a57699f59d4060d501eba5d1bd608e9",
      planHash: "f7d43eeef8af0911504ed79269c5196b",
      projectionBytes: "4257415301001400776f726c643a686973746f726963616c2d67313709006f766572776f726c6401000000000000000000000000000000000000000000000002000000f7ffffffffffffff020000008f68000003008f6900000000f8ffffffffffffff25000000776800000300786800000300796800000300876800000300886800000300896800000300976800000300986800000300996800000300776900000000786900000000796900000000876900000000886900000000896900000000976900000000986900000000996900000000686a00000d00776a00000000786a00000000796a00000000876a00000000886a00000000896a00000000976a00000000986a00000000996a00000000776b00000000786b00000000796b00000000876b00000000886b00000000896b00000000976b00000000986b00000000996b00000000000000000000000066633862633131383532396333383131353033343138333635346635373332623235303764633838363037663462353732303735313764656138363039623030",
    },
  ]);
});
