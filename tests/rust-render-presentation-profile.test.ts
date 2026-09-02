import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { BLOCKS, ITEMS, BlockId, Item } from "../app/game/data.ts";
import {
  blockwildProductionContentSources,
  compileBlockwildProductionContent,
} from "../app/game/rust-integrated-runtime-content.ts";
import {
  attestRenderPresentationCatalogV1,
  BLOCKWILD_RENDER_PRESENTATION_COVERAGE_R10,
  BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1,
  BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2,
  BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1,
  canonicalWorldPropOwnershipPolicyHashV1,
  canonicalWorldPropSourceInventoryHashV1,
  createRenderPresentationCoverageInventoryR10,
  loadAttestedRenderPresentationCatalogV1,
  createRenderPresentationRegistryV1,
  renderPresentationWorldPropOwnershipPolicyV1,
  RENDER_PRESENTATION_CATALOG_ID_V1,
  RENDER_PRESENTATION_CATALOG_SCHEMA_V1,
  RENDER_PRESENTATION_CATALOG_SCHEMA_V2,
  WORLD_PROP_OWNERSHIP_POLICY_ID_V1,
} from "../app/game/rust-render-presentation-profile.ts";
import { canonicalTerrainMaterialRegistryV1, canonicalTerrainMaterialRegistryV2 } from "../app/game/terrain-material-registry.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const decoder = new TextDecoder();

async function productionCatalog() {
  const manifest = JSON.parse(await readFile(path.join(ROOT, "public", "renderer", "manifest.json"), "utf8")) as Record<string, unknown>;
  const bytes = new Uint8Array(await readFile(path.join(ROOT, "public", "renderer", String(manifest.current), "models.bwm2")));
  return { manifest, bytes };
}

test("render presentation catalog pins exact role-specific production model identities", async () => {
  const { manifest, bytes } = await productionCatalog();
  const attested = await attestRenderPresentationCatalogV1(manifest, bytes);
  const catalog = attested.profileCatalog;
  assert.equal(catalog.profiles.length, 33);
  assert.equal(catalog.missingProfiles.length, 71);
  assert.equal(catalog.integrationBlockers.length, 4);
  assert.equal(attested.modelsByProfileId.size, catalog.profiles.length);

  const byId = new Map(catalog.profiles.map((profile) => [profile.id, profile]));
  assert.deepEqual(byId.get("drop:wildwood-chest"), {
    id: "drop:wildwood-chest", role: "dropped-item",
    model: { id: "wildwood-chest", label: "Wildwood Chest", category: 4, groundYBits: null, nodeCount: 4 },
    contentRefs: [{ domain: "item", id: String(BlockId.Chest) }],
  });
  assert.deepEqual(byId.get("projectile:arrow")?.contentRefs, [
    { domain: "item", id: String(Item.CrossbowBolt) },
    { domain: "item", id: String(Item.GlimmerArrow) },
  ]);
  assert.deepEqual(byId.get("summon:asterjaw")?.contentRefs, [
    { domain: "ability-spell", id: "spell:call-asterjaw" },
    { domain: "creature-profile", id: "asterjaw" },
  ]);
  assert.equal(byId.get("machine:capture-orb-rack")?.model.nodeCount, 71);
  assert.equal(byId.get("vehicle:sailboat")?.model.id, "sailboat");

  const exactPresentationKeys = [
    ["drop:capture-orb", "dropModel", "capture-orb", Item.CaptureOrb],
    ["drop:goblinsmith-spear", "dropModel", "spear", Item.GoblinsmithSpear],
    ["drop:hearthguard-crossbow", "dropModel", "crossbow", Item.HearthguardCrossbow],
    ["drop:wildwood-apiary", "dropModel", "apiary", BlockId.Apiary],
    ["held:capture-orb", "heldModel", "capture-orb", Item.CaptureOrb],
    ["held:goblinsmith-spear", "heldModel", "spear", Item.GoblinsmithSpear],
    ["held:hearthguard-crossbow", "heldModel", "crossbow", Item.HearthguardCrossbow],
    ["held:wildwood-apiary", "heldModel", "apiary", BlockId.Apiary],
  ] as const;
  for (const [profileId, field, sourceId, itemId] of exactPresentationKeys) {
    const profile = byId.get(profileId);
    assert.ok(profile, profileId);
    assert.deepEqual(profile.contentRefs, [{ domain: "item", id: String(itemId) }], profileId);
    assert.equal(ITEMS[itemId]?.[field], sourceId, `${profileId}:${itemId}`);
  }

  const roleRefs = new Set<string>();
  const productionContentIds = new Set(blockwildProductionContentSources()
    .map((source) => `${source.domain}:${source.id}`));
  for (const profile of catalog.profiles) for (const reference of profile.contentRefs) {
    const key = `${profile.role}:${reference.domain}:${reference.id}`;
    assert.equal(roleRefs.has(key), false, `ambiguous role/content ref ${key}`);
    roleRefs.add(key);
    assert.ok(productionContentIds.has(`${reference.domain}:${reference.id}`), `missing production content ref ${key}`);
  }
  for (const blocker of catalog.missingProfiles) for (const reference of blocker.contentRefs) {
    const key = `${blocker.role}:${reference.domain}:${reference.id}`;
    assert.equal(roleRefs.has(key), false, `ambiguous mapped/missing role content ref ${key}`);
    roleRefs.add(key);
    assert.ok(productionContentIds.has(`${reference.domain}:${reference.id}`),
      `missing production blocker ref ${blocker.id}:${reference.domain}:${reference.id}`);
  }
});

test("missing render profiles enumerate exact sorted source IDs without fabricated models", () => {
  const catalog = BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2;
  assert.deepEqual(catalog.profiles.map((profile) => profile.id), [...catalog.profiles.map((profile) => profile.id)].sort());
  assert.deepEqual(catalog.missingProfiles.map((profile) => profile.id), [...catalog.missingProfiles.map((profile) => profile.id)].sort());
  assert.equal(catalog.missingProfiles.reduce((sum, profile) => sum + profile.contentRefs.length, 0), 277);
  assert.equal(catalog.missingProfiles.reduce((sum, profile) => sum + profile.sourcePresentationIds.length, 0), 252);
  for (const blocker of catalog.missingProfiles) {
    assert.ok(blocker.sourcePresentationIds.length > 0, blocker.id);
    assert.deepEqual(blocker.sourcePresentationIds, [...blocker.sourcePresentationIds].sort(), blocker.id);
  }
  const skeleton = catalog.missingProfiles.find((profile) => profile.id === "missing:projectile:skeleton-arrow");
  assert.ok(skeleton);
  assert.match(skeleton.reason, /inspection capture/u);
  assert.equal(catalog.profiles.some((profile) => profile.model.id === "skeleton-arrow"), false);
  const specialBlocks = catalog.missingProfiles.find((profile) => profile.id === "missing:world-prop:special-block-shapes");
  assert.equal(specialBlocks?.sourcePresentationIds.length, 172);
});

test("R10 presentation coverage is deterministic, exhaustive, and distinguishes contracts from live blockers", () => {
  const catalog = BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2;
  const coverage = createRenderPresentationCoverageInventoryR10(catalog);
  assert.deepEqual(coverage, BLOCKWILD_RENDER_PRESENTATION_COVERAGE_R10);
  assert.deepEqual(createRenderPresentationCoverageInventoryR10(catalog), coverage);
  assert.equal(coverage.coverageHash, "eab25899b5f55241c81ad0f3ca7703d7");
  assert.equal(coverage.catalogId, RENDER_PRESENTATION_CATALOG_ID_V1);
  assert.equal(coverage.profileCatalogSchema, catalog.schema);
  assert.equal(coverage.modelCatalogHash, catalog.catalog.canonicalHash);
  assert.deepEqual(coverage.entries.map((entry) => entry.id),
    [...coverage.entries.map((entry) => entry.id)].sort());
  assert.equal(new Set(coverage.entries.map((entry) => entry.id)).size, coverage.entries.length);
  assert.deepEqual(coverage.families.map((family) => family.family), [
    "celestial", "dropped-item", "held-item", "machine", "particle", "projectile",
    "sky", "summon", "vehicle", "weather", "world-prop",
  ]);

  const exactRoles = new Set(["dropped-item", "held-item", "machine", "projectile", "summon"]);
  for (const profile of catalog.profiles) {
    const entry = coverage.entries.find((candidate) => candidate.profileId === profile.id);
    assert.ok(entry, profile.id);
    assert.equal(entry.modelId, profile.model.id, profile.id);
    assert.equal(entry.status, exactRoles.has(profile.role) ? "exact-contract" : "blocked", profile.id);
    assert.equal(entry.extractionProtocol === null, !exactRoles.has(profile.role), profile.id);
    assert.equal(entry.blockerId === null, exactRoles.has(profile.role), profile.id);
  }
  for (const missing of catalog.missingProfiles) {
    const entry = coverage.entries.find((candidate) => candidate.id === `catalog:${missing.id}`);
    assert.ok(entry, missing.id);
    assert.equal(entry.status, "blocked");
    assert.equal(entry.blockerId, missing.id);
    assert.equal(entry.profileId, null);
    assert.equal(entry.modelId, null);
  }

  assert.deepEqual(coverage.entries.filter((entry) => entry.id.startsWith("dynamic:")).map((entry) => entry.id), [
    "dynamic:active-chest-articulation",
    "dynamic:aquarium",
    "dynamic:butterfly-exhibit",
    "dynamic:capture-orb-rack-and-healer-contents",
    "dynamic:fireplace-flame",
    "dynamic:morph-loom-contents",
    "dynamic:tome-display",
  ]);
  assert.deepEqual(coverage.entries.filter((entry) => entry.id.startsWith("runtime-schema:")).map((entry) => entry.family),
    ["celestial", "particle", "sky", "vehicle", "weather"]);
  assert.deepEqual(coverage.families, [
    { family: "celestial", exactContracts: 0, blockers: 1 },
    { family: "dropped-item", exactContracts: 7, blockers: 29 },
    { family: "held-item", exactContracts: 11, blockers: 28 },
    { family: "machine", exactContracts: 3, blockers: 12 },
    { family: "particle", exactContracts: 0, blockers: 1 },
    { family: "projectile", exactContracts: 1, blockers: 4 },
    { family: "sky", exactContracts: 0, blockers: 1 },
    { family: "summon", exactContracts: 4, blockers: 1 },
    { family: "vehicle", exactContracts: 0, blockers: 2 },
    { family: "weather", exactContracts: 0, blockers: 1 },
    { family: "world-prop", exactContracts: 0, blockers: 15 },
  ]);
  assert.throws(() => createRenderPresentationCoverageInventoryR10({
    ...catalog,
    integrationBlockers: Object.freeze([...catalog.integrationBlockers, "zz-unclassified-runtime-gap"]),
  }), /unclassified render presentation integration blocker/u);
});

test("world prop policy attests complete BWR2 terrain ownership and all bounded dynamic families", () => {
  const policy = BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1;
  const registry = canonicalTerrainMaterialRegistryV2();
  const specialtyRegistry = canonicalTerrainMaterialRegistryV1();
  assert.equal(BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2.schema, RENDER_PRESENTATION_CATALOG_SCHEMA_V2);
  assert.equal(policy.id, WORLD_PROP_OWNERSHIP_POLICY_ID_V1);
  assert.equal(policy.sourceInventoryHash, "cebd5d90170bdc1ec85a273cebafd4f6");
  assert.equal(policy.policyHash, "5b7eb831ff3ed23dc8ba117cbea72d5c");
  assert.equal(canonicalWorldPropSourceInventoryHashV1(policy.sourceInventory), policy.sourceInventoryHash);
  assert.equal(canonicalWorldPropOwnershipPolicyHashV1(policy), policy.policyHash);

  assert.equal(policy.sourceInventory.length, 313);
  assert.deepEqual(policy.sourceInventory.map((tuple) => tuple.blockId),
    Object.values(BLOCKS).sort((left, right) => left.id - right.id).map((definition) => definition.id));
  assert.equal(new Set(policy.sourceInventory.map((tuple) => tuple.blockId)).size, 313);
  assert.equal(policy.sourceInventory[0].blockId, BlockId.Air);
  for (const tuple of policy.sourceInventory) {
    assert.equal(tuple.registrySlot, tuple.blockId);
    assert.equal(tuple.materialKind, registry.blocks[tuple.blockId]?.kind);
    assert.equal(tuple.renderable, tuple.blockId !== BlockId.Air);
    assert.equal(tuple.geometryRevision, tuple.renderable ? 1 : null);
    assert.equal(tuple.specialty, specialtyRegistry.blocks[tuple.blockId]?.kind === "specialty");
  }
  assert.deepEqual(policy.terrain, {
    protocol: "BWR2",
    registrySchemaVersion: 2,
    registryContentHash: "d8954db79caaa89938015b183130d246",
    geometryRevision: 1,
    registrySlotCount: 601,
    biomeTintSlotCount: 24,
    blockDefinitionCount: 313,
    renderableBlockCount: 312,
    specialtyBlockCount: 218,
    specialtyPolicy: "bwr1-non-opaque-cube-or-furnace-v1",
    mesherArtifactHash: null,
    rendererArtifactHash: null,
    acceptedProducer: null,
    selectionPolicy: null,
    authorityBlockers: [
      "accepted-producer-identity-unproven",
      "mesher-artifact-hash-unproven",
      "renderer-artifact-hash-unproven",
      "selection-policy-unproven",
    ],
  });
  assert.equal(policy.dynamicFamilies.length, 7);
  assert.deepEqual(policy.dynamicFamilies.map((family) => family.id),
    [...policy.dynamicFamilies.map((family) => family.id)].sort());
  assert.deepEqual(policy.dynamicFamilies.map((family) => family.status),
    ["partial", "missing", "missing", "partial", "missing", "missing", "missing"]);
  assert.deepEqual(policy.dynamicFamilies.find((family) => family.id === "tome-display")?.stateOwners,
    ["r4-cell", "r7-machine"]);
  assert.deepEqual(policy.residualPersistentKinds, [], "absence is represented explicitly, never inferred from omission");
});

test("browser catalog materialization keeps real schema v1 loadable but world-prop-unproven", () => {
  assert.equal(BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1.schema, RENDER_PRESENTATION_CATALOG_SCHEMA_V1);
  assert.equal("worldPropOwnershipPolicy" in BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1, false);
  const legacy = createRenderPresentationRegistryV1(BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1);
  assert.equal(legacy.catalog.schema, 1);
  assert.equal(renderPresentationWorldPropOwnershipPolicyV1(legacy.catalog), null);

  const current = createRenderPresentationRegistryV1(BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2);
  assert.equal(current.catalog.schema, 2);
  assert.equal(renderPresentationWorldPropOwnershipPolicyV1(current.catalog), BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1);
  const dishonestLegacy = {
    ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1,
    worldPropOwnershipPolicy: BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1,
  } as unknown as Parameters<typeof createRenderPresentationRegistryV1>[0];
  assert.throws(() => createRenderPresentationRegistryV1(dishonestLegacy),
    /legacy render presentation schema v1 cannot claim/u);
});

test("world prop policy hashes are domain-separated and every audited field is tamper-evident", () => {
  const policy = BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1;
  const mutatedInventory = policy.sourceInventory.map((tuple, index) => index === 1
    ? { ...tuple, specialty: !tuple.specialty }
    : tuple);
  assert.notEqual(canonicalWorldPropSourceInventoryHashV1(mutatedInventory), policy.sourceInventoryHash);
  const hashInput = policy;
  assert.notEqual(canonicalWorldPropOwnershipPolicyHashV1({
    ...hashInput,
    terrain: { ...hashInput.terrain, mesherArtifactHash: "fabricated" },
  }), policy.policyHash);
  assert.notEqual(canonicalWorldPropOwnershipPolicyHashV1({
    ...hashInput,
    dynamicFamilies: hashInput.dynamicFamilies.map((family, index) => index === 0
      ? { ...family, status: "exact" as const }
      : family),
  }), policy.policyHash);
  assert.notEqual(canonicalWorldPropOwnershipPolicyHashV1({
    ...hashInput,
    residualPersistentKinds: ["unattested-prop"],
  }), policy.policyHash);
});

test("presentation registry resolves exact, explicit missing, and unmapped role refs without fallback", async () => {
  const { manifest, bytes } = await productionCatalog();
  const attested = await attestRenderPresentationCatalogV1(manifest, bytes);
  const exact = attested.registry.resolve("held-item", { domain: "item", id: String(Item.StonePickaxe) });
  assert.equal(exact.status, "exact");
  if (exact.status === "exact") {
    assert.equal(exact.profile.id, "held:stone-pickaxe");
    assert.equal(exact.profile.model.id, "held-pickaxe");
  }

  const missingProfile = attested.profileCatalog.missingProfiles.find((candidate) =>
    candidate.role === "held-item" && candidate.contentRefs.length > 0);
  assert.ok(missingProfile);
  const missingRef = missingProfile.contentRefs[0];
  assert.ok(missingRef);
  const missing = attested.registry.resolve("held-item", missingRef);
  assert.equal(missing.status, "missing");
  if (missing.status === "missing") assert.equal(missing.blocker.id, missingProfile.id);

  assert.deepEqual(attested.registry.resolve("held-item", { domain: "item", id: "4294967295" }), {
    status: "unmapped",
    role: "held-item",
    reference: { domain: "item", id: "4294967295" },
  });
  assert.equal(attested.registry.resolve("dropped-item", {
    domain: "item", id: String(Item.StonePickaxe),
  }).status, "unmapped");
});

test("production content carries the distinct attested catalog and retains blockers", () => {
  const bundle = compileBlockwildProductionContent();
  assert.deepEqual(bundle.blockers, []);
  const artifact = bundle.artifacts.find((candidate) =>
    candidate.domain === "machine-profile" && candidate.id === RENDER_PRESENTATION_CATALOG_ID_V1);
  assert.ok(artifact);
  assert.equal(artifact.schemaId, "render-presentation-catalog");
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.contentVersion, 2);
  assert.equal(artifact.canonicalBytes.byteLength, 74_655);
  assert.equal(artifact.blobHash, "f6f01b50c711b705c83a571eb2c8f56d");
  assert.deepEqual(JSON.parse(decoder.decode(artifact.canonicalBytes)), BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2);
});

test("render presentation attestation fails closed on manifest, bytes and profile drift", async () => {
  const { manifest, bytes } = await productionCatalog();
  await assert.rejects(
    () => attestRenderPresentationCatalogV1({ ...manifest, source: "untracked model source" }, bytes),
    /render presentation catalog/u,
  );
  const corrupt = Uint8Array.from(bytes);
  corrupt[256] ^= 0x80;
  await assert.rejects(() => attestRenderPresentationCatalogV1(manifest, corrupt), /SHA-256/u);
  const first = BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2.profiles[0];
  await assert.rejects(
    () => attestRenderPresentationCatalogV1(manifest, bytes, {
      ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2,
      profiles: [{ ...first, model: { ...first.model, nodeCount: first.model.nodeCount + 1 } }, ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2.profiles.slice(1)],
    }),
    /model identity/u,
  );
  await assert.rejects(
    () => attestRenderPresentationCatalogV1(manifest, bytes, {
      ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2,
      profiles: [
        BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2.profiles[0],
        { ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2.profiles[1], id: BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2.profiles[0].id },
        ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2.profiles.slice(2),
      ],
    }),
    /canonical and unique/u,
  );
  await assert.rejects(
    () => attestRenderPresentationCatalogV1(manifest, bytes, {
      ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2,
      worldPropOwnershipPolicy: {
        ...BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1,
        terrain: { ...BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1.terrain, mesherArtifactHash: "fabricated" },
      },
    }),
    /must not invent unproven/u,
  );
  await assert.rejects(
    () => attestRenderPresentationCatalogV1(manifest, bytes, {
      ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2,
      worldPropOwnershipPolicy: {
        ...BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1,
        dynamicFamilies: [...BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1.dynamicFamilies].reverse(),
      },
    }),
    /not strictly sorted/u,
  );
  await assert.rejects(
    () => attestRenderPresentationCatalogV1(manifest, bytes, {
      ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2,
      worldPropOwnershipPolicy: {
        ...BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1,
        residualPersistentKinds: ["omitted-source"],
      },
    }),
    /explicitly present and empty/u,
  );
});

test("browser-neutral loader follows only the manifest content-addressed BWM2 path", async () => {
  const { manifest, bytes } = await productionCatalog();
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (calls.length === 1) return {
      ok: true, status: 200, url: "https://blockwild.example/renderer/manifest.json",
      json: async () => manifest,
    } as Response;
    return { ok: true, status: 200, url, arrayBuffer: async () => bytes.slice().buffer } as Response;
  }) as typeof fetch;
  const loaded = await loadAttestedRenderPresentationCatalogV1({
    manifestUrl: "https://blockwild.example/renderer/manifest.json",
    fetch: fakeFetch,
  });
  assert.equal(loaded.profileCatalog.profiles.length, 33);
  assert.deepEqual(calls, [
    "https://blockwild.example/renderer/manifest.json",
    `https://blockwild.example/renderer/${String(manifest.current)}/models.bwm2`,
  ]);
});
