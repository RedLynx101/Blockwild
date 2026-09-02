# Rust engine immutable code cache

The terrain pipeline reuses verified executable code, not a running engine or generated terrain. This removes repeated code acquisition/compilation from fresh worker startup without making cached code a readiness or authority certificate. Browser correctness and performance acceptance require their own recorded gates; this guide does not claim either.

## Acquisition and ownership

[`RustEngineCodeCache`](../app/game/rust-engine-code-cache.ts) resolves the published selector and artifact manifest on every `prepare()` call using `cache: "no-store"`. It requires content-addressed paths, matching manifest identity, exactly one glue and one Wasm role, contained asset URLs, and valid length/SHA-256 metadata. Redirected responses and malformed or oversized inputs are rejected.

The cache key includes the selector URL, variant/build kind/hash, manifest URL and raw-byte SHA-256, and both files' paths, URLs, lengths, and SHA-256 values. Therefore changing the selector target or manifest bytes cannot silently reuse another identity. Glue and Wasm bytes must both match their declared lengths and SHA-256 before compilation or import. These checks bind execution to the selected publication; they do not authenticate a publisher independently of the trusted selector/transport.

Only glue bytes and a compiled `WebAssembly.Module` are retained. Concurrent acquisition of the same identity shares a promise; callers receive separate glue copies. No initialized module namespace, `WebAssembly.Instance`, memory, world state, generated chunk, or certificate belongs in this cache.

The default LRU retains two identities; `maximumEntries` permits 1–4. This bounds retained entries, **not peak concurrent selector/fetch work or already-started, unabortable compilation**. Eviction aborts the entry's owned acquisition. Acquisition failures remove only that exact entry, so a late failure cannot delete a newer same-identity replacement. Disposal aborts owned work, clears retained entries, rejects later preparation, and prevents late compilation from repopulating the cache. Reported `pending` counts owned selector acquisitions plus retained pending entries, not proof that the browser has stopped an already-started compiler job.

## Two different epochs

[`TerrainGenerationPipeline`](../app/game/terrain-generation-pipeline.ts) owns one code cache and one shared preparation promise per worker lifecycle epoch:

- Initial startup acquires code once for all slots. A same-epoch replacement uses that preparation while creating a new worker.
- `resetAuthorityEpoch()` invalidates requests, terminates old workers, clears the preparation promise, and resolves the selector anew. The immutable cache survives, so an unchanged identity can reuse its compiled module.
- Ordinary seed/options request-identity changes also advance `authorityEpoch`, but do not retire workers or require another code acquisition. Bootstrap continuation must use live slot membership, not equality with that mutable request epoch.
- `dispose()` terminates workers and disposes the owned cache. Late continuations cannot initialize removed slots.

Do not replace world reset with worker reuse to improve a benchmark. Fresh workers are part of the reset contract.

## Fresh execution and failure boundaries

The pipeline sends `initialize-terrain-generation-v2` with a unique slot `bootstrapId`, full code identity, glue bytes, and `WebAssembly.Module`. The module is **structured-cloned, never placed in a transfer list**. Each real worker waits for bootstrap before accepting generation/locator work; invalid or duplicate bootstrap fails closed.

[`RustEngineLoader`](../app/game/rust-engine-loader.ts) snapshots the received module, identity, descriptor, and glue before asynchronous verification. It rechecks identity and glue bytes before importing a fresh, short-lived Blob URL. The URL is revoked after import. The initializer receives the compiled module, creating a fresh instance/memory in that worker's fresh namespace. Module provenance comes from the parent's verified compilation; a worker cannot reconstruct the original Wasm bytes from a `WebAssembly.Module`.

Protocol/schema checks and generation/locator certificates still run for each fresh worker. The ready response must bind the exact slot bootstrap ID and code identity as well as the existing certificates. Byte preparation alone never marks a slot ready. Startup failure follows existing bounded recovery; task cancellation, stale-result rejection, and request validation remain separate.

A standalone default published loader lazily owns a cache, visible in `diagnostics().codeCache`. `reset()` aborts/disposes that owned cache, releases loaded/in-flight references, and prevents an older load from publishing exports; the next load starts a new acquisition. There is no separate loader `dispose()` API: owners use `reset()` when retiring it. Caller-owned initialized handles/exports and explicitly supplied `preparedCode` remain the caller's responsibility. A worker loader consumes pipeline-prepared code and does not own another cache.

## Explicit dependency-injection seams

Tests may inject a pipeline `workerFactory` and optionally a code cache. An injected factory without a cache retains the synthetic-worker seam; selecting `source: "test"` alone does **not** bypass bootstrap for default browser workers. TypeScript rollback creates no Rust cache/worker lane.

Loader `importer`/fetch seams and cache fetcher/compiler seams support deterministic tests. Explicit custom importers retain the legacy test path; direct/unversioned URLs are not eligible for reusable verified code. Supplying `preparedCode` still invokes its snapshot/integrity checks. None of these seams should be selected from URL flags, local storage, or absence of a global test marker. The production-worker fixture must use the default factory/cache/authority, not injected responses or counters.

## Validation

Run focused deterministic checks from the repository root (coordinate CPU use with any hardware-timed browser run):

```powershell
node --import tsx --test tests/rust-engine-code-cache.test.ts tests/rust-engine-loader.test.ts tests/rust-terrain-generation-code-bootstrap.test.ts tests/rust-terrain-generation-worker-bootstrap.test.ts
node --import tsx --test tests/terrain-generation-pipeline.test.ts tests/rust-generation-production-worker-verifier.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The tests cover corruption/truncation before compilation, concurrent acquisition, identity changes, active eviction/late failure, disposal, asynchronous snapshot mutation, fresh instances, startup binding, request-epoch replacement races, and verifier negatives. Worker-handler tests use an explicit synthetic bridge boundary; they are not a live Wasm/browser acceptance result.

The serialized live gate is [`verify-rust-generation-production-worker.mjs`](../scripts/verify-rust-generation-production-worker.mjs). Replace `REVIEWED_SHA256` with the reviewed selected artifact hash and use a fresh evidence directory:

```powershell
node --import tsx scripts/verify-rust-generation-production-worker.mjs --public-dir public/engine --expected-artifact-hash REVIEWED_SHA256 --output work/hybrid-rust-migration/r3-code-cache-reviewed-run
```

It retains all 155 corpus cases in three orders: 465 exact full-stream/POI comparisons, plus real cancellation, supersession, reset, replacement, input ownership, and cleanup checks. Its new cache requirements are:

| Observation | Initial startup | After reset | After replacement | After disposal |
| --- | ---: | ---: | ---: | ---: |
| Selector resolutions | 1 | 2 | 2 | 2 |
| Cache hits | 0 | 1 | 1 | 1 |
| Compilations / asset fetches | 1 / 2 | 1 / 2 | 1 / 2 | 1 / 2 |
| Retained entries / pending | 1 / 0 | 1 / 0 | 1 / 0 | 0 / 0 |

All phases require zero cache failures and identical positive verified-byte totals; disposal must be explicit. Across five freshly created and terminated workers, the server must deliver glue once and Wasm once, with exact selected lengths/SHA-256 values, and deliver both selector and artifact manifest twice. The byte total must agree with cache diagnostics. This evidence supplements the seven lifecycle checks and source/artifact/owned-resource cleanup guards; static source matching or counters alone are insufficient.

Repeated engine delivery motivated this cache, but the earlier browser's HTTP non-retention cause remains unknown. Do not attribute it to a particular header without evidence. This gate verifies code reuse and correctness, not a performance speedup, complete R3 acceptance, or wider engine/renderer authority promotion. Preserve the exact source/artifact identity and inspect the generated evidence before making any live claim.
