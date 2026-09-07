import type {
  RustIntegratedRuntimeCommandBatchV1,
  RustIntegratedRuntimeConfigV1,
  RustIntegratedRuntimeExtractionViewV1,
  RustIntegratedRuntimeInputFrameV1,
  RustIntegratedRuntimeContextCommandV2,
} from "./rust-integrated-runtime-contract";
import {
  RustIntegratedRuntimeServiceV1,
  type RustIntegratedRuntimeServiceOptionsV1,
} from "./rust-integrated-runtime-service";
import {
  RustIntegratedRuntimeWorkerTransportV1,
  type RustIntegratedRuntimeWorkerPortV1,
} from "./rust-integrated-runtime-worker";
import type { RustProductionContentBundle } from "./rust-integrated-runtime-content";

export type RustIntegratedRuntimeBrowserAdapterOptionsV1 = Readonly<{
  artifactHash: string;
  workerFactory?: () => Worker;
  requestTimeoutMs?: number;
  now?: () => number;
}>;

function defaultWorkerFactory() {
  return new Worker(new URL("./rust-integrated-runtime-browser-worker.ts", import.meta.url), {
    type: "module",
    name: "blockwild-integrated-runtime-v1",
  });
}

function asWorkerPort(worker: Worker) {
  return worker as unknown as RustIntegratedRuntimeWorkerPortV1;
}

/** Thin browser/platform adapter; all state decisions stay inside the Rust worker. */
export class RustIntegratedRuntimeBrowserAdapterV1 {
  readonly service: RustIntegratedRuntimeServiceV1;

  constructor(options: RustIntegratedRuntimeBrowserAdapterOptionsV1) {
    const workerFactory = options.workerFactory ?? defaultWorkerFactory;
    const serviceOptions: RustIntegratedRuntimeServiceOptionsV1 = {
      mode: "production",
      expectedArtifactHash: options.artifactHash,
      now: options.now,
      transportFactory: () => new RustIntegratedRuntimeWorkerTransportV1(
        asWorkerPort(workerFactory()),
        options.requestTimeoutMs,
      ),
    };
    this.service = new RustIntegratedRuntimeServiceV1(serviceOptions);
  }

  start(config: RustIntegratedRuntimeConfigV1) { return this.service.start(config); }
  installContent(bundle: RustProductionContentBundle) { return this.service.installContent(bundle); }
  command(batch: RustIntegratedRuntimeCommandBatchV1) { return this.service.command(batch); }
  step(monotonicTimeUs: number, budgetUs: number, inputs: readonly RustIntegratedRuntimeInputFrameV1[]) {
    return this.service.step(monotonicTimeUs, budgetUs, inputs);
  }
  stepV2(
    monotonicTimeUs: number,
    budgetUs: number,
    inputs: readonly RustIntegratedRuntimeInputFrameV1[],
    contextCommands: readonly RustIntegratedRuntimeContextCommandV2[],
  ) { return this.service.stepV2(monotonicTimeUs, budgetUs, inputs, contextCommands); }
  extract(afterRevision: number, maxBytes?: number, view?: RustIntegratedRuntimeExtractionViewV1) {
    return this.service.extract(afterRevision, maxBytes, view);
  }
  pollBulkPlatform(maxBytes?: number) { return this.service.pollBulkPlatform(maxBytes); }
  persistenceStatus(payload: Uint8Array) { return this.service.persistenceStatus(payload); }
  completeBulkPlatform(transferToken: number, response: Uint8Array) { return this.service.completeBulkPlatform(transferToken, response); }
  stageCompatibilitySaveChunk(stageId: string, chunkIndex: number, chunkCount: number, totalBytes: number, payload: Uint8Array) {
    return this.service.stageCompatibilitySaveChunk(stageId, chunkIndex, chunkCount, totalBytes, payload);
  }
  finalizeCompatibilitySave(stageId: string, createdAt: number) { return this.service.finalizeCompatibilitySave(stageId, createdAt); }
  migrateHistoricalExternalV2(stageId: string, createdAt: number, proposal: Uint8Array, worldProjection: Uint8Array) {
    return this.service.migrateHistoricalExternalV2(stageId, createdAt, proposal, worldProjection);
  }
  finalizeHistoricalExternalSaveV2(
    stageId: string,
    createdAt: number,
    proposal: Uint8Array,
    expectedPriorCheckpointBytes: Uint8Array,
  ) {
    return this.service.finalizeHistoricalExternalSaveV2(
      stageId,
      createdAt,
      proposal,
      expectedPriorCheckpointBytes,
    );
  }
  hydrateHistoricalExternalRecoveryV2(recoveryId: string) {
    return this.service.hydrateHistoricalExternalRecoveryV2(recoveryId);
  }
  reconcileHistoricalExternalFallbackV2(fallbackRecoveryId: string, createdAt: number, observation: Uint8Array) {
    return this.service.reconcileHistoricalExternalFallbackV2(fallbackRecoveryId, createdAt, observation);
  }
  hydrateCompatibilityRecovery(recoveryId: string) { return this.service.hydrateCompatibilityRecovery(recoveryId); }
  readHydratedCompatibility(recoveryId: string, chunkIndex: number) { return this.service.readHydratedCompatibility(recoveryId, chunkIndex); }
  cancelCompatibilitySaveStage(stageId: string) { return this.service.cancelCompatibilitySaveStage(stageId); }
  bulkDiagnostics() { return this.service.bulkDiagnostics(); }
  checkpoint() { return this.service.checkpoint(); }
  restore(checkpointHash: string, checkpoint: Uint8Array) { return this.service.restore(checkpointHash, checkpoint); }
  shutdown() { return this.service.shutdown(); }
  identity() { return this.service.identity(); }
  diagnostics() { return this.service.diagnostics(); }
}
