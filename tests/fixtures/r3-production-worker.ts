import {
  TerrainGenerationPipeline, type TerrainGenerationRequest, type TerrainGenerationResult, type TerrainGenerationSubmission,
} from "../../app/game/terrain-generation-pipeline.ts";
import {
  createGenerateChunkRequestV2, createGeneratedChunkV2, LEGACY_TERRAIN_CONTENT_HASH_V2,
  legacyTerrainGeneratorHashV2, stableTerrainGenerationJsonV2, type GeneratedChunkV2,
} from "../../app/game/terrain-generation-contract.ts";
import {
  assertR3ProductionWorkerResult, decodeR3WorkerExpectedChunk, R3_WORKER_STREAM_NAMES,
  type R3WorkerCase, type R3WorkerManifest,
} from "./r3-production-worker-contract.ts";

const state = {
  schema: 1, status: "ready", phase: "Awaiting start", artifactHash: "", corpusHash: "", error: null as string | null,
  caseCount: 0, coverageCount: 0, compared: 0, transferredStreams: 0, markerRows: 0,
  schedules: { forward: [] as string[], reverse: [] as string[], zipper: [] as string[] },
  rows: [] as { id: string; order: string; canonicalHash: string; milliseconds: number; bytes: number; markers: number }[],
  checks: [] as string[], diagnostics: null as ReturnType<TerrainGenerationPipeline["diagnostics"]> | null,
  codeReuse: { startup: null, reset: null, replacement: null } as Record<"startup" | "reset" | "replacement", ReturnType<TerrainGenerationPipeline["diagnostics"]>["codeCache"]>,
  cleanup: { pipelineDisposed: false, postDisposeRejected: false, prototypesRestored: false, observedWorkers: 0, terminatedWorkers: 0 },
  transfers: { requests: 0, nonemptyInputs: 0, detachedNonemptyInputs: 0, sourceInputsUnchanged: 0 },
  timings: { startupMilliseconds: 0, totalMilliseconds: 0 },
};
let running = Promise.resolve();
const canvas = document.querySelector<HTMLCanvasElement>("#evidence")!;
const ctx = canvas.getContext("2d")!;
function draw() {
  ctx.fillStyle = "#fbfcf8"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#183c31"; ctx.font = "bold 30px system-ui"; ctx.fillText("R3 · Actual production terrain workers", 30, 49);
  ctx.font = "18px system-ui"; ctx.fillText(state.phase, 30, 84);
  ctx.font = "14px monospace"; ctx.fillText(`Artifact ${state.artifactHash || "pending provenance validation"}`, 30, 115);
  for (const [index, [name, completed]] of Object.entries(state.schedules).entries()) {
    const top = 150 + index * 104;
    ctx.font = "bold 17px system-ui"; ctx.fillStyle = "#183c31"; ctx.fillText(`${name.toUpperCase()}  ${completed.length} / 155`, 30, top);
    for (let cell = 0; cell < 155; cell += 1) {
      ctx.fillStyle = cell < completed.length ? "#287655" : "#dce5dc";
      ctx.fillRect(30 + cell % 31 * 33, top + 12 + Math.floor(cell / 31) * 12, 28, 8);
    }
  }
  ctx.fillStyle = state.status === "failed" ? "#a82727" : "#183c31";
  ctx.font = "bold 20px system-ui"; ctx.fillText(`${state.status.toUpperCase()} · ${state.compared} exact comparisons · ${state.transferredStreams} streams`, 30, 480);
  ctx.font = "16px system-ui";
  ctx.fillText(`POI rows: ${state.markerRows} · ${state.checks.length} lifecycle checks · workers terminated: ${state.cleanup.terminatedWorkers}/${state.cleanup.observedWorkers}`, 30, 513);
  ctx.fillText(`Phase timing: ${(state.timings.totalMilliseconds / 1000).toFixed(2)} s (observational only)`, 30, 545);
  ctx.font = "15px system-ui"; ctx.fillStyle = "#64736c";
  const footer = state.error ?? "Default factory + terrain-generation-worker.ts · no injected worker or fake kernel";
  ctx.fillText(footer.length > 126 ? `${footer.slice(0, 123)}…` : footer, 30, 581);
}
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function until(predicate: () => boolean, label: string, timeout = 60_000) {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    invariant(performance.now() < deadline, `${label} timed out`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function requestFor(entry: R3WorkerCase) {
  const [cx, cz] = entry.chunk; const generationOptions = entry.options ?? {};
  const namespace = `terrain-v5|g18|${entry.seed}|${stableTerrainGenerationJsonV2(generationOptions)}|${cx},${cz}|${entry.edits?.length ? 1 : 0}`;
  return createGenerateChunkRequestV2({ epoch: 1, taskId: entry.ordinal, revision: entry.ordinal, namespace,
    contentHash: LEGACY_TERRAIN_CONTENT_HASH_V2, generatorHash: legacyTerrainGeneratorHashV2(namespace),
    seedText: entry.seed, generationOptions, key: `${cx},${cz}`, cx, cz, edits: entry.edits ?? [] });
}
function pipelineRequest(entry: R3WorkerCase): TerrainGenerationRequest {
  const { epoch: _epoch, taskId: _taskId, ...request } = requestFor(entry);
  void _epoch; void _taskId;
  return { ...request, edits: entry.edits ?? [] };
}

/** Observe native pass-through calls only. Default construction, message delivery and worker code are untouched. */
function observeNativeWorkerTransfers() {
  const postMessage = Worker.prototype.postMessage; const terminate = Worker.prototype.terminate;
  const nativePost = postMessage as (this: Worker, message: unknown, options?: Transferable[] | StructuredSerializeOptions) => void;
  const observed = new Set<Worker>(); const terminated = new Set<Worker>(); const errors: string[] = [];
  Worker.prototype.postMessage = function(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
    observed.add(this);
    const value = message as { type?: string; request?: { edits?: Uint32Array } };
    const edits = value.type === "generate-chunk-v2" ? value.request?.edits : undefined;
    const length = edits?.byteLength ?? 0;
    if (edits) {
      state.transfers.requests += 1;
      const transfer = Array.isArray(options) ? options : options?.transfer;
      if (transfer?.length !== 1 || transfer[0] !== edits.buffer) errors.push("request transfer list is not the exact edits buffer");
      if (length > 0) state.transfers.nonemptyInputs += 1;
    }
    nativePost.call(this, message, options);
    if (edits && length > 0) {
      if (edits.byteLength === 0 && edits.buffer.byteLength === 0) state.transfers.detachedNonemptyInputs += 1;
      else errors.push("native postMessage did not detach the nonempty worker input");
    }
  };
  Worker.prototype.terminate = function() { observed.add(this); terminated.add(this); return terminate.call(this); };
  return {
    errors,
    cleanup() {
      state.cleanup.observedWorkers = observed.size; state.cleanup.terminatedWorkers = terminated.size;
      Worker.prototype.postMessage = postMessage; Worker.prototype.terminate = terminate;
      state.cleanup.prototypesRestored = Worker.prototype.postMessage === postMessage && Worker.prototype.terminate === terminate;
      invariant(observed.size > 0 && observed.size === terminated.size, "not every actual worker was explicitly terminated");
    },
  };
}

async function run() {
  state.status = "running"; state.phase = "Loading independently generated oracle bytes"; draw();
  const started = performance.now();
  const manifest = await (await fetch("/__r3-production-worker/manifest.json", { cache: "no-store" })).json() as R3WorkerManifest;
  invariant(manifest.schema === 1 && manifest.cases.length === 155 && manifest.coverageCount === 89, "full corpus shape changed");
  state.artifactHash = manifest.artifactHash; state.corpusHash = manifest.corpusHash;
  state.caseCount = manifest.cases.length; state.coverageCount = manifest.coverageCount;
  const cases = new Map(manifest.cases.map(entry => [entry.id, entry]));
  const expected = new Map<string, GeneratedChunkV2>();
  for (const entry of manifest.cases) {
    const response = await fetch(`/__r3-production-worker/expected/${entry.ordinal}.bin`, { cache: "no-store" });
    invariant(response.ok, `${entry.id}: expected bytes unavailable`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    invariant(digest === entry.expectedBytesHash, `${entry.id}: oracle byte digest drift`);
    expected.set(entry.id, decodeR3WorkerExpectedChunk(bytes, entry, requestFor(entry)));
  }
  const observer = observeNativeWorkerTransfers();
  // Normal production authority selection and the real default module Worker URL.
  const pipeline = new TerrainGenerationPipeline(2, 2, { startupTimeoutMilliseconds: 60_000, taskTimeoutMilliseconds: 60_000 });
  try {
    state.phase = "Starting two actual terrain-generation-worker.ts modules"; draw();
    const boot = performance.now();
    await until(() => pipeline.availableSlots === 2 || pipeline.authorityUnavailable, "worker startup");
    invariant(pipeline.state === "ready" && pipeline.mode === "rust" && pipeline.diagnostics().selectionSource !== "test", "normal certified Rust authority was not selected");
    state.codeReuse.startup = pipeline.diagnostics().codeCache;
    invariant(state.codeReuse.startup?.compilations === 1 && state.codeReuse.startup.resolutions === 1
      && state.codeReuse.startup.cacheHits === 0 && state.codeReuse.startup.assetFetches === 2
      && state.codeReuse.startup.entries === 1 && state.codeReuse.startup.pending === 0
      && state.codeReuse.startup.failures === 0 && state.codeReuse.startup.verifiedBytes > 0,
    "initial real workers did not share exactly one verified immutable code acquisition");
    state.timings.startupMilliseconds = performance.now() - boot;

    function launch(entry: R3WorkerCase) {
      const input = pipelineRequest(entry); const before = JSON.stringify(input); const began = performance.now();
      let handle: TerrainGenerationSubmission | null = null;
      const result = new Promise<{ value: TerrainGenerationResult; handle: TerrainGenerationSubmission; milliseconds: number }>((resolve, reject) => {
        handle = pipeline.submitWithHandle(input, value => {
          if (!handle) { reject(new Error("worker completed before submission identity existed")); return; }
          resolve({ value, handle, milliseconds: performance.now() - began });
        }, error => reject(error ?? new Error("worker task failed")));
        if (!handle) reject(new Error("ready production worker did not accept the request"));
      });
      invariant(before === JSON.stringify(input), "production pipeline detached or changed gameplay-owned inputs");
      state.transfers.sourceInputsUnchanged += 1;
      return { result, handle: handle as TerrainGenerationSubmission | null };
    }
    function check(entry: R3WorkerCase, completed: Awaited<ReturnType<typeof launch>["result"]>) {
      const request = createGenerateChunkRequestV2({ ...requestFor(entry), epoch: completed.handle.epoch, taskId: completed.handle.taskId });
      const checked = assertR3ProductionWorkerResult(completed.value, expected.get(entry.id)!, request);
      const markers = JSON.stringify(completed.value.structureMarkers);
      if (entry.markerToken !== undefined) invariant(markers.includes(entry.markerToken), `${entry.id}: required POI token missing`);
      if (entry.absentMarkerToken !== undefined) invariant(!markers.includes(entry.absentMarkerToken), `${entry.id}: forbidden POI token present`);
      if (entry.minimumMarkers !== undefined) invariant(checked.markerCount >= entry.minimumMarkers, `${entry.id}: insufficient POI markers`);
      if (entry.maximumMarkers !== undefined) invariant(checked.markerCount <= entry.maximumMarkers, `${entry.id}: excessive POI markers`);
      return checked;
    }
    for (const order of ["forward", "reverse", "zipper"] as const) {
      invariant(manifest.schedules[order].length === 155 && new Set(manifest.schedules[order]).size === 155, `${order}: incomplete order`);
      for (const id of manifest.schedules[order]) {
        const entry = cases.get(id); invariant(entry, `${order}: unknown case ${id}`);
        state.phase = `${order}: ${id}`;
        const completed = await launch(entry).result; const checked = check(entry, completed);
        state.schedules[order].push(id); state.compared += 1; state.transferredStreams += R3_WORKER_STREAM_NAMES.length;
        state.markerRows += checked.markerCount;
        const canonicalCandidate = createGeneratedChunkV2(requestFor(entry), completed.value);
        state.rows.push({ id, order, canonicalHash: canonicalCandidate.chunkHash, milliseconds: completed.milliseconds,
          bytes: checked.streamBytes.reduce((sum, length) => sum + length, 0), markers: checked.markerCount });
        state.diagnostics = pipeline.diagnostics(); state.timings.totalMilliseconds = performance.now() - started; draw();
      }
    }

    const probe = manifest.cases.find(entry => entry.edits?.length)!;
    invariant(probe, "corpus has no edit-transfer probe");
    state.phase = "Checking cancellation, same-lane stale results, and epoch reset"; draw();
    const canceled = launch(probe); const cancelFailure = canceled.result.then(() => null, error => String(error));
    invariant(canceled.handle?.cancel() === true && canceled.handle.cancel() === false, "cancellation is not exactly-once");
    invariant((await cancelFailure)?.includes("cancelled"), "cancelled task installed a result");
    await until(() => pipeline.availableSlots === 2, "cancel drain");
    check(probe, await launch(probe).result); state.checks.push("cancelled task installs nothing; exact retry succeeds");

    const older = launch(probe); const staleFailure = older.result.then(() => null, error => String(error));
    const newer = launch(probe); check(probe, await newer.result);
    invariant((await staleFailure)?.includes("stale"), "superseded same-lane result installed");
    state.checks.push("same-lane supersession rejects the old result and preserves the newest");

    const reset = launch(probe); const resetFailure = reset.result.then(() => null, error => String(error));
    pipeline.resetAuthorityEpoch();
    invariant((await resetFailure)?.includes("world reset"), "in-flight old-world request survived epoch reset");
    await until(() => pipeline.availableSlots === 2 || pipeline.authorityUnavailable, "post-reset worker startup");
    invariant(pipeline.state === "ready", "reset did not recreate actual workers");
    state.codeReuse.reset = pipeline.diagnostics().codeCache;
    invariant(state.codeReuse.reset?.resolutions === 2 && state.codeReuse.reset.cacheHits === 1
      && state.codeReuse.reset.compilations === 1 && state.codeReuse.reset.assetFetches === 2
      && state.codeReuse.reset.verifiedBytes === state.codeReuse.startup.verifiedBytes,
    "fresh reset workers refetched/recompiled code or failed to resolve the selector anew");
    check(probe, await launch(probe).result); state.checks.push("epoch reset terminates old workers and an exact new-world retry succeeds");
    invariant(pipeline.completed === 468 && pipeline.submitted === 471 && pipeline.canceled === 1 && pipeline.stale === 1,
      "production result/cancel/stale counters differ from exact expected outcomes");
    invariant(pipeline.failed === 0 && pipeline.rejected === 0 && pipeline.restarts === 0 && !pipeline.lastError, "worker authority recovered from or hid an unexpected failure");
    invariant(pipeline.simulateWorkerCrashForDiagnostics(), "production diagnostic crash seam did not select a real worker");
    await until(() => pipeline.availableSlots === 2 || pipeline.authorityUnavailable, "diagnostic crash replacement");
    invariant(pipeline.state === "ready" && pipeline.diagnostics().restarts === 1, "diagnostic worker crash did not restore configured capacity exactly once");
    state.codeReuse.replacement = pipeline.diagnostics().codeCache;
    invariant(JSON.stringify(state.codeReuse.replacement) === JSON.stringify(state.codeReuse.reset),
      "same-epoch replacement refetched/recompiled already prepared immutable code");
    state.checks.push("fresh reset/replacement workers reuse one verified Module while reset resolves the selector anew");
    // Occupy the surviving first slot, then require the newly appended replacement
    // to produce the newer same-lane result. No fake scheduling or worker injection.
    const survivor = launch(probe); const survivorStale = survivor.result.then(() => null, error => String(error));
    check(probe, await launch(probe).result);
    invariant((await survivorStale)?.includes("stale"), "replacement-worker newest result did not supersede its surviving slot");
    invariant(pipeline.failed === 0 && pipeline.rejected === 0 && !pipeline.lastError, "post-crash exact generation failed");
    state.checks.push("production diagnostic crash terminates a real slot; one replacement restores exact generation");
    invariant(observer.errors.length === 0, observer.errors.join("; "));
    invariant(state.transfers.requests === 473 && state.transfers.sourceInputsUnchanged === 473
      && state.transfers.nonemptyInputs > 0 && state.transfers.nonemptyInputs === state.transfers.detachedNonemptyInputs,
    "input transfers did not detach exactly or gameplay inputs were lost");
    state.checks.push("all native input transfers and gameplay-owned edit inputs preserved their ownership contract");
  } finally {
    pipeline.dispose(); state.diagnostics = pipeline.diagnostics();
    state.cleanup.pipelineDisposed = pipeline.state === "disposed" && pipeline.diagnostics().workers === 0 && pipeline.availableSlots === 0;
    state.cleanup.postDisposeRejected = pipeline.submitWithHandle(pipelineRequest(manifest.cases[0]), () => { throw new Error("disposed worker installed a result"); }) === null;
    observer.cleanup(); state.timings.totalMilliseconds = performance.now() - started; draw();
  }
  invariant(state.cleanup.pipelineDisposed && state.cleanup.postDisposeRejected && state.cleanup.prototypesRestored
    && state.cleanup.observedWorkers === 5 && state.cleanup.terminatedWorkers === 5, "explicit worker cleanup failed");
  invariant(state.diagnostics?.codeCache?.disposed && state.diagnostics.codeCache.entries === 0 && state.diagnostics.codeCache.pending === 0,
    "pipeline disposal retained immutable code entries or owned acquisition");
  state.checks.push("every real worker terminated, native prototypes restored, disposed submissions rejected");
  state.status = "passed"; state.phase = "PASS · 155 cases × 3 orders; lifecycle and cleanup exact"; draw();
}

const surface = window as unknown as { render_game_to_text: () => string; advanceTime: (milliseconds: number) => Promise<void> };
surface.render_game_to_text = () => JSON.stringify(state);
surface.advanceTime = async () => { await running; draw(); };
document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", () => {
  document.querySelector<HTMLButtonElement>("#run")!.disabled = true;
  running = run().catch(error => { state.status = "failed"; state.error = String(error); state.phase = "FAIL · evidence preserved"; draw(); console.error(error); });
});
draw();
