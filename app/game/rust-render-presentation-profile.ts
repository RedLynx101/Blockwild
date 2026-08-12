/**
 * Renderer-neutral, content-addressed presentation bindings for non-player
 * runtime roles.  These records are intentionally separate from creature and
 * player profiles: sharing a BWM2 model does not make two authority roles the
 * same content identity.
 */

import { BLOCKS, ITEMS, BlockId, Item, type ItemCode } from "./data.ts";
import { SPELLS } from "./magic.ts";
import { SUMMON_CONTRACTS } from "./summon-contracts.ts";
import {
  decodeRenderEntityModelCatalogR10,
  findRenderEntityCompiledModelR10,
  type RenderEntityCompiledModelCatalogR10,
  type RenderEntityCompiledModelR10,
  type RenderEntityModelCatalogManifestR10,
} from "./rust-render-entity-catalog-r10.ts";
import {
  parsePublishedRenderModelCatalogManifestV1,
  type PublishedRenderModelCatalogManifestV1,
} from "./rust-player-render-profile.ts";

export const RENDER_PRESENTATION_CATALOG_ID_V1 = "render-presentations" as const;
export const RENDER_PRESENTATION_CATALOG_SCHEMA_ID_V1 = "render-presentation-catalog" as const;
export const RENDER_PRESENTATION_CATALOG_SCHEMA_V1 = 1 as const;
export const RENDER_PRESENTATION_CATALOG_REVISION_V1 = 1 as const;

export type RenderPresentationRoleV1 =
  | "dropped-item"
  | "held-item"
  | "machine"
  | "projectile"
  | "summon"
  | "vehicle"
  | "world-prop";

export type RenderPresentationContentDomainV1 =
  | "ability-spell"
  | "creature-profile"
  | "item"
  | "machine-profile";

export type RenderPresentationContentRefV1 = Readonly<{
  domain: RenderPresentationContentDomainV1;
  id: string;
}>;

export type RenderPresentationModelIdentityV1 = Readonly<{
  id: string;
  label: string;
  category: number;
  groundYBits: number | null;
  nodeCount: number;
}>;

export type RenderPresentationProfileV1 = Readonly<{
  id: string;
  role: RenderPresentationRoleV1;
  model: RenderPresentationModelIdentityV1;
  contentRefs: readonly RenderPresentationContentRefV1[];
}>;

export type MissingRenderPresentationProfileV1 = Readonly<{
  id: string;
  role: RenderPresentationRoleV1;
  sourcePresentationIds: readonly string[];
  contentRefs: readonly RenderPresentationContentRefV1[];
  reason: string;
}>;

export type RenderPresentationCatalogV1 = Readonly<{
  schema: 1;
  catalog: Readonly<{
    schema: 2;
    format: "blockwild-compiled-model-catalog-v2";
    revision: 1;
    sha256: string;
    canonicalHash: string;
    byteLength: number;
    modelCount: number;
    nodeCount: number;
    source: string;
  }>;
  profiles: readonly RenderPresentationProfileV1[];
  missingProfiles: readonly MissingRenderPresentationProfileV1[];
  integrationBlockers: readonly string[];
}>;

export type AttestedRenderPresentationCatalogV1 = Readonly<{
  profileCatalog: RenderPresentationCatalogV1;
  modelCatalog: RenderEntityCompiledModelCatalogR10;
  modelsByProfileId: ReadonlyMap<string, RenderEntityCompiledModelR10>;
}>;

const itemRef = (item: ItemCode): RenderPresentationContentRefV1 => Object.freeze({ domain: "item", id: String(item) });
const machineRef = (id: string): RenderPresentationContentRefV1 => Object.freeze({ domain: "machine-profile", id });
const creatureRef = (id: string): RenderPresentationContentRefV1 => Object.freeze({ domain: "creature-profile", id });
const spellRef = (id: string): RenderPresentationContentRefV1 => Object.freeze({ domain: "ability-spell", id: `spell:${id}` });

function compareContentRefs(left: RenderPresentationContentRefV1, right: RenderPresentationContentRefV1) {
  const leftKey = `${left.domain}:${left.id}`;
  const rightKey = `${right.domain}:${right.id}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function refs(...values: readonly RenderPresentationContentRefV1[]) {
  return Object.freeze([...values].sort(compareContentRefs));
}

function model(
  id: string,
  label: string,
  category: number,
  nodeCount: number,
  groundYBits: number | null = null,
): RenderPresentationModelIdentityV1 {
  return Object.freeze({ id, label, category, groundYBits, nodeCount });
}

function profile(
  id: string,
  role: RenderPresentationRoleV1,
  identity: RenderPresentationModelIdentityV1,
  contentRefs: readonly RenderPresentationContentRefV1[],
): RenderPresentationProfileV1 {
  return Object.freeze({ id, role, model: identity, contentRefs: Object.freeze([...contentRefs]) });
}

const GROUND_ZERO_BITS = 0;
const MODELS = Object.freeze({
  arrow: model("arrow-projectile", "Arrow Projectile", 4, 5),
  apiary: model("wildwood-apiary", "Wildwood Apiary", 4, 9),
  captureOrb: model("waykeeper-capture-orb", "Capture Orb", 4, 8),
  chest: model("wildwood-chest", "Wildwood Chest", 4, 4),
  crossbow: model("held-crossbow", "Hearthguard Crossbow", 0, 8),
  healer: model("creature-healing-station", "Four-Orb Healing Station", 4, 42, GROUND_ZERO_BITS),
  heldAxe: model("held-axe", "Stone Axe", 0, 6),
  heldPickaxe: model("held-pickaxe", "Stone Pickaxe", 0, 5),
  heldShovel: model("held-shovel", "Stone Shovel", 0, 5),
  heldSpear: model("held-spear", "Goblinsmith Spear", 0, 6),
  heldSword: model("held-sword", "Iron Sword", 0, 5),
  orbRack: model("capture-orb-rack", "Eight-Orb Rack", 4, 71, GROUND_ZERO_BITS),
  sailboat: model("sailboat", "Wildwood Sailboat", 4, 15, GROUND_ZERO_BITS),
  stone: model("stone-block", "Stone Block", 3, 1),
  torch: model("torch", "Torch", 4, 4),
  asterjaw: model("asterjaw", "Asterjaw", 1, 110, GROUND_ZERO_BITS),
  vellumWarden: model("vellum-warden", "Vellum Warden", 1, 50, GROUND_ZERO_BITS),
  choirOfOne: model("choir-of-one", "Choir-of-One", 1, 19),
  glasswakeStag: model("glasswake-stag", "Glasswake Stag", 1, 96),
});

const PROFILES = Object.freeze([
  profile("drop:capture-orb", "dropped-item", MODELS.captureOrb, refs(itemRef(Item.CaptureOrb))),
  profile("drop:capture-orb-rack", "dropped-item", MODELS.orbRack, refs(itemRef(BlockId.CaptureOrbRack))),
  profile("drop:creature-healing-station", "dropped-item", MODELS.healer, refs(itemRef(BlockId.CreatureHealer))),
  profile("drop:goblinsmith-spear", "dropped-item", MODELS.heldSpear, refs(itemRef(Item.GoblinsmithSpear))),
  profile("drop:hearthguard-crossbow", "dropped-item", MODELS.crossbow, refs(itemRef(Item.HearthguardCrossbow))),
  profile("drop:wildwood-apiary", "dropped-item", MODELS.apiary, refs(itemRef(BlockId.Apiary))),
  profile("drop:wildwood-chest", "dropped-item", MODELS.chest, refs(itemRef(BlockId.Chest))),
  profile("held:capture-orb", "held-item", MODELS.captureOrb, refs(itemRef(Item.CaptureOrb))),
  profile("held:capture-orb-rack", "held-item", MODELS.orbRack, refs(itemRef(BlockId.CaptureOrbRack))),
  profile("held:creature-healing-station", "held-item", MODELS.healer, refs(itemRef(BlockId.CreatureHealer))),
  profile("held:goblinsmith-spear", "held-item", MODELS.heldSpear, refs(itemRef(Item.GoblinsmithSpear))),
  profile("held:hearthguard-crossbow", "held-item", MODELS.crossbow, refs(itemRef(Item.HearthguardCrossbow))),
  profile("held:iron-sword", "held-item", MODELS.heldSword, refs(itemRef(Item.IronSword))),
  profile("held:stone-axe", "held-item", MODELS.heldAxe, refs(itemRef(Item.StoneAxe))),
  profile("held:stone-pickaxe", "held-item", MODELS.heldPickaxe, refs(itemRef(Item.StonePickaxe))),
  profile("held:stone-shovel", "held-item", MODELS.heldShovel, refs(itemRef(Item.StoneShovel))),
  profile("held:wildwood-apiary", "held-item", MODELS.apiary, refs(itemRef(BlockId.Apiary))),
  profile("held:wildwood-chest", "held-item", MODELS.chest, refs(itemRef(BlockId.Chest))),
  profile("machine:apiary", "machine", MODELS.apiary, refs(machineRef("apiary"))),
  profile("machine:capture-orb-rack", "machine", MODELS.orbRack, refs(machineRef("capture-orb-rack"))),
  profile("machine:creature-healing-station", "machine", MODELS.healer, refs(machineRef("creature-healing-station"))),
  profile("projectile:arrow", "projectile", MODELS.arrow, refs(itemRef(Item.CrossbowBolt), itemRef(Item.GlimmerArrow))),
  profile("summon:asterjaw", "summon", MODELS.asterjaw, refs(creatureRef("asterjaw"), spellRef(SUMMON_CONTRACTS.asterjaw.spellId))),
  profile("summon:choir-of-one", "summon", MODELS.choirOfOne, refs(creatureRef("choir-of-one"), spellRef(SUMMON_CONTRACTS["choir-of-one"].spellId))),
  profile("summon:glasswake-stag", "summon", MODELS.glasswakeStag, refs(creatureRef("glasswake-stag"), spellRef(SUMMON_CONTRACTS["glasswake-stag"].spellId))),
  profile("summon:vellum-warden", "summon", MODELS.vellumWarden, refs(creatureRef("vellum-warden"), spellRef(SUMMON_CONTRACTS["vellum-warden"].spellId))),
  profile("vehicle:sailboat", "vehicle", MODELS.sailboat, refs(itemRef(Item.Sailboat))),
  profile("world-prop:capture-orb-rack", "world-prop", MODELS.orbRack, refs(itemRef(BlockId.CaptureOrbRack))),
  profile("world-prop:creature-healing-station", "world-prop", MODELS.healer, refs(itemRef(BlockId.CreatureHealer))),
  profile("world-prop:stone", "world-prop", MODELS.stone, refs(itemRef(BlockId.Stone))),
  profile("world-prop:torch", "world-prop", MODELS.torch, refs(itemRef(BlockId.Torch))),
  profile("world-prop:wildwood-apiary", "world-prop", MODELS.apiary, refs(itemRef(BlockId.Apiary))),
  profile("world-prop:wildwood-chest", "world-prop", MODELS.chest, refs(itemRef(BlockId.Chest))),
].sort((left, right) => left.id.localeCompare(right.id)));

const MAPPED_EXPLICIT_ITEM_IDS = Object.freeze({
  "dropped-item": new Set<number>(PROFILES
    .filter((candidate) => candidate.role === "dropped-item")
    .flatMap((candidate) => candidate.contentRefs)
    .filter((reference) => reference.domain === "item")
    .map((reference) => Number(reference.id))),
  "held-item": new Set<number>(PROFILES
    .filter((candidate) => candidate.role === "held-item")
    .flatMap((candidate) => candidate.contentRefs)
    .filter((reference) => reference.domain === "item")
    .map((reference) => Number(reference.id))),
});

function explicitItemPresentationBlockers(
  role: "dropped-item" | "held-item",
  field: "dropModel" | "heldModel",
) {
  const bySource = new Map<string, ItemCode[]>();
  for (const definition of Object.values(ITEMS).sort((left, right) => left.id - right.id)) {
    const source = definition[field];
    if (source === undefined || MAPPED_EXPLICIT_ITEM_IDS[role].has(definition.id)) continue;
    const ids = bySource.get(source) ?? [];
    ids.push(definition.id);
    bySource.set(source, ids);
  }
  return [...bySource].sort(([left], [right]) => left.localeCompare(right)).map(([source, itemIds]) => Object.freeze({
    id: `missing:${role}:${source}`,
    role,
    sourcePresentationIds: Object.freeze([`${field}:${source}`]),
    contentRefs: refs(...itemIds.map(itemRef)),
    reason: "The authored TypeScript presentation family has no exact production BWM2 identity for these item IDs.",
  } satisfies MissingRenderPresentationProfileV1));
}

const MAPPED_MACHINES = new Set(["apiary", "capture-orb-rack", "creature-healing-station"]);
const MACHINE_IDS = Object.freeze([
  "alchemy", "apiary", "aquarium", "butterfly-exhibit", "capture-orb-rack", "creature-healing-station",
  "digital-creature-archive", "digital-item-vault", "distillery", "furnace", "golem-forge", "orb-morph-loom",
  "sugarworks", "wheat-mill",
]);

const specialBlockSources = Object.freeze(Object.values(BLOCKS)
  .filter((definition) => definition.shape !== undefined
    && ![BlockId.Chest, BlockId.Apiary, BlockId.CaptureOrbRack, BlockId.CreatureHealer, BlockId.Torch].includes(definition.id))
  .map((definition) => `block:${definition.id}:${definition.shape}`)
  .sort());

const projectileSpellRefs = refs(...SPELLS
  .filter((spell) => spell.projectile.kind !== "none")
  .map((spell) => spellRef(spell.id)));

const MISSING_PROFILES = Object.freeze([
  ...explicitItemPresentationBlockers("dropped-item", "dropModel"),
  ...explicitItemPresentationBlockers("held-item", "heldModel"),
  ...MACHINE_IDS.filter((id) => !MAPPED_MACHINES.has(id)).map((id) => Object.freeze({
    id: `missing:machine:${id}`,
    role: "machine" as const,
    sourcePresentationIds: Object.freeze([`machine-profile:${id}`]),
    contentRefs: refs(machineRef(id)),
    reason: "The production machine profile has no exact model in the tracked BWM2 catalog.",
  })),
  Object.freeze({
    id: "missing:projectile:creature-specials",
    role: "projectile" as const,
    sourcePresentationIds: Object.freeze(["projectile:verdant-root", "projectile:webspinner-bind"]),
    contentRefs: refs(creatureRef("webspinner-golem"), creatureRef("wood-elf-leafwarden")),
    reason: "The authored creature projectile visuals do not have exact BWM2 models.",
  }),
  Object.freeze({
    id: "missing:projectile:skeleton-arrow",
    role: "projectile" as const,
    sourcePresentationIds: Object.freeze(["BWM2:skeleton-arrow", "runtime:arrow-projectile"]),
    contentRefs: refs(creatureRef("skeleton"), { domain: "ability-spell", id: "move:skeleton--nocked-shot" }),
    reason: "The skeleton-arrow BWM2 entry is an inspection capture; current runtime skeleton shots use arrow-projectile.",
  }),
  Object.freeze({
    id: "missing:projectile:spell-variants",
    role: "projectile" as const,
    sourcePresentationIds: Object.freeze(SPELLS.filter((spell) => spell.projectile.kind !== "none")
      .map((spell) => `spell-projectile:${spell.id}:${spell.projectile.kind}`).sort()),
    contentRefs: projectileSpellRefs,
    reason: "These authored spell projectile variants have no exact BWM2 model identity.",
  }),
  Object.freeze({
    id: "missing:world-prop:special-block-shapes",
    role: "world-prop" as const,
    sourcePresentationIds: specialBlockSources,
    contentRefs: Object.freeze([]),
    reason: "These exact authored special block shapes are not represented by distinct production BWM2 identities.",
  }),
].sort((left, right) => left.id.localeCompare(right.id)));

export const BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1: RenderPresentationCatalogV1 = Object.freeze({
  schema: RENDER_PRESENTATION_CATALOG_SCHEMA_V1,
  catalog: Object.freeze({
    schema: 2,
    format: "blockwild-compiled-model-catalog-v2",
    revision: RENDER_PRESENTATION_CATALOG_REVISION_V1,
    sha256: "12c522f880e94c1ae527de701ae3e710fee13701d66fbb0a4ad24895557011b4",
    canonicalHash: "52fd4aebb0c457f3c83af79af6b83c93",
    byteLength: 785_824,
    modelCount: 252,
    nodeCount: 13_121,
    source: "renderer-neutral model specs and offline production captures",
  }),
  profiles: PROFILES,
  missingProfiles: MISSING_PROFILES,
  integrationBlockers: Object.freeze([
    "combat-projectile-and-summon-r6-binding-runtime",
    "dropped-item-r6-model-binding-runtime",
    "machine-world-view-presentation-binding-runtime",
    "world-prop-model-binding-runtime",
  ]),
});

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function f32Bits(value: number | null) {
  if (value === null) return null;
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}

function canonicalProfileText(profileCatalog: RenderPresentationCatalogV1) {
  return JSON.stringify(profileCatalog);
}

function validateProfileShape(profileCatalog: RenderPresentationCatalogV1) {
  let previousProfile = "";
  const profileIds = new Set<string>();
  const roleRefs = new Set<string>();
  for (const profile of profileCatalog.profiles) {
    invariant(previousProfile < profile.id, "render presentation profiles are not canonical and unique");
    previousProfile = profile.id;
    invariant(!profileIds.has(profile.id), "render presentation profile id is duplicated");
    profileIds.add(profile.id);
    let previousRef = "";
    for (const reference of profile.contentRefs) {
      const refKey = `${reference.domain}:${reference.id}`;
      invariant(previousRef < refKey, `render presentation refs are not canonical in ${profile.id}`);
      previousRef = refKey;
      const roleRef = `${profile.role}:${refKey}`;
      invariant(!roleRefs.has(roleRef), `ambiguous ${profile.role} render presentation for ${refKey}`);
      roleRefs.add(roleRef);
    }
  }
  let previousMissing = "";
  for (const blocker of profileCatalog.missingProfiles) {
    invariant(previousMissing < blocker.id, "missing render presentation profiles are not canonical and unique");
    previousMissing = blocker.id;
    invariant(blocker.sourcePresentationIds.length > 0, `missing render presentation ${blocker.id} has no exact source ids`);
    invariant(blocker.sourcePresentationIds.every((value, index, values) => index === 0 || values[index - 1] < value),
      `missing render presentation source ids are not canonical in ${blocker.id}`);
    invariant(blocker.contentRefs.every((value, index, values) => index === 0
      || compareContentRefs(values[index - 1], value) < 0), `missing render presentation refs are not canonical in ${blocker.id}`);
    for (const reference of blocker.contentRefs) {
      const refKey = `${reference.domain}:${reference.id}`;
      const roleRef = `${blocker.role}:${refKey}`;
      invariant(!roleRefs.has(roleRef), `ambiguous ${blocker.role} render presentation coverage for ${refKey}`);
      roleRefs.add(roleRef);
    }
  }
  invariant(profileCatalog.integrationBlockers.every((value, index, values) => index === 0 || values[index - 1] < value),
    "render presentation integration blockers are not canonical and unique");
}

function decoderManifest(
  manifest: PublishedRenderModelCatalogManifestV1,
  expected: RenderPresentationCatalogV1,
): RenderEntityModelCatalogManifestR10 {
  return {
    schema: manifest.schema,
    format: manifest.format,
    revision: BigInt(expected.catalog.revision),
    current: manifest.current,
    sha256: manifest.sha256,
    catalogHash: manifest.catalogHash,
    byteLength: manifest.byteLength,
    modelCount: manifest.modelCount,
    nodeCount: manifest.nodeCount,
  };
}

/** Verifies the tracked manifest, full BWM2 bytes and every role-specific model identity before exposure. */
export async function attestRenderPresentationCatalogV1(
  manifestValue: unknown,
  catalogBytes: Uint8Array,
  expected: RenderPresentationCatalogV1 = BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1,
): Promise<AttestedRenderPresentationCatalogV1> {
  validateProfileShape(expected);
  const manifest = parsePublishedRenderModelCatalogManifestV1(manifestValue);
  invariant(JSON.stringify({
    schema: manifest.schema,
    format: manifest.format,
    revision: expected.catalog.revision,
    sha256: manifest.sha256,
    canonicalHash: manifest.catalogHash,
    byteLength: manifest.byteLength,
    modelCount: manifest.modelCount,
    nodeCount: manifest.nodeCount,
    source: manifest.source,
  }) === JSON.stringify(expected.catalog), "published BWM2 catalog identity does not match the render presentation catalog");
  const modelCatalog = await decodeRenderEntityModelCatalogR10(catalogBytes, decoderManifest(manifest, expected));
  const modelsByProfileId = new Map<string, RenderEntityCompiledModelR10>();
  for (const profile of expected.profiles) {
    const candidate = findRenderEntityCompiledModelR10(modelCatalog, profile.model.id);
    invariant(candidate !== null, `published BWM2 catalog has no model '${profile.model.id}'`);
    invariant(candidate.label === profile.model.label
      && candidate.category === profile.model.category
      && candidate.nodes.length === profile.model.nodeCount
      && f32Bits(candidate.groundY) === profile.model.groundYBits,
    `published BWM2 model identity does not match render presentation '${profile.id}'`);
    modelsByProfileId.set(profile.id, candidate);
  }
  invariant(canonicalProfileText(expected) === canonicalProfileText(BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1),
    "render presentation catalog expectation drifted from production");
  return Object.freeze({ profileCatalog: expected, modelCatalog, modelsByProfileId });
}

/** Fetches only the content-addressed BWM2 path named by the renderer manifest, then fully attests it. */
export async function loadAttestedRenderPresentationCatalogV1(input: Readonly<{
  manifestUrl?: string;
  fetch?: typeof globalThis.fetch;
  expected?: RenderPresentationCatalogV1;
}> = {}): Promise<AttestedRenderPresentationCatalogV1> {
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  invariant(typeof fetchImplementation === "function", "fetch is unavailable for render presentation attestation");
  const manifestUrl = input.manifestUrl ?? "/renderer/manifest.json";
  const manifestResponse = await fetchImplementation(manifestUrl, { cache: "no-store" });
  invariant(manifestResponse.ok, `render presentation manifest request failed with ${manifestResponse.status}`);
  const manifestValue: unknown = await manifestResponse.json();
  const manifest = parsePublishedRenderModelCatalogManifestV1(manifestValue);
  const resolvedManifestUrl = new URL(manifestResponse.url || manifestUrl, globalThis.location?.href ?? "http://localhost/");
  const artifactUrl = new URL(manifest.artifact.slice(1), new URL("./", resolvedManifestUrl)).toString();
  const artifactResponse = await fetchImplementation(artifactUrl, { cache: "force-cache" });
  invariant(artifactResponse.ok, `render presentation catalog request failed with ${artifactResponse.status}`);
  return attestRenderPresentationCatalogV1(
    manifest,
    new Uint8Array(await artifactResponse.arrayBuffer()),
    input.expected,
  );
}
