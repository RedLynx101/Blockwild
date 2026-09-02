# Locator promotion corpus

`corpus.json` is the human-reviewed case manifest. The focused parity test expands its public-option sweeps, serializes the exact TypeScript oracle packets, and compares them with two independent native Rust executions per case.

`native-vectors.json` contains the checked-in request/result packet bytes. `evidence.json` records the derived corpus identity and the status of each promotion layer. A missing locator export in the checked-in public Wasm artifact is recorded as unavailable and leaves `byteEqual` false; native evidence alone must not promote the runtime certificate.

Regenerate only after reviewing any semantic mismatch:

```powershell
$env:BLOCKWILD_UPDATE_LOCATOR_CORPUS='1'
npm.cmd exec tsx -- --test tests/rust-terrain-locator-wasm-parity.test.ts
Remove-Item Env:BLOCKWILD_UPDATE_LOCATOR_CORPUS
```

Then run the same command without the environment variable. That second run must reproduce the checked-in files exactly. The focused test builds only the native fixture binary; it does not build or replace the public Wasm artifact.

To verify an isolated candidate artifact after it has been built, point the test at the exact `public/engine-locator-candidate` index root:

```powershell
$env:BLOCKWILD_LOCATOR_ENGINE_DIR='public/engine-locator-candidate'
npm.cmd exec tsx -- --test tests/rust-terrain-locator-wasm-parity.test.ts
Remove-Item Env:BLOCKWILD_LOCATOR_ENGINE_DIR
```

Candidate mode rejects corpus update mode, never writes canonical evidence, requires all locator exports, compares every Wasm packet with the checked-in native vectors, and requires the exact promoting certificate.
