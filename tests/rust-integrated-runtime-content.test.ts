import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import fixture from "./fixtures/rust-engine/r7/content-metadata-roundtrip-v1.json";
import {
  canonicalMetadataBlobHashV1,
  RUST_BLOCK_ACTION_CATALOG_ID,
  RUST_BLOCK_ACTION_CATALOG_SCHEMA,
  compileBlockwildProductionContent,
  compileRustProductionContent,
  requireBlockwildProductionContent,
  rustContentAuditReport,
  validateRustContentExpectation,
  type RustContentDomain,
  type RustContentSourceEntry,
} from "../app/game/rust-integrated-runtime-content";
import { isDirectionallyPlacedBlock } from "../app/game/block-facing";
import { BLOCKS, ITEMS, itemForBlock } from "../app/game/data";
import {
  attestPlayerRenderProfileV1,
  BLOCKWILD_PLAYER_RENDER_PROFILE_V1,
  loadAttestedPlayerRenderProfileV1,
  PLAYER_RENDER_PROFILE_ID_V1,
} from "../app/game/rust-player-render-profile.ts";

const decoder = new TextDecoder();
const fromHex = (hex: string) => Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
const ROOT = path.resolve(import.meta.dirname, "..");

test("canonical metadata hash matches the independent Rust vector", () => {
  const canonicalBytes = new TextEncoder().encode('{"name":"Mizu 水","durability":17}');
  assert.equal(canonicalMetadataBlobHashV1({
    typeId: "blockwild.item.instance",
    schemaId: "item-instance",
    schemaVersion: 3,
    contentVersion: 9,
    aliases: ["cage:Otter", "item:603"],
    canonicalBytes,
    unknownExtensionBytes: Uint8Array.of(0, 0x80, 0xff, 7),
  }), "4043e014523dbc4bc88411c1c1826182");
});

test("metadata fixtures preserve nested values, names, durability and unknown high bytes exactly", () => {
  for (const specimen of fixture.cases) {
    const extension = fromHex(specimen.extensionHex);
    const bundle = compileRustProductionContent("fixture-v1", [{
      domain: specimen.domain as RustContentDomain,
      id: specimen.id,
      schemaId: specimen.schemaId,
      schemaVersion: 1,
      contentVersion: 1,
      value: specimen.value,
      unknownExtensionBytes: extension,
    }]);
    assert.deepEqual(bundle.blockers, [], specimen.id);
    assert.ok(bundle.manifest, specimen.id);
    assert.equal(bundle.artifacts.length, 1, specimen.id);
    assert.deepEqual(JSON.parse(decoder.decode(bundle.artifacts[0].canonicalBytes)), specimen.value, specimen.id);
    assert.deepEqual(bundle.artifacts[0].unknownExtensionBytes, extension, specimen.id);
  }
});

test("compiler rejects duplicate, cyclic, functional and non-finite content with structured blockers", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const sources: RustContentSourceEntry[] = [
    { domain: "item", id: "duplicate", schemaId: "test", schemaVersion: 1, contentVersion: 1, value: { ok: true } },
    { domain: "item", id: "duplicate", schemaId: "test", schemaVersion: 1, contentVersion: 1, value: { ok: false } },
    { domain: "item", id: "cycle", schemaId: "test", schemaVersion: 1, contentVersion: 1, value: cyclic },
    { domain: "item", id: "function", schemaId: "test", schemaVersion: 1, contentVersion: 1, value: { run: () => 1 } },
    { domain: "item", id: "nan", schemaId: "test", schemaVersion: 1, contentVersion: 1, value: { amount: Number.NaN } },
    { domain: "item", id: "alias-a", schemaId: "test", schemaVersion: 1, contentVersion: 1, aliases: ["shared:alias"], value: 1 },
    { domain: "item", id: "alias-b", schemaId: "test", schemaVersion: 1, contentVersion: 1, aliases: ["shared:alias"], value: 2 },
  ];
  const bundle = compileRustProductionContent("fixture-v1", sources);
  assert.equal(bundle.manifest, null);
  assert.deepEqual(new Set(bundle.blockers.map((blocker) => blocker.code)), new Set(["duplicate-id", "serialization-cycle", "unsupported-value", "alias-conflict"]));
});

test("production compiler covers all eleven canonical domains without blockers or drift", () => {
  const bundle = compileBlockwildProductionContent();
  assert.deepEqual(bundle.blockers, []);
  assert.ok(bundle.manifest);
  assert.equal(bundle.artifacts.length, 3_247);
  assert.equal(bundle.manifest.manifestHash, "782888fed91858df90284a7b66cd64fc");
  const expected = {
    item: { count: 538, hash: "eb55bc552f18afe1c88e1191e821f9e8" },
    "crafting-recipe": { count: 198, hash: "d1d9d49ba264b18cc83a527d0fca8a83" },
    "machine-recipe": { count: 46, hash: "ed2dd1f09fc42315c85a98f1da201cdf" },
    "machine-profile": { count: 14, hash: "b0d1fa9becc124cdc81a2845cbc5ab14" },
    "ability-spell": { count: 698, hash: "4b6e9337787c42b4c8ba6f426602f3cd" },
    "creature-profile": { count: 233, hash: "39350a2a0924329cc862d4a931cbf04a" },
    "creature-type-chart": { count: 42, hash: "dc45e95703ba3221c89afaa5f421f6e0" },
    "quest-guild": { count: 151, hash: "b2b0e266efc35de3c85ef9781bfa5996" },
    economy: { count: 247, hash: "655dbc50dbd06035c8ba33913f752cfa" },
    "cardforge-card": { count: 1_073, hash: "c3acec84fb85c798c87e56e2c77f7aa6" },
    "cardforge-pack": { count: 7, hash: "12c32cdb4aa4f473c89ac5605bfa6d91" },
  } as const;
  assert.deepEqual(bundle.manifest.domains, expected);
  assert.deepEqual(validateRustContentExpectation(bundle, { manifestHash: bundle.manifest.manifestHash, domains: expected }), []);
  const drift = validateRustContentExpectation(bundle, { manifestHash: "00000000000000000000000000000000", domains: { item: { ...expected.item, count: 1 } } });
  assert.deepEqual(drift.map((blocker) => blocker.code), ["count-drift", "manifest-hash-drift"]);
  const required = requireBlockwildProductionContent();
  assert.equal(required.report.ok, true);
  assert.equal(required.report.entryCount, 3_247);
  const rejected = compileRustProductionContent("fixture-v1", [
    { domain: "item", id: "same", schemaId: "test", schemaVersion: 1, contentVersion: 1, value: 1 },
    { domain: "item", id: "same", schemaId: "test", schemaVersion: 1, contentVersion: 1, value: 2 },
  ]);
  const rejectedReport = rustContentAuditReport(rejected, "fixture-v1");
  assert.equal(rejectedReport.ok, false);
  assert.equal(rejectedReport.manifestHash, null);
  assert.equal(rejectedReport.blockers[0].code, "duplicate-id");
});

test("production block actions are a bounded exact projection of authored block gameplay", () => {
  const bundle = compileBlockwildProductionContent();
  const artifact = bundle.artifacts.find((candidate) =>
    candidate.domain === "item" && candidate.id === RUST_BLOCK_ACTION_CATALOG_ID);
  assert.ok(artifact);
  assert.equal(artifact.schemaId, "block-action-catalog");
  assert.equal(artifact.schemaVersion, RUST_BLOCK_ACTION_CATALOG_SCHEMA);
  assert.equal(artifact.canonicalBytes.length, 46_567);
  assert.equal(artifact.blobHash, "af5b1a0732499ea8c83a571e32b3e97f");

  const decoded = JSON.parse(decoder.decode(artifact.canonicalBytes)) as {
    schema: number;
    profiles: Array<Record<string, unknown>>;
  };
  const authored = Object.values(BLOCKS).sort((left, right) => left.id - right.id);
  assert.equal(decoded.schema, 1);
  assert.equal(decoded.profiles.length, 313);
  assert.deepEqual(decoded.profiles.map((profile) => profile.id), authored.map((definition) => definition.id));

  for (let index = 0; index < authored.length; index += 1) {
    const definition = authored[index];
    const mappedItem = itemForBlock(definition.id);
    const topologyFlags: string[] = [];
    if (isDirectionallyPlacedBlock(definition.id)) topologyFlags.push("directional");
    if (definition.shape === "door" || definition.shape === "bed") topologyFlags.push("paired");
    if (definition.shape === "torch") topologyFlags.push("attached");
    if (definition.verticalConnectGroup !== undefined) topologyFlags.push("vertical-connected");
    if (definition.connectGroup !== undefined) topologyFlags.push("horizontal-connected");
    if (definition.waterlogged === true) topologyFlags.push("waterlogged");
    if (definition.shape === "aquarium" || definition.shape === "exhibit") topologyFlags.push("bounded-network");
    assert.deepEqual(decoded.profiles[index], {
      id: definition.id,
      hardness: definition.hardness,
      solid: definition.solid,
      replaceable: definition.replaceable === true,
      preferredTool: definition.preferredTool,
      requiredTier: definition.requiredTier,
      ...(ITEMS[mappedItem] === undefined ? {} : { item: mappedItem }),
      ...(definition.liquid === undefined ? {} : { liquid: definition.liquid }),
      ...(definition.shape === undefined ? {} : { shape: definition.shape }),
      ...(definition.collisionHeight === undefined ? {} : { collisionHeight: definition.collisionHeight }),
      ...(definition.verticalConnectGroup === undefined ? {} : { verticalConnectGroup: definition.verticalConnectGroup }),
      ...(definition.connectGroup === undefined ? {} : { connectGroup: definition.connectGroup }),
      topologyFlags,
    }, `block ${definition.id}`);
  }
});

test("production player profile is derived from and pinned to the tracked BWM2 artifact", async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, "public", "renderer", "manifest.json"), "utf8")) as unknown;
  const current = (manifest as { current: string }).current;
  const bytes = new Uint8Array(await readFile(path.join(ROOT, "public", "renderer", current, "models.bwm2")));
  const attested = await attestPlayerRenderProfileV1(manifest, bytes);
  assert.deepEqual(attested.profile, BLOCKWILD_PLAYER_RENDER_PROFILE_V1);
  assert.equal(attested.model.modelId, "player-standing");
  assert.equal(attested.model.label, "Player · Standing");
  assert.equal(attested.model.nodes.length, 25);

  const bundle = compileBlockwildProductionContent();
  const artifact = bundle.artifacts.find((candidate) =>
    candidate.domain === "creature-profile" && candidate.id === PLAYER_RENDER_PROFILE_ID_V1);
  assert.ok(artifact);
  assert.equal(artifact.schemaId, "player-render-profile");
  assert.deepEqual(JSON.parse(decoder.decode(artifact.canonicalBytes)), BLOCKWILD_PLAYER_RENDER_PROFILE_V1);
  assert.ok(artifact.canonicalBytes.includes(0xc2) && artifact.canonicalBytes.includes(0xb7),
    "the canonical content must preserve the UTF-8 middle dot in the authored model label");
  assert.equal(artifact.blobHash, "77f7d6234c83e717c83a571e32b3e97f");

  const extension = Uint8Array.of(0, 0x80, 0xff, 7);
  const fixtureBundle = compileRustProductionContent("player-profile-fixture-v1", [{
    domain: "creature-profile",
    id: PLAYER_RENDER_PROFILE_ID_V1,
    schemaId: "player-render-profile",
    schemaVersion: 1,
    contentVersion: 1,
    value: BLOCKWILD_PLAYER_RENDER_PROFILE_V1,
    unknownExtensionBytes: extension,
  }]);
  assert.deepEqual(fixtureBundle.blockers, []);
  assert.deepEqual(fixtureBundle.artifacts[0].unknownExtensionBytes, extension);
  assert.equal(fixtureBundle.artifacts[0].blobHash, "a4ee087cab25905ac88411c1c1825d9c");
});

test("player render attestation rejects manifest, bytes, and semantic binding drift", async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, "public", "renderer", "manifest.json"), "utf8")) as Record<string, unknown>;
  const bytes = new Uint8Array(await readFile(path.join(ROOT, "public", "renderer", String(manifest.current), "models.bwm2")));
  await assert.rejects(
    () => attestPlayerRenderProfileV1({ ...manifest, source: "untracked model source" }, bytes),
    /production player render profile/u,
  );
  const corrupt = Uint8Array.from(bytes);
  corrupt[128] ^= 0x80;
  await assert.rejects(() => attestPlayerRenderProfileV1(manifest, corrupt), /SHA-256/u);
  await assert.rejects(
    () => attestPlayerRenderProfileV1(manifest, bytes, {
      ...BLOCKWILD_PLAYER_RENDER_PROFILE_V1,
      model: { ...BLOCKWILD_PLAYER_RENDER_PROFILE_V1.model, pose: "standing", nodeCount: 24 },
    }),
    /production player render profile/u,
  );
});

test("player render loader follows only the manifest's content-addressed BWM2 path", async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, "public", "renderer", "manifest.json"), "utf8")) as Record<string, unknown>;
  const bytes = new Uint8Array(await readFile(path.join(ROOT, "public", "renderer", String(manifest.current), "models.bwm2")));
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (calls.length === 1) return {
      ok: true, status: 200, url: "https://blockwild.example/renderer/manifest.json",
      json: async () => manifest,
    } as Response;
    return {
      ok: true, status: 200, url,
      arrayBuffer: async () => bytes.slice().buffer,
    } as Response;
  }) as typeof fetch;
  const result = await loadAttestedPlayerRenderProfileV1({
    manifestUrl: "https://blockwild.example/renderer/manifest.json",
    fetch: fakeFetch,
  });
  assert.equal(result.profile.model.id, "player-standing");
  assert.deepEqual(calls, [
    "https://blockwild.example/renderer/manifest.json",
    `https://blockwild.example/renderer/${String(manifest.current)}/models.bwm2`,
  ]);
});
