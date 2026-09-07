# Blockwild edition parity

Parity specification version: **1**
Recorded: **2026-09-07**

Parity is a reviewed behavioral contract, not shared implementation history. The TypeScript and Rust editions may use different architectures, storage engines, protocols, and renderers while producing the same player-observable behavior where a row requires parity.

## Status vocabulary

- `not-present`: the edition has no supported implementation of the specified behavior.
- `implemented`: relevant code exists, but the behavior has not passed the row's evidence gate at the recorded implementation SHA.
- `verified`: the behavior passed the listed deterministic, browser, preservation, or release evidence at the recorded implementation SHA.

Only these three words are parity statuses. A build passing does not promote a row from `implemented` to `verified`. A `not-present` row is an explicit gap, not a defect waiver.

## Compatibility boundaries

- TypeScript owns `blockwild-typescript-*` localStorage, cache, identity, rendezvous, and WebRTC protocol names.
- Rust owns `blockwild-rust-persistence-v1` IndexedDB and its Rust/Wasm artifact and protocol identities.
- Normal startup in either edition must not import, normalize, delete, or claim ownership of the other edition's records.
- The TypeScript raw previous-data download preserves an allowlisted set of localStorage strings. It is not a whole Rust IndexedDB backup and must not be described as one.
- No automatic cross-edition save import or converter is supported. A future converter requires a versioned schema, source-preservation proof, explicit user action, rejection tests, rollback semantics, and separate acceptance.
- Cross-edition multiplayer is rejected at the protocol boundary before payload handling. Behavioral parity does not imply wire compatibility.
- Shared source art may be selectively mirrored. Generated Three.js, Wasm, `wgpu`, cache, and deployment artifacts are edition-specific even when their source assets match.

## Initial matrix

Recorded runtime baselines: TypeScript `0a7e20165a81e3dacde946270d2525f7a790a54c`; Rust `dbba2226819a88946d9a4549df0bd5b0fbd02f28` with preserved `engine` tree `6e6e5ca4fa31eb9645c9a87532bf7198681d8266`.

| ID | Player-observable contract | TypeScript | Rust | Required evidence / recorded difference |
| --- | --- | --- | --- | --- |
| BW-PAR-001 | Edition identity is visible in repository, storage, cache, and protocol ownership. | verified | implemented | TypeScript E3 isolation tests and browser writes passed. Rust branch identity is preserved, but the paused 9/32 audit prevents blanket verification. |
| BW-PAR-002 | A new world can be created, played, saved, left, and continued without reading or mutating the other edition's data. | verified | implemented | TypeScript E3 browser acceptance proved create/play/save/Continue and exact generic/Rust sentinels. Rust persistence code exists; its broader acceptance remains paused. |
| BW-PAR-003 | A user can make a supported backup using that edition's own UI without silently converting formats. | verified | implemented | TypeScript exact-string localStorage backup passed, with Rust IndexedDB explicitly not collected. Do not claim the Rust export path usable until its own UI and byte-preservation gate passes. |
| BW-PAR-004 | Automatic cross-edition save import does not occur. | verified | implemented | TypeScript normal startup and unsupported-import rejection passed. Rust needs an edition-specific non-import preservation receipt before verification. |
| BW-PAR-005 | Same-edition multiplayer reaches connected gameplay, reliable chat, and host-owned world state; other-edition envelopes fail closed. | verified | implemented | TypeScript strict-local two-client transport opened all three channels, delivered chat, synchronized the host seed, and rejected generic/Rust protocols. Rust adapter/protocol work exists but is not accepted at 9/32. |
| BW-PAR-006 | The edition's primary renderer presents a playable world with no opposite-edition runtime dependency. | verified | implemented | TypeScript E3 production/browser evidence covers the Three.js path and its CI forbids Rust build assumptions. Rust `wgpu`/Wasm paths remain part of the unfinished migration. |
| BW-PAR-007 | Core saves, multiplayer authority, deterministic generation, and visible content changes are specified before they are ported. | implemented | implemented | Version 1 establishes the process; each future behavior needs a filled specification and evidence on both implementation SHAs. |
| BW-PAR-008 | Automatic Git deployment is disabled until the edition has separate publication authority. | implemented | implemented | Each E4 branch commits `git.deploymentEnabled: false`; verification belongs to the edition-maintenance validator. This is a source guard, not provider-state proof. |
| BW-PAR-009 | Automatic cross-edition save conversion is available. | not-present | not-present | Deliberately unsupported. A converter cannot be inferred from raw backup, Rust persistence, or shared world schemas. |
| BW-PAR-010 | The Rust edition is release-ready. | not-present | not-present | Formal readiness is 9/32 with inherited verifier failures; maintained does not mean released or abandoned. |

## Behavior specification template

Copy this block for every new parity obligation or deliberate divergence:

```text
ID: BW-PAR-NNN
Spec version:
Owner and review date:
Player-observable behavior:
Preconditions and inputs:
Authoritative state owner:
Determinism/version rules:
Expected outputs and failure behavior:
TypeScript implementation SHA:
TypeScript status: not-present | implemented | verified
TypeScript evidence:
Rust implementation SHA:
Rust status: not-present | implemented | verified
Rust evidence:
Save compatibility boundary:
Protocol compatibility boundary:
Asset/artifact compatibility boundary:
Known divergence and rationale:
Rollback or recovery rule:
```

## Deliberate porting procedure

1. Write or revise one behavior specification and assign a new spec version before implementation.
2. Record each edition's starting SHA and status. Do not copy a `verified` label across editions.
3. Identify authoritative state, determinism, save, protocol, asset, accessibility, and performance boundaries.
4. Implement on one edition branch without merging the other edition's implementation history.
5. Port through the specification or a reviewed selective commit whose files belong to the target edition.
6. Run the target edition's focused deterministic gates. Add production-shaped browser or preservation evidence when the row requires it.
7. Update the matrix with exact implementation SHAs and evidence. Promote to `verified` only for the edition that passed.
8. Release each edition through its own CI and publication gate. Parity acceptance never authorizes deployment.

Selective mirroring is appropriate for specifications, prose, source-owned media, and neutral fixtures. Runtime authority, persistence adapters, protocol codecs, generated engine output, caches, and deployment artifacts remain branch-owned unless a specification explicitly says otherwise.
