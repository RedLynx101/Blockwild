# R5 simulation wire fixtures

`r5-simulation-wire-v1.json` is authored by the native production codecs through
`engine/crates/blockwild-engine/examples/r5_simulation_wire_fixture.rs`. It lists
all nine request and nine receipt families from the generated R5 registry.
The emitter does not read TypeScript output or the checked JSON to build bytes.

Check reproducibility from the repository root:

```powershell
cargo run --manifest-path engine/Cargo.toml -p blockwild-engine --example r5_simulation_wire_fixture -- --check
cargo test --manifest-path engine/Cargo.toml -p blockwild-engine --test r5_simulation_wire_fixture
node --import tsx --test tests/rust-integrated-runtime-r5-schema-fixture.test.ts
```

To intentionally refresh after a reviewed wire change, run the example without
`--check` and review its output before updating the checked JSON. Changes to
outer operation schemas must not silently change the inner schema: bind v2/v3/v4
requests all retain the same BWB6/v1 bytes, while BWF6 and BWF7 acknowledgements
retain their fixed 38-byte v1 layouts.

Coverage includes native-to-TypeScript exact decode/re-encode for every family,
nonzero buffer offsets, every truncated prefix, trailing bytes, wrong magic,
version/schema/length/checksum, selected resealed semantic corruption, Unicode,
full-u64 status cursors, safe-number endpoints, camera state hashes, and exact
request/terminal-state attestation. The fixture is an independent wire contract
check, not evidence of complete simulation authority, exhaustive nested status
outcomes, performance acceptance, or production cutover.

The focused native and TypeScript tests also construct BWO5 custody metadata at
the exact 256 KiB aggregate limit, then reject a one-byte overflow with repaired
descriptor and packet hashes. Invalid canonical JSON and schema-zero descriptors
are rejected even when their hashes are recomputed. Native custody decoding reuses
the gameplay metadata validator through its public `validate_wire` boundary.
The BWO5 TypeScript custody boundary also enforces the native 160-byte UTF-8
metadata type/schema ID limit, with exact-limit and resealed one-byte-over tests.
The generic metadata helper's broader opaque-ID allowance is unchanged.

BWF6/BWF7 contain no inner checksum. Their decoder validates structure; the
authority boundary must validate the enclosing response and compare both the
request payload hash and terminal runtime state hash. The production TypeScript
bootstrap validator supplies both expected hashes.
