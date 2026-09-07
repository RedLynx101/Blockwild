# Development and validation

This file describes `edition/typescript`. See [edition maintenance](EDITION_MAINTENANCE.md) before switching branches and [edition parity](EDITION_PARITY.md) before porting behavior. The TypeScript branch owns the TypeScript simulation, Three.js renderer, and `blockwild-typescript-*` data/protocol namespaces; it does not consume Rust build output.

## Environment

- Node.js 22.13 or newer
- Current WebGL browser with hardware acceleration
- WSL/Linux for the exact production Sites scripts (`bash`, `flock`, `sha256sum`, GNU `timeout`)

Use `npm ci`; do not update the lockfile incidentally.

Clone or switch explicitly:

```bash
git clone https://github.com/RedLynx101/blockwild.git
cd blockwild
git switch edition/typescript
npm ci
```

Before a branch transition, stop checkout-owned jobs, verify clean tracked/index state, inventory untracked and ignored target collisions, and never force the switch or carry tracked edits into the other edition.

## Iteration loop

1. Run the narrowest relevant Node test while changing a pure system.
2. Run `npx tsc --noEmit` and `npm run lint` before broad validation.
3. Exercise UI, interaction, model, lighting, or world changes in the browser.
4. Inspect screenshots and browser errors at desktop and narrow viewports.
5. Run `npm test` before a release commit.

For documentation, workflow, package-identity, Dependabot, or Vercel routing changes, run `npm run test:edition-maintenance` and the repository contract. These focused checks must not invoke Rust builds.

## Generated knowledge and art

`npm run build:wiki` writes the public knowledge index and five category shards from `app/game/wiki-content.ts`. Generated JSON is committed so static routes remain inspectable and host-independent.

`npm run cardforge:render-art` writes the selected canonical Full Art roster from production creature models. Review representative small, large, aquatic, flying, subterranean, and luminous creatures before publishing.

## Release discipline

`edition/typescript` is the intended GitHub default and future release branch. Automatic Vercel Git deployment remains disabled during the staged transition. A separately authorized release is complete only when:

- the intended files are committed and the worktree contains no accidental project changes;
- GitHub contains the exact commit;
- the Vercel deployment for that commit is ready and `blockwild.app` serves it;
- the Sites source and production version point at the same commit;
- the home route, `/wiki`, generated knowledge, and representative game flows are checked on the public origins.

Never commit `.blockwild-agent/`, environment values, browser session data, or ignored output directories.
