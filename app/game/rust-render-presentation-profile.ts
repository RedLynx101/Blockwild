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
import {
  canonicalTerrainMaterialRegistryV1,
  canonicalTerrainMaterialRegistryV2,
} from "./terrain-material-registry.ts";

export const RENDER_PRESENTATION_CATALOG_ID_V1 = "render-presentations" as const;
export const RENDER_PRESENTATION_CATALOG_SCHEMA_ID_V1 = "render-presentation-catalog" as const;
export const RENDER_PRESENTATION_CATALOG_SCHEMA_V1 = 1 as const;
export const RENDER_PRESENTATION_CATALOG_SCHEMA_V2 = 2 as const;
export const RENDER_PRESENTATION_CATALOG_SCHEMA_CURRENT = RENDER_PRESENTATION_CATALOG_SCHEMA_V2;
export const RENDER_PRESENTATION_CATALOG_REVISION_V1 = 1 as const;

export const WORLD_PROP_OWNERSHIP_POLICY_ID_V1 = "terrain-pages-and-domain-attachments-v1" as const;

export type WorldPropSourceBlockTupleV1 = Readonly<{
  blockId: number;
  registrySlot: number;
  materialKind: "air" | "material";
  geometryRevision: 1 | null;
  renderable: boolean;
  specialty: boolean;
}>;

export type WorldPropOwnershipOwnerV1 =
  | "bwr2-terrain-page"
  | "machine-child"
  | "r4-cell"
  | "r7-machine"
  | "resident-r6-entity"
  | "session"
  | "session-ui"
  | "terrain-effect";

export type WorldPropOwnershipStatusV1 = "exact" | "missing" | "partial";

export type WorldPropDynamicFamilyOwnershipV1 = Readonly<{
  id: string;
  baseOwner: "bwr2-terrain-page";
  stateOwners: readonly WorldPropOwnershipOwnerV1[];
  overlayOwner: "machine-child" | "session-ui" | "terrain-effect";
  status: WorldPropOwnershipStatusV1;
}>;

export type WorldPropOwnershipPolicyV1 = Readonly<{
  schema: 1;
  id: typeof WORLD_PROP_OWNERSHIP_POLICY_ID_V1;
  policyHash: string;
  sourceInventoryHash: string;
  sourceInventory: readonly WorldPropSourceBlockTupleV1[];
  terrain: Readonly<{
    protocol: "BWR2";
    registrySchemaVersion: 2;
    registryContentHash: string;
    geometryRevision: 1;
    registrySlotCount: number;
    biomeTintSlotCount: number;
    blockDefinitionCount: number;
    renderableBlockCount: number;
    specialtyBlockCount: number;
    specialtyPolicy: "bwr1-non-opaque-cube-or-furnace-v1";
    mesherArtifactHash: string | null;
    rendererArtifactHash: string | null;
    acceptedProducer: string | null;
    selectionPolicy: string | null;
    authorityBlockers: readonly string[];
  }>;
  dynamicFamilies: readonly WorldPropDynamicFamilyOwnershipV1[];
  residualPersistentKinds: readonly string[];
}>;

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

type RenderPresentationCatalogFieldsV1 = Readonly<{
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

export type RenderPresentationCatalogV1 = RenderPresentationCatalogFieldsV1 & Readonly<{
  schema: 1;
}>;

export type RenderPresentationCatalogV2 = RenderPresentationCatalogFieldsV1 & Readonly<{
  schema: 2;
  worldPropOwnershipPolicy: WorldPropOwnershipPolicyV1;
}>;

export type RenderPresentationCatalogCurrent = RenderPresentationCatalogV2;
export type AnyRenderPresentationCatalog = RenderPresentationCatalogV1 | RenderPresentationCatalogV2;

export type AttestedRenderPresentationCatalogV1 = Readonly<{
  profileCatalog: RenderPresentationCatalogCurrent;
  modelCatalog: RenderEntityCompiledModelCatalogR10;
  modelsByProfileId: ReadonlyMap<string, RenderEntityCompiledModelR10>;
  registry: RenderPresentationRegistryV1;
}>;

export type RenderPresentationBindingV1 =
  | Readonly<{
    status: "exact";
    role: RenderPresentationRoleV1;
    reference: RenderPresentationContentRefV1;
    profile: RenderPresentationProfileV1;
  }>
  | Readonly<{
    status: "missing";
    role: RenderPresentationRoleV1;
    reference: RenderPresentationContentRefV1;
    blocker: MissingRenderPresentationProfileV1;
  }>
  | Readonly<{
    status: "unmapped";
    role: RenderPresentationRoleV1;
    reference: RenderPresentationContentRefV1;
  }>;

export type RenderPresentationProfileIdBindingV1 =
  | Readonly<{
    status: "exact";
    role: RenderPresentationRoleV1;
    presentationId: string;
    profile: RenderPresentationProfileV1;
  }>
  | Readonly<{
    status: "missing";
    role: RenderPresentationRoleV1;
    presentationId: string;
    blocker: MissingRenderPresentationProfileV1;
  }>
  | Readonly<{
    status: "unmapped";
    role: RenderPresentationRoleV1;
    presentationId: string;
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

const HASH_MASK_64 = BigInt("0xffffffffffffffff");
const HASH_FNV_64_OFFSET = BigInt("14695981039346656037");
const HASH_FNV_64_PRIME = BigInt("1099511628211");
const HASH_HIGH_SEED_XOR = BigInt("0xa0761d6478bd642f");
const HASH_HIGH_PRIME = HASH_FNV_64_PRIME ^ BigInt("0x13b");
const hashEncoder = new TextEncoder();

/** Matches blockwild_types::CanonicalHasher; the explicit domains make the two policy hashes non-interchangeable. */
class WorldPropPolicyHasherV1 {
  private low = HASH_FNV_64_OFFSET;
  private high = HASH_FNV_64_OFFSET ^ HASH_HIGH_SEED_XOR;

  constructor(domain: string) { this.string(domain); }

  private raw(bytes: Uint8Array) {
    for (const byte of bytes) {
      this.low = ((this.low ^ BigInt(byte)) * HASH_FNV_64_PRIME) & HASH_MASK_64;
      this.high = ((this.high ^ (BigInt(byte) * BigInt(2) + BigInt(1))) * HASH_HIGH_PRIME) & HASH_MASK_64;
    }
  }

  private bytes(bytes: Uint8Array) {
    this.u64(BigInt(bytes.byteLength));
    for (const byte of bytes) {
      this.low = ((this.low ^ BigInt(byte)) * HASH_FNV_64_PRIME) & HASH_MASK_64;
      this.high = ((this.high ^ (BigInt(byte) * BigInt(2))) * HASH_HIGH_PRIME) & HASH_MASK_64;
    }
  }

  u16(value: number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    this.raw(bytes);
  }

  u32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.raw(bytes);
  }

  u64(value: bigint) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    this.raw(bytes);
  }

  string(value: string) { this.bytes(hashEncoder.encode(value)); }

  nullableString(value: string | null) {
    this.u16(value === null ? 0 : 1);
    if (value !== null) this.string(value);
  }

  finish() {
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setBigUint64(0, this.low, true);
    new DataView(bytes.buffer).setBigUint64(8, this.high, true);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

export function canonicalWorldPropSourceInventoryHashV1(
  inventory: readonly WorldPropSourceBlockTupleV1[],
) {
  const hasher = new WorldPropPolicyHasherV1("blockwild.render.world-prop-source-inventory.v1");
  hasher.u32(inventory.length);
  for (const tuple of inventory) {
    hasher.u16(tuple.blockId);
    hasher.u16(tuple.registrySlot);
    hasher.string(tuple.materialKind);
    hasher.u16(tuple.geometryRevision === null ? 0 : 1);
    if (tuple.geometryRevision !== null) hasher.u16(tuple.geometryRevision);
    hasher.u16(tuple.renderable ? 1 : 0);
    hasher.u16(tuple.specialty ? 1 : 0);
  }
  return hasher.finish();
}

type WorldPropPolicyHashInputV1 = Omit<WorldPropOwnershipPolicyV1, "policyHash">;

export function canonicalWorldPropOwnershipPolicyHashV1(
  policy: WorldPropPolicyHashInputV1 | WorldPropOwnershipPolicyV1,
) {
  const hasher = new WorldPropPolicyHasherV1("blockwild.render.world-prop-ownership-policy.v1");
  hasher.u16(policy.schema);
  hasher.string(policy.id);
  hasher.string(policy.sourceInventoryHash);
  const terrain = policy.terrain;
  hasher.string(terrain.protocol);
  hasher.u16(terrain.registrySchemaVersion);
  hasher.string(terrain.registryContentHash);
  hasher.u16(terrain.geometryRevision);
  hasher.u32(terrain.registrySlotCount);
  hasher.u32(terrain.biomeTintSlotCount);
  hasher.u32(terrain.blockDefinitionCount);
  hasher.u32(terrain.renderableBlockCount);
  hasher.u32(terrain.specialtyBlockCount);
  hasher.string(terrain.specialtyPolicy);
  hasher.nullableString(terrain.mesherArtifactHash);
  hasher.nullableString(terrain.rendererArtifactHash);
  hasher.nullableString(terrain.acceptedProducer);
  hasher.nullableString(terrain.selectionPolicy);
  hasher.u32(terrain.authorityBlockers.length);
  for (const blocker of terrain.authorityBlockers) hasher.string(blocker);
  hasher.u32(policy.dynamicFamilies.length);
  for (const family of policy.dynamicFamilies) {
    hasher.string(family.id);
    hasher.string(family.baseOwner);
    hasher.u32(family.stateOwners.length);
    for (const owner of family.stateOwners) hasher.string(owner);
    hasher.string(family.overlayOwner);
    hasher.string(family.status);
  }
  hasher.u32(policy.residualPersistentKinds.length);
  for (const kind of policy.residualPersistentKinds) hasher.string(kind);
  return hasher.finish();
}

function worldPropSourceInventoryV1() {
  const registry = canonicalTerrainMaterialRegistryV2();
  const specialtyRegistry = canonicalTerrainMaterialRegistryV1();
  return Object.freeze(Object.values(BLOCKS).sort((left, right) => left.id - right.id).map((definition) => {
    const material = registry.blocks[definition.id];
    invariant(material !== null && material !== undefined, `BWR2 has no slot for block ${definition.id}`);
    const renderable = definition.id !== BlockId.Air;
    invariant((material.kind === "material") === renderable, `BWR2 renderability drifted for block ${definition.id}`);
    const specialty = specialtyRegistry.blocks[definition.id]?.kind === "specialty";
    return Object.freeze({
      blockId: definition.id,
      registrySlot: definition.id,
      materialKind: material.kind,
      geometryRevision: material.kind === "material" ? material.geometryRevision : null,
      renderable,
      specialty,
    } satisfies WorldPropSourceBlockTupleV1);
  }));
}

const WORLD_PROP_SOURCE_INVENTORY_V1 = worldPropSourceInventoryV1();
const WORLD_PROP_SOURCE_INVENTORY_HASH_V1 = canonicalWorldPropSourceInventoryHashV1(WORLD_PROP_SOURCE_INVENTORY_V1);

const WORLD_PROP_TERRAIN_AUTHORITY_BLOCKERS_V1 = Object.freeze([
  "accepted-producer-identity-unproven",
  "mesher-artifact-hash-unproven",
  "renderer-artifact-hash-unproven",
  "selection-policy-unproven",
]);

const WORLD_PROP_DYNAMIC_FAMILIES_V1 = Object.freeze([
  Object.freeze({
    id: "active-chest-articulation", baseOwner: "bwr2-terrain-page" as const,
    stateOwners: Object.freeze(["session"] as const), overlayOwner: "session-ui" as const, status: "partial" as const,
  }),
  Object.freeze({
    id: "aquarium", baseOwner: "bwr2-terrain-page" as const,
    stateOwners: Object.freeze(["r7-machine", "resident-r6-entity"] as const),
    overlayOwner: "terrain-effect" as const, status: "missing" as const,
  }),
  Object.freeze({
    id: "butterfly-exhibit", baseOwner: "bwr2-terrain-page" as const,
    stateOwners: Object.freeze(["r7-machine", "resident-r6-entity"] as const),
    overlayOwner: "terrain-effect" as const, status: "missing" as const,
  }),
  Object.freeze({
    id: "capture-orb-rack-and-healer-contents", baseOwner: "bwr2-terrain-page" as const,
    stateOwners: Object.freeze(["r7-machine"] as const), overlayOwner: "machine-child" as const, status: "partial" as const,
  }),
  Object.freeze({
    id: "fireplace-flame", baseOwner: "bwr2-terrain-page" as const,
    stateOwners: Object.freeze(["r4-cell"] as const), overlayOwner: "terrain-effect" as const, status: "missing" as const,
  }),
  Object.freeze({
    id: "morph-loom-contents", baseOwner: "bwr2-terrain-page" as const,
    stateOwners: Object.freeze(["r7-machine"] as const), overlayOwner: "machine-child" as const, status: "missing" as const,
  }),
  Object.freeze({
    id: "tome-display", baseOwner: "bwr2-terrain-page" as const,
    stateOwners: Object.freeze(["r4-cell", "r7-machine"] as const),
    overlayOwner: "machine-child" as const, status: "missing" as const,
  }),
] satisfies readonly WorldPropDynamicFamilyOwnershipV1[]);

const terrainRegistryV2 = canonicalTerrainMaterialRegistryV2();
const WORLD_PROP_OWNERSHIP_POLICY_WITHOUT_HASH_V1 = Object.freeze({
  schema: 1 as const,
  id: WORLD_PROP_OWNERSHIP_POLICY_ID_V1,
  sourceInventoryHash: WORLD_PROP_SOURCE_INVENTORY_HASH_V1,
  sourceInventory: WORLD_PROP_SOURCE_INVENTORY_V1,
  terrain: Object.freeze({
    protocol: "BWR2" as const,
    registrySchemaVersion: terrainRegistryV2.schemaVersion,
    registryContentHash: terrainRegistryV2.contentHash,
    geometryRevision: 1 as const,
    registrySlotCount: terrainRegistryV2.blocks.length,
    biomeTintSlotCount: terrainRegistryV2.biomeTints.length,
    blockDefinitionCount: WORLD_PROP_SOURCE_INVENTORY_V1.length,
    renderableBlockCount: WORLD_PROP_SOURCE_INVENTORY_V1.filter((tuple) => tuple.renderable).length,
    specialtyBlockCount: WORLD_PROP_SOURCE_INVENTORY_V1.filter((tuple) => tuple.specialty).length,
    specialtyPolicy: "bwr1-non-opaque-cube-or-furnace-v1" as const,
    mesherArtifactHash: null,
    rendererArtifactHash: null,
    acceptedProducer: null,
    selectionPolicy: null,
    authorityBlockers: WORLD_PROP_TERRAIN_AUTHORITY_BLOCKERS_V1,
  }),
  dynamicFamilies: WORLD_PROP_DYNAMIC_FAMILIES_V1,
  residualPersistentKinds: Object.freeze([]),
} satisfies WorldPropPolicyHashInputV1);

export const BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1: WorldPropOwnershipPolicyV1 = Object.freeze({
  ...WORLD_PROP_OWNERSHIP_POLICY_WITHOUT_HASH_V1,
  policyHash: canonicalWorldPropOwnershipPolicyHashV1(WORLD_PROP_OWNERSHIP_POLICY_WITHOUT_HASH_V1),
});

const RENDER_PRESENTATION_CATALOG_FIELDS_V1: RenderPresentationCatalogFieldsV1 = Object.freeze({
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

/** The actual legacy schema: loadable, but it contains no world-prop ownership proof. */
export const BLOCKWILD_RENDER_PRESENTATION_CATALOG_V1: RenderPresentationCatalogV1 = Object.freeze({
  schema: RENDER_PRESENTATION_CATALOG_SCHEMA_V1,
  ...RENDER_PRESENTATION_CATALOG_FIELDS_V1,
});

export const BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2: RenderPresentationCatalogV2 = Object.freeze({
  schema: RENDER_PRESENTATION_CATALOG_SCHEMA_V2,
  ...RENDER_PRESENTATION_CATALOG_FIELDS_V1,
  worldPropOwnershipPolicy: BLOCKWILD_WORLD_PROP_OWNERSHIP_POLICY_V1,
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

function canonicalProfileText(profileCatalog: AnyRenderPresentationCatalog) {
  return JSON.stringify(profileCatalog);
}

function validateWorldPropOwnershipPolicyV1(policy: WorldPropOwnershipPolicyV1) {
  invariant(policy.schema === 1, "world prop ownership policy schema is unsupported");
  invariant(policy.id === WORLD_PROP_OWNERSHIP_POLICY_ID_V1, "world prop ownership policy id is unsupported");
  invariant(/^[0-9a-f]{32}$/u.test(policy.sourceInventoryHash), "world prop source inventory hash is invalid");
  invariant(/^[0-9a-f]{32}$/u.test(policy.policyHash), "world prop ownership policy hash is invalid");
  invariant(policy.sourceInventory.length === 313, "world prop source inventory does not cover 313 canonical blocks");
  const expectedInventory = WORLD_PROP_SOURCE_INVENTORY_V1;
  for (let index = 0; index < policy.sourceInventory.length; index += 1) {
    const tuple = policy.sourceInventory[index];
    invariant(index === 0 || policy.sourceInventory[index - 1].blockId < tuple.blockId,
      "world prop source inventory is not strictly sorted and unique");
    invariant(Number.isInteger(tuple.blockId) && tuple.blockId >= 0 && tuple.blockId <= 0xffff,
      "world prop source inventory block id is out of range");
    invariant(Number.isInteger(tuple.registrySlot) && tuple.registrySlot === tuple.blockId,
      "world prop source inventory registry slot does not match its block id");
    invariant(JSON.stringify(tuple) === JSON.stringify(expectedInventory[index]),
      `world prop source inventory drifted at block ${tuple.blockId}`);
  }
  invariant(canonicalWorldPropSourceInventoryHashV1(policy.sourceInventory) === policy.sourceInventoryHash,
    "world prop source inventory hash does not match its canonical tuples");

  const terrain = policy.terrain;
  invariant(terrain.protocol === "BWR2" && terrain.registrySchemaVersion === 2,
    "world prop terrain protocol is unsupported");
  invariant(terrain.registryContentHash === terrainRegistryV2.contentHash,
    "world prop terrain registry identity drifted from production");
  invariant(terrain.geometryRevision === 1 && terrain.registrySlotCount === terrainRegistryV2.blocks.length
    && terrain.biomeTintSlotCount === terrainRegistryV2.biomeTints.length,
  "world prop terrain registry dimensions drifted from production");
  const renderableCount = policy.sourceInventory.filter((tuple) => tuple.renderable).length;
  const specialtyCount = policy.sourceInventory.filter((tuple) => tuple.specialty).length;
  invariant(terrain.blockDefinitionCount === policy.sourceInventory.length
    && terrain.renderableBlockCount === renderableCount && terrain.specialtyBlockCount === specialtyCount,
  "world prop terrain coverage counts do not match the canonical source inventory");
  invariant(terrain.blockDefinitionCount === 313 && terrain.renderableBlockCount === 312
    && terrain.specialtyBlockCount === 218,
  "world prop terrain coverage counts drifted from the audited production inventory");
  invariant(terrain.specialtyPolicy === "bwr1-non-opaque-cube-or-furnace-v1",
    "world prop specialty classification policy is unsupported");
  invariant(terrain.mesherArtifactHash === null && terrain.rendererArtifactHash === null
    && terrain.acceptedProducer === null && terrain.selectionPolicy === null,
  "world prop policy must not invent unproven artifact or producer identities");
  invariant(JSON.stringify(terrain.authorityBlockers) === JSON.stringify(WORLD_PROP_TERRAIN_AUTHORITY_BLOCKERS_V1),
    "world prop terrain authority blockers do not match the unproven fields");

  const owners = new Set<WorldPropOwnershipOwnerV1>([
    "bwr2-terrain-page", "machine-child", "r4-cell", "r7-machine", "resident-r6-entity",
    "session", "session-ui", "terrain-effect",
  ]);
  const statuses = new Set<WorldPropOwnershipStatusV1>(["exact", "missing", "partial"]);
  invariant(policy.dynamicFamilies.length === 7, "world prop policy must assign all seven dynamic families");
  for (let index = 0; index < policy.dynamicFamilies.length; index += 1) {
    const family = policy.dynamicFamilies[index];
    invariant(index === 0 || policy.dynamicFamilies[index - 1].id < family.id,
      "world prop dynamic families are not strictly sorted and unique");
    invariant(family.baseOwner === "bwr2-terrain-page" && owners.has(family.overlayOwner)
      && statuses.has(family.status), `world prop dynamic family ${family.id} has an unsupported owner or status`);
    invariant(family.stateOwners.length > 0 && family.stateOwners.every((owner, ownerIndex, values) =>
      owners.has(owner) && (ownerIndex === 0 || values[ownerIndex - 1] < owner)),
    `world prop dynamic family ${family.id} state owners are not canonical`);
  }
  invariant(JSON.stringify(policy.dynamicFamilies) === JSON.stringify(WORLD_PROP_DYNAMIC_FAMILIES_V1),
    "world prop dynamic ownership assignments drifted from the audited source families");
  invariant(Array.isArray(policy.residualPersistentKinds) && policy.residualPersistentKinds.length === 0,
    "world prop residual persistent kinds must be explicitly present and empty");
  invariant(canonicalWorldPropOwnershipPolicyHashV1(policy) === policy.policyHash,
    "world prop ownership policy hash does not match its canonical fields");
}

function validateProfileShape(profileCatalog: AnyRenderPresentationCatalog) {
  invariant(profileCatalog.schema === RENDER_PRESENTATION_CATALOG_SCHEMA_V1
    || profileCatalog.schema === RENDER_PRESENTATION_CATALOG_SCHEMA_V2,
  "render presentation catalog schema is unsupported");
  if (profileCatalog.schema === RENDER_PRESENTATION_CATALOG_SCHEMA_V2) {
    validateWorldPropOwnershipPolicyV1(profileCatalog.worldPropOwnershipPolicy);
  } else {
    invariant(!("worldPropOwnershipPolicy" in profileCatalog),
      "legacy render presentation schema v1 cannot claim a world prop ownership policy");
  }
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

function presentationBindingKey(role: RenderPresentationRoleV1, reference: RenderPresentationContentRefV1) {
  return JSON.stringify([role, reference.domain, reference.id]);
}

function frozenReference(reference: RenderPresentationContentRefV1): RenderPresentationContentRefV1 {
  return Object.freeze({ domain: reference.domain, id: reference.id });
}

/** Immutable role-and-content lookup that never substitutes one presentation role for another. */
export class RenderPresentationRegistryV1 {
  private readonly bindings: ReadonlyMap<string, RenderPresentationBindingV1>;
  private readonly profileBindings: ReadonlyMap<string, RenderPresentationProfileIdBindingV1>;

  constructor(readonly catalog: AnyRenderPresentationCatalog) {
    validateProfileShape(catalog);
    const bindings = new Map<string, RenderPresentationBindingV1>();
    const profileBindings = new Map<string, RenderPresentationProfileIdBindingV1>();
    for (const profile of catalog.profiles) for (const reference of profile.contentRefs) {
      const canonicalReference = frozenReference(reference);
      const key = presentationBindingKey(profile.role, canonicalReference);
      invariant(!bindings.has(key), `ambiguous ${profile.role} render presentation registry binding`);
      bindings.set(key, Object.freeze({
        status: "exact",
        role: profile.role,
        reference: canonicalReference,
        profile,
      }));
    }
    for (const profile of catalog.profiles) {
      const key = presentationBindingKey(profile.role, { domain: "machine-profile", id: profile.id });
      invariant(!profileBindings.has(key), `ambiguous ${profile.role} presentation profile id`);
      profileBindings.set(key, Object.freeze({
        status: "exact",
        role: profile.role,
        presentationId: profile.id,
        profile,
      }));
    }
    for (const blocker of catalog.missingProfiles) for (const reference of blocker.contentRefs) {
      const canonicalReference = frozenReference(reference);
      const key = presentationBindingKey(blocker.role, canonicalReference);
      invariant(!bindings.has(key), `ambiguous ${blocker.role} render presentation registry coverage`);
      bindings.set(key, Object.freeze({
        status: "missing",
        role: blocker.role,
        reference: canonicalReference,
        blocker,
      }));
    }
    for (const blocker of catalog.missingProfiles) {
      const key = presentationBindingKey(blocker.role, { domain: "machine-profile", id: blocker.id });
      invariant(!profileBindings.has(key), `ambiguous ${blocker.role} missing presentation profile id`);
      profileBindings.set(key, Object.freeze({
        status: "missing",
        role: blocker.role,
        presentationId: blocker.id,
        blocker,
      }));
    }
    this.bindings = bindings;
    this.profileBindings = profileBindings;
    Object.freeze(this);
  }

  resolve(
    role: RenderPresentationRoleV1,
    reference: RenderPresentationContentRefV1,
  ): RenderPresentationBindingV1 {
    const canonicalReference = frozenReference(reference);
    return this.bindings.get(presentationBindingKey(role, canonicalReference)) ?? Object.freeze({
      status: "unmapped",
      role,
      reference: canonicalReference,
    });
  }

  /** Resolves a persisted role-specific profile id, never a ref or model id. */
  resolveProfileId(
    role: RenderPresentationRoleV1,
    presentationId: string,
  ): RenderPresentationProfileIdBindingV1 {
    const key = presentationBindingKey(role, { domain: "machine-profile", id: presentationId });
    return this.profileBindings.get(key) ?? Object.freeze({ status: "unmapped", role, presentationId });
  }
}

export function createRenderPresentationRegistryV1(catalog: AnyRenderPresentationCatalog) {
  return new RenderPresentationRegistryV1(catalog);
}

/** Returns null for schema v1; legacy absence is unproven and never promoted to an empty policy. */
export function renderPresentationWorldPropOwnershipPolicyV1(catalog: AnyRenderPresentationCatalog) {
  validateProfileShape(catalog);
  return catalog.schema === RENDER_PRESENTATION_CATALOG_SCHEMA_V2 ? catalog.worldPropOwnershipPolicy : null;
}

function decoderManifest(
  manifest: PublishedRenderModelCatalogManifestV1,
  expected: RenderPresentationCatalogCurrent,
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
  expected: RenderPresentationCatalogCurrent = BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2,
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
  invariant(canonicalProfileText(expected) === canonicalProfileText(BLOCKWILD_RENDER_PRESENTATION_CATALOG_V2),
    "render presentation catalog expectation drifted from production");
  const registry = createRenderPresentationRegistryV1(expected);
  return Object.freeze({ profileCatalog: expected, modelCatalog, modelsByProfileId, registry });
}

/** Fetches only the content-addressed BWM2 path named by the renderer manifest, then fully attests it. */
export async function loadAttestedRenderPresentationCatalogV1(input: Readonly<{
  manifestUrl?: string;
  fetch?: typeof globalThis.fetch;
  expected?: RenderPresentationCatalogCurrent;
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
