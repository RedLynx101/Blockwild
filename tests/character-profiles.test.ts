import assert from "node:assert/strict";
import test from "node:test";
import {
  CHARACTER_STARTING_SKILL_POINTS,
  CharacterProfileStore,
  allocatedCharacterSkillPoints,
  applyCharacterStartingAlignment,
  applyCharacterStartingSkills,
  characterFactionAlignmentBonus,
  characterNetworkId,
  characterRaceTraits,
  normalizeCharacterAppearance,
  normalizeCharacterSkillAllocation,
  remainingCharacterSkillPoints,
} from "../app/game/character-profiles";
import { createFactionRelations } from "../app/game/factions";
import { createSkillState } from "../app/game/skills";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("character profiles retain stable browser and character identities", () => {
  const storage = new MemoryStorage();
  const first = new CharacterProfileStore(storage, () => 100);
  const original = first.selectedProfile;
  assert.ok(original);
  const created = first.create({ name: "Mira Tide" });
  assert.ok(created);
  const networkId = characterNetworkId(created!);

  const restored = new CharacterProfileStore(storage, () => 200);
  assert.equal(restored.catalog.browserId, first.catalog.browserId);
  assert.equal(restored.selectedProfile.id, created!.id);
  assert.equal(restored.selectedProfile.name, "Mira Tide");
  assert.equal(characterNetworkId(restored.selectedProfile), networkId);
});

test("generic pre-split identity is not imported into the TypeScript edition", () => {
  const storage = new MemoryStorage();
  storage.setItem("blockwild-multiplayer-player-id", "player_1234567890abcdef");
  const store = new CharacterProfileStore(storage, () => 100);
  assert.notEqual(store.selectedProfile.browserId, "player_1234567890abcdef");
  assert.equal(storage.getItem("blockwild-multiplayer-player-id"), "player_1234567890abcdef");
  const second = store.create({ name: "Second" });
  assert.ok(second);
  assert.notEqual(characterNetworkId(second!), "player_1234567890abcdef");
});

test("appearance normalization keeps race, sex and safe colors", () => {
  const appearance = normalizeCharacterAppearance({
    sex: "female",
    race: "wood-elf",
    colors: { skin: "#AABBCC", hair: "unsafe", shirt: "#123456", trousers: "#654321", accent: "#abcdef" },
  });
  assert.equal(appearance.sex, "female");
  assert.equal(appearance.race, "wood-elf");
  assert.equal(appearance.colors.skin, "#aabbcc");
  assert.equal(appearance.colors.hair, "#4d3424");
});

test("starting skill allocations are bounded by one twenty-point budget", () => {
  const skills = normalizeCharacterSkillAllocation({ melee: 12, ranged: 12, mining: 50 });
  assert.equal(allocatedCharacterSkillPoints(skills), CHARACTER_STARTING_SKILL_POINTS);
  assert.equal(skills.melee, 12);
  assert.equal(skills.ranged, 8);
  assert.equal(skills.mining, 0);
  assert.equal(remainingCharacterSkillPoints(skills), 0);
});

test("Atlantian traits and native-faction starts are explicit", () => {
  const traits = characterRaceTraits("atlantian");
  assert.equal(traits.landSpeedMultiplier, 0.75);
  assert.ok(traits.waterSpeedMultiplier > 1);
  assert.equal(traits.waterBreathing, true);
  assert.deepEqual(characterFactionAlignmentBonus("atlantian"), { atlantians: 25 });
  assert.deepEqual(characterFactionAlignmentBonus("wayfarer"), {});
  const skills = applyCharacterStartingSkills(createSkillState(), normalizeCharacterSkillAllocation({ exploration: 8, survival: 12 }));
  assert.equal(skills.skills.exploration.level, 8);
  assert.equal(skills.skills.survival.level, 12);
  const relations = applyCharacterStartingAlignment(createFactionRelations("world:test"), "atlantian");
  assert.equal(relations.alignments.atlantians, 25);
});
