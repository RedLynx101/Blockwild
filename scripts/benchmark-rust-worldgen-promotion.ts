import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  createGeneratedChunkV2,
  decodeTerrainGenerationMarkerTableV2,
  type GeneratedChunkV2,
  type GenerateChunkRequestV2,
} from "../app/game/terrain-generation-contract.ts";
import { terrainGenerationChunksByteEqualV2 } from "../app/game/rust-terrain-generation-backend.ts";
import {
  decodeRustTerrainGenerationResultV2,
  encodeRustTerrainGenerationRequestV2,
  parseTerrainGenerationParityCertificateV2,
  type TerrainGenerationParityCertificateV2,
} from "../app/game/rust-terrain-generation-bridge.ts";
import { generateChunkWithLegacyOracleV2 } from "../app/game/rust-terrain-generation-legacy-oracle.ts";
import {
  COMPOSED_PROMOTION_CASES_V2,
  COMPOSED_PROMOTION_COVERAGE_V2,
  FROZEN_PROMOTION_CASES_V1,
  FROZEN_PROMOTION_MANIFEST_PATH_V1,
  NORMALIZED_OPTION_EXTENSION_CASES_V1,
  NORMALIZED_OPTION_EXTENSION_PATH_V1,
  assignStableCorpusOrdinals,
  expandFrozenPromotionCases,
  expandNormalizedOptionCases,
  loadFrozenPromotionCorpusV1,
  loadNormalizedOptionsExtensionV1,
  promotionCorpusHashV2,
  requestForPromotionCase,
  type FrozenPromotionCorpusV1,
  type NormalizedOptionsExtensionV1,
  type PromotionParityHashRowV2,
  type StablePromotionCorpusCaseV2,
} from "./lib/rust-worldgen-promotion-corpus.ts";

export type PromotionCorpusCase = StablePromotionCorpusCaseV2;

export type OrderedPromotionCase = Readonly<{
  entry: PromotionCorpusCase;
  source: "named" | "generic" | "options";
  sourceIndex: number;
}>;

type NativeBenchmarkTelemetry = Readonly<{
  schema: number;
  samples: number;
  coldUs: number;
  warmMeanUs: number;
  warmP50Us: number;
  warmP95Us: number;
  warmP99Us: number;
  warmMaxUs: number;
  requestBytes: number;
  resultBytes: number;
  coldResultBytes: number;
  perCaseUs: readonly number[];
}>;

const ROOT = resolve(import.meta.dirname, "..");
const WORK_ROOT = join(ROOT, "work");
const FIXTURE_SOURCE_PATH = join(ROOT, "engine", "crates", "blockwild-generation", "src", "bin", "fixture.rs");
export const RUST_WORLDGEN_PROMOTION_FIXTURE_PROFILE = "release" as const;
export const RUST_WORLDGEN_PROMOTION_FIXTURE_BUILD_COMMAND =
  "cargo build --release -p blockwild-generation --bin blockwild-generation-fixture";

export function resolveRustWorldgenPromotionFixturePath(root = ROOT, platform = process.platform) {
  return join(
    root,
    "engine",
    "target",
    RUST_WORLDGEN_PROMOTION_FIXTURE_PROFILE,
    `blockwild-generation-fixture${platform === "win32" ? ".exe" : ""}`,
  );
}

const FIXTURE_PATH = resolveRustWorldgenPromotionFixturePath();
const DEFAULT_OUTPUT = join(WORK_ROOT, "rust-worldgen-promotion", "benchmark.json");
const EXPECTED_NAMED_CASES = 67;
const EXPECTED_GENERIC_CASES = FROZEN_PROMOTION_CASES_V1 - EXPECTED_NAMED_CASES;
const FIXTURE_TIMEOUT_MS = 180_000;

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string) {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value as number;
}

export function orderedPromotionCases(
  frozenManifest: FrozenPromotionCorpusV1,
  extensionManifest: NormalizedOptionsExtensionV1,
): readonly OrderedPromotionCase[] {
  const cases = assignStableCorpusOrdinals(
    expandFrozenPromotionCases(frozenManifest),
    expandNormalizedOptionCases(extensionManifest),
  );
  const coverage = new Set([
    ...frozenManifest.requiredCoverage,
    ...extensionManifest.requiredCoverage,
  ]);
  if (frozenManifest.cases.length !== EXPECTED_NAMED_CASES
    || frozenManifest.genericSweep.cases !== EXPECTED_GENERIC_CASES
    || cases.length !== COMPOSED_PROMOTION_CASES_V2
    || coverage.size !== COMPOSED_PROMOTION_COVERAGE_V2) {
    fail("shared promotion corpus does not retain the exact 67 named + 64 generic + 24 option / 89-coverage shape");
  }
  return Object.freeze(cases.map((entry, index): OrderedPromotionCase => {
    if (index < EXPECTED_NAMED_CASES) {
      return Object.freeze({ entry, source: "named", sourceIndex: index });
    }
    if (index < FROZEN_PROMOTION_CASES_V1) {
      return Object.freeze({ entry, source: "generic", sourceIndex: Number(entry.id.slice("generic-".length)) });
    }
    return Object.freeze({ entry, source: "options", sourceIndex: index - FROZEN_PROMOTION_CASES_V1 });
  }));
}

export async function loadBenchmarkPromotionCorpus() {
  const [frozenManifest, extensionManifest] = await Promise.all([
    loadFrozenPromotionCorpusV1(),
    loadNormalizedOptionsExtensionV1(),
  ]);
  return Object.freeze({
    frozenManifest,
    extensionManifest,
    orderedCases: orderedPromotionCases(frozenManifest, extensionManifest),
  });
}

function u32(value: number) {
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32LE(value, 0);
  return bytes;
}

export function encodePacketBatch(packets: readonly Uint8Array[]) {
  if (packets.length === 0 || packets.length > 4_096) fail("packet batch count is outside 1..=4096");
  const parts: Buffer[] = [u32(packets.length)];
  for (const [index, packet] of packets.entries()) {
    if (packet.byteLength === 0 || packet.byteLength > 16 * 1024 * 1024) {
      fail(`packet batch entry ${index} is outside 1..=16777216 bytes`);
    }
    parts.push(u32(packet.byteLength), Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength));
  }
  return Buffer.concat(parts);
}

export function decodePacketBatch(value: Uint8Array, expectedCount: number) {
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  let offset = 0;
  const takeU32 = () => {
    if (offset + 4 > value.byteLength) fail("native result batch is truncated");
    const result = view.getUint32(offset, true);
    offset += 4;
    return result;
  };
  const count = takeU32();
  if (count !== expectedCount) fail(`native result batch returned ${count} packets; expected exactly ${expectedCount}`);
  const packets: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const length = takeU32();
    if (length === 0 || length > 16 * 1024 * 1024) fail(`native result packet ${index} has invalid length ${length}`);
    if (offset + length > value.byteLength) fail(`native result packet ${index} is truncated`);
    packets.push(value.subarray(offset, offset + length));
    offset += length;
  }
  if (offset !== value.byteLength) fail("native result batch contains trailing bytes");
  return packets;
}

export function nearestRank(values: readonly number[], fraction: number) {
  if (values.length === 0) fail("nearest-rank percentile requires at least one sample");
  if (!(fraction > 0 && fraction <= 1)) fail("nearest-rank fraction must be within (0, 1]");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function timingSummary(samplesMilliseconds: readonly number[]) {
  if (samplesMilliseconds.some((value) => !Number.isFinite(value) || value < 0)) fail("timing samples must be finite and non-negative");
  const totalMilliseconds = samplesMilliseconds.reduce((total, value) => total + value, 0);
  return Object.freeze({
    samples: samplesMilliseconds.length,
    unit: "milliseconds",
    percentileMethod: "nearest-rank: sorted[ceil(sampleCount * fraction) - 1]",
    p50Milliseconds: nearestRank(samplesMilliseconds, 0.5),
    p95Milliseconds: nearestRank(samplesMilliseconds, 0.95),
    p99Milliseconds: nearestRank(samplesMilliseconds, 0.99),
    totalMilliseconds,
    meanMilliseconds: totalMilliseconds / samplesMilliseconds.length,
    minimumMilliseconds: Math.min(...samplesMilliseconds),
    maximumMilliseconds: Math.max(...samplesMilliseconds),
  });
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function isWithin(parent: string, candidate: string) {
  const relation = relative(parent, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

export function resolveWorkJsonOutput(output: string | undefined, root = ROOT) {
  const workRoot = resolve(root, "work");
  const target = resolve(root, output ?? relative(root, DEFAULT_OUTPUT));
  if (!isWithin(workRoot, target) || target === workRoot) fail("--output must resolve to a JSON file beneath work/");
  if (extname(target).toLowerCase() !== ".json") fail("--output must use a .json extension");
  return target;
}

function outputOption(argv: readonly string[]) {
  let output: string | undefined;
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] !== "--output") fail(`unknown argument: ${argv[index]}`);
    if (output !== undefined) fail("--output may only be provided once");
    output = argv[index + 1];
    if (!output || output.startsWith("--")) fail("--output requires a path beneath work/");
    index += 1;
  }
  return output;
}

async function prepareOutputPath(outputPath: string) {
  await mkdir(WORK_ROOT, { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });
  const [canonicalWork, canonicalParent] = await Promise.all([realpath(WORK_ROOT), realpath(dirname(outputPath))]);
  if (!isWithin(canonicalWork, canonicalParent)) fail("--output parent resolves outside the canonical work/ directory");
  if (existsSync(outputPath) && (await lstat(outputPath)).isSymbolicLink()) fail("--output must not be a symbolic link");
}

function parseNativeTelemetry(stdout: string): NativeBenchmarkTelemetry {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) fail(`native fixture emitted ${lines.length} non-empty stdout lines; expected one JSON record`);
  const source = record(JSON.parse(lines[0]) as unknown, "native benchmark telemetry");
  const perCaseUs = source.perCaseUs;
  if (!Array.isArray(perCaseUs) || perCaseUs.some((value) => !Number.isSafeInteger(value) || Number(value) < 0)) {
    fail("native benchmark perCaseUs must contain non-negative safe integers");
  }
  const telemetry: NativeBenchmarkTelemetry = Object.freeze({
    schema: integer(source.schema, "native benchmark schema"),
    samples: integer(source.samples, "native benchmark samples"),
    coldUs: integer(source.coldUs, "native benchmark coldUs"),
    warmMeanUs: integer(source.warmMeanUs, "native benchmark warmMeanUs"),
    warmP50Us: integer(source.warmP50Us, "native benchmark warmP50Us"),
    warmP95Us: integer(source.warmP95Us, "native benchmark warmP95Us"),
    warmP99Us: integer(source.warmP99Us, "native benchmark warmP99Us"),
    warmMaxUs: integer(source.warmMaxUs, "native benchmark warmMaxUs"),
    requestBytes: integer(source.requestBytes, "native benchmark requestBytes"),
    resultBytes: integer(source.resultBytes, "native benchmark resultBytes"),
    coldResultBytes: integer(source.coldResultBytes, "native benchmark coldResultBytes"),
    perCaseUs: Object.freeze(perCaseUs.map(Number)),
  });
  if (telemetry.schema !== 1) fail(`native benchmark telemetry schema must be 1, received ${telemetry.schema}`);
  if (telemetry.samples !== COMPOSED_PROMOTION_CASES_V2 || telemetry.perCaseUs.length !== COMPOSED_PROMOTION_CASES_V2) {
    fail(`native benchmark must return exactly ${COMPOSED_PROMOTION_CASES_V2} samples and perCaseUs entries`);
  }
  return telemetry;
}

function addIssue(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message);
  return condition;
}

function markerConstraints(entry: PromotionCorpusCase, reference: GeneratedChunkV2) {
  const rows = decodeTerrainGenerationMarkerTableV2(reference.markerTable);
  const markerText = JSON.stringify(rows);
  const issues: string[] = [];
  if (entry.markerToken && !markerText.includes(entry.markerToken)) issues.push(`required marker token ${entry.markerToken} is absent`);
  if (entry.absentMarkerToken && markerText.includes(entry.absentMarkerToken)) {
    issues.push(`forbidden marker token ${entry.absentMarkerToken} is present`);
  }
  if (entry.minimumMarkers !== undefined && rows.length < entry.minimumMarkers) {
    issues.push(`marker count ${rows.length} is below minimum ${entry.minimumMarkers}`);
  }
  if (entry.maximumMarkers !== undefined && rows.length > entry.maximumMarkers) {
    issues.push(`marker count ${rows.length} exceeds maximum ${entry.maximumMarkers}`);
  }
  return { passed: issues.length === 0, markerCount: rows.length, issues };
}

async function runNativeFixture(requestPackets: readonly Uint8Array[]) {
  if (!existsSync(FIXTURE_PATH)) {
    fail(`prebuilt ${RUST_WORLDGEN_PROMOTION_FIXTURE_PROFILE} native fixture is absent: ${FIXTURE_PATH}. Build it separately with ${RUST_WORLDGEN_PROMOTION_FIXTURE_BUILD_COMMAND}; this benchmark never invokes Cargo.`);
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "blockwild-worldgen-promotion-"));
  const inputPath = join(temporaryDirectory, "requests.bin");
  const outputPath = join(temporaryDirectory, "results.bin");
  try {
    const inputBatch = encodePacketBatch(requestPackets);
    await writeFile(inputPath, inputBatch);
    const processResult = spawnSync(FIXTURE_PATH, ["--packet-benchmark", inputPath, outputPath], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: FIXTURE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    if (processResult.error) fail(`native fixture failed to start: ${processResult.error.message}`);
    if (processResult.status !== 0) {
      fail(`native fixture exited ${processResult.status ?? "without status"}: ${processResult.stderr.trim() || "no stderr"}`);
    }
    if (!existsSync(outputPath)) fail("native fixture did not write its result batch");
    const telemetry = parseNativeTelemetry(processResult.stdout);
    const outputBytes = await readFile(outputPath);
    const packets = decodePacketBatch(outputBytes, COMPOSED_PROMOTION_CASES_V2);
    return { telemetry, packets, inputBytes: inputBatch.byteLength, outputBytes: outputBytes.byteLength };
  } finally {
    await unlink(inputPath).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
    await rmdir(temporaryDirectory).catch(() => undefined);
  }
}

function readCertificate() {
  const result = spawnSync(FIXTURE_PATH, ["--certificate"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) fail(`native certificate fixture failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`native certificate fixture exited ${result.status ?? "without status"}: ${result.stderr.trim()}`);
  return parseTerrainGenerationParityCertificateV2(new TextEncoder().encode(result.stdout.trim()));
}

function validateTelemetry(issues: string[], telemetry: NativeBenchmarkTelemetry, inputBytes: number, outputBytes: number) {
  const sorted = [...telemetry.perCaseUs].sort((left, right) => left - right);
  const totalUs = telemetry.perCaseUs.reduce((total, value) => total + value, 0);
  addIssue(issues, telemetry.requestBytes === inputBytes, "native telemetry requestBytes disagrees with the input batch");
  addIssue(issues, telemetry.resultBytes === outputBytes, "native telemetry resultBytes disagrees with the output batch");
  addIssue(issues, telemetry.coldResultBytes > 0, "native excluded cold result must be non-empty");
  addIssue(issues, telemetry.warmP50Us === nearestRank(telemetry.perCaseUs, 0.5), "native warmP50Us is not nearest-rank p50");
  addIssue(issues, telemetry.warmP95Us === nearestRank(telemetry.perCaseUs, 0.95), "native warmP95Us is not nearest-rank p95");
  addIssue(issues, telemetry.warmP99Us === nearestRank(telemetry.perCaseUs, 0.99), "native warmP99Us is not nearest-rank p99");
  addIssue(issues, telemetry.warmMaxUs === sorted.at(-1), "native warmMaxUs disagrees with perCaseUs");
  addIssue(issues, telemetry.warmMeanUs === Math.floor(totalUs / telemetry.perCaseUs.length), "native warmMeanUs disagrees with perCaseUs");
}

function validateCertificate(
  issues: string[],
  certificate: TerrainGenerationParityCertificateV2,
  corpusHash: string,
  requests: readonly GenerateChunkRequestV2[],
) {
  addIssue(issues, certificate.byteEqual, "native parity certificate byteEqual is false");
  addIssue(issues, certificate.corpusCases === COMPOSED_PROMOTION_CASES_V2,
    `native parity certificate covers ${certificate.corpusCases} cases instead of exactly ${COMPOSED_PROMOTION_CASES_V2}`);
  addIssue(issues, certificate.corpusHash === corpusHash, "native parity certificate corpusHash differs from this exact manifest run");
  addIssue(issues, certificate.generatorVersion === 18, "native parity certificate generatorVersion is not 18");
  addIssue(issues, certificate.generatorHash === requests[0].generatorHash, "native parity certificate generatorHash differs from requests");
  addIssue(issues, certificate.contentHash === requests[0].contentHash, "native parity certificate contentHash differs from requests");
}

export async function benchmarkRustWorldgenPromotion(argv = process.argv) {
  const outputPath = resolveWorkJsonOutput(outputOption(argv));
  const [corpus, frozenManifestText, extensionManifestText, fixtureBytes, fixtureSource, fixtureMetadata, fixtureSourceMetadata] = await Promise.all([
    loadBenchmarkPromotionCorpus(),
    readFile(FROZEN_PROMOTION_MANIFEST_PATH_V1, "utf8"),
    readFile(NORMALIZED_OPTION_EXTENSION_PATH_V1, "utf8"),
    readFile(FIXTURE_PATH).catch(() => null),
    readFile(FIXTURE_SOURCE_PATH, "utf8"),
    stat(FIXTURE_PATH).catch(() => null),
    stat(FIXTURE_SOURCE_PATH),
  ]);
  if (!fixtureBytes || !fixtureMetadata) {
    fail(`prebuilt ${RUST_WORLDGEN_PROMOTION_FIXTURE_PROFILE} native fixture is absent: ${FIXTURE_PATH}. Build it separately with ${RUST_WORLDGEN_PROMOTION_FIXTURE_BUILD_COMMAND}; this benchmark never invokes Cargo.`);
  }
  const { frozenManifest, extensionManifest, orderedCases } = corpus;
  const requests = orderedCases.map(({ entry }) => requestForPromotionCase(entry));
  const requestPackets = requests.map(encodeRustTerrainGenerationRequestV2);

  const warmupStarted = performance.now();
  createGeneratedChunkV2(requests[0], generateChunkWithLegacyOracleV2(requests[0]));
  const typescriptWarmupMilliseconds = performance.now() - warmupStarted;

  const references: GeneratedChunkV2[] = [];
  const typescriptMilliseconds: number[] = [];
  for (const request of requests) {
    const started = performance.now();
    references.push(createGeneratedChunkV2(request, generateChunkWithLegacyOracleV2(request)));
    typescriptMilliseconds.push(performance.now() - started);
  }

  const native = await runNativeFixture(requestPackets);
  const certificate = readCertificate();
  const rustMilliseconds = native.telemetry.perCaseUs.map((value) => value / 1_000);
  const issues: string[] = [];
  validateTelemetry(issues, native.telemetry, native.inputBytes, native.outputBytes);

  const parityRows: PromotionParityHashRowV2[] = [];
  const perCase = orderedCases.map(({ entry, source, sourceIndex }, index) => {
    const request = requests[index];
    const reference = references[index];
    let candidate: GeneratedChunkV2 | null = null;
    let decodeIssue: string | null = null;
    try {
      candidate = decodeRustTerrainGenerationResultV2(native.packets[index], request);
    } catch (error) {
      decodeIssue = error instanceof Error ? error.message : String(error);
      issues.push(`${entry.id}: native result packet does not match sequence ${index + 1}: ${decodeIssue}`);
    }
    const byteEqual = candidate !== null && terrainGenerationChunksByteEqualV2(reference, candidate);
    const chunkHashEqual = candidate !== null && candidate.chunkHash === reference.chunkHash;
    if (!byteEqual) issues.push(`${entry.id}: Rust authoritative candidate is not byte-equal to the TypeScript legacy oracle`);
    if (!chunkHashEqual) issues.push(`${entry.id}: Rust authoritative candidate chunk hash differs from the TypeScript legacy oracle`);
    const markers = markerConstraints(entry, reference);
    for (const issue of markers.issues) issues.push(`${entry.id}: ${issue}`);
    if (candidate && byteEqual && chunkHashEqual) {
      parityRows.push(Object.freeze({
        id: entry.id,
        referenceChunkHash: reference.chunkHash,
        candidateChunkHash: candidate.chunkHash,
      }));
    }
    return Object.freeze({
      sequence: index + 1,
      id: entry.id,
      source,
      sourceIndex,
      seed: entry.seed,
      chunk: entry.chunk,
      typescriptLegacyOracleMilliseconds: typescriptMilliseconds[index],
      rustAuthoritativeCandidateMilliseconds: rustMilliseconds[index],
      referenceChunkHash: reference.chunkHash,
      candidateChunkHash: candidate?.chunkHash ?? null,
      byteEqual,
      chunkHashEqual,
      markerConstraintsPassed: markers.passed,
      markerCount: markers.markerCount,
      decodeIssue,
    });
  });
  let corpusHash: string | null = null;
  try {
    corpusHash = promotionCorpusHashV2(frozenManifest, extensionManifest, parityRows);
  } catch (error) {
    issues.push(`v2 corpus identity was not produced: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (corpusHash) validateCertificate(issues, certificate, corpusHash, requests);
  else issues.push("native parity certificate cannot be validated without 155 complete byte-equal hash rows");
  const exactCases = perCase.filter(({ byteEqual, chunkHashEqual, markerConstraintsPassed, decodeIssue }) => (
    byteEqual && chunkHashEqual && markerConstraintsPassed && decodeIssue === null
  )).length;

  const report = Object.freeze({
    schema: 2,
    benchmark: "blockwild-rust-worldgen-promotion-r3-v2",
    measuredAt: new Date().toISOString(),
    roles: {
      oracle: { label: "TypeScript legacy oracle", authority: "legacy comparison oracle" },
      candidate: { label: "Rust authoritative candidate", authority: "candidate under evaluation" },
    },
    claimBoundary: {
      promotionClaim: false,
      status: "benchmark evidence only",
      note: "This report does not promote Rust world generation or change runtime authority.",
    },
    corpus: {
      frozenManifest: relative(ROOT, FROZEN_PROMOTION_MANIFEST_PATH_V1).replaceAll("\\", "/"),
      frozenManifestSha256: sha256(frozenManifestText),
      normalizedOptionsExtension: relative(ROOT, NORMALIZED_OPTION_EXTENSION_PATH_V1).replaceAll("\\", "/"),
      normalizedOptionsExtensionSha256: sha256(extensionManifestText),
      frozenSchema: frozenManifest.schema,
      normalizedOptionsExtensionSchema: extensionManifest.schema,
      generatorVersion: frozenManifest.generatorVersion,
      namedCases: frozenManifest.cases.length,
      genericCases: frozenManifest.genericSweep.cases,
      normalizedOptionCases: NORMALIZED_OPTION_EXTENSION_CASES_V1,
      totalCases: orderedCases.length,
      requiredCoverageCount: COMPOSED_PROMOTION_COVERAGE_V2,
      order: "67 frozen named cases, 64 frozen generic cases grouped by global-index parity and descending within each parity band, then 24 normalized option lanes",
      corpusHash,
    },
    methodology: {
      percentile: "nearest-rank: sorted[ceil(sampleCount * fraction) - 1]",
      deterministicOrder: true,
      warmup: {
        typescript: {
          cases: 1,
          caseId: orderedCases[0].entry.id,
          milliseconds: typescriptWarmupMilliseconds,
          excludedFromSamples: true,
        },
        rust: {
          cases: 1,
          caseId: orderedCases[0].entry.id,
          coldMilliseconds: native.telemetry.coldUs / 1_000,
          excludedFromWarmSamples: true,
        },
      },
      typescriptMeasurement: "Per case: TypeScript legacy oracle generation plus canonical GeneratedChunkV2 construction and hashing. Request construction, warmup, and Rust parity comparison are excluded.",
      rustMeasurement: "Per case: native fixture packet decode, Rust generation, and result packet encode in-process. One priming request is reported as cold and excluded; process startup and filesystem I/O are excluded.",
      comparabilityBoundary: "The implementations share the exact ordered requests, but the measured boundaries differ: Rust includes wire decode/encode while TypeScript does not.",
      hostVariability: "Wall-clock timings are machine- and load-specific; compare runs on the same host under comparable conditions.",
    },
    timing: {
      typescriptLegacyOracle: timingSummary(typescriptMilliseconds),
      rustAuthoritativeCandidate: {
        ...timingSummary(rustMilliseconds),
        coldMilliseconds: native.telemetry.coldUs / 1_000,
        coldIncludedInWarmSamples: false,
        nativeResolution: "integer microseconds converted to milliseconds",
      },
      byCorpusSection: {
        named: {
          cases: EXPECTED_NAMED_CASES,
          typescriptLegacyOracle: timingSummary(typescriptMilliseconds.slice(0, EXPECTED_NAMED_CASES)),
          rustAuthoritativeCandidate: timingSummary(rustMilliseconds.slice(0, EXPECTED_NAMED_CASES)),
        },
        generic: {
          cases: EXPECTED_GENERIC_CASES,
          typescriptLegacyOracle: timingSummary(typescriptMilliseconds.slice(EXPECTED_NAMED_CASES, FROZEN_PROMOTION_CASES_V1)),
          rustAuthoritativeCandidate: timingSummary(rustMilliseconds.slice(EXPECTED_NAMED_CASES, FROZEN_PROMOTION_CASES_V1)),
        },
        normalizedOptions: {
          cases: NORMALIZED_OPTION_EXTENSION_CASES_V1,
          typescriptLegacyOracle: timingSummary(typescriptMilliseconds.slice(FROZEN_PROMOTION_CASES_V1)),
          rustAuthoritativeCandidate: timingSummary(rustMilliseconds.slice(FROZEN_PROMOTION_CASES_V1)),
        },
      },
    },
    validation: {
      passed: issues.length === 0,
      exactCases,
      expectedCases: COMPOSED_PROMOTION_CASES_V2,
      byteEqualCases: perCase.filter(({ byteEqual }) => byteEqual).length,
      chunkHashEqualCases: perCase.filter(({ chunkHashEqual }) => chunkHashEqual).length,
      markerConstraintCases: perCase.filter(({ markerConstraintsPassed }) => markerConstraintsPassed).length,
      returnedBatch: {
        expectedPackets: COMPOSED_PROMOTION_CASES_V2,
        receivedPackets: native.packets.length,
        orderValidated: perCase.every(({ decodeIssue }) => decodeIssue === null),
        orderValidationMethod: "Each packet was decoded against its sequence-specific taskId, revision, request hash, coordinates, namespace, and generator/content hashes.",
      },
      timingSampleCounts: {
        typescriptExpected: COMPOSED_PROMOTION_CASES_V2,
        typescriptReceived: typescriptMilliseconds.length,
        rustExpected: COMPOSED_PROMOTION_CASES_V2,
        rustReceived: native.telemetry.perCaseUs.length,
      },
      certificate,
      issues,
    },
    fixture: {
      cargoProfile: RUST_WORLDGEN_PROMOTION_FIXTURE_PROFILE,
      executable: relative(ROOT, FIXTURE_PATH).replaceAll("\\", "/"),
      buildCommand: RUST_WORLDGEN_PROMOTION_FIXTURE_BUILD_COMMAND,
      executableSha256: sha256(fixtureBytes),
      executableBytes: fixtureMetadata.size,
      executableModifiedAt: fixtureMetadata.mtime.toISOString(),
      source: relative(ROOT, FIXTURE_SOURCE_PATH).replaceAll("\\", "/"),
      sourceSha256: sha256(fixtureSource),
      sourceModifiedAt: fixtureSourceMetadata.mtime.toISOString(),
      executableNotOlderThanSource: fixtureMetadata.mtimeMs >= fixtureSourceMetadata.mtimeMs,
      provenanceBoundary: "The benchmark used the prebuilt native executable and did not invoke Cargo; source-to-binary identity is recorded but not proven by this run.",
      cargoInvokedByBenchmark: false,
      timeoutMilliseconds: FIXTURE_TIMEOUT_MS,
      requestBatchBytes: native.inputBytes,
      resultBatchBytes: native.outputBytes,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    perCase,
  });

  await prepareOutputPath(outputPath);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(outputPath, serialized, "utf8");
  process.stdout.write(serialized);
  if (!report.validation.passed) process.exitCode = 1;
  return { report, outputPath };
}

async function main() {
  try {
    await benchmarkRustWorldgenPromotion();
  } catch (error) {
    process.stderr.write(`Rust worldgen promotion benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (directPath === fileURLToPath(import.meta.url)) await main();
