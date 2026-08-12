import assert from "node:assert/strict";
import test from "node:test";

import {
  RUST_CONTENT_INSTALL_CAPABILITY_V1,
  RUST_CONTENT_INSTALL_PAGE_BUDGET_V1,
  RUST_CONTENT_INSTALL_RECEIPT_TYPE_V1,
  compileRustProductionContent,
  createRustContentInstallPlanV1,
  decodeRustContentInstallPageV1,
  encodeRustContentInstallReceiptV1,
  requireBlockwildProductionContent,
  type RustContentInstallReceiptV1,
  type RustProductionContentBundle,
} from "../app/game/rust-integrated-runtime-content";
import { createRustIntegratedRuntimeDomainOperationV1 } from "../app/game/rust-integrated-runtime-codec";
import type {
  RustIntegratedRuntimeIdentityV1,
  RustIntegratedRuntimeRequestV1,
  RustIntegratedRuntimeResponseV1,
} from "../app/game/rust-integrated-runtime-contract";
import { RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1 } from "../app/game/rust-integrated-runtime-contract";
import { RustIntegratedRuntimeServiceError, RustIntegratedRuntimeServiceV1 } from "../app/game/rust-integrated-runtime-service";
import {
  installRustIntegratedRuntimeWorkerHandlerV1,
  RustIntegratedRuntimeWorkerTransportV1,
  type RustIntegratedRuntimeWorkerPortV1,
  type RustIntegratedRuntimeWorkerScopeV1,
} from "../app/game/rust-integrated-runtime-worker";

const ZERO = "0".repeat(32);
const CAPABILITIES = [
  "awaited-receipts-v1",
  "bounded-extraction-v1",
  RUST_CONTENT_INSTALL_CAPABILITY_V1,
  "fixed-step-input-v1",
  "integrated-runtime-v1",
] as const;

function identity(gameplay = 0): RustIntegratedRuntimeIdentityV1 {
  return Object.freeze({
    universeId: "1", locationId: "blockwild", tick: 0,
    revision: Object.freeze({ epoch: 1, world: 0, entities: 0, gameplay, persistence: 0, network: gameplay, simulation: 0 }),
    stateHash: gameplay.toString(16).padStart(32, "0"),
  });
}

class WorkerLoopback {
  private readonly portListeners = new Map<string, Set<(event: { data: unknown }) => void>>();
  private readonly scopeListeners = new Map<string, Set<(event: { data: unknown }) => void>>();
  readonly port: RustIntegratedRuntimeWorkerPortV1 = {
    postMessage: (message) => queueMicrotask(() => this.emit(this.scopeListeners, "message", { data: message })),
    addEventListener: (type, listener) => this.add(this.portListeners, type, listener as (event: { data: unknown }) => void),
    removeEventListener: (type, listener) => this.portListeners.get(type)?.delete(listener as (event: { data: unknown }) => void),
    terminate: () => undefined,
  };
  readonly scope: RustIntegratedRuntimeWorkerScopeV1 = {
    postMessage: (message) => queueMicrotask(() => this.emit(this.portListeners, "message", { data: message })),
    addEventListener: (type, listener) => this.add(this.scopeListeners, type, listener),
  };
  private add(map: Map<string, Set<(event: { data: unknown }) => void>>, type: string, listener: (event: { data: unknown }) => void) {
    const listeners = map.get(type) ?? new Set(); listeners.add(listener); map.set(type, listeners);
  }
  private emit(map: Map<string, Set<(event: { data: unknown }) => void>>, type: string, event: { data: unknown }) {
    for (const listener of map.get(type) ?? []) listener(event);
  }
}

class ContentKernel {
  private current = identity();
  private nextPage = 0;
  commands = 0;

  handle(request: RustIntegratedRuntimeRequestV1): RustIntegratedRuntimeResponseV1 {
    if (request.type === "runtime-create-v1") return {
      type: "runtime-ready-v1", requestId: request.requestId, clientEpoch: request.clientEpoch, workerEpoch: 1,
      runtimeHandle: 1, identity: this.current, artifactHash: "artifact", instanceId: "content-kernel", capabilities: CAPABILITIES,
    };
    if (request.type === "runtime-shutdown-v1") return {
      type: "runtime-shutdown-v1", requestId: request.requestId, clientEpoch: request.clientEpoch, workerEpoch: 1,
    };
    if (request.type !== "runtime-command-v1") throw new Error("fixture accepts content commands only");
    this.commands += 1;
    const page = decodeRustContentInstallPageV1(request.batch.operations[0].payload);
    assert.equal(page.pageIndex, this.nextPage);
    this.nextPage += 1;
    const before = this.current;
    this.current = identity(this.nextPage);
    const receipt: RustContentInstallReceiptV1 = Object.freeze({
      status: this.nextPage === page.pageCount ? "installed" : "staged",
      installId: page.installId, sourceRevision: page.sourceRevision, manifestHash: page.manifestHash, domains: page.domains,
      acceptedPages: this.nextPage, pageCount: page.pageCount,
      acceptedEntries: page.artifacts.length,
      installedEntries: this.nextPage === page.pageCount ? page.artifacts.length : 0,
      installedBytes: this.nextPage === page.pageCount ? page.artifacts.reduce((sum, artifact) => sum + artifact.canonicalBytes.byteLength + artifact.unknownExtensionBytes.byteLength, 0) : 0,
    });
    return {
      type: "runtime-command-receipt-v1", requestId: request.requestId, clientEpoch: request.clientEpoch, workerEpoch: 1,
      receipt: {
        status: "accepted", commandId: request.batch.commandId, idempotencyKey: request.batch.idempotencyKey,
        commandHash: request.batch.commandHash, before, after: this.current,
        domainReceipts: [createRustIntegratedRuntimeDomainOperationV1({
          domain: "gameplay", typeId: RUST_CONTENT_INSTALL_RECEIPT_TYPE_V1, schema: 1,
          payload: encodeRustContentInstallReceiptV1(receipt),
        })],
        receiptHash: ZERO,
      },
    };
  }
}

test("production content is emitted as bounded coarse pages with exact round trips", () => {
  const required = requireBlockwildProductionContent();
  const bundle: RustProductionContentBundle = { manifest: required.manifest, artifacts: required.artifacts, blockers: [] };
  const plan = createRustContentInstallPlanV1(bundle);
  assert.ok(plan.pages.length > 1, "production content must cross the worker in coarse pages, not per entry");
  assert.ok(plan.pages.length < bundle.artifacts.length / 100);
  assert.ok(plan.pages.every(({ payload, page }) => payload.byteLength <= RUST_CONTENT_INSTALL_PAGE_BUDGET_V1 && page.artifacts.length > 1));
  const first = decodeRustContentInstallPageV1(plan.pages[0].payload);
  const last = decodeRustContentInstallPageV1(plan.pages.at(-1)!.payload);
  assert.equal(first.artifacts[0].id, bundle.artifacts[0].id);
  assert.equal(last.artifacts.at(-1)!.id, bundle.artifacts.at(-1)!.id);
  assert.equal(first.manifestHash, required.manifest.manifestHash);
  const corrupt = Uint8Array.from(plan.pages[0].payload); corrupt[corrupt.length - 1] ^= 0x80;
  assert.throws(() => decodeRustContentInstallPageV1(corrupt), /checksum/);
});

test("Unicode and high-byte content page matches the frozen Rust wire vector", () => {
  const bundle = compileRustProductionContent("content-\u6c34-1", [{
    domain: "item", id: "orb:\u6c34", schemaId: "item-definition", schemaVersion: 1, contentVersion: 9,
    aliases: ["item:orb-\u6c34"], value: { name: "Mizu \u6c34" }, unknownExtensionBytes: Uint8Array.of(0, 0x80, 0xff),
  }]);
  const plan = createRustContentInstallPlanV1(bundle);
  assert.equal(bundle.manifest?.manifestHash, "d7ebbffbc6730af930252027558e948f");
  assert.equal(
    Buffer.from(plan.pages[0].payload).toString("hex"),
    "42574337010001009b0100004b75543dd8edf6a838b55f7d5a2a31e528000000696e7374616c6c3a643765626266666263363733306166393330323532303237353538653934386601000d000000636f6e74656e742de6b0b42d31d7ebbffbc6730af930252027558e948f0b000001000000eb1512b3b15918c9c87a01591f93f5580100000000adf4e63002272ee2c83a57a61812458f0200000000a10cf256ba7281bac83a57a61812417b0300000000efe23061189c39a0c83a57a67211d5ea040000000045af961395cd5b99c83a5716c2882d30050000000078e14c613113a899c83a57a67211d5c006000000002fe966db6f45b565c83a57969fa148f607000000007a00de9183d68586c83a5796090d490a0800000000462f9f6d667aac6ac83a5766dfaead27090000000091e7b6db86082917c83a579650a7b4dd0a00000000a21d2c4d687bc6c2c83a5786670accc300000000010000000100000000070000006f72623ae6b0b40f0000006974656d2d646566696e6974696f6e010009000000010000000c0000006974656d3a6f72622de6b0b4130000007b226e616d65223a224d697a7520e6b0b4227d030000000080ff",
  );
});

test("content-aware browser worker remains fail closed until one Rust attestation", async () => {
  const compiled = compileRustProductionContent("fixture-\u6c34", [{
    domain: "item", id: "603-\u6c34", schemaId: "item-definition", schemaVersion: 1, contentVersion: 3,
    aliases: ["item:603-\u6c34"], value: { name: "Mizu \u6c34", nested: { durability: 17 } },
    unknownExtensionBytes: Uint8Array.of(0, 0x80, 0xff),
  }]);
  assert.ok(compiled.manifest);
  const loopback = new WorkerLoopback(); const kernel = new ContentKernel();
  installRustIntegratedRuntimeWorkerHandlerV1(loopback.scope, kernel);
  const service = new RustIntegratedRuntimeServiceV1({
    expectedArtifactHash: "artifact",
    transportFactory: () => new RustIntegratedRuntimeWorkerTransportV1(loopback.port, 2_000),
  });
  await service.start({
    worldSeed: "content", universeId: "1", locationId: "blockwild", sessionId: "local",
    contentHash: compiled.manifest!.manifestHash, generatorHash: ZERO, waterBlockId: 7,
    ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1,
    directionalBlockIds: [], waterloggedBlockIds: [],
  });
  assert.equal(service.isAuthoritative(), false);
  assert.throws(() => service.step(1, 1_000, []), (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "not-authoritative");
  const receipt = await service.installContent(compiled);
  assert.equal(receipt.status, "installed");
  assert.equal(receipt.manifestHash, compiled.manifest!.manifestHash);
  assert.equal(service.isAuthoritative(), true);
  assert.deepEqual(service.diagnostics().contentManifestHash, compiled.manifest!.manifestHash);
  const commands = kernel.commands;
  assert.equal(await service.installContent(compiled), receipt, "same-bundle retry returns the installed attestation");
  assert.equal(kernel.commands, commands, "idempotent retry does not re-intern metadata");
  await service.shutdown();
});

test("service rejects a bundle that differs from the configured network content identity", async () => {
  const compiled = compileRustProductionContent("fixture", [{ domain: "item", id: "orb", schemaId: "item", schemaVersion: 1, contentVersion: 1, value: 1 }]);
  const loopback = new WorkerLoopback(); const kernel = new ContentKernel();
  installRustIntegratedRuntimeWorkerHandlerV1(loopback.scope, kernel);
  const service = new RustIntegratedRuntimeServiceV1({ expectedArtifactHash: "artifact", transportFactory: () => new RustIntegratedRuntimeWorkerTransportV1(loopback.port) });
  await service.start({ worldSeed: "x", universeId: "1", locationId: "blockwild", sessionId: "local", contentHash: "f".repeat(32), generatorHash: ZERO, ...RUST_INTEGRATED_RUNTIME_DEFAULT_TERRAIN_CONFIG_V1, waterBlockId: 7, directionalBlockIds: [], waterloggedBlockIds: [] });
  await assert.rejects(service.installContent(compiled), (error: unknown) => error instanceof RustIntegratedRuntimeServiceError && error.code === "content-install");
  assert.equal(service.isAuthoritative(), false);
  await service.shutdown();
});
