/** BWG7 command bodies and native semantic hashing.
 * Transport bounds are enforced here; GameplayAuthority separately validates ownership,
 * content compatibility, metadata semantics, resource availability, and revisions.
 * Field order and tags mirror runtime_domain_wire.rs; hash order mirrors gameplay modules.
 */
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow";
import { RustIntegratedPlayerInventoryReaderV1 as Reader, RustIntegratedPlayerInventoryWriterV1 as Writer } from "./rust-integrated-runtime-player-inventory";

interface Field<T> {
  read(reader: Reader): T;
  write(writer: Writer, value: T): void;
  hash(hasher: TypeScriptCanonicalHasher, value: T): void;
}
type Value<F> = F extends Field<infer T> ? T : never;
type Shape = Readonly<Record<string, Field<unknown>>>;
type Struct<S extends Shape> = { readonly [K in keyof S]: Value<S[K]> };
type Tagged<S extends Shape> = { [K in keyof S]: Readonly<{ kind: K }> & Value<S[K]> }[keyof S];
const fail = (message: string): never => { throw new Error(`gameplay-command-wire: ${message}`); };
function struct<S extends Shape>(fields: S): Field<Struct<S>> {
  const entries = Object.entries(fields);
  return {
    read(r) { return Object.fromEntries(entries.map(([key, field]) => [key, field.read(r)])) as Struct<S>; },
    write(w, v) { for (const [key, field] of entries) field.write(w, v[key]); },
    hash(h, v) { for (const [key, field] of entries) field.hash(h, v[key]); },
  };
}
/** Insertion order is the native numeric tag order, never alphabetical order. */
function tagged<S extends Shape>(variants: S): Field<Tagged<S>> {
  const entries = Object.entries(variants);
  const selected = (v: Tagged<S>) => {
    const index = entries.findIndex(([key]) => key === v.kind);
    if (index < 0) fail("unknown command variant");
    return { index, field: entries[index]![1] };
  };
  return {
    read(r) { const entry = entries[r.u8()]; if (!entry) return fail("unknown command tag"); return { kind: entry[0], ...entry[1].read(r) as object } as Tagged<S>; },
    write(w, v) { const { index, field } = selected(v); w.u8(index); field.write(w, v); },
    hash(h, v) { const { index, field } = selected(v); h.writeU16(index); field.hash(h, v); },
  };
}
function enumeration<const T extends readonly string[]>(values: T): Field<T[number]> {
  const index = (value: T[number]) => { const tag = values.indexOf(value); if (tag < 0) fail("unknown enum value"); return tag; };
  return {
    read(r) { const value = values[r.u8()]; if (value === undefined) return fail("unknown enum tag"); return value; },
    write(w, v) { w.u8(index(v)); }, hash(h, v) { h.writeU16(index(v)); },
  };
}
function option<T>(field: Field<T>): Field<T | null> {
  return { read: (r) => r.option(() => field.read(r)), write(w, v) { w.option(v, (value) => field.write(w, value)); },
    hash(h, v) { h.writeU16(v === null ? 0 : 1); if (v !== null) field.hash(h, v); } };
}
function list<T>(field: Field<T>, maximum: number): Field<readonly T[]> {
  const check = (count: number) => { if (!Number.isInteger(count) || count < 0 || count > maximum) fail(`collection exceeds ${maximum}`); return count; };
  return { read(r) { return Array.from({ length: check(r.u32()) }, () => field.read(r)); },
    write(w, v) { w.u32(check(v.length)); for (const value of v) field.write(w, value); },
    hash(h, v) { h.writeU64(check(v.length)); for (const value of v) field.hash(h, value); } };
}
function hashOverride<T>(field: Field<T>, hash: Field<T>["hash"]): Field<T> { return { ...field, hash }; }
const text: Field<string> = { read: (r) => r.string(), write: (w, v) => w.string(v), hash: (h, v) => { h.writeString(v); } };
const u16: Field<number> = { read: (r) => r.u16(), write: (w, v) => w.u16(v), hash: (h, v) => { h.writeU16(v); } };
const u32: Field<number> = { read: (r) => r.u32(), write: (w, v) => w.u32(v), hash: (h, v) => { h.writeU32(v); } };
const u64: Field<bigint> = { read: (r) => r.u64(), write: (w, v) => w.u64(v), hash: (h, v) => { h.writeU64(v); } };
const i32: Field<number> = { read: (r) => r.u32() | 0, write(w, v) { if (!Number.isInteger(v) || v < -0x80000000 || v > 0x7fffffff) fail("i32 out of range"); w.u32(v >>> 0); }, hash: (h, v) => { h.writeI32(v); } };
const i64: Field<bigint> = { read: (r) => BigInt.asIntN(64, r.u64()), write(w, v) { if (typeof v !== "bigint" || v < -(BigInt(1) << BigInt(63)) || v >= (BigInt(1) << BigInt(63))) fail("i64 out of range"); w.u64(BigInt.asUintN(64, v)); }, hash: (h, v) => { h.writeU64(BigInt.asUintN(64, v)); } };
const bool: Field<boolean> = { read(r) { const v = r.u8(); if (v > 1) fail("invalid boolean"); return v === 1; }, write(w, v) { if (typeof v !== "boolean") fail("invalid boolean"); w.u8(v ? 1 : 0); }, hash: (h, v) => { h.writeU16(v ? 1 : 0); } };
function bytes(maximum: number): Field<Uint8Array> { return { read: (r) => Uint8Array.from(r.bytes(maximum)), write: (w, v) => w.bytes(v, maximum), hash: (h, v) => { h.writeBytes(v); } }; }
function hashBytes(v: string) { if (!/^[0-9a-f]{32}$/u.test(v)) fail("invalid canonical hash"); return Uint8Array.from({ length: 16 }, (_, i) => Number.parseInt(v.slice(i * 2, i * 2 + 2), 16)); }
const hash: Field<string> = { read: (r) => [...r.take(16)].map((v) => v.toString(16).padStart(2, "0")).join(""), write: (w, v) => w.raw(hashBytes(v)), hash: (h, v) => { h.writeBytes(hashBytes(v)); } };
const entityId: Field<bigint> = { ...u64, read(r) { const v = r.u64(); if (v === BigInt(0)) fail("zero entity id is reserved"); return v; }, write(w, v) { if (v === BigInt(0)) fail("zero entity id is reserved"); w.u64(v); } };
const container = struct({ kind: enumeration(["player", "equipment", "container", "machine", "waygrid", "cardforge-case"]), id: text, ownerId: option(text) });
const stack = struct({ itemCode: u32, count: u32, durabilityMillionths: option(hashOverride(u32, (h, v) => { h.writeU64(v); })), metadataHash: hash });
const expectedStack = struct({ itemCode: u32, metadataHash: hash, minimumCount: u32 });
const slot = struct({ container, slot: u16, expectedContainerRevision: option(u64) });
const ingredient = struct({ itemCode: u32, metadataHash: option(hash), count: u32 });
const metadata = struct({ hash, typeId: text, schemaId: text, schemaVersion: u16, contentVersion: u32, canonicalJsonBytes: bytes(64 * 1024), unknownExtensionBytes: bytes(64 * 1024) });
const provenanceFields = struct({ schemaVersion: u16, manifestHash: hash, installedRegistryHash: hash, catalogBlobHash: hash, actionReportHash: hash, rngSemanticsHash: hash, blockActionSequence: u64, originInputSequence: u64, blockId: u16, position: struct({ x: i32, y: i32, z: i32 }), lootPlanHash: hash, groupOrdinal: u16 });
const provenance = hashOverride(provenanceFields, (h, v) => {
  const inner = new TypeScriptCanonicalHasher("blockwild.gameplay.generated-drop-provenance.v1");
  provenanceFields.hash(inner, v); h.writeBytes(hashBytes(inner.finishHex()));
});
const inventory = tagged({
  transfer: struct({ from: slot, to: slot, count: u32, expected: option(expectedStack) }),
  craft: struct({ recipeId: text, quantity: u16, stationId: option(text), source: container, destination: container, expectedSourceRevision: option(u64), expectedDestinationRevision: option(u64) }),
  "advance-furnace": struct({ furnaceId: text, expectedRevision: u64, toTick: u64, fuelItem: option(ingredient), fuelTicksPerItem: u32 }),
  "create-drop-custody": struct({ source: slot, custody: container, expected: option(expectedStack), requestHash: hash }),
  "remove-empty-drop-custody": struct({ custody: container, expectedRevision: u64 }),
  "create-player-custody": struct({ inventory: container, inventorySlots: u16, equipment: container, equipmentSlots: u16, backSlot: option(hashOverride(u16, (h, v) => { h.writeU64(v); })) }),
  "import-player-inventory-v1": struct({ inventory: container, expectedRevision: u64, slots: list(option(stack), 9), metadata: list(metadata, 9) }),
  "apply-block-action-v1": struct({ inventory: container, slot: u16, expectedContainerRevision: u64, expectedStack: option(stack), consumeCount: u32, durabilityCostMillionths: u32, createdStack: option(stack), reason: text }),
  "create-generated-drop-custody-v1": struct({ custody: container, stack, provenance, requestHash: hash }),
  "consume-inventory-unit-v1": struct({ inventory: container, slot: u16, expectedContainerRevision: u64, expectedStack: stack }),
});
const opaque = struct({ typeId: text, schema: u16, bytes: bytes(256 * 1024) });
const resource = struct({ kind: enumeration(["item", "liquid", "gas", "energy", "heat"]), contentId: text, itemCode: option(u32), metadataHash: hash });
const endpoint = struct({ machineId: text, portId: text });
const operation = tagged({ configure: struct({ settings: opaque }), activate: struct({}), deactivate: struct({}), "claim-output": struct({ portId: text, resource, amount: u64 }) });
const machine = tagged({
  operate: struct({ machineId: text, expectedRevision: u64, operation }),
  transfer: struct({ from: endpoint, to: endpoint, resource, amount: u64, expectedFromRevision: u64, expectedToRevision: u64 }),
  advance: struct({ machineId: text, expectedRevision: u64, toTick: u64 }),
  "grant-lease": struct({ machineId: text, expectedRevision: u64, lease: struct({ leaseId: text, ownerId: text, startTick: u64, endTick: u64, maxCycles: u32 }) }),
  "power-transfer": struct({ networkId: text, expectedRevision: u64, machineId: text, amount: i64 }),
});
const vec3 = struct({ xMilli: i32, yMilli: i32, zMilli: i32 });
const contentDomain = enumeration(["item", "crafting-recipe", "machine-recipe", "machine-profile", "ability-spell", "creature-profile", "creature-type-chart", "quest-guild", "economy", "cardforge-card", "cardforge-pack"]);
const resolveProjectile = struct({ projectileId: text, expectedRevision: u64, targetId: option(text), impact: vec3, tick: u64 });
const combat = tagged({
  "use-ability": struct({ sourceId: text, expectedSourceRevision: u64, targetId: text, expectedTargetRevision: u64, abilityId: text, projectileId: option(text), aim: vec3, tick: u64 }),
  "resolve-projectile": resolveProjectile,
  capture: struct({ sourceId: text, creatureId: text, expectedCreatureRevision: u64, orbItemCode: u32, tick: u64 }),
  pacify: struct({ sourceId: text, creatureId: text, expectedCreatureRevision: u64, method: enumeration(["outmaneuver", "lure-and-care"]), evidence: opaque, tick: u64 }),
  care: struct({ sourceId: text, creatureId: text, expectedCreatureRevision: u64, careItemCode: u32, amount: u16, tick: u64 }),
  summon: struct({ sourceId: text, summonId: text, contentId: text, durationTicks: option(u32), groundingItemCode: option(u32), tick: u64 }),
  advance: struct({ toTick: u64 }),
  "use-linked-projectile": struct({ sourceId: text, expectedSourceRevision: u64, targetId: text, expectedTargetRevision: u64, abilityId: text, projectileId: text, entityId, contentDomain, contentId: text, presentationId: text, aim: vec3, tick: u64 }),
  "summon-linked": struct({ sourceId: text, summonId: text, entityId, contentDomain, contentId: text, presentationId: text, position: vec3, durationTicks: option(u32), groundingItemCode: option(u32), tick: u64 }),
  "resolve-linked-projectile": resolveProjectile,
  "advance-linked-projectile": struct({ projectileId: text, expectedRevision: u64, position: vec3, tick: u64 }),
});
const progression = struct({ action: enumeration(["unlock-perk", "quest-choice", "faction-choice", "guild-action", "trade", "fast-travel", "dialogue-choice", "dragon-training", "settlement-action", "legendary-action"]), ownerId: text, recordId: text, expectedRecordRevision: u64, optionId: text, quantity: u32, currencyId: option(text), payload: option(opaque) });
const printing = struct({ cardId: text, variantId: text, finishId: text });
const deckCard = struct({ printing, count: u16 });
const deckCards = list(deckCard, 65_536);
const utf8 = new TextEncoder();
function compareText(a: string, b: string) { const left = utf8.encode(a); const right = utf8.encode(b); for (let i = 0; i < Math.min(left.length, right.length); i += 1) if (left[i] !== right[i]) return left[i]! - right[i]!; return left.length - right.length; }
function comparePrinting(a: Value<typeof printing>, b: Value<typeof printing>) { return compareText(a.cardId, b.cardId) || compareText(a.variantId, b.variantId) || compareText(a.finishId, b.finishId); }
function sortedCards(cards: Value<typeof deckCards>) { const sorted = [...cards].sort((a, b) => comparePrinting(a.printing, b.printing)); for (let i = 1; i < sorted.length; i += 1) if (comparePrinting(sorted[i - 1]!.printing, sorted[i]!.printing) === 0) fail("deck contains duplicate printing"); return sorted; }
const canonicalCards: typeof deckCards = { read: (r) => sortedCards(deckCards.read(r)), write: (w, v) => deckCards.write(w, sortedCards(v)), hash(h, v) { for (const card of sortedCards(v)) deckCard.hash(h, card); } };
const deckFields = struct({ deckId: text, ownerId: text, rulesId: text, cards: canonicalCards, expectedRevision: option(u64) });
// Rust hashes expectedRevision before its sorted BTreeMap entries and omits the map count.
const deck = hashOverride(deckFields, (h, v) => { text.hash(h, v.deckId); text.hash(h, v.ownerId); text.hash(h, v.rulesId); option(u64).hash(h, v.expectedRevision); canonicalCards.hash(h, v.cards); });
const battleAction = tagged({ draw: struct({}), play: struct({ handIndex: u16 }), "attack-player": struct({ boardIndex: u16 }), "end-turn": struct({}), concede: struct({}) });
const cardforge = tagged({
  "open-pack": struct({ recordId: text, ownerId: text, expectedRevision: u64 }),
  "move-card": struct({ ownerId: text, printing, count: u32, toArchive: bool, expectedCustodyRevision: u64 }),
  "archive-duplicate": struct({ ownerId: text, printing, keep: u32, expectedCustodyRevision: u64 }),
  "build-deck": deck,
  "start-match": struct({ matchId: text, playerOne: text, deckOne: text, playerTwo: text, deckTwo: text }),
  "match-action": struct({ matchId: text, ownerId: text, expectedRevision: u64, action: battleAction }),
  "claim-reward": struct({ ownerId: text, rewardId: text, expectedCustodyRevision: u64 }),
});
const command = tagged({ inventory: struct({ command: inventory }), machine: struct({ command: machine }), combat: struct({ command: combat }), progression: struct({ command: progression }), cardforge: struct({ command: cardforge }), "advance-schedule": struct({ expectedTick: u64, toTick: u64, machineBudget: u16 }) });

export type RustIntegratedGameplayInventoryCommandV1 = Value<typeof inventory>;
export type RustIntegratedGameplayMachineCommandV1 = Value<typeof machine>;
export type RustIntegratedGameplayCombatCommandV1 = Value<typeof combat>;
export type RustIntegratedGameplayProgressionCommandV1 = Value<typeof progression>;
export type RustIntegratedGameplayCardforgeCommandV1 = Value<typeof cardforge>;
export type RustIntegratedGameplayCommandV1 = Value<typeof command>;
export type RustIntegratedGameplayScheduleCommandV1 = Extract<RustIntegratedGameplayCommandV1, { kind: "advance-schedule" }>;
export function readRustIntegratedGameplayCommandV1(reader: Reader): RustIntegratedGameplayCommandV1 { return command.read(reader); }
export function writeRustIntegratedGameplayCommandV1(writer: Writer, value: RustIntegratedGameplayCommandV1) { command.write(writer, value); }
/** Independent native semantic hash, not a hash of the transport bytes or their checksum. */
export function rustIntegratedGameplayCommandHashV1(commands: readonly RustIntegratedGameplayCommandV1[]) {
  if (commands.length < 1 || commands.length > 256) fail("command count must be between 1 and 256");
  const h = new TypeScriptCanonicalHasher("blockwild.gameplay.commands.v1").writeU64(commands.length);
  for (const value of commands) { command.write(new Writer(), value); command.hash(h, value); }
  return h.finishHex();
}
