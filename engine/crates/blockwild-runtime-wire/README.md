# blockwild-runtime-wire

`blockwild-runtime-wire` is the single coarse binary boundary between the
browser shell and Blockwild's integrated Rust runtime. It is dependency-free,
bounded, versioned, and byte-tested against the TypeScript codec.

## Envelope

Every request is `BWRQ`; every response is `BWRS`. The fixed 44-byte
little-endian header contains wire version, runtime schema, operation, status,
reserved bits, request ID, client epoch, worker epoch, payload length, and a
16-byte payload checksum. Request IDs and client epochs are non-zero. Requests
carry worker epoch zero; every response carries a non-zero worker generation.
Reserved bits, unknown operations, trailing bytes, unsafe JavaScript `u64`
values, invalid UTF-8, and over-budget collections fail closed.

The outer operations are intentionally coarse: create/restore, reliable
command batch, fixed-step input batch, bounded extraction, checkpoint, and
shutdown. A command contains 1..256 opaque domain operations and is bound to
an exact authority identity, actor, idempotency key, payload checksums, and a
checksum over the complete command body. Domain type IDs are namespaced
strings so an unregistered future payload rejects without consuming a numeric
slot or being mistaken for a successful no-op.

`RuntimeInputFrameV1` is also a frozen ABI, not an anonymous numeric bag.
`moveX`/`moveZ` are signed-normalized axes; `lookYaw` is an absolute wrapped
heading with the i16 range mapped to `-PI..PI`, and `lookPitch` uses the same
normalized range. Button bits are jump, crouch, sprint, ascend/swim-up,
descend/swim-down, primary attack, secondary use, interact, mount/dismount,
creative-flight toggle, and drop (bits 0..10). State flags are creative,
flying, and mounted (bits 0..2). Unknown bits fail closed so a newer client cannot silently reinterpret an
older deterministic replay. Registered action bits whose native gameplay
dispatcher is not yet attached (attack, use, interact, mount, flight-toggle,
and drop) also reject rather than being accepted and ignored. All three state
flags currently reject as well: the browser cannot grant itself creative,
flight, or mounted eligibility by setting an input bit.

Schema 6 defines an isolated `StepV2` codec beside that frozen input ABI. Its
request payload starts with the complete schema-2 StepV1 bytes, then appends a
bounded, strictly ordered context-command lane. Cast commands bind an exact
spell ID plus loadout and learned-spell revisions. Reload commands bind the
injective container key (`kind`, `id`, optional `ownerId`), selected slot, and
container revision. Mounted abilities bind the packed generational entity ID,
entity revision, seat index, and ability slot. All command sequences and target
ticks are JavaScript-safe, command hashes are domain-separated, and full-width
packed entity IDs remain raw `u64` values rather than lossy JavaScript numbers.

The schema-6 response starts with the complete schema-3 StepResult bytes,
including its replay hash, then appends one canonical semantic receipt for
every crossed due context command. Receipts have a closed outcome/reason
matrix; bind the command hash, post-step identity, and replay hash; and may
carry an exact resolved entity revision, full world revision for a resolved
block, and typed session/effect identities with revisions. Variant-specific
resolution fields prevent irrelevant revisions from acquiring accidental
meaning. The existing `commandsProcessed`/`commandsAccepted` fields remain
overall integrated scheduler counters; they are intentionally not derived
from semantic outcomes in this wire-only slice.

The generic V1 request/response decoders reject schema-6 StepV2. Dedicated
StepV2 codecs make the ABI testable before runtime installation, while the
browser pump exposes only an optional dispatcher and requires an explicit
restored next-command sequence. Therefore codec availability does not claim a
Wasm implementation, restored continuity, authority cutover, or capability.

Limits shared with TypeScript include an 8 MiB envelope, 1 MiB per domain
operation, 6 MiB combined extraction, 128 input frames, 64 capabilities, and
JavaScript-safe integer revisions. Extraction hashes cover the exact five
length-prefixed render, HUD, audio, platform-request, and diagnostic channels.

R9 browser traffic uses one complete `BWRN` request as a single network domain
operation and returns one complete `BWNA` response. The integrated wire does
not decode its peer, agent, interest, or delta records.

R8 persistence has the same opaque semantic rule but a deliberately separate
bulk transport. A small `BWRB`/`BWRC` control envelope travels beside one
detached, transferable complete `BWPR` or `BWPA` attachment. This preserves the
normal BWRQ limits, avoids another structured-clone copy, and makes transfer
ownership and backpressure measurable. The browser transport allows at most two
outstanding attachment handoffs and 256 MiB of bounded recovery attachment
space. The Rust dispatcher independently caps the live queue at 32 requests,
64 MiB total, and 8 MiB per complete packet; additive recovery/import/export
pages remain capped at 4 MiB by their exact BWPR/BWPA schema.
The 256 MiB ceiling exists for bounded recovery/corruption handling, not normal
allocation. Persistence should emit chunked routine transactions. Normal
fixed-step, input, and command calls are selected ahead of the next queued bulk
call so a recovery stream cannot monopolize the authority worker. IndexedDB
remains a browser platform executor and never acquires journal authority.

The BWRQ/BWRS envelope deliberately uses `wire_checksum_v1` rather than
implicitly inheriting a state/replay hash. A protocol-owned checksum has a
frozen domain and raw-byte definition that can evolve independently from the
game's canonical-state hashing. The fixture corpus covers UTF-8, `0x80`,
`0xff`, invalid UTF-8, and TypeScript lone-surrogate rejection.

The legacy `CanonicalHasher::write_bytes` implementations do agree on high
bytes. A previous regression test incorrectly rotated an eight-bit value; Rust
actually widens to `u64` before `rotate_left(1)`. The corrected fixture keeps
the real parity vector and the bad-oracle vector so this false mismatch cannot
return. R8/R9 still require exact persisted-state, save, replay, and network
vectors, but there is no invented legacy blocker.

## Verification

`tests/fixtures/rust-engine/integrated-runtime-v1/wire-fixtures.json` is read
by both implementations. It covers exact TypeScript-to-native requests,
native-to-TypeScript receipts, re-attestation after restore, non-ASCII labels,
high binary bytes, checksum corruption, and lone-surrogate rejection. The
browser service tests separately prove serial worker ownership, awaited
idempotent receipts, crash/timeout/stale-generation failure, artifact
attestation, command/step/extraction latency budgets, exact detached
`BWRB`/`BWRC` bytes, transfer ownership, copy/byte telemetry, bulk backpressure,
normal-call priority, and shared crash/timeout invalidation. Protocol-test
kernels can exercise these invariants but can never report production
authority.

## Capability and authority boundary

Having a valid BWRQ/BWRS codec is not an authority promotion. The browser
service requires the content-addressed artifact plus the exact
`fixed-step-input-v1` and `bounded-extraction-v1` capabilities before it can
be production-authoritative. `bounded-extraction-v1` attests static support for
fixed, bounded extraction and is paired with
`bounded-extraction-blockers-v1`; the dynamic BWX0/BWR6 statuses and blockers
decide whether each individual envelope is complete and promotable. The Wasm
facade still advertises `fixed-step-input-v1-pending-live-cutover` until that
authority gate is proven; it never promotes incomplete authority.
`bulk-platform-v1` is present because
the Rust R8 dispatcher now owns real request IDs, transfer tokens, backpressure,
retry decisions, and durable BWPA validation. Its `BWDS` recovery-shell snapshot
preserves dispatcher work only; full runtime restore remains fail-closed until
R8 records rebuild world, entity, gameplay, and network authority. The
TypeScript R9 network adapter's type
IDs describe its opaque packet shape, not proof that a Wasm artifact has
registered the matching Rust decoder.

An application-level rejection that proves the expected authority state is a
normal awaited result. A malformed receipt, a changed state on rejection, a
worker timeout, a crash, an artifact mismatch, or a worker-generation mismatch
invalidates the complete runtime generation and requires an explicit
checkpoint restore plus re-attestation.
