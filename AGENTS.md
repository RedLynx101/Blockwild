# Blockwild development workspace

## Checkout and ownership

- Use `C:\Users\NoahH\Desktop\CMU\Random\blockwild` on branch `main` unless the parent explicitly records a transition.
- Workers use this same checkout and branch with explicit, non-overlapping file ownership. Do not create worker worktrees, nested clones, temporary repository copies, or branch switches.
- The parent is the source integrator and owns Git refs, the index, staging, commits, merges, and final verification. Workers must not revert, clean, or overwrite other workers' changes.
- Start bounded work from a fresh minimal-context brief with authoritative file references; do not use full-history forks or carry an accumulated context into unrelated work.
- The source-checkout verifier may create synthetic Git repositories and a clean checkout under a named `work/` output solely for byte-preservation testing. This is a bounded test exception, not worker checkout provisioning; retain its report, then clean the exact generated fixture tree with independent canonical-path/link checks.

## Builds and caches

- The parent serializes dependency installs and all builds that write shared outputs. Use the existing bounded Sites install owner/lock; do not run a competing `npm ci`.
- Prefer one canonical `engine/target` for the pinned workspace. Cargo's normal target/profile/feature subdirectories may coexist. Serialize writers and verify package, toolchain, target, lockfile digest, profile, features, source digest, and artifact identity before consuming output.
- Allow at most one explicitly approved incompatible toolchain/configuration alternate target root, with an owner, reason, and retirement date. Do not create per-feature/profile roots by default.
- Cargo target output and ordinary dependency caches are disposable. Published artifacts and verification reports are separate retained evidence with provenance. Review combined target/cache storage at 20 GiB and stale material after 14 days; never perform automatic broad deletion. Any cleanup requires independent path/link checks and preservation accounting.

## Scope and handoff

- The source-repair campaign remains paused. This policy does not grant release, deployment, publication, migration-acceptance, or authority-promotion permission.
- Handoffs state changed files, checks run, observed failures, and remaining uncertainty. Record actual cwd, branch, HEAD, and dirty/untracked state at integration boundaries.
- Codex history/database cleanup is a separate proposal-only workstream.
