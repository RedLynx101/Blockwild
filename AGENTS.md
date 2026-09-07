# Blockwild development workspace

## Checkout and ownership

- Use `C:\Users\NoahH\Desktop\CMU\Random\blockwild` on branch `edition/rust` unless the parent explicitly records a transition.
- Workers use this same checkout and branch with explicit, non-overlapping file ownership. Do not create worker worktrees, nested clones, temporary repository copies, or branch switches.
- The parent is the source integrator and owns Git refs, the index, staging, commits, merges, and final verification. Workers must not revert, clean, or overwrite other workers' changes.
- Before switching editions, drain checkout-owned jobs; record cwd, branch, HEAD, tracked/index state, and untracked/ignored paths; compare target-only tracked paths for collisions; commit the bounded work; then use a normal non-forced switch and read the target `AGENTS.md`.
- Port behavior through a shared specification or a reviewed selective commit. Do not routinely merge implementation history from `edition/typescript`.
- Start bounded work from a fresh minimal-context brief with authoritative file references; do not use full-history forks or carry an accumulated context into unrelated work.
- The source-checkout verifier may create synthetic Git repositories and a clean checkout under a named `work/` output solely for byte-preservation testing. This is a bounded test exception, not worker checkout provisioning; retain its report, then clean the exact generated fixture tree with independent canonical-path/link checks.

## Builds and caches

- The parent serializes dependency installs and all builds that write shared outputs. Use the existing bounded Sites install owner/lock; do not run a competing `npm ci`.
- Prefer one canonical `engine/target` for the pinned workspace. Cargo's normal target/profile/feature subdirectories may coexist. Serialize writers and verify package, toolchain, target, lockfile digest, profile, features, source digest, and artifact identity before consuming output.
- Allow at most one explicitly approved incompatible toolchain/configuration alternate target root, with an owner, reason, and retirement date. Do not create per-feature/profile roots by default.
- Cargo target output and ordinary dependency caches are disposable. Published artifacts and verification reports are separate retained evidence with provenance. Review combined target/cache storage at 20 GiB and stale material after 14 days; never perform automatic broad deletion. Any cleanup requires independent path/link checks and preservation accounting.

## Scope and handoff

- This branch is the maintained Rust-conversion edition. It is explicitly unfinished; do not describe it as the default or production-ready edition without current acceptance evidence.
- Rust CI, Cargo caches, Wasm/renderer artifacts, and migration reports must include edition, pinned toolchain, lock/source identity, and exact Git SHA as applicable. Do not consume TypeScript edition outputs as Rust evidence.
- The source-repair campaign remains paused at 9/32 formal acceptance. Work on this edition does not resume that campaign unless a separate handoff explicitly says so.
- This policy does not grant release, deployment, publication, migration-acceptance, or authority-promotion permission.
- Repository-level Vercel Git deployment remains disabled. A build or a `LIVE` provider label is not Rust release evidence.
- Handoffs state changed files, checks run, observed failures, and remaining uncertainty. Record actual cwd, branch, HEAD, and dirty/untracked state at integration boundaries.
- Follow `docs/EDITION_MAINTENANCE.md` and update `docs/EDITION_PARITY.md` before porting behavior. Parity approval does not authorize a merge, push, provider mutation, or deployment.
- Codex history/database cleanup is a separate proposal-only workstream.
