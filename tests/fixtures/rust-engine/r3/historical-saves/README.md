# R3 synthetic historical-format saves

These are deliberately authored regression fixtures, not archived saves from a user or a historical release. Their small timestamps and game-version labels are synthetic metadata. The generator-version and absent/present option fields exercise actual supported migration branches.

- `g16-omitted-settlement-pattern.blockwild.json`: generator 16, modern terrain profile, no settlement pattern or newer settlement controls. Import must retain the legacy scattered-settlement behavior while advancing to generator 18.
- `g17-modern-control.blockwild.json`: generator 17 with explicit modern settlement controls. Import must preserve them while advancing to generator 18.

Both contain 39 exact voxel edits in negative-coordinate chunks: a small standing platform, headroom, a visible Glowstone sentinel behind an explicitly saved Air cell, and two edits across a chunk boundary. Browser acceptance uploads the original file through the public IMPORT control, loads with real canonical Rust-primary workers, saves, hard reloads, and continues without importing or seeding storage again. The verifier pins each source file's SHA-256 and byte count and compares the entire edit set, generation options, and freshly derived catalog identity.

This fixture set defines an R3 historical terrain acceptance attempt, not an accepted migration. The 2026-09-02 canonical c7 run imports both documents with exact options and edits, but Continue refuses their unsupported rich native domains before gameplay. Full native historical-save adoption is still required; do not strip fields or loosen the world-only migration guard to satisfy this test. It does not promote R8 native persistence, prove IndexedDB terrain-cache eviction/rehydration, or cover generator-2 raw-key migration. Those remain separate gates. No fixture is a performance benchmark or a whole-game acceptance scenario.
