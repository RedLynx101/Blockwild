# Edition maintenance contract

Contract version: **1**
Effective: **2026-09-07**

Blockwild has two independently maintained editions. They share product intent and selected specifications, but they do not share an implementation branch or a routine whole-branch merge workflow.

| Edition | Branch | Runtime | Current gate |
| --- | --- | --- | --- |
| TypeScript | [`edition/typescript`](https://github.com/RedLynx101/blockwild/tree/edition/typescript) | TypeScript simulation and Three.js renderer | Accepted local baseline at `0a7e20165a81e3dacde946270d2525f7a790a54c`; intended GitHub default and future release source |
| Rust | [`edition/rust`](https://github.com/RedLynx101/blockwild/tree/edition/rust) | Rust/Wasm authority with browser adapters and the developing `wgpu` path | Maintained but unfinished at `dbba2226819a88946d9a4549df0bd5b0fbd02f28`; 9/32 formal criteria accepted |

The immutable [`baseline/typescript-pre-conversion-2026-08-11`](https://github.com/RedLynx101/blockwild/tree/baseline/typescript-pre-conversion-2026-08-11) tag preserves the untouched historical TypeScript starting point. It is evidence, not a development branch.

## Checkout ownership and branch transitions

Use one canonical checkout. The source integrator owns Git refs, the index, commits, branch transitions, installs, and builds. Workers stay on the branch named in their brief and do not create worktrees, clones, or branch switches.

Before every edition switch:

1. Stop checkout-owned servers, browsers, tests, builds, and Cargo jobs.
2. Record the current directory, branch, `HEAD`, tracked diff, index diff, and untracked/ignored paths.
3. Compare paths that are tracked only by the target branch against existing untracked or ignored paths. A target collision must be preserved or resolved explicitly; never use a force switch or broad clean.
4. Commit the complete bounded change on the current branch. Do not carry tracked edits across editions.
5. Switch to the exact target branch and read its `AGENTS.md` before acting.
6. Treat every existing build output as stale until its edition, source, lockfile, toolchain, target, profile, and features match the checked-out source.

Routine merges between `edition/typescript` and `edition/rust` are prohibited. Port deliberate behavior through [the parity contract](EDITION_PARITY.md), then implement or selectively apply only the reviewed files or commit whose ownership fits the target edition. Never use a merge to import the other edition's runtime, generated engine artifacts, caches, or release assumptions.

## CI and required-check routing

Push triggers and pull-request base filters are branch-specific. A pull request targets the edition it changes.

| Workflow / check | TypeScript base | Rust base | Contract |
| --- | --- | --- | --- |
| Edition routing and maintenance contract | `edition/typescript` | `edition/rust` | Must pass before costly jobs; validates branch identity, commands, workflow targets, dependency routing, parity docs, and deployment-trigger safety |
| Static analysis and generated content | required | required | Node 22.13.1, repository contract, type check, lint, generated-source drift |
| Full deterministic suite | required | required, existing migration failures remain visible | Runs the edition's declared `npm test`; no `continue-on-error` |
| Vercel production build | required as a build check | required as a build check, not a release claim | Runs the branch's declared `build:vercel`; Git deployment remains disabled |
| Rust native/Wasm/browser contract | absent | required when its path filter matches | Rust 1.91.1 native, Clippy, tests, replay/render fixtures, Wasm, browser contracts, gate report, and generated-artifact drift |
| CodeQL adapter analysis | required when repository visibility permits | required when repository visibility permits | JavaScript/TypeScript analysis remains separate from Rust runtime acceptance |
| Dependency review | required | required | Targets the pull request's edition base |

The Rust branch's last preserved integrated verifier result is 139/143 with four inherited failures documented in `docs/PAUSED_WORK_HANDOFF_2026-09-07.md`. Its formal migration readiness remains 9/32. Those failures may keep runtime jobs red; the small edition-contract job distinguishes split-induced routing/configuration regressions without disabling, waiving, or masking the inherited gates.

## Cache and artifact identity

CI cache keys include the edition, operating system, pinned toolchain, and relevant lockfile digest. TypeScript npm caches use the `blockwild-typescript-npm-...` prefix. Rust npm and Cargo caches use `blockwild-rust-npm-...` and `blockwild-rust-cargo-...`; Cargo keys also identify Rust 1.91.1 and `engine/Cargo.lock`.

The Rust migration-gate upload is named with the Rust edition, toolchain, and exact Git SHA. TypeScript build output is job-local in E4 and is not a deployable release artifact. Local `dist`, `.next`, `.sites-runtime`, `engine/target`, `public/engine`, and `public/renderer` output must not cross an edition boundary without a matching identity receipt.

## Deployment and release boundary

Both branches commit this repository-level Vercel guard:

```json
{
  "git": {
    "deploymentEnabled": false
  }
}
```

Vercel documents the boolean form as disabling automatic Git deployments for all branches in the project: [Git configuration](https://vercel.com/docs/project-configuration/git-configuration#turning-off-all-automatic-deployments). This source configuration does not change provider settings, deploy anything, or authorize a deployment.

The TypeScript edition is the intended GitHub default, but its automatic Git deployment remains disabled until a separately authorized controlled transition. A future release must prove the exact TypeScript commit across GitHub, Vercel, Sites, and visible live behavior. The Rust edition must remain deployment-disabled while unfinished; 9/32 acceptance, a successful build, or a generated artifact is not release readiness.

## Dependency updates

Dependabot updates on each branch explicitly target that edition. The TypeScript branch owns npm and GitHub Actions updates only. The Rust branch owns npm, GitHub Actions, and Cargo updates. Cross-edition update PRs are separate even when versions coincide.
