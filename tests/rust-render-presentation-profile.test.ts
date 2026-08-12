import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { ITEMS, BlockId, Item } from "../app/game/data.ts";
import {
  blockwildProductionContentSources,
  compileBlockwildProductionContent,
} from "../app/game/rust-integrated-runtime-content.ts";
import {
  attestRenderPresentationCatalogV1,
  BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1,
  loadAttestedRenderPresentationCatalogV1,
  RENDER_PRESENTATION_CATALOG_ID_V1,
} from "../app/game/rust-render-presentation-profile.ts";

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
  const catalog = BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1;
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

test("production content carries the distinct attested catalog and retains blockers", () => {
  const bundle = compileBlockwildProductionContent();
  assert.deepEqual(bundle.blockers, []);
  const artifact = bundle.artifacts.find((candidate) =>
    candidate.domain === "machine-profile" && candidate.id === RENDER_PRESENTATION_CATALOG_ID_V1);
  assert.ok(artifact);
  assert.equal(artifact.schemaId, "render-presentation-catalog");
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.canonicalBytes.byteLength, 36_302);
  assert.equal(artifact.blobHash, "9343a3e34fc5c032c83a571e32b3e97f");
  assert.deepEqual(JSON.parse(decoder.decode(artifact.canonicalBytes)), BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1);
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
  const first = BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1.profiles[0];
  await assert.rejects(
    () => attestRenderPresentationCatalogV1(manifest, bytes, {
      ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1,
      profiles: [{ ...first, model: { ...first.model, nodeCount: first.model.nodeCount + 1 } }, ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1.profiles.slice(1)],
    }),
    /model identity/u,
  );
  await assert.rejects(
    () => attestRenderPresentationCatalogV1(manifest, bytes, {
      ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1,
      profiles: [
        BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1.profiles[0],
        { ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1.profiles[1], id: BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1.profiles[0].id },
        ...BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1.profiles.slice(2),
      ],
    }),
    /canonical and unique/u,
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
