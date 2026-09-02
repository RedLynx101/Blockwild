import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertNearLimitSelectionUnchanged,
  createNearLimitEngineRoutePlugin,
  selectNearLimitRustEngineArtifact,
} from "../helpers/rust-native-persistence-near-limit-selection.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PLAYWRIGHT = path.join(
  os.homedir(),
  ".codex",
  "skills",
  "develop-web-game",
  "scripts",
  "node_modules",
  "playwright",
  "index.mjs",
);
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find(existsSync);

const MEBIBYTE = 1024 * 1024;
const MINIMUM_CONTENT_RECORD_BYTES = 63 * MEBIBYTE;
const MAXIMUM_CONTENT_RECORD_BYTES = 64 * MEBIBYTE;
const INFLATED_EXTENSION_BYTES = 61 * MEBIBYTE;
const HASH_128 = /^[0-9a-f]{32}$/u;
const HASH_256 = /^[0-9a-f]{64}$/u;

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not reserve a browser verifier port");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

test("a 63-64 MiB native CONTENT record survives a fresh Worker/Wasm/IndexedDB hydration", { timeout: 600_000 }, async (context) => {
  const selection = selectNearLimitRustEngineArtifact(ROOT);
  assert.ok(CHROME, "explicit near-limit acceptance requires a local Chrome or Edge executable");
  assert.ok(existsSync(PLAYWRIGHT), "explicit near-limit acceptance requires the bundled develop-web-game Playwright runtime");

  const port = await freePort();
  const url = `http://127.0.0.1:${port}/tests/fixtures/r8-indexeddb-harness.html`;
  const engineRequests = [];
  let engineRequestOverflow = 0;
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: ROOT,
    configFile: false,
    appType: "mpa",
    publicDir: false,
    clearScreen: false,
    logLevel: "silent",
    plugins: [createNearLimitEngineRoutePlugin(selection, (request) => {
      if (engineRequests.length < 64) engineRequests.push(request);
      else engineRequestOverflow += 1;
    })],
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  const consoleErrors = [];
  const pageErrors = [];
  let consoleErrorOverflow = 0;
  let pageErrorOverflow = 0;
  let browser;
  let page;
  let evidence = null;
  try {
    await vite.listen();
    const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
    browser = await chromium.launch({ headless: true, executablePath: CHROME });
    page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (consoleErrors.length < 64) consoleErrors.push(message.text());
      else consoleErrorOverflow += 1;
    });
    page.on("pageerror", (error) => {
      if (pageErrors.length < 64) pageErrors.push(error.message);
      else pageErrorOverflow += 1;
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });

    evidence = await page.evaluate(async ({ extensionBytes, expectedArtifactHash }) => {
      const [
        contentModule,
        contractModule,
        hostModule,
        adapterModule,
        browserRuntimeModule,
        pumpModule,
        persistencePortModule,
        nativeSessionModule,
      ] = await Promise.all([
        import("/app/game/rust-integrated-runtime-content.ts"),
        import("/app/game/rust-integrated-runtime-contract.ts"),
        import("/app/game/rust-world-runtime-host.ts"),
        import("/app/game/indexeddb-persistence-adapter.ts"),
        import("/app/game/rust-persistence-runtime-adapter.ts"),
        import("/app/game/rust-integrated-persistence-pump.ts"),
        import("/app/game/rust-integrated-runtime-persistence.ts"),
        import("/app/game/rust-native-world-persistence.ts"),
      ]);

      const require = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const encoder = new TextEncoder();
      const stringBytes = (value) => 4 + encoder.encode(value).byteLength;
      const artifactBytes = (artifact) => 1
        + stringBytes(artifact.id)
        + stringBytes(artifact.schemaId)
        + 2
        + 4
        + 4
        + artifact.aliases.reduce((total, alias) => total + stringBytes(alias), 0)
        + 4
        + artifact.canonicalBytes.byteLength
        + 4
        + artifact.unknownExtensionBytes.byteLength;
      const installPageCount = (bundle) => {
        const manifest = bundle.manifest;
        require(manifest, "inflated production content did not compile a manifest");
        const installId = `install:${manifest.manifestHash}`;
        const fixedBodyBytes = stringBytes(installId)
          + 2
          + stringBytes(manifest.sourceRevision)
          + 16
          + 2
          + contentModule.RUST_CONTENT_DOMAINS.length * (1 + 4 + 16)
          + 4
          + 4
          + 4;
        let pages = 1;
        let entries = 0;
        let bytes = fixedBodyBytes;
        for (const artifact of bundle.artifacts) {
          const encodedBytes = artifactBytes(artifact);
          require(
            encodedBytes + fixedBodyBytes + 28 <= contentModule.RUST_CONTENT_INSTALL_PAGE_BUDGET_V1,
            `inflated artifact ${artifact.domain}:${artifact.id} exceeds one content-install page`,
          );
          if (entries > 0 && (entries >= contentModule.RUST_CONTENT_INSTALL_MAX_ARTIFACTS_PER_PAGE_V1
            || bytes + encodedBytes + 28 > contentModule.RUST_CONTENT_INSTALL_PAGE_BUDGET_V1)) {
            pages += 1;
            entries = 0;
            bytes = fixedBodyBytes;
          }
          entries += 1;
          bytes += encodedBytes;
        }
        require(pages <= contentModule.RUST_CONTENT_INSTALL_MAX_PAGES_V1, "inflated content exceeds the bounded install page count");
        return pages;
      };
      const projectedContentRecordBytes = (bundle, pageCount, universeId, locationId) => {
        const manifest = bundle.manifest;
        require(manifest, "inflated production content did not compile a manifest");
        let bodyBytes = 4 + 2 + 1;
        bodyBytes += stringBytes(`install:${manifest.manifestHash}`);
        bodyBytes += stringBytes(manifest.sourceRevision);
        bodyBytes += 16;
        bodyBytes += 4 + contentModule.RUST_CONTENT_DOMAINS.length * (1 + 4 + 16);
        bodyBytes += 4 + 8;
        bodyBytes += 4 + pageCount * 16;
        bodyBytes += 4;
        bodyBytes += bundle.artifacts.reduce((total, artifact) => total + artifactBytes(artifact), 0);
        bodyBytes += 4;
        return 4 + 2 + 1
          + stringBytes(universeId)
          + stringBytes(locationId)
          + 4 * 16
          + 4
          + bodyBytes;
      };
      const copyIdentity = (identity) => ({ ...identity, revision: { ...identity.revision } });
      const databaseNames = async () => {
        require(typeof indexedDB.databases === "function", "IndexedDB database enumeration is required to prove cleanup");
        return (await indexedDB.databases()).map((database) => database.name).filter(Boolean);
      };

      const databaseName = `blockwild-r8-near-limit-${crypto.randomUUID()}`;
      const universeId = "near-limit-r8";
      const locationId = "overworld";
      const productionSources = contentModule.blockwildProductionContentSources();
      const baseExtensionBytes = productionSources.reduce(
        (total, source) => total + (source.unknownExtensionBytes?.byteLength ?? 0),
        0,
      );
      const extensionPerEntry = Math.floor(extensionBytes / productionSources.length);
      let extensionRemainder = extensionBytes % productionSources.length;
      let inflatedSources = productionSources.map((source, index) => {
        const base = source.unknownExtensionBytes ?? new Uint8Array();
        const added = extensionPerEntry + (extensionRemainder > 0 ? 1 : 0);
        extensionRemainder = Math.max(0, extensionRemainder - 1);
        const unknownExtensionBytes = new Uint8Array(base.byteLength + added);
        unknownExtensionBytes.set(base);
        unknownExtensionBytes.fill((index % 251) + 1, base.byteLength);
        require(
          unknownExtensionBytes.byteLength <= contentModule.MAX_RUST_CONTENT_EXTENSION_BYTES,
          `production extension capacity is insufficient at ${source.domain}:${source.id}`,
        );
        return { ...source, unknownExtensionBytes };
      });
      const inflatedBundle = contentModule.compileRustProductionContent(
        "blockwild-near-limit-browser-v1",
        inflatedSources,
      );
      inflatedSources = null;
      require(inflatedBundle.manifest !== null, "inflated production content has no manifest");
      require(inflatedBundle.blockers.length === 0, "inflated production content has compilation blockers");
      const totalExtensionBytes = inflatedBundle.artifacts.reduce(
        (total, artifact) => total + artifact.unknownExtensionBytes.byteLength,
        0,
      );
      const maximumExtensionBytes = Math.max(...inflatedBundle.artifacts.map((artifact) => artifact.unknownExtensionBytes.byteLength));
      require(totalExtensionBytes === baseExtensionBytes + extensionBytes, "inflated extension byte total drifted during compilation");

      const pageCount = installPageCount(inflatedBundle);
      const projectedRecordBytes = projectedContentRecordBytes(inflatedBundle, pageCount, universeId, locationId);
      require(projectedRecordBytes >= 63 * 1024 * 1024, "projected CONTENT record is below the 63 MiB acceptance floor");
      require(projectedRecordBytes <= 64 * 1024 * 1024, "projected CONTENT record exceeds the 64 MiB persistence lane");

      const hostConfig = {
        worldSeed: "near-limit-native-persistence-v1",
        universeId,
        locationId,
        sessionId: "near-limit-native-session-v1",
        catalogWorldId: "catalog:near-limit-native-v1",
        generatorHash: "1".repeat(32),
        ...contractModule.RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
        waterBlockId: 7,
        directionalBlockIds: [],
        waterloggedBlockIds: [],
      };
      const bindings = [];
      const persistenceFactory = ({ persistenceWorldId, adapter }) => {
        const service = adapter.service;
        require(service, "production runtime adapter did not expose its sole Worker service");
        const platform = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, databaseName);
        const browserRuntime = new browserRuntimeModule.RustPersistenceBrowserRuntimeV1(platform);
        const port = new persistencePortModule.RustIntegratedPersistenceRuntimePortV1(service);
        const pump = new pumpModule.RustIntegratedPersistencePumpV1(service, browserRuntime);
        const trace = { initializeProgress: null, hydration: null };
        const runtimeControl = {
          initializeNativeSave: async (...parameters) => {
            const progress = await service.initializeNativeSave(...parameters);
            trace.initializeProgress = progress;
            return progress;
          },
          hydrateCompatibilityRecovery: async (...parameters) => {
            const hydration = await service.hydrateCompatibilityRecovery(...parameters);
            trace.hydration = hydration;
            return hydration;
          },
        };
        const session = new nativeSessionModule.RustNativeWorldPersistenceSessionV1({
          worldId: persistenceWorldId,
          runtime: runtimeControl,
          port,
          pump,
          checkpoints: platform,
        });
        const binding = { session, platform, port, pump, trace };
        bindings.push(binding);
        return Object.freeze({ session, closePlatform: () => platform.close() });
      };
      const dependencies = {
        contentFactory: () => inflatedBundle,
        persistenceFactory,
      };

      let firstHost = null;
      let secondHost = null;
      let scenario = null;
      let scenarioError = null;
      try {
        firstHost = new hostModule.RustWorldRuntimeHostV1(hostConfig, dependencies);
        const initialIdentity = copyIdentity(await firstHost.start());
        const firstBinding = bindings.at(-1);
        require(firstBinding, "first host did not bind native persistence");
        require(firstHost.nativePersistenceSession() === firstBinding.session, "first host exposed a different native persistence session");

        const save = await firstBinding.session.initializeNewWorld(1_720_000_000_000);
        const savedIdentity = copyIdentity(firstHost.identity());
        const status = await firstBinding.port.status();
        const head = await firstBinding.platform.readLatestCheckpoint(firstBinding.session.worldId);
        require(head, "native save did not leave a durable IndexedDB checkpoint head");
        const contentDescriptor = head.records.find((record) => record.address.kind === "settings-reference"
          && record.address.recordId === "rust-content-registry-v1");
        require(contentDescriptor, "native save checkpoint omitted the CONTENT authority record");
        let contentPayload = await firstBinding.platform.readRecord(contentDescriptor.address, contentDescriptor.revision);
        require(contentPayload, "native CONTENT authority record could not be read back from IndexedDB");
        const contentPayloadBytes = contentPayload.byteLength;
        contentPayload = null;
        require(contentPayloadBytes === contentDescriptor.byteLength, "CONTENT payload length differs from its checkpoint descriptor");
        require(contentPayloadBytes === projectedRecordBytes, "CONTENT payload length differs from the exact native-envelope projection");
        const firstHead = structuredClone(head);
        const initializeProgress = firstBinding.trace.initializeProgress;
        require(initializeProgress, "native initialization progress was not observed");
        const firstDiagnostics = firstHost.diagnostics();
        require(firstDiagnostics.artifactHash === expectedArtifactHash, "first Worker selected an unexpected Rust engine artifact");

        await firstHost.shutdown();
        firstHost = null;

        secondHost = new hostModule.RustWorldRuntimeHostV1(hostConfig, dependencies);
        const freshIdentity = copyIdentity(await secondHost.start());
        const secondBinding = bindings.at(-1);
        require(secondBinding && secondBinding !== firstBinding, "fresh host reused the first persistence binding");
        const recovery = await secondBinding.session.recoverAndHydrate();
        const recoveredIdentity = copyIdentity(secondHost.identity());
        const recoveredHead = await secondBinding.platform.readLatestCheckpoint(secondBinding.session.worldId);
        require(recoveredHead, "fresh session could not read the durable checkpoint head");
        const recoveryDiagnostics = secondHost.diagnostics();
        require(recoveryDiagnostics.artifactHash === expectedArtifactHash, "replacement Worker selected an unexpected Rust engine artifact");
        const hydration = secondBinding.trace.hydration;
        require(hydration, "fresh Worker did not emit a native hydration receipt");
        const settledIdentity = copyIdentity(secondHost.identity());

        scenario = {
          databaseName,
          bundle: {
            entryCount: inflatedBundle.artifacts.length,
            baseExtensionBytes,
            addedExtensionBytes: extensionBytes,
            totalExtensionBytes,
            maximumExtensionBytes,
            installPages: pageCount,
            contentManifestHash: inflatedBundle.manifest.manifestHash,
          },
          first: {
            artifactHash: firstDiagnostics.artifactHash,
            initialIdentity,
            savedIdentity,
            save,
            initializeProgress: {
              setHash: initializeProgress.setHash,
              manifestHash: initializeProgress.manifestHash,
              dispatcherRequestId: initializeProgress.dispatcherRequestId,
              remainingDirtyRecords: initializeProgress.remainingDirtyRecords,
            },
            status,
            head: firstHead,
            contentPayloadBytes,
            projectedContentRecordBytes: projectedRecordBytes,
            diagnostics: firstDiagnostics.nativePersistence,
          },
          recovery: {
            artifactHash: recoveryDiagnostics.artifactHash,
            freshIdentity,
            recovery,
            recoveredIdentity,
            settledIdentity,
            head: structuredClone(recoveredHead),
            hydration: {
              current: copyIdentity(hydration.current),
              nativeDomains: hydration.nativeDomains,
              chunkCount: hydration.chunkCount,
              totalBytes: hydration.totalBytes,
              recoveryId: hydration.recoveryId,
            },
            diagnostics: recoveryDiagnostics.nativePersistence,
          },
        };
      } catch (error) {
        scenarioError = error;
      }

      const cleanupErrors = [];
      for (const host of [secondHost, firstHost]) {
        if (!host) continue;
        try { await host.shutdown(); }
        catch (error) { cleanupErrors.push(error); }
      }
      for (const binding of bindings) {
        try { await binding.platform.close(); }
        catch (error) { cleanupErrors.push(error); }
      }
      let beforeDelete = [];
      try {
        beforeDelete = await databaseNames();
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, databaseName).destroyForDiagnostics();
      } catch (error) {
        cleanupErrors.push(error);
      }
      let afterDelete = [];
      try {
        afterDelete = await databaseNames();
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (scenarioError) throw scenarioError;
      if (cleanupErrors.length) throw cleanupErrors[0];
      require(scenario, "near-limit persistence scenario did not produce evidence");
      return {
        ...scenario,
        cleanup: {
          databasePresentBeforeDelete: beforeDelete.includes(databaseName),
          databaseAbsentAfterDelete: !afterDelete.includes(databaseName),
        },
      };
    }, { extensionBytes: INFLATED_EXTENSION_BYTES, expectedArtifactHash: selection.hash });

    assert.equal(evidence.bundle.addedExtensionBytes, INFLATED_EXTENSION_BYTES);
    assert.ok(evidence.bundle.entryCount > 0);
    assert.ok(evidence.bundle.installPages > 1 && evidence.bundle.installPages <= 128);
    assert.ok(evidence.bundle.maximumExtensionBytes <= 64 * 1024);
    assert.match(evidence.bundle.contentManifestHash, HASH_128);

    assert.match(evidence.first.artifactHash, HASH_256);
    assert.equal(evidence.first.artifactHash, selection.hash);
    assert.equal(evidence.recovery.artifactHash, selection.hash);
    assert.ok(evidence.first.contentPayloadBytes >= MINIMUM_CONTENT_RECORD_BYTES);
    assert.ok(evidence.first.contentPayloadBytes <= MAXIMUM_CONTENT_RECORD_BYTES);
    assert.equal(evidence.first.contentPayloadBytes, evidence.first.projectedContentRecordBytes);
    assert.equal(evidence.first.save.records, 7);
    assert.equal(evidence.first.save.commits, 1);
    assert.equal(evidence.first.save.checkpointId, evidence.first.head.checkpointId);
    assert.equal(evidence.first.save.checkpointHash, evidence.first.head.checkpointHash);
    assert.equal(evidence.first.save.journalSequence, evidence.first.head.journalSequence);
    assert.equal(evidence.first.head.records.length, 7);
    assert.equal(evidence.first.head.generatorHash, "1".repeat(32));
    assert.equal(evidence.first.head.contentHash, evidence.bundle.contentManifestHash);
    assert.deepEqual(
      evidence.first.head.records.map((record) => `${record.address.kind}/${record.address.recordId}`).sort(),
      [
        "actor-digest/rust-gameplay-r7-v1",
        "chunk-edits/rust-world-r4-v1",
        "entity/rust-entity-r6-v2",
        "location-manifest/manifest-v1",
        "map-knowledge/rust-world-view-r7-v1",
        "player/rust-runtime-core-v2",
        "settings-reference/rust-content-registry-v1",
      ],
    );

    assert.equal(evidence.first.initializeProgress.dispatcherRequestId > 0, true);
    assert.equal(evidence.first.initializeProgress.remainingDirtyRecords, evidence.first.save.records);
    assert.equal(evidence.first.status.terminal, true);
    assert.equal(evidence.first.status.closed, false);
    assert.equal(evidence.first.status.pending, 0);
    assert.equal(evidence.first.status.queuedBytes, 0);
    assert.ok(evidence.first.status.terminalCheckpoint);
    assert.equal(evidence.first.status.terminalCheckpoint.checkpointId, evidence.first.head.checkpointId);
    assert.equal(evidence.first.status.terminalCheckpoint.checkpointHash, evidence.first.head.checkpointHash);
    assert.equal(evidence.first.status.terminalCheckpoint.journalSequence, evidence.first.head.journalSequence);
    assert.equal(evidence.first.status.terminalCheckpoint.recordCount, evidence.first.head.records.length);
    assert.equal(evidence.first.status.terminalCheckpoint.saveSetHash, evidence.first.initializeProgress.setHash);
    assert.equal(evidence.first.status.terminalCheckpoint.manifestHash, evidence.first.initializeProgress.manifestHash);
    assert.match(evidence.first.status.terminalCheckpoint.saveSetHash, HASH_128);
    assert.match(evidence.first.status.terminalCheckpoint.manifestHash, HASH_128);
    assert.equal(evidence.first.diagnostics.saves, 1);
    assert.equal(evidence.first.diagnostics.lastCheckpointId, evidence.first.head.checkpointId);

    assert.equal(evidence.recovery.recovery.status, "hydrated");
    assert.equal(evidence.recovery.recovery.checkpointId, evidence.first.head.checkpointId);
    assert.equal(evidence.recovery.recovery.fallbackDepth, 0);
    assert.equal(evidence.recovery.recovery.nativeDomains, 6);
    assert.equal(evidence.recovery.recovery.checkpointRecords, 7);
    assert.equal(evidence.recovery.hydration.nativeDomains, 6);
    assert.equal(evidence.recovery.hydration.chunkCount, 0);
    assert.equal(evidence.recovery.hydration.totalBytes, 0);
    assert.equal(evidence.recovery.hydration.recoveryId, evidence.first.head.checkpointId);
    assert.deepEqual(evidence.recovery.head, evidence.first.head);
    assert.deepEqual(
      evidence.recovery.freshIdentity,
      evidence.first.initialIdentity,
      "the replacement Worker must begin at the same deterministic pre-hydration identity",
    );
    assert.notDeepEqual(
      evidence.recovery.recoveredIdentity,
      evidence.recovery.freshIdentity,
      "native hydration must make an observable authority transition",
    );
    assert.equal(evidence.recovery.recoveredIdentity.universeId, evidence.recovery.freshIdentity.universeId);
    assert.equal(evidence.recovery.recoveredIdentity.locationId, evidence.recovery.freshIdentity.locationId);
    assert.equal(evidence.recovery.recoveredIdentity.tick, evidence.recovery.freshIdentity.tick);
    for (const domain of ["epoch", "world", "entities", "gameplay", "network", "simulation"]) {
      assert.equal(
        evidence.recovery.recoveredIdentity.revision[domain],
        evidence.recovery.freshIdentity.revision[domain],
        `${domain} revision must remain stable across native hydration`,
      );
    }
    assert.equal(
      evidence.recovery.recoveredIdentity.revision.persistence,
      evidence.recovery.freshIdentity.revision.persistence + evidence.first.head.journalSequence,
      "hydration must apply exactly the durable journal-sequence persistence rebase",
    );
    assert.notEqual(evidence.recovery.recoveredIdentity.stateHash, evidence.recovery.freshIdentity.stateHash);
    assert.equal(evidence.recovery.recoveredIdentity.universeId, evidence.first.savedIdentity.universeId);
    assert.equal(evidence.recovery.recoveredIdentity.locationId, evidence.first.savedIdentity.locationId);
    assert.equal(evidence.recovery.recoveredIdentity.tick, evidence.first.savedIdentity.tick);
    for (const domain of ["epoch", "world", "entities", "gameplay", "network", "simulation"]) {
      assert.equal(
        evidence.recovery.recoveredIdentity.revision[domain],
        evidence.first.savedIdentity.revision[domain],
        `${domain} revision must survive native hydration exactly`,
      );
    }
    assert.equal(
      evidence.recovery.recoveredIdentity.revision.persistence,
      evidence.first.head.journalSequence,
    );
    assert.equal(evidence.first.status.persistenceRevision, evidence.first.save.commits);
    assert.equal(
      evidence.first.savedIdentity.revision.persistence,
      evidence.recovery.recoveredIdentity.revision.persistence + evidence.first.status.persistenceRevision,
    );
    assert.notEqual(evidence.recovery.recoveredIdentity.stateHash, evidence.first.savedIdentity.stateHash);
    assert.deepEqual(
      {
        revision: evidence.recovery.recoveredIdentity.revision,
        tick: evidence.recovery.recoveredIdentity.tick,
        stateHash: evidence.recovery.recoveredIdentity.stateHash,
      },
      evidence.recovery.hydration.current,
    );
    assert.deepEqual(evidence.recovery.settledIdentity, evidence.recovery.recoveredIdentity);
    assert.equal(evidence.recovery.diagnostics.recoveries, 1);
    assert.equal(evidence.recovery.diagnostics.parentFallbacks, 0);
    assert.equal(evidence.recovery.diagnostics.lastCheckpointId, evidence.first.head.checkpointId);
    assert.equal(evidence.cleanup.databasePresentBeforeDelete, true);
    assert.equal(evidence.cleanup.databaseAbsentAfterDelete, true);
    assert.equal(engineRequestOverflow, 0, "selected /engine/ request evidence exceeded its bounded log");
    assert.ok(engineRequests.length > 0, "the browser did not request the selected /engine/ artifact");
    assert.ok(engineRequests.every((request) => request.status === 200), "a selected /engine/ request failed closed");
    const requestedPaths = new Set(engineRequests.map((request) => request.pathname));
    for (const requiredPath of [
      "/engine/manifest.json",
      `/engine/${selection.hash}/manifest.json`,
      `/engine/${selection.hash}/engine.js`,
      `/engine/${selection.hash}/engine_bg.wasm`,
    ]) {
      assert.ok(requestedPaths.has(requiredPath), `browser did not load selected artifact route ${requiredPath}`);
    }
    assert.equal(consoleErrorOverflow, 0, "browser console errors exceeded their bounded evidence log");
    assert.equal(pageErrorOverflow, 0, "browser page errors exceeded their bounded evidence log");
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);

    const contentDescriptor = evidence.first.head.records.find((record) => record.address.kind === "settings-reference"
      && record.address.recordId === "rust-content-registry-v1");
    assert.ok(contentDescriptor);
    context.diagnostic(`near-limit-persistence-evidence ${JSON.stringify({
      content: {
        descriptorBytes: contentDescriptor.byteLength,
        payloadBytes: evidence.first.contentPayloadBytes,
        projectedBytes: evidence.first.projectedContentRecordBytes,
        payloadHash: contentDescriptor.payloadHash,
        manifestHash: evidence.bundle.contentManifestHash,
        entries: evidence.bundle.entryCount,
        installPages: evidence.bundle.installPages,
        addedExtensionBytes: evidence.bundle.addedExtensionBytes,
        totalExtensionBytes: evidence.bundle.totalExtensionBytes,
        maximumExtensionBytes: evidence.bundle.maximumExtensionBytes,
      },
      save: {
        records: evidence.first.save.records,
        commits: evidence.first.save.commits,
        checkpointId: evidence.first.head.checkpointId,
        checkpointHash: evidence.first.head.checkpointHash,
        journalSequence: evidence.first.head.journalSequence,
        saveSetHash: evidence.first.status.terminalCheckpoint.saveSetHash,
        manifestHash: evidence.first.status.terminalCheckpoint.manifestHash,
        terminal: evidence.first.status.terminal,
        pending: evidence.first.status.pending,
        queuedBytes: evidence.first.status.queuedBytes,
      },
      identity: {
        initial: evidence.first.initialIdentity,
        saved: evidence.first.savedIdentity,
        fresh: evidence.recovery.freshIdentity,
        recovered: evidence.recovery.recoveredIdentity,
        settled: evidence.recovery.settledIdentity,
      },
      recovery: {
        status: evidence.recovery.recovery.status,
        nativeDomains: evidence.recovery.recovery.nativeDomains,
        checkpointRecords: evidence.recovery.recovery.checkpointRecords,
        fallbackDepth: evidence.recovery.recovery.fallbackDepth,
      },
      cleanup: evidence.cleanup,
      selectedArtifact: {
        directory: selection.relativeDirectory,
        variant: selection.variant,
        hash: selection.hash,
        sourceSnapshot: selection.provenance.sourceSnapshot,
        build: {
          createdAt: selection.provenance.createdAt,
          package: selection.provenance.package,
          packageVersion: selection.provenance.packageVersion,
          target: selection.provenance.target,
          cargoProfile: selection.provenance.cargoProfile,
          rustToolchain: selection.provenance.rustToolchain,
          cargoVersion: selection.provenance.cargoVersion,
          wasmBindgenVersion: selection.provenance.wasmBindgenVersion,
          fileCount: selection.provenance.fileCount,
          rawBytes: selection.provenance.rawBytes,
        },
        requests: engineRequests,
        requestOverflow: engineRequestOverflow,
      },
      browserErrors: {
        console: consoleErrors.length,
        consoleOverflow: consoleErrorOverflow,
        page: pageErrors.length,
        pageOverflow: pageErrorOverflow,
      },
    })}`);
  } finally {
    const cleanup = {
      pageClosed: page === undefined,
      browserClosed: browser === undefined,
      viteClosed: false,
      selectedArtifactUnchanged: false,
      currentSourceUnchanged: false,
    };
    const cleanupErrors = [];
    if (page) {
      try {
        if (!page.isClosed()) await page.close();
        cleanup.pageClosed = page.isClosed();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (browser) {
      try {
        await browser.close();
        cleanup.browserClosed = !browser.isConnected();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await vite.close();
      cleanup.viteClosed = true;
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const unchanged = assertNearLimitSelectionUnchanged(selection);
      cleanup.selectedArtifactUnchanged = unchanged.treeSnapshot.digest === selection.treeSnapshot.digest;
      cleanup.currentSourceUnchanged = unchanged.sourceSnapshot.digest === selection.sourceSnapshot.digest;
    } catch (error) {
      cleanupErrors.push(error);
    }
    context.diagnostic(`near-limit-persistence-harness-cleanup ${JSON.stringify({
      selectedArtifact: {
        directory: selection.relativeDirectory,
        hash: selection.hash,
        sourceSnapshot: selection.sourceSnapshot,
        treeSnapshot: selection.treeSnapshot,
      },
      engineRequests: { recorded: engineRequests.length, overflow: engineRequestOverflow },
      browserErrors: {
        console: consoleErrors.length,
        consoleOverflow: consoleErrorOverflow,
        page: pageErrors.length,
        pageOverflow: pageErrorOverflow,
      },
      indexedDb: evidence?.cleanup ?? null,
      cleanup,
      errors: cleanupErrors.map((error) => error instanceof Error ? error.message : String(error)),
    })}`);
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "near-limit persistence harness cleanup failed");
  }
});
