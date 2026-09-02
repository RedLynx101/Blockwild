# Fresh-runtime review: maintainer guide

This is source preservation and a pure review/consent contract—not native migration, execution permission, historical ownership proof, or an accepted save conversion. Both proposal and consent record have `nativeExecutionAllowed: false`. No consent UI or native adoption executor is connected.

Implementation: [source archive](../app/game/world-import-source.ts), [storage lifecycle](../app/game/world-storage.ts), [IndexedDB adapter](../app/game/indexeddb-persistence-adapter.ts), and [review policy](../app/game/rust-fresh-runtime-migration-policy.ts). Do not weaken the existing [world-only migration guard](../app/game/rust-legacy-world-migration.ts) or [rich-player compatibility checks](../app/game/rust-player-bootstrap-compatibility.ts).

## Preserve the original file first

The public [file-import handler](../app/game/VoxelGame.tsx) checks size before `File.arrayBuffer()`, then calls `WorldStorage.importWorldBytes(new Uint8Array(buffer))`. The accepted byte envelope is nonempty UTF-8 JSON, at most 64 MiB, with a version-one Blockwild export/world envelope. UTF-8 decoding is fatal; a leading BOM is accepted but retained in the archived bytes, along with whitespace, CRLF, Unicode, and unknown properties.

`preserveWorldImportSourceV1` writes immutable, content-addressed 4 MiB chunks through the existing `preserve-legacy-backup-chunk` operation. Its separate namespace is `blockwild-original-import-sources-v1`; it does not create a native or compatibility checkpoint. Complete contiguous readback, chunk integrity, whole-file SHA-256, and exact byte equality must pass before storage normalizes and publishes the catalog document. Archive success alone does not establish semantic eligibility.

Quota, conflict, corrupt readback, disposal, and catalog-publication failures must not report success. Retained archive chunks are not discarded on these failures; identical retries are supported. The trusted `StoredWorld.importSource` reference survives ordinary saves/reloads. `readOriginalImportedWorldSource(id)` retrieves original bytes without requiring the current normalized save to remain loadable.

`importWorld(json: string)` remains a decoded-text compatibility API: it cannot claim original-file provenance. A reference supplied inside an imported export does not grant provenance, and older imports are not retroactively attested. Archive references/hashes prove neither user ownership nor the truth of source contents.

## What policy V1 recognizes

Policy ID: `blockwild-fresh-runtime-review-g16-g17-builder-v1`.

The closed source subset is the shape exercised by the [g16 fixture](../tests/fixtures/rust-engine/r3/historical-saves/g16-omitted-settlement-pattern.blockwild.json) and [g17 fixture](../tests/fixtures/rust-engine/r3/historical-saves/g17-modern-control.blockwild.json). These are synthetic historical-format fixtures, not archived user saves.

- Export/world version 1; save version 2; source generator 16 or 17; `world-below-v15`; builder mode; metadata generation identity `null`.
- Complete finite-f64 player `{x,y,z,yaw,pitch}` and spawn `{x,y,z}`; canonical in-range, nonduplicate edit pairs; required known metadata/options/save fields.
- Exactly empty `inventory: []`, `furnaces: {}`, and `chests: {}`; `xp` and `level` zero; selected slot 0–8; wilderness origin. Health may be absent. The five settlement-option fields are optional; other option fields are required.
- Unknown fields—including nested fields—and unsupported/nonempty custody are source blockers. There is no generic extension-tree allowance. Duplicate JSON keys are rejected, including escaped spellings of the same key.

`sourceBlockers` distinguishes unknown fields, unsupported values, and missing required data. `nativeUnimplementedTerms` is different: recognized day/time/weather, spawn, options, pose, empty custody, vitals/progression, and fresh-actor terms still await native support. Consent cannot waive source blockers or remove these native prerequisites.

The complete source document and its exhaustive JSON-pointer inventory remain in the proposal. Normalized review data uses the existing storage migration: source g16 forces `legacy-scattered-v1`; source g17 retains its modern option selection; the target uses the current generator version, presently g18. This does not execute historical generator binaries. Catalog timestamps and a new import fingerprint are not invented as part of the normalized semantic payload.

## Identity and exact-value rules

| Field | Width and meaning |
| --- | --- |
| `source.reference.rawSha256` | 32-byte SHA-256 / 64 hex characters over the complete original file; bound with its byte length. |
| `source.semanticHash` | Existing 16-byte / 32-hex `persistencePayloadHashV1` over canonical full, unnormalized export JSON. |
| `target.normalizedSemanticHash` | The same 16-byte hash over `{save, options, generationIdentity}`. Generator/content identities are also 16-byte semantic hashes. |
| `actor.profileCanonicalHash` | 32-byte SHA-256 over `blockwild-character-profile-canonical-sha256-v1`, NUL, then exact-review canonical JSON of the complete profile. Includes both timestamps; the profile model has no revision counter. |
| `proposalHash` | 32-byte SHA-256 over `blockwild-fresh-runtime-migration-proposal-sha256-v1`, NUL, then the complete canonical proposal body excluding `proposalHash`. |

Exact-review JSON sorts object keys ordinally and preserves finite number `-0` literally. Existing semantic hashes intentionally retain their established `-0` → `+0` convention; they are not substitutes for exact review equality. No R6/f32 projection is used. A copied proposal hash cannot authorize changing a reviewed f64 sign bit or other term.

Keep the source, storage normalization, and actual legacy load distinct. For example, source and normalized `time: 0` remain visible, while the existing engine load uses the `0.32` fallback and then `(((Number(time) || 0.32) % 1) + 1) % 1`. The resulting f64 is recorded in `terms.legacyLoad.worldTime`, not silently substituted for either earlier stage. Source pitch can likewise differ from storage's clamped pitch. Health records source presence, storage's default/clamp, and builder load's value 10. Absent `skillState` uses the existing legacy zero exploration level, not the selected profile's starting allocation. See [storage migration](../app/game/world-storage.ts), [engine load](../app/game/engine.ts), and [skill normalization](../app/game/skills.ts).

The four explicit fresh decisions are: bind the selected actor without claiming historical ownership; begin at rest without restoring velocity; recompute grounded contact without a historical assertion; begin session age at zero without claiming historical age. They are labeled decisions—not recovered source facts or native initialization objects.

## Proposal and consent APIs

The following integration sketch assumes caller-selected `target`, `selectedProfile`, and `commandActorId`; it does not infer those choices. Imports are from the linked policy, storage, and [character-profile module](../app/game/character-profiles.ts).

```ts
const stored = storage.loadWorld(target.catalogWorldId, false);
if (!stored.ok) throw new Error(stored.error.message);
if (!stored.value.importSource) throw new Error("No original-file provenance");
const original = await storage.readOriginalImportedWorldSource(target.catalogWorldId);
if (!original.ok) throw new Error(original.error.message);

const input: FreshRuntimeMigrationInputV1 = {
  policyVersion: 1,
  originalSource: stored.value.importSource,
  sourceBytes: original.value,
  target, // catalogWorldId + universeId + locationId + generatorHash + contentHash
  actor: {
    profile: selectedProfile,
    actorId: characterNetworkId(selectedProfile),
    commandActorId,
  },
};
const proposal = await planRustFreshRuntimeMigrationV1(input);
if (proposal.sourceBlockers.length || !proposal.target.normalizedSemanticHash) {
  throw new Error("Source is outside this review policy");
}

// Only after an explicit user affirmation of this exact review—not on import.
const decision: FreshRuntimeMigrationConsentDecisionV1 = {
  schemaVersion: 1, decision: "affirm-review-only",
  proposalHash: proposal.proposalHash,
  sourceRawSha256: proposal.source.reference.rawSha256,
  sourceByteLength: proposal.source.reference.byteLength,
  sourceSemanticHash: proposal.source.semanticHash,
  normalizedTargetSemanticHash: proposal.target.normalizedSemanticHash,
  target: proposal.target.address, actor: proposal.actor,
  acknowledgements: FRESH_RUNTIME_MIGRATION_ACKNOWLEDGEMENTS_V1,
};
// Re-read archive/profile/target bindings before this call; do not reuse stale input.
const record = await validateRustFreshRuntimeMigrationConsentV1(
  proposal, decision, freshlyReadInput,
);
// record.status === "consent-record-only"; record.nativeExecutionAllowed === false
```

The validator rebuilds the proposal from current inputs and compares the complete exact body plus every decision binding/ordered acknowledgement. Missing, declined, forged, or stale consent rejects. It returns only the review record, not an execution capability. This reviews the original upload, not subsequent edits to its catalog world; binding a catalog ID does not prove that catalog/native state is still an eligible target.

## Bounds and future execution

Policy JSON is bounded to depth 64 and 100,000 visited nodes per snapshot. Inputs must have plain, enumerable data fields and dense ordinary arrays; accessors, cycles, nonfinite values, and custom array prototypes reject. Byte input must be an ordinary `Uint8Array` over a fixed ordinary `ArrayBuffer`; offset views work, shared/resizable storage and access/iterator overrides do not. Intrinsic getters and non-iterating copies snapshot bytes before awaits without enumerating millions of byte indices. Caller reference/profile/target mutations cannot switch the reviewed identity mid-hash. Profile review does not generate random IDs.

Before any independent future executor can accept migration, it must:

1. Re-read and verify the retained original source and all selected bindings; obtain actual user consent for this source, target, actor, and stated decisions.
2. Independently prove fresh native target state and enforce catalog/native revision or compare-and-swap guards. A caller's `fresh: true` is not evidence.
3. Implement lossless typed adoption for every required domain, with explicit source/normalized/legacy-load behavior, full f64 pose, and no fabricated historical owner or omitted durable state.
4. Prove exact native readback, durable checkpoint/hydration, rollback on failure, and original-source survival before publishing migration success. Verify real save/reload/Continue behavior separately.

Do not route a historical save through the new-world bootstrap, strip unsupported fields, prepopulate a supposedly fresh native target, or relax existing world-only/player guards to satisfy these requirements. This guide makes no R3/R8 promotion claim.

## Checks

Run the focused deterministic checks from the repository root:

```powershell
node --import tsx --test tests/world-import-source.test.ts tests/rust-fresh-runtime-migration-policy.test.ts
```

[Policy regressions](../tests/rust-fresh-runtime-migration-policy.test.ts) cover binding, exact values, unsupported fields, and caller hooks. [Archive regressions](../tests/world-import-source.test.ts) cover source retention, readback, failure/retry, and lifecycle. The separate [real IndexedDB test](../tests/rust-indexeddb-browser.test.mjs) exercises browser persistence; a missing-runtime skip is not browser verification. None of these checks alone proves native migration acceptance.
