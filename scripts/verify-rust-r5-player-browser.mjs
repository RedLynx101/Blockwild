import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RustEngineToolError,
  createRustEngineSourceSnapshot,
  findRepositoryRoot,
  isDirectInvocation,
  validatePublishedArtifacts,
} from "./rust-engine-common.mjs";

const ARTIFACT_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const GENERATION_HASH_PATTERN = /^[a-f0-9]{32}$/u;
const PROFILE_PREFIX = "blockwild-r5-browser-";
const DEFAULT_TIMEOUT_MILLISECONDS = 240_000;
const INTERNAL_MANAGED_VITE_COMMAND = "--internal-managed-vite";
const WORLD_FIXTURE = Object.freeze({
  name: "R5 Current Source Acceptance",
  seed: "MOON-FIELD-505",
  mode: "survival",
  expectedSpawn: Object.freeze([4, 43.51, 0]),
});
export const R5_NATIVE_SURVIVAL_WORLD_FIXTURE = Object.freeze({
  name: "R5 Native Survival Environment Acceptance",
  seed: "RUST-SWIM-002",
  mode: "survival",
  expectedSpawn: Object.freeze([4, 38.51, -10]),
  waterApproach: "s",
  shoreReturn: "w",
  shoreMantleBounds: Object.freeze({
    minimumX: 3.5,
    maximumX: 4.5,
    minimumY: 33.49,
    maximumY: 33.7,
    minimumZ: -6.2,
    maximumZ: -5.8,
  }),
});
export const R5_PLAYER_BROWSER_SCENARIOS = Object.freeze([
  "movement-persistence",
  "native-survival-environment",
  "native-survival-death-respawn",
]);

export const R5_GENERATION_CERTIFICATE = Object.freeze({
  corpusCases: 155,
  corpusHash: "5d4e6b1445b00f3430164d1a8093d8dc",
});

const INPUT_BUTTON = Object.freeze({ jump: 1, sprint: 4 });
const R5_NATIVE_INPUT_AXIS_MAX = 32_767;
const AUTHORITY_FLAG = Object.freeze({ mounted: 4 });
const R5_NATIVE_EFFECT_RING_CAPACITY = 256;
export const R5_JUMP_TRAJECTORY_THRESHOLDS = Object.freeze({
  takeoffRise: 0.08,
  minimumPeakRise: 0.2,
  minimumAscentVelocity: 0.1,
  maximumDescentVelocity: -0.1,
  landingHeightTolerance: 0.12,
  landingVelocityTolerance: 0.08,
  landingHeightStability: 0.03,
  requiredLandingSamples: 3,
});
export const MANAGED_BROWSER_GATE_MUTEX_HOST = "127.0.0.1";
const MANAGED_BROWSER_GATE_MUTEX_MIN_PORT = 41_000;
const MANAGED_BROWSER_GATE_MUTEX_PORT_SPAN = 8_000;

const OPTION_DEFINITIONS = Object.freeze({
  "repo-root": "string",
  "expected-artifact-hash": "string",
  output: "string",
  "base-url": "string",
  "engine-dir": "string",
  "timeout-ms": "integer",
  "playwright-module": "string",
  "browser-executable": "string",
  scenario: "string",
  headed: "boolean",
  help: "boolean",
});

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".ts", "text/plain; charset=utf-8"],
]);

const MANAGED_CANONICAL_ASSETS = new Map([
  ["https://blockwild.app/manifest.webmanifest", "manifest.webmanifest"],
  ["https://blockwild.app/brand/blockwild-icon-16.png", "brand/blockwild-icon-16.png"],
  ["https://blockwild.app/brand/blockwild-icon-32.png", "brand/blockwild-icon-32.png"],
  ["https://blockwild.app/brand/blockwild-icon-64.png", "brand/blockwild-icon-64.png"],
  ["https://blockwild.app/brand/blockwild-icon-192.png", "brand/blockwild-icon-192.png"],
  ["https://blockwild.app/brand/blockwild-icon-512.png", "brand/blockwild-icon-512.png"],
]);

function fail(message, details) {
  throw new RustEngineToolError(message, details);
}

function parseRawOptions(argv) {
  const parsed = Object.create(null);
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const type = OPTION_DEFINITIONS[key];
    if (!type) fail(`Unknown option: ${token}`);
    if (Object.hasOwn(parsed, key)) fail(`${token} may only be provided once.`);
    if (type === "boolean") {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value.`);
    if (type === "integer") {
      if (!/^[0-9]+$/u.test(value)) fail(`${token} requires a base-10 integer, received ${value}.`);
      parsed[key] = Number(value);
    } else parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function pathIsInside(parentDirectory, candidatePath) {
  const relation = path.relative(parentDirectory, candidatePath);
  return relation.length > 0 && relation !== ".." && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation);
}

function nearestExistingPath(candidatePath) {
  let current = path.resolve(candidatePath);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) fail(`No existing ancestor was found for ${candidatePath}.`);
    current = parent;
  }
  return current;
}

export function resolveManagedCanonicalAsset(repositoryRoot, requestUrl) {
  const relativeAssetPath = MANAGED_CANONICAL_ASSETS.get(requestUrl);
  if (!relativeAssetPath) return null;
  const publicRoot = path.resolve(repositoryRoot, "public");
  if (!existsSync(publicRoot) || lstatSync(publicRoot).isSymbolicLink() || !statSync(publicRoot).isDirectory()) {
    fail(`Managed canonical asset root must be a non-symlink directory: ${publicRoot}`);
  }
  let cursor = publicRoot;
  const segments = relativeAssetPath.split("/");
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    if (!existsSync(cursor)) fail(`Managed canonical asset is missing: ${cursor}`);
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink()) fail(`Managed canonical asset path must not traverse a symlink: ${cursor}`);
    const isLast = index === segments.length - 1;
    if (isLast ? !entry.isFile() : !entry.isDirectory()) {
      fail(`Managed canonical asset path has the wrong entry type: ${cursor}`);
    }
  }
  const canonicalPublicRoot = realpathSync(publicRoot);
  const canonicalAssetPath = realpathSync(cursor);
  if (!pathIsInside(canonicalPublicRoot, canonicalAssetPath)) {
    fail(`Managed canonical asset resolves outside public/: ${canonicalAssetPath}`);
  }
  return Object.freeze({
    requestUrl,
    relativeAssetPath,
    filePath: canonicalAssetPath,
    contentType: contentType(canonicalAssetPath),
  });
}

export function resolveWorkOutputDirectory(repositoryRoot, requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.length === 0) fail("--output is required.");
  const workRoot = path.resolve(repositoryRoot, "work");
  if (!existsSync(workRoot) || !statSync(workRoot).isDirectory()) fail(`Repository work directory is missing: ${workRoot}`);
  const output = path.resolve(repositoryRoot, requestedPath);
  if (!pathIsInside(workRoot, output)) fail(`--output must resolve strictly beneath ${workRoot}; received ${output}.`);
  if (existsSync(output)) {
    const entry = lstatSync(output);
    if (entry.isSymbolicLink() || !entry.isDirectory()) fail(`--output must be a non-symlink directory: ${output}`);
  }
  const canonicalWork = realpathSync(workRoot);
  const canonicalAncestor = realpathSync(nearestExistingPath(output));
  if (canonicalAncestor !== canonicalWork && !pathIsInside(canonicalWork, canonicalAncestor)) {
    fail(`--output resolves through an ancestor outside the canonical work directory: ${canonicalAncestor}`);
  }
  return output;
}

function resolveEngineDirectory(repositoryRoot, requestedPath) {
  if (requestedPath === undefined) {
    fail("--engine-dir is required for the isolated R5 current-source candidate gate.");
  }
  const publicRoot = path.resolve(repositoryRoot, "public");
  const expectedCandidate = path.join(publicRoot, "engine-locator-candidate");
  const candidate = path.resolve(repositoryRoot, requestedPath);
  if (path.relative(expectedCandidate, candidate) !== "") {
    fail(`--engine-dir must resolve exactly to ${expectedCandidate}; received ${candidate}.`);
  }
  if (!existsSync(candidate) || !statSync(candidate).isDirectory() || lstatSync(candidate).isSymbolicLink()) {
    fail(`--engine-dir must be an existing non-symlink artifact index directory: ${candidate}`);
  }
  const canonicalPublic = realpathSync(publicRoot);
  const canonicalCandidate = realpathSync(candidate);
  const canonicalExpectedCandidate = path.join(canonicalPublic, "engine-locator-candidate");
  if (path.relative(canonicalExpectedCandidate, canonicalCandidate) !== ""
    || !pathIsInside(canonicalPublic, canonicalCandidate)) {
    fail(`--engine-dir must resolve canonically to ${canonicalExpectedCandidate}; received ${canonicalCandidate}.`);
  }
  return canonicalCandidate;
}

function normalizeBaseUrl(value) {
  if (value === undefined) return null;
  let parsed;
  try { parsed = new URL(value); } catch { fail(`--base-url is not a valid URL: ${value}`); }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) fail("--base-url must use http or https.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail("--base-url must not contain credentials, a query, or a fragment.");
  }
  return parsed.href.replace(/\/$/u, "");
}

export function parseR5BrowserOptions(argv = process.argv, context = {}) {
  const raw = parseRawOptions(argv);
  const repositoryRoot = raw["repo-root"]
    ? findRepositoryRoot(path.resolve(context.cwd ?? process.cwd(), raw["repo-root"]))
    : findRepositoryRoot(context.cwd ?? process.cwd());
  if (raw.help) return Object.freeze({ help: true, repositoryRoot });
  const expectedArtifactHash = raw["expected-artifact-hash"];
  if (!ARTIFACT_HASH_PATTERN.test(expectedArtifactHash ?? "")) {
    fail("--expected-artifact-hash is required and must be a lowercase 32-byte SHA-256 digest (64 hexadecimal characters).");
  }
  const timeoutMilliseconds = raw["timeout-ms"] ?? DEFAULT_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 30_000 || timeoutMilliseconds > 900_000) {
    fail("--timeout-ms must be an integer from 30000 through 900000.");
  }
  const outputDirectory = resolveWorkOutputDirectory(repositoryRoot, raw.output);
  const scenario = raw.scenario ?? R5_PLAYER_BROWSER_SCENARIOS[0];
  if (!R5_PLAYER_BROWSER_SCENARIOS.includes(scenario)) {
    fail(`--scenario must be one of ${R5_PLAYER_BROWSER_SCENARIOS.join(", ")}; received ${String(scenario)}.`);
  }
  return Object.freeze({
    help: false,
    repositoryRoot,
    expectedArtifactHash,
    outputDirectory,
    baseUrl: normalizeBaseUrl(raw["base-url"]),
    engineDirectory: resolveEngineDirectory(repositoryRoot, raw["engine-dir"]),
    timeoutMilliseconds,
    playwrightModule: raw["playwright-module"] ? path.resolve(repositoryRoot, raw["playwright-module"]) : null,
    browserExecutable: raw["browser-executable"] ? path.resolve(repositoryRoot, raw["browser-executable"]) : null,
    scenario,
    headless: raw.headed !== true,
  });
}

export function managedBrowserGateMutexPort(repositoryRoot) {
  const canonicalRoot = realpathSync(repositoryRoot);
  const digest = createHash("sha256").update(`blockwild-managed-browser-gate-v1\n${canonicalRoot}`, "utf8").digest();
  return MANAGED_BROWSER_GATE_MUTEX_MIN_PORT
    + (digest.readUInt16BE(0) % MANAGED_BROWSER_GATE_MUTEX_PORT_SPAN);
}

export async function acquireManagedBrowserGateMutex(repositoryRoot, options = {}) {
  const host = options.host ?? MANAGED_BROWSER_GATE_MUTEX_HOST;
  const requestedPort = options.port ?? managedBrowserGateMutexPort(repositoryRoot);
  assertCondition(typeof host === "string" && host.length > 0, "Managed browser mutex host is invalid.");
  assertCondition(Number.isSafeInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65_535,
    `Managed browser mutex port is invalid: ${String(requestedPort)}`);
  const server = (options.createServer ?? createNetServer)((socket) => socket.destroy());
  const evidence = {
    schema: 1,
    mechanism: "exclusive-loopback-listener-os-released",
    repositoryRoot: realpathSync(repositoryRoot),
    host,
    requestedPort,
    port: null,
    status: "acquiring",
    acquiredAt: null,
    releasedAt: null,
    released: false,
  };
  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host, port: requestedPort, exclusive: true });
    });
  } catch (cause) {
    evidence.status = cause?.code === "EADDRINUSE" ? "contended" : "failed";
    evidence.errorCode = cause?.code ?? null;
    evidence.error = cause instanceof Error ? cause.message : String(cause);
    const error = new Error(
      evidence.status === "contended"
        ? `Another managed Blockwild browser gate, or an unrelated process on its exact mutex port, is already active at ${host}:${requestedPort}.`
        : `Managed Blockwild browser gate mutex failed at ${host}:${requestedPort}: ${evidence.error}`,
      { cause },
    );
    error.code = evidence.status === "contended"
      ? "BLOCKWILD_BROWSER_GATE_OVERLAP"
      : "BLOCKWILD_BROWSER_GATE_MUTEX_FAILURE";
    error.browserGateMutex = evidence;
    throw error;
  }
  const address = server.address();
  assertCondition(address && typeof address === "object", "Managed browser mutex did not expose its loopback address.");
  evidence.port = address.port;
  evidence.status = "acquired";
  evidence.acquiredAt = new Date().toISOString();
  server.unref();
  let releasePromise = null;
  return Object.freeze({
    server,
    evidence,
    release() {
      if (releasePromise) return releasePromise;
      releasePromise = new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            evidence.status = "release-failed";
            evidence.errorCode = error.code ?? null;
            evidence.error = error.message;
            reject(error);
            return;
          }
          evidence.status = "released";
          evidence.released = true;
          evidence.releasedAt = new Date().toISOString();
          resolve(true);
        });
      });
      return releasePromise;
    },
  });
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function finite(value, label) {
  assertCondition(typeof value === "number" && Number.isFinite(value), `${label} is not finite: ${String(value)}`);
  return value;
}

export function r5HorizontalMovementEngaged(snapshot, expectedSprinting) {
  assertCondition(typeof expectedSprinting === "boolean", "R5 movement expectation must identify sprinting state");
  const velocity = snapshot?.state?.player?.velocity;
  assertCondition(Array.isArray(velocity) && velocity.length === 3, "R5 movement velocity is absent");
  const horizontalSpeed = Math.hypot(
    finite(velocity[0], "R5 movement velocity x"),
    finite(velocity[2], "R5 movement velocity z"),
  );
  return snapshot.state.player?.sprinting === expectedSprinting && horizontalSpeed > 1;
}

function nonNegativeSafeInteger(value, label) {
  assertCondition(Number.isSafeInteger(value) && value >= 0, `${label} is not a non-negative safe integer: ${String(value)}`);
  return value;
}

export function r5JumpTrajectorySample(snapshot, metadata = {}) {
  const player = snapshot?.state?.player;
  const pump = snapshot?.runtime?.playerAuthority?.pump;
  const position = player?.position;
  const velocity = player?.velocity;
  assertCondition(Array.isArray(position) && position.length === 3, "R5 jump position is absent");
  assertCondition(Array.isArray(velocity) && velocity.length === 3, "R5 jump velocity is absent");
  const phase = metadata.phase ?? "observation";
  const ordinal = metadata.ordinal ?? 0;
  assertCondition(typeof phase === "string" && phase.length > 0, "R5 jump phase is absent");
  return Object.freeze({
    ordinal: nonNegativeSafeInteger(ordinal, "R5 jump sample ordinal"),
    phase,
    authorityTick: nonNegativeSafeInteger(pump?.lastAuthorityTick, "R5 jump authority tick"),
    extractionRevision: nonNegativeSafeInteger(pump?.lastExtractionRevision, "R5 jump extraction revision"),
    appliedInputSequence: Math.max(0, nonNegativeSafeInteger(pump?.nextInputSequence, "R5 jump next input sequence") - 1),
    lastAppliedButtons: nonNegativeSafeInteger(pump?.lastAppliedButtons, "R5 jump applied buttons"),
    positionY: finite(position[1], "R5 jump position y"),
    velocityY: finite(velocity[1], "R5 jump velocity y"),
  });
}

function validatedJumpSample(sample, index) {
  assertCondition(sample && typeof sample === "object", `R5 jump sample ${index} is absent`);
  const phase = sample.phase;
  assertCondition(typeof phase === "string" && phase.length > 0, `R5 jump sample ${index} phase is absent`);
  return Object.freeze({
    ordinal: nonNegativeSafeInteger(sample.ordinal, `R5 jump sample ${index} ordinal`),
    phase,
    authorityTick: nonNegativeSafeInteger(sample.authorityTick, `R5 jump sample ${index} authority tick`),
    extractionRevision: nonNegativeSafeInteger(sample.extractionRevision, `R5 jump sample ${index} extraction revision`),
    appliedInputSequence: nonNegativeSafeInteger(sample.appliedInputSequence, `R5 jump sample ${index} input sequence`),
    lastAppliedButtons: nonNegativeSafeInteger(sample.lastAppliedButtons, `R5 jump sample ${index} buttons`),
    positionY: finite(sample.positionY, `R5 jump sample ${index} position y`),
    velocityY: finite(sample.velocityY, `R5 jump sample ${index} velocity y`),
  });
}

export function summarizeR5JumpTrajectory(baseY, samples) {
  const groundedY = finite(baseY, "R5 jump base y");
  assertCondition(Array.isArray(samples), "R5 jump trajectory samples are absent");
  const captured = Object.freeze(samples.map(validatedJumpSample));
  let takeoffIndex = -1;
  let peakIndex = -1;
  let heightIndex = -1;
  let descentIndex = -1;
  let peakY = groundedY;
  const landingSamples = [];
  let priorLanding = null;

  for (const [index, sample] of captured.entries()) {
    const rise = sample.positionY - groundedY;
    if (takeoffIndex < 0
      && Boolean(sample.lastAppliedButtons & INPUT_BUTTON.jump)
      && rise > R5_JUMP_TRAJECTORY_THRESHOLDS.takeoffRise
      && sample.velocityY > R5_JUMP_TRAJECTORY_THRESHOLDS.minimumAscentVelocity) {
      takeoffIndex = index;
    }
    if (takeoffIndex < 0 || index < takeoffIndex) continue;
    if (peakIndex < 0 || sample.positionY > peakY) {
      peakY = sample.positionY;
      peakIndex = index;
    }
    if (heightIndex < 0 && rise > R5_JUMP_TRAJECTORY_THRESHOLDS.minimumPeakRise) heightIndex = index;
    if (descentIndex < 0 && heightIndex >= 0 && index >= heightIndex
      && sample.velocityY < R5_JUMP_TRAJECTORY_THRESHOLDS.maximumDescentVelocity) {
      descentIndex = index;
    }
    if (descentIndex < 0 || index <= descentIndex) continue;
    const grounded = Math.abs(sample.positionY - groundedY) <= R5_JUMP_TRAJECTORY_THRESHOLDS.landingHeightTolerance
      && Math.abs(sample.velocityY) <= R5_JUMP_TRAJECTORY_THRESHOLDS.landingVelocityTolerance;
    if (!grounded) {
      landingSamples.length = 0;
      priorLanding = null;
      continue;
    }
    // Presentation extraction can revise more than once while the same
    // authoritative simulation tick is visible. Landing stability is a
    // simulation claim, so same-tick presentation revisions are duplicates;
    // treating them as a failed next tick continually reset the proof.
    if (priorLanding && sample.authorityTick === priorLanding.authorityTick) continue;
    const stable = !priorLanding
      || (sample.authorityTick > priorLanding.authorityTick
        && Math.abs(sample.positionY - priorLanding.positionY) <= R5_JUMP_TRAJECTORY_THRESHOLDS.landingHeightStability);
    if (!stable) landingSamples.length = 0;
    landingSamples.push(sample);
    priorLanding = sample;
  }

  const takeoff = takeoffIndex >= 0 ? captured[takeoffIndex] : null;
  const height = heightIndex >= 0 ? captured[heightIndex] : null;
  const descending = descentIndex >= 0 ? captured[descentIndex] : null;
  const peak = peakIndex >= 0 ? captured[peakIndex] : null;
  const landing = landingSamples.length >= R5_JUMP_TRAJECTORY_THRESHOLDS.requiredLandingSamples
    ? landingSamples.at(-1)
    : null;
  return Object.freeze({
    schema: 1,
    baseY: groundedY,
    thresholds: R5_JUMP_TRAJECTORY_THRESHOLDS,
    samples: captured,
    takeoff,
    height,
    peak,
    peakRise: peak ? peak.positionY - groundedY : 0,
    descending,
    landing,
    landingSamples: Object.freeze([...landingSamples]),
    complete: takeoff !== null && height !== null && descending !== null && landing !== null,
  });
}

export function assertR5JumpTrajectoryEvidence(evidence) {
  assertCondition(evidence?.takeoff !== null && evidence?.takeoff !== undefined,
    "Jump trajectory did not prove an authoritative jump-button takeoff with positive vertical velocity.");
  assertCondition(evidence?.peakRise > R5_JUMP_TRAJECTORY_THRESHOLDS.minimumPeakRise,
    `Jump trajectory peak rise ${String(evidence?.peakRise)} did not exceed ${R5_JUMP_TRAJECTORY_THRESHOLDS.minimumPeakRise}.`);
  assertCondition(evidence?.descending?.velocityY < R5_JUMP_TRAJECTORY_THRESHOLDS.maximumDescentVelocity,
    "Jump trajectory did not prove an authoritative descending phase after reaching the minimum height.");
  assertCondition(evidence?.landing !== null && evidence?.landing !== undefined
    && evidence?.landingSamples?.length >= R5_JUMP_TRAJECTORY_THRESHOLDS.requiredLandingSamples,
  "Jump trajectory did not prove a stable authoritative landing at the original ground height.");
  assertCondition(evidence.complete === true, "Jump trajectory is not complete.");
  return evidence;
}

export function r5MovementSampleEvidence(snapshot) {
  const authority = snapshot?.runtime?.playerAuthority;
  const pump = authority?.pump;
  const player = snapshot?.state?.player;
  const position = player?.position;
  const velocity = player?.velocity;
  assertCondition(Array.isArray(position) && position.length === 3, "R5 movement position is absent");
  assertCondition(Array.isArray(velocity) && velocity.length === 3, "R5 movement velocity is absent");
  const capturedPosition = Object.freeze(position.map((value, index) => finite(value, `R5 movement position[${index}]`)));
  const capturedVelocity = Object.freeze(velocity.map((value, index) => finite(value, `R5 movement velocity[${index}]`)));
  const nextInputSequence = nonNegativeSafeInteger(pump?.nextInputSequence, "R5 next input sequence");
  const evidence = {
    authorityTick: nonNegativeSafeInteger(pump?.lastAuthorityTick, "R5 authority tick"),
    extractionRevision: nonNegativeSafeInteger(pump?.lastExtractionRevision, "R5 extraction revision"),
    nextInputSequence,
    appliedInputSequence: Math.max(0, nextInputSequence - 1),
    appliedInputs: nonNegativeSafeInteger(pump?.appliedInputs, "R5 applied input count"),
    samples: nonNegativeSafeInteger(pump?.samples, "R5 input sample count"),
    stepCalls: nonNegativeSafeInteger(pump?.stepCalls, "R5 step call count"),
    lastAppliedButtons: nonNegativeSafeInteger(pump?.lastAppliedButtons, "R5 applied buttons"),
    sprinting: player?.sprinting,
    position: capturedPosition,
    velocity: capturedVelocity,
    horizontalSpeed: Math.hypot(capturedVelocity[0], capturedVelocity[2]),
    advanceInFlight: authority?.advanceInFlight,
    pumpInFlight: pump?.inFlight,
    queuedAdvances: nonNegativeSafeInteger(pump?.queuedAdvances, "R5 queued advances"),
    nativeInputPending: pump?.nativeInputPending,
    pendingInputSequence: pump?.pendingInputSequence ?? null,
  };
  assertCondition(typeof evidence.sprinting === "boolean", "R5 movement sprint presentation is absent");
  assertCondition(typeof evidence.advanceInFlight === "boolean", "R5 authority in-flight state is absent");
  assertCondition(typeof evidence.pumpInFlight === "boolean", "R5 pump in-flight state is absent");
  assertCondition(typeof evidence.nativeInputPending === "boolean", "R5 pending-input state is absent");
  return Object.freeze({
    ...evidence,
    presentationSettled: evidence.advanceInFlight === false
      && evidence.pumpInFlight === false
      && evidence.queuedAdvances === 0
      && evidence.nativeInputPending === false
      && evidence.pendingInputSequence === null,
  });
}

function movementEvidenceMatchesMode(evidence, expectedSprinting) {
  return evidence.presentationSettled
    && evidence.sprinting === expectedSprinting
    && Boolean(evidence.lastAppliedButtons & INPUT_BUTTON.sprint) === expectedSprinting
    && evidence.horizontalSpeed > 1;
}

export function r5SteadyMovementPair(previous, current, expectedSprinting) {
  assertCondition(typeof expectedSprinting === "boolean", "R5 steady movement expectation must identify sprinting state");
  if (!movementEvidenceMatchesMode(previous, expectedSprinting)
    || !movementEvidenceMatchesMode(current, expectedSprinting)) return false;
  const displacement = Math.hypot(
    current.position[0] - previous.position[0],
    current.position[2] - previous.position[2],
  );
  return current.authorityTick > previous.authorityTick
    && current.extractionRevision > previous.extractionRevision
    && current.appliedInputSequence > previous.appliedInputSequence
    && current.appliedInputs > previous.appliedInputs
    && current.lastAppliedButtons === previous.lastAppliedButtons
    && current.velocity[0] === previous.velocity[0]
    && current.velocity[2] === previous.velocity[2]
    && displacement > 0.04;
}

export function r5PersistencePoseEvidence(snapshot) {
  const authority = snapshot?.runtime?.playerAuthority;
  const pump = authority?.pump;
  const player = snapshot?.state?.player;
  const velocity = player?.velocity;
  assertCondition(Array.isArray(velocity) && velocity.length === 3, "R5 persistence velocity is absent");
  const capturedVelocity = Object.freeze(velocity.map((value, index) => finite(value, `R5 persistence velocity[${index}]`)));
  const evidence = {
    state: snapshot?.state?.state ?? null,
    pose: poseFromState(snapshot?.state, "R5 persistence pose"),
    velocity: capturedVelocity,
    authorityTick: nonNegativeSafeInteger(pump?.lastAuthorityTick, "R5 persistence authority tick"),
    extractionRevision: nonNegativeSafeInteger(pump?.lastExtractionRevision, "R5 persistence extraction revision"),
    nextInputSequence: nonNegativeSafeInteger(pump?.nextInputSequence, "R5 persistence next input sequence"),
    appliedInputs: nonNegativeSafeInteger(pump?.appliedInputs, "R5 persistence applied input count"),
    lastAppliedButtons: nonNegativeSafeInteger(pump?.lastAppliedButtons, "R5 persistence applied buttons"),
    advanceInFlight: authority?.advanceInFlight,
    pumpInFlight: pump?.inFlight,
    queuedAdvances: nonNegativeSafeInteger(pump?.queuedAdvances, "R5 persistence queued advances"),
    nativeInputPending: pump?.nativeInputPending,
    pendingInputSequence: pump?.pendingInputSequence ?? null,
    queuedContextCommands: nonNegativeSafeInteger(pump?.queuedContextCommands, "R5 persistence queued context commands"),
    sprinting: player?.sprinting,
  };
  assertCondition(typeof evidence.advanceInFlight === "boolean", "R5 persistence authority in-flight state is absent");
  assertCondition(typeof evidence.pumpInFlight === "boolean", "R5 persistence pump in-flight state is absent");
  assertCondition(typeof evidence.nativeInputPending === "boolean", "R5 persistence pending-input state is absent");
  assertCondition(typeof evidence.sprinting === "boolean", "R5 persistence sprint presentation is absent");
  const zeroVelocity = capturedVelocity.every((value) => value === 0);
  const pumpDrained = evidence.advanceInFlight === false
    && evidence.pumpInFlight === false
    && evidence.queuedAdvances === 0
    && evidence.nativeInputPending === false
    && evidence.pendingInputSequence === null
    && evidence.queuedContextCommands === 0;
  return Object.freeze({
    ...evidence,
    zeroVelocity,
    pumpDrained,
    terminal: zeroVelocity && pumpDrained && evidence.lastAppliedButtons === 0 && evidence.sprinting === false,
  });
}

export function r5TerminalPersistencePair(previous, current) {
  if (previous?.terminal !== true || current?.terminal !== true) return false;
  return current.authorityTick > previous.authorityTick
    && current.extractionRevision > previous.extractionRevision
    && current.nextInputSequence > previous.nextInputSequence
    && current.appliedInputs > previous.appliedInputs
    && JSON.stringify(current.pose) === JSON.stringify(previous.pose);
}

function exactGenerationCertificate(certificate) {
  return certificate?.corpusCases === R5_GENERATION_CERTIFICATE.corpusCases
    && certificate.corpusHash === R5_GENERATION_CERTIFICATE.corpusHash
    && certificate.byteEqual === true
    && certificate.generatorVersion === 18
    && GENERATION_HASH_PATTERN.test(certificate.generatorHash ?? "")
    && GENERATION_HASH_PATTERN.test(certificate.contentHash ?? "");
}

export function collectR5RuntimeErrors(state, runtime, { authorityCheckpoint = false } = {}) {
  const streaming = state?.performance?.streaming;
  const generation = streaming?.generationWorker;
  const terrainWorker = streaming?.terrainWorker;
  const rustTerrain = streaming?.rustTerrain;
  const rustWorld = streaming?.rustWorldAuthority;
  const host = runtime?.manager?.host;
  const adapter = host?.adapter;
  const persistence = host?.nativePersistence;
  const errors = [];
  const nonNull = (label, value) => { if (value !== null && value !== undefined && value !== "") errors.push(`${label}: ${String(value)}`); };
  nonNull("runtime.manager.lastError", runtime?.manager?.lastError);
  nonNull("runtime.manager.host.lastError", host?.lastError);
  nonNull("runtime.manager.host.adapter.lastError", adapter?.lastError);
  nonNull("runtime.manager.host.nativePersistence.lastError", persistence?.lastError);
  nonNull("runtime.playerAuthority.lastError", runtime?.playerAuthority?.lastError);
  nonNull("runtime.playerAuthority.pump.lastError", runtime?.playerAuthority?.pump?.lastError);
  nonNull("runtime.renderer.lastError", runtime?.renderer?.lastError);
  nonNull("runtime.renderer.runtime.lastError", runtime?.renderer?.runtime?.lastError);
  nonNull("runtime.renderer.publisher.lastError", runtime?.renderer?.publisher?.lastError);
  nonNull("runtime.multiplayer.lastError", runtime?.multiplayer?.lastError);
  nonNull("generationWorker.lastError", generation?.lastError);
  nonNull("terrainWorker.lastError", terrainWorker?.lastError);
  nonNull("rustTerrain.lastMismatch", rustTerrain?.lastMismatch);
  nonNull("rustWorldAuthority.lastFallbackReason", rustWorld?.lastFallbackReason);
  if (authorityCheckpoint && runtime?.operationsBlocked === true) errors.push("runtime operations are blocked");
  if ((adapter?.failures ?? 0) !== 0) errors.push(`runtime adapter failures: ${String(adapter?.failures)}`);
  if ((adapter?.rejectedCommands ?? 0) !== 0) errors.push(`runtime adapter rejected commands: ${String(adapter?.rejectedCommands)}`);
  if ((adapter?.indeterminateCommands ?? 0) !== 0) errors.push(`runtime adapter indeterminate commands: ${String(adapter?.indeterminateCommands)}`);
  if ((adapter?.staleResponses ?? 0) !== 0) errors.push(`runtime adapter stale responses: ${String(adapter?.staleResponses)}`);
  if ((persistence?.parentFallbacks ?? 0) !== 0) errors.push(`native persistence parent fallbacks: ${String(persistence?.parentFallbacks)}`);
  if ((generation?.failed ?? 0) !== 0) errors.push(`generation failures: ${String(generation?.failed)}`);
  if ((generation?.restarts ?? 0) !== 0) errors.push(`generation worker restarts: ${String(generation?.restarts)}`);
  if ((generation?.rejected ?? 0) !== 0) errors.push(`generation rejections: ${String(generation?.rejected)}`);
  if ((terrainWorker?.failed ?? 0) !== 0) errors.push(`terrain worker failures: ${String(terrainWorker?.failed)}`);
  if ((terrainWorker?.restarts ?? 0) !== 0) errors.push(`terrain worker restarts: ${String(terrainWorker?.restarts)}`);
  if ((rustTerrain?.fallback ?? 0) !== 0) errors.push(`Rust terrain fallbacks: ${String(rustTerrain?.fallback)}`);
  if ((rustTerrain?.parityMismatches ?? 0) !== 0) errors.push(`Rust terrain parity mismatches: ${String(rustTerrain?.parityMismatches)}`);
  if ((rustTerrain?.installFailures ?? 0) !== 0) errors.push(`Rust terrain install failures: ${String(rustTerrain?.installFailures)}`);
  if ((rustWorld?.failures ?? 0) !== 0) errors.push(`Rust world failures: ${String(rustWorld?.failures)}`);
  if ((rustWorld?.restarts ?? 0) !== 0) errors.push(`Rust world restarts: ${String(rustWorld?.restarts)}`);
  return Object.freeze(errors);
}

export function assertR5AuthorityDiagnostics(snapshot, expectedArtifactHash, label = "R5 browser checkpoint") {
  assertCondition(ARTIFACT_HASH_PATTERN.test(expectedArtifactHash), `${label}: expected artifact hash is invalid`);
  const { state, runtime } = snapshot ?? {};
  const certificates = snapshot?.generationCertificates;
  const streaming = state?.performance?.streaming;
  const generation = streaming?.generationWorker;
  const host = runtime?.manager?.host;
  const adapter = host?.adapter;
  const pump = runtime?.playerAuthority?.pump;
  assertCondition(state?.state === "playing", `${label}: gameplay is not active`);
  assertCondition(runtime?.ready === true, `${label}: Rust runtime is not ready`);
  assertCondition(runtime?.operationsBlocked === false, `${label}: Rust runtime operations are blocked`);
  assertCondition(runtime?.manager?.state === "ready", `${label}: runtime manager is not ready`);
  assertCondition(runtime?.manager?.requestedGeneration === runtime?.transitionGeneration,
    `${label}: runtime manager requested generation is stale`);
  assertCondition(runtime?.manager?.activeGeneration === runtime?.transitionGeneration,
    `${label}: runtime manager active generation is stale`);
  assertCondition(host?.state === "ready", `${label}: runtime host is not ready`);
  assertCondition(host?.artifactHash === expectedArtifactHash,
    `${label}: expected artifact ${expectedArtifactHash}, received ${String(host?.artifactHash)}`);
  assertCondition(adapter?.state === "ready", `${label}: runtime adapter is not ready`);
  assertCondition(adapter?.authoritative === true, `${label}: runtime adapter is not authoritative`);
  assertCondition(adapter?.verification === "content-addressed-wasm", `${label}: runtime artifact is not content-address verified`);
  assertCondition(adapter?.liveAuthorityReady === true, `${label}: runtime liveAuthorityReady is false`);
  assertCondition(runtime?.playerAuthority?.state === "ready", `${label}: live player integration is not ready`);
  assertCondition(pump?.state === "ready", `${label}: live input pump is not ready`);
  assertCondition(runtime?.playerAuthority?.worldGeneration === runtime?.transitionGeneration,
    `${label}: live player generation is stale`);
  assertCondition(pump?.worldGeneration === runtime?.transitionGeneration, `${label}: live input generation is stale`);
  assertCondition(runtime?.playerAuthority?.entityId !== null, `${label}: native player entity is absent`);
  assertCondition((runtime?.playerAuthority?.terrainChunkCount ?? 0) > 0, `${label}: native terrain residency is absent`);
  assertCondition((pump?.authoritativeFlags & AUTHORITY_FLAG.mounted) === 0, `${label}: unsupported native mount flag is set`);
  finite(pump?.lastAuthorityTick, `${label} authority tick`);
  finite(pump?.nextInputSequence, `${label} input sequence`);
  assertCondition(generation?.mode === "rust", `${label}: generation worker mode is ${String(generation?.mode)}`);
  assertCondition(generation?.selectionSource === "build-rust-primary",
    `${label}: generation selection source is ${String(generation?.selectionSource)}`);
  const exposedBuildProfiles = [
    snapshot?.buildDiagnostics?.worldgenBuildProfile,
    generation?.worldgenBuildProfile,
    state?.build?.worldgenBuildProfile,
    state?.performance?.runtime?.build?.worldgenBuildProfile,
    runtime?.build?.worldgenBuildProfile,
    runtime?.manager?.build?.worldgenBuildProfile,
    host?.build?.worldgenBuildProfile,
  ].filter((value) => value !== null && value !== undefined);
  for (const buildProfile of exposedBuildProfiles) {
    assertCondition(buildProfile === "rust-primary",
      `${label}: worldgen build profile is ${String(buildProfile)}`);
  }
  assertCondition(generation?.state === "ready", `${label}: generation worker is not ready`);
  assertCondition(generation?.authorityRequired === true, `${label}: generation authority is not required`);
  assertCondition(generation?.rollbackRequiresWorldReload === true,
    `${label}: Rust-primary rollback is not isolated to a world reload`);
  assertCondition(generation?.supported === true, `${label}: generation worker is unsupported`);
  assertCondition((generation?.workers ?? 0) > 0 && generation?.ready === generation?.workers,
    `${label}: not every generation worker is ready`);
  assertCondition(Array.isArray(certificates) && certificates.length > 0,
    `${label}: no generation worker startup certificate was observed`);
  for (const certificate of certificates) {
    assertCondition(exactGenerationCertificate(certificate),
      `${label}: generation certificate is not the exact 155-case promotion certificate`);
  }
  const runtimeErrors = collectR5RuntimeErrors(state, runtime, { authorityCheckpoint: true });
  assertCondition(runtimeErrors.length === 0, `${label}: ${runtimeErrors.join(" | ")}`);
  return Object.freeze({
    artifactHash: host.artifactHash,
    generationCertificate: Object.freeze({ ...certificates[0] }),
    generationWorker: Object.freeze({ ...generation }),
    runtimeErrors,
  });
}

function poseFromState(state, label) {
  const position = state?.player?.position;
  assertCondition(Array.isArray(position) && position.length === 3, `${label}: player position is absent`);
  position.forEach((value, index) => finite(value, `${label} position[${index}]`));
  return Object.freeze({
    position: Object.freeze([...position]),
    yaw: finite(state?.player?.yaw, `${label} yaw`),
    pitch: finite(state?.player?.pitch, `${label} pitch`),
  });
}

export function assertExactR5Reload(beforeSave, afterReload, expected = {}) {
  assertCondition(beforeSave?.state?.world?.seed === afterReload?.state?.world?.seed, "reload changed the exact world seed");
  assertCondition(beforeSave?.state?.player?.mode === afterReload?.state?.player?.mode, "reload changed the exact world mode");
  if (expected.seed !== undefined) assertCondition(afterReload?.state?.world?.seed === expected.seed, "reload disagrees with the requested seed");
  if (expected.mode !== undefined) assertCondition(afterReload?.state?.player?.mode === expected.mode, "reload disagrees with the requested mode");
  const beforePose = poseFromState(beforeSave.state, "pre-save authoritative pose");
  const afterPose = poseFromState(afterReload.state, "reloaded authoritative pose");
  assertCondition(JSON.stringify(beforePose) === JSON.stringify(afterPose),
    `reload changed the exact authoritative pose: before=${JSON.stringify(beforePose)} after=${JSON.stringify(afterPose)}`);
  assertCondition(beforeSave?.runtime?.activeWorldId === afterReload?.runtime?.activeWorldId,
    "reload changed the active catalog/native world binding");
  if (expected.edit !== undefined) {
    assertCondition(JSON.stringify(expected.edit.beforeSave) === JSON.stringify(expected.edit.afterReload),
      "reload changed the exercised world edit");
  }
  return Object.freeze({ seed: afterReload.state.world.seed, mode: afterReload.state.player.mode, pose: afterPose });
}

export const R5_NATIVE_SURVIVAL_ENVIRONMENT_PRODUCER = "rust-r5-r6-r7";
export const R5_NATIVE_SURVIVAL_CONTACT = Object.freeze({
  grounded: 1 << 0,
  inLiquid: 1 << 6,
  headSubmerged: 1 << 7,
  shoreBoosted: 1 << 8,
  unknownBoundary: 1 << 9,
});
const R5_NATIVE_SURVIVAL_EFFECT_KINDS = new Set([
  "jump",
  "land",
  "fall-damage",
  "drown-damage",
  "liquid-enter",
  "liquid-exit",
  "shore-exit",
]);
const R5_NATIVE_FIXED_STEP_SECONDS = 0.05;
const R5_NATIVE_DRY_OXYGEN_RECOVERY_PER_SECOND = 4;
const R5_NATIVE_FIRST_RESTORED_ADVANCE_MAX_TICKS = BigInt(8);
const R5_NATIVE_STARTER_BERRY_ITEM_CODE = 124;
const R5_NATIVE_STARTER_BERRY_COUNT = 3;
const R5_NATIVE_DEATH_DROP_MAXIMUM_PREDECESSOR_DISTANCE = 0.75;
const R5_NATIVE_DEATH_DROP_MAXIMUM_PLAYING_SAMPLE_GAP_TICKS = BigInt(8);
const R5_NATIVE_DEATH_DROP_TERMINAL_SPEED_METERS_PER_SECOND = 30;
const R5_NATIVE_DEATH_DROP_MAXIMUM_COLLISION_REBOUND_SPEED_METERS_PER_SECOND = 8.4;
const R5_NATIVE_DEATH_DROP_ROTATION_MICROTURNS_PER_STEP = BigInt(19_894);

/**
 * Full-authority environment, inventory, and drop projections are actionable
 * only once the native pump is drained and their shared extraction envelope is
 * current for its authority tick. The pump cursor may be ahead because camera-
 * only viewport refreshes use the same presentation-revision domain without
 * republishing those full-authority products.
 */
export function r5NativeSurvivalProjectionSettled(snapshot) {
  const authority = snapshot?.runtime?.playerAuthority;
  const pump = authority?.pump;
  const environment = authority?.environmentalSurvival;
  const nativeInventory = authority?.nativeInventory;
  const nativeDropTransforms = authority?.nativeDropTransforms;
  const projectionRevision = environment?.extractionRevision;
  const projectionRevisionIsCanonical = typeof projectionRevision === "string"
    && /^[1-9][0-9]*$/u.test(projectionRevision);
  return authority?.advanceInFlight === false
    && authority?.pendingRendererExtraction === false
    && pump?.inFlight === false
    && pump?.queuedAdvances === 0
    && pump?.nativeInputPending === false
    && pump?.pendingInputSequence === null
    && Number.isSafeInteger(pump?.lastAuthorityTick)
    && pump.lastAuthorityTick >= 0
    && Number.isSafeInteger(pump?.lastExtractionRevision)
    && pump.lastExtractionRevision >= 1
    && projectionRevisionIsCanonical
    && nativeInventory?.extractionRevision === projectionRevision
    && nativeDropTransforms?.extractionRevision === projectionRevision
    && nativeDropTransforms?.authorityTick === environment?.authorityTick
    && environment?.authorityTick === String(pump.lastAuthorityTick)
    && BigInt(projectionRevision) <= BigInt(pump.lastExtractionRevision);
}

function exactDecimalCursor(value, label, { positive = false } = {}) {
  assertCondition(typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value),
    `${label} is not a canonical unsigned decimal string`);
  const parsed = BigInt(value);
  assertCondition(!positive || parsed > BigInt(0), `${label} must be positive`);
  return parsed;
}

function exactNonNegativeInteger(value, label) {
  assertCondition(Number.isSafeInteger(value) && value >= 0, `${label} is not a nonnegative safe integer`);
  return value;
}

function exactCanonicalMillihearts(value, label) {
  assertCondition(Number.isFinite(value) && value >= 0 && !Object.is(value, -0) && Object.is(value, Math.fround(value)),
    `${label} is not a finite nonnegative native f32`);
  const millihearts = Math.round(value * 1_000);
  assertCondition(Number.isSafeInteger(millihearts) && millihearts >= 0 && millihearts <= 0xffff_ffff,
    `${label} exceeds the milliheart range`);
  const roundtrip = Math.fround(Math.fround(millihearts) / Math.fround(1_000));
  assertCondition(Object.is(roundtrip, value), `${label} is not canonically representable in millihearts`);
  return millihearts;
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Converts one public browser snapshot into sealed native Survival evidence.
 * The runtime and render_game_to_text projections must expose the same object;
 * no missing R6/R7/contact field is inferred from presentation state.
 */
export function r5NativeSurvivalEnvironmentSample(snapshot, metadata = {}) {
  const phase = metadata.phase ?? "environment-sample";
  const ordinal = metadata.ordinal ?? 0;
  assertCondition(typeof phase === "string" && phase.length > 0, "native Survival phase is empty");
  exactNonNegativeInteger(ordinal, "native Survival evidence ordinal");
  const state = snapshot?.state;
  const runtime = snapshot?.runtime;
  const player = state?.player;
  const evidence = runtime?.playerAuthority?.environmentalSurvival;
  assertCondition(player?.mode === "survival", `${phase}: browser player is not in Survival`);
  assertCondition(evidence?.schema === 1, `${phase}: native environmental diagnostic schema is absent`);
  assertCondition(evidence?.producer === R5_NATIVE_SURVIVAL_ENVIRONMENT_PRODUCER,
    `${phase}: native environmental producer is ${String(evidence?.producer)}`);
  assertCondition(evidence?.typescriptDamageAuthoringCalls === 0,
    `${phase}: TypeScript authored ${String(evidence?.typescriptDamageAuthoringCalls)} damage calls`);
  exactNonNegativeInteger(evidence?.suppressedLegacyDamageCalls, `${phase} suppressed legacy damage calls`);
  exactNonNegativeInteger(evidence?.projectedDamageEvents, `${phase} projected native damage events`);
  exactNonNegativeInteger(evidence?.projectedDeathEvents, `${phase} projected native death events`);
  assertCondition(evidence.projectedDeathEvents <= evidence.projectedDamageEvents,
    `${phase}: projected death events exceed projected damage events`);
  exactDecimalCursor(evidence?.extractionRevision, `${phase} extraction revision`, { positive: true });
  const authorityTick = exactDecimalCursor(evidence?.authorityTick, `${phase} authority tick`);

  const effects = evidence?.effects;
  assertCondition(effects?.schema === 1 && effects?.producer === "rust-bwau-v2",
    `${phase}: native BWAU effect journal is absent`);
  assertCondition(typeof effects.playerExternalId === "string" && effects.playerExternalId.length > 0,
    `${phase}: native BWAU player external id is empty`);
  assertCondition(effects.authorityTick === evidence.authorityTick,
    `${phase}: native BWAU authority tick disagrees with the player extraction`);
  exactNonNegativeInteger(effects.total, `${phase} native BWAU total`);
  exactNonNegativeInteger(effects.selected, `${phase} native BWAU selected`);
  exactNonNegativeInteger(effects.omitted, `${phase} native BWAU omitted`);
  assertCondition(effects.omitted === 0 && effects.selected === effects.total,
    `${phase}: native BWAU journal has omitted effect history`);
  assertCondition(effects.contiguous === true, `${phase}: native BWAU journal reports a sequence gap`);
  assertCondition(Array.isArray(effects.cues)
    && effects.selected <= R5_NATIVE_EFFECT_RING_CAPACITY
    && effects.cues.length === effects.selected,
  `${phase}: native BWAU selected count disagrees with its bounded cues`);
  const parsedEffects = [];
  let priorEffectSequence = null;
  for (const [index, cue] of effects.cues.entries()) {
    const sequence = exactDecimalCursor(cue?.sequence, `${phase} native BWAU cue ${index} sequence`, { positive: true });
    const tick = exactDecimalCursor(cue?.tick, `${phase} native BWAU cue ${index} tick`);
    assertCondition(priorEffectSequence === null || sequence === priorEffectSequence + BigInt(1),
      `${phase}: native BWAU cue sequence has a gap`);
    assertCondition(tick <= authorityTick, `${phase}: native BWAU cue tick exceeds extraction authority`);
    assertCondition(typeof cue?.entityExternalId === "string" && cue.entityExternalId.length > 0,
      `${phase}: native BWAU cue has no external entity id`);
    assertCondition(R5_NATIVE_SURVIVAL_EFFECT_KINDS.has(cue?.kind),
      `${phase}: native BWAU cue kind is invalid`);
    assertCondition(Number.isFinite(cue?.amount) && !Object.is(cue.amount, -0),
      `${phase}: native BWAU cue amount is not a canonical finite number`);
    parsedEffects.push(Object.freeze({ ...cue }));
    priorEffectSequence = sequence;
  }
  const expectedFirstSequence = effects.cues.at(0)?.sequence ?? null;
  const expectedLastSequence = effects.cues.at(-1)?.sequence ?? null;
  assertCondition(effects.firstSequence === expectedFirstSequence
    && effects.lastSequence === expectedLastSequence,
  `${phase}: native BWAU first/last sequence metadata disagrees with its cues`);
  if (effects.firstSequence !== null) exactDecimalCursor(effects.firstSequence, `${phase} native BWAU first sequence`, { positive: true });
  if (effects.lastSequence !== null) exactDecimalCursor(effects.lastSequence, `${phase} native BWAU last sequence`, { positive: true });

  const r6 = evidence?.r6;
  const r7 = evidence?.r7;
  assertCondition(r6 !== null && typeof r6 === "object", `${phase}: R6 player evidence is absent`);
  assertCondition(r7 !== null && typeof r7 === "object", `${phase}: R7 combat evidence is absent`);
  exactDecimalCursor(r6.entityId, `${phase} R6 entity id`, { positive: true });
  exactDecimalCursor(r6.entityRevision, `${phase} R6 entity revision`, { positive: true });
  exactDecimalCursor(r6.lastDamageTick, `${phase} R6 last damage tick`);
  exactDecimalCursor(r7.entityId, `${phase} R7 entity id`, { positive: true });
  exactDecimalCursor(r7.rowRevision, `${phase} R7 row revision`, { positive: true });
  exactDecimalCursor(r7.combatDomainRevision, `${phase} R7 combat-domain revision`, { positive: true });
  assertCondition(r6.entityId === r7.entityId, `${phase}: R6/R7 entity ids disagree`);
  assertCondition(r6.entityId === String(runtime?.playerAuthority?.entityId ?? ""),
    `${phase}: environmental entity id disagrees with the live player binding`);
  assertCondition(typeof r7.recordId === "string" && r7.recordId.length > 0,
    `${phase}: R7 combat record id is empty`);
  assertCondition(r7.vitalUnits === "millihearts-v1", `${phase}: R7 vital units are not millihearts-v1`);
  assertCondition(r7.crossDomainParity === true, `${phase}: R7 does not attest cross-domain parity`);

  const healthMillihearts = exactCanonicalMillihearts(r6.health, `${phase} R6 health`);
  const maximumHealthMillihearts = exactCanonicalMillihearts(r6.maximumHealth, `${phase} R6 maximum health`);
  assertCondition(maximumHealthMillihearts > 0 && healthMillihearts <= maximumHealthMillihearts,
    `${phase}: R6 health is outside its native maximum`);
  assertCondition(Number.isSafeInteger(r7.health) && Number.isSafeInteger(r7.maxHealth)
    && r7.health === healthMillihearts && r7.maxHealth === maximumHealthMillihearts,
  `${phase}: exact R6-heart/R7-milliheart parity failed`);
  assertCondition(r7.alive === (r7.health > 0), `${phase}: R7 alive state disagrees with health`);

  assertCondition(Number.isFinite(r6.oxygenSeconds) && Number.isFinite(r6.maximumOxygenSeconds)
    && r6.maximumOxygenSeconds > 0 && r6.oxygenSeconds >= 0
    && r6.oxygenSeconds <= r6.maximumOxygenSeconds,
  `${phase}: R6 oxygen is outside its native range`);
  assertCondition(Number.isFinite(r6.drowningAccumulator) && r6.drowningAccumulator >= 0,
    `${phase}: R6 drowning accumulator is invalid`);
  assertCondition(Number.isFinite(r6.fallDistance) && r6.fallDistance >= 0,
    `${phase}: R6 fall distance is invalid`);
  assertCondition(Number.isSafeInteger(r6.contactFlags) && r6.contactFlags >= 0 && r6.contactFlags <= 0xffff,
    `${phase}: R6 contact flags are not u16`);
  const inLiquid = Boolean(r6.contactFlags & R5_NATIVE_SURVIVAL_CONTACT.inLiquid);
  const headSubmerged = Boolean(r6.contactFlags & R5_NATIVE_SURVIVAL_CONTACT.headSubmerged);
  assertCondition(r6.inLiquid === inLiquid, `${phase}: in-liquid flag disagrees with R6 contacts`);
  assertCondition(r6.headSubmerged === headSubmerged, `${phase}: head-submerged flag disagrees with R6 contacts`);
  assertCondition(!headSubmerged || inLiquid, `${phase}: a submerged head is not in liquid`);
  assertCondition((r6.contactFlags & R5_NATIVE_SURVIVAL_CONTACT.unknownBoundary) === 0,
    `${phase}: deterministic environmental evidence touched an unknown terrain boundary`);

  assertCondition(player.health === r6.health, `${phase}: browser health disagrees with exact R6 health`);
  assertCondition(player.oxygen === Number(r6.oxygenSeconds.toFixed(2)),
    `${phase}: browser oxygen disagrees with the rounded R6 projection`);
  assertCondition(player.submerged === r6.headSubmerged,
    `${phase}: browser submerged state disagrees with R6 contacts`);
  assertCondition(player.inLiquid === r6.inLiquid, `${phase}: browser liquid state disagrees with R6 contacts`);
  assertCondition(player.alive === r7.alive, `${phase}: browser alive state disagrees with R7`);
  assertCondition(exactJson(player.nativeEnvironmental, evidence),
    `${phase}: render_game_to_text native evidence disagrees with runtime diagnostics`);
  assertCondition(typeof runtime?.activeWorldId === "string" && runtime.activeWorldId.length > 0,
    `${phase}: active world id is absent`);
  assertCondition(runtime.nativePersistenceWorldId === runtime.activeWorldId,
    `${phase}: native persistence is not bound to the active world`);
  const position = player?.position;
  const velocity = player?.velocity;
  assertCondition(Array.isArray(position) && position.length === 3,
    `${phase}: browser player position is absent`);
  assertCondition(Array.isArray(velocity) && velocity.length === 3,
    `${phase}: browser player velocity is absent`);
  const capturedPosition = Object.freeze(position.map((value, index) => (
    finite(value, `${phase} browser position[${index}]`)
  )));
  const capturedVelocity = Object.freeze(velocity.map((value, index) => (
    finite(value, `${phase} browser velocity[${index}]`)
  )));

  return Object.freeze({
    phase,
    ordinal,
    worldId: runtime.activeWorldId,
    hydration: runtime.hydration,
    gameState: state.state,
    producer: evidence.producer,
    typescriptDamageAuthoringCalls: evidence.typescriptDamageAuthoringCalls,
    suppressedLegacyDamageCalls: evidence.suppressedLegacyDamageCalls,
    projectedDamageEvents: evidence.projectedDamageEvents,
    projectedDeathEvents: evidence.projectedDeathEvents,
    extractionRevision: evidence.extractionRevision,
    authorityTick: evidence.authorityTick,
    effects: Object.freeze({ ...effects, cues: Object.freeze(parsedEffects) }),
    browser: Object.freeze({
      position: capturedPosition,
      velocity: capturedVelocity,
      health: player.health,
      oxygen: player.oxygen,
      submerged: player.submerged,
      inLiquid: player.inLiquid,
      alive: player.alive,
    }),
    r6: Object.freeze({ ...r6 }),
    r7: Object.freeze({ ...r7 }),
  });
}

function sameNativeEffectCue(left, right) {
  return left?.sequence === right?.sequence
    && left?.tick === right?.tick
    && left?.entityExternalId === right?.entityExternalId
    && left?.kind === right?.kind
    && Object.is(left?.amount, right?.amount);
}

function newNativeEffectsSince(baseline, candidate, label) {
  const baselineFirst = baseline.effects.firstSequence === null
    ? null
    : exactDecimalCursor(baseline.effects.firstSequence, `${label} baseline first BWAU sequence`, { positive: true });
  const baselineLast = baseline.effects.lastSequence === null
    ? BigInt(0)
    : exactDecimalCursor(baseline.effects.lastSequence, `${label} baseline BWAU sequence`, { positive: true });
  const candidateFirst = candidate.effects.firstSequence === null
    ? null
    : exactDecimalCursor(candidate.effects.firstSequence, `${label} candidate first BWAU sequence`, { positive: true });
  const candidateLast = candidate.effects.lastSequence === null
    ? null
    : exactDecimalCursor(candidate.effects.lastSequence, `${label} candidate last BWAU sequence`, { positive: true });
  assertCondition(candidate.effects.playerExternalId === baseline.effects.playerExternalId,
    `${label}: native BWAU player binding changed`);
  const exactFullCandidateRing = candidate.effects.total === R5_NATIVE_EFFECT_RING_CAPACITY
    && candidate.effects.selected === R5_NATIVE_EFFECT_RING_CAPACITY
    && candidate.effects.omitted === 0
    && candidate.effects.cues.length === R5_NATIVE_EFFECT_RING_CAPACITY;
  if (baselineFirst !== null && candidateFirst !== null) {
    assertCondition(candidateFirst >= baselineFirst,
      `${label}: native BWAU first sequence moved backward`);
    assertCondition(candidateFirst === baselineFirst || exactFullCandidateRing,
      `${label}: native BWAU discarded an accepted prefix before reaching exact full-ring capacity`);
  }
  if (baselineLast === BigInt(0)) {
    assertCondition(candidateFirst === null || candidateFirst === BigInt(1),
      `${label}: native BWAU history starts after an unreported gap`);
  } else {
    const overlapsBaseline = candidateFirst !== null && candidateLast !== null
      && candidateFirst <= baselineLast && candidateLast >= baselineLast;
    const exactFullRingSuccessor = candidateFirst === baselineLast + BigInt(1)
      && exactFullCandidateRing;
    assertCondition(overlapsBaseline || exactFullRingSuccessor,
      `${label}: native BWAU journal omitted the surfaced baseline cursor without an exact full-ring successor`);
  }
  const baselineBySequence = new Map(baseline.effects.cues.map((cue) => [cue.sequence, cue]));
  for (const cue of candidate.effects.cues) {
    if (exactDecimalCursor(cue.sequence, `${label} candidate overlap sequence`, { positive: true }) > baselineLast) break;
    const priorCue = baselineBySequence.get(cue.sequence);
    assertCondition(priorCue !== undefined && sameNativeEffectCue(priorCue, cue),
      `${label}: native BWAU overlap rewrote an append-only cue`);
  }
  return Object.freeze(candidate.effects.cues.filter((cue) => (
    exactDecimalCursor(cue.sequence, `${label} new BWAU sequence`, { positive: true }) > baselineLast
  )));
}

function r5NativeSurvivalShoreExitCueEvidenceV1(
  baselineSnapshot,
  candidateSnapshot,
  { exactHeldAttempt } = { exactHeldAttempt: true },
) {
  const baseline = r5NativeSurvivalEnvironmentSample(baselineSnapshot, { phase: "shore-cue-baseline", ordinal: 0 });
  const candidate = r5NativeSurvivalEnvironmentSample(candidateSnapshot, { phase: "shore-cue-candidate", ordinal: 1 });
  assertCondition(candidate.worldId === baseline.worldId
    && candidate.effects.playerExternalId === baseline.effects.playerExternalId,
  "shore-exit BWAU cue changed native player or world custody");
  const newEffects = newNativeEffectsSince(baseline, candidate, "shore-exit BWAU cue");
  const linked = newEffects.filter((cue) => cue.entityExternalId === baseline.effects.playerExternalId);
  assertCondition(!linked.some((cue) => cue.kind === "drown-damage" || cue.kind === "fall-damage"),
    "native damage effect occurred after surface recovery");
  const shoreCues = linked.filter((cue) => cue.kind === "shore-exit");
  assertCondition(shoreCues.length > 0, "a new linked native shore-exit BWAU cue was not observed");
  if (exactHeldAttempt) {
    assertCondition(shoreCues.length === 1,
      "the held shore-exit attempt did not emit exactly one linked native BWAU cue");
  }
  const baselineTick = exactDecimalCursor(baseline.authorityTick, "shore-cue baseline authority tick");
  const candidateTick = exactDecimalCursor(candidate.authorityTick, "shore-cue authority tick");
  for (const cue of shoreCues) {
    assertCondition(Object.is(cue.amount, 0), "native shore-exit BWAU cue amount is not exactly zero");
    const cueTick = exactDecimalCursor(cue.tick, "native shore-exit BWAU cue tick");
    assertCondition(cueTick > baselineTick && cueTick <= candidateTick,
      "native shore-exit BWAU cue tick is stale or exceeds its extraction");
  }
  const earliestCue = Object.freeze({ ...shoreCues[0] });
  const latestCue = Object.freeze({ ...shoreCues.at(-1) });
  return Object.freeze({
    baseline,
    candidate,
    shoreExitCount: shoreCues.length,
    earliestCue,
    latestCue,
    shoreCues: Object.freeze(shoreCues.map((cue) => Object.freeze({ ...cue }))),
    newEffects,
  });
}

/** Exact persistent BWAU proof for one held shore attempt that a batched contact sample can miss. */
export function r5NativeSurvivalShoreExitCueEvidence(baselineSnapshot, candidateSnapshot) {
  return r5NativeSurvivalShoreExitCueEvidenceV1(
    baselineSnapshot,
    candidateSnapshot,
    { exactHeldAttempt: true },
  );
}

/** Journal-transport coverage only; scenario acceptance must use the exact-one helper above. */
export function r5NativeSurvivalShoreExitJournalTransportEvidence(baselineSnapshot, candidateSnapshot) {
  return r5NativeSurvivalShoreExitCueEvidenceV1(
    baselineSnapshot,
    candidateSnapshot,
    { exactHeldAttempt: false },
  );
}

function r5NativeSurvivalShoreLandingJournal(baseline, candidate, label) {
  const newEffects = newNativeEffectsSince(baseline, candidate, label);
  const linkedEffects = newEffects.filter((cue) => (
    cue.entityExternalId === baseline.effects.playerExternalId
  ));
  const shoreExits = linkedEffects.filter((cue) => cue.kind === "shore-exit");
  const liquidExits = linkedEffects.filter((cue) => cue.kind === "liquid-exit");
  const liquidEnters = linkedEffects.filter((cue) => cue.kind === "liquid-enter");
  const acceptedLiquidExit = liquidExits.length === 1 ? liquidExits[0] : null;
  const acceptedLiquidExitSequence = acceptedLiquidExit === null
    ? null
    : exactDecimalCursor(acceptedLiquidExit.sequence, `${label} liquid-exit sequence`, { positive: true });
  const postExitLandings = acceptedLiquidExitSequence === null
    ? []
    : linkedEffects.filter((cue) => (
      cue.kind === "land"
        && exactDecimalCursor(cue.sequence, `${label} land sequence`, { positive: true })
          > acceptedLiquidExitSequence
    ));
  return Object.freeze({
    newEffects,
    linkedEffects,
    shoreExits,
    liquidExits,
    liquidEnters,
    acceptedLiquidExit,
    postExitLandings,
  });
}

function assertR5NativeSurvivalShoreLandingJournal(baseline, candidate, label) {
  const evidence = r5NativeSurvivalShoreLandingJournal(baseline, candidate, label);
  assertCondition(evidence.shoreExits.length === 1,
    `${label}: held shore mantle did not retain exactly one linked native shore-exit cue`);
  assertCondition(evidence.liquidExits.length === 1,
    `${label}: held shore mantle did not retain exactly one linked native liquid-exit cue`);
  assertCondition(evidence.liquidEnters.length === 0,
    `${label}: native liquid re-entry occurred during or after the accepted shore mantle`);
  assertCondition(evidence.postExitLandings.length > 0,
    `${label}: no durable linked native land cue occurred strictly after liquid-exit`);
  return Object.freeze({
    ...evidence,
    acceptedLanding: evidence.postExitLandings[0],
  });
}

function persistedEnvironmentalState(sample) {
  return Object.freeze({
    worldId: sample.worldId,
    body: Object.freeze({
      position: sample.browser.position,
      velocity: sample.browser.velocity,
      contactFlags: sample.r6.contactFlags,
      inLiquid: sample.r6.inLiquid,
      headSubmerged: sample.r6.headSubmerged,
      oxygenSeconds: sample.r6.oxygenSeconds,
      maximumOxygenSeconds: sample.r6.maximumOxygenSeconds,
      drowningAccumulator: sample.r6.drowningAccumulator,
      fallDistance: sample.r6.fallDistance,
      health: sample.r6.health,
      maximumHealth: sample.r6.maximumHealth,
      lastDamageTick: sample.r6.lastDamageTick,
    }),
    r6EntityId: sample.r6.entityId,
    r7: Object.freeze({
      entityId: sample.r7.entityId,
      recordId: sample.r7.recordId,
      vitalUnits: sample.r7.vitalUnits,
      health: sample.r7.health,
      maxHealth: sample.r7.maxHealth,
      alive: sample.r7.alive,
      crossDomainParity: sample.r7.crossDomainParity,
    }),
    effects: Object.freeze({
      schema: sample.effects.schema,
      producer: sample.effects.producer,
      playerExternalId: sample.effects.playerExternalId,
      total: sample.effects.total,
      selected: sample.effects.selected,
      omitted: sample.effects.omitted,
      firstSequence: sample.effects.firstSequence,
      lastSequence: sample.effects.lastSequence,
      contiguous: sample.effects.contiguous,
      cues: sample.effects.cues,
    }),
  });
}

function samePersistedEnvironmentalState(left, right) {
  return exactJson(persistedEnvironmentalState(left), persistedEnvironmentalState(right));
}

function lawfulOpenPersistencePredecessor(sampled, checkpointBefore) {
  if (sampled === null || typeof sampled !== "object"
    || checkpointBefore === null || typeof checkpointBefore !== "object"
    || sampled.state !== "open" || checkpointBefore.state !== "open"
    || sampled.worldId !== checkpointBefore.worldId
    || sampled.lastError !== null || checkpointBefore.lastError !== null) return false;
  const exactSessionCounters = [
    "recoveries",
    "legacyMigrations",
    "legacyMigrationRetries",
    "parentFallbacks",
  ];
  const monotonicSaveCounters = [
    "saves",
    "platformOperations",
    "requestBytes",
    "responseBytes",
  ];
  if (!exactSessionCounters.every((field) => Number.isSafeInteger(sampled[field])
      && sampled[field] >= 0 && checkpointBefore[field] === sampled[field])
    || !monotonicSaveCounters.every((field) => Number.isSafeInteger(sampled[field])
      && sampled[field] >= 0 && Number.isSafeInteger(checkpointBefore[field])
      && checkpointBefore[field] >= sampled[field])) return false;
  if (checkpointBefore.saves === sampled.saves) return exactJson(checkpointBefore, sampled);
  return checkpointBefore.platformOperations > sampled.platformOperations
    && checkpointBefore.requestBytes > sampled.requestBytes
    && checkpointBefore.responseBytes > sampled.responseBytes
    && typeof checkpointBefore.lastCheckpointId === "string"
    && checkpointBefore.lastCheckpointId.length > 0
    && checkpointBefore.lastCheckpointId !== sampled.lastCheckpointId;
}

function persistedEnvironmentalStateWithoutOxygen(sample) {
  const persisted = persistedEnvironmentalState(sample);
  return Object.freeze({
    ...persisted,
    body: Object.freeze({ ...persisted.body, oxygenSeconds: null }),
  });
}

function assertLawfulFirstDryRestoredSuccessor(before, restored) {
  assertCondition(exactJson(
    persistedEnvironmentalStateWithoutOxygen(before),
    persistedEnvironmentalStateWithoutOxygen(restored),
  ), "fresh Continue did not restore exact native body, health, R7 vitals, and effect-journal state outside lawful oxygen recovery");
  assertCondition(!before.r6.inLiquid && !before.r6.headSubmerged
    && !restored.r6.inLiquid && !restored.r6.headSubmerged,
  "fresh Continue oxygen successor was not dry");
  const beforeTick = exactDecimalCursor(before.authorityTick, "pre-save dry oxygen authority tick");
  const restoredTick = exactDecimalCursor(restored.authorityTick, "restored dry oxygen authority tick");
  const tickDelta = restoredTick - beforeTick;
  assertCondition(tickDelta >= BigInt(0) && tickDelta <= R5_NATIVE_FIRST_RESTORED_ADVANCE_MAX_TICKS,
    "fresh Continue first dry authority advance exceeded its bounded restoration window");
  let expectedOxygen = before.r6.oxygenSeconds;
  const oxygenPerStep = R5_NATIVE_FIXED_STEP_SECONDS * R5_NATIVE_DRY_OXYGEN_RECOVERY_PER_SECOND;
  for (let tick = BigInt(0); tick < tickDelta; tick += BigInt(1)) {
    expectedOxygen = Math.min(before.r6.maximumOxygenSeconds, expectedOxygen + oxygenPerStep);
  }
  const actualOxygen = restored.r6.oxygenSeconds;
  const bitFaithfulTolerance = Number.EPSILON * Math.max(1, Math.abs(expectedOxygen), Math.abs(actualOxygen));
  assertCondition(Object.is(actualOxygen, expectedOxygen)
    || Math.abs(actualOxygen - expectedOxygen) <= bitFaithfulTolerance,
  `fresh Continue dry oxygen recovery is not the lawful fixed-step successor: expected=${expectedOxygen} actual=${actualOxygen} ticks=${tickDelta}`);
  return Object.freeze({
    tickDelta: tickDelta.toString(10),
    expectedOxygen,
    actualOxygen,
  });
}

/** Proves that Save & Quit retained one exact native checkpoint after runtime teardown. */
export function r5NativeSurvivalCheckpointEvidence(beforeSaveSnapshot, checkpointedSnapshot) {
  const before = r5NativeSurvivalEnvironmentSample(beforeSaveSnapshot, { phase: "pre-save", ordinal: 0 });
  const beforeRuntime = beforeSaveSnapshot?.runtime;
  const checkpointedRuntime = checkpointedSnapshot?.runtime;
  const retained = checkpointedSnapshot?.runtime?.lastCompletedSaveAndQuitNativeCheckpoint ?? null;
  const retainedEnvironment = retained?.terminalEnvironmentalSurvival ?? null;
  const completedTeardown = checkpointedSnapshot?.state?.state === "title"
    && checkpointedRuntime?.operationsBlocked === true
    && checkpointedRuntime?.manager?.host === null;
  assertCondition(completedTeardown,
    "native Save & Quit checkpoint was not observed after the completed blocked title teardown");
  assertCondition(retained !== null && typeof retained === "object" && retainedEnvironment !== null,
    "completed native Save & Quit teardown retained no exact checkpoint witness");
  assertCondition(exactJson(
    retainedEnvironment,
    beforeRuntime?.playerAuthority?.environmentalSurvival ?? null,
  ), "native environmental state changed between the terminal pose and its retained checkpoint witness");
  const checkpointed = Object.freeze({
    ...before,
    phase: "checkpointed-after-teardown",
    ordinal: 1,
    gameState: checkpointedSnapshot?.state?.state,
  });
  const beforePersistence = beforeRuntime?.manager?.host?.nativePersistence;
  const retainedBeforePersistence = retained?.persistence?.before ?? null;
  const afterPersistence = retained?.persistence?.after ?? null;
  assertCondition(beforePersistence?.state === "open" && afterPersistence?.state === "open",
    "native Save & Quit checkpoint was not observed on one open persistence session");
  const binding = retained?.binding;
  const checkpoint = retained?.checkpoint;
  assertCondition(retained.schema === 1
    && binding !== null && typeof binding === "object"
    && checkpoint !== null && typeof checkpoint === "object"
    && retainedBeforePersistence !== null
    && lawfulOpenPersistencePredecessor(beforePersistence, retainedBeforePersistence),
  "retained Save & Quit checkpoint witness does not bind a lawful predecessor of the sampled pre-save persistence session");
  assertCondition(typeof beforeRuntime?.activeWorldId === "string" && beforeRuntime.activeWorldId.length > 0
    && typeof beforeRuntime?.activeUniverseId === "string" && beforeRuntime.activeUniverseId.length > 0
    && typeof beforeRuntime?.activeLocationId === "string" && beforeRuntime.activeLocationId.length > 0
    && typeof beforeRuntime?.activeSessionId === "string" && beforeRuntime.activeSessionId.length > 0
    && beforeRuntime.playerAuthority?.runtimeSessionId === beforeRuntime.activeSessionId,
  "pre-save native runtime does not expose one exact active world, universe, location, and session binding");
  assertCondition(binding.catalogWorldId === beforeRuntime.activeWorldId
    && binding.catalogWorldId === before.worldId
    && binding.nativeWorldId === beforePersistence.worldId
    && binding.universeId === beforeRuntime.activeUniverseId
    && binding.locationId === beforeRuntime.activeLocationId
    && binding.runtimeSessionId === beforeRuntime.activeSessionId
    && checkpoint.worldId === binding.nativeWorldId
    && afterPersistence.worldId === binding.nativeWorldId,
  "retained Save & Quit checkpoint witness changed catalog, native-world, universe, location, or runtime-session custody");
  assertCondition(typeof checkpoint.saveId === "string" && checkpoint.saveId.length > 0
    && typeof checkpoint.checkpointId === "string" && checkpoint.checkpointId.length > 0
    && typeof checkpoint.checkpointHash === "string" && /^[0-9a-f]{32}$/u.test(checkpoint.checkpointHash),
  "retained Save & Quit checkpoint identity is malformed");
  exactNonNegativeInteger(checkpoint.journalSequence, "retained native checkpoint journal sequence");
  exactNonNegativeInteger(checkpoint.records, "retained native checkpoint record count");
  exactNonNegativeInteger(checkpoint.commits, "retained native checkpoint commit count");
  exactNonNegativeInteger(checkpoint.requestBytes, "retained native checkpoint request bytes");
  exactNonNegativeInteger(checkpoint.responseBytes, "retained native checkpoint response bytes");
  assertCondition(checkpoint.commits > 0
    && afterPersistence.platformOperations === retainedBeforePersistence.platformOperations + checkpoint.commits
    && afterPersistence.requestBytes === retainedBeforePersistence.requestBytes + checkpoint.requestBytes
    && afterPersistence.responseBytes === retainedBeforePersistence.responseBytes + checkpoint.responseBytes
    && afterPersistence.lastCheckpointId === checkpoint.checkpointId
    && afterPersistence.lastError === null,
  "retained Save & Quit checkpoint witness does not prove its exact durable commit deltas");
  assertCondition(retainedBeforePersistence.worldId === afterPersistence.worldId,
    "native Save & Quit checkpoint changed persistence world custody");
  exactNonNegativeInteger(retainedBeforePersistence.saves, "pre-save native save count");
  exactNonNegativeInteger(afterPersistence.saves, "checkpointed native save count");
  exactNonNegativeInteger(retainedBeforePersistence.platformOperations, "pre-save native platform operations");
  exactNonNegativeInteger(afterPersistence.platformOperations, "checkpointed native platform operations");
  assertCondition(afterPersistence.saves === retainedBeforePersistence.saves + 1,
    "Save & Quit did not complete exactly one native save before teardown");
  assertCondition(afterPersistence.platformOperations > retainedBeforePersistence.platformOperations,
    "Save & Quit native checkpoint performed no durable platform operation");
  assertCondition(typeof afterPersistence.lastCheckpointId === "string" && afterPersistence.lastCheckpointId.length > 0,
    "Save & Quit native checkpoint id is absent");
  assertCondition(afterPersistence.lastCheckpointId !== retainedBeforePersistence.lastCheckpointId,
    "Save & Quit did not advance the exact native checkpoint id");
  assertCondition(checkpointed.gameState === "title" && checkpointedRuntime.operationsBlocked === true,
    "native checkpoint was not observed after the blocked Save & Quit title transition");
  assertCondition(samePersistedEnvironmentalState(before, checkpointed),
    "native environmental state changed between the terminal pose and its checkpoint");
  assertCondition(before.authorityTick === checkpointed.authorityTick
    && before.extractionRevision === checkpointed.extractionRevision
    && before.r6.entityRevision === checkpointed.r6.entityRevision
    && before.r7.rowRevision === checkpointed.r7.rowRevision
    && before.r7.combatDomainRevision === checkpointed.r7.combatDomainRevision
    && before.effects.authorityTick === checkpointed.effects.authorityTick
    && before.projectedDamageEvents === checkpointed.projectedDamageEvents
    && before.projectedDeathEvents === checkpointed.projectedDeathEvents,
  "native environmental cursor or projection counter changed during the no-simulation checkpoint transition");
  return Object.freeze({
    worldId: before.worldId,
    checkpointId: afterPersistence.lastCheckpointId,
    checkpointHash: checkpoint.checkpointHash,
    retainedAfterTeardown: completedTeardown,
    savesBefore: retainedBeforePersistence.saves,
    savesAfter: afterPersistence.saves,
    platformOperationsBefore: retainedBeforePersistence.platformOperations,
    platformOperationsAfter: afterPersistence.platformOperations,
    before,
    checkpointed,
  });
}

function cursorAfter(left, right, label) {
  assertCondition(exactDecimalCursor(right, `${label} successor`) > exactDecimalCursor(left, `${label} predecessor`),
    `${label} did not advance`);
}

function cursorAtLeast(left, right, label) {
  assertCondition(exactDecimalCursor(right, `${label} successor`) >= exactDecimalCursor(left, `${label} predecessor`),
    `${label} regressed across native restoration`);
}

/**
 * Requires the complete deterministic dry -> submerged -> damage -> surface ->
 * shore -> checkpoint -> reload chain. Every phase is resampled from the two
 * public browser projections so a synthetic or presentation-only claim fails.
 */
export function assertR5NativeSurvivalEnvironmentSequence(input) {
  const ordered = [
    ["dryBaseline", input?.dryBaseline],
    ["submergedEntry", input?.submergedEntry],
    ["oxygenDrained", input?.oxygenDrained],
    ["ascentWindow", input?.ascentWindow],
    ["ascentArmed", input?.ascentArmed],
    ["damaged", input?.damaged],
    ["surfaced", input?.surfaced],
    ["shoreExitCue", input?.shoreExitCue],
    ["shoreExit", input?.shoreExit],
    ["shoreSettled", input?.shoreSettled],
    ["preSave", input?.preSave],
    ["restored", input?.restored],
  ];
  const samples = Object.fromEntries(ordered.map(([phase, snapshot], ordinal) => (
    [phase, r5NativeSurvivalEnvironmentSample(snapshot, { phase, ordinal })]
  )));
  const sequenceBeforeReload = ordered.slice(0, -1).map(([phase]) => samples[phase]);
  for (let index = 1; index < sequenceBeforeReload.length; index += 1) {
    const sameSurfaceAndCueExtraction = sequenceBeforeReload[index].phase === "shoreExitCue"
      && exactJson(input?.surfaced, input?.shoreExitCue);
    if (sameSurfaceAndCueExtraction) {
      assertCondition(sequenceBeforeReload[index - 1].authorityTick === sequenceBeforeReload[index].authorityTick,
        "shoreExitCue repeated the surface-recovery extraction with a different authority tick");
    } else {
      cursorAfter(sequenceBeforeReload[index - 1].authorityTick, sequenceBeforeReload[index].authorityTick,
        `${sequenceBeforeReload[index].phase} authority tick`);
    }
    assertCondition(sequenceBeforeReload[index].worldId === samples.dryBaseline.worldId,
      `${sequenceBeforeReload[index].phase}: active world custody changed`);
    assertCondition(sequenceBeforeReload[index].r6.entityId === samples.dryBaseline.r6.entityId
      && sequenceBeforeReload[index].r7.recordId === samples.dryBaseline.r7.recordId,
    `${sequenceBeforeReload[index].phase}: player R6/R7 identity changed`);
    cursorAtLeast(
      sequenceBeforeReload[index - 1].r7.combatDomainRevision,
      sequenceBeforeReload[index].r7.combatDomainRevision,
      `${sequenceBeforeReload[index].phase} R7 combat-domain revision`,
    );
  }

  const contact = R5_NATIVE_SURVIVAL_CONTACT;
  assertCondition(!samples.dryBaseline.r6.inLiquid && !samples.dryBaseline.r6.headSubmerged
    && samples.dryBaseline.r6.oxygenSeconds === samples.dryBaseline.r6.maximumOxygenSeconds,
  "dry baseline is not dry with full native oxygen");
  assertCondition(samples.dryBaseline.r6.health === samples.dryBaseline.r6.maximumHealth
    && samples.dryBaseline.r7.health === samples.dryBaseline.r7.maxHealth
    && samples.dryBaseline.projectedDamageEvents === 0
    && samples.dryBaseline.projectedDeathEvents === 0
    && samples.dryBaseline.r6.lastDamageTick === "0",
  "dry baseline is not pristine max-health zero-damage native state");
  assertCondition(samples.submergedEntry.r6.inLiquid && samples.submergedEntry.r6.headSubmerged,
    "submerged entry lacks exact R6 liquid/head contacts");
  assertCondition(samples.submergedEntry.r6.oxygenSeconds <= samples.dryBaseline.r6.oxygenSeconds,
    "submerged entry increased native oxygen");
  assertCondition(samples.oxygenDrained.r6.inLiquid && samples.oxygenDrained.r6.headSubmerged
    && samples.oxygenDrained.r6.oxygenSeconds < samples.submergedEntry.r6.oxygenSeconds,
  "head-submerged authority did not drain native oxygen");
  assertCondition(samples.oxygenDrained.r6.health === samples.dryBaseline.r6.health
    && samples.oxygenDrained.r7.health === samples.dryBaseline.r7.health,
  "oxygen-drain evidence included premature health damage");

  for (const sample of [samples.submergedEntry, samples.oxygenDrained, samples.ascentWindow, samples.ascentArmed]) {
    assertCondition(sample.r6.health === samples.dryBaseline.r6.health
      && sample.r7.health === samples.dryBaseline.r7.health
      && sample.projectedDamageEvents === 0
      && sample.projectedDeathEvents === 0
      && sample.r6.lastDamageTick === "0",
    `${sample.phase}: native damage occurred before the accepted first drowning event`);
  }
  assertCondition(samples.ascentWindow.r6.inLiquid && samples.ascentWindow.r6.headSubmerged
    && samples.ascentWindow.r6.oxygenSeconds === 0
    && samples.ascentWindow.r6.drowningAccumulator >= 0.8
    && samples.ascentWindow.r6.drowningAccumulator <= 1,
  "pre-hit ascent window was not captured at zero oxygen and 0.8-1.0 drowning accumulation");
  assertCondition(samples.ascentArmed.r6.inLiquid && samples.ascentArmed.r6.headSubmerged
    && samples.ascentArmed.r6.oxygenSeconds === 0
    && samples.ascentArmed.r6.drowningAccumulator >= samples.ascentWindow.r6.drowningAccumulator
    && samples.ascentArmed.r6.drowningAccumulator < 1.5,
  "ascent controls were not armed below the first native drowning threshold");
  const ascentPlayer = input?.ascentArmed?.state?.player;
  const ascentPump = input?.ascentArmed?.runtime?.playerAuthority?.pump;
  assertCondition(r5NativeSurvivalProjectionSettled(input?.ascentArmed)
    && ascentPlayer?.input?.jumpHeld === true
    && ascentPlayer?.crouching === false
    && ascentPlayer?.sprinting === true
    && (ascentPump?.lastAppliedButtons & (INPUT_BUTTON.jump | INPUT_BUTTON.sprint))
      === (INPUT_BUTTON.jump | INPUT_BUTTON.sprint),
  "pre-hit ascent controls were not acknowledged by one settled native input");

  assertCondition(samples.damaged.r6.inLiquid && samples.damaged.r6.headSubmerged
    && samples.damaged.r6.oxygenSeconds === 0,
  "native drowning damage was not observed at zero oxygen while submerged");
  assertCondition(samples.dryBaseline.r6.health - samples.damaged.r6.health === 1,
    "first native drowning event did not reduce R6 health by exactly one heart");
  assertCondition(samples.dryBaseline.r7.health - samples.damaged.r7.health === 1_000,
    "first native drowning event did not reduce R7 health by exactly 1000 millihearts");
  assertCondition(samples.damaged.projectedDamageEvents === 1,
    "browser projection did not observe exactly the first native damage event");
  assertCondition(samples.damaged.projectedDeathEvents === 0,
    "nonlethal drowning evidence emitted a death event");
  const damagedPlayer = input?.damaged?.state?.player;
  const damagedPump = input?.damaged?.runtime?.playerAuthority?.pump;
  assertCondition(r5NativeSurvivalProjectionSettled(input?.damaged)
    && damagedPlayer?.input?.jumpHeld === true
    && damagedPlayer?.crouching === false
    && damagedPlayer?.sprinting === true
    && (damagedPump?.lastAppliedButtons & (INPUT_BUTTON.jump | INPUT_BUTTON.sprint))
      === (INPUT_BUTTON.jump | INPUT_BUTTON.sprint),
  "first native drowning event did not retain acknowledged ascent controls");
  cursorAfter(samples.ascentArmed.r6.entityRevision, samples.damaged.r6.entityRevision,
    "R6 entity revision after native damage");
  assertCondition(samples.ascentArmed.r7.rowRevision !== samples.damaged.r7.rowRevision,
    "R7 combat row semantic revision did not change after native damage");
  cursorAfter(samples.ascentArmed.r7.combatDomainRevision, samples.damaged.r7.combatDomainRevision,
    "R7 combat-domain revision after native damage");
  const damageTick = exactDecimalCursor(samples.damaged.r6.lastDamageTick, "native damage tick");
  assertCondition(damageTick > exactDecimalCursor(samples.ascentArmed.r6.lastDamageTick, "pre-damage tick")
    && damageTick <= exactDecimalCursor(samples.damaged.authorityTick, "damaged authority tick"),
  "native last-damage tick does not fall inside the accepted damage interval");
  const newDamageEffects = newNativeEffectsSince(samples.ascentArmed, samples.damaged,
    "first native drowning damage");
  const linkedDamageEffects = newDamageEffects.filter((cue) => (
    cue.entityExternalId === samples.damaged.effects.playerExternalId
      && (cue.kind === "drown-damage" || cue.kind === "fall-damage")
  ));
  assertCondition(linkedDamageEffects.length === 1,
    "first native drowning damage did not emit exactly one new player-linked damage cue");
  const damageCue = linkedDamageEffects[0];
  assertCondition(damageCue.kind === "drown-damage",
    "first native damage cue was not drown-damage");
  assertCondition(Object.is(damageCue.amount, 1),
    "first native drown-damage cue amount was not exactly one heart");
  assertCondition(exactDecimalCursor(damageCue.tick, "first native drown-damage cue tick") === damageTick,
    "first native drown-damage cue tick did not equal R6 lastDamageTick");

  assertCondition(!samples.surfaced.r6.headSubmerged
    && samples.surfaced.r6.oxygenSeconds > samples.damaged.r6.oxygenSeconds
    && samples.surfaced.r6.health === samples.damaged.r6.health
    && samples.surfaced.r6.lastDamageTick === samples.damaged.r6.lastDamageTick
    && samples.surfaced.r7.health === samples.damaged.r7.health
    && samples.surfaced.r7.maxHealth === samples.damaged.r7.maxHealth
    && samples.surfaced.r7.alive === samples.damaged.r7.alive
    && samples.surfaced.projectedDamageEvents === samples.damaged.projectedDamageEvents
    && samples.surfaced.projectedDeathEvents === samples.damaged.projectedDeathEvents,
  "surface recovery did not clear head submersion and recover native oxygen with exact unchanged damage state");
  cursorAfter(
    samples.damaged.r7.combatDomainRevision,
    samples.surfaced.r7.combatDomainRevision,
    "R7 combat-domain revision during surface recovery",
  );
  const shoreCueEvidence = r5NativeSurvivalShoreExitCueEvidence(input.damaged, input.shoreExitCue);
  assertCondition(exactJson(shoreCueEvidence.candidate.effects, samples.shoreExitCue.effects),
    "shore-exit BWAU cue evidence disagrees with the ordered public sample");
  const heldAttemptEvidence = r5NativeSurvivalShoreExitCueEvidence(input.damaged, input.preSave);
  assertCondition(sameNativeEffectCue(heldAttemptEvidence.earliestCue, shoreCueEvidence.earliestCue)
    && sameNativeEffectCue(heldAttemptEvidence.latestCue, shoreCueEvidence.latestCue),
  "the held shore-exit attempt changed cue identity after its first public extraction");
  const heldHandoff = assertR5NativeSurvivalShoreLandingJournal(
    samples.damaged,
    samples.shoreExit,
    "held shore handoff",
  );
  const durableHandoff = assertR5NativeSurvivalShoreLandingJournal(
    samples.damaged,
    samples.preSave,
    "durable shore handoff",
  );
  assertCondition(sameNativeEffectCue(heldHandoff.shoreExits[0], shoreCueEvidence.earliestCue),
    "held shore handoff changed the accepted shore-exit cue identity");
  assertCondition(sameNativeEffectCue(heldHandoff.acceptedLiquidExit, durableHandoff.acceptedLiquidExit),
    "accepted liquid-exit cue was not durable through the pre-save terminal pose");
  assertCondition(sameNativeEffectCue(heldHandoff.acceptedLanding, durableHandoff.acceptedLanding),
    "accepted post-exit land cue was not durable through the pre-save terminal pose");
  assertCondition(!samples.shoreExit.r6.inLiquid && !samples.shoreExit.r6.headSubmerged,
    "post-cue shore handoff did not become dry and head-clear on the bank");
  const mantleBounds = R5_NATIVE_SURVIVAL_WORLD_FIXTURE.shoreMantleBounds;
  const [shoreX, shoreY, shoreZ] = samples.shoreExit.browser.position;
  assertCondition(shoreX >= mantleBounds.minimumX && shoreX <= mantleBounds.maximumX
    && shoreY >= mantleBounds.minimumY
    && shoreZ >= mantleBounds.minimumZ && shoreZ <= mantleBounds.maximumZ,
  "post-cue shore handoff did not clear the deterministic bank footprint and minimum support height");
  const shoreExitPlayer = input?.shoreExit?.state?.player;
  const shoreExitPump = input?.shoreExit?.runtime?.playerAuthority?.pump;
  assertCondition(r5NativeSurvivalProjectionSettled(input?.shoreExit)
    && shoreExitPlayer?.input?.jumpHeld === true
    && shoreExitPlayer?.input?.forwardHeld === true
    && shoreExitPlayer?.sprinting === false
    && shoreExitPlayer?.crouching === false
    && shoreExitPump?.lastAppliedMoveX === 0
    && shoreExitPump?.lastAppliedMoveZ === R5_NATIVE_INPUT_AXIS_MAX
    && shoreExitPump?.lastAppliedButtons === INPUT_BUTTON.jump,
  "post-cue shore exit did not retain exact acknowledged forward-swim egress input");
  assertCondition(!samples.shoreSettled.r6.inLiquid && !samples.shoreSettled.r6.headSubmerged
    && Boolean(samples.shoreSettled.r6.contactFlags & contact.grounded),
  "shore settlement is not dry and grounded in R6 contacts");
  const [settledX, settledY, settledZ] = samples.shoreSettled.browser.position;
  const settledVelocity = samples.shoreSettled.browser.velocity;
  assertCondition(settledX >= mantleBounds.minimumX && settledX <= mantleBounds.maximumX
    && settledY >= mantleBounds.minimumY && settledY <= mantleBounds.maximumY
    && settledZ >= mantleBounds.minimumZ && settledZ <= mantleBounds.maximumZ,
  "neutral shore settlement left the deterministic bank footprint");
  assertCondition(Math.hypot(...settledVelocity) <= 0.08,
    "neutral shore settlement retained material velocity");
  const shoreSettledPlayer = input?.shoreSettled?.state?.player;
  const shoreSettledPump = input?.shoreSettled?.runtime?.playerAuthority?.pump;
  assertCondition(r5NativeSurvivalProjectionSettled(input?.shoreSettled)
    && shoreSettledPlayer?.input?.jumpHeld === false
    && shoreSettledPlayer?.input?.forwardHeld === false
    && shoreSettledPlayer?.sprinting === false
    && shoreSettledPlayer?.crouching === false
    && shoreSettledPump?.lastAppliedMoveX === 0
    && shoreSettledPump?.lastAppliedMoveZ === 0
    && shoreSettledPump?.lastAppliedButtons === 0,
  "shore settlement did not acknowledge fully neutral input");
  for (const sample of [samples.surfaced, samples.shoreExitCue, samples.shoreExit, samples.shoreSettled, samples.preSave]) {
    assertCondition(sample.r6.health === samples.damaged.r6.health
      && sample.r7.health === samples.damaged.r7.health
      && sample.r7.maxHealth === samples.damaged.r7.maxHealth
      && sample.r7.alive === samples.damaged.r7.alive
      && sample.r6.lastDamageTick === samples.damaged.r6.lastDamageTick
      && sample.projectedDamageEvents === samples.damaged.projectedDamageEvents
      && sample.projectedDeathEvents === samples.damaged.projectedDeathEvents,
    `${sample.phase}: damage continued after surfacing`);
    if (sample !== samples.surfaced) {
      const newEffects = newNativeEffectsSince(samples.surfaced, sample, `${sample.phase} post-surface effects`);
      assertCondition(!newEffects.some((cue) => cue.entityExternalId === samples.surfaced.effects.playerExternalId
        && (cue.kind === "drown-damage" || cue.kind === "fall-damage")),
      `${sample.phase}: native damage effect occurred after surfacing`);
    }
  }
  assertCondition(!samples.preSave.r6.inLiquid && !samples.preSave.r6.headSubmerged
    && Boolean(samples.preSave.r6.contactFlags & contact.grounded),
  "pre-save native player is not terminal, dry, and grounded");

  const checkpoint = r5NativeSurvivalCheckpointEvidence(input.preSave, input.checkpointed);
  assertCondition(checkpoint.retainedAfterTeardown === true,
    "environment gate did not retain its native checkpoint through completed runtime teardown");
  assertCondition(samples.restored.hydration === "restored", "fresh Continue did not report restored native hydration");
  assertCondition(samples.restored.projectedDamageEvents === 0 && samples.restored.projectedDeathEvents === 0,
    "fresh Continue replayed native hurt or death presentation counters");
  const restoredDrySuccessor = assertLawfulFirstDryRestoredSuccessor(samples.preSave, samples.restored);
  for (const [phase, predecessor] of [
    ["pre-save", samples.preSave],
    ["checkpoint", checkpoint.checkpointed],
  ]) {
    cursorAtLeast(predecessor.authorityTick, samples.restored.authorityTick,
      `restored authority tick versus ${phase}`);
    cursorAtLeast(predecessor.r6.entityRevision, samples.restored.r6.entityRevision,
      `restored R6 entity revision versus ${phase}`);
    cursorAtLeast(predecessor.r7.combatDomainRevision, samples.restored.r7.combatDomainRevision,
      `restored R7 combat-domain revision versus ${phase}`);
  }
  assertCondition(input?.lifecycle?.saveAndQuitCompleted === true,
    "environment gate did not complete Save & Quit");
  assertCondition(input?.lifecycle?.freshPageReloadBeforeContinue === true,
    "environment gate did not perform a fresh page reload before Continue");
  assertCondition(input?.lifecycle?.freshContinueCompleted === true,
    "environment gate did not complete fresh Continue");
  assertCondition(input?.lifecycle?.r5SelectorPreserved === true,
    "environment gate lost the explicit R5 selector across reload");

  return Object.freeze({
    schema: 1,
    complete: true,
    producer: R5_NATIVE_SURVIVAL_ENVIRONMENT_PRODUCER,
    samples: Object.freeze(samples),
    shoreExit: Object.freeze({
      observedCueCount: heldAttemptEvidence.shoreExitCount,
      firstObservedPhase: exactJson(input.surfaced, input.shoreExitCue) ? "surface-recovery" : "shore-exit-cue",
      earliestCue: heldAttemptEvidence.earliestCue,
      latestCue: heldAttemptEvidence.latestCue,
      acceptedLiquidExit: Object.freeze({ ...heldHandoff.acceptedLiquidExit }),
      acceptedLanding: Object.freeze({ ...heldHandoff.acceptedLanding }),
    }),
    checkpoint,
    restoredDrySuccessor,
    lifecycle: Object.freeze({ ...input.lifecycle }),
  });
}

/** Final post-cleanup acceptance guard for a retained environmental result. */
export function assertR5NativeSurvivalEnvironmentTerminalGate(result) {
  assertCondition(result?.status === "passed", `native environmental result status is ${String(result?.status)}`);
  assertCondition(result?.environmentEvidence?.complete === true,
    "native environmental sequence evidence is incomplete");
  assertCondition(result?.environmentEvidence?.checkpoint?.retainedAfterTeardown === true,
    "native environmental result did not prove its checkpoint after completed runtime teardown");
  assertCondition(Number.isSafeInteger(result?.environmentEvidence?.shoreExit?.observedCueCount)
    && result.environmentEvidence.shoreExit.observedCueCount === 1,
  "native environmental result did not retain exactly one observed shore-exit cue");
  assertCondition(result?.environmentEvidence?.shoreExit?.acceptedLiquidExit?.kind === "liquid-exit"
    && result?.environmentEvidence?.shoreExit?.acceptedLanding?.kind === "land",
  "native environmental result did not retain the accepted liquid-exit and post-exit land cues");
  for (const key of [
    "exactSubmergeAndOxygenDrain",
    "exactNativeHealthReduction",
    "noTypeScriptDamageAuthoring",
    "surfaceAndShoreExit",
    "nativeCheckpointBeforeSave",
    "saveQuitReloadContinueRestoration",
    "r6R7Parity",
  ]) {
    assertCondition(result?.coverage?.[key] === "passed", `native environmental coverage '${key}' did not pass`);
  }
  assertR5BrowserErrorStreams({
    routeErrors: result?.routeErrors,
    consoleErrors: result?.consoleErrors,
    pageErrors: result?.pageErrors,
    runtimeErrors: result?.runtimeErrors,
  });
  assertCondition(r5CleanupGatePassed(result?.cleanup),
    "native environmental browser/server/profile/mutex/source cleanup gate failed");
  return true;
}

function exactNativeHash(value, label, { allowZero = false } = {}) {
  assertCondition(typeof value === "string" && /^[0-9a-f]{32}$/u.test(value),
    `${label} is not one exact 16-byte lowercase hash`);
  assertCondition(allowZero || value !== "0".repeat(32), `${label} is the zero hash`);
  return value;
}

function exactSafeInteger(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  assertCondition(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${label} is outside its exact integer range`);
  return value;
}

function exactFiniteVector3(value, label) {
  assertCondition(value !== null && typeof value === "object", `${label} is absent`);
  return Object.freeze({
    x: finite(value.x, `${label}.x`),
    y: finite(value.y, `${label}.y`),
    z: finite(value.z, `${label}.z`),
  });
}

function exactFixedMilliVector3(value, label) {
  assertCondition(value !== null && typeof value === "object", `${label} is absent`);
  for (const axis of ["xMilli", "yMilli", "zMilli"]) {
    assertCondition(Number.isSafeInteger(value[axis]), `${label}.${axis} is not an exact safe integer`);
  }
  return Object.freeze({ xMilli: value.xMilli, yMilli: value.yMilli, zMilli: value.zMilli });
}

function exactNativeDeathDrop(parent, drop, index, label) {
  const prefix = `${label} native death child ${index}`;
  assertCondition(drop?.parentRespawnSequence === parent.respawnSequence,
    `${prefix} changed its parent respawn sequence`);
  assertCondition(drop?.parentReceiptHash === parent.receiptHash,
    `${prefix} changed its parent receipt hash`);
  assertCondition(drop?.sourceLane === "inventory" || drop?.sourceLane === "equipment",
    `${prefix} has an invalid custody lane`);
  exactSafeInteger(drop?.sourceSlot, `${prefix} source slot`, { maximum: 65_535 });
  assertCondition(Number.isSafeInteger(drop?.stack?.itemCode) && drop.stack.itemCode > 0,
    `${prefix} item code is invalid`);
  exactSafeInteger(drop?.stack?.count, `${prefix} item count`, { minimum: 1, maximum: 64 });
  assertCondition(drop.stack.durabilityMillionths === null
    || Number.isSafeInteger(drop.stack.durabilityMillionths)
      && drop.stack.durabilityMillionths >= 0 && drop.stack.durabilityMillionths <= 1_000_000,
  `${prefix} durability is invalid`);
  exactNativeHash(drop.stack.metadataHash, `${prefix} metadata hash`, { allowZero: true });
  assertCondition(typeof drop.dropId === "string" && drop.dropId.length > 0 && drop.dropId.length <= 160,
    `${prefix} drop id is invalid`);
  exactDecimalCursor(drop.entityId, `${prefix} entity id`, { positive: true });
  assertCondition(typeof drop.custodyContainer === "string" && drop.custodyContainer.length > 0,
    `${prefix} custody container is absent`);
  assertCondition(drop.custodySlot === 0, `${prefix} custody slot is not the exact native slot zero`);
  exactDecimalCursor(drop.custodyRevision, `${prefix} custody revision`);
  exactDecimalCursor(drop.spatialRevision, `${prefix} spatial revision`);
  const position = exactFixedMilliVector3(drop.position, `${prefix} position`);
  const velocity = exactFixedMilliVector3(drop.velocityMilliPerSecond, `${prefix} velocity`);
  assertCondition(drop.rotation !== null && typeof drop.rotation === "object", `${prefix} rotation is absent`);
  for (const axis of ["yaw", "pitch", "roll"]) {
    exactSafeInteger(drop.rotation[axis], `${prefix} rotation.${axis}`, { maximum: 0xffff_ffff });
  }
  exactDecimalCursor(drop.createdTick, `${prefix} created tick`);
  if (drop.expiresTick !== null) exactDecimalCursor(drop.expiresTick, `${prefix} expires tick`, { positive: true });
  assertCondition(drop.pickupLockActorId === null
    || typeof drop.pickupLockActorId === "string" && drop.pickupLockActorId.length > 0,
  `${prefix} pickup lock is malformed`);
  exactDecimalCursor(drop.pickupUnlockTick, `${prefix} pickup unlock tick`);
  exactNativeHash(drop.originHash, `${prefix} origin hash`);
  assertCondition(drop.content !== null && typeof drop.content === "object", `${prefix} content binding is absent`);
  for (const key of ["configuredManifestHash", "installedManifestHash", "installedRegistryHash", "itemContentHash"]) {
    exactNativeHash(drop.content[key], `${prefix} ${key}`);
  }
  exactSafeInteger(drop.content.itemContentVersion, `${prefix} item content version`, { minimum: 1, maximum: 0xffff_ffff });
  assertCondition(typeof drop.r6Linked === "boolean", `${prefix} R6 link marker is absent`);
  return Object.freeze({
    ...drop,
    stack: Object.freeze({ ...drop.stack }),
    position,
    velocityMilliPerSecond: velocity,
    rotation: Object.freeze({ ...drop.rotation }),
    content: Object.freeze({ ...drop.content }),
  });
}

function exactNativeRespawnAuthority(snapshot, label) {
  const authority = snapshot?.runtime?.playerAuthority;
  const respawn = authority?.nativeRespawn;
  assertCondition(respawn?.schema === 1, `${label}: native BWX0 respawn diagnostic is absent`);
  exactDecimalCursor(respawn.gameplaySequence, `${label} gameplay sequence`);
  exactDecimalCursor(respawn.gameplayCombatRevision, `${label} gameplay combat revision`);
  exactDecimalCursor(respawn.combatantRevision, `${label} combatant revision`);
  if (respawn.deathSequence !== null) exactDecimalCursor(respawn.deathSequence, `${label} death sequence`, { positive: true });
  if (respawn.lastRespawnSequence !== null) {
    exactDecimalCursor(respawn.lastRespawnSequence, `${label} last respawn sequence`, { positive: true });
  }
  for (const key of [
    "queuedInputsEmpty",
    "pendingContextCommandsEmpty",
    "pendingMovementResultEmpty",
    "miningStateEmpty",
  ]) {
    assertCondition(typeof respawn[key] === "boolean", `${label}: native respawn readiness '${key}' is absent`);
  }
  const alive = snapshot?.state?.player?.alive;
  assertCondition(typeof alive === "boolean", `${label}: public player alive marker is absent`);
  assertCondition(alive
    ? respawn.deathSequence === null
      ? respawn.lastRespawnSequence === null
      : respawn.lastRespawnSequence === respawn.deathSequence
    : respawn.deathSequence !== null
      && (respawn.lastRespawnSequence === null
        || BigInt(respawn.deathSequence) > BigInt(respawn.lastRespawnSequence)),
  `${label}: native death/respawn lifecycle contradicts public combat state`);

  const parent = respawn.latestDeathRespawn;
  if (parent === null) return Object.freeze({ ...respawn, latestDeathRespawn: null });
  exactDecimalCursor(parent.respawnSequence, `${label} parent respawn sequence`, { positive: true });
  exactNativeHash(parent.receiptHash, `${label} parent receipt hash`);
  exactSafeInteger(parent.generatedDropCount, `${label} generated death-drop count`, { maximum: 17 });
  assertCondition(Array.isArray(parent.drops) && parent.drops.length === parent.generatedDropCount,
    `${label}: native death parent child cardinality disagrees`);
  exactDecimalCursor(parent.playerId, `${label} parent player id`, { positive: true });
  exactDecimalCursor(parent.entityId, `${label} parent entity id`, { positive: true });
  exactDecimalCursor(parent.deathSequence, `${label} parent death sequence`, { positive: true });
  assertCondition(parent.entityId === String(authority?.entityId ?? ""),
    `${label}: native death parent entity does not match the live player`);
  for (const key of ["inventoryContainer", "equipmentContainer"]) {
    assertCondition(typeof parent[key] === "string" && parent[key].length > 0,
      `${label}: parent ${key} is absent`);
  }
  for (const key of [
    "inventoryBeforeRevision",
    "inventoryAfterRevision",
    "equipmentBeforeRevision",
    "equipmentAfterRevision",
  ]) exactDecimalCursor(parent[key], `${label} parent ${key}`);
  exactNativeHash(parent.custodyAfterHash, `${label} parent custody-after hash`);
  const drops = parent.drops.map((drop, index) => exactNativeDeathDrop(parent, drop, index, label));
  assertCondition(new Set(drops.map((drop) => drop.dropId)).size === drops.length,
    `${label}: native death parent repeats a drop id`);
  assertCondition(new Set(drops.map((drop) => drop.entityId)).size === drops.length,
    `${label}: native death parent repeats a drop entity`);
  return Object.freeze({
    ...respawn,
    latestDeathRespawn: Object.freeze({ ...parent, drops: Object.freeze(drops) }),
  });
}

function exactNativeDeathDropProjection(snapshot, child, label) {
  const browserDrops = snapshot?.state?.drops;
  assertCondition(Array.isArray(browserDrops), `${label}: public browser drops are absent`);
  const browserMatches = browserDrops.filter((drop) => drop?.rustEntityId === child.entityId);
  assertCondition(browserMatches.length === 1,
    `${label}: exact native death child is not represented once in the browser drop projection`);
  const browser = browserMatches[0];
  assertCondition(browser.item === child.stack.itemCode && browser.count === child.stack.count,
    `${label}: browser death drop changed the exact native stack`);
  assertCondition(Array.isArray(browser.position) && browser.position.length === 3
    && Array.isArray(browser.velocity) && browser.velocity.length === 3,
  `${label}: browser death-drop transform is absent`);
  browser.position.forEach((value, index) => finite(value, `${label} browser death-drop position[${index}]`));
  browser.velocity.forEach((value, index) => finite(value, `${label} browser death-drop velocity[${index}]`));
  finite(browser.rotationY, `${label} browser death-drop rotation`);
  finite(browser.age, `${label} browser death-drop age`);

  const nativeFrame = snapshot?.runtime?.playerAuthority?.nativeDropTransforms;
  assertCondition(nativeFrame !== null && typeof nativeFrame === "object"
    && Array.isArray(nativeFrame.transforms), `${label}: native hot drop transforms are absent`);
  const frameExtractionRevision = exactDecimalCursor(
    nativeFrame.extractionRevision,
    `${label} native drop extraction revision`,
    { positive: true },
  );
  const frameAuthorityTick = exactDecimalCursor(nativeFrame.authorityTick, `${label} native drop authority tick`);
  const environment = snapshot?.runtime?.playerAuthority?.environmentalSurvival;
  const nativeInventory = snapshot?.runtime?.playerAuthority?.nativeInventory;
  const pump = snapshot?.runtime?.playerAuthority?.pump;
  const environmentExtractionRevision = exactDecimalCursor(
    environment?.extractionRevision,
    `${label} environmental extraction revision`,
    { positive: true },
  );
  const inventoryExtractionRevision = exactDecimalCursor(
    nativeInventory?.extractionRevision,
    `${label} native inventory extraction revision`,
    { positive: true },
  );
  const pumpExtractionRevision = BigInt(exactSafeInteger(
    pump?.lastExtractionRevision,
    `${label} pump extraction revision`,
    { minimum: 1 },
  ));
  assertCondition(frameExtractionRevision === environmentExtractionRevision
    && frameExtractionRevision === inventoryExtractionRevision
    && frameExtractionRevision <= pumpExtractionRevision
    && frameAuthorityTick === exactDecimalCursor(environment?.authorityTick, `${label} environmental authority tick`)
    && frameAuthorityTick === BigInt(exactSafeInteger(pump?.lastAuthorityTick, `${label} pump authority tick`)),
  `${label}: native drop frame is stale versus its BWX0/environment/pump envelope`);
  exactDecimalCursor(nativeFrame.inventoryDomainRevision, `${label} native drop inventory revision`);
  const nativeMatches = nativeFrame.transforms.filter((drop) => (
    drop?.dropId === child.dropId && drop?.entityId === child.entityId
  ));
  assertCondition(nativeMatches.length === 1,
    `${label}: exact native death child is not represented once in the native hot frame`);
  const native = nativeMatches[0];
  exactDecimalCursor(native.entityRevision, `${label} native death-drop entity revision`);
  const nativeAgeTicks = exactDecimalCursor(native.ageTicks, `${label} native death-drop age ticks`);
  assertCondition(nativeAgeTicks <= BigInt(Number.MAX_SAFE_INTEGER),
    `${label}: native death-drop age exceeds exact browser-number range`);
  const childCreatedTick = exactDecimalCursor(child.createdTick, `${label} native death child created tick`);
  assertCondition(frameAuthorityTick >= childCreatedTick && frameAuthorityTick - childCreatedTick === nativeAgeTicks,
    `${label}: native death-drop age does not equal authority tick minus immutable creation tick`);
  const nativePosition = exactFiniteVector3(native.position, `${label} native death-drop position`);
  const nativeVelocity = exactFiniteVector3(native.velocity, `${label} native death-drop velocity`);
  finite(native.yawRadians, `${label} native death-drop yaw`);
  const roundedPosition = [nativePosition.x, nativePosition.y, nativePosition.z]
    .map((value) => Number(value.toFixed(3)));
  const roundedVelocity = [nativeVelocity.x, nativeVelocity.y, nativeVelocity.z]
    .map((value) => Number(value.toFixed(3)));
  assertCondition(exactJson(browser.position, roundedPosition)
    && exactJson(browser.velocity, roundedVelocity)
    && Object.is(browser.rotationY, Number(native.yawRadians.toFixed(6)))
    && Object.is(browser.age, Number((Number(nativeAgeTicks) * R5_NATIVE_FIXED_STEP_SECONDS).toFixed(3))),
  `${label}: browser and native death-drop transforms disagree`);
  return Object.freeze({
    dropId: child.dropId,
    entityId: child.entityId,
    itemCode: child.stack.itemCode,
    count: child.stack.count,
    browser: Object.freeze({
      position: Object.freeze([...browser.position]),
      velocity: Object.freeze([...browser.velocity]),
      rotationY: browser.rotationY,
      age: browser.age,
    }),
    native: Object.freeze({
      extractionRevision: nativeFrame.extractionRevision,
      authorityTick: nativeFrame.authorityTick,
      inventoryDomainRevision: nativeFrame.inventoryDomainRevision,
      entityRevision: native.entityRevision,
      ageTicks: native.ageTicks,
      position: nativePosition,
      velocity: nativeVelocity,
      yawRadians: native.yawRadians,
    }),
  });
}

/** Seals one public BWX0/BWE7 browser projection without reconstructing omitted native fields. */
export function r5NativeSurvivalDeathRespawnSample(snapshot, metadata = {}) {
  const phase = metadata.phase ?? "native-death-respawn";
  const ordinal = metadata.ordinal ?? 0;
  exactNonNegativeInteger(ordinal, "native death-respawn evidence ordinal");
  const environment = r5NativeSurvivalEnvironmentSample(snapshot, { phase, ordinal });
  const authority = snapshot?.runtime?.playerAuthority;
  const respawn = exactNativeRespawnAuthority(snapshot, phase);
  const projection = authority?.playerDeathRespawnProjection;
  assertCondition(projection?.schema === 1
    && Number.isSafeInteger(projection.cursor) && projection.cursor >= 0
    && (projection.lastReceiptHash === null || /^[0-9a-f]{32}$/u.test(projection.lastReceiptHash)),
  `${phase}: browser death-respawn cursor is malformed`);
  const checkpoint = authority?.playerDeathRespawnCheckpoint ?? null;
  if (checkpoint !== null) {
    assertCondition(checkpoint.schema === 1, `${phase}: native death-respawn checkpoint schema is invalid`);
    exactSafeInteger(checkpoint.cursorBefore, `${phase} checkpoint cursor before`);
    exactSafeInteger(checkpoint.cursorAfter, `${phase} checkpoint cursor after`, { minimum: 1 });
    exactNativeHash(checkpoint.receiptHash, `${phase} checkpoint receipt hash`);
    exactNativeHash(checkpoint.queryIdentityHash, `${phase} checkpoint query identity hash`);
    exactDecimalCursor(checkpoint.deathSequence, `${phase} checkpoint death sequence`, { positive: true });
    exactSafeInteger(checkpoint.generatedDropCount, `${phase} checkpoint generated-drop count`, { maximum: 17 });
  }
  const nativeInventory = authority?.nativeInventory;
  assertCondition(nativeInventory !== null && typeof nativeInventory === "object",
    `${phase}: native selected-slot diagnostic is absent`);
  exactDecimalCursor(nativeInventory.extractionRevision, `${phase} native inventory extraction revision`, { positive: true });
  assertCondition(typeof nativeInventory.inventoryContainer === "string" && nativeInventory.inventoryContainer.length > 0,
    `${phase}: native inventory container is absent`);
  exactDecimalCursor(nativeInventory.inventoryContainerRevision, `${phase} native inventory revision`);
  exactSafeInteger(nativeInventory.selectedSlot, `${phase} native selected slot`, { maximum: 8 });
  if (nativeInventory.held !== null) {
    exactSafeInteger(nativeInventory.held.itemCode, `${phase} native held item code`, { minimum: 1, maximum: 65_535 });
    exactSafeInteger(nativeInventory.held.count, `${phase} native held count`, { minimum: 1, maximum: 64 });
    exactNativeHash(nativeInventory.held.metadataHash, `${phase} native held metadata hash`, { allowZero: true });
  }
  const parent = respawn.latestDeathRespawn;
  const dropProjections = parent === null
    ? Object.freeze([])
    : Object.freeze(parent.drops.map((child) => exactNativeDeathDropProjection(snapshot, child, phase)));
  return Object.freeze({
    phase,
    ordinal,
    environment,
    respawn,
    projection: Object.freeze({ ...projection }),
    checkpoint: checkpoint === null ? null : Object.freeze({ ...checkpoint }),
    finalize: authority.playerDeathRespawnFinalize === null
      ? null
      : Object.freeze({ ...authority.playerDeathRespawnFinalize }),
    respawnPlanPending: authority.playerRespawnPlanPending,
    pump: Object.freeze({ ...authority.pump }),
    nativeInventory: Object.freeze({
      ...nativeInventory,
      held: nativeInventory.held === null ? null : Object.freeze({ ...nativeInventory.held }),
    }),
    dropProjections,
  });
}

function sameNativeDeathDropIdentityAndTransform(left, right) {
  return left?.dropId === right?.dropId
    && left?.entityId === right?.entityId
    && left?.itemCode === right?.itemCode
    && left?.count === right?.count
    && exactJson(left?.browser?.position, right?.browser?.position)
    && exactJson(left?.browser?.velocity, right?.browser?.velocity)
    && Object.is(left?.browser?.rotationY, right?.browser?.rotationY)
    && exactJson(left?.native?.position, right?.native?.position)
    && exactJson(left?.native?.velocity, right?.native?.velocity)
    && Object.is(left?.native?.yawRadians, right?.native?.yawRadians);
}

function nativeDeathDropProjectionContinues(previous, next, label, { freshRuntime = false } = {}) {
  assertCondition(previous?.dropId === next?.dropId
    && previous?.entityId === next?.entityId
    && previous?.itemCode === next?.itemCode
    && previous?.count === next?.count,
  `${label}: native death-drop identity or stack changed`);
  for (const [field, strict] of [
    ["extractionRevision", !freshRuntime],
    ["authorityTick", true],
    ["inventoryDomainRevision", false],
    ["entityRevision", false],
    ["ageTicks", false],
  ]) {
    const before = exactDecimalCursor(previous.native[field], `${label} prior ${field}`);
    const after = exactDecimalCursor(next.native[field], `${label} next ${field}`);
    const accepted = freshRuntime && field === "extractionRevision"
      ? after > BigInt(0)
      : freshRuntime && field === "authorityTick"
        ? after >= before
        : strict ? after > before : after >= before;
    assertCondition(accepted, `${label}: native death-drop ${field} regressed or reused a strict source cursor`);
  }
  return true;
}

function nativeDeathDropBoundedMotion(previous, next, tickDelta, label) {
  assertCondition(tickDelta > BigInt(0)
    && tickDelta <= R5_NATIVE_DEATH_DROP_MAXIMUM_PLAYING_SAMPLE_GAP_TICKS,
  `${label}: death-drop samples do not bound a short positive fixed-step interval`);
  const seconds = Number(tickDelta) * R5_NATIVE_FIXED_STEP_SECONDS;
  const priorVelocity = previous.native.velocity;
  const nextVelocity = next.native.velocity;
  assertCondition(Math.abs(nextVelocity.x) <= Math.abs(priorVelocity.x) + 0.001
    && Math.abs(nextVelocity.z) <= Math.abs(priorVelocity.z) + 0.001
    && nextVelocity.y >= -R5_NATIVE_DEATH_DROP_TERMINAL_SPEED_METERS_PER_SECOND - 0.001
    && nextVelocity.y <= Math.max(
      priorVelocity.y,
      R5_NATIVE_DEATH_DROP_MAXIMUM_COLLISION_REBOUND_SPEED_METERS_PER_SECOND,
    ) + 0.001,
  `${label}: native death-drop velocity exceeded its gravity/collision envelope`);
  const maximumMotionSpeed = Math.hypot(
    Math.abs(priorVelocity.x),
    R5_NATIVE_DEATH_DROP_TERMINAL_SPEED_METERS_PER_SECOND,
    Math.abs(priorVelocity.z),
  );
  const displacement = Math.hypot(
    next.native.position.x - previous.native.position.x,
    next.native.position.y - previous.native.position.y,
    next.native.position.z - previous.native.position.z,
  );
  assertCondition(displacement <= maximumMotionSpeed * seconds + 0.01,
    `${label}: native death drop exceeded its bounded fixed-step motion envelope`);

  const fullTurn = Math.PI * 2;
  const actualYawAdvance = (next.native.yawRadians - previous.native.yawRadians + fullTurn) % fullTurn;
  const expectedYawAdvance = Number(
    tickDelta * R5_NATIVE_DEATH_DROP_ROTATION_MICROTURNS_PER_STEP % BigInt(1_000_000),
  ) / 1_000_000 * fullTurn;
  assertCondition(Math.abs(actualYawAdvance - expectedYawAdvance) <= 1e-9,
    `${label}: native death-drop yaw did not advance by the bounded fixed-step rotation`);
  return true;
}

function nativeDeathDropProjectionEvolves(previous, next, label) {
  nativeDeathDropProjectionContinues(previous, next, label);
  const priorAge = exactDecimalCursor(previous.native.ageTicks, `${label} prior age ticks`);
  const nextAge = exactDecimalCursor(next.native.ageTicks, `${label} next age ticks`);
  const priorTick = exactDecimalCursor(previous.native.authorityTick, `${label} prior authority tick`);
  const nextTick = exactDecimalCursor(next.native.authorityTick, `${label} next authority tick`);
  const ageDelta = nextAge - priorAge;
  const tickDelta = nextTick - priorTick;
  assertCondition(ageDelta === tickDelta,
    `${label}: native death-drop age and authority tick deltas disagree`);
  assertCondition(exactDecimalCursor(next.native.entityRevision, `${label} next entity revision`)
    > exactDecimalCursor(previous.native.entityRevision, `${label} prior entity revision`),
  `${label}: moving native death drop did not advance its entity revision`);
  return nativeDeathDropBoundedMotion(previous, next, tickDelta, label);
}

function assertNativeDeathDropFirstObservation(child, projection, label) {
  const spatialRevision = exactDecimalCursor(child.spatialRevision, `${label} immutable spatial revision`);
  const entityRevision = exactDecimalCursor(projection.native.entityRevision, `${label} observed entity revision`);
  const ageTicks = exactDecimalCursor(projection.native.ageTicks, `${label} observed age ticks`);
  const creation = Object.freeze({
    native: Object.freeze({
      position: Object.freeze({
        x: child.position.xMilli / 1_000,
        y: child.position.yMilli / 1_000,
        z: child.position.zMilli / 1_000,
      }),
      velocity: Object.freeze({
        x: child.velocityMilliPerSecond.xMilli / 1_000,
        y: child.velocityMilliPerSecond.yMilli / 1_000,
        z: child.velocityMilliPerSecond.zMilli / 1_000,
      }),
      yawRadians: child.rotation.yaw / 1_000_000 * Math.PI * 2,
    }),
  });
  if (ageTicks === BigInt(0)) {
    assertCondition(entityRevision > spatialRevision
      && exactJson(projection.native.position, creation.native.position)
      && exactJson(projection.native.velocity, creation.native.velocity)
      && Object.is(projection.native.yawRadians, creation.native.yawRadians),
    `${label}: zero-age BWR6 observation is not a strict R6 descendant at the exact BWE7 creation transform`);
    return Object.freeze({ kind: "creation", ageTicks: "0" });
  }
  assertCondition(entityRevision > spatialRevision,
    `${label}: positive-age BWR6 observation is not a strict descendant of the BWE7 spatial revision`);
  nativeDeathDropBoundedMotion(creation, projection, ageTicks, label);
  return Object.freeze({ kind: "descendant", ageTicks: ageTicks.toString(10) });
}

function assertNativeDeathDropRestoredSuccessor(previous, next, label) {
  nativeDeathDropProjectionContinues(previous, next, label, { freshRuntime: true });
  const priorAge = exactDecimalCursor(previous.native.ageTicks, `${label} prior age ticks`);
  const nextAge = exactDecimalCursor(next.native.ageTicks, `${label} next age ticks`);
  const priorTick = exactDecimalCursor(previous.native.authorityTick, `${label} prior authority tick`);
  const nextTick = exactDecimalCursor(next.native.authorityTick, `${label} next authority tick`);
  const ageDelta = nextAge - priorAge;
  const tickDelta = nextTick - priorTick;
  assertCondition(ageDelta === tickDelta && tickDelta <= R5_NATIVE_FIRST_RESTORED_ADVANCE_MAX_TICKS,
    `${label}: restored native drop is not within the exact 0..8 fixed-step successor window`);
  if (tickDelta === BigInt(0)) {
    assertCondition(sameNativeDeathDropIdentityAndTransform(previous, next)
      && previous.native.entityRevision === next.native.entityRevision
      && previous.native.ageTicks === next.native.ageTicks
      && previous.native.authorityTick === next.native.authorityTick
      && BigInt(next.native.inventoryDomainRevision) >= BigInt(previous.native.inventoryDomainRevision),
    `${label}: zero-step restored native drop changed identity, age, entity revision, or transform`);
    return Object.freeze({ tickDelta: "0", kind: "exact" });
  }
  assertCondition(exactDecimalCursor(next.native.entityRevision, `${label} next entity revision`)
    > exactDecimalCursor(previous.native.entityRevision, `${label} prior entity revision`),
  `${label}: advancing restored native drop did not advance its entity revision`);
  nativeDeathDropBoundedMotion(previous, next, tickDelta, label);
  return Object.freeze({ tickDelta: tickDelta.toString(10), kind: "successor" });
}

/** Full fresh-create -> lethal drowning -> native respawn -> Save/Reload/Continue proof. */
export function assertR5NativeSurvivalDeathRespawnSequence(input) {
  const baseline = r5NativeSurvivalDeathRespawnSample(input?.baseline, { phase: "deathBaseline", ordinal: 0 });
  const lastAlive = r5NativeSurvivalDeathRespawnSample(input?.lastAliveSubmerged, { phase: "lastAliveSubmerged", ordinal: 1 });
  const createdProjection = r5NativeSurvivalDeathRespawnSample(
    input?.createdProjection,
    { phase: "deathCreatedProjection", ordinal: 2 },
  );
  const dropSettledStart = r5NativeSurvivalDeathRespawnSample(
    input?.dropSettledStart,
    { phase: "deathDropSettledStart", ordinal: 3 },
  );
  const respawned = r5NativeSurvivalDeathRespawnSample(input?.respawned, { phase: "respawned", ordinal: 4 });
  const pausedFreezeStart = r5NativeSurvivalDeathRespawnSample(
    input?.pausedFreezeStart,
    { phase: "deathPausedFreezeStart", ordinal: 5 },
  );
  const preSave = r5NativeSurvivalDeathRespawnSample(input?.preSave, { phase: "deathPreSave", ordinal: 6 });
  const restored = r5NativeSurvivalDeathRespawnSample(input?.restored, { phase: "deathRestored", ordinal: 7 });
  const baselineHeld = baseline.nativeInventory.held;
  assertCondition(input?.baseline?.state?.inventory?.selectedSlot === 0
    && input?.baseline?.state?.inventory?.held?.item === R5_NATIVE_STARTER_BERRY_ITEM_CODE
    && input?.baseline?.state?.inventory?.held?.count === R5_NATIVE_STARTER_BERRY_COUNT
    && baseline.nativeInventory.selectedSlot === 0
    && baselineHeld?.itemCode === R5_NATIVE_STARTER_BERRY_ITEM_CODE
    && baselineHeld?.count === R5_NATIVE_STARTER_BERRY_COUNT,
  "fresh Survival baseline does not expose the exact native Berry x3 starter stack in slot zero");
  assertCondition(baseline.respawn.latestDeathRespawn === null
    && baseline.respawn.deathSequence === null && baseline.respawn.lastRespawnSequence === null
    && baseline.environment.projectedDeathEvents === 0
    && Array.isArray(input?.baseline?.state?.drops) && input.baseline.state.drops.length === 0
    && Array.isArray(input?.baseline?.runtime?.playerAuthority?.nativeDropTransforms?.transforms)
    && input.baseline.runtime.playerAuthority.nativeDropTransforms.transforms.length === 0,
  "fresh Survival baseline already contains native death/respawn history");
  assertCondition(lastAlive.environment.r6.inLiquid && lastAlive.environment.r6.headSubmerged
    && lastAlive.environment.r7.alive && lastAlive.environment.projectedDeathEvents === 0,
  "last pre-death witness is not one alive submerged native player");

  const parent = createdProjection.respawn.latestDeathRespawn;
  assertCondition(parent !== null && parent.generatedDropCount === 1 && parent.drops.length === 1,
    "native false-policy respawn did not retain exactly one death-drop child");
  const child = parent.drops[0];
  assertCondition(child.sourceLane === "inventory" && child.sourceSlot === 0
    && child.stack.itemCode === R5_NATIVE_STARTER_BERRY_ITEM_CODE
    && child.stack.count === R5_NATIVE_STARTER_BERRY_COUNT
    && child.stack.durabilityMillionths === null && child.custodySlot === 0 && child.r6Linked === true,
  "native false-policy respawn did not transfer exact slot-zero Berry x3 custody into one R6-linked drop");
  assertCondition(createdProjection.dropProjections.length === 1,
    "first BWE7 browser commit did not expose its exact generated drop in BWR6");
  assertCondition(input?.createdProjection?.state?.drops?.length === 1
    && input?.createdProjection?.runtime?.playerAuthority?.nativeDropTransforms?.transforms?.length === 1,
  "fresh lethal fixture contains a browser or native drop outside the sole BWE7 Berry child");
  const createdDrop = createdProjection.dropProjections[0];
  const firstDropObservation = assertNativeDeathDropFirstObservation(
    child,
    createdDrop,
    "first BWE7/BWR6 drop observation",
  );
  const deathPosition = [child.position.xMilli, child.position.yMilli, child.position.zMilli]
    .map((value) => value / 1_000);
  const predecessorPosition = lastAlive.environment.browser.position;
  assertCondition(Math.hypot(
    deathPosition[0] - predecessorPosition[0],
    deathPosition[1] - predecessorPosition[1],
    deathPosition[2] - predecessorPosition[2],
  ) <= R5_NATIVE_DEATH_DROP_MAXIMUM_PREDECESSOR_DISTANCE,
  "native Berry death drop is not near the last alive submerged death-location witness");

  const spawn = R5_NATIVE_SURVIVAL_WORLD_FIXTURE.expectedSpawn;
  assertCondition(createdProjection.environment.browser.position.every((value, index) => Math.abs(value - spawn[index]) <= 0.01)
    && respawned.environment.browser.position.every((value, index) => Math.abs(value - spawn[index]) <= 0.01),
    "automatic native respawn did not return the player to the frozen RUST-SWIM-002 spawn");
  assertCondition(createdProjection.environment.r7.alive
    && createdProjection.respawn.deathSequence !== null
    && createdProjection.respawn.lastRespawnSequence === createdProjection.respawn.deathSequence
    && parent.deathSequence === createdProjection.respawn.deathSequence
    && createdProjection.environment.projectedDeathEvents === baseline.environment.projectedDeathEvents + 1,
  "native lethal drowning did not produce exactly one projected death and one completed respawn lifecycle");
  assertCondition(dropSettledStart.respawn.queuedInputsEmpty && dropSettledStart.respawn.pendingContextCommandsEmpty
    && dropSettledStart.respawn.pendingMovementResultEmpty && dropSettledStart.respawn.miningStateEmpty
    && input?.dropSettledStart?.state?.player?.input?.jumpHeld === false
    && input?.dropSettledStart?.state?.player?.input?.forwardHeld === false
    && input?.dropSettledStart?.state?.player?.sprinting === false
    && input?.dropSettledStart?.state?.player?.crouching === false
    && dropSettledStart.pump.lastAppliedMoveX === 0 && dropSettledStart.pump.lastAppliedMoveZ === 0
    && dropSettledStart.pump.lastAppliedButtons === 0
    && dropSettledStart.pump.nativeInputPending === false && dropSettledStart.pump.pendingInputSequence === null,
  "native death/respawn did not leave browser and pump input fully neutral");

  const expectedCursor = baseline.projection.cursor + 1;
  assertCondition(createdProjection.projection.cursor === expectedCursor
    && createdProjection.projection.lastReceiptHash === parent.receiptHash
    && Number(parent.respawnSequence) === expectedCursor,
  "BWE7 projection did not advance exactly one contiguous browser cursor");
  assertCondition(createdProjection.checkpoint?.cursorBefore === baseline.projection.cursor
    && createdProjection.checkpoint?.cursorAfter === expectedCursor
    && createdProjection.checkpoint?.receiptHash === parent.receiptHash
    && createdProjection.checkpoint?.deathSequence === parent.deathSequence
    && createdProjection.checkpoint?.generatedDropCount === 1,
  "BWE7 projection is not bound to one exact native checkpoint witness");
  assertCondition(createdProjection.finalize === null && createdProjection.respawnPlanPending === false
    && createdProjection.pump.deathRespawnQueryConfigured === true
    && createdProjection.pump.deathRespawnLegacySeedPending === false
    && createdProjection.pump.deathRespawnCursor === expectedCursor
    && createdProjection.pump.pendingDeathRespawnSequence === null
    && createdProjection.pump.pendingDeathRespawnReceiptHash === null
    && createdProjection.pump.pendingDeathRespawnIdentityHash === null
    && createdProjection.pump.lastAcknowledgedDeathRespawnSequence === expectedCursor
    && createdProjection.pump.lastAcknowledgedDeathRespawnReceiptHash === parent.receiptHash,
  "BWE7 checkpoint/projection did not drain its plan/finalize state into one exact pump acknowledgement");
  assertCondition(input?.createdProjection?.state?.inventory?.selectedSlot === 0
    && input?.createdProjection?.state?.inventory?.held === null
    && createdProjection.nativeInventory.selectedSlot === 0 && createdProjection.nativeInventory.held === null,
  "native death/respawn did not clear exact starter slot zero in both public projections");
  assertCondition(exactJson(dropSettledStart.respawn.latestDeathRespawn, parent)
    && exactJson(respawned.respawn.latestDeathRespawn, parent)
    && dropSettledStart.dropProjections.length === 1 && respawned.dropProjections.length === 1,
  "native death/respawn did not retain exactly one Berry drop through playing-state motion");
  nativeDeathDropProjectionContinues(createdDrop, dropSettledStart.dropProjections[0], "death-drop settlement start");
  nativeDeathDropProjectionEvolves(
    dropSettledStart.dropProjections[0],
    respawned.dropProjections[0],
    "death-drop playing evolution",
  );
  assertCondition(input?.pausedFreezeStart?.state?.state === "paused"
    && input?.preSave?.state?.state === "paused"
    && r5PersistencePoseEvidence(input.pausedFreezeStart).terminal
    && r5PersistencePoseEvidence(input.preSave).terminal,
  "native Berry drop freeze witnesses are not two paused, pump-drained player snapshots");
  nativeDeathDropProjectionContinues(
    respawned.dropProjections[0],
    pausedFreezeStart.dropProjections[0],
    "death-drop transition into pause",
  );
  assertCondition(exactJson(pausedFreezeStart.respawn.latestDeathRespawn, parent)
    && pausedFreezeStart.dropProjections.length === 1
    && exactJson(pausedFreezeStart.dropProjections[0], preSave.dropProjections[0]),
  "two paused no-simulation snapshots did not freeze the exact native Berry identity and transform");

  assertCondition(exactJson(preSave.respawn.latestDeathRespawn, parent)
    && exactJson(preSave.projection, createdProjection.projection)
    && preSave.finalize === null && preSave.respawnPlanPending === false
    && preSave.environment.projectedDeathEvents === createdProjection.environment.projectedDeathEvents
    && preSave.nativeInventory.held === null
    && preSave.dropProjections.length === 1
    && sameNativeDeathDropIdentityAndTransform(pausedFreezeStart.dropProjections[0], preSave.dropProjections[0]),
  "native death parent, cursor, or exact Berry drop transform was not stable before Save & Quit");

  const checkpoint = r5NativeSurvivalCheckpointEvidence(input.preSave, input.checkpointed);
  assertCondition(restored.environment.hydration === "restored"
    && restored.environment.projectedDamageEvents === 0
    && restored.environment.projectedDeathEvents === 0,
  "fresh Continue replayed native hurt or death presentation counters");
  assertCondition(exactJson(restored.respawn.latestDeathRespawn, parent)
    && restored.respawn.deathSequence === createdProjection.respawn.deathSequence
    && restored.respawn.lastRespawnSequence === createdProjection.respawn.lastRespawnSequence
    && restored.projection.cursor === expectedCursor
    && restored.projection.lastReceiptHash === parent.receiptHash
    && restored.finalize === null && restored.respawnPlanPending === false
    && restored.pump.deathRespawnCursor === expectedCursor
    && restored.pump.pendingDeathRespawnSequence === null
    && restored.nativeInventory.held === null
    && restored.dropProjections.length === 1,
  "fresh Continue did not preserve the exact death cursor, BWE7 parent, or Berry drop identity/count");
  const restoredDropSuccessor = assertNativeDeathDropRestoredSuccessor(
    preSave.dropProjections[0],
    restored.dropProjections[0],
    "restored death drop",
  );
  assertCondition(input?.lifecycle?.saveAndQuitCompleted === true
    && input?.lifecycle?.freshPageReloadBeforeContinue === true
    && input?.lifecycle?.freshContinueCompleted === true
    && input?.lifecycle?.r5SelectorPreserved === true,
  "native death/respawn lifecycle did not complete Save & Quit, hard reload, Continue, and R5 selector preservation");

  return Object.freeze({
    schema: 1,
    complete: true,
    baseline,
    lastAlive,
    createdProjection,
    dropSettledStart,
    respawned,
    pausedFreezeStart,
    preSave,
    restored,
    parent,
    child,
    firstDropObservation,
    restoredDropSuccessor,
    deathPosition: Object.freeze(deathPosition),
    checkpoint,
    lifecycle: Object.freeze({ ...input.lifecycle }),
  });
}

/** Final post-cleanup acceptance guard for the retained death/respawn result. */
export function assertR5NativeSurvivalDeathRespawnTerminalGate(result) {
  assertCondition(result?.status === "passed", `native death-respawn result status is ${String(result?.status)}`);
  assertCondition(result?.deathRespawnEvidence?.complete === true,
    "native death-respawn sequence evidence is incomplete");
  assertCondition(result?.deathRespawnEvidence?.checkpoint?.retainedAfterTeardown === true,
    "native death-respawn result did not prove its Save & Quit checkpoint after runtime teardown");
  assertCondition(result?.deathRespawnEvidence?.parent?.generatedDropCount === 1
    && result?.deathRespawnEvidence?.child?.stack?.itemCode === R5_NATIVE_STARTER_BERRY_ITEM_CODE
    && result?.deathRespawnEvidence?.child?.stack?.count === R5_NATIVE_STARTER_BERRY_COUNT,
  "native death-respawn result did not retain the exact Berry x3 death child");
  for (const key of [
    "lethalNativeDrowning",
    "exactlyOneProjectedDeath",
    "automaticNativeRespawnAtFrozenSpawn",
    "neutralInputAfterDeath",
    "exactBwe7CheckpointProjectionAndAck",
    "slotZeroCleared",
    "exactBerryDeathDrop",
    "saveQuitReloadContinueRestoration",
    "noDeathReplayAfterReload",
  ]) {
    assertCondition(result?.coverage?.[key] === "passed", `native death-respawn coverage '${key}' did not pass`);
  }
  assertCondition(result?.coverage?.deathDropPickup === "not-exercised-not-claimed",
    "native death-respawn result overclaims death-drop pickup coverage");
  assertR5BrowserErrorStreams({
    routeErrors: result?.routeErrors,
    consoleErrors: result?.consoleErrors,
    pageErrors: result?.pageErrors,
    runtimeErrors: result?.runtimeErrors,
  });
  assertCondition(r5CleanupGatePassed(result?.cleanup),
    "native death-respawn browser/server/profile/mutex/source cleanup gate failed");
  return true;
}

function relativeEvidencePath(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
}

function contentType(filePath) {
  if (filePath.endsWith(".d.ts")) return "text/plain; charset=utf-8";
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

export function assertR5ArtifactCurrentSource(artifact, currentSourceSnapshot) {
  const sourceSnapshot = artifact?.manifest?.sourceSnapshot;
  if (sourceSnapshot?.schema !== 1
    || !ARTIFACT_HASH_PATTERN.test(sourceSnapshot.digest ?? "")
    || !Number.isSafeInteger(sourceSnapshot.fileCount)
    || sourceSnapshot.fileCount <= 0) {
    fail("Candidate engine artifact has incomplete sourceSnapshot provenance.");
  }
  if (sourceSnapshot.digest !== currentSourceSnapshot?.digest
    || sourceSnapshot.fileCount !== currentSourceSnapshot?.fileCount) {
    fail(`Candidate engine artifact is not current-source: artifact ${sourceSnapshot.digest}/${sourceSnapshot.fileCount}, current ${String(currentSourceSnapshot?.digest)}/${String(currentSourceSnapshot?.fileCount)}.`);
  }
  return currentSourceSnapshot;
}

export function prepareCandidateRoute(repositoryRoot, engineDirectory, expectedArtifactHash) {
  if (!engineDirectory) {
    fail("--engine-dir is required for the isolated R5 current-source candidate gate.");
  }
  const verification = validatePublishedArtifacts(engineDirectory);
  const variant = verification.index.defaultVariant;
  if (variant !== "compatibility") {
    fail(`Candidate engine index must select the compatibility variant, received ${String(variant)}.`);
  }
  const artifact = verification.artifacts.find((entry) => entry.variant === variant);
  if (!artifact) fail(`Candidate engine index default variant ${String(variant)} is unavailable.`);
  if (artifact.hash !== expectedArtifactHash) {
    fail(`Candidate engine artifact ${artifact.hash} does not match --expected-artifact-hash ${expectedArtifactHash}.`);
  }
  const sourceSnapshot = assertR5ArtifactCurrentSource(
    artifact,
    createRustEngineSourceSnapshot(repositoryRoot),
  );
  const allowedFiles = new Set(["manifest.json", ...artifact.files.map((file) => file.path)]);
  return Object.freeze({
    repositoryRoot: realpathSync(repositoryRoot),
    verification,
    artifact,
    sourceSnapshot,
    allowedFiles,
  });
}

export function assertR5CandidateSourceUnchanged(candidate) {
  if (!candidate) fail("R5 current-source acceptance has no isolated candidate selection.");
  const currentSourceSnapshot = createRustEngineSourceSnapshot(candidate.repositoryRoot);
  if (currentSourceSnapshot.digest !== candidate.sourceSnapshot.digest
    || currentSourceSnapshot.fileCount !== candidate.sourceSnapshot.fileCount) {
    fail(`Rust engine source changed during R5 browser acceptance: before ${candidate.sourceSnapshot.digest}/${candidate.sourceSnapshot.fileCount}, after ${currentSourceSnapshot.digest}/${currentSourceSnapshot.fileCount}.`);
  }
  return currentSourceSnapshot;
}

export function recordR5TerminalSourceCleanup(candidate, cleanup, runtimeErrors) {
  try {
    const sourceSnapshot = assertR5CandidateSourceUnchanged(candidate);
    cleanup.sourceUnchanged = true;
    return sourceSnapshot;
  } catch (error) {
    cleanup.sourceUnchanged = false;
    runtimeErrors.push(`terminal source cleanup: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function r5CleanupGatePassed(cleanup) {
  return cleanup.browserClosed === true
    && cleanup.serverStopped === true
    && cleanup.profileRemoved === true
    && cleanup.browserMutexReleased === true
    && cleanup.sourceUnchanged === true;
}

async function installCandidateRoute(context, candidate, requests, errors) {
  if (!candidate) return;
  await context.route("**/engine/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const relativeUrl = decodeURIComponent(requestUrl.pathname).replace(/^\/engine\/?/u, "");
    let target;
    if (relativeUrl === "manifest.json") target = path.join(candidate.verification.root, "manifest.json");
    else {
      const [artifactHash, ...fileParts] = relativeUrl.split("/");
      const relativeFile = fileParts.join("/");
      if (artifactHash !== candidate.artifact.hash || !candidate.allowedFiles.has(relativeFile)) {
        errors.push(`candidate route rejected ${requestUrl.pathname}`);
        requests.push({ url: requestUrl.href, status: 404, source: "candidate-route" });
        await route.fulfill({ status: 404, contentType: "text/plain; charset=utf-8", body: "Candidate artifact path is not declared." });
        return;
      }
      target = path.resolve(candidate.artifact.directory, ...relativeFile.split("/"));
      const relation = path.relative(candidate.artifact.directory, target);
      if (!relation || relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
        errors.push(`candidate route escaped artifact root: ${requestUrl.pathname}`);
        requests.push({ url: requestUrl.href, status: 403, source: "candidate-route" });
        await route.fulfill({ status: 403, contentType: "text/plain; charset=utf-8", body: "Forbidden." });
        return;
      }
    }
    requests.push({ url: requestUrl.href, status: 200, source: "candidate-route" });
    await route.fulfill({
      status: 200,
      contentType: contentType(target),
      headers: { "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" },
      body: readFileSync(target),
    });
  });
}

async function installManagedCanonicalAssetRoutes(context, repositoryRoot, requests) {
  for (const requestUrl of MANAGED_CANONICAL_ASSETS.keys()) {
    const asset = resolveManagedCanonicalAsset(repositoryRoot, requestUrl);
    await context.route(requestUrl, async (route) => {
      // Registration and lookup are both exact URL matches. A query, alternate
      // host, port, scheme, or neighboring public file is deliberately outside
      // this managed-local exception and remains ordinary network traffic.
      const requestedAsset = resolveManagedCanonicalAsset(repositoryRoot, route.request().url());
      if (!requestedAsset || requestedAsset.filePath !== asset.filePath) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: requestedAsset.contentType,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
        body: readFileSync(requestedAsset.filePath),
      });
      requests.push(Object.freeze({
        url: requestedAsset.requestUrl,
        path: requestedAsset.relativeAssetPath,
        status: 200,
        source: "managed-canonical-asset-route",
      }));
    });
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
      const loadedModule = await import(path.isAbsolute(candidate) ? pathToFileURL(candidate).href : candidate);
      if (loadedModule.chromium) return Object.freeze({ module: loadedModule, source: candidate });
      failures.push(`${candidate}: no chromium export`);
    } catch (error) { failures.push(`${candidate}: ${error.code ?? error.message}`); }
  }
  fail("A local Playwright runtime is required. This verifier never downloads a package or browser.", { failures });
}

function discoverBrowserExecutable(explicitPath) {
  if (explicitPath) {
    if (!existsSync(explicitPath) || !statSync(explicitPath).isFile()) fail(`Browser executable does not exist: ${explicitPath}`);
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

async function reserveLoopbackPort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") fail("Managed Vite server could not reserve a loopback port.");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

export function r5ManagedViteInlineConfig(repositoryRoot, port) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    fail("Managed Vite repository root must be a non-empty path.");
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    fail(`Managed Vite port must be an integer from 1 through 65535, received ${String(port)}`);
  }
  const canonicalRoot = realpathSync(repositoryRoot);
  const configFile = path.join(canonicalRoot, "vite.config.ts");
  if (!existsSync(configFile) || !statSync(configFile).isFile()) {
    fail(`Managed Vite server requires the repository config: ${configFile}`);
  }
  return {
    root: canonicalRoot,
    configFile,
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      // The acceptance source must not change underneath a running candidate.
      // Native HMR-off prevents update broadcasts. Vite's config merge drops null,
      // so an ignore-all predicate is the merge-stable way to suppress watch events.
      hmr: false,
      watch: {
        ignored: () => true,
      },
    },
  };
}

async function runManagedViteChild(repositoryRoot, rawPort) {
  const port = Number(rawPort);
  const inlineConfig = r5ManagedViteInlineConfig(repositoryRoot, port);
  const viteModule = path.join(inlineConfig.root, "node_modules", "vite", "dist", "node", "index.js");
  if (!existsSync(viteModule)) fail(`Managed server requires the installed Vite module: ${viteModule}`);
  const { createServer } = await import(pathToFileURL(viteModule).href);
  const server = await createServer(inlineConfig);
  const ignored = server.config.server.watch?.ignored;
  const ignoresManagedSource = typeof ignored === "function"
    && ignored(path.join(inlineConfig.root, "app", "page.tsx")) === true
    && ignored(inlineConfig.configFile) === true;
  if (server.config.server.hmr !== false || !ignoresManagedSource) {
    await server.close();
    fail(`Managed Vite server did not retain the required HMR-off, ignore-all configuration (hmr=${String(server.config.server.hmr)}, ignored=${typeof ignored}).`);
  }
  await server.listen();
  process.stdout.write(`${JSON.stringify({
    type: "blockwild-r5-managed-vite-ready-v1",
    port,
    hmr: false,
    watch: "ignore-all",
  })}\n`);
}

async function startManagedViteServer(repositoryRoot, timeoutMilliseconds, onSpawn = () => {}) {
  const port = await reserveLoopbackPort();
  const inlineConfig = r5ManagedViteInlineConfig(repositoryRoot, port);
  const verifierEntry = fileURLToPath(import.meta.url);
  const logs = [];
  const child = spawn(process.execPath, [
    verifierEntry,
    INTERNAL_MANAGED_VITE_COMMAND,
    inlineConfig.root,
    String(port),
  ], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const attempt = {
    child,
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    logs,
    inlineConfig,
    stopped: false,
    stopDiagnostics: null,
  };
  onSpawn(attempt);
  const record = (chunk) => {
    logs.push(String(chunk));
    while (logs.join("").length > 64 * 1024) logs.shift();
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);
  const baseUrl = attempt.baseUrl;
  const deadline = Date.now() + Math.min(timeoutMilliseconds, 120_000);
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) fail(`Managed Vite server exited with code ${child.exitCode}.`, { logs: logs.join("") });
      try {
        const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) return Object.freeze(attempt);
      } catch { /* keep waiting for the owned server */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    fail(`Managed Vite server did not become ready within ${Math.min(timeoutMilliseconds, 120_000)} ms.`, { logs: logs.join("") });
  } catch (error) {
    attempt.stopDiagnostics = Object.create(null);
    attempt.stopped = await stopOwnedProcess(child, { diagnostics: attempt.stopDiagnostics });
    throw error;
  }
}

export function assertR5BrowserErrorStreams({
  routeErrors,
  consoleErrors,
  pageErrors,
  runtimeErrors,
}) {
  for (const [label, errors] of Object.entries({ routeErrors, consoleErrors, pageErrors, runtimeErrors })) {
    assertCondition(Array.isArray(errors), `${label} must be an array`);
  }
  assertCondition(routeErrors.length === 0, `Candidate artifact route errors: ${routeErrors.join(" | ")}`);
  assertCondition(consoleErrors.length === 0, `Browser emitted ${consoleErrors.length} console errors`);
  assertCondition(pageErrors.length === 0, `Browser emitted ${pageErrors.length} page errors`);
  assertCondition(runtimeErrors.length === 0, `Runtime emitted ${runtimeErrors.length} errors`);
  return true;
}

export function ownedChildExitObserved(child) {
  return (child?.exitCode !== null && child?.exitCode !== undefined)
    || (child?.signalCode !== null && child?.signalCode !== undefined);
}

export function exactProcessIsAlive(pid, signalProcess = process.kill) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    signalProcess(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

export function taskkillCommandSucceeded(result) {
  return result?.error === undefined && result?.status === 0;
}

async function waitForOwnedProcessExit(child, pid, {
  timeoutMilliseconds,
  pollMilliseconds,
  processAlive,
  sleep,
}) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (true) {
    if (ownedChildExitObserved(child) || !processAlive(pid)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(pollMilliseconds, Math.max(1, deadline - Date.now())));
  }
}

export async function stopOwnedProcess(child, options = {}) {
  if (!child) return true;
  const pid = child.pid;
  const platform = options.platform ?? process.platform;
  const processAlive = options.processAlive ?? exactProcessIsAlive;
  const runSync = options.spawnSync ?? spawnSync;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const normalWaitMilliseconds = options.normalWaitMilliseconds ?? 2_000;
  const forcedWaitMilliseconds = options.forcedWaitMilliseconds ?? 5_000;
  const pollMilliseconds = options.pollMilliseconds ?? 50;
  const diagnostics = options.diagnostics ?? Object.create(null);
  Object.assign(diagnostics, {
    pid: Number.isSafeInteger(pid) ? pid : null,
    normalTerminationRequested: false,
    exitedAfterNormalTermination: false,
    forcedTerminationRequested: false,
    forcedTerminationCommandSucceeded: null,
    forcedTerminationStatus: null,
    exitedAfterForcedTermination: false,
    exactPidAliveAfterStop: null,
  });
  try {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      diagnostics.invalidOwnedPid = true;
      fail(`Refusing to stop a process without an exact owned PID: ${String(pid)}`);
    }
    if (ownedChildExitObserved(child) || !processAlive(pid)) {
      diagnostics.exitedAfterNormalTermination = true;
      diagnostics.exactPidAliveAfterStop = false;
      return true;
    }

    try {
      diagnostics.normalTerminationRequested = true;
      diagnostics.normalTerminationSignalAccepted = child.kill("SIGTERM") !== false;
    } catch (error) {
      diagnostics.normalTerminationError = error instanceof Error ? error.message : String(error);
    }
    diagnostics.exitedAfterNormalTermination = await waitForOwnedProcessExit(child, pid, {
      timeoutMilliseconds: normalWaitMilliseconds,
      pollMilliseconds,
      processAlive,
      sleep,
    });

    if (!diagnostics.exitedAfterNormalTermination && !ownedChildExitObserved(child) && processAlive(pid)) {
      diagnostics.forcedTerminationRequested = true;
      if (platform === "win32") {
        let taskkillResult;
        try {
          taskkillResult = runSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            encoding: "utf8",
            windowsHide: true,
          });
          diagnostics.forcedTerminationStatus = taskkillResult.status;
          diagnostics.forcedTerminationSignal = taskkillResult.signal ?? null;
          diagnostics.forcedTerminationCommandSucceeded = taskkillCommandSucceeded(taskkillResult);
          if (taskkillResult.error) diagnostics.forcedTerminationError = taskkillResult.error.message;
          if (taskkillResult.stderr) diagnostics.forcedTerminationStderr = taskkillResult.stderr.trim().slice(-2_048);
        } catch (error) {
          diagnostics.forcedTerminationCommandSucceeded = false;
          diagnostics.forcedTerminationError = error instanceof Error ? error.message : String(error);
        }
      } else {
        try {
          diagnostics.forcedTerminationCommandSucceeded = child.kill("SIGKILL") !== false;
        } catch (error) {
          diagnostics.forcedTerminationCommandSucceeded = false;
          diagnostics.forcedTerminationError = error instanceof Error ? error.message : String(error);
        }
      }
      diagnostics.exitedAfterForcedTermination = await waitForOwnedProcessExit(child, pid, {
        timeoutMilliseconds: forcedWaitMilliseconds,
        pollMilliseconds,
        processAlive,
        sleep,
      });
    }

    const exactPidAliveAfterStop = ownedChildExitObserved(child) ? false : processAlive(pid);
    diagnostics.exactPidAliveAfterStop = exactPidAliveAfterStop;
    return !exactPidAliveAfterStop;
  } finally {
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
}

function removeOwnedProfile(profileDirectory) {
  const canonicalTemp = realpathSync(os.tmpdir());
  const resolved = path.resolve(profileDirectory);
  if (path.dirname(resolved) !== canonicalTemp || !path.basename(resolved).startsWith(PROFILE_PREFIX)) {
    fail(`Refusing to remove unowned browser profile: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return !existsSync(resolved);
}

function installGenerationCertificateCapture(context) {
  return context.addInitScript(() => {
    const NativeWorker = window.Worker;
    const certificates = [];
    Object.defineProperty(window, "__blockwildR5GenerationCertificates", {
      value: certificates,
      configurable: true,
    });
    const AuditedWorker = function (...args) {
      const worker = new NativeWorker(...args);
      worker.addEventListener("message", (event) => {
        const message = event.data;
        if (message?.type !== "terrain-generation-ready-v2" || !message.certificate) return;
        certificates.push(structuredClone(message.certificate));
      });
      return worker;
    };
    AuditedWorker.prototype = NativeWorker.prototype;
    Object.defineProperty(AuditedWorker, "name", { value: "Worker" });
    window.Worker = AuditedWorker;
  });
}

export async function runR5PlayerBrowser(argv = process.argv) {
  const options = parseR5BrowserOptions(argv);
  if (options.help) return Object.freeze({ help: true, usage: usage() });
  mkdirSync(options.outputDirectory, { recursive: true });
  resolveWorkOutputDirectory(options.repositoryRoot, options.outputDirectory);

  const candidate = prepareCandidateRoute(
    options.repositoryRoot,
    options.engineDirectory,
    options.expectedArtifactHash,
  );
  const playwright = await loadPlaywright(options.playwrightModule);
  const browserExecutable = discoverBrowserExecutable(options.browserExecutable);
  const profileDirectory = mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const screenshots = Object.create(null);
  const consoleErrors = [];
  const pageErrors = [];
  const runtimeErrors = [];
  const routeErrors = [];
  const artifactRequests = [];
  const canonicalAssetRequests = [];
  const movementEvidence = { walk: [], sprint: [], summary: Object.create(null) };
  const jumpEvidence = { baseY: null, samples: [], summary: null };
  const persistenceEvidence = {
    samples: [],
    preSaveTerminalPair: null,
    pausedTerminal: null,
    checkpointLineage: null,
    saveAndQuitCompleted: false,
    restored: null,
  };
  let movementEvidenceOrdinal = 0;
  let jumpEvidenceOrdinal = 0;
  let persistenceEvidenceOrdinal = 0;
  const authorityCursors = new Map();
  const cleanup = {
    browserStarted: false,
    browserClosed: true,
    serverStarted: false,
    serverStopped: true,
    profileRemoved: false,
    browserMutexReleased: true,
    sourceUnchanged: false,
  };
  let browserMutex = null;
  let browserMutexEvidence = null;
  let managedServer = null;
  let managedServerAttempt = null;
  let context = null;
  let page = null;
  let result = null;
  let lastSnapshot = null;

  const recordRuntimeErrors = (snapshot, label, { authorityCheckpoint = false } = {}) => {
    for (const error of collectR5RuntimeErrors(snapshot?.state, snapshot?.runtime, { authorityCheckpoint })) {
      const rendered = `${label}: ${error}`;
      if (!runtimeErrors.includes(rendered)) runtimeErrors.push(rendered);
    }
  };

  try {
    try {
      browserMutex = await acquireManagedBrowserGateMutex(options.repositoryRoot);
      browserMutexEvidence = browserMutex.evidence;
      cleanup.browserMutexReleased = false;
    } catch (error) {
      browserMutexEvidence = error?.browserGateMutex ?? null;
      throw error;
    }
    if (!options.baseUrl) {
      managedServer = await startManagedViteServer(
        options.repositoryRoot,
        options.timeoutMilliseconds,
        (attempt) => {
          managedServerAttempt = attempt;
          cleanup.serverStarted = true;
          cleanup.serverStopped = false;
        },
      );
    }
    const baseUrl = options.baseUrl ?? managedServer.baseUrl;
    context = await playwright.module.chromium.launchPersistentContext(profileDirectory, {
      headless: options.headless,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      viewport: { width: 1280, height: 720 },
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
    });
    cleanup.browserStarted = true;
    cleanup.browserClosed = false;
    await context.addInitScript(() => {
      localStorage.setItem("blockwild-settings-v2", JSON.stringify({
        renderDistance: 2,
        simulationDistance: 2,
        basicRenderDistance: 2,
        rememberedBasicRenderDistance: 2,
        resourceMode: "cpu",
      }));
    });
    await installGenerationCertificateCapture(context);
    await installCandidateRoute(context, candidate, artifactRequests, routeErrors);
    if (managedServer) {
      await installManagedCanonicalAssetRoutes(context, options.repositoryRoot, canonicalAssetRequests);
    }
    page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(Math.min(options.timeoutMilliseconds, 45_000));

    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location();
      consoleErrors.push(Object.freeze({
        text: message.text(),
        url: location?.url ?? null,
        lineNumber: Number.isFinite(location?.lineNumber) ? location.lineNumber : null,
        columnNumber: Number.isFinite(location?.columnNumber) ? location.columnNumber : null,
      }));
    });
    page.on("pageerror", (error) => pageErrors.push(Object.freeze({
      name: error?.name ?? null,
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    })));
    page.on("response", (response) => {
      if (!/\/engine\//u.test(new URL(response.url()).pathname)) return;
      if (!candidate) artifactRequests.push(Object.freeze({ url: response.url(), status: response.status(), source: "network" }));
    });

    const readSnapshot = async () => page.evaluate(() => {
      const parse = (name) => {
        try {
          const render = window[name];
          return typeof render === "function" ? JSON.parse(render()) : null;
        } catch { return null; }
      };
      return {
        state: parse("render_game_to_text"),
        runtime: parse("render_rust_runtime_to_text"),
        generationCertificates: structuredClone(window.__blockwildR5GenerationCertificates ?? []),
      };
    });

    const assertAuthoritySnapshot = (label, snapshot, { requirePlaying = true } = {}) => {
      lastSnapshot = snapshot;
      recordRuntimeErrors(snapshot, label, { authorityCheckpoint: true });
      const playingShape = requirePlaying ? snapshot : { ...snapshot, state: { ...snapshot.state, state: "playing" } };
      assertR5AuthorityDiagnostics(playingShape, options.expectedArtifactHash, label);
      assertCondition(snapshot.runtime?.activeWorldId, `${label}: active Rust world is absent`);
      assertCondition(snapshot.runtime?.nativePersistenceWorldId === snapshot.runtime?.activeWorldId,
        `${label}: native persistence is not bound to the active catalog world`);
      const pump = snapshot.runtime.playerAuthority.pump;
      const cursorKey = `${snapshot.runtime.activeWorldId}:${snapshot.runtime.transitionGeneration}`;
      const prior = authorityCursors.get(cursorKey);
      if (prior) {
        assertCondition(pump.lastAuthorityTick >= prior.tick, `${label}: authority tick regressed`);
        assertCondition(pump.nextInputSequence >= prior.input, `${label}: input sequence regressed`);
        assertCondition(pump.nextActionSequence >= prior.action, `${label}: action sequence regressed`);
      }
      authorityCursors.set(cursorKey, Object.freeze({
        tick: pump.lastAuthorityTick,
        input: pump.nextInputSequence,
        action: pump.nextActionSequence,
      }));
      return snapshot;
    };

    const assertAuthority = async (label, options = {}) => (
      assertAuthoritySnapshot(label, await readSnapshot(), options)
    );

    const recordMovementEvidence = (lane, phase, snapshot) => {
      const sample = r5MovementSampleEvidence(snapshot);
      const entry = Object.freeze({ ordinal: movementEvidenceOrdinal, phase, ...sample });
      movementEvidenceOrdinal += 1;
      const samples = movementEvidence[lane];
      samples.push(entry);
      if (samples.length > 96) samples.shift();
      return entry;
    };

    const recordJumpEvidence = (phase, snapshot) => {
      const sample = r5JumpTrajectorySample(snapshot, { phase, ordinal: jumpEvidenceOrdinal });
      jumpEvidenceOrdinal += 1;
      jumpEvidence.samples.push(sample);
      // Retain the complete bounded jump window even on a slow renderer. The
      // managed gate can sample hundreds of times during its 45-second
      // timeout, and evicting the takeoff made the terminal diagnostic erase
      // the very evidence that had already passed.
      if (jumpEvidence.samples.length > 512) jumpEvidence.samples.shift();
      if (jumpEvidence.baseY !== null) {
        jumpEvidence.summary = summarizeR5JumpTrajectory(jumpEvidence.baseY, jumpEvidence.samples);
      }
      return sample;
    };

    const advanceAuthority = async (milliseconds = 50) => {
      await page.evaluate(async (elapsedMilliseconds) => {
        if (typeof window.advanceTime !== "function") throw new Error("window.advanceTime is unavailable");
        await window.advanceTime(elapsedMilliseconds);
      }, milliseconds);
      await page.waitForTimeout(35);
    };

    const awaitAuthority = async (label, predicate, timeoutMilliseconds = 45_000, observe = null) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let snapshot = null;
      while (Date.now() < deadline) {
        await advanceAuthority();
        snapshot = await assertAuthority(label);
        if (observe) observe(snapshot);
        if (predicate(snapshot)) return snapshot;
      }
      throw new Error(`${label}: authority condition timed out: ${JSON.stringify({
        player: snapshot?.state?.player ?? null,
        pump: snapshot?.runtime?.playerAuthority?.pump ?? null,
      })}`);
    };

    const awaitEnvironmentalAuthority = async (
      label,
      predicate,
      timeoutMilliseconds = 45_000,
      advanceMilliseconds = 50,
    ) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let snapshot = null;
      let shouldAdvance = true;
      while (Date.now() < deadline) {
        if (shouldAdvance) await advanceAuthority(advanceMilliseconds);
        else await page.waitForTimeout(5);
        snapshot = await assertAuthority(label);
        if (!r5NativeSurvivalProjectionSettled(snapshot)) {
          // Do not enqueue another fixed step while its public extraction is
          // still behind the pump. This is crucial at the first drowning edge:
          // acting on a stale hit can otherwise queue a second hit before the
          // Shift release and ascent keys reach native input.
          shouldAdvance = false;
          continue;
        }
        const sample = r5NativeSurvivalEnvironmentSample(snapshot, { phase: label, ordinal: 0 });
        if (predicate(snapshot, sample)) return snapshot;
        shouldAdvance = true;
      }
      throw new Error(`${label}: settled environmental authority condition timed out: ${JSON.stringify({
        player: snapshot?.state?.player ?? null,
        environment: snapshot?.runtime?.playerAuthority?.environmentalSurvival ?? null,
        pump: snapshot?.runtime?.playerAuthority?.pump ?? null,
      })}`);
    };

    const awaitSteadyMovementPair = async (lane, expectedSprinting, timeoutMilliseconds = 45_000) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let previousEvidence = null;
      let previousSnapshot = null;
      let shouldAdvance = true;
      while (Date.now() < deadline) {
        if (shouldAdvance) await advanceAuthority();
        const snapshot = await readSnapshot();
        lastSnapshot = snapshot;
        recordRuntimeErrors(snapshot, `${lane}-movement-observation`);
        const evidence = recordMovementEvidence(lane, shouldAdvance ? "after-explicit-advance" : "settlement-poll", snapshot);
        if (!evidence.presentationSettled) {
          shouldAdvance = false;
          await page.waitForTimeout(15);
          continue;
        }
        assertAuthoritySnapshot(`${lane}-steady-authority`, snapshot);
        if (previousEvidence && previousSnapshot
          && r5SteadyMovementPair(previousEvidence, evidence, expectedSprinting)) {
          return Object.freeze({
            start: previousSnapshot,
            end: snapshot,
            startEvidence: previousEvidence,
            endEvidence: evidence,
          });
        }
        if (movementEvidenceMatchesMode(evidence, expectedSprinting)
          && r5HorizontalMovementEngaged(snapshot, expectedSprinting)) {
          previousEvidence = evidence;
          previousSnapshot = snapshot;
        } else {
          previousEvidence = null;
          previousSnapshot = null;
        }
        shouldAdvance = true;
      }
      throw new Error(`${lane}: no exact steady authoritative movement pair was observed: ${JSON.stringify(
        movementEvidence[lane].slice(-12),
      )}`);
    };

    const awaitTickDelta = async (
      label,
      baseline,
      minimumTicks,
      predicate = () => true,
      timeoutMilliseconds = 45_000,
      observe = null,
    ) => {
      const startTick = baseline.runtime.playerAuthority.pump.lastAuthorityTick;
      return awaitAuthority(label, (snapshot) => (
        snapshot.runtime.playerAuthority.pump.lastAuthorityTick - startTick >= minimumTicks && predicate(snapshot)
      ), timeoutMilliseconds, observe);
    };

    const heldKeys = new Set();
    const keyDown = async (key) => {
      if (heldKeys.has(key)) return;
      await page.keyboard.down(key);
      heldKeys.add(key);
    };
    const keyUp = async (key) => {
      if (!heldKeys.has(key)) return;
      await page.keyboard.up(key);
      heldKeys.delete(key);
    };
    const releaseAllKeys = async () => {
      for (const key of [...heldKeys].reverse()) await keyUp(key).catch(() => {});
    };

    const awaitButton = async (label, button, down, baseline, observe = null) => {
      const start = baseline ?? await assertAuthority(`${label}-baseline`);
      return awaitTickDelta(label, start, 1, (snapshot) => (
        Boolean(snapshot.runtime.playerAuthority.pump.lastAppliedButtons & button) === down
      ), 45_000, observe);
    };

    const waitForHarness = async () => {
      await page.waitForFunction(() => (
        typeof window.render_game_to_text === "function"
        && typeof window.render_rust_runtime_to_text === "function"
        && typeof window.advanceTime === "function"
      ), undefined, { timeout: Math.min(options.timeoutMilliseconds, 120_000) });
    };

    const awaitGameplay = async (label) => {
      const deadline = Date.now() + options.timeoutMilliseconds;
      let debug = null;
      while (Date.now() < deadline) {
        await page.waitForTimeout(400);
        const snapshot = await readSnapshot();
        const ui = await page.evaluate(() => ({
          alerts: [...document.querySelectorAll('[role="alert"]')]
            .map((element) => element.textContent?.trim() ?? "")
            .filter(Boolean),
          transitionPending: document.body.innerText.includes("Starting Rust Runtime"),
          newWorldFormVisible: document.body.innerText.includes("Create a New World"),
        }));
        debug = { snapshot, ui };
        lastSnapshot = snapshot;
        recordRuntimeErrors(snapshot, label);
        const fatal = ui.alerts.find((text) => (
          /Required Rust|failed|error|mismatch|disagree|unavailable|timeout|could not|rejected|blocked|invalid/iu.test(text)
        ));
        if (fatal) throw new Error(`${label}: ${fatal}`);
        const generation = snapshot.state?.performance?.streaming?.generationWorker;
        if (snapshot.state?.state !== "playing" || ui.transitionPending || ui.newWorldFormVisible
          || snapshot.runtime?.ready !== true || snapshot.runtime?.manager?.state !== "ready"
          || snapshot.runtime?.manager?.host?.adapter?.liveAuthorityReady !== true
          || snapshot.runtime?.playerAuthority?.state !== "ready"
          || snapshot.runtime?.playerAuthority?.pump?.state !== "ready"
          || generation?.state !== "ready" || generation.ready !== generation.workers
          || !Array.isArray(snapshot.generationCertificates) || snapshot.generationCertificates.length === 0) continue;
        return assertAuthority(label);
      }
      throw new Error(`${label}: gameplay did not become ready: ${JSON.stringify(debug)}`);
    };

    const awaitImmediateRing = async (label, timeoutMilliseconds = 120_000) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let snapshot = null;
      while (Date.now() < deadline) {
        await page.waitForTimeout(400);
        snapshot = await readSnapshot();
        lastSnapshot = snapshot;
        recordRuntimeErrors(snapshot, label);
        const ring = snapshot.state?.performance?.streaming?.immediateRing;
        if (snapshot.state?.state === "playing" && ring?.desired === 9 && ring.ready === 9) {
          await assertAuthority(`${label}-9-of-9`);
          return Object.freeze({ snapshot, ring: Object.freeze({ ...ring }) });
        }
      }
      throw new Error(`${label}: exact 9/9 immediate ring did not become ready: ${JSON.stringify(
        snapshot?.state?.performance?.streaming?.immediateRing ?? null,
      )}`);
    };

    const capture = async (name) => {
      const filePath = path.join(options.outputDirectory, `${name}.png`);
      await page.screenshot({ path: filePath, type: "png" });
      screenshots[name] = relativeEvidencePath(options.repositoryRoot, filePath);
      return screenshots[name];
    };

    const positionOf = (snapshot, label) => {
      const position = snapshot?.state?.player?.position;
      assertCondition(Array.isArray(position) && position.length === 3, `${label}: player position is absent`);
      return position.map((value, index) => finite(value, `${label}[${index}]`));
    };
    const velocityOf = (snapshot, label) => {
      const velocity = snapshot?.state?.player?.velocity;
      assertCondition(Array.isArray(velocity) && velocity.length === 3, `${label}: player velocity is absent`);
      return velocity.map((value, index) => finite(value, `${label}[${index}]`));
    };
    const horizontalDistance = (left, right) => {
      const a = positionOf(left, "horizontal start");
      const b = positionOf(right, "horizontal end");
      return Math.hypot(b[0] - a[0], b[2] - a[2]);
    };

    const settleVertical = async (label, timeoutMilliseconds = 45_000) => {
      await assertAuthority(`${label}-start`);
      let priorY = positionOf(lastSnapshot, `${label}-start`)[1];
      let stableSamples = 0;
      return awaitAuthority(label, (snapshot) => {
        const y = positionOf(snapshot, label)[1];
        const vy = velocityOf(snapshot, label)[1];
        if (Math.abs(y - priorY) <= 0.03 && Math.abs(vy) <= 0.08) stableSamples += 1;
        else stableSamples = 0;
        priorY = y;
        return stableSamples >= 3;
      }, timeoutMilliseconds);
    };

    const awaitJumpCompletion = async (timeoutMilliseconds = 45_000) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let snapshot = lastSnapshot;
      while (Date.now() < deadline) {
        const existing = jumpEvidence.baseY === null
          ? null
          : summarizeR5JumpTrajectory(jumpEvidence.baseY, jumpEvidence.samples);
        if (existing?.complete) {
          jumpEvidence.summary = assertR5JumpTrajectoryEvidence(existing);
          return Object.freeze({ snapshot, evidence: jumpEvidence.summary });
        }
        await advanceAuthority();
        snapshot = await assertAuthority("jump-trajectory");
        recordJumpEvidence("post-release-trajectory", snapshot);
      }
      const summary = jumpEvidence.baseY === null
        ? null
        : summarizeR5JumpTrajectory(jumpEvidence.baseY, jumpEvidence.samples);
      jumpEvidence.summary = summary;
      throw new Error(`jump-trajectory: takeoff, height, descent, and stable landing were not all observed: ${JSON.stringify({
        baseY: summary?.baseY ?? null,
        peakRise: summary?.peakRise ?? null,
        takeoff: summary?.takeoff ?? null,
        descending: summary?.descending ?? null,
        landingSamples: summary?.landingSamples ?? [],
        recentSamples: summary?.samples?.slice(-12) ?? [],
      })}`);
    };

    const recordPersistenceEvidence = (phase, snapshot) => {
      const evidence = r5PersistencePoseEvidence(snapshot);
      const entry = Object.freeze({ ordinal: persistenceEvidenceOrdinal, phase, ...evidence });
      persistenceEvidenceOrdinal += 1;
      persistenceEvidence.samples.push(entry);
      if (persistenceEvidence.samples.length > 96) persistenceEvidence.samples.shift();
      return entry;
    };

    const awaitPreSaveTerminalPair = async (label, timeoutMilliseconds = 45_000) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let previousEvidence = null;
      let previousSnapshot = null;
      let shouldAdvance = true;
      while (Date.now() < deadline) {
        if (shouldAdvance) await advanceAuthority();
        else await page.waitForTimeout(15);
        const snapshot = await readSnapshot();
        lastSnapshot = snapshot;
        recordRuntimeErrors(snapshot, label);
        const evidence = recordPersistenceEvidence(
          shouldAdvance ? "pre-save-after-explicit-advance" : "pre-save-drain-poll",
          snapshot,
        );
        if (!evidence.pumpDrained) {
          shouldAdvance = false;
          continue;
        }
        assertAuthoritySnapshot(label, snapshot);
        if (previousEvidence && previousSnapshot && r5TerminalPersistencePair(previousEvidence, evidence)) {
          const pair = Object.freeze({
            start: previousSnapshot,
            end: snapshot,
            startEvidence: previousEvidence,
            endEvidence: evidence,
          });
          persistenceEvidence.preSaveTerminalPair = Object.freeze({
            start: previousEvidence,
            end: evidence,
          });
          return pair;
        }
        if (evidence.terminal) {
          previousEvidence = evidence;
          previousSnapshot = snapshot;
        } else {
          previousEvidence = null;
          previousSnapshot = null;
        }
        shouldAdvance = true;
      }
      throw new Error(`${label}: no two exact, zero-velocity, pump-drained authoritative poses were observed: ${JSON.stringify(
        persistenceEvidence.samples.slice(-12),
      )}`);
    };

    const awaitPausedTerminalPose = async (
      label,
      expectedPose,
      { requireNativeProjectionSettled = false, timeoutMilliseconds = 45_000 } = {},
    ) => {
      const deadline = Date.now() + timeoutMilliseconds;
      let evidence = null;
      while (Date.now() < deadline) {
        await page.waitForTimeout(25);
        const snapshot = await readSnapshot();
        lastSnapshot = snapshot;
        recordRuntimeErrors(snapshot, label);
        evidence = recordPersistenceEvidence("paused-terminal-drain-poll", snapshot);
        if (snapshot.state?.state !== "paused" || !evidence.terminal
          || requireNativeProjectionSettled && !r5NativeSurvivalProjectionSettled(snapshot)) continue;
        assertAuthoritySnapshot(label, snapshot, { requirePlaying: false });
        assertCondition(JSON.stringify(evidence.pose) === JSON.stringify(expectedPose),
          `pause changed the exact terminal authoritative pose: before=${JSON.stringify(expectedPose)} after=${JSON.stringify(evidence.pose)}`);
        persistenceEvidence.pausedTerminal = evidence;
        return snapshot;
      }
      throw new Error(`${label}: paused authority never reached a zero-velocity, pump-drained terminal checkpoint: ${JSON.stringify(evidence)}`);
    };

    const observeNativeSaveCheckpoint = async (beforeSaveSnapshot, timeoutMilliseconds = 120_000) => {
      const beforePersistence = beforeSaveSnapshot?.runtime?.manager?.host?.nativePersistence;
      assertCondition(beforePersistence?.state === "open", "pre-save native persistence session is not open");
      const deadline = Date.now() + timeoutMilliseconds;
      let observed = null;
      while (Date.now() < deadline) {
        await page.waitForTimeout(5);
        observed = await readSnapshot();
        lastSnapshot = observed;
        recordRuntimeErrors(observed, "native-save-checkpoint-observation");
        const retained = observed?.runtime?.lastCompletedSaveAndQuitNativeCheckpoint ?? null;
        const completedTeardown = observed?.state?.state === "title"
          && observed?.runtime?.operationsBlocked === true
          && observed?.runtime?.manager?.host === null;
        if (!completedTeardown || retained === null) continue;
        persistenceEvidence.checkpointLineage = Object.freeze({
          sampledBefore: beforePersistence,
          transactionBefore: retained?.persistence?.before ?? null,
          transactionAfter: retained?.persistence?.after ?? null,
        });
        r5NativeSurvivalCheckpointEvidence(beforeSaveSnapshot, observed);
        return observed;
      }
      throw new Error(`Save & Quit native checkpoint was not publicly observed after completed teardown: ${JSON.stringify({
        beforePersistence,
        state: observed?.state?.state ?? null,
        operationsBlocked: observed?.runtime?.operationsBlocked ?? null,
        managerHostPresent: observed?.runtime?.manager?.host != null,
        persistence: observed?.runtime?.manager?.host?.nativePersistence ?? null,
        retainedCheckpoint: observed?.runtime?.lastCompletedSaveAndQuitNativeCheckpoint ?? null,
      })}`);
    };

    const gameUrl = new URL("/", `${baseUrl}/`);
    gameUrl.searchParams.set("experimental.rust-live-player-authority", "r5");
    await page.goto(gameUrl.href, { waitUntil: "domcontentloaded", timeout: Math.min(options.timeoutMilliseconds, 120_000) });
    await waitForHarness();
    assertCondition(new URL(page.url()).searchParams.get("experimental.rust-live-player-authority") === "r5",
      "Loaded route lost the explicit R5 integration selector");
    await page.getByRole("button", { name: /Create New World/u }).click();
    await page.getByRole("heading", { name: "Create a New World" }).waitFor();
    const worldFixture = options.scenario === "movement-persistence"
      ? WORLD_FIXTURE
      : R5_NATIVE_SURVIVAL_WORLD_FIXTURE;
    await page.getByLabel("World name").fill(worldFixture.name);
    await page.getByLabel("World seed").fill(worldFixture.seed);
    await page.getByRole("button", { name: /^SURVIVAL/u }).click();
    await page.getByRole("button", { name: "Generate World" }).click({ noWaitAfter: true });

    await awaitGameplay("create");
    const createdRing = await awaitImmediateRing("create");
    const created = await assertAuthority("create-ready");
    const createdPosition = positionOf(created, "created position");
    assertCondition(created.state.world?.seed === worldFixture.seed, "Fresh create changed the requested seed");
    assertCondition(created.state.player?.mode === worldFixture.mode, "Fresh create changed the requested mode");
    assertCondition(createdPosition.every((value, index) => Math.abs(value - worldFixture.expectedSpawn[index]) <= 0.01),
      `Fresh create spawned outside the frozen fixture: ${createdPosition.join(",")}`);
    await capture("created-9-of-9");

    let movementScenario = null;
    let environmentSnapshots = null;
    let deathRespawnSnapshots = null;
    if (options.scenario === "native-survival-environment") {
      environmentSnapshots = Object.create(null);
      environmentSnapshots.dryBaseline = await awaitEnvironmentalAuthority("native-dry-baseline", (_snapshot, sample) => (
        !sample.r6.inLiquid && !sample.r6.headSubmerged
          && sample.r6.oxygenSeconds === sample.r6.maximumOxygenSeconds
          && sample.r6.health === sample.r6.maximumHealth
          && sample.r7.health === sample.r7.maxHealth
          && sample.projectedDamageEvents === 0
          && sample.projectedDeathEvents === 0
          && sample.r6.lastDamageTick === "0"
      ));
      const dry = r5NativeSurvivalEnvironmentSample(
        environmentSnapshots.dryBaseline,
        { phase: "dryBaseline", ordinal: 0 },
      );
      assertCondition(!dry.r6.inLiquid && !dry.r6.headSubmerged
        && dry.r6.oxygenSeconds === dry.r6.maximumOxygenSeconds,
      "RUST-SWIM-002 did not create a dry full-oxygen native player");

      await keyDown(R5_NATIVE_SURVIVAL_WORLD_FIXTURE.waterApproach);
      await awaitEnvironmentalAuthority("native-water-entry", (_snapshot, sample) => (
        sample.r6.inLiquid
      ), 90_000);
      await keyDown("Shift");
      environmentSnapshots.submergedEntry = await awaitEnvironmentalAuthority(
        "native-head-submerged",
        (_snapshot, sample) => sample.r6.inLiquid && sample.r6.headSubmerged,
        90_000,
      );
      await keyUp(R5_NATIVE_SURVIVAL_WORLD_FIXTURE.waterApproach);
      const submerged = r5NativeSurvivalEnvironmentSample(
        environmentSnapshots.submergedEntry,
        { phase: "submergedEntry", ordinal: 1 },
      );
      environmentSnapshots.oxygenDrained = await awaitEnvironmentalAuthority("native-oxygen-drain", (_snapshot, sample) => {
        return sample.r6.inLiquid && sample.r6.headSubmerged
          && sample.r6.oxygenSeconds <= submerged.r6.oxygenSeconds - 0.5
          && sample.r6.health === submerged.r6.health
          && sample.projectedDamageEvents === 0;
      }, 90_000);
      await capture("native-submerged-oxygen-drain");
      const drained = r5NativeSurvivalEnvironmentSample(
        environmentSnapshots.oxygenDrained,
        { phase: "oxygenDrained", ordinal: 2 },
      );
      environmentSnapshots.ascentWindow = await awaitEnvironmentalAuthority(
        "native-pre-hit-ascent-window",
        (_snapshot, sample) => sample.r6.inLiquid && sample.r6.headSubmerged
          && sample.r6.oxygenSeconds === 0
          && sample.r6.health === drained.r6.health
          && sample.projectedDamageEvents === 0
          && sample.projectedDeathEvents === 0
          && sample.r6.drowningAccumulator >= 0.8
          && sample.r6.drowningAccumulator <= 1,
        180_000,
      );

      // Begin ascent before the 1.5-second first-hit threshold. Every key is a
      // normal public control; the settled acknowledgement below proves the
      // native pump applied the Shift release and Ctrl+Space while the head was
      // still submerged and health remained pristine.
      await keyUp("Shift");
      await keyDown("Control");
      await keyDown("Space");
      environmentSnapshots.ascentArmed = await awaitEnvironmentalAuthority(
        "native-pre-hit-ascent-acknowledged",
        (snapshot, sample) => sample.r6.inLiquid && sample.r6.headSubmerged
          && sample.r6.oxygenSeconds === 0
          && sample.r6.health === drained.r6.health
          && sample.projectedDamageEvents === 0
          && sample.projectedDeathEvents === 0
          && sample.r6.drowningAccumulator < 1.5
          && snapshot.state?.player?.input?.jumpHeld === true
          && snapshot.state?.player?.crouching === false
          && snapshot.state?.player?.sprinting === true
          && (snapshot.runtime.playerAuthority.pump.lastAppliedButtons
            & (INPUT_BUTTON.jump | INPUT_BUTTON.sprint)) === (INPUT_BUTTON.jump | INPUT_BUTTON.sprint),
        45_000,
      );

      environmentSnapshots.damaged = await awaitEnvironmentalAuthority("native-first-drowning-damage", (snapshot, sample) => {
        return sample.r6.inLiquid && sample.r6.headSubmerged
          && sample.r6.oxygenSeconds === 0
          && sample.r6.health === drained.r6.health - 1
          && sample.projectedDamageEvents === 1
          && sample.projectedDeathEvents === 0
          && snapshot.state?.player?.input?.jumpHeld === true
          && snapshot.state?.player?.crouching === false
          && snapshot.state?.player?.sprinting === true
          && (snapshot.runtime.playerAuthority.pump.lastAppliedButtons
            & (INPUT_BUTTON.jump | INPUT_BUTTON.sprint)) === (INPUT_BUTTON.jump | INPUT_BUTTON.sprint);
      }, 180_000);

      // Move toward the real low bank immediately after the first hit instead
      // of spending the entire second-hit interval ascending in open water.
      await keyDown(R5_NATIVE_SURVIVAL_WORLD_FIXTURE.shoreReturn);
      const damaged = r5NativeSurvivalEnvironmentSample(
        environmentSnapshots.damaged,
        { phase: "damaged", ordinal: 3 },
      );
      environmentSnapshots.surfaced = await awaitEnvironmentalAuthority("native-surface-recovery", (_snapshot, sample) => {
        return !sample.r6.headSubmerged
          && sample.r6.oxygenSeconds > damaged.r6.oxygenSeconds
          && sample.r6.health === damaged.r6.health
          && sample.r6.lastDamageTick === damaged.r6.lastDamageTick
          && sample.r7.health === damaged.r7.health
          && sample.r7.maxHealth === damaged.r7.maxHealth
          && sample.r7.alive === damaged.r7.alive
          && exactDecimalCursor(
            sample.r7.combatDomainRevision,
            "native surface-recovery R7 combat-domain revision",
          ) > exactDecimalCursor(
            damaged.r7.combatDomainRevision,
            "native damaged R7 combat-domain revision",
          )
          && sample.projectedDamageEvents === damaged.projectedDamageEvents
          && sample.projectedDeathEvents === damaged.projectedDeathEvents;
      }, 45_000);
      const surfacedEnvironment = r5NativeSurvivalEnvironmentSample(
        environmentSnapshots.surfaced,
        { phase: "surfaced", ordinal: 4 },
      );
      const effectsAtSurface = newNativeEffectsSince(damaged, surfacedEnvironment, "native surface-recovery shore cue");
      const playerEffectsAtSurface = effectsAtSurface.filter((cue) => (
        cue.entityExternalId === damaged.effects.playerExternalId
      ));
      assertCondition(!playerEffectsAtSurface.some((cue) => cue.kind === "drown-damage" || cue.kind === "fall-damage"),
        "native damage effect occurred while reaching surface recovery");
      const shoreCueObservedAtSurface = playerEffectsAtSurface.some((cue) => cue.kind === "shore-exit");
      if (shoreCueObservedAtSurface) {
        r5NativeSurvivalShoreExitCueEvidence(environmentSnapshots.damaged, environmentSnapshots.surfaced);
        environmentSnapshots.shoreExitCue = environmentSnapshots.surfaced;
      } else {
        await capture("native-surface-recovery");
        environmentSnapshots.shoreExitCue = await awaitEnvironmentalAuthority("native-shore-exit-cue", (snapshot, sample) => {
          const newEffects = newNativeEffectsSince(damaged, sample, "native shore-exit wait");
          const linkedEffects = newEffects.filter((cue) => (
            cue.entityExternalId === damaged.effects.playerExternalId
          ));
          assertCondition(!linkedEffects.some((cue) => cue.kind === "drown-damage" || cue.kind === "fall-damage"),
            "native damage effect occurred while awaiting the shore-exit cue");
          if (!linkedEffects.some((cue) => cue.kind === "shore-exit")) return false;
          r5NativeSurvivalShoreExitCueEvidence(environmentSnapshots.damaged, snapshot);
          return sample.r6.health === damaged.r6.health
            && sample.r7.health === damaged.r7.health
            && sample.r6.lastDamageTick === damaged.r6.lastDamageTick
            && sample.projectedDamageEvents === damaged.projectedDamageEvents
            && sample.projectedDeathEvents === damaged.projectedDeathEvents;
        }, 90_000);
      }
      // BWAU retains the native ShoreExit event even when a single pump call
      // batches past its one-step contact bit. Release sprint at the first
      // public extraction containing that exact linked cue, but retain forward
      // swim through one durable Land event after the sole LiquidExit. Held
      // Space automatically jumps again on each grounded sample, so waiting to
      // observe a simultaneously grounded held-input pose can miss a successful
      // landing forever. The post-exit Land journal entry proves the bank was
      // reached before input release; the neutral sample below proves the final
      // stable pose without weakening the physical gate.
      await keyUp("Control");
      if (shoreCueObservedAtSurface) await capture("native-surface-recovery");
      environmentSnapshots.shoreExit = await awaitEnvironmentalAuthority("native-shore-exit", (snapshot, sample) => {
        const [shoreX, shoreY, shoreZ] = positionOf(snapshot, "native shore mantle position");
        const mantleBounds = R5_NATIVE_SURVIVAL_WORLD_FIXTURE.shoreMantleBounds;
        const handoff = r5NativeSurvivalShoreLandingJournal(damaged, sample, "native shore handoff wait");
        assertCondition(handoff.shoreExits.length === 1,
          "native shore handoff did not retain exactly one linked shore-exit cue");
        assertCondition(handoff.liquidExits.length <= 1,
          "native shore handoff emitted more than one linked liquid-exit cue");
        assertCondition(handoff.liquidEnters.length === 0,
          "native liquid re-entry occurred while awaiting the shore handoff");
        if (handoff.acceptedLiquidExit === null || handoff.postExitLandings.length === 0) return false;
        return !sample.r6.inLiquid && !sample.r6.headSubmerged
          && shoreX >= mantleBounds.minimumX && shoreX <= mantleBounds.maximumX
          && shoreY >= mantleBounds.minimumY
          && shoreZ >= mantleBounds.minimumZ && shoreZ <= mantleBounds.maximumZ
          && sample.r6.health === damaged.r6.health
          && sample.r7.health === damaged.r7.health
          && sample.r6.lastDamageTick === damaged.r6.lastDamageTick
          && sample.projectedDamageEvents === damaged.projectedDamageEvents
          && sample.projectedDeathEvents === damaged.projectedDeathEvents
          && snapshot.state?.player?.input?.jumpHeld === true
          && snapshot.state?.player?.input?.forwardHeld === true
          && snapshot.state?.player?.sprinting === false
          && snapshot.state?.player?.crouching === false
          && snapshot.runtime.playerAuthority.pump.lastAppliedMoveX === 0
          && snapshot.runtime.playerAuthority.pump.lastAppliedMoveZ === R5_NATIVE_INPUT_AXIS_MAX
          && snapshot.runtime.playerAuthority.pump.lastAppliedButtons === INPUT_BUTTON.jump;
      }, 45_000, 17);
      await keyUp(R5_NATIVE_SURVIVAL_WORLD_FIXTURE.shoreReturn);
      await keyUp("Space");
      environmentSnapshots.shoreSettled = await awaitEnvironmentalAuthority("native-shore-settled", (snapshot, sample) => {
        const velocity = velocityOf(snapshot, "native shore settlement");
        const [settledX, settledY, settledZ] = positionOf(snapshot, "native shore settlement position");
        const mantleBounds = R5_NATIVE_SURVIVAL_WORLD_FIXTURE.shoreMantleBounds;
        return !sample.r6.inLiquid && !sample.r6.headSubmerged
          && Boolean(sample.r6.contactFlags & R5_NATIVE_SURVIVAL_CONTACT.grounded)
          && settledX >= mantleBounds.minimumX && settledX <= mantleBounds.maximumX
          && settledY >= mantleBounds.minimumY && settledY <= mantleBounds.maximumY
          && settledZ >= mantleBounds.minimumZ && settledZ <= mantleBounds.maximumZ
          && sample.r6.health === damaged.r6.health
          && sample.r7.health === damaged.r7.health
          && sample.projectedDamageEvents === damaged.projectedDamageEvents
          && sample.projectedDeathEvents === damaged.projectedDeathEvents
          && snapshot.state?.player?.input?.jumpHeld === false
          && snapshot.state?.player?.input?.forwardHeld === false
          && snapshot.state?.player?.sprinting === false
          && snapshot.state?.player?.crouching === false
          && snapshot.runtime.playerAuthority.pump.lastAppliedMoveX === 0
          && snapshot.runtime.playerAuthority.pump.lastAppliedMoveZ === 0
          && snapshot.runtime.playerAuthority.pump.lastAppliedButtons === 0
          && Math.hypot(...velocity) <= 0.08;
      }, 45_000);
      await capture("native-dry-shore-settled");
    } else if (options.scenario === "native-survival-death-respawn") {
      deathRespawnSnapshots = Object.create(null);
      deathRespawnSnapshots.baseline = await awaitEnvironmentalAuthority(
        "native-death-dry-baseline",
        (_snapshot, sample) => !sample.r6.inLiquid && !sample.r6.headSubmerged
          && sample.r6.health === sample.r6.maximumHealth
          && sample.r6.oxygenSeconds === sample.r6.maximumOxygenSeconds
          && sample.projectedDamageEvents === 0 && sample.projectedDeathEvents === 0,
      );
      const deathBaseline = r5NativeSurvivalDeathRespawnSample(
        deathRespawnSnapshots.baseline,
        { phase: "death-live-baseline", ordinal: 0 },
      );
      assertCondition(deathRespawnSnapshots.baseline.state?.inventory?.selectedSlot === 0
        && deathRespawnSnapshots.baseline.state?.inventory?.held?.item === R5_NATIVE_STARTER_BERRY_ITEM_CODE
        && deathRespawnSnapshots.baseline.state?.inventory?.held?.count === R5_NATIVE_STARTER_BERRY_COUNT
        && deathBaseline.nativeInventory.selectedSlot === 0
        && deathBaseline.nativeInventory.held?.itemCode === R5_NATIVE_STARTER_BERRY_ITEM_CODE
        && deathBaseline.nativeInventory.held?.count === R5_NATIVE_STARTER_BERRY_COUNT,
      "RUST-SWIM-002 fresh Survival did not expose the native Berry x3 starter stack in slot zero");
      assertCondition(deathBaseline.respawn.latestDeathRespawn === null
        && deathBaseline.projection.cursor === 0 && deathBaseline.projection.lastReceiptHash === null,
      "RUST-SWIM-002 fresh Survival already retained a death/respawn parent or cursor");

      // Only normal public movement is used: walk south into the fixture water,
      // hold crouch to descend, release forward, and let native R6/R7 drowning
      // reach its lethal edge without synthetic damage or terrain mutation.
      await keyDown(R5_NATIVE_SURVIVAL_WORLD_FIXTURE.waterApproach);
      await awaitEnvironmentalAuthority("native-death-water-entry", (_snapshot, sample) => sample.r6.inLiquid, 90_000);
      await keyDown("Shift");
      const submergedForDeath = await awaitEnvironmentalAuthority(
        "native-death-head-submerged",
        (_snapshot, sample) => sample.r6.inLiquid && sample.r6.headSubmerged,
        90_000,
      );
      await keyUp(R5_NATIVE_SURVIVAL_WORLD_FIXTURE.waterApproach);
      deathRespawnSnapshots.lastAliveSubmerged = submergedForDeath;
      await capture("native-death-submerged");

      deathRespawnSnapshots.createdProjection = await awaitEnvironmentalAuthority(
        "native-lethal-drowning-respawn",
        (snapshot, sample) => {
          const nativeRespawn = snapshot.runtime?.playerAuthority?.nativeRespawn;
          if (sample.r7.alive && sample.r6.inLiquid && sample.r6.headSubmerged
            && nativeRespawn?.latestDeathRespawn === null
            && sample.projectedDeathEvents === 0) {
            deathRespawnSnapshots.lastAliveSubmerged = structuredClone(snapshot);
          }
          const projection = snapshot.runtime?.playerAuthority?.playerDeathRespawnProjection;
          const checkpoint = snapshot.runtime?.playerAuthority?.playerDeathRespawnCheckpoint;
          const finalize = snapshot.runtime?.playerAuthority?.playerDeathRespawnFinalize;
          const pump = snapshot.runtime?.playerAuthority?.pump;
          const parent = nativeRespawn?.latestDeathRespawn;
          return sample.r7.alive
            && sample.projectedDeathEvents === 1
            && nativeRespawn?.deathSequence !== null
            && nativeRespawn?.lastRespawnSequence === nativeRespawn?.deathSequence
            && parent?.generatedDropCount === 1
            && projection?.cursor === deathBaseline.projection.cursor + 1
            && projection?.lastReceiptHash === parent?.receiptHash
            && checkpoint?.receiptHash === parent?.receiptHash
            && finalize === null
            && snapshot.runtime.playerAuthority.playerRespawnPlanPending === false
            && pump?.deathRespawnCursor === projection.cursor
            && pump?.pendingDeathRespawnSequence === null
            && pump?.lastAcknowledgedDeathRespawnSequence === projection.cursor
            && pump?.lastAcknowledgedDeathRespawnReceiptHash === parent.receiptHash;
        },
        360_000,
      );
      await capture("native-death-respawn-created-drop");
      await keyUp("Shift");

      const stableDeadline = Date.now() + 120_000;
      let previousDropSample = null;
      let previousDropSnapshot = null;
      let shouldAdvanceDropMotion = true;
      while (Date.now() < stableDeadline) {
        if (shouldAdvanceDropMotion) await advanceAuthority();
        else await page.waitForTimeout(15);
        const snapshot = await assertAuthority("native-death-drop-settlement");
        if (!r5NativeSurvivalProjectionSettled(snapshot)) {
          shouldAdvanceDropMotion = false;
          continue;
        }
        shouldAdvanceDropMotion = true;
        const sample = r5NativeSurvivalDeathRespawnSample(snapshot, {
          phase: "native-death-drop-settlement",
          ordinal: 0,
        });
        if (sample.dropProjections.length !== 1
          || sample.respawn.latestDeathRespawn?.receiptHash
            !== deathRespawnSnapshots.createdProjection.runtime.playerAuthority.nativeRespawn.latestDeathRespawn.receiptHash
          || !sample.respawn.queuedInputsEmpty || !sample.respawn.pendingContextCommandsEmpty
          || !sample.respawn.pendingMovementResultEmpty || !sample.respawn.miningStateEmpty
          || snapshot.state?.player?.input?.jumpHeld !== false
          || snapshot.state?.player?.input?.forwardHeld !== false
          || snapshot.state?.player?.sprinting !== false
          || snapshot.state?.player?.crouching !== false
          || sample.pump.lastAppliedMoveX !== 0 || sample.pump.lastAppliedMoveZ !== 0
          || sample.pump.lastAppliedButtons !== 0
          || sample.pump.nativeInputPending !== false || sample.pump.pendingInputSequence !== null) {
          previousDropSample = null;
          previousDropSnapshot = null;
          continue;
        }
        const drop = sample.dropProjections[0];
        if (previousDropSample !== null && previousDropSnapshot !== null) {
          nativeDeathDropProjectionEvolves(previousDropSample, drop, "live death-drop playing evolution");
          deathRespawnSnapshots.dropSettledStart = previousDropSnapshot;
          deathRespawnSnapshots.respawned = snapshot;
          break;
        }
        previousDropSample = drop;
        previousDropSnapshot = snapshot;
      }
      assertCondition(deathRespawnSnapshots.dropSettledStart && deathRespawnSnapshots.respawned,
        "native Berry death drop did not expose two bounded consecutive playing-state transforms");
      await capture("native-death-respawn-drop-motion");
    } else {
      await assertAuthority("walk-baseline");
      await keyDown("d");
      // The pump publishes its new tick before the asynchronous extraction is
      // projected into render_game_to_text. Pair only quiescent projections from
      // distinct acknowledged inputs whose exact rounded horizontal velocity is
      // unchanged; position/tick arithmetic across an in-flight projection is
      // not one authority interval.
      const walkPair = await awaitSteadyMovementPair("walk", false);
      const walkStart = walkPair.start;
      const walkEnd = walkPair.end;
      const walkTicks = walkEnd.runtime.playerAuthority.pump.lastAuthorityTick
        - walkStart.runtime.playerAuthority.pump.lastAuthorityTick;
      const walkDistance = horizontalDistance(walkStart, walkEnd);
      const walkPerTick = walkDistance / walkTicks;
      assertCondition(walkPerTick > 0.04, `Walk displacement per acknowledged tick was only ${walkPerTick}`);
      assertCondition(walkEnd.state.player?.sprinting === false, "Walk presentation incorrectly reported sprinting");
      movementEvidence.summary.walk = Object.freeze({
        ticks: walkTicks,
        distance: walkDistance,
        perTick: walkPerTick,
        steadyHorizontalSpeed: walkPair.endEvidence.horizontalSpeed,
        startOrdinal: walkPair.startEvidence.ordinal,
        endOrdinal: walkPair.endEvidence.ordinal,
      });

      await keyDown("Control");
      const sprintInput = await awaitButton("sprint-input", INPUT_BUTTON.sprint, true, walkEnd);
      const sprintPair = await awaitSteadyMovementPair("sprint", true);
      const sprintStart = sprintPair.start;
      const sprintEnd = sprintPair.end;
      const sprintTicks = sprintEnd.runtime.playerAuthority.pump.lastAuthorityTick
        - sprintStart.runtime.playerAuthority.pump.lastAuthorityTick;
      const sprintDistance = horizontalDistance(sprintStart, sprintEnd);
      const sprintPerTick = sprintDistance / sprintTicks;
      assertCondition(sprintDistance > 0.04, `Sprint displacement was only ${sprintDistance}`);
      const sprintRatio = sprintPair.endEvidence.horizontalSpeed / walkPair.endEvidence.horizontalSpeed;
      movementEvidence.summary.sprint = Object.freeze({
        ticks: sprintTicks,
        distance: sprintDistance,
        perTick: sprintPerTick,
        steadyHorizontalSpeed: sprintPair.endEvidence.horizontalSpeed,
        steadyVelocityRatioToWalk: sprintRatio,
        startOrdinal: sprintPair.startEvidence.ordinal,
        endOrdinal: sprintPair.endEvidence.ordinal,
        inputAcknowledgedAtTick: sprintInput.runtime.playerAuthority.pump.lastAuthorityTick,
      });
      assertCondition(sprintRatio > 1.18 && sprintRatio < 1.85,
        `Sprint/walk steady authoritative velocity ratio ${sprintRatio} is outside the production envelope`);
      await capture("sprinting");
      await keyUp("Control");
      await awaitButton("sprint-release", INPUT_BUTTON.sprint, false, sprintEnd);
      await keyUp("d");

      const jumpBaseline = await settleVertical("jump-grounded");
      const jumpBaseY = positionOf(jumpBaseline, "jump baseline")[1];
      jumpEvidence.baseY = jumpBaseY;
      recordJumpEvidence("grounded-baseline", jumpBaseline);
      await keyDown("Space");
      const takeoff = await awaitAuthority("jump-takeoff", (snapshot) => {
        const y = positionOf(snapshot, "jump takeoff")[1];
        const vy = velocityOf(snapshot, "jump takeoff")[1];
        return Boolean(snapshot.runtime.playerAuthority.pump.lastAppliedButtons & INPUT_BUTTON.jump)
          && y > jumpBaseY + R5_JUMP_TRAJECTORY_THRESHOLDS.takeoffRise
          && vy > R5_JUMP_TRAJECTORY_THRESHOLDS.minimumAscentVelocity;
      }, 45_000, (snapshot) => recordJumpEvidence("takeoff-observation", snapshot));
      await keyUp("Space");
      await awaitButton(
        "jump-release",
        INPUT_BUTTON.jump,
        false,
        takeoff,
        (snapshot) => recordJumpEvidence("release-observation", snapshot),
      );
      const jumpCompletion = await awaitJumpCompletion();
      const jumpSummary = assertR5JumpTrajectoryEvidence(jumpCompletion.evidence);
      const landed = jumpCompletion.snapshot;
      await capture("jump-landed");

      const travelStart = await assertAuthority("travel-start");
      const startPosition = positionOf(travelStart, "travel start");
      const startChunk = Object.freeze([Math.floor(startPosition[0] / 16), Math.floor(startPosition[2] / 16)]);
      await keyDown("Control");
      await keyDown("d");
      const travelSprint = await awaitButton("travel-sprint", INPUT_BUTTON.sprint, true, travelStart);
      let firstCross = null;
      const travelEnd = await awaitAuthority("chunk-boundary-travel", (snapshot) => {
        const [x, , z] = positionOf(snapshot, "chunk travel");
        const currentChunk = [Math.floor(x / 16), Math.floor(z / 16)];
        if (!firstCross && (currentChunk[0] !== startChunk[0] || currentChunk[1] !== startChunk[1])) firstCross = snapshot;
        return firstCross !== null && horizontalDistance(firstCross, snapshot) >= 1.05;
      }, 90_000);
      await keyUp("d");
      await keyUp("Control");
      await awaitButton("travel-sprint-release", INPUT_BUTTON.sprint, false, travelEnd);
      const endPosition = positionOf(travelEnd, "travel end");
      const endChunk = Object.freeze([Math.floor(endPosition[0] / 16), Math.floor(endPosition[2] / 16)]);
      assertCondition(endChunk[0] !== startChunk[0] || endChunk[1] !== startChunk[1], "Travel did not cross a chunk boundary");
      assertCondition(horizontalDistance(travelStart, travelEnd) > 1, "Chunk travel made no authoritative progress");
      const travelRing = await awaitImmediateRing("chunk-boundary", 120_000);
      await capture("chunk-boundary-9-of-9");
      movementScenario = Object.freeze({
        walkPair,
        walkTicks,
        walkDistance,
        walkPerTick,
        sprintPair,
        sprintTicks,
        sprintDistance,
        sprintPerTick,
        sprintRatio,
        jumpBaseY,
        jumpSummary,
        landed,
        startChunk,
        endChunk,
        travelStart,
        travelEnd,
        travelSprint,
        travelRing,
      });
    }

    await releaseAllKeys();
    const preSavePair = await awaitPreSaveTerminalPair("pre-save-terminal");
    const preSave = preSavePair.end;
    await page.keyboard.press("Escape");
    await page.getByRole("heading", { name: "Game Paused" }).waitFor();
    let paused = await awaitPausedTerminalPose("paused-before-save", preSavePair.endEvidence.pose, {
      requireNativeProjectionSettled: deathRespawnSnapshots !== null,
    });
    assertCondition(paused.state?.state === "paused", "Real pause state was not presented before save");
    if (deathRespawnSnapshots) {
      deathRespawnSnapshots.pausedFreezeStart = paused;
      paused = await awaitPausedTerminalPose("paused-death-drop-freeze", preSavePair.endEvidence.pose, {
        requireNativeProjectionSettled: true,
      });
    }
    await capture("paused-before-save");
    if (environmentSnapshots) environmentSnapshots.preSave = paused;
    if (deathRespawnSnapshots) deathRespawnSnapshots.preSave = paused;
    const nativeCheckpointObservation = environmentSnapshots || deathRespawnSnapshots
      ? observeNativeSaveCheckpoint(paused)
      : null;
    await page.getByRole("button", { name: "Save & Quit to Title" }).click({ noWaitAfter: true });
    if (nativeCheckpointObservation) {
      const checkpointed = await nativeCheckpointObservation;
      if (environmentSnapshots) environmentSnapshots.checkpointed = checkpointed;
      if (deathRespawnSnapshots) deathRespawnSnapshots.checkpointed = checkpointed;
    }
    const continueButton = page.getByRole("button", { name: /Continue/u });
    await continueButton.waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll("button")];
      return buttons.some((button) => /Continue/u.test(button.textContent ?? "") && !button.disabled);
    }, undefined, { timeout: 120_000 });
    persistenceEvidence.saveAndQuitCompleted = true;
    await capture("title-after-save");

    await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(options.timeoutMilliseconds, 120_000) });
    authorityCursors.clear();
    await waitForHarness();
    assertCondition(new URL(page.url()).searchParams.get("experimental.rust-live-player-authority") === "r5",
      "Fresh page reload lost the explicit R5 integration selector");
    const freshContinue = page.getByRole("button", { name: /Continue/u });
    await freshContinue.waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll("button")];
      return buttons.some((button) => /Continue/u.test(button.textContent ?? "") && !button.disabled);
    }, undefined, { timeout: 120_000 });
    await freshContinue.click({ noWaitAfter: true });
    await awaitGameplay("fresh-continue-reload");
    const reloadedRing = await awaitImmediateRing("fresh-continue-reload");
    let reloaded = await assertAuthority("fresh-continue-reload-ready");
    if (deathRespawnSnapshots && !r5NativeSurvivalProjectionSettled(reloaded)) {
      const restoredDrainDeadline = Date.now() + 45_000;
      while (Date.now() < restoredDrainDeadline && !r5NativeSurvivalProjectionSettled(reloaded)) {
        await page.waitForTimeout(15);
        reloaded = await assertAuthority("fresh-continue-death-drop-drain");
      }
      assertCondition(r5NativeSurvivalProjectionSettled(reloaded),
        "fresh Continue did not drain its BWX0/environment/pump/drop-frame extraction envelope");
    }
    assertCondition(reloaded.runtime?.hydration === "restored", `Expected restored hydration, received ${String(reloaded.runtime?.hydration)}`);
    persistenceEvidence.restored = r5PersistencePoseEvidence(reloaded);
    const persistence = assertExactR5Reload(paused, reloaded, {
      seed: worldFixture.seed,
      mode: worldFixture.mode,
    });
    await capture("reloaded-9-of-9");

    let environmentEvidence = null;
    if (environmentSnapshots) {
      environmentSnapshots.restored = reloaded;
      environmentEvidence = assertR5NativeSurvivalEnvironmentSequence({
        ...environmentSnapshots,
        lifecycle: {
          saveAndQuitCompleted: persistenceEvidence.saveAndQuitCompleted,
          freshPageReloadBeforeContinue: true,
          freshContinueCompleted: true,
          r5SelectorPreserved: new URL(page.url()).searchParams.get("experimental.rust-live-player-authority") === "r5",
        },
      });
    }
    let deathRespawnEvidence = null;
    if (deathRespawnSnapshots) {
      deathRespawnSnapshots.restored = reloaded;
      deathRespawnEvidence = assertR5NativeSurvivalDeathRespawnSequence({
        ...deathRespawnSnapshots,
        lifecycle: {
          saveAndQuitCompleted: persistenceEvidence.saveAndQuitCompleted,
          freshPageReloadBeforeContinue: true,
          freshContinueCompleted: true,
          r5SelectorPreserved: new URL(page.url()).searchParams.get("experimental.rust-live-player-authority") === "r5",
        },
      });
    }

    assertCondition(artifactRequests.some((request) => (
      request.status === 200 && request.url.includes(`/engine/${options.expectedArtifactHash}/`)
    )), "No successful request loaded the exact expected content-addressed artifact");
    assertR5BrowserErrorStreams({ routeErrors, consoleErrors, pageErrors, runtimeErrors });
    const sourceSnapshot = assertR5CandidateSourceUnchanged(candidate);

    const createdCertificate = created.generationCertificates[0];
    const scenarioCoverage = movementScenario ? {
      movement: "passed",
      sprint: "passed",
      jumpAndLanding: "passed",
      chunkBoundaryTravel: "passed",
      exactTravelReadinessRing: `${movementScenario.travelRing.ring.ready}/${movementScenario.travelRing.ring.desired}`,
      editPreservation: "not-exercised-existing-r5-runner-has-no-stable-edit-action",
    } : environmentEvidence ? {
      exactSubmergeAndOxygenDrain: "passed",
      exactNativeHealthReduction: "passed",
      noTypeScriptDamageAuthoring: "passed",
      surfaceAndShoreExit: "passed",
      nativeCheckpointBeforeSave: "passed",
      saveQuitReloadContinueRestoration: "passed",
      r6R7Parity: "passed",
      movementSprintJumpAndChunkTravel: "not-exercised-separate-movement-persistence-scenario",
    } : {
      lethalNativeDrowning: "passed",
      exactlyOneProjectedDeath: "passed",
      automaticNativeRespawnAtFrozenSpawn: "passed",
      neutralInputAfterDeath: "passed",
      exactBwe7CheckpointProjectionAndAck: "passed",
      slotZeroCleared: "passed",
      exactBerryDeathDrop: "passed",
      saveQuitReloadContinueRestoration: "passed",
      noDeathReplayAfterReload: "passed",
      deathDropPickup: "not-exercised-not-claimed",
      movementSprintJumpAndChunkTravel: "not-exercised-separate-movement-persistence-scenario",
    };
    const scenarioMeasurements = movementScenario ? {
      walk: {
        ticks: movementScenario.walkTicks,
        distance: movementScenario.walkDistance,
        perTick: movementScenario.walkPerTick,
        steadyHorizontalSpeed: movementScenario.walkPair.endEvidence.horizontalSpeed,
      },
      sprint: {
        ticks: movementScenario.sprintTicks,
        distance: movementScenario.sprintDistance,
        perTick: movementScenario.sprintPerTick,
        ratioToWalk: movementScenario.sprintRatio,
        ratioBasis: "settled-authoritative-horizontal-velocity",
        steadyHorizontalSpeed: movementScenario.sprintPair.endEvidence.horizontalSpeed,
      },
      jump: {
        baseY: movementScenario.jumpBaseY,
        peakY: movementScenario.jumpSummary.peak.positionY,
        peakRise: movementScenario.jumpSummary.peakRise,
        descendingY: movementScenario.jumpSummary.descending.positionY,
        descendingVelocityY: movementScenario.jumpSummary.descending.velocityY,
        landedY: positionOf(movementScenario.landed, "recorded landing")[1],
      },
      travel: {
        startChunk: movementScenario.startChunk,
        endChunk: movementScenario.endChunk,
        distance: horizontalDistance(movementScenario.travelStart, movementScenario.travelEnd),
        sprintTick: movementScenario.travelSprint.runtime.playerAuthority.pump.lastAuthorityTick,
      },
    } : environmentEvidence ? {
      environment: {
        maximumOxygenSeconds: environmentEvidence.samples.dryBaseline.r6.maximumOxygenSeconds,
        oxygenAtSubmersion: environmentEvidence.samples.submergedEntry.r6.oxygenSeconds,
        oxygenAfterDrain: environmentEvidence.samples.oxygenDrained.r6.oxygenSeconds,
        oxygenAtDamage: environmentEvidence.samples.damaged.r6.oxygenSeconds,
        healthBeforeDamage: environmentEvidence.samples.oxygenDrained.r6.health,
        healthAfterDamage: environmentEvidence.samples.damaged.r6.health,
        r7MilliheartsBeforeDamage: environmentEvidence.samples.oxygenDrained.r7.health,
        r7MilliheartsAfterDamage: environmentEvidence.samples.damaged.r7.health,
        damageTick: environmentEvidence.samples.damaged.r6.lastDamageTick,
        observedShoreExitCueCount: environmentEvidence.shoreExit.observedCueCount,
        checkpointId: environmentEvidence.checkpoint.checkpointId,
      },
    } : {
      deathRespawn: {
        deathSequence: deathRespawnEvidence.parent.deathSequence,
        respawnSequence: deathRespawnEvidence.parent.respawnSequence,
        receiptHash: deathRespawnEvidence.parent.receiptHash,
        deathPosition: deathRespawnEvidence.deathPosition,
        dropId: deathRespawnEvidence.child.dropId,
        dropEntityId: deathRespawnEvidence.child.entityId,
        itemCode: deathRespawnEvidence.child.stack.itemCode,
        count: deathRespawnEvidence.child.stack.count,
        projectionCursor: deathRespawnEvidence.respawned.projection.cursor,
        checkpointId: deathRespawnEvidence.checkpoint.checkpointId,
      },
    };
    const gate = options.scenario === "native-survival-environment"
      ? "blockwild-r5-native-survival-environment-browser-v1"
      : options.scenario === "native-survival-death-respawn"
        ? "blockwild-r5-native-survival-death-respawn-browser-v1"
        : "blockwild-r5-current-source-browser-v1";
    result = {
      schema: 1,
      gate,
      status: "passed",
      createdAt: new Date().toISOString(),
      authorityClaim: options.scenario === "native-survival-environment"
        ? "candidate-native-survival-swim-drowning-r6-r7-persistence-evidence-only"
        : options.scenario === "native-survival-death-respawn"
          ? "candidate-native-survival-lethal-drowning-bwe7-death-drop-respawn-persistence-evidence-only"
          : "candidate-current-source-integration-evidence-only",
      scenario: options.scenario,
      selector: "experimental.rust-live-player-authority=r5",
      artifactHash: options.expectedArtifactHash,
      generationCertificate: Object.freeze({
        corpusCases: createdCertificate.corpusCases,
        corpusHash: createdCertificate.corpusHash,
        byteEqual: createdCertificate.byteEqual,
      }),
      artifact: {
        expectedHash: options.expectedArtifactHash,
        runtimeHostHash: reloaded.runtime.manager.host.artifactHash,
        candidateDirectory: options.engineDirectory
          ? relativeEvidencePath(options.repositoryRoot, options.engineDirectory)
          : null,
        sourceSnapshot,
        requests: artifactRequests,
      },
      managedCanonicalAssetRequests: canonicalAssetRequests,
      harness: {
        baseUrl,
        managedServer: managedServer !== null,
        managedServerPid: managedServer?.child?.pid ?? null,
        managedServerHmr: managedServer?.inlineConfig?.server?.hmr ?? null,
        managedServerWatch: managedServer ? "ignore-all" : null,
        managedServerLogTail: managedServer?.logs?.join("").slice(-16_384) ?? null,
        browserOwnership: "playwright-persistent-context",
        browserProfileToken: path.basename(profileDirectory),
        browserExecutable: browserExecutable ?? "playwright-managed",
        playwrightSource: playwright.source,
        persistentProfile: profileDirectory,
        freshPageReloadBeforeContinue: true,
        browserGateMutex: browserMutexEvidence,
      },
      coverage: {
        freshCreate: "passed",
        exactCreateReadinessRing: `${createdRing.ring.ready}/${createdRing.ring.desired}`,
        ...scenarioCoverage,
        realSaveAndQuit: "passed",
        freshContinueAfterPageReload: "passed",
        exactReloadReadinessRing: `${reloadedRing.ring.ready}/${reloadedRing.ring.desired}`,
        exactSeedModeAndAuthoritativePosePreservation: "passed",
        editPreservation: "not-exercised-existing-r5-runner-has-no-stable-edit-action",
      },
      measurements: {
        createdPosition,
        ...scenarioMeasurements,
        persistence,
        preSavePose: poseFromState(preSave.state, "recorded pre-save pose"),
      },
      movementEvidence,
      jumpEvidence,
      persistenceEvidence,
      environmentEvidence,
      deathRespawnEvidence,
      checkpoints: {
        created: { state: created.state, runtime: created.runtime, generationCertificates: created.generationCertificates },
        preSave: { state: preSave.state, runtime: preSave.runtime },
        paused: { state: paused.state, runtime: paused.runtime },
        reloaded: { state: reloaded.state, runtime: reloaded.runtime, generationCertificates: reloaded.generationCertificates },
      },
      screenshots,
      consoleErrors,
      pageErrors,
      runtimeErrors,
      routeErrors,
      cleanup,
      exclusions: {
        edit: "The inherited R5 runner has no deterministic, player-owned edit-and-observe action. This gate does not synthesize one or claim edit persistence.",
        broaderR5Authority: options.scenario === "native-survival-environment"
          ? "Fall damage, lethal death/respawn, combat knockback, mounts, boats, doors, and stairs remain outside this bounded native swim/drowning gate."
          : options.scenario === "native-survival-death-respawn"
            ? "This gate proves one default false-policy Berry custody/death/respawn path only. Death-drop pickup, equipment drops, keepInventory=true, non-drowning deaths, combat knockback, mounts, boats, doors, and stairs remain outside the claim."
            : "Swimming, mounts, boats, combat knockback, doors, and stairs remain outside this bounded terrain/integration gate.",
      },
    };
  } catch (error) {
    if (lastSnapshot) recordRuntimeErrors(lastSnapshot, "failure-snapshot");
    const failedScreenshot = path.join(options.outputDirectory, "failed.png");
    if (page) {
      await page.screenshot({ path: failedScreenshot, type: "png" }).then(() => {
        screenshots.failed = relativeEvidencePath(options.repositoryRoot, failedScreenshot);
      }).catch(() => {});
    }
    result = {
      schema: 1,
      gate: options.scenario === "native-survival-environment"
        ? "blockwild-r5-native-survival-environment-browser-v1"
        : options.scenario === "native-survival-death-respawn"
          ? "blockwild-r5-native-survival-death-respawn-browser-v1"
          : "blockwild-r5-current-source-browser-v1",
      status: "failed",
      createdAt: new Date().toISOString(),
      authorityClaim: "none",
      scenario: options.scenario,
      artifactHash: options.expectedArtifactHash,
      expectedGenerationCertificate: R5_GENERATION_CERTIFICATE,
      generationCertificate: lastSnapshot?.generationCertificates?.[0] ?? null,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      state: lastSnapshot?.state ?? null,
      runtime: lastSnapshot?.runtime ?? null,
      observedGenerationCertificates: lastSnapshot?.generationCertificates ?? [],
      movementEvidence,
      jumpEvidence,
      persistenceEvidence,
      harness: {
        baseUrl: options.baseUrl ?? managedServer?.baseUrl ?? managedServerAttempt?.baseUrl ?? null,
        managedServer: managedServerAttempt !== null,
        managedServerReady: managedServer !== null,
        managedServerPid: managedServer?.child?.pid ?? managedServerAttempt?.child?.pid ?? null,
        managedServerHmr: managedServer?.inlineConfig?.server?.hmr
          ?? managedServerAttempt?.inlineConfig?.server?.hmr ?? null,
        managedServerWatch: managedServerAttempt ? "ignore-all" : null,
        managedServerLogTail: (managedServer?.logs ?? managedServerAttempt?.logs)?.join("").slice(-16_384) ?? null,
        browserOwnership: "playwright-persistent-context",
        browserProfileToken: path.basename(profileDirectory),
        browserGateMutex: browserMutexEvidence,
      },
      screenshots,
      artifactRequests,
      artifact: candidate ? {
        expectedHash: options.expectedArtifactHash,
        candidateDirectory: relativeEvidencePath(options.repositoryRoot, options.engineDirectory),
        sourceSnapshot: candidate.sourceSnapshot,
      } : null,
      managedCanonicalAssetRequests: canonicalAssetRequests,
      consoleErrors,
      pageErrors,
      runtimeErrors,
      routeErrors,
      cleanup,
    };
  } finally {
    if (context) {
      await context.close().then(() => { cleanup.browserClosed = true; }).catch((error) => {
        runtimeErrors.push(`browser cleanup: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (managedServer) {
      cleanup.serverExitCodeBeforeStop = managedServer.child.exitCode;
      if (managedServer.child.exitCode !== null) {
        runtimeErrors.push(`managed server exited before cleanup with code ${managedServer.child.exitCode}`);
      }
      cleanup.serverStop = Object.create(null);
      try {
        cleanup.serverStopped = await stopOwnedProcess(managedServer.child, { diagnostics: cleanup.serverStop });
      } catch (error) {
        cleanup.serverStopped = false;
        runtimeErrors.push(`managed server cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (managedServerAttempt) {
      cleanup.serverExitCodeBeforeStop = managedServerAttempt.child.exitCode;
      cleanup.serverStop = managedServerAttempt.stopDiagnostics ?? Object.create(null);
      cleanup.serverStopped = managedServerAttempt.stopped;
      if (!cleanup.serverStopped) {
        try {
          cleanup.serverStopped = await stopOwnedProcess(managedServerAttempt.child, { diagnostics: cleanup.serverStop });
        } catch (error) {
          runtimeErrors.push(`managed server cleanup after startup failure: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    try { cleanup.profileRemoved = removeOwnedProfile(profileDirectory); }
    catch (error) { runtimeErrors.push(`profile cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    if (browserMutex) {
      try { cleanup.browserMutexReleased = await browserMutex.release(); }
      catch (error) {
        cleanup.browserMutexReleased = false;
        runtimeErrors.push(`browser mutex cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const terminalSourceSnapshot = recordR5TerminalSourceCleanup(candidate, cleanup, runtimeErrors);
    if (result?.artifact) {
      result.artifact = { ...result.artifact, terminalSourceSnapshot };
    }
    if (!r5CleanupGatePassed(cleanup)
      || consoleErrors.length > 0 || pageErrors.length > 0 || runtimeErrors.length > 0 || routeErrors.length > 0) {
      result = {
        ...result,
        status: "failed",
        authorityClaim: "none",
        error: result?.error ?? "Browser, server, profile, or error-stream cleanup gate failed.",
      };
    }
    result.cleanup = cleanup;
    result.consoleErrors = consoleErrors;
    result.pageErrors = pageErrors;
    result.runtimeErrors = runtimeErrors;
    result.routeErrors = routeErrors;
    result.movementEvidence = movementEvidence;
    result.jumpEvidence = jumpEvidence;
    result.persistenceEvidence = persistenceEvidence;
    if (result.status === "passed" && result.environmentEvidence) {
      try {
        assertR5NativeSurvivalEnvironmentTerminalGate(result);
      } catch (error) {
        runtimeErrors.push(`native environmental terminal gate: ${error instanceof Error ? error.message : String(error)}`);
        result = {
          ...result,
          status: "failed",
          authorityClaim: "none",
          error: "Native environmental terminal gate failed after owned-process cleanup.",
          runtimeErrors,
        };
      }
    }
    if (result.status === "passed" && result.deathRespawnEvidence) {
      try {
        assertR5NativeSurvivalDeathRespawnTerminalGate(result);
      } catch (error) {
        runtimeErrors.push(`native death-respawn terminal gate: ${error instanceof Error ? error.message : String(error)}`);
        result = {
          ...result,
          status: "failed",
          authorityClaim: "none",
          error: "Native death-respawn terminal gate failed after owned-process cleanup.",
          runtimeErrors,
        };
      }
    }
    const errors = { consoleErrors, pageErrors, runtimeErrors, routeErrors };
    writeFileSync(path.join(options.outputDirectory, "errors.json"), `${JSON.stringify(errors, null, 2)}\n`, "utf8");
    writeFileSync(path.join(options.outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return Object.freeze({ ...result, outputPath: path.join(options.outputDirectory, "result.json") });
}

async function main() {
  try {
    const result = await runR5PlayerBrowser(process.argv);
    if (result.help) {
      process.stdout.write(result.usage);
      return;
    }
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      scenario: result.scenario ?? null,
      artifactHash: result.artifactHash,
      generationCertificate: result.generationCertificate,
      coverage: result.coverage ?? null,
      screenshots: result.screenshots,
      cleanup: result.cleanup,
      outputPath: result.outputPath,
      error: result.error ?? null,
    }, null, 2)}\n`);
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Rust R5 player browser verifier failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectInvocation(import.meta.url)) {
  if (process.argv[2] === INTERNAL_MANAGED_VITE_COMMAND) {
    try {
      if (process.argv.length !== 5) fail("Managed Vite child received malformed internal arguments.");
      await runManagedViteChild(process.argv[3], process.argv[4]);
    } catch (error) {
      process.stderr.write(`Managed R5 Vite server failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  } else {
    await main();
  }
}

function usage() {
  return `Usage: node scripts/verify-rust-r5-player-browser.mjs \\
  --expected-artifact-hash <64 lowercase hex> \\
  --output <directory beneath work/> \\
  --engine-dir public/engine-locator-candidate \\
  [--scenario movement-persistence|native-survival-environment|native-survival-death-respawn] \\
  [--base-url <existing app origin>] [--timeout-ms <30000..900000>] \\
  [--playwright-module <path>] [--browser-executable <path>] [--headed]\n\nWithout --base-url, the verifier starts and owns a loopback Vite server.\nThe required isolated candidate resolves every /engine request without mutating public/engine.\n`;
}
