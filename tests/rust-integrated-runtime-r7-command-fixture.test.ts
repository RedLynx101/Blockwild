import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decodeRustIntegratedGameplayBatchWireV1 as decode, encodeRustIntegratedGameplayBatchWireV1 as encode,
  rustIntegratedGameplayCommandHashV1 as commandHash, decodeRustIntegratedGameplayScheduleBatchWireV1,
  encodeRustIntegratedGameplayScheduleBatchWireV1, type RustIntegratedGameplayBatchWireV1 as Batch,
  type RustIntegratedGameplayCommandV1 as Command, type RustIntegratedGameplayInventoryCommandV1 as Inventory,
  encodeRustIntegratedGameplayActorGrantV1, decodeRustIntegratedGameplayActorGrantV1,
} from "../app/game/rust-integrated-runtime-gameplay-wire.ts";
import { RustIntegratedPlayerInventoryWriterV1 as Writer } from "../app/game/rust-integrated-runtime-player-inventory.ts";
import { rustIntegratedRuntimeWireChecksumV1 } from "../app/game/rust-integrated-runtime-codec.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/rust-engine/integrated-runtime-v1/r7-gameplay-command-wire-v1.json", import.meta.url), "utf8")) as {
  schema: number; producer: string; vectors: { name: string; hex: string; commandHash: string }[];
  zeroActorGrantHex: string; browserLifecycle: { grantHex: string };
};
const zero = "0".repeat(32);
const maximum = (BigInt(1) << BigInt(64)) - BigInt(1);
const schedule: Command = { kind: "advance-schedule", expectedTick: BigInt(0), toTick: maximum, machineBudget: 64 };
const identity = { universe: "u", location: "l", revision: { epoch: 1, sequence: maximum, inventory: maximum, machines: maximum, combat: maximum, progression: maximum, cardforge: maximum }, stateHash: zero };
const batch = (commands: readonly Command[]): Batch => ({ batchId: "b", idempotencyKey: "i", actor: { actorId: "a", playerId: null, entityId: null, role: "system" }, identity, commands, commandHash: commandHash(commands) });
const fromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const allCommands = () => fixture.vectors.flatMap((v) => decode(fromHex(v.hex)).commands);
function reseal(packet: Uint8Array) {
  new DataView(packet.buffer, packet.byteOffset, packet.byteLength).setUint32(8, packet.length - 28, true);
  packet.set(fromHex(rustIntegratedRuntimeWireChecksumV1(packet.subarray(28))), 12); return packet;
}
// Replace the single schedule command with hand-authored malformed native command bytes.
function rawCommand(write: (writer: Writer) => void, hash = zero) {
  const base = encode(batch([schedule])); const writer = new Writer(); write(writer);
  const prefix = base.subarray(0, base.length - 35); const body = writer.finish();
  const packet = new Uint8Array(prefix.length + body.length + 16); packet.set(prefix); packet.set(body, prefix.length); packet.set(fromHex(hash), prefix.length + body.length);
  return reseal(packet);
}
const setEquals = (values: Iterable<string>, expected: readonly string[]) => assert.deepEqual([...new Set(values)].sort(), [...expected].sort());

test("BWG7 Rust fixture contains every generic primary variant and nested enum", () => {
  assert.equal(fixture.schema, 1);
  assert.equal(fixture.producer, "blockwild-engine native BWG7 codec and GameplayBatch::calculate_command_hash");
  assert.equal(new Set(fixture.vectors.map((v) => v.name)).size, fixture.vectors.length);
  const commands = allCommands();
  setEquals(commands.map((v) => v.kind), ["inventory", "machine", "combat", "progression", "cardforge", "advance-schedule"]);
  setEquals(commands.flatMap((v) => v.kind === "inventory" ? [v.command.kind] : []), ["transfer", "craft", "advance-furnace", "create-drop-custody", "remove-empty-drop-custody", "create-player-custody", "import-player-inventory-v1", "apply-block-action-v1", "create-generated-drop-custody-v1", "consume-inventory-unit-v1"]);
  setEquals(commands.flatMap((v) => v.kind === "machine" ? [v.command.kind] : []), ["operate", "transfer", "advance", "grant-lease", "power-transfer"]);
  setEquals(commands.flatMap((v) => v.kind === "combat" ? [v.command.kind] : []), ["use-ability", "resolve-projectile", "capture", "pacify", "care", "summon", "advance", "use-linked-projectile", "summon-linked", "resolve-linked-projectile", "advance-linked-projectile"]);
  setEquals(commands.flatMap((v) => v.kind === "progression" ? [v.command.action] : []), ["unlock-perk", "quest-choice", "faction-choice", "guild-action", "trade", "fast-travel", "dialogue-choice", "dragon-training", "settlement-action", "legendary-action"]);
  setEquals(commands.flatMap((v) => v.kind === "cardforge" ? [v.command.kind] : []), ["open-pack", "move-card", "archive-duplicate", "build-deck", "start-match", "match-action", "claim-reward"]);
  setEquals(commands.flatMap((v) => v.kind === "machine" && v.command.kind === "operate" ? [v.command.operation.kind] : []), ["configure", "activate", "deactivate", "claim-output"]);
  setEquals(commands.flatMap((v) => v.kind === "cardforge" && v.command.kind === "match-action" ? [v.command.action.kind] : []), ["draw", "play", "attack-player", "end-turn", "concede"]);
  setEquals(commands.flatMap((v) => v.kind === "combat" && v.command.kind === "pacify" ? [v.command.method] : []), ["outmaneuver", "lure-and-care"]);
  setEquals(commands.flatMap((v) => v.kind === "combat" && (v.command.kind === "use-linked-projectile" || v.command.kind === "summon-linked") ? [v.command.contentDomain] : []), ["item", "crafting-recipe", "machine-recipe", "machine-profile", "ability-spell", "creature-profile", "creature-type-chart", "quest-guild", "economy", "cardforge-card", "cardforge-pack"]);
  setEquals(commands.flatMap((v) => v.kind === "machine" && v.command.kind === "transfer" ? [v.command.resource.kind] : []), ["item", "liquid", "gas", "energy", "heat"]);
});

for (const vector of fixture.vectors) test(`BWG7 ${vector.name}: independent native bytes and command hash`, () => {
  const bytes = fromHex(vector.hex); const value = decode(bytes);
  assert.equal(value.commandHash, vector.commandHash);
  assert.equal(commandHash(value.commands), vector.commandHash);
  assert.deepEqual(encode(value), bytes);
  const offset = new Uint8Array(bytes.length + 8); offset.set(bytes, 3);
  assert.deepEqual(encode(decode(offset.subarray(3, bytes.length + 3))), bytes);
  for (const length of [0, 4, 28, bytes.length - 1]) assert.throws(() => decode(bytes.subarray(0, length)));
  const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => decode(corrupt), /checksum/u);
  assert.throws(() => decode(reseal(corrupt)), /command hash mismatch/u);
  const semantic = bytes.slice(); semantic[semantic.length - 17] ^= 1;
  assert.throws(() => decode(reseal(semantic)), "resealed command-body tampering must reject");
  const schema = bytes.slice(); schema[6] = 255; assert.throws(() => decode(schema), /header/u);
  const padding = new Uint8Array(bytes.length + 1); padding.set(bytes); assert.throws(() => decode(reseal(padding)), /trailing/u);
});

test("BWG7 optional fields independently cover present and absent branches", () => {
  const seen = new Map<string, Set<string>>();
  function record(path: string, value: unknown) { const states = seen.get(path) ?? new Set<string>(); states.add(value === null ? "none" : "some"); seen.set(path, states); }
  function walk(value: unknown, path: string) {
    if (Array.isArray(value)) { for (const child of value) { record(`${path}[]`, child); walk(child, `${path}[]`); } return; }
    if (!value || typeof value !== "object" || value instanceof Uint8Array) return;
    const fields = value as Record<string, unknown>;
    // Resource/container enums do not create distinct option schemas. Command variants do.
    const enumField = ("id" in fields && "ownerId" in fields) || ("contentId" in fields && "metadataHash" in fields);
    const branch = typeof fields.kind === "string" && !enumField ? `${path}:${fields.kind}` : path;
    for (const [key, child] of Object.entries(fields)) {
      const keyPath = `${branch}.${key}`; record(keyPath, child); walk(child, keyPath);
    }
  }
  for (const value of allCommands()) walk(value, "command");
  for (const value of fixture.vectors) walk(decode(fromHex(value.hex)).actor, "actor");
  // Independent explicit list: unlike discovering nulls, this catches an omitted None branch.
  const optionalPaths = ["actor.playerId", "actor.entityId"];
  const paths = (domain: string, variant: string, fields: readonly string[]) => optionalPaths.push(...fields.map((field) => `command:${domain}.command${variant ? `:${variant}` : ""}.${field}`));
  paths("inventory", "transfer", ["from.container.ownerId", "from.expectedContainerRevision", "to.container.ownerId", "to.expectedContainerRevision", "expected"]);
  paths("inventory", "craft", ["stationId", "source.ownerId", "destination.ownerId", "expectedSourceRevision", "expectedDestinationRevision"]);
  paths("inventory", "advance-furnace", ["fuelItem", "fuelItem.metadataHash"]);
  paths("inventory", "create-drop-custody", ["source.container.ownerId", "source.expectedContainerRevision", "custody.ownerId", "expected"]);
  paths("inventory", "remove-empty-drop-custody", ["custody.ownerId"]);
  paths("inventory", "create-player-custody", ["inventory.ownerId", "equipment.ownerId", "backSlot"]);
  paths("inventory", "import-player-inventory-v1", ["inventory.ownerId", "slots[]", "slots[].durabilityMillionths"]);
  paths("inventory", "apply-block-action-v1", ["inventory.ownerId", "expectedStack", "expectedStack.durabilityMillionths", "createdStack", "createdStack.durabilityMillionths"]);
  paths("inventory", "create-generated-drop-custody-v1", ["custody.ownerId", "stack.durabilityMillionths"]);
  paths("inventory", "consume-inventory-unit-v1", ["inventory.ownerId", "expectedStack.durabilityMillionths"]);
  paths("machine", "operate", ["operation:claim-output.resource.itemCode"]);
  paths("machine", "transfer", ["resource.itemCode"]);
  paths("combat", "use-ability", ["projectileId"]);
  paths("combat", "resolve-projectile", ["targetId"]);
  paths("combat", "resolve-linked-projectile", ["targetId"]);
  paths("combat", "summon", ["durationTicks", "groundingItemCode"]);
  paths("combat", "summon-linked", ["durationTicks", "groundingItemCode"]);
  paths("progression", "", ["currencyId", "payload"]);
  paths("cardforge", "build-deck", ["expectedRevision"]);
  assert.equal(optionalPaths.length, 46);
  for (const path of optionalPaths) assert.deepEqual([...(seen.get(path) ?? [])].sort(), ["none", "some"], path);
});

test("BWG7 count, unknown tag, option, flag, and dedicated-only command guards", () => {
  assert.throws(() => commandHash([]), /count/u);
  assert.throws(() => commandHash(Array(257).fill(schedule)), /count/u);
  assert.equal(decode(encode(batch(Array(256).fill(schedule)))).commands.length, 256);
  assert.throws(() => decode(rawCommand((w) => w.u8(255))), /unknown command tag/u);
  for (const domain of [0, 1, 2, 3, 4]) assert.throws(() => decode(rawCommand((w) => { w.u8(domain); w.u8(255); })), /unknown (command|enum) tag/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(0); w.u8(10); })), /unknown command tag/u);
  assert.throws(() => commandHash([{ kind: "opaque", bytes: new Uint8Array() } as unknown as Command]), /unknown command variant/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(2); w.u8(1); w.string("p"); w.u64(BigInt(1)); w.u8(2); })), /option/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(4); w.u8(1); for (let i = 0; i < 4; i++) w.string("x"); w.u32(1); w.u8(2); })), /boolean/u);
  const bytes = encode(batch([schedule])); const countOffset = bytes.length - 39;
  for (const count of [0, 257, 0xffffffff]) { const copy = bytes.slice(); new DataView(copy.buffer).setUint32(countOffset, count, true); assert.throws(() => decode(reseal(copy))); }
});

test("BWG7 raw numeric widths, opaque bytes, Unicode, and schedule restriction", () => {
  const generic = batch([{ ...schedule, machineBudget: 65535 }]);
  assert.deepEqual(decode(encode(generic)), generic);
  assert.throws(() => decodeRustIntegratedGameplayScheduleBatchWireV1(encode(generic)), /budget/u);
  const nonSchedule = allCommands().find((v) => v.kind !== "advance-schedule")!;
  assert.throws(() => decodeRustIntegratedGameplayScheduleBatchWireV1(encode(batch([nonSchedule]))), /schedule-only/u);
  assert.throws(() => encodeRustIntegratedGameplayScheduleBatchWireV1(batch([nonSchedule]) as Parameters<typeof encodeRustIntegratedGameplayScheduleBatchWireV1>[0]), /schedule-only/u);
  assert.throws(() => commandHash([{ ...schedule, machineBudget: 65536 }]), /range/u);
  assert.throws(() => commandHash([{ ...schedule, expectedTick: maximum + BigInt(1) }]), /u64/u);
  assert.throws(() => commandHash([{ ...schedule, expectedTick: BigInt(-1) }]), /u64/u);
  for (const actorId of ["\ufeffactor:🦊", "é".repeat(8192)]) { const value: Batch = { ...batch([schedule]), actor: { ...batch([schedule]).actor, actorId } }; assert.deepEqual(decode(encode(value)), value); }
  for (const actorId of ["", "é".repeat(8193), "a\u0000b", "\ud800"]) assert.throws(() => encode({ ...batch([schedule]), actor: { ...batch([schedule]).actor, actorId } }));
  const config = (size: number): Command => ({ kind: "machine", command: { kind: "operate", machineId: "m", expectedRevision: maximum, operation: { kind: "configure", settings: { typeId: "settings", schema: 65535, bytes: new Uint8Array(size) } } } });
  assert.deepEqual(decode(encode(batch([config(256 * 1024)]))).commands, [config(256 * 1024)]);
  assert.throws(() => batch([config(256 * 1024 + 1)]), /bound/u);
  assert.throws(() => encode(batch(Array(4).fill(config(256 * 1024)))), /byte budget/u);
  const prefix: Command[] = Array(3).fill(config(256 * 1024));
  const remaining = 1024 * 1024 - encode(batch([...prefix, config(0)])).length;
  const atLimit = encode(batch([...prefix, config(remaining)]));
  assert.equal(atLimit.length, 1024 * 1024); assert.deepEqual(encode(decode(atLimit)), atLimit);
  assert.throws(() => encode(batch([...prefix, config(remaining + 1)])), /byte budget/u);
  for (const amount of [-(BigInt(1) << BigInt(63)), (BigInt(1) << BigInt(63)) - BigInt(1)]) {
    const value = batch([{ kind: "machine", command: { kind: "power-transfer", networkId: "n", machineId: "m", expectedRevision: maximum, amount } }]); assert.deepEqual(decode(encode(value)), value);
  }
  assert.throws(() => batch([{ kind: "machine", command: { kind: "power-transfer", networkId: "n", machineId: "m", expectedRevision: maximum, amount: BigInt(1) << BigInt(63) } }]), /i64/u);
});

test("BWG7 and BWK7 preserve optional actor zero IDs distinctly from absence", () => {
  const baseline = batch([schedule]); const absentBatch = encode(baseline);
  const absentGrant = encodeRustIntegratedGameplayActorGrantV1({ ...baseline.actor, scopes: ["system"] });
  for (const playerId of [null, BigInt(0), maximum]) for (const entityId of [null, BigInt(0), maximum]) {
    const actor = { ...baseline.actor, playerId, entityId };
    const value = { ...baseline, actor }; const packet = encode(value);
    assert.deepEqual(decode(packet), value);
    assert.equal(value.commandHash, baseline.commandHash, "actor IDs are not part of semantic command hashing");
    const grant = { ...actor, scopes: ["system" as const] }; const grantBytes = encodeRustIntegratedGameplayActorGrantV1(grant);
    assert.deepEqual(decodeRustIntegratedGameplayActorGrantV1(grantBytes), grant);
    if (playerId !== null || entityId !== null) {
      assert.notDeepEqual(packet, absentBatch); assert.notDeepEqual(grantBytes, absentGrant);
      const presentCount = Number(playerId !== null) + Number(entityId !== null);
      assert.equal(packet.length, absentBatch.length + presentCount * 8);
      assert.equal(grantBytes.length, absentGrant.length + presentCount * 8);
    }
  }
  const actors = fixture.vectors.map((v) => decode(fromHex(v.hex)).actor);
  for (const field of ["playerId", "entityId"] as const) {
    assert.ok(actors.some((actor) => actor[field] === null), `${field} native None coverage`);
    assert.ok(actors.some((actor) => actor[field] === BigInt(0)), `${field} native Some(0) coverage`);
  }
  const nativeZeroGrant = fromHex(fixture.zeroActorGrantHex);
  const zeroGrant = decodeRustIntegratedGameplayActorGrantV1(nativeZeroGrant);
  assert.equal(zeroGrant.playerId, BigInt(0)); assert.equal(zeroGrant.entityId, BigInt(0));
  assert.deepEqual(encodeRustIntegratedGameplayActorGrantV1(zeroGrant), nativeZeroGrant);
  const nativeAbsentGrant = fromHex(fixture.browserLifecycle.grantHex);
  const absent = decodeRustIntegratedGameplayActorGrantV1(nativeAbsentGrant);
  assert.equal(absent.playerId, null); assert.equal(absent.entityId, null);
  assert.deepEqual(encodeRustIntegratedGameplayActorGrantV1(absent), nativeAbsentGrant);
});

test("BWG7 nested unknown enums, invalid UTF-8, packed IDs, and i32 bounds fail closed", () => {
  assert.throws(() => decode(rawCommand((w) => { w.u8(0); w.u8(4); w.u8(255); })), /enum/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(1); w.u8(0); w.string("m"); w.u64(BigInt(0)); w.u8(255); })), /command tag/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(1); w.u8(1); for (let i = 0; i < 4; i++) w.string("x"); w.u8(255); })), /enum/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(2); w.u8(3); w.string("s"); w.string("c"); w.u64(BigInt(0)); w.u8(255); })), /enum/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(4); w.u8(5); w.string("m"); w.string("o"); w.u64(BigInt(0)); w.u8(255); })), /command tag/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(2); w.u8(8); w.string("s"); w.string("s"); w.u64(BigInt(1)); w.u8(255); })), /enum/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(2); w.u8(8); w.string("s"); w.string("s"); w.u64(BigInt(0)); })), /reserved/u);
  const linked = allCommands().find((v) => v.kind === "combat" && (v.command.kind === "use-linked-projectile" || v.command.kind === "summon-linked"))!;
  assert.equal(linked.kind, "combat");
  if (linked.kind === "combat" && (linked.command.kind === "use-linked-projectile" || linked.command.kind === "summon-linked")) {
    const zeroEntity: Command = { ...linked, command: { ...linked.command, entityId: BigInt(0) } };
    assert.throws(() => commandHash([zeroEntity]), /reserved/u);
  }
  assert.throws(() => decode(rawCommand((w) => { w.u8(1); w.u8(2); w.u32(1); w.u8(255); })), /UTF-8/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(1); w.u8(2); w.u32(16385); })), /UTF-8/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(1); w.u8(0); w.string("m"); w.u64(BigInt(0)); w.u8(0); w.string("t"); w.u16(1); w.u32(256 * 1024 + 1); })), /bound/u);
  const projectile = (xMilli: number): Command => ({ kind: "combat", command: { kind: "advance-linked-projectile", projectileId: "p", expectedRevision: maximum, position: { xMilli, yMilli: -0x80000000, zMilli: 0x7fffffff }, tick: maximum } });
  for (const x of [-0x80000000, 0, 0x7fffffff]) { const value = batch([projectile(x)]); assert.deepEqual(decode(encode(value)), value); }
  for (const x of [-0x80000001, 0x80000000, 0.5, Number.NaN]) assert.throws(() => batch([projectile(x)]), /i32/u);
});

test("BWG7 metadata/import bounds remain transport-only, not dedicated BWP7 semantics", () => {
  const inventory = { kind: "player" as const, id: "p", ownerId: null };
  const descriptor = { hash: zero, typeId: "metadata", schemaId: "schema", schemaVersion: 0, contentVersion: 0xffffffff, canonicalJsonBytes: Uint8Array.of(255), unknownExtensionBytes: new Uint8Array(64 * 1024) };
  const make = (overrides: Partial<Extract<Inventory, { kind: "import-player-inventory-v1" }>> = {}): Command => ({ kind: "inventory", command: { kind: "import-player-inventory-v1", inventory, expectedRevision: maximum, slots: [null], metadata: [descriptor], ...overrides } });
  const value = batch([make()]); assert.deepEqual(decode(encode(value)), value, "raw metadata semantics validated by authority, not generic wire");
  assert.deepEqual(decode(encode(batch([make({ slots: Array(9).fill(null), metadata: Array(9).fill({ ...descriptor, unknownExtensionBytes: new Uint8Array() }) })]))).commands.length, 1);
  assert.throws(() => batch([make({ slots: Array(10).fill(null) })]), /collection/u);
  assert.throws(() => batch([make({ metadata: Array(10).fill(descriptor) })]), /collection/u);
  for (const field of ["canonicalJsonBytes", "unknownExtensionBytes"] as const) assert.throws(() => batch([make({ metadata: [{ ...descriptor, [field]: new Uint8Array(64 * 1024 + 1) }] })]), /bound/u);
  const maxDescriptor = { ...descriptor, canonicalJsonBytes: new Uint8Array(64 * 1024) };
  assert.deepEqual(decode(encode(batch([make({ metadata: [maxDescriptor] })]))).commands, [make({ metadata: [maxDescriptor] })]);
  assert.throws(() => encode(batch([make({ metadata: Array(9).fill(maxDescriptor) })])), /byte budget/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(0); w.u8(6); w.u8(0); w.string("p"); w.u8(0); w.u64(BigInt(0)); w.u32(10); })), /collection/u);
  assert.throws(() => decode(rawCommand((w) => {
    w.u8(0); w.u8(6); w.u8(0); w.string("p"); w.u8(0); w.u64(BigInt(0)); w.u32(0); w.u32(1);
    w.raw(new Uint8Array(16)); w.string("t"); w.string("s"); w.u16(1); w.u32(1); w.u32(64 * 1024 + 1);
  })), /bound/u);
});

test("BWG7 Cardforge maps are UTF-8 ordered, duplicate-free, and hash order is canonical", () => {
  const card = (cardId: string) => ({ printing: { cardId, variantId: "v", finishId: "f" }, count: 1 });
  const command: Command = { kind: "cardforge", command: { kind: "build-deck", deckId: "d", ownerId: "o", rulesId: "r", cards: [card("😀"), card("\ue000"), card("a")], expectedRevision: null } };
  const result = decode(encode(batch([command]))).commands[0]!;
  assert.equal(result.kind, "cardforge"); if (result.kind !== "cardforge" || result.command.kind !== "build-deck") return;
  const deck = result.command;
  assert.deepEqual(deck.cards.map((v) => v.printing.cardId), ["a", "\ue000", "😀"]);
  assert.equal(commandHash([command]), commandHash([result]));
  const unorderedPacket = rawCommand((w) => {
    w.u8(4); w.u8(3); w.string("d"); w.string("o"); w.string("r"); w.u32(3);
    for (const value of [card("😀"), card("a"), card("\ue000")]) { w.string(value.printing.cardId); w.string("v"); w.string("f"); w.u16(1); }
    w.u8(0);
  }, commandHash([command]));
  assert.deepEqual(decode(unorderedPacket).commands, [result], "native BTreeMap semantics normalize unordered input");
  assert.throws(() => batch([{ kind: "cardforge", command: { ...deck, cards: [card("a"), card("a")] } }]), /duplicate/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(4); w.u8(3); for (let i = 0; i < 3; i++) w.string("x"); w.u32(65537); })), /collection/u);
  assert.throws(() => decode(rawCommand((w) => { w.u8(4); w.u8(3); for (let i = 0; i < 3; i++) w.string("x"); w.u32(2); for (let i = 0; i < 2; i++) { w.string("a"); w.string("v"); w.string("f"); w.u16(1); } })), /duplicate/u);
});
