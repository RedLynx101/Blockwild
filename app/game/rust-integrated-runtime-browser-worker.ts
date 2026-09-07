import {
  RustEngineLoadError,
  RustEngineLoader,
  type RustEngineBytes,
  type RustEngineWasmExports,
} from "./rust-engine-loader";
import {
  decodeRustIntegratedRuntimeStepResultV2,
  decodeRustIntegratedRuntimeResponseV1,
  encodeRustIntegratedRuntimeStepRequestV2,
  encodeRustIntegratedRuntimeRequestV1,
} from "./rust-integrated-runtime-codec";
import {
  decodeRustIntegratedRuntimeBulkResponseV1,
  encodeRustIntegratedRuntimeBulkRequestV1,
  inspectRustIntegratedRuntimeBulkResponseAttachmentV1,
  type RustIntegratedRuntimeBulkRequestV1,
  type RustIntegratedRuntimeBulkResponseV1,
} from "./rust-integrated-runtime-bulk-platform";
import type {
  RustIntegratedRuntimeRequestV1,
  RustIntegratedRuntimeResponseV1,
  RustIntegratedRuntimeStepRequestV2,
  RustIntegratedRuntimeStepResultV2,
} from "./rust-integrated-runtime-contract";
import {
  installRustIntegratedRuntimeWorkerHandlerV1,
  type RustIntegratedRuntimeWireKernelV1,
  type RustIntegratedRuntimeWorkerScopeV1,
} from "./rust-integrated-runtime-worker";

export type RustIntegratedRuntimeWasmExportsV2 = RustEngineWasmExports & Readonly<{
  blockwild_runtime_create_v2(request: Uint8Array): RustEngineBytes;
  blockwild_runtime_command_v2(handle: number, request: Uint8Array): RustEngineBytes;
  blockwild_runtime_step_v2(handle: number, request: Uint8Array): RustEngineBytes;
  blockwild_runtime_extract_v2(handle: number, request: Uint8Array): RustEngineBytes;
  blockwild_runtime_export_save_v2(handle: number, request: Uint8Array): RustEngineBytes;
  blockwild_runtime_initialize_native_save_v2(handle: number, control: Uint8Array): RustEngineBytes;
  blockwild_runtime_migrate_legacy_v2(
    handle: number,
    control: Uint8Array,
    legacyNonWorldStateFlags: number,
    sourceKey: string,
    sourceFormat: string,
    worldProjection: Uint8Array,
  ): RustEngineBytes;
  blockwild_runtime_migrate_historical_external_v2(
    handle: number,
    control: Uint8Array,
    proposal: Uint8Array,
    worldProjection: Uint8Array,
  ): RustEngineBytes;
  blockwild_runtime_finalize_historical_external_save_v2(
    handle: number,
    control: Uint8Array,
    proposal: Uint8Array,
    expectedPriorCheckpointBytes: Uint8Array,
  ): RustEngineBytes;
  blockwild_runtime_hydrate_historical_external_v2(
    handle: number,
    control: Uint8Array,
  ): RustEngineBytes;
  blockwild_runtime_reconcile_historical_external_fallback_v2(
    handle: number,
    control: Uint8Array,
    observation: Uint8Array,
  ): RustEngineBytes;
  blockwild_runtime_bulk_v2(handle: number, control: Uint8Array, attachment: Uint8Array): RustEngineBytes;
  blockwild_runtime_bulk_take_attachment_v2(handle: number, transferToken: number): RustEngineBytes;
  blockwild_runtime_destroy_v2(handle: number, request: Uint8Array): RustEngineBytes;
}>;

const integratedExportNames = Object.freeze([
  "blockwild_runtime_create_v2",
  "blockwild_runtime_command_v2",
  "blockwild_runtime_step_v2",
  "blockwild_runtime_extract_v2",
  "blockwild_runtime_export_save_v2",
  "blockwild_runtime_initialize_native_save_v2",
  "blockwild_runtime_migrate_legacy_v2",
  "blockwild_runtime_migrate_historical_external_v2",
  "blockwild_runtime_finalize_historical_external_save_v2",
  "blockwild_runtime_hydrate_historical_external_v2",
  "blockwild_runtime_reconcile_historical_external_fallback_v2",
  "blockwild_runtime_bulk_v2",
  "blockwild_runtime_bulk_take_attachment_v2",
  "blockwild_runtime_destroy_v2",
] as const);

export function assertRustIntegratedRuntimeWasmExportsV2(
  exports: RustEngineWasmExports,
): asserts exports is RustIntegratedRuntimeWasmExportsV2 {
  for (const name of integratedExportNames) {
    if (typeof (exports as Partial<RustIntegratedRuntimeWasmExportsV2>)[name] !== "function") {
      throw new RustEngineLoadError("invalid-module", `Rust engine artifact is missing export ${name}`);
    }
  }
}

function asBytes(value: RustEngineBytes) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/**
 * Real Wasm kernel. Tests may exercise codecs and transports with protocol
 * fixtures, but production authority is granted only after this loader proves
 * the content-addressed artifact and every required integrated export.
 */
export class RustIntegratedRuntimeBrowserKernelV1 implements RustIntegratedRuntimeWireKernelV1 {
  private exports: RustIntegratedRuntimeWasmExportsV2 | null = null;
  private artifactHash: string | null = null;
  private runtimeHandle = 0;

  constructor(private readonly loader = new RustEngineLoader()) {}

  async handle(request: RustIntegratedRuntimeRequestV1): Promise<RustIntegratedRuntimeResponseV1> {
    const exports = await this.load();
    const encoded = encodeRustIntegratedRuntimeRequestV1(request);
    let raw: RustEngineBytes;
    switch (request.type) {
      case "runtime-create-v1":
      case "runtime-restore-v1":
        if (this.runtimeHandle !== 0) throw new Error("integrated runtime worker already owns a live Wasm handle");
        raw = exports.blockwild_runtime_create_v2(encoded);
        break;
      case "runtime-command-v1":
      case "runtime-recover-command-v1":
        raw = exports.blockwild_runtime_command_v2(this.requireHandle(), encoded);
        break;
      case "runtime-step-v1":
        raw = exports.blockwild_runtime_step_v2(this.requireHandle(), encoded);
        break;
      case "runtime-extract-v1":
        raw = exports.blockwild_runtime_extract_v2(this.requireHandle(), encoded);
        break;
      case "runtime-checkpoint-v1":
        raw = exports.blockwild_runtime_export_save_v2(this.requireHandle(), encoded);
        break;
      case "runtime-shutdown-v1":
        raw = exports.blockwild_runtime_destroy_v2(this.requireHandle(), encoded);
        break;
    }
    let response = decodeRustIntegratedRuntimeResponseV1(asBytes(raw));
    if (response.type === "runtime-ready-v1" || response.type === "runtime-restored-v1") {
      if (response.runtimeHandle < 1) throw new Error("integrated runtime create returned an invalid generational handle");
      // The manifest-selected loader, not Wasm self-reporting, is the source
      // of truth for the immutable artifact that supplied these exports.
      response = Object.freeze({ ...response, artifactHash: this.requireArtifactHash() });
      this.runtimeHandle = response.runtimeHandle;
    }
    if (response.type === "runtime-shutdown-v1") this.runtimeHandle = 0;
    return response;
  }

  async handleStepV2(
    request: RustIntegratedRuntimeStepRequestV2,
  ): Promise<RustIntegratedRuntimeStepResultV2 | Extract<RustIntegratedRuntimeResponseV1, { type: "runtime-error-v1" }>> {
    const exports = await this.load();
    const raw = asBytes(exports.blockwild_runtime_step_v2(
      this.requireHandle(),
      encodeRustIntegratedRuntimeStepRequestV2(request),
    ));
    const schema = raw.byteLength >= 8
      ? new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint16(6, true)
      : 0;
    if (schema === 6) return decodeRustIntegratedRuntimeStepResultV2(raw);
    const response = decodeRustIntegratedRuntimeResponseV1(raw);
    if (response.type !== "runtime-error-v1") throw new Error("schema-6 StepV2 returned an invalid legacy response");
    return response;
  }

  async handleBulk(request: RustIntegratedRuntimeBulkRequestV1): Promise<RustIntegratedRuntimeBulkResponseV1> {
    const exports = await this.load();
    const nativeInitialization = request.type === "runtime-bulk-initialize-native-save-v1";
    const legacyWorldMigration = request.type === "runtime-bulk-migrate-legacy-world-v1";
    const historicalExternalMigration = request.type === "runtime-bulk-migrate-historical-external-v2";
    const historicalExternalSave = request.type === "runtime-bulk-finalize-historical-external-save-v2";
    const historicalExternalHydration = request.type === "runtime-bulk-hydrate-historical-external-v2";
    const historicalExternalReconciliation = request.type === "runtime-bulk-reconcile-historical-external-fallback-v2";
    const translatedFinalize = nativeInitialization
      || legacyWorldMigration
      || historicalExternalMigration
      || historicalExternalSave
      || historicalExternalReconciliation ? Object.freeze({
      type: "runtime-bulk-finalize-save-v1" as const,
      requestId: request.requestId,
      clientEpoch: request.clientEpoch,
      expected: request.expected,
      stageId: nativeInitialization
        ? request.saveId
        : historicalExternalReconciliation
          ? request.fallbackRecoveryId
          : request.stageId,
      createdAt: request.createdAt,
    }) : historicalExternalHydration ? Object.freeze({
      type: "runtime-bulk-hydrate-recovery-v1" as const,
      requestId: request.requestId,
      clientEpoch: request.clientEpoch,
      expected: request.expected,
      recoveryId: request.recoveryId,
    }) : request;
    const encoded = encodeRustIntegratedRuntimeBulkRequestV1(translatedFinalize);
    const control = asBytes(
      nativeInitialization
        ? exports.blockwild_runtime_initialize_native_save_v2(this.requireHandle(), encoded.control)
        : legacyWorldMigration
          ? exports.blockwild_runtime_migrate_legacy_v2(
            this.requireHandle(),
            encoded.control,
            request.legacyNonWorldStateFlags,
            request.sourceKey,
            request.sourceFormat,
            request.worldProjection,
          )
          : historicalExternalMigration
            ? exports.blockwild_runtime_migrate_historical_external_v2(
              this.requireHandle(),
              encoded.control,
              request.proposal,
              request.worldProjection,
            )
            : historicalExternalSave
              ? exports.blockwild_runtime_finalize_historical_external_save_v2(
                this.requireHandle(),
                encoded.control,
                request.proposal,
                request.expectedPriorCheckpointBytes,
              )
              : historicalExternalHydration
                ? exports.blockwild_runtime_hydrate_historical_external_v2(
                  this.requireHandle(),
                  encoded.control,
                )
                : historicalExternalReconciliation
                  ? exports.blockwild_runtime_reconcile_historical_external_fallback_v2(
                    this.requireHandle(),
                    encoded.control,
                    request.observation,
                  )
          : exports.blockwild_runtime_bulk_v2(this.requireHandle(), encoded.control, encoded.attachment),
    );
    const metadata = inspectRustIntegratedRuntimeBulkResponseAttachmentV1(control);
    if ((nativeInitialization || legacyWorldMigration) && metadata.attachmentLength !== 0) {
      throw new Error(`${legacyWorldMigration ? "legacy world migration" : "native save initialization"} unexpectedly returned a bulk attachment`);
    }
    const attachment = metadata.attachmentLength > 0
      ? asBytes(exports.blockwild_runtime_bulk_take_attachment_v2(this.requireHandle(), metadata.transferToken))
      : new Uint8Array();
    if (attachment.byteLength !== metadata.attachmentLength) throw new Error("integrated runtime bulk attachment export returned the wrong byte length");
    const response = decodeRustIntegratedRuntimeBulkResponseV1(control, attachment);
    if ((historicalExternalMigration
      || historicalExternalSave
      || historicalExternalHydration
      || historicalExternalReconciliation)
      && metadata.attachmentLength === 0
      && response.type !== "runtime-bulk-error-v1") {
      throw new Error("historical external runtime operation omitted its attestation attachment");
    }
    return response;
  }

  dispose() {
    this.runtimeHandle = 0;
    this.exports = null;
    this.artifactHash = null;
  }

  private async load() {
    if (this.exports) return this.exports;
    const loaded = await this.loader.load();
    assertRustIntegratedRuntimeWasmExportsV2(loaded.exports);
    this.exports = loaded.exports;
    this.artifactHash = loaded.artifact.buildHash;
    return loaded.exports;
  }

  private requireHandle() {
    if (this.runtimeHandle < 1) throw new Error("integrated runtime Wasm handle is not initialized");
    return this.runtimeHandle;
  }

  private requireArtifactHash() {
    if (!this.artifactHash) throw new Error("integrated runtime artifact was not attested by the loader");
    return this.artifactHash;
  }
}

export function installRustIntegratedRuntimeBrowserWorkerV1(
  scope: RustIntegratedRuntimeWorkerScopeV1,
  loader?: RustEngineLoader,
) {
  return installRustIntegratedRuntimeWorkerHandlerV1(scope, new RustIntegratedRuntimeBrowserKernelV1(loader));
}

declare const self: RustIntegratedRuntimeWorkerScopeV1 | undefined;

if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  installRustIntegratedRuntimeBrowserWorkerV1(self);
}
