/**
 * Same-envelope presentation join for Rust R10 entity rendering.
 *
 * The BWR6 player record remains authoritative for the entity. The BWX0
 * player-binding row in that exact Worker envelope is the only source for the
 * selected held stack. Exact presentation profiles become one reserved R6
 * equipment attachment; missing and unmapped roles stay explicit blockers.
 */

import {
  compareCanonicalUtf8R10,
  decodeRustAuthoritativeExtractionR10,
  type RustDomainRowR10,
  type RustDomainValueR10,
} from "./rust-authoritative-extraction-r10.ts";
import type { RustIntegratedRuntimeExtractionV1 } from "./rust-integrated-runtime-contract.ts";
import type {
  RustEntityExtractionR6V3,
} from "./rust-entity-authority-contract-r6.ts";
import {
  RustEntityRenderExtractionR10,
  type RenderEntityEquipmentModelR10,
  type RenderEntityFrameContextR10,
} from "./rust-render-entity-extraction-r10.ts";
import type {
  AttestedRenderPresentationCatalogV1,
  RenderPresentationRegistryV1,
} from "./rust-render-presentation-profile.ts";

export const RUST_HELD_PRESENTATION_SLOT_R10 = "world-view-held-right-hand" as const;

const U32_MAX = BigInt(0xffff_ffff);

export type RustHeldPresentationBlockerR10 = Readonly<{
  id: string;
  status: "missing" | "unmapped" | "unavailable";
  entityId: bigint | null;
  itemId: string | null;
  blockerId: string | null;
}>;

export type RustPresentationExtractionDiagnosticsR10 = Readonly<{
  schema: 1;
  extractionRevision: bigint | null;
  heldAttachments: number;
  heldBlockers: readonly RustHeldPresentationBlockerR10[];
}>;

type PreparedPresentationExtractionR10 = Readonly<{
  token: symbol;
  renderBytes: Uint8Array;
  source: RustEntityExtractionR6V3 | null;
  extractionRevision: bigint;
  heldAttachments: number;
  heldBlockers: readonly RustHeldPresentationBlockerR10[];
}>;

type HeldStackR10 = Readonly<{
  itemId: string;
  count: number;
  durability: number;
  durabilityPresent: boolean;
  metadataHash: Uint8Array;
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function exactField(row: RustDomainRowR10, name: string): RustDomainValueR10 {
  const entry = row.fields.find(([field]) => field === name);
  invariant(entry !== undefined, `R10 player binding '${row.key}' has no ${name} field`);
  return entry[1];
}

function optionalField(row: RustDomainRowR10, name: string) {
  return row.fields.find(([field]) => field === name)?.[1];
}

function exactBool(row: RustDomainRowR10, name: string) {
  const value = exactField(row, name);
  invariant(typeof value === "boolean", `R10 player binding '${row.key}' ${name} is not bool`);
  return value;
}

function exactU64(row: RustDomainRowR10, name: string) {
  const value = exactField(row, name);
  invariant(typeof value === "bigint", `R10 player binding '${row.key}' ${name} is not u64`);
  return value;
}

function exactU32(row: RustDomainRowR10, name: string, allowZero = true) {
  const value = exactU64(row, name);
  invariant(value >= BigInt(allowZero ? 0 : 1) && value <= U32_MAX,
    `R10 player binding '${row.key}' ${name} is not u32`);
  return Number(value);
}

function parseHeldStack(row: RustDomainRowR10): HeldStackR10 | null {
  const present = exactBool(row, "held.present");
  const heldFields = row.fields.filter(([name]) => name.startsWith("held.")).map(([name]) => name);
  if (!present) {
    invariant(heldFields.length === 1, `R10 player binding '${row.key}' has fields for an absent held stack`);
    return null;
  }
  const durabilityPresent = exactBool(row, "held.durability.present");
  const durabilityValue = optionalField(row, "held.durability.value");
  invariant(durabilityPresent === (durabilityValue !== undefined),
    `R10 player binding '${row.key}' held durability presence is inconsistent`);
  if (durabilityValue !== undefined) invariant(typeof durabilityValue === "bigint",
    `R10 player binding '${row.key}' held durability is not u64`);
  const expectedFields = durabilityPresent ? 6 : 5;
  invariant(heldFields.length === expectedFields, `R10 player binding '${row.key}' has unknown held stack fields`);
  const metadataHash = exactField(row, "held.metadataHash");
  invariant(metadataHash instanceof Uint8Array && metadataHash.byteLength === 16,
    `R10 player binding '${row.key}' held metadata hash is invalid`);
  if (durabilityValue !== undefined) invariant(durabilityValue <= U32_MAX,
    `R10 player binding '${row.key}' held durability exceeds u32`);
  return Object.freeze({
    itemId: String(exactU32(row, "held.itemCode")),
    count: exactU32(row, "held.count", false),
    durability: durabilityValue === undefined ? 0 : Number(durabilityValue),
    durabilityPresent,
    metadataHash: Uint8Array.from(metadataHash),
  });
}

function blocker(
  status: "missing" | "unmapped",
  entityId: bigint,
  itemId: string,
  blockerId: string | null,
): RustHeldPresentationBlockerR10 {
  return Object.freeze({
    id: `held-item:${status}:item:${itemId}:entity:${entityId}${blockerId === null ? "" : `:${blockerId}`}`,
    status,
    entityId,
    itemId,
    blockerId,
  });
}

function unavailableBlocker(id: string, blockerId: string | null): RustHeldPresentationBlockerR10 {
  return Object.freeze({
    id: `held-item:unavailable:${id}`,
    status: "unavailable",
    entityId: null,
    itemId: null,
    blockerId,
  });
}

function augmentHeldPresentations(
  extraction: RustIntegratedRuntimeExtractionV1,
  registry: RenderPresentationRegistryV1,
): Omit<PreparedPresentationExtractionR10, "token"> {
  const decoded = decodeRustAuthoritativeExtractionR10(extraction);
  let source = decoded.entities;
  let heldAttachments = 0;
  const heldBlockers: RustHeldPresentationBlockerR10[] = [];
  if (decoded.domains === null) {
    heldBlockers.push(unavailableBlocker("player-domain-envelope-absent", "domain-extraction-not-submitted"));
    return Object.freeze({
      renderBytes: Uint8Array.from(extraction.render), source, extractionRevision: decoded.extractionRevision,
      heldAttachments, heldBlockers: Object.freeze(heldBlockers),
    });
  }

  const playerView = decoded.domains.views.find((view) => view.domain === 2);
  invariant(playerView !== undefined, "R10 domain bundle has no player view");
  if (playerView.status !== "complete") {
    const blockerId = playerView.blockers.join(",");
    heldBlockers.push(unavailableBlocker(
      `player-domain-${playerView.status}:${blockerId}`,
      blockerId || null,
    ));
    return Object.freeze({
      renderBytes: Uint8Array.from(extraction.render), source, extractionRevision: decoded.extractionRevision,
      heldAttachments, heldBlockers: Object.freeze(heldBlockers),
    });
  }
  invariant(decoded.domains.contentReady, "R10 player presentation content is not installed and attested");
  const bindingRows = playerView.rows.filter((row) => row.kind === 2);
  if (bindingRows.length === 0) return Object.freeze({
    renderBytes: Uint8Array.from(extraction.render), source, extractionRevision: decoded.extractionRevision,
    heldAttachments, heldBlockers: Object.freeze(heldBlockers),
  });
  invariant(source !== null, "R10 player bindings have no same-envelope BWR6 entity extraction");

  const recordIndexes = new Map<bigint, number>();
  source.records.forEach((record, index) => {
    invariant(!recordIndexes.has(record.entityId), "duplicate same-envelope BWR6 entity id");
    recordIndexes.set(record.entityId, index);
  });
  const joinedEntities = new Set<bigint>();
  const records = [...source.records];
  for (const row of bindingRows) {
    const playerId = exactU64(row, "playerId");
    invariant(row.key === `binding:${playerId}`, `R10 player binding '${row.key}' key does not match playerId`);
    const entityId = exactU64(row, "entityId");
    invariant(!joinedEntities.has(entityId), `R10 entity ${entityId} has multiple player bindings`);
    joinedEntities.add(entityId);
    const recordIndex = recordIndexes.get(entityId);
    invariant(recordIndex !== undefined, `R10 player binding '${row.key}' references a missing BWR6 entity`);
    const record = records[recordIndex];
    invariant(record.class === "player", `R10 player binding '${row.key}' references a non-player BWR6 entity`);
    invariant(exactU64(row, "entityRevision") === record.entityRevision,
      `R10 player binding '${row.key}' entity revision differs from BWR6`);
    invariant(!record.equipment.some(([slotKey]) => slotKey === RUST_HELD_PRESENTATION_SLOT_R10),
      `R10 player ${entityId} already owns reserved held presentation slot`);
    const held = parseHeldStack(row);
    if (held === null) continue;
    const binding = registry.resolve("held-item", { domain: "item", id: held.itemId });
    if (binding.status === "missing") {
      heldBlockers.push(blocker("missing", entityId, held.itemId, binding.blocker.id));
      continue;
    }
    if (binding.status === "unmapped") {
      heldBlockers.push(blocker("unmapped", entityId, held.itemId, null));
      continue;
    }
    const equipment = [...record.equipment, Object.freeze([
      RUST_HELD_PRESENTATION_SLOT_R10,
      Object.freeze({
        itemKey: held.itemId,
        count: held.count,
        durability: held.durability,
        custom: Object.freeze([
          Object.freeze(["world-view.durability-present", Uint8Array.of(held.durabilityPresent ? 1 : 0)] as const),
          Object.freeze(["world-view.metadata-hash", Uint8Array.from(held.metadataHash)] as const),
        ]),
      }),
    ] as const)].sort(([left], [right]) => compareCanonicalUtf8R10(left, right));
    records[recordIndex] = Object.freeze({ ...record, equipment: Object.freeze(equipment) });
    heldAttachments += 1;
  }
  heldBlockers.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  source = Object.freeze({ ...source, records: Object.freeze(records) });
  return Object.freeze({
    renderBytes: Uint8Array.from(extraction.render),
    source,
    extractionRevision: decoded.extractionRevision,
    heldAttachments,
    heldBlockers: Object.freeze(heldBlockers),
  });
}

/** Derives only exact held-item mappings from the attested production profile catalog. */
export function createProductionHeldEquipmentModelsR10(
  presentations: AttestedRenderPresentationCatalogV1,
): readonly RenderEntityEquipmentModelR10[] {
  const mappings = new Map<string, RenderEntityEquipmentModelR10>();
  for (const profile of presentations.profileCatalog.profiles) {
    if (profile.role !== "held-item") continue;
    invariant(presentations.modelsByProfileId.get(profile.id)?.modelId === profile.model.id,
      `attested render presentation '${profile.id}' has no exact BWM2 model`);
    for (const reference of profile.contentRefs) {
      invariant(reference.domain === "item", `held presentation '${profile.id}' has a non-item content ref`);
      invariant(!mappings.has(reference.id), `duplicate held-item model mapping for '${reference.id}'`);
      mappings.set(reference.id, Object.freeze({ itemKey: reference.id, modelKey: profile.model.id }));
    }
  }
  return Object.freeze([...mappings.values()].sort((left, right) => compareCanonicalUtf8R10(left.itemKey, right.itemKey)));
}

/**
 * Adapter accepted by the existing scene composer. Preparation and clearing
 * bracket one synchronous composer submission, so a binding cannot leak into
 * another Worker envelope or world generation.
 */
export class RustPresentationEntityExtractionR10 {
  private pending: PreparedPresentationExtractionR10 | null = null;
  private lastDiagnostics: RustPresentationExtractionDiagnosticsR10 = Object.freeze({
    schema: 1, extractionRevision: null, heldAttachments: 0, heldBlockers: Object.freeze([]),
  });

  constructor(
    private readonly entityExtractor: RustEntityRenderExtractionR10,
    private readonly registry: RenderPresentationRegistryV1,
  ) {}

  prepareRuntimeExtraction(extraction: RustIntegratedRuntimeExtractionV1) {
    invariant(this.pending === null, "a render presentation extraction is already prepared");
    const augmented = augmentHeldPresentations(extraction, this.registry);
    const token = Symbol("rust-presentation-extraction-r10");
    this.pending = Object.freeze({ ...augmented, token });
    return token;
  }

  finishPreparedRuntimeExtraction(token: symbol, accepted: boolean) {
    invariant(this.pending?.token === token, "render presentation extraction token does not match");
    if (accepted) this.lastDiagnostics = Object.freeze({
      schema: 1,
      extractionRevision: this.pending.extractionRevision,
      heldAttachments: this.pending.heldAttachments,
      heldBlockers: this.pending.heldBlockers,
    });
    this.pending = null;
  }

  extractBytes(bytes: Uint8Array | ArrayBuffer, context: RenderEntityFrameContextR10) {
    const pending = this.pending;
    invariant(pending !== null, "no same-envelope render presentation extraction is prepared");
    const actualBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    invariant(equalBytes(actualBytes, pending.renderBytes), "BWR6 bytes differ from the prepared Worker envelope");
    invariant(pending.source !== null, "prepared Worker envelope has no BWR6 entity extraction");
    return this.entityExtractor.extract(pending.source, context);
  }

  resetRevisionGuard() {
    invariant(this.pending === null, "cannot reset entity revision guard during a prepared presentation join");
    this.entityExtractor.resetRevisionGuard();
  }

  resetResourceReplay() {
    invariant(this.pending === null, "cannot reset entity resources during a prepared presentation join");
    this.entityExtractor.resetResourceReplay();
  }

  diagnostics(): RustPresentationExtractionDiagnosticsR10 {
    return this.lastDiagnostics;
  }
}
