import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RustEngineToolError,
  createRustEngineSourceSnapshot,
  findRepositoryRoot,
  isDirectInvocation,
  sha256File,
  validatePublishedArtifacts,
} from "./rust-engine-common.mjs";
import {
  resolveManagedCanonicalAsset,
  resolveWorkOutputDirectory,
} from "./verify-rust-r5-player-browser.mjs";
import {
  acquireManagedBrowserGateMutex,
  installRustMultiplayerViteEnvironment,
  isExpectedLocalMusicCancellation,
  isExpectedManagedViteWebSocket,
  rustMultiplayerManagedViteInlineConfig,
  rustMultiplayerManagedViteWrapperSource,
  waitForRustMultiplayerPortRefusal,
  waitForRustMultiplayerVisualTerrainReadiness,
} from "./verify-rust-multiplayer-browser.mjs";

export const REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH = "6a70291bc1655b6a01436b25590d646f064212d20e807dbbfe409b88e8f2322f";
export const REQUIRED_TERRAIN_EDIT_SOURCE_DIGEST = "7a815caf45a4721aa5798c1d2509fd1a926e557b8cd853636b05470357318d19";
export const REQUIRED_TERRAIN_EDIT_SOURCE_FILE_COUNT = 230;
export const REQUIRED_TERRAIN_EDIT_WASM_SHA256 = "2283f2c4f6510f5d80f4c49874d34029a6e0c3cd36f3ab19a0957c2ee2f86687";
export const REQUIRED_TERRAIN_EDIT_WASM_BYTES = 7_424_470;
export const TERRAIN_EDIT_GENERATION_CERTIFICATE = Object.freeze({
  corpusCases: 155,
  corpusHash: "5d4e6b1445b00f3430164d1a8093d8dc",
});
export const TERRAIN_EDIT_WORLD_FIXTURE = Object.freeze({
  name: "Rust Terrain Edit Reload Acceptance",
  seed: "MOON-FIELD-505",
  mode: "survival",
});
export const TERRAIN_EDIT_TITLE_MENU_LABELS = Object.freeze([
  "Continue",
  "Create New World",
  "Worlds",
  "Characters",
  "Multiplayer",
  "How to Play",
  "Settings",
]);
export const TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES = 4;

const PROFILE_ROOT_NAME = ".terrain-edit-profile";
const PROFILE_PREFIX = "browser-";
const VITE_RUNTIME_PREFIX = ".terrain-edit-vite-";
const CHUNK_SIZE = 16;
const MIN_Y = -64;
const MAX_Y = 127;
const AIR_BLOCK_ID = 0;
const PLAYER_EYE_HEIGHT = 1.62;
const MAX_EDIT_ENTRIES = 16_384;
const MAX_AIM_ATTEMPTS = 30;
const DEFAULT_TIMEOUT_MILLISECONDS = 300_000;
export const TERRAIN_EDIT_ENGINE_DIRECTORIES = Object.freeze([
  "public/engine",
  "public/engine-locator-candidate",
]);
const MANAGED_CANONICAL_ASSET_URLS = Object.freeze([
  "https://blockwild.app/manifest.webmanifest",
  "https://blockwild.app/brand/blockwild-icon-16.png",
  "https://blockwild.app/brand/blockwild-icon-32.png",
  "https://blockwild.app/brand/blockwild-icon-64.png",
  "https://blockwild.app/brand/blockwild-icon-192.png",
  "https://blockwild.app/brand/blockwild-icon-512.png",
]);
const SAFE_SINGLE_CELL_TERRAIN_NAMES = new Set([
  "Grass",
  "Dirt",
  "Stone",
  "Sand",
  "Snowy Grass",
  "Snow",
  "Red Sand",
  "Clay",
  "Mud",
  "Swamp Grass",
  "Savanna Grass",
  "Sunstep Grass",
  "Meadow Grass",
  "Jungle Grass",
  "Sakura Grass",
  "Sugar Soil",
  "Cobblestone",
  "Gravel",
  "Moss",
  "Basalt",
  "Deepstone",
  "Wildwood Shelf",
]);

function fail(message, details) {
  throw new RustEngineToolError(message, details);
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function finite(value, label) {
  assertCondition(typeof value === "number" && Number.isFinite(value), `${label} must be finite.`);
  return value;
}

function integer(value, label) {
  assertCondition(Number.isSafeInteger(value), `${label} must be a safe integer.`);
  return value;
}

function pathIsInside(parentDirectory, candidatePath) {
  const relation = path.relative(parentDirectory, candidatePath);
  return relation.length > 0
    && relation !== ".."
    && !relation.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relation);
}

function relativeEvidencePath(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
}

function boundedPush(target, value, maximum = 512) {
  target.push(Object.freeze(value));
  while (target.length > maximum) target.shift();
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Map a world coordinate to the exact compatibility-save chunk/index address. */
export function terrainEditAddress(coordinate) {
  assertCondition(Array.isArray(coordinate) && coordinate.length === 3,
    "Terrain edit coordinate must be an [x,y,z] tuple.");
  const [x, y, z] = coordinate.map((value, index) => integer(value, `Terrain edit coordinate[${index}]`));
  assertCondition(y >= MIN_Y && y <= MAX_Y, `Terrain edit y ${y} is outside ${MIN_Y}..${MAX_Y}.`);
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkZ = Math.floor(z / CHUNK_SIZE);
  const localX = x - chunkX * CHUNK_SIZE;
  const localZ = z - chunkZ * CHUNK_SIZE;
  const index = localX + localZ * CHUNK_SIZE + (y - MIN_Y) * CHUNK_SIZE * CHUNK_SIZE;
  return Object.freeze({
    coordinate: Object.freeze([x, y, z]),
    chunkX,
    chunkZ,
    localX,
    localZ,
    chunkKey: `${chunkX},${chunkZ}`,
    index,
  });
}

function normalizedEditEntries(edits) {
  assertCondition(edits && typeof edits === "object" && !Array.isArray(edits),
    "Saved world edits must be an object.");
  const normalized = [];
  for (const [chunkKey, entries] of Object.entries(edits)) {
    assertCondition(/^-?[0-9]+,-?[0-9]+$/u.test(chunkKey), `Saved edit chunk key is invalid: ${chunkKey}.`);
    assertCondition(Array.isArray(entries), `Saved edit chunk ${chunkKey} must contain an array.`);
    const seen = new Set();
    for (const [ordinal, entry] of entries.entries()) {
      assertCondition(Array.isArray(entry) && entry.length === 2,
        `Saved edit ${chunkKey}[${ordinal}] must be an [index,type] pair.`);
      const index = integer(entry[0], `Saved edit ${chunkKey}[${ordinal}] index`);
      const type = integer(entry[1], `Saved edit ${chunkKey}[${ordinal}] type`);
      assertCondition(index >= 0 && index < CHUNK_SIZE * CHUNK_SIZE * (MAX_Y - MIN_Y + 1),
        `Saved edit ${chunkKey}[${ordinal}] index is outside the world volume.`);
      assertCondition(type >= 0 && type <= 0xffff, `Saved edit ${chunkKey}[${ordinal}] type is not u16.`);
      assertCondition(!seen.has(index), `Saved edit ${chunkKey} contains duplicate index ${index}.`);
      seen.add(index);
      normalized.push(Object.freeze({ chunkKey, index, type }));
      assertCondition(normalized.length <= MAX_EDIT_ENTRIES,
        `Saved world contains more than ${MAX_EDIT_ENTRIES} edit entries.`);
    }
  }
  normalized.sort((left, right) => left.chunkKey.localeCompare(right.chunkKey, "en", { numeric: true })
    || left.index - right.index || left.type - right.type);
  return Object.freeze(normalized);
}

export function canonicalSavedEdits(storageSnapshot) {
  const edits = storageSnapshot?.save?.edits;
  const entries = normalizedEditEntries(edits);
  const canonicalJson = JSON.stringify(entries.map((entry) => [entry.chunkKey, entry.index, entry.type]));
  return Object.freeze({
    entries,
    count: entries.length,
    sha256: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
  });
}

export function savedEditAt(storageSnapshot, coordinate) {
  const address = terrainEditAddress(coordinate);
  const matches = normalizedEditEntries(storageSnapshot?.save?.edits)
    .filter((entry) => entry.chunkKey === address.chunkKey && entry.index === address.index);
  assertCondition(matches.length <= 1,
    `Saved edit address ${address.chunkKey}/${address.index} is ambiguous.`);
  return Object.freeze({
    address,
    found: matches.length === 1,
    type: matches[0]?.type ?? null,
  });
}

function poseFromState(state, label) {
  const position = state?.player?.position;
  assertCondition(Array.isArray(position) && position.length === 3, `${label} player position is absent.`);
  return Object.freeze({
    position: Object.freeze(position.map((value, index) => finite(value, `${label} position[${index}]`))),
    yaw: finite(state?.player?.yaw, `${label} yaw`),
    pitch: finite(state?.player?.pitch, `${label} pitch`),
  });
}

function directionFromPose(pose) {
  const cosine = Math.cos(pose.pitch);
  return Object.freeze([
    -Math.sin(pose.yaw) * cosine,
    Math.sin(pose.pitch),
    -Math.cos(pose.yaw) * cosine,
  ]);
}

function rayCellInterval(origin, direction, coordinate) {
  let entry = -Infinity;
  let exit = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = coordinate[axis] - 0.5;
    const maximum = coordinate[axis] + 0.5;
    if (Math.abs(direction[axis]) <= 1e-12) {
      if (origin[axis] < minimum || origin[axis] > maximum) return null;
      continue;
    }
    const first = (minimum - origin[axis]) / direction[axis];
    const second = (maximum - origin[axis]) / direction[axis];
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }
  if (exit < Math.max(0, entry)) return null;
  return Object.freeze({ entry: Math.max(0, entry), exit, span: exit - Math.max(0, entry) });
}

/**
 * Recreate the production voxel DDA from the rounded public pose. This is used
 * only as a conservative selection/proof gate; failing the approximation does
 * not mutate or probe the world through an internal API.
 */
export function terrainRayCells(state, reach = 6) {
  const pose = poseFromState(state, "Terrain ray");
  assertCondition(reach > 0 && reach <= 6, "Terrain ray reach must be in (0,6].");
  const direction = directionFromPose(pose);
  const origin = Object.freeze([
    pose.position[0],
    pose.position[1] + PLAYER_EYE_HEIGHT,
    pose.position[2],
  ]);
  const shifted = origin.map((value) => value + 0.5);
  let x = Math.floor(shifted[0]);
  let y = Math.floor(shifted[1]);
  let z = Math.floor(shifted[2]);
  const steps = direction.map((value) => value >= 0 ? 1 : -1);
  const deltas = direction.map((value) => value === 0 ? Infinity : Math.abs(1 / value));
  const maxima = direction.map((value, axis) => value === 0
    ? Infinity
    : ((Math.floor(shifted[axis]) + (steps[axis] > 0 ? 1 : 0)) - shifted[axis]) / value);
  let distance = 0;
  const cells = [];
  while (distance <= reach && cells.length < 128) {
    cells.push(Object.freeze([x, y, z]));
    if (maxima[0] < maxima[1] && maxima[0] < maxima[2]) {
      x += steps[0]; distance = maxima[0]; maxima[0] += deltas[0];
    } else if (maxima[1] < maxima[2]) {
      y += steps[1]; distance = maxima[1]; maxima[1] += deltas[1];
    } else {
      z += steps[2]; distance = maxima[2]; maxima[2] += deltas[2];
    }
  }
  return Object.freeze({ pose, origin, direction, cells: Object.freeze(cells) });
}

export function selectTerrainBreakTarget(snapshot) {
  const state = snapshot?.state;
  const target = state?.target;
  if (state?.state !== "playing" || target?.type !== "block"
    || !SAFE_SINGLE_CELL_TERRAIN_NAMES.has(target.name)
    || !Array.isArray(target.position) || target.position.length !== 3
    || !target.position.every(Number.isSafeInteger)) return null;
  let address;
  try { address = terrainEditAddress(target.position); }
  catch { return null; }
  const ray = terrainRayCells(state);
  const ordinal = ray.cells.findIndex((cell) => cell.every((value, index) => value === target.position[index]));
  if (ordinal < 1) return null;
  const horizontalDistance = Math.hypot(
    target.position[0] - ray.pose.position[0],
    target.position[2] - ray.pose.position[2],
  );
  if (horizontalDistance < 1.15) return null;
  const interval = rayCellInterval(ray.origin, ray.direction, target.position);
  if (!interval || interval.span < 0.18 || interval.entry > 6) return null;
  return Object.freeze({
    name: target.name,
    position: Object.freeze([...target.position]),
    address,
    pose: ray.pose,
    rayOrdinal: ordinal,
    rayCellSpan: interval.span,
    rayEntryDistance: interval.entry,
  });
}

export function proveReloadedTerrainRay(beforeEditSnapshot, continuedSnapshot, coordinate) {
  const beforePose = poseFromState(beforeEditSnapshot?.state, "Pre-edit");
  const afterPose = poseFromState(continuedSnapshot?.state, "Reloaded");
  assertCondition(JSON.stringify(beforePose) === JSON.stringify(afterPose),
    `Fresh Continue changed the exact rounded player pose: before=${JSON.stringify(beforePose)} after=${JSON.stringify(afterPose)}.`);
  const ray = terrainRayCells(continuedSnapshot.state);
  const ordinal = ray.cells.findIndex((cell) => cell.every((value, index) => value === coordinate[index]));
  assertCondition(ordinal >= 0, "Reloaded viewing ray no longer traverses the edited coordinate.");
  const target = continuedSnapshot?.state?.target;
  const retargetedSameCell = target?.type === "block"
    && Array.isArray(target.position)
    && target.position.every((value, index) => value === coordinate[index]);
  assertCondition(!retargetedSameCell, "Reloaded world still targets the supposedly broken coordinate as a solid block.");
  let nextTargetOrdinal = null;
  if (target?.type === "block" && Array.isArray(target.position) && target.position.length === 3) {
    nextTargetOrdinal = ray.cells.findIndex((cell) => cell.every((value, index) => value === target.position[index]));
    assertCondition(nextTargetOrdinal > ordinal,
      "Reloaded target is not geometrically behind the broken coordinate on the identical ray.");
  }
  return Object.freeze({
    exactRoundedPosePreserved: true,
    editedCoordinateRayOrdinal: ordinal,
    reloadedTarget: cloneJson(target ?? null),
    reloadedTargetRayOrdinal: nextTargetOrdinal,
    originalCellNotRetargeted: true,
  });
}

export function assertTerrainEditPersistenceEvidence({
  beforeEdit,
  afterGesture,
  titleAfterSave,
  titleAfterReload,
  continued,
  selection,
}) {
  assertCondition(selection && Array.isArray(selection.position), "Terrain edit selection evidence is absent.");
  const coordinate = selection.position;
  const beforeEdits = beforeEdit?.state?.performance?.streaming?.playerEdits;
  const afterEdits = afterGesture?.state?.performance?.streaming?.playerEdits;
  const canonicalBeforeMining = canonicalSavedEdits(beforeEdit?.storage);
  assertCondition(beforeEdits?.total === 0 && beforeEdits?.byKind?.break === 0,
    "Terrain edit gate did not begin from edit-neutral diagnostics.");
  assertCondition(canonicalBeforeMining.count === 0,
    `Terrain edit gate had ${canonicalBeforeMining.count} canonical saved edit(s) immediately before mining.`);
  assertCondition(afterEdits?.total === 1 && afterEdits?.byKind?.break === 1
    && afterEdits?.byKind?.place === 0 && afterEdits?.byKind?.["tree-fell"] === 0,
  "Trusted player gesture did not produce exactly one single-cell break diagnostic.");
  assertCondition(afterEdits?.last?.kind === "break" && afterEdits?.last?.pendingConsolidations === 0
    && afterEdits?.pendingConsolidationTransactions === 0,
  "Terrain break did not reach a settled presentation/consolidation state.");
  assertCondition((afterEdits?.mutationToLocalMeshVisible?.count ?? 0) === 1,
    "Terrain break never produced one local visible mesh update.");

  const saved = [titleAfterSave, titleAfterReload, continued].map((snapshot, index) => {
    const phase = ["Save & Quit", "fresh page reload", "fresh Continue"][index];
    assertCondition(snapshot?.storage?.activeWorldId === beforeEdit?.storage?.activeWorldId,
      `${phase} changed the dedicated active world id.`);
    assertCondition(snapshot?.storage?.save?.seed === TERRAIN_EDIT_WORLD_FIXTURE.seed,
      `${phase} changed the deterministic world seed.`);
    assertCondition(snapshot?.storage?.save?.mode === TERRAIN_EDIT_WORLD_FIXTURE.mode,
      `${phase} changed the deterministic world mode.`);
    const edit = savedEditAt(snapshot.storage, coordinate);
    assertCondition(edit.found && edit.type === AIR_BLOCK_ID,
      `${phase} did not retain Air at ${edit.address.chunkKey}/${edit.address.index}.`);
    const canonical = canonicalSavedEdits(snapshot.storage);
    assertCondition(canonical.count === 1,
      `${phase} retained ${canonical.count} canonical saved edits instead of exactly one.`);
    return Object.freeze({ phase, edit, canonical });
  });
  assertCondition(saved.every((entry) => entry.canonical.sha256 === saved[0].canonical.sha256
      && entry.canonical.count === saved[0].canonical.count),
  "Canonical player-edit bytes changed across save, page reload, or Continue.");
  const rayProof = proveReloadedTerrainRay(beforeEdit, continued, coordinate);
  return Object.freeze({
    coordinate: Object.freeze([...coordinate]),
    address: selection.address,
    replacementBlockId: AIR_BLOCK_ID,
    editDiagnostics: cloneJson(afterEdits),
    canonicalBeforeMining,
    canonicalEditCount: saved[0].canonical.count,
    canonicalEditSha256: saved[0].canonical.sha256,
    phases: Object.freeze(saved),
    rayProof,
  });
}

export function assertTerrainEditBrowserErrorStreams(streams) {
  for (const key of [
    "consoleErrors", "pageErrors", "runtimeErrors", "routeErrors", "httpErrors",
    "requestFailures", "externalRequests", "webSockets",
  ]) assertCondition(Array.isArray(streams?.[key]), `Browser error stream ${key} must be an array.`);
  for (const key of [
    "consoleErrors", "pageErrors", "runtimeErrors", "routeErrors", "httpErrors",
    "requestFailures", "externalRequests", "webSockets",
  ]) assertCondition(streams[key].length === 0, `${key} contains ${streams[key].length} error(s).`);
  return true;
}

function assertVisibleTitleElement(element, label) {
  assertCondition(element && typeof element === "object", `${label} visual evidence is absent.`);
  assertCondition(element.visible === true, `${label} is not visibly rendered.`);
  assertCondition(element.inViewport === true, `${label} is outside the retained viewport.`);
  assertCondition(element.unoccluded === true, `${label} is obscured in the retained viewport.`);
  assertCondition(element.bounds && typeof element.bounds === "object", `${label} bounds are absent.`);
  const width = finite(element.bounds.width, `${label} width`);
  const height = finite(element.bounds.height, `${label} height`);
  assertCondition(width >= 1 && height >= 1, `${label} has no painted bounds.`);
}

function assertTerrainEditTitleVisualObservation(observation, ordinal) {
  const prefix = `Post-reload title observation ${ordinal}`;
  assertCondition(observation && typeof observation === "object", `${prefix} is absent.`);
  assertCondition(observation.documentVisibility === "visible", `${prefix} document is not visible.`);
  assertCondition(observation.fontsStatus === "loaded", `${prefix} fonts are not loaded.`);
  assertVisibleTitleElement(observation.overlay, `${prefix} overlay`);
  assertVisibleTitleElement(observation.menu, `${prefix} main menu`);
  assertCondition(observation.logo?.text === "BLOCKWILD", `${prefix} title logo is incomplete.`);
  assertVisibleTitleElement(observation.logo, `${prefix} title logo`);
  assertCondition(Array.isArray(observation.buttons), `${prefix} buttons are absent.`);
  assertCondition(observation.buttons.length === TERRAIN_EDIT_TITLE_MENU_LABELS.length,
    `${prefix} rendered ${observation.buttons.length} title choices instead of ${TERRAIN_EDIT_TITLE_MENU_LABELS.length}.`);
  assertCondition(JSON.stringify(observation.buttons.map((button) => button.label))
    === JSON.stringify(TERRAIN_EDIT_TITLE_MENU_LABELS), `${prefix} title choice labels or order are incomplete.`);
  for (const [index, button] of observation.buttons.entries()) {
    const label = TERRAIN_EDIT_TITLE_MENU_LABELS[index];
    assertCondition(button.label === label, `${prefix} choice ${index} is not ${label}.`);
    assertVisibleTitleElement(button.button, `${prefix} ${label} button`);
    assertVisibleTitleElement(button.text, `${prefix} ${label} text`);
    assertCondition(button.text?.fontReady === true, `${prefix} ${label} font is not ready.`);
    assertCondition(button.text?.colorVisible === true, `${prefix} ${label} text color is transparent.`);
    assertCondition(button.activeAnimations === 0, `${prefix} ${label} is still animating.`);
    assertCondition(button.disabled === false, `${prefix} ${label} is disabled.`);
  }
}

function terrainEditTitleVisualSignature(observation) {
  const visual = (element) => [
    element?.visible,
    element?.inViewport,
    element?.unoccluded,
    element?.bounds?.x,
    element?.bounds?.y,
    element?.bounds?.width,
    element?.bounds?.height,
  ];
  return JSON.stringify({
    documentVisibility: observation?.documentVisibility,
    fontsStatus: observation?.fontsStatus,
    overlay: visual(observation?.overlay),
    menu: visual(observation?.menu),
    logo: [observation?.logo?.text, ...visual(observation?.logo)],
    buttons: observation?.buttons?.map((button) => [
      button.label,
      button.disabled,
      button.activeAnimations,
      ...visual(button.button),
      ...visual(button.text),
      button.text?.fontReady,
      button.text?.colorVisible,
    ]),
  });
}

/**
 * Fail closed unless the complete post-reload main menu has remained visibly
 * painted for several identical compositor observations. Accessibility text or
 * one enabled Continue button alone is deliberately insufficient evidence.
 */
export function assertTerrainEditReloadTitleVisualReadiness(evidence) {
  assertCondition(evidence?.schema === 1, "Post-reload title visual evidence schema is not 1.");
  assertCondition(Array.isArray(evidence.samples), "Post-reload title visual samples are absent.");
  assertCondition(evidence.samples.length >= TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES,
    `Post-reload title produced ${evidence.samples.length} stable visual sample(s) instead of ${TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES}.`);
  const samples = evidence.samples.slice(-TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES);
  for (const [index, observation] of samples.entries()) {
    assertTerrainEditTitleVisualObservation(observation, index + 1);
  }
  const signatures = samples.map(terrainEditTitleVisualSignature);
  assertCondition(signatures.every((signature) => signature === signatures[0]),
    "Post-reload title menu did not remain visually stable across compositor observations.");
  return Object.freeze({
    ...evidence,
    samples: Object.freeze(samples.map((sample) => Object.freeze(cloneJson(sample)))),
    expectedLabels: TERRAIN_EDIT_TITLE_MENU_LABELS,
    stableSamples: TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES,
  });
}

export function assertTerrainEditCleanupEvidence(cleanup) {
  for (const key of [
    "browserStarted", "browserClosed", "browserDisconnected", "serverStarted", "serverClosed",
    "serverPortRefused", "environmentRestored", "profileRemoved", "profileRootRemoved",
    "databasePathsRemoved", "viteRuntimeRemoved", "candidateUnchanged", "eventsDrained",
    "browserMutexReleased",
  ]) assertCondition(cleanup?.[key] === true, `Cleanup evidence ${key} is not true.`);
  assertCondition(Array.isArray(cleanup?.trackedChildPids)
    && cleanup.trackedChildPids.every((pid) => Number.isSafeInteger(pid) && pid > 0),
  "Cleanup tracked child PIDs are malformed.");
  assertCondition(Array.isArray(cleanup?.aliveChildPidsAfterCleanup)
    && cleanup.aliveChildPidsAfterCleanup.length === 0,
  "A verifier-owned browser process remains alive.");
  assertCondition(Array.isArray(cleanup?.databasePathsAfterCleanup)
    && cleanup.databasePathsAfterCleanup.length === 0,
  "A verifier-owned browser database path remains after cleanup.");
  return true;
}

export async function acquireTerrainEditBrowserMutex(repositoryRoot, options = {}) {
  return acquireManagedBrowserGateMutex(repositoryRoot, options);
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function terrainEditEngineRelativeDirectory(repositoryRoot, requestedDirectory) {
  const selected = path.resolve(repositoryRoot, requestedDirectory);
  const relative = TERRAIN_EDIT_ENGINE_DIRECTORIES.find((directory) =>
    comparablePath(selected) === comparablePath(path.resolve(repositoryRoot, directory)));
  if (!relative) fail(`Selected engine directory must resolve exactly to ${TERRAIN_EDIT_ENGINE_DIRECTORIES.join(" or ")}.`);
  return relative;
}

/** Canonical publication may retain renderer-lab; an isolated index stays single-artifact. */
export function assertTerrainEditEngineIndex(index, relativeDirectory) {
  if (!TERRAIN_EDIT_ENGINE_DIRECTORIES.includes(relativeDirectory)) fail("Unknown terrain-edit engine root.");
  const variants = Object.keys(index?.artifacts ?? {});
  const allowed = relativeDirectory === "public/engine" ? ["compatibility", "renderer-lab"] : ["compatibility"];
  if (index?.defaultVariant !== "compatibility" || !variants.includes("compatibility")
    || variants.some((variant) => !allowed.includes(variant))) {
    fail(relativeDirectory === "public/engine"
      ? "Canonical engine index must default to compatibility and may only also contain renderer-lab."
      : "Isolated engine index must contain only the default compatibility artifact.");
  }
  return true;
}

function parseRawOptions(argv) {
  const definitions = new Map([
    ["repo-root", "string"],
    ["engine-dir", "string"],
    ["expected-artifact-hash", "string"],
    ["output", "string"],
    ["timeout-ms", "integer"],
    ["playwright-module", "string"],
    ["browser-executable", "string"],
    ["headed", "boolean"],
    ["help", "boolean"],
  ]);
  const parsed = Object.create(null);
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}.`);
    const key = token.slice(2);
    const type = definitions.get(key);
    if (!type) fail(`Unknown option: ${token}.`);
    if (Object.hasOwn(parsed, key)) fail(`${token} may only be provided once.`);
    if (type === "boolean") {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value.`);
    if (type === "integer") {
      if (!/^[0-9]+$/u.test(value)) fail(`${token} requires a base-10 integer.`);
      parsed[key] = Number(value);
    } else parsed[key] = value;
    index += 1;
  }
  return parsed;
}

export function parseTerrainEditBrowserOptions(argv = process.argv, context = {}) {
  const raw = parseRawOptions(argv);
  const repositoryRoot = raw["repo-root"]
    ? findRepositoryRoot(path.resolve(context.cwd ?? process.cwd(), raw["repo-root"]))
    : findRepositoryRoot(context.cwd ?? process.cwd());
  if (raw.help) return Object.freeze({ help: true, repositoryRoot: realpathSync(repositoryRoot) });
  if (raw["expected-artifact-hash"] !== REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH) {
    fail(`Terrain edit acceptance requires exact artifact ${REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH}.`);
  }
  if (typeof raw["engine-dir"] !== "string" || raw["engine-dir"].trim() === "") {
    fail(`--engine-dir is required and must explicitly select ${TERRAIN_EDIT_ENGINE_DIRECTORIES.join(" or ")}.`);
  }
  const engineDirectory = path.resolve(repositoryRoot, raw["engine-dir"]);
  terrainEditEngineRelativeDirectory(repositoryRoot, engineDirectory);
  const timeoutMilliseconds = raw["timeout-ms"] ?? DEFAULT_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 60_000 || timeoutMilliseconds > 900_000) {
    fail("--timeout-ms must be an integer from 60000 through 900000.");
  }
  return Object.freeze({
    help: false,
    repositoryRoot: realpathSync(repositoryRoot),
    engineDirectory,
    expectedArtifactHash: REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH,
    outputDirectory: resolveWorkOutputDirectory(repositoryRoot, raw.output),
    timeoutMilliseconds,
    playwrightModule: raw["playwright-module"] ? path.resolve(repositoryRoot, raw["playwright-module"]) : null,
    browserExecutable: raw["browser-executable"] ? path.resolve(repositoryRoot, raw["browser-executable"]) : null,
    headless: raw.headed !== true,
  });
}

function assertNonSymlinkTree(rootDirectory, label) {
  const root = lstatSync(rootDirectory);
  if (root.isSymbolicLink() || !root.isDirectory()) fail(`${label} must be a non-symlink directory: ${rootDirectory}.`);
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) fail(`${label} must not contain symlinks: ${absolute}.`);
      if (metadata.isDirectory()) visit(absolute);
      else if (!metadata.isFile()) fail(`${label} contains an unsupported entry: ${absolute}.`);
    }
  };
  visit(rootDirectory);
}

function immutableTreeSnapshot(rootDirectory) {
  const entries = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) fail(`Selected engine tree changed to include a symlink: ${absolute}.`);
      if (metadata.isDirectory()) {
        entries.push({ kind: "directory", relative });
        visit(absolute, relative);
      } else if (metadata.isFile()) {
        entries.push({ kind: "file", relative, bytes: metadata.size, sha256: sha256File(absolute) });
      } else fail(`Selected engine tree contains an unsupported entry: ${absolute}.`);
    }
  };
  visit(rootDirectory);
  const digest = createHash("sha256");
  digest.update("blockwild-rust-terrain-edit-candidate-v1\n", "utf8");
  for (const entry of entries) {
    digest.update(`${entry.kind}\0${entry.relative}\0${entry.sha256 ?? ""}\0${entry.bytes ?? ""}\n`, "utf8");
  }
  return Object.freeze({
    digest: digest.digest("hex"),
    fileCount: entries.filter((entry) => entry.kind === "file").length,
    directoryCount: entries.filter((entry) => entry.kind === "directory").length,
  });
}

function canonicalCandidateFile(filePath, contentType, immutable) {
  const canonical = realpathSync(filePath);
  const metadata = lstatSync(canonical);
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail(`Candidate route is not a regular file: ${filePath}.`);
  return Object.freeze({
    filePath: canonical,
    contentType,
    immutable,
    bytes: metadata.size,
    sha256: sha256File(canonical),
  });
}

/** Historical API name retained; selection now covers canonical or isolated packages. */
export function selectTerrainEditCandidate(repositoryRoot, requestedDirectory, expectedArtifactHash) {
  if (expectedArtifactHash !== REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH) {
    fail(`Terrain edit acceptance requires exact artifact ${REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH}.`);
  }
  const lexicalRoot = path.resolve(repositoryRoot);
  const canonicalRoot = realpathSync(lexicalRoot);
  const publicRoot = path.join(lexicalRoot, "public");
  if (!existsSync(publicRoot) || lstatSync(publicRoot).isSymbolicLink() || !statSync(publicRoot).isDirectory()) {
    fail(`Repository public root must be a non-symlink directory: ${publicRoot}.`);
  }
  const canonicalPublic = realpathSync(publicRoot);
  const selectedLexicalDirectory = path.resolve(lexicalRoot, requestedDirectory);
  const relativeDirectory = terrainEditEngineRelativeDirectory(lexicalRoot, selectedLexicalDirectory);
  if (!existsSync(selectedLexicalDirectory)) fail(`Selected engine directory is missing: ${selectedLexicalDirectory}.`);
  assertNonSymlinkTree(selectedLexicalDirectory, "Selected terrain-edit engine tree");
  const selectedDirectory = realpathSync(selectedLexicalDirectory);
  if (!pathIsInside(canonicalPublic, selectedDirectory)) fail("Selected engine directory resolves outside public/.");
  const verification = validatePublishedArtifacts(selectedDirectory);
  assertTerrainEditEngineIndex(verification.index, relativeDirectory);
  const artifact = verification.artifacts.find((entry) => entry.variant === "compatibility");
  if (!artifact || artifact.hash !== expectedArtifactHash) {
    fail(`Selected compatibility artifact is not ${expectedArtifactHash}.`);
  }
  if (!pathIsInside(selectedDirectory, artifact.directory)) fail("Selected artifact resolves outside its engine index.");
  const currentSourceSnapshot = createRustEngineSourceSnapshot(canonicalRoot);
  const sourceSnapshot = artifact.manifest?.sourceSnapshot;
  if (sourceSnapshot?.schema !== 1
    || !/^[a-f0-9]{64}$/u.test(sourceSnapshot.digest ?? "")
    || !Number.isSafeInteger(sourceSnapshot.fileCount) || sourceSnapshot.fileCount <= 0) {
    fail("Selected artifact has incomplete source-snapshot provenance.");
  }
  if (sourceSnapshot.digest !== currentSourceSnapshot.digest
    || sourceSnapshot.fileCount !== currentSourceSnapshot.fileCount) {
    fail(`Selected artifact is not current-source: artifact ${sourceSnapshot.digest}/${sourceSnapshot.fileCount}, current ${currentSourceSnapshot.digest}/${currentSourceSnapshot.fileCount}.`);
  }
  if (sourceSnapshot.digest !== REQUIRED_TERRAIN_EDIT_SOURCE_DIGEST
    || sourceSnapshot.fileCount !== REQUIRED_TERRAIN_EDIT_SOURCE_FILE_COUNT) {
    fail(`Selected artifact source snapshot is not exact required source ${REQUIRED_TERRAIN_EDIT_SOURCE_DIGEST}/${REQUIRED_TERRAIN_EDIT_SOURCE_FILE_COUNT}.`);
  }
  if (artifact.manifest.artifactHash !== expectedArtifactHash
    || artifact.manifest.variant !== "compatibility"
    || artifact.manifest.package !== "blockwild-wasm"
    || artifact.manifest.target !== "wasm32-unknown-unknown"
    || artifact.manifest.cargoProfile !== "release") {
    fail("Selected artifact build provenance is incomplete or inconsistent.");
  }
  const wasmFiles = artifact.manifest.files.filter((file) => file.role === "wasm");
  if (wasmFiles.length !== 1 || wasmFiles[0].path !== "engine_bg.wasm"
    || wasmFiles[0].sha256 !== REQUIRED_TERRAIN_EDIT_WASM_SHA256
    || wasmFiles[0].bytes !== REQUIRED_TERRAIN_EDIT_WASM_BYTES) {
    fail(`Selected artifact does not contain the exact required Wasm ${REQUIRED_TERRAIN_EDIT_WASM_SHA256}/${REQUIRED_TERRAIN_EDIT_WASM_BYTES}.`);
  }
  const wasm = Object.freeze({
    path: wasmFiles[0].path,
    bytes: wasmFiles[0].bytes,
    sha256: wasmFiles[0].sha256,
  });
  const routes = new Map();
  routes.set("/engine/manifest.json", canonicalCandidateFile(
    path.join(selectedDirectory, "manifest.json"),
    "application/json; charset=utf-8",
    false,
  ));
  routes.set(`/engine/${artifact.hash}/manifest.json`, canonicalCandidateFile(
    path.join(artifact.directory, "manifest.json"),
    "application/json; charset=utf-8",
    true,
  ));
  for (const file of artifact.files) {
    routes.set(`/engine/${artifact.hash}/${file.path}`, canonicalCandidateFile(
      path.join(artifact.directory, ...file.path.split("/")),
      file.mimeType,
      true,
    ));
  }
  return Object.freeze({
    repositoryRoot: canonicalRoot,
    relativeDirectory,
    packageKind: relativeDirectory === "public/engine" ? "canonical" : "isolated-candidate",
    directory: selectedDirectory,
    artifactDirectory: artifact.directory,
    hash: artifact.hash,
    manifest: artifact.manifest,
    sourceSnapshot: currentSourceSnapshot,
    treeSnapshot: immutableTreeSnapshot(selectedDirectory),
    wasm,
    routes,
  });
}

export function assertTerrainEditCandidateUnchanged(selection) {
  assertNonSymlinkTree(selection.directory, "Selected terrain-edit engine tree");
  const treeSnapshot = immutableTreeSnapshot(selection.directory);
  assertCondition(JSON.stringify(treeSnapshot) === JSON.stringify(selection.treeSnapshot),
    "Selected terrain-edit engine tree changed during browser acceptance.");
  const sourceSnapshot = createRustEngineSourceSnapshot(selection.repositoryRoot);
  assertCondition(sourceSnapshot.digest === selection.sourceSnapshot.digest
    && sourceSnapshot.fileCount === selection.sourceSnapshot.fileCount,
  "Rust engine source changed during terrain edit browser acceptance.");
  return Object.freeze({ treeSnapshot, sourceSnapshot });
}

function createTerrainEditEnginePlugin(selection, onRequest = () => undefined) {
  return {
    name: "blockwild-rust-terrain-edit-exact-engine",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url ?? "/";
        if (!requestUrl.startsWith("/engine/")) {
          next();
          return;
        }
        let pathname = null;
        try {
          const parsed = new URL(requestUrl, "http://127.0.0.1");
          if (!parsed.pathname.includes("%") && !parsed.pathname.includes("\\")
            && !parsed.pathname.split("/").some((segment) => segment === "." || segment === "..")) {
            pathname = parsed.pathname;
          }
        } catch { pathname = null; }
        const method = request.method ?? "GET";
        const route = pathname === null ? null : selection.routes.get(pathname);
        if (!route || (method !== "GET" && method !== "HEAD")) {
          const status = pathname === null ? 400 : 404;
          response.statusCode = status;
          response.setHeader("Cache-Control", "no-store");
          response.end();
          onRequest(Object.freeze({ method, pathname, status, bytes: 0, sha256: null }));
          return;
        }
        const metadata = lstatSync(route.filePath);
        if (metadata.isSymbolicLink() || !metadata.isFile()
          || metadata.size !== route.bytes || sha256File(route.filePath) !== route.sha256) {
          response.statusCode = 500;
          response.setHeader("Cache-Control", "no-store");
          response.end();
          onRequest(Object.freeze({ method, pathname, status: 500, bytes: 0, sha256: null }));
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", route.contentType);
        response.setHeader("Content-Length", String(route.bytes));
        response.setHeader("Cache-Control", route.immutable ? "public, max-age=31536000, immutable" : "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        onRequest(Object.freeze({ method, pathname, status: 200, bytes: route.bytes, sha256: route.sha256 }));
        if (method === "HEAD") {
          response.end();
          return;
        }
        const stream = createReadStream(route.filePath);
        stream.once("error", (error) => response.destroy(error));
        stream.pipe(response);
      });
    },
  };
}

function findOwnedDatabasePaths(profileDirectory) {
  if (!existsSync(profileDirectory)) return [];
  const results = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) fail(`Browser profile contains an unexpected symlink: ${absolute}.`);
      if (!metadata.isDirectory()) continue;
      const relative = path.relative(profileDirectory, absolute).replaceAll(path.sep, "/");
      if (/IndexedDB$|Local Storage\/leveldb$|Session Storage$|Service Worker\/Database$/iu.test(relative)) {
        results.push(relative);
      }
      visit(absolute);
    }
  };
  visit(profileDirectory);
  return results.sort();
}

export function safeRemoveTerrainEditOwnedDirectory(parentDirectory, ownedDirectory, prefix) {
  const lexicalParent = path.resolve(parentDirectory);
  const lexicalOwned = path.resolve(ownedDirectory);
  if (path.dirname(lexicalOwned) !== lexicalParent || !path.basename(lexicalOwned).startsWith(prefix)) {
    fail(`Refusing unsafe owned-directory removal: ${lexicalOwned}.`);
  }
  if (!existsSync(lexicalOwned)) return true;
  const canonicalParent = realpathSync(lexicalParent);
  const canonicalOwned = realpathSync(lexicalOwned);
  if (!pathIsInside(canonicalParent, canonicalOwned) || lstatSync(lexicalOwned).isSymbolicLink()) {
    fail(`Refusing non-contained or symlink owned-directory removal: ${canonicalOwned}.`);
  }
  rmSync(canonicalOwned, { recursive: true, force: false, maxRetries: 5, retryDelay: 200 });
  return !existsSync(lexicalOwned);
}

async function reserveLoopbackPort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") fail("Could not reserve a loopback port.");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startManagedViteServer(selection, timeoutMilliseconds, routeRequests, runtimeDirectory, onAttempt) {
  const port = await reserveLoopbackPort();
  const plugin = createTerrainEditEnginePlugin(selection, (entry) => boundedPush(routeRequests, entry));
  const inlineConfig = rustMultiplayerManagedViteInlineConfig(
    selection.repositoryRoot,
    port,
    runtimeDirectory,
    plugin,
  );
  writeFileSync(
    inlineConfig.configFile,
    rustMultiplayerManagedViteWrapperSource(selection.repositoryRoot, runtimeDirectory),
    { encoding: "utf8", flag: "wx" },
  );
  const viteModule = path.join(selection.repositoryRoot, "node_modules", "vite", "dist", "node", "index.js");
  if (!existsSync(viteModule)) fail(`Managed server requires installed Vite module ${viteModule}.`);
  const attempt = {
    port,
    server: null,
    environmentInstalled: false,
    environmentRestored: true,
    serverClosed: true,
    portRefused: true,
  };
  onAttempt(attempt);
  let restoreEnvironment = null;
  try {
    restoreEnvironment = installRustMultiplayerViteEnvironment(runtimeDirectory);
    attempt.environmentInstalled = true;
    attempt.environmentRestored = false;
    const { createServer } = await import(pathToFileURL(viteModule).href);
    attempt.server = await createServer(inlineConfig);
    attempt.serverClosed = false;
    attempt.portRefused = false;
    const ignored = attempt.server.config.server.watch?.ignored;
    const ignoresAll = typeof ignored === "function"
      && ignored(path.join(selection.repositoryRoot, "app", "page.tsx")) === true
      && ignored(inlineConfig.configFile) === true;
    assertCondition(attempt.server.config.server.hmr === false && ignoresAll,
      "Managed Vite did not retain HMR-off and ignore-all watch configuration.");
    assertCondition(path.resolve(attempt.server.config.cacheDir) === path.resolve(inlineConfig.cacheDir),
      `Managed Vite cache escaped its owned runtime: ${attempt.server.config.cacheDir}.`);
    assertCondition(
      attempt.server.config.define?.["process.env.NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE"]
        === JSON.stringify("rust-primary"),
      "Managed Vite did not compile the rust-primary terrain profile.",
    );
    await attempt.server.listen();
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + Math.min(timeoutMilliseconds, 120_000);
    while (Date.now() < deadline) {
      try {
        const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
        await response.arrayBuffer();
        if (response.ok) return Object.freeze({
          server: attempt.server,
          baseUrl,
          port,
          inlineConfig,
          runtimeDirectory,
          restoreEnvironment,
          attempt,
        });
      } catch { /* Server is still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    fail("Managed Vite did not become ready within its bounded startup window.");
  } catch (error) {
    try {
      attempt.server?.httpServer?.closeAllConnections?.();
      await attempt.server?.close();
      attempt.serverClosed = attempt.server?.httpServer?.listening !== true;
      attempt.portRefused = await waitForRustMultiplayerPortRefusal(port);
      attempt.environmentRestored = restoreEnvironment ? restoreEnvironment() : true;
    } catch (cleanupError) {
      fail(`Managed Vite startup and cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}.`, {
        startupError: error instanceof Error ? error.message : String(error),
        attempt,
      });
    }
    throw error;
  }
}

function playwrightCandidates(explicitPath) {
  return [
    explicitPath,
    "playwright",
    path.join(os.homedir(), ".codex", "skills", "develop-web-game", "scripts", "node_modules", "playwright", "index.mjs"),
  ].filter(Boolean);
}

async function loadPlaywright(explicitPath) {
  const failures = [];
  for (const candidate of playwrightCandidates(explicitPath)) {
    try {
      const loaded = await import(path.isAbsolute(candidate) ? pathToFileURL(candidate).href : candidate);
      if (loaded.chromium) return Object.freeze({ module: loaded, source: candidate });
      failures.push(`${candidate}: no chromium export`);
    } catch (error) { failures.push(`${candidate}: ${error?.code ?? error?.message ?? String(error)}`); }
  }
  fail("A local Playwright runtime is required; this verifier never downloads a package or browser.", { failures });
}

function discoverBrowserExecutable(explicitPath) {
  if (explicitPath) {
    if (!existsSync(explicitPath) || !statSync(explicitPath).isFile()) {
      fail(`Browser executable does not exist: ${explicitPath}.`);
    }
    return explicitPath;
  }
  const candidates = process.platform === "win32" ? [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ] : [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function browserProcessPid(browser) {
  try {
    const child = typeof browser?.process === "function" ? browser.process() : null;
    return Number.isSafeInteger(child?.pid) && child.pid > 0 ? child.pid : null;
  } catch { return null; }
}

function exactProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function waitForBrowserDisconnect(browser, timeoutMilliseconds = 5_000) {
  if (!browser) return false;
  const deadline = Date.now() + timeoutMilliseconds;
  while (browser.isConnected()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

async function installManagedCanonicalAssetRoutes(context, repositoryRoot, requests) {
  for (const requestUrl of MANAGED_CANONICAL_ASSET_URLS) {
    const asset = resolveManagedCanonicalAsset(repositoryRoot, requestUrl);
    await context.route(requestUrl, async (route) => {
      const selected = resolveManagedCanonicalAsset(repositoryRoot, route.request().url());
      if (!selected || selected.filePath !== asset.filePath) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: selected.contentType,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
        body: readFileSync(selected.filePath),
      });
      boundedPush(requests, {
        url: selected.requestUrl,
        path: selected.relativeAssetPath,
        status: 200,
      });
    });
  }
}

async function installNetworkGuard(context, managedOrigin, repositoryRoot, streams, canonicalAssetRequests) {
  await installManagedCanonicalAssetRoutes(context, repositoryRoot, canonicalAssetRequests);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === managedOrigin || MANAGED_CANONICAL_ASSET_URLS.includes(url.href)) {
      await route.fallback();
      return;
    }
    boundedPush(streams.externalRequests, {
      url: url.href,
      method: route.request().method(),
      resourceType: route.request().resourceType(),
    });
    await route.abort("blockedbyclient");
  });
}

function installBrowserAudit(context, observeHistoricalSave = false) {
  return context.addInitScript((historical) => {
    const audit = {
      schema: 1,
      trustedCanvasLeftDown: [],
      trustedCanvasLeftUp: [],
      trustedPointerMoves: [],
      trustedTouchLookDown: [],
      trustedTouchLookMoves: [],
      trustedTouchMineDown: [],
      trustedTouchMineUp: [],
      pointerLockChanges: [],
      generationCertificates: [],
      ...(historical ? { documentToken: crypto.randomUUID(), importClicks: [], imports: [], generationRequests: [], generatedEdits: [] } : {}),
    };
    Object.defineProperty(window, "__blockwildTerrainEditReloadAudit", {
      configurable: true,
      value: audit,
    });
    const bounded = (array, value, maximum = 128) => {
      array.push(value);
      while (array.length > maximum) array.shift();
    };
    const trustedTouchMinePointerIds = new Set();
    if (historical) {
      document.addEventListener("click", (event) => {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        if (button?.textContent?.trim() === "IMPORT") bounded(audit.importClicks, { trusted: event.isTrusted });
      }, true);
      document.addEventListener("change", (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.type !== "file" || !input.files?.[0]) return;
        const file = input.files[0];
        const observation = { name: file.name, bytes: file.size, sha256: null, error: null };
        bounded(audit.imports, observation);
        void file.arrayBuffer().then(bytes => crypto.subtle.digest("SHA-256", bytes)).then(hash => {
          observation.sha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
        }).catch(error => { observation.error = String(error); });
      }, true);
    }
    document.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || !(event.target instanceof HTMLCanvasElement)
        || !event.target.classList.contains("game-canvas")) return;
      bounded(audit.trustedCanvasLeftDown, {
        trusted: event.isTrusted,
        pointerLocked: document.pointerLockElement === event.target,
        at: performance.now(),
      });
    }, true);
    document.addEventListener("mouseup", (event) => {
      const canvas = document.querySelector("canvas.game-canvas");
      if (event.button !== 0 || !(canvas instanceof HTMLCanvasElement)) return;
      bounded(audit.trustedCanvasLeftUp, {
        trusted: event.isTrusted,
        pointerLocked: document.pointerLockElement === canvas,
        at: performance.now(),
      });
    }, true);
    document.addEventListener("mousemove", (event) => {
      const canvas = document.querySelector("canvas.game-canvas");
      if (!(canvas instanceof HTMLCanvasElement) || document.pointerLockElement !== canvas
        || (event.movementX === 0 && event.movementY === 0)) return;
      bounded(audit.trustedPointerMoves, {
        trusted: event.isTrusted,
        movementX: event.movementX,
        movementY: event.movementY,
        at: performance.now(),
      });
    }, true);
    document.addEventListener("pointerlockchange", () => {
      const canvas = document.querySelector("canvas.game-canvas");
      bounded(audit.pointerLockChanges, {
        canvasLocked: canvas instanceof HTMLCanvasElement && document.pointerLockElement === canvas,
        at: performance.now(),
      });
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.classList.contains("touch-look-zone")) {
        bounded(audit.trustedTouchLookDown, { trusted: event.isTrusted, pointerId: event.pointerId, at: performance.now() });
      }
      if (target instanceof HTMLElement && target.closest("button.mine-action")) {
        trustedTouchMinePointerIds.add(event.pointerId);
        bounded(audit.trustedTouchMineDown, { trusted: event.isTrusted, pointerId: event.pointerId, at: performance.now() });
      }
    }, true);
    document.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch") return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains("touch-look-zone")) return;
      bounded(audit.trustedTouchLookMoves, {
        trusted: event.isTrusted,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        at: performance.now(),
      });
    }, true);
    document.addEventListener("pointerup", (event) => {
      if (event.pointerType !== "touch" || !trustedTouchMinePointerIds.has(event.pointerId)) return;
      trustedTouchMinePointerIds.delete(event.pointerId);
      bounded(audit.trustedTouchMineUp, { trusted: event.isTrusted, pointerId: event.pointerId, at: performance.now() });
    }, true);
    const NativeWorker = window.Worker;
    const AuditedWorker = function (...args) {
      const worker = new NativeWorker(...args);
      const requests = new Map();
      if (historical) {
        const postMessage = worker.postMessage.bind(worker);
        worker.postMessage = (...arguments_) => {
          const message = arguments_[0]; const request = message?.request;
          if (message?.type === "generate-chunk-v2" && request) {
            const observed = { epoch: request.epoch, taskId: request.taskId, key: request.key,
              seedText: request.seedText, namespace: request.namespace, requestHash: request.requestHash,
              generationOptions: structuredClone(request.generationOptions), edits: [...request.edits] };
            requests.set(`${request.epoch}:${request.taskId}`, observed);
            if (requests.size > 512) requests.delete(requests.keys().next().value);
            bounded(audit.generationRequests, observed, 512);
          }
          return postMessage(...arguments_);
        };
      }
      worker.addEventListener("message", (event) => {
        const message = event.data;
        if (historical && message?.type === "generated-chunk-v2") {
          const request = requests.get(`${message.epoch}:${message.taskId}`);
          if (request) {
            requests.delete(`${message.epoch}:${message.taskId}`);
            if (request.edits.length) bounded(audit.generatedEdits, { ...request,
              resultKey: message.result?.key, resultRequestHash: message.result?.requestHash,
              appliedEdits: request.edits.filter((_, index) => index % 2 === 0)
                .map(index => [index, message.result?.blocks?.[index] ?? null]) }, 512);
          }
        }
        if (message?.type !== "terrain-generation-ready-v2" || !message.certificate) return;
        bounded(audit.generationCertificates, structuredClone(message.certificate));
      });
      return worker;
    };
    AuditedWorker.prototype = NativeWorker.prototype;
    Object.defineProperty(AuditedWorker, "name", { value: "Worker" });
    window.Worker = AuditedWorker;
  }, observeHistoricalSave);
}

function assertTrustedPlayerGesture(audit) {
  const trustedMouse = audit?.trustedPointerMoves?.some((entry) => entry.trusted === true)
    && audit?.trustedCanvasLeftDown?.some((entry) => entry.trusted === true && entry.pointerLocked === true)
    && audit?.trustedCanvasLeftUp?.some((entry) => entry.trusted === true);
  const trustedTouch = audit?.trustedTouchLookDown?.some((entry) => entry.trusted === true)
    && audit?.trustedTouchLookMoves?.some((entry) => entry.trusted === true)
    && audit?.trustedTouchMineDown?.some((entry) => entry.trusted === true)
    && audit?.trustedTouchMineUp?.some((entry) => entry.trusted === true);
  assertCondition(trustedMouse || trustedTouch,
    "No complete trusted mouse or public touch-control terrain gesture was observed.");
  return Object.freeze({
    mode: trustedMouse ? "pointer-lock-mouse" : "public-touch-controls",
    trustedPointerMoves: audit.trustedPointerMoves.length,
    trustedCanvasLeftDown: audit.trustedCanvasLeftDown.length,
    trustedCanvasLeftUp: audit.trustedCanvasLeftUp.length,
    trustedTouchLookDown: audit.trustedTouchLookDown.length,
    trustedTouchLookMoves: audit.trustedTouchLookMoves.length,
    trustedTouchMineDown: audit.trustedTouchMineDown.length,
    trustedTouchMineUp: audit.trustedTouchMineUp.length,
    pointerLockChanges: audit.pointerLockChanges.length,
  });
}

function collectRuntimeErrors(snapshot, label) {
  const state = snapshot?.state;
  const runtime = snapshot?.runtime;
  const streaming = state?.performance?.streaming;
  const errors = [];
  const nonNull = (name, value) => {
    if (value !== null && value !== undefined && value !== "") errors.push(`${label} ${name}: ${String(value)}`);
  };
  nonNull("runtime.manager.lastError", runtime?.manager?.lastError);
  nonNull("runtime.manager.host.lastError", runtime?.manager?.host?.lastError);
  nonNull("runtime.manager.host.adapter.lastError", runtime?.manager?.host?.adapter?.lastError);
  nonNull("runtime.manager.host.nativePersistence.lastError", runtime?.manager?.host?.nativePersistence?.lastError);
  nonNull("runtime.renderer.lastError", runtime?.renderer?.lastError);
  nonNull("runtime.multiplayer.lastError", runtime?.multiplayer?.lastError);
  nonNull("generationWorker.lastError", streaming?.generationWorker?.lastError);
  nonNull("terrainWorker.lastError", streaming?.terrainWorker?.lastError);
  nonNull("rustTerrain.lastMismatch", streaming?.rustTerrain?.lastMismatch);
  nonNull("rustWorldAuthority.lastFallbackReason", streaming?.rustWorldAuthority?.lastFallbackReason);
  if ((streaming?.generationWorker?.failed ?? 0) !== 0) errors.push(`${label} generation workers failed.`);
  if ((streaming?.generationWorker?.restarts ?? 0) !== 0) errors.push(`${label} generation workers restarted.`);
  if ((streaming?.generationWorker?.rejected ?? 0) !== 0) errors.push(`${label} generation requests were rejected.`);
  if ((runtime?.manager?.host?.adapter?.failures ?? 0) !== 0) errors.push(`${label} runtime adapter reported failures.`);
  return errors;
}

export function rustTerrainGenerationIsReadyAndAuthoritative(generation) {
  const workers = generation?.workers;
  const busy = generation?.busy;
  const admissionStateIsConsistent = generation?.acceptingRequests === true
    ? Number.isSafeInteger(busy) && busy >= 0 && busy < workers
    : generation?.acceptingRequests === false
      && Number.isSafeInteger(busy) && busy === workers;
  return generation?.mode === "rust"
    && generation?.selectionSource === "build-rust-primary"
    && generation?.authorityRequired === true
    && generation?.state === "ready"
    && generation?.supported === true
    && Number.isSafeInteger(workers)
    && workers > 0
    && generation?.ready === workers
    && admissionStateIsConsistent;
}

export function assertRustTerrainCheckpoint(snapshot, expectedArtifactHash, label, expectedState = "playing") {
  assertCondition(snapshot?.state?.state === expectedState, `${label} state is ${String(snapshot?.state?.state)}.`);
  const generation = snapshot?.state?.performance?.streaming?.generationWorker;
  assertCondition(rustTerrainGenerationIsReadyAndAuthoritative(generation),
  `${label} Rust terrain generation is not ready and authoritative.`);
  assertCondition(Number.isSafeInteger(generation?.workers) && generation.workers > 0
    && generation.ready === generation.workers && generation.failed === 0
    && generation.restarts === 0 && generation.rejected === 0,
  `${label} Rust terrain worker pool is unhealthy.`);
  const host = snapshot?.runtime?.manager?.host;
  assertCondition(snapshot?.runtime?.ready === true && snapshot?.runtime?.manager?.state === "ready"
    && host?.adapter?.liveAuthorityReady === true,
  `${label} Rust runtime host is not ready.`);
  assertCondition(host?.artifactHash === expectedArtifactHash,
    `${label} runtime artifact ${String(host?.artifactHash)} differs from ${expectedArtifactHash}.`);
  assertCondition(typeof snapshot?.runtime?.activeWorldId === "string" && snapshot.runtime.activeWorldId.length > 0,
    `${label} active Rust world id is absent.`);
  assertCondition(snapshot.runtime.activeWorldId === snapshot.storage?.activeWorldId,
    `${label} Rust runtime and browser catalog world ids differ.`);
  const certificate = snapshot?.audit?.generationCertificates?.[0];
  assertCondition(certificate?.corpusCases === TERRAIN_EDIT_GENERATION_CERTIFICATE.corpusCases
    && certificate?.corpusHash === TERRAIN_EDIT_GENERATION_CERTIFICATE.corpusHash
    && certificate?.byteEqual === true,
  `${label} exact 155-case generation certificate is absent.`);
  return snapshot;
}

async function readBrowserSnapshot(page) {
  return page.evaluate(() => {
    const parseRenderer = (name) => {
      try {
        const renderer = window[name];
        return typeof renderer === "function" ? JSON.parse(renderer()) : null;
      } catch (error) {
        return { __parseError: error instanceof Error ? error.message : String(error) };
      }
    };
    let catalog = null;
    let document = null;
    try { catalog = JSON.parse(localStorage.getItem("blockwild-world-catalog-v1") ?? "null"); }
    catch { catalog = null; }
    const activeWorldId = typeof catalog?.activeWorldId === "string" ? catalog.activeWorldId : null;
    if (activeWorldId) {
      try { document = JSON.parse(localStorage.getItem(`blockwild-world-data-v1:${activeWorldId}`) ?? "null"); }
      catch { document = null; }
    }
    return {
      state: parseRenderer("render_game_to_text"),
      runtime: parseRenderer("render_rust_runtime_to_text"),
      audit: window.__blockwildTerrainEditReloadAudit
        ? structuredClone(window.__blockwildTerrainEditReloadAudit)
        : null,
      storage: {
        activeWorldId,
        catalogWorldCount: Array.isArray(catalog?.worlds) ? catalog.worlds.length : null,
        worldStorageKeys: Object.keys(localStorage).filter((key) => key.startsWith("blockwild-world-")).sort(),
        save: document?.save ? {
          seed: document.save.seed,
          mode: document.save.mode,
          player: document.save.player ? structuredClone(document.save.player) : null,
          edits: document.save.edits ? structuredClone(document.save.edits) : null,
        } : null,
      },
    };
  });
}

async function waitForHarness(page, timeoutMilliseconds) {
  await page.waitForFunction(() => (
    typeof window.render_game_to_text === "function"
    && typeof window.render_rust_runtime_to_text === "function"
  ), undefined, { timeout: Math.min(timeoutMilliseconds, 120_000) });
}

async function ensurePointerLock(page) {
  const locked = await page.evaluate(() => document.pointerLockElement?.classList.contains("game-canvas") === true);
  if (!locked) {
    const canvas = page.locator("canvas.game-canvas");
    await canvas.waitFor({ state: "visible" });
    await canvas.click({ position: { x: 640, y: 360 } });
  }
  await page.waitForFunction(() => document.pointerLockElement?.classList.contains("game-canvas") === true,
    undefined, { timeout: 15_000 });
}

async function dispatchTrustedTouchSwipe(cdp, box, deltaX, deltaY, identifier = 11) {
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = Math.max(box.x + 8, Math.min(box.x + box.width - 8, startX + deltaX));
  const endY = Math.max(box.y + 8, Math.min(box.y + box.height - 8, startY + deltaY));
  const point = (x, y) => ({ x, y, id: identifier, radiusX: 1, radiusY: 1, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(startX, startY)] });
  for (let step = 1; step <= 4; step += 1) {
    const fraction = step / 4;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(
        startX + (endX - startX) * fraction,
        startY + (endY - startY) * fraction,
      )],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function beginTrustedTouchHold(cdp, box, identifier = 21) {
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    id: identifier,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
}

async function aimAtSafeTerrain(page, cdp, readAndRecord) {
  const touchLookZone = page.locator(".touch-look-zone");
  const touchVisible = await touchLookZone.waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (touchVisible) {
    const box = await touchLookZone.boundingBox();
    assertCondition(box && box.width >= 100 && box.height >= 100,
      "Public touch look zone has no usable visible bounds.");
    for (let attempt = 0; attempt < MAX_AIM_ATTEMPTS; attempt += 1) {
      const snapshot = await readAndRecord(`touch-aim-${attempt}`);
      const selection = selectTerrainBreakTarget(snapshot);
      if (selection) return Object.freeze({
        selection,
        snapshot,
        attempts: attempt + 1,
        inputMode: "public-touch-controls",
      });
      const pitch = Number(snapshot?.state?.player?.pitch ?? 0);
      const targetPitch = -0.48;
      const movementY = Math.max(-55, Math.min(55, Math.round((pitch - targetPitch) / 0.00275)));
      const movementX = attempt % 2 === 0 ? 7 : -5;
      await dispatchTrustedTouchSwipe(cdp, box, movementX, movementY === 0 ? (attempt % 2 ? 3 : -3) : movementY, 11);
      await page.waitForTimeout(120);
    }
    const snapshot = await readAndRecord("touch-aim-failed");
    fail("Trusted public touch-look gestures could not select a safe single-cell terrain block.", {
      state: snapshot?.state,
      audit: snapshot?.audit,
    });
  }

  await ensurePointerLock(page);
  let mouseX = 640;
  let mouseY = 360;
  await page.mouse.move(mouseX, mouseY);
  // Consume the production's bounded pointer-lock recenter suppression with
  // actual browser input before evaluating any intended look movement.
  mouseX += 2;
  await page.mouse.move(mouseX, mouseY);
  mouseX -= 2;
  await page.mouse.move(mouseX, mouseY);
  for (let attempt = 0; attempt < MAX_AIM_ATTEMPTS; attempt += 1) {
    const snapshot = await readAndRecord(`aim-${attempt}`);
    const selection = selectTerrainBreakTarget(snapshot);
    if (selection) return Object.freeze({
      selection,
      snapshot,
      attempts: attempt + 1,
      inputMode: "pointer-lock-mouse",
    });
    const pitch = Number(snapshot?.state?.player?.pitch ?? 0);
    // A moderate downward view normally intersects a surface block several
    // cells ahead. Small alternating horizontal nudges avoid an exact DDA edge.
    const targetPitch = -0.48;
    const movementY = Math.max(-55, Math.min(55, Math.round((pitch - targetPitch) / 0.0022)));
    const movementX = attempt % 2 === 0 ? 7 : -5;
    mouseX = Math.max(32, Math.min(1248, mouseX + movementX));
    mouseY = Math.max(32, Math.min(688, mouseY + (movementY === 0 ? (attempt % 2 ? 3 : -3) : movementY)));
    await page.mouse.move(mouseX, mouseY, { steps: 2 });
    await page.waitForTimeout(120);
  }
  const snapshot = await readAndRecord("aim-failed");
  fail("Trusted pointer movement could not select a safe single-cell terrain block.", {
    state: snapshot?.state,
    audit: snapshot?.audit,
  });
}

async function beginTrustedMining(page, cdp, inputMode) {
  if (inputMode === "public-touch-controls") {
    const button = page.getByRole("button", { name: "Harvest or attack" });
    await button.waitFor({ state: "visible" });
    const box = await button.boundingBox();
    assertCondition(box && box.width >= 20 && box.height >= 20,
      "Public Harvest or attack control has no usable visible bounds.");
    return beginTrustedTouchHold(cdp, box, 21);
  }
  await page.mouse.down({ button: "left" });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await page.mouse.up({ button: "left" });
  };
}

async function captureScreenshot(page, repositoryRoot, outputDirectory, screenshots, name) {
  const filePath = path.join(outputDirectory, `${name}.png`);
  // A freshly reloaded Chromium document can expose accessible button text one
  // paint before the webfont glyphs reach the compositor. Bind retained visual
  // evidence to the settled document so a transient blank menu is never
  // mistaken for the state the player actually receives.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: filePath, type: "png" });
  screenshots[name] = relativeEvidencePath(repositoryRoot, filePath);
  return screenshots[name];
}

async function observeTerrainEditReloadTitleVisuals(page) {
  return page.evaluate(async (expectedLabels) => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rounded = (value) => Math.round(Number(value) * 4) / 4;
    const boundsOf = (rect) => ({
      x: rounded(rect?.x ?? 0),
      y: rounded(rect?.y ?? 0),
      width: rounded(rect?.width ?? 0),
      height: rounded(rect?.height ?? 0),
    });
    const elementVisual = (element, rect = element?.getBoundingClientRect()) => {
      if (!(element instanceof Element)) return {
        visible: false,
        inViewport: false,
        unoccluded: false,
        bounds: boundsOf(null),
      };
      const style = getComputedStyle(element);
      const bounds = boundsOf(rect);
      const visible = typeof element.checkVisibility === "function"
        ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0;
      const inViewport = bounds.width >= 1 && bounds.height >= 1
        && bounds.x >= 0 && bounds.y >= 0
        && bounds.x + bounds.width <= innerWidth && bounds.y + bounds.height <= innerHeight;
      const centerX = Math.max(0, Math.min(innerWidth - 1, bounds.x + bounds.width / 2));
      const centerY = Math.max(0, Math.min(innerHeight - 1, bounds.y + bounds.height / 2));
      const unoccluded = inViewport && document.elementsFromPoint(centerX, centerY)
        .some((hit) => hit === element || element.contains(hit) || hit.contains(element));
      return { visible, inViewport, unoccluded, bounds };
    };
    const colorIsVisible = (style) => {
      const colors = [style.color, style.webkitTextFillColor]
        .filter((color) => typeof color === "string" && color.length > 0);
      return colors.every((color) => color !== "transparent"
        && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/u.test(color));
    };
    const textVisual = (element, text) => {
      if (!(element instanceof Element)) return {
        ...elementVisual(null),
        fontReady: false,
        colorVisible: false,
      };
      const range = document.createRange();
      range.selectNodeContents(element);
      const style = getComputedStyle(element);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return {
        ...elementVisual(element, range.getBoundingClientRect()),
        fontReady: document.fonts.check(font, text),
        colorVisible: colorIsVisible(style),
      };
    };
    const overlay = document.querySelector(".title-overlay");
    const menu = document.querySelector(".title-main-menu[aria-label='Main menu']");
    const logo = document.querySelector(".title-overlay #game-title.block-logo");
    const buttons = menu instanceof Element
      ? [...menu.querySelectorAll(":scope > button.title-menu-choice")]
      : [];
    return {
      documentVisibility: document.visibilityState,
      fontsStatus: document.fonts.status,
      expectedLabels,
      overlay: elementVisual(overlay),
      menu: elementVisual(menu),
      logo: {
        text: logo?.textContent?.trim() ?? "",
        ...textVisual(logo, "BLOCKWILD"),
      },
      buttons: buttons.map((button) => {
        const strong = button.querySelector(":scope > strong");
        const label = strong?.textContent?.trim() ?? "";
        return {
          label,
          disabled: button instanceof HTMLButtonElement ? button.disabled : null,
          activeAnimations: button.getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running" || animation.playState === "pending").length,
          button: elementVisual(button),
          text: textVisual(strong, label),
        };
      }),
    };
  }, TERRAIN_EDIT_TITLE_MENU_LABELS);
}

async function waitForTerrainEditReloadTitleVisualReadiness(page, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  let stableSamples = [];
  let stableSignature = null;
  let lastObservation = null;
  let lastError = "No title visual observation completed.";
  while (Date.now() < deadline) {
    lastObservation = await observeTerrainEditReloadTitleVisuals(page);
    try {
      assertTerrainEditTitleVisualObservation(lastObservation, 1);
      const signature = terrainEditTitleVisualSignature(lastObservation);
      if (signature === stableSignature) stableSamples.push(lastObservation);
      else {
        stableSignature = signature;
        stableSamples = [lastObservation];
      }
      if (stableSamples.length >= TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES) {
        return assertTerrainEditReloadTitleVisualReadiness({
          schema: 1,
          samples: stableSamples.slice(-TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES),
        });
      }
    } catch (error) {
      stableSamples = [];
      stableSignature = null;
      lastError = error instanceof Error ? error.message : String(error);
    }
    await page.waitForTimeout(80);
  }
  const error = new Error(`Post-reload title menu did not become visually ready: ${lastError}`);
  error.titleVisualReadinessEvidence = {
    schema: 1,
    expectedLabels: TERRAIN_EDIT_TITLE_MENU_LABELS,
    requiredStableSamples: TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES,
    stableSamples: stableSamples.length,
    lastObservation: cloneJson(lastObservation),
  };
  throw error;
}

/** Reuse owned Vite/browser/error/provenance/cleanup machinery for a bounded real-UI scenario. */
export async function runManagedRustTerrainBrowserScenario(argv, scenario) {
  assertCondition(scenario && /^blockwild-rust-[a-z0-9-]+-v1$/u.test(scenario.gate)
    && typeof scenario.run === "function" && typeof scenario.authorityClaim === "string",
  "A managed Rust terrain scenario needs an explicit gate, authority claim, and runner.");
  return runTerrainEditReloadBrowser(argv, scenario);
}

export async function runTerrainEditReloadBrowser(argv = process.argv, scenario = null) {
  const options = parseTerrainEditBrowserOptions(argv);
  if (options.help) return Object.freeze({ help: true, usage: usage() });
  mkdirSync(options.outputDirectory, { recursive: true });
  resolveWorkOutputDirectory(options.repositoryRoot, options.outputDirectory);
  const selection = selectTerrainEditCandidate(
    options.repositoryRoot,
    options.engineDirectory,
    options.expectedArtifactHash,
  );
  const profileRoot = path.join(options.outputDirectory, PROFILE_ROOT_NAME);
  if (existsSync(profileRoot)) {
    const metadata = lstatSync(profileRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || readdirSync(profileRoot).length > 0) {
      fail(`Browser profile root must be absent or empty: ${profileRoot}.`);
    }
  } else mkdirSync(profileRoot);
  const profileDirectory = mkdtempSync(path.join(profileRoot, PROFILE_PREFIX));
  const viteRuntimeDirectory = mkdtempSync(path.join(options.outputDirectory, VITE_RUNTIME_PREFIX));
  const routeRequests = [];
  const canonicalAssetRequests = [];
  const streams = {
    consoleErrors: [],
    pageErrors: [],
    runtimeErrors: [],
    routeErrors: [],
    httpErrors: [],
    requestFailures: [],
    externalRequests: [],
    webSockets: [],
    expectedRequestCancellations: [],
    expectedManagedViteWebSockets: [],
  };
  const screenshots = Object.create(null);
  const cleanup = {
    browserStarted: false,
    browserClosed: false,
    browserDisconnected: false,
    serverStarted: false,
    serverClosed: true,
    serverPortRefused: true,
    environmentRestored: true,
    profileRemoved: false,
    profileRootRemoved: false,
    databasePathsBeforeCleanup: [],
    databasePathsAfterCleanup: [],
    databasePathsRemoved: false,
    viteRuntimeRemoved: false,
    candidateUnchanged: false,
    eventsDrained: false,
    browserMutexReleased: true,
    trackedChildPids: [],
    aliveChildPidsAfterCleanup: [],
    processTracking: {
      vite: "in-process-no-child",
      browser: "playwright-owned-browser-handle",
    },
  };
  const collectionState = { active: true };
  const terrainReadiness = {
    freshCreate: null,
    afterEdit: null,
    freshContinue: null,
  };
  let browserMutex = null;
  let browserMutexEvidence = null;
  let playwright = null;
  let browserExecutable = null;
  let managedServer = null;
  let managedServerAttempt = null;
  let context = null;
  let browser = null;
  let page = null;
  let cdp = null;
  let result = null;
  let lastSnapshot = null;
  let beforeEdit = null;
  let afterGesture = null;
  let titleAfterSave = null;
  let titleAfterReload = null;
  let titleVisualReadiness = null;
  let continued = null;
  let targetEvidence = null;
  const recordRuntimeErrors = (snapshot, label) => {
    for (const message of collectRuntimeErrors(snapshot, label)) {
      if (!streams.runtimeErrors.includes(message)) streams.runtimeErrors.push(message);
    }
  };
  try {
    try {
      browserMutex = await acquireTerrainEditBrowserMutex(options.repositoryRoot);
      browserMutexEvidence = browserMutex.evidence;
      cleanup.browserMutexReleased = false;
    } catch (error) {
      browserMutexEvidence = error?.browserGateMutex ?? null;
      throw error;
    }
    playwright = await loadPlaywright(options.playwrightModule);
    browserExecutable = discoverBrowserExecutable(options.browserExecutable);
    managedServer = await startManagedViteServer(
      selection,
      options.timeoutMilliseconds,
      routeRequests,
      viteRuntimeDirectory,
      (attempt) => { managedServerAttempt = attempt; },
    );
    cleanup.serverStarted = true;
    cleanup.serverClosed = false;
    cleanup.serverPortRefused = false;
    cleanup.environmentRestored = false;
    context = await playwright.module.chromium.launchPersistentContext(profileDirectory, {
      headless: options.headless,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      viewport: { width: 1280, height: 720 },
      hasTouch: true,
      serviceWorkers: "block",
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--disable-breakpad",
        "--disable-crash-reporter",
        `--disk-cache-dir=${path.join(profileDirectory, "browser-cache")}`,
        `--crash-dumps-dir=${path.join(profileDirectory, "crash-dumps")}`,
      ],
    });
    cleanup.browserStarted = true;
    browser = context.browser();
    assertCondition(browser, "Playwright did not expose the owned Browser handle.");
    const browserPid = browserProcessPid(browser);
    if (browserPid !== null) cleanup.trackedChildPids.push(browserPid);
    await context.addInitScript(() => {
      localStorage.setItem("blockwild-settings-v2", JSON.stringify({
        renderDistance: 2,
        simulationDistance: 2,
        basicRenderDistance: 2,
        rememberedBasicRenderDistance: 2,
        resourceMode: "cpu",
      }));
      localStorage.setItem("blockwild-ui-preferences-v1", JSON.stringify({
        touchControls: "on",
        targetOutlineOpacity: 0.45,
        showReferenceHints: true,
      }));
      localStorage.setItem("blockwild-browser-player-id-v1", "terrain_edit_acceptance_browser");
      localStorage.setItem("blockwild-character-profiles-v1", JSON.stringify({
        version: 1,
        browserId: "terrain_edit_acceptance_browser",
        selectedProfileId: "terrain_edit_acceptance_profile",
        profiles: [{
          version: 1,
          id: "terrain_edit_acceptance_profile",
          browserId: "terrain_edit_acceptance_browser",
          name: "Terrain Keeper",
          appearance: { sex: "male", skinTone: 2, hair: 1, hairColor: 2, shirtColor: 4, pantsColor: 1 },
          createdAt: 1,
          updatedAt: 1,
        }],
      }));
    });
    await installBrowserAudit(context, scenario?.observeHistoricalSave === true);
    await installNetworkGuard(
      context,
      managedServer.baseUrl,
      selection.repositoryRoot,
      streams,
      canonicalAssetRequests,
    );
    page = context.pages()[0] ?? await context.newPage();
    cdp = await context.newCDPSession(page);
    page.setDefaultTimeout(Math.min(options.timeoutMilliseconds, 60_000));
    page.on("console", (message) => {
      if (!collectionState.active || message.type() !== "error") return;
      boundedPush(streams.consoleErrors, {
        text: message.text(),
        location: message.location(),
      });
    });
    page.on("pageerror", (error) => {
      if (!collectionState.active) return;
      boundedPush(streams.pageErrors, {
        name: error?.name ?? null,
        message: error?.message ?? String(error),
        stack: error?.stack ?? null,
      });
    });
    page.on("response", (response) => {
      if (!collectionState.active || response.status() < 400) return;
      boundedPush(streams.httpErrors, {
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
        resourceType: response.request().resourceType(),
      });
    });
    page.on("requestfailed", (request) => {
      if (!collectionState.active) return;
      const event = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failure: request.failure()?.errorText ?? "unknown request failure",
      };
      if (isExpectedLocalMusicCancellation(event, managedServer.baseUrl)) {
        boundedPush(streams.expectedRequestCancellations, event);
      } else boundedPush(streams.requestFailures, event);
    });
    page.on("websocket", (socket) => {
      if (!collectionState.active) return;
      const event = { url: socket.url() };
      if (isExpectedManagedViteWebSocket(event, managedServer.baseUrl)) {
        boundedPush(streams.expectedManagedViteWebSockets, event);
      } else boundedPush(streams.webSockets, event);
    });

    const readAndRecord = async (label, expectedState = null) => {
      const snapshot = await readBrowserSnapshot(page);
      lastSnapshot = snapshot;
      recordRuntimeErrors(snapshot, label);
      if (snapshot?.state?.__parseError) streams.runtimeErrors.push(`${label}: ${snapshot.state.__parseError}`);
      if (snapshot?.runtime?.__parseError) streams.runtimeErrors.push(`${label}: ${snapshot.runtime.__parseError}`);
      if (expectedState) assertRustTerrainCheckpoint(snapshot, options.expectedArtifactHash, label, expectedState);
      return snapshot;
    };
    const waitForGameplay = async (label) => {
      const deadline = Date.now() + options.timeoutMilliseconds;
      let snapshot = null;
      while (Date.now() < deadline) {
        await page.waitForTimeout(350);
        snapshot = await readAndRecord(label);
        const ring = snapshot?.state?.performance?.streaming?.immediateRing;
        const generation = snapshot?.state?.performance?.streaming?.generationWorker;
        if (snapshot?.state?.state !== "playing" || ring?.desired !== 9 || ring?.ready !== 9
          || generation?.state !== "ready" || generation?.ready !== generation?.workers
          || generation?.acceptingRequests !== true
          || !snapshot?.audit?.generationCertificates?.length) continue;
        return assertRustTerrainCheckpoint(snapshot, options.expectedArtifactHash, label);
      }
      fail(`${label} did not reach exact 9/9 Rust-terrain gameplay readiness.`, { snapshot });
    };

    if (scenario) {
      const payload = await scenario.run({ page, baseUrl: managedServer.baseUrl, timeoutMilliseconds: options.timeoutMilliseconds,
        readAndRecord, waitForGameplay,
        waitForHarness: () => waitForHarness(page, options.timeoutMilliseconds),
        waitForTitleVisualReadiness: () => waitForTerrainEditReloadTitleVisualReadiness(page, options.timeoutMilliseconds),
        captureScreenshot: (name) => captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, name),
      });
      assertRustTerrainCheckpoint(lastSnapshot, options.expectedArtifactHash, "managed-scenario-complete");
      assertCondition(new URL(page.url()).origin === managedServer.baseUrl && new URL(page.url()).pathname === "/"
        && new URL(page.url()).search === "", "Managed scenario left the unmodified production route.");
      assertCondition(routeRequests.some(request => request.status === 200
        && request.pathname === `/engine/${options.expectedArtifactHash}/${selection.wasm.path}`
        && request.bytes === selection.wasm.bytes && request.sha256 === selection.wasm.sha256),
      "Managed scenario did not load the exact expected content-addressed Wasm artifact.");
      assertTerrainEditBrowserErrorStreams(streams);
      result = { ...payload, schema: 1, gate: scenario.gate, status: "passed", createdAt: new Date().toISOString(),
        authorityClaim: scenario.authorityClaim,
        artifact: { hash: options.expectedArtifactHash, directory: relativeEvidencePath(options.repositoryRoot, selection.directory),
          sourceSnapshot: selection.sourceSnapshot, treeSnapshot: selection.treeSnapshot, wasm: selection.wasm, requests: routeRequests },
        generation: { buildProfile: "rust-primary", mode: "rust", selectionSource: "build-rust-primary", certificate: TERRAIN_EDIT_GENERATION_CERTIFICATE },
        harness: { baseUrl: managedServer.baseUrl, managedVite: true, hmr: managedServer.inlineConfig.server.hmr, watch: "ignore-all",
          productionRouteSearch: "", playerAuthority: "typescript", browserProfileToken: path.basename(profileDirectory),
          browserExecutable: browserExecutable ?? "playwright-managed", playwrightSource: playwright.source, browserGateMutex: browserMutexEvidence },
        screenshots, canonicalAssetRequests, errors: streams, cleanup };
    } else {
    await page.goto(`${managedServer.baseUrl}/`, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(options.timeoutMilliseconds, 120_000),
    });
    assertCondition(new URL(page.url()).search === "",
      "Terrain edit verifier must exercise the normal production route without player-authority selectors.");
    await waitForHarness(page, options.timeoutMilliseconds);
    await page.getByRole("button", { name: /Create New World/u }).click();
    await page.getByRole("heading", { name: "Create a New World" }).waitFor();
    await page.getByLabel("World name").fill(TERRAIN_EDIT_WORLD_FIXTURE.name);
    await page.getByLabel("World seed").fill(TERRAIN_EDIT_WORLD_FIXTURE.seed);
    await page.getByRole("button", { name: /^SURVIVAL/u }).click();
    await page.getByRole("button", { name: "Generate World" }).click({ noWaitAfter: true });
    const created = await waitForGameplay("create-ready");
    assertCondition(created.storage.catalogWorldCount === 1,
      "Dedicated browser profile contains more than the one fixture world.");
    assertCondition(created.storage.save?.seed === TERRAIN_EDIT_WORLD_FIXTURE.seed
      && created.storage.save?.mode === TERRAIN_EDIT_WORLD_FIXTURE.mode,
    "Created world differs from the deterministic fixture.");
    assertCondition(canonicalSavedEdits(created.storage).count === 0,
      "Dedicated fixture unexpectedly began with persisted terrain edits.");
    terrainReadiness.freshCreate = await waitForRustMultiplayerVisualTerrainReadiness(
      page,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "terrain-edit-fresh-create",
        failureStage: "terrain-readiness-fresh-create",
        readSnapshot: async () => readAndRecord("visual-terrain-fresh-create", "playing"),
        onObservation: (assessment) => { terrainReadiness.freshCreate = { status: "pending", assessment }; },
      },
    );
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "01-created-rust-terrain");

    const aimed = await aimAtSafeTerrain(page, cdp, readAndRecord);
    targetEvidence = aimed.selection;
    beforeEdit = aimed.snapshot;
    assertRustTerrainCheckpoint(beforeEdit, options.expectedArtifactHash, "before-edit");
    assertCondition(beforeEdit.state.performance.streaming.playerEdits.total === 0,
      "Player-edit diagnostics were not neutral before the trusted gesture.");
    assertCondition(canonicalSavedEdits(beforeEdit.storage).count === 0,
      "Canonical save contained terrain edits immediately before mining.");
    assertCondition(!savedEditAt(beforeEdit.storage, targetEvidence.position).found,
      "Selected coordinate already had a persisted player edit before mining.");
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "02-target-before-break");

    const releaseMining = await beginTrustedMining(page, cdp, aimed.inputMode);
    try {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(200);
        const snapshot = await readAndRecord("mining-gesture");
        const edits = snapshot?.state?.performance?.streaming?.playerEdits;
        if (edits?.total === 1 && edits?.byKind?.break === 1) {
          afterGesture = snapshot;
          break;
        }
      }
    } finally {
      await releaseMining().catch(() => undefined);
    }
    assertCondition(afterGesture, "Trusted held terrain-action input did not break the selected terrain cell.");
    await page.waitForTimeout(50);
    afterGesture = await readAndRecord("mining-input-release");
    const settleDeadline = Date.now() + 45_000;
    while (Date.now() < settleDeadline) {
      const edits = afterGesture?.state?.performance?.streaming?.playerEdits;
      const generation = afterGesture?.state?.performance?.streaming?.generationWorker;
      if (edits?.last?.pendingConsolidations === 0
        && edits?.pendingConsolidationTransactions === 0
        && edits?.mutationToLocalMeshVisible?.count === 1
        && generation?.acceptingRequests === true) break;
      await page.waitForTimeout(200);
      afterGesture = await readAndRecord("edit-settlement");
    }
    assertRustTerrainCheckpoint(afterGesture, options.expectedArtifactHash, "after-gesture");
    terrainReadiness.afterEdit = await waitForRustMultiplayerVisualTerrainReadiness(
      page,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "terrain-edit-after-edit",
        failureStage: "terrain-readiness-after-edit",
        readSnapshot: async () => readAndRecord("visual-terrain-after-edit", "playing"),
        onObservation: (assessment) => { terrainReadiness.afterEdit = { status: "pending", assessment }; },
      },
    );
    afterGesture = await readAndRecord("after-edit-visually-stable", "playing");
    const inputProof = assertTrustedPlayerGesture(afterGesture.audit);
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "03-after-trusted-break");

    if (aimed.inputMode === "public-touch-controls") {
      const pauseButton = page.getByRole("button", { name: "Pause game" });
      const pauseBox = await pauseButton.boundingBox();
      assertCondition(pauseBox, "Public Pause game control has no visible bounds.");
      await page.touchscreen.tap(pauseBox.x + pauseBox.width / 2, pauseBox.y + pauseBox.height / 2);
    } else await page.keyboard.press("Escape");
    await page.getByRole("heading", { name: "Game Paused" }).waitFor();
    const paused = await readAndRecord("paused-before-save", "paused");
    assertCondition(JSON.stringify(poseFromState(paused.state, "Paused"))
      === JSON.stringify(poseFromState(beforeEdit.state, "Before edit")),
    "Mining or pausing moved the exact rounded player pose.");
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "04-paused-before-save");
    await page.getByRole("button", { name: "Save & Quit to Title" }).click({ noWaitAfter: true });
    const continueButton = page.getByRole("button", { name: /Continue/u });
    await continueButton.waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => [...document.querySelectorAll("button")]
      .some((button) => /Continue/u.test(button.textContent ?? "") && !button.disabled), undefined, { timeout: 120_000 });
    titleAfterSave = await readAndRecord("title-after-save");
    assertCondition(titleAfterSave.state?.state === "title", "Save & Quit did not reach title state.");
    assertCondition(savedEditAt(titleAfterSave.storage, targetEvidence.position).type === AIR_BLOCK_ID,
      "Save & Quit did not persist Air at the exact broken coordinate.");
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "05-title-after-save");

    await page.reload({
      waitUntil: "domcontentloaded",
      timeout: Math.min(options.timeoutMilliseconds, 120_000),
    });
    assertCondition(new URL(page.url()).search === "", "Fresh reload introduced an experimental route selector.");
    await waitForHarness(page, options.timeoutMilliseconds);
    const freshContinue = page.getByRole("button", { name: /Continue/u });
    titleVisualReadiness = await waitForTerrainEditReloadTitleVisualReadiness(
      page,
      Math.min(options.timeoutMilliseconds, 120_000),
    );
    titleAfterReload = await readAndRecord("title-after-full-reload");
    assertCondition(savedEditAt(titleAfterReload.storage, targetEvidence.position).type === AIR_BLOCK_ID,
      "Fresh browser document did not retain Air at the exact broken coordinate.");
    // The state read can land on the first client catalog reconciliation after
    // hydration. Require the complete menu to settle again before retaining
    // pixels; DOM bounds from the earlier pass alone do not prove that the
    // reinserted dynamic labels reached the compositor.
    titleVisualReadiness = await waitForTerrainEditReloadTitleVisualReadiness(
      page,
      Math.min(options.timeoutMilliseconds, 120_000),
    );
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "06-title-after-full-reload");
    await freshContinue.click({ noWaitAfter: true });
    continued = await waitForGameplay("fresh-continue-ready");
    const targetDeadline = Date.now() + 15_000;
    while (Date.now() < targetDeadline) {
      const target = continued?.state?.target;
      if (target?.type !== "mob") break;
      await page.waitForTimeout(150);
      continued = await readAndRecord("fresh-continue-target", "playing");
    }
    terrainReadiness.freshContinue = await waitForRustMultiplayerVisualTerrainReadiness(
      page,
      Math.min(options.timeoutMilliseconds, 180_000),
      {
        label: "terrain-edit-fresh-continue",
        failureStage: "terrain-readiness-fresh-continue",
        readSnapshot: async () => readAndRecord("visual-terrain-fresh-continue", "playing"),
        onObservation: (assessment) => { terrainReadiness.freshContinue = { status: "pending", assessment }; },
      },
    );
    continued = await readAndRecord("fresh-continue-visually-stable", "playing");
    const persistence = assertTerrainEditPersistenceEvidence({
      beforeEdit,
      afterGesture,
      titleAfterSave,
      titleAfterReload,
      continued,
      selection: targetEvidence,
    });
    await captureScreenshot(page, options.repositoryRoot, options.outputDirectory, screenshots, "07-continued-edited-terrain");

    assertCondition(routeRequests.some((request) => request.status === 200
      && request.pathname === `/engine/${options.expectedArtifactHash}/${selection.wasm.path}`
      && request.bytes === selection.wasm.bytes
      && request.sha256 === selection.wasm.sha256),
    "Browser did not load the exact expected content-addressed Wasm artifact.");
    assertCondition(streams.externalRequests.length === 0, "Browser attempted an unmanaged external request.");
    assertTerrainEditBrowserErrorStreams(streams);
    result = {
      schema: 1,
      gate: "blockwild-rust-terrain-player-edit-reload-browser-v1",
      status: "passed",
      createdAt: new Date().toISOString(),
      authorityClaim: "rust-terrain-generation-plus-typescript-player-edit-persistence-only",
      artifact: {
        hash: options.expectedArtifactHash,
        directory: relativeEvidencePath(options.repositoryRoot, selection.directory),
        sourceSnapshot: selection.sourceSnapshot,
        treeSnapshot: selection.treeSnapshot,
        wasm: selection.wasm,
        requests: routeRequests,
      },
      generation: {
        buildProfile: "rust-primary",
        mode: "rust",
        selectionSource: "build-rust-primary",
        certificate: TERRAIN_EDIT_GENERATION_CERTIFICATE,
      },
      fixture: TERRAIN_EDIT_WORLD_FIXTURE,
      terrainReadiness,
      titleVisualReadiness,
      target: targetEvidence,
      inputProof,
      persistence,
      checkpoints: {
        beforeEdit,
        afterGesture,
        titleAfterSave,
        titleAfterReload,
        continued,
      },
      harness: {
        baseUrl: managedServer.baseUrl,
        managedVite: true,
        hmr: managedServer.inlineConfig.server.hmr,
        watch: "ignore-all",
        productionRouteSearch: "",
        playerAuthority: "typescript",
        inputMode: aimed.inputMode,
        browserProfileToken: path.basename(profileDirectory),
        browserExecutable: browserExecutable ?? "playwright-managed",
        playwrightSource: playwright.source,
        browserGateMutex: browserMutexEvidence,
      },
      coverage: {
        deterministicRealUiCreate: "passed",
        exactRustTerrainArtifactAnd155CaseCertificate: "passed",
        exactImmediateRing: "9/9",
        trustedPointerTargeting: "passed",
        trustedHeldMouseMining: "passed",
        exactSingleCellBreakAndMeshSettlement: "passed",
        realSaveAndQuit: "passed",
        freshPageReload: "passed",
        completePostReloadTitleMenuVisualReadiness: `${TERRAIN_EDIT_TITLE_VISUAL_STABLE_SAMPLES} stable compositor observations`,
        freshContinue: "passed",
        exactCoordinateAirEditPersistence: "passed",
        identicalPoseRayTraversalAfterReload: "passed",
      },
      screenshots,
      canonicalAssetRequests,
      errors: streams,
      cleanup,
      exclusions: {
        playerAuthority: "This terrain-only gate deliberately uses the normal TypeScript player action path and makes no R5 player-authority claim.",
        mutationSurface: "The verifier uses trusted browser player events and read-only public render/storage observations; it does not call a world mutation or diagnostic edit hook.",
        broaderAuthority: "Simulation, combat, multiplayer, and renderer promotion remain outside this bounded edit-persistence gate.",
      },
    };
    }
  } catch (error) {
    if (page) {
      const failedPath = path.join(options.outputDirectory, "failed.png");
      await page.screenshot({ path: failedPath, type: "png" }).then(() => {
        screenshots.failed = relativeEvidencePath(options.repositoryRoot, failedPath);
      }).catch(() => undefined);
    }
    result = {
      schema: 1,
      gate: scenario?.gate ?? "blockwild-rust-terrain-player-edit-reload-browser-v1",
      status: "failed",
      createdAt: new Date().toISOString(),
      authorityClaim: "none",
      artifact: {
        hash: options.expectedArtifactHash,
        directory: relativeEvidencePath(options.repositoryRoot, selection.directory),
        ...(scenario ? { sourceSnapshot: selection.sourceSnapshot, treeSnapshot: selection.treeSnapshot,
          wasm: selection.wasm, requests: routeRequests } : {}),
      },
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      target: targetEvidence,
      state: lastSnapshot?.state ?? null,
      runtime: lastSnapshot?.runtime ?? null,
      storage: lastSnapshot?.storage ?? null,
      ...(scenario ? { audit: lastSnapshot?.audit ?? null } : {}),
      browserGateMutex: browserMutexEvidence,
      terrainReadiness,
      titleVisualReadiness,
      ...(error && typeof error === "object" && "terrainReadinessEvidence" in error
        ? { terrainReadinessEvidence: error.terrainReadinessEvidence }
        : {}),
      ...(error && typeof error === "object" && "titleVisualReadinessEvidence" in error
        ? { titleVisualReadinessEvidence: error.titleVisualReadinessEvidence }
        : {}),
      screenshots,
      routeRequests,
      canonicalAssetRequests,
      errors: streams,
      cleanup,
    };
  } finally {
    cleanup.databasePathsBeforeCleanup = findOwnedDatabasePaths(profileDirectory);
    if (context) {
      await context.close().then(() => { cleanup.browserClosed = true; }).catch((error) => {
        boundedPush(streams.runtimeErrors, `browser cleanup: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    cleanup.browserDisconnected = browser === null
      ? !cleanup.browserStarted
      : await waitForBrowserDisconnect(browser).catch((error) => {
        boundedPush(streams.runtimeErrors, `browser disconnect: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      });
    if (managedServer) {
      try {
        managedServer.server.httpServer?.closeAllConnections?.();
        await managedServer.server.close();
        cleanup.serverClosed = managedServer.server.httpServer?.listening !== true;
      } catch (error) {
        boundedPush(streams.runtimeErrors, `Vite cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
      try { cleanup.serverPortRefused = await waitForRustMultiplayerPortRefusal(managedServer.port); }
      catch (error) { boundedPush(streams.runtimeErrors, `Vite port cleanup: ${error instanceof Error ? error.message : String(error)}`); }
      try { cleanup.environmentRestored = managedServer.restoreEnvironment(); }
      catch (error) { boundedPush(streams.runtimeErrors, `environment cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    } else if (managedServerAttempt) {
      cleanup.serverStarted = managedServerAttempt.server !== null;
      cleanup.serverClosed = managedServerAttempt.serverClosed;
      cleanup.serverPortRefused = managedServerAttempt.portRefused;
      cleanup.environmentRestored = managedServerAttempt.environmentRestored;
    }
    try { cleanup.candidateUnchanged = Boolean(assertTerrainEditCandidateUnchanged(selection)); }
    catch (error) { boundedPush(streams.runtimeErrors, `candidate drift: ${error instanceof Error ? error.message : String(error)}`); }
    cleanup.aliveChildPidsAfterCleanup = cleanup.trackedChildPids.filter((pid) => {
      try { return exactProcessAlive(pid); }
      catch (error) {
        boundedPush(streams.runtimeErrors, `process cleanup ${pid}: ${error instanceof Error ? error.message : String(error)}`);
        return true;
      }
    });
    if (cleanup.browserDisconnected && cleanup.aliveChildPidsAfterCleanup.length === 0) {
      try { cleanup.profileRemoved = safeRemoveTerrainEditOwnedDirectory(profileRoot, profileDirectory, PROFILE_PREFIX); }
      catch (error) { boundedPush(streams.runtimeErrors, `profile cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    } else boundedPush(streams.runtimeErrors, "profile cleanup refused before exact browser process shutdown.");
    cleanup.databasePathsAfterCleanup = existsSync(profileDirectory) ? findOwnedDatabasePaths(profileDirectory) : [];
    cleanup.databasePathsRemoved = cleanup.profileRemoved && cleanup.databasePathsAfterCleanup.length === 0;
    try {
      if (existsSync(profileRoot) && readdirSync(profileRoot).length === 0) rmdirSync(profileRoot);
      cleanup.profileRootRemoved = !existsSync(profileRoot);
    } catch (error) { boundedPush(streams.runtimeErrors, `profile-root cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    if (cleanup.serverClosed && cleanup.serverPortRefused && cleanup.environmentRestored) {
      try {
        cleanup.viteRuntimeRemoved = safeRemoveTerrainEditOwnedDirectory(
          options.outputDirectory,
          viteRuntimeDirectory,
          VITE_RUNTIME_PREFIX,
        );
      } catch (error) { boundedPush(streams.runtimeErrors, `Vite-runtime cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    } else boundedPush(streams.runtimeErrors, "Vite-runtime cleanup refused before server/environment cleanup.");
    if (browserMutex) {
      try { cleanup.browserMutexReleased = await browserMutex.release(); }
      catch (error) {
        cleanup.browserMutexReleased = false;
        boundedPush(streams.runtimeErrors, `browser mutex cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    cleanup.eventsDrained = true;
    collectionState.active = false;
    let cleanupError = null;
    try { assertTerrainEditCleanupEvidence(cleanup); }
    catch (error) { cleanupError = error; }
    let streamError = null;
    try { assertTerrainEditBrowserErrorStreams(streams); }
    catch (error) { streamError = error; }
    if (cleanupError || streamError || result?.status !== "passed") {
      result = {
        ...result,
        status: "failed",
        authorityClaim: "none",
        error: result?.error ?? cleanupError?.message ?? streamError?.message
          ?? "Terrain edit browser, cleanup, or error-stream gate failed.",
      };
    }
    result.cleanup = cleanup;
    result.errors = streams;
    result.screenshots = screenshots;
    writeFileSync(path.join(options.outputDirectory, "errors.json"), `${JSON.stringify(streams, null, 2)}\n`, "utf8");
    writeFileSync(path.join(options.outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return Object.freeze({ ...result, outputPath: path.join(options.outputDirectory, "result.json") });
}

export function usage() {
  return `Usage: node scripts/verify-rust-terrain-edit-reload-browser.mjs \\
  --engine-dir public/engine \\
  --expected-artifact-hash ${REQUIRED_TERRAIN_EDIT_ARTIFACT_HASH} \\
  --output <directory strictly beneath work/> \\
  [--timeout-ms <60000..900000>] [--playwright-module <path>] \\
  [--browser-executable <path>] [--headed]\n\nThe verifier owns a rust-primary HMR-off Vite server and a dedicated browser profile. It creates one world through the real UI, selects and mines one safe terrain cell through trusted player input (pointer-lock mouse or visible public touch controls), then proves the exact Air edit after Save & Quit, a fresh page reload, and Continue.\n`;
}

async function main() {
  try {
    const result = await runTerrainEditReloadBrowser(process.argv);
    if (result.help) {
      process.stdout.write(result.usage);
      return;
    }
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      artifactHash: result.artifact?.hash ?? null,
      target: result.target ?? null,
      persistence: result.persistence ? {
        coordinate: result.persistence.coordinate,
        replacementBlockId: result.persistence.replacementBlockId,
        canonicalEditSha256: result.persistence.canonicalEditSha256,
      } : null,
      screenshots: result.screenshots,
      cleanup: result.cleanup,
      outputPath: result.outputPath,
      error: result.error ?? null,
    }, null, 2)}\n`);
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Rust terrain edit/reload verifier failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectInvocation(import.meta.url)) await main();
