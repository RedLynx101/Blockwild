# Integrated runtime domain wire registry

`integrated-runtime-r5-r9.v1.json` is the closed, machine-checked registry for
domain-operation payloads carried by the canonical `BWRQ`/`BWRS` command
boundary. Specifically, it describes `RuntimeDomainOperationV1` requests in a
`BWRQ` `RuntimeRequestV1::Command` and the corresponding domain receipts inside
an accepted `BWRS` `RuntimeResponseV1::CommandReceipt`. It is not a catalog of
every request or response variant that the two coarse envelopes can carry.

Each R5-R9 request and receipt family has its own descriptor, including
families that share a type ID but use different packet magic bytes.

## Verified scope - 2026-09-02

All 69 registered families now have Rust-authored byte vectors with TypeScript
decoding and exact re-encoding. This is family coverage, not proof that every
semantic command variant or authority transition is complete.

| Domain | Families | Wire convergence | Remaining gate |
| --- | ---: | --- | --- |
| R5 simulation | 18 | Complete | None within this registry |
| R6 entities | 9 | Complete | None within this registry |
| R7 gameplay | 22 | Complete | None within this registry |
| R8 persistence commands | 2 | Complete | Bulk attachments are a separate boundary below |
| R9 networking | 18 | Complete | None within this registry |

R6 covers all 29 command tags and 24 event tags, with independent TypeScript
authority-hash recomputation from complete decoded BWEA state. Six further
native state vectors cover rich components, allocator history, integer/float
boundaries and optional presence; 459 semantic leaves are checked for hash
sensitivity or invariant rejection. Import receipts bind the expected request,
revisions, entity count and recomputed state hash.

R7 now exposes typed BWG7 transport for all 44 command/action variants (35
primary structures), not just schedule commands. Its 92 native vectors cover
nested enums and all 46 optional-field paths with independent command hashes.
BWK7 and BWG7 preserve optional actor `Some(0)` distinctly from absence; mandatory
linked combat IDs still reject zero. Native BWA7 receipts also recompute their
semantic hashes, and domain/scope sets reject noncanonical ordering.
See [R5 fixture scope](../../tests/fixtures/rust-engine/integrated-runtime-v1/r5-simulation-wire-v1.md),
[R6 fixture scope](r6-wire-fixtures.md), and [R7 fixture scope](R7_WIRE_FIXTURES.md).

R5 now shares the BWF6/BWF7 final-bind codec between native producers and Wasm.
Its BWO5 custody validation checks canonical metadata, exact 160-byte UTF-8 ID
bounds and the aggregate 256 KiB metadata limit. R8 covers all twelve dispatch
commands, both optional branches, exact safe-integer limits, Unicode controls,
preserved leading BOM identifiers, owned binary buffers and the aggregate
1 MiB packet cap. R9 has accepted real
Wasm-dispatch vectors for all nine outer operations and all five nested browser
packet kinds; rejection paths remain covered separately.

Completion here is **5/5 domain-operation wire-schema domains**, not completion
of the overall migration or production authority. The wire fingerprint remains
`f5fb5cab925d60512fb52436b26ef3f166f9865f84f8ee7bf43d3c7cd21ac177`;
the new evidence does not change the protocol revision.

## Isolated browser verification

Build a compatibility candidate without replacing `public/engine`:

```powershell
node scripts/build-rust-engine.mjs --package blockwild-wasm --variant compatibility --public-dir public/engine-schema-candidate
npm run verify:rust-schema-browser
```

The browser verifier requires the installed `develop-web-game` skill client at
`$env:USERPROFILE/.codex/skills/develop-web-game/scripts/web_game_playwright_client.js`.
The build provenance covers every file under `engine/`, including this README
and evidence bookkeeping; rebuild after those files change even if the wire
fingerprint and compiled Wasm bytes remain identical.
It validates candidate contents and current Rust source provenance, acquires
the repository browser mutex, and starts a loopback-only server. Chromium checks
all 14 R8 request vectors and both receipts, six R6 semantic states, 92 R7 command
vectors and a native zero-actor grant. A real Wasm runtime rejects corrupt inner
bytes without mutation, accepts an estimate with an exact BWRS/BWA8 receipt,
imports/exports an exact hash-attested entity state, and commits a granted
nonschedule gameplay command with the exact native BWA7 receipt. Its own runtime,
browser and server are closed after the check.

State, screenshot and cleanup evidence is retained under
`work/hybrid-rust-migration/schema-browser/<timestamp>/`. The accepted run
`2026-09-02T15-19-55-105Z` used artifact
`c7bfb66cb842b08ea722f3be306d85cbf2d018794a86944b153b9764d4d1e20b`
(Wasm SHA-256
`27581732bb4b6ac744b31ca870211b9656036b6f949b78f875f65c0fb54c1d30`).
All nine checks passed; the screenshot was manually reviewed at original
resolution. Source and canonical artifact content remained unchanged.

## Schema levels

The two schema fields attest different boundaries:

- `operationSchema` is the schema number on the outer
  `RuntimeDomainOperationV1`. The Wasm command dispatcher checks it alongside
  the domain and type ID before decoding the payload.
- `innerSchema` is the schema number encoded in the nested packet selected by
  `magic`. It belongs to that packet codec, not to `BWRQ`, `BWRS`, or the outer
  domain operation.

These numbers often match, but they are not aliases and may evolve
independently. For example, an outer operation can advance its dispatch schema
while retaining an inner packet schema of 1. Callers must check both rather
than infer one from the other.

## R8 bulk boundary

The R8 bulk platform lane is intentionally outside this registry. Its `BWRB`
request and `BWRC` response controls use `RuntimeBulkRequestV1` and
`RuntimeBulkResponseV1`, with a separately checksummed, sometimes detached
attachment. Complete persistence browser packets such as `BWPR`/`BWPA` travel
as those attachments, not as `RuntimeDomainOperationV1` payloads on the
`BWRQ`/`BWRS` command path.

The bulk persistence-status query and receipt (`BWS8`/`BWT8`) are likewise
inline fields of bulk request/response variants. They have nested packet
schemas but no `operationSchema` at the canonical domain-operation boundary.
Their contracts remain in the bulk and persistence codecs and tests. Excluding
them here does not mean that the packets are unsupported; it prevents two
different transport boundaries from being represented as one registry.

The registry generates:

- `app/game/rust-integrated-runtime-domain-schema.generated.ts`
- `engine/crates/blockwild-engine/src/runtime_domain_schema_generated.rs`

Do not edit those generated files by hand.

## Change workflow

1. Confirm the family is a `BWRQ`/`BWRS` domain operation, then change its
   manifest descriptor and concrete evidence paths.
2. Run `node scripts/verify-integrated-runtime-schema-convergence.mjs`.
3. If the wire contract changed, copy the reported computed SHA-256 into
   `fingerprint.value`, rerun the verifier, and generate both language
   registries with
   `node scripts/generate-integrated-runtime-domain-schema.mjs`.
4. Review the generated Rust and TypeScript diffs. Do not hand-edit them.
5. Run `npm run verify:rust-schema-convergence`, which checks generated output
   and requires all five domain-operation schemas to remain complete, then run
   `node --test tests/rust-integrated-runtime-domain-schema-generation.test.mjs tests/rust-schema-convergence.test.mjs`.

The fingerprint seals only the wire contract: protocol identifiers plus each
domain's phase, schema, requests, and receipts. Evidence, assurance, completion,
and source-path bookkeeping are deliberately excluded, so adding a test does
not create a false protocol revision.

A valid registry may still be partial. `completion` describes byte-vector,
cross-language, and real-Wasm evidence gaps. Registry coverage, generated
descriptors, or a green convergence check does not promote formal migration
authority, authorize a cutover, or satisfy a master-plan definition-of-done
checkpoint by itself.
