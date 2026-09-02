import {
  GENERATED_CHUNK_SCHEMA_V2,
  GENERATE_CHUNK_REQUEST_SCHEMA_V2,
  TERRAIN_GENERATION_PROTOCOL_V2,
  generatedChunkTransferListV2,
  type TerrainGenerationWorkerRequestV2,
  type TerrainGenerationWorkerResponseV2,
} from "./terrain-generation-contract";
import { InjectedTerrainGenerationBackendV2, type TerrainGenerationBackendV2 } from "./rust-terrain-generation-backend";
import { RustTerrainGenerationBridgeV2 } from "./rust-terrain-generation-bridge";

declare const self: {
  onmessage: ((event: MessageEvent<TerrainGenerationWorkerRequestV2>) => void) | null;
  postMessage(message: TerrainGenerationWorkerResponseV2, options?: StructuredSerializeOptions): void;
};

const controllers = new Map<string, AbortController>();
let backendPromise: Promise<TerrainGenerationBackendV2> | null = null;
let rustBridge: RustTerrainGenerationBridgeV2 | null = null;
let preparedCode: Extract<TerrainGenerationWorkerRequestV2, { type: "initialize-terrain-generation-v2" }>["code"] | null = null;
let bootstrapStarted = false;
let bootstrapFailed = false;
let backendReady = false;

function taskKey(epoch: number, taskId: number) { return `${epoch}:${taskId}`; }

function backend() {
  if (!preparedCode) return Promise.reject(new Error("Rust terrain worker has not received verified code bootstrap"));
  backendPromise ??= Promise.resolve().then(async () => {
    rustBridge = new RustTerrainGenerationBridgeV2({ preparedCode: preparedCode! });
    await rustBridge.initialize();
    return new InjectedTerrainGenerationBackendV2((request) => rustBridge!.generate(request), "rust-wasm-authoritative");
  });
  return backendPromise;
}

function post(message: TerrainGenerationWorkerResponseV2, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

function initialize(message: Extract<TerrainGenerationWorkerRequestV2, { type: "initialize-terrain-generation-v2" }>) {
  if (bootstrapStarted || bootstrapFailed || !Number.isSafeInteger(message.bootstrapId) || message.bootstrapId <= 0
    || !message.code || !/^[a-f0-9]{64}$/u.test(message.code.identity)) {
    bootstrapFailed = true;
    post({ type: "terrain-generation-startup-error-v2", message: "Duplicate or invalid verified-code bootstrap" });
    return;
  }
  bootstrapStarted = true; preparedCode = message.code;
  const bootstrapId = message.bootstrapId; const codeIdentity = message.code.identity;
  void backend().then(() => {
    if (bootstrapFailed) throw new Error("Verified-code bootstrap was invalidated");
    const certificate = rustBridge?.diagnostics().certificate;
    const locatorCertificate = rustBridge?.diagnostics().locatorCertificate;
    if (!certificate || !locatorCertificate) throw new Error("Rust terrain authority certificates are unavailable after initialization");
    backendReady = true;
    post({
      type: "terrain-generation-ready-v2",
      protocolVersion: TERRAIN_GENERATION_PROTOCOL_V2,
      requestSchemaVersion: GENERATE_CHUNK_REQUEST_SCHEMA_V2,
      resultSchemaVersion: GENERATED_CHUNK_SCHEMA_V2,
      backend: "rust-wasm-authoritative",
      bootstrapId,
      codeIdentity,
      certificate,
      locatorCertificate,
    });
  }).catch((error) => post({
    type: "terrain-generation-startup-error-v2",
    message: error instanceof Error ? error.message : String(error),
  }));
}

self.onmessage = (event: MessageEvent<TerrainGenerationWorkerRequestV2>) => {
  const message = event.data;
  if (message.type === "initialize-terrain-generation-v2") { initialize(message); return; }
  if (message.type === "cancel-generate-chunk-v2") {
    controllers.get(taskKey(message.epoch, message.taskId))?.abort();
    return;
  }
  if (!backendReady || bootstrapFailed) {
    post({ type: "terrain-generation-startup-error-v2", message: "Task arrived before verified Rust startup completed" });
    return;
  }
  const { request } = message;
  const key = taskKey(request.epoch, request.taskId);
  const controller = new AbortController();
  controllers.set(key, controller);
  if (message.type === "query-settlements-v1") {
    void backend().then(() => {
      if (controller.signal.aborted || !rustBridge) throw new DOMException("Cancelled", "AbortError");
      return rustBridge.querySettlements(message.request);
    }).then((result) => {
      if (controller.signal.aborted) {
        post({ type: "generate-chunk-cancelled-v2", epoch: request.epoch, taskId: request.taskId });
        return;
      }
      post({ type: "settlement-locator-result-v1", epoch: request.epoch, taskId: request.taskId, result });
    }).catch((error) => {
      if (controller.signal.aborted) {
        post({ type: "generate-chunk-cancelled-v2", epoch: request.epoch, taskId: request.taskId });
        return;
      }
      post({ type: "generate-chunk-error-v2", epoch: request.epoch, taskId: request.taskId,
        message: error instanceof Error ? error.message : String(error) });
    }).finally(() => controllers.delete(key));
    return;
  }
  if (message.type === "query-dragon-lair-v1") {
    void backend().then(() => {
      if (controller.signal.aborted || !rustBridge) throw new DOMException("Cancelled", "AbortError");
      return rustBridge.queryDragonLair(message.request);
    }).then((result) => {
      if (controller.signal.aborted) {
        post({ type: "generate-chunk-cancelled-v2", epoch: request.epoch, taskId: request.taskId });
        return;
      }
      post({ type: "dragon-lair-locator-result-v1", epoch: request.epoch, taskId: request.taskId, result });
    }).catch((error) => {
      if (controller.signal.aborted) {
        post({ type: "generate-chunk-cancelled-v2", epoch: request.epoch, taskId: request.taskId });
        return;
      }
      post({ type: "generate-chunk-error-v2", epoch: request.epoch, taskId: request.taskId,
        message: error instanceof Error ? error.message : String(error) });
    }).finally(() => controllers.delete(key));
    return;
  }
  if (message.type !== "generate-chunk-v2") return;
  const chunkRequest = message.request;
  void backend().then((generator) => generator.generate(chunkRequest, { signal: controller.signal })).then((result) => {
    if (result.status === "stale" || controller.signal.aborted) {
      post({ type: "generate-chunk-cancelled-v2", epoch: chunkRequest.epoch, taskId: chunkRequest.taskId });
      return;
    }
    post(
      { type: "generated-chunk-v2", epoch: chunkRequest.epoch, taskId: chunkRequest.taskId, result: result.chunk },
      generatedChunkTransferListV2(result.chunk),
    );
  }).catch((error) => {
    if (controller.signal.aborted) {
      post({ type: "generate-chunk-cancelled-v2", epoch: chunkRequest.epoch, taskId: chunkRequest.taskId });
      return;
    }
    post({
      type: "generate-chunk-error-v2",
      epoch: chunkRequest.epoch,
      taskId: chunkRequest.taskId,
      message: error instanceof Error ? error.message : String(error),
    });
  }).finally(() => controllers.delete(key));
};
