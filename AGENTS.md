# Blockwild TypeScript edition workspace

## Checkout and ownership

- Use `C:\Users\NoahH\Desktop\CMU\Random\blockwild` on branch `edition/typescript` unless the parent explicitly records a transition.
- Workers use this same checkout and branch with explicit, non-overlapping file ownership. Do not create worker worktrees, nested clones, temporary repository copies, or branch switches.
- The parent is the source integrator and owns Git refs, the index, staging, commits, merges, and final verification. Workers must not revert, clean, or overwrite other workers' changes.
- Start bounded work from a fresh minimal-context brief with authoritative file references; do not use full-history forks or carry accumulated context into unrelated work.

## Edition boundary

- This branch maintains the original TypeScript engine and Three.js renderer as an independent edition.
- Do not add dependencies on the Rust workspace, `public/engine`, or Rust/Wasm build artifacts unless a later handoff explicitly changes this edition boundary.
- Port behavior through a shared specification or a reviewed selective commit. Do not routinely merge implementation history from `edition/rust`.

## Builds and caches

- The parent serializes dependency installs and all builds that write shared outputs.
- Treat existing `node_modules`, `.next`, `dist`, Sites runtime, and other generated output as stale until its branch, lockfile, build profile, and source identity are verified.
- Rust target and Sites-runtime paths under `engine/` are ignored only to contain leftovers from edition switches. Do not use or delete them automatically.
- Published artifacts and verification reports are retained evidence. Any cleanup requires independent path/link checks and preservation accounting.

## Scope and handoff

- The immutable `baseline/typescript-pre-conversion-2026-08-11` tag records the untouched historical starting point. Apply fixes in later commits on this branch.
- The separate Rust source-repair campaign remains paused at 9/32 formal acceptance.
- Handoffs state changed files, checks run, observed failures, current branch and HEAD, and remaining uncertainty.
