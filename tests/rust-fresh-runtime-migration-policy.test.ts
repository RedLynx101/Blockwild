import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { characterNetworkId, createCharacterProfile } from "../app/game/character-profiles.ts";
import { persistencePayloadHashV1 } from "../app/game/persistence-journal-contract.ts";
import {
  FRESH_RUNTIME_MIGRATION_ACKNOWLEDGEMENTS_V1,
  planRustFreshRuntimeMigrationV1,
  validateRustFreshRuntimeMigrationConsentV1,
  type FreshRuntimeMigrationProposalV1,
} from "../app/game/rust-fresh-runtime-migration-policy.ts";
import { WORLD_IMPORT_SOURCE_ARCHIVE_V1 } from "../app/game/world-import-source.ts";
import { encodeCanonicalWorldSaveValueV1 } from "../app/game/world-save-sharding.ts";
import { deriveWorldGenerationIdentityV1, migrateLegacyWorldSave, normalizeWorldOptions } from "../app/game/world-storage.ts";

type Fixture = {
  format: string; version: number; exportedAt: number; ownershipNotice: string;
  world: { version: number; metadata: Record<string, unknown>; options: Record<string, unknown>; save: Record<string, unknown> };
};
const encoder = new TextEncoder();
function fixture(version = 16): Fixture {
  const name = version === 16 ? "g16-omitted-settlement-pattern" : "g17-modern-control";
  return JSON.parse(readFileSync(new URL(`./fixtures/rust-engine/r3/historical-saves/${name}.blockwild.json`, import.meta.url), "utf8"));
}
function input(document = fixture(), raw = JSON.stringify(document)) {
  const sourceBytes = encoder.encode(raw);
  const rawSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const profile = createCharacterProfile("browser-policy", { id: "character-policy", name: "Policy fixture" }, 100);
  const normalizedSave = migrateLegacyWorldSave(fixture().world.save)!;
  const identity = deriveWorldGenerationIdentityV1(normalizedSave, normalizeWorldOptions(fixture().world.options));
  return {
    policyVersion: 1,
    originalSource: {
      schemaVersion: 1, provenance: "uploaded-file-bytes", sourceFormat: "blockwild-world-export-v1", encoding: "utf-8",
      archiveWorldId: WORLD_IMPORT_SOURCE_ARCHIVE_V1, objectId: `sha256-${rawSha256}`, rawSha256, byteLength: sourceBytes.byteLength,
    },
    sourceBytes,
    target: { catalogWorldId: "new-catalog-world", universeId: "world:new-catalog-world", locationId: "overworld", generatorHash: identity.generatorHash, contentHash: identity.terrainContentHash },
    actor: { profile, actorId: characterNetworkId(profile), commandActorId: "policy-reviewer" },
  };
}
function decision(proposal: FreshRuntimeMigrationProposalV1) {
  return {
    schemaVersion: 1, decision: "affirm-review-only", proposalHash: proposal.proposalHash,
    sourceRawSha256: proposal.source.reference.rawSha256, sourceByteLength: proposal.source.reference.byteLength,
    sourceSemanticHash: proposal.source.semanticHash, normalizedTargetSemanticHash: proposal.target.normalizedSemanticHash,
    target: proposal.target.address, actor: proposal.actor,
    acknowledgements: [...FRESH_RUNTIME_MIGRATION_ACKNOWLEDGEMENTS_V1],
  };
}
function hash(value: unknown) { return persistencePayloadHashV1(encodeCanonicalWorldSaveValueV1(value)); }

test("exact synthetic g16/g17 fixtures produce review-only terms, not native acceptance", async () => {
  for (const version of [16, 17]) {
    const source = fixture(version);
    const current = input(source);
    const proposal = await planRustFreshRuntimeMigrationV1(current);
    assert.equal(proposal.status, "review-only");
    assert.equal(proposal.sourceSubset, "g16-g17-builder-empty-custody-v1");
    assert.deepEqual(proposal.sourceBlockers, []);
    assert.equal(proposal.nativeExecutionAllowed, false);
    assert.deepEqual(proposal.source.document, source);
    assert.equal(proposal.source.semanticHash, hash(source));
    assert.equal(proposal.target.normalizedSemanticHash, hash(proposal.terms.normalizedTarget));
    assert.equal(proposal.terms.normalizedTarget?.options.settlementPattern, version === 16 ? "legacy-scattered-v1" : "heartlands-v2");
    assert.ok(proposal.nativeUnimplementedTerms.some(term => term.id === "day-time-weather-continuation"));
    assert.ok(proposal.nativeUnimplementedTerms.some(term => term.id === "saved-spawn-continuation"));
    assert.ok(proposal.nativeUnimplementedTerms.some(term => term.id === "runtime-options-continuation"));
    const recorded = await validateRustFreshRuntimeMigrationConsentV1(proposal, decision(proposal), current);
    assert.equal(recorded.status, "consent-record-only");
    assert.equal(recorded.nativeExecutionAllowed, false);
    assert.deepEqual(Object.keys(recorded).sort(), ["nativeExecutionAllowed", "policyVersion", "proposalHash", "status"]);
    assert.equal("intent" in proposal, false);
    assert.equal("nativeInitialization" in proposal, false);
    assert.equal("accepted" in recorded, false);
  }
});

test("complete finite f64 pose survives review without native f32 projection", async () => {
  const source = fixture();
  source.world.save.player = { x: 16_777_217.12345679, y: 40.51, z: -8.123456789, yaw: 0.123456789123, pitch: 0.234567891234 };
  source.world.save.spawn = { x: 16_777_217.12345679, y: 40.51, z: -8.123456789 };
  const proposal = await planRustFreshRuntimeMigrationV1(input(source));
  assert.deepEqual(proposal.sourceBlockers, []);
  assert.deepEqual(proposal.terms.normalizedTarget?.save.player, source.world.save.player);
  assert.deepEqual(proposal.terms.normalizedTarget?.save.spawn, source.world.save.spawn);
  assert.notEqual(Math.fround(40.51), proposal.terms.normalizedTarget?.save.player.y);
});

test("legacy health semantics preserve absent/present source and builder load behavior", async () => {
  for (const health of [undefined, 0, -5, 3.25, 100]) {
    const source = fixture();
    if (health === undefined) delete source.world.save.health; else source.world.save.health = health;
    const proposal = await planRustFreshRuntimeMigrationV1(input(source));
    assert.deepEqual(proposal.sourceBlockers, []);
    assert.equal(proposal.terms.legacyLoad?.health.sourcePresent, health !== undefined);
    assert.equal(proposal.terms.legacyLoad?.health.afterStorageNormalization, health === undefined ? 10 : Math.max(1, Math.min(10, health)));
    assert.equal(proposal.terms.legacyLoad?.health.afterBuilderLoad, 10);
    assert.equal(proposal.terms.legacyLoad?.explorationLevelWhenSourceAbsent, 0);
    assert.ok(proposal.terms.freshRuntimeDecisions.every(term => term.basis === "explicit-fresh-runtime-decision-not-source-continuity"));
  }
});

test("time/day/spawn/options and raw known fields are retained rather than erased or defaulted", async () => {
  const source = fixture(17);
  source.world.save.time = 0;
  source.world.save.day = 41;
  source.world.save.spawn = { x: -13.125, y: 19.75, z: 777.5 };
  source.world.options.dayLengthMinutes = 35;
  source.world.options.keepInventory = false;
  const proposal = await planRustFreshRuntimeMigrationV1(input(source));
  assert.deepEqual(proposal.sourceBlockers, []);
  assert.deepEqual(proposal.source.document, source);
  assert.equal(proposal.terms.normalizedTarget?.save.time, 0);
  assert.equal(proposal.terms.legacyLoad?.worldTime, ((0.32 % 1) + 1) % 1);
  assert.equal(proposal.terms.normalizedTarget?.save.day, 41);
  assert.equal(proposal.terms.normalizedTarget?.options.keepInventory, false);
});

test("raw byte identity remains distinct for BOM/CRLF/whitespace and equal JSON", async () => {
  const source = fixture();
  const plain = await planRustFreshRuntimeMigrationV1(input(source));
  const formatted = await planRustFreshRuntimeMigrationV1(input(source, `\ufeff${JSON.stringify(source, null, 2).replaceAll("\n", "\r\n")}\r\n`));
  assert.equal(plain.source.semanticHash, formatted.source.semanticHash);
  assert.equal(plain.target.normalizedSemanticHash, formatted.target.normalizedSemanticHash);
  assert.notEqual(plain.source.reference.rawSha256, formatted.source.reference.rawSha256);
  assert.notEqual(plain.proposalHash, formatted.proposalHash);
});

test("raw source hash, byte length, format, UTF8 and policy versions fail closed", async () => {
  const base = input();
  for (const changed of [
    { ...base, policyVersion: 2 }, { ...base, extra: true },
    { ...base, sourceBytes: Uint8Array.of(0xff) },
    { ...base, originalSource: { ...base.originalSource, byteLength: base.sourceBytes.byteLength - 1 } },
    { ...base, originalSource: { ...base.originalSource, provenance: "string-import" } },
    { ...base, originalSource: { ...base.originalSource, extra: true } },
    input(fixture(), "{not json}"), input(fixture(), '{"format":"other"}'),
  ]) await assert.rejects(() => planRustFreshRuntimeMigrationV1(changed));
  const corrupt = input(); corrupt.sourceBytes[10] ^= 1;
  await assert.rejects(() => planRustFreshRuntimeMigrationV1(corrupt));
});

test("unknown fields at every supported nested boundary block source consent", async () => {
  const variants: Array<(source: Fixture) => void> = [
    source => Object.assign(source, { unknown: 1 }),
    source => Object.assign(source.world, { importSource: {} }),
    source => { source.world.metadata.unknown = 1; },
    source => { source.world.options.unknown = 1; },
    source => { source.world.options.origin = { mode: "wilderness", extra: true }; },
    source => { source.world.save.unknown = 1; },
    source => { Object.assign(source.world.save.player as object, { velocity: 0 }); },
    source => { Object.assign(source.world.save.spawn as object, { worldId: "other" }); },
    source => { source.world.save.ownerActorId = "claimed-owner"; },
    source => { source.world.save.skillState = { schema: 3, skills: {} }; },
    source => { source.world.save.potionBuffs = {}; },
  ];
  for (const mutate of variants) {
    const source = fixture(); mutate(source);
    const current = input(source);
    const proposal = await planRustFreshRuntimeMigrationV1(current);
    assert.equal(proposal.sourceSubset, null);
    assert.ok(proposal.sourceBlockers.some(blocker => blocker.kind === "unknown-field"));
    assert.deepEqual(proposal.source.document, source);
    await assert.rejects(() => validateRustFreshRuntimeMigrationConsentV1(proposal, decision(proposal), current), /source/i);
  }
});

test("nonempty custody, unsupported progression/generator/mode and malformed edits never become fresh defaults", async () => {
  const changes: Record<string, unknown>[] = [
    { inventory: [{ item: 1, count: 1 }] }, { furnaces: { "0,0,0": {} } }, { chests: { "0,0,0": [] } },
    { xp: 1 }, { level: 1 }, { generatorVersion: 15 }, { generatorProfile: "legacy-v14" }, { mode: "survival" },
    { edits: { "-8,-1": [[1, 3, 99]] } }, { edits: { "-08,-1": [[1, 3]] } },
    { edits: { "0,0": [[1, 3], [1, 4]] } },
    { player: { x: 0, y: 0, z: 0, yaw: 0 } },
  ];
  for (const change of changes) {
    const source = fixture(); Object.assign(source.world.save, change);
    const proposal = await planRustFreshRuntimeMigrationV1(input(source));
    assert.ok(proposal.sourceBlockers.length > 0, JSON.stringify(change));
  }
});

test("profile canonical hash binds every real field without inventing a revision", async () => {
  const original = input();
  const first = await planRustFreshRuntimeMigrationV1(original);
  assert.equal(first.actor.profileId, original.actor.profile.id);
  assert.match(first.actor.profileCanonicalHash, /^[0-9a-f]{64}$/u);
  assert.equal("revision" in first.actor, false);
  assert.equal("profileRevision" in first.actor, false);
  for (const change of [
    { name: "Changed" }, { updatedAt: 101 },
    { appearance: { ...original.actor.profile.appearance, colors: { ...original.actor.profile.appearance.colors, shirt: "#123456" } } },
    { startingSkills: { ...original.actor.profile.startingSkills, exploration: 1 } },
  ]) {
    const next = input(); next.actor.profile = { ...next.actor.profile, ...change };
    const second = await planRustFreshRuntimeMigrationV1(next);
    assert.notEqual(first.actor.profileCanonicalHash, second.actor.profileCanonicalHash);
    await assert.rejects(() => validateRustFreshRuntimeMigrationConsentV1(first, decision(first), next));
  }
});

test("invalid profile fields, identity mismatch, and extra target authority claims reject", async () => {
  const base = input();
  for (const changed of [
    { ...base, actor: { ...base.actor, actorId: "someone-else" } },
    { ...base, actor: { ...base.actor, profile: { ...base.actor.profile, revision: 1 } } },
    { ...base, actor: { ...base.actor, profile: { ...base.actor.profile, appearance: { ...base.actor.profile.appearance, unknown: 1 } } } },
    { ...base, target: { ...base.target, fresh: true } },
    { ...base, target: { ...base.target, catalogWorldId: "" } },
    { ...base, target: { ...base.target, contentHash: "0".repeat(32) } },
  ]) await assert.rejects(() => planRustFreshRuntimeMigrationV1(changed));
});

test("consent binds exact catalog/universe/location/actor/policy/source and normalized terms", async () => {
  const current = input();
  const proposal = await planRustFreshRuntimeMigrationV1(current);
  const approval = decision(proposal);
  for (const key of ["catalogWorldId", "universeId", "locationId"] as const) {
    const next = input(); next.target[key] += "-changed";
    await assert.rejects(() => validateRustFreshRuntimeMigrationConsentV1(proposal, approval, next));
  }
  const next = input(); next.actor.commandActorId = "another-reviewer";
  await assert.rejects(() => validateRustFreshRuntimeMigrationConsentV1(proposal, approval, next));
  const sameMeaning = input(fixture(), JSON.stringify(fixture(), null, 2));
  await assert.rejects(() => validateRustFreshRuntimeMigrationConsentV1(proposal, approval, sameMeaning));
  for (const key of ["proposalHash", "sourceRawSha256", "sourceSemanticHash", "normalizedTargetSemanticHash"] as const) {
    await assert.rejects(() => validateRustFreshRuntimeMigrationConsentV1(proposal, { ...approval, [key]: "0".repeat(64) }, current));
  }
});

test("missing/declined/extra acknowledgements and execution flags cannot act as consent", async () => {
  const current = input(); const proposal = await planRustFreshRuntimeMigrationV1(current); const approval = decision(proposal);
  for (const value of [
    undefined, false, {}, { ...approval, decision: "decline" }, { ...approval, schemaVersion: 2 },
    { ...approval, sourceByteLength: approval.sourceByteLength + 1 },
    { ...approval, acknowledgements: approval.acknowledgements.slice(1) },
    { ...approval, acknowledgements: [...approval.acknowledgements, "execute"] },
    { ...approval, acknowledgements: [...approval.acknowledgements].reverse() },
    { ...approval, nativeExecutionAllowed: true },
  ]) await assert.rejects(() => validateRustFreshRuntimeMigrationConsentV1(proposal, value, current));
});

test("forged review terms or cleared native blockers fail despite copied proposal hash", async () => {
  const current = input(); const proposal = await planRustFreshRuntimeMigrationV1(current);
  for (const forged of [
    { ...proposal, nativeExecutionAllowed: true }, { ...proposal, nativeUnimplementedTerms: [] },
    { ...proposal, terms: { ...proposal.terms, freshRuntimeDecisions: [] } },
    { ...proposal, target: { ...proposal.target, normalizedSemanticHash: "0".repeat(32) } },
    { ...proposal, source: { ...proposal.source, document: fixture(17) } },
  ]) await assert.rejects(() => validateRustFreshRuntimeMigrationConsentV1(forged, decision(proposal), current));
});

test("planner snapshots caller bytes/reference/profile before asynchronous hashing", async () => {
  const current = input();
  const bytes = Uint8Array.from(current.sourceBytes);
  const expectedHash = current.originalSource.rawSha256;
  const pending = planRustFreshRuntimeMigrationV1(current);
  current.sourceBytes.fill(0);
  current.originalSource.rawSha256 = "0".repeat(64);
  current.actor.profile = { ...current.actor.profile, name: "Changed in flight" };
  const proposal = await pending;
  assert.equal(proposal.source.reference.rawSha256, expectedHash);
  assert.deepEqual(proposal.source.document, JSON.parse(new TextDecoder().decode(bytes)));
  assert.equal(proposal.actor.profileCanonicalHash, (await planRustFreshRuntimeMigrationV1(input())).actor.profileCanonicalHash);
  assert.ok(Object.isFrozen(proposal.terms.normalizedTarget?.save.player));
});

test("nonfinite decoded JSON and excessive nesting cannot be canonicalized into harmless defaults", async () => {
  const source = fixture();
  const invalid = JSON.stringify(source).replace('"x":-120', '"x":1e400');
  await assert.rejects(() => planRustFreshRuntimeMigrationV1(input(source, invalid)), /finite/i);
  let nested: unknown = 0; for (let depth = 0; depth < 80; depth += 1) nested = { nested };
  source.world.save.unknown = nested;
  await assert.rejects(() => planRustFreshRuntimeMigrationV1(input(source)), /bound|depth/i);
});

test("review does not consume random identity material and profile hash has a pinned independent encoding", async context => {
  const current = input();
  const random = context.mock.method(crypto, "randomUUID", () => { throw new Error("Review must not mint identity material"); });
  const proposal = await planRustFreshRuntimeMigrationV1(current);
  assert.equal(random.mock.callCount(), 0);
  const expected = createHash("sha256")
    .update("blockwild-character-profile-canonical-sha256-v1\0")
    .update(encodeCanonicalWorldSaveValueV1(current.actor.profile)).digest("hex");
  assert.equal(proposal.actor.profileCanonicalHash, expected);
});

test("policy input rejects accessors rather than allowing identities to change between reads", async () => {
  const current = input(); const actor = current.actor;
  Object.defineProperty(current, "actor", { enumerable: true, get: () => actor });
  await assert.rejects(() => planRustFreshRuntimeMigrationV1(current), /data|field|shape/i);
});

test("duplicate JSON property names cannot hide unknown or unsupported earlier source data", async () => {
  const source = fixture(); const raw = JSON.stringify(source);
  for (const duplicate of [
    raw.replace('"health":10', '"health":{"unknown":1},"health":10'),
    raw.replace('"inventory":[]', '"inventory":[{"item":1,"count":1}],"inventory":[]'),
    raw.replace('"yaw":0', '"yaw":1,"y\\u0061w":0'),
  ]) await assert.rejects(() => planRustFreshRuntimeMigrationV1(input(source, duplicate)), /duplicate/i);
});

test("every source property path including empty objects and array entries is inventoried", async () => {
  const source = fixture();
  const proposal = await planRustFreshRuntimeMigrationV1(input(source));
  function paths(value: unknown, path = ""): string[] {
    return [path, ...(value !== null && typeof value === "object" ? Object.entries(value).flatMap(([key, entry]) => paths(entry, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`)) : [])];
  }
  assert.deepEqual(proposal.terms.sourcePropertyPaths, paths(source));
  assert.ok(proposal.terms.sourcePropertyPaths.includes("/world/save/furnaces"));
  assert.ok(proposal.terms.sourcePropertyPaths.includes("/world/save/edits/-8,-1/0/1"));
});

test("exact review rejects f64 negative-zero substitution despite existing semantic zero normalization", async () => {
  const source = fixture();
  const raw = JSON.stringify(source).replaceAll('"x":-120', '"x":-0').replace('"yaw":0', '"yaw":-0').replace('"time":0.32', '"time":-0');
  const current = input(source, raw);
  const proposal = await planRustFreshRuntimeMigrationV1(current);
  const storedSource = proposal.source.document as Fixture;
  assert.ok(Object.is((storedSource.world.save.player as Record<string, unknown>).x, -0));
  assert.ok(Object.is((storedSource.world.save.spawn as Record<string, unknown>).x, -0));
  assert.ok(Object.is(storedSource.world.save.time, -0));
  assert.equal(proposal.source.semanticHash, hash(JSON.parse(JSON.stringify(storedSource))));
  for (const mutate of [
    (value: Fixture) => { (value.world.save.player as Record<string, unknown>).x = 0; },
    (value: Fixture) => { (value.world.save.player as Record<string, unknown>).yaw = 0; },
    (value: Fixture) => { (value.world.save.spawn as Record<string, unknown>).x = 0; },
    (value: Fixture) => { value.world.save.time = 0; },
  ]) {
    const forged = structuredClone(proposal); mutate(forged.source.document as Fixture);
    await assert.rejects(() => validateRustFreshRuntimeMigrationConsentV1(forged, decision(proposal), current), /proposal/i);
  }
});

test("inherited array map hooks cannot rewrite an invalid consent acknowledgement", async () => {
  const current = input(); const proposal = await planRustFreshRuntimeMigrationV1(current); const approval = decision(proposal);
  let calls = 0;
  const invalid = ["not-the-reviewed-acknowledgements"];
  Object.setPrototypeOf(invalid, Object.create(Array.prototype, {
    map: { get() { calls += 1; return () => [...FRESH_RUNTIME_MIGRATION_ACKNOWLEDGEMENTS_V1]; } },
  }));
  await assert.rejects(() => validateRustFreshRuntimeMigrationConsentV1(proposal, { ...approval, acknowledgements: invalid }, current), /array|prototype|JSON/i);
  assert.equal(calls, 0);
});

test("byte snapshots neither invoke getters/iterators nor accept shared/subclass storage", async () => {
  for (const property of ["byteLength", "buffer", "byteOffset", Symbol.iterator]) {
    const current = input(); let calls = 0;
    Object.defineProperty(current.sourceBytes, property, { get() { calls += 1; throw new Error("untrusted byte hook"); } });
    await assert.rejects(() => planRustFreshRuntimeMigrationV1(current), /byte|shape|hook/i);
    assert.equal(calls, 0);
  }
  const original = input();
  class ByteSubclass extends Uint8Array {}
  await assert.rejects(() => planRustFreshRuntimeMigrationV1({ ...original, sourceBytes: new ByteSubclass(original.sourceBytes) }), /byte|prototype/i);
  const shared = new Uint8Array(new SharedArrayBuffer(original.sourceBytes.byteLength)); shared.set(original.sourceBytes);
  await assert.rejects(() => planRustFreshRuntimeMigrationV1({ ...original, sourceBytes: shared }), /shared|buffer/i);
  const backing = new Uint8Array(original.sourceBytes.length + 12); backing.set(original.sourceBytes, 5);
  const view = backing.subarray(5, 5 + original.sourceBytes.length);
  assert.deepEqual((await planRustFreshRuntimeMigrationV1({ ...original, sourceBytes: view })).source.document, fixture());
});
