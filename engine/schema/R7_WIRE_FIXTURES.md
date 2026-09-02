# R7 native wire fixtures

`r7-gameplay-wire-v1.json` covers the 22 R7 request/receipt families in the generated
R5–R9 registry. Rust authors the bytes; TypeScript must decode and re-encode them
exactly. It also retains every frozen BWA7 rejection tag. This is family-level
contract evidence, not proof of full R7 gameplay conversion or authority promotion.

## Scope and provenance

- Producer: `engine/crates/blockwild-engine/examples/r7_gameplay_wire_fixture.rs`.
- Checked artifact: `tests/fixtures/rust-engine/integrated-runtime-v1/r7-gameplay-wire-v1.json`.
- The four player-drop/pickup vectors reuse the independently Rust-authored
  `death-respawn-drop-wire-v1.json`, then decode/re-encode through native codecs.
- Compact BWK7 acknowledgements are Rust-authored using the actual 38-byte Wasm
  acknowledgement layout. They are not checksummed packets: consumers must bind
  both the expected request hash and terminal state hash.
- Rich receipts retain high-u64 revisions, signed i64 resource/stat changes,
  UTF-8 identities, opaque event/content bytes, content hashes, nonempty action
  projections, and present-but-empty no-op dirty evidence.

## Complete generic BWG7 command transport

`r7-gameplay-command-wire-v1.json` is authored separately by
`engine/crates/blockwild-engine/examples/r7_gameplay_command_wire_fixture.rs`.
Each vector includes native BWG7 bytes and the production
`GameplayBatch::calculate_command_hash` result. The public TypeScript codec
decodes/re-encodes those bytes exactly and independently computes the native
semantic command hash; it does not substitute the packet checksum for that hash.

Public APIs in `app/game/rust-integrated-runtime-gameplay-wire.ts`:

- `encodeRustIntegratedGameplayBatchWireV1` / `decodeRustIntegratedGameplayBatchWireV1`
- `rustIntegratedGameplayCommandHashV1`
- `RustIntegratedGameplayBatchWireV1` / `RustIntegratedGameplayCommandV1`

Commands expose typed semantic fields, not arbitrary command-byte blobs. Domain
commands use `{ kind: "inventory", command: { kind: "transfer", ... } }` (and
equivalent machine/combat/Cardforge variants). Progression has an `action` enum;
schedule remains `{ kind: "advance-schedule", expectedTick, toTick, machineBudget }`.

| Domain | Primary command shapes | Additional branch detail |
| --- | ---: | --- |
| Inventory | 10 | Every generic command, including metadata and generated-drop provenance. |
| Machines | 5 | Operate has 4 operation tags; resources have 5 kinds. |
| Combat | 11 | Pacify has 2 method tags; linked content has 11 domain tags. |
| Progression | 1 | Shared structure has 10 action tags. |
| Cardforge | 7 | MatchAction has 5 battle-action tags; printing maps use native UTF-8 ordering. |
| Schedule | 1 | Full wire u16 budget; gameplay authority separately limits execution. |

This is 35 primary structures, or 44 variants counting progression actions
separately. All nested enum tags and present/absent option field paths are tested.
It does not claim every Cartesian combination of optional fields was enumerated.
Creative-slot mutation remains deliberately dedicated to BWF7 (generic inventory
tag 10 is rejected), so it is not a missing generic BWG7 command.

The legacy `encodeRustIntegratedGameplayScheduleBatchWireV1`,
`decodeRustIntegratedGameplayScheduleBatchWireV1`, and schedule-hash APIs remain
restricted wrappers: they reject every non-schedule command and retain their
existing budget ceiling of 64. Use the generic APIs for the full wire format.

## Bounds and authority boundary

Native transport limits enforced/tested by the generic codec:

| Field | Limit | Notes |
| --- | ---: | --- |
| Batch | 1–256 commands | Empty and oversized counts fail closed. |
| Visible UTF-8 string | 16 KiB | Nonempty, no controls/unpaired surrogates; U+FEFF is preserved. |
| Opaque payload | 256 KiB | Only the native machine/progression/combat payload fields are opaque. |
| Metadata component | 64 KiB each | Canonical JSON bytes and unknown-extension bytes are separate fields. |
| Imported slots / metadata | 9 each | Generic BWG7 does not impose the stricter dedicated BWP7 pristine-state rule. |
| Deck printings | 65,536 | Duplicate keys reject; decoded ordering follows Rust's BTreeMap. |
| Whole packet | 1 MiB including header | Per-field maxima are not simultaneously achievable beyond this ceiling. |

Numeric widths, signed i64 power deltas, all u64 revisions/IDs, i32 fixed vectors,
enum tags, option flags, semantic hashes, checksums, schema, and trailing bytes
are guarded. Optional actor player/entity IDs preserve native `Some(0)` distinctly
from absence; mandatory linked-combat entity IDs reject zero. This transport
distinction does not broaden gameplay authority admission. Cardforge command hashing
places expected revision before map entries and omits the map count, exactly as
native hashing does. Stack durability and back-slot option hashes use native u64
width despite narrower wire fields; generated-drop provenance is nested-hashed.

Structural acceptance is not gameplay authorization. Native `GameplayAuthority`
still validates metadata semantics, content compatibility, ownership, budgets,
revisions, inventory limits, resources, and side effects. For example, generic
wire metadata can be structurally valid while its JSON/hash is invalid for
inventory acceptance, and a linked content-domain tag can be defined but not
appropriate for the requested ability. The BWA7 receipt codec covers both
outcomes and all resource/stat/event fields without interpreting opaque events.
These fixtures do not prove production-default cutover or whole-game completion.

## Verification

Run from the repository root:

```powershell
cargo run --manifest-path engine/Cargo.toml -p blockwild-engine --example r7_gameplay_wire_fixture -- --check
cargo test --manifest-path engine/Cargo.toml -p blockwild-engine --test r7_gameplay_wire_fixture
cargo run --manifest-path engine/Cargo.toml -p blockwild-engine --example r7_gameplay_command_wire_fixture -- --check
cargo test --manifest-path engine/Cargo.toml -p blockwild-engine --test r7_gameplay_command_wire_fixture
node --import tsx --test tests/rust-integrated-runtime-r7-schema-fixture.test.ts tests/rust-integrated-runtime-r7-command-fixture.test.ts
```

The producer prints the canonical fixture without `--check`. Fixture updates
must be generated from that native producer and reviewed alongside contract
changes. Tests guard exact registry membership, byte-offset views, schema/hash
tampering, resealed trailing bytes, collection/string bounds, unsafe query
cursors, canonical receipt hashes, and caller-bound compact acknowledgements.
