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
  compileRenderEntityModelResourcesR10,
  renderEntityPaletteKeyR10,
  type RenderEntityCompiledModelR10,
  type RenderEntityModelResourcesR10,
} from "./rust-render-entity-catalog-r10.ts";
import {
  RustEntityRenderExtractionR10,
  type RenderEntityEquipmentModelR10,
  type RenderEntityExtractionResultR10,
  type RenderEntityFrameContextR10,
} from "./rust-render-entity-extraction-r10.ts";
import {
  createRenderFrameV2,
  createRenderResourceBatchV2,
  RENDER_MAX_INSTANCES_V2,
  RENDER_MAX_RESOURCE_OPERATIONS_V2,
  type RenderInstanceV2,
  type RenderResourceOperationV2,
  type RenderTransformV2,
} from "./rust-render-extraction-v2.ts";
import type {
  AttestedRenderPresentationCatalogV1,
  RenderPresentationContentRefV1,
  RenderPresentationProfileV1,
} from "./rust-render-presentation-profile.ts";
import {
  createRenderPresentationCoverageInventoryR10,
  RENDER_PRESENTATION_CATALOG_ID_V1,
  RENDER_PRESENTATION_CATALOG_REVISION_V1,
} from "./rust-render-presentation-profile.ts";
import { TypeScriptCanonicalHasher } from "./rust-kernel-shadow.ts";

export const RUST_HELD_PRESENTATION_SLOT_R10 = "world-view-held-right-hand" as const;

const U32_MAX = BigInt(0xffff_ffff);
const U64_MAX = BigInt("0xffffffffffffffff");
const MICROTURN_SCALE = 1_000_000;
const WORLD_VIEW_COORDINATE_LIMIT_MILLI = BigInt(33_554_432_000);
const WHITE = Object.freeze([255, 255, 255, 255] as const);

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
  heldPresentations: readonly RustHeldPresentationR10[];
  heldBlockers: readonly RustHeldPresentationBlockerR10[];
  droppedBindings: number;
  droppedPresentations: readonly RustDroppedPresentationR10[];
  droppedBlockers: readonly RustDroppedPresentationBlockerR10[];
  machineBindings: number;
  machineBlockers: readonly RustMachinePresentationBlockerR10[];
  machines: readonly RustMachinePresentationR10[];
  combatBindings: number;
  combatPresentations: readonly RustCombatPresentationR10[];
  combatBlockers: readonly RustCombatPresentationBlockerR10[];
  runtimeBlockers: readonly RustPresentationRuntimeBlockerR10[];
  coverageHash: string;
}>;

export type RustPresentationRuntimeBlockerR10 = Readonly<{
  id: string;
  family: "dropped-item" | "held-item" | "projectile" | "summon" | "vehicle";
  status: "unavailable";
  sourceId: string;
  entityId: bigint | null;
  blockerId: string;
}>;

export type RustPresentationBindingIdentityR10 = Readonly<{
  role: "held-item" | "dropped-item" | "machine" | "projectile" | "summon";
  primaryContentRef: RenderPresentationContentRefV1;
  profileId: string;
  modelId: string;
  presentationCatalog: Readonly<{
    id: typeof RENDER_PRESENTATION_CATALOG_ID_V1;
    schema: 1 | 2;
    revision: number;
    contentVersion: number;
    contentHash: Uint8Array;
  }>;
  modelCatalog: Readonly<{
    revision: bigint;
    canonicalHash: string;
    sha256: string;
  }>;
}>;

export type RustHeldPresentationR10 = Readonly<{
  id: string;
  role: "held-item";
  playerId: bigint;
  entityId: bigint;
  itemId: string;
  count: number;
  durability: number;
  durabilityPresent: boolean;
  metadataHash: Uint8Array;
  binding: RustPresentationBindingIdentityR10;
  instanceIds: readonly bigint[];
}>;

export type RustDroppedPresentationR10 = Readonly<{
  id: string;
  role: "dropped-item";
  dropId: string;
  entityId: bigint;
  itemId: string;
  binding: RustPresentationBindingIdentityR10;
  instanceIds: readonly bigint[];
}>;

export type RustCombatPresentationR10 = Readonly<{
  id: string;
  role: "projectile" | "summon";
  recordId: string;
  entityId: bigint;
  contentId: string;
  binding: RustPresentationBindingIdentityR10;
  instanceIds: readonly bigint[];
}>;

export type RustCombatPresentationBlockerR10 = Readonly<{
  id: string;
  status: "missing" | "unmapped" | "unavailable";
  role: "projectile" | "summon" | null;
  recordId: string | null;
  entityId: bigint | null;
  contentId: string | null;
  presentationId: string | null;
  blockerId: string | null;
}>;

export type RustDroppedPresentationBlockerR10 = Readonly<{
  id: string;
  status: "missing" | "unmapped" | "unavailable";
  dropId: string | null;
  entityId: bigint | null;
  itemId: string | null;
  blockerId: string | null;
}>;

export type RustPresentationContentIdentityR10 = Readonly<{
  contentVersion: number;
  contentHash: Uint8Array;
}>;

export type RustMachineLightPresentationR10 = Readonly<{
  kind: number;
  colorMillionths: readonly [number, number, number];
  luminousFluxMillilumens: bigint;
  rangeMilli: number;
  innerConeMicroturns: number;
  outerConeMicroturns: number;
  castsShadows: boolean;
  enabled: boolean;
}>;

export type RustMachinePresentationR10 = Readonly<{
  id: string;
  role: "machine";
  machineId: string;
  anchorRevision: bigint;
  presentationId: string;
  profileId: string;
  modelId: string;
  contentVersion: number;
  contentHash: Uint8Array;
  positionMilli: readonly [bigint, bigint, bigint];
  rotationMicroturns: readonly [number, number, number];
  halfExtentsMilli: readonly [number, number, number];
  gameplayRevision: bigint;
  gameplayActive: boolean;
  light: RustMachineLightPresentationR10 | null;
  binding: RustPresentationBindingIdentityR10;
  instanceIds: readonly bigint[];
}>;

export type RustMachinePresentationBlockerR10 = Readonly<{
  id: string;
  status: "missing" | "unmapped" | "unavailable";
  machineId: string | null;
  presentationId: string | null;
  blockerId: string | null;
}>;

export type RustPresentationEntityExtractionResultR10 = RenderEntityExtractionResultR10 & Readonly<{
  machinePresentations: readonly RustMachinePresentationR10[];
  presentationFrame: RustPresentationFrameR10;
}>;

export type RustPresentationFrameR10 = Readonly<{
  schema: 1;
  extractionRevision: bigint;
  authorityTick: bigint;
  coverageHash: string;
  bindings: readonly (
    RustHeldPresentationR10 | RustDroppedPresentationR10 | RustMachinePresentationR10 | RustCombatPresentationR10
  )[];
  heldBlockers: readonly RustHeldPresentationBlockerR10[];
  droppedBlockers: readonly RustDroppedPresentationBlockerR10[];
  machineBlockers: readonly RustMachinePresentationBlockerR10[];
  combatBlockers: readonly RustCombatPresentationBlockerR10[];
  runtimeBlockers: readonly RustPresentationRuntimeBlockerR10[];
}>;

type PreparedPresentationExtractionR10 = Readonly<{
  token: symbol;
  renderBytes: Uint8Array;
  source: RustEntityExtractionR6V3 | null;
  extractionRevision: bigint;
  heldAttachments: number;
  heldPresentations: readonly PreparedHeldPresentationR10[];
  heldBlockers: readonly RustHeldPresentationBlockerR10[];
  droppedBindings: number;
  droppedPresentations: readonly PreparedDroppedPresentationR10[];
  droppedBlockers: readonly RustDroppedPresentationBlockerR10[];
  machines: readonly PreparedMachinePresentationR10[];
  machineBindings: number;
  machineBlockers: readonly RustMachinePresentationBlockerR10[];
  combatBindings: number;
  combatPresentations: readonly PreparedCombatPresentationR10[];
  combatBlockers: readonly RustCombatPresentationBlockerR10[];
  runtimeBlockers: readonly RustPresentationRuntimeBlockerR10[];
}>;

type PreparedMachinePresentationR10 = Omit<RustMachinePresentationR10, "instanceIds"> & Readonly<{
  model: RenderEntityCompiledModelR10;
}>;

type PreparedHeldPresentationR10 = Omit<RustHeldPresentationR10, "instanceIds">;
type PreparedDroppedPresentationR10 = Omit<RustDroppedPresentationR10, "instanceIds">;
type PreparedCombatPresentationR10 = Omit<RustCombatPresentationR10, "instanceIds">;

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

function exactBindingIdentity(
  role: RustPresentationBindingIdentityR10["role"],
  profile: RenderPresentationProfileV1,
  primaryContentRef: RenderPresentationContentRefV1,
  presentations: AttestedRenderPresentationCatalogV1,
  presentationContent: RustPresentationContentIdentityR10,
): RustPresentationBindingIdentityR10 {
  invariant(profile.role === role, `R10 ${role} profile role is inconsistent`);
  invariant(profile.contentRefs.some((reference) => reference.domain === primaryContentRef.domain
    && reference.id === primaryContentRef.id), `R10 ${role} primary content ref is absent from its exact profile`);
  invariant(presentations.modelsByProfileId.get(profile.id)?.modelId === profile.model.id,
    `R10 ${role} profile has no exact attested BWM2 model`);
  invariant(presentations.profileCatalog.catalog.canonicalHash === presentations.modelCatalog.catalogHashHex
    && presentations.profileCatalog.catalog.sha256 === presentations.modelCatalog.contentSha256,
  `R10 ${role} profile and model catalog identities differ`);
  return Object.freeze({
    role,
    primaryContentRef: Object.freeze({ ...primaryContentRef }),
    profileId: profile.id,
    modelId: profile.model.id,
    presentationCatalog: Object.freeze({
      id: RENDER_PRESENTATION_CATALOG_ID_V1,
      schema: presentations.profileCatalog.schema,
      revision: RENDER_PRESENTATION_CATALOG_REVISION_V1,
      contentVersion: presentationContent.contentVersion,
      contentHash: Uint8Array.from(presentationContent.contentHash),
    }),
    modelCatalog: Object.freeze({
      revision: presentations.modelCatalog.revision,
      canonicalHash: presentations.modelCatalog.catalogHashHex,
      sha256: presentations.modelCatalog.contentSha256,
    }),
  });
}

function exactField(row: RustDomainRowR10, name: string): RustDomainValueR10 {
  const entry = row.fields.find(([field]) => field === name);
  invariant(entry !== undefined, `R10 player binding '${row.key}' has no ${name} field`);
  return entry[1];
}

function optionalField(row: RustDomainRowR10, name: string) {
  return row.fields.find(([field]) => field === name)?.[1];
}

function optionalString(row: RustDomainRowR10, name: string) {
  const value = optionalField(row, name);
  invariant(value === undefined || typeof value === "string",
    `R10 domain row '${row.key}' ${name} is not an optional string`);
  return value ?? null;
}

function exactBool(row: RustDomainRowR10, name: string) {
  const value = exactField(row, name);
  invariant(typeof value === "boolean", `R10 player binding '${row.key}' ${name} is not bool`);
  return value;
}

function exactString(row: RustDomainRowR10, name: string) {
  const value = exactField(row, name);
  invariant(typeof value === "string" && value.length > 0, `R10 domain row '${row.key}' ${name} is not a string`);
  return value;
}

function exactHash(row: RustDomainRowR10, name: string) {
  const value = exactField(row, name);
  invariant(value instanceof Uint8Array && value.byteLength === 16,
    `R10 domain row '${row.key}' ${name} is not a canonical hash`);
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

function exactTypedField(row: RustDomainRowR10, name: string, type: NonNullable<RustDomainRowR10["fieldTypes"]>[number]) {
  const index = row.fields.findIndex(([field]) => field === name);
  invariant(index >= 0, `R10 domain row '${row.key}' has no ${name} field`);
  invariant(row.fieldTypes?.[index] === type, `R10 domain row '${row.key}' ${name} has the wrong wire type`);
  return row.fields[index][1];
}

function exactMachineString(row: RustDomainRowR10, name: string) {
  const value = exactTypedField(row, name, "string");
  invariant(typeof value === "string" && value.length > 0, `R10 machine anchor '${row.key}' ${name} is invalid`);
  return value;
}

function exactMachineU64(row: RustDomainRowR10, name: string) {
  const value = exactTypedField(row, name, "u64");
  invariant(typeof value === "bigint" && value >= BigInt(0) && value <= U64_MAX,
    `R10 machine anchor '${row.key}' ${name} is not u64`);
  return value;
}

function exactMachineU32(row: RustDomainRowR10, name: string, allowZero = true) {
  const value = exactMachineU64(row, name);
  invariant(value >= BigInt(allowZero ? 0 : 1) && value <= U32_MAX,
    `R10 machine anchor '${row.key}' ${name} is not u32`);
  return Number(value);
}

function exactMachineI64(row: RustDomainRowR10, name: string) {
  const value = exactTypedField(row, name, "i64");
  invariant(typeof value === "bigint", `R10 machine anchor '${row.key}' ${name} is not i64`);
  return value;
}

function exactMachineBool(row: RustDomainRowR10, name: string) {
  const value = exactTypedField(row, name, "bool");
  invariant(typeof value === "boolean", `R10 machine anchor '${row.key}' ${name} is not bool`);
  return value;
}

function exactMachineHash(row: RustDomainRowR10, name: string) {
  const value = exactTypedField(row, name, "hash");
  invariant(value instanceof Uint8Array && value.byteLength === 16,
    `R10 machine anchor '${row.key}' ${name} is not a canonical hash`);
  return Uint8Array.from(value);
}

function machineBlocker(
  status: "missing" | "unmapped",
  machineId: string,
  presentationId: string,
  blockerId: string,
): RustMachinePresentationBlockerR10 {
  return Object.freeze({
    id: `machine:${status}:anchor:${machineId}:presentation:${presentationId}:${blockerId}`,
    status,
    machineId,
    presentationId,
    blockerId,
  });
}

function machineUnavailableBlocker(id: string, blockerId: string | null): RustMachinePresentationBlockerR10 {
  return Object.freeze({
    id: `machine:unavailable:${id}`,
    status: "unavailable",
    machineId: null,
    presentationId: null,
    blockerId,
  });
}

function parseMachineLight(row: RustDomainRowR10): RustMachineLightPresentationR10 | null {
  const present = exactMachineBool(row, "light.present");
  const lightFields = row.fields.filter(([name]) => name.startsWith("light.")).map(([name]) => name);
  if (!present) {
    invariant(lightFields.length === 1, `R10 machine anchor '${row.key}' has fields for an absent light`);
    return null;
  }
  invariant(lightFields.length === 11, `R10 machine anchor '${row.key}' light fields are incomplete`);
  const kind = exactMachineU32(row, "light.kind");
  invariant(kind <= 3, `R10 machine anchor '${row.key}' light kind is invalid`);
  const colorMillionths = Object.freeze([
    exactMachineU32(row, "light.color.redMillionths"),
    exactMachineU32(row, "light.color.greenMillionths"),
    exactMachineU32(row, "light.color.blueMillionths"),
  ] as const);
  invariant(colorMillionths.every((value) => value <= MICROTURN_SCALE),
    `R10 machine anchor '${row.key}' light color is outside millionths`);
  const rangeMilli = exactMachineU32(row, "light.rangeMilli", false);
  const innerConeMicroturns = exactMachineU32(row, "light.innerConeMicroturns");
  const outerConeMicroturns = exactMachineU32(row, "light.outerConeMicroturns");
  invariant(rangeMilli <= 1_024_000, `R10 machine anchor '${row.key}' light range exceeds authority bounds`);
  invariant(outerConeMicroturns <= 500_000 && innerConeMicroturns <= outerConeMicroturns
    && (kind === 1 || innerConeMicroturns === 0 && outerConeMicroturns === 0),
    `R10 machine anchor '${row.key}' light cone is invalid`);
  const luminousFluxMillilumens = exactMachineU64(row, "light.luminousFluxMillilumens");
  invariant(luminousFluxMillilumens > BigInt(0),
    `R10 machine anchor '${row.key}' light intensity is outside authority bounds`);
  return Object.freeze({
    kind,
    colorMillionths,
    luminousFluxMillilumens,
    rangeMilli,
    innerConeMicroturns,
    outerConeMicroturns,
    castsShadows: exactMachineBool(row, "light.castsShadows"),
    enabled: exactMachineBool(row, "light.enabled"),
  });
}

function parseExactMachine(
  row: RustDomainRowR10,
  presentations: AttestedRenderPresentationCatalogV1,
  presentationContent: RustPresentationContentIdentityR10,
): PreparedMachinePresentationR10 {
  const machineId = exactMachineString(row, "machineId");
  invariant(row.key === `anchor:${machineId}`, `R10 machine anchor '${row.key}' key does not match machineId`);
  const presentationId = exactMachineString(row, "presentationId");
  invariant(exactMachineString(row, "presentation.role") === "machine",
    `R10 machine anchor '${row.key}' presentation role is not machine`);
  const binding = presentations.registry.resolveProfileId("machine", presentationId);
  invariant(binding.status === "exact", `R10 machine anchor '${row.key}' suppresses a non-exact catalog binding`);
  invariant(exactMachineString(row, "presentation.status") === "exact",
    `R10 machine anchor '${row.key}' suppresses an exact presentation`);
  invariant(exactMachineString(row, "presentation.profileId") === binding.profile.id
    && binding.profile.id === presentationId,
  `R10 machine anchor '${row.key}' profile id differs from the attested registry`);
  invariant(exactMachineString(row, "presentation.modelId") === binding.profile.model.id,
    `R10 machine anchor '${row.key}' model id differs from the attested registry`);
  invariant(exactMachineU32(row, "presentation.contentVersion", false) === presentationContent.contentVersion,
    `R10 machine anchor '${row.key}' content version differs from the installed catalog`);
  const contentHash = exactMachineHash(row, "presentation.contentHash");
  invariant(equalBytes(contentHash, presentationContent.contentHash),
    `R10 machine anchor '${row.key}' content hash differs from the installed catalog`);
  const model = presentations.modelsByProfileId.get(binding.profile.id);
  invariant(model !== undefined && model.modelId === binding.profile.model.id,
    `R10 machine anchor '${row.key}' has no attested BWM2 model`);
  const primaryContentRef = binding.profile.contentRefs.find((reference) => reference.domain === "machine-profile");
  invariant(primaryContentRef !== undefined, `R10 machine anchor '${row.key}' exact profile has no machine content ref`);
  const bindingIdentity = exactBindingIdentity(
    "machine", binding.profile, primaryContentRef, presentations, presentationContent,
  );
  const positionMilli = Object.freeze([
    exactMachineI64(row, "position.xMilli"),
    exactMachineI64(row, "position.yMilli"),
    exactMachineI64(row, "position.zMilli"),
  ] as const);
  invariant(positionMilli.every((value) => (value < BigInt(0) ? -value : value) <= WORLD_VIEW_COORDINATE_LIMIT_MILLI),
    `R10 machine anchor '${row.key}' position exceeds authority bounds`);
  const rotationMicroturns = Object.freeze([
    exactMachineU32(row, "rotation.yawMicroturns"),
    exactMachineU32(row, "rotation.pitchMicroturns"),
    exactMachineU32(row, "rotation.rollMicroturns"),
  ] as const);
  invariant(rotationMicroturns.every((value) => value < MICROTURN_SCALE),
    `R10 machine anchor '${row.key}' rotation is not canonical`);
  const halfExtentsMilli = Object.freeze([
    exactMachineU32(row, "halfExtents.xMilli", false),
    exactMachineU32(row, "halfExtents.yMilli", false),
    exactMachineU32(row, "halfExtents.zMilli", false),
  ] as const);
  invariant(halfExtentsMilli.every((value) => value <= 1_024_000),
    `R10 machine anchor '${row.key}' extents exceed authority bounds`);
  const light = parseMachineLight(row);
  const expectedFields = light === null ? 21 : 31;
  invariant(row.fields.length === expectedFields, `R10 machine anchor '${row.key}' has unknown fields`);
  return Object.freeze({
    id: `machine:anchor:${machineId}:profile:${binding.profile.id}`,
    role: "machine",
    machineId,
    anchorRevision: exactMachineU64(row, "anchorRevision"),
    presentationId,
    profileId: binding.profile.id,
    modelId: binding.profile.model.id,
    contentVersion: presentationContent.contentVersion,
    contentHash,
    positionMilli,
    rotationMicroturns,
    halfExtentsMilli,
    gameplayRevision: exactMachineU64(row, "gameplayRevision"),
    gameplayActive: exactMachineBool(row, "gameplayActive"),
    light,
    binding: bindingIdentity,
    model,
  });
}

function validateBlockedMachine(
  row: RustDomainRowR10,
  presentations: AttestedRenderPresentationCatalogV1,
): RustMachinePresentationBlockerR10 {
  const machineId = exactMachineString(row, "machineId");
  invariant(row.key === `anchor:${machineId}`, `R10 machine anchor '${row.key}' key does not match machineId`);
  exactMachineU64(row, "anchorRevision");
  const presentationId = exactMachineString(row, "presentationId");
  invariant(exactMachineString(row, "presentation.role") === "machine",
    `R10 machine anchor '${row.key}' presentation role is not machine`);
  for (const name of ["position.xMilli", "position.yMilli", "position.zMilli"] as const) exactMachineI64(row, name);
  for (const name of ["rotation.yawMicroturns", "rotation.pitchMicroturns", "rotation.rollMicroturns"] as const) {
    invariant(exactMachineU32(row, name) < MICROTURN_SCALE,
      `R10 machine anchor '${row.key}' rotation is not canonical`);
  }
  for (const name of ["halfExtents.xMilli", "halfExtents.yMilli", "halfExtents.zMilli"] as const) {
    invariant(exactMachineU32(row, name, false) <= 1_024_000,
      `R10 machine anchor '${row.key}' extents exceed authority bounds`);
  }
  exactMachineU64(row, "gameplayRevision");
  exactMachineBool(row, "gameplayActive");
  const light = parseMachineLight(row);
  invariant(row.fields.length === (light === null ? 18 : 28),
    `R10 machine anchor '${row.key}' has unknown blocked fields`);
  const status = exactMachineString(row, "presentation.status");
  const blockerId = exactMachineString(row, "presentation.blockerId");
  const binding = presentations.registry.resolveProfileId("machine", presentationId);
  if (binding.status === "missing") {
    invariant(status === "missing" && blockerId === binding.blocker.id,
      `R10 machine anchor '${row.key}' missing blocker differs from the attested registry`);
    return machineBlocker("missing", machineId, presentationId, blockerId);
  }
  invariant(binding.status === "unmapped" && status === "unmapped"
    && blockerId === "machine-presentation-profile-unmapped",
  `R10 machine anchor '${row.key}' unmapped blocker is inconsistent`);
  return machineBlocker("unmapped", machineId, presentationId, blockerId);
}

function canonicalU64(domain: string, ...values: readonly (string | number | bigint | Uint8Array)[]) {
  const hasher = new TypeScriptCanonicalHasher(domain);
  for (const value of values) {
    if (typeof value === "string") hasher.writeString(value);
    else if (typeof value === "bigint") hasher.writeU64(value);
    else if (typeof value === "number") hasher.writeU32(value);
    else hasher.writeBytes(value);
  }
  const bytes = hasher.finish();
  const id = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
  invariant(id !== BigInt(0), `${domain} produced the reserved zero id`);
  return id;
}

function machineInstanceStableId(machineId: string, nodeId: number) {
  invariant(Number.isInteger(nodeId) && nodeId > 0 && nodeId <= 0xffff_ffff, "machine node id is invalid");
  return canonicalU64("blockwild.render.machine-instance.r10", machineId, nodeId);
}

function microturnQuaternion(yaw: number, pitch: number, roll: number) {
  const scale = Math.PI * 2 / MICROTURN_SCALE;
  const y = yaw * scale * 0.5;
  const x = pitch * scale * 0.5;
  const z = roll * scale * 0.5;
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  const quaternion = [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ] as const;
  const length = Math.hypot(...quaternion);
  invariant(Number.isFinite(length) && length > 0, "machine rotation is not finite");
  return Object.freeze(quaternion.map((value) => Math.fround(value / length)) as unknown as [number, number, number, number]);
}

function multiplyQuaternion(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
) {
  const [ax, ay, az, aw] = left, [bx, by, bz, bw] = right;
  const result = [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ] as const;
  const length = Math.hypot(...result);
  invariant(Number.isFinite(length) && length > 0, "machine node rotation is not finite");
  return Object.freeze(result.map((value) => Math.fround(value / length)) as unknown as [number, number, number, number]);
}

function multiplyScale(left: readonly number[], right: readonly number[]) {
  return Object.freeze(left.map((value, index) => Math.fround(value * right[index])) as unknown as [number, number, number]);
}

function rotateVector(
  rotation: readonly [number, number, number, number],
  vector: readonly [number, number, number],
) {
  const [x, y, z, w] = rotation;
  const [vx, vy, vz] = vector;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return Object.freeze([
    Math.fround(vx + w * tx + y * tz - z * ty),
    Math.fround(vy + w * ty + z * tx - x * tz),
    Math.fround(vz + w * tz + x * ty - y * tx),
  ] as const);
}

function rootMachineTransform(machine: PreparedMachinePresentationR10, local: RenderTransformV2): RenderTransformV2 {
  const rotation = microturnQuaternion(...machine.rotationMicroturns);
  const extentScale = [
    machine.halfExtentsMilli[0] * 2 / 1_000,
    machine.halfExtentsMilli[1] * 2 / 1_000,
    machine.halfExtentsMilli[2] * 2 / 1_000,
  ] as const;
  const localTranslation = rotateVector(rotation, [
    local.translation[0] * extentScale[0],
    local.translation[1] * extentScale[1],
    local.translation[2] * extentScale[2],
  ]);
  return Object.freeze({
    translation: Object.freeze([
      Math.fround(Number(machine.positionMilli[0]) / 1_000 + localTranslation[0]),
      Math.fround(Number(machine.positionMilli[1]) / 1_000 + localTranslation[1]),
      Math.fround(Number(machine.positionMilli[2]) / 1_000 + localTranslation[2]),
    ] as const),
    rotation: multiplyQuaternion(rotation, local.rotation),
    scale: multiplyScale(extentScale, local.scale),
  });
}

function prefixMachineResourceOperation(
  machineResources: RenderEntityModelResourcesR10,
  operation: RenderResourceOperationV2,
): RenderResourceOperationV2 {
  if (operation.kind === "upsert-geometry") return Object.freeze({
    kind: operation.kind,
    geometry: Object.freeze({
      ...operation.geometry,
      id: canonicalU64("blockwild.render.machine-geometry.r10", machineResources.modelId, operation.geometry.id),
    }),
  });
  if (operation.kind === "upsert-material") return Object.freeze({
    kind: operation.kind,
    material: Object.freeze({
      ...operation.material,
      id: canonicalU64("blockwild.render.machine-material.r10", machineResources.modelId, operation.material.id),
    }),
  });
  throw new TypeError("compiled machine model unexpectedly contains a removal or texture resource");
}

function augmentMachineFrame(
  result: RenderEntityExtractionResultR10,
  machines: readonly PreparedMachinePresentationR10[],
  presentations: AttestedRenderPresentationCatalogV1,
  currentResourceRevision: bigint,
  emittedMachineModels: ReadonlySet<string>,
  maxInstances: number,
  maxResourceOperations: number,
) {
  const resourcesByModel = new Map<string, Readonly<{
    compiled: RenderEntityModelResourcesR10;
    geometry: bigint;
    materials: ReadonlyMap<string, bigint>;
    operations: readonly RenderResourceOperationV2[];
  }>>();
  for (const machine of machines) {
    if (resourcesByModel.has(machine.modelId)) continue;
    const compiled = compileRenderEntityModelResourcesR10(presentations.modelCatalog, machine.model);
    const operations = Object.freeze(compiled.operations.map((operation) => prefixMachineResourceOperation(compiled, operation)));
    const geometry = (operations.find((operation) => operation.kind === "upsert-geometry") as
      Extract<RenderResourceOperationV2, { kind: "upsert-geometry" }> | undefined)?.geometry.id;
    invariant(geometry !== undefined, `machine model '${machine.modelId}' has no geometry`);
    const materials = new Map<string, bigint>();
    for (const [palette, original] of compiled.materialByPaletteKey) {
      materials.set(palette, canonicalU64("blockwild.render.machine-material.r10", compiled.modelId, original));
    }
    resourcesByModel.set(machine.modelId, Object.freeze({ compiled, geometry, materials, operations }));
  }
  const instanceIds = new Set(result.frame.instances.map((instance) => instance.stableId));
  const resourceIds = new Set<bigint>();
  for (const operation of result.resources?.operations ?? []) {
    resourceIds.add(operation.kind === "upsert-geometry" ? operation.geometry.id
      : operation.kind === "upsert-material" ? operation.material.id
        : operation.kind === "upsert-texture" ? operation.texture.id : operation.id);
  }
  const operations: RenderResourceOperationV2[] = [...(result.resources?.operations ?? [])];
  for (const resources of [...resourcesByModel.values()].sort((left, right) => compareCanonicalUtf8R10(left.compiled.modelId, right.compiled.modelId))) {
    if (emittedMachineModels.has(resources.compiled.modelId)) continue;
    for (const operation of resources.operations) {
      const id = operation.kind === "upsert-geometry" ? operation.geometry.id
        : operation.kind === "upsert-material" ? operation.material.id
          : operation.kind === "upsert-texture" ? operation.texture.id : operation.id;
      invariant(!resourceIds.has(id), `machine renderer resource id collision at ${id}`);
      resourceIds.add(id);
      operations.push(operation);
    }
  }
  const machinePresentations: RustMachinePresentationR10[] = [];
  const machineInstances: RenderInstanceV2[] = [];
  for (const machine of machines) {
    const resources = resourcesByModel.get(machine.modelId)!;
    const ids: bigint[] = [];
    for (const node of machine.model.nodes) {
      const stableId = machineInstanceStableId(machine.machineId, node.nodeId);
      invariant(!instanceIds.has(stableId), `machine renderer instance id collision at ${stableId}`);
      instanceIds.add(stableId);
      const material = resources.materials.get(renderEntityPaletteKeyR10(node.colorRgba8, node.emissive));
      invariant(material !== undefined, `machine model '${machine.modelId}' palette is incomplete`);
      machineInstances.push(Object.freeze({
        stableId,
        domain: 5,
        geometry: resources.geometry,
        material,
        parent: node.parentNodeId === null ? null : machineInstanceStableId(machine.machineId, node.parentNodeId),
        transform: node.parentNodeId === null ? rootMachineTransform(machine, node.transform) : node.transform,
        tintRgba8: WHITE,
        visibilityMask: node.colorRgba8[3] === 0 ? 0 : 0xffff_ffff,
        sortKey: node.partTag,
        animationFlags: machine.gameplayActive ? 1 : 0,
      }));
      ids.push(stableId);
    }
    machinePresentations.push(Object.freeze({
      id: machine.id,
      role: machine.role,
      machineId: machine.machineId,
      anchorRevision: machine.anchorRevision,
      presentationId: machine.presentationId,
      profileId: machine.profileId,
      modelId: machine.modelId,
      contentVersion: machine.contentVersion,
      contentHash: Uint8Array.from(machine.contentHash),
      positionMilli: machine.positionMilli,
      rotationMicroturns: machine.rotationMicroturns,
      halfExtentsMilli: machine.halfExtentsMilli,
      gameplayRevision: machine.gameplayRevision,
      gameplayActive: machine.gameplayActive,
      light: machine.light,
      binding: machine.binding,
      instanceIds: Object.freeze(ids),
    }));
  }
  invariant(result.frame.instances.length + machineInstances.length <= RENDER_MAX_INSTANCES_V2,
    "presentation frame machine instance cap exceeded");
  invariant(result.frame.instances.length + machineInstances.length <= maxInstances,
    "configured presentation frame instance cap exceeded");
  invariant(operations.length <= maxResourceOperations,
    "configured presentation resource operation cap exceeded");
  const resourceRevision = operations.length > 0 ? currentResourceRevision + BigInt(1) : currentResourceRevision;
  const resources = operations.length > 0 ? createRenderResourceBatchV2({
    epoch: result.frame.epoch,
    revision: resourceRevision,
    operations: Object.freeze(operations),
  }) : null;
  const frame = createRenderFrameV2({
    ...result.frame,
    resourceRevision,
    instances: Object.freeze([...result.frame.instances, ...machineInstances]),
  });
  const augmentedResult = Object.freeze({
    ...result,
    resources,
    frame,
    machinePresentations: Object.freeze(machinePresentations),
  });
  return Object.freeze({
    result: augmentedResult,
    resourceRevision,
    emittedMachineModelIds: Object.freeze(machines.map((machine) => machine.modelId)),
  });
}

function cloneBindingIdentity(binding: RustPresentationBindingIdentityR10): RustPresentationBindingIdentityR10 {
  return Object.freeze({
    ...binding,
    primaryContentRef: Object.freeze({ ...binding.primaryContentRef }),
    presentationCatalog: Object.freeze({
      ...binding.presentationCatalog,
      contentHash: Uint8Array.from(binding.presentationCatalog.contentHash),
    }),
    modelCatalog: Object.freeze({ ...binding.modelCatalog }),
  });
}

function finalizePresentationFrame(
  result: RenderEntityExtractionResultR10 & Readonly<{ machinePresentations: readonly RustMachinePresentationR10[] }>,
  pending: PreparedPresentationExtractionR10,
  coverageHash: string,
  presentations: AttestedRenderPresentationCatalogV1,
): RustPresentationEntityExtractionResultR10 {
  const byEntity = new Map(result.presentations.map((presentation) => [presentation.entityId, presentation] as const));
  const bindings: RustPresentationFrameR10["bindings"][number][] = [];
  for (const held of pending.heldPresentations) {
    const entity = byEntity.get(held.entityId);
    invariant(entity !== undefined && entity.class === "player", `held presentation '${held.id}' has no player entity`);
    const attachment = entity.equipment.find((equipment) => equipment.slotKey === RUST_HELD_PRESENTATION_SLOT_R10);
    invariant(attachment !== undefined && attachment.itemKey === held.itemId,
      `held presentation '${held.id}' has no exact equipment attachment`);
    bindings.push(Object.freeze({
      ...held,
      metadataHash: Uint8Array.from(held.metadataHash),
      binding: cloneBindingIdentity(held.binding),
      instanceIds: Object.freeze([...attachment.instanceIds]),
    }));
  }
  for (const dropped of pending.droppedPresentations) {
    const entity = byEntity.get(dropped.entityId);
    invariant(entity !== undefined && entity.class === "construct" && entity.kindKey === "dropped-item"
      && entity.modelKey === dropped.binding.modelId,
    `dropped presentation '${dropped.id}' has no exact BWR6 entity`);
    bindings.push(Object.freeze({
      ...dropped,
      binding: cloneBindingIdentity(dropped.binding),
      instanceIds: Object.freeze([...entity.instanceIds]),
    }));
  }
  for (const combat of pending.combatPresentations) {
    const entity = byEntity.get(combat.entityId);
    invariant(entity !== undefined && entity.class === (combat.role === "projectile" ? "projectile" : "creature")
      && entity.modelKey === combat.binding.modelId,
    `combat presentation '${combat.id}' has no exact BWR6 entity`);
    bindings.push(Object.freeze({
      ...combat,
      binding: cloneBindingIdentity(combat.binding),
      instanceIds: Object.freeze([...entity.instanceIds]),
    }));
  }
  for (const machine of result.machinePresentations) bindings.push(Object.freeze({
    ...machine,
    contentHash: Uint8Array.from(machine.contentHash),
    binding: cloneBindingIdentity(machine.binding),
    instanceIds: Object.freeze([...machine.instanceIds]),
  }));
  bindings.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  const allInstanceIds = new Set(result.frame.instances.map((instance) => instance.stableId));
  const bindingIds = new Set<string>();
  for (const binding of bindings) {
    invariant(!bindingIds.has(binding.id), `duplicate exact presentation binding '${binding.id}'`);
    bindingIds.add(binding.id);
    invariant(binding.instanceIds.every((id) => allInstanceIds.has(id)),
      `exact presentation binding '${binding.id}' references a missing frame instance`);
  }
  const boundProjectileEntities = new Set(bindings
    .filter((binding): binding is RustCombatPresentationR10 => binding.role === "projectile")
    .map((binding) => binding.entityId));
  const boundDropEntities = new Set(bindings
    .filter((binding): binding is RustDroppedPresentationR10 => binding.role === "dropped-item")
    .map((binding) => binding.entityId));
  const boundHeldEntities = new Set(bindings
    .filter((binding): binding is RustHeldPresentationR10 => binding.role === "held-item")
    .map((binding) => binding.entityId));
  const boundSummonEntities = new Set(bindings
    .filter((binding): binding is RustCombatPresentationR10 => binding.role === "summon")
    .map((binding) => binding.entityId));
  const summonModels = new Set(presentations.profileCatalog.profiles
    .filter((profile) => profile.role === "summon")
    .map((profile) => profile.model.id));
  const summonKinds = new Set(presentations.profileCatalog.profiles
    .filter((profile) => profile.role === "summon")
    .flatMap((profile) => profile.contentRefs)
    .filter((reference) => reference.domain === "creature-profile")
    .map((reference) => reference.id));
  for (const entity of result.presentations) {
    invariant(entity.class !== "vehicle", `vehicle entity ${entity.entityId} escaped its explicit presentation blocker`);
    if (entity.class === "projectile") invariant(boundProjectileEntities.has(entity.entityId),
      `projectile entity ${entity.entityId} has no exact presentation binding`);
    if (entity.class === "construct" && entity.kindKey === "dropped-item") invariant(boundDropEntities.has(entity.entityId),
      `dropped entity ${entity.entityId} has no exact presentation binding`);
    if (entity.class === "creature" && (summonModels.has(entity.modelKey) || summonKinds.has(entity.kindKey))) {
      invariant(boundSummonEntities.has(entity.entityId), `summon entity ${entity.entityId} has no exact presentation binding`);
    }
    if (entity.equipment.some((equipment) => equipment.slotKey === RUST_HELD_PRESENTATION_SLOT_R10)) {
      invariant(boundHeldEntities.has(entity.entityId), `held attachment for entity ${entity.entityId} has no exact presentation binding`);
    }
  }
  const boundMachineInstances = new Set(bindings
    .filter((binding): binding is RustMachinePresentationR10 => binding.role === "machine")
    .flatMap((binding) => binding.instanceIds));
  for (const instance of result.frame.instances) if (instance.domain === 5) invariant(boundMachineInstances.has(instance.stableId),
    `machine instance ${instance.stableId} has no exact presentation binding`);
  const presentationFrame: RustPresentationFrameR10 = Object.freeze({
    schema: 1,
    extractionRevision: result.extractionRevision,
    authorityTick: result.authorityTick,
    coverageHash,
    bindings: Object.freeze(bindings),
    heldBlockers: pending.heldBlockers,
    droppedBlockers: pending.droppedBlockers,
    machineBlockers: pending.machineBlockers,
    combatBlockers: pending.combatBlockers,
    runtimeBlockers: pending.runtimeBlockers,
  });
  return Object.freeze({ ...result, presentationFrame });
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

function droppedBlocker(
  status: "missing" | "unmapped",
  dropId: string,
  entityId: bigint,
  itemId: string,
  blockerId: string | null,
): RustDroppedPresentationBlockerR10 {
  return Object.freeze({
    id: `dropped-item:${status}:item:${itemId}:drop:${dropId}:entity:${entityId}${blockerId === null ? "" : `:${blockerId}`}`,
    status,
    dropId,
    entityId,
    itemId,
    blockerId,
  });
}

function droppedUnavailableBlocker(id: string, blockerId: string | null): RustDroppedPresentationBlockerR10 {
  return Object.freeze({
    id: `dropped-item:unavailable:${id}`,
    status: "unavailable",
    dropId: null,
    entityId: null,
    itemId: null,
    blockerId,
  });
}

function assertExactDroppedPresentation(
  row: RustDomainRowR10,
  profile: RenderPresentationProfileV1,
  contentIdentity: RustPresentationContentIdentityR10,
  record: RustEntityExtractionR6V3["records"][number],
) {
  invariant(exactString(row, "presentation.profileId") === profile.id,
    `R10 dropped item '${row.key}' presentation profile differs from the attested registry`);
  invariant(exactString(row, "presentation.modelId") === profile.model.id,
    `R10 dropped item '${row.key}' presentation model differs from the attested registry`);
  invariant(exactU32(row, "presentation.contentVersion", false) === contentIdentity.contentVersion,
    `R10 dropped item '${row.key}' presentation content version differs from the installed catalog`);
  invariant(equalBytes(exactHash(row, "presentation.contentHash"), contentIdentity.contentHash),
    `R10 dropped item '${row.key}' presentation content hash differs from the installed catalog`);
  invariant(record.modelKey === profile.model.id,
    `R10 dropped item '${row.key}' model key differs from its presentation profile`);
  invariant(record.modelRevision === contentIdentity.contentVersion,
    `R10 dropped item '${row.key}' BWR6 model revision differs from its presentation content`);
  invariant(equalBytes(record.modelHash, contentIdentity.contentHash),
    `R10 dropped item '${row.key}' BWR6 model hash differs from its presentation content`);
}

function combatBlocker(
  status: "missing" | "unmapped" | "unavailable",
  role: "projectile" | "summon" | null,
  recordId: string | null,
  entityId: bigint | null,
  contentId: string | null,
  presentationId: string | null,
  blockerId: string | null,
): RustCombatPresentationBlockerR10 {
  return Object.freeze({
    id: `combat:${status}:${role ?? "domain"}:${recordId ?? "none"}:${entityId ?? "none"}:${blockerId ?? "none"}`,
    status, role, recordId, entityId, contentId, presentationId, blockerId,
  });
}

function runtimeBlocker(
  family: RustPresentationRuntimeBlockerR10["family"],
  sourceId: string,
  entityId: bigint | null,
  blockerId: string,
): RustPresentationRuntimeBlockerR10 {
  return Object.freeze({
    id: `runtime:${family}:source:${sourceId}:entity:${entityId ?? "none"}:${blockerId}`,
    family,
    status: "unavailable",
    sourceId,
    entityId,
    blockerId,
  });
}

function residualPresentationBlockers(
  records: RustEntityExtractionR6V3["records"],
  presentations: AttestedRenderPresentationCatalogV1,
  joinedHeldEntities: ReadonlySet<bigint>,
  joinedDropEntities: ReadonlySet<bigint>,
  joinedCombatEntities: ReadonlySet<bigint>,
  reportUnjoinedPlayers: boolean,
) {
  const blockers: RustPresentationRuntimeBlockerR10[] = [];
  const blockedEntityIds = new Set<bigint>();
  const summonModels = new Set(presentations.profileCatalog.profiles
    .filter((profile) => profile.role === "summon")
    .map((profile) => profile.model.id));
  const summonKinds = new Set(presentations.profileCatalog.profiles
    .filter((profile) => profile.role === "summon")
    .flatMap((profile) => profile.contentRefs)
    .filter((reference) => reference.domain === "creature-profile")
    .map((reference) => reference.id));
  for (const record of records) {
    if (reportUnjoinedPlayers && record.class === "player" && !joinedHeldEntities.has(record.entityId)) {
      blockers.push(runtimeBlocker(
        "held-item", record.externalEntityId, record.entityId, "player-held-presentation-binding-not-exported",
      ));
    }
    if (record.class === "construct" && record.kindKey === "dropped-item"
      && !joinedDropEntities.has(record.entityId)) {
      blockedEntityIds.add(record.entityId);
      blockers.push(runtimeBlocker(
        "dropped-item", record.externalEntityId, record.entityId, "dropped-item-semantic-binding-row-missing",
      ));
    }
    if (record.class === "projectile" && !joinedCombatEntities.has(record.entityId)) {
      blockedEntityIds.add(record.entityId);
      blockers.push(runtimeBlocker(
        "projectile", record.externalEntityId, record.entityId, "projectile-semantic-binding-row-missing",
      ));
    }
    if (record.class === "creature" && (summonModels.has(record.modelKey) || summonKinds.has(record.kindKey))
      && !joinedCombatEntities.has(record.entityId)) {
      blockedEntityIds.add(record.entityId);
      blockers.push(runtimeBlocker(
        "summon", record.externalEntityId, record.entityId, "summon-semantic-binding-row-missing",
      ));
    }
    if (record.class === "vehicle") {
      blockedEntityIds.add(record.entityId);
      blockers.push(runtimeBlocker(
        "vehicle", record.externalEntityId, record.entityId, "vehicle-semantic-presentation-binding-not-exported",
      ));
    }
  }
  blockers.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  return Object.freeze({ blockedEntityIds, blockers: Object.freeze(blockers) });
}

function assertExactCombatPresentation(
  row: RustDomainRowR10,
  role: "projectile" | "summon",
  recordId: string,
  record: RustEntityExtractionR6V3["records"][number],
  presentations: AttestedRenderPresentationCatalogV1,
  contentIdentity: RustPresentationContentIdentityR10,
) {
  const expectedDomain = role === "projectile" ? "item" : "creature-profile";
  invariant(exactString(row, "presentation.role") === role,
    `R10 combat '${row.key}' presentation role is invalid`);
  invariant(exactString(row, "presentation.contentDomain") === expectedDomain,
    `R10 combat '${row.key}' primary content domain is invalid`);
  const contentId = exactString(row, "presentation.contentId");
  if (role === "summon") invariant(exactString(row, "contentId") === contentId,
    `R10 summon '${row.key}' content differs from its presentation primary ref`);
  const presentationId = exactString(row, "presentation.presentationId");
  const binding = presentations.registry.resolveProfileId(role, presentationId);
  invariant(binding.status === "exact", `R10 combat '${row.key}' suppresses a non-exact catalog binding`);
  invariant(binding.profile.contentRefs.some((reference) => reference.domain === expectedDomain && reference.id === contentId),
    `R10 combat '${row.key}' primary ref is absent from the exact profile`);
  if (role === "summon") invariant(binding.profile.contentRefs.some((reference) => reference.domain === "ability-spell"),
    `R10 summon '${row.key}' exact profile has no paired spell ref`);
  invariant(exactString(row, "presentation.status") === "exact"
    && exactString(row, "presentation.profileId") === binding.profile.id
    && binding.profile.id === presentationId,
  `R10 combat '${row.key}' exact profile identity differs from the attested registry`);
  invariant(exactString(row, "presentation.modelId") === binding.profile.model.id,
    `R10 combat '${row.key}' exact model differs from the attested registry`);
  invariant(exactU32(row, "presentation.contentVersion", false) === contentIdentity.contentVersion
    && equalBytes(exactHash(row, "presentation.contentHash"), contentIdentity.contentHash),
  `R10 combat '${row.key}' presentation content identity differs from the installed catalog`);
  invariant(record.externalEntityId === recordId,
    `R10 combat '${row.key}' external id differs from BWR6`);
  invariant(record.class === (role === "projectile" ? "projectile" : "creature"),
    `R10 combat '${row.key}' references a wrong-class BWR6 entity`);
  invariant(record.modelKey === binding.profile.model.id
    && record.modelRevision === contentIdentity.contentVersion
    && equalBytes(record.modelHash, contentIdentity.contentHash),
  `R10 combat '${row.key}' BWR6 identity differs from the exact profile`);
  return binding.profile;
}

function augmentPresentations(
  extraction: RustIntegratedRuntimeExtractionV1,
  presentations: AttestedRenderPresentationCatalogV1,
  presentationContent: RustPresentationContentIdentityR10,
): Omit<PreparedPresentationExtractionR10, "token"> {
  const decoded = decodeRustAuthoritativeExtractionR10(extraction);
  const registry = presentations.registry;
  let source = decoded.entities;
  let heldAttachments = 0;
  let droppedBindings = 0;
  let combatBindings = 0;
  const heldPresentations: PreparedHeldPresentationR10[] = [];
  const heldBlockers: RustHeldPresentationBlockerR10[] = [];
  const droppedPresentations: PreparedDroppedPresentationR10[] = [];
  const droppedBlockers: RustDroppedPresentationBlockerR10[] = [];
  const machines: PreparedMachinePresentationR10[] = [];
  const machineBlockers: RustMachinePresentationBlockerR10[] = [];
  const combatPresentations: PreparedCombatPresentationR10[] = [];
  const combatBlockers: RustCombatPresentationBlockerR10[] = [];
  const runtimeBlockers: RustPresentationRuntimeBlockerR10[] = [];
  const records = source === null ? null : [...source.records];
  const recordIndexes = new Map<bigint, number>();
  records?.forEach((record, index) => {
    invariant(!recordIndexes.has(record.entityId), "duplicate same-envelope BWR6 entity id");
    recordIndexes.set(record.entityId, index);
  });
  if (decoded.domains === null) {
    heldBlockers.push(unavailableBlocker("player-domain-envelope-absent", "domain-extraction-not-submitted"));
    droppedBlockers.push(droppedUnavailableBlocker("inventory-domain-envelope-absent", "domain-extraction-not-submitted"));
    machineBlockers.push(machineUnavailableBlocker("machine-domain-envelope-absent", "domain-extraction-not-submitted"));
    combatBlockers.push(combatBlocker("unavailable", null, null, null, null, null, "domain-extraction-not-submitted"));
    if (source !== null && records !== null) {
      const residual = residualPresentationBlockers(
        records, presentations, new Set(), new Set(), new Set(), false,
      );
      runtimeBlockers.push(...residual.blockers);
      const visibleRecords = Object.freeze(records.filter((record) => !residual.blockedEntityIds.has(record.entityId)));
      source = Object.freeze({
        ...source,
        total: visibleRecords.length + source.omitted,
        selected: visibleRecords.length,
        records: visibleRecords,
      });
    }
    return Object.freeze({
      renderBytes: Uint8Array.from(extraction.render), source, extractionRevision: decoded.extractionRevision,
      heldAttachments, heldPresentations: Object.freeze(heldPresentations), heldBlockers: Object.freeze(heldBlockers),
      droppedBindings, droppedPresentations: Object.freeze(droppedPresentations), droppedBlockers: Object.freeze(droppedBlockers),
      machines: Object.freeze(machines), machineBindings: 0, machineBlockers: Object.freeze(machineBlockers),
      combatBindings, combatPresentations: Object.freeze(combatPresentations), combatBlockers: Object.freeze(combatBlockers),
      runtimeBlockers: Object.freeze(runtimeBlockers),
    });
  }
  invariant(decoded.domains.contentReady, "R10 presentation content is not installed and attested");

  const joinedHeldEntities = new Set<bigint>();
  const playerView = decoded.domains.views.find((view) => view.domain === 2);
  invariant(playerView !== undefined, "R10 domain bundle has no player view");
  if (playerView.status !== "complete") {
    const blockerId = playerView.blockers.join(",");
    heldBlockers.push(unavailableBlocker(
      `player-domain-${playerView.status}:${blockerId}`,
      blockerId || null,
    ));
  } else {
    const bindingRows = playerView.rows.filter((row) => row.kind === 2);
    if (bindingRows.length > 0) invariant(records !== null, "R10 player bindings have no same-envelope BWR6 entity extraction");
    for (const row of bindingRows) {
      const playerId = exactU64(row, "playerId");
      invariant(row.key === `binding:${playerId}`, `R10 player binding '${row.key}' key does not match playerId`);
      const entityId = exactU64(row, "entityId");
      invariant(!joinedHeldEntities.has(entityId), `R10 entity ${entityId} has multiple player bindings`);
      joinedHeldEntities.add(entityId);
      const recordIndex = recordIndexes.get(entityId);
      invariant(recordIndex !== undefined && records !== null,
        `R10 player binding '${row.key}' references a missing BWR6 entity`);
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
      heldPresentations.push(Object.freeze({
        id: `held-item:entity:${entityId}:item:${held.itemId}:profile:${binding.profile.id}`,
        role: "held-item",
        playerId,
        entityId,
        itemId: held.itemId,
        count: held.count,
        durability: held.durability,
        durabilityPresent: held.durabilityPresent,
        metadataHash: Uint8Array.from(held.metadataHash),
        binding: exactBindingIdentity(
          "held-item",
          binding.profile,
          { domain: "item", id: held.itemId },
          presentations,
          presentationContent,
        ),
      }));
      heldAttachments += 1;
    }
  }

  const inventoryView = decoded.domains.views.find((view) => view.domain === 3);
  invariant(inventoryView !== undefined, "R10 domain bundle has no inventory view");
  const presentationOnlyBlockers = new Set([
    "dropped-item-presentation-missing",
    "dropped-item-presentation-unmapped",
  ]);
  const unavailable = inventoryView.blockers.filter((value) => !presentationOnlyBlockers.has(value));
  if (inventoryView.status === "absent" || unavailable.length > 0) {
    const blockerId = inventoryView.blockers.join(",");
    droppedBlockers.push(droppedUnavailableBlocker(
      `inventory-domain-${inventoryView.status}:${blockerId}`,
      blockerId || null,
    ));
  }
  const dropRows = inventoryView.rows.filter((row) => row.kind === 6);
  if (dropRows.length > 0) invariant(records !== null, "R10 dropped items have no same-envelope BWR6 entity extraction");
  const joinedDrops = new Set<string>();
  const joinedDropEntities = new Set<bigint>();
  const blockedDropEntities = new Set<bigint>();
  for (const row of dropRows) {
    const dropId = exactString(row, "dropId");
    invariant(row.key === `drop:${dropId}`, `R10 dropped item '${row.key}' key does not match dropId`);
    invariant(!joinedDrops.has(dropId), `R10 dropped item '${dropId}' is duplicated`);
    joinedDrops.add(dropId);
    const entityId = exactU64(row, "entityId");
    invariant(!joinedDropEntities.has(entityId), `R10 dropped-item entity ${entityId} is duplicated`);
    joinedDropEntities.add(entityId);
    const recordIndex = recordIndexes.get(entityId);
    invariant(recordIndex !== undefined && records !== null,
      `R10 dropped item '${row.key}' references a missing BWR6 entity`);
    const record = records[recordIndex];
    invariant(record.class === "construct" && record.kindKey === "dropped-item",
      `R10 dropped item '${row.key}' references a non-drop BWR6 entity`);
    invariant(exactU64(row, "entityRevision") === record.entityRevision,
      `R10 dropped item '${row.key}' entity revision differs from BWR6`);
    const itemId = String(exactU32(row, "stack.itemCode"));
    invariant(exactString(row, "presentation.role") === "dropped-item"
      && exactString(row, "presentation.contentDomain") === "item"
      && exactString(row, "presentation.contentId") === itemId,
    `R10 dropped item '${row.key}' presentation reference differs from custody`);
    const binding = registry.resolve("dropped-item", { domain: "item", id: itemId });
    const status = exactString(row, "presentation.status");
    if (binding.status === "exact") {
      invariant(status === "exact", `R10 dropped item '${row.key}' suppresses an exact presentation`);
      assertExactDroppedPresentation(row, binding.profile, presentationContent, record);
      droppedPresentations.push(Object.freeze({
        id: `dropped-item:drop:${dropId}:entity:${entityId}:profile:${binding.profile.id}`,
        role: "dropped-item",
        dropId,
        entityId,
        itemId,
        binding: exactBindingIdentity(
          "dropped-item",
          binding.profile,
          { domain: "item", id: itemId },
          presentations,
          presentationContent,
        ),
      }));
      droppedBindings += 1;
      continue;
    }
    invariant(record.modelKey === "unresolved:dropped-item" && record.modelRevision === 0
      && record.modelHash.every((value) => value === 0),
    `R10 dropped item '${row.key}' fabricated an unresolved BWR6 model identity`);
    if (binding.status === "missing") {
      invariant(status === "missing" && exactString(row, "presentation.blockerId") === binding.blocker.id,
        `R10 dropped item '${row.key}' missing blocker differs from the attested registry`);
      droppedBlockers.push(droppedBlocker("missing", dropId, entityId, itemId, binding.blocker.id));
      blockedDropEntities.add(entityId);
    } else {
      invariant(status === "unmapped" && optionalField(row, "presentation.blockerId") === undefined,
        `R10 dropped item '${row.key}' unmapped status is inconsistent`);
      droppedBlockers.push(droppedBlocker("unmapped", dropId, entityId, itemId, null));
      blockedDropEntities.add(entityId);
    }
  }

  const combatView = decoded.domains.views.find((view) => view.domain === 5);
  invariant(combatView !== undefined, "R10 domain bundle has no combat view");
  const presentationOnlyCombatBlockers = new Set([
    "combat-projectile-and-summon-render-presentation-not-authoritative",
    "combat-general-r7-r6-health-parity-not-authoritative",
    "combat-projectile-presentation-missing",
    "combat-projectile-presentation-unmapped",
    "combat-projectile-r6-link-missing",
    "combat-summon-presentation-missing",
    "combat-summon-presentation-unmapped",
    "combat-summon-r6-link-missing",
  ]);
  const blockedCombatEntities = new Set<bigint>();
  const joinedCombatEntities = new Set<bigint>();
  for (const row of combatView.rows.filter((candidate) => candidate.kind === 3 || candidate.kind === 5)) {
    const role = row.kind === 3 ? "projectile" as const : "summon" as const;
    const prefix = `${role}:`;
    invariant(row.key.startsWith(prefix) && row.key.length > prefix.length,
      `R10 combat row '${row.key}' has an invalid ${role} key`);
    const recordId = row.key.slice(prefix.length);
    invariant(exactString(row, "presentation.role") === role,
      `R10 combat '${row.key}' presentation role is invalid`);
    const status = exactString(row, "presentation.status");
    if (status === "unlinked") {
      const fallback = records?.find((record) => record.externalEntityId === recordId);
      if (fallback !== undefined) blockedCombatEntities.add(fallback.entityId);
      combatBlockers.push(combatBlocker(
        "unavailable", role, recordId, fallback?.entityId ?? null, null, null,
        exactString(row, "presentation.blockerId"),
      ));
      continue;
    }
    if (status === "invalid-link") {
      const entityId = exactU64(row, "entityId");
      if (recordIndexes.has(entityId)) blockedCombatEntities.add(entityId);
      combatBlockers.push(combatBlocker(
        "unavailable", role, recordId, entityId, optionalString(row, "presentation.contentId"),
        optionalString(row, "presentation.presentationId"),
        exactString(row, "presentation.blockerId"),
      ));
      continue;
    }
    invariant(status === "exact" || status === "missing" || status === "unmapped",
      `R10 combat '${row.key}' presentation status is invalid`);
    const entityId = exactU64(row, "entityId");
    invariant(!joinedCombatEntities.has(entityId), `R10 combat entity ${entityId} is duplicated`);
    joinedCombatEntities.add(entityId);
    const recordIndex = recordIndexes.get(entityId);
    invariant(recordIndex !== undefined && records !== null,
      `R10 combat '${row.key}' references a missing BWR6 entity`);
    const record = records[recordIndex];
    invariant(exactU64(row, "entityRevision") === record.entityRevision,
      `R10 combat '${row.key}' entity revision differs from BWR6`);
    const expectedDomain = role === "projectile" ? "item" : "creature-profile";
    invariant(exactString(row, "presentation.contentDomain") === expectedDomain,
      `R10 combat '${row.key}' primary content domain is invalid`);
    const contentId = exactString(row, "presentation.contentId");
    const presentationId = exactString(row, "presentation.presentationId");
    const binding = presentations.registry.resolveProfileId(role, presentationId);
    if (binding.status === "exact") {
      invariant(status === "exact", `R10 combat '${row.key}' suppresses an exact presentation`);
      const profile = assertExactCombatPresentation(
        row, role, recordId, record, presentations, presentationContent,
      );
      combatPresentations.push(Object.freeze({
        id: `${role}:record:${recordId}:entity:${entityId}:profile:${profile.id}`,
        role,
        recordId,
        entityId,
        contentId,
        binding: exactBindingIdentity(
          role,
          profile,
          { domain: expectedDomain, id: contentId },
          presentations,
          presentationContent,
        ),
      }));
      combatBindings += 1;
      continue;
    }
    invariant(record.modelKey === "unresolved:combat-presentation" && record.modelRevision === 0
      && record.modelHash.every((value) => value === 0),
    `R10 combat '${row.key}' used a creature or generic fallback for an unresolved presentation`);
    blockedCombatEntities.add(entityId);
    if (binding.status === "missing") {
      invariant(status === "missing" && exactString(row, "presentation.blockerId") === binding.blocker.id
        && binding.blocker.contentRefs.some((reference) => reference.domain === expectedDomain && reference.id === contentId),
      `R10 combat '${row.key}' missing blocker differs from the attested registry`);
      presentationOnlyCombatBlockers.add(binding.blocker.id);
      combatBlockers.push(combatBlocker(
        "missing", role, recordId, entityId, contentId, presentationId, binding.blocker.id,
      ));
    } else {
      invariant(status === "unmapped"
        && exactString(row, "presentation.blockerId") === `combat-${role}-presentation-unmapped`,
      `R10 combat '${row.key}' unmapped blocker is inconsistent`);
      combatBlockers.push(combatBlocker(
        "unmapped", role, recordId, entityId, contentId, presentationId,
        `combat-${role}-presentation-unmapped`,
      ));
    }
  }
  const unavailableCombat = combatView.blockers.filter((value) => !presentationOnlyCombatBlockers.has(value));
  if (combatView.status === "absent" || unavailableCombat.length > 0) {
    const blockerId = unavailableCombat.join(",");
    combatBlockers.push(combatBlocker(
      "unavailable", null, null, null, null, null, blockerId || "combat-domain-unavailable",
    ));
  }

  const machineView = decoded.domains.views.find((view) => view.domain === 4);
  invariant(machineView !== undefined, "R10 domain bundle has no machine view");
  const presentationOnlyMachineBlockers = new Set([
    "machine-presentation-missing",
    "machine-presentation-unmapped",
    "world-prop-presentation-not-authoritative",
  ]);
  const unavailableMachines = machineView.blockers.filter((value) => !presentationOnlyMachineBlockers.has(value));
  if (machineView.status === "absent" || unavailableMachines.length > 0) {
    const blockerId = machineView.blockers.join(",");
    machineBlockers.push(machineUnavailableBlocker(
      `machine-domain-${machineView.status}:${blockerId}`,
      blockerId || null,
    ));
  } else {
    const machineIds = new Set<string>();
    for (const row of machineView.rows.filter((candidate) => candidate.kind === 5)) {
      const machineId = exactMachineString(row, "machineId");
      invariant(!machineIds.has(machineId), `R10 machine anchor '${machineId}' is duplicated`);
      machineIds.add(machineId);
      const status = exactMachineString(row, "presentation.status");
      if (status === "exact") machines.push(parseExactMachine(row, presentations, presentationContent));
      else {
        invariant(status === "missing" || status === "unmapped",
          `R10 machine anchor '${row.key}' presentation status is invalid`);
        machineBlockers.push(validateBlockedMachine(row, presentations));
      }
    }
  }
  const residual = residualPresentationBlockers(
    records ?? Object.freeze([]), presentations, joinedHeldEntities, joinedDropEntities, joinedCombatEntities, true,
  );
  const blockedPresentationEntities = new Set<bigint>([
    ...blockedCombatEntities, ...blockedDropEntities, ...residual.blockedEntityIds,
  ]);
  runtimeBlockers.push(...residual.blockers);
  heldPresentations.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  heldBlockers.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  droppedPresentations.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  droppedBlockers.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  machines.sort((left, right) => compareCanonicalUtf8R10(left.machineId, right.machineId));
  machineBlockers.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  combatPresentations.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  combatBlockers.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  runtimeBlockers.sort((left, right) => compareCanonicalUtf8R10(left.id, right.id));
  if (source !== null && records !== null) {
    const visibleRecords = Object.freeze(records.filter((record) => !blockedPresentationEntities.has(record.entityId)));
    source = Object.freeze({
      ...source,
      total: visibleRecords.length + source.omitted,
      selected: visibleRecords.length,
      records: visibleRecords,
    });
  }
  return Object.freeze({
    renderBytes: Uint8Array.from(extraction.render),
    source,
    extractionRevision: decoded.extractionRevision,
    heldAttachments,
    heldPresentations: Object.freeze(heldPresentations),
    heldBlockers: Object.freeze(heldBlockers),
    droppedBindings,
    droppedPresentations: Object.freeze(droppedPresentations),
    droppedBlockers: Object.freeze(droppedBlockers),
    machines: Object.freeze(machines),
    machineBindings: machines.length,
    machineBlockers: Object.freeze(machineBlockers),
    combatBindings,
    combatPresentations: Object.freeze(combatPresentations),
    combatBlockers: Object.freeze(combatBlockers),
    runtimeBlockers: Object.freeze(runtimeBlockers),
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
  private pendingMachinePresentations: readonly RustMachinePresentationR10[] | null = null;
  private pendingPresentationFrame: RustPresentationFrameR10 | null = null;
  private pendingMachineResourceState: Readonly<{
    epoch: bigint;
    revision: bigint;
    emittedModelIds: ReadonlySet<string>;
  }> | null = null;
  private machineResourceEpoch: bigint | null = null;
  private machineResourceRevision = BigInt(0);
  private readonly emittedMachineModelIds = new Set<string>();
  private readonly maxInstances: number;
  private readonly maxResourceOperations: number;
  private readonly coverageHash: string;
  private lastDiagnostics: RustPresentationExtractionDiagnosticsR10;

  constructor(
    private readonly entityExtractor: RustEntityRenderExtractionR10,
    private readonly presentations: AttestedRenderPresentationCatalogV1,
    private readonly presentationContent: RustPresentationContentIdentityR10,
    limits: Readonly<{ maxInstances?: number; maxResourceOperations?: number }> = {},
  ) {
    invariant(Number.isSafeInteger(presentationContent.contentVersion) && presentationContent.contentVersion > 0
      && presentationContent.contentVersion <= Number(U32_MAX), "render presentation content version is invalid");
    invariant(presentationContent.contentHash.byteLength === 16
      && presentationContent.contentHash.some((value) => value !== 0), "render presentation content hash is invalid");
    this.coverageHash = createRenderPresentationCoverageInventoryR10(presentations.profileCatalog).coverageHash;
    this.maxInstances = limits.maxInstances ?? RENDER_MAX_INSTANCES_V2;
    this.maxResourceOperations = limits.maxResourceOperations ?? RENDER_MAX_RESOURCE_OPERATIONS_V2;
    invariant(Number.isInteger(this.maxInstances) && this.maxInstances > 0 && this.maxInstances <= RENDER_MAX_INSTANCES_V2,
      "presentation instance cap is invalid");
    invariant(Number.isInteger(this.maxResourceOperations) && this.maxResourceOperations > 0
      && this.maxResourceOperations <= RENDER_MAX_RESOURCE_OPERATIONS_V2,
    "presentation resource operation cap is invalid");
    this.lastDiagnostics = Object.freeze({
      schema: 1,
      extractionRevision: null,
      heldAttachments: 0,
      heldPresentations: Object.freeze([]),
      heldBlockers: Object.freeze([]),
      droppedBindings: 0,
      droppedPresentations: Object.freeze([]),
      droppedBlockers: Object.freeze([]),
      machineBindings: 0,
      machineBlockers: Object.freeze([]),
      machines: Object.freeze([]),
      combatBindings: 0,
      combatPresentations: Object.freeze([]),
      combatBlockers: Object.freeze([]),
      runtimeBlockers: Object.freeze([]),
      coverageHash: this.coverageHash,
    });
  }

  prepareRuntimeExtraction(extraction: RustIntegratedRuntimeExtractionV1) {
    invariant(this.pending === null, "a render presentation extraction is already prepared");
    const augmented = augmentPresentations(extraction, this.presentations, this.presentationContent);
    const token = Symbol("rust-presentation-extraction-r10");
    this.pending = Object.freeze({ ...augmented, token });
    return token;
  }

  finishPreparedRuntimeExtraction(token: symbol, accepted: boolean) {
    invariant(this.pending?.token === token, "render presentation extraction token does not match");
    if (accepted) {
      const bindings = this.pendingPresentationFrame?.bindings ?? Object.freeze([]);
      this.lastDiagnostics = Object.freeze({
        schema: 1,
        extractionRevision: this.pending.extractionRevision,
        heldAttachments: this.pending.heldAttachments,
        heldPresentations: Object.freeze(bindings.filter(
          (binding): binding is RustHeldPresentationR10 => binding.role === "held-item",
        )),
        heldBlockers: this.pending.heldBlockers,
        droppedBindings: this.pending.droppedBindings,
        droppedPresentations: Object.freeze(bindings.filter(
          (binding): binding is RustDroppedPresentationR10 => binding.role === "dropped-item",
        )),
        droppedBlockers: this.pending.droppedBlockers,
        machineBindings: this.pending.machineBindings,
        machineBlockers: this.pending.machineBlockers,
        machines: Object.freeze(bindings.filter(
          (binding): binding is RustMachinePresentationR10 => binding.role === "machine",
        )),
        combatBindings: this.pending.combatBindings,
        combatPresentations: Object.freeze(bindings.filter(
          (binding): binding is RustCombatPresentationR10 => binding.role === "projectile" || binding.role === "summon",
        )),
        combatBlockers: this.pending.combatBlockers,
        runtimeBlockers: this.pending.runtimeBlockers,
        coverageHash: this.coverageHash,
      });
    }
    if (accepted && this.pendingMachineResourceState !== null) {
      this.machineResourceEpoch = this.pendingMachineResourceState.epoch;
      this.machineResourceRevision = this.pendingMachineResourceState.revision;
      this.emittedMachineModelIds.clear();
      for (const modelId of this.pendingMachineResourceState.emittedModelIds) this.emittedMachineModelIds.add(modelId);
    }
    this.pending = null;
    this.pendingMachinePresentations = null;
    this.pendingPresentationFrame = null;
    this.pendingMachineResourceState = null;
  }

  extractBytes(bytes: Uint8Array | ArrayBuffer, context: RenderEntityFrameContextR10) {
    const pending = this.pending;
    invariant(pending !== null, "no same-envelope render presentation extraction is prepared");
    const actualBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    invariant(equalBytes(actualBytes, pending.renderBytes), "BWR6 bytes differ from the prepared Worker envelope");
    invariant(pending.source !== null, "prepared Worker envelope has no BWR6 entity extraction");
    invariant(this.pendingMachinePresentations === null, "prepared render presentation extraction was consumed twice");
    const epochChanged = this.machineResourceEpoch === null || context.epoch > this.machineResourceEpoch;
    invariant(this.machineResourceEpoch === null || context.epoch >= this.machineResourceEpoch,
      "stale machine presentation resource epoch");
    const emitted = epochChanged ? new Set<string>() : new Set(this.emittedMachineModelIds);
    const augmented = augmentMachineFrame(
      this.entityExtractor.extract(pending.source, context),
      pending.machines,
      this.presentations,
      epochChanged ? BigInt(0) : this.machineResourceRevision,
      emitted,
      this.maxInstances,
      this.maxResourceOperations,
    );
    for (const modelId of augmented.emittedMachineModelIds) emitted.add(modelId);
    const result = finalizePresentationFrame(augmented.result, pending, this.coverageHash, this.presentations);
    this.pendingMachinePresentations = result.machinePresentations;
    this.pendingPresentationFrame = result.presentationFrame;
    this.pendingMachineResourceState = Object.freeze({
      epoch: context.epoch,
      revision: augmented.resourceRevision,
      emittedModelIds: emitted,
    });
    return result;
  }

  resetRevisionGuard() {
    invariant(this.pending === null, "cannot reset entity revision guard during a prepared presentation join");
    this.entityExtractor.resetRevisionGuard();
  }

  resetResourceReplay() {
    invariant(this.pending === null, "cannot reset entity resources during a prepared presentation join");
    this.entityExtractor.resetResourceReplay();
    this.machineResourceEpoch = null;
    this.machineResourceRevision = BigInt(0);
    this.emittedMachineModelIds.clear();
  }

  diagnostics(): RustPresentationExtractionDiagnosticsR10 {
    return this.lastDiagnostics;
  }
}
