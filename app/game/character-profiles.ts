import type { FactionId, FactionRace, FactionRelationsState, NpcFactionId } from "./factions";
import { SKILL_IDS, type SkillId, type SkillState } from "./skills";
import { TYPESCRIPT_STORAGE_PREFIX } from "./edition";

export const CHARACTER_PROFILE_SCHEMA = 1 as const;
export const CHARACTER_PROFILE_STORAGE_KEY = `${TYPESCRIPT_STORAGE_PREFIX}-character-profiles-v1`;
export const CHARACTER_BROWSER_ID_KEY = `${TYPESCRIPT_STORAGE_PREFIX}-browser-player-id-v1`;
export const CHARACTER_STARTING_SKILL_POINTS = 20;
export const MAX_CHARACTER_PROFILES = 12;

export const CHARACTER_RACES = [
  "wayfarer",
  "hearthkin",
  "goblin",
  "atlantian",
  "confectkin",
  "wood-elf",
  "dwarf",
] as const satisfies readonly FactionRace[];

export type CharacterSex = "male" | "female";
export type CharacterColorKey = "skin" | "hair" | "shirt" | "trousers" | "accent";

export type CharacterColors = Readonly<Record<CharacterColorKey, string>>;

/** The small, JSON-safe appearance contract shared by saves, previews and peers. */
export type CharacterAppearance = Readonly<{
  sex: CharacterSex;
  race: FactionRace;
  colors: CharacterColors;
}>;

export type CharacterSkillAllocation = Readonly<Record<SkillId, number>>;

export type CharacterProfile = Readonly<{
  schema: typeof CHARACTER_PROFILE_SCHEMA;
  /** Stable for this saved character across worlds and reconnects. */
  id: string;
  /** Stable for this browser install; useful for reconnect diagnostics. */
  browserId: string;
  name: string;
  appearance: CharacterAppearance;
  startingSkills: CharacterSkillAllocation;
  createdAt: number;
  updatedAt: number;
}>;

export type CharacterProfileCatalog = Readonly<{
  schema: typeof CHARACTER_PROFILE_SCHEMA;
  browserId: string;
  selectedProfileId: string;
  profiles: readonly CharacterProfile[];
}>;

export type CharacterRaceDefinition = Readonly<{
  id: FactionRace;
  name: string;
  description: string;
  homeFaction: NpcFactionId | null;
  heightScale: number;
  landSpeedMultiplier: number;
  waterSpeedMultiplier: number;
  waterBreathing: boolean;
}>;

export const CHARACTER_RACE_DEFINITIONS: Readonly<Record<FactionRace, CharacterRaceDefinition>> = Object.freeze({
  wayfarer: { id: "wayfarer", name: "Wayfarer", description: "Adaptable travelers with no environmental penalty.", homeFaction: null, heightScale: 1, landSpeedMultiplier: 1, waterSpeedMultiplier: 1, waterBreathing: false },
  hearthkin: { id: "hearthkin", name: "Hearthkin", description: "Small, steady folk of field, road, and warm freehold.", homeFaction: "hobbits", heightScale: 0.86, landSpeedMultiplier: 0.98, waterSpeedMultiplier: 0.92, waterBreathing: false },
  goblin: { id: "goblin", name: "Goblin", description: "Quick-footed makers shaped by highlands and clan roads.", homeFaction: "goblins", heightScale: 0.91, landSpeedMultiplier: 1.04, waterSpeedMultiplier: 0.9, waterBreathing: false },
  atlantian: { id: "atlantian", name: "Atlantian", description: "Tideborn explorers who breathe water and move fastest beneath it.", homeFaction: "atlantians", heightScale: 1.02, landSpeedMultiplier: 0.75, waterSpeedMultiplier: 1.3, waterBreathing: true },
  confectkin: { id: "confectkin", name: "Confectkin", description: "Bright Sugarcourt artisans with a springy traveling stride.", homeFaction: "sugarcourt", heightScale: 0.95, landSpeedMultiplier: 1.01, waterSpeedMultiplier: 0.9, waterBreathing: false },
  "wood-elf": { id: "wood-elf", name: "Wood Elf", description: "Tall glimmerwood stewards with unmistakably pointed features.", homeFaction: "wood-elves", heightScale: 1.04, landSpeedMultiplier: 1.02, waterSpeedMultiplier: 1, waterBreathing: false },
  dwarf: { id: "dwarf", name: "Dwarf", description: "Compact mountain delvers with a deliberate, grounded stride.", homeFaction: "dwarves", heightScale: 0.88, landSpeedMultiplier: 0.94, waterSpeedMultiplier: 0.86, waterBreathing: false },
});

export const CHARACTER_COLOR_SWATCHES: Readonly<Record<CharacterColorKey, readonly string[]>> = Object.freeze({
  skin: ["#f2c6a7", "#dca27f", "#c98f6b", "#9d684d", "#704737", "#4a3028", "#70b7c1", "#86c79a"],
  hair: ["#17191d", "#4d3424", "#7b4a28", "#b98542", "#d7c39a", "#6f728e", "#d36e91", "#e8ecf3"],
  shirt: ["#3f7fba", "#527d60", "#824f6e", "#a65d4a", "#7069a8", "#bc8c3e", "#3d777a", "#464b54"],
  trousers: ["#293554", "#3e4934", "#493943", "#554232", "#303237", "#626079", "#704d3b", "#2e585d"],
  accent: ["#f0c85b", "#8cc9c1", "#e6a0b3", "#d7805f", "#a89be0", "#e1e8ee", "#89b866", "#c79355"],
});

export const DEFAULT_CHARACTER_COLORS: CharacterColors = Object.freeze({
  skin: "#c98f6b",
  hair: "#4d3424",
  shirt: "#3f7fba",
  trousers: "#293554",
  accent: "#f0c85b",
});

export const FALLBACK_CHARACTER_PROFILE: CharacterProfile = Object.freeze({
  schema: CHARACTER_PROFILE_SCHEMA,
  id: "character-default",
  browserId: "browser-hydration",
  name: "Trailkeeper",
  appearance: Object.freeze({ sex: "male", race: "wayfarer", colors: DEFAULT_CHARACTER_COLORS }),
  startingSkills: Object.freeze({ melee: 2, ranged: 2, mining: 2, crafting: 2, survival: 2, husbandry: 2, exploration: 2, magic: 2, bartering: 2, luck: 2 }),
  createdAt: 0,
  updatedAt: 0,
});

export const FALLBACK_CHARACTER_CATALOG: CharacterProfileCatalog = Object.freeze({
  schema: CHARACTER_PROFILE_SCHEMA,
  browserId: FALLBACK_CHARACTER_PROFILE.browserId,
  selectedProfileId: FALLBACK_CHARACTER_PROFILE.id,
  profiles: Object.freeze([FALLBACK_CHARACTER_PROFILE]),
});

const RACE_SET = new Set<string>(CHARACTER_RACES);
const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeId(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 72) || fallback;
}

function safeName(value: unknown, fallback = "Trailkeeper") {
  const name = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().replace(/\s+/gu, " ") : "";
  return (name || fallback).slice(0, 32);
}

function safeTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function randomId(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/gu, "")
    ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`.slice(0, 72);
}

export function normalizeCharacterColors(value: unknown): CharacterColors {
  const input = isRecord(value) ? value : {};
  return Object.fromEntries((Object.keys(DEFAULT_CHARACTER_COLORS) as CharacterColorKey[]).map((key) => {
    const candidate = typeof input[key] === "string" ? input[key].toLowerCase() : "";
    return [key, HEX_COLOR.test(candidate) ? candidate : DEFAULT_CHARACTER_COLORS[key]];
  })) as unknown as CharacterColors;
}

export function blankCharacterSkills(): CharacterSkillAllocation {
  return Object.fromEntries(SKILL_IDS.map((skillId) => [skillId, 0])) as unknown as CharacterSkillAllocation;
}

export function balancedCharacterSkills(): CharacterSkillAllocation {
  return Object.freeze({ melee: 2, ranged: 2, mining: 2, crafting: 2, survival: 2, husbandry: 2, exploration: 2, magic: 2, bartering: 2, luck: 2 });
}

export function normalizeCharacterSkillAllocation(value: unknown): CharacterSkillAllocation {
  const input = isRecord(value) ? value : {};
  const result = { ...blankCharacterSkills() } as Record<SkillId, number>;
  let remaining = CHARACTER_STARTING_SKILL_POINTS;
  for (const skillId of SKILL_IDS) {
    const raw = typeof input[skillId] === "number" && Number.isFinite(input[skillId]) ? Math.trunc(input[skillId]) : 0;
    const allocated = Math.max(0, Math.min(remaining, raw));
    result[skillId] = allocated;
    remaining -= allocated;
  }
  return result;
}

export function allocatedCharacterSkillPoints(skills: CharacterSkillAllocation) {
  return SKILL_IDS.reduce((total, skillId) => total + skills[skillId], 0);
}

export function remainingCharacterSkillPoints(skills: CharacterSkillAllocation) {
  return Math.max(0, CHARACTER_STARTING_SKILL_POINTS - allocatedCharacterSkillPoints(skills));
}

export function normalizeCharacterAppearance(value: unknown): CharacterAppearance {
  const input = isRecord(value) ? value : {};
  const race = typeof input.race === "string" && RACE_SET.has(input.race) ? input.race as FactionRace : "wayfarer";
  return {
    sex: input.sex === "female" ? "female" : "male",
    race,
    colors: normalizeCharacterColors(input.colors),
  };
}

export function characterRaceTraits(race: FactionRace) {
  return CHARACTER_RACE_DEFINITIONS[RACE_SET.has(race) ? race : "wayfarer"];
}

export function characterFactionAlignmentBonus(race: FactionRace): Readonly<Partial<Record<FactionId, number>>> {
  const faction = characterRaceTraits(race).homeFaction;
  return faction ? { [faction]: 25 } : {};
}

export function applyCharacterStartingSkills(state: SkillState, allocation: CharacterSkillAllocation): SkillState {
  const normalized = normalizeCharacterSkillAllocation(allocation);
  return {
    ...state,
    skills: Object.fromEntries(SKILL_IDS.map((skillId) => [skillId, {
      level: Math.max(state.skills[skillId].level, normalized[skillId]),
      xp: state.skills[skillId].xp,
    }])) as unknown as SkillState["skills"],
  };
}

export function applyCharacterStartingAlignment(state: FactionRelationsState, race: FactionRace): FactionRelationsState {
  const bonus = characterFactionAlignmentBonus(race);
  if (!Object.keys(bonus).length) return state;
  return {
    ...state,
    alignments: Object.fromEntries(Object.entries(state.alignments).map(([factionId, alignment]) => [
      factionId,
      Math.max(-100, Math.min(100, alignment + (bonus[factionId as FactionId] ?? 0))),
    ])) as unknown as FactionRelationsState["alignments"],
  };
}

export function normalizeCharacterProfile(value: unknown, browserId: string, now = Date.now()): CharacterProfile {
  const input = isRecord(value) ? value : {};
  const createdAt = safeTimestamp(input.createdAt, now);
  return {
    schema: CHARACTER_PROFILE_SCHEMA,
    id: safeId(input.id, randomId("character")),
    browserId,
    name: safeName(input.name),
    appearance: normalizeCharacterAppearance(input.appearance ?? { sex: input.sex, race: input.race, colors: input.colors }),
    startingSkills: normalizeCharacterSkillAllocation(input.startingSkills),
    createdAt,
    updatedAt: Math.max(createdAt, safeTimestamp(input.updatedAt, now)),
  };
}

export function createCharacterProfile(browserId: string, input: Partial<CharacterProfile> = {}, now = Date.now()): CharacterProfile {
  return normalizeCharacterProfile({
    ...input,
    id: input.id ?? randomId("character"),
    browserId,
    name: input.name ?? "Trailkeeper",
    appearance: input.appearance ?? { sex: "male", race: "wayfarer", colors: DEFAULT_CHARACTER_COLORS },
    startingSkills: input.startingSkills ?? balancedCharacterSkills(),
    createdAt: now,
    updatedAt: now,
  }, browserId, now);
}

/** Globally unique, stable identity used by reconnect/session authority. */
export function characterNetworkId(profile: Pick<CharacterProfile, "browserId" | "id">) {
  if (profile.id === "legacy-default" && /^player_[a-z0-9_-]{12,56}$/iu.test(profile.browserId)) return profile.browserId;
  return `${safeId(profile.browserId, "browser")}.${safeId(profile.id, "character")}`.slice(0, 150);
}

export function readOrCreateCharacterBrowserId(storage: Storage | null) {
  try {
    const existing = storage?.getItem(CHARACTER_BROWSER_ID_KEY);
    if (existing) return safeId(existing, randomId("browser"));
    const created = randomId("browser");
    storage?.setItem(CHARACTER_BROWSER_ID_KEY, created);
    return created;
  } catch {
    return randomId("browser-session");
  }
}

export class CharacterProfileStore {
  private readonly storage: Storage | null;
  private readonly now: () => number;
  private _catalog: CharacterProfileCatalog;

  constructor(storage: Storage | null, now: () => number = () => Date.now()) {
    this.storage = storage;
    this.now = now;
    const browserId = readOrCreateCharacterBrowserId(storage);
    this._catalog = this.read(browserId);
  }

  get catalog() { return this._catalog; }
  get selectedProfile(): CharacterProfile {
    return (this._catalog.profiles.find((profile) => profile.id === this._catalog.selectedProfileId) ?? this._catalog.profiles[0])!;
  }

  select(profileId: string) {
    if (!this._catalog.profiles.some((profile) => profile.id === profileId)) return this.selectedProfile;
    this.commit({ ...this._catalog, selectedProfileId: profileId });
    return this.selectedProfile;
  }

  create(input: Partial<CharacterProfile> = {}) {
    if (this._catalog.profiles.length >= MAX_CHARACTER_PROFILES) return null;
    const profile = createCharacterProfile(this._catalog.browserId, input, this.now());
    this.commit({ ...this._catalog, selectedProfileId: profile.id, profiles: [...this._catalog.profiles, profile] });
    return profile;
  }

  update(profileId: string, patch: Partial<Pick<CharacterProfile, "name" | "appearance" | "startingSkills">>): CharacterProfile | null {
    const index = this._catalog.profiles.findIndex((profile) => profile.id === profileId);
    if (index < 0) return null;
    const updated = normalizeCharacterProfile({ ...this._catalog.profiles[index], ...patch, updatedAt: this.now() }, this._catalog.browserId, this.now());
    const profiles = [...this._catalog.profiles];
    profiles[index] = updated;
    this.commit({ ...this._catalog, profiles });
    return updated;
  }

  remove(profileId: string) {
    if (this._catalog.profiles.length <= 1) return false;
    const profiles = this._catalog.profiles.filter((profile) => profile.id !== profileId);
    if (profiles.length === this._catalog.profiles.length) return false;
    const selectedProfileId = this._catalog.selectedProfileId === profileId ? profiles[0].id : this._catalog.selectedProfileId;
    this.commit({ ...this._catalog, selectedProfileId, profiles });
    return true;
  }

  private read(browserId: string): CharacterProfileCatalog {
    let raw: unknown = null;
    try { raw = JSON.parse(this.storage?.getItem(CHARACTER_PROFILE_STORAGE_KEY) ?? "null") as unknown; } catch { /* Repair below. */ }
    const input = isRecord(raw) ? raw : {};
    const profiles = Array.isArray(input.profiles)
      ? input.profiles.slice(0, MAX_CHARACTER_PROFILES).map((profile) => normalizeCharacterProfile(profile, browserId, this.now()))
      : [];
    if (!profiles.length) profiles.push(createCharacterProfile(browserId, {
      id: /^player_[a-z0-9_-]{12,56}$/iu.test(browserId) ? "legacy-default" : undefined,
    }, this.now()));
    const requested = typeof input.selectedProfileId === "string" ? input.selectedProfileId : "";
    const catalog: CharacterProfileCatalog = {
      schema: CHARACTER_PROFILE_SCHEMA,
      browserId,
      selectedProfileId: profiles.some((profile) => profile.id === requested) ? requested : profiles[0].id,
      profiles,
    };
    this.commit(catalog);
    return catalog;
  }

  private commit(catalog: CharacterProfileCatalog) {
    this._catalog = catalog;
    try { this.storage?.setItem(CHARACTER_PROFILE_STORAGE_KEY, JSON.stringify(catalog)); } catch { /* Session catalog remains valid. */ }
  }
}
