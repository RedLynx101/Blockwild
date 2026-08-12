import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLAYWRIGHT = path.join(os.homedir(), ".codex", "skills", "develop-web-game", "scripts", "node_modules", "playwright", "index.mjs");
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find(existsSync);

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

test("real IndexedDB preserves exact revisions across reopen, rejects stale tabs, and rolls back aborted/quota writes", { timeout: 120_000 }, async (context) => {
  if (!CHROME || !existsSync(PLAYWRIGHT)) {
    context.skip("local Chrome and the bundled Playwright runtime are required for the browser persistence gate");
    return;
  }

  const port = await freePort();
  const url = `http://127.0.0.1:${port}/tests/fixtures/r8-indexeddb-harness.html`;
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: ROOT,
    configFile: false,
    appType: "mpa",
    clearScreen: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  let browser;
  try {
    await vite.listen();
    const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
    browser = await chromium.launch({ headless: true, executablePath: CHROME });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const durable = await page.evaluate(async () => {
      const adapterModule = await import("/app/game/indexeddb-persistence-adapter.ts");
      const contract = await import("/app/game/persistence-journal-contract.ts");
      const databaseName = `blockwild-r8-browser-${crypto.randomUUID()}`;
      const worldId = "world:browser-r8";
      const address = { universeId: worldId, locationId: "overworld", kind: "entity", recordId: "browser-probe" };
      const makeTransaction = (id, expectedJournalSequence, expectedRecordRevision, revision, payload) => contract.createPersistenceTransactionV1({
        transactionId: id,
        worldId,
        checkpointId: `checkpoint:${revision}`,
        expectedJournalSequence,
        nextJournalSequence: expectedJournalSequence + 1,
        mutations: [{ operation: "put", address, expectedRecordRevision, nextRecordRevision: revision, payload: Uint8Array.from(payload) }],
      });
      const makeCheckpoint = (transaction, id, parentCheckpointId) => {
        const mutation = transaction.mutations[0];
        return contract.createPersistenceCheckpointV1({
          checkpointId: id,
          parentCheckpointId,
          worldId,
          journalSequence: transaction.nextJournalSequence,
          generatorHash: "0123456789abcdef0123456789abcdef",
          contentHash: "fedcba9876543210fedcba9876543210",
          createdAt: transaction.nextJournalSequence,
          records: [{ address, revision: mutation.nextRecordRevision, byteLength: mutation.payload.byteLength, payloadHash: mutation.payloadHash }],
        });
      };

      const firstAdapter = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, databaseName);
      const competingTab = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, databaseName);
      const first = makeTransaction("transaction:browser:1", 0, null, 1, [1, 2, 3]);
      const firstCheckpoint = makeCheckpoint(first, "checkpoint:browser:1", null);
      const firstResult = await firstAdapter.commit(first, firstCheckpoint);
      const second = makeTransaction("transaction:browser:2", 1, 1, 2, [9, 8, 7]);
      const secondCheckpoint = makeCheckpoint(second, "checkpoint:browser:2", firstCheckpoint.checkpointId);
      const secondResult = await competingTab.commit(second, secondCheckpoint);
      const stale = makeTransaction("transaction:browser:stale", 1, 1, 2, [6, 6, 6]);
      const staleResult = await firstAdapter.commit(stale);
      await firstAdapter.close();
      await competingTab.close();

      // An aborted transaction stands in for a tab crash between writes. Its
      // provisional immutable record must never survive refresh/reopen.
      const raw = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, adapterModule.RUST_PERSISTENCE_DATABASE_VERSION_V1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const aborted = raw.transaction("record-versions", "readwrite");
      aborted.objectStore("record-versions").put({
        key: `${contract.persistenceRecordKeyV1(address)}|revision:${String(99).padStart(20, "0")}`,
        address,
        revision: 99,
        payload: Uint8Array.of(99),
        payloadHash: "0".repeat(32),
      });
      const abortSettled = new Promise((resolve) => {
        aborted.onabort = resolve;
        aborted.onerror = (event) => { event.preventDefault(); resolve(); };
      });
      aborted.abort();
      await abortSettled;
      raw.close();

      const reopened = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, databaseName);
      const latest = await reopened.readLatestCheckpoint(worldId);
      const revisionOne = await reopened.readRecord(address, 1);
      const revisionTwo = await reopened.readRecord(address, 2);
      const abortedRevision = await reopened.readRecord(address, 99);
      await reopened.close();

      // Damage only the current head's immutable record. The retained parent
      // bytes must remain available for Rust's bounded fallback decision.
      const corrupt = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, adapterModule.RUST_PERSISTENCE_DATABASE_VERSION_V1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const corruption = corrupt.transaction(["records", "record-versions"], "readwrite");
      corruption.objectStore("records").delete(contract.persistenceRecordKeyV1(address));
      corruption.objectStore("record-versions").delete(`${contract.persistenceRecordKeyV1(address)}|revision:${String(2).padStart(20, "0")}`);
      await new Promise((resolve, reject) => {
        corruption.oncomplete = resolve;
        corruption.onabort = () => reject(corruption.error);
        corruption.onerror = () => reject(corruption.error);
      });
      corrupt.close();
      const fallback = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, databaseName);
      const corruptHead = await fallback.readRecord(address, 2);
      const retainedParent = await fallback.readRecord(address, 1);
      await fallback.destroyForDiagnostics();

      // A real V2 database has only the mutable current record. Its first V3
      // commit must materialize that exact parent before overwriting it.
      const upgradeName = `blockwild-r8-upgrade-${crypto.randomUUID()}`;
      const upgradeWorldId = "world:v2-upgrade";
      const upgradeAddress = { universeId: upgradeWorldId, locationId: "overworld", kind: "entity", recordId: "upgrade-probe" };
      const upgradeFirst = makeTransaction("transaction:upgrade:1", 0, null, 1, [3, 1, 4]);
      const upgradePayload = upgradeFirst.mutations[0];
      const v2 = await new Promise((resolve, reject) => {
        const request = indexedDB.open(upgradeName, 2);
        request.onupgradeneeded = () => {
          for (const name of ["meta", "journal", "records", "checkpoints", "legacy-backups", "platform-chunks", "tombstones"]) {
            request.result.createObjectStore(name, { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const oldWrite = v2.transaction(["meta", "records"], "readwrite");
      oldWrite.objectStore("meta").put({ key: `journal-sequence|${encodeURIComponent(upgradeWorldId)}`, value: 1 });
      oldWrite.objectStore("records").put({
        key: contract.persistenceRecordKeyV1(upgradeAddress),
        address: upgradeAddress,
        revision: 1,
        payload: Uint8Array.from([3, 1, 4]),
        payloadHash: upgradePayload.payloadHash,
      });
      await new Promise((resolve, reject) => {
        oldWrite.oncomplete = resolve;
        oldWrite.onabort = () => reject(oldWrite.error);
        oldWrite.onerror = () => reject(oldWrite.error);
      });
      v2.close();
      const upgraded = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, upgradeName);
      const upgradeSecond = contract.createPersistenceTransactionV1({
        transactionId: "transaction:upgrade:2", worldId: upgradeWorldId, checkpointId: "checkpoint:upgrade:2",
        expectedJournalSequence: 1, nextJournalSequence: 2,
        mutations: [{ operation: "put", address: upgradeAddress, expectedRecordRevision: 1, nextRecordRevision: 2, payload: Uint8Array.from([2, 7, 1]) }],
      });
      const upgradeResult = await upgraded.commit(upgradeSecond);
      const upgradedParent = await upgraded.readRecord(upgradeAddress, 1);
      const upgradedCurrent = await upgraded.readRecord(upgradeAddress, 2);
      await upgraded.destroyForDiagnostics();
      return {
        databaseName,
        firstStatus: firstResult.status,
        secondStatus: secondResult.status,
        staleStatus: staleResult.status,
        staleCode: staleResult.status === "rejected" ? staleResult.code : null,
        latestCheckpointId: latest?.checkpointId ?? null,
        revisionOne: revisionOne ? [...revisionOne] : null,
        revisionTwo: revisionTwo ? [...revisionTwo] : null,
        abortedRevision: abortedRevision ? [...abortedRevision] : null,
        corruptHead: corruptHead ? [...corruptHead] : null,
        retainedParent: retainedParent ? [...retainedParent] : null,
        upgradeStatus: upgradeResult.status,
        upgradedParent: upgradedParent ? [...upgradedParent] : null,
        upgradedCurrent: upgradedCurrent ? [...upgradedCurrent] : null,
      };
    });

    assert.deepEqual(durable, {
      databaseName: durable.databaseName,
      firstStatus: "committed",
      secondStatus: "committed",
      staleStatus: "rejected",
      staleCode: "stale-sequence",
      latestCheckpointId: "checkpoint:browser:2",
      revisionOne: [1, 2, 3],
      revisionTwo: [9, 8, 7],
      abortedRevision: null,
      corruptHead: null,
      retainedParent: [1, 2, 3],
      upgradeStatus: "committed",
      upgradedParent: [3, 1, 4],
      upgradedCurrent: [2, 7, 1],
    });

    const migration = await page.evaluate(async () => {
      const adapterModule = await import("/app/game/indexeddb-persistence-adapter.ts");
      const contract = await import("/app/game/persistence-journal-contract.ts");
      const requestResult = (request) => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transactionComplete = (transaction) => new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error ?? new DOMException("transaction aborted", "AbortError"));
        transaction.onerror = () => reject(transaction.error ?? new Error("transaction failed"));
      });
      const openDatabase = (name) => new Promise((resolve, reject) => {
        const request = indexedDB.open(name, adapterModule.RUST_PERSISTENCE_DATABASE_VERSION_V1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const inspectDatabase = async (name) => {
        const database = await openDatabase(name);
        const stores = ["meta", "journal", "records", "record-versions", "checkpoints", "legacy-backups", "tombstones"];
        const transaction = database.transaction(stores, "readonly");
        const done = transactionComplete(transaction);
        const entries = await Promise.all(stores.map(async (store) => [store, await requestResult(transaction.objectStore(store).getAll())]));
        await done;
        database.close();
        return Object.fromEntries(entries);
      };
      const makeMigration = (worldId, label, seed) => {
        const sourcePayload = Uint8Array.of(seed, seed + 1, seed + 2);
        const bundle = contract.createLegacyMigrationBundleV1({
          sourceKey: `legacy:${label}`,
          sourceFormat: "blockwild-world-v2",
          worldId,
          sourcePayload,
          normalizedPayload: Uint8Array.of(seed + 3, seed + 4),
        });
        const entries = [
          { address: { universeId: worldId, locationId: "overworld", kind: "entity", recordId: `${label}:alpha` }, payload: Uint8Array.of(seed, 1) },
          { address: { universeId: worldId, locationId: "overworld", kind: "entity", recordId: `${label}:omega` }, payload: Uint8Array.of(seed, 9) },
        ];
        const checkpoint = contract.createPersistenceCheckpointV1({
          checkpointId: `checkpoint:migration:${label}`,
          parentCheckpointId: null,
          worldId,
          journalSequence: 0,
          generatorHash: "0123456789abcdef0123456789abcdef",
          contentHash: "fedcba9876543210fedcba9876543210",
          createdAt: seed,
          records: entries.map((entry) => ({ address: entry.address, revision: 1, byteLength: entry.payload.byteLength, payloadHash: contract.persistencePayloadHashV1(entry.payload) })),
        });
        return { bundle, sourcePayload, checkpoint, recordPayloads: new Map(entries.map((entry) => [contract.persistenceRecordKeyV1(entry.address), entry.payload])), entries };
      };

      const raceName = `blockwild-r8-migration-race-${crypto.randomUUID()}`;
      const raceWorld = "world:migration-race-browser";
      const first = makeMigration(raceWorld, "first", 10);
      const second = makeMigration(raceWorld, "second", 20);
      const firstAdapter = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, raceName);
      const secondAdapter = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, raceName);
      // Settle both opens so Promise call order is transaction creation order.
      await firstAdapter.readLatestCheckpoint(raceWorld);
      await secondAdapter.readLatestCheckpoint(raceWorld);
      const race = await Promise.allSettled([firstAdapter.commitMigration(first), secondAdapter.commitMigration(second)]);
      const firstReadback = await firstAdapter.verifyMigrationReadback(first);
      const secondReadback = await secondAdapter.verifyMigrationReadback(second);
      const beforeRetry = await inspectDatabase(raceName);
      await firstAdapter.commitMigration(first);
      const afterRetry = await inspectDatabase(raceName);

      const firstVersionKey = `${contract.persistenceRecordKeyV1(first.checkpoint.records[0].address)}|revision:${String(1).padStart(20, "0")}`;
      const corruptionDatabase = await openDatabase(raceName);
      const corruption = corruptionDatabase.transaction("record-versions", "readwrite");
      const corruptionDone = transactionComplete(corruption);
      corruption.objectStore("record-versions").delete(firstVersionKey);
      await corruptionDone;
      corruptionDatabase.close();
      let corruptRetry = "fulfilled";
      try { await firstAdapter.commitMigration(first); } catch { corruptRetry = "rejected"; }
      const corruptReadback = await firstAdapter.verifyMigrationReadback(first);
      const afterCorruptRetry = await inspectDatabase(raceName);
      await firstAdapter.close();
      await secondAdapter.destroyForDiagnostics();

      const abortName = `blockwild-r8-migration-abort-${crypto.randomUUID()}`;
      const abortWorld = "world:migration-abort-browser";
      const abortedInput = makeMigration(abortWorld, "aborted", 30);
      const injected = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, abortName);
      await injected.readLatestCheckpoint(abortWorld);
      const originalOpen = injected.open.bind(injected);
      injected.open = async () => {
        const database = await originalOpen();
        return new Proxy(database, {
          get(target, property) {
            if (property !== "transaction") {
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (...args) => {
              const idbTransaction = target.transaction(...args);
              return new Proxy(idbTransaction, {
                get(transactionTarget, transactionProperty) {
                  if (transactionProperty !== "objectStore") {
                    const value = Reflect.get(transactionTarget, transactionProperty, transactionTarget);
                    return typeof value === "function" ? value.bind(transactionTarget) : value;
                  }
                  return (storeName) => {
                    const store = transactionTarget.objectStore(storeName);
                    return new Proxy(store, {
                      get(storeTarget, storeProperty) {
                        if (storeProperty === "put" && storeName === "checkpoints") return () => { throw new DOMException("forced migration abort", "AbortError"); };
                        const value = Reflect.get(storeTarget, storeProperty, storeTarget);
                        return typeof value === "function" ? value.bind(storeTarget) : value;
                      },
                    });
                  };
                },
                set(transactionTarget, property, value) { return Reflect.set(transactionTarget, property, value, transactionTarget); },
              });
            };
          },
        });
      };
      let abortResult = "fulfilled";
      try { await injected.commitMigration(abortedInput); } catch { abortResult = "rejected"; }
      await injected.close();
      const afterAbort = await inspectDatabase(abortName);

      // A tombstone is also a preflight conflict and must remain the only
      // durable object after the rejected migration.
      const tombstoneDatabase = await openDatabase(abortName);
      const tombstoneWrite = tombstoneDatabase.transaction("tombstones", "readwrite");
      const tombstoneDone = transactionComplete(tombstoneWrite);
      tombstoneWrite.objectStore("tombstones").put({ key: `tombstone|${encodeURIComponent(abortWorld)}`, worldId: abortWorld, tombstoneHash: "0".repeat(32), storageRevision: 1 });
      await tombstoneDone;
      tombstoneDatabase.close();
      const tombstoneAdapter = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, abortName);
      let tombstoneResult = "fulfilled";
      try { await tombstoneAdapter.commitMigration(abortedInput); } catch { tombstoneResult = "rejected"; }
      await tombstoneAdapter.close();
      const afterTombstone = await inspectDatabase(abortName);
      await new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, abortName).destroyForDiagnostics();

      const count = (snapshot, store) => snapshot[store].length;
      const meta = (snapshot, prefix) => snapshot.meta.find((entry) => entry.key.startsWith(prefix))?.value ?? null;
      return {
        raceStatuses: race.map((result) => result.status),
        firstReady: firstReadback.ready,
        secondReady: secondReadback.ready,
        marker: meta(beforeRetry, "migration-complete|"),
        head: meta(beforeRetry, "latest-checkpoint|"),
        sequence: meta(beforeRetry, "journal-sequence|"),
        revisionBeforeRetry: meta(beforeRetry, "storage-revision|"),
        revisionAfterRetry: meta(afterRetry, "storage-revision|"),
        raceCounts: Object.fromEntries(["journal", "records", "record-versions", "checkpoints", "legacy-backups", "tombstones"].map((store) => [store, count(beforeRetry, store)])),
        corruptRetry,
        corruptReady: corruptReadback.ready,
        corruptMissingVersion: corruptReadback.missingRecords.includes(`version:${firstVersionKey}`),
        versionsAfterCorruptRetry: count(afterCorruptRetry, "record-versions"),
        currentsAfterCorruptRetry: count(afterCorruptRetry, "records"),
        abortResult,
        abortCounts: Object.fromEntries(["meta", "journal", "records", "record-versions", "checkpoints", "legacy-backups", "tombstones"].map((store) => [store, count(afterAbort, store)])),
        tombstoneResult,
        tombstoneCounts: Object.fromEntries(["meta", "journal", "records", "record-versions", "checkpoints", "legacy-backups", "tombstones"].map((store) => [store, count(afterTombstone, store)])),
      };
    });

    assert.deepEqual(migration, {
      raceStatuses: ["fulfilled", "rejected"],
      firstReady: true,
      secondReady: false,
      marker: migration.marker,
      head: "checkpoint:migration:first",
      sequence: 0,
      revisionBeforeRetry: 1,
      revisionAfterRetry: 1,
      raceCounts: { journal: 0, records: 2, "record-versions": 2, checkpoints: 1, "legacy-backups": 1, tombstones: 0 },
      corruptRetry: "rejected",
      corruptReady: false,
      corruptMissingVersion: true,
      versionsAfterCorruptRetry: 1,
      currentsAfterCorruptRetry: 2,
      abortResult: "rejected",
      abortCounts: { meta: 0, journal: 0, records: 0, "record-versions": 0, checkpoints: 0, "legacy-backups": 0, tombstones: 0 },
      tombstoneResult: "rejected",
      tombstoneCounts: { meta: 0, journal: 0, records: 0, "record-versions": 0, checkpoints: 0, "legacy-backups": 0, tombstones: 1 },
    });
    assert.match(migration.marker, /^migration-v1\|[0-9a-f]{32}\|[0-9a-f]{32}$/u);

    const devtools = await page.context().newCDPSession(page);
    const origin = new URL(url).origin;
    const usage = await devtools.send("Storage.getUsageAndQuota", { origin });
    await devtools.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: usage.usage + 2_048 });
    const quotaResult = await page.evaluate(async () => {
      const adapterModule = await import("/app/game/indexeddb-persistence-adapter.ts");
      const contract = await import("/app/game/persistence-journal-contract.ts");
      const databaseName = `blockwild-r8-quota-${crypto.randomUUID()}`;
      const adapter = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, databaseName);
      await adapter.readLatestCheckpoint("world:quota");
      const transaction = contract.createPersistenceTransactionV1({
        transactionId: "transaction:quota",
        worldId: "world:quota",
        checkpointId: "checkpoint:quota",
        expectedJournalSequence: 0,
        nextJournalSequence: 1,
        mutations: [{
          operation: "put",
          address: { universeId: "world:quota", locationId: "overworld", kind: "entity", recordId: "quota-probe" },
          expectedRecordRevision: null,
          nextRecordRevision: 1,
          payload: new Uint8Array(128 * 1024).fill(7),
        }],
      });
      const nativeResult = await adapter.commit(transaction);
      const nativeDurable = await adapter.readRecord(transaction.mutations[0].address, 1);
      await adapter.destroyForDiagnostics();
      if (nativeResult.status === "rejected" && nativeResult.code === "quota") {
        return { status: nativeResult.status, code: nativeResult.code, durable: nativeDurable !== null, mechanism: "cdp-quota" };
      }

      // Some Chromium builds expose the quota override but do not apply it to
      // IndexedDB. Exercise the same browser-native QuotaExceededError at the
      // IDB transaction boundary so rollback/classification still has a real
      // DOM implementation behind it instead of a Node storage fake.
      const injectedName = `blockwild-r8-quota-injected-${crypto.randomUUID()}`;
      const injected = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, injectedName);
      await injected.readLatestCheckpoint("world:quota-injected");
      const open = injected.open.bind(injected);
      injected.open = async () => {
        const database = await open();
        return new Proxy(database, {
          get(target, property) {
            if (property !== "transaction") {
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (...args) => {
              const idbTransaction = target.transaction(...args);
              return new Proxy(idbTransaction, {
                get(transactionTarget, transactionProperty) {
                  if (transactionProperty !== "objectStore") {
                    const value = Reflect.get(transactionTarget, transactionProperty, transactionTarget);
                    return typeof value === "function" ? value.bind(transactionTarget) : value;
                  }
                  return (storeName) => {
                    const store = transactionTarget.objectStore(storeName);
                    return new Proxy(store, {
                      get(storeTarget, storeProperty) {
                        if (storeProperty === "put" && storeName === "records") {
                          return () => { throw new DOMException("browser quota fixture", "QuotaExceededError"); };
                        }
                        const value = Reflect.get(storeTarget, storeProperty, storeTarget);
                        return typeof value === "function" ? value.bind(storeTarget) : value;
                      },
                    });
                  };
                },
                set(transactionTarget, property, value) { return Reflect.set(transactionTarget, property, value, transactionTarget); },
              });
            };
          },
        });
      };
      const injectedTransaction = contract.createPersistenceTransactionV1({
        transactionId: "transaction:quota-injected",
        worldId: "world:quota-injected",
        checkpointId: "checkpoint:quota-injected",
        expectedJournalSequence: 0,
        nextJournalSequence: 1,
        mutations: [{
          operation: "put",
          address: { universeId: "world:quota-injected", locationId: "overworld", kind: "entity", recordId: "quota-probe" },
          expectedRecordRevision: null,
          nextRecordRevision: 1,
          payload: Uint8Array.of(7),
        }],
      });
      const result = await injected.commit(injectedTransaction);
      await injected.close();
      const readback = new adapterModule.IndexedDbPersistenceAdapterV1(indexedDB, injectedName);
      const durable = await readback.readRecord(injectedTransaction.mutations[0].address, 1);
      await readback.destroyForDiagnostics();
      return { status: result.status, code: result.status === "rejected" ? result.code : null, durable: durable !== null, mechanism: "browser-domexception" };
    });
    assert.equal(quotaResult.status, "rejected");
    assert.equal(quotaResult.code, "quota");
    assert.equal(quotaResult.durable, false);
    assert.match(quotaResult.mechanism, /^(?:cdp-quota|browser-domexception)$/u);
  } finally {
    await browser?.close().catch(() => undefined);
    await vite.close();
  }
});
