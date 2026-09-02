# R6 entity wire fixtures

`r6-entity-domain-wire-v1.json` is authored by Rust production codecs, not by the
TypeScript implementation under test. Its registry fingerprint binds all five
request families and four receipt families to the canonical R5-R9 manifest.

Reproduce or verify it from the repository root:

```powershell
cargo run --manifest-path engine/Cargo.toml -p blockwild-engine --example r6_entity_domain_wire_fixture -- --check
cargo test --manifest-path engine/Cargo.toml -p blockwild-engine --test r6_entity_domain_wire_fixture
node --import tsx --test tests/rust-integrated-runtime-r6-schema-fixture.test.ts
```

After an intentional wire change, run the emitter with `--write` and inspect the
fixture diff. Never regenerate the fixture with the TypeScript codec.

The fixture covers all 29 BWE6 command tags and all 24 BWA6 event tags, high-byte
Unicode, full-u64 identities/revisions, typed opaque-extension bytes, exact
native receipt decoding, malformed envelopes, nested-schema tampering after
checksum resealing, and the integrated 256-command/event limit.

`RustIntegratedEntityCommandBatchWireV1` is a wire representation. Typed component
and dormant-summary commands retain validated BWEA projection bytes so that
decoding does not synthesize or silently rewrite Rust's projection shell. It is
not the worker's semantic `RustEntityCommandBatchR6` contract and does not itself
perform an authority transition.

## Complete entity-authority hash verification

`tests/fixtures/rust-engine/r6/entity-authority-hashes-v2.json` contains six further
Rust-authored semantic vectors. Each includes a canonical snapshot, its native
authority hash, an import request, and its matching receipt. The vectors cover
empty state, absent versus zero sequence, plain records with optional components
absent, rich hot/cold records with every optional component present, and full-u64
revision/sequence cursors. The rich state includes all seven blackboard tags,
allocator gaps and a despawned generation, every dormant-summary field, extension
bytes, signed zero, subnormal/max-finite f32, signed/unsigned integer limits,
BOM-only/BOM-prefixed text, and UTF-8 map ordering that differs from UTF-16 order.

Native `EntityAuthority::canonical_hash` is exactly the native two-lane
`CanonicalHasher` with domain `blockwild.entity.authority.v2`, followed by
`write_bytes(encode_entity_authority_snapshot(state))`. Consequently, the complete
semantic hash includes every canonical BWEA field, including slots, free-list
history, outer/entity revisions, optional tags and all nested component bytes.
`computeRustEntityAuthorityHashR6V2` independently validates and serializes the
decoded TypeScript state before applying this domain and length framing. It never
uses an embedded expected hash or unchecked incoming packet bytes as its input.
The serialized f32-normalized state is validated again to reject underflow that
would invalidate a positive bound. Maps and accepted unsorted free-list packets
are normalized to native ordering; signed-zero bits and U+FEFF are preserved.

`assertRustEntityAuthorityHashR6V2` compares that result with an expected hash;
`decodeAndVerifyRustEntityAuthoritySnapshotR6V2` combines decoding and verification.
The integrated BWU6 decoder accepts an expected BWI6 request for attestation, and
`validateRustIntegratedEntityAuthorityImportReceiptV1(operation, request)` also
checks the enclosing domain, generated type/schema, and payload hash. Attestation
binds the previous revision, resulting revision, resident count and independently
recomputed authority hash to the imported snapshot. Calling the raw receipt
decoder without a request remains wire decoding only, not semantic attestation.

```powershell
cargo run --manifest-path engine/Cargo.toml -p blockwild-engine --example r6_entity_authority_hash_fixture -- --check
cargo test --manifest-path engine/Cargo.toml -p blockwild-engine --test r6_entity_authority_hash_fixture
node --import tsx --test tests/rust-entity-authority-hash-r6.test.ts tests/rust-integrated-runtime-r6-schema-fixture.test.ts
```

Tests independently recompute every native hash, check all 459 rich decoded
semantic leaves for a hash change or invariant rejection, and reject resealed
nested-state, hash, revision/count and enclosing-operation tampering. Explicit
tests also cover optional presence, retained allocator history, invalid UTF-8,
unpaired UTF-16, duplicate maps, mirrored-field drift and f32 overflow/underflow.

Raw BWEA/BWEC payloads still require transport integrity checks when carried by an
integrated operation. A semantic hash establishes state agreement, not
cryptographic authenticity. These vectors do not establish every runtime command
outcome, linked-world validity of the deliberately extreme rich entities,
production-default cutover, or formal migration authority promotion.
