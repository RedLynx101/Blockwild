# Rust Engine Authority Ledger

Status: Phase R0 contract with active implementation evidence
Protocol: BWEP 1
Schema: 1
Public simulation/player default: TypeScript
Public terrain-generation implementation: required Rust/Wasm by default; explicit TypeScript rollback build
Public renderer default: Three.js

This ledger is the migration's source of truth for runtime ownership. It prevents a TypeScript system and a Rust system from both accepting authoritative mutations for the same domain. The implementation plan is [HYBRID_RUST_ENGINE_MIGRATION_MASTER_PLAN.md](./HYBRID_RUST_ENGINE_MIGRATION_MASTER_PLAN.md).

## Rules

Valid authority modes are:

- `typescript-authoritative`: TypeScript alone owns outcomes. Rust may not mutate durable state.
- `rust-shadow`: TypeScript owns outcomes; Rust receives the same canonical inputs for differential checking.
- `rust-authoritative-typescript-shadow`: Rust owns outcomes; TypeScript runs only as a bounded comparison oracle.
- `rust-authoritative`: Rust alone owns outcomes. The old TypeScript authority may remain available only through an explicit rollback build.
- `retired-typescript`: the TypeScript authority has been deleted. TypeScript presentation and browser adapters may remain.

A domain changes mode only in a reviewed commit that updates this table, names its parity evidence, confirms its save/version boundary, and identifies its rollback switch. Renderer selection is independent from engine selection: enabling `wgpu-shadow` does not grant Rust simulation authority, and enabling `rust-shadow` does not replace Three.js.

### Current terrain implementation note (not a ledger promotion)

Browser terrain generation currently selects the certified Rust/Wasm worker at compilation and fails closed when its exact generator and locator certificates are unavailable. Production TypeScript generation is reachable only through an explicit `typescript-rollback` build selected by the private `BLOCKWILD_WORLDGEN_BUILD_PROFILE`; URLs and public runtime environment variables cannot change the implementation. Explicit constructor and Node-test seams remain for deterministic tests, and switching production implementations requires another build and reload.

The terrain row remains `typescript-authoritative` in this formal ledger. On 2026-09-02 the local canonical compatibility package was refreshed to `c7bfb66cb842b08ea722f3be306d85cbf2d018794a86944b153b9764d4d1e20b`, reproducing the already-validated isolated candidate. Its Wasm payload is `27581732bb4b6ac744b31ca870211b9656036b6f949b78f875f65c0fb54c1d30` (7,377,970 bytes), with source snapshot `e4fcec5a5762968647960f41e5c18ee7688c81c4c56fa833cb3d476b7f2a0cda` / 222 files. Canonical, no-override tests pass all 155 generation cases (131 frozen plus 24 normalized public-option lanes, including `legacy-v14`; corpus `5d4e6b1445b00f3430164d1a8093d8dc`) and all 114 settlement / 16 lair locator cases. The five shared Three/wgpu landscape records were reviewed and refreshed for the existing corrected linear-light environment and explicit vertex lighting, then passed a fresh check. Geometry, materials, camera records and generated chunk hashes did not change. This is local integration evidence, not a deployment or formal authority promotion.

Historical release-profile TypeScript/native runs on the earlier frozen corpus measured p50 147.1109/16.913 ms, p95 254.2003/100.016 ms, and computed p99 1190.2876/479.885 ms; then p50 152.3564/17.724 ms, p95 346.7067/102.327 ms, and p99 1179.447/525.609 ms. An earlier byte-exact debug-fixture run is retained as rejected performance evidence. These historical timings measure the native boundary, not current browser-Wasm end-to-end performance, and do not by themselves isolate the cause of the speedup.

The current canonical real-worker gate passes 155 cases in three orders (465
exact comparisons, 4,650 payload streams and 741 POI rows), plus cancellation,
stale rejection, epoch reset and diagnostic crash/replacement with all five
workers terminated. The normal game also passes trusted single-cell mining,
Save & Quit, full reload and Continue with exact edit preservation. Both gates
were repeated successfully after the validated byte-hasher optimization.

The real persistent-cache/POI gate passes natural eviction, committed IndexedDB
readback and fresh-page restoration with exact payloads and no target regeneration.
Its separate third-page edit-halo scenario also passes: an ordinary unloaded-neighbor
edit changes the namespace, production observes a real miss while the old record
remains present, exact target/edited-neighbor generation preserves the edit, and
the replacement persists under the new key. This is cache namespace exclusion,
not stale-inflight-response or R4/R8 authority acceptance. See the 2026-09-02
checkpoints in the implementation log.

R3 promotion still requires historical-save native adoption beyond the current-world
edit witness and comparable cold/warm browser generation and readiness-tail
measurements meeting the scenario policy. Both historical public imports preserve
their source but are refused by the existing world-only native migration policy;
rich-save adoption remains an implementation dependency, not an accepted import.
Post-hash diagnostic 8 passes both measured readiness lanes and shows lower
complete-corpus initialized generation and streaming-update p95. It still has
named-terrain/cold-start regressions and separate skill-client mesh-readiness
failures, so performance is not accepted. The 155-case code parity, canonical
binding, actual-worker correctness/recovery and live edit-halo cache rejection
are no longer open prerequisites.

The two independently verified stable Rust-primary releases govern **retirement
of the fallback after cutover**, not permission to begin a domain cutover;
`RUST_ENGINE_ROLLBACK_WINDOWS.json` therefore retains an empty verified-release
list and `retireAfter: null`.

The coherent source/artifact checkpoint requirement is closed by local
commit `3775d22f0bf4780e555b752f137b30ddf041c37b`: its exact extracted tree passes
native source/publication validation, 1,739 tests with zero failures and two
existing skips, and TypeScript. Subsequent startup/performance/cache changes
remain separate until validated and committed. This does not promote R3 or any
other authority row, and no push or deployment is implied.

The separate R9 host/guest promotion still needs canonical/public binding, closure of its `coarse-legacy-projection` world-keyframe exclusion and hosted rendezvous coverage. Isolated R54 closes the earlier player-movement-simulation exclusion only in the explicit combined candidate lane: native R5 supplies the guest kinematics, then Rust validates, records, and projects the pose before host gameplay consumes it. Artifact `0099873c2f6a4758fdcca5b4e17877a2b063853f1141799bdf3331045dd28bbd` passes movement, interest rollover, disconnect, title-only reconnect, and exact cleanup, but the public simulation default remains TypeScript and periodic world records are still authored from a TypeScript compatibility snapshot. Those R5/R9 gates do not silently become R3 prerequisites unless a concrete generation/save compatibility failure requires them.

## Phase R0 selectors

| Selector | Allowed in R0 | Meaning |
| --- | --- | --- |
| Engine `typescript` | yes; default | current TypeScript runtime is authoritative; Rust artifact is not requested |
| Engine `rust-shadow` | development/test opt-in | TypeScript is authoritative; Rust receives coarse mirrored batches; failures fall back cleanly |
| Engine `rust-authoritative-typescript-shadow` | no | reserved until a domain passes its promotion gates |
| Engine `rust` | no | reserved until a domain passes its promotion gates |
| Renderer `three` | yes; default | current renderer and visual oracle |
| Renderer `wgpu-shadow` | capability- and test-gated | comparison output only; has no simulation authority |
| Renderer `wgpu` | no | reserved until R11 promotion gates |

## Domain ownership

Every row is intentionally TypeScript-authoritative at R0. “None” in the Rust owner column means no production Rust authority exists yet; the target names the planned crate/module rather than claiming completed code.

| Domain | Current TypeScript owner | Rust target | Mode | Required parity evidence before next mode | Save/schema boundary | Rollback flag |
| --- | --- | --- | --- | --- | --- | --- |
| Runtime clock and scheduler | `app/game/VoxelGame.tsx`, world update loop | `engine/core` | `typescript-authoritative` | fixed-step replay, catch-up and pause/resume fixtures | runtime only | `engine=typescript` |
| Coordinate and block indexing | `app/game/world.ts`, geometry helpers | `engine/types`, `engine/world` | `typescript-authoritative` | negative-coordinate and boundary golden vectors | generator version | `domain.coordinates=typescript` |
| Seed derivation and RNG | world/content helpers | `engine/types` | `typescript-authoritative` | named-stream golden vectors in native and Wasm | generator/content hashes | `domain.rng=typescript` |
| Spatial index and broadphase | `app/game/spatial-index.ts` | `engine/simulation` | `typescript-authoritative` | query-set and ordering equivalence | runtime only | `domain.spatial=typescript` |
| Raycast and collision queries | world/player helpers | `engine/simulation` | `typescript-authoritative` | ray/AABB edge corpus and gameplay reach fixtures | runtime only | `domain.collision-query=typescript` |
| Terrain, biome, cave and structure generation | `app/game/world.ts`, `caves.ts`, `underground.ts`, structure modules | `engine/world` | `typescript-authoritative` | generator-version byte parity and POI metadata parity; current non-promoting evidence is summarized above | generator version per world | `domain.worldgen=typescript` |
| Section lighting | world lighting modules | `engine/world` | `typescript-authoritative` | propagation, seam and emissive galleries | chunk light revision | `domain.lighting=typescript` |
| Section meshing and packed buffers | world mesh code, `terrain-buffer-pipeline.ts` | `engine/world`, `engine/render` | `typescript-authoritative` | face/UV/light/AO byte fixtures plus visual gallery | derived data; not saved | `domain.meshing=typescript` |
| Chunk residency and streaming priority | `app/game/VoxelGame.tsx`, chunk pipelines/cache | `engine/core`, `engine/world` | `typescript-authoritative` | immediate-ring readiness and long-travel benchmark | residency is transient | `domain.streaming=typescript` |
| Player block edits and dirty propagation | world/runtime interaction code | `engine/world` | `typescript-authoritative` | immediate visual removal, revision and conservation tests | world edit journal | `domain.block-edits=typescript` |
| Liquids and aquifers | `app/game/liquids.ts`, world generation | `engine/world`, `engine/simulation` | `typescript-authoritative` | level/topology/seam and swimming fixtures | fluid schema version | `domain.liquids=typescript` |
| Atmosphere and pressurization | future celestial runtime plus current environment rules | `engine/simulation` | `typescript-authoritative` | zone topology, leak and life-support fixtures | location/environment schema | `domain.atmosphere=typescript` |
| Navigation and pathfinding | `app/game/creature-pathing.ts`, `agent-navigation.ts` | `engine/simulation` | `typescript-authoritative` | reachability, bounded work and semantic path parity | runtime/path cache only | `domain.navigation=typescript` |
| Entity identity and hot transforms | world/entity state in runtime modules | `engine/simulation` | `typescript-authoritative` | spawn/despawn, stable-ID and interpolation fixtures | entity schema | `domain.entities=typescript` |
| Creature movement, AI and combat intent | creature AI/pathing/ecology modules | `engine/simulation`, `engine/gameplay` | `typescript-authoritative` | behavior traces, attack reach, cadence and population invariants | creature schema | `domain.creature-ai=typescript` |
| Ecology and spawning | `app/game/creature-ecology.ts` and population systems | `engine/simulation`, `engine/gameplay` | `typescript-authoritative` | habitat caps, refill, persistence and deterministic soak | ecology/location summaries | `domain.ecology=typescript` |
| Player physics, swimming, mounts and damage | runtime/player/mount modules | `engine/simulation` | `typescript-authoritative` | input replays and control-feel acceptance | player state schema | `domain.player-physics=typescript` |
| Items, inventories and equipment | inventory/item/runtime modules | `engine/gameplay` | `typescript-authoritative` | metadata and quantity conservation, migration corpus | inventory schema | `domain.inventory=typescript` |
| Crafting, farming and processing | crafting/farming/machine modules | `engine/gameplay` | `typescript-authoritative` | recipe, timing, fuel and transaction fixtures | machine/crop schemas | `domain.crafting=typescript` |
| Power, pipes and Waygrid networks | machine/Waygrid modules | `engine/simulation`, `engine/gameplay` | `typescript-authoritative` | topology, conservation and bounded rebuild tests | network schema | `domain.networks=typescript` |
| Combat, projectiles, magic and status | combat/projectile/magic/status modules | `engine/gameplay` | `typescript-authoritative` | authoritative timing, damage and effect replays | gameplay schema | `domain.combat=typescript` |
| Capture, care, ownership and progression | capture/care/progression modules | `engine/gameplay` | `typescript-authoritative` | custody, bond, transfer, migration and multiplayer suites | creature custody schema | `domain.creature-care=typescript` |
| Quests, factions, settlements and economy | quest/faction/settlement modules | `engine/gameplay` | `typescript-authoritative` | quest transitions, stock/currency conservation and headless soak | progression/world schemas | `domain.progression=typescript` |
| Cardforge custody, packs and match rules | `app/game/tcg/*` | `engine/gameplay` | `typescript-authoritative` | deterministic packs, legal actions, custody and replay suites | Cardforge schema | `domain.cardforge=typescript` |
| Map discovery and celestial addresses | map/navigation/world records | `engine/gameplay`, `engine/world` | `typescript-authoritative` | discovery, travel and multi-location address fixtures | map/location schema | `domain.map=typescript` |
| Persistence encoding and journal decisions | `app/game/world-storage.ts` and persistence helpers | `engine/persistence` | `typescript-authoritative` | migration corpus, canonical hashes, crash/readback tests | explicit save version | `domain.persistence=typescript` |
| IndexedDB transactions and quota prompts | browser storage adapters | browser TypeScript adapter | `typescript-authoritative` | transaction/result and failure-injection tests | browser-owned API | not migrated |
| Multiplayer validation and authoritative deltas | `app/game/multiplayer*.ts` and host runtime | `engine/network`, `engine/gameplay` | `typescript-authoritative` | host/guest, interest, reconnect and desync replay suites | network protocol version | `domain.multiplayer=typescript` |
| WebRTC objects and signaling | browser multiplayer adapters | browser TypeScript adapter | `typescript-authoritative` | connection lifecycle and backpressure tests | browser-owned API | not migrated |
| Agent command validation and leases | `app/game/agent-*.ts`, host runtime | `engine/gameplay`, `engine/network` | `typescript-authoritative` | authority, lease, permissions and soak suites | agent protocol version | `domain.agents=typescript` |
| Render extraction records | current scene/runtime state | `engine/render` | `typescript-authoritative` | renderer-independent fixture envelopes and bandwidth budgets | render schema; not saved | `domain.render-extract=typescript` |
| Terrain rendering | Three.js world renderer | `engine/render-wgpu` | `typescript-authoritative` | dual-render terrain gallery, seams, device-loss and frame metrics | presentation only | `renderer=three` |
| Creature, item, prop and machine rendering | Three.js procedural model modules | `engine/render-wgpu` | `typescript-authoritative` | canonical model/animation galleries and instance budgets | presentation only | `renderer=three` |
| Particles, weather, sky and celestial rendering | Three.js effects/environment modules | `engine/render-wgpu` | `typescript-authoritative` | transparent-order, atmosphere and temporal galleries | presentation only | `renderer=three` |
| HUD, panels and accessibility | React/CSS/browser DOM | none; remains TypeScript | `typescript-authoritative` | browser interaction and accessibility checks | UI preferences | not migrated |
| Input event sampling | browser runtime | none; remains TypeScript adapter | `typescript-authoritative` | input-frame sequencing and focus/pointer-lock tests | runtime only | not migrated |
| Audio and TTS playback graph | `app/game/audio.ts`, `agent-voice.ts` | none; remains TypeScript adapter | `typescript-authoritative` | cue sequencing, spatial audio and permissions | browser-owned API | not migrated |

### Current player block-edit implementation note (not a ledger promotion)

Isolated candidate artifact `0fa627431b7dc75ec987e8ab6f99e8e565853ad13e62539bf4aa12fcbf378ca9` first advertised `native-block-edit-receipt-v1`. Runtime schema V13 retains the independent bounded BWZ7/BWY7 receipt stream, and the browser can checkpoint, project, save, and acknowledge a generic accepted block edit without an optimistic TypeScript mutation. R60 browser evidence under `work/hybrid-rust-migration/browser/generic-block-edit-r5-0fa62743-20260828-rerun-60/` proves one exact Survival Dirt mine/pickup/place/mine cycle, its native drop, durable reload, and the separate native Moonberry drop/re-pickup custody loop.

Successor candidate `4a1cfa2695e1f4f2dc4da4f042dcb00c023b9cebbb50ffb0d9e1924d28948222` adds one tightly gated schema-2 directional single-cell placement class and retains exact facing through receipt/history/restore. Its non-Dirt browser gate under `work/hybrid-rust-migration/browser/generic-grass-4a1cfa26-20260828-rerun-4/` proves one exact content-bound `Meadow Grass` (`73`) mine to Air, an unchanged selected inventory stack, its Rust-generated item-73 self-drop, checkpoint-before-projection ordering, Save & Quit/full reload, and the restored live empty cell plus native drop. All 17 coverage checks, 26 verifier tests, error streams, source/candidate/canonical immutability checks, owned-process cleanup checks, title raster checks, and seven manual frame reviews pass.

Latest successor `e2ad533c785ce25500645b9e5029f7ea1e6b0de731913261f3169807d07b2ce8` advances the runtime to V14 and advertises `native-block-edit-receipt-v2` without changing the V1 BWZ7/BWY7 bytes. BWZ8/BWY8 carries the complete V1 receipt plus exact receipt-bound Rust dirty evidence. In the accepted Meadow Grass slice, the browser consumes its ordered section, column, seven subsystem seeds, and canonical evidence hash as the sole topology-invalidation source. Browser gate `work/hybrid-rust-migration/browser/generic-grass-e2ad533c-20260828-rerun-5/` passes all 18 checks, including checkpoint-before-projection custody, the Rust-authored dirty projection, durable save/full reload, restored Air cell and native item-73 drop, source/candidate/canonical immutability, zero error streams, complete owned-process cleanup, raster validation, and seven manual frame reviews.

Newest isolated successor `f2329be23061738404ed5d94f5889a08125738387192fd58000e097d35f59e6d` admits exactly three content-bound static shaped single-cell profiles: Giant Mooncap block/item 38 and Sealed Barrel block 131/item 271 are direct; Wildwood Shelf block 130/item 270 is directional. The predicate seals the exact item, shape, topology, plain-stack, Air-replacement, and mapped-item-loot semantics. Builder place/mine is inventory-neutral and drop-free; Survival place debits one and mine creates one native mapped-item drop. Arbitrary shapes plus dynamic/interactive/connected/liquid/collision-height/rooted/durability/luck/contextual behavior remain rejected. Gate `work/hybrid-rust-migration/browser/generic-shaped-prop-f2329be2-20260830-rerun-18-mode-cas/` witnesses only Shelf: it selects native item 270 from the Creative catalog, places an east-facing Wildwood Shelf at `(2,37,-4)`, preserves the exact cell/facing/inventory/cursor through Save & Quit and a Worlds UI mode change, hydrates the same world in Survival, mines the shelf to Air with facing cleared, creates one native item-270 drop, and restores the exact Air cell, drop identity, inventory, and cursor after another save and full reload. All 24 live checks, 49 verifier tests, 13 original-resolution manual frame reviews, error streams, immutable-tree checks, and owned cleanup pass.

That evidence is deliberately narrower than the `Player block edits and dirty propagation` row. Rust dirty evidence is consumed for one exact bounded Meadow Grass projection and one Wildwood Shelf placement/mine path, but bedrock, multi-cell and rooted-tree edits, remaining topology-changing shapes, collision-height/connected/vertical-connected/liquid behavior, broader contextual or non-Air schema-2 consequences, rooted-tree durability, luck-adjusted generated loot, complete quest/multiplayer consequences, canonical selector promotion, and a rollback release window remain open. The bounded candidate path has accepted forward-only same-session finalize recovery. Physical hotbar input queues behind the immutable successor, Save & Quit/shutdown drains the tracked retry, and any successor/context/pump/drop drift remains fail-closed. Live gate `work/hybrid-rust-migration/browser/generic-grass-recovery-e2ad533c-20260830-rerun-2/` proves one post-projection active-world document failure, byte-exact document/catalog rollback, retained receipt/checkpoint custody, a causally marked Save & Quit retry before acknowledgement, a settled write after acknowledgement, and fresh restoration. This closes the prior restart-only debt for the exact Meadow Grass slice, but the row remains `typescript-authoritative` because its broader semantic and promotion gates are unchanged.

### Current saved-world player-mode implementation note (not a ledger promotion)

The same `f2329be2...` candidate advertises `player-game-mode-set-v1`. BWM7 requests bind the exact actor/player/external-entity custody, expected Creative state and flags, and expected simulation revision/state hash; BWN7 receipts prove one Simulation-only successor. Stale or contradictory custody rejects atomically. Survival clears Creative and Flying while preserving unrelated Mounted state, and Builder enables Creative without inventing flight. Restored-world reconciliation performs the native CAS, exact immediate readback, one native checkpoint, and post-checkpoint readback before terrain residency, input, or rendering opens.

The shaped-prop gate proves the actual Worlds UI changing one saved world from Builder to Survival through exactly one native mode call, flags `3 -> 0`, simulation revision `192 -> 193`, and one committed checkpoint while preserving its world-edit and inventory custody. Focused coverage passes 3/3 Rust engine tests, 1/1 Wasm dispatch test, and 36/36 TypeScript codec/reconciliation/wiring tests. This closes a concrete saved-metadata/native-player split-brain path, but the `Player physics, swimming, mounts and damage` row remains `typescript-authoritative` pending complete player-simulation custody, canonical promotion, rollback releases, and the broader acceptance matrix.

## Transfer and failure authority

BWEP uses transferable buffers, but transfer does not transfer gameplay authority. Each transferred response carries an epoch and optional 64-bit ownership token. The receiving side must explicitly return tokened buffers through `BufferRelease`; diagnostics retain outstanding buffer count/bytes. A worker panic invalidates only that worker generation. TypeScript remains authoritative in R0, so an absent artifact, schema mismatch, timeout, or crash disables the shadow path without altering a save.

No fallback may synthesize Rust state. When Rust eventually becomes authoritative, fallback requires a synchronized checkpoint or explicit world reload; simply switching a selector after a panic is not sufficient.

## Promotion record template

Add one record when changing a row:

```text
date / commit:
domain:
old mode -> new mode:
protocol / schema / content hash:
parity suites and replay artifacts:
performance and browser evidence:
save migration and readback evidence:
multiplayer evidence:
rollback flag and expiry:
known accepted semantic differences:
reviewer:
```

R0 adds contracts only. It does not promote a gameplay domain, change a public selector, download Rust on `/wiki`, or make an unavailable Wasm artifact a startup dependency.
