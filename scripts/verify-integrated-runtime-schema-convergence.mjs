#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const INTEGRATED_RUNTIME_SCHEMA_MANIFEST = "engine/schema/integrated-runtime-r5-r9.v1.json";

const EXPECTED_DOMAINS = Object.freeze([
  Object.freeze({ phase: "R5", domain: "simulation" }),
  Object.freeze({ phase: "R6", domain: "entities" }),
  Object.freeze({ phase: "R7", domain: "gameplay" }),
  Object.freeze({ phase: "R8", domain: "persistence" }),
  Object.freeze({ phase: "R9", domain: "network" }),
]);
const ASSURANCE_STATUSES = new Set(["missing", "partial", "verified"]);
const FAMILY_PATTERN = /^[a-z0-9][a-z0-9.-]*$/u;
const MAGIC_PATTERN = /^[A-Z0-9]{4}$/u;
const TYPE_ID_PATTERN = /^blockwild\.[a-z0-9.-]+\.v[1-9][0-9]*$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function integratedRuntimeSchemaFingerprint(document) {
  const protocol = document?.protocol;
  const domains = Array.isArray(document?.domains)
    ? document.domains.map((row) => ({
      phase: row?.phase,
      domain: row?.domain,
      protocolSchema: row?.protocolSchema,
      families: row?.families,
    }))
    : document?.domains;
  const canonical = canonicalJson({
    schemaVersion: document?.schemaVersion,
    protocol: isObject(protocol)
      ? {
        name: protocol.name,
        wireVersion: protocol.wireVersion,
        runtimeSchema: protocol.runtimeSchema,
        requestEnvelope: isObject(protocol.requestEnvelope)
          ? {
            magic: protocol.requestEnvelope.magic,
            schemaFamily: protocol.requestEnvelope.schemaFamily,
          }
          : protocol.requestEnvelope,
        receiptEnvelope: isObject(protocol.receiptEnvelope)
          ? {
            magic: protocol.receiptEnvelope.magic,
            schemaFamily: protocol.receiptEnvelope.schemaFamily,
          }
          : protocol.receiptEnvelope,
      }
      : protocol,
    domains,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function withIntegratedRuntimeSchemaFingerprint(document) {
  return {
    ...document,
    fingerprint: {
      algorithm: "sha256",
      canonicalization: "json-sorted-keys-v1",
      value: integratedRuntimeSchemaFingerprint(document),
    },
  };
}

function isPortablePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function uniqueStrings(values) {
  return Array.isArray(values)
    && values.every((value) => typeof value === "string")
    && new Set(values).size === values.length;
}

async function validatePath(root, candidate, label, blockers) {
  if (!isPortablePath(candidate)) {
    blockers.push(`${label} is not a portable repository-relative path`);
    return false;
  }
  const absolute = path.resolve(root, ...candidate.split("/"));
  const relativeToRoot = path.relative(root, absolute);
  if (relativeToRoot === "" || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    blockers.push(`${label} resolves outside the repository or to its root`);
    return false;
  }
  try {
    const [info, resolvedRoot, resolvedFile] = await Promise.all([
      stat(absolute),
      realpath(root),
      realpath(absolute),
    ]);
    const realRelative = path.relative(resolvedRoot, resolvedFile);
    if (realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      blockers.push(`${label} resolves outside the repository`);
      return false;
    }
    if (!info.isFile()) {
      blockers.push(`${label} does not resolve to a file`);
      return false;
    }
    return true;
  } catch {
    blockers.push(`${label} is missing`);
    return false;
  }
}

async function validatePathArray(root, values, label, blockers, predicate = () => true) {
  if (!uniqueStrings(values) || values.length === 0) {
    blockers.push(`${label} must be a non-empty duplicate-free string array`);
    return;
  }
  for (const [index, candidate] of values.entries()) {
    if (!predicate(candidate)) blockers.push(`${label}[${index}] is in the wrong evidence class`);
    await validatePath(root, candidate, `${label}[${index}]`, blockers);
  }
}

function validateFamilies(values, direction, label, blockers) {
  if (!Array.isArray(values) || values.length === 0) {
    blockers.push(`${label} must be a non-empty family descriptor array`);
    return [];
  }
  const ids = [];
  for (const [index, family] of values.entries()) {
    const familyLabel = `${label}[${index}]`;
    if (!exactKeys(family, ["id", "direction", "magic", "typeId", "operationSchema", "innerSchema", "normalPath"])) {
      blockers.push(`${familyLabel} does not have the exact family descriptor shape`);
      continue;
    }
    ids.push(family.id);
    if (typeof family.id !== "string" || !FAMILY_PATTERN.test(family.id)) blockers.push(`${familyLabel}.id is not canonical`);
    if (family.direction !== direction) blockers.push(`${familyLabel}.direction must equal ${direction}`);
    if (family.magic !== null && (typeof family.magic !== "string" || !MAGIC_PATTERN.test(family.magic))) {
      blockers.push(`${familyLabel}.magic must be null or four uppercase ASCII characters`);
    }
    if (family.typeId !== null && (typeof family.typeId !== "string" || !TYPE_ID_PATTERN.test(family.typeId))) {
      blockers.push(`${familyLabel}.typeId must be null or a canonical versioned Blockwild type id`);
    }
    if (family.operationSchema !== null && (!Number.isInteger(family.operationSchema) || family.operationSchema < 1)) {
      blockers.push(`${familyLabel}.operationSchema must be null or a positive integer`);
    }
    if (family.innerSchema !== null && (!Number.isInteger(family.innerSchema) || family.innerSchema < 1)) {
      blockers.push(`${familyLabel}.innerSchema must be null or a positive integer`);
    }
    if (typeof family.normalPath !== "boolean") blockers.push(`${familyLabel}.normalPath must be boolean`);
    if (family.normalPath && (
      family.magic === null
      || family.typeId === null
      || family.operationSchema === null
      || family.innerSchema === null
    )) {
      blockers.push(`${familyLabel} is normal-path but has an unmapped wire field`);
    }
  }
  if (new Set(ids).size !== ids.length) blockers.push(`${label} contains duplicate family ids`);
  return values.filter(isObject);
}

export async function verifyIntegratedRuntimeSchemaConvergence({
  root = path.resolve(import.meta.dirname, ".."),
  manifestPath = path.join(root, ...INTEGRATED_RUNTIME_SCHEMA_MANIFEST.split("/")),
} = {}) {
  const blockers = [];
  let document = null;
  try {
    document = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    blockers.push(`schema convergence manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!document) {
    return {
      schemaVersion: 1,
      manifest: path.relative(root, manifestPath).replaceAll(path.sep, "/"),
      valid: false,
      complete: false,
      blockers,
      fingerprint: { algorithm: "sha256", declared: null, computed: null, valid: false },
      domains: [],
      completeDomains: 0,
      partialDomains: EXPECTED_DOMAINS.map(({ phase, domain }) => `${phase}/${domain}`),
    };
  }

  if (!exactKeys(document, ["schemaVersion", "protocol", "fingerprint", "domains"])) {
    blockers.push("manifest does not have the exact schema-v1 root shape");
  }
  if (document.schemaVersion !== 1) blockers.push("manifest schemaVersion must equal 1");

  const protocol = document.protocol;
  if (!exactKeys(protocol, ["name", "wireVersion", "runtimeSchema", "requestEnvelope", "receiptEnvelope"])) {
    blockers.push("protocol does not have the exact schema-v1 shape");
  } else {
    if (protocol.name !== "blockwild-integrated-runtime") blockers.push("protocol name is not blockwild-integrated-runtime");
    if (protocol.wireVersion !== 1) blockers.push("protocol wireVersion must equal 1");
    if (!Number.isInteger(protocol.runtimeSchema) || protocol.runtimeSchema < 1) blockers.push("protocol runtimeSchema must be a positive integer");
    for (const [kind, expectedMagic, expectedFamily] of [
      ["requestEnvelope", "BWRQ", "RuntimeRequestV1"],
      ["receiptEnvelope", "BWRS", "RuntimeResponseV1"],
    ]) {
      const envelope = protocol[kind];
      if (!exactKeys(envelope, ["magic", "schemaFamily", "canonicalRustPath", "canonicalTypescriptPath"])) {
        blockers.push(`${kind} does not have the exact schema-v1 shape`);
        continue;
      }
      if (envelope.magic !== expectedMagic) blockers.push(`${kind}.magic must equal ${expectedMagic}`);
      if (envelope.schemaFamily !== expectedFamily) blockers.push(`${kind}.schemaFamily must equal ${expectedFamily}`);
      await validatePath(root, envelope.canonicalRustPath, `${kind}.canonicalRustPath`, blockers);
      await validatePath(root, envelope.canonicalTypescriptPath, `${kind}.canonicalTypescriptPath`, blockers);
    }
  }

  const fingerprint = document.fingerprint;
  const computedFingerprint = integratedRuntimeSchemaFingerprint(document);
  if (!exactKeys(fingerprint, ["algorithm", "canonicalization", "value"])) {
    blockers.push("fingerprint does not have the exact schema-v1 shape");
  } else {
    if (fingerprint.algorithm !== "sha256") blockers.push("fingerprint algorithm must equal sha256");
    if (fingerprint.canonicalization !== "json-sorted-keys-v1") {
      blockers.push("fingerprint canonicalization must equal json-sorted-keys-v1");
    }
    if (typeof fingerprint.value !== "string" || !SHA256_PATTERN.test(fingerprint.value)) {
      blockers.push("fingerprint value is not a lowercase SHA-256 digest");
    }
    if (fingerprint.value !== computedFingerprint) blockers.push("manifest fingerprint drift detected");
  }

  const domainReports = [];
  const manifestFamilyIds = [];
  if (!Array.isArray(document.domains) || document.domains.length !== EXPECTED_DOMAINS.length) {
    blockers.push(`domains must contain the exact closed R5-R9 set of ${EXPECTED_DOMAINS.length} rows`);
  }
  const rows = Array.isArray(document.domains) ? document.domains : [];
  const domainKeys = rows.map((row) => `${row?.phase}/${row?.domain}`);
  if (new Set(domainKeys).size !== domainKeys.length) blockers.push("domain rows contain duplicates");

  for (let index = 0; index < EXPECTED_DOMAINS.length; index += 1) {
    const expected = EXPECTED_DOMAINS[index];
    const row = rows[index];
    const rowLabel = `${expected.phase}/${expected.domain}`;
    if (!isObject(row)) {
      blockers.push(`${rowLabel} domain row is missing or malformed`);
      continue;
    }
    if (row.phase !== expected.phase || row.domain !== expected.domain) {
      blockers.push(`domains[${index}] must be exactly ${rowLabel}`);
    }
    if (!exactKeys(row, [
      "phase",
      "domain",
      "protocolSchema",
      "canonicalPaths",
      "families",
      "evidence",
      "assurance",
      "completion",
    ])) blockers.push(`${rowLabel} does not have the exact schema-v1 domain shape`);
    if (!Number.isInteger(row.protocolSchema) || row.protocolSchema < 1) {
      blockers.push(`${rowLabel}.protocolSchema must be a positive integer`);
    }

    if (!exactKeys(row.canonicalPaths, ["rust", "typescript"])) {
      blockers.push(`${rowLabel}.canonicalPaths does not have the exact shape`);
    } else {
      await validatePathArray(root, row.canonicalPaths.rust, `${rowLabel}.canonicalPaths.rust`, blockers,
        (candidate) => candidate.startsWith("engine/") && candidate.endsWith(".rs"));
      await validatePathArray(root, row.canonicalPaths.typescript, `${rowLabel}.canonicalPaths.typescript`, blockers,
        (candidate) => candidate.startsWith("app/") && candidate.endsWith(".ts"));
    }

    if (!exactKeys(row.families, ["requests", "receipts"])) {
      blockers.push(`${rowLabel}.families does not have the exact shape`);
    } else {
      const requests = validateFamilies(row.families.requests, "request", `${rowLabel}.families.requests`, blockers);
      const receipts = validateFamilies(row.families.receipts, "receipt", `${rowLabel}.families.receipts`, blockers);
      const familyIds = [...requests, ...receipts].map((family) => family.id);
      manifestFamilyIds.push(...familyIds);
      if (new Set(familyIds).size !== familyIds.length) blockers.push(`${rowLabel}.families contains duplicate ids across directions`);
    }

    if (!exactKeys(row.evidence, ["fixtures", "tests", "native", "wasm", "typescript"])) {
      blockers.push(`${rowLabel}.evidence does not have the exact shape`);
    } else {
      await validatePathArray(root, row.evidence.fixtures, `${rowLabel}.evidence.fixtures`, blockers,
        (candidate) => candidate.startsWith("tests/fixtures/") || /\/fixtures\//u.test(candidate));
      await validatePathArray(root, row.evidence.tests, `${rowLabel}.evidence.tests`, blockers,
        (candidate) => /^tests\/.+\.test\.(?:ts|mjs)$/u.test(candidate));
      await validatePathArray(root, row.evidence.native, `${rowLabel}.evidence.native`, blockers,
        (candidate) => candidate.startsWith("engine/crates/") && candidate.endsWith(".rs"));
      await validatePathArray(root, row.evidence.wasm, `${rowLabel}.evidence.wasm`, blockers,
        (candidate) => candidate.startsWith("engine/crates/blockwild-wasm/") && candidate.endsWith(".rs"));
      await validatePathArray(root, row.evidence.typescript, `${rowLabel}.evidence.typescript`, blockers,
        (candidate) => /^tests\/.+\.test\.(?:ts|mjs)$/u.test(candidate));
    }

    if (!exactKeys(row.assurance, ["bounds", "hashes", "fingerprint"])) {
      blockers.push(`${rowLabel}.assurance does not have the exact shape`);
    } else {
      for (const assuranceName of ["bounds", "hashes", "fingerprint"]) {
        const assurance = row.assurance[assuranceName];
        if (!exactKeys(assurance, ["status", "evidence"])) {
          blockers.push(`${rowLabel}.assurance.${assuranceName} does not have the exact shape`);
          continue;
        }
        if (!ASSURANCE_STATUSES.has(assurance.status)) {
          blockers.push(`${rowLabel}.assurance.${assuranceName}.status is invalid`);
        }
        await validatePathArray(root, assurance.evidence, `${rowLabel}.assurance.${assuranceName}.evidence`, blockers);
      }
    }

    const completion = row.completion;
    let rowComplete = false;
    if (!exactKeys(completion, ["status", "complete", "remaining"])) {
      blockers.push(`${rowLabel}.completion does not have the exact shape`);
    } else {
      if (completion.status !== "partial" && completion.status !== "complete") {
        blockers.push(`${rowLabel}.completion.status must be partial or complete`);
      }
      if (typeof completion.complete !== "boolean") blockers.push(`${rowLabel}.completion.complete must be boolean`);
      if (!uniqueStrings(completion.remaining)) {
        blockers.push(`${rowLabel}.completion.remaining must be a duplicate-free string array`);
      } else if (completion.remaining.some((item) => !FAMILY_PATTERN.test(item))) {
        blockers.push(`${rowLabel}.completion.remaining contains a noncanonical identifier`);
      }
      rowComplete = completion.status === "complete" && completion.complete === true;
      if (completion.complete !== (completion.status === "complete")) {
        blockers.push(`${rowLabel}.completion status and complete flag disagree`);
      }
      if (rowComplete) {
        if (completion.remaining.length !== 0) blockers.push(`${rowLabel} claims completion with remaining work`);
        const assurancesVerified = exactKeys(row.assurance, ["bounds", "hashes", "fingerprint"])
          && ["bounds", "hashes", "fingerprint"].every((name) => row.assurance[name]?.status === "verified");
        if (!assurancesVerified) blockers.push(`${rowLabel} claims completion without verified bounds, hashes, and fingerprint`);
        const families = exactKeys(row.families, ["requests", "receipts"])
          ? [...(Array.isArray(row.families.requests) ? row.families.requests : []), ...(Array.isArray(row.families.receipts) ? row.families.receipts : [])]
          : [];
        if (families.length === 0 || families.some((family) => !isObject(family)
          || family.magic === null
          || family.typeId === null
          || family.operationSchema === null
          || family.innerSchema === null)) {
          blockers.push(`${rowLabel} claims completion with an unmapped family descriptor`);
        }
      } else if (Array.isArray(completion.remaining) && completion.remaining.length === 0) {
        blockers.push(`${rowLabel} is partial but does not identify remaining work`);
      }
    }
    domainReports.push({
      phase: expected.phase,
      domain: expected.domain,
      complete: rowComplete,
      status: completion?.status ?? "malformed",
      assurance: isObject(row.assurance)
        ? {
          bounds: row.assurance.bounds?.status ?? "malformed",
          hashes: row.assurance.hashes?.status ?? "malformed",
          fingerprint: row.assurance.fingerprint?.status ?? "malformed",
        }
        : { bounds: "malformed", hashes: "malformed", fingerprint: "malformed" },
    });
  }
  if (new Set(manifestFamilyIds).size !== manifestFamilyIds.length) {
    blockers.push("manifest family ids are not globally unique across R5-R9");
  }

  const valid = blockers.length === 0;
  const completeDomains = domainReports.filter((row) => row.complete).length;
  return {
    schemaVersion: 1,
    manifest: path.relative(root, manifestPath).replaceAll(path.sep, "/"),
    valid,
    complete: valid && completeDomains === EXPECTED_DOMAINS.length,
    blockers,
    fingerprint: {
      algorithm: "sha256",
      declared: fingerprint?.value ?? null,
      computed: computedFingerprint,
      valid: fingerprint?.value === computedFingerprint && SHA256_PATTERN.test(fingerprint?.value ?? ""),
    },
    domains: domainReports,
    completeDomains,
    partialDomains: domainReports.filter((row) => !row.complete).map(({ phase, domain }) => `${phase}/${domain}`),
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const requestedManifest = argumentValue("--manifest");
  const manifestPath = requestedManifest ? path.resolve(root, requestedManifest) : undefined;
  const output = argumentValue("--out");
  const report = await verifyIntegratedRuntimeSchemaConvergence({ root, manifestPath });
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(path.resolve(root, output), rendered, "utf8");
  process.stdout.write(rendered);
  if (!report.valid || (process.argv.includes("--require-complete") && !report.complete)) process.exitCode = 1;
}
