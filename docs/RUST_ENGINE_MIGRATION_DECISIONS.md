# Rust Engine Migration Decisions

This ledger records implementation-time architecture decisions that refine the approved master plan without reducing its workload. Every entry must state the evidence, the changed boundary, and the verification consequence.

## D-001 — Player collision moves with the R5 simulation boundary

**Status:** accepted during R0 audit  
**Plan impact:** sequencing clarification, no removed scope

The subsystem atlas originally labeled player physics, swimming, and mounts as R6 even though the detailed phase plan and R5 exit gates already assigned them to R5. The live TypeScript engine performs synchronous `world.getBlock` reads throughout collision, raycasting, stepping, swimming, and navigation. Promoting Rust world authority in R4 while leaving player collision in TypeScript would otherwise require either thousands of synchronous cross-worker voxel calls or a second writable authority copy.

The coherent boundary is therefore:

1. R4 publishes immutable, revisioned near-field read pages while Rust becomes authoritative for blocks and edits.
2. R5 ports player collision, swimming, knockback, ray queries, mounts, liquids, and bounded navigation together.
3. TypeScript may consume the R4 read mirror only as a temporary compatibility oracle. It never mutates it and it is retired when the R5 physics replay gate passes.

Verification must include loaded-state bits distinct from air, exact negative-coordinate floor behavior, current X/Y/Z sweep order and 0.14-block subdivision parity, stale-revision rejection, 30/60/120 Hz input replays, and manual control-feel review.

## D-002 — Basic Render Distance is construction-gated, not merely hidden

**Status:** implemented in R0  
**Plan impact:** fulfills the companion performance plan

When `NEXT_PUBLIC_BLOCKWILD_BASIC_RENDER_DISTANCE` is not explicitly `1`, effective basic distance equals full render distance and `BasicWorldRenderer` is never constructed. This prevents worker, material, geometry, camera-range, and queue costs rather than merely hiding its settings control. The old requested distance remains in `rememberedBasicRenderDistance`, and the explicit debug build still exercises the legacy path.

Telemetry reports a deliberate `feature-gated` zero-work state. Re-enablement still requires the measured gate in the Bedrock-inspired plan.

## D-003 — Resolve the plan's implementation-policy questions

**Status:** accepted for the full migration goal  
**Plan impact:** turns the proposal's open choices into testable defaults

- Keep the compatibility Wasm build through R4; do not narrow Blockwild's browser policy during foundation work.
- Keep Three.js as a separately loaded fallback for two measured stable releases after `wgpu` becomes primary. It is not an equal primary and receives no new authority.
- Treat cross-origin isolation and shared-memory workers as an optional accelerated profile until both hosted surfaces, multiplayer invitation flow, and all third-party resources pass COOP/COEP validation.
- Existing locations retain their recorded generator/content tuple. New generators require explicit location/world creation or a user-approved upgrade; edited terrain is never silently regenerated.
- Build and test a native headless engine and replay server. Do not add native desktop-client packaging to this migration.
- Compile validated content tables from designer-readable source into Rust and TypeScript outputs with one content hash; ordinary content must not require editing Rust enums.
- Retain a two-release synchronized rollback checkpoint for promoted world/simulation/gameplay domains and a longer evidence-based window for persistence. A panic cannot switch authority to an unsynchronized copy.

## D-004 — Split the Wasm engine and renderer artifacts

**Status:** accepted during R0 implementation  
**Plan impact:** preserves all renderer work while reducing mandatory startup cost

The compatibility artifact contains the small authoritative engine ABI and deterministic kernels. The `renderer-lab` variant adds Rust `wgpu`, the canonical render fixture, and the async browser smoke path. Both are content-addressed and built from the same lockfile/protocol, but the renderer module loads only for diagnostics or an explicit `wgpu` selector until renderer promotion.

This is not a renderer deferral: native and browser `wgpu` implementation, fixture parity, telemetry, and reviewed evidence remain R0-R2 gates. It simply prevents every compatibility browser from downloading the much larger renderer payload while Three.js is still the public default.

## D-005 — Terrain rollback is an explicit build, never a runtime switch

**Status:** implemented as a pre-promotion safety boundary
**Plan impact:** enforces the approved reload-only rollback policy without promoting the terrain ledger row

Terrain authority is selected once at compilation. The private `BLOCKWILD_WORLDGEN_BUILD_PROFILE` accepts exactly `rust-primary` (the default) or `typescript-rollback`; Next and Vite publish only that validated literal. URLs and public runtime environment variables cannot change terrain authority. A rollback therefore requires building and loading the rollback artifact, and returning to Rust requires another build and reload.

The rollback build creates no Rust terrain-generation workers and consequently cannot request a Rust terrain manifest. It displays a persistent rollback label, includes the profile in diagnostic build identity, and keeps explicit constructor and Node-test seams for deterministic tests. The profile is deployment metadata, not world data: generator-v18 saves, generation identities, exports, and imports remain byte/schema compatible across both builds.

[`RUST_ENGINE_ROLLBACK_WINDOWS.json`](./RUST_ENGINE_ROLLBACK_WINDOWS.json) is the machine-readable retirement gate. TypeScript terrain support remains available for at least two independently verified stable Rust-primary releases. Each schema-v2 `verifiedStableReleases` record has exactly five fields: a unique `releaseId`, an exact 40-character lowercase `commitSha`, `buildProfile: "rust-primary"`, one portable repository-relative or HTTPS `evidence` reference, and a canonical UTC `measuredAt` timestamp. Records are ordered by strictly increasing `measuredAt` and must also use distinct commits, so aliases or repeated measurements of one build cannot satisfy the window.

`retireAfter` is either `null` or the exact `releaseId` of a recorded qualifying release. A non-null anchor is valid only at the minimum-th or a later chronologically ordered record; retirement happens after that anchored release. No qualifying release has been recorded yet, so `verifiedStableReleases` remains empty and `retireAfter` remains `null`. The migration audit fails closed on malformed evidence, repeated identities or commits, non-Rust-primary profiles, missing measurement fields, early retirement, and unknown or premature retirement anchors.
