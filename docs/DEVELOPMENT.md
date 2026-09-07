# Development and validation

This file describes `edition/rust`. It is the maintained but unfinished Rust/Wasm conversion edition, paused at 9/32 formal acceptance. See [edition maintenance](EDITION_MAINTENANCE.md) before switching branches, [edition parity](EDITION_PARITY.md) before porting behavior, and [the paused-work handoff](PAUSED_WORK_HANDOFF_2026-09-07.md) for inherited failures.

## Environment

- Node.js 22.13 or newer
- Rust 1.91.1 with `rustfmt`, `clippy`, and `wasm32-unknown-unknown`
- A `wasm-bindgen-cli` version exactly matching `engine/Cargo.lock`
- Current WebGL browser with hardware acceleration
- WSL/Linux for the exact production Sites scripts (`bash`, `flock`, `sha256sum`, GNU `timeout`)

Use `npm ci`; do not update the lockfile incidentally.

```bash
git clone https://github.com/RedLynx101/blockwild.git
cd blockwild
git switch edition/rust
npm ci
```

## Iteration loop

1. Run the narrowest relevant Node test while changing a pure system.
2. Run `npx tsc --noEmit` and `npm run lint` before broad validation.
3. Exercise UI, interaction, model, lighting, or world changes in the browser.
4. Inspect screenshots and browser errors at desktop and narrow viewports.
5. Run `npm test` before a release commit.

For documentation, workflow, package-identity, Dependabot, artifact-routing, or Vercel changes, run `npm run test:edition-maintenance` and the repository contract. Do not regenerate Rust/Wasm artifacts during a maintenance-only change.

## Generated knowledge and art

`npm run build:wiki` writes the public knowledge index and five category shards from `app/game/wiki-content.ts`. Generated JSON is committed so static routes remain inspectable and host-independent.

`npm run cardforge:render-art` writes the selected canonical Full Art roster from production creature models. Review representative small, large, aquatic, flying, subterranean, and luminous creatures before publishing.

## Release discipline

`edition/rust` is not a release branch. Automatic Vercel Git deployment remains disabled, and current public endpoints belong to the TypeScript lineage. The last integrated verifier result remains 139/143 with four inherited failures; formal migration acceptance remains 9/32. No maintenance commit, build, or generated artifact promotes those states.

A future separately authorized Rust release could be complete only when:

- the intended files are committed and the worktree contains no accidental project changes;
- GitHub contains the exact commit;
- the Vercel deployment for that commit is ready and `blockwild.app` serves it;
- the Sites source and production version point at the same commit;
- the home route, `/wiki`, generated knowledge, and representative game flows are checked on the public origins.

Never commit `.blockwild-agent/`, environment values, browser session data, or ignored output directories.
