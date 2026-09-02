import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import type { BlockFacing } from "../app/game/block-facing.ts";
import { BlockId, Item, type InventorySlot } from "../app/game/data.ts";
import { type DropSpawnOptions, VoxelEngine } from "../app/game/engine.ts";
import {
  rustIntegratedRuntimeBasicDirtExpectedDropTransformV1,
} from "../app/game/rust-integrated-runtime-basic-dirt-action.ts";
import {
  RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2,
  rustIntegratedRuntimeNativeBlockEditContentSubsetHashV1,
  rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2,
  rustIntegratedRuntimeNativeBlockEditReceiptHashV1,
  type RustIntegratedRuntimeNativeBlockEditContentBindingV1,
  type RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2,
  type RustIntegratedRuntimeNativeBlockEditReceiptV1,
} from "../app/game/rust-integrated-runtime-native-block-edit.ts";
import type {
  RustIntegratedRuntimeExtractionV1,
  RustIntegratedRuntimeExtractionViewV1,
  RustIntegratedRuntimeIdentityV1,
} from "../app/game/rust-integrated-runtime-contract.ts";
import type { RustIntegratedPlayerInventoryStackV1 } from "../app/game/rust-integrated-runtime-player-inventory.ts";
import type { RustLiveCameraViewR10 } from "../app/game/rust-live-camera-view-r10.ts";
import type { RustLiveInputPumpNativeBlockEditDeliveryV1 } from "../app/game/rust-live-input-pump-r5.ts";
import type { RustLivePlayerViewR10 } from "../app/game/rust-live-player-view-r10.ts";

const GENERATION = 29;
const CONTAINER = Object.freeze({
  kind: "player" as const,
  id: "actor:native-block-edit",
  ownerId: "actor:native-block-edit",
});
const DROP_ENTITY_ID = BigInt("18446744069414584321");

const hash = (digit: string) => digit.repeat(32);

type ReceiptKind = "place-directional" | "mine-generated-drop" | "mine-content-noop";

function plainStack(itemCode: number, count: number): RustIntegratedPlayerInventoryStackV1 {
  return Object.freeze({
    itemCode,
    count,
    durabilityMillionths: null,
    metadataHash: hash("0"),
  });
}

function content(blockId: number): RustIntegratedRuntimeNativeBlockEditContentBindingV1 {
  const base = Object.freeze({
    blockId,
    manifestHash: hash("1"),
    installedRegistryHash: hash("2"),
    catalogSchemaVersion: 1,
    catalogContentVersion: 7,
    catalogBlobHash: hash("3"),
    actionReportHash: hash("4"),
    subsetHash: hash("f"),
  });
  return Object.freeze({
    ...base,
    subsetHash: rustIntegratedRuntimeNativeBlockEditContentSubsetHashV1(base),
  });
}

function sealReceipt(
  source: Omit<RustIntegratedRuntimeNativeBlockEditReceiptV1, "receiptHash">,
): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  const pending = Object.freeze({ ...source, receiptHash: hash("f") });
  return Object.freeze({
    ...pending,
    receiptHash: rustIntegratedRuntimeNativeBlockEditReceiptHashV1(pending),
  });
}

function blockEditReceipt(kind: ReceiptKind): RustIntegratedRuntimeNativeBlockEditReceiptV1 {
  if (kind === "place-directional") {
    return sealReceipt({
      schema: 1,
      sequence: 1,
      originInputSequence: 12,
      completionTick: 90,
      action: "place",
      position: Object.freeze({ x: 4, y: 40, z: -3 }),
      priorBlockId: BlockId.Air,
      priorFacing: 0,
      replacementBlockId: BlockId.WildwoodShelf,
      replacementFacing: 2,
      beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 40, residency: 8 }),
      afterWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
      beforeWorldHash: hash("7"),
      afterWorldHash: hash("8"),
      creativeMode: false,
      inventory: Object.freeze({
        container: CONTAINER,
        selectedSlot: 0,
        beforeRevision: BigInt(3),
        afterRevision: BigInt(4),
        beforeStack: plainStack(Item.WildwoodShelfItem, 2),
        afterStack: plainStack(Item.WildwoodShelfItem, 1),
      }),
      generatedDrops: Object.freeze([]),
      content: content(BlockId.WildwoodShelf),
    });
  }

  if (kind === "mine-content-noop") {
    return sealReceipt({
      schema: 1,
      sequence: 1,
      originInputSequence: 13,
      completionTick: 91,
      action: "mine",
      position: Object.freeze({ x: 7, y: 39, z: 2 }),
      priorBlockId: BlockId.Stone,
      priorFacing: 0,
      replacementBlockId: BlockId.Stone,
      replacementFacing: 0,
      beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
      afterWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
      beforeWorldHash: hash("8"),
      afterWorldHash: hash("8"),
      creativeMode: false,
      inventory: Object.freeze({
        container: CONTAINER,
        selectedSlot: 0,
        beforeRevision: BigInt(4),
        afterRevision: BigInt(4),
        beforeStack: null,
        afterStack: null,
      }),
      generatedDrops: Object.freeze([]),
      content: content(BlockId.Stone),
    });
  }

  const binding = content(BlockId.Stone);
  const provenance = Object.freeze({
    schema: 1 as const,
    manifestHash: binding.manifestHash,
    installedRegistryHash: binding.installedRegistryHash,
    catalogBlobHash: binding.catalogBlobHash,
    actionReportHash: binding.actionReportHash,
    rngSemanticsHash: hash("5"),
    blockActionSequence: BigInt(9),
    originInputSequence: 14,
    blockId: BlockId.Stone,
    position: Object.freeze({ x: -2, y: 35, z: 6 }),
    lootPlanHash: hash("6"),
    groupOrdinal: 0,
  });
  const transform = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(provenance);
  return sealReceipt({
    schema: 1,
    sequence: 1,
    originInputSequence: 14,
    completionTick: 92,
    action: "mine",
    position: provenance.position,
    priorBlockId: BlockId.Stone,
    priorFacing: 0,
    replacementBlockId: BlockId.Air,
    replacementFacing: 0,
    beforeWorldRevision: Object.freeze({ epoch: 2, mutation: 41, residency: 8 }),
    afterWorldRevision: Object.freeze({ epoch: 2, mutation: 42, residency: 8 }),
    beforeWorldHash: hash("8"),
    afterWorldHash: hash("9"),
    creativeMode: false,
    inventory: Object.freeze({
      container: CONTAINER,
      selectedSlot: 0,
      beforeRevision: BigInt(4),
      afterRevision: BigInt(4),
      beforeStack: null,
      afterStack: null,
    }),
    generatedDrops: Object.freeze([Object.freeze({
      provenance,
      entityId: DROP_ENTITY_ID,
      stack: plainStack(BlockId.Cobblestone, 1),
      ...transform,
    })]),
    content: binding,
  });
}

function liveHeld(stack: RustIntegratedPlayerInventoryStackV1 | null): RustLivePlayerViewR10["held"] {
  return stack === null ? null : Object.freeze({
    itemCode: stack.itemCode,
    count: stack.count,
    durabilityMillionths: stack.durabilityMillionths,
    metadataHash: Uint8Array.from(Buffer.from(stack.metadataHash, "hex")),
  });
}

function compatibilitySlot(stack: RustIntegratedPlayerInventoryStackV1 | null): InventorySlot | null {
  return stack === null ? null : { item: stack.itemCode, count: stack.count };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

function dirtyEvidence(
  receipt: RustIntegratedRuntimeNativeBlockEditReceiptV1,
  identity: RustIntegratedRuntimeIdentityV1,
): RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2 {
  const mutated = receipt.priorBlockId !== receipt.replacementBlockId
    || receipt.priorFacing !== receipt.replacementFacing;
  const base = Object.freeze({
    schema: 1 as const,
    sequence: receipt.sequence,
    receiptHash: receipt.receiptHash,
    sections: mutated ? Object.freeze([Object.freeze({
      universeId: identity.universeId,
      locationId: identity.locationId,
      chunkX: Math.floor(receipt.position.x / 16),
      chunkZ: Math.floor(receipt.position.z / 16),
      sectionY: Math.floor((receipt.position.y + 64) / 16),
    })]) : Object.freeze([]),
    columns: mutated
      ? Object.freeze([Object.freeze({ x: receipt.position.x, z: receipt.position.z })])
      : Object.freeze([]),
    subsystemSeeds: mutated
      ? Object.freeze(RUST_INTEGRATED_RUNTIME_NATIVE_BLOCK_EDIT_DIRTY_SUBSYSTEMS_V2.map(
        (subsystem, index) => Object.freeze({
          subsystem,
          seed: (index + 1).toString(16).repeat(32),
        }),
      ))
      : Object.freeze([]),
    evidenceHash: hash("f"),
  });
  return Object.freeze({
    ...base,
    evidenceHash: rustIntegratedRuntimeNativeBlockEditDirtyEvidenceHashV2(base),
  });
}

type ProjectionCursor = Readonly<{
  schema: 1;
  cursor: number;
  lastReceiptHash: string | null;
}>;

type HarnessHost = Readonly<{
  config: Readonly<{ universeId: string; locationId: string }>;
  diagnostics(): Readonly<{ state: "ready" }>;
  multiplayerAuthority(): Readonly<{
    runExclusiveMutation<T>(operation: () => Promise<T>): Promise<T>;
  }>;
}>;

type HarnessPump = Readonly<{
  state: "ready" | "failed" | "stopped";
  acknowledgeNativeBlockEdit(
    generation: number,
    delivery: RustLiveInputPumpNativeBlockEditDeliveryV1,
  ): boolean;
  stop(): Promise<void>;
  diagnostics(): Readonly<{
    pendingNativeBlockEditSequence: number | null;
    pendingNativeBlockEditReceiptHash: string | null;
    pendingNativeBlockEditIdentityHash: string | null;
    pendingNativeBlockEditDirtyEvidenceHash: string | null;
    pendingNativeBlockEditLegacyFallback: "v1-capability" | "v2-pre-v14" | null;
    nativeBlockEditProtocolVersion: 1 | 2;
    nativeBlockEditCursor: number;
    lastAcknowledgedNativeBlockEditSequence: number | null;
    lastAcknowledgedNativeBlockEditReceiptHash: string | null;
  }>;
}>;

type CommitInput = Readonly<{
  generation: number;
  host: HarnessHost;
  pump: HarnessPump;
  delivery: RustLiveInputPumpNativeBlockEditDeliveryV1;
  extraction: RustIntegratedRuntimeExtractionV1;
  requestedView: RustIntegratedRuntimeExtractionViewV1;
  camera: RustLiveCameraViewR10;
}>;

type CommitAccess = Readonly<{
  commitRustNativeBlockEditProjectionV1(input: CommitInput): Promise<unknown>;
  retryRustNativeBlockEditFinalizeV1(): Promise<unknown>;
  settleRustAuthorityForLifecycleV1(stage: string): Promise<void>;
  scheduleRustLiveInputAdvanceR5(): void;
  drainRustAuthorityOperations(): Promise<void>;
  selectSlotFromPlayerInput(slot: number): void;
}>;

type HarnessOptions = Readonly<{
  kind?: ReceiptKind;
  protocolVersion?: 1 | 2;
  checkpointGate?: Promise<void>;
  checkpointError?: Error;
  localSaveError?: Error;
  localSaveErrors?: readonly Error[];
  retryNetworkGate?: Promise<void>;
  worldProjectionGate?: Promise<void>;
  worldProjectionResult?: "applied" | "already-applied" | "rejected";
  currentBlock?: BlockId;
  currentFacing?: BlockFacing;
  initiallyAlreadyApplied?: boolean;
  multiplayerAuthorityMode?: "rust-authoritative";
  suppressNativeSave?: boolean;
}>;

type TamperKind =
  | "generation" | "authority-generation" | "cursor" | "inventory"
  | "world" | "facing" | "checkpoint" | "player-view" | "camera-view" | "drop-view"
  | "selected" | "mode" | "active-world" | "persistent" | "save-suppression"
  | "multiplayer-authority" | "pump-state"
  | "pump-protocol" | "pump-cursor" | "pump-sequence" | "pump-metadata" | "pump-identity"
  | "pump-dirty" | "pump-fallback" | "pump-last-sequence" | "pump-last-hash"
  | "drop-remove" | "drop-duplicate" | "drop-transform" | "drop-rotation" | "drop-velocity"
  | "drop-age" | "drop-pickup-delay" | "drop-item" | "drop-count" | "drop-durability"
  | "drop-metadata" | "extra-drop";

const prototypeStackMatches = (VoxelEngine.prototype as unknown as Readonly<{
  rustTerrainLocatorStackMatches(
    view: RustLivePlayerViewR10["held"],
    expected: RustIntegratedPlayerInventoryStackV1 | null,
  ): boolean;
}>).rustTerrainLocatorStackMatches;

function createHarness(options: HarnessOptions = {}) {
  const receipt = blockEditReceipt(options.kind ?? "place-directional");
  const queryIdentity = Object.freeze({
    universeId: "universe-native-block-edit",
    locationId: "surface",
    revision: Object.freeze({
      epoch: 1,
      world: 2,
      entities: 3,
      gameplay: 4,
      persistence: 5,
      network: 6,
      simulation: 7,
    }),
    tick: 100,
    stateHash: hash("a"),
  }) satisfies RustIntegratedRuntimeIdentityV1;
  const checkpointIdentity = Object.freeze({
    ...queryIdentity,
    revision: Object.freeze({ ...queryIdentity.revision, persistence: 6 }),
    stateHash: hash("b"),
  }) satisfies RustIntegratedRuntimeIdentityV1;
  const protocolVersion = options.protocolVersion ?? 2;
  const editDelivery = Object.freeze({
    protocolVersion,
    legacyFallback: protocolVersion === 1 ? "v1-capability" : null,
    worldGeneration: GENERATION,
    queryIdentity,
    cursorBefore: 0,
    cursorAfter: receipt.sequence,
    requestPayloadHash: hash("c"),
    projectionPayloadHash: hash("d"),
    receipt,
    dirty: protocolVersion === 1 ? null : dirtyEvidence(receipt, queryIdentity),
  }) satisfies RustLiveInputPumpNativeBlockEditDeliveryV1;

  const calls: string[] = [];
  const checkpointStarted = deferred();
  const worldProjectionStarted = deferred();
  const retryNetworkStarted = deferred();
  const acknowledgements: RustLiveInputPumpNativeBlockEditDeliveryV1[] = [];
  const savedCursors: ProjectionCursor[] = [];
  const counters = {
    worldProjectionRequests: 0,
    worldProjectionV2Requests: 0,
    worldStateWrites: 0,
    inventoryMutations: 0,
    drops: 0,
    playerCameraCommits: 0,
    localSaves: 0,
    rendererEnqueues: 0,
    pumpStops: 0,
    selectedSlotCallbacks: 0,
  };

  const initialBlock = options.initiallyAlreadyApplied
    ? receipt.replacementBlockId as BlockId
    : receipt.priorBlockId as BlockId;
  const initialFacing = options.initiallyAlreadyApplied
    ? receipt.replacementFacing as BlockFacing
    : receipt.priorFacing as BlockFacing;
  let cell = options.currentBlock ?? initialBlock;
  let facing = options.currentFacing ?? initialFacing;
  let worldReads = 0;

  const rawInventory = Array.from<InventorySlot | null>({ length: 9 }).fill(null);
  rawInventory[0] = compatibilitySlot(receipt.inventory.beforeStack);
  const inventory = new Proxy(rawInventory, {
    set(target, property, value, receiver) {
      if (property === "0") {
        counters.inventoryMutations += 1;
        calls.push("inventory:project");
      }
      return Reflect.set(target, property, value, receiver);
    },
  });

  const priorPlayer = Object.freeze({
    selectedSlot: receipt.inventory.selectedSlot,
    inventoryContainerRevision: receipt.inventory.beforeRevision,
    held: liveHeld(receipt.inventory.beforeStack),
  }) as RustLivePlayerViewR10;
  const stagedPlayer = Object.freeze({
    selectedSlot: receipt.inventory.selectedSlot,
    inventoryContainerRevision: receipt.inventory.afterRevision,
    held: liveHeld(receipt.inventory.afterStack),
  }) as RustLivePlayerViewR10;
  const stagedCamera = Object.freeze({ staged: true }) as unknown as RustLiveCameraViewR10;
  const stagedDrops = Object.freeze({
    source: Object.freeze({
      extractionRevision: BigInt(1),
      authorityTick: BigInt(100),
      inventoryDomainRevision: BigInt(4),
    }),
    transforms: Object.freeze([]),
  });
  const extraction = Object.freeze({ extraction: true }) as unknown as RustIntegratedRuntimeExtractionV1;
  const requestedView = Object.freeze({
    viewportWidth: 1280,
    viewportHeight: 720,
    viewRevision: 7,
  });
  const pumpCamera = Object.freeze({ pump: true }) as unknown as RustLiveCameraViewR10;
  let pumpDiagnostics: ReturnType<HarnessPump["diagnostics"]> = {
    pendingNativeBlockEditSequence: editDelivery.receipt.sequence as number | null,
    pendingNativeBlockEditReceiptHash: editDelivery.receipt.receiptHash as string | null,
    pendingNativeBlockEditIdentityHash: editDelivery.queryIdentity.stateHash as string | null,
    pendingNativeBlockEditDirtyEvidenceHash: (editDelivery.dirty?.evidenceHash ?? null) as string | null,
    pendingNativeBlockEditLegacyFallback: editDelivery.legacyFallback,
    nativeBlockEditProtocolVersion: editDelivery.protocolVersion,
    nativeBlockEditCursor: editDelivery.cursorBefore,
    lastAcknowledgedNativeBlockEditSequence: null as number | null,
    lastAcknowledgedNativeBlockEditReceiptHash: null as string | null,
  };

  let pumpState: HarnessPump["state"] = "ready";
  const pump: HarnessPump = Object.freeze({
    get state() { return pumpState; },
    acknowledgeNativeBlockEdit(generation, acknowledgedDelivery) {
      assert.equal(generation, GENERATION);
      assert.equal(acknowledgedDelivery, editDelivery);
      calls.push("pump:ack");
      assert.equal(pumpState, "ready");
      if (pumpDiagnostics.pendingNativeBlockEditSequence === null) {
        const duplicate = pumpDiagnostics.lastAcknowledgedNativeBlockEditSequence === editDelivery.receipt.sequence
          && pumpDiagnostics.lastAcknowledgedNativeBlockEditReceiptHash === editDelivery.receipt.receiptHash;
        if (duplicate) return false;
        pumpState = "failed";
        throw new Error("there is no matching pending native block-edit receipt");
      }
      assert.equal(pumpDiagnostics.pendingNativeBlockEditSequence, editDelivery.receipt.sequence);
      assert.equal(pumpDiagnostics.pendingNativeBlockEditReceiptHash, editDelivery.receipt.receiptHash);
      acknowledgements.push(acknowledgedDelivery);
      pumpDiagnostics = {
        ...pumpDiagnostics,
        pendingNativeBlockEditSequence: null,
        pendingNativeBlockEditReceiptHash: null,
        pendingNativeBlockEditIdentityHash: null,
        pendingNativeBlockEditDirtyEvidenceHash: null,
        pendingNativeBlockEditLegacyFallback: null,
        nativeBlockEditCursor: editDelivery.cursorAfter,
        lastAcknowledgedNativeBlockEditSequence: editDelivery.receipt.sequence,
        lastAcknowledgedNativeBlockEditReceiptHash: editDelivery.receipt.receiptHash,
      };
      return true;
    },
    async stop() {
      counters.pumpStops += 1;
      calls.push("pump:stop");
      pumpState = "stopped";
    },
    diagnostics: () => Object.freeze({ ...pumpDiagnostics }),
  });
  const authority = Object.freeze({
    async runExclusiveMutation<T>(operation: () => Promise<T>) {
      calls.push("authority:enter");
      try {
        return await operation();
      } finally {
        calls.push("authority:exit");
      }
    },
  });
  const host: HarnessHost = Object.freeze({
    config: Object.freeze({ universeId: queryIdentity.universeId, locationId: queryIdentity.locationId }),
    diagnostics: () => Object.freeze({ state: "ready" as const }),
    multiplayerAuthority: () => authority,
  });

  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine & Record<string, unknown>;
  const privateEngine = engine as unknown as {
    rustTerrainLocatorCommitLocked: boolean;
    rustNativeBlockEditProjection: ProjectionCursor;
    rustNativeBlockEditCheckpoint: unknown;
    rustNativeBlockEditPendingFinalize: unknown;
    rustNativeBlockEditQueuedSelectedSlotR5: number | null;
    rustAuthorityOperations: Set<Promise<unknown>>;
    rustLiveInputAdvance: Promise<void> | null;
    rustLiveSelectedSlotIntentR5: number | null;
    rustLiveSelectedSlotIntentPendingR5: boolean;
    rustLivePlayerAuthorityState: string;
    rustLivePlayerAuthorityLastError: string | null;
    rustRuntimeOperationsBlocked: boolean;
  };
  Object.assign(engine, {
    rustTerrainLocatorCommitLocked: false,
    rustNativeSaveSuppressedForMultiplayerRuntime: options.suppressNativeSave ?? false,
    rustNativeBlockEditProjection: Object.freeze({ schema: 1, cursor: 0, lastReceiptHash: null }),
    rustNativeBlockEditCheckpoint: null,
    rustNativeBlockEditPendingFinalize: null,
    rustNativeBlockEditQueuedSelectedSlotR5: null,
    rustAuthorityOperations: new Set<Promise<unknown>>(),
    rustLiveInputAdvance: null,
    rustRuntimeTransitionGeneration: GENERATION,
    rustLivePlayerAuthorityGeneration: GENERATION,
    rustLivePlayerAuthorityRequestedR5: true,
    rustLivePlayerAuthorityState: "ready",
    rustLivePlayerAuthorityLastError: null,
    rustRuntimeOperationsBlocked: false,
    rustRuntimeManager: { diagnostics: () => Object.freeze({ state: "ready" }) },
    rustRuntimeHost: host,
    rustLiveInputPump: pump,
    activeWorldId: "world-native-block-edit",
    persistent: true,
    rustLivePlayerAttestationR10: Object.freeze({ inventoryContainer: CONTAINER }),
    rustLivePlayerPresentationViewR10: priorPlayer,
    rustLiveCameraPresentationViewR10: null,
    rustDroppedHotTransformFrameR10: null,
    drops: [],
    rustLiveRendererExtractionQueue: [],
    rustLiveRenderRuntime: Object.freeze({ diagnostics: () => Object.freeze({ state: "ready" }) }),
    rustLiveRenderViewR10: requestedView,
    rustRenderSink: null,
    rustRenderWorldGeneration: null,
    rustRenderWorldEpoch: null,
    rustRenderExtractionRevision: 0,
    rustRenderFrameSequence: BigInt(0),
    rustRenderExtractionPoll: null,
    renderExtractionLastError: null,
    renderExtraction: null,
    rustLiveSelectedSlotIntentPendingR5: false,
    rustLiveSelectedSlotIntentR5: receipt.inventory.selectedSlot,
    disposed: false,
    multiplayer: options.multiplayerAuthorityMode
      ? Object.freeze({ authorityMode: options.multiplayerAuthorityMode })
      : null,
    selected: receipt.inventory.selectedSlot,
    mode: "survival",
    inventory,
    miningProgress: 0.5,
    target: Object.freeze({ ...receipt.position }),
    heldUse: 0,
    placeCooldown: 0,
    running: true,
    paused: false,
    keys: new Set<string>(),
    events: {
      onSelectedSlot: (slot: number) => {
        counters.selectedSlotCallbacks += 1;
        calls.push(`selected-slot:${slot}`);
      },
      onToast: (message: string) => { calls.push(`toast:${message}`); },
    },
    clearInput: () => { calls.push("input:clear"); },
    assertRustLivePlayerViewContextR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      purpose: string,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      calls.push(`context:${purpose}`);
    },
    runRustLivePumpNetworkExclusiveR5: async (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      purpose: string,
      operation: () => Promise<unknown>,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      calls.push(`network:${purpose}`);
      if (purpose === "native block-edit local-save retry") {
        retryNetworkStarted.resolve();
        if (options.retryNetworkGate) await options.retryNetworkGate;
      }
      return await operation();
    },
    enqueueRustLiveRendererExtractionR10: (entry: Readonly<{
      generation: number;
      host: HarnessHost;
      pump: HarnessPump;
      viewRevision: number;
      extraction: RustIntegratedRuntimeExtractionV1;
    }>) => {
      assert.deepEqual(entry, {
        generation: GENERATION,
        host,
        pump,
        viewRevision: requestedView.viewRevision,
        extraction,
      });
      counters.rendererEnqueues += 1;
      calls.push("renderer:enqueue");
      return true;
    },
    stageRustLivePlayerExtractionR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      checkedExtraction: RustIntegratedRuntimeExtractionV1,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.equal(checkedExtraction, extraction);
      calls.push("stage:player");
      return stagedPlayer;
    },
    stageRustLiveCameraExtractionR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      checkedExtraction: RustIntegratedRuntimeExtractionV1,
      checkedView: RustIntegratedRuntimeExtractionViewV1,
      checkedCamera: RustLiveCameraViewR10,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.equal(checkedExtraction, extraction);
      assert.equal(checkedView, requestedView);
      assert.equal(checkedCamera, pumpCamera);
      calls.push("stage:camera");
      return stagedCamera;
    },
    stageRustDroppedHotTransformsR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      checkedExtraction: RustIntegratedRuntimeExtractionV1,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.equal(checkedExtraction, extraction);
      calls.push("stage:drops");
      return stagedDrops;
    },
    rustTerrainLocatorStackMatches: (
      view: RustLivePlayerViewR10["held"],
      expected: RustIntegratedPlayerInventoryStackV1 | null,
    ) => {
      const priorCheck = calls.filter((call) => call.startsWith("validate:player-")).length === 0;
      calls.push(priorCheck ? "validate:player-before" : "validate:player-after");
      return prototypeStackMatches.call(engine, view, expected);
    },
    checkpointRustLivePlayerNativeWitness: async (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.deepEqual(privateEngine.rustNativeBlockEditProjection, {
        schema: 1,
        cursor: 0,
        lastReceiptHash: null,
      });
      assert.equal(privateEngine.rustNativeBlockEditCheckpoint, null);
      calls.push("checkpoint:start");
      checkpointStarted.resolve();
      if (options.checkpointGate) await options.checkpointGate;
      if (options.checkpointError) throw options.checkpointError;
      calls.push("checkpoint:end");
      return Object.freeze({
        identityBefore: queryIdentity,
        identityAfter: checkpointIdentity,
        persistenceBefore: Object.freeze({
          worldId: "world:world-native-block-edit@surface",
          state: "open" as const,
          saves: 10,
          recoveries: 0,
          legacyMigrations: 0,
          legacyMigrationRetries: 0,
          parentFallbacks: 0,
          platformOperations: 20,
          requestBytes: 100,
          responseBytes: 10,
          lastCheckpointId: "checkpoint-10",
          lastError: null,
        }),
        persistenceAfter: Object.freeze({
          worldId: "world:world-native-block-edit@surface",
          state: "open" as const,
          saves: 11,
          recoveries: 0,
          legacyMigrations: 0,
          legacyMigrationRetries: 0,
          parentFallbacks: 0,
          platformOperations: 21,
          requestBytes: 200,
          responseBytes: 20,
          lastCheckpointId: "checkpoint-11",
          lastError: null,
        }),
        checkpoint: Object.freeze({
          worldId: "world:world-native-block-edit@surface",
          saveId: "native.save.11",
          checkpointId: "checkpoint-11",
          checkpointHash: hash("e"),
          journalSequence: 11,
          records: 7,
          commits: 1,
          requestBytes: 100,
          responseBytes: 10,
        }),
      });
    },
    world: {
      getBlock(x: number, y: number, z: number) {
        assert.deepEqual({ x, y, z }, receipt.position);
        calls.push(worldReads++ === 0 ? "world:preflight" : "world:verify-noop");
        return cell;
      },
      blockFacingAt(x: number, y: number, z: number) {
        assert.deepEqual({ x, y, z }, receipt.position);
        return facing;
      },
      async applyValidatedRustWorldMutationProjectionR4V1(input: Readonly<{
        batchId: string;
        authorityIdentityBefore: Readonly<{
          address: Readonly<{ universeId: string; locationId: string }>;
          revision: Readonly<{ epoch: number; mutation: number; residency: number }>;
          stateHash: string;
        }>;
        authorityIdentityAfter: Readonly<{
          address: Readonly<{ universeId: string; locationId: string }>;
          revision: Readonly<{ epoch: number; mutation: number; residency: number }>;
          stateHash: string;
        }>;
        changes: readonly Readonly<{
          x: number;
          y: number;
          z: number;
          previousBlockId: BlockId;
          blockId: BlockId;
          previousFacing: BlockFacing;
          facing: BlockFacing;
        }>[];
        immediate: boolean;
        allowAlreadyApplied: boolean;
      }>) {
        counters.worldProjectionRequests += 1;
        calls.push("world:projection-start");
        worldProjectionStarted.resolve();
        assert.notEqual(privateEngine.rustNativeBlockEditCheckpoint, null,
          "checkpoint diagnostics must exist before awaited world projection");
        assert.equal(privateEngine.rustNativeBlockEditProjection.cursor, 0,
          "browser cursor must remain pending until every compatibility view is projected");
        assert.deepEqual(input, {
          batchId: `integrated-native-block-edit:${receipt.receiptHash}`,
          authorityIdentityBefore: {
            address: { universeId: queryIdentity.universeId, locationId: queryIdentity.locationId },
            revision: receipt.beforeWorldRevision,
            stateHash: receipt.beforeWorldHash,
          },
          authorityIdentityAfter: {
            address: { universeId: queryIdentity.universeId, locationId: queryIdentity.locationId },
            revision: receipt.afterWorldRevision,
            stateHash: receipt.afterWorldHash,
          },
          changes: [{
            ...receipt.position,
            previousBlockId: receipt.priorBlockId,
            blockId: receipt.replacementBlockId,
            previousFacing: receipt.priorFacing,
            facing: receipt.replacementFacing,
          }],
          immediate: true,
          allowAlreadyApplied: true,
        });
        if (options.worldProjectionGate) await options.worldProjectionGate;
        if (options.worldProjectionResult === "rejected") {
          calls.push("world:projection-rejected");
          return Object.freeze({
            schemaVersion: 1 as const,
            status: "rejected" as const,
            reason: "authority-rejected" as const,
            detail: "authority rejected the awaited projection",
            batchId: input.batchId,
            authorityEpoch: 1,
            authorityIdentityBefore: input.authorityIdentityBefore,
            authorityIdentityAfter: input.authorityIdentityAfter,
            compatibilityMutationRevisionBefore: 10,
            compatibilityMutationRevisionAfter: 10,
          });
        }
        const projectionStatus = options.worldProjectionResult ?? "applied";
        if (projectionStatus === "applied") {
          assert.equal(cell, receipt.priorBlockId);
          assert.equal(facing, receipt.priorFacing);
          cell = receipt.replacementBlockId as BlockId;
          facing = receipt.replacementFacing as BlockFacing;
          counters.worldStateWrites += 1;
        } else {
          assert.equal(cell, receipt.replacementBlockId);
          assert.equal(facing, receipt.replacementFacing);
        }
        calls.push(`world:projection-${projectionStatus}`);
        return Object.freeze({
          schemaVersion: 1 as const,
          status: "accepted" as const,
          mutated: true,
          projectionStatus,
          projectedChanges: input.changes,
          batchId: input.batchId,
          authorityEpoch: 1,
          authorityIdentityBefore: input.authorityIdentityBefore,
          authorityIdentityAfter: input.authorityIdentityAfter,
          compatibilityMutationRevisionBefore: 10,
          compatibilityMutationRevisionAfter: projectionStatus === "applied" ? 11 : 10,
        });
      },
      async applyValidatedRustWorldMutationProjectionR4V2(input: Readonly<{
        batchId: string;
        authorityIdentityBefore: Readonly<{
          address: Readonly<{ universeId: string; locationId: string }>;
          revision: Readonly<{ epoch: number; mutation: number; residency: number }>;
          stateHash: string;
        }>;
        authorityIdentityAfter: Readonly<{
          address: Readonly<{ universeId: string; locationId: string }>;
          revision: Readonly<{ epoch: number; mutation: number; residency: number }>;
          stateHash: string;
        }>;
        changes: readonly Readonly<{
          x: number;
          y: number;
          z: number;
          previousBlockId: BlockId;
          blockId: BlockId;
          previousFacing: BlockFacing;
          facing: BlockFacing;
        }>[];
        immediate: boolean;
        allowAlreadyApplied: boolean;
        dirty: RustIntegratedRuntimeNativeBlockEditDirtyEvidenceV2;
      }>) {
        counters.worldProjectionV2Requests += 1;
        const { dirty, ...legacyInput } = input;
        assert.equal(dirty, editDelivery.dirty,
          "the engine must deliver the exact Rust-authored dirty evidence to the world seam");
        return this.applyValidatedRustWorldMutationProjectionR4V1(legacyInput);
      },
    },
    spawnDrop: (
      item: number,
      count: number,
      position: THREE.Vector3,
      _minimumCount?: number,
      _maximumCount?: number,
      dropOptions?: DropSpawnOptions,
    ) => {
      const drop = receipt.generatedDrops[0];
      assert.ok(drop);
      const expected = rustIntegratedRuntimeBasicDirtExpectedDropTransformV1(drop.provenance);
      assert.equal(item, BlockId.Cobblestone);
      assert.equal(count, 1);
      assert.deepEqual(position.toArray(), [
        Number(expected.position.xMilli) / 1_000,
        Number(expected.position.yMilli) / 1_000,
        Number(expected.position.zMilli) / 1_000,
      ]);
      assert.deepEqual(dropOptions, {
        allowMerge: false,
        exactPosition: true,
        rustEntityId: DROP_ENTITY_ID.toString(10),
        rotationY: expected.rotation.yaw / 1_000_000 * Math.PI * 2,
        velocity: {
          x: Number(expected.velocityMilliPerSecond.xMilli) / 1_000,
          y: Number(expected.velocityMilliPerSecond.yMilli) / 1_000,
          z: Number(expected.velocityMilliPerSecond.zMilli) / 1_000,
        },
        pickupDelay: 0.35,
        exactIdempotentRecovery: true,
      });
      counters.drops += 1;
      calls.push("drop:project");
      const mesh = new THREE.Object3D();
      mesh.position.copy(position);
      mesh.rotation.y = dropOptions.rotationY ?? 0;
      const projected = {
        rustEntityId: DROP_ENTITY_ID.toString(10), item, count,
        id: 1,
        mesh,
        velocity: new THREE.Vector3(
          dropOptions.velocity?.x ?? 0,
          dropOptions.velocity?.y ?? 0,
          dropOptions.velocity?.z ?? 0,
        ),
        age: 0,
        pickupDelay: dropOptions.pickupDelay ?? 0.35,
      };
      (engine as unknown as { drops: unknown[] }).drops.push(projected);
      return projected;
    },
    commitStagedRustLiveAuthorityViewsR10: (
      checkedGeneration: number,
      checkedHost: HarnessHost,
      checkedPump: HarnessPump,
      checkedPlayer: RustLivePlayerViewR10,
      checkedCamera: RustLiveCameraViewR10,
      checkedDrops: unknown,
    ) => {
      assert.equal(checkedGeneration, GENERATION);
      assert.equal(checkedHost, host);
      assert.equal(checkedPump, pump);
      assert.equal(checkedPlayer, stagedPlayer);
      assert.equal(checkedCamera, stagedCamera);
      assert.equal(checkedDrops, stagedDrops);
      counters.playerCameraCommits += 1;
      calls.push("player-camera:commit");
      Object.assign(engine, {
        rustLivePlayerPresentationViewR10: stagedPlayer,
        rustLiveCameraPresentationViewR10: stagedCamera,
        rustDroppedHotTransformFrameR10: stagedDrops,
      });
      return Object.freeze({ player: stagedPlayer, camera: stagedCamera, dropped: stagedDrops });
    },
    saveRustCompatibilityDocumentLocalOnly: (requirement: string) => {
      assert.equal(requirement, "a native block-edit projection");
      counters.localSaves += 1;
      calls.push("local:save");
      savedCursors.push(privateEngine.rustNativeBlockEditProjection);
      const error = options.localSaveErrors?.[counters.localSaves - 1] ?? options.localSaveError;
      return error
        ? Object.freeze({ ok: false as const, error })
        : Object.freeze({ ok: true as const, value: Object.freeze({ worldId: "world-native-block-edit" }) });
    },
    audio: { play: (name: string) => { calls.push(`audio:${name}`); } },
    spawnParticles: () => { calls.push("particles:spawn"); },
    emitHud: (forced: boolean) => {
      assert.equal(forced, true);
      calls.push("hud:emit");
    },
  });

  const input: CommitInput = Object.freeze({
    generation: GENERATION,
    host,
    pump,
    delivery: editDelivery,
    extraction,
    requestedView,
    camera: pumpCamera,
  });
  const commit = () => (engine as unknown as CommitAccess)
    .commitRustNativeBlockEditProjectionV1(input);
  const retry = () => (engine as unknown as CommitAccess).retryRustNativeBlockEditFinalizeV1();

  return {
    calls,
    counters,
    inventory,
    receipt,
    delivery: editDelivery,
    acknowledgements,
    savedCursors,
    checkpointStarted: checkpointStarted.promise,
    worldProjectionStarted: worldProjectionStarted.promise,
    retryNetworkStarted: retryNetworkStarted.promise,
    currentCell: () => Object.freeze({ block: cell, facing }),
    cursor: () => privateEngine.rustNativeBlockEditProjection,
    checkpointWitness: () => privateEngine.rustNativeBlockEditCheckpoint,
    commitLocked: () => privateEngine.rustTerrainLocatorCommitLocked,
    pendingFinalize: () => privateEngine.rustNativeBlockEditPendingFinalize,
    queuedSelectedSlot: () => privateEngine.rustNativeBlockEditQueuedSelectedSlotR5,
    selectedState: () => Object.freeze({
      selected: (engine as unknown as { selected: number }).selected,
      intent: privateEngine.rustLiveSelectedSlotIntentR5,
      pending: privateEngine.rustLiveSelectedSlotIntentPendingR5,
    }),
    pumpDiagnostics: () => pump.diagnostics(),
    finalizeDiagnostics: () => engine.getRustRuntimeDiagnostics().playerAuthority.nativeBlockEditFinalize,
    authorityState: () => Object.freeze({
      operations: privateEngine.rustAuthorityOperations.size,
      inputAdvance: privateEngine.rustLiveInputAdvance,
      playerState: privateEngine.rustLivePlayerAuthorityState,
      lastError: privateEngine.rustLivePlayerAuthorityLastError,
      blocked: privateEngine.rustRuntimeOperationsBlocked,
      running: (engine as unknown as { running: boolean }).running,
      paused: (engine as unknown as { paused: boolean }).paused,
    }),
    acknowledgeAgain: () => pump.acknowledgeNativeBlockEdit(GENERATION, editDelivery),
    queueSelectedSlot: (slot: number) => (engine as unknown as CommitAccess).selectSlotFromPlayerInput(slot),
    schedule: () => (engine as unknown as CommitAccess).scheduleRustLiveInputAdvanceR5(),
    drain: () => (engine as unknown as CommitAccess).drainRustAuthorityOperations(),
    settleLifecycle: (stage: string) => (engine as unknown as CommitAccess)
      .settleRustAuthorityForLifecycleV1(stage),
    makeRetryReady: () => {
      const pending = privateEngine.rustNativeBlockEditPendingFinalize;
      assert.ok(pending && typeof pending === "object");
      privateEngine.rustNativeBlockEditPendingFinalize = Object.freeze({ ...pending, retryNotBefore: 0 });
    },
    retry,
    tamper: (kind: TamperKind) => {
      type MutableDrop = {
        id: number;
        rustEntityId: string;
        item: number;
        count: number;
        durability?: number;
        metadata?: Record<string, unknown>;
        mesh: THREE.Object3D;
        velocity: THREE.Vector3;
        age: number;
        pickupDelay: number;
      };
      const drops = (engine as unknown as { drops: MutableDrop[] }).drops;
      const drop = () => {
        const current = drops[0];
        assert.ok(current, `${kind} requires one projected native drop`);
        return current;
      };
      if (kind === "generation") Object.assign(engine, { rustRuntimeTransitionGeneration: GENERATION + 1 });
      if (kind === "authority-generation") Object.assign(engine, { rustLivePlayerAuthorityGeneration: GENERATION + 1 });
      if (kind === "cursor") privateEngine.rustNativeBlockEditProjection = Object.freeze({ schema: 1, cursor: 99, lastReceiptHash: hash("0") });
      if (kind === "inventory") rawInventory[0] = { item: BlockId.Dirt, count: 1 };
      if (kind === "world") cell = BlockId.Dirt;
      if (kind === "facing") facing = 3;
      if (kind === "checkpoint") privateEngine.rustNativeBlockEditCheckpoint = Object.freeze({ drifted: true });
      if (kind === "selected") Object.assign(engine, { selected: 3 });
      if (kind === "mode") Object.assign(engine, { mode: "builder" });
      if (kind === "active-world") Object.assign(engine, { activeWorldId: "another-world" });
      if (kind === "persistent") Object.assign(engine, { persistent: false });
      if (kind === "save-suppression") Object.assign(engine, { rustNativeSaveSuppressedForMultiplayerRuntime: true });
      if (kind === "multiplayer-authority") Object.assign(engine, { multiplayer: Object.freeze({ authorityMode: "rust-authoritative" }) });
      if (kind === "pump-state") pumpState = "failed";
      if (kind === "pump-protocol") pumpDiagnostics = { ...pumpDiagnostics, nativeBlockEditProtocolVersion: protocolVersion === 1 ? 2 : 1 };
      if (kind === "pump-cursor") pumpDiagnostics = { ...pumpDiagnostics, nativeBlockEditCursor: 99 };
      if (kind === "pump-sequence") pumpDiagnostics = { ...pumpDiagnostics, pendingNativeBlockEditSequence: 99 };
      if (kind === "pump-metadata") pumpDiagnostics = { ...pumpDiagnostics, pendingNativeBlockEditReceiptHash: hash("0") };
      if (kind === "pump-identity") pumpDiagnostics = { ...pumpDiagnostics, pendingNativeBlockEditIdentityHash: hash("0") };
      if (kind === "pump-dirty") pumpDiagnostics = { ...pumpDiagnostics, pendingNativeBlockEditDirtyEvidenceHash: hash("0") };
      if (kind === "pump-fallback") pumpDiagnostics = { ...pumpDiagnostics, pendingNativeBlockEditLegacyFallback: "v1-capability" };
      if (kind === "pump-last-sequence") pumpDiagnostics = { ...pumpDiagnostics, lastAcknowledgedNativeBlockEditSequence: receipt.sequence };
      if (kind === "pump-last-hash") pumpDiagnostics = { ...pumpDiagnostics, lastAcknowledgedNativeBlockEditReceiptHash: receipt.receiptHash };
      if (kind === "player-view") Object.assign(engine, { rustLivePlayerPresentationViewR10: Object.freeze({ drifted: true }) });
      if (kind === "camera-view") Object.assign(engine, { rustLiveCameraPresentationViewR10: Object.freeze({ drifted: true }) });
      if (kind === "drop-view") Object.assign(engine, { rustDroppedHotTransformFrameR10: Object.freeze({ drifted: true }) });
      if (kind === "extra-drop") drops.push({
        id: 99, rustEntityId: "99", item: BlockId.Dirt, count: 1,
        mesh: new THREE.Object3D(), velocity: new THREE.Vector3(), age: 0, pickupDelay: 0.35,
      });
      if (kind === "drop-remove") drops.pop();
      if (kind === "drop-duplicate") {
        const current = drop();
        const mesh = current.mesh.clone();
        drops.push({ ...current, id: current.id + 1, mesh, velocity: current.velocity.clone() });
      }
      if (kind === "drop-transform") drop().mesh.position.x += 0.25;
      if (kind === "drop-rotation") drop().mesh.rotation.y += 0.25;
      if (kind === "drop-velocity") drop().velocity.z += 0.25;
      if (kind === "drop-age") drop().age += 1;
      if (kind === "drop-pickup-delay") drop().pickupDelay += 0.1;
      if (kind === "drop-item") drop().item = BlockId.Dirt;
      if (kind === "drop-count") drop().count += 1;
      if (kind === "drop-durability") drop().durability = 0.5;
      if (kind === "drop-metadata") drop().metadata = { custody: "drifted" };
    },
    commit,
  };
}

for (const scenario of [
  { kind: "place-directional" as const, worldCall: "world:projection-applied", drop: false },
  { kind: "mine-generated-drop" as const, worldCall: "world:projection-applied", drop: true },
]) {
  test(`generic ${scenario.kind} checkpoints before exact world, inventory, save, and acknowledgement custody`, async () => {
    const checkpointGate = deferred();
    const harness = createHarness({ kind: scenario.kind, checkpointGate: checkpointGate.promise });
    const pending = harness.commit();
    await harness.checkpointStarted;

    assert.deepEqual(harness.calls, [
      "context:native block-edit projection preflight",
      "stage:player",
      "stage:camera",
      "stage:drops",
      "validate:player-before",
      "validate:player-after",
      "world:preflight",
      "authority:enter",
      "context:native block-edit checkpoint",
      "checkpoint:start",
    ]);
    assert.equal(harness.counters.worldProjectionRequests, 0);
    assert.equal(harness.counters.inventoryMutations, 0);
    assert.equal(harness.counters.drops, 0);
    assert.equal(harness.counters.playerCameraCommits, 0);
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);
    assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
    assert.equal(harness.checkpointWitness(), null);

    checkpointGate.resolve();
    await pending;

    const actionEffects = scenario.kind === "place-directional"
      ? ["audio:place", "hud:emit"]
      : ["audio:break", "particles:spawn", "hud:emit"];
    assert.deepEqual(harness.calls, [
      "context:native block-edit projection preflight",
      "stage:player",
      "stage:camera",
      "stage:drops",
      "validate:player-before",
      "validate:player-after",
      "world:preflight",
      "authority:enter",
      "context:native block-edit checkpoint",
      "checkpoint:start",
      "checkpoint:end",
      "context:native block-edit compatibility commit",
      "world:projection-start",
      scenario.worldCall,
      "inventory:project",
      ...(scenario.drop ? ["drop:project"] : []),
      "player-camera:commit",
      "world:verify-noop",
      "local:save",
      "pump:ack",
      ...actionEffects,
      "authority:exit",
    ]);
    assert.deepEqual(harness.currentCell(), {
      block: harness.receipt.replacementBlockId,
      facing: harness.receipt.replacementFacing,
    });
    assert.deepEqual(harness.inventory[0], compatibilitySlot(harness.receipt.inventory.afterStack));
    assert.equal(harness.counters.worldProjectionRequests, 1);
    assert.equal(harness.counters.worldStateWrites, 1);
    assert.equal(harness.counters.inventoryMutations, 1);
    assert.equal(harness.counters.drops, scenario.drop ? 1 : 0);
    assert.equal(harness.counters.playerCameraCommits, 1);
    assert.deepEqual(harness.savedCursors, [{
      schema: 1,
      cursor: harness.receipt.sequence,
      lastReceiptHash: harness.receipt.receiptHash,
    }]);
    assert.equal(harness.acknowledgements[0], harness.delivery);
    assert.deepEqual(harness.checkpointWitness(), {
      schema: 1,
      protocolVersion: harness.delivery.protocolVersion,
      legacyFallback: harness.delivery.legacyFallback,
      cursorBefore: 0,
      cursorAfter: harness.receipt.sequence,
      receiptHash: harness.receipt.receiptHash,
      queryIdentityHash: harness.delivery.queryIdentity.stateHash,
      action: harness.receipt.action,
      cell: {
        ...harness.receipt.position,
        previousBlockId: harness.receipt.priorBlockId,
        blockId: harness.receipt.replacementBlockId,
        previousFacing: harness.receipt.priorFacing,
        facing: harness.receipt.replacementFacing,
        mutated: true,
      },
      identityBefore: harness.delivery.queryIdentity,
      dirty: harness.delivery.dirty,
      identityAfter: {
        ...harness.delivery.queryIdentity,
        revision: { ...harness.delivery.queryIdentity.revision, persistence: 6 },
        stateHash: hash("b"),
      },
      persistenceBefore: {
        worldId: "world:world-native-block-edit@surface", state: "open", saves: 10,
        recoveries: 0, legacyMigrations: 0, legacyMigrationRetries: 0, parentFallbacks: 0,
        platformOperations: 20, requestBytes: 100, responseBytes: 10,
        lastCheckpointId: "checkpoint-10", lastError: null,
      },
      persistenceAfter: {
        worldId: "world:world-native-block-edit@surface", state: "open", saves: 11,
        recoveries: 0, legacyMigrations: 0, legacyMigrationRetries: 0, parentFallbacks: 0,
        platformOperations: 21, requestBytes: 200, responseBytes: 20,
        lastCheckpointId: "checkpoint-11", lastError: null,
      },
      checkpoint: {
        worldId: "world:world-native-block-edit@surface", saveId: "native.save.11",
        checkpointId: "checkpoint-11", checkpointHash: hash("e"), journalSequence: 11,
        records: 7, commits: 1, requestBytes: 100, responseBytes: 10,
      },
    });
    assert.ok(harness.calls.indexOf("world:projection-start") < harness.calls.indexOf("inventory:project"));
    assert.ok(harness.calls.indexOf("player-camera:commit") < harness.calls.indexOf("local:save"));
    assert.ok(harness.calls.indexOf("local:save") < harness.calls.indexOf("pump:ack"));
    assert.equal(harness.commitLocked(), false);
  });
}

test("content-owned no-op harvest checkpoints and advances custody without inventing a world mutation", async () => {
  const harness = createHarness({ kind: "mine-content-noop" });
  await harness.commit();

  assert.equal(harness.delivery.protocolVersion, 2);
  assert.equal(harness.delivery.legacyFallback, null);
  assert.deepEqual(harness.delivery.dirty?.sections, []);
  assert.deepEqual(harness.delivery.dirty?.columns, []);
  assert.deepEqual(harness.delivery.dirty?.subsystemSeeds, []);
  assert.equal(harness.counters.worldProjectionRequests, 0);
  assert.equal(harness.counters.worldStateWrites, 0);
  assert.deepEqual(harness.currentCell(), { block: BlockId.Stone, facing: 0 });
  assert.deepEqual(harness.inventory[0], null);
  assert.equal(harness.counters.inventoryMutations, 1);
  assert.equal(harness.counters.drops, 0);
  assert.equal(harness.counters.playerCameraCommits, 1);
  assert.equal(harness.acknowledgements.length, 1);
  assert.deepEqual(harness.savedCursors, [{
    schema: 1,
    cursor: harness.receipt.sequence,
    lastReceiptHash: harness.receipt.receiptHash,
  }]);
  assert.ok(harness.calls.indexOf("checkpoint:end") < harness.calls.indexOf("world:verify-noop"));
  assert.ok(harness.calls.indexOf("world:verify-noop") < harness.calls.indexOf("inventory:project"));
  assert.ok(harness.calls.indexOf("local:save") < harness.calls.indexOf("pump:ack"));
  assert.deepEqual(harness.checkpointWitness(), {
    ...(harness.checkpointWitness() as object),
    action: "mine",
    cell: {
      ...harness.receipt.position,
      previousBlockId: BlockId.Stone,
      blockId: BlockId.Stone,
      previousFacing: 0,
      facing: 0,
      mutated: false,
    },
  });
});

test("explicit V1 capability fallback keeps the legacy world projection seam", async () => {
  const harness = createHarness({ kind: "place-directional", protocolVersion: 1 });
  await harness.commit();

  assert.equal(harness.delivery.legacyFallback, "v1-capability");
  assert.equal(harness.delivery.dirty, null);
  assert.equal(harness.counters.worldProjectionRequests, 1);
  assert.equal(harness.counters.worldProjectionV2Requests, 0);
  assert.deepEqual(harness.checkpointWitness(), {
    ...(harness.checkpointWitness() as object),
    protocolVersion: 1,
    legacyFallback: "v1-capability",
    dirty: null,
  });
  assert.equal(harness.acknowledgements[0], harness.delivery);
});

test("native checkpoint failure leaves every browser view, cursor, and acknowledgement untouched", async () => {
  const harness = createHarness({
    kind: "mine-generated-drop",
    checkpointError: new Error("checkpoint failed"),
  });
  await assert.rejects(harness.commit(), /checkpoint failed/u);

  assert.equal(harness.counters.worldProjectionRequests, 0);
  assert.equal(harness.counters.worldStateWrites, 0);
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.drops, 0);
  assert.equal(harness.counters.playerCameraCommits, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.deepEqual(harness.currentCell(), { block: BlockId.Stone, facing: 0 });
  assert.deepEqual(harness.inventory[0], null);
  assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.equal(harness.checkpointWitness(), null);
  assert.equal(harness.commitLocked(), false);
});

for (const mismatch of [
  { label: "block", currentBlock: BlockId.Dirt },
  { label: "facing", currentFacing: 1 as BlockFacing },
]) {
  test(`compatibility world ${mismatch.label} mismatch rejects before checkpoint`, async () => {
    const harness = createHarness({ kind: "place-directional", ...mismatch });
    await assert.rejects(harness.commit(), /contradicts the compatibility world cell or facing/u);

    assert.equal(harness.calls.includes("world:preflight"), true);
    assert.equal(harness.calls.includes("authority:enter"), false);
    assert.equal(harness.calls.includes("checkpoint:start"), false);
    assert.equal(harness.counters.worldProjectionRequests, 0);
    assert.equal(harness.counters.inventoryMutations, 0);
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);
    assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
  });
}

test("awaited world rejection never advances inventory, browser cursor, local save, or pump acknowledgement", async () => {
  const worldGate = deferred();
  const harness = createHarness({
    kind: "mine-generated-drop",
    worldProjectionGate: worldGate.promise,
    worldProjectionResult: "rejected",
  });
  const pending = harness.commit();
  await harness.worldProjectionStarted;

  assert.equal(harness.counters.worldProjectionRequests, 1);
  assert.equal(harness.counters.worldStateWrites, 0);
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.drops, 0);
  assert.equal(harness.counters.playerCameraCommits, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });

  worldGate.resolve();
  await assert.rejects(pending, /world projection was rejected.*authority rejected/u);
  assert.equal(harness.counters.worldStateWrites, 0);
  assert.equal(harness.counters.inventoryMutations, 0);
  assert.equal(harness.counters.drops, 0);
  assert.equal(harness.counters.localSaves, 0);
  assert.equal(harness.acknowledgements.length, 0);
  assert.deepEqual(harness.currentCell(), { block: BlockId.Stone, facing: 0 });
  assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
  assert.notEqual(harness.checkpointWitness(), null,
    "the durable native checkpoint remains witnessed even when browser projection is rejected");
  assert.equal(harness.commitLocked(), false);
});

test("failed local cursor save retains the exact successor and retry saves then acknowledges without replay", async () => {
  const harness = createHarness({
    kind: "mine-generated-drop",
    localSaveErrors: [new Error("disk full")],
  });
  await harness.commit();

  assert.equal(harness.counters.worldProjectionRequests, 1);
  assert.equal(harness.counters.worldStateWrites, 1);
  assert.equal(harness.counters.inventoryMutations, 1);
  assert.equal(harness.counters.drops, 1);
  assert.equal(harness.counters.playerCameraCommits, 1);
  assert.equal(harness.counters.localSaves, 1);
  assert.deepEqual(harness.savedCursors, [{
    schema: 1,
    cursor: harness.receipt.sequence,
    lastReceiptHash: harness.receipt.receiptHash,
  }]);
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.calls.includes("pump:ack"), false);
  assert.equal(harness.counters.rendererEnqueues, 0);
  assert.deepEqual(harness.calls.filter((call) => call.startsWith("audio:")
    || call === "particles:spawn" || call === "hud:emit"), []);
  assert.deepEqual(harness.pumpDiagnostics(), {
    ...harness.pumpDiagnostics(),
    nativeBlockEditCursor: harness.delivery.cursorBefore,
    pendingNativeBlockEditSequence: harness.receipt.sequence,
    pendingNativeBlockEditReceiptHash: harness.receipt.receiptHash,
    lastAcknowledgedNativeBlockEditSequence: null,
    lastAcknowledgedNativeBlockEditReceiptHash: null,
  });
  assert.notEqual(harness.checkpointWitness(), null);
  assert.equal(harness.commitLocked(), true);
  assert.deepEqual(harness.pendingFinalize(), {
    ...(harness.pendingFinalize() as object),
    state: "awaiting-local-save",
    attempts: 1,
    lastError: "disk full",
  });

  await harness.retry();
  assert.equal(harness.counters.worldProjectionRequests, 1);
  assert.equal(harness.counters.worldStateWrites, 1);
  assert.equal(harness.counters.inventoryMutations, 1);
  assert.equal(harness.counters.drops, 1);
  assert.equal(harness.counters.playerCameraCommits, 1);
  assert.equal(harness.counters.localSaves, 2);
  assert.equal(harness.acknowledgements.length, 1);
  assert.equal(harness.counters.rendererEnqueues, 1);
  assert.deepEqual(harness.calls.filter((call) => call.startsWith("audio:")
    || call === "particles:spawn" || call === "hud:emit"), [
    "audio:break", "particles:spawn", "hud:emit",
  ]);
  assert.ok(harness.calls.lastIndexOf("local:save") < harness.calls.indexOf("pump:ack"));
  assert.ok(harness.calls.indexOf("pump:ack") < harness.calls.indexOf("renderer:enqueue"));
  assert.ok(harness.calls.indexOf("renderer:enqueue") < harness.calls.indexOf("audio:break"));
  assert.deepEqual(harness.pumpDiagnostics(), {
    ...harness.pumpDiagnostics(),
    nativeBlockEditCursor: harness.delivery.cursorAfter,
    pendingNativeBlockEditSequence: null,
    pendingNativeBlockEditReceiptHash: null,
    pendingNativeBlockEditIdentityHash: null,
    pendingNativeBlockEditDirtyEvidenceHash: null,
    pendingNativeBlockEditLegacyFallback: null,
    lastAcknowledgedNativeBlockEditSequence: harness.receipt.sequence,
    lastAcknowledgedNativeBlockEditReceiptHash: harness.receipt.receiptHash,
  });
  assert.equal(harness.pendingFinalize(), null);
  assert.equal(harness.commitLocked(), false);
  assert.equal(harness.acknowledgeAgain(), false,
    "only an identical post-transition duplicate follows the real pump false-return path");
  await assert.rejects(harness.retry(), /No native block-edit local save is awaiting retry/u);
  assert.equal(harness.counters.rendererEnqueues, 1);
  assert.equal(harness.acknowledgements.length, 1);
  assert.deepEqual(harness.calls.filter((call) => call.startsWith("audio:")
    || call === "particles:spawn" || call === "hud:emit"), [
    "audio:break", "particles:spawn", "hud:emit",
  ]);
});

test("repeated local save failures retain one immutable pending finalize until the same successor saves", async () => {
  const harness = createHarness({ localSaveErrors: [new Error("full-1"), new Error("full-2")] });
  await harness.commit();
  const first = harness.pendingFinalize();
  await harness.retry();
  const second = harness.pendingFinalize();
  assert.notEqual(first, second);
  assert.deepEqual(second, { ...(second as object), state: "awaiting-local-save", attempts: 2, lastError: "full-2" });
  assert.equal(harness.counters.worldProjectionRequests, 1);
  assert.equal(harness.counters.inventoryMutations, 1);
  assert.equal(harness.counters.localSaves, 2);
  assert.equal(harness.acknowledgements.length, 0);
  await harness.retry();
  assert.equal(harness.counters.localSaves, 3);
  assert.equal(harness.acknowledgements.length, 1);
});

test("physical hotbar input queues during pending finalize and applies exactly once after save and acknowledgement", async () => {
  const harness = createHarness({
    kind: "place-directional",
    localSaveErrors: [new Error("temporary")],
  });
  await harness.commit();

  harness.queueSelectedSlot(3);
  harness.queueSelectedSlot(6);
  assert.equal(harness.queuedSelectedSlot(), 6, "latest physical selection must win the bounded queue");
  assert.deepEqual(harness.selectedState(), { selected: 0, intent: 0, pending: false });
  const pendingDiagnostic = harness.finalizeDiagnostics();
  assert.deepEqual(pendingDiagnostic, {
    schema: 1,
    state: "awaiting-local-save",
    attempts: 1,
    lastError: "temporary",
    protocolVersion: harness.delivery.protocolVersion,
    legacyFallback: harness.delivery.legacyFallback,
    cursorBefore: harness.delivery.cursorBefore,
    cursorAfter: harness.delivery.cursorAfter,
    receiptHash: harness.receipt.receiptHash,
    pendingSelectedSlot: 6,
  });
  assert.equal(Object.isFrozen(pendingDiagnostic), true);
  assert.equal(harness.counters.selectedSlotCallbacks, 0);
  assert.deepEqual(harness.calls.filter((call) => call.startsWith("audio:")
    || call === "particles:spawn" || call === "hud:emit" || call.startsWith("selected-slot:")), []);

  await harness.retry();
  assert.equal(harness.queuedSelectedSlot(), null);
  assert.equal(harness.finalizeDiagnostics(), null);
  assert.deepEqual(harness.selectedState(), { selected: 6, intent: 6, pending: true });
  assert.equal(harness.counters.selectedSlotCallbacks, 1);
  assert.equal(harness.calls.filter((call) => call === "selected-slot:6").length, 1);
  assert.equal(harness.calls.filter((call) => call === "audio:place").length, 1);
  assert.equal(harness.calls.filter((call) => call === "hud:emit").length, 1,
    "the released hotbar input and finalized block edit share one post-ack HUD refresh");
  assert.equal(harness.counters.rendererEnqueues, 1);
  assert.equal(harness.acknowledgements.length, 1);
});

test("React hotbar pointer and touch activation uses the queued player-input boundary", async () => {
  const source = await readFile(new URL("../app/game/VoxelGame.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=\{\(\) => engineRef\.current\?\.selectSlotFromPlayerInput\(index\)\}/u);
  assert.doesNotMatch(source, /onClick=\{\(\) => engineRef\.current\?\.selectSlot\(index\)\}/u);
});

test("Save & Quit authority settlement tracks and awaits the pending finalize retry", async () => {
  const retryGate = deferred();
  const harness = createHarness({
    kind: "mine-generated-drop",
    localSaveErrors: [new Error("temporary")],
    retryNetworkGate: retryGate.promise,
  });
  await harness.commit();
  harness.makeRetryReady();

  const settlement = harness.settleLifecycle("Save & Quit");
  await harness.retryNetworkStarted;
  let drained = false;
  const drain = harness.drain().then(() => { drained = true; });
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  assert.equal(drained, false, "the authority drain must retain the in-flight finalize retry");
  assert.equal(harness.counters.localSaves, 1);
  assert.equal(harness.acknowledgements.length, 0);
  assert.equal(harness.pendingFinalize() !== null, true);
  assert.deepEqual(harness.calls.filter((call) => call.startsWith("audio:")
    || call === "particles:spawn" || call === "hud:emit"), []);

  retryGate.resolve();
  await settlement;
  await drain;
  assert.equal(drained, true);
  assert.equal(harness.counters.localSaves, 2);
  assert.equal(harness.acknowledgements.length, 1);
  assert.equal(harness.pendingFinalize(), null);
  assert.equal(harness.commitLocked(), false);
  assert.equal(harness.counters.rendererEnqueues, 1);
});

test("lifecycle settlement fails closed when the pending local save still cannot commit", async () => {
  const harness = createHarness({
    kind: "mine-generated-drop",
    localSaveErrors: [new Error("offline-1"), new Error("offline-2")],
  });
  await harness.commit();
  harness.makeRetryReady();
  await assert.rejects(
    harness.settleLifecycle("Engine shutdown"),
    /could not make the pending native block-edit projection durable: offline-2/u,
  );
  await harness.drain();

  assert.equal(harness.counters.localSaves, 2);
  assert.equal(harness.acknowledgements.length, 0);
  assert.notEqual(harness.pendingFinalize(), null);
  assert.equal(harness.commitLocked(), true);
  assert.equal(harness.counters.rendererEnqueues, 0);
  assert.deepEqual(harness.calls.filter((call) => call.startsWith("audio:")
    || call === "particles:spawn" || call === "hud:emit"), []);
  assert.deepEqual(harness.authorityState(), {
    ...harness.authorityState(),
    operations: 0,
    playerState: "ready",
    lastError: null,
    blocked: false,
    running: true,
    paused: false,
  });
});

test("scheduled retry remains throttled and nonfatal when local storage is still unavailable", async () => {
  const harness = createHarness({
    localSaveErrors: [new Error("offline-1"), new Error("offline-2")],
  });
  await harness.commit();
  harness.schedule();
  assert.equal(harness.counters.localSaves, 1, "retryNotBefore must suppress an eager frame retry");

  harness.makeRetryReady();
  harness.schedule();
  await harness.drain();
  assert.equal(harness.counters.localSaves, 2);
  assert.deepEqual(harness.pendingFinalize(), {
    ...(harness.pendingFinalize() as object),
    attempts: 2,
    lastError: "offline-2",
  });
  assert.deepEqual(harness.authorityState(), {
    ...harness.authorityState(),
    operations: 0,
    playerState: "ready",
    lastError: null,
    blocked: false,
    running: true,
    paused: false,
  });
  assert.equal(harness.counters.pumpStops, 0);
  assert.equal(harness.counters.rendererEnqueues, 0);
  assert.equal(harness.acknowledgements.length, 0);
  harness.schedule();
  assert.equal(harness.counters.localSaves, 2, "the renewed throttle must suppress the next frame");
});

test("scheduled retry quarantines the live authority on exact-successor drift", async () => {
  const harness = createHarness({ localSaveErrors: [new Error("offline")] });
  await harness.commit();
  harness.makeRetryReady();
  harness.tamper("active-world");
  harness.schedule();
  await harness.drain();

  assert.deepEqual(harness.authorityState(), {
    ...harness.authorityState(),
    operations: 0,
    playerState: "blocked",
    blocked: true,
    running: false,
    paused: true,
  });
  assert.match(harness.authorityState().lastError ?? "", /pending finalize no longer matches/u);
  assert.equal(harness.calls.includes("input:clear"), true);
  assert.equal(harness.counters.pumpStops, 1);
  assert.equal(harness.counters.localSaves, 1);
  assert.equal(harness.acknowledgements.length, 0);
  assert.notEqual(harness.pendingFinalize(), null);
  assert.equal(harness.commitLocked(), true);
});

async function assertPendingFinalizeTamperRejected(tamper: TamperKind, kind: ReceiptKind) {
  const harness = createHarness({ kind, localSaveErrors: [new Error("offline")] });
  await harness.commit();
  harness.tamper(tamper);
  await assert.rejects(
    harness.retry(),
    /pending finalize (?:no longer matches|lost its exact)/u,
    `${tamper} drift must reject before the second local save`,
  );
  assert.equal(harness.counters.worldProjectionRequests, 1, `${tamper}: world projection replayed`);
  assert.equal(harness.counters.inventoryMutations, 1, `${tamper}: inventory projection replayed`);
  assert.equal(harness.counters.playerCameraCommits, 1, `${tamper}: authority view replayed`);
  assert.equal(harness.counters.localSaves, 1, `${tamper}: local save ran after drift`);
  assert.equal(harness.counters.rendererEnqueues, 0, `${tamper}: renderer ran before finalize`);
  assert.equal(harness.acknowledgements.length, 0, `${tamper}: receipt was acknowledged after drift`);
  assert.deepEqual(harness.calls.filter((call) => call.startsWith("audio:")
    || call === "particles:spawn" || call === "hud:emit"), [], `${tamper}: presentation escaped`);
  assert.notEqual(harness.pendingFinalize(), null);
  assert.equal(harness.commitLocked(), true);
}

test("pending finalize rejects complete projected-successor and lifecycle drift", async () => {
  for (const tamper of [
    "generation", "authority-generation", "cursor", "inventory", "world", "facing", "checkpoint",
    "player-view", "camera-view", "drop-view", "selected", "mode", "active-world", "persistent",
    "save-suppression", "multiplayer-authority", "pump-state",
  ] as const) await assertPendingFinalizeTamperRejected(tamper, "place-directional");
});

test("pending finalize rejects every pump custody diagnostic drift", async () => {
  for (const tamper of [
    "pump-protocol", "pump-cursor", "pump-sequence", "pump-metadata", "pump-identity", "pump-dirty",
    "pump-fallback", "pump-last-sequence", "pump-last-hash",
  ] as const) await assertPendingFinalizeTamperRejected(tamper, "place-directional");
});

test("pending finalize rejects the complete native-drop set and serialized field drift", async () => {
  for (const tamper of [
    "drop-remove", "drop-duplicate", "drop-transform", "drop-rotation", "drop-velocity", "drop-age",
    "drop-pickup-delay", "drop-item", "drop-count", "drop-durability", "drop-metadata", "extra-drop",
  ] as const) await assertPendingFinalizeTamperRejected(tamper, "mine-generated-drop");
});

for (const scenario of [
  { kind: "mine-content-noop" as const, protocolVersion: 2 as const },
  { kind: "place-directional" as const, protocolVersion: 2 as const },
  { kind: "place-directional" as const, protocolVersion: 1 as const },
]) {
  test(`same-session finalize recovery preserves ${scenario.protocolVersion === 1 ? "explicit V1 fallback" : scenario.kind}`, async () => {
    const harness = createHarness({ ...scenario, localSaveErrors: [new Error("temporary")] });
    await harness.commit();
    await harness.retry();
    assert.equal(harness.counters.worldProjectionRequests, scenario.kind === "mine-content-noop" ? 0 : 1);
    assert.equal(harness.counters.playerCameraCommits, 1);
    assert.equal(harness.counters.localSaves, 2);
    assert.equal(harness.acknowledgements.length, 1);
    assert.equal(harness.delivery.protocolVersion, scenario.protocolVersion);
    assert.equal(harness.delivery.legacyFallback, scenario.protocolVersion === 1 ? "v1-capability" : null);
  });
}

for (const suppression of [
  { suppressNativeSave: true },
  { multiplayerAuthorityMode: "rust-authoritative" as const },
]) {
  test(`multiplayer suppression rejects before generic block-edit checkpoint (${Object.keys(suppression)[0]})`, async () => {
    const harness = createHarness({ kind: "mine-generated-drop", ...suppression });
    await assert.rejects(harness.commit(), /disabled after multiplayer authority/u);

    assert.deepEqual(harness.calls, []);
    assert.equal(harness.counters.worldProjectionRequests, 0);
    assert.equal(harness.counters.inventoryMutations, 0);
    assert.equal(harness.counters.drops, 0);
    assert.equal(harness.counters.localSaves, 0);
    assert.equal(harness.acknowledgements.length, 0);
    assert.deepEqual(harness.currentCell(), { block: BlockId.Stone, facing: 0 });
    assert.deepEqual(harness.cursor(), { schema: 1, cursor: 0, lastReceiptHash: null });
    assert.equal(harness.checkpointWitness(), null);
    assert.equal(harness.commitLocked(), false);
  });
}

test("recorded already-applied directional world state recovers without a duplicate world write", async () => {
  const harness = createHarness({
    kind: "place-directional",
    initiallyAlreadyApplied: true,
    worldProjectionResult: "already-applied",
  });
  await harness.commit();

  assert.equal(harness.counters.worldProjectionRequests, 1);
  assert.equal(harness.counters.worldStateWrites, 0);
  assert.deepEqual(harness.currentCell(), { block: BlockId.WildwoodShelf, facing: 2 });
  assert.deepEqual(harness.inventory[0], { item: Item.WildwoodShelfItem, count: 1 });
  assert.equal(harness.counters.playerCameraCommits, 1);
  assert.equal(harness.counters.localSaves, 1);
  assert.equal(harness.acknowledgements.length, 1);
  assert.deepEqual(harness.cursor(), {
    schema: 1,
    cursor: harness.receipt.sequence,
    lastReceiptHash: harness.receipt.receiptHash,
  });
  assert.ok(harness.calls.includes("world:projection-already-applied"));
  assert.ok(harness.calls.indexOf("local:save") < harness.calls.indexOf("pump:ack"));
  assert.equal(harness.commitLocked(), false);
});
