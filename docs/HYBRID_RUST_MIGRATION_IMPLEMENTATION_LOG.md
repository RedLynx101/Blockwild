# Hybrid Rust Migration Implementation Log

This is the execution companion to [HYBRID_RUST_ENGINE_MIGRATION_MASTER_PLAN.md](./HYBRID_RUST_ENGINE_MIGRATION_MASTER_PLAN.md). It records evidence, authority state, and design changes discovered during implementation. A native crate or passing fixture is not called production authority until its browser worker, persistence, rollback, and visual gates pass.

## Evidence baseline

- Baseline source: `work/hybrid-rust-migration/performance/before-summary.json`
- Five-run, ten-scenario p95 geometric mean: **5.0025106503 ms**
- This is the retained historical baseline. The 2026-09-02 evaluator now requires explicit backend identity and non-vacuous generation/readiness checkpoints; re-measure a matching baseline rather than retrospectively adding those fields to the older summary.
- Required final comparison: same evaluator, hardware, settings, randomized/interleaved repetitions, all correctness guardrails, normalized aggregate no worse than `0.9925`, and no scenario above `1.05x` without an explicit reviewed architectural tradeoff.
- Visual oracle: Three.js canonical fixtures and manually reviewed R0/R2 captures. SwiftShader timing is capability/visual evidence only, never hardware-performance evidence.
- Completion auditor: `node scripts/audit-rust-migration.mjs` produces the machine-readable R12 blocker inventory. Its first run intentionally reports 32 unchecked definition-of-done items, 32 unpromoted authority rows, 21 normal-path Three.js imports, six missing integrated-runtime Wasm exports, and nine open implementation gates. `--strict` becomes a release gate only after those counts reach zero; changing the auditor to hide a blocker is not a valid implementation.

## Validated checkpoints

### Preserve required startup mesh progress - 2026-09-02

Real lighting completion previously could discard a partially built, occupied
section needed by the current 3x3 ring in favor of nearer deep or already-built
background work. The new guard preserves its existing geometry buckets and
bounded slice progress while the occupied player chunk is ready. Missing
player-chunk sections, protected edits, required seam dependencies and runnable
higher-priority required neighbors retain preemption. The additional priority
check visits only the nine-chunk correctness ring and at most two required
sections per chunk; it does not scan the background queues or change budgets.

The new 29-case regression file exercises actual partial geometry and real
lighting-completion dispatch, including repeated arrivals, priority competition,
stale work and urgent edits. Initial preservation cases and two review-added
priority regressions failed before their respective fixes. The focused combined
matrix passes 145/145, with scoped lint and independent review. The two-file
code/test snapshot is tree `00d29837361b8d0cedebae6c8aefacb799a9f7e3` in
extraction 9, archive SHA-256
`64d6c6953a765563f1b091210fbcdf1e08e4a5105195cb0cee2ad606584eb85a`.
The isolated snapshot passes 254 world regressions, 2,047 migration tests with
zero failures and two existing skips, and full TypeScript. Report:
`work/hybrid-rust-migration/checkpoint-c7-extracted-20260902-9-validation.json`.
Browser diagnostic 10 subsequently passes both measured lanes and the separate
skill client: each covers 155 exact generation cases and all five continuous
420-tick movement traces, with zero readiness failures. All three screenshots
were manually reviewed. Browser/context/server closure, six-world disposal,
worker disposal, source/artifact immutability and mutex release pass. Evidence:
extraction 9's
`work/hybrid-rust-migration/r3-performance-streaming-admission-20260902-diagnostic-10/`.

Within this single matched pair, initialized accepted-chunk p95 is 212.295 ms
TypeScript versus 161.755 ms Rust (0.761935x); reset-to-accepted p95 is 212.555
versus 178.380 ms (0.839218x). All four strata for both metrics pass the 1.05x
regression guard. Initial drawable latency ratios across POI, ocean horizon,
ocean flora, cave and biome transition are 0.704964, 0.830344, 0.772514,
0.742577 and 0.964039; these are single startup latencies, not p95. World-update
p95 ratios are 0.888272, 0.899856, 0.897989, 0.908156 and 0.971684. This is
successful one-pair subsystem diagnostic evidence, not the required repeated
performance acceptance, full-game acceptance, causal attribution to one fix,
or formal authority promotion. Native exact-state work remains excluded.

### Predictive generation admission - 2026-09-02

The ordinary Rust generation lane can now use a spare worker for a queued,
missing predicted-ring chunk when the current ring is already drawable. This
waives only the far-work presentation-debt veto: completed-result installation,
current-ring work, the last reserved worker slot and frame budgets are
unchanged. Selection scans the existing deterministic queue; stopped/reversed
movement and nonpredicted candidates do not inherit stale priority. If a real
pipeline task-ID rollover rejects submission, only this new middle-selection
path re-sorts its returned candidate.

Fourteen regression cases exercise the real pipeline/admission/lighting path,
including negative-coordinate movement before crossing, background debt,
incomplete current rings, reserved slots, completion priority and rejected
submission. Initial tests exposed four admission failures; the rejection-order
case independently failed before its correction. Final focused matrix is
104/104, scoped lint and independent review pass. Browser readiness/timing and
the combined isolated TypeScript/migration suite remain separate gates.

The combined seven-file code/guide tranche was subsequently isolated as tree
`b574670b3cb6586818e24ab8fdd31cd766bfa1ae` in extraction 8. It passes 254
world regressions, 2,018 migration tests with zero failures and two existing
skips, and full TypeScript. Archive SHA-256 is
`ff7a9c77eb3ea5097e38d2cefa78c2ce4de26b0929701c077d26da4a1a2394e6`;
report: `work/hybrid-rust-migration/checkpoint-c7-extracted-20260902-8-validation.json`.
Only this log is updated after extraction to record these results and correct
the single-startup-latency label in diagnostic 9; code/tests are unchanged.
The native continuation codec remains outside this tranche, preserving the
isolated C7 artifact/source identity. No live performance claim is added.

### Explicit fresh-runtime review policy - 2026-09-02

The new pure policy recognizes only the synthetic g16/g17 builder, empty-custody
source subset. It retains the full original source and property inventory,
separately records storage-normalized and actual legacy-load terms, and binds
the selected target and complete character profile. Exact-review SHA-256 and
equality preserve finite f64 values including negative zero; established
16-byte semantic hashes retain their existing encoding. Midnight's legacy
fallback, builder health and absent skill state are explicit review terms,
not inferred historical continuity.

Consent rederives the current proposal and requires every exact binding and
ordered acknowledgement. Unknown/unsupported source fields, duplicate JSON
keys, changed bytes/profile/target, copied-hash term changes, accessors and
caller array/byte hooks fail closed. Review does not mint random identity
material. Twenty-two focused regressions, scoped lint, targeted strict
TypeScript and independent review pass. The new
[maintainer guide](./RUST_FRESH_RUNTIME_REVIEW.md) explains the bounded API and
future executor prerequisites.

Both proposal and record remain review-only with `nativeExecutionAllowed: false`.
No UI, native executor, checkpoint adoption, ownership attestation or
existing guard relaxation is included. This does not close historical-save
migration or increase formal acceptance.

### Code-cache diagnostic 9: improved, not accepted - 2026-09-02

The one-pair run from isolated tree `7c493afbc56470c4a1631cddaaf433216ba761e0`
at extraction 7's
`work/hybrid-rust-migration/r3-performance-code-cache-20260902-diagnostic-9/`
passes both measured lanes' 155 exact generation cases and five continuous
420-tick movement traces. The separate skill client fails one POI readiness
callback; its other four traces have zero misses. All three screenshots were
manually reviewed. Browser/server/world/worker cleanup, source/artifact
immutability and mutex release pass. This is a failed diagnostic, not an
accepted benchmark or authority promotion.

Initialized generation p95 is 185.325 ms TypeScript versus 181.515 ms Rust
(0.979442x); all initialized strata pass the 1.05x guard. Reset-to-accepted p95
is still 185.510 versus 210.710 ms (1.135842x), with named and generic strata
also failing. Four landscapes improve initial drawable latency, but the cave is
1,119.940 versus 1,227.055 ms (1.095644x). Each initial drawable value is one
startup latency per lane, not a p95 statistic. Update p95 improves in all five
landscapes. A single pair cannot establish an accepted performance gain.

Measured Rust code delivery is one glue file and six Wasm files across six
pipeline instances, totaling 44,299,249 bytes. Diagnostic 8 delivered 483 of
each, totaling 3,579,087,150 bytes. The new cache removes repeated per-worker
delivery within each pipeline; it deliberately does not share mutable native
state or retain a process-global module across disposed worlds.

The remaining callback crosses from player chunk `-7,-1` to `-6,-1`; chunks
`-5,-2` and `-5,-1` are absent. Before crossing, both workers are idle and the
current ring is drawable, but background mesh debt makes ordinary distance-2
generation ineligible. Lookahead changes queue order without overriding this
admission rule. A bounded predictive-generation fix is being validated
separately; it is not part of this frozen checkpoint.

### Verified code reuse and original import-byte archive - 2026-09-02

Committed as `fca0b9c929ee7ce0db67c6f13943e0b80cd32a70` after the isolated
checks below, without including the later policy, continuation codec or
predictive-generation admission changes.

The pipeline now retains verified immutable glue bytes and a compiled Wasm
module across worker resets. The mutable selector and manifest are resolved
once per lifecycle epoch; each worker still receives a fresh Blob namespace,
Wasm instance/memory, native generation/locator certificates, and slot-bound
ready acknowledgement. File byte lengths and SHA-256 are checked before code
execution. Disposal, failed acquisition and LRU eviction release owned entries;
the two-entry default bounds retained code, not peak concurrent acquisition or
unabortable compilation. See [the code-cache guide](./RUST_ENGINE_CODE_CACHE.md).

Review found and repaired two asynchronous races: caller mutation during
prepared-code verification, and a live replacement being stranded by an
ordinary seed/options request-epoch change. Invalid bootstrap is terminal;
default browser workers cannot bypass verification via a test authority label.
The 86-test focused cache/loader/pipeline/worker/verifier set and independent
review pass. No native code or published engine bytes changed in this checkpoint.

Public file import now archives the exact uploaded UTF-8 bytes, including BOM,
whitespace and unknown source fields, before normalized catalog publication.
Files are capped at 64 MiB before allocation. Immutable 4 MiB chunks in a separate
archive namespace receive contiguous complete readback and raw SHA-256
verification; byte-distinct equal JSON has distinct raw identities. Failure,
quota, corruption and disposal cannot publish an unverified import or delete
its retained source. The decoded-string API cannot claim original-file
provenance. References survive save/reload, and source recovery does not require
the normalized save to remain semantically loadable. Existing native adoption
and world-only refusal rules are unchanged.

The archive has 87 passing related tests, including snapshot-race regressions.
The real Chromium IndexedDB test also passes two-chunk reopen/retry and
corrupt/missing/reordered-chunk negatives, with its preexisting quota checks
unchanged. The successful archive phase runs before the restrictive quota
fixture. This is source preservation, not historical native migration.

Combined isolated tree `7c493afbc56470c4a1631cddaaf433216ba761e0` passes 254
world/terrain regressions, the expanded 1,984-test migration suite (1,982 passed,
two existing skips), and TypeScript. Standard discovery now includes the
production terrain/streaming/source-import regressions; the independent release
auditor expects the same complete set. Extraction 7's archive SHA-256 is
`4d01dac978f0b9910f50b994e72536e0ea4ae9263f5cb0b571b34d4607507ce6`.

The actual-worker browser gate under that extraction's
`work/hybrid-rust-migration/browser/r3-production-worker-code-cache-20260902-1/`
passes 465 exact comparisons, 4,650 streams, 741 POI rows and seven lifecycle
checks. Five fresh workers share exactly one glue delivery, one Wasm delivery
and one compilation (7,409,399 verified bytes). Reset resolves selector/manifest
again without refetching code; crash replacement reuses the prepared module.
All five workers terminate, retained entries/pending work reach zero, and
source/artifact/server/client/mutex cleanup passes. The screenshot was manually
reviewed. This proves reuse and correctness, not an accepted speedup; the
matched timing gate remains separate.

The same isolated tree also passes the full-game trusted edit/save/reload gate
at extraction 7's `work/edit-gate-3/`: Sunstep Grass at `(4,43,-3)` becomes Air,
and full reload/Continue retains the exact edit SHA-256
`bf1440d65e21624215279e72bc27b0b2d2cd94d6074388ed77faede401415f2b`.
All seven screenshots were manually reviewed; error streams are empty and all
owned process/profile/server/mutex cleanup passes. The existing sparse title
backdrop after reload remains a visual-closure caveat, not a new claimed pass.
Two earlier attempts at longer nested output paths aborted the local Workers
runtime before browser startup, including one outside the sandbox. Shortening
only the output path let the unchanged extraction pass; the failed evidence is
retained. No production config or gameplay guard was weakened to run it.

### Predictive mesh progress survives lighting completion - 2026-09-02

Committed `2690b7c35a416b3578c0ca1065d5565e14279d61` preserves useful partial
predicted-ring mesh work when lighting completion queues already-built or deep
current-chunk sections. Missing immediate-ring sections and explicitly owned
player edits still preempt; stopped/reversed predictions are not protected.
The existing discretionary budget, current-ring reserve, generation, lighting,
rotation and production replay clock are unchanged.

The real bounded lighting-completion path has twelve new regressions. The
isolated two-file staged tree `820e211e68860e01f456eb73ae48fe98233f03fe` passes
254 world/terrain regressions, the 1,808-test Rust/renderer/R3 matrix
(1,806 passed, two existing skips), and full TypeScript. The first extraction
exposed test-only TypeScript narrowing errors; they were corrected before a
fresh complete rerun. Both attempts remain recorded. Final report:
`work/hybrid-rust-migration/checkpoint-c7-extracted-20260902-6-validation.json`;
archive SHA-256:
`fb3a2a19784eb3736b1e501808ad025291dbb209133d23075fdd791aea669451`.
Native source `e4fcec5a`/222 files and canonical `c7bfb66c` are unchanged.
Browser readiness/performance acceptance is still pending; this checkpoint
does not increase formal migration acceptance or retire the rollback path.

### Validated hash fast path and diagnostic 8 - 2026-09-02

The canonical byte hasher now uses four unsigned 32-bit words for the same two
modulo-2^64 lanes. Exact carry arithmetic replaces the per-byte BigInt products;
all public writers, scalar coercions, raw-versus-bulk high-lane distinction,
little-endian output, schema constants and seven validation boundaries remain.
The independent old BigInt helper was frozen from checkpoint `3775d22` before
editing. Ten new differential tests, an 89-test relevant matrix including all
155 canonical Wasm cases, TypeScript, lint and two independent reviews pass.
The final full 170-file Rust/renderer/R3 matrix passes 1,806 tests with zero
failures and two existing skips; a separate full TypeScript check also passes.
Retained output: `work/hybrid-rust-migration/r3-followup-20260902-matrix.log`.

The actual production-worker browser rerun also passes 465 exact comparisons,
4,650 streams, 741 POI rows and all six lifecycle checks, with all five workers
terminated. Its screenshot was manually reviewed. Source/artifact, process,
server and mutex cleanup pass. Evidence:
`work/hybrid-rust-migration/browser/r3-production-worker-c7bfb66c-20260902-limb-1/`.

The full-game follow-up at
`work/hybrid-rust-migration/browser/terrain-edit-c7bfb66c-20260902-limb-1/` passes
all 12 checks. Trusted input removes Sunstep Grass at `(4,43,-3)`; Save & Quit,
full reload and Continue preserve the exact Air edit and canonical edit SHA-256
`bf1440d65e21624215279e72bc27b0b2d2cd94d6074388ed77faede401415f2b`.
All seven screenshots were manually reviewed and all error/cleanup gates pass.
The post-reload title menu is legible, but its terrain backdrop is sparse; the
pre-optimization reference has the same gap (an entirely empty backdrop in that
capture). This is a retained full-scene visual closure item, not a newly verified
complete title-world render. The edit/reload gate proves its stated menu,
current-ring and edit-persistence boundaries only.

Diagnostic 8 passes both measured 155-case/five-trace lanes with zero readiness
failures. In this single pair, initialized accepted-chunk p95 is 222.930 ms
TypeScript versus 207.385 ms Rust (0.930x); streaming update p95 is 3.5-13.2%
lower across the five landscapes. Initial drawable ratios are
0.895/0.904/0.854/1.075/1.040. These results remain diagnostic: named-terrain
initialized p95 regresses 1.103x, reset-to-accepted p95 regresses 1.425x, and
the separate installed game-development client fails readiness 81/24/48/37/65
times. All five first failures occur at callback 123 / movement tick 121: the
leading chunks are present and lit, but required local sections are not built.
The post-run bounded failure projection now preserves that direct evidence
without adding measured-loop work. It has 88 passing focused tests.

All three diagnostic screenshots were manually reviewed and source/artifact
and mutex guards pass. Overall performance is not accepted; five-pair acceptance
is deferred until the meshing delay and cold-start regressions are repaired.
Evidence: `work/hybrid-rust-migration/r3-performance-c7bfb66c-20260902-diagnostic-8/`.

### Live edit-halo cache rejection - 2026-09-02

The extended real-browser cache gate passes all three fresh same-origin pages at
`work/hybrid-rust-migration/r3-persistent-cache/c7bfb66c-20260902-edit-halo-1/`.
The original cold-generation/eviction and persistent-restore assertions remain
unchanged. In the third phase, ordinary `setBlock` records the independently
verified Air-to-Stone edit at east-neighbor cell index 49024. The target's halo
slot changes to `1p5m1sk`; production reads the new namespace and misses before
any target generation or world update, while two audit reads prove the old
persisted record remains present and unchanged.

The target and edited neighbor then generate once with their exact namespaces
and edit payload. Both full pre-update outputs match independent Node oracles;
all immutable streams, three target POIs and the edited block survive normal
drawable readiness. Natural 15-chunk travel unloads the target after its actual
lease expires, and post-disposal readback proves the replacement was committed
under the changed namespace. Other near-ring chunks legitimately produced three
persistent hits; target-specific reads prove the required miss without falsifying
global counters. Target immutable bytes may equal the old record: namespace
exclusion, not fabricated byte inequality, is the acceptance condition.

All 79 verifier tests, TypeScript, lint and independent review pass. Cold,
restore, edit-halo and skill-idle screenshots were manually reviewed. Native,
browser-source and canonical artifact guards, empty browser-error evidence, and
all world/worker/observer/transaction/connection/browser/server/mutex cleanup
checks pass. This closes the live edit-halo cache prerequisite, not R4/R8
authority, stale-inflight-response handling, performance or full R3 promotion.

### Startup backpressure and diagnostic 7 - 2026-09-02

The post-checkpoint Rust scheduler now defers only new ordinary generation
submissions outside the actual current 3x3 until its occupied local sections
are lit and meshed. Completed responses, pending jobs and explicit distant
residency requests remain serviceable; TypeScript rollback and all work budgets
are unchanged. Nine targeted regressions, the 237-test broader suite, TypeScript,
lint and independent review pass. This change is not yet a performance acceptance.

Startup timing now settles two strictly advancing rAF callbacks before resetting
the world and starting its observer. This removes a stale pre-corpus timestamp
without hiding any actual reset stall. The explicit policy marker prevents older
measurements from being silently combined; 84 clock/runner/verifier tests pass.
Serialized reset-to-drawable remains a subsystem timing, not whole-game startup.

Diagnostic 7 passes all 155 exact cases and all five strict movement traces in
each measured lane, but the separate installed game-development client reports
1/0/17/15/0 readiness failures. The overall diagnostic therefore fails. All three
screenshots were manually reviewed; measured browser errors are empty, both
lanes dispose all six worlds and their workers, and browser/server/mutex and
source/artifact cleanup pass. Evidence is retained at
`work/hybrid-rust-migration/r3-performance-c7bfb66c-20260902-diagnostic-7/`.

Rust initial drawable latency is 1.195-1.347 seconds, lower than diagnostic 6
across runs, but four of five within-pair landscape comparisons still exceed
the 5% regression floor. Complete-corpus initialized accepted-chunk p95 is
242.920 ms TypeScript versus 278.830 ms Rust (1.148x); reset-to-accepted is
243.115 versus 396.120 ms (1.629x). These are single-pair diagnostics, not an
accepted repeated speedup. The next implementation work optimizes the existing
byte hasher without removing validation and retains bounded first-failure
readiness details from the separate client's existing trace records.

### Cumulative checkpoint extraction repairs - 2026-09-02

Closed as local commit `3775d22f0bf4780e555b752f137b30ddf041c37b`, exact tree
`6fedc8a071a16bdc0f2e6d4ecf5396a3aaa9b1e0`, with 422 reviewed paths. Fresh
extraction 4 passes native source/publication checks, 1,739 tests with zero
failures and two existing skips (169 discovered files), and TypeScript. The
retained archive SHA-256 is
`8433eb8616d0a7788a4a8cc315355853d7ad16afdddec37c306c3bc751471285`.
The third extraction had one final candidate-dependent CLI test failure; that
test now creates its existing complete isolated fixture instead of relying on
an ignored candidate in the actual repository. All earlier failures remain
retained. Ongoing startup and cache work is outside this commit; no push,
deployment, formal milestone or performance acceptance is claimed.

The first extracted staged tree exposed published-artifact line-ending drift:
staged blobs and generated working files match byte-for-byte, but Git archive
with `core.autocrlf=true` changes the glue, declarations and manifests to CRLF.
Native source identity still matches `e4fcec5a` / 222 files. A real isolated
checkout/archive regression reproduces both failures. The narrow
`public/engine/** -text` rule preserves exact published bytes without changing
native sources or relaxing manifest checksums. The failed extraction is retained
at `work/hybrid-rust-migration/checkpoint-c7-extracted-20260902/`.

The five existing deletions of superseded compatibility package `9ec2739c` must
accompany the index replacement with `c7bfb66c`. Independent review confirmed
that excluding those deletions restores an unreferenced directory, which the
unchanged publication validator correctly rejects. Renderer-lab `1868468d`
remains selected and preserved; TypeScript rollback code remains present.

Test discovery now includes Rust, renderer and R3 families, and integrated-runtime
capability tests default to the canonical package instead of requiring an ignored
candidate directory. The first expanded working-tree matrix had 1,733 passes,
one failure and two skips: the auditor expected the old discovery source pattern.
The repaired auditor checks the runner's actual filename/argument behavior via
an injected non-spawning recorder; all 30 focused audit/discovery tests pass and
independent review found no issue. No formal milestone or performance gate is
promoted by this packaging/test-infrastructure checkpoint.

The second extraction passes strict native-source and publication preflight,
then reports 1,725 passes, 13 failures and two skips. Its failures expose three
additional clean-checkout dependencies: generated TypeScript/locator JSON need
LF pins; structural source inspections must tolerate CRLF; CLI tests must create
their required scratch directory instead of racing other tests to create it.
Three content-golden failures also prove that the current canonical content
bundle depends on the four existing directional wall-torch aliases in `data.ts`
(the original staging review incorrectly treated their six-line hunk as
unrelated). They map technical wall states to the single Torch inventory item;
including that authored-content input preserves the already-tested exact bundle
fingerprints without changing the golden expectations. The unrelated removal of
the drone-model test from `package.json` remains unstaged. Failure evidence is
retained under `work/hybrid-rust-migration/checkpoint-c7-extracted-20260902-2*`.

### Predictive streaming and real persistent-cache acceptance - 2026-09-02

The predicted-ring first-mesh repair now spends only existing discretionary mesh
turns on exact missing local sections or their direct runnable seam dependencies.
Current-ring reservations and generation, lighting and frame budgets are unchanged.
Explicit edit ownership prevents a coalesced generation seam from demoting a
player edit. Red-first regressions exposed 15 failures; the final focused suite
passes 28 tests and the broader world/worker/cache/mutation matrix passes 239.
Independent review, TypeScript and scoped lint pass. Root's combined ten-file
scheduler/clock/performance/storage/verification/checkout run passes 235 tests.

V2 browser diagnostic 6 completed at 17:38:14 UTC. Both measured lanes pass all
155 exact-output cases and all five movement traces with **zero** unready frames:
TypeScript retained 6,185 callbacks and Rust 6,704. All traces preserve 420 movement
ticks and finish drawable. The separate installed game-development client passes
all 155 cases but retains one unready frame in the POI trace; its other four
traces pass. Therefore the overall diagnostic exits failed. Its screenshot and
the measured Rust screenshot were manually reviewed; failures remain retained in
`work/hybrid-rust-migration/r3-performance-c7bfb66c-20260902-diagnostic-6/`.

The first comparable pair is **not performance acceptance**. Rust's streaming
update p95 is 5.3-20.1% lower across the five traces, but complete-corpus initialized
acceptance p95 is 306.530 ms versus TypeScript's 259.105 ms (1.183x), and
reset-to-accepted p95 is 449.945 versus 259.385 ms (1.735x). Initial drawable
readiness takes 1.90-2.33x the TypeScript time despite faster installed-ring
arrival. These cold/service regressions exceed the unchanged scenario floor;
one diagnostic pair cannot establish a repeated gain. All measured browser
error streams are empty and source/artifact/resource cleanup passes.

The new real persistent-cache lane **passes**, with evidence in
`work/hybrid-rust-migration/r3-persistent-cache/c7bfb66c-20260902-1/`.
The nonempty `surface-poi-negative` case generates once, travels 15 chunks, and
unloads after its real residency lease expires. Its target IndexedDB write commits
and survives disposal. A new same-origin page restores through normal scheduling:
one persistent hit, zero memory hits, zero target regeneration, exact pre-update
cached bytes, all immutable oracle streams and three POIs preserved, then normal
drawable readiness. Both phase screenshots and the skill's idle UI screenshot
were manually reviewed. All five world/worker/observer/transaction cleanup fields,
browser/server/mutex cleanup and native/browser-source/canonical guards pass.
Live edit-halo namespace rejection and native persistence authority remain outside
this unedited cache round trip.

The new public historical-import gate exposes a **real remaining blocker**.
Both frozen synthetic g16/g17 exports import with the expected options and edits,
but Continue refuses their rich save because the native migration operation only
supports world edits. The retained production notice names player, runtime-clocks,
gameplay, machines and unknown domains. Both cases fail honestly, without stripping
fields, fabricating identity or reseeding a save. Evidence and screenshots are in
`work/hybrid-rust-migration/browser/r3-old-saves-c7bfb66c-20260902-1/`; all owned
profile/database/server/source/error cleanup guards pass. A real versioned native
rich-save adoption path with source preservation and semantic readback is required;
loosening the existing world-only guard is not a repair.

Canonical artifact `c7bfb66c` and native source `e4fcec5a` / 222 files are unchanged.
Formal acceptance remains 9/32, with 32 pending authority rows, nine open completion
gates and 0/2 verified rollback releases. No deployment or new authority promotion.

### Production-paced browser replay and bounded evidence retention - 2026-09-02

The V2 replay is implemented and independently checked against the production
animation loop. It retains 420 fixed movement ticks, with streaming before
physics on every real callback, the same 80 ms delta/four-tick backlog caps,
and an explicit final-position update. Clock/verifier tests pass 65/65, and the
combined clock/runner/lookahead/seam/storage check passes 130/130. The direct
queued-seam dependency fix passes 12 regressions and the 192-test broader
world/cache suite. TypeScript, scoped lint and review pass.

V2 diagnostic-5 at
`work/hybrid-rust-migration/r3-performance-c7bfb66c-20260902-diagnostic-5/`
finishes both exact 155-case lanes and five seven-second traces per lane.
TypeScript retains 6,060 callbacks and 20/30/15/17/23 unready frames; Rust retains
6,555 callbacks and 0/7/9/0/0 unready frames. Every trace reaches all 420 ticks
and final 9/9 readiness. An independent post-run replay validates all 12,615
callback clock/position records. Trace identity is
`14313d99b75d066250ae3d59e235b0bd`. Both lanes remain rejected; no speedup or
performance promotion is claimed. The first failures occur at the crossing
near tick 121: affected chunks are present and light-ready, with local-height
sections still unbuilt. Predicted-ring first-mesh priority is now being repaired
inside the existing background mesh allowance, preserving current-ring reserves
and explicit edit priority.

The separate skill client completes all 155 cases and five V2 traces but also
rejects readiness; its timing is excluded. Its screenshot and the measured Rust
screenshot were manually reviewed and are legible. Error streams are empty;
browser/context/server/PID/mutex cleanup and all source/artifact guards pass.

The runner no longer retains every lane's repeated readiness/telemetry graph
through a five-pair run. Full evidence is still written before a detached return
can resolve; readable summaries and every clock/point/timing callback remain
available for comparison, with exact replay and rejected-lane vetoes preserved.
Eleven runner tests pass, including comparison equivalence, detached ownership,
omitted/forged callbacks and rejection. Replaying actual diagnostic-5 evidence
produces serialized comparison projections of 3,675,359 and 4,000,371 bytes,
versus 183,468,502 and 226,417,568-byte verbose evidence files. This is serialized
retention size, not a measured JS-heap or game-performance improvement. Future
full-evidence files use compact JSON without omitting records.

### Streaming repair and historical import correctness - 2026-09-02

Commit `8d7a008` saves the independently verified source-checkout utility and
attributes. It is a narrow checkpoint, not a commit of the full c7 engine package.

The lookahead scheduler repair passes 14 new regressions and the 228-test
world/pipeline/cache/performance matrix, plus TypeScript and scoped ESLint.
Starting, stopping, reversing or changing the discrete lookahead cell now
invalidates the effective schedule. An unchanged cell retains the fast path.
All three generation-admission paths share current directional/aging ordering,
and the existing 180-frame refresh now bypasses the unchanged-anchor guard.
Reset clears previous-world lookahead. Independent review approved the saved
pre-edit diff; no budgets or readiness predicates were weakened.

The frozen V1 diagnostic-4 retains both full 155-case exact-byte lanes and all
five traces. TypeScript reports 108/93/97/89/98 incomplete frames; Rust reports
27/22/22/22/22. Both end at 9/9, but neither is accepted. New section-built
observations expose occupied sections without meshes even when the old
presentation diagnostic reports ready. The measured Rust and installed skill
screenshots were reviewed and are legible. Browser error arrays are empty;
all browser/context/server closures, source/artifact guards and mutex release
pass. Evidence: `work/hybrid-rust-migration/r3-performance-c7bfb66c-20260902-diagnostic-4/`.

**V1 is a fixed-frame stress replay, not production-speed walk/sprint evidence.**
Its nominal 1/60-second movement step runs on every real callback; the observed
240 Hz display therefore accelerates travel relative to the declared velocity.
Production instead runs world streaming per callback and advances movement with
a capped fixed-step accumulator. V2 is being implemented with the same 420
movement ticks and path, but production-paced timing, variable callback counts,
explicit clock evidence and a final-position update. Retained V1 results will
not be relabeled or mixed into V2 performance comparisons. A separate queued
seam-dependency priority repair is in progress under the existing work budget.

Historical import review also found and repaired a real pre-17 option bug:
`importWorld` migrated the save to g18 before applying the source-version
settlement rule to its envelope. Import and normal document loading now share
the original-version-aware option resolver. Seven synthetic historical-format
tests cover g2/14/15/16/17/18, omitted and conflicting settlement patterns,
profile/identity preservation, exact placed/Air edits, g2's one-time +8192
index shift, and export/reimport. Red-first evidence was four failures and two
passing modern controls. The final storage suite passes 29/29; the preceding
66-test storage/migration/persistence/sharding matrix and scoped lint pass.
Independent review approved the repair. These are deterministic boundary tests,
not real-browser old-save acceptance or R8 authority promotion.

### Matched browser gate and clean-checkout identity - 2026-09-02

Implemented the dual-profile production browser benchmark in
`scripts/benchmark-r3-generation-browser.mjs` and the
`r3-generation-performance` fixture/contract. It uses default `ChunkWorld`
constructors, all 155 pre-seam full-stream oracle comparisons, equal retained
warmup, separate reset/runtime/accepted costs, and five fixed 420-frame real-rAF
traces. Startup has a continuously requested frame observer; timed world
startup includes the real `initializeAround` path. Hashed assets retain their
production immutable-cache behavior. Fresh browser processes record actual
graphics, source/artifact identity, worker health, throughput and cache counts,
readiness, observer overhead, raw frame evidence and owned cleanup.

The first diagnostic caught a harness build defect before accepting a sample:
Vite's more-specific `process.env` replacement erased a process-object-only
selector definition. Explicit production environment defines and a real Vite
compilation regression test now preserve both backend selectors. Combined
runner/fixture coverage passes 50 tests; typecheck and scoped lint pass.

Diagnostic evidence is retained under
`work/hybrid-rust-migration/r3-performance-c7bfb66c-20260902-diagnostic-1/`,
`...-diagnostic-2/` and `...-diagnostic-3/`. The third run executes both hardware
lanes and the separate installed skill client. **Both browser implementations
match all 155 terrain cases exactly, but both complete runs are rejected for
continuous immediate-ring readiness loss.** Hardware is Chrome 152 using ANGLE
Intel Iris Xe / D3D11, not SwiftShader. The five TypeScript traces contain
239/232/208/239/223 unready frames; Rust contains 27/23/79/22/24. Both finish at
9/9. These are diagnostic observations, not accepted speedups. The independent
skill-client run is excluded from timing and is likewise rejected for
readiness; its original-resolution screenshot was reviewed and is legible.
Both measured lanes have empty browser error streams and exact owned cleanup.
Source, canonical and selected artifact checks remain unchanged. No performance
comparison or authority promotion is granted from rejected lanes.

The failure identified real delayed admission: starting or reversing movement
inside a chunk changes lookahead, but the update trigger and scheduling guard
ignore it. Async persistent-cache misses and direct requests can also overwrite
directional ordering with distance-only sorting. A focused scheduler repair is
being implemented; remaining mesh-stage tails must be measured separately.
Budgets, paths and readiness thresholds have not been relaxed.

Separately, `.gitattributes` now pins LF only for the source-hashed engine text
and two build scripts, while preserving explicit binary rules. The new isolated
Git checkout verifier passes seven tests, including CRLF/no-NUL named-binary
preservation. A real clean clone with `core.autocrlf=true` and `core.eol=crlf`
retains all 222 source inputs and exact digest `e4fcec5a5762968647960f41e5c18ee7688c81c4c56fa833cb3d476b7f2a0cda`,
with zero byte differences, clean checkout and original source unchanged.
Final report: `work/rust-source-checkout/canonical-e4fcec5a-20260902-2/report.json`.
This closes checkout-byte reproducibility only. Commit `8d7a008` saves the four
verified utility/attribute files, including the source-snapshot helper they
depend on. The c7 package previously depended on 73 dirty source inputs; this
narrow checkpoint does not commit the remaining engine/artifact migration.
Broad source-commit validation remains open. No deployment or formal acceptance
increment occurred.

### Canonical R3 integration and benchmark validity - 2026-09-02

The locally published compatibility package now reproduces validated candidate
`c7bfb66cb842b08ea722f3be306d85cbf2d018794a86944b153b9764d4d1e20b` exactly.
Its source snapshot is `e4fcec5a5762968647960f41e5c18ee7688c81c4c56fa833cb3d476b7f2a0cda`
with 222 files. The previous canonical engine tree is preserved under
`work/hybrid-rust-migration/canonical-before-c7bfb66c-20260902/`.
After deliberate locator evidence regeneration, a no-override/no-update rerun
passes the full 155-case generation corpus plus 114 settlement and 16 lair
cases. The prior canonical 131-versus-155 certificate mismatch is resolved.

Real-game acceptance at
`work/hybrid-rust-migration/browser/terrain-edit-c7bfb66c-20260902/` passes all
12 coverage checks: real UI creation, exact nine-chunk immediate readiness,
trusted targeting/mining, Save & Quit, full reload and fresh Continue. One
Sunstep Grass cell at `(4,43,-3)` is mined to Air and retains the exact saved
edit hash `bf1440d65e21624215279e72bc27b0b2d2cd94d6074388ed77faede401415f2b`.
All seven frames were reviewed at original resolution. Real error streams are
empty; expected music cancellation and managed local HMR are separately
recorded. Browser/server/profile/database/Vite/mutex cleanup passed. This tests
Rust terrain regeneration with the current TypeScript player/edit path; it is
not full Rust gameplay or old-save/cache/soak acceptance.

The five R3 landscape fixtures now match the current shared extraction path.
Before refreshing them, decoded comparison verified unchanged geometry,
materials, camera records and generated chunk hashes. Changes were solely the
existing explicit sky-light stream and corrected environment lighting/color
records. The reviewed contact sheet remains
`af83a68f235156904e6a68b72e4037e5d4b4b4bd96ea0b4f6828978ad2ff1446`.
Fresh `--check` evidence in `work/hybrid-rust-migration/r3-canonical-current/landscapes-recheck/`
passes all five exact scene records and zero browser errors. Three/wgpu MAE
is 0.0019–0.0304 and RMSE 0.0437–0.4672, below the unchanged 1.5/8 bounds.
These are generated-chunk companion galleries, not full live-game art parity.

The Node scenario runner now explicitly selects legacy TypeScript in both
worlds, verifies seven untimed generation/readiness checkpoints and cleans up
through `finally`. Its evaluator rejects workload drift, invalid timings,
missing/mismatched backend identity and vacuous generation before normalized
comparison. All ten workloads and measured iteration counts are retained.
One diagnostic run passes all guards (48/11 generated main/settlement chunks,
4.445 ms p95 geometric mean), with no Rust speedup claim. Nine evaluator tests,
25 browser/landscape-tool tests, 16 current-canonical game-verifier tests and
77 pipeline/cache/storage/profile/rollback tests pass. The rollback fixture
needed its two exact lifecycle traces updated for the existing settlement
drain; zero forbidden Rust activation calls remains a strict assertion.

The new actual production-worker gate at
`work/hybrid-rust-migration/browser/r3-production-worker-c7bfb66c-20260902-rerun-1/`
also passes against canonical `public/engine`. Default module-worker creation
was observed at `/app/game/terrain-generation-worker.ts?worker_file&type=module`.
It passes all 155 cases in forward/reverse/zipper order: 465 exact comparisons,
4,650 streams and 741 decoded POI rows. Six additional checks prove cancellation,
same-lane stale rejection, epoch reset, a real slot's diagnostic crash and
replacement-worker success, input ownership and disposal. Counters are exact:
473 submitted, 469 completed, two stale, one canceled, one invalidated by reset,
one explicit restart and zero unexpected failures/rejections. All 14 nonempty
input buffers detach; all 473 gameplay-owned source inputs remain intact.
Five workers are explicitly terminated. Output receiver ownership and the
production transfer-list source are checked; output sender-side detachment is
not dynamically observed and remains labeled false. The 1100x620 evidence image
was reviewed, all 11 verifier tests and final repository typecheck/scoped lint
pass, and source/canonical/browser-source/mutex/server/owned-client cleanup is
green. A final read-only process inventory found no recent owned Node, browser,
Cargo or Rust/build processes. The browser source snapshot is
`35b13d0b16d76a2b9b7516007ee901b362d88d976d1962a7835abcf311507cb1` / 306 files.
The full existing 160-file canonical Rust/renderer suite separately passes
1,563 tests with zero failures and two skips; the new verifier tests were added
after that suite's frozen discovery.

This checkpoint does not promote the R3 ledger row. Live cache/POI and old-save
coverage, comparable browser cold/warm and readiness-tail measurements, and a
coherent reviewed source commit remain to be completed. Multiplayer authority and two post-cutover stable releases
are not circular prerequisites for initial R3 promotion; the latter control
fallback retirement. No push or deployment occurred.

### Complete domain-operation wire convergence - 2026-09-02

The R5-R9 registry now has all 69 families and **5/5 domains complete** at the
canonical BWRQ/BWRS domain-operation boundary. R6 independently recomputes native
entity-authority hashes from complete decoded state and verifies request-bound
import receipts. R7 has typed codecs and independent semantic hashes for all 44
command/action variants, with 92 native vectors, nested enum coverage, 46 optional
field paths and exact native bounds. The final review repaired `Some(0)` actor
ID transport parity without changing gameplay admission rules. Native producers
now reject invalid batch schemas/counts/hashes, forged BWA7 receipt hashes,
noncanonical domain/scope sets and zero mandatory linked-combat IDs.

Current-source Chromium/Wasm run
`work/hybrid-rust-migration/schema-browser/2026-09-02T15-19-55-105Z/` passed all
nine checks on isolated candidate
`c7bfb66cb842b08ea722f3be306d85cbf2d018794a86944b153b9764d4d1e20b`.
It verifies the native vectors, real entity import/export with exact bytes and
independent hashes, an accepted nonschedule gameplay command with an exact
native receipt, corrupt-payload nonmutation and runtime destruction. The
original-resolution screenshot was reviewed; source/canonical artifacts stayed
unchanged and the owned server/browser/mutex closed.

This closes exactly the domain-operation schema-convergence gate: open
implementation gates fall from 10 to 9. Formal acceptance stays **9/32** and all
32 authority rows remain unpromoted. R8 bulk transport, live command integration,
production selection, rollback and whole-game acceptance remain separate gates.
The wire fingerprint is unchanged; this is completed codec/evidence coverage,
not a protocol revision or production cutover.

Final validation passes the complete native workspace, strict workspace Clippy,
formatting, TypeScript, scoped ESLint and 53 schema/generator/audit checks. The
frozen 160-file candidate-backed Rust/renderer matrix passes **1,560 tests, zero
failures, two explicit skips**, including all 155 generation and 114 settlement /
16 lair cases. The package schema command now uses `--require-complete`; synthetic
partial-manifest tests retain fail-closed coverage. After documentation/source
provenance refresh, the same artifact reproduced exactly and browser run
`work/hybrid-rust-migration/schema-browser/2026-09-02T15-26-42-810Z/` repeated all
nine checks. Its screenshot is byte-identical to the reviewed first accepted
capture. Cleanup and a live process inventory confirm no owned tests, build,
browser or server remain. Canonical artifacts, commits and deployments were not
changed in this tranche.

### Earlier partial wire checkpoint - 2026-09-02

The [machine-checked R5-R9 registry](../engine/schema/README.md) now has exact
Rust-authored/TypeScript round-trip vectors for all 69 request/receipt families.
R5 simulation, R8 persistence commands and R9 networking are complete at this
wire boundary (3/5 domains). R6 still needs independent TypeScript semantic
authority-hash verification; R7 still needs its non-schedule command codecs
and bounds. Shared final-bind producers and metadata, safe-integer, Unicode
and whole-packet validation were repaired as part of the convergence work.

A current-source isolated candidate passed real Chromium/Wasm R8 lifecycle,
byte round-trip and corrupt-payload rejection checks. This does not promote
any authority row, replace canonical artifacts, complete R8 bulk persistence,
or close the overall convergence gate while R6/R7 remain partial. Formal
acceptance remains 9/32 definition-of-done items, 32 pending authority rows and
10 open implementation gates.

Validation: the complete native Rust workspace, strict workspace Clippy and
formatting pass. The candidate-backed 157-file Rust/renderer matrix passes
1,441 tests with zero failures and two explicit skips. The candidate matches
all 155 generation cases and all 114 settlement/16 lair cases. Reproduce with
`BLOCKWILD_LOCATOR_ENGINE_DIR=public/engine-schema-candidate` and
`node scripts/run-rust-engine-tests.mjs`, with the locator-corpus update flag
unset. This override is explicitly allowlisted and retains path confinement;
it does not rewrite canonical evidence. The default canonical artifact still
has an older generation certificate/output mismatch, and its locator evidence
has a stale artifact hash, so release acceptance remains blocked.

Three artifact-selection unit tests no longer depend on mutable local
candidate hashes. They now use synthetic packages with real content/source
hashing and negative corruption, provenance and mutation cases; actual browser
acceptance CLI/environment pins are unchanged. The audit also recognizes the
generator-check-plus-verifier package command without relaxing its completion
criteria.

| Phase | Implemented evidence | Production authority at this checkpoint |
| --- | --- | --- |
| R0 | pinned Rust/Wasm workspace, BWEP v1 worker lifecycle, content-addressed artifacts, browser/native `wgpu` smoke, engine lab, CI | TypeScript/Three.js remain default |
| R1 | native/Wasm/TypeScript coordinate, UTF-16 seed, `Math.imul`, spatial, replay, and hash fixtures | Rust shadow laboratory only |
| R2 | BWR2 registry, whole-section Rust meshing/lighting, exact Three installer, WebGPU audit path, 325-sample differential, edit/stale/crash recovery | promoted only for exact known-content sections; unknown revisions fail whole-section to the oracle |
| R3 | V2 generation contract and renderer-free worker boundary | TypeScript generator oracle until complete byte-parity service promotion |
| R4 | revisioned world DTO, atomic edit contract, immutable near-field page, native store, and V14 generic native block-edit receipt/projection transaction; isolated R60 covers one exact Dirt mine/pickup/place/mine loop, successors add Meadow Grass dirty-evidence/recovery and one exact east-facing Wildwood Shelf Creative-place/Survival-mine/native-drop/full-reload path | TypeScript `ChunkWorld` remains formally authoritative; these bounded candidate slices do not complete the dirty-propagation or world-edit domains |
| R5 | native collision/swimming/liquid/projectile/mount/path/AirZone kernels; BWM7/BWN7 native saved-world game-mode CAS with exact browser readback and checkpoint; 17 kernel tests plus focused mode coverage | not promoted until broader Wasm/runtime input replays and complete player-simulation custody pass |
| R6 | native entity IDs, residency, broadphase, ecology, spawning/protection, model graphs; 28 tests | not promoted until save import and live entity adapter pass |
| R7 | native inventory/machines/combat/capture/progression/Cardforge authority; 20 tests | not promoted until live commands share the Rust path |
| R8 | native journal/checkpoint/migration/repair crate and inspector; browser IndexedDB transaction adapter; stable world sharding | browser journal is primary for menu loads, but Rust validation must still enter the Wasm commit path |
| R9 | native multiplayer/agent authority, codecs, leases, interest, reconnect, fuzz/replay; candidate WebRTC guest poses now traverse typed BWNP/BWPP Rust custody and return command-bound native projections | Formal promotion remains blocked because player movement simulation is still TypeScript, periodic world keyframes remain a coarse legacy projection, hosted rendezvous and full browser agent/replay/soak coverage remain open, and no canonical selector or rollback promotion has occurred. |
| R10 | renderer-neutral resource deltas and frame records cover terrain, articulated instances, props, machines, projectiles, vehicles, particles, camera, fog, underwater and cave state | extraction contract validated; integrated `wgpu` scene and live producer still in progress |
| Integration | `IntegratedRuntimeV2` composes generation, complete world/chunk metadata, entities, gameplay, persistence, simulation jobs, and network validation behind one deterministic handle; cross-domain batches are clone-and-commit atomic | native authority proven; browser/Wasm command codecs and live cutover remain required |

## Non-reducing design changes

### Content-addressed Wasm publication

The plan allowed either deploy-time Rust builds or committed deterministic artifacts. Vercel and Sites did not have a verified pinned Rust toolchain, so production uses immutable `public/engine/<sha256>/` packages selected by a small manifest. CI rebuilds and rejects drift. This adds a reproducible supply-chain gate; it does not reduce engine scope.

### Separate authority crates before aggregation

World generation, world storage, simulation, entities, gameplay, persistence, and network authority are separate crates with narrow deterministic contracts. A final runtime crate will compose them behind one worker handle. This makes differential testing and native tools possible without coupling browser APIs into the engine.

### Near-field read pages at the R4/R5 boundary

Moving blocks to a worker while retaining synchronous TypeScript collision would otherwise create per-voxel messaging. R4 therefore publishes immutable revisioned near-field pages, and R5 consumes coarse pages/jobs. The mirror is read-only and expires when Rust physics becomes authoritative; it is not a second writable world.

### BWR2 generated material registry

The initial R2 material wire encoded specialty blocks as a bare tag without layer, tile, shape, solidity, dampening, or emission data. R2 now ships a generated BWR2 material/shape registry covering all 312 current visible definitions, with content and geometry revisions at the worker boundary. Unknown IDs or registry revisions reject the whole section to the exact TypeScript oracle; broad tolerances and partial double emission remain forbidden. The final differential covered 312/312 definitions plus 13 seam, fluid, and generated scenarios (325 samples, zero mismatches, 5.88 ms p95), and browser validation covered shadow, promotion, immediate revisioned edits, deliberate crash fallback, restart, and exact recovery.

### Browser journal compatibility window

IndexedDB journal records and the head checkpoint commit atomically. The existing localStorage document remains a readable, full emergency source during migration and is never deleted before semantic readback. Journal-backed menu loads are primary; synchronous legacy engine call sites remain a bounded compatibility path until R12 converts them or removes them. This is the plan's protected migration sequence, not indefinite dual authority.

### Resource-delta render extraction

The final renderer protocol separates durable GPU resources from lightweight frame presentation. Geometry and materials are uploaded or removed by stable ID and revision; frames carry camera/environment state, hierarchical instance transforms, particles, and the exact resource revision they require. The renderer may discard an obsolete presentation epoch, but it cannot skip reliable resource changes or infer gameplay state. This avoids resending terrain and authored geometry every frame and gives Three.js and `wgpu` one comparison boundary.

### One generated browser/native command schema

The early R5-R9 TypeScript DTOs and native Rust crates were deliberately built as independent safety contracts. That exposed naming and hash-domain drift before authority promotion: a pair of locally valid command models is not a production protocol. Live cutover therefore requires one generated or byte-tested wire schema per domain, with TypeScript fixture bytes decoded by native and Wasm code and native receipts decoded by TypeScript. The integrated worker will not translate between two hand-maintained semantic models, and an injected fake-kernel test cannot satisfy this gate. This adds convergence work but removes a permanent source of multiplayer, save, and replay divergence.

### Asynchronous authority receipts, not optimistic gameplay commits

The browser worker boundary is asynchronous, while the legacy `ChunkWorld.setBlock` surface returns a synchronous boolean that existing callers may immediately use to consume an item, advance a quest, or emit a multiplayer result. R4 may mirror an accepted Rust edit into presentation immediately after its receipt, but a synchronous optimistic `true` cannot become the production transaction boundary: a later stale-revision rejection or worker restart would split world state from inventory and progression. Final promotion therefore routes block edits and their gameplay consequences through one awaited integrated Rust command receipt. The compatibility `ChunkWorld` method may remain as a presentation/cache adapter during the measured rollback window, but it cannot independently promise success.

### Directional, content-bound, dirty-evidence, and static-shaped generic edits remain bounded

The successor isolated candidate `4a1cfa2695e1f4f2dc4da4f042dcb00c023b9cebbb50ffb0d9e1924d28948222` expands the same V13 receipt path without changing the formal authority row. Rust now owns one exact schema-2 directional single-cell placement class with integer yaw-to-facing boundaries and receipt/history/restore validation. Browser gate `work/hybrid-rust-migration/browser/generic-grass-4a1cfa26-20260828-rerun-4/` independently proves one production-content `Meadow Grass` (`73`) mine to Air, its generated self-drop, checkpoint-before-projection ordering, durable cursor/save/reload restoration, and live empty-cell traversal. The verifier compares the union of pre/post edit addresses so a hidden deletion cannot masquerade as a single mutation.

Latest isolated candidate `e2ad533c785ce25500645b9e5029f7ea1e6b0de731913261f3169807d07b2ce8` advances the runtime to V14 while preserving the V1 BWZ7/BWY7 receipt bytes. Capability `native-block-edit-receipt-v2` selects BWZ8/BWY8, which always carries the complete V1 receipt plus a receipt-bound Rust-authored dirty record: exact ordered sections and columns, seven subsystem seeds, and a canonical evidence hash. The browser consumes that record as the sole topology-invalidation source for the accepted V2 projection. Gate `work/hybrid-rust-migration/browser/generic-grass-e2ad533c-20260828-rerun-5/` proves the same exact Meadow Grass cell through native checkpoint, V2 projection, durable browser document, acknowledgement, Save & Quit, full reload, and live empty-cell/drop restoration with all 18 checks green.

This evidence still does not make Rust the complete dirty-propagation producer. All shaped behavior except the exact content-bound static one-cell Mooncap/Shelf/Barrel predicate remains outside; only Wildwood Shelf has browser acceptance. Connected, vertical-connected, liquid, multi-cell, rooted-tree, collision-height, dynamic/container, durability/luck, quest, multiplayer, and broader inventory consequences remain open, as do canonical selector and rollback-release gates. The bounded candidate path now has accepted forward-only same-session finalize recovery: physical hotbar input queues behind the immutable pending successor, retry promises participate in the Save & Quit/shutdown authority drain, and drift or repeated storage failure remains fail-closed. Deterministic coverage passes 25/25 engine recovery transactions, 19/19 live player-authority wiring tests, 28/28 browser-verifier cases, the combined 123/123 block-edit/player-authority matrix, 2/2 candidate probes, and 23/23 migration-audit tests. Exact live gate `work/hybrid-rust-migration/browser/generic-grass-recovery-e2ad533c-20260830-rerun-2/` injects one cursor-1 active-world document failure after native checkpoint/projection, proves byte-exact raw document and catalog rollback, observes a Save & Quit-caused retry before acknowledgement and a settled write after acknowledgement, then proves the Air edit and native item-73 drop after full reload. All 24 coverage checks, six manually reviewed frames, error streams, immutable-source checks, owned cleanup, TypeScript, lint, candidate integrity, and whitespace gates pass. This closes the prior restart-only recovery debt for the accepted Meadow Grass slice without promoting the authority row.

Latest isolated candidate `f2329be23061738404ed5d94f5889a08125738387192fd58000e097d35f59e6d` expands the bounded path to exactly three production static shaped profiles without promoting the row: Giant Mooncap block/item 38 and Sealed Barrel block 131/item 271 use direct placement; Wildwood Shelf block 130/item 270 uses directional placement. Their exact content/item/shape/topology/plain-stack/Air-replacement/mapped-item-loot semantics are sealed, with Builder inventory-no-op/no-drop and Survival debit/native-drop behavior. Live gate `work/hybrid-rust-migration/browser/generic-shaped-prop-f2329be2-20260830-rerun-18-mode-cas/` witnesses only Wildwood Shelf: trusted public controls select item 270, place it east-facing (`Air -> block 130`, facing `0 -> 1`) in Creative, preserve its custody across Save & Quit and an exact Worlds UI mode edit, hydrate the same world in Survival, mine it back to Air with facing cleared, create a native item-270 drop, save again, fully reload, and restore the exact empty cell, inventory, drop identity, and cursor. All 24 declared checks, 49 browser-verifier cases, 13 manually reviewed original-resolution frames, error streams, immutable-tree checks, and owned cleanup pass. Connected, vertical-connected, multi-cell/rooted, liquid, collision-height, dynamic/container, durability/luck, and broader consequence classes remain outside this evidence.

### Saved-world game-mode transitions are native CAS, not title metadata

The title menu may request Creative or Survival, but it cannot independently author the live player's mode. BWM7 carries exact actor/player/entity custody, expected mode and flags, and the expected simulation revision/state hash into the Simulation domain; BWN7 seals the one-revision successor and resulting flags. A stale or contradictory request leaves native state unchanged. Survival clears Creative and Flying while preserving unrelated Mounted state; Builder sets Creative without manufacturing flight. On restoration the browser performs the CAS, verifies an immediate native readback, commits exactly one native checkpoint, verifies again after that checkpoint, and only then opens terrain, input, and rendering. The shaped-prop live gate proves Builder-to-Survival flags `3 -> 0` and simulation revision `192 -> 193` through this path. This closes one concrete browser-metadata split-brain risk, not the complete player-simulation authority row.

### Full generated-chunk authority

The first R4 store contract held resident cells and authored edits but omitted height maps, biome columns, light streams, leaf/emissive indices, and structure markers. That would have made Rust unable to own maps, POIs, lighting publication, or exact cache/save regeneration. The store now retains a validated, renderer-independent auxiliary record per resident chunk and includes it in its canonical state hash. It remains disposable generated state—authored edits stay in the durable journal—but it is no longer silently dropped at the R3/R4 boundary.

### Cached authority digests and section-spanning read pages

The first integrated runtime recomputed every resident cell and every generated chunk stream whenever a command requested the canonical root, and its immutable simulation-page capture performed a tree lookup plus string-key allocation per cell. Both were correct but would have moved avoidable work into the fixed-step path. Resident sections and chunk auxiliary records now cache canonical content digests that are refreshed only on installation or mutation. Page capture walks contiguous section-row spans, resolves each resident section once per span, records each revision once, and validates its structure before hashing once. On the same release benchmark with 300 resident sections, 500 captures of 49,152 cells fell from **24,775 ms** to **1,700 ms** (**14.57× faster**), while 10,000 authoritative edits remained **505 ms** total and all page, save, delta, and replay oracle hashes stayed unchanged. This is an internal representation optimization; it does not relax validation or create a writable mirror.

The combined-runtime benchmark then exposed three additional linear costs: cloning the complete runtime for a one-domain command, rebuilding the entire authored-edit digest, and replaying up to 8,192 history entries into every fixed-step hash. Single-domain commands now use each domain's already-atomic transaction directly; multi-domain batches clone only the domains they touch and publish them only after every stage accepts. Authored edits and replay entries use incrementally maintained canonical digests, repeated root reads use an invalidation-safe cache, and a prevalidated generated chunk installs without cloning all resident chunks. On the same 108-section fixture, nine generation/install operations improved from **135.113 ms** to **118.330 ms**, 500 near-field pages from **1,433.110 ms** to **1,129.178 ms**, 10,000 integrated edits from **4,316.104 ms** to **1,766.615 ms** (**2.44× faster**), and 20,000 fixed steps from **19,110.151 ms** to **2,262.171 ms** (**8.45× faster**). Both runs ended at canonical hash `49ddb341b8fa86f0e069665df1fb01c4`.

## Open completion gates

- Promote the complete v18 generator with seed/chunk/POI byte parity and no `ChunkWorld` construction in its worker.
- Promote Rust world authority, then physics, entities, gameplay, persistence validation, and host/agent networking through coarse Wasm paths.
- Expand the now-awaited generic receipt path beyond its accepted exact Dirt cycle, Meadow Grass mine/self-drop/dirty recovery, and exact static Mooncap/Shelf/Barrel predicate with one live Shelf Creative-place/Survival-mine/reload witness to every remaining shaped/connected/liquid/multi-cell/rooted/dynamic/container case, durability/luck/content consequence, quest, and multiplayer result before the complete world-edit domain is promoted.
- Complete renderer-independent extraction for every visible domain.
- Render the integrated game through `wgpu`, promote it on the supported WebGPU profile, and isolate Three.js into an explicit compatibility bundle.
- Remove authoritative state/rules from `engine.ts` and `world.ts`; keep only browser/UI/platform adapters.
- Pass full repository, replay, save corruption, multiplayer fuzz, browser interaction, visual matrix, device-loss, and performance gates.
- Record final before/after evidence and verify no owned test/server/browser process remains.
- Push one verified head to GitHub, Vercel, and Sites; verify exact commit and live aliases before completing the goal.
