# Contributing to Blockwild

Blockwild is an active game prototype with tightly connected simulation, save, multiplayer, visual, and content systems. Small changes can have wide effects. Discuss substantial features before investing in a large implementation.

By contributing, you agree that your contribution may be distributed under the repository's [MIT License](LICENSE).

## Choose an edition

Target exactly one maintained branch:

- `edition/typescript` owns the TypeScript simulation and Three.js renderer and is the intended GitHub default.
- `edition/rust` owns the unfinished Rust/Wasm conversion and developing `wgpu` path. It remains at 9/32 formal acceptance and is not release-ready.

After cloning, run `git switch edition/typescript` or `git switch edition/rust`, then read that branch's `AGENTS.md` and [edition maintenance contract](docs/EDITION_MAINTENANCE.md). Open the pull request against the same edition branch. Do not routinely merge one edition into the other; port shared behavior through [the versioned parity specification](docs/EDITION_PARITY.md) or a reviewed selective commit.

## Before opening a change

1. Search existing issues, the [roadmap](ROADMAP.md), and the relevant design contract under `docs/`.
2. Keep a change focused. Separate generated assets, mechanics, and unrelated cleanup when that makes review safer.
3. Do not include API keys, world exports, player/session data, `.blockwild-agent/`, ignored work artifacts, or third-party assets without documented redistribution rights.

## Local validation

Use Node.js 22.13 or newer. Install from the lockfile with `npm ci`.

Run the smallest relevant checks while iterating, then run the release gates before asking for merge:

```bash
npm run lint
npm test
```

On this TypeScript branch, `npm test` contains no Rust/Cargo build. Run `npm run test:edition-maintenance` for branch identity, CI routing, and deployment-trigger safety changes.

Focused suites are listed in the root README. Visual work must also be exercised in the running game at representative desktop and narrow/mobile sizes. Inspect the actual output; snapshots and type checks do not establish visual quality.

## Engineering contracts

- Keep real-time simulation in the engine, not React render state.
- Preserve deterministic generation. Generator changes need explicit version and compatibility reasoning.
- Normalize every new persisted field and retain safe defaults for older saves.
- Preserve host authority and bounded codecs in multiplayer.
- Treat `mob-models.ts` and the approved creature theme documents as the canonical geometry source. Update dimensions, animation, collision, portraits, and tests together.
- Use the live item, mob, plant, and biome registries to extend the wiki; do not hand-maintain duplicate catalogs.
- Keep local player feedback immediate while heavy derived chunk work remains budgeted.
- Avoid unbounded per-frame scans, per-entity allocations, and duplicated geometries or materials.

## Art, audio, and generated assets

Record the source, date, tool, license or ownership basis, prompt/reference constraints where relevant, and review status of new media. Generated creature imagery must stay locked to the approved canonical model or reference. Reject anatomy drift, generated text, watermarks, copied characters, incompatible trade dress, and unreadable silhouettes.

Temporary review files belong in ignored `output/`, `outputs/`, or `work/`. Commit only production assets and the scripts or provenance notes needed to reproduce or audit them.

## Pull requests

Explain the player-facing outcome, compatibility impact, performance risk, tests run, and any visual evidence. Call out deliberate tradeoffs. Do not describe a deployment, migration, or browser test as completed unless it actually ran against the exact submitted commit.

Name the target edition and parity-spec ID when behavior is intended to exist in both editions. A passing check on one branch does not transfer `verified` status to the other.
